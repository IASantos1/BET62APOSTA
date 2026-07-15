export interface AuthUser {
  id: string;
  email: string;
  role: 'user' | 'admin';
  name?: string;
}

const API_URL = import.meta.env.VITE_API_URL || '/api';
let API_COMPAT: 'node' | 'phpv1' = (import.meta.env.VITE_API_COMPAT as any) || 'node';
if (!import.meta.env.VITE_API_COMPAT) {
  const u = String(API_URL).toLowerCase();
  // Detecta compatibilidade PHP apenas para domínios conhecidos
  if (u.includes('api.bet62.plus')) {
    API_COMPAT = 'phpv1';
  }
}
const TOKEN_KEY = 'auth_token';

function getToken() {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

function setToken(token: string | null) {
  if (typeof window === 'undefined') return;
  if (token) {
    window.localStorage.setItem(TOKEN_KEY, token);
  } else {
    window.localStorage.removeItem(TOKEN_KEY);
  }
}

function resolvePath(path: string): string {
  if (API_COMPAT === 'phpv1') {
    if (path === '/auth/signup') return '/api/v1/users/register';
    if (path === '/auth/login') return '/api/v1/users/login';
    if (path === '/auth/logout') return '/api/v1/users/logout';
    return path;
  }
  return path;
}

function mapAuthUser(rawUser: any): AuthUser | null {
  if (!rawUser) return null;

  const id = String(rawUser.userId || rawUser.id || '').trim();
  const email = String(rawUser.username || rawUser.email || '').trim();

  if (!id || !email) return null;

  return {
    id,
    email,
    role: rawUser.is_operator ? 'admin' : 'user',
    name: rawUser.name ? String(rawUser.name) : undefined,
  };
}

export async function apiFetch(path: string, options: RequestInit = {}) {
  const token = getToken();
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  if (token) {
    (headers as any).Authorization = `Bearer ${token}`;
  }

  const baseCandidates: string[] = [API_URL];
  if (API_URL.startsWith('http://localhost')) {
    baseCandidates.push(API_URL.replace('http://localhost', 'http://127.0.0.1'));
  }

  const doFetch = async (): Promise<{ ok: boolean; status: number; data: any }> => {
    let lastError: any = null;
    for (const base of baseCandidates) {
      try {
        const res = await fetch(`${base}${resolvePath(path)}`, {
          ...options,
          headers,
          credentials: 'include',
        });
        const text = await res.text();
        const data = text ? JSON.parse(text) : null;
        return { ok: res.ok, status: res.status, data };
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError || new Error('Erro de comunicação com o servidor');
  };

  let first = await doFetch();

  if (!first.ok && first.status === 401 && API_COMPAT !== 'phpv1') {
    try {
      const refreshRes = await fetch(`${baseCandidates[0] || API_URL}/auth/refresh`, {
        method: 'POST',
        headers,
        credentials: 'include',
      });
      const refreshText = await refreshRes.text();
      const refreshData = refreshText ? JSON.parse(refreshText) : null;
      if (refreshRes.ok && refreshData?.token) {
        setToken(refreshData.token);
        (headers as any).Authorization = `Bearer ${refreshData.token}`;
        first = await doFetch();
      } else {
        setToken(null);
      }
    } catch {
      setToken(null);
    }
  }

  if (!first.ok) {
    const message =
      first.data?.error || first.data?.message || 'Erro de comunicação com o servidor';
    throw new Error(message);
  }

  return first.data;
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  try {
    const data = await apiFetch('/auth/me', { method: 'GET' });
    return mapAuthUser(data?.user);
  } catch {
    return null;
  }
}

export async function signIn(email: string, password: string): Promise<AuthUser> {
  const data = await apiFetch('/auth/signin', {
    method: 'POST',
    body: JSON.stringify({ username: email, password }),
  });

  if (data?.requires2fa) {
    throw Object.assign(new Error('2FA_REQUIRED'), { requires2fa: true, userId: data.userId });
  }

  if (!data?.token) {
    throw new Error('Resposta inválida do servidor');
  }

  setToken(data.token);
  if (data.refreshToken) {
    if (typeof window !== 'undefined') window.localStorage.setItem('refresh_token', data.refreshToken);
  }

  const user = mapAuthUser(data.user);
  if (user) return user;

  const me = await getCurrentUser();
  if (!me) throw new Error('Não foi possível obter o perfil do utilizador');
  return me;
}

export async function signUp(
  email: string,
  password: string,
  extraData?: Record<string, any>,
): Promise<AuthUser | null> {
  const payload: any = {
    email,
    password,
    firstName: extraData?.firstName || extraData?.first_name || '',
    lastName: extraData?.lastName || extraData?.last_name || '',
    phone: extraData?.phone || '',
    country: extraData?.country || '',
    nif: extraData?.nif || '',
    dob: extraData?.dob || extraData?.birth_date || null,
  };

  if (extraData?.full_name && !payload.firstName) {
    const parts = String(extraData.full_name).trim().split(' ');
    payload.firstName = parts[0] || '';
    payload.lastName = parts.slice(1).join(' ') || '';
  }

  const data = await apiFetch('/auth/signup', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  if (!data?.token) {
    throw new Error('Resposta inválida do servidor');
  }

  setToken(data.token);
  if (data.refreshToken) {
    if (typeof window !== 'undefined') window.localStorage.setItem('refresh_token', data.refreshToken);
  }

  const user = mapAuthUser(data.user);
  if (user) return user;

  const me = await getCurrentUser();
  return me;
}

export async function signInWithProvider(provider: 'google' | 'facebook'): Promise<void> {
  throw new Error(`Login com ${provider} ainda não está implementado no novo backend`);
}

export async function signOut(): Promise<void> {
  try {
    await apiFetch('/auth/logout', { method: 'POST' });
  } catch {
    // Ignorar erros de logout para não bloquear o fluxo do utilizador
  }
  setToken(null);
  if (typeof window !== 'undefined') window.localStorage.removeItem('refresh_token');
}

export async function requestEmailVerification(email: string): Promise<{ ok: boolean; debugCode?: string }> {
  const res = await apiFetch('/auth/request-verification', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
  return res;
}

export async function verifyEmail(email: string, code: string): Promise<{ ok: boolean }> {
  const res = await apiFetch('/auth/verify', {
    method: 'POST',
    body: JSON.stringify({ email, code }),
  });
  return res;
}

export async function requestPasswordReset(email: string): Promise<{ ok: boolean; debugCode?: string }> {
  const res = await apiFetch('/auth/request-password-reset', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
  return res;
}

export async function resetPassword(email: string, code: string, newPassword: string): Promise<{ ok: boolean }> {
  const res = await apiFetch('/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ email, code, newPassword }),
  });
  return res;
}
