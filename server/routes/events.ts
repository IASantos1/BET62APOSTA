import type http from 'http';
import type pg from 'pg';
import {
  fetchSportsApiProLive,
  fetchSportsApiProMatchOddsAll,
  fetchSportsApiProMatchOddsLive,
  fetchSportsApiProMatchOddsPreMatch,
  fetchSportsApiProMatchStatistics,
  fetchSportsApiProSchedule,
} from '../services/sportsApiPro';
import { sendJson, badRequest } from '../lib/http';

type CacheEntry<T> = { ts: number; data: T };

type AnyEvent = any;

const SPORTS_DEFAULT = ['soccer', 'tennis', 'basketball', 'ice-hockey', 'baseball'];
const ODDS_FRESH_TTL_MS = 90_000;
const ODDS_STALE_TTL_MS = 15 * 60_000;

function nowMs(): number {
  return Date.now();
}

function ymd(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function ttlOk(ts: number, ttlMs: number): boolean {
  return ts > 0 && nowMs() - ts < ttlMs;
}

function parseMarkets(v: any): any {
  if (!v) return {};
  if (typeof v === 'object') return v;
  if (typeof v !== 'string') return {};
  const s = v.trim();
  if (!s) return {};
  try {
    const j = JSON.parse(s);
    if (typeof j === 'string') {
      try {
        return JSON.parse(j);
      } catch {
        return j;
      }
    }
    return j;
  } catch {
    return {};
  }
}

function pruneMarketsForList(sport: string, markets: Record<string, any[]>): Record<string, any[]> {
  if (!markets || typeof markets !== 'object') return {};

  const keys = Object.keys(markets);
  if (keys.length <= 12) return markets;

  const s = String(sport || '').toLowerCase();
  const isSoccer = s.includes('soccer') || (s.includes('football') && !s.includes('american'));
  const isTennis = s.includes('tennis') || s.includes('tênis') || s.includes('tenis');
  const isBasket = s.includes('basketball') || s.includes('basquet');
  const isHockey = s.includes('ice-hockey') || (s.includes('hockey') && !s.includes('field'));
  const isBaseball = s.includes('baseball') || s.includes('beisebol');

  const wanted: RegExp[] = [
    /^(h2h|1x2|main|match_winner|moneyline|winner|home_away)$/i,
    /total|over|under/i,
    /handicap|spread|asian|run_line|puck_line/i,
  ];

  if (isSoccer) {
    wanted.push(/corner|cards|bookings|yellow|red|both_teams|btts|double_chance|draw_no_bet|correct_score/i);
    wanted.push(/half|period_1|period_2/i);
  }
  if (isTennis) {
    wanted.push(/set|game|tiebreak|aces|double_fault/i);
  }
  if (isBasket) {
    wanted.push(/quarter|q[1-4]|period_1|period_2|period_3|period_4|team_total/i);
  }
  if (isHockey) {
    wanted.push(/period|p[1-3]|team_total|shots|pp|powerplay/i);
  }
  if (isBaseball) {
    wanted.push(/innings|in[1-9]|team_total|hits|runs|rbis|strikeouts/i);
  }

  const priority = (k: string): number => {
    const key = k.toLowerCase();
    if (/^(h2h|1x2|main|match_winner|moneyline|winner)$/.test(key)) return 0;
    if (/total|over|under/.test(key)) return 1;
    if (/handicap|spread|asian|run_line|puck_line/.test(key)) return 2;
    if (/period|quarter|half|innings|set|game/.test(key)) return 3;
    return 9;
  };

  const picked: string[] = [];
  for (const k of keys.sort((a, b) => priority(a) - priority(b))) {
    if (picked.length >= 12) break;
    if (wanted.some((rx) => rx.test(k))) picked.push(k);
  }

  if (picked.length < 6) {
    for (const k of keys.sort((a, b) => priority(a) - priority(b))) {
      if (picked.length >= 12) break;
      if (!picked.includes(k)) picked.push(k);
    }
  }

  const out: Record<string, any[]> = {};
  for (const k of picked) out[k] = markets[k];
  return out;
}

export type EventsService = {
  handleEventsRoutes: (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    url: URL,
  ) => Promise<boolean>;
  getAdminOddsEvents: () => Promise<any[]>;
  setOddsOverride: (eventId: string, odds: { home_odd?: number; draw_odd?: number; away_odd?: number }) => Promise<void>;
};

export function createEventsService(pool: pg.Pool, apiKey: string): EventsService {
  const liveCache = new Map<string, CacheEntry<AnyEvent[]>>();
  const scheduleCache = new Map<string, CacheEntry<AnyEvent[]>>();
  const oddsCache = new Map<string, CacheEntry<any>>();
  const oddsInflight = new Map<string, Promise<any | null>>();
  const bySportCache = new Map<string, CacheEntry<{ live: AnyEvent[]; pregame: AnyEvent[] }>>();
  const oddsQueue: Array<{ sport: string; matchId: string }> = [];
  const oddsQueued = new Set<string>();
  let oddsQueueInFlight = 0;
  let oddsQueueStarted = false;
  const idToSport = new Map<string, CacheEntry<string>>();
  const lastEventById = new Map<string, CacheEntry<AnyEvent>>();
  const overridesCache = new Map<string, CacheEntry<{ home_odd: number | null; draw_odd: number | null; away_odd: number | null }>>();

  const normalizeMatchId = (sport: string, rawId: string): string => {
    const id = String(rawId || '').trim();
    if (!id) return '';
    if (!id.includes('_')) return id;
    const parts = id.split('_').filter(Boolean);
    if (parts.length < 2) return id;
    const last = parts[parts.length - 1] || '';
    const first = parts[0] || '';
    const s = String(sport || '').toLowerCase().trim();
    const f = String(first || '').toLowerCase().trim();
    if (!s) return last || id;
    if (f === s) return last || id;
    if (f === 'football' && s === 'soccer') return last || id;
    if (f === 'soccer' && s === 'football') return last || id;
    if (f === 'hockey' && s === 'ice-hockey') return last || id;
    if (f === 'ice-hockey' && s === 'hockey') return last || id;
    return last || id;
  };

  const normalizeIdLoose = (rawId: string): string => {
    const id = String(rawId || '').trim();
    if (!id) return '';
    if (!id.includes('_')) return id;
    const parts = id.split('_').filter(Boolean);
    if (parts.length < 2) return id;
    return parts[parts.length - 1] || id;
  };

  const matchIdOf = (e: AnyEvent): string => {
    const sport = String((e as any)?.sport || '').trim();
    const idRaw = String((e as any)?.id || (e as any)?.external_event_id || '').trim();
    return normalizeMatchId(sport, idRaw);
  };

  const getSports = (sportsParam: string | null): string[] => {
    const raw = String(sportsParam || '').trim();
    if (!raw || raw === 'all') return SPORTS_DEFAULT.slice();
    const parts = raw.split(',').map((x) => x.trim()).filter(Boolean);
    if (parts.length === 0) return SPORTS_DEFAULT.slice();
    return parts;
  };

  const rememberSport = (matchId: string, sport: string) => {
    if (!matchId) return;
    idToSport.set(matchId, { ts: nowMs(), data: sport });
  };

  const resolveSport = async (matchId: string): Promise<string | null> => {
    const c = idToSport.get(matchId);
    if (c && ttlOk(c.ts, 6 * 60 * 60 * 1000)) return c.data;
    for (const s of SPORTS_DEFAULT) {
      const live = await fetchLive(s).catch(() => []);
      if (live.some((e: any) => String(e.id) === String(matchId))) {
        rememberSport(matchId, s);
        return s;
      }
      const date = ymd(new Date());
      const list = await fetchSchedule(s, date).catch(() => []);
      if (list.some((e: any) => String(e.id) === String(matchId))) {
        rememberSport(matchId, s);
        return s;
      }
    }
    return null;
  };

  const queueOddsRefresh = (sport: string, matchId: string) => {
    const s = String(sport || '').trim();
    const id = normalizeMatchId(s, String(matchId || '').trim());
    if (!s || !id) return;
    const key = `${s}:${id}`;
    const cached = oddsCache.get(key);
    if (cached && ttlOk(cached.ts, ODDS_FRESH_TTL_MS)) return;
    if (oddsQueued.has(key)) return;
    oddsQueued.add(key);
    oddsQueue.push({ sport: s, matchId: id });
  };

  const startOddsQueue = () => {
    if (oddsQueueStarted) return;
    oddsQueueStarted = true;
    setInterval(() => {
      if (oddsQueueInFlight >= 6) return;
      const next = oddsQueue.shift();
      if (!next) return;
      const key = `${next.sport}:${next.matchId}`;
      oddsQueueInFlight += 1;
      fetchOddsStrict(next.sport, next.matchId)
        .catch(() => null)
        .finally(() => {
          oddsQueueInFlight -= 1;
          oddsQueued.delete(key);
        });
    }, 120);
  };

  const fetchLive = async (sport: string): Promise<AnyEvent[]> => {
    const key = sport;
    const cached = liveCache.get(key);
    if (cached && ttlOk(cached.ts, 7_000)) return cached.data;
    const list = await fetchSportsApiProLive(apiKey, sport).catch(() => []);
    const normalized = (Array.isArray(list) ? list : []).map((e: any) => {
      const id = String((e as any).id || '').trim() || String((e as any).external_event_id || '').split('_').pop() || '';
      const out = { ...e, id };
      rememberSport(id, sport);
      lastEventById.set(id, { ts: nowMs(), data: out });
      return out;
    });
    liveCache.set(key, { ts: nowMs(), data: normalized });
    return normalized;
  };

  const fetchSchedule = async (sport: string, date: string): Promise<AnyEvent[]> => {
    const key = `${sport}:${date}`;
    const cached = scheduleCache.get(key);
    if (cached && ttlOk(cached.ts, 20 * 60_000)) return cached.data;
    const list = await fetchSportsApiProSchedule(apiKey, sport, date).catch(() => []);
    const normalized = (Array.isArray(list) ? list : []).map((e: any) => {
      const id = String((e as any).id || '').trim() || String((e as any).external_event_id || '').split('_').pop() || '';
      const out = { ...e, id };
      rememberSport(id, sport);
      lastEventById.set(id, { ts: nowMs(), data: out });
      return out;
    });
    scheduleCache.set(key, { ts: nowMs(), data: normalized });
    return normalized;
  };

  const getOverride = async (eventId: string): Promise<{ home_odd: number | null; draw_odd: number | null; away_odd: number | null } | null> => {
    const c = overridesCache.get(eventId);
    if (c && ttlOk(c.ts, 10_000)) return c.data;
    const r = await pool.query(`SELECT home_odd, draw_odd, away_odd FROM odds_overrides WHERE event_id = $1 LIMIT 1`, [eventId]);
    const row = r.rows?.[0];
    if (!row) return null;
    const data = {
      home_odd: row.home_odd == null ? null : Number(row.home_odd),
      draw_odd: row.draw_odd == null ? null : Number(row.draw_odd),
      away_odd: row.away_odd == null ? null : Number(row.away_odd),
    };
    overridesCache.set(eventId, { ts: nowMs(), data });
    return data;
  };

  const fetchOddsStrict = async (
    sport: string,
    matchId: string,
    ctx: { isLive?: boolean; homeTeam?: string; awayTeam?: string; forceAll?: boolean } = {},
  ): Promise<any | null> => {
    const normalizedId = normalizeMatchId(sport, matchId);
    const key = `${sport}:${normalizedId}`;
    const inflight = oddsInflight.get(key);
    if (inflight) return inflight;
    const p = (async () => {
      const opts = { homeTeam: ctx.homeTeam, awayTeam: ctx.awayTeam };
      const all = await fetchSportsApiProMatchOddsAll(apiKey, sport, normalizedId, opts).catch(() => null);
      if (all) return all;
      if (ctx.forceAll) return null;
      if (ctx.isLive) {
        const live = await fetchSportsApiProMatchOddsLive(apiKey, sport, normalizedId, opts).catch(() => null);
        if (live) return live;
      } else {
        const pre = await fetchSportsApiProMatchOddsPreMatch(apiKey, sport, normalizedId, opts).catch(() => null);
        if (pre) return pre;
      }
      return null;
    })()
      .then((odds) => {
        oddsCache.set(key, { ts: nowMs(), data: odds });
        return odds;
      })
      .catch(() => null)
      .finally(() => {
        oddsInflight.delete(key);
      });
    oddsInflight.set(key, p);
    return p;
  };

  const fetchOddsBestEffort = async (
    sport: string,
    matchId: string,
    ctx: { isLive?: boolean; homeTeam?: string; awayTeam?: string; forceAll?: boolean },
    refreshBudget: { remaining: number } | null,
  ): Promise<any | null> => {
    const key = `${sport}:${matchId}`;
    const cached = oddsCache.get(key);

    if (cached && ttlOk(cached.ts, ODDS_FRESH_TTL_MS)) {
      return cached.data;
    }

    if (cached && ttlOk(cached.ts, ODDS_STALE_TTL_MS)) {
      if (refreshBudget && refreshBudget.remaining > 0 && !oddsInflight.has(key)) {
        refreshBudget.remaining -= 1;
        fetchOddsStrict(sport, matchId, ctx).catch(() => null);
      } else {
        queueOddsRefresh(sport, matchId);
      }
      return cached.data;
    }

    if (refreshBudget && refreshBudget.remaining <= 0) {
      queueOddsRefresh(sport, matchId);
      return cached ? cached.data : null;
    }

    if (refreshBudget) refreshBudget.remaining -= 1;
    return fetchOddsStrict(sport, matchId, ctx);
  };

  const enrichEventOdds = async (
    e: AnyEvent,
    refreshBudget: { remaining: number } | null,
    fullMarkets: boolean,
  ): Promise<AnyEvent> => {
    const id = matchIdOf(e);
    const sport = String(e?.sport || '').trim();
    if (!id || !sport) return e;

    const override = await getOverride(id).catch(() => null);
    const odds = await fetchOddsBestEffort(
      sport,
      id,
      {
        isLive: Number(e?.is_live || 0) === 1,
        homeTeam: String(e?.home_team || ''),
        awayTeam: String(e?.away_team || ''),
      },
      refreshBudget,
    ).catch(() => null);
    const marketsAll = odds?.markets ? odds.markets : parseMarkets((e as any).markets);
    const markets =
      fullMarkets
        ? marketsAll
        : pruneMarketsForList(sport, (marketsAll && typeof marketsAll === 'object') ? marketsAll : {});
    const base = {
      ...e,
      id,
      home_odd: odds?.home ? Number(odds.home) : Number((e as any).home_odd || 0),
      draw_odd: odds?.draw ? Number(odds.draw) : Number((e as any).draw_odd || 0),
      away_odd: odds?.away ? Number(odds.away) : Number((e as any).away_odd || 0),
      markets,
      markets_count: marketsAll && typeof marketsAll === 'object' ? Object.keys(marketsAll).length : 0,
    };
    if (override) {
      const ho = override.home_odd != null ? Number(override.home_odd) : null;
      const doo = override.draw_odd != null ? Number(override.draw_odd) : null;
      const ao = override.away_odd != null ? Number(override.away_odd) : null;
      return {
        ...base,
        home_odd: ho != null && ho > 0 ? ho : base.home_odd,
        draw_odd: doo != null && doo > 0 ? doo : base.draw_odd,
        away_odd: ao != null && ao > 0 ? ao : base.away_odd,
      };
    }
    return base;
  };

  const mapLimit = async <T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> => {
    const out: R[] = new Array(items.length);
    let idx = 0;
    const run = async () => {
      while (true) {
        const i = idx++;
        if (i >= items.length) return;
        out[i] = await fn(items[i]);
      }
    };
    const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, run);
    await Promise.all(workers);
    return out;
  };

  const buildBySport = async (
    sportsParam: string | null,
    includeOdds: boolean,
    league: string | null,
    realtime: boolean,
    fullMarkets: boolean,
  ): Promise<{ live: AnyEvent[]; pregame: AnyEvent[] }> => {
    startOddsQueue();
    const sports = getSports(sportsParam);
    const liveAll: AnyEvent[] = [];
    const preAll: AnyEvent[] = [];

    for (const s of sports) {
      const live = await fetchLive(s);
      liveAll.push(...live.filter((e: any) => Number(e?.is_live || 0) === 1));

      const days = 14;
      for (let i = 0; i < days; i++) {
        const d = new Date();
        d.setDate(d.getDate() + i);
        const date = ymd(d);
        const sched = await fetchSchedule(s, date);
        preAll.push(...sched.filter((e: any) => Number(e?.is_live || 0) === 0));
      }
    }

    const cleanLeague = String(league || '').trim().toLowerCase();
    const filterLeague = (arr: AnyEvent[]) => {
      if (!cleanLeague) return arr;
      return arr.filter((e: any) => String(e?.league || '').toLowerCase().includes(cleanLeague));
    };

    const live = filterLeague(liveAll).slice(0, 120);
    const pregame = filterLeague(preAll).slice(0, 120);

    if (!includeOdds) {
      return { live, pregame };
    }

    for (const e of live) queueOddsRefresh(String((e as any)?.sport || ''), String((e as any)?.id || ''));
    for (const e of pregame) queueOddsRefresh(String((e as any)?.sport || ''), String((e as any)?.id || ''));

    const liveBudget = { remaining: realtime ? Math.min(60, live.length) : live.length };
    const preBudget = { remaining: realtime ? Math.min(60, pregame.length) : pregame.length };
    const liveEnriched = await mapLimit(live, 10, (x) => enrichEventOdds(x, liveBudget, fullMarkets));
    const preEnriched = await mapLimit(pregame, 10, (x) => enrichEventOdds(x, preBudget, fullMarkets));
    return { live: liveEnriched, pregame: preEnriched };
  };

  const handleEventsRoutes = async (req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<boolean> => {
    const path = url.pathname;

    if (req.method === 'GET' && path === '/api/health') {
      sendJson(res, 200, { ok: true });
      return true;
    }

    if (req.method === 'GET' && path === '/api/sports') {
      sendJson(res, 200, SPORTS_DEFAULT.slice());
      return true;
    }

    if (req.method === 'GET' && path === '/api/events/by-sport') {
      const sports = url.searchParams.get('sports');
      const include = url.searchParams.get('include');
      const includeOdds = String(include || '').toLowerCase().includes('odds');
      const league = url.searchParams.get('league');
      const realtime = String(url.searchParams.get('realtime') || '') === '1';
      const fullMarkets =
        String(url.searchParams.get('markets') || '').toLowerCase() === 'full' ||
        String(url.searchParams.get('markets') || '').toLowerCase() === 'all';
      const cacheKey = `bySport:${String(sports || 'all')}|league:${String(league || '')}|includeOdds:${includeOdds ? '1' : '0'}|realtime:${realtime ? '1' : '0'}|fullMarkets:${fullMarkets ? '1' : '0'}`;
      const cached = bySportCache.get(cacheKey);
      const ttl = realtime ? 2_000 : includeOdds ? 12_000 : 25_000;
      if (cached && ttlOk(cached.ts, ttl)) {
        sendJson(res, 200, cached.data);
        return true;
      }
      const data = await buildBySport(sports, includeOdds, league, realtime, fullMarkets).catch(() => ({ live: [], pregame: [] }));
      bySportCache.set(cacheKey, { ts: nowMs(), data });
      sendJson(res, 200, data);
      return true;
    }

    if (req.method === 'GET' && path === '/api/dev/odds-debug') {
      const tokenEnv = String(process.env.ODDS_DEBUG_TOKEN || '').trim();
      if (!tokenEnv) return false;
      const token = String(url.searchParams.get('token') || req.headers['x-debug-token'] || '').trim();
      if (!token || token !== tokenEnv) return sendJson(res, 403, { error: 'Forbidden' }), true;

      const sport = String(url.searchParams.get('sport') || '').trim() || 'soccer';
      const idRaw = String(url.searchParams.get('id') || '').trim();
      const mode = String(url.searchParams.get('mode') || 'all').trim().toLowerCase();
      if (!idRaw) return sendJson(res, 400, { error: 'Missing id' }), true;
      if (mode !== 'all' && mode !== 'live' && mode !== 'pre-match') return sendJson(res, 400, { error: 'Invalid mode' }), true;
      const id = normalizeMatchId(sport, idRaw) || normalizeIdLoose(idRaw);

      const normalizeSportKey = (s: string): string =>
        String(s || '')
          .toLowerCase()
          .trim()
          .replace(/[_\s]+/g, '-')
          .replace(/[^a-z0-9-]/g, '')
          .replace(/-+/g, '-')
          .replace(/^-+/, '')
          .replace(/-+$/, '');
      const toSubdomain = (s: string): string => {
        const k = normalizeSportKey(s);
        if (k === 'football' || k === 'futebol' || k === 'soccer') return 'football';
        if (k === 'hockey' || k === 'icehockey' || k === 'ice-hockey') return 'hockey';
        return k || 'football';
      };

      const sub = toSubdomain(sport);
      const targetUrl = `https://v2.${sub}.sportsapipro.com/api/match/${encodeURIComponent(id)}/odds/${mode}`;
      try {
        const r = await fetch(targetUrl, { headers: { 'x-api-key': apiKey, accept: 'application/json' } });
        const text = await r.text().catch(() => '');
        let json: any = null;
        try {
          json = text ? JSON.parse(text) : null;
        } catch {
          json = null;
        }
        const topKeys = json && typeof json === 'object' ? Object.keys(json).slice(0, 30) : [];
        sendJson(res, 200, {
          url: targetUrl,
          status: r.status,
          ok: r.ok,
          idRaw,
          idUsed: id,
          topKeys,
          bodyPreview: String(text || '').slice(0, 1600),
        });
      } catch (e: any) {
        sendJson(res, 200, { url: targetUrl, status: 0, ok: false, error: String(e?.message || e) });
      }
      return true;
    }

    const evMatch = path.match(/^\/api\/events\/([^/]+)$/);
    if (evMatch && req.method === 'GET') {
      const idRaw = decodeURIComponent(evMatch[1] || '');
      const id = normalizeIdLoose(idRaw);
      const cached = lastEventById.get(id);
      if (cached && ttlOk(cached.ts, 30 * 60_000)) {
        sendJson(res, 200, cached.data);
        return true;
      }
      const sport = await resolveSport(id);
      if (!sport) return sendJson(res, 404, { error: 'Evento não encontrado' }), true;
      const live = await fetchLive(sport).catch(() => []);
      const foundLive = live.find((e: any) => String(e.id) === String(id));
      if (foundLive) return sendJson(res, 200, foundLive), true;
      const date = ymd(new Date());
      const sched = await fetchSchedule(sport, date).catch(() => []);
      const found = sched.find((e: any) => String(e.id) === String(id));
      if (found) return sendJson(res, 200, found), true;
      return sendJson(res, 404, { error: 'Evento não encontrado' }), true;
    }

    const oddsMatch = path.match(/^\/api\/events\/([^/]+)\/odds$/);
    if (oddsMatch && req.method === 'GET') {
      const idRaw = decodeURIComponent(oddsMatch[1] || '');
      const id = normalizeIdLoose(idRaw);
      const sport = await resolveSport(id);
      if (!sport) return sendJson(res, 404, { error: 'Evento não encontrado' }), true;
      const odds = await fetchOddsStrict(sport, id, { forceAll: true }).catch(() => null);
      const markets = odds?.markets || {};
      sendJson(res, 200, { home: odds?.home || 0, draw: odds?.draw || 0, away: odds?.away || 0, markets });
      return true;
    }

    const statsMatch = path.match(/^\/api\/events\/([^/]+)\/stats$/);
    if (statsMatch && req.method === 'GET') {
      const idRaw = decodeURIComponent(statsMatch[1] || '');
      const id = normalizeIdLoose(idRaw);
      const sport = await resolveSport(id);
      if (!sport) return sendJson(res, 404, { error: 'Evento não encontrado' }), true;
      const statsRaw = await fetchSportsApiProMatchStatistics(apiKey, sport, id).catch(() => null);
      sendJson(res, 200, { stats: statsRaw || [], events: [] });
      return true;
    }

    if (req.method === 'POST' && path === '/api/dev/force-import') {
      sendJson(res, 200, { ok: true });
      return true;
    }

    return false;
  };

  const getAdminOddsEvents = async (): Promise<any[]> => {
    const data = await buildBySport('all', true, null, false, true);
    const all = [...data.live, ...data.pregame];
    return all.map((e: any) => ({
      id: String(e.id),
      home_team: String(e.home_team || ''),
      away_team: String(e.away_team || ''),
      league: String(e.league || ''),
      home_odd: Number(e.home_odd || 0),
      draw_odd: Number(e.draw_odd || 0),
      away_odd: Number(e.away_odd || 0),
      is_live: Number(e.is_live || 0),
      sport: String(e.sport || ''),
    }));
  };

  const setOddsOverride = async (eventId: string, odds: { home_odd?: number; draw_odd?: number; away_odd?: number }): Promise<void> => {
    const ho = odds.home_odd != null ? Number(odds.home_odd) : null;
    const doo = odds.draw_odd != null ? Number(odds.draw_odd) : null;
    const ao = odds.away_odd != null ? Number(odds.away_odd) : null;
    if ((ho != null && !Number.isFinite(ho)) || (doo != null && !Number.isFinite(doo)) || (ao != null && !Number.isFinite(ao))) {
      throw new Error('Invalid odds');
    }
    await pool.query(
      `INSERT INTO odds_overrides (event_id, home_odd, draw_odd, away_odd, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (event_id) DO UPDATE SET home_odd = EXCLUDED.home_odd, draw_odd = EXCLUDED.draw_odd, away_odd = EXCLUDED.away_odd, updated_at = NOW()`,
      [eventId, ho, doo, ao],
    );
    overridesCache.delete(eventId);
  };

  return { handleEventsRoutes, getAdminOddsEvents, setOddsOverride };
}
