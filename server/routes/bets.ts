import type http from 'http';
import type pg from 'pg';
import { randomId } from '../lib/crypto';
import { readJsonBody, sendJson, badRequest, unauthorized } from '../lib/http';
import { requireUser } from '../lib/auth';
import { APP_BETS_TABLE, ensureAppBetsTable } from '../lib/appTables';
import { validateBetSelections } from '../services/dataPipeline';
import type { EventsService } from './events';

type PlaceBetBody = {
  type?: 'single' | 'multi';
  stake?: number;
  use_freebet?: boolean;
  bets?: Array<{
    event_id: string | number;
    selection: string;
    odd: number;
    stake?: number;
    market?: string;
    market_key?: string;
    comboMeta?: any;
    combo_meta?: any;
  }>;
};

type BetSelectionError = {
  index: number;
  event_id: string;
  selection: string;
  market: string;
  code: string;
  reason: string;
  currentOdd?: number;
  currentSelectionLabel?: string;
  currentMarket?: string;
};

function toNumber(v: any): number {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function normalizeText(v: any): string {
  return String(v || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function isFinishedLike(event: any): boolean {
  const raw = String(event?.status?.short || event?.status || '').toUpperCase().trim();
  const normalized = raw.replace(/[^A-Z0-9_]+/g, '_');
  return (
    normalized === 'FT' ||
    normalized === 'FINAL' ||
    normalized === 'FINISHED' ||
    normalized === 'ENDED' ||
    normalized === 'AET' ||
    normalized === 'PEN' ||
    normalized === 'MATCH_FINISHED'
  );
}

function canonicalMarketAliases(market: string): string[] {
  const m = normalizeText(market);
  if (!m || m === '1x2' || m === 'resultado final' || m === 'resultado' || m === 'match winner' || m === 'moneyline') {
    return ['h2h', 'main', '1x2', 'match_winner', 'match_result', 'full_time_result', 'moneyline', 'winner'];
  }
  if (m.includes('ambas marcam') || m === 'btts') return ['btts'];
  if (m.includes('escante')) return ['corners_total', 'corners_h2h'];
  if (m.includes('cart')) return ['cards_total', 'cards_h2h'];
  if (m.includes('handicap asiat')) return ['spreads', 'asian_handicap', 'handicap'];
  if (m.includes('handicap')) return ['spreads', 'handicap', 'asian_handicap', 'puck_line', 'run_line', 'sets_handicap'];
  if (m.includes('total') || m.includes('golos') || m.includes('gols') || m.includes('acima') || m.includes('abaixo') || m.includes('over') || m.includes('under')) {
    return ['totals', 'team_totals', 'match_total_games', 'total_sets', 'corners_total', 'cards_total'];
  }
  return [m.replace(/\s+/g, '_')];
}

function formatMarketLabel(market: string): string {
  const key = String(market || '').trim().toLowerCase();
  if (!key || key === 'h2h' || key === '1x2' || key === 'main' || key === 'match_winner' || key === 'winner') {
    return 'Resultado Final';
  }
  if (key === 'btts') return 'Ambas Marcam';
  if (key === 'totals') return 'Total de Golos';
  if (key === 'team_totals') return 'Total da Equipa';
  if (key === 'spreads' || key === 'handicap' || key === 'asian_handicap') return 'Handicap';
  if (key === 'corners_total') return 'Total de Escanteios';
  if (key === 'corners_h2h') return 'Escanteios 1X2';
  if (key === 'cards_total') return 'Total de Cartões';
  if (key === 'cards_h2h') return 'Cartões 1X2';
  return String(market || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function pickMarketEntries(markets: Record<string, any>, requestedMarket: string): { key: string; entries: any[] } | null {
  if (!markets || typeof markets !== 'object') return null;
  const aliases = canonicalMarketAliases(requestedMarket);
  for (const alias of aliases) {
    const entries = (markets as any)[alias];
    if (Array.isArray(entries) && entries.length > 0) return { key: alias, entries };
  }
  const requested = normalizeText(requestedMarket).replace(/\s+/g, '_');
  const keys = Object.keys(markets || {});
  const fuzzy = keys.find((key) => normalizeText(key).replace(/\s+/g, '_') === requested);
  if (fuzzy) {
    const entries = (markets as any)[fuzzy];
    if (Array.isArray(entries) && entries.length > 0) return { key: fuzzy, entries };
  }
  return null;
}

function selectionCandidates(selection: string, event: any): string[] {
  const raw = String(selection || '').trim();
  const list = new Set<string>([normalizeText(raw)]);
  const home = String(event?.home_team || '').trim();
  const away = String(event?.away_team || '').trim();
  const s = normalizeText(raw);
  if (['1', 'casa', 'home', normalizeText(home)].includes(s)) {
    list.add('1');
    list.add('home');
    list.add('casa');
    if (home) list.add(normalizeText(home));
  }
  if (['2', 'fora', 'away', normalizeText(away)].includes(s)) {
    list.add('2');
    list.add('away');
    list.add('fora');
    if (away) list.add(normalizeText(away));
  }
  if (['x', 'draw', 'empate', 'tie'].includes(s)) {
    list.add('x');
    list.add('draw');
    list.add('empate');
  }
  return Array.from(list).filter(Boolean);
}

function matchSelectionToOdd(input: {
  selection: string;
  marketKey: string;
  marketEntries: any[];
  event: any;
  topLevelOdds?: { home?: number; draw?: number; away?: number };
}): { odd: number; label: string } | null {
  const candidates = selectionCandidates(input.selection, input.event);

  if (input.marketKey === 'h2h') {
    const home = String(input.event?.home_team || '').trim();
    const away = String(input.event?.away_team || '').trim();
    const sel = normalizeText(input.selection);
    if (candidates.includes('1') || candidates.includes('home') || candidates.includes('casa') || (home && sel === normalizeText(home))) {
      const odd = toNumber(input.topLevelOdds?.home);
      if (odd > 1) return { odd, label: home || 'Casa' };
    }
    if (candidates.includes('x') || candidates.includes('draw') || candidates.includes('empate')) {
      const odd = toNumber(input.topLevelOdds?.draw);
      if (odd > 1) return { odd, label: 'Empate' };
    }
    if (candidates.includes('2') || candidates.includes('away') || candidates.includes('fora') || (away && sel === normalizeText(away))) {
      const odd = toNumber(input.topLevelOdds?.away);
      if (odd > 1) return { odd, label: away || 'Fora' };
    }
  }

  for (const entry of input.marketEntries) {
    const label = String(entry?.label ?? entry?.value ?? entry?.name ?? '').trim();
    const point = String(entry?.point || '').trim();
    const normalizedLabel = normalizeText(label);
    const combined = normalizeText(`${label} ${point}`.trim());
    if (candidates.includes(normalizedLabel) || candidates.includes(combined) || normalizeText(input.selection) === combined) {
      const odd = toNumber(entry?.odd ?? entry?.price ?? entry?.value);
      if (odd > 1) return { odd, label: point ? `${label} ${point}`.trim() : label };
    }
  }

  return null;
}

async function getProfile(pool: pg.Pool, userId: string): Promise<{ balance: number; free_bet_balance: number }> {
  const r = await pool.query(`SELECT balance, free_bet_balance FROM profiles WHERE user_id = $1 LIMIT 1`, [userId]);
  const row = r.rows?.[0] || {};
  const balance = toNumber(row.balance);
  const free = toNumber(row.free_bet_balance);
  return { balance, free_bet_balance: free };
}

async function updateProfile(pool: pg.Pool, userId: string, balance: number, freeBet: number): Promise<void> {
  await pool.query(
    `UPDATE profiles SET balance = $2, free_bet_balance = $3, updated_at = NOW() WHERE user_id = $1`,
    [userId, balance, freeBet],
  );
}

function serializeBetRecord(row: any, userId: string) {
  const selections = row?.selections && typeof row.selections === 'object' ? row.selections : [];
  const arr = Array.isArray(selections) ? selections : [];
  const first = arr[0] || {};
  const rawType = String(row?.bet_type || 'single');
  const uiType = rawType === 'multi' ? 'multiple' : 'single';
  const stake = toNumber(row?.stake ?? row?.total_stake);
  const potentialWin = toNumber(row?.potential_win ?? row?.potential_return);

  return {
    id: String(row?.id || ''),
    user_id: String(userId),
    type: rawType,
    bet_type: uiType,
    stake,
    total_stake: stake,
    potential_win: potentialWin,
    potential_return: potentialWin,
    total_odds: toNumber(row?.total_odds),
    status: String(row?.status || 'pending'),
    is_freebet: row?.is_free_bet ? 1 : 0,
    is_free_bet: Boolean(row?.is_free_bet),
    winnings: toNumber(row?.winnings),
    cashout_value: toNumber(row?.cashout_value),
    cashout_at: row?.cashout_at ? new Date(row.cashout_at).toISOString() : undefined,
    settled_at: row?.settled_at ? new Date(row.settled_at).toISOString() : undefined,
    selection: first.selection ? String(first.selection) : '',
    odd: toNumber(first.odd),
    event_id: first.event_id != null ? first.event_id : null,
    team_match: first.team_match ? String(first.team_match) : '',
    league: first.league ? String(first.league) : '',
    selections: arr,
    created_at: row?.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
  };
}

function sendBetSelectionError(
  res: http.ServerResponse,
  message: string,
  selectionError: BetSelectionError,
  status = 409,
): void {
  sendJson(res, status, {
    error: message,
    code: selectionError.code,
    selectionErrors: [selectionError],
  });
}

export async function handleBetRoutes(
  pool: pg.Pool,
  events: EventsService,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
): Promise<boolean> {
  const path = url.pathname;

  if (req.method === 'GET' && path === '/api/promotions/freebets') {
    const u = await requireUser(pool, req);
    if (!u) return unauthorized(res), true;
    const p = await getProfile(pool, u.id);
    sendJson(res, 200, { amount_eur: p.free_bet_balance });
    return true;
  }

  if (req.method === 'GET' && path === '/api/bets') {
    const u = await requireUser(pool, req);
    if (!u) return unauthorized(res), true;
    await ensureAppBetsTable(pool);

    const r = await pool.query(
      `SELECT id, bet_type, stake, potential_win, total_odds, status, is_free_bet, winnings, selections, cashout_value, cashout_at, settled_at, created_at
       FROM ${APP_BETS_TABLE}
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 200`,
      [u.id],
    );

    const out = (r.rows || []).map((b: any) => serializeBetRecord(b, u.id));

    sendJson(res, 200, { bets: out });
    return true;
  }

  if (req.method === 'POST' && path === '/api/bets') {
    const u = await requireUser(pool, req);
    if (!u) return unauthorized(res), true;
    await ensureAppBetsTable(pool);
    const body = await readJsonBody<PlaceBetBody>(req).catch(() => null);
    if (!body) return badRequest(res, 'Invalid JSON'), true;
    const type = body.type === 'multi' ? 'multi' : 'single';
    const bets = Array.isArray(body.bets) ? body.bets : [];
    if (bets.length === 0) return badRequest(res, 'No selections'), true;
    const validationErrors = validateBetSelections(bets);
    if (validationErrors.length > 0) return badRequest(res, validationErrors[0]), true;
    const payloadSelections = [];

    for (let index = 0; index < bets.length; index += 1) {
      const bet = bets[index];
      const eventId = String(bet.event_id || '').trim();
      const requestedSelection = String(bet.selection || '').trim();
      const requestedMarket = String(bet.market || bet.market_key || 'Resultado Final').trim();
      const ctx = await events.getBetValidationContext(eventId);

      if (!ctx.event || !ctx.sport) {
        sendBetSelectionError(res, `Evento ${eventId} não encontrado`, {
          index,
          event_id: eventId,
          selection: requestedSelection,
          market: requestedMarket,
          code: 'EVENT_NOT_FOUND',
          reason: 'Evento não encontrado no feed atual',
        });
        return true;
      }
      if (isFinishedLike(ctx.event)) {
        sendBetSelectionError(res, `Evento ${eventId} já está encerrado`, {
          index,
          event_id: eventId,
          selection: requestedSelection,
          market: requestedMarket,
          code: 'EVENT_FINISHED',
          reason: 'Evento já encerrado',
        });
        return true;
      }

      const markets = ctx.odds?.markets && typeof ctx.odds.markets === 'object'
        ? ctx.odds.markets
        : ((ctx.event as any)?.markets && typeof (ctx.event as any).markets === 'object' ? (ctx.event as any).markets : {});
      const pickedMarket = pickMarketEntries(markets, requestedMarket) || pickMarketEntries(markets, 'Resultado Final');
      if (!pickedMarket) {
        sendBetSelectionError(res, `Mercado indisponível para o evento ${eventId}`, {
          index,
          event_id: eventId,
          selection: requestedSelection,
          market: requestedMarket,
          code: 'MARKET_UNAVAILABLE',
          reason: 'Mercado não encontrado nas odds atuais',
        });
        return true;
      }

      if (ctx.suspended) {
        sendBetSelectionError(res, ctx.suspendedReason ? `Mercado suspenso: ${ctx.suspendedReason}` : 'Mercado suspenso', {
          index,
          event_id: eventId,
          selection: requestedSelection,
          market: requestedMarket,
          code: 'MARKET_SUSPENDED',
          reason: ctx.suspendedReason || 'Mercado suspenso no feed atual',
        });
        return true;
      }
      if (Array.isArray(ctx.suspendedMarkets) && ctx.suspendedMarkets.includes(pickedMarket.key)) {
        sendBetSelectionError(res, ctx.suspendedReason ? `Mercado suspenso: ${ctx.suspendedReason}` : 'Mercado suspenso', {
          index,
          event_id: eventId,
          selection: requestedSelection,
          market: requestedMarket,
          code: 'MARKET_SUSPENDED',
          reason: ctx.suspendedReason || 'Mercado suspenso no feed atual',
        });
        return true;
      }

      const matched = matchSelectionToOdd({
        selection: requestedSelection,
        marketKey: pickedMarket.key,
        marketEntries: pickedMarket.entries,
        event: ctx.event,
        topLevelOdds: { home: ctx.odds?.home, draw: ctx.odds?.draw, away: ctx.odds?.away },
      });
      if (!matched) {
        sendBetSelectionError(res, `Seleção inválida para o evento ${eventId}`, {
          index,
          event_id: eventId,
          selection: requestedSelection,
          market: requestedMarket,
          code: 'SELECTION_INVALID',
          reason: 'Seleção não corresponde às opções atuais do mercado',
        });
        return true;
      }

      const submittedOdd = toNumber(bet.odd);
      const currentOdd = toNumber(matched.odd);
      const tolerance = Math.max(0.02, currentOdd * 0.01);
      if (!(currentOdd > 1)) {
        sendBetSelectionError(res, `Odd indisponível para o evento ${eventId}`, {
          index,
          event_id: eventId,
          selection: requestedSelection,
          market: requestedMarket,
          code: 'ODD_UNAVAILABLE',
          reason: 'Odd atual indisponível',
        });
        return true;
      }
      if (submittedOdd > 1 && Math.abs(submittedOdd - currentOdd) > tolerance) {
        sendBetSelectionError(res, `Odd alterada para ${currentOdd.toFixed(2)} no evento ${eventId}`, {
          index,
          event_id: eventId,
          selection: requestedSelection,
          market: requestedMarket,
          code: 'ODD_CHANGED',
          reason: `Odd atualizada para ${currentOdd.toFixed(2)}`,
          currentOdd,
          currentSelectionLabel: matched.label,
          currentMarket: formatMarketLabel(pickedMarket.key),
        });
        return true;
      }

      payloadSelections.push({
        event_id: eventId,
        selection: requestedSelection,
        odd: currentOdd,
        stake: bet.stake != null ? toNumber(bet.stake) : undefined,
        market: pickedMarket.key,
        team_match: String((bet as any).team_match || `${ctx.event?.home_team || ''} vs ${ctx.event?.away_team || ''}`.trim()),
        league: String((bet as any).league || ctx.event?.league || ''),
        home_team: String((bet as any).home_team || ctx.event?.home_team || ''),
        away_team: String((bet as any).away_team || ctx.event?.away_team || ''),
        sport: String(ctx.sport || ''),
        selection_label: matched.label,
        combo_meta:
          (bet as any).comboMeta && typeof (bet as any).comboMeta === 'object'
            ? (bet as any).comboMeta
            : (bet as any).combo_meta && typeof (bet as any).combo_meta === 'object'
              ? (bet as any).combo_meta
              : undefined,
      });
    }

    const totalOdds = payloadSelections.reduce((p, b) => p * Math.max(1, toNumber(b.odd)), 1);

    const stake =
      type === 'single'
        ? payloadSelections.reduce((s, x) => s + Math.max(0, toNumber(x.stake)), 0)
        : Math.max(0, toNumber(body.stake));
    if (!stake || stake <= 0) return badRequest(res, 'Invalid stake'), true;

    const profile = await getProfile(pool, u.id);
    const useFree = Boolean(body.use_freebet);
    if (useFree) {
      if (profile.free_bet_balance < stake) return badRequest(res, 'Saldo freebet insuficiente'), true;
    } else {
      if (profile.balance < stake) return badRequest(res, 'Saldo insuficiente'), true;
    }

    const potentialWin = stake * totalOdds;
    const betId = randomId(16);
    await pool.query(
      `INSERT INTO ${APP_BETS_TABLE} (id, user_id, bet_type, stake, potential_win, total_odds, status, is_free_bet, winnings, selections, total_stake, potential_return, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, NULL, $8::jsonb, $9, $10, NOW(), NOW())`,
      [betId, u.id, type, stake, potentialWin, totalOdds, useFree, JSON.stringify(payloadSelections), stake, potentialWin],
    );

    if (useFree) {
      await updateProfile(pool, u.id, profile.balance, profile.free_bet_balance - stake);
    } else {
      await updateProfile(pool, u.id, profile.balance - stake, profile.free_bet_balance);
    }

    sendJson(res, 200, { success: true, id: betId });
    return true;
  }

  const cashoutMatch = path.match(/^\/api\/bets\/([^/]+)\/cashout$/);
  if (cashoutMatch && req.method === 'POST') {
    const u = await requireUser(pool, req);
    if (!u) return unauthorized(res), true;
    await ensureAppBetsTable(pool);
    const betId = cashoutMatch[1] || '';
    const body = await readJsonBody<any>(req).catch(() => ({}));
    const requestedAmount = toNumber(body?.amount);

    const r = await pool.query(
      `SELECT id, bet_type, stake, potential_win, total_odds, status, is_free_bet, winnings, selections, cashout_value, cashout_at, settled_at, created_at
       FROM ${APP_BETS_TABLE}
       WHERE id = $1 AND user_id = $2
       LIMIT 1`,
      [betId, u.id],
    );
    const b = r.rows?.[0];
    if (!b) return badRequest(res, 'Bet not found'), true;
    if (String(b.status) !== 'pending') return badRequest(res, 'Cashout indisponível'), true;

    const stake = toNumber(b.stake);
    const potentialWin = Math.max(stake, toNumber(b.potential_win));
    const fallbackCashoutValue = Math.max(0, Math.min(potentialWin, stake * 0.8));
    const cashoutValue = Math.max(
      0,
      Math.min(potentialWin, requestedAmount > 0 ? requestedAmount : fallbackCashoutValue),
    );
    if (!(cashoutValue > 0)) return badRequest(res, 'Valor inválido'), true;

    const updated = await pool.query(
      `UPDATE ${APP_BETS_TABLE}
       SET status = 'cashed_out', cashout_value = $2, winnings = $2, cashout_at = NOW(), settled_at = NOW(), updated_at = NOW()
       WHERE id = $1
       RETURNING id, bet_type, stake, potential_win, total_odds, status, is_free_bet, winnings, selections, cashout_value, cashout_at, settled_at, created_at`,
      [betId, cashoutValue],
    );

    const profile = await getProfile(pool, u.id);
    await updateProfile(pool, u.id, profile.balance + cashoutValue, profile.free_bet_balance);
    sendJson(res, 200, {
      success: true,
      amount: cashoutValue,
      cashoutValue,
      bet: serializeBetRecord(updated.rows?.[0], u.id),
    });
    return true;
  }

  return false;
}
