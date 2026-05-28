import type http from 'http';
import type pg from 'pg';
import { fetchSportsApiProLive, fetchSportsApiProMatchOddsAll, fetchSportsApiProMatchStatistics, fetchSportsApiProSchedule } from '../services/sportsApiPro';
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
  const idToSport = new Map<string, CacheEntry<string>>();
  const lastEventById = new Map<string, CacheEntry<AnyEvent>>();
  const overridesCache = new Map<string, CacheEntry<{ home_odd: number | null; draw_odd: number | null; away_odd: number | null }>>();

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

  const fetchOddsStrict = async (sport: string, matchId: string): Promise<any | null> => {
    const key = `${sport}:${matchId}`;
    const inflight = oddsInflight.get(key);
    if (inflight) return inflight;
    const p = fetchSportsApiProMatchOddsAll(apiKey, sport, matchId, {})
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
        fetchOddsStrict(sport, matchId).catch(() => null);
      }
      return cached.data;
    }

    if (refreshBudget && refreshBudget.remaining <= 0) {
      return cached ? cached.data : null;
    }

    if (refreshBudget) refreshBudget.remaining -= 1;
    return fetchOddsStrict(sport, matchId);
  };

  const enrichEventOdds = async (e: AnyEvent, refreshBudget: { remaining: number } | null): Promise<AnyEvent> => {
    const id = String(e?.id || '').trim();
    const sport = String(e?.sport || '').trim();
    if (!id || !sport) return e;

    const override = await getOverride(id).catch(() => null);
    const odds = await fetchOddsBestEffort(sport, id, refreshBudget).catch(() => null);
    const markets = odds?.markets ? odds.markets : parseMarkets((e as any).markets);
    const base = {
      ...e,
      home_odd: odds?.home ? Number(odds.home) : Number((e as any).home_odd || 0),
      draw_odd: odds?.draw ? Number(odds.draw) : Number((e as any).draw_odd || 0),
      away_odd: odds?.away ? Number(odds.away) : Number((e as any).away_odd || 0),
      markets,
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
  ): Promise<{ live: AnyEvent[]; pregame: AnyEvent[] }> => {
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

    const refreshBudget = { remaining: realtime ? 12 : 24 };
    const liveEnriched = await mapLimit(live, 6, (x) => enrichEventOdds(x, refreshBudget));
    const preEnriched = await mapLimit(pregame, 6, (x) => enrichEventOdds(x, refreshBudget));
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
      const cacheKey = `bySport:${String(sports || 'all')}|league:${String(league || '')}|includeOdds:${includeOdds ? '1' : '0'}|realtime:${realtime ? '1' : '0'}`;
      const cached = bySportCache.get(cacheKey);
      const ttl = realtime ? 2_000 : includeOdds ? 12_000 : 25_000;
      if (cached && ttlOk(cached.ts, ttl)) {
        sendJson(res, 200, cached.data);
        return true;
      }
      const data = await buildBySport(sports, includeOdds, league, realtime).catch(() => ({ live: [], pregame: [] }));
      bySportCache.set(cacheKey, { ts: nowMs(), data });
      sendJson(res, 200, data);
      return true;
    }

    const evMatch = path.match(/^\/api\/events\/([^/]+)$/);
    if (evMatch && req.method === 'GET') {
      const id = decodeURIComponent(evMatch[1] || '');
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
      const id = decodeURIComponent(oddsMatch[1] || '');
      const sport = await resolveSport(id);
      if (!sport) return sendJson(res, 404, { error: 'Evento não encontrado' }), true;
      const odds = await fetchOddsStrict(sport, id).catch(() => null);
      const markets = odds?.markets || {};
      sendJson(res, 200, { home: odds?.home || 0, draw: odds?.draw || 0, away: odds?.away || 0, markets });
      return true;
    }

    const statsMatch = path.match(/^\/api\/events\/([^/]+)\/stats$/);
    if (statsMatch && req.method === 'GET') {
      const id = decodeURIComponent(statsMatch[1] || '');
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
    const data = await buildBySport('all', true, null, false);
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
