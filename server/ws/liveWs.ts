import type http from 'http';
import process from 'node:process';
import type { Duplex } from 'stream';
import WebSocket, { WebSocketServer } from 'ws';
import {
  fetchSportsApiProLive,
  fetchSportsApiProMatchIncidents,
  fetchSportsApiProMatchOddsAll,
  fetchSportsApiProMatchOddsLive,
  fetchSportsApiProMatchOddsPreMatch,
  parseSportsApiProMatchOddsPayload,
} from '../services/sportsApiPro.js';

type ClientInfo = { ws: WebSocket; sport: string };
type UpstreamInfo = {
  localSport: string;
  wsSport: string;
  ws: WebSocket | null;
  backoffMs: number;
  connecting: boolean;
  stopped: boolean;
  lastMessageAt: number;
  pingTimer: NodeJS.Timeout | null;
};

type UpstreamStateEntry = {
  ts: number;
  status?: string;
  statusDesc?: string;
  home?: number | null;
  away?: number | null;
  score?: Record<string, any> | null;
};

type CriticalIncidentEntry = {
  ts: number;
  lastKey: string;
};

function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = Number(process.env[name] || '');
  if (!Number.isFinite(raw)) return fallback;
  const value = Math.floor(raw);
  return Math.max(min, Math.min(max, value));
}

export function createLiveWs(apiKey: string) {
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Set<ClientInfo>();
  const timers = new Map<string, NodeJS.Timeout>();
  const lastSent = new Map<string, number>();
  const upstreams = new Map<string, UpstreamInfo>();
  const SPORTS_DEFAULT = ['soccer', 'tennis', 'basketball', 'ice-hockey', 'baseball', 'volleyball', 'mma'];
  // V2 mercados: cache fresco por 3.5s → atualiza entre 3-5s automaticamente
  const ODDS_FRESH_TTL_MS = envInt('SPORTS_WS_LIVE_ODDS_TTL_MS', 3_500, 1_000, 15_000);
  const ODDS_STALE_TTL_MS = envInt('SPORTS_WS_ODDS_STALE_TTL_MS', 15 * 60_000, 60_000, 24 * 60 * 60_000);
  const SNAPSHOT_THROTTLE_MS = envInt('SPORTS_WS_SNAPSHOT_THROTTLE_MS', 1_000, 250, 10_000);
  const SNAPSHOT_CACHE_TTL_MS = envInt('SPORTS_WS_SNAPSHOT_CACHE_TTL_MS', 2_000, 500, 15_000);
  const SNAPSHOT_TENNIS_CACHE_TTL_MS = envInt('SPORTS_WS_SNAPSHOT_TENNIS_CACHE_TTL_MS', 1_000, 500, 10_000);
  const WS_RECONNECT_MIN_MS = envInt('SPORTS_WS_RECONNECT_MIN_MS', 1_000, 250, 10_000);
  const WS_RECONNECT_MAX_MS = envInt('SPORTS_WS_RECONNECT_MAX_MS', 20_000, 1_000, 60_000);
  const CRITICAL_INCIDENT_TARGET_LIMIT = envInt('SPORTS_WS_CRITICAL_INCIDENT_TARGET_LIMIT', 40, 12, 100);
  const oddsCache = new Map<string, { ts: number; data: any | null }>();
  const oddsInflight = new Map<string, Promise<any | null>>();
  const snapshotCache = new Map<string, { ts: number; live: any[] }>();
  const snapshotInflight = new Set<string>();
  const upstreamState = new Map<string, Map<string, UpstreamStateEntry>>();
  const matchMeta = new Map<string, { ts: number; sport: string; homeTeam: string; awayTeam: string }>();
  const oddsSubscribed = new Map<string, number>();
  const criticalIncidentCache = new Map<string, CriticalIncidentEntry>();
  const criticalIncidentInflight = new Map<string, Promise<void>>();
  const lastIncidentSweepAt = new Map<string, number>();
  const tennisFreezeByMatch = new Map<string, { until: number; reason: string }>();
  const criticalFreezeByMatch = new Map<string, { until: number; reason: string }>();
  let allBootstrapAt = 0;
  let allBootstrapInflight: Promise<void> | null = null;

  const normalize = (s: string) => String(s || '').trim().toLowerCase() || 'all';

  const toWsSport = (localSport: string): string => {
    const s = String(localSport || '').trim().toLowerCase();
    if (s === 'soccer') return 'football';
    if (s === 'ice-hockey') return 'hockey';
    return s;
  };

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

  const ttlOk = (ts: number, ttlMs: number) => ts > 0 && Date.now() - ts < ttlMs;

  const readPath = (obj: any, path: string): any => {
    if (!obj || typeof obj !== 'object') return undefined;
    if (path in obj) return obj[path];
    const parts = path.split('.');
    let cur: any = obj;
    for (const part of parts) {
      if (!cur || typeof cur !== 'object' || !(part in cur)) return undefined;
      cur = cur[part];
    }
    return cur;
  };

  const pickFirst = (obj: any, paths: string[]): any => {
    for (const path of paths) {
      const value = readPath(obj, path);
      if (value !== undefined && value !== null && String(value).trim() !== '') return value;
    }
    return undefined;
  };

  const toNumOrNull = (v: any): number | null => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const isSoccerSport = (sport: string): boolean => {
    const s = String(sport || '').trim().toLowerCase();
    return s === 'soccer' || s === 'football' || s === 'futebol' || (s.includes('football') && !s.includes('american'));
  };

  const incidentTimeKey = (inc: any, idx: number) => {
    const minute = Number(inc?.minute ?? 0) || 0;
    const added = Number(inc?.addedTime ?? inc?.added_time ?? 0) || 0;
    return minute * 1000 + added * 10 + (idx % 10);
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

  const TYPE_MAP: Record<number, string> = {
    1: 'goal',
    2: 'yellow_card',
    3: 'red_card',
    4: 'yellow_red',
    6: 'penalty',
    7: 'own_goal',
    8: 'missed_penalty',
    9: 'disallowed_goal',
    10: 'var',
    11: 'penalty_awarded',
  };

  const normalizeCriticalIncidents = (matchId: string, sport: string, raw: any, meta?: { homeTeam?: string; awayTeam?: string }) => {
    const homeName = String(meta?.homeTeam || '').trim().toLowerCase();
    const awayName = String(meta?.awayTeam || '').trim().toLowerCase();
    return extractIncidents(raw)
      .map((inc: any, i: number) => {
        const typeId = Number(inc.typeId ?? inc.type_id ?? inc.incident_type ?? 0);
        const type = String(TYPE_MAP[typeId] || inc.type || 'other').trim().toLowerCase();
        if (!['goal', 'own_goal', 'disallowed_goal', 'penalty', 'penalty_awarded', 'missed_penalty', 'red_card', 'yellow_red', 'var'].includes(type)) {
          return null;
        }
        const minute = Number(inc.time ?? inc.minute ?? inc.elapsed ?? 0);
        const addedTime = Number(inc.addedTime ?? inc.added_time ?? inc.injuryTime ?? 0);
        const teamSide = String(inc.teamSide ?? inc.team_side ?? inc.team ?? '').toLowerCase();
        const teamId = String(inc.team?.id ?? inc.teamId ?? '').trim();
        const teamName = String(inc.team?.name ?? inc.teamName ?? '').trim().toLowerCase();
        const isHome = teamSide === 'home' || teamSide === '1' || (!!teamName && teamName === homeName);
        const isAway = teamSide === 'away' || teamSide === '2' || (!!teamName && teamName === awayName);
        return {
          id: String(inc.id ?? `${matchId}-${i}`),
          type,
          minute,
          addedTime,
          team: isHome ? 'home' : isAway ? 'away' : (teamId ? teamId : null),
          player: inc.player?.name ?? inc.playerName ?? inc.player ?? null,
          assist: inc.player2?.name ?? inc.assistName ?? inc.assist ?? null,
          description: inc.description ?? inc.text ?? null,
          isConfirmed: inc.isConfirmed ?? inc.confirmed ?? inc.is_confirmed ?? true,
        };
      })
      .filter(Boolean);
  };

  const latestCriticalIncident = (incidents: any[]) => {
    let latest: any = null;
    let latestIdx = -1;
    let latestKey = -Infinity;
    for (let i = 0; i < incidents.length; i += 1) {
      const inc = incidents[i];
      const key = incidentTimeKey(inc, i);
      if (key >= latestKey) {
        latest = inc;
        latestIdx = i;
        latestKey = key;
      }
    }
    if (!latest) return null;
    return {
      incident: latest,
      lastKey: [
        String(latest?.id ?? ''),
        String(latest?.type ?? ''),
        String(latest?.minute ?? ''),
        String(latest?.addedTime ?? latest?.added_time ?? ''),
        String(latest?.description ?? ''),
        String(latestIdx),
      ].join('|'),
    };
  };

  const incidentToSuspendReason = (type: string): string => {
    const t = String(type || '').trim().toLowerCase();
    if (t === 'var') return 'VAR';
    if (t === 'goal' || t === 'own_goal' || t === 'disallowed_goal') return 'GOAL';
    if (t === 'penalty' || t === 'penalty_awarded' || t === 'missed_penalty') return 'PENALTY';
    if (t === 'red_card' || t === 'yellow_red') return 'CARD';
    return 'SUSPENSO';
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

  const getTennisFreeze = (matchId: string) => {
    const current = tennisFreezeByMatch.get(matchId);
    if (!current) return null;
    if (current.until > Date.now()) return current;
    tennisFreezeByMatch.delete(matchId);
    return null;
  };

  const getCriticalFreeze = (matchId: string) => {
    const current = criticalFreezeByMatch.get(matchId);
    if (!current) return null;
    if (current.until > Date.now()) return current;
    criticalFreezeByMatch.delete(matchId);
    return null;
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

  const getRealtimeSuspensionPayload = (sport: string, matchId: string) => {
    const localSport = String(sport || '').trim().toLowerCase();
    if (localSport === 'tennis') {
      const freeze = getTennisFreeze(matchId);
      if (!freeze) {
        return {
          suspended: undefined,
          suspended_reason: undefined,
          suspended_markets: undefined,
          provider_suspended: undefined,
          provider_suspended_reason: undefined,
          event_frozen: false,
          freeze_reason: undefined,
        };
      }
      const suspendedMarkets = tennisSuspendedMarketKeys(freeze.reason);
      return {
        suspended: suspendedMarkets.length > 0 ? true : undefined,
        suspended_reason: suspendedMarkets.length > 0 ? freeze.reason : undefined,
        suspended_markets: suspendedMarkets,
        provider_suspended: undefined,
        provider_suspended_reason: undefined,
        event_frozen: true,
        freeze_reason: freeze.reason,
      };
    }
    if (isSoccerSport(localSport)) {
      const freeze = getCriticalFreeze(matchId);
      if (!freeze) {
        return {
          suspended: undefined,
          suspended_reason: undefined,
          suspended_markets: undefined,
          provider_suspended: undefined,
          provider_suspended_reason: undefined,
          event_frozen: false,
          freeze_reason: undefined,
        };
      }
      return {
        suspended: undefined,
        suspended_reason: undefined,
        suspended_markets: undefined,
        provider_suspended: undefined,
        provider_suspended_reason: undefined,
        event_frozen: true,
        freeze_reason: freeze.reason,
      };
    }
    return {
      suspended: undefined,
      suspended_reason: undefined,
      suspended_markets: undefined,
      provider_suspended: undefined,
      provider_suspended_reason: undefined,
      event_frozen: undefined,
      freeze_reason: undefined,
    };
  };

  const buildLiveSuspensionPayload = (event: any, odds?: any) => {
    const sportKey = String(event?.sport || '').trim().toLowerCase();
    const matchId = normalizeMatchId(sportKey, String(event?.id || event?.external_event_id || '').trim());
    const realtime = matchId ? getRealtimeSuspensionPayload(sportKey, matchId) : {
      suspended: undefined,
      suspended_reason: undefined,
      suspended_markets: undefined,
      provider_suspended: undefined,
      provider_suspended_reason: undefined,
      event_frozen: undefined,
      freeze_reason: undefined,
    };
    const providerStatus = getProviderStatusObj(event);
    const providerReason = String(
      odds?.suspended_reason ||
      providerStatus?.reason ||
      providerStatus?.description ||
      providerStatus?.type ||
      '',
    ).trim();
    const providerSuspended = !!(
      odds?.suspended === true ||
      normalizeProviderFlag(providerStatus?.blocked) ||
      normalizeProviderFlag(providerStatus?.stopped) ||
      String(providerStatus?.short || providerStatus?.type || event?.status_short || event?.status || '').toUpperCase().trim() === 'SUSPENDED'
    );
    const suspendedMarkets = Array.isArray(realtime.suspended_markets) ? realtime.suspended_markets : [];
    const freezeReason = String(realtime.freeze_reason || '').trim();
    const suspendedReason = String(
      (providerSuspended ? providerReason : '') ||
      (suspendedMarkets.length > 0 ? freezeReason : '') ||
      '',
    ).trim();

    return {
      suspended: providerSuspended || suspendedMarkets.length > 0,
      suspended_reason: suspendedReason || undefined,
      suspended_markets: suspendedMarkets,
      provider_suspended: providerSuspended,
      provider_suspended_reason: providerSuspended ? (providerReason || undefined) : undefined,
      event_frozen: realtime.event_frozen === undefined ? undefined : Boolean(realtime.event_frozen),
      freeze_reason: freezeReason || undefined,
    };
  };

  const attachLiveSuspensionPayload = (event: any, odds?: any) => ({
    ...(event || {}),
    ...buildLiveSuspensionPayload(event, odds),
  });

  const applyRealtimeScoreFreeze = (sport: string, matchId: string, prev: UpstreamStateEntry | undefined, next: UpstreamStateEntry) => {
    const localSport = String(sport || '').trim().toLowerCase();
    if (localSport === 'tennis') {
      const prevScore = prev?.score && typeof prev.score === 'object' ? prev.score : null;
      const nextScore = next?.score && typeof next.score === 'object' ? next.score : null;
      const prevPoint = prevScore?.point ? JSON.stringify(prevScore.point) : null;
      const nextPoint = nextScore?.point ? JSON.stringify(nextScore.point) : null;
      const prevSets = prevScore?.sets ? JSON.stringify(prevScore.sets) : null;
      const nextSets = nextScore?.sets ? JSON.stringify(nextScore.sets) : null;
      const prevHome = prevScore?.home ?? prev?.home ?? null;
      const prevAway = prevScore?.away ?? prev?.away ?? null;
      const nextHome = nextScore?.home ?? next?.home ?? null;
      const nextAway = nextScore?.away ?? next?.away ?? null;

      let reason: string | null = null;
      if (prevSets !== null && nextSets !== null && prevSets !== nextSets) reason = 'SET_END';
      else if (prevPoint !== null && nextPoint !== null && prevPoint !== nextPoint) reason = 'POINT';
      else if ((prevHome !== null || prevAway !== null) && (nextHome !== null || nextAway !== null) && (prevHome !== nextHome || prevAway !== nextAway)) reason = 'GAME';

      if (reason) {
        const ttlMs = reason === 'POINT' ? 1200 : reason === 'GAME' ? 3000 : 7000;
        tennisFreezeByMatch.set(matchId, { until: Date.now() + ttlMs, reason });
      }
      return;
    }

    if (isSoccerSport(localSport)) {
      const prevHome = prev?.score?.home ?? prev?.home ?? null;
      const prevAway = prev?.score?.away ?? prev?.away ?? null;
      const nextHome = next?.score?.home ?? next?.home ?? null;
      const nextAway = next?.score?.away ?? next?.away ?? null;
      const scoreChanged =
        (prevHome !== null || prevAway !== null) &&
        (nextHome !== null || nextAway !== null) &&
        (prevHome !== nextHome || prevAway !== nextAway);

      if (scoreChanged) {
        criticalFreezeByMatch.set(matchId, { until: Date.now() + 20_000, reason: 'GOAL' });
      }
    }
  };

  const buildTennisScoreFromDelta = (data: any): Record<string, any> | null => {
    const homeSets = toNumOrNull(pickFirst(data, [
      'homeScore.setsWon',
      'homeScore.totalSets',
      'homeScore.sets',
      'homeScore.set',
    ]));
    const awaySets = toNumOrNull(pickFirst(data, [
      'awayScore.setsWon',
      'awayScore.totalSets',
      'awayScore.sets',
      'awayScore.set',
    ]));

    const sets: Record<string, { home: number | null; away: number | null }> = {};
    for (let i = 1; i <= 5; i++) {
      const home = toNumOrNull(pickFirst(data, [
        `homeScore.period${i}`,
        `homeScore.periods.${i - 1}`,
        `homeScore.scores.${i - 1}`,
        `homeScore.set${i}`,
        `homeScore.s${i}`,
      ]));
      const away = toNumOrNull(pickFirst(data, [
        `awayScore.period${i}`,
        `awayScore.periods.${i - 1}`,
        `awayScore.scores.${i - 1}`,
        `awayScore.set${i}`,
        `awayScore.s${i}`,
      ]));
      if (home !== null || away !== null) sets[`s${i}`] = { home, away };
    }

    const pointHome = pickFirst(data, [
      'homeScore.point',
      'homeScore.currentPoint',
      'homeScore.points',
      'homeScore.game',
      'homeScore.currentGamePoint',
      'homeScore.current',
    ]);
    const pointAway = pickFirst(data, [
      'awayScore.point',
      'awayScore.currentPoint',
      'awayScore.points',
      'awayScore.game',
      'awayScore.currentGamePoint',
      'awayScore.current',
    ]);

    const out: Record<string, any> = {};
    if (homeSets !== null) out.home = homeSets;
    if (awaySets !== null) out.away = awaySets;
    if (Object.keys(sets).length > 0) out.sets = sets;
    if (pointHome != null || pointAway != null) out.point = { home: pointHome ?? null, away: pointAway ?? null };
    return Object.keys(out).length > 0 ? out : null;
  };

  const mergeScoreState = (baseScore: any, nextScore: any): Record<string, any> => {
    const base =
      baseScore && typeof baseScore === 'object' && !Array.isArray(baseScore)
        ? baseScore
        : {};
    const next =
      nextScore && typeof nextScore === 'object' && !Array.isArray(nextScore)
        ? nextScore
        : {};

    return {
      ...base,
      ...next,
      sets: {
        ...((base.sets && typeof base.sets === 'object') ? base.sets : {}),
        ...((next.sets && typeof next.sets === 'object') ? next.sets : {}),
      },
      point: {
        ...((base.point && typeof base.point === 'object') ? base.point : {}),
        ...((next.point && typeof next.point === 'object') ? next.point : {}),
      },
    };
  };

  const hasOdds = (e: any) => Number(e?.home_odd) > 1 && Number(e?.away_odd) > 1;

  const isBlockedLeague = (leagueName: string, country?: string): boolean => {
    const l = String(leagueName || '').toLowerCase();
    const c = String(country || '').toLowerCase();

    if (
      /\bu\d{2}\b/.test(l) ||
      l.includes('youth') ||
      l.includes('junior') ||
      l.includes('u-17') ||
      l.includes('u-21') ||
      l.includes('u-23') ||
      l.includes('under-17') ||
      l.includes('under-21') ||
      l.includes('under-23') ||
      l.includes('under 17') ||
      l.includes('under 21') ||
      l.includes('under 23') ||
      l.includes('revelacao') ||
      l.includes('primavera') ||
      l.includes('nextgen') ||
      l.includes('reserve') ||
      l.includes('akademi') ||
      l.includes('juvenil') ||
      l.includes('sub-17') ||
      l.includes('sub-20') ||
      l.includes('sub-21') ||
      l.includes('sub-23')
    )
      return true;

    if (l.includes('amateur') || l.includes('amateure') || l.includes('amador') || l.includes('amatör')) return true;
    if (/\bwomen\b|\bwoman\b|feminino|femenino|\bdamen\b|\bféminine\b|toppserien|\bwsl\b|\bnwsl\b/.test(l)) return true;

    if (
      l.includes('regionalliga') ||
      l.includes('kakkonen') ||
      l.includes('gamma ethniki') ||
      l.includes('esiliiga') ||
      l.includes('derde divisie') ||
      l.includes('vierde') ||
      l.includes('quinta') ||
      l.includes('6th division') ||
      l.includes('7th division')
    )
      return true;
    if (l.includes('testspiel')) return true;

    const allowed = ['saudi', 'saudi arabia', 'egypt', 'egyptian', 'israel', 'israeli', 'turkey', 'turkish', 'greece', 'greek'];
    const blocked = [
      'qatar',
      'qatari',
      'uae',
      'united arab',
      'kuwait',
      'kuwaiti',
      'bahrain',
      'bahraini',
      'oman',
      'omani',
      'jordan',
      'jordanian',
      'iraq',
      'iraqi',
      'syria',
      'syrian',
      'lebanon',
      'lebanese',
      'palestine',
      'palestinian',
      'yemen',
      'yemeni',
      'iran',
      'iranian',
      'libya',
      'libyan',
      'algeria',
      'algerian',
      'morocco',
      'moroccan',
      'tunisia',
      'tunisian',
      'sudan',
      'sudanese',
      'uzbek',
      'uzbekistan',
      'tajik',
      'kyrgyz',
      'afghan',
      'pakistan',
      'pakistan',
    ];
    const leagueAndCountry = `${l} ${c}`;
    const isAllowed = allowed.some((a) => leagueAndCountry.includes(a));
    const isBlocked = blocked.some((b) => leagueAndCountry.includes(b));
    if (isBlocked && !isAllowed) return true;

    return false;
  };

  const hasBlockedTeamMarker = (teamName: string): boolean => {
    const t = String(teamName || '').toLowerCase().trim();
    if (!t) return false;
    return (
      /\bu\d{2}\b/.test(t) ||
      /\bsub-?\d{2}\b/.test(t) ||
      /under-?\d{2}|under \d{2}/.test(t) ||
      /\breserve\b|\breserves\b/.test(t) ||
      /\bwomen\b|\bwoman\b|feminino|femenino|\bdamen\b|\bféminine\b/.test(t)
    );
  };

  const isClubFriendlyLeagueName = (leagueName: string): boolean => {
    const l = String(leagueName || '').toLowerCase().trim();
    return /club friendl|club friendly|friendly games|amistosos de clubes|amistoso de clubes|amical club/.test(l);
  };

  const isImportantSoccerLeague = (leagueName: string, country?: string): boolean => {
    const l = String(leagueName || '').toLowerCase().trim();
    const c = String(country || '').toLowerCase().trim();
    const lc = `${l} ${c}`.trim();
    if (!l && !c) return false;

    if (/china|chinese|csl|super league|league one|league 1/.test(lc)) return true;
    if (/champions league|europa league|conference league|nations league/.test(l)) return true;
    if (/world cup|copa do mundo|copa mundial|euro\b|qualif|qualification|qualifier|eliminatorias/.test(l)) return true;
    if (/copa america|conmebol|libertadores|sudamericana|recopa/.test(l)) return true;
    if (/concacaf|gold cup|africa cup|afcon|\bcaf\b|asian cup|\bafc\b|olympics|olympic games/.test(l)) return true;
    if (/international friendl|friendly international|international friendly|friendlies|friendly|amistoso|amistosos|national team|national teams|selecao|selecoes/.test(l)) return true;
    if (/supercopa|super cup|uefa super|copa del rey|coppa italia|dfb.?pokal|coupe de france|fa cup|efl cup|carabao/.test(l)) return true;

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
    if (/turkey|turquia|turkiye|türkiye/.test(c) && /s[üu]per lig|1\. lig/.test(l)) return true;
    if (/belgium|belgi[qe]|belgica|bélgica/.test(c) && /jupiler|pro league/.test(l)) return true;
    if (/japan|japao|jap[oã]o/.test(c) && /j1 league|j2 league/.test(l)) return true;

    return false;
  };

  const liveQualityScore = (e: any): number => {
    let score = 0;
    const homeOdd = Number(e?.home_odd || 0);
    const drawOdd = Number(e?.draw_odd || 0);
    const awayOdd = Number(e?.away_odd || 0);
    if (homeOdd > 1) score += 3;
    if (drawOdd > 1) score += 1;
    if (awayOdd > 1) score += 3;
    const elapsed = Number(e?.elapsed ?? e?.fixture?.status?.elapsed ?? 0);
    if (Number.isFinite(elapsed) && elapsed > 0) score += 1;
    return score;
  };

  const curateLiveEvents = (arr: any[]): any[] => {
    const nonSoccer: any[] = [];
    const importantSoccer: any[] = [];
    const clubFriendlies: any[] = [];
    const fallbackSoccer: any[] = [];

    for (const e of Array.isArray(arr) ? arr : []) {
      const sport = String(e?.sport || '').toLowerCase().trim();
      if (sport && sport !== 'soccer' && sport !== 'football') {
        nonSoccer.push(e);
        continue;
      }

      const leagueName = String(e?.league || '');
      const country = String(e?.country || '');
      const homeTeam = String(e?.home_team || '');
      const awayTeam = String(e?.away_team || '');

      if (hasBlockedTeamMarker(homeTeam) || hasBlockedTeamMarker(awayTeam)) continue;
      if (isBlockedLeague(leagueName, country)) continue;

      if (isClubFriendlyLeagueName(leagueName)) {
        clubFriendlies.push(e);
        continue;
      }

      if (isImportantSoccerLeague(leagueName, country)) {
        importantSoccer.push(e);
        continue;
      }

      fallbackSoccer.push(e);
    }

    const byPriority = (a: any, b: any) => {
      const diff = liveQualityScore(b) - liveQualityScore(a);
      if (diff !== 0) return diff;
      const at = new Date(a?.event_date || a?.fixture?.date || 0).getTime();
      const bt = new Date(b?.event_date || b?.fixture?.date || 0).getTime();
      return at - bt;
    };

    const selectedFriendlies = [...clubFriendlies].sort(byPriority).slice(0, 3);
    const selectedSoccer =
      importantSoccer.length > 0
        ? [...importantSoccer, ...selectedFriendlies]
        : [...fallbackSoccer].sort(byPriority).slice(0, 6).concat(selectedFriendlies);

    return [...nonSoccer, ...selectedSoccer];
  };

  const mergeOddsResults = (results: any[]): any | null => {
    const valid = results.filter((r) => r != null);
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
          const existingSet = new Set(existing.map((l: any) => `${String(l.value || '')}|${String(l.point || '')}`));
          for (const line of lines) {
            const k = `${String(line.value || '')}|${String(line.point || '')}`;
            if (!existingSet.has(k)) {
              existing.push(line);
              existingSet.add(k);
            }
          }
        }
      }
    }
    const best = { home: 0, draw: 0, away: 0 };
    for (const r of valid) {
      const h = Number(r?.home || 0);
      const d = Number(r?.draw || 0);
      const a = Number(r?.away || 0);
      if (h > best.home) best.home = h;
      if (d > best.draw) best.draw = d;
      if (a > best.away) best.away = a;
    }
    return { home: best.home, draw: best.draw, away: best.away, markets: merged };
  };

  const trySubscribeMatchOdds = (sport: string, matchId: string) => {
    const localSport = String(sport || '').trim().toLowerCase();
    const id = String(matchId || '').trim();
    if (!localSport || !id) return;
    const u = upstreams.get(localSport);
    if (!u?.ws || u.ws.readyState !== WebSocket.OPEN) return;
    const key = `${localSport}:${id}`;
    const last = oddsSubscribed.get(key) || 0;
    if (Date.now() - last < 10 * 60_000) return;
    if (oddsSubscribed.size >= 240) return;
    oddsSubscribed.set(key, Date.now());
    // #region debug-point A:match-odds-subscribe
    void import('node:fs').then((fs) => { let eurl = 'http://127.0.0.1:7777/event', sid = 'live-delay-clock'; try { const env = fs.readFileSync('.dbg/live-delay-clock.env', 'utf8'); eurl = /DEBUG_SERVER_URL=(.+)/.exec(env)?.[1] || eurl; sid = /DEBUG_SESSION_ID=(.+)/.exec(env)?.[1] || sid; } catch { void 0; } fetch(eurl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: sid, runId: 'pre', hypothesisId: 'A', location: 'server/ws/liveWs.ts:trySubscribeMatchOdds', msg: '[DEBUG] subscribe match odds', data: { sport: localSport, channel: `match:${id}:odds` }, ts: Date.now() }) }).catch(() => null); }).catch(() => null);
    // #endregion
    try {
      u.ws.send(JSON.stringify({ action: 'subscribe', channel: `match:${id}:odds` }));
    } catch {
      void 0;
    }
  };

  const fetchOddsBestEffort = async (
    sport: string,
    matchId: string,
    ctx: { homeTeam?: string; awayTeam?: string },
    budget: { remaining: number } | null,
  ): Promise<any | null> => {
    const id = normalizeMatchId(sport, matchId);
    const key = `${sport}:${id}`;
    const cached = oddsCache.get(key);

    if (cached && cached.data != null && ttlOk(cached.ts, ODDS_FRESH_TTL_MS)) {
      // #region debug-point D:odds-cache-fresh
      void import('node:fs').then((fs) => { let url = 'http://127.0.0.1:7777/event', sid = 'live-delay-clock'; try { const env = fs.readFileSync('.dbg/live-delay-clock.env', 'utf8'); url = /DEBUG_SERVER_URL=(.+)/.exec(env)?.[1] || url; sid = /DEBUG_SESSION_ID=(.+)/.exec(env)?.[1] || sid; } catch { void 0; } fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: sid, runId: 'pre', hypothesisId: 'D', location: 'server/ws/liveWs.ts:fetchOddsBestEffort', msg: '[DEBUG] odds cache fresh hit', data: { sport: String(sport || ''), matchId: String(id || ''), ageMs: Date.now() - cached.ts }, ts: Date.now() }) }).catch(() => null); }).catch(() => null);
      // #endregion
      return cached.data;
    }
    if (cached && cached.data != null && ttlOk(cached.ts, ODDS_STALE_TTL_MS)) {
      // #region debug-point D:odds-cache-stale
      void import('node:fs').then((fs) => { let url = 'http://127.0.0.1:7777/event', sid = 'live-delay-clock'; try { const env = fs.readFileSync('.dbg/live-delay-clock.env', 'utf8'); url = /DEBUG_SERVER_URL=(.+)/.exec(env)?.[1] || url; sid = /DEBUG_SESSION_ID=(.+)/.exec(env)?.[1] || sid; } catch { void 0; } fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: sid, runId: 'pre', hypothesisId: 'D', location: 'server/ws/liveWs.ts:fetchOddsBestEffort', msg: '[DEBUG] odds cache stale hit', data: { sport: String(sport || ''), matchId: String(id || ''), ageMs: Date.now() - cached.ts, budgetRemaining: budget ? budget.remaining : null, refreshScheduled: !!(budget && budget.remaining > 0 && !oddsInflight.has(key)) }, ts: Date.now() }) }).catch(() => null); }).catch(() => null);
      // #endregion
      if (budget && budget.remaining > 0 && !oddsInflight.has(key)) {
        budget.remaining -= 1;
        fetchOddsBestEffort(sport, id, ctx, null).catch(() => null);
      }
      return cached.data;
    }
    if (budget && budget.remaining <= 0) return cached ? cached.data : null;

    if (budget) budget.remaining -= 1;
    const inflight = oddsInflight.get(key);
    if (inflight) return inflight;

    const p = (async () => {
      const opts = { homeTeam: ctx.homeTeam, awayTeam: ctx.awayTeam };
      const [allResult, liveResult, preResult] = await Promise.all([
        fetchSportsApiProMatchOddsAll(apiKey, sport, id, opts).catch(() => null),
        fetchSportsApiProMatchOddsLive(apiKey, sport, id, opts).catch(() => null),
        fetchSportsApiProMatchOddsPreMatch(apiKey, sport, id, opts).catch(() => null),
      ]);
      return mergeOddsResults([allResult, liveResult, preResult].filter(Boolean));
    })()
      .then((odds) => {
        oddsCache.set(key, { ts: Date.now(), data: odds });
        return odds;
      })
      .catch(() => null)
      .finally(() => {
        oddsInflight.delete(key);
      });

    oddsInflight.set(key, p);
    return p;
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

  const normalizeAndFilterLive = (sp: string, list: any[]): any[] => {
    const normalizedList = (Array.isArray(list) ? list : []).map((e: any) => {
      const id = String((e as any).id || '').trim() || String((e as any).external_event_id || '').split('_').pop() || '';
      const evSport = String(e?.sport || sp);
      const key = `${evSport}:${normalizeMatchId(evSport, id)}`;
      matchMeta.set(key, { ts: Date.now(), sport: evSport, homeTeam: String(e?.home_team || ''), awayTeam: String(e?.away_team || '') });
      const st = upstreamState.get(evSport)?.get(id) || upstreamState.get(sp)?.get(id) || null;
      if (st && Date.now() - st.ts < 2 * 60_000) {
        const patched: any = { ...e, id, sport: evSport };
        if (st.home != null || st.away != null) {
          patched.goals = { home: st.home ?? (patched.goals?.home ?? null), away: st.away ?? (patched.goals?.away ?? null) };
          try {
            const rawScore = (patched as any).score;
            const obj = typeof rawScore === 'string' ? JSON.parse(rawScore) : rawScore && typeof rawScore === 'object' ? rawScore : {};
            if (obj && typeof obj === 'object') {
              obj.home = patched.goals.home;
              obj.away = patched.goals.away;
              patched.score = JSON.stringify(obj);
            }
          } catch {
            void 0;
          }
        }
        if (st.score && typeof st.score === 'object') {
          try {
            const rawScore = (patched as any).score;
            const base =
              typeof rawScore === 'string'
                ? JSON.parse(rawScore)
                : rawScore && typeof rawScore === 'object'
                  ? rawScore
                  : {};
            patched.score = JSON.stringify(mergeScoreState(base, st.score));
          } catch {
            patched.score = JSON.stringify(st.score);
          }
        }
        const descU = String(st.statusDesc || '').toUpperCase();
        const short =
          descU.includes('1ST HALF') ? '1H' :
          descU.includes('2ND HALF') ? '2H' :
          descU.includes('HALF TIME') || descU.includes('INTERVAL') ? 'HT' :
          descU.includes('PEN') ? 'PEN' :
          descU.includes('EXTRA') ? 'ET' :
          '';
        if (short) {
          patched.status_short = short;
          patched.fixture = patched.fixture && typeof patched.fixture === 'object'
            ? { ...patched.fixture, status: { ...(patched.fixture.status || {}), short } }
            : patched.fixture;
        }
        return attachLiveSuspensionPayload(patched);
      }
      return attachLiveSuspensionPayload({ ...e, id, sport: evSport });
    });
    return curateLiveEvents(normalizedList
      .filter((e: any) => Number(e?.is_live || 0) === 1)
      .filter((e: any) => !isBlockedLeague(String(e?.league || ''), String(e?.country || ''))));
  };

  const broadcastIncident = (sport: string, payload: any) => {
    const msg = JSON.stringify({ type: 'incident', sport, data: payload });
    for (const c of clients) {
      if (c.sport !== 'all' && c.sport !== sport) continue;
      if (c.ws.readyState !== WebSocket.OPEN) continue;
      try {
        c.ws.send(msg);
      } catch {
        void 0;
      }
    }
  };

  function pollCriticalIncidentsFor(sport: string, liveList: any[]): void {
    const sportKey = String(sport || '').trim().toLowerCase();
    const now = Date.now();
    const lastAt = lastIncidentSweepAt.get(sportKey) || 0;
    if (now - lastAt < 2000) return;
    lastIncidentSweepAt.set(sportKey, now);

    const targets = (Array.isArray(liveList) ? liveList : [])
      .filter((ev: any) => isSoccerSport(String(ev?.sport || sportKey)))
      .map((ev: any) => {
        const id = String(ev?.id || '').trim();
        if (!id) return null;
        return {
          id,
          sport: String(ev?.sport || sportKey || 'soccer').trim().toLowerCase(),
          homeTeam: String(ev?.home_team || ev?.teams?.home?.name || '').trim(),
          awayTeam: String(ev?.away_team || ev?.teams?.away?.name || '').trim(),
        };
      })
      .filter(Boolean)
      .slice(0, CRITICAL_INCIDENT_TARGET_LIMIT) as Array<{ id: string; sport: string; homeTeam: string; awayTeam: string }>;

    for (const target of targets) {
      const cacheKey = `${target.sport}:${target.id}`;
      const cached = criticalIncidentCache.get(cacheKey);
      if (cached && now - cached.ts < 1500) continue;
      if (criticalIncidentInflight.has(cacheKey)) continue;

      const task = (async () => {
        const raw = await fetchSportsApiProMatchIncidents(apiKey, target.sport, target.id).catch(() => null);
        const normalized = normalizeCriticalIncidents(target.id, target.sport, raw, {
          homeTeam: target.homeTeam,
          awayTeam: target.awayTeam,
        });
        const latest = latestCriticalIncident(normalized);
        const lastKey = latest?.lastKey || '';
        const prevKey = criticalIncidentCache.get(cacheKey)?.lastKey || '';
        criticalIncidentCache.set(cacheKey, { ts: Date.now(), lastKey });
        if (!latest || !lastKey || lastKey === prevKey) return;

        const suspendReason = incidentToSuspendReason(latest.incident?.type);
        if (suspendReason && suspendReason !== 'SUSPENSO') {
          const ttlMs =
            suspendReason === 'VAR'
              ? 30_000
              : suspendReason === 'PENALTY'
                ? 25_000
                : suspendReason === 'CARD'
                  ? 10_000
                  : 20_000;
          criticalFreezeByMatch.set(target.id, { until: Date.now() + ttlMs, reason: suspendReason });
        }

        broadcastIncident(target.sport, {
          id: target.id,
          sport: target.sport,
          incident: latest.incident,
          incidents: normalized.slice(-8),
          suspendReason,
        });
      })()
        .catch(() => void 0)
        .finally(() => criticalIncidentInflight.delete(cacheKey));

      criticalIncidentInflight.set(cacheKey, task);
    }
  }

  const sendSnapshot = async (sport: string) => {
    const now = Date.now();
    const prev = lastSent.get(sport) || 0;
    // Mantém snapshots curtos para todos os esportes ao vivo; o upstream WS
    // já traz os deltas de placar em tempo real e o snapshot serve de bootstrap.
    const throttleMs = SNAPSHOT_THROTTLE_MS;
    if (now - prev < throttleMs) return;
    lastSent.set(sport, now);

    if (snapshotInflight.has(sport)) {
      const cached = snapshotCache.get(sport);
      // Se já houver um fetch em andamento, servimos o cache IMEDIATAMENTE 
      // mas aplicando os estados mais recentes do upstream (WebSocket do provedor)
      if (cached && now - cached.ts < 30_000) {
        const livePatched = normalizeAndFilterLive(sport, cached.live);
        const msg = JSON.stringify({ type: 'snapshot', live: livePatched });
        for (const c of clients) {
          if (c.sport !== sport) continue;
          if (c.ws.readyState !== WebSocket.OPEN) continue;
          try { c.ws.send(msg); } catch { void 0; }
        }
      }
      return;
    }

    const cached = snapshotCache.get(sport);
    // O snapshot serve só de bootstrap/recovery; para tênis mantemos cache bem
    // curto para o cliente recuperar score/sets quase em tempo real.
    const snapshotTtlMs = sport === 'tennis' ? SNAPSHOT_TENNIS_CACHE_TTL_MS : SNAPSHOT_CACHE_TTL_MS;
    if (cached && now - cached.ts < snapshotTtlMs) {
      const livePatched = normalizeAndFilterLive(sport, cached.live);
      const msg = JSON.stringify({ type: 'snapshot', live: livePatched });
      for (const c of clients) {
        if (c.sport !== sport) continue;
        if (c.ws.readyState !== WebSocket.OPEN) continue;
        try { c.ws.send(msg); } catch { void 0; }
      }
      return;
    }

    snapshotInflight.add(sport);
    const t0 = Date.now();
    // #region debug-point A:ws-snapshot-start
    void import('node:fs').then((fs) => { let u = 'http://127.0.0.1:7777/event', s = 'live-delay-clock'; try { const e = fs.readFileSync('.dbg/live-delay-clock.env', 'utf8'); u = /DEBUG_SERVER_URL=(.+)/.exec(e)?.[1] || u; s = /DEBUG_SESSION_ID=(.+)/.exec(e)?.[1] || s; } catch { void 0; } fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: s, runId: 'pre', hypothesisId: 'A', location: 'server/ws/liveWs.ts:sendSnapshot', msg: '[DEBUG] WS snapshot start', data: { sport, clientCount: Array.from(clients).filter((c) => c.sport === sport).length }, ts: Date.now() }) }).catch(() => null); }).catch(() => null);
    // #endregion
    try {
      if (sport === 'all') {
        const mergedFromCache: any[] = [];
        for (const sp of SPORTS_DEFAULT) {
          const cached = snapshotCache.get(sp);
          if (!cached || !Array.isArray(cached.live) || cached.live.length === 0) continue;
          if (now - cached.ts > 5 * 60_000) continue;
          mergedFromCache.push(...cached.live);
        }

        const prevAll = snapshotCache.get('all');
        if (mergedFromCache.length === 0) {
          const canBootstrap = !allBootstrapInflight && now - allBootstrapAt > 25_000;
          if (canBootstrap) {
            allBootstrapAt = now;
            allBootstrapInflight = (async () => {
              const entries = await Promise.all(
                SPORTS_DEFAULT.map(async (sp) => ({ sp, list: await fetchSportsApiProLive(apiKey, sp).catch(() => []) })),
              );
              const ts = Date.now();
              for (const { sp, list } of entries) {
                const live = normalizeAndFilterLive(sp, list);
                if (live.length > 0) snapshotCache.set(sp, { ts, live });
              }
            })()
              .catch(() => null)
              .then(() => void 0)
              .finally(() => {
                allBootstrapInflight = null;
              });
          }
        }

        let liveAll = mergedFromCache;
        if (liveAll.length === 0 && prevAll && Array.isArray(prevAll.live) && prevAll.live.length > 0 && now - prevAll.ts < 120_000) {
          liveAll = prevAll.live;
        }

        const toSportKey = (v: any) => String(v || '').trim().toLowerCase();
        const group: Record<string, string[]> = {};
        for (const e of liveAll) {
          const sp = toSportKey(e?.sport);
          const id = String(e?.id || '').trim();
          if (!sp || !id) continue;
          if (!group[sp]) group[sp] = [];
          if (group[sp].length < 20) group[sp].push(id);
        }
        for (const [sp, ids] of Object.entries(group)) {
          for (const id of ids) trySubscribeMatchOdds(sp, id);
        }
        pollCriticalIncidentsFor('all', liveAll);

        snapshotCache.set('all', { ts: Date.now(), live: liveAll });
        const msg = JSON.stringify({ type: 'snapshot', live: liveAll });
        for (const c of clients) {
          if (c.sport !== 'all') continue;
          if (c.ws.readyState !== WebSocket.OPEN) continue;
          try {
            c.ws.send(msg);
          } catch {
            void 0;
          }
        }
        return;
      }

      const sports = sport === 'all' ? ['soccer', 'tennis', 'basketball', 'ice-hockey', 'baseball', 'volleyball', 'mma'] : [sport];
      const liveAll: any[] = [];
      try {
        const entries = await Promise.all(
          sports.map(async (sp) => ({ sp, list: await fetchSportsApiProLive(apiKey, sp).catch(() => []) })),
        );
        for (const { sp, list } of entries) {
          liveAll.push(...normalizeAndFilterLive(sp, list));
        }
      } catch {
        void 0;
      }
      // #region debug-point A:ws-live-fetched
      void import('node:fs').then((fs) => { let u = 'http://127.0.0.1:7777/event', s = 'live-delay-clock'; try { const e = fs.readFileSync('.dbg/live-delay-clock.env', 'utf8'); u = /DEBUG_SERVER_URL=(.+)/.exec(e)?.[1] || u; s = /DEBUG_SESSION_ID=(.+)/.exec(e)?.[1] || s; } catch { void 0; } fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: s, runId: 'pre', hypothesisId: 'A', location: 'server/ws/liveWs.ts:sendSnapshot', msg: '[DEBUG] WS live fetched', data: { sport, sports, total: liveAll.length, fetchMs: Date.now() - t0 }, ts: Date.now() }) }).catch(() => null); }).catch(() => null);
      // #endregion
      // #region debug-point H1:ws-live-fetched
      void import('node:fs').then((fs) => { let u = 'http://127.0.0.1:7777/event', s = 'live-flicker-bug'; try { const e = fs.readFileSync('.dbg/live-flicker-bug.env', 'utf8'); u = /DEBUG_SERVER_URL=(.+)/.exec(e)?.[1] || u; s = /DEBUG_SESSION_ID=(.+)/.exec(e)?.[1] || s; } catch { void 0; } fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: s, runId: 'pre', hypothesisId: 'H1', location: 'server/ws/liveWs.ts:sendSnapshot', msg: 'ws-live-fetched', data: { sport, sports, total: liveAll.length, fetchMs: Date.now() - t0 }, ts: Date.now() }) }).catch(() => null); }).catch(() => null);
      // #endregion

      let baseLive = liveAll;
      const prevSnap = snapshotCache.get(sport);
      if (baseLive.length === 0 && prevSnap && Array.isArray(prevSnap.live) && prevSnap.live.length > 0 && Date.now() - prevSnap.ts < 120_000) {
        baseLive = prevSnap.live;
      }
      const now0 = Date.now();
      baseLive = baseLive.map((e) => {
        const sportKey = String(e?.sport || sport).trim().toLowerCase();
        const mid = String(e?.id || '').trim();
        if (!sportKey || !mid) return e;
        const cacheKey = `${sportKey}:${normalizeMatchId(sportKey, mid)}`;
        const cached = oddsCache.get(cacheKey);
        if (!cached || !cached.data) return e;
        if (now0 - cached.ts > ODDS_STALE_TTL_MS) return e;
        const od = cached.data;
        const h0 = Number(e?.home_odd || 0);
        const d0 = Number(e?.draw_odd || 0);
        const a0 = Number(e?.away_odd || 0);
        const h1 = Number(od.home || 0);
        const d1 = Number(od.draw || 0);
        const a1 = Number(od.away || 0);
        const markets0 = e?.markets;
        const markets1 = od?.markets;
        return {
          ...e,
          home_odd: h0 > 1 ? h0 : (h1 > 1 ? h1 : h0),
          draw_odd: d0 > 1 ? d0 : (d1 > 1 ? d1 : d0),
          away_odd: a0 > 1 ? a0 : (a1 > 1 ? a1 : a0),
          markets: markets0 && Object.keys(markets0).length > 0 ? markets0 : (markets1 || markets0),
        };
      });
      snapshotCache.set(sport, { ts: Date.now(), live: baseLive });
      const baseMsg = JSON.stringify({ type: 'snapshot', live: baseLive });
      for (const c of clients) {
        if (c.sport !== sport) continue;
        if (c.ws.readyState !== WebSocket.OPEN) continue;
        try {
          c.ws.send(baseMsg);
        } catch {
          void 0;
        }
      }

      const toSportKey = (v: any) => String(v || '').trim().toLowerCase();
      const group: Record<string, string[]> = {};
      for (const e of liveAll) {
        const sp = toSportKey(e?.sport);
        const id = String(e?.id || '').trim();
        if (!sp || !id) continue;
        if (!group[sp]) group[sp] = [];
        if (group[sp].length < 20) group[sp].push(id);
      }
      for (const [sp, ids] of Object.entries(group)) {
        for (const id of ids) trySubscribeMatchOdds(sp, id);
      }
      pollCriticalIncidentsFor(sport, liveAll);

      const budget = { remaining: 24 };
      const withOdds = await mapLimit(liveAll, 8, async (e) => {
      const sportKey = String(e?.sport || '').trim().toLowerCase();
      const mid0 = String(e?.id || '').trim();
      const cacheKey0 = `${sportKey}:${normalizeMatchId(sportKey, mid0)}`;
      const cached0 = oddsCache.get(cacheKey0);
      if (cached0 && cached0.data && Date.now() - cached0.ts < ODDS_FRESH_TTL_MS) {
        const od = cached0.data;
        const h0 = Number(e.home_odd || 0);
        const d0 = Number(e.draw_odd || 0);
        const a0 = Number(e.away_odd || 0);
        const h1 = Number(od.home || 0);
        const d1 = Number(od.draw || 0);
        const a1 = Number(od.away || 0);
        return {
          ...e,
          home_odd: h1 > 1 ? h1 : h0,
          draw_odd: d1 > 1 ? d1 : d0,
          away_odd: a1 > 1 ? a1 : a0,
          markets: od.markets || e.markets,
        };
      }
      if (hasOdds(e) && sportKey === 'soccer') {
        const mid = String(e?.id || '').trim();
        const cacheKey = `${sportKey}:${normalizeMatchId(sportKey, mid)}`;
        const cached = oddsCache.get(cacheKey);
        const age = cached ? (Date.now() - cached.ts) : Number.POSITIVE_INFINITY;
        if (age > ODDS_FRESH_TTL_MS && budget.remaining > 0) {
          const odds = await fetchOddsBestEffort(
            sportKey,
            mid,
            { homeTeam: String(e?.home_team || ''), awayTeam: String(e?.away_team || '') },
            budget,
          ).catch(() => null);
          if (odds) {
            return {
              ...e,
              home_odd: odds?.home ? Number(odds.home) : Number(e?.home_odd || 0),
              draw_odd: odds?.draw ? Number(odds.draw) : Number(e?.draw_odd || 0),
              away_odd: odds?.away ? Number(odds.away) : Number(e?.away_odd || 0),
              markets: odds?.markets ? odds.markets : e?.markets,
            };
          }
        }
      }
      if (hasOdds(e)) return e;
        const odds = await fetchOddsBestEffort(
          String(e?.sport || ''),
          String(e?.id || ''),
          { homeTeam: String(e?.home_team || ''), awayTeam: String(e?.away_team || '') },
          budget,
        ).catch(() => null);
        if (!odds) return e;
        return {
          ...e,
          home_odd: odds?.home ? Number(odds.home) : Number(e?.home_odd || 0),
          draw_odd: odds?.draw ? Number(odds.draw) : Number(e?.draw_odd || 0),
          away_odd: odds?.away ? Number(odds.away) : Number(e?.away_odd || 0),
          markets: odds?.markets ? odds.markets : e?.markets,
        };
      });

      const live = withOdds;
      snapshotCache.set(sport, { ts: Date.now(), live });
      // #region debug-point A:ws-snapshot-ready
      void import('node:fs').then((fs) => { let u = 'http://127.0.0.1:7777/event', s = 'live-delay-clock'; try { const e = fs.readFileSync('.dbg/live-delay-clock.env', 'utf8'); u = /DEBUG_SERVER_URL=(.+)/.exec(e)?.[1] || u; s = /DEBUG_SESSION_ID=(.+)/.exec(e)?.[1] || s; } catch { void 0; } fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: s, runId: 'pre', hypothesisId: 'A', location: 'server/ws/liveWs.ts:sendSnapshot', msg: '[DEBUG] WS snapshot ready', data: { sport, liveWithOdds: live.length, totalMs: Date.now() - t0, oddsBudgetLeft: budget.remaining }, ts: Date.now() }) }).catch(() => null); }).catch(() => null);
      // #endregion
      // #region debug-point H1:ws-snapshot-ready
      void import('node:fs').then((fs) => { let u = 'http://127.0.0.1:7777/event', s = 'live-flicker-bug'; try { const e = fs.readFileSync('.dbg/live-flicker-bug.env', 'utf8'); u = /DEBUG_SERVER_URL=(.+)/.exec(e)?.[1] || u; s = /DEBUG_SESSION_ID=(.+)/.exec(e)?.[1] || s; } catch { void 0; } fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: s, runId: 'pre', hypothesisId: 'H1', location: 'server/ws/liveWs.ts:sendSnapshot', msg: 'ws-snapshot-ready', data: { sport, liveCount: live.length, totalMs: Date.now() - t0, oddsBudgetLeft: budget.remaining, clientCount: Array.from(clients).filter((c) => c.sport === sport).length }, ts: Date.now() }) }).catch(() => null); }).catch(() => null);
      // #endregion
      const msg = JSON.stringify({ type: 'snapshot', live });
      for (const c of clients) {
        if (c.sport !== sport) continue;
        if (c.ws.readyState !== WebSocket.OPEN) continue;
        try {
          c.ws.send(msg);
        } catch {
          void 0;
        }
      }
    } finally {
      snapshotInflight.delete(sport);
    }
  };

  const connectUpstream = (sport: string) => {
    const localSport = String(sport || '').trim().toLowerCase();
    if (!localSport || localSport === 'all') return;
    const wsSport = toWsSport(localSport);
    const existing = upstreams.get(localSport);
    if (existing && (existing.connecting || (existing.ws && existing.ws.readyState === WebSocket.OPEN))) return;

    const u: UpstreamInfo = existing || {
      localSport,
      wsSport,
      ws: null,
      backoffMs: 1000,
      connecting: false,
      stopped: false,
      lastMessageAt: 0,
      pingTimer: null,
    };
    u.connecting = true;
    u.stopped = false;
    upstreams.set(localSport, u);

    const url = `wss://v2.${wsSport}.sportsapipro.com/ws?x-api-key=${encodeURIComponent(apiKey)}`;
    const ws = new WebSocket(url, { headers: { 'x-sport': wsSport } as any });
    u.ws = ws;

    ws.on('open', () => {
      u.connecting = false;
      u.backoffMs = 1000;
      // #region debug-point A:upstream-open
      void import('node:fs').then((fs) => { let eurl = 'http://127.0.0.1:7777/event', sid = 'live-delay-clock'; try { const env = fs.readFileSync('.dbg/live-delay-clock.env', 'utf8'); eurl = /DEBUG_SERVER_URL=(.+)/.exec(env)?.[1] || eurl; sid = /DEBUG_SESSION_ID=(.+)/.exec(env)?.[1] || sid; } catch { void 0; } fetch(eurl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: sid, runId: 'pre', hypothesisId: 'A', location: 'server/ws/liveWs.ts:connectUpstream', msg: '[DEBUG] upstream open', data: { localSport, wsSport, url }, ts: Date.now() }) }).catch(() => null); }).catch(() => null);
      // #endregion
      try {
        ws.send(JSON.stringify({ action: 'subscribe', channel: 'live-scores' }));
      } catch {
        void 0;
      }
      if (u.pingTimer) clearInterval(u.pingTimer);
      u.pingTimer = setInterval(() => {
        if (!u.ws || u.ws.readyState !== WebSocket.OPEN) return;
        try {
          u.ws.send(JSON.stringify({ action: 'ping', channel: 'live-scores' }));
        } catch {
          void 0;
        }
      }, 30_000);
      sendSnapshot(localSport).catch(() => null);
    });

    const broadcastDelta = (sport: string, delta: any) => {
      const msg = JSON.stringify({ type: 'update', sport, data: delta });
      for (const c of clients) {
        if (c.sport !== 'all' && c.sport !== sport) continue;
        if (c.ws.readyState !== WebSocket.OPEN) continue;
        try {
          c.ws.send(msg);
        } catch {
          void 0;
        }
      }
    };

    ws.on('message', (raw) => {
      u.lastMessageAt = Date.now();
      try {
        const txt = String((raw as any)?.toString ? (raw as any).toString() : raw);
        const msg = JSON.parse(txt);
        if (msg && msg.channel === 'live-scores' && msg.data && typeof msg.data === 'object') {
          const d = msg.data;
          const id = String(d.eventId ?? d.id ?? '').trim();
          if (id) {
            const homeRaw =
              d['homeScore.current'] ??
              d['homeScore.display'] ??
              d['homeScore.total'] ??
              d.homeScore?.current ??
              d.homeScore?.display ??
              d.homeScore?.total ??
              d.score?.home ??
              d.goals?.home ??
              null;
            const awayRaw =
              d['awayScore.current'] ??
              d['awayScore.display'] ??
              d['awayScore.total'] ??
              d.awayScore?.current ??
              d.awayScore?.display ??
              d.awayScore?.total ??
              d.score?.away ??
              d.goals?.away ??
              null;
            const home = homeRaw == null ? null : (Number.isFinite(Number(homeRaw)) ? Number(homeRaw) : null);
            const away = awayRaw == null ? null : (Number.isFinite(Number(awayRaw)) ? Number(awayRaw) : null);
            const statusDesc = String(d['status.description'] ?? d.statusDescription ?? d['statusDescription'] ?? d.statusDescriptionText ?? '').trim();
            const status = String(d['status.type'] ?? d['status.code'] ?? d['statusType'] ?? d.statusType ?? '').trim();
            const elapsedRaw =
              d.elapsed ??
              d['status.elapsed'] ??
              d.status?.elapsed ??
              d.clock?.elapsed ??
              d.time?.elapsed ??
              null;
            const timerRaw =
              d.timer ??
              d.clock ??
              d['status.timer'] ??
              d.status?.timer ??
              d.time?.clock ??
              d.time?.display ??
              null;
            const elapsed = elapsedRaw == null ? null : (Number.isFinite(Number(elapsedRaw)) ? Number(elapsedRaw) : null);
            const timer = timerRaw == null ? '' : String(timerRaw).trim();
            const deltaScore = localSport === 'tennis' ? buildTennisScoreFromDelta(d) : null;
            const m = upstreamState.get(localSport) || (upstreamState.set(localSport, new Map()), upstreamState.get(localSport)!);
            const prevData = m.get(id);
            
            const updateData = {
              ts: Date.now(),
              status: status || undefined,
              statusDesc: statusDesc || undefined,
              home,
              away,
              score: deltaScore,
              elapsed: elapsed ?? undefined,
              timer: timer || undefined,
            };
            applyRealtimeScoreFreeze(localSport, id, prevData, updateData);
            m.set(id, updateData);
            const realtimeSuspension = getRealtimeSuspensionPayload(localSport, id);
            
            // DELTA UPDATE: Envia apenas a mudança de placar/status imediatamente
            broadcastDelta(localSport, {
              id,
              sport: localSport,
              goals: (home != null || away != null) ? { home, away } : undefined,
              score: deltaScore || undefined,
              status_short: status || undefined,
              status_long: statusDesc || undefined,
              elapsed: elapsed ?? undefined,
              timer: timer || undefined,
              suspended: realtimeSuspension.suspended,
              suspended_reason: realtimeSuspension.suspended_reason,
              suspendReason: realtimeSuspension.suspended_reason,
              suspended_markets: realtimeSuspension.suspended_markets,
              provider_suspended: realtimeSuspension.provider_suspended,
              provider_suspended_reason: realtimeSuspension.provider_suspended_reason,
              event_frozen: realtimeSuspension.event_frozen,
              freeze_reason: realtimeSuspension.freeze_reason,
              is_live: 1
            });

            trySubscribeMatchOdds(localSport, id);
          }
        }
        if (msg && typeof msg.channel === 'string') {
          const mOdds = /^match:(\d+):odds$/i.exec(msg.channel);
          if (mOdds) {
            const matchId = String(mOdds[1] || '').trim();
            const normalizedId = normalizeMatchId(localSport, matchId);
            const key = `${localSport}:${normalizedId}`;
            const meta = matchMeta.get(key);
            const parsed = parseSportsApiProMatchOddsPayload(localSport, msg.data, meta ? { homeTeam: meta.homeTeam, awayTeam: meta.awayTeam } : undefined);
            if (parsed) {
              oddsCache.set(key, { ts: Date.now(), data: parsed });
              const realtimeSuspension = getRealtimeSuspensionPayload(localSport, normalizedId);
              
              // DELTA UPDATE: Envia apenas a mudança de odds imediatamente
              broadcastDelta(localSport, {
                id: normalizedId,
                sport: localSport,
                home_odd: parsed.home,
                draw_odd: parsed.draw,
                away_odd: parsed.away,
                markets: parsed.markets,
                suspended: realtimeSuspension.suspended,
                suspended_reason: realtimeSuspension.suspended_reason,
                suspendReason: realtimeSuspension.suspended_reason,
                suspended_markets: realtimeSuspension.suspended_markets,
                provider_suspended: realtimeSuspension.provider_suspended,
                provider_suspended_reason: realtimeSuspension.provider_suspended_reason,
                event_frozen: realtimeSuspension.event_frozen,
                freeze_reason: realtimeSuspension.freeze_reason,
              });
            }
            // #region debug-point A:tennis-odds-update
            void import('node:fs').then((fs) => { let eurl = 'http://127.0.0.1:7777/event', sid = 'live-delay-clock'; try { const env = fs.readFileSync('.dbg/live-delay-clock.env', 'utf8'); eurl = /DEBUG_SERVER_URL=(.+)/.exec(env)?.[1] || eurl; sid = /DEBUG_SESSION_ID=(.+)/.exec(env)?.[1] || sid; } catch { void 0; } const keys = msg?.data && typeof msg.data === 'object' ? Object.keys(msg.data).slice(0, 40) : null; fetch(eurl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: sid, runId: 'pre', hypothesisId: 'A', location: 'server/ws/liveWs.ts:connectUpstream', msg: '[DEBUG] match odds update (invalidate cache)', data: { localSport, channel: msg.channel, matchId, dataKeys: keys }, ts: Date.now() }) }).catch(() => null); }).catch(() => null);
            // #endregion
          }
        }
      } catch {
        void 0;
      }
      // #region debug-point A:upstream-msg
      void import('node:fs').then((fs) => { let url = 'http://127.0.0.1:7777/event', sid = 'live-delay-clock'; try { const env = fs.readFileSync('.dbg/live-delay-clock.env', 'utf8'); url = /DEBUG_SERVER_URL=(.+)/.exec(env)?.[1] || url; sid = /DEBUG_SESSION_ID=(.+)/.exec(env)?.[1] || sid; } catch { void 0; } let txt = ''; let parsed: any = null; try { txt = String((raw as any)?.toString ? (raw as any).toString() : raw); if (txt.length > 8000) txt = txt.slice(0, 8000); parsed = JSON.parse(txt); } catch { parsed = null; } const dataSample = parsed ? { type: parsed?.type ?? null, channel: parsed?.channel ?? null, dataKeys: parsed?.data && typeof parsed.data === 'object' ? Object.keys(parsed.data).slice(0, 30) : null, data: (() => { const d = parsed?.data; if (!d || typeof d !== 'object') return null; return { matchId: d.matchId ?? d.id ?? d.fixtureId ?? null, minute: d.minute ?? d.elapsed ?? d.time ?? d.clock ?? null, status: d.status ?? d.phase ?? d.period ?? null, score: d.score ?? { home: d.homeScore ?? null, away: d.awayScore ?? null } }; })() } : null; fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: sid, runId: 'pre', hypothesisId: 'A', location: 'server/ws/liveWs.ts:connectUpstream', msg: '[DEBUG] upstream message received', data: { localSport, wsSport, bytes: txt ? txt.length : null, sample: dataSample }, ts: Date.now() }) }).catch(() => null); }).catch(() => null);
      // #endregion
      sendSnapshot(localSport).catch(() => null);
      sendSnapshot('all').catch(() => null);
    });

    const scheduleReconnect = () => {
      if (u.stopped) return;
      if (u.pingTimer) {
        clearInterval(u.pingTimer);
        u.pingTimer = null;
      }
      const delay = Math.min(WS_RECONNECT_MAX_MS, Math.max(WS_RECONNECT_MIN_MS, u.backoffMs));
      u.backoffMs = Math.min(WS_RECONNECT_MAX_MS, Math.max(WS_RECONNECT_MIN_MS, u.backoffMs * 2));
      setTimeout(() => {
        const stillNeeded = Array.from(clients).some((c) => c.sport === localSport || c.sport === 'all');
        if (!stillNeeded) return;
        connectUpstream(localSport);
      }, delay);
    };

    ws.on('close', scheduleReconnect);
    ws.on('error', scheduleReconnect);
  };

  const stopUpstreamIfUnused = (sport: string) => {
    const localSport = String(sport || '').trim().toLowerCase();
    if (!localSport || localSport === 'all') return;
    const any = Array.from(clients).some((c) => c.sport === localSport || c.sport === 'all');
    if (any) return;
    const u = upstreams.get(localSport);
    if (!u) return;
    u.stopped = true;
    if (u.pingTimer) {
      clearInterval(u.pingTimer);
      u.pingTimer = null;
    }
    if (u.ws) {
      try {
        u.ws.close();
      } catch {
        void 0;
      }
      u.ws = null;
    }
  };

  const ensureTimer = (sport: string) => {
    if (timers.has(sport)) return;
    if (sport === 'all') {
      for (const s of SPORTS_DEFAULT) connectUpstream(s);
    } else {
      connectUpstream(sport);
    }
    const intervalMs =
      sport === 'all' || sport === 'soccer' || sport === 'tennis'
        ? 1000
        : 2500;
    const id = setInterval(() => {
      sendSnapshot(sport).catch(() => null);
    }, intervalMs);
    timers.set(sport, id);
    sendSnapshot(sport).catch(() => null);
  };

  const cleanupTimer = (sport: string) => {
    const any = Array.from(clients).some((c) => c.sport === sport && c.ws.readyState === WebSocket.OPEN);
    if (any) return;
    const t = timers.get(sport);
    if (t) clearInterval(t);
    timers.delete(sport);
    if (sport === 'all') {
      for (const s of SPORTS_DEFAULT) stopUpstreamIfUnused(s);
    } else {
      stopUpstreamIfUnused(sport);
    }
  };

  wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
    const u = new URL(req.url || '', 'http://localhost');
    const sport = normalize(u.searchParams.get('sport') || 'all');
    const c: ClientInfo = { ws, sport };
    clients.add(c);
    // #region debug-point H1:client-connect
    void import('node:fs').then((fs) => { let u = 'http://127.0.0.1:7777/event', s = 'live-flicker-bug'; try { const e = fs.readFileSync('.dbg/live-flicker-bug.env', 'utf8'); u = /DEBUG_SERVER_URL=(.+)/.exec(e)?.[1] || u; s = /DEBUG_SESSION_ID=(.+)/.exec(e)?.[1] || s; } catch { void 0; } fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: s, runId: 'pre', hypothesisId: 'H1', location: 'server/ws/liveWs.ts:connection', msg: 'client-connect', data: { sport, clients: clients.size }, ts: Date.now() }) }).catch(() => null); }).catch(() => null);
    // #endregion
    ensureTimer(sport);

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(String(data || ''));
        if (msg?.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
        }
      } catch {
        void 0;
      }
    });

    ws.on('close', () => {
      clients.delete(c);
      // #region debug-point H1:client-close
      void import('node:fs').then((fs) => { let u = 'http://127.0.0.1:7777/event', s = 'live-flicker-bug'; try { const e = fs.readFileSync('.dbg/live-flicker-bug.env', 'utf8'); u = /DEBUG_SERVER_URL=(.+)/.exec(e)?.[1] || u; s = /DEBUG_SESSION_ID=(.+)/.exec(e)?.[1] || s; } catch { void 0; } fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: s, runId: 'pre', hypothesisId: 'H1', location: 'server/ws/liveWs.ts:connection', msg: 'client-close', data: { sport, clients: clients.size }, ts: Date.now() }) }).catch(() => null); }).catch(() => null);
      // #endregion
      cleanupTimer(sport);
    });
    ws.on('error', () => {
      clients.delete(c);
      // #region debug-point H1:client-error
      void import('node:fs').then((fs) => { let u = 'http://127.0.0.1:7777/event', s = 'live-flicker-bug'; try { const e = fs.readFileSync('.dbg/live-flicker-bug.env', 'utf8'); u = /DEBUG_SERVER_URL=(.+)/.exec(e)?.[1] || u; s = /DEBUG_SESSION_ID=(.+)/.exec(e)?.[1] || s; } catch { void 0; } fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: s, runId: 'pre', hypothesisId: 'H1', location: 'server/ws/liveWs.ts:connection', msg: 'client-error', data: { sport, clients: clients.size }, ts: Date.now() }) }).catch(() => null); }).catch(() => null);
      // #endregion
      cleanupTimer(sport);
    });
  });

  const handleUpgrade = (req: http.IncomingMessage, socket: Duplex, head: Buffer) => {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  };

  return { wss, handleUpgrade };
}
