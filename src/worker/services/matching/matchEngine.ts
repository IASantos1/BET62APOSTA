type MatchSide = {
  league: string;
  home: string;
  away: string;
  kickoff: string;
};

export type MatchCandidate<T> = {
  item: T;
  league: string;
  home: string;
  away: string;
  kickoff: string;
};

function normalizeText(input: string): string {
  return String(input || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokenize(input: string): string[] {
  const s = normalizeText(input);
  if (!s) return [];
  return s.split(' ').filter(Boolean);
}

function jaroDistance(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const s1 = a;
  const s2 = b;
  const len1 = s1.length;
  const len2 = s2.length;
  const matchDistance = Math.floor(Math.max(len1, len2) / 2) - 1;

  const s1Matches = new Array<boolean>(len1).fill(false);
  const s2Matches = new Array<boolean>(len2).fill(false);

  let matches = 0;
  for (let i = 0; i < len1; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, len2);
    for (let j = start; j < end; j++) {
      if (s2Matches[j]) continue;
      if (s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0;

  let t = 0;
  let k = 0;
  for (let i = 0; i < len1; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) t++;
    k++;
  }

  const transpositions = t / 2;
  return (matches / len1 + matches / len2 + (matches - transpositions) / matches) / 3;
}

function jaroWinkler(a: string, b: string): number {
  const s1 = normalizeText(a);
  const s2 = normalizeText(b);
  const j = jaroDistance(s1, s2);
  const prefixMax = 4;
  let prefix = 0;
  for (let i = 0; i < Math.min(prefixMax, s1.length, s2.length); i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }
  const p = 0.1;
  return j + prefix * p * (1 - j);
}

function tokenSetSimilarity(a: string, b: string): number {
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  if (ta.size === 0 || tb.size === 0) return 0;

  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = ta.size + tb.size - inter;
  return union === 0 ? 0 : inter / union;
}

function smartSimilarity(a: string, b: string): number {
  const jw = jaroWinkler(a, b);
  const ts = tokenSetSimilarity(a, b);
  return Math.max(jw, ts);
}

function parseKickoffMs(iso: string): number {
  const t = Date.parse(String(iso || ''));
  return Number.isFinite(t) ? t : 0;
}

export function scoreMatch(a: MatchSide, b: MatchSide): number {
  let score = 0;

  const leagueSim = smartSimilarity(a.league, b.league);
  if (leagueSim >= 0.9) score += 30;
  else if (leagueSim >= 0.8) score += 22;
  else if (leagueSim >= 0.7) score += 15;

  const homeSim = smartSimilarity(a.home, b.home);
  if (homeSim >= 0.92) score += 30;
  else if (homeSim >= 0.85) score += 22;
  else if (homeSim >= 0.75) score += 15;

  const awaySim = smartSimilarity(a.away, b.away);
  if (awaySim >= 0.92) score += 30;
  else if (awaySim >= 0.85) score += 22;
  else if (awaySim >= 0.75) score += 15;

  const ta = parseKickoffMs(a.kickoff);
  const tb = parseKickoffMs(b.kickoff);
  if (ta && tb) {
    const diffMin = Math.abs(ta - tb) / (60 * 1000);
    if (diffMin <= 60) score += 10;
    else if (diffMin <= 120) score += 6;
    else if (diffMin <= 240) score += 2;
  }

  return score;
}

export function findBestCandidate<T>(
  base: MatchSide,
  candidates: Array<MatchCandidate<T>>,
  minScore = 80,
): { item: T; score: number } | null {
  let best: { item: T; score: number } | null = null;

  for (const c of candidates) {
    const direct = scoreMatch(base, { league: c.league, home: c.home, away: c.away, kickoff: c.kickoff });
    const swapped = scoreMatch(base, { league: c.league, home: c.away, away: c.home, kickoff: c.kickoff });
    const s = Math.max(direct, swapped);

    if (!best || s > best.score) best = { item: c.item, score: s };
  }

  if (!best || best.score < minScore) return null;
  return best;
}

