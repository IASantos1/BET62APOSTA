import { getDb } from '../db.js';

export const ODDS_API_BASE = 'https://api.odds-api.io/v3';
export const API_FOOTBALL_BASE   = 'https://v3.football.api-sports.io';
export const API_BASKETBALL_BASE = 'https://v1.basketball.api-sports.io';
export const API_HOCKEY_BASE     = 'https://v1.hockey.api-sports.io';
export const API_HANDBALL_BASE   = 'https://v1.handball.api-sports.io';
export const API_VOLLEYBALL_BASE = 'https://v1.volleyball.api-sports.io';
export const API_RUGBY_BASE      = 'https://v1.rugby.api-sports.io';
export const API_NFL_BASE        = 'https://v1.american-football.api-sports.io';

export const SPORT_CONFIG = {
  soccer:              { base: API_FOOTBALL_BASE,   endpoint: '/fixtures', liveParam: 'live=all',   dateParam: 'date={DATE}', fixtureKey: 'fixture' },
  basketball:          { base: API_BASKETBALL_BASE, endpoint: '/games',    liveParam: 'live=all',   dateParam: 'date={DATE}', fixtureKey: 'game'    },
  'ice-hockey':        { base: API_HOCKEY_BASE,     endpoint: '/games',    liveParam: 'live=all',   dateParam: 'date={DATE}', fixtureKey: 'game'    },
  handball:            { base: API_HANDBALL_BASE,   endpoint: '/games',    liveParam: 'live=all',   dateParam: 'date={DATE}', fixtureKey: 'game'    },
  volleyball:          { base: API_VOLLEYBALL_BASE, endpoint: '/games',    liveParam: 'live=all',   dateParam: 'date={DATE}', fixtureKey: 'game'    },
  rugby:               { base: API_RUGBY_BASE,      endpoint: '/games',    liveParam: 'live=all',   dateParam: 'date={DATE}', fixtureKey: 'game'    },
  'american-football': { base: API_NFL_BASE,        endpoint: '/games',    liveParam: 'live=all',   dateParam: 'date={DATE}', fixtureKey: 'game'    },
};

export const SPORT_SLUG_MAP = {
  soccer:              ['football'],
  basketball:          ['basketball'],
  'ice-hockey':        ['ice-hockey'],
  tennis:              ['tennis'],
  handball:            ['handball'],
  volleyball:          ['volleyball'],
  rugby:               ['rugby'],
  mma:                 ['mixed-martial-arts'],
  boxing:              ['boxing'],
  afl:                 ['aussie-rules'],
};

export const SPORT_MARKETS = {
  soccer:              'h2h,totals,btts,handicap,double_chance,h2h_ht,totals_ht,dnb,correct_score,spreads,corners_totals,cards_totals,team_totals,half_time_full_time,next_goal',
  basketball:          'h2h,totals,spreads,team_totals,double_chance,h2h_ht,totals_ht',
  'ice-hockey':        'h2h,totals,spreads,double_chance,team_totals,h2h_ht,totals_ht',
  tennis:              'h2h,totals,spreads',
  'american-football': 'h2h,totals,spreads,team_totals',
  handball:            'h2h,totals,handicap,double_chance,team_totals,h2h_ht,totals_ht',
  volleyball:          'h2h,totals,spreads,double_chance,team_totals,h2h_ht,totals_ht',
  rugby:               'h2h,totals,spreads',
  mma:                 'h2h',
  boxing:              'h2h,totals',
  afl:                 'h2h,totals,spreads',
  'formula-1':         'h2h',
};

export const DEFAULT_BOOKMAKERS = 'Bet365,1xbet,Betano,Betclic,Superbet';
export const DEFAULT_MARKETS    = 'h2h,totals,btts,handicap,double_chance,h2h_ht,totals_ht,dnb,correct_score,spreads,corners_totals,cards_totals,team_totals,half_time_full_time,next_goal';

export const FINISHED_STATUSES = [
  'FT','AET','PEN','AWD','WO','ABD','FIN','FINAL','Finished','Match Finished','Final','Ended','AOT','AP','POST','FT_PEN'
];

export const BLOCKED_LEAGUE_KEYWORDS = [
  '3. liga','terceira liga','liga 3','serie c','série c','vanarama','isthmian',
  'druha liga','esiliiga','i liga','serie d','série d','oberliga','regionalliga',
];

export const ALLOWED_SOCCER_COUNTRIES = new Set([
  'germany','argentina','belgium','brazil','colombia','denmark','scotland','spain','usa','france',
  'greece','england','italy','japan','mexico','netherlands','portugal','switzerland','turkey','uruguay','world',
  'international','global'
]);

export const ALLOWED_LEAGUES = [
  { country: 'germany', leagues: ['bundesliga','2. bundesliga','dfb pokal','dfb-pokal','dfl supercup','super cup'] },
  { country: 'argentina', leagues: ['liga profesional','primera division','copa argentina','primera nacional','supercopa argentina'] },
  { country: 'belgium', leagues: ['jupiler pro league','pro league','belgian cup','beker van belgie','coupe de belgique','super cup'] },
  { country: 'brazil', leagues: ['serie a','série a','brasileirao','serie b','série b','copa do brasil','supercopa do brasil','paulista','paulistão','carioca','mineiro','gaucho','gaúcho','baiano','pernambucano','cearense','goiano','catarinense','paranaense','alagoano','paraense','potiguar'] },
  { country: 'colombia', leagues: ['primera a','primeira a','primera b','copa colombia'] },
  { country: 'denmark', leagues: ['superliga','danish cup','dbu pokalen','super cup'] },
  { country: 'scotland', leagues: ['premiership','scottish premiership','scottish cup','championship','scottish championship','league cup'] },
  { country: 'spain', leagues: ['la liga','primera division','laliga','la liga 2','segunda division','laliga2','copa del rey','supercopa de espana','supercopa'] },
  { country: 'usa', leagues: ['major league soccer','mls','us open cup','usl championship','usl'] },
  { country: 'france', leagues: ['ligue 1','ligue 2','coupe de france','trophee des champions','trophée des champions'] },
  { country: 'greece', leagues: ['super league','super league 1','greek cup'] },
  { country: 'england', leagues: ['premier league','championship','fa cup','efl cup','carabao cup','league cup','league one','league two','community shield'] },
  { country: 'italy', leagues: ['serie a','serie b','coppa italia','supercoppa italiana','super cup'] },
  { country: 'japan', leagues: ['j1 league','j-league','j2 league',"emperor's cup",'emperor cup','j-league cup'] },
  { country: 'mexico', leagues: ['liga mx','copa mx','liga de expansion','liga de expansión','campeon de campeones'] },
  { country: 'netherlands', leagues: ['eredivisie','eerste divisie','knvb beker','johan cruijff schaal','super cup'] },
  { country: 'portugal', leagues: ['primeira liga','liga portugal','liga portugal 2','liga nos','taca de portugal','taça de portugal','taca da liga','taça da liga','supertaça','supertaca'] },
  { country: 'switzerland', leagues: ['super league','swiss cup','challenge league'] },
  { country: 'turkey', leagues: ['super lig','süper lig','turkish cup','1. lig','super cup'] },
  { country: 'uruguay', leagues: ['primera division','primera división','copa uruguay'] },
  { country: 'world', leagues: ['uefa champions league','uefa europa league','uefa europa conference league','uefa conference league','uefa euro','european championship','uefa nations league','world cup','copa do mundo','fifa intercontinental cup','club world cup','fifa club world cup','copa america','copa américa','copa libertadores','conmebol libertadores','copa sudamericana','conmebol sudamericana','recopa sudamericana','supercopa de europa','uefa super cup'] },
];

export function isLeagueAllowed(leagueName, country) {
  if (!leagueName) return false;
  const l = leagueName.toLowerCase();
  const countryMap = {
    'brasil':'brazil','england':'england','espanha':'spain','españa':'spain',
    'itália':'italy','italia':'italy','france':'france','França':'france','franca':'france',
    'alemanha':'germany','bélgica':'belgium','belgica':'belgium','países baixos':'netherlands',
    'holanda':'netherlands','escócia':'scotland','escocia':'scotland','turquia':'turkey',
    'suíça':'switzerland','suica':'switzerland','grécia':'greece','grecia':'greece',
    'dinamarca':'denmark','méxico':'mexico','mexico':'mexico','japão':'japan','japao':'japan',
    'estados unidos':'usa','eua':'usa','uruguai':'uruguay','colômbia':'colombia','colombia':'colombia',
    'mundo':'world','internacional':'world','international':'world','global':'world',
  };
  if (!country || !country.trim()) {
    return ALLOWED_LEAGUES.some(conf => conf.leagues.some(a => l.includes(a)));
  }
  const c = countryMap[country.toLowerCase().trim()] || country.toLowerCase().trim();
  const config = ALLOWED_LEAGUES.find(conf => conf.country === c);
  if (!config) return false;
  return config.leagues.some(a => l.includes(a));
}

export function isBlocked(league) {
  const l = (league || '').toLowerCase();
  return BLOCKED_LEAGUE_KEYWORDS.some(k => l.includes(k));
}

export async function safeFetch(url, headers = {}) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    const r = await fetch(url, { headers, signal: controller.signal });
    clearTimeout(timer);
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      console.warn(`[SportsSync] HTTP ${r.status} → ${url.split('?')[0]} | ${body.slice(0, 120)}`);
      return null;
    }
    return await r.json();
  } catch (err) {
    if (err.name !== 'AbortError') console.warn(`[SportsSync] fetch error: ${err.message}`);
    return null;
  }
}

export async function runPool(items, concurrency, fn) {
  const results = [];
  let idx = 0;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

export function normKey(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '').trim();
}

const ODDS_API_ALLOWED_BOOKMAKERS = ['Bet365', '1xbet', 'Betano', 'Superbet', 'Betclic'];

function normalizeOddsApiBookmakers(bookmakers) {
  const parts = String(bookmakers || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  const allowedByNorm = new Map(ODDS_API_ALLOWED_BOOKMAKERS.map(b => [normKey(b), b]));

  const picked = [];
  const seen = new Set();
  for (const bm of parts) {
    const allowed = allowedByNorm.get(normKey(bm));
    if (!allowed) continue;
    if (seen.has(allowed)) continue;
    picked.push(allowed);
    seen.add(allowed);
    if (picked.length >= 5) break;
  }

  if (picked.length === 0) return ODDS_API_ALLOWED_BOOKMAKERS.join(',');
  return picked.join(',');
}

export function getOddsApiBookmakers() {
  const envBooks = String(process.env.ODDS_API_BOOKMAKERS || '').trim();
  return envBooks;
}

export function toMarketKey(name) {
  const n = String(name || '').toLowerCase().trim();
  // ── H2H / Moneyline ────────────────────────────────────────────────────────── 
  if (n === 'ml' || n === '1x2' || n === 'h2h' || n === 'result' || n === 'match result'
      || n.includes('moneyline') || n.includes('match winner') || n.includes('match result')
      || n === '3-way result' || n === '3 way result' || n === '3way result'
      || /^game lines/.test(n) || /^3.?way/.test(n)) return 'h2h';
  // ── Double Chance ───────────────────────────────────────────────────────────── 
  if (n.includes('double chance')) return 'double_chance';
  // ── Draw No Bet ─────────────────────────────────────────────────────────────── 
  if (n.includes('draw no bet') || n === 'dnb') return 'dnb';
  // ── Both Teams to Score ─────────────────────────────────────────────────────── 
  if (n.includes('both teams to score') || n.includes('btts')) return 'btts';
  // ── HT/FT ───────────────────────────────────────────────────────────────────── 
  if (n.includes('ht/ft') || n.includes('ht ft') || n.includes('halftime/fulltime')
      || (n.includes('half') && n.includes('full') && n.includes('time'))) return 'half_time_full_time';
  // ── 1st Half H2H ───────────────────────────────────────────────────────────── 
  if ((n.includes('1st half') || n.includes('first half') || n.includes('half time') || n.includes('half_time'))
      && (n.includes('result') || n.includes('ml') || n.includes('winner') || n.includes('h2h'))) return 'h2h_ht';
  // ── 1st Half Totals ─────────────────────────────────────────────────────────── 
  if ((n.includes('1st half') || n.includes('first half') || n.includes('halftime'))
      && (n.includes('total') || n.includes('over') || n.includes('under'))) return 'totals_ht';
  if (n === 'totals_ht' || n === 'totals ht') return 'totals_ht';
  // ── Correct Score ───────────────────────────────────────────────────────────── 
  if (n.includes('correct score') || n.includes('exact score')) return 'correct_score';
  // ── Next Goal ───────────────────────────────────────────────────────────────── 
  if (n.includes('next goal')) return 'next_goal';
  // ── Team to Score First ─────────────────────────────────────────────────────── 
  if (n.includes('team to score first') || n.includes('first team to score') || n.includes('first to score')) return 'team_to_score_first';
  // ── Team Totals (e.g. "Team Total Home", "Team Total Away") ────────────────── 
  if ((n.includes('team total') || n.includes('total home') || n.includes('total away'))
      && !n.includes('corner') && !n.includes('card')) return 'team_totals';
  // ── Corners ─────────────────────────────────────────────────────────────────── 
  if (n.includes('corner') && n.includes('handicap')) return 'corner_handicap';
  if (n.includes('corner') && (n.includes('total') || n.includes('over') || n.includes('under') || n.includes('ou'))) return 'corners_totals';
  if (n === 'corners' || n === 'total corners' || n === 'corners total') return 'corners_totals';
  // ── Cards ───────────────────────────────────────────────────────────────────── 
  if (n.includes('card') && (n.includes('total') || n.includes('over') || n.includes('under') || n.includes('ou'))
      && !n.includes('handicap')) return 'cards_totals';
  if (n.includes('card') && n.includes('handicap')) return 'cards_handicap';
  // ── Spreads / Asian Handicap ───────────────────────────────────────────────── 
  if (n === 'spreads' || n === 'spread' || n.includes('point spread') || n.includes('run line') || n.includes('puck line')) return 'spreads';
  if (n.includes('asian handicap') || (n.includes('handicap') && !n.includes('corner') && !n.includes('card'))) return 'handicap';
  // ── Totals (generic, after team/halftime variants) ─────────────────────────── 
  if (n === 'totals' || n === 'total' || n.includes('goals over/under') || n.includes('over/under goals')
      || n.includes('total goals') || n.includes('total points')
      || (n === 'over/under') || n.includes('totals')) return 'totals';
  // ── Player Props ────────────────────────────────────────────────────────────── 
  if (n.includes('anytime goalscorer') || n.includes('anytime goal scorer')) return 'player_goal_scorer_anytime';
  if (n.includes('first goalscorer') || n.includes('first goal scorer') || n.includes('first scorer')) return 'first_goal_scorer';
  if (n.includes('player points') || (n.includes('points') && n.includes('o/u')) || n === 'points ou' || n === 'pointsou') return 'player_points';
  if (n.includes('rebounds') && (n.includes('o/u') || n.includes('ou') || n.includes('over'))) return 'player_rebounds';
  if (n.includes('assists') && (n.includes('o/u') || n.includes('ou') || n.includes('over'))) return 'player_assists';
  if (n.includes('double double') || n === 'doubledouble') return 'player_double_double';
  if (n.includes('player props') || n === 'playerprops') return 'player_props';
  // ── Shots on Goal ───────────────────────────────────────────────────────────── 
  if (n.includes('shots on goal') || n.includes('shots on target')) return 'shots_on_goal';
  // ── Power Play ──────────────────────────────────────────────────────────────── 
  if (n.includes('power play')) return 'power_play_goals';
  return `special_${normKey(n).slice(0, 32) || 'misc'}`;
}

export function toMarketName(key, rawName) {
  const names = {
    h2h: 'Resultado Final', double_chance: 'Dupla Chance', dnb: 'Empate Anula',
    btts: 'Ambas Marcam', handicap: 'Handicap Asiático', spreads: 'Spread / Handicap',
    totals: 'Totais', h2h_ht: 'Resultado 1ª Parte', totals_ht: 'Totais 1ª Parte',
    half_time_full_time: 'Intervalo/Final', correct_score: 'Marcador Exacto',
    next_goal: 'Próximo Golo', team_to_score_first: 'Primeira Equipa a Marcar',
    corners_totals: 'Total de Cantos', corners_total: 'Total de Cantos',
    corner_handicap: 'Handicap de Cantos', cards_totals: 'Total de Cartões',
    cards_total: 'Total de Cartões', cards_handicap: 'Handicap de Cartões',
    team_totals: 'Total por Equipa',
    player_goal_scorer_anytime: 'Marcador (Qualquer Momento)',
    first_goal_scorer: 'Primeiro Marcador',
    player_points: 'Pontos do Jogador', player_rebounds: 'Ressaltos do Jogador',
    player_assists: 'Assistências do Jogador', player_double_double: 'Double-Double',
    player_props: 'Props do Jogador', shots_on_goal: 'Remates à Baliza',
    power_play_goals: 'Golos em Power Play',
  };
  return names[key] || rawName || key;
}

export function pickNum(v) {
  const n = typeof v === 'string' ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function pushSel(list, id, label, odd) {
  if (!(odd > 1)) return;
  list.push({ id, label, odd });
}

export function payloadToMarkets(payload, resolvedBooks) {
  const outByKey = new Map();
  const limitPerMarket = 80;

  let bmObj = {};
  const rawBm = payload?.bookmakers;
  if (Array.isArray(rawBm)) {
    for (const bm of rawBm) {
      const key = String(bm?.key || bm?.slug || bm?.name || bm?.title || '').trim();
      const mkts = bm?.markets || bm?.bets || [];
      if (key && Array.isArray(mkts)) bmObj[key] = mkts;
    }
  } else if (rawBm && typeof rawBm === 'object') { 
     for (const [k, v] of Object.entries(rawBm)) { 
       if (Array.isArray(v)) bmObj[k] = v; 
     } 
   } 
 
   const bmKeys = Object.keys(bmObj); 
   if (bmKeys.length === 0) return []; 
 
   const byNorm = new Map(); 
   for (const k of bmKeys) byNorm.set(normKey(k), k); 
 
   const getBookArr = (book) => { 
     if (Array.isArray(bmObj?.[book])) return bmObj[book]; 
     const alt = byNorm.get(normKey(book)); 
     if (alt && Array.isArray(bmObj?.[alt])) return bmObj[alt]; 
     return null; 
   }; 
 
   const requested = resolvedBooks ? resolvedBooks.split(',').map(s => s.trim()).filter(Boolean) : []; 
   let books; 
   if (requested.length > 0) { 
     const matched = requested.map(r => bmObj[r] ? r : (byNorm.get(normKey(r)) || null)).filter(Boolean); 
     books = matched.length > 0 ? matched : bmKeys; 
   } else { 
     books = bmKeys; 
   } 
 
   for (const book of books) { 
     const arr = getBookArr(book); 
     if (!arr) continue; 
 
     for (const m of arr) { 
       const rawName = String(m?.name || m?.key || ''); 
       const key = toMarketKey(rawName); 
       if (!outByKey.has(key)) { 
         outByKey.set(key, { id: `mkt_${key}`, key, name: toMarketName(key, rawName), selections: [] }); 
       } 
       const market = outByKey.get(key); 
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
           pushSel(market.selections, 'sel_1x', '1X', pickNum(o['1X'] ?? o['1x'] ?? 0)); 
           pushSel(market.selections, 'sel_x2', 'X2', pickNum(o['X2'] ?? o['x2'] ?? 0)); 
           pushSel(market.selections, 'sel_12', '12', pickNum(o['12'] ?? 0)); 
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
       } else if (key === 'handicap' || key === 'spreads') { 
         if (Array.isArray(m?.odds)) { 
           for (const line of m.odds) { 
             if (market.selections.length >= limitPerMarket) break; 
             const point = line?.hdp ?? line?.point ?? line?.spread; 
             const h = pickNum(line?.home); 
             const a = pickNum(line?.away); 
             if (point !== undefined && (h > 1 || a > 1)) { 
               const suffix = point > 0 ? `+${point}` : String(point); 
               pushSel(market.selections, `sel_home_${point}`, `Casa ${suffix}`, h); 
               pushSel(market.selections, `sel_away_${point}`, `Fora ${suffix}`, a); 
             } 
           } 
         } 
       } else if (key === 'team_totals') { 
         // "Team Total Home" / "Team Total Away" → labeled Over/Under per team 
         const rawLower = rawName.toLowerCase(); 
         const prefix = rawLower.includes('home') ? 'Casa' : (rawLower.includes('away') ? 'Fora' : ''); 
         const pSlug = prefix ? normKey(prefix) : 'g'; 
         if (Array.isArray(m?.odds)) { 
           for (const line of m.odds) { 
             if (market.selections.length >= limitPerMarket) break; 
             const point = line?.hdp; 
             const over = pickNum(line?.over); 
             const under = pickNum(line?.under); 
             if (point !== undefined && (over > 1 || under > 1)) { 
               const pLabel = prefix ? `${prefix} ` : ''; 
               pushSel(market.selections, `sel_${pSlug}_over_${point}`, `${pLabel}Over ${point}`, over); 
               pushSel(market.selections, `sel_${pSlug}_under_${point}`, `${pLabel}Under ${point}`, under); 
             } 
           } 
         } 
       } else if (key === 'corners_totals' || key === 'cards_totals' || key === 'shots_on_goal') { 
         // Over/Under line markets with {hdp, over, under} structure 
         if (Array.isArray(m?.odds)) { 
           for (const line of m.odds) { 
             if (market.selections.length >= limitPerMarket) break; 
             const point = line?.hdp ?? line?.total ?? line?.line; 
             const over = pickNum(line?.over); 
             const under = pickNum(line?.under); 
             if (point !== undefined && (over > 1 || under > 1)) { 
               pushSel(market.selections, `sel_over_${point}`, `Over ${point}`, over); 
               pushSel(market.selections, `sel_under_${point}`, `Under ${point}`, under); 
             } 
           } 
         } 
       } else if (key === 'half_time_full_time' || key === 'correct_score' || key === 'next_goal') { 
         // Generic label/price markets (outcomes with label + price) 
         if (Array.isArray(m?.odds)) { 
           for (const o of m.odds) { 
             if (market.selections.length >= limitPerMarket) break; 
             const label = String(o?.label || o?.name || o?.outcome || o?.selection || '').trim(); 
             const price = pickNum(o?.price) || pickNum(o?.odd) || pickNum(o?.value); 
             if (label && price > 1) pushSel(market.selections, `sel_${normKey(label).slice(0, 24)}`, label, price); 
           } 
         } 
       } else { 
         if (Array.isArray(m?.odds)) { 
           for (const o of m.odds) { 
             if (market.selections.length >= limitPerMarket) break; 
             const label = String(o?.label || o?.name || o?.outcome || o?.selection || '').trim(); 
             const price = pickNum(o?.price) || pickNum(o?.odd) || pickNum(o?.value) || 
                           pickNum(o?.under) || pickNum(o?.over) || pickNum(o?.home) || pickNum(o?.away); 
             if (label && price > 1) pushSel(market.selections, `sel_${normKey(label).slice(0, 24)}`, label, price); 
           } 
         } 
       } 
     } 
   } 
 
   // Deduplicate selections (keep highest odd per id) 
   const result = []; 
   for (const market of outByKey.values()) { 
     const bestById = new Map(); 
     for (const s of market.selections) { 
       const prev = bestById.get(s.id); 
       if (!prev || s.odd > prev.odd) bestById.set(s.id, s); 
     } 
     market.selections = Array.from(bestById.values()); 
     if (market.selections.length > 0) result.push(market); 
   } 
   return result; 
}

export function marketsToLegacyFormat(markets, resolvedBooks) { 
   const parsed = payloadToMarkets(markets, resolvedBooks); 
   const bestByMarket = new Map(); 
 
   for (const m of parsed) { 
     if (!m?.key) continue; 
     if (!bestByMarket.has(m.key)) bestByMarket.set(m.key, new Map()); 
     const best = bestByMarket.get(m.key); 
     for (const s of m.selections || []) { 
       const label = String(s?.label || '').trim(); 
       const odd = Number(s?.odd || 0); 
       if (!label || !(odd > 1)) continue; 
       const lk = label.toLowerCase(); 
       const prev = best.get(lk); 
       if (!prev || odd > prev.odd) best.set(lk, { label, odd }); 
     } 
   } 
 
   const result = {}; 
   for (const [key, map] of bestByMarket) { 
     const arr = Array.from(map.values()).map(x => ({ name: x.label, label: x.label, price: x.odd, odd: x.odd })).slice(0, 120); 
     if (arr.length > 0) result[key] = arr; 
   } 
 
   // Extract primary h2h odds from markets 
   const h2h = result.h2h || []; 
   const pick = (lbl) => (h2h.find(s => String(s.label || s.name || '').toLowerCase() === lbl)?.odd || 0); 
   const primary = { home: pick('casa'), draw: pick('empate'), away: pick('fora') }; 
 
   return { markets: result, primary }; 
}

// Extract basic h2h odds from an odds-api.io event object (different payload formats) 
export function extractBasicOdds(ev) { 
   if (!ev) return { home: 0, draw: 0, away: 0 }; 
 
   // Format: ev.odds.h2h = [home, draw, away] 
   if (ev.odds?.h2h && Array.isArray(ev.odds.h2h)) { 
     const [h, d, a] = ev.odds.h2h; 
     if (h > 1) return { home: h || 0, draw: d || 0, away: a || 0 }; 
   } 
 
   // Format: ev.bookmakers[].markets[].outcomes[] 
   if (Array.isArray(ev.bookmakers)) { 
     for (const bm of ev.bookmakers) { 
       const mkts = Array.isArray(bm.markets) ? bm.markets : Object.values(bm.markets || {}); 
       for (const m of mkts) { 
         const key = String(m?.key || m?.name || '').toLowerCase(); 
         if (!key.includes('1x2') && !key.includes('h2h') && !key.includes('match') && !key.includes('winner')) continue; 
         let h = 0, d = 0, a = 0; 
         for (const o of (m.outcomes || m.odds || [])) { 
           const name = String(o.name || o.label || '').toLowerCase(); 
           const price = parseFloat(o.price ?? o.odd ?? 0) || 0; 
           if (price <= 1) continue; 
           if (name === '1' || name === 'home') h = h || price; 
           else if (name === 'x' || name === 'draw' || name === 'tie') d = d || price; 
           else if (name === '2' || name === 'away') a = a || price; 
         } 
         if (h > 1) return { home: h, draw: d, away: a }; 
       } 
     } 
   } 
 
   // Format: direct odds fields 
   if (ev.home_odd > 1) return { home: ev.home_odd, draw: ev.draw_odd || 0, away: ev.away_odd || 0 }; 
   if (ev.home > 1 && ev.away > 1) return { home: ev.home, draw: ev.draw || 0, away: ev.away }; 
 
   return { home: 0, draw: 0, away: 0 }; 
}

// ─── Odds-api.io fetchers ────────────────────────────────────────────────────── 

// In-memory cache for odds-api.io events lists (10 min TTL per slug) 
const eventsListCache = new Map(); 
const invalidOddsApiSlugs = new Map();

function isInvalidOddsApiSlug(slug) {
  const cached = invalidOddsApiSlugs.get(slug);
  if (!cached) return false;
  if (cached.expiresAt < Date.now()) {
    invalidOddsApiSlugs.delete(slug);
    return false;
  }
  return true;
}

function markInvalidOddsApiSlug(slug) {
  invalidOddsApiSlugs.set(slug, { expiresAt: Date.now() + 24 * 60 * 60 * 1000 });
}

/** 
 * Fetch the list of events from odds-api.io for a single sport slug. 
 * Returns array of { id, home, away, date, league_name, status }. 
 * Cached for 10 minutes. 
 */ 
export async function fetchOddsApiEventsList(oddsKey, slug, daysAhead = 3, statuses = 'pending,live') { 
   if (isInvalidOddsApiSlug(slug)) return [];
   const now = Date.now(); 
   const cacheKey = `${slug}|${statuses}|${daysAhead}`; 
   const cached = eventsListCache.get(cacheKey); 
   if (cached && cached.expiresAt > now) return cached.data; 
 
  // Use -6 hours as start so we catch live events (matches can run 100+ minutes with pre-game) 
  const from = new Date(now - 6 * 60 * 60 * 1000).toISOString(); 
   const to   = new Date(now + daysAhead * 24 * 60 * 60 * 1000).toISOString(); 
   // Note: odds-api.io uses literal commas in status param (not URL-encoded) 
  const url  = `${ODDS_API_BASE}/events?apiKey=${oddsKey}&sport=${slug}&status=${statuses}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=2500`; 

   let data = null;
   try {
     const controller = new AbortController();
     const timer = setTimeout(() => controller.abort(), 20000);
     const r = await fetch(url, { signal: controller.signal });
     clearTimeout(timer);
     if (!r.ok) {
       const body = await r.text().catch(() => '');
       console.warn(`[SportsSync] HTTP ${r.status} → ${url.split('?')[0]} | ${body.slice(0, 120)}`);
       if (r.status === 400 && body.toLowerCase().includes('invalid sport slug')) {
         markInvalidOddsApiSlug(slug);
         eventsListCache.set(cacheKey, { expiresAt: now + 24 * 60 * 60 * 1000, data: [] });
       } else {
         eventsListCache.set(cacheKey, { expiresAt: now + 60000, data: [] });
       }
       return [];
     }
     data = await r.json();
   } catch (err) {
     if (err.name !== 'AbortError') console.warn(`[SportsSync] fetch error: ${err.message}`);
     eventsListCache.set(cacheKey, { expiresAt: now + 60000, data: [] });
     return [];
   }
   if (!Array.isArray(data)) { 
     eventsListCache.set(cacheKey, { expiresAt: now + 60000, data: [] }); // short cache on error 
     return []; 
   } 
 
   const parsed = data 
     .map(ev => { 
       const id   = ev.id ?? ev.eventId ?? ev.event_id ?? null; 
       const home = ev.home_team || ev.home || ev.homeTeam || ''; 
       const away = ev.away_team || ev.away || ev.awayTeam || ''; 
       const date = ev.commence_time || ev.date || ev.start_time || ev.scheduled || ''; 
       const status = ev.status || ev.state || 'pending'; 
       const league_name = ev.league?.name || ev.competition?.name || ev.league_name || ev.sport_title || ''; 
       const league_slug = ev.league?.slug || ev.competition?.slug || ev.league_slug || slug; 
       if (!id || !home || !away || !date) return null; 
       return { id: String(id), home, away, date, status: String(status), league_name, league_slug }; 
     }) 
     .filter(Boolean); 
 
   eventsListCache.set(cacheKey, { expiresAt: now + 10 * 60 * 1000, data: parsed }); 
   return parsed; 
}

/** 
 * Fetch full odds for a single odds-api.io event ID. 
 * Returns { payload, markets (parsed), primary { home, draw, away } } or null. 
 */ 
export async function fetchOddsApiOddsForEvent(oddsKey, eventId, markets, bookmakers) { 
   // odds-api.io accepts literal commas in bookmakers and markets params 
   const mkts  = `&markets=${markets || DEFAULT_MARKETS}`; 
 
   const tryFetch = async (booksParam) => {
     const books = booksParam ? `&bookmakers=${booksParam}` : '';
     const url = `${ODDS_API_BASE}/odds?apiKey=${oddsKey}&eventId=${encodeURIComponent(eventId)}${books}${mkts}`;
     const payload = await safeFetch(url);
     if (!payload) return null;
     const { markets: mktsObj, primary } = marketsToLegacyFormat(payload, booksParam);
     return { payload, markets: mktsObj, primary };
   };
 
   const first = await tryFetch(bookmakers);
   if (!first) return null;

   const keys = first?.markets && typeof first.markets === 'object' ? Object.keys(first.markets) : [];
   const requested = new Set(String(markets || DEFAULT_MARKETS).split(',').map((s) => s.trim()).filter(Boolean));
   const present = new Set(keys.map((k) => String(k)));
   const meaningfulRequested = Array.from(requested).filter((k) => !['h2h'].includes(k));
   const hasAnyMeaningful =
     meaningfulRequested.length === 0
       ? true
       : meaningfulRequested.some((k) => present.has(k));

   const tooThin = keys.length <= 2 || !hasAnyMeaningful;
   if (bookmakers && tooThin) {
     const retry = await tryFetch('');
     if (retry) return retry;
   }
 
   return first;
}

export function getOddsApiSlugsForSport(sport, max) {
  const base = Array.isArray(SPORT_SLUG_MAP[sport]) ? SPORT_SLUG_MAP[sport] : [];
  const extra = [];
  if (sport === 'basketball') extra.push('basketball');
  if (sport === 'ice-hockey') extra.push('ice-hockey', 'hockey');
  if (sport === 'american-football') extra.push('american-football');
  if (sport === 'tennis') extra.push('tennis');
  if (sport === 'handball') extra.push('handball');
  if (sport === 'volleyball') extra.push('volleyball');
  if (sport === 'rugby') extra.push('rugby');
  if (sport === 'mma') extra.push('mma');
  if (sport === 'boxing') extra.push('boxing');
  if (sport === 'afl') extra.push('afl');
  if (sport === 'formula-1') extra.push('formula-1');
  if (sport === 'soccer') extra.push('football');
  extra.push(String(sport || '').trim());
  const out = [];
  const seen = new Set();
  for (const s of [...extra, ...base]) {
    const slug = String(s || '').trim();
    if (!slug) continue;
    if (seen.has(slug)) continue;
    seen.add(slug);
    out.push(slug);
    if (max && out.length >= max) break;
  }
  return out;
}

/** 
 * Fetch bulk events list from odds-api.io for ALL slugs of a sport, deduplicated. 
 */
export async function fetchAllOddsApiEventsForSport(oddsKey, sport, daysAhead = 3) { 
  const slugs = getOddsApiSlugsForSport(sport, 2); 
   if (!slugs.length) return []; 
 
   const all = []; 
   const seen = new Set(); 
   const statuses = 'pending,live'; 
 
  await Promise.all(slugs.map(async (slug) => { 
     const events = await fetchOddsApiEventsList(oddsKey, slug, daysAhead, statuses); 
     for (const ev of events) { 
       if (!seen.has(ev.id)) { 
         seen.add(ev.id); 
         all.push(ev); 
       } 
     } 
   })); 
 
   return all; 
} 
 
// Persistent match-ID cache: maps apiFootballEventId -> { oddsApiId, cachedAt } 
// Avoids re-running Jaro-Winkler for every sync cycle. 
const matchIdCache = new Map(); 
const MATCH_CACHE_TTL        = 4 * 60 * 60 * 1000; // 4 hours for scheduled 
const MATCH_CACHE_TTL_LIVE   = 90 * 60 * 1000;      // 90 min for live (bookmakers suspend/resume frequently) 

/** 
 * For a list of API-Football fixtures and odds-api.io events, 
 * do fuzzy matching and fetch per-event odds for matched pairs. 
 * Returns a Map: externalEventId -> { home_odd, draw_odd, away_odd, markets } 
 */ 
export async function buildOddsMap(fixtures, oddsEvents, sport, oddsKey, bookmakers, fetchMarkets = true) { 
   if (!fixtures.length || !oddsEvents.length) return new Map(); 
 
   const markets = SPORT_MARKETS[sport] || DEFAULT_MARKETS; 
   const oddsMap = new Map(); 
   const toFetch = []; 
   const now = Date.now(); 
 
   for (const fix of fixtures) { 
    const isLiveFix = Number(fix.is_live) === 1; 
    const ttl = isLiveFix ? MATCH_CACHE_TTL_LIVE : MATCH_CACHE_TTL; 
     // Check persistent match cache first 
     const cached = matchIdCache.get(fix.external_event_id); 
    if (cached && now - cached.cachedAt < ttl) { 
      toFetch.push({ fixture: fix, oddsEventId: cached.oddsApiId, basicOdds: null, fromCache: true }); 
       continue; 
     } 
 
     // Fuzzy match using Jaro-Winkler 
     const matched = matchOddsEvent(fix, oddsEvents); 
     if (matched) { 
       matchIdCache.set(fix.external_event_id, { oddsApiId: matched.id, cachedAt: now }); 
      toFetch.push({ fixture: fix, oddsEventId: matched.id, basicOdds: extractBasicOdds(matched), fromCache: false }); 
     } 
   } 
 
   if (!fetchMarkets) { 
     // Just apply basic h2h odds from the events list (no extra API calls) 
     for (const { fixture, basicOdds } of toFetch) { 
       if (basicOdds && basicOdds.home > 1) { 
         oddsMap.set(fixture.external_event_id, { 
           home_odd: basicOdds.home, 
           draw_odd: basicOdds.draw, 
           away_odd: basicOdds.away, 
           markets: {}, 
         }); 
       } 
     } 
     return oddsMap; 
   } 
 
   // Fetch full odds for matched events (concurrency limit = 4 to protect quota) 
   // Cap at 200 events per sport per sync cycle to get more odds coverage 
   const limited = toFetch.slice(0, 200); 
 
  const oddsResults = await runPool(limited, 4, async ({ fixture, oddsEventId, fromCache }) => { 
     const result = await fetchOddsApiOddsForEvent(oddsKey, oddsEventId, markets, bookmakers); 
    // If cached ID returned nothing, invalidate so next cycle re-matches via fuzzy search 
    if (!result && fromCache && Number(fixture.is_live) === 1) { 
      matchIdCache.delete(fixture.external_event_id); 
    } 
     return { fixId: fixture.external_event_id, result }; 
   }); 
 
   for (const { fixId, result } of oddsResults) { 
     if (result) { 
       oddsMap.set(fixId, { 
         home_odd: result.primary.home, 
         draw_odd: result.primary.draw, 
         away_odd: result.primary.away, 
         markets: result.markets, 
       }); 
     } 
   } 
 
   return oddsMap; 
} 
 
// ─── API-Sports (API-Football) fetchers ──────────────────────────────────────── 
 
export async function fetchLiveFixtures(apiKey, sport) { 
   const cfg = SPORT_CONFIG[sport]; 
   if (!cfg) return []; 
   const data = await safeFetch(`${cfg.base}${cfg.endpoint}?${cfg.liveParam}`, { 'x-apisports-key': apiKey }); 
   if (!data?.response?.length) return []; 
   return normalizeApiSportsFixtures(data.response, sport); 
} 
 
export async function fetchDateFixtures(apiKey, sport, date) { 
   const cfg = SPORT_CONFIG[sport]; 
   if (!cfg) return []; 
   const param = cfg.dateParam.replace('{DATE}', date); 
   const data = await safeFetch(`${cfg.base}${cfg.endpoint}?${param}`, { 'x-apisports-key': apiKey }); 
   if (!data?.response?.length) return []; 
   return normalizeApiSportsFixtures(data.response, sport); 
} 
 
export function normalizeApiSportsFixtures(response, sport) { 
   const events = []; 
   for (const item of response) { 
     try { 
       let fix, teamHome, teamAway, leagueInfo, statusInfo, dateStr; 
 
       let redCardsHome = 0, redCardsAway = 0; 
       if (sport === 'soccer') { 
         fix = item.fixture; 
         teamHome = item.teams?.home; 
         teamAway = item.teams?.away; 
         leagueInfo = item.league; 
         statusInfo = fix?.status; 
         dateStr = fix?.date; 
         // Extract red cards from match events 
         if (Array.isArray(item.events)) { 
           for (const ev of item.events) { 
             if (String(ev?.type || '').toLowerCase() === 'card' && 
                 String(ev?.detail || '').toLowerCase().includes('red')) { 
               const teamId = ev?.team?.id; 
               if (teamId === teamHome?.id) redCardsHome++; 
               else if (teamId === teamAway?.id) redCardsAway++; 
             } 
           } 
         } 
       } else { 
         fix = item.game || item; 
         teamHome = item.teams?.home || item.home; 
         teamAway = item.teams?.away || item.away; 
         leagueInfo = item.league; 
         statusInfo = item.status || item.game?.status; 
         dateStr = item.date || item.game?.date; 
       } 
 
       if (!teamHome?.name || !teamAway?.name || !dateStr) continue; 
       const eventDate = new Date(dateStr); 
       if (isNaN(eventDate.getTime())) continue; 
 
       const status   = String(statusInfo?.short || statusInfo?.long || 'NS'); 
       const isLive   = ['1H','2H','ET','P','BT','HT','LIVE','IN_PLAY','Q1','Q2','Q3','Q4','OT'].includes(status) ? 1 : 0; 
       let league     = String(leagueInfo?.name || ''); 
       const country  = String(leagueInfo?.country || ''); 
 
       // Normalize Brazilian league names to avoid conflict with Italian Serie A/B 
       if (sport === 'soccer' && country.toLowerCase() === 'brazil') { 
         const leagueLower = league.toLowerCase(); 
         if (leagueLower === 'série a' || leagueLower === 'serie a') league = 'Brasileirão Série A'; 
         else if (leagueLower === 'série b' || leagueLower === 'serie b') league = 'Brasileirão Série B'; 
         else if (leagueLower === 'série c' || leagueLower === 'serie c') league = 'Brasileirão Série C'; 
         else if (!league.toLowerCase().includes('brasileir')) { 
           // Prefix other Brazilian leagues if not already prefixed 
         } 
       } 
 
       if (sport === 'soccer') { 
         if (isBlocked(league)) continue; 
         if (!isLeagueAllowed(league, country)) continue; 
       } 
 
       // Extract score: different APIs use different fields 
       // Soccer (API-Football): item.goals.home / item.goals.away 
       // Basketball (API-Basketball): item.scores.home.total / item.scores.visitors.total 
       // Hockey/Handball/Rugby (API-Sports): item.scores.home / item.scores.away or item.score 
       let scoreHome = null, scoreAway = null; 
       if (sport === 'soccer') { 
         scoreHome = item.goals?.home ?? null; 
         scoreAway = item.goals?.away ?? null; 
       } else if (item.scores) { 
         // API-Basketball: { home: { total: X, quarter_1: X }, visitors: { total: X } } 
         const sh = item.scores.home ?? item.scores.team_1 ?? item.scores.local ?? {}; 
         const sa = item.scores.visitors ?? item.scores.away ?? item.scores.team_2 ?? item.scores.visitor ?? {}; 
         scoreHome = typeof sh === 'object' ? (sh.total ?? sh.points ?? sh.score ?? null) : (typeof sh === 'number' ? sh : null); 
         scoreAway = typeof sa === 'object' ? (sa.total ?? sa.points ?? sa.score ?? null) : (typeof sa === 'number' ? sa : null); 
         // Fallback to item.score 
         if (scoreHome === null) scoreHome = item.score?.home ?? item.goals?.home ?? null; 
         if (scoreAway === null) scoreAway = item.score?.away ?? item.goals?.away ?? null; 
       } else { 
         scoreHome = item.score?.home ?? item.goals?.home ?? null; 
         scoreAway = item.score?.away ?? item.goals?.away ?? null; 
       } 
       const rawId     = fix?.id || item.id || item.game?.id; 
 
       events.push({ 
         external_event_id: `${sport}_${rawId}`, 
         sport, 
         league, 
         country, 
         home_team:       teamHome.name, 
         away_team:       teamAway.name, 
         team_match:      `${teamHome.name} vs ${teamAway.name}`, 
         home_team_logo:  teamHome.logo || '', 
         away_team_logo:  teamAway.logo || '', 
         event_date:      eventDate.toISOString(), 
         status, 
         is_live:         isLive, 
         elapsed:         Number(statusInfo?.elapsed || 0), 
         score:           JSON.stringify({ home: scoreHome, away: scoreAway }), 
         home_odd:        0, 
         draw_odd:        0, 
         away_odd:        0, 
         markets:         '{}', 
         red_cards_home:  redCardsHome, 
         red_cards_away:  redCardsAway, 
       }); 
     } catch { /* skip malformed */ } 
   } 
   return events; 
} 
 
// ─── Upsert ───────────────────────────────────────────────────────────── 
const BATCH_SIZE = 50; 
 
export async function upsertEvents(events) { 
   const db  = await getDb(); 
   const now = new Date().toISOString(); 
 
   const stmt = db.prepare(` 
     INSERT INTO events ( 
       external_event_id, sport, league, country, home_team, away_team, team_match, 
       home_team_logo, away_team_logo, event_date, status, is_live, elapsed, score, 
       home_odd, draw_odd, away_odd, markets, red_cards_home, red_cards_away, updated_at 
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) 
     ON CONFLICT(external_event_id) DO UPDATE SET 
       sport           = excluded.sport, 
       league          = COALESCE(NULLIF(excluded.league,''), events.league), 
       country         = COALESCE(NULLIF(excluded.country,''), events.country), 
       home_team       = excluded.home_team, 
       away_team       = excluded.away_team, 
       team_match      = excluded.team_match, 
       home_team_logo  = CASE WHEN excluded.home_team_logo != '' THEN excluded.home_team_logo ELSE events.home_team_logo END, 
       away_team_logo  = CASE WHEN excluded.away_team_logo != '' THEN excluded.away_team_logo ELSE events.away_team_logo END, 
       event_date      = excluded.event_date, 
       status          = excluded.status, 
       is_live         = excluded.is_live, 
       elapsed         = excluded.elapsed, 
       score           = CASE WHEN excluded.score != '{"home":null,"away":null}' THEN excluded.score ELSE events.score END, 
       home_odd        = CASE WHEN excluded.home_odd > 0 THEN excluded.home_odd ELSE events.home_odd END, 
       draw_odd        = CASE WHEN excluded.draw_odd > 0 THEN excluded.draw_odd ELSE events.draw_odd END, 
       away_odd        = CASE WHEN excluded.away_odd > 0 THEN excluded.away_odd ELSE events.away_odd END, 
       markets         = CASE WHEN excluded.markets != '{}' THEN excluded.markets ELSE events.markets END, 
       red_cards_home  = CASE WHEN excluded.is_live = 1 THEN excluded.red_cards_home ELSE events.red_cards_home END, 
       red_cards_away  = CASE WHEN excluded.is_live = 1 THEN excluded.red_cards_away ELSE events.red_cards_away END, 
       updated_at      = excluded.updated_at 
   `); 
 
   const insertMany = async (rows) => { 
     for (const e of rows) { 
       await stmt.run( 
         e.external_event_id, e.sport, e.league || '', e.country || '', 
         e.home_team, e.away_team, e.team_match || `${e.home_team} vs ${e.away_team}`, 
         e.home_team_logo || '', e.away_team_logo || '', 
         e.event_date, e.status || 'NS', Number(e.is_live || 0), Number(e.elapsed || 0), 
         typeof e.score === 'string' ? e.score : JSON.stringify(e.score || { home: null, away: null }), 
         Number(e.home_odd || 0), Number(e.draw_odd || 0), Number(e.away_odd || 0), 
         typeof e.markets === 'string' ? e.markets : JSON.stringify(e.markets || {}), 
         Number(e.red_cards_home || 0), Number(e.red_cards_away || 0), 
         now 
       ); 
     } 
   }; 
 
   for (let i = 0; i < events.length; i += BATCH_SIZE) { 
     try { await insertMany(events.slice(i, i + BATCH_SIZE)); } 
     catch (err) { console.error(`[SportsSync] upsert batch ${i} error:`, err.message); } 
   } 
} 
 
export async function cleanupOldEvents() { 
   const db = await getDb(); 
   try { 
     const ph = FINISHED_STATUSES.map(() => '?').join(','); 
     await db.prepare(` 
       DELETE FROM events 
       WHERE status IN (${ph}) 
         AND event_date < datetime('now', '-3 hours') 
         AND CAST(id AS TEXT) NOT IN ( 
           SELECT DISTINCT CAST(event_id AS TEXT) FROM bets WHERE status = 'pending' 
         ) 
     `).run(...FINISHED_STATUSES);
     
    // Never delete live events (is_live=1) — only stale pre-game events 
    await db.prepare(`DELETE FROM events WHERE status IN ('NS','PST','TBD') AND is_live = 0 AND event_date < datetime('now', '-3 hours')`).run(); 
    await db.prepare(`UPDATE events SET is_live = 0 WHERE is_live = 1 AND event_date < datetime('now', '-5 hours')`).run(); 
    // Auto-mark stale live events as finished (safety net) 
    await db.prepare(`UPDATE events SET is_live = 0 WHERE is_live = 1 AND event_date < datetime('now', '-6 hours')`).run(); 
   } catch (err) { 
     console.error('[SportsSync] cleanup error:', err.message); 
   } 
} 
 
// ─── Fuzzy Matching (Jaro-Winkler) ────────────────────────────────────────────── 
const TEAM_SUFFIX_RE = /\b(fc|afc|sc|bv|sv|rfc|fk|cf|ac|if|bk|gd|hc|nk|sk|pk|tk|jk|vv|zfc|united fc|football club|futebol clube|sporting clube|sport club|club de futbol)\b/gi; 
const TEAM_PREFIX_RE = /^(fc|afc|sc|bv|sv|rfc|fk|cf|ac|if)\s+/i; 

function normalizeText(input) { 
  return String(input || '') 
    .normalize('NFD') 
    .replace(/[\u0300-\u036f]/g, '') 
    .toLowerCase() 
    .replace(TEAM_SUFFIX_RE, '') 
    .replace(TEAM_PREFIX_RE, '') 
    .replace(/[^a-z0-9]+/g, ' ') 
    .trim(); 
} 

function tokenize(input) { 
  const s = normalizeText(input); 
  if (!s) return []; 
  return s.split(' ').filter(Boolean); 
} 

function jaroDistance(a, b) { 
  if (a === b) return 1; 
  if (!a || !b) return 0; 
  const len1 = a.length; 
  const len2 = b.length; 
  const matchDistance = Math.floor(Math.max(len1, len2) / 2) - 1; 
  if (matchDistance < 0) return a === b ? 1 : 0; 

  const s1Matches = new Array(len1).fill(false); 
  const s2Matches = new Array(len2).fill(false); 

  let matches = 0; 
  for (let i = 0; i < len1; i++) { 
    const start = Math.max(0, i - matchDistance); 
    const end = Math.min(i + matchDistance + 1, len2); 
    for (let j = start; j < end; j++) { 
      if (s2Matches[j]) continue; 
      if (a[i] !== b[j]) continue; 
      s1Matches[i] = true; 
      s2Matches[j] = true; 
      matches++; 
      break; 
    } 
  } 

  if (matches === 0) return 0; 

  let t = 0; 
  let k = 0; 
  for (let i = 0; i < len1; i++) { 
    if (!s1Matches[i]) continue; 
    while (!s2Matches[k]) k++; 
    if (a[i] !== b[k]) t++; 
    k++; 
  } 

  const transpositions = t / 2; 
  return (matches / len1 + matches / len2 + (matches - transpositions) / matches) / 3; 
} 

function jaroWinkler(a, b) { 
  const s1 = normalizeText(a); 
  const s2 = normalizeText(b); 
  const j = jaroDistance(s1, s2); 
  const prefixMax = 4; 
  let prefix = 0; 
  for (let i = 0; i < Math.min(prefixMax, s1.length, s2.length); i++) { 
    if (s1[i] === s2[i]) prefix++; 
    else break; 
  } 
  return j + prefix * 0.1 * (1 - j); 
} 

function tokenSetSimilarity(a, b) { 
  const ta = new Set(tokenize(a)); 
  const tb = new Set(tokenize(b)); 
  if (ta.size === 0 || tb.size === 0) return 0; 

  let inter = 0; 
  for (const t of ta) if (tb.has(t)) inter++; 
  const union = ta.size + tb.size - inter; 
  return union === 0 ? 0 : inter / union; 
} 

function smartSimilarity(a, b) { 
  const jw = jaroWinkler(a, b); 
  const ts = tokenSetSimilarity(a, b); 
  return Math.max(jw, ts); 
} 

function parseKickoffMs(iso) { 
  const t = Date.parse(String(iso || '')); 
  return Number.isFinite(t) ? t : 0; 
} 

function scoreMatch(a, b) { 
  let score = 0; 

  const leagueSim = smartSimilarity(a.league, b.league); 
  if (leagueSim >= 0.9) score += 30; 
  else if (leagueSim >= 0.8) score += 22; 
  else if (leagueSim >= 0.7) score += 15; 

  const homeSim = smartSimilarity(a.home, b.home); 
  if (homeSim >= 0.92) score += 30; 
  else if (homeSim >= 0.85) score += 22; 
  else if (homeSim >= 0.75) score += 15; 

  const awaySim = smartSimilarity(a.away, b.away); 
  if (awaySim >= 0.92) score += 30; 
  else if (awaySim >= 0.85) score += 22; 
  else if (awaySim >= 0.75) score += 15; 

  const ta = parseKickoffMs(a.kickoff); 
  const tb = parseKickoffMs(b.kickoff); 
  if (ta && tb) { 
    const diffMin = Math.abs(ta - tb) / 60000; 
    if (diffMin <= 60) score += 10; 
    else if (diffMin <= 120) score += 6; 
    else if (diffMin <= 240) score += 2; 
  } 

  return score; 
} 

function findBestCandidate(base, candidates, minScore = 80) { 
  let best = null; 

  for (const c of candidates) { 
    const direct = scoreMatch(base, { league: c.league, home: c.home, away: c.away, kickoff: c.kickoff }); 
    const swapped = scoreMatch(base, { league: c.league, home: c.away, away: c.home, kickoff: c.kickoff }); 
    const s = Math.max(direct, swapped); 
    const isSwapped = swapped > direct; 

    if (!best || s > best.score) best = { item: c.item, score: s, swapped: isSwapped }; 
  } 

  if (!best || best.score < minScore) return null; 
  return best; 
} 

function stripCountryPrefix(league) { 
  if (!league) return ''; 
  const s = String(league).trim(); 
  const m = s.match(/^[^-]+ - (.+)$/); 
  return m ? m[1].trim() : s; 
} 

export function matchOddsEvent(fixture, oddsEvents, minScore = 75) { 
  if (!oddsEvents || !oddsEvents.length) return null; 

  const candidates = oddsEvents.map(e => ({ 
    item: e, 
    league: stripCountryPrefix(e.league_name || e.league_slug || ''), 
    home: e.home, 
    away: e.away, 
    kickoff: e.date, 
  })); 

  const fixtureLeague = stripCountryPrefix(fixture.league || ''); 

  const result = findBestCandidate( 
    { league: fixtureLeague, home: fixture.home_team, away: fixture.away_team, kickoff: fixture.event_date }, 
    candidates, 
    minScore 
  ); 

  if (!result) return null; 

  if (result.swapped) { 
    return { 
      ...result.item, 
      home_odd: result.item.away_odd, 
      away_odd: result.item.home_odd, 
      _swapped: true, 
    }; 
  } 

  return result.item; 
} 

// ─── Main sync cycle ──────────────────────────────────────────────────────────── 
let syncCycle = 0; 
 
export async function runSportsSync(forceFull = false) { 
   const apiKey     = process.env.API_SPORTS_KEY; 
   const oddsKey    = process.env.ODDS_API_KEY; 
   const bookmakers = getOddsApiBookmakers(); 
 
   if (!apiKey && !oddsKey) { 
     console.log('[SportsSync] Skipped: no API_SPORTS_KEY and no ODDS_API_KEY'); 
     return { synced: 0, sports: [] }; 
   } 
 
   syncCycle++; 
   const isFullSync = forceFull || (syncCycle % 6 === 1); 
   console.log(`[SportsSync] Cycle ${syncCycle} (${isFullSync ? 'FULL' : 'live-only'})`); 
 
   let totalSynced = 0; 
   const syncedSports = []; 
 
   // ── Phase 1: Fetch API-Football fixtures ─────────────────────────────────── 
   if (apiKey) { 
     for (const sport of Object.keys(SPORT_CONFIG)) { 
       try { 
         // Live always; scheduled only on full sync 
         let liveFixtures = await fetchLiveFixtures(apiKey, sport); 
 
         // Fallback: if API returns no live fixtures in live-only cycle, use DB live events 
         if (!isFullSync && liveFixtures.length === 0) { 
           const db = getDb(); 
           const dbLive = db.prepare( 
             "SELECT * FROM events WHERE sport = ? AND is_live = 1" 
           ).all(sport); 
           if (dbLive.length > 0) { 
             liveFixtures = dbLive.map(e => ({ 
               external_event_id: e.external_event_id, 
               sport: e.sport, 
               league: e.league || '', 
               country: e.country || '', 
               home_team: e.home_team, 
               away_team: e.away_team, 
               team_match: `${e.home_team} vs ${e.away_team}`, 
               home_team_logo: e.home_team_logo || '', 
               away_team_logo: e.away_team_logo || '', 
               event_date: e.event_date, 
               status: typeof e.status === 'string' ? e.status : 'LIVE', 
               is_live: 1, 
               elapsed: e.elapsed || 0, 
               score: e.score || '{"home":null,"away":null}', 
               home_odd: e.home_odd || 0, 
               draw_odd: e.draw_odd || 0, 
               away_odd: e.away_odd || 0, 
               red_cards_home: e.red_cards_home || 0, 
               red_cards_away: e.red_cards_away || 0, 
             })); 
           } 
         } 
 
         let scheduledFixtures = []; 
 
         if (isFullSync) { 
           const today = new Date(); 
           const days = sport === 'soccer' ? 5 : 2; 
           for (let d = 0; d <= days; d++) { 
             const dt = new Date(today); 
             dt.setDate(today.getDate() + d); 
             const fixtures = await fetchDateFixtures(apiKey, sport, dt.toISOString().slice(0, 10)); 
             scheduledFixtures.push(...fixtures); 
           } 
         } 
 
         // Merge live + scheduled, deduplicated by external_event_id 
         const seen = new Set(); 
         const merged = []; 
         for (const e of [...liveFixtures, ...scheduledFixtures]) { 
           if (!seen.has(e.external_event_id)) { seen.add(e.external_event_id); merged.push(e); } 
         } 
 
         if (!merged.length) continue; 
 
         // ── Phase 2: Fetch odds-api.io events list for this sport ──────────── 
         let oddsEvents = []; 
         if (oddsKey) { 
           try { 
             oddsEvents = await fetchAllOddsApiEventsForSport(oddsKey, sport, 3); 
           } catch (err) { 
             console.warn(`[SportsSync] odds-api.io list error (${sport}):`, err.message); 
           } 
         } 
 
         // ── Phase 3: Fuzzy match + fetch per-event odds ────────────────────── 
         let oddsMap = new Map(); 
         if (oddsKey && oddsEvents.length > 0) { 
           try { 
             if (isFullSync) { 
               // Full sync: fetch markets for all events (scheduled + live) 
               oddsMap = await buildOddsMap(merged, oddsEvents, sport, oddsKey, bookmakers, true); 
             } else { 
               // Live-only cycle: ALWAYS fetch full markets for live events (critical!) 
               // For scheduled events use basic odds only (no extra API calls) 
               const liveOnly  = merged.filter(e => e.is_live); 
               const scheduled = merged.filter(e => !e.is_live); 
               if (liveOnly.length > 0) { 
                 const liveOddsMap = await buildOddsMap(liveOnly, oddsEvents, sport, oddsKey, bookmakers, true); 
                 liveOddsMap.forEach((v, k) => oddsMap.set(k, v)); 
               } 
               if (scheduled.length > 0) { 
                 const schedOddsMap = await buildOddsMap(scheduled, oddsEvents, sport, oddsKey, bookmakers, false); 
                 schedOddsMap.forEach((v, k) => { if (!oddsMap.has(k)) oddsMap.set(k, v); }); 
               } 
             } 
           } catch (err) { 
             console.warn(`[SportsSync] odds merge error (${sport}):`, err.message); 
           } 
         } 
 
         // ── Phase 4: Apply odds to fixtures ────────────────────────────────── 
         for (const ev of merged) { 
           const odds = oddsMap.get(ev.external_event_id); 
           if (odds) { 
             if (odds.home_odd > 0) ev.home_odd = odds.home_odd; 
             if (odds.draw_odd > 0) ev.draw_odd = odds.draw_odd; 
             if (odds.away_odd > 0) ev.away_odd = odds.away_odd; 
             if (odds.markets && Object.keys(odds.markets).length > 0) { 
               ev.markets = JSON.stringify(odds.markets); 
             } 
           } 
         } 
 
        await upsertEvents(merged); 
         totalSynced += merged.length; 
         syncedSports.push(sport); 
 
         const withOdds = merged.filter(e => e.home_odd > 0).length; 
         const isLiveCount = merged.filter(e => e.is_live).length; 
         console.log(`[SportsSync] ${sport}: ${isLiveCount} live + ${merged.length - isLiveCount} scheduled = ${merged.length} (${withOdds} with odds)`); 
 
       } catch (err) { 
         console.error(`[SportsSync] ${sport} error:`, err.message); 
       } 
     } 
   } else if (oddsKey) { 
     // ── Fallback: no API-Football key → sync directly from odds-api.io ─────── 
     const oddsOnlySports = ['soccer', 'basketball', 'tennis', 'mma', 'boxing', 'ice-hockey', 'american-football', 'handball', 'volleyball', 'rugby']; 
     for (const sport of oddsOnlySports) { 
       try { 
         const slugs = (SPORT_SLUG_MAP[sport] || []).slice(0, 2); 
         if (!slugs.length) continue; 
 
         const markets  = SPORT_MARKETS[sport] || DEFAULT_MARKETS; 
         const books    = bookmakers; 
         const allEvts  = await fetchAllOddsApiEventsForSport(oddsKey, sport, 3); 
         if (!allEvts.length) continue; 
 
         // Fetch full odds for each event 
         const oddsResults = await runPool(allEvts.slice(0, 200), 4, async (ev) => { 
           const result = await fetchOddsApiOddsForEvent(oddsKey, ev.id, markets, books); 
           return { ev, result }; 
         }); 
 
         const events = []; 
         for (const { ev, result } of oddsResults) { 
           if (!result && !extractBasicOdds(ev).home) continue; 
           const odds = result?.primary || extractBasicOdds(ev); 
           const isLiveStatus = String(ev.status || '').toLowerCase().includes('live') || 
                                String(ev.status || '').toLowerCase() === 'inprogress'; 
           const dateIso = new Date(ev.date); 
           if (isNaN(dateIso.getTime())) continue; 
 
           events.push({ 
             external_event_id: `${sport}_odds_${ev.id}`, 
             sport, 
             league: ev.league_name || ev.league_slug || sport, 
             country: '', 
             home_team:      ev.home, 
             away_team:      ev.away, 
             team_match:     `${ev.home} vs ${ev.away}`, 
             home_team_logo: '', 
             away_team_logo: '', 
             event_date:     dateIso.toISOString(), 
             status:         isLiveStatus ? 'LIVE' : 'NS', 
             is_live:        isLiveStatus ? 1 : 0, 
             elapsed:        0, 
             score:          '{"home":null,"away":null}', 
             home_odd:       odds.home || 0, 
             draw_odd:       odds.draw || 0, 
             away_odd:       odds.away || 0, 
             markets:        result?.markets ? JSON.stringify(result.markets) : '{}', 
           }); 
         } 
 
         if (events.length > 0) { 
          await upsertEvents(events); 
           totalSynced += events.length; 
           if (!syncedSports.includes(sport)) syncedSports.push(sport); 
           console.log(`[SportsSync] odds-only ${sport}: ${events.length} events`); 
         } 
       } catch (err) { 
         console.error(`[SportsSync] odds-only ${sport} error:`, err.message); 
       } 
     } 
   } 
 
  if (isFullSync) await cleanupOldEvents(); 
 
  const db = await getDb(); 
  const dbTotal = await db.prepare('SELECT COUNT(*) as c FROM events').get(); 
  const dbLive  = await db.prepare("SELECT COUNT(*) as c FROM events WHERE is_live = 1").get(); 
   console.log(`[SportsSync] Done. ${totalSynced} synced [${syncedSports.join(', ')}] | DB: ${dbTotal?.c || 0} total, ${dbLive?.c || 0} live`); 
 
   return { synced: totalSynced, sports: syncedSports }; 
} 
 
// ─── Fast live-odds refresh (runs every ~60s) ──────────────────────────────── 
// Updates odds + scores for events currently marked is_live=1. 
// Uses matchIdCache (populated by full sync) to skip fuzzy-matching. 
// Also re-fetches live fixture scores from API-Football. 
let liveRefreshRunning = false; 
 
export async function runLiveOddsRefresh() { 
   if (liveRefreshRunning) return; // no overlap 
   liveRefreshRunning = true; 
   try { 
     const apiKey  = process.env.API_SPORTS_KEY; 
     const oddsKey = process.env.ODDS_API_KEY; 
     if (!oddsKey && !apiKey) return; 
 
     const bookmakers = getOddsApiBookmakers(); 
 
    const db = await getDb(); 
    const liveRows = await db.prepare( 
       "SELECT id, external_event_id, sport, league, home_team, away_team, event_date FROM events WHERE is_live = 1 LIMIT 200" 
    ).all(); 
 
     if (!liveRows.length) return; 
 
     // ── Step 1: update scores via API-Football live fixture endpoint ─────── 
     if (apiKey) { 
       const sportSet = [...new Set(liveRows.map(r => r.sport))]; 
       for (const sport of sportSet) { 
         try { 
           const liveFixtures = await fetchLiveFixtures(apiKey, sport); 
           if (!liveFixtures.length) continue; 
          const updateScore = db.prepare(` 
             UPDATE events 
             SET score = ?, elapsed = ?, status = ?, updated_at = ? 
             WHERE external_event_id = ? AND is_live = 1 
           `); 
           const now = new Date().toISOString(); 
           for (const fix of liveFixtures) { 
            await updateScore.run(fix.score, fix.elapsed, fix.status, now, fix.external_event_id); 
           } 
         } catch { /* skip sport on error */ } 
       } 
     } 
 
     // ── Step 2: update odds via matchIdCache → odds-api.io direct lookup ── 
     if (!oddsKey) return; 
 
    const marketsBySport = SPORT_MARKETS; 
    let toRefresh = liveRows.filter(r => matchIdCache.has(r.external_event_id)); 
 
    if (!toRefresh.length) {
        const toMatch = liveRows.filter(r => !matchIdCache.has(r.external_event_id)).slice(0, 80);
      if (toMatch.length) {
        const oddsEventsBySport = new Map();
        const getOddsEventsForSport = async (sport) => {
          if (oddsEventsBySport.has(sport)) return oddsEventsBySport.get(sport);
          const promise = (async () => {
            const slugs = getOddsApiSlugsForSport(sport, 2);
            const lists = await Promise.all(slugs.map(slug => fetchOddsApiEventsList(oddsKey, slug, 2, 'pending,live')));
            return lists.flat();
          })();
          oddsEventsBySport.set(sport, promise);
          return promise;
        };

        await runPool(toMatch, 2, async (row) => {
          try {
            const oddsEvents = await getOddsEventsForSport(row.sport);
            const matched = matchOddsEvent(
              {
                league: row.league || '',
                home_team: row.home_team || '',
                away_team: row.away_team || '',
                event_date: row.event_date || null,
              },
              oddsEvents,
              70
            );
            if (matched?.id) matchIdCache.set(row.external_event_id, { oddsApiId: matched.id, cachedAt: Date.now() });
          } catch { /* empty */ }
        });
      }
 
      toRefresh = liveRows.filter(r => matchIdCache.has(r.external_event_id)); 
      if (!toRefresh.length) return; 
    }
 
    const updateOdds = db.prepare(` 
       UPDATE events 
       SET 
         home_odd = CASE WHEN ? > 0 THEN ? ELSE home_odd END,
         draw_odd = CASE WHEN ? > 0 THEN ? ELSE draw_odd END,
         away_odd = CASE WHEN ? > 0 THEN ? ELSE away_odd END,
         markets  = CASE WHEN ? IS NOT NULL AND ? != '' AND ? != '{}' THEN ? ELSE markets END,
         updated_at = ?
       WHERE id = ? AND is_live = 1 
     `); 
 
     await runPool(toRefresh, 4, async (row) => { 
       try { 
         const { oddsApiId } = matchIdCache.get(row.external_event_id) || {}; 
         if (!oddsApiId) return; 
        const mktCsv = marketsBySport[row.sport] || DEFAULT_MARKETS;
        const result = await fetchOddsApiOddsForEvent(oddsKey, oddsApiId, mktCsv, bookmakers); 
         if (!result) return; 
         const { primary, markets: mktsObj } = result; 
        const primaryHome = Number(primary?.home || 0);
        const primaryDraw = Number(primary?.draw || 0);
        const primaryAway = Number(primary?.away || 0);
        const marketsJson = JSON.stringify(mktsObj || {});
        const hasMarkets = marketsJson && marketsJson !== '{}' && marketsJson !== 'null';
        if (!hasMarkets && primaryHome <= 0) return;
         const now = new Date().toISOString(); 
        await updateOdds.run( 
          primaryHome, primaryHome,
          primaryDraw, primaryDraw,
          primaryAway, primaryAway,
          marketsJson, marketsJson, marketsJson, marketsJson,
          now,
          row.id
         ); 
       } catch { /* skip event on error */ } 
     }); 
 
     const refreshed = toRefresh.length; 
     if (refreshed > 0) { 
       console.log(`[LiveRefresh] Updated ${refreshed} live events (odds+scores)`); 
     } 
   } catch (err) { 
     console.error('[LiveRefresh] error:', err.message); 
   } finally { 
     liveRefreshRunning = false; 
   } 
}
