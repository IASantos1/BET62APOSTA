/**
 * sports.ts — Router de eventos desportivos
 * Serve live e pré-jogo da tabela `events`.
 */

import { Hono } from 'hono';
import { Env } from '../shared/types';
import { fetchOddsApiEvents, fetchOddsApiMarketsForFixture, matchOddsEvent } from './services/oddsApi';
import { applyOdds, fetchDayOddsForSport, fetchLiveOddsForSport, fetchLiveFixtures, fetchDateFixtures, fetchOddsForEvents, LIVE_STATUSES as API_LIVE_STATUSES, SPORT_CONFIG } from './services/sportsApi';
import { getApiSportsKey, getOddsApiKey } from './services/env';
import { shouldSuspendLiveOdds } from './engine/liveGuard';

const cachedLiveFixtures = new Map<string, { expiresAt: number; map: Map<string, any> }>();

const sports = new Hono<{ Bindings: Env }>();

const LIVE_STATUSES = new Set([
  '1H', '2H', 'HT', 'ET', 'P', 'LIVE',
  'Q1', 'Q2', 'Q3', 'Q4', 'OT', 'BT',
  'P1', 'P2', 'P3',
  'S1', 'S2', 'S3', 'S4', 'S5',
  'IN', 'IN1', 'IN2', 'IN3', 'IN4', 'IN5', 'IN6', 'IN7', 'IN8', 'IN9',
]);

const FINISHED_STATUSES = new Set([
  'FT', 'AET', 'PEN', 'AWD', 'WO', 'ABD',
  'FT_PEN', 'AOT', 'AP', 'POST', 'SUSP', 'TBD',
  'FIN', 'FINAL',
  'Finished', 'Match Finished', 'Final', 'Ended', 'NS_CANC', 'CANC',
]);

const LIVE_MAX_AGE_MS: Record<string, number> = {
  soccer: 3.5 * 60 * 60 * 1000,
  basketball: 3 * 60 * 60 * 1000,
  'ice-hockey': 4 * 60 * 60 * 1000,
  handball: 3 * 60 * 60 * 1000,
  volleyball: 4 * 60 * 60 * 1000,
  rugby: 3.5 * 60 * 60 * 1000,
  'american-football': 5 * 60 * 60 * 1000,
  baseball: 6 * 60 * 60 * 1000,
  tennis: 8 * 60 * 60 * 1000,
};

function isStaleLiveEvent(ev: any, nowMs: number): boolean {
  const sp = normalizeSport(String(ev?.sport || 'soccer'));
  const maxAge = LIVE_MAX_AGE_MS[sp] ?? (6 * 60 * 60 * 1000);
  const rawDate = ev?.event_date || ev?.fixture?.date;
  if (!rawDate) return false;
  const startMs = new Date(rawDate).getTime();
  if (!Number.isFinite(startMs) || startMs <= 0) return false;
  const ageMs = nowMs - startMs;
  if (ageMs <= 0) return false;
  if (ageMs > maxAge) return true;
  const elapsed = Number(ev?.elapsed ?? ev?.fixture?.status?.elapsed ?? NaN);
  if (sp === 'soccer' && Number.isFinite(elapsed) && elapsed >= 120) return true;
  return false;
}

const SPORT_ALIASES: Record<string, string> = {
  football:           'soccer',
  futebol:            'soccer',
  'soccer-all':       'soccer',
  todos:              'soccer',
  nba:                'basketball',
  basquetebol:        'basketball',
  nhl:                'ice-hockey',
  hockey:             'ice-hockey',
  beisebol:           'baseball',
  nfl:                'american-football',
  'futebol-americano':'american-football',
  'futebol americano':'american-football',
  handebol:           'handball',
  voleibol:           'volleyball',
};

function normalizeSport(raw: string): string {
  const s = raw.toLowerCase().trim();
  return SPORT_ALIASES[s] ?? s;
}

function parseEventDateMs(input: any): number {
  const raw = String(input || '').trim();
  if (!raw) return 0;
  const t = raw.includes('T') ? raw : raw.replace(' ', 'T');
  const normalized = t.replace(/\+00:00$/, 'Z');
  let ms = Date.parse(normalized);
  if (!Number.isFinite(ms)) {
    const base = t.slice(0, 19).replace(' ', 'T') + 'Z';
    ms = Date.parse(base);
  }
  return Number.isFinite(ms) ? ms : 0;
}

function splitEvents(rows: any[]): { live: any[]; pregame: any[] } {
  const live: any[] = [];
  const pregame: any[] = [];
  const now = Date.now();

  for (const r of rows) {
    const status = String(r.status || 'NS').trim();
    const isLiveFlag = Number(r.is_live) === 1;
    const isLiveStatus = LIVE_STATUSES.has(status);
    const isFinished = FINISHED_STATUSES.has(status);
    const d = parseEventDateMs(r.event_date);
    if (!d) continue;

    if (isFinished) continue;

    if (isLiveFlag || isLiveStatus) {
      const sport = normalizeSport(String(r.sport || 'soccer'));
      const maxAge = LIVE_MAX_AGE_MS[sport] ?? (4 * 60 * 60 * 1000);
      if (d < now - maxAge) continue;
      live.push(formatEvent(r));
      continue;
    }

    if (d < now - 3 * 60 * 60 * 1000) continue;
    if (d > now + 14 * 24 * 60 * 60 * 1000) continue;
    pregame.push(formatEvent(r));
  }

  return { live, pregame };
}

function formatEvent(r: any): any {
  let markets: any = {};
  try { markets = JSON.parse(r.markets || '{}'); } catch { /* empty */ }
  const h2h = Array.isArray(markets?.h2h) ? markets.h2h : [];

  const deriveFromLegacyH2h = (arr: any[], sport: string) => {
    if (!Array.isArray(arr) || arr.length < 2) return null;
    let home = 0;
    let draw = 0;
    let away = 0;
    for (const o of arr) {
      const name = String(o?.value ?? o?.label ?? o?.name ?? o?.outcome ?? '').toLowerCase().trim();
      const odd = Number(o?.odd ?? o?.price ?? o?.value ?? 0);
      if (!(odd > 1)) continue;
      if (name === 'home' || name === '1' || name === 'casa') home = home || odd;
      else if (name === 'draw' || name === 'x' || name === 'empate') draw = draw || odd;
      else if (name === 'away' || name === '2' || name === 'fora') away = away || odd;
    }
    const vals = [home, draw, away].filter((x) => x > 1);
    if (vals.length < 2) return null;
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    if (min < 1.15 && max > 6) return null;
    if (max > 50) return null;
    if (sport !== 'soccer') draw = 0;
    return { home, draw, away };
  };

  let home_odd = Number(r.home_odd) || 0;
  let draw_odd = Number(r.draw_odd) || 0;
  let away_odd = Number(r.away_odd) || 0;

  const goals = { home: null as number | null, away: null as number | null };
  try {
    const sc = r.score ? JSON.parse(r.score) : null;
    if (sc) { goals.home = sc.home ?? null; goals.away = sc.away ?? null; }
  } catch { /* empty */ }

  const statusShort = String(r.status || 'NS').trim();
  const id = r.external_event_id || String(r.id);
  const sport = normalizeSport(String(r.sport || 'soccer'));
  if (!(home_odd > 1) && !(away_odd > 1)) {
    const derived = deriveFromLegacyH2h(h2h, sport);
    if (derived) {
      home_odd = derived.home;
      draw_odd = derived.draw;
      away_odd = derived.away;
    }
  }
  const marketsArr: any[] = [];
  const h2hSelections: any[] = [];

  if (home_odd > 1) h2hSelections.push({ id: 'sel_home', label: 'Casa', name: 'Casa', odd: home_odd });
  if (sport === 'soccer' && draw_odd > 1) h2hSelections.push({ id: 'sel_draw', label: 'Empate', name: 'Empate', odd: draw_odd });
  if (away_odd > 1) h2hSelections.push({ id: 'sel_away', label: 'Fora', name: 'Fora', odd: away_odd });

  if (h2hSelections.length >= 2) {
    marketsArr.push({ id: 'mkt_h2h', key: 'h2h', name: 'Resultado Final', selections: h2hSelections });
  }

  const elapsedNum = Number(r.elapsed) || 0;
  const timerStr = String(r.timer || '').trim() || (elapsedNum > 0 ? `${elapsedNum}'` : '');

  return {
    id,
    external_event_id: id,
    sport:      r.sport || 'soccer',
    league:     r.league || '',
    country:    r.country || '',
    home_team:  r.home_team || '',
    away_team:  r.away_team || '',
    match:      `${r.home_team || ''} vs ${r.away_team || ''}`,
    event_date: r.event_date,
    date:       r.event_date,
    is_live:    Number(r.is_live) || 0,
    status:     { short: statusShort, long: statusShort, elapsed: elapsedNum, timer: timerStr },
    elapsed:    elapsedNum,
    timer:      timerStr,
    goals,
    score:      goals,
    home_odd,
    draw_odd,
    away_odd,
    markets: marketsArr,
    fixture: {
      id,
      date:   r.event_date,
      status: { short: statusShort, long: statusShort, elapsed: elapsedNum, timer: timerStr },
      timestamp: r.event_date ? Math.floor(new Date(r.event_date).getTime() / 1000) : 0,
    },
    home_team_logo: r.home_team_logo || '',
    away_team_logo: r.away_team_logo || '',
    teams: {
      home: { name: r.home_team || '', logo: r.home_team_logo || '' },
      away: { name: r.away_team || '', logo: r.away_team_logo || '' },
    },
    home:  { name: r.home_team || '', logo: r.home_team_logo || '' },
    away:  { name: r.away_team || '', logo: r.away_team_logo || '' },
    odds: { h2h: Array.isArray(h2h) ? h2h : [] },
  };
}

function rewriteMediaUrl(proxyBase: string | undefined, url: string): string {
  const base = String(proxyBase || '').trim().replace(/\/+$/, '');
  const u = String(url || '').trim();
  if (!u) return u;
  if (u.startsWith('/api/events/media?url=')) {
    const q = u.split('?')[1] || '';
    const params = new URLSearchParams(q);
    const raw = params.get('url') || '';
    return raw ? decodeURIComponent(raw) : u;
  }
  if (!u.startsWith('https://media.api-sports.io/')) return u;
  if (!base) return `/api/events/media?url=${encodeURIComponent(u)}`;
  return base + u.slice('https://media.api-sports.io'.length);
}

function applyMediaProxy(rows: any[], proxyBase: string | undefined): any[] {
  return rows.map((r) => ({
    ...r,
    home_team_logo: rewriteMediaUrl(proxyBase, r.home_team_logo || ''),
    away_team_logo: rewriteMediaUrl(proxyBase, r.away_team_logo || ''),
  }));
}

function ensureH2hMarketsArray(ev: any): any {
  const toNum = (v: any) => {
    const n = typeof v === 'string' ? parseFloat(v) : Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  const sport = normalizeSport(String(ev?.sport || 'soccer'));
  const homeOdd = toNum(ev?.home_odd);
  const drawOdd = toNum(ev?.draw_odd);
  const awayOdd = toNum(ev?.away_odd);

  const isThreeWay = sport === 'soccer';

  const selections: any[] = [];
  if (homeOdd > 1) selections.push({ id: 'sel_home', label: 'Casa', name: 'Casa', odd: homeOdd, price: homeOdd });
  if (isThreeWay && drawOdd > 1) selections.push({ id: 'sel_draw', label: 'Empate', name: 'Empate', odd: drawOdd, price: drawOdd });
  if (awayOdd > 1) selections.push({ id: 'sel_away', label: 'Fora', name: 'Fora', odd: awayOdd, price: awayOdd });

  const existing = Array.isArray(ev?.markets) ? ev.markets : [];
  const hasH2h = existing.some((m: any) => String(m?.key || '') === 'h2h');
  if (hasH2h) return ev;
  if (selections.length < 2) return { ...ev, markets: existing };

  return {
    ...ev,
    markets: [
      ...existing,
      { id: 'mkt_h2h', key: 'h2h', name: 'Resultado Final', selections },
    ],
  };
}

sports.get('/by-sport', async (c) => {
  try {
    const rawSport = c.req.query('sports') || c.req.query('sport') || 'soccer';
    const sport = normalizeSport(rawSport.split(',')[0]);
    const isAll = sport === 'all';
    const include = String(c.req.query('include') || '');
    const wantsOdds = include.split(',').map((s) => s.trim()).includes('odds');
    const realtime = String(c.req.query('realtime') || '') === '1';
    const doRealtime = realtime;
    const nowMs = Date.now();
    const apiKey = getApiSportsKey(c.env);
    const oddsKey = getOddsApiKey(c.env);

    const eventDt = `datetime(replace(substr(event_date, 1, 19), 'T', ' '))`;

    let query = `
      SELECT *
      FROM events
      WHERE ${eventDt} IS NOT NULL
        AND (
          (is_live = 1 AND ${eventDt} > datetime('now', '-5 hours'))
          OR ${eventDt} BETWEEN datetime('now', '-3 hours') AND datetime('now', '+14 days')
        )
      AND COALESCE(status, 'NS') NOT IN ('FT','AET','PEN','AWD','WO','ABD','FIN','FINAL','Finished','Match Finished','Final','Ended','AOT','AP','POST','SUSP','CANC','TBD','FT_PEN','NS_CANC')
      AND league NOT IN ('Test League','Test','Debug League','Copa Alagoas')
      AND league NOT LIKE 'Test%'
      AND lower(league) NOT LIKE '%serie c%'
      AND lower(league) NOT LIKE '%série c%'
      AND lower(league) NOT LIKE '%serie d%'
      AND lower(league) NOT LIKE '%série d%'
    `;
    const params: any[] = [];

    if (!isAll) {
      query += ' AND sport = ?';
      params.push(sport);
    }

    // Ordenar: ao vivo primeiro → top ligas → com odds → data ASC
    query += `
      ORDER BY
        is_live DESC,
        CASE WHEN league IN (
          'UEFA Champions League','UEFA Europa League','UEFA Europa Conference League',
          'UEFA Nations League','World Cup','Copa America','EURO',
          'Premier League','La Liga','Bundesliga','Serie A','Ligue 1',
          'Primeira Liga','Eredivisie','Jupiler Pro League',
          'Scottish Premiership','Super Lig','Saudi Pro League','MLS',
          'Championship','League One','League Two',
          'FA Cup','Copa del Rey','DFB Pokal','Coupe de France',
          'NBA','EuroLeague','NHL','KHL','MLB','NFL','Six Nations'
        ) THEN 0 ELSE 1 END ASC,
        CASE WHEN CAST(home_odd AS REAL) > 1 THEN 0 ELSE 1 END ASC,
        ${eventDt} ASC
      LIMIT 500
    `;

    const res = await c.env.DB.prepare(query).bind(...params).all();
    let rawRows: any[] = res.results || [];

    if (wantsOdds && apiKey && rawRows.length > 0) {
      const hasMissingSoccer = rawRows.some((r: any) => normalizeSport(String(r.sport || 'soccer')) === 'soccer' && !(Number(r.home_odd || 0) > 1));
      if (hasMissingSoccer) {
        const today = new Date();
        const d0 = today.toISOString().slice(0, 10);
        const dt1 = new Date(today);
        dt1.setDate(today.getDate() + 1);
        const d1 = dt1.toISOString().slice(0, 10);

        const m0 = await fetchDayOddsForSport(apiKey, 'soccer', d0, 2);
        const m1 = await fetchDayOddsForSport(apiKey, 'soccer', d1, 2);

        rawRows = rawRows.map((r: any) => {
          const evSport = normalizeSport(String(r.sport || 'soccer'));
          if (evSport !== 'soccer') return r;
          if (Number(r.home_odd || 0) > 1) return r;
          try {
            const after0 = applyOdds(r as any, m0);
            const after1 = applyOdds(after0 as any, m1);
            return after1;
          } catch {
            return r;
          }
        });
      }
    }

    if (doRealtime && wantsOdds && apiKey && !isAll && rawRows.length > 0) {
      const today = new Date();
      const d0 = today.toISOString().slice(0, 10);
      const dt1 = new Date(today);
      dt1.setDate(today.getDate() + 1);
      const d1 = dt1.toISOString().slice(0, 10);

      const m0 = await fetchDayOddsForSport(apiKey, sport, d0, 2);
      const m1 = await fetchDayOddsForSport(apiKey, sport, d1, 2);
      const liveMap = await fetchLiveOddsForSport(apiKey, sport);

      rawRows = rawRows.map((r: any) => {
        try {
          const id = String(r.external_event_id || '');
          if (!id || !id.includes('_')) return r;
          const evSport = normalizeSport(String(r.sport || 'soccer'));
          if (evSport !== sport) return r;
          const afterDay = applyOdds(r as any, m0);
          const afterDay2 = applyOdds(afterDay as any, m1);
          const afterLive = applyOdds(afterDay2 as any, liveMap);
          return afterLive;
        } catch {
          return r;
        }
      });

      const needs = rawRows
        .filter((r: any) => {
          const evSport = normalizeSport(String(r.sport || 'soccer'));
          if (evSport !== sport) return false;
          const id = String(r.external_event_id || '');
          if (!id || !id.includes('_')) return false;
          return !(Number(r.home_odd || 0) > 1);
        })
        .slice(0, 45);

      if (needs.length > 0) {
        const map = await fetchOddsForEvents(apiKey, sport, needs as any, 45, 4);
        if (map.size > 0) {
          rawRows = rawRows.map((r: any) => {
            const id = String(r.external_event_id || '');
            if (!id || !id.includes('_')) return r;
            const evSport = normalizeSport(String(r.sport || 'soccer'));
            if (evSport !== sport) return r;
            return applyOdds(r as any, map);
          });
        }
      }
    }

    if (isAll && apiKey && rawRows.length < 60) {
      const today = new Date();
      const d0 = today.toISOString().slice(0, 10);
      const dt1 = new Date(today);
      dt1.setDate(today.getDate() + 1);
      const d1 = dt1.toISOString().slice(0, 10);

      const sportsToLoad = ['soccer', 'basketball', 'tennis', 'volleyball', 'handball', 'ice-hockey']
        .filter((s) => !!SPORT_CONFIG[s])
        .slice(0, 4);

      const baseEvents: any[] = [];
      for (const sp of sportsToLoad) {
        const liveList = await fetchLiveFixtures(apiKey, sp);
        const day0 = await fetchDateFixtures(apiKey, sp, d0);
        const day1 = await fetchDateFixtures(apiKey, sp, d1);
        baseEvents.push(...liveList, ...day0, ...day1);
      }

      const seen = new Set<string>();
      const extra = baseEvents.filter((e: any) => e && e.external_event_id && !seen.has(String(e.external_event_id)) && (seen.add(String(e.external_event_id)), true));

      let mergedExtra = extra;
      if (wantsOdds) {
        for (const sp of sportsToLoad) {
          const m0 = await fetchDayOddsForSport(apiKey, sp, d0, 2);
          const m1 = await fetchDayOddsForSport(apiKey, sp, d1, 2);
          const liveMap = await fetchLiveOddsForSport(apiKey, sp);

          mergedExtra = mergedExtra.map((ev: any) => {
            const evSport = normalizeSport(String(ev.sport || 'soccer'));
            if (evSport !== sp) return ev;
            const afterDay = applyOdds(ev, m0);
            const afterDay2 = applyOdds(afterDay, m1);
            const afterLive = applyOdds(afterDay2, liveMap);
            return afterLive;
          });
        }
      }

      const existingIds = new Set(rawRows.map((r: any) => String(r?.external_event_id || '')));
      rawRows = [
        ...rawRows,
        ...mergedExtra.filter((e: any) => {
          const id = String(e?.external_event_id || '');
          if (!id || existingIds.has(id)) return false;
          existingIds.add(id);
          return true;
        }),
      ];
    }

    const rows = applyMediaProxy(rawRows, c.env.MEDIA_PROXY_BASE);
    let { live, pregame } = splitEvents(rows);

    if (live.length === 0 && pregame.length === 0 && apiKey) {
      const today = new Date();
      const d0 = today.toISOString().slice(0, 10);
      const dt1 = new Date(today);
      dt1.setDate(today.getDate() + 1);
      const d1 = dt1.toISOString().slice(0, 10);

      const pickSports = () => {
        if (!isAll) return [sport];
        return ['soccer', 'basketball', 'tennis', 'volleyball', 'handball', 'ice-hockey'].filter((s) => !!SPORT_CONFIG[s]).slice(0, 4);
      };

      const sportsToLoad = pickSports();
      const baseEvents: any[] = [];

      for (const sp of sportsToLoad) {
        const liveList = await fetchLiveFixtures(apiKey, sp);
        const day0 = await fetchDateFixtures(apiKey, sp, d0);
        const day1 = await fetchDateFixtures(apiKey, sp, d1);
        baseEvents.push(...liveList, ...day0, ...day1);
      }

      const seen = new Set<string>();
      let merged = baseEvents.filter((e: any) => e && e.external_event_id && !seen.has(String(e.external_event_id)) && (seen.add(String(e.external_event_id)), true));

      if (wantsOdds) {
        for (const sp of sportsToLoad) {
          const m0 = await fetchDayOddsForSport(apiKey, sp, d0, 2);
          const m1 = await fetchDayOddsForSport(apiKey, sp, d1, 2);
          const liveMap = await fetchLiveOddsForSport(apiKey, sp);

          merged = merged.map((ev: any) => {
            const evSport = normalizeSport(String(ev.sport || 'soccer'));
            if (evSport !== sp) return ev;
            const afterDay = applyOdds(ev, m0);
            const afterDay2 = applyOdds(afterDay, m1);
            const afterLive = applyOdds(afterDay2, liveMap);
            return afterLive;
          });
        }
      }

      const mergedRows = applyMediaProxy(merged, c.env.MEDIA_PROXY_BASE);
      ({ live, pregame } = splitEvents(mergedRows));
    }

    console.log(`[Sports] sport=${sport} → live:${live.length} pregame:${pregame.length}`);

    if (doRealtime && apiKey && (live.length > 0 || pregame.length > 0)) {
      const sportsToFetch = Array.from(
        new Set([...live, ...pregame].map((e) => normalizeSport(String(e.sport || 'soccer')))),
      ).slice(0, 6);

      for (const sp of sportsToFetch) {
        const cached = cachedLiveFixtures.get(sp);
        if (!cached || cached.expiresAt <= nowMs) {
          let list = await fetchLiveFixtures(apiKey, sp);
          if ((!Array.isArray(list) || list.length === 0) && sp !== 'soccer') {
            list = await fetchDateFixtures(apiKey, sp, new Date().toISOString().slice(0, 10));
          }
          const map = new Map<string, any>();
          for (const e of list) map.set(e.external_event_id, e);
          cachedLiveFixtures.set(sp, { expiresAt: nowMs + 30_000, map });
        }
      }

      const applySnap = (ev: any, snap: any) => {
        const st = String(snap?.status || snap?.fixture?.status?.short || '').toUpperCase().trim();
        const isLiveStatus = API_LIVE_STATUSES.has(st) || LIVE_STATUSES.has(st);
        const isFinished = FINISHED_STATUSES.has(st);
        if (isLiveStatus) ev.is_live = 1;
        if (isFinished) ev.is_live = 0;

        ev.status = snap.status || st || ev.status;
        ev.elapsed = snap.elapsed ?? ev.elapsed;
        (ev as any).timer = (snap as any).timer || (snap?.fixture?.status?.timer || '');
        ev.score = snap.score ?? ev.score;

        const homeLogo = rewriteMediaUrl(c.env.MEDIA_PROXY_BASE, String(snap.home_team_logo || snap.teams?.home?.logo || ''));
        const awayLogo = rewriteMediaUrl(c.env.MEDIA_PROXY_BASE, String(snap.away_team_logo || snap.teams?.away?.logo || ''));
        if (homeLogo) ev.home_team_logo = homeLogo;
        if (awayLogo) ev.away_team_logo = awayLogo;
        if (homeLogo || awayLogo) {
          ev.teams = {
            home: { name: ev.home_team || ev.teams?.home?.name || '', logo: homeLogo || ev.teams?.home?.logo || '' },
            away: { name: ev.away_team || ev.teams?.away?.name || '', logo: awayLogo || ev.teams?.away?.logo || '' },
          };
          ev.home = { ...(ev.home || {}), name: ev.home_team || ev.home?.name || '', logo: homeLogo || ev.home?.logo || '' };
          ev.away = { ...(ev.away || {}), name: ev.away_team || ev.away?.name || '', logo: awayLogo || ev.away?.logo || '' };
        }

        try {
          const sc = typeof snap.score === 'string' ? JSON.parse(String(snap.score || '{}')) : snap.score;
          if (sc && (sc.home != null || sc.away != null)) {
            ev.goals = { home: sc.home ?? null, away: sc.away ?? null };
            ev.score = ev.goals;
          }
        } catch { /* empty */ }

        ev.fixture = {
          ...(ev.fixture || {}),
          id: ev.external_event_id || ev.id,
          date: ev.event_date || ev.fixture?.date,
          status: { ...(ev.fixture?.status || {}), short: st || ev.fixture?.status?.short, long: st || ev.fixture?.status?.long, elapsed: ev.elapsed, timer: (ev as any).timer || '' },
          timestamp: ev.event_date ? Math.floor(new Date(ev.event_date).getTime() / 1000) : (ev.fixture?.timestamp || 0),
        };
      };

      const liveSet = new Set<string>();
      for (const ev of live) {
        const sp = normalizeSport(String(ev.sport || 'soccer'));
        const snap = cachedLiveFixtures.get(sp)?.map.get(String(ev.external_event_id || ev.id));
        if (!snap) continue;
        liveSet.add(String(ev.external_event_id || ev.id));
        applySnap(ev, snap);
      }

      for (let i = pregame.length - 1; i >= 0; i--) {
        const ev = pregame[i];
        const sp = normalizeSport(String(ev.sport || 'soccer'));
        const snap = cachedLiveFixtures.get(sp)?.map.get(String(ev.external_event_id || ev.id));
        if (!snap) continue;
        applySnap(ev, snap);
        const st = String(ev?.status?.short || ev?.status || ev?.fixture?.status?.short || '').toUpperCase().trim();
        const isLiveStatus = API_LIVE_STATUSES.has(st) || LIVE_STATUSES.has(st);
        if (Number(ev.is_live) === 1 || isLiveStatus) {
          pregame.splice(i, 1);
          live.push(ev);
          liveSet.add(String(ev.external_event_id || ev.id));
        }
      }

      for (let i = live.length - 1; i >= 0; i--) {
        const st = String(live[i]?.status?.short || live[i]?.status || live[i]?.fixture?.status?.short || '').toUpperCase().trim();
        const isLiveStatus = API_LIVE_STATUSES.has(st) || LIVE_STATUSES.has(st);
        const isFinished = FINISHED_STATUSES.has(st);
        if (isFinished || !isLiveStatus) {
          live.splice(i, 1);
        }
      }

      for (let i = live.length - 1; i >= 0; i--) {
        if (isStaleLiveEvent(live[i], nowMs)) {
          live.splice(i, 1);
        }
      }
    }

    if (doRealtime && wantsOdds && oddsKey && live.length > 0) {
      const sportsForOdds = Array.from(new Set(live.map((e) => normalizeSport(String(e.sport || 'soccer'))))).slice(0, 6);
      const oddsBySport = new Map<string, any[]>();
      for (const sp of sportsForOdds) {
        const oddsEvents = await fetchOddsApiEvents(
          oddsKey,
          sp,
          1,
          c.env.ODDS_API_BOOKMAKERS || 'Bet365,1xbet,Betano,888Sport,SportingBet',
          'live',
          Math.min(25, live.length * 2),
          2,
        );
        oddsBySport.set(sp, oddsEvents);
      }

      for (const ev of live) {
        const sp = normalizeSport(String(ev.sport || 'soccer'));
        const oddsEvents = oddsBySport.get(sp) || [];
        const best = matchOddsEvent(
          { league: String(ev.league || ''), home: String(ev.home_team || ''), away: String(ev.away_team || ''), kickoff: String(ev.event_date || '') },
          oddsEvents as any,
          sp === 'soccer' ? 92 : 85,
        );
        if (!best) continue;

        const goalsObj = (ev as any).goals || (ev as any).score || null;
        const gHome = goalsObj && typeof goalsObj === 'object' ? Number((goalsObj as any).home ?? (goalsObj as any).Home ?? NaN) : NaN;
        const gAway = goalsObj && typeof goalsObj === 'object' ? Number((goalsObj as any).away ?? (goalsObj as any).Away ?? NaN) : NaN;
        const hasGoals = Number.isFinite(gHome) && Number.isFinite(gAway);
        const leader = hasGoals ? (gHome > gAway ? 'home' : gAway > gHome ? 'away' : 'draw') : 'unknown';

        const bHome = Number(best?.home_odd || 0);
        const bDraw = Number(best?.draw_odd || 0);
        const bAway = Number(best?.away_odd || 0);
        const oddsArr = [bHome, bDraw, bAway].filter((x) => x > 1);
        const minOdd = oddsArr.length ? Math.min(...oddsArr) : Infinity;
        const leaderOdd = leader === 'home' ? bHome : leader === 'away' ? bAway : bDraw;
        const looksWrongForScore =
          sp === 'soccer' &&
          hasGoals &&
          leader !== 'draw' &&
          ((bDraw > 1 && bDraw <= minOdd * 1.05) || (leaderOdd > 1 && leaderOdd > minOdd * 1.15));

        if (best.home_odd > 1 && !looksWrongForScore) {
          ev.home_odd = best.home_odd;
          ev.draw_odd = best.draw_odd;
          ev.away_odd = best.away_odd;
          if (best.markets && best.markets.length > 0) {
            ev.markets = best.markets;
          }
        }
      }
    }

    for (let i = 0; i < live.length; i++) live[i] = ensureH2hMarketsArray(live[i]);
    for (let i = 0; i < pregame.length; i++) pregame[i] = ensureH2hMarketsArray(pregame[i]);

    return c.json({ live, pregame });
  } catch (err) {
    console.error('[Sports] /by-sport error:', err);
    return c.json({ live: [], pregame: [] }, 200);
  }
});

sports.get('/media', async (c) => {
  const url = String(c.req.query('url') || '').trim();
  if (!url.startsWith('https://media.api-sports.io/')) return c.text('bad url', 400);
  try {
    const cache = (typeof caches !== 'undefined' && (caches as any).default) ? (caches as any).default : null;
    const cacheKey = cache ? new Request(url, { method: 'GET' }) : null;
    if (cache && cacheKey) {
      const cached = await cache.match(cacheKey);
      if (cached) return cached;
    }

    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return c.text('not found', 404);
    const headers = new Headers(res.headers);
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Cache-Control', 'public, max-age=86400');
    const out = new Response(res.body, { status: 200, headers });
    if (cache && cacheKey) {
      c.executionCtx.waitUntil(cache.put(cacheKey, out.clone()));
    }
    return out;
  } catch {
    return c.text('error', 502);
  }
});

sports.get('/:id/odds', async (c) => {
  try {
    const id = c.req.param('id');
    const realtime = String(c.req.query('realtime') || '') === '1';
    const oddsKey = getOddsApiKey(c.env);
    const apiKey = getApiSportsKey(c.env);
    const parts = id.includes('_') ? id.split('_') : [];
    const sportPrefix = parts.length >= 2 ? parts[0] : 'soccer';
    const rawIdFromParam = parts.length >= 2 ? parts.slice(1).join('_') : id;
    const row = await c.env.DB
      .prepare('SELECT league, home_team, away_team, event_date, markets, home_odd, draw_odd, away_odd, is_live, elapsed, status FROM events WHERE external_event_id = ? OR CAST(id AS TEXT) = ? LIMIT 1')
      .bind(id, id)
      .first();

    if (!row) return c.json({ markets: {} });

    const r: any = row as any;
    const isLive = Number(r.is_live) === 1;
    const elapsed = Number(r.elapsed) || 0;
    const statusShortRaw = String(r.status || 'NS').trim();
    const fixtureForGuard = { status: { short: statusShortRaw }, elapsed, is_live: isLive };
    const suspended = isLive && shouldSuspendLiveOdds(fixtureForGuard);
    const suspended_reason = suspended ? (elapsed < 2 ? 'KICKOFF' : elapsed > 88 ? 'FINAL_MINUTES' : 'LIVE_GUARD') : '';

    if (realtime && oddsKey) {
      const out = await fetchOddsApiMarketsForFixture(
        oddsKey,
        { league: String(r.league || ''), home: String(r.home_team || ''), away: String(r.away_team || ''), kickoff: String(r.event_date || ''), sport: sportPrefix },
        c.env.ODDS_API_BOOKMAKERS || 'Bet365,1xbet,Betano,888Sport,SportingBet',
        'pending,live',
      );
      if (out) return c.json({ ...out, suspended, suspended_reason });
    }

    if (realtime && sportPrefix === 'soccer' && apiKey) {
      const fixtureId = Number(rawIdFromParam);
      if (Number.isFinite(fixtureId) && fixtureId > 0) {
        try {
          const qp = new URLSearchParams();
          qp.set('fixture', String(fixtureId));
          const url = `https://v3.football.api-sports.io/odds?${qp.toString()}`;
          const res = await fetch(url, {
            headers: { 'x-apisports-key': String(apiKey) },
            signal: AbortSignal.timeout(9000),
          });
          if (res.ok) {
            const data = await res.json() as any;
            const response = Array.isArray(data?.response) ? data.response : [];
            const bestByMarket = new Map<string, Map<string, { label: string; odd: number }>>();

            const normalizeKey = (k: string) => {
              const s = String(k || '').toLowerCase();
              if (s.includes('match winner') || s.includes('full time result') || s.includes('1x2') || s.includes('home/away')) return 'h2h';
              if (s.includes('double chance')) return 'double_chance';
              if (s.includes('draw no bet')) return 'dnb';
              if (s.includes('both teams') && s.includes('score')) return 'btts';
              if (s.includes('asian handicap') || s.includes('handicap') || s.includes('spread')) return 'handicap';
              if (s.includes('goals over/under') || s.includes('over/under') || s.includes('total goals')) return 'totals';
              if (s.includes('correct score') || s.includes('exact score')) return 'correct_score';
              if (s.includes('half time/full time') || s.includes('ht/ft')) return 'half_time_full_time';
              return 'specials';
            };

            for (const item of response) {
              const bookmakers = Array.isArray(item?.bookmakers) ? item.bookmakers : [];
              for (const bm of bookmakers) {
                const bets = Array.isArray(bm?.bets) ? bm.bets : [];
                for (const bet of bets) {
                  const key = normalizeKey(bet?.name || bet?.id);
                  if (!bestByMarket.has(key)) bestByMarket.set(key, new Map());
                  const best = bestByMarket.get(key)!;
                  const values = Array.isArray(bet?.values) ? bet.values : [];
                  for (const v of values) {
                    const labelRaw = String(v?.value ?? v?.label ?? v?.name ?? '').trim();
                    const odd = Number(v?.odd ?? v?.price ?? 0);
                    if (!labelRaw || !(odd > 1)) continue;
                    const lk = labelRaw.toLowerCase();
                    const prev = best.get(lk);
                    if (!prev || odd > prev.odd) best.set(lk, { label: labelRaw, odd });
                  }
                }
              }
            }

            const markets: Record<string, any[]> = {};
            for (const [key, map] of bestByMarket) {
              const arr = Array.from(map.values())
                .map((x) => ({ name: x.label, label: x.label, price: x.odd, odd: x.odd }))
                .sort((a, b) => Number(a.price) - Number(b.price))
                .slice(0, 220);
              if (arr.length > 0) markets[key] = arr;
            }

            const pick = (lbl: string) => (markets.h2h || []).find((s: any) => String(s?.label || s?.name || '').toLowerCase() === lbl)?.odd || 0;
            const home_odd = pick('home') || pick('1') || pick('casa') || 0;
            const draw_odd = pick('draw') || pick('x') || pick('empate') || 0;
            const away_odd = pick('away') || pick('2') || pick('fora') || 0;

            const out = {
              home_odd,
              draw_odd,
              away_odd,
              markets,
              updated_at: new Date().toISOString(),
              provider: 'api-sports',
            };
            if (Object.keys(markets).length > 0) return c.json({ ...out, suspended, suspended_reason });
          }
        } catch {
          /* ignore */
        }
      }
    }

    let markets: any = {};
    try { markets = JSON.parse((row as any).markets || '{}'); } catch { /* empty */ }

    const h = Number((row as any).home_odd || 0);
    const d = Number((row as any).draw_odd || 0);
    const a = Number((row as any).away_odd || 0);

    const normalizeEntry = (arr: any[]) => {
      if (!Array.isArray(arr)) return [];
      return arr
        .map((v: any) => {
          const name = String(v?.value ?? v?.name ?? v?.label ?? v?.outcome ?? '').trim();
          const price = Number(v?.odd ?? v?.price ?? v?.value ?? 0);
          if (!name || !(price > 0)) return null;
          return { name, label: name, price, odd: price };
        })
        .filter(Boolean);
    };

    const normalizeKey = (k: string) => {
      const s = String(k || '').toLowerCase();
      if (s === 'h2h') return 'h2h';
      if (s.includes('match winner') || s.includes('full time result') || s.includes('1x2') || s.includes('home/away')) return 'h2h';
      if (s.includes('double chance')) return 'double_chance';
      if (s.includes('draw no bet')) return 'dnb';
      if (s.includes('both teams') && s.includes('score')) return 'btts';
      if (s.includes('asian handicap') || s.includes('handicap') || s.includes('spread')) return 'handicap';
      if (s.includes('goals over/under') || s.includes('over/under')) {
        if (s.includes('first half') || s.includes('1st half') || s.includes('1ª parte')) return 'totals_ht';
        if (s.includes('second half') || s.includes('2nd half') || s.includes('2ª parte')) return 'totals_2h';
        return 'totals';
      }
      if (s.includes('half time result')) return 'h2h_ht';
      if (s.includes('second half winner')) return 'h2h_2h';
      if (s.includes('correct score')) return 'correct_score';
      if (s.includes('player') || s.includes('scorer') || s.includes('assist')) return 'players';
      if (s.includes('corners') || s.includes('cards') || s.includes('shots') || s.includes('fouls') || s.includes('offsides')) return 'stats';
      if (s.includes('minute') || s.includes('time') || s.includes('half') || s.includes('period')) return 'temporal';
      return 'specials';
    };

    const normalized: Record<string, any[]> = {};
    for (const [k, v] of Object.entries(markets || {})) {
      const nk = normalizeKey(k);
      const arr = normalizeEntry(Array.isArray(v) ? v : []);
      if (arr.length === 0) continue;
      if (!normalized[nk]) normalized[nk] = [];
      normalized[nk].push(...arr);
      if (normalized[nk].length > 200) normalized[nk] = normalized[nk].slice(0, 200);
    }

    const dedupeBest = (arr: any[]) => {
      const best = new Map<string, any>();
      for (const it of arr) {
        const label = String(it?.label || it?.name || '').trim();
        const price = Number(it?.price || it?.odd || 0);
        if (!label || !(price > 1)) continue;
        const k = label.toLowerCase();
        const prev = best.get(k);
        if (!prev || Number(prev.price || 0) < price) best.set(k, it);
      }
      return Array.from(best.values());
    };

    for (const k of Object.keys(normalized)) {
      normalized[k] = dedupeBest(normalized[k]).slice(0, 200);
    }

    return c.json({
      home_odd: h,
      draw_odd: d,
      away_odd: a,
      markets: normalized,
      updated_at: new Date().toISOString(),
      provider: 'db',
      suspended,
      suspended_reason,
    });
  } catch (err) {
    console.error('[Sports] /:id/odds error:', err);
    return c.json({ markets: {} });
  }
});

sports.get('/:id/stats', async (c) => {
  try {
    const id = c.req.param('id');
    const apiKey = getApiSportsKey(c.env);
    if (!apiKey) return c.json({ stats: [], events: [] });

    // Resolve external_event_id → raw fixture id (e.g. "soccer_1529480" → "1529480")
    const row = await c.env.DB
      .prepare('SELECT external_event_id FROM events WHERE external_event_id = ? OR CAST(id AS TEXT) = ? LIMIT 1')
      .bind(id, id)
      .first() as any;
    const extId = row?.external_event_id || id;
    const parts = extId.includes('_') ? extId.split('_') : [];
    const sport = parts.length >= 2 ? parts[0] : 'soccer';
    const fixtureId = parts.length >= 2 ? parts.slice(1).join('_') : extId;

    const headers = {
      'x-apisports-key': apiKey,
      'Accept': 'application/json',
    };
    const cfg = SPORT_CONFIG[sport] || SPORT_CONFIG['soccer'];
    const base = cfg.base;
    const key = cfg.fixtureKey || 'fixture';
    const statsUrl = sport === 'soccer'
      ? `${base}/fixtures/statistics?fixture=${fixtureId}`
      : `${base}${cfg.endpoint}/statistics?${key}=${fixtureId}`;
    const eventsUrl = sport === 'soccer'
      ? `${base}/fixtures/events?fixture=${fixtureId}`
      : `${base}${cfg.endpoint}/events?${key}=${fixtureId}`;
    const lineupsUrl = `${base}/fixtures/lineups?fixture=${fixtureId}`;
    const playersUrl = `${base}/fixtures/players?fixture=${fixtureId}`;

    const [statsRes, eventsRes, lineupsRes, playersRes] = await Promise.allSettled([
      fetch(statsUrl, { headers, signal: AbortSignal.timeout(8000) }),
      fetch(eventsUrl, { headers, signal: AbortSignal.timeout(8000) }),
      sport === 'soccer' ? fetch(lineupsUrl, { headers, signal: AbortSignal.timeout(8000) }) : Promise.reject(null),
      sport === 'soccer' ? fetch(playersUrl, { headers, signal: AbortSignal.timeout(8000) }) : Promise.reject(null),
    ]);

    const statsData = statsRes.status === 'fulfilled' && statsRes.value.ok
      ? await statsRes.value.json() as any : null;
    const eventsData = eventsRes.status === 'fulfilled' && eventsRes.value.ok
      ? await eventsRes.value.json() as any : null;
    const lineupsData = lineupsRes.status === 'fulfilled' && lineupsRes.value.ok
      ? await lineupsRes.value.json() as any : null;
    const playersData = playersRes.status === 'fulfilled' && playersRes.value.ok
      ? await playersRes.value.json() as any : null;

    return c.json({
      stats:  statsData?.response  || [],
      events: eventsData?.response || [],
      lineups: lineupsData?.response || [],
      players: playersData?.response || [],
    });
  } catch (err) {
    console.error('[Sports] /:id/stats error:', err);
    return c.json({ stats: [], events: [], lineups: [], players: [] });
  }
});

sports.get('/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const row = await c.env.DB
      .prepare('SELECT * FROM events WHERE external_event_id = ? OR CAST(id AS TEXT) = ? LIMIT 1')
      .bind(id, id)
      .first();

    if (!row) {
      const apiKey = getApiSportsKey(c.env);
      if (!apiKey || !id.includes('_')) return c.json({ error: 'Not found' }, 404);

      const parts = id.split('_');
      const sportPrefix = normalizeSport(parts[0] || 'soccer');
      const rawId = parts.slice(1).join('_');
      const extId = `${sportPrefix}_${rawId}`;

      const today = new Date();
      const dates: string[] = [];
      for (const off of [-1, 0, 1]) {
        const d = new Date(today);
        d.setDate(today.getDate() + off);
        dates.push(d.toISOString().slice(0, 10));
      }

      const candidates: any[] = [];
      try { candidates.push(...await fetchLiveFixtures(apiKey, sportPrefix)); } catch (err) { console.warn('[Sports] live fallback failed:', err); }
      for (const ds of dates) {
        try { candidates.push(...await fetchDateFixtures(apiKey, sportPrefix, ds)); } catch (err) { console.warn('[Sports] date fallback failed:', err); }
      }

      const found = candidates.find((e: any) => String(e?.external_event_id || '') === extId);
      if (!found) return c.json({ error: 'Not found' }, 404);

      return c.json(formatEvent(found));
    }
    const r: any = row as any;
    r.home_team_logo = rewriteMediaUrl(c.env.MEDIA_PROXY_BASE, r.home_team_logo || '');
    r.away_team_logo = rewriteMediaUrl(c.env.MEDIA_PROXY_BASE, r.away_team_logo || '');
    return c.json(formatEvent(r));
  } catch (err) {
    console.error('[Sports] /:id error:', err);
    return c.json({ error: 'Internal error' }, 500);
  }
});

export default sports;
