import { useState, useEffect } from 'react';
import type { Event } from '@/shared/types';

export function useUpcomingCache(pregame: Event[]) {
  const [upcomingEvents, setUpcomingEvents] = useState<Event[]>(pregame);

  useEffect(() => {
    setUpcomingEvents(Array.isArray(pregame) ? pregame : []);
  }, [pregame]);

  return { upcomingEvents };
}
