import { useEffect, useMemo, useState, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { createPortal } from 'react-dom'
import { useApp } from '@/react-app/contexts/AppContext'
import { apiFetch } from '@/react-app/utils/api'
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
  const homeTeamLogo = displayEvent?.home_team_logo || displayEvent?.teams?.home?.logo || displayEvent?.logo_home || 'https://media.api-sports.io/football/teams/default.png';
  const awayTeamLogo = displayEvent?.away_team_logo || displayEvent?.teams?.away?.logo || displayEvent?.logo_away || 'https://media.api-sports.io/football/teams/default.png';

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

  // --- Fetch Event ---
  useEffect(() => {
    if (!id) return;
    const ac = new AbortController();
    
    const fetchEvent = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await apiFetch<any>(`/api/sports/events/${id}`, { signal: ac.signal });
        setEvent(data);
        if (data.roster) setRoster(data.roster);
      } catch (err: any) {
        if (err.name !== 'AbortError') setError('Evento não encontrado ou indisponível.');
      } finally { setLoading(false); }
    };

    fetchEvent();
    return () => ac.abort();
  }, [id]);

  const onSelect = useCallback((label: string, odd: number) => {
    if (!displayEventWithOdds) return;
    addToBetSlip({
      id: String(Date.now() + Math.random()),
      event_id: Number(displayEventWithOdds.id),
      match: `${displayEventWithOdds.home_team} vs ${displayEventWithOdds.away_team}`,
      selection: label,
      odd: odd,
      stake: 0,
      league: displayEventWithOdds.league_name || displayEventWithOdds.sport_title || 'Desporto'
    });
  }, [displayEventWithOdds, addToBetSlip]);

  const [showMatchCenter, setShowMatchCenter] = useState(false);

  if (loading) return <div className="p-8 text-center"><div className="animate-spin h-8 w-8 border-4 border-red-600 border-t-transparent rounded-full mx-auto"></div></div>;
  if (error || !displayEvent) return <div className="p-8 text-center text-red-600">{error || 'Evento não encontrado'}</div>;

  const isLive = displayEvent.status === 'LIVE' || displayEvent.is_live === 1;

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
                    <span className="text-lg md:text-2xl font-bold text-white text-center">{cleanTeam(displayEvent.home_team)}</span>
                </div>
                
                <div className="text-center mx-4">
                   <div className={`text-4xl md:text-6xl font-black text-white transition-all duration-300 ${displayEvent.lastGoal ? 'scale-125 text-green-400' : ''}`}>
                     {isLive 
                       ? `${formatScore(displayEvent.goals?.home)} - ${formatScore(displayEvent.goals?.away)}` 
                       : 'VS'} 
                   </div> 
                   {isLive && ( 
                     <div className="text-sm md:text-lg text-white/90 mt-1 flex items-center justify-center gap-2"> 
                       <span className="font-din font-bold bg-black/30 px-2 py-0.5 rounded">{displayEvent.status || displayEvent.fixture?.status?.short}</span>
                       <span className="font-din font-bold bg-red-600 px-2 py-0.5 rounded">{displayEvent.elapsed || displayEvent.fixture?.status?.elapsed ? `${displayEvent.elapsed || displayEvent.fixture.status.elapsed}'` : ''}</span> 
                       {wsConnected && <span className="ml-1 flex h-2 w-2 relative" title="Conectado ao vivo">
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
                    <span className="text-lg md:text-2xl font-bold text-white text-center">{cleanTeam(displayEvent.away_team)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Match Center */}
          {isLive && (
            <div className={`rounded-xl overflow-hidden shadow-lg mb-6 ${darkMode ? 'bg-gray-800' : 'bg-white'}`}>
              <button onClick={() => setShowMatchCenter(!showMatchCenter)} className="w-full p-3 flex items-center justify-between font-bold hover:bg-gray-50 dark:hover:bg-gray-700 transition">
                <span>Match Center</span><span>{showMatchCenter ? '▲' : '▼'}</span>
              </button>
              {showMatchCenter && (
                <div id="match-center" className="p-4 border-t border-gray-200 dark:border-gray-700">
                  <MatchTracker 
                    live={displayEvent} 
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

          {/* Odds */}
          <MemoSubOddsModel
            event={displayEvent}
            darkMode={darkMode}
            markets={displayEvent.odds}
            eventOdds={displayEvent.odds}
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
