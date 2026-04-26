/**
 * statpalApi.ts — StatPal.io adapter
 * Endpoints conhecidos (com a key actual):
 *   GET https://statpal.io/api/v1/{sport}/livescores?access_key=KEY  → soccer, tennis (todos os jogos do dia)
 *   GET https://statpal.io/api/v1/{sport}/livescore?access_key=KEY   → f1, golf
 *   GET https://statpal.io/api/v1/{sport}/schedule?access_key=KEY    → f1, golf
 *
 * StatPal NÃO fornece cotas. Geramos baseline odds para o site funcionar;
 * o operador pode override no Trading Panel.
 */

import type { NormalizedEvent } from './sportsApi';

const STATPAL_BASE = 'https://statpal.io/api/v1';

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

// ── Baseline odds (StatPal não fornece) ──────────────────────────────
function baselineOdds(sport: string): { home: number; draw: number; away: number } {
  if (sport === 'tennis') return { home: 1.85, draw: 0, away: 1.85 };
  if (sport === 'formula1' || sport === 'golf') return { home: 0, draw: 0, away: 0 };
  // soccer, basketball, etc.
  return { home: 2.10, draw: 3.30, away: 3.20 };
}

// ── Soccer ────────────────────────────────────────────────────────────
export async function fetchStatpalSoccer(apiKey: string): Promise<NormalizedEvent[]> {
  const url = `${STATPAL_BASE}/soccer/livescores?access_key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`[StatPal][soccer] HTTP ${res.status}`);
    return [];
  }
  const json: any = await res.json().catch(() => null);
  const leagues = asArray(json?.livescore?.league);
  const out: NormalizedEvent[] = [];
  const baseline = baselineOdds('soccer');

  for (const league of leagues) {
    const leagueName = String(league?.name || '').trim();
    const country = String(league?.country || '').trim();
    const matches = asArray(league?.match);

    for (const m of matches) {
      const id = String(m?.id || m?.alternate_id || '').trim();
      if (!id) continue;
      const home = String(m?.home?.name || '').trim();
      const away = String(m?.away?.name || '').trim();
      if (!home || !away) continue;

      const status = String(m?.status || '').trim();
      const finished = isFinished(status);
      const live = isLive(status);
      const homeGoals = Number(m?.home?.goals ?? 0);
      const awayGoals = Number(m?.away?.goals ?? 0);
      const score = (live || finished) ? `${homeGoals}-${awayGoals}` : '';

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
        home_odd: baseline.home,
        draw_odd: baseline.draw,
        away_odd: baseline.away,
        elapsed: Number(m?.inj_minute || 0) || 0,
        timer: String(m?.status || ''),
        score,
        markets: '',
        country,
        home_team_logo: '',
        away_team_logo: '',
      });
    }
  }

  return out;
}

// ── Tennis ────────────────────────────────────────────────────────────
export async function fetchStatpalTennis(apiKey: string): Promise<NormalizedEvent[]> {
  const url = `${STATPAL_BASE}/tennis/livescores?access_key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`[StatPal][tennis] HTTP ${res.status}`);
    return [];
  }
  const json: any = await res.json().catch(() => null);
  const tournaments = asArray(json?.livescores?.tournament || json?.livescore?.tournament);
  const out: NormalizedEvent[] = [];
  const baseline = baselineOdds('tennis');

  for (const t of tournaments) {
    const tournamentName = String(t?.name || '').trim();
    const matches = asArray(t?.match);

    for (const m of matches) {
      const id = String(m?.id || '').trim();
      if (!id) continue;
      const players = asArray(m?.player);
      // Tennis: array de 2 players { name, sets, games }
      const home = String(players[0]?.name || m?.player_1 || '').trim();
      const away = String(players[1]?.name || m?.player_2 || '').trim();
      if (!home || !away) continue;

      const status = String(m?.status || '').trim();
      const finished = isFinished(status);
      const live = isLive(status);
      const homeSets = Number(players[0]?.sets ?? players[0]?.totalsets ?? 0);
      const awaySets = Number(players[1]?.sets ?? players[1]?.totalsets ?? 0);
      const score = (live || finished) ? `${homeSets}-${awaySets}` : '';

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
        home_odd: baseline.home,
        draw_odd: baseline.draw,
        away_odd: baseline.away,
        elapsed: 0,
        timer: status,
        score,
        markets: '',
        country: '',
        home_team_logo: '',
        away_team_logo: '',
      });
    }
  }

  return out;
}

// ── Formula 1 ─────────────────────────────────────────────────────────
export async function fetchStatpalF1(apiKey: string): Promise<NormalizedEvent[]> {
  const url = `${STATPAL_BASE}/f1/schedule?access_key=${encodeURIComponent(apiKey)}`;
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

// ── Golf ──────────────────────────────────────────────────────────────
export async function fetchStatpalGolf(apiKey: string): Promise<NormalizedEvent[]> {
  const url = `${STATPAL_BASE}/golf/schedule?access_key=${encodeURIComponent(apiKey)}`;
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
