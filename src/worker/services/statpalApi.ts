/**
 * statpalApi.ts — StatPal.io adapter
 *
 * v1 (sem odds, todos os jogos do dia):
 *   GET https://statpal.io/api/v1/{sport}/livescores?access_key=KEY  → soccer, tennis
 *   GET https://statpal.io/api/v1/{sport}/livescore?access_key=KEY   → f1, golf
 *   GET https://statpal.io/api/v1/{sport}/schedule?access_key=KEY    → f1, golf
 *
 * v2 (com odds REAIS, só LIVE):
 *   GET https://statpal.io/api/v2/soccer/odds/live?access_key=KEY
 *
 * Política: NUNCA gerar odds sintéticas/falsas. Eventos sem odds reais são
 * publicados sem cotas (home_odd/draw_odd/away_odd = 0, markets = '').
 * O Trading Panel pode então definir odds manuais por evento.
 */

import type { NormalizedEvent } from './sportsApi';

const STATPAL_V1 = 'https://statpal.io/api/v1';
const STATPAL_V2 = 'https://statpal.io/api/v2';

// Market IDs do StatPal v2 que mapeamos para mercados canónicos
const MK_FULLTIME_RESULT = '3610';   // Home / Draw / Away
const MK_MATCH_GOALS     = '2254';   // Over/Under (handicap = linha)
const MK_BTTS            = '12398';  // Yes / No

// ── Helpers de status ────────────────────────────────────────────────
const LIVE_STATUSES = new Set([
  '1st half', '2nd half', 'halftime', 'half time', 'ht',
  'live', 'in play', 'inplay', 'playing',
  'extra time', 'penalties', 'pen',
  '1q', '2q', '3q', '4q', 'ot',
]);

const FINISHED_STATUSES = new Set([
  'ft', 'aet', 'pen', 'finished', 'final', 'ended', 'after extra time',
  'awd', 'wo', 'abd', 'cancelled', 'canceled',
]);

function isLive(status: string): boolean {
  const s = String(status || '').toLowerCase().trim();
  if (FINISHED_STATUSES.has(s)) return false;
  return LIVE_STATUSES.has(s);
}

function isFinished(status: string): boolean {
  const s = String(status || '').toLowerCase().trim();
  return FINISHED_STATUSES.has(s);
}

// "26.04.2026" + "14:00" → "2026-04-26T14:00:00.000Z"
function parseDateTime(date: string, time: string): string {
  const m = String(date || '').match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!m) return new Date().toISOString();
  const [, dd, mm, yyyy] = m;
  const t = String(time || '00:00').padStart(5, '0');
  return `${yyyy}-${mm}-${dd}T${t}:00.000Z`;
}

function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

// Minuto aproximado a partir do status (livescores v1 não fornece minuto exacto)
function minuteFromStatus(status: string): number {
  const s = String(status || '').toLowerCase().trim();
  if (s === 'ht' || s === 'halftime' || s === 'half time') return 45;
  if (s === '1st half' || s === '1h') return 25;
  if (s === '2nd half' || s === '2h') return 70;
  if (s === 'extra time' || s === 'et') return 105;
  return 0;
}

// ── v2 odds parser ───────────────────────────────────────────────────
type ParsedOdds = {
  home_odd: number;
  draw_odd: number;
  away_odd: number;
  markets_json: string;       // JSON serializado pronto para a coluna `markets`
  score?: { home: number; away: number };
  minute?: number;
  timer?: string;
};

function parseOddNum(v: any): number {
  const n = Number(String(v ?? '').trim());
  return Number.isFinite(n) && n > 1 ? +n.toFixed(3) : 0;
}

// Escolhe a linha de totals "principal" — preferimos a mais próxima de 2.5
function pickPrimaryTotalsLine(lines: any[]): { line: string; over: number; under: number } | null {
  if (!Array.isArray(lines) || lines.length === 0) return null;
  // Agrupa por handicap
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
  // filtra só pares completos
  const pairs: Array<{ line: string; over: number; under: number }> = [];
  for (const [line, v] of byLine.entries()) {
    if (v.over && v.under) pairs.push({ line, over: v.over, under: v.under });
  }
  if (pairs.length === 0) return null;
  pairs.sort((a, b) => Math.abs(parseFloat(a.line) - 2.5) - Math.abs(parseFloat(b.line) - 2.5));
  return pairs[0];
}

function parseV2OddsForMatch(m: any): ParsedOdds {
  const oddsObj = m?.odds || {};
  const markets: any[] = [];
  let home_odd = 0, draw_odd = 0, away_odd = 0;

  // h2h ─ Fulltime Result (3610)
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
          { id: 'sel_home', label: 'Casa',   name: 'Casa',   odd: home_odd },
          { id: 'sel_draw', label: 'Empate', name: 'Empate', odd: draw_odd },
          { id: 'sel_away', label: 'Fora',   name: 'Fora',   odd: away_odd },
        ],
      });
    }
    break;
  }

  // totals ─ Match Goals (2254)
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
          { label: `Mais ${picked.line}`,  name: 'over',  odd: picked.over },
          { label: `Menos ${picked.line}`, name: 'under', odd: picked.under },
        ],
      });
    }
    break;
  }

  // btts ─ Both Teams to Score (12398)
  for (const k of Object.keys(oddsObj)) {
    const mk = oddsObj[k];
    if (String(mk?.market_id) !== MK_BTTS) continue;
    if (String(mk?.suspended) === '1') break;
    const sels = asArray(mk?.lines);
    const yesLn = sels.find((l: any) => String(l?.name).toLowerCase() === 'yes' && String(l?.suspended) !== '1');
    const noLn  = sels.find((l: any) => String(l?.name).toLowerCase() === 'no'  && String(l?.suspended) !== '1');
    const yes = parseOddNum(yesLn?.odd);
    const no  = parseOddNum(noLn?.odd);
    if (yes > 1 && no > 1) {
      markets.push({
        id: 'mkt_btts',
        key: 'btts',
        name: 'Ambas Equipas Marcam',
        selections: [
          { label: 'Sim', name: 'yes', odd: yes },
          { label: 'Não', name: 'no',  odd: no  },
        ],
      });
    }
    break;
  }

  // score + minute (do match_info)
  let score: { home: number; away: number } | undefined;
  const sc = String(m?.match_info?.score || '').trim();
  const scMatch = sc.match(/^(\d+)\s*[:\-]\s*(\d+)$/);
  if (scMatch) score = { home: Number(scMatch[1]), away: Number(scMatch[2]) };

  const minuteRaw = String(m?.match_info?.minute || '').trim();
  const minNum = Number(minuteRaw);
  const minute = Number.isFinite(minNum) && minNum > 0 ? minNum : undefined;

  const period = String(m?.match_info?.period || '').toLowerCase();
  let timer: string | undefined;
  if (/half\s*time|halftime|^ht$/.test(period)) timer = 'INTERVALO';
  else if (minute) timer = `${minute}'`;
  else if (period) timer = period.toUpperCase();

  return {
    home_odd, draw_odd, away_odd,
    markets_json: markets.length > 0 ? JSON.stringify(markets) : '',
    score, minute, timer,
  };
}

// ── v2 odds fetcher ──────────────────────────────────────────────────
// Devolve um Map indexado por TODOS os ids candidatos (main_id + fallbacks)
// para que o cruzamento com livescores v1 (que usa o `id` do match) funcione.
async function fetchStatpalLiveOddsV2(apiKey: string): Promise<Map<string, ParsedOdds>> {
  const url = `${STATPAL_V2}/soccer/odds/live?access_key=${encodeURIComponent(apiKey)}`;
  const map = new Map<string, ParsedOdds>();
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`[StatPal v2][odds/live] HTTP ${res.status}`);
      return map;
    }
    const json: any = await res.json().catch(() => null);
    const matches = asArray(json?.live_matches);
    for (const m of matches) {
      const parsed = parseV2OddsForMatch(m);
      const ids = [
        m?.match_info?.main_id,
        m?.match_info?.fallback_id_1,
        m?.match_info?.fallback_id_2,
        m?.match_info?.fallback_id_3,
      ].map(x => String(x || '').trim()).filter(Boolean);
      for (const id of ids) {
        // Primeiro id que aparece com odds vence (não sobrescreve)
        if (!map.has(id)) map.set(id, parsed);
      }
    }
    console.log(`[StatPal v2][odds/live] mapped ${matches.length} live matches → ${map.size} id keys`);
  } catch (e) {
    console.error('[StatPal v2][odds/live] error:', e);
  }
  return map;
}

// ── Soccer (v1 livescores + v2 odds merge) ───────────────────────────
export async function fetchStatpalSoccer(apiKey: string): Promise<NormalizedEvent[]> {
  const [livescoresRes, oddsMap] = await Promise.all([
    fetch(`${STATPAL_V1}/soccer/livescores?access_key=${encodeURIComponent(apiKey)}`),
    fetchStatpalLiveOddsV2(apiKey),
  ]);

  if (!livescoresRes.ok) {
    console.error(`[StatPal v1][soccer] HTTP ${livescoresRes.status}`);
    return [];
  }
  const json: any = await livescoresRes.json().catch(() => null);
  const leagues = asArray(json?.livescore?.league);
  const out: NormalizedEvent[] = [];
  let mergedCount = 0;

  for (const league of leagues) {
    const leagueName = String(league?.name || '').trim();
    const country = String(league?.country || '').trim();
    const matches = asArray(league?.match);

    for (const m of matches) {
      const id = String(m?.id || m?.alternate_id || '').trim();
      if (!id) continue;
      const altId = String(m?.alternate_id || '').trim();
      const home = String(m?.home?.name || '').trim();
      const away = String(m?.away?.name || '').trim();
      if (!home || !away) continue;

      const status = String(m?.status || '').trim();
      const finished = isFinished(status);
      const live = isLive(status);

      // Score + minuto base (do v1)
      const homeGoals = Number(m?.home?.goals ?? 0);
      const awayGoals = Number(m?.away?.goals ?? 0);
      let scoreJson = (live || finished)
        ? JSON.stringify({ home: homeGoals, away: awayGoals })
        : '{"home":null,"away":null}';
      let minute = live ? minuteFromStatus(status) : 0;
      let timerLabel = status.toUpperCase() === 'HT'
        ? 'INTERVALO'
        : (live && minute > 0 ? `${minute}'` : String(m?.status || ''));

      // Tenta encontrar odds reais (v2). Tenta vários ids.
      let real: ParsedOdds | undefined;
      for (const candidate of [id, altId].filter(Boolean)) {
        if (oddsMap.has(candidate)) { real = oddsMap.get(candidate); break; }
      }

      let home_odd = 0, draw_odd = 0, away_odd = 0, marketsJson = '';
      if (real) {
        mergedCount++;
        home_odd = real.home_odd;
        draw_odd = real.draw_odd;
        away_odd = real.away_odd;
        marketsJson = real.markets_json;
        // Score/minute mais frescos do v2 (têm minuto exacto)
        if (real.score) scoreJson = JSON.stringify(real.score);
        if (real.minute && real.minute > 0) {
          minute = real.minute;
          timerLabel = real.timer || `${real.minute}'`;
        } else if (real.timer) {
          timerLabel = real.timer;
        }
      }

      out.push({
        external_event_id: `statpal_soccer_${id}`,
        sport: 'soccer',
        league: leagueName,
        home_team: home,
        away_team: away,
        team_match: `${home} vs ${away}`,
        event_date: parseDateTime(m?.date, m?.time),
        status: finished ? 'FT' : (live ? 'LIVE' : 'NS'),
        is_live: live ? 1 : 0,
        home_odd, draw_odd, away_odd,
        elapsed: minute,
        timer: timerLabel,
        score: scoreJson,
        markets: marketsJson,
        country,
        home_team_logo: '',
        away_team_logo: '',
      });
    }
  }

  console.log(`[StatPal][soccer] livescores=${out.length} | with-real-odds=${mergedCount} | without-odds=${out.length - mergedCount}`);
  return out;
}

// ── Tennis (sem odds — StatPal não fornece) ──────────────────────────
export async function fetchStatpalTennis(apiKey: string): Promise<NormalizedEvent[]> {
  const url = `${STATPAL_V1}/tennis/livescores?access_key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`[StatPal][tennis] HTTP ${res.status}`);
    return [];
  }
  const json: any = await res.json().catch(() => null);
  const tournaments = asArray(json?.livescores?.tournament || json?.livescore?.tournament);
  const out: NormalizedEvent[] = [];

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

      const status = String(m?.status || '').trim();
      const finished = isFinished(status);
      const live = isLive(status);
      const homeSets = Number(players[0]?.sets ?? players[0]?.totalsets ?? 0);
      const awaySets = Number(players[1]?.sets ?? players[1]?.totalsets ?? 0);
      const scoreJson = (live || finished)
        ? JSON.stringify({ home: homeSets, away: awaySets })
        : '{"home":null,"away":null}';

      out.push({
        external_event_id: `statpal_tennis_${id}`,
        sport: 'tennis',
        league: tournamentName,
        home_team: home,
        away_team: away,
        team_match: `${home} vs ${away}`,
        event_date: parseDateTime(m?.date, m?.time),
        status: finished ? 'FT' : (live ? 'LIVE' : 'NS'),
        is_live: live ? 1 : 0,
        home_odd: 0, draw_odd: 0, away_odd: 0,
        elapsed: 0, timer: status, score: scoreJson, markets: '',
        country: '', home_team_logo: '', away_team_logo: '',
      });
    }
  }

  return out;
}

// ── Formula 1 (sem odds) ─────────────────────────────────────────────
export async function fetchStatpalF1(apiKey: string): Promise<NormalizedEvent[]> {
  const url = `${STATPAL_V1}/f1/schedule?access_key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`[StatPal][f1] HTTP ${res.status}`);
    return [];
  }
  const json: any = await res.json().catch(() => null);
  const tournaments = asArray(json?.fixtures?.tournament);
  const out: NormalizedEvent[] = [];

  for (const t of tournaments) {
    const id = String(t?.id || '').trim();
    if (!id) continue;
    const name = String(t?.name || '').trim();
    const race = t?.race || {};
    const status = String(race?.status || 'Scheduled').trim();
    const live = isLive(status);
    const finished = isFinished(status);

    out.push({
      external_event_id: `statpal_f1_${id}`,
      sport: 'formula1',
      league: 'Formula 1',
      home_team: name,
      away_team: String(race?.city || ''),
      team_match: name,
      event_date: parseDateTime(race?.date, race?.time || '14:00'),
      status: finished ? 'FT' : (live ? 'LIVE' : 'NS'),
      is_live: live ? 1 : 0,
      home_odd: 0, draw_odd: 0, away_odd: 0,
      elapsed: 0, timer: status, score: '', markets: '',
      country: '', home_team_logo: '', away_team_logo: '',
    });
  }

  return out;
}

// ── Golf (sem odds) ──────────────────────────────────────────────────
export async function fetchStatpalGolf(apiKey: string): Promise<NormalizedEvent[]> {
  const url = `${STATPAL_V1}/golf/schedule?access_key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`[StatPal][golf] HTTP ${res.status}`);
    return [];
  }
  const json: any = await res.json().catch(() => null);
  const tournaments = asArray(json?.fixtures?.tournament);
  const out: NormalizedEvent[] = [];

  for (const t of tournaments) {
    const id = String(t?.id || '').trim();
    if (!id) continue;
    const name = String(t?.name || '').trim();
    const status = String(t?.status || 'Scheduled').trim();
    const live = isLive(status);
    const finished = isFinished(status);

    out.push({
      external_event_id: `statpal_golf_${id}`,
      sport: 'golf',
      league: String(t?.series || 'Golf'),
      home_team: name,
      away_team: String(t?.location || ''),
      team_match: name,
      event_date: parseDateTime(t?.date_start, '12:00'),
      status: finished ? 'FT' : (live ? 'LIVE' : 'NS'),
      is_live: live ? 1 : 0,
      home_odd: 0, draw_odd: 0, away_odd: 0,
      elapsed: 0, timer: status, score: '', markets: '',
      country: '', home_team_logo: '', away_team_logo: '',
    });
  }

  return out;
}

// ── Sync agregado ─────────────────────────────────────────────────────
export async function fetchAllStatpal(apiKey: string): Promise<NormalizedEvent[]> {
  const results = await Promise.allSettled([
    fetchStatpalSoccer(apiKey),
    fetchStatpalTennis(apiKey),
    fetchStatpalF1(apiKey),
    fetchStatpalGolf(apiKey),
  ]);
  const out: NormalizedEvent[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') out.push(...r.value);
    else console.error('[StatPal] fetch error:', r.reason);
  }
  return out;
}
