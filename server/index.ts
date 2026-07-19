import http from 'http';
import fs from 'fs';
import path from 'path';
import { createPool, ensureSchema } from './lib/db';
import { notFound, sendJson } from './lib/http';
import { handleAuthRoutes } from './routes/auth';
import { handleWalletRoutes } from './routes/wallet';
import { handleBetRoutes } from './routes/bets';
import { handleFavoriteRoutes } from './routes/favorites';
import { createEventsService } from './routes/events';
import { handleUsersRoutes } from './routes/users';
import { handleAdminRoutes } from './routes/admin';
import { handleStripeRoutes } from './routes/stripe';
import { createLiveWs } from './ws/liveWs';
import { autoSettleFromCache } from './services/settlement';
import { getSportsDataProviderConfig } from './services/sportsDataProvider';

const loadEnvFile = (filePath: string) => {
  try {
    if (!fs.existsSync(filePath)) return;
    const raw = fs.readFileSync(filePath, 'utf8');
    for (const line of raw.split('\n')) {
      const s = line.trim();
      if (!s || s.startsWith('#')) continue;
      const idx = s.indexOf('=');
      if (idx <= 0) continue;
      const k = s.slice(0, idx).trim();
      let v = s.slice(idx + 1).trim();
      if (!k) continue;
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (process.env[k] == null || process.env[k] === '') process.env[k] = v;
    }
  } catch {
    void 0;
  }
};

loadEnvFile(path.resolve(process.cwd(), 'env', '.env'));
loadEnvFile(path.resolve(process.cwd(), '.env'));

const PORT = Number(process.env.PORT || process.env.RAILWAY_PORT || process.env.API_PORT || 3000);

let pool: ReturnType<typeof createPool> | null = null;
let dbReady = false;
let dbInitError: string | null = null;
try {
  pool = createPool();
  if (!pool) {
    dbReady = false;
    console.warn('[server] WARNING: DATABASE_URL is not set. Auth/bets/wallet/admin routes are disabled.');
  } else {
    await pool.query('SELECT 1');
    try {
      await ensureSchema(pool);
      dbReady = true;
      dbInitError = null;
    } catch (e: any) {
      dbReady = false;
      dbInitError = String(e?.message || e);
      console.error('[server] DB schema ensure failed:', dbInitError);
    }
  }
} catch (e: any) {
  console.error('[server] DB init failed:', String(e?.message || e));
  pool = null;
  dbReady = false;
  dbInitError = String(e?.message || e);
}

if (process.env.NODE_ENV === 'production' && dbInitError) {
  throw new Error(`[server] Refusing to start with invalid database schema: ${dbInitError}`);
}

const safePool: any =
  pool ||
  ({
    query: async () => ({ rows: [] }),
    connect: async () => ({
      query: async () => ({ rows: [] }),
      release: () => void 0,
    }),
  } as any);

const providerConfig = getSportsDataProviderConfig();
const sportsProvider = providerConfig.provider;
const sportsApiKeyEnv = providerConfig.envSource || '';
const sportsApiKey = providerConfig.apiKey;
if (!sportsApiKey) {
  console.warn(
    `[server] WARNING: No sports provider key found for "${sportsProvider}". Sports data endpoints will return empty. Set ${sportsProvider === 'statpal' ? 'STATPAL_KEY' : 'SPORTS_API_PRO_KEY'}.`,
  );
} else if (sportsProvider === 'statpal' && sportsApiKeyEnv === 'SPORTS_API_KEY') {
  console.warn('[server] WARNING: Using generic SPORTS_API_KEY for "statpal". Prefer STATPAL_KEY.');
} else if (sportsProvider !== 'statpal' && sportsApiKeyEnv && sportsApiKeyEnv !== 'SPORTS_API_PRO_KEY') {
  console.warn(
    `[server] WARNING: Using legacy sports key env "${sportsApiKeyEnv}". Prefer SPORTS_API_PRO_KEY.`,
  );
}

const events = createEventsService(safePool, sportsApiKey);
const liveWs = createLiveWs(sportsApiKey);

const distDir = path.resolve(process.cwd(), 'dist');
const hasDist = fs.existsSync(distDir) && fs.statSync(distDir).isDirectory();
const publicDir = path.resolve(process.cwd(), 'public');
const hasPublic = fs.existsSync(publicDir) && fs.statSync(publicDir).isDirectory();

function contentTypeOf(p: string): string {
  const ext = path.extname(p).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.js') return 'application/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.ico') return 'image/x-icon';
  if (ext === '.txt') return 'text/plain; charset=utf-8';
  if (ext === '.map') return 'application/json; charset=utf-8';
  return 'application/octet-stream';
}

async function tryServeStatic(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<boolean> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  if (url.pathname.startsWith('/api')) return false;

  const rawPath = decodeURIComponent(url.pathname || '/');
  const rel = rawPath === '/' ? '/index.html' : rawPath;
  const normalized = path.posix.normalize(rel);
  if (normalized.includes('..')) return false;

  // 1. Try dist/ first (production build output)
  if (hasDist) {
    const filePath = path.join(distDir, normalized);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      res.statusCode = 200;
      res.setHeader('content-type', contentTypeOf(filePath));
      res.setHeader('cache-control', normalized.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'public, max-age=3600');
      res.setHeader('access-control-allow-origin', '*');
      if (req.method === 'HEAD') return res.end(), true;
      fs.createReadStream(filePath).pipe(res);
      return true;
    }
  }

  // 2. Fallback: serve static assets from public/ directly.
  // Never serve an app shell from public/ again, to avoid reviving a stale UI.
  if (hasPublic) {
    if (normalized === '/index.html') return false;
    const pubPath = path.join(publicDir, normalized);
    if (fs.existsSync(pubPath) && fs.statSync(pubPath).isFile()) {
      res.statusCode = 200;
      res.setHeader('content-type', contentTypeOf(pubPath));
      res.setHeader('cache-control', 'public, max-age=3600');
      res.setHeader('access-control-allow-origin', '*');
      if (req.method === 'HEAD') return res.end(), true;
      fs.createReadStream(pubPath).pipe(res);
      return true;
    }
  }

  // 3. SPA fallback — serve index.html for unknown routes
  if (hasDist) {
    const indexPath = path.join(distDir, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.statusCode = 200;
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.setHeader('cache-control', 'no-store');
      if (req.method === 'HEAD') return res.end(), true;
      fs.createReadStream(indexPath).pipe(res);
      return true;
    }
  }

  return false;
}

const server = http.createServer(async (req, res) => {
  try {
    const rawUrl = req.url || '/';
    const url = new URL(rawUrl, `http://${req.headers.host || 'localhost'}`);
    try {
      const normalized = url.pathname.replace(/\/+$/, '') || '/';
      url.pathname = normalized;
    } catch {
      void 0;
    }

    res.setHeader('x-content-type-options', 'nosniff');

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/api/health')) {
      const healthy = Boolean(pool) && dbReady;
      sendJson(res, healthy ? 200 : 503, {
        ok: healthy,
        db: dbReady,
        dbConfigured: Boolean(pool),
      });
      return;
    }

    const isApi = url.pathname === '/api' || url.pathname.startsWith('/api/');
    if (isApi) {
      if (req.method === 'GET' && url.pathname === '/api/pricing/config') {
        sendJson(res, 200, { betDefault: 10 });
        return;
      }

      // ── Image proxy for media.api-sports.io logos (no CORS issues, no API key needed) ──
      if (req.method === 'GET' && url.pathname === '/api/media-proxy') {
        const target = url.searchParams.get('url') || '';
        let allowed = false;
        try {
          const u = new URL(target);
          const h = u.hostname.toLowerCase();
          allowed =
            h === 'media.api-sports.io' ||
            h.endsWith('.api-sports.io') ||
            h === 'upload.wikimedia.org' ||
            h === 'flagcdn.com' ||
            h === 'cdnjs.cloudflare.com';
        } catch { allowed = false; }
        if (!allowed || !target) {
          res.statusCode = 400;
          res.end('Bad Request');
          return;
        }
        try {
          const upstream = await fetch(target, {
            headers: { 'User-Agent': 'BET62/1.0', 'Accept': 'image/*,*/*' },
            signal: AbortSignal.timeout(8000),
          });
          if (!upstream.ok) {
            res.statusCode = upstream.status;
            res.end();
            return;
          }
          const ct = upstream.headers.get('content-type') || 'image/png';
          res.statusCode = 200;
          res.setHeader('content-type', ct);
          res.setHeader('cache-control', 'public, max-age=604800, immutable'); // 7 days
          res.setHeader('access-control-allow-origin', '*');
          const buf = Buffer.from(await upstream.arrayBuffer());
          res.end(buf);
        } catch {
          res.statusCode = 502;
          res.end();
        }
        return;
      }

      if (await events.handleEventsRoutes(req, res, url)) return;
      if (!dbReady) {
        if (url.pathname === '/api/auth/me' && req.method === 'GET') {
          sendJson(res, 200, { user: null });
          return;
        }
        if (url.pathname === '/api/users/is-operator' && req.method === 'GET') {
          sendJson(res, 200, { operator: false });
          return;
        }
        if (url.pathname === '/api/users/profile' && req.method === 'GET') {
          sendJson(res, 200, { self_exclude: 0, self_exclude_until: null });
          return;
        }
        if (
          url.pathname.startsWith('/api/auth') ||
          url.pathname.startsWith('/api/users') ||
          url.pathname.startsWith('/api/metrics') ||
          url.pathname.startsWith('/api/wallet') ||
          url.pathname.startsWith('/api/bets') ||
          url.pathname.startsWith('/api/favorites') ||
          url.pathname.startsWith('/api/admin')
        ) {
          sendJson(res, 503, { error: 'Database unavailable' });
          return;
        }
      }

      if (pool && (await handleAuthRoutes(pool, req, res, url))) return;
      if (pool && (await handleUsersRoutes(pool, req, res, url))) return;
      if (pool && (await handleWalletRoutes(pool, req, res, url))) return;
      if (pool && (await handleStripeRoutes(pool, req, res, url))) return;
      if (pool && (await handleBetRoutes(pool, events, req, res, url))) return;
      if (pool && (await handleFavoriteRoutes(pool, req, res, url))) return;
      if (pool && (await handleAdminRoutes(pool, events, req, res, url, sportsApiKey))) return;

      // Stripe webhook needs raw body — handle even without pool fully ready
      if (!pool && url.pathname === '/api/stripe/webhook' && req.method === 'POST') {
        res.statusCode = 503;
        res.end('DB unavailable');
        return;
      }

      notFound(res);
      return;
    }

    if (await tryServeStatic(req, res, url)) return;

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '')) {
      sendJson(res, 200, { ok: true, service: 'api' });
      return;
    }

    notFound(res);
  } catch (e: any) {
    sendJson(res, 500, { error: 'Internal error', details: String(e?.message || e) });
  }
});

server.on('upgrade', (req, socket, head) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    try {
      const normalized = url.pathname.replace(/\/+$/, '') || '/';
      url.pathname = normalized;
    } catch {
      void 0;
    }
    if (url.pathname === '/api/live/ws') {
      liveWs.handleUpgrade(req, socket, head);
      return;
    }
  } catch {
    void 0;
  }
  try {
    socket.destroy();
  } catch {
    void 0;
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[server] listening on :${PORT}`);
});

// ── Auto-Settlement Scheduler ─────────────────────────────────────────────────
// Runs every 90 seconds. Scans finished events in cache and settles pending bets.
if (pool && dbReady) {
  const SETTLE_INTERVAL_MS = 90_000;

  const runAutoSettle = async () => {
    try {
      const eventsCache = events.getEventsCache();
      if (eventsCache.size === 0) return;
      const report = await autoSettleFromCache(pool!, sportsApiKey, eventsCache);
      if (report.totalSettled > 0 || report.errors.length > 0) {
        console.log(
          `[settlement] auto: checked=${report.totalChecked} settled=${report.totalSettled}` +
          ` credited=€${report.totalCredited.toFixed(2)}` +
          (report.errors.length ? ` errors=${report.errors.length}` : ''),
        );
        if (report.errors.length) {
          console.warn('[settlement] errors:', report.errors.slice(0, 5));
        }
      }
    } catch (e: any) {
      console.error('[settlement] auto-settle error:', String(e?.message || e));
    }
  };

  // First run after 30s (let events cache warm up), then every 90s
  setTimeout(() => {
    runAutoSettle().catch(() => null);
    setInterval(() => runAutoSettle().catch(() => null), SETTLE_INTERVAL_MS);
  }, 30_000);

  console.log('[settlement] auto-settlement scheduler started (every 90s)');
}
