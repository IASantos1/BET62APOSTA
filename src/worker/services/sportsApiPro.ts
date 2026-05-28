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

function statusText(status: any): string {
  return String(status?.description ?? status?.type ?? status ?? '').trim();
}

function statusCode(status: any): number {
  const c = status?.code ?? status?.statusCode ?? status?.status_code ?? null;
  const n = typeof c === 'string' ? Number(c) : Number(c);
  return Number.isFinite(n) ? n : 0;
}

function statusKey(status: any): string {
  return statusText(status)
    .toUpperCase()
    .trim()
    .replace(/[^A-Z0-9_]+/g, '_')
    .replace(/^_+/, '')
    .replace(/_+$/, '');
}

function isFinishedStatus(status: any): boolean {
  const code = statusCode(status);
  if (code >= 100) return true;
  if (code === 60 || code === 70 || code === 80 || code === 90 || code === 110 || code === 120) return true;
  const k = statusKey(status);
  if (!k) return false;
  if (
    k === 'FT' ||
    k === 'FINAL' ||
    k === 'FINISHED' ||
    k === 'ENDED' ||
    k === 'END' ||
    k === 'FULL_TIME' ||
    k === 'MATCH_FINISHED' ||
    k === 'COMPLETED' ||
    k === 'CANCELLED' ||
    k === 'CANCELED' ||
    k === 'POSTPONED' ||
    k === 'SUSPENDED' ||
    k === 'ABANDONED' ||
    k === 'WALKOVER' ||
    k === 'WO'
  ) return true;
  if (/FINISH|ENDED|FINAL|FULLTIME|GAMEOVER|CANCEL|POSTPON|ABANDON|WALKOVER/.test(k)) return true;
  return false;
}

function isNotStartedStatus(status: any): boolean {
  const code = statusCode(status);
  if (code === 0) return true;
  const k = statusKey(status);
  if (!k) return true;
  if (k === 'NS' || k === 'SCHEDULED' || k === 'UPCOMING' || k === 'NOT_STARTED' || k === 'PRE_MATCH') return true;
  if (/NOT_STARTED|SCHEDUL|UPCOMING|TIMED|PRE_MATCH/.test(k)) return true;
  return false;
}

function isLive(status: any): boolean {
  if (isFinishedStatus(status)) return false;
  if (isNotStartedStatus(status)) return false;
  const code = statusCode(status);
  if (code > 0) return true;
  const s = statusText(status).toLowerCase();
  if (!s) return false;
  if (s.includes('inprogress') || s.includes('in progress') || s.includes('live')) return true;
  if (s.includes('half') || s.includes('quarter') || s.includes('inning') || s.includes('set')) return true;
  if (s.includes('1st') || s.includes('2nd') || s.includes('3rd') || s.includes('4th')) return true;
  return false;
}

function normalizeSportKey(sport: string): string {
  const s = String(sport || '').trim().toLowerCase();
  if (s === 'football') return 'soccer';
  if (s === 'futebol') return 'soccer';
  return s;
}

function deriveElapsedAndTimer(sport: string, e: any): { elapsed: number; timer: string } {
  const takeNum = (v: any) => {
    const n = typeof v === 'string' ? Number(v) : Number(v);
    if (!Number.isFinite(n)) return null;
    if (n < 0 || n > 1000) return null;
    return n;
  };
  const takeTimer = (v: any) => {
    const t = String(v ?? '').trim();
    if (!t) return '';
    if (t.length > 16) return '';
    return t;
  };

  const elapsedCandidates = [
    e?.elapsed,
    e?.time?.elapsed,
    e?.time?.minute,
    e?.minute,
    e?.status?.elapsed,
    e?.status?.minute,
    e?.clock?.minute,
    e?.clock?.minutes,
  ];

  let elapsed = 0;
  for (const c of elapsedCandidates) {
    const n = takeNum(c);
    if (n == null || n === 0) continue;
    elapsed = n;
    break;
  }

  const timerCandidates = [
    e?.timer,
    e?.time?.timer,
    e?.clock?.display,
    e?.clock?.time,
    e?.status?.timer,
  ];
  let timer = '';
  for (const c of timerCandidates) {
    const t = takeTimer(c);
    if (!t) continue;
    timer = t;
    break;
  }

  const startTs = num(e?.startTimestamp);
  const st = e?.status ?? e?.statusText ?? e?.statusCode ?? '';
  const statusStr = statusText(st).toLowerCase();
  const key = normalizeSportKey(sport);

  if (elapsed === 0 && startTs > 0 && isLive(statusStr)) {
    const now = Date.now();
    const diffMin = Math.floor((now - startTs * 1000) / 60000);
    if (diffMin > 0 && diffMin < 400) elapsed = diffMin;
  }

  if (!timer && elapsed > 0) {
    if (key === 'soccer') timer = `${elapsed}'`;
    else timer = String(elapsed);
  }

  return { elapsed: Number.isFinite(elapsed) ? elapsed : 0, timer };
}

function extractTennisSets(e: any): Record<string, { home: number | null; away: number | null }> | null {
  const toNumOrNull = (v: any): number | null => {
    const n = typeof v === 'string' ? Number(v) : Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const hs = e?.homeScore;
  const as = e?.awayScore;
  if (!hs || !as || typeof hs !== 'object' || typeof as !== 'object') return null;
  const pairs: Array<{ home: number | null; away: number | null }> = [];
  for (let i = 1; i <= 5; i++) {
    const h = toNumOrNull((hs as any)[`period${i}`]);
    const a = toNumOrNull((as as any)[`period${i}`]);
    if (h !== null || a !== null) pairs.push({ home: h, away: a });
  }
  if (pairs.length === 0) return null;
  const out: Record<string, { home: number | null; away: number | null }> = {};
  for (let i = 0; i < Math.min(5, pairs.length); i++) out[`s${i + 1}`] = pairs[i];
  return out;
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
  const statusObj = e?.status ?? status;
  const live = isLive(statusObj);
  const t = live ? deriveElapsedAndTimer(sport, e) : { elapsed: 0, timer: '' };

  const sKey = normalizeSportKey(sport);
  const tennisSets = sKey.includes('tennis') ? extractTennisSets(e) : null;
  const hs = pickScore(e?.homeScore?.current ?? e?.homeScore) ?? null;
  const as = pickScore(e?.awayScore?.current ?? e?.awayScore) ?? null;

  let tennisSetInPlay = 0;
  if (tennisSets && live) {
    for (let i = 1; i <= 5; i++) {
      const x = (tennisSets as any)[`s${i}`];
      if (!x) continue;
      if (x.home != null || x.away != null) tennisSetInPlay = i;
    }
  }

  return {
    external_event_id: `${sport}_${id}`,
    sport,
    league: String(tournament || ''),
    home_team: homeName,
    away_team: awayName,
    team_match: `${homeName} vs ${awayName}`,
    event_date: date,
    status: tennisSetInPlay ? `SET ${tennisSetInPlay}` : status,
    is_live: live ? 1 : 0,
    home_odd: 0,
    draw_odd: 0,
    away_odd: 0,
    elapsed: t.elapsed,
    timer: t.timer,
    score: JSON.stringify({ home: hs, away: as, ...(tennisSets ? { sets: tennisSets } : {}) }),
    markets: '{}',
    country: String(country || ''),
    home_team_logo: String(e?.homeTeam?.logo ?? ''),
    away_team_logo: String(e?.awayTeam?.logo ?? ''),
  };
}

async function fetchJson(url: string, apiKey: string): Promise<any | null> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 8000);
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

function normalizeOutcomeName(x: any): string {
  return String(x ?? '').trim().toLowerCase();
}

function normalizeLineName(input: string): string {
  return String(input || '')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, '_');
}

function parseOddDecimal(x: any): number {
  if (x == null) return 0;
  if (typeof x === 'number') return Number.isFinite(x) ? x : 0;
  if (typeof x === 'string') {
    const n = Number(String(x).trim().replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  }
  const d = x.decimal ?? x.dec ?? x.value ?? x.odd ?? x.price ?? x.rate ?? null;
  return parseOddDecimal(d);
}

function pickLineValue(row: any): string {
  const candidates = [
    row?.point,
    row?.line,
    row?.handicap,
    row?.total,
    row?.lineValue,
    row?.value,
    row?.param,
    row?.marketValue,
  ];
  for (const c of candidates) {
    const s = String(c ?? '').trim();
    if (!s) continue;
    if (/^-?\d+(\.\d+)?$/.test(s)) return s;
  }
  return '';
}

function hasNumericPointInName(name: string, point: string): boolean {
  if (!point) return false;
  const n = String(name || '');
  const p = String(point || '');
  return n.includes(p) || n.includes(p.replace('.', ',')) || n.includes(p.replace(',', '.'));
}

function marketKeyFromName(lineType: string, lineName: string): string {
  const t = normalizeLineName(lineType);
  const n = normalizeLineName(lineName);
  const s = `${t}__${n}`;
  if (/(1x2|full_time_result|match_result|match_winner|moneyline|winner|win_draw_win|h2h)/.test(s)) return 'h2h';
  if (/(totals|total|over_under|overunder|ou|goals_over_under|points_over_under|runs_over_under)/.test(s)) return 'totals';
  if (/(handicap|spread|asian_handicap|ah|run_line|puck_line)/.test(s)) return 'spreads';
  if (/(both_teams_to_score|btts)/.test(s)) return 'btts';
  if (/(double_chance)/.test(s)) return 'double_chance';
  if (/(draw_no_bet)/.test(s)) return 'draw_no_bet';
  if (/(correct_score)/.test(s)) return 'correct_score';
  if (/(corners)/.test(s)) return 'corners';
  if (/(cards|bookings|yellow|red)/.test(s)) return 'cards';
  if (/(set|sets)/.test(s)) return 'sets';
  if (/(games)/.test(s)) return 'games';
  if (/(special|props|player)/.test(s)) return 'specials';
  return n || t || 'market';
}

function formatSelectionName(marketKey: string, optionName: string, point: string): string {
  const k = String(marketKey || '');
  const raw = String(optionName || '').trim();
  const p = String(point || '').trim();
  if (!p) return raw;
  if (k === 'totals') {
    const n = normalizeLineName(raw);
    if (/(over|acima|mais)/.test(n)) return `Acima de ${p}`;
    if (/(under|abaixo|menos)/.test(n)) return `Abaixo de ${p}`;
    return `${raw} ${p}`;
  }
  if (k === 'spreads') {
    if (/^[+-]/.test(raw)) return raw;
    if (raw.toLowerCase().includes('home')) return `Casa ${p.startsWith('-') || p.startsWith('+') ? p : `+${p}`}`;
    if (raw.toLowerCase().includes('away')) return `Fora ${p.startsWith('-') || p.startsWith('+') ? p : `+${p}`}`;
    return `${raw} ${p}`;
  }
  return hasNumericPointInName(raw, p) ? raw : `${raw} ${p}`;
}

export async function fetchSportsApiProMatchOdds(
  apiKey: string,
  sport: string,
  matchId: string,
  opts?: { mode?: 'all' | 'live' | 'pre-match'; scope?: 'featured' | 'all'; provider?: number; homeTeam?: string; awayTeam?: string }
): Promise<{ home: number; draw: number; away: number; markets: Record<string, any[]> } | null> {
  const sub = toSubdomain(sport);
  const mode = opts?.mode ?? 'all';
  const url =
    mode === 'all'
      ? `https://v2.${sub}.sportsapipro.com/api/match/${encodeURIComponent(matchId)}/odds/all`
      : `https://v2.${sub}.sportsapipro.com/api/match/${encodeURIComponent(matchId)}/odds/${encodeURIComponent(mode)}`;
  const json = await fetchJson(url, apiKey);
  if (!json) return null;

  const rows: any[] = [];
  const pushRows = (arr: any[]) => {
    if (!Array.isArray(arr)) return;
    for (const x of arr) if (x && typeof x === 'object') rows.push(x);
  };
  pushRows(extractMarkets(json));
  pushRows(json?.lines);
  pushRows(json?.data?.lines);
  pushRows(json?.markets);
  pushRows(json?.data?.markets);
  const providers = json?.providers ?? json?.data?.providers ?? null;
  if (Array.isArray(providers)) {
    for (const p of providers) {
      pushRows(p?.markets);
      pushRows(p?.data?.markets);
    }
  }

  if (rows.length === 0) return null;

  const perKey: Record<string, Map<string, { value: string; odd: number; point?: string }>> = {};
  const addSelection = (key: string, value: string, odd: number, point?: string) => {
    if (!key || !value || !(odd > 1)) return;
    const p = point ? String(point) : '';
    const mk = perKey[key] || (perKey[key] = new Map());
    const k = `${normalizeLineName(value)}|${p}`;
    const prev = mk.get(k);
    if (!prev || odd > prev.odd) {
      const out: any = { value, odd };
      if (p) out.point = p;
      mk.set(k, out);
    }
  };

  for (const row of rows) {
    const lineType = row?.lineType?.shortName ?? row?.lineType?.name ?? row?.type ?? row?.lineType ?? row?.marketType ?? '';
    const lineName = row?.lineName ?? row?.name ?? row?.title ?? row?.marketName ?? row?.market ?? row?.lineType?.title ?? '';
    const key = marketKeyFromName(String(lineType || ''), String(lineName || ''));
    const point = pickLineValue(row);
    const options = Array.isArray(row?.options)
      ? row.options
      : Array.isArray(row?.outcomes)
        ? row.outcomes
        : Array.isArray(row?.selections)
          ? row.selections
          : Array.isArray(row?.choices)
            ? row.choices
            : [];
    for (const opt of options) {
      const rawName = opt?.name ?? opt?.label ?? opt?.outcome ?? opt?.value ?? opt?.option ?? '';
      const odd = parseOddDecimal(opt?.rate?.decimal ?? opt?.rate ?? opt?.odd ?? opt?.price ?? opt?.decimal ?? opt?.value);
      if (!(odd > 1)) continue;
      const pointForName = point && !hasNumericPointInName(String(rawName || ''), point) ? point : '';
      const value = formatSelectionName(key, String(rawName || ''), pointForName);
      addSelection(key, value, odd, point);
    }
  }

  const outMarkets: Record<string, any[]> = {};
  for (const [k, mp] of Object.entries(perKey)) {
    const arr = Array.from(mp.values());
    if (arr.length) outMarkets[k] = arr;
  }

  const h2h = outMarkets.h2h || [];
  let home = 0;
  let draw = 0;
  let away = 0;
  const homeName = normalizeOutcomeName(opts?.homeTeam);
  const awayName = normalizeOutcomeName(opts?.awayTeam);

  for (const s of h2h) {
    const rawName = String((s as any).value ?? '');
    const n = normalizeOutcomeName(rawName);
    const odd = parseOddDecimal((s as any).odd);
    if (!(odd > 1)) continue;
    if (n === '1' || n === 'home' || (homeName && (n === homeName || homeName.includes(n) || n.includes(homeName)))) home = home || odd;
    else if (n === '2' || n === 'away' || (awayName && (n === awayName || awayName.includes(n) || n.includes(awayName)))) away = away || odd;
    else if (n === 'x' || n === 'draw' || n === 'tie') draw = draw || odd;
  }

  if (Object.keys(outMarkets).length === 0) return null;
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
