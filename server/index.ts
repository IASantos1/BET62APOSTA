import http from 'http';
import { createPool, ensureSchema } from './lib/db';
import { notFound, sendJson } from './lib/http';
import { handleAuthRoutes } from './routes/auth';
import { handleWalletRoutes } from './routes/wallet';
import { handleBetRoutes } from './routes/bets';
import { handleFavoriteRoutes } from './routes/favorites';
import { createEventsService } from './routes/events';
import { handleAdminRoutes } from './routes/admin';
import { createLiveWs } from './ws/liveWs';

const PORT = Number(process.env.PORT || process.env.RAILWAY_PORT || process.env.API_PORT || 4000);

const pool = createPool();
await ensureSchema(pool);

const sportsApiKey = String(
  process.env.SPORTS_API_PRO_KEY ||
    process.env.SPORTSAPIPRO_KEY ||
    process.env.SPORTSAPI_PRO_KEY ||
    process.env.SPORTS_API_KEY ||
    '',
).trim();
if (!sportsApiKey) {
  throw new Error(
    'Missing SportsAPI Pro key. Set one of: SPORTS_API_PRO_KEY, SPORTSAPIPRO_KEY, SPORTSAPI_PRO_KEY, SPORTS_API_KEY',
  );
}

const events = createEventsService(pool, sportsApiKey);
const liveWs = createLiveWs(sportsApiKey);

const server = http.createServer(async (req, res) => {
  try {
    const rawUrl = req.url || '/';
    const url = new URL(rawUrl, `http://${req.headers.host || 'localhost'}`);

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

    if (await events.handleEventsRoutes(req, res, url)) return;
    if (await handleAuthRoutes(pool, req, res, url)) return;
    if (await handleWalletRoutes(pool, req, res, url)) return;
    if (await handleBetRoutes(pool, req, res, url)) return;
    if (await handleFavoriteRoutes(pool, req, res, url)) return;
    if (await handleAdminRoutes(pool, events, req, res, url)) return;

    notFound(res);
  } catch (e: any) {
    sendJson(res, 500, { error: 'Internal error', details: String(e?.message || e) });
  }
});

server.on('upgrade', (req, socket, head) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
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
