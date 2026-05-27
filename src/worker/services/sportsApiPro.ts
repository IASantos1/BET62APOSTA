import { NormalizedEvent } from './sportsApi';

const lastLogAt = new Map<string, number>();

function shouldLog(key: string, ttlMs: number): boolean {
  const now = Date.now();
  const prev = lastLogAt.get(key) || 0;
  if (now - prev < ttlMs) return false;
  lastLogAt.set(key, now);
  return true;
}

function apiHeaders(apiKey: string): HeadersInit {
  return {
    'x-api-key': apiKey,
    'accept': 'application/json',
  };
}

function normalizeSportKey(sport: string): string {
  const raw = String(sport || '').toLowerCase().trim();
  const primary = raw.split(',')[0]?.split('|')[0] ?? '';
  return primary
    .replace(/[_\s]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
}

function toSubdomain(sport: string): string {
  const s = normalizeSportKey(sport);
  if (s === 'football' || s === 'futebol' || s === 'soccer') return 'football';
  if (s === 'hockey' || s === 'icehockey' || s === 'ice-hockey') return 'hockey';
  return s || 'football';
}

function extractEvents(payload: any): any[] {
  if (!payload) return [];
  if (Array.isArray(payload.events)) return payload.events;
  if (Array.isArray(payload.data?.events)) return payload.data.events;
  const tournaments = payload.data?.tournaments ?? payload.tournaments;
  if (Array.isArray(tournaments)) {
    const out: any[] = [];
    for (const t of tournaments) {
      const arr = t?.events ?? t?.matches ?? t?.games ?? [];
      if (Array.isArray(arr)) out.push(...arr);
    }
    return out;
  }
  return [];
}

function num(v: any): number {
  const n = typeof v === 'string' ? Number(v) : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function pickScore(x: any): number | null {
  if (x == null) return null;
  if (typeof x === 'number') return Number.isFinite(x) ? x : null;
  if (typeof x === 'string') {
    const n = Number(x);
    return Number.isFinite(n) ? n : null;
  }
  const candidates = [x.current, x.display, x.normaltime, x.total];
  for (const c of candidates) {
    const n = typeof c === 'string' ? Number(c) : Number(c);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function isLive(status: any): boolean {
  const s = String(status?.description ?? status?.type ?? status ?? '').toLowerCase();
  if (!s) return false;
  if (s.includes('inprogress') || s.includes('in progress') || s.includes('live')) return true;
  if (s.includes('half') || s.includes('quarter') || s.includes('inning') || s.includes('set')) return true;
  if (s.includes('1st') || s.includes('2nd') || s.includes('3rd') || s.includes('4th')) return true;
  return false;
}

function normalizeEvent(sport: string, e: any): NormalizedEvent | null {
  const id = e?.id != null ? String(e.id) : '';
  if (!id) return null;

  const homeName = String(e?.homeTeam?.name ?? e?.homeTeam ?? '').trim();
  const awayName = String(e?.awayTeam?.name ?? e?.awayTeam ?? '').trim();
  if (!homeName || !awayName) return null;

  const ts = e?.startTimestamp != null ? num(e.startTimestamp) : 0;
  const date = ts > 0 ? new Date(ts * 1000).toISOString() : String(e?.startTime ?? e?.event_date ?? '').trim();
  if (!date) return null;

  const tournament = e?.tournament?.name ?? e?.tournament ?? '';
  const country = e?.tournament?.category?.name ?? e?.category?.name ?? e?.country?.name ?? '';
  const statusRaw = e?.status?.description ?? e?.status?.type ?? e?.status ?? e?.statusCode ?? e?.statusText ?? '';
  const status = String(statusRaw || 'NS');
  const live = isLive(e?.status ?? status);

  const hs = pickScore(e?.homeScore);
  const as = pickScore(e?.awayScore);

  return {
    external_event_id: `${sport}_${id}`,
    sport,
    league: String(tournament || ''),
    home_team: homeName,
    away_team: awayName,
    team_match: `${homeName} vs ${awayName}`,
    event_date: date,
    status,
    is_live: live ? 1 : 0,
    home_odd: 0,
    draw_odd: 0,
    away_odd: 0,
    elapsed: 0,
    timer: '',
    score: JSON.stringify({ home: hs, away: as }),
    markets: '{}',
    country: String(country || ''),
    home_team_logo: String(e?.homeTeam?.logo ?? ''),
    away_team_logo: String(e?.awayTeam?.logo ?? ''),
  };
}

async function fetchJson(url: string, apiKey: string): Promise<any | null> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, { headers: apiHeaders(apiKey), signal: controller.signal });
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      if (res.status === 404 && url.includes('/odds')) return null;
      const host = (() => {
        try {
          return new URL(url).host;
        } catch {
          return '';
        }
      })();
      const key = `[sportsApiPro] http:${res.status}:${host}`;
      if (shouldLog(key, 60_000)) {
        console.warn('[sportsApiPro] HTTP error', res.status, url, String(text || '').slice(0, 200));
      }
      return null;
    }
    try {
      return text ? JSON.parse(text) : null;
    } catch {
      return null;
    }
  } catch (e: any) {
    const host = (() => {
      try {
        return new URL(url).host;
      } catch {
        return '';
      }
    })();
    const key = `[sportsApiPro] fetch:${host}`;
    if (shouldLog(key, 60_000)) {
      console.warn('[sportsApiPro] fetch error', url, String(e?.message || e));
    }
    return null;
  } finally {
    clearTimeout(t);
  }
}

function extractMarkets(payload: any): any[] {
  const direct = payload?.markets ?? payload?.data?.markets ?? null;
  if (Array.isArray(direct)) return direct;
  const odds = payload?.odds ?? payload?.data?.odds ?? null;
  if (Array.isArray(odds)) return odds;
  const provider = payload?.providerOdds ?? payload?.data?.providerOdds ?? null;
  if (Array.isArray(provider?.markets)) return provider.markets;
  return [];
}

function normalizeOutcomeName(x: any): string {
  return String(x ?? '').trim().toLowerCase();
}

function parseOdd(x: any): number {
  const n = typeof x === 'string' ? Number(x) : Number(x);
  return Number.isFinite(n) ? n : 0;
}

export async function fetchSportsApiProMatchOdds(
  apiKey: string,
  sport: string,
  matchId: string,
  opts?: { scope?: 'featured' | 'all'; provider?: number; homeTeam?: string; awayTeam?: string }
): Promise<{ home: number; draw: number; away: number; markets: Record<string, any[]> } | null> {
  const sub = toSubdomain(sport);
  const scope = opts?.scope ?? 'featured';
  const provider = opts?.provider ?? 1;
  const url = `https://v2.${sub}.sportsapipro.com/api/match/${encodeURIComponent(matchId)}/odds?scope=${encodeURIComponent(scope)}&provider=${encodeURIComponent(String(provider))}`;
  const json = await fetchJson(url, apiKey);
  if (!json) return null;

  const markets = extractMarkets(json);
  if (!markets.length) return null;

  let home = 0;
  let draw = 0;
  let away = 0;

  const homeName = normalizeOutcomeName(opts?.homeTeam);
  const awayName = normalizeOutcomeName(opts?.awayTeam);

  const h2h: any[] = [];

  for (const m of markets) {
    const mName = String(m?.name ?? m?.marketName ?? m?.key ?? '').toLowerCase();
    const outcomes = Array.isArray(m?.outcomes) ? m.outcomes : (Array.isArray(m?.selections) ? m.selections : []);
    if (!outcomes.length) continue;

    const isWinner =
      mName.includes('match winner') ||
      mName.includes('full time result') ||
      mName.includes('match result') ||
      mName.includes('1x2') ||
      mName === 'winner' ||
      mName === 'result';

    if (!isWinner) continue;

    for (const o of outcomes) {
      const rawName = o?.name ?? o?.label ?? o?.outcome ?? o?.value ?? '';
      const n = normalizeOutcomeName(rawName);
      const odd = parseOdd(o?.odd ?? o?.price ?? o?.value);
      if (!(odd > 1)) continue;

      if (n === '1' || n === 'home' || (homeName && (n === homeName || homeName.includes(n) || n.includes(homeName)))) home = home || odd;
      else if (n === '2' || n === 'away' || (awayName && (n === awayName || awayName.includes(n) || n.includes(awayName)))) away = away || odd;
      else if (n === 'x' || n === 'draw' || n === 'tie') draw = draw || odd;

      h2h.push({ value: rawName, odd });
    }
    break;
  }

  const outMarkets: Record<string, any[]> = {};
  if (h2h.length) outMarkets.h2h = h2h;

  if (!(home > 1) && !(away > 1) && !(draw > 1)) return null;
  return { home, draw, away, markets: outMarkets };
}

export async function fetchSportsApiProLive(apiKey: string, sport: string): Promise<NormalizedEvent[]> {
  const sub = toSubdomain(sport);
  const url = `https://v2.${sub}.sportsapipro.com/api/live`;
  const json = await fetchJson(url, apiKey);
  const items = extractEvents(json);
  const out: NormalizedEvent[] = [];
  for (const e of items) {
    const n = normalizeEvent(sport, e);
    if (n) out.push(n);
  }
  return out;
}

export async function fetchSportsApiProSchedule(apiKey: string, sport: string, date: string): Promise<NormalizedEvent[]> {
  const sub = toSubdomain(sport);
  const url = `https://v2.${sub}.sportsapipro.com/api/schedule/${encodeURIComponent(date)}`;
  const json = await fetchJson(url, apiKey);
  const items = extractEvents(json);
  const out: NormalizedEvent[] = [];
  for (const e of items) {
    const n = normalizeEvent(sport, e);
    if (n) out.push(n);
  }
  return out;
}
