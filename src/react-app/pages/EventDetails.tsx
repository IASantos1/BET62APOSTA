import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { createPortal } from 'react-dom'
import { useApp } from '@/react-app/contexts/AppContext'
import { apiFetch } from '@/react-app/utils/api'
import { useOddsSSE } from '@/react-app/hooks/useOddsSSE'
import { useLiveSSEUpdates } from '@/react-app/hooks/useLiveSSEUpdates'
import { BetSlip } from '@/react-app/components/BetSlip'
import { Sidebar } from '@/react-app/components/Sidebar'
import MatchTracker from '@/react-app/components/MatchTracker'
import { MemoSubOddsModel } from '@/react-app/components/SubOddsModel'
import { useLiveFeed } from '@/react-app/hooks/useLiveFeed'
import { useMergedEvents } from '@/react-app/hooks/useMergedEvents'
import { useSportsEvents } from '@/react-app/hooks/useSportsEvents'
import { useUpcomingCache } from '@/react-app/hooks/useUpcomingCache'
import { useTopLeagues } from '@/react-app/hooks/useTopLeagues'
// import { useEventLiveUpdates } from '@/react-app/hooks/useEventLiveUpdates' // Removed
import { abbreviateTeamName, labelOutcome } from '@/shared/helpers'
import { sanitizeMediaUrl } from '@/react-app/utils/media'

interface RosterPlayer { full_name: string; position?: string }
interface EventRoster { league: string; home: { team: string; players: RosterPlayer[] }; away: { team: string; players: RosterPlayer[] } }

export default function EventDetails() {
  const { id } = useParams()
  const { darkMode, addToBetSlip, selectedCategory, showMobileSidebar, setShowMobileSidebar } = useApp()
  const [event, setEvent] = useState<any>(null)
  const [roster, setRoster] = useState<EventRoster | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [liveStats, setLiveStats] = useState<{ stats: any[]; events: any[] }>({ stats: [], events: [] })
  const [standings, setStandings] = useState<any | null>(null)
  const [showMatchCenter, setShowMatchCenter] = useState(false);
  const [matchCenterTab, setMatchCenterTab] = useState<'center' | 'stats' | 'lineups' | 'standings'>('center');
  const [lineups, setLineups] = useState<any[] | null>(null);
  const [insights, setInsights] = useState<any | null>(null);
  const [oddsLockUntil, setOddsLockUntil] = useState<number>(0);
  const lastCriticalRef = useRef<string>('');
  
  // Data for Sidebar
  const { live, pregame } = useSportsEvents(selectedCategory || null);
  const { upcomingEvents } = useUpcomingCache(pregame);

  // WebSocket Live Feed (Fetch all for consistent Sidebar)
  const { liveEvents: wsLiveEvents } = useLiveFeed(selectedCategory || 'all');

  // Merge HTTP + WS for Sidebar
  const mergedSidebarLive = useMergedEvents(live, wsLiveEvents);
  const activeTopLeagues = useTopLeagues(mergedSidebarLive, upcomingEvents);

  // --- Merge HTTP + WS + Placeholder Odds (Current Event) ---
  // We use useMergedEvents to ensure consistent logic (placeholder odds, etc)
  const mergedEventList = useMergedEvents(event ? [event] : [], wsLiveEvents);
  
  const displayEvent = useMemo(() => {
     if (!event) return null;
     // Robust matching: Try ID, External ID, or Fixture ID
     return mergedEventList.find((e: any) => 
        String(e.id) === String(event.id) || 
        String(e.external_event_id) === String(event.id) ||
        String(e.fixture?.id) === String(event.id)
     ) || event;
  }, [mergedEventList, event]);

  // --- Real-time Score Updates (Removed - using Polling via useLiveFeed) ---
  // const { liveUpdates, isConnected: wsConnected } = useEventLiveUpdates(id);

  // Extract logos
  const DEFAULT_LOGO = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjY2NjIiBzdHJva2Utd2lkdGg9IjIiPjxjaXJjbGUgY3g9IjEyIiBjeT0iMTIiIHI9IjEwIi8+PHBhdGggZD0iTTEyIDh2OG0tNCAwaDgiLz48L3N2Zz4=';
  const homeTeamLogo = displayEvent?.home_team_logo || displayEvent?.teams?.home?.logo || displayEvent?.logo_home || DEFAULT_LOGO;
  const awayTeamLogo = displayEvent?.away_team_logo || displayEvent?.teams?.away?.logo || displayEvent?.logo_away || DEFAULT_LOGO;

  // Use displayEvent for helpers where possible, but keep existing helpers consistent
  // Actually, labelOutcome relies on displayEventWithOdds closure, but we should use the latest event if we want accurate team names (though they rarely change).
  // For safety, let's keep helpers using displayEventWithOdds for now as names don't change, 
  // but we must use displayEvent for rendering scores and status.

  // --- Helpers ---
  const handleLabelOutcome = useCallback((market: string, name: string) => {
    return labelOutcome(market, name, displayEvent?.home_team, displayEvent?.away_team);
  }, [displayEvent]);

  const applyMarginClamp = useCallback((_mk: string, v: number) => v, [])
  const cleanTeam = (name: string) => String(name || '').replace(/\sU\d+$/, '').trim()
  const formatScore = (val: any) => {
    if (typeof val === 'number') return val;
    return val?.total ?? val?.score ?? val?.current ?? 0;
  };

  const [realtimeOdds, setRealtimeOdds] = useState<any | null>(null);
  const wsEnabled = Boolean(event && (event as any).is_live === 1);
  const oddsEnabled = Boolean(id);
  const { markets: sseOdds, eventOdds: sseEventOdds, primaryOdds: ssePrimaryOdds } = useOddsSSE(String(id || ''), oddsEnabled);
  const sportForSse = useMemo(() => {
    const raw = String(id || '').trim();
    const m = raw.match(/^([a-z-]+)_/i);
    if (m?.[1]) return String(m[1]).toLowerCase();
    return String((event as any)?.sport || 'soccer').toLowerCase();
  }, [id, event]);
  const { updatesById: liveUpdatesById } = useLiveSSEUpdates(sportForSse, wsEnabled);

  // --- Fetch Event ---
  useEffect(() => {
    if (!id) return;
    const ac = new AbortController();
    
    const fetchEvent = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await apiFetch<any>(`/api/events/${id}`, { signal: ac.signal });
        setEvent(data);
        if (data.roster) setRoster(data.roster);
      } catch (err: any) {
        if (err.name !== 'AbortError') setError('Evento não encontrado ou indisponível.');
      } finally { setLoading(false); }
    };

    fetchEvent();
    return () => ac.abort();
  }, [id]);

  useEffect(() => {
    if (sseOdds && typeof sseOdds === 'object') setRealtimeOdds(sseOdds);
  }, [sseOdds]);

  useEffect(() => {
    if (!ssePrimaryOdds) return;
    const h = Number(ssePrimaryOdds.home_odd || 0);
    const d = Number(ssePrimaryOdds.draw_odd || 0);
    const a = Number(ssePrimaryOdds.away_odd || 0);
    if (!(h > 1) && !(d > 1) && !(a > 1)) return;
    setEvent((prev: any) => {
      if (!prev) return prev;
      return {
        ...prev,
        home_odd: h > 1 ? h : prev.home_odd,
        draw_odd: d > 1 ? d : prev.draw_odd,
        away_odd: a > 1 ? a : prev.away_odd,
      };
    });
  }, [ssePrimaryOdds]);

  useEffect(() => {
    if (!id) return;
    const u = liveUpdatesById.get(String(id));
    if (!u) return;
    setEvent((prev: any) => {
      if (!prev) return prev;
      return {
        ...prev,
        ...u,
        goals: u.goals ?? prev.goals,
        score: u.score ?? prev.score,
        status: u.status ?? prev.status,
        elapsed: u.elapsed ?? prev.elapsed,
        timer: u.timer ?? (prev as any).timer,
        home_odd: Number(u.home_odd || 0) > 1 ? u.home_odd : prev.home_odd,
        draw_odd: Number(u.draw_odd || 0) > 1 ? u.draw_odd : prev.draw_odd,
        away_odd: Number(u.away_odd || 0) > 1 ? u.away_odd : prev.away_odd,
      };
    });
  }, [id, liveUpdatesById]);

  // --- Fetch Live Stats (polling when live) ---
  useEffect(() => {
    if (!id) return;
    let timer: ReturnType<typeof setTimeout>;

    const fetchStats = async () => {
      try {
        const data = await apiFetch<any>(`/api/events/${id}/stats`);
        if (data && (data.stats?.length > 0 || data.events?.length > 0)) {
          setLiveStats(data);
        }
      } catch { /* silent */ }
    };

    fetchStats();
    const isLive = displayEvent?.is_live === 1 || (typeof displayEvent?.status === 'object' ? ['1H','2H','HT','ET','P'].includes(displayEvent?.status?.short) : false);
    if (isLive) {
      const intervalMs = String(displayEvent?.sport || '').toLowerCase() === 'soccer' ? 60000 : 15000;
      timer = setInterval(fetchStats, intervalMs);
    }
    return () => clearInterval(timer);
  }, [id, displayEvent?.is_live]);

  useEffect(() => {
    const evs = Array.isArray(liveStats?.events) ? liveStats.events : [];
    if (evs.length === 0) return;
    const last = evs[evs.length - 1];
    const elapsed = last?.time?.elapsed ?? '';
    const extra = last?.time?.extra ?? '';
    const type = String(last?.type || '');
    const detail = String(last?.detail || '');
    const team = String(last?.team?.id || last?.team?.name || '');
    const key = `${elapsed}|${extra}|${type}|${detail}|${team}`;
    if (!key || key === lastCriticalRef.current) return;
    lastCriticalRef.current = key;
    const upper = `${type} ${detail}`.toUpperCase();
    const isCritical =
      upper.includes('GOAL') ||
      upper.includes('VAR') ||
      upper.includes('PENALTY') ||
      upper.includes('BIG CHANCE') ||
      upper.includes('GREAT CHANCE');
    if (isCritical) setOddsLockUntil(Date.now() + 25000);
  }, [liveStats]);

  useEffect(() => {
    if (!id) return;
    if (!showMatchCenter) return;
    if (matchCenterTab !== 'standings') return;
    const ac = new AbortController();
    apiFetch<any>(`/api/events/${id}/standings?full=1`, { signal: ac.signal, cache: 'no-store' })
      .then((d) => setStandings(d && typeof d === 'object' ? d : null))
      .catch(() => setStandings(null));
    return () => ac.abort();
  }, [id, showMatchCenter, matchCenterTab]);

  useEffect(() => {
    if (!id) return;
    if (!showMatchCenter) return;
    if (matchCenterTab !== 'lineups') return;
    const ac = new AbortController();
    apiFetch<any>(`/api/events/${id}/lineups`, { signal: ac.signal, cache: 'no-store' })
      .then((d) => setLineups(Array.isArray(d?.lineups) ? d.lineups : []))
      .catch(() => setLineups([]));
    return () => ac.abort();
  }, [id, showMatchCenter, matchCenterTab]);

  useEffect(() => {
    if (!id) return;
    if (!showMatchCenter) return;
    if (matchCenterTab !== 'stats') return;
    const ac = new AbortController();
    apiFetch<any>(`/api/events/${id}/insights`, { signal: ac.signal, cache: 'no-store' })
      .then((d) => setInsights(d && typeof d === 'object' ? d : null))
      .catch(() => setInsights(null));
    return () => ac.abort();
  }, [id, showMatchCenter, matchCenterTab]);

  const onSelect = useCallback((label: string, odd: number) => {
    if (!displayEvent) return;
    addToBetSlip({
      id: String(Date.now() + Math.random()),
      event_id: Number(displayEvent.id),
      match: `${displayEvent.home_team} vs ${displayEvent.away_team}`,
      selection: label,
      odd: odd,
      stake: 0,
      league: displayEvent.league_name || displayEvent.league || displayEvent.sport_title || 'Desporto'
    });
  }, [displayEvent, addToBetSlip]);

  // ── Red card detection (must be before early returns – Rules of Hooks) ──────── 
  const redCards = useMemo(() => { 
    let home = Number((displayEvent as any)?.red_cards_home || 0); 
    let away = Number((displayEvent as any)?.red_cards_away || 0); 
    const evs = Array.isArray(liveStats?.events) ? liveStats.events : []; 
    const homeId = (displayEvent as any)?.teams?.home?.id ?? (displayEvent as any)?.fixture?.teams?.home?.id; 
    const awayId = (displayEvent as any)?.teams?.away?.id ?? (displayEvent as any)?.fixture?.teams?.away?.id; 
    if (evs.length > 0) { 
      let liveHome = 0, liveAway = 0; 
      for (const ev of evs) { 
        if (String(ev?.type || '').toLowerCase() === 'card' && 
            String(ev?.detail || '').toLowerCase().includes('red')) { 
          const teamId = ev?.team?.id; 
          if (teamId && homeId && teamId === homeId) liveHome++; 
          else if (teamId && awayId && teamId === awayId) liveAway++; 
        } 
      } 
      if (liveHome > 0 || liveAway > 0) { home = liveHome; away = liveAway; } 
    } 
    return { home, away }; 
  }, [displayEvent, liveStats]); 

  // ── Convert backend suspended_markets → SubOddsModel format ────────────────── 
  const suspendedMarketsConverted = useMemo(() => { 
    const raw = (displayEvent as any)?.suspended_markets; 
    if (!raw || typeof raw !== 'object') return []; 
    const eventId = Number((displayEvent as any)?.id || 0); 
    const result: { eventId: number; marketId: string; reason: string }[] = []; 
    if (Array.isArray(raw.correct_score_blocked) && raw.correct_score_blocked.length > 0) { 
      result.push({ eventId, marketId: 'correct_score', reason: 'GOAL' }); 
    } 
    if (typeof raw.totals_blocked_below === 'number' && raw.totals_blocked_below > 0) { 
      result.push({ eventId, marketId: 'totals', reason: 'GOAL' }); 
      result.push({ eventId, marketId: 'corners_totals', reason: 'GOAL' }); 
      result.push({ eventId, marketId: 'cards_totals', reason: 'GOAL' }); 
    } 
    return result; 
  }, [displayEvent]); 

  if (loading) return <div className="p-8 text-center"><div className="animate-spin h-8 w-8 border-4 border-red-600 border-t-transparent rounded-full mx-auto"></div></div>;
  if (error || !displayEvent) return <div className="p-8 text-center text-red-600">{error || 'Evento não encontrado'}</div>;

  const statusShort = typeof displayEvent.status === 'object' ? displayEvent.status?.short : displayEvent.status;
  const statusKey = String(statusShort || displayEvent?.fixture?.status?.short || '').toUpperCase().trim();
  const liveStatuses = new Set([
    'LIVE', '1H', '2H', 'HT', 'ET', 'BT', 'P',
    'Q1', 'Q2', 'Q3', 'Q4', 'OT',
    'P1', 'P2', 'P3',
    'S1', 'S2', 'S3', 'S4', 'S5',
    'IN', 'IN1', 'IN2', 'IN3', 'IN4', 'IN5', 'IN6', 'IN7', 'IN8', 'IN9',
    'IN_PROGRESS',
  ]);
  const isLive = displayEvent.is_live === 1 || liveStatuses.has(statusKey);
  const eventSport = String((displayEvent as any)?.sport || '').toLowerCase();
  const isSoccerEvent = eventSport.includes('soccer') || eventSport.includes('football') || eventSport.includes('futebol') || eventSport === '';
  const liveTimerRaw = String((displayEvent as any)?.timer || displayEvent?.fixture?.status?.timer || '').trim();
  const liveTimer = liveTimerRaw
    ? (liveTimerRaw.includes(':')
        ? liveTimerRaw
        : (() => {
            const n = Number(liveTimerRaw);
            if (!Number.isFinite(n) || n < 0) return '';
            const mm = String(Math.floor(n)).padStart(2, '0');
            return `${mm}:00`;
          })())
    : '';
  const liveElapsed = Number((displayEvent as any)?.elapsed ?? displayEvent?.fixture?.status?.elapsed ?? 0) || 0;

  return (
    <div className={`min-h-screen ${darkMode ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-900'}`}>
      
      {/* Mobile Sidebar Portal */}
      {showMobileSidebar && createPortal(
          <div className="fixed inset-0 z-50 lg:hidden">
              <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowMobileSidebar(false)} />
              <div className={`absolute left-0 top-0 bottom-0 w-64 ${darkMode ? 'bg-gray-800' : 'bg-white'} shadow-xl overflow-y-auto transform transition-transform duration-300`}>
                  <Sidebar dynamicTopItems={activeTopLeagues} />
              </div>
          </div>,
          document.body
      )}

      {/* Full Screen Goal Animation */}
      {displayEvent?.lastGoal && (
        <div className="fixed inset-0 flex items-center justify-center z-50 pointer-events-none">
          <div className="text-6xl md:text-9xl font-black text-yellow-400 animate-bounce drop-shadow-[0_5px_5px_rgba(0,0,0,0.8)]">
            GOL!!!
          </div>
        </div>
      )}

      <div className="w-full flex items-start gap-4">
        {/* Left Sidebar */}
        <aside className={`hidden lg:block w-64 shrink-0 sticky top-16 h-[calc(100vh-4rem)] overflow-y-auto ${darkMode ? 'bg-gray-800' : 'bg-white'} border-r ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
          <div className="p-4 space-y-4">
             <Sidebar dynamicTopItems={activeTopLeagues} />
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 min-w-0 pb-20 mt-4">
          {/* Header & Score */}
          <div className={`relative h-48 md:h-64 rounded-xl overflow-hidden mb-6 ${darkMode ? 'bg-gray-800' : 'bg-gradient-to-r from-red-700 to-red-900'}`}>
            <div className="absolute inset-0 bg-black/30"></div>
            <div className="relative z-10 h-full flex flex-col justify-center items-center p-4">
              <div className="flex items-center justify-between w-full max-w-3xl px-4 md:px-12">
                <div className="flex flex-col items-center gap-2">
                    <img src={homeTeamLogo} alt={displayEvent.home_team} className="w-16 h-16 md:w-24 md:h-24 object-contain drop-shadow-lg bg-white/10 rounded-full p-2" onError={(e) => e.currentTarget.style.display = 'none'} />
                    <div className="flex items-center gap-1.5"> 
                      <span className="text-lg md:text-2xl font-bold text-white text-center">{cleanTeam(displayEvent.home_team)}</span> 
                      {isLive && redCards.home > 0 && ( 
                        <span title={`${redCards.home} cartão(s) vermelho(s)`} className="relative inline-block"> 
                          <span className="inline-block w-3.5 h-5 bg-red-600 rounded-[2px] shadow-md border border-red-800" /> 
                          {redCards.home > 1 && ( 
                            <span className="absolute -top-1.5 -right-1.5 min-w-[14px] h-3.5 px-0.5 rounded-full bg-white text-red-600 text-[9px] font-extrabold flex items-center justify-center leading-none border border-red-600"> 
                              {redCards.home} 
                            </span> 
                          )} 
                        </span> 
                      )} 
                    </div> 
                </div>
                
                <div className="text-center mx-4">
                   <div className={`text-4xl md:text-6xl font-black text-white transition-all duration-300 ${displayEvent.lastGoal ? 'scale-125 text-green-400' : ''}`}>
                     {isLive 
                       ? `${formatScore(displayEvent.goals?.home)} - ${formatScore(displayEvent.goals?.away)}` 
                       : 'VS'} 
                   </div> 
                   {isLive && ( 
                     <div className="text-sm md:text-lg text-white/90 mt-1 flex items-center justify-center gap-2"> 
                       <span className="font-din font-bold bg-black/30 px-2 py-0.5 rounded">{statusShort || displayEvent.fixture?.status?.short}</span>
                       <span className="font-din font-bold bg-red-600 px-2 py-0.5 rounded">
                         {liveTimer || (liveElapsed > 0 ? `${liveElapsed}'` : '')}
                       </span> 
                       {isLive && <span className="ml-1 flex h-2 w-2 relative" title="A receber actualizações">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                       </span>} 
                     </div> 
                   )} 
                   {displayEvent.lastGoal && (
                       <div className="text-green-400 font-bold animate-bounce mt-1 text-lg">GOL!</div>
                   )}
                 </div>

                <div className="flex flex-col items-center gap-2">
                    <img src={awayTeamLogo} alt={displayEvent.away_team} className="w-16 h-16 md:w-24 md:h-24 object-contain drop-shadow-lg bg-white/10 rounded-full p-2" onError={(e) => e.currentTarget.style.display = 'none'} />
                    <div className="flex items-center gap-1.5"> 
                      {isLive && redCards.away > 0 && ( 
                        <span title={`${redCards.away} cartão(s) vermelho(s)`} className="relative inline-block"> 
                          <span className="inline-block w-3.5 h-5 bg-red-600 rounded-[2px] shadow-md border border-red-800" /> 
                          {redCards.away > 1 && ( 
                            <span className="absolute -top-1.5 -right-1.5 min-w-[14px] h-3.5 px-0.5 rounded-full bg-white text-red-600 text-[9px] font-extrabold flex items-center justify-center leading-none border border-red-600"> 
                              {redCards.away} 
                            </span> 
                          )} 
                        </span> 
                      )} 
                      <span className="text-lg md:text-2xl font-bold text-white text-center">{cleanTeam(displayEvent.away_team)}</span> 
                    </div> 
                </div>
              </div>
            </div>
          </div>

          {/* Match Center */}
          {(
            <div className={`rounded-xl overflow-hidden shadow-lg mb-6 ${darkMode ? 'bg-gray-800' : 'bg-white'}`}>
              <div className="w-full p-3 flex items-center justify-between gap-3 hover:bg-gray-50 dark:hover:bg-gray-700 transition">
                <button
                  onClick={() => setShowMatchCenter((v) => { const next = !v; if (next) setMatchCenterTab('center'); return next; })}
                  className="flex items-center gap-2 font-bold"
                >
                  <span>Match Center</span><span className="text-sm">{showMatchCenter ? '▲' : '▼'}</span>
                </button>
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={() => { setShowMatchCenter(true); setMatchCenterTab('stats'); }}
                    className={`px-3 py-1 rounded-lg text-xs font-bold border ${showMatchCenter && matchCenterTab !== 'center' ? (darkMode ? 'bg-gray-900 border-gray-700 text-white' : 'bg-gray-100 border-gray-300 text-gray-900') : (darkMode ? 'bg-gray-800 border-gray-700 text-gray-200' : 'bg-white border-gray-200 text-gray-800')}`}
                  >
                    Estatísticas
                  </button>
                </div>
              </div>
              {showMatchCenter && (
                <div id="match-center" className="p-4 border-t border-gray-200 dark:border-gray-700">
                  {matchCenterTab !== 'center' && (
                    <div className="mb-4 flex items-center gap-2 flex-wrap">
                      <button
                        onClick={() => setMatchCenterTab('stats')}
                        className={`px-3 py-1 rounded-lg text-xs font-bold border ${matchCenterTab === 'stats' ? (darkMode ? 'bg-gray-900 border-gray-700 text-white' : 'bg-gray-100 border-gray-300 text-gray-900') : (darkMode ? 'bg-gray-800 border-gray-700 text-gray-200' : 'bg-white border-gray-200 text-gray-800')}`}
                      >
                        Estatísticas
                      </button>
                      {isSoccerEvent && (
                        <button
                          onClick={() => setMatchCenterTab('lineups')}
                          className={`px-3 py-1 rounded-lg text-xs font-bold border ${matchCenterTab === 'lineups' ? (darkMode ? 'bg-gray-900 border-gray-700 text-white' : 'bg-gray-100 border-gray-300 text-gray-900') : (darkMode ? 'bg-gray-800 border-gray-700 text-gray-200' : 'bg-white border-gray-200 text-gray-800')}`}
                        >
                          Escalação
                        </button>
                      )}
                      {isSoccerEvent && (
                        <button
                          onClick={() => setMatchCenterTab('standings')}
                          className={`px-3 py-1 rounded-lg text-xs font-bold border ${matchCenterTab === 'standings' ? (darkMode ? 'bg-gray-900 border-gray-700 text-white' : 'bg-gray-100 border-gray-300 text-gray-900') : (darkMode ? 'bg-gray-800 border-gray-700 text-gray-200' : 'bg-white border-gray-200 text-gray-800')}`}
                        >
                          Classificação
                        </button>
                      )}
                    </div>
                  )}
                  {matchCenterTab === 'center' && (
                    <MatchTracker 
                      live={{ ...displayEvent, fixture: { ...(displayEvent.fixture || {}), stats: liveStats.stats, events: liveStats.events } }} 
                      homeName={displayEvent.home_team}
                      awayName={displayEvent.away_team}
                      leagueName={displayEvent.league_name}
                      sportName={displayEvent.sport}
                      darkMode={darkMode} 
                    />
                  )}

                  {matchCenterTab === 'stats' && (() => {
                    const homeName = String(displayEvent.home_team || '');
                    const awayName = String(displayEvent.away_team || '');

                    const homeOdd = Number(displayEvent.home_odd || 0);
                    const drawOdd = Number(displayEvent.draw_odd || 0);
                    const awayOdd = Number(displayEvent.away_odd || 0);
                    const inv = [homeOdd, drawOdd, awayOdd].map((o) => (o > 1.01 ? (1 / o) : 0));
                    const sumInv = inv.reduce((a, b) => a + b, 0) || 1;
                    const pHome = Math.round((inv[0] / sumInv) * 100);
                    const pDraw = Math.round((inv[1] / sumInv) * 100);
                    const pAway = Math.round((inv[2] / sumInv) * 100);

                    const inx = insights || {};
                    const league = inx.league || {};
                    const h = inx.home || {};
                    const a = inx.away || {};
                    const h2h = inx.h2h || {};

                    const nf2 = (v: any) => {
                      const n = Number(v);
                      return Number.isFinite(n) ? n.toFixed(2) : '—';
                    };
                    const nf0 = (v: any) => {
                      const n = Number(v);
                      return Number.isFinite(n) ? String(Math.round(n)) : '—';
                    };
                    const pct0 = (v: any) => {
                      const n = Number(v);
                      return Number.isFinite(n) ? `${Math.round(n)}%` : '—';
                    };

                    const avgGoals = (() => {
                      const x = Number(h?.metrics?.avg_total_goals);
                      const y = Number(a?.metrics?.avg_total_goals);
                      if (!Number.isFinite(x) || !Number.isFinite(y)) return NaN;
                      return (x + y) / 2;
                    })();
                    const over15 = (() => {
                      const x = Number(h?.metrics?.over_15_pct);
                      const y = Number(a?.metrics?.over_15_pct);
                      if (!Number.isFinite(x) || !Number.isFinite(y)) return NaN;
                      return (x + y) / 2;
                    })();
                    const over25 = (() => {
                      const x = Number(h?.metrics?.over_25_pct);
                      const y = Number(a?.metrics?.over_25_pct);
                      if (!Number.isFinite(x) || !Number.isFinite(y)) return NaN;
                      return (x + y) / 2;
                    })();
                    const btts = (() => {
                      const x = Number(h?.metrics?.btts_pct);
                      const y = Number(a?.metrics?.btts_pct);
                      if (!Number.isFinite(x) || !Number.isFinite(y)) return NaN;
                      return (x + y) / 2;
                    })();

                    const statItems = Array.isArray(liveStats.stats) ? liveStats.stats : [];
                    const sumType = (type: string) => {
                      let total = 0;
                      for (const side of statItems) {
                        const arr = Array.isArray(side?.statistics) ? side.statistics : [];
                        for (const s of arr) {
                          if (String(s?.type || '') === type) {
                            const v = typeof s?.value === 'number' ? s.value : Number(String(s?.value || '0').replace('%', '').replace(',', '.'));
                            if (Number.isFinite(v)) total += v;
                          }
                        }
                      }
                      return total;
                    };
                    const matchCorners = sumType('Corner Kicks');
                    const matchCards = sumType('Yellow Cards') + sumType('Red Cards');

                    const lastHome = Array.isArray(h?.last) ? h.last : [];
                    const lastAway = Array.isArray(a?.last) ? a.last : [];

                    const rowBox = (left: { label: string; value: string; sub?: string }, right: { label: string; value: string; sub?: string }) => (
                      <div className="grid grid-cols-2 gap-5">
                        <div>
                          <div className="flex items-baseline justify-between gap-2">
                            <div className="text-sm font-semibold text-gray-200">{left.label}</div>
                            <div className="text-xl font-extrabold text-gray-50">{left.value}</div>
                          </div>
                          {left.sub ? <div className="text-xs text-gray-400 mt-0.5">{left.sub}</div> : null}
                        </div>
                        <div>
                          <div className="flex items-baseline justify-between gap-2">
                            <div className="text-sm font-semibold text-gray-200">{right.label}</div>
                            <div className="text-xl font-extrabold text-gray-50">{right.value}</div>
                          </div>
                          {right.sub ? <div className="text-xs text-gray-400 mt-0.5">{right.sub}</div> : null}
                        </div>
                      </div>
                    );

                    const ProbRow = ({ label, pct, color }: { label: string; pct: number; color: string }) => (
                      <div className="grid grid-cols-[auto,1fr,auto] gap-3 items-center">
                        <div className="text-sm font-bold text-gray-100">{label}</div>
                        <div className="h-3 rounded bg-black/30 overflow-hidden">
                          <div className={`h-full ${color}`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
                        </div>
                        <div className="text-sm font-bold text-gray-100">{pct}%</div>
                      </div>
                    );

                    const GameRow = ({ m }: { m: any }) => (
                      <div className="flex items-center justify-between gap-3 py-2 border-t border-white/10">
                        <div className="flex items-center gap-2 min-w-0">
                          {m?.opponent_logo ? <img src={sanitizeMediaUrl(String(m.opponent_logo))} alt="" className="w-5 h-5 object-contain" /> : null}
                          <div className="text-sm text-gray-100 truncate">{String(m?.title || '')}</div>
                        </div>
                        <div className="text-sm font-bold text-gray-100 whitespace-nowrap">{String(m?.score || '')}</div>
                      </div>
                    );

                    return (
                      <div className="rounded-xl border border-white/10 bg-gradient-to-br from-gray-900 via-gray-900/80 to-gray-950">
                        <div className="p-4">
                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                            <div className="rounded-xl border border-white/10 bg-black/25">
                              <div className="px-4 py-2 text-xs font-extrabold tracking-wide text-red-500 border-b border-white/10">FRENTE A FRENTE - MÉDIA EQUIPAS</div>
                              <div className="px-4 py-4 space-y-4">
                                {rowBox(
                                  { label: 'Golos Marcados', value: nf2(avgGoals), sub: Number.isFinite(Number(league?.avg_goals_per_match)) ? `Liga: ${nf2(league.avg_goals_per_match)}` : undefined },
                                  { label: 'AEM', value: pct0(btts), sub: Number.isFinite(Number(league?.btts_pct)) ? `Liga: ${pct0(league.btts_pct)}` : undefined },
                                )}
                                {rowBox(
                                  { label: 'Mais de 1.5', value: pct0(over15), sub: Number.isFinite(Number(league?.over_15_pct)) ? `Liga: ${pct0(league.over_15_pct)}` : undefined },
                                  { label: 'Mais de 2.5', value: pct0(over25), sub: Number.isFinite(Number(league?.over_25_pct)) ? `Liga: ${pct0(league.over_25_pct)}` : undefined },
                                )}
                                {rowBox(
                                  { label: 'Total Cartões', value: nf2(matchCards) },
                                  { label: 'Cantos', value: nf2(matchCorners) },
                                )}
                              </div>
                            </div>

                            <div className="rounded-xl border border-white/10 bg-black/25">
                              <div className="px-4 py-2 text-xs font-extrabold tracking-wide text-red-500 border-b border-white/10">PROBABILIDADE DE VITÓRIA</div>
                              <div className="px-4 py-4 space-y-4">
                                <div className="space-y-2">
                                  <ProbRow label={abbreviateTeamName(homeName)} pct={pHome} color="bg-blue-500" />
                                  <ProbRow label="Empate" pct={pDraw} color="bg-yellow-500" />
                                  <ProbRow label={abbreviateTeamName(awayName)} pct={pAway} color="bg-red-500" />
                                </div>
                                <div className="grid grid-cols-3 gap-3 pt-2 border-t border-white/10">
                                  <div className="text-center">
                                    <div className="text-2xl font-extrabold text-blue-400">{nf0(h2h?.home_wins)}</div>
                                    <div className="text-xs font-bold text-blue-300">Vitórias {abbreviateTeamName(homeName)}</div>
                                  </div>
                                  <div className="text-center">
                                    <div className="text-2xl font-extrabold text-yellow-400">{nf0(h2h?.draws)}</div>
                                    <div className="text-xs font-bold text-yellow-300">Empates</div>
                                  </div>
                                  <div className="text-center">
                                    <div className="text-2xl font-extrabold text-red-400">{nf0(h2h?.away_wins)}</div>
                                    <div className="text-xs font-bold text-red-300">Vitórias {abbreviateTeamName(awayName)}</div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>

                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
                            <div className="rounded-xl border border-white/10 bg-black/25">
                              <div className="px-4 py-2 text-xs font-extrabold tracking-wide text-blue-400 border-b border-white/10">{`ÚLTIMOS JOGOS - ${abbreviateTeamName(homeName)}`}</div>
                              <div className="px-4 pb-3">
                                {lastHome.length === 0 ? (
                                  <div className="py-3 text-sm text-gray-300">Sem jogos recentes.</div>
                                ) : (
                                  <div>
                                    {lastHome.slice(0, 6).map((m: any, i: number) => <GameRow key={i} m={m} />)}
                                  </div>
                                )}
                              </div>
                            </div>
                            <div className="rounded-xl border border-white/10 bg-black/25">
                              <div className="px-4 py-2 text-xs font-extrabold tracking-wide text-red-400 border-b border-white/10">{`ÚLTIMOS JOGOS - ${abbreviateTeamName(awayName)}`}</div>
                              <div className="px-4 pb-3">
                                {lastAway.length === 0 ? (
                                  <div className="py-3 text-sm text-gray-300">Sem jogos recentes.</div>
                                ) : (
                                  <div>
                                    {lastAway.slice(0, 6).map((m: any, i: number) => <GameRow key={i} m={m} />)}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {matchCenterTab === 'lineups' && (() => {
                    const ls = Array.isArray(lineups) ? lineups : [];
                    const home = ls[0] || null;
                    const away = ls[1] || null;
                    const pickPlayers = (arr: any[]) => {
                      const list = Array.isArray(arr) ? arr : [];
                      const out = list.map((x: any) => x?.player || x?.player_name || x?.name || x).filter(Boolean);
                      return out;
                    };
                    const initials = (name: string) =>
                      String(name || '')
                        .split(' ')
                        .filter(Boolean)
                        .slice(0, 2)
                        .map((p) => p[0]?.toUpperCase())
                        .join('');
                    const renderPlayerRow = (p: any, idx: number) => {
                      const name = String(p?.name || p?.player_name || p || '');
                      const num = p?.number ? `#${p.number}` : '';
                      const photo = sanitizeMediaUrl(String(p?.photo || p?.player?.photo || '').trim());
                      return (
                        <div key={`${name}-${idx}`} className="flex items-center justify-between gap-3 py-2 border-t border-white/10">
                          <div className="flex items-center gap-3 min-w-0">
                            {photo ? (
                              <img src={photo} alt="" className="w-8 h-8 rounded-full object-cover bg-white/10" />
                            ) : (
                              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-extrabold ${darkMode ? 'bg-gray-800 text-gray-200' : 'bg-gray-200 text-gray-700'}`}>
                                {initials(name) || '—'}
                              </div>
                            )}
                            <div className="min-w-0">
                              <div className={`text-sm font-semibold truncate ${darkMode ? 'text-gray-100' : 'text-gray-900'}`}>{name}</div>
                            </div>
                          </div>
                          <div className={`text-xs font-bold whitespace-nowrap ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>{num}</div>
                        </div>
                      );
                    };
                    const renderSide = (side: any, fallbackName: string) => {
                      const teamName = String(side?.team?.name || fallbackName);
                      const formation = String(side?.formation || '');
                      const xi = pickPlayers(side?.startXI);
                      const subs = pickPlayers(side?.substitutes);
                      return (
                        <div className={`rounded-xl border p-4 ${darkMode ? 'bg-gray-900/40 border-gray-700' : 'bg-gray-50 border-gray-200'}`}>
                          <div className="flex items-center justify-between gap-3">
                            <div className={`font-bold ${darkMode ? 'text-white' : 'text-gray-900'}`}>{teamName}</div>
                            {formation && <div className={`text-xs font-bold ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>{formation}</div>}
                          </div>
                          <div className="mt-3">
                            <div className={`text-xs font-extrabold ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Titulares</div>
                            <div className="mt-2">
                              {xi.length === 0 ? <div className={`${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Sem dados.</div> : xi.map(renderPlayerRow)}
                            </div>
                          </div>
                          <div className="mt-4">
                            <div className={`text-xs font-extrabold ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Suplentes</div>
                            <div className="mt-2">
                              {subs.length === 0 ? <div className={`${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Sem dados.</div> : subs.map(renderPlayerRow)}
                            </div>
                          </div>
                        </div>
                      );
                    };
                    return (
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        {renderSide(home, String(displayEvent.home_team || 'Casa'))}
                        {renderSide(away, String(displayEvent.away_team || 'Fora'))}
                      </div>
                    );
                  })()}

                  {matchCenterTab === 'standings' && (() => {
                    const table = Array.isArray(standings?.table) ? standings.table : [];
                    const homeTeam = String(displayEvent.home_team || '').toLowerCase();
                    const awayTeam = String(displayEvent.away_team || '').toLowerCase();
                    const formLabel = (c: string) => {
                      const u = c.toUpperCase();
                      if (u === 'W') return 'V';
                      if (u === 'L') return 'D';
                      if (u === 'D') return 'E';
                      if (u === 'V' || u === 'E' || u === 'D') return u;
                      return u;
                    };
                    const formColor = (c: string) => {
                      const lbl = formLabel(c);
                      if (lbl === 'V') return 'bg-green-600';
                      if (lbl === 'D') return 'bg-red-600';
                      return 'bg-yellow-500';
                    };
                    const legend = Array.from(new Set(table.map((r: any) => String(r?.description || '').trim()).filter(Boolean))) as string[];
                    return (
                      <div className={`rounded-xl border ${darkMode ? 'bg-gray-900/30 border-gray-700' : 'bg-gray-50 border-gray-200'}`}>
                        <div className="p-4">
                          <div className={`text-sm font-bold mb-3 ${darkMode ? 'text-white' : 'text-gray-900'}`}>Classificação</div>
                          {table.length === 0 ? (
                            <div className={`${darkMode ? 'text-gray-300' : 'text-gray-700'} text-sm`}>Sem dados de classificação.</div>
                          ) : (
                            <div className="overflow-x-auto">
                              <table className="w-full text-sm">
                                <thead>
                                  <tr className={`${darkMode ? 'text-gray-300' : 'text-gray-700'} text-xs`}>
                                    <th className="text-left py-2 pr-2">#</th>
                                    <th className="text-left py-2 pr-2">Equipa</th>
                                    <th className="text-right py-2 px-2">J</th>
                                    <th className="text-right py-2 px-2">V</th>
                                    <th className="text-right py-2 px-2">E</th>
                                    <th className="text-right py-2 px-2">D</th>
                                    <th className="text-right py-2 px-2">G</th>
                                    <th className="text-right py-2 px-2">DG</th>
                                    <th className="text-right py-2 pl-2">Pts</th>
                                    <th className="text-right py-2 pl-2">Forma</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {table.map((r: any) => {
                                    const name = String(r?.team?.name || '');
                                    const n = name.toLowerCase();
                                    const isFocus = (homeTeam && n.includes(homeTeam)) || (awayTeam && n.includes(awayTeam));
                                    const form = String(r?.form || '').trim();
                                    const last5 = form ? form.slice(-5).split('') : [];
                                    const hGoals = Number((displayEvent as any)?.goals?.home || 0);
                                    const aGoals = Number((displayEvent as any)?.goals?.away || 0);
                                    const sportName = String((displayEvent as any)?.sport || '').toLowerCase();
                                    const isSoccer = sportName.includes('soccer') || sportName.includes('football') || sportName.includes('futebol');
                                    const statusShort = String((displayEvent as any)?.fixture?.status?.short || (displayEvent as any)?.status || '').toUpperCase();
                                    const isLive = Boolean((displayEvent as any)?.is_live) || (statusShort && statusShort !== 'NS' && statusShort !== 'TBD' && statusShort !== 'PST');
                                    let nameClass = 'font-bold truncate';
                                    if (isFocus) {
                                      if (n.includes(homeTeam) && hGoals > aGoals) nameClass += ' text-green-500';
                                      else if (n.includes(homeTeam) && hGoals < aGoals) nameClass += ' text-red-500';
                                      else if (n.includes(awayTeam) && aGoals > hGoals) nameClass += ' text-green-500';
                                      else if (n.includes(awayTeam) && aGoals < hGoals) nameClass += ' text-red-500';
                                      else if ((n.includes(homeTeam) || n.includes(awayTeam)) && hGoals === aGoals) nameClass += ' text-yellow-400';
                                    }
                                    const showLiveBadge = Boolean(isSoccer && isLive && isFocus && (n.includes(homeTeam) || n.includes(awayTeam)));
                                    const isHomeRow = n.includes(homeTeam);
                                    const badgeScore = isHomeRow ? hGoals : aGoals;
                                    const badgeColor =
                                      hGoals === aGoals
                                        ? 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30'
                                        : ((isHomeRow && hGoals > aGoals) || (!isHomeRow && aGoals > hGoals))
                                          ? 'bg-green-600/20 text-green-300 border-green-600/30'
                                          : 'bg-red-600/20 text-red-300 border-red-600/30';
                                    return (
                                      <tr key={`${r.rank}-${name}`} className={`${isFocus ? (darkMode ? 'bg-gray-800/60' : 'bg-white') : ''} ${darkMode ? 'border-gray-800' : 'border-gray-200'} border-t`}>
                                        <td className="py-2 pr-2 font-bold">{Number(r.rank || 0)}</td>
                                        <td className="py-2 pr-2">
                                          <div className="flex items-center gap-2">
                                            {r?.team?.logo ? <img src={sanitizeMediaUrl(String(r.team.logo))} alt="" className="w-5 h-5 object-contain" /> : null}
                                            <div className={nameClass}>{name}</div>
                                            {showLiveBadge && (
                                              <span className={`ml-1 px-2 py-0.5 rounded-md border text-xs font-extrabold ${badgeColor}`}>{badgeScore}</span>
                                            )}
                                          </div>
                                        </td>
                                        <td className="py-2 px-2 text-right">{Number(r.played || 0)}</td>
                                        <td className="py-2 px-2 text-right">{Number(r.win || 0)}</td>
                                        <td className="py-2 px-2 text-right">{Number(r.draw || 0)}</td>
                                        <td className="py-2 px-2 text-right">{Number(r.lose || 0)}</td>
                                        <td className="py-2 px-2 text-right">{String(r.goals || '')}</td>
                                        <td className="py-2 px-2 text-right">{Number(r.goals_diff || 0)}</td>
                                        <td className="py-2 pl-2 text-right font-extrabold">{Number(r.points || 0)}</td>
                                        <td className="py-2 pl-2 text-right">
                                          <div className="inline-flex items-center gap-1 justify-end">
                                            {last5.map((c: string, i: number) => (
                                              <span key={i} className={`w-4 h-4 rounded-sm ${formColor(c)} text-[10px] font-extrabold text-white flex items-center justify-center`}>{formLabel(c)}</span>
                                            ))}
                                          </div>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          )}

                          {legend.length > 0 && (
                            <div className={`mt-4 text-xs ${darkMode ? 'text-gray-300' : 'text-gray-700'} space-y-1`}>
                              {legend.slice(0, 8).map((t) => (
                                <div key={String(t)}>{t}</div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          )}

          {/* Odds */}
          <MemoSubOddsModel
            event={displayEvent}
            darkMode={darkMode}
            markets={realtimeOdds ?? (displayEvent.odds ?? null)}
            eventOdds={sseEventOdds ?? (realtimeOdds ?? (displayEvent.odds ?? null))}
            liveMetrics={(() => {
              const stats = Array.isArray(liveStats.stats) ? liveStats.stats : [];
              const sumVal = (type: string) => {
                let total = 0;
                for (const side of stats) {
                  const arr = Array.isArray(side?.statistics) ? side.statistics : [];
                  for (const s of arr) {
                    if (String(s?.type || '') === type) {
                      const v = typeof s?.value === 'number' ? s.value : Number(String(s?.value || '0').replace('%','').replace(',', '.'));
                      if (Number.isFinite(v)) total += v;
                    }
                  }
                }
                return total;
              };
              return {
                goals: Number(displayEvent?.goals?.home || 0) + Number(displayEvent?.goals?.away || 0),
                corners: sumVal('Corner Kicks'),
                cards: sumVal('Yellow Cards') + sumVal('Red Cards'),
              };
            })()}
            oddsLockUntil={oddsLockUntil}
            onSelect={onSelect}
            labelOutcome={handleLabelOutcome}
            applyMarginClamp={applyMarginClamp}
            suspendedMarkets={suspendedMarketsConverted}
          />
        </main>

        {/* Right Sidebar */}
        <aside className={`hidden xl:block w-80 shrink-0 sticky top-16 h-[calc(100vh-4rem)] overflow-y-auto ${darkMode ? 'bg-gray-800' : 'bg-white'} border-l ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
          <div className="p-4 space-y-4">
              <BetSlip />
              {roster && (
                <div className={`p-3 rounded-2xl ${darkMode ? 'bg-gray-800 border border-gray-700' : 'bg-white border border-gray-200'}`}>
                  <div className={`font-bold mb-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>Plantel 2025-26</div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <div className={`font-semibold ${darkMode ? 'text-white' : 'text-gray-900'}`}>{roster.home.team}</div>
                      <ul className={`${darkMode ? 'text-gray-300' : 'text-gray-700'} text-sm space-y-1`}>{roster.home.players.map((p,i)=> (<li key={i}>{p.full_name}{p.position ? ` (${p.position})` : ''}</li>))}</ul>
                    </div>
                    <div>
                      <div className={`font-semibold ${darkMode ? 'text-white' : 'text-gray-900'}`}>{roster.away.team}</div>
                      <ul className={`${darkMode ? 'text-gray-300' : 'text-gray-700'} text-sm space-y-1`}>{roster.away.players.map((p,i)=> (<li key={i}>{p.full_name}{p.position ? ` (${p.position})` : ''}</li>))}</ul>
                    </div>
                  </div>
                </div>
              )}
          </div>
        </aside>
      </div>
    </div>
  )
}
