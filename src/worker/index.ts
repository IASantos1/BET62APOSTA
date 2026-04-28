import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { upgradeWebSocket } from 'hono/cloudflare-workers';
import { Env } from '../shared/types';
import { cacheControl } from './middleware/cache';
import { runSportsSync } from './services/sportsSync';
import { getApiSportsKey, getFrontendUrl, getOddsApiKey, getStatpalKey } from './services/env';

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
    if (!origin) return null;
    const o = String(origin).trim();

    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o)) return o;

    // Domínios Replit (preview e deployments publicados)
    if (/\.replit\.dev$/.test(o) || /\.janeway\.replit\.dev$/.test(o)) return o;
    if (/\.replit\.app$/.test(o) || /\.repl\.co$/.test(o)) return o;

    // Vercel (preview + production domains)
    try {
      const u = new URL(o);
      if ((u.protocol === 'https:' || u.protocol === 'http:') && u.hostname.endsWith('.vercel.app')) {
        return o;
      }
    } catch {
      // ignore invalid origins
    }

    const allowed = new Set<string>([
      'https://bet62.plus',
      'https://www.bet62.plus',
      'https://bet62.pt',
      'https://www.bet62.pt',
      'https://bet62apostasesportivas.pages.dev',
      'https://bet62apostasesportivas.bet62.workers.dev',
    ]);

    return allowed.has(o) ? o : null;
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
    const { ensureUserSchema } = await import('./db');
    await ensureUserSchema(c.env.DB).catch(e => console.error('[force-sync] schema:', e));
    const result = await runSportsSync(c.env, { forceFull: true });
    return c.json({ ok: true, ...result });
  } catch (err: any) {
    return c.json({ ok: false, error: String(err?.message || err) }, 500);
  }
});

app.get('/api/admin/statpal-debug', async (c) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '');
  if (token !== c.env.ADMIN_TOKEN) return c.json({ error: 'Forbidden' }, 403);

  const apiKey = getStatpalKey(c.env);
  if (!apiKey) return c.json({ ok: false, error: 'Missing STATPAL_KEY' }, 500);

  const redacted = (u: string) => u.replace(/access_key=[^&]+/g, 'access_key=REDACTED');

  const urls = {
    v1_livescores: `https://statpal.io/api/v1/soccer/livescores?access_key=${encodeURIComponent(apiKey)}`,
    v2_live_odds: `https://statpal.io/api/v2/soccer/odds/live?access_key=${encodeURIComponent(apiKey)}`,
    v2_pregame_candidates: [
      `https://statpal.io/api/v2/soccer/odds/pregame?access_key=${encodeURIComponent(apiKey)}`,
      `https://statpal.io/api/v2/soccer/odds/prematch?access_key=${encodeURIComponent(apiKey)}`,
      `https://statpal.io/api/v2/soccer/odds/pre-match?access_key=${encodeURIComponent(apiKey)}`,
      `https://statpal.io/api/v2/soccer/odds/upcoming?access_key=${encodeURIComponent(apiKey)}`,
    ],
  };

  const fetchJson = async (url: string) => {
    const res = await fetch(url);
    const text = await res.text().catch(() => '');
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    return { ok: res.ok, status: res.status, url: redacted(url), json, textSnippet: String(text || '').slice(0, 300) };
  };

  const v1 = await fetchJson(urls.v1_livescores);
  const v2Live = await fetchJson(urls.v2_live_odds);

  let v2Pregame: any = null;
  for (const u of urls.v2_pregame_candidates) {
    const r = await fetchJson(u);
    if (r.ok) { v2Pregame = r; break; }
    if (!v2Pregame) v2Pregame = r;
  }

  const v1Leagues = Array.isArray(v1?.json?.livescore?.league) ? v1.json.livescore.league : (v1?.json?.livescore?.league ? [v1.json.livescore.league] : []);
  const v1MatchCount = v1Leagues.reduce((acc: number, lg: any) => {
    const matches = Array.isArray(lg?.match) ? lg.match : (lg?.match ? [lg.match] : []);
    return acc + matches.length;
  }, 0);

  const v2LiveMatches = Array.isArray(v2Live?.json?.live_matches) ? v2Live.json.live_matches : [];
  const v2PregameMatches = Array.isArray(v2Pregame?.json?.pregame_matches)
    ? v2Pregame.json.pregame_matches
    : Array.isArray(v2Pregame?.json?.upcoming_matches)
      ? v2Pregame.json.upcoming_matches
      : Array.isArray(v2Pregame?.json?.matches)
        ? v2Pregame.json.matches
        : [];

  return c.json({
    ok: true,
    v1: { ok: v1.ok, status: v1.status, url: v1.url, leagues: v1Leagues.length, matches: v1MatchCount, snippet: v1.textSnippet },
    v2_live: { ok: v2Live.ok, status: v2Live.status, url: v2Live.url, live_matches: v2LiveMatches.length, snippet: v2Live.textSnippet },
    v2_pregame: { ok: v2Pregame?.ok, status: v2Pregame?.status, url: v2Pregame?.url, pregame_matches: v2PregameMatches.length, snippet: v2Pregame?.textSnippet },
  });
});

// Diagnostic: inspect events table state
app.get('/api/admin/events-debug', async (c) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '');
  if (token !== c.env.ADMIN_TOKEN) return c.json({ error: 'Forbidden' }, 403);
  try {
    const total = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM events').first<{ n: number }>();
    const bySport = await c.env.DB.prepare('SELECT sport, COUNT(*) AS n FROM events GROUP BY sport').all();
    const indexes = await c.env.DB.prepare("SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='events'").all();
    const sample = await c.env.DB.prepare("SELECT external_event_id, sport, status, is_live, event_date, home_team, away_team, home_odd FROM events WHERE external_event_id LIKE 'statpal_%' LIMIT 5").all();
    return c.json({ total: total?.n ?? 0, bySport: bySport.results, indexes: indexes.results, statpalSample: sample.results });
  } catch (err: any) {
    return c.json({ error: String(err?.message || err) }, 500);
  }
});

// Repair index: replace partial unique index with full unique index (required for ON CONFLICT)
app.post('/api/admin/repair-events-index', async (c) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '');
  if (token !== c.env.ADMIN_TOKEN) return c.json({ error: 'Forbidden' }, 403);
  const log: any[] = [];
  const tryRun = async (sql: string) => {
    try { await c.env.DB.prepare(sql).run(); log.push({ sql, ok: true }); }
    catch (e: any) { log.push({ sql, ok: false, error: String(e?.message || e) }); }
  };
  // Find rows with NULL or duplicate external_event_id that would block a non-partial unique index
  const nulls = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM events WHERE external_event_id IS NULL OR external_event_id = ''").first<{ n: number }>();
  const dups = await c.env.DB.prepare("SELECT external_event_id, COUNT(*) AS n FROM events GROUP BY external_event_id HAVING COUNT(*) > 1").all();
  // Backfill NULL/empty external_event_id with synthetic id so a non-partial unique index can be built
  await tryRun("UPDATE events SET external_event_id = 'legacy_' || id WHERE external_event_id IS NULL OR external_event_id = ''");
  // Drop both partial indexes (they don't satisfy ON CONFLICT(col))
  await tryRun("DROP INDEX IF EXISTS idx_events_external_id");
  await tryRun("DROP INDEX IF EXISTS uniq_events_external_event_id");
  // Create a full unique index (works for ON CONFLICT(external_event_id))
  await tryRun("CREATE UNIQUE INDEX IF NOT EXISTS uniq_events_external_event_id_full ON events(external_event_id)");
  return c.json({ nulls: nulls?.n ?? 0, duplicates: dups.results, log });
});

// Zera odds herdadas (fakes 2.10/3.30/3.20 e 1.85/0/1.85). Idempotente.
// Após chamar isto, o próximo sync repõe as odds REAIS (do Statpal v2)
// e os eventos sem odds reais ficam visivelmente sem cotas (em vez de mostrar fakes).
app.post('/api/admin/zero-stale-odds', async (c) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '');
  if (token !== c.env.ADMIN_TOKEN) return c.json({ error: 'Forbidden' }, 403);
  try {
    // Soccer baseline antiga: 2.10 / 3.30 / 3.20
    const r1 = await c.env.DB.prepare(
      `UPDATE events
         SET home_odd = 0, draw_odd = 0, away_odd = 0, markets = ''
       WHERE home_odd = 2.10 AND draw_odd = 3.30 AND away_odd = 3.20`
    ).run();
    // Tennis baseline antiga: 1.85 / 0 / 1.85
    const r2 = await c.env.DB.prepare(
      `UPDATE events
         SET home_odd = 0, draw_odd = 0, away_odd = 0, markets = ''
       WHERE home_odd = 1.85 AND draw_odd = 0 AND away_odd = 1.85`
    ).run();
    // Modo agressivo via query param: zera TODAS as odds para forçar refresh do sync
    const url = new URL(c.req.url);
    let r3: any = null;
    if (url.searchParams.get('all') === '1') {
      r3 = await c.env.DB.prepare(
        `UPDATE events SET home_odd = 0, draw_odd = 0, away_odd = 0, markets = ''`
      ).run();
    }
    return c.json({
      ok: true,
      zeroed_baseline_soccer: r1?.meta ?? r1,
      zeroed_baseline_tennis: r2?.meta ?? r2,
      zeroed_all: r3?.meta ?? null,
    });
  } catch (err: any) {
    return c.json({ ok: false, error: String(err?.message || err) }, 500);
  }
});

// Diagnostic: try one upsert and report error verbatim
app.post('/api/admin/test-upsert', async (c) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '');
  if (token !== c.env.ADMIN_TOKEN) return c.json({ error: 'Forbidden' }, 403);
  try {
    const { ensureUserSchema } = await import('./db');
    await ensureUserSchema(c.env.DB);
    const eid = 'TEST_' + Date.now();
    const sql = `INSERT INTO events (external_event_id, sport, league, home_team, away_team, team_match, event_date, status, is_live, home_odd, draw_odd, away_odd, elapsed, score, markets, home_team_logo, away_team_logo, country, updated_at)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                 ON CONFLICT(external_event_id) DO UPDATE SET status = excluded.status`;
    const r = await c.env.DB.prepare(sql).bind(
      eid, 'soccer', 'TEST_LEAGUE', 'TestFC_'+Date.now(), 'ProbeFC_'+Date.now(), 'a x b',
      new Date(Date.now() + 3600_000).toISOString(), 'NS', 0,
      2.10, 3.30, 3.20, 0, '{"home":null,"away":null}', '{}', '', '', 'PT',
      new Date().toISOString()
    ).run();
    const check = await c.env.DB.prepare('SELECT external_event_id, sport FROM events WHERE external_event_id = ?').bind(eid).first();
    return c.json({ ok: true, eid, runResult: r, check });
  } catch (err: any) {
    return c.json({ ok: false, error: String(err?.message || err), stack: String(err?.stack || '') }, 500);
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

// Note: `/` é servido pelos Static Assets (./dist/index.html) configurados
// em wrangler.toml. Quando os assets estão bindados, o SPA fallback trata
// também todas as rotas client-side. Mantemos só uma resposta JSON quando
// os assets NÃO estão disponíveis (deployment sem static assets).
app.get('/', async (c) => {
  // Se ASSETS binding existe, delega para servir o index.html
  const assets = (c.env as any).ASSETS;
  if (assets && typeof assets.fetch === 'function') {
    return assets.fetch(c.req.raw);
  }
  return c.json({
    ok: true,
    name: 'BET62 Worker API',
    env: c.env.ENVIRONMENT,
    endpoints: ['/api/health', '/api/sports', '/api/events/by-sport'],
  });
});

// ── Featured games (alias for by-sport live) ──────────────────────────
app.get('/api/featured-games', cacheControl({ maxAge: 30, staleWhileRevalidate: 60 }), async (c) => {
  try {
    const eventDt = `datetime(replace(substr(event_date, 1, 19), 'T', ' '))`;
    // Prioriza: 1) live com cotas reais  2) live sem cotas  3) prematch com cotas  4) prematch sem cotas
    // E exclui FT (jogos terminados) do destaque.
    const res = await c.env.DB.prepare(`
      SELECT * FROM events
      WHERE status != 'FT'
        AND (
          is_live = 1
          OR ${eventDt} BETWEEN datetime('now', '-30 minutes') AND datetime('now', '+48 hours')
        )
      ORDER BY
        is_live DESC,
        CASE WHEN home_odd > 1 THEN 0 ELSE 1 END ASC,
        ${eventDt} ASC
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
app.get('/api/live/ws', upgradeWebSocket((c) => {
  const sport = String(c.req.query('sport') || 'all').toLowerCase().trim();
  const pollMsRaw = Number(c.req.query('interval') || 5000);
  const pollMs = Number.isFinite(pollMsRaw) ? Math.max(1000, Math.min(15000, pollMsRaw)) : 5000;
  const include = String(c.req.query('include') || '').toLowerCase();
  const wantsOdds = include.includes('odds') || include.includes('markets');

  const fetchSnapshot = async () => {
    const params: any[] = [];
    let q = `
      SELECT
        external_event_id,
        sport,
        league,
        home_team,
        away_team,
        home_team_logo,
        away_team_logo,
        event_date,
        status,
        is_live,
        elapsed,
        timer,
        score,
        markets,
        home_odd,
        draw_odd,
        away_odd
      FROM events
      WHERE is_live = 1
    `;
    if (sport && sport !== 'all') {
      q += ` AND lower(sport) = ?`;
      params.push(sport);
    }
    q += ` ORDER BY updated_at DESC LIMIT 150`;
    const res = await c.env.DB.prepare(q).bind(...params).all();
    return (res.results || []).map((r: any) => ({
      ...r,
      id: String(r.external_event_id || r.id || ''),
      external_event_id: String(r.external_event_id || ''),
      is_live: Number(r.is_live || 0),
      elapsed: Number(r.elapsed || 0),
      timer: String(r.timer || ''),
      home_odd: Number(r.home_odd || 0),
      draw_odd: Number(r.draw_odd || 0),
      away_odd: Number(r.away_odd || 0),
      markets: wantsOdds ? String(r.markets || '') : undefined,
      score: String(r.score || ''),
    }));
  };

  return {
    async onOpen(_evt: unknown, ws: { send: (d: string) => void }) {
      ws.send(JSON.stringify({ type: 'connected', ts: Date.now() }));

      const sendSnapshot = async () => {
        try {
          const live = await fetchSnapshot();
          ws.send(JSON.stringify({ type: 'snapshot', ts: Date.now(), live }));
        } catch (err: any) {
          ws.send(JSON.stringify({ type: 'error', ts: Date.now(), message: String(err?.message || 'snapshot_failed') }));
        }
      };

      await sendSnapshot();
      const id: any = setInterval(() => c.executionCtx.waitUntil(sendSnapshot()), pollMs);
      (ws as any).__pollId = id;
    },
    onMessage(evt: { data: unknown }, ws: { send: (d: string) => void }) {
      try {
        const msg = JSON.parse(evt.data as string);
        if (msg?.type === 'ping') ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
      } catch { void 0; }
    },
    onClose(_evt: unknown, ws: any) {
      if (ws?.__pollId) {
        try { clearInterval(ws.__pollId); } catch { void 0; }
      }
    },
    onError(err: unknown) { console.error('[WS] error:', err); },
  };
}));

// ── 404 catch-all ─────────────────────────────────────────────────────
app.notFound(async (c) => {
  const p = c.req.path;
  // For API/internal paths, return JSON 404
  if (p.startsWith('/api/') || p.startsWith('/cdn-cgi/') || p === '/health') {
    return c.json({ error: 'Not Found', path: p }, 404);
  }
  // For SPA routes, serve index.html from assets binding so client-side routing works
  const assets = (c.env as any).ASSETS;
  if (assets && typeof assets.fetch === 'function') {
    const url = new URL(c.req.url);
    url.pathname = '/index.html';
    const res = await assets.fetch(new Request(url.toString(), { method: 'GET' }));
    if (res.ok) return new Response(res.body, { status: 200, headers: res.headers });
  }
  return c.json({ error: 'Not Found', path: p }, 404);
});

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
