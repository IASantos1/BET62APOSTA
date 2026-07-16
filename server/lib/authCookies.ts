import type http from 'http';

export const AUTH_SESSION_COOKIE = 'bet62_session';
export const AUTH_REFRESH_COOKIE = 'bet62_refresh';

export function parseCookies(req: http.IncomingMessage): Record<string, string> {
  const raw = String(req.headers.cookie || '');
  const out: Record<string, string> = {};
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

function appendSetCookie(res: http.ServerResponse, cookie: string): void {
  const current = res.getHeader('Set-Cookie');
  if (!current) {
    res.setHeader('Set-Cookie', [cookie]);
    return;
  }
  const list = Array.isArray(current) ? current.map(String) : [String(current)];
  list.push(cookie);
  res.setHeader('Set-Cookie', list);
}

function cookieBase(req: http.IncomingMessage, maxAgeSeconds: number): string {
  const xfProto = String(req.headers['x-forwarded-proto'] || '').toLowerCase();
  const secure = xfProto.includes('https') || process.env.NODE_ENV === 'production';
  return [
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    secure ? 'Secure' : '',
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
  ]
    .filter(Boolean)
    .join('; ');
}

export function setAuthCookies(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  input: { token: string; refreshToken: string },
): void {
  const session = `${AUTH_SESSION_COOKIE}=${encodeURIComponent(input.token)}; ${cookieBase(req, 24 * 60 * 60)}`;
  const refresh = `${AUTH_REFRESH_COOKIE}=${encodeURIComponent(input.refreshToken)}; ${cookieBase(req, 30 * 24 * 60 * 60)}`;
  appendSetCookie(res, session);
  appendSetCookie(res, refresh);
}

export function clearAuthCookies(req: http.IncomingMessage, res: http.ServerResponse): void {
  const expiredBase = [
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    String(req.headers['x-forwarded-proto'] || '').toLowerCase().includes('https') || process.env.NODE_ENV === 'production'
      ? 'Secure'
      : '',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ]
    .filter(Boolean)
    .join('; ');
  appendSetCookie(res, `${AUTH_SESSION_COOKIE}=; ${expiredBase}`);
  appendSetCookie(res, `${AUTH_REFRESH_COOKIE}=; ${expiredBase}`);
}

export function getSessionCookieToken(req: http.IncomingMessage): string {
  return String(parseCookies(req)[AUTH_SESSION_COOKIE] || '').trim();
}

export function getRefreshCookieToken(req: http.IncomingMessage): string {
  return String(parseCookies(req)[AUTH_REFRESH_COOKIE] || '').trim();
}
