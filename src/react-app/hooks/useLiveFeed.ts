import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
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

const parseLiveEvent = (item: any) => {
    if (!item.fixture || !item.teams) return null;

    // Safety: Hide Finished/Abnormal statuses from Live Feed
    const status = item.fixture?.status?.short || item.status;
    if (['FT', 'AET', 'PEN', 'Finished', 'Match Finished', 'AOT', 'AP', 'Ended', 'Final', 'WO', 'ABD', 'AWD'].includes(status)) {
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
    
    let h = item.home_odd;
    let d = item.draw_odd;
    let a = item.away_odd;

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

    const ev: any = {
        ...item,
        is_live: true,
        home_team: item.teams.home.name,
        away_team: item.teams.away.name,
        league: item.league?.name,
        league_name: item.league?.name,
        home_odd: h,
        draw_odd: d,
        away_odd: a,
        fixture: {
            ...item.fixture,
            status: item.fixture?.status || { short: 'LIVE', elapsed: 0 }
        },
        score: item.score || item.goals || { home: 0, away: 0 }
    };
    return ev;
};

export function useLiveFeed(sport?: string) {
  const [eventsMap, setEventsMap] = useState<Map<string, any>>(new Map());
  // const [isConnected, setIsConnected] = useState(true); // Always true for polling
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number>(Date.now());
  
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  // Poll function
  const fetchLiveEvents = useCallback(async () => {
      try {
          const url = `/api/events/by-sport?sports=${sport || 'all'}&include=odds`;
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
                          const id = String(parsed.fixture?.id || parsed.id);
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
    // Initial fetch
    fetchLiveEvents();
    
    pollingRef.current = setInterval(fetchLiveEvents, 5000);

    return () => {
      if (pollingRef.current) {
          clearInterval(pollingRef.current);
      }
    };
  }, [fetchLiveEvents]);

  // Convert Map to Array for rendering
  const liveEvents = useMemo(() => {
    return Array.from(eventsMap.values());
  }, [eventsMap]);

  return { 
    liveEvents, 
    events: liveEvents, 
    isConnected: true,
    lastUpdatedAt, 
    reconnect: fetchLiveEvents // Manual refresh
  };
}
