import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '@/react-app/contexts/AppContext';
import { useSportsEvents } from '@/react-app/hooks/useSportsEvents';
import { useLiveFeed } from '../hooks/useLiveFeed';
import { useMergedEvents } from '../hooks/useMergedEvents';
import EventCard from '../components/EventCard';
import { Sidebar } from '../components/Sidebar';
import { BannerCarousel } from '../components/BannerCarousel';
import { BetSlip } from '../components/BetSlip';
import { useNavigate, Link } from 'react-router-dom';
import { getSportIcon } from '../../shared/helpers';
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

function Home({ mode = 'home' }: HomeProps) {
  const { darkMode, selectedCategory, showMobileSidebar, setShowMobileSidebar, addToBetSlip } = useApp();
  const navigate = useNavigate();

  // Dados principais
  const { live: httpLive, pregame, loading: eventsLoading } = useSportsEvents(selectedCategory || 'all', { only: mode === 'home' ? 'pregame' : mode === 'live' ? 'both' : 'both' });
  const loading = eventsLoading;
  const showBanner = true;
  
  const { liveEvents: wsLiveEvents } = useLiveFeed('all');
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

  // Busca
  const { query, setQuery } = useEventSearch();

  // Agrupamento
  const activeTopLeagues = useTopLeagues(processedLive, upcomingEvents);

  // Separate Lists for Live and Upcoming
  const sortedUpcoming = useMemo(() => {
    const liveIds = new Set(processedLive.map(e => mergeKeyOf(e)));
    return upcomingEvents
      .filter(e => {
        if (liveIds.has(mergeKeyOf(e))) return false;

        // Strict validity check
        const h = (e.home_team || '').trim();
        const a = (e.away_team || '').trim();
        if (!h || !a || h === 'undefined' || a === 'undefined' || h === 'Home Team' || a === 'Away Team') return false;
        if (e.id === 'undefined' || !e.id) return false;

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
        
        return false;
      })
      .sort((a, b) => {
        const ta = new Date(a.event_date || a.start_time || a.fixture?.date || 0).getTime();
        const tb = new Date(b.event_date || b.start_time || b.fixture?.date || 0).getTime();
        return ta - tb; // Ascending: Soonest first
      });
  }, [processedLive, upcomingEvents]);

  const featuredUpcoming = useMemo(() => {
    const cat = String(selectedCategory || 'all').toLowerCase();
    if (cat !== 'all') return [];
    if (query.trim()) return [];

    const sportKey = (ev: any) => {
      const s = String(ev?.sport || '').toLowerCase();
      if (s.includes('soccer') || (s.includes('football') && !s.includes('american')) || s.includes('futebol')) return 'soccer';
      if (s.includes('tennis') || s.includes('tênis') || s.includes('tenis')) return 'tennis';
      if (s.includes('basket')) return 'basketball';
      if (s.includes('hockey')) return 'hockey';
      if (s.includes('baseball')) return 'baseball';
      return 'other';
    };

    const leagueKey = (ev: any) => {
      const l = (ev as any)?.league_name ?? (ev as any)?.league?.name ?? (ev as any)?.league ?? '';
      const c = (ev as any)?.country ?? (ev as any)?.league?.country ?? '';
      return `${String(l)} ${String(c)}`.trim().toLowerCase();
    };

    const startTs = (ev: any) => new Date(ev?.event_date || ev?.start_time || ev?.fixture?.date || 0).getTime();
    const dayKey = (ev: any) => {
      const t = startTs(ev);
      if (!Number.isFinite(t) || t <= 0) return 99;
      const d0 = new Date();
      d0.setHours(0, 0, 0, 0);
      const d1 = new Date(t);
      d1.setHours(0, 0, 0, 0);
      const diff = Math.floor((d1.getTime() - d0.getTime()) / 86400000);
      return diff < 0 ? 0 : diff;
    };

    const soccerLeagueScore = (l: string) => {
      const s = l;
      if (/(champions league|uefa.*champions)/.test(s)) return 120;
      if (/(europa league|uefa.*europa)/.test(s)) return 110;
      if (/(conference league|uefa.*conference)/.test(s)) return 105;
      if (/premier league/.test(s)) return 100;
      if (/(la liga|primera|laliga)/.test(s)) return 95;
      if (/serie a/.test(s)) return 95;
      if (/bundesliga/.test(s)) return 92;
      if (/(ligue 1|league 1)/.test(s)) return 90;
      if (/(eredivisie)/.test(s)) return 84;
      if (/(primeira liga|liga portugal)/.test(s)) return 82;
      if (/(brasileir|serie a brazil)/.test(s)) return 82;
      if (/(mls|major league soccer)/.test(s)) return 78;
      if (/(copa libertadores|libertadores)/.test(s)) return 80;
      if (/(copa sudamericana|sudamericana)/.test(s)) return 72;
      if (/(fa cup|copa del rey|coppa italia|dfb pokal)/.test(s)) return 70;
      return 40;
    };

    const genericLeagueScore = (sport: string, l: string) => {
      const s = l;
      if (sport === 'basketball') {
        if (/(nba)/.test(s)) return 100;
        if (/(euroleague|euroliga)/.test(s)) return 92;
        if (/(ncaa)/.test(s)) return 80;
        return 40;
      }
      if (sport === 'tennis') {
        if (/(grand slam|atp|wta)/.test(s)) return 90;
        if (/(challenger|itf)/.test(s)) return 60;
        return 40;
      }
      if (sport === 'hockey') {
        if (/(nhl)/.test(s)) return 95;
        if (/(khl)/.test(s)) return 80;
        return 40;
      }
      if (sport === 'baseball') {
        if (/(mlb)/.test(s)) return 95;
        if (/(npb|kbo)/.test(s)) return 80;
        return 40;
      }
      return 40;
    };

    const quotas: Record<string, number> = { soccer: 15, tennis: 10, basketball: 10, hockey: 5, baseball: 5 };
    const bySport: Record<string, any[]> = { soccer: [], tennis: [], basketball: [], hockey: [], baseball: [] };
    for (const ev of sortedUpcoming) {
      const sk = sportKey(ev);
      if (!(sk in bySport)) continue;
      bySport[sk].push(ev);
    }

    const pickSoccer = () => {
      const buckets: Record<number, any[]> = {};
      for (const ev of bySport.soccer) {
        const dk = Math.min(6, dayKey(ev));
        (buckets[dk] || (buckets[dk] = [])).push(ev);
      }
      for (const [k, arr] of Object.entries(buckets)) {
        arr.sort((a: any, b: any) => {
          const sa = soccerLeagueScore(leagueKey(a));
          const sb = soccerLeagueScore(leagueKey(b));
          if (sa !== sb) return sb - sa;
          return startTs(a) - startTs(b);
        });
        buckets[Number(k)] = arr;
      }
      const out: any[] = [];
      let guard = 0;
      while (out.length < quotas.soccer && guard < 400) {
        guard++;
        let progressed = false;
        for (let dk = 0; dk <= 6; dk++) {
          const arr = buckets[dk] || [];
          if (arr.length) {
            out.push(arr.shift());
            progressed = true;
          }
          if (out.length >= quotas.soccer) break;
        }
        if (!progressed) break;
      }
      return out;
    };

    const pickGeneric = (sport: 'tennis' | 'basketball' | 'hockey' | 'baseball') => {
      const arr = [...bySport[sport]];
      arr.sort((a: any, b: any) => {
        const sa = genericLeagueScore(sport, leagueKey(a));
        const sb = genericLeagueScore(sport, leagueKey(b));
        if (sa !== sb) return sb - sa;
        return startTs(a) - startTs(b);
      });
      return arr.slice(0, quotas[sport]);
    };

    const picksBySport: Record<string, any[]> = {
      soccer: pickSoccer(),
      tennis: pickGeneric('tennis'),
      basketball: pickGeneric('basketball'),
      hockey: pickGeneric('hockey'),
      baseball: pickGeneric('baseball'),
    };

    const order = ['soccer', 'tennis', 'basketball', 'hockey', 'baseball'];
    const result: any[] = [];
    for (const k of order) result.push(...(picksBySport[k] || []));
    return result.slice(0, 45);
  }, [sortedUpcoming, selectedCategory, query]);

  const showFeatured = mode === 'home' && String(selectedCategory || 'all').toLowerCase() === 'all' && !query.trim();

  const featuredSet = useMemo(() => {
    const s = new Set<string>();
    for (const e of featuredUpcoming as any[]) s.add(mergeKeyOf(e));
    return s;
  }, [featuredUpcoming]);

  const weekAll = useMemo(() => {
    if (mode !== 'live') return [];
    const cat = String(selectedCategory || 'all').toLowerCase();
    if (cat !== 'all') return [];
    if (query.trim()) return [];

    const sportKey = (ev: any) => {
      const s = String(ev?.sport || '').toLowerCase();
      if (s.includes('soccer') || (s.includes('football') && !s.includes('american')) || s.includes('futebol')) return 'soccer';
      if (s.includes('tennis') || s.includes('tênis') || s.includes('tenis')) return 'tennis';
      if (s.includes('basket')) return 'basketball';
      if (s.includes('hockey')) return 'hockey';
      if (s.includes('baseball')) return 'baseball';
      return 'other';
    };

    const order = new Map<string, number>([['soccer', 0], ['tennis', 1], ['basketball', 2], ['hockey', 3], ['baseball', 4]]);

    const now = Date.now();
    const d0 = new Date(now);
    d0.setHours(0, 0, 0, 0);
    const startOfToday = d0.getTime();
    const endOfWeek = startOfToday + 7 * 24 * 60 * 60 * 1000;

    const startTs = (ev: any) => new Date(ev?.event_date || ev?.start_time || ev?.fixture?.date || 0).getTime();

    const arr = sortedUpcoming
      .filter((e: any) => !featuredSet.has(mergeKeyOf(e)))
      .filter((e: any) => {
        const t = startTs(e);
        if (!Number.isFinite(t) || t <= 0) return false;
        return t >= startOfToday && t < endOfWeek;
      })
      .sort((a: any, b: any) => {
        const oa = order.get(sportKey(a)) ?? 9;
        const ob = order.get(sportKey(b)) ?? 9;
        if (oa !== ob) return oa - ob;
        return startTs(a) - startTs(b);
      });

    return arr;
  }, [mode, selectedCategory, query, sortedUpcoming, featuredSet]);

  const [weekLimit, setWeekLimit] = useState(20);
  useEffect(() => {
    setWeekLimit(20);
  }, [mode, selectedCategory, query, weekAll.length]);
  const weekSentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (mode !== 'live') return;
    const el = weekSentinelRef.current;
    if (!el) return;
    if (weekLimit >= weekAll.length) return;
    const obs = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      setWeekLimit((x) => Math.min(weekAll.length, x + 20));
    }, { root: null, rootMargin: '200px', threshold: 0.01 });
    obs.observe(el);
    return () => obs.disconnect();
  }, [mode, weekLimit, weekAll.length]);
  const weekVisible = useMemo(() => weekAll.slice(0, weekLimit), [weekAll, weekLimit]);

  // Strict separation: Desporto = pregame only | AO VIVO = live only
  const displayedLive    = mode === 'live' ? processedLive : [];
  const displayedUpcoming = mode === 'home' ? (showFeatured ? (featuredUpcoming as any) : sortedUpcoming) : [];

  const groupedLive = useGroupedEvents(displayedLive, query);
  const groupedUpcoming = useGroupedEvents(displayedUpcoming, query);

  const isLiveMode = mode === 'live';
  const { signals: liveSignals } = useBatchMarketSignals({ events: isLiveMode ? displayedLive : [], enabled: isLiveMode, maxEvents: 40 })

  const MAX_EVENTS = mode === 'live' ? 120 : 60; // live≤120, pregame≤60

  const limitedUpcoming = useMemo(() => {
    if (showFeatured) return [];
    let remaining = MAX_EVENTS;
    const result: [string, Event[]][] = [];

    for (const [league, events] of groupedUpcoming) {
      if (remaining <= 0) break;
      const take = Math.min(events.length, remaining);
      if (take > 0) {
        result.push([league, events.slice(0, take)]);
        remaining -= take;
      }
    }
    return result;
  }, [groupedUpcoming, showFeatured, MAX_EVENTS]);

  const noSearchResults = useMemo(() => {
    if (!query.trim()) return false;
    const liveCount = groupedLive.reduce((acc, [, ev]) => acc + ev.length, 0);
    const upCount = limitedUpcoming.reduce((acc, [, ev]) => acc + ev.length, 0);
    return liveCount + upCount === 0;
  }, [groupedLive, limitedUpcoming, query]);

  const handleOpenEvent = (event: Event) => {
    navigate(`/event/${event.id}`);
  };

  const multiplesSource = mode === 'home' ? displayedUpcoming : processedLive;

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
      .filter((e: any) => e && e.id != null)
      .filter((e: any) => String((e as any).home_team || '').trim() && String((e as any).away_team || '').trim())
      .map((e: any) => {
        const start = new Date((e as any).event_date || (e as any).start_time || (e as any).fixture?.date || 0).getTime();
        const sport = String((e as any).sport || 'soccer');
        return { e, start, sport };
      })
      .sort((a: any, b: any) => {
        const sa = a.sport === 'soccer' ? 0 : 1;
        const sb = b.sport === 'soccer' ? 0 : 1;
        if (sa !== sb) return sa - sb;
        return a.start - b.start;
      })
      .map((x: any) => x.e);

    const banners: Banner[] = [];
    let cursor = 0;
    for (let i = 0; i < 4; i++) {
      const picks: Pick[] = [];
      const used = new Set<string | number>();
      let guard = 0;
      while (picks.length < 4 && guard < candidates.length * 2) {
        const ev = candidates[cursor % Math.max(1, candidates.length)];
        cursor++;
        guard++;
        const key = String(ev?.id);
        if (used.has(key)) continue;
        const pick = pickFromEvent(ev);
        if (!pick) continue;
        if (pick.odd <= 1.05) continue;
        used.add(key);
        picks.push(pick);
      }
      if (picks.length === 4) {
        const totalOdd = picks.reduce((acc, p) => acc * p.odd, 1);
        const legsOddStr = picks.map((p) => p.odd.toFixed(2)).join(' × ');
        banners.push({ id: `multi_${i}`, picks, totalOdd, legsOddStr });
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
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); go(idx - 1); }}
              className={`px-2 py-1 rounded-lg text-xs font-bold ${darkMode ? 'bg-gray-800 text-gray-200 hover:bg-gray-750' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
            >
              ‹
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); go(idx + 1); }}
              className={`px-2 py-1 rounded-lg text-xs font-bold ${darkMode ? 'bg-gray-800 text-gray-200 hover:bg-gray-750' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
            >
              ›
            </button>
          </div>
        </div>

        <div className="relative w-full overflow-hidden">
          <div
            className="flex transition-transform duration-500"
            style={{ transform: `translateX(-${idx * 100}%)` }}
          >
            {slides.map((b) => (
              <div key={`${instanceKey}_${b.id}`} className="w-full shrink-0 p-4">
                <div className={`rounded-xl border p-5 ${darkMode ? 'bg-gray-950/40 border-gray-800' : 'bg-gray-50 border-gray-200'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-black uppercase tracking-wider">Múltipla de 4 eventos</div>
                      <div className={`text-xs mt-1 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>Odd total: {b.legsOddStr}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] uppercase tracking-wider opacity-70">Odds final</div>
                      <div className="text-2xl font-black text-red-600 tabular-nums">{b.totalOdd.toFixed(2)}</div>
                    </div>
                  </div>

                  <div className="mt-4 space-y-3 min-h-[240px]">
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
                      Aporte agora
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
    if (processedLive.length > 0 || upcomingEvents.length > 0) {
      setHasEverHadEvents(true);
    }
  }, [processedLive.length, upcomingEvents.length]);

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

      {/* Banner promocional */}
      {showBanner && ( 
   <section className="relative w-full overflow-hidden"> 
     {/* Fundo com gradiente animado + partículas */} 
     <div className="absolute inset-0 bg-gradient-to-r from-indigo-950 via-purple-950 to-pink-950 animate-gradient-x"></div> 
     
     {/* Partículas / faíscas douradas sutis */} 
     <div className="absolute inset-0 pointer-events-none"> 
       <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_30%,rgba(255,215,0,0.08)_0%,transparent_50%)] animate-pulse-slow"></div> 
       <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_70%,rgba(255,215,0,0.06)_0%,transparent_60%)] animate-pulse-slower"></div> 
     </div> 
 
     {/* Overlay de brilho/gloss */} 
     <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent animate-shine-slow"></div> 
 
     {/* Conteúdo principal */} 
    <div className="relative z-10 w-full mx-auto px-2 py-1 md:py-2 flex flex-col md:flex-row items-center justify-between gap-1 md:gap-2"> 
      {/* Texto */} 
      <div className="text-center md:text-left"> 
        <div className="inline-flex items-center gap-2 mb-1"> 
          <div className="w-6 h-6 rounded-full bg-gradient-to-br from-yellow-400 to-amber-500 flex items-center justify-center shadow-lg animate-pulse-slow"> 
            <svg className="w-3 h-3 text-gray-900" fill="currentColor" viewBox="0 0 24 24"> 
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" /> 
              <path d="M11 7h2v6h-2zM11 15h2v2h-2z" /> 
            </svg> 
          </div> 
          <h3 className="text-sm md:text-base font-extrabold uppercase tracking-wider bg-gradient-to-r from-yellow-300 via-amber-200 to-yellow-300 bg-clip-text text-transparent drop-shadow-lg"> 
            Boas-Vindas Exclusiva 
          </h3> 
        </div> 

        <p className="text-base md:text-lg font-bold text-white mb-0.5 drop-shadow-md"> 
          Deposite <span className="text-yellow-400">20€</span> e receba 
        </p> 

        <div className="flex flex-col md:flex-row items-center gap-2 md:gap-3 mb-1"> 
          <div className="text-2xl md:text-3xl font-black text-yellow-400 tracking-tight drop-shadow-2xl animate-pulse-slow"> 
            10€ FREE BET 
          </div> 
          <div className="text-xs md:text-sm text-gray-200 font-medium"> 
            após 4 apostas qualificadas 
          </div> 
        </div> 

        <p className="text-[10px] md:text-xs text-gray-300 max-w-lg mx-auto md:mx-0 leading-relaxed"> 
          Aproveite já esta oferta limitada. Apenas o lucro da freebet é sacável. Validade: 7 dias. 
        </p> 
      </div> 

      {/* Botão CTA com pulso e brilho */} 
      <Link 
        to="/deposit" 
        className="group relative inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 rounded-lg font-bold text-sm uppercase tracking-wider text-white shadow-xl shadow-green-900/40 transition-all duration-300 hover:shadow-green-500/60 hover:scale-105 active:scale-95 overflow-hidden" 
      > 
        {/* Efeito de brilho no botão */} 
        <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700 ease-out"></span> 

        <span className="relative z-10">Depositar Agora</span> 

        {/* Ícone animado */} 
        <svg className="w-4 h-4 relative z-10 group-hover:translate-x-1 transition-transform" fill="currentColor" viewBox="0 0 24 24"> 
          <path d="M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z" /> 
        </svg> 
      </Link> 
    </div> 
   </section> 
 )}

      <div className="flex items-start gap-4 w-full px-2 py-6">
        {/* Sidebar */}
        <aside className={`hidden lg:block w-72 shrink-0 sticky top-16 h-[calc(100vh-4rem)] overflow-y-auto ${darkMode ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'} border-r`}>
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
          {/* Banner Carousel */}
          <BannerCarousel />

          {/* Eventos */}
          <section>
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

            {loading ? (
              <div className="text-center py-20">
                <div className="animate-spin h-12 w-12 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-4"></div>
                <p className="text-gray-500">Carregando eventos...</p>
              </div>
            ) : (groupedLive.length > 0 || limitedUpcoming.length > 0 || (showFeatured && (featuredUpcoming as any[]).length > 0) || (mode === 'live' && weekVisible.length > 0)) ? (
              <div className="space-y-12">
                {/* LIVE SECTION — shown only in mode='live' */}
                {groupedLive.length > 0 && (
                  <div className="space-y-6">
                     <div className="space-y-8">
                        {(() => {
                          let globalIdx = 0;
                          return groupedLive.map(([league, events]) => (
                            <div key={`live-${league}`} className="space-y-4">
                            <div className={`px-5 py-3 rounded-xl font-bold text-sm uppercase tracking-wider flex items-center gap-4 ${darkMode ? 'bg-red-900/20 border border-red-900/50 text-red-100' : 'bg-red-50 border border-red-100 text-red-800'}`}>
                              {(() => {
                                const firstEvent = events[0] || {};
                                const leagueObj = firstEvent.league as any;
                                const leagueNameRaw = (typeof leagueObj === 'string' ? leagueObj : leagueObj?.name) || league;
                                const countryRaw = firstEvent.country || '';
                                const sport = firstEvent.sport || 'soccer';
                                const icon = getSportIcon(sport);
                                
                                const displayText = (countryRaw && leagueNameRaw && countryRaw !== leagueNameRaw) 
                                  ? `${countryRaw} - ${leagueNameRaw}` 
                                  : (leagueNameRaw || countryRaw || 'Unknown League');

                                return (
                                  <>
                                    <img src={icon} alt={sport} className="w-7 h-7 object-contain" />
                                    <span>{displayText}</span>
                                  </>
                                );
                              })()}
                            </div>
                            <div className="flex flex-col gap-4">
                              {(() => {
                                const out: any[] = [];
                                for (const ev of events) {
                                  out.push(
                                    <EventCard
                                      key={mergeKeyOf(ev)}
                                      event={ev}
                                      onOpenEvent={() => handleOpenEvent(ev)}
                                      signals={liveSignals[String((ev as any)?.id ?? (ev as any)?.fixture?.id ?? (ev as any)?.external_event_id ?? '')]}
                                    />,
                                  );
                                  globalIdx++;
                                }
                                return out;
                              })()}
                            </div>
                            </div>
                          ));
                        })()}
                     </div>
                  </div>
                )}

                {mode === 'live' && weekVisible.length > 0 && (
                  <div className="space-y-6">
                    <div className="flex items-center gap-3 px-2 pt-4 border-t border-gray-700/50">
                      <h2 className="text-xl font-bold uppercase tracking-wide">Jogos da Semana</h2>
                    </div>
                    <div className="flex flex-col gap-4">
                      {weekVisible.map((ev: any) => (
                        <EventCard
                          key={mergeKeyOf(ev)}
                          event={ev}
                          onOpenEvent={() => handleOpenEvent(ev)}
                        />
                      ))}
                    </div>
                    {weekLimit < weekAll.length && (
                      <div ref={weekSentinelRef} className="py-6 flex items-center justify-center">
                        <div className="flex items-center gap-3 text-sm font-bold text-gray-400">
                          <div className="animate-spin h-5 w-5 border-2 border-gray-500 border-t-transparent rounded-full" />
                          Carregando jogos da semana...
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {showFeatured && (featuredUpcoming as any[]).length > 0 && (
                  <div className="space-y-6">
                    <div className="flex items-center gap-3 px-2 pt-4 border-t border-gray-700/50">
                      <h2 className="text-xl font-bold uppercase tracking-wide">Destaques</h2>
                    </div>
                    <div className="flex flex-col gap-4">
                      {(() => {
                        const out: any[] = [];
                        let inserted = false;
                        let idx = 0;
                        for (const ev of featuredUpcoming as any[]) {
                          out.push(
                            <EventCard
                              key={mergeKeyOf(ev)}
                              event={ev}
                              onOpenEvent={() => handleOpenEvent(ev)}
                            />,
                          );
                          idx++;
                          if (!inserted && idx === 2) {
                            inserted = true;
                            out.push(<MultipleCarousel key="pre_multi_once" instanceKey="pre_once" />);
                          }
                        }
                        return out;
                      })()}
                    </div>
                  </div>
                )}

                {/* UPCOMING SECTION */}
                {(!showFeatured && limitedUpcoming.length > 0) && (
                  <div className="space-y-6">
                     {groupedLive.length > 0 && (
                        <div className="flex items-center gap-3 px-2 pt-4 border-t border-gray-700/50">
                           <h2 className="text-xl font-bold uppercase tracking-wide">Próximos Jogos</h2>
                        </div>
                     )}
                     
                     <div className="space-y-8">
                        {(() => {
                          let globalIdx = 0;
                          let inserted = false;
                          return limitedUpcoming.map(([league, events]) => (
                            <div key={`pre-${league}`} className="space-y-4">
                            <div className={`px-5 py-3 rounded-xl font-bold text-sm uppercase tracking-wider flex items-center gap-4 ${darkMode ? 'bg-gray-800' : 'bg-gray-200'}`}>
                              {(() => {
                                const firstEvent = events[0] || {};
                                const leagueObj = firstEvent.league as any;
                                const leagueNameRaw = (typeof leagueObj === 'string' ? leagueObj : leagueObj?.name) || league;
                                const countryRaw = firstEvent.country || '';
                                const sport = firstEvent.sport || 'soccer';
                                const icon = getSportIcon(sport);
                                
                                const displayText = (countryRaw && leagueNameRaw && countryRaw !== leagueNameRaw) 
                                  ? `${countryRaw} - ${leagueNameRaw}` 
                                  : (leagueNameRaw || countryRaw || 'Unknown League');

                                return (
                                  <>
                                    <img src={icon} alt={sport} className="w-7 h-7 object-contain" />
                                    <span>{displayText}</span>
                                  </>
                                );
                              })()}
                            </div>
                            <div className="flex flex-col gap-4">
                              {(() => {
                                const out: any[] = [];
                                for (const ev of events) {
                                  out.push(
                                    <EventCard
                                      key={mergeKeyOf(ev)}
                                      event={ev}
                                      onOpenEvent={() => handleOpenEvent(ev)}
                                    />,
                                  );
                                  globalIdx++;
                                  if (!inserted && globalIdx === 2) {
                                    inserted = true;
                                    out.push(<MultipleCarousel key="pre_multi_once" instanceKey="pre_once" />);
                                  }
                                }
                                return out;
                              })()}
                            </div>
                            </div>
                          ));
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
            ) : null}
          </section>
        </main>

        {/* BetSlip lateral */}
        <aside className={`hidden xl:block w-96 shrink-0 sticky top-16 h-[calc(100vh-4rem)] overflow-y-auto ${darkMode ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'} border-l`}>
          <div className="p-5">
            <BetSlip />
          </div>
        </aside>
      </div>
    </div>
  );
}

export default Home;
