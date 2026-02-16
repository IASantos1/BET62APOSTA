/**
 * ============================================
 * API-FOOTBALL LIVE SERVICE
 * ============================================
 * Serviço para buscar jogos REAIS da API-Football
 * com IDs numéricos válidos para integração completa
 */

import { apiFootballRequest } from '../lib/api';

// ============================================
// TIPOS
// ============================================

export interface ApiFootballMatch {
  id: string;
  fixtureId: number; // ID numérico real da API-Football
  sport: string;
  league: string;
  leagueLogo?: string;
  country: string;
  countryFlag?: string;
  homeTeam: string;
  homeTeamLogo?: string;
  awayTeam: string;
  awayTeamLogo?: string;
  homeScore: number | null;
  awayScore: number | null;
  status: string;
  statusShort: string;
  time: string;
  elapsed: number | null;
  startTime: string;
  isLive: boolean;
  venue?: string;
  odds?: {
    home: number;
    draw?: number;
    away: number;
  };
}

// ============================================
// CACHE
// ============================================

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const cache: {
  liveMatches?: CacheEntry<ApiFootballMatch[]>;
  upcomingMatches?: CacheEntry<ApiFootballMatch[]>;
} = {};

const LIVE_CACHE_TTL = 30 * 1000; // 30 segundos
const UPCOMING_CACHE_TTL = 5 * 60 * 1000; // 5 minutos

// ============================================
// FUNÇÕES AUXILIARES
// ============================================

/**
 * Mapeia status da API-Football para português
 */
function mapStatus(status: string, elapsed: number | null): string {
  const statusMap: Record<string, string> = {
    'TBD': 'A Definir',
    'NS': 'Não Iniciado',
    '1H': `1ª Parte ${elapsed ? elapsed + "'" : ''}`,
    'HT': 'Intervalo',
    '2H': `2ª Parte ${elapsed ? elapsed + "'" : ''}`,
    'ET': 'Prolongamento',
    'BT': 'Intervalo Prol.',
    'P': 'Penáltis',
    'SUSP': 'Suspenso',
    'INT': 'Interrompido',
    'FT': 'Terminado',
    'AET': 'Após Prol.',
    'PEN': 'Após Penáltis',
    'PST': 'Adiado',
    'CANC': 'Cancelado',
    'ABD': 'Abandonado',
    'AWD': 'Vitória Técnica',
    'WO': 'W.O.',
    'LIVE': 'AO VIVO',
  };
  
  return statusMap[status] || status;
}

/**
 * Verifica se o jogo está ao vivo
 */
function isMatchLive(status: string): boolean {
  const liveStatuses = ['1H', '2H', 'HT', 'ET', 'BT', 'P', 'LIVE'];
  return liveStatuses.includes(status);
}

/**
 * Formata o tempo do jogo
 */
function formatMatchTime(status: string, elapsed: number | null, date: string): string {
  if (isMatchLive(status)) {
    if (status === 'HT') return 'INT';
    if (status === 'BT') return 'INT';
    if (elapsed) return `${elapsed}'`;
    return 'AO VIVO';
  }
  
  if (status === 'FT' || status === 'AET' || status === 'PEN') {
    return 'FIM';
  }
  
  // Jogo não iniciado - mostrar horário
  const matchDate = new Date(date);
  const hours = String(matchDate.getHours()).padStart(2, '0');
  const minutes = String(matchDate.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * Converte fixture da API-Football para formato interno
 * ✅ CORRIGIDO: NÃO gera odds falsas - odds virão da The Odds API
 */
function convertApiFootballFixture(fixture: any): ApiFootballMatch | null {
  try {
    if (!fixture?.fixture?.id || !fixture?.teams?.home || !fixture?.teams?.away) {
      return null;
    }
    
    const fixtureId = fixture.fixture.id;
    const status = fixture.fixture.status.short;
    const elapsed = fixture.fixture.status.elapsed;
    const date = fixture.fixture.date;
    
    return {
      id: `${fixtureId}`,
      fixtureId: fixtureId,
      sport: 'Futebol',
      league: fixture.league.name,
      leagueLogo: fixture.league.logo,
      country: fixture.league.country,
      countryFlag: fixture.league.flag,
      homeTeam: fixture.teams.home.name,
      homeTeamLogo: fixture.teams.home.logo,
      awayTeam: fixture.teams.away.name,
      awayTeamLogo: fixture.teams.away.logo,
      homeScore: fixture.goals?.home ?? null,
      awayScore: fixture.goals?.away ?? null,
      status: mapStatus(status, elapsed),
      statusShort: status,
      time: formatMatchTime(status, elapsed, date),
      elapsed: elapsed,
      startTime: date,
      isLive: isMatchLive(status),
      venue: fixture.fixture.venue?.name,
      // ✅ ODDS NÃO SÃO GERADAS AQUI - Virão da The Odds API
      odds: undefined
    };
  } catch (error) {
    console.error('❌ Erro ao converter fixture:', error);
    return null;
  }
}

// ============================================
// FUNÇÕES PRINCIPAIS
// ============================================

/**
 * Busca jogos AO VIVO da API-Football
 */
export async function fetchLiveMatchesFromApiFootball(): Promise<ApiFootballMatch[]> {
  const now = Date.now();
  
  // Verificar cache
  if (cache.liveMatches && (now - cache.liveMatches.timestamp) < LIVE_CACHE_TTL) {
    console.log(`📦 [API-Football] Cache live: ${cache.liveMatches.data.length} jogos`);
    return cache.liveMatches.data;
  }
  
  try {
    console.log('🔴 [API-Football] Buscando jogos ao vivo...');
    
    // Endpoint para jogos ao vivo
    const response = await apiFootballRequest('fixtures?live=all');
    
    if (!response?.response || !Array.isArray(response.response)) {
      console.warn('⚠️ [API-Football] Resposta inválida para jogos ao vivo');
      return cache.liveMatches?.data || [];
    }
    
    const fixtures = response.response;
    console.log(`📊 [API-Football] ${fixtures.length} jogos ao vivo encontrados`);
    
    // Converter para formato interno
    const matches: ApiFootballMatch[] = [];
    
    for (const fixture of fixtures) {
      const match = convertApiFootballFixture(fixture);
      if (match) {
        matches.push(match);
      }
    }
    
    // Ordenar por liga e depois por horário
    matches.sort((a, b) => {
      if (a.league !== b.league) return a.league.localeCompare(b.league);
      return (a.elapsed || 0) - (b.elapsed || 0);
    });
    
    // Limitar a 60 jogos
    const limitedMatches = matches.slice(0, 60);
    
    // Atualizar cache
    cache.liveMatches = {
      data: limitedMatches,
      timestamp: now
    };
    
    console.log(`✅ [API-Football] ${limitedMatches.length} jogos ao vivo processados`);
    
    // Log de ligas
    const leagues = [...new Set(limitedMatches.map(m => m.league))];
    console.log(`📋 Ligas ao vivo: ${leagues.slice(0, 5).join(', ')}${leagues.length > 5 ? '...' : ''}`);
    
    return limitedMatches;
  } catch (error) {
    console.error('❌ [API-Football] Erro ao buscar jogos ao vivo:', error);
    return cache.liveMatches?.data || [];
  }
}

/**
 * Busca jogos FUTUROS da API-Football
 */
export async function fetchUpcomingMatchesFromApiFootball(days: number = 3): Promise<ApiFootballMatch[]> {
  const now = Date.now();
  
  // Verificar cache
  if (cache.upcomingMatches && (now - cache.upcomingMatches.timestamp) < UPCOMING_CACHE_TTL) {
    console.log(`📦 [API-Football] Cache upcoming: ${cache.upcomingMatches.data.length} jogos`);
    return cache.upcomingMatches.data;
  }
  
  try {
    console.log('📅 [API-Football] Buscando próximos jogos...');
    
    // Buscar jogos das principais ligas
    const topLeagues = [
      39,   // Premier League
      140,  // La Liga
      135,  // Serie A
      78,   // Bundesliga
      61,   // Ligue 1
      94,   // Primeira Liga (Portugal)
      2,    // Champions League
      3,    // Europa League
      71,   // Brasileirão
    ];
    
    const allMatches: ApiFootballMatch[] = [];
    
    // Buscar jogos de cada liga
    for (const leagueId of topLeagues.slice(0, 5)) { // Limitar a 5 ligas para não exceder rate limit
      try {
        const response = await apiFootballRequest(`fixtures?league=${leagueId}&next=${days * 5}`);
        
        if (response?.response && Array.isArray(response.response)) {
          for (const fixture of response.response) {
            const match = convertApiFootballFixture(fixture);
            if (match && !match.isLive) {
              allMatches.push(match);
            }
          }
        }
        
        // Pequeno delay entre requisições
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (err) {
        console.warn(`⚠️ Erro ao buscar liga ${leagueId}:`, err);
      }
    }
    
    // Ordenar por data
    allMatches.sort((a, b) => {
      return new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
    });
    
    // Limitar a 60 jogos
    const limitedMatches = allMatches.slice(0, 60);
    
    // Atualizar cache
    cache.upcomingMatches = {
      data: limitedMatches,
      timestamp: now
    };
    
    console.log(`✅ [API-Football] ${limitedMatches.length} próximos jogos processados`);
    
    return limitedMatches;
  } catch (error) {
    console.error('❌ [API-Football] Erro ao buscar próximos jogos:', error);
    return cache.upcomingMatches?.data || [];
  }
}

/**
 * Busca detalhes de um jogo específico
 */
export async function fetchMatchDetails(fixtureId: number): Promise<ApiFootballMatch | null> {
  try {
    console.log(`🔍 [API-Football] Buscando detalhes do jogo ${fixtureId}...`);
    
    const response = await apiFootballRequest(`fixtures?id=${fixtureId}`);
    
    if (!response?.response?.[0]) {
      console.warn(`⚠️ [API-Football] Jogo ${fixtureId} não encontrado`);
      return null;
    }
    
    const match = convertApiFootballFixture(response.response[0]);
    
    if (match) {
      console.log(`✅ [API-Football] Detalhes carregados: ${match.homeTeam} vs ${match.awayTeam}`);
    }
    
    return match;
  } catch (error) {
    console.error(`❌ [API-Football] Erro ao buscar jogo ${fixtureId}:`, error);
    return null;
  }
}

/**
 * Busca eventos de um jogo (golos, cartões, etc.)
 */
export async function fetchMatchEvents(fixtureId: number): Promise<any[]> {
  try {
    console.log(`📋 [API-Football] Buscando eventos do jogo ${fixtureId}...`);
    
    const response = await apiFootballRequest(`fixtures/events?fixture=${fixtureId}`);
    
    if (!response?.response || !Array.isArray(response.response)) {
      return [];
    }
    
    console.log(`✅ [API-Football] ${response.response.length} eventos encontrados`);
    
    return response.response;
  } catch (error) {
    console.error(`❌ [API-Football] Erro ao buscar eventos do jogo ${fixtureId}:`, error);
    return [];
  }
}

/**
 * Busca estatísticas de um jogo
 */
export async function fetchMatchStatistics(fixtureId: number): Promise<any> {
  try {
    console.log(`📊 [API-Football] Buscando estatísticas do jogo ${fixtureId}...`);
    
    const response = await apiFootballRequest(`fixtures/statistics?fixture=${fixtureId}`);
    
    if (!response?.response || !Array.isArray(response.response)) {
      return null;
    }
    
    console.log(`✅ [API-Football] Estatísticas carregadas`);
    
    return response.response;
  } catch (error) {
    console.error(`❌ [API-Football] Erro ao buscar estatísticas do jogo ${fixtureId}:`, error);
    return null;
  }
}

/**
 * Limpa o cache
 */
export function clearApiFootballCache(): void {
  cache.liveMatches = undefined;
  cache.upcomingMatches = undefined;
  console.log('🗑️ [API-Football] Cache limpo');
}

/**
 * Obtém estatísticas do cache
 */
export function getApiFootballCacheStats() {
  return {
    liveMatches: cache.liveMatches ? {
      count: cache.liveMatches.data.length,
      age: Date.now() - cache.liveMatches.timestamp
    } : null,
    upcomingMatches: cache.upcomingMatches ? {
      count: cache.upcomingMatches.data.length,
      age: Date.now() - cache.upcomingMatches.timestamp
    } : null
  };
}

export default {
  fetchLiveMatchesFromApiFootball,
  fetchUpcomingMatchesFromApiFootball,
  fetchMatchDetails,
  fetchMatchEvents,
  fetchMatchStatistics,
  clearApiFootballCache,
  getApiFootballCacheStats
};
