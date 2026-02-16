import type { Match } from '../types/sports';
import { getLiveMatches as getApiLiveMatches, getUpcomingMatches as getApiUpcomingMatches } from './sportsDataNormalizer';

// Cache local com TTL
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos
const cache = new Map<string, { data: any; timestamp: number }>();

function getCached(key: string) {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  return null;
}

function setCache(key: string, data: any) {
  cache.set(key, { data, timestamp: Date.now() });
}

// ✅ Buscar jogos ao vivo - APENAS DADOS REAIS
export async function getLiveMatches(sportKey?: string): Promise<Match[]> {
  const cacheKey = `live-${sportKey || 'all'}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  try {
    console.log('🔄 sportsDataHub: Buscando jogos ao vivo da API real...');
    const apiMatches = await getApiLiveMatches();
    
    if (apiMatches && apiMatches.length > 0) {
      console.log(`✅ sportsDataHub: ${apiMatches.length} jogos ao vivo recebidos da API real`);
      setCache(cacheKey, apiMatches);
      return apiMatches;
    }
    
    console.warn('⚠️ sportsDataHub: Nenhum jogo ao vivo disponível no momento');
    return [];
  } catch (error) {
    console.error('❌ sportsDataHub: Erro ao buscar jogos ao vivo da API:', error);
    return [];
  }
}

// ✅ Buscar pré-jogos - APENAS DADOS REAIS
export async function getUpcomingMatches(sportKey?: string): Promise<Match[]> {
  const cacheKey = `upcoming-${sportKey || 'all'}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  try {
    console.log('🔄 sportsDataHub: Buscando pré-jogos da API real...');
    const apiMatches = await getApiUpcomingMatches();
    
    if (apiMatches && apiMatches.length > 0) {
      console.log(`✅ sportsDataHub: ${apiMatches.length} pré-jogos recebidos da API real`);
      setCache(cacheKey, apiMatches);
      return apiMatches;
    }
    
    console.warn('⚠️ sportsDataHub: Nenhum pré-jogo disponível no momento');
    return [];
  } catch (error) {
    console.error('❌ sportsDataHub: Erro ao buscar pré-jogos da API:', error);
    return [];
  }
}

// ✅ Buscar detalhes de um jogo específico
export async function getMatchDetails(matchId: string): Promise<Match | null> {
  const cacheKey = `match-details-${matchId}`;
  const cached = getCached(cacheKey);
  if (cached) {
    console.log(`✅ Cache: Detalhes do jogo ${matchId}`);
    return cached;
  }

  try {
    console.log(`🔍 Buscando detalhes do jogo ${matchId}...`);
    
    // Buscar em jogos ao vivo
    const liveMatches = await getLiveMatches();
    const liveMatch = liveMatches.find(m => String(m.id) === matchId);
    
    if (liveMatch) {
      console.log(`✅ Jogo encontrado nos jogos ao vivo: ${liveMatch.homeTeam} vs ${liveMatch.awayTeam}`);
      setCache(cacheKey, liveMatch);
      return liveMatch;
    }
    
    // Buscar em pré-jogos
    const upcomingMatches = await getUpcomingMatches();
    const upcomingMatch = upcomingMatches.find(m => String(m.id) === matchId);
    
    if (upcomingMatch) {
      console.log(`✅ Jogo encontrado nos pré-jogos: ${upcomingMatch.homeTeam} vs ${upcomingMatch.awayTeam}`);
      setCache(cacheKey, upcomingMatch);
      return upcomingMatch;
    }
    
    console.warn(`⚠️ Jogo ${matchId} não encontrado`);
    return null;
  } catch (error) {
    console.error(`❌ Erro ao buscar detalhes do jogo ${matchId}:`, error);
    return null;
  }
}

// Buscar detalhes do jogo (sob demanda) - DEPRECATED
export async function fetchMatchDetails(matchId: string): Promise<any> {
  console.warn('⚠️ fetchMatchDetails está deprecated, use getMatchDetails');
  return getMatchDetails(matchId);
}

// Exportar como objeto para compatibilidade
export const sportsDataHub = {
  getLiveMatches,
  getUpcomingMatches,
  getMatchDetails,
  fetchMatchDetails
};
