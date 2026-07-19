
import { useMemo } from 'react';
import type { Event } from '../../shared/types';

const normalizeTeam = (s: string) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const eventDateKey = (e: any) => {
  const raw = e?.event_date ?? e?.fixture?.date ?? e?.date;
  return String(raw || '').slice(0, 10);
};

const matchUID = (e: any) => {
  const home = e?.home_team ?? e?.teams?.home?.name ?? '';
  const away = e?.away_team ?? e?.teams?.away?.name ?? '';
  return `${normalizeTeam(home)}-vs-${normalizeTeam(away)}-${eventDateKey(e)}`;
};

const mergeKeyOf = (e: any) => {
  const ext = e?.external_event_id ?? e?.externalId ?? e?.externalID;
  const fixId = e?.fixture?.id;
  const id = e?.id;
  return String(ext || fixId || matchUID(e) || id || '').trim();
};

const isNonEmptyObj = (v: any) => !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length > 0;
const isNonEmptyMarkets = (v: any) => (Array.isArray(v) ? v.length > 0 : isNonEmptyObj(v));

const isNonEmptyString = (v: any) => typeof v === 'string' && v.trim().length > 0;

const parseScoreObject = (value: any): Record<string, any> | null => {
  if (!value) return null;
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, any>;
  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (!s || !(s.startsWith('{') || s.startsWith('['))) return null;
  try {
    const parsed = JSON.parse(s);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const scoreDetailWeight = (value: any): number => {
  const obj = parseScoreObject(value);
  if (!obj) return 0;
  let weight = 0;
  if (obj.home != null) weight += 1;
  if (obj.away != null) weight += 1;
  if (obj.point && typeof obj.point === 'object') {
    if (obj.point.home != null) weight += 2;
    if (obj.point.away != null) weight += 2;
  }
  const sets = obj.sets && typeof obj.sets === 'object' ? obj.sets : null;
  if (sets) {
    for (const setValue of Object.values(sets)) {
      if (!setValue || typeof setValue !== 'object') continue;
      if ((setValue as any).home != null) weight += 3;
      if ((setValue as any).away != null) weight += 3;
    }
  }
  return weight;
};

const mergeScores = (httpScore: any, wsScore: any) => {
  const httpObj = parseScoreObject(httpScore);
  const wsObj = parseScoreObject(wsScore);

  if (httpObj && wsObj) {
    return {
      ...httpObj,
      ...wsObj,
      sets: {
        ...((httpObj.sets && typeof httpObj.sets === 'object') ? httpObj.sets : {}),
        ...((wsObj.sets && typeof wsObj.sets === 'object') ? wsObj.sets : {}),
      },
      point: {
        ...((httpObj.point && typeof httpObj.point === 'object') ? httpObj.point : {}),
        ...((wsObj.point && typeof wsObj.point === 'object') ? wsObj.point : {}),
      },
    };
  }

  const httpWeight = scoreDetailWeight(httpScore);
  const wsWeight = scoreDetailWeight(wsScore);
  if (wsWeight > httpWeight) return wsScore;
  if (httpWeight > 0) return httpScore;
  return wsScore ?? httpScore;
};

const mergeGoals = (httpEvt: any, wsEvt: any, mergedScore: any) => {
  const scoreObj = parseScoreObject(mergedScore);
  if (scoreObj && (scoreObj.home != null || scoreObj.away != null)) {
    return {
      home: scoreObj.home ?? wsEvt?.goals?.home ?? httpEvt?.goals?.home ?? null,
      away: scoreObj.away ?? wsEvt?.goals?.away ?? httpEvt?.goals?.away ?? null,
    };
  }
  return wsEvt?.goals ?? httpEvt?.goals;
};

const hasAnyOdds = (e: any) => {
  const h = Number(e?.home_odd || 0);
  const d = Number(e?.draw_odd || 0);
  const a = Number(e?.away_odd || 0);
  if (h > 1 && a > 1) return true;
  if (d > 1) return true;
  const mk = e?.markets ?? e?.odds;
  return isNonEmptyMarkets(mk);
};

const hasLiveSignal = (e: any) => {
  const goals = e?.goals;
  const hasGoals =
    goals &&
    ((goals.home != null && goals.home !== '') || (goals.away != null && goals.away !== ''));
  const hasScore = parseScoreObject(e?.score) || isNonEmptyString(e?.score);
  const hasTimer = isNonEmptyString(e?.timer) || isNonEmptyString(e?.fixture?.status?.timer);
  const elapsed = Number(e?.elapsed ?? e?.fixture?.status?.elapsed);
  const hasElapsed = Number.isFinite(elapsed) && elapsed > 0;
  const hasIncidents =
    (Array.isArray(e?.events) && e.events.length > 0) ||
    (Array.isArray(e?.fixture?.events) && e.fixture.events.length > 0);
  return Boolean(
    hasGoals ||
    hasScore ||
    hasTimer ||
    hasElapsed ||
    hasIncidents ||
    e?.suspended ||
    e?.provider_suspended ||
    e?.event_frozen
  );
};

const isRecentLiveWindow = (e: any) => {
  const raw = e?.event_date ?? e?.fixture?.date ?? e?.date;
  if (!raw) return true;
  const ts = new Date(raw).getTime();
  if (!Number.isFinite(ts) || ts <= 0) return true;
  return ts >= Date.now() - 12 * 60 * 60 * 1000;
};

const pickTimer = (wsTimer: any, httpTimer: any) => {
  if (isNonEmptyString(wsTimer)) return String(wsTimer).trim();
  if (isNonEmptyString(httpTimer)) return String(httpTimer).trim();
  return '';
};

const pickElapsed = (wsElapsed: any, httpElapsed: any) => {
  const w = Number(wsElapsed);
  const h = Number(httpElapsed);
  const wOk = Number.isFinite(w) && w > 0;
  const hOk = Number.isFinite(h) && h > 0;
  if (wOk) return w;
  if (hOk) return h;
  if (Number.isFinite(w)) return w;
  if (Number.isFinite(h)) return h;
  return 0;
};

const normalizeStatusValue = (value: any) =>
  String(value || '')
    .toUpperCase()
    .trim()
    .replace(/[^A-Z0-9_]+/g, '');

const readStatusSnapshot = (e: any) => {
  const statusObj = e?.status && typeof e?.status === 'object' ? e.status : null;
  const short = normalizeStatusValue(statusObj?.short ?? e?.status_short ?? e?.fixture?.status?.short ?? e?.status);
  const long = String(statusObj?.long ?? e?.status_long ?? e?.fixture?.status?.long ?? '').trim();
  return { short, long };
};

const selectMergedStatus = (httpEvt: any, wsEvt: any) => {
  const http = readStatusSnapshot(httpEvt);
  const ws = readStatusSnapshot(wsEvt);
  const allShorts = [ws.short, http.short].filter(Boolean);
  const intervalPriority = ['HT', 'BT'];
  const preferredInterval = intervalPriority.find((key) => allShorts.includes(key));
  const short = preferredInterval || ws.short || http.short || '';
  const long =
    (preferredInterval && (ws.long || http.long)) ||
    ws.long ||
    http.long ||
    '';
  return { short, long };
};

const statusKeyOf = (e: any) => {
  const raw =
    (typeof e?.status === 'string' ? e.status : (e?.status?.short ?? e?.status?.long)) ??
    e?.fixture?.status?.short ??
    e?.fixture?.status?.long ??
    '';
  return String(raw || '')
    .toUpperCase()
    .trim()
    .replace(/[^A-Z0-9_]+/g, '');
};

const isLiveStatusKey = (status: string) =>
  [
    'LIVE', '1H', '2H', 'HT', 'ET', 'ET1', 'ET2', 'P', 'PEN', 'SO', 'BT', 'AT', 'ST',
    'Q1', 'Q2', 'Q3', 'Q4', 'OT',
    'P1', 'P2', 'P3',
    'S1', 'S2', 'S3', 'S4', 'S5',
    'IN', 'IN_PROGRESS', '2MW', '2MIN',
  ].includes(status) || /^IN\d+$/.test(status);

/**
 * Merges HTTP Snapshot events with Real-time WebSocket events.
 * 
 * @param httpEvents - List of events fetched via HTTP (snapshot)
 * @param wsEvents - List of events from WebSocket (live updates)
 * @returns Merged list of events with WS data taking priority
 */
export function useMergedEvents(
  httpEvents: Event[] = [], 
  wsEvents: Event[] = []
) {
  // Merge HTTP + WS + Placeholders
  const merged = useMemo(() => {
    const map = new Map<string, Event>();
    const index = new Map<string, string>();

    const indexAliases = (canonical: string, e: any) => {
      const add = (k: any) => {
        const s = String(k || '').trim();
        if (!s) return;
        if (!index.has(s)) index.set(s, canonical);
      };
      add(canonical);
      add(e?.id);
      add(e?.external_event_id);
      add(e?.fixture?.id);
      add(matchUID(e));
    };
    
    // Base: HTTP Events
    httpEvents.forEach(e => {
      const canonical = mergeKeyOf(e);
      if (!canonical) return;
      map.set(canonical, e);
      indexAliases(canonical, e);
    });
    
    // Overlay: WS Events (Prefer live WS for odds/markets when available)
    wsEvents.forEach(e => {
      const canonical =
        index.get(String(e?.id || '').trim()) ||
        index.get(String(e?.external_event_id || '').trim()) ||
        index.get(String(e?.fixture?.id || '').trim()) ||
        index.get(matchUID(e)) ||
        mergeKeyOf(e);
      if (!canonical) return;

      const httpEvt = map.get(canonical);
      
      const httpMarkets = (httpEvt as any)?.markets ?? (httpEvt as any)?.odds;
      const wsMarkets = (e as any)?.markets ?? (e as any)?.odds;
      const markets =
        isNonEmptyMarkets(wsMarkets) ? wsMarkets : isNonEmptyMarkets(httpMarkets) ? httpMarkets : (e as any)?.odds ?? (httpEvt as any)?.odds ?? {};

      const httpHomeOdd = Number((httpEvt as any)?.home_odd || 0);
      const httpDrawOdd = Number((httpEvt as any)?.draw_odd || 0);
      const httpAwayOdd = Number((httpEvt as any)?.away_odd || 0);
      const wsHomeOdd = Number((e as any)?.home_odd || 0);
      const wsDrawOdd = Number((e as any)?.draw_odd || 0);
      const wsAwayOdd = Number((e as any)?.away_odd || 0);

      const mergedScore = mergeScores((httpEvt as any)?.score, (e as any)?.score);
      const mergedGoals = mergeGoals(httpEvt as any, e as any, mergedScore);
      const mergedStatus = selectMergedStatus(httpEvt, e);
      const wsSuspendedMarkets = Array.isArray((e as any)?.suspended_markets) ? (e as any).suspended_markets : null;
      const httpSuspendedMarkets = Array.isArray((httpEvt as any)?.suspended_markets) ? (httpEvt as any).suspended_markets : null;
      const providerSuspended =
        typeof (e as any)?.provider_suspended === 'boolean'
          ? (e as any).provider_suspended
          : typeof (httpEvt as any)?.provider_suspended === 'boolean'
            ? (httpEvt as any).provider_suspended
            : undefined;
      const providerSuspendedReason =
        (e as any)?.provider_suspended_reason ??
        (httpEvt as any)?.provider_suspended_reason ??
        undefined;
      const eventFrozen =
        typeof (e as any)?.event_frozen === 'boolean'
          ? (e as any).event_frozen
          : typeof (httpEvt as any)?.event_frozen === 'boolean'
            ? (httpEvt as any).event_frozen
            : undefined;
      const freezeReason =
        (e as any)?.freeze_reason ??
        (httpEvt as any)?.freeze_reason ??
        undefined;
      const legacySuspended =
        typeof (e as any)?.suspended === 'boolean'
          ? (e as any).suspended
          : typeof (httpEvt as any)?.suspended === 'boolean'
            ? (httpEvt as any).suspended
            : providerSuspended === true
              ? true
              : eventFrozen === true
                ? true
                : false;

      const mergedEvt: Event = {
        ...(httpEvt || {}),
        ...e,
        id: (httpEvt as any)?.id || (e as any)?.id || (e as any)?.external_event_id || (e as any)?.fixture?.id,
        external_event_id: (httpEvt as any)?.external_event_id || (e as any)?.external_event_id || (httpEvt as any)?.id || (e as any)?.id,
        odds: isNonEmptyObj((e as any)?.odds) ? (e as any).odds : isNonEmptyObj((httpEvt as any)?.odds) ? (httpEvt as any).odds : {},
        home_odd: wsHomeOdd > 1 ? wsHomeOdd : httpHomeOdd > 1 ? httpHomeOdd : wsHomeOdd || httpHomeOdd || 0,
        draw_odd: wsDrawOdd > 1 ? wsDrawOdd : httpDrawOdd > 1 ? httpDrawOdd : wsDrawOdd || httpDrawOdd || 0,
        away_odd: wsAwayOdd > 1 ? wsAwayOdd : httpAwayOdd > 1 ? httpAwayOdd : wsAwayOdd || httpAwayOdd || 0,
        markets,
        score: mergedScore,
        goals: mergedGoals,
        status: mergedStatus.short || (e as any)?.status || (httpEvt as any)?.status,
        status_short: mergedStatus.short || undefined,
        status_long: mergedStatus.long || undefined,
        elapsed: pickElapsed((e as any)?.elapsed ?? (e as any)?.fixture?.status?.elapsed, (httpEvt as any)?.elapsed ?? (httpEvt as any)?.fixture?.status?.elapsed),
        timer: pickTimer((e as any)?.timer ?? (e as any)?.fixture?.status?.timer, (httpEvt as any)?.timer ?? (httpEvt as any)?.fixture?.status?.timer),
        suspended: legacySuspended,
        suspended_reason:
          (e as any)?.suspended_reason ??
          (e as any)?.suspendReason ??
          (httpEvt as any)?.suspended_reason ??
          (httpEvt as any)?.suspendReason ??
          providerSuspendedReason ??
          freezeReason,
        suspendReason:
          (e as any)?.suspendReason ??
          (e as any)?.suspended_reason ??
          (httpEvt as any)?.suspendReason ??
          (httpEvt as any)?.suspended_reason ??
          providerSuspendedReason ??
          freezeReason,
        suspended_markets: wsSuspendedMarkets ?? httpSuspendedMarkets ?? undefined,
        provider_suspended: providerSuspended,
        provider_suspended_reason: providerSuspendedReason,
        event_frozen: eventFrozen,
        freeze_reason: freezeReason,
        fixture: {
          ...((httpEvt as any)?.fixture || {}),
          ...((e as any)?.fixture || {}),
          status: {
            ...(((httpEvt as any)?.fixture?.status && typeof (httpEvt as any)?.fixture?.status === 'object') ? (httpEvt as any).fixture.status : {}),
            ...(((e as any)?.fixture?.status && typeof (e as any)?.fixture?.status === 'object') ? (e as any).fixture.status : {}),
            short: mergedStatus.short || (e as any)?.fixture?.status?.short || (httpEvt as any)?.fixture?.status?.short || '',
            long: mergedStatus.long || (e as any)?.fixture?.status?.long || (httpEvt as any)?.fixture?.status?.long || '',
            elapsed: pickElapsed((e as any)?.elapsed ?? (e as any)?.fixture?.status?.elapsed, (httpEvt as any)?.elapsed ?? (httpEvt as any)?.fixture?.status?.elapsed),
            timer: pickTimer((e as any)?.timer ?? (e as any)?.fixture?.status?.timer, (httpEvt as any)?.timer ?? (httpEvt as any)?.fixture?.status?.timer),
          },
        },
      } as Event;

      map.set(canonical, mergedEvt);
      indexAliases(canonical, mergedEvt);
    });

    return Array.from(map.values()).filter(e => {
        // FILTER: Remove fake events
        const h = (e.home_team || '').trim();
        const a = (e.away_team || '').trim();
        if (!h || !a || h === 'undefined' || a === 'undefined' || h === 'Home Team' || a === 'Away Team') return false;
        if (e.id === 'undefined' || !e.id) return false;
        const status = statusKeyOf(e);
        const isLiveLike =
          Number((e as any).is_live) === 1 ||
          isLiveStatusKey(status);
        if (isLiveLike && !hasAnyOdds(e) && !hasLiveSignal(e) && !isRecentLiveWindow(e)) return false;

        return true;
    }).sort((a, b) => {
      const aStatus = statusKeyOf(a);
      const bStatus = statusKeyOf(b);
      const aLive = Number((a as any).is_live) === 1 || isLiveStatusKey(aStatus);
      const bLive = Number((b as any).is_live) === 1 || isLiveStatusKey(bStatus);
      
      if (aLive && !bLive) return -1;
      if (!aLive && bLive) return 1;
      return new Date(a.event_date || 0).getTime() - new Date(b.event_date || 0).getTime();
    });
  }, [httpEvents, wsEvents]);

  return merged;
}
