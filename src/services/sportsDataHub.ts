import type { Match } from '../types/sports';
import type { ApiFootballMatch } from './apiFootballLive';
import { fetchLiveMatchesFromApiFootball, fetchUpcomingMatchesFromApiFootball } from './apiFootballLive';

function isLeagueBlocked(name: string): boolean {
  const n = name.toLowerCase();

  const femaleKeywords = ['women', 'feminino', 'feminina', 'feminine', 'womens'];
  if (femaleKeywords.some((k) => n.includes(k))) return true;

  const youthKeywords = [
    'u17',
    'u18',
    'u19',
    'u20',
    'u21',
    'u23',
    'youth',
    'junior',
    'júnior',
    'juniors',
    'sub-17',
    'sub-18',
    'sub-19',
    'sub-20',
    'sub-21',
    'sub-23',
  ];
  if (youthKeywords.some((k) => n.includes(k))) return true;

  const reserveKeywords = ['reserve', 'reserves', 'b team', 'b-team', 'ii', 'iii'];
  if (reserveKeywords.some((k) => n.includes(k))) return true;

  const friendlyKeywords = ['friendly', 'amistoso', 'club friendlies', 'friendlies'];
  if (friendlyKeywords.some((k) => n.includes(k))) return true;

  return false;
}

const LIVE_CACHE_TTL = 10 * 1000;
const UPCOMING_CACHE_TTL = 2 * 60 * 1000;
const MATCH_DETAILS_CACHE_TTL = 10 * 60 * 1000;
const cache = new Map<string, { data: any; timestamp: number }>();

function getCached(key: string, ttl: number) {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.timestamp < ttl) {
    return cached.data;
  }
  return null;
}

function setCache(key: string, data: any) {
  cache.set(key, { data, timestamp: Date.now() });
}

function mapApiFootballMatchToNormalized(match: ApiFootballMatch): Match {
  return {
    id: match.id,
    fixtureId: match.fixtureId,
    sport: match.sport,
    league: match.league,
    country: match.country,
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    homeScore: match.homeScore ?? undefined,
    awayScore: match.awayScore ?? undefined,
    status: match.status,
    statusShort: match.statusShort,
    startTime: match.startTime,
    time: match.time,
    elapsed: match.elapsed ?? undefined,
    isLive: match.isLive,
    homeTeamLogo: match.homeTeamLogo,
    awayTeamLogo: match.awayTeamLogo,
    leagueLogo: match.leagueLogo,
    countryFlag: match.countryFlag,
    venue: match.venue,
    odds: match.odds
      ? {
          home: match.odds.home,
          draw: match.odds.draw,
          away: match.odds.away,
        }
      : undefined,
  };
}

// ✅ Buscar jogos ao vivo - APENAS DADOS REAIS
export async function getLiveMatches(sportKey?: string): Promise<Match[]> {
  const cacheKey = `live-${sportKey || 'all'}`;
  const cached = getCached(cacheKey, LIVE_CACHE_TTL);
  if (cached) return cached;

  try {
    console.log('🔄 sportsDataHub: Buscando jogos ao vivo da API-Football...');
    const apiFootballMatches = await fetchLiveMatchesFromApiFootball();

    if (apiFootballMatches && apiFootballMatches.length > 0) {
      const filtered = apiFootballMatches.filter((m) => !isLeagueBlocked(m.league));
      const toUse =
        filtered.length > 0 ? filtered : apiFootballMatches;

      const normalized = toUse.map(mapApiFootballMatchToNormalized);
      console.log(
        `✅ sportsDataHub: ${normalized.length} jogos ao vivo recebidos da API-Football (filtrados=${filtered.length}, brutos=${apiFootballMatches.length})`,
      );
      setCache(cacheKey, normalized);
      return normalized;
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
  const cached = getCached(cacheKey, UPCOMING_CACHE_TTL);
  if (cached) return cached;

  try {
    console.log('🔄 sportsDataHub: Buscando pré-jogos da API-Football...');
    const apiFootballMatches = await fetchUpcomingMatchesFromApiFootball(3);

    if (apiFootballMatches && apiFootballMatches.length > 0) {
      const filtered = apiFootballMatches.filter((m) => !isLeagueBlocked(m.league));
      const toUse =
        filtered.length > 0 ? filtered : apiFootballMatches;

      const normalized = toUse.map(mapApiFootballMatchToNormalized);
      console.log(
        `✅ sportsDataHub: ${normalized.length} pré-jogos recebidos da API-Football (filtrados=${filtered.length}, brutos=${apiFootballMatches.length})`,
      );
      setCache(cacheKey, normalized);
      return normalized;
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
  const cached = getCached(cacheKey, MATCH_DETAILS_CACHE_TTL);
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
