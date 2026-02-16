/**
 * API-Football Odds Service - VIA PROXY SUPABASE
 * ✅ TODAS as chamadas passam pelo backend
 * ❌ NENHUMA chamada direta à API externa
 */

import { apiFootballRequest } from '../lib/api';

// ❌ REMOVIDO: API keys e headers (agora no backend)
// ❌ REMOVIDO: Chamadas diretas com fetch()

// ═══════════════════════════════════════════════════════════
// TIPOS
// ═══════════════════════════════════════════════════════════

export interface ApiFootballOddsResponse {
  league: {
    id: number;
    name: string;
    country: string;
    logo: string;
    season: number;
  };
  fixture: {
    id: number;
    timezone: string;
    date: string;
    timestamp: number;
  };
  update: string;
  bookmakers: ApiFootballBookmaker[];
}

export interface ApiFootballBookmaker {
  id: number;
  name: string;
  bets: ApiFootballBet[];
}

export interface ApiFootballBet {
  id: number;
  name: string;
  values: ApiFootballOddValue[];
}

export interface ApiFootballOddValue {
  value: string;
  odd: string;
}

export interface SpecialMarket {
  type: string;
  name: string;
  category?: string;
  outcomes: Array<{
    name: string;
    odds: number;
    description?: string;
  }>;
}

// ═══════════════════════════════════════════════════════════
// CACHE
// ═══════════════════════════════════════════════════════════

const oddsCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 60000; // 1 minuto

function getCached<T>(key: string): T | null {
  const cached = oddsCache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data as T;
  }
  return null;
}

function setCache<T>(key: string, data: T): void {
  oddsCache.set(key, { data, timestamp: Date.now() });
}

// ═══════════════════════════════════════════════════════════
// MAPEAMENTO DE MERCADOS API-FOOTBALL (EXPANDIDO)
// ═══════════════════════════════════════════════════════════

export const API_FOOTBALL_MARKETS = {
  MATCH_WINNER: 1,
  HOME_AWAY: 2,
  DOUBLE_CHANCE: 12,
  FIRST_HALF_WINNER: 13,
  SECOND_HALF_WINNER: 14,
  EXACT_SCORE: 8,
  CORRECT_SCORE_FIRST_HALF: 15,
  HALFTIME_FULLTIME: 9,
  ODD_EVEN: 11,
  FIRST_GOAL: 26,
  LAST_GOAL: 27,
  BOTH_TEAMS_SCORE: 8,
  GOALS_OVER_UNDER: 5,
  GOALS_OVER_UNDER_FIRST_HALF: 6,
  GOALS_OVER_UNDER_SECOND_HALF: 7,
  CORNERS_OVER_UNDER: 45,
  CORNERS_HOME_OVER_UNDER: 46,
  CORNERS_AWAY_OVER_UNDER: 47,
  CORNERS_HANDICAP: 48,
  CORNERS_1X2: 49,
  CORNERS_ODD_EVEN: 50,
  CORNERS_FIRST_HALF: 51,
  CORNERS_RACE_TO: 52,
  CARDS_OVER_UNDER: 53,
  CARDS_HOME_OVER_UNDER: 54,
  CARDS_AWAY_OVER_UNDER: 55,
  CARDS_1X2: 56,
  RED_CARD: 57,
  CARDS_FIRST_HALF: 58,
  PLAYER_BOOKED: 59,
  HOME_TEAM_GOALS_OVER_UNDER: 60,
  AWAY_TEAM_GOALS_OVER_UNDER: 61,
  HOME_TEAM_EXACT_GOALS: 18,
  AWAY_TEAM_EXACT_GOALS: 19,
  HOME_TEAM_SCORE_A_GOAL: 30,
  AWAY_TEAM_SCORE_A_GOAL: 31,
  HOME_TEAM_CLEAN_SHEET: 35,
  AWAY_TEAM_CLEAN_SHEET: 36,
  HOME_WIN_TO_NIL: 37,
  AWAY_WIN_TO_NIL: 38,
  FIRST_GOAL_TIME: 62,
  LAST_GOAL_TIME: 63,
  GOAL_IN_BOTH_HALVES: 64,
  WINNING_MARGIN: 28,
  MULTI_GOALS: 29,
  TEAM_TO_SCORE_FIRST: 26,
  TEAM_TO_SCORE_LAST: 27,
  HIGHEST_SCORING_HALF: 65,
  BOTH_TEAMS_SCORE_FIRST_HALF: 16,
  BOTH_TEAMS_SCORE_SECOND_HALF: 17,
  EXACT_GOALS: 10,
  RESULT_AND_BTTS: 66,
  RESULT_AND_OVER_UNDER: 67,
  DOUBLE_CHANCE_AND_BTTS: 68,
  DOUBLE_CHANCE_AND_OVER_UNDER: 69,
  ASIAN_HANDICAP: 3,
  GOAL_LINE: 4,
};

export const SPECIAL_MARKETS_TO_FETCH = [
  API_FOOTBALL_MARKETS.EXACT_SCORE,
  API_FOOTBALL_MARKETS.HALFTIME_FULLTIME,
  API_FOOTBALL_MARKETS.FIRST_HALF_WINNER,
  API_FOOTBALL_MARKETS.SECOND_HALF_WINNER,
  API_FOOTBALL_MARKETS.DOUBLE_CHANCE,
  API_FOOTBALL_MARKETS.CORRECT_SCORE_FIRST_HALF,
  API_FOOTBALL_MARKETS.ODD_EVEN,
  API_FOOTBALL_MARKETS.FIRST_GOAL,
  API_FOOTBALL_MARKETS.LAST_GOAL,
  API_FOOTBALL_MARKETS.GOALS_OVER_UNDER_FIRST_HALF,
  API_FOOTBALL_MARKETS.GOALS_OVER_UNDER_SECOND_HALF,
  API_FOOTBALL_MARKETS.BOTH_TEAMS_SCORE_FIRST_HALF,
  API_FOOTBALL_MARKETS.BOTH_TEAMS_SCORE_SECOND_HALF,
  API_FOOTBALL_MARKETS.WINNING_MARGIN,
  API_FOOTBALL_MARKETS.MULTI_GOALS,
  API_FOOTBALL_MARKETS.HOME_TEAM_EXACT_GOALS,
  API_FOOTBALL_MARKETS.AWAY_TEAM_EXACT_GOALS,
  API_FOOTBALL_MARKETS.HOME_TEAM_GOALS_OVER_UNDER,
  API_FOOTBALL_MARKETS.AWAY_TEAM_GOALS_OVER_UNDER,
  API_FOOTBALL_MARKETS.GOAL_IN_BOTH_HALVES,
  API_FOOTBALL_MARKETS.HIGHEST_SCORING_HALF,
  API_FOOTBALL_MARKETS.HOME_TEAM_CLEAN_SHEET,
  API_FOOTBALL_MARKETS.AWAY_TEAM_CLEAN_SHEET,
  API_FOOTBALL_MARKETS.HOME_WIN_TO_NIL,
  API_FOOTBALL_MARKETS.AWAY_WIN_TO_NIL,
  API_FOOTBALL_MARKETS.CORNERS_OVER_UNDER,
  API_FOOTBALL_MARKETS.CORNERS_HOME_OVER_UNDER,
  API_FOOTBALL_MARKETS.CORNERS_AWAY_OVER_UNDER,
  API_FOOTBALL_MARKETS.CORNERS_HANDICAP,
  API_FOOTBALL_MARKETS.CORNERS_1X2,
  API_FOOTBALL_MARKETS.CORNERS_ODD_EVEN,
  API_FOOTBALL_MARKETS.CORNERS_FIRST_HALF,
  API_FOOTBALL_MARKETS.CARDS_OVER_UNDER,
  API_FOOTBALL_MARKETS.CARDS_HOME_OVER_UNDER,
  API_FOOTBALL_MARKETS.CARDS_AWAY_OVER_UNDER,
  API_FOOTBALL_MARKETS.CARDS_1X2,
  API_FOOTBALL_MARKETS.RED_CARD,
  API_FOOTBALL_MARKETS.CARDS_FIRST_HALF,
  API_FOOTBALL_MARKETS.RESULT_AND_BTTS,
  API_FOOTBALL_MARKETS.RESULT_AND_OVER_UNDER,
  API_FOOTBALL_MARKETS.DOUBLE_CHANCE_AND_BTTS,
];

// ═══════════════════════════════════════════════════════════
// FUNÇÕES DE FETCH VIA PROXY
// ═══════════════════════════════════════════════════════════

/**
 * ✅ Busca odds VIA PROXY SUPABASE
 */
export async function fetchApiFootballOdds(
  fixtureId: number
): Promise<ApiFootballOddsResponse[] | null> {
  const cacheKey = `apifootball_odds_${fixtureId}`;
  const cached = getCached<ApiFootballOddsResponse[]>(cacheKey);
  if (cached) return cached;

  try {
    console.log(`🎰 API-Football: Buscando odds para fixture ${fixtureId} VIA PROXY...`);

    // ✅ USA PROXY SUPABASE
    const data = await apiFootballRequest(`/odds?fixture=${fixtureId}`, 'football');

    if (data.response && data.response.length > 0) {
      setCache(cacheKey, data.response);
      console.log(`✅ Proxy: ${data.response.length} bookmakers com odds encontrados`);
      return data.response;
    }

    return null;
  } catch (error) {
    console.error('❌ Erro ao buscar odds via proxy:', error);
    return null;
  }
}

/**
 * ✅ Busca odds de mercados específicos VIA PROXY
 */
export async function fetchSpecificMarketOdds(
  fixtureId: number,
  betId: number
): Promise<ApiFootballBet | null> {
  const cacheKey = `apifootball_market_${fixtureId}_${betId}`;
  const cached = getCached<ApiFootballBet>(cacheKey);
  if (cached) return cached;

  try {
    // ✅ USA PROXY SUPABASE
    const data = await apiFootballRequest(`/odds?fixture=${fixtureId}&bet=${betId}`, 'football');

    if (data.response?.[0]?.bookmakers?.[0]?.bets?.[0]) {
      const bet = data.response[0].bookmakers[0].bets[0];
      setCache(cacheKey, bet);
      return bet;
    }

    return null;
  } catch (error) {
    console.error(`❌ Erro ao buscar mercado ${betId} via proxy:`, error);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════
// NORMALIZAÇÃO DE MERCADOS ESPECIAIS
// ═══════════════════════════════════════════════════════════

function normalizeApiFootballMarket(bet: ApiFootballBet): SpecialMarket {
  const name = bet.name.toLowerCase();
  let category = 'especiais';
  
  if (name.includes('corner') || name.includes('canto')) {
    category = 'cantos';
  } else if (name.includes('card') || name.includes('cartão') || name.includes('cartao')) {
    category = 'cartoes';
  } else if (name.includes('goal') || name.includes('gol') || name.includes('score') || name.includes('btts')) {
    category = 'golos';
  } else if (name.includes('half') || name.includes('parte') || name.includes('intervalo')) {
    category = 'intervalos';
  } else if (name.includes('result') || name.includes('winner') || name.includes('chance')) {
    category = 'resultado';
  }

  return {
    type: bet.name.toLowerCase().replace(/\s+/g, '_').replace(/[/\\]/g, '_'),
    name: bet.name,
    category,
    outcomes: bet.values
      .map((v) => ({
        name: v.value,
        odds: parseFloat(v.odd),
        description: v.value,
      }))
      .filter((o) => !isNaN(o.odds) && o.odds > 1),
  };
}

function isInterestingMarket(marketName: string): boolean {
  const interestingKeywords = [
    'exact score', 'correct score', 'halftime', 'half time', 'first half', 'second half',
    'double chance', 'draw no bet', 'winner',
    'odd/even', 'odd even', 'first goal', 'last goal', 'both teams', 'btts',
    'over', 'under', 'total goals', 'goals', 'score', 'multi goal',
    'clean sheet', 'win to nil', 'margin', 'highest scoring',
    'corners', 'corner', 'canto', 'cantos',
    'cards', 'card', 'cartão', 'cartao', 'cartões', 'cartoes',
    'booking', 'booked', 'red card', 'yellow',
    'handicap', 'asian', 'spread',
    'result and', 'double chance and',
  ];

  const lowerName = marketName.toLowerCase();
  return interestingKeywords.some((keyword) => lowerName.includes(keyword.toLowerCase()));
}

/**
 * ✅ Busca e normaliza mercados especiais VIA PROXY
 */
export async function fetchSpecialMarkets(
  fixtureId: number
): Promise<SpecialMarket[]> {
  const cacheKey = `special_markets_${fixtureId}`;
  const cached = getCached<SpecialMarket[]>(cacheKey);
  if (cached) return cached;

  try {
    console.log(`🎯 Buscando mercados especiais para fixture ${fixtureId} VIA PROXY...`);

    const oddsData = await fetchApiFootballOdds(fixtureId);

    if (!oddsData || oddsData.length === 0) {
      console.log('⚠️ Nenhuma odd encontrada via proxy');
      return [];
    }

    const bookmaker = oddsData[0].bookmakers[0];
    if (!bookmaker) return [];

    const specialMarkets: SpecialMarket[] = [];

    for (const bet of bookmaker.bets) {
      const isSpecialMarket = SPECIAL_MARKETS_TO_FETCH.includes(bet.id);

      if (isSpecialMarket || isInterestingMarket(bet.name)) {
        const normalized = normalizeApiFootballMarket(bet);
        if (normalized.outcomes.length > 0) {
          specialMarkets.push(normalized);
        }
      }
    }

    console.log(`✅ ${specialMarkets.length} mercados especiais encontrados via proxy`);
    
    const byCategory = specialMarkets.reduce((acc, m) => {
      const cat = m.category || 'outros';
      acc[cat] = (acc[cat] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    console.log('📊 Mercados por categoria:', byCategory);
    
    setCache(cacheKey, specialMarkets);
    return specialMarkets;
  } catch (error) {
    console.error('❌ Erro ao buscar mercados especiais via proxy:', error);
    return [];
  }
}

// ═══════════════════════════════════════════════════════════
// MERCADOS ESPECÍFICOS FORMATADOS (EXPANDIDO)
// ═══════════════════════════════════════════════════════════

export interface FormattedSpecialMarkets {
  exactScore: SpecialMarket | null;
  exactScoreFirstHalf: SpecialMarket | null;
  halftimeFulltime: SpecialMarket | null;
  firstHalfWinner: SpecialMarket | null;
  secondHalfWinner: SpecialMarket | null;
  doubleChance: SpecialMarket | null;
  oddEven: SpecialMarket | null;
  firstGoal: SpecialMarket | null;
  lastGoal: SpecialMarket | null;
  firstHalfOverUnder: SpecialMarket | null;
  secondHalfOverUnder: SpecialMarket | null;
  bttsFirstHalf: SpecialMarket | null;
  bttsSecondHalf: SpecialMarket | null;
  winningMargin: SpecialMarket | null;
  multiGoals: SpecialMarket | null;
  homeTeamGoals: SpecialMarket | null;
  awayTeamGoals: SpecialMarket | null;
  homeTeamExactGoals: SpecialMarket | null;
  awayTeamExactGoals: SpecialMarket | null;
  goalInBothHalves: SpecialMarket | null;
  highestScoringHalf: SpecialMarket | null;
  cleanSheetHome: SpecialMarket | null;
  cleanSheetAway: SpecialMarket | null;
  winToNilHome: SpecialMarket | null;
  winToNilAway: SpecialMarket | null;
  cornersOverUnder: SpecialMarket | null;
  cornersHomeOverUnder: SpecialMarket | null;
  cornersAwayOverUnder: SpecialMarket | null;
  cornersHandicap: SpecialMarket | null;
  corners1X2: SpecialMarket | null;
  cornersOddEven: SpecialMarket | null;
  cornersFirstHalf: SpecialMarket | null;
  cardsOverUnder: SpecialMarket | null;
  cardsHomeOverUnder: SpecialMarket | null;
  cardsAwayOverUnder: SpecialMarket | null;
  cards1X2: SpecialMarket | null;
  redCard: SpecialMarket | null;
  cardsFirstHalf: SpecialMarket | null;
  resultAndBtts: SpecialMarket | null;
  resultAndOverUnder: SpecialMarket | null;
  doubleChanceAndBtts: SpecialMarket | null;
  allMarkets: SpecialMarket[];
}

/**
 * ✅ Busca e organiza mercados especiais em categorias VIA PROXY
 */
export async function fetchFormattedSpecialMarkets(
  fixtureId: number
): Promise<FormattedSpecialMarkets> {
  const markets = await fetchSpecialMarkets(fixtureId);

  const findMarket = (keywords: string[]): SpecialMarket | null => {
    return (
      markets.find((m) =>
        keywords.some((k) => m.name.toLowerCase().includes(k.toLowerCase()) || m.type.toLowerCase().includes(k.toLowerCase()))
      ) || null
    );
  };

  return {
    exactScore: findMarket(['exact score', 'correct score']),
    exactScoreFirstHalf: findMarket(['correct score first half', 'exact score 1st half']),
    halftimeFulltime: findMarket(['halftime/fulltime', 'ht/ft', 'halftime fulltime', 'half time / full time']),
    firstHalfWinner: findMarket(['first half winner', '1st half winner', 'first half result']),
    secondHalfWinner: findMarket(['second half winner', '2nd half winner', 'second half result']),
    doubleChance: findMarket(['double chance']),
    oddEven: findMarket(['odd/even', 'odd even', 'goals odd']),
    firstGoal: findMarket(['first goal', 'first team to score', 'team to score first']),
    lastGoal: findMarket(['last goal', 'last team to score', 'team to score last']),
    firstHalfOverUnder: findMarket(['first half over', '1st half over', 'first half goals', 'goals first half']),
    secondHalfOverUnder: findMarket(['second half over', '2nd half over', 'second half goals', 'goals second half']),
    bttsFirstHalf: findMarket(['both teams score first half', 'btts 1st half', 'btts first half']),
    bttsSecondHalf: findMarket(['both teams score second half', 'btts 2nd half', 'btts second half']),
    winningMargin: findMarket(['winning margin', 'margin of victory']),
    multiGoals: findMarket(['multi goal', 'multigoal', 'total goals range']),
    homeTeamGoals: findMarket(['home team goals', 'home goals over', 'home team over']),
    awayTeamGoals: findMarket(['away team goals', 'away goals over', 'away team over']),
    homeTeamExactGoals: findMarket(['home team exact goals', 'home exact goals', 'home team to score exactly']),
    awayTeamExactGoals: findMarket(['away team exact goals', 'away exact goals', 'away team to score exactly']),
    goalInBothHalves: findMarket(['goal in both halves', 'goals in both halves', 'score in both halves']),
    highestScoringHalf: findMarket(['highest scoring half', 'most goals half']),
    cleanSheetHome: findMarket(['clean sheet home', 'home clean sheet', 'home team clean sheet']),
    cleanSheetAway: findMarket(['clean sheet away', 'away clean sheet', 'away team clean sheet']),
    winToNilHome: findMarket(['win to nil home', 'home win to nil', 'home team win to nil']),
    winToNilAway: findMarket(['win to nil away', 'away win to nil', 'away team win to nil']),
    cornersOverUnder: findMarket(['corners over', 'total corners', 'corners total']),
    cornersHomeOverUnder: findMarket(['home corners', 'home team corners', 'corners home']),
    cornersAwayOverUnder: findMarket(['away corners', 'away team corners', 'corners away']),
    cornersHandicap: findMarket(['corners handicap', 'corner handicap', 'asian corners']),
    corners1X2: findMarket(['most corners', 'corners match bet', 'corners 1x2', 'corner match']),
    cornersOddEven: findMarket(['corners odd', 'corners even', 'total corners odd']),
    cornersFirstHalf: findMarket(['corners first half', '1st half corners', 'first half corners']),
    cardsOverUnder: findMarket(['cards over', 'total cards', 'booking points', 'cards total']),
    cardsHomeOverUnder: findMarket(['home cards', 'home team cards', 'cards home']),
    cardsAwayOverUnder: findMarket(['away cards', 'away team cards', 'cards away']),
    cards1X2: findMarket(['most cards', 'cards match bet', 'cards 1x2', 'card match']),
    redCard: findMarket(['red card', 'player sent off', 'sending off']),
    cardsFirstHalf: findMarket(['cards first half', '1st half cards', 'first half cards']),
    resultAndBtts: findMarket(['result and both teams', 'result & btts', 'match result and btts']),
    resultAndOverUnder: findMarket(['result and over', 'result & over', 'match result and total']),
    doubleChanceAndBtts: findMarket(['double chance and both', 'double chance & btts']),
    allMarkets: markets,
  };
}

export default {
  fetchApiFootballOdds,
  fetchSpecificMarketOdds,
  fetchSpecialMarkets,
  fetchFormattedSpecialMarkets,
  API_FOOTBALL_MARKETS,
  SPECIAL_MARKETS_TO_FETCH,
};
