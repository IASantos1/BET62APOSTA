
/**
 * Serviço genérico para API-Football - VIA PROXY SUPABASE
 * ✅ TODAS as chamadas passam pelo backend
 * ❌ NENHUMA chamada direta à API externa
 */

import { 
  SportType,
  isSupportedSport 
} from './config/apiFootballConfig';
import { apiFootballRequest } from '../lib/api';

// ❌ REMOVIDO: API keys (agora no backend)

/**
 * Interface de resposta da API-Football
 */
// Resposta tipada é tratada dinamicamente no consumidor

/**
 * Cache de requisições
 */
interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

const requestCache = new Map<string, CacheEntry<any>>();

function cleanExpiredCache(): void {
  const now = Date.now();
  for (const [key, entry] of requestCache.entries()) {
    if (now - entry.timestamp > entry.ttl) {
      requestCache.delete(key);
    }
  }
}

function getFromCache<T>(key: string): T | null {
  cleanExpiredCache();
  const entry = requestCache.get(key);
  if (!entry) return null;
  
  const now = Date.now();
  if (now - entry.timestamp > entry.ttl) {
    requestCache.delete(key);
    return null;
  }
  
  return entry.data;
}

function saveToCache<T>(key: string, data: T, ttl: number): void {
  requestCache.set(key, {
    data,
    timestamp: Date.now(),
    ttl
  });
}

/**
 * ✅ Faz requisição genérica VIA PROXY SUPABASE
 */
export async function fetchApiFootball<T = any>(
  sport: SportType,
  endpoint: string,
  params: Record<string, string> = {},
  cacheTTL: number = 30000
): Promise<T[]> {
  if (!isSupportedSport(sport)) {
    console.warn(`⚠️ Desporto não suportado: ${sport}`);
    return [];
  }

  const cacheKey = `${sport}-${endpoint}-${JSON.stringify(params)}`;
  
  const cached = getFromCache<T[]>(cacheKey);
  if (cached) {
    console.log(`📦 Cache hit: ${sport} → ${endpoint}`);
    return cached;
  }

  try {
    console.log(`📡 API-Football Proxy: ${sport} → ${endpoint}`, params);
    
    // ✅ Construir endpoint com parâmetros
    const queryString = new URLSearchParams(params).toString();
    const fullEndpoint = queryString ? `/${endpoint}?${queryString}` : `/${endpoint}`;
    
    // ✅ USA PROXY SUPABASE
    const data = await apiFootballRequest(fullEndpoint, sport);
    
    if (data.errors && Object.keys(data.errors).length > 0) {
      console.error(`❌ API-Football Proxy retornou erro (${sport}):`, data.errors);
      return [];
    }
    
    const results = data.response || [];
    console.log(`✅ API-Football Proxy ${sport}: ${results.length} resultados`);
    
    saveToCache(cacheKey, results, cacheTTL);
    
    return results;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    console.error(`❌ Erro ao chamar API-Football Proxy (${sport}):`, errorMessage);
    return [];
  }
}

/**
 * ✅ Busca jogos/fixtures ao vivo VIA PROXY
 */
export async function fetchLiveEvents<T = any>(
  sport: SportType,
  cacheTTL: number = 10000
): Promise<T[]> {
  let endpoint = '';
  let params: Record<string, string> = {};

  switch (sport) {
    case 'football':
      endpoint = 'fixtures';
      params = { live: 'all' };
      break;
    
    case 'formula1':
      endpoint = 'races';
      params = { 
        type: 'race', 
        season: new Date().getFullYear().toString() 
      };
      break;
    
    case 'mma':
      endpoint = 'fights';
      params = { live: 'all' };
      break;
    
    default:
      endpoint = 'games';
      params = { live: 'all' };
      break;
  }

  return fetchApiFootball<T>(sport, endpoint, params, cacheTTL);
}

/**
 * ✅ Busca jogos/fixtures futuros VIA PROXY
 */
export async function fetchUpcomingEvents<T = any>(
  sport: SportType,
  days: number = 7,
  cacheTTL: number = 300000
): Promise<T[]> {
  const today = new Date();
  const endDate = new Date();
  endDate.setDate(today.getDate() + days);

  let endpoint = '';
  let params: Record<string, string> = {};

  switch (sport) {
    case 'football':
      endpoint = 'fixtures';
      params = {
        from: today.toISOString().split('T')[0],
        to: endDate.toISOString().split('T')[0]
      };
      break;
    
    case 'formula1':
      endpoint = 'races';
      params = {
        season: new Date().getFullYear().toString(),
        type: 'race'
      };
      break;
    
    case 'mma':
      endpoint = 'fights';
      params = {
        date: today.toISOString().split('T')[0]
      };
      break;
    
    default:
      endpoint = 'games';
      params = {
        date: today.toISOString().split('T')[0],
        season: new Date().getFullYear().toString()
      };
      break;
  }

  return fetchApiFootball<T>(sport, endpoint, params, cacheTTL);
}

/**
 * ✅ Busca detalhes de um jogo VIA PROXY
 */
export async function fetchEventById<T = any>(
  sport: SportType,
  eventId: string,
  cacheTTL: number = 60000
): Promise<T | null> {
  let endpoint = '';
  const params: Record<string, string> = { id: eventId };

  switch (sport) {
    case 'football':
      endpoint = 'fixtures';
      break;
    
    case 'formula1':
      endpoint = 'races';
      break;
    
    case 'mma':
      endpoint = 'fights';
      break;
    
    default:
      endpoint = 'games';
      break;
  }

  const results = await fetchApiFootball<T>(sport, endpoint, params, cacheTTL);
  return results.length > 0 ? results[0] : null;
}

/**
 * ✅ Busca estatísticas VIA PROXY
 */
export async function fetchEventStatistics<T = any>(
  sport: SportType,
  eventId: string,
  cacheTTL: number = 30000
): Promise<T[]> {
  let endpoint = '';
  // Inicializar params como objeto vazio antes da lógica do switch
  let params: Record<string, string> = {};

  switch (sport) {
    case 'football':
      endpoint = 'fixtures/statistics';
      params = { fixture: eventId };
      break;
    
    default:
      endpoint = 'games/statistics';
      params = { id: eventId };
      break;
  }

  return fetchApiFootball<T>(sport, endpoint, params, cacheTTL);
}

/**
 * ✅ Busca odds VIA PROXY
 */
export async function fetchEventOdds<T = any>(
  sport: SportType,
  eventId: string,
  cacheTTL: number = 30000
): Promise<T[]> {
  if (sport !== 'football') {
    console.warn(`⚠️ Odds não disponíveis para ${sport} na API-Football`);
    return [];
  }

  return fetchApiFootball<T>(sport, 'odds', { fixture: eventId }, cacheTTL);
}

/**
 * ✅ Busca odds ao vivo VIA PROXY
 */
export async function fetchLiveOdds<T = any>(
  sport: SportType,
  cacheTTL: number = 10000
): Promise<T[]> {
  if (sport !== 'football') {
    console.warn(`⚠️ Odds ao vivo não disponíveis para ${sport} na API-Football`);
    return [];
  }

  return fetchApiFootball<T>(sport, 'odds/live', {}, cacheTTL);
}

/**
 * ✅ Busca ligas/competições VIA PROXY
 */
export async function fetchLeagues<T = any>(
  sport: SportType,
  season?: string,
  cacheTTL: number = 3600000
): Promise<T[]> {
  const params: Record<string, string> = {};
  
  if (season) {
    params.season = season;
  }

  return fetchApiFootball<T>(sport, 'leagues', params, cacheTTL);
}

/**
 * ✅ Busca equipas VIA PROXY
 */
export async function fetchTeams<T = any>(
  sport: SportType,
  leagueId?: string,
  cacheTTL: number = 3600000
): Promise<T[]> {
  const params: Record<string, string> = {};
  
  if (leagueId) {
    params.league = leagueId;
  }

  return fetchApiFootball<T>(sport, 'teams', params, cacheTTL);
}

/**
 * ✅ Busca classificação VIA PROXY
 */
export async function fetchStandings<T = any>(
  sport: SportType,
  leagueId: string,
  season: string,
  cacheTTL: number = 300000
): Promise<T[]> {
  if (sport === 'football') {
    return fetchApiFootball<T>(sport, 'standings', { 
      league: leagueId, 
      season 
    }, cacheTTL);
  }

  return fetchApiFootball<T>(sport, 'standings', { 
    league: leagueId, 
    season 
  }, cacheTTL);
}

export function clearApiFootballCache(): void {
  requestCache.clear();
  console.log('🗑️ Cache da API-Football limpo');
}

export function getApiFootballCacheStats() {
  return {
    size: requestCache.size,
    keys: Array.from(requestCache.keys())
  };
}

/**
 * ✅ Busca eventos de todos os desportos ao vivo VIA PROXY
 */
export async function fetchAllLiveEvents(): Promise<Record<SportType, any[]>> {
  const sports: SportType[] = [
    'football', 'basketball', 'baseball', 'hockey', 'rugby',
    'volleyball', 'formula1', 'mma', 'nfl', 'afl', 'handball'
  ];

  const promises = sports.map(async (sport) => {
    const events = await fetchLiveEvents(sport);
    return { sport, events };
  });

  const results = await Promise.allSettled(promises);
  
  const allEvents: Record<string, any[]> = {};
  
  results.forEach((result) => {
    if (result.status === 'fulfilled') {
      const { sport, events } = result.value;
      allEvents[sport] = events;
      console.log(`✅ ${sport}: ${events.length} jogos ao vivo`);
    } else {
      console.error(`❌ Erro ao buscar eventos:`, result.reason);
    }
  });

  return allEvents as Record<SportType, any[]>;
}

/**
 * ✅ Busca eventos futuros de todos os desportos VIA PROXY
 */
export async function fetchAllUpcomingEvents(days: number = 7): Promise<Record<SportType, any[]>> {
  const sports: SportType[] = [
    'football', 'basketball', 'baseball', 'hockey', 'rugby',
    'volleyball', 'formula1', 'mma', 'nfl', 'afl', 'handball'
  ];

  const promises = sports.map(async (sport) => {
    const events = await fetchUpcomingEvents(sport, days);
    return { sport, events };
  });

  const results = await Promise.allSettled(promises);
  
  const allEvents: Record<string, any[]> = {};
  
  results.forEach((result) => {
    if (result.status === 'fulfilled') {
      const { sport, events } = result.value;
      allEvents[sport] = events;
      console.log(`✅ ${sport}: ${events.length} jogos futuros`);
    } else {
      console.error(`❌ Erro ao buscar eventos:`, result.reason);
    }
  });

  return allEvents as Record<SportType, any[]>;
}
