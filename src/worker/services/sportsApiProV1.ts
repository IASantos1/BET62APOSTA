import { NormalizedEvent } from './sportsApi';

function apiHeaders(apiKey: string): HeadersInit {
  return {
    'x-api-key': apiKey,
    'accept': 'application/json',
  };
}

function toSubdomain(sport: string): string {
  const s = String(sport || '').toLowerCase().trim();
  if (s === 'soccer') return 'football';
  if (s === 'ice-hockey') return 'hockey';
  return s;
}

function toSportId(sport: string): number {
  const s = String(sport || '').toLowerCase().trim();
  if (s === 'soccer') return 1;
  if (s === 'basketball') return 2;
  if (s === 'tennis') return 3;
  if (s === 'ice-hockey') return 4;
  return 0;
}

function gameSportId(g: any): number {
  const direct = g?.sportId ?? g?.sport_id ?? g?.sport?.id ?? g?.sport?.sportId;
  const n = typeof direct === 'string' ? Number(direct) : Number(direct);
  return Number.isFinite(n) ? n : 0;
}

function filterBySportId(sport: string, games: any[]): any[] {
  const expected = toSportId(sport);
  if (!expected) return [];
  return games.filter((g) => gameSportId(g) === expected);
}

function extractGames(payload: any): any[] {
  if (!payload) return [];
  if (Array.isArray(payload.games)) return payload.games;
  if (Array.isArray(payload.data?.games)) return payload.data.games;
  if (Array.isArray(payload.data?.scores)) return payload.data.scores;
  return [];
}

function num(v: any): number {
  const n = typeof v === 'string' ? Number(v) : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function isoDate(v: any): string {
  const raw = String(v || '').trim();
  if (!raw) return '';
  const d = new Date(raw);
  return Number.isFinite(d.getTime()) ? d.toISOString() : raw;
}

function normalizeGame(sport: string, g: any): NormalizedEvent | null {
  const id = g?.id != null ? String(g.id) : '';
  if (!id) return null;

  const home = g?.homeCompetitor || {};
  const away = g?.awayCompetitor || {};
  const homeName = String(home?.name || '').trim();
  const awayName = String(away?.name || '').trim();
  if (!homeName || !awayName) return null;

  const startTime = isoDate(g?.startTime);
  if (!startTime) return null;

  const league = String(g?.competitionDisplayName || g?.competition?.name || '').trim();
  const country = String(g?.competition?.country?.name || '').trim();
  const status = String(g?.statusText || '').trim() || 'NS';
  const statusGroup = num(g?.statusGroup);
  const st = status.toLowerCase();
  const finished =
    st.includes('final') ||
    st.includes('ended') ||
    st === 'ft' ||
    st.includes('full time') ||
    st.includes('after') ||
    st.includes('cancel') ||
    st.includes('postpon');
  const liveByText =
    st.includes('live') ||
    st.includes('in play') ||
    st.includes('inplay') ||
    st.includes('1h') ||
    st.includes('2h') ||
    st.includes('ht') ||
    st.includes('et') ||
    st.includes('pen') ||
    st.includes('q1') ||
    st.includes('q2') ||
    st.includes('q3') ||
    st.includes('q4') ||
    st.includes('quarter') ||
    st.includes('inning') ||
    st.includes('set');
  const is_live = finished ? 0 : statusGroup === 1 || liveByText ? 1 : 0;

  const hs = home?.score != null ? num(home.score) : null;
  const as = away?.score != null ? num(away.score) : null;

  return {
    external_event_id: `${sport}_${id}`,
    sport,
    league,
    home_team: homeName,
    away_team: awayName,
    team_match: `${homeName} vs ${awayName}`,
    event_date: startTime,
    status,
    is_live,
    home_odd: 0,
    draw_odd: 0,
    away_odd: 0,
    elapsed: 0,
    timer: '',
    score: JSON.stringify({ home: hs, away: as }),
    markets: '{}',
    country,
    home_team_logo: String(home?.imageUrl || ''),
    away_team_logo: String(away?.imageUrl || ''),
  };
}

async function fetchJson(url: string, apiKey: string): Promise<any | null> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, { headers: apiHeaders(apiKey), signal: controller.signal });
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      console.warn('[sportsApiProV1] HTTP error', res.status, url, String(text || '').slice(0, 200));
      return null;
    }
    try {
      return text ? JSON.parse(text) : null;
    } catch {
      return null;
    }
  } catch (e: any) {
    console.warn('[sportsApiProV1] fetch error', url, String(e?.message || e));
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function fetchFirstOk(urls: string[], apiKey: string): Promise<any | null> {
  for (const u of urls) {
    const out = await fetchJson(u, apiKey);
    if (out) return out;
  }
  return null;
}

export async function fetchSportsApiProV1Live(apiKey: string, sport: string): Promise<NormalizedEvent[]> {
  const sub = toSubdomain(sport);
  const json = await fetchFirstOk(
    [
      `https://v1.${sub}.sportsapipro.com/api/v1/${sub}/live`,
      `https://v1.${sub}.sportsapipro.com/games/current`,
      `https://v1.${sub}.sportsapipro.com/games/allscores`,
    ],
    apiKey,
  );
  const games = filterBySportId(sport, extractGames(json));
  const out: NormalizedEvent[] = [];
  for (const g of games) {
    const n = normalizeGame(sport, g);
    if (n) out.push(n);
  }
  return out;
}

export async function fetchSportsApiProV1GamesRange(
  apiKey: string,
  sport: string,
  startDate: string,
  endDate: string,
): Promise<NormalizedEvent[]> {
  const sportId = toSportId(sport);
  if (!sportId) return [];
  const sub = toSubdomain(sport);
  const json = await fetchFirstOk(
    [
      `https://v1.football.sportsapipro.com/api/v1/games?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}&sportId=${encodeURIComponent(String(sportId))}`,
      `https://v1.${sub}.sportsapipro.com/api/v1/${sub}/all`,
      `https://v1.${sub}.sportsapipro.com/games/fixtures`,
      `https://v1.${sub}.sportsapipro.com/games/results`,
      `https://v1.${sub}.sportsapipro.com/games/allscores`,
    ],
    apiKey,
  );
  const games = filterBySportId(sport, extractGames(json));
  const out: NormalizedEvent[] = [];
  for (const g of games) {
    const n = normalizeGame(sport, g);
    if (n) out.push(n);
  }
  return out;
}
