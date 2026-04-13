export const LIVE_STATUSES = new Set([
  // Soccer
  '1H','2H','ET','P','BT','HT','LIVE','IN_PLAY','inprogress','live','INPROGRESS',
  // Basketball
  'Q1','Q2','Q3','Q4','OT',
  // Ice hockey / hockey periods
  'P1','P2','P3','PO',
  // Volleyball sets
  'S1','S2','S3','S4','S5',
  // Handball periods
  'H1','H2',
  // Generic
  'IN PLAY','IN-PLAY','PLAYING','STARTED',
]);

export const FINISHED_STATUSES = new Set(['FT','AET','PEN','AWD','WO','ABD','FIN','FINAL','Finished','Match Finished','Final','Ended','AOT','AP','POST','FT_PEN']);

function _poissonP(lambda, k) {
  let p = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) p = p * lambda / i;
  return Math.max(0, p);
}

function _drawProbSym(lambda) {
  let s = 0;
  for (let k = 0; k <= 15; k++) { const p = _poissonP(lambda, k); s += p * p; }
  return s;
}

function _lambdaFromDraw(pDraw) {
  pDraw = Math.max(0.06, Math.min(0.48, pDraw));
  let lo = 0.05, hi = 9;
  for (let i = 0; i < 55; i++) {
    const mid = (lo + hi) / 2;
    if (_drawProbSym(mid) > pDraw) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

export function derivedBtts(homeOdd, drawOdd, awayOdd, houseMargin = 0.08) {
  const hO = Number(homeOdd), dO = Number(drawOdd), aO = Number(awayOdd);
  if (!(dO > 1.01 && hO > 1.01 && aO > 1.01)) return null;

  const pH = 1 / hO, pD = 1 / dO, pA = 1 / aO;
  const total = pH + pD + pA;

  const pDNorm = pD / total;
  const pHNorm = pH / total;
  const pANorm = pA / total;

  const lambdaSym = _lambdaFromDraw(pDNorm);
  const lambdaTotal = lambdaSym * 2;

  const ratio = pHNorm > 0.01 && pANorm > 0.01 ? pHNorm / pANorm : 1;
  const clampedRatio = Math.max(0.35, Math.min(3.0, ratio));
  const homeFrac = clampedRatio / (1 + clampedRatio);
  const lambdaH = lambdaTotal * homeFrac;
  const lambdaA = lambdaTotal * (1 - homeFrac);

  const p0H = Math.exp(-lambdaH);
  const p0A = Math.exp(-lambdaA);
  const bttsProb = 1 - p0H - p0A + p0H * p0A;

  if (!(bttsProb > 0.05 && bttsProb < 0.95)) return null;

  const k = 1 + houseMargin;
  const simOdd  = Math.round((1 / (bttsProb * k)) * 100) / 100;
  const naoOdd  = Math.round((1 / ((1 - bttsProb) * k)) * 100) / 100;

  return [
    { name: 'Sim', label: 'Sim', price: simOdd, odd: simOdd, derived: true },
    { name: 'Não', label: 'Não', price: naoOdd, odd: naoOdd, derived: true },
  ];
}

const ALLOWED_SOCCER_COUNTRIES = new Set([
  'germany','argentina','belgium','brazil','colombia','denmark','scotland','spain','usa','france',
  'greece','england','italy','japan','mexico','netherlands','portugal','switzerland','turkey','uruguay',
  'world','international','europe','south america','north america','oceania','africa','asia',
]);

const TOP_TIER_LEAGUES = new Set([
  'uefa champions league','uefa europa league','uefa europa conference league',
  'premier league','la liga','bundesliga','ligue 1',
  'serie a','serie b','coppa italia',       // Italian 
  'brasileirão série a','brasileirao série a','brasileirão serie a','brasileirao serie a', // Brazilian 
  'primeira liga','liga portugal',
  'conmebol libertadores','conmebol sudamericana',
  'copa del rey','fa cup','efl cup','dfb pokal','coppa italia','coupe de france',
  'liga mx','mls','nba','nhl','nfl','mlb',
  'uefa euro','world cup','copa america','fifa world cup','conmebol recopa',
  'uefa nations league',
]);

const COUNTRY_ALLOWED_LEAGUES = {
  germany:     ['bundesliga','2. bundesliga','dfb pokal','dfb-pokal'],
  argentina:   ['liga profesional','primera nacional','copa argentina'],
  belgium:     ['jupiler pro league','belgian cup','pro league'],
  brazil:      ['brasileirão','brasileirao','série a','serie a','série b','serie b','copa do brasil','paulistão','paulistao','carioca','gauchão','gauchao','mineiro','pernambucano'],
  colombia:    ['primera a','primera b','copa colombia'],
  denmark:     ['superliga','danish cup','danish superliga'],
  scotland:    ['premiership','scottish cup','championship','scottish premiership'],
  spain:       ['la liga','la liga 2','copa del rey','segunda división','segunda division'],
  usa:         ['mls','us open cup','usl','major league'],
  france:      ['ligue 1','ligue 2','coupe de france','coupe de la ligue'],
  greece:      ['super league','greek cup','super league 1'],
  england:     ['premier league','championship','fa cup','efl cup','league one','league two','carabao'],
  italy:       ['serie a','serie b','coppa italia'],
  japan:       ['j1 league','j2 league','j.league','emperor\'s cup','emperors cup'],
  mexico:      ['liga mx','copa mx','liga de expansión','liga de expansion','ascenso'],
  netherlands: ['eredivisie','eerste divisie','knvb beker','knvb cup'],
  portugal:    ['liga portugal','primeira liga','liga 2','taça de portugal','taca de portugal','taça da liga','taca da liga','liga nos'],
  switzerland: ['super league','swiss cup','challenge league'],
  turkey:      ['süper lig','super lig','turkish cup','1. lig'],
  uruguay:     ['primera división','primera division'],
  world:       ['champions league','europa league','conference league','nations league','world cup','copa america','intercontinental','club world'],
  europe:      ['champions league','europa league','conference league','nations league'],
  international:['champions league','europa league','conference league','world cup','copa america'],
};

export function isLeagueAllowed(leagueName, country) {
  if (!leagueName) return false;
  const l = leagueName.toLowerCase();
  const c = String(country || '').toLowerCase().trim();

  // Country-specific TOP_TIER check first (avoids ambiguous 'serie a') 
  if (c) {
    const allowed = COUNTRY_ALLOWED_LEAGUES[c];
    if (allowed && allowed.some(k => l.includes(k))) return true;
    if (!allowed && ALLOWED_SOCCER_COUNTRIES.has(c)) return true;
  }

  // Exact match on top-tier league names (country-agnostic) 
  if (TOP_TIER_LEAGUES.has(l)) return true;
  for (const key of TOP_TIER_LEAGUES) { if (l.includes(key)) return true; } 

  // Substring match — only for unambiguous top-tier names 
  const UNAMBIGUOUS_TOP = [
    'champions league','europa league','conference league','nations league',
    'premier league','la liga','bundesliga','ligue 1','primeira liga',
    'libertadores','sudamericana','world cup','copa america','intercontinental',
    'copa del rey','fa cup','efl cup','dfb pokal','coupe de france',
    'brasileirão','brasileirao',
  ];
  if (UNAMBIGUOUS_TOP.some(k => l.includes(k))) return true;

  if (!c) {
    // No country: only allow truly international leagues 
    const intlKeywords = ['champions','europa league','conference league','nations league','world cup','copa america','libertadores'];
    return intlKeywords.some(k => l.includes(k));
  }

  if (!ALLOWED_SOCCER_COUNTRIES.has(c)) return false;
  
  const allowed = COUNTRY_ALLOWED_LEAGUES[c]; 
  if (!allowed) return true; // Country allowed but no specific filter → allow all leagues from this country 
  return allowed.some(k => l.includes(k)); 
}

const BLOCKED_KEYWORDS = [
  '3. liga','terceira liga','liga 3','serie c','série c','vanarama','isthmian',
  'southern league','northern league','eastern league','western league','division 3',
  '3rd division','dritte liga','ligue 3','tercera division','segunda division b',
  'division of honour','national league north','national league south','national league s',
  'u19','u20','u21','u23','primavera','reserve','amateur','youth','juniores','juvenil',
  'esport','virtual','simulated','short football','taiwan football','rfef group',
  'druha liga','esiliiga','i liga','serie d','série d','oberliga','regionalliga',
  'landesliga','saturday super series',
];

export function isBlocked(league) {
  const l = (league || '').toLowerCase();
  return BLOCKED_KEYWORDS.some(k => l.includes(k));
}

export function normalizeSport(s) {
  const sport = String(s || '').toLowerCase().trim();
  if (sport === 'football' || sport === 'futebol') return 'soccer';
  if (sport === 'basketball' || sport === 'basquetebol') return 'basketball';
  if (sport === 'hockey' || sport === 'hóquei') return 'ice-hockey';
  if (sport === 'nba') return 'basketball';
  return sport;
}

export function leagueTier(league, country) {
  const l = (league || '').toLowerCase();
  for (const key of TOP_TIER_LEAGUES) { if (l.includes(key)) return 0; }
  const c = (country || '').toLowerCase();
  if (['england','spain','germany','italy','france'].includes(c)) return 1;
  if (['portugal','netherlands','brazil','argentina','usa','mexico'].includes(c)) return 2;
  return 3;
}

export function buildSuspendedMarkets(event) {
  const scoreRaw = event.score;
  let score = { home: null, away: null };
  try { score = typeof scoreRaw === 'string' ? JSON.parse(scoreRaw) : (scoreRaw || score); } catch {}

  const homeGoals = score?.home != null ? Number(score.home) : null;
  const awayGoals = score?.away != null ? Number(score.away) : null;
  const totalGoals = (homeGoals != null && awayGoals != null) ? homeGoals + awayGoals : null;

  if (homeGoals == null || awayGoals == null) return {};

  const suspended = {};

  if (totalGoals !== null) {
    const tooLow = [];
    if (homeGoals > 0 || awayGoals > 0) tooLow.push('0-0');
    if (homeGoals > 1 || awayGoals > 0) tooLow.push('1-0');
    if (homeGoals > 0 || awayGoals > 1) tooLow.push('0-1');
    if (homeGoals > 1 || awayGoals > 1) tooLow.push('1-1');
    if (tooLow.length) suspended.correct_score_blocked = tooLow;
  }

  if (totalGoals !== null && totalGoals > 0) {
    suspended.totals_blocked_below = totalGoals;
  }

  return suspended;
}

const teamImageCache = new Map();
const teamImageInFlight = new Map();
const TEAM_IMAGE_TTL = 24 * 60 * 60 * 1000;

let tsdbSlots = 2;
const tsdbQueue = [];
function tsdbAcquire() {
  return new Promise(resolve => {
    if (tsdbSlots > 0) { tsdbSlots--; resolve(); }
    else tsdbQueue.push(resolve);
  });
}
function tsdbRelease() {
  if (tsdbQueue.length > 0) { const next = tsdbQueue.shift(); next(); }
  else tsdbSlots++;
}

async function searchSportsDb(teamName) {
  await tsdbAcquire();
  try {
    const encoded = encodeURIComponent(teamName);
    const resp = await fetch(
      `https://www.thesportsdb.com/api/v1/json/3/searchteams.php?t=${encoded}`,
      { signal: AbortSignal.timeout(7000) }
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    const t = Array.isArray(data?.teams) ? data.teams[0] : null;
    return t?.strFanart4 || t?.strFanart3 || t?.strFanart2 || t?.strFanart1 || t?.strBanner || null;
  } catch {
    return null;
  } finally {
    tsdbRelease();
  }
}

function teamVariants(name) {
  const v = [name];
  const stripped = name
    .replace(/\b(FC|SC|AC|CD|SV|FK|SK|BK|CF|AS|SS|RC|RB|VFB|FSV|TSG|BSC|HSV|VFL|SL|GD|FCP|SCP)\b\.?\s*/gi, '')
    .replace(/\s+\d{2,4}$/, '')
    .replace(/-\w{2,3}$/, '')
    .trim();
  if (stripped && stripped !== name) v.push(stripped);
  const abbrev = {
    'Manchester United': 'Man United', 'Man United': 'Manchester United',
    'Manchester City': 'Man City',
    'PSG': 'Paris Saint-Germain', 'Paris Saint Germain': 'Paris Saint-Germain',
    'Atletico Madrid': 'Atletico de Madrid', 'Atletico de Madrid': 'Atletico Madrid',
    'Inter Milan': 'Internazionale', 'AC Milan': 'Milan',
    'Tottenham': 'Tottenham Hotspur', 'Spurs': 'Tottenham Hotspur',
    'Bayer Leverkusen': 'Leverkusen', 'RB Leipzig': 'Leipzig',
  };
  if (abbrev[name]) v.push(abbrev[name]);
  const firstWord = name.split(/[\s-]/)[0];
  if (firstWord && firstWord.length > 4 && firstWord !== name) v.push(firstWord);
  return [...new Set(v)];
}

export async function resolveTeamImage(team) {
  const cacheKey = team.toLowerCase();
  const cached = teamImageCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < TEAM_IMAGE_TTL) return cached.url;

  if (teamImageInFlight.has(cacheKey)) return teamImageInFlight.get(cacheKey);

  const promise = (async () => {
    const variants = teamVariants(team);
    let url = null;
    for (const variant of variants) {
      url = await searchSportsDb(variant);
      if (url) break;
    }
    teamImageCache.set(cacheKey, { url, ts: Date.now() });
    teamImageInFlight.delete(cacheKey);
    return url;
  })();

  teamImageInFlight.set(cacheKey, promise);
  return promise;
}