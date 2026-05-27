import { NormalizedEvent } from './sportsApi';

const lastLogAt = new Map<string, number>();

function shouldLog(key: string, ttlMs: number): boolean {
  const now = Date.now();
  const prev = lastLogAt.get(key) || 0;
  if (now - prev < ttlMs) return false;
  lastLogAt.set(key, now);
  return true;
}

function apiHeaders(apiKey: string): HeadersInit {
  return {
    'x-api-key': apiKey,
    'accept': 'application/json',
  };
}

function toSubdomain(sport: string): string {
  const s = String(sport || '').toLowerCase().trim();
  if (s === 'soccer') return 'football';
  if (s === 'ice-hockey') return 'hockey';
  return s;
}

function toSportId(sport: string): number {
  const s = String(sport || '').toLowerCase().trim();
  if (s === 'soccer') return 1;
  if (s === 'basketball') return 2;
  if (s === 'tennis') return 3;
  if (s === 'ice-hockey') return 4;
  return 0;
}

function gameSportId(g: any): number {
  const direct = g?.sportId ?? g?.sport_id ?? g?.sport?.id ?? g?.sport?.sportId;
  const n = typeof direct === 'string' ? Number(direct) : Number(direct);
  return Number.isFinite(n) ? n : 0;
}

function filterBySportId(sport: string, games: any[]): any[] {
  const expected = toSportId(sport);
  if (!expected) return [];
  return games.filter((g) => gameSportId(g) === expected);
}

function extractGames(payload: any): any[] {
  if (!payload) return [];
  if (Array.isArray(payload.games)) return payload.games;
  if (Array.isArray(payload.data?.games)) return payload.data.games;
  if (Array.isArray(payload.data?.scores)) return payload.data.scores;
  return [];
}

function num(v: any): number {
  const n = typeof v === 'string' ? Number(v) : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function isoDate(v: any): string {
  const raw = String(v || '').trim();
  if (!raw) return '';
  const d = new Date(raw);
  return Number.isFinite(d.getTime()) ? d.toISOString() : raw;
}

function extractLines(payload: any): any[] {
  if (!payload) return [];
  const direct = payload?.lines ?? payload?.data?.lines ?? null;
  if (Array.isArray(direct)) return direct;
  const nested = payload?.data?.bets?.lines ?? payload?.bets?.lines ?? null;
  if (Array.isArray(nested)) return nested;
  return [];
}

function parseOddDecimal(x: any): number {
  const raw =
    x?.decimal ??
    x?.dec ??
    x?.value ??
    x?.odd ??
    x?.price ??
    x?.american ??
    x?.us ??
    x?.americanOdds ??
    x;

  if (raw === null || raw === undefined) return 0;

  const toDecimalFromAmerican = (a: number) => {
    if (!Number.isFinite(a) || a === 0) return 0;
    if (a > 0) return 1 + a / 100;
    return 1 + 100 / Math.abs(a);
  };

  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return 0;
    if (raw >= 100 || raw <= -100) return toDecimalFromAmerican(raw);
    return raw > 1 ? raw : 0;
  }

  const s = String(raw).trim();
  if (!s) return 0;

  const frac = s.match(/^([+-]?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
  if (frac) {
    const a = Number(frac[1]);
    const b = Number(frac[2]);
    if (Number.isFinite(a) && Number.isFinite(b) && b !== 0) {
      const dec = 1 + a / b;
      return dec > 1 ? dec : 0;
    }
  }

  const n = Number(s);
  if (!Number.isFinite(n)) return 0;
  if (n >= 100 || n <= -100) return toDecimalFromAmerican(n);
  return n > 1 ? n : 0;
}

function normalizeLineName(x: any): string {
  return String(x ?? '').trim().toLowerCase();
}

function snakeKey(x: string): string {
  return String(x || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+/, '')
    .replace(/_+$/, '');
}

function marketKeyFromLineName(raw: string): string {
  const n = normalizeLineName(raw);
  if (!n) return '';

  const isWinner =
    n.includes('1x2') ||
    n.includes('moneyline') ||
    n.includes('game winner') ||
    n.includes('match winner') ||
    n.includes('full time result') ||
    n.includes('match result') ||
    n.includes('winner') ||
    n === 'result';
  if (isWinner) return 'h2h';

  if (n.includes('double chance')) return 'double_chance';
  if (n.includes('draw no bet') || n.includes('dnb') || n.includes('empate anula')) return 'dnb';
  if (n.includes('both teams to score') || n.includes('btts') || n.includes('ambas marcam')) return 'btts';
  if (n.includes('correct score') || n.includes('placar exato') || n.includes('score exact')) return 'correct_score';

  const hasFirstHalf = n.includes('1st half') || n.includes('first half') || n.includes('1h');
  const hasSecondHalf = n.includes('2nd half') || n.includes('second half') || n.includes('2h');
  if (hasFirstHalf && (n.includes('total') || n.includes('over/under') || n.includes('goals') || n.includes('points'))) return 'first_half_totals';
  if (hasSecondHalf && (n.includes('total') || n.includes('over/under') || n.includes('goals') || n.includes('points'))) return 'second_half_totals';
  if (hasFirstHalf && (n.includes('result') || n.includes('winner') || n.includes('1x2'))) return 'first_half_h2h';
  if (hasSecondHalf && (n.includes('result') || n.includes('winner') || n.includes('1x2'))) return 'second_half_h2h';

  if (n.includes('team total') || n.includes('team totals')) return 'team_totals';

  const isTotals = n.includes('total') || n.includes('over/under') || n.includes('goals') || n.includes('points');
  if (isTotals) return n.includes('alternate') || n.includes('alt') ? 'alternate_totals' : 'totals';

  if (n.includes('asian handicap')) return 'spreads';
  if (n.includes('handicap') || n.includes('spread') || n.includes('run line') || n.includes('puck line')) return 'handicap';

  if (n.includes('corners') && (n.includes('total') || n.includes('over/under'))) return 'corners_totals';
  if (n.includes('cards') && (n.includes('total') || n.includes('over/under'))) return 'cards_totals';

  if (n.includes('set winner') || n === 'set winner') return 'set_winner';
  if (n.includes('first set winner')) return 'first_set_winner';
  if (n.includes('total games')) return 'match_total_games';
  if (n.includes('sets handicap')) return 'sets_handicap';

  if (n.includes('period') && (n.includes('winner') || n.includes('result'))) return 'period_h2h';
  if (n.includes('period') && (n.includes('total') || n.includes('over/under'))) return 'period_totals';

  return snakeKey(n);
}

function pickPoint(line: any, option: any): string | null {
  const raw =
    option?.point ??
    option?.handicap ??
    option?.line ??
    option?.total ??
    option?.spread ??
    line?.handicap ??
    line?.point ??
    line?.line ??
    line?.total ??
    line?.spread ??
    null;
  if (raw == null) return null;
  const s = String(raw).trim();
  return s ? s : null;
}

function formatSelectionName(marketKey: string, optionName: string, point: string | null): string {
  const base = String(optionName || '').trim();
  if (!base) return '';
  if (!point) return base;
  const n = normalizeLineName(base);
  const isTotals = marketKey.includes('total');
  const isHandicap = marketKey.includes('handicap') || marketKey.includes('spread');
  if (isTotals && (n.startsWith('over') || n.startsWith('under') || n.startsWith('o/') || n.startsWith('u/'))) return `${base} ${point}`;
  if (isHandicap && (n === 'home' || n === 'away' || n === '1' || n === '2')) return `${base} ${point}`;
  if (marketKey === 'team_totals' && (n.startsWith('over') || n.startsWith('under') || n.startsWith('o/') || n.startsWith('u/'))) return `${base} ${point}`;
  return base;
}

function parseMarketsFromLines(lines: any[], homeName: string, awayName: string): { home: number; draw: number; away: number; markets: Record<string, any[]> } | null {
  const markets: Record<string, any[]> = {};

  for (const line of lines) {
    const rawName =
      line?.lineType?.title ??
      line?.lineType?.name ??
      line?.lineType?.shortName ??
      line?.lineTypeName ??
      line?.marketName ??
      line?.name ??
      line?.typeName ??
      '';
    const key = marketKeyFromLineName(String(rawName || ''));
    if (!key) continue;

    const options = Array.isArray(line?.options) ? line.options : Array.isArray(line?.outcomes) ? line.outcomes : [];
    if (!options.length) continue;

    const arr = markets[key] || [];
    for (const o of options) {
      const odd = parseOddDecimal(o?.rate ?? o?.odd ?? o?.price ?? o);
      if (!(odd > 1)) continue;
      const numOpt = num(o?.num);
      const rawOpt = String(o?.name ?? o?.label ?? o?.value ?? '').trim();
      const point = pickPoint(line, o);
      const name = formatSelectionName(key, rawOpt, point);
      if (!name) continue;
      const entry: any = {
        outcome: rawOpt || name,
        name,
        label: name,
        odd,
        value: odd,
        price: odd,
        num: numOpt || undefined,
      };
      if (point) {
        entry.point = point;
        entry.handicap = point;
        entry.line = point;
        entry.total = point;
        entry.spread = point;
      }
      arr.push(entry);
    }

    if (arr.length) markets[key] = arr;
  }

  const h2hCandidates = markets.h2h || markets.match_winner || markets['1x2'] || [];
  const h = normalizeLineName(homeName);
  const a = normalizeLineName(awayName);
  let home = 0;
  let draw = 0;
  let away = 0;

  for (const o of h2hCandidates) {
    const numOpt = num(o?.num);
    const oName = normalizeLineName(o?.outcome ?? o?.name ?? o?.label ?? o?.value ?? '');
    const odd = parseOddDecimal(o?.odd ?? o?.price ?? o?.value ?? o);
    if (!(odd > 1)) continue;

    if (numOpt === 1 || oName === 'home' || oName === '1' || (h && (oName === h || h.includes(oName) || oName.includes(h)))) home = home || odd;
    else if (numOpt === 3 || oName === 'away' || oName === '2' || (a && (oName === a || a.includes(oName) || oName.includes(a)))) away = away || odd;
    else if (numOpt === 2) {
      const isDraw = oName === 'draw' || oName === 'x' || oName === 'tie';
      if (isDraw || h2hCandidates.length >= 3) draw = draw || odd;
      else away = away || odd;
    } else if (oName === 'draw' || oName === 'x' || oName === 'tie') draw = draw || odd;
  }

  if (!Object.keys(markets).length) return null;
  return { home, draw, away, markets };
}

function extractOddsFromGame(g: any, homeName: string, awayName: string): { home: number; draw: number; away: number; markets: any } | null {
  const candidates = [
    g?.odds,
    g?.bets,
    g?.betting,
    g?.lines,
    g?.data,
  ];

  for (const c of candidates) {
    const lines = extractLines(c);
    if (!lines.length) continue;
    const parsed = parseMarketsFromLines(lines, homeName, awayName);
    if (parsed) return parsed;
  }

  return null;
}

function normalizeGame(sport: string, g: any): NormalizedEvent | null {
  const id = g?.id != null ? String(g.id) : '';
  if (!id) return null;

  const home = g?.homeCompetitor || {};
  const away = g?.awayCompetitor || {};
  const homeName = String(home?.name || '').trim();
  const awayName = String(away?.name || '').trim();
  if (!homeName || !awayName) return null;

  const startTime = isoDate(g?.startTime);
  if (!startTime) return null;

  const league = String(g?.competitionDisplayName || g?.competition?.name || '').trim();
  const country = String(g?.competition?.country?.name || '').trim();
  const status = String(g?.statusText || '').trim() || 'NS';
  const statusGroup = num(g?.statusGroup);
  const st = status.toLowerCase();
  const finished =
    st.includes('final') ||
    st.includes('ended') ||
    st === 'ft' ||
    st.includes('full time') ||
    st.includes('after') ||
    st.includes('cancel') ||
    st.includes('postpon');
  const liveByText =
    st.includes('live') ||
    st.includes('in play') ||
    st.includes('inplay') ||
    st.includes('half') ||
    st.includes('1st half') ||
    st.includes('2nd half') ||
    st.includes('first half') ||
    st.includes('second half') ||
    st.includes('1h') ||
    st.includes('2h') ||
    st.includes('ht') ||
    st.includes('et') ||
    st.includes('pen') ||
    st.includes('q1') ||
    st.includes('q2') ||
    st.includes('q3') ||
    st.includes('q4') ||
    st.includes('quarter') ||
    st.includes('inning') ||
    st.includes('set');
  const is_live = finished ? 0 : statusGroup === 1 || liveByText ? 1 : 0;

  const hs = home?.score != null ? num(home.score) : null;
  const as = away?.score != null ? num(away.score) : null;

  const odds = extractOddsFromGame(g, homeName, awayName);

  return {
    external_event_id: `${sport}_${id}`,
    sport,
    league,
    home_team: homeName,
    away_team: awayName,
    team_match: `${homeName} vs ${awayName}`,
    event_date: startTime,
    status,
    is_live,
    home_odd: odds?.home ?? 0,
    draw_odd: odds?.draw ?? 0,
    away_odd: odds?.away ?? 0,
    elapsed: 0,
    timer: '',
    score: JSON.stringify({ home: hs, away: as }),
    markets: odds?.markets ? JSON.stringify(odds.markets) : '{}',
    country,
    home_team_logo: String(home?.imageUrl || ''),
    away_team_logo: String(away?.imageUrl || ''),
  };
}

async function fetchJson(url: string, apiKey: string): Promise<any | null> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, { headers: apiHeaders(apiKey), signal: controller.signal });
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      const host = (() => {
        try {
          return new URL(url).host;
        } catch {
          return '';
        }
      })();
      const key = `[sportsApiProV1] http:${res.status}:${host}`;
      if (shouldLog(key, 60_000)) {
        console.warn('[sportsApiProV1] HTTP error', res.status, url, String(text || '').slice(0, 200));
      }
      return null;
    }
    try {
      return text ? JSON.parse(text) : null;
    } catch {
      return null;
    }
  } catch (e: any) {
    const host = (() => {
      try {
        return new URL(url).host;
      } catch {
        return '';
      }
    })();
    const key = `[sportsApiProV1] fetch:${host}`;
    if (shouldLog(key, 60_000)) {
      console.warn('[sportsApiProV1] fetch error', url, String(e?.message || e));
    }
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function fetchFirstOk(urls: string[], apiKey: string): Promise<any | null> {
  for (const u of urls) {
    const out = await fetchJson(u, apiKey);
    if (out) return out;
  }
  return null;
}

export async function fetchSportsApiProV1Live(apiKey: string, sport: string): Promise<NormalizedEvent[]> {
  const sub = toSubdomain(sport);
  const liveUrls =
    sub === 'basketball'
      ? [
          `https://v1.${sub}.sportsapipro.com/games/current?showOdds=true&topBookmaker=14`,
          `https://v1.${sub}.sportsapipro.com/games/current`,
          `https://v1.${sub}.sportsapipro.com/games/allscores`,
        ]
      : [
          `https://v1.${sub}.sportsapipro.com/api/v1/${sub}/live?showOdds=true&topBookmaker=14`,
          `https://v1.${sub}.sportsapipro.com/api/v1/${sub}/live`,
          `https://v1.${sub}.sportsapipro.com/games/current`,
          `https://v1.${sub}.sportsapipro.com/games/allscores`,
        ];
  const json = await fetchFirstOk(
    liveUrls,
    apiKey,
  );
  const games = filterBySportId(sport, extractGames(json));
  const out: NormalizedEvent[] = [];
  for (const g of games) {
    const n = normalizeGame(sport, g);
    if (n) out.push(n);
  }
  return out;
}

export async function fetchSportsApiProV1GamesRange(
  apiKey: string,
  sport: string,
  startDate: string,
  endDate: string,
): Promise<NormalizedEvent[]> {
  const sportId = toSportId(sport);
  if (!sportId) return [];
  const sub = toSubdomain(sport);
  const json = await fetchFirstOk(
    [
      `https://v1.football.sportsapipro.com/api/v1/games?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}&sportId=${encodeURIComponent(String(sportId))}&showOdds=true&topBookmaker=14`,
      `https://v1.football.sportsapipro.com/api/v1/games?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}&sportId=${encodeURIComponent(String(sportId))}`,
      `https://v1.${sub}.sportsapipro.com/api/v1/${sub}/all`,
      `https://v1.${sub}.sportsapipro.com/games/fixtures`,
      `https://v1.${sub}.sportsapipro.com/games/results`,
      `https://v1.${sub}.sportsapipro.com/games/allscores`,
    ],
    apiKey,
  );
  const games = filterBySportId(sport, extractGames(json));
  const out: NormalizedEvent[] = [];
  for (const g of games) {
    const n = normalizeGame(sport, g);
    if (n) out.push(n);
  }
  return out;
}

export async function fetchSportsApiProV1OddsLines(
  apiKey: string,
  sport: string,
  gameId: string,
  opts?: { topBookmaker?: number },
): Promise<{ home: number; draw: number; away: number; markets: Record<string, any[]> } | null> {
  const sub = toSubdomain(sport);
  const topBookmaker = opts?.topBookmaker ?? 14;
  const url = `https://v1.${sub}.sportsapipro.com/bets/lines?gameId=${encodeURIComponent(String(gameId))}&topBookmaker=${encodeURIComponent(String(topBookmaker))}`;
  const json = await fetchJson(url, apiKey);
  if (!json) return null;
  const lines = extractLines(json);
  if (!lines.length) return null;
  const parsed = parseMarketsFromLines(lines, '', '');
  if (!parsed) return null;
  return { home: parsed.home, draw: parsed.draw, away: parsed.away, markets: parsed.markets };
}
