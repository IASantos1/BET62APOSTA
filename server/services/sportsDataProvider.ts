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

export function getSportsDataProviderConfig() {
  const provider = resolveProviderName();
  const apiKey = String(
    provider === 'statpal'
      ? (process.env.STATPAL_KEY || process.env.SPORTS_API_KEY || '')
      : (process.env.SPORTS_API_KEY || process.env.STATPAL_KEY || ''),
  ).trim();
  return {
    provider,
    apiKey,
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
  opts?: { homeTeam?: string; awayTeam?: string }
) {
  if (resolveProviderName() === 'statpal') return fetchStatPalMatchOddsAll(apiKey, sport, matchId, opts);
  return sportsApiProFetchMatchOddsAll(apiKey, sport, matchId, opts);
}

export async function fetchSportsApiProMatchOddsLive(
  apiKey: string,
  sport: string,
  matchId: string,
  opts?: { homeTeam?: string; awayTeam?: string }
) {
  if (resolveProviderName() === 'statpal') return fetchStatPalMatchOddsLive(apiKey, sport, matchId, opts);
  return sportsApiProFetchMatchOddsLive(apiKey, sport, matchId, opts);
}

export async function fetchSportsApiProMatchOddsPreMatch(
  apiKey: string,
  sport: string,
  matchId: string,
  opts?: { homeTeam?: string; awayTeam?: string }
) {
  if (resolveProviderName() === 'statpal') return fetchStatPalMatchOddsPreMatch(apiKey, sport, matchId, opts);
  return sportsApiProFetchMatchOddsPreMatch(apiKey, sport, matchId, opts);
}

export function parseSportsApiProMatchOddsPayload(
  sport: string,
  payload: any,
  opts?: { homeTeam?: string; awayTeam?: string }
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

export async function fetchSportsApiProStandings(apiKey: string, sport: string, tournamentId: string) {
  if (resolveProviderName() === 'statpal') return fetchStatPalStandings(apiKey, sport, tournamentId);
  return sportsApiProFetchStandings(apiKey, sport, tournamentId);
}
