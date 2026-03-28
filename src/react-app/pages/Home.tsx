import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '@/react-app/contexts/AppContext';
import { useSportsEvents } from '@/react-app/hooks/useSportsEvents';
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
import type { Event } from '../../shared/types';

interface HomeProps {
  mode?: 'home' | 'live';
}

function Home({ mode = 'home' }: HomeProps) {
  const { darkMode, selectedCategory, showMobileSidebar, setShowMobileSidebar } = useApp();
  const navigate = useNavigate();

  // Dados principais
  const { live: httpLive, pregame, loading: eventsLoading } = useSportsEvents(selectedCategory || 'all');
  const loading = eventsLoading;
  const showBanner = true;
  
  const processedLive = httpLive;

  const { upcomingEvents } = useUpcomingCache(pregame);

  // Busca
  const { query, setQuery } = useEventSearch();

  // Agrupamento
  const activeTopLeagues = useTopLeagues(processedLive, upcomingEvents);

  // Separate Lists for Live and Upcoming
  const sortedUpcoming = useMemo(() => {
    const liveIds = new Set(processedLive.map(e => e.id));
    return upcomingEvents
      .filter(e => {
        if (liveIds.has(e.id)) return false;

        // Strict validity check
        const h = (e.home_team || '').trim();
        const a = (e.away_team || '').trim();
        if (!h || !a || h === 'undefined' || a === 'undefined' || h === 'Home Team' || a === 'Away Team') return false;
        if (e.id === 'undefined' || !e.id) return false;
        
        return true;
      })
      .sort((a, b) => {
        const ta = new Date(a.event_date || a.start_time || a.fixture?.date || 0).getTime();
        const tb = new Date(b.event_date || b.start_time || b.fixture?.date || 0).getTime();
        return ta - tb; // Ascending: Soonest first
      });
  }, [processedLive, upcomingEvents]);

  // Strict separation: Desporto = pregame only | AO VIVO = live only
  const displayedLive    = mode === 'live' ? processedLive : [];
  const displayedUpcoming = mode === 'home' ? sortedUpcoming : [];

  const groupedLive = useGroupedEvents(displayedLive, query);
  const groupedUpcoming = useGroupedEvents(displayedUpcoming, query);

  const MAX_EVENTS = mode === 'live' ? 120 : 60; // live≤120, pregame≤60

  const limitedUpcoming = useMemo(() => {
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
  }, [groupedUpcoming]);

  const noSearchResults = useMemo(() => {
    if (!query.trim()) return false;
    const liveCount = groupedLive.reduce((acc, [, ev]) => acc + ev.length, 0);
    const upCount = limitedUpcoming.reduce((acc, [, ev]) => acc + ev.length, 0);
    return liveCount + upCount === 0;
  }, [groupedLive, limitedUpcoming, query]);

  const handleOpenEvent = (event: Event) => {
    navigate(`/event/${event.id}`);
  };

  const showDebug = false; // Debug disabled by user request

  // WARNING: Conditional Hook Call Fixed
  // Previous: useEffect inside conditional block if (processedLive.length > 0 ...)
  // Now: useEffect always called, logic inside
  const [hasEverHadEvents, setHasEverHadEvents] = useState(false);
  const [showIntro, setShowIntro] = useState(false);

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
            ) : (groupedLive.length > 0 || limitedUpcoming.length > 0) ? (
              <div className="space-y-12">
                {/* LIVE SECTION — shown only in mode='live' */}
                {groupedLive.length > 0 && (
                  <div className="space-y-6">
                     <div className="space-y-8">
                        {groupedLive.map(([league, events]) => (
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
                              {events.map(ev => (
                                <EventCard
                                  key={ev.id}
                                  event={ev}
                                  onOpenEvent={() => handleOpenEvent(ev)}
                                />
                              ))}
                            </div>
                          </div>
                        ))}
                     </div>
                  </div>
                )}

                {/* UPCOMING SECTION */}
                {limitedUpcoming.length > 0 && (
                  <div className="space-y-6">
                     {groupedLive.length > 0 && (
                        <div className="flex items-center gap-3 px-2 pt-4 border-t border-gray-700/50">
                           <h2 className="text-xl font-bold uppercase tracking-wide">Próximos Jogos</h2>
                        </div>
                     )}
                     
                     <div className="space-y-8">
                        {limitedUpcoming.map(([league, events]) => (
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
                              {events.map(ev => (
                                <EventCard
                                  key={ev.id}
                                  event={ev}
                                  onOpenEvent={() => handleOpenEvent(ev)}
                                />
                              ))}
                            </div>
                          </div>
                        ))}
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
