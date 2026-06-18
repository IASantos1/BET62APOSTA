import type http from 'http';
import type pg from 'pg';
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

interface TestKeyBody { key: string; sport?: string; matchId?: string }

function toSub(sport: string): string {
  const s = String(sport || '').toLowerCase().replace(/[_\s]+/g, '-').replace(/[^a-z0-9-]/g, '');
  if (s === 'football' || s === 'futebol' || s === 'soccer') return 'football';
  if (s === 'ice-hockey' || s === 'hockey' || s === 'icehockey') return 'hockey';
  return s || 'football';
}

async function probeUrl(url: string, key: string): Promise<{ url: string; status: number; ok: boolean; ms: number; keys: string[]; sample: string; error?: string }> {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { headers: { 'x-api-key': key, accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
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
    const r = await pool.query(`SELECT id, email, role FROM users ORDER BY created_at DESC LIMIT 500`);
    sendJson(
      res,
      200,
      (r.rows || []).map((x: any) => ({
        id: String(x.id),
        email: String(x.email),
        is_operator: String(x.role) === 'admin' ? 1 : 0,
      })),
    );
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

  // ── Withdrawals ──────────────────────────────────────────────────────────────
  if (req.method === 'GET' && path === '/api/admin/withdrawals') {
    const r = await pool.query(
      `SELECT id, user_id, amount, status, payment_method, created_at
       FROM transactions
       WHERE type = 'withdrawal'
       ORDER BY created_at DESC
       LIMIT 500`,
    );
    sendJson(res, 200, { withdrawals: r.rows || [] });
    return true;
  }

  // ── Bets list ────────────────────────────────────────────────────────────────
  if (req.method === 'GET' && path === '/api/admin/bets') {
    const statusFilter = url.searchParams.get('status');
    const params: any[] = [];
    let where = '';
    if (statusFilter) {
      params.push(statusFilter);
      where = `WHERE status = $${params.length}`;
    }
    const r = await pool.query(
      `SELECT id, user_id, bet_type, stake, potential_win, total_odds, status, winnings, settled_at, created_at, selections
       FROM bets
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
    const betId = decodeURIComponent(betUpdateMatch[1] || '');
    const body = await readJsonBody<UpdateBetStatusBody>(req).catch(() => null);
    if (!body?.status) return badRequest(res, 'Missing status'), true;
    const allowed = ['won', 'lost', 'void', 'pending'];
    if (!allowed.includes(body.status)) return badRequest(res, 'Invalid status'), true;

    const r = await pool.query(
      `SELECT id, user_id, stake, potential_win, is_free_bet, status FROM bets WHERE id = $1 LIMIT 1`,
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
        `UPDATE bets SET status = $2, winnings = $3, settled_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [betId, body.status, winnings],
      );
      if (winnings > 0) {
        await client.query(
          `UPDATE profiles SET balance = balance + $2, updated_at = NOW() WHERE user_id = $1`,
          [bet.user_id, winnings],
        );
        const txType = body.status === 'void' ? 'bet_refund' : 'bet_win';
        await client.query(
          `INSERT INTO transactions (id, user_id, type, amount, status, description, completed_at, created_at, updated_at)
           VALUES (gen_random_uuid()::text, $1, $2, $3, 'completed', $4, NOW(), NOW(), NOW())`,
          [bet.user_id, txType, winnings, `Settlement manual: aposta ${betId}`],
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
    const r = await pool.query(
      `SELECT
         COUNT(*)::int AS total_pending,
         COUNT(DISTINCT jsonb_array_elements(selections)->>'event_id')::int AS unique_events,
         SUM(stake)::float AS total_stake_at_risk,
         SUM(potential_win)::float AS total_potential_win
       FROM bets WHERE status = 'pending'`,
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
    const r = await pool.query(
      `SELECT id, user_id, bet_type, stake, potential_win, total_odds, status, winnings, settled_at, selections
       FROM bets
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

  if (req.method === 'GET' && path === '/api/metrics/settlement') {
    const r = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
         COUNT(*) FILTER (WHERE status = 'won')::int AS won,
         COUNT(*) FILTER (WHERE status = 'lost')::int AS lost,
         COUNT(*) FILTER (WHERE status = 'void')::int AS voided,
         COUNT(*) FILTER (WHERE status = 'cashed_out')::int AS cashed_out,
         COALESCE(SUM(winnings) FILTER (WHERE status = 'won'), 0)::float AS total_paid_out,
         COALESCE(SUM(stake) FILTER (WHERE status = 'pending'), 0)::float AS stake_at_risk
       FROM bets`,
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
    const sub = toSub(sport);
    const today = new Date().toISOString().slice(0, 10);
    const probes: Array<{ label: string; url: string }> = [
      { label: `Schedule (${sport} - hoje)`,    url: `https://v2.${sub}.sportsapipro.com/api/events/schedule?date=${today}` },
      { label: `Live events (${sport})`,         url: `https://v2.${sub}.sportsapipro.com/api/events/live` },
    ];
    if (matchId) {
      probes.push({ label: `Odds All   (id=${matchId})`,       url: `https://v2.${sub}.sportsapipro.com/api/match/${encodeURIComponent(matchId)}/odds/all` });
      probes.push({ label: `Odds Live  (id=${matchId})`,       url: `https://v2.${sub}.sportsapipro.com/api/match/${encodeURIComponent(matchId)}/odds/live` });
      probes.push({ label: `Odds PreMatch (id=${matchId})`,    url: `https://v2.${sub}.sportsapipro.com/api/match/${encodeURIComponent(matchId)}/odds/pre-match` });
      probes.push({ label: `Match Stats (id=${matchId})`,      url: `https://v2.${sub}.sportsapipro.com/api/match/${encodeURIComponent(matchId)}/statistics` });
    }
    const results = await Promise.all(probes.map(async (p) => ({ label: p.label, ...(await probeUrl(p.url, key)) })));
    sendJson(res, 200, { results });
    return true;
  }

  return badRequest(res, 'Not supported'), true;
}
