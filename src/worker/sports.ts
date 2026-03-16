/**
 * sports.ts — Router de eventos desportivos
 * Serve live e pré-jogo da tabela `events`.
 */

import { Hono } from 'hono';
import { Env } from '../shared/types';
import { fetchOddsApiEvents, fetchOddsApiMarketsForFixture, matchOddsEvent } from './services/oddsApi';
import { fetchLiveOddsForSport } from './services/sportsApi';
import { fetchLiveFixtures, fetchDateFixtures, LIVE_STATUSES as API_LIVE_STATUSES } from './services/sportsApi';

let cachedLiveOdds: { expiresAt: number; map: Map<string, any> } | null = null;
const cachedLiveFixtures = new Map<string, { expiresAt: number; map: Map<string, any> }>();
const cachedLiveOddsBySport = new Map<string, { expiresAt: number; map: Map<string, any> }>();

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

  const goals = { home: null as number | null, away: null as number | null };
  try {
    const sc = r.score ? JSON.parse(r.score) : null;
    if (sc) { goals.home = sc.home ?? null; goals.away = sc.away ?? null; }
  } catch { /* empty */ }

  const statusShort = String(r.status || 'NS').trim();
  const id = r.external_event_id || String(r.id);
  const marketsArr: any[] = [];
  const h2hSelections: any[] = [];

  if (home_odd > 1) h2hSelections.push({ id: 'sel_home', label: 'Casa', name: 'Casa', odd: home_odd });
  if (draw_odd > 1) h2hSelections.push({ id: 'sel_draw', label: 'Empate', name: 'Empate', odd: draw_odd });
  if (away_odd > 1) h2hSelections.push({ id: 'sel_away', label: 'Fora', name: 'Fora', odd: away_odd });

  if (h2hSelections.length >= 2) {
    marketsArr.push({ id: 'mkt_h2h', key: 'h2h', name: 'Resultado Final', selections: h2hSelections });
  }

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
    status:     { short: statusShort, long: statusShort, elapsed: Number(r.elapsed) || 0 },
    elapsed:    Number(r.elapsed) || 0,
    goals,
    score:      goals,
    home_odd,
    draw_odd,
    away_odd,
    markets: marketsArr,
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

function rewriteMediaUrl(proxyBase: string | undefined, url: string): string {
  const base = String(proxyBase || '').trim().replace(/\/+$/, '');
  if (!base) return url;
  const u = String(url || '').trim();
  if (!u) return u;
  if (!u.startsWith('https://media.api-sports.io/')) return u;
  return base + u.slice('https://media.api-sports.io'.length);
}

function applyMediaProxy(rows: any[], proxyBase: string | undefined): any[] {
  if (!proxyBase) return rows;
  return rows.map((r) => ({
    ...r,
    home_team_logo: rewriteMediaUrl(proxyBase, r.home_team_logo || ''),
    away_team_logo: rewriteMediaUrl(proxyBase, r.away_team_logo || ''),
  }));
}

sports.get('/by-sport', async (c) => {
  try {
    const rawSport = c.req.query('sports') || c.req.query('sport') || 'soccer';
    const sport = normalizeSport(rawSport.split(',')[0]);
    const isAll = sport === 'all';
    const include = String(c.req.query('include') || '');
    const wantsOdds = include.split(',').map((s) => s.trim()).includes('odds');
    const realtime = String(c.req.query('realtime') || '') === '1';
    const nowMs = Date.now();

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
      AND lower(league) NOT LIKE '%serie c%'
      AND lower(league) NOT LIKE '%série c%'
      AND lower(league) NOT LIKE '%serie d%'
      AND lower(league) NOT LIKE '%série d%'
    `;
    const params: any[] = [];
    const soccerOddsFilter = `
      (
        CAST(home_odd AS REAL) > 1
        OR CAST(draw_odd AS REAL) > 1
        OR CAST(away_odd AS REAL) > 1
      )
    `;

    if (!isAll) {
      query += ' AND sport = ?';
      params.push(sport);
      if (sport === 'soccer') {
        query += ` AND ${soccerOddsFilter}`;
      }
    } else {
      query += ` AND (sport != 'soccer' OR ${soccerOddsFilter})`;
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
        event_date ASC
      LIMIT 500
    `;

    const res = await c.env.DB.prepare(query).bind(...params).all();
    const rows = applyMediaProxy(res.results || [], c.env.MEDIA_PROXY_BASE);

    const { live, pregame } = splitEvents(rows);
    console.log(`[Sports] sport=${sport} → live:${live.length} pregame:${pregame.length}`);

    if (realtime && c.env.API_SPORTS_KEY && live.length > 0) {
      const liveSports = Array.from(new Set(live.map((e) => normalizeSport(String(e.sport || 'soccer'))))).slice(0, 4);
      for (const sp of liveSports) {
        const cacheKey = sp;
        const cached = cachedLiveFixtures.get(cacheKey);
        if (!cached || cached.expiresAt <= nowMs) {
          let list = await fetchLiveFixtures(c.env.API_SPORTS_KEY, sp);
          if ((!Array.isArray(list) || list.length === 0) && sp !== 'soccer') {
            list = await fetchDateFixtures(c.env.API_SPORTS_KEY, sp, new Date().toISOString().slice(0, 10));
          }
          const map = new Map<string, any>();
          for (const e of list) map.set(e.external_event_id, e);
          cachedLiveFixtures.set(cacheKey, { expiresAt: nowMs + 10_000, map });
        }
      }

      const liveSet = new Set<string>();
      for (const ev of live) {
        const sp = normalizeSport(String(ev.sport || 'soccer'));
        const snap = cachedLiveFixtures.get(sp)?.map.get(String(ev.external_event_id || ev.id));
        if (!snap) continue;
        liveSet.add(String(ev.external_event_id || ev.id));

        ev.status = snap.status;
        ev.elapsed = snap.elapsed;
        (ev as any).timer = (snap as any).timer || '';
        ev.score = snap.score;
        try {
          const sc = JSON.parse(String(snap.score || '{}'));
          ev.goals = { home: sc.home ?? null, away: sc.away ?? null };
          ev.fixture = {
            ...(ev.fixture || {}),
            status: { ...(ev.fixture?.status || {}), short: snap.status, long: snap.status, elapsed: snap.elapsed, timer: (snap as any).timer || '' },
          };
        } catch { /* empty */ }
      }

      for (let i = live.length - 1; i >= 0; i--) {
        const status = String(live[i]?.status || live[i]?.fixture?.status?.short || '').trim();
        const isLiveStatus = API_LIVE_STATUSES.has(status) || LIVE_STATUSES.has(status);
        const extId = String(live[i]?.external_event_id || live[i]?.id || '');
        if (!isLiveStatus && extId && !liveSet.has(extId)) {
          live.splice(i, 1);
        }
      }
    }

    if (realtime && wantsOdds && c.env.API_SPORTS_KEY && live.length > 0) {
      const liveSportsForOdds = Array.from(new Set(live.map((e) => normalizeSport(String(e.sport || 'soccer'))))).slice(0, 4);
      for (const sp of liveSportsForOdds) {
        const cached = cachedLiveOddsBySport.get(sp);
        if (!cached || cached.expiresAt <= nowMs) {
          const map = await fetchLiveOddsForSport(c.env.API_SPORTS_KEY, sp);
          cachedLiveOddsBySport.set(sp, { expiresAt: nowMs + 10_000, map });
        }
      }

      for (const ev of live) {
        const sp = normalizeSport(String(ev.sport || 'soccer'));
        const rawId = String(ev.external_event_id || ev.id || '').split('_').slice(1).join('_');
        const o = rawId ? cachedLiveOddsBySport.get(sp)?.map.get(rawId) : null;
        if (!o || !(Number(o.home || 0) > 1)) continue;

        ev.home_odd = o.home;
        ev.draw_odd = o.draw;
        ev.away_odd = o.away;

        const h2h = Array.isArray(o.markets?.h2h) ? o.markets.h2h : [];
        if (h2h.length >= 2) {
          ev.markets = [
            {
              id: 'mkt_h2h',
              key: 'h2h',
              name: 'Resultado Final',
              outcomes: h2h,
              selections: h2h
                .map((x: any) => {
                  const v = String(x.value || x.name || x.outcome || '').toLowerCase();
                  const odd = Number(x.odd ?? x.price ?? x.value ?? 0);
                  if (!(odd > 1)) return null;
                  if (v === 'home' || v === '1') return { id: 'sel_home', label: 'Casa', name: 'Casa', odd };
                  if (v === 'draw' || v === 'x') return { id: 'sel_draw', label: 'Empate', name: 'Empate', odd };
                  if (v === 'away' || v === '2') return { id: 'sel_away', label: 'Fora', name: 'Fora', odd };
                  return null;
                })
                .filter(Boolean),
            },
          ];
        }
      }

      if (c.env.ODDS_API_KEY && (sport === 'soccer' || isAll)) {
        const oddsEvents = await fetchOddsApiEvents(
          c.env.ODDS_API_KEY,
          'soccer',
          1,
          c.env.ODDS_API_BOOKMAKERS || 'Bet365,1xbet,Betano,888Sport,SportingBet',
          'live',
          Math.min(20, live.length * 3),
          3,
        );

        for (const ev of live) {
          const best = matchOddsEvent(
            { league: String(ev.league || ''), home: String(ev.home_team || ''), away: String(ev.away_team || ''), kickoff: String(ev.event_date || '') },
            oddsEvents,
            70,
          );
          if (best && best.home_odd > 1) {
            ev.home_odd = best.home_odd;
            ev.draw_odd = best.draw_odd;
            ev.away_odd = best.away_odd;
            if (best.markets && best.markets.length > 0) {
              ev.markets = best.markets;
            }
          }
        }
      }
    }

    return c.json({ live, pregame });
  } catch (err) {
    console.error('[Sports] /by-sport error:', err);
    return c.json({ live: [], pregame: [] }, 200);
  }
});

sports.get('/:id/odds', async (c) => {
  try {
    const id = c.req.param('id');
    const realtime = String(c.req.query('realtime') || '') === '1';
    const row = await c.env.DB
      .prepare('SELECT league, home_team, away_team, event_date, markets, home_odd, draw_odd, away_odd FROM events WHERE external_event_id = ? OR CAST(id AS TEXT) = ? LIMIT 1')
      .bind(id, id)
      .first();

    if (!row) return c.json({ markets: {} });

    if (realtime && c.env.ODDS_API_KEY) {
      const r: any = row as any;
      const out = await fetchOddsApiMarketsForFixture(
        c.env.ODDS_API_KEY,
        { league: String(r.league || ''), home: String(r.home_team || ''), away: String(r.away_team || ''), kickoff: String(r.event_date || ''), sport: 'soccer' },
        c.env.ODDS_API_BOOKMAKERS || 'Bet365,1xbet,Betano,888Sport,SportingBet',
        'pending,live',
      );
      if (out) return c.json(out);
    }

    if (realtime && c.env.API_SPORTS_KEY) {
      const nowMs = Date.now();
      if (!cachedLiveOdds || cachedLiveOdds.expiresAt <= nowMs) {
        const map = await fetchLiveOddsForSport(c.env.API_SPORTS_KEY, 'soccer');
        cachedLiveOdds = { expiresAt: nowMs + 10_000, map };
      }
      const rawId = String((row as any).external_event_id || id).split('_').slice(1).join('_');
      const o = rawId ? cachedLiveOdds.map.get(rawId) : null;
      if (o && Number(o.home || 0) > 1) {
        const h2h = Array.isArray(o.markets?.h2h) ? o.markets.h2h : [];
        return c.json({
          home_odd: o.home,
          draw_odd: o.draw,
          away_odd: o.away,
          markets: { h2h },
          updated_at: new Date().toISOString(),
          provider: 'api-football',
        });
      }
    }

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

    return c.json({
      home_odd: h,
      draw_odd: d,
      away_odd: a,
      markets: normalized,
      updated_at: new Date().toISOString(),
      provider: 'db',
    });
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
      'Accept': 'application/json',
    };
    const base = 'https://v3.football.api-sports.io';

    const [statsRes, eventsRes, lineupsRes, playersRes] = await Promise.allSettled([
      fetch(`${base}/fixtures/statistics?fixture=${fixtureId}`, { headers, signal: AbortSignal.timeout(8000) }),
      fetch(`${base}/fixtures/events?fixture=${fixtureId}`, { headers, signal: AbortSignal.timeout(8000) }),
      fetch(`${base}/fixtures/lineups?fixture=${fixtureId}`, { headers, signal: AbortSignal.timeout(8000) }),
      fetch(`${base}/fixtures/players?fixture=${fixtureId}`, { headers, signal: AbortSignal.timeout(8000) }),
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

    if (!row) return c.json({ error: 'Not found' }, 404);
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
