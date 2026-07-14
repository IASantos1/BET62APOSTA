import type http from 'http';
import type pg from 'pg';

export type AuthedUser = {
  id: string;
  email: string;
  role: 'user' | 'admin';
  name?: string | null;
  kyc_verified?: boolean;
};

const APP_SESSIONS_TABLE = 'bet62_sessions';

export function getBearerToken(req: http.IncomingMessage): string {
  const h = String(req.headers['authorization'] || '').trim();
  if (!h) return '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : '';
}

type SessionExpiresMode = 'ms' | 'ts';
let __sessions_expires_mode: SessionExpiresMode | null = null;
let __app_sessions_ready = false;

async function detectSessionsExpiresMode(pool: pg.Pool): Promise<SessionExpiresMode> {
  if (__sessions_expires_mode) return __sessions_expires_mode;
  try {
    const r = await pool.query(
      `SELECT data_type
       FROM information_schema.columns
       WHERE table_name = 'sessions' AND column_name = 'expires_at'
       LIMIT 1`,
    );
    const t = String(r.rows?.[0]?.data_type || '').toLowerCase();
    __sessions_expires_mode = t.includes('timestamp') || t.includes('date') ? 'ts' : 'ms';
  } catch {
    __sessions_expires_mode = 'ms';
  }
  return __sessions_expires_mode;
}

async function ensureAppSessionsTable(pool: pg.Pool): Promise<void> {
  if (__app_sessions_ready) return;
  await pool.query(
    `CREATE TABLE IF NOT EXISTS ${APP_SESSIONS_TABLE} (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      issued_at BIGINT NOT NULL,
      expires_at BIGINT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
  );
  __app_sessions_ready = true;
}

type ColInfo = { name: string; dataType: string };
const __tableCols = new Map<string, ColInfo[]>();

async function getTableCols(pool: pg.Pool, tableName: string): Promise<ColInfo[]> {
  const key = String(tableName || '').toLowerCase();
  const cached = __tableCols.get(key);
  if (cached) return cached;
  const r = await pool.query(
    `SELECT column_name, data_type
     FROM information_schema.columns
     WHERE table_name = $1`,
    [key],
  );
  const cols = (r.rows || []).map((x: any) => ({
    name: String(x.column_name || ''),
    dataType: String(x.data_type || ''),
  }));
  __tableCols.set(key, cols);
  return cols;
}

function hasCol(cols: ColInfo[], col: string): boolean {
  const c = String(col || '').toLowerCase();
  return cols.some((x) => String(x.name || '').toLowerCase() === c);
}

function firstExistingCol(cols: ColInfo[], ...names: string[]): string {
  for (const name of names) {
    if (hasCol(cols, name)) return name;
  }
  return '';
}

async function loadUserById(pool: pg.Pool, userId: string): Promise<AuthedUser | null> {
  const userCols = await getTableCols(pool, 'users').catch(() => []);
  if (userCols.length === 0) return null;

  const emailCol = firstExistingCol(userCols, 'email', 'username');
  const roleCol = firstExistingCol(userCols, 'role');
  const nameCol = firstExistingCol(userCols, 'name');
  const selects = ['id'];
  if (emailCol) selects.push(`${emailCol} AS email`);
  if (roleCol) selects.push(`${roleCol} AS role`);
  if (nameCol) selects.push(`${nameCol} AS name`);
  const userRes = await pool.query(
    `SELECT ${selects.join(', ')} FROM users WHERE id = $1 LIMIT 1`,
    [userId],
  );
  const user = userRes.rows?.[0];
  if (!user) return null;

  let kycVerified: boolean | undefined;
  try {
    const profileCols = await getTableCols(pool, 'profiles');
    if (hasCol(profileCols, 'user_id') && hasCol(profileCols, 'kyc_verified')) {
      const p = await pool.query(`SELECT kyc_verified FROM profiles WHERE user_id = $1 LIMIT 1`, [userId]);
      if (p.rows?.[0]?.kyc_verified != null) kycVerified = Boolean(p.rows[0].kyc_verified);
    }
  } catch {
    void 0;
  }

  return {
    id: String(user.id),
    email: String(user.email || userId),
    role: String(user.role) === 'admin' ? 'admin' : 'user',
    name: user.name == null ? null : String(user.name),
    kyc_verified: kycVerified,
  };
}

export async function requireUser(pool: pg.Pool, req: http.IncomingMessage): Promise<AuthedUser | null> {
  const token = getBearerToken(req);
  if (!token) return null;

  try {
    await ensureAppSessionsTable(pool);
    const appSession = await pool.query(
      `SELECT user_id
       FROM ${APP_SESSIONS_TABLE}
       WHERE token = $1 AND expires_at > $2
       LIMIT 1`,
      [token, Date.now()],
    );
    const appUserId = appSession.rows?.[0]?.user_id;
    if (appUserId != null) {
      const user = await loadUserById(pool, String(appUserId));
      if (user) return user;
    }
  } catch {
    void 0;
  }

  const mode = await detectSessionsExpiresMode(pool);
  try {
    const row =
      mode === 'ts'
        ? await pool.query(
            `SELECT s.user_id, u.email, u.role, u.name, p.kyc_verified
             FROM sessions s
             JOIN users u ON u.id = s.user_id
             LEFT JOIN profiles p ON p.user_id = u.id
             WHERE s.token = $1 AND s.expires_at > NOW()
             LIMIT 1`,
            [token],
          )
        : await pool.query(
            `SELECT s.user_id, u.email, u.role, u.name, p.kyc_verified
             FROM sessions s
             JOIN users u ON u.id = s.user_id
             LEFT JOIN profiles p ON p.user_id = u.id
             WHERE s.token = $1 AND s.expires_at > $2
             LIMIT 1`,
            [token, Date.now()],
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
  } catch {
    return null;
  }
}

export function isAdmin(u: AuthedUser | null): boolean {
  return !!u && u.role === 'admin';
}
