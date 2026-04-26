import { useMemo, memo, useState, useEffect, useRef } from 'react'
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
  name?: string
  header?: string
  handicap?: string
}

export interface Markets {
  [key: string]: MarketItem[]
}

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
  const isSusp = !!suspended;
  const priceStr = val > 0 ? val.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '--';

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
          onClick={isSusp ? undefined : () => onSelect(item.label, val)}
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
                'bg-gray-600/90 text-gray-200'}`}
            >
              {suspended === 'GOAL' ? 'GOL' : suspended === 'VAR' ? 'VAR' : suspended === 'CARD' ? 'CARTÃO' : suspended}
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
            <OddRow key={`${it.label}-${idx}`} item={it} onSelect={onSelect} suspended={suspendedReason} />
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
          <OddRow item={it} onSelect={onSelect} suspended={suspendedReason} />
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
}: {
  event: any
  darkMode: boolean
  markets: Markets | null
  eventOdds: Record<string, any[]> | null
  onSelect: (label: string, odd: number) => void
  labelOutcome: (market: string, name: string) => string
  applyMarginClamp: (mk: string, v: number) => number
  suspendedMarkets?: { eventId: number; marketId: string; reason: string }[]
}) {
  const home = useMemo(() => String(event?.home_team || (event?.match || '').split(' vs ')[0] || ''), [event])
  const away = useMemo(() => String(event?.away_team || (event?.match || '').split(' vs ')[1] || ''), [event])
  const isGlobalSuspended = (event as any)?.oddsFrozen || (event as any)?.suspended || false;

  const suspendedMap = useMemo(() => {
    const m = new Map<string, string>();
    if (suspendedMarkets) {
      for (const s of suspendedMarkets) {
        m.set(s.marketId, s.reason);
      }
    }
    return m;
  }, [suspendedMarkets]);

  const getSuspendedReason = (marketKey?: string) => {
    if (isGlobalSuspended) return 'EVENT_FROZEN';
    return marketKey ? suspendedMap.get(marketKey) : undefined;
  };

  // Current live score — used to block impossible correct-score outcomes
  const currentGoals = useMemo(() => {
    const goals = (event as any)?.goals;
    if (!goals) return null;
    const g = typeof goals === 'string' ? (() => { try { return JSON.parse(goals); } catch { return null; } })() : goals;
    if (!g) return null;
    const h = Number(g.home ?? 0); const a = Number(g.away ?? 0);
    return (h > 0 || a > 0) ? { home: h, away: a } : null;
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
    
    const mapped = list.map((o: any) => {
      const v0 = Number(o?.value || o?.odd || 0)
      const v = applyMarginClamp('h2h', v0)
      const lbl = labelOutcome('h2h', String(o?.outcome || o?.name || ''))
      return { label: lbl, odd: v } as MarketItem
    }).filter((x: MarketItem) => (isSuspended && x.label) || (x.label && x.odd > 0))
    
    const order = new Map<string, number>([['Casa',0],['Empate',1],['Fora',2]])
    const by = new Map<string, MarketItem>();
    for (const it of mapped) {
       const key = String(it.label || '');
       const prev = by.get(key);
       if (!prev || it.odd > prev.odd) by.set(key, it);
    }
    const deduped = Array.from(by.values());
    return deduped.sort((a, b) => (order.get(a.label) ?? 9) - (order.get(b.label) ?? 9))
  }, [eventOdds, applyMarginClamp, labelOutcome])

  const resultadoRegulamentar = useMemo(() => {
     if (h2hInternalItems.length > 0) return h2hInternalItems;
     const h0 = Number(event?.home_odd || 0)
     const d0 = Number(event?.draw_odd || 0)
     const a0 = Number(event?.away_odd || 0)
     const items = []
     if(h0 > 0) items.push({ label: 'Casa', odd: h0 })
     if(d0 > 0) items.push({ label: 'Empate', odd: d0 })
     if(a0 > 0) items.push({ label: 'Fora', odd: a0 })
     return items as MarketItem[]
  }, [event, h2hInternalItems])

  const doubleChanceItems = useMemo(() => {
    const raw = (eventOdds && (eventOdds as any)['double_chance']);
    const list = Array.isArray(raw) ? raw : (raw?.outcomes || raw?.values || []);
    const isSuspended = raw?.suspended === true || raw?.status === 'suspended';

    const mapped = list.map((o: any) => {
      const v0 = Number(o?.value || o?.odd || 0)
      const v = applyMarginClamp('double_chance', v0)
      const lbl = labelOutcome('double_chance', String(o?.outcome || o?.name || ''))
      return { label: lbl, odd: v } as MarketItem
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
  const getMarketItems = (key: string, labelKey?: string) => {
      if (markets) {
        if (markets[key] && markets[key]!.length > 0) return markets[key]!;
        if (key === 'spreads' && (markets as any)['handicap'] && (markets as any)['handicap']!.length > 0) {
          return (markets as any)['handicap']!;
        }
      }

      let raw = (eventOdds && (eventOdds as any)[key]);
      if ((!raw || (Array.isArray(raw) && raw.length === 0)) && key === 'spreads') {
        raw = (eventOdds && (eventOdds as any)['handicap']);
      }
      if ((!raw || (Array.isArray(raw) && raw.length === 0)) && key === 'handicap') {
        raw = (eventOdds && (eventOdds as any)['spreads']);
      }
      const list = Array.isArray(raw) ? raw : (raw?.outcomes || raw?.values || []);
      const isSuspended = raw?.suspended === true || raw?.status === 'suspended';

      const mapped = list.map((o: any) => {
        const v0 = Number(o?.value || o?.odd || 0)
        const v = applyMarginClamp(key, v0)
        const lbl = labelOutcome(labelKey || key, String(o?.outcome || o?.name || ''))
        const hcRaw = o?.point ?? o?.handicap ?? o?.line ?? o?.total ?? o?.spread ?? null
        const hc = hcRaw === null || hcRaw === undefined ? undefined : String(hcRaw)
        return { label: lbl, odd: v, name: o?.outcome || o?.name, handicap: hc } as MarketItem
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
      const raw = (eventOdds && (eventOdds as any)[key]);
      if (raw && raw.sub_category) return raw.sub_category;

      if (key === 'h2h') {
          const s = (sport || '').toLowerCase();
          if (s.includes('rugby') || s.includes('union') || s.includes('league')) return 'Vencedor da Partida (Match Winner)';
          if (s.includes('tennis') || s.includes('tênis')) return 'Vencedor da Partida';
          if (s.includes('basketball') || s.includes('basquete')) return 'Vencedor';
          if (s.includes('mma') || s.includes('ufc') || s.includes('mixed martial arts') || s.includes('luta')) return 'Vencedor da Luta';
          return MARKET_CONFIG['h2h']?.title || 'Resultado Final';
      }
      return MARKET_CONFIG[key]?.title || key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  }

  const spreadsItems = useMemo(() => getMarketItems('spreads'), [eventOdds, markets])
  const totalsItems = useMemo(() => getMarketItems('totals'), [eventOdds, markets])
  const bttsItems = useMemo(() => getMarketItems('btts'), [eventOdds, markets])

  // --- Render each market as a card ---
  const renderMarketContent = (key: string) => {
      if (key !== 'h2h' && ['h2h_3_way', '1x2', 'main', 'match_winner'].includes(key)) {
          if (resultadoRegulamentar.length > 0) return null;
      }

      // H2H — 3-column side-by-side layout (Casa | Empate | Fora)
      if (key === 'h2h') {
          if (resultadoRegulamentar.length === 0) return null;
          const title = getMarketTitle('h2h', event?.sport);
          const susp = getSuspendedReason('h2h');
          const isSusp = !!susp;
          return (
            <MarketCard title={title} darkMode={darkMode} noPad>
              <div className="grid grid-cols-3 gap-0 divide-x divide-gray-100 dark:divide-gray-700 p-0">
                {resultadoRegulamentar.map((item, i) => {
                  const val = Number(item.odd);
                  const priceStr = val > 0 ? val.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '--';
                  return (
                    <div key={i} className="flex flex-col items-center gap-1.5 py-3 px-2">
                      <span className={`text-[11px] font-extrabold uppercase tracking-wider ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                        {item.label}
                      </span>
                      <button
                        onClick={isSusp ? undefined : () => onSelect(item.label, val)}
                        disabled={isSusp}
                        className={`w-full h-14 rounded-lg font-black text-lg tabular-nums transition-all duration-200 shadow-sm
                          ${isSusp
                            ? 'bg-gray-600/40 text-gray-400 cursor-not-allowed'
                            : 'bg-red-600 text-white hover:bg-red-500 active:scale-95'
                          }`}
                      >
                        {isSusp
                          ? <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mx-auto text-gray-400" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                            </svg>
                          : priceStr
                        }
                      </button>
                    </div>
                  );
                })}
              </div>
            </MarketCard>
          );
      }
      
      // Double Chance
      if (key === 'double_chance') {
          if (doubleChanceItems.length === 0) return null;
          const title = getMarketTitle('double_chance', event?.sport);
          const susp = getSuspendedReason('double_chance');
          return (
            <MarketCard title={title} darkMode={darkMode}>
              <MarketButtonGroup items={doubleChanceItems} onSelect={onSelect} suspendedReason={susp} darkMode={darkMode} />
            </MarketCard>
          );
      }

      // Spreads/Handicap
      if (key === 'spreads' || key === 'handicap') {
          const baseItems = key === 'handicap' ? getMarketItems('handicap') : spreadsItems
          if (baseItems.length === 0) return null;
          const title = getMarketTitle(key, event?.sport);
          const susp = getSuspendedReason(key);
          
          const parseHandicap = (s: string) => {
            const l = String(s || '')
            const numM = /([+-]?\s*[0-9]+(?:\.[0-9]+)?|[+-]?\s*[0-9]+(?:,[0-9]+)?)/.exec(l)
            const val = numM ? Number(String(numM[1]).replace(',', '.').replace(/\s+/g,'')) : NaN
            const isHome = /casa|home/i.test(l)
            const isAway = /fora|away/i.test(l)
            const team = isHome ? 'home' : (isAway ? 'away' : '')
            return { team, val }
          }
          const parsed = baseItems.map((x: MarketItem) => {
            const p = parseHandicap(String(x.label || ''))
            if (!p.team || !Number.isFinite(p.val)) return null
            if (Math.abs(p.val) > 3.5) return null
            if (!(Number(x.odd) > 1.01 && Number(x.odd) < 25)) return null
            const signLabel = `${p.val >= 0 ? '+' : ''}${p.val}`
            const lbl = signLabel.replace(',', '.')
            return { team: p.team, item: { label: lbl, odd: x.odd } as MarketItem }
          }).filter(Boolean) as { team: 'home'|'away'; item: MarketItem }[]
          
          const homeItems = parsed.filter((p) => p.team === 'home').map((p) => p.item).sort((a,b)=> Number(a.label)-Number(b.label))
          const awayItems = parsed.filter((p) => p.team === 'away').map((p) => p.item).sort((a,b)=> Number(a.label)-Number(b.label))
          
          if (homeItems.length === 0 && awayItems.length === 0) return null;

          return (
            <MarketCard title={title} darkMode={darkMode} noPad>
              <div className="grid grid-cols-2 divide-x divide-gray-100 dark:divide-gray-700">
                <div className="px-3 py-2">
                  <div className={`text-[11px] font-extrabold uppercase tracking-wider mb-1 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{home || 'Casa'}</div>
                  <MarketButtonGroup items={homeItems} onSelect={onSelect} suspendedReason={susp} darkMode={darkMode} />
                </div>
                <div className="px-3 py-2">
                  <div className={`text-[11px] font-extrabold uppercase tracking-wider mb-1 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{away || 'Fora'}</div>
                  <MarketButtonGroup items={awayItems} onSelect={onSelect} suspendedReason={susp} darkMode={darkMode} />
                </div>
              </div>
            </MarketCard>
          )
      }

      // Totals (gols, cantos, cartões)
      if (key === 'totals' || key === 'corners_total' || key === 'cards_total' || key === 'goals_total' || key === 'team_totals') {
          if (totalsItems.length === 0 && (key !== 'totals' ? getMarketItems(key).length === 0 : true)) return null;
          
          const targetItems = key === 'totals' ? totalsItems : getMarketItems(key);
          
          const formatTotalNumber = (label: string) => {
            const m = /([0-9]+(?:\.[0-9]+)?|[0-9]+(?:,[0-9]+)?)/.exec(String(label || ''))
            if (!m) return ''
            const raw = String(m[1]).replace(',', '.')
            const n = parseFloat(raw)
            // Normalize integer lines to X.5 (football over-under convention)
            return Number.isFinite(n) && Number.isInteger(n) ? String(n + 0.5) : raw
          }
          const maxLine = key === 'totals' ? 5.5 : 999;
          const okLine = (lbl: string) => {
            const n = Number(lbl);
            if (!Number.isFinite(n)) return false;
            if (n < 0) return false;
            if (n > maxLine) return false;
            return true;
          };

          const over = targetItems
            .filter((x: MarketItem) => /acima|over|mais/i.test(String(x.label)))
            .map((x: MarketItem) => ({ ...x, label: formatTotalNumber(x.label) }))
            .filter((x: MarketItem) => okLine(String(x.label)) && Number(x.odd) > 1.01 && Number(x.odd) < 25)
            .sort((a: MarketItem, b: MarketItem) => Number(a.label) - Number(b.label));

          const under = targetItems
            .filter((x: MarketItem) => /abaixo|under|menos/i.test(String(x.label)))
            .map((x: MarketItem) => ({ ...x, label: formatTotalNumber(x.label) }))
            .filter((x: MarketItem) => okLine(String(x.label)) && Number(x.odd) > 1.01 && Number(x.odd) < 25)
            .sort((a: MarketItem, b: MarketItem) => Number(a.label) - Number(b.label));
             
          if (over.length === 0 && under.length === 0) return null;

          const title = getMarketTitle(key, event?.sport);
          const susp = getSuspendedReason(key);

          // Pair over/under by line value
          const overMap = new Map<string, MarketItem>(over.map((x: MarketItem) => [x.label, x] as [string, MarketItem]));
          const underMap = new Map<string, MarketItem>(under.map((x: MarketItem) => [x.label, x] as [string, MarketItem]));
          const allLines = Array.from(new Set([...over.map((x: MarketItem) => x.label), ...under.map((x: MarketItem) => x.label)]))
            .sort((a, b) => Number(a) - Number(b));

          return (
            <MarketCard title={title} darkMode={darkMode} noPad>
              <div className={`grid grid-cols-[1fr_auto_auto] items-center`}>
                <div className={`text-[11px] font-bold uppercase tracking-wider px-3 py-2 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>Linha</div>
                <div className={`text-[11px] font-bold uppercase tracking-wider px-3 py-2 text-center ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>Mais</div>
                <div className={`text-[11px] font-bold uppercase tracking-wider px-3 py-2 text-center ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>Menos</div>
                {allLines.map((line, i) => {
                  const o = overMap.get(line);
                  const u = underMap.get(line);
                  const rowBg = i % 2 === 0
                    ? (darkMode ? 'bg-gray-800/30' : 'bg-gray-50/80')
                    : '';
                  const renderBtn = (item: MarketItem | undefined) => {
                    if (!item) return <div className="w-20" />;
                    return (
                      <button
                        onClick={susp ? undefined : () => onSelect(item.label, item.odd)}
                        disabled={!!susp}
                        className={`w-20 h-10 rounded-lg font-bold text-sm tabular-nums transition-all duration-200
                          ${susp ? 'bg-gray-600/40 text-gray-400 cursor-not-allowed' : 'bg-red-600 text-white hover:bg-red-500 active:scale-95'}`}
                      >
                        {item.odd.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </button>
                    );
                  };
                  return (
                    <div key={line} className={`contents`}>
                      <div className={`px-3 py-2 text-sm font-semibold ${darkMode ? 'text-gray-200' : 'text-gray-700'} ${rowBg}`}>{line}</div>
                      <div className={`px-2 py-2 flex justify-center ${rowBg}`}>{renderBtn(o)}</div>
                      <div className={`px-2 py-2 flex justify-center ${rowBg}`}>{renderBtn(u)}</div>
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

        const homeWins: typeof rawItems = [];
        const draws: typeof rawItems = [];
        const awayWins: typeof rawItems = [];

        for (const it of rawItems) {
          const s = parseScore(String(it.label));
          if (!s) continue;
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
            <div className="grid grid-cols-3 divide-x divide-gray-100 dark:divide-gray-700">
              {colData.map(col => (
                <div key={col.label} className="flex flex-col">
                  <div className={`text-[10px] font-extrabold uppercase tracking-wider text-center py-1.5 ${col.color} ${darkMode ? 'bg-gray-800/60' : 'bg-gray-50'} border-b border-gray-100 dark:border-gray-700`}>
                    {col.label}
                  </div>
                  <div className="flex flex-col gap-0">
                    {Array.from({ length: maxRows }).map((_, i) => {
                      const item = col.items[i];
                      if (!item) return <div key={i} className="h-10 border-b border-gray-50 dark:border-gray-800/50 last:border-0" />;
                      const val = Number(item.odd);
                      const priceStr = val > 0 ? val.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '--';
                      // Block scores that are impossible given the current live score
                      const parsedLabel = parseScore(String(item.label));
                      const isImpossible = !isSusp && currentGoals !== null && parsedLabel !== null &&
                        (parsedLabel.h < currentGoals.home || parsedLabel.a < currentGoals.away);
                      const isBlocked = isSusp || isImpossible;
                      return (
                        <div key={i} className={`flex items-center justify-between px-2 py-1.5 border-b last:border-0 ${darkMode ? 'border-gray-800/50' : 'border-gray-50'} ${isImpossible ? 'opacity-40' : ''}`}>
                          <span className={`text-xs font-semibold tabular-nums ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>{item.label}</span>
                          <button
                            onClick={isBlocked ? undefined : () => onSelect(item.label, val)}
                            disabled={isBlocked}
                            title={isImpossible ? 'Resultado impossível dado o marcador actual' : undefined}
                            className={`min-w-[54px] h-8 px-2 rounded font-bold text-sm tabular-nums transition-all duration-200
                              ${isBlocked ? 'bg-gray-600/40 text-gray-400 cursor-not-allowed' : 'bg-red-600 text-white hover:bg-red-500 active:scale-95'}`}
                          >
                            {isImpossible ? '🔒' : priceStr}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </MarketCard>
        );
      }

      // Generic
      const items = getMarketItems(key);
      if (!items || items.length === 0) return null;

      const title = getMarketTitle(key, event?.sport);
      const susp = getSuspendedReason(key);
      
      return (
        <MarketCard key={key} title={title} darkMode={darkMode}>
          <MarketButtonGroup items={items} onSelect={onSelect} suspendedReason={susp} darkMode={darkMode} />
        </MarketCard>
      )
  }

  // --- Group logic ---
  const finalGroups = useMemo(() => {
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

      const s = (event?.sport || '').toLowerCase();
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
      const isRugby = s.includes('rugby') || s.includes('union') || s.includes('league');
      
      let BASE_GROUPS = MARKET_GROUPS;
      if (isBasketball) BASE_GROUPS = BASKETBALL_GROUPS;
      else if (isTennis) BASE_GROUPS = TENNIS_GROUPS;
      else if (isVolleyball) BASE_GROUPS = VOLLEYBALL_GROUPS;
      else if (isAFL) BASE_GROUPS = AFL_GROUPS;
      else if (isBaseball) BASE_GROUPS = BASEBALL_GROUPS;
      else if (isF1) BASE_GROUPS = FORMULA1_GROUPS;
      else if (isAmericanFootball) BASE_GROUPS = AMERICAN_FOOTBALL_GROUPS;
      else if (isHandball) BASE_GROUPS = HANDBALL_GROUPS;
      else if (isIceHockey) BASE_GROUPS = ICE_HOCKEY_GROUPS;
      else if (isMMA) BASE_GROUPS = MMA_GROUPS;
      else if (isRugby) BASE_GROUPS = RUGBY_GROUPS;

      return BASE_GROUPS;
  }, [event?.sport, eventOdds]);

  const [activeTab, setActiveTab] = useState(() => {
     const s = (event?.sport || '').toLowerCase();
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
      
      {/* Navigation Tabs */}
      <div className="flex overflow-x-auto pb-2 mb-4 gap-2 no-scrollbar">
         {finalGroups.filter(group => group.keys.some(k => renderMarketContent(k) !== null)).map((group) => (
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
         ))}
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
