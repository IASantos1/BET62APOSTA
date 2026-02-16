
import type { NormalizedMatch, NormalizedStats } from '../types/sports';
import { fetchLiveOdds, fetchUpcomingOdds, fetchLiveScores } from './sportsApi2';
import { getTeamLogosBatch } from './teamLogosService';
import type { OddsApiScore, OddsApiEvent } from './sportsApi2';

// ✅ OTIMIZAÇÃO: Cache simples e rápido
let cachedLiveMatches: NormalizedMatch[] | null = null;
let cachedUpcomingMatches: NormalizedMatch[] | null = null;
let lastLiveUpdate = 0;
let lastUpcomingUpdate = 0;

const LIVE_CACHE_TTL = 8 * 1000; // 8 segundos
const UPCOMING_CACHE_TTL = 60 * 1000; // 1 minuto

// ✅ Mapeamento de sport_key para tipo interno
const SPORT_MAP: Record<string, string> = {
  soccer_epl: 'soccer',
  soccer_spain_la_liga: 'soccer',
  soccer_germany_bundesliga: 'soccer',
  soccer_italy_serie_a: 'soccer',
  soccer_france_ligue_one: 'soccer',
  soccer_portugal_primeira_liga: 'soccer',
  soccer_netherlands_eredivisie: 'soccer',
  soccer_belgium_first_div: 'soccer',
  soccer_turkey_super_league: 'soccer',
  soccer_scotland_premiership: 'soccer',
  soccer_uefa_champs_league: 'soccer',
  soccer_uefa_europa_league: 'soccer',
  soccer_uefa_europa_conf_league: 'soccer',
  soccer_brazil_campeonato: 'soccer',
  soccer_brazil_serie_b: 'soccer',
  soccer_argentina_primera_division: 'soccer',
  soccer_mexico_ligamx: 'soccer',
  soccer_usa_mls: 'soccer',
  soccer_australia_aleague: 'soccer',
  soccer_japan_j_league: 'soccer',
  soccer_korea_kleague1: 'soccer',
  soccer_china_superleague: 'soccer',
  soccer_russia_premier_league: 'soccer',
  soccer_switzerland_superleague: 'soccer',
  soccer_austria_bundesliga: 'soccer',
  soccer_greece_super_league: 'soccer',
  soccer_denmark_superliga: 'soccer',
  soccer_norway_eliteserien: 'soccer',
  soccer_sweden_allsvenskan: 'soccer',
  soccer_poland_ekstraklasa: 'soccer',
  basketball_nba: 'basketball',
  basketball_euroleague: 'basketball',
  basketball_ncaab: 'basketball',
  basketball_wnba: 'basketball',
  basketball_nbl: 'basketball',
  basketball_spain_acb: 'basketball',
  basketball_germany_bbl: 'basketball',
  basketball_france_lnb: 'basketball',
  basketball_italy_lega: 'basketball',
  basketball_italy_lega_a: 'basketball',
  basketball_turkey_bsl: 'basketball',
  basketball_greece_basket_league: 'basketball',
  basketball_china_cba: 'basketball',
  icehockey_nhl: 'icehockey',
  icehockey_sweden_hockey_league: 'icehockey',
  icehockey_sweden_allsvenskan: 'icehockey',
  icehockey_finland_liiga: 'icehockey',
  icehockey_finland_mestis: 'icehockey',
  icehockey_germany_del: 'icehockey',
  icehockey_russia_khl: 'icehockey',
  icehockey_khl: 'icehockey',
  icehockey_ahl: 'icehockey',
  icehockey_switzerland_nla: 'icehockey',
  icehockey_czech_extraliga: 'icehockey',
  americanfootball_nfl: 'americanfootball',
  americanfootball_ncaaf: 'americanfootball',
  americanfootball_cfl: 'americanfootball',
  baseball_mlb: 'baseball',
  baseball_mlb_preseason: 'baseball',
  baseball_npb: 'baseball',
  baseball_kbo: 'baseball',
  baseball_ncaa: 'baseball',
  rugbyleague_nrl: 'rugby',
  rugbyunion_six_nations: 'rugby',
  rugbyunion_super_rugby: 'rugby',
  rugbyunion_super_rugby_pacific: 'rugby',
  rugbyunion_world_cup: 'rugby',
  rugbyunion_premiership: 'rugby',
  rugbyunion_top_14: 'rugby',
  rugbyunion_united_rugby_championship: 'rugby',
  volleyball_brazil_superliga: 'volleyball',
  volleyball_brazil_superliga_women: 'volleyball',
  volleyball_italy_serie_a: 'volleyball',
  volleyball_italy_serie_a_women: 'volleyball',
  volleyball_poland_plusliga: 'volleyball',
  volleyball_nations_league: 'volleyball',
  volleyball_nations_league_women: 'volleyball',
  mma_mixed_martial_arts: 'mma',
  handball_germany_bundesliga: 'handball',
  handball_france_lnh: 'handball',
  handball_spain_liga_asobal: 'handball',
  handball_denmark_ligaen: 'handball',
  handball_ehf_champions_league: 'handball',
  aussierules_afl: 'afl',
  boxing_boxing: 'boxing',
  golf_pga_championship: 'golf',
  cricket_test_match: 'cricket',
};

// ✅ Mapeamento de nomes de ligas
const LEAGUE_MAP: Record<string, string> = {
  soccer_epl: 'Premier League',
  soccer_spain_la_liga: 'La Liga',
  soccer_germany_bundesliga: 'Bundesliga',
  soccer_italy_serie_a: 'Serie A',
  soccer_france_ligue_one: 'Ligue 1',
  soccer_portugal_primeira_liga: 'Primeira Liga',
  soccer_netherlands_eredivisie: 'Eredivisie',
  soccer_belgium_first_div: 'Jupiler Pro League',
  soccer_turkey_super_league: 'Super Lig',
  soccer_scotland_premiership: 'Scottish Premiership',
  soccer_uefa_champs_league: 'Champions League',
  soccer_uefa_europa_league: 'Europa League',
  soccer_uefa_europa_conf_league: 'Conference League',
  soccer_brazil_campeonato: 'Brasileirão',
  soccer_brazil_serie_b: 'Série B',
  soccer_argentina_primera_division: 'Liga Argentina',
  soccer_mexico_ligamx: 'Liga MX',
  soccer_usa_mls: 'MLS',
  soccer_australia_aleague: 'A-League',
  soccer_japan_j_league: 'J-League',
  soccer_korea_kleague1: 'K League',
  soccer_china_superleague: 'Chinese Super League',
  soccer_russia_premier_league: 'Russian Premier League',
  soccer_switzerland_superleague: 'Swiss Super League',
  soccer_austria_bundesliga: 'Austrian Bundesliga',
  soccer_greece_super_league: 'Greek Super League',
  soccer_denmark_superliga: 'Danish Superliga',
  soccer_norway_eliteserien: 'Norwegian Eliteserien',
  soccer_sweden_allsvenskan: 'Swedish Allsvenskan',
  soccer_poland_ekstraklasa: 'Polish Ekstraklasa',
  basketball_nba: 'NBA',
  basketball_euroleague: 'Euroleague',
  basketball_ncaab: 'NCAA Basketball',
  basketball_nbl: 'Australian NBL',
  basketball_spain_acb: 'ACB',
  basketball_germany_bbl: 'BBL',
  basketball_france_lnb: 'LNB Pro A',
  basketball_italy_lega: 'Lega Basket',
  basketball_turkey_bsl: 'Turkish BSL',
  basketball_greece_basket_league: 'Greek Basket League',
  basketball_china_cba: 'CBA',
  icehockey_nhl: 'NHL',
  icehockey_sweden_hockey_league: 'SHL',
  icehockey_finland_liiga: 'Liiga',
  icehockey_germany_del: 'DEL',
  icehockey_russia_khl: 'KHL',
  icehockey_switzerland_nla: 'NLA',
  icehockey_czech_extraliga: 'Czech Extraliga',
  americanfootball_nfl: 'NFL',
  americanfootball_ncaaf: 'NCAA Football',
  americanfootball_cfl: 'CFL',
  baseball_mlb: 'MLB',
  baseball_npb: 'NPB',
  baseball_kbo: 'KBO',
};

/**
 * ✅ Normalizar nomes de equipas para correspondência
 */
function normalizeTeamName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(
      /\s*(fc|cf|sc|ac|bc|hc|ssc|ss|se|cr|ec|fbpa|united|city|town|athletic|club|wanderers|hotspur|albion)\s*/gi,
      ' '
    )
    .replace(/\s*(de|da|do|dos|das|el|la|the|and|e)\s*/gi, ' ')
    .replace(/[.,\-_()'"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * ✅ Verificar se duas equipas correspondem
 */
function teamsMatch(team1: string, team2: string): boolean {
  const normalized1 = normalizeTeamName(team1);
  const normalized2 = normalizeTeamName(team2);

  if (normalized1 === normalized2) return true;
  if (normalized1.length >= 4 && normalized2.length >= 4) {
    if (normalized1.includes(normalized2) || normalized2.includes(normalized1)) return true;
  }

  const words1 = normalized1.split(' ').filter((w) => w.length > 3);
  const words2 = normalized2.split(' ').filter((w) => w.length > 3);

  if (words1.length > 0 && words2.length > 0) {
    const matchingWords = words1.filter((w1) =>
      words2.some((w2) => w1 === w2 || w1.includes(w2) || w2.includes(w1))
    );
    if (matchingWords.length >= 1) return true;
  }

  return false;
}

/**
 * ✅ NOVO: Calcular tempo de jogo baseado no desporto e horário de início
 */
function calculateGameTime(
  commenceTime: string,
  sportKey: string,
  _liveScore?: OddsApiScore
): { elapsed: number; statusShort: string; period: string } {
  const now = new Date();
  const startTime = new Date(commenceTime);
  const minutesSinceStart = Math.floor((now.getTime() - startTime.getTime()) / (60 * 1000));

  const sport = sportKey.toLowerCase();

  // ✅ FUTEBOL: 45 min por parte + 15 min intervalo
  if (sport.includes('soccer') || sport.includes('football')) {
    if (minutesSinceStart < 0) {
      return { elapsed: 0, statusShort: 'NS', period: '' };
    }
    if (minutesSinceStart <= 45) {
      return { elapsed: minutesSinceStart, statusShort: '1H', period: 'P1' };
    }
    if (minutesSinceStart <= 60) {
      return { elapsed: 45, statusShort: 'HT', period: 'INT' };
    }
    if (minutesSinceStart <= 105) {
      const secondHalfMinute = minutesSinceStart - 15;
      return { elapsed: Math.min(secondHalfMinute, 90), statusShort: '2H', period: 'P2' };
    }
    if (minutesSinceStart <= 120) {
      return { elapsed: 90, statusShort: 'FT', period: 'FT' };
    }
    return { elapsed: Math.min(minutesSinceStart - 30, 120), statusShort: 'ET', period: 'PRO' };
  }

  // ✅ BASQUETE: 4 quartos de 12 min (NBA) ou 10 min (FIBA)
  if (sport.includes('basketball')) {
    const quarterLength = sport.includes('nba') ? 12 : 10;
    const totalGameTime = quarterLength * 4;

    if (minutesSinceStart < 0) {
      return { elapsed: 0, statusShort: 'NS', period: '' };
    }

    const adjustedMinutes = Math.min(minutesSinceStart, totalGameTime + 15);
    const quarter = Math.min(Math.floor(adjustedMinutes / (quarterLength + 3)) + 1, 4);
    const quarterMinute = adjustedMinutes % (quarterLength + 3);

    if (quarter <= 4) {
      return {
        elapsed: Math.min(quarterMinute, quarterLength),
        statusShort: `Q${quarter}`,
        period: `Q${quarter}`,
      };
    }
    return { elapsed: quarterMinute, statusShort: 'OT', period: 'OT' };
  }

  // ✅ HÓQUEI: 3 períodos de 20 min
  if (sport.includes('hockey')) {
    const periodLength = 20;

    if (minutesSinceStart < 0) {
      return { elapsed: 0, statusShort: 'NS', period: '' };
    }

    const adjustedMinutes = Math.min(minutesSinceStart, 75);
    const period = Math.min(Math.floor(adjustedMinutes / 25) + 1, 3);
    const periodMinute = adjustedMinutes % 25;

    if (period <= 3) {
      return {
        elapsed: Math.min(periodMinute, periodLength),
        statusShort: `P${period}`,
        period: `P${period}`,
      };
    }
    return { elapsed: periodMinute, statusShort: 'OT', period: 'OT' };
  }

  // ✅ BASEBALL: 9 innings
  if (sport.includes('baseball')) {
    if (minutesSinceStart < 0) {
      return { elapsed: 0, statusShort: 'NS', period: '' };
    }
    const inning = Math.min(Math.floor(minutesSinceStart / 20) + 1, 9);
    return { elapsed: inning, statusShort: `${inning}`, period: `${inning}ª` };
  }

  // ✅ OUTROS DESPORTOS
  return { elapsed: Math.max(0, minutesSinceStart), statusShort: 'LIVE', period: 'LIVE' };
}

/**
 * ✅ VALIDAÇÃO RIGOROSA DE JOGOS AO VIVO - CORRIGIDO: Sempre retorna placar quando disponível
 */
function validateLiveMatch(
  event: OddsApiEvent,
  liveScores?: OddsApiScore[]
): {
  isValid: boolean;
  isLive: boolean;
  homeScore?: number;
  awayScore?: number;
  elapsed?: number;
  statusShort?: string;
  period?: string;
  reason?: string;
} {
  const now = new Date();
  const commenceTime = new Date(event.commence_time);
  const timeSinceStart = now.getTime() - commenceTime.getTime();

  // Jogo deve ter começado
  if (timeSinceStart < 0) {
    return { isValid: false, isLive: false, reason: 'Jogo ainda não começou' };
  }

  // Jogo não pode ter mais de 4 horas
  const maxDuration = 4 * 60 * 60 * 1000;
  if (timeSinceStart > maxDuration) {
    return { isValid: false, isLive: false, reason: 'Jogo provavelmente já terminou' };
  }

  let homeScore: number | undefined;
  let awayScore: number | undefined;
  let hasLiveScore = false;

  // ✅ CORRIGIDO: Buscar score ao vivo - SEMPRE retorna quando disponível
  if (liveScores && liveScores.length > 0) {
    const scoreMatch = liveScores.find((s) => {
      if (s.id === event.id) return true;
      return teamsMatch(s.home_team, event.home_team) && teamsMatch(s.away_team, event.away_team);
    });

    // ✅ CORRIGIDO: Retorna placar mesmo para jogos completos (para ligas pequenas)
    if (scoreMatch?.scores && scoreMatch.scores.length >= 2) {
      const homeScoreObj = scoreMatch.scores.find((s) => teamsMatch(s.name, event.home_team));
      const awayScoreObj = scoreMatch.scores.find((s) => teamsMatch(s.name, event.away_team));

      if (homeScoreObj && awayScoreObj) {
        homeScore = parseInt(homeScoreObj.score, 10) || 0;
        awayScore = parseInt(awayScoreObj.score, 10) || 0;
        hasLiveScore = true;
        
        console.log(`📊 Placar encontrado: ${event.home_team} ${homeScore}-${awayScore} ${event.away_team} (Liga: ${event.sport_title})`);
      }
    }

    // ✅ CORRIGIDO: Só rejeita se completed E sem placar
    if (scoreMatch?.completed && !hasLiveScore) {
      return { isValid: false, isLive: false, reason: 'Jogo já terminou' };
    }
  }

  // ✅ NOVO: Calcular tempo de jogo sincronizado
  const gameTime = calculateGameTime(event.commence_time, event.sport_key);

  const isLive = hasLiveScore || (timeSinceStart > 0 && timeSinceStart < 3 * 60 * 60 * 1000);

  return {
    isValid: true,
    isLive,
    homeScore,
    awayScore,
    elapsed: gameTime.elapsed,
    statusShort: gameTime.statusShort,
    period: gameTime.period,
  };
}

/**
 * ✅ CORRIGIDO: Converte evento da The Odds API para NormalizedMatch
 */
function convertOddsEventToMatch(event: OddsApiEvent, liveScores?: OddsApiScore[]): NormalizedMatch | null {
  if (!event || !event.id || !event.home_team || !event.away_team) {
    console.warn('❌ Evento inválido: faltam dados básicos');
    return null;
  }

  if (!event.bookmakers || event.bookmakers.length === 0) {
    console.warn(`❌ ${event.home_team} vs ${event.away_team}: sem bookmakers`);
    return null;
  }

  // ✅ CORRIGIDO: Buscar bookmaker com mercado h2h válido
  const preferredBookmakers = ['bet365', 'pinnacle', 'betfair', 'unibet', 'williamhill', 'draftkings', 'fanduel'];
  
  let bookmaker = null;
  let h2hMarket = null;

  // Tentar bookmakers preferidos primeiro
  for (const preferred of preferredBookmakers) {
    const found = event.bookmakers.find((b) => b.key.toLowerCase() === preferred);
    if (found?.markets) {
      const market = found.markets.find((m: any) => m.key === 'h2h');
      if (market?.outcomes && market.outcomes.length >= 2) {
        bookmaker = found;
        h2hMarket = market;
        break;
      }
    }
  }

  // Se não encontrou, usar primeiro bookmaker com mercado h2h válido
  if (!bookmaker || !h2hMarket) {
    for (const b of event.bookmakers) {
      if (b.markets) {
        const market = b.markets.find((m: any) => m.key === 'h2h');
        if (market?.outcomes && market.outcomes.length >= 2) {
          bookmaker = b;
          h2hMarket = market;
          break;
        }
      }
    }
  }

  if (!bookmaker || !h2hMarket) {
    console.warn(`❌ ${event.home_team} vs ${event.away_team}: sem mercado h2h válido`);
    return null;
  }

  // ✅ CORRIGIDO: Buscar outcomes com validação rigorosa
  let homeOutcome = h2hMarket.outcomes.find(
    (o: any) => String(o.name || '').toLowerCase().trim() === String(event.home_team || '').toLowerCase().trim()
  );

  let awayOutcome = h2hMarket.outcomes.find(
    (o: any) => String(o.name || '').toLowerCase().trim() === String(event.away_team || '').toLowerCase().trim()
  );

  // Tentar correspondência por normalização
  if (!homeOutcome) {
    homeOutcome = h2hMarket.outcomes.find((o: any) => teamsMatch(String(o.name || ''), event.home_team));
  }

  if (!awayOutcome) {
    awayOutcome = h2hMarket.outcomes.find((o: any) => teamsMatch(String(o.name || ''), event.away_team));
  }

  // ✅ CORRIGIDO: Fallback inteligente para NCAA e outros desportos
  if (!homeOutcome && !awayOutcome && h2hMarket.outcomes.length >= 2) {
    const outcomes = h2hMarket.outcomes.filter(
      (o: any) =>
        String(o.name || '').toLowerCase() !== 'draw' && 
        String(o.name || '').toLowerCase() !== 'empate' &&
        String(o.name || '').toLowerCase() !== 'tie'
    );

    if (outcomes.length >= 2) {
      // Para NCAA e desportos americanos, usar ordem dos outcomes
      const sportKey = event.sport_key.toLowerCase();
      const isNCAA = sportKey.includes('ncaa');
      const isAmericanSport = sportKey.includes('basketball') || sportKey.includes('football') || sportKey.includes('baseball');

      if (isNCAA || isAmericanSport) {
        // Tentar correspondência por palavras-chave
        const homeWords = event.home_team.toLowerCase().split(' ');
        const awayWords = event.away_team.toLowerCase().split(' ');

        homeOutcome = outcomes.find((o: any) => {
          const outcomeName = String(o.name || '').toLowerCase();
          return homeWords.some(word => word.length > 3 && outcomeName.includes(word));
        });

        awayOutcome = outcomes.find((o: any) => {
          const outcomeName = String(o.name || '').toLowerCase();
          return awayWords.some(word => word.length > 3 && outcomeName.includes(word));
        });

        // Se ainda não encontrou, usar ordem
        if (!homeOutcome || !awayOutcome) {
          homeOutcome = outcomes[0];
          awayOutcome = outcomes[1];
        }
      } else {
        // Para outros desportos, usar lógica existente
        homeOutcome =
          outcomes.find((o: any) => String(o.name || '').toLowerCase().includes(event.home_team.split(' ')[0].toLowerCase())) ||
          outcomes[0];

        awayOutcome =
          outcomes.find((o: any) => String(o.name || '').toLowerCase().includes(event.away_team.split(' ')[0].toLowerCase())) ||
          outcomes[1];
      }

      if (homeOutcome === awayOutcome && outcomes.length >= 2) {
        homeOutcome = outcomes[0];
        awayOutcome = outcomes[1];
      }
    }
  }

  // ✅ VALIDAÇÃO RIGOROSA: Verificar se odds existem e são válidas
  if (!homeOutcome?.price || !awayOutcome?.price) {
    console.warn(`❌ ${event.home_team} vs ${event.away_team}: odds inválidas (home: ${homeOutcome?.price}, away: ${awayOutcome?.price})`);
    return null;
  }

  const drawOutcome = h2hMarket.outcomes.find((o: any) => {
    const outcomeName = String(o.name || '').toLowerCase().trim();
    return outcomeName === 'draw' || outcomeName === 'empate' || outcomeName === 'tie';
  });

  // ✅ VALIDAÇÃO: Converter e validar odds
  const homeOdd = parseFloat(Number(homeOutcome.price).toFixed(2));
  const awayOdd = parseFloat(Number(awayOutcome.price).toFixed(2));
  const drawOdd = drawOutcome?.price ? parseFloat(Number(drawOutcome.price).toFixed(2)) : undefined;

  // ✅ VALIDAÇÃO: Verificar se odds são números válidos
  if (isNaN(homeOdd) || isNaN(awayOdd)) {
    console.warn(`❌ ${event.home_team} vs ${event.away_team}: odds não são números (home: ${homeOdd}, away: ${awayOdd})`);
    return null;
  }

  // ✅ CORRIGIDO: Identificar tipo de desporto ANTES de validar odds
  const sportType = SPORT_MAP[event.sport_key] || 'soccer';
  const isSoccer = sportType === 'soccer';
  const isBasketball = sportType === 'basketball';
  const isHockey = sportType === 'icehockey';
  const isAmericanFootball = sportType === 'americanfootball';
  const isBaseball = sportType === 'baseball';

  console.log(`🔍 Desporto detectado: ${event.sport_key} → ${sportType} (Basketball: ${isBasketball}, Baseball: ${isBaseball})`);

  const minOdd = 1.001;
  const maxOdd = isBasketball || isHockey || isAmericanFootball || isBaseball ? 1000 : 100;

  if (homeOdd < minOdd || homeOdd > maxOdd || awayOdd < minOdd || awayOdd > maxOdd) {
    console.warn(`❌ ${event.home_team} vs ${event.away_team}: odds fora dos limites (home: ${homeOdd}, away: ${awayOdd})`);
    return null;
  }

  if (isSoccer && homeOdd === awayOdd && drawOdd && homeOdd === drawOdd) {
    console.warn(`❌ ${event.home_team} vs ${event.away_team}: todas as odds iguais`);
    return null;
  }

  const validation = validateLiveMatch(event, liveScores);

  const commenceTime = new Date(event.commence_time);
  const hours = String(commenceTime.getHours()).padStart(2, '0');
  const minutes = String(commenceTime.getMinutes()).padStart(2, '0');

  const formattedTime = validation.isLive
    ? validation.homeScore !== undefined && validation.awayScore !== undefined
      ? `${validation.homeScore}-${validation.awayScore}`
      : 'AO VIVO'
    : `${hours}:${minutes}`;

  const leagueName = LEAGUE_MAP[event.sport_key] || event.sport_title;

  console.log(`✅ ${event.home_team} vs ${event.away_team}: ${sportType} - odds válidas (${homeOdd} / ${drawOdd || '-'} / ${awayOdd})`);

  return {
    id: event.id,
    sport: sportType,
    league: leagueName,
    country: 'International',
    homeTeam: event.home_team,
    awayTeam: event.away_team,
    homeScore: validation.homeScore,
    awayScore: validation.awayScore,
    status: validation.isLive ? 'LIVE' : 'NS',
    startTime: event.commence_time,
    time: formattedTime,
    isLive: validation.isLive,
    elapsed: validation.elapsed,
    statusShort: validation.statusShort,
    period: validation.period,
    minute: validation.elapsed?.toString(),
    homeTeamLogo: undefined,
    awayTeamLogo: undefined,
    odds: {
      home: homeOdd,
      draw: isSoccer ? drawOdd : undefined,
      away: awayOdd,
      bookmaker: bookmaker.title,
    },
  };
}

/**
 * ✅ BUSCAR JOGOS AO VIVO COM LOGOS
 */
export async function getLiveMatches(): Promise<NormalizedMatch[]> {
  const now = Date.now();

  if (cachedLiveMatches && now - lastLiveUpdate < LIVE_CACHE_TTL) {
    return cachedLiveMatches;
  }

  try {
    console.log('🔄 Buscando jogos ao vivo...');

    const [oddsEvents, liveScores] = await Promise.all([fetchLiveOdds(), fetchLiveScores()]);

    console.log(`📊 The Odds API: ${oddsEvents.length} eventos | ${liveScores.length} scores`);

    const matches: NormalizedMatch[] = [];
    const processedIds = new Set<string>();
    const processedMatchKeys = new Set<string>();
    let validCount = 0;
    let invalidCount = 0;
    let duplicateCount = 0;

    for (const event of oddsEvents) {
      if (processedIds.has(event.id)) {
        duplicateCount++;
        continue;
      }

      const matchKey = `${normalizeTeamName(event.home_team)}-${normalizeTeamName(event.away_team)}`;
      if (processedMatchKeys.has(matchKey)) {
        duplicateCount++;
        continue;
      }

      const match = convertOddsEventToMatch(event, liveScores);

      if (match && match.odds && match.odds.home > 1 && match.odds.away > 1) {
        processedIds.add(event.id);
        processedMatchKeys.add(matchKey);
        matches.push(match);
        validCount++;
      } else {
        invalidCount++;
      }
    }

    console.log(`✅ ${validCount} jogos válidos | ❌ ${invalidCount} rejeitados | 🔄 ${duplicateCount} duplicados`);

    // ✅ BUSCAR LOGOS DAS EQUIPAS EM BATCH
    if (matches.length > 0) {
      const teamsToFetch = matches.flatMap((m) => [
        { name: m.homeTeam, league: m.league },
        { name: m.awayTeam, league: m.league },
      ]);
      try {
        const logos = await getTeamLogosBatch(teamsToFetch);
        for (const match of matches) {
          match.homeTeamLogo = logos.get(match.homeTeam);
          match.awayTeamLogo = logos.get(match.awayTeam);
        }
      } catch (error) {
        console.warn('⚠️ Erro ao buscar logos:', error);
      }
    }

    // Ordenar por liga
    matches.sort((a, b) => (a.league || '').localeCompare(b.league || ''));

    const limitedMatches = matches.slice(0, 80);

    cachedLiveMatches = limitedMatches;
    lastLiveUpdate = now;

    return limitedMatches;
  } catch (error) {
    console.error('❌ Erro getLiveMatches:', error);
    return cachedLiveMatches || [];
  }
}

/**
 * ✅ BUSCAR PRÉ-JOGOS COM LOGOS
 */
export async function getUpcomingMatches(): Promise<NormalizedMatch[]> {
  const now = Date.now();

  if (cachedUpcomingMatches && now - lastUpcomingUpdate < UPCOMING_CACHE_TTL) {
    return cachedUpcomingMatches;
  }

  try {
    console.log('🔄 Buscando pré-jogos...');

    const oddsEvents = await fetchUpcomingOdds();

    console.log(`📊 The Odds API: ${oddsEvents.length} eventos`);

    const matches: NormalizedMatch[] = [];
    const processedIds = new Set<string>();

    for (const event of oddsEvents) {
      const match = convertOddsEventToMatch(event);
      if (match && match.odds && match.odds.home > 1 && match.odds.away > 1 && !match.isLive) {
        const matchKey = `${normalizeTeamName(match.homeTeam)}-${normalizeTeamName(match.awayTeam)}`;
        if (!processedIds.has(matchKey)) {
          processedIds.add(matchKey);
          matches.push(match);
        }
      }
    }

    console.log(`✅ ${matches.length} pré-jogos válidos`);

    // ✅ BUSCAR LOGOS DAS EQUIPAS EM BATCH
    if (matches.length > 0) {
      const teamsToFetch = matches.flatMap((m) => [
        { name: m.homeTeam, league: m.league },
        { name: m.awayTeam, league: m.league },
      ]);
      try {
        const logos = await getTeamLogosBatch(teamsToFetch);
        for (const match of matches) {
          match.homeTeamLogo = logos.get(match.homeTeam);
          match.awayTeamLogo = logos.get(match.awayTeam);
        }
      } catch (error) {
        console.warn('⚠️ Erro ao buscar logos:', error);
      }
    }

    // Ordenar por horário
    matches.sort((a, b) => {
      const timeA = new Date(a.startTime || 0).getTime();
      const timeB = new Date(b.startTime || 0).getTime();
      return timeA - timeB;
    });

    const limitedMatches = matches.slice(0, 100);

    cachedUpcomingMatches = limitedMatches;
    lastUpcomingUpdate = now;

    return limitedMatches;
  } catch (error) {
    console.error('❌ Erro getUpcomingMatches:', error);
    return cachedUpcomingMatches || [];
  }
}

// ✅ Exportar tipos e funções auxiliares
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

export function mapSportKey(sportKey: string): SportType {
  if (sportKey.includes('soccer')) return 'football';
  if (sportKey.includes('basketball')) return 'basketball';
  if (sportKey.includes('hockey')) return 'hockey';
  if (sportKey.includes('football')) return 'nfl';
  if (sportKey.includes('baseball')) return 'baseball';
  return 'football';
}

export function mapLeagueName(sportKey: string): string {
  return LEAGUE_MAP[sportKey] || sportKey;
}

export function teamsMatchBySport(name1: string, name2: string): boolean {
  return teamsMatch(name1, name2);
}

export function validateOddsBySport(odds: number): boolean {
  return odds >= 1.01 && odds <= 1000;
}

export function normalizeStatsBySport(stats: any): NormalizedStats {
  return {
    possession: { home: stats?.possession?.home || 50, away: stats?.possession?.away || 50 },
    shots: { home: stats?.shots?.home || 0, away: stats?.shots?.away || 0 },
    shotsOnTarget: { home: 0, away: 0 },
    corners: { home: 0, away: 0 },
    fouls: { home: 0, away: 0 },
    yellowCards: { home: 0, away: 0 },
    redCards: { home: 0, away: 0 },
  };
}

export default {
  getLiveMatches,
  getUpcomingMatches,
  mapSportKey,
  mapLeagueName,
};
