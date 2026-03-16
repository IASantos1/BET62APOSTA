import { Hono } from 'hono';
import { Env } from '../shared/types';
import { runSportsSync } from './services/sportsSync';
import { fetchLiveFixtures, fetchDateFixtures, fetchLiveOdds, fetchDayOdds, SPORT_CONFIG } from './services/sportsApi';
import { fetchOddsApiEvents } from './services/oddsApi';
import { PasswordService } from './services/security/passwordService';
import { TokenService } from './services/security/tokenService';

const dev = new Hono<{ Bindings: Env }>();

dev.post('/force-sync', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const sport = body.sport || 'soccer';
    console.log(`[Dev] force-sync for sport=${sport}`);

    const result = await runSportsSync(c.env, { forceFull: true });
    return c.json({ success: true, ...result });
  } catch (e: any) {
    console.error('[Dev] force-sync error:', e);
    return c.json({ error: e.message }, 500);
  }
});

dev.post('/force-import', async (c) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '');
  const isAdmin = token === c.env.ADMIN_TOKEN;
  const isDev   = c.env.ENVIRONMENT === 'dev' || c.env.ENVIRONMENT === 'development';
  if (!isAdmin && !isDev) return c.json({ error: 'Forbidden' }, 403);

  try {
    const result = await runSportsSync(c.env, { forceFull: true });
    return c.json({ success: true, ...result });
  } catch (e: any) {
    console.error('[Dev] force-import error:', e);
    return c.json({ error: e.message }, 500);
  }
});

dev.get('/force-poll', async (c) => {
  c.executionCtx.waitUntil(runSportsSync(c.env, { forceFull: true }));
  return c.json({ success: true, message: 'Sync started in background' });
});

dev.get('/debug-sync', async (c) => {
  const logs: string[] = [];
  const orig = { log: console.log, warn: console.warn, error: console.error };

  console.log = (...a) => { logs.push('[LOG] ' + a.join(' ')); orig.log(...a); };
  console.warn = (...a) => { logs.push('[WARN] ' + a.join(' ')); orig.warn(...a); };
  console.error = (...a) => { logs.push('[ERROR] ' + a.join(' ')); orig.error(...a); };

  try {
    await runSportsSync(c.env, { forceFull: true });
    return c.json({ success: true, logs });
  } catch (e: any) {
    return c.json({ error: e.message, logs }, 500);
  } finally {
    console.log = orig.log;
    console.warn = orig.warn;
    console.error = orig.error;
  }
});

dev.get('/db-stats', async (c) => {
  try {
    const [total, live, bySport, upcoming] = await Promise.all([
      c.env.DB.prepare("SELECT COUNT(*) as c FROM events").first('c'),
      c.env.DB.prepare("SELECT COUNT(*) as c FROM events WHERE is_live=1").first('c'),
      c.env.DB.prepare("SELECT sport, COUNT(*) as c FROM events GROUP BY sport ORDER BY c DESC").all(),
      c.env.DB.prepare("SELECT external_event_id, sport, home_team, away_team, event_date, status, is_live, home_odd, draw_odd, away_odd FROM events WHERE event_date >= datetime('now') ORDER BY event_date ASC LIMIT 10").all(),
    ]);
    return c.json({ total, live, bySport: bySport.results, upcoming: upcoming.results });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

dev.get('/live-api-test', async (c) => {
  try {
    const sport = c.req.query('sport') || 'soccer';
    const apiKey = c.env.API_SPORTS_KEY;
    if (!apiKey) return c.json({ error: 'No API_SPORTS_KEY' }, 500);

    const live = await fetchLiveFixtures(apiKey, sport);
    return c.json({ sport, count: live.length, sample: live.slice(0, 3) });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

dev.get('/schedule-api-test', async (c) => {
  try {
    const sport  = c.req.query('sport') || 'soccer';
    const apiKey = c.env.API_SPORTS_KEY;
    if (!apiKey) return c.json({ error: 'No API_SPORTS_KEY' }, 500);

    const today  = new Date().toISOString().slice(0, 10);
    const events = await fetchDateFixtures(apiKey, sport, today);
    return c.json({ sport, count: events.length, sample: events.slice(0, 3) });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

dev.get('/odds-api-test', async (c) => {
  try {
    const apiKey = c.env.API_SPORTS_KEY;
    if (!apiKey) return c.json({ error: 'No API_SPORTS_KEY' }, 400);

    const today    = new Date().toISOString().slice(0, 10);
    const [liveOdds, dayOdds] = await Promise.all([
      fetchLiveOdds(apiKey),
      fetchDayOdds(apiKey, today, 8, 3),
    ]);

    const liveArr  = Array.from(liveOdds.entries()).slice(0, 5).map(([id, o]) => ({ id, ...o }));
    const dayArr   = Array.from(dayOdds.entries()).slice(0, 5).map(([id, o]) => ({ id, ...o }));

    return c.json({
      live_odds_count: liveOdds.size,
      day_odds_count:  dayOdds.size,
      live_sample:     liveArr,
      day_sample:      dayArr,
    });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

dev.get('/oddsio-test', async (c) => {
  try {
    const apiKey = c.env.ODDS_API_KEY;
    if (!apiKey) return c.json({ error: 'No ODDS_API_KEY' }, 400);

    const sport = c.req.query('sport') || 'soccer';
    const events = await fetchOddsApiEvents(apiKey, sport, 3, c.env.ODDS_API_BOOKMAKERS || '', 'pending,live', 30, 3);
    return c.json({
      sport,
      count: events.length,
      with_odds: events.filter((e) => e.home_odd > 1).length,
      sample: events.slice(0, 3),
    });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

dev.get('/oddsio-bookmakers', async (c) => {
  try {
    const apiKey = c.env.ODDS_API_KEY;
    if (!apiKey) return c.json({ error: 'No ODDS_API_KEY' }, 400);
    const url = `https://api.odds-api.io/v3/bookmakers?apiKey=${apiKey}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    const text = await res.text();
    const json = (() => { try { return JSON.parse(text); } catch { return null; } })();
    const list = Array.isArray(json) ? json : [];
    const q = (c.req.query('q') || '').toLowerCase().trim();
    if (q) {
      const matches = list.filter((b: any) => String(b?.name || '').toLowerCase().includes(q));
      return c.json({ http: res.status, q, matches: matches.slice(0, 50), total: matches.length });
    }
    return c.json({ http: res.status, sample: list.slice(0, 50) });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

dev.get('/oddsio-raw', async (c) => {
  try {
    const apiKey = c.env.ODDS_API_KEY;
    if (!apiKey) return c.json({ error: 'No ODDS_API_KEY' }, 400);
    const sport = c.req.query('sport') || 'football';
    const overrideBooks = c.req.query('bookmakers') || '';
    const bookmaker = (overrideBooks || c.env.ODDS_API_BOOKMAKERS || '').split(',')[0]?.trim() || '';
    const evUrl = `https://api.odds-api.io/v3/events?apiKey=${apiKey}&sport=${encodeURIComponent(sport)}&status=pending,live&limit=5${bookmaker ? `&bookmaker=${encodeURIComponent(bookmaker)}` : ''}`;
    const evRes = await fetch(evUrl, { signal: AbortSignal.timeout(20000) });
    const evText = await evRes.text();
    const evJson = (() => { try { return JSON.parse(evText); } catch { return null; } })();
    const first = Array.isArray(evJson) ? evJson[0] : null;
    const eventId = first?.id || first?.eventId || first?.event_id || null;
    if (!eventId) return c.json({ events_http: evRes.status, events_preview: String(evText).slice(0, 600) }, 200);

    const booksCsv = overrideBooks || c.env.ODDS_API_BOOKMAKERS || '';
    const books = booksCsv ? `&bookmakers=${encodeURIComponent(booksCsv)}` : '';
    const oddsUrl = `https://api.odds-api.io/v3/odds?apiKey=${apiKey}&eventId=${encodeURIComponent(String(eventId))}${books}`;
    const oddsRes = await fetch(oddsUrl, { signal: AbortSignal.timeout(20000) });
    const oddsText = await oddsRes.text();
    const oddsJson = (() => { try { return JSON.parse(oddsText); } catch { return null; } })();
    return c.json({
      sport,
      bookmaker,
      events_http: evRes.status,
      odds_http: oddsRes.status,
      eventId: String(eventId),
      odds_preview: oddsJson || String(oddsText).slice(0, 1200),
    });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

dev.post('/seed-test-events', async (c) => {
  try {
    const now = new Date();
    const testEvents = [
      { id: 'test_live_1',    home: 'Benfica',        away: 'Porto',         minutesFromNow: -35,  isLive: 1, status: '1H' },
      { id: 'test_live_2',    home: 'Barcelona',      away: 'Real Madrid',   minutesFromNow: -15,  isLive: 1, status: '2H' },
      { id: 'test_pre_1',     home: 'Manchester Utd', away: 'Liverpool',     minutesFromNow: 60,   isLive: 0, status: 'NS' },
      { id: 'test_pre_2',     home: 'PSG',            away: 'Marseille',     minutesFromNow: 180,  isLive: 0, status: 'NS' },
      { id: 'test_pre_3',     home: 'Juventus',       away: 'AC Milan',      minutesFromNow: 1440, isLive: 0, status: 'NS' },
    ];

    for (const e of testEvents) {
      const eventDate = new Date(now.getTime() + e.minutesFromNow * 60000).toISOString();
      await c.env.DB.prepare(`
        INSERT INTO events (external_event_id, sport, league, home_team, away_team, team_match, event_date, status, is_live, home_odd, draw_odd, away_odd, elapsed, score, markets, updated_at)
        VALUES (?, 'soccer', 'Test League', ?, ?, ?, ?, ?, ?, 1.85, 3.40, 4.20, ?, '{"home":null,"away":null}', '{}', datetime('now'))
        ON CONFLICT(external_event_id) DO UPDATE SET
          status=excluded.status, is_live=excluded.is_live, event_date=excluded.event_date, elapsed=excluded.elapsed, updated_at=excluded.updated_at
      `).bind(e.id, e.home, e.away, `${e.home} vs ${e.away}`, eventDate, e.status, e.isLive, e.isLive ? Math.abs(e.minutesFromNow) : 0).run();
    }

    return c.json({ success: true, seeded: testEvents.length });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

dev.get('/token-test', async (c) => {
  try {
    const secret = c.env.JWT_SECRET || 'dev-secret';
    const tokenService = new TokenService(secret);
    const token = await tokenService.createAccessToken('dev-test');
    return c.json({ token });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

dev.delete('/clear-events', async (c) => {
  try {
    const r = await c.env.DB.prepare("DELETE FROM events WHERE external_event_id LIKE 'test_%'").run();
    return c.json({ deleted: r.meta.changes });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

dev.get('/paypal-debug', async (c) => {
  const clientId     = c.env.PAYPAL_CLIENT_ID     || '(missing)';
  const clientSecret = c.env.PAYPAL_CLIENT_SECRET || '(missing)';
  const paypalEnv    = c.env.PAYPAL_ENVIRONMENT   || '(missing)';
  const baseUrl      = (paypalEnv === 'live' || paypalEnv === 'production')
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';

  const credentials = `${clientId}:${clientSecret}`;
  const auth        = btoa(credentials);

  const res = await fetch(`${baseUrl}/v1/oauth2/token`, {
    method: 'POST',
    body: 'grant_type=client_credentials',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  });
  const body = await res.text();

  return c.json({
    baseUrl,
    paypalEnv,
    clientIdPrefix:     clientId.slice(0, 8) + '...',
    clientSecretPrefix: clientSecret.slice(0, 8) + '...',
    credentialsLength:  credentials.length,
    httpStatus:         res.status,
    response:           body,
  });
});

dev.get('/test-odds', async (c) => {
  const apiKey = c.env.API_SPORTS_KEY || '';
  const date   = new Date().toISOString().split('T')[0];

  // Test 1: fetch /odds?date=TODAY&bookmaker=8&page=1
  const url1 = `https://v3.football.api-sports.io/odds?date=${date}&bookmaker=8&page=1`;
  let r1: any = null;
  try {
    const res = await fetch(url1, { headers: { 'x-apisports-key': apiKey } });
    r1 = await res.json();
  } catch (e: any) { r1 = { error: e.message }; }

  // Test 2: fetch /odds/live (should have live events)
  let r2: any = null;
  try {
    const res = await fetch('https://v3.football.api-sports.io/odds/live', { headers: { 'x-apisports-key': apiKey } });
    r2 = await res.json();
  } catch (e: any) { r2 = { error: e.message }; }

  return c.json({
    date,
    apiKeyPrefix: apiKey.slice(0, 8) + '...',
    pregame: {
      url: url1,
      errors: r1?.errors,
      total: r1?.results,
      sampleIds: (r1?.response || []).slice(0, 3).map((i: any) => ({
        id: i.fixture?.id,
        bookmakers: (i.bookmakers || []).map((b: any) => ({ id: b.id, name: b.name, betsCount: b.bets?.length }))
      })),
    },
    live: {
      errors: r2?.errors,
      total: r2?.results,
      sampleIds: (r2?.response || []).slice(0, 3).map((i: any) => i.fixture?.id),
    },
  });
});

export default dev;
