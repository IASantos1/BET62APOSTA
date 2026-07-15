/**
 * Hook para buscar estatísticas reais de jogos da API-Football
 * Inclui: estatísticas, escalações, eventos e lances perigosos
 */

import { useState, useEffect, useCallback, useMemo } from 'react';

// All API-Football calls go through the backend proxy — no API keys in the browser

// ═══════════════════════════════════════════════════════════
// TIPOS
// ═══════════════════════════════════════════════════════════

export interface MatchStatistic {
  type: string;
  value: number | string | null;
}

export interface TeamStatistics {
  team: {
    id: number;
    name: string;
    logo: string;
  };
  statistics: MatchStatistic[];
}

export interface Player {
  id: number;
  name: string;
  number: number;
  pos: string;
  grid: string | null;
}

export interface TeamLineup {
  team: {
    id: number;
    name: string;
    logo: string;
    colors: {
      player: { primary: string; number: string; border: string };
      goalkeeper: { primary: string; number: string; border: string };
    } | null;
  };
  formation: string;
  startXI: Array<{ player: Player }>;
  substitutes: Array<{ player: Player }>;
  coach: {
    id: number;
    name: string;
    photo: string;
  };
}

export interface MatchEvent {
  time: {
    elapsed: number;
    extra: number | null;
  };
  team: {
    id: number;
    name: string;
    logo: string;
  };
  player: {
    id: number;
    name: string;
  };
  assist: {
    id: number | null;
    name: string | null;
  };
  type: 'Goal' | 'Card' | 'subst' | 'Var';
  detail: string;
  comments: string | null;
}

export interface ParsedStatistics {
  possession: { home: number; away: number };
  shots: { home: number; away: number };
  shotsOnTarget: { home: number; away: number };
  shotsOffTarget: { home: number; away: number };
  blockedShots: { home: number; away: number };
  corners: { home: number; away: number };
  fouls: { home: number; away: number };
  yellowCards: { home: number; away: number };
  redCards: { home: number; away: number };
  offsides: { home: number; away: number };
  passes: { home: number; away: number };
  passAccuracy: { home: number; away: number };
  dangerousAttacks: { home: number; away: number };
  attacks: { home: number; away: number };
  saves: { home: number; away: number };
  ballSafe: { home: number; away: number };
}

export interface MatchStatisticsData {
  statistics: ParsedStatistics | null;
  lineups: TeamLineup[];
  events: MatchEvent[];
  loading: boolean;
  error: string | null;
}

// 🆕 Head-to-Head (Confrontos Diretos)
export interface HeadToHeadMatch {
  fixture: {
    id: number;
    date: string;
    venue: { name: string; city: string } | null;
  };
  league: {
    id: number;
    name: string;
    country: string;
    logo: string;
    season: number;
  };
  teams: {
    home: { id: number; name: string; logo: string; winner: boolean | null };
    away: { id: number; name: string; logo: string; winner: boolean | null };
  };
  goals: {
    home: number | null;
    away: number | null;
  };
  score: {
    halftime: { home: number | null; away: number | null };
    fulltime: { home: number | null; away: number | null };
  };
}

export interface HeadToHeadSummary {
  total: number;
  homeWins: number;
  awayWins: number;
  draws: number;
  homeTeamName: string;
  awayTeamName: string;
  matches: HeadToHeadMatch[];
}

// 🆕 Forma Recente (Últimos 5 jogos)
export interface RecentFormMatch {
  fixture: {
    id: number;
    date: string;
    venue: { name: string; city: string } | null;
  };
  league: {
    id: number;
    name: string;
    logo: string;
  };
  teams: {
    home: { id: number; name: string; logo: string; winner: boolean | null };
    away: { id: number; name: string; logo: string; winner: boolean | null };
  };
  goals: {
    home: number | null;
    away: number | null;
  };
}

export interface TeamRecentForm {
  teamName: string;
  teamId: number;
  teamLogo: string;
  matches: RecentFormMatch[];
  form: ('W' | 'D' | 'L')[];
  wins: number;
  draws: number;
  losses: number;
  goalsScored: number;
  goalsConceded: number;
}

export interface RecentFormData {
  home: TeamRecentForm | null;
  away: TeamRecentForm | null;
}

// ═══════════════════════════════════════════════════════════
// CACHE
// ═══════════════════════════════════════════════════════════

const statsCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 60000; // 1 minuto

function getCached<T>(key: string): T | null {
  const cached = statsCache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data as T;
  }
  return null;
}

function setCache<T>(key: string, data: T): void {
  statsCache.set(key, { data, timestamp: Date.now() });
}

// ═══════════════════════════════════════════════════════════
// FUNÇÕES DE FETCH
// ═══════════════════════════════════════════════════════════

type StatsSport = 'football' | 'basketball' | 'baseball' | 'hockey' | 'volleyball' | 'mma';

function normalizeStatsSport(value?: string | null): StatsSport {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw || raw === 'football' || raw === 'soccer' || raw === 'futebol') return 'football';
  if (raw === 'basketball' || raw === 'basquetebol') return 'basketball';
  if (raw === 'baseball' || raw === 'beisebol') return 'baseball';
  if (raw === 'hockey' || raw === 'ice-hockey' || raw === 'ice hockey' || raw === 'hóquei') return 'hockey';
  if (raw === 'volleyball' || raw === 'voleibol' || raw === 'vôlei' || raw === 'volei') return 'volleyball';
  if (raw === 'mma') return 'mma';
  return 'football';
}

const SPORTS_WITH_EVENTS_PROXY = new Set<StatsSport>(['football', 'basketball', 'baseball', 'hockey']);

async function fetchFromApi<T>(endpoint: string, sport: StatsSport = 'football'): Promise<T | null> {
  try {
    if (!SPORTS_WITH_EVENTS_PROXY.has(sport)) {
      return null;
    }
    // Route through the backend proxy — no API key in browser
    const params = new URLSearchParams({ sport, endpoint: endpoint.replace(/^\//, '').split('?')[0] });
    const qsPart = endpoint.includes('?') ? endpoint.split('?')[1] : '';
    if (qsPart) {
      new URLSearchParams(qsPart).forEach((v, k) => params.append(k, v));
    }
    const response = await fetch(`/api/events/proxy?${params.toString()}`, { method: 'GET' });
    if (!response.ok) {
      console.error(`API-Football proxy error: ${response.status}`);
      return null;
    }
    const data = await response.json();
    return (data.response ?? data) as T;
  } catch (error) {
    console.error('Erro ao buscar dados da API-Football:', error);
    return null;
  }
}

/**
 * Busca estatísticas do jogo
 */
export async function fetchMatchStatistics(fixtureId: number, sport: StatsSport = 'football'): Promise<TeamStatistics[] | null> {
  const cacheKey = `stats_${sport}_${fixtureId}`;
  const cached = getCached<TeamStatistics[]>(cacheKey);
  if (cached) return cached;

  const data = await fetchFromApi<TeamStatistics[]>(`/fixtures/statistics?fixture=${fixtureId}`, sport);
  if (data) setCache(cacheKey, data);
  return data;
}

/**
 * Busca escalações do jogo
 */
export async function fetchMatchLineups(fixtureId: number, sport: StatsSport = 'football'): Promise<TeamLineup[] | null> {
  const cacheKey = `lineups_${sport}_${fixtureId}`;
  const cached = getCached<TeamLineup[]>(cacheKey);
  if (cached) return cached;

  const data = await fetchFromApi<TeamLineup[]>(`/fixtures/lineups?fixture=${fixtureId}`, sport);
  if (data) setCache(cacheKey, data);
  return data;
}

/**
 * Busca eventos do jogo (golos, cartões, substituições)
 */
export async function fetchMatchEvents(fixtureId: number, sport: StatsSport = 'football'): Promise<MatchEvent[] | null> {
  const cacheKey = `events_${sport}_${fixtureId}`;
  const cached = getCached<MatchEvent[]>(cacheKey);
  if (cached) return cached;

  const data = await fetchFromApi<MatchEvent[]>(`/fixtures/events?fixture=${fixtureId}`, sport);
  if (data) setCache(cacheKey, data);
  return data;
}

/**
 * Busca confrontos diretos (Head-to-Head) entre duas equipas
 */
export async function fetchHeadToHead(homeTeamId: number, awayTeamId: number, last: number = 10): Promise<HeadToHeadMatch[] | null> {
  const cacheKey = `h2h_${homeTeamId}_${awayTeamId}`;
  const cached = getCached<HeadToHeadMatch[]>(cacheKey);
  if (cached) return cached;

  const data = await fetchFromApi<HeadToHeadMatch[]>(`/fixtures/headtohead?h2h=${homeTeamId}-${awayTeamId}&last=${last}`);
  if (data) setCache(cacheKey, data);
  return data;
}

/**
 * Busca ID de equipa pelo nome
 */
export async function fetchTeamId(teamName: string): Promise<number | null> {
  const cacheKey = `teamid_${teamName}`;
  const cached = getCached<number>(cacheKey);
  if (cached) return cached;

  try {
    const data = await fetchFromApi<any[]>(`/teams?search=${encodeURIComponent(teamName)}`);
    if (data && data.length > 0) {
      const teamId = data[0].team.id;
      setCache(cacheKey, teamId);
      return teamId;
    }
    return null;
  } catch (error) {
    console.error('Erro ao buscar ID da equipa:', error);
    return null;
  }
}

/**
 * Busca os últimos jogos de uma equipa (forma recente)
 */
export async function fetchTeamLastMatches(teamId: number, last: number = 5): Promise<RecentFormMatch[] | null> {
  const cacheKey = `form_${teamId}_${last}`;
  const cached = getCached<RecentFormMatch[]>(cacheKey);
  if (cached) return cached;

  const data = await fetchFromApi<RecentFormMatch[]>(`/fixtures?team=${teamId}&last=${last}&status=FT`);
  if (data) setCache(cacheKey, data);
  return data;
}

// ═══════════════════════════════════════════════════════════
// PARSER DE ESTATÍSTICAS
// ═══════════════════════════════════════════════════════════

function parseStatValue(value: string | number | null): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  // Remove % e converte
  const parsed = parseInt(value.replace('%', ''), 10);
  return isNaN(parsed) ? 0 : parsed;
}

function getStatByType(stats: MatchStatistic[], type: string): number {
  const stat = stats.find(s => s.type.toLowerCase() === type.toLowerCase());
  return stat ? parseStatValue(stat.value) : 0;
}

export function parseTeamStatistics(teamStats: TeamStatistics[]): ParsedStatistics | null {
  if (!teamStats || teamStats.length < 2) return null;

  const homeStats = teamStats[0].statistics;
  const awayStats = teamStats[1].statistics;

  return {
    possession: {
      home: getStatByType(homeStats, 'Ball Possession'),
      away: getStatByType(awayStats, 'Ball Possession')
    },
    shots: {
      home: getStatByType(homeStats, 'Total Shots'),
      away: getStatByType(awayStats, 'Total Shots')
    },
    shotsOnTarget: {
      home: getStatByType(homeStats, 'Shots on Goal'),
      away: getStatByType(awayStats, 'Shots on Goal')
    },
    shotsOffTarget: {
      home: getStatByType(homeStats, 'Shots off Goal'),
      away: getStatByType(awayStats, 'Shots off Goal')
    },
    blockedShots: {
      home: getStatByType(homeStats, 'Blocked Shots'),
      away: getStatByType(awayStats, 'Blocked Shots')
    },
    corners: {
      home: getStatByType(homeStats, 'Corner Kicks'),
      away: getStatByType(awayStats, 'Corner Kicks')
    },
    fouls: {
      home: getStatByType(homeStats, 'Fouls'),
      away: getStatByType(awayStats, 'Fouls')
    },
    yellowCards: {
      home: getStatByType(homeStats, 'Yellow Cards'),
      away: getStatByType(awayStats, 'Yellow Cards')
    },
    redCards: {
      home: getStatByType(homeStats, 'Red Cards'),
      away: getStatByType(awayStats, 'Red Cards')
    },
    offsides: {
      home: getStatByType(homeStats, 'Offsides'),
      away: getStatByType(awayStats, 'Offsides')
    },
    passes: {
      home: getStatByType(homeStats, 'Total passes'),
      away: getStatByType(awayStats, 'Total passes')
    },
    passAccuracy: {
      home: getStatByType(homeStats, 'Passes %'),
      away: getStatByType(awayStats, 'Passes %')
    },
    dangerousAttacks: {
      home: getStatByType(homeStats, 'Dangerous Attacks') || getStatByType(homeStats, 'attacks_dangerous'),
      away: getStatByType(awayStats, 'Dangerous Attacks') || getStatByType(awayStats, 'attacks_dangerous')
    },
    attacks: {
      home: getStatByType(homeStats, 'Attacks') || getStatByType(homeStats, 'attacks'),
      away: getStatByType(awayStats, 'Attacks') || getStatByType(awayStats, 'attacks')
    },
    saves: {
      home: getStatByType(homeStats, 'Goalkeeper Saves'),
      away: getStatByType(awayStats, 'Goalkeeper Saves')
    },
    ballSafe: {
      home: getStatByType(homeStats, 'Ball Safe'),
      away: getStatByType(awayStats, 'Ball Safe')
    }
  };
}

// ═══════════════════════════════════════════════════════════
// HOOK PRINCIPAL
// ═══════════════════════════════════════════════════════════

export function useMatchStatistics(
  matchId: string | number | null,
  autoRefresh: boolean = true,
  refreshInterval: number = 60000,
  sport?: string
): MatchStatisticsData & {
  refresh: () => Promise<void>;
  headToHead: HeadToHeadSummary | null;
  h2hLoading: boolean;
  fetchH2H: (homeTeam: string, awayTeam: string) => Promise<void>;
  recentForm: RecentFormData | null;
  formLoading: boolean;
  fetchRecentForm: (homeTeam: string, awayTeam: string) => Promise<void>;
} {
  const [statistics, setStatistics] = useState<ParsedStatistics | null>(null);
  const [lineups, setLineups] = useState<TeamLineup[]>([]);
  const [events, setEvents] = useState<MatchEvent[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [headToHead, setHeadToHead] = useState<HeadToHeadSummary | null>(null);
  const [h2hLoading, setH2hLoading] = useState<boolean>(false);
  const [recentForm, setRecentForm] = useState<RecentFormData | null>(null);
  const [formLoading, setFormLoading] = useState<boolean>(false);
  const normalizedSport = useMemo(() => normalizeStatsSport(sport), [sport]);

  // Extrair ID numérico do fixture
  const getFixtureId = useCallback((): number | null => {
    if (!matchId) return null;
    
    const idStr = String(matchId);
    
    // Se começa com "api1-", extrair o número
    if (idStr.startsWith('api1-')) {
      const num = parseInt(idStr.replace('api1-', ''), 10);
      return isNaN(num) ? null : num;
    }

    // Se começa com "api2-", extrair o número
    if (idStr.startsWith('api2-')) {
      const num = parseInt(idStr.replace('api2-', ''), 10);
      return isNaN(num) ? null : num;
    }

    // Se contém qualquer prefixo com "-", extrair a parte numérica
    if (idStr.includes('-')) {
      const parts = idStr.split('-');
      for (let i = parts.length - 1; i >= 0; i--) {
        const num = parseInt(parts[i], 10);
        if (!isNaN(num) && num > 0) return num;
      }
    }
    
    // Se é um número direto
    const num = parseInt(idStr, 10);
    return isNaN(num) || num <= 0 ? null : num;
  }, [matchId]);

  const fetchData = useCallback(async () => {
    const fixtureId = getFixtureId();
    
    if (!fixtureId) {
      // Não mostrar erro se simplesmente não temos um ID válido da API-Football
      // Os jogos podem vir de outra fonte (The Odds API) sem fixture ID
      console.log(`⚠️ ID de fixture não disponível para matchId: ${matchId}`);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      console.log(`📊 Buscando estatísticas do jogo ${fixtureId} (${normalizedSport})...`);

      if (normalizedSport !== 'football') {
        setStatistics(null);
        setLineups([]);
        setEvents([]);
        return;
      }

      // Buscar tudo em paralelo
      const [statsData, lineupsData, eventsData] = await Promise.all([
        fetchMatchStatistics(fixtureId, normalizedSport),
        fetchMatchLineups(fixtureId, normalizedSport),
        fetchMatchEvents(fixtureId, normalizedSport)
      ]);

      // Processar estatísticas
      if (statsData && statsData.length >= 2) {
        const parsed = parseTeamStatistics(statsData);
        setStatistics(parsed);
        console.log('✅ Estatísticas carregadas:', parsed);
      } else {
        console.log('⚠️ Estatísticas não disponíveis');
      }

      // Processar escalações
      if (lineupsData && lineupsData.length > 0) {
        setLineups(lineupsData);
        console.log('✅ Escalações carregadas:', lineupsData.length, 'equipas');
      } else {
        console.log('⚠️ Escalações não disponíveis');
      }

      // Processar eventos
      if (eventsData && eventsData.length > 0) {
        setEvents(eventsData);
        console.log('✅ Eventos carregados:', eventsData.length, 'eventos');
      } else {
        console.log('⚠️ Eventos não disponíveis');
      }

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Erro ao carregar estatísticas';
      setError(errorMessage);
      console.error('❌ Erro ao buscar estatísticas:', err);
    } finally {
      setLoading(false);
    }
  }, [getFixtureId, matchId, normalizedSport]);

  const refresh = useCallback(async () => {
    await fetchData();
  }, [fetchData]);

  const fetchH2H = useCallback(async (homeTeam: string, awayTeam: string) => {
    if (normalizedSport !== 'football') {
      setHeadToHead(null);
      return;
    }
    setH2hLoading(true);
    try {
      console.log(`⚔️ Buscando H2H: ${homeTeam} vs ${awayTeam}...`);
      
      const [homeId, awayId] = await Promise.all([
        fetchTeamId(homeTeam),
        fetchTeamId(awayTeam)
      ]);

      if (!homeId || !awayId) {
        console.log('⚠️ Não foi possível encontrar IDs das equipas para H2H');
        setH2hLoading(false);
        return;
      }

      const h2hData = await fetchHeadToHead(homeId, awayId, 10);
      
      if (h2hData && h2hData.length > 0) {
        let homeWins = 0;
        let awayWins = 0;
        let draws = 0;

        h2hData.forEach(match => {
          const homeGoals = match.goals.home ?? 0;
          const awayGoals = match.goals.away ?? 0;
          
          // Determinar quem é "home" e "away" no contexto do H2H
          const isHomeTeamHome = match.teams.home.id === homeId;
          
          if (homeGoals > awayGoals) {
            if (isHomeTeamHome) homeWins++;
            else awayWins++;
          } else if (awayGoals > homeGoals) {
            if (isHomeTeamHome) awayWins++;
            else homeWins++;
          } else {
            draws++;
          }
        });

        setHeadToHead({
          total: h2hData.length,
          homeWins,
          awayWins,
          draws,
          homeTeamName: homeTeam,
          awayTeamName: awayTeam,
          matches: h2hData.sort((a, b) => new Date(b.fixture.date).getTime() - new Date(a.fixture.date).getTime())
        });
        console.log(`✅ H2H carregado: ${h2hData.length} jogos`);
      }
    } catch (err) {
      console.error('❌ Erro ao buscar H2H:', err);
    } finally {
      setH2hLoading(false);
    }
  }, [normalizedSport]);

  // 🆕 Buscar forma recente das equipas
  const fetchRecentForm = useCallback(async (homeTeam: string, awayTeam: string) => {
    if (normalizedSport !== 'football') {
      setRecentForm({ home: null, away: null });
      return;
    }
    setFormLoading(true);
    try {
      console.log(`📋 Buscando forma recente: ${homeTeam} e ${awayTeam}...`);
      
      const [homeId, awayId] = await Promise.all([
        fetchTeamId(homeTeam),
        fetchTeamId(awayTeam)
      ]);

      const results: RecentFormData = { home: null, away: null };

      // Buscar últimos 5 jogos de cada equipa
      const [homeMatches, awayMatches] = await Promise.all([
        homeId ? fetchTeamLastMatches(homeId, 5) : null,
        awayId ? fetchTeamLastMatches(awayId, 5) : null,
      ]);

      if (homeMatches && homeMatches.length > 0 && homeId) {
        let wins = 0, draws = 0, losses = 0, goalsScored = 0, goalsConceded = 0;
        const form: ('W' | 'D' | 'L')[] = [];

        homeMatches.forEach(m => {
          const isHome = m.teams.home.id === homeId;
          const scored = isHome ? (m.goals.home ?? 0) : (m.goals.away ?? 0);
          const conceded = isHome ? (m.goals.away ?? 0) : (m.goals.home ?? 0);
          goalsScored += scored;
          goalsConceded += conceded;

          if (scored > conceded) { wins++; form.push('W'); }
          else if (scored < conceded) { losses++; form.push('L'); }
          else { draws++; form.push('D'); }
        });

        const teamInfo = homeMatches[0].teams.home.id === homeId 
          ? homeMatches[0].teams.home 
          : homeMatches[0].teams.away;

        results.home = {
          teamName: homeTeam,
          teamId: homeId,
          teamLogo: teamInfo.logo,
          matches: homeMatches.sort((a, b) => new Date(b.fixture.date).getTime() - new Date(a.fixture.date).getTime()),
          form,
          wins, draws, losses, goalsScored, goalsConceded
        };
      }

      if (awayMatches && awayMatches.length > 0 && awayId) {
        let wins = 0, draws = 0, losses = 0, goalsScored = 0, goalsConceded = 0;
        const form: ('W' | 'D' | 'L')[] = [];

        awayMatches.forEach(m => {
          const isHome = m.teams.home.id === awayId;
          const scored = isHome ? (m.goals.home ?? 0) : (m.goals.away ?? 0);
          const conceded = isHome ? (m.goals.away ?? 0) : (m.goals.home ?? 0);
          goalsScored += scored;
          goalsConceded += conceded;

          if (scored > conceded) { wins++; form.push('W'); }
          else if (scored < conceded) { losses++; form.push('L'); }
          else { draws++; form.push('D'); }
        });

        const teamInfo = awayMatches[0].teams.home.id === awayId 
          ? awayMatches[0].teams.home 
          : awayMatches[0].teams.away;

        results.away = {
          teamName: awayTeam,
          teamId: awayId,
          teamLogo: teamInfo.logo,
          matches: awayMatches.sort((a, b) => new Date(b.fixture.date).getTime() - new Date(a.fixture.date).getTime()),
          form,
          wins, draws, losses, goalsScored, goalsConceded
        };
      }

      setRecentForm(results);
      console.log(`✅ Forma recente carregada`);
    } catch (err) {
      console.error('❌ Erro ao buscar forma recente:', err);
    } finally {
      setFormLoading(false);
    }
  }, [normalizedSport]);

  // Busca inicial
  useEffect(() => {
    if (matchId) {
      fetchData();
    }
  }, [matchId, fetchData]);

  // Auto-refresh
  useEffect(() => {
    if (!autoRefresh || !matchId) return;

    const intervalId = setInterval(() => {
      fetchData();
    }, refreshInterval);

    return () => clearInterval(intervalId);
  }, [autoRefresh, matchId, refreshInterval, fetchData]);

  return {
    statistics,
    lineups,
    events,
    loading,
    error,
    refresh,
    headToHead,
    h2hLoading,
    fetchH2H,
    recentForm,
    formLoading,
    fetchRecentForm
  };
}

export default useMatchStatistics;
