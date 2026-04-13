import { useState, useEffect, useRef } from 'react';
import type { Event } from '@/shared/types';

const CACHE_KEY = 'home:pregame:v2';

export function useUpcomingCache(pregame: Event[]) {
  const [upcomingEvents, setUpcomingEvents] = useState<Event[]>([]);
  const pregameLastRef = useRef<string>('');

  useEffect(() => {
    // try { localStorage.removeItem(CACHE_KEY); } catch { /* empty */ }
  }, []);

  // Load from cache on mount with filtering
  useEffect(() => {
    // Only load from cache if we don't have fresh data yet
    if (pregame.length > 0) return;

    try {
      const cachedStr = localStorage.getItem(CACHE_KEY);
      if (cachedStr) {
        const cached = JSON.parse(cachedStr) as Event[];
        const now = Date.now();
        
        // Filter out past events from cache
        const validCached = cached.filter(evt => {
            const dstr = evt.event_date || evt.fixture?.date;
            const d = dstr ? new Date(dstr) : null;
            
            if (d && !Number.isNaN(d.getTime())) {
                const diff = now - d.getTime();
                const isYearOff = diff > 300 * 24 * 60 * 60 * 1000;
                let targetTime = d.getTime();

                if (isYearOff) {
                     const dYearAdj = new Date(d);
                     dYearAdj.setFullYear(new Date(now).getFullYear());
                     targetTime = dYearAdj.getTime();
                }

                // Filter out events that already started (likely live now)
                if (targetTime < now - 5 * 60 * 1000) {
                    return false;
                }

                // Also remove events more than 2.5h past start
                if (targetTime < now - 2.5 * 60 * 60 * 1000) {
                    return false;
                }
            }
            return true;
        });

        if (validCached.length > 0) {
            setUpcomingEvents(validCached);
        }
      }
    } catch { /* no-op */ }
  }, [pregame.length]);

  // Update state and cache when fresh data arrives
  useEffect(() => {
    if (pregame.length === 0) return;

    const str = JSON.stringify(pregame);
    if (pregameLastRef.current !== str) {
      pregameLastRef.current = str;
      const LIVE_LIKE = new Set([
        '1H','2H','ET','P','BT','HT','LIVE','IN_PLAY','inprogress','live','INPROGRESS',
        'Q1','Q2','Q3','Q4','OT','P1','P2','P3','PO',
        'S1','S2','S3','S4','S5','H1','H2',
        'IN PLAY','IN-PLAY','PLAYING','STARTED',
      ]);
      const now = Date.now();
      const fresh = pregame.filter(evt => {
        const st = String((evt as any).status || '').trim();
        if (LIVE_LIKE.has(st) || LIVE_LIKE.has(st.toUpperCase())) return false;
        if (Number((evt as any).is_live) === 1) return false;
        const dstr = evt.event_date || (evt as any).fixture?.date;
        if (dstr) {
          const d = new Date(dstr);
          if (!Number.isNaN(d.getTime()) && d.getTime() < now - 5 * 60 * 1000) return false;
        }
        return true;
      });
      setUpcomingEvents(fresh);
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(fresh));
      } catch { /* no-op */ }
    }
  }, [pregame]);

  return { upcomingEvents };
}
