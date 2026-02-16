import http from 'http';
import https from 'https';
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

const PORT = Number(process.env.API_PORT || 4000);

type User = {
  id: string;
  email: string;
  password_hash: string;
  password_salt: string;
  role: 'user' | 'admin';
  name?: string;
};

type Session = {
  token: string;
  userId: string;
  issuedAt: number;
  expiresAt: number;
};

type AuditLog = {
  id: string;
  time: string;
  ip: string;
  action: 'signup' | 'login' | 'verify_request' | 'verify_complete' | 'password_reset_request' | 'password_reset_complete';
  email: string;
  userId?: string;
  success: boolean;
};
const users = new Map<string, User>();
const sessions = new Map<string, Session>();
const walletBalances = new Map<string, { balance: number }>();
const profiles = new Map<
  string,
  {
    id: string;
    user_id: string;
    email: string;
    full_name?: string;
    name?: string;
    phone?: string;
    balance: number;
    free_bet_balance?: number;
    is_admin?: boolean;
    status?: string;
    kyc_verified?: boolean;
    email_verified?: boolean;
    birth_date?: string;
    created_at: string;
    updated_at?: string;
    self_exclusion_until?: string;
    cooling_off_until?: string;
    limits?: Record<string, number>;
    saved_iban?: string;
    saved_account_holder?: string;
    self_exclusion_reason?: string;
  }
>();
const kycDocuments: {
  id: string;
  user_id: string;
  document_type: 'id_front' | 'id_back' | 'proof_address' | 'selfie';
  file_name: string;
  file_url: string;
  status: 'pending' | 'approved' | 'rejected';
  uploaded_at: string;
  rejection_reason?: string;
}[] = [];
const transactionsStore: {
  id: string;
  user_id: string;
  type: 'deposit' | 'withdrawal' | 'bet' | 'win' | 'cashout';
  amount: number;
  status: 'pending' | 'completed' | 'failed' | 'cancelled';
  payment_method?: string;
  description?: string;
  external_id?: string;
  stripe_session_id?: string;
  completed_at?: string;
  created_at: string;
  updated_at: string;
}[] = [];
const betsStore: {
  id: string;
  user_id: string;
  bet_type: 'single' | 'multiple' | 'system';
  stake: number;
  potential_win: number;
  total_odds: number;
  status: 'pending' | 'won' | 'lost' | 'cashout' | 'void';
  is_free_bet: boolean;
  winnings?: number | null;
  created_at: string;
  selections?: any[];
  total_stake?: number;
  potential_return?: number;
  cashout_value?: number;
  cashout_at?: string;
  settled_at?: string;
}[] = [];

interface UserStakeLimits {
  user_id: string;
  max_stake_per_bet: number;
  max_payout: number;
}

const userStakeLimitsStore: UserStakeLimits[] = [];
const matchesStore: {
  id: string;
  sport: string;
  league: string;
  home_team: string;
  away_team: string;
  start_time: string;
  status: 'scheduled' | 'live' | 'finished' | 'cancelled';
  home_score: number | null;
  away_score: number | null;
  created_at: string;
}[] = [];
const promotionsStore: {
  id: string;
  title: string;
  description: string;
  type: 'deposit_bonus' | 'free_bet' | 'cashback' | 'welcome_bonus' | string;
  value: number;
  min_deposit: number;
  max_bonus: number;
  valid_from: string;
  valid_until: string;
  is_active: boolean;
  terms: string;
  created_at: string;
}[] = [];
const auditLogs: AuditLog[] = [];
type RefreshToken = {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
  revoked: boolean;
  userAgent?: string;
  ip?: string;
};
const refreshTokens = new Map<string, RefreshToken>();
const userRefreshIndex = new Map<string, Set<string>>();
type VerificationRequest = {
  email: string;
  userId: string;
  codeHash: string;
  codeSalt: string;
  expiresAt: number;
  attempts: number;
  sentAt: number;
};
type PasswordResetRequest = {
  email: string;
  userId: string;
  codeHash: string;
  codeSalt: string;
  expiresAt: number;
  attempts: number;
  sentAt: number;
};
const verificationRequests = new Map<string, VerificationRequest>();
const passwordResetRequests = new Map<string, PasswordResetRequest>();
const paymentSettingsStore: {
  id: number;
  paypal_enabled: boolean;
  paypal_mode: 'sandbox' | 'live';
  created_at: string;
  updated_at: string;
}[] = [
  {
    id: 1,
    paypal_enabled: true,
    paypal_mode: 'sandbox',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];
const selfExclusionStore: {
  id: string;
  user_id: string;
  type: 'temporary' | 'permanent';
  duration_days?: number;
  start_date: string;
  end_date?: string;
  reason?: string;
  status: 'active' | 'completed' | 'cancelled';
  created_at: string;
}[] = [];

const apiFootballKey =
  process.env.API_FOOTBALL_KEY ||
  process.env.VITE_API_FOOTBALL_KEY ||
  process.env.API_FOOTBALL_KEY_ALT ||
  '';

const apiFootballEndpoints: Record<string, string> = {
  football: 'https://v3.football.api-sports.io',
  basketball: 'https://v1.basketball.api-sports.io',
  baseball: 'https://v1.baseball.api-sports.io',
  hockey: 'https://v1.hockey.api-sports.io',
  rugby: 'https://v1.rugby.api-sports.io',
  volleyball: 'https://v1.volleyball.api-sports.io',
  formula1: 'https://v1.formula-1.api-sports.io',
  mma: 'https://v1.mma.api-sports.io',
  handball: 'https://v1.handball.api-sports.io',
  nfl: 'https://v1.american-football.api-sports.io',
  afl: 'https://v1.afl.api-sports.io',
};

const apiFootballRateLimit: Record<string, { count: number; resetTime: number }> = {};

function checkApiFootballRateLimit(sport: string): { allowed: boolean; remaining: number; resetIn: number } {
  const now = Date.now();
  const LIMIT_PER_MINUTE = 1200;
  const WINDOW_MS = 60 * 1000;

  if (!apiFootballRateLimit[sport]) {
    apiFootballRateLimit[sport] = {
      count: 0,
      resetTime: now + WINDOW_MS,
    };
  }

  const limiter = apiFootballRateLimit[sport];

  if (now >= limiter.resetTime) {
    limiter.count = 0;
    limiter.resetTime = now + WINDOW_MS;
  }

  if (limiter.count >= LIMIT_PER_MINUTE) {
    const resetIn = Math.ceil((limiter.resetTime - now) / 1000);
    return {
      allowed: false,
      remaining: 0,
      resetIn,
    };
  }

  limiter.count++;

  return {
    allowed: true,
    remaining: LIMIT_PER_MINUTE - limiter.count,
    resetIn: Math.ceil((limiter.resetTime - now) / 1000),
  };
}

function sendJson(res: http.ServerResponse, status: number, data: any) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': process.env.CLIENT_ORIGIN || 'http://localhost:5173',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Credentials': 'true',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'no-referrer',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'Content-Security-Policy':
      "default-src 'none'; connect-src 'self' http://localhost:5173 http://localhost:4000 ws:; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; font-src 'self' data:",
  });
  res.end(JSON.stringify(data));
}

function parseBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve({});
      }
    });
  });
}

function getAuthToken(req: http.IncomingMessage): string | null {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return null;
  }
  return auth.substring('Bearer '.length);
}

function getUserFromRequest(req: http.IncomingMessage): User | null {
  const token = getAuthToken(req);
  if (!token) {
    return null;
  }
  const session = sessions.get(token);
  if (!session) {
    return null;
  }
  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  const user = users.get(session.userId);
  return user || null;
}

function logAudit(
  action:
    | 'signup'
    | 'login'
    | 'verify_request'
    | 'verify_complete'
    | 'password_reset_request'
    | 'password_reset_complete',
  ip: string,
  email: string,
  success: boolean,
  userId?: string
) {
  auditLogs.push({
    id: randomBytes(8).toString('hex'),
    time: new Date().toISOString(),
    ip,
    action,
    email,
    userId,
    success,
  });
}

function hashPassword(password: string, saltHex?: string): { hashHex: string; saltHex: string } {
  const salt = saltHex ? Buffer.from(saltHex, 'hex') : randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return { hashHex: hash.toString('hex'), saltHex: salt.toString('hex') };
}

function verifyPassword(password: string, saltHex: string, hashHex: string): boolean {
  const salt = Buffer.from(saltHex, 'hex');
  const hash = Buffer.from(hashHex, 'hex');
  const candidate = scryptSync(password, salt, 64);
  try {
    return timingSafeEqual(candidate, hash);
  } catch {
    return false;
  }
}

const loginAttempts = new Map<
  string,
  { count: number; firstAttemptAt: number; lockUntil: number }
>();

function isValidEmail(email: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
}

function isStrongPassword(pw: string): boolean {
  if (pw.length < 8) return false;
  const hasLetter = /[A-Za-z]/.test(pw);
  const hasNumber = /[0-9]/.test(pw);
  return hasLetter && hasNumber;
}

function parseAmount(value: any): number {
  const n = Number(value);
  if (!isFinite(n)) return 0;
  return n;
}

function setCookie(res: http.ServerResponse, name: string, value: string, maxAgeSeconds: number) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  const cookie = `${name}=${value}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
  const existing = res.getHeader('Set-Cookie');
  if (!existing) {
    res.setHeader('Set-Cookie', cookie);
  } else if (Array.isArray(existing)) {
    res.setHeader('Set-Cookie', [...existing, cookie]);
  } else {
    res.setHeader('Set-Cookie', [String(existing), cookie]);
  }
}

function clearCookie(res: http.ServerResponse, name: string) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  const cookie = `${name}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure}`;
  res.setHeader('Set-Cookie', cookie);
}

function getCookie(req: http.IncomingMessage, name: string): string | null {
  const raw = req.headers.cookie || '';
  const parts = raw.split(';').map((p) => p.trim());
  for (const p of parts) {
    if (p.startsWith(name + '=')) {
      return p.substring(name.length + 1);
    }
  }
  return null;
}

function hashToken(token: string): string {
  const buf = scryptSync(token, Buffer.from('rf'), 32);
  return buf.toString('hex');
}
async function seedAdmin(): Promise<void> {
  for (const u of users.values()) {
    if (u.role === 'admin') {
      return;
    }
  }
  const email = (process.env.ADMIN_EMAIL || 'admin@platform.local').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || 'Admin123!';
  const name = process.env.ADMIN_NAME || 'Platform Admin';
  if (!isValidEmail(email)) {
    return;
  }
  const { hashHex, saltHex } = hashPassword(password);
  const id = randomBytes(16).toString('hex');
  const user: User = {
    id,
    email,
    password_hash: hashHex,
    password_salt: saltHex,
    role: 'admin',
    name,
  };
  users.set(id, user);
  walletBalances.set(id, { balance: 1000 });
  const now = new Date().toISOString();
  profiles.set(id, {
    id,
    user_id: id,
    email,
    full_name: name,
    name,
    phone: '',
    balance: 1000,
    free_bet_balance: 0,
    is_admin: true,
    status: 'active',
    kyc_verified: false,
    email_verified: true,
    created_at: now,
  });
  console.log(`Seeded admin user ${email}`);
}
const server = http.createServer(async (req, res) => {
  if (!req.url) {
    sendJson(res, 404, { error: 'Not found' });
    return;
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(200, {
      'Access-Control-Allow-Origin': process.env.CLIENT_ORIGIN || 'http://localhost:5173',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Credentials': 'true',
    });
    res.end();
    return;
  }

  if (req.url === '/health' && req.method === 'GET') {
    sendJson(res, 200, { status: 'ok' });
    return;
  }

  if (req.url.startsWith('/sports/api-football-proxy') && req.method === 'GET') {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const sport = url.searchParams.get('sport');
    const endpoint = url.searchParams.get('endpoint');

    if (!sport || !endpoint) {
      sendJson(res, 400, { error: 'Parâmetros sport e endpoint são obrigatórios' });
      return;
    }

    const baseUrl = apiFootballEndpoints[sport];
    if (!baseUrl) {
      sendJson(res, 400, { error: `Desporto não suportado: ${sport}` });
      return;
    }

    if (!apiFootballKey) {
      sendJson(res, 500, { error: 'API_FOOTBALL_KEY não configurada' });
      return;
    }

    const rateLimit = checkApiFootballRateLimit(sport);
    if (!rateLimit.allowed) {
      sendJson(res, 429, {
        error: 'Rate limit excedido',
        sport,
        message: `Limite de 1200 requisições/minuto para ${sport} excedido`,
        resetIn: rateLimit.resetIn,
      });
      return;
    }

    const apiUrl = new URL(`${baseUrl}/${endpoint}`);
    url.searchParams.forEach((value, key) => {
      if (key !== 'sport' && key !== 'endpoint') {
        apiUrl.searchParams.append(key, value);
      }
    });

    const requestOptions: https.RequestOptions = {
      method: 'GET',
      headers: {
        'x-apisports-key': apiFootballKey,
      },
    };

    const client = apiUrl.protocol === 'https:' ? https : http;

    const externalReq = client.request(apiUrl.toString(), requestOptions, (externalRes) => {
      const chunks: Buffer[] = [];
      externalRes.on('data', (chunk) => chunks.push(chunk));
      externalRes.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        try {
          const data = raw ? JSON.parse(raw) : {};
          if (data.errors && Object.keys(data.errors).length > 0) {
            sendJson(res, 400, { error: 'API-Football retornou erro', details: data.errors });
            return;
          }
          sendJson(res, 200, data);
        } catch {
          sendJson(res, 502, { error: 'Resposta inválida da API-Football' });
        }
      });
    });

    externalReq.on('error', (err) => {
      sendJson(res, 502, { error: 'Erro ao chamar API-Football', details: String(err) });
    });

    externalReq.end();
    return;
  }

  if (req.url === '/odds/sports' && req.method === 'GET') {
    const sports = [
      {
        key: 'soccer_portugal_primeira_liga',
        group: 'soccer',
        title: 'Primeira Liga Portugal',
        description: 'Liga principal de futebol em Portugal',
        active: true,
        has_outrights: false,
      },
      {
        key: 'soccer_epl',
        group: 'soccer',
        title: 'Premier League',
        description: 'Liga principal de futebol em Inglaterra',
        active: true,
        has_outrights: false,
      },
      {
        key: 'soccer_spain_la_liga',
        group: 'soccer',
        title: 'La Liga',
        description: 'Liga principal de futebol em Espanha',
        active: true,
        has_outrights: false,
      },
      {
        key: 'basketball_nba',
        group: 'basketball',
        title: 'NBA',
        description: 'Liga profissional de basquetebol dos EUA',
        active: true,
        has_outrights: false,
      },
      {
        key: 'icehockey_nhl',
        group: 'icehockey',
        title: 'NHL',
        description: 'Liga principal de hóquei no gelo na América do Norte',
        active: true,
        has_outrights: false,
      },
    ];

    sendJson(res, 200, sports);
    return;
  }

  if (req.url === '/auth/session' && req.method === 'GET') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 200, { user: null });
      return;
    }
    const { password_hash: _, password_salt: __, ...safeUser } = user;
    sendJson(res, 200, { user: safeUser });
    return;
  }

  if (req.url === '/auth/signup' && req.method === 'POST') {
    const body = await parseBody(req);
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const name = body.name ? String(body.name) : undefined;

    if (!email || !password) {
      sendJson(res, 400, { error: 'Email e password são obrigatórios' });
      return;
    }
    if (!isValidEmail(email)) {
      logAudit('signup', req.socket.remoteAddress || 'unknown', email, false);
      sendJson(res, 400, { error: 'Email inválido' });
      return;
    }
    if (!isStrongPassword(password)) {
      logAudit('signup', req.socket.remoteAddress || 'unknown', email, false);
      sendJson(res, 400, { error: 'Password fraca. Use 8+ caracteres com letras e números.' });
      return;
    }
    if (name && name.length > 80) {
      logAudit('signup', req.socket.remoteAddress || 'unknown', email, false);
      sendJson(res, 400, { error: 'Nome demasiado longo' });
      return;
    }

    for (const user of users.values()) {
      if (user.email === email) {
        logAudit('signup', req.socket.remoteAddress || 'unknown', email, false);
        sendJson(res, 400, { error: 'Este email já está registado. Tente fazer login.' });
        return;
      }
    }

    const id = randomBytes(16).toString('hex');
    const { hashHex, saltHex } = hashPassword(password);
    const user: User = {
      id,
      email,
      password_hash: hashHex,
      password_salt: saltHex,
      role: 'user',
      name,
    };
    users.set(id, user);
    walletBalances.set(id, { balance: 0 });

    const createdAt = new Date().toISOString();
    profiles.set(id, {
      id,
      user_id: id,
      email,
      full_name: name || '',
      name,
      phone: '',
      balance: 0,
      free_bet_balance: 0,
      is_admin: false,
      status: 'active',
      kyc_verified: false,
      email_verified: false,
      created_at: createdAt,
    });

    const token = randomBytes(24).toString('hex');
    const nowMs = Date.now();
    const ttlMs = 15 * 60 * 1000;
    sessions.set(token, { token, userId: id, issuedAt: nowMs, expiresAt: nowMs + ttlMs });
    const rtVal = randomBytes(32).toString('hex');
    const rtId = randomBytes(8).toString('hex');
    const rt: RefreshToken = {
      id: rtId,
      userId: id,
      tokenHash: hashToken(rtVal),
      createdAt: new Date(nowMs).toISOString(),
      expiresAt: new Date(nowMs + 7 * 24 * 60 * 60 * 1000).toISOString(),
      revoked: false,
      userAgent: String(req.headers['user-agent'] || ''),
      ip: String(req.socket.remoteAddress || ''),
    };
    refreshTokens.set(rtId, rt);
    const idx = userRefreshIndex.get(id) || new Set<string>();
    idx.add(rtId);
    userRefreshIndex.set(id, idx);
    setCookie(res, 'refresh_token', `${rtId}:${rtVal}`, 7 * 24 * 60 * 60);

    const { password_hash: ___, password_salt: ____, ...safeUser } = user;
    sendJson(res, 200, { token, user: safeUser });
    logAudit('signup', req.socket.remoteAddress || 'unknown', email, true, id);
    return;
  }

  if (req.url === '/auth/login' && req.method === 'POST') {
    const body = await parseBody(req);
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');

    if (!email || !password) {
      sendJson(res, 400, { error: 'Email e password são obrigatórios' });
      return;
    }

    const ip = req.socket.remoteAddress || 'unknown';
    const attempt = loginAttempts.get(ip) || { count: 0, firstAttemptAt: 0, lockUntil: 0 };
    const nowMs = Date.now();
    if (attempt.lockUntil && nowMs < attempt.lockUntil) {
      sendJson(res, 429, { error: 'Muitas tentativas. Tente mais tarde.' });
      return;
    }

    let found: User | null = null;
    for (const user of users.values()) {
      if (user.email === email) {
        found = user;
        break;
      }
    }

    if (!found) {
      attempt.count = attempt.firstAttemptAt && nowMs - attempt.firstAttemptAt < 10 * 60 * 1000
        ? attempt.count + 1
        : 1;
      attempt.firstAttemptAt = attempt.firstAttemptAt && nowMs - attempt.firstAttemptAt < 10 * 60 * 1000
        ? attempt.firstAttemptAt
        : nowMs;
      if (attempt.count >= 5) {
        attempt.lockUntil = nowMs + 15 * 60 * 1000;
      }
      loginAttempts.set(ip, attempt);
      logAudit('login', ip, email, false);
      sendJson(res, 400, { error: 'Email ou senha incorretos' });
      return;
    }

    const valid = verifyPassword(password, found.password_salt, found.password_hash);
    if (!valid) {
      attempt.count = attempt.firstAttemptAt && nowMs - attempt.firstAttemptAt < 10 * 60 * 1000
        ? attempt.count + 1
        : 1;
      attempt.firstAttemptAt = attempt.firstAttemptAt && nowMs - attempt.firstAttemptAt < 10 * 60 * 1000
        ? attempt.firstAttemptAt
        : nowMs;
      if (attempt.count >= 5) {
        attempt.lockUntil = nowMs + 15 * 60 * 1000;
      }
      loginAttempts.set(ip, attempt);
      logAudit('login', ip, email, false, found.id);
      sendJson(res, 400, { error: 'Email ou senha incorretos' });
      return;
    }

    loginAttempts.delete(ip);

    const token = randomBytes(24).toString('hex');
    const ttlMs = 15 * 60 * 1000;
    sessions.set(token, { token, userId: found.id, issuedAt: nowMs, expiresAt: nowMs + ttlMs });
    const rtVal = randomBytes(32).toString('hex');
    const rtId = randomBytes(8).toString('hex');
    const rt: RefreshToken = {
      id: rtId,
      userId: found.id,
      tokenHash: hashToken(rtVal),
      createdAt: new Date(nowMs).toISOString(),
      expiresAt: new Date(nowMs + 7 * 24 * 60 * 60 * 1000).toISOString(),
      revoked: false,
      userAgent: String(req.headers['user-agent'] || ''),
      ip: String(req.socket.remoteAddress || ''),
    };
    refreshTokens.set(rtId, rt);
    const idx = userRefreshIndex.get(found.id) || new Set<string>();
    idx.add(rtId);
    userRefreshIndex.set(found.id, idx);
    setCookie(res, 'refresh_token', `${rtId}:${rtVal}`, 7 * 24 * 60 * 60);

    const { password_hash: ___, password_salt: ____, ...safeUser } = found;
    sendJson(res, 200, { token, user: safeUser });
    logAudit('login', ip, email, true, found.id);
    return;
  }

  if (req.url === '/auth/logout' && req.method === 'POST') {
    const token = getAuthToken(req);
    if (token) {
      const session = sessions.get(token);
      sessions.delete(token);
      if (session) {
        const idx = userRefreshIndex.get(session.userId);
        if (idx) {
          for (const rid of idx) {
            const rt = refreshTokens.get(rid);
            if (rt) {
              rt.revoked = true;
              refreshTokens.set(rid, rt);
            }
          }
          userRefreshIndex.delete(session.userId);
        }
      }
    }
    clearCookie(res, 'refresh_token');
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.url === '/auth/refresh' && req.method === 'POST') {
    const cookieVal = getCookie(req, 'refresh_token');
    if (cookieVal) {
      const [rid, rtoken] = cookieVal.split(':');
      const rt = refreshTokens.get(rid);
      if (!rt || rt.revoked) {
        clearCookie(res, 'refresh_token');
        sendJson(res, 401, { error: 'Sessão inválida' });
        return;
      }
      if (new Date(rt.expiresAt).getTime() <= Date.now()) {
        rt.revoked = true;
        refreshTokens.set(rid, rt);
        clearCookie(res, 'refresh_token');
        sendJson(res, 401, { error: 'Sessão expirada' });
        return;
      }
      if (rt.tokenHash !== hashToken(rtoken)) {
        sendJson(res, 401, { error: 'Sessão inválida' });
        return;
      }
      const user = users.get(rt.userId);
      if (!user) {
        sendJson(res, 401, { error: 'Sessão inválida' });
        return;
      }
      rt.revoked = true;
      refreshTokens.set(rid, rt);
      const newRtVal = randomBytes(32).toString('hex');
      const newRtId = randomBytes(8).toString('hex');
      const nowMs = Date.now();
      const newRt: RefreshToken = {
        id: newRtId,
        userId: rt.userId,
        tokenHash: hashToken(newRtVal),
        createdAt: new Date(nowMs).toISOString(),
        expiresAt: new Date(nowMs + 7 * 24 * 60 * 60 * 1000).toISOString(),
        revoked: false,
        userAgent: String(req.headers['user-agent'] || ''),
        ip: String(req.socket.remoteAddress || ''),
      };
      refreshTokens.set(newRtId, newRt);
      const idx = userRefreshIndex.get(rt.userId) || new Set<string>();
      idx.add(newRtId);
      userRefreshIndex.set(rt.userId, idx);
      setCookie(res, 'refresh_token', `${newRtId}:${newRtVal}`, 7 * 24 * 60 * 60);
      const access = randomBytes(24).toString('hex');
      sessions.set(access, {
        token: access,
        userId: rt.userId,
        issuedAt: nowMs,
        expiresAt: nowMs + 15 * 60 * 1000,
      });
      const { password_hash: ___, password_salt: ____, ...safeUser } = user;
      sendJson(res, 200, { token: access, user: safeUser });
      return;
    } else {
      const token = getAuthToken(req);
      if (!token) {
        sendJson(res, 401, { error: 'Não autenticado' });
        return;
      }
      const session = sessions.get(token);
      if (!session) {
        sendJson(res, 401, { error: 'Sessão inválida' });
        return;
      }
      if (session.expiresAt <= Date.now()) {
        sessions.delete(token);
        sendJson(res, 401, { error: 'Sessão expirada' });
        return;
      }
      const user = users.get(session.userId);
      if (!user) {
        sendJson(res, 401, { error: 'Sessão inválida' });
        return;
      }
      sessions.delete(token);
      const newToken = randomBytes(24).toString('hex');
      const nowRefresh = Date.now();
      sessions.set(newToken, {
        token: newToken,
        userId: session.userId,
        issuedAt: nowRefresh,
        expiresAt: nowRefresh + 15 * 60 * 1000,
      });
      const { password_hash: ___, password_salt: ____, ...safeUser } = user;
      sendJson(res, 200, { token: newToken, user: safeUser });
      return;
    }
  }

  if (req.url === '/auth/request-verification' && req.method === 'POST') {
    const body = await parseBody(req);
    const email = String(body.email || '').toLowerCase();
    if (!isValidEmail(email)) {
      sendJson(res, 400, { error: 'Email inválido' });
      return;
    }
    let found: User | null = null;
    for (const u of users.values()) {
      if (u.email === email) {
        found = u;
        break;
      }
    }
    if (!found) {
      sendJson(res, 404, { error: 'Conta não encontrada' });
      return;
    }
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const salt = randomBytes(8).toString('hex');
    const hash = scryptSync(code, Buffer.from(salt, 'hex'), 32).toString('hex');
    const reqObj: VerificationRequest = {
      email,
      userId: found.id,
      codeHash: hash,
      codeSalt: salt,
      expiresAt: Date.now() + 15 * 60 * 1000,
      attempts: 0,
      sentAt: Date.now(),
    };
    verificationRequests.set(email, reqObj);
    logAudit('verify_request', req.socket.remoteAddress || 'unknown', email, true, found.id);
    const debug = process.env.NODE_ENV !== 'production' ? { debugCode: code } : {};
    sendJson(res, 200, { ok: true, ...debug });
    return;
  }

  if (req.url === '/auth/verify' && req.method === 'POST') {
    const body = await parseBody(req);
    const email = String(body.email || '').toLowerCase();
    const code = String(body.code || '');
    const reqObj = verificationRequests.get(email);
    if (!reqObj) {
      sendJson(res, 400, { error: 'Solicite o código primeiro' });
      return;
    }
    if (Date.now() > reqObj.expiresAt) {
      verificationRequests.delete(email);
      sendJson(res, 400, { error: 'Código expirado' });
      return;
    }
    reqObj.attempts += 1;
    if (reqObj.attempts > 5) {
      verificationRequests.delete(email);
      sendJson(res, 429, { error: 'Muitas tentativas. Solicite novo código.' });
      return;
    }
    const candidate = scryptSync(code, Buffer.from(reqObj.codeSalt, 'hex'), 32).toString('hex');
    if (candidate !== reqObj.codeHash) {
      sendJson(res, 400, { error: 'Código inválido' });
      return;
    }
    verificationRequests.delete(email);
    const profile = profiles.get(reqObj.userId);
    if (profile) {
      (profile as any).email_verified = true;
      profiles.set(reqObj.userId, profile);
    }
    logAudit('verify_complete', req.socket.remoteAddress || 'unknown', email, true, reqObj.userId);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.url === '/auth/request-password-reset' && req.method === 'POST') {
    const body = await parseBody(req);
    const email = String(body.email || '').toLowerCase();
    if (!isValidEmail(email)) {
      sendJson(res, 400, { error: 'Email inválido' });
      return;
    }
    let found: User | null = null;
    for (const u of users.values()) {
      if (u.email === email) {
        found = u;
        break;
      }
    }
    if (!found) {
      sendJson(res, 404, { error: 'Conta não encontrada' });
      return;
    }
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const salt = randomBytes(8).toString('hex');
    const hash = scryptSync(code, Buffer.from(salt, 'hex'), 32).toString('hex');
    const reqObj: PasswordResetRequest = {
      email,
      userId: found.id,
      codeHash: hash,
      codeSalt: salt,
      expiresAt: Date.now() + 15 * 60 * 1000,
      attempts: 0,
      sentAt: Date.now(),
    };
    passwordResetRequests.set(email, reqObj);
    logAudit('password_reset_request', req.socket.remoteAddress || 'unknown', email, true, found.id);
    const debug = process.env.NODE_ENV !== 'production' ? { debugCode: code } : {};
    sendJson(res, 200, { ok: true, ...debug });
    return;
  }

  if (req.url === '/auth/reset-password' && req.method === 'POST') {
    const body = await parseBody(req);
    const email = String(body.email || '').toLowerCase();
    const code = String(body.code || '');
    const newPassword = String(body.newPassword || '');
    if (!isStrongPassword(newPassword)) {
      sendJson(res, 400, { error: 'Password fraca. Use 8+ caracteres com letras e números.' });
      return;
    }
    const reqObj = passwordResetRequests.get(email);
    if (!reqObj) {
      sendJson(res, 400, { error: 'Solicite o código primeiro' });
      return;
    }
    if (Date.now() > reqObj.expiresAt) {
      passwordResetRequests.delete(email);
      sendJson(res, 400, { error: 'Código expirado' });
      return;
    }
    reqObj.attempts += 1;
    if (reqObj.attempts > 5) {
      passwordResetRequests.delete(email);
      sendJson(res, 429, { error: 'Muitas tentativas. Solicite novo código.' });
      return;
    }
    const candidate = scryptSync(code, Buffer.from(reqObj.codeSalt, 'hex'), 32).toString('hex');
    if (candidate !== reqObj.codeHash) {
      sendJson(res, 400, { error: 'Código inválido' });
      return;
    }
    passwordResetRequests.delete(email);
    const user = users.get(reqObj.userId);
    if (!user) {
      sendJson(res, 404, { error: 'Conta não encontrada' });
      return;
    }
    const { hashHex, saltHex } = hashPassword(newPassword);
    user.password_hash = hashHex;
    user.password_salt = saltHex;
    users.set(reqObj.userId, user);
    // revoke sessions and refresh tokens
    for (const [tok, sess] of sessions.entries()) {
      if (sess.userId === reqObj.userId) {
        sessions.delete(tok);
      }
    }
    const idx = userRefreshIndex.get(reqObj.userId);
    if (idx) {
      for (const rid of idx) {
        const rt = refreshTokens.get(rid);
        if (rt) {
          rt.revoked = true;
          refreshTokens.set(rid, rt);
        }
      }
      userRefreshIndex.delete(reqObj.userId);
    }
    clearCookie(res, 'refresh_token');
    logAudit('password_reset_complete', req.socket.remoteAddress || 'unknown', email, true, reqObj.userId);
    sendJson(res, 200, { ok: true });
    return;
  }
  if (req.url === '/wallet' && req.method === 'GET') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' });
      return;
    }

    const balanceEntry = walletBalances.get(user.id) || { balance: 0 };
    const allUserTransactions = transactionsStore
      .filter((t) => t.user_id === user.id)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      .slice(0, 50);

    const completedDeposits = allUserTransactions.filter(
      (t) => t.type === 'deposit' && t.status === 'completed',
    );
    const completedWithdrawals = allUserTransactions.filter(
      (t) => t.type === 'withdrawal' && t.status === 'completed',
    );
    const bets = allUserTransactions.filter((t) => t.type === 'bet' && t.status === 'completed');
    const wins = allUserTransactions.filter((t) => t.type === 'win' && t.status === 'completed');
    const pendingDeps = allUserTransactions.filter(
      (t) => t.type === 'deposit' && t.status === 'pending',
    );
    const pendingWiths = allUserTransactions.filter(
      (t) => t.type === 'withdrawal' && t.status === 'pending',
    );

    const totalDeposited = completedDeposits.reduce((sum, t) => sum + Number(t.amount), 0);
    const totalWithdrawn = completedWithdrawals.reduce((sum, t) => sum + Number(t.amount), 0);
    const totalBets = bets.reduce((sum, t) => sum + Number(t.amount), 0);
    const totalWins = wins.reduce((sum, t) => sum + Number(t.amount), 0);
    const pendingDeposits = pendingDeps.reduce((sum, t) => sum + Number(t.amount), 0);
    const pendingWithdrawals = pendingWiths.reduce((sum, t) => sum + Number(t.amount), 0);

    const profile = profiles.get(user.id);

    sendJson(res, 200, {
      balance: balanceEntry.balance,
      bonusBalance: 0,
      freeBetBalance: 0,
      totalDeposited,
      totalWithdrawn,
      totalBets,
      totalWins,
      pendingDeposits,
      pendingWithdrawals,
      profile: profile || null,
      recentTransactions: allUserTransactions,
    });
    return;
  }

  if (req.url === '/risk/user-limits' && req.method === 'GET') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' });
      return;
    }

    let limits = userStakeLimitsStore.find((l) => l.user_id === user.id);

    if (!limits) {
      limits = {
        user_id: user.id,
        max_stake_per_bet: 1000,
        max_payout: 50000,
      };
      userStakeLimitsStore.push(limits);
    }

    sendJson(res, 200, {
      maxStakePerBet: limits.max_stake_per_bet,
      maxPayout: limits.max_payout,
    });
    return;
  }

  if (req.url === '/wallet/deposit' && req.method === 'POST') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' });
      return;
    }

    const body = await parseBody(req);
    const amount = parseAmount(body.amount || 0);

    if (!amount || amount <= 0) {
      sendJson(res, 400, { error: 'Valor inválido' });
      return;
    }

    const entry = walletBalances.get(user.id) || { balance: 0 };
    entry.balance += amount;
    walletBalances.set(user.id, entry);

    const now = new Date().toISOString();

    const profile = profiles.get(user.id);
    if (profile) {
      profile.balance = entry.balance;
      profile.updated_at = now;
      profiles.set(user.id, profile);
    }
    const tx = {
      id: randomBytes(16).toString('hex'),
      user_id: user.id,
      type: 'deposit' as const,
      amount,
      status: 'completed' as const,
      payment_method: body.payment_method || 'manual',
      description: body.description || 'Depósito',
      external_id: body.external_id,
      stripe_session_id: body.stripe_session_id,
      completed_at: now,
      created_at: now,
      updated_at: now,
    };
    transactionsStore.push(tx);

    sendJson(res, 200, { ok: true, balance: entry.balance, transaction: tx });
    return;
  }

  if (req.url === '/wallet/withdraw' && req.method === 'POST') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' });
      return;
    }

    const body = await parseBody(req);
    const amount = parseAmount(body.amount || 0);

    if (!amount || amount <= 0) {
      sendJson(res, 400, { error: 'Valor inválido' });
      return;
    }

    const entry = walletBalances.get(user.id) || { balance: 0 };

    if (entry.balance < amount) {
      sendJson(res, 400, { error: 'Saldo insuficiente' });
      return;
    }

    entry.balance -= amount;
    walletBalances.set(user.id, entry);

    const now = new Date().toISOString();

    const profile = profiles.get(user.id);
    if (profile) {
      profile.balance = entry.balance;
      profile.updated_at = now;
      profiles.set(user.id, profile);
    }
    const tx = {
      id: randomBytes(16).toString('hex'),
      user_id: user.id,
      type: 'withdrawal' as const,
      amount,
      status: 'pending' as const,
      payment_method: body.payment_method || 'manual',
      description: body.description || 'Levantamento',
      external_id: body.external_id,
      stripe_session_id: body.stripe_session_id,
      completed_at: now,
      created_at: now,
      updated_at: now,
    };
    transactionsStore.push(tx);

    sendJson(res, 200, { ok: true, balance: entry.balance, transaction: tx });
    return;
  }

  if (req.url === '/wallet/withdraw/cancel' && req.method === 'POST') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' });
      return;
    }
    const body = await parseBody(req);
    const id = String(body.transactionId || '');
    if (!id) {
      sendJson(res, 400, { error: 'transactionId é obrigatório' });
      return;
    }

    const idx = transactionsStore.findIndex((t) => t.id === id && t.user_id === user.id && t.type === 'withdrawal');
    if (idx === -1) {
      sendJson(res, 404, { error: 'Transação não encontrada' });
      return;
    }
    const tx = transactionsStore[idx];
    if (tx.status !== 'pending') {
      sendJson(res, 400, { error: 'Apenas levantamentos pendentes podem ser cancelados' });
      return;
    }

    // Refund
    const entry = walletBalances.get(user.id) || { balance: 0 };
    entry.balance += tx.amount;
    walletBalances.set(user.id, entry);
    const profile = profiles.get(user.id);
    if (profile) {
      profile.balance = entry.balance;
      profile.updated_at = new Date().toISOString();
      profiles.set(user.id, profile);
    }

    transactionsStore[idx] = { ...tx, status: 'cancelled', updated_at: new Date().toISOString() };
    sendJson(res, 200, { ok: true, balance: entry.balance, transaction: transactionsStore[idx] });
    return;
  }

  if (req.url === '/wallet/bet' && req.method === 'POST') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' });
      return;
    }

    const body = await parseBody(req);
    const amount = parseAmount(body.amount || 0);
    const betId = body.betId ? String(body.betId) : undefined;
    const betType = (body.betType as 'single' | 'multiple' | 'system') || 'single';
    const totalOdds = parseAmount(body.totalOdds || 1);
    const potentialWin = parseAmount(body.potentialWin || amount * totalOdds);
    const isFreeBet = Boolean(body.isFreeBet || false);
    const selections = Array.isArray(body.selections) ? body.selections : [];

    if (!amount || amount <= 0) {
      sendJson(res, 400, { error: 'Valor inválido' });
      return;
    }
    if (!totalOdds || totalOdds <= 1) {
      sendJson(res, 400, { error: 'Odds inválidas' });
      return;
    }
    if (!Array.isArray(selections) || selections.length < 1) {
      sendJson(res, 400, { error: 'Seleções inválidas' });
      return;
    }

    const entry = walletBalances.get(user.id) || { balance: 0 };

    if (entry.balance < amount) {
      sendJson(res, 400, { error: 'Saldo insuficiente' });
      return;
    }

    entry.balance -= amount;
    walletBalances.set(user.id, entry);

    const now = new Date().toISOString();

    const profile = profiles.get(user.id);
    if (profile) {
      profile.balance = entry.balance;
      profile.updated_at = now;
      profiles.set(user.id, profile);
    }

    const tx = {
      id: randomBytes(16).toString('hex'),
      user_id: user.id,
      type: 'bet' as const,
      amount,
      status: 'completed' as const,
      payment_method: undefined,
      description: betId ? `Aposta #${betId.slice(0, 8)}` : 'Aposta colocada',
      external_id: undefined,
      stripe_session_id: undefined,
      completed_at: now,
      created_at: now,
      updated_at: now,
    };
    transactionsStore.push(tx);

    const bet = {
      id: betId || randomBytes(16).toString('hex'),
      user_id: user.id,
      bet_type: betType,
      stake: amount,
      potential_win: potentialWin,
      total_odds: totalOdds,
      status: 'pending' as const,
      is_free_bet: isFreeBet,
      winnings: null,
      created_at: now,
      selections,
      total_stake: amount,
      potential_return: potentialWin,
    };
    betsStore.push(bet);

    sendJson(res, 200, { ok: true, balance: entry.balance, transaction: tx, bet });
    return;
  }

  if (req.url === '/wallet/win' && req.method === 'POST') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' });
      return;
    }

    const body = await parseBody(req);
    const amount = Number(body.amount || 0);
    const betId = body.betId ? String(body.betId) : undefined;

    if (!amount || amount <= 0) {
      sendJson(res, 400, { error: 'Valor inválido' });
      return;
    }

    const entry = walletBalances.get(user.id) || { balance: 0 };
    entry.balance += amount;
    walletBalances.set(user.id, entry);

    const now = new Date().toISOString();

    const profile = profiles.get(user.id);
    if (profile) {
      profile.balance = entry.balance;
      profile.updated_at = now;
      profiles.set(user.id, profile);
    }
    const tx = {
      id: randomBytes(16).toString('hex'),
      user_id: user.id,
      type: 'win' as const,
      amount,
      status: 'completed' as const,
      payment_method: undefined,
      description: betId ? `Ganho da aposta #${betId.slice(0, 8)}` : 'Ganhos de aposta',
      external_id: undefined,
      stripe_session_id: undefined,
      completed_at: now,
      created_at: now,
      updated_at: now,
    };
    transactionsStore.push(tx);

    sendJson(res, 200, { ok: true, balance: entry.balance, transaction: tx });
    return;
  }

  if (req.url === '/wallet/cashout' && req.method === 'POST') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' });
      return;
    }

    const body = await parseBody(req);
    const amount = Number(body.amount || 0);
    const betId = body.betId ? String(body.betId) : '';

    if (!betId) {
      sendJson(res, 400, { error: 'betId é obrigatório' });
      return;
    }
    if (!amount || amount <= 0) {
      sendJson(res, 400, { error: 'Valor inválido' });
      return;
    }

    const idx = betsStore.findIndex((b) => b.id === betId && b.user_id === user.id);
    if (idx === -1) {
      sendJson(res, 404, { error: 'Aposta não encontrada' });
      return;
    }

    const existingBet = betsStore[idx];
    if (existingBet.status !== 'pending') {
      sendJson(res, 400, { error: 'Apenas apostas pendentes podem fazer cash out' });
      return;
    }

    if (amount > existingBet.potential_win) {
      sendJson(res, 400, { error: 'Valor de cash out inválido' });
      return;
    }

    const now = new Date().toISOString();

    const entry = walletBalances.get(user.id) || { balance: 0 };
    entry.balance += amount;
    walletBalances.set(user.id, entry);

    const profile = profiles.get(user.id);
    if (profile) {
      profile.balance = entry.balance;
      profile.updated_at = now;
      profiles.set(user.id, profile);
    }

    const updatedBet = {
      ...existingBet,
      status: 'cashout' as const,
      cashout_value: amount,
      cashout_at: now,
      settled_at: now,
      winnings: amount,
    };
    betsStore[idx] = updatedBet;

    const tx = {
      id: randomBytes(16).toString('hex'),
      user_id: user.id,
      type: 'cashout' as const,
      amount,
      status: 'completed' as const,
      payment_method: undefined,
      description: `Cash out da aposta #${betId.slice(0, 8)}`,
      external_id: undefined,
      stripe_session_id: undefined,
      completed_at: now,
      created_at: now,
      updated_at: now,
    };
    transactionsStore.push(tx);

    sendJson(res, 200, { ok: true, balance: entry.balance, bet: updatedBet, transaction: tx });
    return;
  }

  if (req.url === '/transactions' && req.method === 'GET') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' });
      return;
    }

    const list = transactionsStore
      .filter((t) => t.user_id === user.id)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

    sendJson(res, 200, { transactions: list });
    return;
  }

  if (req.url === '/bets' && req.method === 'GET') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' });
      return;
    }

    const list = betsStore
      .filter((b) => b.user_id === user.id)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

    sendJson(res, 200, { bets: list });
    return;
  }

  if (req.url === '/transactions' && req.method === 'POST') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' });
      return;
    }

    const body = await parseBody(req);
    const amount = parseAmount(body.amount || 0);

    if (!amount || amount <= 0) {
      sendJson(res, 400, { error: 'Valor inválido' });
      return;
    }
    const validTypes = new Set(['deposit', 'withdrawal', 'bet', 'win', 'cashout']);
    const validStatuses = new Set(['pending', 'completed', 'failed', 'cancelled']);
    const type = (body.type || 'deposit') as string;
    const status = (body.status || 'completed') as string;
    if (!validTypes.has(type) || !validStatuses.has(status)) {
      sendJson(res, 400, { error: 'Tipo ou estado inválido' });
      return;
    }

    const now = new Date().toISOString();
    const tx = {
      id: randomBytes(16).toString('hex'),
      user_id: user.id,
      type: type as any,
      amount,
      status: status as any,
      payment_method: body.payment_method,
      description: body.description,
      external_id: body.external_id,
      stripe_session_id: body.stripe_session_id,
      completed_at: body.completed_at || now,
      created_at: now,
      updated_at: now,
    } as (typeof transactionsStore)[number];

    transactionsStore.push(tx);

    sendJson(res, 200, { transaction: tx });
    return;
  }

  if (req.url?.startsWith('/admin/audit-logs') && req.method === 'GET') {
    const user = getUserFromRequest(req);
    if (!user || user.role !== 'admin') {
      sendJson(res, 403, { error: 'Acesso negado' });
      return;
    }
    const [pathOnly, query = ''] = req.url.split('?');
    const params = new URLSearchParams(query);
    const limit = Math.max(1, Math.min(500, Number(params.get('limit') || 100)));
    const action = params.get('action') as 'signup' | 'login' | null;
    const email = params.get('email');
    let list = auditLogs.slice().reverse();
    if (action) {
      list = list.filter((l) => l.action === action);
    }
    if (email) {
      const q = String(email).toLowerCase();
      list = list.filter((l) => l.email.toLowerCase() === q);
    }
    sendJson(res, 200, { logs: list.slice(0, limit) });
    return;
  }

  if (req.url.startsWith('/transactions/') && req.method === 'PUT') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' });
      return;
    }

    const id = req.url.split('/')[2];
    const body = await parseBody(req);

    const idx = transactionsStore.findIndex((t) => t.id === id && t.user_id === user.id);
    if (idx === -1) {
      sendJson(res, 404, { error: 'Transação não encontrada' });
      return;
    }

    const existing = transactionsStore[idx];
    const updated = {
      ...existing,
      ...body,
      updated_at: new Date().toISOString(),
    };

    transactionsStore[idx] = updated;

    sendJson(res, 200, { transaction: updated });
    return;
  }

  if (req.url === '/kyc/documents' && req.method === 'GET') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' });
      return;
    }

    const docs = kycDocuments
      .filter((d) => d.user_id === user.id)
      .sort((a, b) => (a.uploaded_at < b.uploaded_at ? 1 : -1));

    sendJson(res, 200, { documents: docs });
    return;
  }

  if (req.url === '/kyc/documents' && req.method === 'POST') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' });
      return;
    }

    const body = await parseBody(req);
    const documentType = body.documentType as
      | 'id_front'
      | 'id_back'
      | 'proof_address'
      | 'selfie';
    const fileName = String(body.fileName || '');
    const fileData = String(body.fileData || '');

    const allowedTypes = new Set(['id_front', 'id_back', 'proof_address', 'selfie']);
    if (!allowedTypes.has(documentType) || !fileName || !fileData) {
      sendJson(res, 400, { error: 'Dados do documento em falta' });
      return;
    }
    if (fileName.length > 128) {
      sendJson(res, 400, { error: 'Nome de ficheiro demasiado longo' });
      return;
    }
    if (fileData.length > 2_000_000) {
      sendJson(res, 413, { error: 'Documento demasiado grande' });
      return;
    }

    for (let i = kycDocuments.length - 1; i >= 0; i -= 1) {
      const doc = kycDocuments[i];
      if (doc.user_id === user.id && doc.document_type === documentType) {
        kycDocuments.splice(i, 1);
      }
    }

    const now = new Date().toISOString();
    const id = randomBytes(16).toString('hex');

    const doc = {
      id,
      user_id: user.id,
      document_type: documentType,
      file_name: fileName,
      file_url: fileData,
      status: 'pending' as const,
      uploaded_at: now,
    };

    kycDocuments.push(doc);

    sendJson(res, 200, { document: doc });
    return;
  }

  if (req.url?.startsWith('/matches/') && req.url.endsWith('/incidents') && req.method === 'GET') {
    const parts = req.url.split('/');
    const fixtureId = parts[2];

    // Neste mock não temos incidentes reais, devolvemos lista vazia
    sendJson(res, 200, {
      fixtureId,
      incidents: [],
    });
    return;
  }

  if (req.url?.startsWith('/kyc/documents/') && req.method === 'DELETE') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' });
      return;
    }

    const id = req.url.split('/')[3];
    const index = kycDocuments.findIndex((d) => d.id === id && d.user_id === user.id);
    if (index === -1) {
      sendJson(res, 404, { error: 'Documento não encontrado' });
      return;
    }

    kycDocuments.splice(index, 1);

    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.url === '/admin/users' && req.method === 'GET') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' });
      return;
    }
    if (user.role !== 'admin') {
      sendJson(res, 403, { error: 'Acesso negado' });
      return;
    }

    const list = Array.from(profiles.values()).map((p) => ({
      id: p.id,
      email: p.email,
      full_name: p.full_name ?? null,
      balance: p.balance ?? 0,
      status: p.status ?? 'active',
      is_admin: p.is_admin ?? false,
      created_at: p.created_at,
      kyc_verified: p.kyc_verified ?? false,
      phone: p.phone ?? null,
    }));

    list.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

    sendJson(res, 200, { users: list });
    return;
  }

  if (req.url?.startsWith('/admin/users/') && req.method === 'PUT') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' });
      return;
    }
    if (user.role !== 'admin') {
      sendJson(res, 403, { error: 'Acesso negado' });
      return;
    }

    const targetId = req.url.split('/')[3];
    const body = await parseBody(req);

    const existing = profiles.get(targetId);
    if (!existing) {
      sendJson(res, 404, { error: 'Utilizador não encontrado' });
      return;
    }

    const now = new Date().toISOString();
    const updated = {
      ...existing,
      full_name: body.full_name ?? existing.full_name,
      status: body.status ?? existing.status,
      is_admin: typeof body.is_admin === 'boolean' ? body.is_admin : existing.is_admin,
      kyc_verified: typeof body.kyc_verified === 'boolean' ? body.kyc_verified : existing.kyc_verified,
      phone: body.phone ?? existing.phone,
      balance: typeof body.balance === 'number' ? body.balance : existing.balance,
      updated_at: now,
    };

    profiles.set(targetId, updated);

    const balanceEntry = walletBalances.get(targetId) || { balance: 0 };
    balanceEntry.balance = updated.balance ?? balanceEntry.balance;
    walletBalances.set(targetId, balanceEntry);

    const userEntry = users.get(targetId);
    if (userEntry) {
      userEntry.role = updated.is_admin ? 'admin' : 'user';
      users.set(targetId, userEntry);
    }

    sendJson(res, 200, { user: {
      id: updated.id,
      email: updated.email,
      full_name: updated.full_name ?? null,
      balance: updated.balance ?? 0,
      status: updated.status ?? 'active',
      is_admin: updated.is_admin ?? false,
      created_at: updated.created_at,
      kyc_verified: updated.kyc_verified ?? false,
      phone: updated.phone ?? null,
    } });
    return;
  }

  if (req.url === '/admin/transactions' && req.method === 'GET') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' });
      return;
    }
    if (user.role !== 'admin') {
      sendJson(res, 403, { error: 'Acesso negado' });
      return;
    }

    const list = transactionsStore
      .slice()
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      .slice(0, 100)
      .map((t) => {
        const p = profiles.get(t.user_id);
        return {
          id: t.id,
          user_id: t.user_id,
          type: t.type,
          amount: t.amount,
          status: t.status,
          payment_method: t.payment_method || '',
          created_at: t.created_at,
          user: p
            ? {
                email: p.email,
                full_name: p.full_name ?? null,
              }
            : undefined,
        };
      });

    sendJson(res, 200, { transactions: list });
    return;
  }

  if (req.url?.startsWith('/admin/transactions/') && req.method === 'PUT') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' });
      return;
    }
    if (user.role !== 'admin') {
      sendJson(res, 403, { error: 'Acesso negado' });
      return;
    }

    const id = req.url.split('/')[3];
    const idx = transactionsStore.findIndex((t) => t.id === id);
    if (idx === -1) {
      sendJson(res, 404, { error: 'Transação não encontrada' });
      return;
    }

    const body = await parseBody(req);
    const now = new Date().toISOString();
    const existing = transactionsStore[idx];
    const updated = {
      ...existing,
      status: body.status ?? existing.status,
      updated_at: now,
    };
    transactionsStore[idx] = updated;

    sendJson(res, 200, { transaction: updated });
    return;
  }

  if (req.url === '/admin/bets' && req.method === 'GET') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' });
      return;
    }
    if (user.role !== 'admin') {
      sendJson(res, 403, { error: 'Acesso negado' });
      return;
    }

    const list = betsStore
      .slice()
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      .slice(0, 100)
      .map((b) => {
        const p = profiles.get(b.user_id);
        return {
          ...b,
          user: p
            ? {
                email: p.email,
                full_name: p.full_name ?? null,
              }
            : undefined,
        };
      });

    sendJson(res, 200, { bets: list });
    return;
  }

  if (req.url?.startsWith('/admin/bets/') && req.method === 'PUT') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' });
      return;
    }
    if (user.role !== 'admin') {
      sendJson(res, 403, { error: 'Acesso negado' });
      return;
    }

    const id = req.url.split('/')[3];
    const idx = betsStore.findIndex((b) => b.id === id);
    if (idx === -1) {
      sendJson(res, 404, { error: 'Aposta não encontrada' });
      return;
    }

    const body = await parseBody(req);
    const existing = betsStore[idx];
    const newStatus = (body.status as typeof existing.status) || existing.status;

    const updated = {
      ...existing,
      status: newStatus,
      winnings: newStatus === 'won' ? existing.potential_win : newStatus === 'lost' ? 0 : existing.winnings ?? null,
    };

    betsStore[idx] = updated;

    sendJson(res, 200, { bet: updated });
    return;
  }

  if (req.url === '/admin/matches' && req.method === 'GET') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' });
      return;
    }
    if (user.role !== 'admin') {
      sendJson(res, 403, { error: 'Acesso negado' });
      return;
    }

    const list = matchesStore.slice().sort((a, b) => (a.start_time > b.start_time ? 1 : -1));
    sendJson(res, 200, { matches: list });
    return;
  }

  if (req.url === '/admin/matches' && req.method === 'POST') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' });
      return;
    }
    if (user.role !== 'admin') {
      sendJson(res, 403, { error: 'Acesso negado' });
      return;
    }

    const body = await parseBody(req);
    const now = new Date().toISOString();
    const id = randomBytes(16).toString('hex');
    const match = {
      id,
      sport: String(body.sport || 'football'),
      league: String(body.league || ''),
      home_team: String(body.home_team || ''),
      away_team: String(body.away_team || ''),
      start_time: body.start_time ? String(body.start_time) : now,
      status: (body.status as 'scheduled' | 'live' | 'finished' | 'cancelled') || 'scheduled',
      home_score:
        typeof body.home_score === 'number' ? body.home_score : body.home_score ? Number(body.home_score) : null,
      away_score:
        typeof body.away_score === 'number' ? body.away_score : body.away_score ? Number(body.away_score) : null,
      created_at: now,
    };
    matchesStore.push(match);
    sendJson(res, 200, { match });
    return;
  }

  if (req.url?.startsWith('/admin/matches/') && req.method === 'PUT') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' });
      return;
    }
    if (user.role !== 'admin') {
      sendJson(res, 403, { error: 'Acesso negado' });
      return;
    }

    const id = req.url.split('/')[3];
    const idx = matchesStore.findIndex((m) => m.id === id);
    if (idx === -1) {
      sendJson(res, 404, { error: 'Jogo não encontrado' });
      return;
    }

    const body = await parseBody(req);
    const existing = matchesStore[idx];
    const updated = {
      ...existing,
      sport: body.sport ?? existing.sport,
      league: body.league ?? existing.league,
      home_team: body.home_team ?? existing.home_team,
      away_team: body.away_team ?? existing.away_team,
      start_time: body.start_time ? String(body.start_time) : existing.start_time,
      status: (body.status as typeof existing.status) ?? existing.status,
      home_score:
        typeof body.home_score === 'number' ? body.home_score : body.home_score ? Number(body.home_score) : existing.home_score,
      away_score:
        typeof body.away_score === 'number' ? body.away_score : body.away_score ? Number(body.away_score) : existing.away_score,
    };
    matchesStore[idx] = updated;
    sendJson(res, 200, { match: updated });
    return;
  }

  if (req.url?.startsWith('/admin/matches/') && req.method === 'DELETE') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' });
      return;
    }
    if (user.role !== 'admin') {
      sendJson(res, 403, { error: 'Acesso negado' });
      return;
    }

    const id = req.url.split('/')[3];
    const idx = matchesStore.findIndex((m) => m.id === id);
    if (idx === -1) {
      sendJson(res, 404, { error: 'Jogo não encontrado' });
      return;
    }
    matchesStore.splice(idx, 1);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.url === '/admin/promotions' && req.method === 'GET') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' });
      return;
    }
    if (user.role !== 'admin') {
      sendJson(res, 403, { error: 'Acesso negado' });
      return;
    }

    const list = promotionsStore.slice().sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    sendJson(res, 200, { promotions: list });
    return;
  }

  if (req.url === '/admin/promotions' && req.method === 'POST') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' });
      return;
    }
    if (user.role !== 'admin') {
      sendJson(res, 403, { error: 'Acesso negado' });
      return;
    }

    const body = await parseBody(req);
    const now = new Date().toISOString();
    const id = randomBytes(16).toString('hex');
    const promo = {
      id,
      title: String(body.title || ''),
      description: String(body.description || ''),
      type: String(body.type || 'deposit_bonus'),
      value: Number(body.value || 0),
      min_deposit: Number(body.min_deposit || 0),
      max_bonus: Number(body.max_bonus || 0),
      valid_from: String(body.valid_from || now.slice(0, 10)),
      valid_until: String(body.valid_until || now.slice(0, 10)),
      is_active: Boolean(body.is_active ?? true),
      terms: String(body.terms || ''),
      created_at: now,
    };
    promotionsStore.push(promo);
    sendJson(res, 200, { promotion: promo });
    return;
  }

  if (req.url?.startsWith('/admin/promotions/') && req.method === 'PUT') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' });
      return;
    }
    if (user.role !== 'admin') {
      sendJson(res, 403, { error: 'Acesso negado' });
      return;
    }

    const id = req.url.split('/')[3];
    const idx = promotionsStore.findIndex((p) => p.id === id);
    if (idx === -1) {
      sendJson(res, 404, { error: 'Promoção não encontrada' });
      return;
    }

    const body = await parseBody(req);
    const existing = promotionsStore[idx];
    const updated = {
      ...existing,
      title: body.title ?? existing.title,
      description: body.description ?? existing.description,
      type: body.type ?? existing.type,
      value: typeof body.value === 'number' ? body.value : existing.value,
      min_deposit: typeof body.min_deposit === 'number' ? body.min_deposit : existing.min_deposit,
      max_bonus: typeof body.max_bonus === 'number' ? body.max_bonus : existing.max_bonus,
      valid_from: body.valid_from ?? existing.valid_from,
      valid_until: body.valid_until ?? existing.valid_until,
      is_active: typeof body.is_active === 'boolean' ? body.is_active : existing.is_active,
      terms: body.terms ?? existing.terms,
    };
    promotionsStore[idx] = updated;
    sendJson(res, 200, { promotion: updated });
    return;
  }

  if (req.url?.startsWith('/admin/promotions/') && req.method === 'DELETE') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' });
      return;
    }
    if (user.role !== 'admin') {
      sendJson(res, 403, { error: 'Acesso negado' });
      return;
    }

    const id = req.url.split('/')[3];
    const idx = promotionsStore.findIndex((p) => p.id === id);
    if (idx === -1) {
      sendJson(res, 404, { error: 'Promoção não encontrada' });
      return;
    }
    promotionsStore.splice(idx, 1);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.url === '/admin/payment-settings' && req.method === 'GET') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' });
      return;
    }
    if (user.role !== 'admin') {
      sendJson(res, 403, { error: 'Acesso negado' });
      return;
    }

    const settings = paymentSettingsStore[0];
    sendJson(res, 200, { settings });
    return;
  }

  if (req.url === '/admin/payment-settings' && req.method === 'PUT') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' });
      return;
    }
    if (user.role !== 'admin') {
      sendJson(res, 403, { error: 'Acesso negado' });
      return;
    }

    const body = await parseBody(req);
    const current = paymentSettingsStore[0];
    const updated = {
      ...current,
      paypal_enabled: body.paypal_enabled ?? current.paypal_enabled,
      paypal_mode: body.paypal_mode ?? current.paypal_mode,
      updated_at: new Date().toISOString(),
    };
    paymentSettingsStore[0] = updated;
    sendJson(res, 200, { settings: updated });
    return;
  }

  if (req.url === '/admin/paypal/test' && req.method === 'POST') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' });
      return;
    }
    if (user.role !== 'admin') {
      sendJson(res, 403, { error: 'Acesso negado' });
      return;
    }
    sendJson(res, 200, { success: true });
    return;
  }

  if (req.url === '/auth/resend' && req.method === 'POST') {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.url?.startsWith('/stats/standings') && req.method === 'GET') {
    try {
      const u = new URL(req.url!, 'http://localhost');
      const sport = u.searchParams.get('sport') || 'football';
      const league = u.searchParams.get('league');
      const season = u.searchParams.get('season') || String(new Date().getFullYear());

      if (!league) {
        sendJson(res, 400, { error: 'Parâmetro league é obrigatório' });
        return;
      }

      const baseUrl = apiFootballEndpoints[sport];
      if (!baseUrl) {
        sendJson(res, 400, { error: `Desporto não suportado: ${sport}` });
        return;
      }

      if (!apiFootballKey) {
        sendJson(res, 500, { error: 'API_FOOTBALL_KEY não configurada' });
        return;
      }

      const rateLimit = checkApiFootballRateLimit(sport);
      if (!rateLimit.allowed) {
        sendJson(res, 429, {
          error: 'Rate limit excedido',
          sport,
          message: `Limite de 1200 requisições/minuto para ${sport} excedido`,
          resetIn: rateLimit.resetIn,
        });
        return;
      }

      const apiUrl = new URL(`${baseUrl}/standings`);
      apiUrl.searchParams.set('league', String(league));
      apiUrl.searchParams.set('season', String(season));

      const requestOptions: https.RequestOptions = {
        method: 'GET',
        headers: {
          'x-apisports-key': apiFootballKey,
        },
      };

      const client = apiUrl.protocol === 'https:' ? https : http;

      const externalReq = client.request(apiUrl.toString(), requestOptions, (externalRes) => {
        const chunks: Buffer[] = [];
        externalRes.on('data', (chunk) => chunks.push(chunk));
        externalRes.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          try {
            const data = raw ? JSON.parse(raw) : {};
            if (data.errors && Object.keys(data.errors).length > 0) {
              sendJson(res, 400, { error: 'API-Football retornou erro', details: data.errors });
              return;
            }

            const standings =
              Array.isArray(data.response) &&
              data.response[0] &&
              Array.isArray(data.response[0].league?.standings)
                ? data.response[0].league.standings[0] || []
                : [];

            sendJson(res, 200, {
              sport,
              league,
              season,
              standings,
            });
          } catch {
            sendJson(res, 502, { error: 'Resposta inválida da API-Football' });
          }
        });
      });

      externalReq.on('error', (err) => {
        sendJson(res, 502, { error: 'Erro ao chamar API-Football', details: String(err) });
      });

      externalReq.end();
    } catch (e) {
      sendJson(res, 500, { error: 'Falha ao obter standings' });
    }
    return;
  }

  if (req.url?.startsWith('/stats/proxy') && req.method === 'GET') {
    const u = new URL(req.url!, 'http://localhost');
    const sport = u.searchParams.get('sport') || 'football';
    const endpoint = u.searchParams.get('endpoint');

    if (!endpoint) {
      sendJson(res, 400, { error: 'Parâmetro endpoint é obrigatório' });
      return;
    }

    const baseUrl = apiFootballEndpoints[sport];
    if (!baseUrl) {
      sendJson(res, 400, { error: `Desporto não suportado: ${sport}` });
      return;
    }

    if (!apiFootballKey) {
      sendJson(res, 500, { error: 'API_FOOTBALL_KEY não configurada' });
      return;
    }

    const rateLimit = checkApiFootballRateLimit(sport);
    if (!rateLimit.allowed) {
      sendJson(res, 429, {
        error: 'Rate limit excedido',
        sport,
        message: `Limite de 1200 requisições/minuto para ${sport} excedido`,
        resetIn: rateLimit.resetIn,
      });
      return;
    }

    const apiUrl = new URL(`${baseUrl}/${endpoint}`);
    u.searchParams.forEach((value, key) => {
      if (key !== 'sport' && key !== 'endpoint') {
        apiUrl.searchParams.append(key, value);
      }
    });

    const requestOptions: https.RequestOptions = {
      method: 'GET',
      headers: {
        'x-apisports-key': apiFootballKey,
      },
    };

    const client = apiUrl.protocol === 'https:' ? https : http;

    const externalReq = client.request(apiUrl.toString(), requestOptions, (externalRes) => {
      const chunks: Buffer[] = [];
      externalRes.on('data', (chunk) => chunks.push(chunk));
      externalRes.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        try {
          const data = raw ? JSON.parse(raw) : {};
          if (data.errors && Object.keys(data.errors).length > 0) {
            sendJson(res, 400, { error: 'API-Football retornou erro', details: data.errors });
            return;
          }
          sendJson(res, 200, data);
        } catch {
          sendJson(res, 502, { error: 'Resposta inválida da API-Football' });
        }
      });
    });

    externalReq.on('error', (err) => {
      sendJson(res, 502, { error: 'Erro ao chamar API-Football', details: String(err) });
    });

    externalReq.end();
    return;
  }
  if (req.url === '/payments/paypal/create-order' && req.method === 'POST') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' });
      return;
    }
    const orderId = randomBytes(12).toString('hex');
    sendJson(res, 200, { ok: true, order_id: orderId });
    return;
  }
  if (req.url === '/payments/paypal/capture-order' && req.method === 'POST') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' });
      return;
    }
    sendJson(res, 200, { ok: true });
    return;
  }
  if (req.url === '/payments/multibanco/generate' && req.method === 'POST') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' });
      return;
    }
    const body = await parseBody(req);
    const amount = Number(body.amount || 0);
    if (!amount || amount <= 0) {
      sendJson(res, 400, { error: 'Valor inválido' });
      return;
    }
    const entity = '12345';
    const reference = String(Math.floor(100000000 + Math.random() * 900000000));
    const expires_at = Math.floor(Date.now() / 1000) + 24 * 60 * 60;
    sendJson(res, 200, { entity, reference, expires_at });
    return;
  }
  if (req.url === '/bets' && req.method === 'GET') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' });
      return;
    }
    const list = betsStore
      .filter((b) => b.user_id === user.id)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    sendJson(res, 200, { bets: list });
    return;
  }
  if (req.url === '/self-exclusion' && req.method === 'GET') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' });
      return;
    }
    const list = selfExclusionStore.filter((r) => r.user_id === user.id).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    sendJson(res, 200, { records: list });
    return;
  }

  if (req.url === '/self-exclusion' && req.method === 'POST') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' });
      return;
    }
    const body = await parseBody(req);
    const now = new Date().toISOString();
    const record = {
      id: randomBytes(16).toString('hex'),
      user_id: user.id,
      type: body.type || 'temporary',
      duration_days: typeof body.duration_days === 'number' ? body.duration_days : undefined,
      start_date: body.start_date || now,
      end_date: body.end_date,
      reason: body.reason,
      status: body.status || 'active',
      created_at: now,
    };
    selfExclusionStore.push(record);
    sendJson(res, 200, { record });
    return;
  }
  if (req.url === '/profile' && req.method === 'GET') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' });
      return;
    }

    let profile = profiles.get(user.id);
    if (!profile) {
      const balanceEntry = walletBalances.get(user.id) || { balance: 0 };
      const createdAt = new Date().toISOString();
      profile = {
        id: user.id,
        user_id: user.id,
        email: user.email,
        full_name: user.name || '',
        name: user.name,
        phone: '',
        balance: balanceEntry.balance,
        free_bet_balance: 0,
        is_admin: user.role === 'admin',
        status: 'active',
        kyc_verified: false,
        created_at: createdAt,
      };
      profiles.set(user.id, profile);
    }

    sendJson(res, 200, { profile });
    return;
  }

  if (req.url === '/profile' && req.method === 'PUT') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' });
      return;
    }

    const body = await parseBody(req);
    const existing = profiles.get(user.id);

    const now = new Date().toISOString();
    const profile = {
      id: existing?.id || user.id,
      user_id: existing?.user_id || user.id,
      email: existing?.email || user.email,
      full_name: body.full_name ?? existing?.full_name ?? user.name ?? '',
      name: body.name ?? existing?.name ?? user.name,
      phone: body.phone ?? existing?.phone ?? '',
      balance: typeof body.balance === 'number' ? body.balance : existing?.balance ?? 0,
      free_bet_balance:
        typeof body.free_bet_balance === 'number'
          ? body.free_bet_balance
          : existing?.free_bet_balance ?? 0,
      is_admin: existing?.is_admin ?? user.role === 'admin',
      status: body.status ?? existing?.status ?? 'active',
      kyc_verified: body.kyc_verified ?? existing?.kyc_verified ?? false,
      birth_date: body.birth_date ?? existing?.birth_date,
      created_at: existing?.created_at || now,
      updated_at: now,
      self_exclusion_until: body.self_exclusion_until ?? existing?.self_exclusion_until,
      cooling_off_until: body.cooling_off_until ?? existing?.cooling_off_until,
      limits: body.limits ?? existing?.limits,
      saved_iban: body.saved_iban ?? existing?.saved_iban,
      saved_account_holder: body.saved_account_holder ?? existing?.saved_account_holder,
      self_exclusion_reason: body.self_exclusion_reason ?? existing?.self_exclusion_reason,
    };

    profiles.set(user.id, profile);

    const balanceEntry = walletBalances.get(user.id) || { balance: 0 };
    balanceEntry.balance = profile.balance;
    walletBalances.set(user.id, balanceEntry);

    sendJson(res, 200, { profile });
    return;
  }

  if (req.url === '/profile/balance' && req.method === 'POST') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' });
      return;
    }

    const body = await parseBody(req);
    const amount = Number(body.amount || 0);
    const operation = body.operation === 'subtract' ? 'subtract' : 'add';

    if (!amount || amount <= 0) {
      sendJson(res, 400, { error: 'Valor inválido' });
      return;
    }

    const balanceEntry = walletBalances.get(user.id) || { balance: 0 };

    let newBalance =
      operation === 'add'
        ? balanceEntry.balance + Math.abs(amount)
        : balanceEntry.balance - Math.abs(amount);

    if (newBalance < 0) {
      newBalance = 0;
    }

    balanceEntry.balance = newBalance;
    walletBalances.set(user.id, balanceEntry);

    const existing = profiles.get(user.id);
    const now = new Date().toISOString();
    const profile = {
      id: existing?.id || user.id,
      user_id: existing?.user_id || user.id,
      email: existing?.email || user.email,
      full_name: existing?.full_name || user.name || '',
      name: existing?.name || user.name,
      phone: existing?.phone || '',
      balance: newBalance,
      free_bet_balance: existing?.free_bet_balance ?? 0,
      is_admin: existing?.is_admin ?? user.role === 'admin',
      status: existing?.status ?? 'active',
      kyc_verified: existing?.kyc_verified ?? false,
      birth_date: existing?.birth_date,
      created_at: existing?.created_at || now,
      updated_at: now,
      self_exclusion_until: existing?.self_exclusion_until,
      cooling_off_until: existing?.cooling_off_until,
      limits: existing?.limits,
      saved_iban: existing?.saved_iban,
      saved_account_holder: existing?.saved_account_holder,
      self_exclusion_reason: existing?.self_exclusion_reason,
    };

    profiles.set(user.id, profile);

    sendJson(res, 200, { profile });
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
});

server.listen(PORT, async () => {
  try {
    await seedAdmin();
  } catch {}
  console.log(`API server running on port ${PORT}`);
});
