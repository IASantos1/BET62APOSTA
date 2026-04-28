type CacheEntry = { expiresAt: number; data: { live: any[]; pregame: any[] } };
const cache = new Map<string, CacheEntry>();
let statpalDebugCache: { expiresAt: number; payload: any } | null = null;
let allEventsCache: { expiresAt: number; data: any[] } | null = null;
let allEventsInflight: Promise<any[]> | null = null;
const sportEventsCache = new Map<string, { expiresAt: number; data: any[] }>();
const sportEventsInflight = new Map<string, Promise<any[]>>();

const STATPAL_V1 = 'https://statpal.io/api/v1';
const STATPAL_V2 = 'https://statpal.io/api/v2';

const MK_FULLTIME_RESULT = '3610';
const MK_MATCH_GOALS = '2254';
const MK_BTTS = '12398';

const LIVE_STATUSES = new Set([
  '1st half',
  '2nd half',
  '1h',
  '2h',
  'halftime',
  'half time',
  'ht',
  'int',
  'intermission',
  'live',
  'in play',
  'inplay',
  'playing',
  'extra time',
  'penalties',
  'pen',
  '1q',
  '2q',
  '3q',
  '4q',
  'ot',
]);

const FINISHED_STATUSES = new Set([
  'ft',
  'aet',
  'pen',
  'finished',
  'final',
  'ended',
  'after extra time',
  'awd',
  'wo',
  'abd',
  'cancelled',
  'canceled',
]);

function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function normTeamKey(s: any): string {
  return String(s || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function makePrematchKey(args: { leagueId: string; date: string; time: string; home: string; away: string }): string {
  const lid = String(args.leagueId || '').trim();
  const date = String(args.date || '').trim();
  const time = String(args.time || '').trim();
  return `${lid}|${date}|${time}|${normTeamKey(args.home)}|${normTeamKey(args.away)}`;
}

function makePrematchKeyNoTime(args: { leagueId: string; date: string; home: string; away: string }): string {
  const lid = String(args.leagueId || '').trim();
  const date = String(args.date || '').trim();
  return `${lid}|${date}|${normTeamKey(args.home)}|${normTeamKey(args.away)}`;
}

function isLive(status: string): boolean {
  const s = String(status || '').toLowerCase().trim();
  if (FINISHED_STATUSES.has(s)) return false;
  return LIVE_STATUSES.has(s);
}

function isFinished(status: string): boolean {
  const s = String(status || '').toLowerCase().trim();
  return FINISHED_STATUSES.has(s);
}

function parseDateTime(date: string, time: string): string {
  const m = String(date || '').match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!m) return new Date().toISOString();
  const [, dd, mm, yyyy] = m;
  const t = String(time || '00:00').padStart(5, '0');
  return `${yyyy}-${mm}-${dd}T${t}:00.000Z`;
}

function minuteFromStatus(status: string): number {
  const s = String(status || '').toLowerCase().trim();
  const m = s.match(/(\d{1,3})(?:\s*\+\s*(\d{1,2}))?/);
  if (m) {
    const base = Number(m[1]);
    if (Number.isFinite(base) && base > 0 && base <= 130) return base;
  }
  if (s === 'ht' || s === 'halftime' || s === 'half time' || s === 'int' || s === 'intermission') return 45;
  if (s === '1st half' || s === '1h') return 25;
  if (s === '2nd half' || s === '2h') return 70;
  if (s === 'extra time' || s === 'et') return 105;
  return 0;
}

function parseOddNum(v: any): number {
  const n = Number(String(v ?? '').trim());
  return Number.isFinite(n) && n > 1 ? +n.toFixed(3) : 0;
}

function pickPrimaryTotalsLine(lines: any[]): { line: string; over: number; under: number } | null {
  if (!Array.isArray(lines) || lines.length === 0) return null;
  const byLine = new Map<string, { over?: number; under?: number }>();
  for (const ln of lines) {
    const h = String(ln?.handicap ?? '').trim();
    if (!h) continue;
    if (String(ln?.suspended) === '1') continue;
    const odd = parseOddNum(ln?.odd);
    if (odd <= 1) continue;
    const name = String(ln?.name || '').toLowerCase();
    const slot = byLine.get(h) || {};
    if (name === 'over') slot.over = odd;
    else if (name === 'under') slot.under = odd;
    byLine.set(h, slot);
  }
  const pairs: Array<{ line: string; over: number; under: number }> = [];
  for (const [line, v] of byLine.entries()) {
    if (v.over && v.under) pairs.push({ line, over: v.over, under: v.under });
  }
  if (pairs.length === 0) return null;
  pairs.sort((a, b) => Math.abs(parseFloat(a.line) - 2.5) - Math.abs(parseFloat(b.line) - 2.5));
  return pairs[0];
}

type ParsedOdds = {
  home_odd: number;
  draw_odd: number;
  away_odd: number;
  markets_json: string;
  score?: { home: number; away: number };
  minute?: number;
  timer?: string;
};

function parseV2OddsForMatch(m: any): ParsedOdds {
  const oddsObj = m?.odds || {};
  const markets: Record<string, any[]> = {};
  let home_odd = 0;
  let draw_odd = 0;
  let away_odd = 0;

  for (const k of Object.keys(oddsObj)) {
    const mk = oddsObj[k];
    if (String(mk?.market_id) !== MK_FULLTIME_RESULT) continue;
    if (String(mk?.suspended) === '1') break;
    const sels = asArray(mk?.lines);
    const homeLn = sels.find((l: any) => String(l?.name).toLowerCase() === 'home' && String(l?.suspended) !== '1');
    const drawLn = sels.find((l: any) => String(l?.name).toLowerCase() === 'draw' && String(l?.suspended) !== '1');
    const awayLn = sels.find((l: any) => String(l?.name).toLowerCase() === 'away' && String(l?.suspended) !== '1');
    home_odd = parseOddNum(homeLn?.odd);
    draw_odd = parseOddNum(drawLn?.odd);
    away_odd = parseOddNum(awayLn?.odd);
    if (home_odd > 1 && away_odd > 1) {
      markets.h2h = [
        { name: 'Casa', label: 'Casa', odd: home_odd, price: home_odd },
        { name: 'Empate', label: 'Empate', odd: draw_odd, price: draw_odd },
        { name: 'Fora', label: 'Fora', odd: away_odd, price: away_odd },
      ].filter((x) => Number(x.odd) > 1);
    }
    break;
  }

  for (const k of Object.keys(oddsObj)) {
    const mk = oddsObj[k];
    if (String(mk?.market_id) !== MK_MATCH_GOALS) continue;
    if (String(mk?.suspended) === '1') break;
    const picked = pickPrimaryTotalsLine(asArray(mk?.lines));
    if (picked) {
      markets.totals = [
        { name: `Over ${picked.line}`, label: `Over ${picked.line}`, odd: picked.over, price: picked.over, total: picked.line, line: picked.line },
        { name: `Under ${picked.line}`, label: `Under ${picked.line}`, odd: picked.under, price: picked.under, total: picked.line, line: picked.line },
      ].filter((x) => Number(x.odd) > 1);
    }
    break;
  }

  for (const k of Object.keys(oddsObj)) {
    const mk = oddsObj[k];
    if (String(mk?.market_id) !== MK_BTTS) continue;
    if (String(mk?.suspended) === '1') break;
    const sels = asArray(mk?.lines);
    const yesLn = sels.find((l: any) => String(l?.name).toLowerCase() === 'yes' && String(l?.suspended) !== '1');
    const noLn = sels.find((l: any) => String(l?.name).toLowerCase() === 'no' && String(l?.suspended) !== '1');
    const yes = parseOddNum(yesLn?.odd);
    const no = parseOddNum(noLn?.odd);
    if (yes > 1 && no > 1) {
      markets.btts = [
        { name: 'Yes', label: 'Yes', odd: yes, price: yes },
        { name: 'No', label: 'No', odd: no, price: no },
      ].filter((x) => Number(x.odd) > 1);
    }
    break;
  }

  let score: { home: number; away: number } | undefined;
  const sc = String(m?.match_info?.score || '').trim();
  const scMatch = sc.match(/^(\d+)\s*[:-]\s*(\d+)$/);
  if (scMatch) score = { home: Number(scMatch[1]), away: Number(scMatch[2]) };

  const minuteRaw = String(m?.match_info?.minute || '').trim();
  const minNum = Number(minuteRaw);
  const minute = Number.isFinite(minNum) && minNum > 0 ? minNum : undefined;

  const period = String(m?.match_info?.period || '').toLowerCase();
  let timer: string | undefined;
  if (/half\s*time|halftime|^ht$/.test(period)) timer = 'HT';
  else if (minute) timer = `${minute}'`;
  else if (period) timer = period.toUpperCase();

  return {
    home_odd,
    draw_odd,
    away_odd,
    markets_json: Object.keys(markets).length > 0 ? JSON.stringify(markets) : '',
    score,
    minute,
    timer,
  };
}

function parsePrematchOddsForMatch(m: any): ParsedOdds {
  const oddsArr = asArray(m?.odds);
  let home = 0;
  let draw = 0;
  let away = 0;
  for (const market of oddsArr) {
    const bookmakers = asArray(market?.bookmaker);
    for (const bm of bookmakers) {
      const oddList = asArray(bm?.odd);
      const h = parseOddNum(oddList.find((o: any) => String(o?.name || '').toLowerCase() === 'home')?.value);
      const d = parseOddNum(oddList.find((o: any) => String(o?.name || '').toLowerCase() === 'draw')?.value);
      const a = parseOddNum(oddList.find((o: any) => String(o?.name || '').toLowerCase() === 'away')?.value);
      if (h > 1 && a > 1) {
        home = h;
        draw = d;
        away = a;
        break;
      }
    }
    if (home > 1 && away > 1) break;
  }

  const markets: Record<string, any[]> = {};
  if (home > 1 && away > 1) {
    markets.h2h = [
      { name: 'Casa', label: 'Casa', odd: home, price: home },
      { name: 'Empate', label: 'Empate', odd: draw, price: draw },
      { name: 'Fora', label: 'Fora', odd: away, price: away },
    ].filter((x) => Number(x.odd) > 1);
  }

  return {
    home_odd: home,
    draw_odd: draw,
    away_odd: away,
    markets_json: Object.keys(markets).length > 0 ? JSON.stringify(markets) : '',
  };
}

async function fetchStatpalLiveOddsV2(apiKey: string): Promise<Map<string, ParsedOdds>> {
  const url = `${STATPAL_V2}/soccer/odds/live?access_key=${encodeURIComponent(apiKey)}`;
  const map = new Map<string, ParsedOdds>();
  const res = await fetch(url);
  if (!res.ok) return map;
  const json: any = await res.json().catch(() => null);
  const matches = asArray(json?.live_matches);
  for (const m of matches) {
    const parsed = parseV2OddsForMatch(m);
    const ids = [
      m?.match_info?.main_id,
      m?.match_info?.fallback_id_1,
      m?.match_info?.fallback_id_2,
      m?.match_info?.fallback_id_3,
    ]
      .map((x) => String(x || '').trim())
      .filter(Boolean);
    for (const id of ids) {
      if (!map.has(id)) map.set(id, parsed);
    }
  }
  return map;
}

let cachedPregameOddsEndpoint: string | null = null;
let cachedPregameOddsCheckedAt = 0;
const PREMATCH_PROBE_TTL_MS = 24 * 60 * 60 * 1000;

async function fetchStatpalPregameOddsV2(apiKey: string): Promise<Map<string, ParsedOdds>> {
  const map = new Map<string, ParsedOdds>();
  if (cachedPregameOddsEndpoint === '__none__' && Date.now() - cachedPregameOddsCheckedAt < PREMATCH_PROBE_TTL_MS) {
    return map;
  }
  const candidates = cachedPregameOddsEndpoint
    ? [cachedPregameOddsEndpoint]
    : [
        `${STATPAL_V2}/soccer/odds/pregame?access_key=${encodeURIComponent(apiKey)}`,
        `${STATPAL_V2}/soccer/odds/prematch?access_key=${encodeURIComponent(apiKey)}`,
        `${STATPAL_V2}/soccer/odds/pre-match?access_key=${encodeURIComponent(apiKey)}`,
        `${STATPAL_V2}/soccer/odds/upcoming?access_key=${encodeURIComponent(apiKey)}`,
        `${STATPAL_V2}/soccer/odds?type=pregame&access_key=${encodeURIComponent(apiKey)}`,
        `${STATPAL_V2}/soccer/odds?type=prematch&access_key=${encodeURIComponent(apiKey)}`,
        `${STATPAL_V2}/soccer/odds?type=upcoming&access_key=${encodeURIComponent(apiKey)}`,
        `${STATPAL_V2}/soccer/odds?access_key=${encodeURIComponent(apiKey)}`,
      ];

  for (const url of candidates) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        console.error(`[StatPal v2][odds/pregame] HTTP ${res.status} @ ${url.replace(/access_key=[^&]+/, 'access_key=REDACTED')}`);
        if (cachedPregameOddsEndpoint) return map;
        continue;
      }
      const json: any = await res.json().catch(() => null);
      const matches = asArray(
        json?.pregame_matches ||
          json?.upcoming_matches ||
          json?.matches ||
          json?.live_matches,
      );
      for (const m of matches) {
        const parsed = parseV2OddsForMatch(m);
        const ids = [
          m?.match_info?.main_id,
          m?.match_info?.fallback_id_1,
          m?.match_info?.fallback_id_2,
          m?.match_info?.fallback_id_3,
        ].map((x) => String(x || '').trim()).filter(Boolean);
        for (const id of ids) {
          if (!map.has(id)) map.set(id, parsed);
        }
      }
      cachedPregameOddsEndpoint = url;
      cachedPregameOddsCheckedAt = Date.now();
      console.log(`[StatPal v2][odds/pregame] endpoint ok | matches=${matches.length} | idKeys=${map.size}`);
      return map;
    } catch (e) {
      console.error('[StatPal v2][odds/pregame] error:', e);
      if (cachedPregameOddsEndpoint) return map;
    }
  }

  cachedPregameOddsEndpoint = '__none__';
  cachedPregameOddsCheckedAt = Date.now();
  return map;
}

type PrematchOddsIndex = { byId: Map<string, ParsedOdds>; byKey: Map<string, ParsedOdds>; byKeyNoTime: Map<string, ParsedOdds> };
let cachedPrematchLeaguesIndex: { expiresAt: number; index: PrematchOddsIndex } | null = null;

type V2MatchIdsIndex = { byKey: Map<string, string[]>; byKeyNoTime: Map<string, string[]> };
let cachedV2MatchesIndex: { expiresAt: number; index: V2MatchIdsIndex } | null = null;

function pushIds(map: Map<string, string[]>, key: string, ids: string[]) {
  if (!key) return;
  const clean = ids.map((x) => String(x || '').trim()).filter(Boolean);
  if (clean.length === 0) return;
  const prev = map.get(key);
  if (!prev) {
    map.set(key, Array.from(new Set(clean)));
    return;
  }
  const set = new Set(prev);
  for (const id of clean) set.add(id);
  map.set(key, Array.from(set));
}

function extractV2Leagues(json: any): any[] {
  const direct = asArray(json?.live_matches?.league);
  if (direct.length > 0) return direct;
  const root = json && typeof json === 'object' ? json : {};
  for (const k of Object.keys(root)) {
    const v = (root as any)[k];
    if (v && typeof v === 'object' && 'league' in v) {
      const leagues = asArray(v?.league);
      if (leagues.length > 0) return leagues;
    }
  }
  return [];
}

function indexMatchIds(
  byKey: Map<string, string[]>,
  byKeyNoTime: Map<string, string[]>,
  leagueIdRaw: any,
  m: any,
) {
  const leagueId = String(leagueIdRaw || '').trim();
  const date = String(m?.date || '').trim();
  const time = String(m?.time || '').trim();
  const home = String(m?.home?.name || '').trim();
  const away = String(m?.away?.name || '').trim();
  if (!leagueId || !date || !home || !away) return;

  const ids = [
    m?.main_id,
    m?.fallback_id_1,
    m?.fallback_id_2,
    m?.fallback_id_3,
  ].map((x: any) => String(x || '').trim()).filter(Boolean);

  const k1 = makePrematchKey({ leagueId, date, time, home, away });
  const k2 = makePrematchKey({ leagueId, date, time, home: away, away: home });
  pushIds(byKey, k1, ids);
  pushIds(byKey, k2, ids);

  const kn1 = makePrematchKeyNoTime({ leagueId, date, home, away });
  const kn2 = makePrematchKeyNoTime({ leagueId, date, home: away, away: home });
  pushIds(byKeyNoTime, kn1, ids);
  pushIds(byKeyNoTime, kn2, ids);
}

async function fetchStatpalV2MatchIdsIndex(apiKey: string, leagueIds: string[]): Promise<V2MatchIdsIndex> {
  const now = Date.now();
  if (cachedV2MatchesIndex && cachedV2MatchesIndex.expiresAt > now) return cachedV2MatchesIndex.index;

  const byKey = new Map<string, string[]>();
  const byKeyNoTime = new Map<string, string[]>();

  const urls = [
    `${STATPAL_V2}/soccer/matches/live?access_key=${encodeURIComponent(apiKey)}`,
    `${STATPAL_V2}/soccer/matches/daily?offset=0&access_key=${encodeURIComponent(apiKey)}`,
    `${STATPAL_V2}/soccer/matches/daily?offset=-1&access_key=${encodeURIComponent(apiKey)}`,
  ];

  await Promise.allSettled(
    urls.map(async (url) => {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 12000);
      try {
        const res = await fetch(url, { signal: ctrl.signal });
        if (!res.ok) return;
        const json: any = await res.json().catch(() => null);
        const leagues = extractV2Leagues(json);
        for (const lg of leagues) {
          const matches = asArray(lg?.match);
          for (const m of matches) indexMatchIds(byKey, byKeyNoTime, lg?.id, m);
        }
      } catch {
        return;
      } finally {
        clearTimeout(t);
      }
    }),
  );

  const uniqLeagueIds = Array.from(new Set(leagueIds.map((x) => String(x || '').trim()).filter(Boolean))).slice(0, 120);
  await runPool(uniqLeagueIds, 8, async (leagueId) => {
    const url = `${STATPAL_V2}/soccer/leagues/${encodeURIComponent(leagueId)}/matches?access_key=${encodeURIComponent(apiKey)}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) return;
      const json: any = await res.json().catch(() => null);
      const weeks = asArray(json?.matches?.tournament?.week);
      for (const wk of weeks) {
        const matches = asArray(wk?.match);
        for (const m of matches) indexMatchIds(byKey, byKeyNoTime, leagueId, m);
      }
    } catch {
      return;
    } finally {
      clearTimeout(t);
    }
  });

  const index = { byKey, byKeyNoTime };
  cachedV2MatchesIndex = { expiresAt: now + 30_000, index };
  return index;
}

async function runPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  const executing = new Set<Promise<void>>();
  for (const item of items) {
    const p = Promise.resolve().then(() => fn(item));
    executing.add(p);
    p.finally(() => executing.delete(p));
    if (executing.size >= limit) await Promise.race(executing);
  }
  await Promise.allSettled(Array.from(executing));
}

async function fetchStatpalPrematchOddsByLeaguesV2(apiKey: string, leagueIds: string[]): Promise<PrematchOddsIndex> {
  const now = Date.now();
  if (cachedPrematchLeaguesIndex && cachedPrematchLeaguesIndex.expiresAt > now) return cachedPrematchLeaguesIndex.index;

  const uniq = Array.from(new Set(leagueIds.map((x) => String(x || '').trim()).filter(Boolean)));
  const byId = new Map<string, ParsedOdds>();
  const byKey = new Map<string, ParsedOdds>();
  const byKeyNoTime = new Map<string, ParsedOdds>();

  const maxLeagues = 200;
  const ids = uniq.slice(0, maxLeagues);

  await runPool(ids, 10, async (leagueId) => {
    const url = `${STATPAL_V2}/soccer/leagues/${encodeURIComponent(leagueId)}/odds/prematch?access_key=${encodeURIComponent(apiKey)}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) return;
      const json: any = await res.json().catch(() => null);
      const league = json?.prematch_odds?.league;
      const matches = asArray(league?.match);
      for (const m of matches) {
        const parsed = parsePrematchOddsForMatch(m);
        const idKeys = [
          m?.main_id,
          m?.fallback_id_1,
          m?.fallback_id_2,
          m?.fallback_id_3,
        ].map((x: any) => String(x || '').trim()).filter(Boolean);
        for (const id of idKeys) {
          if (!byId.has(id)) byId.set(id, parsed);
        }
        const key = makePrematchKey({
          leagueId,
          date: String(m?.date || '').trim(),
          time: String(m?.time || '').trim(),
          home: String(m?.home?.name || '').trim(),
          away: String(m?.away?.name || '').trim(),
        });
        if (key && !byKey.has(key)) byKey.set(key, parsed);
        const keyNoTime = makePrematchKeyNoTime({
          leagueId,
          date: String(m?.date || '').trim(),
          home: String(m?.home?.name || '').trim(),
          away: String(m?.away?.name || '').trim(),
        });
        if (keyNoTime && !byKeyNoTime.has(keyNoTime)) byKeyNoTime.set(keyNoTime, parsed);
      }
    } catch {
      return;
    } finally {
      clearTimeout(t);
    }
  });

  const index = { byId, byKey, byKeyNoTime };
  cachedPrematchLeaguesIndex = { expiresAt: now + 30_000, index };
  return index;
}

async function fetchStatpalSoccer(apiKey: string): Promise<any[]> {
  const safeFetchJson = async (url: string): Promise<any | null> => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) return null;
      return await res.json().catch(() => null);
    } catch {
      return null;
    } finally {
      clearTimeout(t);
    }
  };

  const parseV1SoccerOddsMap = (json: any): Map<string, ParsedOdds> => {
    const out = new Map<string, ParsedOdds>();
    const feed =
      json?.odds_feed ||
      json?.example?.odds_feed ||
      json?.data?.odds_feed ||
      json?.result?.odds_feed ||
      null;
    const leagues = asArray(feed?.league);
    const isTrue = (v: any) => {
      const s = String(v ?? '').toLowerCase().trim();
      return s === 'true' || s === '1' || s === 'yes';
    };

    for (const lg of leagues) {
      const matches = asArray(lg?.match);
      for (const mt of matches) {
        const id = String(mt?.id || '').trim();
        if (!id) continue;
        const altId = String(mt?.alternate_id || '').trim();
        const altId2 = String(mt?.alternate_id_2 || '').trim();
        const staticId = String(mt?.static_id || '').trim();

        const markets: Record<string, any[]> = {};
        const push = (key: string, item: any) => {
          const k = String(key || '').trim();
          if (!k) return;
          if (!markets[k]) markets[k] = [];
          markets[k].push(item);
          if (markets[k].length > 400) markets[k] = markets[k].slice(0, 400);
        };

        const bestH2h = new Map<'home' | 'draw' | 'away', number>();
        const types = asArray(mt?.odds?.type);
        for (const t of types) {
          const typeName = String(t?.name || '').trim();
          const typeLc = typeName.toLowerCase();
          const bookmakers = asArray(t?.bookmaker);

          if (typeLc === '1x2' || typeLc.includes('1x2') || typeLc.includes('full time result') || typeLc.includes('match winner')) {
            for (const bm of bookmakers) {
              for (const o of asArray(bm?.odd)) {
                const name = String(o?.name || '').trim();
                const odd = parseOddNum(o?.value ?? o?.odd ?? o?.price);
                if (!name || odd <= 1) continue;
                const n = name.toLowerCase();
                const key =
                  n === 'home' || n === '1' || n === 'casa' ? 'home' :
                  n === 'draw' || n === 'x' || n === 'empate' || n === 'tie' ? 'draw' :
                  n === 'away' || n === '2' || n === 'fora' ? 'away' :
                  null;
                if (!key) continue;
                bestH2h.set(key as any, Math.max(bestH2h.get(key as any) || 0, odd));
              }
            }
            continue;
          }

          if (typeLc.includes('both teams') && typeLc.includes('score')) {
            for (const bm of bookmakers) {
              for (const o of asArray(bm?.odd)) {
                const name = String(o?.name || '').trim();
                const odd = parseOddNum(o?.value ?? o?.odd ?? o?.price);
                if (!name || odd <= 1) continue;
                const n = name.toLowerCase();
                if (n === 'yes' || n === 'no') {
                  const selName = n === 'yes' ? 'Yes' : 'No';
                  push('btts', { name: selName, label: selName, odd, price: odd });
                }
              }
            }
            continue;
          }

          if (typeLc.includes('over/under')) {
            for (const bm of bookmakers) {
              for (const tot of asArray(bm?.total)) {
                const line = String(tot?.name ?? tot?.handicap ?? tot?.total ?? '').trim();
                if (!line) continue;
                const main = isTrue(tot?.ismain);
                for (const o of asArray(tot?.odd)) {
                  const name = String(o?.name || '').trim();
                  const odd = parseOddNum(o?.value ?? o?.odd ?? o?.price);
                  if (!name || odd <= 1) continue;
                  const n = name.toLowerCase();
                  const selName = n === 'over' ? `Over ${line}` : n === 'under' ? `Under ${line}` : `${name} ${line}`;
                  push('totals', { name: selName, label: selName, odd, price: odd, total: line, line, ismain: main ? 1 : 0 });
                }
              }
            }
            continue;
          }

          if (typeLc.includes('asian handicap') || (typeLc.includes('handicap') && !typeLc.includes('over/under'))) {
            for (const bm of bookmakers) {
              for (const hc of asArray(bm?.handicap)) {
                const line = String(hc?.name ?? hc?.handicap ?? '').trim();
                if (!line) continue;
                const main = isTrue(hc?.ismain);
                for (const o of asArray(hc?.odd)) {
                  const name = String(o?.name || '').trim();
                  const odd = parseOddNum(o?.value ?? o?.odd ?? o?.price);
                  if (!name || odd <= 1) continue;
                  const n = name.toLowerCase();
                  const team = n === 'home' || n === '1' ? 'Home' : n === 'away' || n === '2' ? 'Away' : name;
                  const selName = `${team} ${line}`;
                  push('handicap', { name: selName, label: selName, odd, price: odd, handicap: line, line, ismain: main ? 1 : 0 });
                }
              }
            }
            continue;
          }

          if (typeLc.includes('correct score')) {
            for (const bm of bookmakers) {
              for (const o of asArray(bm?.odd)) {
                const name = String(o?.name || '').trim();
                const odd = parseOddNum(o?.value ?? o?.odd ?? o?.price);
                if (!name || odd <= 1) continue;
                push('correct score', { name, label: name, odd, price: odd });
              }
            }
            continue;
          }
        }

        const home_odd = bestH2h.get('home') || 0;
        const draw_odd = bestH2h.get('draw') || 0;
        const away_odd = bestH2h.get('away') || 0;
        if (home_odd > 1 && away_odd > 1 && !markets.h2h) {
          markets.h2h = [
            { name: 'Casa', label: 'Casa', odd: home_odd, price: home_odd },
            { name: 'Empate', label: 'Empate', odd: draw_odd, price: draw_odd },
            { name: 'Fora', label: 'Fora', odd: away_odd, price: away_odd },
          ].filter((x) => Number(x.odd) > 1);
        }

        if (Array.isArray(markets.totals)) {
          const main = markets.totals.filter((x: any) => Number(x?.ismain || 0) === 1);
          markets.totals = (main.length > 0 ? main : markets.totals).slice(0, 220);
        }
        if (Array.isArray(markets.handicap)) {
          const main = markets.handicap.filter((x: any) => Number(x?.ismain || 0) === 1);
          markets.handicap = (main.length > 0 ? main : markets.handicap).slice(0, 220);
        }
        if (Array.isArray((markets as any)['correct score'])) (markets as any)['correct score'] = (markets as any)['correct score'].slice(0, 220);
        if (Array.isArray(markets.btts)) markets.btts = markets.btts.slice(0, 40);

        const markets_json = Object.keys(markets).length > 0 ? JSON.stringify(markets) : '';
        const parsed: ParsedOdds = { home_odd, draw_odd, away_odd, markets_json };

        out.set(id, parsed);
        if (altId) out.set(altId, parsed);
        if (altId2) out.set(altId2, parsed);
        if (staticId) out.set(staticId, parsed);
      }
    }

    return out;
  };

  const [livescoresJson, daily0Json, daily1Json, liveOddsMap, v1OddsJson] = await Promise.all([
    safeFetchJson(`${STATPAL_V1}/soccer/livescores?access_key=${encodeURIComponent(apiKey)}`),
    safeFetchJson(`${STATPAL_V1}/soccer/daily/d0?access_key=${encodeURIComponent(apiKey)}`),
    safeFetchJson(`${STATPAL_V1}/soccer/daily/d1?access_key=${encodeURIComponent(apiKey)}`),
    fetchStatpalLiveOddsV2(apiKey),
    safeFetchJson(`${STATPAL_V1}/soccer/odds/africa?access_key=${encodeURIComponent(apiKey)}`),
  ]);
  const v1OddsMap = parseV1SoccerOddsMap(v1OddsJson);

  const leaguesLive = asArray(livescoresJson?.livescore?.league);
  const leaguesD0 = asArray(daily0Json?.livescore?.league);
  const leaguesD1 = asArray(daily1Json?.livescore?.league);
  const allLeagues = [...leaguesLive, ...leaguesD0, ...leaguesD1];
  const leagueIds = Array.from(
    new Set(
      allLeagues
        .map((l: any) => String(l?.id || l?.league_id || l?.leagueId || '').trim())
        .filter(Boolean),
    ),
  );

  const [pregameOddsMap, prematchIndex, v2IdsIndex] = await Promise.all([
    fetchStatpalPregameOddsV2(apiKey),
    fetchStatpalPrematchOddsByLeaguesV2(apiKey, leagueIds),
    fetchStatpalV2MatchIdsIndex(apiKey, leagueIds),
  ]);
  const outById = new Map<string, any>();

  const addFromLeagues = (leagues: any[], sourcePriority: number) => {
    for (const league of leagues) {
      const leagueName = String(league?.name || '').trim();
      const country = String(league?.country || '').trim();
      const leagueId = String(league?.id || league?.league_id || league?.leagueId || '').trim();
      const matches = asArray(league?.match);

      for (const m of matches) {
        const id = String(m?.id || m?.alternate_id || '').trim();
        if (!id) continue;
        const altId = String(m?.alternate_id || '').trim();
        const altId2 = String(m?.alternate_id_2 || '').trim();
        const staticId = String(m?.static_id || '').trim();
        const home = String(m?.home?.name || '').trim();
        const away = String(m?.away?.name || '').trim();
        if (!home || !away) continue;

        const status = String(m?.status || '').trim();
        const statusLc = status.toLowerCase().trim();
        const finished = isFinished(status);
        const live = isLive(status);

        const homeGoalsRaw = m?.home?.goals;
        const awayGoalsRaw = m?.away?.goals;
        const homeGoals = homeGoalsRaw === null || homeGoalsRaw === undefined ? null : Number(homeGoalsRaw);
        const awayGoals = awayGoalsRaw === null || awayGoalsRaw === undefined ? null : Number(awayGoalsRaw);
        let scoreJson =
          live || finished
            ? JSON.stringify({
                home: Number.isFinite(Number(homeGoals)) ? Number(homeGoals) : null,
                away: Number.isFinite(Number(awayGoals)) ? Number(awayGoals) : null,
              })
            : '{"home":null,"away":null}';
        let minute = live ? minuteFromStatus(status) : 0;
        let timerLabel =
          statusLc === 'ht' || statusLc === 'halftime' || statusLc === 'half time' || statusLc === 'int' || statusLc === 'intermission'
            ? 'HT'
            : live && minute > 0
              ? `${minute}'`
              : String(m?.status || '');

        const kFull = makePrematchKey({
          leagueId,
          date: String(m?.date || '').trim(),
          time: String(m?.time || '').trim(),
          home,
          away,
        });
        const kFullRev = makePrematchKey({
          leagueId,
          date: String(m?.date || '').trim(),
          time: String(m?.time || '').trim(),
          home: away,
          away: home,
        });
        const kNoTime = makePrematchKeyNoTime({
          leagueId,
          date: String(m?.date || '').trim(),
          home,
          away,
        });
        const kNoTimeRev = makePrematchKeyNoTime({
          leagueId,
          date: String(m?.date || '').trim(),
          home: away,
          away: home,
        });

        const extraIds = [
          ...(v2IdsIndex.byKey.get(kFull) || []),
          ...(v2IdsIndex.byKey.get(kFullRev) || []),
          ...(v2IdsIndex.byKeyNoTime.get(kNoTime) || []),
          ...(v2IdsIndex.byKeyNoTime.get(kNoTimeRev) || []),
        ];
        const candidates = Array.from(new Set([id, altId, altId2, staticId, ...extraIds].filter(Boolean)));

        let real: ParsedOdds | undefined;
        for (const candidate of candidates) {
          if (live && liveOddsMap.has(candidate)) { real = liveOddsMap.get(candidate); break; }
          if (!live && prematchIndex.byId.has(candidate)) { real = prematchIndex.byId.get(candidate); break; }
          if (!live && pregameOddsMap.has(candidate)) { real = pregameOddsMap.get(candidate); break; }
          if (!live && v1OddsMap.has(candidate)) { real = v1OddsMap.get(candidate); break; }
        }
        if (!real && !live) {
          real =
            prematchIndex.byKey.get(kFull) ||
            prematchIndex.byKey.get(kFullRev) ||
            prematchIndex.byKeyNoTime.get(kNoTime) ||
            prematchIndex.byKeyNoTime.get(kNoTimeRev);
        }

        let home_odd = 0;
        let draw_odd = 0;
        let away_odd = 0;
        let marketsJson = '';
        if (real) {
          home_odd = real.home_odd;
          draw_odd = real.draw_odd;
          away_odd = real.away_odd;
          marketsJson = real.markets_json;
          if (real.score) scoreJson = JSON.stringify(real.score);
          if (real.minute && real.minute > 0) {
            minute = real.minute;
            timerLabel = real.timer || `${real.minute}'`;
          } else if (real.timer) {
            timerLabel = real.timer;
          }
        }

        const evt: any = {
          external_event_id: `statpal_soccer_${id}`,
          sport: 'soccer',
          league: leagueName,
          home_team: home,
          away_team: away,
          team_match: `${home} vs ${away}`,
          event_date: parseDateTime(m?.date, m?.time),
          status: finished ? 'FT' : live ? 'LIVE' : 'NS',
          is_live: live ? 1 : 0,
          home_odd,
          draw_odd,
          away_odd,
          elapsed: minute,
          timer: timerLabel,
          score: scoreJson,
          markets: marketsJson,
          country,
          home_team_logo: '',
          away_team_logo: '',
          _p: sourcePriority,
        };

        const prev = outById.get(evt.external_event_id);
        if (!prev) outById.set(evt.external_event_id, evt);
        else {
          const prevLive = Number(prev?.is_live || 0) === 1;
          const nextLive = Number(evt?.is_live || 0) === 1;
          const prevP = Number(prev?._p ?? 99);
          const nextP = Number(evt?._p ?? sourcePriority);
          const prevElapsed = Number(prev?.elapsed ?? 0) || 0;
          const nextElapsed = Number(evt?.elapsed ?? 0) || 0;

          if (nextLive && !prevLive) outById.set(evt.external_event_id, evt);
          else if (prevLive && nextLive) {
            if (nextElapsed > prevElapsed) outById.set(evt.external_event_id, evt);
            else if (nextP < prevP) outById.set(evt.external_event_id, evt);
          } else if (!prevLive && !nextLive) {
            if (nextP < prevP) outById.set(evt.external_event_id, evt);
          }
        }
      }
    }
  };

  addFromLeagues(leaguesD1, 3);
  addFromLeagues(leaguesD0, 2);
  addFromLeagues(leaguesLive, 0);

  return Array.from(outById.values()).map((e) => {
    const { _p, ...rest } = e || {};
    return rest;
  });
}

async function fetchStatpalTennis(apiKey: string): Promise<any[]> {
  const safeFetchJson = async (url: string): Promise<any | null> => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) return null;
      return await res.json().catch(() => null);
    } catch {
      return null;
    } finally {
      clearTimeout(t);
    }
  };

  const parseTennisTournaments = (json: any): any[] =>
    asArray(json?.livescores?.tournament || json?.scores?.tournament || json?.livescore?.tournament);

  const parseSetNum = (v: any): number | null => {
    const s = String(v ?? '').trim();
    if (!s) return null;
    const n = Number(s.replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  };

  const computeSets = (p0: any, p1: any): { home: number; away: number } => {
    const t0 = parseSetNum(p0?.totalscore);
    const t1 = parseSetNum(p1?.totalscore);
    if (t0 != null && t1 != null) return { home: t0, away: t1 };
    let home = 0;
    let away = 0;
    for (const k of ['s1', 's2', 's3', 's4', 's5']) {
      const a = parseSetNum(p0?.[k]);
      const b = parseSetNum(p1?.[k]);
      if (a == null || b == null) continue;
      if (a > b) home += 1;
      else if (b > a) away += 1;
    }
    return { home, away };
  };

  const normalizeTennisPoint = (v: any): '15' | '30' | '40' | 'AD' | null => {
    const s = String(v ?? '').trim().toUpperCase();
    if (!s) return null;
    if (s === '15' || s === '30' || s === '40') return s as any;
    if (s === 'A' || s === 'AD' || s === 'ADV' || s === 'ADVANTAGE') return 'AD';
    const n = Number(s);
    if (Number.isFinite(n) && (n === 15 || n === 30 || n === 40)) return String(n) as any;
    return null;
  };

  const computeTennisScoreDetail = (p0: any, p1: any) => {
    const setsWon = computeSets(p0 || {}, p1 || {});
    const readSetPair = (k: string): { home: number | null; away: number | null } | null => {
      const a = parseSetNum(p0?.[k]);
      const b = parseSetNum(p1?.[k]);
      if (a == null && b == null) return null;
      return { home: a, away: b };
    };
    const sets = {
      s1: readSetPair('s1'),
      s2: readSetPair('s2'),
      s3: readSetPair('s3'),
      s4: readSetPair('s4'),
      s5: readSetPair('s5'),
    };

    const pointHome =
      normalizeTennisPoint(p0?.point ?? p0?.current_point ?? p0?.currentPoint ?? p0?.game_point ?? p0?.gamePoint ?? p0?.currentgame ?? p0?.current_game);
    const pointAway =
      normalizeTennisPoint(p1?.point ?? p1?.current_point ?? p1?.currentPoint ?? p1?.game_point ?? p1?.gamePoint ?? p1?.currentgame ?? p1?.current_game);

    return { setsWon, sets, point: { home: pointHome, away: pointAway } };
  };

  const tennisIsFinished = (status: string): boolean => {
    const s = String(status || '').toLowerCase().trim();
    if (isFinished(s)) return true;
    return s === 'retired' || s === 'walkover' || s === 'w/o' || s === 'wo';
  };

  const tennisIsLive = (status: string): boolean => {
    const s = String(status || '').toLowerCase().trim();
    if (tennisIsFinished(s)) return false;
    if (isLive(s)) return true;
    return s.includes('in progress') || s.includes('set') || s.includes('live');
  };

  const parseTennisOddsMap = (json: any): Map<string, ParsedOdds> => {
    const map = new Map<string, ParsedOdds>();
    const tournaments = asArray(json?.odds?.tournament);
    for (const t of tournaments) {
      const matchesRoot = t?.matches?.match ?? t?.matches;
      const matches = asArray(matchesRoot);
      for (const m of matches) {
        const id = String(m?.id || '').trim();
        if (!id) continue;
        let home = 0;
        let away = 0;
        const markets: any[] = [];

        const parseLineNum = (v: any): number | null => {
          const s = String(v ?? '').trim().replace(',', '.').replace(/\s+/g, '');
          if (!s) return null;
          const n = Number(s);
          return Number.isFinite(n) ? n : null;
        };
        const readLine = (o: any): number | null =>
          parseLineNum(o?.handicap ?? o?.line ?? o?.games ?? o?.total ?? o?.param ?? o?.value_2);
        const readOdd = (o: any): number => parseOddNum(o?.value ?? o?.odd ?? o?.price);
        const pickBookmaker = (tp: any, requiredNames: string[]) => {
          const names = requiredNames.map((x) => x.toLowerCase());
          const bookmakers = asArray(tp?.bookmaker);
          for (const bm of bookmakers) {
            const lines = asArray(bm?.odd);
            const hasAll = names.every((nm) => lines.some((o: any) => String(o?.name || '').toLowerCase().includes(nm)));
            if (hasAll) return { bm, lines };
          }
          return null;
        };
        const types = asArray(m?.odds?.type);
        for (const tp of types) {
          const typeName = String(tp?.value || tp?.name || '').toLowerCase();
          const tn = String(typeName || '').trim();
          const isMoneyline = tn.includes('home/away') || tn.includes('moneyline') || tn.includes('match winner') || tn === 'winner';
          const isTotals = tn.includes('over/under') || tn.includes('totals') || tn.includes('total') || tn.includes('games');

          if (isMoneyline && !(home > 1 && away > 1)) {
            const picked = pickBookmaker(tp, ['home', 'away']);
            if (picked) {
              const homeLn = picked.lines.find((o: any) => String(o?.name || '').toLowerCase() === 'home');
              const awayLn = picked.lines.find((o: any) => String(o?.name || '').toLowerCase() === 'away');
              const h = readOdd(homeLn);
              const a = readOdd(awayLn);
              if (h > 1 && a > 1) {
                home = h;
                away = a;
              }
            }
          }

          if (isTotals) {
            const picked = pickBookmaker(tp, ['over', 'under']);
            if (picked) {
              const selections: any[] = [];
              for (const o of picked.lines) {
                const nm = String(o?.name || '').toLowerCase();
                const odd = readOdd(o);
                const line = readLine(o);
                if (!(odd > 1 && odd < 50) || line == null) continue;
                if (nm.includes('over') || nm.includes('more')) selections.push({ id: `sel_over_${line}`, label: `Mais ${line}`, name: 'Mais', odd });
                else if (nm.includes('under') || nm.includes('less')) selections.push({ id: `sel_under_${line}`, label: `Menos ${line}`, name: 'Menos', odd });
              }
              if (selections.length >= 2) markets.push({ id: 'mkt_totals', key: 'totals', name: 'Total de Games', selections });
            }
          }
        }
        if (home > 1 && away > 1) {
          markets.unshift({
            id: 'mkt_h2h',
            key: 'h2h',
            name: 'Resultado Final',
            selections: [
              { id: 'sel_home', label: 'Casa', name: 'Casa', odd: home },
              { id: 'sel_away', label: 'Fora', name: 'Fora', odd: away },
            ],
          });
          map.set(id, { home_odd: home, draw_odd: 0, away_odd: away, markets_json: JSON.stringify(markets) });
        }
      }
    }
    return map;
  };

  const [liveJson, daily0Json, daily1Json, dailyMinus1Json, oddsJson] = await Promise.all([
    safeFetchJson(`${STATPAL_V1}/tennis/livescores?access_key=${encodeURIComponent(apiKey)}`),
    safeFetchJson(`${STATPAL_V1}/tennis/daily/d0?access_key=${encodeURIComponent(apiKey)}`),
    safeFetchJson(`${STATPAL_V1}/tennis/daily/d1?access_key=${encodeURIComponent(apiKey)}`),
    safeFetchJson(`${STATPAL_V1}/tennis/daily/d-1?access_key=${encodeURIComponent(apiKey)}`),
    safeFetchJson(`${STATPAL_V1}/tennis/odds?access_key=${encodeURIComponent(apiKey)}`),
  ]);
  const tennisOddsByMatchId = parseTennisOddsMap(oddsJson);

  const outById = new Map<string, any>();
  const addFrom = (json: any, sourcePriority: number) => {
    const tournaments = parseTennisTournaments(json);
    for (const t of tournaments) {
      const tournamentName = String(t?.name || '').trim();
      const matches = asArray(t?.match);
      for (const m of matches) {
        const id = String(m?.id || '').trim();
        if (!id) continue;
        const players = asArray(m?.player);
        const home = String(players[0]?.name || m?.player_1 || '').trim();
        const away = String(players[1]?.name || m?.player_2 || '').trim();
        if (!home || !away) continue;

        const statusRaw = String(m?.status || '').trim();
        const finished = tennisIsFinished(statusRaw);
        const live = tennisIsLive(statusRaw);
        const detail = computeTennisScoreDetail(players[0] || {}, players[1] || {});
        const scoreJson = live || finished ? JSON.stringify(detail) : '{"setsWon":null,"sets":{},"point":{}}';

        const odds = tennisOddsByMatchId.get(id);
        const evt = {
          external_event_id: `statpal_tennis_${id}`,
          sport: 'tennis',
          league: tournamentName,
          home_team: home,
          away_team: away,
          team_match: `${home} vs ${away}`,
          event_date: parseDateTime(m?.date, m?.time),
          status: finished ? 'FT' : live ? 'LIVE' : 'NS',
          is_live: live ? 1 : 0,
          home_odd: Number(odds?.home_odd || 0),
          draw_odd: Number(odds?.draw_odd || 0),
          away_odd: Number(odds?.away_odd || 0),
          elapsed: 0,
          timer: statusRaw,
          score: scoreJson,
          markets: String(odds?.markets_json || ''),
          country: '',
          home_team_logo: '',
          away_team_logo: '',
          _p: sourcePriority,
        };

        const prev = outById.get(evt.external_event_id);
        if (!prev) outById.set(evt.external_event_id, evt);
        else {
          const prevLive = Number(prev?.is_live || 0) === 1;
          const nextLive = Number(evt?.is_live || 0) === 1;
          if (nextLive && !prevLive) outById.set(evt.external_event_id, evt);
          else if (!prevLive && !nextLive && sourcePriority < Number(prev?._p ?? 99)) outById.set(evt.external_event_id, evt);
        }
      }
    }
  };

  if (daily1Json) addFrom(daily1Json, 3);
  if (daily0Json) addFrom(daily0Json, 2);
  if (dailyMinus1Json) addFrom(dailyMinus1Json, 1);
  if (liveJson) addFrom(liveJson, 0);

  // Garante publicação de partidas com odds mesmo quando não vieram no livescores/daily.
  if (oddsJson) {
    const tournaments = asArray(oddsJson?.odds?.tournament);
    for (const t of tournaments) {
      const league = String(t?.name || '').trim();
      const matches = asArray(t?.matches?.match ?? t?.matches);
      for (const m of matches) {
        const id = String(m?.id || '').trim();
        if (!id) continue;
        const externalId = `statpal_tennis_${id}`;
        if (outById.has(externalId)) continue;
        const players = asArray(m?.player);
        const home = String(players[0]?.name || '').trim();
        const away = String(players[1]?.name || '').trim();
        if (!home || !away) continue;
        const odds = tennisOddsByMatchId.get(id);
        outById.set(externalId, {
          external_event_id: externalId,
          sport: 'tennis',
          league,
          home_team: home,
          away_team: away,
          team_match: `${home} vs ${away}`,
          event_date: parseDateTime(m?.date, m?.time),
          status: 'NS',
          is_live: 0,
          home_odd: Number(odds?.home_odd || 0),
          draw_odd: 0,
          away_odd: Number(odds?.away_odd || 0),
          elapsed: 0,
          timer: '',
          score: '{"home":null,"away":null}',
          markets: String(odds?.markets_json || ''),
          country: '',
          home_team_logo: '',
          away_team_logo: '',
          _p: 4,
        });
      }
    }
  }

  return Array.from(outById.values()).map((e) => {
    const { _p, ...rest } = e || {};
    return rest;
  });
}

async function fetchStatpalVolleyball(apiKey: string): Promise<any[]> {
  const safeFetchJson = async (url: string): Promise<any | null> => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) return null;
      return await res.json().catch(() => null);
    } catch {
      return null;
    } finally {
      clearTimeout(t);
    }
  };

  const parseVolleyballTournaments = (json: any): any[] =>
    asArray(json?.livescores?.tournament || json?.livescore?.tournament);

  const parseLine = (v: any): number | null => {
    const s = String(v ?? '').trim();
    if (!s) return null;
    const n = Number(s.replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  };

  const parseVolleyballOddsMap = (json: any): Map<string, ParsedOdds> => {
    const map = new Map<string, ParsedOdds>();
    const tournaments = asArray(json?.odds?.tournament);
    for (const t of tournaments) {
      const matches = asArray(t?.matches?.match ?? t?.matches);
      for (const m of matches) {
        const id = String(m?.id || '').trim();
        if (!id) continue;

        let home = 0;
        let away = 0;
        const markets: any[] = [];

        const types = asArray(m?.odds?.type);
        for (const tp of types) {
          const typeName = String(tp?.value || tp?.name || '').toLowerCase();
          if (typeName && !typeName.includes('home/away')) continue;
          const bookmakers = asArray(tp?.bookmaker);
          for (const bm of bookmakers) {
            const lines = asArray(bm?.odd);
            const homeLn = lines.find((o: any) => String(o?.name || '').toLowerCase() === 'home');
            const awayLn = lines.find((o: any) => String(o?.name || '').toLowerCase() === 'away');
            const h = parseOddNum(homeLn?.value ?? homeLn?.odd);
            const a = parseOddNum(awayLn?.value ?? awayLn?.odd);
            if (h > 1 && a > 1) {
              home = h;
              away = a;
              break;
            }
          }
          if (home > 1 && away > 1) break;
        }

        if (home > 1 && away > 1) {
          markets.push({
            id: 'mkt_h2h',
            key: 'h2h',
            name: 'Resultado Final',
            selections: [
              { id: 'sel_home', label: 'Casa', name: 'Casa', odd: home },
              { id: 'sel_away', label: 'Fora', name: 'Fora', odd: away },
            ],
          });
        }

        for (const tp of types) {
          const typeName = String(tp?.value || tp?.name || '').toLowerCase();
          if (typeName && !typeName.includes('over/under')) continue;
          const bm = tp?.bookmaker;
          const totals = asArray(bm?.total);
          const picked = totals
            .map((x: any) => ({
              line: parseLine(x?.name),
              over: parseOddNum(asArray(x?.odd).find((o: any) => String(o?.name || '').toLowerCase() === 'over')?.value),
              under: parseOddNum(asArray(x?.odd).find((o: any) => String(o?.name || '').toLowerCase() === 'under')?.value),
            }))
            .filter((x: any) => x.line != null && x.over > 1 && x.under > 1)
            .sort((a: any, b: any) => Math.abs(a.line - 3.5) - Math.abs(b.line - 3.5))[0];
          if (picked) {
            markets.push({
              id: 'mkt_totals',
              key: 'totals',
              name: 'Total de Sets',
              line: String(picked.line),
              selections: [
                { label: `Mais ${picked.line}`, name: 'over', odd: picked.over },
                { label: `Menos ${picked.line}`, name: 'under', odd: picked.under },
              ],
            });
          }
          break;
        }

        if (home > 1 && away > 1) {
          map.set(id, {
            home_odd: home,
            draw_odd: 0,
            away_odd: away,
            markets_json: markets.length > 0 ? JSON.stringify(markets) : '',
          });
        }
      }
    }
    return map;
  };

  const [liveJson, daily0Json, daily1Json, dailyMinus1Json, oddsJson] = await Promise.all([
    safeFetchJson(`${STATPAL_V1}/volleyball/livescores?access_key=${encodeURIComponent(apiKey)}`),
    safeFetchJson(`${STATPAL_V1}/volleyball/daily/d0?access_key=${encodeURIComponent(apiKey)}`),
    safeFetchJson(`${STATPAL_V1}/volleyball/daily/d1?access_key=${encodeURIComponent(apiKey)}`),
    safeFetchJson(`${STATPAL_V1}/volleyball/daily/d-1?access_key=${encodeURIComponent(apiKey)}`),
    safeFetchJson(`${STATPAL_V1}/volleyball/odds?access_key=${encodeURIComponent(apiKey)}`),
  ]);

  const oddsByMatchId = parseVolleyballOddsMap(oddsJson);
  const outById = new Map<string, any>();

  const addFrom = (json: any, sourcePriority: number) => {
    const tournaments = parseVolleyballTournaments(json);
    for (const t of tournaments) {
      const leagueName = String(t?.league || t?.name || '').trim();
      const country = String(t?.country || '').trim();
      const matches = asArray(t?.match);
      for (const m of matches) {
        const id = String(m?.id || '').trim();
        if (!id) continue;
        const homeName = String(m?.home?.name || '').trim();
        const awayName = String(m?.away?.name || '').trim();
        if (!homeName || !awayName) continue;

        const statusRaw = String(m?.status || '').trim();
        const finished = isFinished(statusRaw);
        const live = isLive(statusRaw);
        const homeSets = Number(String(m?.home?.totalscore ?? '').trim() || 0);
        const awaySets = Number(String(m?.away?.totalscore ?? '').trim() || 0);
        const scoreJson = (live || finished)
          ? JSON.stringify({ home: homeSets, away: awaySets })
          : '{"home":null,"away":null}';

        const odds = oddsByMatchId.get(id);
        const evt = {
          external_event_id: `statpal_volleyball_${id}`,
          sport: 'volleyball',
          league: leagueName,
          home_team: homeName,
          away_team: awayName,
          team_match: `${homeName} vs ${awayName}`,
          event_date: parseDateTime(m?.date, m?.time),
          status: finished ? 'FT' : live ? 'LIVE' : 'NS',
          is_live: live ? 1 : 0,
          home_odd: Number(odds?.home_odd || 0),
          draw_odd: 0,
          away_odd: Number(odds?.away_odd || 0),
          elapsed: 0,
          timer: statusRaw,
          score: scoreJson,
          markets: String(odds?.markets_json || ''),
          country,
          home_team_logo: '',
          away_team_logo: '',
          _p: sourcePriority,
        };

        const prev = outById.get(evt.external_event_id);
        if (!prev) outById.set(evt.external_event_id, evt);
        else {
          const prevLive = Number(prev?.is_live || 0) === 1;
          const nextLive = Number(evt?.is_live || 0) === 1;
          if (nextLive && !prevLive) outById.set(evt.external_event_id, evt);
          else if (!prevLive && !nextLive && sourcePriority < Number(prev?._p ?? 99)) outById.set(evt.external_event_id, evt);
        }
      }
    }
  };

  if (daily1Json) addFrom(daily1Json, 3);
  if (daily0Json) addFrom(daily0Json, 2);
  if (dailyMinus1Json) addFrom(dailyMinus1Json, 1);
  if (liveJson) addFrom(liveJson, 0);

  if (oddsJson) {
    const tournaments = asArray(oddsJson?.odds?.tournament);
    for (const t of tournaments) {
      const leagueName = String(t?.league || '').trim();
      const matches = asArray(t?.matches?.match ?? t?.matches);
      for (const m of matches) {
        const id = String(m?.id || '').trim();
        if (!id) continue;
        const externalId = `statpal_volleyball_${id}`;
        if (outById.has(externalId)) continue;
        const homeName = String(m?.home?.name || '').trim();
        const awayName = String(m?.away?.name || '').trim();
        if (!homeName || !awayName) continue;
        const odds = oddsByMatchId.get(id);
        outById.set(externalId, {
          external_event_id: externalId,
          sport: 'volleyball',
          league: leagueName,
          home_team: homeName,
          away_team: awayName,
          team_match: `${homeName} vs ${awayName}`,
          event_date: parseDateTime(m?.date, m?.time),
          status: 'NS',
          is_live: 0,
          home_odd: Number(odds?.home_odd || 0),
          draw_odd: 0,
          away_odd: Number(odds?.away_odd || 0),
          elapsed: 0,
          timer: '',
          score: '{"home":null,"away":null}',
          markets: String(odds?.markets_json || ''),
          country: '',
          home_team_logo: '',
          away_team_logo: '',
          _p: 4,
        });
      }
    }
  }

  return Array.from(outById.values()).map((e) => {
    const { _p, ...rest } = e || {};
    return rest;
  });
}

async function fetchStatpalHandball(apiKey: string): Promise<any[]> {
  const safeFetchJson = async (url: string): Promise<any | null> => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) return null;
      return await res.json().catch(() => null);
    } catch {
      return null;
    } finally {
      clearTimeout(t);
    }
  };

  const parseHandballTournaments = (json: any): any[] =>
    asArray(json?.livescores?.tournament || json?.livescore?.tournament);

  const parseHandballOddsMap = (json: any): Map<string, ParsedOdds> => {
    const map = new Map<string, ParsedOdds>();
    const tournaments = asArray(json?.odds?.tournament);
    for (const t of tournaments) {
      const matches = asArray(t?.matches?.match ?? t?.matches);
      for (const m of matches) {
        const id = String(m?.id || '').trim();
        if (!id) continue;

        let home = 0;
        let draw = 0;
        let away = 0;

        const types = asArray(m?.odds?.type);
        for (const tp of types) {
          const typeName = String(tp?.value || tp?.name || '').toLowerCase();
          if (typeName && !typeName.includes('3way')) continue;
          const bookmakers = asArray(tp?.bookmaker);
          for (const bm of bookmakers) {
            const lines = asArray(bm?.odd);
            const homeLn = lines.find((o: any) => String(o?.name || '').toLowerCase() === 'home');
            const drawLn = lines.find((o: any) => String(o?.name || '').toLowerCase() === 'draw');
            const awayLn = lines.find((o: any) => String(o?.name || '').toLowerCase() === 'away');
            const h = parseOddNum(homeLn?.value ?? homeLn?.odd);
            const d = parseOddNum(drawLn?.value ?? drawLn?.odd);
            const a = parseOddNum(awayLn?.value ?? awayLn?.odd);
            if (h > 1 && d > 1 && a > 1) {
              home = h;
              draw = d;
              away = a;
              break;
            }
          }
          if (home > 1 && draw > 1 && away > 1) break;
        }

        if (home > 1 && draw > 1 && away > 1) {
          map.set(id, {
            home_odd: home,
            draw_odd: draw,
            away_odd: away,
            markets_json: JSON.stringify([
              {
                id: 'mkt_h2h',
                key: 'h2h',
                name: 'Resultado Final',
                selections: [
                  { id: 'sel_home', label: 'Casa', name: 'Casa', odd: home },
                  { id: 'sel_draw', label: 'Empate', name: 'Empate', odd: draw },
                  { id: 'sel_away', label: 'Fora', name: 'Fora', odd: away },
                ],
              },
            ]),
          });
        }
      }
    }
    return map;
  };

  const [liveJson, daily0Json, daily1Json, dailyMinus1Json, oddsJson] = await Promise.all([
    safeFetchJson(`${STATPAL_V1}/handball/livescores?access_key=${encodeURIComponent(apiKey)}`),
    safeFetchJson(`${STATPAL_V1}/handball/daily/d0?access_key=${encodeURIComponent(apiKey)}`),
    safeFetchJson(`${STATPAL_V1}/handball/daily/d1?access_key=${encodeURIComponent(apiKey)}`),
    safeFetchJson(`${STATPAL_V1}/handball/daily/d-1?access_key=${encodeURIComponent(apiKey)}`),
    safeFetchJson(`${STATPAL_V1}/handball/odds?access_key=${encodeURIComponent(apiKey)}`),
  ]);

  const oddsByMatchId = parseHandballOddsMap(oddsJson);
  const outById = new Map<string, any>();

  const addFrom = (json: any, sourcePriority: number) => {
    const tournaments = parseHandballTournaments(json);
    for (const t of tournaments) {
      const leagueName = String(t?.league || t?.name || '').trim();
      const country = String(t?.country || '').trim();
      const matches = asArray(t?.match);
      for (const m of matches) {
        const id = String(m?.id || '').trim();
        if (!id) continue;
        const homeName = String(m?.home?.name || '').trim();
        const awayName = String(m?.away?.name || '').trim();
        if (!homeName || !awayName) continue;

        const statusRaw = String(m?.status || '').trim();
        const finished = isFinished(statusRaw);
        const live = isLive(statusRaw);
        const homeScore = Number(String(m?.home?.totalscore ?? '').trim() || 0);
        const awayScore = Number(String(m?.away?.totalscore ?? '').trim() || 0);
        const scoreJson = (live || finished)
          ? JSON.stringify({ home: homeScore, away: awayScore })
          : '{"home":null,"away":null}';

        const odds = oddsByMatchId.get(id);
        const evt = {
          external_event_id: `statpal_handball_${id}`,
          sport: 'handball',
          league: leagueName,
          home_team: homeName,
          away_team: awayName,
          team_match: `${homeName} vs ${awayName}`,
          event_date: parseDateTime(m?.date, m?.time),
          status: finished ? 'FT' : live ? 'LIVE' : 'NS',
          is_live: live ? 1 : 0,
          home_odd: Number(odds?.home_odd || 0),
          draw_odd: Number(odds?.draw_odd || 0),
          away_odd: Number(odds?.away_odd || 0),
          elapsed: 0,
          timer: statusRaw,
          score: scoreJson,
          markets: String(odds?.markets_json || ''),
          country,
          home_team_logo: '',
          away_team_logo: '',
          _p: sourcePriority,
        };

        const prev = outById.get(evt.external_event_id);
        if (!prev) outById.set(evt.external_event_id, evt);
        else {
          const prevLive = Number(prev?.is_live || 0) === 1;
          const nextLive = Number(evt?.is_live || 0) === 1;
          if (nextLive && !prevLive) outById.set(evt.external_event_id, evt);
          else if (!prevLive && !nextLive && sourcePriority < Number(prev?._p ?? 99)) outById.set(evt.external_event_id, evt);
        }
      }
    }
  };

  if (daily1Json) addFrom(daily1Json, 3);
  if (daily0Json) addFrom(daily0Json, 2);
  if (dailyMinus1Json) addFrom(dailyMinus1Json, 1);
  if (liveJson) addFrom(liveJson, 0);

  if (oddsJson) {
    const tournaments = asArray(oddsJson?.odds?.tournament);
    for (const t of tournaments) {
      const leagueName = String(t?.league || '').trim();
      const matches = asArray(t?.matches?.match ?? t?.matches);
      for (const m of matches) {
        const id = String(m?.id || '').trim();
        if (!id) continue;
        const externalId = `statpal_handball_${id}`;
        if (outById.has(externalId)) continue;
        const homeName = String(m?.home?.name || '').trim();
        const awayName = String(m?.away?.name || '').trim();
        if (!homeName || !awayName) continue;
        const odds = oddsByMatchId.get(id);
        outById.set(externalId, {
          external_event_id: externalId,
          sport: 'handball',
          league: leagueName,
          home_team: homeName,
          away_team: awayName,
          team_match: `${homeName} vs ${awayName}`,
          event_date: parseDateTime(m?.date, m?.time),
          status: 'NS',
          is_live: 0,
          home_odd: Number(odds?.home_odd || 0),
          draw_odd: Number(odds?.draw_odd || 0),
          away_odd: Number(odds?.away_odd || 0),
          elapsed: 0,
          timer: '',
          score: '{"home":null,"away":null}',
          markets: String(odds?.markets_json || ''),
          country: '',
          home_team_logo: '',
          away_team_logo: '',
          _p: 4,
        });
      }
    }
  }

  return Array.from(outById.values()).map((e) => {
    const { _p, ...rest } = e || {};
    return rest;
  });
}

async function fetchStatpalCricket(apiKey: string): Promise<any[]> {
  const safeFetchJson = async (url: string): Promise<any | null> => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) return null;
      return await res.json().catch(() => null);
    } catch {
      return null;
    } finally {
      clearTimeout(t);
    }
  };

  const cricketIsFinished = (status: string): boolean => {
    const s = String(status || '').toLowerCase().trim();
    if (!s) return false;
    if (isFinished(s)) return true;
    return s === 'finished' || s === 'result' || s === 'abandoned' || s === 'cancelled' || s === 'canceled' || s === 'no result';
  };

  const cricketIsLive = (status: string): boolean => {
    const s = String(status || '').toLowerCase().trim();
    if (!s) return false;
    if (cricketIsFinished(s)) return false;
    if (s.includes('not covered')) return false;
    if (
      s.includes('stumps') ||
      s.includes('tea') ||
      s.includes('lunch') ||
      s.includes('rain') ||
      s.includes('break') ||
      s.includes('innings break')
    ) return false;
    if (isLive(s)) return true;
    if (s === 'live') return true;
    return s.includes('innings') || s.includes('in progress');
  };

  const parseCricketCategoryMatches = (json: any, rootKey: 'scores' | 'fixtures' | 'odds'): Array<{ categoryName: string; country: string; match: any }> => {
    const out: Array<{ categoryName: string; country: string; match: any }> = [];
    const categories = asArray(json?.[rootKey]?.category);
    for (const c of categories) {
      const categoryName = String(c?.name || '').trim();
      const country = String(c?.country || '').trim();
      const matches = asArray(c?.match ?? c?.matches?.match ?? c?.matches);
      for (const m of matches) {
        if (!m) continue;
        out.push({ categoryName, country, match: m });
      }
    }
    return out;
  };

  const parseCricketOddsMap = (json: any): Map<string, ParsedOdds> => {
    const map = new Map<string, ParsedOdds>();
    const preferredBookmakers = String(process.env.STATPAL_BOOKMAKERS || process.env.ODDS_API_BOOKMAKERS || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    const bookmakerScore = (name: string) => {
      const n = String(name || '').toLowerCase().trim();
      if (!n) return 999;
      const idx = preferredBookmakers.findIndex((x) => x === n || n.includes(x));
      return idx >= 0 ? idx : 999;
    };

    const pickBookmakers = (list: any[]) => {
      const arr = asArray(list);
      return arr.sort((a: any, b: any) => bookmakerScore(a?.name || a?.bookmaker_name || '') - bookmakerScore(b?.name || b?.bookmaker_name || ''));
    };

    const parseLine = (o: any): number | null => {
      const candidates = [o?.handicap, o?.line, o?.total, o?.points, o?.runs, o?.value_line];
      for (const c of candidates) {
        const n = Number(String(c ?? '').trim().replace(',', '.'));
        if (Number.isFinite(n)) return n;
      }
      const name = String(o?.name || '').trim();
      const m = name.match(/([0-9]+(?:[.,][0-9]+)?)/);
      if (m) {
        const n = Number(String(m[1]).replace(',', '.'));
        if (Number.isFinite(n)) return n;
      }
      return null;
    };

    const normName = (s: any) => String(s || '').toLowerCase().trim();

    const rows = parseCricketCategoryMatches(json, 'odds');
    for (const row of rows) {
      const m = row.match;
      const id = String(m?.id || '').trim();
      if (!id) continue;
      let home = 0;
      let away = 0;
      const markets: any[] = [];

      const types = asArray(m?.odds?.type);
      for (const tp of types) {
        const typeName = normName(tp?.value || tp?.name || '');
        const bookmakers = pickBookmakers(tp?.bookmaker);

        const isH2h =
          !typeName ||
          typeName.includes('home/away') ||
          typeName.includes('match winner') ||
          typeName.includes('winner') ||
          typeName.includes('result');
        const isTotals =
          typeName.includes('total') ||
          typeName.includes('over/under') ||
          typeName.includes('over under') ||
          typeName.includes('runs') ||
          typeName.includes('points');
        const isHandicap =
          typeName.includes('handicap') ||
          typeName.includes('spread') ||
          typeName.includes('run line') ||
          typeName.includes('line');

        for (const bm of bookmakers) {
          const lines = asArray(bm?.odd);
          if (lines.length === 0) continue;

          if (isH2h && !(home > 1 && away > 1)) {
            const homeLn = lines.find((o: any) => normName(o?.name) === 'home');
            const awayLn = lines.find((o: any) => normName(o?.name) === 'away');
            const h = parseOddNum(homeLn?.value ?? homeLn?.odd);
            const a = parseOddNum(awayLn?.value ?? awayLn?.odd);
            if (h > 1 && a > 1) {
              home = h;
              away = a;
            }
          }

          if (isTotals) {
            const buckets = new Map<string, { over?: number; under?: number; line?: number }>();
            for (const ln of lines) {
              const nm = normName(ln?.name);
              const odd = parseOddNum(ln?.value ?? ln?.odd);
              if (!(odd > 1)) continue;
              const line = parseLine(ln);
              if (line == null) continue;
              const key = String(line);
              const cur = buckets.get(key) || { line };
              if (nm === 'over' || nm.includes('over') || nm.includes('acima') || nm.includes('mais')) cur.over = odd;
              if (nm === 'under' || nm.includes('under') || nm.includes('abaixo') || nm.includes('menos')) cur.under = odd;
              buckets.set(key, cur);
            }
            const sels: any[] = [];
            for (const b of buckets.values()) {
              if (b.line == null) continue;
              if (b.over && b.over > 1) sels.push({ id: `sel_over_${b.line}`, label: `Over ${b.line}`, name: `Over ${b.line}`, odd: b.over, line: b.line });
              if (b.under && b.under > 1) sels.push({ id: `sel_under_${b.line}`, label: `Under ${b.line}`, name: `Under ${b.line}`, odd: b.under, line: b.line });
            }
            if (sels.length > 0 && !markets.some((x: any) => x?.key === 'totals')) {
              markets.push({
                id: 'mkt_totals',
                key: 'totals',
                name: 'Total de Runs',
                selections: sels,
              });
            }
          }

          if (isHandicap) {
            const homeLn = lines.find((o: any) => normName(o?.name) === 'home');
            const awayLn = lines.find((o: any) => normName(o?.name) === 'away');
            const hOdd = parseOddNum(homeLn?.value ?? homeLn?.odd);
            const aOdd = parseOddNum(awayLn?.value ?? awayLn?.odd);
            const hLine = homeLn ? parseLine(homeLn) : null;
            const aLine = awayLn ? parseLine(awayLn) : null;
            const line = hLine ?? aLine;
            if (line != null && hOdd > 1 && aOdd > 1 && !markets.some((x: any) => x?.key === 'handicap')) {
              markets.push({
                id: 'mkt_handicap',
                key: 'handicap',
                name: 'Handicap (Runs)',
                selections: [
                  { id: 'sel_home', label: `Casa ${line >= 0 ? '+' : ''}${line}`, name: `Casa ${line >= 0 ? '+' : ''}${line}`, odd: hOdd },
                  { id: 'sel_away', label: `Fora ${line >= 0 ? '-' : '+'}${Math.abs(line)}`, name: `Fora ${line >= 0 ? '-' : '+'}${Math.abs(line)}`, odd: aOdd },
                ],
              });
            }
          }

          if (home > 1 && away > 1 && markets.length >= 3) break;
        }
      }

      if (home > 1 && away > 1) {
        if (!markets.some((x: any) => x?.key === 'h2h')) {
          markets.unshift({
            id: 'mkt_h2h',
            key: 'h2h',
            name: 'Resultado Final',
            selections: [
              { id: 'sel_home', label: 'Casa', name: 'Casa', odd: home },
              { id: 'sel_away', label: 'Fora', name: 'Fora', odd: away },
            ],
          });
        }
        map.set(id, { home_odd: home, draw_odd: 0, away_odd: away, markets_json: JSON.stringify(markets) });
      }
    }
    return map;
  };

  const [liveJson, upcomingJson, oddsJson] = await Promise.all([
    safeFetchJson(`${STATPAL_V1}/cricket/livescores?access_key=${encodeURIComponent(apiKey)}`),
    safeFetchJson(`${STATPAL_V1}/cricket/upcoming-schedule?access_key=${encodeURIComponent(apiKey)}`),
    safeFetchJson(`${STATPAL_V1}/cricket/odds?access_key=${encodeURIComponent(apiKey)}`),
  ]);

  const oddsByMatchId = parseCricketOddsMap(oddsJson);
  const outById = new Map<string, any>();

  const addMatch = (categoryName: string, country: string, m: any, sourcePriority: number) => {
    const id = String(m?.id || '').trim();
    if (!id) return;
    const homeName = String(m?.home?.name || '').trim();
    const awayName = String(m?.away?.name || '').trim();
    if (!homeName || !awayName) return;

    const statusRaw = String(m?.status || '').trim();
    const finished = cricketIsFinished(statusRaw);
    const live = cricketIsLive(statusRaw);
    const commentPost = String(m?.comment?.post || '').trim();
    const homeTotal = String(m?.home?.totalscore ?? '').trim();
    const awayTotal = String(m?.away?.totalscore ?? '').trim();
    const homeStat = String(m?.home?.stat ?? '').trim();
    const awayStat = String(m?.away?.stat ?? '').trim();

    const scoreJson = JSON.stringify({
      home: null,
      away: null,
      home_total: homeTotal,
      away_total: awayTotal,
      home_stat: homeStat,
      away_stat: awayStat,
      result: commentPost,
    });

    const odds = oddsByMatchId.get(id);
    const evt = {
      external_event_id: `statpal_cricket_${id}`,
      sport: 'cricket',
      league: categoryName,
      home_team: homeName,
      away_team: awayName,
      team_match: `${homeName} vs ${awayName}`,
      event_date: parseDateTime(m?.date, m?.time),
      status: finished ? 'FT' : live ? 'LIVE' : 'NS',
      is_live: live ? 1 : 0,
      home_odd: Number(odds?.home_odd || 0),
      draw_odd: 0,
      away_odd: Number(odds?.away_odd || 0),
      elapsed: 0,
      timer: statusRaw || commentPost,
      score: finished || live ? scoreJson : '{"home":null,"away":null}',
      markets: String(odds?.markets_json || ''),
      country,
      home_team_logo: '',
      away_team_logo: '',
      _p: sourcePriority,
    };

    const prev = outById.get(evt.external_event_id);
    if (!prev) outById.set(evt.external_event_id, evt);
    else {
      const prevLive = Number(prev?.is_live || 0) === 1;
      const nextLive = Number(evt?.is_live || 0) === 1;
      if (nextLive && !prevLive) outById.set(evt.external_event_id, evt);
      else if (!prevLive && !nextLive && sourcePriority < Number(prev?._p ?? 99)) outById.set(evt.external_event_id, evt);
    }
  };

  for (const row of parseCricketCategoryMatches(upcomingJson, 'fixtures')) addMatch(row.categoryName, row.country, row.match, 2);
  for (const row of parseCricketCategoryMatches(liveJson, 'scores')) addMatch(row.categoryName, row.country, row.match, 0);

  if (oddsJson) {
    for (const row of parseCricketCategoryMatches(oddsJson, 'odds')) {
      const m = row.match;
      const id = String(m?.id || '').trim();
      if (!id) continue;
      const externalId = `statpal_cricket_${id}`;
      if (outById.has(externalId)) continue;
      addMatch(row.categoryName, row.country, m, 4);
    }
  }

  return Array.from(outById.values()).map((e) => {
    const { _p, ...rest } = e || {};
    return rest;
  });
}

async function fetchStatpalNBA(apiKey: string): Promise<any[]> {
  const safeFetchJson = async (url: string): Promise<any | null> => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) return null;
      return await res.json().catch(() => null);
    } catch {
      return null;
    } finally {
      clearTimeout(t);
    }
  };

  const nbaIsFinished = (status: string): boolean => {
    const s = String(status || '').toLowerCase().trim();
    if (!s) return false;
    if (isFinished(s)) return true;
    if (s === 'finished') return true;
    if (s.includes('after over time')) return true;
    if (s.includes('after overtime')) return true;
    if (s.includes('final')) return true;
    return false;
  };

  const nbaIsLive = (status: string, timer: string): boolean => {
    const s = String(status || '').toLowerCase().trim();
    const t = String(timer || '').toLowerCase().trim();
    if (!s && !t) return false;
    if (nbaIsFinished(s)) return false;
    if (isLive(s) || isLive(t)) return true;
    const hasQuarter =
      s.includes('quarter') ||
      t.includes('quarter') ||
      /\bq[1-4]\b/.test(s) ||
      /\bq[1-4]\b/.test(t) ||
      /\b[1-4]q\b/.test(s) ||
      /\b[1-4]q\b/.test(t);
    const hasOt =
      s.includes('overtime') ||
      t.includes('overtime') ||
      /\bot\b/.test(s) ||
      /\bot\b/.test(t);
    return hasQuarter || hasOt;
  };

  const parseNbaTournaments = (json: any): any[] =>
    asArray(json?.livescores?.tournament || json?.scores?.tournament);

  const parseNbaOddsMap = (json: any): Map<string, ParsedOdds> => {
    const map = new Map<string, ParsedOdds>();
    const cat = json?.odds?.category;
    const catName = String(cat?.name || cat?.league || '').trim();
    const matches = asArray(cat?.matches?.match ?? cat?.matches);
    for (const m of matches) {
      const id = String(m?.id || '').trim();
      if (!id) continue;

      let home = 0;
      let draw = 0;
      let away = 0;
      const markets: any[] = [];

      const parseLineNum = (v: any): number | null => {
        const s = String(v ?? '').trim().replace(',', '.').replace(/\s+/g, '');
        if (!s) return null;
        const n = Number(s);
        return Number.isFinite(n) ? n : null;
      };
      const readLine = (o: any): number | null =>
        parseLineNum(o?.handicap ?? o?.line ?? o?.points ?? o?.total ?? o?.param ?? o?.value_2);
      const readOdd = (o: any): number => parseOddNum(o?.value ?? o?.odd ?? o?.price);
      const pickBookmaker = (tp: any, requiredNames: string[]) => {
        const names = requiredNames.map((x) => x.toLowerCase());
        const bookmakers = asArray(tp?.bookmaker);
        for (const bm of bookmakers) {
          const lines = asArray(bm?.odd);
          const hasAll = names.every((nm) => lines.some((o: any) => String(o?.name || '').toLowerCase().includes(nm)));
          if (hasAll) return { bm, lines };
        }
        return null;
      };

      const types = asArray(m?.odds?.type);
      for (const tp of types) {
        const typeName = String(tp?.value || tp?.name || '').toLowerCase().trim();
        if (!typeName) continue;

        const is3Way = typeName.includes('3way') || typeName.includes('3-way') || typeName.includes('1x2');
        const isMoneyline = typeName.includes('moneyline') || typeName.includes('home/away') || typeName.includes('match winner') || typeName === 'winner';
        const isSpread = typeName.includes('spread') || typeName.includes('handicap') || typeName.includes('point spread');
        const isTotals = typeName.includes('over/under') || typeName.includes('totals') || typeName.includes('total') || typeName.includes('points');

        if ((is3Way || isMoneyline) && !(home > 1 && away > 1)) {
          const picked = pickBookmaker(tp, ['home', 'away']);
          if (picked) {
            const homeLn = picked.lines.find((o: any) => String(o?.name || '').toLowerCase() === 'home');
            const drawLn = picked.lines.find((o: any) => String(o?.name || '').toLowerCase() === 'draw');
            const awayLn = picked.lines.find((o: any) => String(o?.name || '').toLowerCase() === 'away');
            const h = readOdd(homeLn);
            const d = readOdd(drawLn);
            const a = readOdd(awayLn);
            if (h > 1 && a > 1) {
              home = h;
              draw = d;
              away = a;
            }
          }
        }

        if (isSpread) {
          const picked = pickBookmaker(tp, ['home', 'away']);
          if (picked) {
            const selections: any[] = [];
            for (const o of picked.lines) {
              const nm = String(o?.name || '').toLowerCase();
              const odd = readOdd(o);
              const line = readLine(o);
              if (!(odd > 1 && odd < 50) || line == null) continue;
              if (nm === 'home') selections.push({ id: `sel_home_${line}`, label: `Casa ${line >= 0 ? '+' : ''}${line}`, name: 'Casa', odd });
              else if (nm === 'away') selections.push({ id: `sel_away_${line}`, label: `Fora ${line >= 0 ? '+' : ''}${line}`, name: 'Fora', odd });
            }
            if (selections.length >= 2) markets.push({ id: 'mkt_spreads', key: 'spreads', name: 'Spread', selections });
          }
        }

        if (isTotals) {
          const picked = pickBookmaker(tp, ['over', 'under']);
          if (picked) {
            const selections: any[] = [];
            for (const o of picked.lines) {
              const nm = String(o?.name || '').toLowerCase();
              const odd = readOdd(o);
              const line = readLine(o);
              if (!(odd > 1 && odd < 50) || line == null) continue;
              if (nm.includes('over') || nm.includes('more')) selections.push({ id: `sel_over_${line}`, label: `Mais ${line}`, name: 'Mais', odd });
              else if (nm.includes('under') || nm.includes('less')) selections.push({ id: `sel_under_${line}`, label: `Menos ${line}`, name: 'Menos', odd });
            }
            if (selections.length >= 2) markets.push({ id: 'mkt_totals', key: 'totals', name: 'Total de Pontos', selections });
          }
        }
      }

      if (home > 1 && away > 1) {
        const h2hSelections =
          draw > 1
            ? [
                { id: 'sel_home', label: 'Casa', name: 'Casa', odd: home },
                { id: 'sel_draw', label: 'Empate', name: 'Empate', odd: draw },
                { id: 'sel_away', label: 'Fora', name: 'Fora', odd: away },
              ]
            : [
                { id: 'sel_home', label: 'Casa', name: 'Casa', odd: home },
                { id: 'sel_away', label: 'Fora', name: 'Fora', odd: away },
              ];
        markets.unshift({ id: 'mkt_h2h', key: 'h2h', name: 'Resultado Final', selections: h2hSelections });
        map.set(id, { home_odd: home, draw_odd: draw, away_odd: away, markets_json: JSON.stringify(markets) });
      } else if (catName) {
        map.set(id, { home_odd: 0, draw_odd: 0, away_odd: 0, markets_json: '' });
      }
    }
    return map;
  };

  const [livescoresJson, dailyMinus1Json, daily0Json, daily1Json, seasonJson, oddsJson] = await Promise.all([
    safeFetchJson(`${STATPAL_V1}/nba/livescores?access_key=${encodeURIComponent(apiKey)}`),
    safeFetchJson(`${STATPAL_V1}/nba/daily/d-1?access_key=${encodeURIComponent(apiKey)}`),
    safeFetchJson(`${STATPAL_V1}/nba/daily/d0?access_key=${encodeURIComponent(apiKey)}`),
    safeFetchJson(`${STATPAL_V1}/nba/daily/d1?access_key=${encodeURIComponent(apiKey)}`),
    safeFetchJson(`${STATPAL_V1}/nba/season-schedule?access_key=${encodeURIComponent(apiKey)}`),
    safeFetchJson(`${STATPAL_V1}/nba/odds?access_key=${encodeURIComponent(apiKey)}`),
  ]);

  const oddsByMatchId = parseNbaOddsMap(oddsJson);
  const outById = new Map<string, any>();

  const addFrom = (json: any, sourcePriority: number) => {
    const tournaments = parseNbaTournaments(json);
    for (const t of tournaments) {
      const leagueName = String(t?.league || t?.name || '').trim() || 'NBA';
      const country = String(t?.country || '').trim();
      const matches = asArray(t?.match);
      for (const m of matches) {
        const id = String(m?.id || '').trim();
        if (!id) continue;
        const homeName = String(m?.home?.name || '').trim();
        const awayName = String(m?.away?.name || '').trim();
        if (!homeName || !awayName) continue;

        const statusRaw = String(m?.status || '').trim();
        const timerRaw = String(m?.timer || '').trim();
        const finished = nbaIsFinished(statusRaw);
        const live = nbaIsLive(statusRaw, timerRaw);

        const homeTotal = Number(String(m?.home?.totalscore ?? '').trim());
        const awayTotal = Number(String(m?.away?.totalscore ?? '').trim());
        const q1h = Number(String(m?.home?.q1 ?? '').trim());
        const q2h = Number(String(m?.home?.q2 ?? '').trim());
        const q3h = Number(String(m?.home?.q3 ?? '').trim());
        const q4h = Number(String(m?.home?.q4 ?? '').trim());
        const oth = Number(String(m?.home?.ot ?? '').trim());
        const q1a = Number(String(m?.away?.q1 ?? '').trim());
        const q2a = Number(String(m?.away?.q2 ?? '').trim());
        const q3a = Number(String(m?.away?.q3 ?? '').trim());
        const q4a = Number(String(m?.away?.q4 ?? '').trim());
        const ota = Number(String(m?.away?.ot ?? '').trim());

        const scoreJson = (live || finished)
          ? JSON.stringify({
              home: Number.isFinite(homeTotal) ? homeTotal : 0,
              away: Number.isFinite(awayTotal) ? awayTotal : 0,
              periods: {
                q1: { home: Number.isFinite(q1h) ? q1h : null, away: Number.isFinite(q1a) ? q1a : null },
                q2: { home: Number.isFinite(q2h) ? q2h : null, away: Number.isFinite(q2a) ? q2a : null },
                q3: { home: Number.isFinite(q3h) ? q3h : null, away: Number.isFinite(q3a) ? q3a : null },
                q4: { home: Number.isFinite(q4h) ? q4h : null, away: Number.isFinite(q4a) ? q4a : null },
                ot: { home: Number.isFinite(oth) ? oth : null, away: Number.isFinite(ota) ? ota : null },
              },
            })
          : '{"home":null,"away":null}';

        const odds = oddsByMatchId.get(id);
        const evt = {
          external_event_id: `statpal_nba_${id}`,
          sport: 'basketball',
          league: leagueName,
          home_team: homeName,
          away_team: awayName,
          team_match: `${homeName} vs ${awayName}`,
          event_date: parseDateTime(m?.date, m?.time),
          status: finished ? 'FT' : live ? 'LIVE' : 'NS',
          is_live: live ? 1 : 0,
          home_odd: Number(odds?.home_odd || 0),
          draw_odd: Number(odds?.draw_odd || 0),
          away_odd: Number(odds?.away_odd || 0),
          elapsed: 0,
          timer: timerRaw || statusRaw,
          score: scoreJson,
          markets: String(odds?.markets_json || ''),
          country,
          home_team_logo: '',
          away_team_logo: '',
          _p: sourcePriority,
        };

        const prev = outById.get(evt.external_event_id);
        if (!prev) outById.set(evt.external_event_id, evt);
        else {
          const prevLive = Number(prev?.is_live || 0) === 1;
          const nextLive = Number(evt?.is_live || 0) === 1;
          if (nextLive && !prevLive) outById.set(evt.external_event_id, evt);
          else if (!prevLive && !nextLive && sourcePriority < Number(prev?._p ?? 99)) outById.set(evt.external_event_id, evt);
        }
      }
    }
  };

  if (seasonJson) addFrom(seasonJson, 4);
  if (daily1Json) addFrom(daily1Json, 3);
  if (daily0Json) addFrom(daily0Json, 2);
  if (dailyMinus1Json) addFrom(dailyMinus1Json, 1);
  if (livescoresJson) addFrom(livescoresJson, 0);

  if (oddsJson) {
    const cat = oddsJson?.odds?.category;
    const leagueName = String(cat?.name || cat?.league || '').trim() || 'NBA';
    const matches = asArray(cat?.matches?.match ?? cat?.matches);
    for (const m of matches) {
      const id = String(m?.id || '').trim();
      if (!id) continue;
      const externalId = `statpal_nba_${id}`;
      if (outById.has(externalId)) continue;
      const homeName = String(m?.home?.name || '').trim();
      const awayName = String(m?.away?.name || '').trim();
      if (!homeName || !awayName) continue;
      const odds = oddsByMatchId.get(id);
      outById.set(externalId, {
        external_event_id: externalId,
        sport: 'basketball',
        league: leagueName,
        home_team: homeName,
        away_team: awayName,
        team_match: `${homeName} vs ${awayName}`,
        event_date: parseDateTime(m?.date, m?.time),
        status: 'NS',
        is_live: 0,
        home_odd: Number(odds?.home_odd || 0),
        draw_odd: Number(odds?.draw_odd || 0),
        away_odd: Number(odds?.away_odd || 0),
        elapsed: 0,
        timer: '',
        score: '{"home":null,"away":null}',
        markets: String(odds?.markets_json || ''),
        country: '',
        home_team_logo: '',
        away_team_logo: '',
        _p: 6,
      });
    }
  }

  return Array.from(outById.values()).map((e) => {
    const { _p, ...rest } = e || {};
    return rest;
  });
}

async function fetchStatpalMLB(apiKey: string): Promise<any[]> {
  const safeFetchJson = async (url: string): Promise<any | null> => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) return null;
      return await res.json().catch(() => null);
    } catch {
      return null;
    } finally {
      clearTimeout(t);
    }
  };

  const normalizeTeamKey = (name: string): string =>
    String(name || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');

  const makeKeyNoTime = (date: any, homeName: string, awayName: string): string => {
    const d = String(date || '').trim();
    return `${d}|${normalizeTeamKey(homeName)}|${normalizeTeamKey(awayName)}`;
  };

  const mlbIsFinished = (status: string): boolean => {
    const s = String(status || '').toLowerCase().trim();
    if (!s) return false;
    if (isFinished(s)) return true;
    return s === 'finished' || s === 'final' || s === 'ft';
  };

  const mlbIsLive = (status: string): boolean => {
    const s = String(status || '').toLowerCase().trim();
    if (!s) return false;
    if (mlbIsFinished(s)) return false;
    if (isLive(s)) return true;
    return s.includes('in progress') || s.includes('live') || s.includes('inning') || s.includes('top') || s.includes('bot') || s.includes('bottom');
  };

  const parseMlbTournaments = (json: any): any[] =>
    asArray(json?.livescores?.tournament || json?.scores?.tournament);

  const parseMlbOddsIndex = (json: any): { byId: Map<string, ParsedOdds>; byMlbid: Map<string, ParsedOdds>; byKeyNoTime: Map<string, ParsedOdds> } => {
    const byId = new Map<string, ParsedOdds>();
    const byMlbid = new Map<string, ParsedOdds>();
    const byKeyNoTime = new Map<string, ParsedOdds>();

    const cat = json?.odds?.category;
    const matches = asArray(cat?.matches?.match ?? cat?.matches);
    for (const m of matches) {
      const id = String(m?.id || '').trim();
      const mlbid = String(m?.mlbid || '').trim();
      const homeName = String(m?.home?.name || '').trim();
      const awayName = String(m?.away?.name || '').trim();
      if (!id || !homeName || !awayName) continue;

      let home = 0;
      let draw = 0;
      let away = 0;
      const spreadsSelections: any[] = [];
      const totalsSelections: any[] = [];
      const spreadsSeen = new Set<string>();
      const totalsSeen = new Set<string>();

      const parseLineNum = (v: any): number | null => {
        const s = String(v ?? '').trim().replace(',', '.').replace(/\s+/g, '');
        if (!s) return null;
        const n = Number(s);
        return Number.isFinite(n) ? n : null;
      };
      const readLine = (o: any): number | null =>
        parseLineNum(o?.handicap ?? o?.line ?? o?.points ?? o?.total ?? o?.param ?? o?.value_2);
      const readOdd = (o: any): number => parseOddNum(o?.value ?? o?.odd ?? o?.price);
      const pickBookmaker = (tp: any, requiredNames: string[]) => {
        const names = requiredNames.map((x) => x.toLowerCase());
        const bookmakers = asArray(tp?.bookmaker);
        for (const bm of bookmakers) {
          const lines = asArray(bm?.odd);
          const hasAll = names.every((nm) => lines.some((o: any) => String(o?.name || '').toLowerCase().includes(nm)));
          if (hasAll) return { bm, lines };
        }
        return null;
      };

      const types = asArray(m?.odds?.type);
      for (const tp of types) {
        const typeName = String(tp?.value || tp?.name || '').toLowerCase().trim();
        if (!typeName) continue;

        const isMoneyline =
          typeName.includes('3way') ||
          typeName.includes('3-way') ||
          typeName.includes('moneyline') ||
          typeName.includes('home/away') ||
          typeName.includes('home away') ||
          typeName.includes('match winner') ||
          typeName === 'winner';
        const isSpread =
          typeName.includes('run line') ||
          typeName.includes('spread') ||
          typeName.includes('handicap') ||
          typeName.includes('runline');
        const isTotals =
          typeName.includes('over/under') ||
          typeName.includes('totals') ||
          typeName.includes('total') ||
          typeName.includes('runs');

        if (isMoneyline && !(home > 1 && away > 1)) {
          const picked = pickBookmaker(tp, ['home', 'away']);
          if (picked) {
            const homeLn = picked.lines.find((o: any) => String(o?.name || '').toLowerCase() === 'home');
            const drawLn = picked.lines.find((o: any) => String(o?.name || '').toLowerCase() === 'draw');
            const awayLn = picked.lines.find((o: any) => String(o?.name || '').toLowerCase() === 'away');
            const h = readOdd(homeLn);
            const d = readOdd(drawLn);
            const a = readOdd(awayLn);
            if (h > 1 && a > 1) {
              home = h;
              draw = d;
              away = a;
            }
          }
        }

        if (isSpread) {
          const picked = pickBookmaker(tp, ['home', 'away']);
          if (picked) {
            for (const o of picked.lines) {
              const nm = String(o?.name || '').toLowerCase();
              const odd = readOdd(o);
              const line = readLine(o);
              if (!(odd > 1 && odd < 50) || line == null) continue;
              if (nm !== 'home' && nm !== 'away') continue;
              const key = `${nm}|${line}`;
              if (spreadsSeen.has(key)) continue;
              spreadsSeen.add(key);
              spreadsSelections.push({
                id: `sel_${nm}_${line}`,
                label: `${nm === 'home' ? 'Casa' : 'Fora'} ${line >= 0 ? '+' : ''}${line}`,
                name: nm === 'home' ? 'Casa' : 'Fora',
                odd,
              });
            }
          }
        }

        if (isTotals) {
          const picked = pickBookmaker(tp, ['over', 'under']);
          if (picked) {
            for (const o of picked.lines) {
              const nm = String(o?.name || '').toLowerCase();
              const odd = readOdd(o);
              const line = readLine(o);
              if (!(odd > 1 && odd < 50) || line == null) continue;
              const isOver = nm.includes('over') || nm.includes('more');
              const isUnder = nm.includes('under') || nm.includes('less');
              if (!isOver && !isUnder) continue;
              const side = isOver ? 'over' : 'under';
              const key = `${side}|${line}`;
              if (totalsSeen.has(key)) continue;
              totalsSeen.add(key);
              totalsSelections.push({
                id: `sel_${side}_${line}`,
                label: `${isOver ? 'Mais' : 'Menos'} ${line}`,
                name: isOver ? 'Mais' : 'Menos',
                odd,
              });
            }
          }
        }
      }

      const markets: any[] = [];
      if (home > 1 && away > 1) {
        const selections = [
          { id: 'sel_home', label: 'Casa', name: 'Casa', odd: home },
          ...(draw > 1 ? [{ id: 'sel_draw', label: 'Empate', name: 'Empate', odd: draw }] : []),
          { id: 'sel_away', label: 'Fora', name: 'Fora', odd: away },
        ];
        markets.push({ id: 'mkt_h2h', key: 'h2h', name: 'Resultado Final', selections });
      }
      if (spreadsSelections.length >= 2) markets.push({ id: 'mkt_spreads', key: 'spreads', name: 'Run Line', selections: spreadsSelections });
      if (totalsSelections.length >= 2) markets.push({ id: 'mkt_totals', key: 'totals', name: 'Total de Runs', selections: totalsSelections });

      if (markets.length > 0) {
        const parsed: ParsedOdds = {
          home_odd: home,
          draw_odd: draw,
          away_odd: away,
          markets_json: JSON.stringify(markets),
        };
        byId.set(id, parsed);
        if (mlbid) byMlbid.set(mlbid, parsed);
        byKeyNoTime.set(makeKeyNoTime(m?.date, homeName, awayName), parsed);
      }
    }

    return { byId, byMlbid, byKeyNoTime };
  };

  const [livescoresJson, dailyMinus1Json, daily0Json, daily1Json, seasonJson, oddsJson] = await Promise.all([
    safeFetchJson(`${STATPAL_V1}/mlb/livescores?access_key=${encodeURIComponent(apiKey)}`),
    safeFetchJson(`${STATPAL_V1}/mlb/daily/d-1?access_key=${encodeURIComponent(apiKey)}`),
    safeFetchJson(`${STATPAL_V1}/mlb/daily/d0?access_key=${encodeURIComponent(apiKey)}`),
    safeFetchJson(`${STATPAL_V1}/mlb/daily/d1?access_key=${encodeURIComponent(apiKey)}`),
    safeFetchJson(`${STATPAL_V1}/mlb/season-schedule?access_key=${encodeURIComponent(apiKey)}`),
    safeFetchJson(`${STATPAL_V1}/mlb/odds?access_key=${encodeURIComponent(apiKey)}`),
  ]);

  const oddsIndex = parseMlbOddsIndex(oddsJson);
  const outById = new Map<string, any>();

  const findOddsForMatch = (m: any): ParsedOdds | null => {
    const id = String(m?.id || '').trim();
    const mlbid = String(m?.mlbid || '').trim();
    const oddsid = String(m?.oddsid || m?.oddsId || '').trim();
    if (id && oddsIndex.byId.has(id)) return oddsIndex.byId.get(id) || null;
    if (mlbid && oddsIndex.byMlbid.has(mlbid)) return oddsIndex.byMlbid.get(mlbid) || null;
    if (oddsid && oddsIndex.byId.has(oddsid)) return oddsIndex.byId.get(oddsid) || null;
    const homeName = String(m?.home?.name || '').trim();
    const awayName = String(m?.away?.name || '').trim();
    if (!homeName || !awayName) return null;
    const key = makeKeyNoTime(m?.date, homeName, awayName);
    return oddsIndex.byKeyNoTime.get(key) || null;
  };

  const parseInningVal = (v: any): number | null => {
    const s = String(v ?? '').trim();
    if (!s || s === '-') return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  };

  const addFrom = (json: any, sourcePriority: number) => {
    const tournaments = parseMlbTournaments(json);
    for (const t of tournaments) {
      const leagueName = String(t?.league || t?.name || '').trim() || 'MLB';
      const country = String(t?.country || '').trim();
      const matches = asArray(t?.match);
      for (const m of matches) {
        const idRaw = String(m?.id || '').trim();
        const homeName = String(m?.home?.name || '').trim();
        const awayName = String(m?.away?.name || '').trim();
        if (!idRaw || !homeName || !awayName) continue;

        const statusRaw = String(m?.status || '').trim();
        const finished = mlbIsFinished(statusRaw);
        const live = mlbIsLive(statusRaw);

        const homeTotal = Number(String(m?.home?.totalscore ?? '').trim());
        const awayTotal = Number(String(m?.away?.totalscore ?? '').trim());

        const scoreJson = (live || finished)
          ? JSON.stringify({
              home: Number.isFinite(homeTotal) ? homeTotal : 0,
              away: Number.isFinite(awayTotal) ? awayTotal : 0,
              hits: {
                home: parseInningVal(m?.home?.hits),
                away: parseInningVal(m?.away?.hits),
              },
              errors: {
                home: parseInningVal(m?.home?.errors),
                away: parseInningVal(m?.away?.errors),
              },
              innings: {
                in1: { home: parseInningVal(m?.home?.in1), away: parseInningVal(m?.away?.in1) },
                in2: { home: parseInningVal(m?.home?.in2), away: parseInningVal(m?.away?.in2) },
                in3: { home: parseInningVal(m?.home?.in3), away: parseInningVal(m?.away?.in3) },
                in4: { home: parseInningVal(m?.home?.in4), away: parseInningVal(m?.away?.in4) },
                in5: { home: parseInningVal(m?.home?.in5), away: parseInningVal(m?.away?.in5) },
                in6: { home: parseInningVal(m?.home?.in6), away: parseInningVal(m?.away?.in6) },
                in7: { home: parseInningVal(m?.home?.in7), away: parseInningVal(m?.away?.in7) },
                in8: { home: parseInningVal(m?.home?.in8), away: parseInningVal(m?.away?.in8) },
                in9: { home: parseInningVal(m?.home?.in9), away: parseInningVal(m?.away?.in9) },
              },
            })
          : '{"home":null,"away":null}';

        const odds = findOddsForMatch(m);
        const externalId = `statpal_mlb_${idRaw}`;
        const evt = {
          external_event_id: externalId,
          sport: 'baseball',
          league: leagueName,
          home_team: homeName,
          away_team: awayName,
          team_match: `${homeName} vs ${awayName}`,
          event_date: parseDateTime(m?.date, m?.time),
          status: finished ? 'FT' : live ? 'LIVE' : 'NS',
          is_live: live ? 1 : 0,
          home_odd: Number(odds?.home_odd || 0),
          draw_odd: Number(odds?.draw_odd || 0),
          away_odd: Number(odds?.away_odd || 0),
          elapsed: 0,
          timer: String(m?.outs || '').trim() || statusRaw,
          score: scoreJson,
          markets: String(odds?.markets_json || ''),
          country,
          home_team_logo: '',
          away_team_logo: '',
          _p: sourcePriority,
        };

        const prev = outById.get(externalId);
        if (!prev) outById.set(externalId, evt);
        else {
          const prevLive = Number(prev?.is_live || 0) === 1;
          const nextLive = Number(evt?.is_live || 0) === 1;
          if (nextLive && !prevLive) outById.set(externalId, evt);
          else if (!prevLive && !nextLive && sourcePriority < Number(prev?._p ?? 99)) outById.set(externalId, evt);
        }
      }
    }
  };

  if (seasonJson) addFrom(seasonJson, 4);
  if (daily1Json) addFrom(daily1Json, 3);
  if (daily0Json) addFrom(daily0Json, 2);
  if (dailyMinus1Json) addFrom(dailyMinus1Json, 1);
  if (livescoresJson) addFrom(livescoresJson, 0);

  if (oddsJson) {
    const cat = oddsJson?.odds?.category;
    const leagueName = String(cat?.name || cat?.league || '').trim() || 'MLB';
    const matches = asArray(cat?.matches?.match ?? cat?.matches);
    for (const m of matches) {
      const id = String(m?.id || '').trim();
      const homeName = String(m?.home?.name || '').trim();
      const awayName = String(m?.away?.name || '').trim();
      if (!id || !homeName || !awayName) continue;
      const externalId = `statpal_mlb_${id}`;
      if (outById.has(externalId)) continue;
      const odds = findOddsForMatch(m);
      outById.set(externalId, {
        external_event_id: externalId,
        sport: 'baseball',
        league: leagueName,
        home_team: homeName,
        away_team: awayName,
        team_match: `${homeName} vs ${awayName}`,
        event_date: parseDateTime(m?.date, m?.time),
        status: 'NS',
        is_live: 0,
        home_odd: Number(odds?.home_odd || 0),
        draw_odd: Number(odds?.draw_odd || 0),
        away_odd: Number(odds?.away_odd || 0),
        elapsed: 0,
        timer: '',
        score: '{"home":null,"away":null}',
        markets: String(odds?.markets_json || ''),
        country: '',
        home_team_logo: '',
        away_team_logo: '',
        _p: 6,
      });
    }
  }

  return Array.from(outById.values()).map((e) => {
    const { _p, ...rest } = e || {};
    return rest;
  });
}

async function fetchStatpalNFL(apiKey: string): Promise<any[]> {
  const safeFetchJson = async (url: string): Promise<any | null> => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) return null;
      return await res.json().catch(() => null);
    } catch {
      return null;
    } finally {
      clearTimeout(t);
    }
  };

  const parseNflDateTime = (m: any): string => {
    const dtUtc = String(m?.datetime_utc || '').trim();
    const dm = dtUtc.match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})$/);
    if (dm) {
      const [, dd, mm, yyyy, hh, mi] = dm;
      return `${yyyy}-${mm}-${dd}T${hh}:${mi}:00.000Z`;
    }

    const date = String(m?.formatted_date || m?.date || '').trim();
    const time = String(m?.time || '00:00').trim();
    const tm = time.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (tm) {
      let hh = Number(tm[1]);
      const mi = String(tm[2]);
      const ap = String(tm[3]).toUpperCase();
      if (ap === 'PM' && hh < 12) hh += 12;
      if (ap === 'AM' && hh === 12) hh = 0;
      const t24 = `${String(hh).padStart(2, '0')}:${mi}`;
      return parseDateTime(date, t24);
    }

    if (/^\d{1,2}:\d{2}$/.test(time)) return parseDateTime(date, time);
    return parseDateTime(date, '00:00');
  };

  const nflIsFinished = (status: string, timer: string): boolean => {
    const s = String(status || '').toLowerCase().trim();
    const t = String(timer || '').toLowerCase().trim();
    if (!s && !t) return false;
    if (isFinished(s) || isFinished(t)) return true;
    return s === 'final' || s === 'finished' || t.startsWith('final');
  };

  const nflIsLive = (status: string, timer: string): boolean => {
    const s = String(status || '').toLowerCase().trim();
    const t = String(timer || '').toLowerCase().trim();
    if (!s && !t) return false;
    if (nflIsFinished(s, t)) return false;
    if (isLive(s) || isLive(t)) return true;
    const hasQuarterToken = /\bq[1-4]\b/.test(s) || /\bq[1-4]\b/.test(t) || /\b[1-4]q\b/.test(s) || /\b[1-4]q\b/.test(t) || /\bqtr\b/.test(s) || /\bqtr\b/.test(t);
    const hasOtToken = /\bot\b/.test(s) || /\bot\b/.test(t) || s.includes('overtime') || t.includes('overtime');
    return (
      s.includes('quarter') ||
      t.includes('quarter') ||
      hasQuarterToken ||
      hasOtToken ||
      s.includes('in progress') ||
      t.includes('in progress')
    );
  };

  const parseNflOddsIndex = (json: any): { byId: Map<string, ParsedOdds>; byContestId: Map<string, ParsedOdds> } => {
    const byId = new Map<string, ParsedOdds>();
    const byContestId = new Map<string, ParsedOdds>();

    const cat = json?.odds?.category;
    const tour = json?.odds?.tournament;
    const matches = asArray(tour?.match ?? cat?.matches?.match ?? cat?.matches);
    for (const m of matches) {
      const id = String(m?.id || '').trim();
      const contestid = String(m?.contestid || m?.contestId || '').trim();
      const homeName = String(m?.home?.name || '').trim();
      const awayName = String(m?.away?.name || '').trim();
      if ((!id && !contestid) || !homeName || !awayName) continue;

      let home = 0;
      let draw = 0;
      let away = 0;
      const spreadsSelections: any[] = [];
      const totalsSelections: any[] = [];
      const spreadsSeen = new Set<string>();
      const totalsSeen = new Set<string>();

      const parseLineNum = (v: any): number | null => {
        const s = String(v ?? '').trim().replace(',', '.').replace(/\s+/g, '');
        if (!s) return null;
        const n = Number(s);
        return Number.isFinite(n) ? n : null;
      };
      const readLine = (o: any): number | null =>
        parseLineNum(o?.handicap ?? o?.line ?? o?.points ?? o?.total ?? o?.param ?? o?.value_2);
      const readOdd = (o: any): number => parseOddNum(o?.value ?? o?.odd ?? o?.price);
      const pickBookmaker = (tp: any, requiredNames: string[]) => {
        const names = requiredNames.map((x) => x.toLowerCase());
        const bookmakers = asArray(tp?.bookmaker);
        for (const bm of bookmakers) {
          const lines = asArray(bm?.odd);
          const hasAll = names.every((nm) => lines.some((o: any) => String(o?.name || '').toLowerCase().includes(nm)));
          if (hasAll) return { bm, lines };
        }
        return null;
      };

      const types = asArray(m?.odds?.type);
      for (const tp of types) {
        const typeName = String(tp?.value || tp?.name || '').toLowerCase().trim();
        if (!typeName) continue;
        const looksLikeMoneyline =
          typeName.includes('moneyline') ||
          typeName.includes('home/away') ||
          typeName.includes('home away') ||
          typeName.includes('3way') ||
          typeName.includes('3-way') ||
          typeName.includes('result') ||
          typeName === '1';
        const looksLikeSpread =
          typeName.includes('spread') ||
          typeName.includes('handicap') ||
          typeName.includes('point spread');
        const looksLikeTotals =
          typeName.includes('over/under') ||
          typeName.includes('totals') ||
          typeName.includes('total') ||
          typeName.includes('points');

        if (looksLikeMoneyline && !(home > 1 && away > 1)) {
          const picked = pickBookmaker(tp, ['home', 'away']);
          if (picked) {
            const getByNames = (names: string[]): any =>
              picked.lines.find((o: any) => names.includes(String(o?.name || '').toLowerCase().trim()));
            const homeLn = getByNames(['home', '1']);
            const drawLn = getByNames(['draw', 'x']);
            const awayLn = getByNames(['away', '2']);
            const h = readOdd(homeLn);
            const d = readOdd(drawLn);
            const a = readOdd(awayLn);
            if (h > 1 && a > 1) {
              home = h;
              draw = d;
              away = a;
            }
          }
        }

        if (looksLikeSpread) {
          const picked = pickBookmaker(tp, ['home', 'away']);
          if (picked) {
            for (const o of picked.lines) {
              const nm = String(o?.name || '').toLowerCase();
              const odd = readOdd(o);
              const line = readLine(o);
              if (!(odd > 1 && odd < 50) || line == null) continue;
              if (nm !== 'home' && nm !== 'away') continue;
              const key = `${nm}|${line}`;
              if (spreadsSeen.has(key)) continue;
              spreadsSeen.add(key);
              spreadsSelections.push({
                id: `sel_${nm}_${line}`,
                label: `${nm === 'home' ? 'Casa' : 'Fora'} ${line >= 0 ? '+' : ''}${line}`,
                name: nm === 'home' ? 'Casa' : 'Fora',
                odd,
              });
            }
          }
        }

        if (looksLikeTotals) {
          const picked = pickBookmaker(tp, ['over', 'under']);
          if (picked) {
            for (const o of picked.lines) {
              const nm = String(o?.name || '').toLowerCase();
              const odd = readOdd(o);
              const line = readLine(o);
              if (!(odd > 1 && odd < 50) || line == null) continue;
              const isOver = nm.includes('over') || nm.includes('more');
              const isUnder = nm.includes('under') || nm.includes('less');
              if (!isOver && !isUnder) continue;
              const side = isOver ? 'over' : 'under';
              const key = `${side}|${line}`;
              if (totalsSeen.has(key)) continue;
              totalsSeen.add(key);
              totalsSelections.push({
                id: `sel_${side}_${line}`,
                label: `${isOver ? 'Mais' : 'Menos'} ${line}`,
                name: isOver ? 'Mais' : 'Menos',
                odd,
              });
            }
          }
        }
      }

      const markets: any[] = [];
      if (home > 1 && away > 1) {
        const selections = [
          { id: 'sel_home', label: 'Casa', name: 'Casa', odd: home },
          ...(draw > 1 ? [{ id: 'sel_draw', label: 'Empate', name: 'Empate', odd: draw }] : []),
          { id: 'sel_away', label: 'Fora', name: 'Fora', odd: away },
        ];
        markets.push({ id: 'mkt_h2h', key: 'h2h', name: 'Resultado Final', selections });
      }
      if (spreadsSelections.length >= 2) markets.push({ id: 'mkt_spreads', key: 'spreads', name: 'Spread', selections: spreadsSelections });
      if (totalsSelections.length >= 2) markets.push({ id: 'mkt_totals', key: 'totals', name: 'Total de Pontos', selections: totalsSelections });

      if (markets.length > 0) {
        const parsed: ParsedOdds = {
          home_odd: home,
          draw_odd: draw,
          away_odd: away,
          markets_json: JSON.stringify(markets),
        };
        if (id) byId.set(id, parsed);
        if (contestid) byContestId.set(contestid, parsed);
      }
    }

    return { byId, byContestId };
  };

  const [livescoresJson, livePlaysJson, seasonJson, standingsJson, oddsJson] = await Promise.all([
    safeFetchJson(`${STATPAL_V1}/nfl/livescores?access_key=${encodeURIComponent(apiKey)}`),
    safeFetchJson(`${STATPAL_V1}/nfl/live-plays?access_key=${encodeURIComponent(apiKey)}`),
    safeFetchJson(`${STATPAL_V1}/nfl/season-schedule?access_key=${encodeURIComponent(apiKey)}`),
    safeFetchJson(`${STATPAL_V1}/nfl/standings?access_key=${encodeURIComponent(apiKey)}`),
    safeFetchJson(`${STATPAL_V1}/nfl/odds?access_key=${encodeURIComponent(apiKey)}`),
  ]);

  const oddsIndex = parseNflOddsIndex(oddsJson);
  const outById = new Map<string, any>();

  const addMatch = (leagueName: string, country: string, m: any, sourcePriority: number) => {
    const contestId = String(m?.contestid || m?.contestId || m?.id || '').trim();
    if (!contestId) return;
    const homeName = String(m?.home?.name || '').trim();
    const awayName = String(m?.away?.name || '').trim();
    if (!homeName || !awayName) return;

    const statusRaw = String(m?.status || '').trim();
    const timerRaw = String(m?.timer || '').trim();
    const finished = nflIsFinished(statusRaw, timerRaw);
    const live = nflIsLive(statusRaw, timerRaw);

    const homeTotal = Number(String(m?.home?.totalscore ?? '').trim());
    const awayTotal = Number(String(m?.away?.totalscore ?? '').trim());
    const q1h = Number(String(m?.home?.q1 ?? '').trim());
    const q2h = Number(String(m?.home?.q2 ?? '').trim());
    const q3h = Number(String(m?.home?.q3 ?? '').trim());
    const q4h = Number(String(m?.home?.q4 ?? '').trim());
    const oth = Number(String(m?.home?.ot ?? '').trim());
    const q1a = Number(String(m?.away?.q1 ?? '').trim());
    const q2a = Number(String(m?.away?.q2 ?? '').trim());
    const q3a = Number(String(m?.away?.q3 ?? '').trim());
    const q4a = Number(String(m?.away?.q4 ?? '').trim());
    const ota = Number(String(m?.away?.ot ?? '').trim());

    const scoreJson = (live || finished)
      ? JSON.stringify({
          home: Number.isFinite(homeTotal) ? homeTotal : 0,
          away: Number.isFinite(awayTotal) ? awayTotal : 0,
          periods: {
            q1: { home: Number.isFinite(q1h) ? q1h : null, away: Number.isFinite(q1a) ? q1a : null },
            q2: { home: Number.isFinite(q2h) ? q2h : null, away: Number.isFinite(q2a) ? q2a : null },
            q3: { home: Number.isFinite(q3h) ? q3h : null, away: Number.isFinite(q3a) ? q3a : null },
            q4: { home: Number.isFinite(q4h) ? q4h : null, away: Number.isFinite(q4a) ? q4a : null },
            ot: { home: Number.isFinite(oth) ? oth : null, away: Number.isFinite(ota) ? ota : null },
          },
          ball_on: String(m?.home?.ball_on || m?.away?.ball_on || '').trim(),
          drive: String(m?.home?.drive || m?.away?.drive || '').trim(),
        })
      : '{"home":null,"away":null}';

    const odds =
      oddsIndex.byContestId.get(contestId) ||
      oddsIndex.byId.get(contestId) ||
      (String(m?.id || '').trim() ? oddsIndex.byId.get(String(m?.id || '').trim()) : null);

    const externalId = `statpal_nfl_${contestId}`;
    const evt = {
      external_event_id: externalId,
      sport: 'american-football',
      league: leagueName,
      home_team: homeName,
      away_team: awayName,
      team_match: `${homeName} vs ${awayName}`,
      event_date: parseNflDateTime(m),
      status: finished ? 'FT' : live ? 'LIVE' : 'NS',
      is_live: live ? 1 : 0,
      home_odd: Number(odds?.home_odd || 0),
      draw_odd: Number(odds?.draw_odd || 0),
      away_odd: Number(odds?.away_odd || 0),
      elapsed: 0,
      timer: timerRaw || statusRaw,
      score: scoreJson,
      markets: String(odds?.markets_json || ''),
      country: country || 'USA',
      home_team_logo: '',
      away_team_logo: '',
      _p: sourcePriority,
    };

    const prev = outById.get(externalId);
    if (!prev) outById.set(externalId, evt);
    else {
      const prevLive = Number(prev?.is_live || 0) === 1;
      const nextLive = Number(evt?.is_live || 0) === 1;
      if (nextLive && !prevLive) outById.set(externalId, evt);
      else if (!prevLive && !nextLive && sourcePriority < Number(prev?._p ?? 99)) outById.set(externalId, evt);
    }
  };

  const addFromTournamentList = (json: any, sourcePriority: number) => {
    const tournaments = asArray(json?.livescores?.tournament || json?.liveplays?.tournament);
    for (const t of tournaments) {
      const leagueName = String(t?.league || t?.name || '').trim() || 'NFL';
      const country = String(t?.country || '').trim() || 'USA';
      const matches = asArray(t?.match);
      for (const m of matches) addMatch(leagueName, country, m, sourcePriority);
    }
  };

  const addFromSeasonSchedule = (json: any, sourcePriority: number) => {
    const tournaments = asArray(json?.scores?.tournament);
    for (const t of tournaments) {
      const baseLeague = String(t?.name || t?.league || '').trim() || 'NFL';
      const stages = asArray(t?.stage);
      for (const st of stages) {
        const stageName = String(st?.name || '').trim();
        const leagueName = stageName ? `${baseLeague} - ${stageName}` : baseLeague;
        const weeks = asArray(st?.week);
        for (const wk of weeks) {
          const matchesContainer = wk?.matches;
          const matches = asArray(matchesContainer?.match ?? matchesContainer);
          for (const m of matches) addMatch(leagueName, 'USA', m, sourcePriority);
        }
      }
    }
  };

  if (seasonJson) addFromSeasonSchedule(seasonJson, 4);
  if (livePlaysJson) addFromTournamentList(livePlaysJson, 1);
  if (livescoresJson) addFromTournamentList(livescoresJson, 0);

  if (oddsJson) {
    const cat = oddsJson?.odds?.category;
    const tour = oddsJson?.odds?.tournament;
    const leagueName = String(tour?.league || tour?.name || cat?.name || cat?.league || '').trim() || 'NFL';
    const matches = asArray(tour?.match ?? cat?.matches?.match ?? cat?.matches);
    for (const m of matches) {
      const id = String(m?.contestid || m?.contestId || m?.id || '').trim();
      if (!id) continue;
      const externalId = `statpal_nfl_${id}`;
      if (outById.has(externalId)) continue;
      const homeName = String(m?.home?.name || '').trim();
      const awayName = String(m?.away?.name || '').trim();
      if (!homeName || !awayName) continue;
      const odds = oddsIndex.byContestId.get(id) || oddsIndex.byId.get(id);
      outById.set(externalId, {
        external_event_id: externalId,
        sport: 'american-football',
        league: leagueName,
        home_team: homeName,
        away_team: awayName,
        team_match: `${homeName} vs ${awayName}`,
        event_date: parseNflDateTime(m),
        status: 'NS',
        is_live: 0,
        home_odd: Number(odds?.home_odd || 0),
        draw_odd: Number(odds?.draw_odd || 0),
        away_odd: Number(odds?.away_odd || 0),
        elapsed: 0,
        timer: '',
        score: '{"home":null,"away":null}',
        markets: String(odds?.markets_json || ''),
        country: 'USA',
        home_team_logo: '',
        away_team_logo: '',
        _p: 6,
      });
    }
  }

  void standingsJson;

  return Array.from(outById.values()).map((e) => {
    const { _p, ...rest } = e || {};
    return rest;
  });
}

async function fetchStatpalNHL(apiKey: string): Promise<any[]> {
  const safeFetchJson = async (url: string): Promise<any | null> => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) return null;
      return await res.json().catch(() => null);
    } catch {
      return null;
    } finally {
      clearTimeout(t);
    }
  };

  const nhlIsFinished = (status: string): boolean => {
    const s = String(status || '').toLowerCase().trim();
    if (!s) return false;
    if (isFinished(s)) return true;
    if (s === 'finished') return true;
    if (s.includes('after overtime')) return true;
    if (s.includes('after over time')) return true;
    if (s.includes('after penalties')) return true;
    if (s.includes('after penalty')) return true;
    if (s.includes('final')) return true;
    return false;
  };

  const nhlIsLive = (status: string, timer: string): boolean => {
    const s = String(status || '').toLowerCase().trim();
    const t = String(timer || '').toLowerCase().trim();
    if (!s && !t) return false;
    if (nhlIsFinished(s)) return false;
    if (isLive(s) || isLive(t)) return true;
    return (
      s.includes('period') ||
      t.includes('period') ||
      s.includes('overtime') ||
      t.includes('overtime') ||
      s === 'ot' ||
      t.includes('ot') ||
      s.includes('intermission') ||
      t.includes('intermission')
    );
  };

  const parseNhlTournaments = (json: any): any[] =>
    asArray(json?.livescores?.tournament || json?.scores?.tournament);

  const parsePeriodScore = (raw: any): { home: number | null; away: number | null } | null => {
    const s = String(raw ?? '').trim();
    const m = s.match(/^\s*(\d+)\s*-\s*(\d+)\s*$/);
    if (!m) return null;
    const h = Number(m[1]);
    const a = Number(m[2]);
    return {
      home: Number.isFinite(h) ? h : null,
      away: Number.isFinite(a) ? a : null,
    };
  };

  const parseNhlOddsMap = (json: any): Map<string, ParsedOdds> => {
    const map = new Map<string, ParsedOdds>();
    const cat = json?.odds?.category;
    const matches = asArray(cat?.matches?.match ?? cat?.matches);
    for (const m of matches) {
      const id = String(m?.id || '').trim();
      if (!id) continue;

      let home = 0;
      let draw = 0;
      let away = 0;
      const markets: any[] = [];

      const parseLineNum = (v: any): number | null => {
        const s = String(v ?? '').trim().replace(',', '.').replace(/\s+/g, '');
        if (!s) return null;
        const n = Number(s);
        return Number.isFinite(n) ? n : null;
      };
      const readLine = (o: any): number | null =>
        parseLineNum(o?.handicap ?? o?.line ?? o?.points ?? o?.total ?? o?.param ?? o?.value_2);
      const readOdd = (o: any): number => parseOddNum(o?.value ?? o?.odd ?? o?.price);
      const pickBookmaker = (tp: any, requiredNames: string[]) => {
        const names = requiredNames.map((x) => x.toLowerCase());
        const bookmakers = asArray(tp?.bookmaker);
        for (const bm of bookmakers) {
          const lines = asArray(bm?.odd);
          const hasAll = names.every((nm) => lines.some((o: any) => String(o?.name || '').toLowerCase().includes(nm)));
          if (hasAll) return { bm, lines };
        }
        return null;
      };

      const types = asArray(m?.odds?.type);
      for (const tp of types) {
        const typeName = String(tp?.value || tp?.name || '').toLowerCase().trim();
        if (!typeName) continue;

        const is3Way = typeName.includes('3way') || typeName.includes('3-way') || typeName.includes('1x2');
        const isMoneyline = typeName.includes('moneyline') || typeName.includes('home/away') || typeName.includes('match winner') || typeName === 'winner';
        const isTotals = typeName.includes('over/under') || typeName.includes('totals') || typeName.includes('total') || typeName.includes('goals');

        if ((is3Way || isMoneyline) && !(home > 1 && away > 1)) {
          const picked = pickBookmaker(tp, ['home', 'away']);
          if (picked) {
            const homeLn = picked.lines.find((o: any) => String(o?.name || '').toLowerCase() === 'home');
            const drawLn = picked.lines.find((o: any) => String(o?.name || '').toLowerCase() === 'draw');
            const awayLn = picked.lines.find((o: any) => String(o?.name || '').toLowerCase() === 'away');
            const h = readOdd(homeLn);
            const d = readOdd(drawLn);
            const a = readOdd(awayLn);
            if (h > 1 && a > 1) {
              home = h;
              draw = d;
              away = a;
            }
          }
        }

        if (isTotals) {
          const picked = pickBookmaker(tp, ['over', 'under']);
          if (picked) {
            const selections: any[] = [];
            for (const o of picked.lines) {
              const nm = String(o?.name || '').toLowerCase();
              const odd = readOdd(o);
              const line = readLine(o);
              if (!(odd > 1 && odd < 50) || line == null) continue;
              if (nm.includes('over') || nm.includes('more')) selections.push({ id: `sel_over_${line}`, label: `Mais ${line}`, name: 'Mais', odd });
              else if (nm.includes('under') || nm.includes('less')) selections.push({ id: `sel_under_${line}`, label: `Menos ${line}`, name: 'Menos', odd });
            }
            if (selections.length >= 2) markets.push({ id: 'mkt_totals', key: 'totals', name: 'Total de Gols', selections });
          }
        }
      }

      if (home > 1 && away > 1) {
        const h2hSelections =
          draw > 1
            ? [
                { id: 'sel_home', label: 'Casa', name: 'Casa', odd: home },
                { id: 'sel_draw', label: 'Empate', name: 'Empate', odd: draw },
                { id: 'sel_away', label: 'Fora', name: 'Fora', odd: away },
              ]
            : [
                { id: 'sel_home', label: 'Casa', name: 'Casa', odd: home },
                { id: 'sel_away', label: 'Fora', name: 'Fora', odd: away },
              ];
        markets.unshift({ id: 'mkt_h2h', key: 'h2h', name: 'Resultado Final', selections: h2hSelections });
        map.set(id, { home_odd: home, draw_odd: draw, away_odd: away, markets_json: JSON.stringify(markets) });
      }
    }
    return map;
  };

  const [livescoresJson, dailyMinus1Json, daily0Json, daily1Json, seasonJson, oddsJson] = await Promise.all([
    safeFetchJson(`${STATPAL_V1}/nhl/livescores?access_key=${encodeURIComponent(apiKey)}`),
    safeFetchJson(`${STATPAL_V1}/nhl/daily/d-1?access_key=${encodeURIComponent(apiKey)}`),
    safeFetchJson(`${STATPAL_V1}/nhl/daily/d0?access_key=${encodeURIComponent(apiKey)}`),
    safeFetchJson(`${STATPAL_V1}/nhl/daily/d1?access_key=${encodeURIComponent(apiKey)}`),
    safeFetchJson(`${STATPAL_V1}/nhl/season-schedule?access_key=${encodeURIComponent(apiKey)}`),
    safeFetchJson(`${STATPAL_V1}/nhl/odds?access_key=${encodeURIComponent(apiKey)}`),
  ]);

  const oddsByMatchId = parseNhlOddsMap(oddsJson);
  const outById = new Map<string, any>();

  const addFrom = (json: any, sourcePriority: number) => {
    const tournaments = parseNhlTournaments(json);
    for (const t of tournaments) {
      const leagueName = String(t?.league || t?.name || '').trim() || 'NHL';
      const country = String(t?.country || '').trim() || 'USA';
      const matches = asArray(t?.match);
      for (const m of matches) {
        const id = String(m?.id || '').trim();
        if (!id) continue;
        const homeName = String(m?.home?.name || '').trim();
        const awayName = String(m?.away?.name || '').trim();
        if (!homeName || !awayName) continue;

        const statusRaw = String(m?.status || '').trim();
        const timerRaw = String(m?.timer || '').trim();
        const finished = nhlIsFinished(statusRaw);
        const live = nhlIsLive(statusRaw, timerRaw);

        const homeTotal = Number(String(m?.home?.totalscore ?? '').trim());
        const awayTotal = Number(String(m?.away?.totalscore ?? '').trim());

        const p1 = parsePeriodScore(m?.events?.firstperiod?.score);
        const p2 = parsePeriodScore(m?.events?.secondperiod?.score);
        const p3 = parsePeriodScore(m?.events?.thirdperiod?.score);
        const ot = parsePeriodScore(m?.events?.overtime?.score);
        const so = parsePeriodScore(m?.events?.penalties?.score);

        const scoreJson = (live || finished)
          ? JSON.stringify({
              home: Number.isFinite(homeTotal) ? homeTotal : 0,
              away: Number.isFinite(awayTotal) ? awayTotal : 0,
              periods: {
                p1,
                p2,
                p3,
                ot,
                so,
              },
            })
          : '{"home":null,"away":null}';

        const odds = oddsByMatchId.get(id);
        const evt = {
          external_event_id: `statpal_nhl_${id}`,
          sport: 'ice-hockey',
          league: leagueName,
          home_team: homeName,
          away_team: awayName,
          team_match: `${homeName} vs ${awayName}`,
          event_date: parseDateTime(m?.date, m?.time),
          status: finished ? 'FT' : live ? 'LIVE' : 'NS',
          is_live: live ? 1 : 0,
          home_odd: Number(odds?.home_odd || 0),
          draw_odd: Number(odds?.draw_odd || 0),
          away_odd: Number(odds?.away_odd || 0),
          elapsed: 0,
          timer: timerRaw || statusRaw,
          score: scoreJson,
          markets: String(odds?.markets_json || ''),
          country,
          home_team_logo: '',
          away_team_logo: '',
          _p: sourcePriority,
        };

        const prev = outById.get(evt.external_event_id);
        if (!prev) outById.set(evt.external_event_id, evt);
        else {
          const prevLive = Number(prev?.is_live || 0) === 1;
          const nextLive = Number(evt?.is_live || 0) === 1;
          if (nextLive && !prevLive) outById.set(evt.external_event_id, evt);
          else if (!prevLive && !nextLive && sourcePriority < Number(prev?._p ?? 99)) outById.set(evt.external_event_id, evt);
        }
      }
    }
  };

  if (seasonJson) addFrom(seasonJson, 4);
  if (daily1Json) addFrom(daily1Json, 3);
  if (daily0Json) addFrom(daily0Json, 2);
  if (dailyMinus1Json) addFrom(dailyMinus1Json, 1);
  if (livescoresJson) addFrom(livescoresJson, 0);

  if (oddsJson) {
    const cat = oddsJson?.odds?.category;
    const leagueName = String(cat?.name || cat?.league || '').trim() || 'NHL';
    const matches = asArray(cat?.matches?.match ?? cat?.matches);
    for (const m of matches) {
      const id = String(m?.id || '').trim();
      if (!id) continue;
      const externalId = `statpal_nhl_${id}`;
      if (outById.has(externalId)) continue;
      const homeName = String(m?.home?.name || '').trim();
      const awayName = String(m?.away?.name || '').trim();
      if (!homeName || !awayName) continue;
      const odds = oddsByMatchId.get(id);
      outById.set(externalId, {
        external_event_id: externalId,
        sport: 'ice-hockey',
        league: leagueName,
        home_team: homeName,
        away_team: awayName,
        team_match: `${homeName} vs ${awayName}`,
        event_date: parseDateTime(m?.date, m?.time),
        status: 'NS',
        is_live: 0,
        home_odd: Number(odds?.home_odd || 0),
        draw_odd: Number(odds?.draw_odd || 0),
        away_odd: Number(odds?.away_odd || 0),
        elapsed: 0,
        timer: '',
        score: '{"home":null,"away":null}',
        markets: String(odds?.markets_json || ''),
        country: '',
        home_team_logo: '',
        away_team_logo: '',
        _p: 6,
      });
    }
  }

  return Array.from(outById.values()).map((e) => {
    const { _p, ...rest } = e || {};
    return rest;
  });
}

async function fetchStatpalF1(apiKey: string): Promise<any[]> {
  const safeFetchJson = async (url: string): Promise<any | null> => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) return null;
      return await res.json().catch(() => null);
    } catch {
      return null;
    } finally {
      clearTimeout(t);
    }
  };

  const [livescoresJson, scheduleJson, resultsJson] = await Promise.all([
    safeFetchJson(`${STATPAL_V1}/f1/livescores?access_key=${encodeURIComponent(apiKey)}`),
    safeFetchJson(`${STATPAL_V1}/f1/schedule?access_key=${encodeURIComponent(apiKey)}`),
    safeFetchJson(`${STATPAL_V1}/f1/results?access_key=${encodeURIComponent(apiKey)}`),
  ]);

  const outById = new Map<string, any>();

  const makeScoreJson = (race: any): string => {
    const drivers = asArray(race?.results?.driver);
    const podium = drivers
      .slice(0, 3)
      .map((d: any) => ({
        pos: String(d?.pos || '').trim(),
        name: String(d?.name || '').trim(),
        team: String(d?.team || '').trim(),
        time: String(d?.time || '').trim(),
      }))
      .filter((d: any) => d.pos || d.name || d.team || d.time);

    const payload: any = {
      track: String(race?.track || '').trim(),
      total_laps: String(race?.total_laps || '').trim(),
      fastest_lap: String(race?.fastest_lap || '').trim(),
      fastest_lap_driver_id: String(race?.fastest_lap_id || '').trim(),
    };
    if (podium.length) payload.podium = podium;
    return JSON.stringify(payload);
  };

  const addTournament = (t: any, sourcePriority: number) => {
    const id = String(t?.id || '').trim();
    if (!id) return;
    const name = String(t?.name || '').trim();
    const race = t?.race || {};
    const statusRaw = String(race?.status || 'Scheduled').trim();
    const live = isLive(statusRaw);
    const finished = isFinished(statusRaw);
    const scoreJson = finished || live ? makeScoreJson(race) : '';
    const evt = {
      external_event_id: `statpal_f1_${id}`,
      sport: 'formula1',
      league: 'Formula 1',
      home_team: name,
      away_team: String(race?.track || race?.city || '').trim(),
      team_match: name,
      event_date: parseDateTime(race?.date, race?.time || '14:00'),
      status: finished ? 'FT' : live ? 'LIVE' : 'NS',
      is_live: live ? 1 : 0,
      home_odd: 0,
      draw_odd: 0,
      away_odd: 0,
      elapsed: 0,
      timer: statusRaw,
      score: scoreJson,
      markets: '',
      country: '',
      home_team_logo: '',
      away_team_logo: '',
      _p: sourcePriority,
    };

    const prev = outById.get(evt.external_event_id);
    if (!prev) outById.set(evt.external_event_id, evt);
    else {
      const prevLive = Number(prev?.is_live || 0) === 1;
      const nextLive = Number(evt?.is_live || 0) === 1;
      if (nextLive && !prevLive) outById.set(evt.external_event_id, evt);
      else if (!prevLive && !nextLive && sourcePriority < Number(prev?._p ?? 99)) outById.set(evt.external_event_id, evt);
      else if (sourcePriority < Number(prev?._p ?? 99)) outById.set(evt.external_event_id, evt);
    }
  };

  const scheduleTournaments = asArray(scheduleJson?.fixtures?.tournament);
  for (const t of scheduleTournaments) addTournament(t, 2);

  const resultsTournaments = asArray(resultsJson?.results?.tournament);
  for (const t of resultsTournaments) addTournament(t, 1);

  const liveTournament = livescoresJson?.livescore?.tournament;
  if (liveTournament) addTournament(liveTournament, 0);

  return Array.from(outById.values()).map((e) => {
    const { _p, ...rest } = e || {};
    return rest;
  });
}

async function fetchStatpalGolf(apiKey: string): Promise<any[]> {
  const [scheduleRes, liveRes] = await Promise.allSettled([
    fetch(`${STATPAL_V1}/golf/schedule?access_key=${encodeURIComponent(apiKey)}`),
    fetch(`${STATPAL_V1}/golf/livescores?access_key=${encodeURIComponent(apiKey)}`),
  ]);

  const outById = new Map<string, any>();

  if (scheduleRes.status === 'fulfilled' && scheduleRes.value.ok) {
    const json: any = await scheduleRes.value.json().catch(() => null);
    const tournaments = asArray(json?.fixtures?.tournament);
    for (const t of tournaments) {
      const id = String(t?.id || '').trim();
      if (!id) continue;
      const name = String(t?.name || '').trim();
      const status = String(t?.status || 'Scheduled').trim();
      const live = isLive(status);
      const finished = isFinished(status);
      outById.set(`statpal_golf_${id}`, {
        external_event_id: `statpal_golf_${id}`,
        sport: 'golf',
        league: String(json?.fixtures?.series || t?.series || 'Golf'),
        home_team: name,
        away_team: String(t?.location || ''),
        team_match: name,
        event_date: parseDateTime(t?.date_start, '12:00'),
        status: finished ? 'FT' : live ? 'LIVE' : 'NS',
        is_live: live ? 1 : 0,
        home_odd: 0,
        draw_odd: 0,
        away_odd: 0,
        elapsed: 0,
        timer: status,
        score: '',
        markets: '',
        country: '',
        home_team_logo: '',
        away_team_logo: '',
        _p: 2,
      });
    }
  }

  if (liveRes.status === 'fulfilled' && liveRes.value.ok) {
    const json: any = await liveRes.value.json().catch(() => null);
    const tournaments = asArray(json?.livescore?.tournament);
    for (const t of tournaments) {
      const id = String(t?.id || '').trim();
      if (!id) continue;
      const name = String(t?.name || '').trim();
      const status = String(t?.status || '').trim();
      const live = isLive(status);
      const finished = isFinished(status);
      const externalId = `statpal_golf_${id}`;
      const prev = outById.get(externalId);
      const next = {
        external_event_id: externalId,
        sport: 'golf',
        league: String(t?.name || 'Golf'),
        home_team: name,
        away_team: String(t?.venue || ''),
        team_match: name,
        event_date: parseDateTime(t?.start_date, '12:00'),
        status: finished ? 'FT' : live ? 'LIVE' : 'NS',
        is_live: live ? 1 : 0,
        home_odd: 0,
        draw_odd: 0,
        away_odd: 0,
        elapsed: 0,
        timer: status,
        score: '',
        markets: '',
        country: String(t?.country || ''),
        home_team_logo: '',
        away_team_logo: '',
        _p: 0,
      };
      if (!prev) outById.set(externalId, next);
      else if (Number(prev?._p ?? 99) > 0) outById.set(externalId, next);
    }
  }

  return Array.from(outById.values()).map((e) => {
    const { _p, ...rest } = e || {};
    return rest;
  });
}

async function fetchStatpalHorseRacing(apiKey: string): Promise<any[]> {
  const parseRaceDateTime = (dt: any, fallbackDate: any, fallbackTime: any): string => {
    const raw = String(dt || '').trim();
    const m = raw.match(/^(\d{2}\.\d{2}\.\d{4})\s+(\d{2}:\d{2})$/);
    if (m) return parseDateTime(m[1], m[2]);
    return parseDateTime(String(fallbackDate || ''), String(fallbackTime || '12:00'));
  };

  const horseIsFinished = (status: string, hasWinner: boolean): boolean => {
    if (hasWinner) return true;
    const s = String(status || '').toLowerCase().trim();
    return s === 'finished' || s === 'final' || s === 'ended' || s === 'result' || s === 'results';
  };

  const horseIsLive = (status: string): boolean => {
    const s = String(status || '').toLowerCase().trim();
    if (!s) return false;
    return s === 'live' || s === 'running' || s === 'in play' || s === 'inplay' || s.includes('live');
  };

  const parseRaces = (json: any, sourcePriority: number, country: string): Map<string, any> => {
    const out = new Map<string, any>();
    const tournaments = asArray(json?.scores?.tournament);
    for (const t of tournaments) {
      const meetingName = String(t?.name || '').trim();
      const meetingDate = String(t?.date || '').trim();
      if (!meetingName) continue;
      const races = asArray(t?.race);
      for (const r of races) {
        const id = String(r?.id || '').trim();
        if (!id) continue;
        const raceName = String(r?.name || '').trim();
        const time = String(r?.time || r?.offat || '').trim();
        const results = asArray(r?.results?.horse);
        const hasWinner = results.some((h: any) => String(h?.pos || '').trim() === '1');
        const statusRaw = String(r?.status || '').trim();
        const finished = horseIsFinished(statusRaw, hasWinner);
        const live = !finished && horseIsLive(statusRaw);
        const externalId = `statpal_horse_racing_${id}`;
        out.set(externalId, {
          external_event_id: externalId,
          sport: 'horse-racing',
          league: meetingName,
          home_team: meetingName,
          away_team: raceName || `Race ${id}`,
          team_match: raceName || `Race ${id}`,
          event_date: parseRaceDateTime(r?.datetime, meetingDate, time),
          status: finished ? 'FT' : live ? 'LIVE' : 'NS',
          is_live: live ? 1 : 0,
          home_odd: 0,
          draw_odd: 0,
          away_odd: 0,
          elapsed: 0,
          timer: time || statusRaw,
          score: '',
          markets: '',
          country,
          home_team_logo: '',
          away_team_logo: '',
          _p: sourcePriority,
        });
      }
    }
    return out;
  };

  const [liveRes, scheduleRes] = await Promise.allSettled([
    fetch(`${STATPAL_V1}/horse-racing/live/uk?access_key=${encodeURIComponent(apiKey)}`),
    fetch(`${STATPAL_V1}/horse-racing/schedule/uk?access_key=${encodeURIComponent(apiKey)}`),
  ]);

  const outById = new Map<string, any>();

  const merge = (m: Map<string, any>) => {
    for (const [k, v] of m.entries()) {
      const prev = outById.get(k);
      if (!prev) outById.set(k, v);
      else if (Number(v?._p ?? 99) < Number(prev?._p ?? 99)) outById.set(k, v);
      else if (Number(v?.is_live || 0) === 1 && Number(prev?.is_live || 0) !== 1) outById.set(k, v);
    }
  };

  if (scheduleRes.status === 'fulfilled' && scheduleRes.value.ok) {
    const json: any = await scheduleRes.value.json().catch(() => null);
    merge(parseRaces(json, 2, 'UK'));
  }
  if (liveRes.status === 'fulfilled' && liveRes.value.ok) {
    const json: any = await liveRes.value.json().catch(() => null);
    merge(parseRaces(json, 0, 'UK'));
  }

  return Array.from(outById.values()).map((e) => {
    const { _p, ...rest } = e || {};
    return rest;
  });
}

export function getStatpalKeyFromEnv(env: any): string | null {
  const v =
    env?.STATPAL_ACCESS_KEY ||
    env?.STATPAL_KEY ||
    env?.STATPAL_API_KEY ||
    env?.VITE_STATPAL_ACCESS_KEY ||
    env?.VITE_STATPAL_KEY;
  const key = String(v || '').trim();
  return key ? key : null;
}

export async function fetchAllStatpalForApi(apiKey: string): Promise<any[]> {
  const results = await Promise.allSettled([
    fetchStatpalSoccer(apiKey),
    fetchStatpalTennis(apiKey),
    fetchStatpalVolleyball(apiKey),
    fetchStatpalHandball(apiKey),
    fetchStatpalCricket(apiKey),
    fetchStatpalNBA(apiKey),
    fetchStatpalMLB(apiKey),
    fetchStatpalNFL(apiKey),
    fetchStatpalNHL(apiKey),
    fetchStatpalF1(apiKey),
    fetchStatpalGolf(apiKey),
    fetchStatpalHorseRacing(apiKey),
  ]);
  const out: any[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') out.push(...r.value);
  }
  return out;
}

async function fetchAllStatpalCached(apiKey: string): Promise<any[]> {
  const now = Date.now();
  if (allEventsCache && allEventsCache.expiresAt > now) return allEventsCache.data;
  if (allEventsInflight) return allEventsInflight;

  allEventsInflight = (async () => {
    try {
      const data = await fetchAllStatpalForApi(apiKey);
      allEventsCache = { expiresAt: Date.now() + 30_000, data };
      return data;
    } finally {
      allEventsInflight = null;
    }
  })();

  return allEventsInflight;
}

async function fetchSportStatpalCached(apiKey: string, sport: string, ttlMs: number): Promise<any[]> {
  const key = `${sport}|${ttlMs}`;
  const now = Date.now();
  const hit = sportEventsCache.get(key);
  if (hit && hit.expiresAt > now) return hit.data;
  const inflight = sportEventsInflight.get(key);
  if (inflight) return inflight;

  const p = (async () => {
    try {
      let data: any[] = [];
      switch (sport) {
        case 'soccer':
          data = await fetchStatpalSoccer(apiKey);
          break;
        case 'tennis':
          data = await fetchStatpalTennis(apiKey);
          break;
        case 'volleyball':
          data = await fetchStatpalVolleyball(apiKey);
          break;
        case 'handball':
          data = await fetchStatpalHandball(apiKey);
          break;
        case 'cricket':
          data = await fetchStatpalCricket(apiKey);
          break;
        case 'basketball':
          data = await fetchStatpalNBA(apiKey);
          break;
        case 'baseball':
          data = await fetchStatpalMLB(apiKey);
          break;
        case 'american-football':
          data = await fetchStatpalNFL(apiKey);
          break;
        case 'ice-hockey':
          data = await fetchStatpalNHL(apiKey);
          break;
        case 'formula1':
          data = await fetchStatpalF1(apiKey);
          break;
        case 'golf':
          data = await fetchStatpalGolf(apiKey);
          break;
        case 'horse-racing':
          data = await fetchStatpalHorseRacing(apiKey);
          break;
        default:
          data = [];
          break;
      }
      sportEventsCache.set(key, { expiresAt: Date.now() + ttlMs, data });
      return data;
    } finally {
      sportEventsInflight.delete(key);
    }
  })();

  sportEventsInflight.set(key, p);
  return p;
}

function normalizeSport(input: string): string {
  const s = String(input || '').trim().toLowerCase();
  if (!s) return 'soccer';
  if (s === 'football') return 'soccer';
  if (s === 'hockey') return 'ice-hockey';
  if (s === 'icehockey') return 'ice-hockey';
  if (s === 'nhl') return 'ice-hockey';
  if (s === 'formula-1') return 'formula1';
  if (s === 'nfl') return 'american-football';
  if (s === 'american_football') return 'american-football';
  if (s === 'american football') return 'american-football';
  if (s === 'nba') return 'basketball';
  if (s === 'mlb') return 'baseball';
  if (s === 'esports' || s === 'e-sports' || s === 'e-sport' || s === 'esport' || s === 'gaming') return 'esports';
  if (s === 'horse racing' || s === 'horseracing') return 'horse-racing';
  return s;
}

function json(res: any, statusCode: number, body: any) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (!res.getHeader?.('Cache-Control')) res.setHeader('Cache-Control', 'no-store');
  res.statusCode = statusCode;
  res.end(JSON.stringify(body));
}

function parseGoalsFromScore(score: any): { home: number; away: number } | null {
  if (score == null) return null;
  if (typeof score === 'object') {
    const h = (score as any).home;
    const a = (score as any).away;
    if (h != null && a != null) {
      const hn = Number(h);
      const an = Number(a);
      if (Number.isFinite(hn) && Number.isFinite(an)) return { home: hn, away: an };
    }
    return null;
  }
  const s = String(score || '').trim();
  if (!s) return null;
  if (s.includes('{') || s.includes(':')) {
    try {
      const j = JSON.parse(s);
      const hn = Number(j?.home);
      const an = Number(j?.away);
      if (Number.isFinite(hn) && Number.isFinite(an)) return { home: hn, away: an };
    } catch {
      return null;
    }
  }
  const m = s.match(/^(\d+)\s*[-:]\s*(\d+)$/);
  if (!m) return null;
  return { home: Number(m[1]), away: Number(m[2]) };
}

function marketsObjectToArray(obj: any): any[] {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return [];
  const out: any[] = [];
  for (const [key, v] of Object.entries(obj)) {
    const k = String(key || '').trim();
    if (!k) continue;
    const selections = Array.isArray(v) ? v : [];
    out.push({
      id: `mkt_${k}`,
      key: k,
      name: k,
      selections,
    });
  }
  return out;
}

function parseMarketsValue(markets: any): any[] {
  if (!markets) return null;
  if (Array.isArray(markets)) return markets;
  if (typeof markets === 'object') return marketsObjectToArray(markets);
  if (typeof markets === 'string') {
    const s = markets.trim();
    if (!s) return null;
    try {
      const j = JSON.parse(s);
      if (!j) return null;
      if (Array.isArray(j)) return j;
      if (typeof j === 'object') return marketsObjectToArray(j);
      return null;
    } catch {
      return null;
    }
  }
  return null;
}

function toMarketsObject(input: any): Record<string, any[]> {
  const out: Record<string, any[]> = {};
  if (!input) return out;
  if (Array.isArray(input)) {
    for (const m of input) {
      const key = String(m?.key || '').trim() || String(m?.id || '').trim();
      if (!key) continue;
      const sels = Array.isArray(m?.selections) ? m.selections : Array.isArray(m?.outcomes) ? m.outcomes : [];
      out[key] = sels;
    }
    return out;
  }
  if (typeof input === 'object') {
    return input as Record<string, any[]>;
  }
  if (typeof input === 'string') {
    const s = input.trim();
    if (!s) return out;
    try {
      const j = JSON.parse(s);
      return toMarketsObject(j);
    } catch {
      return out;
    }
  }
  return out;
}

function withStableId(event: any): any {
  const ext = String(event?.external_event_id || '').trim();
  const raw = ext ? ext.split('_').slice(-1)[0] : String(event?.id || '').trim();
  const numeric = /^\d+$/.test(raw) ? Number(raw) : null;
  const id = numeric != null ? numeric : (event?.id ?? ext);

  const home = String(event?.home_team || '').trim();
  const away = String(event?.away_team || '').trim();
  const match = String(event?.match || event?.team_match || (home && away ? `${home} vs ${away}` : '')).trim();

  const goals = parseGoalsFromScore(event?.goals) || parseGoalsFromScore(event?.score);
  const marketsVal = parseMarketsValue(event?.markets);
  const marketsArr = Array.isArray(marketsVal) ? marketsVal : [];

  const sport = normalizeSport(String(event?.sport || ''));
  const isTwoWaySport = new Set([
    'basketball',
    'tennis',
    'american-football',
    'baseball',
    'mma',
    'volleyball',
    'handball',
    'ice-hockey',
    'cricket',
    'golf',
    'formula1',
    'horse-racing',
  ]).has(sport);

  const h = Number(event?.home_odd || 0);
  const d = Number(event?.draw_odd || 0);
  const a = Number(event?.away_odd || 0);
  const hasAnyPrimary = h > 1 || a > 1 || d > 1;
  const hasH2h = marketsArr.some((m: any) => String(m?.key || '').toLowerCase() === 'h2h');

  const outMarkets = (() => {
    if (!hasAnyPrimary) return marketsArr;
    if (hasH2h) return marketsArr;

    const selections: any[] = [];
    if (h > 1) selections.push({ id: 'sel_home', label: 'Casa', name: 'Casa', odd: h, price: h });
    if (!isTwoWaySport && d > 1) selections.push({ id: 'sel_draw', label: 'Empate', name: 'Empate', odd: d, price: d });
    if (a > 1) selections.push({ id: 'sel_away', label: 'Fora', name: 'Fora', odd: a, price: a });
    if (selections.length < 2) return marketsArr;

    const mkt = {
      id: 'mkt_h2h',
      key: 'h2h',
      name: 'Resultado Final',
      selections,
    };
    return [mkt, ...marketsArr];
  })();

  return {
    ...event,
    id,
    match,
    goals: goals ? { home: goals.home, away: goals.away } : event?.goals,
    markets: outMarkets,
    created_at: event?.created_at || new Date().toISOString(),
  };
}

async function loadBySport(params: {
  sport: string;
  wantsOdds: boolean;
  leagueFilter: string;
  ttlMs: number;
}): Promise<{ live: any[]; pregame: any[] }> {
  const { sport, wantsOdds, leagueFilter, ttlMs } = params;
  const cacheKey = `${sport}|${wantsOdds ? 'odds' : 'noodds'}|${leagueFilter}`;
  const now = Date.now();
  const hit = cache.get(cacheKey);
  if (hit && hit.expiresAt > now) return hit.data;

  const statpalKey = getStatpalKeyFromEnv(process.env as any);
  let events: any[] = [];

  if (statpalKey) {
    if (sport === 'all') {
      events = await fetchAllStatpalCached(statpalKey);
    } else {
      events = await fetchSportStatpalCached(statpalKey, sport, ttlMs);
    }
  }

  if (leagueFilter) {
    const q = leagueFilter.toLowerCase().trim();
    events = events.filter((e: any) => String(e?.league || '').toLowerCase().includes(q));
  }

  const mapped = events.map(withStableId).map((e: any) => {
    const statusRaw = String(e?.status ?? e?.fixture?.status?.short ?? e?.fixture?.status?.long ?? '').toUpperCase().trim();
    const finished = [
      'FT', 'AET', 'PEN', 'FT_PEN',
      'FIN', 'FINAL', 'FINISHED', 'MATCH FINISHED', 'ENDED', 'FIM',
      'PST', 'POST', 'CANC', 'CANCELLED', 'CANCELED',
      'ABD', 'ABANDONED', 'WO', 'AWD', 'AWARDED',
    ].includes(statusRaw);

    if (finished) return e;

    const startRaw = String(e?.event_date || '').trim();
    const startMs = startRaw ? new Date(startRaw).getTime() : 0;
    if (!Number.isFinite(startMs) || startMs <= 0) return e;

    const alreadyLive = Number(e?.is_live || 0) === 1;
    if (alreadyLive) return e;

    const graceMs = 2 * 60 * 1000;
    const maxBackfillMs = 8 * 60 * 60 * 1000;
    if (startMs <= now - graceMs && startMs >= now - maxBackfillMs) {
      return { ...e, is_live: 1, status: statusRaw && statusRaw !== 'NS' ? statusRaw : 'LIVE' };
    }
    return e;
  });

  const blockedSports = new Set(['horse-racing', 'esports']);
  const isFinished = (e: any) => {
    const statusRaw = String(e?.status ?? e?.fixture?.status?.short ?? e?.fixture?.status?.long ?? '').toUpperCase().trim();
    if (!statusRaw) return false;
    return [
      'FT', 'AET', 'PEN', 'FT_PEN',
      'FIN', 'FINAL', 'FINISHED', 'MATCH FINISHED', 'ENDED', 'FIM',
      'PST', 'POST', 'CANC', 'CANCELLED', 'CANCELED',
      'ABD', 'ABANDONED', 'WO', 'AWD', 'AWARDED',
    ].includes(statusRaw);
  };
  const isAllowedSport = (e: any) => !blockedSports.has(normalizeSport(String(e?.sport || '')));
  const isTwoWaySport = (s: string) => new Set([
    'basketball',
    'tennis',
    'american-football',
    'baseball',
    'mma',
    'volleyball',
    'handball',
    'ice-hockey',
    'cricket',
    'golf',
    'formula1',
  ]).has(s);
  const hasPrimaryOdds = (e: any) => {
    const sportKey = normalizeSport(String(e?.sport || ''));
    const twoWay = isTwoWaySport(sportKey);
    const h = Number(e?.home_odd || 0);
    const d = Number(e?.draw_odd || 0);
    const a = Number(e?.away_odd || 0);
    if (h > 1 && a > 1) return true;
    if (!twoWay && h > 1 && d > 1 && a > 1) return true;
    const mk = Array.isArray(e?.markets) ? e.markets : [];
    const h2h = mk.find((m: any) => String(m?.key || '').toLowerCase() === 'h2h');
    const sels = Array.isArray(h2h?.selections) ? h2h.selections : Array.isArray(h2h?.outcomes) ? h2h.outcomes : [];
    const ok = Array.isArray(sels) ? sels.filter((s: any) => Number(s?.odd ?? s?.price ?? 0) > 1).length : 0;
    return ok >= (twoWay ? 2 : 3);
  };

  const cleaned = mapped.filter((e: any) => isAllowedSport(e) && !isFinished(e));
  const live = cleaned
    .filter((e: any) => Number(e?.is_live || 0) === 1)
    .filter((e: any) => hasPrimaryOdds(e));
  let pregame = cleaned.filter((e: any) => Number(e?.is_live || 0) !== 1);

  if (wantsOdds) {
    pregame = pregame.filter((e: any) => hasPrimaryOdds(e));
  }

  const data = { live, pregame };
  cache.set(cacheKey, { expiresAt: now + ttlMs, data });
  return data;
}

export default async function handler(req: any, res: any) {
  if (String(req?.method || 'GET').toUpperCase() !== 'GET') {
    json(res, 405, { error: 'Method not allowed' });
    return;
  }

  const url = new URL(String(req?.url || '/'), 'http://localhost');
  const slug = String(url.searchParams.get('slug') || '').replace(/^\/+/, '');
  const realtime = String(url.searchParams.get('realtime') || '0') === '1';

  if (slug === 'statpal-debug') {
    const statpalKey = getStatpalKeyFromEnv(process.env as any);
    if (!statpalKey) {
      json(res, 200, { ok: false, error: 'Missing STATPAL key in env' });
      return;
    }

    const redact = (u: string) => u.replace(/access_key=[^&]+/g, 'access_key=REDACTED');
    const safeFetch = async (u: string) => {
      const resp = await fetch(u);
      const text = await resp.text().catch(() => '');
      let parsed: any = null;
      try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
      const prematchLeague = parsed?.prematch_odds?.league;
      const prematchMatches = prematchLeague?.match;
      const prematchMatchCount = Array.isArray(prematchMatches) ? prematchMatches.length : prematchMatches ? 1 : 0;
      return {
        ok: resp.ok,
        status: resp.status,
        url: redact(u),
        bytes: text.length,
        keys: parsed && typeof parsed === 'object' ? Object.keys(parsed).slice(0, 20) : [],
        prematchMatchCount,
        sample: String(text || '').slice(0, 400),
      };
    };

    const v1Url = `${STATPAL_V1}/soccer/livescores?access_key=${encodeURIComponent(statpalKey)}`;
    const v2LiveUrl = `${STATPAL_V2}/soccer/odds/live?access_key=${encodeURIComponent(statpalKey)}`;
    const candidates = [
      `${STATPAL_V2}/soccer/odds/pregame?access_key=${encodeURIComponent(statpalKey)}`,
      `${STATPAL_V2}/soccer/odds/prematch?access_key=${encodeURIComponent(statpalKey)}`,
      `${STATPAL_V2}/soccer/odds/pre-match?access_key=${encodeURIComponent(statpalKey)}`,
      `${STATPAL_V2}/soccer/odds/upcoming?access_key=${encodeURIComponent(statpalKey)}`,
      `${STATPAL_V2}/soccer/odds?type=pregame&access_key=${encodeURIComponent(statpalKey)}`,
      `${STATPAL_V2}/soccer/odds?type=prematch&access_key=${encodeURIComponent(statpalKey)}`,
      `${STATPAL_V2}/soccer/odds?type=upcoming&access_key=${encodeURIComponent(statpalKey)}`,
      `${STATPAL_V2}/soccer/odds?access_key=${encodeURIComponent(statpalKey)}`,
    ];

    const now = Date.now();
    if (statpalDebugCache && statpalDebugCache.expiresAt > now) {
      json(res, 200, { ok: true, cached: true, ...statpalDebugCache.payload });
      return;
    }

    const v1 = await safeFetch(v1Url);
    const userRequestCount = await safeFetch(`https://statpal.io/api/user-request-count?access_key=${encodeURIComponent(statpalKey)}`);
    const soccerRegion = String(url.searchParams.get('soccerRegion') || 'africa').trim();
    const soccerLeagueSlug = String(url.searchParams.get('soccerLeagueSlug') || 'afc_champleague').trim();
    const v1SoccerExtraProbes = {
      daily_d0: await safeFetch(`${STATPAL_V1}/soccer/daily/d0?access_key=${encodeURIComponent(statpalKey)}`),
      daily_d1: await safeFetch(`${STATPAL_V1}/soccer/daily/d1?access_key=${encodeURIComponent(statpalKey)}`),
      daily_d_minus7: await safeFetch(`${STATPAL_V1}/soccer/daily/d-7?access_key=${encodeURIComponent(statpalKey)}`),
      upcoming_schedule_by_region: await safeFetch(
        `${STATPAL_V1}/soccer/upcoming-schedule/${encodeURIComponent(soccerRegion)}?access_key=${encodeURIComponent(statpalKey)}`,
      ),
      extended_schedule_by_region: await safeFetch(
        `${STATPAL_V1}/soccer/extended-schedule/${encodeURIComponent(soccerRegion)}?access_key=${encodeURIComponent(statpalKey)}`,
      ),
      results_by_region: await safeFetch(
        `${STATPAL_V1}/soccer/results/${encodeURIComponent(soccerRegion)}?access_key=${encodeURIComponent(statpalKey)}`,
      ),
      standings_by_region: await safeFetch(
        `${STATPAL_V1}/soccer/standings/${encodeURIComponent(soccerRegion)}?access_key=${encodeURIComponent(statpalKey)}`,
      ),
      scoring_leaders_by_region: await safeFetch(
        `${STATPAL_V1}/soccer/scoring-leaders/${encodeURIComponent(soccerRegion)}?access_key=${encodeURIComponent(statpalKey)}`,
      ),
      injuries: await safeFetch(
        `${STATPAL_V1}/soccer/injuries?access_key=${encodeURIComponent(statpalKey)}`,
      ),
      odds_by_region: await safeFetch(
        `${STATPAL_V1}/soccer/odds/${encodeURIComponent(soccerRegion)}?access_key=${encodeURIComponent(statpalKey)}`,
      ),
      live_match_stats_by_league: await safeFetch(
        `${STATPAL_V1}/soccer/live-match-stats/${encodeURIComponent(soccerLeagueSlug)}?access_key=${encodeURIComponent(statpalKey)}`,
      ),
    };
    const v2Live = await safeFetch(v2LiveUrl);
    const v2PregameResults = [];
    for (const u of candidates) {
      const r = await safeFetch(u);
      v2PregameResults.push(r);
      if (r.ok) break;
    }

    const leaguePrematchProbes: any[] = [];
    const leagueDataProbes: any[] = [];
    try {
      const res = await fetch(v1Url);
      if (res.ok) {
        const j: any = await res.json().catch(() => null);
        const liveLids = Array.from(
          new Set(
            asArray(j?.livescore?.league)
              .map((l: any) => String(l?.id || l?.league_id || '').trim())
              .filter(Boolean),
          ),
        ).slice(0, 3);
        const fromQuery = String(url.searchParams.get('leagueId') || '').trim();
        const probeLids = Array.from(new Set([fromQuery, ...liveLids].filter(Boolean))).slice(0, 3);

        for (const lid of probeLids) {
          const u = `${STATPAL_V2}/soccer/leagues/${encodeURIComponent(lid)}/odds/prematch?access_key=${encodeURIComponent(statpalKey)}`;
          leaguePrematchProbes.push({ leagueId: lid, ...(await safeFetch(u)) });
          const matchesUrl = `${STATPAL_V2}/soccer/leagues/${encodeURIComponent(lid)}/matches?access_key=${encodeURIComponent(statpalKey)}`;
          const matchStatsUrl = `${STATPAL_V2}/soccer/leagues/${encodeURIComponent(lid)}/matches/stats?access_key=${encodeURIComponent(statpalKey)}`;
          const standingsUrl = `${STATPAL_V2}/soccer/leagues/${encodeURIComponent(lid)}/standings?access_key=${encodeURIComponent(statpalKey)}`;
          const leagueStatsUrl = `${STATPAL_V2}/soccer/leagues/${encodeURIComponent(lid)}/stats?access_key=${encodeURIComponent(statpalKey)}`;
          leagueDataProbes.push({
            leagueId: lid,
            matches: await safeFetch(matchesUrl),
            matchStats: await safeFetch(matchStatsUrl),
            standings: await safeFetch(standingsUrl),
            leagueStats: await safeFetch(leagueStatsUrl),
          });
        }
      }
    } catch {
      leaguePrematchProbes.push({ error: 'probe_failed' });
      leagueDataProbes.push({ error: 'probe_failed' });
    }

    const v2EntityProbes = {
      player: await safeFetch(`${STATPAL_V2}/soccer/players/2773317?access_key=${encodeURIComponent(statpalKey)}`),
      team: await safeFetch(`${STATPAL_V2}/soccer/teams/2340899?access_key=${encodeURIComponent(statpalKey)}`),
      injuries_suspensions: await safeFetch(`${STATPAL_V2}/soccer/injuries-suspensions?access_key=${encodeURIComponent(statpalKey)}`),
    };

    const tennisTournamentId = String(url.searchParams.get('tournamentId') || '22697').trim();
    const v1TennisProbes = {
      livescores: await safeFetch(`${STATPAL_V1}/tennis/livescores?access_key=${encodeURIComponent(statpalKey)}`),
      livestats: await safeFetch(`${STATPAL_V1}/tennis/livestats?access_key=${encodeURIComponent(statpalKey)}`),
      daily_d0: await safeFetch(`${STATPAL_V1}/tennis/daily/d0?access_key=${encodeURIComponent(statpalKey)}`),
      daily_d1: await safeFetch(`${STATPAL_V1}/tennis/daily/d1?access_key=${encodeURIComponent(statpalKey)}`),
      daily_d_minus1: await safeFetch(`${STATPAL_V1}/tennis/daily/d-1?access_key=${encodeURIComponent(statpalKey)}`),
      tournament_list_atp: await safeFetch(`${STATPAL_V1}/tennis/tournament-list/atp?access_key=${encodeURIComponent(statpalKey)}`),
      standings_atp: await safeFetch(`${STATPAL_V1}/tennis/standings/atp?access_key=${encodeURIComponent(statpalKey)}`),
      odds: await safeFetch(`${STATPAL_V1}/tennis/odds?access_key=${encodeURIComponent(statpalKey)}`),
      tournament_by_id: await safeFetch(`${STATPAL_V1}/tennis/tournament/${encodeURIComponent(tennisTournamentId)}?access_key=${encodeURIComponent(statpalKey)}`),
    };

    const v1HorseRacingProbes = {
      live_uk: await safeFetch(`${STATPAL_V1}/horse-racing/live/uk?access_key=${encodeURIComponent(statpalKey)}`),
      schedule_uk: await safeFetch(`${STATPAL_V1}/horse-racing/schedule/uk?access_key=${encodeURIComponent(statpalKey)}`),
    };

    const v1GolfProbes = {
      livescores: await safeFetch(`${STATPAL_V1}/golf/livescores?access_key=${encodeURIComponent(statpalKey)}`),
      schedule: await safeFetch(`${STATPAL_V1}/golf/schedule?access_key=${encodeURIComponent(statpalKey)}`),
    };

    const volleyballLeagueId = String(url.searchParams.get('volleyballLeagueId') || '4390').trim();
    const v1VolleyballProbes = {
      livescores: await safeFetch(`${STATPAL_V1}/volleyball/livescores?access_key=${encodeURIComponent(statpalKey)}`),
      daily_d0: await safeFetch(`${STATPAL_V1}/volleyball/daily/d0?access_key=${encodeURIComponent(statpalKey)}`),
      daily_d1: await safeFetch(`${STATPAL_V1}/volleyball/daily/d1?access_key=${encodeURIComponent(statpalKey)}`),
      daily_d_minus1: await safeFetch(`${STATPAL_V1}/volleyball/daily/d-1?access_key=${encodeURIComponent(statpalKey)}`),
      odds: await safeFetch(`${STATPAL_V1}/volleyball/odds?access_key=${encodeURIComponent(statpalKey)}`),
      season_schedule_by_league: await safeFetch(
        `${STATPAL_V1}/volleyball/season-schedule/${encodeURIComponent(volleyballLeagueId)}?access_key=${encodeURIComponent(statpalKey)}`,
      ),
      standings_by_league: await safeFetch(
        `${STATPAL_V1}/volleyball/standings/${encodeURIComponent(volleyballLeagueId)}?access_key=${encodeURIComponent(statpalKey)}`,
      ),
    };

    const handballLeagueId = String(url.searchParams.get('handballLeagueId') || '4365').trim();
    const v1HandballProbes = {
      livescores: await safeFetch(`${STATPAL_V1}/handball/livescores?access_key=${encodeURIComponent(statpalKey)}`),
      daily_d0: await safeFetch(`${STATPAL_V1}/handball/daily/d0?access_key=${encodeURIComponent(statpalKey)}`),
      daily_d1: await safeFetch(`${STATPAL_V1}/handball/daily/d1?access_key=${encodeURIComponent(statpalKey)}`),
      daily_d_minus1: await safeFetch(`${STATPAL_V1}/handball/daily/d-1?access_key=${encodeURIComponent(statpalKey)}`),
      odds: await safeFetch(`${STATPAL_V1}/handball/odds?access_key=${encodeURIComponent(statpalKey)}`),
      season_schedule_by_league: await safeFetch(
        `${STATPAL_V1}/handball/season-schedule/${encodeURIComponent(handballLeagueId)}?access_key=${encodeURIComponent(statpalKey)}`,
      ),
      standings_by_league: await safeFetch(
        `${STATPAL_V1}/handball/standings/${encodeURIComponent(handballLeagueId)}?access_key=${encodeURIComponent(statpalKey)}`,
      ),
    };

    const nbaTeam = String(url.searchParams.get('nbaTeam') || 'mem').trim();
    const v1NBAProbes = {
      livescores: await safeFetch(`${STATPAL_V1}/nba/livescores?access_key=${encodeURIComponent(statpalKey)}`),
      daily_d0: await safeFetch(`${STATPAL_V1}/nba/daily/d0?access_key=${encodeURIComponent(statpalKey)}`),
      daily_d1: await safeFetch(`${STATPAL_V1}/nba/daily/d1?access_key=${encodeURIComponent(statpalKey)}`),
      daily_d_minus1: await safeFetch(`${STATPAL_V1}/nba/daily/d-1?access_key=${encodeURIComponent(statpalKey)}`),
      season_schedule: await safeFetch(`${STATPAL_V1}/nba/season-schedule?access_key=${encodeURIComponent(statpalKey)}`),
      standings: await safeFetch(`${STATPAL_V1}/nba/standings?access_key=${encodeURIComponent(statpalKey)}`),
      odds: await safeFetch(`${STATPAL_V1}/nba/odds?access_key=${encodeURIComponent(statpalKey)}`),
      roster_by_team: await safeFetch(`${STATPAL_V1}/nba/rosters/${encodeURIComponent(nbaTeam)}?access_key=${encodeURIComponent(statpalKey)}`),
      team_stats_by_team: await safeFetch(`${STATPAL_V1}/nba/team-stats/${encodeURIComponent(nbaTeam)}?access_key=${encodeURIComponent(statpalKey)}`),
      injuries_by_team: await safeFetch(`${STATPAL_V1}/nba/injuries/${encodeURIComponent(nbaTeam)}?access_key=${encodeURIComponent(statpalKey)}`),
    };

    const mlbTeam = String(url.searchParams.get('mlbTeam') || 'ari').trim();
    const mlbLeagueStat = String(url.searchParams.get('mlbLeagueStat') || 'mlb_player_batting').trim();
    const v1MLBProbes = {
      livescores: await safeFetch(`${STATPAL_V1}/mlb/livescores?access_key=${encodeURIComponent(statpalKey)}`),
      daily_d0: await safeFetch(`${STATPAL_V1}/mlb/daily/d0?access_key=${encodeURIComponent(statpalKey)}`),
      daily_d1: await safeFetch(`${STATPAL_V1}/mlb/daily/d1?access_key=${encodeURIComponent(statpalKey)}`),
      daily_d_minus1: await safeFetch(`${STATPAL_V1}/mlb/daily/d-1?access_key=${encodeURIComponent(statpalKey)}`),
      season_schedule: await safeFetch(`${STATPAL_V1}/mlb/season-schedule?access_key=${encodeURIComponent(statpalKey)}`),
      standings: await safeFetch(`${STATPAL_V1}/mlb/standings?access_key=${encodeURIComponent(statpalKey)}`),
      odds: await safeFetch(`${STATPAL_V1}/mlb/odds?access_key=${encodeURIComponent(statpalKey)}`),
      roster_by_team: await safeFetch(`${STATPAL_V1}/mlb/rosters/${encodeURIComponent(mlbTeam)}?access_key=${encodeURIComponent(statpalKey)}`),
      team_stats_by_team: await safeFetch(`${STATPAL_V1}/mlb/team-stats/${encodeURIComponent(mlbTeam)}?access_key=${encodeURIComponent(statpalKey)}`),
      injuries_by_team: await safeFetch(`${STATPAL_V1}/mlb/injuries/${encodeURIComponent(mlbTeam)}?access_key=${encodeURIComponent(statpalKey)}`),
      league_stats: await safeFetch(
        `${STATPAL_V1}/mlb/league-stats/${encodeURIComponent(mlbLeagueStat)}?access_key=${encodeURIComponent(statpalKey)}`,
      ),
    };

    const nflTeam = String(url.searchParams.get('nflTeam') || 'ari').trim();
    const nflLeagueStat = String(url.searchParams.get('nflLeagueStat') || 'nfl-career').trim();
    const v1NFLProbes = {
      livescores: await safeFetch(`${STATPAL_V1}/nfl/livescores?access_key=${encodeURIComponent(statpalKey)}`),
      live_plays: await safeFetch(`${STATPAL_V1}/nfl/live-plays?access_key=${encodeURIComponent(statpalKey)}`),
      season_schedule: await safeFetch(`${STATPAL_V1}/nfl/season-schedule?access_key=${encodeURIComponent(statpalKey)}`),
      standings: await safeFetch(`${STATPAL_V1}/nfl/standings?access_key=${encodeURIComponent(statpalKey)}`),
      odds: await safeFetch(`${STATPAL_V1}/nfl/odds?access_key=${encodeURIComponent(statpalKey)}`),
      roster_by_team: await safeFetch(`${STATPAL_V1}/nfl/rosters/${encodeURIComponent(nflTeam)}?access_key=${encodeURIComponent(statpalKey)}`),
      injuries_by_team: await safeFetch(`${STATPAL_V1}/nfl/injuries/${encodeURIComponent(nflTeam)}?access_key=${encodeURIComponent(statpalKey)}`),
      team_stats_by_team: await safeFetch(`${STATPAL_V1}/nfl/team-stats/${encodeURIComponent(nflTeam)}?access_key=${encodeURIComponent(statpalKey)}`),
      player_stats_by_team: await safeFetch(`${STATPAL_V1}/nfl/player-stats/${encodeURIComponent(nflTeam)}?access_key=${encodeURIComponent(statpalKey)}`),
      league_stats: await safeFetch(
        `${STATPAL_V1}/nfl/league-stats/${encodeURIComponent(nflLeagueStat)}?access_key=${encodeURIComponent(statpalKey)}`,
      ),
    };

    const nhlTeam = String(url.searchParams.get('nhlTeam') || 'ana').trim();
    const v1NHLProbes = {
      livescores: await safeFetch(`${STATPAL_V1}/nhl/livescores?access_key=${encodeURIComponent(statpalKey)}`),
      daily_d0: await safeFetch(`${STATPAL_V1}/nhl/daily/d0?access_key=${encodeURIComponent(statpalKey)}`),
      daily_d1: await safeFetch(`${STATPAL_V1}/nhl/daily/d1?access_key=${encodeURIComponent(statpalKey)}`),
      daily_d_minus1: await safeFetch(`${STATPAL_V1}/nhl/daily/d-1?access_key=${encodeURIComponent(statpalKey)}`),
      season_schedule: await safeFetch(`${STATPAL_V1}/nhl/season-schedule?access_key=${encodeURIComponent(statpalKey)}`),
      standings: await safeFetch(`${STATPAL_V1}/nhl/standings?access_key=${encodeURIComponent(statpalKey)}`),
      odds: await safeFetch(`${STATPAL_V1}/nhl/odds?access_key=${encodeURIComponent(statpalKey)}`),
      roster_by_team: await safeFetch(`${STATPAL_V1}/nhl/rosters/${encodeURIComponent(nhlTeam)}?access_key=${encodeURIComponent(statpalKey)}`),
      team_stats_by_team: await safeFetch(`${STATPAL_V1}/nhl/team-stats/${encodeURIComponent(nhlTeam)}?access_key=${encodeURIComponent(statpalKey)}`),
      injuries_by_team: await safeFetch(`${STATPAL_V1}/nhl/injuries/${encodeURIComponent(nhlTeam)}?access_key=${encodeURIComponent(statpalKey)}`),
    };

    const v1F1Probes = {
      livescores: await safeFetch(`${STATPAL_V1}/f1/livescores?access_key=${encodeURIComponent(statpalKey)}`),
      schedule: await safeFetch(`${STATPAL_V1}/f1/schedule?access_key=${encodeURIComponent(statpalKey)}`),
      results: await safeFetch(`${STATPAL_V1}/f1/results?access_key=${encodeURIComponent(statpalKey)}`),
      team_standings: await safeFetch(`${STATPAL_V1}/f1/team-standings?access_key=${encodeURIComponent(statpalKey)}`),
      driver_standings: await safeFetch(`${STATPAL_V1}/f1/driver-standings?access_key=${encodeURIComponent(statpalKey)}`),
    };

    const cricketTournamentType = String(url.searchParams.get('cricketTournamentType') || 'intl').trim();
    const cricketTournamentId = String(url.searchParams.get('cricketTournamentId') || '1022').trim();
    const v1CricketProbes = {
      livescores: await safeFetch(`${STATPAL_V1}/cricket/livescores?access_key=${encodeURIComponent(statpalKey)}`),
      upcoming_schedule: await safeFetch(`${STATPAL_V1}/cricket/upcoming-schedule?access_key=${encodeURIComponent(statpalKey)}`),
      tour_list: await safeFetch(`${STATPAL_V1}/cricket/tour-list?access_key=${encodeURIComponent(statpalKey)}`),
      odds: await safeFetch(`${STATPAL_V1}/cricket/odds?access_key=${encodeURIComponent(statpalKey)}`),
      season_schedule_by_tour: await safeFetch(
        `${STATPAL_V1}/cricket/season-schedule/${encodeURIComponent(cricketTournamentType)}/${encodeURIComponent(cricketTournamentId)}?access_key=${encodeURIComponent(statpalKey)}`,
      ),
      tables_by_tour: await safeFetch(
        `${STATPAL_V1}/cricket/tables/${encodeURIComponent(cricketTournamentType)}/${encodeURIComponent(cricketTournamentId)}?access_key=${encodeURIComponent(statpalKey)}`,
      ),
      squads_by_tour: await safeFetch(
        `${STATPAL_V1}/cricket/squads/${encodeURIComponent(cricketTournamentType)}/${encodeURIComponent(cricketTournamentId)}?access_key=${encodeURIComponent(statpalKey)}`,
      ),
    };

    const data = {
      cached: false,
      v1,
      userRequestCount,
      v1SoccerExtraProbes,
      v2Live,
      v2PregameResults,
      leaguePrematchProbes,
      leagueDataProbes,
      v2EntityProbes,
      v1TennisProbes,
      v1HorseRacingProbes,
      v1GolfProbes,
      v1VolleyballProbes,
      v1HandballProbes,
      v1NBAProbes,
      v1MLBProbes,
      v1NFLProbes,
      v1NHLProbes,
      v1F1Probes,
      v1CricketProbes,
      selectedPregameEndpoint: cachedPregameOddsEndpoint,
      selectedPregameCheckedAt: cachedPregameOddsCheckedAt,
    };
    statpalDebugCache = { expiresAt: now + 30_000, payload: data };
    res.setHeader('Cache-Control', 'no-store');
    json(res, 200, { ok: true, ...data });
    return;
  }

  if (slug === 'by-sport' || slug.startsWith('by-sport/')) {
    const rawSport = url.searchParams.get('sports') || url.searchParams.get('sport') || 'soccer';
    const sport = normalizeSport(String(rawSport).split(',')[0] || 'soccer');
    const include = String(url.searchParams.get('include') || '');
    const wantsOdds = include
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .includes('odds');
    const leagueFilter = String(url.searchParams.get('league') || '').trim();

    try {
      if (new Set(['horse-racing', 'esports']).has(sport)) {
        res.setHeader('Cache-Control', realtime ? 's-maxage=1, stale-while-revalidate=2' : 's-maxage=20, stale-while-revalidate=60');
        json(res, 200, { live: [], pregame: [] });
        return;
      }
      const ttlMs = realtime ? 1_000 : 30_000;
      const data = await loadBySport({ sport, wantsOdds, leagueFilter, ttlMs });
      res.setHeader('Cache-Control', realtime ? 's-maxage=1, stale-while-revalidate=2' : 's-maxage=20, stale-while-revalidate=60');
      json(res, 200, data);
    } catch {
      res.setHeader('Cache-Control', realtime ? 's-maxage=1, stale-while-revalidate=2' : 's-maxage=20, stale-while-revalidate=60');
      json(res, 200, { live: [], pregame: [] });
    }
    return;
  }

  const oddsMatch = slug.match(/^([^/]+)\/odds$/);
  if (oddsMatch) {
    const id = oddsMatch[1];
    const base = await loadBySport({ sport: 'all', wantsOdds: true, leagueFilter: '', ttlMs: realtime ? 4_000 : 30_000 });
    const all = [...base.live, ...base.pregame];
    const evt = all.find((e: any) => String(e?.external_event_id || '') === id || String(e?.id || '') === id);
    if (!evt) {
      res.setHeader('Cache-Control', realtime ? 's-maxage=1, stale-while-revalidate=2' : 's-maxage=10, stale-while-revalidate=20');
      json(res, 200, { markets: {} });
      return;
    }
    res.setHeader('Cache-Control', realtime ? 's-maxage=1, stale-while-revalidate=2' : 's-maxage=10, stale-while-revalidate=20');
    json(res, 200, {
      home_odd: Number(evt.home_odd || 0),
      draw_odd: Number(evt.draw_odd || 0),
      away_odd: Number(evt.away_odd || 0),
      markets: toMarketsObject((evt as any).markets),
      updated_at: new Date().toISOString(),
      provider: String(evt.external_event_id || '').startsWith('statpal_') ? 'statpal' : 'api-sports',
    });
    return;
  }

  if (slug) {
    const base = await loadBySport({ sport: 'all', wantsOdds: true, leagueFilter: '', ttlMs: 30_000 });
    const all = [...base.live, ...base.pregame];
    const evt = all.find((e: any) => String(e?.external_event_id || '') === slug || String(e?.id || '') === slug);
    if (!evt) {
      res.setHeader('Cache-Control', 'no-store');
      json(res, 404, { error: 'Not found' });
      return;
    }
    res.setHeader('Cache-Control', 's-maxage=20, stale-while-revalidate=60');
    json(res, 200, evt);
    return;
  }

  res.setHeader('Cache-Control', realtime ? 's-maxage=10, stale-while-revalidate=20' : 's-maxage=20, stale-while-revalidate=60');
  json(res, 200, { live: [], pregame: [] });
}
