import { useEffect, useState, useCallback, useMemo } from 'react';
import { apiFetch } from '../utils/api';

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

const parseLiveEvent = (item: any) => {
    if (!item) return null;

    // Safety: Hide Finished/Abnormal statuses from Live Feed
    const status = String(item.fixture?.status?.short || item.status?.short || item.status || '').toUpperCase().trim();
    if (['FT', 'AET', 'PEN', 'FT_PEN', 'FIN', 'FINAL', 'ENDED', 'AOT', 'AP', 'POST', 'SUSP', 'TBD', 'WO', 'ABD', 'AWD', 'CANC', 'NS_CANC'].includes(status)) {
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
                     return null;
                 }
             } else {
                 if (d.getTime() < now - 5 * 60 * 60 * 1000) {
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

    if (!teams || !teams.home?.name || !teams.away?.name) return null;

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
    return ev;
};

export function useLiveFeed(sport?: string) {
  const [eventsMap, setEventsMap] = useState<Map<string, any>>(new Map());
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number>(Date.now());

  const wsUrl = useMemo(() => {
    const rawBase = String((import.meta as any)?.env?.VITE_API_BASE || '').trim();
    const sportParam = encodeURIComponent(String(sport || 'all'));
    if (rawBase && /^https?:\/\//i.test(rawBase)) {
      const u = rawBase.replace(/\/+$/, '');
      const proto = u.startsWith('https://') ? 'wss://' : 'ws://';
      const host = u.replace(/^https?:\/\//i, '');
      return `${proto}${host}/api/live/ws?sport=${sportParam}`;
    }
    if (typeof window !== 'undefined') {
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      return `${proto}://${window.location.host}/api/live/ws?sport=${sportParam}`;
    }
    return '';
  }, [sport]);

  // Poll function
  const fetchLiveEvents = useCallback(async () => {
      try {
          const url = `/api/events/by-sport?sports=${sport || 'all'}&realtime=1`;
          const data = await apiFetch<any>(url, { cache: 'no-store' });
          
          if (data && Array.isArray(data.live)) {
              setEventsMap(() => {
                  const next = new Map<string, any>();
                  // Rebuild map from scratch to ensure freshness, 
                  // but we could merge if we wanted to keep some state.
                  // For now, replacing is safer to remove stale events.
                  
                  data.live.forEach((raw: any) => {
                      const parsed = parseLiveEvent(raw);
                      if (parsed) {
                          const id = String(parsed.id || parsed.external_event_id || parsed.fixture?.id);
                          next.set(id, parsed);
                      }
                  });
                  return next;
              });
              setLastUpdatedAt(Date.now());
          }
      } catch (err) {
          console.error('[useLiveFeed] Polling error:', err);
          // Don't disconnect, just retry next time
      }
  }, [sport]);

  useEffect(() => {
    let cancelled = false;
    let inflight = false;
    let timeoutId: NodeJS.Timeout | null = null;
    let ws: WebSocket | null = null;
    let wsOk = false;

    const loop = async () => {
      if (cancelled) return;
      if (wsOk) return;
      if (inflight) {
        timeoutId = setTimeout(loop, 1500);
        return;
      }
      inflight = true;
      try {
        await fetchLiveEvents();
      } finally {
        inflight = false;
        timeoutId = setTimeout(loop, 10_000);
      }
    };

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
      };
      ws.onclose = () => {
        wsOk = false;
        setIsConnected(false);
        loop();
      };
      ws.onerror = () => {
        wsOk = false;
        setIsConnected(false);
        loop();
      };
      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(String((evt as any)?.data || ''));
          if (msg?.type === 'snapshot' && Array.isArray(msg?.live)) {
            setEventsMap(() => {
              const next = new Map<string, any>();
              msg.live.forEach((raw: any) => {
                const parsed = parseLiveEvent(raw);
                if (parsed) {
                  const id = String(parsed.id || parsed.external_event_id || parsed.fixture?.id);
                  next.set(id, parsed);
                }
              });
              return next;
            });
            setLastUpdatedAt(Date.now());
            return;
          }
          if (msg?.type === 'pong') return;
        } catch { void 0; }
      };
    };

    startWs();
    loop();

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
      if (ws) {
        try { ws.close(); } catch { void 0; }
        ws = null;
      }
    };
  }, [fetchLiveEvents, wsUrl]);

  // Convert Map to Array for rendering
  const liveEvents = useMemo(() => {
    return Array.from(eventsMap.values());
  }, [eventsMap]);

  return { 
    liveEvents, 
    events: liveEvents, 
    isConnected,
    lastUpdatedAt, 
    reconnect: fetchLiveEvents // Manual refresh
  };
}
