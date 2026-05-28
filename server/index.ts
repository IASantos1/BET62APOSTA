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
import { handleAdminRoutes } from './routes/admin';
import { createLiveWs } from './ws/liveWs';

const PORT = Number(process.env.PORT || process.env.RAILWAY_PORT || process.env.API_PORT || 3000);

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

const pool = createPool();
await ensureSchema(pool);

const sportsApiKey = String(
  process.env.SPORTS_API_PRO_KEY ||
    process.env.SPORTSAPIPRO_KEY ||
    process.env.SPORTSAPI_PRO_KEY ||
    process.env.SPORTS_API_KEY ||
    process.env.STATPAL_KEY ||
    '',
).trim();
if (!sportsApiKey) {
  console.warn(
    '[server] WARNING: No SportsAPI Pro key found. Sports data endpoints will return empty. Set SPORTS_API_KEY to enable.',
  );
}

const events = createEventsService(pool, sportsApiKey);
const liveWs = createLiveWs(sportsApiKey);

const distDir = path.resolve(process.cwd(), 'dist');
const hasDist = fs.existsSync(distDir) && fs.statSync(distDir).isDirectory();

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
  if (!hasDist) return false;
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  if (url.pathname.startsWith('/api')) return false;

  const rawPath = decodeURIComponent(url.pathname || '/');
  const rel = rawPath === '/' ? '/index.html' : rawPath;
  const normalized = path.posix.normalize(rel);
  if (normalized.includes('..')) return false;

  const filePath = path.join(distDir, normalized);
  const exists = fs.existsSync(filePath);
  if (exists) {
    const st = fs.statSync(filePath);
    if (st.isFile()) {
      res.statusCode = 200;
      res.setHeader('content-type', contentTypeOf(filePath));
      res.setHeader('cache-control', normalized.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-store');
      if (req.method === 'HEAD') return res.end(), true;
      fs.createReadStream(filePath).pipe(res);
      return true;
    }
  }

  const indexPath = path.join(distDir, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.statusCode = 200;
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    if (req.method === 'HEAD') return res.end(), true;
    fs.createReadStream(indexPath).pipe(res);
    return true;
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

    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (await tryServeStatic(req, res, url)) return;

    if (await events.handleEventsRoutes(req, res, url)) return;
    if (await handleAuthRoutes(pool, req, res, url)) return;
    if (await handleWalletRoutes(pool, req, res, url)) return;
    if (await handleBetRoutes(pool, req, res, url)) return;
    if (await handleFavoriteRoutes(pool, req, res, url)) return;
    if (await handleAdminRoutes(pool, events, req, res, url)) return;

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

server.listen(PORT, () => {
  console.log(`[server] listening on :${PORT}`);
});
