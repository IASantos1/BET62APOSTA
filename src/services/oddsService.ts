import { apiFetch } from './backendClient';
import { fetchEventOdds } from './apiFootballService';

export interface LiveOddsItem {
  matchId: string;
  odds: {
    home: number;
    draw: number;
    away: number;
  };
}

const liveOddsCache: Record<string, LiveOddsItem[]> = {};

function mergeLiveOdds(previous: LiveOddsItem[], current: LiveOddsItem[]): LiveOddsItem[] {
  if (!previous.length) {
    return current;
  }
  if (!current.length) {
    return previous;
  }
  const map = new Map<string, LiveOddsItem>();
  for (const item of previous) {
    map.set(String(item.matchId), item);
  }
  for (const item of current) {
    map.set(String(item.matchId), item);
  }
  return Array.from(map.values());
}

export async function fetchLiveOdds(): Promise<LiveOddsItem[]> {
  const path = '/football/odds/live';
  const data = await apiFetch(path, { method: 'GET' });
  if (!Array.isArray(data)) {
    return liveOddsCache[path] || [];
  }
  const list = data as LiveOddsItem[];
  const merged = liveOddsCache[path]
    ? mergeLiveOdds(liveOddsCache[path], list)
    : list;
  liveOddsCache[path] = merged;
  return merged;
}

/**
 * Busca odds ao vivo por desporto
 * football → /football/odds/live (1X2)
 * basketball → /basketball/odds/live (moneyline)
 * default → /{sport}/odds/live (formato compatível)
 */
export async function fetchLiveOddsBySport(sport: string): Promise<LiveOddsItem[]> {
  const s = (sport || '').toLowerCase();
  let path = '/football/odds/live';
  if (s.includes('basket')) {
    path = '/basketball/odds/live';
  } else if (s.includes('hockey')) {
    path = '/hockey/odds/live';
  } else if (s.includes('baseball')) {
    path = '/baseball/odds/live';
  } else if (s.includes('football') || s.includes('soccer') || s.includes('futebol')) {
    path = '/football/odds/live';
  }

  const data = await apiFetch(path, { method: 'GET' });
  if (!Array.isArray(data)) {
    return liveOddsCache[path] || [];
  }
  const list = data as LiveOddsItem[];
  const merged = liveOddsCache[path]
    ? mergeLiveOdds(liveOddsCache[path], list)
    : list;
  liveOddsCache[path] = merged;
  return merged;
}

export async function fetchUpcomingOddsBySport(sport: string): Promise<LiveOddsItem[]> {
  const s = (sport || '').toLowerCase();

  if (!(s.includes('football') || s.includes('soccer') || s.includes('futebol'))) {
    return [];
  }

  const path = '/football/odds/upcoming';
  const data = await apiFetch(path, { method: 'GET' });
  if (!Array.isArray(data)) {
    return liveOddsCache[path] || [];
  }
  const list = data as LiveOddsItem[];
  const merged = liveOddsCache[path]
    ? mergeLiveOdds(liveOddsCache[path], list)
    : list;
  liveOddsCache[path] = merged;
  return merged;
}

export async function fetchFixture1X2OddsFromApiFootball(
  fixtureId: string | number,
): Promise<{ home: number; draw?: number; away: number } | null> {
  const id = Number(fixtureId);
  if (!id || Number.isNaN(id)) {
    return null;
  }

  const preData: any[] = await fetchEventOdds('football', String(id));
  if (!Array.isArray(preData) || preData.length === 0) {
    return null;
  }

  const fixture = preData[0] as any;
  const bookmakers = Array.isArray(fixture?.bookmakers) ? fixture.bookmakers : [];
  const mainBookmaker = bookmakers[0];
  const bets = Array.isArray(mainBookmaker?.bets) ? mainBookmaker.bets : [];

  const matchWinner = bets.find((b: any) => {
    const n = String(b?.name || '').toLowerCase();
    const betId = typeof b?.id === 'number' ? b.id : parseInt(String(b?.id || ''), 10);
    return (
      betId === 1 ||
      n.includes('match winner') ||
      n.includes('matchwinner') ||
      n.includes('1x2') ||
      n.includes('fulltime result') ||
      n.includes('full time result') ||
      n.includes('resultado final')
    );
  });

  if (!matchWinner || !Array.isArray(matchWinner.values)) {
    return null;
  }

  let home: number | null = null;
  let draw: number | null = null;
  let away: number | null = null;

  for (const v of matchWinner.values) {
    const label = String(v?.value || '').toLowerCase();
    const odd = v?.odd != null ? Number(v.odd) : NaN;
    if (!Number.isFinite(odd) || odd <= 1.01) continue;
    if ((label === 'home' || label === '1') && home == null) home = odd;
    if ((label === 'draw' || label === 'x') && draw == null) draw = odd;
    if ((label === 'away' || label === '2') && away == null) away = odd;
  }

  if (home != null && away != null) {
    return {
      home,
      draw: draw ?? undefined,
      away,
    };
  }

  return null;
}
