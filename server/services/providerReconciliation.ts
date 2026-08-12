import { similarity } from '../utils/fuzzyMatch';

export const AUTO_MATCH_THRESHOLD = 0.92;
export const REVIEW_MATCH_THRESHOLD = 0.8;

type Nullable<T> = T | null | undefined;

export interface CanonicalFixtureInput {
  fixtureId: string;
  apiFootballFixtureId?: string;
  leagueId?: string;
  leagueName?: string;
  country?: string;
  kickoff?: string | Date;
  homeTeamId?: string;
  awayTeamId?: string;
  homeTeamName: string;
  awayTeamName: string;
}

export interface ProviderFixtureInput {
  provider: string;
  fixtureId: string;
  leagueId?: string;
  leagueName?: string;
  country?: string;
  kickoff?: string | Date;
  homeTeamId?: string;
  awayTeamId?: string;
  homeTeamName: string;
  awayTeamName: string;
  payload?: unknown;
}

export interface FixtureMatchComponents {
  homeSimilarity: number;
  awaySimilarity: number;
  kickoffScore: number;
  leagueScore: number;
}

export type FixtureMatchDecision = 'auto' | 'review' | 'reject';

export interface ProviderFixtureCandidate {
  providerFixture: ProviderFixtureInput;
  score: number;
  decision: FixtureMatchDecision;
  method: 'exact' | 'fuzzy' | 'fixture-context';
  reason: string;
  isTeamOrderReversed: boolean;
  components: FixtureMatchComponents;
  normalized: {
    canonicalHome: string;
    canonicalAway: string;
    providerHome: string;
    providerAway: string;
  };
}

export interface TeamMappingSuggestion {
  provider: string;
  providerTeamId?: string;
  providerTeamName: string;
  canonicalTeamId?: string;
  canonicalTeamName: string;
  normalizedProviderName: string;
  normalizedCanonicalName: string;
  confidenceScore: number;
  matchMethod: 'exact' | 'fuzzy' | 'fixture-context';
  manualOverride: boolean;
}

export interface ReconciliationPersistencePayload {
  fixtureMapping: {
    provider: string;
    provider_fixture_id: string;
    canonical_fixture_id: string;
    api_football_fixture_id?: string;
    provider_home_team_id?: string;
    provider_away_team_id?: string;
    provider_league_id?: string;
    provider_league_name?: string;
    provider_country?: string;
    provider_kickoff?: string;
    normalized_home_team: string;
    normalized_away_team: string;
    confidence_score: number;
    match_method: 'exact' | 'fuzzy' | 'fixture-context';
    manual_override: boolean;
    status: 'matched' | 'review' | 'rejected';
    review_reason?: string;
    payload?: unknown;
    last_verified_at: string;
  };
  teamMappings: TeamMappingSuggestion[];
}

const TEAM_NOISE_WORDS = /\b(fc|cf|sc|ac|afc|club|de|the|football|futebol|sociedad|associazione|calcio)\b/g;
const SPACE_PATTERN = /\s+/g;

const PHRASE_ALIASES: Array<[RegExp, string]> = [
  [/\bsaint\b/g, 'st'],
  [/\bst\.\b/g, 'st'],
  [/\bsporting lisbon\b/g, 'sporting cp'],
  [/\bparis saint germain\b/g, 'psg'],
  [/\bparis st germain\b/g, 'psg'],
  [/\binternazionale\b/g, 'inter'],
  [/\bbayern munchen\b/g, 'bayern munich'],
  [/\bbayern münchen\b/g, 'bayern munich'],
  [/\bmanchester united\b/g, 'man utd'],
  [/\bmanchester city\b/g, 'man city'],
];

function clampScore(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(4))));
}

function asDate(value: Nullable<string | Date>): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function minutesBetween(a: Nullable<string | Date>, b: Nullable<string | Date>): number | null {
  const left = asDate(a);
  const right = asDate(b);
  if (!left || !right) return null;
  return Math.abs(left.getTime() - right.getTime()) / 60_000;
}

export function normalizeProviderTeamName(name: Nullable<string>): string {
  let normalized = String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  for (const [pattern, replacement] of PHRASE_ALIASES) {
    normalized = normalized.replace(pattern, replacement);
  }

  return normalized
    .replace(TEAM_NOISE_WORDS, ' ')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(SPACE_PATTERN, ' ')
    .trim();
}

export function normalizeProviderTeamKey(name: Nullable<string>): string {
  return normalizeProviderTeamName(name).replace(/\s+/g, '');
}

function computeKickoffScore(a: Nullable<string | Date>, b: Nullable<string | Date>): number {
  const deltaMinutes = minutesBetween(a, b);
  if (deltaMinutes == null) return 0.5;
  if (deltaMinutes <= 5) return 1;
  if (deltaMinutes <= 10) return 0.95;
  if (deltaMinutes <= 30) return 0.75;
  if (deltaMinutes <= 60) return 0.35;
  return 0;
}

function computeLeagueScore(canonical: CanonicalFixtureInput, provider: ProviderFixtureInput): number {
  const canonicalLeagueId = String(canonical.leagueId || '').trim();
  const providerLeagueId = String(provider.leagueId || '').trim();
  if (canonicalLeagueId && providerLeagueId) {
    return canonicalLeagueId === providerLeagueId ? 1 : 0;
  }

  const canonicalLeague = normalizeProviderTeamKey(canonical.leagueName);
  const providerLeague = normalizeProviderTeamKey(provider.leagueName);
  if (canonicalLeague && providerLeague) {
    if (canonicalLeague === providerLeague) return 1;
    return clampScore(similarity(canonicalLeague, providerLeague));
  }

  const canonicalCountry = normalizeProviderTeamKey(canonical.country);
  const providerCountry = normalizeProviderTeamKey(provider.country);
  if (canonicalCountry && providerCountry) {
    return canonicalCountry === providerCountry ? 0.5 : 0;
  }

  return 0;
}

function directSimilarity(left: string, right: string): number {
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) return 0.96;
  return clampScore(similarity(left, right));
}

export function scoreProviderFixtureCandidate(
  canonical: CanonicalFixtureInput,
  provider: ProviderFixtureInput,
): ProviderFixtureCandidate {
  const canonicalHome = normalizeProviderTeamKey(canonical.homeTeamName);
  const canonicalAway = normalizeProviderTeamKey(canonical.awayTeamName);
  const providerHome = normalizeProviderTeamKey(provider.homeTeamName);
  const providerAway = normalizeProviderTeamKey(provider.awayTeamName);

  const directHome = directSimilarity(canonicalHome, providerHome);
  const directAway = directSimilarity(canonicalAway, providerAway);
  const reverseHome = directSimilarity(canonicalHome, providerAway);
  const reverseAway = directSimilarity(canonicalAway, providerHome);

  const directAverage = (directHome + directAway) / 2;
  const reverseAverage = (reverseHome + reverseAway) / 2;
  const isTeamOrderReversed = reverseAverage > directAverage;

  const homeSimilarity = isTeamOrderReversed ? reverseHome : directHome;
  const awaySimilarity = isTeamOrderReversed ? reverseAway : directAway;
  const kickoffScore = computeKickoffScore(canonical.kickoff, provider.kickoff);
  const leagueScore = computeLeagueScore(canonical, provider);

  let score = clampScore(
    homeSimilarity * 0.4 +
      awaySimilarity * 0.4 +
      kickoffScore * 0.15 +
      leagueScore * 0.05,
  );

  let decision: FixtureMatchDecision;
  let reason: string;
  let method: 'exact' | 'fuzzy' | 'fixture-context';

  if (isTeamOrderReversed) {
    score = Math.min(score, 0.79);
    decision = 'review';
    reason = 'ordem de mandante/visitante invertida no provider';
    method = 'fixture-context';
  } else if (score >= AUTO_MATCH_THRESHOLD) {
    decision = 'auto';
    reason = 'score acima do limiar de automatch';
    method = homeSimilarity === 1 && awaySimilarity === 1 ? 'exact' : 'fuzzy';
  } else if (score >= REVIEW_MATCH_THRESHOLD) {
    decision = 'review';
    reason = 'score intermediario, exige revisao manual';
    method = 'fixture-context';
  } else {
    decision = 'reject';
    reason = 'score abaixo do limiar minimo';
    method = 'fixture-context';
  }

  return {
    providerFixture: provider,
    score,
    decision,
    method,
    reason,
    isTeamOrderReversed,
    components: {
      homeSimilarity,
      awaySimilarity,
      kickoffScore,
      leagueScore,
    },
    normalized: {
      canonicalHome,
      canonicalAway,
      providerHome,
      providerAway,
    },
  };
}

export function rankProviderFixtureCandidates(
  canonical: CanonicalFixtureInput,
  candidates: ProviderFixtureInput[],
): ProviderFixtureCandidate[] {
  return candidates
    .map((candidate) => scoreProviderFixtureCandidate(canonical, candidate))
    .sort((left, right) => right.score - left.score);
}

export function pickBestProviderFixtureCandidate(
  canonical: CanonicalFixtureInput,
  candidates: ProviderFixtureInput[],
): ProviderFixtureCandidate | null {
  return rankProviderFixtureCandidates(canonical, candidates)[0] ?? null;
}

export function buildTeamMappingSuggestions(
  canonical: CanonicalFixtureInput,
  candidate: ProviderFixtureCandidate,
): TeamMappingSuggestion[] {
  const providerFixture = candidate.providerFixture;
  const matchMethod = candidate.method;
  const manualOverride = candidate.decision !== 'auto';

  return [
    {
      provider: providerFixture.provider,
      providerTeamId: candidate.isTeamOrderReversed
        ? providerFixture.awayTeamId
        : providerFixture.homeTeamId,
      providerTeamName: candidate.isTeamOrderReversed
        ? providerFixture.awayTeamName
        : providerFixture.homeTeamName,
      canonicalTeamId: canonical.homeTeamId,
      canonicalTeamName: canonical.homeTeamName,
      normalizedProviderName: candidate.isTeamOrderReversed
        ? candidate.normalized.providerAway
        : candidate.normalized.providerHome,
      normalizedCanonicalName: candidate.normalized.canonicalHome,
      confidenceScore: candidate.components.homeSimilarity,
      matchMethod,
      manualOverride,
    },
    {
      provider: providerFixture.provider,
      providerTeamId: candidate.isTeamOrderReversed
        ? providerFixture.homeTeamId
        : providerFixture.awayTeamId,
      providerTeamName: candidate.isTeamOrderReversed
        ? providerFixture.homeTeamName
        : providerFixture.awayTeamName,
      canonicalTeamId: canonical.awayTeamId,
      canonicalTeamName: canonical.awayTeamName,
      normalizedProviderName: candidate.isTeamOrderReversed
        ? candidate.normalized.providerHome
        : candidate.normalized.providerAway,
      normalizedCanonicalName: candidate.normalized.canonicalAway,
      confidenceScore: candidate.components.awaySimilarity,
      matchMethod,
      manualOverride,
    },
  ];
}

export function buildReconciliationPersistencePayload(
  canonical: CanonicalFixtureInput,
  candidate: ProviderFixtureCandidate,
): ReconciliationPersistencePayload {
  const verifiedAt = new Date().toISOString();
  const teamMappings = buildTeamMappingSuggestions(canonical, candidate);

  return {
    fixtureMapping: {
      provider: candidate.providerFixture.provider,
      provider_fixture_id: candidate.providerFixture.fixtureId,
      canonical_fixture_id: canonical.fixtureId,
      api_football_fixture_id: canonical.apiFootballFixtureId,
      provider_home_team_id: candidate.providerFixture.homeTeamId,
      provider_away_team_id: candidate.providerFixture.awayTeamId,
      provider_league_id: candidate.providerFixture.leagueId,
      provider_league_name: candidate.providerFixture.leagueName,
      provider_country: candidate.providerFixture.country,
      provider_kickoff: asDate(candidate.providerFixture.kickoff)?.toISOString(),
      normalized_home_team: candidate.normalized.providerHome,
      normalized_away_team: candidate.normalized.providerAway,
      confidence_score: candidate.score,
      match_method: candidate.method,
      manual_override: candidate.decision !== 'auto',
      status:
        candidate.decision === 'auto'
          ? 'matched'
          : candidate.decision === 'review'
            ? 'review'
            : 'rejected',
      review_reason: candidate.reason,
      payload: candidate.providerFixture.payload,
      last_verified_at: verifiedAt,
    },
    teamMappings,
  };
}
