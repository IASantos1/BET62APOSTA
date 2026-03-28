#!/usr/bin/env node
/**
 * odds-proxy.mjs — Local enrichment proxy (port 8080)
 *
 * Rules:
 *  - Block women's leagues, youth (U16-U23), amateur, 3rd division+, friendlies
 *  - Only return events that have odds (home_odd > 1)
 *  - Pregame: max 60 events with odds | Live: max 120 events with odds
 *  - Preferred bookmakers: auto-reset every 12h
 */

import http   from 'http';
import https  from 'https';
import fs     from 'fs';
import path   from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLEAR_TS_FILE = path.join(__dirname, '.last_bm_clear');

const CF_WORKER     = 'https://bet62apostasesportivas.bet62.workers.dev';
const PORT          = 8080;
const ODDS_API_KEY  = process.env.ODDS_API_KEY || '';
const ODDS_API_BASE = 'https://api.odds-api.io/v3';

// Target bookmakers
const PREFERRED_BM  = 'Bet365,Betano,Unibet,Superbet,Betfair Sportsbook';
let   BOOKMAKERS_CSV = PREFERRED_BM;

if (!ODDS_API_KEY) console.warn('[proxy] WARNING: ODDS_API_KEY not set');

// ── Bookmaker auto-reset (once per 12h) ─────────────────────────────────────
async function tryResetBookmakers() {
  if (!ODDS_API_KEY) return;
  try {
    let lastClear = 0;
    try { lastClear = parseInt(fs.readFileSync(CLEAR_TS_FILE, 'utf8').trim()) || 0; } catch {}
    const twelveH = 12 * 3600_000;
    if (Date.now() - lastClear < twelveH) {
      const remaining = Math.ceil((twelveH - (Date.now() - lastClear)) / 60_000);
      console.log(`[proxy] Bookmakers reset in ${remaining}m — checking current selection`);
      const r = await fetch(`${ODDS_API_BASE}/bookmakers/selected?apiKey=${ODDS_API_KEY}`, { signal: AbortSignal.timeout(6000) });
      const j = await r.json().catch(() => ({}));
      BOOKMAKERS_CSV = Array.isArray(j?.bookmakers) ? j.bookmakers.join(',') : PREFERRED_BM;
      console.log(`[proxy] Active bookmakers: ${BOOKMAKERS_CSV}`);
      return;
    }
    const r = await fetch(`${ODDS_API_BASE}/bookmakers/selected/clear?apiKey=${ODDS_API_KEY}`, { method: 'PUT', signal: AbortSignal.timeout(8000) });
    const j = await r.json().catch(() => ({}));
    if (r.ok) {
      fs.writeFileSync(CLEAR_TS_FILE, String(Date.now()));
      BOOKMAKERS_CSV = PREFERRED_BM;
      console.log(`[proxy] Bookmakers reset ✓ → ${BOOKMAKERS_CSV}`);
    } else {
      console.warn(`[proxy] Bookmakers reset blocked: ${String(j?.error||'').slice(0,120)}`);
      const r2 = await fetch(`${ODDS_API_BASE}/bookmakers/selected?apiKey=${ODDS_API_KEY}`, { signal: AbortSignal.timeout(6000) });
      const j2 = await r2.json().catch(() => ({}));
      BOOKMAKERS_CSV = Array.isArray(j2?.bookmakers) ? j2.bookmakers.join(',') : PREFERRED_BM;
      if (j?.timeRemaining) {
        const resetAt = Date.now() - (twelveH - j.timeRemaining * 1000);
        fs.writeFileSync(CLEAR_TS_FILE, String(resetAt));
      }
    }
  } catch (e) { console.warn('[proxy] Bookmakers setup failed:', e?.message); }
}
tryResetBookmakers();

// ── Cache ────────────────────────────────────────────────────────────────────
const _cache = new Map();
const cGet = (k) => { const e = _cache.get(k); return e && e.exp > Date.now() ? e.data : null; };
const cSet = (k, d, ttl) => _cache.set(k, { exp: Date.now() + ttl, data: d });

// ── Sport slug maps ───────────────────────────────────────────────────────────
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

// ── LEAGUE BLOCKER ───────────────────────────────────────────────────────────
// Women's leagues (any language)
const WOMEN_RE = /\b(women|woman|féminin|feminine|feminino|feminina|mulheres|damen|dames|damallsvenskan|toppserien|kvinner|kvinder|naiset|naisten|feminil|femenino|femmes|nők|ženy|ženske|nő|kobiety|females?)\b/i;

// Youth / junior
const YOUTH_RE = /\b(u-?1[6789]|u-?20|u-?21|u-?22|u-?23|under-?1[6789]|under-?20|under-?21|under-?22|under-?23|youth|junior|juvenil|juvenis|jugend|cadete|infantil|sub-?1[6789]|sub-?20|sub-?21|sub-?22|sub-?23)\b/i;

// Amateur
const AMATEUR_RE = /\b(amateur|amateurs|amateure|amador|amateurs|amatör)\b/i;

// Friendly games
const FRIENDLY_RE = /\b(friendly|friendlies|amistoso|amistosos|amical|freundschaft|testspiel|preseason|pre-?season)\b/i;

// Blocked countries (Middle East)
const BLOCKED_ME = new Set([
  'saudi arabia','qatar','united arab emirates','uae','kuwait',
  'bahrain','oman','jordan','iraq','syria','lebanon','palestine',
  'palestinian territory','yemen','iran',
]);

// Low-tier division keywords — 3rd division and below
const LOW_TIER_RE = /\b(iii[\s_-]liga|liga[\s_-]iii|3[.\s]liga|liga[\s_-]3|ligue[\s_-]3|serie[\s_-][cd]|tercera|3rd[\s_-]div|division[\s_-]3|div[\s_-]3|gamma[\s_-]ethniki|nb[\s_-]iii|segunda[\s_-]b|tercera[\s_-]rfef|regionalliga|kakkonen|kolmonen|vtora[\s_-]liga|dritte|esiliiga|ii[\s_-]liiga|ii[\s_-]lyga|derde[\s_-]divisie|derde[\s_-]klasse|segunda[\s_-]divisao[\s_-]b|liga[\s_-][456]|vierde|vijfde|copa[\s_-]espirito|2[\.\s]cfl|2[\.\s]mfl|3[\.\s]snl|ligue[\s_-][345]|campionato[\s_-][cd]|polska[\s_-][3456]|II[\s_-]liga|segunda[\s_-]federacion|promozione|eccellenza|interregional)\b/i;

// Extra: specific league name patterns always block
const ALWAYS_BLOCK_SLUGS = [
  'kakkonen', 'kolmonen', 'regionalliga', 'esiliiga-b', 'ii-liiga', 'ii-lyga',
  'derde-divisie', 'tweede-divisie', 'vtora-liga', 'gamma-ethniki',
  'copa-espirito-santo', 'nb-iii', '2-cfl', '3-snl',
];

function isBlockedLeague(leagueName, leagueSlug, country) {
  if (!leagueName) return false;
  const name = String(leagueName);
  const slug = String(leagueSlug || '');
  const ctry = String(country || '').toLowerCase();

  if (BLOCKED_ME.has(ctry)) return true;
  if (WOMEN_RE.test(name))   return true;
  if (YOUTH_RE.test(name))   return true;
  if (AMATEUR_RE.test(name)) return true;
  if (FRIENDLY_RE.test(name)) return true;
  if (LOW_TIER_RE.test(name)) return true;
  if (ALWAYS_BLOCK_SLUGS.some(s => slug.includes(s))) return true;

  return false;
}

// ── Team fuzzy match ──────────────────────────────────────────────────────────
function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9 ]/g,'').replace(/\s+/g,' ').trim();
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

// ── Fetch helpers ─────────────────────────────────────────────────────────────
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

// ── Fetch event list from odds-api.io ─────────────────────────────────────────
async function getOddsEvents(sport, statusCsv) {
  if (!ODDS_API_KEY) return [];
  const ck = `ev:${sport}:${statusCsv}`;
  const cached = cGet(ck);
  if (cached) return cached;

  const apiSlug = SLUG_TO_API[sport] || sport;
  const now  = new Date();
  const from = new Date(now.getTime() - 4 * 3600_000).toISOString();
  const to   = new Date(now.getTime() + 72 * 3600_000).toISOString();
  const url  = `${ODDS_API_BASE}/events?apiKey=${ODDS_API_KEY}&sport=${apiSlug}&status=${encodeURIComponent(statusCsv)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=200`;
  const data = await apiFetch(url);
  const list = Array.isArray(data) ? data : (data?.data && Array.isArray(data.data) ? data.data : []);

  // Apply league filter immediately
  const filtered = list.filter(e => {
    const league = e.league || {};
    return !isBlockedLeague(league.name || e.competition, league.slug, league.country || e.country);
  });

  const ttl = statusCsv === 'live' ? 20_000 : 120_000;
  cSet(ck, filtered, ttl);
  console.log(`[proxy] odds-api.io: ${filtered.length}/${list.length} ${sport} events after filter (${statusCsv})`);
  return filtered;
}

// ── Fetch ALL markets for a single event ─────────────────────────────────────
async function getOddsForEventId(eventId) {
  const ck = `odds:${eventId}:${BOOKMAKERS_CSV.slice(0,20)}`;
  const cached = cGet(ck);
  if (cached !== undefined && cached !== null) return cached;

  const bms = encodeURIComponent(BOOKMAKERS_CSV);
  const url  = `${ODDS_API_BASE}/odds?apiKey=${ODDS_API_KEY}&eventId=${encodeURIComponent(eventId)}&bookmakers=${bms}`;
  const data = await apiFetch(url);
  const result = parseAllMarkets(data);
  cSet(ck, result, 60_000);
  return result;
}

// ── Parse all markets from odds payload ──────────────────────────────────────
function isH2hMarket(name) {
  const k = String(name || '').toLowerCase().trim();
  return k === 'ml' || k === '1x2' || k === 'h2h' || k.includes('moneyline') ||
    k.includes('match winner') || k.includes('match result') ||
    k.includes('full time result') || k.includes('result final') || k.includes('resultado');
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

function parseAllMarkets(payload) {
  if (!payload || typeof payload !== 'object') return null;
  let allMarkets = [];
  const bms = payload.bookmakers;
  if (bms && typeof bms === 'object') {
    const entries = Array.isArray(bms) ? bms : Object.values(bms);
    for (const bm of entries) {
      const markets = Array.isArray(bm) ? bm : (bm?.markets || []);
      for (const m of markets) { if (m) allMarkets.push(m); }
    }
  }
  if (Array.isArray(payload.markets)) allMarkets = [...allMarkets, ...payload.markets];
  if (!allMarkets.length) return null;

  // H2H
  let h2h = null;
  for (const m of allMarkets) {
    if (!isH2hMarket(m?.name || m?.key || m?.type)) continue;
    const parsed = extract1x2(m?.odds || m?.outcomes || m?.selections || []);
    if (parsed) { h2h = parsed; break; }
  }

  // Over/Under
  const ouMap = {};
  for (const m of allMarkets) {
    const key = String(m?.key || m?.name || m?.type || '').toLowerCase();
    if (!key.includes('over') && !key.includes('under') && !key.includes('total') && !key.includes('goals') && key !== 'ou') continue;
    const line = String(m?.line || m?.value || '').match(/(\d+\.?\d*)/)?.[1];
    if (!line) continue;
    const k = line.replace('.', '_');
    if (!ouMap[k]) ouMap[k] = {};
    for (const o of (m?.odds || m?.outcomes || m?.selections || [])) {
      const lbl = String(o?.name || o?.label || o?.outcome || '').toLowerCase();
      const price = Number(o?.price ?? o?.odd ?? 0);
      if (price <= 1) continue;
      if (lbl.includes('over'))  ouMap[k].over  = ouMap[k].over  || price;
      if (lbl.includes('under')) ouMap[k].under = ouMap[k].under || price;
    }
  }

  // Handicap
  const hdcMap = {};
  for (const m of allMarkets) {
    const key = String(m?.key || m?.name || m?.type || '').toLowerCase();
    if (!key.includes('handicap') && !key.includes('spread') && !key.includes('asian')) continue;
    const line = String(m?.line || m?.value || m?.handicap || '').replace(/[^0-9.-]/g, '');
    if (!line) continue;
    if (!hdcMap[line]) hdcMap[line] = {};
    for (const o of (m?.odds || m?.outcomes || m?.selections || [])) {
      const lbl = String(o?.name || o?.label || o?.outcome || '').toLowerCase();
      const price = Number(o?.price ?? o?.odd ?? 0);
      if (price <= 1) continue;
      if (lbl === 'home' || lbl === '1') hdcMap[line].home = price;
      if (lbl === 'away' || lbl === '2') hdcMap[line].away = price;
      if (lbl === 'draw' || lbl === 'x') hdcMap[line].draw = price;
    }
  }

  // BTTS
  let btts = null;
  for (const m of allMarkets) {
    const key = String(m?.key || m?.name || m?.type || '').toLowerCase();
    if (!key.includes('btts') && !key.includes('both') && !key.includes('ambas')) continue;
    let yes = null, no = null;
    for (const o of (m?.odds || m?.outcomes || m?.selections || [])) {
      const lbl = String(o?.name || o?.label || o?.outcome || '').toLowerCase();
      const price = Number(o?.price ?? o?.odd ?? 0);
      if (price <= 1) continue;
      if (lbl === 'yes' || lbl === 'sim') yes = price;
      if (lbl === 'no'  || lbl === 'não') no  = price;
    }
    if (yes || no) { btts = { yes, no }; break; }
  }

  // Build markets array (keys match marketConfig)
  const marketsArr = [];
  if (h2h) {
    marketsArr.push({ key: 'h2h', name: 'Resultado Final', selections: [
      { label: 'Casa',   odd: h2h.home },
      ...(h2h.draw ? [{ label: 'Empate', odd: h2h.draw }] : []),
      { label: 'Fora',   odd: h2h.away },
    ]});
  }
  for (const [k, v] of Object.entries(ouMap)) {
    if (!v.over && !v.under) continue;
    const lineStr = k.replace('_', '.');
    marketsArr.push({ key: 'totals', name: `Mais/Menos ${lineStr} Golos`, line: lineStr, selections: [
      ...(v.over  ? [{ label: `Mais ${lineStr}`,  odd: v.over  }] : []),
      ...(v.under ? [{ label: `Menos ${lineStr}`, odd: v.under }] : []),
    ]});
  }
  for (const [k, v] of Object.entries(hdcMap)) {
    if (!v.home && !v.away) continue;
    const ls = k.startsWith('-') ? k : `+${k}`;
    marketsArr.push({ key: 'handicap', name: `Handicap ${ls}`, line: k, selections: [
      ...(v.home ? [{ label: `Casa (${ls})`, odd: v.home }] : []),
      ...(v.draw ? [{ label: `Empate (${ls})`, odd: v.draw }] : []),
      ...(v.away ? [{ label: `Fora (${ls})`, odd: v.away }] : []),
    ]});
  }
  if (btts) {
    marketsArr.push({ key: 'btts', name: 'Ambas Marcam', selections: [
      ...(btts.yes ? [{ label: 'Sim', odd: btts.yes }] : []),
      ...(btts.no  ? [{ label: 'Não', odd: btts.no  }] : []),
    ]});
  }

  return { h2h, markets: marketsArr };
}

// ── Logo from SofaScore CDN (via homeId from odds-api.io) ─────────────────────
function sofascoreLogo(teamId) {
  if (!teamId) return '';
  return `https://img.sofascore.com/api/v1/team/${teamId}/image`;
}

// ── Convert odds-api.io event → normalized ────────────────────────────────────
function oddsApiToNormalized(oe, sport, oddsById) {
  const homeName = oe.home_team || oe.home || '';
  const awayName = oe.away_team || oe.away || '';
  if (!homeName || !awayName) return null;

  const leagueObj  = oe.league || {};
  const leagueName = leagueObj.name || oe.competition || 'Unknown';
  const country    = leagueObj.country || oe.country || '';

  // Extra safety: block again if somehow slipped through
  if (isBlockedLeague(leagueName, leagueObj.slug, country)) return null;

  const statusRaw  = String(oe.status || '').toLowerCase();
  const isLive     = statusRaw === 'live' || statusRaw === 'in_progress' || statusRaw === 'inprogress';
  const oddsResult = oddsById ? oddsById.get(String(oe.id)) : null;
  const h2h        = oddsResult?.h2h || null;
  const marketsArr = oddsResult?.markets || [];

  // REQUIRE ODDS — skip events without odds
  if (!h2h) return null;

  const scoreHome = oe.score?.home ?? oe.scores?.home ?? null;
  const scoreAway = oe.score?.away ?? oe.scores?.away ?? null;
  const sportSlug  = oe.sport?.slug || 'football';
  const appSport   = API_TO_SPORT[sportSlug] || sport || 'soccer';

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
    home_odd:  h2h.home,
    draw_odd:  h2h.draw || 0,
    away_odd:  h2h.away,
    elapsed: oe.elapsed || 0,
    timer: String(oe.timer || oe.elapsed || '').trim(),
    score: JSON.stringify({ home: scoreHome, away: scoreAway }),
    markets: marketsArr,
    country,
    home_team_logo: sofascoreLogo(oe.homeId),
    away_team_logo: sofascoreLogo(oe.awayId),
  };
}

// ── Build events from odds-api.io (when CF Worker is unavailable) ─────────────
async function buildFromOddsApi(sports) {
  const sportsToFetch = (sports === 'all' || !sports)
    ? ['soccer', 'basketball', 'handball', 'volleyball', 'tennis']
    : String(sports).split(',').map(s => s.trim()).filter(Boolean);

  const allLive = [], allPregame = [];

  await Promise.all(sportsToFetch.map(async sport => {
    if (!SLUG_TO_API[sport]) return;
    const [liveEvs, pregameEvs] = await Promise.all([
      getOddsEvents(sport, 'live'),
      getOddsEvents(sport, 'pending'),
    ]);
    allLive.push(...liveEvs.map(e => ({ ...e, _sport: sport })));
    allPregame.push(...pregameEvs.map(e => ({ ...e, _sport: sport })));
  }));

  // Sort by date ascending (soonest first) for pregame
  const sortedLive    = allLive;
  const sortedPregame = allPregame.sort((a, b) => new Date(a.date||0) - new Date(b.date||0));

  // Fetch odds for ALL live + top 80 pregame (budget: ~200 requests max)
  const liveIds    = sortedLive.map(e => String(e.id));
  const pregameIds = sortedPregame.map(e => String(e.id)).slice(0, 80);
  const allIds     = [...new Set([...liveIds, ...pregameIds])];

  const oddsById = new Map();
  // Fetch in batches of 20 to stay within rate limits
  for (let i = 0; i < allIds.length; i += 20) {
    const batch = allIds.slice(i, i + 20);
    await Promise.all(batch.map(async id => {
      oddsById.set(id, await getOddsForEventId(id));
    }));
  }

  // Build events — only those with odds (oddsApiToNormalized returns null without odds)
  const live    = sortedLive.map(oe => oddsApiToNormalized(oe, oe._sport || 'soccer', oddsById)).filter(Boolean).slice(0, 120);
  const pregame = sortedPregame.map(oe => oddsApiToNormalized(oe, oe._sport || 'soccer', oddsById)).filter(Boolean).slice(0, 60);

  console.log(`[proxy] odds-api.io: ${live.length} live, ${pregame.length} pregame (all with odds)`);
  return { live, pregame };
}

// ── Enrich CF Worker events with odds-api.io (+ filter banned leagues) ────────
async function enrichList(events, type) {
  if (!events.length) return [];

  // First: filter banned leagues from CF Worker events
  const filtered = events.filter(ev => {
    const league  = ev.league;
    const lname   = typeof league === 'string' ? league : (league?.name || '');
    const lslug   = typeof league === 'object' ? (league?.slug || '') : '';
    const country = ev.country || '';
    return !isBlockedLeague(lname, lslug, country);
  });

  if (!ODDS_API_KEY || !filtered.length) return filtered;

  const sports = [...new Set(filtered.map(ev => String(ev.sport || 'soccer').toLowerCase().replace('football', 'soccer')))];
  const validSports = sports.filter(s => SLUG_TO_API[s]);
  if (!validSports.length) return filtered;

  const statusCsv = type === 'live' ? 'live' : 'pending,live';
  const poolBySport = new Map();
  await Promise.all(validSports.map(async sp => {
    poolBySport.set(sp, await getOddsEvents(sp, statusCsv));
  }));

  const matchedPairs = filtered.map(ev => {
    const sp   = String(ev.sport || 'soccer').toLowerCase().replace('football', 'soccer');
    const pool = poolBySport.get(sp) || [];
    let best = null, bestSc = 0;
    for (const oe of pool) {
      const sc = pairScore(ev.home_team || '', ev.away_team || '', oe.home_team || oe.home || '', oe.away_team || oe.away || '');
      if (sc >= 58 && sc > bestSc) { best = oe; bestSc = sc; }
    }
    return { ev, best };
  });

  const matched   = matchedPairs.filter(p => p.best);
  const uniqueIds = [...new Set(matched.map(p => String(p.best.id)))].slice(0, 60);
  const oddsById  = new Map();
  await Promise.all(uniqueIds.map(async id => {
    oddsById.set(id, await getOddsForEventId(id));
  }));

  let enriched = 0;
  const result = matchedPairs.map(({ ev, best }) => {
    if (!best) return ev;
    const oddsResult = oddsById.get(String(best.id));
    const h2h = oddsResult?.h2h;
    if (!h2h) return ev; // Keep original CF Worker event (may already have odds from its DB)
    enriched++;
    return {
      ...ev,
      home_odd: h2h.home || ev.home_odd,
      draw_odd: h2h.draw || ev.draw_odd,
      away_odd: h2h.away || ev.away_odd,
      markets: oddsResult.markets?.length ? oddsResult.markets : (ev.markets || []),
      home_team_logo: ev.home_team_logo || sofascoreLogo(best.homeId),
      away_team_logo: ev.away_team_logo || sofascoreLogo(best.awayId),
    };
  });

  if (enriched) console.log(`[proxy] enriched ${enriched}/${filtered.length} ${type} with odds-api.io`);

  // Filter: REQUIRE odds (from CF Worker OR odds-api.io enrichment)
  const withOdds = result.filter(ev => {
    // Check direct fields
    if (Number(ev.home_odd) > 1) return true;
    // Check markets array
    if (Array.isArray(ev.markets) && ev.markets.length > 0) {
      const h2h = ev.markets.find(m => m.key === 'h2h');
      if (h2h?.selections?.some(s => Number(s.odd) > 1)) return true;
    }
    return false;
  });

  const limit = type === 'live' ? 120 : 60;
  const limited = withOdds.slice(0, limit);
  console.log(`[proxy] ${type}: ${limited.length} events with odds (${filtered.length - withOdds.length} dropped — no odds)`);
  return limited;
}

// ── Forward request to CF Worker ──────────────────────────────────────────────
function forwardToCF(reqUrl, method, headers, body) {
  return new Promise((resolve, reject) => {
    const target = new URL(CF_WORKER + reqUrl);
    const mod  = target.protocol === 'https:' ? https : http;
    const opts = {
      hostname: target.hostname,
      port: target.port || 443,
      path: target.pathname + target.search,
      method: method || 'GET',
      headers: { ...headers, host: target.hostname },
    };
    delete opts.headers['connection'];
    const req = mod.request(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    if (body && body.length) req.write(body);
    req.end();
  });
}

// ── Response cache ────────────────────────────────────────────────────────────
const _rc = new Map();
function rcGet(key) {
  const e = _rc.get(key);
  if (!e) return null;
  if (Date.now() < e.staleUntil) return { buf: e.buf, stale: Date.now() > e.freshUntil };
  _rc.delete(key);
  return null;
}
function rcSet(key, buf) {
  const now = Date.now();
  _rc.set(key, { buf, freshUntil: now + 45_000, staleUntil: now + 600_000 });
}

function sendJSON(res, buf) {
  res.writeHead(200, { 'content-type': 'application/json', 'content-length': buf.length, 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
  res.end(buf);
}

// ── Core: fetch + filter + enrich ─────────────────────────────────────────────
async function fetchAndEnrich(url, method, headers, body, rcKey) {
  const urlObj    = new URL('http://x' + url);
  const sportsParam = urlObj.searchParams.get('sports') || 'all';

  let payload = null;
  try {
    const r  = await forwardToCF(url, method, headers, body);
    const ct = String(r.headers?.['content-type'] || '');
    if (ct.includes('application/json')) {
      const parsed = JSON.parse(r.body.toString('utf8'));
      if ((parsed.live?.length || 0) + (parsed.pregame?.length || 0) > 0 && !parsed.error_code) {
        payload = parsed;
      }
    }
  } catch (err) { console.warn('[proxy] CF forward error:', err?.message); }

  let live, pregame;
  if (payload && ODDS_API_KEY) {
    [live, pregame] = await Promise.all([
      enrichList(Array.isArray(payload.live)    ? payload.live    : [], 'live'),
      enrichList(Array.isArray(payload.pregame) ? payload.pregame : [], 'pregame'),
    ]);
  } else if (ODDS_API_KEY) {
    console.log('[proxy] CF Worker unavailable — using odds-api.io direct');
    const result = await buildFromOddsApi(sportsParam);
    live    = result.live;
    pregame = result.pregame;
  } else {
    return null;
  }

  const responsePayload = payload ? { ...payload, live, pregame } : { live, pregame };
  if (live.length > 0 || pregame.length > 0) {
    const buf = Buffer.from(JSON.stringify(responsePayload), 'utf8');
    rcSet(rcKey, buf);
    return buf;
  }
  return null;
}

// ── HTTP server ────────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', async () => {
    const reqBody = chunks.length ? Buffer.concat(chunks) : null;
    const url     = req.url || '';
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

    const rcKey  = url;
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
    } catch (err) { console.error('[proxy] error:', err?.message); }

    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ live: [], pregame: [] }));
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[proxy] Odds proxy on http://127.0.0.1:${PORT}`);
  console.log(`[proxy] Preferred: ${PREFERRED_BM}`);
  console.log(`[proxy] Filters: women ✓ | youth ✓ | amateur ✓ | 3rd-div ✓ | friendly ✓`);
  console.log(`[proxy] Limits: live ≤120 | pregame ≤60 | ODDS REQUIRED`);
});
server.on('error', e => { console.error('[proxy] fatal:', e.message); process.exit(1); });
