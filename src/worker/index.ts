import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { upgradeWebSocket } from 'hono/cloudflare-workers';
import { Env } from '../shared/types';
import { cacheControl } from './middleware/cache';
import { runSportsSync } from './services/sportsSync';
import { getApiSportsKey, getFrontendUrl, getOddsApiKey } from './services/env';

import wallet from './wallet';
import bets from './bets';
import auth from './auth';
import users from './users';
import favorites from './favorites';
import promotions from './promotions';
import dev from './dev';
import admin from './admin';
import trading from './trading';
import deposits from './deposits';
import metrics from './metrics';
import sports from './sports';

import { MARKET_CONFIG, MARKET_GROUPS } from './config/marketConfig';
import { processWithdrawals } from './jobs';
import { processSettlements } from './services/settlement';

console.log('[Worker] Starting up...');

const app = new Hono<{ Bindings: Env }>();

// ── CORS ──────────────────────────────────────────────────────────────
app.use('*', cors({
  origin: (origin) => {
    if (!origin) return '*';
    const o = String(origin);
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o)) return o;
    if (o === 'https://bet62.pt') return o;
    if (o === 'https://bet62apostasesportivas.bet62.workers.dev') return o;
    return 'https://bet62.pt';
  },
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

// ── Request logger ────────────────────────────────────────────────────
app.use('*', async (c, next) => {
  console.log(`[Worker] ${c.req.method} ${c.req.path}`);
  await next();
});

app.post('/api/admin/force-sync', async (c) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '');
  const isAdmin = token === c.env.ADMIN_TOKEN;
  const isDev   = c.env.ENVIRONMENT === 'dev' || c.env.ENVIRONMENT === 'development';
  if (!isAdmin && !isDev) return c.json({ error: 'Forbidden' }, 403);

  c.executionCtx.waitUntil(runSportsSync(c.env, { forceFull: true }));
  return c.json({ status: 'sync started' });
});

app.post('/api/admin/force-sync-wait', async (c) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '');
  const isAdmin = token === c.env.ADMIN_TOKEN;
  const isDev   = c.env.ENVIRONMENT === 'dev' || c.env.ENVIRONMENT === 'development';
  if (!isAdmin && !isDev) return c.json({ error: 'Forbidden' }, 403);

  try {
    const result = await runSportsSync(c.env, { forceFull: true });
    return c.json({ ok: true, ...result });
  } catch (err: any) {
    return c.json({ ok: false, error: String(err?.message || err) }, 500);
  }
});

// ── Domain routers ────────────────────────────────────────────────────
app.route('/api/auth',       auth);
app.route('/api/bets',       bets);
app.route('/api/wallet',     wallet);
app.route('/api/admin',      admin);
app.route('/api/users',      users);
app.route('/api/favorites',  favorites);
app.route('/api/promotions', promotions);
app.route('/api/deposits',   deposits);
app.route('/api/trading',    trading);
app.route('/api/metrics',    metrics);
app.route('/api/dev',        dev);
app.route('/api/events',     sports);

// ── Static / config endpoints ─────────────────────────────────────────
app.get('/api/sports', cacheControl({ maxAge: 300, staleWhileRevalidate: 600 }), (c) => {
  return c.json([
    { id: 'soccer',           name: 'Futebol',            active: true  },
    { id: 'basketball',       name: 'Basquetebol',         active: true  },
    { id: 'tennis',           name: 'Tênis',               active: true  },
    { id: 'ice-hockey',       name: 'Hóquei no Gelo',      active: true  },
    { id: 'mma',              name: 'MMA',                 active: true  },
    { id: 'american-football',name: 'Futebol Americano',   active: true  },
    { id: 'baseball',         name: 'Beisebol',            active: true  },
    { id: 'handball',         name: 'Handebol',            active: true  },
    { id: 'rugby',            name: 'Rúgbi',               active: true  },
    { id: 'volleyball',       name: 'Voleibol',            active: true  },
    { id: 'formula1',         name: 'Fórmula 1',           active: true  },
    { id: 'boxing',           name: 'Boxe',                active: true  },
  ]);
});

app.get('/api/config/markets', cacheControl({ maxAge: 3600, staleWhileRevalidate: 7200 }), (c) => {
  return c.json({ MARKET_CONFIG, MARKET_GROUPS });
});

app.get('/api/pricing/config', (c) => {
  return c.json({
    margin_pregame: 0.05,
    margin_live:    0.08,
    min_stake:      1,
    max_stake:      1000,
    currency:       'EUR',
  });
});

app.get('/api/health', (c) => c.json({ status: 'ok', ts: new Date().toISOString() }));
app.get('/api/dev/time', async (c) => {
  const jsNow = new Date().toISOString();
  const db = await c.env.DB.prepare(`SELECT datetime('now') as now, datetime('now','localtime') as local_now`).first();
  return c.json({ jsNow, dbNow: db?.now || null, dbLocalNow: db?.local_now || null });
});

app.get('/', (c) => {
  const isProd = c.env.ENVIRONMENT === 'production';
  const frontendUrl = getFrontendUrl(c.env);
  if (isProd && frontendUrl) {
    return c.redirect(frontendUrl, 302);
  }
  return c.json({
    ok: true,
    name: 'BET62 Worker API',
    env: c.env.ENVIRONMENT,
    endpoints: [
      '/api/health',
      '/api/sports',
      '/api/events/by-sport',
      '/api/debug/db-status?key=...',
      '/api/debug/env-check?key=...',
    ],
  });
});

// ── Featured games (alias for by-sport live) ──────────────────────────
app.get('/api/featured-games', cacheControl({ maxAge: 30, staleWhileRevalidate: 60 }), async (c) => {
  try {
    const eventDt = `datetime(replace(substr(event_date, 1, 19), 'T', ' '))`;
    const res = await c.env.DB.prepare(`
      SELECT * FROM events
      WHERE is_live = 1
        OR ${eventDt} BETWEEN datetime('now', '-3 hours') AND datetime('now', '+48 hours')
      ORDER BY is_live DESC, ${eventDt} ASC
      LIMIT 30
    `).all();
    return c.json(res.results || []);
  } catch (err) {
    console.error('[featured-games] error:', err);
    return c.json([]);
  }
});

function sportToDisplayName(sport: string): string {
  const s = String(sport || '').toLowerCase();
  if (s === 'soccer') return 'Futebol';
  if (s === 'basketball' || s === 'nba') return 'Basquetebol';
  if (s === 'baseball') return 'Basebol';
  if (s === 'ice-hockey') return 'Hóquei';
  if (s === 'american-football') return 'NFL';
  if (s === 'handball') return 'Handebol';
  if (s === 'volleyball') return 'Voleibol';
  if (s === 'rugby') return 'Rúgbi';
  return sport || 'Futebol';
}

function formatKickoffTime(dateStr: string): string {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '--:--';
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

function parseScore(score: any): { homeScore?: number; awayScore?: number } {
  try {
    const sc = typeof score === 'string' ? JSON.parse(score) : score;
    const h = sc?.home;
    const a = sc?.away;
    const hn = typeof h === 'number' ? h : (h != null ? Number(h) : NaN);
    const an = typeof a === 'number' ? a : (a != null ? Number(a) : NaN);
    return {
      homeScore: Number.isFinite(hn) ? hn : undefined,
      awayScore: Number.isFinite(an) ? an : undefined,
    };
  } catch {
    return {};
  }
}

function rowToMatch(r: any): any {
  const id = String(r.external_event_id || r.id || '');
  const sport = sportToDisplayName(String(r.sport || 'soccer'));
  const isLive = Number(r.is_live || 0) === 1;
  const elapsed = typeof r.elapsed === 'number' ? r.elapsed : Number(r.elapsed || 0) || 0;
  const statusShort = String(r.status || '');
  const { homeScore, awayScore } = parseScore(r.score);
  const startTime = String(r.event_date || '');
  const homeOdd = Number(r.home_odd || 0);
  const awayOdd = Number(r.away_odd || 0);
  const drawOdd = Number(r.draw_odd || 0);
  const hasOdds = homeOdd > 1.01 && awayOdd > 1.01;
  if (!hasOdds) return null;

  return {
    id,
    fixtureId: (() => {
      const raw = id.includes('_') ? id.split('_').slice(1).join('_') : id;
      const n = parseInt(raw, 10);
      return Number.isFinite(n) ? n : undefined;
    })(),
    sport,
    league: String(r.league || ''),
    country: String(r.country || ''),
    homeTeam: String(r.home_team || ''),
    awayTeam: String(r.away_team || ''),
    homeScore,
    awayScore,
    status: statusShort,
    statusShort,
    startTime,
    time: isLive ? (elapsed > 0 ? `${elapsed}'` : 'AO VIVO') : formatKickoffTime(startTime),
    elapsed: elapsed || undefined,
    period: statusShort || undefined,
    isLive,
    homeTeamLogo: String(r.home_team_logo || ''),
    awayTeamLogo: String(r.away_team_logo || ''),
    odds: {
      home: homeOdd,
      draw: drawOdd > 1.01 ? drawOdd : 0,
      away: awayOdd,
    },
  };
}

app.get('/api/matches/live', async (c) => {
  try {
    const res = await c.env.DB.prepare(`
      SELECT *
      FROM events
      WHERE is_live = 1
        AND COALESCE(status, 'NS') NOT IN ('FT','AET','PEN','AWD','WO','ABD','Finished','Match Finished','Final','Ended','AOT','AP','POST','SUSP','CANC','TBD')
      ORDER BY event_date ASC
      LIMIT 300
    `).all();
    const out = (res.results || []).map(rowToMatch).filter(Boolean);
    return c.json(out);
  } catch (err) {
    console.error('[matches/live] error:', err);
    return c.json([]);
  }
});

app.get('/api/matches/upcoming', async (c) => {
  try {
    const res = await c.env.DB.prepare(`
      SELECT *
      FROM events
      WHERE is_live = 0
        AND event_date BETWEEN datetime('now', '-1 hours') AND datetime('now', '+48 hours')
        AND COALESCE(status, 'NS') NOT IN ('FT','AET','PEN','AWD','WO','ABD','Finished','Match Finished','Final','Ended','AOT','AP','POST','SUSP','CANC','TBD')
      ORDER BY event_date ASC
      LIMIT 300
    `).all();
    const out = (res.results || []).map(rowToMatch).filter(Boolean);
    return c.json(out);
  } catch (err) {
    console.error('[matches/upcoming] error:', err);
    return c.json([]);
  }
});

// ── Admin: cleanup events table ───────────────────────────────────────
app.post('/api/admin/cleanup-events', async (c) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '');
  const isAdmin = token === c.env.ADMIN_TOKEN;
  const isDev   = c.env.ENVIRONMENT === 'dev' || c.env.ENVIRONMENT === 'development';
  if (!isAdmin && !isDev) return c.json({ error: 'Forbidden' }, 403);

  try {
    const r1 = await c.env.DB.prepare(`DELETE FROM events WHERE status IN ('FT','AET','PEN','Finished','Match Finished') AND event_date < datetime('now', '-3 hours')`).run();
    const r2 = await c.env.DB.prepare(`DELETE FROM events WHERE event_date < datetime('now', '-24 hours') AND is_live = 0`).run();
    return c.json({ deleted_finished: r1.meta.changes, deleted_old: r2.meta.changes });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// ── Debug: DB status ──────────────────────────────────────────────────
app.get('/api/debug/db-status', async (c) => {
  const token = c.req.query('key') || c.req.header('Authorization')?.replace('Bearer ', '');
  const isAdmin = token === c.env.ADMIN_TOKEN;
  const isDev   = c.env.ENVIRONMENT === 'dev' || c.env.ENVIRONMENT === 'development';
  if (!isAdmin && !isDev) return c.json({ error: 'Forbidden' }, 403);

  try {
    const total      = await c.env.DB.prepare('SELECT COUNT(*) as c FROM events').first('c');
    const live       = await c.env.DB.prepare("SELECT COUNT(*) as c FROM events WHERE is_live=1").first('c');
    const byStatus   = await c.env.DB.prepare("SELECT status, COUNT(*) as c FROM events GROUP BY status ORDER BY c DESC LIMIT 10").all();
    const bySport    = await c.env.DB.prepare("SELECT sport, COUNT(*) as c FROM events GROUP BY sport ORDER BY c DESC").all();
    const sampleLive = await c.env.DB.prepare("SELECT external_event_id, sport, home_team, away_team, event_date, status, is_live, home_odd FROM events WHERE is_live=1 LIMIT 3").all();
    const samplePre  = await c.env.DB.prepare("SELECT external_event_id, sport, home_team, away_team, event_date, status, is_live, home_odd FROM events WHERE is_live=0 AND event_date > datetime('now') LIMIT 3").all();
    return c.json({ total, live, byStatus: byStatus.results, bySport: bySport.results, sampleLive: sampleLive.results, samplePre: samplePre.results });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

app.get('/api/debug/env-check', async (c) => {
  const token = c.req.query('key') || c.req.header('Authorization')?.replace('Bearer ', '');
  const isAdmin = token === c.env.ADMIN_TOKEN;
  const isDev   = c.env.ENVIRONMENT === 'dev' || c.env.ENVIRONMENT === 'development';
  if (!isAdmin && !isDev) return c.json({ error: 'Forbidden' }, 403);

  const apiSports = getApiSportsKey(c.env);
  const oddsApi = getOddsApiKey(c.env);
  const frontendUrl = getFrontendUrl(c.env);

  return c.json({
    env: c.env.ENVIRONMENT,
    hasApiSportsKey: apiSports.length > 0,
    apiSportsKeyPrefix: apiSports ? apiSports.slice(0, 6) + '...' : '',
    hasOddsApiKey: oddsApi.length > 0,
    oddsApiKeyPrefix: oddsApi ? oddsApi.slice(0, 6) + '...' : '',
    apiSportsSeason: String((c.env as any).API_SPORTS_SEASON || ''),
    oddsBookmakers: String((c.env as any).ODDS_API_BOOKMAKERS || ''),
    frontendUrl,
  });
});

// ── WebSocket live feed ───────────────────────────────────────────────
app.get('/api/live/ws', upgradeWebSocket((_c) => {
  return {
    onOpen(_evt: unknown, ws: { send: (d: string) => void }) {
      ws.send(JSON.stringify({ type: 'connected', ts: Date.now() }));
    },
    onMessage(evt: { data: unknown }, ws: { send: (d: string) => void }) {
      try {
        const msg = JSON.parse(evt.data as string);
        if (msg.type === 'ping') ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
      } catch { /* ignore */ }
    },
    onClose() { /* noop */ },
    onError(err: unknown) { console.error('[WS] error:', err); },
  };
}));

// ── 404 catch-all ─────────────────────────────────────────────────────
app.notFound((c) => c.json({ error: 'Not Found', path: c.req.path }, 404));

// ── Error handler ─────────────────────────────────────────────────────
app.onError((err, c) => {
  console.error('[Worker] Unhandled error:', err);
  return c.json({ error: 'Internal Server Error' }, 500);
});

// ── Scheduled handler (cron) ──────────────────────────────────────────
async function handleScheduled(env: Env, ctx: ExecutionContext) {
  console.log('[Scheduled] Cron triggered');
  ctx.waitUntil(
    Promise.all([
      runSportsSync(env).catch(e => console.error('[Scheduled] sportsSync error:', e)),
      processSettlements(env.DB).catch(e => console.error('[Scheduled] settlements error:', e)),
      processWithdrawals(env).catch(e => console.error('[Scheduled] withdrawals error:', e)),
    ])
  );
}

// ── Cloudflare Worker export ──────────────────────────────────────────
export default {
  fetch: app.fetch,

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    await handleScheduled(env, ctx);
  },

  async queue(batch: MessageBatch<any>, env: Env) {
    console.log('[Queue] Received', batch.messages.length, 'messages');
  },
} satisfies ExportedHandler<Env>;
