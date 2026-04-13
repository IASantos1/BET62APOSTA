import axios from 'axios';
import { isMatch, normalizeName } from '../utils/fuzzyMatch.js';
import { getOddsApiSportKey } from '../mappings/leagueMapping.js';
import { resolveTeamName } from '../mappings/teamAliases.js';

// Documentação: https://odds-api.io/
// BASE URL CORRETA para Odds-API.io (Versão 3)
const BASE_URL = 'https://api.odds-api.io/v3'; 
const API_KEY = process.env.ODDS_API_KEY || process.env.VITE_ODDS_API_KEY || '61ef74dbd3ac486bebdf9832c93e87b4e5fd11624c29ad3b4f1a9a062241d8dc';

// Cache simples em memória
const cache: Record<string, { data: any; timestamp: number }> = {};
const CACHE_TTL = 2 * 60 * 1000; // 2 minutos

export interface OddsApiIoEvent {
  id: number;
  sport_id: number;
  league_id: number;
  home_team_id: number;
  away_team_id: number;
  start_at?: string; 
  commence_time?: string;
  home_team?: { name: string } | string;
  away_team?: { name: string } | string;
  homeTeam?: { name: string } | string;
  awayTeam?: { name: string } | string;
  league: any;
  odds?: any[];
  bookmakers?: any[]; // Adicionado suporte a 'bookmakers'
}



export async function fetchOdds(sportKey: string): Promise<OddsApiIoEvent[] | null> {
  try {
    // 1. Fetch Events
    const eventsUrl = `${BASE_URL}/events`;
    console.log(`[Odds-API.io] Fetching events for ${sportKey}...`);
    
    const eventsResponse = await axios.get(eventsUrl, {
      params: {
        apiKey: API_KEY,
        sport: sportKey,
        limit: 50 // Limite razoável para testes e live
      },
    });

    const events = eventsResponse.data;
    if (!Array.isArray(events) || events.length === 0) {
      console.log('[Odds-API.io] No events found.');
      return [];
    }

    // 2. Fetch Odds for each event (Concurrency limited)
    const limit = 5; 
    const targetEvents = events.slice(0, limit);
    
    const oddsPromises = targetEvents.map(async (event: any) => {
      try {
        const oddsUrl = `${BASE_URL}/odds`;
        const oddsRes = await axios.get(oddsUrl, {
          params: {
            apiKey: API_KEY,
            eventId: event.id,
            bookmakers: 'Bet365,1xbet' // Solicitar bookmakers específicos (1xbet lowercase)
          }
        });
        return oddsRes.data;
      } catch (err) {
        return null;
      }
    });

    const oddsResults = await Promise.all(oddsPromises);
    const validOdds = oddsResults.filter((o): o is any => o !== null); // Type guard filter
    
    // Transformar para o formato esperado pelo Frontend (OddsApiIoEvent interface)
    const transformedOdds = validOdds.map(event => {
       // Normalizar bookmakers (pode vir como array ou objeto dependendo do endpoint/versão)
       let bookmakersList: any[] = [];
       if (Array.isArray(event.bookmakers)) {
           bookmakersList = event.bookmakers;
       } else if (typeof event.bookmakers === 'object' && event.bookmakers !== null) {
           bookmakersList = Object.values(event.bookmakers);
       }

       // Prioridade: Bet365 > 1xbet > Betano > Betclic > Superbet > Primeiro disponível
       let selectedBookmaker = bookmakersList.find((b: any) => b.name === 'Bet365' || b.slug === 'bet365');
       if (!selectedBookmaker) {
           selectedBookmaker = bookmakersList.find((b: any) => b.name === '1xbet' || b.name === '1xBet' || b.slug === '1xbet');
       }
       if (!selectedBookmaker) {
           selectedBookmaker = bookmakersList.find((b: any) => b.name === 'Betano' || b.slug === 'betano');
       }
       if (!selectedBookmaker) {
           selectedBookmaker = bookmakersList.find((b: any) => b.name === 'Betclic' || b.name === 'BetClic' || b.slug === 'betclic');
       }
       if (!selectedBookmaker) {
           selectedBookmaker = bookmakersList.find((b: any) => b.name === 'Superbet' || b.slug === 'superbet');
       }
       if (!selectedBookmaker && bookmakersList.length > 0) {
           selectedBookmaker = bookmakersList[0];
       }
       
       if (!selectedBookmaker) return event; 

       const markets = selectedBookmaker.bets || selectedBookmaker.markets || [];

       // Mapear mercados para o formato simplificado
       const odds = markets.map((m: any) => {
          // Normalizar nome do mercado
          let marketName = m.name;
          if (marketName === 'ML' || marketName === 'Moneyline') marketName = 'Match Winner';
          
          // Normalizar values
          const outcomes = m.odds || m.outcomes || m.values || [];
          const values = outcomes.map((v: any) => {
             let label = v.name || v.value || v.label;
             if (label === '1' || label === event.home || label === event.home_team) label = 'Home';
             if (label === '2' || label === event.away || label === event.away_team) label = 'Away';
             if (label === 'X' || label === 'Draw') label = 'Draw';
             
             return {
                value: label,
                odd: String(v.price || v.odd)
             };
          }).filter((v: any) => v !== null);

          return {
             market_name: marketName,
             values
          };
       });

       return {
          ...event,
          odds // Sobrescreve ou adiciona a propriedade odds
       };
    });

    console.log(`[Odds-API.io] Successfully fetched odds for ${transformedOdds.length} events.`);
    return transformedOdds as OddsApiIoEvent[]; // Cast to expected type

  } catch (error) {
    console.error('Error fetching odds flow:', error);
    return null;
  }
}

function mapOddsApiIoToApiFootballFormat(event: any, fixtureId: number): any {
  // 1. Verificar se já temos odds transformadas (pelo fetchOdds)
  if (event.odds && Array.isArray(event.odds) && event.odds.length > 0) {
      const matchWinner = event.odds.find((o: any) => o.market_name === 'Match Winner');
      if (matchWinner && matchWinner.values) {
          return {
            fixture: { id: fixtureId },
            update: new Date().toISOString(),
            bookmakers: [
              {
                id: 1, // ID genérico
                name: "Odds-API.io",
                bets: [
                  {
                    id: 1,
                    name: "Match Winner",
                    values: matchWinner.values
                  }
                ]
              }
            ]
          };
      }
  }

  // 2. Normalizar acesso aos dados de odds/bookmakers (FALLBACK LEGADO)
  // Na resposta de /odds por eventId, os bookmakers estão em 'bookmakers' (objeto ou array)
  const bookmakersData = event.bookmakers;

  if (!bookmakersData) return null;

  // Normalizar para Array
  let bookmakersList: any[] = [];
  if (Array.isArray(bookmakersData)) {
      bookmakersList = bookmakersData;
  } else if (typeof bookmakersData === 'object') {
      bookmakersList = Object.values(bookmakersData);
  }

  // 3. Tentar encontrar Bet365 ou 1xbet
  let selectedBookmaker = bookmakersList.find((b: any) => b.name === 'Bet365' || b.slug === 'bet365');
  if (!selectedBookmaker) {
      selectedBookmaker = bookmakersList.find((b: any) => b.name === '1xbet' || b.name === '1xBet' || b.slug === '1xbet');
  }
  if (!selectedBookmaker) {
      selectedBookmaker = bookmakersList.find((b: any) => b.name === 'Betano' || b.slug === 'betano');
  }
  if (!selectedBookmaker) {
      selectedBookmaker = bookmakersList.find((b: any) => b.name === 'Betclic' || b.name === 'BetClic' || b.slug === 'betclic');
  }
  if (!selectedBookmaker) {
      selectedBookmaker = bookmakersList.find((b: any) => b.name === 'Superbet' || b.slug === 'superbet');
  }
  if (!selectedBookmaker && bookmakersList.length > 0) {
      selectedBookmaker = bookmakersList[0];
  }
  
  if (!selectedBookmaker) return null;

  // 4. Encontrar mercado Match Winner (ML, 1x2)
  const markets = selectedBookmaker.bets || selectedBookmaker.markets || [];
  if (!Array.isArray(markets)) return null;

  const matchWinnerMarket = markets.find((m: any) => 
    m.name === 'ML' || m.name === '1x2' || m.name === 'Match Winner' || m.key === 'h2h'
  );

  if (!matchWinnerMarket) return null;

  // 5. Normalizar valores das odds
  const outcomes = matchWinnerMarket.odds || matchWinnerMarket.outcomes || matchWinnerMarket.values;
  
  if (!Array.isArray(outcomes)) return null;

  const formattedValues = outcomes.map((v: any) => {
      let label = v.name || v.value || v.label;
      if (label === '1' || label === event.home || label === event.home_team) label = 'Home';
      if (label === '2' || label === event.away || label === event.away_team) label = 'Away';
      if (label === 'X' || label === 'Draw') label = 'Draw';
      
      return {
          value: label,
          odd: String(v.price || v.odd)
      };
  }).filter((v: any) => v && (v.value === 'Home' || v.value === 'Draw' || v.value === 'Away'));

  return {
    fixture: { id: fixtureId },
    update: new Date().toISOString(),
    bookmakers: [
      {
        id: selectedBookmaker.key === 'bet365' ? 1 : selectedBookmaker.key === '1xbet' ? 2 : 99,
        name: selectedBookmaker.title || selectedBookmaker.name || "Odds-API.io",
        bets: [
          {
            id: 1,
            name: "Match Winner",
            values: formattedValues
          }
        ]
      }
    ]
  };
}

export async function fetchOddsFromOddsApiIo(sportKey: string): Promise<OddsApiIoEvent[]> {
  const data = await fetchOdds(sportKey);
  if (!data) return [];
  // Adaptar retorno se necessário, dependendo da estrutura de /odds
  // fetchOdds já retorna OddsApiIoEvent[] ou null, então podemos retornar data diretamente se for array
  return data;
}

export function findOddsForNames(
  fixtureId: number, 
  fixtureDate: Date, 
  homeName: string, 
  awayName: string, 
  oddsEvents: OddsApiIoEvent[]
): any | null {
  const fixtureTime = fixtureDate.getTime();

  // Filtragem inicial por data (janela de 24h)
  const candidates = oddsEvents.filter((event) => {
    // Odds-API.io retorna datas em string, precisamos parsear
    // Formato provável: YYYY-MM-DD HH:mm:ss ou ISO
    // Tenta 'start_at' ou 'commence_time'
    const dateStr = event.start_at || (event as any).commence_time;
    if (!dateStr) return false;

    const eventDate = new Date(dateStr).getTime();
    const diffHours = Math.abs(eventDate - fixtureTime) / (1000 * 60 * 60);
    return diffHours < 30; // Janela um pouco maior
  });

  for (const event of candidates) {
    // Tratamento para variações de estrutura da API (alguns endpoints retornam string, outros objeto)
    // Tenta pegar 'name' de objeto ou usa string direta
    const homeObj = event.home_team || (event as any).homeTeam;
    const awayObj = event.away_team || (event as any).awayTeam;
    
    const eventHome = typeof homeObj === 'string' ? homeObj : (homeObj?.name || '');
    const eventAway = typeof awayObj === 'string' ? awayObj : (awayObj?.name || '');

    if (!eventHome || !eventAway) continue;

    // 1. Matching Exato
    const homeMatchExact = isMatch(homeName, eventHome, 0.95); 
    const awayMatchExact = isMatch(awayName, eventAway, 0.95);

    if (homeMatchExact && awayMatchExact) {
       return mapOddsApiIoToApiFootballFormat(event, fixtureId);
    }

    // 2. Fuzzy Matching
    const homeMatchFuzzy = isMatch(homeName, eventHome, 0.70);
    const awayMatchFuzzy = isMatch(awayName, eventAway, 0.70);

    if (homeMatchFuzzy && awayMatchFuzzy) {
      return mapOddsApiIoToApiFootballFormat(event, fixtureId);
    }
  }

  return null;
}

// Função para encontrar odds correspondentes a um fixture da API-Football
export function findOddsForFixtureIo(fixture: any, oddsEvents: OddsApiIoEvent[]): any | null {
  if (!fixture || !fixture.teams || !fixture.fixture) return null;
  return findOddsForNames(
    fixture.fixture.id, 
    new Date(fixture.fixture.date), 
    fixture.teams.home.name, 
    fixture.teams.away.name, 
    oddsEvents
  );
}
