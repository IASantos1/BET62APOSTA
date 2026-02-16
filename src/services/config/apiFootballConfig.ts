/**
 * Configuração centralizada da API-Football
 * Suporta todos os desportos disponíveis
 */

export type SportType = 
  | 'football' 
  | 'basketball' 
  | 'baseball' 
  | 'hockey' 
  | 'rugby' 
  | 'volleyball' 
  | 'formula1' 
  | 'mma' 
  | 'nfl' 
  | 'afl' 
  | 'handball';

/**
 * URLs base da API-Football por desporto
 */
export const API_FOOTBALL_ENDPOINTS: Record<SportType, string> = {
  football: "https://v3.football.api-sports.io",
  afl: "https://v1.afl.api-sports.io",
  baseball: "https://v1.baseball.api-sports.io",
  basketball: "https://v1.basketball.api-sports.io",
  formula1: "https://v1.formula-1.api-sports.io",
  handball: "https://v1.handball.api-sports.io",
  hockey: "https://v1.hockey.api-sports.io",
  mma: "https://v1.mma.api-sports.io",
  nfl: "https://v1.american-football.api-sports.io",
  rugby: "https://v1.rugby.api-sports.io",
  volleyball: "https://v1.volleyball.api-sports.io",
};

/**
 * Chave da API (obtida do .env)
 */
export const API_FOOTBALL_KEY = import.meta.env.VITE_API_FOOTBALL_KEY || '';

/**
 * Verifica se um desporto é suportado
 */
export function isSupportedSport(sport: string): sport is SportType {
  return sport in API_FOOTBALL_ENDPOINTS;
}

/**
 * Obtém a URL base para um desporto
 */
export function getBaseUrl(sport: SportType): string {
  return API_FOOTBALL_ENDPOINTS[sport];
}

/**
 * Endpoints comuns por desporto
 */
export const COMMON_ENDPOINTS = {
  // Futebol
  football: {
    fixtures: 'fixtures',
    odds: 'odds',
    statistics: 'fixtures/statistics',
    events: 'fixtures/events',
    lineups: 'fixtures/lineups',
    leagues: 'leagues',
    teams: 'teams',
    players: 'players',
  },
  
  // Basquetebol, Basebol, Hóquei, Rugby, Voleibol, NFL, Andebol
  generic: {
    games: 'games',
    leagues: 'leagues',
    teams: 'teams',
    statistics: 'games/statistics',
    standings: 'standings',
  },
  
  // Fórmula 1
  formula1: {
    races: 'races',
    rankings: 'rankings',
    circuits: 'circuits',
    teams: 'teams',
    drivers: 'drivers',
  },
  
  // MMA
  mma: {
    fights: 'fights',
    fighters: 'fighters',
    events: 'events',
  },
};

/**
 * Mapeamento de endpoints por desporto
 */
export function getEndpoint(sport: SportType, type: string): string {
  switch (sport) {
    case 'football':
      return COMMON_ENDPOINTS.football[type as keyof typeof COMMON_ENDPOINTS.football] || type;
    
    case 'formula1':
      return COMMON_ENDPOINTS.formula1[type as keyof typeof COMMON_ENDPOINTS.formula1] || type;
    
    case 'mma':
      return COMMON_ENDPOINTS.mma[type as keyof typeof COMMON_ENDPOINTS.mma] || type;
    
    default:
      return COMMON_ENDPOINTS.generic[type as keyof typeof COMMON_ENDPOINTS.generic] || type;
  }
}

export const API_FOOTBALL_BASE_URLS = {
  football: "https://v3.football.api-sports.io",
  basketball: "https://v1.basketball.api-sports.io",
  hockey: "https://v1.hockey.api-sports.io",
  baseball: "https://v1.baseball.api-sports.io",
  handball: "https://v1.handball.api-sports.io",
  volleyball: "https://v1.volleyball.api-sports.io",
  rugby: "https://v1.rugby.api-sports.io",
};
