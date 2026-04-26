import { useEffect, useMemo, useState, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { createPortal } from 'react-dom'
import { useApp } from '@/react-app/contexts/AppContext'
import { apiFetch } from '@/react-app/utils/api'
import { BetSlip } from '@/react-app/components/BetSlip'
import { Sidebar } from '@/react-app/components/Sidebar'
import MatchTracker from '@/react-app/components/MatchTracker'
import FootballPitchAnimation from '@/react-app/components/FootballPitchAnimation'
import LiveMomentumGraph from '@/react-app/components/LiveMomentumGraph'
import { MemoSubOddsModel } from '@/react-app/components/SubOddsModel'
import { useLiveFeed } from '@/react-app/hooks/useLiveFeed'
import { useMergedEvents } from '@/react-app/hooks/useMergedEvents'
import { useSportsEvents } from '@/react-app/hooks/useSportsEvents'
import { useUpcomingCache } from '@/react-app/hooks/useUpcomingCache'
import { useTopLeagues } from '@/react-app/hooks/useTopLeagues'
// import { useEventLiveUpdates } from '@/react-app/hooks/useEventLiveUpdates' // Removed
import { labelOutcome } from '@/shared/helpers'

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
  
  // Data for Sidebar
  const { live, pregame, loading: eventsLoading } = useSportsEvents(selectedCategory || null);
  const { upcomingEvents } = useUpcomingCache(pregame);

  // WebSocket Live Feed (Fetch all for consistent Sidebar)
  const { liveEvents: wsLiveEvents } = useLiveFeed(selectedCategory || 'all');

  // Merge HTTP + WS for Sidebar
  const mergedSidebarLive = useMergedEvents(live, wsLiveEvents);
  const activeTopLeagues = useTopLeagues(mergedSidebarLive, upcomingEvents);

  // --- Find event in locally loaded events (avoids CF Worker call) ---
  // Ready when the main events fetch (with odds) has completed
  const localEventsReady = !eventsLoading && (live.length > 0 || pregame.length > 0 || upcomingEvents.length > 0);

  const localFoundEvent = useMemo(() => {
    if (!id) return null;
    // Search live first, then pregame directly (avoids race with useUpcomingCache), then upcomingEvents cache
    const all = [...live, ...pregame, ...upcomingEvents];
    return all.find((e: any) =>
      String(e.id) === String(id) ||
      String(e.external_event_id) === String(id)
    ) || null;
  }, [id, live, pregame, upcomingEvents]);

  // Use local event as soon as it's available (instant load, no API call needed)
  useEffect(() => {
    if (localFoundEvent) {
      setEvent(localFoundEvent);
      setLoading(false);
      setError(null);
    }
  }, [localFoundEvent]);

  // --- Merge HTTP + WS + Placeholder Odds (Current Event) ---
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

  // Use displayEvent for helpers where possible, but keep existing helpers consistent

  // --- Helpers ---
  const handleLabelOutcome = useCallback((market: string, name: string) => {
    return labelOutcome(market, name, displayEvent?.home_team, displayEvent?.away_team);
  }, [displayEvent]);

  const applyMarginClamp = useCallback((_mk: string, v: number) => v, [])
  const cleanTeam = (name: string) => String(name || '').replace(/\sU\d+$/, '').trim()
  const formatScore = (val: any) => {
    if (val == null) return 0;
    if (typeof val === 'number') return val;
    if (typeof val === 'string') {
      if (val.startsWith('{')) {
        try { const p = JSON.parse(val); return p.home ?? p.total ?? p.score ?? 0; } catch {}
      }
      const n = parseFloat(val);
      return isNaN(n) ? 0 : n;
    }
    return val?.total ?? val?.score ?? val?.current ?? 0;
  };

  const parseGoals = (goals: any) => {
    if (!goals) return { home: 0, away: 0 };
    if (typeof goals === 'string') {
      try { const p = JSON.parse(goals); return { home: p.home ?? 0, away: p.away ?? 0 }; } catch {}
      return { home: 0, away: 0 };
    }
    return { home: formatScore(goals.home), away: formatScore(goals.away) };
  };

  const [realtimeOdds, setRealtimeOdds] = useState<any | null>(null);
  const [oddsSuspended, setOddsSuspended] = useState(false);
  const [oddsSuspendedReason, setOddsSuspendedReason] = useState<string>('');

  // --- Fetch Event (fallback: only when local events are ready but event not found) ---
  useEffect(() => {
    if (!id) return;
    // Already found locally → no API call needed
    if (localFoundEvent) return;
    // Local events not loaded yet → stay loading, wait for local resolution
    if (!localEventsReady) return;
    
    // Local events are loaded and event not found → try API (proxy cache / CF Worker)
    const ac = new AbortController();
    
    const fetchEvent = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await apiFetch<any>(`/api/events/${id}`, { signal: ac.signal });
        if (data && (data.id || data.home_team)) {
          setEvent(data);
          if (data.roster) setRoster(data.roster);
        } else {
          setError('Evento não encontrado ou indisponível.');
        }
      } catch (err: any) {
        if (err.name !== 'AbortError') setError('Evento não encontrado ou indisponível.');
      } finally { setLoading(false); }
    };

    fetchEvent();
    return () => ac.abort();
  }, [id, localFoundEvent, localEventsReady]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    let inflight = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      if (cancelled) return;
      if (inflight) {
        timeoutId = setTimeout(tick, 1500);
        return;
      }
      inflight = true;
      try {
        const data = await apiFetch<any>(`/api/events/${id}/odds?realtime=1`, { cache: 'no-store' });
        if (!cancelled && data) {
          if (data.markets) setRealtimeOdds(data.markets);
          setOddsSuspended(!!data.suspended);
          setOddsSuspendedReason(String(data.suspended_reason || ''));
        }
      } catch { /* silent */ }
      inflight = false;
      timeoutId = setTimeout(tick, 60_000);
    };

    tick();
    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [id]);

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

  const [livePanel, setLivePanel] = useState<'pitch' | 'lineup' | 'stats'>('pitch');
  const [pregameTab, setPregameTab] = useState<'h2h' | 'standings'>('h2h');
  const [h2hData, setH2hData] = useState<any[]>([]);
  const [standingsData, setStandingsData] = useState<any[]>([]);
  const [pregameStatsLoaded, setPregameStatsLoaded] = useState(false);

  // Fetch pre-game stats: H2H + standings
  useEffect(() => {
    if (!displayEvent || displayEvent.is_live === 1 || pregameStatsLoaded) return;
    const evId = displayEvent.id || displayEvent.external_event_id;
    const leagueId = displayEvent.league_id;
    if (!evId) return;
    setPregameStatsLoaded(true);
    const ac = new AbortController();
    Promise.allSettled([
      apiFetch<any>(`/api/events/${evId}/h2h`, { signal: ac.signal }).catch(() => ({ h2h: [] })),
      leagueId ? apiFetch<any>(`/api/leagues/${leagueId}/standings`, { signal: ac.signal }).catch(() => ({ standings: [] })) : Promise.resolve({ standings: [] })
    ]).then(([h2hResult, standResult]) => {
      if (h2hResult.status === 'fulfilled') setH2hData(h2hResult.value?.h2h || []);
      if (standResult.status === 'fulfilled') setStandingsData((standResult.value as any)?.standings || []);
    });
    return () => ac.abort();
  }, [displayEvent, pregameStatsLoaded]);

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
          {/* Match Header — score, teams, status (no pitch here) */}
          {(() => {
            const g = parseGoals(displayEvent.goals);
            const homeTeam = cleanTeam(displayEvent.home_team);
            const awayTeam = cleanTeam(displayEvent.away_team);
            return (
              <div className={`relative rounded-xl overflow-hidden mb-4 px-4 py-5 flex flex-col items-center gap-2 ${darkMode ? 'bg-gray-800' : 'bg-white'} border ${darkMode ? 'border-gray-700' : 'border-gray-200'} shadow`}>
                {isLive && (
                  <div className="flex items-center gap-2 mb-1">
                    <span className="flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-red-500 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-red-600"></span>
                    </span>
                    <span className="text-[11px] font-black text-red-600 uppercase tracking-widest">Ao Vivo</span>
                    {statusShort && <span className={`text-[11px] font-bold px-2 py-0.5 rounded ${darkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-100 text-gray-600'} uppercase`}>{statusShort}</span>}
                    {(liveTimer || liveElapsed > 0) && (
                      <span className="text-[11px] font-bold bg-red-600 text-white px-2 py-0.5 rounded">
                        {liveTimer || `${liveElapsed}'`}
                      </span>
                    )}
                  </div>
                )}
                <div className="w-full flex items-center justify-between gap-2">
                  <div className="flex-1 text-center">
                    <p className={`font-bold text-sm md:text-base truncate ${darkMode ? 'text-white' : 'text-gray-900'}`}>{homeTeam}</p>
                    {displayEvent.league_name && (
                      <p className={`text-[10px] mt-0.5 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>{displayEvent.league_name}</p>
                    )}
                  </div>
                  <div className="flex flex-col items-center min-w-[80px]">
                    {isLive ? (
                      <span className={`font-black text-3xl md:text-4xl tabular-nums ${darkMode ? 'text-white' : 'text-gray-900'}`}>{g.home} - {g.away}</span>
                    ) : (
                      <span className={`font-black text-xl ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>VS</span>
                    )}
                  </div>
                  <div className="flex-1 text-center">
                    <p className={`font-bold text-sm md:text-base truncate ${darkMode ? 'text-white' : 'text-gray-900'}`}>{awayTeam}</p>
                    {!isLive && displayEvent.date && (
                      <p className={`text-[10px] mt-0.5 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>{new Date(displayEvent.date).toLocaleDateString('pt-PT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
                    )}
                  </div>
                </div>
                {displayEvent.lastGoal && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
                    <div className="text-4xl md:text-7xl font-black text-yellow-400 animate-bounce drop-shadow-[0_4px_4px_rgba(0,0,0,0.9)]">GOL!!!</div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Live Section: Momentum Graph + 3 Tab Icons */}
          {isLive && (
            <div className="mb-4 space-y-3">
              {/* Momentum Graph */}
              <LiveMomentumGraph
                darkMode={darkMode}
                stats={(() => {
                  const st = liveStats.stats;
                  if (!st || st.length === 0) return null;
                  const find = (type: string) => {
                    const row = st.find((s: any) => String(s?.type || '').toLowerCase().includes(type));
                    return row ? { home: Number(row.home || 0), away: Number(row.away || 0) } : { home: 0, away: 0 };
                  };
                  return {
                    shots: find('shot'),
                    onTarget: find('on target'),
                    attacks: find('attack')
                  };
                })()}
                matchEvents={liveStats.events}
                homeName={cleanTeam(displayEvent.home_team)}
                awayName={cleanTeam(displayEvent.away_team)}
                currentMinute={liveElapsed || (liveTimer ? parseInt(liveTimer) : 0)}
              />

              {/* 3 Tab Icons */}
              <div className={`flex rounded-xl overflow-hidden border ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
                {[
                  { key: 'pitch' as const, icon: '⚽', label: 'Mini Campo' },
                  { key: 'lineup' as const, icon: '📋', label: 'Escalação' },
                  { key: 'stats' as const, icon: '📊', label: 'Estatísticas' },
                ].map(tab => (
                  <button
                    key={tab.key}
                    onClick={() => setLivePanel(livePanel === tab.key ? 'pitch' : tab.key)}
                    className={`flex-1 flex flex-col items-center py-3 gap-0.5 transition-colors font-semibold text-xs
                      ${livePanel === tab.key
                        ? 'bg-red-600 text-white'
                        : darkMode ? 'text-gray-400 hover:bg-gray-700' : 'text-gray-500 hover:bg-gray-50'
                      }`}
                  >
                    <span className="text-xl">{tab.icon}</span>
                    <span className="uppercase tracking-wide">{tab.label}</span>
                  </button>
                ))}
              </div>

              {/* Tab Panels */}
              {livePanel === 'pitch' && (
                <div className={`rounded-xl overflow-hidden border ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`} style={{ height: 220 }}>
                  <FootballPitchAnimation
                    homeName={cleanTeam(displayEvent.home_team)}
                    awayName={cleanTeam(displayEvent.away_team)}
                    isLive={isLive}
                    score={(() => { const g = parseGoals(displayEvent.goals); return `${g.home} - ${g.away}`; })()}
                    statusLabel={statusShort || ''}
                    timer={liveTimer || (liveElapsed > 0 ? `${liveElapsed}'` : 'AO VIVO')}
                    sport={displayEvent.sport || 'soccer'}
                    matchEvents={liveStats.events}
                  />
                </div>
              )}

              {livePanel === 'lineup' && (
                <div className={`rounded-xl p-4 border ${darkMode ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white border-gray-200 text-gray-900'}`}>
                  <h3 className="font-bold text-sm uppercase tracking-wide mb-3 text-center">Escalação</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className={`text-xs font-bold uppercase mb-2 ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>{cleanTeam(displayEvent.home_team)}</p>
                      {(displayEvent.lineup?.home || []).slice(0, 11).map((p: any, i: number) => (
                        <p key={i} className={`text-xs py-0.5 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>{p.name || p.full_name || p}</p>
                      ))}
                      {(!displayEvent.lineup?.home || displayEvent.lineup.home.length === 0) && (
                        <p className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>Sem dados disponíveis</p>
                      )}
                    </div>
                    <div>
                      <p className={`text-xs font-bold uppercase mb-2 ${darkMode ? 'text-red-400' : 'text-red-600'}`}>{cleanTeam(displayEvent.away_team)}</p>
                      {(displayEvent.lineup?.away || []).slice(0, 11).map((p: any, i: number) => (
                        <p key={i} className={`text-xs py-0.5 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>{p.name || p.full_name || p}</p>
                      ))}
                      {(!displayEvent.lineup?.away || displayEvent.lineup.away.length === 0) && (
                        <p className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>Sem dados disponíveis</p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {livePanel === 'stats' && (
                <div className={`rounded-xl overflow-hidden border ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
                  <MatchTracker 
                    live={{ ...displayEvent, fixture: { ...(displayEvent.fixture || {}), stats: liveStats.stats, events: liveStats.events } }} 
                    homeName={displayEvent.home_team}
                    awayName={displayEvent.away_team}
                    leagueName={displayEvent.league_name}
                    sportName={displayEvent.sport}
                    darkMode={darkMode} 
                  />
                </div>
              )}
            </div>
          )}

          {/* Pre-game Stats: H2H + Standings (side by side) */}
          {!isLive && (
            <div className="mb-4">
              {/* Tab bar */}
              <div className={`flex rounded-xl overflow-hidden border mb-3 ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
                {[
                  { key: 'h2h' as const, label: '📊 Histórico H2H' },
                  { key: 'standings' as const, label: '🏆 Classificação' },
                ].map(tab => (
                  <button
                    key={tab.key}
                    onClick={() => setPregameTab(tab.key)}
                    className={`flex-1 py-2.5 text-xs font-bold uppercase tracking-wide transition-colors
                      ${pregameTab === tab.key
                        ? 'bg-red-600 text-white'
                        : darkMode ? 'text-gray-400 hover:bg-gray-700' : 'text-gray-500 hover:bg-gray-50'
                      }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* H2H Panel */}
              {pregameTab === 'h2h' && (
                <div className={`rounded-xl border overflow-hidden ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
                  <div className={`px-4 py-2.5 border-b text-xs font-bold uppercase tracking-wide ${darkMode ? 'border-gray-700 text-gray-400' : 'border-gray-100 text-gray-500'}`}>
                    Confrontos Directos — {cleanTeam(displayEvent.home_team)} vs {cleanTeam(displayEvent.away_team)}
                  </div>
                  {h2hData.length === 0 ? (
                    <p className={`text-center py-6 text-sm ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>Sem dados de H2H disponíveis</p>
                  ) : (
                    <div className="divide-y divide-gray-100 dark:divide-gray-700">
                      {h2hData.map((m: any, i: number) => {
                        const homeWon = (m.scoreHome ?? -1) > (m.scoreAway ?? -1);
                        const awayWon = (m.scoreAway ?? -1) > (m.scoreHome ?? -1);
                        return (
                          <div key={i} className={`flex items-center px-4 py-2.5 gap-3 text-sm ${i % 2 === 0 ? (darkMode ? 'bg-gray-800/50' : 'bg-gray-50/60') : ''}`}>
                            <span className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'} w-20 shrink-0`}>{String(m.date || '').slice(0, 10)}</span>
                            <span className={`flex-1 text-right text-xs font-medium ${homeWon ? (darkMode ? 'text-green-400' : 'text-green-600') : (darkMode ? 'text-gray-300' : 'text-gray-700')}`}>{m.home}</span>
                            <span className={`px-2 py-0.5 rounded font-bold text-xs tabular-nums ${darkMode ? 'bg-gray-700 text-white' : 'bg-gray-100 text-gray-800'}`}>
                              {m.scoreHome ?? '-'} – {m.scoreAway ?? '-'}
                            </span>
                            <span className={`flex-1 text-xs font-medium ${awayWon ? (darkMode ? 'text-green-400' : 'text-green-600') : (darkMode ? 'text-gray-300' : 'text-gray-700')}`}>{m.away}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Standings Panel */}
              {pregameTab === 'standings' && (
                <div className={`rounded-xl border overflow-hidden ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
                  <div className={`px-4 py-2.5 border-b text-xs font-bold uppercase tracking-wide ${darkMode ? 'border-gray-700 text-gray-400' : 'border-gray-100 text-gray-500'}`}>
                    Classificação — {displayEvent.league_name || displayEvent.league}
                  </div>
                  {standingsData.length === 0 ? (
                    <p className={`text-center py-6 text-sm ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>Classificação indisponível</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className={`${darkMode ? 'bg-gray-700/50 text-gray-400' : 'bg-gray-50 text-gray-500'}`}>
                            <th className="px-2 py-2 text-center w-8">#</th>
                            <th className="px-3 py-2 text-left">Equipa</th>
                            <th className="px-2 py-2 text-center">J</th>
                            <th className="px-2 py-2 text-center">V</th>
                            <th className="px-2 py-2 text-center">E</th>
                            <th className="px-2 py-2 text-center">D</th>
                            <th className="px-2 py-2 text-center">GM</th>
                            <th className="px-2 py-2 text-center">GS</th>
                            <th className="px-2 py-2 text-center font-bold">Pts</th>
                          </tr>
                        </thead>
                        <tbody>
                          {standingsData.map((row: any, i: number) => {
                            const isHome = cleanTeam(displayEvent.home_team).toLowerCase() === String(row.team).toLowerCase();
                            const isAway = cleanTeam(displayEvent.away_team).toLowerCase() === String(row.team).toLowerCase();
                            return (
                              <tr key={i} className={`border-t ${darkMode ? 'border-gray-700' : 'border-gray-100'} ${isHome ? (darkMode ? 'bg-blue-900/30' : 'bg-blue-50') : isAway ? (darkMode ? 'bg-red-900/30' : 'bg-red-50') : i % 2 === 0 ? (darkMode ? 'bg-gray-800/30' : 'bg-gray-50/60') : ''}`}>
                                <td className={`px-2 py-1.5 text-center font-bold ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{row.position}</td>
                                <td className={`px-3 py-1.5 font-medium truncate max-w-[120px] ${isHome ? (darkMode ? 'text-blue-300' : 'text-blue-700') : isAway ? (darkMode ? 'text-red-300' : 'text-red-700') : (darkMode ? 'text-gray-200' : 'text-gray-800')}`}>{row.team}</td>
                                <td className={`px-2 py-1.5 text-center ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>{row.played}</td>
                                <td className={`px-2 py-1.5 text-center ${darkMode ? 'text-green-400' : 'text-green-600'}`}>{row.wins}</td>
                                <td className={`px-2 py-1.5 text-center ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{row.draws}</td>
                                <td className={`px-2 py-1.5 text-center ${darkMode ? 'text-red-400' : 'text-red-500'}`}>{row.losses}</td>
                                <td className={`px-2 py-1.5 text-center ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>{row.goalsFor}</td>
                                <td className={`px-2 py-1.5 text-center ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>{row.goalsAgainst}</td>
                                <td className={`px-2 py-1.5 text-center font-bold ${darkMode ? 'text-white' : 'text-gray-900'}`}>{row.points}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Odds */}
          <MemoSubOddsModel
            event={{ ...displayEvent, suspended: oddsSuspended, suspendReason: oddsSuspendedReason }}
            darkMode={darkMode}
            markets={realtimeOdds || (displayEvent as any).odds || null}
            eventOdds={realtimeOdds || (displayEvent as any).odds || null}
            onSelect={onSelect}
            labelOutcome={handleLabelOutcome}
            applyMarginClamp={applyMarginClamp}
            suspendedMarkets={[]}
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
