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

                // If live/finished, stricter check
                // But typically cache is pregame. 
                // Let's use the same 2.5h rule for pregame
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
      setUpcomingEvents(pregame);
      try {
        localStorage.setItem(CACHE_KEY, str);
      } catch { /* no-op */ }
    }
  }, [pregame]);

  return { upcomingEvents };
}
