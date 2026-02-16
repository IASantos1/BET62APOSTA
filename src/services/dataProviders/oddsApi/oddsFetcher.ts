/**
 * The Odds API - Odds Fetcher Service - VIA PROXY SUPABASE
 * ✅ TODAS as chamadas passam pelo backend
 * ❌ NENHUMA chamada direta à API externa
 */

import { apiCache } from '../../apiCache';
import { oddsApiRequest } from '../../../lib/api';

// ❌ REMOVIDO: API keys (agora no backend)

export interface Bookmaker {
  key: string;
  title: string;
  last_update: string;
  markets: Market[];
}

export interface Market {
  key: string;
  last_update: string;
  outcomes: Outcome[];
}

export interface Outcome {
  name: string;
  price: number;
  point?: number;
}

export interface OddsEvent {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: Bookmaker[];
}

/**
 * ✅ Busca odds de um desporto VIA PROXY
 */
export async function getSportOdds(
  sportKey: string,
  regions: string = 'eu',
  markets: string = 'h2h,spreads,totals'
): Promise<OddsEvent[]> {
  const cacheKey = `odds_${sportKey}_${regions}_${markets}`;
  
  try {
    const events = await apiCache.get<OddsEvent[]>(
      cacheKey,
      async () => {
        console.log(`💰 Buscando odds VIA PROXY: ${sportKey}...`);
        const fetched = await oddsApiRequest(`/sports/${sportKey}/odds`, {
          regions,
          markets,
          oddsFormat: 'decimal',
        });
        console.log(`✅ Proxy: ${fetched.length} eventos com odds encontrados`);
        return fetched;
      },
      120 * 1000
    );

    return events;
    
  } catch (error) {
    console.error(`❌ Erro ao buscar odds de ${sportKey} via proxy:`, error);
    return [];
  }
}

/**
 * ✅ Busca odds ao vivo VIA PROXY
 */
export async function getLiveOdds(
  sportKey: string,
  regions: string = 'eu',
  markets: string = 'h2h'
): Promise<OddsEvent[]> {
  const cacheKey = `live_odds_${sportKey}_${regions}_${markets}`;
  
  try {
    const events = await apiCache.get<OddsEvent[]>(
      cacheKey,
      async () => {
        console.log(`🔴 Buscando odds ao vivo VIA PROXY: ${sportKey}...`);
        const fetched = await oddsApiRequest(`/sports/${sportKey}/odds`, {
          regions,
          markets,
          oddsFormat: 'decimal',
          eventIds: 'live',
        });
        console.log(`✅ Proxy: ${fetched.length} eventos ao vivo com odds`);
        return fetched;
      },
      30 * 1000,
      { isLive: true }
    );

    return events;
    
  } catch (error) {
    console.error(`❌ Erro ao buscar odds ao vivo de ${sportKey} via proxy:`, error);
    return [];
  }
}

/**
 * Extrai odds médias de Match Winner (H2H)
 */
export interface AverageH2HOdds {
  home: number;
  draw: number | null;
  away: number;
  bookmakerCount: number;
}

export function calculateAverageH2H(event: OddsEvent): AverageH2HOdds | null {
  const h2hMarkets = event.bookmakers
    .map(b => b.markets.find(m => m.key === 'h2h'))
    .filter(m => m !== undefined) as Market[];
  
  if (h2hMarkets.length === 0) return null;
  
  let homeSum = 0;
  let drawSum = 0;
  let awaySum = 0;
  let drawCount = 0;
  
  for (const market of h2hMarkets) {
    const homeOutcome = market.outcomes.find(o => o.name === event.home_team);
    const awayOutcome = market.outcomes.find(o => o.name === event.away_team);
    const drawOutcome = market.outcomes.find(o => o.name === 'Draw');
    
    if (homeOutcome) homeSum += homeOutcome.price;
    if (awayOutcome) awaySum += awayOutcome.price;
    if (drawOutcome) {
      drawSum += drawOutcome.price;
      drawCount++;
    }
  }
  
  const count = h2hMarkets.length;
  
  return {
    home: parseFloat((homeSum / count).toFixed(2)),
    draw: drawCount > 0 ? parseFloat((drawSum / drawCount).toFixed(2)) : null,
    away: parseFloat((awaySum / count).toFixed(2)),
    bookmakerCount: count
  };
}

/**
 * Extrai odds médias de Over/Under (Totals)
 */
export interface AverageTotalsOdds {
  line: number;
  over: number;
  under: number;
  bookmakerCount: number;
}

export function calculateAverageTotals(
  event: OddsEvent,
  targetLine?: number
): AverageTotalsOdds | null {
  const totalsMarkets = event.bookmakers
    .map(b => b.markets.find(m => m.key === 'totals'))
    .filter(m => m !== undefined) as Market[];
  
  if (totalsMarkets.length === 0) return null;
  
  const lineGroups: { [line: number]: { over: number[]; under: number[] } } = {};
  
  for (const market of totalsMarkets) {
    for (const outcome of market.outcomes) {
      if (outcome.point === undefined) continue;
      
      const line = outcome.point;
      if (!lineGroups[line]) {
        lineGroups[line] = { over: [], under: [] };
      }
      
      if (outcome.name === 'Over') {
        lineGroups[line].over.push(outcome.price);
      } else if (outcome.name === 'Under') {
        lineGroups[line].under.push(outcome.price);
      }
    }
  }
  
  let selectedLine: number;
  if (targetLine !== undefined && lineGroups[targetLine]) {
    selectedLine = targetLine;
  } else {
    const lines = Object.keys(lineGroups).map(Number);
    if (lines.length === 0) return null;
    selectedLine = lines.sort((a, b) => 
      lineGroups[b].over.length - lineGroups[a].over.length
    )[0];
  }
  
  const group = lineGroups[selectedLine];
  if (group.over.length === 0 || group.under.length === 0) return null;
  
  const avgOver = group.over.reduce((sum, o) => sum + o, 0) / group.over.length;
  const avgUnder = group.under.reduce((sum, o) => sum + o, 0) / group.under.length;
  
  return {
    line: selectedLine,
    over: parseFloat(avgOver.toFixed(2)),
    under: parseFloat(avgUnder.toFixed(2)),
    bookmakerCount: Math.min(group.over.length, group.under.length)
  };
}

/**
 * Encontra melhor odd para um resultado específico
 */
export function findBestOdd(
  event: OddsEvent,
  marketKey: string,
  outcomeName: string
): { odd: number; bookmaker: string } | null {
  let bestOdd = 0;
  let bestBookmaker = '';
  
  for (const bookmaker of event.bookmakers) {
    const market = bookmaker.markets.find(m => m.key === marketKey);
    if (!market) continue;
    
    const outcome = market.outcomes.find(o => o.name === outcomeName);
    if (!outcome) continue;
    
    if (outcome.price > bestOdd) {
      bestOdd = outcome.price;
      bestBookmaker = bookmaker.title;
    }
  }
  
  return bestOdd > 0 ? { odd: bestOdd, bookmaker: bestBookmaker } : null;
}

/**
 * Compara odds de múltiplos bookmakers
 */
export interface OddsComparison {
  marketKey: string;
  outcomes: {
    name: string;
    min: number;
    max: number;
    avg: number;
    spread: number;
  }[];
}

export function compareBookmakerOdds(event: OddsEvent, marketKey: string): OddsComparison | null {
  const markets = event.bookmakers
    .map(b => b.markets.find(m => m.key === marketKey))
    .filter(m => m !== undefined) as Market[];
  
  if (markets.length === 0) return null;
  
  const outcomeGroups: { [name: string]: number[] } = {};
  
  for (const market of markets) {
    for (const outcome of market.outcomes) {
      if (!outcomeGroups[outcome.name]) {
        outcomeGroups[outcome.name] = [];
      }
      outcomeGroups[outcome.name].push(outcome.price);
    }
  }
  
  const outcomes = Object.entries(outcomeGroups).map(([name, prices]) => {
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const avg = prices.reduce((sum, p) => sum + p, 0) / prices.length;
    
    return {
      name,
      min: parseFloat(min.toFixed(2)),
      max: parseFloat(max.toFixed(2)),
      avg: parseFloat(avg.toFixed(2)),
      spread: parseFloat((max - min).toFixed(2))
    };
  });
  
  return {
    marketKey,
    outcomes
  };
}

export async function fetchOddsForMatch(
  homeTeamName: string,
  awayTeamName: string,
  sportKey: string
): Promise<OddsEvent[]> {
  try {
    const events = await getSportOdds(sportKey);
    const normalizedHome = homeTeamName.toLowerCase();
    const normalizedAway = awayTeamName.toLowerCase();

    return events.filter((event) => {
      const home = event.home_team.toLowerCase();
      const away = event.away_team.toLowerCase();
      return home === normalizedHome && away === normalizedAway;
    });
  } catch (error) {
    console.error('❌ Erro em fetchOddsForMatch:', error);
    return [];
  }
}
