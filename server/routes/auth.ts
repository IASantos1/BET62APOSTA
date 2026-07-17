import type http from 'http';
import type pg from 'pg';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import { randomId, hashPassword, verifyPassword, sha256Hex, encryptText, decryptText } from '../lib/crypto';
import { readJsonBody, sendJson, badRequest, unauthorized } from '../lib/http';
import { getBearerToken, requireUser } from '../lib/auth';
import { APP_REFRESH_TOKENS_TABLE, APP_SESSIONS_TABLE, ensureAppAuthTables } from '../lib/appAuthTables';
import { hitRateLimit, clearRateLimit } from '../lib/rateLimit';
import { clearAuthCookies, getRefreshCookieToken, setAuthCookies } from '../lib/authCookies';

type SignUpBody = {
  email?: string;
  password?: string;
  firstName?: string;
  lastName?: string;
  dob?: string;
  country?: string;
  referralCode?: string;
};

type SignInBody = {
  username?: string;
  password?: string;
};

type RefreshBody = {
  refreshToken?: string;
};

type TwoFactorLoginBody = {
  userId?: string;
  token?: string;
};

type TwoFactorConfirmBody = {
  token?: string;
};

function ipOf(req: http.IncomingMessage): string {
  const raw = String(req.headers['x-forwarded-for'] || '').split(',')[0]?.trim();
  return raw || String(req.socket.remoteAddress || '');
}

function authRateLimit(
  res: http.ServerResponse,
  action: string,
  keys: string[],
  limit: number,
  windowMs: number,
): boolean {
  for (const key of keys) {
    const hit = hitRateLimit(`${action}:${key}`, limit, windowMs);
    if (!hit.allowed) {
      res.setHeader('retry-after', String(Math.max(1, Math.ceil(hit.retryAfterMs / 1000))));
      sendJson(res, 429, { error: 'Too many attempts. Try again later.' });
      return true;
    }
  }
  return false;
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

function colType(cols: ColInfo[], col: string): string {
  const c = String(col || '').toLowerCase();
  const hit = cols.find((x) => String(x.name || '').toLowerCase() === c);
  return String(hit?.dataType || '').toLowerCase();
}

function firstExistingCol(cols: ColInfo[], ...names: string[]): string {
  for (const name of names) {
    if (hasCol(cols, name)) return name;
  }
  return '';
}

function isNumericType(dataType: string): boolean {
  const t = String(dataType || '').toLowerCase();
  return t.includes('integer') || t.includes('bigint') || t.includes('smallint') || t.includes('numeric') || t.includes('decimal');
}

function verifyLegacyPassword(password: string, storedValue: string): boolean {
  const raw = String(storedValue || '').trim();
  if (!raw) return false;
  if (raw === password) return true;
  if (/^[a-f0-9]{64}$/i.test(raw)) return sha256Hex(password) === raw.toLowerCase();
  const parts = raw.split(':');
  if (parts.length === 2 && /^[a-f0-9]+$/i.test(parts[0]) && /^[a-f0-9]+$/i.test(parts[1])) {
    return verifyPassword(password, parts[1], parts[0]);
  }
  return false;
}

function buildLoginLookup(userCols: ColInfo[], identifier: string): { whereSql: string; params: string[]; aliasCol: string } {
  const loginCols = ['email', 'username'].filter((name) => hasCol(userCols, name));
  if (loginCols.length === 0) {
    throw new Error('No supported login column found in users table');
  }
  const normalized = String(identifier || '').trim().toLowerCase();
  const whereSql = loginCols
    .map((col, idx) => `LOWER(COALESCE(${col}, '')) = $${idx + 1}`)
    .join(' OR ');
  return {
    whereSql,
    params: loginCols.map(() => normalized),
    aliasCol: loginCols[0],
  };
}

async function createUserRecord(
  pool: pg.Pool,
  email: string,
  password: string,
  name: string | null,
): Promise<string> {
  const userCols = await getTableCols(pool, 'users').catch(() => []);
  const pw = hashPassword(password);
  const hashCombined = `${pw.saltHex}:${pw.hashHex}`;
  const cols: string[] = [];
  const values: any[] = [];
  const idCol = firstExistingCol(userCols, 'id');
  const idType = colType(userCols, idCol || 'id');
  const loginCol = firstExistingCol(userCols, 'email', 'username');

  const pushCol = (col: string, value: any) => {
    cols.push(col);
    values.push(value);
  };

  if (idCol && !isNumericType(idType)) {
    pushCol(idCol, randomId(12));
  }
  if (!loginCol) throw new Error('No supported login column found in users table');
  pushCol(loginCol, email);

  if (hasCol(userCols, 'password_hash') && hasCol(userCols, 'password_salt')) {
    pushCol('password_hash', pw.hashHex);
    pushCol('password_salt', pw.saltHex);
  } else {
    const singlePasswordCol = firstExistingCol(userCols, 'password_hash', 'hashed_password', 'password');
    if (!singlePasswordCol) throw new Error('No supported password column found in users table');
    pushCol(singlePasswordCol, hashCombined);
  }

  if (hasCol(userCols, 'role')) pushCol('role', 'user');
  if (hasCol(userCols, 'name')) pushCol('name', name);
  if (hasCol(userCols, 'username') && loginCol !== 'username') pushCol('username', email);

  const placeholders = cols.map((_, idx) => `$${idx + 1}`).join(', ');
  const inserted = await pool.query(
    `INSERT INTO users (${cols.join(', ')})
     VALUES (${placeholders})
     RETURNING ${idCol || 'id'} AS id`,
    values,
  );

  const returnedId = inserted.rows?.[0]?.id;
  if (returnedId == null) {
    throw new Error('Unable to determine inserted user id');
  }
  return String(returnedId);
}

async function createProfileRecord(
  pool: pg.Pool,
  userId: string,
  email: string,
  name: string | null,
  dob: string | null,
): Promise<void> {
  const profileCols = await getTableCols(pool, 'profiles').catch(() => []);
  if (profileCols.length === 0) return;

  const cols: string[] = [];
  const values: any[] = [];
  const pushCol = (col: string, value: any) => {
    cols.push(col);
    values.push(value);
  };

  const profileIdType = colType(profileCols, 'id');
  if (hasCol(profileCols, 'id') && !isNumericType(profileIdType)) pushCol('id', randomId(12));
  if (hasCol(profileCols, 'user_id')) pushCol('user_id', userId);
  if (hasCol(profileCols, 'email')) pushCol('email', email);
  if (hasCol(profileCols, 'full_name')) pushCol('full_name', name);
  if (hasCol(profileCols, 'name')) pushCol('name', name);
  if (hasCol(profileCols, 'birth_date')) pushCol('birth_date', dob);
  if (hasCol(profileCols, 'created_at')) pushCol('created_at', new Date().toISOString());
  if (hasCol(profileCols, 'updated_at')) pushCol('updated_at', new Date().toISOString());

  if (cols.length === 0) return;
  const placeholders = cols.map((_, idx) => `$${idx + 1}`).join(', ');
  try {
    await pool.query(
      `INSERT INTO profiles (${cols.join(', ')})
       VALUES (${placeholders})
       ON CONFLICT DO NOTHING`,
      values,
    );
  } catch (e: any) {
    console.warn('[auth] profile insert skipped:', String(e?.message || e));
  }
}

async function createUserNotification(
  pool: pg.Pool,
  userId: string,
  input: { kind?: string; title: string; body: string; cta_label?: string; cta_target?: string },
): Promise<void> {
  await pool.query(
    `INSERT INTO user_notifications (
       id, user_id, kind, title, body, cta_label, cta_target, is_read, created_at, updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE, NOW(), NOW())`,
    [
      randomId(16),
      userId,
      String(input.kind || 'system'),
      String(input.title || ''),
      String(input.body || ''),
      input.cta_label ? String(input.cta_label) : null,
      input.cta_target ? String(input.cta_target) : null,
    ],
  );
}

async function applyReferralOnSignup(
  pool: pg.Pool,
  newUserId: string,
  email: string,
  referralCode: string,
): Promise<void> {
  const code = String(referralCode || '').trim().toUpperCase();
  if (!code) return;

  const referrer = await pool.query(
    `SELECT user_id
     FROM profiles
     WHERE referral_code = $1
       AND user_id <> $2
     LIMIT 1`,
    [code, newUserId],
  );
  const referrerUserId = String(referrer.rows?.[0]?.user_id || '').trim();
  if (!referrerUserId) return;

  const existing = await pool.query(
    `SELECT 1
     FROM user_referrals
     WHERE referred_user_id = $1
        OR LOWER(COALESCE(referred_email, '')) = $2
     LIMIT 1`,
    [newUserId, String(email || '').trim().toLowerCase()],
  );
  if (existing.rows.length > 0) return;

  await pool.query(
    `INSERT INTO user_referrals (
       id, referrer_user_id, referred_user_id, referred_email, referral_code, reward_amount, status, rewarded_at, created_at, updated_at
     )
     VALUES ($1, $2, $3, $4, $5, 5, 'rewarded', NOW(), NOW(), NOW())`,
    [randomId(16), referrerUserId, newUserId, String(email || '').trim().toLowerCase(), code],
  );
  await pool.query(
    `UPDATE profiles
     SET free_bet_balance = COALESCE(free_bet_balance, 0) + 5,
         updated_at = NOW()
     WHERE user_id = ANY($1::text[])`,
    [[referrerUserId, newUserId]],
  );
  await createUserNotification(pool, referrerUserId, {
    kind: 'promo',
    title: 'Convite convertido',
    body: 'Recebeu 5€ em freebets por um amigo ter concluído o registo com o seu código.',
    cta_label: 'Abrir perfil',
    cta_target: '/profile?tab=Convida%20um%20amigo',
  });
  await createUserNotification(pool, newUserId, {
    kind: 'promo',
    title: 'Bónus de boas-vindas',
    body: 'Recebeu 5€ em freebets por se registar com um código de amigo.',
    cta_label: 'Ver saldo',
    cta_target: '/profile',
  });
}

async function loadUserForSignin(pool: pg.Pool, email: string): Promise<any | null> {
  const userCols = await getTableCols(pool, 'users').catch(() => []);
  const passwordCols = ['id'];
  if (hasCol(userCols, 'password_hash')) passwordCols.push('password_hash');
  if (hasCol(userCols, 'password_salt')) passwordCols.push('password_salt');
  if (hasCol(userCols, 'hashed_password')) passwordCols.push('hashed_password');
  if (hasCol(userCols, 'password')) passwordCols.push('password');
  const lookup = buildLoginLookup(userCols, email);
  passwordCols.push(`${lookup.aliasCol} AS email`);
  const r = await pool.query(
    `SELECT ${passwordCols.join(', ')} FROM users WHERE ${lookup.whereSql} LIMIT 1`,
    lookup.params,
  );
  return r.rows?.[0] || null;
}

function verifyUserPassword(password: string, row: any): boolean {
  const hash = String(row?.password_hash || '').trim();
  const salt = String(row?.password_salt || '').trim();
  if (hash && salt) return verifyPassword(password, hash, salt);
  return verifyLegacyPassword(
    password,
    String(row?.password_hash || row?.hashed_password || row?.password || ''),
  );
}

async function issueTokens(pool: pg.Pool, userId: string, req: http.IncomingMessage): Promise<{ token: string; refreshToken: string }> {
  await ensureAppAuthTables(pool);
  const token = randomId(24);
  const refreshToken = randomId(32);
  const now = Date.now();
  const expiresAtMs = now + 24 * 60 * 60 * 1000;
  const refreshExpiresAtMs = now + 30 * 24 * 60 * 60 * 1000;
  const tokenHash = sha256Hex(refreshToken);
  await pool.query(
    `INSERT INTO ${APP_SESSIONS_TABLE} (token, user_id, issued_at, expires_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (token) DO UPDATE
     SET user_id = EXCLUDED.user_id, issued_at = EXCLUDED.issued_at, expires_at = EXCLUDED.expires_at`,
    [token, userId, now, expiresAtMs],
  );
  await pool.query(
    `INSERT INTO ${APP_REFRESH_TOKENS_TABLE} (id, user_id, token_hash, expires_at, revoked, user_agent, ip)
     VALUES ($1, $2, $3, $4, FALSE, $5, $6)`,
    [randomId(16), userId, tokenHash, new Date(refreshExpiresAtMs).toISOString(), String(req.headers['user-agent'] || ''), ipOf(req)],
  );

  return { token, refreshToken };
}

async function isTwoFactorEnabled(pool: pg.Pool, userId: string): Promise<boolean> {
  try {
    const r = await pool.query(`SELECT enabled FROM user_two_factor WHERE user_id = $1 LIMIT 1`, [userId]);
    return Boolean(r.rows?.[0]?.enabled);
  } catch {
    return false;
  }
}

async function getTwoFactorSecret(pool: pg.Pool, userId: string): Promise<string | null> {
  try {
    const r = await pool.query(`SELECT secret FROM user_two_factor WHERE user_id = $1 LIMIT 1`, [userId]);
    const s = r.rows?.[0]?.secret;
    return s ? decryptText(String(s)) : null;
  } catch {
    return null;
  }
}

export async function handleAuthRoutes(
  pool: pg.Pool,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
): Promise<boolean> {
  const path = url.pathname;

  if (req.method === 'POST' && path === '/api/auth/signup') {
    try {
      const remoteIp = ipOf(req);
      if (authRateLimit(res, 'signup-ip', [remoteIp], 20, 10 * 60_000)) return true;
      const body = await readJsonBody<SignUpBody>(req, 32 * 1024).catch(() => null);
      if (!body) return badRequest(res, 'Invalid JSON'), true;
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      if (!email || password.length < 6) return badRequest(res, 'Invalid credentials'), true;
      if (authRateLimit(res, 'signup-email', [email], 8, 10 * 60_000)) return true;

      const userCols = await getTableCols(pool, 'users').catch(() => []);
      const lookup = buildLoginLookup(userCols, email);
      const exists = await pool.query(`SELECT 1 FROM users WHERE ${lookup.whereSql} LIMIT 1`, lookup.params);
      if (exists.rows.length > 0) return sendJson(res, 409, { error: 'Email already exists' }), true;

      const name = `${String(body.firstName || '').trim()} ${String(body.lastName || '').trim()}`.trim();
      const userId = await createUserRecord(pool, email, password, name || null);
      await createProfileRecord(pool, userId, email, name || null, body.dob || null);
      await applyReferralOnSignup(pool, userId, email, body.referralCode || '');

      const tokens = await issueTokens(pool, userId, req);
      setAuthCookies(req, res, tokens);
      sendJson(res, 200, { token: tokens.token, refreshToken: tokens.refreshToken });
      return true;
    } catch (e: any) {
      sendJson(res, 500, { error: 'Signup failed', details: String(e?.message || e) });
      return true;
    }
  }

  if (req.method === 'POST' && path === '/api/auth/signin') {
    try {
      const remoteIp = ipOf(req);
      const body = await readJsonBody<SignInBody>(req, 16 * 1024).catch(() => null);
      if (!body) return badRequest(res, 'Invalid JSON'), true;
      const email = String(body.username || '').trim().toLowerCase();
      const password = String(body.password || '');
      if (!email || !password) return badRequest(res, 'Invalid credentials'), true;
      if (authRateLimit(res, 'signin', [remoteIp, email], 10, 15 * 60_000)) return true;

      const u = await loadUserForSignin(pool, email);
      if (!u) return unauthorized(res), true;
      if (!verifyUserPassword(password, u)) return unauthorized(res), true;
      clearRateLimit(`signin:${remoteIp}`);
      clearRateLimit(`signin:${email}`);

      const enabled = await isTwoFactorEnabled(pool, String(u.id));
      if (enabled) {
        sendJson(res, 200, { requires2fa: true, userId: String(u.id) });
        return true;
      }

      const tokens = await issueTokens(pool, String(u.id), req);
      setAuthCookies(req, res, tokens);
      sendJson(res, 200, { token: tokens.token, refreshToken: tokens.refreshToken });
      return true;
    } catch (e: any) {
      sendJson(res, 500, { error: 'Signin failed', details: String(e?.message || e) });
      return true;
    }
  }

  if (req.method === 'POST' && path === '/api/auth/refresh') {
    const remoteIp = ipOf(req);
    if (authRateLimit(res, 'refresh-ip', [remoteIp], 20, 15 * 60_000)) return true;
    const body = await readJsonBody<RefreshBody>(req, 16 * 1024).catch(() => ({} as RefreshBody));
    const refreshToken = String(body.refreshToken || getRefreshCookieToken(req) || '').trim();
    if (!refreshToken) return unauthorized(res), true;

    try {
      await ensureAppAuthTables(pool);
      const tokenHash = sha256Hex(refreshToken);
      const r = await pool.query(
        `SELECT id, user_id, expires_at, revoked
         FROM ${APP_REFRESH_TOKENS_TABLE}
         WHERE token_hash = $1
         LIMIT 1`,
        [tokenHash],
      );
      const row = r.rows?.[0];
      if (!row) return unauthorized(res), true;
      if (row.revoked) return unauthorized(res), true;
      const exp = new Date(row.expires_at).getTime();
      if (!Number.isFinite(exp) || exp < Date.now()) return unauthorized(res), true;

      await pool.query(`UPDATE ${APP_REFRESH_TOKENS_TABLE} SET revoked = TRUE WHERE id = $1`, [String(row.id)]);
      const tokens = await issueTokens(pool, String(row.user_id), req);
      setAuthCookies(req, res, tokens);
      sendJson(res, 200, { token: tokens.token, refreshToken: tokens.refreshToken });
      return true;
    } catch (e: any) {
      sendJson(res, 500, { error: 'Refresh failed', details: String(e?.message || e) });
      return true;
    }
  }

  if (req.method === 'POST' && path === '/api/auth/logout') {
    const token = getBearerToken(req);
    const user = token ? await requireUser(pool, req).catch(() => null) : null;
    if (token) {
      await ensureAppAuthTables(pool).catch(() => null);
      await pool.query(`DELETE FROM ${APP_SESSIONS_TABLE} WHERE token = $1`, [token]).catch(() => null);
    }
    if (user?.id) {
      await ensureAppAuthTables(pool).catch(() => null);
      await pool.query(
        `UPDATE ${APP_REFRESH_TOKENS_TABLE}
         SET revoked = TRUE
         WHERE user_id = $1 AND revoked = FALSE`,
        [user.id],
      ).catch(() => null);
    }
    clearAuthCookies(req, res);
    sendJson(res, 200, { success: true });
    return true;
  }

  if (req.method === 'GET' && path === '/api/auth/me') {
    const u = await requireUser(pool, req);
    if (!u) {
      sendJson(res, 200, { user: null });
      return true;
    }
    const kyc = u.kyc_verified ? 'verified' : 'unverified';
    sendJson(res, 200, {
      user: {
        userId: u.id,
        username: u.email,
        is_operator: u.role === 'admin' ? 1 : 0,
        kyc_status: kyc,
      },
    });
    return true;
  }

  if (req.method === 'GET' && path === '/api/auth/2fa/status') {
    const u = await requireUser(pool, req);
    if (!u) return unauthorized(res), true;
    const enabled = await isTwoFactorEnabled(pool, u.id);
    sendJson(res, 200, { enabled });
    return true;
  }

  if (req.method === 'POST' && path === '/api/auth/2fa/setup') {
    const u = await requireUser(pool, req);
    if (!u) return unauthorized(res), true;

    const secret = authenticator.generateSecret();
    const secretCipher = encryptText(secret);
    await pool.query(
      `INSERT INTO user_two_factor (user_id, secret, enabled)
       VALUES ($1, $2, FALSE)
       ON CONFLICT (user_id) DO UPDATE SET secret = EXCLUDED.secret, enabled = FALSE, updated_at = NOW()`,
      [u.id, secretCipher],
    );

    const label = encodeURIComponent(String(u.email || 'user'));
    const issuer = encodeURIComponent('BET62');
    const otpauth = authenticator.keyuri(label, issuer, secret);
    const qrCode = await QRCode.toDataURL(otpauth);

    sendJson(res, 200, { success: true, qrCode });
    return true;
  }

  if (req.method === 'POST' && path === '/api/auth/2fa/confirm') {
    const u = await requireUser(pool, req);
    if (!u) return unauthorized(res), true;
    if (authRateLimit(res, '2fa-confirm', [u.id, ipOf(req)], 8, 10 * 60_000)) return true;
    const body = await readJsonBody<TwoFactorConfirmBody>(req, 8 * 1024).catch(() => null);
    if (!body) return badRequest(res, 'Invalid JSON'), true;
    const token = String(body.token || '').trim();
    if (!/^\d{6}$/.test(token)) return badRequest(res, 'Invalid token'), true;
    const secret = await getTwoFactorSecret(pool, u.id);
    if (!secret) return badRequest(res, '2FA not initialized'), true;
    const ok = authenticator.check(token, secret);
    if (!ok) return sendJson(res, 200, { success: false }), true;

    await pool.query(`UPDATE user_two_factor SET enabled = TRUE, updated_at = NOW() WHERE user_id = $1`, [u.id]);
    sendJson(res, 200, { success: true });
    return true;
  }

  if (req.method === 'POST' && path === '/api/auth/2fa/login') {
    const remoteIp = ipOf(req);
    const body = await readJsonBody<TwoFactorLoginBody>(req, 8 * 1024).catch(() => null);
    if (!body) return badRequest(res, 'Invalid JSON'), true;
    const userId = String(body.userId || '').trim();
    const token = String(body.token || '').trim();
    if (!userId || !/^\d{6}$/.test(token)) return unauthorized(res), true;
    if (authRateLimit(res, '2fa-login', [remoteIp, userId], 10, 10 * 60_000)) return true;

    const secret = await getTwoFactorSecret(pool, userId);
    if (!secret) return unauthorized(res), true;
    const enabled = await isTwoFactorEnabled(pool, userId);
    if (!enabled) return unauthorized(res), true;
    const ok = authenticator.check(token, secret);
    if (!ok) return sendJson(res, 200, { success: false }), true;
    clearRateLimit(`2fa-login:${remoteIp}`);
    clearRateLimit(`2fa-login:${userId}`);

    const tokens = await issueTokens(pool, userId, req);
    setAuthCookies(req, res, tokens);
    sendJson(res, 200, { success: true, token: tokens.token, refreshToken: tokens.refreshToken });
    return true;
  }

  return false;
}
