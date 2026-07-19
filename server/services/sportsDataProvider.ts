import {
  fetchSportsApiProH2H as sportsApiProFetchH2H,
  fetchSportsApiProLive as sportsApiProFetchLive,
  fetchSportsApiProMatchIncidents as sportsApiProFetchMatchIncidents,
  fetchSportsApiProMatchOddsAll as sportsApiProFetchMatchOddsAll,
  fetchSportsApiProMatchOddsLive as sportsApiProFetchMatchOddsLive,
  fetchSportsApiProMatchOddsPreMatch as sportsApiProFetchMatchOddsPreMatch,
  fetchSportsApiProMatchStatistics as sportsApiProFetchMatchStatistics,
  fetchSportsApiProSchedule as sportsApiProFetchSchedule,
  fetchSportsApiProStandings as sportsApiProFetchStandings,
  fetchSportsApiProV1AllScoresDelta as sportsApiProFetchV1AllScoresDelta,
  fetchSportsApiProWorldCup2026 as sportsApiProFetchWorldCup2026,
  fetchSportsApiProWorldCup2026Groups as sportsApiProFetchWorldCup2026Groups,
  fetchSportsApiProWorldCup2026Info as sportsApiProFetchWorldCup2026Info,
  fetchSportsApiProWorldCup2026Matches as sportsApiProFetchWorldCup2026Matches,
  parseSportsApiProMatchOddsPayload as parseSportsApiProOddsPayload,
} from './sportsApiPro.js';
import {
  fetchStatPalH2H,
  fetchStatPalSoccerH2HByTeams,
  fetchStatPalSoccerInjuriesSuspensions,
  fetchStatPalSoccerLiveStorylines,
  fetchStatPalSoccerTeamLineups,
  fetchStatPalSoccerWeatherForecast,
  fetchStatPalSoccerPredictions,
  fetchStatPalSoccerLiveOddsMarkets,
  fetchStatPalSoccerLiveOddsMatchStates,
  fetchStatPalSoccerPlayer,
  fetchStatPalSoccerCoach,
  fetchStatPalSoccerTeam,
  fetchStatPalLive,
  fetchStatPalMatchIncidents,
  fetchStatPalMatchOddsAll,
  fetchStatPalMatchOddsLive,
  fetchStatPalMatchOddsPreMatch,
  fetchStatPalMatchStatistics,
  fetchStatPalSchedule,
  fetchStatPalStandings,
  fetchStatPalV1AllScoresDelta,
  fetchStatPalWorldCup2026,
  fetchStatPalWorldCup2026Groups,
  fetchStatPalWorldCup2026Info,
  fetchStatPalWorldCup2026Matches,
  parseStatPalMatchOddsPayload,
} from './statPal.js';

export type SportsDataProviderName = 'sportsapipro' | 'statpal';

function resolveProviderName(): SportsDataProviderName {
  const raw = String(process.env.SPORTS_PROVIDER || '').trim().toLowerCase();
  if (raw === 'statpal') return 'statpal';
  return 'sportsapipro';
}

function resolveProviderApiKey(provider: SportsDataProviderName): { apiKey: string; envSource: string } {
  if (provider === 'statpal') {
    if (process.env.STATPAL_KEY) return { apiKey: String(process.env.STATPAL_KEY || '').trim(), envSource: 'STATPAL_KEY' };
    if (process.env.SPORTS_API_KEY) return { apiKey: String(process.env.SPORTS_API_KEY || '').trim(), envSource: 'SPORTS_API_KEY' };
    return { apiKey: '', envSource: '' };
  }
  if (process.env.SPORTS_API_PRO_KEY) return { apiKey: String(process.env.SPORTS_API_PRO_KEY || '').trim(), envSource: 'SPORTS_API_PRO_KEY' };
  if (process.env.SPORTSAPIPRO_KEY) return { apiKey: String(process.env.SPORTSAPIPRO_KEY || '').trim(), envSource: 'SPORTSAPIPRO_KEY' };
  if (process.env.SPORTSAPI_PRO_KEY) return { apiKey: String(process.env.SPORTSAPI_PRO_KEY || '').trim(), envSource: 'SPORTSAPI_PRO_KEY' };
  if (process.env.SPORTS_API_KEY) return { apiKey: String(process.env.SPORTS_API_KEY || '').trim(), envSource: 'SPORTS_API_KEY' };
  return { apiKey: '', envSource: '' };
}

export function getSportsDataProviderConfig() {
  const provider = resolveProviderName();
  const { apiKey, envSource } = resolveProviderApiKey(provider);
  return {
    provider,
    apiKey,
    envSource,
    supportsUpstreamWs: provider === 'sportsapipro',
  };
}

export async function fetchSportsApiProV1AllScoresDelta(apiKey: string, sport: string) {
  if (resolveProviderName() === 'statpal') return fetchStatPalV1AllScoresDelta(apiKey, sport);
  return sportsApiProFetchV1AllScoresDelta(apiKey, sport);
}

export async function fetchSportsApiProLive(apiKey: string, sport: string) {
  if (resolveProviderName() === 'statpal') return fetchStatPalLive(apiKey, sport);
  return sportsApiProFetchLive(apiKey, sport);
}

export async function fetchSportsApiProSchedule(apiKey: string, sport: string, date: string) {
  if (resolveProviderName() === 'statpal') return fetchStatPalSchedule(apiKey, sport, date);
  return sportsApiProFetchSchedule(apiKey, sport, date);
}

export async function fetchSportsApiProWorldCup2026(apiKey: string) {
  if (resolveProviderName() === 'statpal') return fetchStatPalWorldCup2026(apiKey);
  return sportsApiProFetchWorldCup2026(apiKey);
}

export async function fetchSportsApiProWorldCup2026Info(apiKey: string) {
  if (resolveProviderName() === 'statpal') return fetchStatPalWorldCup2026Info(apiKey);
  return sportsApiProFetchWorldCup2026Info(apiKey);
}

export async function fetchSportsApiProWorldCup2026Groups(apiKey: string) {
  if (resolveProviderName() === 'statpal') return fetchStatPalWorldCup2026Groups(apiKey);
  return sportsApiProFetchWorldCup2026Groups(apiKey);
}

export async function fetchSportsApiProWorldCup2026Matches(apiKey: string, page: number) {
  if (resolveProviderName() === 'statpal') return fetchStatPalWorldCup2026Matches(apiKey, page);
  return sportsApiProFetchWorldCup2026Matches(apiKey, page);
}

export async function fetchSportsApiProMatchOddsAll(
  apiKey: string,
  sport: string,
  matchId: string,
  opts?: { homeTeam?: string; awayTeam?: string; leagueId?: string }
) {
  if (resolveProviderName() === 'statpal') return fetchStatPalMatchOddsAll(apiKey, sport, matchId, opts);
  return sportsApiProFetchMatchOddsAll(apiKey, sport, matchId, opts);
}

export async function fetchSportsApiProMatchOddsLive(
  apiKey: string,
  sport: string,
  matchId: string,
  opts?: { homeTeam?: string; awayTeam?: string; leagueId?: string }
) {
  if (resolveProviderName() === 'statpal') return fetchStatPalMatchOddsLive(apiKey, sport, matchId, opts);
  return sportsApiProFetchMatchOddsLive(apiKey, sport, matchId, opts);
}

export async function fetchSportsApiProMatchOddsPreMatch(
  apiKey: string,
  sport: string,
  matchId: string,
  opts?: { homeTeam?: string; awayTeam?: string; leagueId?: string }
) {
  if (resolveProviderName() === 'statpal') return fetchStatPalMatchOddsPreMatch(apiKey, sport, matchId, opts);
  return sportsApiProFetchMatchOddsPreMatch(apiKey, sport, matchId, opts);
}

export function parseSportsApiProMatchOddsPayload(
  sport: string,
  payload: any,
  opts?: { homeTeam?: string; awayTeam?: string; leagueId?: string }
) {
  if (resolveProviderName() === 'statpal') return parseStatPalMatchOddsPayload(sport, payload, opts);
  return parseSportsApiProOddsPayload(sport, payload, opts);
}

export async function fetchSportsApiProMatchStatistics(apiKey: string, sport: string, matchId: string) {
  if (resolveProviderName() === 'statpal') return fetchStatPalMatchStatistics(apiKey, sport, matchId);
  return sportsApiProFetchMatchStatistics(apiKey, sport, matchId);
}

export async function fetchSportsApiProMatchIncidents(apiKey: string, sport: string, matchId: string) {
  if (resolveProviderName() === 'statpal') return fetchStatPalMatchIncidents(apiKey, sport, matchId);
  return sportsApiProFetchMatchIncidents(apiKey, sport, matchId);
}

export async function fetchSportsApiProH2H(apiKey: string, sport: string, matchId: string) {
  if (resolveProviderName() === 'statpal') return fetchStatPalH2H(apiKey, sport, matchId);
  return sportsApiProFetchH2H(apiKey, sport, matchId);
}

export async function fetchSportsSoccerH2HByTeams(apiKey: string, team1Id: string, team2Id: string) {
  if (resolveProviderName() === 'statpal') return fetchStatPalSoccerH2HByTeams(apiKey, team1Id, team2Id);
  return null;
}

export async function fetchSportsApiProStandings(apiKey: string, sport: string, tournamentId: string) {
  if (resolveProviderName() === 'statpal') return fetchStatPalStandings(apiKey, sport, tournamentId);
  return sportsApiProFetchStandings(apiKey, sport, tournamentId);
}

export async function fetchSportsSoccerInjuriesSuspensions(apiKey: string) {
  if (resolveProviderName() === 'statpal') return fetchStatPalSoccerInjuriesSuspensions(apiKey);
  return null;
}

export async function fetchSportsSoccerTeam(apiKey: string, teamId: string) {
  if (resolveProviderName() === 'statpal') return fetchStatPalSoccerTeam(apiKey, teamId);
  return null;
}

export async function fetchSportsSoccerPlayer(apiKey: string, playerId: string) {
  if (resolveProviderName() === 'statpal') return fetchStatPalSoccerPlayer(apiKey, playerId);
  return null;
}

export async function fetchSportsSoccerCoach(apiKey: string, coachId: string) {
  if (resolveProviderName() === 'statpal') return fetchStatPalSoccerCoach(apiKey, coachId);
  return null;
}

export async function fetchSportsSoccerLiveStorylines(apiKey: string, matchId?: string) {
  if (resolveProviderName() === 'statpal') return fetchStatPalSoccerLiveStorylines(apiKey, matchId);
  return null;
}

export async function fetchSportsSoccerTeamLineups(apiKey: string, matchId?: string) {
  if (resolveProviderName() === 'statpal') return fetchStatPalSoccerTeamLineups(apiKey, matchId);
  return null;
}

export async function fetchSportsSoccerWeatherForecast(apiKey: string) {
  if (resolveProviderName() === 'statpal') return fetchStatPalSoccerWeatherForecast(apiKey);
  return null;
}

export async function fetchSportsSoccerPredictions(apiKey: string) {
  if (resolveProviderName() === 'statpal') return fetchStatPalSoccerPredictions(apiKey);
  return null;
}

export async function fetchSportsSoccerLiveOddsMarkets(apiKey: string) {
  if (resolveProviderName() === 'statpal') return fetchStatPalSoccerLiveOddsMarkets(apiKey);
  return null;
}

export async function fetchSportsSoccerLiveOddsMatchStates(apiKey: string) {
  if (resolveProviderName() === 'statpal') return fetchStatPalSoccerLiveOddsMatchStates(apiKey);
  return null;
}
