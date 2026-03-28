import { OddButton } from '@/react-app/components/OddButton';
import { useMemo, useState, useEffect, memo } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { useApp } from '@/react-app/contexts/AppContext';
import { formatLeagueHeader, abbreviateTeamName, getSportFromLeague, getSportIcon, labelOutcome } from '@/shared/helpers';
import type { LiveScore, SuspendedMarket } from '@/shared/types'; 
// import { useRealtimeOdds } from '@/react-app/hooks/useRealtimeOdds'; // Removed
// import { normalizeOdds } from '@/react-app/services/oddsNormalizer'; // Removed
import { useTrend } from '@/react-app/hooks/useTrend';

const normalizeSport = (s: string) => {
  const v = String(s || '').toLowerCase();
  if (v.includes('football') && !v.includes('american')) return 'soccer';
  if (v.includes('american') && v.includes('football')) return 'american-football';
  if (v.includes('ice') && v.includes('hockey')) return 'ice-hockey';
  return v.replace(/\s+/g, '-');
};

interface EventCardProps { 
  event: any; // Allow both Event (shared) and LegacyEvent
  onOpenEvent: (event: any) => void;
  liveScore?: LiveScore;
  suspension?: SuspendedMarket;
}

export function EventCard({ event, onOpenEvent, suspension }: EventCardProps) { 
  const { darkMode, addNotification, addToBetSlip } = useApp(); 
  const [isHovered, setIsHovered] = useState(false); 
  const [homeLogoOk, setHomeLogoOk] = useState(true);
  const [awayLogoOk, setAwayLogoOk] = useState(true);

  // Robustly extract event ID (support both structures)
  const eventId = event.id || event.fixture?.id;
  
  // Robustly extract team names
  const homeTeamName = event.home_team || event.teams?.home?.name || (event.match ? event.match.split(' vs ')[0] : '') || (event.match ? event.match.split(' - ')[0] : '') || 'Home Team';
  const awayTeamName = event.away_team || event.teams?.away?.name || (event.match ? event.match.split(' vs ')[1] : '') || (event.match ? event.match.split(' - ')[1] : '') || 'Away Team';
  
  // Use a public placeholder that allows CORB/CORS or a data URI
  const DEFAULT_LOGO = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjY2NjIiBzdHJva2Utd2lkdGg9IjIiPjxjaXJjbGUgY3g9IjEyIiBjeT0iMTIiIHI9IjEwIi8+PHBhdGggZD0iTTEyIDh2OG0tNCAwaDgiLz48L3N2Zz4=';
  
  const homeTeamLogo = event.home_team_logo || event.teams?.home?.logo || event.logo_home || DEFAULT_LOGO;
  const awayTeamLogo = event.away_team_logo || event.teams?.away?.logo || event.logo_away || DEFAULT_LOGO;

  useEffect(() => {
    setHomeLogoOk(true);
    setAwayLogoOk(true);
  }, [homeTeamLogo, awayTeamLogo]);

  const initials = (name: string) => {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    const a = parts[0]?.[0] || '';
    const b = parts.length > 1 ? (parts[parts.length - 1]?.[0] || '') : (parts[0]?.[1] || '');
    return (a + b).toUpperCase();
  };
  
  const eventLeague = event.league?.name || event.league || 'Unknown League'; // Handle object or string
  const eventSport = event.sport;
  const sport = eventSport ? normalizeSport(eventSport) : getSportFromLeague(typeof eventLeague === 'string' ? eventLeague : (eventLeague?.name || ''));
  const isTennis = sport === 'tennis';

  // Removed useRealtimeOdds hook
  
  // Helpers
  const handleLabelOutcome = (market: string, name: string) => {
    return labelOutcome(market, name, homeTeamName, awayTeamName);
  };

  // Simplified data access (since we poll fresh events)
  const currentMarkets = useMemo(() => {
      if (Array.isArray(event.markets)) return event.markets;
      return [];
  }, [event.markets]);

  const eventTime = useMemo(() => {
    if (!event.event_date) return '';
    const d = new Date(event.event_date);
    const h = d.getHours();
    const m = d.getMinutes();
    const pad = (n: number) => String(n).padStart(2, '0');
    return m === 0 ? `${h}h` : `${h}h${pad(m)}`;
  }, [event.event_date]);

  const eventDayMonth = useMemo(() => {
    if (!event.event_date) return '';
    const d = new Date(event.event_date);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
  }, [event.event_date]);

  const isLiveEvent = useMemo(() => {
    if (Number(event?.is_live || 0) === 1) return true;
    const status = String(event?.status ?? event?.fixture?.status?.short ?? '').toUpperCase().trim();
    const liveStatuses = new Set([
      '1H', '2H', 'HT', 'ET', 'BT', 'P', 'LIVE',
      'Q1', 'Q2', 'Q3', 'Q4', 'OT',
      'P1', 'P2', 'P3',
      'S1', 'S2', 'S3', 'S4', 'S5',
      'IN', 'IN1', 'IN2', 'IN3', 'IN4', 'IN5', 'IN6', 'IN7', 'IN8', 'IN9',
      'IN_PROGRESS',
    ]);
    return liveStatuses.has(status);
  }, [event]);

  const cleanTeam = (s: string) => {
    const raw = String(s || '');
    const head = raw.split(',')[0] || raw;
    return abbreviateTeamName(head.trim());
  };

  // useTrend hook imported from @/react-app/hooks/useTrend

  // Get odds strictly from markets[] (Golden Rule)
  const h2hMarket = currentMarkets?.find((m: any) => m.key === 'h2h');
  
  // Robustly handle 'outcomes' (DB format) vs 'selections' (Frontend format)
  const selections = h2hMarket?.selections || h2hMarket?.outcomes;
  
  // const cleanStr = (s: string) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  // const hRef = cleanStr(homeTeamName);
  // const aRef = cleanStr(awayTeamName);

  const hhSelection = selections?.find((s: any) => {
    const lbl = handleLabelOutcome('h2h', s.label || s.name || s.outcome || '');
    return lbl === 'Casa';
  });

  const ddSelection = selections?.find((s: any) => {
    const lbl = handleLabelOutcome('h2h', s.label || s.name || s.outcome || '');
    return lbl === 'Empate';
  });

  const aaSelection = selections?.find((s: any) => {
    const lbl = handleLabelOutcome('h2h', s.label || s.name || s.outcome || '');
    return lbl === 'Fora';
  });

  const pickOdd = (v: any) => {
    if (v === null || v === undefined) return 0;
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    const s = String(v).trim().replace(',', '.');
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : 0;
  };

  const hh = pickOdd(hhSelection?.odd || hhSelection?.price || hhSelection?.value) || pickOdd((event as any)?.home_odd);
  const dd = pickOdd(ddSelection?.odd || ddSelection?.price || ddSelection?.value) || pickOdd((event as any)?.draw_odd);
  const aa = pickOdd(aaSelection?.odd || aaSelection?.price || aaSelection?.value) || pickOdd((event as any)?.away_odd);

  const homeTrend = useTrend(hh);
  const drawTrend = useTrend(dd);
  const awayTrend = useTrend(aa);

  // Market suspended check
  const isH2hSuspended = h2hMarket?.suspended ?? false;
  const h2hReason = h2hMarket?.suspended_reason;
  const marketSuspended = isH2hSuspended ? { reason: h2hReason || 'SUSPENSO' } : undefined;

  // Add bet handler
  const addPrimary = (label: string, price: number, selectionSuspended?: boolean) => {
    if (!(price > 0)) { addNotification({ type: 'warning', message: 'Odd indisponível' }); return; }
    
    // Map label to standard selection names if needed
    let selection = label;
    if (label === 'Casa') selection = 'Home';
    if (label === 'Empate') selection = 'Draw';
    if (label === 'Fora') selection = 'Away';

    const idStr = `ev-${eventId}-${selection.toLowerCase()}`;
    addToBetSlip({ 
      id: idStr, 
      event_id: eventId, 
      match: String(event.match || `${homeTeamName} vs ${awayTeamName}`), 
      selection: selection, 
      market: 'Resultado Final', // Explicit market name
      odd: price, 
      stake: 0,
      league: typeof eventLeague === 'string' ? eventLeague : (eventLeague?.name || ''),
      sport: (eventSport ? normalizeSport(eventSport) : getSportFromLeague(typeof eventLeague === 'string' ? eventLeague : (eventLeague?.name || ''))),
      suspended: selectionSuspended,
      market_suspended: isH2hSuspended
    });
  };

  // Check if we have valid odds locally, even if realtime thinks it's suspended
  const hasLocalOdds = currentMarkets && currentMarkets.length > 0;

  // Extra markets: totals (goals) + btts
  const totalsMarket = currentMarkets.find((m: any) => m.key === 'totals');
  const bttsMarket   = currentMarkets.find((m: any) => m.key === 'btts');
  const extraMarkets: Array<{ label: string; odd: number; key: string }> = [];

  if (totalsMarket?.selections?.length >= 2) {
    const ov = totalsMarket.selections.find((s: any) => String(s.label||'').toLowerCase().includes('mais') || String(s.label||'').toLowerCase().includes('over'));
    const un = totalsMarket.selections.find((s: any) => String(s.label||'').toLowerCase().includes('menos') || String(s.label||'').toLowerCase().includes('under'));
    const line = totalsMarket.line || '2.5';
    if (ov?.odd > 1) extraMarkets.push({ label: `+${line}`, odd: ov.odd, key: `totals-over` });
    if (un?.odd > 1) extraMarkets.push({ label: `-${line}`, odd: un.odd, key: `totals-under` });
  }
  if (bttsMarket?.selections?.length) {
    const yes = bttsMarket.selections.find((s: any) => String(s.label||'').toLowerCase().includes('sim') || String(s.label||'').toLowerCase() === 'yes');
    if (yes?.odd > 1) extraMarkets.push({ label: 'Ambas', odd: yes.odd, key: 'btts-yes' });
  }
  
  // Relaxed suspension logic: only suspend if explicitly frozen or suspended AND we don't have local odds to show
  // If we have local odds, we assume they are valid until a realtime update explicitly clears them
  const isSuspended = ((!!suspension || (event as any).oddsFrozen || event.suspended) && !hasLocalOdds);

  const suspendReason = suspension?.reason || (event as any).suspendReason || ((event as any).oddsFrozen ? 'EVENT_FROZEN' : 'SUSPENSO');

  return (
    <div 
      className={`border rounded-lg p-3 transition-all duration-300 ${ 
        darkMode ? 'bg-gray-800 border-gray-700 hover:bg-gray-750' : 'bg-white border-gray-200 hover:border-red-400 hover:shadow-lg' 
      } ${isHovered ? 'scale-[1.02]' : ''}`} 
      onMouseEnter={() => setIsHovered(true)} 
      onMouseLeave={() => setIsHovered(false)} 
      onClick={() => onOpenEvent(event)}
    > 
      <div className="flex flex-col sm:flex-row justify-between items-start"> 
         <div className="flex-1 w-full sm:w-auto mb-3 sm:mb-0"> 
        <div className="flex items-center gap-2 mb-1">
         {(() => {
          const { flag, country, league: formattedLeague, flagUrl } = formatLeagueHeader(event);
          const sportIcon = getSportIcon(sport);
          
          const leagueLabel = sport === 'cricket' ? 'Críquete' : formattedLeague;

          return (
            <span className={`flex items-center gap-2 text-xs font-din ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
               <div className="relative w-6 h-6 flex-shrink-0">
                    <img src={sportIcon} alt={sport} className="w-full h-full object-contain p-0.5 opacity-90" />
                    {(flagUrl || flag) && (
                        <span className={`absolute -bottom-1 -right-1 flex items-center justify-center w-4 h-4 rounded-full shadow-sm border ${darkMode ? 'border-gray-800 bg-gray-700' : 'border-white bg-white'} overflow-hidden`}>
                            {flagUrl ? <img src={flagUrl} alt={country} className="w-full h-full object-cover" /> : <span className="text-[10px]">{flag}</span>}
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-bold uppercase tracking-tight">{leagueLabel}</span>
                    {country && <span className="opacity-70 font-normal hidden sm:inline">· {country}</span>}
                    
                    <div className="flex items-center gap-1 ml-1 pl-1 border-l border-gray-300 dark:border-gray-600">
                        {eventDayMonth && <span className="opacity-80 text-[10px]">{eventDayMonth}</span>}
                    </div>
                </div>
            </span>
          );
        })()}
       </div>
           
      
      <div className="flex items-center gap-3 w-full">
        <button 
          onClick={(e: ReactMouseEvent<HTMLButtonElement>) => { e.stopPropagation(); onOpenEvent(event); }} 
          className={`text-left w-full ${darkMode ? 'text-white hover:text-red-300' : 'text-gray-900 hover:text-red-700'} underline-offset-2 hover:underline overflow-hidden`} 
        > 
          <span className="flex items-center gap-2 w-full justify-start">
            <div className="flex items-center gap-2 min-w-0 max-w-[46%]">
              {!isTennis && (
                homeTeamLogo && homeLogoOk ? (
                  <img
                    src={homeTeamLogo}
                    alt={homeTeamName}
                    className="w-6 h-6 object-contain shrink-0 bg-white/5 rounded-full p-0.5"
                    onError={() => setHomeLogoOk(false)}
                  />
                ) : (
                  <div className="w-6 h-6 shrink-0 rounded-full bg-white/10 flex items-center justify-center text-[10px] font-bold">
                    {initials(homeTeamName)}
                  </div>
                )
              )}
              <span className="text-sm font-semibold truncate leading-tight">{cleanTeam(homeTeamName)}</span>
            </div>

            {(() => {
              const rawHome = (event as any).goals?.home ?? (event as any).golsCasa ?? (event as any).score_home;
              const rawAway = (event as any).goals?.away ?? (event as any).golsFora ?? (event as any).score_away;

              const formatScore = (val: any) => {
                if (val === null || val === undefined) return undefined;
                if (typeof val === 'object') return (val as any).total ?? (val as any).score ?? (val as any).current ?? 0;
                return val;
              };

              let homeScore = formatScore(rawHome);
              let awayScore = formatScore(rawAway);

              if (isLiveEvent) {
                if (homeScore === undefined) homeScore = 0;
                if (awayScore === undefined) awayScore = 0;
              }

              let scoreStr = '';
              if (isLiveEvent && homeScore !== undefined && awayScore !== undefined) {
                scoreStr = `${homeScore}-${awayScore}`;
              } else if (isLiveEvent && event.score) {
                let displayScore: any = event.score;
                if (typeof displayScore === 'string' && (displayScore.includes('{') || displayScore.includes(':'))) {
                  try {
                    const parsed = JSON.parse(displayScore);
                    if (parsed.home !== undefined && parsed.away !== undefined) {
                      displayScore = `${parsed.home}-${parsed.away}`;
                    }
                  } catch {
                    displayScore = String(displayScore);
                  }
                } else if (typeof displayScore === 'object' && displayScore?.home !== undefined) {
                  displayScore = `${displayScore.home}-${displayScore.away}`;
                }
                scoreStr = String(displayScore);
              }

              const elapsed = Number((event as any).elapsed ?? (event as any).fixture?.status?.elapsed ?? (event as any).status?.elapsed ?? 0) || 0;
              const timer = String((event as any).timer || (event as any).fixture?.status?.timer || '').trim();
              const displayTimer = timer || (elapsed > 0 ? `${elapsed}'` : '');

              if (isLiveEvent) {
                return (
                  <span className="flex flex-col items-center shrink-0 px-1 gap-0.5">
                    <span className="text-xs font-bold text-red-600">{scoreStr || 'AO VIVO'}</span>
                    {displayTimer && (
                      <span className="text-[10px] font-bold text-green-500 bg-green-500/10 rounded px-1 leading-tight">{displayTimer}</span>
                    )}
                  </span>
                );
              }

              return (
                <span className={`text-xs font-bold shrink-0 px-1 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                  {eventTime || 'vs'}
                </span>
              );
            })()}
           
            <div className="flex items-center gap-2 min-w-0 max-w-[46%]">
              <span className="text-sm font-semibold truncate leading-tight">{cleanTeam(awayTeamName)}</span>
              {!isTennis && (
                awayTeamLogo && awayLogoOk ? (
                  <img
                    src={awayTeamLogo}
                    alt={awayTeamName}
                    className="w-6 h-6 object-contain shrink-0 bg-white/5 rounded-full p-0.5"
                    onError={() => setAwayLogoOk(false)}
                  />
                ) : (
                  <div className="w-6 h-6 shrink-0 rounded-full bg-white/10 flex items-center justify-center text-[10px] font-bold">
                    {initials(awayTeamName)}
                  </div>
                )
              )}
            </div>
          </span>
        </button>
        
      </div>
          
         </div> 
        <div className="text-left sm:text-right mt-2 sm:mt-0 w-full sm:w-auto">
          {(() => {
          const hasPrimary = (hh > 0) || (dd > 0) || (aa > 0);
          const isTwoWaySport = ['basketball', 'tennis', 'american-football', 'baseball', 'mma', 'volleyball', 'handball', 'ice-hockey', 'hockey', 'cricket'].includes(sport);
          const showDraw = !isTwoWaySport && dd > 0;
          const gridCols = showDraw ? 'grid-cols-3' : 'grid-cols-2';
          
          if (!hasPrimary) {
              return (
                  <div className={`grid ${gridCols} gap-2 w-full sm:w-[320px] lg:w-[400px] opacity-50 cursor-not-allowed`}>
                      <div className="flex flex-col items-center justify-center bg-gray-100 dark:bg-gray-700 rounded p-2 h-[50px]">
                           <span className="text-xs text-gray-500 font-bold">-</span>
                      </div>
                      {showDraw && (
                         <div className="flex flex-col items-center justify-center bg-gray-100 dark:bg-gray-700 rounded p-2 h-[50px]">
                             <span className="text-xs text-gray-500 font-bold">-</span>
                        </div>
                      )}
                       <div className="flex flex-col items-center justify-center bg-gray-100 dark:bg-gray-700 rounded p-2 h-[50px]">
                           <span className="text-xs text-gray-500 font-bold">-</span>
                      </div>
                  </div>
              );
          }
            
            return (
              <div className={`grid ${gridCols} gap-2 relative transition-opacity duration-300 w-full sm:w-[320px] lg:w-[400px] ${isSuspended ? 'opacity-50 pointer-events-none select-none' : ''}`}>
                {isSuspended && (
                   <div className="absolute inset-0 flex items-center justify-center z-10">
                      <span className="bg-red-600/90 text-white text-[10px] sm:text-xs px-2 py-1 rounded shadow-sm font-bold uppercase tracking-wider backdrop-blur-sm border border-red-500">
                        {suspendReason === 'EVENT_FROZEN' ? 'GOL/VAR' : (suspendReason === 'LOW_LIQUIDITY' ? 'LIQUIDEZ' : (suspendReason === 'RISK_MARGIN' ? 'RISCO' : 'SUSPENSO'))}
                      </span>
                   </div>
                )}
                {(hh > 0) ? (
                  <OddButton 
                    label="1"
                    price={hh}
                    trend={homeTrend}
                    onClick={(e) => { e.stopPropagation(); addPrimary('Casa', hh, hhSelection?.suspended); }}
                    className="w-full h-full min-h-[30px] px-2 py-0.5 rounded-lg bg-red-600 text-white hover:opacity-90 flex items-center justify-between gap-1"
                    suspended={marketSuspended || (hhSelection?.suspended ? { reason: 'SUSPENSO' } : undefined)}
                  />
                ) : <div />}
                
                {showDraw && (
                  <OddButton 
                    label="X"
                    price={dd}
                    trend={drawTrend}
                    onClick={(e) => { e.stopPropagation(); addPrimary('Empate', dd, ddSelection?.suspended); }}
                    className="w-full h-full min-h-[30px] px-2 py-0.5 rounded-lg bg-red-600 text-white hover:opacity-90 flex items-center justify-between gap-1"
                    suspended={marketSuspended || (ddSelection?.suspended ? { reason: 'SUSPENSO' } : undefined)}
                  />
                )}
                
                {(aa > 0) ? (
                  <OddButton 
                    label="2"
                    price={aa}
                    trend={awayTrend}
                    onClick={(e) => { e.stopPropagation(); addPrimary('Fora', aa, aaSelection?.suspended); }}
                    className="w-full h-full min-h-[30px] px-2 py-0.5 rounded-lg bg-red-600 text-white hover:opacity-90 flex items-center justify-between gap-1"
                    suspended={marketSuspended || (aaSelection?.suspended ? { reason: 'SUSPENSO' } : undefined)}
                  />
                ) : <div />}
              </div>
            );
          })()}
        </div>
      </div>

      {/* Extra markets strip (Goals Over/Under, BTTS) */}
      {extraMarkets.length > 0 && (
        <div className={`flex items-center gap-2 mt-2 pt-2 border-t flex-wrap ${darkMode ? 'border-gray-700' : 'border-gray-100'}`}>
          <span className={`text-[10px] uppercase tracking-wider font-bold ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>Mercados:</span>
          {extraMarkets.map(m => (
            <button
              key={m.key}
              onClick={(e) => {
                e.stopPropagation();
                const slLabel = m.key === 'btts-yes' ? 'Ambas Marcam - Sim' : (m.label.startsWith('+') ? `Mais ${m.label.slice(1)} Golos` : `Menos ${m.label.slice(1)} Golos`);
                const id = `ev-${eventId}-${m.key}`;
                addToBetSlip({ id, event_id: eventId, match: `${homeTeamName} vs ${awayTeamName}`, selection: slLabel, market: slLabel, odd: m.odd, stake: 0, league: typeof eventLeague === 'string' ? eventLeague : (eventLeague as any)?.name || '', sport });
              }}
              className={`px-2 py-0.5 rounded text-[11px] font-bold border transition-colors ${darkMode ? 'bg-gray-700 border-gray-600 text-gray-200 hover:bg-red-700 hover:border-red-500' : 'bg-gray-50 border-gray-200 text-gray-700 hover:bg-red-50 hover:border-red-300 hover:text-red-700'}`}
            >
              {m.label} <span className="text-red-500">{m.odd.toFixed(2)}</span>
            </button>
          ))}
        </div>
      )}
    </div> 
  ); 
}

export const MemoEventCard = memo(EventCard);
export default MemoEventCard;
