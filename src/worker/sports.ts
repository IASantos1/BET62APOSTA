/**
 * sports.ts — Router de eventos desportivos
 * Serve live e pré-jogo da tabela `events`.
 */

import { Hono } from 'hono';
import { Env } from '../shared/types';

const sports = new Hono<{ Bindings: Env }>();

const LIVE_STATUSES = new Set([
  '1H', '2H', 'HT', 'ET', 'P', 'LIVE',
  'Q1', 'Q2', 'Q3', 'Q4', 'OT', 'BT',
  'S1', 'S2', 'S3', 'S4', 'S5',
  'IN', 'IN1', 'IN2', 'IN3', 'IN4', 'IN5', 'IN6', 'IN7', 'IN8', 'IN9',
]);

const FINISHED_STATUSES = new Set([
  'FT', 'AET', 'PEN', 'AWD', 'WO', 'ABD', 'AOT', 'AP',
  'Finished', 'Match Finished', 'Final', 'Ended',
]);

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
  handebol:           'handball',
  voleibol:           'volleyball',
};

function normalizeSport(raw: string): string {
  const s = raw.toLowerCase().trim();
  return SPORT_ALIASES[s] ?? s;
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

    // Never show finished games in live, regardless of is_live flag
    if (isFinished) {
      const d = r.event_date ? new Date(r.event_date).getTime() : 0;
      if (!d || d < now - 3 * 60 * 60 * 1000) continue;
      pregame.push(formatEvent(r));
      continue;
    }

    if (isLiveFlag || isLiveStatus) {
      const d = r.event_date ? new Date(r.event_date).getTime() : 0;
      // Exclude stale NS/PST events flagged as live but started >2h ago
      const statusStr = String(r.status || 'NS').trim();
      if (d && d < now - 4 * 60 * 60 * 1000 && !isLiveStatus) continue;
      if ((statusStr === 'NS' || statusStr === 'PST' || statusStr === 'TBD') && d && d < now - 2 * 60 * 60 * 1000) continue;
      live.push(formatEvent(r));
      continue;
    }

    const d = r.event_date ? new Date(r.event_date).getTime() : 0;
    if (!d) continue;
    if (d < now - 3 * 60 * 60 * 1000) continue;
    if (d > now + 14 * 24 * 60 * 60 * 1000) continue;

    pregame.push(formatEvent(r));
  }

  return { live, pregame };
}

function formatEvent(r: any): any {
  let markets: any = {};
  try { markets = JSON.parse(r.markets || '{}'); } catch { /* empty */ }

  const h2h = markets.h2h || [];
  let home_odd = Number(r.home_odd) || 0;
  let draw_odd = Number(r.draw_odd) || 0;
  let away_odd = Number(r.away_odd) || 0;

  if (Array.isArray(h2h) && h2h.length >= 2) {
    for (const o of h2h) {
      const v = String(o.value || o.outcome || '');
      const odd = parseFloat(o.odd ?? o.price ?? 0);
      if (odd <= 1) continue;
      if (v === 'Home' || v === '1' || v.toLowerCase() === 'home') home_odd = odd;
      else if (v === 'Draw' || v === 'X' || v.toLowerCase() === 'draw') draw_odd = odd;
      else if (v === 'Away' || v === '2' || v.toLowerCase() === 'away') away_odd = odd;
    }
  }

  let goals = { home: null as number | null, away: null as number | null };
  try {
    const sc = r.score ? JSON.parse(r.score) : null;
    if (sc) { goals.home = sc.home ?? null; goals.away = sc.away ?? null; }
  } catch { /* empty */ }

  const statusShort = String(r.status || 'NS').trim();
  const id = r.external_event_id || String(r.id);

  return {
    id,
    external_event_id: id,
    sport:      r.sport || 'soccer',
    league:     r.league || '',
    home_team:  r.home_team || '',
    away_team:  r.away_team || '',
    match:      `${r.home_team || ''} vs ${r.away_team || ''}`,
    event_date: r.event_date,
    date:       r.event_date,
    is_live:    Number(r.is_live) || 0,
    status:     { short: statusShort, long: statusShort, elapsed: Number(r.elapsed) || 0 },
    elapsed:    Number(r.elapsed) || 0,
    goals,
    score:      goals,
    home_odd,
    draw_odd,
    away_odd,
    markets,
    fixture: {
      id,
      date:   r.event_date,
      status: { short: statusShort, long: statusShort, elapsed: Number(r.elapsed) || 0 },
      timestamp: r.event_date ? Math.floor(new Date(r.event_date).getTime() / 1000) : 0,
    },
    home:  { name: r.home_team || '', logo: r.home_team_logo || '' },
    away:  { name: r.away_team || '', logo: r.away_team_logo || '' },
    odds: { h2h: Array.isArray(h2h) ? h2h : [] },
  };
}

sports.get('/by-sport', async (c) => {
  try {
    const rawSport = c.req.query('sports') || c.req.query('sport') || 'soccer';
    const sport = normalizeSport(rawSport.split(',')[0]);
    const isAll = sport === 'all';

    let query = `
      SELECT *
      FROM events
      WHERE (
        (is_live = 1 AND event_date > datetime('now', '-5 hours'))
        OR event_date BETWEEN datetime('now', '-1 hours') AND datetime('now', '+7 days')
      )
      AND status NOT IN ('FT','AET','PEN','AWD','WO','ABD','Finished','Match Finished','Final','Ended','AOT','AP','POST','SUSP','CANC','TBD')
      AND league NOT IN ('Test League','Test','Debug League','Copa Alagoas')
      AND league NOT LIKE 'Test%'
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
        CASE WHEN home_odd > 0 THEN 0 ELSE 1 END ASC,
        event_date ASC
      LIMIT 500
    `;

    const res = await c.env.DB.prepare(query).bind(...params).all();
    const rows = res.results || [];

    const { live, pregame } = splitEvents(rows);
    console.log(`[Sports] sport=${sport} → live:${live.length} pregame:${pregame.length}`);

    return c.json({ live, pregame });
  } catch (err) {
    console.error('[Sports] /by-sport error:', err);
    return c.json({ live: [], pregame: [] }, 200);
  }
});

sports.get('/:id/odds', async (c) => {
  try {
    const id = c.req.param('id');
    const row = await c.env.DB
      .prepare('SELECT markets, home_odd, draw_odd, away_odd FROM events WHERE external_event_id = ? OR CAST(id AS TEXT) = ? LIMIT 1')
      .bind(id, id)
      .first();

    if (!row) return c.json({ markets: {} });

    let markets: any = {};
    try { markets = JSON.parse((row as any).markets || '{}'); } catch { /* empty */ }

    // Garantir h2h no markets com as odds principais
    if (!(markets.h2h?.length) && (row as any).home_odd > 0) {
      markets.h2h = [
        { value: 'Home', odd: String((row as any).home_odd) },
        { value: 'Draw', odd: String((row as any).draw_odd) },
        { value: 'Away', odd: String((row as any).away_odd) },
      ];
    }

    return c.json({ markets });
  } catch (err) {
    console.error('[Sports] /:id/odds error:', err);
    return c.json({ markets: {} });
  }
});

sports.get('/:id/stats', async (c) => {
  try {
    const id = c.req.param('id');
    const apiKey = c.env.API_SPORTS_KEY;
    if (!apiKey) return c.json({ stats: [], events: [] });

    // Resolve external_event_id → raw fixture id (e.g. "soccer_1529480" → "1529480")
    const row = await c.env.DB
      .prepare('SELECT external_event_id FROM events WHERE external_event_id = ? OR CAST(id AS TEXT) = ? LIMIT 1')
      .bind(id, id)
      .first() as any;
    const extId = row?.external_event_id || id;
    const fixtureId = extId.includes('_') ? extId.split('_').slice(1).join('_') : extId;

    const headers = {
      'x-apisports-key': apiKey,
      'x-rapidapi-key': apiKey,
      'Accept': 'application/json',
    };
    const base = 'https://v3.football.api-sports.io';

    const [statsRes, eventsRes] = await Promise.allSettled([
      fetch(`${base}/fixtures/statistics?fixture=${fixtureId}`, { headers, signal: AbortSignal.timeout(8000) }),
      fetch(`${base}/fixtures/events?fixture=${fixtureId}`, { headers, signal: AbortSignal.timeout(8000) }),
    ]);

    const statsData = statsRes.status === 'fulfilled' && statsRes.value.ok
      ? await statsRes.value.json() as any : null;
    const eventsData = eventsRes.status === 'fulfilled' && eventsRes.value.ok
      ? await eventsRes.value.json() as any : null;

    return c.json({
      stats:  statsData?.response  || [],
      events: eventsData?.response || [],
    });
  } catch (err) {
    console.error('[Sports] /:id/stats error:', err);
    return c.json({ stats: [], events: [] });
  }
});

sports.get('/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const row = await c.env.DB
      .prepare('SELECT * FROM events WHERE external_event_id = ? OR CAST(id AS TEXT) = ? LIMIT 1')
      .bind(id, id)
      .first();

    if (!row) return c.json({ error: 'Not found' }, 404);
    return c.json(formatEvent(row));
  } catch (err) {
    console.error('[Sports] /:id error:', err);
    return c.json({ error: 'Internal error' }, 500);
  }
});

export default sports;
