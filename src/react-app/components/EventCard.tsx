import { OddButton } from '@/react-app/components/OddButton';
import { useMemo, useState, memo, useEffect, useRef } from 'react';
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

  // Robustly extract event ID (support both structures)
  const eventId = event.id || event.fixture?.id;
  
  // Robustly extract team names
  const homeTeamName = event.home_team || event.teams?.home?.name || (event.match ? event.match.split(' vs ')[0] : '') || (event.match ? event.match.split(' - ')[0] : '') || 'Home Team';
  const awayTeamName = event.away_team || event.teams?.away?.name || (event.match ? event.match.split(' vs ')[1] : '') || (event.match ? event.match.split(' - ')[1] : '') || 'Away Team';
  
  const eventLeague = event.league?.name || event.league || 'Unknown League'; // Handle object or string
  const eventSport = event.sport;
  const sport = eventSport ? normalizeSport(eventSport) : getSportFromLeague(typeof eventLeague === 'string' ? eventLeague : (eventLeague?.name || ''));

  // Removed useRealtimeOdds hook
  
  // Helpers
  const handleLabelOutcome = (market: string, name: string) => {
    return labelOutcome(market, name, homeTeamName, awayTeamName);
  };

  // Simplified data access (since we poll fresh events)
  const currentMarkets = useMemo(() => {
      let raw: any = (event as any)?.markets ?? (event as any)?.odds;
      if (typeof raw === 'string') {
        const s = raw.trim();
        if (s) {
          if ((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']'))) {
            try {
              const j = JSON.parse(s);
              raw = typeof j === 'string' ? JSON.parse(j) : j;
            } catch { void 0; }
          }
        }
      }
      if (Array.isArray(raw)) return raw;
      if (raw && typeof raw === 'object') {
        return Object.entries(raw).map(([key, v]: [string, any]) => {
          if (Array.isArray(v)) return { key, selections: v };
          if (v && typeof v === 'object') {
            const selections =
              Array.isArray(v.selections) ? v.selections :
              Array.isArray(v.outcomes) ? v.outcomes :
              Array.isArray(v.values) ? v.values :
              [];
            return { key, ...v, selections };
          }
          return { key, selections: [] };
        });
      }
      return [];
  }, [event]);

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
      'AT', 'ST',
      'Q1', 'Q2', 'Q3', 'Q4', 'OT',
      'P1', 'P2', 'P3',
      'SO',
      'S1', 'S2', 'S3', 'S4', 'S5',
      'IN', 'IN1', 'IN2', 'IN3', 'IN4', 'IN5', 'IN6', 'IN7', 'IN8', 'IN9',
      'IN_PROGRESS',
      '2MW', '2MIN',
    ]);
    return liveStatuses.has(status);
  }, [event]);

  const isFinishedEvent = useMemo(() => {
    const statusRaw = String(event?.status ?? event?.fixture?.status?.short ?? event?.fixture?.status?.long ?? '');
    const statusKey = statusRaw
      .toUpperCase()
      .trim()
      .replace(/[^A-Z0-9_]+/g, '');
    const finishedKeys = new Set(['FT', 'AET', 'FT_PEN', 'FTPEN', 'AWD', 'WO', 'ABD', 'CANC', 'PST', 'FIN', 'FINAL', 'FINISHED', 'ENDED']);
    if (finishedKeys.has(statusKey)) return true;
    if (/MATCHFINISHED|FULLTIME|GAMEOVER|ENCERRAD|TERMINAD/.test(statusKey)) return true;
    return false;
  }, [event]);

  const cleanTeam = (s: string) => {
    const raw = String(s || '');
    const head = raw.split(',')[0] || raw;
    return abbreviateTeamName(head.trim());
  };

  const tennisScore = useMemo(() => {
    if (sport !== 'tennis') return null;
    const raw = (event as any)?.score;
    let obj: any = null;
    if (typeof raw === 'string') {
      const str = raw.trim();
      if (str && (str.startsWith('{') || str.startsWith('['))) {
        try { obj = JSON.parse(str); } catch { obj = null; }
      }
    } else if (raw && typeof raw === 'object') {
      obj = raw;
    }
    if (!obj || typeof obj !== 'object') return null;

    const toNumOrNull = (v: any) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };

    const readSetPair = (v: any): { home: number | null; away: number | null } => {
      if (!v || typeof v !== 'object') return { home: null, away: null };
      return { home: toNumOrNull(v.home), away: toNumOrNull(v.away) };
    };

    const setsRoot = obj.sets || obj.set || {};
    const s1 = readSetPair(setsRoot.s1 || setsRoot.set1);
    const s2 = readSetPair(setsRoot.s2 || setsRoot.set2);
    const s3 = readSetPair(setsRoot.s3 || setsRoot.set3);

    const normalizePoint = (v: any): '15' | '30' | '40' | 'AD' | null => {
      const s = String(v ?? '').trim().toUpperCase();
      if (s === '15' || s === '30' || s === '40') return s as any;
      if (s === 'A' || s === 'AD' || s === 'ADV' || s === 'ADVANTAGE') return 'AD';
      const n = Number(s);
      if (Number.isFinite(n) && (n === 15 || n === 30 || n === 40)) return String(n) as any;
      return null;
    };

    const pointRoot = obj.point || obj.points || obj.currentPoint || obj.current_point || {};
    const pHome = normalizePoint(pointRoot.home ?? pointRoot.h ?? obj.pointHome ?? obj.homePoint);
    const pAway = normalizePoint(pointRoot.away ?? pointRoot.a ?? obj.pointAway ?? obj.awayPoint);

    const hasAnySet =
      s1.home != null || s1.away != null ||
      s2.home != null || s2.away != null ||
      s3.home != null || s3.away != null;

    return { hasAnySet, s1, s2, s3, pHome, pAway };
  }, [event, sport]);

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

  // ─────────────────────────────────────────────────────────────────────
  // Critical-event state machine (mirrors SubOddsModel) — listing card
  // ─────────────────────────────────────────────────────────────────────
  type CritState = 'idle' | 'big_chance' | 'var_review' | 'var_penalty' | 'goal';
  const [critState, setCritState] = useState<CritState>('idle');
  const lastEventIdRef = useRef<string>('');

  const liveEventList: any[] = useMemo(() => {
    const a = (event as any)?.events;
    if (Array.isArray(a)) return a;
    const b = (event as any)?.fixture?.events;
    return Array.isArray(b) ? b : [];
  }, [event]);

  useEffect(() => {
    if (!isLiveEvent || liveEventList.length === 0) return;
    const latest = liveEventList[liveEventList.length - 1];
    if (!latest) return;
    const id = `${latest?.timer || latest?.minute || latest?.time?.elapsed || ''}|${latest?.type || ''}|${latest?.detail || ''}|${latest?.player?.name || latest?.player || ''}`;
    if (id === lastEventIdRef.current) return;
    lastEventIdRef.current = id;

    const text = `${latest?.type || ''} ${latest?.detail || ''} ${latest?.text || ''}`.toLowerCase();
    let next: CritState | null = null;
    if (/(var.*pen|pen.*var|p[eê]nalti.*confirmad|penalty.*confirmed)/.test(text)) next = 'var_penalty';
    else if (/\bvar\b|video.*assist|review/.test(text)) next = 'var_review';
    else if (/\b(goal|gol)\b/.test(text) && !/disallow|cancel|anulad|missed|own/.test(text)) next = 'goal';
    else if (/big.*chance|grande.*chance|great.*chance|big_chance/.test(text)) next = 'big_chance';

    if (next) {
      setCritState(next);
      const dur = next === 'goal' ? 12000 : next === 'var_penalty' ? 10000 : 8000;
      const t = setTimeout(() => setCritState('idle'), dur);
      return () => clearTimeout(t);
    }
  }, [liveEventList, isLiveEvent]);

  // "Aposta Já" trigger: any odd ≤ 1.01, score 2-0 at min 80+, or diff ≥ 3
  const apostaJaActive = useMemo(() => {
    if (!isLiveEvent) return false;
    const goals: any = (event as any)?.goals;
    let h = 0, a = 0;
    if (goals && typeof goals === 'object') { h = Number(goals.home ?? 0); a = Number(goals.away ?? 0); }
    const diff = Math.abs(h - a);
    if (diff >= 3) return true;
    const elapsed = Number((event as any).elapsed ?? (event as any).fixture?.status?.elapsed ?? 0) || 0;
    const timerStr = String((event as any).timer || (event as any).fixture?.status?.timer || '');
    const minute = parseInt(timerStr.replace(/[^\d]/g, ''), 10) || elapsed;
    if (diff >= 2 && minute >= 80) return true;
    if (hh > 0 && hh <= 1.01) return true;
    if (dd > 0 && dd <= 1.01) return true;
    if (aa > 0 && aa <= 1.01) return true;
    return false;
  }, [isLiveEvent, event, hh, dd, aa]);

  // Choose the favourite (lowest non-zero odd) for one-tap betting
  const favBet = useMemo(() => {
    const opts: { label: 'Casa' | 'Empate' | 'Fora'; odd: number }[] = [];
    if (hh > 0) opts.push({ label: 'Casa', odd: hh });
    if (dd > 0) opts.push({ label: 'Empate', odd: dd });
    if (aa > 0) opts.push({ label: 'Fora', odd: aa });
    if (opts.length === 0) return null;
    return opts.reduce((m, x) => x.odd < m.odd ? x : m, opts[0]);
  }, [hh, dd, aa]);

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
                        {sport === 'tennis' && eventTime && <span className="opacity-80 text-[10px]">{eventTime}</span>}
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
          {sport === 'tennis' ? (
            <span className="flex items-center gap-2 w-full justify-start">
              <div className="flex flex-col gap-1.5 min-w-0 flex-1">
                {(() => {
                  const Row = ({ name, side }: { name: string; side: 'home' | 'away' }) => {
                    const showSets = !!tennisScore?.hasAnySet;
                    const sets = tennisScore ? [tennisScore.s1, tennisScore.s2, tennisScore.s3] : [];
                    const point = side === 'home' ? tennisScore?.pHome : tennisScore?.pAway;

                    return (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold truncate leading-tight min-w-0">{String(name || '').split(',')[0].trim() || '-'}</span>
                      <div className="flex items-center gap-1.5 shrink-0 tabular-nums">
                        {showSets && sets.map((s, idx) => {
                          const val = side === 'home' ? s.home : s.away;
                          return (
                            <span key={idx} className={`w-4 text-right text-xs font-bold ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                              {val ?? ''}
                            </span>
                          );
                        })}
                        {isLiveEvent && point && (
                          <span className={`ml-1 px-1 rounded text-[10px] font-extrabold ${darkMode ? 'bg-gray-700 text-gray-100' : 'bg-gray-200 text-gray-900'}`}>
                            {point}
                          </span>
                        )}
                      </div>
                    </div>
                    );
                  };

                  return (
                    <>
                      <Row name={homeTeamName} side="home" />
                      <Row name={awayTeamName} side="away" />
                    </>
                  );
                })()}
              </div>

              {(() => {
                if (!isLiveEvent) {
                  return (
                    <span className={`text-xs font-bold shrink-0 px-1 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                      {'vs'}
                    </span>
                  );
                }

                const statusShort = String(event?.status ?? event?.fixture?.status?.short ?? '').toUpperCase().trim();
                const statusLong = String(event?.fixture?.status?.long ?? (event as any)?.status_long ?? '').toUpperCase().trim();
                const setNumFromStatus = (() => {
                  const m1 = statusShort.match(/^S(\d)$/);
                  if (m1) return Number(m1[1]);
                  const m2 = statusLong.match(/\bSET\s*(\d)\b/);
                  if (m2) return Number(m2[1]);
                  const m3 = statusShort.match(/\bSET\s*(\d)\b/);
                  if (m3) return Number(m3[1]);
                  return 0;
                })();
                const setLabel = setNumFromStatus >= 1 && setNumFromStatus <= 5 ? `${setNumFromStatus}º SET` : '';

                return (
                  <span className="flex flex-col items-center shrink-0 px-1 gap-0.5">
                    {setLabel ? (
                      <span className="text-[10px] font-bold text-red-600 bg-red-600/10 rounded px-1 leading-tight">{setLabel}</span>
                    ) : (
                      <span className="text-xs font-bold text-red-600">AO VIVO</span>
                    )}
                  </span>
                );
              })()}
            </span>
          ) : (
            <span className="flex items-center gap-2 w-full justify-start">
              <div className="flex items-center gap-2 min-w-0 max-w-[46%]">
                <span className="text-sm font-semibold truncate leading-tight">{cleanTeam(homeTeamName)}</span>
              </div>

              {(() => {
              const rawHome = (event as any).goals?.home ?? (event as any).golsCasa ?? (event as any).score_home;
              const rawAway = (event as any).goals?.away ?? (event as any).golsFora ?? (event as any).score_away;

              const formatScore = (val: any) => {
                if (val === null || val === undefined) return undefined;
                if (typeof val === 'object') {
                  const picks = [(val as any).total, (val as any).score, (val as any).current, (val as any).goals];
                  for (const p of picks) {
                    if (p === null || p === undefined) continue;
                    const n = Number(p);
                    if (Number.isFinite(n)) return n;
                  }
                  return undefined;
                }
                const n = Number(val);
                if (Number.isFinite(n)) return n;
                return undefined;
              };

              let homeScore = formatScore(rawHome);
              let awayScore = formatScore(rawAway);
              let minuteFromScore: number | null = null;
              let forceTimer: string = '';

              if (isLiveEvent && (homeScore === undefined || awayScore === undefined) && (event as any).score) {
                const s = (event as any).score;
                if (typeof s === 'string') {
                  const str = s.trim();
                  if (str) {
                    if (str.includes('{') || str.includes(':')) {
                      try {
                        const j = JSON.parse(str);
                        const hn = Number(j?.home);
                        const an = Number(j?.away);
                        if (homeScore === undefined && Number.isFinite(hn)) homeScore = hn;
                        if (awayScore === undefined && Number.isFinite(an)) awayScore = an;
                      } catch { void 0 }
                    } else {
                      if (/pen/i.test(str)) forceTimer = 'PEN';
                      const m = str.match(/(\d+)\s*[-:]\s*(\d+)/);
                      if (m) {
                        const hs = Number(m[1]);
                        const awayStr = String(m[2] || '').trim();
                        let as = Number(awayStr);

                        if (sport === 'soccer' && awayStr.length >= 3 && Number.isFinite(hs) && Number.isFinite(as) && as > 9) {
                          const tryLens = [2, 3];
                          for (const minLen of tryLens) {
                            if (awayStr.length <= minLen) continue;
                            const awayPart = awayStr.slice(0, -minLen);
                            const minPart = awayStr.slice(-minLen);
                            const awayN = Number(awayPart);
                            const minN = Number(minPart);
                            if (!Number.isFinite(awayN) || !Number.isFinite(minN)) continue;
                            if (awayN < 0 || awayN > 9) continue;
                            if (minLen === 2 && minN > 99) continue;
                            if (minLen === 3 && minN < 100) continue;
                            if (minN < 0 || minN > 130) continue;
                            as = awayN;
                            minuteFromScore = minN;
                            break;
                          }
                        }

                        if (homeScore === undefined && Number.isFinite(hs)) homeScore = hs;
                        if (awayScore === undefined && Number.isFinite(as)) awayScore = as;
                      }
                    }
                  }
                } else if (typeof s === 'object') {
                  const hn = Number((s as any)?.home);
                  const an = Number((s as any)?.away);
                  if (homeScore === undefined && Number.isFinite(hn)) homeScore = hn;
                  if (awayScore === undefined && Number.isFinite(an)) awayScore = an;
                }
              }

              let scoreStr = '';
              if (isLiveEvent && homeScore !== undefined && awayScore !== undefined) {
                scoreStr = `${homeScore}-${awayScore}`;
              } else if (isLiveEvent && event.score) {
                let displayScore: any = event.score;
                if (typeof displayScore === 'string' && (displayScore.includes('{') || displayScore.includes(':'))) {
                  try {
                    const parsed = JSON.parse(displayScore);
                    const hn = Number(parsed?.home);
                    const an = Number(parsed?.away);
                    if (Number.isFinite(hn) && Number.isFinite(an)) {
                      displayScore = `${hn}-${an}`;
                    }
                  } catch {
                    displayScore = String(displayScore);
                  }
                } else if (typeof displayScore === 'object' && displayScore?.home !== undefined) {
                  const hn = Number(displayScore?.home);
                  const an = Number(displayScore?.away);
                  if (Number.isFinite(hn) && Number.isFinite(an)) {
                    displayScore = `${hn}-${an}`;
                  } else {
                    displayScore = '';
                  }
                }
                scoreStr = String(displayScore);
              }

              const elapsed = Number((event as any).elapsed ?? (event as any).fixture?.status?.elapsed ?? (event as any).status?.elapsed ?? 0) || 0;
              const timer = String((event as any).timer || (event as any).fixture?.status?.timer || '').trim();
              const statusShort = String((event as any).status ?? (event as any).fixture?.status?.short ?? '').trim();
              const statusLong = String((event as any).fixture?.status?.long ?? (event as any).status_long ?? '').trim();
              const statusU = statusShort.toUpperCase();

              const derivedTimer = (() => {
                const candidate = String(statusLong || statusShort || '').trim();
                const cu = candidate.toUpperCase();

                if (sport === 'tennis') return '';

                if (sport === 'soccer') {
                  if (forceTimer) return forceTimer;
                  if (timer) return timer;
                  if (statusU === 'HT') return 'HT';
                  if (statusU === '1H' || statusU === '2H') return elapsed > 0 ? `${elapsed}'` : statusU;
                  if (statusU === 'AT' || statusU === 'ST') return statusU;
                  if (statusU === 'ET') return 'ET';
                  if (statusU === 'PEN' || statusU === 'P') return 'PEN';
                  if (elapsed > 0) return `${elapsed}'`;
                  if (minuteFromScore !== null && minuteFromScore > 0) return `${minuteFromScore}'`;
                  if (/HALF\s*TIME|INTERVAL|HT/.test(cu)) return 'HT';
                  if (/PEN/.test(cu)) return 'PEN';
                  if (/EXTRA\s*TIME|ET/.test(cu)) return 'ET';
                  return '';
                }

                if (sport === 'basketball') {
                  if (timer && /:/.test(timer)) return timer;
                  if (cu === 'Q1' || cu === 'Q2' || cu === 'Q3' || cu === 'Q4' || cu === 'OT' || cu === 'HT' || cu === 'FT') return cu;
                  if (statusU === 'Q1' || statusU === 'Q2' || statusU === 'Q3' || statusU === 'Q4' || statusU === 'OT' || statusU === 'HT') return statusU;
                  return '';
                }

                if (sport === 'ice-hockey') {
                  if (timer && /:/.test(timer)) return timer;
                  if (statusU === 'P1' || statusU === 'P2' || statusU === 'P3' || statusU === 'OT' || statusU === 'SO') return statusU;
                  if (cu === 'P1' || cu === 'P2' || cu === 'P3' || cu === 'OT' || cu === 'SO') return cu;
                  return '';
                }

                if (sport === 'american-football') {
                  if (timer && /:/.test(timer)) return timer;
                  if (statusU === '2MW' || statusU === '2MIN') return '2MIN';
                  if (statusU === 'Q1' || statusU === 'Q2' || statusU === 'Q3' || statusU === 'Q4' || statusU === 'OT' || statusU === 'HT') return statusU;
                  if (cu === 'Q1' || cu === 'Q2' || cu === 'Q3' || cu === 'Q4' || cu === 'OT' || cu === 'HT') return cu;
                  return '';
                }

                if (sport === 'baseball') {
                  if (/\b(TOP|BOTTOM)\b/i.test(candidate) || /\b(1ST|2ND|3RD|4TH|5TH|6TH|7TH|8TH|9TH)\b/i.test(candidate)) return candidate;
                  return '';
                }

                if (!candidate) return '';
                if (cu === 'LIVE' || cu === 'INPLAY' || cu === 'IN PLAY' || cu === 'PLAYING') return '';
                if (/\b(TOP|BOTTOM)\b/i.test(candidate) || /\b(1ST|2ND|3RD|4TH|5TH|6TH|7TH|8TH|9TH)\b/i.test(candidate)) return candidate;
                if (cu === 'Q1' || cu === 'Q2' || cu === 'Q3' || cu === 'Q4') return candidate;
                if (cu === 'P1' || cu === 'P2' || cu === 'P3') return candidate;
                return candidate.length <= 8 ? candidate : '';
              })();

              const displayTimer = derivedTimer;

              if (isLiveEvent) {
                return (
                  <span className="flex flex-col items-center shrink-0 px-1 gap-0.5">
                    <span className="text-xs font-bold text-red-600">{scoreStr || 'AO VIVO'}</span>
                    {displayTimer && (
                      <span className="text-[10px] font-bold text-red-600 bg-red-600/10 rounded px-1 leading-tight">{displayTimer}</span>
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
            </div>
          </span>
          )}
        </button>
        
      </div>
          
         </div> 
      </div>
    </div> 
  ); 
}

export const MemoEventCard = memo(EventCard);
export default MemoEventCard;
