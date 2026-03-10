
import { useMemo } from 'react';
import type { Event } from '../../shared/types';

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
    
    // Base: HTTP Events
    httpEvents.forEach(e => map.set(String(e.id), e));
    
    // Overlay: WS Events (Priority)
    wsEvents.forEach(e => {
      const httpEvt = map.get(String(e.id));
      
      const mergedEvt: Event = {
        ...(httpEvt || {}),
        ...e,
        // Preserve odds fields from HTTP if WS doesn't have them
        odds: (e.odds && Object.keys(e.odds).length > 0)
            ? e.odds
            : (httpEvt?.odds ?? {}),
        home_odd: (e as any).home_odd > 0 ? (e as any).home_odd : ((httpEvt as any)?.home_odd ?? 0),
        draw_odd: (e as any).draw_odd > 0 ? (e as any).draw_odd : ((httpEvt as any)?.draw_odd ?? 0),
        away_odd: (e as any).away_odd > 0 ? (e as any).away_odd : ((httpEvt as any)?.away_odd ?? 0),
        markets: (e as any).markets && Object.keys((e as any).markets).length > 0
            ? (e as any).markets
            : ((httpEvt as any)?.markets ?? {}),
      } as Event;

      map.set(String(e.id), mergedEvt);
    });

    return Array.from(map.values()).filter(e => {
        // FILTER: Remove fake events
        const h = (e.home_team || '').trim();
        const a = (e.away_team || '').trim();
        if (!h || !a || h === 'undefined' || a === 'undefined' || h === 'Home Team' || a === 'Away Team') return false;
        if (e.id === 'undefined' || !e.id) return false;
        return true;
    }).sort((a, b) => {
      const aLive = Number(a.is_live) === 1 || a.status === 'LIVE' || ['1H','2H','HT','ET','P'].includes(a.status || '');
      const bLive = Number(b.is_live) === 1 || b.status === 'LIVE' || ['1H','2H','HT','ET','P'].includes(b.status || '');
      
      if (aLive && !bLive) return -1;
      if (!aLive && bLive) return 1;
      return new Date(a.event_date || 0).getTime() - new Date(b.event_date || 0).getTime();
    });
  }, [httpEvents, wsEvents]);

  return merged;
}
