import { useEffect, useState, useCallback, useMemo, startTransition } from 'react';
import { apiFetch } from '../utils/api';

const __DBG_URL = (import.meta.env.DEV && (import.meta as any).env?.VITE_DEBUG_SERVER_URL)
  ? String((import.meta as any).env.VITE_DEBUG_SERVER_URL)
  : '';
const __DBG_SESSION = (import.meta.env.DEV && (import.meta as any).env?.VITE_DEBUG_SESSION)
  ? String((import.meta as any).env.VITE_DEBUG_SESSION)
  : '';
const __dbg = (hypothesisId: string, msg: string, data: any) => {
  try {
    if (!__DBG_URL || !__DBG_SESSION) return;
    fetch(__DBG_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: __DBG_SESSION, runId: 'pre', hypothesisId, location: 'src/react-app/hooks/useLiveFeed.ts', msg, data, ts: Date.now() }),
    }).catch(() => null);
  } catch {
    void 0;
  }
};

// Helper for robust outcome matching
const getOutcome = (outcomes: any[], keys: string[]) => 
    outcomes.find(o => 
      keys.includes(String(o.id).toLowerCase()) || 
      keys.includes(String(o.name).toLowerCase()) ||
      keys.includes(String(o.outcome).toLowerCase()) ||
      keys.includes(String(o.id)) || 
      keys.includes(String(o.name)) ||
      keys.includes(String(o.outcome))
    );

const getVal = (o: any) => {
    if (!o) return undefined;
    return o.price ?? o.value ?? o.odd;
};

const parseJsonLoose = (v: any) => {
    if (v === null || v === undefined) return v;
    if (typeof v !== 'string') return v;
    const s = v.trim();
    if (!s) return undefined;
    if (!((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']')))) return v;
    try {
        const j = JSON.parse(s);
        if (typeof j === 'string') {
            const s2 = j.trim();
            if ((s2.startsWith('{') && s2.endsWith('}')) || (s2.startsWith('[') && s2.endsWith(']'))) {
                try { return JSON.parse(s2); } catch { return j; }
            }
        }
        return j;
    } catch {
        return v;
    }
};

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

const mergeLiveScore = (prevScore: any, nextScore: any) => {
  const prevObj = parseScoreObject(prevScore);
  const nextObj = parseScoreObject(nextScore);
  if (prevObj && nextObj) {
    return {
      ...prevObj,
      ...nextObj,
      sets: {
        ...((prevObj.sets && typeof prevObj.sets === 'object') ? prevObj.sets : {}),
        ...((nextObj.sets && typeof nextObj.sets === 'object') ? nextObj.sets : {}),
      },
      point: {
        ...((prevObj.point && typeof prevObj.point === 'object') ? prevObj.point : {}),
        ...((nextObj.point && typeof nextObj.point === 'object') ? nextObj.point : {}),
      },
    };
  }
  return nextScore ?? prevScore;
};

const getRawLiveEventId = (item: any) =>
  String(item?.external_event_id || item?.id || item?.fixture?.id || '').trim();

const normalizeLiveStatus = (value: any) =>
  String(value || '')
    .toUpperCase()
    .trim()
    .replace(/[^A-Z0-9_]+/g, '');

const isFinishedLiveStatus = (value: any) => {
  const status = normalizeLiveStatus(value);
  if (!status) return false;
  return (
    status === 'FT' ||
    status.startsWith('FT') ||
    status === 'AET' ||
    status === 'PEN' ||
    status === 'FT_PEN' ||
    status === 'FTPEN' ||
    status === 'FIN' ||
    status === 'FINAL' ||
    status === 'ENDED' ||
    status === 'AOT' ||
    status === 'AP' ||
    status === 'POST' ||
    status === 'SUSP' ||
    status === 'TBD' ||
    status === 'WO' ||
    status === 'ABD' ||
    status === 'AWD' ||
    status === 'CANC' ||
    status === 'NS_CANC' ||
    /MATCHFINISHED|FULLTIME|GAMEOVER|ENCERRAD|TERMINAD/.test(status)
  );
};

const incidentTimeKey = (inc: any, idx: number) => {
  const minute = Number(inc?.minute ?? 0) || 0;
  const added = Number(inc?.addedTime ?? inc?.added_time ?? 0) || 0;
  return minute * 1000 + added * 10 + (idx % 10);
};

const mergeCriticalIncidents = (prevList: any, incomingList: any) => {
  const source = Array.isArray(prevList) ? prevList : [];
  const incoming = Array.isArray(incomingList) ? incomingList : [];
  const byKey = new Map<string, any>();
  source.forEach((inc, idx) => {
    const key = [
      String(inc?.id ?? ''),
      String(inc?.type ?? ''),
      String(inc?.minute ?? ''),
      String(inc?.addedTime ?? inc?.added_time ?? ''),
      String(inc?.description ?? ''),
      String(idx),
    ].join('|');
    byKey.set(key, inc);
  });
  incoming.forEach((inc, idx) => {
    const key = [
      String(inc?.id ?? ''),
      String(inc?.type ?? ''),
      String(inc?.minute ?? ''),
      String(inc?.addedTime ?? inc?.added_time ?? ''),
      String(inc?.description ?? ''),
      String(idx),
    ].join('|');
    byKey.set(key, inc);
  });
  return Array.from(byKey.values())
    .sort((a, b) => incidentTimeKey(a, 0) - incidentTimeKey(b, 0))
    .slice(-12);
};

const parseLiveEvent = (item: any) => {
    if (!item) return null;
    const rawId = getRawLiveEventId(item);

    // Safety: Hide Finished/Abnormal statuses from Live Feed
    const status = item.fixture?.status?.short || item.status?.short || item.status || item.fixture?.status?.long;
    if (isFinishedLiveStatus(status)) {
        __dbg('H5', 'drop-finished', { id: rawId, status });
        return null;
    }
    
    // Safety: Filter out "Live" events that are actually old (> 5h)
    const dstr = item.event_date || item.fixture?.date;
    if (dstr) {
        const d = new Date(dstr);
        const now = Date.now();
        if (!Number.isNaN(d.getTime())) {
             const diff = now - d.getTime();
             const isYearOff = diff > 300 * 24 * 60 * 60 * 1000;
             if (isYearOff) {
                 const dYearAdj = new Date(d);
                 dYearAdj.setFullYear(new Date(now).getFullYear());
                 if (dYearAdj.getTime() < now - 5 * 60 * 60 * 1000) {
                     __dbg('H5', 'drop-old-year-adjusted', { id: rawId, dstr: String(dstr || ''), now });
                     return null;
                 }
             } else {
                 if (d.getTime() < now - 5 * 60 * 60 * 1000) {
                     __dbg('H5', 'drop-old', { id: rawId, dstr: String(dstr || ''), now });
                     return null;
                 }
             }
        }
    }
    
    const teams =
      item.teams ||
      (item.home && item.away
        ? { home: { name: item.home.name, logo: item.home.logo }, away: { name: item.away.name, logo: item.away.logo } }
        : (item.home_team && item.away_team
          ? {
              home: { name: item.home_team, logo: item.home_team_logo || '' },
              away: { name: item.away_team, logo: item.away_team_logo || '' }
            }
          : null));
    const fixture =
      item.fixture ||
      {
        id: item.external_event_id || item.id,
        date: item.event_date || item.date,
        status: item.status && typeof item.status === 'object' ? item.status : { short: item.status || 'LIVE', elapsed: item.elapsed || 0, timer: item.timer || '' },
      };

    if (!teams || !teams.home?.name || !teams.away?.name) {
      __dbg('H3', 'drop-no-teams', { id: rawId, home: String(item.home_team || item.teams?.home?.name || ''), away: String(item.away_team || item.teams?.away?.name || '') });
      return null;
    }

    let h = item.home_odd;
    let d = item.draw_odd;
    let a = item.away_odd;

    const sportRaw = String(item.sport || '');
    const sportL = sportRaw.toLowerCase();
    const isSoccer = sportL.includes('soccer') || (sportL.includes('football') && !sportL.includes('american'));

    // Handle odds array (backend <-> frontend mismatch fix)
    let oddsObj = item.odds;
    if (Array.isArray(oddsObj)) {
        // Convert to object
        const newOdds: any = {};
        oddsObj.forEach((m: any) => {
            if (m.key) newOdds[m.key] = m;
        });
        oddsObj = newOdds;
        item.odds = oddsObj;
    }

    const marketsRaw = item.markets ?? item.odds;
    const markets = parseJsonLoose(marketsRaw);

    if ((!h || !d || !a) && oddsObj) {
        const marketKey = Object.keys(oddsObj).find(k => 
            k === '1x2' || k === 'h2h' || k === 'match_winner' || k === 'FT_1X2'
        );
        
        if (marketKey) {
            let outcomes = oddsObj[marketKey];
            // Handle both { outcomes: [...] } and [...] formats
            if (!Array.isArray(outcomes) && outcomes?.outcomes) {
                outcomes = outcomes.outcomes;
            }
            
            if (Array.isArray(outcomes)) {
                const hName = (item.home_team || item.teams?.home?.name || '').toLowerCase();
                const aName = (item.away_team || item.teams?.away?.name || '').toLowerCase();
                
                const home = getOutcome(outcomes, ['1', 'home', 'casa', hName].filter(k => k && k.length > 1));
                const draw = getOutcome(outcomes, ['x', 'draw', 'empate']);
                const away = getOutcome(outcomes, ['2', 'away', 'fora', aName].filter(k => k && k.length > 1));
                
                if (home) h = getVal(home);
                if (draw) d = getVal(draw);
                if (away) a = getVal(away);
            }
        }
    }

    const parseScore = (v: any) => {
        if (v === null || v === undefined) return { home: null, away: null };
        if (typeof v === 'string') {
            const s = v.trim();
            if (!s) return { home: null, away: null };
            if (s.includes('{') || s.includes(':')) {
                try {
                    const j = JSON.parse(s);
                    const hn = Number(j?.home);
                    const an = Number(j?.away);
                    return {
                        home: Number.isFinite(hn) ? hn : null,
                        away: Number.isFinite(an) ? an : null
                    };
                } catch {
                    return { home: null, away: null };
                }
            }
            const m = s.match(/(\d+)\s*[-:]\s*(\d+)/);
            if (m) {
                const home = Number(m[1]);
                const awayStr = String(m[2] || '').trim();
                let away = Number(awayStr);
                if (isSoccer && Number.isFinite(home) && awayStr.length >= 3 && Number.isFinite(away) && away > 9) {
                    const mins = [2, 3];
                    for (const minLen of mins) {
                        if (awayStr.length <= minLen) continue;
                        const awayPart = awayStr.slice(0, -minLen);
                        const minPart = awayStr.slice(-minLen);
                        const awayN = Number(awayPart);
                        const minN = Number(minPart);
                        if (!Number.isFinite(awayN) || !Number.isFinite(minN)) continue;
                        if (awayN < 0 || awayN > 9) continue;
                        if (minLen === 2 && minN > 99) continue;
                        if (minLen === 3 && minN < 100) continue;
                        if (minN < 0 || minN > 130) continue;
                        away = awayN;
                        break;
                    }
                }
                return { home: Number.isFinite(home) ? home : null, away: Number.isFinite(away) ? away : null };
            }
            return { home: null, away: null };
        }
        if (typeof v === 'object') {
            const hn = Number((v as any)?.home);
            const an = Number((v as any)?.away);
            return { home: Number.isFinite(hn) ? hn : null, away: Number.isFinite(an) ? an : null };
        }
        return { home: null, away: null };
    };

    const rawScore = item.score ?? item.goals;
    const scoreObj = parseScore(rawScore);

    const ev: any = {
        ...item,
        id: String(item.external_event_id || item.id || fixture.id || ''),
        external_event_id: String(item.external_event_id || item.id || fixture.id || ''),
        is_live: Number(item.is_live || 1) === 1,
        home_team: teams.home.name,
        away_team: teams.away.name,
        league: item.league?.name || item.league || '',
        league_name: item.league?.name || item.league || '',
        home_odd: Number(h || 0),
        draw_odd: Number(d || 0),
        away_odd: Number(a || 0),
        fixture: {
            ...fixture,
            status: fixture?.status || { short: 'LIVE', elapsed: 0, timer: '' }
        },
        teams,
        score: rawScore,
        goals: scoreObj,
        markets: markets
    };
    const st = String(ev.fixture?.status?.short || '').toUpperCase().trim();
    const stLong = String(ev.fixture?.status?.long || ev.status_long || '').toUpperCase();
    if (st === 'HT' || /HALF\s*TIME|INTERVAL/.test(stLong)) {
      ev.fixture.status = { ...(ev.fixture.status || {}), short: 'HT', elapsed: 0, timer: '' };
      ev.timer = '';
      ev.elapsed = 0;
    }
    return ev;
};

// ── Module-level live-feed cache ──────────────────────────────────────────────
// Keyed by sport string. Survives remounts so /live → / → /live is instant.
const _liveCache = new Map<string, { map: Map<string, any>; ts: number }>();
const _LIVE_FRESH_MS = 1_000;
const _EMPTY_FEED_GRACE_MS = 75_000;

const retainRecentLiveEvents = (prev: Map<string, any>, now: number, graceMs: number) => {
  const next = new Map<string, any>(prev);
  for (const [id, ev] of next.entries()) {
    const lastSeen = Number((ev as any)?.__lastSeenAt || 0);
    const statusShort = (ev as any)?.fixture?.status?.short || (ev as any)?.status_short || (ev as any)?.status;
    const statusLong = (ev as any)?.fixture?.status?.long || (ev as any)?.status_long;
    if (isFinishedLiveStatus(statusShort) || isFinishedLiveStatus(statusLong)) {
      next.delete(id);
      continue;
    }
    if (!lastSeen || now - lastSeen > graceMs) {
      next.delete(id);
    }
  }
  return next;
};
// ─────────────────────────────────────────────────────────────────────────────

export function useLiveFeed(sport?: string) {
  const _sportKey = sport || 'all';
  const _lEntry = _liveCache.get(_sportKey);
  const _lFresh = _lEntry != null && Date.now() - _lEntry.ts < _LIVE_FRESH_MS;

  const [eventsMap, setEventsMap] = useState<Map<string, any>>(() =>
    _lFresh ? new Map(_lEntry!.map) : new Map()
  );
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number>(Date.now());
  // True once the feed has produced its first response (poll or WS snapshot),
  // even if empty — lets consumers know the live source has settled.
  const [hasLoaded, setHasLoaded] = useState(_lFresh);

  const wsUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${window.location.host}/api/live/ws?sport=${encodeURIComponent(String(sport || 'all'))}`;
  }, [sport]);

  // Poll function
  const fetchLiveEvents = useCallback(async () => {
      try {
          const url = `/api/events/by-sport?sports=${sport || 'all'}&realtime=1&only=live&days=0`;
          const data = await apiFetch<any>(url, { cache: 'no-store' });
          
          const list = Array.isArray(data) ? data : (data && Array.isArray(data.live) ? data.live : null);
          if (!list) return;
          setHasLoaded(true);
          if (list.length === 0) {
            __dbg('H2', 'poll-empty', { sport: String(sport || 'all') });
            const now = Date.now();
            startTransition(() => setEventsMap((prev) => {
              const next = retainRecentLiveEvents(prev, now, _EMPTY_FEED_GRACE_MS);
              _liveCache.set(_sportKey, { map: next, ts: now });
              return next;
            }));
            setLastUpdatedAt(now);
            return;
          }
          __dbg('H2', 'poll-data', { sport: String(sport || 'all'), count: list.length });

          const now = Date.now();
          const graceMs = 30_000;
          startTransition(() => setEventsMap((prev) => {
              const next = new Map<string, any>(prev);
              const seen = new Set<string>();
              const dropped = new Set<string>();

              list.forEach((raw: any) => {
                  const parsed = parseLiveEvent(raw);
                  if (parsed) {
                      const id = String(parsed.id || parsed.external_event_id || parsed.fixture?.id);
                      if (!id) return;
                      const prevVal = next.get(id);
                      const merged = { ...(prevVal || {}), ...parsed, __lastSeenAt: now };
                      merged.score = mergeLiveScore((prevVal as any)?.score, (parsed as any)?.score);
                      const pn = Number((parsed as any)?.home_odd || 0);
                      const qn = Number((parsed as any)?.draw_odd || 0);
                      const rn = Number((parsed as any)?.away_odd || 0);
                      const ph = Number((prevVal as any)?.home_odd || 0);
                      const qh = Number((prevVal as any)?.draw_odd || 0);
                      const rh = Number((prevVal as any)?.away_odd || 0);
                      if (pn <= 1 && ph > 1) merged.home_odd = ph;
                      if (qn <= 1 && qh > 1) merged.draw_odd = qh;
                      if (rn <= 1 && rh > 1) merged.away_odd = rh;
                      const mkEmpty = (m: any) => {
                        if (!m) return true;
                        if (typeof m === 'string') {
                          const s = m.trim();
                          return !s || s === '{}' || s === 'null' || s === '[]';
                        }
                        if (typeof m === 'object') {
                          if (Array.isArray(m)) return m.length === 0;
                          return Object.keys(m).length === 0;
                        }
                        return true;
                      };
                      if (mkEmpty((parsed as any).markets) && !mkEmpty((prevVal as any)?.markets)) {
                        merged.markets = (prevVal as any).markets;
                      }
                      next.set(id, merged);
                      seen.add(id);
                  } else {
                      const rawId = getRawLiveEventId(raw);
                      if (rawId) dropped.add(rawId);
                  }
              });

              for (const id of dropped) next.delete(id);
              for (const [id, ev] of next.entries()) {
                  const lastSeen = Number((ev as any)?.__lastSeenAt || 0);
                  if (dropped.has(id)) {
                    next.delete(id);
                    continue;
                  }
                  if (!seen.has(id) && lastSeen && now - lastSeen > graceMs) {
                    next.delete(id);
                    continue;
                  }
                  const statusShort = (ev as any)?.fixture?.status?.short || (ev as any)?.status_short || (ev as any)?.status;
                  const statusLong = (ev as any)?.fixture?.status?.long || (ev as any)?.status_long;
                  if (isFinishedLiveStatus(statusShort) || isFinishedLiveStatus(statusLong)) {
                    next.delete(id);
                    continue;
                  }
                  if (now - lastSeen > graceMs) next.delete(id);
              }
              _liveCache.set(_sportKey, { map: next, ts: now });
              return next;
          }));
          setLastUpdatedAt(now);
      } catch (err) {
          console.error('[useLiveFeed] Polling error:', err);
          // Don't disconnect, just retry next time
      }
  }, [sport]);

  useEffect(() => {
    let cancelled = false;
    let inflight = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let ws: WebSocket | null = null;
    let wsOk = false;
    let pingId: ReturnType<typeof setInterval> | null = null;
    let missingDeltaRefreshAt = 0;
    const idleMs = 60_000;
    let lastInteractionAt = Date.now();
    let hiddenAt = typeof document !== 'undefined' && document.hidden ? Date.now() : 0;
    let wakeInFlight = false;
    const log = (hypothesisId: string, msg: string, data: any) => {
      __dbg(hypothesisId, msg, data);
    };

    const loop = async () => {
      if (cancelled) return;
      if (wsOk) return;
      const sportKey = String(sport || 'all').toLowerCase();
      const fallbackMs =
        sportKey === 'tennis'
          ? 1200
          : sportKey === 'soccer' || sportKey === 'football' || sportKey === 'futebol' || sportKey === 'all'
            ? 1500
            : 2500;
      if (inflight) {
        timeoutId = setTimeout(loop, fallbackMs);
        return;
      }
      inflight = true;
      try {
        log('A', 'poll tick (ws not ok)', { sport: String(sport || 'all') });
        await fetchLiveEvents();
      } finally {
        inflight = false;
        timeoutId = setTimeout(loop, fallbackMs);
      }
    };

    const runWakeRefresh = () => {
      if (cancelled) return;
      if (typeof document !== 'undefined' && document.hidden) return;
      if (wakeInFlight) return;
      wakeInFlight = true;
      fetchLiveEvents()
        .catch(() => void 0)
        .finally(() => {
          wakeInFlight = false;
        });
    };

    const onVisibilityChange = () => {
      if (typeof document === 'undefined') return;
      if (document.hidden) {
        hiddenAt = Date.now();
        return;
      }
      const now = Date.now();
      const idleFor = hiddenAt > 0 ? now - hiddenAt : now - lastInteractionAt;
      hiddenAt = 0;
      lastInteractionAt = now;
      if (idleFor >= 3000) runWakeRefresh();
    };

    const onActivity = () => {
      const now = Date.now();
      const idleFor = now - lastInteractionAt;
      lastInteractionAt = now;
      if (idleFor >= idleMs) runWakeRefresh();
    };
    const onFocus = () => onActivity();

    const startWs = () => {
      if (!wsUrl || typeof WebSocket === 'undefined') return;
      try {
        ws = new WebSocket(wsUrl);
      } catch {
        ws = null;
        return;
      }

      ws.onopen = () => {
        wsOk = true;
        setIsConnected(true);
        __dbg('H1', 'ws-open', { url: wsUrl, sport: String(sport || 'all') });
        log('A', 'ws open', { url: wsUrl, sport: String(sport || 'all') });
        fetchLiveEvents().catch(() => void 0);
        if (pingId) clearInterval(pingId);
        pingId = setInterval(() => {
          try { ws?.send(JSON.stringify({ type: 'ping', ts: Date.now() })); } catch { void 0; }
        }, 15_000);
      };
      ws.onclose = () => {
        wsOk = false;
        setIsConnected(false);
        __dbg('H1', 'ws-close', { url: wsUrl, sport: String(sport || 'all') });
        log('A', 'ws close', { url: wsUrl, sport: String(sport || 'all') });
        if (pingId) { clearInterval(pingId); pingId = null; }
        loop();
      };
      ws.onerror = () => {
        wsOk = false;
        setIsConnected(false);
        __dbg('H1', 'ws-error', { url: wsUrl, sport: String(sport || 'all') });
        log('A', 'ws error', { url: wsUrl, sport: String(sport || 'all') });
        if (pingId) { clearInterval(pingId); pingId = null; }
        loop();
      };
      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(String((evt as any)?.data || ''));
          if (msg?.type === 'snapshot' && Array.isArray(msg?.live)) {
            const now = Date.now();
            const graceMs = 30_000;
            setHasLoaded(true);
            if (msg.live.length === 0) {
              __dbg('H1', 'ws-snapshot-empty', { sport: String(sport || 'all') });
              startTransition(() => setEventsMap((prev) => {
                const next = retainRecentLiveEvents(prev, now, _EMPTY_FEED_GRACE_MS);
                _liveCache.set(_sportKey, { map: next, ts: now });
                return next;
              }));
              setLastUpdatedAt(now);
              return;
            }
            __dbg('H1', 'ws-snapshot', { sport: String(sport || 'all'), count: msg.live.length });
            log('A', 'ws snapshot', { sport: String(sport || 'all'), count: msg.live.length });
            startTransition(() => setEventsMap((prev) => {
              const next = new Map<string, any>(prev);
              const seen = new Set<string>();
              const dropped = new Set<string>();
              msg.live.forEach((raw: any) => {
                const parsed = parseLiveEvent(raw);
                if (parsed) {
                  const id = String(parsed.id || parsed.external_event_id || parsed.fixture?.id);
                  if (!id) return;
                  const prevVal = next.get(id);
                  const merged = { ...(prevVal || {}), ...parsed, __lastSeenAt: now };
                  merged.score = mergeLiveScore((prevVal as any)?.score, (parsed as any)?.score);
                  const pn = Number((parsed as any)?.home_odd || 0);
                  const qn = Number((parsed as any)?.draw_odd || 0);
                  const rn = Number((parsed as any)?.away_odd || 0);
                  const ph = Number((prevVal as any)?.home_odd || 0);
                  const qh = Number((prevVal as any)?.draw_odd || 0);
                  const rh = Number((prevVal as any)?.away_odd || 0);
                  if (pn <= 1 && ph > 1) merged.home_odd = ph;
                  if (qn <= 1 && qh > 1) merged.draw_odd = qh;
                  if (rn <= 1 && rh > 1) merged.away_odd = rh;
                  const mkEmpty = (m: any) => {
                    if (!m) return true;
                    if (typeof m === 'string') {
                      const s = m.trim();
                      return !s || s === '{}' || s === 'null' || s === '[]';
                    }
                    if (typeof m === 'object') {
                      if (Array.isArray(m)) return m.length === 0;
                      return Object.keys(m).length === 0;
                    }
                    return true;
                  };
                  if (mkEmpty((parsed as any).markets) && !mkEmpty((prevVal as any)?.markets)) {
                    merged.markets = (prevVal as any).markets;
                  }
                  next.set(id, merged);
                  seen.add(id);
                } else {
                  const rawId = getRawLiveEventId(raw);
                  if (rawId) dropped.add(rawId);
                }
              });
              for (const id of dropped) next.delete(id);
              for (const [id, ev] of next.entries()) {
                const lastSeen = Number((ev as any)?.__lastSeenAt || 0);
                if (dropped.has(id)) {
                  next.delete(id);
                  continue;
                }
                if (!seen.has(id) && lastSeen && now - lastSeen > graceMs) {
                  next.delete(id);
                  continue;
                }
                const statusShort = (ev as any)?.fixture?.status?.short || (ev as any)?.status_short || (ev as any)?.status;
                const statusLong = (ev as any)?.fixture?.status?.long || (ev as any)?.status_long;
                if (isFinishedLiveStatus(statusShort) || isFinishedLiveStatus(statusLong)) {
                  next.delete(id);
                  continue;
                }
                if (now - lastSeen > graceMs) next.delete(id);
              }
              _liveCache.set(_sportKey, { map: next, ts: now });
              return next;
            }));
            setLastUpdatedAt(now);
            return;
          }
          if (msg?.type === 'update' && msg?.data?.id) {
            const now = Date.now();
            const delta = msg.data;
            setEventsMap((prev) => {
              const next = new Map<string, any>(prev);
              const id = String(delta.id);
              if (isFinishedLiveStatus(delta.status_short) || isFinishedLiveStatus(delta.status_long) || isFinishedLiveStatus(delta.status)) {
                next.delete(id);
                _liveCache.set(_sportKey, { map: next, ts: now });
                return next;
              }
              const prevVal = next.get(id);
              if (!prevVal) {
                const seeded = {
                  id,
                  external_event_id: id,
                  is_live: 1,
                  goals: delta.goals || { home: delta.score?.home ?? null, away: delta.score?.away ?? null },
                  score: delta.score && typeof delta.score === 'object' ? { ...delta.score } : undefined,
                  suspended: typeof delta.suspended === 'boolean' ? delta.suspended : undefined,
                  suspended_reason: delta.suspended_reason ?? delta.suspendReason ?? undefined,
                  suspendReason: delta.suspendReason ?? delta.suspended_reason ?? undefined,
                  suspended_markets: Array.isArray(delta.suspended_markets) ? delta.suspended_markets : undefined,
                  provider_suspended: typeof delta.provider_suspended === 'boolean' ? delta.provider_suspended : undefined,
                  provider_suspended_reason: delta.provider_suspended_reason ?? undefined,
                  event_frozen: typeof delta.event_frozen === 'boolean' ? delta.event_frozen : undefined,
                  freeze_reason: delta.freeze_reason ?? undefined,
                  status_short: delta.status_short || '',
                  status_long: delta.status_long || '',
                  elapsed: typeof delta.elapsed === 'number' ? delta.elapsed : 0,
                  timer: delta.timer || '',
                  fixture: {
                    status: {
                      short: delta.status_short || '',
                      long: delta.status_long || '',
                      elapsed: typeof delta.elapsed === 'number' ? delta.elapsed : 0,
                      timer: delta.timer || '',
                    },
                  },
                  markets: delta.markets || {},
                  __lastSeenAt: now,
                } as any;
                next.set(id, seeded);
                if (now - missingDeltaRefreshAt > 1000) {
                  missingDeltaRefreshAt = now;
                  fetchLiveEvents().catch(() => void 0);
                }
                _liveCache.set(_sportKey, { map: next, ts: now });
                return next;
              }

              const merged = { ...prevVal, __lastSeenAt: now };
              
              if (delta.goals) {
                merged.goals = delta.goals;
                // Atualizar o score string se necessário
                if (typeof merged.score === 'string') {
                  try {
                    const s = JSON.parse(merged.score);
                    s.home = delta.goals.home;
                    s.away = delta.goals.away;
                    merged.score = JSON.stringify(s);
                  } catch { void 0; }
                }
              }
              if (delta.score && typeof delta.score === 'object') {
                merged.score = mergeLiveScore(merged.score, delta.score);
                if (!delta.goals && (delta.score.home != null || delta.score.away != null)) {
                  merged.goals = {
                    home: delta.score.home ?? merged.goals?.home ?? null,
                    away: delta.score.away ?? merged.goals?.away ?? null,
                  };
                }
              }
              if (delta.status_short) {
                merged.status_short = delta.status_short;
                if (merged.fixture?.status) merged.fixture.status.short = delta.status_short;
              }
              if (delta.status_long) {
                merged.status_long = delta.status_long;
                if (merged.fixture?.status) merged.fixture.status.long = delta.status_long;
              }
              if (typeof delta.elapsed === 'number') {
                merged.elapsed = delta.elapsed;
                if (merged.fixture?.status) merged.fixture.status.elapsed = delta.elapsed;
              }
              if (typeof delta.timer === 'string') {
                merged.timer = delta.timer;
                if (merged.fixture?.status) merged.fixture.status.timer = delta.timer;
              }
              if (delta.home_odd != null && delta.home_odd > 0) merged.home_odd = Number(delta.home_odd);
              if (delta.draw_odd != null && delta.draw_odd > 0) merged.draw_odd = Number(delta.draw_odd);
              if (delta.away_odd != null && delta.away_odd > 0) merged.away_odd = Number(delta.away_odd);
              if (delta.markets) merged.markets = { ...(merged.markets || {}), ...delta.markets };
              if (typeof delta.suspended === 'boolean') merged.suspended = delta.suspended;
              if (delta.suspended_reason != null || delta.suspendReason != null) {
                const reason = String(delta.suspended_reason ?? delta.suspendReason ?? '').trim();
                merged.suspended_reason = reason || undefined;
                merged.suspendReason = reason || undefined;
              } else if (delta.event_frozen === false && merged.provider_suspended !== true) {
                merged.suspended_reason = undefined;
                merged.suspendReason = undefined;
              }
              if (typeof delta.provider_suspended === 'boolean') {
                merged.provider_suspended = delta.provider_suspended;
                if (!delta.provider_suspended && delta.provider_suspended_reason == null) {
                  merged.provider_suspended_reason = undefined;
                }
              }
              if (delta.provider_suspended_reason != null) {
                const providerReason = String(delta.provider_suspended_reason || '').trim();
                merged.provider_suspended_reason = providerReason || undefined;
              }
              if (Array.isArray(delta.suspended_markets)) merged.suspended_markets = delta.suspended_markets;
              if (typeof delta.event_frozen === 'boolean') {
                merged.event_frozen = delta.event_frozen;
                if (!delta.event_frozen && delta.freeze_reason == null) {
                  merged.freeze_reason = undefined;
                  if (delta.suspended == null && merged.provider_suspended !== true) merged.suspended = false;
                }
              }
              if (delta.freeze_reason != null) {
                const freezeReason = String(delta.freeze_reason || '').trim();
                merged.freeze_reason = freezeReason || undefined;
              }

              next.set(id, merged);
              _liveCache.set(_sportKey, { map: next, ts: now });
              return next;
            });
            setLastUpdatedAt(now);
            return;
          }
          if (msg?.type === 'incident' && msg?.data?.id) {
            const now = Date.now();
            const delta = msg.data;
            setEventsMap((prev) => {
              const next = new Map<string, any>(prev);
              const id = String(delta.id);
              const prevVal = next.get(id);
              const nextIncidents = mergeCriticalIncidents(
                (prevVal as any)?.events ?? (prevVal as any)?.fixture?.events,
                Array.isArray(delta.incidents) && delta.incidents.length > 0
                  ? delta.incidents
                  : delta.incident
                    ? [delta.incident]
                    : [],
              );
              const merged = {
                ...(prevVal || {}),
                id,
                external_event_id: (prevVal as any)?.external_event_id || id,
                is_live: 1,
                suspended_reason: String(delta.suspendReason || delta.suspended_reason || '').trim() || (prevVal as any)?.suspended_reason,
                suspendReason: String(delta.suspendReason || delta.suspended_reason || '').trim() || (prevVal as any)?.suspendReason,
                events: nextIncidents,
                fixture: {
                  ...((prevVal as any)?.fixture || {}),
                  events: nextIncidents,
                  status: {
                    ...((prevVal as any)?.fixture?.status || {}),
                  },
                },
                __lastSeenAt: now,
              } as any;
              next.set(id, merged);
              if (!prevVal && now - missingDeltaRefreshAt > 1000) {
                missingDeltaRefreshAt = now;
                fetchLiveEvents().catch(() => void 0);
              }
              _liveCache.set(_sportKey, { map: next, ts: now });
              return next;
            });
            setLastUpdatedAt(now);
            return;
          }
          if (msg?.type === 'pong') return;
        } catch { void 0; }
      };
    };

    startWs();
    loop();
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibilityChange);
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', onFocus);
      window.addEventListener('pointerdown', onActivity);
      window.addEventListener('keydown', onActivity);
      window.addEventListener('touchstart', onActivity);
      window.addEventListener('wheel', onActivity);
    }

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
      if (pingId) clearInterval(pingId);
      if (ws) {
        try { ws.close(); } catch { void 0; }
        ws = null;
      }
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibilityChange);
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', onFocus);
        window.removeEventListener('pointerdown', onActivity);
        window.removeEventListener('keydown', onActivity);
        window.removeEventListener('touchstart', onActivity);
        window.removeEventListener('wheel', onActivity);
      }
    };
  }, [fetchLiveEvents, wsUrl]);

  const liveEvents = useMemo(() => {
    return Array.from(eventsMap.values());
  }, [eventsMap]);

  return { 
    liveEvents, 
    events: liveEvents, 
    isConnected,
    hasLoaded,
    lastUpdatedAt, 
    reconnect: fetchLiveEvents // Manual refresh
  };
}
