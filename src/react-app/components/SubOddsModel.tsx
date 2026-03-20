import { useMemo, memo, useState, useEffect } from 'react'
import { OddButton } from './OddButton'
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

// Helper component to track trend state per button
const MemoizedSubOddButton = memo(({ item, onSelect, suspended }: { item: MarketItem, onSelect: any, suspended?: any }) => {
    const [trend, setTrend] = useState<'up' | 'down' | 'stable'>('stable');
    const prev = useMemo(() => ({ value: Number(item.odd) }), []); // Stable ref container

    const val = Number(item.odd);

    if (val !== prev.value) {
        if (val > prev.value) setTrend('up');
        else if (val < prev.value) setTrend('down');
        prev.value = val;
    }

    useEffect(() => {
        if (trend !== 'stable') {
            const t = setTimeout(() => setTrend('stable'), 5000);
            return () => clearTimeout(t);
        }
    }, [trend]);

    return (
        <OddButton
            label={item.label}
            price={val}
            onClick={() => onSelect(item.label, val)}
            className="px-3 md:px-5 py-1 md:py-2 rounded-md md:rounded-lg bg-red-600 text-white hover:bg-red-500 flex items-center justify-between gap-2 w-full"
            suspended={suspended}
            trend={trend}
        />
    );
});

// Component separado para grupo de botões com paginação (useState não pode ser em função regular)
const MarketButtonGroup = memo(({ items, gridClass, onSelect, suspendedReason }: {
  items: MarketItem[]
  gridClass?: string
  onSelect: (label: string, odd: number) => void
  suspendedReason?: string
}) => {
  const [showAll, setShowAll] = useState(false)
  const LIMIT = 5
  const isLongList = items.length > LIMIT + 3
  const displayItems = isLongList && !showAll ? items.slice(0, LIMIT) : items

  return (
    <div className="flex flex-col gap-2">
      <div className={gridClass || 'grid grid-cols-1 gap-1 md:grid-cols-3 md:gap-2'}>
        {displayItems.map((it, idx) => (
          <MemoizedSubOddButton
            key={`${it.label}-${idx}`}
            item={it}
            onSelect={onSelect}
            suspended={suspendedReason ? { reason: suspendedReason } : undefined}
          />
        ))}
      </div>
      {isLongList && (
        <button
          onClick={() => setShowAll(!showAll)}
          className="self-center text-xs font-bold uppercase tracking-wider text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 py-2 px-4 bg-gray-100 dark:bg-gray-800 rounded-full transition-colors"
        >
          {showAll ? 'Mostrar Menos' : `Mostrar Mais (${items.length - LIMIT})`}
        </button>
      )}
    </div>
  )
})

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

  // --- Helpers ---
  const renderButtons = (items: MarketItem[], marketKey?: string, gridClass?: string) => {
    if (!items || items.length === 0) return null
    const marketReason = marketKey ? suspendedMap.get(marketKey) : undefined
    const finalReason = isGlobalSuspended ? 'EVENT_FROZEN' : marketReason
    return (
      <MarketButtonGroup
        items={items}
        gridClass={gridClass}
        onSelect={onSelect}
        suspendedReason={finalReason}
      />
    )
  }

  // --- Lógica de Odds Principais (Legado/Core) ---

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
    // Deduplication logic embedded
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
     // Fallback only if no market data found
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
    
    // Fallback calc
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

  // --- Função Genérica de Extração ---
  const getMarketItems = (key: string, labelKey?: string) => {
      // Prioridade: markets prop (pré-processado) -> eventOdds (raw)
      // Alias handling: spreads ↔ handicap
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
      // 1. Try to get title from backend metadata (sub_category)
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

  // --- Itens Específicos com Formatação Especial ---
  
  const spreadsItems = useMemo(() => getMarketItems('spreads'), [eventOdds, markets])
  const totalsItems = useMemo(() => getMarketItems('totals'), [eventOdds, markets])
  const bttsItems = useMemo(() => getMarketItems('btts'), [eventOdds, markets])

  // --- Renderização Dinâmica por Grupos ---

  const renderMarketContent = (key: string) => {
      if (key !== 'h2h' && ['h2h_3_way', '1x2', 'main', 'match_winner'].includes(key)) {
          if (resultadoRegulamentar.length > 0) return null;
      }

      // 1. H2H
      if (key === 'h2h') {
          if (resultadoRegulamentar.length === 0) return null;
          const title = getMarketTitle('h2h', event?.sport);

          return (
              <div>
                 <div className={`text-sm md:text-base font-semibold mb-1 md:mb-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>{title}</div>
                 {renderButtons(resultadoRegulamentar, 'h2h')}
              </div>
          );
      }
      
      // 2. Double Chance
      if (key === 'double_chance') {
          if (doubleChanceItems.length === 0) return null;
          const title = getMarketTitle('double_chance', event?.sport);
          return (
             <div>
               <div className={`text-sm md:text-base font-semibold mb-1 md:mb-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>{title}</div>
               {renderButtons(doubleChanceItems, 'double_chance')}
             </div>
          );
      }

      // 3. Spreads/Handicap (Asian Handicap)
      if (key === 'spreads' || key === 'handicap') {
          const baseItems = key === 'handicap' ? getMarketItems('handicap') : spreadsItems
          if (baseItems.length === 0) return null;
          const title = getMarketTitle(key, event?.sport);
          
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
            <div>
              <div className={`text-base font-semibold mb-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>{title}</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <div className={`rounded-xl border p-3 ${darkMode ? 'bg-gray-900/40 border-gray-700' : 'bg-gray-100 border-gray-200'}`}>
                  <div className={`text-[11px] md:text-xs font-extrabold uppercase tracking-wider mb-2 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>{home || 'Casa'}</div>
                  {renderButtons(homeItems, key, "grid grid-cols-1 gap-1")}
                </div>
                <div className={`rounded-xl border p-3 ${darkMode ? 'bg-gray-900/40 border-gray-700' : 'bg-gray-100 border-gray-200'}`}>
                  <div className={`text-[11px] md:text-xs font-extrabold uppercase tracking-wider mb-2 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>{away || 'Fora'}</div>
                  {renderButtons(awayItems, key, "grid grid-cols-1 gap-1")}
                </div>
              </div>
            </div>
          )
      }

      // 4. Totals (Generic Ladder for Totals, Corners, Cards)
      if (key === 'totals' || key === 'corners_total' || key === 'cards_total' || key === 'goals_total' || key === 'team_totals') {
          if (totalsItems.length === 0 && (key !== 'totals' ? getMarketItems(key).length === 0 : true)) return null;
          
          const targetItems = key === 'totals' ? totalsItems : getMarketItems(key);
          
          const formatTotalNumber = (label: string) => {
            const m = /([0-9]+(?:\.[0-9]+)?|[0-9]+(?:,[0-9]+)?)/.exec(String(label || ''))
            if (!m) return ''
            return String(m[1]).replace(',', '.')
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

          return (
            <div>
              <div className={`text-sm md:text-base font-semibold mb-1 md:mb-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>{title}</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-1 md:gap-2">
                <div>
                  <div className={`text-[11px] md:text-xs font-medium mb-1 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Acima</div>
                  {renderButtons(over, key, "grid grid-cols-1 gap-0.5")}
                </div>
                <div>
                  <div className={`text-[11px] md:text-xs font-medium mb-1 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Abaixo</div>
                  {renderButtons(under, key, "grid grid-cols-1 gap-0.5")}
                </div>
              </div>
            </div>
          )
      }

      // 5. BTTS
      if (key === 'btts') {
          if (bttsItems.length === 0) return null;
          const title = getMarketTitle('btts', event?.sport);
          return (
            <div>
              <div className={`text-sm md:text-base font-semibold mb-1 md:mb-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>{title}</div>
              {renderButtons(bttsItems, 'btts', "grid grid-cols-2 gap-2")}
            </div>
          )
      }

      // Generic extraction
      const items = getMarketItems(key);
      if (!items || items.length === 0) return null;

      const title = getMarketTitle(key, event?.sport);
      const config = MARKET_CONFIG[key] || {};
      
      return (
         <div key={key}>
           <div className={`text-sm md:text-base font-semibold mb-1 md:mb-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>{title}</div>
           {renderButtons(items, key, config.grid || "grid grid-cols-1 gap-0.5")}
         </div>
      )
  }

  // --- Lógica de Grupos Dinâmicos (Automação) ---
  const finalGroups = useMemo(() => {
      // 1. Check if backend provides categories (New Logic)
      const keysWithCategory = Object.keys(eventOdds || {}).filter(k => (eventOdds as any)[k]?.category);
      
      if (keysWithCategory.length > 0) {
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

          // Group keys by category
          for (const key of keysWithCategory) {
              // Skip aliases and duplicates
              if (key === 'main' || key === '1x2' || key === 'match_winner') continue; 
              
              const cat = (eventOdds as any)[key].category;
              if (cat === 'Outros Mercados') continue; // Filter out explicitly
              
              if (!categoryMap.has(cat)) {
                  categoryMap.set(cat, new Set());
              }
              categoryMap.get(cat)!.add(key);
          }

          // Build groups respecting order
          const groups = [];
          
          // Add ordered categories first
          for (const catName of ORDERED_CATEGORIES) {
              if (categoryMap.has(catName)) {
                  groups.push({
                      title: catName,
                      keys: Array.from(categoryMap.get(catName)!)
                  });
                  categoryMap.delete(catName);
              }
          }

          // Add any remaining categories
          for (const [catName, keys] of categoryMap.entries()) {
              groups.push({
                  title: catName,
                  keys: Array.from(keys)
              });
          }

          return groups;
      }

      // 2. Fallback to Legacy Static Groups
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
  }, [event?.sport]);

  // State for active tab
  const [activeTab, setActiveTab] = useState(() => {
     // Initial state based on current sport groups
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
  
  // Ensure active tab is valid
  useEffect(() => {
      if (!finalGroups.find(g => g.title === activeTab)) {
          setActiveTab(finalGroups[0].title);
      }
  }, [finalGroups, activeTab]);

  return (
    <div className={`${darkMode ? 'bg-gray-800 border border-gray-700' : 'bg-white border border-gray-200'} rounded-2xl p-2 md:p-3`}>
      
      {/* Navigation Tabs */}
      <div className="flex overflow-x-auto pb-2 mb-4 gap-2 no-scrollbar">
         {finalGroups.map((group) => (
             <button
                key={group.title}
                onClick={() => setActiveTab(group.title)}
                className={`whitespace-nowrap px-4 py-2 rounded-full text-sm font-semibold transition-colors ${
                    activeTab === group.title
                    ? 'bg-red-600 text-white'
                    : (darkMode ? 'bg-gray-700 text-gray-300 hover:bg-gray-600' : 'bg-gray-100 text-gray-700 hover:bg-gray-200')
                }`}
             >
                {group.title}
             </button>
         ))}
      </div>

      <div className="space-y-6">
        
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
                    <div className="space-y-4">
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
