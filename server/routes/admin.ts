import type http from 'http';
import type pg from 'pg';
import nodePath from 'node:path';
import { promises as fs } from 'node:fs';
import { randomId } from '../lib/crypto';
import { readJsonBody, sendJson, badRequest, unauthorized, forbid } from '../lib/http';
import { requireUser, isAdmin } from '../lib/auth';
import type { EventsService } from './events';
import {
  settleEventById,
  settleByResult,
  autoSettleFromCache,
  evaluateSelection,
  type MatchResult,
} from '../services/settlement';
import { APP_BETS_TABLE, APP_TRANSACTIONS_TABLE, ensureAppBetsTable, ensureAppTransactionsTable } from '../lib/appTables';
import { buildSportsDataPipelineStatus } from '../services/dataPipeline';
import { getKycStorageRoot } from '../lib/kycStorage';
import { getStatPalConfig } from '../services/statPal';

interface TestKeyBody { key: string; sport?: string; matchId?: string; leagueId?: string; teamId?: string; playerId?: string; coachId?: string }
type WalletAdjustBody = { amount?: number | string; note?: string; mode?: 'credit' | 'debit' };
type BonusAdjustBody = { amount?: number | string; note?: string };
type ManualWithdrawalBody = { amount?: number | string; note?: string; method?: string };
type KycDecisionBody = { kyc_id?: string; decision?: 'verified' | 'rejected'; reason?: string };
type SuspendUserBody = { reason?: string };
type PromotionNotifyBody = {
  title?: string;
  body?: string;
  cta_label?: string;
  cta_target?: string;
  user_ids?: string[];
};

function toSub(sport: string): string {
  const s = String(sport || '').toLowerCase().replace(/[_\s]+/g, '-').replace(/[^a-z0-9-]/g, '');
  if (s === 'football' || s === 'futebol' || s === 'soccer') return 'football';
  if (s === 'ice-hockey' || s === 'hockey' || s === 'icehockey') return 'hockey';
  return s || 'football';
}

function detectSportsApiEnvSource(): string {
  if (process.env.STATPAL_ACCESS_KEY) return 'STATPAL_ACCESS_KEY';
  if (process.env.SPORTS_API_PRO_KEY) return 'SPORTS_API_PRO_KEY';
  if (process.env.SPORTSAPIPRO_KEY) return 'SPORTSAPIPRO_KEY';
  if (process.env.SPORTSAPI_PRO_KEY) return 'SPORTSAPI_PRO_KEY';
  if (process.env.SPORTS_API_KEY) return 'SPORTS_API_KEY';
  if (process.env.STATPAL_KEY) return 'STATPAL_KEY';
  return '';
}

async function probeUrl(url: string, key: string): Promise<{ url: string; status: number; ok: boolean; ms: number; keys: string[]; sample: string; error?: string }> {
  const t0 = Date.now();
  try {
    const provider = getStatPalConfig().provider;
    const target = new URL(url);
    if (provider === 'statpal') {
      target.searchParams.set('access_key', key);
    }
    const r = await fetch(target.toString(), {
      headers: provider === 'statpal'
        ? { accept: 'application/json' }
        : { 'x-api-key': key, accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    const text = await r.text().catch(() => '');
    const ms = Date.now() - t0;
    let keys: string[] = [];
    try {
      const j = JSON.parse(text);
      if (j && typeof j === 'object') keys = Object.keys(j).slice(0, 20);
    } catch { /* not json */ }
    return { url, status: r.status, ok: r.ok, ms, keys, sample: text.slice(0, 400) };
  } catch (e: any) {
    return { url, status: 0, ok: false, ms: Date.now() - t0, keys: [], sample: '', error: String(e?.message || e) };
  }
}

function mapStatPalSportPath(sport: string): string {
  const s = String(sport || '').trim().toLowerCase();
  if (s === 'soccer' || s === 'football' || s === 'futebol') return 'soccer';
  if (s === 'tennis') return 'tennis';
  if (s === 'basketball') return 'nba';
  if (s === 'baseball') return 'mlb';
  if (s === 'ice-hockey' || s === 'icehockey' || s === 'hockey') return 'nhl';
  if (s === 'volleyball' || s === 'volei') return 'volleyball';
  if (s === 'mma' || s === 'ufc') return 'mma';
  return s || 'soccer';
}

type ToggleOperatorBody = { is_operator?: boolean };
type EditOddsBody = { home_odd?: number; draw_odd?: number; away_odd?: number };

type ManualSettleBody = {
  event_id: string;
  sport?: string;
  home_score?: number;
  away_score?: number;
  ht_home_score?: number;
  ht_away_score?: number;
  total_corners?: number;
  total_cards?: number;
  status?: 'finished' | 'cancelled' | 'postponed' | 'abandoned';
  home_name?: string;
  away_name?: string;
};

type UpdateBetStatusBody = {
  status?: 'won' | 'lost' | 'void' | 'pending';
};

function toBool(v: any): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v === 1;
  const s = String(v ?? '').toLowerCase();
  if (s === '1' || s === 'true' || s === 'yes') return true;
  return false;
}

function toNum(v: any, def = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function toMoney(v: any): number {
  const n = typeof v === 'string' ? Number(String(v).replace(',', '.').trim()) : Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

type Queryable = pg.Pool | pg.PoolClient;

async function ensureProfileRecord(client: Queryable, userId: string): Promise<void> {
  const exists = await client.query(`SELECT 1 FROM profiles WHERE user_id = $1 LIMIT 1`, [userId]);
  if (exists.rows?.[0]) return;
  const userRow = await client.query(`SELECT email, name FROM users WHERE id = $1 LIMIT 1`, [userId]);
  const user = userRow.rows?.[0];
  if (!user) return;
  await client.query(
    `INSERT INTO profiles (id, user_id, email, full_name, created_at, updated_at)
     VALUES ($1, $2, $3, $4, NOW(), NOW())`,
    [randomId(16), userId, String(user.email || ''), String(user.name || '') || null],
  );
}

async function getLockedBalances(client: Queryable, userId: string): Promise<{ balance: number; free_bet_balance: number }> {
  await ensureProfileRecord(client, userId);
  const r = await client.query(
    `SELECT balance, free_bet_balance
     FROM profiles
     WHERE user_id = $1
     FOR UPDATE`,
    [userId],
  );
  const row = r.rows?.[0] || {};
  return {
    balance: toMoney(row.balance),
    free_bet_balance: toMoney(row.free_bet_balance),
  };
}

async function listAdminUsers(pool: pg.Pool): Promise<any[]> {
  const r = await pool.query(
    `SELECT
       u.id,
       u.email,
       u.name,
       u.role,
       COALESCE(p.balance, 0) AS balance,
       COALESCE(p.free_bet_balance, 0) AS free_bet_balance,
       COALESCE(p.kyc_verified, FALSE) AS kyc_verified,
       COALESCE(doc.pending_docs, 0) AS pending_docs,
       COALESCE(doc.total_docs, 0) AS total_docs,
       doc.last_document_at
     FROM users u
     LEFT JOIN profiles p ON p.user_id = u.id
     LEFT JOIN (
       SELECT
         user_id,
         COUNT(*)::int AS total_docs,
         COUNT(*) FILTER (WHERE UPPER(COALESCE(status, 'SUBMITTED')) IN ('SUBMITTED', 'PENDING'))::int AS pending_docs,
         MAX(created_at) AS last_document_at
       FROM user_documents
       GROUP BY user_id
     ) doc ON doc.user_id = u.id
     ORDER BY u.created_at DESC
     LIMIT 500`,
  );
  return (r.rows || []).map((x: any) => ({
    id: String(x.id),
    email: String(x.email || ''),
    full_name: String(x.name || ''),
    is_operator: String(x.role || '') === 'admin' ? 1 : 0,
    balance: toMoney(x.balance),
    free_bet_balance: toMoney(x.free_bet_balance),
    kyc_status: x.kyc_verified ? 'verified' : Number(x.pending_docs || 0) > 0 ? 'pending' : 'unverified',
    pending_docs: Number(x.pending_docs || 0),
    total_docs: Number(x.total_docs || 0),
    last_document_at: x.last_document_at ? new Date(x.last_document_at).toISOString() : null,
  }));
}

async function buildAdminKycList(pool: pg.Pool, filterUserId = ''): Promise<any[]> {
  const params: any[] = [];
  let where = '';
  if (filterUserId) {
    params.push(filterUserId);
    where = `WHERE d.user_id = $${params.length}`;
  }
  const docsResult = await pool.query(
    `SELECT
       d.id,
       d.user_id,
       d.doc_type,
       d.filename,
       d.mime_type,
       d.status,
       d.created_at,
       u.email,
       u.name,
       u.created_at AS registration_date,
       COALESCE(p.full_name, u.name, '') AS full_name,
       COALESCE(p.kyc_verified, FALSE) AS kyc_verified
     FROM user_documents d
     JOIN users u ON u.id = d.user_id
     LEFT JOIN profiles p ON p.user_id = d.user_id
     ${where}
     ORDER BY d.created_at DESC`,
    params,
  );

  const grouped = new Map<string, any>();
  for (const row of docsResult.rows || []) {
    const userId = String(row.user_id || '');
    if (!grouped.has(userId)) {
      grouped.set(userId, {
        kyc_id: userId,
        user_id: userId,
        email: String(row.email || ''),
        username: String(row.email || ''),
        full_name: String(row.full_name || row.name || ''),
        registration_date: row.registration_date ? new Date(row.registration_date).toISOString() : '',
        country: '',
        status: row.kyc_verified ? 'verified' : 'pending',
        created_at: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
        documents: [],
      });
    }
    const entry = grouped.get(userId);
    entry.documents.push({
      id: String(row.id),
      type: String(row.doc_type || ''),
      url: `/api/admin/kyc/documents/${encodeURIComponent(String(row.id))}`,
      created_at: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
      ip_address: '',
      status: String(row.status || 'SUBMITTED'),
      filename: String(row.filename || ''),
      mime_type: String(row.mime_type || ''),
    });
    if (String(row.status || '').toLowerCase() === 'rejected') entry.status = 'rejected';
  }

  return Array.from(grouped.values()).filter((entry) => filterUserId || entry.documents.some((d: any) => {
    const s = String(d.status || '').toUpperCase();
    return s === 'SUBMITTED' || s === 'PENDING';
  }));
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

export async function handleAdminRoutes(
  pool: pg.Pool,
  events: EventsService,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  apiKey = '',
): Promise<boolean> {
  const path = url.pathname;

  if (!path.startsWith('/api/admin/') && !path.startsWith('/api/metrics/')) return false;

  const u = await requireUser(pool, req);
  if (!u) return unauthorized(res), true;
  if (!isAdmin(u)) return forbid(res), true;

  // ── Users ────────────────────────────────────────────────────────────────────
  if (req.method === 'GET' && path === '/api/admin/users') {
    sendJson(res, 200, await listAdminUsers(pool));
    return true;
  }

  const toggle = path.match(/^\/api\/admin\/users\/([^/]+)\/toggle-operator$/);
  if (toggle && req.method === 'POST') {
    const userId = decodeURIComponent(toggle[1] || '');
    const body = await readJsonBody<ToggleOperatorBody>(req).catch(() => null);
    if (!body) return badRequest(res, 'Invalid JSON'), true;
    const val = toBool(body.is_operator);
    await pool.query(`UPDATE users SET role = $2, updated_at = NOW() WHERE id = $1`, [userId, val ? 'admin' : 'user']);
    sendJson(res, 200, { success: true });
    return true;
  }

  const walletAdjust = path.match(/^\/api\/admin\/users\/([^/]+)\/wallet-adjust$/);
  if (walletAdjust && req.method === 'POST') {
    const userId = decodeURIComponent(walletAdjust[1] || '');
    const body = await readJsonBody<WalletAdjustBody>(req).catch(() => null);
    const amount = toMoney(body?.amount);
    const mode = body?.mode === 'debit' ? 'debit' : 'credit';
    if (!amount || amount <= 0) return badRequest(res, 'Valor inválido'), true;
    await ensureAppTransactionsTable(pool);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const profile = await getLockedBalances(client, userId);
      if (mode === 'debit' && profile.balance < amount) {
        await client.query('ROLLBACK');
        return badRequest(res, 'Saldo insuficiente para débito manual'), true;
      }
      const nextBalance = mode === 'credit' ? profile.balance + amount : profile.balance - amount;
      await client.query(
        `UPDATE profiles SET balance = $2, updated_at = NOW() WHERE user_id = $1`,
        [userId, nextBalance],
      );
      await client.query(
        `INSERT INTO ${APP_TRANSACTIONS_TABLE} (id, user_id, type, amount, status, payment_method, description, completed_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'completed', 'admin_manual', $5, NOW(), NOW(), NOW())`,
        [randomId(16), userId, mode === 'credit' ? 'admin_credit' : 'admin_debit', amount, String(body?.note || 'Ajuste manual de carteira')],
      );
      await client.query('COMMIT');
      sendJson(res, 200, { success: true, balance: nextBalance });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => null);
      throw e;
    } finally {
      client.release();
    }
    return true;
  }

  const bonusAdjust = path.match(/^\/api\/admin\/users\/([^/]+)\/bonus-adjust$/);
  if (bonusAdjust && req.method === 'POST') {
    const userId = decodeURIComponent(bonusAdjust[1] || '');
    const body = await readJsonBody<BonusAdjustBody>(req).catch(() => null);
    const amount = toMoney(body?.amount);
    if (!amount || amount <= 0) return badRequest(res, 'Valor inválido'), true;
    await ensureAppTransactionsTable(pool);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const profile = await getLockedBalances(client, userId);
      const nextBonus = profile.free_bet_balance + amount;
      await client.query(
        `UPDATE profiles SET free_bet_balance = $2, updated_at = NOW() WHERE user_id = $1`,
        [userId, nextBonus],
      );
      await client.query(
        `INSERT INTO ${APP_TRANSACTIONS_TABLE} (id, user_id, type, amount, status, payment_method, description, completed_at, created_at, updated_at)
         VALUES ($1, $2, 'admin_bonus', $3, 'completed', 'admin_bonus', $4, NOW(), NOW(), NOW())`,
        [randomId(16), userId, amount, String(body?.note || 'Crédito manual de bónus/freebet')],
      );
      await client.query('COMMIT');
      sendJson(res, 200, { success: true, free_bet_balance: nextBonus });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => null);
      throw e;
    } finally {
      client.release();
    }
    return true;
  }

  const manualWithdrawal = path.match(/^\/api\/admin\/users\/([^/]+)\/manual-withdrawal$/);
  if (manualWithdrawal && req.method === 'POST') {
    const userId = decodeURIComponent(manualWithdrawal[1] || '');
    const body = await readJsonBody<ManualWithdrawalBody>(req).catch(() => null);
    const amount = toMoney(body?.amount);
    if (!amount || amount <= 0) return badRequest(res, 'Valor inválido'), true;
    await ensureAppTransactionsTable(pool);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const profile = await getLockedBalances(client, userId);
      if (profile.balance < amount) {
        await client.query('ROLLBACK');
        return badRequest(res, 'Saldo insuficiente para retirada manual'), true;
      }
      const nextBalance = profile.balance - amount;
      await client.query(
        `UPDATE profiles SET balance = $2, updated_at = NOW() WHERE user_id = $1`,
        [userId, nextBalance],
      );
      await client.query(
        `INSERT INTO ${APP_TRANSACTIONS_TABLE} (id, user_id, type, amount, status, payment_method, description, completed_at, created_at, updated_at)
         VALUES ($1, $2, 'withdrawal', $3, 'completed', $4, $5, NOW(), NOW(), NOW())`,
        [randomId(16), userId, amount, String(body?.method || 'admin_manual'), String(body?.note || 'Retirada manual pelo admin')],
      );
      await client.query('COMMIT');
      sendJson(res, 200, { success: true, balance: nextBalance });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => null);
      throw e;
    } finally {
      client.release();
    }
    return true;
  }

  const suspendUser = path.match(/^\/api\/admin\/users\/([^/]+)\/suspend$/);
  if (suspendUser && req.method === 'POST') {
    const userId = decodeURIComponent(suspendUser[1] || '');
    const body = await readJsonBody<SuspendUserBody>(req).catch(() => null);
    const reason = String(body?.reason || 'Conta suspensa pelo admin').trim();
    await ensureProfileRecord(pool, userId);
    await pool.query(
      `UPDATE profiles
       SET self_exclude = TRUE,
           self_exclude_until = NOW() + INTERVAL '10 years',
           updated_at = NOW()
       WHERE user_id = $1`,
      [userId],
    );
    await ensureAppTransactionsTable(pool);
    await pool.query(
      `INSERT INTO ${APP_TRANSACTIONS_TABLE} (id, user_id, type, amount, status, payment_method, description, created_at, updated_at)
       VALUES ($1, $2, 'admin_note', 0, 'completed', 'admin_suspend', $3, NOW(), NOW())`,
      [randomId(16), userId, reason],
    );
    sendJson(res, 200, { success: true });
    return true;
  }

  if (req.method === 'GET' && path === '/api/admin/kyc/pending') {
    const filterUserId = String(url.searchParams.get('user') || '').trim();
    sendJson(res, 200, await buildAdminKycList(pool, filterUserId));
    return true;
  }

  if (req.method === 'POST' && path === '/api/admin/kyc/decision') {
    const body = await readJsonBody<KycDecisionBody>(req).catch(() => null);
    const userId = String(body?.kyc_id || '').trim();
    const decision = body?.decision;
    if (!userId || !decision) return badRequest(res, 'Missing decision payload'), true;
    const docStatus = decision === 'verified' ? 'verified' : 'rejected';
    await ensureProfileRecord(pool, userId);
    await pool.query(
      `UPDATE user_documents
       SET status = $2,
           updated_at = NOW()
       WHERE user_id = $1
         AND UPPER(COALESCE(status, 'SUBMITTED')) IN ('SUBMITTED', 'PENDING', 'REJECTED', 'VERIFIED')`,
      [userId, docStatus],
    );
    await pool.query(
      `UPDATE profiles
       SET kyc_verified = $2,
           updated_at = NOW()
       WHERE user_id = $1`,
      [userId, decision === 'verified'],
    );
    sendJson(res, 200, { success: true });
    return true;
  }

  if (req.method === 'POST' && path === '/api/admin/notifications/promotion') {
    const body = await readJsonBody<PromotionNotifyBody>(req).catch(() => null);
    const title = String(body?.title || '').trim();
    const message = String(body?.body || '').trim();
    if (!title || !message) return badRequest(res, 'Título e mensagem são obrigatórios'), true;
    const targetIds = Array.isArray(body?.user_ids)
      ? body!.user_ids.map((id) => String(id || '').trim()).filter(Boolean)
      : [];
    const r = targetIds.length > 0
      ? await pool.query(`SELECT id FROM users WHERE id = ANY($1::text[])`, [targetIds])
      : await pool.query(`SELECT id FROM users ORDER BY created_at DESC LIMIT 1000`);
    const userIds = (r.rows || []).map((row: any) => String(row.id || '')).filter(Boolean);
    for (const userId of userIds) {
      await createUserNotification(pool, userId, {
        kind: 'promo',
        title,
        body: message,
        cta_label: body?.cta_label || 'Abrir promoções',
        cta_target: body?.cta_target || '/promotions',
      });
    }
    sendJson(res, 200, { success: true, sent: userIds.length });
    return true;
  }

  const kycDoc = path.match(/^\/api\/admin\/kyc\/documents\/([^/]+)$/);
  if (kycDoc && req.method === 'GET') {
    const docId = decodeURIComponent(kycDoc[1] || '');
    const r = await pool.query(
      `SELECT filename, mime_type, storage_path
       FROM user_documents
       WHERE id = $1
       LIMIT 1`,
      [docId],
    );
    const row = r.rows?.[0];
    if (!row?.storage_path) return badRequest(res, 'Documento não encontrado'), true;
    const abs = nodePath.join(getKycStorageRoot(), String(row.storage_path));
    const file = await fs.readFile(abs).catch(() => null);
    if (!file) return badRequest(res, 'Ficheiro não encontrado'), true;
    res.statusCode = 200;
    res.setHeader('cache-control', 'no-store');
    res.setHeader('content-type', String(row.mime_type || 'application/octet-stream'));
    res.setHeader('content-disposition', `inline; filename="${encodeURIComponent(String(row.filename || 'documento'))}"`);
    res.end(file);
    return true;
  }

  // ── Withdrawals ──────────────────────────────────────────────────────────────
  if (req.method === 'GET' && path === '/api/admin/withdrawals') {
    await ensureAppTransactionsTable(pool);
    const r = await pool.query(
      `SELECT id, user_id, amount, status, payment_method, created_at
       FROM ${APP_TRANSACTIONS_TABLE}
       WHERE type = 'withdrawal'
       ORDER BY created_at DESC
       LIMIT 500`,
    );
    sendJson(res, 200, { withdrawals: r.rows || [] });
    return true;
  }

  // ── Bets list ────────────────────────────────────────────────────────────────
  if (req.method === 'GET' && path === '/api/admin/bets') {
    await ensureAppBetsTable(pool);
    const statusFilter = url.searchParams.get('status');
    const params: any[] = [];
    let where = '';
    if (statusFilter) {
      params.push(statusFilter);
      where = `WHERE status = $${params.length}`;
    }
    const r = await pool.query(
      `SELECT id, user_id, bet_type, stake, potential_win, total_odds, status, winnings, settled_at, created_at, selections
       FROM ${APP_BETS_TABLE}
       ${where}
       ORDER BY created_at DESC
       LIMIT 500`,
      params,
    );
    sendJson(res, 200, { bets: r.rows || [] });
    return true;
  }

  // ── Admin update bet status (manual) ────────────────────────────────────────
  const betUpdateMatch = path.match(/^\/api\/admin\/bets\/([^/]+)$/);
  if (betUpdateMatch && req.method === 'PUT') {
    await ensureAppBetsTable(pool);
    await ensureAppTransactionsTable(pool);
    const betId = decodeURIComponent(betUpdateMatch[1] || '');
    const body = await readJsonBody<UpdateBetStatusBody>(req).catch(() => null);
    if (!body?.status) return badRequest(res, 'Missing status'), true;
    const allowed = ['won', 'lost', 'void', 'pending'];
    if (!allowed.includes(body.status)) return badRequest(res, 'Invalid status'), true;

    const r = await pool.query(
      `SELECT id, user_id, stake, potential_win, is_free_bet, status FROM ${APP_BETS_TABLE} WHERE id = $1 LIMIT 1`,
      [betId],
    );
    const bet = r.rows?.[0];
    if (!bet) return badRequest(res, 'Bet not found'), true;

    const prevStatus = String(bet.status);
    if (prevStatus !== 'pending') return badRequest(res, `Bet already settled: ${prevStatus}`), true;

    const stake = Number(bet.stake) || 0;
    const potWin = Number(bet.potential_win) || 0;
    const isFree = Boolean(bet.is_free_bet);

    let winnings = 0;
    if (body.status === 'won') {
      winnings = isFree ? potWin - stake : potWin;
    } else if (body.status === 'void') {
      winnings = stake;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE ${APP_BETS_TABLE} SET status = $2, winnings = $3, settled_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [betId, body.status, winnings],
      );
      if (winnings > 0) {
        await client.query(
          `UPDATE profiles SET balance = balance + $2, updated_at = NOW() WHERE user_id = $1`,
          [bet.user_id, winnings],
        );
        const txType = body.status === 'void' ? 'bet_refund' : 'bet_win';
        await client.query(
          `INSERT INTO ${APP_TRANSACTIONS_TABLE} (id, user_id, type, amount, status, description, completed_at, created_at, updated_at)
           VALUES ($1, $2, $3, $4, 'completed', $5, NOW(), NOW(), NOW())`,
          [randomId(16), bet.user_id, txType, winnings, `Settlement manual: aposta ${betId}`],
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    sendJson(res, 200, { success: true, status: body.status, winnings });
    return true;
  }

  // ── Settlement: pending bets summary ────────────────────────────────────────
  if (req.method === 'GET' && path === '/api/admin/settlement/pending') {
    await ensureAppBetsTable(pool);
    const r = await pool.query(
      `SELECT
         COUNT(*)::int AS total_pending,
         COUNT(DISTINCT jsonb_array_elements(selections)->>'event_id')::int AS unique_events,
         SUM(stake)::float AS total_stake_at_risk,
         SUM(potential_win)::float AS total_potential_win
       FROM ${APP_BETS_TABLE} WHERE status = 'pending'`,
    );
    const row = r.rows?.[0] || {};
    sendJson(res, 200, {
      total_pending: row.total_pending ?? 0,
      unique_events: row.unique_events ?? 0,
      total_stake_at_risk: row.total_stake_at_risk ?? 0,
      total_potential_win: row.total_potential_win ?? 0,
    });
    return true;
  }

  // ── Settlement: auto-settle from events cache ────────────────────────────────
  if (req.method === 'POST' && path === '/api/admin/settlement/auto') {
    const eventsCache = events.getEventsCache?.() ?? new Map();
    const report = await autoSettleFromCache(pool, apiKey, eventsCache);
    sendJson(res, 200, { success: true, report });
    return true;
  }

  // ── Settlement: settle specific event by ID (fetch result from API) ──────────
  if (req.method === 'POST' && path === '/api/admin/settlement/settle-event') {
    const body = await readJsonBody<{ event_id?: string; sport?: string }>(req).catch(() => null);
    if (!body?.event_id) return badRequest(res, 'Missing event_id'), true;
    const eventsCache = events.getEventsCache?.() ?? new Map();
    const result = await settleEventById(
      pool,
      apiKey,
      String(body.event_id),
      String(body.sport || 'soccer'),
      eventsCache,
    );
    sendJson(res, 200, result);
    return true;
  }

  // ── Settlement: manual result override ──────────────────────────────────────
  if (req.method === 'POST' && path === '/api/admin/settlement/manual') {
    const body = await readJsonBody<ManualSettleBody>(req).catch(() => null);
    if (!body?.event_id) return badRequest(res, 'Missing event_id'), true;

    const matchResult: MatchResult = {
      eventId: String(body.event_id),
      sport: String(body.sport || 'soccer'),
      status: body.status ?? 'finished',
      homeScore: toNum(body.home_score, 0),
      awayScore: toNum(body.away_score, 0),
      htHomeScore: body.ht_home_score != null ? toNum(body.ht_home_score) : null,
      htAwayScore: body.ht_away_score != null ? toNum(body.ht_away_score) : null,
      totalCorners: body.total_corners != null ? toNum(body.total_corners) : null,
      homeCorners: null,
      awayCorners: null,
      totalCards: body.total_cards != null ? toNum(body.total_cards) : null,
      homeCards: null,
      awayCards: null,
      homeName: String(body.home_name || ''),
      awayName: String(body.away_name || ''),
    };

    const result = await settleByResult(pool, matchResult);
    sendJson(res, 200, { success: true, result: matchResult, ...result });
    return true;
  }

  // ── Settlement: evaluate single selection (dry-run) ──────────────────────────
  if (req.method === 'POST' && path === '/api/admin/settlement/evaluate') {
    const body = await readJsonBody<{
      market?: string;
      selection?: string;
      home_score?: number;
      away_score?: number;
      ht_home?: number;
      ht_away?: number;
      status?: string;
    }>(req).catch(() => null);
    if (!body?.selection) return badRequest(res, 'Missing selection'), true;

    const result: MatchResult = {
      eventId: 'test',
      sport: 'soccer',
      status: (body.status as any) ?? 'finished',
      homeScore: toNum(body.home_score, 0),
      awayScore: toNum(body.away_score, 0),
      htHomeScore: body.ht_home != null ? toNum(body.ht_home) : null,
      htAwayScore: body.ht_away != null ? toNum(body.ht_away) : null,
      totalCorners: null,
      homeCorners: null,
      awayCorners: null,
      totalCards: null,
      homeCards: null,
      awayCards: null,
      homeName: '',
      awayName: '',
    };

    const outcome = evaluateSelection(String(body.market || ''), String(body.selection), result);
    sendJson(res, 200, { outcome, market: body.market, selection: body.selection, result });
    return true;
  }

  // ── Settlement: list recently settled bets ───────────────────────────────────
  if (req.method === 'GET' && path === '/api/admin/settlement/history') {
    await ensureAppBetsTable(pool);
    const r = await pool.query(
      `SELECT id, user_id, bet_type, stake, potential_win, total_odds, status, winnings, settled_at, selections
       FROM ${APP_BETS_TABLE}
       WHERE status IN ('won', 'lost', 'void')
       ORDER BY settled_at DESC NULLS LAST
       LIMIT 200`,
    );
    sendJson(res, 200, { bets: r.rows || [] });
    return true;
  }

  // ── Alerts ───────────────────────────────────────────────────────────────────
  if (req.method === 'GET' && path === '/api/admin/alerts') {
    sendJson(res, 200, { alerts: [] });
    return true;
  }

  if (req.method === 'GET' && path === '/api/admin/data-pipeline') {
    const [adminOddsEvents, eventsCache] = await Promise.all([
      events.getAdminOddsEvents().catch(() => []),
      Promise.resolve(events.getEventsCache?.() ?? new Map()),
    ]);
    sendJson(
      res,
      200,
      buildSportsDataPipelineStatus({
        apiKey,
        adminOddsEvents,
        eventsCache,
        provider: getStatPalConfig().provider,
      }),
    );
    return true;
  }

  if (req.method === 'GET' && path === '/api/admin/sports-provider-status') {
    const [adminOddsEvents, eventsCache] = await Promise.all([
      events.getAdminOddsEvents().catch(() => []),
      Promise.resolve(events.getEventsCache?.() ?? new Map()),
    ]);
    const providerMetrics = events.getProviderMetrics?.() ?? { operations: [] };
    const providerConfig = events.getProviderConfig?.() ?? {};
    const activeProvider = String((providerConfig as any)?.provider || getStatPalConfig().provider || 'statpal');
    sendJson(res, 200, {
      provider: activeProvider,
      configured: Boolean(apiKey),
      envSource: detectSportsApiEnvSource(),
      debugTokenConfigured: Boolean(String(process.env.ODDS_DEBUG_TOKEN || '').trim()),
      oddsEvents: Array.isArray(adminOddsEvents) ? adminOddsEvents.length : 0,
      eventsCacheEntries: typeof (eventsCache as any)?.size === 'number' ? (eventsCache as any).size : 0,
      config: providerConfig,
      metrics: providerMetrics,
      warnings: [
        !apiKey ? `${activeProvider === 'statpal' ? 'STATPAL_ACCESS_KEY' : 'SPORTS_API_PRO_KEY'} ausente` : '',
        activeProvider !== 'statpal' && detectSportsApiEnvSource() && detectSportsApiEnvSource() !== 'SPORTS_API_PRO_KEY'
          ? `alias legado em uso: ${detectSportsApiEnvSource()}`
          : '',
      ].filter(Boolean),
    });
    return true;
  }

  // ── Odds management ──────────────────────────────────────────────────────────
  if (req.method === 'GET' && path === '/api/admin/odds') {
    const list = await events.getAdminOddsEvents().catch(() => []);
    sendJson(res, 200, { events: list });
    return true;
  }

  const edit = path.match(/^\/api\/admin\/odds\/([^/]+)$/);
  if (edit && req.method === 'POST') {
    const eventId = decodeURIComponent(edit[1] || '');
    const body = await readJsonBody<EditOddsBody>(req).catch(() => null);
    if (!body) return badRequest(res, 'Invalid JSON'), true;
    await events.setOddsOverride(eventId, {
      home_odd: body.home_odd,
      draw_odd: body.draw_odd,
      away_odd: body.away_odd,
    });
    sendJson(res, 200, { success: true });
    return true;
  }

  // ── Metrics ──────────────────────────────────────────────────────────────────
  if (req.method === 'GET' && path === '/api/metrics/users') {
    const r = await pool.query(`SELECT COUNT(*)::int AS users FROM users`);
    sendJson(res, 200, { users: r.rows?.[0]?.users ?? 0 });
    return true;
  }

  if (req.method === 'GET' && path === '/api/metrics/odds') {
    const eventsList = await events.getAdminOddsEvents().catch(() => []);
    const eventsCount = eventsList.length;
    const withH2h = eventsList.filter((e: any) => Number(e.home_odd || 0) > 1 && Number(e.away_odd || 0) > 1).length;
    sendJson(res, 200, { events: eventsCount, imported_odds: withH2h, live: eventsList.filter((e: any) => Number(e.is_live || 0) === 1).length, bets: 0 });
    return true;
  }

  if (req.method === 'GET' && path === '/api/metrics/sports') {
    const metrics = events.getProviderMetrics?.() ?? { operations: [] };
    const config = events.getProviderConfig?.() ?? {};
    const activeProvider = String((config as any)?.provider || getStatPalConfig().provider || 'statpal');
    sendJson(res, 200, {
      provider: activeProvider,
      configured: Boolean(apiKey),
      envSource: detectSportsApiEnvSource(),
      config,
      ...(metrics || {}),
    });
    return true;
  }

  if (req.method === 'GET' && path === '/api/metrics/settlement') {
    await ensureAppBetsTable(pool);
    const r = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
         COUNT(*) FILTER (WHERE status = 'won')::int AS won,
         COUNT(*) FILTER (WHERE status = 'lost')::int AS lost,
         COUNT(*) FILTER (WHERE status = 'void')::int AS voided,
         COUNT(*) FILTER (WHERE status = 'cashed_out')::int AS cashed_out,
         COALESCE(SUM(winnings) FILTER (WHERE status = 'won'), 0)::float AS total_paid_out,
         COALESCE(SUM(stake) FILTER (WHERE status = 'pending'), 0)::float AS stake_at_risk
       FROM ${APP_BETS_TABLE}`,
    );
    sendJson(res, 200, r.rows?.[0] ?? {});
    return true;
  }

  // ── API key probe ─────────────────────────────────────────────────────────────
  if (req.method === 'POST' && path === '/api/admin/test-sports-key') {
    const body = await readJsonBody<TestKeyBody>(req).catch(() => null);
    if (!body?.key) return badRequest(res, 'Missing key'), true;
    const key = String(body.key).trim();
    const sport = String(body.sport || 'soccer').trim() || 'soccer';
    const matchId = String(body.matchId || '').trim();
    const leagueId = String(body.leagueId || '').trim();
    const teamId = String(body.teamId || '').trim();
    const playerId = String(body.playerId || '').trim();
    const coachId = String(body.coachId || '').trim();
    const today = new Date().toISOString().slice(0, 10);
    const statpalSport = mapStatPalSportPath(sport);
    const probes: Array<{ label: string; url: string }> = statpalSport === 'soccer'
            ? [
                { label: `Leagues (${sport})`, url: 'https://statpal.io/api/v2/soccer/leagues' },
                { label: `League seasons (${sport})`, url: 'https://statpal.io/api/v2/soccer/leagues/seasons' },
                { label: `Live matches (${sport})`, url: 'https://statpal.io/api/v2/soccer/matches/live' },
                { label: `Daily matches -1 (${sport})`, url: 'https://statpal.io/api/v2/soccer/matches/daily?offset=-1' },
                { label: `Live odds (${sport})`, url: 'https://statpal.io/api/v2/soccer/odds/live' },
                { label: `Injuries & suspensions (${sport})`, url: 'https://statpal.io/api/v2/soccer/injuries-suspensions' },
                { label: `Weather forecast (${sport})`, url: 'https://statpal.io/api/v2/soccer/weather-forecast' },
                { label: `Predictions (${sport})`, url: 'https://statpal.io/api/v2/soccer/predictions' },
                { label: `Live odds markets (${sport})`, url: 'https://statpal.io/api/v2/soccer/odds/live/markets' },
                { label: `Live match states (${sport})`, url: 'https://statpal.io/api/v2/soccer/odds/live/match-states' },
              ]
            : [
                { label: `Live scores (${sport})`, url: `https://statpal.io/api/v1/${statpalSport}/livescores` },
                { label: `Schedule (${sport} - hoje)`, url: `https://statpal.io/api/v1/${statpalSport}/schedule?date=${today}` },
                { label: `Odds (${sport})`, url: `https://statpal.io/api/v1/${statpalSport}/odds` },
              ];
    if (leagueId && statpalSport === 'soccer') {
      probes.push({ label: `League matches (${sport})`, url: `https://statpal.io/api/v2/soccer/leagues/${encodeURIComponent(leagueId)}/matches` });
      probes.push({ label: `League match stats (${sport})`, url: `https://statpal.io/api/v2/soccer/leagues/${encodeURIComponent(leagueId)}/matches/stats` });
      probes.push({ label: `League standings (${sport})`, url: `https://statpal.io/api/v2/soccer/leagues/${encodeURIComponent(leagueId)}/standings` });
      probes.push({ label: `League stats (${sport})`, url: `https://statpal.io/api/v2/soccer/leagues/${encodeURIComponent(leagueId)}/stats` });
    }
    if (teamId && statpalSport === 'soccer') {
      probes.push({ label: `Team (${sport})`, url: `https://statpal.io/api/v2/soccer/teams/${encodeURIComponent(teamId)}` });
    }
    if (playerId && statpalSport === 'soccer') {
      probes.push({ label: `Player (${sport})`, url: `https://statpal.io/api/v2/soccer/players/${encodeURIComponent(playerId)}` });
    }
    if (coachId && statpalSport === 'soccer') {
      probes.push({ label: `Coach (${sport})`, url: `https://statpal.io/api/v2/soccer/coaches/${encodeURIComponent(coachId)}` });
    }
    if (matchId && statpalSport === 'soccer') {
      probes.push({ label: `Live storylines (${sport})`, url: `https://statpal.io/api/v2/soccer/live-storylines?match_id=${encodeURIComponent(matchId)}` });
      probes.push({ label: `Team lineups (${sport})`, url: `https://statpal.io/api/v2/soccer/team-lineups?match_id=${encodeURIComponent(matchId)}` });
    }
    if (matchId && statpalSport !== 'soccer') {
      probes.push({ label: `Odds (id=${matchId})`,        url: `https://statpal.io/api/v1/${statpalSport}/odds?match_id=${encodeURIComponent(matchId)}` });
      probes.push({ label: `Match stats (id=${matchId})`, url: `https://statpal.io/api/v1/${statpalSport}/matches/${encodeURIComponent(matchId)}/stats` });
    }
    const results = await Promise.all(probes.map(async (p) => ({ label: p.label, ...(await probeUrl(p.url, key)) })));
    sendJson(res, 200, { results });
    return true;
  }

  return badRequest(res, 'Not supported'), true;
}
