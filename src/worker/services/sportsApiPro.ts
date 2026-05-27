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

function normalizeSportKey(sport: string): string {
  const raw = String(sport || '').toLowerCase().trim();
  const primary = raw.split(',')[0]?.split('|')[0] ?? '';
  return primary
    .replace(/[_\s]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
}

function toSubdomain(sport: string): string {
  const s = normalizeSportKey(sport);
  if (s === 'football' || s === 'futebol' || s === 'soccer') return 'football';
  if (s === 'hockey' || s === 'icehockey' || s === 'ice-hockey') return 'hockey';
  return s || 'football';
}

function extractEvents(payload: any): any[] {
  if (!payload) return [];
  if (Array.isArray(payload.events)) return payload.events;
  if (Array.isArray(payload.data?.events)) return payload.data.events;
  const tournaments = payload.data?.tournaments ?? payload.tournaments;
  if (Array.isArray(tournaments)) {
    const out: any[] = [];
    for (const t of tournaments) {
      const arr = t?.events ?? t?.matches ?? t?.games ?? [];
      if (Array.isArray(arr)) out.push(...arr);
    }
    return out;
  }
  return [];
}

function num(v: any): number {
  const n = typeof v === 'string' ? Number(v) : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function pickScore(x: any): number | null {
  if (x == null) return null;
  if (typeof x === 'number') return Number.isFinite(x) ? x : null;
  if (typeof x === 'string') {
    const n = Number(x);
    return Number.isFinite(n) ? n : null;
  }
  const candidates = [x.current, x.display, x.normaltime, x.total];
  for (const c of candidates) {
    const n = typeof c === 'string' ? Number(c) : Number(c);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function isLive(status: any): boolean {
  const s = String(status?.description ?? status?.type ?? status ?? '').toLowerCase();
  if (!s) return false;
  if (s.includes('inprogress') || s.includes('in progress') || s.includes('live')) return true;
  if (s.includes('half') || s.includes('quarter') || s.includes('inning') || s.includes('set')) return true;
  if (s.includes('1st') || s.includes('2nd') || s.includes('3rd') || s.includes('4th')) return true;
  return false;
}

function normalizeEvent(sport: string, e: any): NormalizedEvent | null {
  const id = e?.id != null ? String(e.id) : '';
  if (!id) return null;

  const homeName = String(e?.homeTeam?.name ?? e?.homeTeam ?? '').trim();
  const awayName = String(e?.awayTeam?.name ?? e?.awayTeam ?? '').trim();
  if (!homeName || !awayName) return null;

  const ts = e?.startTimestamp != null ? num(e.startTimestamp) : 0;
  const date = ts > 0 ? new Date(ts * 1000).toISOString() : String(e?.startTime ?? e?.event_date ?? '').trim();
  if (!date) return null;

  const tournament = e?.tournament?.name ?? e?.tournament ?? '';
  const country = e?.tournament?.category?.name ?? e?.category?.name ?? e?.country?.name ?? '';
  const statusRaw = e?.status?.description ?? e?.status?.type ?? e?.status ?? e?.statusCode ?? e?.statusText ?? '';
  const status = String(statusRaw || 'NS');
  const live = isLive(e?.status ?? status);

  const hs = pickScore(e?.homeScore);
  const as = pickScore(e?.awayScore);

  return {
    external_event_id: `${sport}_${id}`,
    sport,
    league: String(tournament || ''),
    home_team: homeName,
    away_team: awayName,
    team_match: `${homeName} vs ${awayName}`,
    event_date: date,
    status,
    is_live: live ? 1 : 0,
    home_odd: 0,
    draw_odd: 0,
    away_odd: 0,
    elapsed: 0,
    timer: '',
    score: JSON.stringify({ home: hs, away: as }),
    markets: '{}',
    country: String(country || ''),
    home_team_logo: String(e?.homeTeam?.logo ?? ''),
    away_team_logo: String(e?.awayTeam?.logo ?? ''),
  };
}

async function fetchJson(url: string, apiKey: string): Promise<any | null> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, { headers: apiHeaders(apiKey), signal: controller.signal });
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      if (res.status === 404 && url.includes('/odds')) return null;
      const host = (() => {
        try {
          return new URL(url).host;
        } catch {
          return '';
        }
      })();
      const key = `[sportsApiPro] http:${res.status}:${host}`;
      if (shouldLog(key, 60_000)) {
        console.warn('[sportsApiPro] HTTP error', res.status, url, String(text || '').slice(0, 200));
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
    const key = `[sportsApiPro] fetch:${host}`;
    if (shouldLog(key, 60_000)) {
      console.warn('[sportsApiPro] fetch error', url, String(e?.message || e));
    }
    return null;
  } finally {
    clearTimeout(t);
  }
}

function extractMarkets(payload: any): any[] {
  const direct = payload?.markets ?? payload?.data?.markets ?? null;
  if (Array.isArray(direct)) return direct;
  const odds = payload?.odds ?? payload?.data?.odds ?? null;
  if (Array.isArray(odds)) return odds;
  const provider = payload?.providerOdds ?? payload?.data?.providerOdds ?? null;
  if (Array.isArray(provider?.markets)) return provider.markets;
  return [];
}

function collectChoiceMarkets(payload: any): any[] {
  const out: any[] = [];
  const seen = new Set<any>();

  const walk = (node: any) => {
    if (!node || typeof node !== 'object') return;
    if (seen.has(node)) return;
    seen.add(node);

    if (Array.isArray((node as any).choices) && ((node as any).marketGroup || (node as any).marketName || (node as any).marketPeriod)) {
      out.push(node);
      return;
    }

    if (Array.isArray(node)) {
      for (const it of node) walk(it);
      return;
    }

    for (const v of Object.values(node)) walk(v);
  };

  walk(payload);
  return out;
}

function normalizeOutcomeName(x: any): string {
  return String(x ?? '').trim().toLowerCase();
}

function normalizeTeamKey(name: string): string {
  return String(name || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function parseOdd(x: any): number {
  const n = typeof x === 'string' ? Number(x) : Number(x);
  return Number.isFinite(n) ? n : 0;
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

  if (n.includes('ht/ft') || n.includes('half time/full time') || n.includes('halftime/fulltime')) return 'ht_ft';
  if (n.includes('double chance')) return 'double_chance';
  if (n.includes('draw no bet') || n.includes('dnb') || n.includes('empate anula')) return 'dnb';
  if (n.includes('both teams to score') || n.includes('btts') || n.includes('ambas marcam')) return 'btts';
  if (n.includes('correct score') || n.includes('placar exato') || n.includes('score exact')) return 'correct_score';

  const hasFirstHalf = n.includes('1st half') || n.includes('first half') || n.includes('1h') || n.includes('1º tempo') || n.includes('1o tempo');
  const hasSecondHalf = n.includes('2nd half') || n.includes('second half') || n.includes('2h') || n.includes('2º tempo') || n.includes('2o tempo');

  const isTotals = n.includes('total') || n.includes('over/under') || n.includes('goals') || n.includes('points');
  const isHandicap = n.includes('asian handicap') || n.includes('handicap') || n.includes('spread') || n.includes('run line') || n.includes('puck line');

  if (hasFirstHalf && isTotals) return 'first_half_totals';
  if (hasSecondHalf && isTotals) return 'second_half_totals';
  if (hasFirstHalf && isHandicap) return 'first_half_handicap';
  if (hasSecondHalf && isHandicap) return 'second_half_handicap';
  if (hasFirstHalf && (n.includes('result') || n.includes('winner') || n.includes('1x2'))) return 'first_half_h2h';
  if (hasSecondHalf && (n.includes('result') || n.includes('winner') || n.includes('1x2'))) return 'second_half_h2h';

  if (n.includes('team total') || n.includes('team totals')) return 'team_totals';
  if (isTotals) return n.includes('alternate') || n.includes('alt') ? 'alternate_totals' : 'totals';

  if (n.includes('asian handicap')) return 'spreads';
  if (isHandicap) return 'handicap';

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

function pickPoint(market: any, outcome: any): string | null {
  const raw =
    outcome?.point ??
    outcome?.handicap ??
    outcome?.line ??
    outcome?.total ??
    outcome?.spread ??
    market?.handicap ??
    market?.point ??
    market?.line ??
    market?.total ??
    market?.spread ??
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
  if (isHandicap) return `${base} ${point}`;
  return base;
}

export async function fetchSportsApiProMatchOdds(
  apiKey: string,
  sport: string,
  matchId: string,
  opts?: { scope?: 'featured' | 'all'; provider?: number; homeTeam?: string; awayTeam?: string }
): Promise<{ home: number; draw: number; away: number; markets: Record<string, any[]> } | null> {
  const sub = toSubdomain(sport);
  const scope = opts?.scope ?? 'all';
  const provider = opts?.provider ?? 1;
  const url = `https://v2.${sub}.sportsapipro.com/api/match/${encodeURIComponent(matchId)}/odds?scope=${encodeURIComponent(scope)}&provider=${encodeURIComponent(String(provider))}`;
  const json = await fetchJson(url, apiKey);
  if (!json) return null;

  const markets = extractMarkets(json);
  const choiceMarkets = markets.length ? [] : collectChoiceMarkets(json);
  if (!markets.length && !choiceMarkets.length) return null;

  let home = 0;
  let draw = 0;
  let away = 0;

  const outMarkets: Record<string, any[]> = {};
  let anyOdd = false;

  const append = (marketName: string, marketNode: any, outcomes: any[]) => {
    const key = marketKeyFromLineName(marketName);
    if (!key || !outcomes.length) return;
    const arr = outMarkets[key] || (outMarkets[key] = []);
    for (const o of outcomes) {
      const rawName = o?.name ?? o?.label ?? o?.outcome ?? o?.value ?? '';
      const point = pickPoint(marketNode, o);
      const value = formatSelectionName(key, String(rawName || ''), point);
      const odd = parseOddDecimal(o?.odd ?? o?.price ?? o?.fractionalValue ?? o?.decimalValue ?? o?.value);
      if (!(odd > 1) || !value) continue;
      anyOdd = true;
      if (point) arr.push({ value, odd, point });
      else arr.push({ value, odd });
    }
  };

  for (const m of markets) {
    const mName = String(m?.name ?? m?.marketName ?? m?.key ?? '').trim();
    const outcomes = Array.isArray(m?.outcomes) ? m.outcomes : (Array.isArray(m?.selections) ? m.selections : []);
    append(mName, m, outcomes);
  }

  for (const m of choiceMarkets) {
    const period = String(m?.marketPeriod ?? '').trim();
    const group = String(m?.marketGroup ?? m?.marketName ?? '').trim();
    const marketName = [period, group].filter(Boolean).join(' ');
    const outcomes = Array.isArray(m?.choices) ? m.choices : [];
    append(marketName, m, outcomes);
  }

  const homeKey = normalizeTeamKey(String(opts?.homeTeam || ''));
  const awayKey = normalizeTeamKey(String(opts?.awayTeam || ''));
  const h2h = outMarkets.h2h || [];
  for (const s of h2h) {
    const n = normalizeOutcomeName(s?.value);
    const odd = parseOddDecimal(s?.odd);
    if (!(odd > 1)) continue;
    const nk = normalizeTeamKey(String(s?.value || ''));
    if (n === '1' || n === 'home' || (homeKey && nk && (nk === homeKey || nk.includes(homeKey) || homeKey.includes(nk)))) home = home || odd;
    else if (n === '2' || n === 'away' || (awayKey && nk && (nk === awayKey || nk.includes(awayKey) || awayKey.includes(nk)))) away = away || odd;
    else if (n === 'x' || n === 'draw' || n === 'tie') draw = draw || odd;
  }

  if (!anyOdd) return null;
  return { home, draw, away, markets: outMarkets };
}

export async function fetchSportsApiProLive(apiKey: string, sport: string): Promise<NormalizedEvent[]> {
  const sub = toSubdomain(sport);
  const url = `https://v2.${sub}.sportsapipro.com/api/live`;
  const json = await fetchJson(url, apiKey);
  const items = extractEvents(json);
  const out: NormalizedEvent[] = [];
  for (const e of items) {
    const n = normalizeEvent(sport, e);
    if (n) out.push(n);
  }
  return out;
}

export async function fetchSportsApiProSchedule(apiKey: string, sport: string, date: string): Promise<NormalizedEvent[]> {
  const sub = toSubdomain(sport);
  const url = `https://v2.${sub}.sportsapipro.com/api/schedule/${encodeURIComponent(date)}`;
  const json = await fetchJson(url, apiKey);
  const items = extractEvents(json);
  const out: NormalizedEvent[] = [];
  for (const e of items) {
    const n = normalizeEvent(sport, e);
    if (n) out.push(n);
  }
  return out;
}
