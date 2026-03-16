import { useState, useEffect, useRef } from 'react';
import { Event } from '../../shared/types';
import { apiFetch } from '../utils/api';

const normalizeTeam = (s: string) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const matchUID = (home: string, away: string, date: string | null | undefined) =>
  `${normalizeTeam(home)}-vs-${normalizeTeam(away)}-${String(date || '').slice(0, 10)}`;

const scoreEvent = (e: Event) =>
  (Number(e.home_odd || 0) > 0 ? 1 : 0) +
  (Number(e.draw_odd || 0) > 0 ? 1 : 0) +
  (Number(e.away_odd || 0) > 0 ? 1 : 0) +
  (Number(e.is_live || 0) === 1 ? 1 : 0);

  const isTodayAdjusted = (evt: Event): boolean => {
    // return true; // DEBUG: Show all events for now
    
    const raw = (evt.event_date || (evt as any).fixture?.date) as string | undefined;
    if (!raw) return true;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return true;
    
    const now = Date.now();
    
    let t = d.getTime();
    const diff = now - t;
    
    // If year mismatch (2025 vs 2026), adjust
    if (Math.abs(diff) > 300 * 24 * 60 * 60 * 1000) {
      const dAdj = new Date(d);
      dAdj.setFullYear(new Date(now).getFullYear());
      t = dAdj.getTime();
    }
    
    const fourteenDaysAhead = now + 14 * 24 * 60 * 60 * 1000;
    // Show events from 12h ago until 14 days ahead
    return t > now - 12 * 60 * 60 * 1000 && t <= fourteenDaysAhead;
  };

const dedupEvents = (list: Event[]): Event[] => {
  if (!list || list.length === 0) return [];
  const by = new Map<string, Event>();
  for (const e of list) {
    if (!e) continue;
    // Optimization: Use ID if available, otherwise fallback to complex key
    // Handle 'undefined' teams safely
    const home = e.home_team || (e.teams?.home?.name) || 'Home';
    const away = e.away_team || (e.teams?.away?.name) || 'Away';
    const date = e.event_date || (e.fixture?.date);
    
    const k = e.id ? String(e.id) : matchUID(String(home), String(away), String(date));
    
    const prev = by.get(k);
    if (!prev) {
      by.set(k, e);
      continue;
    }
    const sPrev = scoreEvent(prev);
    const sCur = scoreEvent(e);
    if (sCur > sPrev) by.set(k, e);
  }
  return Array.from(by.values());
};

const shouldHideEvent = (evt: Event) => {
  const h = Number((evt as any)?.home_odd || 0);
  const d = Number((evt as any)?.draw_odd || 0);
  const a = Number((evt as any)?.away_odd || 0);
  return !(h > 1.01 || d > 1.01 || a > 1.01);
};

export function useSportsEvents(category: string | null) {
  const [live, setLive] = useState<Event[]>([]);
  const [pregame, setPregame] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);

  const abortRef = useRef<AbortController | null>(null);
  const isFirstLoadRef = useRef(true);
  const lastLiveRef = useRef<Event[]>([]);
  const lastPregameRef = useRef<Event[]>([]);

  // Helper for deep equality check to prevent flickering
  const eq = (a: Event[], b: Event[]) => {
    if (a.length !== b.length) return false;
    const key = (e: Event) => e.id ? String(e.id) : matchUID(String(e.home_team||''), String(e.away_team||''), String(e.event_date||''));
    const mapA = new Map(a.map(e => [key(e), e]));
    for (const e of b) {
      const k = key(e);
      const x = mapA.get(k);
      if (!x) return false;
      if (
        Number(e.home_odd||0) !== Number(x.home_odd||0) ||
        Number(e.draw_odd||0) !== Number(x.draw_odd||0) ||
        Number(e.away_odd||0) !== Number(x.away_odd||0) ||
        e.is_live !== x.is_live ||
        (e.fixture?.status?.short || e.status) !== (x.fixture?.status?.short || x.status) ||
        Number(e.elapsed||0) !== Number((x as any).elapsed||0) ||
        String((e as any).score || '') !== String((x as any).score || '')
      ) return false;
    }
    return true;
  };

  const updateState = (newLive: Event[], newPregame: Event[]) => {
    if (!eq(newLive, lastLiveRef.current)) {
      setLive(newLive);
      lastLiveRef.current = newLive;
    }
    if (!eq(newPregame, lastPregameRef.current)) {
      setPregame(newPregame);
      lastPregameRef.current = newPregame;
    }
  };

  // Fallback para 'all' se category for nulo
  const safeCategory = category || 'all';

  useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;
    let isActive = true;

    if (isFirstLoadRef.current) {
      setLoading(true);
    }

    const fetchData = async () => {
      // Evita buscar dados se aba estiver oculta (exceto primeira carga)
      if (typeof document !== 'undefined' && document.hidden && !isFirstLoadRef.current) return;

      try {
        const params = new URLSearchParams();
        let rawSport = 'all';
        let sportParam = 'all';
        let leagueFilter = '';

        console.log('API BASE', import.meta.env.VITE_API_BASE);
        console.log('CATEGORY', category, 'SAFE', safeCategory);

        // Parse da categoria
        if (safeCategory && safeCategory !== 'all') {
          const token = safeCategory.toLowerCase();
          if (token.includes('|')) {
            const parts = token.split('|'); // sport|country|league
            rawSport = parts[0];
            if (parts.length >= 3) {
              leagueFilter = parts[2].toLowerCase().replace(/\s+/g, '-');
            }
          } else {
            rawSport = token;
          }
        } 
 
        // Normaliza nomes de esportes para chave API 
        if ( 
          rawSport.includes('futebol') || 
          rawSport.includes('soccer') || 
          rawSport.includes('liga') || 
          rawSport.includes('serie a') || 
          rawSport.includes('copa') || 
          rawSport.includes('seleções') 
        ) { 
          sportParam = 
            rawSport.includes('americano') || rawSport.includes('american') 
              ? 'american-football' 
              : 'soccer'; 
        } else if (rawSport.includes('basquete') || rawSport.includes('basketball') || rawSport.includes('nba')) { 
          sportParam = 'basketball'; 
        } else if (rawSport.includes('ténis') || rawSport.includes('tenis') || rawSport.includes('tennis')) { 
          sportParam = 'tennis'; 
        } else if (rawSport.includes('hóquei') || rawSport.includes('hockey') || rawSport.includes('nhl') || rawSport.includes('ice-hockey')) { 
          sportParam = 'ice-hockey'; 
        } else if (rawSport.includes('mma') || rawSport.includes('ufc')) { 
          sportParam = 'mma'; 
        } else if (rawSport.includes('fórmula') || rawSport.includes('formula')) { 
          sportParam = 'formula1'; 
        } else if (rawSport.includes('rugby') || rawSport.includes('rúgbi')) { 
          sportParam = 'rugby'; 
        } else if (rawSport.includes('voleibol') || rawSport.includes('volleyball')) { 
          sportParam = 'volleyball'; 
        } else if (rawSport.includes('beisebol') || rawSport.includes('baseball')) { 
          sportParam = 'baseball'; 
        } else if (rawSport.includes('handebol') || rawSport.includes('handball')) { 
          sportParam = 'handball'; 
        } else if (rawSport.includes('afl')) { 
          sportParam = 'afl'; 
        } else { 
          sportParam = rawSport === 'soccer-all' || rawSport === 'todos' ? 'soccer' : rawSport; 
        } 
 
        params.set('sports', sportParam); 
        if (leagueFilter) {
          // Backend faz LIKE, então passamos um fragmento “limpo” sem hífens artificiais
          const cleanLeague = leagueFilter.replace(/-+/g, ' ').replace(/\s+/g, ' ').trim();
          params.set('league', cleanLeague);
        }
        params.set('include', 'odds'); 
        params.set('realtime', '1');
        // params.set('_ts', Date.now().toString()); // Disabled for aggressive caching as requested
 
        const url = `/api/events/by-sport?${params.toString()}`;
        // console.log('FETCH URL', url);
        // Disable cache to ensure fresh data
        const data = await apiFetch<any>(url, { cache: 'no-store', signal: controller.signal });
        // console.log('API DATA RAW:', data);

        const liveCount = Array.isArray(data?.live) ? data.live.length : 0;
        const pregameCount = Array.isArray(data?.pregame) ? data.pregame.length : 0;

        /*
        console.log('[useSportsEvents] API Response:', { 
          liveCount, 
          pregameCount 
        });
        */

        if (!isActive) return; 

        const hasStructured = Array.isArray(data?.live) || Array.isArray(data?.pregame);
        const hasAnyStructured = liveCount > 0 || pregameCount > 0;

        // Só consideramos o formato estruturado se houver pelo menos 1 evento.
        // Caso venha { live: [], pregame: [] }, caímos para os fallbacks legados (/api/events, featured, etc).
        if (hasStructured && hasAnyStructured) { 
          const rawLive = (data.live || []) as Event[];
          const rawPregame = (data.pregame || []) as Event[];
          
          let liveEvents = dedupEvents(rawLive).filter(e => !shouldHideEvent(e));
          let pregameEvents = dedupEvents(rawPregame).filter(e => !shouldHideEvent(e));  

          // Fallback dev
          if (
            import.meta.env.DEV &&
            liveEvents.length === 0 &&
            pregameEvents.length === 0 &&
            (rawLive.length > 0 || rawPregame.length > 0)
          ) {
            liveEvents = dedupEvents(rawLive);
            pregameEvents = dedupEvents(rawPregame);
          }

          const isGameActive = (e: Event) => {
             const status = e.status;
             const s = (typeof status === 'object' && status !== null) ? (status as any).short : status;
             if (!s) return true;
             return !['FT', 'AET', 'PEN', 'PST', 'CANC', 'ABD', 'WO', 'AWARDED'].includes(s);
          };
          
          liveEvents = liveEvents.filter(isGameActive);
          pregameEvents = pregameEvents.filter(isGameActive);
          
          const filteredLive = liveEvents; 
          const maxPregame = safeCategory === 'all' ? 200 : 60;
          const filteredPregame = pregameEvents.filter(isTodayAdjusted).slice(0, maxPregame);
          
          const finalLive = filteredLive;
          const finalPregame = filteredPregame;

          updateState(finalLive, finalPregame);
          return; 
        } else if (Array.isArray(data) && data.length > 0) {
            // FLAT ARRAY FALLBACK (API returning simple list)
            const list = data as Event[];
            const liveEvents = list.filter(e => Number(e.is_live) === 1);
            const pregameEvents = list.filter(e => Number(e.is_live) !== 1);
            
            // Apply same filters
            const dedupedLive = dedupEvents(liveEvents).filter(e => !shouldHideEvent(e));
            const dedupedPregame = dedupEvents(pregameEvents).filter(e => !shouldHideEvent(e));
            
            const isGameActive = (e: Event) => {
                const status = e.status;
                const s = (typeof status === 'object' && status !== null) ? (status as any).short : status;
                if (!s) return true;
                return !['FT', 'AET', 'PEN', 'PST', 'CANC', 'ABD', 'WO', 'AWARDED'].includes(s);
            };

            const activeLive = dedupedLive.filter(isGameActive);
            const activePregame = dedupedPregame.filter(isGameActive);

            const finalLive = activeLive;
            const finalPregame = activePregame.filter(isTodayAdjusted).slice(0, 60);

            updateState(finalLive, finalPregame);
            return;
        }
 
        updateState([], []);
        return;
      } catch (err: any) { 
        if (controller.signal.aborted) return; 
      } finally { 
        if (isActive) { 
          setLoading(false); 
          isFirstLoadRef.current = false; 
        } 
      } 
    }; 
 
    // Initial fetch
    fetchData();

    const intervalTime = 5000;
    let timeoutId: NodeJS.Timeout;

    const scheduleNext = () => {
      timeoutId = setTimeout(() => {
        if (isActive && !document.hidden) {
          fetchData().finally(scheduleNext);
        } else if (isActive) {
          // If hidden, check again in 3s (but don't fetch)
          scheduleNext();
        }
      }, intervalTime);
    };

    // Start loop
    scheduleNext();

    return () => {
      isActive = false;
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, [category, safeCategory]); 
 
  return { live, pregame, loading }; 
}
