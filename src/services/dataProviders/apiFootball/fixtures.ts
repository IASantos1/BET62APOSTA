import { 
  SportType, 
  GenericFixture
} from '../../../types/sports';

// Cache separado por desporto
interface CacheEntry {
  data: GenericFixture[];
  timestamp: number;
  ttl: number;
}

const fixturesCache = new Map<string, CacheEntry>();

// TTL padrão: 5 minutos
const DEFAULT_TTL = 5 * 60 * 1000;

/**
 * Limpa cache expirado
 */
function cleanExpiredCache(): void {
  const now = Date.now();
  for (const [key, entry] of fixturesCache.entries()) {
    if (now - entry.timestamp > entry.ttl) {
      fixturesCache.delete(key);
    }
  }
}

/**
 * Obtém dados do cache se válidos
 */
function getFromCache(key: string): GenericFixture[] | null {
  cleanExpiredCache();
  const entry = fixturesCache.get(key);
  if (!entry) return null;
  
  const now = Date.now();
  if (now - entry.timestamp > entry.ttl) {
    fixturesCache.delete(key);
    return null;
  }
  
  return entry.data;
}

/**
 * Salva dados no cache
 */
function saveToCache(key: string, data: GenericFixture[], ttl: number = DEFAULT_TTL): void {
  fixturesCache.set(key, {
    data,
    timestamp: Date.now(),
    ttl
  });
}

/**
 * ✅ NOVO: Sistema de controle de rate limit
 */
const RATE_LIMIT = {
  maxRequestsPerMinute: 30, // Limite da API-Football
  delayBetweenRequests: 2000, // 2 segundos entre requisições
  lastRequestTime: 0,
  requestQueue: [] as Array<() => Promise<any>>,
  isProcessing: false
};

/**
 * ✅ NOVO: Processa fila de requisições com rate limit
 */
async function processRequestQueue() {
  if (RATE_LIMIT.isProcessing || RATE_LIMIT.requestQueue.length === 0) {
    return;
  }

  RATE_LIMIT.isProcessing = true;

  while (RATE_LIMIT.requestQueue.length > 0) {
    const now = Date.now();
    const timeSinceLastRequest = now - RATE_LIMIT.lastRequestTime;

    // ✅ Aguardar se necessário para respeitar o rate limit
    if (timeSinceLastRequest < RATE_LIMIT.delayBetweenRequests) {
      const waitTime = RATE_LIMIT.delayBetweenRequests - timeSinceLastRequest;
      console.log(`⏳ Aguardando ${waitTime}ms para respeitar rate limit...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    const request = RATE_LIMIT.requestQueue.shift();
    if (request) {
      try {
        await request();
        RATE_LIMIT.lastRequestTime = Date.now();
      } catch (error) {
        console.error('❌ Erro ao processar requisição:', error);
      }
    }
  }

  RATE_LIMIT.isProcessing = false;
}

/**
 * ✅ NOVO: Adiciona requisição à fila
 */
function queueRequest<T>(requestFn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    RATE_LIMIT.requestQueue.push(async () => {
      try {
        const result = await requestFn();
        resolve(result);
      } catch (error) {
        reject(error);
      }
    });
    processRequestQueue();
  });
}

/**
 * ✅ CORRIGIDO: Buscar dados da API-Football com rate limit
 */
async function fetchFromApiFootball(
  sport: SportType,
  endpoint: string,
  params: Record<string, any> = {}
): Promise<any[]> {
  return queueRequest(async () => {
    try {
      const supabaseUrl = import.meta.env.VITE_PUBLIC_SUPABASE_URL;
      const functionUrl = `${supabaseUrl}/functions/v1/api-football-proxy`;

      const url = new URL(functionUrl);
      url.searchParams.append('sport', sport);
      url.searchParams.append('endpoint', endpoint);
      Object.entries(params).forEach(([key, value]) => {
        url.searchParams.append(key, String(value));
      });

      console.log(`📡 Chamando API-Football: ${sport} → ${endpoint}`, params);

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        }
      });

      if (!response.ok) {
        let errorData;
        try {
          errorData = await response.json();
        } catch {
          errorData = { message: await response.text() };
        }
        
        // ✅ NOVO: Detectar erro de rate limit
        if (response.status === 429 || errorData.details?.rateLimit) {
          console.warn(`⚠️ Rate limit atingido para ${sport}, aguardando...`);
          RATE_LIMIT.delayBetweenRequests = Math.min(RATE_LIMIT.delayBetweenRequests * 1.5, 10000);
          return [];
        }
        
        // ✅ MELHORADO: Log mais detalhado do erro
        console.error(`❌ Edge Function error (${sport}):`, {
          status: response.status,
          statusText: response.statusText,
          error: errorData,
          endpoint,
          params
        });
        return [];
      }

      const data = await response.json();
      
      // ✅ CORRIGIDO: Validar se data é um array
      if (!data) {
        console.warn(`⚠️ API-Football retornou dados vazios para ${sport}`);
        return [];
      }

      // ✅ CORRIGIDO: Se data for um objeto com propriedade 'response', extrair o array
      if (typeof data === 'object' && !Array.isArray(data)) {
        if (data.error) {
          // ✅ NOVO: Detectar erro de rate limit na resposta
          if (data.details?.rateLimit) {
            console.warn(`⚠️ Rate limit atingido para ${sport}, aguardando...`);
            RATE_LIMIT.delayBetweenRequests = Math.min(RATE_LIMIT.delayBetweenRequests * 1.5, 10000);
            return [];
          }
          
          console.error(`❌ API-Football retornou erro (${sport}):`, data.error, data.details);
          return [];
        }

        // ✅ CORRIGIDO: Extrair array da resposta
        if (Array.isArray(data.response)) {
          console.log(`✅ API-Football ${sport}: ${data.response.length} resultados`);
          return data.response;
        }

        console.warn(`⚠️ API-Football retornou objeto sem array 'response' para ${sport}:`, data);
        return [];
      }

      // ✅ CORRIGIDO: Se data já for um array, retornar diretamente
      if (Array.isArray(data)) {
        console.log(`✅ API-Football ${sport}: ${data.length} resultados`);
        return data;
      }

      console.warn(`⚠️ API-Football retornou tipo inesperado para ${sport}:`, typeof data);
      return [];
    } catch (error) {
      // ✅ MELHORADO: Log mais detalhado do erro
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      const errorStack = error instanceof Error ? error.stack : '';
      
      console.error(`❌ Erro ao buscar dados da API-Football (${sport}):`, {
        message: errorMessage,
        stack: errorStack,
        endpoint,
        params
      });
      return [];
    }
  });
}

/**
 * Normaliza fixture de Futebol
 */
function normalizeFootballFixture(fixture: any): GenericFixture {
  return {
    id: `football-${fixture.fixture.id}`,
    sport: 'football',
    date: fixture.fixture.date,
    timestamp: fixture.fixture.timestamp,
    status: {
      short: fixture.fixture.status.short,
      long: fixture.fixture.status.long,
      elapsed: fixture.fixture.status.elapsed
    },
    league: {
      id: fixture.league.id,
      name: fixture.league.name,
      country: fixture.league.country,
      logo: fixture.league.logo,
      flag: fixture.league.flag
    },
    teams: {
      home: {
        id: fixture.teams.home.id,
        name: fixture.teams.home.name,
        logo: fixture.teams.home.logo
      },
      away: {
        id: fixture.teams.away.id,
        name: fixture.teams.away.name,
        logo: fixture.teams.away.logo
      }
    },
    score: {
      home: fixture.goals.home,
      away: fixture.goals.away
    },
    venue: fixture.fixture.venue ? {
      id: fixture.fixture.venue.id,
      name: fixture.fixture.venue.name,
      city: fixture.fixture.venue.city
    } : undefined
  };
}

/**
 * Normaliza fixture de Basquetebol
 */
function normalizeBasketballFixture(fixture: any): GenericFixture {
  return {
    id: `basketball-${fixture.id}`,
    sport: 'basketball',
    date: fixture.date,
    timestamp: fixture.timestamp,
    status: {
      short: fixture.status.short,
      long: fixture.status.long,
      elapsed: fixture.status.timer || null
    },
    league: {
      id: fixture.league.id,
      name: fixture.league.name,
      country: fixture.country.name,
      logo: fixture.league.logo,
      flag: fixture.country.flag
    },
    teams: {
      home: {
        id: fixture.teams.home.id,
        name: fixture.teams.home.name,
        logo: fixture.teams.home.logo
      },
      away: {
        id: fixture.teams.away.id,
        name: fixture.teams.away.name,
        logo: fixture.teams.away.logo
      }
    },
    score: {
      home: fixture.scores.home.total,
      away: fixture.scores.away.total
    },
    venue: fixture.venue ? {
      id: fixture.venue.id,
      name: fixture.venue.name,
      city: fixture.venue.city
    } : undefined
  };
}

/**
 * Normaliza fixture de Basebol
 */
function normalizeBaseballFixture(fixture: any): GenericFixture {
  return {
    id: `baseball-${fixture.id}`,
    sport: 'baseball',
    date: fixture.date,
    timestamp: fixture.timestamp,
    status: {
      short: fixture.status.short,
      long: fixture.status.long,
      elapsed: fixture.status.inning || null
    },
    league: {
      id: fixture.league.id,
      name: fixture.league.name,
      country: fixture.country.name,
      logo: fixture.league.logo,
      flag: fixture.country.flag
    },
    teams: {
      home: {
        id: fixture.teams.home.id,
        name: fixture.teams.home.name,
        logo: fixture.teams.home.logo
      },
      away: {
        id: fixture.teams.away.id,
        name: fixture.teams.away.name,
        logo: fixture.teams.away.logo
      }
    },
    score: {
      home: fixture.scores.home.total,
      away: fixture.scores.away.total
    },
    venue: fixture.venue ? {
      id: fixture.venue.id,
      name: fixture.venue.name,
      city: fixture.venue.city
    } : undefined
  };
}

/**
 * Normaliza fixture genérico (Hockey, Rugby, Volleyball, NFL, AFL, Handball)
 */
function normalizeGenericFixture(fixture: any, sport: SportType): GenericFixture {
  return {
    id: `${sport}-${fixture.id}`,
    sport,
    date: fixture.date,
    timestamp: fixture.timestamp,
    status: {
      short: fixture.status.short,
      long: fixture.status.long,
      elapsed: fixture.status.timer || fixture.status.elapsed || null
    },
    league: {
      id: fixture.league.id,
      name: fixture.league.name,
      country: fixture.country?.name || fixture.league.country || 'International',
      logo: fixture.league.logo,
      flag: fixture.country?.flag || null
    },
    teams: {
      home: {
        id: fixture.teams.home.id,
        name: fixture.teams.home.name,
        logo: fixture.teams.home.logo
      },
      away: {
        id: fixture.teams.away.id,
        name: fixture.teams.away.name,
        logo: fixture.teams.away.logo
      }
    },
    score: {
      home: fixture.scores?.home?.total || fixture.goals?.home || 0,
      away: fixture.scores?.away?.total || fixture.goals?.away || 0
    },
    venue: fixture.venue ? {
      id: fixture.venue.id,
      name: fixture.venue.name,
      city: fixture.venue.city
    } : undefined
  };
}

/**
 * Normaliza fixture de Fórmula 1
 */
function normalizeFormula1Fixture(race: any): GenericFixture {
  return {
    id: `formula1-${race.id}`,
    sport: 'formula1',
    date: race.date,
    timestamp: new Date(race.date).getTime() / 1000,
    status: {
      short: race.status,
      long: race.status,
      elapsed: null
    },
    league: {
      id: race.competition.id,
      name: race.competition.name,
      country: race.circuit.country || 'International',
      logo: race.competition.logo,
      flag: null
    },
    teams: {
      home: {
        id: 0,
        name: race.circuit.name,
        logo: null
      },
      away: {
        id: 0,
        name: 'F1 Race',
        logo: null
      }
    },
    score: {
      home: null,
      away: null
    },
    venue: {
      id: race.circuit.id,
      name: race.circuit.name,
      city: race.circuit.location
    }
  };
}

/**
 * Normaliza fixture de MMA
 */
function normalizeMMAFixture(fight: any): GenericFixture {
  // ✅ NOVO: Validação robusta para evitar erros de propriedades undefined
  if (!fight || !fight.id) {
    console.warn('⚠️ Fixture de MMA inválido (sem ID):', fight);
    throw new Error('Fixture de MMA inválido');
  }

  // ✅ Validar estrutura mínima necessária
  const hasLeague = fight.league && fight.league.id && fight.league.name;
  const hasFighters = fight.fighters && fight.fighters.home && fight.fighters.away;
  
  if (!hasLeague || !hasFighters) {
    console.warn('⚠️ Fixture de MMA com dados incompletos:', {
      id: fight.id,
      hasLeague,
      hasFighters,
      data: fight
    });
    throw new Error('Fixture de MMA com dados incompletos');
  }

  return {
    id: `mma-${fight.id}`,
    sport: 'mma',
    date: fight.date || new Date().toISOString(),
    timestamp: fight.timestamp || Math.floor(Date.now() / 1000),
    status: {
      short: fight.status?.short || 'NS',
      long: fight.status?.long || 'Not Started',
      elapsed: fight.status?.round || null
    },
    league: {
      id: fight.league.id,
      name: fight.league.name,
      country: fight.country?.name || fight.league.country || 'International',
      logo: fight.league.logo || null,
      flag: fight.country?.flag || null
    },
    teams: {
      home: {
        id: fight.fighters.home.id || 0,
        name: fight.fighters.home.name || 'Fighter 1',
        logo: fight.fighters.home.image || null
      },
      away: {
        id: fight.fighters.away.id || 0,
        name: fight.fighters.away.name || 'Fighter 2',
        logo: fight.fighters.away.image || null
      }
    },
    score: {
      home: null,
      away: null
    },
    venue: fight.venue ? {
      id: fight.venue.id,
      name: fight.venue.name,
      city: fight.venue.city
    } : undefined
  };
}

/**
 * Normaliza fixture baseado no desporto
 */
function normalizeFixture(fixture: any, sport: SportType): GenericFixture {
  // ✅ NOVO: Validação antes de processar
  if (!fixture) {
    console.warn(`⚠️ Fixture ${sport} é null ou undefined`);
    throw new Error(`Fixture ${sport} inválido`);
  }

  try {
    switch (sport) {
      case 'football':
        return normalizeFootballFixture(fixture);
      case 'basketball':
        return normalizeBasketballFixture(fixture);
      case 'baseball':
        return normalizeBaseballFixture(fixture);
      case 'formula1':
        return normalizeFormula1Fixture(fixture);
      case 'mma':
        return normalizeMMAFixture(fixture);
      case 'hockey':
      case 'rugby':
      case 'volleyball':
      case 'nfl':
      case 'afl':
      case 'handball':
        return normalizeGenericFixture(fixture, sport);
      default:
        throw new Error(`Normalização não implementada para: ${sport}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    console.error(`❌ Erro ao normalizar fixture de ${sport}:`, errorMessage, fixture);
    throw error; // Re-throw para ser capturado pelo Promise.allSettled
  }
}

/**
 * Busca fixtures ao vivo de um desporto específico
 */
export async function getLiveFixturesBySport(sport: SportType): Promise<GenericFixture[]> {
  const cacheKey = `live-fixtures-${sport}`;
  const cached = getFromCache(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    let endpoint = '';
    let params: Record<string, string> = {};

    // ✅ CORRIGIDO: Cada desporto tem parâmetros diferentes para jogos ao vivo
    switch (sport) {
      case 'football':
        endpoint = 'fixtures';
        params = { live: 'all' };
        break;
      case 'basketball':
        endpoint = 'games';
        params = { 
          date: new Date().toISOString().split('T')[0],
          timezone: 'UTC'
        };
        break;
      case 'baseball':
        endpoint = 'games';
        params = { 
          date: new Date().toISOString().split('T')[0],
          timezone: 'UTC'
        };
        break;
      case 'hockey':
        endpoint = 'games';
        params = { 
          date: new Date().toISOString().split('T')[0],
          timezone: 'UTC'
        };
        break;
      case 'rugby':
        // ✅ CORRIGIDO: Rugby precisa de league para funcionar
        endpoint = 'games';
        params = { 
          league: '12', // Top 14 (França) - liga mais ativa
          season: new Date().getFullYear().toString(),
          timezone: 'UTC'
        };
        break;
      case 'volleyball':
        endpoint = 'games';
        params = { 
          date: new Date().toISOString().split('T')[0],
          timezone: 'UTC'
        };
        break;
      case 'handball':
        endpoint = 'games';
        params = { 
          date: new Date().toISOString().split('T')[0],
          timezone: 'UTC'
        };
        break;
      case 'formula1':
        endpoint = 'races';
        params = { 
          season: new Date().getFullYear().toString(),
          timezone: 'UTC'
        };
        break;
      case 'mma':
        endpoint = 'fights';
        params = { 
          date: new Date().toISOString().split('T')[0],
          timezone: 'UTC'
        };
        break;
      case 'nfl':
        endpoint = 'games';
        params = { 
          date: new Date().toISOString().split('T')[0],
          timezone: 'UTC'
        };
        break;
      case 'afl':
        console.warn('⚠️ AFL não está disponível na API-Football v3');
        return [];
      default:
        console.warn(`⚠️ Desporto não suportado: ${sport}`);
        return [];
    }

    const data = await fetchFromApiFootball(sport, endpoint, params);
    
    // ✅ NOVO: Validar se há dados antes de mapear
    if (!data || data.length === 0) {
      console.log(`ℹ️ ${sport}: Nenhum fixture encontrado`);
      return [];
    }
    
    console.log(`📊 ${sport}: ${data.length} jogos encontrados`);
    
    // ✅ CORRIGIDO: Usar Promise.allSettled para não falhar se um fixture for inválido
    const fixturePromises = data.map(async (item: any) => {
      try {
        return normalizeFixture(item, sport);
      } catch (error) {
        console.warn(`⚠️ Erro ao normalizar fixture de ${sport}:`, error);
        return null;
      }
    });
    
    const results = await Promise.allSettled(fixturePromises);
    const fixtures = results
      .filter((r): r is PromiseFulfilledResult<GenericFixture> => r.status === 'fulfilled' && r.value !== null)
      .map(r => r.value);
    
    // Cache com TTL de 30 segundos para live
    saveToCache(cacheKey, fixtures, 30 * 1000);
    
    console.log(`✅ [API-Football] ${sport}: ${fixtures.length} jogos processados`);
    return fixtures;
  } catch (error) {
    console.error(`❌ Erro ao buscar fixtures ao vivo (${sport}):`, error);
    return [];
  }
}

/**
 * Busca fixtures futuros de um desporto específico
 */
export async function getUpcomingFixturesBySport(sport: SportType, days: number = 7): Promise<GenericFixture[]> {
  try {
    console.log(`📡 Buscando fixtures futuros de ${sport}...`);
    
    let endpoint = '';
    let params: Record<string, any> = {};
    
    // ✅ CORRIGIDO: Configurar endpoint e parâmetros por desporto
    switch (sport) {
      case 'football':
        endpoint = 'fixtures';
        params = {
          next: days.toString(),
          timezone: 'Europe/Lisbon'
        };
        break;
      case 'basketball':
        // ✅ CORRIGIDO: Basketball precisa de league + season
        endpoint = 'games';
        params = {
          league: '12', // NBA
          season: '2024-2025',
          timezone: 'Europe/Lisbon'
        };
        break;
      case 'baseball':
        // ✅ CORRIGIDO: Baseball precisa de league + season
        endpoint = 'games';
        params = {
          league: '1', // MLB
          season: new Date().getFullYear().toString(),
          timezone: 'Europe/Lisbon'
        };
        break;
      case 'hockey':
        // ✅ CORRIGIDO: Hockey precisa de league + season
        endpoint = 'games';
        params = {
          league: '57', // NHL
          season: new Date().getFullYear().toString(),
          timezone: 'Europe/Lisbon'
        };
        break;
      case 'rugby':
        // ✅ CORRIGIDO: Rugby precisa de league + season
        endpoint = 'games';
        params = {
          league: '12', // Top 14 (França)
          season: new Date().getFullYear().toString(),
          timezone: 'Europe/Lisbon'
        };
        break;
      case 'volleyball':
        // ✅ CORRIGIDO: Volleyball precisa de league + season
        endpoint = 'games';
        params = {
          league: '1', // Liga Mundial
          season: new Date().getFullYear().toString(),
          timezone: 'Europe/Lisbon'
        };
        break;
      case 'formula1':
        // ✅ CORRIGIDO: F1 precisa de season + type
        endpoint = 'races';
        params = {
          season: new Date().getFullYear().toString(),
          timezone: 'Europe/Lisbon',
          type: 'race'
        };
        break;
      case 'mma':
        // ✅ CORRIGIDO: MMA não usa 'league', usa apenas 'date' ou 'season'
        endpoint = 'fights';
        params = {
          season: new Date().getFullYear().toString(),
          timezone: 'Europe/Lisbon'
        };
        break;
      case 'nfl':
        // ✅ CORRIGIDO: NFL precisa de league + season
        endpoint = 'games';
        params = {
          league: '1', // NFL
          season: new Date().getFullYear().toString(),
          timezone: 'Europe/Lisbon'
        };
        break;
      case 'handball':
        // ✅ CORRIGIDO: Handball precisa de league + season
        endpoint = 'games';
        params = {
          league: '1', // Liga dos Campeões
          season: new Date().getFullYear().toString(),
          timezone: 'Europe/Lisbon'
        };
        break;
      case 'afl':
        // ✅ NOVO: AFL não está disponível na API-Football v3
        console.warn('⚠️ AFL não está disponível na API-Football v3');
        return [];
      default:
        console.warn(`⚠️ Desporto não suportado: ${sport}`);
        return [];
    }

    const data = await fetchFromApiFootball(sport, endpoint, params);
    
    // ✅ NOVO: Validar se há dados antes de mapear
    if (!data || data.length === 0) {
      console.log(`ℹ️ ${sport}: Nenhum fixture futuro encontrado`);
      return [];
    }
    
    // ✅ NOVO: Filtrar fixtures inválidos antes de normalizar
    const validData = data.filter((item: any) => {
      if (!item) return false;
      
      // Validar estrutura básica
      const hasValidStructure = item.fixture || item.game || item.fight || item.race || item.competition;
      if (!hasValidStructure) {
        console.warn(`⚠️ ${sport}: Fixture sem estrutura válida`, item);
        return false;
      }
      
      return true;
    });
    
    if (validData.length === 0) {
      console.log(`ℹ️ ${sport}: Nenhum fixture válido encontrado após filtro`);
      return [];
    }
    
    // ✅ CORRIGIDO: Usar normalizeFixture em vez de normalizeApiFootballFixture
    const fixtures = validData.map((item: any) => normalizeFixture(item, sport));
    
    console.log(`✅ ${sport}: ${fixtures.length} fixtures futuros processados`);
    return fixtures;
    
  } catch (error) {
    console.error(`❌ Erro ao buscar fixtures futuros de ${sport}:`, error);
    return [];
  }
}

/**
 * Obtém fixture específico por ID
 */
export async function getFixtureById(
  sport: SportType,
  fixtureId: string
): Promise<GenericFixture | null> {
  const cacheKey = `fixture-${sport}-${fixtureId}`;
  
  // Verifica cache
  const cached = getFromCache(cacheKey);
  if (cached && cached.length > 0) return cached[0];

  try {
    let endpoint = '';
    let params: Record<string, string> = {};

    // Remove prefixo do sport do ID se existir
    const cleanId = fixtureId.replace(`${sport}-`, '');

    switch (sport) {
      case 'football':
        endpoint = 'fixtures';
        params = { id: cleanId };
        break;
      case 'basketball':
      case 'baseball':
      case 'hockey':
      case 'rugby':
      case 'volleyball':
      case 'nfl':
      case 'afl':
      case 'handball':
        endpoint = 'games';
        params = { id: cleanId };
        break;
      case 'formula1':
        endpoint = 'races';
        params = { id: cleanId };
        break;
      case 'mma':
        endpoint = 'fights';
        params = { id: cleanId };
        break;
      default:
        return null;
    }

    const data = await fetchFromApiFootball(sport, endpoint, params);
    
    if (!data || data.length === 0) return null;
    
    const fixture = normalizeFixture(data[0], sport);
    
    // Cache com TTL de 1 minuto
    saveToCache(cacheKey, [fixture], 60 * 1000);
    
    return fixture;
  } catch (error) {
    console.error(`Erro ao buscar fixture ${fixtureId} de ${sport}:`, error);
    return null;
  }
}

export async function fetchFixtureById(
  sport: SportType,
  fixtureId: string
): Promise<GenericFixture | null> {
  return getFixtureById(sport, fixtureId);
}

/**
 * ✅ CORRIGIDO: Obtém todos os fixtures ao vivo com priorização
 */
export async function getAllLiveFixtures(): Promise<GenericFixture[]> {
  // ✅ NOVO: Priorizar desportos mais populares
  const prioritySports: SportType[] = ['football', 'basketball', 'hockey'];
  const secondarySports: SportType[] = ['baseball', 'rugby', 'volleyball', 'handball'];
  const tertiarySports: SportType[] = ['formula1', 'mma', 'nfl'];

  const fixtures: GenericFixture[] = [];
  const stats: Record<string, number> = {};

  // ✅ 1️⃣ Buscar desportos prioritários primeiro (em paralelo)
  console.log('🔥 Buscando desportos prioritários...');
  const priorityPromises = prioritySports.map(async (sport) => {
    try {
      const sportFixtures = await getLiveFixturesBySport(sport);
      return { sport, fixtures: sportFixtures };
    } catch (error) {
      console.error(`❌ Erro ao buscar ${sport}:`, error);
      return { sport, fixtures: [] };
    }
  });

  const priorityResults = await Promise.all(priorityPromises);
  priorityResults.forEach(({ sport, fixtures: sportFixtures }) => {
    fixtures.push(...sportFixtures);
    stats[sport] = sportFixtures.length;
  });

  // ✅ 2️⃣ Buscar desportos secundários (em paralelo)
  console.log('📊 Buscando desportos secundários...');
  const secondaryPromises = secondarySports.map(async (sport) => {
    try {
      const sportFixtures = await getLiveFixturesBySport(sport);
      return { sport, fixtures: sportFixtures };
    } catch (error) {
      console.error(`❌ Erro ao buscar ${sport}:`, error);
      return { sport, fixtures: [] };
    }
  });

  const secondaryResults = await Promise.all(secondaryPromises);
  secondaryResults.forEach(({ sport, fixtures: sportFixtures }) => {
    fixtures.push(...sportFixtures);
    stats[sport] = sportFixtures.length;
  });

  // ✅ 3️⃣ Buscar desportos terciários (em paralelo, se ainda houver quota)
  if (fixtures.length < 100) {
    console.log('🎯 Buscando desportos terciários...');
    const tertiaryPromises = tertiarySports.map(async (sport) => {
      try {
        const sportFixtures = await getLiveFixturesBySport(sport);
        return { sport, fixtures: sportFixtures };
      } catch (error) {
        console.error(`❌ Erro ao buscar ${sport}:`, error);
        return { sport, fixtures: [] };
      }
    });

    const tertiaryResults = await Promise.all(tertiaryPromises);
    tertiaryResults.forEach(({ sport, fixtures: sportFixtures }) => {
      fixtures.push(...sportFixtures);
      stats[sport] = sportFixtures.length;
    });
  }

  console.log(`✅ ${fixtures.length} jogos processados da API-Football:`, stats);
  return fixtures;
}

/**
 * ✅ CORRIGIDO: Obtém todos os fixtures futuros com priorização
 */
export async function getAllUpcomingFixtures(days: number = 7): Promise<GenericFixture[]> {
  // ✅ NOVO: Priorizar desportos mais populares
  const prioritySports: SportType[] = ['football', 'basketball', 'hockey'];
  const secondarySports: SportType[] = ['baseball', 'rugby', 'volleyball', 'handball'];
  const tertiarySports: SportType[] = ['formula1', 'mma', 'nfl'];

  const fixtures: GenericFixture[] = [];
  const stats: Record<string, number> = {};

  // ✅ 1️⃣ Buscar desportos prioritários primeiro
  console.log('🔥 Buscando fixtures futuros - desportos prioritários...');
  for (const sport of prioritySports) {
    try {
      const sportFixtures = await getUpcomingFixturesBySport(sport, days);
      fixtures.push(...sportFixtures);
      stats[sport] = sportFixtures.length;
    } catch (error) {
      console.error(`❌ Erro ao buscar ${sport}:`, error);
      stats[sport] = 0;
    }
  }

  // ✅ 2️⃣ Buscar desportos secundários
  console.log('📊 Buscando fixtures futuros - desportos secundários...');
  for (const sport of secondarySports) {
    try {
      const sportFixtures = await getUpcomingFixturesBySport(sport, days);
      fixtures.push(...sportFixtures);
      stats[sport] = sportFixtures.length;
    } catch (error) {
      console.error(`❌ Erro ao buscar ${sport}:`, error);
      stats[sport] = 0;
    }
  }

  // ✅ 3️⃣ Buscar desportos terciários (se ainda houver quota)
  if (fixtures.length < 100) {
    console.log('🎯 Buscando fixtures futuros - desportos terciários...');
    for (const sport of tertiarySports) {
      try {
        const sportFixtures = await getUpcomingFixturesBySport(sport, days);
        fixtures.push(...sportFixtures);
        stats[sport] = sportFixtures.length;
      } catch (error) {
        console.error(`❌ Erro ao buscar ${sport}:`, error);
        stats[sport] = 0;
      }
    }
  }

  console.log(`✅ ${fixtures.length} fixtures futuros processados:`, stats);
  return fixtures;
}

/**
 * Limpa todo o cache
 */
export function clearFixturesCache(): void {
  fixturesCache.clear();
}

/**
 * Obtém estatísticas do cache
 */
export function getFixturesCacheStats() {
  return {
    size: fixturesCache.size,
    keys: Array.from(fixturesCache.keys())
  };
}

// Funções específicas por desporto (mantidas para compatibilidade)
export const getFootballFixtures = (days: number = 7) => getUpcomingFixturesBySport('football', days);
export const getBasketballFixtures = (days: number = 7) => getUpcomingFixturesBySport('basketball', days);
export const getBaseballFixtures = (days: number = 7) => getUpcomingFixturesBySport('baseball', days);
export const getHockeyFixtures = (days: number = 7) => getUpcomingFixturesBySport('hockey', days);
export const getRugbyFixtures = (days: number = 7) => getUpcomingFixturesBySport('rugby', days);
export const getVolleyballFixtures = (days: number = 7) => getUpcomingFixturesBySport('volleyball', days);
export const getFormula1Fixtures = (days: number = 7) => getUpcomingFixturesBySport('formula1', days);
export const getMMAFixtures = (days: number = 7) => getUpcomingFixturesBySport('mma', days);
export const getNFLFixtures = (days: number = 7) => getUpcomingFixturesBySport('nfl', days);
export const getAFLFixtures = (days: number = 7) => getUpcomingFixturesBySport('afl', days);
export const getHandballFixtures = (days: number = 7) => getUpcomingFixturesBySport('handball', days);
