let cached: { expiresAt: number; data: any[] } | null = null;

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
  if (s === 'ht' || s === 'halftime' || s === 'half time') return 45;
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
  const markets: any[] = [];
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
      markets.push({
        id: 'mkt_h2h',
        key: 'h2h',
        name: 'Resultado Final',
        selections: [
          { id: 'sel_home', label: 'Casa', name: 'Casa', odd: home_odd },
          { id: 'sel_draw', label: 'Empate', name: 'Empate', odd: draw_odd },
          { id: 'sel_away', label: 'Fora', name: 'Fora', odd: away_odd },
        ],
      });
    }
    break;
  }

  for (const k of Object.keys(oddsObj)) {
    const mk = oddsObj[k];
    if (String(mk?.market_id) !== MK_MATCH_GOALS) continue;
    if (String(mk?.suspended) === '1') break;
    const picked = pickPrimaryTotalsLine(asArray(mk?.lines));
    if (picked) {
      markets.push({
        id: 'mkt_totals',
        key: 'totals',
        name: 'Total de Golos',
        line: picked.line,
        selections: [
          { label: `Mais ${picked.line}`, name: 'over', odd: picked.over },
          { label: `Menos ${picked.line}`, name: 'under', odd: picked.under },
        ],
      });
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
      markets.push({
        id: 'mkt_btts',
        key: 'btts',
        name: 'Ambas Equipas Marcam',
        selections: [
          { label: 'Sim', name: 'yes', odd: yes },
          { label: 'Não', name: 'no', odd: no },
        ],
      });
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
    markets_json: markets.length > 0 ? JSON.stringify(markets) : '',
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

  const markets: any[] = [];
  if (home > 1 && away > 1) {
    markets.push({
      id: 'mkt_h2h',
      key: 'h2h',
      name: 'Resultado Final',
      selections: [
        { id: 'sel_home', label: 'Casa', name: 'Casa', odd: home },
        { id: 'sel_draw', label: 'Empate', name: 'Empate', odd: draw },
        { id: 'sel_away', label: 'Fora', name: 'Fora', odd: away },
      ],
    });
  }

  return {
    home_odd: home,
    draw_odd: draw,
    away_odd: away,
    markets_json: markets.length > 0 ? JSON.stringify(markets) : '',
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
        ]
          .map((x) => String(x || '').trim())
          .filter(Boolean);
        for (const id of ids) {
          if (!map.has(id)) map.set(id, parsed);
        }
      }
      cachedPregameOddsEndpoint = url;
      cachedPregameOddsCheckedAt = Date.now();
      return map;
    } catch {
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

  const ids = [m?.main_id, m?.fallback_id_1, m?.fallback_id_2, m?.fallback_id_3]
    .map((x: any) => String(x || '').trim())
    .filter(Boolean);

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
  const [livescoresRes, liveOddsMap] = await Promise.all([
    fetch(`${STATPAL_V1}/soccer/livescores?access_key=${encodeURIComponent(apiKey)}`),
    fetchStatpalLiveOddsV2(apiKey),
  ]);

  if (!livescoresRes.ok) return [];
  const json: any = await livescoresRes.json().catch(() => null);
  const leagues = asArray(json?.livescore?.league);
  const leagueIds = leagues
    .map((l: any) => String(l?.id || l?.league_id || l?.leagueId || '').trim())
    .filter(Boolean);

  const [pregameOddsMap, prematchIndex, v2IdsIndex] = await Promise.all([
    fetchStatpalPregameOddsV2(apiKey),
    fetchStatpalPrematchOddsByLeaguesV2(apiKey, leagueIds),
    fetchStatpalV2MatchIdsIndex(apiKey, leagueIds),
  ]);
  const out: any[] = [];

  for (const league of leagues) {
    const leagueName = String(league?.name || '').trim();
    const country = String(league?.country || '').trim();
    const leagueId = String(league?.id || league?.league_id || league?.leagueId || '').trim();
    const matches = asArray(league?.match);

    for (const m of matches) {
      const id = String(m?.id || m?.alternate_id || '').trim();
      if (!id) continue;
      const altId = String(m?.alternate_id || '').trim();
      const home = String(m?.home?.name || '').trim();
      const away = String(m?.away?.name || '').trim();
      if (!home || !away) continue;

      const status = String(m?.status || '').trim();
      const statusLc = status.toLowerCase().trim();
      const finished = isFinished(status);
      const live = isLive(status);

      const homeGoalsRaw = m?.home?.goals;
      const awayGoalsRaw = m?.away?.goals;
      const homeGoals = (homeGoalsRaw === null || homeGoalsRaw === undefined) ? null : Number(homeGoalsRaw);
      const awayGoals = (awayGoalsRaw === null || awayGoalsRaw === undefined) ? null : Number(awayGoalsRaw);
      let scoreJson =
        live || finished
          ? JSON.stringify({
              home: Number.isFinite(Number(homeGoals)) ? Number(homeGoals) : null,
              away: Number.isFinite(Number(awayGoals)) ? Number(awayGoals) : null,
            })
          : '{"home":null,"away":null}';
      let minute = live ? minuteFromStatus(status) : 0;
      let timerLabel =
        (statusLc === 'ht' || statusLc === 'halftime' || statusLc === 'half time')
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
      const candidates = Array.from(new Set([id, altId, ...extraIds].filter(Boolean)));

      let real: ParsedOdds | undefined;
      for (const candidate of candidates) {
        if (live && liveOddsMap.has(candidate)) { real = liveOddsMap.get(candidate); break; }
        if (!live && prematchIndex.byId.has(candidate)) { real = prematchIndex.byId.get(candidate); break; }
        if (!live && pregameOddsMap.has(candidate)) { real = pregameOddsMap.get(candidate); break; }
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

      out.push({
        id: /^\d+$/.test(id) ? Number(id) : id,
        external_event_id: `statpal_soccer_${id}`,
        sport: 'soccer',
        league: leagueName,
        home_team: home,
        away_team: away,
        match: `${home} vs ${away}`,
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
        goals: (live || finished) ? { home: homeGoals, away: awayGoals } : undefined,
        markets: (() => {
          if (!marketsJson) return [];
          try {
            const j = JSON.parse(marketsJson);
            return Array.isArray(j) ? j : [];
          } catch {
            return [];
          }
        })(),
        country,
        home_team_logo: '',
        away_team_logo: '',
        created_at: new Date().toISOString(),
      });
    }
  }

  return out;
}

function getStatpalKeyFromEnv(env: any): string | null {
  const v =
    env?.STATPAL_ACCESS_KEY ||
    env?.STATPAL_KEY ||
    env?.STATPAL_API_KEY ||
    env?.VITE_STATPAL_ACCESS_KEY ||
    env?.VITE_STATPAL_KEY;
  const key = String(v || '').trim();
  return key ? key : null;
}

export default async function handler(_req: any, res: any) {
  try {
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
      res.statusCode = 200;
      res.end(JSON.stringify(cached.data));
      return;
    }

    const statpalKey = getStatpalKeyFromEnv(process.env as any);
    const events = statpalKey ? await fetchStatpalSoccer(statpalKey) : [];

    const notFinished = events.filter((e: any) => String(e?.status || '') !== 'FT');
    const liveFirst = [
      ...notFinished.filter((e: any) => Number(e?.is_live || 0) === 1),
      ...notFinished.filter((e: any) => Number(e?.is_live || 0) !== 1),
    ]
      .filter((e: any) => Number(e?.is_live || 0) === 1 || (Number(e?.home_odd || 0) > 1 && Number(e?.away_odd || 0) > 1))
      .slice(0, 30);

    cached = { expiresAt: now + 30_000, data: liveFirst };

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
    res.statusCode = 200;
    res.end(JSON.stringify(liveFirst));
  } catch {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.statusCode = 200;
    res.end(JSON.stringify([]));
  }
}
