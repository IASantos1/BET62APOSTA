export const LOCAL_FALLBACK_BASE = 'http://127.0.0.1:8788';

// Always use relative paths — Vite dev proxy forwards /api/* to the remote worker.
// In production builds pointing directly at the worker, VITE_API_BASE can be set.
function resolveApiBase() {
  const raw = (import.meta.env.VITE_API_BASE || '').trim();
  if (!import.meta.env.DEV && typeof window !== 'undefined') {
    const forceRelative = String(import.meta.env.VITE_FORCE_RELATIVE_API || '') === '1';
    if (forceRelative) return '';

    const host = window.location.hostname;
    if (host.endsWith('.vercel.app')) return '';
  }

  if (raw && !import.meta.env.DEV) {
    const cleaned = raw.replace(/\/$/, '');
    if (/^https?:\/\//i.test(cleaned)) {
      try {
        if (!/\.workers\.dev$/i.test(new URL(cleaned).hostname)) return cleaned;
      } catch {
        return '';
      }
      return '';
    }
    return cleaned;
  }
  return '';
}

const API_BASE = resolveApiBase();
if (import.meta.env.DEV) console.log('[API] Base resolved to:', API_BASE || '(relative — proxied by Vite)');
const __api_cache = new Map<string, any>();
const __api_cache_ts = new Map<string, number>();
const __api_inflight = new Map<string, Promise<any>>();
const __api_ttl = Number(import.meta.env.VITE_API_CACHE_TTL || 30000);

export async function apiFetch<T = any>(
  input: RequestInfo | URL,
  init?: RequestInit & { timeout?: number }
): Promise<T> {
  const { timeout = 30000, signal, ...rest } = init || {};
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);

  // Propagate external abort signal
  if (signal) {
    signal.addEventListener('abort', () => controller.abort());
  }

  let url = input;
  if (typeof input === 'string' && input.startsWith('/')) {
    url = `${API_BASE}${input}`;
  }

  if (import.meta.env.DEV) {
    console.log(`[API] Fetching ${url}`);
  }

  const sessionMarker = localStorage.getItem('auth_session');
  const method = String((rest.method || 'GET')).toUpperCase();
  const isGet = method === 'GET';
  const urlStr = typeof url === 'string' ? url : String(url);
          const isRealtime = /[?&]realtime=1(?:&|$)/.test(urlStr);
  // Collision-resistant cache key
  const key = `${method}:${urlStr}`;

  try {
            const noCache = isRealtime || rest.cache === 'no-store' || rest.cache === 'no-cache';

    if (isGet && !noCache) {
      const ts = __api_cache_ts.get(key) || 0;
      if (ts && Date.now() - ts < __api_ttl && __api_cache.has(key)) {
        clearTimeout(id);
        return __api_cache.get(key) as T;
      }
      const inflight = __api_inflight.get(key);
      if (inflight) {
        clearTimeout(id);
        return inflight as Promise<T>;
      }
    }
    
    // Headers merging logic (respect user's Content-Type)
    const headers = {
        ...(rest.headers || {}),
        // Only add Content-Type: application/json if body exists AND user didn't set Content-Type (e.g. multipart/form-data)
        ...(rest.body && !(rest.headers as any)?.['Content-Type'] ? { 'Content-Type': 'application/json' } : {}),
        // Avoid forcing Content-Type on GET (causes unnecessary CORS preflight); prefer Accept
        ...(!(rest.headers as any)?.['Accept'] ? { 'Accept': 'application/json' } : {}),
    };

    const fetchPromise = fetch(url, {
      ...rest,
      signal: controller.signal,
      headers,
      credentials: 'include',
    });

    if (isGet) {
        // Wrap the fetch promise for inflight caching
        const p = (async () => {
            const response = await fetchPromise;
            if (!response.ok) {
                if (response.status === 401) {
                    if (sessionMarker) window.dispatchEvent(new Event('auth:unauthorized'));
                }
                let errorMessage = response.statusText;
                let errorPayload: any = null;
                try {
                    const errorData = await response.json() as { error?: string, details?: string, stack?: string };
                    errorPayload = errorData;
                    console.error('[API] Error Detail:', errorData);
                    if (errorData && errorData.error) {
                        errorMessage = errorData.error;
                        if (errorData.details) errorMessage += ` (${errorData.details})`;
                    }
                } catch { /* ignore */ }
                
                // CRITICAL FIX: Don't just throw, but maybe retry if it's 5xx? 
                // For now, throw to trigger catch block
                const err: any = new Error(`Request failed: ${response.status} ${errorMessage}`);
                err.status = response.status;
                err.data = errorPayload;
                throw err;
            }
            if (response.status === 204) return {} as T;
            return response.json() as Promise<T>;
        })();

        __api_inflight.set(key, p);
        
        try {
            const data = await p;
            __api_cache.set(key, data);
            __api_cache_ts.set(key, Date.now());
            return data;
        } finally {
            // Ensure cleanup happens even if request fails
            __api_inflight.delete(key);
        }
    }

    // Non-GET requests (no cache logic)
    const response = await fetchPromise;
    clearTimeout(id);

    if (!response.ok) {
      if (response.status === 401) {
        if (sessionMarker) window.dispatchEvent(new Event('auth:unauthorized'));
      }
      let errorMessage = response.statusText;
      let errorPayload: any = null;
      try {
        const errorData = await response.json() as { error?: string, details?: string, stack?: string };
        errorPayload = errorData;
        console.error('[API] Error Detail:', errorData);
        if (errorData && errorData.error) {
          errorMessage = errorData.error;
          if (errorData.details) errorMessage += ` (${errorData.details})`;
        }
      } catch { /* ignore */ }
      const err: any = new Error(`Request failed: ${response.status} ${errorMessage}`);
      err.status = response.status;
      err.data = errorPayload;
      throw err;
    }
    if (response.status === 204) {
      return {} as T;
    }
    return response.json() as Promise<T>;

  } catch (e: any) {
    const msg = String(e?.message || '');
    const isAbort = e?.name === 'AbortError' || /Abort|ERR_CANCELED/i.test(msg);
    // CRITICAL FIX: Don't swallow errors silently!
    // Returning {} causes "loading forever" UI because React Query thinks it got data but it's empty.
    // We must re-throw if it's a real error, unless it's just an abort.
    if (isAbort) return {} as T;
    
    console.error(`[API] Fetch Error for ${url}:`, e);
    throw e;
  } finally {
    clearTimeout(id);
  }
}
