/**
 * sportsApi.ts — Fetch puro para API-Sports (plano pago)
 * Sem estado, sem side-effects. Apenas fetch + normalização.
 *
 * Estratégia de odds (poupança de quota):
 *   - Live:      GET /odds/live           (1 chamada, retorna TUDO)
 *   - Pre-game:  GET /odds?date=&bookmaker=8&page=N  (1-5 páginas por dia)
 *   - Outros desportos: GET /odds?game=ID (quando disponível)
 */

export interface NormalizedEvent {
  external_event_id: string;
  sport:           string;
  league:          string;
  home_team:       string;
  away_team:       string;
  team_match:      string;
  event_date:      string;
  status:          string;
  is_live:         number;
  home_odd:        number;
  draw_odd:        number;
  away_odd:        number;
  elapsed:         number;
  score:           string;
  markets:         string;
  country:         string;
  home_team_logo:  string;
  away_team_logo:  string;
}

export interface OddsResult {
  home: number;
  draw: number;
  away: number;
  markets: Record<string, any[]>;
}

// ── API base URLs ─────────────────────────────────────────────────────
const API_FOOTBALL_BASE   = 'https://v3.football.api-sports.io';
const API_BASKETBALL_BASE = 'https://v1.basketball.api-sports.io';
const API_BASEBALL_BASE   = 'https://v1.baseball.api-sports.io';
const API_HOCKEY_BASE     = 'https://v1.hockey.api-sports.io';
const API_HANDBALL_BASE   = 'https://v1.handball.api-sports.io';
const API_VOLLEYBALL_BASE = 'https://v1.volleyball.api-sports.io';
const API_RUGBY_BASE      = 'https://v1.rugby.api-sports.io';
const API_NFL_BASE        = 'https://v1.american-football.api-sports.io';
const API_NBA_BASE        = 'https://v2.nba.api-sports.io';

export interface SportConfig {
  base:     string;
  endpoint: string;  // fixtures endpoint
  liveParam: string; // ?live=all or ?status=live
  dateParam: string; // ?date=YYYY-MM-DD or ?season=&date=
  oddsEndpoint?: string;
  fixtureKey: string; // 'fixture' | 'game' | 'id'
}

export const SPORT_CONFIG: Record<string, SportConfig> = {
  // Football: tem live=all + odds endpoints completos
  soccer:       { base: API_FOOTBALL_BASE,   endpoint: '/fixtures',  liveParam: 'live=all',  dateParam: 'date={DATE}&season=2025', oddsEndpoint: '/odds',  fixtureKey: 'fixture'  },
  // Basketball: não suporta live=all (usa date+status)
  basketball:   { base: API_BASKETBALL_BASE, endpoint: '/games',     liveParam: '',          dateParam: 'date={DATE}',             fixtureKey: 'game'     },
  baseball:     { base: API_BASEBALL_BASE,   endpoint: '/games',     liveParam: '',          dateParam: 'date={DATE}',             fixtureKey: 'game'     },
  'ice-hockey': { base: API_HOCKEY_BASE,     endpoint: '/games',     liveParam: '',          dateParam: 'date={DATE}',             fixtureKey: 'game'     },
  handball:     { base: API_HANDBALL_BASE,   endpoint: '/games',     liveParam: '',          dateParam: 'date={DATE}',             fixtureKey: 'game'     },
  volleyball:   { base: API_VOLLEYBALL_BASE, endpoint: '/games',     liveParam: '',          dateParam: 'date={DATE}',             fixtureKey: 'game'     },
  rugby:        { base: API_RUGBY_BASE,      endpoint: '/games',     liveParam: '',          dateParam: 'date={DATE}',             fixtureKey: 'game'     },
  nfl:          { base: API_NFL_BASE,        endpoint: '/games',     liveParam: '',          dateParam: 'date={DATE}&season=2025', fixtureKey: 'game'     },
  // NBA v2: season opcional no endpoint de games
  nba:          { base: API_NBA_BASE,        endpoint: '/games',     liveParam: '',          dateParam: 'date={DATE}',             fixtureKey: 'game'     },
};

// ── League Blocklist ──────────────────────────────────────────────────
const BLOCKED_KEYWORDS = [
  'women', 'woman', 'female', 'femenin', 'feminin', 'femenil', 'ladies', 'dames',
  'mulheres', 'feminino', ' w ', '(w)', '- w', 'frauen', 'féminin',
  'u16', 'u17', 'u18', 'u19', 'u20', 'u21', 'u22', 'u23',
  'under-16', 'under-17', 'under-18', 'under-19', 'under-20', 'under-21', 'under-23',
  'youth', 'junior', 'sub-17', 'sub-18', 'sub-20', 'sub-23',
  'reserve', 'reserva', 'reserves', 'filiali',
  'virtual', 'esport', 'e-sport', 'cyber', 'simulated', 'test league',
  'amateur', 'amador', 'regional', 'futsal', 'beach', 'indoor', 'sala',
  '5x5', '4x4', '3x3', 'setka', 'tt-cup', 'masters.',
  'student', 'university', 'college', 'school',
  'friendly', 'amistoso', 'cup alagoas', 'copa alagoas',
];

const BLOCKED_LEAGUES_EXACT = new Set([
  'Short Football', 'Division 4x4', 'Setka Cup', 'TT-Cup', 'Copa Alagoas',
  'UTR Pro Tennis Series', 'Masters. Belarus', 'Masters. Russia',
  'Test League', 'Test', 'Debug League',
]);

export function isBlockedLeague(name: string): boolean {
  if (BLOCKED_LEAGUES_EXACT.has(name)) return true;
  const lower = name.toLowerCase();
  for (const kw of BLOCKED_KEYWORDS) {
    if (lower.includes(kw)) return true;
  }
  return false;
}

// ── Top Leagues priority set ──────────────────────────────────────────
export const TOP_LEAGUES = new Set([
  // Football
  'UEFA Champions League', 'UEFA Europa League', 'UEFA Europa Conference League',
  'UEFA Nations League', 'World Cup', 'Copa America', 'European Championship',
  'African Cup of Nations', 'AFCON',
  'Premier League', 'La Liga', 'Bundesliga', 'Serie A', 'Ligue 1',
  'Primeira Liga', 'Eredivisie', 'Jupiler Pro League', 'Championship',
  'League One', 'League Two', 'Scottish Premiership', 'Super Lig',
  'Saudi Pro League', 'MLS', 'Brasileirao Série A', 'Primera División',
  'Liga MX', 'Copa del Rey', 'FA Cup', 'Coupe de France', 'DFB Pokal',
  // Basketball
  'NBA', 'EuroLeague', 'EuroCup', 'BBL', 'ACB', 'LNB', 'BNXT League',
  'EuroBasket', 'FIBA World Cup',
  // Ice Hockey
  'NHL', 'KHL', 'SHL', 'Liiga', 'DEL', 'ICE Hockey League',
  'IIHF World Championship',
  // Baseball
  'MLB', 'NPB',
  // Rugby
  'Rugby World Cup', 'Six Nations', 'Rugby Championship', 'Super Rugby',
  'Premiership Rugby', 'Top 14',
  // NFL
  'NFL', 'Super Bowl',
]);

// ── Finished statuses ────────────────────────────────────────────────
const FINISHED_STATUSES = new Set([
  'FT', 'AET', 'PEN', 'AWD', 'WO', 'ABD',
  'FT_PEN', 'AOT', 'AP', 'POST', 'SUSP', 'TBD',
  'Finished', 'Match Finished', 'Final', 'Ended', 'NS_CANC', 'CANC',
]);

// ── Live statuses ────────────────────────────────────────────────────
export const LIVE_STATUSES = new Set([
  '1H', '2H', 'HT', 'ET', 'P', 'BT', 'LIVE', 'IN_PROGRESS',
  'Q1', 'Q2', 'Q3', 'Q4', 'OT', 'OT1', 'OT2',
  'P1', 'P2', 'P3', 'S1', 'S2', 'S3', 'S4', 'S5',
  'IN', 'IN1', 'IN2', 'IN3', 'IN4', 'IN5', 'IN6', 'IN7', 'IN8', 'IN9',
]);

// ── Helpers ──────────────────────────────────────────────────────────
function apiHeaders(apiKey: string): HeadersInit {
  return {
    'x-apisports-key': apiKey,
    'x-rapidapi-key':  apiKey,
    'Accept': 'application/json',
  };
}

function extractStatusShort(fx: any): string {
  const s = fx?.status;
  if (!s) return 'NS';
  if (typeof s === 'string') return s;
  return s.short || s.long || 'NS';
}

function extractElapsed(fx: any): number {
  const s = fx?.status;
  if (!s || typeof s === 'string') return 0;
  return typeof s.elapsed === 'number' ? s.elapsed : 0;
}

function extractDate(fx: any): string | null {
  if (fx?.date) return fx.date;
  if (fx?.timestamp) return new Date(fx.timestamp * 1000).toISOString();
  return null;
}

export function extractOddsFromBets(bets: any[]): OddsResult {
  const result: OddsResult = { home: 0, draw: 0, away: 0, markets: {} };
  if (!Array.isArray(bets)) return result;

  for (const bet of bets) {
    const name: string = String(bet.name || '');
    const values: any[] = bet.values || bet.odds || [];
    const isMatchWinner =
      name === 'Match Winner' ||
      name === 'Home/Away' ||
      name === '1X2' ||
      name === '1x2' ||
      name === 'Match Result' ||
      name === 'Result' ||
      name === 'Fulltime Result' ||
      name === 'Full Time Result';

    const key = isMatchWinner ? 'h2h' : name;
    result.markets[key] = values;

    if (isMatchWinner) {
      for (const v of values) {
        const val = String(v.value || v.outcome || '').toLowerCase();
        const odd = parseFloat(v.odd ?? v.price ?? 0);
        // Only canonical 1X2 values — avoid "1"/"2" which clash with Total Goals market
        if      (val === 'home' || val === 'home win') result.home = odd;
        else if (val === 'draw' || val === 'x' || val === 'tie') result.draw = odd;
        else if (val === 'away' || val === 'away win') result.away = odd;
      }
    }
  }
  return result;
}

async function apiGet(url: string, apiKey: string): Promise<any> {
  try {
    const res = await fetch(url, {
      headers: apiHeaders(apiKey),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      console.error(`[sportsApi] HTTP ${res.status} → ${url}`);
      return null;
    }
    const data = await res.json() as any;
    if (data?.errors && Object.keys(data.errors).length > 0) {
      console.error('[sportsApi] API errors:', JSON.stringify(data.errors));
    }
    return data;
  } catch (e: any) {
    console.error(`[sportsApi] fetch failed (${url.split('?')[0]}):`, e?.message || e);
    return null;
  }
}

function normalizeFixture(raw: any, sport: string): NormalizedEvent | null {
  const fx     = raw.fixture || raw.game || raw;
  const teams  = raw.teams || {};
  const league = raw.league || raw.competition || {};

  const id = String(fx.id || raw.id || '');
  if (!id) return null;

  const homeName = teams.home?.name || teams.home || raw.home_team || '';
  const awayName = teams.away?.name || teams.away || raw.away_team || '';
  if (!homeName || !awayName) return null;

  const homeLogo = teams.home?.logo || teams.home?.image || '';
  const awayLogo = teams.away?.logo || teams.away?.image || '';

  const leagueName = league.name || raw.league_name || 'Unknown';
  if (isBlockedLeague(leagueName)) return null;

  const statusShort = extractStatusShort(fx);
  if (FINISHED_STATUSES.has(statusShort)) return null;

  const dateStr = extractDate(fx);
  if (!dateStr) return null;

  // Reject very old events (>3h ago) unless live
  const eventTime = new Date(dateStr).getTime();
  const now = Date.now();
  const isLiveStatus = LIVE_STATUSES.has(statusShort);
  if (!isLiveStatus && eventTime < now - 3 * 60 * 60 * 1000) return null;

  const elapsed = extractElapsed(fx);
  const goals   = raw.goals || {};

  return {
    external_event_id: `${sport}_${id}`,
    sport,
    league:     leagueName,
    home_team:  homeName,
    away_team:  awayName,
    team_match: `${homeName} vs ${awayName}`,
    event_date: dateStr,
    status:     statusShort,
    is_live:    isLiveStatus ? 1 : 0,
    home_odd:   0,
    draw_odd:   0,
    away_odd:   0,
    elapsed,
    score:      JSON.stringify({ home: goals.home ?? null, away: goals.away ?? null }),
    markets:    '{}',
    country:    league.country || league.nation || '',
    home_team_logo: homeLogo,
    away_team_logo: awayLogo,
  };
}

// ── Public: Live fixtures (NO odds — merge done in sportsSync) ───────
export async function fetchLiveFixtures(apiKey: string, sport: string): Promise<NormalizedEvent[]> {
  const cfg = SPORT_CONFIG[sport];
  if (!cfg || !cfg.liveParam) return []; // sport doesn't support live endpoint

  const data = await apiGet(`${cfg.base}${cfg.endpoint}?${cfg.liveParam}`, apiKey);
  if (!data?.response) return [];

  const events = (data.response as any[])
    .map(f => normalizeFixture(f, sport))
    .filter((e): e is NormalizedEvent => e !== null);

  // Sort: top leagues first, then elapsed desc
  return events.sort((a, b) => {
    const aTop = TOP_LEAGUES.has(a.league) ? 0 : 1;
    const bTop = TOP_LEAGUES.has(b.league) ? 0 : 1;
    if (aTop !== bTop) return aTop - bTop;
    return b.elapsed - a.elapsed;
  });
}

// ── Public: Scheduled fixtures for a date ────────────────────────────
export async function fetchDateFixtures(apiKey: string, sport: string, date: string): Promise<NormalizedEvent[]> {
  const cfg = SPORT_CONFIG[sport];
  if (!cfg) return [];

  const params = cfg.dateParam.replace('{DATE}', date);
  const data   = await apiGet(`${cfg.base}${cfg.endpoint}?${params}`, apiKey);
  if (!data?.response) return [];

  const events = (data.response as any[])
    .map(f => normalizeFixture(f, sport))
    .filter((e): e is NormalizedEvent => e !== null);

  return events.sort((a, b) => {
    const aTop = TOP_LEAGUES.has(a.league) ? 0 : 1;
    const bTop = TOP_LEAGUES.has(b.league) ? 0 : 1;
    if (aTop !== bTop) return aTop - bTop;
    return new Date(a.event_date).getTime() - new Date(b.event_date).getTime();
  });
}

// ── Public: Live odds (football paid: /odds/live) ────────────────────
export async function fetchLiveOdds(apiKey: string): Promise<Map<string, OddsResult>> {
  const map = new Map<string, OddsResult>();
  const data = await apiGet(`${API_FOOTBALL_BASE}/odds/live`, apiKey);
  if (!data?.response) return map;

  for (const entry of data.response as any[]) {
    const id = String(entry.fixture?.id || '');
    if (!id) continue;

    const oddsArr: any[] = entry.odds || [];

    // Find explicitly the Match Winner market by name
    const mw = oddsArr.find((o: any) => {
      const n = String(o.name || '').toLowerCase();
      return n === 'match winner' || n === 'home/away' || n === '1x2' ||
             n === 'match result' || n === 'result' || n === 'fulltime result';
    });
    if (!mw) continue;

    let home = 0, draw = 0, away = 0;
    for (const v of (mw.values || []) as any[]) {
      const val = String(v.value || '').toLowerCase();
      const odd = parseFloat(v.odd || 0);
      if (odd <= 1) continue;
      if      (val === 'home')  home  = home  || odd;
      else if (val === 'draw')  draw  = draw  || odd;
      else if (val === 'away')  away  = away  || odd;
    }

    if (home > 0) {
      map.set(id, { home, draw, away, markets: { h2h: mw.values || [] } });
    }
  }
  console.log(`[sportsApi] live odds: ${map.size} fixtures with Match Winner`);
  return map;
}

// ── Public: Pre-game odds by date (football paid: /odds?date=) ───────
// No bookmaker filter = max coverage from any available bookmaker
export async function fetchDayOdds(
  apiKey: string,
  date: string,
  _bookmaker = 0,  // ignored — fetch all bookmakers for best coverage
  maxPages  = 10,
): Promise<Map<string, OddsResult>> {
  const map = new Map<string, OddsResult>();

  for (let page = 1; page <= maxPages; page++) {
    const url  = `${API_FOOTBALL_BASE}/odds?date=${date}&page=${page}`;
    const data = await apiGet(url, apiKey);
    if (!data?.response?.length) break;

    for (const item of data.response as any[]) {
      const id = String(item.fixture?.id || '');
      if (!id || map.has(id)) continue;

      // Prioritize bookmaker 6 (1xBet), fall back to any available
      const bookmakers: any[] = item.bookmakers || [];
      const sorted = [
        ...bookmakers.filter((b: any) => b.id === 6),
        ...bookmakers.filter((b: any) => b.id !== 6),
      ];
      for (const bm of sorted) {
        const odds = extractOddsFromBets(bm.bets || []);
        if (odds.home > 0) {
          map.set(id, odds);
          break;
        }
      }
    }

    if (data.response.length < 10) break;
  }

  console.log(`[sportsApi] pre-game odds ${date}: ${map.size} fixtures`);
  return map;
}

// ── Util ──────────────────────────────────────────────────────────────
export function applyOdds(event: NormalizedEvent, oddsMap: Map<string, OddsResult>): NormalizedEvent {
  // Key is "soccer_12345" → extract raw ID for odds lookup
  const rawId = event.external_event_id.split('_').slice(1).join('_');
  const odds  = oddsMap.get(rawId);
  if (!odds || odds.home <= 0) return event;

  return {
    ...event,
    home_odd: odds.home,
    draw_odd: odds.draw,
    away_odd: odds.away,
    markets:  Object.keys(odds.markets).length > 0 ? JSON.stringify(odds.markets) : event.markets,
  };
}
