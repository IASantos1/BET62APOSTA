/**
 * API Football - Odds Service - VIA PROXY SUPABASE
 * ✅ TODAS as chamadas passam pelo backend
 * ❌ NENHUMA chamada direta à API externa
 */

import { apiCache } from '../../apiCache';
import { apiFootballRequest } from '../../../lib/api';

// ❌ REMOVIDO: API keys e headers (agora no backend)

export interface BookmakerOdd {
  id: number;
  name: string;
  bets: {
    id: number;
    name: string;
    values: {
      value: string;
      odd: string;
    }[];
  }[];
}

export interface FixtureOdds {
  league: {
    id: number;
    name: string;
    country: string;
    logo: string;
    flag: string;
    season: number;
  };
  fixture: {
    id: number;
    timezone: string;
    date: string;
    timestamp: number;
  };
  update: string;
  bookmakers: BookmakerOdd[];
}

export interface OddsResponse {
  get: string;
  parameters: Record<string, string>;
  errors: any[];
  results: number;
  paging: {
    current: number;
    total: number;
  };
  response: FixtureOdds[];
}

/**
 * ✅ Busca odds de um fixture VIA PROXY
 */
export async function getFixtureOdds(fixtureId: number): Promise<FixtureOdds | null> {
  const cacheKey = `fixture_odds_${fixtureId}`;
  
  try {
    const odds = await apiCache.get<FixtureOdds | null>(
      cacheKey,
      async () => {
        console.log(`💰 Buscando odds do fixture ${fixtureId} VIA PROXY...`);

        // ✅ USA PROXY SUPABASE
        const data = await apiFootballRequest(`/odds?fixture=${fixtureId}`, 'football');

        if (data.errors && data.errors.length > 0) {
          console.error('❌ Erro API-Football Proxy:', data.errors);
          return null;
        }

        const fetched = data.response[0] || null;

        if (fetched) {
          console.log(`✅ Odds encontradas via proxy: ${fetched.bookmakers.length} bookmakers`);
        } else {
          console.log('⚠️ Nenhuma odd disponível para este fixture');
        }

        return fetched;
      },
      120 * 1000
    );

    return odds;
    
  } catch (error) {
    console.error(`❌ Erro ao buscar odds do fixture ${fixtureId} via proxy:`, error);
    return null;
  }
}

/**
 * Extrai odds de um bookmaker específico
 */
export function getBookmakerOdds(
  fixtureOdds: FixtureOdds,
  bookmakerName: string
): BookmakerOdd | null {
  return fixtureOdds.bookmakers.find(
    b => b.name.toLowerCase() === bookmakerName.toLowerCase()
  ) || null;
}

/**
 * Extrai odds de Match Winner (1X2)
 */
export interface MatchWinnerOdds {
  home: number;
  draw: number;
  away: number;
  bookmaker: string;
}

export function getMatchWinnerOdds(
  fixtureOdds: FixtureOdds,
  bookmakerName?: string
): MatchWinnerOdds | null {
  const bookmaker = bookmakerName 
    ? getBookmakerOdds(fixtureOdds, bookmakerName)
    : fixtureOdds.bookmakers[0];
  
  if (!bookmaker) return null;
  
  const matchWinnerBet = bookmaker.bets.find(
    bet => bet.name === 'Match Winner' || bet.id === 1
  );
  
  if (!matchWinnerBet || matchWinnerBet.values.length < 3) return null;
  
  return {
    home: parseFloat(matchWinnerBet.values.find(v => v.value === 'Home')?.odd || '0'),
    draw: parseFloat(matchWinnerBet.values.find(v => v.value === 'Draw')?.odd || '0'),
    away: parseFloat(matchWinnerBet.values.find(v => v.value === 'Away')?.odd || '0'),
    bookmaker: bookmaker.name
  };
}

/**
 * Extrai odds de Over/Under
 */
export interface OverUnderOdds {
  line: number;
  over: number;
  under: number;
  bookmaker: string;
}

export function getOverUnderOdds(
  fixtureOdds: FixtureOdds,
  line: number = 2.5,
  bookmakerName?: string
): OverUnderOdds | null {
  const bookmaker = bookmakerName 
    ? getBookmakerOdds(fixtureOdds, bookmakerName)
    : fixtureOdds.bookmakers[0];
  
  if (!bookmaker) return null;
  
  const overUnderBet = bookmaker.bets.find(
    bet => bet.name === 'Goals Over/Under' || bet.id === 5
  );
  
  if (!overUnderBet) return null;
  
  const lineStr = line.toString();
  const overValue = overUnderBet.values.find(v => v.value === `Over ${lineStr}`);
  const underValue = overUnderBet.values.find(v => v.value === `Under ${lineStr}`);
  
  if (!overValue || !underValue) return null;
  
  return {
    line,
    over: parseFloat(overValue.odd),
    under: parseFloat(underValue.odd),
    bookmaker: bookmaker.name
  };
}

/**
 * Calcula média de odds de múltiplos bookmakers
 */
export function calculateAverageOdds(fixtureOdds: FixtureOdds): MatchWinnerOdds | null {
  const allOdds: MatchWinnerOdds[] = [];
  
  for (const bookmaker of fixtureOdds.bookmakers) {
    const odds = getMatchWinnerOdds(fixtureOdds, bookmaker.name);
    if (odds) allOdds.push(odds);
  }
  
  if (allOdds.length === 0) return null;
  
  const avgHome = allOdds.reduce((sum, o) => sum + o.home, 0) / allOdds.length;
  const avgDraw = allOdds.reduce((sum, o) => sum + o.draw, 0) / allOdds.length;
  const avgAway = allOdds.reduce((sum, o) => sum + o.away, 0) / allOdds.length;
  
  return {
    home: parseFloat(avgHome.toFixed(2)),
    draw: parseFloat(avgDraw.toFixed(2)),
    away: parseFloat(avgAway.toFixed(2)),
    bookmaker: `Média de ${allOdds.length} bookmakers`
  };
}

/**
 * Lista todos os mercados disponíveis
 */
export function getAvailableMarkets(fixtureOdds: FixtureOdds): string[] {
  const markets = new Set<string>();
  
  for (const bookmaker of fixtureOdds.bookmakers) {
    for (const bet of bookmaker.bets) {
      markets.add(bet.name);
    }
  }
  
  return Array.from(markets).sort();
}
