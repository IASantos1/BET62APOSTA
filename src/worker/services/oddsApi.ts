/**
 * oddsApi.ts — Fetch de odds via odds-api.io
 * Estratégia: 1 chamada /v3/odds por desporto (bulk) em vez de por evento.
 * Docs: https://docs.odds-api.io/
 */

const ODDS_API_BASE = 'https://api.odds-api.io/v3';

const SPORT_SLUG: Record<string, string> = {
  soccer:       'football',
  basketball:   'basketball',
  'ice-hockey': 'hockey',
  baseball:     'baseball',
};

export interface OddsEvent {
  id:          number | string;
  home:        string;
  away:        string;
  date:        string;
  home_odd:    number;
  draw_odd:    number;
  away_odd:    number;
  league_slug: string;
  league_name: string;
  sport_slug:  string;
}

function normTeam(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

function teamsMatch(a: string, b: string): boolean {
  const na = normTeam(a);
  const nb = normTeam(b);
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const wa = na.split(' ').filter(w => w.length > 3);
  const wb = nb.split(' ').filter(w => w.length > 3);
  return wa.length > 0 && wb.length > 0 && wa.some(w => wb.includes(w));
}

async function fetchJson(url: string): Promise<any> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`[oddsApi] HTTP ${res.status} → ${url.split('?')[0]} | ${body.slice(0, 200)}`);
      return null;
    }
    return await res.json();
  } catch (e: any) {
    console.error('[oddsApi] fetch error:', e?.message || e);
    return null;
  }
}

// Extrai a odd H2H (1X2 / moneyline) de um item de mercado
function extractOdds(outcomes: any[]): { home: number; draw: number; away: number } {
  let home = 0, draw = 0, away = 0;
  if (!Array.isArray(outcomes)) return { home, draw, away };
  for (const o of outcomes) {
    const name = String(o.name || o.label || o.outcome || '').toLowerCase();
    const price = parseFloat(o.price ?? o.odd ?? o.value ?? 0) || 0;
    if (price <= 1) continue;
    if (name === '1' || name === 'home' || name === 'homewin') home = home || price;
    else if (name === 'x' || name === 'draw' || name === 'tie') draw = draw || price;
    else if (name === '2' || name === 'away' || name === 'awaywin') away = away || price;
  }
  return { home, draw, away };
}

// Tenta extrair odds de um objecto event (vários formatos possíveis)
function parseEventOdds(ev: any): { home: number; draw: number; away: number } {
  // Formato 1: ev.odds.h2h = [1.85, 3.40, 4.20]
  if (ev.odds?.h2h && Array.isArray(ev.odds.h2h)) {
    const [h, d, a] = ev.odds.h2h;
    if (h > 1) return { home: h || 0, draw: d || 0, away: a || 0 };
  }
  // Formato 2: ev.bookmakers[].markets[].outcomes[]
  if (Array.isArray(ev.bookmakers)) {
    for (const bm of ev.bookmakers) {
      const markets = Array.isArray(bm.markets) ? bm.markets : Object.values(bm.markets || {});
      for (const m of markets as any[]) {
        const key = String(m.key || m.name || '').toLowerCase();
        if (!key.includes('1x2') && !key.includes('h2h') && !key.includes('match') && !key.includes('winner')) continue;
        const odds = extractOdds(m.outcomes || m.odds || []);
        if (odds.home > 1) return odds;
      }
    }
  }
  // Formato 3: ev.markets directamente
  if (ev.markets) {
    const ms = Array.isArray(ev.markets) ? ev.markets : Object.values(ev.markets);
    for (const m of ms as any[]) {
      const key = String(m.key || m.name || m.type || '').toLowerCase();
      if (!key.includes('1x2') && !key.includes('h2h') && !key.includes('match') && !key.includes('winner')) continue;
      const odds = extractOdds(m.outcomes || m.odds || m.selections || []);
      if (odds.home > 1) return odds;
    }
  }
  // Formato 4: campos directos ev.home_odd / ev.draw_odd / ev.away_odd
  if (ev.home_odd > 1) return { home: ev.home_odd, draw: ev.draw_odd || 0, away: ev.away_odd || 0 };

  return { home: 0, draw: 0, away: 0 };
}

/**
 * Fetcha eventos com odds da odds-api.io via chamada única por desporto.
 * Tenta vários endpoints para máxima compatibilidade.
 */
export async function fetchOddsApiEvents(apiKey: string, sport: string, daysAhead = 3): Promise<OddsEvent[]> {
  const slug = SPORT_SLUG[sport];
  if (!slug || !apiKey) return [];

  const now = new Date();
  const from = new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString();
  const to   = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000).toISOString();

  // Estratégia 1: /v3/odds bulk (todos os eventos de um desporto de uma vez)
  const oddsUrl = `${ODDS_API_BASE}/odds?apiKey=${apiKey}&sport=${slug}&status=pending,live&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=300`;
  let data = await fetchJson(oddsUrl);

  // Estratégia 2: /v3/events como fallback
  if (!Array.isArray(data) || data.length === 0) {
    const evUrl = `${ODDS_API_BASE}/events?apiKey=${apiKey}&sport=${slug}&status=pending,live&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=300`;
    data = await fetchJson(evUrl);
  }

  if (!Array.isArray(data)) {
    console.warn('[oddsApi] unexpected response format for', sport);
    return [];
  }

  console.log(`[oddsApi] ${sport}: ${data.length} raw records`);

  const results: OddsEvent[] = [];
  for (const ev of data) {
    const odds = parseEventOdds(ev);
    const home = ev.home_team || ev.home || ev.homeTeam || ev.home_name || '';
    const away = ev.away_team || ev.away || ev.awayTeam || ev.away_name || '';
    if (!home || !away) continue;

    results.push({
      id:          ev.id || ev.event_id || 0,
      home,
      away,
      date:        ev.commence_time || ev.date || ev.start_time || ev.scheduled || '',
      home_odd:    odds.home,
      draw_odd:    odds.draw,
      away_odd:    odds.away,
      league_slug: ev.league?.slug || ev.competition?.slug || ev.league_slug || '',
      league_name: ev.league?.name || ev.competition?.name || ev.league_name || ev.sport_title || '',
      sport_slug:  slug,
    });
  }

  const withOdds = results.filter(e => e.home_odd > 1).length;
  console.log(`[oddsApi] ${sport}: ${withOdds}/${results.length} events with odds`);
  return results;
}

export function buildOddsLookup(events: OddsEvent[]): Map<string, OddsEvent> {
  const map = new Map<string, OddsEvent>();
  for (const e of events) {
    const key = `${normTeam(e.home)}|${normTeam(e.away)}`;
    map.set(key, e);
  }
  return map;
}

export function lookupOdds(
  homeTeam: string,
  awayTeam: string,
  eventDate: string,
  oddsMap: Map<string, OddsEvent>,
): { home_odd: number; draw_odd: number; away_odd: number } | null {
  const key = `${normTeam(homeTeam)}|${normTeam(awayTeam)}`;
  const exact = oddsMap.get(key);
  if (exact) return { home_odd: exact.home_odd, draw_odd: exact.draw_odd, away_odd: exact.away_odd };

  const ts = new Date(eventDate).getTime();
  for (const ev of oddsMap.values()) {
    if (!teamsMatch(homeTeam, ev.home)) continue;
    if (!teamsMatch(awayTeam, ev.away)) continue;
    const evTs = new Date(ev.date).getTime();
    if (Math.abs(ts - evTs) < 4 * 60 * 60 * 1000) {
      return { home_odd: ev.home_odd, draw_odd: ev.draw_odd, away_odd: ev.away_odd };
    }
  }
  return null;
}
