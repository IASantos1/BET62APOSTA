import crypto from 'crypto';
import type http from 'http';
import type pg from 'pg';
import { randomId } from '../lib/crypto';
import { APP_CASINO_CALLBACKS_TABLE, APP_CASINO_LAUNCHES_TABLE, APP_TRANSACTIONS_TABLE, ensureAppCasinoTables, ensureAppTransactionsTable } from '../lib/appTables';
import { requireUser } from '../lib/auth';
import { badRequest, readJsonBody, sendJson } from '../lib/http';

type Queryable = pg.Pool | pg.PoolClient;

type CasinoGame = {
  uid: string;
  name: string;
  provider?: string;
  image?: string;
};

type SilentApiConfig = {
  enabled: boolean;
  token: string;
  secret: string;
  endpoint: string;
  defaultGameUid: string;
  defaultHomeUrl: string;
  games: CasinoGame[];
};

const BETBY_GAME_UID = '8a704858d5deb4af1ddc722092ac7614';
const DEFAULT_CASINO_GAMES: CasinoGame[] = [
  {
    uid: BETBY_GAME_UID,
    name: 'Betby',
    provider: 'Betby',
    image: 'https://providers.gambllyapi.com/assets/providers/BETBY/betby-c93a9061.png',
  },
];

function toNumber(v: unknown): number {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function normalizeAbsoluteUrl(value: string): string {
  const raw = String(value || '').trim();
  if (!/^https?:\/\//i.test(raw)) return '';
  try {
    return new URL(raw).toString();
  } catch {
    return '';
  }
}

function parseCasinoGames(): CasinoGame[] {
  const raw = String(process.env.SILENTAPI_GAMES_JSON || '').trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => ({
        uid: String((item as any)?.uid || (item as any)?.game_uid || (item as any)?.gameid || '').trim(),
        name: String((item as any)?.name || (item as any)?.title || (item as any)?.gamename || '').trim(),
        provider: String((item as any)?.provider || (item as any)?.providerName || 'SilentAPI').trim() || 'SilentAPI',
        image: normalizeAbsoluteUrl(String((item as any)?.image || '').trim()) || undefined,
      }))
      .filter((item) => item.uid && item.name);
  } catch {
    return [];
  }
}

function getSilentApiConfig(): SilentApiConfig {
  const token = String(process.env.SILENTAPI_TOKEN || process.env.SILENTAPI_BEARER_TOKEN || '').trim();
  const secret = String(process.env.SILENTAPI_SECRET || '').trim();
  const endpoint = String(process.env.SILENTAPI_ENDPOINT || 'https://silentapi.org/api').trim().replace(/\/+$/, '');
  const envDefaultGameUid = String(process.env.SILENTAPI_DEFAULT_GAME_UID || '').trim();
  const defaultHomeUrl = normalizeAbsoluteUrl(String(process.env.SILENTAPI_HOME_URL || process.env.APP_PUBLIC_URL || '').trim());
  const parsedGames = parseCasinoGames();
  const games = parsedGames.length > 0 ? parsedGames : DEFAULT_CASINO_GAMES;
  const defaultGameUid = envDefaultGameUid || games[0]?.uid || BETBY_GAME_UID;

  if (games.length === 0 && defaultGameUid) {
    games.push({
      uid: defaultGameUid,
      name: 'Jogo Principal',
      provider: 'SilentAPI',
    });
  }

  return {
    enabled: Boolean(token && secret),
    token,
    secret,
    endpoint,
    defaultGameUid,
    defaultHomeUrl,
    games,
  };
}

function getPublicOrigin(req: http.IncomingMessage): string {
  const explicitOrigin = normalizeAbsoluteUrl(String(req.headers.origin || '').trim());
  if (explicitOrigin) {
    try {
      return new URL(explicitOrigin).origin;
    } catch {
      void 0;
    }
  }

  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').trim();
  if (!host) return '';
  const proto = String(req.headers['x-forwarded-proto'] || '').trim() || 'https';
  return `${proto}://${host}`;
}

function resolveHomeUrl(req: http.IncomingMessage, requestedHomeUrl: unknown, fallbackHomeUrl: string): string {
  const requested = String(requestedHomeUrl || '').trim();
  const absoluteRequested = normalizeAbsoluteUrl(requested);
  if (absoluteRequested) return absoluteRequested;

  if (requested.startsWith('/')) {
    const origin = getPublicOrigin(req);
    if (origin) {
      try {
        return new URL(requested, origin).toString();
      } catch {
        void 0;
      }
    }
  }

  if (fallbackHomeUrl) return fallbackHomeUrl;

  const origin = getPublicOrigin(req);
  if (origin) {
    try {
      return new URL('/casino', origin).toString();
    } catch {
      void 0;
    }
  }

  return 'https://example.com/casino';
}

function getSignature(req: http.IncomingMessage): string {
  const value = req.headers['x-signature'];
  if (Array.isArray(value)) return String(value[0] || '').trim();
  return String(value || '').trim();
}

function getRawBody(req: http.IncomingMessage, maxBytes = 256_000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.length;
      if (total > maxBytes) {
        reject(new Error('Payload too large'));
        return;
      }
      chunks.push(buffer);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function safeEqualHex(left: string, right: string): boolean {
  const a = String(left || '').trim().toLowerCase();
  const b = String(right || '').trim().toLowerCase();
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

async function getLockedBalance(client: Queryable, userId: string): Promise<number | null> {
  const result = await client.query(`SELECT balance FROM profiles WHERE user_id = $1 FOR UPDATE`, [userId]);
  if (result.rows.length === 0) return null;
  const value = Number(result.rows[0]?.balance ?? 0);
  return Number.isFinite(value) ? value : 0;
}

async function getCurrentBalance(pool: pg.Pool, userId: string): Promise<number> {
  const result = await pool.query(`SELECT balance FROM profiles WHERE user_id = $1 LIMIT 1`, [userId]);
  const value = Number(result.rows[0]?.balance ?? 0);
  return Number.isFinite(value) ? value : 0;
}

async function insertCasinoTransaction(
  client: Queryable,
  input: {
    userId: string;
    type: 'casino_bet' | 'casino_win';
    amount: number;
    serialNumber: string;
    gameUid: string;
    gameRound: string;
  },
): Promise<void> {
  if (!(input.amount > 0)) return;
  const label = input.type === 'casino_bet' ? 'Aposta' : 'Ganho';
  const description = `${label} de casino ${input.gameUid || 'SilentAPI'}${input.gameRound ? ` [round ${input.gameRound}]` : ''}`;

  await client.query(
    `INSERT INTO ${APP_TRANSACTIONS_TABLE} (id, user_id, type, amount, status, payment_method, description, external_id, completed_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'completed', 'silentapi', $5, $6, NOW(), NOW(), NOW())`,
    [
      randomId(16),
      input.userId,
      input.type,
      input.amount,
      description,
      `${input.serialNumber}:${input.type}`,
    ],
  );
}

export async function handleCasinoRoutes(
  pool: pg.Pool,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
): Promise<boolean> {
  const path = url.pathname;
  const config = getSilentApiConfig();

  if (req.method === 'GET' && path === '/api/casino/config') {
    const origin = getPublicOrigin(req);
    const callbackUrl = origin ? `${origin}/api/casino/webhook` : '/api/casino/webhook';
    sendJson(res, 200, {
      enabled: config.enabled,
      provider: 'SilentAPI',
      defaultGameUid: config.defaultGameUid || undefined,
      games: config.games,
      callbackUrl,
      homeUrl: config.defaultHomeUrl || undefined,
    });
    return true;
  }

  if (req.method === 'POST' && path === '/api/casino/launch') {
    const user = await requireUser(pool, req);
    if (!user) {
      sendJson(res, 401, { error: 'Unauthorized' });
      return true;
    }

    if (!config.enabled) {
      sendJson(res, 503, { error: 'Integração de casino não configurada.' });
      return true;
    }

    const body = await readJsonBody<any>(req).catch(() => null);
    if (!body) return badRequest(res, 'Invalid JSON'), true;

    const gameUid = String(body.game_uid || body.gameUid || config.defaultGameUid || '').trim();
    if (!gameUid) return badRequest(res, 'game_uid é obrigatório'), true;

    const balance = await getCurrentBalance(pool, user.id);
    const memberAccount = user.id;
    const homeUrl = resolveHomeUrl(req, body.home_url || body.homeUrl, config.defaultHomeUrl);

    let upstreamPayload: any = null;
    try {
      const upstream = await fetch(`${config.endpoint}/GetGameUrl.php`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.token}`,
        },
        body: JSON.stringify({
          member_account: memberAccount,
          game_uid: gameUid,
          balance,
          home_url: homeUrl,
        }),
      });

      const rawText = await upstream.text();
      try {
        upstreamPayload = rawText ? JSON.parse(rawText) : null;
      } catch {
        upstreamPayload = { code: upstream.status, msg: rawText || 'Resposta inválida da SilentAPI' };
      }

      const gameLaunchUrl = String(upstreamPayload?.payload?.game_launch_url || '').trim();
      if (!upstream.ok || upstreamPayload?.code !== 0 || !gameLaunchUrl) {
        sendJson(res, 502, {
          error: 'Falha ao criar sessão do jogo na SilentAPI.',
          upstream: upstreamPayload,
        });
        return true;
      }

      await ensureAppCasinoTables(pool);
      await pool.query(
        `INSERT INTO ${APP_CASINO_LAUNCHES_TABLE} (id, user_id, member_account, game_uid, requested_balance, home_url, game_launch_url, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
        [randomId(16), user.id, memberAccount, gameUid, balance, homeUrl, gameLaunchUrl],
      );

      sendJson(res, 200, {
        code: 0,
        msg: 'Success',
        payload: {
          game_launch_url: gameLaunchUrl,
        },
      });
      return true;
    } catch (error: any) {
      sendJson(res, 500, {
        error: 'Erro interno ao lançar o jogo.',
        details: String(error?.message || error),
      });
      return true;
    }
  }

  if (req.method === 'POST' && path === '/api/casino/webhook') {
    if (!config.secret) {
      sendJson(res, 503, { error: 'Webhook de casino não configurado.' });
      return true;
    }

    const rawBody = await getRawBody(req).catch((error) => {
      sendJson(res, 400, { error: String(error?.message || 'Invalid payload') });
      return null;
    });
    if (!rawBody) return true;

    const signature = getSignature(req);
    const expectedSignature = crypto.createHmac('sha256', config.secret).update(rawBody).digest('hex');
    if (!safeEqualHex(signature, expectedSignature)) {
      sendJson(res, 401, { error: 'Invalid Signature' });
      return true;
    }

    let payload: any = null;
    try {
      payload = JSON.parse(rawBody.toString('utf8') || '{}');
    } catch {
      return badRequest(res, 'Invalid JSON'), true;
    }

    const serialNumber = String(payload?.serial_number || '').trim();
    const memberAccount = String(payload?.member_account || '').trim();
    if (!serialNumber || !memberAccount) {
      return badRequest(res, 'serial_number e member_account são obrigatórios'), true;
    }

    const userId = memberAccount;
    const betAmount = toNumber(payload?.bet_amount);
    const winAmount = toNumber(payload?.win_amount);
    const netAmount = Number((winAmount - betAmount).toFixed(2));
    const gameUid = String(payload?.game_uid || '').trim();
    const gameRound = String(payload?.game_round || '').trim();
    const currency = String(payload?.currency || '').trim();

    await ensureAppCasinoTables(pool);
    await ensureAppTransactionsTable(pool);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [serialNumber]);

      const existing = await client.query(
        `SELECT serial_number FROM ${APP_CASINO_CALLBACKS_TABLE} WHERE serial_number = $1 LIMIT 1`,
        [serialNumber],
      );
      if (existing.rows.length > 0) {
        const currentBalance = await getLockedBalance(client, userId);
        await client.query('COMMIT');
        sendJson(res, 200, {
          code: 0,
          msg: 'Success',
          balance: currentBalance ?? 0,
        });
        return true;
      }

      const currentBalance = await getLockedBalance(client, userId);
      if (currentBalance == null) {
        await client.query('ROLLBACK');
        sendJson(res, 404, { error: 'Utilizador não encontrado' });
        return true;
      }

      const newBalance = Number((currentBalance + netAmount).toFixed(2));
      if (newBalance < 0) {
        await client.query('ROLLBACK');
        sendJson(res, 409, { error: 'Saldo insuficiente para processar o callback' });
        return true;
      }

      await client.query(`UPDATE profiles SET balance = $2, updated_at = NOW() WHERE user_id = $1`, [userId, newBalance]);
      await client.query(
        `INSERT INTO ${APP_CASINO_CALLBACKS_TABLE}
         (serial_number, user_id, member_account, game_uid, game_round, currency, bet_amount, win_amount, net_amount, payload, processed_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, NOW(), NOW())`,
        [
          serialNumber,
          userId,
          memberAccount,
          gameUid || null,
          gameRound || null,
          currency || null,
          betAmount,
          winAmount,
          netAmount,
          JSON.stringify(payload),
        ],
      );

      await insertCasinoTransaction(client, {
        userId,
        type: 'casino_bet',
        amount: betAmount,
        serialNumber,
        gameUid,
        gameRound,
      });
      await insertCasinoTransaction(client, {
        userId,
        type: 'casino_win',
        amount: winAmount,
        serialNumber,
        gameUid,
        gameRound,
      });

      await client.query('COMMIT');
      sendJson(res, 200, {
        code: 0,
        msg: 'Success',
        balance: newBalance,
      });
      return true;
    } catch (error: any) {
      await client.query('ROLLBACK').catch(() => null);
      sendJson(res, 500, {
        error: 'Erro ao processar callback do casino.',
        details: String(error?.message || error),
      });
      return true;
    } finally {
      client.release();
    }
  }

  return false;
}
