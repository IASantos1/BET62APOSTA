import type http from 'http';
import { sendJson } from '../lib/http';

const API_FOOTBALL_ENDPOINTS: Record<string, string> = {
  football: 'https://v3.football.api-sports.io',
  basketball: 'https://v1.basketball.api-sports.io',
  baseball: 'https://v1.baseball.api-sports.io',
  hockey: 'https://v1.hockey.api-sports.io',
  rugby: 'https://v1.rugby.api-sports.io',
  volleyball: 'https://v1.volleyball.api-sports.io',
  formula1: 'https://v1.formula-1.api-sports.io',
  mma: 'https://v1.mma.api-sports.io',
  handball: 'https://v1.handball.api-sports.io',
  nfl: 'https://v1.american-football.api-sports.io',
  afl: 'https://v1.afl.api-sports.io',
};

const rateLimiters: Record<string, { count: number; resetTime: number }> = {};

function checkRateLimit(sport: string): { allowed: boolean; remaining: number; resetIn: number } {
  const now = Date.now();
  const LIMIT_PER_MINUTE = 1200;
  const WINDOW_MS = 60 * 1000;

  if (!rateLimiters[sport]) {
    rateLimiters[sport] = { count: 0, resetTime: now + WINDOW_MS };
  }

  const limiter = rateLimiters[sport];
  if (now >= limiter.resetTime) {
    limiter.count = 0;
    limiter.resetTime = now + WINDOW_MS;
  }

  if (limiter.count >= LIMIT_PER_MINUTE) {
    return { allowed: false, remaining: 0, resetIn: Math.ceil((limiter.resetTime - now) / 1000) };
  }

  limiter.count++;
  return { allowed: true, remaining: LIMIT_PER_MINUTE - limiter.count, resetIn: Math.ceil((limiter.resetTime - now) / 1000) };
}

async function handleApiFootballProxy(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
  const apiKey = process.env.API_FOOTBALL_KEY || process.env.VITE_API_FOOTBALL_KEY || '';
  const sport = url.searchParams.get('sport');
  const endpoint = url.searchParams.get('endpoint');

  if (!sport || !endpoint) {
    sendJson(res, 400, { error: 'Parâmetros sport e endpoint são obrigatórios' });
    return;
  }

  if (!API_FOOTBALL_ENDPOINTS[sport]) {
    sendJson(res, 400, { error: `Desporto não suportado: ${sport}` });
    return;
  }

  const rateLimit = checkRateLimit(sport);
  if (!rateLimit.allowed) {
    res.setHeader('X-RateLimit-Limit', '1200');
    res.setHeader('X-RateLimit-Remaining', '0');
    res.setHeader('X-RateLimit-Reset', String(rateLimit.resetIn));
    res.setHeader('Retry-After', String(rateLimit.resetIn));
    sendJson(res, 429, {
      error: 'Rate limit excedido',
      sport,
      message: `Limite de 1200 requisições/minuto para ${sport} excedido`,
      resetIn: rateLimit.resetIn,
    });
    return;
  }

  if (!apiKey) {
    sendJson(res, 500, { error: 'API_FOOTBALL_KEY não configurada' });
    return;
  }

  const baseUrl = API_FOOTBALL_ENDPOINTS[sport];
  const apiUrl = new URL(`${baseUrl}/${endpoint}`);

  url.searchParams.forEach((value, key) => {
    if (key !== 'sport' && key !== 'endpoint') {
      apiUrl.searchParams.append(key, value);
    }
  });

  try {
    const response = await fetch(apiUrl.toString(), {
      headers: { 'x-apisports-key': apiKey },
    });

    if (!response.ok) {
      const errorText = await response.text();
      sendJson(res, response.status, { error: `API-Football retornou erro: ${response.status}`, details: errorText });
      return;
    }

    const data = await response.json();

    if (data.errors && Object.keys(data.errors).length > 0) {
      sendJson(res, 400, { error: 'API-Football retornou erro', details: data.errors });
      return;
    }

    res.setHeader('X-RateLimit-Limit', '1200');
    res.setHeader('X-RateLimit-Remaining', String(rateLimit.remaining));
    res.setHeader('X-RateLimit-Reset', String(rateLimit.resetIn));
    sendJson(res, 200, data);
  } catch (error: any) {
    sendJson(res, 500, { error: 'Erro ao chamar API-Football', details: error?.message || 'Erro desconhecido' });
  }
}

const ODDS_SPORT_MAP: Record<string, string> = {
  soccer: 'soccer',
  football: 'soccer',
  soccer_epl: 'soccer_epl',
  soccer_spain_la_liga: 'soccer_spain_la_liga',
  soccer_germany_bundesliga: 'soccer_germany_bundesliga',
  soccer_italy_serie_a: 'soccer_italy_serie_a',
  soccer_france_ligue_one: 'soccer_france_ligue_one',
  soccer_uefa_champs_league: 'soccer_uefa_champs_league',
  soccer_brazil_campeonato: 'soccer_brazil_campeonato',
  soccer_portugal_primeira_liga: 'soccer_portugal_primeira_liga',
  basketball: 'basketball_nba',
  basketball_nba: 'basketball_nba',
  basketball_euroleague: 'basketball_euroleague',
  'ice-hockey': 'icehockey_nhl',
  icehockey: 'icehockey_nhl',
  hockey: 'icehockey_nhl',
  nhl: 'icehockey_nhl',
  icehockey_nhl: 'icehockey_nhl',
  baseball: 'baseball_mlb',
  baseball_mlb: 'baseball_mlb',
  mlb: 'baseball_mlb',
  rugby: 'rugbyleague_nrl',
  'rugby-league': 'rugbyleague_nrl',
  mma: 'mma_mixed_martial_arts',
  ufc: 'mma_mixed_martial_arts',
  handball: 'handball_germany_bundesliga',
  afl: 'aussierules_afl',
  aussierules_afl: 'aussierules_afl',
  volleyball: 'volleyball_brazil_superliga',
};

function mapOddsSport(sport: string | null): string | null {
  if (!sport) return null;
  const normalized = sport.toLowerCase().trim();
  if (ODDS_SPORT_MAP[normalized]) return ODDS_SPORT_MAP[normalized];
  const clean = normalized.replace(/[-_\s]/g, '');
  for (const [key, value] of Object.entries(ODDS_SPORT_MAP)) {
    if (key.replace(/[-_\s]/g, '') === clean) return value;
  }
  if (clean.includes('ice') || clean.includes('hockey')) return 'icehockey_nhl';
  if (clean.includes('basket') || clean === 'nba') return 'basketball_nba';
  if (clean.includes('soccer') || clean.includes('football')) return 'soccer';
  if (clean.includes('mma') || clean.includes('ufc')) return 'mma_mixed_martial_arts';
  if (clean.includes('rugby')) return 'rugbyleague_nrl';
  return sport;
}

async function handleOddsApiProxy(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
  const oddsApiKey = process.env.THE_ODDS_API_KEY || process.env.VITE_THE_ODDS_API_KEY || '';
  const endpoint = url.searchParams.get('endpoint');
  const sport = url.searchParams.get('sport');

  if (!endpoint) {
    sendJson(res, 400, { error: 'Endpoint parameter is required' });
    return;
  }

  if (!oddsApiKey) {
    sendJson(res, 500, { error: 'THE_ODDS_API_KEY not configured' });
    return;
  }

  const mappedSport = mapOddsSport(sport);
  const apiUrl = new URL(`https://api.the-odds-api.com/v4${endpoint}`);
  apiUrl.searchParams.append('apiKey', oddsApiKey);

  url.searchParams.forEach((value, key) => {
    if (key !== 'endpoint') {
      if (key === 'sport' && mappedSport) {
        apiUrl.searchParams.append(key, mappedSport);
      } else {
        apiUrl.searchParams.append(key, value);
      }
    }
  });

  try {
    const response = await fetch(apiUrl.toString(), { headers: { Accept: 'application/json' } });
    const remainingRequests = response.headers.get('x-requests-remaining');
    const usedRequests = response.headers.get('x-requests-used');

    if (!response.ok) {
      const errorText = await response.text();
      if (response.status === 429) {
        sendJson(res, 429, { error: 'Rate limit exceeded', rateLimit: true, details: errorText });
        return;
      }
      sendJson(res, response.status, { error: `The Odds API returned error: ${response.status}`, details: errorText });
      return;
    }

    const data = await response.json();
    if (remainingRequests) res.setHeader('x-requests-remaining', remainingRequests);
    if (usedRequests) res.setHeader('x-requests-used', usedRequests);
    sendJson(res, 200, data);
  } catch (error: any) {
    sendJson(res, 500, { error: 'Error calling The Odds API', details: error?.message || 'Unknown error' });
  }
}

export async function handleSportsRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
): Promise<boolean> {
  const path = url.pathname;

  if (path === '/api/sports/api-football-proxy' && req.method === 'GET') {
    await handleApiFootballProxy(req, res, url);
    return true;
  }

  if (path === '/api/sports/odds-api-proxy' && req.method === 'GET') {
    await handleOddsApiProxy(req, res, url);
    return true;
  }

  return false;
}
