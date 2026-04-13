import { OddButton } from '@/react-app/components/OddButton';
import { useMemo, useState, useEffect, memo, useRef } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { useApp } from '@/react-app/contexts/AppContext';
import { formatLeagueHeader, abbreviateTeamName, getSportFromLeague, getSportIcon, labelOutcome } from '@/shared/helpers';
import type { LiveScore, SuspendedMarket } from '@/shared/types'; 
// import { useRealtimeOdds } from '@/react-app/hooks/useRealtimeOdds'; // Removed
// import { normalizeOdds } from '@/react-app/services/oddsNormalizer'; // Removed
import { useTrend } from '@/react-app/hooks/useTrend';
import { getEventBannerUrl } from '@/react-app/utils/eventBanners';
import { useTeamBanner } from '@/react-app/hooks/useTeamBanner';
import { sanitizeMediaUrl } from '@/react-app/utils/media';

const normalizeSport = (s: string) => {
  const v = String(s || '').toLowerCase();
  if (v.startsWith('basketball')) return 'basketball';
  if (v.startsWith('nba')) return 'nba';
  if (v.startsWith('ice-hockey') || v.startsWith('ice hockey') || v.startsWith('icehockey')) return 'ice-hockey';
  if (v.startsWith('baseball')) return 'baseball';
  if (v.startsWith('volleyball') || v.startsWith('voleyball') || v.startsWith('vôlei') || v.startsWith('volei')) return 'volleyball';
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
  const [criticalLockUntil, setCriticalLockUntil] = useState<number>(0);
  const [criticalReason, setCriticalReason] = useState<'GOL' | 'GRANDE_CHANCE' | 'VAR'>('GOL');
  const [postCriticalUntil, setPostCriticalUntil] = useState<number>(0);
  const [nowTs, setNowTs] = useState<number>(() => Date.now());
  const lastGoalRef = useMemo(() => ({ h: -1, a: -1 }), []);
  const lockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Robustly extract event ID (support both structures)
  const eventId = event.id || event.fixture?.id;
  
  // Robustly extract team names
  const homeTeamName = event.home_team || event.teams?.home?.name || (event.match ? event.match.split(' vs ')[0] : '') || (event.match ? event.match.split(' - ')[0] : '') || 'Home Team';
  const awayTeamName = event.away_team || event.teams?.away?.name || (event.match ? event.match.split(' vs ')[1] : '') || (event.match ? event.match.split(' - ')[1] : '') || 'Away Team';
  
  // Use a public placeholder that allows CORB/CORS or a data URI
  const DEFAULT_LOGO = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjY2NjIiBzdHJva2Utd2lkdGg9IjIiPjxjaXJjbGUgY3g9IjEyIiBjeT0iMTIiIHI9IjEwIi8+PHBhdGggZD0iTTEyIDh2OG0tNCAwaDgiLz48L3N2Zz4=';
  
  const homeTeamLogo = sanitizeMediaUrl(event.home_team_logo || event.teams?.home?.logo || event.logo_home || DEFAULT_LOGO);
  const awayTeamLogo = sanitizeMediaUrl(event.away_team_logo || event.teams?.away?.logo || event.logo_away || DEFAULT_LOGO);

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
  const isSoccer = sport === 'soccer';

  // Removed useRealtimeOdds hook

  useEffect(() => {
    if (!isSoccer) return;
    const isLive = Boolean(event.is_live);
    if (!isLive) return;
    const rawScore = (event.goals && (event.goals.home !== undefined)) ? `${event.goals.home}-${event.goals.away}` : String(event.score || '');
    const m = rawScore.match(/(\d+)\s*-\s*(\d+)/);
    if (!m) return;
    const h = Number(m[1]);
    const a = Number(m[2]);
    if (!Number.isFinite(h) || !Number.isFinite(a)) return;
    if (lastGoalRef.h < 0 && lastGoalRef.a < 0) {
      lastGoalRef.h = h;
      lastGoalRef.a = a;
      return;
    }
    if (h !== lastGoalRef.h || a !== lastGoalRef.a) {
      const increased = h > lastGoalRef.h || a > lastGoalRef.a;
      lastGoalRef.h = h;
      lastGoalRef.a = a;
      if (increased) {
        setCriticalReason('GOL');
        setPostCriticalUntil(0);
        setCriticalLockUntil(Date.now() + 25000);
      }
    }
  }, [event.is_live, event.goals, event.score, isSoccer, lastGoalRef]);

  useEffect(() => {
    if (lockTimerRef.current) {
      clearTimeout(lockTimerRef.current);
      lockTimerRef.current = null;
    }
    const delay = criticalLockUntil - Date.now();
    if (delay <= 0) return;
    lockTimerRef.current = setTimeout(() => {
      setPostCriticalUntil(Date.now() + 5000);
    }, delay);
    return () => {
      if (lockTimerRef.current) clearTimeout(lockTimerRef.current);
      lockTimerRef.current = null;
    };
  }, [criticalLockUntil]);

  useEffect(() => {
    const hasAnyLock = (criticalLockUntil > nowTs) || (postCriticalUntil > nowTs);
    if (!hasAnyLock) return;
    const t = setInterval(() => setNowTs(Date.now()), 400);
    return () => clearInterval(t);
  }, [criticalLockUntil, postCriticalUntil, nowTs]);
  
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

  const criticalLocked = isSoccer && criticalLockUntil > nowTs;
  const postCriticalLocked = isSoccer && postCriticalUntil > nowTs;
  const isSuspended = criticalLocked || !!suspension || Boolean((event as any).oddsFrozen) || event.suspended;

  const suspendReason = criticalLocked
    ? 'MOMENTO_CRITICO'
    : (suspension?.reason || (event as any).suspendReason || ((event as any).oddsFrozen ? 'EVENT_FROZEN' : 'SUSPENSO'));

  const gradientBannerUrl = useMemo(() => {
    return getEventBannerUrl({
      eventId: eventId,
      homeTeam: homeTeamName,
      awayTeam: awayTeamName,
      sport: eventSport || sport,
    });
  }, [eventId, homeTeamName, awayTeamName, eventSport, sport]);
  const { bannerUrl: photoBannerUrl } = useTeamBanner(
    homeTeamName,
    awayTeamName,
    !isLiveEvent,
  );
  const bannerUrl = photoBannerUrl || gradientBannerUrl;

  return (
    <div 
      className={`border rounded-lg p-3 transition-all duration-300 ${ 
        darkMode ? 'bg-gray-800 border-gray-700 hover:bg-gray-750' : 'bg-white border-gray-200 hover:border-red-400 hover:shadow-lg' 
      } ${isHovered ? 'scale-[1.02]' : ''}`} 
      onMouseEnter={() => setIsHovered(true)} 
      onMouseLeave={() => setIsHovered(false)} 
      onClick={() => onOpenEvent(event)}
    > 
      {bannerUrl && !isLiveEvent && (
        <div className="relative -mx-3 -mt-3 mb-3 overflow-hidden rounded-t-lg" style={{ height: 96 }}>
          <div
            className="absolute inset-0 bg-center bg-cover"
            style={{ backgroundImage: `url(${bannerUrl})` }}
          />
          <div className={`absolute inset-0 ${darkMode ? 'bg-gradient-to-r from-gray-900/85 via-gray-900/55 to-gray-900/15' : 'bg-gradient-to-r from-white/75 via-white/45 to-white/10'}`} />
          <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/50 to-black/75" />
          <div className="relative h-full flex items-center justify-between px-4">
            <div className="flex items-center gap-2 min-w-0">
              {homeLogoOk && homeTeamLogo ? (
                <img src={homeTeamLogo} alt={homeTeamName} className="w-10 h-10 object-contain drop-shadow-lg" onError={() => setHomeLogoOk(false)} />
              ) : (
                <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold text-white">{initials(homeTeamName)}</div>
              )}
              <span className="text-white font-black text-sm sm:text-base truncate max-w-[100px] drop-shadow">{cleanTeam(homeTeamName)}</span>
            </div>
            <div className="flex flex-col items-center gap-0.5 shrink-0">
              <div className="text-xs font-black text-white/80 uppercase tracking-widest leading-none">VS</div>
              {eventTime && (
                <div className="text-[11px] font-bold text-amber-300 leading-none mt-1">{eventTime}</div>
              )}
              {eventDayMonth && (
                <div className="text-[10px] text-white/50 leading-none mt-0.5">{eventDayMonth}</div>
              )}
            </div>
            <div className="flex items-center gap-2 min-w-0 flex-row-reverse">
              {awayLogoOk && awayTeamLogo ? (
                <img src={awayTeamLogo} alt={awayTeamName} className="w-10 h-10 object-contain drop-shadow-lg" onError={() => setAwayLogoOk(false)} />
              ) : (
                <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold text-white">{initials(awayTeamName)}</div>
              )}
              <span className="text-white font-black text-sm sm:text-base truncate max-w-[100px] drop-shadow text-right">{cleanTeam(awayTeamName)}</span>
            </div>
          </div>
        </div>
      )}
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
      {/* Live clock / elapsed */}
      {isLiveEvent && (
        <div className="mb-2">
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
            darkMode ? 'bg-red-900/40 text-red-200 border border-red-800/60' : 'bg-red-50 text-red-700 border border-red-200'
          }`}>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 8v5h4M12 2a10 10 0 100 20 10 10 0 000-20z"/>
            </svg>
            {(() => {
              const t = String((event as any)?.timer || '').trim();
              if (t) return t;
              const st = String((event as any)?.status?.short || (event as any)?.status || '').trim().toUpperCase();
              const el = typeof event?.elapsed === 'number' ? event.elapsed : 0;
              if ((st === '1H' || st === '2H') && el > 0) return `${el}'`;
              if (st === '1H') return '1ª Parte';
              if (st === '2H') return '2ª Parte';
              if (st === 'HT' || st === 'BT') return 'Intervalo';
              if (st === 'ET') return 'Prolongamento';
              const periodStatuses = new Set(['Q1','Q2','Q3','Q4','OT','P1','P2','P3','S1','S2','S3','S4','S5']);
              if (st && periodStatuses.has(st)) {
                const elStr = el > 0 ? ` ${el}'` : '';
                return `${st}${elStr}`;
              }
              return el > 0 ? `${el}'` : 'AO VIVO';
            })()}
          </span>
        </div>
      )}
      
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
              {isLiveEvent && Number((event as any).red_cards_home || 0) > 0 && ( 
                <span title="Cartão vermelho" className="relative inline-flex items-center justify-center shrink-0 ml-0.5"> 
                  <span className="block w-2.5 h-3.5 bg-red-600 rounded-[2px]" /> 
                  {Number((event as any).red_cards_home) > 1 && ( 
                    <span className="absolute -top-1 -right-1.5 flex items-center justify-center w-3 h-3 rounded-full bg-red-800 text-white text-[7px] font-bold leading-none"> 
                      {Number((event as any).red_cards_home)} 
                    </span> 
                  )} 
                </span> 
              )} 
            </div>

            {(() => {
              const parsedScore = (() => {
                try {
                  const s = (event as any).goals || (() => {
                    const raw = (event as any).score;
                    if (!raw) return null;
                    return typeof raw === 'string' ? JSON.parse(raw) : raw;
                  })();
                  return s && typeof s === 'object' ? s : null;
                } catch { return null; }
              })();
              const knownHome = parsedScore?.home !== null && parsedScore?.home !== undefined ? parsedScore.home : undefined;
              const knownAway = parsedScore?.away !== null && parsedScore?.away !== undefined ? parsedScore.away : undefined;
              const hasScore = knownHome !== undefined && knownAway !== undefined;

              const formatScore = (val: any) => {
                if (val === null || val === undefined) return undefined;
                if (typeof val === 'object') return (val as any).total ?? (val as any).score ?? (val as any).current ?? 0;
                return val;
              };

              let homeScore = hasScore ? formatScore(knownHome) : undefined;
              let awayScore = hasScore ? formatScore(knownAway) : undefined;
              if (isLiveEvent && !hasScore && (event as any).sport === 'soccer') {
                homeScore = 0;
                awayScore = 0;
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

              const centerText = isLiveEvent
                ? (scoreStr || 'AO VIVO')
                : (eventTime || 'vs');

              return (
                <span className={`text-xs font-bold shrink-0 px-1 ${isLiveEvent ? 'text-red-600' : (darkMode ? 'text-gray-300' : 'text-gray-600')}`}>
                  {centerText}
                </span>
              );
            })()}
           
            <div className="flex items-center gap-2 min-w-0 max-w-[46%] justify-end ml-auto">
              {isLiveEvent && Number((event as any).red_cards_away || 0) > 0 && ( 
                <span title="Cartão vermelho" className="relative inline-flex items-center justify-center shrink-0 mr-0.5"> 
                  <span className="block w-2.5 h-3.5 bg-red-600 rounded-[2px]" /> 
                  {Number((event as any).red_cards_away) > 1 && ( 
                    <span className="absolute -top-1 -right-1.5 flex items-center justify-center w-3 h-3 rounded-full bg-red-800 text-white text-[7px] font-bold leading-none"> 
                      {Number((event as any).red_cards_away)} 
                    </span> 
                  )} 
                </span> 
              )} 
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
          const isTwoWaySport = ['basketball', 'nba', 'tennis', 'american-football', 'baseball', 'mma', 'volleyball', 'handball', 'ice-hockey', 'hockey', 'cricket'].includes(sport);
          const showDraw = !isTwoWaySport && dd > 0;
          const gridCols = showDraw ? 'grid-cols-3' : 'grid-cols-2';
          const anyLow = [hh, (showDraw ? dd : 0), aa].some((x) => x > 0 && x <= 1.01 + 1e-9);
          const liveOneSided = isLiveEvent && isTwoWaySport && hasPrimary && ((hh > 0) !== (aa > 0)) && !showDraw;
          
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

          if (criticalLocked) {
            const label =
              criticalReason === 'GOL'
                ? 'GOLLL'
                : (criticalReason === 'VAR' ? 'REVISÃO VAR' : 'GRANDE CHANCE');
            return (
              <div className="w-full sm:w-[320px] lg:w-[400px]">
                <button
                  type="button"
                  disabled
                  className="w-full h-[50px] rounded-lg bg-red-600/90 text-white font-extrabold uppercase tracking-wider text-sm sm:text-base flex items-center justify-center border border-red-500"
                >
                  {label}
                </button>
              </div>
            );
          }

          if (anyLow || liveOneSided) {
            return (
              <div className="w-full sm:w-[320px] lg:w-[400px]">
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onOpenEvent(event); }}
                  className={`w-full h-[50px] rounded-lg font-extrabold uppercase tracking-wider text-sm sm:text-base flex items-center justify-center border ${
                    darkMode ? 'bg-gray-900/40 text-white border-gray-700 hover:bg-gray-900/60' : 'bg-white text-gray-900 border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  APOSTA JÁ
                </button>
              </div>
            );
          }
            
            return (
              <div className={`grid ${gridCols} gap-2 relative transition-opacity duration-300 w-full sm:w-[320px] lg:w-[400px] ${(isSuspended || postCriticalLocked) ? 'opacity-50 pointer-events-none select-none' : ''}`}>
                {(isSuspended || postCriticalLocked) && (
                   <div className="absolute inset-0 flex items-center justify-center z-10">
                      <span className="bg-red-600/90 text-white text-[10px] sm:text-xs px-2 py-1 rounded shadow-sm font-bold uppercase tracking-wider backdrop-blur-sm border border-red-500">
                        {(() => {
                          if (postCriticalLocked) return 'ATUALIZANDO';
                          const sr = String(suspendReason || '').toUpperCase();
                          if (sr === 'MOMENTO_CRITICO') return (criticalReason === 'GOL' ? 'GOL' : (criticalReason === 'VAR' ? 'REVISÃO VAR' : 'GRANDE CHANCE'));
                          if (sr.includes('VAR')) return 'REVISÃO VAR';
                          if (sr.includes('BIG') || sr.includes('GRANDE')) return 'GRANDE CHANCE';
                          if (sr.includes('GOAL') || sr.includes('GOL')) return 'GOL';
                          if (sr === 'EVENT_FROZEN') return 'GOL/VAR';
                          if (sr === 'LOW_LIQUIDITY') return 'LIQUIDEZ';
                          if (sr === 'RISK_MARGIN') return 'RISCO';
                          return 'SUSPENSO';
                        })()}
                      </span>
                   </div>
                )}
                {(hh > 0) ? (
                  <OddButton 
                    label="1"
                    price={hh}
                    trend={homeTrend}
                    onClick={(e) => { e.stopPropagation(); addPrimary('Casa', hh, hhSelection?.suspended); }}
                    className="w-full h-full min-h-[36px] px-3 py-1 rounded-lg bg-red-600 text-white hover:opacity-90 flex items-center justify-between gap-1"
                    suspended={marketSuspended || (hhSelection?.suspended ? { reason: 'SUSPENSO' } : undefined)}
                  />
                ) : <div />}
                
                {showDraw && (
                  <OddButton 
                    label="X"
                    price={dd}
                    trend={drawTrend}
                    onClick={(e) => { e.stopPropagation(); addPrimary('Empate', dd, ddSelection?.suspended); }}
                    className="w-full h-full min-h-[36px] px-3 py-1 rounded-lg bg-red-600 text-white hover:opacity-90 flex items-center justify-between gap-1"
                    suspended={marketSuspended || (ddSelection?.suspended ? { reason: 'SUSPENSO' } : undefined)}
                  />
                )}
                
                {(aa > 0) ? (
                  <OddButton 
                    label="2"
                    price={aa}
                    trend={awayTrend}
                    onClick={(e) => { e.stopPropagation(); addPrimary('Fora', aa, aaSelection?.suspended); }}
                    className="w-full h-full min-h-[36px] px-3 py-1 rounded-lg bg-red-600 text-white hover:opacity-90 flex items-center justify-between gap-1"
                    suspended={marketSuspended || (aaSelection?.suspended ? { reason: 'SUSPENSO' } : undefined)}
                  />
                ) : <div />}
              </div>
            );
          })()}
        </div>
      </div> 
    </div> 
  ); 
}

export const MemoEventCard = memo(EventCard);
export default MemoEventCard;
