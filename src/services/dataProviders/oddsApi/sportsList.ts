/**
 * The Odds API - Sports List Service - VIA PROXY SUPABASE
 * ✅ TODAS as chamadas passam pelo backend
 * ❌ NENHUMA chamada direta à API externa
 */

import { apiCache } from '../../apiCache';
import { oddsApiRequest } from '../../../lib/api';

// ❌ REMOVIDO: API keys (agora no backend)

export interface Sport {
  key: string;
  group: string;
  title: string;
  description: string;
  active: boolean;
  has_outrights: boolean;
}

export interface SportsResponse {
  sports: Sport[];
}

/**
 * ✅ Busca lista de desportos VIA PROXY
 */
export async function getSportsList(): Promise<Sport[]> {
  const cacheKey = 'odds_api_sports_list';
  
  try {
    const sports = await apiCache.get<Sport[]>(
      cacheKey,
      async () => {
        console.log('🔄 Buscando lista de desportos VIA PROXY...');
        const fetched = await oddsApiRequest('/sports', {});
        console.log(`✅ Proxy: ${fetched.length} desportos disponíveis`);
        return fetched;
      },
      24 * 60 * 60 * 1000
    );

    return sports;
    
  } catch (error) {
    console.error('❌ Erro ao buscar lista de desportos via proxy:', error);
    return [];
  }
}

/**
 * Busca apenas desportos ativos
 */
export async function getActiveSports(): Promise<Sport[]> {
  const allSports = await getSportsList();
  return allSports.filter(sport => sport.active);
}

/**
 * Busca desportos por grupo
 */
export async function getSportsByGroup(group: string): Promise<Sport[]> {
  const allSports = await getSportsList();
  return allSports.filter(
    sport => sport.group.toLowerCase() === group.toLowerCase()
  );
}

/**
 * Busca desporto específico por key
 */
export async function getSportByKey(sportKey: string): Promise<Sport | null> {
  const allSports = await getSportsList();
  return allSports.find(
    sport => sport.key.toLowerCase() === sportKey.toLowerCase()
  ) || null;
}

/**
 * Grupos de desportos disponíveis
 */
export const SPORT_GROUPS = {
  SOCCER: 'soccer',
  BASKETBALL: 'basketball',
  AMERICAN_FOOTBALL: 'americanfootball',
  BASEBALL: 'baseball',
  HOCKEY: 'icehockey',
  TENNIS: 'tennis',
  CRICKET: 'cricket',
  RUGBY: 'rugbyleague',
  GOLF: 'golf',
  MMA: 'mma',
  BOXING: 'boxing'
} as const;

/**
 * Desportos prioritários para o sistema
 */
export const PRIORITY_SPORTS = [
  'soccer_portugal_primeira_liga',
  'soccer_epl',
  'soccer_spain_la_liga',
  'soccer_germany_bundesliga',
  'soccer_italy_serie_a',
  'soccer_france_ligue_one',
  'soccer_uefa_champs_league',
  'soccer_uefa_europa_league',
  'basketball_nba',
  'icehockey_nhl',
  'americanfootball_nfl'
];

/**
 * Verifica se um desporto é prioritário
 */
export function isPrioritySport(sportKey: string): boolean {
  return PRIORITY_SPORTS.includes(sportKey);
}

/**
 * Mapeia sport key para nome amigável em português
 */
export function getSportDisplayName(sportKey: string): string {
  const mapping: Record<string, string> = {
    'soccer_portugal_primeira_liga': 'Primeira Liga',
    'soccer_epl': 'Premier League',
    'soccer_spain_la_liga': 'La Liga',
    'soccer_germany_bundesliga': 'Bundesliga',
    'soccer_italy_serie_a': 'Serie A',
    'soccer_france_ligue_one': 'Ligue 1',
    'soccer_uefa_champs_league': 'Champions League',
    'soccer_uefa_europa_league': 'Europa League',
    'basketball_nba': 'NBA',
    'icehockey_nhl': 'NHL',
    'americanfootball_nfl': 'NFL'
  };
  
  return mapping[sportKey] || sportKey.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

/**
 * Agrupa desportos por categoria
 */
export interface GroupedSports {
  [group: string]: Sport[];
}

export async function getGroupedSports(): Promise<GroupedSports> {
  const allSports = await getSportsList();
  const grouped: GroupedSports = {};
  
  for (const sport of allSports) {
    if (!grouped[sport.group]) {
      grouped[sport.group] = [];
    }
    grouped[sport.group].push(sport);
  }
  
  return grouped;
}
