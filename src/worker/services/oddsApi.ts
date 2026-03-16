/**
 * oddsApi.ts — Fetch de odds via odds-api.io
 * Estratégia: 1 chamada /v3/odds por desporto (bulk) em vez de por evento.
 * Docs: https://docs.odds-api.io/
 */

import { findBestCandidate } from './matching/matchEngine';
import type { Market, Selection } from '../../shared/types';

const ODDS_API_BASE = 'https://api.odds-api.io/v3';

const SPORT_SLUG: Record<string, string> = {
  soccer:       'football',
  basketball:   'basketball',
  'ice-hockey': 'hockey',
  baseball:     'baseball',
};

type BookmakerCatalog = {
  updatedAt: number;
  list: string[];
};

let bookmakerCatalog: BookmakerCatalog | null = null;
const lastFetchAtBySport = new Map<string, number>();
const fixtureOddsCache = new Map<string, { expiresAt: number; data: OddsMarketsResult }>();
const eventsCache = new Map<string, { expiresAt: number; data: any[] }>();

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
  markets?:    Market[];
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
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
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

function normKey(input: string): string {
  return String(input || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

async function getBookmakerList(apiKey: string): Promise<string[]> {
  const now = Date.now();
  if (bookmakerCatalog && now - bookmakerCatalog.updatedAt < 6 * 60 * 60 * 1000) {
    return bookmakerCatalog.list;
  }

  const url = `${ODDS_API_BASE}/bookmakers?apiKey=${apiKey}`;
  const data = await fetchJson(url);

  const list: string[] = [];
  if (Array.isArray(data)) {
    for (const item of data) {
      if (typeof item === 'string') list.push(item);
      else if (item && typeof item === 'object') {
        const v = (item as any).slug || (item as any).key || (item as any).name;
        if (v) list.push(String(v));
      }
    }
  }

  bookmakerCatalog = { updatedAt: now, list };
  return list;
}

async function resolveBookmakers(apiKey: string, requestedCsv: string): Promise<string> {
  const requested = String(requestedCsv || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (requested.length === 0) return '';

  const available = await getBookmakerList(apiKey);
  if (available.length === 0) return '';

  const byNorm = new Map<string, string>();
  for (const a of available) byNorm.set(normKey(a), a);

  const resolved: string[] = [];
  for (const r of requested) {
    const exact = byNorm.get(normKey(r));
    if (exact) {
      resolved.push(exact);
      continue;
    }

    const rk = normKey(r);
    const partial = available.find((a) => normKey(a).includes(rk) || rk.includes(normKey(a)));
    if (partial) resolved.push(partial);
  }

  return Array.from(new Set(resolved)).join(',');
}

function toMarketKey(name: string): string {
  const n = String(name || '').toLowerCase();
  if (n === 'ml' || n.includes('moneyline') || n.includes('match winner') || n.includes('1x2') || n.includes('h2h') || n.includes('result')) return 'h2h';
  if (n.includes('double chance')) return 'double_chance';
  if (n.includes('draw no bet')) return 'dnb';
  if (n.includes('both teams to score')) return 'btts';
  if (n.includes('spread') || n.includes('handicap')) return 'handicap';
  if (n.includes('totals') || n.includes('goals over/under') || n.includes('over/under')) return 'totals';
  if (n.includes('half time') && (n.includes('result') || n.includes('ml'))) return 'h2h_ht';
  if (n.includes('totals ht')) return 'totals_ht';
  return `special_${normKey(n).slice(0, 32) || 'misc'}`;
}

function toMarketName(key: string, rawName: string): string {
  if (key === 'h2h') return 'Resultado Final';
  if (key === 'double_chance') return 'Dupla Chance';
  if (key === 'dnb') return 'Empate Anula';
  if (key === 'btts') return 'Ambas Marcam';
  if (key === 'handicap') return 'Handicap';
  if (key === 'totals') return 'Totais';
  if (key === 'h2h_ht') return 'Resultado 1ª Parte';
  if (key === 'totals_ht') return 'Totais 1ª Parte';
  return rawName || key;
}

function pickNum(v: any): number {
  const n = typeof v === 'string' ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function pushSel(list: Selection[], id: string, label: string, odd: number): void {
  if (!(odd > 1)) return;
  list.push({ id, label, odd });
}

function payloadToMarkets(payload: any, resolvedBooks: string): Market[] {
  const outByKey = new Map<string, Market>();
  const limitPerMarket = 80;

  const books = resolvedBooks
    ? resolvedBooks.split(',').map((s) => s.trim()).filter(Boolean)
    : Object.keys(payload?.bookmakers || {});

  const bmObj = payload?.bookmakers || {};
  const bmKeys = Object.keys(bmObj);

  const getBookArr = (book: string) => {
    if (Array.isArray(bmObj?.[book])) return bmObj[book];
    const norm = normKey(book);
    const alt = bmKeys.find((k) => normKey(k) === norm);
    if (alt && Array.isArray(bmObj?.[alt])) return bmObj[alt];
    return null;
  };

  for (const book of books) {
    const arr = getBookArr(book);
    if (!arr) continue;

    for (const m of arr) {
      const rawName = String(m?.name || m?.key || '');
      const key = toMarketKey(rawName);
      if (!outByKey.has(key)) {
        outByKey.set(key, { id: `mkt_${key}`, key, name: toMarketName(key, rawName), selections: [] });
      }

      const market = outByKey.get(key)!;
      if (market.selections.length >= limitPerMarket) continue;

      if (key === 'h2h' || key === 'h2h_ht') {
        const o = Array.isArray(m?.odds) && m.odds.length ? m.odds[0] : null;
        if (o) {
          pushSel(market.selections, 'sel_home', 'Casa', pickNum(o.home));
          pushSel(market.selections, 'sel_draw', 'Empate', pickNum(o.draw));
          pushSel(market.selections, 'sel_away', 'Fora', pickNum(o.away));
        }
      } else if (key === 'double_chance') {
        const o = Array.isArray(m?.odds) && m.odds.length ? m.odds[0] : null;
        if (o) {
          pushSel(market.selections, 'sel_1x', '1X', pickNum(o['1X'] ?? o['1x'] ?? o['1x2'] ?? o['1X2']));
          pushSel(market.selections, 'sel_x2', 'X2', pickNum(o['X2'] ?? o['x2']));
          pushSel(market.selections, 'sel_12', '12', pickNum(o['12']));
        }
      } else if (key === 'dnb') {
        const o = Array.isArray(m?.odds) && m.odds.length ? m.odds[0] : null;
        if (o) {
          pushSel(market.selections, 'sel_home', 'Casa', pickNum(o.home));
          pushSel(market.selections, 'sel_away', 'Fora', pickNum(o.away));
        }
      } else if (key === 'btts') {
        const o = Array.isArray(m?.odds) && m.odds.length ? m.odds[0] : null;
        if (o) {
          pushSel(market.selections, 'sel_yes', 'Sim', pickNum(o.yes));
          pushSel(market.selections, 'sel_no', 'Não', pickNum(o.no));
        }
      } else if (key === 'totals' || key === 'totals_ht') {
        if (Array.isArray(m?.odds)) {
          for (const line of m.odds) {
            if (market.selections.length >= limitPerMarket) break;
            const point = line?.hdp;
            const over = pickNum(line?.over);
            const under = pickNum(line?.under);
            if (point !== undefined && (over > 1 || under > 1)) {
              pushSel(market.selections, `sel_over_${point}`, `Over ${point}`, over);
              pushSel(market.selections, `sel_under_${point}`, `Under ${point}`, under);
            }
          }
        }
      } else if (key === 'handicap') {
        if (Array.isArray(m?.odds)) {
          for (const line of m.odds) {
            if (market.selections.length >= limitPerMarket) break;
            const point = line?.hdp;
            const h = pickNum(line?.home);
            const a = pickNum(line?.away);
            if (point !== undefined && (h > 1 || a > 1)) {
              pushSel(market.selections, `sel_home_${point}`, `Casa ${point}`, h);
              pushSel(market.selections, `sel_away_${point}`, `Fora ${point}`, a);
            }
          }
        }
      } else {
        if (Array.isArray(m?.odds)) {
          for (const o of m.odds) {
            if (market.selections.length >= limitPerMarket) break;
            const label = String(o?.label || o?.name || o?.outcome || o?.selection || '').trim();
            const price =
              pickNum(o?.price) ||
              pickNum(o?.odd) ||
              pickNum(o?.value) ||
              pickNum(o?.under) ||
              pickNum(o?.over) ||
              pickNum(o?.home) ||
              pickNum(o?.away);
            if (label && price > 1) pushSel(market.selections, `sel_${normKey(label).slice(0, 24)}`, label, price);
          }
        }
      }
    }
  }

  return Array.from(outByKey.values()).filter((m) => m.selections.length > 0);
}

function marketsToPrimary(markets: Market[]): { home: number; draw: number; away: number } {
  const m = markets.find((x) => x.key === 'h2h');
  if (!m) return { home: 0, draw: 0, away: 0 };
  const pick = (lbl: string) => m.selections.find((s) => String(s.label).toLowerCase() === lbl)?.odd || 0;
  return { home: pick('casa'), draw: pick('empate'), away: pick('fora') };
}

export type OddsMarketsResult = {
  home_odd: number;
  draw_odd: number;
  away_odd: number;
  markets: Record<string, any[]>;
  updated_at: string;
  provider: 'odds-api.io';
};

function payloadToLegacyMarkets(payload: any, resolvedBooks: string): { markets: Record<string, any[]>; primary: { home: number; draw: number; away: number } } {
  const result: Record<string, any[]> = {};
  const mk = (k: string) => {
    if (!result[k]) result[k] = [];
    return result[k];
  };

  const markets = payloadToMarkets(payload, resolvedBooks);
  const primary = marketsToPrimary(markets);

  for (const m of markets) {
    const k = m.key;
    const arr = mk(k);
    for (const s of m.selections) {
      if (arr.length >= 120) break;
      arr.push({ name: s.label, label: s.label, price: s.odd, odd: s.odd });
    }
  }

  return { markets: result, primary };
}

async function runPool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let idx = 0;

  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (idx < items.length) {
      const current = idx++;
      const out = await fn(items[current]);
      results[current] = out;
    }
  });

  await Promise.all(workers);
  return results;
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

function parseOddsResponse(payload: any): { home: number; draw: number; away: number } {
  if (!payload) return { home: 0, draw: 0, away: 0 };
  const direct = parseEventOdds(payload);
  if (direct.home > 1) return direct;

  const parseMlEntry = (o: any) => {
    const h = parseFloat(o?.home ?? o?.Home ?? o?.['1'] ?? o?.one ?? 0) || 0;
    const d = parseFloat(o?.draw ?? o?.Draw ?? o?.['X'] ?? o?.x ?? 0) || 0;
    const a = parseFloat(o?.away ?? o?.Away ?? o?.['2'] ?? o?.two ?? 0) || 0;
    return { home: h, draw: d, away: a };
  };

  const bookmakers = payload.bookmakers;
  if (bookmakers && typeof bookmakers === 'object') {
    for (const v of Object.values(bookmakers)) {
      if (!Array.isArray(v)) continue;
      for (const m of v as any[]) {
        const name = String(m?.name || m?.key || '').toLowerCase();
        if (name.includes('ml') || name.includes('moneyline') || name.includes('1x2') || name.includes('h2h') || name.includes('match')) {
          if (Array.isArray(m?.odds) && m.odds.length > 0) {
            const o = parseMlEntry(m.odds[0]);
            if (o.home > 1) return o;
          }
        }
        const odds = parseEventOdds(m);
        if (odds.home > 1) return odds;
      }
    }
  }

  return { home: 0, draw: 0, away: 0 };
}

/**
 * Fetcha eventos com odds da odds-api.io via chamada única por desporto.
 * Tenta vários endpoints para máxima compatibilidade.
 */
export async function fetchOddsApiEvents(
  apiKey: string,
  sport: string,
  daysAhead = 3,
  bookmakersCsv = '',
  statusCsv = 'pending,live',
  maxEvents = 30,
  concurrency = 3,
): Promise<OddsEvent[]> {
  const slug = SPORT_SLUG[sport];
  if (!slug || !apiKey) return [];

  const nowMs = Date.now();
  const last = lastFetchAtBySport.get(slug) || 0;
  if (nowMs - last < 10_000) return [];
  lastFetchAtBySport.set(slug, nowMs);

  const now = new Date();
  const from = new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString();
  const to   = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000).toISOString();

  const resolvedBooks = await resolveBookmakers(apiKey, bookmakersCsv);
  const firstBook = resolvedBooks ? resolvedBooks.split(',')[0].trim() : '';
  const bookmakerParam = firstBook ? `&bookmaker=${encodeURIComponent(firstBook)}` : '';
  const cacheKey = `${slug}|${statusCsv}|${firstBook}|${from.slice(0, 13)}|${to.slice(0, 13)}`;
  const cached = eventsCache.get(cacheKey);
  const data = cached && cached.expiresAt > nowMs
    ? cached.data
    : await fetchJson(`${ODDS_API_BASE}/events?apiKey=${apiKey}&sport=${slug}&status=${encodeURIComponent(statusCsv)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=300${bookmakerParam}`);
  if (!cached || cached.expiresAt <= nowMs) {
    if (Array.isArray(data)) eventsCache.set(cacheKey, { expiresAt: nowMs + 10_000, data });
  }
  if (!Array.isArray(data)) return [];

  const baseEvents = data
    .map((ev: any) => {
      const id = ev.id ?? ev.eventId ?? ev.event_id ?? ev.fixtureId ?? ev.fixture_id ?? null;
      const home = ev.home_team || ev.home || ev.homeTeam || ev.home_name || '';
      const away = ev.away_team || ev.away || ev.awayTeam || ev.away_name || '';
      const date = ev.commence_time || ev.date || ev.start_time || ev.scheduled || '';
      const leagueSlug = ev.league?.slug || ev.competition?.slug || ev.league_slug || '';
      const leagueName = ev.league?.name || ev.competition?.name || ev.league_name || ev.sport_title || '';
      if (!id || !home || !away || !date) return null;
      return { id: String(id), home, away, date, leagueSlug, leagueName };
    })
    .filter(Boolean) as Array<{ id: string; home: string; away: string; date: string; leagueSlug: string; leagueName: string }>;

  const picked = baseEvents.slice(0, Math.max(1, maxEvents));

  const oddsPayloads = await runPool(picked, Math.max(1, concurrency), async (ev) => {
    const books = resolvedBooks ? `&bookmakers=${encodeURIComponent(resolvedBooks)}` : '';
    const url = `${ODDS_API_BASE}/odds?apiKey=${apiKey}&eventId=${encodeURIComponent(ev.id)}${books}`;
    const payload = await fetchJson(url);
    return { ev, payload };
  });

  const results: OddsEvent[] = [];
  for (const item of oddsPayloads) {
    const odds = parseOddsResponse(item.payload);
    const markets = item.payload ? payloadToMarkets(item.payload, resolvedBooks) : [];
    results.push({
      id: item.ev.id,
      home: item.ev.home,
      away: item.ev.away,
      date: item.ev.date,
      home_odd: odds.home,
      draw_odd: odds.draw,
      away_odd: odds.away,
      league_slug: item.ev.leagueSlug,
      league_name: item.ev.leagueName,
      sport_slug: slug,
      markets,
    });
  }

  const withOdds = results.filter((e) => e.home_odd > 1).length;
  console.log(`[oddsApi] ${sport}: ${withOdds}/${results.length} odds resolved`);
  return results;
}

export function matchOddsEvent(
  fixture: { league: string; home: string; away: string; kickoff: string },
  oddsEvents: OddsEvent[],
  minScore: number = 80,
): OddsEvent | null {
  if (!oddsEvents.length) return null;

  const candidates = oddsEvents.map((e) => ({
    item: e,
    league: e.league_name || e.league_slug || '',
    home: e.home,
    away: e.away,
    kickoff: e.date,
  }));

  const best = findBestCandidate(
    {
      league: fixture.league,
      home: fixture.home,
      away: fixture.away,
      kickoff: fixture.kickoff,
    },
    candidates,
    minScore,
  );

  return best ? best.item : null;
}

export async function fetchOddsApiMarketsForFixture(
  apiKey: string,
  fixture: { league: string; home: string; away: string; kickoff: string; sport?: string },
  bookmakersCsv: string,
  statusCsv: string = 'pending,live',
): Promise<OddsMarketsResult | null> {
  const slug = SPORT_SLUG[fixture.sport || 'soccer'] || 'football';
  const cacheKey = `${slug}|${normTeam(fixture.home)}|${normTeam(fixture.away)}|${String(fixture.kickoff || '').slice(0, 16)}|${statusCsv}`;
  const nowMs = Date.now();
  const cached = fixtureOddsCache.get(cacheKey);
  if (cached && cached.expiresAt > nowMs) return cached.data;

  const resolvedBooks = await resolveBookmakers(apiKey, bookmakersCsv);
  const firstBook = resolvedBooks ? resolvedBooks.split(',')[0].trim() : '';
  const bookmakerParam = firstBook ? `&bookmaker=${encodeURIComponent(firstBook)}` : '';

  const now = new Date();
  const from = new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString();
  const to = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString();

  const listKey = `${slug}|${statusCsv}|${firstBook}|${from.slice(0, 13)}|${to.slice(0, 13)}`;
  const listCached = eventsCache.get(listKey);
  const events = listCached && listCached.expiresAt > nowMs
    ? listCached.data
    : await fetchJson(`${ODDS_API_BASE}/events?apiKey=${apiKey}&sport=${slug}&status=${encodeURIComponent(statusCsv)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=300${bookmakerParam}`);
  if (Array.isArray(events)) eventsCache.set(listKey, { expiresAt: nowMs + 10_000, data: events });
  if (!Array.isArray(events) || events.length === 0) return null;

  const candidates = events
    .map((ev: any) => {
      const id = ev.id ?? ev.eventId ?? ev.event_id ?? ev.fixtureId ?? ev.fixture_id ?? null;
      const home = ev.home_team || ev.home || ev.homeTeam || ev.home_name || '';
      const away = ev.away_team || ev.away || ev.awayTeam || ev.away_name || '';
      const date = ev.commence_time || ev.date || ev.start_time || ev.scheduled || '';
      const leagueName = ev.league?.name || ev.competition?.name || ev.league_name || ev.sport_title || '';
      if (!id || !home || !away || !date) return null;
      return { id: String(id), home, away, date, leagueName };
    })
    .filter(Boolean) as Array<{ id: string; home: string; away: string; date: string; leagueName: string }>;

  const best = findBestCandidate(
    { league: fixture.league, home: fixture.home, away: fixture.away, kickoff: fixture.kickoff },
    candidates.map((c) => ({ item: c, league: c.leagueName, home: c.home, away: c.away, kickoff: c.date })),
    70,
  );
  if (!best) return null;

  const books = resolvedBooks ? `&bookmakers=${encodeURIComponent(resolvedBooks)}` : '';
  const payload = await fetchJson(`${ODDS_API_BASE}/odds?apiKey=${apiKey}&eventId=${encodeURIComponent(best.item.id)}${books}`);
  if (!payload) return null;

  const { markets, primary } = payloadToLegacyMarkets(payload, resolvedBooks);
  const data: OddsMarketsResult = {
    home_odd: primary.home,
    draw_odd: primary.draw,
    away_odd: primary.away,
    markets,
    updated_at: new Date().toISOString(),
    provider: 'odds-api.io',
  };

  fixtureOddsCache.set(cacheKey, { expiresAt: nowMs + 10_000, data });
  return data;
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
