#!/usr/bin/env node
/**
 * odds-proxy.mjs — Local enrichment proxy (port 8080)
 *
 * Strategy:
 *   1. Try CF Worker for event list
 *   2. If CF Worker fails/empty → build events DIRECTLY from odds-api.io
 *   3. Enrich all events with real odds from odds-api.io
 *
 * Bookmakers: auto-resets every 12h to preferred list
 */

import http  from 'http';
import https from 'https';
import fs    from 'fs';
import path  from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLEAR_TS_FILE = path.join(__dirname, '.last_bm_clear');

const CF_WORKER    = 'https://bet62apostasesportivas.bet62.workers.dev';
const PORT         = 8080;
const ODDS_API_KEY = process.env.ODDS_API_KEY || '';
const ODDS_API_BASE = 'https://api.odds-api.io/v3';

// Preferred bookmakers (after clear)
const PREFERRED_BM  = 'Bet365,Betano,Unibet,Superbet,Betfair Sportsbook';
// Fallback bookmakers (currently registered — used until next clear succeeds)
let BOOKMAKERS_CSV  = process.env.ODDS_API_BOOKMAKERS || PREFERRED_BM;

if (!ODDS_API_KEY) console.warn('[proxy] WARNING: ODDS_API_KEY not set');
else console.log(`[proxy] ODDS_API_KEY: ✓ set`);

// ── Bookmaker auto-reset (once per 12h) ────────────────────────────────────
async function tryResetBookmakers() {
  if (!ODDS_API_KEY) return;
  try {
    // Read last clear timestamp from file
    let lastClear = 0;
    try { lastClear = parseInt(fs.readFileSync(CLEAR_TS_FILE, 'utf8').trim()) || 0; } catch {}
    const twelveHours = 12 * 3600_000;
    if (Date.now() - lastClear < twelveHours) {
      const remaining = Math.ceil((twelveHours - (Date.now() - lastClear)) / 60_000);
      console.log(`[proxy] Bookmakers reset available in ${remaining}m — using current selection`);
      // Check what's currently selected
      const r = await fetch(`${ODDS_API_BASE}/bookmakers/selected?apiKey=${ODDS_API_KEY}`, { signal: AbortSignal.timeout(6000) });
      const j = await r.json().catch(() => ({}));
      const current = Array.isArray(j?.bookmakers) ? j.bookmakers.join(',') : PREFERRED_BM;
      BOOKMAKERS_CSV = current;
      console.log(`[proxy] Active bookmakers: ${BOOKMAKERS_CSV}`);
      return;
    }
    // Try to clear
    const r = await fetch(`${ODDS_API_BASE}/bookmakers/selected/clear?apiKey=${ODDS_API_KEY}`, { method: 'PUT', signal: AbortSignal.timeout(8000) });
    const j = await r.json().catch(() => ({}));
    if (r.ok) {
      fs.writeFileSync(CLEAR_TS_FILE, String(Date.now()));
      BOOKMAKERS_CSV = PREFERRED_BM;
      console.log(`[proxy] Bookmakers reset ✓ → ${BOOKMAKERS_CSV}`);
    } else {
      // Rate limited — read current selection
      console.warn(`[proxy] Bookmakers reset blocked: ${j?.error?.slice(0,100)}`);
      const r2 = await fetch(`${ODDS_API_BASE}/bookmakers/selected?apiKey=${ODDS_API_KEY}`, { signal: AbortSignal.timeout(6000) });
      const j2 = await r2.json().catch(() => ({}));
      const current = Array.isArray(j2?.bookmakers) ? j2.bookmakers.join(',') : PREFERRED_BM;
      BOOKMAKERS_CSV = current;
      // Write the rate limit timestamp so we don't try again for 12h
      if (j?.timeRemaining) {
        const resetAt = Date.now() - (12 * 3600_000 - j.timeRemaining * 1000);
        fs.writeFileSync(CLEAR_TS_FILE, String(resetAt));
      }
    }
  } catch (e) { console.warn('[proxy] Bookmakers setup failed:', e?.message); }
}

tryResetBookmakers();

// ── Simple in-memory cache ─────────────────────────────────────────────────
const _cache = new Map();
const cGet = (k) => { const e = _cache.get(k); return e && e.exp > Date.now() ? e.data : null; };
const cSet = (k, d, ttl) => _cache.set(k, { exp: Date.now() + ttl, data: d });

// ── Sport slug maps ────────────────────────────────────────────────────────
const SLUG_TO_API = {
  soccer: 'football', basketball: 'basketball', tennis: 'tennis',
  'ice-hockey': 'icehockey', handball: 'handball', volleyball: 'volleyball',
  'american-football': 'americanfootball', baseball: 'baseball', rugby: 'rugbyleague',
};
const API_TO_SPORT = {
  football: 'soccer', basketball: 'basketball', tennis: 'tennis',
  icehockey: 'ice-hockey', handball: 'handball', volleyball: 'volleyball',
  americanfootball: 'american-football', baseball: 'baseball', rugbyleague: 'rugby',
};

// ── Middle East country block ──────────────────────────────────────────────
const BLOCKED_ME = new Set([
  'saudi arabia', 'qatar', 'united arab emirates', 'uae', 'kuwait',
  'bahrain', 'oman', 'jordan', 'iraq', 'syria', 'lebanon', 'palestine',
  'palestinian territory', 'yemen', 'iran', 'israel',
]);
function isBlockedCountry(country) {
  return BLOCKED_ME.has(String(country || '').toLowerCase().trim());
}

// ── Team fuzzy match ───────────────────────────────────────────────────────
function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}
function teamScore(a, b) {
  const na = norm(a), nb = norm(b);
  if (na === nb) return 100;
  if (na.includes(nb) || nb.includes(na)) return 80;
  const wa = na.split(' ').filter(w => w.length > 2);
  const wb = nb.split(' ').filter(w => w.length > 2);
  const shared = wa.filter(w => wb.includes(w));
  return shared.length ? 60 + (shared.length / Math.max(wa.length, wb.length)) * 30 : 0;
}
function pairScore(h1, a1, h2, a2) {
  return (teamScore(h1, h2) + teamScore(a1, a2)) / 2;
}

// ── Fetch helpers ──────────────────────────────────────────────────────────
async function apiFetch(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn(`[proxy] HTTP ${res.status} | body: ${body.slice(0, 200)}`);
      return null;
    }
    return res.json();
  } catch (e) { console.warn('[proxy] fetch error:', e?.message); return null; }
}

// ── odds-api.io: fetch event list ─────────────────────────────────────────
async function getOddsEvents(sport, statusCsv) {
  if (!ODDS_API_KEY) return [];
  const ck = `ev:${sport}:${statusCsv}`;
  const cached = cGet(ck);
  if (cached) return cached;
  const apiSlug = SLUG_TO_API[sport] || sport;
  const now  = new Date();
  const from = new Date(now.getTime() - 6 * 3600_000).toISOString();
  const to   = new Date(now.getTime() + 48 * 3600_000).toISOString();
  const url  = `${ODDS_API_BASE}/events?apiKey=${ODDS_API_KEY}&sport=${apiSlug}&status=${encodeURIComponent(statusCsv)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=200`;
  const data = await apiFetch(url);
  const list = Array.isArray(data) ? data : (data?.data && Array.isArray(data.data) ? data.data : []);
  const ttl  = statusCsv === 'live' ? 20_000 : 180_000;
  cSet(ck, list, ttl);
  console.log(`[proxy] odds-api.io: ${list.length} ${sport} events (${statusCsv})`);
  return list;
}

// ── odds-api.io: fetch ALL markets for a single event ────────────────────
async function getOddsForEventId(eventId) {
  const ck = `odds:${eventId}`;
  const cached = cGet(ck);
  if (cached !== undefined && cached !== null) return cached;
  const bms = encodeURIComponent(BOOKMAKERS_CSV);
  const url = `${ODDS_API_BASE}/odds?apiKey=${ODDS_API_KEY}&eventId=${encodeURIComponent(eventId)}&bookmakers=${bms}`;
  const data = await apiFetch(url);
  const result = parseAllMarkets(data);
  cSet(ck, result, 90_000);
  return result;
}

// ── Parse ALL markets from odds payload ────────────────────────────────────
function isH2hMarket(name) {
  const k = String(name || '').toLowerCase().trim();
  return k === 'ml' || k === '1x2' || k === 'h2h' || k.includes('moneyline') ||
    k.includes('match winner') || k.includes('match result') ||
    k.includes('full time result') || k.includes('result final') || k.includes('resultado');
}

function parseAllMarkets(payload) {
  if (!payload || typeof payload !== 'object') return null;

  let allMarkets = [];

  // Collect markets from all bookmakers
  const bms = payload.bookmakers;
  if (bms && typeof bms === 'object') {
    const entries = Array.isArray(bms) ? bms : Object.values(bms);
    for (const bm of entries) {
      const markets = Array.isArray(bm) ? bm : (bm?.markets || []);
      for (const m of markets) {
        if (m) allMarkets.push(m);
      }
    }
  }
  if (Array.isArray(payload.markets)) {
    allMarkets = [...allMarkets, ...payload.markets];
  }

  if (!allMarkets.length) return null;

  // Parse H2H (1X2)
  let h2h = null;
  for (const m of allMarkets) {
    if (!isH2hMarket(m?.name || m?.key || m?.type)) continue;
    const odds = m?.odds || m?.outcomes || m?.selections || [];
    const parsed = extract1x2(odds);
    if (parsed) { h2h = parsed; break; }
  }

  // Parse Over/Under markets
  const ouMarkets = {};
  for (const m of allMarkets) {
    const key = String(m?.key || m?.name || m?.type || '').toLowerCase();
    const isOU = key.includes('over') || key.includes('under') || key.includes('total') || key.includes('goals') || key === 'ou';
    if (!isOU) continue;
    const odds = m?.odds || m?.outcomes || m?.selections || [];
    for (const o of (Array.isArray(odds) ? odds : [])) {
      const label = String(o?.name || o?.label || o?.outcome || '').toLowerCase();
      const val = String(m?.line || m?.value || '').match(/(\d+\.?\d*)/);
      const line = val ? val[1] : null;
      const price = Number(o?.price ?? o?.odd ?? 0);
      if (price <= 1 || !line) continue;
      const lineKey = line.replace('.', '_');
      if (!ouMarkets[lineKey]) ouMarkets[lineKey] = {};
      if (label.includes('over') || label === 'over') ouMarkets[lineKey].over = ouMarkets[lineKey].over || price;
      if (label.includes('under') || label === 'under') ouMarkets[lineKey].under = ouMarkets[lineKey].under || price;
    }
  }

  // Parse Handicap markets
  const handicapMarkets = {};
  for (const m of allMarkets) {
    const key = String(m?.key || m?.name || m?.type || '').toLowerCase();
    if (!key.includes('handicap') && !key.includes('spread') && !key.includes('asian')) continue;
    const odds = m?.odds || m?.outcomes || m?.selections || [];
    const line = String(m?.line || m?.value || m?.handicap || '');
    if (!line) continue;
    const lineKey = line.replace(/[^0-9.-]/g, '');
    if (!handicapMarkets[lineKey]) handicapMarkets[lineKey] = {};
    for (const o of (Array.isArray(odds) ? odds : [])) {
      const label = String(o?.name || o?.label || o?.outcome || '').toLowerCase();
      const price = Number(o?.price ?? o?.odd ?? 0);
      if (price <= 1) continue;
      if (label === 'home' || label === '1' || label.includes('home')) handicapMarkets[lineKey].home = price;
      if (label === 'away' || label === '2' || label.includes('away')) handicapMarkets[lineKey].away = price;
      if (label === 'draw' || label === 'x') handicapMarkets[lineKey].draw = price;
    }
  }

  // Parse BTTS (Both Teams To Score)
  let btts = null;
  for (const m of allMarkets) {
    const key = String(m?.key || m?.name || m?.type || '').toLowerCase();
    if (!key.includes('btts') && !key.includes('both') && !key.includes('ambas')) continue;
    const odds = m?.odds || m?.outcomes || m?.selections || [];
    let yes = null, no = null;
    for (const o of (Array.isArray(odds) ? odds : [])) {
      const label = String(o?.name || o?.label || o?.outcome || '').toLowerCase();
      const price = Number(o?.price ?? o?.odd ?? 0);
      if (price <= 1) continue;
      if (label === 'yes' || label === 'sim' || label === 'ambas marcam') yes = price;
      if (label === 'no' || label === 'não' || label === 'não marcam') no = price;
    }
    if (yes || no) { btts = { yes, no }; break; }
  }

  // Build markets array for frontend (keys match SubOddsModel/marketConfig)
  const marketsArr = [];

  // 1X2 market
  if (h2h) {
    marketsArr.push({
      key: 'h2h', name: 'Resultado Final',
      selections: [
        { label: 'Casa',   odd: h2h.home },
        ...(h2h.draw ? [{ label: 'Empate', odd: h2h.draw }] : []),
        { label: 'Fora',   odd: h2h.away },
      ],
    });
  }

  // Over/Under markets — key: 'totals' with line field
  for (const [line, vals] of Object.entries(ouMarkets)) {
    const lineStr = line.replace('_', '.');
    if (vals.over || vals.under) {
      marketsArr.push({
        key: 'totals', name: `Mais/Menos ${lineStr} Golos`,
        line: lineStr,
        selections: [
          ...(vals.over  ? [{ label: `Mais ${lineStr}`,  odd: vals.over  }] : []),
          ...(vals.under ? [{ label: `Menos ${lineStr}`, odd: vals.under }] : []),
        ],
      });
    }
  }

  // Handicap markets — key: 'handicap' with line field
  for (const [line, vals] of Object.entries(handicapMarkets)) {
    if (vals.home || vals.away) {
      const lineStr = line.startsWith('-') ? line : `+${line}`;
      marketsArr.push({
        key: 'handicap', name: `Handicap ${lineStr}`,
        line,
        selections: [
          ...(vals.home  ? [{ label: `Casa (${lineStr})`, odd: vals.home  }] : []),
          ...(vals.draw  ? [{ label: `Empate (${lineStr})`, odd: vals.draw  }] : []),
          ...(vals.away  ? [{ label: `Fora (${lineStr})`, odd: vals.away  }] : []),
        ],
      });
    }
  }

  // BTTS market — key: 'btts'
  if (btts) {
    marketsArr.push({
      key: 'btts', name: 'Ambas Marcam',
      selections: [
        ...(btts.yes ? [{ label: 'Sim', odd: btts.yes }] : []),
        ...(btts.no  ? [{ label: 'Não', odd: btts.no  }] : []),
      ],
    });
  }

  return { h2h, markets: marketsArr };
}

function extract1x2(arr) {
  if (!Array.isArray(arr) || !arr.length) return null;
  if (arr[0]?.home !== undefined) {
    const h = Number(arr[0].home), d = Number(arr[0].draw || 0), a = Number(arr[0].away || 0);
    if (h > 1) return { home: h, draw: d, away: a };
  }
  let home = 0, draw = 0, away = 0;
  for (const o of arr) {
    const name = String(o?.name || o?.label || o?.outcome || '').toLowerCase().trim();
    const price = Number(o?.price ?? o?.odd ?? 0);
    if (price <= 1) continue;
    if (name === 'home' || name === '1' || name === 'home win') home = home || price;
    else if (name === 'draw' || name === 'x' || name === 'tie') draw = draw || price;
    else if (name === 'away' || name === '2' || name === 'away win') away = away || price;
  }
  return home > 1 ? { home, draw, away } : null;
}

// ── Logo URL from SofaScore CDN (uses homeId/awayId from odds-api.io) ─────
function sofascoreLogo(teamId) {
  if (!teamId) return '';
  return `https://img.sofascore.com/api/v1/team/${teamId}/image`;
}

// ── Convert odds-api.io event → frontend NormalizedEvent ──────────────────
function oddsApiToNormalized(oe, sport, oddsById) {
  const homeName = oe.home_team || oe.home || '';
  const awayName = oe.away_team || oe.away || '';
  if (!homeName || !awayName) return null;

  const leagueObj = oe.league || {};
  const leagueName = leagueObj.name || oe.competition || 'Unknown';
  const country = leagueObj.country || oe.country || '';

  if (isBlockedCountry(country)) return null;

  const statusRaw = String(oe.status || '').toLowerCase();
  const isLive = statusRaw === 'live' || statusRaw === 'in_progress' || statusRaw === 'inprogress';
  const oddsResult = oddsById ? oddsById.get(String(oe.id)) : null;

  const h2h = oddsResult?.h2h || null;
  const marketsArr = oddsResult?.markets || [];

  const scoreHome = oe.score?.home ?? oe.scores?.home ?? null;
  const scoreAway = oe.score?.away ?? oe.scores?.away ?? null;

  const sportSlug = oe.sport?.slug || 'football';
  const appSport = API_TO_SPORT[sportSlug] || sport || 'soccer';

  return {
    id: String(oe.id),
    external_event_id: `${appSport}_oa_${oe.id}`,
    sport: appSport,
    league: leagueName,
    home_team: homeName,
    away_team: awayName,
    team_match: `${homeName} vs ${awayName}`,
    event_date: oe.date || new Date().toISOString(),
    status: isLive ? 'LIVE' : 'NS',
    is_live: isLive ? 1 : 0,
    home_odd:  h2h?.home  || 0,
    draw_odd:  h2h?.draw  || 0,
    away_odd:  h2h?.away  || 0,
    elapsed: oe.elapsed || 0,
    timer: String(oe.timer || oe.elapsed || '').trim(),
    score: JSON.stringify({ home: scoreHome, away: scoreAway }),
    markets: marketsArr,
    country,
    home_team_logo: sofascoreLogo(oe.homeId),
    away_team_logo: sofascoreLogo(oe.awayId),
  };
}

// ── Build full event list from odds-api.io (fallback when CF Worker is down)─
async function buildFromOddsApi(sports) {
  const sportsToFetch = (sports === 'all' || !sports)
    ? ['soccer', 'basketball', 'handball', 'volleyball']
    : String(sports).split(',').map(s => s.trim()).filter(Boolean);

  const allLive = [];
  const allPregame = [];

  await Promise.all(sportsToFetch.map(async sport => {
    const apiSlug = SLUG_TO_API[sport] || sport;
    if (!SLUG_TO_API[sport] && !['football','basketball','handball','volleyball','tennis','icehockey','americanfootball','baseball','rugbyleague'].includes(apiSlug)) return;
    const [liveEvs, pregameEvs] = await Promise.all([
      getOddsEvents(sport, 'live'),
      getOddsEvents(sport, 'pending'),
    ]);
    allLive.push(...liveEvs.map(e => ({ ...e, _sport: sport })));
    allPregame.push(...pregameEvs.map(e => ({ ...e, _sport: sport })));
  }));

  // Filter blocked countries and sort
  const filteredLive = allLive.filter(e => !isBlockedCountry(e.league?.country || e.country || ''));
  const filteredPregame = allPregame
    .filter(e => !isBlockedCountry(e.league?.country || e.country || ''))
    .sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));

  // Fetch odds for top live + top pregame
  const liveTop    = filteredLive.slice(0, 20);
  const pregameTop = filteredPregame.slice(0, 200);

  // Odds budget: 20 live + 30 pregame = 50 requests per cycle
  const liveOddsIds    = liveTop.map(e => String(e.id));
  const pregameOddsIds = pregameTop.map(e => String(e.id)).slice(0, 30);
  const uniqueIds = [...new Set([...liveOddsIds, ...pregameOddsIds])];

  const oddsById = new Map();
  await Promise.all(uniqueIds.map(async id => {
    oddsById.set(id, await getOddsForEventId(id));
  }));

  const live = filteredLive
    .map(oe => oddsApiToNormalized(oe, oe._sport || 'soccer', oddsById))
    .filter(Boolean);
  const pregame = pregameTop
    .map(oe => oddsApiToNormalized(oe, oe._sport || 'soccer', oddsById))
    .filter(Boolean);

  const liveEnriched    = live.filter(e => e.home_odd > 0).length;
  const pregameEnriched = pregame.filter(e => e.home_odd > 0).length;
  console.log(`[proxy] odds-api.io: ${live.length} live (${liveEnriched} w/odds), ${pregame.length} pregame (${pregameEnriched} w/odds)`);
  return { live, pregame };
}

// ── Enrich CF Worker events with odds-api.io odds ─────────────────────────
async function enrichList(events, type) {
  if (!ODDS_API_KEY || !events.length) return events;
  const sports = [...new Set(events.map(ev => String(ev.sport || 'soccer').toLowerCase().replace('football', 'soccer')))];
  const statusCsv = type === 'live' ? 'live' : 'pending,live';
  const poolBySport = new Map();
  await Promise.all(sports.map(async sp => { poolBySport.set(sp, await getOddsEvents(sp, statusCsv)); }));

  const matchedPairs = events.map(ev => {
    const sp = String(ev.sport || 'soccer').toLowerCase().replace('football', 'soccer');
    const pool = poolBySport.get(sp) || [];
    let best = null, bestSc = 0;
    for (const oe of pool) {
      const sc = pairScore(ev.home_team || '', ev.away_team || '', oe.home_team || oe.home || '', oe.away_team || oe.away || '');
      if (sc >= 58 && sc > bestSc) { best = oe; bestSc = sc; }
    }
    return { ev, best, bestSc };
  });

  const matched = matchedPairs.filter(p => p.best);
  const uniqueIds = [...new Set(matched.map(p => String(p.best.id)))].slice(0, 30);
  const oddsById = new Map();
  await Promise.all(uniqueIds.map(async id => {
    oddsById.set(id, await getOddsForEventId(id));
  }));

  let enriched = 0;
  const result = matchedPairs.map(({ ev, best, bestSc }) => {
    if (!best) return ev;
    const oddsResult = oddsById.get(String(best.id));
    if (!oddsResult) return ev;
    const h2h = oddsResult.h2h;
    if (!h2h) return ev;
    enriched++;
    return {
      ...ev,
      home_odd: h2h.home,
      draw_odd: h2h.draw,
      away_odd: h2h.away,
      markets: oddsResult.markets || ev.markets || [],
      home_team_logo: ev.home_team_logo || sofascoreLogo(best.homeId),
      away_team_logo: ev.away_team_logo || sofascoreLogo(best.awayId),
    };
  });
  if (enriched) console.log(`[proxy] enriched ${enriched}/${events.length} ${type}`);
  return result;
}

// ── Forward request to CF worker ───────────────────────────────────────────
function forwardToCF(reqUrl, method, headers, body) {
  return new Promise((resolve, reject) => {
    const target = new URL(CF_WORKER + reqUrl);
    const mod = target.protocol === 'https:' ? https : http;
    const opts = {
      hostname: target.hostname,
      port: target.port || 443,
      path: target.pathname + target.search,
      method: method || 'GET',
      headers: { ...headers, host: target.hostname },
    };
    delete opts.headers['connection'];
    opts.headers['host'] = target.hostname;

    const req = mod.request(opts, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    if (body && body.length) req.write(body);
    req.end();
  });
}

// ── Response cache (stale-while-revalidate) ────────────────────────────────
const _responseCache = new Map();
const RESP_TTL_MS  = 45_000;
const STALE_TTL_MS = 600_000;

function rcGet(key) {
  const e = _responseCache.get(key);
  if (!e) return null;
  if (Date.now() < e.staleUntil) return { buf: e.buf, stale: Date.now() > e.freshUntil };
  _responseCache.delete(key);
  return null;
}
function rcSet(key, buf) {
  const now = Date.now();
  _responseCache.set(key, { buf, freshUntil: now + RESP_TTL_MS, staleUntil: now + STALE_TTL_MS });
}

function sendJSON(res, buf) {
  res.writeHead(200, {
    'content-type': 'application/json',
    'content-length': buf.length,
    'access-control-allow-origin': '*',
    'cache-control': 'no-store',
  });
  res.end(buf);
}

// ── Core: fetch + enrich + optional fallback ───────────────────────────────
async function fetchAndEnrich(url, method, headers, body, rcKey) {
  const urlObj = new URL('http://x' + url);
  const sportsParam = urlObj.searchParams.get('sports') || 'all';

  let payload = null;
  try {
    const r = await forwardToCF(url, method, headers, body);
    const ct = String(r.headers?.['content-type'] || '');
    if (ct.includes('application/json')) {
      const parsed = JSON.parse(r.body.toString('utf8'));
      const totalEvents = (parsed.live?.length || 0) + (parsed.pregame?.length || 0);
      if (totalEvents > 0 && !parsed.error_code) {
        payload = parsed;
      }
    }
  } catch (err) {
    console.warn('[proxy] CF forward error:', err?.message);
  }

  let live, pregame;

  if (payload && ODDS_API_KEY) {
    [live, pregame] = await Promise.all([
      enrichList(Array.isArray(payload.live)    ? payload.live    : [], 'live'),
      enrichList(Array.isArray(payload.pregame) ? payload.pregame : [], 'pregame'),
    ]);
  } else if (ODDS_API_KEY) {
    console.log('[proxy] CF Worker unavailable — using odds-api.io as primary source');
    const result = await buildFromOddsApi(sportsParam);
    live    = result.live;
    pregame = result.pregame;
  } else {
    return null;
  }

  const filterME = ev => !isBlockedCountry(ev.country || '');
  live    = live.filter(filterME);
  pregame = pregame.filter(filterME);

  const responsePayload = payload
    ? { ...payload, live, pregame }
    : { live, pregame };

  if (live.length > 0 || pregame.length > 0) {
    const buf = Buffer.from(JSON.stringify(responsePayload), 'utf8');
    rcSet(rcKey, buf);
    return buf;
  }

  return null;
}

// ── HTTP server ────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', async () => {
    const reqBody = chunks.length ? Buffer.concat(chunks) : null;
    const url = req.url || '';
    const isBySportOdds = url.includes('/by-sport') && url.includes('include=odds');

    if (!isBySportOdds) {
      try {
        const { status, headers, body: cfBody } = await forwardToCF(url, req.method, req.headers, reqBody);
        res.writeHead(status, { ...headers, 'access-control-allow-origin': '*' });
        res.end(cfBody);
      } catch {
        res.writeHead(502, { 'content-type': 'text/plain', 'access-control-allow-origin': '*' });
        res.end('Bad Gateway');
      }
      return;
    }

    const rcKey = url;
    const cached = rcGet(rcKey);
    if (cached && !cached.stale) return sendJSON(res, cached.buf);
    if (cached && cached.stale) {
      sendJSON(res, cached.buf);
      setImmediate(() => fetchAndEnrich(url, req.method, req.headers, reqBody, rcKey).catch(() => {}));
      return;
    }

    try {
      const buf = await fetchAndEnrich(url, req.method, req.headers, reqBody, rcKey);
      if (buf) return sendJSON(res, buf);
    } catch (err) {
      console.error('[proxy] error:', err?.message);
    }

    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ live: [], pregame: [] }));
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[proxy] Odds enrichment proxy on http://127.0.0.1:${PORT}`);
  console.log(`[proxy] Upstream: ${CF_WORKER}`);
  console.log(`[proxy] Preferred bookmakers: ${PREFERRED_BM}`);
});
server.on('error', e => { console.error('[proxy] fatal:', e.message); process.exit(1); });
