import Stripe from 'stripe';

const DEFAULT_ODDS_BOOKMAKERS = 'Bet365,Betano,Superbet,Unibet,Betfair';
function toNumber(v: any): number {
  const n = typeof v === 'string' ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function oddsIoEventsArray(payload: any): any[] {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.data?.events)) return payload.data.events;
  if (Array.isArray(payload?.data?.response)) return payload.data.response;
  if (Array.isArray(payload?.events)) return payload.events;
  if (Array.isArray(payload?.response)) return payload.response;
  return [];
}

function toTeamName(v: any): string {
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object') {
    const name = (v as any).name ?? (v as any).team ?? (v as any).title ?? (v as any).label ?? '';
    return typeof name === 'string' ? name : '';
  }
  return '';
}

type CacheEntry = { exp: number; val: any };
const memCache = new Map<string, CacheEntry>();

let stripeClient: Stripe | null = null;

function getStripe(): Stripe {
  const key = String(process.env.STRIPE_SECRET_KEY || '').trim();
  if (!key) throw new Error('missing_stripe_secret_key');
  if (!stripeClient) stripeClient = new Stripe(key);
  return stripeClient;
}

function cacheGet<T>(key: string): T | null {
  const e = memCache.get(key);
  if (!e) return null;
  if (Date.now() > e.exp) {
    memCache.delete(key);
    return null;
  }
  return e.val as T;
}

function cacheSet(key: string, val: any, ttlMs: number) {
  const ttl = Math.max(0, ttlMs || 0);
  if (ttl === 0) return;
  memCache.set(key, { exp: Date.now() + ttl, val });
}

async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = cacheGet<T>(key);
  if (hit !== null) return hit;
  const val = await fn();
  if (val !== null && val !== undefined) cacheSet(key, val, ttlMs);
  return val;
}

const ALLOWED_SPORTS = new Set([
  'soccer',
  'football',
  'basketball',
  'nba',
  'baseball',
  'american-football',
  'handball',
  'ice-hockey',
  'mma',
  'mixed-martial-arts',
  'rugby',
  'tennis',
  'volleyball',
  'afl',
  'formula1',
]);

const BANNED_LEAGUE_TOKENS = [
  'serie c',
  'série c',
  'serie d',
  'série d',
  'club friendlies',
  'club friendlie',
  'friendly international',
  'international friendly',
  'olympics',
  'olimp',
  'womens',
  "women's",
  'women',
  'feminina',
  'feminino',
  'femin',
  'uefa futsal',
  'futsal euro',
  'futsal champions league',
  'u17',
  'u-17',
  'u 17',
  'u18',
  'u-18',
  'u 18',
  'u19',
  'u-19',
  'u 19',
  'u20',
  'u-20',
  'u 20',
  'u21',
  'u-21',
  'u 21',
  'u22',
  'u-22',
  'u 22',
  'u23',
  'u-23',
  'u 23',
  'sub-17',
  'sub 17',
  'sub17',
  'sub-19',
  'sub 19',
  'sub19',
  'sub-20',
  'sub 20',
  'sub20',
  'sub-21',
  'sub 21',
  'sub21',
  'sub-23',
  'sub 23',
  'sub23',
  'youth',
  'junior',
  'juniors',
  'juniores',
  'reserves',
  'reserve',
];

async function readBodyAsArrayBuffer(req: any): Promise<ArrayBuffer | undefined> {
  const m = String(req.method || 'GET').toUpperCase();
  if (m === 'GET' || m === 'HEAD') return undefined;
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve());
    req.on('error', (e: any) => reject(e));
  });
  const buf = Buffer.concat(chunks);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

async function proxyTo(req: any, res: any, targetUrl: string) {
  const body = await readBodyAsArrayBuffer(req);
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers || {})) {
    if (!v) continue;
    const key = String(k);
    const lk = key.toLowerCase();
    if (lk === 'host') continue;
    if (lk === 'content-length') continue;
    if (Array.isArray(v)) headers[key] = v.join(', ');
    else headers[key] = String(v);
  }

  const resp = await fetch(targetUrl, {
    method: String(req.method || 'GET'),
    headers,
    body,
  });

  res.statusCode = resp.status;
  resp.headers.forEach((value, key) => {
    const lk = key.toLowerCase();
    if (lk === 'transfer-encoding') return;
    if (lk === 'content-encoding') return;
    if (lk === 'content-length') return;
    res.setHeader(key, value);
  });

  const arr = new Uint8Array(await resp.arrayBuffer());
  res.end(Buffer.from(arr));
}

async function mediaProxyHandler(url: URL, req: any, res: any) {
  const raw = String(url.searchParams.get('url') || '').trim();
  if (!raw) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'missing_url' }));
    return;
  }
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'invalid_url' }));
    return;
  }

  const allowedHosts = new Set(['media.api-sports.io', 'flagcdn.com']);
  if (!allowedHosts.has(u.hostname)) {
    res.statusCode = 403;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'blocked_host' }));
    return;
  }

  try {
    const resp = await fetch(u.toString(), { signal: AbortSignal.timeout(12_000) });
    const ct = resp.headers.get('content-type') || '';
    const isImage = ct.toLowerCase().startsWith('image/');
    if (!resp.ok || !isImage) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400');
      res.end(
        `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#111827"/><path d="M18 40l8-10 7 8 6-7 7 9H18z" fill="#374151"/><circle cx="25" cy="25" r="4" fill="#4b5563"/></svg>`,
      );
      return;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', ct);
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400');
    const buf = new Uint8Array(await resp.arrayBuffer());
    res.end(Buffer.from(buf));
  } catch {
    res.statusCode = 502;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'media_fetch_failed' }));
  }
}

function extractOddsFromBets(bets: any[]): { home: number; draw: number; away: number } {
  const result = { home: 0, draw: 0, away: 0 };
  if (!Array.isArray(bets)) return result;

  for (const bet of bets) {
    const name: string = String(bet?.name || '');
    const values: any[] = bet?.values || bet?.odds || [];
    const n = name.toLowerCase();
    const isMatchWinner =
      name === 'Match Winner' ||
      name === 'Home/Away' ||
      name === '1X2' ||
      name === '1x2' ||
      name === 'Match Result' ||
      name === 'Result' ||
      name === 'Fulltime Result' ||
      name === 'Full Time Result' ||
      (n.includes('winner') && !n.includes('set') && !n.includes('period') && !n.includes('quarter') && !n.includes('half'));

    if (!isMatchWinner) continue;

    for (const v of values) {
      const val = String(v?.value || v?.outcome || '').toLowerCase();
      const odd = toNumber(v?.odd ?? v?.price ?? 0);
      if (odd <= 1) continue;

      if (val === 'home' || val === 'home win' || val === 'local' || val === '1') result.home = result.home || odd;
      else if (val === 'draw' || val === 'x' || val === 'tie') result.draw = result.draw || odd;
      else if (val === 'away' || val === 'away win' || val === 'visitor' || val === 'visitors' || val === '2') result.away = result.away || odd;
    }
  }

  return result;
}

async function apiGet(url: string, apiKey: string, timeoutMs: number) {
  const res = await fetch(url, {
    headers: { 'x-apisports-key': String(apiKey) },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) return null;
  return await res.json();
}

async function fetchSoccerLiveFixtures(apiKey: string): Promise<any[]> {
  const data = await apiGet('https://v3.football.api-sports.io/fixtures?live=all', apiKey, 10_000);
  return Array.isArray(data?.response) ? data.response : [];
}

async function fetchSoccerLiveOdds(apiKey: string): Promise<Map<string, { home: number; draw: number; away: number }>> {
  const map = new Map<string, { home: number; draw: number; away: number }>();
  const data = await apiGet('https://v3.football.api-sports.io/odds/live', apiKey, 10_000);
  const resp = Array.isArray(data?.response) ? data.response : [];
  for (const entry of resp) {
    const id = String(entry?.fixture?.id || '');
    if (!id) continue;
    const oddsArr: any[] = Array.isArray(entry?.odds) ? entry.odds : [];
    const parsed = extractOddsFromBets(oddsArr);
    if (parsed.home > 0) map.set(id, parsed);
  }
  return map;
}

async function fetchSoccerDayFixtures(apiKey: string, date: string): Promise<any[]> {
  const qp = new URLSearchParams();
  qp.set('date', date);
  const url = `https://v3.football.api-sports.io/fixtures?${qp.toString()}`;
  const data = await apiGet(url, apiKey, 12_000);
  return Array.isArray(data?.response) ? data.response : [];
}

async function fetchSoccerDayOdds(apiKey: string, date: string, maxPages: number): Promise<Map<string, { home: number; draw: number; away: number }>> {
  const map = new Map<string, { home: number; draw: number; away: number }>();
  for (let page = 1; page <= Math.max(1, maxPages); page++) {
    const qp = new URLSearchParams();
    qp.set('date', date);
    qp.set('page', String(page));
    const url = `https://v3.football.api-sports.io/odds?${qp.toString()}`;
    const data = await apiGet(url, apiKey, 15_000);
    const resp = Array.isArray(data?.response) ? data.response : [];
    if (resp.length === 0) break;
    for (const item of resp) {
      const fid = String(item?.fixture?.id || '');
      if (!fid || map.has(fid)) continue;
      const bookmakers = Array.isArray(item?.bookmakers) ? item.bookmakers : [];
      for (const bm of bookmakers) {
        const odds = extractOddsFromBets(bm?.bets || bm?.odds || []);
        if (odds.home > 1) {
          map.set(fid, odds);
          break;
        }
      }
    }
    if (resp.length < 10) break;
  }
  return map;
}

let oddsSportsCache: { updatedAt: number; list: Array<{ name: string; slug: string }> } | null = null;

function normKey(s: string): string {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

async function getOddsSportsList(): Promise<Array<{ name: string; slug: string }>> {
  const now = Date.now();
  if (oddsSportsCache && now - oddsSportsCache.updatedAt < 6 * 60 * 60 * 1000) return oddsSportsCache.list;
  const data = await fetch('https://api.odds-api.io/v3/sports', { signal: AbortSignal.timeout(12_000) })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  const list: Array<{ name: string; slug: string }> = [];
  if (Array.isArray(data)) {
    for (const item of data) {
      const name = item?.name ? String(item.name) : '';
      const slug = item?.slug ? String(item.slug) : '';
      if (name && slug) list.push({ name, slug });
    }
  }
  oddsSportsCache = { updatedAt: now, list };
  return list;
}

async function resolveOddsSportSlug(sport: string): Promise<string> {
  const raw = String(sport || '').trim();
  if (!raw) return '';
  const aliases: Record<string, string> = {
    soccer: 'football',
    football: 'football',
    nba: 'basketball',
    'ice-hockey': 'ice-hockey',
    hockey: 'ice-hockey',
    'american-football': 'american-football',
    nfl: 'american-football',
    mma: 'mma',
    ufc: 'mma',
    'mixed-martial-arts': 'mma',
    afl: 'afl',
    basketball: 'basketball',
    baseball: 'baseball',
    tennis: 'tennis',
    rugby: 'rugby',
    handball: 'handball',
    volleyball: 'volleyball',
  };
  const want = aliases[raw.toLowerCase()] || raw.toLowerCase();
  const wantKey = normKey(want);
  const list = await getOddsSportsList();
  if (list.length === 0) return want;
  const exact = list.find((s) => normKey(s.slug) === wantKey || normKey(s.name) === wantKey);
  if (exact) return exact.slug;
  const partial = list.find((s) => normKey(s.slug).includes(wantKey) || wantKey.includes(normKey(s.slug)) || normKey(s.name).includes(wantKey));
  if (partial) return partial.slug;
  return want;
}

type ApiSportsResource = 'fixtures' | 'games' | 'fights' | 'races';

const API_SPORTS_SOURCES: Record<string, { base: string; resource: ApiSportsResource }> = {
  soccer: { base: 'https://v3.football.api-sports.io', resource: 'fixtures' },
  basketball: { base: 'https://v1.basketball.api-sports.io', resource: 'games' },
  nba: { base: 'https://v1.basketball.api-sports.io', resource: 'games' },
  baseball: { base: 'https://v1.baseball.api-sports.io', resource: 'games' },
  handball: { base: 'https://v1.handball.api-sports.io', resource: 'games' },
  'ice-hockey': { base: 'https://v1.hockey.api-sports.io', resource: 'games' },
  'american-football': { base: 'https://v1.american-football.api-sports.io', resource: 'games' },
  rugby: { base: 'https://v1.rugby.api-sports.io', resource: 'games' },
  volleyball: { base: 'https://v1.volleyball.api-sports.io', resource: 'games' },
  afl: { base: 'https://v1.afl.api-sports.io', resource: 'games' },
  mma: { base: 'https://v1.mma.api-sports.io', resource: 'fights' },
  tennis: { base: 'https://v1.tennis.api-sports.io', resource: 'games' },
  formula1: { base: 'https://v1.formula-1.api-sports.io', resource: 'races' },
};

function pickSportKey(eventId: string): string {
  const s = String(eventId || '').trim();
  const m = s.match(/^([a-z-]+)_(\d+)$/i);
  return m?.[1] ? String(m[1]).toLowerCase() : '';
}

function apiSportsSource(sportKey: string) {
  return API_SPORTS_SOURCES[String(sportKey || '').toLowerCase()] || null;
}

async function apiSportsGetResource(source: { base: string; resource: ApiSportsResource }, apiKey: string, params: URLSearchParams, timeoutMs: number) {
  const u = `${source.base}/${source.resource}?${params.toString()}`;
  const data = await apiGet(u, apiKey, timeoutMs);
  return Array.isArray(data?.response) ? data.response : [];
}

async function fetchApiSportsLiveList(sportKey: string, apiKey: string): Promise<any[]> {
  const src = apiSportsSource(sportKey);
  if (!src || src.resource === 'fixtures') return [];
  const qp = new URLSearchParams();
  qp.set('live', 'all');
  return await apiSportsGetResource(src, apiKey, qp, 12_000).catch(() => []);
}

async function fetchApiSportsDateList(sportKey: string, apiKey: string, date: string): Promise<any[]> {
  const src = apiSportsSource(sportKey);
  if (!src || src.resource === 'fixtures') return [];
  const qp = new URLSearchParams();
  qp.set('date', date);
  return await apiSportsGetResource(src, apiKey, qp, 12_000).catch(() => []);
}

async function fetchApiSportsById(sportKey: string, apiKey: string, id: number): Promise<any | null> {
  const src = apiSportsSource(sportKey);
  if (!src || src.resource === 'fixtures') return null;
  const qp = new URLSearchParams();
  qp.set('id', String(id));
  const arr = await apiSportsGetResource(src, apiKey, qp, 12_000).catch(() => []);
  return Array.isArray(arr) && arr.length ? arr[0] : null;
}

function mapApiSportsGameToEvent(sportKey: string, g: any) {
  const idRaw = g?.id ?? g?.game?.id ?? g?.fixture?.id ?? null;
  const idNum = idRaw != null ? String(idRaw) : '';
  if (!idNum) return null;

  const leagueName = String(g?.league?.name || g?.league || '');
  const country = String(g?.country?.name || g?.league?.country || '');
  const date = String(g?.date || g?.game?.date || g?.time || g?.fixture?.date || '');
  const statusObj = g?.status || g?.game?.status || g?.fixture?.status || {};
  const statusShort = String(statusObj?.short || statusObj?.code || statusObj || '').trim() || 'NS';
  const statusLong = String(statusObj?.long || statusObj?.name || statusShort);

  const homeTeam = String(g?.teams?.home?.name || g?.home?.name || g?.participants?.home?.name || g?.teams?.[0]?.name || '');
  const awayTeam = String(g?.teams?.away?.name || g?.away?.name || g?.participants?.away?.name || g?.teams?.[1]?.name || '');
  if (!homeTeam || !awayTeam) return null;

  const homeLogo = String(g?.teams?.home?.logo || g?.home?.logo || g?.teams?.[0]?.logo || '');
  const awayLogo = String(g?.teams?.away?.logo || g?.away?.logo || g?.teams?.[1]?.logo || '');

  const homeScore =
    toNumber(
      g?.scores?.home?.total ??
      g?.scores?.home?.points ??
      g?.scores?.home?.score ??
      g?.scores?.home ??
      g?.score?.home ??
      g?.goals?.home ??
      g?.points?.home ??
      0,
    );
  const awayScore =
    toNumber(
      g?.scores?.away?.total ??
      g?.scores?.away?.points ??
      g?.scores?.away?.score ??
      g?.scores?.away ??
      g?.score?.away ??
      g?.goals?.away ??
      g?.points?.away ??
      0,
    );

  const elapsed =
    toNumber(statusObj?.elapsed ?? g?.time?.elapsed ?? 0);
  const timer =
    String(
      g?.time?.timer ??
      g?.time?.remaining ??
      statusObj?.timer ??
      statusObj?.time ??
      g?.timer ??
      '',
    ).trim();

  const liveStatus = new Set([
    '1H', '2H', 'HT', 'ET', 'P', 'LIVE',
    'Q1', 'Q2', 'Q3', 'Q4', 'OT', 'BT',
    'P1', 'P2', 'P3',
    'S1', 'S2', 'S3', 'S4', 'S5',
    'IN', 'IN1', 'IN2', 'IN3', 'IN4', 'IN5', 'IN6', 'IN7', 'IN8', 'IN9',
    'IN_PROGRESS',
  ]);
  const longLower = String(statusLong || '').toLowerCase();
  const isLive =
    liveStatus.has(statusShort) ||
    (!longLower.includes('not started') && /live|in[_ -]?play|in[_ -]?progress/.test(longLower));

  return {
    id: `${sportKey}_${idNum}`,
    external_event_id: `${sportKey}_${idNum}`,
    sport: sportKey,
    league: leagueName,
    country,
    home_team: homeTeam,
    away_team: awayTeam,
    match: `${homeTeam} vs ${awayTeam}`,
    event_date: date,
    date,
    is_live: isLive ? 1 : 0,
    status: { short: statusShort, long: statusLong, elapsed },
    elapsed,
    timer,
    goals: { home: homeScore, away: awayScore },
    score: { home: homeScore, away: awayScore },
    teams: {
      home: { name: homeTeam, logo: homeLogo },
      away: { name: awayTeam, logo: awayLogo },
    },
    home_team_logo: homeLogo,
    away_team_logo: awayLogo,
    home_odd: 0,
    draw_odd: 0,
    away_odd: 0,
  };
}

function mapApiSportsFightToEvent(g: any) {
  const idRaw = g?.id ?? g?.fight?.id ?? null;
  const idNum = idRaw != null ? String(idRaw) : '';
  if (!idNum) return null;

  const leagueName = String(g?.league?.name || g?.competition?.name || g?.league || g?.competition || '');
  const country = String(g?.country?.name || g?.country || '');
  const date = String(g?.date || g?.fight?.date || g?.time || '');
  const statusObj = g?.status || g?.fight?.status || {};
  const statusShort = String(statusObj?.short || statusObj?.code || statusObj || '').trim() || 'NS';
  const statusLong = String(statusObj?.long || statusObj?.name || statusShort);

  const fighters: any[] = Array.isArray(g?.fighters) ? g.fighters : [];
  const homeTeam = String(fighters?.[0]?.name || '');
  const awayTeam = String(fighters?.[1]?.name || '');
  if (!homeTeam || !awayTeam) return null;

  const homeLogo = String(fighters?.[0]?.photo || fighters?.[0]?.image || '');
  const awayLogo = String(fighters?.[1]?.photo || fighters?.[1]?.image || '');

  const longLower = String(statusLong || '').toLowerCase();
  const isLive = statusShort === 'LIVE' || (!longLower.includes('not started') && /live|in[_ -]?progress/.test(longLower));
  return {
    id: `mma_${idNum}`,
    external_event_id: `mma_${idNum}`,
    sport: 'mma',
    league: leagueName,
    country,
    home_team: homeTeam,
    away_team: awayTeam,
    match: `${homeTeam} vs ${awayTeam}`,
    event_date: date,
    date,
    is_live: isLive ? 1 : 0,
    status: { short: statusShort, long: statusLong, elapsed: 0 },
    elapsed: 0,
    goals: { home: 0, away: 0 },
    score: { home: 0, away: 0 },
    teams: {
      home: { name: homeTeam, logo: homeLogo },
      away: { name: awayTeam, logo: awayLogo },
    },
    home_team_logo: homeLogo,
    away_team_logo: awayLogo,
    home_odd: 0,
    draw_odd: 0,
    away_odd: 0,
  };
}

async function eventsBySportHandler(url: URL, req: any, res: any) {
  const sportsParam = String(url.searchParams.get('sports') || 'all').toLowerCase().trim();
  const includeOdds = String(url.searchParams.get('include') || '') === 'odds' || String(url.searchParams.get('includeOdds') || '') === '1';
  const leagueFilter = String(url.searchParams.get('league') || '').trim();
  const realtime = String(url.searchParams.get('realtime') || '') === '1';
  const apiKey = String(process.env.API_SPORTS_KEY || '').trim();
  if (!apiKey) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'missing_api_sports_key' }));
    return;
  }

  const wantSoccer = sportsParam === 'all' || sportsParam === 'soccer' || sportsParam === 'futebol' || sportsParam === 'football';
  const finishedShort = new Set([
    'FT', 'AET', 'PEN', 'AOT', 'AP', 'FINAL', 'FINISHED', 'ENDED', 'CANC', 'CAN', 'ABD', 'AWD', 'WO', 'PST', 'POSTPONED', 'TBD',
  ]);

  const now = new Date();
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  const isBlockedLeagueName = (leagueName: string) => {
    const ln = String(leagueName || '').toLowerCase();
    if (!ln) return false;
    if (BANNED_LEAGUE_TOKENS.some((t) => ln.includes(t))) return true;
    if (/\b(w)\b/.test(ln) && !ln.includes('world')) return true;
    return false;
  };

  const isLeagueAllowed = (leagueName: string) => {
    const ln = String(leagueName || '').toLowerCase();
    if (!ln) return false;
    if (isBlockedLeagueName(ln)) return false;
    return true;
  };

  const allowOverride = [
    'uefa euro',
    'uefa nations league',
    'uefa champions league',
    'uefa europa league',
    'uefa europa conference league',
    'copa do mundo',
    'world cup',
    'fifa intercontinental cup',
    'intercontinental cup',
    'libertadores',
    'sudamericana',
    'conmebol',
    'recopa',
    'supercopa',
    'copa',
  ];

  const soccerAllowedCountries = new Set([
    'alemanha',
    'argentina',
    'bélgica',
    'belgica',
    'brasil',
    'colômbia',
    'colombia',
    'dinamarca',
    'escócia',
    'escocia',
    'espanha',
    'eua',
    'usa',
    'frança',
    'franca',
    'grécia',
    'grecia',
    'inglaterra',
    'itália',
    'italia',
    'japão',
    'japao',
    'méxico',
    'mexico',
    'países baixos',
    'paises baixos',
    'holanda',
    'portugal',
    'suíça',
    'suica',
    'turquia',
    'uruguai',
    'mundo',
    'world',
  ]);

  const soccerAllowedLeagueTokens = [
    'bundesliga',
    '2. bundesliga',
    'dfb pokal',
    'liga profesional',
    'copa argentina',
    'primera nacional',
    'jupiler pro league',
    'belgian cup',
    'serie a',
    'serie b',
    'serie c',
    'serie d',
    'copa do brasil',
    'paulistao',
    'carioca',
    'primera a',
    'primera b',
    'copa colombia',
    'superliga',
    'danish cup',
    'premiership',
    'scottish cup',
    'championship',
    'la liga',
    'la liga 2',
    'copa del rey',
    'mls',
    'us open cup',
    'usl',
    'ligue 1',
    'ligue 2',
    'coupe de france',
    'super league 1',
    'greek cup',
    'premier league',
    'fa cup',
    'efl cup',
    'league one',
    'league two',
    'coppa italia',
    'j1 league',
    'j2 league',
    "emperor's cup",
    'liga mx',
    'copa mx',
    'expansion',
    'eredivisie',
    'eerste divisie',
    'knvb beker',
    'liga portugal',
    'liga portugal 2',
    'taça de portugal',
    'taca de portugal',
    'taça da liga',
    'taca da liga',
    'swiss cup',
    'challenge league',
    'turkish cup',
    '1. lig',
    'super lig',
    'süper lig',
    'primera división',
    'primera division',
    'world cup',
    'friendly',
    'club friendlies',
    'olympics',
    'saudi pro league',
    'arabia',
  ];

  const isAllowedSoccerCompetition = (country: string, leagueName: string) => {
    const ln = String(leagueName || '').toLowerCase();
    if (!ln) return false;
    if (allowOverride.some((t) => ln.includes(t))) return true;
    const cn = String(country || '').toLowerCase();
    if (!soccerAllowedCountries.has(cn)) return false;
    return soccerAllowedLeagueTokens.some((t) => ln.includes(t));
  };

  const allowedLeagueTokensBySport: Record<string, string[]> = {
    basketball: ['nba', 'ncaa', 'euroleague'],
    baseball: ['mlb'],
    'american-football': ['nfl', 'ncaa'],
    'ice-hockey': ['nhl', 'ahl', 'shl'],
    handball: ['lnh', 'asobal', 'bundesliga'],
    rugby: ['top 14', 'premiership', 'mlr'],
    volleyball: ['superliga', 'serie a1'],
    afl: ['afl'],
    mma: ['ufc', 'bellator'],
    formula1: ['formula 1', 'grand prix'],
    tennis: ['atp', 'wta', 'challenger'],
  };

  const isAllowedLeagueForSport = (sportKey: string, leagueName: string) => {
    const ln = String(leagueName || '').toLowerCase();
    if (!ln) return false;
    if (allowOverride.some((t) => ln.includes(t))) return true;
    const tokens = allowedLeagueTokensBySport[sportKey];
    if (!tokens || tokens.length === 0) return true;
    return tokens.some((t) => ln.includes(t));
  };

  const isBlockedLeague = (leagueName: string) => {
    const ln = String(leagueName || '').toLowerCase();
    if (!ln) return false;
    const allowHit = allowOverride.some((t) => ln.includes(t));
    if (allowHit) {
      const womenOrYouth = /women|womens|femin|u-?1[7-9]|u-?2[0-3]|sub-?\s?(1[7-9]|2[0-3])|youth|junior|reserve/.test(ln);
      return womenOrYouth;
    }
    return !isLeagueAllowed(ln);
  };

  async function fetchOddsIoFootballEvents(oddsKey: string) {
    const from = new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString();
    const to = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const key = `oddsio:events:football:${from.slice(0, 13)}:${to.slice(0, 13)}`;
    return await cached<any[]>(key, 60_000, async () => {
      const listUrl = `https://api.odds-api.io/v3/events?apiKey=${encodeURIComponent(oddsKey)}&sport=${encodeURIComponent('football')}&status=${encodeURIComponent('pending,live')}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=300`;
      const payload = await fetch(listUrl, { signal: AbortSignal.timeout(15000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      return oddsIoEventsArray(payload);
    });
  }

  function matchOddsIoEventId(meta: { home: string; away: string; kickoff: string }, oddsEvents: any[]) {
    const tgtMs = Date.parse(meta.kickoff);
    let best: { id: string; swapped: boolean; score: number } | null = null;
    for (const ev of oddsEvents) {
      const id = ev.id ?? ev.eventId ?? ev.event_id ?? null;
      const home = toTeamName(ev.home_team || ev.home || ev.homeTeam || ev.home_name || '');
      const away = toTeamName(ev.away_team || ev.away || ev.awayTeam || ev.away_name || '');
      const date = ev.commence_time || ev.date || ev.start_time || ev.scheduled || '';
      if (!id || !home || !away || !date) continue;
      const evMs = Date.parse(String(date || ''));
      if (Number.isFinite(tgtMs) && Number.isFinite(evMs)) {
        const diffMin = Math.abs(evMs - tgtMs) / 60000;
        if (diffMin > 6 * 60) continue;
      }
      const direct = teamsRoughMatch(meta.home, home) && teamsRoughMatch(meta.away, away);
      const swap = teamsRoughMatch(meta.home, away) && teamsRoughMatch(meta.away, home);
      if (!direct && !swap) continue;
      const score =
        (direct ? 2 : 1) * 50 +
        (Number.isFinite(tgtMs) && Number.isFinite(evMs) ? Math.max(0, 50 - Math.abs(evMs - tgtMs) / 60000) : 0);
      if (!best || score > best.score) best = { id: String(id), swapped: swap && !direct, score };
    }
    return best;
  }

  if (sportsParam !== 'all' && !wantSoccer && !ALLOWED_SPORTS.has(sportsParam)) {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=3600');
    res.end(JSON.stringify({ live: [], pregame: [] }));
    return;
  }

  const requestKey = `bySport:${sportsParam}:${includeOdds ? '1' : '0'}:${leagueFilter.toLowerCase()}:${realtime ? '1' : '0'}`;
  const cachedResp = cacheGet<{ live: any[]; pregame: any[] }>(requestKey);
  if (cachedResp) {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', realtime ? 'public, max-age=2, s-maxage=6, stale-while-revalidate=30' : 'public, max-age=10, s-maxage=30, stale-while-revalidate=300');
    res.end(JSON.stringify(cachedResp));
    return;
  }

  const LIVE_STATUSES = new Set([
    '1H', '2H', 'HT', 'ET', 'P', 'LIVE',
    'Q1', 'Q2', 'Q3', 'Q4', 'OT', 'BT',
    'P1', 'P2', 'P3',
    'S1', 'S2', 'S3', 'S4', 'S5',
    'IN', 'IN1', 'IN2', 'IN3', 'IN4', 'IN5', 'IN6', 'IN7', 'IN8', 'IN9',
    'IN_PROGRESS',
  ]);

  const MAX_LIVE = 100;
  const MAX_PREGAME = 40;

  const live: any[] = [];
  const pregame: any[] = [];
  const oddsKey = String(process.env.ODDS_API_KEY || '').trim();
  const oddsBooks = String(url.searchParams.get('bookmakers') || '').trim() || String(process.env.ODDS_API_BOOKMAKERS || DEFAULT_ODDS_BOOKMAKERS).trim();
  const allowOddsPrefetch = includeOdds && Boolean(oddsKey);
  let remainingOddsFetchSoccer = 0;
  let remainingOddsFetchOther = 0;
  if (allowOddsPrefetch) {
    if (sportsParam === 'all') {
      remainingOddsFetchSoccer = 40;
      remainingOddsFetchOther = 40;
    } else if (wantSoccer) {
      remainingOddsFetchSoccer = 40;
    } else {
      remainingOddsFetchOther = 40;
    }
  }

  if (wantSoccer) {
    const today = fmt(now);
    const tomorrow = fmt(new Date(now.getTime() + 24 * 60 * 60 * 1000));
    const fixturesKey = `soccer:fixtures:${today}:${tomorrow}`;
    const fixtures = await cached<any[]>(fixturesKey, realtime ? 6_000 : 30_000, async () => {
      const [liveFixtures, day1, day2] = await Promise.all([
        fetchSoccerLiveFixtures(apiKey).catch(() => []),
        fetchSoccerDayFixtures(apiKey, today).catch(() => []),
        fetchSoccerDayFixtures(apiKey, tomorrow).catch(() => []),
      ]);
      return [...liveFixtures, ...day1, ...day2];
    });
    const liveOddsMap = includeOdds ? await cached<Map<string, { home: number; draw: number; away: number }>>('soccer:liveOdds', 8_000, async () => fetchSoccerLiveOdds(apiKey).catch(() => new Map())) : new Map();
    const dayOddsMap = includeOdds ? await cached<Map<string, { home: number; draw: number; away: number }>>(`soccer:dayOdds:${today}`, 120_000, async () => fetchSoccerDayOdds(apiKey, today, 5).catch(() => new Map())) : new Map();
    const dayOddsMap2 = includeOdds ? await cached<Map<string, { home: number; draw: number; away: number }>>(`soccer:dayOdds:${tomorrow}`, 120_000, async () => fetchSoccerDayOdds(apiKey, tomorrow, 5).catch(() => new Map())) : new Map();

    const oddsIoEvents = allowOddsPrefetch ? await fetchOddsIoFootballEvents(oddsKey).catch(() => []) : [];
    const fixtureToOddsIo = new Map<string, { eventId: string; swapped: boolean }>();
    const oddsIoMetaByEventId = new Map<string, { homeTeam: string; awayTeam: string }>();
    if (oddsIoEvents.length) {
      const candidates = fixtures
        .map((f: any) => ({
          fid: String(f?.fixture?.id || ''),
          home: String(f?.teams?.home?.name || ''),
          away: String(f?.teams?.away?.name || ''),
          kickoff: String(f?.fixture?.date || ''),
          status: String(f?.fixture?.status?.short || '').trim() || 'NS',
          league: String(f?.league?.name || ''),
          country: String(f?.league?.country || ''),
        }))
        .filter((x) => x.fid && x.home && x.away && x.kickoff)
        .filter((x) => !finishedShort.has(String(x.status || '').toUpperCase()))
        .filter((x) => {
          if (sportsParam === 'all') {
            const st = String(x.status || '');
            if (!LIVE_STATUSES.has(st) && st !== 'NS') return false;
          }
          const ln = String(x.league || '').toLowerCase();
          if (isBlockedLeague(ln)) return false;
          if (leagueFilter && !ln.includes(leagueFilter.toLowerCase())) return false;
          if (!isAllowedSoccerCompetition(String(x.country || ''), String(x.league || ''))) return false;
          return true;
        })
        .slice(0, 140);
      for (const c of candidates) {
        const m = matchOddsIoEventId({ home: c.home, away: c.away, kickoff: c.kickoff }, oddsIoEvents);
        if (m?.id) {
          fixtureToOddsIo.set(c.fid, { eventId: m.id, swapped: m.swapped });
          oddsIoMetaByEventId.set(String(m.id), m.swapped ? { homeTeam: c.away, awayTeam: c.home } : { homeTeam: c.home, awayTeam: c.away });
        }
      }
    }

    const oddsIoByEventId = new Map<string, { home: number; draw: number; away: number; sources?: { home?: string; draw?: string; away?: string } }>();
    if (allowOddsPrefetch && fixtureToOddsIo.size > 0 && remainingOddsFetchSoccer > 0) {
      const ids = Array.from(new Set(Array.from(fixtureToOddsIo.values()).map((v) => v.eventId))).slice(0, Math.min(remainingOddsFetchSoccer, 40));
      for (const id of ids) {
        const raw = await cached(`oddsio:listOdds:${id}:${oddsBooks}`, 120_000, async () => fetchOddsApiIoOdds(id, oddsKey, oddsBooks));
        if (!raw) continue;
        const out = extractH2HFromOddsApiIo(raw, oddsIoMetaByEventId.get(id));
        if (out.home > 1) oddsIoByEventId.set(id, { home: out.home, draw: out.draw, away: out.away, sources: out.sources });
      }
      remainingOddsFetchSoccer = Math.max(0, remainingOddsFetchSoccer - ids.length);
    }

    for (const f of fixtures) {
      const fid = String(f?.fixture?.id || '');
      if (!fid) continue;
      const id = `soccer_${fid}`;
      const statusShort = String(f?.fixture?.status?.short || '').trim() || 'NS';
      if (finishedShort.has(statusShort.toUpperCase())) continue;
      const isLive = LIVE_STATUSES.has(statusShort);
      const eventDate = String(f?.fixture?.date || '');
      const leagueName = String(f?.league?.name || '');
      const ln = leagueName.toLowerCase();
      if (isBlockedLeague(ln)) continue;
      if (leagueFilter && !ln.includes(leagueFilter.toLowerCase())) continue;
      const country = String(f?.league?.country || '');
      if (!isAllowedSoccerCompetition(country, leagueName)) continue;
      const homeTeam = String(f?.teams?.home?.name || '');
      const awayTeam = String(f?.teams?.away?.name || '');
      if (!homeTeam || !awayTeam) continue;
      const homeLogo = String(f?.teams?.home?.logo || '');
      const awayLogo = String(f?.teams?.away?.logo || '');
      const goalsHome = toNumber(f?.goals?.home ?? 0);
      const goalsAway = toNumber(f?.goals?.away ?? 0);
      const elapsed = toNumber(f?.fixture?.status?.elapsed ?? 0);
  
      const odds =
        isLive ? liveOddsMap.get(fid) :
        (dayOddsMap.get(fid) || dayOddsMap2.get(fid) || null);
  
      let home_odd = odds ? odds.home : 0;
      let draw_odd = odds ? odds.draw : 0;
      let away_odd = odds ? odds.away : 0;
      let home_odd_bookmaker = '';
      let draw_odd_bookmaker = '';
      let away_odd_bookmaker = '';
      const oi = fixtureToOddsIo.get(fid);
      if (includeOdds && oi && oddsIoByEventId.has(oi.eventId)) {
        const o = oddsIoByEventId.get(oi.eventId)!;
        home_odd = oi.swapped ? o.away : o.home;
        draw_odd = o.draw;
        away_odd = oi.swapped ? o.home : o.away;
        home_odd_bookmaker = oi.swapped ? String(o.sources?.away || '') : String(o.sources?.home || '');
        draw_odd_bookmaker = String(o.sources?.draw || '');
        away_odd_bookmaker = oi.swapped ? String(o.sources?.home || '') : String(o.sources?.away || '');
      }
  
      const ev = {
        id,
        external_event_id: id,
        sport: 'soccer',
        league: leagueName,
        country,
        home_team: homeTeam,
        away_team: awayTeam,
        match: `${homeTeam} vs ${awayTeam}`,
        event_date: eventDate,
        date: eventDate,
        is_live: isLive ? 1 : 0,
        status: { short: statusShort, long: statusShort, elapsed },
        elapsed,
        goals: { home: goalsHome, away: goalsAway },
        score: { home: goalsHome, away: goalsAway },
        home_odd,
        draw_odd,
        away_odd,
        home_odd_bookmaker,
        draw_odd_bookmaker,
        away_odd_bookmaker,
        teams: {
          home: { name: homeTeam, logo: homeLogo },
          away: { name: awayTeam, logo: awayLogo },
        },
        home_team_logo: homeLogo,
        away_team_logo: awayLogo,
      };
  
      if (isLive) live.push(ev);
      else pregame.push(ev);
    }
  }

  const normalizeSportParam = (s: string) => {
    const v = String(s || '').toLowerCase().trim();
    if (v === 'football') return 'soccer';
    if (v === 'hockey') return 'ice-hockey';
    if (v === 'american' || v === 'nfl') return 'american-football';
    if (v === 'ufc') return 'mma';
    if (v === 'formula-1' || v === 'f1') return 'formula1';
    return v;
  };

  const wantedNonSoccer =
    sportsParam === 'all'
      ? ['basketball', 'nba', 'baseball', 'handball', 'ice-hockey', 'american-football', 'rugby', 'volleyball', 'afl', 'mma']
      : [normalizeSportParam(sportsParam)];

  for (const sportKey of wantedNonSoccer) {
    if (!sportKey || sportKey === 'soccer') continue;
    if (!ALLOWED_SPORTS.has(sportKey)) continue;
    const src = apiSportsSource(sportKey);
    if (!src || (src.resource !== 'games' && src.resource !== 'fights')) continue;

    const today = fmt(now);
    const tomorrow = fmt(new Date(now.getTime() + 24 * 60 * 60 * 1000));
    const cacheKey = `games:${sportKey}:${today}:${tomorrow}`;
    const games = await cached<any[]>(cacheKey, realtime ? 6_000 : 30_000, async () => {
      const [liveList, day1, day2] = await Promise.all([
        fetchApiSportsLiveList(sportKey, apiKey).catch(() => []),
        fetchApiSportsDateList(sportKey, apiKey, today).catch(() => []),
        fetchApiSportsDateList(sportKey, apiKey, tomorrow).catch(() => []),
      ]);
      return [...liveList, ...day1, ...day2];
    });

    const mapped = games
      .map((g) => (src.resource === 'fights' ? mapApiSportsFightToEvent(g) : mapApiSportsGameToEvent(sportKey, g)))
      .filter(Boolean) as any[];

    const filtered = mapped.filter((ev) => {
      const leagueName = String(ev?.league || '');
      const ln = leagueName.toLowerCase();
      if (sportKey === 'nba' && !ln.includes('nba')) return false;
      const st = String(ev?.status?.short || ev?.status || '').toUpperCase().trim();
      if (finishedShort.has(st)) return false;
      if (isBlockedLeague(ln)) return false;
      if (leagueFilter && !ln.includes(leagueFilter.toLowerCase())) return false;
      return true;
    });

    if (remainingOddsFetchOther > 0 && allowOddsPrefetch && src.resource !== 'fights') {
      const oddsSport = await resolveOddsSportSlug(sportKey);
      const fromIso = new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString();
      const toIso = new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString();
      const oddsEvents = await cached<any[]>(
        `oddsio:events:${oddsSport}:${fromIso.slice(0, 13)}:${toIso.slice(0, 13)}`,
        60_000,
        async () => {
          const listUrl = `https://api.odds-api.io/v3/events?apiKey=${encodeURIComponent(oddsKey)}&sport=${encodeURIComponent(oddsSport)}&status=${encodeURIComponent('pending,live')}&from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}&limit=300`;
          const payload = await fetch(listUrl, { signal: AbortSignal.timeout(15000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
          return oddsIoEventsArray(payload);
        },
      ).catch(() => []);

      const eventToOddsIo = new Map<string, { eventId: string; swapped: boolean }>();
      const oddsIoMetaByEventId = new Map<string, { homeTeam: string; awayTeam: string }>();
      const oddsTargets = filtered;
      if (oddsEvents.length) {
        for (const ev of oddsTargets.slice(0, 120)) {
          const m = matchOddsIoEventId({ home: ev.home_team, away: ev.away_team, kickoff: ev.event_date }, oddsEvents);
          if (m?.id) {
            eventToOddsIo.set(ev.id, { eventId: m.id, swapped: m.swapped });
            oddsIoMetaByEventId.set(String(m.id), m.swapped ? { homeTeam: ev.away_team, awayTeam: ev.home_team } : { homeTeam: ev.home_team, awayTeam: ev.away_team });
          }
        }
      }

      const oddsById = new Map<string, { home: number; draw: number; away: number; sources?: { home?: string; draw?: string; away?: string } }>();
      const ids = Array.from(new Set(Array.from(eventToOddsIo.values()).map((v) => v.eventId))).slice(0, remainingOddsFetchOther);
      for (const id of ids) {
        const raw = await cached(`oddsio:listOdds:${id}:${oddsBooks}`, 120_000, async () => fetchOddsApiIoOdds(id, oddsKey, oddsBooks)).catch(() => null);
        if (!raw) continue;
        const out = extractH2HFromOddsApiIo(raw, oddsIoMetaByEventId.get(id));
        if (out.home > 1 || out.away > 1) oddsById.set(id, { home: out.home, draw: out.draw, away: out.away, sources: out.sources });
      }
      remainingOddsFetchOther = Math.max(0, remainingOddsFetchOther - ids.length);

      for (const ev of filtered) {
        const map = eventToOddsIo.get(ev.id);
        if (!map) continue;
        const o = oddsById.get(map.eventId);
        if (!o) continue;
        ev.home_odd = map.swapped ? o.away : o.home;
        ev.draw_odd = o.draw;
        ev.away_odd = map.swapped ? o.home : o.away;
        (ev as any).home_odd_bookmaker = map.swapped ? String(o.sources?.away || '') : String(o.sources?.home || '');
        (ev as any).draw_odd_bookmaker = String(o.sources?.draw || '');
        (ev as any).away_odd_bookmaker = map.swapped ? String(o.sources?.home || '') : String(o.sources?.away || '');
      }
    }

    if (includeOdds && src.resource !== 'fights') {
      const needs = filtered.filter((ev) => !(Number(ev?.home_odd || 0) > 1 || Number(ev?.away_odd || 0) > 1 || Number(ev?.draw_odd || 0) > 1)).slice(0, realtime ? 18 : 10);
      if (needs.length > 0) {
        const outArr = await Promise.all(needs.map(async (ev) => {
          const gid = pickFixtureId(String(ev.id || ''));
          if (!(gid > 0)) return null;
          const raw = await cached(`apisports:odds:${sportKey}:${gid}`, realtime ? 6000 : 30_000, async () => fetchApiSportsGameOdds(sportKey, gid, apiKey));
          if (!raw) return null;
          const meta = await cached(
            `eventMeta:${sportKey}:${gid}`,
            10 * 60_000,
            async () => fetchGameMetaFromApiSports(sportKey, gid, apiKey).catch(() => null),
          ).catch(() => null);
          const out = extractOddsFromApiSports(raw, meta ? { homeTeam: meta.home, awayTeam: meta.away } : undefined);
          return { id: String(ev.id || ''), home: out.home, draw: out.draw, away: out.away };
        }));
        const byId = new Map(outArr.filter(Boolean).map((x: any) => [x.id, x]));
        for (const ev of filtered) {
          const hit = byId.get(String(ev.id || ''));
          if (!hit) continue;
          ev.home_odd = hit.home;
          ev.draw_odd = hit.draw;
          ev.away_odd = hit.away;
        }
      }
    }

    for (const ev of filtered) {
      if (Number(ev.is_live) === 1) live.push(ev);
      else pregame.push(ev);
    }
  }

  const hasAnyOdds = (ev: any) => Number(ev?.home_odd || 0) > 1 || Number(ev?.away_odd || 0) > 1 || Number(ev?.draw_odd || 0) > 1;

  const dedupById = (arr: any[]) => {
    const by = new Map<string, any>();
    for (const ev of arr) {
      const id = String(ev?.id || '');
      if (!id) continue;
      const prev = by.get(id);
      if (!prev) { by.set(id, ev); continue; }
      const prevScore = Number(hasAnyOdds(prev)) * 10 + (Number(prev?.is_live || 0) === 1 ? 1 : 0);
      const curScore = Number(hasAnyOdds(ev)) * 10 + (Number(ev?.is_live || 0) === 1 ? 1 : 0);
      if (curScore > prevScore) by.set(id, ev);
    }
    return Array.from(by.values());
  };

  const liveDedup = dedupById(live);
  const preDedup = dedupById(pregame);

  liveDedup.sort((a, b) => (Number(hasAnyOdds(b)) - Number(hasAnyOdds(a))) || (toNumber(b.elapsed || 0) - toNumber(a.elapsed || 0)));
  preDedup.sort((a, b) => (Number(hasAnyOdds(b)) - Number(hasAnyOdds(a))) || (Date.parse(String(a.event_date || a.date || '')) - Date.parse(String(b.event_date || b.date || ''))));

  const sportOf = (ev: any) => {
    const s = String(ev?.sport || '').toLowerCase().trim();
    if (s) return s;
    const id = String(ev?.id || '');
    const m = id.match(/^([a-z-]+)_/i);
    return String(m?.[1] || '').toLowerCase();
  };

  const mixBySport = (arr: any[], max: number) => {
    const groups = new Map<string, any[]>();
    for (const ev of arr) {
      const s = sportOf(ev) || 'other';
      if (!groups.has(s)) groups.set(s, []);
      groups.get(s)!.push(ev);
    }
    const order = ['soccer', 'basketball', 'nba', 'tennis', 'ice-hockey', 'american-football', 'baseball', 'handball', 'volleyball', 'afl', 'mma', 'rugby', 'formula1'];
    const sports = [
      ...order.filter((s) => groups.has(s)),
      ...Array.from(groups.keys()).filter((s) => !order.includes(s)),
    ];
    const out: any[] = [];
    let progressed = true;
    while (out.length < max && progressed) {
      progressed = false;
      for (const s of sports) {
        const g = groups.get(s);
        if (!g || g.length === 0) continue;
        out.push(g.shift());
        progressed = true;
        if (out.length >= max) break;
      }
    }
    return out;
  };

  const liveWithOdds = liveDedup.filter(hasAnyOdds);
  const preWithOdds = preDedup.filter(hasAnyOdds);
  const liveCandidates = includeOdds ? (liveWithOdds.length > 0 ? liveWithOdds : liveDedup) : liveDedup;
  let preCandidates = includeOdds ? preWithOdds : preDedup;
  if (includeOdds && preWithOdds.length < Math.min(20, MAX_PREGAME)) {
    const filler = preDedup.filter((e) => !hasAnyOdds(e));
    preCandidates = [...preWithOdds, ...filler].slice(0, MAX_PREGAME);
  }
  let liveLimited = sportsParam === 'all'
    ? mixBySport(liveCandidates, MAX_LIVE)
    : liveCandidates.slice(0, MAX_LIVE);
  if (includeOdds && liveWithOdds.length < Math.min(12, MAX_LIVE)) {
    const filler = liveDedup.filter((e) => !hasAnyOdds(e));
    const merged = [...liveWithOdds, ...filler].slice(0, MAX_LIVE);
    liveLimited = sportsParam === 'all' ? mixBySport(merged, MAX_LIVE) : merged;
  }
  const selectByQuota = (arr: any[], quotas: Record<string, number>, total: number) => {
    const bySport = new Map<string, any[]>();
    for (const ev of arr) {
      const s = sportOf(ev) || 'other';
      if (!bySport.has(s)) bySport.set(s, []);
      bySport.get(s)!.push(ev);
    }
    const out: any[] = [];
    // Primary pass by quota
    for (const [sport, q] of Object.entries(quotas)) {
      const list = bySport.get(sport) || [];
      const n = Math.min(q, list.length);
      out.push(...list.splice(0, n));
      bySport.set(sport, list);
    }
    // Fill remainder with soccer first, then remaining sports round-robin
    const remaining = total - out.length;
    if (remaining > 0) {
      const order = ['soccer', ...Array.from(bySport.keys()).filter((k) => k !== 'soccer')];
      let i = 0;
      while (out.length < total && i < 5000) {
        i++;
        let progressed = false;
        for (const s of order) {
          const list = bySport.get(s) || [];
          if (list.length === 0) continue;
          out.push(list.shift());
          progressed = true;
          if (out.length >= total) break;
        }
        if (!progressed) break;
      }
    }
    return out.slice(0, total);
  };
  const quotas40 = { soccer: 20, basketball: 8, 'ice-hockey': 5, baseball: 4, volleyball: 3 };
  const pregameLimited = sportsParam === 'all'
    ? selectByQuota(preCandidates, quotas40, MAX_PREGAME)
    : preCandidates.slice(0, MAX_PREGAME);

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const payload = { live: liveLimited, pregame: pregameLimited };
  cacheSet(requestKey, payload, realtime ? 6_000 : 30_000);
  res.setHeader('Cache-Control', realtime ? 'public, max-age=2, s-maxage=6, stale-while-revalidate=30' : 'public, max-age=10, s-maxage=30, stale-while-revalidate=300');
  res.end(JSON.stringify(payload));
}

async function liveStreamHandler(req: any, res: any) {
  const url = new URL(String(req.url || ''), 'http://localhost');
  const sportsParam = String(url.searchParams.get('sports') || 'all').toLowerCase().trim();

  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  try { res.flushHeaders?.(); } catch { void 0; }

  const send = (obj: any) => {
    try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch { void 0; }
  };

  const apiKey = String(process.env.API_SPORTS_KEY || '').trim();
  if (!apiKey) {
    send({ type: 'error', error: 'missing_api_sports_key', ts: Date.now() });
    res.end();
    return;
  }
  const oddsKey = String(process.env.ODDS_API_KEY || '').trim();
  const oddsBooks = String(new URL(String(req.url || ''), 'http://localhost').searchParams.get('bookmakers') || '').trim()
    || String(process.env.ODDS_API_BOOKMAKERS || DEFAULT_ODDS_BOOKMAKERS).trim();
  const normalizeSportParam = (s: string) => {
    const v = String(s || '').toLowerCase().trim();
    if (v === 'football' || v === 'futebol') return 'soccer';
    if (v === 'hockey') return 'ice-hockey';
    if (v === 'nfl') return 'american-football';
    if (v === 'ufc') return 'mma';
    if (v === 'formula-1' || v === 'f1') return 'formula1';
    return v;
  };
  const sportKey = normalizeSportParam(sportsParam);
  const selected = sportKey === 'all'
    ? ['soccer', 'basketball', 'nba', 'baseball', 'handball', 'ice-hockey', 'american-football', 'rugby', 'volleyball', 'afl', 'mma']
    : [sportKey];
  const active = selected.filter((s) => {
    if (s === 'soccer') return true;
    if (!ALLOWED_SPORTS.has(s)) return false;
    const r = apiSportsSource(s)?.resource;
    return r === 'games' || r === 'fights';
  });
  if (active.length === 0) {
    send({ type: 'error', error: 'sport_not_supported', ts: Date.now() });
    res.end();
    return;
  }

  let closed = false;
  req.on('close', () => { closed = true; });
  req.on('aborted', () => { closed = true; });

  send({ type: 'hello', sports: sportsParam, ts: Date.now() });

  let lastHash = '';
  const startedAt = Date.now();
  const maxMs = 55_000;

  while (!closed && Date.now() - startedAt < maxMs) {
    try {
      const updates: any[] = [];
      let remainingOdds = oddsKey ? 18 : 0;
      for (const s of active) {
        if (s === 'soccer') {
          const fixtures = await cached<any[]>('sse:soccer:liveFixtures', 2000, async () => fetchSoccerLiveFixtures(apiKey));
          const oddsMap = await cached<Map<string, { home: number; draw: number; away: number }>>(
            'sse:soccer:liveOdds',
            5000,
            async () => fetchSoccerLiveOdds(apiKey).catch(() => new Map()),
          );
          for (const f of fixtures) {
            const fid = String(f?.fixture?.id || '');
            if (!fid) continue;
            const id = `soccer_${fid}`;
            const goalsHome = toNumber(f?.goals?.home ?? f?.score?.fulltime?.home ?? 0);
            const goalsAway = toNumber(f?.goals?.away ?? f?.score?.fulltime?.away ?? 0);
            const statusShort = String(f?.fixture?.status?.short || f?.fixture?.status || 'LIVE').trim();
            const elapsed = toNumber(f?.fixture?.status?.elapsed ?? f?.elapsed ?? 0);
            const timer = String(f?.fixture?.status?.timer || '').trim();
            const odds = oddsMap.get(fid);
            updates.push({
              id,
              external_event_id: id,
              sport: 'soccer',
              is_live: 1,
              status: { short: statusShort, long: statusShort, elapsed },
              elapsed,
              timer,
              goals: { home: goalsHome, away: goalsAway },
              score: { home: goalsHome, away: goalsAway },
              home_odd: odds ? odds.home : 0,
              draw_odd: odds ? odds.draw : 0,
              away_odd: odds ? odds.away : 0,
              updated_at: new Date().toISOString(),
            });
          }
          continue;
        }

        const list = await cached<any[]>(`sse:${s}:live`, 2500, async () => fetchApiSportsLiveList(s, apiKey).catch(() => []));
        const local: any[] = [];
        for (const g of list) {
          const ev = apiSportsSource(s)?.resource === 'fights' ? mapApiSportsFightToEvent(g) : mapApiSportsGameToEvent(s, g);
          if (!ev) continue;
          if (s === 'nba' && !String(ev.league || '').toLowerCase().includes('nba')) continue;
          if (Number(ev.is_live || 0) !== 1) continue;
          local.push(ev);
        }

        if (oddsKey && remainingOdds > 0 && apiSportsSource(s)?.resource !== 'fights' && local.length > 0) {
          const oddsSport = await resolveOddsSportSlug(s);
          const fromIso = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
          const toIso = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
          const oddsEvents = await cached<any[]>(
            `sse:oddsio:events:${oddsSport}:${fromIso.slice(0, 13)}:${toIso.slice(0, 13)}`,
            60_000,
            async () => {
              const listUrl = `https://api.odds-api.io/v3/events?apiKey=${encodeURIComponent(oddsKey)}&sport=${encodeURIComponent(oddsSport)}&status=${encodeURIComponent('pending,live')}&from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}&limit=300`;
              const payload = await fetch(listUrl, { signal: AbortSignal.timeout(15000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
              return oddsIoEventsArray(payload);
            },
          ).catch(() => []);

          const mapToOddsIo = new Map<string, { eventId: string; swapped: boolean }>();
          if (oddsEvents.length) {
            for (const ev of local.slice(0, 30)) {
              const m = matchOddsIoEventId({ home: ev.home_team, away: ev.away_team, kickoff: ev.event_date }, oddsEvents);
              if (m?.id) mapToOddsIo.set(ev.id, { eventId: m.id, swapped: m.swapped });
            }
          }
          const ids = Array.from(new Set(Array.from(mapToOddsIo.values()).map((v) => v.eventId))).slice(0, remainingOdds);
          const oddsById = new Map<string, { home: number; draw: number; away: number; sources?: { home?: string; draw?: string; away?: string } }>();
          for (const oid of ids) {
            const raw = await cached(
              `sse:oddsio:odds:${oid}:${oddsBooks}`,
              8000,
              async () => fetchOddsApiIoOdds(oid, oddsKey, oddsBooks),
            ).catch(() => null);
            if (!raw) continue;
            const out = extractH2HFromOddsApiIo(raw);
            if (out.home > 1 || out.away > 1 || out.draw > 1) oddsById.set(oid, { home: out.home, draw: out.draw, away: out.away, sources: out.sources });
          }
          remainingOdds = Math.max(0, remainingOdds - ids.length);
          for (const ev of local) {
            const oi = mapToOddsIo.get(ev.id);
            if (!oi) continue;
            const o = oddsById.get(oi.eventId);
            if (!o) continue;
            ev.home_odd = oi.swapped ? o.away : o.home;
            ev.draw_odd = o.draw;
            ev.away_odd = oi.swapped ? o.home : o.away;
            (ev as any).home_odd_bookmaker = oi.swapped ? String(o.sources?.away || '') : String(o.sources?.home || '');
            (ev as any).draw_odd_bookmaker = String(o.sources?.draw || '');
            (ev as any).away_odd_bookmaker = oi.swapped ? String(o.sources?.home || '') : String(o.sources?.away || '');
          }
        }

        if (apiSportsSource(s)?.resource !== 'fights' && local.length > 0) {
          const missing = local.filter((ev) => !(Number(ev?.home_odd || 0) > 1 || Number(ev?.away_odd || 0) > 1 || Number(ev?.draw_odd || 0) > 1)).slice(0, 10);
          if (missing.length > 0) {
            const filled = await Promise.all(missing.map(async (ev) => {
              const gid = pickFixtureId(String(ev.id || ''));
              if (!(gid > 0)) return null;
              const raw = await cached(`sse:apisports:odds:${s}:${gid}`, 5000, async () => fetchApiSportsGameOdds(s, gid, apiKey));
              if (!raw) return null;
              const meta = await cached(
                `eventMeta:${s}:${gid}`,
                10 * 60_000,
                async () => fetchGameMetaFromApiSports(s, gid, apiKey).catch(() => null),
              ).catch(() => null);
              const out = extractOddsFromApiSports(raw, meta ? { homeTeam: meta.home, awayTeam: meta.away } : undefined);
              return { id: String(ev.id || ''), home: out.home, draw: out.draw, away: out.away };
            }));
            const byId = new Map(filled.filter(Boolean).map((x: any) => [x.id, x]));
            for (const ev of local) {
              const hit = byId.get(String(ev.id || ''));
              if (!hit) continue;
              ev.home_odd = hit.home;
              ev.draw_odd = hit.draw;
              ev.away_odd = hit.away;
            }
          }
        }

        for (const ev of local) {
          updates.push({
            id: ev.id,
            external_event_id: ev.id,
            sport: s,
            is_live: 1,
            status: ev.status,
            elapsed: ev.elapsed,
            timer: (ev as any).timer || '',
            goals: ev.goals,
            score: ev.score,
            home_odd: ev.home_odd || 0,
            draw_odd: ev.draw_odd || 0,
            away_odd: ev.away_odd || 0,
            home_odd_bookmaker: (ev as any).home_odd_bookmaker || '',
            draw_odd_bookmaker: (ev as any).draw_odd_bookmaker || '',
            away_odd_bookmaker: (ev as any).away_odd_bookmaker || '',
            updated_at: new Date().toISOString(),
          });
        }
      }

      const capped = updates.slice(0, 100);
      const hash = JSON.stringify(capped.map((u) => [u.id, u.goals?.home, u.goals?.away, u.elapsed, u.timer, u.home_odd, u.draw_odd, u.away_odd]).slice(0, 120));
      if (hash !== lastHash) {
        lastHash = hash;
        send({ type: 'live', updates: capped, ts: Date.now() });
      } else {
        send({ type: 'ping', ts: Date.now() });
      }
    } catch {
      send({ type: 'ping', ts: Date.now() });
    }

    await new Promise((r) => setTimeout(r, 2000));
  }

  send({ type: 'bye', ts: Date.now() });
  res.end();
}

function pickFixtureId(eventId: string): number {
  const s = String(eventId || '').trim();
  if (!s) return 0;
  const m = s.match(/_(\d+)$/);
  if (m?.[1]) return Number(m[1]) || 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function pickOddsIoEventId(eventId: string): string {
  const s = String(eventId || '').trim();
  if (!s) return '';
  const idx = s.toLowerCase().lastIndexOf('oddsio_');
  if (idx < 0) return '';
  return s.slice(idx + 'oddsio_'.length).trim();
}

function normalizeMarketKey(name: string): 'h2h' | 'other' {
  const s = String(name || '').toLowerCase();
  if (s.includes('match winner') || s.includes('full time result') || s.includes('1x2') || s.includes('home/away')) return 'h2h';
  return 'other';
}

function normalizeH2HLabel(label: string): 'home' | 'draw' | 'away' | 'other' {
  const s = String(label || '').toLowerCase().trim();
  if (s === 'home' || s === '1' || s === 'casa') return 'home';
  if (s === 'draw' || s === 'x' || s === 'empate') return 'draw';
  if (s === 'away' || s === '2' || s === 'fora') return 'away';
  return 'other';
}

async function fetchApiSportsOdds(fixtureId: number, apiKey: string): Promise<any | null> {
  const qp = new URLSearchParams();
  qp.set('fixture', String(fixtureId));
  const url = `https://v3.football.api-sports.io/odds?${qp.toString()}`;
  const res = await fetch(url, {
    headers: { 'x-apisports-key': String(apiKey) },
    signal: AbortSignal.timeout(9000),
  });
  if (!res.ok) return null;
  return await res.json();
}

function extractH2HFromApiSports(payload: any): { home: number; draw: number; away: number; markets: Record<string, any[]> } {
  const response = Array.isArray(payload?.response) ? payload.response : [];
  const best = new Map<'home' | 'draw' | 'away', number>();

  for (const item of response) {
    const bookmakers = Array.isArray(item?.bookmakers) ? item.bookmakers : [];
    for (const bm of bookmakers) {
      const bets = Array.isArray(bm?.bets) ? bm.bets : [];
      for (const bet of bets) {
        if (normalizeMarketKey(bet?.name || bet?.id) !== 'h2h') continue;
        const values = Array.isArray(bet?.values) ? bet.values : [];
        for (const v of values) {
          const lbl = normalizeH2HLabel(v?.value ?? v?.label ?? v?.name ?? '');
          if (lbl === 'other') continue;
          const odd = toNumber(v?.odd ?? v?.price ?? 0);
          if (!(odd > 1)) continue;
          const prev = best.get(lbl);
          if (!prev || odd > prev) best.set(lbl, odd);
        }
      }
    }
  }

  const home = best.get('home') || 0;
  const draw = best.get('draw') || 0;
  const away = best.get('away') || 0;
  const h2h: any[] = [];
  if (home > 1) h2h.push({ name: 'Casa', label: 'Casa', odd: home, price: home });
  if (draw > 1) h2h.push({ name: 'Empate', label: 'Empate', odd: draw, price: draw });
  if (away > 1) h2h.push({ name: 'Fora', label: 'Fora', odd: away, price: away });
  const markets: Record<string, any[]> = {};
  if (h2h.length >= 2) markets.h2h = h2h;
  return { home, draw, away, markets };
}

function extractOddsFromApiSports(
  payload: any,
  meta?: { homeTeam?: string; awayTeam?: string },
): { home: number; draw: number; away: number; markets: Record<string, any[]> } {
  const response = Array.isArray(payload?.response) ? payload.response : [];
  const bestH2H = new Map<'home' | 'draw' | 'away', number>();
  const byMarket = new Map<string, Map<string, { label: string; odd: number; handicap?: string }>>();

  const put = (marketKey: string, label: string, odd: number, handicap?: string) => {
    if (!(odd > 1)) return;
    const mk = String(marketKey || '').trim();
    const lbl = String(label || '').trim();
    if (!mk || !lbl) return;
    if (!byMarket.has(mk)) byMarket.set(mk, new Map());
    const m = byMarket.get(mk)!;
    const k = `${lbl.toLowerCase()}|${String(handicap || '')}`;
    const prev = m.get(k);
    if (!prev || odd > prev.odd) m.set(k, { label: lbl, odd, handicap });
  };

  const resolveSide = (value: string): 'home' | 'draw' | 'away' | 'other' => {
    const base = normalizeH2HLabel(value);
    if (base !== 'other') return base;
    const v = String(value || '').toLowerCase().trim();
    if (v === 'home' || v === 'home team') return 'home';
    if (v === 'away' || v === 'away team') return 'away';
    const home = normTeamName(String(meta?.homeTeam || ''));
    const away = normTeamName(String(meta?.awayTeam || ''));
    const val = normTeamName(value);
    if (home && val && (home === val || home.includes(val) || val.includes(home))) return 'home';
    if (away && val && (away === val || away.includes(val) || val.includes(away))) return 'away';
    return 'other';
  };

  const marketKey = (name: string) => {
    const n = String(name || '').toLowerCase();
    if (n.includes('match winner') || n.includes('full time result') || n.includes('1x2') || n.includes('ft_1x2')) return 'h2h';
    if (n === 'winner' || n.includes('winner') || n.includes('moneyline') || n.includes('to win') || n.includes('game winner')) return 'h2h';
    if (n.includes('home/away') || n.includes('home away') || n.includes('h2h') || n === '12' || n.includes('1-2')) return 'h2h';
    if (n.includes('double chance')) return 'double_chance';
    if (n.includes('draw no bet') || n.includes('dnb')) return 'dnb';
    if (n.includes('both teams score') || n.includes('both teams to score') || n.includes('btts')) return 'btts';
    if (n.includes('exact score') || n.includes('correct score')) return 'correct_score';
    if (n.includes('odd/even') || n.includes('odd even')) return 'total_goal_odd_even';
    if (n.includes('half time') && n.includes('full time')) return 'half_time_full_time';
    if (n.includes('corner')) return 'corners_totals';
    if (n.includes('card')) return 'cards_totals';
    if (n.includes('asian handicap') || (n.includes('handicap') && !n.includes('corner') && !n.includes('card'))) return 'spreads';
    if (n.includes('over/under') || n.includes('total goals') || (n.includes('goals') && n.includes('under')) || (n.includes('goals') && n.includes('over'))) return 'totals';
    if (n.includes('total') && (n.includes('over') || n.includes('under'))) return 'totals';
    return '';
  };

  for (const item of response) {
    const bookmakers = Array.isArray(item?.bookmakers) ? item.bookmakers : [];
    for (const bm of bookmakers) {
      const bets = Array.isArray(bm?.bets) ? bm.bets : [];
      for (const bet of bets) {
        const key = marketKey(String(bet?.name || bet?.id || ''));
        if (!key) continue;
        const values = Array.isArray(bet?.values) ? bet.values : [];
        for (const v of values) {
          const rawVal = String(v?.value ?? v?.label ?? v?.name ?? '').trim();
          const odd = toNumber(v?.odd ?? v?.price ?? 0);
          if (!(odd > 1)) continue;
          if (!rawVal) continue;

          if (key === 'h2h') {
            const side = resolveSide(rawVal);
            if (side === 'other') continue;
            const lbl = side === 'home' ? 'Casa' : side === 'draw' ? 'Empate' : 'Fora';
            put('h2h', lbl, odd);
            const prev = bestH2H.get(side);
            if (!prev || odd > prev) bestH2H.set(side, odd);
            continue;
          }

          if (key === 'double_chance') {
            const code = rawVal.replace(/\s+/g, '').toUpperCase();
            if (code === '1X' || code === 'X2' || code === '12') put('double_chance', code, odd);
            else put('double_chance', rawVal, odd);
            continue;
          }

          if (key === 'dnb') {
            const side = resolveSide(rawVal);
            if (side === 'home') put('dnb', 'Casa', odd);
            else if (side === 'away') put('dnb', 'Fora', odd);
            else put('dnb', rawVal, odd);
            continue;
          }

          if (key === 'btts') {
            const raw = rawVal.trim();
            const lc = raw.toLowerCase();
            if (raw.includes('/')) {
              const parts = raw.split('/').map((x) => x.trim()).filter(Boolean);
              if (parts.length >= 2) {
                const p0 = parts[0];
                const p1 = parts[1];
                const yn = p1.toLowerCase();
                const ynLbl = yn === 'yes' || yn === 'sim' ? 'Sim' : (yn === 'no' || yn === 'nao' || yn === 'não' ? 'Não' : p1);
                const side = resolveSide(p0);
                if (side === 'home' || side === 'draw' || side === 'away') {
                  const sideLbl = side === 'home' ? 'Casa' : side === 'draw' ? 'Empate' : 'Fora';
                  put('result_btts', `${sideLbl}/${ynLbl}`, odd);
                  continue;
                }
              }
            }
            const mCombo = lc.match(/^(o|u)\s*\/\s*(yes|no)\s*([0-9]+(?:[.,][0-9]+)?)$/i);
            if (mCombo) {
              const ou = String(mCombo[1] || '').toLowerCase() === 'o' ? 'Over' : 'Under';
              const ynLbl = String(mCombo[2] || '').toLowerCase() === 'yes' ? 'Sim' : 'Não';
              const point = String(mCombo[3] || '').replace(',', '.');
              put('totals_btts', `${ou} ${point}/${ynLbl}`, odd, point);
              continue;
            }
            if (lc === 'yes' || lc === 'sim') put('btts', 'Sim', odd);
            else if (lc === 'no' || lc === 'nao' || lc === 'não') put('btts', 'Não', odd);
            else put('btts', raw, odd);
            continue;
          }

          if (key === 'totals' || key === 'corners_totals' || key === 'cards_totals') {
            const mNum = /([0-9]+(?:\.[0-9]+)?|[0-9]+(?:,[0-9]+)?)/.exec(rawVal);
            const point = mNum ? String(mNum[1]).replace(',', '.') : '';
            const isOver = /over|acima|mais/i.test(rawVal);
            const isUnder = /under|abaixo|menos/i.test(rawVal);
            if (key === 'corners_totals') {
              const exact = /^\s*(exactly|exatamente)\s*[0-9]+/i.test(rawVal);
              const range = /^\s*[0-9]+\s*-\s*[0-9]+\s*$/i.test(rawVal);
              if (exact && point) {
                put('corners_exact', `Exatamente ${point}`, odd, point);
                continue;
              }
              if (range) {
                const norm = rawVal.replace(/\s+/g, '');
                put('corners_range', norm.replace('-', ' - '), odd);
                continue;
              }
            }
            if (isOver && point) put(key, `Acima ${point}`, odd, point);
            else if (isUnder && point) put(key, `Abaixo ${point}`, odd, point);
            else put(key, rawVal, odd, point || undefined);
            continue;
          }

          if (key === 'spreads') {
            const side = resolveSide(rawVal);
            const mNum = /([+-]?\s*[0-9]+(?:\.[0-9]+)?|[+-]?\s*[0-9]+(?:,[0-9]+)?)/.exec(rawVal);
            const point = mNum ? String(mNum[1]).replace(',', '.').replace(/\s+/g, '') : '';
            if ((side === 'home' || side === 'away') && point) {
              put('spreads', `${side === 'home' ? 'Casa' : 'Fora'} ${point}`, odd, point);
            } else {
              put('spreads', rawVal, odd, point || undefined);
            }
            continue;
          }

          if (key === 'total_goal_odd_even') {
            const t = rawVal.toLowerCase();
            if (t === 'odd' || t === 'impar' || t === 'ímpar') put('total_goal_odd_even', 'Ímpar', odd);
            else if (t === 'even' || t === 'par') put('total_goal_odd_even', 'Par', odd);
            else put('total_goal_odd_even', rawVal, odd);
            continue;
          }

          if (key === 'half_time_full_time') {
            put('half_time_full_time', rawVal, odd);
            continue;
          }

          if (key === 'correct_score') {
            put('correct_score', rawVal, odd);
            continue;
          }

          put(key, rawVal, odd);
        }
      }
    }
  }

  const markets: Record<string, any[]> = {};
  for (const [k, map] of byMarket) {
    const arr = Array.from(map.values()).map((x) => ({
      name: x.label,
      label: x.label,
      price: x.odd,
      odd: x.odd,
      ...(x.handicap ? { handicap: x.handicap } : {}),
    }));
    if (arr.length) markets[k] = arr;
  }

  const applyOverroundFloor = (items: any[], targetTotal: number) => {
    const odds = items.map((it) => toNumber(it?.odd ?? it?.price ?? 0)).filter((o) => o > 1.01);
    if (odds.length !== items.length) return items;
    const implied = odds.map((o) => 1 / o);
    const sum = implied.reduce((a, b) => a + b, 0);
    if (!(sum > 0)) return items;
    const scale = targetTotal / sum;
    if (!(scale > 1)) return items;
    return items.map((it, i) => {
      const o = odds[i];
      const p = (1 / o) * scale;
      const next = p > 0 ? (1 / p) : o;
      const floored = next < 1.01 ? 1.01 : next;
      return { ...it, odd: floored, price: floored };
    });
  };

  const applyPairs = (key: string, target: number, pairKey: (x: any) => string) => {
    const arr = markets[key];
    if (!Array.isArray(arr) || arr.length === 0) return;
    const groups = new Map<string, any[]>();
    for (const it of arr) {
      const pk = pairKey(it);
      if (!pk) continue;
      if (!groups.has(pk)) groups.set(pk, []);
      groups.get(pk)!.push(it);
    }
    const next: any[] = [];
    for (const g of groups.values()) {
      next.push(...applyOverroundFloor(g, target));
    }
    markets[key] = next;
  };

  if (Array.isArray(markets.h2h)) {
    const ordered = ['Casa', 'Empate', 'Fora'];
    markets.h2h = markets.h2h
      .filter((x) => ordered.includes(String(x?.label || x?.name || '')))
      .sort((a, b) => ordered.indexOf(String(a?.label || a?.name || '')) - ordered.indexOf(String(b?.label || b?.name || '')));
    markets.h2h = applyOverroundFloor(markets.h2h, 1.06);
  }
  if (Array.isArray(markets.btts)) markets.btts = applyOverroundFloor(markets.btts, 1.05);
  if (Array.isArray(markets.dnb)) markets.dnb = applyOverroundFloor(markets.dnb, 1.05);
  applyPairs('totals', 1.05, (x) => String(x?.handicap || '').trim());
  applyPairs('spreads', 1.05, (x) => {
    const h = String(x?.handicap || '').trim().replace(',', '.');
    const n = Number(h);
    if (!Number.isFinite(n)) return '';
    return String(Math.abs(n));
  });

  const home = bestH2H.get('home') || 0;
  const draw = bestH2H.get('draw') || 0;
  const away = bestH2H.get('away') || 0;
  return { home, draw, away, markets };
}

async function fetchOddsApiIoOdds(eventId: string, apiKey: string, bookmakersCsv: string): Promise<any | null> {
  const books = String(bookmakersCsv || '').trim();
  const q = new URLSearchParams();
  q.set('apiKey', String(apiKey));
  q.set('eventId', String(eventId));
  if (books) q.set('bookmakers', books);
  const url = `https://api.odds-api.io/v3/odds?${q.toString()}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (res.ok) {
    const payload = await res.json().catch(() => null);
    if (!books) return payload;
    const hasAnyData =
      Array.isArray((payload as any)?.data) ||
      Array.isArray((payload as any)?.events) ||
      Array.isArray((payload as any)?.odds) ||
      Array.isArray((payload as any)?.bookmakers) ||
      Array.isArray((payload as any)?.markets) ||
      Array.isArray((payload as any)?.response);
    if (hasAnyData) return payload;
  }
  if (books) {
    const q2 = new URLSearchParams();
    q2.set('apiKey', String(apiKey));
    q2.set('eventId', String(eventId));
    const url2 = `https://api.odds-api.io/v3/odds?${q2.toString()}`;
    const res2 = await fetch(url2, { signal: AbortSignal.timeout(12000) }).catch(() => null);
    if (res2 && res2.ok) return await res2.json().catch(() => null);
  }
  return null;
}

async function fetchApiSportsGameOdds(sportKey: string, gameId: number, apiKey: string): Promise<any | null> {
  const src = apiSportsSource(sportKey);
  if (!src || src.resource !== 'games') return null;
  const qp = new URLSearchParams();
  qp.set('game', String(gameId));
  const url = `${src.base}/odds?${qp.toString()}`;
  const res = await fetch(url, {
    headers: { 'x-apisports-key': String(apiKey) },
    signal: AbortSignal.timeout(9000),
  });
  if (!res.ok) return null;
  return await res.json().catch(() => null);
}

function extractH2HFromOddsApiIo(
  payload: any,
  meta?: { homeTeam?: string; awayTeam?: string },
): { home: number; draw: number; away: number; markets: Record<string, any[]>; sources: { home?: string; draw?: string; away?: string } } {
  const bestH2H = new Map<'home' | 'draw' | 'away', { odd: number; bookmaker?: string }>();
  const byMarket = new Map<string, Map<string, { label: string; odds: number[]; handicap?: string; bookmaker?: string }>>();

  const put = (marketKey: string, label: string, odd: number, handicap?: string, bookmaker?: string) => {
    if (!(odd > 1)) return;
    const mk = String(marketKey || '').trim();
    const lbl = String(label || '').trim();
    if (!mk || !lbl) return;
    if (!byMarket.has(mk)) byMarket.set(mk, new Map());
    const m = byMarket.get(mk)!;
    const k = `${lbl.toLowerCase()}|${String(handicap || '')}`;
    const prev = m.get(k);
    if (!prev) m.set(k, { label: lbl, odds: [odd], handicap, bookmaker });
    else prev.odds.push(odd);
  };

  const parseMl = (o: any) => {
    const home = toNumber(o?.home ?? o?.Home ?? o?.['1'] ?? o?.one ?? 0);
    const draw = toNumber(o?.draw ?? o?.Draw ?? o?.['X'] ?? o?.x ?? 0);
    const away = toNumber(o?.away ?? o?.Away ?? o?.['2'] ?? o?.two ?? 0);
    return { home, draw, away };
  };

  const resolveH2HSide = (label: string): 'home' | 'draw' | 'away' | 'other' => {
    const base = normalizeH2HLabel(label);
    if (base !== 'other') return base;
    const home = normTeamName(String(meta?.homeTeam || ''));
    const away = normTeamName(String(meta?.awayTeam || ''));
    const val = normTeamName(label);
    if (home && val && (home === val || home.includes(val) || val.includes(home))) return 'home';
    if (away && val && (away === val || away.includes(val) || val.includes(away))) return 'away';
    return 'other';
  };

  const marketKey = (name: string) => {
    const n = String(name || '').toLowerCase();
    if (n.includes('correct score') || n.includes('exact score') || n.includes('final score')) return 'correct_score';
    if (n.includes('half time') && n.includes('full time')) return 'half_time_full_time';
    if (n.includes('draw no bet') || n.includes('dnb')) return 'dnb';
    if (n.includes('corner')) return 'corners_totals';
    if (n.includes('card')) return 'cards_totals';
    if (n.includes('odd/even') || n.includes('odd even')) return 'total_goal_odd_even';
    if (n.includes('double chance')) return 'double_chance';
    if ((n.includes('both teams to score') || n.includes('btts')) && (n.includes('both halves') || n.includes('both half'))) return 'both_teams_to_score_both_halves';
    if (n.includes('both teams to score') || n.includes('btts')) return 'btts';
    if (n.includes('team total') || n.includes('team totals') || n.includes('total team')) return 'team_totals';
    if (n.includes('spread') || (n.includes('handicap') && !n.includes('corner') && !n.includes('card'))) return 'spreads';
    if (n.includes('total') || n.includes('over/under') || n.includes('totals')) return 'totals';
    if (n.includes('ml') || n.includes('moneyline') || n.includes('1x2') || n.includes('h2h') || n.includes('match winner') || n === 'result') return 'h2h';
    return '';
  };

  const scanMarketObj = (m: any, bookmaker?: string) => {
    const rawName = String(m?.name || m?.key || m?.type || '');
    const key = marketKey(rawName);
    if (!key) return;

    if (key === 'h2h') {
      const o = Array.isArray(m?.odds) && m.odds.length > 0 ? m.odds[0] : null;
      if (o) {
        const out = parseMl(o);
        if (out.home > 1) {
          const prev = bestH2H.get('home');
          if (!prev || out.home > prev.odd) bestH2H.set('home', { odd: out.home, bookmaker });
        }
        if (out.draw > 1) {
          const prev = bestH2H.get('draw');
          if (!prev || out.draw > prev.odd) bestH2H.set('draw', { odd: out.draw, bookmaker });
        }
        if (out.away > 1) {
          const prev = bestH2H.get('away');
          if (!prev || out.away > prev.odd) bestH2H.set('away', { odd: out.away, bookmaker });
        }
        put('h2h', 'Casa', out.home, undefined, bookmaker);
        put('h2h', 'Empate', out.draw, undefined, bookmaker);
        put('h2h', 'Fora', out.away, undefined, bookmaker);
      }
    } else if (key === 'double_chance') {
      const o = Array.isArray(m?.odds) && m.odds.length > 0 ? m.odds[0] : null;
      if (o) {
        put('double_chance', '1X', toNumber(o['1X'] ?? o['1x'] ?? o['1x2'] ?? o['1X2']), undefined, bookmaker);
        put('double_chance', 'X2', toNumber(o['X2'] ?? o['x2']), undefined, bookmaker);
        put('double_chance', '12', toNumber(o['12']), undefined, bookmaker);
      }
    } else if (key === 'btts') {
      const o = Array.isArray(m?.odds) && m.odds.length > 0 ? m.odds[0] : null;
      if (o) {
        put('btts', 'Sim', toNumber(o.yes), undefined, bookmaker);
        put('btts', 'Não', toNumber(o.no), undefined, bookmaker);
      }
    } else if (key === 'totals') {
      if (Array.isArray(m?.odds)) {
        for (const line of m.odds) {
          const point = line?.hdp ?? line?.max ?? line?.total ?? line?.line ?? line?.points ?? null;
          const over = toNumber(line?.over);
          const under = toNumber(line?.under);
          if (point !== null && point !== undefined) {
            put('totals', `Over ${point}`, over, String(point), bookmaker);
            put('totals', `Under ${point}`, under, String(point), bookmaker);
          }
        }
      }
    } else if (key === 'spreads') {
      if (Array.isArray(m?.odds)) {
        for (const line of m.odds) {
          const point = line?.hdp ?? line?.spread ?? line?.line ?? null;
          const h = toNumber(line?.home);
          const a = toNumber(line?.away);
          if (point !== null && point !== undefined) {
            put('spreads', `Casa ${point}`, h, String(point), bookmaker);
            put('spreads', `Fora ${point}`, a, String(point), bookmaker);
          }
        }
      }
    }

    const outcomes =
      Array.isArray(m?.outcomes) ? m.outcomes :
      Array.isArray(m?.selections) ? m.selections :
      Array.isArray(m?.values) ? m.values :
      null;
    if (key === 'h2h' && outcomes) {
      for (const v of outcomes) {
        const lbl = resolveH2HSide(String(v?.label ?? v?.name ?? v?.value ?? ''));
        if (lbl === 'other') continue;
        const odd = toNumber(v?.odd ?? v?.price ?? 0);
        if (!(odd > 1)) continue;
        const prev = bestH2H.get(lbl);
        if (!prev || odd > prev.odd) bestH2H.set(lbl, { odd, bookmaker });
        put('h2h', lbl === 'home' ? 'Casa' : lbl === 'draw' ? 'Empate' : 'Fora', odd, undefined, bookmaker);
      }
    }

    if (key !== 'h2h' && outcomes) {
      for (const v of outcomes) {
        const name = String(v?.label ?? v?.name ?? v?.value ?? '').trim();
        const odd = toNumber(v?.odd ?? v?.price ?? v?.value ?? 0);
        if (!(odd > 1)) continue;
        if (!name) continue;

        if (key === 'btts') {
          const raw = name.trim();
          const lc = raw.toLowerCase();
          const slash = raw.includes('/');
          if (slash) {
            const parts = raw.split('/').map((x) => x.trim()).filter(Boolean);
            if (parts.length >= 2) {
              const p0 = parts[0];
              const p1 = parts[1];
              const yn = p1.toLowerCase();
              const ynLbl = yn === 'yes' || yn === 'sim' ? 'Sim' : (yn === 'no' || yn === 'nao' || yn === 'não' ? 'Não' : p1);
              const side = resolveH2HSide(p0);
              if (side === 'home' || side === 'draw' || side === 'away') {
                const sideLbl = side === 'home' ? 'Casa' : side === 'draw' ? 'Empate' : 'Fora';
                put('result_btts', `${sideLbl}/${ynLbl}`, odd, undefined, bookmaker);
                continue;
              }
            }
          }
          const mCombo = lc.match(/^(o|u)\s*\/\s*(yes|no)\s*([0-9]+(?:[.,][0-9]+)?)$/i);
          if (mCombo) {
            const ou = String(mCombo[1] || '').toLowerCase() === 'o' ? 'Over' : 'Under';
            const ynLbl = String(mCombo[2] || '').toLowerCase() === 'yes' ? 'Sim' : 'Não';
            const point = String(mCombo[3] || '').replace(',', '.');
            put('totals_btts', `${ou} ${point}/${ynLbl}`, odd, point, bookmaker);
            continue;
          }
          if (lc === 'yes' || lc === 'sim') put('btts', 'Sim', odd, undefined, bookmaker);
          else if (lc === 'no' || lc === 'nao' || lc === 'não') put('btts', 'Não', odd, undefined, bookmaker);
          else put('btts', raw, odd, undefined, bookmaker);
          continue;
        }

        if (key === 'dnb') {
          const lbl = resolveH2HSide(name);
          if (lbl === 'home') put('dnb', 'Casa', odd, undefined, bookmaker);
          else if (lbl === 'away') put('dnb', 'Fora', odd, undefined, bookmaker);
          else put('dnb', name, odd, undefined, bookmaker);
          continue;
        }

        if (key === 'totals' || key === 'corners_totals' || key === 'cards_totals' || key === 'team_totals') {
          const mNum = /([0-9]+(?:\.[0-9]+)?|[0-9]+(?:,[0-9]+)?)/.exec(name);
          const point = mNum ? String(mNum[1]).replace(',', '.') : '';
          const isOver = /over|acima|mais/i.test(name);
          const isUnder = /under|abaixo|menos/i.test(name);
          if (key === 'corners_totals') {
            const exact = /^\s*(exactly|exatamente)\s*[0-9]+/i.test(name);
            const range = /^\s*[0-9]+\s*-\s*[0-9]+\s*$/i.test(name);
            if (exact && point) {
              put('corners_exact', `Exatamente ${point}`, odd, point, bookmaker);
              continue;
            }
            if (range) {
              const norm = name.replace(/\s+/g, '');
              put('corners_range', norm.replace('-', ' - '), odd, undefined, bookmaker);
              continue;
            }
          }
          if (isOver && point) put(key, `Acima ${point}`, odd, point, bookmaker);
          else if (isUnder && point) put(key, `Abaixo ${point}`, odd, point, bookmaker);
          else put(key, name, odd, point || undefined, bookmaker);
          continue;
        }

        if (key === 'spreads') {
          const lbl = resolveH2HSide(name);
          const mNum = /([+-]?\s*[0-9]+(?:\.[0-9]+)?|[+-]?\s*[0-9]+(?:,[0-9]+)?)/.exec(name);
          const point = mNum ? String(mNum[1]).replace(',', '.').replace(/\s+/g, '') : '';
          if ((lbl === 'home' || lbl === 'away') && point) {
            put('spreads', `${lbl === 'home' ? 'Casa' : 'Fora'} ${point}`, odd, point, bookmaker);
          } else {
            put('spreads', name, odd, undefined, bookmaker);
          }
          continue;
        }

        put(key, name, odd, undefined, bookmaker);
      }
    }
  };

  const roots: any[] = [];
  const push = (v: any) => {
    if (!v) return;
    if (Array.isArray(v)) roots.push(...v);
    else roots.push(v);
  };
  push(payload);
  if (payload && typeof payload === 'object') {
    push((payload as any).data);
    push((payload as any).response);
    push((payload as any).result);
    push((payload as any).odds);
    push((payload as any).payload);
    push((payload as any).markets);
  }

  for (const root of roots) {
    if (!root) continue;
    if (Array.isArray(root)) {
      for (const item of root) scanMarketObj(item);
      continue;
    }
    if (root.bookmakers && typeof root.bookmakers === 'object') {
      for (const [bk, v] of Object.entries(root.bookmakers)) {
        if (Array.isArray(v)) {
          for (const m of v as any[]) scanMarketObj(m, String(bk || ''));
        } else if (v && typeof v === 'object') {
          const list = Array.isArray((v as any).markets) ? (v as any).markets : (Array.isArray((v as any).bets) ? (v as any).bets : null);
          if (Array.isArray(list)) for (const m of list) scanMarketObj(m, String(bk || ''));
        }
      }
    }
    if (Array.isArray(root.markets)) {
      for (const m of root.markets) scanMarketObj(m, String(root.bookmaker || root.provider || ''));
    }
    scanMarketObj(root, String(root.bookmaker || root.provider || ''));
  }

  const median = (arr: number[]) => {
    const list = arr.filter((n) => Number.isFinite(n) && n > 1).sort((a, b) => a - b);
    if (list.length === 0) return 0;
    const mid = Math.floor(list.length / 2);
    if (list.length % 2 === 1) return list[mid];
    return (list[mid - 1] + list[mid]) / 2;
  };

  const applyOverroundFloor = (items: any[], targetTotal: number) => {
    const odds = items.map((it) => toNumber(it?.odd ?? it?.price ?? 0)).filter((o) => o > 1.01);
    if (odds.length !== items.length) return items;
    const implied = odds.map((o) => 1 / o);
    const sum = implied.reduce((a, b) => a + b, 0);
    if (!(sum > 0)) return items;
    const scale = targetTotal / sum;
    if (!(scale > 1)) return items;
    return items.map((it, i) => {
      const o = odds[i];
      const p = (1 / o) * scale;
      const next = p > 0 ? (1 / p) : o;
      const floored = next < 1.01 ? 1.01 : next;
      return { ...it, odd: floored, price: floored };
    });
  };

  const markets: Record<string, any[]> = {};
  for (const [k, map] of byMarket) {
    const arr = Array.from(map.values()).map((x) => {
      const o = median(x.odds);
      return {
        name: x.label,
        label: x.label,
        price: o,
        odd: o,
        ...(x.bookmaker ? { bookmaker: x.bookmaker } : {}),
        ...(x.handicap ? { handicap: x.handicap } : {}),
      };
    }).filter((x) => Number(x.odd) > 1.01);
    if (arr.length) markets[k] = arr;
  }

  if (Array.isArray(markets.h2h)) {
    const ordered = ['Casa', 'Empate', 'Fora'];
    markets.h2h = markets.h2h
      .filter((x) => ordered.includes(String(x?.label || x?.name || '')))
      .sort((a, b) => ordered.indexOf(String(a?.label || a?.name || '')) - ordered.indexOf(String(b?.label || b?.name || '')));
    markets.h2h = applyOverroundFloor(markets.h2h, 1.06);
  }
  if (Array.isArray(markets.btts)) markets.btts = applyOverroundFloor(markets.btts, 1.05);
  if (Array.isArray(markets.dnb)) markets.dnb = applyOverroundFloor(markets.dnb, 1.05);

  const applyPairs = (key: string, target: number, pairKey: (x: any) => string) => {
    const arr = markets[key];
    if (!Array.isArray(arr) || arr.length === 0) return;
    const groups = new Map<string, any[]>();
    for (const it of arr) {
      const pk = pairKey(it);
      if (!pk) continue;
      if (!groups.has(pk)) groups.set(pk, []);
      groups.get(pk)!.push(it);
    }
    const next: any[] = [];
    for (const g of groups.values()) {
      const fixed = applyOverroundFloor(g, target);
      next.push(...fixed);
    }
    markets[key] = next;
  };

  applyPairs('totals', 1.05, (x) => String(x?.handicap || '').trim());
  applyPairs('spreads', 1.05, (x) => {
    const h = String(x?.handicap || '').trim().replace(',', '.');
    const n = Number(h);
    if (!Number.isFinite(n)) return '';
    return String(Math.abs(n));
  });

  const h2hArr = Array.isArray(markets.h2h) ? markets.h2h : [];
  const home = toNumber(h2hArr.find((x: any) => String(x?.label || x?.name || '') === 'Casa')?.odd) || bestH2H.get('home')?.odd || 0;
  const draw = toNumber(h2hArr.find((x: any) => String(x?.label || x?.name || '') === 'Empate')?.odd) || bestH2H.get('draw')?.odd || 0;
  const away = toNumber(h2hArr.find((x: any) => String(x?.label || x?.name || '') === 'Fora')?.odd) || bestH2H.get('away')?.odd || 0;
  const sources = {
    home: bestH2H.get('home')?.bookmaker,
    draw: bestH2H.get('draw')?.bookmaker,
    away: bestH2H.get('away')?.bookmaker,
  };
  return { home, draw, away, markets, sources };
}

function normTeamName(name: string): string {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function teamsRoughMatch(a: string, b: string): boolean {
  const na = normTeamName(a);
  const nb = normTeamName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const wa = na.split(' ').filter((w) => w.length > 2);
  const wb = nb.split(' ').filter((w) => w.length > 2);
  return wa.length > 0 && wb.length > 0 && wa.some((w) => wb.includes(w));
}

function matchOddsIoEventId(meta: { home: string; away: string; kickoff: string }, oddsEvents: any[]) {
  const tgtMs = Date.parse(meta.kickoff);
  let best: { id: string; swapped: boolean; score: number } | null = null;
  for (const ev of oddsEvents) {
    const id = ev.id ?? ev.eventId ?? ev.event_id ?? ev.fixtureId ?? ev.fixture_id ?? null;
    const home = toTeamName(ev.home_team || ev.home || ev.homeTeam || ev.home_name || '');
    const away = toTeamName(ev.away_team || ev.away || ev.awayTeam || ev.away_name || '');
    const date = ev.commence_time || ev.date || ev.start_time || ev.scheduled || '';
    if (!id || !home || !away || !date) continue;
    const evMs = Date.parse(String(date || ''));
    if (Number.isFinite(tgtMs) && Number.isFinite(evMs)) {
      const diffMin = Math.abs(evMs - tgtMs) / 60000;
      if (diffMin > 12 * 60) continue;
    }
    const direct = teamsRoughMatch(meta.home, home) && teamsRoughMatch(meta.away, away);
    const swap = teamsRoughMatch(meta.home, away) && teamsRoughMatch(meta.away, home);
    if (!direct && !swap) continue;
    const score =
      (direct ? 2 : 1) * 50 +
      (Number.isFinite(tgtMs) && Number.isFinite(evMs) ? Math.max(0, 50 - Math.abs(evMs - tgtMs) / 60000) : 0);
    if (!best || score > best.score) best = { id: String(id), swapped: swap && !direct, score };
  }
  return best;
}

async function fetchFixtureMetaFromApiSports(fixtureId: number, apiKey: string): Promise<{ league: string; home: string; away: string; kickoff: string } | null> {
  const url = `https://v3.football.api-sports.io/fixtures?id=${fixtureId}`;
  const res = await fetch(url, { headers: { 'x-apisports-key': String(apiKey) }, signal: AbortSignal.timeout(9000) });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  const f = Array.isArray(data?.response) && data.response.length ? data.response[0] : null;
  if (!f) return null;
  const league = String(f?.league?.name || '');
  const home = String(f?.teams?.home?.name || '');
  const away = String(f?.teams?.away?.name || '');
  const kickoff = String(f?.fixture?.date || '');
  if (!home || !away || !kickoff) return null;
  return { league, home, away, kickoff };
}

async function fetchGameMetaFromApiSports(sportKey: string, gameId: number, apiKey: string): Promise<{ league: string; home: string; away: string; kickoff: string } | null> {
  const g = await fetchApiSportsById(sportKey, apiKey, gameId).catch(() => null);
  if (!g) return null;
  const league = String(g?.league?.name || g?.league || '');
  const fighters: any[] = sportKey === 'mma' && Array.isArray(g?.fighters) ? g.fighters : [];
  const home = String(fighters?.[0]?.name || g?.teams?.home?.name || g?.home?.name || g?.teams?.[0]?.name || '');
  const away = String(fighters?.[1]?.name || g?.teams?.away?.name || g?.away?.name || g?.teams?.[1]?.name || '');
  const kickoff = String(g?.date || g?.game?.date || g?.time || '');
  if (!home || !away || !kickoff) return null;
  return { league, home, away, kickoff };
}

async function findOddsIoEventIdForMeta(meta: { home: string; away: string; kickoff: string }, oddsKey: string, sport: string): Promise<{ eventId: string; swapped: boolean } | null> {
  const kickoffMs = new Date(meta.kickoff).getTime();
  const from = new Date(kickoffMs - (sport === 'football' ? 6 : 24) * 60 * 60 * 1000).toISOString();
  const to = new Date(kickoffMs + (sport === 'football' ? 24 : 48) * 60 * 60 * 1000).toISOString();
  const listUrl = `https://api.odds-api.io/v3/events?apiKey=${encodeURIComponent(oddsKey)}&sport=${sport}&status=${encodeURIComponent('pending,live')}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=300`;
  const payload = await fetch(listUrl, { signal: AbortSignal.timeout(15000) }).then((r) => r.ok ? r.json() : null).catch(() => null);
  const arr = oddsIoEventsArray(payload);
  let best: { ev: any; score: number; swapped: boolean } | null = null;
  const tgtMs = Date.parse(meta.kickoff);
  const maxDiffMin = sport === 'football' ? 6 * 60 : 36 * 60;
  for (const ev of arr) {
    const id = ev.id ?? ev.eventId ?? ev.event_id ?? ev.fixtureId ?? ev.fixture_id ?? null;
    const home = toTeamName(ev.home_team || ev.home || ev.homeTeam || ev.home_name || '');
    const away = toTeamName(ev.away_team || ev.away || ev.awayTeam || ev.away_name || '');
    const date = ev.commence_time || ev.date || ev.start_time || ev.scheduled || '';
    if (!id || !home || !away || !date) continue;
    const evMs = Date.parse(String(date || ''));
    if (Number.isFinite(tgtMs) && Number.isFinite(evMs)) {
      const diffMin = Math.abs(evMs - tgtMs) / 60000;
      if (diffMin > maxDiffMin) continue;
    }
    const direct = teamsRoughMatch(meta.home, home) && teamsRoughMatch(meta.away, away);
    const swap = teamsRoughMatch(meta.home, away) && teamsRoughMatch(meta.away, home);
    if (!direct && !swap) continue;
    const score =
      (direct ? 2 : 1) * 50 +
      (Number.isFinite(tgtMs) && Number.isFinite(Date.parse(String(date))) ? Math.max(0, 50 - Math.abs(Date.parse(String(date)) - tgtMs) / 60000) : 0);
    if (!best || score > best.score) best = { ev, score, swapped: swap && !direct };
  }
  if (!best) return null;
  return { eventId: String(best.ev.id ?? best.ev.eventId ?? best.ev.event_id ?? best.ev.fixtureId ?? best.ev.fixture_id), swapped: best.swapped };
}

async function oddsStreamHandler(req: any, res: any) {
  const url = new URL(String(req.url || ''), 'http://localhost');
  const id = String(url.searchParams.get('id') || '').trim();
  const fixtureId = pickFixtureId(id);
  const oddsIoId = pickOddsIoEventId(id);
  const sportKey = pickSportKey(id) || 'soccer';
  const apiKey = String(process.env.API_SPORTS_KEY || '').trim();
  const oddsKey = String(process.env.ODDS_API_KEY || '').trim();
  const bookmakersCsv = String(url.searchParams.get('bookmakers') || '').trim() || String(process.env.ODDS_API_BOOKMAKERS || DEFAULT_ODDS_BOOKMAKERS).trim();
  const booksForOddsIo = bookmakersCsv;

  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  try { res.flushHeaders?.(); } catch { void 0; }

  const send = (obj: any) => {
    try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch { void 0; }
  };

  if (!id || (!(fixtureId > 0) && !oddsIoId)) {
    send({ type: 'error', error: 'missing_id', ts: Date.now() });
    res.end();
    return;
  }
  if (!(oddsIoId && oddsKey) && !apiKey) {
    send({ type: 'error', error: 'missing_api_key', ts: Date.now() });
    res.end();
    return;
  }

  if (!oddsIoId && sportKey !== 'soccer' && fixtureId > 0 && apiKey) {
    const raw2 = await fetchApiSportsGameOdds(sportKey, fixtureId, apiKey).catch(() => null);
    if (raw2) {
      const meta2 = await fetchGameMetaFromApiSports(sportKey, fixtureId, apiKey).catch(() => null);
      const out2 = extractOddsFromApiSports(raw2, meta2 ? { homeTeam: meta2.home, awayTeam: meta2.away } : undefined);
      send({
        type: 'odds',
        id,
        home_odd: out2.home,
        draw_odd: out2.draw,
        away_odd: out2.away,
        markets: out2.markets,
        provider: 'api-sports',
        updated_at: new Date().toISOString(),
        ts: Date.now(),
      });
      res.end();
      return;
    }
  }

  let closed = false;
  req.on('close', () => { closed = true; });
  req.on('aborted', () => { closed = true; });

  send({ type: 'hello', id, ts: Date.now() });

  let lastHash = '';
  const startedAt = Date.now();
  const maxMs = 55_000;

  while (!closed && Date.now() - startedAt < maxMs) {
    await (async () => {
      if (!(oddsKey && (oddsIoId || fixtureId > 0))) return;
      let effectiveId = oddsIoId || '';
      let swapped = false;
      let metaTeams: { homeTeam: string; awayTeam: string } | undefined;
      if (!effectiveId && fixtureId > 0 && apiKey) {
        const meta = await cached(
          `eventMeta:${sportKey}:${fixtureId}`,
          10 * 60_000,
          async () =>
            (sportKey === 'soccer'
              ? fetchFixtureMetaFromApiSports(fixtureId, apiKey).catch(() => null)
              : fetchGameMetaFromApiSports(sportKey, fixtureId, apiKey).catch(() => null)),
        );
        if (meta) {
          metaTeams = { homeTeam: meta.home, awayTeam: meta.away };
          const oddsSport = await resolveOddsSportSlug(sportKey);
          const match = await cached(
            `oddsio:match:${sportKey}:${fixtureId}:${oddsSport}`,
            10 * 60_000,
            async () => findOddsIoEventIdForMeta({ home: meta.home, away: meta.away, kickoff: meta.kickoff }, oddsKey, oddsSport).catch(() => null),
          );
          if (match) {
            effectiveId = match.eventId;
            swapped = match.swapped;
          }
        }
      }
      if (effectiveId) {
        const raw = await cached(
          `oddsio:odds:${effectiveId}:${booksForOddsIo}`,
          5000,
          async () => fetchOddsApiIoOdds(effectiveId, oddsKey, booksForOddsIo),
        );
        if (raw) {
          const mappedTeams = metaTeams ? (swapped ? { homeTeam: metaTeams.awayTeam, awayTeam: metaTeams.homeTeam } : metaTeams) : undefined;
          const out = extractH2HFromOddsApiIo(raw, mappedTeams);
          const mk = out.markets && typeof out.markets === 'object' ? Object.keys(out.markets).sort() : [];
          const mc = mk.map((k) => Array.isArray((out.markets as any)[k]) ? (out.markets as any)[k].length : 0);
          const hash = JSON.stringify([out.home, out.draw, out.away, mk, mc]);
          if (hash !== lastHash) {
            lastHash = hash;
            send({
              type: 'odds',
              id,
              home_odd: swapped ? out.away : out.home,
              draw_odd: out.draw,
              away_odd: swapped ? out.home : out.away,
              markets: out.markets,
              provider: 'odds-api.io',
              updated_at: new Date().toISOString(),
              ts: Date.now(),
            });
          } else {
            send({ type: 'ping', ts: Date.now() });
          }
        } else {
          if (sportKey !== 'soccer' && fixtureId > 0 && apiKey) {
            const raw2 = await cached(`apisports:odds:${sportKey}:${fixtureId}`, 5000, async () => fetchApiSportsGameOdds(sportKey, fixtureId, apiKey));
            if (raw2) {
              const meta2 = await cached(
                `eventMeta:${sportKey}:${fixtureId}`,
                10 * 60_000,
                async () => fetchGameMetaFromApiSports(sportKey, fixtureId, apiKey).catch(() => null),
              ).catch(() => null);
              const out2 = extractOddsFromApiSports(raw2, meta2 ? { homeTeam: meta2.home, awayTeam: meta2.away } : undefined);
              const mk2 = out2.markets && typeof out2.markets === 'object' ? Object.keys(out2.markets).sort() : [];
              const mc2 = mk2.map((k) => Array.isArray((out2.markets as any)[k]) ? (out2.markets as any)[k].length : 0);
              const hash2 = JSON.stringify([out2.home, out2.draw, out2.away, mk2, mc2]);
              if (hash2 !== lastHash) {
                lastHash = hash2;
                send({
                  type: 'odds',
                  id,
                  home_odd: out2.home,
                  draw_odd: out2.draw,
                  away_odd: out2.away,
                  markets: out2.markets,
                  provider: 'api-sports',
                  updated_at: new Date().toISOString(),
                  ts: Date.now(),
                });
              } else {
                send({ type: 'ping', ts: Date.now() });
              }
              return;
            }
          }
          if (sportKey === 'soccer' && fixtureId > 0 && apiKey) {
            const raw2 = await cached(`apisports:odds:${fixtureId}`, 5000, async () => fetchApiSportsOdds(fixtureId, apiKey));
            if (raw2) {
              const meta2 = await cached(
                `eventMeta:soccer:${fixtureId}`,
                10 * 60_000,
                async () => fetchFixtureMetaFromApiSports(fixtureId, apiKey).catch(() => null),
              ).catch(() => null);
              const out2 = extractOddsFromApiSports(raw2, meta2 ? { homeTeam: meta2.home, awayTeam: meta2.away } : undefined);
              const mk2 = out2.markets && typeof out2.markets === 'object' ? Object.keys(out2.markets).sort() : [];
              const mc2 = mk2.map((k) => Array.isArray((out2.markets as any)[k]) ? (out2.markets as any)[k].length : 0);
              const hash2 = JSON.stringify([out2.home, out2.draw, out2.away, mk2, mc2]);
              if (hash2 !== lastHash) {
                lastHash = hash2;
                send({
                  type: 'odds',
                  id,
                  home_odd: out2.home,
                  draw_odd: out2.draw,
                  away_odd: out2.away,
                  markets: out2.markets,
                  provider: 'api-sports',
                  updated_at: new Date().toISOString(),
                  ts: Date.now(),
                });
              } else {
                send({ type: 'ping', ts: Date.now() });
              }
              return;
            }
          }
          send({ type: 'ping', ts: Date.now() });
        }
      } else if (sportKey === 'soccer' && fixtureId > 0 && apiKey) {
        const raw = await cached(`apisports:odds:${fixtureId}`, 5000, async () => fetchApiSportsOdds(fixtureId, apiKey));
        if (raw) {
          const meta = await cached(
            `eventMeta:soccer:${fixtureId}`,
            10 * 60_000,
            async () => fetchFixtureMetaFromApiSports(fixtureId, apiKey).catch(() => null),
          ).catch(() => null);
          const out = extractOddsFromApiSports(raw, meta ? { homeTeam: meta.home, awayTeam: meta.away } : undefined);
          const mk = out.markets && typeof out.markets === 'object' ? Object.keys(out.markets).sort() : [];
          const mc = mk.map((k) => Array.isArray((out.markets as any)[k]) ? (out.markets as any)[k].length : 0);
          const hash = JSON.stringify([out.home, out.draw, out.away, mk, mc]);
          if (hash !== lastHash) {
            lastHash = hash;
            send({
              type: 'odds',
              id,
              home_odd: out.home,
              draw_odd: out.draw,
              away_odd: out.away,
              markets: out.markets,
              provider: 'api-sports',
              updated_at: new Date().toISOString(),
              ts: Date.now(),
            });
          } else {
            send({ type: 'ping', ts: Date.now() });
          }
        } else {
          send({ type: 'ping', ts: Date.now() });
        }
      }
    })().catch(() => {
      send({ type: 'ping', ts: Date.now() });
    });

    await new Promise((r) => setTimeout(r, 1200));
  }

  send({ type: 'bye', ts: Date.now() });
  res.end();
}

function mapSoccerFixtureToEvent(f: any) {
  const fid = String(f?.fixture?.id || '');
  if (!fid) return null;
  const id = `soccer_${fid}`;
  const statusShort = String(f?.fixture?.status?.short || '').trim() || 'NS';
  const eventDate = String(f?.fixture?.date || '');
  const leagueName = String(f?.league?.name || '');
  const country = String(f?.league?.country || '');
  const homeTeam = String(f?.teams?.home?.name || '');
  const awayTeam = String(f?.teams?.away?.name || '');
  if (!homeTeam || !awayTeam) return null;
  const homeLogo = String(f?.teams?.home?.logo || '');
  const awayLogo = String(f?.teams?.away?.logo || '');
  const goalsHome = toNumber(f?.goals?.home ?? 0);
  const goalsAway = toNumber(f?.goals?.away ?? 0);
  const elapsed = toNumber(f?.fixture?.status?.elapsed ?? 0);
  const liveStatus = new Set([
    '1H', '2H', 'HT', 'ET', 'P', 'LIVE',
    'Q1', 'Q2', 'Q3', 'Q4', 'OT', 'BT',
    'P1', 'P2', 'P3',
    'S1', 'S2', 'S3', 'S4', 'S5',
    'IN', 'IN1', 'IN2', 'IN3', 'IN4', 'IN5', 'IN6', 'IN7', 'IN8', 'IN9',
    'IN_PROGRESS',
  ]);
  const isLive = liveStatus.has(statusShort);
  return {
    id,
    external_event_id: id,
    sport: 'soccer',
    league: leagueName,
    country,
    home_team: homeTeam,
    away_team: awayTeam,
    match: `${homeTeam} vs ${awayTeam}`,
    event_date: eventDate,
    date: eventDate,
    is_live: isLive ? 1 : 0,
    status: { short: statusShort, long: statusShort, elapsed },
    elapsed,
    goals: { home: goalsHome, away: goalsAway },
    score: { home: goalsHome, away: goalsAway },
    teams: {
      home: { name: homeTeam, logo: homeLogo },
      away: { name: awayTeam, logo: awayLogo },
    },
    home_team_logo: homeLogo,
    away_team_logo: awayLogo,
    home_odd: 0,
    draw_odd: 0,
    away_odd: 0,
  };
}

async function eventByIdHandler(eventId: string, res: any) {
  const apiKey = String(process.env.API_SPORTS_KEY || '').trim();
  if (!apiKey) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'missing_api_sports_key' }));
    return;
  }
  const sportKey = pickSportKey(eventId) || 'soccer';
  const idNum = pickFixtureId(eventId);
  if (!(idNum > 0)) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'not_found' }));
    return;
  }
  if (sportKey === 'soccer') {
    const data = await apiGet(`https://v3.football.api-sports.io/fixtures?id=${idNum}`, apiKey, 12_000);
    const f = Array.isArray(data?.response) && data.response.length ? data.response[0] : null;
    const ev = f ? mapSoccerFixtureToEvent(f) : null;
    if (!ev) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'not_found' }));
      return;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=5, s-maxage=15, stale-while-revalidate=60');
    res.end(JSON.stringify(ev));
    return;
  }

  const g = await fetchApiSportsById(sportKey, apiKey, idNum).catch(() => null);
  const src = apiSportsSource(sportKey);
  const ev = src?.resource === 'fights' ? mapApiSportsFightToEvent(g) : mapApiSportsGameToEvent(sportKey, g);
  if (!ev) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'not_found' }));
    return;
  }
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=5, s-maxage=15, stale-while-revalidate=60');
  res.end(JSON.stringify(ev));
}

async function eventStatsHandler(eventId: string, res: any) {
  const apiKey = String(process.env.API_SPORTS_KEY || '').trim();
  if (!apiKey) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'missing_api_sports_key' }));
    return;
  }
  const sportKey = pickSportKey(eventId) || 'soccer';
  const idNum = pickFixtureId(eventId);
  if (!(idNum > 0)) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'not_found' }));
    return;
  }
  if (sportKey !== 'soccer') {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=10, s-maxage=30, stale-while-revalidate=120');
    res.end(JSON.stringify({ stats: [], events: [] }));
    return;
  }
  const [stats, events] = await Promise.all([
    apiGet(`https://v3.football.api-sports.io/fixtures/statistics?fixture=${idNum}`, apiKey, 12_000).catch(() => null),
    apiGet(`https://v3.football.api-sports.io/fixtures/events?fixture=${idNum}`, apiKey, 12_000).catch(() => null),
  ]);
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=10, s-maxage=30, stale-while-revalidate=120');
  res.end(JSON.stringify({
    stats: Array.isArray(stats?.response) ? stats.response : [],
    events: Array.isArray(events?.response) ? events.response : [],
  }));
}

async function eventLineupsHandler(eventId: string, res: any) {
  const apiKey = String(process.env.API_SPORTS_KEY || '').trim();
  if (!apiKey) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'missing_api_sports_key' }));
    return;
  }
  const sportKey = pickSportKey(eventId) || 'soccer';
  const idNum = pickFixtureId(eventId);
  if (!(idNum > 0)) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'not_found' }));
    return;
  }
  if (sportKey !== 'soccer') {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=10, s-maxage=30, stale-while-revalidate=120');
    res.end(JSON.stringify({ lineups: [] }));
    return;
  }
  const data = await apiGet(`https://v3.football.api-sports.io/fixtures/lineups?fixture=${idNum}`, apiKey, 12_000).catch(() => null);
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=10, s-maxage=30, stale-while-revalidate=120');
  res.end(JSON.stringify({ lineups: Array.isArray(data?.response) ? data.response : [] }));
}

async function eventInsightsHandler(eventId: string, res: any) {
  const apiKey = String(process.env.API_SPORTS_KEY || '').trim();
  if (!apiKey) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'missing_api_sports_key' }));
    return;
  }
  const sportKey = pickSportKey(eventId) || 'soccer';
  const idNum = pickFixtureId(eventId);
  if (!(idNum > 0)) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'not_found' }));
    return;
  }
  if (sportKey !== 'soccer') {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=60, stale-while-revalidate=300');
    res.end(JSON.stringify({ league: {}, home: {}, away: {}, h2h: {} }));
    return;
  }

  const data = await cached(`fixture:insights:${idNum}`, 60_000, async () => {
    const fixtureUrl = `https://v3.football.api-sports.io/fixtures?id=${idNum}`;
    const fRes = await fetch(fixtureUrl, { headers: { 'x-apisports-key': String(apiKey) }, signal: AbortSignal.timeout(12000) });
    if (!fRes.ok) return null;
    const fData = await fRes.json().catch(() => null);
    const f = Array.isArray(fData?.response) && fData.response.length ? fData.response[0] : null;
    if (!f) return null;

    const leagueId = Number(f?.league?.id || 0);
    const season = Number(f?.league?.season || 0);
    const leagueName = String(f?.league?.name || '');
    const homeTeamId = Number(f?.teams?.home?.id || 0);
    const awayTeamId = Number(f?.teams?.away?.id || 0);
    const homeTeamName = String(f?.teams?.home?.name || '');
    const awayTeamName = String(f?.teams?.away?.name || '');
    const homeLogo = String(f?.teams?.home?.logo || '');
    const awayLogo = String(f?.teams?.away?.logo || '');
    if (!(leagueId > 0) || !(season > 0) || !(homeTeamId > 0) || !(awayTeamId > 0)) return null;

    const poissonOver = (lambda: number, line: 1.5 | 2.5) => {
      if (!(lambda > 0)) return 0;
      const e = Math.exp(-lambda);
      if (line === 1.5) return (1 - e * (1 + lambda)) * 100;
      return (1 - e * (1 + lambda + (lambda * lambda) / 2)) * 100;
    };
    const poissonBtts = (lambda: number) => {
      if (!(lambda > 0)) return 0;
      const a = Math.exp(-lambda / 2);
      const b = Math.exp(-lambda);
      return (1 - 2 * a + b) * 100;
    };

    const standingsUrl = `https://v3.football.api-sports.io/standings?league=${leagueId}&season=${season}`;
    const sData = await fetch(standingsUrl, { headers: { 'x-apisports-key': String(apiKey) }, signal: AbortSignal.timeout(12000) })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    const league = Array.isArray(sData?.response) && sData.response.length ? sData.response[0] : null;
    const table = league?.league?.standings;
    const rows: any[] = Array.isArray(table) && Array.isArray(table[0]) ? table[0] : (Array.isArray(table) ? table.flat() : []);
    let sumPlayed = 0;
    let sumGoalsFor = 0;
    for (const r of rows) {
      const all = r?.all || {};
      const played = Number(all?.played || 0);
      const gf = Number(all?.goals?.for || 0);
      if (Number.isFinite(played) && played > 0) sumPlayed += played;
      if (Number.isFinite(gf) && gf >= 0) sumGoalsFor += gf;
    }
    const leagueMatches = sumPlayed > 0 ? (sumPlayed / 2) : 0;
    const leagueAvgGoals = leagueMatches > 0 ? (sumGoalsFor / leagueMatches) : 0;

    const fetchLast = async (teamId: number) => {
      const url = `https://v3.football.api-sports.io/fixtures?team=${teamId}&league=${leagueId}&season=${season}&last=6`;
      const j = await fetch(url, { headers: { 'x-apisports-key': String(apiKey) }, signal: AbortSignal.timeout(12000) })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      return Array.isArray(j?.response) ? j.response : [];
    };

    const [homeLastRaw, awayLastRaw, h2hRaw] = await Promise.all([
      fetchLast(homeTeamId),
      fetchLast(awayTeamId),
      apiGet(`https://v3.football.api-sports.io/fixtures/headtohead?h2h=${homeTeamId}-${awayTeamId}&last=20`, apiKey, 12_000).catch(() => null),
    ]);

    const normalizeLast = (teamId: number, teamName: string, arr: any[]) => {
      const short = (s: string) => {
        const t = String(s || '').trim();
        if (t.length <= 14) return t;
        return `${t.slice(0, 12)}…`;
      };
      const out: any[] = [];
      let count = 0;
      let sumGoals = 0;
      let over15 = 0;
      let over25 = 0;
      let btts = 0;
      for (const fx of arr) {
        const th = Number(fx?.teams?.home?.id || 0);
        const ta = Number(fx?.teams?.away?.id || 0);
        const gh = toNumber(fx?.goals?.home);
        const ga = toNumber(fx?.goals?.away);
        if (!(Number.isFinite(gh) && Number.isFinite(ga))) continue;
        if (!(th > 0 && ta > 0)) continue;
        const total = gh + ga;
        sumGoals += total;
        count += 1;
        if (total > 1.5) over15 += 1;
        if (total > 2.5) over25 += 1;
        if (gh > 0 && ga > 0) btts += 1;
        const isHome = th === teamId;
        const opp = isHome ? String(fx?.teams?.away?.name || '') : String(fx?.teams?.home?.name || '');
        const oppLogo = isHome ? String(fx?.teams?.away?.logo || '') : String(fx?.teams?.home?.logo || '');
        const title = isHome ? `${short(teamName)} vs ${short(opp)}` : `${short(opp)} vs ${short(teamName)}`;
        const score = isHome ? `${gh} - ${ga}` : `${gh} - ${ga}`;
        out.push({ title, score, opponent: opp, opponent_logo: oppLogo, date: String(fx?.fixture?.date || '') });
      }
      const avg = count > 0 ? (sumGoals / count) : 0;
      return {
        last: out.slice(0, 6),
        metrics: {
          avg_total_goals: avg,
          over_15_pct: count > 0 ? (over15 / count) * 100 : 0,
          over_25_pct: count > 0 ? (over25 / count) * 100 : 0,
          btts_pct: count > 0 ? (btts / count) * 100 : 0,
        },
      };
    };

    const homeLast = normalizeLast(homeTeamId, homeTeamName, homeLastRaw);
    const awayLast = normalizeLast(awayTeamId, awayTeamName, awayLastRaw);

    const h2hList: any[] = Array.isArray(h2hRaw?.response) ? h2hRaw.response : [];
    let hw = 0;
    let dw = 0;
    let aw = 0;
    for (const fx of h2hList) {
      const gh = toNumber(fx?.goals?.home);
      const ga = toNumber(fx?.goals?.away);
      const th = Number(fx?.teams?.home?.id || 0);
      const ta = Number(fx?.teams?.away?.id || 0);
      if (!(Number.isFinite(gh) && Number.isFinite(ga))) continue;
      if (gh === ga) { dw += 1; continue; }
      const homeWon = gh > ga;
      const winnerId = homeWon ? th : ta;
      if (winnerId === homeTeamId) hw += 1;
      else if (winnerId === awayTeamId) aw += 1;
    }

    return {
      league: {
        id: leagueId,
        name: leagueName,
        season,
        avg_goals_per_match: leagueAvgGoals,
        over_15_pct: poissonOver(leagueAvgGoals, 1.5),
        over_25_pct: poissonOver(leagueAvgGoals, 2.5),
        btts_pct: poissonBtts(leagueAvgGoals),
      },
      home: {
        id: homeTeamId,
        name: homeTeamName,
        logo: homeLogo,
        ...homeLast,
      },
      away: {
        id: awayTeamId,
        name: awayTeamName,
        logo: awayLogo,
        ...awayLast,
      },
      h2h: {
        home_wins: hw,
        draws: dw,
        away_wins: aw,
      },
    };
  }).catch(() => null);

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=60, stale-while-revalidate=300');
  res.end(JSON.stringify(data || { league: {}, home: {}, away: {}, h2h: {} }));
}

async function fixturesStandingsHandler(eventId: string, url: URL, res: any) {
  const apiKey = String(process.env.API_SPORTS_KEY || '').trim();
  const wantFull = String(url.searchParams.get('full') || '').trim() === '1';
  if (!apiKey) {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=10, s-maxage=30, stale-while-revalidate=120');
    res.end(JSON.stringify({ league: '', season: 0, home: null, away: null, table: wantFull ? [] : undefined }));
    return;
  }
  const sportKey = pickSportKey(eventId) || 'soccer';
  const idNum = pickFixtureId(eventId);
  if (!(idNum > 0) || sportKey !== 'soccer') {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=10, s-maxage=30, stale-while-revalidate=120');
    res.end(JSON.stringify({ league: '', season: 0, home: null, away: null, table: wantFull ? [] : undefined }));
    return;
  }

  const cacheKey = wantFull ? `fixture:standings:full:${idNum}` : `fixture:standings:${idNum}`;
  const data = await cached(cacheKey, 60_000, async () => {
    const fixtureUrl = `https://v3.football.api-sports.io/fixtures?id=${idNum}`;
    const fRes = await fetch(fixtureUrl, { headers: { 'x-apisports-key': String(apiKey) }, signal: AbortSignal.timeout(12000) });
    if (!fRes.ok) return null;
    const fData = await fRes.json().catch(() => null);
    const f = Array.isArray(fData?.response) && fData.response.length ? fData.response[0] : null;
    if (!f) return null;
    const leagueId = Number(f?.league?.id || 0);
    const season = Number(f?.league?.season || 0);
    const homeTeamId = Number(f?.teams?.home?.id || 0);
    const awayTeamId = Number(f?.teams?.away?.id || 0);
    const leagueName = String(f?.league?.name || '');
    if (!(leagueId > 0) || !(season > 0) || !(homeTeamId > 0) || !(awayTeamId > 0)) return null;

    const standingsUrl = `https://v3.football.api-sports.io/standings?league=${leagueId}&season=${season}`;
    const sRes = await fetch(standingsUrl, { headers: { 'x-apisports-key': String(apiKey) }, signal: AbortSignal.timeout(12000) });
    if (!sRes.ok) return null;
    const sData = await sRes.json().catch(() => null);
    const league = Array.isArray(sData?.response) && sData.response.length ? sData.response[0] : null;
    const table = league?.league?.standings;
    const rows: any[] = Array.isArray(table) && Array.isArray(table[0]) ? table[0] : (Array.isArray(table) ? table.flat() : []);
    const findRow = (teamId: number) => rows.find((r: any) => Number(r?.team?.id || 0) === teamId) || null;
    const h = findRow(homeTeamId);
    const a = findRow(awayTeamId);
    if (!h && !a) return null;

    const mappedRows = wantFull ? rows.map((r: any) => {
      const all = r?.all || {};
      const gf = Number(all?.goals?.for || 0);
      const ga = Number(all?.goals?.against || 0);
      const gd = Number(r?.goalsDiff ?? (gf - ga));
      return {
        rank: Number(r?.rank || 0),
        team: {
          id: Number(r?.team?.id || 0),
          name: String(r?.team?.name || ''),
          logo: String(r?.team?.logo || ''),
        },
        played: Number(all?.played || 0),
        win: Number(all?.win || 0),
        draw: Number(all?.draw || 0),
        lose: Number(all?.lose || 0),
        goals: `${gf}:${ga}`,
        goals_for: gf,
        goals_against: ga,
        goals_diff: gd,
        points: Number(r?.points || 0),
        form: String(r?.form || ''),
        description: r?.description ? String(r.description) : '',
      };
    }).filter((r: any) => r && r.rank > 0 && r.team?.name) : undefined;

    return {
      league: leagueName,
      season,
      home: { position: Number(h?.rank || 0), points: Number(h?.points || 0) },
      away: { position: Number(a?.rank || 0), points: Number(a?.points || 0) },
      ...(wantFull ? { table: mappedRows } : {}),
    };
  }).catch(() => null);

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=10, s-maxage=30, stale-while-revalidate=120');
  res.end(JSON.stringify(data || { league: '', season: 0, home: null, away: null, table: wantFull ? [] : undefined }));
}

async function paymentsIntentHandler(req: any, res: any) {
  try {
    const buf = await readBodyAsArrayBuffer(req);
    const raw = buf ? Buffer.from(new Uint8Array(buf)).toString('utf-8') : '';
    const body = raw ? JSON.parse(raw) : {};
    const amount = toNumber(body?.amount);
    if (!(amount >= 10)) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'min_amount_10' }));
      return;
    }
    const amountCents = Math.round(amount * 100);
    const stripe = getStripe();
    const intent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: 'eur',
      payment_method_types: ['card', 'mb_way', 'multibanco'],
      metadata: { purpose: 'deposit' },
    });
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ clientSecret: intent.client_secret }));
  } catch (e: any) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ error: e?.message || 'payment_intent_failed' }));
  }
}

async function walletPaymentIntentHandler(req: any, res: any, targetBase: string) {
  try {
    const auth = String(req.headers?.authorization || req.headers?.Authorization || '').trim();
    if (!auth.toLowerCase().startsWith('bearer ')) {
      res.statusCode = 401;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    const buf = await readBodyAsArrayBuffer(req);
    const raw = buf ? Buffer.from(new Uint8Array(buf)).toString('utf-8') : '';
    const body = raw ? JSON.parse(raw) : {};
    const amount = toNumber(body?.amount);
    const method = String(body?.method || '').trim();
    const allowed = new Set(['card', 'mb_way', 'multibanco']);
    if (!allowed.has(method)) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify({ error: 'invalid_method' }));
      return;
    }

    const meUrl = `${targetBase}/api/auth/me`;
    const me = await fetch(meUrl, { headers: { Authorization: auth }, signal: AbortSignal.timeout(12000) })
      .then(async (r) => (r.ok ? r.json() : null))
      .catch(() => null);
    const userId = String(me?.user?.id || me?.user?.userId || me?.id || me?.userId || '').trim();
    const isOperator =
      toNumber(me?.user?.is_operator ?? me?.is_operator ?? 0) > 0 ||
      String(me?.user?.role || me?.role || '').toLowerCase() === 'admin';
    if (!userId) {
      res.statusCode = 401;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    if (!isOperator && !(amount >= 10)) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify({ error: 'min_amount_10' }));
      return;
    }
    const stripe = getStripe();
    const intent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100),
      currency: 'eur',
      payment_method_types: [method] as any,
      metadata: { userId, purpose: 'deposit' },
    });

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ clientSecret: intent.client_secret }));
  } catch (e: any) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ error: e?.message || 'payment_intent_failed' }));
  }
}

async function paymentsWebhookStripeHandler(req: any, res: any, targetBase: string) {
  try {
    const sig = String(req.headers?.['stripe-signature'] || req.headers?.['Stripe-Signature'] || '').trim();
    const whSecret = String(process.env.STRIPE_WEBHOOK_SECRET || '').trim();
    if (!sig || !whSecret) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify({ error: 'missing_signature_or_secret' }));
      return;
    }

    const buf = await readBodyAsArrayBuffer(req);
    const body = buf ? Buffer.from(new Uint8Array(buf)) : Buffer.from('');
    const stripe = getStripe();
    const event = stripe.webhooks.constructEvent(body, sig, whSecret);

    const adminToken = String(process.env.ADMIN_TOKEN || '').trim();
    if (!adminToken) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify({ error: 'missing_admin_token' }));
      return;
    }
    const postCredit = async (payload: { userId: string; amount: number; reference: string; description: string; method?: string }) => {
      const url = `${targetBase}/api/wallet/admin/credit`;
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(12000),
      }).catch(() => null);
    };

    if (event.type === 'payment_intent.succeeded') {
      const pi: any = event.data.object;
      const userId = String(pi?.metadata?.userId || '').trim();
      const purpose = String(pi?.metadata?.purpose || '').trim();
      const amount = toNumber((pi?.amount_received ?? pi?.amount ?? 0) / 100);
      const method = Array.isArray(pi?.payment_method_types) ? String(pi.payment_method_types[0] || '') : '';
      if (purpose === 'deposit' && userId && amount > 0) {
        await postCredit({ userId, amount, reference: `DEPOSIT:stripe:${pi.id}`, description: 'Stripe Deposit', method });
      }
    }

    if (event.type === 'checkout.session.completed') {
      const s: any = event.data.object;
      const userId = String(s?.metadata?.userId || '').trim();
      const amount = toNumber((s?.amount_total ?? 0) / 100);
      const ref = `DEPOSIT:stripe:${s?.payment_intent || s?.id || ''}`;
      if (userId && amount > 0 && ref !== 'DEPOSIT:stripe:') {
        await postCredit({ userId, amount, reference: ref, description: 'Stripe Deposit' });
      }
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ received: true }));
  } catch (e: any) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ error: e?.message || 'webhook_error' }));
  }
}

export default async function handler(req: any, res: any) {
  const url = new URL(String(req.url || ''), 'http://localhost');
  const path = String(url.searchParams.get('path') || '').replace(/^\/+/, '');
  url.searchParams.delete('path');

  const targetBase = String(process.env.API_PROXY_BASE || 'https://bet62apostasesportivas.bet62.workers.dev').replace(/\/+$/, '');

  if (path.includes('paypal')) {
    res.statusCode = 410;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ error: 'paypal_removed' }));
    return;
  }

  if (path === 'debug/env') {
    const sk = String(process.env.STRIPE_SECRET_KEY || '').trim();
    const flags = {
      has_api_sports_key: Boolean(String(process.env.API_SPORTS_KEY || '').trim()),
      has_odds_api_key: Boolean(String(process.env.ODDS_API_KEY || '').trim()),
      has_odds_api_bookmakers: Boolean(String(process.env.ODDS_API_BOOKMAKERS || '').trim() || DEFAULT_ODDS_BOOKMAKERS),
      has_api_proxy_base: Boolean(String(process.env.API_PROXY_BASE || '').trim()),
      has_stripe_secret_key: Boolean(String(process.env.STRIPE_SECRET_KEY || '').trim()),
      has_stripe_webhook_secret: Boolean(String(process.env.STRIPE_WEBHOOK_SECRET || '').trim()),
      has_admin_token: Boolean(String(process.env.ADMIN_TOKEN || '').trim()),
      stripe_secret_mode: sk.startsWith('sk_live') ? 'live' : (sk.startsWith('sk_test') ? 'test' : ''),
    };
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(flags));
    return;
  }
  if (path === 'stripe/config') {
    const pk = String(process.env.STRIPE_PUBLISHABLE_KEY || '').trim();
    const sk = String(process.env.STRIPE_SECRET_KEY || '').trim();
    const mode = sk.startsWith('sk_live') ? 'live' : (sk.startsWith('sk_test') ? 'test' : '');
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ publishableKey: pk, mode }));
    return;
  }
  if (path === 'payments/intent') return paymentsIntentHandler(req, res);
  if (path === 'wallet/payment-intent') return walletPaymentIntentHandler(req, res, targetBase);
  if (path === 'payments/webhook/stripe') return paymentsWebhookStripeHandler(req, res, targetBase);
  if (path === 'sports') {
    const names = [
      'Futebol',
      'Basquetebol',
      'NBA',
      'Beisebol',
      'Futebol Americano',
      'Handebol',
      'Hóquei',
      'MMA',
      'Rúgbi',
      'Voleibol',
      'AFL',
      'Ténis',
      'Fórmula 1',
    ];
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=21600, stale-while-revalidate=86400');
    res.end(JSON.stringify(names));
    return;
  }
  if (path === 'live/stream') return liveStreamHandler(req, res);
  if (path === 'odds/stream') return oddsStreamHandler(req, res);
  if (path === 'events/by-sport') return eventsBySportHandler(url, req, res);
  if (path === 'events/media') return mediaProxyHandler(url, req, res);
  if (path.startsWith('events/')) {
    const parts = path.split('/');
    if (parts.length === 2) return eventByIdHandler(parts[1], res);
    if (parts.length === 3 && parts[2] === 'stats') return eventStatsHandler(parts[1], res);
    if (parts.length === 3 && parts[2] === 'standings') return fixturesStandingsHandler(parts[1], url, res);
    if (parts.length === 3 && parts[2] === 'lineups') return eventLineupsHandler(parts[1], res);
    if (parts.length === 3 && parts[2] === 'insights') return eventInsightsHandler(parts[1], res);
  }
  if (path === 'admin/flags') {
    const token = String(req.headers?.['x-admin-token'] || '').trim();
    const expected = String(process.env.ADMIN_BYPASS_TOKEN || '').trim();
    const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
    const isBypass = !isProd && Boolean(expected) && token === expected;
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ admin: isBypass }));
    return;
  }
  const restSearch = url.searchParams.toString();
  const targetUrl = `${targetBase}/api/${path}${restSearch ? `?${restSearch}` : ''}`;
  return proxyTo(req, res, targetUrl);
}
