import { apiCache } from '../../apiCache';
import { apiFootballRequest } from '../../../lib/api';

// ============================================
// TYPES - Estatísticas Específicas por Desporto
// ============================================

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

// ⚽ FUTEBOL
export interface FootballStats {
  sport: 'football';
  fixtureId: string;
  team: {
    id: number;
    name: string;
    logo: string;
  };
  statistics: {
    // Posse e Controlo
    ballPossession: number;           // % posse de bola
    expectedGoals: number;            // xG
    
    // Ataques
    totalAttacks: number;
    dangerousAttacks: number;
    
    // Remates
    shotsTotal: number;
    shotsOnTarget: number;
    shotsOffTarget: number;
    shotsBlocked: number;
    shotsInsideBox: number;
    shotsOutsideBox: number;
    
    // Passes
    passesTotal: number;
    passesAccurate: number;
    passesAccuracy: number;           // %
    
    // Bolas Paradas
    corners: number;
    offsides: number;
    fouls: number;
    
    // Disciplina
    yellowCards: number;
    redCards: number;
    
    // Guarda-Redes
    saves: number;
    goalkeeperSaves: number;
  };
}

// 🏀 BASQUETEBOL
export interface BasketballStats {
  sport: 'basketball';
  fixtureId: string;
  team: {
    id: number;
    name: string;
    logo: string;
  };
  statistics: {
    // Pontuação
    points: number;
    pointsByQuarter: number[];        // [Q1, Q2, Q3, Q4]
    
    // Arremessos
    fieldGoalsMade: number;
    fieldGoalsAttempted: number;
    fieldGoalPercentage: number;      // %
    
    threePointersMade: number;
    threePointersAttempted: number;
    threePointPercentage: number;     // %
    
    freeThrowsMade: number;
    freeThrowsAttempted: number;
    freeThrowPercentage: number;      // %
    
    // Rebotes
    reboundsOffensive: number;
    reboundsDefensive: number;
    reboundsTotal: number;
    
    // Jogadas
    assists: number;
    steals: number;
    blocks: number;
    turnovers: number;
    
    // Faltas
    fouls: number;
    timeouts: number;
  };
}

// ⚾ BASEBOL
export interface BaseballStats {
  sport: 'baseball';
  fixtureId: string;
  team: {
    id: number;
    name: string;
    logo: string;
  };
  statistics: {
    // Pontuação
    runs: number;
    runsByInning: number[];           // Runs por inning
    
    // Rebatidas
    hits: number;
    doubles: number;
    triples: number;
    homeRuns: number;
    
    // Bases
    stolenBases: number;
    caughtStealing: number;
    leftOnBase: number;
    
    // Arremessos
    strikeouts: number;
    walks: number;
    hitByPitch: number;
    
    // Defesa
    errors: number;
    doublePlays: number;
    
    // Pitcher Stats
    pitchesThrown: number;
    earnedRuns: number;
  };
}

// 🏒 HÓQUEI
export interface HockeyStats {
  sport: 'hockey';
  fixtureId: string;
  team: {
    id: number;
    name: string;
    logo: string;
  };
  statistics: {
    // Pontuação
    goals: number;
    goalsByPeriod: number[];          // [P1, P2, P3, OT]
    
    // Remates
    shots: number;
    shotsOnGoal: number;
    shotPercentage: number;           // %
    
    // Power Play
    powerPlayGoals: number;
    powerPlayOpportunities: number;
    powerPlayPercentage: number;      // %
    
    // Penalty Kill
    penaltyKillSuccesses: number;
    penaltyKillOpportunities: number;
    penaltyKillPercentage: number;    // %
    
    // Faceoffs
    faceoffsWon: number;
    faceoffsLost: number;
    faceoffPercentage: number;        // %
    
    // Defesa
    saves: number;
    savePercentage: number;           // %
    blockedShots: number;
    
    // Penalidades
    penalties: number;
    penaltyMinutes: number;
    
    // Outros
    hits: number;
    giveaways: number;
    takeaways: number;
  };
}

// 🏉 RUGBY
export interface RugbyStats {
  sport: 'rugby';
  fixtureId: string;
  team: {
    id: number;
    name: string;
    logo: string;
  };
  statistics: {
    // Pontuação
    points: number;
    tries: number;
    conversions: number;
    penaltyGoals: number;
    dropGoals: number;
    
    // Posse
    possession: number;               // %
    territory: number;                // %
    
    // Ataque
    carries: number;
    metersGained: number;
    lineBreaks: number;
    defendersBeaten: number;
    offloads: number;
    
    // Defesa
    tackles: number;
    tacklesMissed: number;
    tackleSuccessRate: number;        // %
    turnoversWon: number;
    
    // Bolas Paradas
    scrums: number;
    scrumsWon: number;
    lineouts: number;
    lineoutsWon: number;
    
    // Disciplina
    penalties: number;
    yellowCards: number;
    redCards: number;
  };
}

// 🏐 VOLEIBOL
export interface VolleyballStats {
  sport: 'volleyball';
  fixtureId: string;
  team: {
    id: number;
    name: string;
    logo: string;
  };
  statistics: {
    // Pontuação
    points: number;
    pointsBySet: number[];            // Pontos por set
    setsWon: number;
    
    // Ataque
    attacks: number;
    attacksSuccessful: number;
    attackPercentage: number;         // %
    aces: number;
    
    // Defesa
    blocks: number;
    digs: number;
    
    // Serviço
    serves: number;
    serviceErrors: number;
    
    // Receção
    receptions: number;
    receptionErrors: number;
    receptionPercentage: number;      // %
    
    // Outros
    errors: number;
    timeouts: number;
  };
}

// 🏎️ FÓRMULA 1
export interface Formula1Stats {
  sport: 'formula1';
  raceId: string;
  driver: {
    id: number;
    name: string;
    number: number;
    team: string;
  };
  statistics: {
    // Posição
    position: number;
    gridPosition: number;
    positionsGained: number;
    
    // Voltas
    lapsCompleted: number;
    fastestLap: string;               // "1:23.456"
    fastestLapRank: number;
    
    // Pit Stops
    pitStops: number;
    pitStopTime: string;              // Tempo total em pit
    
    // Estratégia
    tireCompound: string[];           // ["Soft", "Medium", "Hard"]
    tireLaps: number[];               // Voltas por pneu
    
    // Performance
    topSpeed: number;                 // km/h
    averageSpeed: number;             // km/h
    
    // Status
    status: 'Finished' | 'DNF' | 'DNS' | 'Disqualified';
    dnfReason?: string;
    
    // Pontos
    points: number;
  };
}

// 🥊 MMA
export interface MMAStats {
  sport: 'mma';
  fightId: string;
  fighter: {
    id: number;
    name: string;
    nickname: string;
    weightClass: string;
  };
  statistics: {
    // Golpes
    significantStrikesLanded: number;
    significantStrikesAttempted: number;
    significantStrikeAccuracy: number; // %
    
    totalStrikesLanded: number;
    totalStrikesAttempted: number;
    
    // Golpes por Área
    headStrikesLanded: number;
    bodyStrikesLanded: number;
    legStrikesLanded: number;
    
    // Quedas
    takedownsLanded: number;
    takedownsAttempted: number;
    takedownAccuracy: number;         // %
    
    // Controlo
    controlTime: string;              // "5:23"
    
    // Finalizações
    submissionAttempts: number;
    
    // Defesa
    knockdowns: number;
    reversals: number;
  };
}

// 🏈 NFL
export interface NFLStats {
  sport: 'nfl';
  fixtureId: string;
  team: {
    id: number;
    name: string;
    logo: string;
  };
  statistics: {
    // Pontuação
    points: number;
    pointsByQuarter: number[];        // [Q1, Q2, Q3, Q4]
    touchdowns: number;
    fieldGoals: number;
    
    // Passe
    passingYards: number;
    passingTouchdowns: number;
    completions: number;
    attempts: number;
    completionPercentage: number;     // %
    interceptions: number;
    sacks: number;
    
    // Corrida
    rushingYards: number;
    rushingTouchdowns: number;
    rushingAttempts: number;
    yardsPerRush: number;
    
    // Receção
    receivingYards: number;
    receptions: number;
    receivingTouchdowns: number;
    
    // Defesa
    tacklesTotal: number;
    tacklesForLoss: number;
    sacksDefense: number;
    interceptionsDefense: number;
    fumblesRecovered: number;
    
    // Outros
    penalties: number;
    penaltyYards: number;
    turnovers: number;
    timeOfPossession: string;         // "28:45"
    thirdDownConversions: string;     // "7/14"
    fourthDownConversions: string;    // "1/2"
  };
}

// 🏉 AFL (Australian Football)
export interface AFLStats {
  sport: 'afl';
  fixtureId: string;
  team: {
    id: number;
    name: string;
    logo: string;
  };
  statistics: {
    // Pontuação
    goals: number;                    // 6 pontos cada
    behinds: number;                  // 1 ponto cada
    totalPoints: number;              // goals*6 + behinds
    pointsByQuarter: number[];        // [Q1, Q2, Q3, Q4]
    
    // Posse
    disposals: number;
    kicks: number;
    handballs: number;
    
    // Marcações
    marks: number;
    marksInside50: number;
    contestedMarks: number;
    
    // Defesa
    tackles: number;
    tacklesInside50: number;
    
    // Outros
    hitouts: number;
    clearances: number;
    inside50s: number;
    reboundFrom50s: number;
    
    // Eficiência
    disposalEfficiency: number;       // %
    goalAccuracy: number;             // %
    
    // Disciplina
    freeKicksFor: number;
    freeKicksAgainst: number;
  };
}

// 🤾 ANDEBOL
export interface HandballStats {
  sport: 'handball';
  fixtureId: string;
  team: {
    id: number;
    name: string;
    logo: string;
  };
  statistics: {
    // Pontuação
    goals: number;
    goalsByHalf: number[];            // [1ª parte, 2ª parte]
    
    // Remates
    shots: number;
    shotsOnTarget: number;
    shotEfficiency: number;           // %
    
    // Tipos de Golo
    fastBreakGoals: number;
    sevenMeterGoals: number;
    sevenMeterAttempts: number;
    
    // Guarda-Redes
    saves: number;
    savePercentage: number;           // %
    
    // Posse
    possession: number;               // %
    attacks: number;
    
    // Defesa
    steals: number;
    blocks: number;
    
    // Disciplina
    turnovers: number;
    technicalFouls: number;
    suspensions: number;              // 2 minutos
    yellowCards: number;
    redCards: number;
    
    // Outros
    assists: number;
    timeouts: number;
  };
}

// União de todos os tipos
export type SportStats = 
  | FootballStats 
  | BasketballStats 
  | BaseballStats 
  | HockeyStats 
  | RugbyStats 
  | VolleyballStats 
  | Formula1Stats 
  | MMAStats 
  | NFLStats 
  | AFLStats 
  | HandballStats;

// ============================================
// FUNÇÕES DE BUSCA POR DESPORTO
// ============================================

const API_FOOTBALL_KEY = import.meta.env.VITE_API_FOOTBALL_KEY || '';
const BASE_URL = 'https://v3.football.api-sports.io';

// ⚽ FUTEBOL
export async function getFootballStatistics(fixtureId: string): Promise<FootballStats[]> {
  const cacheKey = `stats-football-${fixtureId}`;
  
  return apiCache.get<FootballStats[]>(
    cacheKey,
    async () => {
      try {
        // Validar e limpar o fixtureId
        const cleanId = fixtureId.replace(/[^0-9]/g, '');
        
        // Verificar se é um número válido
        if (!cleanId || isNaN(parseInt(cleanId))) {
          return [];
        }

        const response = await fetch(`${BASE_URL}/fixtures/statistics?fixture=${cleanId}`, {
          headers: {
            'x-rapidapi-key': API_FOOTBALL_KEY,
            'x-rapidapi-host': 'v3.football.api-sports.io'
          }
        });

        if (!response.ok) {
          return [];
        }

        const data = await response.json();
        
        // Verificar se há erro na resposta da API
        if (data.errors && Object.keys(data.errors).length > 0) {
          return [];
        }
        
        if (!data.response || data.response.length === 0) {
          return [];
        }

        const stats: FootballStats[] = data.response.map((teamData: any) => {
          const getStatValue = (type: string): number => {
            const stat = teamData.statistics.find((s: any) => s.type === type);
            if (!stat || !stat.value) return 0;
            const value = typeof stat.value === 'string' ? stat.value.replace('%', '') : stat.value;
            return parseFloat(value) || 0;
          };

          return {
            sport: 'football',
            fixtureId: cleanId,
            team: {
              id: teamData.team.id,
              name: teamData.team.name,
              logo: teamData.team.logo
            },
            statistics: {
              ballPossession: getStatValue('Ball Possession'),
              expectedGoals: getStatValue('expected_goals'),
              totalAttacks: getStatValue('Total attacks'),
              dangerousAttacks: getStatValue('Dangerous attacks'),
              shotsTotal: getStatValue('Total Shots'),
              shotsOnTarget: getStatValue('Shots on Goal'),
              shotsOffTarget: getStatValue('Shots off Goal'),
              shotsBlocked: getStatValue('Blocked Shots'),
              shotsInsideBox: getStatValue('Shots insidebox'),
              shotsOutsideBox: getStatValue('Shots outsidebox'),
              passesTotal: getStatValue('Total passes'),
              passesAccurate: getStatValue('Passes accurate'),
              passesAccuracy: getStatValue('Passes %'),
              corners: getStatValue('Corner Kicks'),
              offsides: getStatValue('Offsides'),
              fouls: getStatValue('Fouls'),
              yellowCards: getStatValue('Yellow Cards'),
              redCards: getStatValue('Red Cards'),
              saves: getStatValue('Goalkeeper Saves'),
              goalkeeperSaves: getStatValue('Goalkeeper Saves')
            }
          };
        });

        return stats;
      } catch {
        return [];
      }
    },
    60000 // 1 minuto
  );
}

// 🏀 BASQUETEBOL
export async function getBasketballStatistics(fixtureId: string): Promise<BasketballStats[]> {
  const cacheKey = `stats-basketball-${fixtureId}`;
  
  return apiCache.get<BasketballStats[]>(
    cacheKey,
    async () => {
      // Simulação - API-Football não tem basquetebol real
      const stats: BasketballStats[] = [
        {
          sport: 'basketball',
          fixtureId,
          team: { id: 1, name: 'Team A', logo: '' },
          statistics: {
            points: 98,
            pointsByQuarter: [24, 28, 22, 24],
            fieldGoalsMade: 38,
            fieldGoalsAttempted: 82,
            fieldGoalPercentage: 46.3,
            threePointersMade: 12,
            threePointersAttempted: 32,
            threePointPercentage: 37.5,
            freeThrowsMade: 10,
            freeThrowsAttempted: 14,
            freeThrowPercentage: 71.4,
            reboundsOffensive: 8,
            reboundsDefensive: 32,
            reboundsTotal: 40,
            assists: 22,
            steals: 7,
            blocks: 5,
            turnovers: 12,
            fouls: 18,
            timeouts: 4
          }
        },
        {
          sport: 'basketball',
          fixtureId,
          team: { id: 2, name: 'Team B', logo: '' },
          statistics: {
            points: 102,
            pointsByQuarter: [26, 24, 26, 26],
            fieldGoalsMade: 40,
            fieldGoalsAttempted: 85,
            fieldGoalPercentage: 47.1,
            threePointersMade: 14,
            threePointersAttempted: 35,
            threePointPercentage: 40.0,
            freeThrowsMade: 8,
            freeThrowsAttempted: 12,
            freeThrowPercentage: 66.7,
            reboundsOffensive: 10,
            reboundsDefensive: 30,
            reboundsTotal: 40,
            assists: 24,
            steals: 9,
            blocks: 6,
            turnovers: 10,
            fouls: 16,
            timeouts: 3
          }
        }
      ];
      return stats;
    },
    60000
  );
}

// ⚾ BASEBOL
export async function getBaseballStatistics(fixtureId: string): Promise<BaseballStats[]> {
  const cacheKey = `stats-baseball-${fixtureId}`;
  
  return apiCache.get<BaseballStats[]>(
    cacheKey,
    async () => {
      const stats: BaseballStats[] = [
        {
          sport: 'baseball',
          fixtureId,
          team: { id: 1, name: 'Team A', logo: '' },
          statistics: {
            runs: 5,
            runsByInning: [0, 2, 0, 1, 0, 0, 2, 0, 0],
            hits: 9,
            doubles: 2,
            triples: 1,
            homeRuns: 1,
            stolenBases: 2,
            caughtStealing: 1,
            leftOnBase: 7,
            strikeouts: 8,
            walks: 4,
            hitByPitch: 1,
            errors: 1,
            doublePlays: 2,
            pitchesThrown: 142,
            earnedRuns: 3
          }
        },
        {
          sport: 'baseball',
          fixtureId,
          team: { id: 2, name: 'Team B', logo: '' },
          statistics: {
            runs: 3,
            runsByInning: [1, 0, 0, 0, 2, 0, 0, 0, 0],
            hits: 7,
            doubles: 1,
            triples: 0,
            homeRuns: 1,
            stolenBases: 1,
            caughtStealing: 0,
            leftOnBase: 6,
            strikeouts: 10,
            walks: 3,
            hitByPitch: 0,
            errors: 2,
            doublePlays: 1,
            pitchesThrown: 138,
            earnedRuns: 5
          }
        }
      ];
      return stats;
    },
    60000
  );
}

// 🏒 HÓQUEI
export async function getHockeyStatistics(fixtureId: string): Promise<HockeyStats[]> {
  const cacheKey = `stats-hockey-${fixtureId}`;
  
  return apiCache.get<HockeyStats[]>(
    cacheKey,
    async () => {
      const stats: HockeyStats[] = [
        {
          sport: 'hockey',
          fixtureId,
          team: { id: 1, name: 'Team A', logo: '' },
          statistics: {
            goals: 3,
            goalsByPeriod: [1, 1, 1, 0],
            shots: 32,
            shotsOnGoal: 24,
            shotPercentage: 12.5,
            powerPlayGoals: 1,
            powerPlayOpportunities: 4,
            powerPlayPercentage: 25.0,
            penaltyKillSuccesses: 3,
            penaltyKillOpportunities: 4,
            penaltyKillPercentage: 75.0,
            faceoffsWon: 28,
            faceoffsLost: 30,
            faceoffPercentage: 48.3,
            saves: 25,
            savePercentage: 89.3,
            blockedShots: 18,
            penalties: 4,
            penaltyMinutes: 8,
            hits: 22,
            giveaways: 12,
            takeaways: 8
          }
        },
        {
          sport: 'hockey',
          fixtureId,
          team: { id: 2, name: 'Team B', logo: '' },
          statistics: {
            goals: 4,
            goalsByPeriod: [2, 0, 2, 0],
            shots: 28,
            shotsOnGoal: 28,
            shotPercentage: 14.3,
            powerPlayGoals: 1,
            powerPlayOpportunities: 4,
            powerPlayPercentage: 25.0,
            penaltyKillSuccesses: 3,
            penaltyKillOpportunities: 4,
            penaltyKillPercentage: 75.0,
            faceoffsWon: 30,
            faceoffsLost: 28,
            faceoffPercentage: 51.7,
            saves: 21,
            savePercentage: 87.5,
            blockedShots: 15,
            penalties: 4,
            penaltyMinutes: 8,
            hits: 26,
            giveaways: 10,
            takeaways: 10
          }
        }
      ];
      return stats;
    },
    60000
  );
}

// 🏉 RUGBY
export async function getRugbyStatistics(fixtureId: string): Promise<RugbyStats[]> {
  const cacheKey = `stats-rugby-${fixtureId}`;
  
  return apiCache.get<RugbyStats[]>(
    cacheKey,
    async () => {
      const stats: RugbyStats[] = [
        {
          sport: 'rugby',
          fixtureId,
          team: { id: 1, name: 'Team A', logo: '' },
          statistics: {
            points: 24,
            tries: 3,
            conversions: 2,
            penaltyGoals: 2,
            dropGoals: 0,
            possession: 52,
            territory: 55,
            carries: 142,
            metersGained: 380,
            lineBreaks: 8,
            defendersBeaten: 24,
            offloads: 12,
            tackles: 98,
            tacklesMissed: 18,
            tackleSuccessRate: 84.5,
            turnoversWon: 6,
            scrums: 12,
            scrumsWon: 10,
            lineouts: 14,
            lineoutsWon: 12,
            penalties: 8,
            yellowCards: 1,
            redCards: 0
          }
        },
        {
          sport: 'rugby',
          fixtureId,
          team: { id: 2, name: 'Team B', logo: '' },
          statistics: {
            points: 21,
            tries: 3,
            conversions: 3,
            penaltyGoals: 0,
            dropGoals: 0,
            possession: 48,
            territory: 45,
            carries: 128,
            metersGained: 340,
            lineBreaks: 6,
            defendersBeaten: 20,
            offloads: 10,
            tackles: 112,
            tacklesMissed: 22,
            tackleSuccessRate: 83.6,
            turnoversWon: 4,
            scrums: 12,
            scrumsWon: 11,
            lineouts: 14,
            lineoutsWon: 13,
            penalties: 10,
            yellowCards: 0,
            redCards: 0
          }
        }
      ];
      return stats;
    },
    60000
  );
}

// 🏐 VOLEIBOL
export async function getVolleyballStatistics(fixtureId: string): Promise<VolleyballStats[]> {
  const cacheKey = `stats-volleyball-${fixtureId}`;
  
  return apiCache.get<VolleyballStats[]>(
    cacheKey,
    async () => {
      const stats: VolleyballStats[] = [
        {
          sport: 'volleyball',
          fixtureId,
          team: { id: 1, name: 'Team A', logo: '' },
          statistics: {
            points: 75,
            pointsBySet: [25, 23, 27],
            setsWon: 3,
            attacks: 142,
            attacksSuccessful: 58,
            attackPercentage: 40.8,
            aces: 8,
            blocks: 12,
            digs: 48,
            serves: 85,
            serviceErrors: 6,
            receptions: 72,
            receptionErrors: 4,
            receptionPercentage: 94.4,
            errors: 18,
            timeouts: 4
          }
        },
        {
          sport: 'volleyball',
          fixtureId,
          team: { id: 2, name: 'Team B', logo: '' },
          statistics: {
            points: 69,
            pointsBySet: [22, 25, 22],
            setsWon: 1,
            attacks: 138,
            attacksSuccessful: 52,
            attackPercentage: 37.7,
            aces: 6,
            blocks: 10,
            digs: 52,
            serves: 82,
            serviceErrors: 8,
            receptions: 68,
            receptionErrors: 6,
            receptionPercentage: 91.2,
            errors: 22,
            timeouts: 5
          }
        }
      ];
      return stats;
    },
    60000
  );
}

// 🏎️ FÓRMULA 1
export async function getFormula1Statistics(raceId: string): Promise<Formula1Stats[]> {
  const cacheKey = `stats-formula1-${raceId}`;
  
  return apiCache.get<Formula1Stats[]>(
    cacheKey,
    async () => {
      const stats: Formula1Stats[] = [
        {
          sport: 'formula1',
          raceId,
          driver: { id: 1, name: 'Max Verstappen', number: 1, team: 'Red Bull Racing' },
          statistics: {
            position: 1,
            gridPosition: 2,
            positionsGained: 1,
            lapsCompleted: 58,
            fastestLap: '1:18.446',
            fastestLapRank: 1,
            pitStops: 2,
            pitStopTime: '42.3s',
            tireCompound: ['Soft', 'Medium', 'Hard'],
            tireLaps: [18, 22, 18],
            topSpeed: 342,
            averageSpeed: 218,
            status: 'Finished',
            points: 25
          }
        },
        {
          sport: 'formula1',
          raceId,
          driver: { id: 2, name: 'Lewis Hamilton', number: 44, team: 'Mercedes' },
          statistics: {
            position: 2,
            gridPosition: 1,
            positionsGained: -1,
            lapsCompleted: 58,
            fastestLap: '1:18.892',
            fastestLapRank: 3,
            pitStops: 2,
            pitStopTime: '44.1s',
            tireCompound: ['Soft', 'Medium', 'Hard'],
            tireLaps: [16, 24, 18],
            topSpeed: 338,
            averageSpeed: 216,
            status: 'Finished',
            points: 18
          }
        }
      ];
      return stats;
    },
    60000
  );
}

// 🥊 MMA
export async function getMMAStatistics(fightId: string): Promise<MMAStats[]> {
  const cacheKey = `stats-mma-${fightId}`;
  
  return apiCache.get<MMAStats[]>(
    cacheKey,
    async () => {
      const stats: MMAStats[] = [
        {
          sport: 'mma',
          fightId,
          fighter: { id: 1, name: 'Conor McGregor', nickname: 'The Notorious', weightClass: 'Lightweight' },
          statistics: {
            significantStrikesLanded: 48,
            significantStrikesAttempted: 92,
            significantStrikeAccuracy: 52.2,
            totalStrikesLanded: 62,
            totalStrikesAttempted: 108,
            headStrikesLanded: 32,
            bodyStrikesLanded: 12,
            legStrikesLanded: 4,
            takedownsLanded: 2,
            takedownsAttempted: 5,
            takedownAccuracy: 40.0,
            controlTime: '3:24',
            submissionAttempts: 1,
            knockdowns: 2,
            reversals: 1
          }
        },
        {
          sport: 'mma',
          fightId,
          fighter: { id: 2, name: 'Khabib Nurmagomedov', nickname: 'The Eagle', weightClass: 'Lightweight' },
          statistics: {
            significantStrikesLanded: 38,
            significantStrikesAttempted: 72,
            significantStrikeAccuracy: 52.8,
            totalStrikesLanded: 52,
            totalStrikesAttempted: 88,
            headStrikesLanded: 24,
            bodyStrikesLanded: 10,
            legStrikesLanded: 4,
            takedownsLanded: 6,
            takedownsAttempted: 8,
            takedownAccuracy: 75.0,
            controlTime: '8:42',
            submissionAttempts: 3,
            knockdowns: 0,
            reversals: 2
          }
        }
      ];
      return stats;
    },
    60000
  );
}

// 🏈 NFL
export async function getNFLStatistics(fixtureId: string): Promise<NFLStats[]> {
  const cacheKey = `stats-nfl-${fixtureId}`;
  
  return apiCache.get<NFLStats[]>(
    cacheKey,
    async () => {
      const stats: NFLStats[] = [
        {
          sport: 'nfl',
          fixtureId,
          team: { id: 1, name: 'Kansas City Chiefs', logo: '' },
          statistics: {
            points: 31,
            pointsByQuarter: [7, 10, 7, 7],
            touchdowns: 4,
            fieldGoals: 1,
            passingYards: 342,
            passingTouchdowns: 3,
            completions: 28,
            attempts: 38,
            completionPercentage: 73.7,
            interceptions: 1,
            sacks: 2,
            rushingYards: 128,
            rushingTouchdowns: 1,
            rushingAttempts: 24,
            yardsPerRush: 5.3,
            receivingYards: 342,
            receptions: 28,
            receivingTouchdowns: 3,
            tacklesTotal: 52,
            tacklesForLoss: 6,
            sacksDefense: 3,
            interceptionsDefense: 1,
            fumblesRecovered: 1,
            penalties: 6,
            penaltyYards: 48,
            turnovers: 2,
            timeOfPossession: '32:18',
            thirdDownConversions: '8/14',
            fourthDownConversions: '1/2'
          }
        },
        {
          sport: 'nfl',
          fixtureId,
          team: { id: 2, name: 'Buffalo Bills', logo: '' },
          statistics: {
            points: 24,
            pointsByQuarter: [3, 7, 7, 7],
            touchdowns: 3,
            fieldGoals: 1,
            passingYards: 298,
            passingTouchdowns: 2,
            completions: 24,
            attempts: 36,
            completionPercentage: 66.7,
            interceptions: 1,
            sacks: 3,
            rushingYards: 92,
            rushingTouchdowns: 1,
            rushingAttempts: 18,
            yardsPerRush: 5.1,
            receivingYards: 298,
            receptions: 24,
            receivingTouchdowns: 2,
            tacklesTotal: 48,
            tacklesForLoss: 4,
            sacksDefense: 2,
            interceptionsDefense: 1,
            fumblesRecovered: 0,
            penalties: 8,
            penaltyYards: 64,
            turnovers: 2,
            timeOfPossession: '27:42',
            thirdDownConversions: '6/13',
            fourthDownConversions: '0/1'
          }
        }
      ];
      return stats;
    },
    60000
  );
}

// 🏉 AFL
export async function getAFLStatistics(fixtureId: string): Promise<AFLStats[]> {
  const cacheKey = `stats-afl-${fixtureId}`;
  
  return apiCache.get<AFLStats[]>(
    cacheKey,
    async () => {
      const stats: AFLStats[] = [
        {
          sport: 'afl',
          fixtureId,
          team: { id: 1, name: 'Richmond Tigers', logo: '' },
          statistics: {
            goals: 14,
            behinds: 12,
            totalPoints: 96,
            pointsByQuarter: [24, 28, 22, 22],
            disposals: 382,
            kicks: 242,
            handballs: 140,
            marks: 88,
            marksInside50: 18,
            contestedMarks: 12,
            tackles: 68,
            tacklesInside50: 14,
            hitouts: 42,
            clearances: 38,
            inside50s: 58,
            reboundFrom50s: 32,
            disposalEfficiency: 72.5,
            goalAccuracy: 53.8,
            freeKicksFor: 18,
            freeKicksAgainst: 22
          }
        },
        {
          sport: 'afl',
          fixtureId,
          team: { id: 2, name: 'Collingwood Magpies', logo: '' },
          statistics: {
            goals: 12,
            behinds: 14,
            totalPoints: 86,
            pointsByQuarter: [22, 20, 24, 20],
            disposals: 368,
            kicks: 228,
            handballs: 140,
            marks: 82,
            marksInside50: 14,
            contestedMarks: 10,
            tackles: 72,
            tacklesInside50: 12,
            hitouts: 38,
            clearances: 34,
            inside50s: 52,
            reboundFrom50s: 28,
            disposalEfficiency: 70.2,
            goalAccuracy: 46.2,
            freeKicksFor: 22,
            freeKicksAgainst: 18
          }
        }
      ];
      return stats;
    },
    60000
  );
}

// 🤾 ANDEBOL
export async function getHandballStatistics(fixtureId: string): Promise<HandballStats[]> {
  const cacheKey = `stats-handball-${fixtureId}`;
  
  return apiCache.get<HandballStats[]>(
    cacheKey,
    async () => {
      const stats: HandballStats[] = [
        {
          sport: 'handball',
          fixtureId,
          team: { id: 1, name: 'Team A', logo: '' },
          statistics: {
            goals: 28,
            goalsByHalf: [14, 14],
            shots: 52,
            shotsOnTarget: 38,
            shotEfficiency: 53.8,
            fastBreakGoals: 6,
            sevenMeterGoals: 4,
            sevenMeterAttempts: 5,
            saves: 18,
            savePercentage: 36.0,
            possession: 52,
            attacks: 58,
            steals: 8,
            blocks: 6,
            turnovers: 12,
            technicalFouls: 4,
            suspensions: 3,
            yellowCards: 2,
            redCards: 0,
            assists: 18,
            timeouts: 2
          }
        },
        {
          sport: 'handball',
          fixtureId,
          team: { id: 2, name: 'Team B', logo: '' },
          statistics: {
            goals: 26,
            goalsByHalf: [12, 14],
            shots: 50,
            shotsOnTarget: 34,
            shotEfficiency: 52.0,
            fastBreakGoals: 5,
            sevenMeterGoals: 3,
            sevenMeterAttempts: 4,
            saves: 20,
            savePercentage: 38.5,
            possession: 48,
            attacks: 54,
            steals: 6,
            blocks: 4,
            turnovers: 14,
            technicalFouls: 6,
            suspensions: 4,
            yellowCards: 3,
            redCards: 0,
            assists: 16,
            timeouts: 3
          }
        }
      ];
      return stats;
    },
    60000
  );
}

// ============================================
// FUNÇÃO GENÉRICA - BUSCAR POR DESPORTO
// ============================================

export async function getStatisticsBySport(sport: SportType, fixtureId: string): Promise<SportStats[]> {
  switch (sport) {
    case 'football':
      return getFootballStatistics(fixtureId);
    case 'basketball':
      return getBasketballStatistics(fixtureId);
    case 'baseball':
      return getBaseballStatistics(fixtureId);
    case 'hockey':
      return getHockeyStatistics(fixtureId);
    case 'rugby':
      return getRugbyStatistics(fixtureId);
    case 'volleyball':
      return getVolleyballStatistics(fixtureId);
    case 'formula1':
      return getFormula1Statistics(fixtureId);
    case 'mma':
      return getMMAStatistics(fixtureId);
    case 'nfl':
      return getNFLStatistics(fixtureId);
    case 'afl':
      return getAFLStatistics(fixtureId);
    case 'handball':
      return getHandballStatistics(fixtureId);
    default:
      return [];
  }
}

// ============================================
// FUNÇÕES HELPER
// ============================================

// Limpar cache de estatísticas
export function clearStatisticsCache(): void {
  const keys = apiCache.keys();
  keys.forEach(key => {
    if (key.startsWith('stats-')) {
      apiCache.delete(key);
    }
  });
}

// Obter estatísticas do cache
export function getStatisticsCacheStats() {
  const keys = apiCache.keys();
  const statsKeys = keys.filter(key => key.startsWith('stats-'));
  
  return {
    total: statsKeys.length,
    bySport: {
      football: statsKeys.filter(k => k.includes('football')).length,
      basketball: statsKeys.filter(k => k.includes('basketball')).length,
      baseball: statsKeys.filter(k => k.includes('baseball')).length,
      hockey: statsKeys.filter(k => k.includes('hockey')).length,
      rugby: statsKeys.filter(k => k.includes('rugby')).length,
      volleyball: statsKeys.filter(k => k.includes('volleyball')).length,
      formula1: statsKeys.filter(k => k.includes('formula1')).length,
      mma: statsKeys.filter(k => k.includes('mma')).length,
      nfl: statsKeys.filter(k => k.includes('nfl')).length,
      afl: statsKeys.filter(k => k.includes('afl')).length,
      handball: statsKeys.filter(k => k.includes('handball')).length
    }
  };
}

// Verificar se estatísticas estão disponíveis
export function hasStatistics(stats: SportStats[]): boolean {
  return stats.length > 0;
}

// Obter estatística específica de uma equipa
export function getTeamStats(stats: SportStats[], teamId: number): SportStats | undefined {
  return stats.find(s => 'team' in s && s.team.id === teamId);
}

// Comparar estatísticas entre duas equipas
export function compareTeamStats(stats: SportStats[]): { team1: SportStats | undefined; team2: SportStats | undefined } {
  return {
    team1: stats[0],
    team2: stats[1]
  };
}

export async function fetchMatchStatistics(fixtureId: string | number) {
  try {
    // Limpa o ID
    const cleanId = fixtureId.toString().replace('football-', '').replace(/[^0-9]/g, '');
    
    console.log('📊 [Statistics] ID original:', fixtureId);
    console.log('📊 [Statistics] ID limpo:', cleanId);

    if (!cleanId || cleanId === '' || cleanId === 'undefined') {
      console.error('❌ [Statistics] ID inválido:', fixtureId);
      return null;
    }

    const data = await apiFootballRequest(`/fixtures/statistics?fixture=${cleanId}`);
    
    console.log('📊 [Statistics] Dados recebidos:', data?.response?.length || 0);
    
    return data?.response?.[0] || null;
  } catch (error) {
    console.error('🔴 [Statistics] Erro ao buscar estatísticas:', error);
    return null;
  }
}
