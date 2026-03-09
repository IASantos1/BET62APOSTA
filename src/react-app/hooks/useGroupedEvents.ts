import { useMemo } from 'react';
import type { Event } from '@/shared/types';

export function useGroupedEvents(events: Event[], query: string) {
    // 1. Filter
    const filtered = useMemo(() => {
        if (!query) return events;
        const q = query.toLowerCase();
        return events.filter(e => 
            e.match.toLowerCase().includes(q) || 
            e.league.toLowerCase().includes(q) ||
            e.home_team.toLowerCase().includes(q) ||
            e.away_team.toLowerCase().includes(q)
        );
    }, [events, query]);

    // 2. Group & Sort
    const grouped = useMemo(() => {
        const g: Record<string, Event[]> = {};
        for (const e of filtered) {
            const k = e.league;
            if (!g[k]) g[k] = [];
            g[k].push(e);
        }

        return Object.entries(g).sort((a, b) => {
            const prio = (s: string) => {
                const l = s.toLowerCase();
                // User Request: Prioritize UEFA Champions League & Europa League
                if (l.includes('uefa champions') || l.includes('champions league')) return 20;
                if (l.includes('uefa europa') || l.includes('europa league')) return 19;
                
                if (l.includes('serie a') || l.includes('brasileir')) return 10;
                if (l.includes('premier league')) return 9;
                if (l.includes('la liga')) return 7;
                if (l.includes('bundesliga')) return 7;
                if (l.includes('ligue 1')) return 6;
                return 1;
            };
            return prio(b[0]) - prio(a[0]);
        });
    }, [filtered]);

    return grouped;
}
