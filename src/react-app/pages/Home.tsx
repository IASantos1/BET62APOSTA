import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '@/react-app/contexts/AppContext';
import { useSportsEvents } from '@/react-app/hooks/useSportsEvents';
import { useLiveFeed } from '../hooks/useLiveFeed';
import { useMergedEvents } from '../hooks/useMergedEvents';
import EventCard from '../components/EventCard';
import { Sidebar } from '../components/Sidebar';
import { BetSlip } from '../components/BetSlip';
import { useNavigate } from 'react-router-dom';
import { formatLeagueHeader, getLeagueLogo, getSportIcon } from '../../shared/helpers';
import { useEventSearch } from '../hooks/useEventSearch';
import { useUpcomingCache } from '../hooks/useUpcomingCache';
import { useGroupedEvents } from '../hooks/useGroupedEvents';
import { useTopLeagues } from '../hooks/useTopLeagues';
import { useBatchMarketSignals } from '../hooks/useBatchMarketSignals';
import type { Event } from '../../shared/types';

interface HomeProps {
  mode?: 'home' | 'live';
}

const normalizeTeamKey = (s: string) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const matchUID = (home: string, away: string, dateIso: string) => {
  const h = normalizeTeamKey(home);
  const a = normalizeTeamKey(away);
  const d = String(dateIso || '').slice(0, 10);
  return `${h}::${a}::${d}`;
};

const mergeKeyOf = (e: any) => {
  const ext = e?.external_event_id;
  const fix = e?.fixture?.id;
  const id = e?.id;
  if (ext) return String(ext);
  if (fix) return String(fix);
  if (id) return String(id);
  return matchUID(String(e?.home_team || e?.teams?.home?.name || ''), String(e?.away_team || e?.teams?.away?.name || ''), String(e?.event_date || e?.fixture?.date || ''));
};

const statusKeyOf = (e: any) =>
  String(e?.status?.short ?? e?.status?.long ?? e?.status ?? e?.fixture?.status?.short ?? e?.fixture?.status?.long ?? '')
    .toUpperCase()
    .trim()
    .replace(/[^A-Z0-9_]+/g, '');

const isFinishedEvent = (e: any) => {
  const k = statusKeyOf(e);
  const done = new Set(['FT', 'AET', 'FT_PEN', 'FTPEN', 'AWD', 'WO', 'ABD', 'CANC', 'PST', 'FIN', 'FINAL', 'FINISHED', 'ENDED']);
  if (done.has(k)) return true;
  if (/MATCHFINISHED|FULLTIME|GAMEOVER|ENCERRAD|TERMINAD/.test(k)) return true;
  return false;
};

const SPORT_FILTER_DEFS = [
  { key: 'soccer', label: 'Futebol', emoji: '⚽' },
  { key: 'tennis', label: 'Ténis', emoji: '🎾' },
  { key: 'basketball', label: 'Basquetebol', emoji: '🏀' },
  { key: 'ice-hockey', label: 'Hóquei', emoji: '🏒' },
  { key: 'baseball', label: 'Beisebol', emoji: '⚾' },
] as const;

const normalizeSportKey = (sport: any): string => {
  const s = String(sport || '').toLowerCase().trim();
  if (!s) return '';
  if (s.includes('football') && !s.includes('american')) return 'soccer';
  if (s.includes('futebol') || s.includes('soccer')) return 'soccer';
  if (s.includes('tennis') || s.includes('ténis') || s.includes('tenis')) return 'tennis';
  if (s.includes('basketball') || s.includes('basquete') || s.includes('basquet')) return 'basketball';
  if ((s.includes('ice') && s.includes('hockey')) || s.includes('hóquei') || s === 'hockey') return 'ice-hockey';
  if (s.includes('baseball') || s.includes('beisebol')) return 'baseball';
  return s.replace(/\s+/g, '-');
};

const getEventLeagueName = (event: any) => {
  const formatted = formatLeagueHeader({ league: event?.league, country: event?.country });
  const rawLeague = typeof event?.league === 'string' ? event.league : event?.league?.name;
  return formatted.league || String(rawLeague || event?.league_name || '').trim() || 'Liga';
};

const getEventLeagueMeta = (event: any) => {
  const sport = normalizeSportKey(event?.sport || 'soccer');
  const league = getEventLeagueName(event);
  return {
    league,
    sport,
    country: String(event?.country || event?.league?.country || '').trim(),
    logo: getLeagueLogo({ league, country: event?.country }, sport),
  };
};

function Home({ mode = 'home' }: HomeProps) {
  const { darkMode, selectedCategory, setSelectedCategory, showMobileSidebar, setShowMobileSidebar, addToBetSlip } = useApp();
  const navigate = useNavigate();
  const [sportFilter, setSportFilter] = useState<string | null>(null);
  const [leagueFilter, setLeagueFilter] = useState<string | null>(null);

  // Dados principais
  const isMainSports =
    !selectedCategory ||
    selectedCategory === 'all' ||
    selectedCategory === 'soccer-all' ||
    selectedCategory === 'todos';

  const apiCategory = selectedCategory || 'all';
  const apiDays = mode === 'home' && isMainSports ? 3 : undefined;

  const { live: httpLive, pregame, loading: eventsLoading, ready: eventsReady } = useSportsEvents(
    apiCategory,
    {
      only: mode === 'home' ? 'pregame' : mode === 'live' ? 'live' : 'both',
      days: apiDays,
      requireOdds: true,
    },
  );

  const todayKey = useMemo(() => {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }, []);

  const { pregame: pregame7Days, ready: pregame7Ready } = useSportsEvents('all', {
    only: 'pregame',
    days: 3,
    enabled: mode === 'live',
    requireOdds: true,
  });
  void eventsLoading;
  const showBanner = mode === 'home';
  
  const { liveEvents: wsLiveEvents, hasLoaded: liveFeedLoaded } = useLiveFeed('all');
  const mergedLive = useMergedEvents(httpLive, wsLiveEvents);
  const processedLive = useMemo(() => {
    const map = new Map<string, Event>();
    for (const ev of mergedLive) {
      if (isFinishedEvent(ev)) continue;
      map.set(mergeKeyOf(ev), ev);
    }
    return Array.from(map.values());
  }, [mergedLive]);

  const { upcomingEvents } = useUpcomingCache(pregame);

  // ── Live critical-event signals (VAR, gol, pênalti, grande chance) ──────
  // Polls /api/events/:id/incidents every 7s for each live soccer match and
  // computes the CTA state (goal/var_review/penalty/cards/big_chance).
  // Passed as `signals` prop to each live EventCard so the card can show the
  // correct overlay and block odds during critical moments.
  const { signals: liveSignals } = useBatchMarketSignals({
    events: processedLive,
    enabled: processedLive.length > 0,
    maxEvents: 20,
  });

  // Busca
  const { query, setQuery } = useEventSearch();

  // ── Reveal gate ────────────────────────────────────────────────
  // Em vez de mostrar jogos a "pingar" um a um, esperamos que TODAS as
  // fontes de dados assentem (rede HTTP real + feed ao vivo + próximos 7
  // dias) e revelamos tudo de uma só vez, num bloco estável com fade-in.
  const [revealed, setRevealed] = useState(false);

  // Re-engaja a porta sempre que muda o modo ou a categoria.
  useEffect(() => {
    setRevealed(false);
  }, [mode, selectedCategory]);

  useEffect(() => {
    if (revealed) return;

    // A fonte primária (HTTP) tem de ter respondido pela rede (não só cache).
    const primaryReady = eventsReady;
    // Em "ao vivo" também esperamos o feed ao vivo e os próximos 7 dias.
    const liveSourcesReady = mode === 'live' ? (liveFeedLoaded && pregame7Ready) : true;

    if (primaryReady && liveSourcesReady) {
      // Pequena janela de assentamento para o merge final entrar num único lote.
      const settleMs = mode === 'live' ? 350 : 150;
      const t = setTimeout(() => setRevealed(true), settleMs);
      return () => clearTimeout(t);
    }
  }, [revealed, eventsReady, liveFeedLoaded, pregame7Ready, mode]);

  // Tecto de segurança: nunca segurar o ecrã mais do que 6s.
  useEffect(() => {
    const cap = setTimeout(() => setRevealed(true), 6000);
    return () => clearTimeout(cap);
  }, [mode, selectedCategory]);

  // Agrupamento
  const activeTopLeagues = useTopLeagues(processedLive, upcomingEvents);

  // Separate Lists for Live and Upcoming
  // Detect World Cup league name — those events only appear via the /copa-do-mundo page
  const isWorldCupLeague = (e: any) => {
    const raw = typeof e?.league === 'string' ? e.league : (e?.league?.name || e?.league_name || '');
    return /world.?cup|copa.?do.?mundo|fifa.?wc|coupe.?du.?monde|weltmeister/i.test(String(raw));
  };

  const sortedUpcoming = useMemo(() => {
    const liveIds = new Set(processedLive.map(e => mergeKeyOf(e)));
    return upcomingEvents
      .filter(e => {
        if (liveIds.has(mergeKeyOf(e))) return false;
        // World Cup events are only shown on the dedicated /copa-do-mundo page
        if (isWorldCupLeague(e)) return false;

        // Strict validity check
        const h = (e.home_team || '').trim();
        const a = (e.away_team || '').trim();
        if (!h || !a || h === 'undefined' || a === 'undefined' || h === 'Home Team' || a === 'Away Team') return false;
        if (e.id === 'undefined' || !e.id) return false;

        const sportRaw = String((e as any)?.sport || '').toLowerCase();
        const isSoccer = sportRaw.includes('soccer') || sportRaw.includes('football') || sportRaw.includes('futebol');

        const homeOdd = Number((e as any)?.home_odd || 0);
        const awayOdd = Number((e as any)?.away_odd || 0);
        if (homeOdd > 1.01 && awayOdd > 1.01) return true;

        let mk: any = (e as any)?.markets ?? (e as any)?.odds;
        if (typeof mk === 'string') {
          const s = mk.trim();
          if (s && ((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']')))) {
            try { mk = JSON.parse(s); } catch { void 0; }
          }
        }
        if (mk && typeof mk === 'object' && !Array.isArray(mk)) {
          const h2h = (mk as any).h2h || (mk as any)['1x2'] || (mk as any).main || (mk as any).match_winner;
          const sels = Array.isArray(h2h) ? h2h : (h2h?.selections || h2h?.outcomes || h2h?.values || []);
          if (Array.isArray(sels)) {
            const ok = sels.filter((s: any) => Number(s?.odd ?? s?.price ?? s?.value ?? 0) > 1.01).length;
            if (ok >= 2) return true;
          }
        }

        // Allow all non-soccer sports to appear even without odds
        if (!isSoccer) return true;
        
        return false;
      })
      .sort((a, b) => {
        const ta = new Date(a.event_date || a.start_time || a.fixture?.date || 0).getTime();
        const tb = new Date(b.event_date || b.start_time || b.fixture?.date || 0).getTime();
        return ta - tb; // Ascending: Soonest first
      });
  }, [processedLive, upcomingEvents]);

  const sortedUpcoming7Days = useMemo(() => {
    if (mode !== 'live') return [];
    const liveIds = new Set(processedLive.map(e => mergeKeyOf(e)));
    const list = Array.isArray(pregame7Days) ? pregame7Days : [];
    return list
      .filter(e => {
        if (!e) return false;
        if (liveIds.has(mergeKeyOf(e))) return false;
        const rawDate = (e as any)?.event_date ?? (e as any)?.start_time ?? (e as any)?.fixture?.date ?? '';
        const m = typeof rawDate === 'string' ? rawDate.match(/\d{4}-\d{2}-\d{2}/) : null;
        const dayKey = m?.[0] || '';
        if (dayKey && dayKey === todayKey) return false;
        const h = (e.home_team || '').trim();
        const a = (e.away_team || '').trim();
        if (!h || !a || h === 'undefined' || a === 'undefined' || h === 'Home Team' || a === 'Away Team') return false;
        if (e.id === 'undefined' || !e.id) return false;
        const homeOdd = Number((e as any)?.home_odd || 0);
        const awayOdd = Number((e as any)?.away_odd || 0);
        if (homeOdd > 1.01 && awayOdd > 1.01) return true;
        const mk = (e as any)?.markets ?? (e as any)?.odds;
        if (mk && typeof mk === 'object' && !Array.isArray(mk)) return Object.keys(mk).length > 0;
        if (Array.isArray(mk)) return mk.length > 0;
        return false;
      })
      .sort((a, b) => {
        const ta = new Date(a.event_date || a.start_time || a.fixture?.date || 0).getTime();
        const tb = new Date(b.event_date || b.start_time || b.fixture?.date || 0).getTime();
        return ta - tb;
      });
  }, [mode, processedLive, pregame7Days, todayKey]);

  // Strict separation: Desporto = pregame only | AO VIVO = live only
  const displayedLive    = mode === 'live' ? processedLive : [];
  const displayedUpcoming = useMemo(() => {
    return mode === 'home' ? sortedUpcoming : [];
  }, [mode, sortedUpcoming]);

  const groupedLive = useGroupedEvents(displayedLive, query);
  const groupedUpcoming = useGroupedEvents(displayedUpcoming, query);
  const groupedNext7 = useGroupedEvents(mode === 'live' ? (sortedUpcoming7Days as Event[]) : [], query);

  const MAX_EVENTS = mode === 'live' ? 120 : 500; // live≤120, pregame sem limite prático

  const flatLiveEvents = useMemo(() => groupedLive.flatMap(([, events]) => events), [groupedLive]);
  const flatUpcomingEvents = useMemo(() => groupedUpcoming.flatMap(([, events]) => events), [groupedUpcoming]);
  const flatNext7Events = useMemo(() => groupedNext7.flatMap(([, events]) => events), [groupedNext7]);

  const filterEventsByControls = (events: Event[]) => {
    return events.filter((ev: any) => {
      if (isWorldCupLeague(ev)) return false;
      const sportOk = !sportFilter || normalizeSportKey(ev?.sport) === sportFilter;
      const leagueName = getEventLeagueName(ev);
      const leagueOk = !leagueFilter || leagueName === leagueFilter;
      return sportOk && leagueOk;
    });
  };

  const limitEvents = (events: Event[], limit: number) => (limit > 0 ? events.slice(0, limit) : events);

  const limitedUpcoming = useMemo(
    () => limitEvents(filterEventsByControls(flatUpcomingEvents), MAX_EVENTS),
    [flatUpcomingEvents, sportFilter, leagueFilter, MAX_EVENTS],
  );

  const limitedLive = useMemo(
    () => limitEvents(filterEventsByControls(flatLiveEvents), 120),
    [flatLiveEvents, sportFilter, leagueFilter],
  );

  const limitedNext7 = useMemo(
    () => (mode === 'live' ? limitEvents(filterEventsByControls(flatNext7Events), 300) : []),
    [flatNext7Events, sportFilter, leagueFilter, mode],
  );

  const buildLeagueOptions = (events: Event[]) => {
    const grouped = new Map<string, { league: string; sport: string; country: string; count: number; logo: string }>();
    for (const ev of events as any[]) {
      const meta = getEventLeagueMeta(ev);
      if (!meta.league) continue;
      const prev = grouped.get(meta.league);
      if (prev) {
        prev.count += 1;
      } else {
        grouped.set(meta.league, {
          league: meta.league,
          sport: meta.sport,
          country: meta.country,
          count: 1,
          logo: meta.logo,
        });
      }
    }
    return Array.from(grouped.values())
      .sort((a, b) => b.count - a.count || a.league.localeCompare(b.league))
      .slice(0, 18);
  };

  const homeBaseEvents = useMemo(
    () => flatUpcomingEvents.filter((ev: any) => !sportFilter || normalizeSportKey(ev?.sport) === sportFilter),
    [flatUpcomingEvents, sportFilter],
  );
  const liveBaseEvents = useMemo(
    () => flatLiveEvents.filter((ev: any) => !sportFilter || normalizeSportKey(ev?.sport) === sportFilter),
    [flatLiveEvents, sportFilter],
  );

  const availableLeagues = useMemo(
    () => buildLeagueOptions(mode === 'live' ? liveBaseEvents : homeBaseEvents),
    [homeBaseEvents, liveBaseEvents, mode],
  );

  const availableSportFilters = useMemo(() => {
    const base = mode === 'live' ? flatLiveEvents : flatUpcomingEvents;
    const keys = new Set(base.map((ev: any) => normalizeSportKey(ev?.sport)));
    return SPORT_FILTER_DEFS.filter(({ key }) => keys.has(key));
  }, [flatLiveEvents, flatUpcomingEvents, mode]);

  const noSearchResults = useMemo(() => {
    if (!query.trim()) return false;
    return limitedLive.length + limitedUpcoming.length + limitedNext7.length === 0;
  }, [limitedLive, limitedUpcoming, limitedNext7, query]);

  const handleOpenEvent = (event: Event) => {
    navigate(`/event/${event.id}`);
  };

  const renderSportFilterBar = () => {
    if (availableSportFilters.length === 0) return null;
    return (
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide" style={{ scrollbarWidth: 'none' }}>
        <button
          onClick={() => { setSportFilter(null); setLeagueFilter(null); }}
          className={`shrink-0 px-4 py-2 rounded-full text-xs font-bold uppercase tracking-wide transition-all whitespace-nowrap ${
            sportFilter === null && leagueFilter === null
              ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30'
              : darkMode ? 'bg-gray-800 text-gray-300 hover:bg-gray-700' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          Todos
        </button>
        {availableSportFilters.map(({ key, label, emoji }) => (
          <button
            key={key}
            onClick={() => { setSportFilter(sportFilter === key ? null : key); setLeagueFilter(null); }}
            className={`shrink-0 px-4 py-2 rounded-full text-xs font-bold uppercase tracking-wide transition-all flex items-center gap-1.5 whitespace-nowrap ${
              sportFilter === key && !leagueFilter
                ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30'
                : darkMode ? 'bg-gray-800 text-gray-300 hover:bg-gray-700' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            <span>{emoji}</span>
            {label}
          </button>
        ))}
      </div>
    );
  };

  const renderLeagueFilterBar = () => {
    if (mode === 'live' || availableLeagues.length === 0) return null;
    return (
      <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-hide" style={{ scrollbarWidth: 'none' }}>
        <button
          onClick={() => setLeagueFilter(null)}
          className={`shrink-0 min-w-[120px] h-[64px] px-3 rounded-[18px] border transition-all text-left ${
            !leagueFilter
              ? 'border-amber-400 bg-amber-50 text-gray-900 shadow-sm'
              : darkMode ? 'border-gray-700 bg-gray-800/80 text-gray-200' : 'border-gray-200 bg-white text-gray-800'
          }`}
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-2xl flex items-center justify-center bg-white/80 border border-black/5">
              <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" />
              </svg>
            </div>
            <span className="text-sm font-semibold">Todas</span>
          </div>
        </button>
        {availableLeagues.map(({ league, sport, logo, country }) => {
          const isActive = leagueFilter === league;
          const formatted = formatLeagueHeader({ league, country });
          const flagBadge = String(formatted.flag || '').trim();
          return (
            <button
              key={`${sport}-${league}`}
              onClick={() => setLeagueFilter(isActive ? null : league)}
              className={`shrink-0 min-w-[154px] h-[64px] px-3 rounded-[18px] border transition-all text-left ${
                isActive
                  ? 'border-amber-400 bg-amber-50 shadow-sm'
                  : darkMode ? 'border-gray-700 bg-gray-800/80 text-gray-100' : 'border-gray-200 bg-white text-gray-800'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className={`relative w-10 h-10 rounded-2xl flex items-center justify-center overflow-hidden ${darkMode ? 'bg-white/95' : 'bg-gray-50'}`}>
                  <img
                    src={logo || getSportIcon(sport)}
                    alt={league}
                    className="w-8 h-8 object-contain"
                    loading="lazy"
                    onError={(e) => {
                      const target = e.currentTarget;
                      target.onerror = null;
                      target.src = getSportIcon(sport);
                    }}
                  />
                  {flagBadge ? (
                    <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-white text-[10px] flex items-center justify-center shadow">
                      {flagBadge}
                    </span>
                  ) : null}
                </div>
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold truncate">{league}</div>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    );
  };

  const multiplesSource = displayedUpcoming;

  const multipleBanners = useMemo(() => {
    type Pick = { event: Event; selection: string; market: string; odd: number };
    type Banner = { id: string; picks: Pick[]; totalOdd: number; legsOddStr: string };

    const normalizeOdd = (v: any) => {
      const n = Number(v);
      if (!Number.isFinite(n)) return 0;
      if (n <= 1.01) return 0;
      if (n > 200) return 0;
      return n;
    };

    const getMarkets = (ev: any) => Array.isArray(ev?.markets) ? ev.markets : [];

    const pickFromEvent = (ev: Event): Pick | null => {
      const sport = String((ev as any).sport || 'soccer');
      const markets = getMarkets(ev);

      const findMarket = (keys: string[]) => {
        for (const k of keys) {
          const hit = markets.find((m: any) => String(m?.key || '').toLowerCase() === k);
          if (hit) return hit;
        }
        return null;
      };

      const pickSelection = (market: any, pref: (s: any) => boolean): { selection: any; odd: number } | null => {
        const sels = Array.isArray(market?.selections) ? market.selections : Array.isArray(market?.outcomes) ? market.outcomes : [];
        const ranked = sels
          .map((s: any) => ({ s, odd: normalizeOdd(s?.odd ?? s?.price) }))
          .filter((x: any) => x.odd > 0);
        const preferred = ranked.filter((x: any) => pref(x.s));
        const pool = preferred.length ? preferred : ranked;
        if (!pool.length) return null;
        const best = pool.reduce((m: any, x: any) => x.odd < m.odd ? x : m, pool[0]);
        return { selection: best.s, odd: best.odd };
      };

      const homeName = String((ev as any)?.home_team || '').trim();
      const awayName = String((ev as any)?.away_team || '').trim();

      const makePick = (market: any, selection: any, odd: number): Pick | null => {
        const mkKey = String(market?.key || '').toLowerCase().trim();
        const marketName =
          (mkKey === 'h2h' || mkKey === 'moneyline' || mkKey === 'ml' || mkKey === 'winner')
            ? 'Resultado Final'
            : (String(market?.name || market?.key || '').trim() || 'Mercado');

        const rawSel = String(selection?.label || selection?.name || '').trim();
        const t = rawSel.toLowerCase();
        const selLabel =
          t === 'casa' || t === 'home'
            ? (homeName || rawSel)
            : (t === 'fora' || t === 'away'
              ? (awayName || rawSel)
              : rawSel || 'Seleção');
        if (!odd) return null;
        return { event: ev, selection: selLabel, market: marketName, odd };
      };

      if (sport === 'soccer') {
        const btts = findMarket(['btts', 'bt_ts', 'both_teams_to_score']);
        if (btts) {
          const picked = pickSelection(btts, (s) => /^(sim|yes)$/i.test(String(s?.label || s?.name || '').trim()));
          if (picked && picked.odd >= 1.35 && picked.odd <= 2.75) return makePick(btts, picked.selection, picked.odd);
        }

        const totals = markets.find((m: any) => /ou|totals|total|goals/i.test(String(m?.key || m?.name || '')));
        if (totals) {
          const picked = pickSelection(
            totals,
            (s) => {
              const t = String(s?.label || s?.name || '').toLowerCase();
              return (t.includes('2.5') || t.includes('+2.5')) && (t.includes('over') || t.includes('mais') || t.startsWith('+'));
            },
          );
          if (picked && picked.odd >= 1.15 && picked.odd <= 2.40) return makePick(totals, picked.selection, picked.odd);
        }
      }

      const h2h = findMarket(['h2h', 'moneyline', 'ml']);
      if (h2h) {
        const picked = pickSelection(h2h, (s) => {
          const t = String(s?.label || s?.name || '').toLowerCase();
          if (t.includes('empate') || t === 'x' || t === 'draw') return false;
          return true;
        });
        if (picked && picked.odd >= 1.15 && picked.odd <= 3.50) return makePick(h2h, picked.selection, picked.odd);
      }

      const homeOdd = normalizeOdd((ev as any).home_odd);
      const awayOdd = normalizeOdd((ev as any).away_odd);
      const opts = [
        { selection: homeName || 'Casa', odd: homeOdd },
        { selection: awayName || 'Fora', odd: awayOdd },
      ].filter((x) => x.odd > 0);
      if (opts.length >= 2) {
        const best = opts.reduce((m, x) => x.odd < m.odd ? x : m, opts[0]);
        return { event: ev, selection: best.selection, market: 'Resultado Final', odd: best.odd };
      }
      return null;
    };

    const candidates = multiplesSource
      .filter((e) => e && e.id != null)
      .filter((e) => String((e as any).home_team || '').trim() && String((e as any).away_team || '').trim())
      .map((e) => {
        const start = new Date((e as any).event_date || (e as any).start_time || (e as any).fixture?.date || 0).getTime();
        const sport = String((e as any).sport || 'soccer');
        return { e, start, sport };
      })
      .sort((a, b) => {
        const sa = a.sport === 'soccer' ? 0 : 1;
        const sb = b.sport === 'soccer' ? 0 : 1;
        if (sa !== sb) return sa - sb;
        return a.start - b.start;
      })
      .map((x) => x.e);

    const banners: Banner[] = [];
    let cursor = 0;

    // Strict pass: each banner = exactly 3 legs (2 low-odds + 1 high-odds).
    for (let i = 0; i < 3; i++) {
      const picks: Pick[] = [];
      const used = new Set<string | number>();
      let lowCount = 0;
      let highCount = 0;
      let guard = 0;
      while (picks.length < 3 && guard < candidates.length * 2) {
        const ev = candidates[cursor % Math.max(1, candidates.length)];
        cursor++;
        guard++;
        const key = String(ev?.id);
        if (used.has(key)) continue;
        const pick = pickFromEvent(ev);
        if (!pick) continue;

        const odd = Number(pick.odd || 0);
        const isLow = odd > 1.01 && odd < 2.0;
        const isHigh = odd >= 2.5 && odd <= 3.5;
        if (!isLow && !isHigh) continue;
        if (isLow && lowCount >= 2) continue;
        if (isHigh && highCount >= 1) continue;

        used.add(key);
        picks.push(pick);
        if (isLow) lowCount += 1;
        if (isHigh) highCount += 1;
      }
      if (picks.length === 3 && lowCount === 2 && highCount === 1) {
        const totalOdd = picks.reduce((acc, p) => acc * p.odd, 1);
        const legsOddStr = picks.map((p) => p.odd.toFixed(2)).join(' × ');
        banners.push({ id: `multi_${i}`, picks, totalOdd, legsOddStr });
      }
    }

    // Relaxed fallback: if the strict mix never materialises (e.g. no high-odds
    // leg available), still build 3-leg banners from any valid picks so the
    // "Múltiplas em destaque" carousel never disappears.
    if (banners.length === 0) {
      let fbCursor = 0;
      for (let i = 0; i < 3; i++) {
        const picks: Pick[] = [];
        const used = new Set<string | number>();
        let guard = 0;
        while (picks.length < 3 && guard < candidates.length * 2) {
          const ev = candidates[fbCursor % Math.max(1, candidates.length)];
          fbCursor++;
          guard++;
          const key = String(ev?.id);
          if (used.has(key)) continue;
          const pick = pickFromEvent(ev);
          if (!pick) continue;
          const odd = Number(pick.odd || 0);
          if (odd <= 1.01 || odd > 3.5) continue;
          used.add(key);
          picks.push(pick);
        }
        if (picks.length === 3) {
          const totalOdd = picks.reduce((acc, p) => acc * p.odd, 1);
          const legsOddStr = picks.map((p) => p.odd.toFixed(2)).join(' × ');
          banners.push({ id: `multi_fb_${i}`, picks, totalOdd, legsOddStr });
        }
      }
    }

    return banners;
  }, [multiplesSource]);

  const MultipleCarousel = ({ instanceKey }: { instanceKey: string }) => {
    const [idx, setIdx] = useState(0);
    const slides = multipleBanners.length ? multipleBanners : [];
    if (!slides.length) return null;

    const go = (next: number) => {
      const n = slides.length;
      setIdx(((next % n) + n) % n);
    };

    return (
      <div className={`rounded-xl border overflow-hidden ${darkMode ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'}`}>
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-red-600 font-black">🔥</span>
            <span className="text-sm font-extrabold uppercase tracking-wider">Múltiplas em destaque</span>
          </div>
        </div>

        <div
          className="relative w-full overflow-hidden"
          style={{ touchAction: 'pan-y' }}
          onPointerDown={(e) => {
            (e.currentTarget as any).__swipeX = e.clientX;
            (e.currentTarget as any).__swipeId = e.pointerId;
            try { (e.currentTarget as any).setPointerCapture?.(e.pointerId); } catch { void 0 }
          }}
          onPointerUp={(e) => {
            const startX = Number((e.currentTarget as any).__swipeX || 0);
            const dx = e.clientX - startX;
            (e.currentTarget as any).__swipeX = 0;
            try { (e.currentTarget as any).releasePointerCapture?.(e.pointerId); } catch { void 0 }
            if (Math.abs(dx) < 40) return;
            if (dx > 0) go(idx - 1);
            else go(idx + 1);
          }}
          onPointerCancel={(e) => {
            (e.currentTarget as any).__swipeX = 0;
            try { (e.currentTarget as any).releasePointerCapture?.(e.pointerId); } catch { void 0 }
          }}
        >
          <div
            className="flex transition-transform duration-500"
            style={{ transform: `translateX(-${idx * 100}%)` }}
          >
            {slides.map((b) => (
              <div key={`${instanceKey}_${b.id}`} className="w-full shrink-0 p-4">
                <div className={`rounded-xl border p-5 ${darkMode ? 'bg-gray-950/40 border-gray-800' : 'bg-gray-50 border-gray-200'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-black uppercase tracking-wider">Múltipla de 3 eventos</div>
                      <div className={`text-xs mt-1 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>Odd total: {b.legsOddStr}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] uppercase tracking-wider opacity-70">Odds final</div>
                      <div className="text-2xl font-black text-red-600 tabular-nums">{b.totalOdd.toFixed(2)}</div>
                    </div>
                  </div>

                  <div className="mt-4 space-y-3 min-h-[126px]">
                    {b.picks.map((p, i) => (
                      <div key={`${instanceKey}_${b.id}_leg_${i}`} className={`rounded-lg px-3 py-3 border ${darkMode ? 'border-gray-800 bg-gray-900/40' : 'border-gray-200 bg-white'}`}>
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-xs font-black truncate">{i + 1}) {(p.event as any).home_team} vs {(p.event as any).away_team}</div>
                            <div className={`text-[11px] truncate ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>{p.market} — {p.selection}</div>
                          </div>
                          <div className="text-right shrink-0">
                            {(() => {
                              const raw = (p.event as any)?.event_date || (p.event as any)?.fixture?.date;
                              const ms = raw ? new Date(raw).getTime() : 0;
                              if (!Number.isFinite(ms) || ms <= 0) return null;
                              const d = new Date(ms);
                              const pad = (n: number) => String(n).padStart(2, '0');
                              const dt = `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}h${pad(d.getMinutes())}`;
                              return <div className={`text-[10px] font-bold opacity-70 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>{dt}</div>;
                            })()}
                            <div className="text-xs font-black tabular-nums">{p.odd.toFixed(2)}</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-4 flex items-center justify-between gap-3">
                    <div className="text-xs font-bold">
                      TOTAL DA MÚLTIPLA: <span className="text-red-600">{b.totalOdd.toFixed(2)}</span>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        for (let i = 0; i < b.picks.length; i++) {
                          const p = b.picks[i];
                          addToBetSlip({
                            id: `${p.event.id}|${p.market}|${p.selection}|${instanceKey}`,
                            event_id: p.event.id,
                            match: String((p.event as any).match || `${(p.event as any).home_team} vs ${(p.event as any).away_team}`),
                            selection: p.selection,
                            market: p.market,
                            odd: p.odd,
                            stake: 0,
                            league: String((p.event as any).league || ''),
                            sport: String((p.event as any).sport || ''),
                            suspended: Boolean((p.event as any).suspended),
                            market_suspended: false,
                          });
                        }
                      }}
                      className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-black uppercase tracking-wider"
                    >
                      Aposte Agora
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-center gap-1.5 px-4 pb-3">
          {slides.map((_, i) => (
            <button
              key={`${instanceKey}_dot_${i}`}
              type="button"
              onClick={(e) => { e.stopPropagation(); go(i); }}
              className={`h-2 rounded-full transition-all ${i === idx ? 'w-6 bg-red-600' : `w-2 ${darkMode ? 'bg-gray-700' : 'bg-gray-300'}`}`}
              aria-label={`Ir para múltipla ${i + 1}`}
            />
          ))}
        </div>
      </div>
    );
  };

  const showDebug = false; // Debug disabled by user request

  // WARNING: Conditional Hook Call Fixed
  // Previous: useEffect inside conditional block if (processedLive.length > 0 ...)
  // Now: useEffect always called, logic inside
  const [hasEverHadEvents, setHasEverHadEvents] = useState(false);
  const [showIntro] = useState(false);

  useEffect(() => {
    if ((processedLive.length > 0 || upcomingEvents.length > 0) && !hasEverHadEvents) {
      setHasEverHadEvents(true);
    }
  }, [processedLive, upcomingEvents, hasEverHadEvents]);

  // Caso não apareça nada (primeira carga, sem eventos) - REMOVIDO POR SOLICITAÇÃO
  // if (!loading && !hasEverHadEvents && groupedLive.length === 0 && limitedUpcoming.length === 0) { ... }

  return (
    <div className={`min-h-screen ${darkMode ? 'bg-[#121212] text-white' : 'bg-gray-50 text-gray-900'}`}>
      {showIntro && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black">
          <div className="absolute inset-0 bg-gradient-to-b from-black via-[#0b0b10] to-black"></div>
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_45%,rgba(255,0,60,0.10)_0%,transparent_55%)]"></div>

          <div className="relative z-10 flex flex-col items-center px-6">
            <div className="text-6xl font-extrabold tracking-[0.22em]">
              <span className="text-white">BET</span>
              <span className="text-red-600">62</span>
            </div>
            <div className="mt-5 flex items-center gap-3 text-white/70">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-white/80" />
              <div className="text-xs uppercase tracking-[0.25em]">Carregando</div>
            </div>
          </div>
        </div>,
        document.body,
      )}
      {/* DEBUG PANEL */}
      {showDebug && (
        <div className="bg-red-900/80 text-white p-2 text-xs font-mono fixed bottom-0 left-0 z-50 w-full">
            DEBUG: Mode={mode} | 
            HTTP Live={httpLive.length} | 
            Processed Live={processedLive.length} | 
            Pregame Raw={pregame.length} | 
            Upcoming Cache={upcomingEvents.length} |
            Sorted Upcoming={sortedUpcoming.length} |
            Display Live={displayedLive.length} |
            Display Upcoming={displayedUpcoming.length}
        </div>
      )}

      {/* Mobile Sidebar Overlay */}

      <div className="flex items-start gap-4 w-full px-2 py-6">
        {/* Sidebar */}
        <aside className={`hidden lg:block w-72 shrink-0 sticky top-16 h-[calc(100vh-4rem)] overflow-y-auto ${darkMode ? 'bg-[#0c1110] border-[#1e2d28]' : 'bg-white border-gray-200'} border-r`}>
          <div className="p-4 space-y-5">
            {/* Busca */}
            <input
              type="text"
              placeholder="Buscar jogos, ligas..."
              value={query}
              onChange={e => setQuery(e.target.value)}
              className={`w-full px-4 py-3 rounded-xl border ${darkMode ? 'bg-gray-800 border-gray-700 text-white placeholder-gray-500' : 'bg-gray-100 border-gray-300 placeholder-gray-500'} focus:outline-none focus:ring-2 focus:ring-blue-500`}
            />
            <Sidebar dynamicTopItems={activeTopLeagues} />
          </div>
        </aside>

        {/* Mobile Sidebar */}
        {showMobileSidebar && createPortal(
          <div className="fixed inset-0 z-50 lg:hidden">
            <div className="absolute inset-0 bg-black/60" onClick={() => setShowMobileSidebar(false)} />
            <div className={`absolute left-0 top-0 bottom-0 w-80 ${darkMode ? 'bg-gray-900' : 'bg-white'} shadow-2xl overflow-y-auto`}>
              <div className="p-5 space-y-5">
                <input
                  type="text"
                  placeholder="Buscar jogos..."
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  className={`w-full px-4 py-3 rounded-xl border ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-100 border-gray-300'}`}
                />
                <Sidebar dynamicTopItems={activeTopLeagues} />
              </div>
            </div>
          </div>,
          document.body
        )}

        {/* Conteúdo principal */}
        <main className="flex-1 min-w-0 space-y-8">
          {/* Eventos */}
          <section id="events">
            <div className="flex items-center gap-3 mb-5">
              {mode === 'live' ? (
                <>
                  <span className="relative flex h-4 w-4">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-4 w-4 bg-red-600"></span>
                  </span>
                  <h2 className="text-2xl font-bold uppercase tracking-wide text-red-500">Ao Vivo</h2>
                </>
              ) : (
                <>
                  <div className="w-10 h-10 rounded-full bg-blue-600/20 flex items-center justify-center">
                    <svg className="w-6 h-6 text-blue-500" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </div>
                  <h2 className="text-2xl font-bold uppercase tracking-wide">Pré-Jogos</h2>
                </>
              )}
            </div>

            {!revealed ? (
              <div className="text-center py-20">
                <div className="animate-spin h-12 w-12 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-4"></div>
                <p className="text-gray-500">Carregando eventos...</p>
              </div>
            ) : (limitedLive.length > 0 || limitedUpcoming.length > 0 || limitedNext7.length > 0) ? (
              <div className="space-y-12 events-reveal">
                {/* LIVE SECTION — shown only in mode='live' */}
                {limitedLive.length > 0 && (
                  <div className="space-y-6">
                    {renderSportFilterBar()}
                    {renderLeagueFilterBar()}
                    <div className="flex flex-col gap-4">
                      {limitedLive.map((ev) => {
                        const evId = String((ev as any)?.id ?? (ev as any)?.fixture?.id ?? (ev as any)?.external_event_id ?? '').trim();
                        return (
                          <EventCard
                            key={mergeKeyOf(ev)}
                            event={ev}
                            onOpenEvent={() => handleOpenEvent(ev)}
                            signals={liveSignals[evId]}
                          />
                        );
                      })}
                    </div>
                  </div>
                )}

                {limitedNext7.length > 0 && (
                  <div className="space-y-6">
                     {limitedLive.length > 0 && (
                        <div className="flex items-center gap-3 px-2 pt-4 border-t border-gray-700/50">
                           <h2 className="text-xl font-bold uppercase tracking-wide">Próximos 7 dias</h2>
                        </div>
                     )}
                     <div className="flex flex-col gap-4">
                      {limitedNext7.map((ev) => (
                        <EventCard
                          key={`next7_${mergeKeyOf(ev)}`}
                          event={ev}
                          onOpenEvent={() => handleOpenEvent(ev)}
                        />
                      ))}
                     </div>
                  </div>
                )}

                {/* UPCOMING SECTION */}
                {limitedUpcoming.length > 0 && (
                  <div className="space-y-6">
                     {limitedLive.length > 0 && (
                        <div className="flex items-center gap-3 px-2 pt-4 border-t border-gray-700/50">
                           <h2 className="text-xl font-bold uppercase tracking-wide">Próximos Jogos</h2>
                        </div>
                     )}

                     {renderSportFilterBar()}
                     {renderLeagueFilterBar()}
                     
                     <div className="flex flex-col gap-4">
                        {(() => {
                          let globalIdx = 0;
                          let inserted = false;
                          return limitedUpcoming.map((ev) => {
                            const out: any[] = [];
                            out.push(
                              <EventCard
                                key={mergeKeyOf(ev)}
                                event={ev}
                                onOpenEvent={() => handleOpenEvent(ev)}
                              />,
                            );
                            globalIdx++;
                            if (mode === 'home' && !inserted && globalIdx === 2) {
                              inserted = true;
                              out.push(<MultipleCarousel key="pre_multi_once" instanceKey="pre_once" />);
                            }
                            return <div key={`pre_${mergeKeyOf(ev)}`}>{out}</div>;
                          });
                        })()}
                     </div>
                  </div>
                )}
              </div>
            ) : noSearchResults ? (
              <div className="text-center py-12 rounded-xl border border-gray-800 bg-gray-900/30">
                <p className="text-gray-300">Sem resultados para a busca.</p>
                <button
                  onClick={() => setQuery('')}
                  className="mt-4 px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg text-white font-medium"
                >
                  Limpar busca
                </button>
              </div>
            ) : (
              <div className={`text-center py-12 rounded-xl border ${darkMode ? 'border-gray-800 bg-gray-900/30' : 'border-gray-200 bg-white/80'}`}>
                <p className={`${darkMode ? 'text-gray-300' : 'text-gray-700'} font-semibold`}>
                  Nenhum evento carregado no momento.
                </p>
                <p className={`mt-2 text-sm ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                  Atualize a página em alguns segundos. Se continuar vazio, o feed do deploy ainda não terminou de responder.
                </p>
              </div>
            )}
          </section>
        </main>

        {/* BetSlip lateral */}
        <aside className={`hidden xl:block w-96 shrink-0 sticky top-16 h-[calc(100vh-4rem)] overflow-y-auto ${darkMode ? 'bg-[#0c1110] border-[#1e2d28]' : 'bg-white border-gray-200'} border-l`}>
          <div className="p-5">
            <BetSlip />
          </div>
        </aside>
      </div>
    </div>
  );
}

export default Home;
