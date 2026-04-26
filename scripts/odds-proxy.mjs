#!/usr/bin/env node
/**
 * odds-proxy.mjs — Statpal.io data proxy (port 8080)
 *
 * Rules:
 *  - Block women's leagues, youth (U16-U23), amateur, 3rd division+, friendlies, Middle East
 *  - Only return events that have odds (home_odd > 1)
 *  - Live: max 120 events | Pregame: max 60 events
 *  - Odds suspended when Statpal status.blocked or status.stopped = "1"
 *  - Score-based market locking (totals lines already scored)
 */

import http  from 'http';
import https from 'https';

const CF_WORKER     = 'https://bet62apostasesportivas.bet62.workers.dev';
const PORT          = 8080;
const STATPAL_KEY   = process.env.STATPAL_KEY  || '';
const STATPAL_BASE  = 'https://statpal.io/api/v2/soccer';

if (!STATPAL_KEY) console.warn('[proxy] WARNING: STATPAL_KEY not set');

// ── Top league IDs for prematch odds ────────────────────────────────────────
const TOP_LEAGUE_IDS = [
  3037,  // England Premier League
  3062,  // Germany Bundesliga
  3058,  // Germany Bundesliga 2
  3054,  // France Ligue 1
  3102,  // Italy Serie A
  3232,  // Spain Primera (La Liga)
  3185,  // Portugal Primeira Liga
  3186,  // Portugal Liga 2
  3155,  // Netherlands Eredivisie
  2838,  // UEFA Champions League
  2840,  // UEFA Europa League
  20686, // UEFA Europa Conference League
  2935,  // Belgium Pro League
  3203,  // Scotland Premier League
  3065,  // Greece Super League
  3258,  // Turkey Super Lig
  3290,  // Russia Premier League
  3241,  // Switzerland Super League
  3214,  // Serbia Super Liga
  2974,  // Brazil Serie A
  2914,  // Argentina Primera Division
  3156,  // Netherlands Eerste Divisie
];

// ── Statpal live market ID → canonical key ──────────────────────────────────
const LIVE_MKT_MAP = {
  '3610':  'h2h',
  '91841': 'totals',
  '2254':  'totals',
  '1844':  'handicap',
  '1845':  'handicap',
  '12398': 'btts',
  '11834': 'correct_score',
  '1849':  'corners_total',
  '2353':  'corners_total',
  '91839': 'corners_total',
  '2151':  'btts_second_half',
  '1834':  'team_totals',
  '2835':  'team_totals',
  '2140':  'clean_sheet',
  '1836':  'second_half_h2h',
  '12395': 'goals_odd_even',
  '1877':  'next_goal',
  '52294': 'result_btts',
  '2833':  'first_goal',
};

// ── Statpal prematch market ID → canonical key ──────────────────────────────
const PRE_MKT_MAP = {
  '1834': 'h2h',
  '1835': 'dnb',
  '1836': 'second_half_h2h',
  '1837': 'handicap',
  '1838': 'totals',
  '1839': 'first_half_totals',
  '1840': 'second_half_totals',
  '1845': 'half_time_full_time',
  '1848': 'btts',
  '1914': 'correct_score',
  '2055': 'double_chance',
  '3935': 'first_half_h2h',
};

// ── Market category display names ────────────────────────────────────────────
const MKT_CATEGORY = {
  h2h:                  'Mercado Raiz',
  totals:               'Mercado Raiz',
  handicap:             'Mercado Raiz',
  spreads:              'Mercado Raiz',
  btts:                 'Mercados de Resultado',
  double_chance:        'Mercados de Resultado',
  dnb:                  'Mercados de Resultado',
  correct_score:        'Mercados de Gols',
  first_goal_scorer:    'Mercados de Jogadores',
  anytime_goal_scorer:  'Mercados de Jogadores',
  first_half_h2h:       'Mercados Temporais',
  first_half_totals:    'Mercados Temporais',
  second_half_h2h:      'Mercados Temporais',
  second_half_totals:   'Mercados Temporais',
  half_time_full_time:  'Mercados Temporais',
  corners_total:        'Mercados Estatísticos',
  cards_total:          'Mercados Estatísticos',
  team_totals:          'Mercados de Gols',
  clean_sheet:          'Mercados Especiais',
  btts_second_half:     'Mercados Temporais',
  goals_odd_even:       'Mercados Especiais',
  next_goal:            'Mercados Especiais',
  result_btts:          'Mercados Especiais',
  first_goal:           'Mercados Especiais',
};

const MKT_NAMES = {
  h2h:                  'Resultado Final',
  totals:               'Mais/Menos Gols',
  handicap:             'Handicap',
  btts:                 'Ambas Marcam',
  double_chance:        'Dupla Chance',
  dnb:                  'Empate Anula Aposta',
  correct_score:        'Marcador Correto',
  half_time_full_time:  'Intervalo/Final',
  first_half_h2h:       '1º Tempo - Resultado',
  second_half_h2h:      '2º Tempo - Resultado',
  first_half_totals:    '1º Tempo - Mais/Menos',
  second_half_totals:   '2º Tempo - Mais/Menos',
  corners_total:        'Cantos',
  clean_sheet:          'Sem Sofrer Golo',
  btts_second_half:     '2º Tempo - Ambas Marcam',
  goals_odd_even:       'Gols Par/Ímpar',
  next_goal:            'Próximo Golo',
  result_btts:          'Resultado + Ambas Marcam',
  first_goal:           'Primeiro Golo',
  team_totals:          'Total por Equipe',
};

// ── League filtering ─────────────────────────────────────────────────────────
const WOMEN_RE   = /\b(women|woman|féminin|feminine|feminino|feminina|mulheres|damen|dames|damallsvenskan|toppserien|kvinner|kvinder|naiset|naisten|feminil|femenino|femmes|nők|ženy|ženske|nő|kobiety|females?|women's|wsl|nwsl|d1[\s_]arkema|serie[\s_]a[\s_]women)\b/i;
const YOUTH_RE   = /\b(u-?1[6789]|u-?20|u-?21|u-?22|u-?23|under-?1[6789]|under-?20|under-?21|under-?22|under-?23|youth|junior|juvenil|juvenis|jugend|cadete|infantil|sub-?1[6789]|sub-?20|sub-?21|sub-?22|sub-?23|u21|u23|u20|u19|u18|u17|revelacao|revelação)\b/i;
const AMATEUR_RE = /\b(amateur|amateurs|amateure|amador|amatör)\b/i;
const FRIENDLY_RE = /\b(friendly|friendlies|amistoso|amistosos|amical|freundschaft|testspiel|preseason|pre-?season)\b/i;
const BLOCKED_ME  = new Set(['saudi arabia','qatar','united arab emirates','uae','kuwait','bahrain','oman','jordan','iraq','syria','lebanon','palestine','palestinian territory','yemen','iran']);
const LOW_TIER_RE = /\b(iii[\s_-]liga|liga[\s_-]iii|3[.\s]liga|liga[\s_-]3|ligue[\s_-]3|serie[\s_-][cd]|tercera|3rd[\s_-]div|division[\s_-]3|div[\s_-]3|gamma[\s_-]ethniki|nb[\s_-]iii|segunda[\s_-]b|tercera[\s_-]rfef|regionalliga|kakkonen|kolmonen|vtora[\s_-]liga|dritte|esiliiga|ii[\s_-]liiga|ii[\s_-]lyga|derde[\s_-]divisie|derde[\s_-]klasse|liga[\s_-][456]|promozione|eccellenza|interregional)\b/i;

function isBlockedLeague(name, country) {
  if (!name) return false;
  const ctry = String(country || '').toLowerCase().replace(/[\s_]/g, '');
  if (BLOCKED_ME.has(ctry) || BLOCKED_ME.has(String(country || '').toLowerCase())) return true;
  if (WOMEN_RE.test(name))   return true;
  if (YOUTH_RE.test(name))   return true;
  if (AMATEUR_RE.test(name)) return true;
  if (FRIENDLY_RE.test(name)) return true;
  if (LOW_TIER_RE.test(name)) return true;
  return false;
}

// ── Simple TTL cache ─────────────────────────────────────────────────────────
const _cache = new Map();
function cGet(k) { const e = _cache.get(k); return e && e.exp > Date.now() ? e.data : null; }
function cSet(k, d, ttl) { _cache.set(k, { exp: Date.now() + ttl, data: d }); }

// ── Event store ──────────────────────────────────────────────────────────────
const _eventsById = new Map();
let _liveCache   = [];
let _pregameCache = [];
let _cacheTs = 0;
const LIVE_TTL    = 30_000;
const PREGAME_TTL = 120_000;
let _refreshing = false;

// ── Statpal API fetch ────────────────────────────────────────────────────────
async function statpalGet(path) {
  const sep = path.includes('?') ? '&' : '?';
  const url = `${STATPAL_BASE}${path}${sep}access_key=${STATPAL_KEY}`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(14_000) });
    if (!r.ok) { console.warn(`[proxy] Statpal HTTP ${r.status} → ${path}`); return null; }
    return r.json();
  } catch (e) { console.warn('[proxy] Statpal error:', e?.message); return null; }
}

// ── Outcome name translation ─────────────────────────────────────────────────
// Normalize totals line to half-value (e.g. 2 → 2.5, 3 → 3.5)
// Football/sports over-under lines are always half-lines to avoid push outcomes
function normalizeHalfLine(raw) {
  const str = String(raw || '').trim();
  if (!str) return str;
  const n = parseFloat(str);
  if (!Number.isFinite(n)) return str;
  return Number.isInteger(n) ? String(n + 0.5) : str;
}

function translateOutcome(name, canonical) {
  const n = String(name || '').toLowerCase().trim();
  const MAP = { home:'Casa', '1':'Casa', draw:'Empate', x:'Empate', away:'Fora', '2':'Fora', over:'Mais', under:'Menos', yes:'Sim', no:'Não', gg:'Sim', ng:'Não' };
  if (MAP[n]) return MAP[n];
  return name;
}

// ── Normalize Statpal LIVE odds → BET62 format ───────────────────────────────
function normalizeLiveOdds(statpalOdds, isSuspended, totalGoals) {
  const oddsObj   = {};
  const marketsArr = [];
  const partialTotals = {};
  const partialCorners = {};
  const handicapAgg = {};
  let h2h = null;

  for (const market of (statpalOdds || [])) {
    const mktId    = String(market.market_id || '');
    const canonical = LIVE_MKT_MAP[mktId];
    if (!canonical) continue;

    const mktSusp = isSuspended || market.suspended === '1';
    const lines   = Array.isArray(market.lines) ? market.lines : [];

    // ── H2H ──────────────────────────────────────────────────────────────────
    if (canonical === 'h2h') {
      if (h2h) continue;
      const getOdd = (n) => parseFloat(lines.find(l => l.name?.toLowerCase() === n)?.odd || '0');
      const ho = getOdd('home'), dr = getOdd('draw'), aw = getOdd('away');
      if (ho > 1) {
        h2h = { home: ho, draw: dr, away: aw };
        const ocs = [
          { outcome: 'Casa',   odd: ho, suspended: mktSusp },
          ...(dr > 1 ? [{ outcome: 'Empate', odd: dr, suspended: mktSusp }] : []),
          { outcome: 'Fora',   odd: aw, suspended: mktSusp },
        ];
        oddsObj.h2h = { category: MKT_CATEGORY.h2h, outcomes: ocs, suspended: mktSusp };
        marketsArr.push({ key: 'h2h', name: MKT_NAMES.h2h, suspended: mktSusp, selections: ocs.map(o => ({ label: o.outcome, odd: o.odd })) });
        // Derive Double Chance
        if (dr > 1) {
          const dc1x = parseFloat((1 / (1/ho + 1/dr) * 0.93).toFixed(2));
          const dcx2 = parseFloat((1 / (1/dr + 1/aw) * 0.93).toFixed(2));
          const dc12 = parseFloat((1 / (1/ho + 1/aw) * 0.93).toFixed(2));
          if (dc1x > 1 && dcx2 > 1 && dc12 > 1) {
            const dcOcs = [
              { outcome: '1X', odd: dc1x, suspended: mktSusp },
              { outcome: 'X2', odd: dcx2, suspended: mktSusp },
              { outcome: '12', odd: dc12, suspended: mktSusp },
            ];
            oddsObj.double_chance = { category: MKT_CATEGORY.double_chance, outcomes: dcOcs, suspended: mktSusp };
            marketsArr.push({ key: 'double_chance', name: MKT_NAMES.double_chance, suspended: mktSusp, selections: dcOcs.map(o => ({ label: o.outcome, odd: o.odd })) });
          }
        }
      }
      continue;
    }

    // ── Totals (Over/Under goals) ─────────────────────────────────────────────
    if (canonical === 'totals') {
      for (const l of lines) {
        const hcapRaw = String(l.handicap || '').trim();
        if (!hcapRaw) continue;
        const hcap = normalizeHalfLine(hcapRaw);
        const lbl   = String(l.name || '').toLowerCase();
        const price = parseFloat(l.odd || '0');
        if (price <= 1) continue;
        if (!partialTotals[hcap]) partialTotals[hcap] = { over: 0, under: 0, susp: mktSusp || l.suspended === '1' };
        if (lbl === 'over')  partialTotals[hcap].over  = price;
        if (lbl === 'under') partialTotals[hcap].under = price;
      }
      continue;
    }

    // ── Corners ───────────────────────────────────────────────────────────────
    if (canonical === 'corners_total') {
      for (const l of lines) {
        const hcapRaw = String(l.handicap || '').trim();
        if (!hcapRaw) continue;
        const hcap = normalizeHalfLine(hcapRaw);
        const lbl   = String(l.name || '').toLowerCase();
        const price = parseFloat(l.odd || '0');
        if (price <= 1) continue;
        if (!partialCorners[hcap]) partialCorners[hcap] = { over: 0, under: 0, susp: mktSusp };
        if (lbl === 'over')  partialCorners[hcap].over  = price;
        if (lbl === 'under') partialCorners[hcap].under = price;
      }
      continue;
    }

    // ── Handicap ──────────────────────────────────────────────────────────────
    if (canonical === 'handicap') {
      for (const l of lines) {
        const hcap  = String(l.handicap || '').trim() || '0';
        const lbl   = String(l.name || '').toLowerCase();
        const price = parseFloat(l.odd || '0');
        if (price <= 1) continue;
        if (!handicapAgg[hcap]) handicapAgg[hcap] = { home: 0, draw: 0, away: 0, susp: mktSusp };
        if (lbl === 'home' || lbl === '1') handicapAgg[hcap].home = price;
        if (lbl === 'draw' || lbl === 'x') handicapAgg[hcap].draw = price;
        if (lbl === 'away' || lbl === '2') handicapAgg[hcap].away = price;
      }
      continue;
    }

    // ── BTTS ──────────────────────────────────────────────────────────────────
    if (canonical === 'btts' || canonical === 'btts_second_half') {
      if (oddsObj[canonical]) continue;
      const yes = parseFloat(lines.find(l => l.name?.toLowerCase() === 'yes')?.odd || '0');
      const no  = parseFloat(lines.find(l => l.name?.toLowerCase() === 'no')?.odd  || '0');
      if (yes > 1 || no > 1) {
        const ocs = [
          ...(yes > 1 ? [{ outcome: 'Sim', odd: yes, suspended: mktSusp }] : []),
          ...(no  > 1 ? [{ outcome: 'Não', odd: no,  suspended: mktSusp }] : []),
        ];
        const nm = canonical === 'btts' ? MKT_NAMES.btts : MKT_NAMES.btts_second_half;
        oddsObj[canonical] = { category: MKT_CATEGORY[canonical], outcomes: ocs, suspended: mktSusp };
        marketsArr.push({ key: canonical, name: nm, suspended: mktSusp, selections: ocs.map(o => ({ label: o.outcome, odd: o.odd })) });
      }
      continue;
    }

    // ── Correct Score ─────────────────────────────────────────────────────────
    if (canonical === 'correct_score') {
      if (oddsObj.correct_score) continue;
      const ocs = lines.filter(l => parseFloat(l.odd || '0') > 1).map(l => ({
        outcome: String(l.name || ''),
        odd: parseFloat(l.odd || '0'),
        suspended: mktSusp || l.suspended === '1',
      }));
      if (ocs.length) {
        oddsObj.correct_score = { category: MKT_CATEGORY.correct_score, outcomes: ocs, suspended: mktSusp };
        marketsArr.push({ key: 'correct_score', name: MKT_NAMES.correct_score, suspended: mktSusp, selections: ocs.map(o => ({ label: o.outcome, odd: o.odd })) });
      }
      continue;
    }

    // ── Second Half H2H ──────────────────────────────────────────────────────
    if (canonical === 'second_half_h2h') {
      if (oddsObj.second_half_h2h) continue;
      const getOdd = (n) => parseFloat(lines.find(l => l.name?.toLowerCase() === n)?.odd || '0');
      const ho = getOdd('home'), dr = getOdd('draw'), aw = getOdd('away');
      if (ho > 1) {
        const ocs = [
          { outcome: 'Casa', odd: ho, suspended: mktSusp },
          ...(dr > 1 ? [{ outcome: 'Empate', odd: dr, suspended: mktSusp }] : []),
          { outcome: 'Fora', odd: aw, suspended: mktSusp },
        ];
        oddsObj.second_half_h2h = { category: MKT_CATEGORY.second_half_h2h, outcomes: ocs, suspended: mktSusp };
        marketsArr.push({ key: 'second_half_h2h', name: MKT_NAMES.second_half_h2h, suspended: mktSusp, selections: ocs.map(o => ({ label: o.outcome, odd: o.odd })) });
      }
      continue;
    }

    // ── Generic (goals_odd_even, next_goal, result_btts, first_goal, team_totals) ──
    if (!oddsObj[canonical]) {
      const ocs = lines.filter(l => parseFloat(l.odd || '0') > 1).map(l => ({
        outcome: translateOutcome(l.name, canonical),
        odd: parseFloat(l.odd || '0'),
        suspended: mktSusp || l.suspended === '1',
      }));
      if (ocs.length) {
        oddsObj[canonical] = { category: MKT_CATEGORY[canonical] || 'Mercados Especiais', outcomes: ocs, suspended: mktSusp };
        marketsArr.push({ key: canonical, name: MKT_NAMES[canonical] || canonical, suspended: mktSusp, selections: ocs.map(o => ({ label: o.outcome, odd: o.odd })) });
      }
    }
  }

  // ── Aggregate Totals ─────────────────────────────────────────────────────────
  const sortedTotalLines = Object.entries(partialTotals)
    .filter(([, v]) => v.over || v.under)
    .sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]));

  if (sortedTotalLines.length) {
    const aggOcs = [];
    for (const [line, v] of sortedTotalLines) {
      // Score-based locking: if total goals already exceeds line, suspend that line
      const lineNum  = parseFloat(line);
      const scored   = isSuspended || (totalGoals !== null && totalGoals > lineNum);
      const lineSusp = v.susp || scored;
      if (v.over > 1)  aggOcs.push({ outcome: `Mais ${line}`,  odd: v.over,  suspended: lineSusp });
      if (v.under > 1) aggOcs.push({ outcome: `Menos ${line}`, odd: v.under, suspended: lineSusp });
      marketsArr.push({ key: 'totals', name: `Mais/Menos ${line}`, line, suspended: lineSusp, selections: [
        ...(v.over  > 1 ? [{ label: `Mais ${line}`,  odd: v.over }]  : []),
        ...(v.under > 1 ? [{ label: `Menos ${line}`, odd: v.under }] : []),
      ]});
    }
    oddsObj.totals = { category: MKT_CATEGORY.totals, outcomes: aggOcs, suspended: isSuspended };
  }

  // ── Aggregate Corners ────────────────────────────────────────────────────────
  const sortedCornerLines = Object.entries(partialCorners)
    .filter(([, v]) => v.over || v.under)
    .sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]));

  if (sortedCornerLines.length) {
    const aggOcs = [];
    for (const [line, v] of sortedCornerLines) {
      const lineSusp = v.susp;
      if (v.over > 1)  aggOcs.push({ outcome: `Mais ${line}`,  odd: v.over,  suspended: lineSusp });
      if (v.under > 1) aggOcs.push({ outcome: `Menos ${line}`, odd: v.under, suspended: lineSusp });
      marketsArr.push({ key: 'corners_total', name: `Cantos +/-${line}`, line, suspended: lineSusp, selections: [
        ...(v.over  > 1 ? [{ label: `Mais ${line}`,  odd: v.over }]  : []),
        ...(v.under > 1 ? [{ label: `Menos ${line}`, odd: v.under }] : []),
      ]});
    }
    oddsObj.corners_total = { category: MKT_CATEGORY.corners_total, outcomes: aggOcs, suspended: isSuspended };
  }

  // ── Aggregate Handicap ───────────────────────────────────────────────────────
  const hdcLines = Object.entries(handicapAgg).filter(([, v]) => v.home || v.away);
  if (hdcLines.length) {
    const hdcAggOcs = [];
    for (const [hcap, v] of hdcLines) {
      const ls = (hcap.startsWith('-') ? '' : '+') + hcap;
      if (v.home > 1) hdcAggOcs.push({ outcome: `Casa (${ls})`, odd: v.home, suspended: v.susp });
      if (v.draw > 1) hdcAggOcs.push({ outcome: `Empate (${ls})`, odd: v.draw, suspended: v.susp });
      if (v.away > 1) hdcAggOcs.push({ outcome: `Fora (${ls})`, odd: v.away, suspended: v.susp });
      marketsArr.push({ key: 'handicap', name: `Handicap ${ls}`, line: hcap, suspended: v.susp, selections: [
        ...(v.home > 1 ? [{ label: `Casa (${ls})`, odd: v.home }] : []),
        ...(v.draw > 1 ? [{ label: `Empate (${ls})`, odd: v.draw }] : []),
        ...(v.away > 1 ? [{ label: `Fora (${ls})`, odd: v.away }] : []),
      ]});
    }
    oddsObj.handicap = { category: MKT_CATEGORY.handicap, outcomes: hdcAggOcs, suspended: isSuspended };
    oddsObj.spreads  = oddsObj.handicap;
  }

  return { h2h, oddsObj, marketsArr };
}

// ── Normalize Statpal live match → BET62 event ───────────────────────────────
function normalizeLiveMatch(m) {
  const info   = m.match_info  || {};
  const ti     = m.team_info   || {};
  const status = m.status      || {};
  const stats  = m.stats       || {};

  const homeTeam = ti.home?.name || String(info.name || '').split(' vs ')[0]?.trim() || '';
  const awayTeam = ti.away?.name || String(info.name || '').split(' vs ')[1]?.trim() || '';
  if (!homeTeam || !awayTeam) return null;

  const leagueName = String(info.league || '');
  const country    = String(info.country || '').toLowerCase();
  if (isBlockedLeague(leagueName, country)) return null;

  const homeScore = parseInt(ti.home?.score || info.score?.split(':')?.[0] || '0', 10);
  const awayScore = parseInt(ti.away?.score || info.score?.split(':')?.[1] || '0', 10);
  const totalGoals = homeScore + awayScore;

  const isSuspended = status.blocked === '1' || status.stopped === '1';

  const { h2h, oddsObj, marketsArr } = normalizeLiveOdds(m.odds || [], isSuspended, totalGoals);
  if (!h2h) return null;

  const minute = info.minute ? parseInt(info.minute, 10) : null;

  // Parse stats
  const statArr = Object.values(stats);
  const getStat = (name) => {
    const s = statArr.find(x => x.name === name);
    return s ? { home: parseInt(s.home || '0', 10), away: parseInt(s.away || '0', 10) } : { home: 0, away: 0 };
  };
  const statsData = {
    possession:   getStat('Posession'),
    corners:      getStat('Corner'),
    yellowCards:  getStat('YellowCard'),
    redCards:     getStat('RedCard'),
    onTarget:     getStat('OnTarget'),
    offTarget:    getStat('OffTarget'),
    attacks:      getStat('Attacks'),
    dangerousAttacks: getStat('DangerousAttacks'),
    shots: {
      home: getStat('OnTarget').home + getStat('OffTarget').home,
      away: getStat('OnTarget').away + getStat('OffTarget').away,
    },
  };

  const matchId = String(info.main_id || info.fallback_id_1 || `${homeTeam}${awayTeam}`.replace(/\s/g,''));
  const evId = `sp_${matchId}`;

  const ev = {
    id:           evId,
    external_event_id: evId,
    sport:        'soccer',
    league:       leagueName,
    league_name:  leagueName,
    league_id:    info.league_id,
    home_team:    homeTeam,
    away_team:    awayTeam,
    team_match:   `${homeTeam} vs ${awayTeam}`,
    event_date:   info.start_ts ? new Date(parseInt(info.start_ts, 10) * 1000).toISOString() : new Date().toISOString(),
    status:       'LIVE',
    is_live:      1,
    home_odd:     h2h.home,
    draw_odd:     h2h.draw || 0,
    away_odd:     h2h.away,
    elapsed:      minute ?? 0,
    timer:        minute != null ? String(minute) : 'AO VIVO',
    period:       info.period || '',
    score:        JSON.stringify({ home: homeScore, away: awayScore }),
    goals:        { home: homeScore, away: awayScore },
    suspended:    isSuspended,
    markets:      marketsArr,
    odds:         oddsObj,
    statsData,
    match_events: Array.isArray(m.match_events) ? m.match_events : [],
    state_name:   info.state_name || '',
    country,
    home_team_logo: '',
    away_team_logo: '',
  };

  _eventsById.set(evId, ev);
  return ev;
}

// ── Fetch live matches from Statpal ──────────────────────────────────────────
async function fetchLive() {
  const data = await statpalGet('/odds/live');
  if (!data) return [];
  const matches = data.live_matches || [];
  const result = matches.map(normalizeLiveMatch).filter(Boolean);
  console.log(`[proxy] Statpal live: ${result.length}/${matches.length} events after filter`);
  return result.slice(0, 120);
}

// ── Normalize Statpal prematch odds ──────────────────────────────────────────
function extractBmOdds(market) {
  const bms = Array.isArray(market.bookmaker) ? market.bookmaker : (market.bookmaker ? [market.bookmaker] : []);
  if (!bms.length) return { odd: [], total: null };
  const bm = bms.find(b => b.name?.toLowerCase().includes('bet365')) || bms.find(b => b.name?.toLowerCase().includes('betway')) || bms[0];
  return { odd: Array.isArray(bm?.odd) ? bm.odd : [], total: Array.isArray(bm?.total) ? bm.total : null };
}

function normalizePrematchOdds(matchOdds) {
  const oddsObj   = {};
  const marketsArr = [];
  const partialTotals = {};
  let h2h = null;

  for (const market of (matchOdds || [])) {
    const mktId    = String(market.id || '');
    const canonical = PRE_MKT_MAP[mktId];
    if (!canonical) continue;
    const mktStop = market.stop === 'True' || market.stop === true;
    const { odd, total } = extractBmOdds(market);

    // ── H2H ─────────────────────────────────────────────────────────────────
    if (canonical === 'h2h') {
      if (h2h) continue;
      const getOdd = (n) => parseFloat(odd.find(o => o.name?.toLowerCase() === n)?.value || '0');
      const ho = getOdd('home'), dr = getOdd('draw'), aw = getOdd('away');
      if (ho > 1) {
        h2h = { home: ho, draw: dr, away: aw };
        const ocs = [
          { outcome: 'Casa', odd: ho },
          ...(dr > 1 ? [{ outcome: 'Empate', odd: dr }] : []),
          { outcome: 'Fora', odd: aw },
        ];
        oddsObj.h2h = { category: MKT_CATEGORY.h2h, outcomes: ocs };
        marketsArr.push({ key: 'h2h', name: MKT_NAMES.h2h, selections: ocs.map(o => ({ label: o.outcome, odd: o.odd })) });
        if (dr > 1) {
          const dc1x = parseFloat((1 / (1/ho + 1/dr) * 0.93).toFixed(2));
          const dcx2 = parseFloat((1 / (1/dr + 1/aw) * 0.93).toFixed(2));
          const dc12 = parseFloat((1 / (1/ho + 1/aw) * 0.93).toFixed(2));
          if (dc1x > 1) {
            const dcOcs = [{ outcome: '1X', odd: dc1x }, { outcome: 'X2', odd: dcx2 }, { outcome: '12', odd: dc12 }];
            oddsObj.double_chance = { category: MKT_CATEGORY.double_chance, outcomes: dcOcs };
            marketsArr.push({ key: 'double_chance', name: MKT_NAMES.double_chance, selections: dcOcs.map(o => ({ label: o.outcome, odd: o.odd })) });
          }
        }
      }
      continue;
    }

    // ── Totals (from `total` array) ─────────────────────────────────────────
    if (['totals', 'first_half_totals', 'second_half_totals'].includes(canonical)) {
      if (!total) continue;
      for (const t of total) {
        const lineRaw = String(t.name || '').trim();
        if (!lineRaw) continue;
        const line  = normalizeHalfLine(lineRaw);
        const bkey  = `${canonical}:${line}`;
        if (!partialTotals[bkey]) partialTotals[bkey] = { canonical, line, over: 0, under: 0 };
        for (const o of (Array.isArray(t.odd) ? t.odd : [])) {
          const lbl = String(o.name || '').toLowerCase();
          const val = parseFloat(o.value || '0');
          if (lbl === 'over')  partialTotals[bkey].over  = val;
          if (lbl === 'under') partialTotals[bkey].under = val;
        }
      }
      continue;
    }

    // ── BTTS ─────────────────────────────────────────────────────────────────
    if (canonical === 'btts') {
      if (oddsObj.btts) continue;
      const yes = parseFloat(odd.find(o => o.name?.toLowerCase() === 'yes')?.value || '0');
      const no  = parseFloat(odd.find(o => o.name?.toLowerCase() === 'no')?.value  || '0');
      if (yes > 1 || no > 1) {
        const ocs = [...(yes > 1 ? [{ outcome: 'Sim', odd: yes }] : []), ...(no > 1 ? [{ outcome: 'Não', odd: no }] : [])];
        oddsObj.btts = { category: MKT_CATEGORY.btts, outcomes: ocs };
        marketsArr.push({ key: 'btts', name: MKT_NAMES.btts, selections: ocs.map(o => ({ label: o.outcome, odd: o.odd })) });
      }
      continue;
    }

    // ── Correct Score ────────────────────────────────────────────────────────
    if (canonical === 'correct_score') {
      if (oddsObj.correct_score) continue;
      const ocs = odd.filter(o => parseFloat(o.value || '0') > 1).map(o => ({ outcome: String(o.name || ''), odd: parseFloat(o.value || '0') }));
      if (ocs.length) {
        oddsObj.correct_score = { category: MKT_CATEGORY.correct_score, outcomes: ocs };
        marketsArr.push({ key: 'correct_score', name: MKT_NAMES.correct_score, selections: ocs.map(o => ({ label: o.outcome, odd: o.odd })) });
      }
      continue;
    }

    // ── HT/FT Double ─────────────────────────────────────────────────────────
    if (canonical === 'half_time_full_time') {
      if (oddsObj.half_time_full_time) continue;
      const ocs = odd.filter(o => parseFloat(o.value || '0') > 1).map(o => ({ outcome: String(o.name || ''), odd: parseFloat(o.value || '0') }));
      if (ocs.length) {
        oddsObj.half_time_full_time = { category: MKT_CATEGORY.half_time_full_time, outcomes: ocs };
        marketsArr.push({ key: 'half_time_full_time', name: MKT_NAMES.half_time_full_time, selections: ocs.map(o => ({ label: o.outcome, odd: o.odd })) });
      }
      continue;
    }

    // ── DNB / 1st Half / 2nd Half H2H ────────────────────────────────────────
    if (['dnb', 'first_half_h2h', 'second_half_h2h'].includes(canonical)) {
      if (oddsObj[canonical]) continue;
      const getOdd = (n) => parseFloat(odd.find(o => o.name?.toLowerCase() === n)?.value || '0');
      const ho = getOdd('home'), dr = getOdd('draw'), aw = getOdd('away');
      if (ho > 1) {
        const ocs = [{ outcome: 'Casa', odd: ho }, ...(dr > 1 ? [{ outcome: 'Empate', odd: dr }] : []), { outcome: 'Fora', odd: aw }];
        oddsObj[canonical] = { category: MKT_CATEGORY[canonical] || 'Mercados Temporais', outcomes: ocs };
        marketsArr.push({ key: canonical, name: MKT_NAMES[canonical] || canonical, selections: ocs.map(o => ({ label: o.outcome, odd: o.odd })) });
      }
      continue;
    }

    // ── Double Chance (explicit) ──────────────────────────────────────────────
    if (canonical === 'double_chance' && !oddsObj.double_chance) {
      const getOdd = (n) => parseFloat(odd.find(o => o.name?.toLowerCase().replace(/\s+/g, '') === n)?.value || '0');
      const h1x = getOdd('1x'), x2 = getOdd('x2'), h12 = getOdd('12');
      if (h1x > 1 || x2 > 1 || h12 > 1) {
        const ocs = [...(h1x > 1 ? [{ outcome: '1X', odd: h1x }] : []), ...(x2 > 1 ? [{ outcome: 'X2', odd: x2 }] : []), ...(h12 > 1 ? [{ outcome: '12', odd: h12 }] : [])];
        oddsObj.double_chance = { category: MKT_CATEGORY.double_chance, outcomes: ocs };
        marketsArr.push({ key: 'double_chance', name: MKT_NAMES.double_chance, selections: ocs.map(o => ({ label: o.outcome, odd: o.odd })) });
      }
    }
  }

  // Aggregate totals
  const sortedTlines = Object.entries(partialTotals)
    .filter(([, v]) => v.over || v.under)
    .sort((a, b) => parseFloat(a[1].line) - parseFloat(b[1].line));

  if (sortedTlines.length) {
    const aggOcs = [];
    for (const [, v] of sortedTlines) {
      if (v.over > 1)  aggOcs.push({ outcome: `Mais ${v.line}`,  odd: v.over });
      if (v.under > 1) aggOcs.push({ outcome: `Menos ${v.line}`, odd: v.under });
      marketsArr.push({ key: v.canonical, name: `Mais/Menos ${v.line}`, line: v.line, selections: [
        ...(v.over  > 1 ? [{ label: `Mais ${v.line}`,  odd: v.over }]  : []),
        ...(v.under > 1 ? [{ label: `Menos ${v.line}`, odd: v.under }] : []),
      ]});
    }
    oddsObj[sortedTlines[0][1].canonical] = { category: MKT_CATEGORY.totals, outcomes: aggOcs };
  }

  return { h2h, oddsObj, marketsArr };
}

// ── Normalize Statpal prematch match → BET62 event ───────────────────────────
function normalizePrematchMatch(match, leagueName, leagueId, country) {
  const homeTeam = match.home?.name || '';
  const awayTeam = match.away?.name || '';
  if (!homeTeam || !awayTeam) return null;
  if (isBlockedLeague(leagueName, country)) return null;

  const { h2h, oddsObj, marketsArr } = normalizePrematchOdds(match.odds || []);
  if (!h2h) return null;

  const matchId = String(match.main_id || `pre_${homeTeam}${awayTeam}`.replace(/\s/g, ''));
  const evId = `sp_${matchId}`;

  const dateStr = String(match.date || '').split('.').reverse().join('-');
  const timeStr = String(match.time || '00:00');
  const eventDate = dateStr ? `${dateStr}T${timeStr}:00.000Z` : new Date().toISOString();

  const ev = {
    id:           evId,
    external_event_id: evId,
    sport:        'soccer',
    league:       leagueName,
    league_name:  leagueName,
    league_id:    leagueId,
    home_team:    homeTeam,
    away_team:    awayTeam,
    team_match:   `${homeTeam} vs ${awayTeam}`,
    event_date:   eventDate,
    status:       'NS',
    is_live:      0,
    home_odd:     h2h.home,
    draw_odd:     h2h.draw || 0,
    away_odd:     h2h.away,
    elapsed:      0,
    timer:        '',
    period:       '',
    score:        JSON.stringify({ home: null, away: null }),
    goals:        { home: null, away: null },
    suspended:    false,
    markets:      marketsArr,
    odds:         oddsObj,
    country:      country || '',
    home_team_logo: '',
    away_team_logo: '',
  };

  _eventsById.set(evId, ev);
  return ev;
}

// ── Fetch prematch matches from Statpal ───────────────────────────────────────
async function fetchPrematch() {
  const results = await Promise.allSettled(
    TOP_LEAGUE_IDS.map(lid => statpalGet(`/leagues/${lid}/odds/prematch`))
  );

  const all = [];
  for (let i = 0; i < results.length; i++) {
    if (results[i].status !== 'fulfilled' || !results[i].value) continue;
    const data   = results[i].value;
    const league = data?.prematch_odds?.league;
    if (!league) continue;

    const leagueName = String(league.name || '');
    const leagueId   = TOP_LEAGUE_IDS[i];
    const country    = String(league.country || '').toLowerCase();
    const matches    = Array.isArray(league.match) ? league.match : (league.match ? [league.match] : []);

    for (const m of matches) {
      const ev = normalizePrematchMatch(m, leagueName, leagueId, country);
      if (ev) all.push(ev);
    }
  }

  // Sort by date ascending
  all.sort((a, b) => new Date(a.event_date) - new Date(b.event_date));
  console.log(`[proxy] Statpal prematch: ${all.length} events from ${TOP_LEAGUE_IDS.length} leagues`);
  return all.slice(0, 60);
}

// ── Background refresh ────────────────────────────────────────────────────────
async function refreshAll() {
  if (_refreshing) return;
  _refreshing = true;
  try {
    const [live, pregame] = await Promise.all([fetchLive(), fetchPrematch()]);
    _liveCache    = live;
    _pregameCache = pregame;
    _cacheTs      = Date.now();
    console.log(`[proxy] Refreshed: ${live.length} live, ${pregame.length} pregame`);
  } catch (e) {
    console.error('[proxy] Refresh error:', e?.message);
  }
  _refreshing = false;
}

// ── Get events (with cache) ───────────────────────────────────────────────────
async function getEvents() {
  const now = Date.now();
  if (_cacheTs === 0 || now - _cacheTs > LIVE_TTL) {
    await refreshAll();
  }
  return { live: _liveCache, pregame: _pregameCache };
}

// Initial load + interval refresh
refreshAll();
setInterval(() => refreshAll().catch(() => {}), LIVE_TTL);

// ── Forward to CF Worker ──────────────────────────────────────────────────────
function forwardToCF(reqUrl, method, headers, body) {
  return new Promise((resolve, reject) => {
    const target = new URL(CF_WORKER + reqUrl);
    const opts = {
      hostname: target.hostname,
      port: target.port || 443,
      path: target.pathname + target.search,
      method: method || 'GET',
      headers: { ...headers, host: target.hostname },
    };
    delete opts.headers['connection'];
    const mod = target.protocol === 'https:' ? https : http;
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

function sendJSON(res, data) {
  const buf = Buffer.from(JSON.stringify(data), 'utf8');
  res.writeHead(200, { 'content-type': 'application/json', 'content-length': buf.length, 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
  res.end(buf);
}

function sendBuf(res, buf, status = 200, ct = 'application/json') {
  res.writeHead(status, { 'content-type': ct, 'content-length': buf.length, 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
  res.end(buf);
}

// ── HTTP server ───────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', async () => {
    const reqBody = chunks.length ? Buffer.concat(chunks) : null;
    const url     = req.url || '';

    // ── Image proxy ─────────────────────────────────────────────────────────
    if (url.startsWith('/api/events/media')) {
      const urlObj = new URL('http://x' + url);
      const target = urlObj.searchParams.get('url');
      if (!target) { res.writeHead(400); res.end('Missing url'); return; }
      try {
        const r = await fetch(target, {
          headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'image/webp,image/*,*/*;q=0.8' },
          signal: AbortSignal.timeout(8000),
        });
        const buf = Buffer.from(await r.arrayBuffer());
        const ct  = r.headers.get('content-type') || 'image/png';
        res.writeHead(r.ok ? 200 : r.status, { 'content-type': ct, 'content-length': buf.length, 'cache-control': 'public, max-age=86400', 'access-control-allow-origin': '*' });
        res.end(buf);
      } catch { res.writeHead(502); res.end('Image fetch failed'); }
      return;
    }

    // ── by-sport (main events endpoint) ─────────────────────────────────────
    if (url.includes('/by-sport')) {
      try {
        const { live, pregame } = await getEvents();
        sendJSON(res, { live, pregame });
      } catch (e) {
        console.error('[proxy] by-sport error:', e?.message);
        sendJSON(res, { live: [], pregame: [] });
      }
      return;
    }

    // ── Event by ID: /api/events/:id ────────────────────────────────────────
    const evByIdMatch = url.match(/^\/api\/events\/(sp_[^/?]+)(?:[?/].*)?$/);
    if (evByIdMatch && !url.includes('/odds') && !url.includes('/stats') && !url.includes('/roster') && !url.includes('/media')) {
      const evId  = evByIdMatch[1];
      const cached = _eventsById.get(evId);
      if (cached) {
        sendJSON(res, cached);
      } else {
        res.writeHead(404, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
        res.end(JSON.stringify({ error: 'Event not found' }));
      }
      return;
    }

    // ── Event odds: /api/events/:id/odds ────────────────────────────────────
    const oddsMatch = url.match(/^\/api\/events\/([^/?]+)\/odds/);
    if (oddsMatch) {
      const evId = oddsMatch[1];
      const ev   = _eventsById.get(evId);
      if (ev?.odds && Object.keys(ev.odds).length > 0) {
        sendJSON(res, { markets: ev.odds, suspended: ev.suspended || false, suspended_reason: ev.suspended ? 'Lance crítico' : '' });
        return;
      }
      // Try CF Worker as fallback
      try {
        const { status, headers, body: cfBody } = await forwardToCF(url, req.method, req.headers, reqBody);
        sendBuf(res, cfBody, status, headers['content-type'] || 'application/json');
      } catch {
        res.writeHead(404, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
        res.end(JSON.stringify({ markets: {}, suspended: false }));
      }
      return;
    }

    // ── Event stats: /api/events/:id/stats ──────────────────────────────────
    const statsMatch = url.match(/^\/api\/events\/([^/?]+)\/stats/);
    if (statsMatch) {
      const evId = statsMatch[1];
      const ev   = _eventsById.get(evId);
      if (ev?.statsData) {
        const { statsData, match_events, state_name, goals, period, timer } = ev;
        // Convert Statpal stats to API-Football format for MatchTracker compatibility
        const sd = statsData;
        const poss = sd.possession || { home: 50, away: 50 };
        const afbStats = [
          {
            team: { id: 'home', name: ev.home_team },
            statistics: [
              { type: 'Ball Possession', value: poss.home > 0 ? `${poss.home}%` : '50%' },
              { type: 'Total Shots', value: sd.shots?.home ?? 0 },
              { type: 'Shots on Goal', value: sd.onTarget?.home ?? 0 },
              { type: 'Corner Kicks', value: sd.corners?.home ?? 0 },
              { type: 'Yellow Cards', value: sd.yellowCards?.home ?? 0 },
              { type: 'Red Cards', value: sd.redCards?.home ?? 0 },
            ],
          },
          {
            team: { id: 'away', name: ev.away_team },
            statistics: [
              { type: 'Ball Possession', value: poss.away > 0 ? `${poss.away}%` : '50%' },
              { type: 'Total Shots', value: sd.shots?.away ?? 0 },
              { type: 'Shots on Goal', value: sd.onTarget?.away ?? 0 },
              { type: 'Corner Kicks', value: sd.corners?.away ?? 0 },
              { type: 'Yellow Cards', value: sd.yellowCards?.away ?? 0 },
              { type: 'Red Cards', value: sd.redCards?.away ?? 0 },
            ],
          },
        ];
        // Convert Statpal match_events to AFB-like format for event timeline
        const afbEvents = (match_events || []).map((me, idx) => {
          const txt = String(me.event || '');
          const min = parseInt(me.minute || '0', 10);
          const isGoal = /goal|gol|\u26bd/i.test(txt);
          const isCard = /yellow|cartão|card/i.test(txt);
          const isCorner = /corner|escanteio/i.test(txt);
          const teamInText = txt.split('-').slice(1).join('-').replace(/[()]/g,'').trim();
          return {
            time: { elapsed: min },
            type: isGoal ? 'Goal' : isCard ? 'Card' : isCorner ? 'Corner' : 'Event',
            detail: txt,
            team: { id: null, name: teamInText || '' },
            player: { id: null, name: '' },
          };
        });
        sendJSON(res, { stats: afbStats, events: afbEvents, statsData, match_events: match_events || [], state_name, goals, period, timer });
        return;
      }
      // Fallback to CF Worker
      try {
        const { status, headers, body: cfBody } = await forwardToCF(url, req.method, req.headers, reqBody);
        sendBuf(res, cfBody, status, headers['content-type'] || 'application/json');
      } catch {
        res.writeHead(404, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
        res.end(JSON.stringify({ statsData: null }));
      }
      return;
    }

    // ── H2H: /api/events/:id/h2h ─────────────────────────────────────────────
    const h2hMatch = url.match(/^\/api\/events\/(sp_[^/?]+)\/h2h/);
    if (h2hMatch) {
      const evId = h2hMatch[1];
      const ev   = _eventsById.get(evId);
      const numId = evId.replace(/^sp_/, '');
      try {
        const data = await statpalGet(`/matches/${numId}/h2h`);
        const matches = data?.h2h || data?.matches || data?.previous || [];
        const formatted = (Array.isArray(matches) ? matches : []).slice(0, 10).map(m => ({
          date: m.date || m.match_date || '',
          home: m.home?.name || m.home_team || '',
          away: m.away?.name || m.away_team || '',
          scoreHome: m.home?.score ?? m.score_home ?? m.goals_home ?? null,
          scoreAway: m.away?.score ?? m.score_away ?? m.goals_away ?? null,
          competition: m.competition?.name || m.league || m.competition || '',
        }));
        sendJSON(res, { h2h: formatted, event: ev ? { home: ev.home_team, away: ev.away_team } : null });
      } catch {
        sendJSON(res, { h2h: [], event: ev ? { home: ev.home_team, away: ev.away_team } : null });
      }
      return;
    }

    // ── Standings: /api/leagues/:id/standings ────────────────────────────────
    const standingsMatch = url.match(/^\/api\/leagues\/([^/?]+)\/standings/);
    if (standingsMatch) {
      const leagueId = standingsMatch[1];
      try {
        const data = await statpalGet(`/leagues/${leagueId}/standings`);
        const table = data?.standings?.table || data?.table || data?.standings || [];
        const rows = (Array.isArray(table) ? table : []).map(row => ({
          position: row.position || row.rank || row.pos || '',
          team: row.team?.name || row.team_name || row.name || '',
          played: row.played || row.games || row.gp || 0,
          wins: row.wins || row.win || row.w || 0,
          draws: row.draws || row.draw || row.d || 0,
          losses: row.losses || row.loss || row.l || 0,
          goalsFor: row.goals_for || row.gf || row.scored || 0,
          goalsAgainst: row.goals_against || row.ga || row.conceded || 0,
          points: row.points || row.pts || row.p || 0,
        }));
        sendJSON(res, { standings: rows, leagueId });
      } catch {
        sendJSON(res, { standings: [], leagueId });
      }
      return;
    }

    // ── Sports list ──────────────────────────────────────────────────────────
    if (url.startsWith('/api/sports')) {
      sendJSON(res, [{ id: 'soccer', name: 'Futebol', slug: 'soccer', icon: '⚽' }]);
      return;
    }

    // ── All other routes → CF Worker ─────────────────────────────────────────
    try {
      const { status, headers, body: cfBody } = await forwardToCF(url, req.method, req.headers, reqBody);
      res.writeHead(status, { ...headers, 'access-control-allow-origin': '*' });
      res.end(cfBody);
    } catch {
      res.writeHead(502, { 'content-type': 'text/plain', 'access-control-allow-origin': '*' });
      res.end('Bad Gateway');
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[proxy] Statpal odds proxy running on http://127.0.0.1:${PORT}`);
  console.log(`[proxy] Live refresh: ${LIVE_TTL/1000}s | Prematch: ${PREGAME_TTL/1000}s`);
  console.log(`[proxy] Top leagues: ${TOP_LEAGUE_IDS.length} | Filters: women ✓ youth ✓ amateur ✓ 3rd-div ✓`);
});
server.on('error', e => { console.error('[proxy] fatal:', e.message); process.exit(1); });
