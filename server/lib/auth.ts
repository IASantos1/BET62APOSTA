import type http from 'http';
import type pg from 'pg';

export type AuthedUser = {
  id: string;
  email: string;
  role: 'user' | 'admin';
  name?: string | null;
  kyc_verified?: boolean;
};

export function getBearerToken(req: http.IncomingMessage): string {
  const h = String(req.headers['authorization'] || '').trim();
  if (!h) return '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : '';
}

export async function requireUser(pool: pg.Pool, req: http.IncomingMessage): Promise<AuthedUser | null> {
  const token = getBearerToken(req);
  if (!token) return null;

  const now = Date.now();
  const row = await pool.query(
    `SELECT s.user_id, u.email, u.role, u.name, p.kyc_verified
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     LEFT JOIN profiles p ON p.user_id = u.id
     WHERE s.token = $1 AND s.expires_at > $2
     LIMIT 1`,
    [token, now],
  );
  const r = row.rows?.[0];
  if (!r) return null;
  return {
    id: String(r.user_id),
    email: String(r.email),
    role: (String(r.role) === 'admin' ? 'admin' : 'user') as any,
    name: r.name == null ? null : String(r.name),
    kyc_verified: r.kyc_verified == null ? undefined : Boolean(r.kyc_verified),
  };
}

export function isAdmin(u: AuthedUser | null): boolean {
  return !!u && u.role === 'admin';
}

