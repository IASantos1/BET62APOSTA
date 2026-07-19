import type http from 'http';
import type pg from 'pg';
import {
  fetchSportsApiProLive,
  fetchSportsApiProV1AllScoresDelta,
  fetchSportsApiProMatchOddsAll,
  fetchSportsApiProMatchOddsLive,
  fetchSportsApiProMatchOddsPreMatch,
  fetchSportsApiProMatchStatistics,
  fetchSportsApiProMatchIncidents,
  fetchSportsApiProSchedule,
  fetchSportsApiProWorldCup2026,
  fetchSportsApiProWorldCup2026Groups,
  fetchSportsApiProWorldCup2026Info,
  fetchSportsApiProWorldCup2026Matches,
  fetchSportsApiProH2H,
  fetchSportsSoccerH2HByTeams,
  fetchSportsApiProStandings,
  fetchSportsSoccerInjuriesSuspensions,
  fetchSportsSoccerTeam,
  fetchSportsSoccerPlayer,
  fetchSportsSoccerCoach,
  fetchSportsSoccerLiveStorylines,
  fetchSportsSoccerTeamLineups,
  getSportsDataProviderConfig,
} from '../services/sportsDataProvider';
import { deriveAdditionalMarkets } from '../services/marketDerivation';
import { sendJson, badRequest } from '../lib/http';

type CacheEntry<T> = { ts: number; data: T };

type AnyEvent = any;

function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = Number(process.env[name] || '');
  if (!Number.isFinite(raw)) return fallback;
  const value = Math.floor(raw);
  return Math.max(min, Math.min(max, value));
}

const SPORTS_DEFAULT = ['soccer', 'tennis', 'basketball', 'baseball', 'ice-hockey', 'volleyball', 'mma'];
const LIVE_SPORTS_DEFAULT = ['soccer', 'tennis', 'basketball', 'baseball', 'ice-hockey', 'volleyball', 'mma'];
const RESOLVABLE_SPORTS = Array.from(new Set([...SPORTS_DEFAULT, ...LIVE_SPORTS_DEFAULT]));
// Sports with a working /api/live endpoint on SportsApiPro / WS bootstrap
const LIVE_CAPABLE = new Set([
  'soccer',
  'football',
  'futebol',
  'tennis',
  'basketball',
  'baseball',
  'ice-hockey',
  'hockey',
  'volleyball',
  'voleibol',
  'vôlei',
  'mma',
]);
const ODDS_FRESH_TTL_MS = envInt('SPORTS_PREMATCH_ODDS_TTL_MS', 90_000, 5_000, 10 * 60_000);
const LIVE_ODDS_FRESH_TTL_MS = envInt('SPORTS_LIVE_ODDS_TTL_MS', 4_000, 1_000, 15_000);
const ODDS_STALE_TTL_MS = envInt('SPORTS_ODDS_STALE_TTL_MS', 15 * 60_000, 60_000, 24 * 60 * 60_000);
const LIVE_HOLD_MS = envInt('SPORTS_LIVE_HOLD_MS', 75_000, 5_000, 5 * 60_000);
const REALTIME_CACHE_TTL_MS = envInt('SPORTS_REALTIME_CACHE_TTL_MS', 2_000, 500, 15_000);
const REALTIME_TENNIS_CACHE_TTL_MS = envInt('SPORTS_REALTIME_TENNIS_CACHE_TTL_MS', 1_000, 500, 10_000);
const REALTIME_STALE_TTL_MS = envInt('SPORTS_REALTIME_STALE_TTL_MS', 5_000, 1_000, 30_000);
const REALTIME_TENNIS_STALE_TTL_MS = envInt('SPORTS_REALTIME_TENNIS_STALE_TTL_MS', 2_000, 1_000, 15_000);
const REALTIME_COLD_TIMEOUT_MS = envInt('SPORTS_REALTIME_COLD_TIMEOUT_MS', 1_000, 1_000, 30_000);
const ODDS_COLD_TIMEOUT_MS = envInt('SPORTS_ODDS_COLD_TIMEOUT_MS', 20_000, 5_000, 60_000);
const PREGAME_COLD_TIMEOUT_MS = envInt('SPORTS_PREGAME_COLD_TIMEOUT_MS', 35_000, 10_000, 90_000);

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
  // Return all markets — no cap
  return markets;
}

export type EventsService = {
  handleEventsRoutes: (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    url: URL,
  ) => Promise<boolean>;
  getAdminOddsEvents: () => Promise<any[]>;
  setOddsOverride: (eventId: string, odds: { home_odd?: number; draw_odd?: number; away_odd?: number }) => Promise<void>;
  getEventsCache: () => Map<string, any>;
  getProviderMetrics: () => any;
  getProviderConfig: () => any;
  getBetValidationContext: (eventId: string) => Promise<{
    event: any | null;
    sport: string | null;
    odds: any | null;
    suspended: boolean;
    suspendedReason: string;
    suspendedMarkets: string[];
    providerSuspended: boolean;
    eventFrozen: boolean;
    freezeReason: string;
  }>;
};

function getBaselineOdds(sport: string): { home: number; draw: number; away: number } {
  const s = String(sport || '').toLowerCase().trim();
  if (s === 'soccer' || s === 'football') return { home: 2.10, draw: 3.30, away: 3.20 };
  if (s === 'tennis') return { home: 1.85, draw: 0, away: 2.10 };
  if (s === 'basketball') return { home: 1.90, draw: 0, away: 1.90 };
  if (s === 'baseball') return { home: 1.95, draw: 0, away: 1.95 };
  if (s === 'ice-hockey' || s === 'hockey') return { home: 2.10, draw: 3.40, away: 3.30 };
  if (s === 'volleyball') return { home: 1.80, draw: 0, away: 2.00 };
  if (s === 'handball') return { home: 1.90, draw: 3.50, away: 2.10 };
  if (s === 'rugby') return { home: 1.75, draw: 0, away: 2.10 };
  return { home: 1.90, draw: 0, away: 1.90 };
}

export function createEventsService(pool: pg.Pool | null, apiKey: string): EventsService {
  const liveCache = new Map<string, CacheEntry<AnyEvent[]>>();
  const scheduleCache = new Map<string, CacheEntry<AnyEvent[]>>();
  const oddsCache = new Map<string, CacheEntry<any>>();
  const oddsInflight = new Map<string, Promise<any | null>>();
  const bySportCache = new Map<string, CacheEntry<{ live: AnyEvent[]; pregame: AnyEvent[] }>>();
  // Deduplication: one build per cacheKey at a time — prevents concurrent API floods
  const bySportInFlight = new Map<string, Promise<{ live: AnyEvent[]; pregame: AnyEvent[] }>>();
  const worldCupCache = new Map<string, CacheEntry<any>>();
  const worldCupMatchesCache = new Map<string, CacheEntry<AnyEvent[]>>();
  const incidentsCache = new Map<string, CacheEntry<any>>();
  const incidentsInFlight = new Map<string, Promise<any>>();
  const oddsQueue: Array<{ sport: string; matchId: string }> = [];
  const oddsQueued = new Set<string>();
  let oddsQueueInFlight = 0;
  let oddsQueueStarted = false;
  const idToSport = new Map<string, CacheEntry<string>>();
  const lastEventById = new Map<string, CacheEntry<AnyEvent>>();
  const liveSeen = new Map<string, CacheEntry<{ sport: string; event: AnyEvent }>>();
  const overridesCache = new Map<string, CacheEntry<{ home_odd: number | null; draw_odd: number | null; away_odd: number | null }>>();
  const v1AllScoresCursorBySport = new Map<string, CacheEntry<string>>();
  const tennisFreezeByMatch = new Map<string, CacheEntry<{ until: number; reason: string }>>();
  const criticalFreezeByMatch = new Map<string, CacheEntry<{ until: number; reason: string; sport: string }>>();
  const lastCriticalIncidentKeyByMatch = new Map<string, CacheEntry<string>>();
  const providerMetrics = new Map<string, {
    requests: number;
    success: number;
    failures: number;
    cacheFreshHits: number;
    cacheStaleHits: number;
    cacheMisses: number;
    totalLatencyMs: number;
    lastLatencyMs: number;
    lastSuccessAt: number;
    lastFailureAt: number;
    lastError: string;
  }>();
  const liveOddsGapSamples = new Map<string, {
    sport: string;
    matchId: string;
    homeTeam: string;
    awayTeam: string;
    league: string;
    count: number;
    lastSeenAt: number;
    sources: {
      all: boolean;
      live: boolean;
      pre: boolean;
    };
    marketKeys: string[];
  }>();

  const ensureProviderMetric = (operation: string) => {
    const key = String(operation || '').trim().toLowerCase() || 'unknown';
    let metric = providerMetrics.get(key);
    if (!metric) {
      metric = {
        requests: 0,
        success: 0,
        failures: 0,
        cacheFreshHits: 0,
        cacheStaleHits: 0,
        cacheMisses: 0,
        totalLatencyMs: 0,
        lastLatencyMs: 0,
        lastSuccessAt: 0,
        lastFailureAt: 0,
        lastError: '',
      };
      providerMetrics.set(key, metric);
    }
    return metric;
  };

  const recordProviderCache = (operation: string, kind: 'fresh' | 'stale' | 'miss') => {
    const metric = ensureProviderMetric(operation);
    if (kind === 'fresh') metric.cacheFreshHits += 1;
    if (kind === 'stale') metric.cacheStaleHits += 1;
    if (kind === 'miss') metric.cacheMisses += 1;
  };

  const callProvider = async <T>(operation: string, loader: () => Promise<T>): Promise<T> => {
    const metric = ensureProviderMetric(operation);
    const startedAt = nowMs();
    metric.requests += 1;
    try {
      const result = await loader();
      metric.success += 1;
      metric.lastLatencyMs = Math.max(0, nowMs() - startedAt);
      metric.totalLatencyMs += metric.lastLatencyMs;
      metric.lastSuccessAt = nowMs();
      metric.lastError = '';
      return result;
    } catch (error: any) {
      metric.failures += 1;
      metric.lastLatencyMs = Math.max(0, nowMs() - startedAt);
      metric.lastFailureAt = nowMs();
      metric.lastError = String(error?.message || error || 'provider_error');
      throw error;
    }
  };

  const hasAnyRenderableH2H = (odds: any): boolean => {
    const home = Number(odds?.home || 0);
    const draw = Number(odds?.draw || 0);
    const away = Number(odds?.away || 0);
    if (home > 1 && away > 1) return true;
    const mk = odds?.markets && typeof odds.markets === 'object' ? odds.markets : {};
    const aliases = ['h2h', '1x2', 'main', 'match_winner', 'match_result', 'full_time_result', 'moneyline', 'winner'];
    for (const key of aliases) {
      const arr = (mk as any)?.[key];
      if (!Array.isArray(arr) || arr.length === 0) continue;
      const valid = arr.filter((s: any) => Number(s?.odd ?? s?.price ?? s?.value ?? 0) > 1.01);
      if (valid.length >= 2) return true;
    }
    return home > 1 || draw > 1 || away > 1;
  };

  const recordLiveOddsGapSample = (
    sport: string,
    matchId: string,
    ctx: { homeTeam?: string; awayTeam?: string },
    results: { allResult: any; liveResult: any; preResult: any; merged: any },
  ) => {
    const key = `${String(sport || '').trim().toLowerCase()}:${String(matchId || '').trim()}`;
    if (!key || key.endsWith(':')) return;
    const merged = results.merged;
    if (hasAnyRenderableH2H(merged)) {
      liveOddsGapSamples.delete(key);
      return;
    }
    const cachedEvent = lastEventById.get(String(matchId || '').trim())?.data;
    const prev = liveOddsGapSamples.get(key);
    const marketKeys = Object.keys((merged?.markets && typeof merged.markets === 'object') ? merged.markets : {}).slice(0, 12);
    liveOddsGapSamples.set(key, {
      sport: String(sport || '').trim(),
      matchId: String(matchId || '').trim(),
      homeTeam: String(ctx.homeTeam || (cachedEvent as any)?.home_team || '').trim(),
      awayTeam: String(ctx.awayTeam || (cachedEvent as any)?.away_team || '').trim(),
      league: String((cachedEvent as any)?.league || '').trim(),
      count: (prev?.count || 0) + 1,
      lastSeenAt: nowMs(),
      sources: {
        all: !!results.allResult,
        live: !!results.liveResult,
        pre: !!results.preResult,
      },
      marketKeys,
    });
    if (liveOddsGapSamples.size > 60) {
      const oldest = Array.from(liveOddsGapSamples.entries()).sort((a, b) => (a[1].lastSeenAt || 0) - (b[1].lastSeenAt || 0))[0]?.[0];
      if (oldest) liveOddsGapSamples.delete(oldest);
    }
  };

  const tennisSuspendedMarketKeys = (reason: string): string[] => {
    const r = String(reason || '').toUpperCase().trim();
    if (r === 'POINT') return ['game_winner', 'next_game_winner', 'first_serve_winner'];
    if (r === 'GAME') return ['game_winner', 'next_game_winner', 'break_points', 'break_points_converted', 'first_serve_winner'];
    if (r === 'SET_END') {
      return [
        'set_winner',
        'current_set_winner',
        'current_set_totals',
        'first_set_winner',
        'second_set_winner',
        'third_set_winner',
        'set_1_h2h',
        'set_2_h2h',
        'set_3_h2h',
        'set_4_h2h',
        'set_5_h2h',
        'game_winner',
        'next_game_winner',
        'break_points',
        'break_points_converted',
        'first_serve_winner',
      ];
    }
    return [];
  };

  const getTennisFreeze = (matchId: string): { until: number; reason: string } | null => {
    const id = String(matchId || '').trim();
    if (!id) return null;
    const now = nowMs();
    const freeze = tennisFreezeByMatch.get(id)?.data;
    if (freeze && freeze.until > now) return freeze;
    if (freeze) tennisFreezeByMatch.delete(id);
    return null;
  };

  const isSoccerSport = (sport: string): boolean => {
    const s = String(sport || '').toLowerCase().trim();
    return s === 'soccer' || s === 'football' || s === 'futebol' || (s.includes('football') && !s.includes('american'));
  };

  const parseScoreState = (v: any): any | null => {
    if (!v) return null;
    if (typeof v === 'object') return v;
    if (typeof v !== 'string') return null;
    try {
      return JSON.parse(v);
    } catch {
      return null;
    }
  };

  const normalizeProviderFlag = (value: any): boolean => {
    if (value === true || value === 1) return true;
    const s = String(value ?? '').trim().toLowerCase();
    return s === '1' || s === 'true' || s === 'yes' || s === 'blocked' || s === 'stopped';
  };

  const getProviderStatusObj = (event: any): any | null => {
    if (event?.provider_status && typeof event.provider_status === 'object') return event.provider_status;
    if (event?.fixture?.status?.raw && typeof event.fixture.status.raw === 'object') return event.fixture.status.raw;
    if (event?.fixture?.status && typeof event.fixture.status === 'object') return event.fixture.status;
    if (event?.status && typeof event.status === 'object') return event.status;
    return null;
  };

  const getCriticalFreeze = (matchId: string): { until: number; reason: string; sport: string } | null => {
    const id = String(matchId || '').trim();
    if (!id) return null;
    const now = nowMs();
    const freeze = criticalFreezeByMatch.get(id)?.data;
    if (freeze && freeze.until > now) return freeze;
    if (freeze) criticalFreezeByMatch.delete(id);
    return null;
  };

  const setCriticalFreeze = (matchId: string, sport: string, reason: string, ms: number) => {
    const id = String(matchId || '').trim();
    if (!id) return;
    const until = nowMs() + Math.max(1000, Math.floor(ms));
    criticalFreezeByMatch.set(id, {
      ts: nowMs(),
      data: {
        until,
        reason: String(reason || '').toUpperCase().trim(),
        sport: String(sport || '').toLowerCase().trim(),
      },
    });
  };

  const applyScoreDrivenFreeze = (sportKey: string, matchId: string, prev: any, out: any, now: number) => {
    const localSport = String(sportKey || '').toLowerCase().trim();
    const liveNow = Number(out?.is_live || 0) === 1;
    if (!liveNow) return;

    if (localSport === 'tennis') {
      const prevScore = parseScoreState((prev as any)?.score);
      const nextScore = parseScoreState((out as any)?.score);
      const prevPoint = prevScore?.point ? JSON.stringify(prevScore.point) : null;
      const nextPoint = nextScore?.point ? JSON.stringify(nextScore.point) : null;
      const prevSets = prevScore?.sets ? JSON.stringify(prevScore.sets) : null;
      const nextSets = nextScore?.sets ? JSON.stringify(nextScore.sets) : null;
      const prevHome = prevScore?.home ?? null;
      const prevAway = prevScore?.away ?? null;
      const nextHome = nextScore?.home ?? null;
      const nextAway = nextScore?.away ?? null;

      let reason: string | null = null;
      if (prevSets !== null && nextSets !== null && prevSets !== nextSets) reason = 'SET_END';
      else if (prevPoint !== null && nextPoint !== null && prevPoint !== nextPoint) reason = 'POINT';
      else if ((prevHome !== null || prevAway !== null) && (nextHome !== null || nextAway !== null) && (prevHome !== nextHome || prevAway !== nextAway)) reason = 'GAME';

      const freeze = getTennisFreeze(matchId);
      if (freeze) {
        out.suspended_reason = freeze.reason;
      } else if (['POINT', 'GAME', 'SET_END'].includes(String(out.suspended_reason || '').toUpperCase().trim())) {
        out.suspended_reason = undefined;
      }
      if (reason) {
        const until = now + (reason === 'POINT' ? 1000 : reason === 'GAME' ? 2500 : 6000);
        tennisFreezeByMatch.set(matchId, { ts: now, data: { until, reason } });
        out.suspended_reason = reason;
      }
      return;
    }

    if (isSoccerSport(localSport)) {
      const prevScore = parseScoreState((prev as any)?.score);
      const nextScore = parseScoreState((out as any)?.score);
      const prevHome = prevScore?.home ?? (prev as any)?.goals?.home ?? null;
      const prevAway = prevScore?.away ?? (prev as any)?.goals?.away ?? null;
      const nextHome = nextScore?.home ?? (out as any)?.goals?.home ?? null;
      const nextAway = nextScore?.away ?? (out as any)?.goals?.away ?? null;
      const scoreChanged =
        (prevHome !== null || prevAway !== null) &&
        (nextHome !== null || nextAway !== null) &&
        (prevHome !== nextHome || prevAway !== nextAway);

      const freeze = getCriticalFreeze(matchId);
      if (freeze) {
        out.suspended_reason = freeze.reason;
      } else if (['GOAL', 'VAR', 'CARD', 'PENALTY'].includes(String(out.suspended_reason || '').toUpperCase().trim())) {
        out.suspended_reason = undefined;
      }

      if (scoreChanged) {
        setCriticalFreeze(matchId, localSport, 'GOAL', 20_000);
        out.suspended_reason = 'GOAL';
      }
    }
  };

  const incidentTimeKey = (inc: any, idx: number) => {
    const minute = Number(inc?.minute ?? 0) || 0;
    const added = Number(inc?.addedTime ?? inc?.added_time ?? 0) || 0;
    return minute * 1000 + added * 10 + (idx % 10);
  };

  const processCriticalIncidentFreeze = (matchId: string, sport: string, incidents: any[]) => {
    if (!isSoccerSport(sport) || !Array.isArray(incidents) || incidents.length === 0) return;
    let latest: any = null;
    let latestIdx = -1;
    let latestKey = -Infinity;
    for (let i = 0; i < incidents.length; i++) {
      const inc = incidents[i];
      const k = incidentTimeKey(inc, i);
      if (k >= latestKey) {
        latest = inc;
        latestIdx = i;
        latestKey = k;
      }
    }
    if (!latest) return;
    const dedupeKey = [
      String(latest?.id ?? ''),
      String(latest?.type ?? '').toLowerCase(),
      String(latest?.minute ?? ''),
      String(latest?.addedTime ?? latest?.added_time ?? ''),
      String(latest?.description ?? ''),
      String(latestIdx),
    ].join('|');
    const prevKey = lastCriticalIncidentKeyByMatch.get(matchId)?.data;
    if (prevKey === dedupeKey) return;
    lastCriticalIncidentKeyByMatch.set(matchId, { ts: nowMs(), data: dedupeKey });

    const type = String(latest?.type || '').toLowerCase();
    if (type === 'var') {
      setCriticalFreeze(matchId, sport, 'VAR', 20_000);
      return;
    }
    if (type === 'goal' || type === 'own_goal' || type === 'disallowed_goal') {
      setCriticalFreeze(matchId, sport, 'GOAL', 20_000);
      return;
    }
    if (type === 'penalty' || type === 'penalty_awarded' || type === 'missed_penalty') {
      setCriticalFreeze(matchId, sport, 'PENALTY', 18_000);
      return;
    }
    if (type === 'red_card' || type === 'yellow_red') {
      setCriticalFreeze(matchId, sport, 'CARD', 15_000);
    }
  };

  const getSuspensionState = (matchId: string, sport: string, event: any, odds?: any) => {
    const collectMarketKeys = (): string[] => {
      const source = (odds?.markets && typeof odds.markets === 'object') ? odds.markets
        : ((event?.markets && typeof event.markets === 'object') ? event.markets : null);
      return source ? Object.keys(source) : [];
    };
    const soccerPhase = (() => {
      const statusShort = String(event?.status_short ?? event?.fixture?.status?.short ?? '').toUpperCase().trim();
      const statusLong = String(event?.status_long ?? event?.fixture?.status?.long ?? '').toLowerCase().trim();
      const elapsed = Number(event?.elapsed ?? event?.fixture?.status?.elapsed ?? 0);
      if (statusShort === '1H' || statusLong.includes('first half')) return 'first_half' as const;
      if (statusShort === 'HT' || statusLong.includes('half-time') || statusLong.includes('halftime')) return 'half_time' as const;
      if (statusShort === '2H' || statusLong.includes('second half')) return 'second_half' as const;
      if (elapsed >= 46) return 'second_half' as const;
      if (elapsed > 0) return 'first_half' as const;
      return 'other' as const;
    })();
    const getTennisLikeSetNumber = () => {
      const statusShort = String(event?.status_short ?? event?.fixture?.status?.short ?? '').toUpperCase().trim();
      const statusMatch = /^S([1-5])$/.exec(statusShort);
      if (statusMatch) return Math.max(1, Math.min(5, Number(statusMatch[1])));
      const scoreHome = Number(event?.score?.home ?? 0);
      const scoreAway = Number(event?.score?.away ?? 0);
      const wonSets = (Number.isFinite(scoreHome) ? scoreHome : 0) + (Number.isFinite(scoreAway) ? scoreAway : 0);
      return Math.max(1, Math.min(5, wonSets + 1));
    };
    const getPeriodLikeNumber = (label: 'Q' | 'P' | 'IN') => {
      const statusShort = String(event?.status_short ?? event?.fixture?.status?.short ?? '').toUpperCase().trim();
      const statusLong = String(event?.status_long ?? event?.fixture?.status?.long ?? '').toLowerCase().trim();
      const match = new RegExp(`^${label}(\\d+)$`).exec(statusShort);
      if (match) return Math.max(1, Number(match[1]));
      if (label === 'IN') {
        const longMatch = /(\d+)(?:st|nd|rd|th)?\s+inning/.exec(statusLong);
        if (longMatch) return Math.max(1, Number(longMatch[1]));
        if (statusShort === 'IN' || statusLong.includes('inning')) return 1;
      }
      return null;
    };
    const progressiveMarketClosures = (() => {
      const sportKey = String(sport || '').toLowerCase().trim();
      const keys = collectMarketKeys();
      if (keys.length === 0) return [] as string[];
      const closed = new Set<string>();
      const keepOnly = (predicate: (key: string) => boolean) => closeIf((key) => !predicate(key));
      const closeIf = (predicate: (key: string) => boolean) => {
        for (const key of keys) if (predicate(key)) closed.add(key);
      };
      const tennisSetKeyIndex = (marketKey: string): number | null => {
        const key = String(marketKey || '').toLowerCase().trim();
        const direct = /^set_(\d+)_/.exec(key);
        if (direct) return Number(direct[1]);
        const named = /^(first|second|third|fourth|fifth)_set_/.exec(key);
        if (named) {
          const map: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5 };
          return map[named[1]] || null;
        }
        return null;
      };
      const isCurrentTennisSetKey = (marketKey: string): boolean => String(marketKey || '').toLowerCase().startsWith('current_set_');

      if (isSoccerSport(sportKey)) {
        const elapsed = Number(event?.elapsed ?? event?.fixture?.status?.elapsed ?? 0);
        const firstHalfOnly = new Set([
          '1st_half', 'first_half_h2h', 'half_time_result', 'first_half_result',
          '1st_half_totals', 'first_half_totals', 'first_half_goals_total',
          '1st_half_goal_odd_even', '1st_half_correct_score',
          'double_chance_1st_half', 'draw_no_bet_1st_half', 'btts_first_half',
          '1st_half_corners', '1st_half_cards',
        ]);
        const secondHalfOnly = new Set([
          '2nd_half', 'second_half_h2h', 'second_half_result',
          '2nd_half_totals', 'second_half_totals', 'second_half_goals_total',
          '2nd_half_correct_score', 'btts_second_half',
          '2nd_half_corners', '2nd_half_cards',
        ]);
        if (soccerPhase !== 'first_half') closeIf((key) => firstHalfOnly.has(key));
        if (soccerPhase !== 'second_half') closeIf((key) => secondHalfOnly.has(key));

        const keep85 = (key: string) => (
          ['h2h', 'totals', 'match_goals', 'goals_total', 'total_goals', 'double_chance', 'draw_no_bet', 'btts',
           'corners_total', 'corners_2_way', 'corner_handicap', 'spreads', 'handicap', 'next_goal', 'first_team_to_score', 'team_to_score_last']
            .includes(key) ||
          /^totals_[\d_]+$/.test(key) ||
          /^corners_total_[\d_]+$/.test(key) ||
          /^asian_handicap_/.test(key) ||
          /^handicap_european_/.test(key)
        );
        const keep90 = (key: string) => (
          ['h2h', 'totals', 'match_goals', 'goals_total', 'total_goals', 'corners_total', 'corners_2_way',
           'corner_handicap', 'spreads', 'handicap', 'next_goal', 'first_team_to_score']
            .includes(key) ||
          /^totals_[\d_]+$/.test(key) ||
          /^corners_total_[\d_]+$/.test(key) ||
          /^asian_handicap_/.test(key) ||
          /^handicap_european_/.test(key)
        );
        if (elapsed >= 90) closeIf((key) => !keep90(key));
        else if (elapsed >= 85) closeIf((key) => !keep85(key));
      } else if (sportKey === 'tennis') {
        const currentSet = getTennisLikeSetNumber();
        closeIf((key) => {
          const setIdx = tennisSetKeyIndex(key);
          return !!(setIdx && setIdx !== currentSet);
        });
        if (currentSet >= 2) {
          keepOnly((key) =>
            ['h2h', 'current_set_winner', 'current_set_totals', 'set_winner', 'sets_winner', 'sets_h2h',
             'total_sets', 'over_under_sets', 'spreads', 'handicap', 'sets_handicap', 'games_handicap',
             'totals', 'match_total_games', 'set_total_games', 'player_games', 'game_winner', 'next_game_winner',
             'tie_break', 'tie_breaks', 'tie_break_in_match']
              .includes(key) ||
            isCurrentTennisSetKey(key) ||
            tennisSetKeyIndex(key) === currentSet
          );
        }
      } else if (sportKey === 'volleyball') {
        const currentSet = getTennisLikeSetNumber();
        const setAliases: Record<number, string[]> = {
          1: ['first_set_winner', 'first_set_total'],
          2: ['second_set_winner', 'second_set_total'],
          3: ['third_set_winner', 'third_set_total'],
          4: ['fourth_set_winner', 'fourth_set_total'],
          5: ['fifth_set_winner', 'fifth_set_total'],
        };
        for (const [idx, aliases] of Object.entries(setAliases)) {
          if (Number(idx) !== currentSet) closeIf((key) => aliases.includes(key));
        }
        if (currentSet >= 3) {
          keepOnly((key) =>
            ['h2h', 'totals', 'spreads', 'handicap', 'total_sets', 'over_under_sets', 'sets_h2h', 'sets_winner',
             'sets_handicap', 'set_total_points', 'point_handicap', 'winning_margin',
             'first_set_winner', 'second_set_winner', 'third_set_winner', 'fourth_set_winner', 'fifth_set_winner',
             'first_set_total', 'second_set_total', 'third_set_total', 'fourth_set_total', 'fifth_set_total']
              .includes(key)
          );
        }
      } else if (sportKey === 'basketball') {
        const quarter = getPeriodLikeNumber('Q');
        if (quarter) {
          const aliases: Record<number, string[]> = {
            1: ['q1_h2h', 'q1_totals'],
            2: ['q2_h2h', 'q2_totals'],
            3: ['q3_h2h', 'q3_totals'],
            4: ['q4_h2h', 'q4_totals'],
          };
          for (const [idx, keysForQuarter] of Object.entries(aliases)) {
            if (Number(idx) !== quarter) closeIf((key) => keysForQuarter.includes(key));
          }
          if (quarter >= 4) {
            keepOnly((key) =>
              ['h2h', 'totals', 'team_totals', 'spreads', 'handicap', 'alternate_spreads',
               'q4_h2h', 'q4_totals', 'quarters_h2h', 'quarters_totals',
               'double_chance', 'winning_margin', 'margin', 'race_to', 'race_to_points',
               'first_to_score', 'next_basket', 'next_scorer', 'three_pointer']
                .includes(key)
            );
          }
        }
      } else if (sportKey === 'hockey' || sportKey === 'ice-hockey') {
        const period = getPeriodLikeNumber('P');
        if (period) {
          const aliases: Record<number, string[]> = {
            1: ['period_1_h2h', 'period_1_totals'],
            2: ['period_2_h2h', 'period_2_totals'],
            3: ['period_3_h2h', 'period_3_totals'],
          };
          for (const [idx, keysForPeriod] of Object.entries(aliases)) {
            if (Number(idx) !== period) closeIf((key) => keysForPeriod.includes(key));
          }
          if (period >= 3) {
            keepOnly((key) =>
              ['h2h', 'totals', 'team_totals', 'puck_line', 'spreads', 'handicap', 'double_chance',
               'winning_margin', 'first_to_score', 'period_3_h2h', 'period_3_totals',
               'next_goal_scorer', 'shots_on_goal', 'shots_on_goal_period', 'power_play', 'power_play_goals']
                .includes(key)
            );
          }
        }
      } else if (sportKey === 'baseball') {
        const inning = getPeriodLikeNumber('IN');
        if (inning && inning !== 1) {
          closeIf((key) => ['nrfi', 'yrfi', 'first_inning_run', 'first_inning_h2h', 'first_inning_totals', 'result_1st_inning'].includes(key));
        }
        if (inning && inning >= 7) {
          keepOnly((key) =>
            ['h2h', 'totals', 'run_line', 'spreads', 'handicap', 'team_totals', 'extra_innings',
             'winning_margin', 'inning_winner', 'inning_h2h', 'innings_h2h', 'inning_totals', 'innings_totals',
             'race_to', 'race_to_runs', 'run_range', 'run_total_range']
              .includes(key)
          );
        }
      }
      return Array.from(closed);
    })();
    const sportKey = String(sport || '').toLowerCase().trim();
    const providerStatus = getProviderStatusObj(event);
    const providerReason = String(
      odds?.suspended_reason ||
        providerStatus?.reason ||
        providerStatus?.description ||
        providerStatus?.type ||
        event?.suspended_reason ||
        '',
    );
    const providerSuspended = !!(
      odds?.suspended === true ||
      normalizeProviderFlag(providerStatus?.blocked) ||
      normalizeProviderFlag(providerStatus?.stopped) ||
      String(providerStatus?.short || providerStatus?.type || event?.status_short || event?.status || '').toUpperCase() === 'SUSPENDED'
    );
    const tennisFreeze = sportKey === 'tennis' ? getTennisFreeze(matchId) : null;
    const criticalFreeze = isSoccerSport(sportKey) ? getCriticalFreeze(matchId) : null;
    const activeFreeze = criticalFreeze || tennisFreeze;
    const suspendedMarkets = Array.from(new Set([
      ...(tennisFreeze ? tennisSuspendedMarketKeys(tennisFreeze.reason) : []),
      ...progressiveMarketClosures,
    ]));
    const freezeReason = String(activeFreeze?.reason || '');
    const suspendedReason = String((providerSuspended ? providerReason : '') || (activeFreeze ? freezeReason : '') || '');
    return {
      providerSuspended,
      eventFrozen: !!activeFreeze,
      freezeReason,
      suspended: providerSuspended || !!activeFreeze,
      suspendedReason,
      suspendedMarkets,
      activeFreeze,
    };
  };

  const buildSuspensionPayload = (suspension: ReturnType<typeof getSuspensionState>) => ({
    suspended: suspension.suspended,
    suspended_reason: suspension.suspendedReason || undefined,
    suspended_markets: suspension.suspendedMarkets,
    provider_suspended: suspension.providerSuspended,
    provider_suspended_reason: suspension.providerSuspended ? (suspension.suspendedReason || undefined) : undefined,
    event_frozen: suspension.eventFrozen,
    freeze_reason: suspension.freezeReason || undefined,
  });

  const attachSuspensionPayload = (event: any, suspension: ReturnType<typeof getSuspensionState>) => ({
    ...(event || {}),
    ...buildSuspensionPayload(suspension),
  });

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

  const getSports = (sportsParam: string | null, mode: 'default' | 'live' = 'default'): string[] => {
    const raw = String(sportsParam || '').trim();
    if (!raw || raw === 'all') return (mode === 'live' ? LIVE_SPORTS_DEFAULT : SPORTS_DEFAULT).slice();
    const parts = raw.split(',').map((x) => x.trim()).filter(Boolean);
    if (parts.length === 0) return (mode === 'live' ? LIVE_SPORTS_DEFAULT : SPORTS_DEFAULT).slice();
    return parts;
  };

  const rememberSport = (matchId: string, sport: string) => {
    if (!matchId) return;
    idToSport.set(matchId, { ts: nowMs(), data: sport });
  };

  const resolveSport = async (matchId: string): Promise<string | null> => {
    const c = idToSport.get(matchId);
    if (c && ttlOk(c.ts, 6 * 60 * 60 * 1000)) return c.data;
    for (const s of RESOLVABLE_SPORTS) {
      const live = await fetchLive(s).catch(() => []);
      if (live.some((e: any) => String(e.id) === String(matchId))) {
        rememberSport(matchId, s);
        return s;
      }
      const days = 7;
      for (let i = 0; i < days; i++) {
        const d = new Date();
        d.setDate(d.getDate() + i);
        const date = ymd(d);
        const list = await fetchSchedule(s, date).catch(() => []);
        if (list.some((e: any) => String(e.id) === String(matchId))) {
          rememberSport(matchId, s);
          return s;
        }
      }
    }
    return null;
  };

  const isFinishedLike = (e: any): boolean => {
    const status = (e as any)?.status ?? (e as any)?.fixture?.status ?? '';
    const raw =
      (typeof status === 'object' && status !== null)
        ? ((status as any).short ?? (status as any).long ?? (status as any).description ?? (status as any).type)
        : status;
    const su = String(raw || '').toUpperCase().trim();
    if (!su) return false;
    const s = su.replace(/[^A-Z0-9_]+/g, '_').replace(/^_+/, '').replace(/_+$/, '');
    if (
      s === 'FT' ||
      s === 'FINAL' ||
      s === 'FINISHED' ||
      s === 'ENDED' ||
      s === 'END' ||
      s === 'FULL_TIME' ||
      s === 'MATCH_FINISHED' ||
      s === 'COMPLETED' ||
      s === 'CANCELLED' ||
      s === 'CANCELED' ||
      s === 'POSTPONED' ||
      s === 'SUSPENDED' ||
      s === 'ABANDONED' ||
      s === 'WALKOVER' ||
      s === 'WO'
    ) return true;
    if (/FINISH|ENDED|FINAL|FULLTIME|GAMEOVER|CANCEL|POSTPON|ABANDON|WALKOVER/.test(s)) return true;
    return false;
  };

  const statusKeyOf = (e: any): string => {
    const status = (e as any)?.status ?? (e as any)?.fixture?.status ?? '';
    const raw =
      (typeof status === 'object' && status !== null)
        ? ((status as any).short ?? (status as any).long ?? (status as any).description ?? (status as any).type)
        : status;
    const su = String(raw || '').toUpperCase().trim();
    if (!su) return '';
    return su.replace(/[^A-Z0-9_]+/g, '_').replace(/^_+/, '').replace(/_+$/, '');
  };

  const isLiveLike = (e: any): boolean => {
    if (Number((e as any)?.is_live || 0) === 1) return true;
    const s = statusKeyOf(e);
    if (!s) return false;
    if (
      s === 'LIVE' ||
      s === 'INPLAY' ||
      s === 'IN_PLAY' ||
      s === '1H' ||
      s === '2H' ||
      s === 'HT' ||
      s === 'ET' ||
      s === 'P' ||
      s === 'Q1' ||
      s === 'Q2' ||
      s === 'Q3' ||
      s === 'Q4' ||
      s === 'OT' ||
      s === 'IN'
    ) return true;
    if (/(LIVE|INPLAY|IN_PLAY|1H|2H|HT|Q[1-4]|OVERTIME|EXTRA_TIME)/.test(s)) return true;
    return false;
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
      while (oddsQueueInFlight < 20 && oddsQueue.length > 0) {
        const next = oddsQueue.shift();
        if (!next) break;
        const key = `${next.sport}:${next.matchId}`;
        oddsQueueInFlight += 1;
        fetchOddsStrict(next.sport, next.matchId)
          .catch(() => null)
          .finally(() => {
            oddsQueueInFlight -= 1;
            oddsQueued.delete(key);
          });
      }
    }, 60);
  };

  const fetchLive = async (sport: string): Promise<AnyEvent[]> => {
    const key = sport;
    const cached = liveCache.get(key);
    const sLower = String(sport || '').toLowerCase();
    const liveFreshTtl = sLower === 'tennis' || sLower === 'soccer' || sLower === 'football' ? 1_000 : 2_000;
    if (cached && ttlOk(cached.ts, liveFreshTtl)) {
      recordProviderCache('live', 'fresh');
      return cached.data;
    }
    if (cached && ttlOk(cached.ts, 2 * 60_000)) {
      recordProviderCache('live', 'stale');
      callProvider('live', () => fetchSportsApiProLive(apiKey, sport))
        .then((list) => {
          const normalized = (Array.isArray(list) ? list : []).map((e: any) => {
            const id = String((e as any).id || '').trim() || String((e as any).external_event_id || '').split('_').pop() || '';
            const prev = lastEventById.get(id)?.data;
            const out: any = { ...e, id, sport };
            const now = nowMs();
            const liveNow = Number(out?.is_live || 0) === 1;
            applyScoreDrivenFreeze(String(sport || '').toLowerCase(), id, prev, out, now);
            rememberSport(id, sport);
            lastEventById.set(id, { ts: nowMs(), data: out });
            if (Number((out as any)?.is_live || 0) === 1) {
              liveSeen.set(id, { ts: nowMs(), data: { sport, event: out } });
            } else if (liveSeen.has(id)) {
              // Game went non-live: update cached data so hold check can detect finished status
              const old = liveSeen.get(id)!;
              liveSeen.set(id, { ts: old.ts, data: { sport, event: out } });
            }
            return out;
          });
          liveCache.set(key, { ts: nowMs(), data: normalized });
        })
        .catch(() => void 0);
      return cached.data;
    }
    recordProviderCache('live', 'miss');
    const list = await callProvider('live', () => fetchSportsApiProLive(apiKey, sport)).catch(() => []);
    const normalized = (Array.isArray(list) ? list : []).map((e: any) => {
      const id = String((e as any).id || '').trim() || String((e as any).external_event_id || '').split('_').pop() || '';
      const prev = lastEventById.get(id)?.data;
      const out: any = { ...e, id, sport };
      const now = nowMs();
      const liveNow = Number(out?.is_live || 0) === 1;
      applyScoreDrivenFreeze(String(sport || '').toLowerCase(), id, prev, out, now);
      rememberSport(id, sport);
      lastEventById.set(id, { ts: nowMs(), data: out });
      if (Number((out as any)?.is_live || 0) === 1) {
        liveSeen.set(id, { ts: nowMs(), data: { sport, event: out } });
      } else if (liveSeen.has(id)) {
        // Game went non-live: update cached data so hold check can detect finished status
        const old = liveSeen.get(id)!;
        liveSeen.set(id, { ts: old.ts, data: { sport, event: out } });
      }
      return out;
    });
    liveCache.set(key, { ts: nowMs(), data: normalized });
    return normalized;
  };

  const normalizeScheduleList = (list: any[], sport: string): AnyEvent[] =>
    (Array.isArray(list) ? list : []).map((e: any) => {
      const id = String((e as any).id || '').trim() || String((e as any).external_event_id || '').split('_').pop() || '';
      const out = { ...e, id, sport };
      rememberSport(id, sport);
      lastEventById.set(id, { ts: nowMs(), data: out });
      return out;
    });

  const fetchSchedule = async (sport: string, date: string): Promise<AnyEvent[]> => {
    const key = `${sport}:${date}`;
    const cached = scheduleCache.get(key);
    // Fresh cache: serve immediately
    if (cached && ttlOk(cached.ts, 20 * 60_000)) {
      recordProviderCache('schedule', 'fresh');
      return cached.data;
    }
    // Stale-while-revalidate (up to 3h): serve stale, refresh in background
    if (cached && ttlOk(cached.ts, 3 * 60 * 60 * 1000)) {
      recordProviderCache('schedule', 'stale');
      callProvider('schedule', () => fetchSportsApiProSchedule(apiKey, sport, date))
        .then((list) => {
          if (list && list.length > 0) {
            scheduleCache.set(key, { ts: nowMs(), data: normalizeScheduleList(list, sport) });
          }
        })
        .catch(() => void 0);
      return cached.data;
    }
    // Very stale (>3h) or cold: try fresh fetch; on failure keep/return any stale data
    recordProviderCache('schedule', 'miss');
    const list = await callProvider('schedule', () => fetchSportsApiProSchedule(apiKey, sport, date)).catch(() => null);
    if (list === null) {
      // API failed (timeout/rate-limit): return stale data if available, otherwise empty
      if (cached) return cached.data;
      return [];
    }
    const normalized = normalizeScheduleList(list, sport);
    // Only overwrite cache if we got real data (prevents caching empty on rate-limit recovery)
    if (normalized.length > 0 || !cached) {
      scheduleCache.set(key, { ts: nowMs(), data: normalized });
    }
    return normalized;
  };

  const fetchWorldCupMeta = async (kind: 'tournament' | 'info' | 'groups'): Promise<any | null> => {
    const key = `meta:${kind}`;
    const cached = worldCupCache.get(key);
    if (cached && ttlOk(cached.ts, 60 * 60_000)) return cached.data;
    let data: any | null = null;
    if (kind === 'tournament') data = await fetchSportsApiProWorldCup2026(apiKey).catch(() => null);
    if (kind === 'info') data = await fetchSportsApiProWorldCup2026Info(apiKey).catch(() => null);
    if (kind === 'groups') data = await fetchSportsApiProWorldCup2026Groups(apiKey).catch(() => null);
    worldCupCache.set(key, { ts: nowMs(), data });
    return data;
  };

  const fetchWorldCupMatches = async (page: number): Promise<AnyEvent[]> => {
    const p = Number.isFinite(page) ? Math.max(0, Math.min(20, Math.floor(page))) : 0;
    const key = `matches:${p}`;
    const cached = worldCupMatchesCache.get(key);
    if (cached && ttlOk(cached.ts, 20 * 60_000)) return cached.data;
    const list = await fetchSportsApiProWorldCup2026Matches(apiKey, p).catch(() => []);
    const normalized = (Array.isArray(list) ? list : []).map((e: any) => {
      const id = String((e as any).id || '').trim() || String((e as any).external_event_id || '').split('_').pop() || '';
      const out = { ...e, id, sport: 'soccer' };
      rememberSport(id, 'soccer');
      lastEventById.set(id, { ts: nowMs(), data: out });
      return out;
    });
    worldCupMatchesCache.set(key, { ts: nowMs(), data: normalized });
    return normalized;
  };

  const getOverride = async (eventId: string): Promise<{ home_odd: number | null; draw_odd: number | null; away_odd: number | null } | null> => {
    const c = overridesCache.get(eventId);
    if (c && ttlOk(c.ts, 10_000)) return c.data;
    if (!pool) return null;
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

  const mergeOddsResults = (results: any[]): any | null => {
    const valid = results.filter(r => r != null);
    if (valid.length === 0) return null;
    if (valid.length === 1) return valid[0];
    const merged: Record<string, any[]> = {};
    for (const r of valid) {
      const markets = r.markets && typeof r.markets === 'object' ? r.markets : {};
      for (const [key, lines] of Object.entries(markets)) {
        if (!Array.isArray(lines) || lines.length === 0) continue;
        if (!merged[key]) {
          merged[key] = lines;
        } else {
          const existing = merged[key];
          const existingSet = new Set(existing.map((l: any) => `${String(l.label || l.value || '')}|${String(l.point || '')}`));
          for (const line of lines) {
            const k = `${String(line.label || line.value || '')}|${String(line.point || '')}`;
            if (!existingSet.has(k)) {
              existing.push(line);
              existingSet.add(k);
            }
          }
        }
      }
    }
    const pick = (k: 'home' | 'draw' | 'away'): number => {
      for (const r of valid) {
        const v = Number((r as any)?.[k] || 0);
        if (v > 1) return v;
      }
      return Number((valid[0] as any)?.[k] || 0) || 0;
    };
    return {
      home: pick('home'),
      draw: pick('draw'),
      away: pick('away'),
      markets: merged,
    };
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
      const [allResult, liveResult, preResult] = await Promise.all([
        callProvider('odds', () => fetchSportsApiProMatchOddsAll(apiKey, sport, normalizedId, opts)).catch(() => null),
        callProvider('odds', () => fetchSportsApiProMatchOddsLive(apiKey, sport, normalizedId, opts)).catch(() => null),
        callProvider('odds', () => fetchSportsApiProMatchOddsPreMatch(apiKey, sport, normalizedId, opts)).catch(() => null),
      ]);
      const merged = mergeOddsResults([allResult, liveResult, preResult].filter(Boolean));
      if (ctx.isLive) {
        recordLiveOddsGapSample(sport, normalizedId, opts, { allResult, liveResult, preResult, merged });
      }
      if (merged && merged.markets && typeof merged.markets === 'object') {
        const derived = deriveAdditionalMarkets(
          merged.markets,
          sport,
          ctx.homeTeam || '',
          ctx.awayTeam || '',
        );
        // Derived markets fill gaps — real API odds always take priority
        merged.markets = { ...derived, ...merged.markets };
      }
      return merged;
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

    const freshTtl = ctx.isLive ? LIVE_ODDS_FRESH_TTL_MS : ODDS_FRESH_TTL_MS;
    if (cached && cached.data != null && ttlOk(cached.ts, freshTtl)) {
      recordProviderCache('odds', 'fresh');
      return cached.data;
    }

    if (cached && cached.data != null && ttlOk(cached.ts, ODDS_STALE_TTL_MS)) {
      recordProviderCache('odds', 'stale');
      if (refreshBudget && refreshBudget.remaining > 0 && !oddsInflight.has(key)) {
        refreshBudget.remaining -= 1;
        fetchOddsStrict(sport, matchId, ctx).catch(() => null);
      } else {
        queueOddsRefresh(sport, matchId);
      }
      return cached.data;
    }

    if (cached && cached.data == null) {
      queueOddsRefresh(sport, matchId);
    }

    if (refreshBudget && refreshBudget.remaining <= 0) {
      queueOddsRefresh(sport, matchId);
      return cached ? cached.data : null;
    }

    recordProviderCache('odds', 'miss');
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
    const rawHome0 = Number((e as any).home_odd || 0);
    const rawDraw0 = Number((e as any).draw_odd || 0);
    const rawAway0 = Number((e as any).away_odd || 0);
    const existingMkRaw = (e as any)?.markets ?? (e as any)?.odds;
    const existingMk =
      existingMkRaw && typeof existingMkRaw === 'object'
        ? existingMkRaw
        : parseMarkets(existingMkRaw);
    const hasExistingMarkets = !!(existingMk && typeof existingMk === 'object' && Object.keys(existingMk).length > 0);
    const hasExistingOdds = rawHome0 > 1 && rawAway0 > 1;

    if (hasExistingOdds || hasExistingMarkets) {
      const marketsAll = existingMk && typeof existingMk === 'object' ? existingMk : {};
      const markets =
        fullMarkets
          ? marketsAll
          : pruneMarketsForList(sport, marketsAll && typeof marketsAll === 'object' ? marketsAll : {});
      const base = {
        ...e,
        id,
        home_odd: rawHome0,
        draw_odd: rawDraw0,
        away_odd: rawAway0,
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
    }

    const odds = await fetchOddsBestEffort(
      sport,
      id,
      {
        isLive: isLiveLike(e),
        homeTeam: String(e?.home_team || ''),
        awayTeam: String(e?.away_team || ''),
      },
      refreshBudget,
    ).catch(() => null);
    const marketsAll = odds?.markets ? odds.markets : (existingMk && typeof existingMk === 'object' ? existingMk : {});
    const markets =
      fullMarkets
        ? marketsAll
        : pruneMarketsForList(sport, (marketsAll && typeof marketsAll === 'object') ? marketsAll : {});
    const rawHome = odds?.home ? Number(odds.home) : Number((e as any).home_odd || 0);
    const rawDraw = odds?.draw ? Number(odds.draw) : Number((e as any).draw_odd || 0);
    const rawAway = odds?.away ? Number(odds.away) : Number((e as any).away_odd || 0);
    const base = {
      ...e,
      id,
      home_odd: rawHome,
      draw_odd: rawDraw,
      away_odd: rawAway,
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
      for (;;) {
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
    only: 'live' | 'pregame' | 'both',
    daysAhead: number,
    requireOdds: boolean,
    allowBlocked: boolean,
  ): Promise<{ live: AnyEvent[]; pregame: AnyEvent[] }> => {
    startOddsQueue();
    const sports = getSports(sportsParam);
    const liveSportsRequested = getSports(sportsParam, 'live');
    const liveAll: AnyEvent[] = [];
    const preAll: AnyEvent[] = [];

    const includeLive = only === 'both' || only === 'live';
    const includePregame = only === 'both' || only === 'pregame';
    const days = Math.max(0, Math.min(14, Number.isFinite(daysAhead) ? daysAhead : 0));
    const now = nowMs();
    const toStartMs = (e: any) => {
      const raw = (e as any)?.event_date ?? (e as any)?.fixture?.date ?? (e as any)?.start_time ?? (e as any)?.startTimestamp;
      if (!raw) return 0;
      if (typeof raw === 'number') return raw > 10_000_000_000 ? raw : raw * 1000;
      const t = new Date(String(raw)).getTime();
      return Number.isFinite(t) ? t : 0;
    };

    if (includeLive && sports.length > 0) {
      // Only fetch live for sports whose /api/live endpoint actually works (football only)
      const liveSports = liveSportsRequested.filter((s) => LIVE_CAPABLE.has(String(s || '').toLowerCase().trim()));
      const lists = await mapLimit(liveSports, 2, (s) => fetchLive(s).catch(() => []));
      for (const live of lists) {
        liveAll.push(...(live || []).filter((e: any) => isLiveLike(e)));
      }
    }

    if (includePregame && sports.length > 0) {
      const isNotStartedLike = (e: any) => {
        const status = (e as any)?.status ?? (e as any)?.fixture?.status ?? '';
        const raw =
          (typeof status === 'object' && status !== null)
            ? ((status as any).short ?? (status as any).long ?? (status as any).description ?? (status as any).type)
            : status;
        const su = String(raw || '').toUpperCase().trim();
        if (!su) return true;
        const s = su.replace(/[^A-Z0-9_]+/g, '_').replace(/^_+/, '').replace(/_+$/, '');
        if (s === 'NS' || s === 'SCHEDULED' || s === 'UPCOMING' || s === 'NOT_STARTED' || s === 'PRE_MATCH' || s === 'TIMED') return true;
        if (/NOT_STARTED|SCHEDUL|UPCOMING|TIMED|PRE_MATCH/.test(s)) return true;
        return false;
      };
      const isPregameCandidate = (e: any) => {
        if (isLiveLike(e)) return false;
        if (isFinishedLike(e)) return false;
        const t = toStartMs(e);
        if (t && t < now - 2 * 60 * 1000) return false;
        if (t && t >= now) return true;
        return isNotStartedLike(e);
      };
      const tasks: Array<{ sport: string; date: string }> = [];
      for (const s of sports) {
        const sKey = String(s || '').toLowerCase().trim();
        const isFootball = sKey === 'soccer' || sKey === 'football';
        // Football: max 3 days (cold-start: 3×12s=36s serial; warm: instant). Tennis: max 2 days.
        const maxDaysForSport = isFootball ? Math.min(days || 3, 3) : Math.min(days || 2, 2);
        for (let i = 0; i < Math.min(14, maxDaysForSport); i++) {
          const d = new Date();
          d.setDate(d.getDate() + i);
          tasks.push({ sport: s, date: ymd(d) });
        }
      }
      // Group tasks by sport (same subdomain) and run with concurrency=2 within each sport;
      // different sports run fully in parallel.
      const tasksBySport = new Map<string, typeof tasks>();
      for (const t of tasks) {
        const key = String(t.sport || 'football').toLowerCase().trim();
        if (!tasksBySport.has(key)) tasksBySport.set(key, []);
        tasksBySport.get(key)!.push(t);
      }
      const sportGroups = Array.from(tasksBySport.values());
      const allScheduleLists = await Promise.all(
        sportGroups.map((group) =>
          mapLimit(group, 2, (t) => fetchSchedule(t.sport, t.date).catch(() => [] as AnyEvent[]))
        ),
      );
      const lists = allScheduleLists.flat();
      for (const sched of lists) {
        preAll.push(...(sched || []).filter(isPregameCandidate));
      }

      if (sports.some((s) => {
        const k = String(s || '').toLowerCase().trim();
        return k === 'soccer' || k === 'football' || k === 'all';
      })) {
        const pages = [0, 1, 2, 3];
        const wcLists = await mapLimit(pages, 2, (p) => fetchWorldCupMatches(p).catch(() => []));
        for (const sched of wcLists) {
          preAll.push(...(sched || []).filter(isPregameCandidate));
        }
      }
    }

    const normalizeLeagueText = (v: any): string => {
      const s = String(v || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      return s;
    };
    const cleanLeague = normalizeLeagueText(league);
    const filterLeague = (arr: AnyEvent[]) => {
      if (!cleanLeague) return arr;
      return arr.filter((e: any) => normalizeLeagueText((e as any)?.league).includes(cleanLeague));
    };

    const isUniversallyBlockedLeague = (leagueName: string): boolean => {
      const l = normalizeLeagueText(leagueName);
      if (!l) return false;
      if (/\bu\d{2}\b/.test(l) || /\bsub-?\d{2}\b/.test(l) ||
          /youth|junior|revelacao|primavera|nextgen|reserve|akademi|juvenil/.test(l) ||
          /under-?\d{2}|under \d{2}/.test(l) ||
          l.includes('u-17') || l.includes('u-21') || l.includes('u-23')) return true;
      if (/amateur|amateure|amador|amatör/.test(l)) return true;
      if (/\bwomen\b|\bwoman\b|feminino|femenino|\bdamen\b|\bféminine\b|toppserien|\bwsl\b|\bnwsl\b/.test(l)) return true;
      if (/testspiel/.test(l)) return true;
      if (/mls next pro/.test(l)) return true;
      return false;
    };

    const isBlockedLeague = (leagueName: string, country: string | undefined, strictAllowlist: boolean): boolean => {
      const l = normalizeLeagueText(leagueName);
      const c = normalizeLeagueText(country);

      if (!l) {
        if (!strictAllowlist) return false;
        if (/(international|world|mundo|internacional)/.test(c)) return false;
        return true;
      }

      if (isUniversallyBlockedLeague(l)) return true;

      // Block known lower-division names that might leak through
      if (/série d|serie d|série e|serie e/.test(l)) return true; // Brazil 4th+ div
      if (/mls next pro/.test(l)) return true;                    // MLS reserve tier
      if (/nations league women|world cup.*women|women.*world cup/.test(l)) return true;

      // In soccer-only views we only apply the hard blocks above (keep friendlies & "other football")
      if (!strictAllowlist) return false;

      // ── ALLOWLIST ── only show leagues from the configured list ─────────────
      // Block non-soccer world cups (3x3 basketball, FIBA, etc.)
      if (/\b3x3\b|fiba|basketball.*world|world.*basketball/.test(l)) return true;

      // UEFA / FIFA international competitions — always allowed (men's only after the block above)
      if (/champions league|europa league|conference league|nations league/.test(l)) return false;
      if (/world cup|copa do mundo|copa mundial/.test(l)) return false;
      if (/international friendl|friendly international|international friendly|friendlies|friendly|amistoso|amistosos|national team|national teams|selecao|selecoes/.test(l)) return false;
      if (/club friendl|club friendly/.test(l)) return false;
      if (/olympics|olympic games|jogos ol[íi]mpicos/.test(l)) return false;
      if (/supercopa|super cup|uefa super/.test(l)) return false;
      if (/euro 20\d{2}|euro qualif|world cup qualif|qualif|qualification|qualifier|eliminator|eliminatorias/.test(l)) return false;
      if (/copa america|copa am[ée]rica|conmebol|libertadores|sudamericana|recopa/.test(l)) return false;
      if (/concacaf|gold cup/.test(l)) return false;
      if (/africa cup|afcon|\bcaf\b/.test(l)) return false;
      if (/asian cup|\bafc\b/.test(l)) return false;

      // England
      if (/england|inglaterra/.test(c)) {
        if (/premier league|championship|fa cup|efl cup|carabao|league one|league two|league cup/.test(l)) return false;
      }

      // Spain
      if (/spain|espanha|espana|españa/.test(c)) {
        if (/la liga|liga 2|segunda divisi|copa del rey/.test(l)) return false;
      }

      // Germany
      if (/germany|alemanha|deutschland/.test(c)) {
        if (/bundesliga|dfb.?pokal/.test(l)) return false;
      }

      // Italy
      if (/italy|ital/.test(c)) {
        if (/serie a|serie b|coppa italia/.test(l)) return false;
      }

      // France
      if (/france|fran[cç]/.test(c)) {
        if (/ligue 1|ligue 2|coupe de france/.test(l)) return false;
      }

      // Netherlands / Países Baixos
      if (/netherlands|holland|holanda|pa[íi]ses baixos/.test(c)) {
        if (/eredivisie|eerste divisie|knvb/.test(l)) return false;
      }

      // Portugal
      if (/portugal/.test(c) || /portugal/.test(l)) {
        if (/liga portugal|primeira liga|ta[çc]a de portugal|ta[çc]a da liga/.test(l)) return false;
      }
      // Also match by league name alone (proxy returns "Liga Portugal" without country sometimes)
      if (/liga portugal|ta[çc]a de portugal|ta[çc]a da liga/.test(l)) return false;

      // Brazil
      if (/brazil|brasil/.test(c)) {
        if (/brasileir|serie [abc]|copa do brasil|campeonato paulista|campeonato carioca|campeonato mineiro|campeonato ga[uú]cho|campeonato baiano|campeonato pernambucano/.test(l)) return false;
      }
      // By league name alone
      if (/brasileir|copa do brasil/.test(l)) return false;

      // Argentina
      if (/argentina/.test(c)) {
        if (/liga profesional|primera nacional|copa argentina|primera divisi/.test(l)) return false;
      }
      if (/liga profesional argentina/.test(l)) return false;

      // USA
      if (/united states|usa|estados unidos/.test(c)) {
        if (/\bmls\b|us open cup|\busl\b/.test(l)) return false;
      }
      if (/\bmls\b|us open cup/.test(l)) return false;

      // Turkey
      if (/turkey|turquia|turkiye|türkiye/.test(c)) {
        if (/s[üu]per lig|turkish cup|1\. lig/.test(l)) return false;
      }
      if (/s[üu]per lig/.test(l)) return false;

      // Belgium
      if (/belgium|belgi[qe]|belgica|bélgica/.test(c)) {
        if (/jupiler|pro league|belgian cup/.test(l)) return false;
      }
      if (/jupiler/.test(l)) return false;

      // Colombia
      if (/colombia/.test(c)) {
        if (/primera a|primera b|liga bet?play|copa colombia/.test(l)) return false;
      }

      // Denmark
      if (/denmark|dinamarca|danmark/.test(c)) {
        if (/superliga|danish cup|DBU/.test(l)) return false;
      }

      // Greece
      if (/greece|gr[eé]cia|grecia|ellada/.test(c)) {
        if (/super league|greek cup/.test(l)) return false;
      }

      // Japan
      if (/japan|japao|jap[oã]o/.test(c)) {
        if (/j1 league|j2 league|emperor/.test(l)) return false;
      }
      if (/j1 league|j2 league/.test(l)) return false;

      // Mexico
      if (/mexico|mex|méx/.test(c)) {
        if (/liga mx|copa mx|expansi[oó]n/.test(l)) return false;
      }
      if (/liga mx/.test(l)) return false;

      // Saudi Arabia
      if (/saudi/.test(c)) {
        if (/pro league|professional league|saudi/.test(l)) return false;
      }
      if (/saudi pro league|saudi professional/.test(l)) return false;

      // Switzerland
      if (/switzerland|su[íi][çc]a|schweiz/.test(c)) {
        if (/super league|swiss cup|challenge league/.test(l)) return false;
      }

      // Uruguay
      if (/uruguay/.test(c)) {
        if (/primera divisi/.test(l)) return false;
      }

      // Scotland — allow all recognised Scottish leagues
      if (/scotland|esc[oó]cia/.test(c)) {
        if (/premiership|cup|championship|league/.test(l)) return false;
      }

      // Everything else is blocked
      return true;
    };

    const hasBlockedTeamMarker = (teamName: string): boolean => {
      const t = normalizeLeagueText(teamName);
      if (!t) return false;
      return (
        /\bu\d{2}\b/.test(t) ||
        /\bsub-?\d{2}\b/.test(t) ||
        /under-?\d{2}|under \d{2}/.test(t) ||
        /\breserve\b|\breserves\b/.test(t) ||
        /\bwomen\b|\bwoman\b|feminino|femenino|\bdamen\b|\bfeminine\b/.test(t)
      );
    };

    const isClubFriendlyLeagueName = (leagueName: string): boolean => {
      const l = normalizeLeagueText(leagueName);
      return /club friendl|club friendly|friendly games|amistosos de clubes|amistoso de clubes|amical club/.test(l);
    };

    const isImportantSoccerLeague = (leagueName: string, country: string | undefined): boolean => {
      const l = normalizeLeagueText(leagueName);
      const c = normalizeLeagueText(country);
      const lc = `${l} ${c}`.trim();
      if (!l && !c) return false;

      if (/china|chinese|csl|super league|league one|league 1/.test(lc)) return true;
      if (/champions league|europa league|conference league|nations league/.test(l)) return true;
      if (/world cup|copa do mundo|copa mundial|euro\b|euro qualif|world cup qualif|qualif|qualification|qualifier|eliminatorias/.test(l)) return true;
      if (/copa america|copa america|conmebol|libertadores|sudamericana|recopa/.test(l)) return true;
      if (/concacaf|gold cup|africa cup|afcon|\bcaf\b|asian cup|\bafc\b|olympics|olympic games/.test(l)) return true;
      if (/international friendl|friendly international|international friendly|friendlies|friendly|amistoso|amistosos|national team|national teams|selecao|selecoes/.test(l)) return true;
      if (/supercopa|super cup|uefa super|copa del rey|coppa italia|dfb pokal|coupe de france|fa cup|efl cup|carabao/.test(l)) return true;

      if (/england|inglaterra/.test(c) && /premier league|championship|league one|league two/.test(l)) return true;
      if (/spain|espanha|espana|españa/.test(c) && /la liga|segunda/.test(l)) return true;
      if (/germany|alemanha|deutschland/.test(c) && /bundesliga/.test(l)) return true;
      if (/italy|ital/.test(c) && /serie a|serie b/.test(l)) return true;
      if (/france|fran[cç]/.test(c) && /ligue 1|ligue 2/.test(l)) return true;
      if (/netherlands|holland|holanda|pa[íi]ses baixos/.test(c) && /eredivisie|eerste divisie/.test(l)) return true;
      if (/portugal/.test(lc) && /liga portugal|primeira liga|segunda liga/.test(l)) return true;
      if (/brazil|brasil/.test(c) && /brasileir|serie [abc]|copa do brasil/.test(l)) return true;
      if (/argentina/.test(c) && /liga profesional|primera nacional|primera division/.test(l)) return true;
      if (/united states|usa|estados unidos/.test(c) && /\bmls\b|us open cup/.test(l)) return true;
      if (/turkey|turquia|turkiye|türkiye/.test(c) && /super lig|1 lig/.test(l)) return true;
      if (/belgium|belgi[qe]|belgica|bélgica/.test(c) && /jupiler|pro league/.test(l)) return true;
      if (/japan|japao|jap[oã]o/.test(c) && /j1 league|j2 league/.test(l)) return true;

      return false;
    };

    const liveLeaguePriorityBoost = (e: any): number => {
      const sportKey = String((e as any)?.sport || '').toLowerCase().trim();
      const league = normalizeLeagueText(String((e as any)?.league || ''));
      const country = normalizeLeagueText(String((e as any)?.country || ''));
      const text = `${league} ${country}`.trim();
      if (!text) return 0;

      if (isSoccerSport(sportKey)) {
        if (isImportantSoccerLeague(league, country)) return 24;
        if (isClubFriendlyLeagueName(league)) return 8;
        return 0;
      }

      if (sportKey === 'tennis') {
        if (/grand slam|wimbledon|roland garros|australian open|us open/.test(text)) return 28;
        if (/atp finals|wta finals|masters|atp 1000|wta 1000/.test(text)) return 24;
        if (/atp 500|wta 500|atp 250|wta 250|challenger/.test(text)) return 18;
        if (/itf|futures/.test(text)) return -8;
      }
      if (sportKey === 'basketball') {
        if (/\bnba\b|euroleague|wnba/.test(text)) return 28;
        if (/acb|liga endesa|bbva|nbl|cba|bsl|vtb|champions league/.test(text)) return 22;
        if (/ncaa|college|universit/.test(text)) return 10;
      }
      if (sportKey === 'baseball') {
        if (/\bmlb\b|major league baseball/.test(text)) return 28;
        if (/\bnpb\b|nippon|kbo|cpbl|lmb/.test(text)) return 22;
        if (/college|ncaa|minor league/.test(text)) return 8;
      }
      if (sportKey === 'volleyball') {
        if (/nations league|olympic|world championship|cev champions league|fivb/.test(text)) return 26;
        if (/superlega|superliga|serie a1|plusliga|sultanlar ligi/.test(text)) return 20;
      }
      if (sportKey === 'hockey' || sportKey === 'ice-hockey') {
        if (/\bnhl\b|stanley cup/.test(text)) return 28;
        if (/\bkhl\b|shl|liiga|del|national league/.test(text)) return 22;
        if (/world championship|olympic/.test(text)) return 24;
      }
      if (sportKey === 'mma') {
        if (/\bufc\b/.test(text)) return 30;
        if (/pfl|bellator|one championship|cage warriors|ksw/.test(text)) return 22;
      }
      return 0;
    };

    const liveQualityScore = (e: any): number => {
      let score = 0;
      const homeOdd = Number((e as any)?.home_odd || 0);
      const drawOdd = Number((e as any)?.draw_odd || 0);
      const awayOdd = Number((e as any)?.away_odd || 0);
      if (homeOdd > 1) score += 3;
      if (drawOdd > 1) score += 1;
      if (awayOdd > 1) score += 3;
      const elapsed = Number((e as any)?.elapsed ?? (e as any)?.fixture?.status?.elapsed ?? 0);
      if (Number.isFinite(elapsed) && elapsed > 0) score += 1;
      score += liveLeaguePriorityBoost(e);
      return score;
    };

    const hasRenderablePrimaryOdds = (e: any): boolean => {
      const h = Number((e as any)?.home_odd || 0);
      const d = Number((e as any)?.draw_odd || 0);
      const a = Number((e as any)?.away_odd || 0);
      if (h > 1.01 && a > 1.01) return true;
      if (h > 1.01 && d > 1.01) return true;
      if (d > 1.01 && a > 1.01) return true;

      let mk: any = (e as any)?.markets ?? (e as any)?.odds;
      if (typeof mk === 'string') {
        const s = mk.trim();
        if (s && ((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']')))) {
          try { mk = JSON.parse(s); } catch { void 0; }
        }
      }
      if (!mk || typeof mk !== 'object') return false;

      const h2h = (mk as any).h2h || (mk as any).main || (mk as any)['1x2'] || (mk as any).match_winner;
      const sels = Array.isArray(h2h)
        ? h2h
        : Array.isArray(h2h?.selections)
          ? h2h.selections
          : Array.isArray(h2h?.outcomes)
            ? h2h.outcomes
            : Array.isArray(h2h?.values)
              ? h2h.values
              : [];
      return Array.isArray(sels)
        ? sels.filter((s: any) => Number(s?.odd ?? s?.price ?? s?.value ?? 0) > 1.01).length >= 2
        : false;
    };

    const hasAnyMarketOdds = (e: any): boolean => {
      let mk: any = (e as any)?.markets ?? (e as any)?.odds;
      if (typeof mk === 'string') {
        const s = mk.trim();
        if (s && ((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']')))) {
          try { mk = JSON.parse(s); } catch { void 0; }
        }
      }
      if (!mk || typeof mk !== 'object') return false;

      const seen = new Set<any>();
      const visit = (value: any, depth = 0): boolean => {
        if (value == null || depth > 5) return false;
        if (typeof value === 'number') return value > 1.01;
        if (typeof value !== 'object') return false;
        if (seen.has(value)) return false;
        seen.add(value);

        if (Array.isArray(value)) {
          return value.some((entry) => visit(entry, depth + 1));
        }

        const price = Number((value as any)?.odd ?? (value as any)?.price ?? (value as any)?.value ?? 0);
        if (price > 1.01) return true;

        return Object.values(value).some((entry) => visit(entry, depth + 1));
      };

      return visit(mk);
    };

    const curateLiveEvents = (arr: AnyEvent[]): AnyEvent[] => {
      if (allowBlocked || cleanLeague) return arr;

      const softFallback: AnyEvent[] = [];
      const nonSoccer: AnyEvent[] = [];
      const importantSoccerWithOdds: AnyEvent[] = [];
      const clubFriendliesWithOdds: AnyEvent[] = [];
      const fallbackSoccerWithOdds: AnyEvent[] = [];

      for (const e of Array.isArray(arr) ? arr : []) {
        const sport = String((e as any)?.sport || '').toLowerCase().trim();
        const leagueName = String((e as any)?.league || '');
        const country = String((e as any)?.country || '');
        const homeTeam = String((e as any)?.home_team || '');
        const awayTeam = String((e as any)?.away_team || '');
        if (hasBlockedTeamMarker(homeTeam) || hasBlockedTeamMarker(awayTeam)) continue;
        softFallback.push(e);
        const hasOdds = hasRenderablePrimaryOdds(e) || hasAnyMarketOdds(e);
        if (isUniversallyBlockedLeague(leagueName)) continue;
        if (!hasOdds) continue;

        if (sport && sport !== 'soccer' && sport !== 'football') {
          nonSoccer.push(e);
          continue;
        }
        if (isBlockedLeague(leagueName, country, true)) continue;

        if (isClubFriendlyLeagueName(leagueName)) {
          clubFriendliesWithOdds.push(e);
          continue;
        }

        if (isImportantSoccerLeague(leagueName, country)) {
          importantSoccerWithOdds.push(e);
          continue;
        }

        fallbackSoccerWithOdds.push(e);
      }

      const byPriority = (a: any, b: any) => {
        const diff = liveQualityScore(b) - liveQualityScore(a);
        if (diff !== 0) return diff;
        return sortStable([a, b])[0] === a ? -1 : 1;
      };

      const selectedFriendlies = [...clubFriendliesWithOdds].sort(byPriority).slice(0, 3);
      const selectedSoccer =
        importantSoccerWithOdds.length > 0
          ? [...importantSoccerWithOdds, ...selectedFriendlies]
          : fallbackSoccerWithOdds.length > 0
            ? [...fallbackSoccerWithOdds].sort(byPriority).slice(0, 6).concat(selectedFriendlies)
            : [];

      const curated = [...nonSoccer].sort(byPriority).concat(selectedSoccer);
      if (curated.length > 0) return curated;
      return [...softFallback].sort(byPriority);
    };

    if (includeLive) {
      const sportSet = new Set(sports);
      const ids = new Set(liveAll.map((e: any) => String((e as any)?.id || '')));
      for (const [id, entry] of liveSeen.entries()) {
        if (!ttlOk(entry.ts, LIVE_HOLD_MS)) continue;
        if (ids.has(id)) continue;
        if (!sportSet.has(entry.data.sport)) continue;
        // Use freshest event data available (lastEventById is always up-to-date)
        const freshEntry = lastEventById.get(id);
        const freshEvent = freshEntry?.data ?? entry.data.event;
        if (!freshEntry || !ttlOk(freshEntry.ts, LIVE_HOLD_MS)) continue;
        // Drop if the freshest data shows it's finished or no longer live
        if (isFinishedLike(freshEvent)) continue;
        if (!isLiveLike(freshEvent)) continue;
        liveAll.push({ ...(freshEvent as any), id, is_live: 1 });
      }
    }

    const sortStable = (arr: AnyEvent[]) => {
      return [...arr].sort((a: any, b: any) => {
        const at = toStartMs(a);
        const bt = toStartMs(b);
        if (at && bt && at !== bt) return at - bt;
        const al = String((a as any)?.league || '');
        const bl = String((b as any)?.league || '');
        const lc = al.localeCompare(bl, 'pt-PT');
        if (lc !== 0) return lc;
        return String((a as any)?.id || '').localeCompare(String((b as any)?.id || ''), 'pt-PT');
      });
    };

    const dayKeyOf = (e: any): string => {
      const raw = (e as any)?.event_date ?? (e as any)?.fixture?.date ?? (e as any)?.start_time ?? (e as any)?.startTimestamp;
      if (typeof raw === 'string') {
        const m = raw.match(/\d{4}-\d{2}-\d{2}/);
        if (m) return m[0] || '';
      }
      const t = toStartMs(e);
      return t ? ymd(new Date(t)) : '';
    };

    const spreadAcrossDays = (arr: AnyEvent[], desiredDays: number, overallLimit: number): AnyEvent[] => {
      const list = Array.isArray(arr) ? arr : [];
      if (overallLimit <= 0) return [];
      if (list.length <= overallLimit) return list;
      if (desiredDays <= 1) return list.slice(0, overallLimit);

      const byDay = new Map<string, AnyEvent[]>();
      for (const e of list) {
        const k = dayKeyOf(e);
        if (!k) continue;
        const bucket = byDay.get(k);
        if (bucket) bucket.push(e);
        else byDay.set(k, [e]);
      }

      const expectedDays: string[] = [];
      for (let i = 0; i < Math.min(14, desiredDays); i++) {
        const d = new Date();
        d.setDate(d.getDate() + i);
        expectedDays.push(ymd(d));
      }

      const perDayLimit = Math.max(10, Math.floor(overallLimit / Math.max(1, expectedDays.length)));
      const out: AnyEvent[] = [];
      const taken = new Map<string, number>();
      const idx = new Map<string, number>();

      for (;;) {
        if (out.length >= overallLimit) break;
        let progressed = false;
        for (const d of expectedDays) {
          if (out.length >= overallLimit) break;
          const bucket = byDay.get(d);
          if (!bucket || bucket.length === 0) continue;
          const used = taken.get(d) || 0;
          if (used >= perDayLimit) continue;
          const i = idx.get(d) || 0;
          if (i >= bucket.length) continue;
          out.push(bucket[i]);
          idx.set(d, i + 1);
          taken.set(d, used + 1);
          progressed = true;
        }
        if (!progressed) break;
      }

      for (const d of expectedDays) {
        if (out.length >= overallLimit) break;
        const bucket = byDay.get(d);
        if (!bucket || bucket.length === 0) continue;
        const i0 = idx.get(d) || 0;
        for (let i = i0; i < bucket.length && out.length < overallLimit; i++) {
          out.push(bucket[i]);
        }
      }

      return out.length > 0 ? out : list.slice(0, overallLimit);
    };

    const filterBlocked = (arr: AnyEvent[]) =>
      allowBlocked
        ? arr
        : arr.filter((e: any) => {
            const sport = String((e as any)?.sport || '').toLowerCase().trim();
            if (hasBlockedTeamMarker(String((e as any)?.home_team || '')) || hasBlockedTeamMarker(String((e as any)?.away_team || ''))) return false;
            if (isUniversallyBlockedLeague(String((e as any)?.league || ''))) return false;
            const requestedOnlySoccer =
              sports.length === 1 && ['soccer', 'football'].includes(String(sports[0] || '').toLowerCase().trim());
            const strictAllowlist = (sport === 'soccer' || sport === 'football') && !requestedOnlySoccer && !cleanLeague;
            return !isBlockedLeague(String((e as any)?.league || ''), String((e as any)?.country || ''), strictAllowlist);
          });
    const live = sortStable(curateLiveEvents(liveAll.filter((e: any) => {
      if (filterLeague([e]).length === 0) return false;
      return true;
    }))).slice(0, 120);
    const preSorted = sortStable(filterBlocked(filterLeague(preAll)));
    const preLimit = days > 1 ? 300 : 120;
    const pregame = days > 1 ? spreadAcrossDays(preSorted, days, preLimit) : preSorted.slice(0, preLimit);

    if (!includeOdds) {
      return { live, pregame };
    }

    for (const e of live) queueOddsRefresh(String((e as any)?.sport || ''), String((e as any)?.id || ''));
    for (const e of pregame) queueOddsRefresh(String((e as any)?.sport || ''), String((e as any)?.id || ''));

    const oddsFromCache = (sport: string, matchId: string): any | null => {
      const key = `${sport}:${matchId}`;
      const cached = oddsCache.get(key);
      if (!cached) return null;
      if (cached.data == null) return null;
      if (!ttlOk(cached.ts, ODDS_STALE_TTL_MS)) return null;
      return cached.data;
    };

    const hasAnyMarkets = (mkObj: any): boolean => {
      if (!mkObj || typeof mkObj !== 'object') return false;
      if (Array.isArray(mkObj)) return mkObj.length > 0;
      const entries = Object.entries(mkObj as Record<string, any>).slice(0, 80);
      for (const [, v] of entries) {
        if (!v) continue;
        if (Array.isArray(v) && v.length > 0) return true;
        if (typeof v === 'object') {
          const inner = (v as any).selections || (v as any).outcomes || (v as any).values || (v as any).lines;
          if (Array.isArray(inner) && inner.length > 0) return true;
          if (Object.keys(v as any).length > 0) return true;
        }
      }
      return Object.keys(mkObj as any).length > 0;
    };

    const hasAnyOddsFromOdds = (odds: any): boolean => {
      const h = Number(odds?.home || 0);
      const d = Number(odds?.draw || 0);
      const a = Number(odds?.away || 0);
      if (h > 1 && a > 1) return true;
      if (d > 1) return true;
      const mkObj = odds?.markets && typeof odds.markets === 'object' ? odds.markets : null;
      return hasAnyMarkets(mkObj);
    };

    const hasAnyOddsEvent = (e: any) => {
      const h = Number(e?.home_odd || 0);
      const d = Number(e?.draw_odd || 0);
      const a = Number(e?.away_odd || 0);
      if (h > 1 && a > 1) return true;
      if (d > 1) return true;
      const mkRaw = (e as any)?.markets ?? (e as any)?.odds;
      const mkObj = mkRaw && typeof mkRaw === 'object' ? mkRaw : parseMarkets(mkRaw);
      return hasAnyMarkets(mkObj);
    };

    if (realtime) {
      const budget0 = { remaining: 0 };

      const liveFiltered = includeLive ? live : [];
      const preFiltered = includePregame ? pregame : [];

      const liveEnriched = includeLive
        ? await mapLimit(liveFiltered, 10, async (x) => {
            const enriched = await enrichEventOdds(x, budget0, fullMarkets);
            const suspension = getSuspensionState(matchIdOf(enriched), String((enriched as any)?.sport || ''), enriched);
            return attachSuspensionPayload(enriched, suspension);
          })
        : [];
      const preEnriched = includePregame ? await mapLimit(preFiltered, 8, (x) => enrichEventOdds(x, budget0, fullMarkets)) : [];
      return { live: liveEnriched, pregame: preEnriched };
    }

    const liveBudget = { remaining: Math.min(30, live.length) };
    const liveEnriched = await mapLimit(live, 10, async (x) => {
      const enriched = await enrichEventOdds(x, liveBudget, fullMarkets);
      const suspension = getSuspensionState(matchIdOf(enriched), String((enriched as any)?.sport || ''), enriched);
      return attachSuspensionPayload(enriched, suspension);
    });
    let preEnriched: AnyEvent[] = pregame;
    if (includePregame && pregame.length > 0) {
      // Budget limits real API calls; events beyond budget get cached or baseline odds
      // This ensures ALL events have at least baseline odds — never home_odd: 0
      const apiBudget = Math.min(requireOdds ? 100 : 40, pregame.length);
      const preBudget = { remaining: apiBudget };
      preEnriched = await mapLimit(pregame, 12, (x) => enrichEventOdds(x, preBudget, fullMarkets));
    }

    const filteredLive = requireOdds && includeLive ? liveEnriched.filter(hasAnyOddsEvent) : liveEnriched;
    const filteredPregame = requireOdds && includePregame
      ? preEnriched.filter((e: any) => {
          if (hasAnyOddsEvent(e)) return true;
          const sport = String(e?.sport || '').trim();
          if (!sport) return false;
          const id = matchIdOf(e);
          if (!id) return false;
          const odds = oddsFromCache(sport, id);
          return odds ? hasAnyOddsFromOdds(odds) : false;
        })
      : preEnriched;
    return { live: filteredLive, pregame: filteredPregame };
  };

  const handleEventsRoutes = async (req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<boolean> => {
    const path = url.pathname;

    if (req.method === 'GET' && path === '/api/health') {
      sendJson(res, 200, { ok: true });
      return true;
    }

    if (req.method === 'GET' && path === '/api/sports') {
      sendJson(res, 200, RESOLVABLE_SPORTS.slice());
      return true;
    }

    if (req.method === 'GET' && path === '/api/events/by-sport') {
      const sports = url.searchParams.get('sports');
      const include = url.searchParams.get('include');
      const includeOdds = String(include || '').toLowerCase().includes('odds');
      const league = url.searchParams.get('league');
      const realtime = String(url.searchParams.get('realtime') || '') === '1';
      const onlyRaw = String(url.searchParams.get('only') || '').toLowerCase().trim();
      const only = onlyRaw === 'live' || onlyRaw === 'pregame' ? (onlyRaw as any) : 'both';
      const requireOdds = String(url.searchParams.get('requireOdds') || '') === '1';
      const allowBlocked = String(url.searchParams.get('allowBlocked') || '') === '1';
      const daysParam = Number(url.searchParams.get('days') || 0);
      const daysAhead = Number.isFinite(daysParam) ? Math.max(0, Math.min(14, Math.floor(daysParam))) : 0;
      const fullMarkets =
        String(url.searchParams.get('markets') || '').toLowerCase() === 'full' ||
        String(url.searchParams.get('markets') || '').toLowerCase() === 'all';
      const sportsKey = String(sports || 'all').toLowerCase().trim();
      const isTennisOnlyRealtime = realtime && (sportsKey === 'tennis' || sportsKey === 'sport=tennis');
      const cacheKey = `bySport:${String(sports || 'all')}|league:${String(league || '')}|includeOdds:${includeOdds ? '1' : '0'}|realtime:${realtime ? '1' : '0'}|fullMarkets:${fullMarkets ? '1' : '0'}|only:${only}|days:${daysAhead}|requireOdds:${requireOdds ? '1' : '0'}|allowBlocked:${allowBlocked ? '1' : '0'}`;
      const cached = bySportCache.get(cacheKey);
      const ttl = realtime ? (isTennisOnlyRealtime ? REALTIME_TENNIS_CACHE_TTL_MS : REALTIME_CACHE_TTL_MS) : includeOdds ? 12_000 : 25_000;
      const staleTtl = realtime ? (isTennisOnlyRealtime ? REALTIME_TENNIS_STALE_TTL_MS : REALTIME_STALE_TTL_MS) : 5 * 60_000;
      // ── 1. Fresh cache hit ──────────────────────────────────────────────────
      if (cached && ttlOk(cached.ts, ttl)) {
        sendJson(res, 200, cached.data);
        return true;
      }
      const defaultDays = only === 'live' ? 0 : 7;
      const buildArgs = [sports, includeOdds, league, realtime, fullMarkets, only, daysAhead || defaultDays, requireOdds, allowBlocked] as const;

      // Helper: start a build only if none is in-flight for this key
      const ensureBuild = (): Promise<{ live: AnyEvent[]; pregame: AnyEvent[] }> => {
        const existing = bySportInFlight.get(cacheKey);
        if (existing) return existing;
        const p = buildBySport(...buildArgs)
          .then(d => { bySportCache.set(cacheKey, { ts: nowMs(), data: d }); return d; })
          .catch(() => ({ live: [] as AnyEvent[], pregame: [] as AnyEvent[] }))
          .finally(() => bySportInFlight.delete(cacheKey));
        bySportInFlight.set(cacheKey, p);
        return p;
      };

      // ── 2. Stale-while-revalidate ───────────────────────────────────────────
      if (cached && ttlOk(cached.ts, staleTtl)) {
        sendJson(res, 200, cached.data);
        ensureBuild(); // background refresh — no await
        return true;
      }

      // ── 3. Cold start: wait for the build (deduped) with a hard timeout ─────
      const inFlight = ensureBuild();
      const timeoutMs = realtime ? REALTIME_COLD_TIMEOUT_MS : includeOdds ? ODDS_COLD_TIMEOUT_MS : PREGAME_COLD_TIMEOUT_MS;
      const timeoutPromise = new Promise<{ live: AnyEvent[]; pregame: AnyEvent[] }>(resolve =>
        setTimeout(() => resolve(cached?.data ?? { live: [], pregame: [] }), timeoutMs)
      );
      const data = await Promise.race([inFlight, timeoutPromise]);
      sendJson(res, 200, data);
      return true;
    }

    if (req.method === 'GET' && path === '/api/world-cup-2026') {
      const data = await fetchWorldCupMeta('tournament').catch(() => null);
      sendJson(res, 200, data || {});
      return true;
    }

    if (req.method === 'GET' && path === '/api/world-cup-2026/info') {
      const data = await fetchWorldCupMeta('info').catch(() => null);
      sendJson(res, 200, data || {});
      return true;
    }

    if (req.method === 'GET' && path === '/api/world-cup-2026/groups') {
      const data = await fetchWorldCupMeta('groups').catch(() => null);
      sendJson(res, 200, data || {});
      return true;
    }

    if (req.method === 'GET' && path === '/api/world-cup-2026/matches') {
      const pageRaw = Number(url.searchParams.get('page') || 0);
      const page = Number.isFinite(pageRaw) ? Math.max(0, Math.min(20, Math.floor(pageRaw))) : 0;
      const data = await fetchWorldCupMatches(page).catch(() => []);
      sendJson(res, 200, { page, matches: data });
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

    if (req.method === 'GET' && path === '/api/dev/cache-debug') {
      const tokenEnv = String(process.env.ODDS_DEBUG_TOKEN || '').trim();
      if (!tokenEnv) return false;
      const token = String(url.searchParams.get('token') || req.headers['x-debug-token'] || '').trim();
      if (!token || token !== tokenEnv) return sendJson(res, 403, { error: 'Forbidden' }), true;

      const at = (ts: number) => (ts ? nowMs() - ts : 0);
      const sample = <T>(m: Map<string, CacheEntry<T>>, n: number) => {
        const out: Array<{ key: string; ageMs: number }> = [];
        for (const [k, v] of m.entries()) {
          out.push({ key: k, ageMs: at(v.ts) });
        }
        out.sort((a, b) => a.ageMs - b.ageMs);
        return out.slice(0, n);
      };

      sendJson(res, 200, {
        liveCache: { size: liveCache.size, sample: sample(liveCache as any, 6) },
        scheduleCache: { size: scheduleCache.size, sample: sample(scheduleCache as any, 6) },
        bySportCache: { size: bySportCache.size, sample: sample(bySportCache as any, 6) },
        oddsCache: { size: oddsCache.size, sample: sample(oddsCache as any, 12) },
        oddsInflight: { size: oddsInflight.size },
        oddsQueue: { length: oddsQueue.length },
        oddsQueued: { size: oddsQueued.size },
        idToSport: { size: idToSport.size },
        liveSeen: { size: liveSeen.size },
      });
      return true;
    }

    if (req.method === 'GET' && path === '/api/dev/schedule-debug') {
      const tokenEnv = String(process.env.ODDS_DEBUG_TOKEN || '').trim();
      if (!tokenEnv) return false;
      const token = String(url.searchParams.get('token') || req.headers['x-debug-token'] || '').trim();
      if (!token || token !== tokenEnv) return sendJson(res, 403, { error: 'Forbidden' }), true;

      const sport = String(url.searchParams.get('sport') || '').trim() || 'soccer';
      const date = String(url.searchParams.get('date') || '').trim() || ymd(new Date());
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
      const targetUrl = `https://v2.${sub}.sportsapipro.com/api/schedule/${encodeURIComponent(date)}?timezoneName=UTC`;
      try {
        const r = await fetch(targetUrl, { headers: { 'x-api-key': apiKey, accept: 'application/json' } });
        const text = await r.text().catch(() => '');
        let json: any = null;
        try {
          json = text ? JSON.parse(text) : null;
        } catch {
          json = null;
        }
        const extractedCount = (() => {
          try {
            const items = (json as any) ? (Array.isArray((json as any).events) ? (json as any).events : Array.isArray((json as any).data?.events) ? (json as any).data.events : null) : null;
            if (Array.isArray(items)) return items.length;
            return 0;
          } catch {
            return 0;
          }
        })();
        const normalizedCount = (() => {
          try {
            // use the same extractor as the service layer, but without importing it
            const payload = json;
            if (!payload) return 0;
            if (Array.isArray((payload as any).events)) return (payload as any).events.length;
            if (Array.isArray((payload as any).data?.events)) return (payload as any).data.events.length;
            const tournaments = (payload as any).data?.tournaments ?? (payload as any).tournaments;
            if (Array.isArray(tournaments)) {
              let n = 0;
              for (const t of tournaments) {
                const arr = t?.events ?? t?.matches ?? t?.games ?? [];
                if (Array.isArray(arr)) n += arr.length;
              }
              return n;
            }
            return 0;
          } catch {
            return 0;
          }
        })();
        const topKeys = json && typeof json === 'object' ? Object.keys(json).slice(0, 30) : [];
        sendJson(res, 200, {
          url: targetUrl,
          status: r.status,
          ok: r.ok,
          sport,
          date,
          topKeys,
          extractedCount,
          normalizedCount,
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
      const respondEvent = (found: any, sportKey: string) => {
        const suspension = getSuspensionState(id, sportKey, found);
        sendJson(res, 200, attachSuspensionPayload(found, suspension));
      };
      const cached = lastEventById.get(id);
      if (cached && ttlOk(cached.ts, 30 * 60_000)) {
        respondEvent(cached.data, String((cached.data as any)?.sport || ''));
        return true;
      }
      const sport = await resolveSport(id);
      if (!sport) return sendJson(res, 404, { error: 'Evento não encontrado' }), true;
      const live = await fetchLive(sport).catch(() => []);
      const foundLive = live.find((e: any) => String(e.id) === String(id));
      if (foundLive) {
        respondEvent(foundLive, sport);
        return true;
      }
      const date = ymd(new Date());
      const sched = await fetchSchedule(sport, date).catch(() => []);
      const found = sched.find((e: any) => String(e.id) === String(id));
      if (found) {
        respondEvent(found, sport);
        return true;
      }
      return sendJson(res, 404, { error: 'Evento não encontrado' }), true;
    }

    const scoreMatch = path.match(/^\/api\/events\/([^/]+)\/score$/);
    if (scoreMatch && req.method === 'GET') {
      const idRaw = decodeURIComponent(scoreMatch[1] || '');
      const id = normalizeIdLoose(idRaw);
      const sportParam = String(url.searchParams.get('sport') || '').trim();
      const sport = sportParam || await resolveSport(id);
      if (!sport) return sendJson(res, 404, { error: 'Evento não encontrado' }), true;

      const sKey = String(sport || '').toLowerCase().trim();
      const existingCursor = String(url.searchParams.get('lastUpdateId') || '').trim();
      const cachedCursor = v1AllScoresCursorBySport.get(sKey);
      const cursor = existingCursor || (cachedCursor && ttlOk(cachedCursor.ts, 20 * 60_000) ? cachedCursor.data : '');

      const delta = await fetchSportsApiProV1AllScoresDelta(apiKey, sport, cursor || null).catch(() => null);
      const nextCursor = delta?.lastUpdateId ? String(delta.lastUpdateId) : '';
      if (nextCursor) v1AllScoresCursorBySport.set(sKey, { ts: nowMs(), data: nextCursor });

      let found: any | null = null;
      if (delta && Array.isArray(delta.events) && delta.events.length > 0) {
        for (const e of delta.events) {
          const eid =
            String((e as any).id || '').trim() ||
            String((e as any).external_event_id || '').split('_').pop() ||
            '';
          if (!eid) continue;
          const out: any = { ...e, id: eid, sport };
          const prev = lastEventById.get(eid)?.data;
          const now = nowMs();
          const liveNow = Number(out?.is_live || 0) === 1;
          applyScoreDrivenFreeze(sKey, eid, prev, out, now);
          rememberSport(eid, sport);
          lastEventById.set(eid, { ts: nowMs(), data: out });
          if (String(eid) === String(id)) found = out;
        }
      }

      const needsLiveFallback =
        !found ||
        (sKey === 'tennis' &&
          !String((found as any)?.score || '').includes('"point"'));

      if (needsLiveFallback) {
        const liveList = await fetchLive(sport).catch(() => []);
        const liveFound = liveList.find((e: any) => String((e as any)?.id || '') === String(id));
        if (liveFound) {
          found = found
            ? {
                ...found,
                ...liveFound,
                id,
                sport,
                score: liveFound.score ?? found.score,
                goals: liveFound.goals ?? found.goals,
                status: liveFound.status ?? found.status,
                status_short: liveFound.status_short ?? found.status_short,
                status_long: liveFound.status_long ?? found.status_long,
                elapsed: typeof liveFound.elapsed === 'number' ? liveFound.elapsed : found.elapsed,
                timer: liveFound.timer ?? found.timer,
              }
            : liveFound;
        }
      }

      if (!found) {
        const cached = lastEventById.get(id);
        if (cached && ttlOk(cached.ts, 2 * 60_000)) found = cached.data;
      }

      if (!found) return sendJson(res, 404, { error: 'Evento não encontrado' }), true;
      const suspension = getSuspensionState(id, sKey, found);
      sendJson(res, 200, {
        ...attachSuspensionPayload(found, suspension),
        lastUpdateId: nextCursor || cursor || undefined,
      });
      return true;
    }

    const oddsMatch = path.match(/^\/api\/events\/([^/]+)\/odds$/);
    if (oddsMatch && req.method === 'GET') {
      const idRaw = decodeURIComponent(oddsMatch[1] || '');
      const id = normalizeIdLoose(idRaw);
      const sportParam = String(url.searchParams.get('sport') || '').trim();
      const sport = sportParam || await resolveSport(id);
      if (!sport) return sendJson(res, 404, { error: 'Evento não encontrado' }), true;
      const odds = await fetchOddsStrict(sport, id, { forceAll: true }).catch(() => null);
      const markets = odds?.markets || {};

      const cachedEv = lastEventById.get(id)?.data;
      const suspension = getSuspensionState(id, sport, cachedEv, odds);

      sendJson(res, 200, {
        home: odds?.home || 0,
        draw: odds?.draw || 0,
        away: odds?.away || 0,
        markets,
        ...buildSuspensionPayload(suspension),
      });
      return true;
    }

    const statsMatch = path.match(/^\/api\/events\/([^/]+)\/stats$/);
    if (statsMatch && req.method === 'GET') {
      const idRaw = decodeURIComponent(statsMatch[1] || '');
      const id = normalizeIdLoose(idRaw);
      const sportParam = String(url.searchParams.get('sport') || '').trim();
      const sport = sportParam || await resolveSport(id);
      if (!sport) return sendJson(res, 404, { error: 'Evento não encontrado' }), true;
      recordProviderCache('statistics', 'miss');
      const statsRaw = await callProvider('statistics', () => fetchSportsApiProMatchStatistics(apiKey, sport, id)).catch(() => null);

      // Normalise a SportsApiPro v2 home/away object into API-Football statistics array
      const normalizeStatsObject = (obj: any, teamLabel: string): any[] => {
        if (!obj || typeof obj !== 'object') return [];
        const map: Record<string, string> = {
          possession: 'Ball Possession',
          ball_possession: 'Ball Possession',
          shots_on_target: 'Shots on Goal',
          on_target: 'Shots on Goal',
          total_shots: 'Total Shots',
          shots_total: 'Total Shots',
          shots_off_target: 'Shots off Goal',
          corners: 'Corner Kicks',
          corner_kicks: 'Corner Kicks',
          yellow_cards: 'Yellow Cards',
          red_cards: 'Red Cards',
          fouls: 'Fouls',
          offsides: 'Offsides',
          saves: 'Goalkeeper Saves',
          attacks: 'Total Attacks',
          dangerous_attacks: 'Dangerous Attacks',
          passes: 'Total passes',
          pass_accuracy: 'Passes accurate',
          free_kicks: 'Free Kicks',
          goal_kicks: 'Goal Kicks',
          throw_ins: 'Throw-in',
        };
        return Object.entries(obj)
          .filter(([k]) => map[k.toLowerCase()])
          .map(([k, v]) => ({ type: map[k.toLowerCase()], value: v, team: { name: teamLabel } }));
      };

      // Extract stats from various SportsApiPro response formats
      const extractStats = (raw: any): any[] => {
        if (!raw) return [];
        // Direct array
        if (Array.isArray(raw)) return raw;
        // API-Football style: { data: { response: [{ statistics: [...] }] } }
        if (Array.isArray(raw.data?.response?.[0]?.statistics)) return raw.data.response[0].statistics;
        if (Array.isArray(raw.data?.response)) return raw.data.response;
        if (Array.isArray(raw.data?.statistics)) return raw.data.statistics;
        if (Array.isArray(raw.statistics)) return raw.statistics;
        if (Array.isArray(raw.data?.stats)) return raw.data.stats;
        if (Array.isArray(raw.stats)) return raw.stats;
        // SportsApiPro v2: { data: { home: {...}, away: {...} } }
        const d = raw.data ?? raw;
        if (d && typeof d === 'object' && !Array.isArray(d)) {
          const homeStats = d.home ?? d.home_team ?? d.homeTeam;
          const awayStats = d.away ?? d.away_team ?? d.awayTeam;
          if (homeStats || awayStats) {
            return [
              ...normalizeStatsObject(homeStats, 'home'),
              ...normalizeStatsObject(awayStats, 'away'),
            ];
          }
          // Flat object with direct stat keys
          const flatKeys = ['possession', 'ball_possession', 'shots', 'corners', 'yellow_cards'];
          if (flatKeys.some(k => k in d)) {
            return normalizeStatsObject(d, 'home');
          }
        }
        return [];
      };
      const extractMatchEvents = (raw: any): any[] => {
        if (!raw) return [];
        if (Array.isArray(raw.data?.events)) return raw.data.events;
        if (Array.isArray(raw.events)) return raw.events;
        if (Array.isArray(raw.data?.matchEvents)) return raw.data.matchEvents;
        if (Array.isArray(raw.matchEvents)) return raw.matchEvents;
        if (Array.isArray(raw.data?.incidents)) return raw.data.incidents;
        if (Array.isArray(raw.incidents)) return raw.incidents;
        if (Array.isArray(raw.data?.response)) return raw.data.response;
        return [];
      };
      const rawStats = extractStats(statsRaw);
      const events = extractMatchEvents(statsRaw);

      // Detect SportsApiPro grouped format: [{ period:"ALL", groups:[...] }]
      // Convert to flat API-Football format for legacy components; keep grouped for rich display.
      let stats: any[] = rawStats;
      let groupedStats: any[] | null = null;

      if (Array.isArray(rawStats) && rawStats.length > 0 && rawStats[0]?.groups != null) {
        groupedStats = rawStats;
        const allPeriod = rawStats.find((p: any) => String(p.period).toUpperCase() === 'ALL') ?? rawStats[0];
        const flat: any[] = [];
        for (const group of (allPeriod?.groups ?? [])) {
          for (const item of (group?.statisticsItems ?? [])) {
            flat.push({ type: item.name, value: item.home, team: { id: 'home', name: 'home' } });
            flat.push({ type: item.name, value: item.away, team: { id: 'away', name: 'away' } });
          }
        }
        stats = flat;
      }

      sendJson(res, 200, { stats, groupedStats, events, _debug: statsRaw ? Object.keys(statsRaw) : [], _rawKeys: statsRaw?.data ? Object.keys(statsRaw.data) : [] });
      return true;
    }

    // ── /api/events/:id/h2h ───────────────────────────────────────────────
    const h2hMatch = path.match(/^\/api\/events\/([^/]+)\/h2h$/);
    if (h2hMatch && req.method === 'GET') {
      const idRaw = decodeURIComponent(h2hMatch[1] || '');
      const id = normalizeIdLoose(idRaw);
      const sportParam = String(url.searchParams.get('sport') || '').trim();
      const sport = sportParam || await resolveSport(id) || 'soccer';
      const provider = getSportsDataProviderConfig().provider;
      const cachedEvent = lastEventById.get(id)?.data;
      const statPalTeam1Id = String(
        cachedEvent?.home_team_id ??
        cachedEvent?.fixture?.home?.id ??
        cachedEvent?.fixture?.home_team_id ??
        '',
      ).trim();
      const statPalTeam2Id = String(
        cachedEvent?.away_team_id ??
        cachedEvent?.fixture?.away?.id ??
        cachedEvent?.fixture?.away_team_id ??
        '',
      ).trim();
      const raw = provider === 'statpal' && sport === 'soccer' && statPalTeam1Id && statPalTeam2Id
        ? await fetchSportsSoccerH2HByTeams(apiKey, statPalTeam1Id, statPalTeam2Id).catch(() => null)
        : await fetchSportsApiProH2H(apiKey, sport, id).catch(() => null);
      if (!raw) return sendJson(res, 200, { matches: [] }), true;

      const extractH2H = (r: any): any[] => {
        if (Array.isArray(r)) return r;
        if (Array.isArray(r?.['head-to-head']?.recent_meetings?.match)) return r['head-to-head'].recent_meetings.match;
        if (Array.isArray(r.data?.matches)) return r.data.matches;
        if (Array.isArray(r.matches)) return r.matches;
        if (Array.isArray(r.data?.h2h)) return r.data.h2h;
        if (Array.isArray(r.h2h)) return r.h2h;
        if (Array.isArray(r.data?.events)) return r.data.events;
        if (Array.isArray(r.data?.response)) return r.data.response;
        if (Array.isArray(r.data)) return r.data;
        return [];
      };

      const rawMatches = extractH2H(raw);
      const matches = rawMatches.slice(0, 15).map((m: any) => {
        const homeScore = Number(m.homeScore ?? m.score?.home ?? m.goals?.home ?? 0);
        const awayScore = Number(m.awayScore ?? m.score?.away ?? m.goals?.away ?? 0);
        const homeTeam = String(m.homeTeam?.name ?? m.home_team ?? m.home?.name ?? '');
        const awayTeam = String(m.awayTeam?.name ?? m.away_team ?? m.away?.name ?? '');
        const date = String(m.startTimestamp ? new Date(m.startTimestamp * 1000).toISOString() : m.date ?? m.event_date ?? '');
        return { homeTeam, awayTeam, homeScore, awayScore, date, status: String(m.status?.type ?? m.status ?? 'FT') };
      }).filter((m: any) => m.homeTeam && m.awayTeam);

      sendJson(res, 200, { matches });
      return true;
    }

    // ── /api/leagues/:leagueId/standings ─────────────────────────────────
    const standingsMatch = path.match(/^\/api\/leagues\/([^/]+)\/standings$/);
    if (standingsMatch && req.method === 'GET') {
      const leagueIdRaw = decodeURIComponent(standingsMatch[1] || '');
      const sportParam = String(url.searchParams.get('sport') || 'soccer').trim();
      const sport = sportParam || 'soccer';
      const raw = await fetchSportsApiProStandings(apiKey, sport, leagueIdRaw).catch(() => null);
      if (!raw) return sendJson(res, 200, { standings: [] }), true;

      const extractRows = (r: any): any[] => {
        if (Array.isArray(r?.standings?.tournament?.team)) return r.standings.tournament.team;
        if (Array.isArray(r?.data?.standings)) return r.data.standings;
        if (Array.isArray(r?.standings)) return r.standings;
        if (Array.isArray(r?.data?.rows)) return r.data.rows;
        if (Array.isArray(r?.rows)) return r.rows;
        // SportsApiPro nested: { data: { groups: [{ rows: [...] }] } }
        const groups = r?.data?.groups ?? r?.groups ?? r?.data?.standings?.[0]?.rows;
        if (Array.isArray(groups)) {
          const out: any[] = [];
          for (const g of groups) {
            const rows = g?.rows ?? g?.standings ?? (Array.isArray(g) ? g : []);
            if (Array.isArray(rows)) out.push(...rows);
          }
          if (out.length) return out;
        }
        if (Array.isArray(r?.data)) return r.data;
        return [];
      };

      const rawRows = extractRows(raw);
      const standings = rawRows.map((row: any, i: number) => ({
        position: Number(row.position ?? row.rank ?? row.pos ?? i + 1),
        team: String(row.name ?? row.team?.name ?? row.teamName ?? row.team ?? ''),
        played: Number(row.matches ?? row.played ?? row.mp ?? row.overall?.games_played ?? 0),
        wins: Number(row.wins ?? row.w ?? row.overall?.wins ?? 0),
        draws: Number(row.draws ?? row.d ?? row.overall?.draws ?? 0),
        losses: Number(row.losses ?? row.l ?? row.overall?.losses ?? 0),
        goalsFor: Number(row.scoresFor ?? row.goalsFor ?? row.gf ?? row.scored ?? row.overall?.goals_scored ?? 0),
        goalsAgainst: Number(row.scoresAgainst ?? row.goalsAgainst ?? row.ga ?? row.conceded ?? row.overall?.goals_allowed ?? 0),
        points: Number(row.points ?? row.pts ?? row.total?.points ?? 0),
      })).filter((r: any) => r.team);

      sendJson(res, 200, { standings });
      return true;
    }

    // ── /api/events/:id/incidents ─────────────────────────────────────────
    const incidentsMatch = path.match(/^\/api\/events\/([^/]+)\/incidents$/);
    if (incidentsMatch && req.method === 'GET') {
      const idRaw = decodeURIComponent(incidentsMatch[1] || '');
      const id = normalizeIdLoose(idRaw);
      const sportParam = String(url.searchParams.get('sport') || '').trim();
      const sport = sportParam || await resolveSport(id);
      if (!sport) return sendJson(res, 404, { error: 'Evento não encontrado' }), true;

      // Map SportsApiPro typeId → canonical incident type
      const TYPE_MAP: Record<number, string> = {
        1:  'goal',
        2:  'yellow_card',
        3:  'red_card',
        4:  'yellow_red',
        5:  'substitution',
        6:  'penalty',
        7:  'own_goal',
        8:  'missed_penalty',
        9:  'disallowed_goal',
        10: 'var',
        11: 'penalty_awarded',
        12: 'injury',
        13: 'offside',
      };

      const extractIncidents = (raw: any): any[] => {
        if (!raw) return [];
        if (Array.isArray(raw)) return raw;
        if (Array.isArray(raw.data?.incidents)) return raw.data.incidents;
        if (Array.isArray(raw.incidents)) return raw.incidents;
        if (Array.isArray(raw.data?.events)) return raw.data.events;
        if (Array.isArray(raw.events)) return raw.events;
        if (Array.isArray(raw.data)) return raw.data;
        return [];
      };

      // Extract Big Chances Created (stat ID 24) from statistics
      const extractBigChances = (raw: any): { home: number; away: number } => {
        const empty = { home: 0, away: 0 };
        if (!raw) return empty;
        const d = raw.data ?? raw;
        // Array format: [{id:24, name:'Big Chances Created', home:X, away:Y}]
        if (Array.isArray(d)) {
          const stat = d.find((s: any) => s.id === 24 || s.name === 'Big Chances Created');
          if (stat) return { home: Number(stat.home ?? stat.homeValue ?? 0), away: Number(stat.away ?? stat.awayValue ?? 0) };
        }
        // Object format: { home: { big_chances: X }, away: { big_chances: X } }
        if (d && typeof d === 'object') {
          const h = d.home?.big_chances ?? d.home?.bigChances ?? d.big_chances_created?.home ?? null;
          const a = d.away?.big_chances ?? d.away?.bigChances ?? d.big_chances_created?.away ?? null;
          if (h !== null || a !== null) return { home: Number(h ?? 0), away: Number(a ?? 0) };
        }
        return empty;
      };

      const buildPayloadFromRaw = (incidentsRaw: any, statsRaw: any) => {
        const rawIncidents = extractIncidents(incidentsRaw);
        const cachedEvent = lastEventById.get(id)?.data;
        const homeName = String(cachedEvent?.home_team || '').trim().toLowerCase();
        const awayName = String(cachedEvent?.away_team || '').trim().toLowerCase();
        const incidents = rawIncidents.map((inc: any, i: number) => {
          const typeId = Number(inc.typeId ?? inc.type_id ?? inc.incident_type ?? 0);
          const canonicalType = TYPE_MAP[typeId] || inc.type || 'other';
          const minute = Number(inc.time ?? inc.minute ?? inc.elapsed ?? 0);
          const addedTime = Number(inc.addedTime ?? inc.added_time ?? inc.injuryTime ?? 0);
          const teamSide = String(inc.teamSide ?? inc.team_side ?? inc.team ?? '').toLowerCase();
          const teamId = String(inc.team?.id ?? inc.teamId ?? '').trim();
          const teamName = String(inc.team?.name ?? inc.teamName ?? '').trim().toLowerCase();
          const isHome = teamSide === 'home' || teamSide === '1' || (!!teamName && teamName === homeName) || teamId === String(cachedEvent?.home_team_id ?? '');
          const isAway = teamSide === 'away' || teamSide === '2' || (!!teamName && teamName === awayName) || teamId === String(cachedEvent?.away_team_id ?? '');
          const player = inc.player?.name ?? inc.playerName ?? inc.player ?? null;
          const assist = inc.player2?.name ?? inc.assistName ?? inc.assist ?? null;
          return {
            id: String(inc.id ?? `${id}-${i}`),
            typeId,
            type: canonicalType,
            minute,
            addedTime,
            team: isHome ? 'home' : isAway ? 'away' : null,
            player,
            assist,
            description: inc.description ?? inc.text ?? null,
            isConfirmed: inc.isConfirmed ?? inc.confirmed ?? inc.is_confirmed ?? true,
          };
        });
        const bigChances = extractBigChances(statsRaw);
        return {
          incidents,
          bigChances,
          _meta: { total: incidents.length, matchId: id, sport },
        };
      };

      const sportKey = String(sport || '').toLowerCase().trim();
      const cacheKey = `${sportKey}:${id}`;
      const cached = incidentsCache.get(cacheKey);
      const ttl = 4_000;
      const staleTtl = 30_000;

      const ensureBuild = (): Promise<any> => {
        const existing = incidentsInFlight.get(cacheKey);
        if (existing) return existing;
        const needStats = sportKey === 'soccer' || sportKey === 'football';
        const p = Promise.all([
          callProvider('incidents', () => fetchSportsApiProMatchIncidents(apiKey, sport, id)).catch(() => null),
          needStats
            ? callProvider('statistics', () => fetchSportsApiProMatchStatistics(apiKey, sport, id)).catch(() => null)
            : Promise.resolve(null),
        ])
          .then(([incidentsRaw, statsRaw]) => buildPayloadFromRaw(incidentsRaw, statsRaw))
          .catch(() => buildPayloadFromRaw(null, null))
          .then((payload) => {
            processCriticalIncidentFreeze(id, sportKey, payload?.incidents || []);
            incidentsCache.set(cacheKey, { ts: nowMs(), data: payload });
            return payload;
          })
          .finally(() => incidentsInFlight.delete(cacheKey));
        incidentsInFlight.set(cacheKey, p);
        return p;
      };

      if (cached && ttlOk(cached.ts, ttl)) {
        sendJson(res, 200, cached.data);
        return true;
      }
      if (cached && ttlOk(cached.ts, staleTtl)) {
        sendJson(res, 200, cached.data);
        ensureBuild().catch(() => void 0);
        return true;
      }

      const payload = await Promise.race([
        ensureBuild(),
        new Promise<any>((resolve) => setTimeout(() => resolve(cached?.data ?? buildPayloadFromRaw(null, null)), 8_000)),
      ]);
      incidentsCache.set(cacheKey, { ts: nowMs(), data: payload });
      sendJson(res, 200, payload);
      return true;
    }

    if (req.method === 'GET' && path === '/api/soccer/injuries-suspensions') {
      const raw = await callProvider('soccer_injuries', () => fetchSportsSoccerInjuriesSuspensions(apiKey)).catch(() => null);
      const leagues = Array.isArray(raw?.injuries_suspensions?.league) ? raw.injuries_suspensions.league : [];
      sendJson(res, 200, { injuries_suspensions: raw?.injuries_suspensions ?? null, leagues });
      return true;
    }

    if (req.method === 'GET' && path === '/api/soccer/live-storylines') {
      const raw = await callProvider('soccer_storylines', () => fetchSportsSoccerLiveStorylines(apiKey)).catch(() => null);
      sendJson(res, 200, { storylines: raw?.live_storylines ?? null, meta: raw?.meta ?? null, raw });
      return true;
    }

    if (req.method === 'GET' && path === '/api/soccer/team-lineups') {
      const raw = await callProvider('soccer_team_lineups', () => fetchSportsSoccerTeamLineups(apiKey)).catch(() => null);
      sendJson(res, 200, { lineups: raw ?? null });
      return true;
    }

    const teamMatch = path.match(/^\/api\/teams\/([^/]+)$/);
    if (teamMatch && req.method === 'GET') {
      const teamId = decodeURIComponent(teamMatch[1] || '').trim();
      if (!teamId) return sendJson(res, 400, { error: 'Missing team id' }), true;
      const raw = await callProvider('soccer_team', () => fetchSportsSoccerTeam(apiKey, teamId)).catch(() => null);
      sendJson(res, 200, { team: raw?.team ?? null, raw });
      return true;
    }

    const playerMatch = path.match(/^\/api\/players\/([^/]+)$/);
    if (playerMatch && req.method === 'GET') {
      const playerId = decodeURIComponent(playerMatch[1] || '').trim();
      if (!playerId) return sendJson(res, 400, { error: 'Missing player id' }), true;
      const raw = await callProvider('soccer_player', () => fetchSportsSoccerPlayer(apiKey, playerId)).catch(() => null);
      sendJson(res, 200, { player: raw?.player ?? null, raw });
      return true;
    }

    const coachMatch = path.match(/^\/api\/coaches\/([^/]+)$/);
    if (coachMatch && req.method === 'GET') {
      const coachId = decodeURIComponent(coachMatch[1] || '').trim();
      if (!coachId) return sendJson(res, 400, { error: 'Missing coach id' }), true;
      const raw = await callProvider('soccer_coach', () => fetchSportsSoccerCoach(apiKey, coachId)).catch(() => null);
      sendJson(res, 200, { coach: raw?.coach ?? null, raw });
      return true;
    }

    if (req.method === 'POST' && path === '/api/dev/force-import') {
      sendJson(res, 200, { ok: true });
      return true;
    }

    // Legacy API-Sports proxy disabled: this backend is standardized on SportsAPIPro.
    if (req.method === 'GET' && path === '/api/events/proxy') {
      sendJson(res, 410, {
        error: 'Endpoint legado desativado. Usa os endpoints /api/events/* baseados em SportsAPIPro.',
      });
      return true;
    }

    return false;
  };

  const getAdminOddsEvents = async (): Promise<any[]> => {
    const data = await buildBySport('all', true, null, false, true, 'both', 7, false, false);
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
    if (!pool) throw new Error('Database not configured');
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

  const getEventsCache = (): Map<string, any> => {
    const combined = new Map<string, any>();
    for (const [, entry] of lastEventById) {
      if (entry?.data) {
        const ev = entry.data;
        const id = String((ev as any)?.id ?? (ev as any)?.external_event_id ?? '');
        if (id) combined.set(id, ev);
      }
    }
    return combined;
  };

  const getProviderMetrics = () => {
    const operations = Array.from(providerMetrics.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([operation, metric]) => ({
        operation,
        requests: metric.requests,
        success: metric.success,
        failures: metric.failures,
        cacheFreshHits: metric.cacheFreshHits,
        cacheStaleHits: metric.cacheStaleHits,
        cacheMisses: metric.cacheMisses,
        avgLatencyMs: metric.success > 0 ? Math.round(metric.totalLatencyMs / metric.success) : 0,
        lastLatencyMs: metric.lastLatencyMs,
        lastSuccessAt: metric.lastSuccessAt || null,
        lastFailureAt: metric.lastFailureAt || null,
        lastError: metric.lastError || '',
      }));
    return {
      since: new Date(process.uptime() > 0 ? Date.now() - Math.floor(process.uptime() * 1000) : Date.now()).toISOString(),
      operations,
      liveOddsGaps: Array.from(liveOddsGapSamples.values())
        .sort((a, b) => (b.lastSeenAt || 0) - (a.lastSeenAt || 0))
        .slice(0, 30),
    };
  };

  const getProviderConfig = () => {
    const provider = getSportsDataProviderConfig();
    return {
      provider: provider.provider,
      supportsUpstreamWs: provider.supportsUpstreamWs,
      rest: {
        prematchOddsTtlMs: ODDS_FRESH_TTL_MS,
        liveOddsTtlMs: LIVE_ODDS_FRESH_TTL_MS,
        oddsStaleTtlMs: ODDS_STALE_TTL_MS,
        liveHoldMs: LIVE_HOLD_MS,
        realtimeCacheTtlMs: REALTIME_CACHE_TTL_MS,
        realtimeTennisCacheTtlMs: REALTIME_TENNIS_CACHE_TTL_MS,
        realtimeStaleTtlMs: REALTIME_STALE_TTL_MS,
        realtimeTennisStaleTtlMs: REALTIME_TENNIS_STALE_TTL_MS,
        realtimeColdTimeoutMs: REALTIME_COLD_TIMEOUT_MS,
        oddsColdTimeoutMs: ODDS_COLD_TIMEOUT_MS,
        pregameColdTimeoutMs: PREGAME_COLD_TIMEOUT_MS,
      },
    };
  };

  const findEventById = async (sport: string, id: string): Promise<any | null> => {
    const live = await fetchLive(sport).catch(() => []);
    const foundLive = live.find((e: any) => String(e.id) === String(id));
    if (foundLive) return foundLive;

    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      const date = ymd(d);
      const sched = await fetchSchedule(sport, date).catch(() => []);
      const found = sched.find((e: any) => String(e.id) === String(id));
      if (found) return found;
    }

    return null;
  };

  const getBetValidationContext = async (eventId: string) => {
    const id = normalizeIdLoose(eventId);
    if (!id) {
      return {
        event: null,
        sport: null,
        odds: null,
        suspended: false,
        suspendedReason: '',
        suspendedMarkets: [] as string[],
        providerSuspended: false,
        eventFrozen: false,
        freezeReason: '',
      };
    }

    let event = lastEventById.get(id)?.data || null;
    let sport = event?.sport ? String(event.sport) : null;

    if (!sport) {
      sport = await resolveSport(id);
    }
    if (!sport) {
      return {
        event: null,
        sport: null,
        odds: null,
        suspended: false,
        suspendedReason: '',
        suspendedMarkets: [] as string[],
        providerSuspended: false,
        eventFrozen: false,
        freezeReason: '',
      };
    }

    if (!event) {
      event = await findEventById(sport, id);
    }

    const odds = await fetchOddsStrict(sport, id, {
      forceAll: true,
      isLive: Number(event?.is_live || 0) === 1,
      homeTeam: String(event?.home_team || ''),
      awayTeam: String(event?.away_team || ''),
    }).catch(() => null);

    const suspension = getSuspensionState(id, sport, event, odds);
    return {
      event,
      sport,
      odds,
      suspended: suspension.suspended,
      suspendedReason: suspension.suspendedReason,
      suspendedMarkets: suspension.suspendedMarkets,
      providerSuspended: suspension.providerSuspended,
      eventFrozen: suspension.eventFrozen,
      freezeReason: suspension.freezeReason,
    };
  };

  return {
    handleEventsRoutes,
    getAdminOddsEvents,
    setOddsOverride,
    getEventsCache,
    getProviderMetrics,
    getProviderConfig,
    getBetValidationContext,
  };
}
