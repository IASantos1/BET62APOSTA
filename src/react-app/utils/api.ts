export const REMOTE_FALLBACK_BASE = 'https://bet62apostasesportivas.bet62.workers.dev';
export const LOCAL_FALLBACK_BASE = 'http://127.0.0.1:8788';

function resolveApiBase() {
  const raw = import.meta.env.VITE_API_BASE || '';
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0') {
      const forceRemote = String(import.meta.env.VITE_FORCE_REMOTE || '') === '1';
      const useLocal = String(import.meta.env.VITE_USE_LOCAL || '') === '1';
      if (useLocal) return LOCAL_FALLBACK_BASE;
      if (raw && raw.trim() !== '') return raw.replace(/\/$/, '');
      if (forceRemote) return REMOTE_FALLBACK_BASE;
      return LOCAL_FALLBACK_BASE;
    }
    if (raw && raw.trim() !== '') return raw.replace(/\/$/, '');
    return REMOTE_FALLBACK_BASE;
  }
  if (raw && raw.trim() !== '') return raw.replace(/\/$/, '');
  return REMOTE_FALLBACK_BASE;
}

const API_BASE = resolveApiBase();
console.log('[API] Base resolved to:', API_BASE); // DEBUG
const __api_cache = new Map<string, any>();
const __api_cache_ts = new Map<string, number>();
const __api_inflight = new Map<string, Promise<any>>();
const __api_ttl = Number(import.meta.env.VITE_API_CACHE_TTL || 15000);

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

  // 1. Get Token (Scoped outside try/catch for fallback)
  const token = localStorage.getItem('auth_token');
  const method = String((rest.method || 'GET')).toUpperCase();
  const isGet = method === 'GET';
  const urlStr = typeof url === 'string' ? url : String(url);
  // Collision-resistant cache key
  const key = `${method}:${urlStr}`;
  const rawPath = typeof input === 'string' ? input : urlStr;
  const isPublicApi =
    typeof rawPath === 'string' &&
    (rawPath.startsWith('/api/events') ||
      rawPath.startsWith('/api/sports') ||
      rawPath.startsWith('/api/health') ||
      rawPath.startsWith('/api/dev'));

  try {
    const noCache = rest.cache === 'no-store' || rest.cache === 'no-cache';

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
        ...(!isPublicApi && token ? { 'Authorization': `Bearer ${token}` } : {}),
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
                    window.dispatchEvent(new Event('auth:unauthorized'));
                }
                let errorMessage = response.statusText;
                try {
                    const errorData = await response.json() as { error?: string, details?: string, stack?: string };
                    console.error('[API] Error Detail:', errorData);
                    if (errorData && errorData.error) {
                        errorMessage = errorData.error;
                        if (errorData.details) errorMessage += ` (${errorData.details})`;
                    }
                } catch { /* ignore */ }
                
                // CRITICAL FIX: Don't just throw, but maybe retry if it's 5xx? 
                // For now, throw to trigger catch block
                throw new Error(`Request failed: ${response.status} ${errorMessage}`);
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
        window.dispatchEvent(new Event('auth:unauthorized'));
      }
      let errorMessage = response.statusText;
      try {
        const errorData = await response.json() as { error?: string, details?: string, stack?: string };
        console.error('[API] Error Detail:', errorData);
        if (errorData && errorData.error) {
          errorMessage = errorData.error;
          if (errorData.details) errorMessage += ` (${errorData.details})`;
        }
      } catch { /* ignore */ }
      throw new Error(`Request failed: ${response.status} ${errorMessage}`);
    }
    if (response.status === 204) {
      return {} as T;
    }
    return response.json() as Promise<T>;

  } catch (e: any) {
    const msg = String(e?.message || '');
    const isAbort = e?.name === 'AbortError' || /Abort|ERR_CANCELED/i.test(msg);
    // Improved Network Error Regex
    const isConn = /ERR_CONNECTION_REFUSED|ERR_CONNECTION_RESET|NetworkError|ERR_ABORTED|Failed to fetch/i.test(msg);
    
    const allowRemoteFallback = String(import.meta.env.VITE_REMOTE_FALLBACK ?? '1') === '1';
    const isLocalBase = API_BASE.includes('127.0.0.1') || API_BASE.includes('localhost');
    if (isConn && allowRemoteFallback && isLocalBase && typeof input === 'string' && input.startsWith('/')) {
      try {
        const fallbackUrl = `${REMOTE_FALLBACK_BASE}${input}`;
        if (import.meta.env.DEV) {
          console.warn(`[API] Local backend unreachable, retrying via remote: ${fallbackUrl}`);
        }
        
        // Reconstruct headers for fallback
        const fallbackHeaders = {
            ...(rest.headers || {}),
            ...(!isPublicApi && token ? { 'Authorization': `Bearer ${token}` } : {}),
            ...(rest.body && !(rest.headers as any)?.['Content-Type'] ? { 'Content-Type': 'application/json' } : {}),
            ...(!(rest.headers as any)?.['Accept'] ? { 'Accept': 'application/json' } : {}),
        };

        const response = await fetch(fallbackUrl, {
          ...rest,
          headers: fallbackHeaders,
          credentials: 'include',
        });
        if (!response.ok) {
          if (response.status === 401) {
            window.dispatchEvent(new Event('auth:unauthorized'));
          }
          let errorMessage = response.statusText;
          try {
            const errorData = await response.json() as { error?: string, details?: string, stack?: string };
            console.error('[API] Remote Error Detail:', errorData);
            if (errorData && errorData.error) {
              errorMessage = errorData.error;
              if (errorData.details) errorMessage += ` (${errorData.details})`;
            }
          } catch {
            errorMessage = response.statusText;
          }
          throw new Error(`Remote request failed: ${response.status} ${errorMessage}`);
        }
        if (response.status === 204) {
          return {} as T;
        }
        return await response.json() as T;
      } catch (fallbackError) {
        const fMsg = String((fallbackError as any)?.message || '');
        const fIsConn = /ERR_CONNECTION_REFUSED|ERR_CONNECTION_RESET|NetworkError|ERR_ABORTED|Failed to fetch/i.test(fMsg);
        if (!fIsConn) {
          throw fallbackError;
        }
      }
    }
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
