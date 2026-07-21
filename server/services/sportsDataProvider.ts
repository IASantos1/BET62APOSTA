/**
 * Sports data provider — StatPal only.
 * All SportsApiPro references have been removed; every function delegates
 * directly to the StatPal implementation.
 */

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

export type SportsDataProviderName = 'statpal';

// StatPal default access key (can be overridden via STATPAL_ACCESS_KEY env var)
const STATPAL_DEFAULT_KEY = 'b5b07a3f-b019-4a18-8969-6045169feda9';

function resolveProviderApiKey(): { apiKey: string; envSource: string } {
  if (process.env.STATPAL_ACCESS_KEY) return { apiKey: String(process.env.STATPAL_ACCESS_KEY).trim(), envSource: 'STATPAL_ACCESS_KEY' };
  if (process.env.STATPAL_KEY) return { apiKey: String(process.env.STATPAL_KEY).trim(), envSource: 'STATPAL_KEY' };
  return { apiKey: STATPAL_DEFAULT_KEY, envSource: 'default' };
}

export function getSportsDataProviderConfig() {
  const provider: SportsDataProviderName = 'statpal';
  const { apiKey, envSource } = resolveProviderApiKey();
  return {
    provider,
    apiKey,
    envSource,
    supportsUpstreamWs: false,
  };
}

// ── Re-exported under the legacy "SportsApiPro" names so call-sites in
//    events.ts and settlement.ts don't need renaming. ──────────────────────────

export async function fetchSportsApiProV1AllScoresDelta(apiKey: string, sport: string) {
  return fetchStatPalV1AllScoresDelta(apiKey, sport);
}

export async function fetchSportsApiProLive(apiKey: string, sport: string) {
  return fetchStatPalLive(apiKey, sport);
}

export async function fetchSportsApiProSchedule(apiKey: string, sport: string, date: string) {
  return fetchStatPalSchedule(apiKey, sport, date);
}

export async function fetchSportsApiProWorldCup2026(apiKey: string) {
  return fetchStatPalWorldCup2026(apiKey);
}

export async function fetchSportsApiProWorldCup2026Info(apiKey: string) {
  return fetchStatPalWorldCup2026Info(apiKey);
}

export async function fetchSportsApiProWorldCup2026Groups(apiKey: string) {
  return fetchStatPalWorldCup2026Groups(apiKey);
}

export async function fetchSportsApiProWorldCup2026Matches(apiKey: string, page: number) {
  return fetchStatPalWorldCup2026Matches(apiKey, page);
}

export async function fetchSportsApiProMatchOddsAll(
  apiKey: string,
  sport: string,
  matchId: string,
  opts?: { homeTeam?: string; awayTeam?: string; leagueId?: string; matchIds?: string[] },
) {
  return fetchStatPalMatchOddsAll(apiKey, sport, matchId, opts);
}

export async function fetchSportsApiProMatchOddsLive(
  apiKey: string,
  sport: string,
  matchId: string,
  opts?: { homeTeam?: string; awayTeam?: string; leagueId?: string; matchIds?: string[] },
) {
  return fetchStatPalMatchOddsLive(apiKey, sport, matchId, opts);
}

export async function fetchSportsApiProMatchOddsPreMatch(
  apiKey: string,
  sport: string,
  matchId: string,
  opts?: { homeTeam?: string; awayTeam?: string; leagueId?: string; matchIds?: string[] },
) {
  return fetchStatPalMatchOddsPreMatch(apiKey, sport, matchId, opts);
}

export function parseSportsApiProMatchOddsPayload(
  sport: string,
  payload: any,
  opts?: { homeTeam?: string; awayTeam?: string; leagueId?: string },
) {
  return parseStatPalMatchOddsPayload(sport, payload, opts);
}

export async function fetchSportsApiProMatchStatistics(apiKey: string, sport: string, matchId: string) {
  return fetchStatPalMatchStatistics(apiKey, sport, matchId);
}

export async function fetchSportsApiProMatchIncidents(apiKey: string, sport: string, matchId: string) {
  return fetchStatPalMatchIncidents(apiKey, sport, matchId);
}

export async function fetchSportsApiProH2H(apiKey: string, sport: string, matchId: string) {
  return fetchStatPalH2H(apiKey, sport, matchId);
}

export async function fetchSportsSoccerH2HByTeams(apiKey: string, team1Id: string, team2Id: string) {
  return fetchStatPalSoccerH2HByTeams(apiKey, team1Id, team2Id);
}

export async function fetchSportsApiProStandings(apiKey: string, sport: string, tournamentId: string) {
  return fetchStatPalStandings(apiKey, sport, tournamentId);
}

export async function fetchSportsSoccerInjuriesSuspensions(apiKey: string) {
  return fetchStatPalSoccerInjuriesSuspensions(apiKey);
}

export async function fetchSportsSoccerTeam(apiKey: string, teamId: string) {
  return fetchStatPalSoccerTeam(apiKey, teamId);
}

export async function fetchSportsSoccerPlayer(apiKey: string, playerId: string) {
  return fetchStatPalSoccerPlayer(apiKey, playerId);
}

export async function fetchSportsSoccerCoach(apiKey: string, coachId: string) {
  return fetchStatPalSoccerCoach(apiKey, coachId);
}

export async function fetchSportsSoccerLiveStorylines(apiKey: string, matchId?: string) {
  return fetchStatPalSoccerLiveStorylines(apiKey, matchId);
}

export async function fetchSportsSoccerTeamLineups(apiKey: string, matchId?: string) {
  return fetchStatPalSoccerTeamLineups(apiKey, matchId);
}

export async function fetchSportsSoccerWeatherForecast(apiKey: string) {
  return fetchStatPalSoccerWeatherForecast(apiKey);
}

export async function fetchSportsSoccerPredictions(apiKey: string) {
  return fetchStatPalSoccerPredictions(apiKey);
}

export async function fetchSportsSoccerLiveOddsMarkets(apiKey: string) {
  return fetchStatPalSoccerLiveOddsMarkets(apiKey);
}

export async function fetchSportsSoccerLiveOddsMatchStates(apiKey: string) {
  return fetchStatPalSoccerLiveOddsMatchStates(apiKey);
}
