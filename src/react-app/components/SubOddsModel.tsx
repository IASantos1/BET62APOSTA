import { useMemo, memo, useState, useEffect, useRef } from 'react'
import { fairOddsTwoWay, formatFairOdd } from '@/shared/fairOdds'
import { OddButton } from './OddButton'
import { useMarketSignals } from '../hooks/useMarketSignals'
import { 
  MARKET_CONFIG, 
  MARKET_GROUPS, 
  BASKETBALL_GROUPS, 
  TENNIS_GROUPS, 
  VOLLEYBALL_GROUPS, 
  AFL_GROUPS, 
  BASEBALL_GROUPS, 
  FORMULA1_GROUPS, 
  AMERICAN_FOOTBALL_GROUPS, 
  HANDBALL_GROUPS, 
  ICE_HOCKEY_GROUPS, 
  MMA_GROUPS, 
  RUGBY_GROUPS 
} from '../constants/marketConfig'

export interface MarketItem {
  label: string
  odd: number
  selection?: string
  name?: string
  header?: string
  handicap?: string
  suspended?: boolean
}

export interface Markets {
  [key: string]: MarketItem[]
}

type LegacyComboCard = {
  id: string
  badge: string
  title: string
  odd: number
  marketLabel: string
  legs: Array<{
    marketId: string
    marketName: string
    selection: string
    odd: number
    settlementKey: string
  }>
  comboMeta: any
}

const parseLiveMinuteValue = (rawTimer?: string | null, fallbackElapsed?: number | null): number => {
  const timer = String(rawTimer || '').trim();
  const stoppage = timer.match(/^(\d{1,3})\s*\+\s*(\d{1,2})$/);
  if (stoppage) return Number(stoppage[1]) + Number(stoppage[2]);
  const mmss = timer.match(/^(\d{1,3}):(\d{2})$/);
  if (mmss) return Number(mmss[1]);
  const minute = timer.match(/^(\d{1,3})'?$/);
  if (minute) return Number(minute[1]);
  const fallback = Number(fallbackElapsed ?? 0);
  return Number.isFinite(fallback) && fallback > 0 ? fallback : 0;
};

const detectSoccerPhase = (
  statusShort?: string | null,
  statusLong?: string | null,
  rawTimer?: string | null,
  elapsedOrMinute?: number | null,
): 'first_half' | 'halftime' | 'second_half' | 'extra_time' | 'other' => {
  const short = String(statusShort || '').trim().toUpperCase();
  const long = String(statusLong || '').trim().toUpperCase();
  const timer = String(rawTimer || '').trim();
  const minute = parseLiveMinuteValue(timer, elapsedOrMinute);

  if (short === 'HT' || /HALF\s*TIME|INTERVAL/.test(long)) return 'halftime';
  if (short === 'ET' || short === 'AET' || short === 'ET1' || short === 'ET2' || /EXTRA\s*TIME|OVERTIME/.test(long)) return 'extra_time';
  if (short === '2H' || /SECOND\s*HALF|2ND\s*HALF/.test(long)) return 'second_half';
  if (short === '1H' || /FIRST\s*HALF|1ST\s*HALF/.test(long)) return 'first_half';
  if (/^45\s*\+\s*\d{1,2}$/.test(timer)) return 'first_half';
  if (/^90\s*\+\s*\d{1,2}$/.test(timer)) return 'second_half';
  if (minute >= 46) return 'second_half';
  if (minute > 0) return 'first_half';
  return 'other';
};

// Single odd row: label outside (left), red button (right)
const OddRow = memo(({ item, onSelect, suspended, compact }: {
  item: MarketItem
  onSelect: (label: string, odd: number) => void
  suspended?: string
  compact?: boolean
}) => {
  const [trend, setTrend] = useState<'up' | 'down' | 'stable'>('stable');
  const prevRef = useRef(Number(item.odd));

  const val = Number(item.odd);
  const isSusp = !!suspended || item.suspended === true;
  const priceStr = val > 0 ? val.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '--';

  if (val !== prevRef.current) {
    setTrend(val > prevRef.current ? 'up' : 'down');
    prevRef.current = val;
  }

  useEffect(() => {
    if (trend !== 'stable') {
      const t = setTimeout(() => setTrend('stable'), 5000);
      return () => clearTimeout(t);
    }
  }, [trend]);

  return (
    <div className={`flex items-center justify-between gap-2 w-full ${compact ? 'py-1' : 'py-1.5'}`}>
      <span className="text-sm font-medium text-gray-700 dark:text-gray-300 flex-1 min-w-0 truncate leading-tight">
        {item.label}
      </span>
      <div className="relative flex-shrink-0">
        <button
          onClick={isSusp ? undefined : () => onSelect(String(item.selection || item.label), val)}
          disabled={isSusp}
          className={`
            min-w-[72px] md:min-w-[80px] h-11 px-3 rounded-lg font-bold text-sm tabular-nums
            transition-all duration-200 flex items-center justify-center gap-1
            ${isSusp
              ? 'bg-gray-600/40 text-gray-400 cursor-not-allowed'
              : 'bg-red-600 text-white hover:bg-red-500 active:scale-95 shadow-sm'
            }
            ${trend === 'up' ? 'ring-2 ring-green-400' : trend === 'down' ? 'ring-2 ring-gray-400' : ''}
          `}
        >
          {!isSusp && trend === 'up' && <span className="text-green-300 text-[10px]">▲</span>}
          {!isSusp && trend === 'down' && <span className="text-gray-300 text-[10px]">▼</span>}
          {isSusp
            ? <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
              </svg>
            : <span className={trend === 'up' ? 'text-green-200' : trend === 'down' ? 'text-gray-300' : 'text-white'}>
                {priceStr}
              </span>
          }
        </button>
        {isSusp && suspended && suspended !== 'EVENT_FROZEN' && (
          <div className="absolute -top-2 right-0 z-20 pointer-events-none">
            <span className={`text-[9px] px-1.5 py-0.5 rounded shadow-sm font-bold uppercase tracking-wider whitespace-nowrap
              ${suspended === 'GOAL' ? 'bg-red-600/90 text-white' :
                suspended === 'VAR' ? 'bg-yellow-600/90 text-white' :
                suspended === 'CARD' ? 'bg-orange-600/90 text-white' :
                suspended === 'CHANCE' ? 'bg-rose-600/90 text-white' :
                suspended === 'PENALTY' ? 'bg-orange-600/90 text-white' :
                'bg-gray-600/90 text-gray-200'}`}
            >
              {suspended === 'GOAL' ? 'GOL' : suspended === 'VAR' ? 'VAR' : suspended === 'CARD' ? 'CARTÃO' : suspended === 'CHANCE' ? 'CHANCE' : suspended === 'PENALTY' ? 'PÊNALTI' : suspended}
            </span>
          </div>
        )}
      </div>
    </div>
  );
});

// MarketCard wrapper
const MarketCard = memo(({ title, darkMode, children, noPad }: {
  title: string
  darkMode: boolean
  children: React.ReactNode
  noPad?: boolean
}) => (
  <div className={`rounded-xl border ${darkMode ? 'bg-gray-900/50 border-gray-700' : 'bg-white border-gray-200'} overflow-hidden`}>
    <div className={`flex items-center gap-1.5 px-3 py-2.5 border-b ${darkMode ? 'border-gray-700 bg-gray-800/50' : 'border-gray-100 bg-gray-50'}`}>
      <span className={`text-sm font-bold ${darkMode ? 'text-white' : 'text-gray-900'}`}>{title}</span>
      <span className="text-gray-400 text-sm cursor-help" title="Informação sobre este mercado">ⓘ</span>
    </div>
    <div className={noPad ? '' : 'px-3 py-2'}>
      {children}
    </div>
  </div>
));

// Button group with pagination — uses OddRow layout
const MarketButtonGroup = memo(({ items, onSelect, suspendedReason, columns, darkMode }: {
  items: MarketItem[]
  onSelect: (label: string, odd: number) => void
  suspendedReason?: string
  columns?: number
  darkMode?: boolean
}) => {
  const [showAll, setShowAll] = useState(false);
  const LIMIT = 6;
  const isLong = items.length > LIMIT + 2;
  const display = isLong && !showAll ? items.slice(0, LIMIT) : items;

  if (columns === 2 && display.length <= 4) {
    return (
      <div className="flex flex-col gap-1">
        <div className="grid grid-cols-2 gap-x-3 gap-y-0">
          {display.map((it, idx) => (
            <OddRow key={`${it.label}-${idx}`} item={it} onSelect={onSelect} suspended={it.suspended ? (suspendedReason || 'SUSPENSO') : suspendedReason} />
          ))}
        </div>
        {isLong && (
          <button onClick={() => setShowAll(!showAll)} className="self-center text-xs font-bold uppercase tracking-wider text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 py-1.5 px-4 bg-gray-100 dark:bg-gray-800 rounded-full transition-colors mt-1">
            {showAll ? 'Mostrar Menos' : `Mostrar Mais (${items.length - LIMIT})`}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0">
      {display.map((it, idx) => (
        <div key={`${it.label}-${idx}`}>
          {idx > 0 && <div className={`h-px ${darkMode ? 'bg-gray-700/50' : 'bg-gray-100'}`} />}
          <OddRow item={it} onSelect={onSelect} suspended={it.suspended ? (suspendedReason || 'SUSPENSO') : suspendedReason} />
        </div>
      ))}
      {isLong && (
        <button onClick={() => setShowAll(!showAll)} className="self-center text-xs font-bold uppercase tracking-wider text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 py-1.5 px-4 bg-gray-100 dark:bg-gray-800 rounded-full transition-colors mt-2">
          {showAll ? 'Mostrar Menos' : `Mostrar Mais (${items.length - LIMIT})`}
        </button>
      )}
    </div>
  );
});

export function SubOddsModel({
  event,
  darkMode,
  markets,
  eventOdds,
  onSelect,
  labelOutcome,
  applyMarginClamp,
  suspendedMarkets,
  liveEvents,
  liveTimer,
  isLive,
}: {
  event: any
  darkMode: boolean
  markets: Markets | null
  eventOdds: Record<string, any[]> | null
  onSelect: (label: string, odd: number, market?: string, comboMeta?: any) => void
  labelOutcome: (market: string, name: string) => string
  applyMarginClamp: (mk: string, v: number) => number
  suspendedMarkets?: { eventId: number; marketId: string; reason: string }[]
  liveEvents?: any[]
  liveTimer?: string
  isLive?: boolean
}) {
  const home = useMemo(() => String(event?.home_team || (event?.match || '').split(' vs ')[0] || ''), [event])
  const away = useMemo(() => String(event?.away_team || (event?.match || '').split(' vs ')[1] || ''), [event])
  const globalSuspendedReason = String(
    (event as any)?.provider_suspended_reason ||
    (event as any)?.freeze_reason ||
    (event as any)?.suspended_reason ||
    (event as any)?.suspendReason ||
    ((event as any)?.oddsFrozen ? 'EVENT_FROZEN' : '')
  ).trim();
  const isGlobalSuspended =
    Boolean((event as any)?.oddsFrozen) ||
    Boolean((event as any)?.suspended) ||
    Boolean((event as any)?.provider_suspended) ||
    Boolean((event as any)?.event_frozen) ||
    Boolean(globalSuspendedReason);

  const suspendedMap = useMemo(() => {
    const m = new Map<string, string>();
    if (suspendedMarkets) {
      for (const s of suspendedMarkets) {
        m.set(s.marketId, s.reason);
      }
    }
    return m;
  }, [suspendedMarkets]);

  const signalsEventId =
    (event as any)?.id ??
    (event as any)?.fixture?.id ??
    (event as any)?.match_id ??
    (event as any)?.external_event_id ??
    null

  const marketSignals = useMarketSignals({
    eventId: signalsEventId,
    sport: (event as any)?.sport,
    isLive: !!isLive,
  })

  const apiCritState = useMemo(() => {
    if (marketSignals.varActive) return 'var_review' as const
    const c = marketSignals.cta
    if (c === 'idle') return 'idle' as const
    return c as any
  }, [marketSignals.cta, marketSignals.varActive])

  // Per-market post-goal suspension window (each market stays suspended
  // for a different duration after a goal, like real bookmakers)
  const getGoalWindowSuspended = (key?: string): boolean => {
    if (!lastGoalAt || !isLive) return false;
    const elapsed = Date.now() - lastGoalAt;
    if (elapsed > 65_000) return false;
    const k = (key || '').toLowerCase();
    let ms: number;
    if (/corner|escanteio/.test(k)) ms = 5_000;
    else if (/card|cart/.test(k)) ms = 5_000;
    else if (/correct_score|exact_score/.test(k)) ms = 30_000;
    else if (/half|1st_|2nd_/.test(k)) ms = 20_000;
    else if (/h2h|handicap|spreads|double_chance|dnb|draw_no_bet|winning_margin/.test(k)) ms = 60_000;
    else ms = 45_000;
    return elapsed < ms;
  };

  const getSuspendedReason = (marketKey?: string) => {
    if (isGlobalSuspended) return globalSuspendedReason || 'EVENT_FROZEN';
    const effective = apiCritState !== 'idle' ? apiCritState : critState
    if (effective !== 'idle') {
      if (effective === 'var_review' || effective === 'var_penalty') return 'VAR';
      if (effective === 'goal') return 'GOAL';
      if (effective === 'big_chance') return 'CHANCE';
      if (effective === 'penalty') return 'PENALTY';
      if (effective === 'cards') return 'CARD';
    }
    // Per-market goal suspension window (independent of critState — lasts much longer)
    if (marketKey && getGoalWindowSuspended(marketKey)) return 'GOAL';
    return marketKey ? suspendedMap.get(marketKey) : undefined;
  };

  const toBadgeReason = (susp?: string) => {
    const reason = String(susp || '').trim().toUpperCase()
    if (!reason || reason === 'EVENT_FROZEN') return 'SUSPENSO'
    if (reason === 'VAR') return 'VAR'
    if (reason === 'GOAL') return 'GOAL'
    if (reason === 'CHANCE') return 'CHANCE'
    if (reason === 'PENALTY') return 'PENALTY'
    if (reason === 'CARD') return 'CARD'
    return 'SUSPENSO'
  }

  // Current live score — used to block impossible correct-score outcomes
  const currentGoals = useMemo(() => {
    const ev = event as any;

    // 1) Direct integer columns from DB (score_home / score_away)
    const sh = ev?.score_home; const sa = ev?.score_away;
    if (sh != null && sa != null) {
      const h = Number(sh); const a = Number(sa);
      if (Number.isFinite(h) && Number.isFinite(a) && (h > 0 || a > 0)) return { home: h, away: a };
      if (Number.isFinite(h) && Number.isFinite(a)) return { home: h, away: a };
    }

    // 2) goals object (live sync enrichment)
    const goals = ev?.goals;
    if (goals) {
      const g = typeof goals === 'string'
        ? (() => { try { return JSON.parse(goals); } catch { return null; } })()
        : goals;
      if (g) {
        const h = Number(g.home ?? g.localteam_score ?? g.home_score ?? 0);
        const a = Number(g.away ?? g.visitorteam_score ?? g.away_score ?? 0);
        if (Number.isFinite(h) && Number.isFinite(a)) return { home: h, away: a };
      }
    }

    // 3) score TEXT column (JSON string e.g. '{"home":1,"away":0}')
    const score = ev?.score;
    if (score) {
      const s = typeof score === 'string'
        ? (() => { try { return JSON.parse(score); } catch { return null; } })()
        : score;
      if (s) {
        const h = Number(s.home ?? s.localteam_score ?? s.home_score ?? 0);
        const a = Number(s.away ?? s.visitorteam_score ?? s.away_score ?? 0);
        if (Number.isFinite(h) && Number.isFinite(a)) return { home: h, away: a };
      }
    }

    return null;
  }, [event]);

  // Current live corner count — used to resolve corners_total lines
  const currentCorners = useMemo(() => {
    const ev = event as any;
    // Try combined total first
    const tot = ev?.corners ?? ev?.corner_kicks ?? ev?.stats?.corners ?? ev?.stats?.corner_kicks;
    if (tot != null) { const n = Number(tot); if (Number.isFinite(n) && n >= 0) return n; }
    // Try home + away
    const h = Number(ev?.home_corners ?? ev?.stats?.home_corners ?? NaN);
    const a = Number(ev?.away_corners ?? ev?.stats?.away_corners ?? NaN);
    if (Number.isFinite(h) && Number.isFinite(a)) return h + a;
    return -1;
  }, [event]);

  // Current live card count (yellow + red, both teams) — used to resolve cards_total lines
  const currentCards = useMemo(() => {
    const ev = event as any;
    const tot = ev?.cards ?? ev?.total_cards ?? ev?.stats?.cards ?? ev?.stats?.total_cards;
    if (tot != null) { const n = Number(tot); if (Number.isFinite(n) && n >= 0) return n; }
    const yh = Number(ev?.home_yellow_cards ?? ev?.stats?.home_yellow_cards ?? NaN);
    const ya = Number(ev?.away_yellow_cards ?? ev?.stats?.away_yellow_cards ?? NaN);
    const rh = Number(ev?.home_red_cards ?? ev?.stats?.home_red_cards ?? 0);
    const ra = Number(ev?.away_red_cards ?? ev?.stats?.away_red_cards ?? 0);
    if (Number.isFinite(yh) && Number.isFinite(ya)) return yh + ya + (Number.isFinite(rh) ? rh : 0) + (Number.isFinite(ra) ? ra : 0);
    return -1;
  }, [event]);

  // --- Lógica de Odds Principais ---
  const h2hInternalItems = useMemo(() => {
    const raw =
      (eventOdds && (eventOdds as any)['h2h']) ||
      (eventOdds && (eventOdds as any)['h2h_3_way']) ||
      (eventOdds && (eventOdds as any)['main']) ||
      (eventOdds && (eventOdds as any)['1x2']) ||
      (eventOdds && (eventOdds as any)['match_winner']);
    const list = Array.isArray(raw) ? raw : (raw?.outcomes || raw?.values || []);
    const isSuspended = raw?.suspended === true || raw?.status === 'suspended';

    const sportKey = String((event as any)?.sport || '').toLowerCase();
    const isSoccer = sportKey === 'soccer' || (sportKey.includes('football') && !sportKey.includes('american'));
    const homeTeam = (() => {
      const a = String((event as any)?.home_team || '').trim();
      if (a) return a;
      const b = String((event as any)?.teams?.home?.name || '').trim();
      if (b) return b;
      const c = String((event as any)?.home?.name || '').trim();
      if (c) return c;
      const m = String((event as any)?.match || '').split(' vs ');
      return String(m?.[0] || '').trim();
    })();
    const awayTeam = (() => {
      const a = String((event as any)?.away_team || '').trim();
      if (a) return a;
      const b = String((event as any)?.teams?.away?.name || '').trim();
      if (b) return b;
      const c = String((event as any)?.away?.name || '').trim();
      if (c) return c;
      const m = String((event as any)?.match || '').split(' vs ');
      return String(m?.[1] || '').trim();
    })();
    const homeName = homeTeam.toLowerCase().trim();
    const awayName = awayTeam.toLowerCase().trim();

    const norm = (v: any) =>
      String(v ?? '')
        .toLowerCase()
        .trim()
        .replace(/\s+/g, ' ');

    const soccerType = (o: any): 'home' | 'draw' | 'away' | '' => {
      const rawName = norm(o?.label || o?.outcome || o?.name || o?.value || '');
      const rawSel = norm(o?.selection || o?.id || o?.key || o?.side || '');
      const s = norm(`${rawSel} ${rawName}`.trim());
      if (!s) return '';
      if (s === 'x' || s.includes(' draw') || s === 'draw' || s.includes(' empate') || s === 'empate' || s.includes(' tie') || s === 'tie') return 'draw';
      if (s === '1' || s.includes(' home') || s === 'home' || s.includes(' casa') || s === 'casa' || s.includes(' mandante') || s === 'mandante') return 'home';
      if (s === '2' || s.includes(' away') || s === 'away' || s.includes(' fora') || s === 'fora' || s.includes(' visitante') || s === 'visitante') return 'away';
      if (homeName && (s.includes(homeName) || homeName.includes(s))) return 'home';
      if (awayName && (s.includes(awayName) || awayName.includes(s))) return 'away';
      return '';
    };
    
    const mapped = list.map((o: any) => {
      const v0 = Number(o?.odd || 0)
      const v = applyMarginClamp('h2h', v0)
      const rawName = String(o?.label || o?.outcome || o?.name || o?.value || '')
      const t = isSoccer ? soccerType(o) : ''
      const lbl = isSoccer
        ? (t === 'home' ? (homeTeam || 'Casa') : t === 'draw' ? 'Empate' : t === 'away' ? (awayTeam || 'Fora') : labelOutcome('h2h', rawName))
        : labelOutcome('h2h', rawName)
      const key = isSoccer && t ? t : lbl
      const slot = isSoccer ? (t === 'home' ? 0 : t === 'draw' ? 1 : t === 'away' ? 2 : 9) : 9
      return { label: lbl, odd: v, selection: lbl, name: key, header: String(slot), suspended: o?.suspended === true || isSuspended } as MarketItem
    }).filter((x: MarketItem) => (isSuspended && x.label) || (x.label && x.odd > 0))
    
    const by = new Map<string, MarketItem>();
    for (const it of mapped) {
       const key = String(it.name || it.label || '');
       const prev = by.get(key);
       if (!prev || it.odd > prev.odd) by.set(key, it);
    }
    const deduped = Array.from(by.values());
    const getSlot = (it: MarketItem) => {
      const n = Number((it as any)?.header ?? 9);
      return Number.isFinite(n) ? n : 9;
    };
    return deduped
      .map((it) => ({ ...it, header: undefined }))
      .sort((a, b) => getSlot(a) - getSlot(b))
  }, [event, eventOdds, applyMarginClamp, labelOutcome])

  const resultadoRegulamentar = useMemo(() => {
     if (h2hInternalItems.length > 0) return h2hInternalItems;
     const h0 = Number(event?.home_odd || 0)
     const d0 = Number(event?.draw_odd || 0)
     const a0 = Number(event?.away_odd || 0)
     const items: MarketItem[] = []
     if (h0 > 0) items.push({ label: 'Casa', odd: h0 })
     if (d0 > 0) items.push({ label: 'Empate', odd: d0 })
     if (a0 > 0) items.push({ label: 'Fora', odd: a0 })
     if (items.length > 0) return items

     const sport = String(event?.sport || '').toLowerCase();
     if (sport === 'soccer' || (sport.includes('football') && !sport.includes('american'))) {
       return [
         { label: 'Casa', odd: 0 },
         { label: 'Empate', odd: 0 },
         { label: 'Fora', odd: 0 },
       ] as MarketItem[];
     }

     return [] as MarketItem[]
  }, [event, h2hInternalItems])

  const doubleChanceItems = useMemo(() => {
    const raw = (eventOdds && (eventOdds as any)['double_chance']);
    const list = Array.isArray(raw) ? raw : (raw?.outcomes || raw?.values || []);
    const isSuspended = raw?.suspended === true || raw?.status === 'suspended';
    const normalizeDoubleChance = (value: any) => {
      const s = String(value || '').trim().toLowerCase();
      if (!s) return '';
      if (
        s === '1x' ||
        s === '1/x' ||
        s === '1 ou x' ||
        s === '1 or x' ||
        s.includes('home or draw') ||
        s.includes('casa ou empate')
      ) return '1X';
      if (
        s === 'x2' ||
        s === 'x/2' ||
        s === 'x ou 2' ||
        s === 'x or 2' ||
        s.includes('draw or away') ||
        s.includes('empate ou fora')
      ) return 'X2';
      if (
        s === '12' ||
        s === '1/2' ||
        s === '1 ou 2' ||
        s === '1 or 2' ||
        s.includes('home or away') ||
        s.includes('casa ou fora')
      ) return '12';
      return String(value || '').trim();
    };

    const mapped = list.map((o: any) => {
      const v0 = Number(o?.value || o?.odd || 0)
      const v = applyMarginClamp('double_chance', v0)
      const lbl = normalizeDoubleChance(labelOutcome('double_chance', String(o?.outcome || o?.name || '')))
      return { label: lbl, odd: v, suspended: o?.suspended === true || isSuspended } as MarketItem
    }).filter((x: MarketItem) => (isSuspended && x.label) || (x.label && x.odd > 0))
    if (mapped.length > 0) return mapped
    
    const base = resultadoRegulamentar
    if (!base || base.length < 2) return []
    const inv = base.map((it) => { const o = Number(it.odd || 0); return (o > 0) ? (1 / o) : 0 })
    const sum = inv.reduce((x, y) => x + y, 0) || 1
    const pHome = (inv[0] || 0) / sum
    const pDraw = (inv[1] || 0) / sum
    const pAway = (inv[2] || 0) / sum
    const oneX = applyMarginClamp('double_chance', pHome + pDraw > 0 ? (1 / (pHome + pDraw)) : 0)
    const xTwo = applyMarginClamp('double_chance', pAway + pDraw > 0 ? (1 / (pAway + pDraw)) : 0)
    const oneTwo = applyMarginClamp('double_chance', pHome + pAway > 0 ? (1 / (pHome + pAway)) : 0)
    const out: MarketItem[] = []
    if (oneX > 0) out.push({ label: '1X', odd: oneX })
    if (xTwo > 0) out.push({ label: 'X2', odd: xTwo })
    if (oneTwo > 0) out.push({ label: '12', odd: oneTwo })
    return out
  }, [eventOdds, applyMarginClamp, labelOutcome, resultadoRegulamentar])

  // --- Generic extraction ---
  const normalizedMarkets = useMemo(() => {
      const mk: any = markets as any;
      if (!mk) return null;
      if (typeof mk === 'string') {
        const t = mk.trim();
        if (!t || t === '{}' || t === 'null') return null;
        try {
          const o = JSON.parse(t);
          return o && typeof o === 'object' && !Array.isArray(o) ? o : null;
        } catch {
          return null;
        }
      }
      return mk && typeof mk === 'object' && !Array.isArray(mk) ? mk : null;
  }, [markets]);

  const getMarketItems = (key: string, labelKey?: string) => {
      const aliasKeys = (() => {
        if (key === 'totals') return ['totals', 'match_goals', 'goals_total', 'total_goals'];
        if (key === '1st_half_totals') return ['1st_half_totals', 'first_half_totals', 'first_half_goals_total'];
        if (key === '2nd_half_totals') return ['2nd_half_totals', 'second_half_totals', 'second_half_goals_total'];
        if (key === 'first_half_h2h') return ['first_half_h2h', '1st_half', 'half_time_result', 'first_half_result'];
        if (key === 'second_half_h2h') return ['second_half_h2h', '2nd_half', 'second_half_result'];
        return [key];
      })();

      if (normalizedMarkets) {
        for (const alias of aliasKeys) {
          if ((normalizedMarkets as any)[alias] && (normalizedMarkets as any)[alias]!.length > 0) return (normalizedMarkets as any)[alias]!;
        }
        if (key === 'spreads' && (normalizedMarkets as any)['handicap'] && (normalizedMarkets as any)['handicap']!.length > 0) {
          return (normalizedMarkets as any)['handicap']!;
        }
      }

      let raw: any = null;
      for (const alias of aliasKeys) {
        const candidate = eventOdds && (eventOdds as any)[alias];
        if (candidate && (!Array.isArray(candidate) || candidate.length > 0)) {
          raw = candidate;
          break;
        }
      }
      if ((!raw || (Array.isArray(raw) && raw.length === 0)) && key === 'spreads') {
        raw = (eventOdds && (eventOdds as any)['handicap']);
      }
      if ((!raw || (Array.isArray(raw) && raw.length === 0)) && key === 'handicap') {
        raw = (eventOdds && (eventOdds as any)['spreads']);
      }
      const list = Array.isArray(raw) ? raw : (raw?.outcomes || raw?.values || []);
      const isSuspended = raw?.suspended === true || raw?.status === 'suspended';

      const mapped = list.map((o: any) => {
        const v0 = Number(o?.odd || 0)
        const v = applyMarginClamp(key, v0)
        const rawName = o?.label || o?.outcome || o?.name || o?.value || ''
        const lbl = labelOutcome(labelKey || key, String(rawName))
        const hcRaw = o?.point ?? o?.handicap ?? o?.line ?? o?.total ?? o?.spread ?? null
        const hc = hcRaw === null || hcRaw === undefined ? undefined : String(hcRaw)
        return { label: lbl, odd: v, name: String(rawName), handicap: hc, suspended: o?.suspended === true || isSuspended } as MarketItem
      }).filter((x: MarketItem) => (isSuspended && x.label) || (x.label && x.odd > 1.01 && x.odd < 25))
      const n = (s: any) => {
        if (s === null || s === undefined) return NaN
        const x = String(s).trim().replace(',', '.')
        const v = parseFloat(x)
        return Number.isFinite(v) ? v : NaN
      }
      return mapped.sort((a: MarketItem, b: MarketItem) => {
        const ap = n(a.handicap)
        const bp = n(b.handicap)
        if (Number.isFinite(ap) && Number.isFinite(bp) && ap !== bp) return ap - bp
        return Number(a.odd) - Number(b.odd)
      });
  }

  const getMarketTitle = (key: string, sport?: string) => {
      const periodKey = /^period_(\d)_(h2h|totals)$/.exec(key);
      if (periodKey) {
        const n = Number(periodKey[1]);
        const kind = periodKey[2];
        if (n >= 1 && n <= 3) {
          if (kind === 'h2h') return `${n}º Período - Vencedor`;
          if (kind === 'totals') return `${n}º Período - Totais`;
        }
      }

      if (key === 'h2h') {
          const s = (sport || '').toLowerCase();
          if (s.includes('rugby') || s.includes('union') || s.includes('league')) return 'Vencedor da Partida';
          if (s.includes('tennis') || s.includes('tênis')) return 'Vencedor da Partida';
          if (s.includes('basketball') || s.includes('basquete')) return 'Vencedor';
          if (s.includes('mma') || s.includes('ufc') || s.includes('mixed martial arts') || s.includes('luta')) return 'Vencedor da Luta';
          return MARKET_CONFIG['h2h']?.title || 'Resultado Final';
      }

      const raw = (eventOdds && (eventOdds as any)[key]);
      if (raw && raw.sub_category) return raw.sub_category;
      if (key === 'totals') {
          const s = (sport || '').toLowerCase();
          if (s.includes('tennis') || s.includes('tênis')) return 'Total de Games na Partida';
          if (s.includes('basketball') || s.includes('basquete')) return 'Total de Pontos';
          if (s.includes('ice-hockey') || s.includes('hockey') || s.includes('hóquei')) return 'Total de Golos';
          return 'Total de Golos - Tempo Regular';
      }
      if (key === 'match_goals' || key === 'goals_total' || key === 'total_goals') {
          return 'Total de Golos - Tempo Regular';
      }
      if (key === '1st_half_totals' || key === 'first_half_totals' || key === 'first_half_goals_total') {
          return 'Total de Golos - 1º Tempo';
      }
      if (key === '2nd_half_totals' || key === 'second_half_totals' || key === 'second_half_goals_total') {
          return 'Total de Golos - 2º Tempo';
      }
      if (key === 'spreads') {
          const s = (sport || '').toLowerCase();
          if (s.includes('basketball') || s.includes('basquete')) return 'Handicap de Pontos';
          if (s.includes('american') || s.includes('nfl') || s.includes('football')) return 'Handicap';
          if (s.includes('baseball') || s.includes('mlb')) return 'Linha de Corrida';
      }
      return MARKET_CONFIG[key]?.title || key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  }

  const totalsItems = useMemo(() => getMarketItems('totals'), [eventOdds, markets, normalizedMarkets])
  const bttsItems = useMemo(() => {
    const raw = getMarketItems('btts')
    // 1) If API returned BTTS, force order: "Não" (esquerdo) → "Sim" (direito)
    if (raw.length > 0) {
      const nao = raw.find((x: MarketItem) => /n[aã]o/i.test(String(x.label)))
      const sim = raw.find((x: MarketItem) => /sim|yes/i.test(String(x.label)))
      const ordered: MarketItem[] = []
      if (nao) ordered.push({ ...nao, label: 'Não' })
      if (sim) ordered.push({ ...sim, label: 'Sim' })
      if (ordered.length === 2) return ordered
      return raw
    }
    // 2) Fallback — Calcular BTTS via fórmula P(BTTS) = P(A marca) × P(B marca)
    //    Usando Poisson com gols esperados derivados de h2h + totals (over 2.5)
    const base = resultadoRegulamentar
    if (!base || base.length < 2) return []
    const h0 = Number(base.find(b => /casa|home/i.test(b.label))?.odd || 0)
    const d0 = Number(base.find(b => /empate|draw/i.test(b.label))?.odd || 0)
    const a0 = Number(base.find(b => /fora|away/i.test(b.label))?.odd || 0)
    if (h0 <= 1 || a0 <= 1) return []

    // Probabilidades implícitas normalizadas (remove margem)
    const inv = [1 / h0, d0 > 1 ? 1 / d0 : 0, 1 / a0]
    const sum = inv.reduce((x, y) => x + y, 0) || 1
    const pH = inv[0] / sum
    const pA = inv[2] / sum

    // Estimativa de λ total: usa over 2.5 se disponível, senão 2.6 (média futebol)
    let lambdaTotal = 2.6
    const o25 = totalsItems.find((t: MarketItem) => /2[.,]5/.test(String(t.label)) && /acima|over|mais/i.test(String(t.label)))
    if (o25 && Number(o25.odd) > 1.01) {
      const pOver25 = 1 / Number(o25.odd)
      // Mapeamento aproximado P(over 2.5) → λ via Poisson invertida (tabela)
      if (pOver25 > 0.70) lambdaTotal = 3.4
      else if (pOver25 > 0.60) lambdaTotal = 3.0
      else if (pOver25 > 0.50) lambdaTotal = 2.7
      else if (pOver25 > 0.40) lambdaTotal = 2.4
      else if (pOver25 > 0.30) lambdaTotal = 2.1
      else lambdaTotal = 1.8
    }

    // Distribui λ entre casa e fora baseado na força relativa (h2h)
    const ratio = (pH + 0.5 * (1 - pH - pA)) / Math.max(0.1, (pH + pA + (1 - pH - pA)))
    const lambdaHome = lambdaTotal * Math.max(0.35, Math.min(0.65, ratio))
    const lambdaAway = lambdaTotal - lambdaHome

    // P(time marca) = 1 - e^(-λ) (Poisson: prob de >= 1 gol)
    const pHomeScores = 1 - Math.exp(-lambdaHome)
    const pAwayScores = 1 - Math.exp(-lambdaAway)

    // P(BTTS) = P(A marca) × P(B marca)
    const pBTTS = pHomeScores * pAwayScores
    if (pBTTS <= 0.05 || pBTTS >= 0.95) return []

    // Aplica margem de 5% (típico de bookmaker conservador)
    const MARGIN = 1.05
    const oddSim = (1 / pBTTS) / MARGIN
    const oddNao = (1 / (1 - pBTTS)) / MARGIN

    if (oddSim < 1.05 || oddSim > 20 || oddNao < 1.05 || oddNao > 20) return []

    return [
      { label: 'Não', odd: Math.round(oddNao * 100) / 100 },
      { label: 'Sim', odd: Math.round(oddSim * 100) / 100 },
    ] as MarketItem[]
  }, [eventOdds, markets, normalizedMarkets, resultadoRegulamentar, totalsItems])

  const isSoccerEvent = useMemo(() => {
    const sportKey = String((event as any)?.sport || '').toLowerCase()
    return (
      sportKey.includes('soccer') ||
      sportKey.includes('futebol') ||
      (sportKey.includes('football') && !sportKey.includes('american'))
    )
  }, [event])

  const comboCards = useMemo((): LegacyComboCard[] => {
    if (!isSoccerEvent) return []

    const normalizeMainSelection = (label: string) => {
      const lower = String(label || '').toLowerCase()
      if (lower === 'casa' || lower === 'home') return home || 'Casa'
      if (lower === 'fora' || lower === 'away') return away || 'Fora'
      return label
    }

    const normalizeLine = (n: number) => {
      if (!Number.isFinite(n)) return '2.5'
      if (Math.abs(n - Math.round(n)) < 0.001) return String(Math.round(n))
      return String(n).replace('.', ',')
    }

    const parseLineValue = (v: any) => {
      const s = String(v ?? '').replace(',', '.')
      const m = s.match(/(\d+(?:\.\d+)?)/)
      if (!m) return null
      const n = Number(m[1])
      return Number.isFinite(n) ? n : null
    }

    const pickOverLine = () => {
      const candidates = totalsItems
        .filter((item: MarketItem) => /(acima|over|mais)/i.test(String(item.label || '')))
        .map((item: MarketItem) => {
          const line = parseLineValue(item.handicap ?? item.label)
          return line != null ? { line, odd: Number(item.odd) } : null
        })
        .filter(Boolean) as Array<{ line: number; odd: number }>

      if (candidates.length) {
        const prefer = 2.5
        return candidates
          .filter((c) => Number.isFinite(c.odd) && c.odd > 1.01)
          .sort((a, b) => Math.abs(a.line - prefer) - Math.abs(b.line - prefer))[0]
      }

      const lambdaTotal = 2.6
      const pOver25 = 1 - Math.exp(-lambdaTotal) * (1 + lambdaTotal + (lambdaTotal * lambdaTotal) / 2)
      const margin = 1.05
      const odd = pOver25 > 0.05 && pOver25 < 0.95 ? Math.round(((1 / pOver25) / margin) * 100) / 100 : 1.9
      return { line: 2.5, odd }
    }

    const overPick = pickOverLine()

    const homeWinner = [...resultadoRegulamentar].find((item) => {
      const l = String(item.label || '').toLowerCase()
      return l === 'casa' || l === 'home' || (home && l.includes(String(home).toLowerCase()))
    })
    const awayWinner = [...resultadoRegulamentar].find((item) => {
      const l = String(item.label || '').toLowerCase()
      return l === 'fora' || l === 'away' || (away && l.includes(String(away).toLowerCase()))
    })

    const homeProtected = doubleChanceItems.find((item: MarketItem) => String(item.label || '').toUpperCase() === '1X')
    const awayProtected = doubleChanceItems.find((item: MarketItem) => String(item.label || '').toUpperCase() === 'X2')
    const bttsYes = bttsItems.find((item: MarketItem) => /sim|yes/i.test(String(item.label || '')))

    const calculateCombinedOdd = (odds: number[], correlationFactor: number) => {
      if (!odds.length) return 1
      const impliedProbability = odds.reduce((acc, odd) => acc * (1 / odd), 1)
      const adjustedProbability = Math.min(0.92, impliedProbability * correlationFactor)
      return Number((1 / adjustedProbability).toFixed(2))
    }

    const buildCombo = (
      id: string,
      badge: string,
      title: string,
      legs: Array<{ marketId: string; marketName: string; selection: string; odd: number; settlementKey: string }>,
      correlationFactor: number,
    ): LegacyComboCard | null => {
      if (legs.length < 2 || legs.some((leg) => !(Number(leg.odd) > 1.01))) return null
      const odd = calculateCombinedOdd(legs.map((leg) => Number(leg.odd)), correlationFactor)
      return {
        id,
        badge,
        title,
        odd,
        marketLabel: 'Mercados Combinados',
        legs,
        comboMeta: {
          kind: 'same_game_combo',
          comboId: `legacy-${event?.id || 'event'}-${id}`,
          title,
          generatedAutomatically: true,
          generatedAt: new Date().toISOString(),
          sport: 'soccer',
          settlementMode: 'multi_leg_standard',
          voidPolicy: 'void_leg_reprices_combo',
          supportedBySettlement: true,
          explanation: 'Combo gerado automaticamente a partir dos mercados disponíveis deste jogo.',
          legs: legs.map((leg) => ({
            marketId: leg.marketId,
            marketName: leg.marketName,
            settlementKey: leg.settlementKey,
            selection: leg.selection,
            odd: leg.odd,
            availableInPlay: true,
            pauseTriggers: [],
          })),
        },
      }
    }

    const cards = [
      buildCombo(
        'home-over',
        'Equilibrado',
        homeWinner
          ? `${normalizeMainSelection(homeWinner.label)} + Mais de ${normalizeLine(overPick.line)} Golos`
          : `Casa + Mais de ${normalizeLine(overPick.line)} Golos`,
        [
          homeWinner
            ? {
                marketId: 'match-winner',
                marketName: 'Resultado Final',
                selection: normalizeMainSelection(homeWinner.label),
                odd: Number(homeWinner.odd),
                settlementKey: 'match_winner',
              }
            : null,
          {
            marketId: 'over-under-goals',
            marketName: 'Mais/Menos Golos',
            selection: `Mais de ${normalizeLine(overPick.line)} Golos`,
            odd: Number(overPick.odd),
            settlementKey: 'totals',
          },
        ].filter(Boolean) as LegacyComboCard['legs'],
        1.08,
      ),
      buildCombo(
        'away-over',
        'Equilibrado',
        awayWinner
          ? `${normalizeMainSelection(awayWinner.label)} + Mais de ${normalizeLine(overPick.line)} Golos`
          : `Fora + Mais de ${normalizeLine(overPick.line)} Golos`,
        [
          awayWinner
            ? {
                marketId: 'match-winner',
                marketName: 'Resultado Final',
                selection: normalizeMainSelection(awayWinner.label),
                odd: Number(awayWinner.odd),
                settlementKey: 'match_winner',
              }
            : null,
          {
            marketId: 'over-under-goals',
            marketName: 'Mais/Menos Golos',
            selection: `Mais de ${normalizeLine(overPick.line)} Golos`,
            odd: Number(overPick.odd),
            settlementKey: 'totals',
          },
        ].filter(Boolean) as LegacyComboCard['legs'],
        1.07,
      ),
      buildCombo(
        'home-protected-btts',
        'Protegido',
        homeProtected ? '1X + Ambas Marcam' : 'Casa Protegida + Ambas Marcam',
        [
          homeProtected
            ? {
                marketId: 'double-chance',
                marketName: 'Dupla Hipótese',
                selection: String(homeProtected.label || ''),
                odd: Number(homeProtected.odd),
                settlementKey: 'double_chance',
              }
            : null,
          bttsYes
            ? {
                marketId: 'btts',
                marketName: 'Ambas Marcam',
                selection: 'Ambas Marcam - Sim',
                odd: Number(bttsYes.odd),
                settlementKey: 'btts',
              }
            : null,
        ].filter(Boolean) as LegacyComboCard['legs'],
        1.07,
      ),
      buildCombo(
        'away-protected-btts',
        'Protegido',
        awayProtected ? 'X2 + Ambas Marcam' : 'Fora Protegida + Ambas Marcam',
        [
          awayProtected
            ? {
                marketId: 'double-chance',
                marketName: 'Dupla Hipótese',
                selection: String(awayProtected.label || ''),
                odd: Number(awayProtected.odd),
                settlementKey: 'double_chance',
              }
            : null,
          bttsYes
            ? {
                marketId: 'btts',
                marketName: 'Ambas Marcam',
                selection: 'Ambas Marcam - Sim',
                odd: Number(bttsYes.odd),
                settlementKey: 'btts',
              }
            : null,
        ].filter(Boolean) as LegacyComboCard['legs'],
        1.06,
      ),
    ].filter((card): card is LegacyComboCard => card !== null)

    const unique = new Map<string, LegacyComboCard>()
    for (const card of cards) {
      const key = card.legs.map((leg) => `${leg.marketId}:${leg.selection}`).sort().join('|')
      if (!unique.has(key)) unique.set(key, card)
    }
    return Array.from(unique.values()).slice(0, 4)
  }, [isSoccerEvent, event?.id, home, away, resultadoRegulamentar, totalsItems, bttsItems, doubleChanceItems])

  // ─────────────────────────────────────────────────────────────────────
  // CRITICAL EVENT STATE MACHINE — replaces 1X2 buttons during key moments
  // ─────────────────────────────────────────────────────────────────────
  type CritState = 'idle' | 'big_chance' | 'var_review' | 'var_penalty' | 'goal' | 'penalty' | 'cards';
  const [critState, setCritState] = useState<CritState>('idle');
  const [lastGoalAt, setLastGoalAt] = useState<number>(0);
  const [, setMarketTick] = useState<number>(0);
  const lastEventIdRef = useRef<string>('');

  // Watch live events and trigger critical state on goal/var/big-chance/penalty
  useEffect(() => {
    if (!isLive || !Array.isArray(liveEvents) || liveEvents.length === 0) return;
    const sp = String((event as any)?.sport || '').toLowerCase()
    const allow = sp.includes('soccer') || (sp.includes('football') && !sp.includes('american')) || sp.includes('futebol')
    if (!allow) return
    const latest = liveEvents[liveEvents.length - 1];
    if (!latest) return;
    const id = `${latest?.timer || latest?.minute || latest?.time?.elapsed || ''}|${latest?.type || ''}|${latest?.detail || ''}|${latest?.player?.name || latest?.player || ''}`;
    if (id === lastEventIdRef.current) return;
    lastEventIdRef.current = id;

    const text = `${latest?.type || ''} ${latest?.detail || ''} ${latest?.text || ''} ${latest?.comments || ''}`.toLowerCase();
    let next: CritState | null = null;
    // Order matters: most-specific first
    if (/(var.*pen|pen.*var|p[eê]nalti.*confirmad|penalty.*confirmed)/.test(text)) next = 'var_penalty';
    else if (/\bvar\b|video.*assist|review/.test(text)) next = 'var_review';
    else if (/\b(goal|gol)\b/.test(text) && !/disallow|cancel|anulad|missed|own/.test(text)) next = 'goal';
    else if (/pen[aâ]lti|penalty/.test(text)) next = 'penalty';
    else if (/cart[aã]o|card|yellow|red/.test(text)) next = 'cards';
    else if (/big.*chance|grande.*chance|great.*chance|big_chance|gc\b/.test(text)) next = 'big_chance';

    if (next) {
      setCritState(next);
      if (next === 'goal') setLastGoalAt(Date.now());
      // Phase duration: goal is most prominent
      const dur = next === 'goal' ? 12000 : next === 'var_penalty' ? 10000 : 8000;
      const t = setTimeout(() => setCritState('idle'), dur);
      return () => clearTimeout(t);
    }
  }, [liveEvents, isLive]);

  // Tick every 5s while within the goal suspension window to force re-renders
  useEffect(() => {
    if (!isLive || !lastGoalAt) return;
    if (Date.now() - lastGoalAt > 65_000) return;
    const t = setInterval(() => setMarketTick(n => n + 1), 5_000);
    return () => clearInterval(t);
  }, [isLive, lastGoalAt]);

  const apostaJaActive = useMemo(() => {
    if (!isLive) return false;
    const sportKey = String((event as any)?.sport || '').toLowerCase();
    const isSoccer = sportKey.includes('soccer') || sportKey === 'football' || sportKey === 'futebol' ||
      (sportKey.includes('football') && !sportKey.includes('american') && !sportKey.includes('gaelic'));
    if (!isSoccer) return false;
    // Use the already-robust currentGoals (reads score_home/score_away, goals, score JSON)
    const h = Number(currentGoals?.home ?? 0);
    const a = Number(currentGoals?.away ?? 0);
    const diff = Math.abs(h - a);
    const minute = parseLiveMinuteValue(
      liveTimer,
      Number((event as any)?.elapsed ?? (event as any)?.fixture?.status?.elapsed ?? 0),
    );
    const fav = resultadoRegulamentar
      .map((x) => Number(x.odd))
      .filter((x) => Number.isFinite(x) && x > 1)
      .reduce((m, x) => (x < m ? x : m), Number.POSITIVE_INFINITY);
    if (!Number.isFinite(fav)) return false;
    if (fav <= 1.2) return true;
    if (minute >= 75 && diff >= 2 && fav <= 1.35) return true;
    return false;
  }, [isLive, event, liveTimer, resultadoRegulamentar]);

  // ── Live elapsed minute (for progressive market liquidation) ──────────
  const liveElapsedMinute = useMemo(() => {
    if (!isLive) return 0;
    const fromTimer = parseLiveMinuteValue(
      liveTimer,
      Number((event as any)?.elapsed ?? (event as any)?.fixture?.status?.elapsed ?? 0),
    );
    if (fromTimer > 0) return fromTimer;
    const elapsed = Number((event as any)?.elapsed ?? (event as any)?.fixture?.status?.elapsed ?? 0);
    return elapsed || 0;
  }, [isLive, liveTimer, event]);

  const liveSportKey = useMemo(() => String((event as any)?.sport || (event as any)?.sport_key || '').toLowerCase(), [event]);

  const isSoccerLive = useMemo(() => {
    if (!isLive) return false;
    const s = liveSportKey;
    return (
      s.includes('soccer') ||
      s === 'football' ||
      s === 'futebol' ||
      (s.includes('football') && !s.includes('american') && !s.includes('gaelic') && !s.includes('aussie'))
    );
  }, [isLive, liveSportKey]);

  const livePhaseNumber = useMemo(() => {
    if (!isLive) return null;
    const statusShort = String((event as any)?.status_short ?? (event as any)?.fixture?.status?.short ?? '').toUpperCase().trim();
    const statusLong = String((event as any)?.status_long ?? (event as any)?.fixture?.status?.long ?? '').toLowerCase().trim();

    if (liveSportKey === 'tennis' || liveSportKey === 'volleyball') {
      const direct = /^S([1-5])$/.exec(statusShort);
      if (direct) return Math.max(1, Math.min(5, Number(direct[1])));
      const wonHome = Number((event as any)?.score?.home ?? 0);
      const wonAway = Number((event as any)?.score?.away ?? 0);
      return Math.max(1, Math.min(5, (Number.isFinite(wonHome) ? wonHome : 0) + (Number.isFinite(wonAway) ? wonAway : 0) + 1));
    }

    if (liveSportKey === 'basketball') {
      const direct = /^Q([1-4])$/.exec(statusShort);
      if (direct) return Number(direct[1]);
    }

    if (liveSportKey === 'hockey' || liveSportKey === 'ice-hockey') {
      const direct = /^P([1-3])$/.exec(statusShort);
      if (direct) return Number(direct[1]);
    }

    if (liveSportKey === 'baseball') {
      const direct = /^IN(\d+)$/.exec(statusShort);
      if (direct) return Math.max(1, Number(direct[1]));
      const longMatch = /(\d+)(?:st|nd|rd|th)?\s+inning/.exec(statusLong);
      if (longMatch) return Math.max(1, Number(longMatch[1]));
      if (statusShort === 'IN' || statusLong.includes('inning')) return 1;
    }
    return null;
  }, [isLive, event, liveSportKey]);

  const liveSoccerPhase = useMemo(() => {
    if (!isSoccerLive) return 'other' as const;
    return detectSoccerPhase(
      String((event as any)?.status_short ?? (event as any)?.fixture?.status?.short ?? ''),
      String((event as any)?.status_long ?? (event as any)?.fixture?.status?.long ?? ''),
      String(liveTimer ?? (event as any)?.timer ?? (event as any)?.fixture?.status?.timer ?? ''),
      Number((event as any)?.elapsed ?? (event as any)?.fixture?.status?.elapsed ?? liveElapsedMinute ?? 0),
    );
  }, [isSoccerLive, event, liveTimer, liveElapsedMinute]);

  const isMarketLiquidated = (key: string): boolean => {
    if (!isLive) return false;
    if (isSoccerLive) {
      const min = liveElapsedMinute;
      const FIRST_HALF_ONLY = new Set([
        '1st_half', 'first_half_h2h', 'half_time_result', 'first_half_result',
        '1st_half_totals', 'first_half_totals', 'first_half_goals_total',
        '1st_half_goal_odd_even', '1st_half_correct_score',
        'double_chance_1st_half', 'draw_no_bet_1st_half', 'btts_first_half',
        '1st_half_corners', '1st_half_cards',
      ]);
      const SECOND_HALF_ONLY = new Set([
        '2nd_half', 'second_half_h2h', 'second_half_result',
        '2nd_half_totals', 'second_half_totals', 'second_half_goals_total',
        '2nd_half_correct_score', 'btts_second_half',
        '2nd_half_corners', '2nd_half_cards',
      ]);

      if (FIRST_HALF_ONLY.has(key) && liveSoccerPhase !== 'first_half') return true;
      if (SECOND_HALF_ONLY.has(key) && liveSoccerPhase !== 'second_half') return true;

      const keep85 = (marketKey: string) => (
        ['h2h', 'totals', 'match_goals', 'goals_total', 'total_goals', 'double_chance', 'draw_no_bet', 'btts',
          'corners_total', 'corners_2_way', 'corner_handicap', 'spreads', 'handicap', 'next_goal', 'first_team_to_score', 'team_to_score_last']
          .includes(marketKey) ||
        /^totals_[\d_]+$/.test(marketKey) ||
        /^corners_total_[\d_]+$/.test(marketKey) ||
        /^asian_handicap_/.test(marketKey) ||
        /^handicap_european_/.test(marketKey)
      );
      const keep90 = (marketKey: string) => (
        ['h2h', 'totals', 'match_goals', 'goals_total', 'total_goals', 'corners_total', 'corners_2_way',
          'corner_handicap', 'spreads', 'handicap', 'next_goal', 'first_team_to_score']
          .includes(marketKey) ||
        /^totals_[\d_]+$/.test(marketKey) ||
        /^corners_total_[\d_]+$/.test(marketKey) ||
        /^asian_handicap_/.test(marketKey) ||
        /^handicap_european_/.test(marketKey)
      );
      if (min >= 90) return !keep90(key);
      if (min >= 85) return !keep85(key);
      return false;
    }

    if ((liveSportKey === 'tennis' || liveSportKey === 'volleyball') && livePhaseNumber) {
      const aliases = liveSportKey === 'tennis'
        ? {
            1: ['set_1_h2h', 'set_1_totals', 'first_set_winner'],
            2: ['set_2_h2h', 'set_2_totals', 'second_set_winner'],
            3: ['set_3_h2h', 'set_3_totals', 'third_set_winner'],
            4: ['set_4_h2h', 'set_4_totals', 'fourth_set_winner'],
            5: ['set_5_h2h', 'set_5_totals', 'fifth_set_winner'],
          }
        : {
            1: ['first_set_winner', 'first_set_total'],
            2: ['second_set_winner', 'second_set_total'],
            3: ['third_set_winner', 'third_set_total'],
            4: ['fourth_set_winner', 'fourth_set_total'],
            5: ['fifth_set_winner', 'fifth_set_total'],
          };
      for (const [idx, keys] of Object.entries(aliases)) {
        if (Number(idx) !== livePhaseNumber && keys.includes(key)) return true;
      }
      if (liveSportKey === 'tennis' && livePhaseNumber >= 2) {
        const keepTennisLate = (marketKey: string) => (
          ['h2h', 'current_set_winner', 'current_set_totals', 'set_winner', 'sets_winner', 'sets_h2h',
           'total_sets', 'over_under_sets', 'spreads', 'handicap', 'sets_handicap', 'games_handicap',
           'totals', 'match_total_games', 'set_total_games', 'player_games', 'game_winner', 'next_game_winner',
           'tie_break', 'tie_breaks', 'tie_break_in_match']
            .includes(marketKey) ||
          /^set_[1-5]_(h2h|totals)$/.test(marketKey)
        );
        return !keepTennisLate(key);
      }
      if (liveSportKey === 'volleyball' && livePhaseNumber >= 3) {
        const keepVolleyLate = new Set([
          'h2h', 'totals', 'spreads', 'handicap', 'total_sets', 'over_under_sets', 'sets_h2h', 'sets_winner',
          'sets_handicap', 'set_total_points', 'point_handicap', 'winning_margin',
          'first_set_winner', 'second_set_winner', 'third_set_winner', 'fourth_set_winner', 'fifth_set_winner',
          'first_set_total', 'second_set_total', 'third_set_total', 'fourth_set_total', 'fifth_set_total',
        ]);
        return !keepVolleyLate.has(key);
      }
      return false;
    }

    if (liveSportKey === 'basketball' && livePhaseNumber) {
      const aliases: Record<number, string[]> = {
        1: ['q1_h2h', 'q1_totals'],
        2: ['q2_h2h', 'q2_totals'],
        3: ['q3_h2h', 'q3_totals'],
        4: ['q4_h2h', 'q4_totals'],
      };
      for (const [idx, keys] of Object.entries(aliases)) {
        if (Number(idx) !== livePhaseNumber && keys.includes(key)) return true;
      }
      if (livePhaseNumber >= 4) {
        const keepBasketLate = new Set([
          'h2h', 'totals', 'team_totals', 'spreads', 'handicap', 'alternate_spreads',
          'q4_h2h', 'q4_totals', 'quarters_h2h', 'quarters_totals',
          'double_chance', 'winning_margin', 'margin', 'race_to', 'race_to_points',
          'first_to_score', 'next_basket', 'next_scorer', 'three_pointer',
        ]);
        return !keepBasketLate.has(key);
      }
      return false;
    }

    if ((liveSportKey === 'hockey' || liveSportKey === 'ice-hockey') && livePhaseNumber) {
      const aliases: Record<number, string[]> = {
        1: ['period_1_h2h', 'period_1_totals'],
        2: ['period_2_h2h', 'period_2_totals'],
        3: ['period_3_h2h', 'period_3_totals'],
      };
      for (const [idx, keys] of Object.entries(aliases)) {
        if (Number(idx) !== livePhaseNumber && keys.includes(key)) return true;
      }
      if (livePhaseNumber >= 3) {
        const keepHockeyLate = new Set([
          'h2h', 'totals', 'team_totals', 'puck_line', 'spreads', 'handicap', 'double_chance',
          'winning_margin', 'first_to_score', 'period_3_h2h', 'period_3_totals',
          'next_goal_scorer', 'shots_on_goal', 'shots_on_goal_period', 'power_play', 'power_play_goals',
        ]);
        return !keepHockeyLate.has(key);
      }
      return false;
    }

    if (liveSportKey === 'baseball' && livePhaseNumber && livePhaseNumber !== 1) {
      if (['nrfi', 'yrfi', 'first_inning_run', 'first_inning_h2h', 'first_inning_totals', 'result_1st_inning'].includes(key)) return true;
      if (livePhaseNumber >= 7) {
        const keepBaseballLate = new Set([
          'h2h', 'totals', 'run_line', 'spreads', 'handicap', 'team_totals', 'extra_innings',
          'winning_margin', 'inning_winner', 'inning_h2h', 'innings_h2h', 'inning_totals', 'innings_totals',
          'race_to', 'race_to_runs', 'run_range', 'run_total_range',
        ]);
        return !keepBaseballLate.has(key);
      }
      return false;
    }

    return false;
  };

  // Liquidation tier label for display badge
  const liquidationTier = useMemo((): string | null => {
    return null;
  }, []);

  // --- Render each market as a card ---
  const renderMarketContent = (key: string) => {
      // Progressive market liquidation: hide markets based on elapsed minute
      if (isMarketLiquidated(key)) return null;

      if (key !== 'h2h' && ['h2h_3_way', '1x2', 'main', 'match_winner'].includes(key)) {
          if (resultadoRegulamentar.length > 0) return null;
      }

      // H2H — 3-column side-by-side layout (Casa | Empate | Fora)
      // Replaced by single full-width button when:
      //   • critical event detected (goal/var/big_chance/var_penalty)
      //   • match decided ("Aposta Já": odd≤1.01, 2-0 at 80', or 3+ goal diff)
      if (key === 'h2h') {
          if (resultadoRegulamentar.length === 0) return null;
          const title = getMarketTitle('h2h', event?.sport);
          const susp = getSuspendedReason('h2h');
          const isSusp = !!susp;

          // ── "Aposta Já" mode (single big red button) ──────────────────
          if (apostaJaActive && !isSusp) {
            const fav = resultadoRegulamentar.reduce((m, x) => (Number(x.odd) > 0 && Number(x.odd) < Number(m.odd) ? x : m), resultadoRegulamentar[0]);
            const favOdd = Number(fav?.odd) || 0;
            const favStr = favOdd > 0 ? favOdd.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '--';
            const disabled = !(favOdd > 0);
            return (
              <MarketCard title={title} darkMode={darkMode} noPad>
                <div className="p-3">
                  <button
                    onClick={disabled ? undefined : () => fav && onSelect(fav.label, favOdd)}
                    disabled={disabled}
                    className={`w-full h-16 rounded-xl font-black text-xl uppercase tracking-wider text-white shadow-lg
                      bg-gradient-to-r from-red-600 to-rose-700 ring-4 ring-red-400 ring-opacity-50 animate-pulse
                      transition-all duration-200 ${disabled ? 'opacity-60 cursor-not-allowed' : 'hover:scale-[1.02] active:scale-95'}
                      flex items-center justify-center gap-3`}
                  >
                    <span>⚡ APOSTA JÁ</span>
                    {fav && <span className="text-base opacity-90">{fav.label} @ {favStr}</span>}
                  </button>
                </div>
              </MarketCard>
            );
          }

          // ── Normal 3-column layout ────────────────────────────────────
          return (
            <MarketCard title={title} darkMode={darkMode} noPad>
              <div className="grid grid-cols-3 gap-2 p-3">
                {resultadoRegulamentar.map((item, i) => {
                  const val = Number(item.odd);
                  const disabled = isSusp || item.suspended === true || !(val > 0);
                  return (
                    <OddButton
                      key={i}
                      label={String(item.label || '')}
                      price={val}
                      trend="stable"
                      onClick={() => onSelect(String(item.selection || item.label), val)}
                      className="w-full h-full min-h-[48px] px-2 py-2 rounded-lg bg-red-600 text-white hover:opacity-90 flex items-center justify-between gap-1"
                      suspended={disabled ? { reason: toBadgeReason(susp || (item.suspended ? 'SUSPENSO' : '')) } : undefined}
                    />
                  );
                })}
              </div>
            </MarketCard>
          );
      }
      
      // Double Chance — layout horizontal lado a lado (igual a Resultado Final)
      if (key === 'double_chance') {
          if (doubleChanceItems.length === 0) return null;
          const title = getMarketTitle('double_chance', event?.sport);
          const susp = getSuspendedReason('double_chance');
          const isSusp = !!susp;
          const cols = doubleChanceItems.length === 2 ? 'grid-cols-2' : 'grid-cols-3';
          return (
            <MarketCard title={title} darkMode={darkMode} noPad>
              <div className={`grid ${cols} gap-2 p-3`}>
                {doubleChanceItems.map((item: any, i: number) => {
                  const val = Number(item.odd);
                  const disabled = isSusp || item.suspended === true || !(val > 0);
                  return (
                    <OddButton
                      key={i}
                      label={String(item.label || '')}
                      price={val}
                      trend="stable"
                      onClick={() => onSelect(String(item.selection || item.label), val)}
                      className="w-full h-full min-h-[48px] px-2 py-2 rounded-lg bg-red-600 text-white hover:opacity-90 flex items-center justify-between gap-1"
                      suspended={disabled ? { reason: toBadgeReason(susp || (item.suspended ? 'SUSPENSO' : '')) } : undefined}
                    />
                  );
                })}
              </div>
            </MarketCard>
          );
      }

      // Empate Anula Aposta (DNB) — layout horizontal 2 colunas lado a lado
      if (key === 'dnb' || key === 'draw_no_bet') {
          const dnbItems = getMarketItems(key);
          if (dnbItems.length === 0) return null;
          const title = getMarketTitle(key, event?.sport);
          const susp = getSuspendedReason(key);
          const isSusp = !!susp;
          const cols = dnbItems.length <= 2 ? 'grid-cols-2' : 'grid-cols-3';
          return (
            <MarketCard title={title} darkMode={darkMode} noPad>
              <div className={`grid ${cols} gap-2 p-3`}>
                {dnbItems.map((item: any, i: number) => {
                  const val = Number(item.odd);
                  const disabled = isSusp || item.suspended === true || !(val > 0);
                  return (
                    <OddButton
                      key={i}
                      label={String(item.label || '')}
                      price={val}
                      trend="stable"
                      onClick={() => onSelect(String(item.selection || item.label), val)}
                      className="w-full h-full min-h-[48px] px-2 py-2 rounded-lg bg-red-600 text-white hover:opacity-90 flex items-center justify-between gap-1"
                      suspended={disabled ? { reason: toBadgeReason(susp || (item.suspended ? 'SUSPENSO' : '')) } : undefined}
                    />
                  );
                })}
              </div>
            </MarketCard>
          );
      }

      // 1º/2º Tempo — layout horizontal 3 colunas lado a lado (Casa | Empate | Fora)
      const HALF_RESULT_KEYS = new Set(['first_half_h2h','second_half_h2h','1st_half','2nd_half','half_time_result','first_half_result']);
      if (HALF_RESULT_KEYS.has(key)) {
          const halfItems = getMarketItems(key);
          if (halfItems.length === 0) return null;
          const title = getMarketTitle(key, event?.sport);
          const susp = getSuspendedReason(key);
          const isSusp = !!susp;
          const order = (lbl: string) => {
            const l = String(lbl || '').toLowerCase();
            if (l === 'casa' || l.includes('casa') || l === 'home' || l === '1') return 1;
            if (l === 'empate' || l.includes('empate') || l === 'draw' || l === 'x' || l === 'tie') return 2;
            if (l === 'fora' || l.includes('fora') || l === 'away' || l === '2') return 3;
            return 9;
          };
          const ordered = [...halfItems].sort((a, b) => order(a.label) - order(b.label));
          const cols = ordered.length === 2 ? 'grid-cols-2' : 'grid-cols-3';
          return (
            <MarketCard title={title} darkMode={darkMode} noPad>
              <div className={`grid ${cols} gap-2 p-3`}>
                {ordered.map((item, i) => {
                  const val = Number(item.odd);
                  const disabled = isSusp || item.suspended === true || !(val > 0);
                  return (
                    <OddButton
                      key={i}
                      label={String(item.label || '')}
                      price={val}
                      trend="stable"
                      onClick={() => onSelect(String(item.selection || item.label), val)}
                      className="w-full h-full min-h-[48px] px-2 py-2 rounded-lg bg-red-600 text-white hover:opacity-90 flex items-center justify-between gap-1"
                      suspended={disabled ? { reason: toBadgeReason(susp || (item.suspended ? 'SUSPENSO' : '')) } : undefined}
                    />
                  );
                })}
              </div>
            </MarketCard>
          );
      }

      // Spreads/Handicap (inclui Puck Line / Run Line)
      if (key === 'spreads' || key === 'handicap' || key === 'puck_line' || key === 'run_line') {
          const baseItems = getMarketItems(key)
          if (baseItems.length === 0) return null;
          const title = getMarketTitle(key, event?.sport);
          const susp = getSuspendedReason(key);
          
          const parseHandicap = (s: string) => {
            const l = String(s || '')
            const numM = /([+-]?\s*[0-9]+(?:\.[0-9]+)?|[+-]?\s*[0-9]+(?:,[0-9]+)?)/.exec(l)
            const val = numM ? Number(String(numM[1]).replace(',', '.').replace(/\s+/g,'')) : NaN
            const hk = String(home || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
            const ak = String(away || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
            const lk = l.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
            const isHome = /casa|home/i.test(l) || (hk && lk.includes(hk))
            const isAway = /fora|away/i.test(l) || (ak && lk.includes(ak))
            const team = isHome ? 'home' : (isAway ? 'away' : '')
            return { team, val }
          }
          const sportKey = String(event?.sport || '').toLowerCase()
          const maxAbsHandicap = sportKey.includes('soccer') || sportKey.includes('football') ? 3.5 : 30
          const parsed = baseItems.map((x: MarketItem) => {
            const p = parseHandicap(String(x.label || ''))
            if (!p.team || !Number.isFinite(p.val)) return null
            if (Math.abs(p.val) > maxAbsHandicap) return null
            if (!(Number(x.odd) > 1.01 && Number(x.odd) < 25)) return null
            const signLabel = `${p.val >= 0 ? '+' : ''}${p.val}`
            const lbl = signLabel.replace(',', '.')
            const teamName = p.team === 'home' ? (home || 'Casa') : (away || 'Fora')
            const absKey = String(Math.abs(p.val)).replace(',', '.')
            return { team: p.team as 'home' | 'away', absKey, line: lbl, odd: x.odd, selection: `${teamName} ${lbl}`, suspended: x.suspended === true }
          }).filter(Boolean) as { team: 'home'|'away'; absKey: string; line: string; odd: number; selection: string; suspended?: boolean }[]

          const homeMap = new Map<string, { line: string; odd: number; selection: string; suspended?: boolean }>();
          const awayMap = new Map<string, { line: string; odd: number; selection: string; suspended?: boolean }>();

          for (const p of parsed) {
            const rec = { line: p.line, odd: p.odd, selection: p.selection, suspended: p.suspended };
            if (p.team === 'home') homeMap.set(p.absKey, rec);
            else awayMap.set(p.absKey, rec);
          }

          const allLines = Array.from(new Set([...homeMap.keys(), ...awayMap.keys()]))
            .filter((x) => Number.isFinite(Number(String(x).replace(',', '.'))))
            .sort((a, b) => Number(String(a).replace(',', '.')) - Number(String(b).replace(',', '.')));

          if (allLines.length === 0) return null;

          const renderBtn = (item: { line: string; odd: number; selection: string; suspended?: boolean } | undefined) => {
            if (!item) return <div className="w-28" />;
            const priceStr = Number(item.odd) > 0
              ? Number(item.odd).toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
              : '--';
            const blocked = !!susp || item.suspended === true;
            return (
              <button
                onClick={blocked ? undefined : () => onSelect(item.selection, item.odd)}
                disabled={blocked}
                className={`w-28 h-12 rounded-lg font-bold tabular-nums transition-all duration-200 relative
                  ${blocked ? 'bg-gray-600/40 text-gray-400 cursor-not-allowed'
                    : 'bg-red-600 text-white hover:bg-red-500 active:scale-95'}`}
              >
                <div className="flex flex-col items-center justify-center leading-[1.05]">
                  <span className="text-[10px] font-extrabold uppercase tracking-wider">
                    {item.line}
                  </span>
                  <span className="text-sm font-black">{priceStr}</span>
                </div>
              </button>
            );
          };

          return (
            <MarketCard title={title} darkMode={darkMode} noPad>
              <div className={`grid grid-cols-[1fr_auto_auto] items-center`}>
                <div className={`text-[11px] font-bold uppercase tracking-wider px-3 py-2 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>Linha</div>
                <div className={`text-[11px] font-bold uppercase tracking-wider px-3 py-2 text-center ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{home || 'Casa'}</div>
                <div className={`text-[11px] font-bold uppercase tracking-wider px-3 py-2 text-center ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{away || 'Fora'}</div>
                {allLines.map((absKey, i) => {
                  const h = homeMap.get(absKey);
                  const a = awayMap.get(absKey);
                  const rowBg = i % 2 === 0
                    ? (darkMode ? 'bg-gray-800/30' : 'bg-gray-50/80')
                    : '';
                  return (
                    <div key={absKey} className="contents">
                      <div className={`px-3 py-2 text-sm font-semibold ${darkMode ? 'text-gray-200' : 'text-gray-700'} ${rowBg}`}>
                        {absKey}
                      </div>
                      <div className={`px-2 py-2 flex justify-center ${rowBg}`}>{renderBtn(h)}</div>
                      <div className={`px-2 py-2 flex justify-center ${rowBg}`}>{renderBtn(a)}</div>
                    </div>
                  );
                })}
              </div>
            </MarketCard>
          );
      }

      // Totals (gols, cantos, cartões, períodos/quartos/innings/sets/games)
      const TOTALS_KEYS = new Set(['totals','corners_total','cards_total','goals_total','team_totals','match_goals','match_total_games','total_sets','current_set_totals','set_1_totals','set_2_totals','set_3_totals','corners_2_way','cards_in_match','innings_totals','inning_totals']);
      // Per-line derived keys (totals_0_5, totals_1_5, corners_total_0_5 …) — suppress here,
      // their items are merged into the parent market table below.
      if (/^totals_[\d_]+$/.test(key) || /^corners_total_[\d_]+$/.test(key)) return null;

      if (TOTALS_KEYS.has(key) || /_totals$/.test(key) || /_total$/.test(key) || /^total_/.test(key) || /over.under/i.test(key)) {
          if (totalsItems.length === 0 && (key !== 'totals' ? getMarketItems(key).length === 0 : true)) return null;
          
          // For main totals / corners_total, merge in any derived per-line sub-keys so
          // everything appears in one consolidated table instead of duplicate cards.
          const targetItems = (() => {
            const base = key === 'totals' ? totalsItems : getMarketItems(key);
            const subPattern = key === 'totals'
              ? /^totals_[\d_]+$/
              : key === 'corners_total'
                ? /^corners_total_[\d_]+$/
                : null;
            if (!subPattern) return base;
            const allOddsKeys = Object.keys({ ...(eventOdds || {}), ...(normalizedMarkets || {}) });
            const subKeys = [...new Set(allOddsKeys)].filter(k => subPattern.test(k));
            if (subKeys.length === 0) return base;
            // Build a set of line values already present in the API data
            const existingLines = new Set(
              base
                .map((x: MarketItem) => String(x.handicap ?? '').trim())
                .filter(Boolean)
            );
            const extra: MarketItem[] = [];
            for (const sk of subKeys) {
              for (const item of getMarketItems(sk)) {
                const line = String(item.handicap ?? item.point ?? '').trim();
                if (line && !existingLines.has(line) && Number(item.odd) > 0) {
                  extra.push({ ...item, handicap: line });
                }
              }
            }
            return [...base, ...extra];
          })();

          const formatTotalNumber = (label: string) => {
            const m = /([0-9]+(?:\.[0-9]+)?|[0-9]+(?:,[0-9]+)?)/.exec(String(label || ''))
            if (!m) return ''
            const raw = String(m[1]).replace(',', '.')
            const n = parseFloat(raw)
            const s = String(event?.sport || '').toLowerCase()
            const normalizeHalf = s.includes('soccer') || s.includes('football')
            return normalizeHalf && Number.isFinite(n) && Number.isInteger(n) ? String(n + 0.5) : raw
          }
          const okLine = (lbl: string) => {
            const n = Number(lbl);
            if (!Number.isFinite(n)) return false;
            if (n < 0) return false;
            return true;
          };

          const isOver = (lbl: string) => /acima|over|mais/i.test(String(lbl || ''))
          const isUnder = (lbl: string) => /abaixo|under|menos/i.test(String(lbl || ''))
          const _isSoccer = String((event as any)?.sport || '').toLowerCase().includes('soccer') ||
            String((event as any)?.sport || '').toLowerCase().includes('football') ||
            String((event as any)?.sport || '').toLowerCase().includes('futebol');
          const toLine = (x: MarketItem) => {
            // Use handicap field first, fall back to extracting number from label
            const raw = (x.handicap != null && String(x.handicap).trim() !== '')
              ? String(x.handicap).trim()
              : formatTotalNumber(x.label) || '';
            const n = parseFloat(raw);
            // For soccer: normalize integer lines to half-lines (0→0.5, 1→1.5, etc.)
            if (_isSoccer && Number.isFinite(n) && Number.isInteger(n) && n >= 0) {
              return String(n + 0.5);
            }
            return raw;
          }

          const over = targetItems
            .filter((x: MarketItem) => isOver(String(x.label)))
            .map((x: MarketItem) => {
              const line = toLine(x)
              return { ...x, handicap: line, selection: line ? `Acima de ${line}` : x.label } as MarketItem
            })
            .filter((x: MarketItem) => okLine(String(x.handicap || '')) && Number(x.odd) >= 1.00 && Number(x.odd) < 100)
            .sort((a: MarketItem, b: MarketItem) => Number(a.handicap) - Number(b.handicap));

          const under = targetItems
            .filter((x: MarketItem) => isUnder(String(x.label)))
            .map((x: MarketItem) => {
              const line = toLine(x)
              return { ...x, handicap: line, selection: line ? `Abaixo de ${line}` : x.label } as MarketItem
            })
            .filter((x: MarketItem) => okLine(String(x.handicap || '')) && Number(x.odd) >= 1.00 && Number(x.odd) < 100)
            .sort((a: MarketItem, b: MarketItem) => Number(a.handicap) - Number(b.handicap));
             
          if (over.length === 0 && under.length === 0) return null;

          const title = getMarketTitle(key, event?.sport);
          const susp = getSuspendedReason(key);

          // ── Dead-line logic: when running total EXCEEDS a line value, both Over and
          //    Under for that line are fully settled → hide the entire row.
          //    Each market type uses its own running stat (goals / corners / cards).
          const _cg = currentGoals;

          // Pick the right running stat — no isSoccerLive guard needed:
          // if _cg is null (no score data) we return -1, which disables filtering safely.
          // For 0-0 games _runningTotal=0 and isLineResolved(0.5)=false → no lines hidden.
          const _statForKey = (): number => {
            if (key === 'home_team_totals') return _cg ? Number(_cg.home) : -1;
            if (key === 'away_team_totals') return _cg ? Number(_cg.away) : -1;
            if (/corners?_total|corners?_2_way/i.test(key)) return currentCorners >= 0 ? currentCorners : -1;
            if (/cards?_total|cards?_in_match/i.test(key)) return currentCards >= 0 ? currentCards : -1;
            // Default: total goals (main totals, goals_total, etc.)
            return _cg ? Number(_cg.home) + Number(_cg.away) : -1;
          };
          const _runningTotal = _statForKey();

          // True when running total has already passed the line → row is fully settled
          const isLineResolved = (lineStr: string): boolean => {
            if (_runningTotal < 0) return false;
            const lv = Number(lineStr);
            return Number.isFinite(lv) && _runningTotal > lv;
          };

          // Pair over/under by line value
          const overMap = new Map<string, MarketItem>(over.map((x: MarketItem) => [String(x.handicap || ''), x] as [string, MarketItem]));
          const underMap = new Map<string, MarketItem>(under.map((x: MarketItem) => [String(x.handicap || ''), x] as [string, MarketItem]));
          const allLines = Array.from(new Set([...over.map((x: MarketItem) => String(x.handicap || '')), ...under.map((x: MarketItem) => String(x.handicap || ''))]))
            .sort((a, b) => Number(a) - Number(b));
          // Hide resolved lines entirely (running total already exceeded the line).
          // _runningTotal >= 0 means we have real score data; for 0-0 no lines are resolved.
          const visibleLines = _runningTotal >= 0
            ? allLines.filter(line => !isLineResolved(line))
            : allLines;

          return (
            <MarketCard title={title} darkMode={darkMode} noPad>
              <div className={`grid grid-cols-2 items-center`}>
                <div className={`text-[11px] font-bold uppercase tracking-wider px-3 py-2 text-center ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>Acima</div>
                <div className={`text-[11px] font-bold uppercase tracking-wider px-3 py-2 text-center ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>Abaixo</div>
                {visibleLines.map((line, i) => {
                  const o = overMap.get(line);
                  const u = underMap.get(line);
                  // ── Fair odds (no-vig) for this line ──
                  const fair = (o && u && Number(o.odd) > 1 && Number(u.odd) > 1)
                    ? fairOddsTwoWay(Number(o.odd), Number(u.odd))
                    : null;
                  const rowBg = i % 2 === 0
                    ? (darkMode ? 'bg-gray-800/30' : 'bg-gray-50/80')
                    : '';
                  const renderBtn = (item: MarketItem | undefined, side: 'a' | 'b') => {
                    if (!item) return <div className="h-12 w-full" />;
                    const f = fair ? fair[side] : null;
                    const isBlocked = !!susp || item.suspended === true;
                    const sideLabel = side === 'a' ? 'Acima de' : 'Abaixo de';
                    const priceStr = Number(item.odd) > 0 ? Number(item.odd).toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '--';
                    return (
                      <button
                        onClick={isBlocked ? undefined : () => onSelect(String(item.selection || item.label), item.odd)}
                        disabled={isBlocked}
                        title={f ? `Odd justa: ${formatFairOdd(f.fair)}${f.isValue ? ` · valor +${(f.edge * 100).toFixed(1)}%` : ''}` : undefined}
                        className={`w-full h-12 rounded-lg font-bold tabular-nums transition-all duration-200 relative
                          ${susp
                              ? 'bg-gray-600/40 text-gray-400 cursor-not-allowed'
                              : f?.isValue
                                  ? 'bg-emerald-600 text-white hover:bg-emerald-500 active:scale-95 ring-1 ring-emerald-300'
                                  : 'bg-red-600 text-white hover:bg-red-500 active:scale-95'}`}
                      >
                        <div className="flex flex-col items-center justify-center leading-[1.05]">
                          <span className="text-[10px] font-extrabold uppercase tracking-wider">
                            {sideLabel} {line}
                          </span>
                          <span className="text-sm font-black">{priceStr}</span>
                        </div>
                        {!susp && f?.isValue && (
                          <span className="absolute -top-1.5 -right-1.5 bg-yellow-400 text-black text-[8px] font-black px-1 py-0.5 rounded-full leading-none shadow">
                            ★
                          </span>
                        )}
                      </button>
                    );
                  };
                  return (
                    <div key={line} className={`contents`}>
                      <div className={`px-2 py-2 flex justify-center ${rowBg}`}>{renderBtn(o, 'a')}</div>
                      <div className={`px-2 py-2 flex justify-center ${rowBg}`}>{renderBtn(u, 'b')}</div>
                    </div>
                  );
                })}
              </div>
            </MarketCard>
          )
      }

      // BTTS
      if (key === 'btts') {
          if (bttsItems.length === 0) return null;
          const title = getMarketTitle('btts', event?.sport);
          const susp = getSuspendedReason('btts');
          return (
            <MarketCard title={title} darkMode={darkMode}>
              <MarketButtonGroup items={bttsItems} onSelect={onSelect} suspendedReason={susp} columns={2} darkMode={darkMode} />
            </MarketCard>
          )
      }

      // Correct Score — 3 columns: Casa wins | Empates | Fora wins
      if (key === 'correct_score' || key === 'exact_score' || key === 'score') {
        const rawItems = getMarketItems(key);
        if (!rawItems || rawItems.length === 0) return null;
        const title = getMarketTitle(key, event?.sport);
        const susp = getSuspendedReason(key);
        const isSusp = !!susp;

        // Parse label like "1-0" → { h: 1, a: 0 }
        const parseScore = (label: string) => {
          const m = /(\d+)\s*[-:]\s*(\d+)/.exec(String(label || ''));
          if (!m) return null;
          return { h: parseInt(m[1]), a: parseInt(m[2]) };
        };

        const baseMax = 3;
        const liveMax =
          currentGoals
            ? Math.max(baseMax, Number(currentGoals.home) + 1, Number(currentGoals.away) + 1)
            : baseMax;
        const maxGoal = Math.max(baseMax, Math.min(7, liveMax));

        const scoredItems = rawItems
          .map((it: any) => ({ it, s: parseScore(String(it.label)) }))
          .filter((x: any) => x.s && x.s.h <= maxGoal && x.s.a <= maxGoal) as Array<{ it: any; s: { h: number; a: number } }>;

        scoredItems.sort((a, b) => (a.s.h + a.s.a) - (b.s.h + b.s.a) || a.s.h - b.s.h || a.s.a - b.s.a);

        const homeWins: typeof rawItems = [];
        const draws: typeof rawItems = [];
        const awayWins: typeof rawItems = [];

        for (const { it, s } of scoredItems) {
          if (s.h > s.a) homeWins.push(it);
          else if (s.h === s.a) draws.push(it);
          else awayWins.push(it);
        }

        const maxRows = Math.max(homeWins.length, draws.length, awayWins.length);
        const colData = [
          { label: 'Casa', items: homeWins, color: 'text-blue-400' },
          { label: 'Empate', items: draws, color: 'text-yellow-400' },
          { label: 'Fora', items: awayWins, color: 'text-red-400' },
        ];

        return (
          <MarketCard title={title} darkMode={darkMode} noPad>
            <div className="grid grid-cols-3 gap-3 p-3">
              {colData.map(col => (
                <div key={col.label} className="flex flex-col">
                  <div className={`text-[10px] font-extrabold uppercase tracking-wider text-center py-1.5 ${col.color} ${darkMode ? 'bg-gray-800/60' : 'bg-gray-50'} rounded-lg`}>
                    {col.label}
                  </div>
                  <div className="flex flex-col gap-3 mt-2">
                    {Array.from({ length: maxRows }).map((_, i) => {
                      const item = col.items[i];
                      if (!item) return <div key={i} className="h-12" />;
                      const val = Number(item.odd);
                      const priceStr = val > 0 ? val.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '--';
                      // Block scores that are impossible given the current live score
                      const parsedLabel = parseScore(String(item.label));
                      const isImpossible = !isSusp && currentGoals !== null && parsedLabel !== null &&
                        (parsedLabel.h < currentGoals.home || parsedLabel.a < currentGoals.away);
                      const isBlocked = isSusp || item.suspended === true || isImpossible;
                      return (
                        <button
                          key={i}
                          onClick={isBlocked ? undefined : () => onSelect(item.label, val)}
                          disabled={isBlocked}
                          title={isImpossible ? 'Resultado impossível dado o marcador actual' : undefined}
                          className={`w-full h-12 rounded-xl font-black tabular-nums transition-all duration-200 flex flex-col items-center justify-center leading-[1.05] ${
                            isBlocked ? 'bg-gray-600/40 text-gray-400 cursor-not-allowed' : 'bg-red-600 text-white hover:bg-red-500 active:scale-95'
                          } ${isImpossible ? 'opacity-40' : ''}`}
                        >
                          <span className="text-[12px] font-extrabold">{item.label}</span>
                          <span className="text-base">
                            {isImpossible ? (
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-gray-300" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                              </svg>
                            ) : (
                              priceStr
                            )}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </MarketCard>
        );
      }

      // ── Derived server markets — explicit renderers ──────────────────────

      // First/Last Team to Score — 3-column layout
      if (key === 'first_team_to_score' || key === 'team_to_score_last') {
        const items = getMarketItems(key);
        if (!items || items.length === 0) return null;
        const title = key === 'first_team_to_score' ? 'Primeira Equipa a Marcar' : 'Última Equipa a Marcar';
        const susp = getSuspendedReason(key);
        const isSusp = !!susp;
        const cols = items.length <= 2 ? 'grid-cols-2' : 'grid-cols-3';
        return (
          <MarketCard title={title} darkMode={darkMode} noPad>
            <div className={`grid ${cols} gap-2 p-3`}>
              {items.map((item: MarketItem, i: number) => {
                const val = Number(item.odd);
                const disabled = isSusp || item.suspended === true || !(val > 0);
                return (
                  <OddButton key={i} label={String(item.label || '')} price={val} trend="stable"
                    onClick={() => onSelect(String(item.selection || item.label), val)}
                    className="w-full h-full min-h-[48px] px-2 py-2 rounded-lg bg-red-600 text-white hover:opacity-90 flex items-center justify-between gap-1"
                    suspended={disabled ? { reason: toBadgeReason(susp || (item.suspended ? 'SUSPENSO' : '')) } : undefined} />
                );
              })}
            </div>
          </MarketCard>
        );
      }

      // Winning Margin / Goals Range — flat list
      if (key === 'winning_margin' || key === 'goals_range') {
        const items = getMarketItems(key);
        if (!items || items.length === 0) return null;
        const title = key === 'winning_margin' ? 'Margem de Vitória' : 'Intervalo de Golos';
        const susp = getSuspendedReason(key);
        return (
          <MarketCard title={title} darkMode={darkMode}>
            <MarketButtonGroup items={items} onSelect={onSelect} suspendedReason={susp} darkMode={darkMode} />
          </MarketCard>
        );
      }

      // Exact Goals per team
      if (key === 'exact_home_goals' || key === 'exact_away_goals') {
        const items = getMarketItems(key);
        if (!items || items.length === 0) return null;
        const title = key === 'exact_home_goals' ? 'Golos Exactos — Casa' : 'Golos Exactos — Fora';
        const susp = getSuspendedReason(key);
        return (
          <MarketCard title={title} darkMode={darkMode}>
            <MarketButtonGroup items={items} onSelect={onSelect} suspendedReason={susp} darkMode={darkMode} />
          </MarketCard>
        );
      }

      // Win to Nil / Team Clean Sheet — 2-column pairs
      if (key === 'win_to_nil' || key === 'team_clean_sheet') {
        const items = getMarketItems(key);
        if (!items || items.length < 2) return null;
        const titleMap: Record<string, string> = { win_to_nil: 'Vitória sem Sofrer', team_clean_sheet: 'Baliza a Zero' };
        const susp = getSuspendedReason(key);
        return (
          <MarketCard title={titleMap[key] || key} darkMode={darkMode}>
            <MarketButtonGroup items={items} onSelect={onSelect} suspendedReason={susp} columns={2} darkMode={darkMode} />
          </MarketCard>
        );
      }

      // BTTS derivatives (2-column)
      if (key === 'btts_first_half' || key === 'btts_second_half' || key === 'btts_and_result') {
        const items = getMarketItems(key);
        if (!items || items.length === 0) return null;
        const titleMap: Record<string, string> = {
          btts_first_half: 'Ambas Marcam — 1º Tempo',
          btts_second_half: 'Ambas Marcam — 2º Tempo',
          btts_and_result: 'Ambas Marcam + Resultado',
        };
        const susp = getSuspendedReason(key);
        const cols = key === 'btts_and_result' ? undefined : 2;
        return (
          <MarketCard title={titleMap[key] || key} darkMode={darkMode}>
            <MarketButtonGroup items={items} onSelect={onSelect} suspendedReason={susp} columns={cols} darkMode={darkMode} />
          </MarketCard>
        );
      }

      // Goals Odd/Even variants
      if (/goal_odd_even|odd_even/.test(key)) {
        const items = getMarketItems(key);
        if (!items || items.length === 0) return null;
        const title = key.includes('1st') ? 'Golos Par/Ímpar — 1º Tempo'
          : key.includes('2nd') ? 'Golos Par/Ímpar — 2º Tempo' : 'Golos Par/Ímpar';
        const susp = getSuspendedReason(key);
        return (
          <MarketCard title={title} darkMode={darkMode}>
            <MarketButtonGroup items={items} onSelect={onSelect} suspendedReason={susp} columns={2} darkMode={darkMode} />
          </MarketCard>
        );
      }

      // Highest Scoring Half / Half with Most Goals — 3-column
      if (key === 'highest_scoring_half' || key === 'half_with_most_goals') {
        const items = getMarketItems(key);
        if (!items || items.length === 0) return null;
        const susp = getSuspendedReason(key);
        const isSusp = !!susp;
        const cols = items.length <= 2 ? 'grid-cols-2' : 'grid-cols-3';
        return (
          <MarketCard title="Tempo com Mais Golos" darkMode={darkMode} noPad>
            <div className={`grid ${cols} gap-2 p-3`}>
              {items.map((item: MarketItem, i: number) => {
                const val = Number(item.odd);
                const disabled = isSusp || item.suspended === true || !(val > 0);
                return (
                  <OddButton key={i} label={String(item.label || '')} price={val} trend="stable"
                    onClick={() => onSelect(String(item.selection || item.label), val)}
                    className="w-full h-full min-h-[48px] px-2 py-2 rounded-lg bg-red-600 text-white hover:opacity-90 flex items-center justify-between gap-1"
                    suspended={disabled ? { reason: toBadgeReason(susp || (item.suspended ? 'SUSPENSO' : '')) } : undefined} />
                );
              })}
            </div>
          </MarketCard>
        );
      }

      // Score Both Halves — 2-column paired
      if (key === 'score_both_halves') {
        const items = getMarketItems(key);
        if (!items || items.length < 2) return null;
        const susp = getSuspendedReason(key);
        return (
          <MarketCard title="Marca nos Dois Tempos" darkMode={darkMode}>
            <MarketButtonGroup items={items} onSelect={onSelect} suspendedReason={susp} columns={2} darkMode={darkMode} />
          </MarketCard>
        );
      }

      // Penalty Scored
      if (key === 'penalty_scored') {
        const items = getMarketItems(key);
        if (!items || items.length < 2) return null;
        const susp = getSuspendedReason(key);
        return (
          <MarketCard title="Pênalti Marcado" darkMode={darkMode}>
            <MarketButtonGroup items={items} onSelect={onSelect} suspendedReason={susp} columns={2} darkMode={darkMode} />
          </MarketCard>
        );
      }

      // European Handicap lines — 3-column per line
      if (/^handicap_european_/.test(key)) {
        const items = getMarketItems(key);
        if (!items || items.length < 2) return null;
        const m = /^handicap_european_(neg)?(\d+)$/.exec(key);
        const sign = m?.[1] === 'neg' ? '-' : '+';
        const num = m?.[2] || '';
        const susp = getSuspendedReason(key);
        const isSusp = !!susp;
        const cols = items.length <= 2 ? 'grid-cols-2' : 'grid-cols-3';
        return (
          <MarketCard title={`Handicap Europeu ${sign}${num}`} darkMode={darkMode} noPad>
            <div className={`grid ${cols} gap-2 p-3`}>
              {items.map((item: MarketItem, i: number) => {
                const val = Number(item.odd);
                const disabled = isSusp || item.suspended === true || !(val > 0);
                return (
                  <OddButton key={i} label={String(item.label || '')} price={val} trend="stable"
                    onClick={() => onSelect(String(item.selection || item.label), val)}
                    className="w-full h-full min-h-[48px] px-2 py-2 rounded-lg bg-red-600 text-white hover:opacity-90 flex items-center justify-between gap-1"
                    suspended={disabled ? { reason: toBadgeReason(susp || (item.suspended ? 'SUSPENSO' : '')) } : undefined} />
                );
              })}
            </div>
          </MarketCard>
        );
      }

      // Double Chance 1st Half — 3-column
      if (key === 'double_chance_1st_half') {
        const items = getMarketItems(key);
        if (!items || items.length < 2) return null;
        const susp = getSuspendedReason(key);
        const isSusp = !!susp;
        const cols = items.length <= 2 ? 'grid-cols-2' : 'grid-cols-3';
        return (
          <MarketCard title="Dupla Chance — 1º Tempo" darkMode={darkMode} noPad>
            <div className={`grid ${cols} gap-2 p-3`}>
              {items.map((item: MarketItem, i: number) => {
                const val = Number(item.odd);
                const disabled = isSusp || item.suspended === true || !(val > 0);
                return (
                  <OddButton key={i} label={String(item.label || '')} price={val} trend="stable"
                    onClick={() => onSelect(String(item.selection || item.label), val)}
                    className="w-full h-full min-h-[48px] px-2 py-2 rounded-lg bg-red-600 text-white hover:opacity-90 flex items-center justify-between gap-1"
                    suspended={disabled ? { reason: toBadgeReason(susp || (item.suspended ? 'SUSPENSO' : '')) } : undefined} />
                );
              })}
            </div>
          </MarketCard>
        );
      }

      // Draw No Bet 1st Half — 2-column
      if (key === 'draw_no_bet_1st_half') {
        const items = getMarketItems(key);
        if (!items || items.length < 2) return null;
        const susp = getSuspendedReason(key);
        const isSusp = !!susp;
        return (
          <MarketCard title="Empate Anula Aposta — 1º Tempo" darkMode={darkMode} noPad>
            <div className="grid grid-cols-2 gap-2 p-3">
              {items.map((item: MarketItem, i: number) => {
                const val = Number(item.odd);
                const disabled = isSusp || item.suspended === true || !(val > 0);
                return (
                  <OddButton key={i} label={String(item.label || '')} price={val} trend="stable"
                    onClick={() => onSelect(String(item.selection || item.label), val)}
                    className="w-full h-full min-h-[48px] px-2 py-2 rounded-lg bg-red-600 text-white hover:opacity-90 flex items-center justify-between gap-1"
                    suspended={disabled ? { reason: toBadgeReason(susp || (item.suspended ? 'SUSPENSO' : '')) } : undefined} />
                );
              })}
            </div>
          </MarketCard>
        );
      }

      // 1st/2nd Half Correct Score — 3-column grouped
      if (key === '1st_half_correct_score' || key === '2nd_half_correct_score') {
        const rawItems = getMarketItems(key);
        if (!rawItems || rawItems.length === 0) return null;
        const title = key === '1st_half_correct_score' ? 'Placar Correto — 1º Tempo' : 'Placar Correto — 2º Tempo';
        const susp = getSuspendedReason(key);
        const isSusp = !!susp;
        const parseScore = (label: string) => {
          const m = /(\d+)\s*[-:]\s*(\d+)/.exec(String(label || ''));
          return m ? { h: parseInt(m[1]), a: parseInt(m[2]) } : null;
        };
        const scored = rawItems
          .map((it: MarketItem) => ({ it, s: parseScore(String(it.label)) }))
          .filter((x: any) => x.s) as Array<{ it: MarketItem; s: { h: number; a: number } }>;
        scored.sort((a, b) => (a.s.h + a.s.a) - (b.s.h + b.s.a) || a.s.h - b.s.h);
        const homeWins: MarketItem[] = [], draws: MarketItem[] = [], awayWins: MarketItem[] = [];
        for (const { it, s } of scored) {
          if (s.h > s.a) homeWins.push(it);
          else if (s.h === s.a) draws.push(it);
          else awayWins.push(it);
        }
        const maxRows = Math.max(homeWins.length, draws.length, awayWins.length, 1);
        const colData = [
          { label: 'Casa', items: homeWins, color: 'text-blue-400' },
          { label: 'Empate', items: draws, color: 'text-yellow-400' },
          { label: 'Fora', items: awayWins, color: 'text-red-400' },
        ];
        return (
          <MarketCard title={title} darkMode={darkMode} noPad>
            <div className="grid grid-cols-3 gap-3 p-3">
              {colData.map(col => (
                <div key={col.label} className="flex flex-col gap-2">
                  <div className={`text-[10px] font-extrabold uppercase tracking-wider text-center py-1.5 ${col.color} ${darkMode ? 'bg-gray-800/60' : 'bg-gray-50'} rounded-lg`}>
                    {col.label}
                  </div>
                  {Array.from({ length: maxRows }).map((_, i) => {
                    const item = col.items[i];
                    if (!item) return <div key={i} className="h-12" />;
                    const val = Number(item.odd);
                    const pStr = val > 0 ? val.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '--';
                    return (
                      <button key={i} onClick={isSusp || item.suspended === true ? undefined : () => onSelect(item.label, val)} disabled={isSusp || item.suspended === true}
                        className={`w-full h-12 rounded-xl font-black tabular-nums flex flex-col items-center justify-center ${isSusp || item.suspended === true ? 'bg-gray-600/40 text-gray-400 cursor-not-allowed' : 'bg-red-600 text-white hover:bg-red-500 active:scale-95'}`}>
                        <span className="text-[12px] font-extrabold">{item.label}</span>
                        <span className="text-sm">{pStr}</span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </MarketCard>
        );
      }

      // ── End of derived market renderers ──────────────────────────────────

      // Generic
      const items = getMarketItems(key);
      if (!items || items.length === 0) return null;

      const title = getMarketTitle(key, event?.sport);
      const susp = getSuspendedReason(key);
      const isSusp = !!susp;

      const looksThreeWay = (() => {
        if (items.length !== 3) return false;
        const ls = items.map((x: MarketItem) => String(x.label || '').toLowerCase());
        const hasHome = ls.some((x: string) => x === 'casa' || x.includes('casa') || x === 'home' || x === '1');
        const hasDraw = ls.some((x: string) => x === 'empate' || x.includes('empate') || x === 'draw' || x === 'x' || x === 'tie');
        const hasAway = ls.some((x: string) => x === 'fora' || x.includes('fora') || x === 'away' || x === '2');
        const keyOk = key === 'h2h' || /(^|_)h2h($|_)/.test(key) || key.includes('result');
        return keyOk && hasHome && hasDraw && hasAway;
      })();

      if (looksThreeWay) {
        const order = (lbl: string) => {
          const l = String(lbl || '').toLowerCase();
          if (l === 'casa' || l.includes('casa') || l === 'home' || l === '1') return 1;
          if (l === 'empate' || l.includes('empate') || l === 'draw' || l === 'x' || l === 'tie') return 2;
          if (l === 'fora' || l.includes('fora') || l === 'away' || l === '2') return 3;
          return 9;
        };
        const ordered = [...items].sort((a, b) => order(a.label) - order(b.label));
        return (
          <MarketCard title={title} darkMode={darkMode} noPad>
            <div className="grid grid-cols-3 gap-2 p-3">
              {ordered.map((item, i) => {
                const val = Number(item.odd);
                const disabled = isSusp || item.suspended === true || !(val > 0);
                return (
                  <OddButton
                    key={i}
                    label={String(item.label || '')}
                    price={val}
                    trend="stable"
                    onClick={() => onSelect(String(item.selection || item.label), val)}
                    className="w-full h-full min-h-[48px] px-2 py-2 rounded-lg bg-red-600 text-white hover:opacity-90 flex items-center justify-between gap-1"
                    suspended={disabled ? { reason: toBadgeReason(susp || (item.suspended ? 'SUSPENSO' : '')) } : undefined}
                  />
                );
              })}
            </div>
          </MarketCard>
        );
      }
      
      return (
        <MarketCard key={key} title={title} darkMode={darkMode}>
          <MarketButtonGroup items={items} onSelect={onSelect} suspendedReason={susp} darkMode={darkMode} />
        </MarketCard>
      )
  }

  // --- Group logic ---
  const finalGroups = useMemo(() => {
      const s = (event?.sport || '').toLowerCase();
      const isSoccer =
        s.includes('soccer') ||
        s.includes('futebol') ||
        (s.includes('football') && !s.includes('american'));
      if (isSoccer) {
          const blocked = new Set(['main', '1x2', 'match_winner']);
          const allKeys = Object.keys(eventOdds || {}).filter(k => !blocked.has(k));
          const hasContent = (k: string) => {
              const items = getMarketItems(k);
              return !!items && items.length > 0;
          };
          const rawKeys = allKeys.filter(hasContent);
          const syntheticKeys = [...rawKeys];
          if (
            !syntheticKeys.includes('totals') &&
            rawKeys.some((k) =>
              /^totals_[\d_]+$/.test(k) ||
              k === 'match_goals' ||
              k === 'goals_total' ||
              k === 'over_under' ||
              k === 'overunder'
            )
          ) {
            syntheticKeys.unshift('totals');
          }
          const keyPriority = (k: string) => {
            const lk = k.toLowerCase();
            const pref = [
              'h2h',
              'double_chance',
              'totals',
              'btts',
              'handicap',
              'spreads',
              'half_time_full_time',
              'htft',
              'correct_score',
              'corners_total',
              'cards_total',
            ];
            const idx = pref.findIndex((x) => x === lk);
            return idx >= 0 ? idx : 999;
          };
          const dedupe = new Map<string, { key: string; pr: number; len: number }>();
          for (const k of syntheticKeys) {
            const titleKey = getMarketTitle(k, event?.sport).toLowerCase().trim();
            const pr = keyPriority(k);
            const len = String(k).length;
            const prev = dedupe.get(titleKey);
            if (!prev || pr < prev.pr || (pr === prev.pr && len < prev.len)) {
              dedupe.set(titleKey, { key: k, pr, len });
            }
          }
          const keys = Array.from(dedupe.values()).sort((a, b) => a.pr - b.pr || a.len - b.len).map((x) => x.key);

          const buckets: Record<string, string[]> = {
              Todos: [],
              'Tempo Regular': [],
              Populares: [],
              'Acima/Abaixo': [],
              Especiais: [],
              Handicap: [],
              '1º Tempo': [],
              '2º Tempo': [],
              'HT/FT': [],
              'Placar correto': [],
              Escanteio: [],
              Cartão: [],
              Asiático: [],
              Jogadores: [],
          };

          const assigned = new Set<string>();
          const add = (tab: keyof typeof buckets, k: string) => {
              if (assigned.has(k)) return;
              buckets[tab].push(k);
              assigned.add(k);
          };

          for (const k of keys) {
              const lk = k.toLowerCase();

              if (/corner|corners|escanteio/.test(lk)) add('Escanteio', k);
              else if (/card|cards|yellow|red|cart[aã]o/.test(lk)) add('Cartão', k);
              else if (/correct_score|score_exact|placar/.test(lk)) add('Placar correto', k);
              else if (/half_time_full_time|htft|half.*full/.test(lk)) add('HT/FT', k);
              else if (/^first_half_|firsthalf|1st_half|^1st_/.test(lk)) add('1º Tempo', k);
              else if (/^second_half_|secondhalf|2nd_half|^2nd_/.test(lk)) add('2º Tempo', k);
              else if (lk === 'spreads' || /asian|asi[aá]tico|ah_?/.test(lk)) add('Asiático', k);
              else if (/handicap/.test(lk)) add('Handicap', k);
              else if (/player_|scorer|goal_scorer|jogador/.test(lk)) add('Jogadores', k);
              else if (/^(h2h|1x2|main|match_winner)$/.test(lk)) add('Tempo Regular', k);
              else if (/double_chance|dnb|draw_no_bet|btts|next_goal|first_goal|last_goal|first_team_to_score|team_to_score_last|clean_sheet|win_to_nil|highest_scoring_half|score_both_halves|penalty_scored|winning_margin|winning|margin/.test(lk)) add('Populares', k);
              else if (/totals|team_totals|minute_goals|exact_goals|goals_range|odd_even|over|under/.test(lk)) add('Acima/Abaixo', k);
              else add('Especiais', k);
          }

          const allOrdered = [
            ...buckets['Tempo Regular'],
            ...buckets['Populares'],
            ...buckets['Acima/Abaixo'],
            ...buckets['Especiais'],
            ...buckets['Handicap'],
            ...buckets['1º Tempo'],
            ...buckets['2º Tempo'],
            ...buckets['HT/FT'],
            ...buckets['Placar correto'],
            ...buckets['Escanteio'],
            ...buckets['Cartão'],
            ...buckets['Asiático'],
            ...buckets['Jogadores'],
          ];
          const seen = new Set<string>();
          buckets['Todos'] = allOrdered.filter((k) => {
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
          });

          const FIXED_TABS: Array<{ title: string; keys: string[] }> = [
              { title: 'Todos', keys: buckets['Todos'] },
              { title: 'Tempo Regular', keys: buckets['Tempo Regular'] },
              { title: 'Populares', keys: buckets['Populares'] },
              { title: 'Acima/Abaixo', keys: buckets['Acima/Abaixo'] },
              { title: 'Especiais', keys: buckets['Especiais'] },
              { title: 'Handicap', keys: buckets['Handicap'] },
              { title: '1º Tempo', keys: buckets['1º Tempo'] },
              { title: '2º Tempo', keys: buckets['2º Tempo'] },
              { title: 'HT/FT', keys: buckets['HT/FT'] },
              { title: 'Placar correto', keys: buckets['Placar correto'] },
              { title: 'Escanteio', keys: buckets['Escanteio'] },
              { title: 'Cartão', keys: buckets['Cartão'] },
              { title: 'Asiático', keys: buckets['Asiático'] },
              { title: 'Jogadores', keys: buckets['Jogadores'] },
          ];

          return FIXED_TABS;
      }

      const isBasketball = s.includes('basketball') || s.includes('basquete') || s.includes('nba');
      const isTennis = s.includes('tennis') || s.includes('tênis') || s.includes('atp') || s.includes('wta');
      const isBaseball = s.includes('baseball') || s.includes('beisebol') || s.includes('mlb');
      const isIceHockey = s.includes('ice hockey') || s.includes('hóquei') || s.includes('nhl');

      if (isBasketball) return BASKETBALL_GROUPS;
      if (isTennis) return TENNIS_GROUPS;
      if (isBaseball) return BASEBALL_GROUPS;
      if (isIceHockey) return ICE_HOCKEY_GROUPS;

      const keysWithCategory = Object.keys(eventOdds || {}).filter(k => {
          if (k === 'main' || k === '1x2' || k === 'match_winner' || k === 'spreads') return false;
          return !!(eventOdds as any)[k]?.category;
      });
      const uniqueCategories = new Set(keysWithCategory.map(k => (eventOdds as any)[k].category));
      
      if (uniqueCategories.size >= 2) {
          const categoryMap = new Map<string, Set<string>>();
          const ORDERED_CATEGORIES = [
              "Mercado Raiz",
              "Mercados de Resultado",
              "Mercados de Gols",
              "Mercados Temporais",
              "Mercados Estatísticos",
              "Mercados de Jogadores",
              "Mercados Especiais"
          ];

          for (const key of keysWithCategory) {
              const cat = (eventOdds as any)[key].category;
              if (cat === 'Outros Mercados') continue;
              if (!categoryMap.has(cat)) categoryMap.set(cat, new Set());
              categoryMap.get(cat)!.add(key);
          }

          const groups = [];
          for (const catName of ORDERED_CATEGORIES) {
              if (categoryMap.has(catName)) {
                  groups.push({ title: catName, keys: Array.from(categoryMap.get(catName)!) });
                  categoryMap.delete(catName);
              }
          }
          for (const [catName, keys] of categoryMap.entries()) {
              groups.push({ title: catName, keys: Array.from(keys) });
          }
          return groups;
      }

      const isVolleyball = s.includes('volleyball') || s.includes('vôlei') || s.includes('volei');
      const isAFL = s.includes('afl') || s.includes('australian football') || s.includes('futebol australiano');
      const isF1 = s.includes('formula 1') || s.includes('f1') || s.includes('formula one') || s.includes('automobilismo') || s.includes('motor sports');
      const isAmericanFootball = s.includes('american football') || s.includes('futebol americano') || s.includes('nfl');
      const isHandball = s.includes('handball') || s.includes('handebol');
      const isMMA = s.includes('mma') || s.includes('ufc') || s.includes('mixed martial arts') || s.includes('luta');
      const isRugby = s.includes('rugby') || s.includes('union') || s.includes('league');
      
      let BASE_GROUPS = MARKET_GROUPS;
      if (isVolleyball) BASE_GROUPS = VOLLEYBALL_GROUPS;
      else if (isAFL) BASE_GROUPS = AFL_GROUPS;
      else if (isF1) BASE_GROUPS = FORMULA1_GROUPS;
      else if (isAmericanFootball) BASE_GROUPS = AMERICAN_FOOTBALL_GROUPS;
      else if (isHandball) BASE_GROUPS = HANDBALL_GROUPS;
      else if (isMMA) BASE_GROUPS = MMA_GROUPS;
      else if (isRugby) BASE_GROUPS = RUGBY_GROUPS;

      return BASE_GROUPS;
  }, [event?.sport, eventOdds]);

  const [activeTab, setActiveTab] = useState(() => {
     const s = (event?.sport || '').toLowerCase();
     const isSoccer =
       s.includes('soccer') ||
       s.includes('futebol') ||
       (s.includes('football') && !s.includes('american'));
     const isBasketball = s.includes('basketball') || s.includes('basquete') || s.includes('nba');
     const isTennis = s.includes('tennis') || s.includes('tênis') || s.includes('atp') || s.includes('wta');
     const isVolleyball = s.includes('volleyball') || s.includes('vôlei') || s.includes('volei');
     const isAFL = s.includes('afl') || s.includes('australian football') || s.includes('futebol australiano');
     const isBaseball = s.includes('baseball') || s.includes('beisebol') || s.includes('mlb');
     const isF1 = s.includes('formula 1') || s.includes('f1') || s.includes('formula one') || s.includes('automobilismo') || s.includes('motor sports');
     const isAmericanFootball = s.includes('american football') || s.includes('futebol americano') || s.includes('nfl');
     const isHandball = s.includes('handball') || s.includes('handebol');
     const isIceHockey = s.includes('ice hockey') || s.includes('hóquei') || s.includes('nhl');
     const isMMA = s.includes('mma') || s.includes('ufc') || s.includes('mixed martial arts') || s.includes('luta');
     
     if (isSoccer) return 'Todos';
     if (isBasketball) return BASKETBALL_GROUPS[0].title;
     if (isTennis) return TENNIS_GROUPS[0].title;
     if (isVolleyball) return VOLLEYBALL_GROUPS[0].title;
     if (isAFL) return AFL_GROUPS[0].title;
     if (isBaseball) return BASEBALL_GROUPS[0].title;
     if (isF1) return FORMULA1_GROUPS[0].title;
     if (isAmericanFootball) return AMERICAN_FOOTBALL_GROUPS[0].title;
     if (isHandball) return HANDBALL_GROUPS[0].title;
     if (isIceHockey) return ICE_HOCKEY_GROUPS[0].title;
     if (isMMA) return MMA_GROUPS[0].title;
     return MARKET_GROUPS[0].title;
  });
  
  useEffect(() => {
      if (!finalGroups.find(g => g.title === activeTab)) {
          setActiveTab(finalGroups[0].title);
      }
  }, [finalGroups, activeTab]);

  return (
    <div className={`${darkMode ? 'bg-gray-800 border border-gray-700' : 'bg-gray-50 border border-gray-200'} rounded-2xl p-2 md:p-3`}>

      {/* Market Liquidation Badge */}
      {liquidationTier && (
        <div
          className="flex items-center gap-2 px-3 py-1.5 mb-3 rounded-lg text-[11px] font-bold uppercase tracking-wide"
          style={{
            background: 'rgba(234,88,12,0.12)',
            border: '1px solid rgba(234,88,12,0.35)',
            color: '#f97316',
          }}
        >
          <span style={{ animation: 'wcPulse 1.8s ease-in-out infinite', display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#f97316', flexShrink: 0 }} />
          ⏱ {liquidationTier} · mercados em liquidação
          <style>{`@keyframes wcPulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.35;transform:scale(1.85)}}`}</style>
        </div>
      )}

      {comboCards.length > 0 && (
        <div className={`mb-4 rounded-2xl border p-3 ${
          darkMode ? 'border-gray-700 bg-gray-900/70' : 'border-gray-200 bg-white'
        }`}>
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className="text-lg text-amber-400">⚡</span>
              <div className="min-w-0">
                <h3 className={`text-sm font-black uppercase tracking-[0.12em] ${
                  darkMode ? 'text-white' : 'text-gray-900'
                }`}>
                  Biblioteca de Combinações
                </h3>
                <p className={`text-[11px] ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  Same Game Combo prontos para este jogo
                </p>
              </div>
            </div>
            <span className={`whitespace-nowrap text-xs ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
              {comboCards.length} combos
            </span>
          </div>

          <div className="no-scrollbar flex gap-3 overflow-x-auto pb-2">
            {comboCards.map((combo) => (
              <article
                key={combo.id}
                className={`min-w-[280px] rounded-2xl border p-3 shadow-sm ${
                  darkMode
                    ? 'border-gray-700 bg-gradient-to-b from-gray-900 to-gray-950'
                    : 'border-gray-200 bg-gradient-to-b from-white to-gray-50'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <span className={`inline-flex rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] ${
                    combo.badge === 'Protegido'
                      ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-400'
                      : 'border-blue-500/40 bg-blue-500/10 text-blue-400'
                  }`}>
                    {combo.badge}
                  </span>
                  <div className={`text-right text-[10px] ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                    Automático
                  </div>
                </div>

                <h4 className={`mt-3 text-lg font-black leading-tight ${
                  darkMode ? 'text-white' : 'text-gray-900'
                }`}>
                  {combo.title}
                </h4>

                <ul className={`mt-3 space-y-1.5 text-sm ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                  {combo.legs.map((leg) => (
                    <li key={`${combo.id}-${leg.marketId}-${leg.selection}`} className="flex items-start gap-2">
                      <span className="mt-1 h-1.5 w-1.5 rounded-full bg-gray-400"></span>
                      <span>
                        {leg.selection}
                        <span className={`ml-2 text-[11px] ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                          {leg.marketName}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>

                <div className={`mt-4 flex items-end justify-between gap-3 border-t pt-4 ${
                  darkMode ? 'border-gray-800' : 'border-gray-200'
                }`}>
                  <div>
                    <div className={`text-[11px] uppercase tracking-[0.14em] ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                      Odd
                    </div>
                    <div className={`text-3xl font-black ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                      {combo.odd.toFixed(2)}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onSelect(
                      combo.title,
                      combo.odd,
                      `${combo.marketLabel}: ${combo.legs.map((leg) => leg.selection).join(' | ')}`,
                      combo.comboMeta,
                    )}
                    className="rounded-2xl bg-gradient-to-r from-red-600 to-orange-500 px-4 py-2.5 text-sm font-black text-white transition hover:from-red-700 hover:to-orange-600"
                  >
                    + Adicionar
                  </button>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="flex overflow-x-auto pb-2 mb-4 gap-2 no-scrollbar">
         {(() => {
             const groups = finalGroups.filter(group => group.keys.some(k => renderMarketContent(k) !== null));
             return groups.map((group) => (
                 <button
                     key={group.title}
                     onClick={() => setActiveTab(group.title)}
                     className={`whitespace-nowrap px-4 py-2 rounded-full text-sm font-semibold transition-colors ${
                         activeTab === group.title
                             ? 'bg-red-600 text-white'
                             : (darkMode ? 'bg-gray-700 text-gray-300 hover:bg-gray-600' : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-200')
                     }`}
                 >
                     {group.title}
                 </button>
             ));
         })()}
      </div>

      <div className="space-y-3">
        {finalGroups.map((group, idx) => {
            if (group.title !== activeTab) return null;

            const content = group.keys.map(k => ({ key: k, node: renderMarketContent(k) })).filter(x => x.node !== null);
            
            if (content.length === 0) {
                 return (
                     <div key={idx} className={`text-center py-8 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                         Nenhum mercado disponível nesta categoria.
                     </div>
                 );
            }

            return (
                <div key={idx} className="market-group animate-fadeIn">
                    <div className="space-y-3">
                        {content.map(c => <div key={c.key}>{c.node}</div>)}
                    </div>
                </div>
            )
        })}
      </div>
    </div>
  )

}

export const MemoSubOddsModel = memo(SubOddsModel)
