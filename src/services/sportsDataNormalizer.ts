import type { NormalizedMatch, NormalizedStats } from '../types/sports';
import { getTeamLogosBatch } from './teamLogosService';
import { fetchApiFootball, convertApiFootballToNormalized, isLeagueBlocked, findOddsForMatch } from './apiFootballService';
import { fetchOddsEvents } from './oddsApiIo';
import type { ApiFootballFixture } from './apiFootballService';
import { fetchApiFootballLive, fetchApiFootballLiveOdds } from './apiFootballLive';

// ✅ OTIMIZAÇÃO: Cache simples e rápido
let cachedLiveMatches: NormalizedMatch[] | null = null;
let cachedUpcomingMatches: NormalizedMatch[] | null = null;
let lastLiveUpdate = 0;
let lastUpcomingUpdate = 0;

const LIVE_CACHE_TTL = 30 * 1000;
const UPCOMING_CACHE_TTL = 5 * 60 * 1000;

// ============================================
// TIPOS EXPORTADOS
// ============================================
export type SportType = 'football' | 'basketball' | 'baseball' | 'hockey' | 'rugby' | 'volleyball' | 'handball' | 'mma' | 'formula1';

// ============================================
// ✅ BUSCAR JOGOS AO VIVO (LIVE)
// ============================================
export async function getLiveMatches(): Promise<NormalizedMatch[]> {
  const now = Date.now();

  if (cachedLiveMatches && now - lastLiveUpdate < LIVE_CACHE_TTL) {
    return cachedLiveMatches;
  }

  // Lista de desportos para buscar
  const sports = ['football', 'basketball', 'baseball', 'hockey', 'rugby', 'volleyball', 'handball', 'mma', 'formula1'];

  // ✅ BUSCA PARALELA: Fixtures (API-Football) + Odds (Odds-API.io)
  const [fixturesResults, oddsIoEvents] = await Promise.all([
    Promise.allSettled(
      sports.map(async (sport) => {
        try {
          // 1. Buscar Fixtures (Jogos) - USA CACHE OU API
          // Aqui a função fetchApiFootballLive já cuida da lógica de buscar ou retornar cache
          // Se for 'football', busca live=all. Se for outro, busca fixtures live.
          const fixturesPromise = fetchApiFootballLive(sport as any);
          
          // 2. Buscar Odds ao Vivo da API-Football (Backup)
          const oddsPromise = sport === 'football' 
             ? fetchApiFootballLiveOdds(sport as any).catch(() => []) 
             : Promise.resolve([]);

          const [fixtures, oddsData] = await Promise.all([fixturesPromise, oddsPromise]);
          return { sport, fixtures, oddsData };
        } catch (err) {
          console.error(`Erro ao buscar dados de ${sport}:`, err);
          return { sport, fixtures: [], oddsData: [] };
        }
      })
    ),
    fetchOddsEvents('football').catch(err => {
      console.error('Erro ao buscar Odds-API.io:', err);
      return [];
    })
  ]);

  const allMatches: NormalizedMatch[] = [];

  for (const result of fixturesResults) {
    if (result.status === 'fulfilled') {
      const { sport, fixtures, oddsData } = result.value;
      if (Array.isArray(fixtures)) {
        // Mapear Odds da API-Football por Fixture ID
        const oddsMapApiFootball = new Map<number, any>();
        if (Array.isArray(oddsData)) {
          oddsData.forEach((oddItem: any) => {
            if (oddItem.fixture && oddItem.fixture.id) {
              oddsMapApiFootball.set(oddItem.fixture.id, oddItem);
            }
          });
        }

        // Converter e adicionar
        for (const fixture of fixtures) {
          const match = convertApiFootballToNormalized(fixture, sport);
          
          // ✅ FILTRO DE LIGAS BLOQUEADAS
          if (match && isLeagueBlocked(match.league)) {
            continue;
          }

          if (match && match.isLive) {
            // ✅ ESTRATÉGIA HÍBRIDA DE ODDS
            // 1. Tentar Odds-API.io (Prioridade)
            let oddsFound = findOddsForMatch(match, oddsIoEvents);
            
            // 2. Se falhar, tentar API-Football Live Odds (Backup)
            if (!oddsFound && oddsMapApiFootball.has(Number(match.id))) {
                const apiOdds = oddsMapApiFootball.get(Number(match.id));
                const bookmakers = apiOdds.bookmakers || [];
                if (bookmakers.length > 0) {
                    const bets = bookmakers[0].bets || [];
                    const matchWinner = bets.find((b: any) => b.id === 1 || b.id === 590 || b.name === 'Match Winner');
                    
                    if (matchWinner && matchWinner.values) {
                        const homeOdd = matchWinner.values.find((v: any) => v.value === 'Home')?.odd;
                        const drawOdd = matchWinner.values.find((v: any) => v.value === 'Draw')?.odd;
                        const awayOdd = matchWinner.values.find((v: any) => v.value === 'Away')?.odd;
                        
                        if (homeOdd && awayOdd) {
                            oddsFound = {
                                home: parseFloat(homeOdd),
                                draw: drawOdd ? parseFloat(drawOdd) : 1.01,
                                away: parseFloat(awayOdd),
                                bookmaker: 'API-Football'
                            };
                        }
                    }
                }
            }

            if (oddsFound) {
               match.odds = oddsFound;
            } else {
               // Se ainda não tiver odds, não definimos nada (null/undefined)
               // O frontend deve ocultar ou mostrar estado bloqueado
            }

            allMatches.push(match);
          }
        }
      }
    }
  }

  // ✅ BUSCAR LOGOS DAS EQUIPAS EM BATCH
  // Filtrar jogos futuros (máximo 15 para logos) para evitar sobrecarga (30 requests max)
  if (allMatches.length > 0) {
    // Ordenar primeiro por data para pegar logos dos jogos mais próximos
    allMatches.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    
    const matchesForLogos = allMatches.slice(0, 15);
    const teamsToFetch = matchesForLogos.flatMap((m) => [
      { name: m.homeTeam, league: m.league },
      { name: m.awayTeam, league: m.league },
    ]);
    try {
      // ✅ Timeout de 2.5s para evitar bloqueio da UI (aumentado para evitar warnings frequentes)
      const logosPromise = getTeamLogosBatch(teamsToFetch);
      const timeoutPromise = new Promise<Map<string, string>>((resolve) => 
        setTimeout(() => resolve(new Map()), 2500)
      );
      
      const logos = await Promise.race([logosPromise, timeoutPromise]);
      
      if (logos.size > 0) {
          for (const match of allMatches) {
            if (logos.has(match.homeTeam)) match.homeTeamLogo = logos.get(match.homeTeam);
            if (logos.has(match.awayTeam)) match.awayTeamLogo = logos.get(match.awayTeam);
          }
      } else {
          // Silencioso em produção, debug apenas se necessário
          // console.debug('⚠️ Timeout ao buscar logos (continuando sem logos)');
      }
    } catch (error) {
      console.warn('⚠️ Erro ao buscar logos:', error);
    }
  }

  // Ordenar por liga
  allMatches.sort((a, b) => (a.league || '').localeCompare(b.league || ''));

  cachedLiveMatches = allMatches;
  lastLiveUpdate = now;

  return allMatches;
}

/**
 * ✅ BUSCAR PRÉ-JOGOS DA API-FOOTBALL
 * Substitui completamente a integração com The Odds API
 */
export async function getUpcomingMatches(): Promise<NormalizedMatch[]> {
  const now = Date.now();

  if (cachedUpcomingMatches && now - lastUpcomingUpdate < UPCOMING_CACHE_TTL) {
    // Re-filtrar jogos cacheados para garantir que não mostramos passados
    cachedUpcomingMatches = cachedUpcomingMatches.filter(m => {
        const startTime = new Date(m.startTime).getTime();
        return startTime > Date.now();
    });
    return cachedUpcomingMatches;
  }

  console.log('🔄 Buscando pré-jogos (Hybrid: API-Football + Odds-API.io)...');
  const allMatches: NormalizedMatch[] = [];
  const sports = ['football', 'basketball', 'baseball', 'hockey', 'rugby', 'volleyball', 'handball', 'mma', 'formula1'];

  // ✅ BUSCA PARALELA: Fixtures (API-Football) + Odds (Odds-API.io)
  // Nota: Para pré-jogos, API-Football não fornece odds gratuitas facilmente via endpoint de fixtures.
  // Focamos na Odds-API.io para odds.
  
  const [fixturesResults, oddsIoEvents] = await Promise.all([
    Promise.allSettled(
      sports.map(async (sport) => {
        // Busca fixtures dos próximos 3 dias
        const from = new Date().toISOString().split('T')[0];
        const to = new Date(Date.now() + 3 * 86400000).toISOString().split('T')[0];
        return fetchApiFootball<ApiFootballFixture>(sport, 'fixtures', { from, to }, 60000)
          .then(data => ({ sport, data }))
          .catch(err => ({ sport, data: [] }));
      })
    ),
    fetchOddsEvents('football').catch(() => [])
  ]);

  for (const result of fixturesResults) {
    if (result.status === 'fulfilled') {
      const { sport, data } = result.value;
      if (Array.isArray(data)) {
        for (const fixture of data) {
          const match = convertApiFootballToNormalized(fixture, sport);
          
          if (match && !isLeagueBlocked(match.league)) {
            // Se já começou, ignora (deveria estar no live)
            if (['LIVE', '1H', '2H', 'HT', 'ET', 'P', 'BT', 'Q1', 'Q2', 'Q3', 'Q4'].includes(match.statusShort)) {
                continue;
            }

            // Tentar encontrar odds na Odds-API.io
            const oddsIo = findOddsForMatch(match, oddsIoEvents);
            if (oddsIo) {
                match.odds = oddsIo;
            }

            allMatches.push(match);
          }
        }
      }
    } else {
       console.error(`[Normalizer Error] Falha na promise de fixtures:`, result.reason);
    }
  }

  // ✅ BUSCAR LOGOS DAS EQUIPAS EM BATCH
  // Filtrar jogos futuros (máximo 15 para logos) para evitar sobrecarga (30 requests max)
  if (allMatches.length > 0) {
    // Ordenar primeiro por data para pegar logos dos jogos mais próximos
    allMatches.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    
    const matchesForLogos = allMatches.slice(0, 15);
    const teamsToFetch = matchesForLogos.flatMap((m) => [
      { name: m.homeTeam, league: m.league },
      { name: m.awayTeam, league: m.league },
    ]);
    try {
      // ✅ Timeout de 2.5s para evitar bloqueio da UI
      const logosPromise = getTeamLogosBatch(teamsToFetch);
      const timeoutPromise = new Promise<Map<string, string>>((resolve) => 
        setTimeout(() => resolve(new Map()), 2500)
      );
      
      const logos = await Promise.race([logosPromise, timeoutPromise]);
      
      if (logos.size > 0) {
          for (const match of allMatches) {
            if (logos.has(match.homeTeam)) match.homeTeamLogo = logos.get(match.homeTeam);
            if (logos.has(match.awayTeam)) match.awayTeamLogo = logos.get(match.awayTeam);
          }
      } else {
          // Silencioso em produção
          // console.debug('⚠️ Timeout ao buscar logos (continuando sem logos)');
      }
    } catch (error) {
      console.warn('⚠️ Erro ao buscar logos:', error);
    }
  }

  // Ordenar por horário
  allMatches.sort((a, b) => {
    const timeA = new Date(a.startTime || 0).getTime();
    const timeB = new Date(b.startTime || 0).getTime();
    return timeA - timeB;
  });

  // Limitar resultados para não sobrecarregar o frontend
  // Reduzido de 150 para 40 conforme solicitação para melhorar performance
  const limitedMatches = allMatches.slice(0, 40);

  console.log(`✅ Total Pré-jogos (API-Football): ${limitedMatches.length}`);

  if (limitedMatches.length > 0) {
      cachedUpcomingMatches = limitedMatches;
      lastUpcomingUpdate = now;
  } else {
      console.warn('⚠️ Lista de pré-jogos vazia - não cacheando');
  }

  return limitedMatches;
}

export function mapSportKey(sportKey: string): string {
  // Implementação compatível com legado se necessário
  return 'football';
}

export function mapLeagueName(sportKey: string): string {
  return sportKey;
}
