#!/usr/bin/env node
/**
 * odds-proxy.mjs — Local enrichment proxy (port 8788)
 *
 * Routes:
 *   /api/events/by-sport?*include=odds*  → fetch from CF worker, enrich with odds-api.io
 *   everything else                      → pass through to CF worker
 *
 * Run: node scripts/odds-proxy.mjs
 * Vite proxy target → http://127.0.0.1:8788
 */

import http  from 'http';
import https from 'https';

const CF_WORKER      = 'https://bet62apostasesportivas.bet62.workers.dev';
const PORT           = 8080;
const ODDS_API_KEY   = process.env.ODDS_API_KEY   || '';
const BOOKMAKERS_CSV = process.env.ODDS_API_BOOKMAKERS || 'Bet365,1xbet,Betano,888Sport,SportingBet';
const ODDS_API_BASE  = 'https://api.odds-api.io/v3';

if (!ODDS_API_KEY) console.warn('[proxy] WARNING: ODDS_API_KEY not set — enrichment disabled');
else console.log(`[proxy] ODDS_API_KEY: ✓ set | Bookmakers: ${BOOKMAKERS_CSV}`);

// ── Simple in-memory cache ─────────────────────────────────────────────────
const _cache = new Map();
const cGet = (k) => { const e = _cache.get(k); return e && e.exp > Date.now() ? e.data : null; };
const cSet = (k, d, ttl) => _cache.set(k, { exp: Date.now() + ttl, data: d });

// ── Team match helpers ─────────────────────────────────────────────────────
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
      console.warn(`[proxy] HTTP ${res.status} for ${url.replace(ODDS_API_KEY, 'REDACTED').slice(0, 120)} | body: ${body.slice(0, 300)}`);
      return null;
    }
    return res.json();
  } catch (e) { console.warn('[proxy] fetch error:', e?.message); return null; }
}

const SLUG = { soccer: 'football', basketball: 'basketball', tennis: 'tennis', 'ice-hockey': 'icehockey', handball: 'handball', volleyball: 'volleyball', 'american-football': 'americanfootball', baseball: 'baseball', rugby: 'rugbyleague' };

async function getOddsEvents(sport, statusCsv) {
  if (!ODDS_API_KEY) return [];
  const ck = `ev:${sport}:${statusCsv}`;
  const cached = cGet(ck);
  if (cached) return cached;
  const slug = SLUG[sport] || sport;
  const now  = new Date();
  const from = new Date(now.getTime() - 6 * 3600_000).toISOString();
  const to   = new Date(now.getTime() + 48 * 3600_000).toISOString();
  const url  = `${ODDS_API_BASE}/events?apiKey=${ODDS_API_KEY}&sport=${slug}&status=${encodeURIComponent(statusCsv)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=200`;
  const data = await apiFetch(url);
  const list = Array.isArray(data) ? data : (data && Array.isArray(data.data) ? data.data : []);
  const ttl  = statusCsv.includes('live') && !statusCsv.includes('pending') ? 10_000 : 30_000;
  cSet(ck, list, ttl);
  console.log(`[proxy] odds-api.io: ${list.length} ${sport} events (${statusCsv})`);
  return list;
}

// Fetch odds for a single event ID from odds-api.io
async function getOddsForEventId(eventId) {
  const ck = `odds:${eventId}`;
  const cached = cGet(ck);
  if (cached) return cached;
  const bms = encodeURIComponent(BOOKMAKERS_CSV);
  const url = `${ODDS_API_BASE}/odds?apiKey=${ODDS_API_KEY}&eventId=${encodeURIComponent(eventId)}&bookmakers=${bms}`;
  const data = await apiFetch(url);
  const result = parseH2hFromOddsPayload(data);
  cSet(ck, result, 20_000);
  return result;
}

function isH2hMarket(name) {
  const k = String(name || '').toLowerCase().trim();
  return k === 'ml' || k === '1x2' || k === 'h2h' || k.includes('moneyline') || k.includes('match winner') || k.includes('match result') || k.includes('full time result') || k.includes('result final') || k.includes('resultado');
}

function parseH2hFromOddsPayload(payload) {
  if (!payload || typeof payload !== 'object') return null;

  // Format: { bookmakers: { "Bet365": [ { name: "ML", odds: [{home,draw,away}] } ] } }
  const bms = payload.bookmakers;
  if (bms && typeof bms === 'object') {
    const entries = Array.isArray(bms) ? bms : Object.values(bms);
    for (const bm of entries) {
      const markets = Array.isArray(bm) ? bm : (bm?.markets || []);
      for (const m of markets) {
        if (!isH2hMarket(m?.name || m?.key || m?.type)) continue;
        const oddsArr = m?.odds || m?.outcomes || [];
        const h = tryExtract1x2(oddsArr);
        if (h) return h;
      }
    }
  }
  // Format: top-level markets array
  if (Array.isArray(payload.markets)) {
    for (const m of payload.markets) {
      if (!isH2hMarket(m?.name || m?.key)) continue;
      const oddsArr = m?.odds || m?.outcomes || m?.selections || [];
      const h = tryExtract1x2(oddsArr);
      if (h) return h;
    }
  }
  return null;
}

function tryExtract1x2(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  // Structured: [{home,draw,away}]
  if (arr[0]?.home !== undefined) {
    const h = Number(arr[0].home), d = Number(arr[0].draw || 0), a = Number(arr[0].away || 0);
    if (h > 1) return { home: h, draw: d, away: a };
  }
  // Outcome style: [{name:"Home",price:1.85}]
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

async function enrichList(events, type) {
  if (!ODDS_API_KEY || !events.length) return events;
  const sports = [...new Set(events.map(ev => String(ev.sport || 'soccer').toLowerCase().replace('football', 'soccer')))];
  const statusCsv = type === 'live' ? 'live' : 'pending,live';
  const poolBySport = new Map();
  await Promise.all(sports.map(async sp => { poolBySport.set(sp, await getOddsEvents(sp, statusCsv)); }));

  // Find best odds-api.io match for each event
  const matchedPairs = events.map(ev => {
    const sp = String(ev.sport || 'soccer').toLowerCase().replace('football', 'soccer');
    const pool = poolBySport.get(sp) || [];
    let best = null, bestSc = 0;
    for (const oe of pool) {
      const sc = pairScore(ev.home_team || '', ev.away_team || '', oe.home_team || oe.home || oe.homeTeam || '', oe.away_team || oe.away || oe.awayTeam || '');
      if (sc >= 58 && sc > bestSc) { best = oe; bestSc = sc; }
    }
    return { ev, best, bestSc };
  });

  // Fetch odds only for matched events (parallel, max 8 concurrent)
  const matched = matchedPairs.filter(p => p.best);
  const uniqueIds = [...new Set(matched.map(p => String(p.best.id)))];
  const oddsById = new Map();
  await Promise.all(uniqueIds.slice(0, 20).map(async id => {
    oddsById.set(id, await getOddsForEventId(id));
  }));

  let enriched = 0;
  const result = matchedPairs.map(({ ev, best, bestSc }) => {
    if (!best) return ev;
    const h2h = oddsById.get(String(best.id));
    if (!h2h) return ev;
    enriched++;
    console.log(`[proxy] ✓ ${ev.home_team} v ${ev.away_team} (sc=${Math.round(bestSc)}) → ${h2h.home}/${h2h.draw}/${h2h.away}`);
    return { ...ev, home_odd: h2h.home, draw_odd: h2h.draw, away_odd: h2h.away };
  });
  if (enriched) console.log(`[proxy] enriched ${enriched}/${events.length} ${type} events`);
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
    delete opts.headers['host'];
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

// ── Response cache (stale-while-revalidate for CF outages) ─────────────────
const _responseCache = new Map();
const RESP_TTL_MS   = 15_000;  // 15s fresh
const STALE_TTL_MS  = 120_000; // 2min stale serve

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

function sendEnriched(res, buf) {
  res.writeHead(200, {
    'content-type': 'application/json',
    'content-length': buf.length,
    'access-control-allow-origin': '*',
    'cache-control': 'no-store',
  });
  res.end(buf);
}

// ── HTTP server ────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', async () => {
    const reqBody = chunks.length ? Buffer.concat(chunks) : null;
    const url = req.url || '';
    const isBySportOdds = url.includes('/by-sport') && url.includes('include=odds');

    // ── Pass-through for non-enriched requests ────────────────────────────
    if (!isBySportOdds || !ODDS_API_KEY) {
      try {
        const { status, headers, body: cfBody } = await forwardToCF(url, req.method, req.headers, reqBody);
        res.writeHead(status, { ...headers, 'access-control-allow-origin': '*' });
        res.end(cfBody);
      } catch (err) {
        res.writeHead(502, { 'content-type': 'text/plain', 'access-control-allow-origin': '*' });
        res.end('Bad Gateway');
      }
      return;
    }

    // ── Enriched path: by-sport + include=odds ────────────────────────────
    const rcKey = url;

    // Serve fresh cache immediately
    const cached = rcGet(rcKey);
    if (cached && !cached.stale) {
      return sendEnriched(res, cached.buf);
    }
    // Serve stale immediately, revalidate in background
    if (cached && cached.stale) {
      sendEnriched(res, cached.buf);
      setImmediate(() => fetchAndEnrich(url, req.method, req.headers, reqBody, rcKey).catch(() => {}));
      return;
    }

    // No cache — fetch synchronously
    try {
      const buf = await fetchAndEnrich(url, req.method, req.headers, reqBody, rcKey);
      if (buf) return sendEnriched(res, buf);
      // CF failed and no cache — return empty (200 so frontend doesn't error-log)
      res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ live: [], pregame: [] }));
    } catch (err) {
      console.error('[proxy] error:', err?.message);
      res.writeHead(502, { 'content-type': 'text/plain', 'access-control-allow-origin': '*' });
      res.end('Bad Gateway');
    }
  });
});

async function fetchAndEnrich(url, method, headers, body, rcKey) {
  let cfStatus, cfHeaders, cfBody;
  try {
    const r = await forwardToCF(url, method, headers, body);
    cfStatus = r.status; cfHeaders = r.headers; cfBody = r.body;
  } catch (err) {
    console.error('[proxy] CF forward error:', err?.message);
    return null;
  }

  const ct = String(cfHeaders?.['content-type'] || '');
  if (!ct.includes('application/json')) return null;

  let payload;
  try { payload = JSON.parse(cfBody.toString('utf8')); } catch { return null; }

  // Detect CF error responses (1102 etc)
  const totalEvents = (payload.live?.length || 0) + (payload.pregame?.length || 0);
  if (totalEvents === 0 && payload.error_code) {
    console.log('[proxy] CF returned 1102/error, totalEvents=0');
    return null;
  }

  const [live, pregame] = await Promise.all([
    enrichList(Array.isArray(payload.live)    ? payload.live    : [], 'live'),
    enrichList(Array.isArray(payload.pregame) ? payload.pregame : [], 'pregame'),
  ]);

  const buf = Buffer.from(JSON.stringify({ ...payload, live, pregame }), 'utf8');
  rcSet(rcKey, buf);
  return buf;
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[proxy] Odds enrichment proxy on http://127.0.0.1:${PORT}`);
  console.log(`[proxy] Upstream: ${CF_WORKER}`);
});
server.on('error', e => { console.error('[proxy] fatal:', e.message); process.exit(1); });
