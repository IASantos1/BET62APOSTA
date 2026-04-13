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
            className="px-2.5 md:px-4 py-1.5 md:py-2 rounded-md md:rounded-lg bg-red-600 text-white hover:bg-red-500 flex items-center justify-between gap-2 w-full"
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
  const defaultGrid =
    items.length <= 3
      ? 'grid grid-cols-3 gap-2'
      : 'grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 md:gap-2';

  return (
    <div className="flex flex-col gap-2">
      <div className={gridClass || defaultGrid}>
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
  liveMetrics,
  oddsLockUntil,
}: {
  event: any
  darkMode: boolean
  markets: Markets | null
  eventOdds: Record<string, any[]> | null
  onSelect: (label: string, odd: number) => void
  labelOutcome: (market: string, name: string) => string
  applyMarginClamp: (mk: string, v: number) => number
  suspendedMarkets?: { eventId: number; marketId: string; reason: string }[]
  liveMetrics?: { goals?: number; corners?: number; cards?: number }
  oddsLockUntil?: number
}) {
  const home = useMemo(() => String(event?.home_team || (event?.match || '').split(' vs ')[0] || ''), [event])
  const away = useMemo(() => String(event?.away_team || (event?.match || '').split(' vs ')[1] || ''), [event])
  const [nowTs, setNowTs] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!oddsLockUntil || oddsLockUntil <= Date.now()) return;
    const t = setInterval(() => setNowTs(Date.now()), 500);
    return () => clearInterval(t);
  }, [oddsLockUntil]);
  const isCriticalLocked = Boolean(oddsLockUntil && oddsLockUntil > nowTs);
  const isGlobalSuspended = Boolean((event as any)?.oddsFrozen || (event as any)?.suspended || isCriticalLocked);

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
  const limitByLabel = (arr: MarketItem[], perLabel = 6) => {
    const buckets = new Map<string, MarketItem[]>();
    const labelOf = (s: string) => {
      const t = String(s || '').toLowerCase();
      if (t.startsWith('casa') || t.startsWith('home')) return 'Casa';
      if (t.startsWith('fora') || t.startsWith('away')) return 'Fora';
      if (t.startsWith('empate') || t === 'x') return 'Empate';
      if (t.startsWith('over') || t.startsWith('acima') || t.startsWith('mais')) return 'Over';
      if (t.startsWith('under') || t.startsWith('abaixo') || t.startsWith('menos')) return 'Under';
      if (t === 'sim' || t === 'yes') return 'Sim';
      if (t === 'não' || t === 'nao' || t === 'no') return 'Não';
      return s;
    };
    for (const it of arr) {
      const k = labelOf(it.label);
      const list = buckets.get(k) || [];
      list.push(it);
      buckets.set(k, list);
    }
    const allUnique = Array.from(buckets.values()).every((l) => l.length <= 1);
    if (allUnique) return arr;
    const out: MarketItem[] = [];
    for (const [, list] of buckets) {
      out.push(...list.slice(0, perLabel));
    }
    return out;
  };

  const renderButtons = (items: MarketItem[], marketKey?: string, gridClass?: string) => {
    if (!items || items.length === 0) return null
    const capped = limitByLabel(items, 6)
    const marketReason = marketKey ? suspendedMap.get(marketKey) : undefined
    const finalReason = isGlobalSuspended ? (isCriticalLocked ? 'MOMENTO_CRITICO' : 'EVENT_FROZEN') : marketReason
    return (
      <MarketButtonGroup
        items={capped}
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
    
    const mapped = list.map((o: any) => {
      const v0 = Number(o?.odd || o?.value || o?.price || 0)
      const v = applyMarginClamp('h2h', v0)
      const lbl = labelOutcome('h2h', String(o?.label || o?.outcome || o?.name || ''))
      return { label: lbl, odd: v } as MarketItem
    }).filter((x: MarketItem) => x.label && x.odd > 0)
    
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
     const h0 = Number(event?.home_odd || 0)
     const d0 = Number(event?.draw_odd || 0)
     const a0 = Number(event?.away_odd || 0)
     const fromEvent: MarketItem[] = []
     if(h0 > 0) fromEvent.push({ label: 'Casa', odd: h0 })
     if(d0 > 0) fromEvent.push({ label: 'Empate', odd: d0 })
     if(a0 > 0) fromEvent.push({ label: 'Fora', odd: a0 })

     const isLive = Number(event?.is_live || 0) === 1;
     if (isLive && fromEvent.length >= 2) return fromEvent;
     if (h2hInternalItems.length > 0) return h2hInternalItems;
     return fromEvent
  }, [event, h2hInternalItems])

  const doubleChanceItems = useMemo(() => {
    const raw = (eventOdds && (eventOdds as any)['double_chance']);
    const list = Array.isArray(raw) ? raw : (raw?.outcomes || raw?.values || []);

    const mapped = list.map((o: any) => {
      const v0 = Number(o?.odd || o?.value || o?.price || 0)
      const v = applyMarginClamp('double_chance', v0)
      const lbl = labelOutcome('double_chance', String(o?.label || o?.outcome || o?.name || ''))
      return { label: lbl, odd: v } as MarketItem
    }).filter((x: MarketItem) => x.label && x.odd > 0)
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
      if (markets) {
        if (markets[key] && markets[key]!.length > 0) {
          const list = markets[key]!;
          const n = (s: any) => {
            if (s === null || s === undefined) return NaN
            const x = String(s).trim().replace(',', '.')
            const v = parseFloat(x)
            return Number.isFinite(v) ? v : NaN
          }
          return [...list].sort((a: MarketItem, b: MarketItem) => {
            const ap = n(a.handicap)
            const bp = n(b.handicap)
            if (Number.isFinite(ap) && Number.isFinite(bp) && ap !== bp) return ap - bp
            return Number(a.odd) - Number(b.odd)
          });
        }
      }

      const raw = (eventOdds && (eventOdds as any)[key]);
      const list = Array.isArray(raw) ? raw : (raw?.outcomes || raw?.values || []);

      const mapped = list.map((o: any) => {
        const v0 = Number(o?.odd || o?.price || 0) || Number(o?.value || 0)
        const v = applyMarginClamp(key, v0)
        const lbl = labelOutcome(labelKey || key, String(o?.label || o?.outcome || o?.name || ''))
        const hcRaw = o?.point ?? o?.handicap ?? o?.line ?? o?.total ?? o?.spread ?? null
        const hc = hcRaw === null || hcRaw === undefined ? undefined : String(hcRaw)
        return { label: lbl, odd: v, name: o?.label || o?.outcome || o?.name, handicap: hc } as MarketItem
      }).filter((x: MarketItem) => x.label && x.odd >= 1.01 && x.odd < 1000)
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
      // Format special_* keys with readable Portuguese titles
      if (key.startsWith('special_')) {
        const slug = key.replace(/^special_/, '').replace(/_/g, ' ');
        const titles: Record<string, string> = {
          'anytimegoalscorer': 'Marcador em Qualquer Momento',
          'teamgoalscorer': 'Marcador da Equipa',
          'specials': 'Especiais',
          'goalmethod': 'Método do Golo',
          'playershots': 'Remates do Jogador',
          'playershots ontarget': 'Remates à Baliza',
          'playercards': 'Cartões do Jogador',
          'playertoscoreorassist': 'Marcar ou Assistir',
          'multiscorers': 'Múltiplos Marcadores',
          'numberofgoalsinmatch': 'Total de Golos',
          'totalcorners': 'Total de Cantos',
          'first10minutes': '1ª Hora',
        };
        return titles[slug] || slug.replace(/\b\w/g, l => l.toUpperCase());
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
      if (key === 'spreads') {
          const baseItems = spreadsItems
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
                  {renderButtons(homeItems, key, "grid grid-cols-2 gap-1 sm:grid-cols-3")}
                </div>
                <div className={`rounded-xl border p-3 ${darkMode ? 'bg-gray-900/40 border-gray-700' : 'bg-gray-100 border-gray-200'}`}>
                  <div className={`text-[11px] md:text-xs font-extrabold uppercase tracking-wider mb-2 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>{away || 'Fora'}</div>
                  {renderButtons(awayItems, key, "grid grid-cols-2 gap-1 sm:grid-cols-3")}
                </div>
              </div>
            </div>
          )
      }

      // 4. Totals (Goals / Corners / Cards) em linhas lado-a-lado (Over x Under)
      if (key === 'totals' || key === 'corners_totals' || key === 'cards_totals' || key === 'team_totals') {
          const targetItems = key === 'totals' ? totalsItems : getMarketItems(key);
          if (!targetItems || targetItems.length === 0) return null;

          const title = getMarketTitle(key, event?.sport);

          const goalsHome = Number((event as any)?.goals?.home ?? (event as any)?.score?.home ?? (event as any)?.goals_home ?? 0);
          const goalsAway = Number((event as any)?.goals?.away ?? (event as any)?.score?.away ?? (event as any)?.goals_away ?? 0);
          const totalGoals = (Number.isFinite(goalsHome) ? goalsHome : 0) + (Number.isFinite(goalsAway) ? goalsAway : 0);
          const statusShort = String((event as any)?.fixture?.status?.short || '').toUpperCase();
          const isLive = Boolean((event as any)?.is_live) || (statusShort && statusShort !== 'NS' && statusShort !== 'TBD' && statusShort !== 'PST');

          const parsePoint = (it: MarketItem) => {
            const hc = it.handicap ? String(it.handicap).trim().replace(',', '.') : '';
            if (hc && Number.isFinite(Number(hc))) return Number(hc);
            const m = /([0-9]+(?:\.[0-9]+)?|[0-9]+(?:,[0-9]+)?)/.exec(String(it.label || ''));
            if (!m) return NaN;
            const v = Number(String(m[1]).replace(',', '.'));
            return Number.isFinite(v) ? v : NaN;
          };

          const isOverLabel = (s: string) => /(^|\b)(over|acima|mais)\b/i.test(s);
          const isUnderLabel = (s: string) => /(^|\b)(under|abaixo|menos)\b/i.test(s);

          // ── Team Totals: separate by Casa/Fora (soccer only) ───────────────── 
          if (key === 'team_totals') { 
            const isSoccerEvent = /soccer|futebol/i.test(String(event?.sport || '')); 
            const teamLabel = (lbl: string) => { 
              const l = lbl.toLowerCase(); 
              if (l.startsWith('casa') || l.includes('home')) return 'casa'; 
              if (l.startsWith('fora') || l.includes('away')) return 'fora'; 
              return 'other'; 
            }; 
            const buildTeamMap = (items: MarketItem[]) => { 
              const byP = new Map<number, { over?: MarketItem; under?: MarketItem }>(); 
              for (const it of items) { 
                const p = parsePoint(it); 
                if (!Number.isFinite(p)) continue; 
                const lbl = String(it.label || ''); 
                const slot = byP.get(p) || {}; 
                if (isOverLabel(lbl)) { if (!slot.over || Number(it.odd) > Number(slot.over.odd)) slot.over = it; } 
                else if (isUnderLabel(lbl)) { if (!slot.under || Number(it.odd) > Number(slot.under.odd)) slot.under = it; } 
                byP.set(p, slot); 
              } 
              return byP; 
            }; 
            const casaItems = isSoccerEvent ? (targetItems as MarketItem[]).filter((it: MarketItem) => teamLabel(it.label) === 'casa') : []; 
            const foraItems = isSoccerEvent ? (targetItems as MarketItem[]).filter((it: MarketItem) => teamLabel(it.label) === 'fora') : []; 
            const otherItems = (targetItems as MarketItem[]).filter((it: MarketItem) => !isSoccerEvent || teamLabel(it.label) === 'other'); 
            const renderTeamBlock = (label: string, items: MarketItem[]) => { 
              if (!items.length) return null; 
              const byP = buildTeamMap(items); 
              let pts = Array.from(byP.keys()).sort((a, b) => a - b); 
              // Soccer: restrict to half-integer lines 0.5–4.5 
              if (isSoccerEvent) { 
                pts = pts.filter(p => { 
                  const x2 = Math.round(p * 2); 
                  return Math.abs(p * 2 - x2) < 1e-9 && (x2 % 2 === 1) && p >= 0.5 && p <= 4.5; 
                }); 
              } 
              if (!pts.some(p => { const s = byP.get(p); return s?.over || s?.under; })) return null; 
              return ( 
                <div className="mb-2"> 
                  <div className={`text-xs font-bold uppercase tracking-wider mb-1 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{label}</div> 
                  <div className="grid grid-cols-1 gap-1.5"> 
                    {pts.map((p) => { 
                      const slot = byP.get(p) || {}; 
                      return ( 
                        <div key={String(p)} className="grid grid-cols-2 gap-2"> 
                          <div>{slot.over ? renderButtons([slot.over], key, "grid grid-cols-1 gap-0.5") : <div />}</div> 
                          <div>{slot.under ? renderButtons([slot.under], key, "grid grid-cols-1 gap-0.5") : <div />}</div> 
                        </div> 
                      ); 
                    })} 
                  </div> 
                </div> 
              ); 
            }; 
            const casaBlock = renderTeamBlock(home, casaItems); 
            const foraBlock = renderTeamBlock(away, foraItems); 
            const otherBlock = renderTeamBlock('', otherItems); 
            if (!casaBlock && !foraBlock && !otherBlock) return null; 
            return ( 
              <div> 
                <div className={`text-sm md:text-base font-semibold mb-1 md:mb-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>{title}</div> 
                {casaBlock} 
                {foraBlock} 
                {otherBlock} 
              </div> 
            ); 
          }

          const byPoint = new Map<number, { over?: MarketItem; under?: MarketItem }>();
          for (const it of targetItems) {
            const p = parsePoint(it);
            if (!Number.isFinite(p)) continue;
            const lbl = String(it.label || '');
            const slot = byPoint.get(p) || {};
            if (isOverLabel(lbl)) {
              if (!slot.over || Number(it.odd) > Number(slot.over.odd)) slot.over = it;
            } else if (isUnderLabel(lbl)) {
              if (!slot.under || Number(it.odd) > Number(slot.under.odd)) slot.under = it;
            }
            byPoint.set(p, slot);
          }

          let points = Array.from(byPoint.keys()).sort((a, b) => a - b);

          if (key === 'totals' && /soccer|futebol/i.test(String(event?.sport || ''))) {
            const baseMax = 4.5;
            const maxPoint = isLive ? Math.max(baseMax, totalGoals + 1.5) : baseMax;
            points = points
              .filter((p) => p >= 0.5 && p <= maxPoint + 1e-9)
              .filter((p) => {
                const x2 = Math.round(p * 2);
                return Math.abs(p * 2 - x2) < 1e-9 && (x2 % 2 === 1);
              });
            if (isLive) points = points.filter((p) => p > totalGoals + 1e-9);
          }
          if (key === 'totals' && /basketball|basquete|nba/i.test(String(event?.sport || ''))) {
            points = points.filter((p) => p >= 100);
          }
          if (key === 'corners_totals') {
            const liveCorners = Number(liveMetrics?.corners || 0);
            const baseMax = 11.5;
            const maxPoint = isLive ? Math.max(baseMax, liveCorners + 1.5) : baseMax;
            const minPoint = isLive && liveCorners > 0 ? liveCorners : 5.5;
            points = points
              .filter((p) => p >= Math.max(5.5, minPoint) && p <= maxPoint + 1e-9)
              .filter((p) => isLive ? p > liveCorners + 1e-9 : true)
              .filter((p) => {
                const x2 = Math.round(p * 2);
                return Math.abs(p * 2 - x2) < 1e-9 && (x2 % 2 === 1);
              });
          }
          if (key === 'cards_totals') {
            const liveCards = Number(liveMetrics?.cards || 0);
            const baseMax = 5.5;
            const maxPoint = isLive ? Math.max(baseMax, liveCards + 1.5) : baseMax;
            points = points
              .filter((p) => p >= 1.5 && p <= maxPoint + 1e-9)
              .filter((p) => {
                const x2 = Math.round(p * 2);
                return Math.abs(p * 2 - x2) < 1e-9 && (x2 % 2 === 1);
              });
          }

          const hasAny = points.some((p) => {
            const slot = byPoint.get(p);
            return Boolean(slot?.over || slot?.under);
          });
          if (!hasAny) return null;

          return (
            <div>
              <div className={`text-sm md:text-base font-semibold mb-1 md:mb-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>{title}</div>
              <div className="grid grid-cols-1 gap-1.5">
                {points.map((p) => {
                  const slot = byPoint.get(p) || {};
                  return (
                    <div key={String(p)} className="grid grid-cols-2 gap-2">
                      <div>{slot.over ? renderButtons([slot.over], key, "grid grid-cols-1 gap-0.5") : <div />}</div>
                      <div>{slot.under ? renderButtons([slot.under], key, "grid grid-cols-1 gap-0.5") : <div />}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
      }

      // 5. BTTS
      if (key === 'btts') {
          if (bttsItems.length === 0) return null;
          const s = String(event?.sport || '').toLowerCase();
          const isSoccer = s.includes('soccer') || s.includes('futebol') || s.includes('football');
          const isLive = Number(event?.is_live || 0) === 1;
          if (isSoccer && isLive) {
            const gh = Number(event?.goals?.home ?? (event?.score?.home ?? 0));
            const ga = Number(event?.goals?.away ?? (event?.score?.away ?? 0));
            if (Number.isFinite(gh) && Number.isFinite(ga) && gh > 0 && ga > 0) return null;
          }
          const title = getMarketTitle('btts', event?.sport); 
          const norm = (s: string) => String(s || '').toLowerCase().trim(); 
          const pick = (want: string) => bttsItems.find((x: MarketItem) => norm(x.label) === norm(want)) || null; 
          const ordered = (['Sim', 'Não'] as const).map((l) => pick(l)).filter(Boolean) as MarketItem[]; 
          return ( 
            <div> 
              <div className={`text-sm md:text-base font-semibold mb-1 md:mb-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>{title}</div>
              {renderButtons(ordered.length ? ordered : bttsItems, 'btts', "grid grid-cols-2 gap-2")}
            </div>
          )
      }

      // 6. Resultado & Ambas Marcam (lado a lado, PT)
      if (key === 'result_btts') {
          const items = getMarketItems('result_btts', 'result_btts');
          if (!items || items.length === 0) return null;
          const norm = (s: string) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
          const pick = (want: string) => items.find((x: MarketItem) => norm(x.label) === norm(want)) || null;
          const yesRow = ['Casa/Sim', 'Empate/Sim', 'Fora/Sim'].map((l) => pick(l)).filter(Boolean) as MarketItem[];
          const noRow = ['Casa/Não', 'Empate/Não', 'Fora/Não'].map((l) => pick(l)).filter(Boolean) as MarketItem[];
          const title = getMarketTitle('result_btts', event?.sport);
          const any = yesRow.length + noRow.length > 0;
          if (!any) return null;
          return (
            <div>
              <div className={`text-sm md:text-base font-semibold mb-1 md:mb-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>{title}</div>
              <div className="grid grid-cols-1 gap-2">
                {yesRow.length > 0 && (
                  <div>
                    <div className={`text-[11px] md:text-xs font-extrabold uppercase tracking-wider mb-2 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>Sim</div>
                    {renderButtons(yesRow, 'result_btts', "grid grid-cols-3 gap-2")}
                  </div>
                )}
                {noRow.length > 0 && (
                  <div>
                    <div className={`text-[11px] md:text-xs font-extrabold uppercase tracking-wider mb-2 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>Não</div>
                    {renderButtons(noRow, 'result_btts', "grid grid-cols-3 gap-2")}
                  </div>
                )}
              </div>
            </div>
          );
      }

      // 7. Mais/Menos & Ambas Marcam (filtro inteligente por linha, PT)
      if (key === 'totals_btts') {
          const base = getMarketItems('totals_btts', 'totals_btts');
          if (!base || base.length === 0) return null;
          const goalsHome = Number((event as any)?.goals?.home ?? (event as any)?.score?.home ?? (event as any)?.goals_home ?? 0);
          const goalsAway = Number((event as any)?.goals?.away ?? (event as any)?.score?.away ?? (event as any)?.goals_away ?? 0);
          const totalGoals = (Number.isFinite(goalsHome) ? goalsHome : 0) + (Number.isFinite(goalsAway) ? goalsAway : 0);
          const statusShort = String((event as any)?.fixture?.status?.short || '').toUpperCase();
          const isLive = Boolean((event as any)?.is_live) || (statusShort && statusShort !== 'NS' && statusShort !== 'TBD' && statusShort !== 'PST');
          const parsePoint = (lbl: string) => {
            const m = /([0-9]+(?:\.[0-9]+)?|[0-9]+(?:,[0-9]+)?)/.exec(String(lbl || ''));
            if (!m) return NaN;
            const v = Number(String(m[1]).replace(',', '.'));
            return Number.isFinite(v) ? v : NaN;
          };
          const groups = new Map<number, MarketItem[]>();
          for (const it of base) {
            const p = parsePoint(it.label);
            if (!Number.isFinite(p)) continue;
            const list = groups.get(p) || [];
            list.push(it);
            groups.set(p, list);
          }
          const points = Array.from(groups.keys()).sort((a, b) => a - b);
          if (points.length === 0) return null;
          const basePoint = 2.5;
          const pickPoint = () => {
            if (!/soccer|futebol/i.test(String(event?.sport || ''))) return points[0];
            if (!isLive) return points.includes(basePoint) ? basePoint : points[0];
            const maxPoint = Math.max(basePoint, Math.min(4.5, totalGoals + 0.5));
            const allowed = points.filter((p) => p >= basePoint && p <= maxPoint + 1e-9);
            return allowed.includes(basePoint) ? basePoint : (allowed[0] ?? points[0]);
          };
          const p0 = pickPoint();
          const list = groups.get(p0) || [];
          const title = getMarketTitle('totals_btts', event?.sport);
          return (
            <div>
              <div className={`text-sm md:text-base font-semibold mb-1 md:mb-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>{title} {String(p0).replace('.', ',')}</div>
              {renderButtons(list, 'totals_btts', "grid grid-cols-2 gap-2 sm:grid-cols-4")}
            </div>
          );
      }

      // 6. Correct Score (Placar Exato) separado por Casa/Empate/Fora + "Outros"
      if (key === 'correct_score' || key === 'score_exact') {
          const raw = (eventOdds && (eventOdds as any)[key]);
          const list = Array.isArray(raw) ? raw : (raw?.outcomes || raw?.values || []);
          if (!Array.isArray(list) || list.length === 0) return null;
          const scoreHome = Number((event as any)?.goals?.home ?? (event as any)?.score?.home ?? (event as any)?.goals_home ?? 0);
          const scoreAway = Number((event as any)?.goals?.away ?? (event as any)?.score?.away ?? (event as any)?.goals_away ?? 0);
          const statusShort = String((event as any)?.fixture?.status?.short || '').toUpperCase();
          const isLive = Boolean((event as any)?.is_live) || (statusShort && statusShort !== 'NS' && statusShort !== 'TBD' && statusShort !== 'PST');
          const isSoccer = /soccer|futebol/i.test(String(event?.sport || ''));

          const parseOdd = (v: any) => {
            if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
            const s0 = String(v ?? '').trim();
            if (!s0) return 0;
            const s = s0.replace(/\./g, '').replace(',', '.');
            const n = parseFloat(s);
            return Number.isFinite(n) ? n : 0;
          };

          const parseScore = (label: string) => {
            const m = String(label || '').match(/(\d+)\s*[:-]\s*(\d+)/);
            if (!m) return null;
            const hg = Number(m[1]);
            const ag = Number(m[2]);
            if (!Number.isFinite(hg) || !Number.isFinite(ag)) return null;
            return { hg, ag, key: `${hg}:${ag}` };
          };

          const scored = new Map<string, { label: string; odd: number; hg: number; ag: number }>();
          for (const o of list) {
            const label = String(o?.outcome || o?.name || o?.label || '');
            const sc = parseScore(label);
            if (!sc) continue;
            const odd = parseOdd(o?.odd ?? o?.price ?? o?.value);
            if (!(odd > 1.01 && odd < 2000)) continue;
            const prev = scored.get(sc.key);
            if (!prev || odd > prev.odd) scored.set(sc.key, { label: sc.key, odd, hg: sc.hg, ag: sc.ag });
          }
          const all = Array.from(scored.values());
          if (all.length === 0) return null;

          const usable = (isSoccer && isLive)
            ? all.filter((x) => x.hg >= scoreHome && x.ag >= scoreAway)
            : all;

          const homeWins = usable.filter((x) => x.hg > x.ag).sort((a, b) => a.odd - b.odd);
          const draws = usable.filter((x) => x.hg === x.ag).sort((a, b) => a.odd - b.odd);
          const awayWins = usable.filter((x) => x.hg < x.ag).sort((a, b) => a.odd - b.odd);

          const top = (arr: any[]) => arr.slice(0, 6).map((x) => ({ label: x.label, odd: x.odd } as MarketItem));
          const restProb = (arr: any[]) => arr.slice(6).reduce((sum, x) => sum + (x.odd > 1.01 ? (1 / x.odd) : 0), 0);
          const oddFromProb = (p: number) => (p > 0 ? (1 / p) : 0);

          const otherItems: MarketItem[] = [];
          const pHome = restProb(homeWins);
          const pDraw = restProb(draws);
          const pAway = restProb(awayWins);
          const oHome = oddFromProb(pHome);
          const oDraw = oddFromProb(pDraw);
          const oAway = oddFromProb(pAway);
          if (oHome > 1.01) otherItems.push({ label: 'Outro Casa', odd: oHome });
          if (oDraw > 1.01) otherItems.push({ label: 'Outro Empate', odd: oDraw });
          if (oAway > 1.01) otherItems.push({ label: 'Outro Fora', odd: oAway });

          const title = getMarketTitle('correct_score', event?.sport) || 'Placar Exato';

          return (
            <div>
              <div className={`text-sm md:text-base font-semibold mb-1 md:mb-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>{title}</div>
              <div className="grid grid-cols-3 gap-2">
                <div className={`rounded-xl border p-3 ${darkMode ? 'bg-gray-900/40 border-gray-700' : 'bg-gray-100 border-gray-200'}`}>
                  <div className={`text-[11px] md:text-xs font-extrabold uppercase tracking-wider mb-2 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>Casa</div>
                  {renderButtons(top(homeWins), 'correct_score', "grid grid-cols-1 gap-1")}
                </div>
                <div className={`rounded-xl border p-3 ${darkMode ? 'bg-gray-900/40 border-gray-700' : 'bg-gray-100 border-gray-200'}`}>
                  <div className={`text-[11px] md:text-xs font-extrabold uppercase tracking-wider mb-2 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>Empate</div>
                  {renderButtons(top(draws), 'correct_score', "grid grid-cols-1 gap-1")}
                </div>
                <div className={`rounded-xl border p-3 ${darkMode ? 'bg-gray-900/40 border-gray-700' : 'bg-gray-100 border-gray-200'}`}>
                  <div className={`text-[11px] md:text-xs font-extrabold uppercase tracking-wider mb-2 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>Fora</div>
                  {renderButtons(top(awayWins), 'correct_score', "grid grid-cols-1 gap-1")}
                </div>
              </div>
              {otherItems.length > 0 && (
                <div className={`mt-2 rounded-xl border p-3 ${darkMode ? 'bg-gray-900/30 border-gray-700' : 'bg-white border-gray-200'}`}>
                  <div className={`text-[11px] md:text-xs font-extrabold uppercase tracking-wider mb-2 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>Outros Resultados</div>
                  {renderButtons(otherItems, 'correct_score', "grid grid-cols-2 gap-2 sm:grid-cols-3")}
                </div>
              )}
            </div>
          );
      }

      // Special markets (player scorers, specials, etc.)
      if (key.startsWith('special_')) {
        const rawSpecial = markets ? (markets as any)[key] : null;
        const specialList: MarketItem[] = Array.isArray(rawSpecial)
          ? rawSpecial
              .map((o: any) => ({ label: String(o?.label || o?.name || ''), odd: Number(o?.odd || o?.price || 0) }))
              .filter((x: MarketItem) => x.label && x.odd >= 1.01 && x.odd < 1000)
              .sort((a: MarketItem, b: MarketItem) => a.odd - b.odd)
          : [];
        if (!specialList.length) return null;
        const title = getMarketTitle(key, event?.sport);
        return (
          <div>
            <div className={`text-sm md:text-base font-semibold mb-1 md:mb-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>{title}</div>
            {renderButtons(specialList, key, "grid grid-cols-2 gap-2 sm:grid-cols-3")}
          </div>
        );
      }

      // Generic extraction
      const items = getMarketItems(key);
      if (!items || items.length === 0) return null;

      const title = getMarketTitle(key, event?.sport);
      const config = MARKET_CONFIG[key] || {};
      const cfgGrid = config.grid
        ? (config.grid.includes('grid') ? config.grid : `grid ${config.grid}`)
        : null;
      
      return (
         <div key={key}>
           <div className={`text-sm md:text-base font-semibold mb-1 md:mb-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>{title}</div>
           {renderButtons(items, key, cfgGrid || "grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4")}
         </div>
      )
  }

  // --- Lógica de Grupos Dinâmicos (Automação) ---
  const finalGroups = useMemo(() => {
      const hasMarketData = (k: string) => {
          const m = markets ? (markets as any)[k] : null;
          if (Array.isArray(m)) return m.length > 0;
          const raw = (eventOdds && (eventOdds as any)[k]);
          const list = Array.isArray(raw) ? raw : (raw?.outcomes || raw?.values || []);
          return Array.isArray(list) && list.length > 0;
      };

      // 1. Check if backend provides categories (New Logic)
      const keysWithCategory = Object.keys(eventOdds || {}).filter(k => (eventOdds as any)[k]?.category);
      
      if (keysWithCategory.length > 0) {
          const normCat = (raw: string) => {
              const c = String(raw || '').toLowerCase().trim();
              if (!c) return '';
              if (c === 'mercado raiz') return 'Mercado Raiz';
              if (c === 'resultado' || c === 'mercados de resultado') return 'Mercados de Resultado';
              if (c.startsWith('golos') || c.startsWith('gols') || c.includes('totais') || c === 'ambas marcam' || c === 'mercados de gols') return 'Mercados de Gols';
              if (c === 'estatísticas' || c === 'estatisticas' || c === 'mercados estatísticos' || c === 'mercados estatisticos') return 'Mercados Estatísticos';
              if (c === 'jogadores' || c === 'mercados de jogadores') return 'Mercados de Jogadores';
              if (c === 'especiais' || c === 'mercados especiais') return 'Mercados Especiais';
              if (c === 'mercados temporais' || c === 'temporais') return 'Mercados Temporais';
              return raw;
          };
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
              if (!hasMarketData(key)) continue;
              
              const cat = normCat((eventOdds as any)[key].category);
              if (cat === 'Outros Mercados') continue; // Filter out explicitly
              if (!cat) continue;
              
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
      
      // Global dedup: each market key should appear in at most ONE group (first wins)
      const seenKeys = new Set<string>();
      const staticGroups = BASE_GROUPS.map(g => ({
        ...g,
        keys: (g.keys as string[]).filter((k: string) => {
          if (seenKeys.has(k)) return false;
          seenKeys.add(k);
          return true;
        })
      })).filter(g => g.keys.length > 0);
      // Detect special_* keys from markets and add to Especiais tab
      const specialKeys = Object.keys(markets || {}).filter(k => k.startsWith('special_') && !seenKeys.has(k) && hasMarketData(k));
      if (specialKeys.length > 0) {
        specialKeys.forEach(k => seenKeys.add(k));
        const especiaisGroup = staticGroups.find(g => g.title === 'Especiais' || g.title === 'Mercados Especiais');
        if (especiaisGroup) {
          (especiaisGroup.keys as string[]).push(...specialKeys);
        } else {
          staticGroups.push({ title: 'Especiais', keys: specialKeys });
        }
      }
      return staticGroups;
  }, [event?.sport, markets, eventOdds]);

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

            const content = (group.keys as string[])
              .map((k: string) => ({ key: k, node: renderMarketContent(k) }))
              .filter((x: { key: string; node: any }) => x.node !== null);
            
            if (content.length === 0) {
                 return (
                     <div key={idx} className={`text-center py-8 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                         A carregar mercados...
                     </div>
                 );
            }

            return (
                <div key={idx} className="market-group animate-fadeIn">
                    <div className="space-y-4">
                        {content.map((c: { key: string; node: any }) => <div key={c.key}>{c.node}</div>)}
                    </div>
                </div>
            )
        })}
      </div>
    </div>
  )

}

export const MemoSubOddsModel = memo(SubOddsModel)
