
console.log('[Worker] Starting up...');
import { Hono } from 'hono';
import { WSContext } from 'hono/ws';
import { cors } from 'hono/cors';
import { Env } from '../shared/types';
import { withTimeout } from './utils/withTimeout';
import { normalizeOdds, applyHomeAdvantage } from './utils/normalizeOdds';
import { isPreMatch } from './utils/oddsGuard';
import { generateLiveOdds } from './engine/liveOddsEngine';
import { shouldSuspendLiveOdds } from './engine/liveGuard';

// Import routers
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
import { processWithdrawals } from './jobs';
import { watchdog } from './middleware/watchdog';
import { adminAuth } from './middleware/adminAuth';
import { cacheControl } from './middleware/cache';
// import { rateLimiter } from 'hono-rate-limiter';
import { upgradeWebSocket } from 'hono/cloudflare-workers';
// import { diffEvents } from './services/oddsDiff';
import { processSettlements } from './services/settlement';
// import { scoreEvent } from './utils/scoring';
import { EventSyncService } from './services/eventSync';
import { AdaptivePollingService } from './services/adaptivePolling';
import { runRobustIntegration, debugSoccerMatching, API_SPORTS_CONFIG, SPORT_PARAM_TO_CONFIG } from './services/robustIntegration';
// import { Scraper22Bet } from './services/scraper22bet'; // REMOVED
import { updateEventStatuses } from './services/eventStatus';
import { initRiskTables } from './services/risk';
// import { TradingLogger } from './services/tradingLogger';
// import { TradingPanel } from './services/tradingPanel';

// --- HELPER FUNCTIONS ---

function getMainMarketType(sport: string) {
  sport = (sport || '').toLowerCase();

  if (
    sport.includes('soccer') ||
    sport.includes('football') ||
    sport.includes('futebol') ||
    sport.includes('futbol')
  ) {
    return '1X2'; // Casa / Empate / Fora
  }

  // Todos os outros esportes
  return 'MONEYLINE'; // Casa / Fora
}

function abbreviateTeamName(name: string, maxLength: number = 18): string {
    if (!name) return '';
    if (name.length <= maxLength) return name;

    let abbrev = name
        .replace(/\sFutebol\sClube/gi, ' FC')
        .replace(/\sSport\sClube/gi, ' SC')
        .replace(/\sEsporte\sClube/gi, ' EC')
        .replace(/\sAtletico/gi, ' Atl.')
        .replace(/\sAtlético/gi, ' Atl.')
        .replace(/\sDeportivo/gi, ' Dep.')
        .replace(/\sIndependiente/gi, ' Ind.')
        .replace(/\sNacional/gi, ' Nac.')
        .replace(/\sInternacional/gi, ' Inter')
        .replace(/\sUniversity/gi, ' Univ.')
        .replace(/\sUnited/gi, ' Utd')
        .replace(/\sRovers/gi, ' Rov.')
        .replace(/\sWanderers/gi, ' Wand.');
    
    // If still too long, try to remove generic terms completely if they are at the end
    if (abbrev.length > maxLength) {
        abbrev = abbrev.replace(/\sFC$/i, '').replace(/\sEC$/i, '').replace(/\sSC$/i, '');
    }
    
    // If still too long, truncate with ellipsis
    if (abbrev.length > maxLength) {
        return abbrev.substring(0, maxLength - 1) + '.';
    }

    return abbrev;
}

// ------------------------

import { ensureUserSchema } from './db';
import { isSmallLeagueName } from './utils/leagueFilter';

type H2HOutcome = { outcome: string; value: number; odd?: number };

const applyHouseMarginToH2H = (outcomes: H2HOutcome[], targetOverround = 1.07): H2HOutcome[] => {
  const impliedSum = outcomes.reduce((sum, o) => {
    const v = Number(o.value ?? o.odd ?? 0);
    return v > 0 ? sum + 1 / v : sum;
  }, 0);
  if (!(impliedSum > 0) || !Number.isFinite(impliedSum)) {
    return outcomes.map(o => ({ ...o }));
  }
  const scale = targetOverround / impliedSum;
  return outcomes.map(o => {
    const v = Number(o.value ?? o.odd ?? 0);
    if (!(v > 0) || !Number.isFinite(v)) {
      return { ...o, value: 0, odd: 0 };
    }
    const prob = 1 / v;
    const adjProb = prob * scale;
    const adjOdd = Number((1 / adjProb).toFixed(2));
    return { ...o, value: adjOdd, odd: adjOdd };
  });
};

// Refactored WebSocket Logic to fix scope issues
async function handleWebSocketUpdates(
  ws: WSContext,
  env: Env,
  state: { lastEvents: Map<string, any> },
  sport?: string
) {
  try {
    if (ws.readyState !== 1) return; // 1 is OPEN

    // Treat 'all' as undefined (no filter)
    const effectiveSport = (sport === 'all' || sport === 'undefined') ? undefined : sport;

    const stmt = env.DB.prepare(`
        SELECT io.payload, me.exposure, me.max_exposure
        FROM imported_odds io
        LEFT JOIN market_exposure me ON io.id = me.market_id
        WHERE io.is_live = 1 AND io.publish_status = 'published' ${effectiveSport ? 'AND io.sport = ?' : ''}
        ORDER BY io.updated_at DESC
        LIMIT 200
    `);

    const { results } = effectiveSport ? await stmt.bind(effectiveSport).all() : await stmt.all();

    console.log(`[WS] Checking updates for sport: ${effectiveSport || 'ALL'}, found: ${results?.length || 0}`);

    const currentEventsMap = new Map<string, any>();
    
    const currentEvents = (results || [])
        .map((r: any) => {
          let event = null;
          try {
            event = JSON.parse(r.payload);
          } catch {
            return null;
          }
          if (!event || typeof event !== 'object') return null;

          // Normalize League Name (Fix for [object Object])
          let leagueName = event.league;
          if (typeof leagueName === 'object') {
              leagueName = leagueName.name || leagueName.league_name || leagueName.en || 'Unknown League';
          }
          if (leagueName === '[object Object]' || typeof leagueName !== 'string') {
              leagueName = 'Unknown League';
          }
          event.league = leagueName;
          event.league_name = leagueName;

          // FILTER: Hide past/finished games
          const status = event.fixture?.status?.short;
          if (['FT', 'AET', 'PEN', 'Finished', 'ABD', 'WO', 'INT', 'Ended', 'Final'].includes(status)) {
             return null;
          }

          // FILTER: Blacklist specific teams (e.g. Illinois vs Minnesota)
          const hName = (event.teams?.home?.name || event.home_team || '').toLowerCase();
          const aName = (event.teams?.away?.name || event.away_team || '').toLowerCase();
          if ((hName.includes('illinois') && aName.includes('minnesota')) || (aName.includes('illinois') && hName.includes('minnesota'))) {
               return null;
          }

          // Force remove Draw odd for 2-way sports (MMA, etc.)
          const sportName = (event.sport || '').toLowerCase();
          const isNoDraw = ['mma', 'fighting', 'boxing', 'ufc', 'basketball', 'volleyball', 'tennis', 'american-football', 'baseball'].some(s => sportName.includes(s));
          
          if (isNoDraw) {
              event.draw_odd = 0;
              if (event.odds && event.odds.h2h && Array.isArray(event.odds.h2h.outcomes)) {
                  event.odds.h2h.outcomes = event.odds.h2h.outcomes.filter((o: any) => {
                      const lbl = String(o.outcome || o.label || '').toLowerCase();
                      return !['x', 'draw', 'empate'].includes(lbl);
                  });
              }
          }

          // Fix for Year Discrepancy (2025 vs 2026) in WebSocket
          const evtDate = event.event_date || event.fixture?.date;
          if (evtDate) {
              const ts = new Date(evtDate).getTime();
              const now = Date.now();
              const diff = now - ts;
              if (diff > 300 * 24 * 60 * 60 * 1000) {
                  const dYearAdj = new Date(ts);
                  dYearAdj.setFullYear(new Date(now).getFullYear());
                  const newDateIso = dYearAdj.toISOString();
                  if (event.event_date) event.event_date = newDateIso;
                  if (event.fixture) event.fixture.date = newDateIso;
              }
          }

          if (event.fixture) event.fixture.id = String(event.fixture.id);
          if (event.id) event.id = String(event.id);

          // Fix for [object Object] league name
          if (typeof event.league === 'object' && event.league !== null) {
              event.league = event.league.name || event.league_name || (event.league.en ? event.league.en : 'Unknown League');
          } else if (event.league === '[object Object]') {
               event.league = event.league_name || 'Unknown League';
          }
  
          if (typeof event.league_name === 'object' && event.league_name !== null) {
               const ln: any = event.league_name;
               event.league_name = ln.name || ln.en || 'Unknown League';
               if (!event.league || event.league === 'Unknown League') event.league = event.league_name;
          }
  
          if (!event.league && event.league_name) {
              event.league = event.league_name;
          }

          const exposure = r.exposure || 0;
          const maxExposure = r.max_exposure || 10000;

          if (exposure >= maxExposure) {
            event.suspended = true;
            event.suspendReason = 'RISK_LIMIT';
          } else if (exposure / maxExposure > 0.7) {
            if (event.odds) {
              for (const k in event.odds) {
                const m = event.odds[k];
                if (m.outcomes) {
                  m.outcomes.forEach((o: any) => {
                    o.value = Number((o.value * 0.95).toFixed(2));
                  });
                }
              }
            }
          }

          if (event.fixture && event.fixture.id) {
             currentEventsMap.set(String(event.fixture.id), event);
          }

          return event;
        })
        .filter(Boolean);

      const changed: any[] = [];
      const removedIds: string[] = [];

      // Identify removed events
      for (const [id] of state.lastEvents) {
        if (!currentEventsMap.has(id)) {
          removedIds.push(id);
        }
      }

      // Identify changed events
      const scoreUpdates: any[] = []; // Novo: só updates de placar

      for (const event of currentEvents) {
        if (!event?.fixture?.id) continue;
        const id = String(event.fixture.id);
        const prev = state.lastEvents.get(id);
        
        if (!prev) {
          changed.push(event);
          continue; // Se é novo, já vai no live:upsert
        } 

        // Comparar placar e status
        const prevScore = prev.fixture?.goals || prev.goals || { home: 0, away: 0 };
        const currScore = event.fixture?.goals || event.goals || { home: 0, away: 0 };

        const scoreChanged = 
          prevScore.home !== currScore.home || 
          prevScore.away !== currScore.away;

        const statusChanged = prev.fixture?.status?.short !== event.fixture?.status?.short;
        const elapsedChanged = 
          (prev.fixture?.status?.elapsed || 0) !== (event.fixture?.status?.elapsed || 0);

        // Detectar atualização relevante de placar/ status
        if (scoreChanged || statusChanged || elapsedChanged) {
          scoreUpdates.push({
            event_id: id,
            score: currScore,
            status: event.fixture?.status?.short || event.status,
            elapsed: event.fixture?.status?.elapsed || event.elapsed || 0,
            // Opcional: indicar o que mudou
            goal_scored: scoreChanged ? {
              home: currScore.home > prevScore.home,
              away: currScore.away > prevScore.away
            } : null
          });
        }

        // Mudanças gerais (odds, suspensão, etc.)
        if (JSON.stringify(prev) !== JSON.stringify(event)) {
          changed.push(event);
        }
      }

      if (!changed.length && !removedIds.length && !scoreUpdates.length) {
         // No changes
      } else {
        if (removedIds.length > 0) {
          removedIds.forEach(id => {
            try {
              ws.send(JSON.stringify({
                type: 'event_removed',
                payload: { event_id: id }
              }));
            } catch (e) { void 0; }
          });
        }

        // Enviar atualizações de placar (prioridade alta, separada das odds)
        if (scoreUpdates.length > 0) {
          scoreUpdates.forEach(update => {
            try {
              ws.send(JSON.stringify({
                type: 'score_update',          // Novo tipo específico
                payload: update
              }));
            } catch (e) { void 0; }
          });
        }

        const suspendedMarkets: any[] = [];
        changed.forEach((e: any) => {
          if (!e.odds) return;
          const prevEvent = state.lastEvents.get(String(e.fixture.id));

          Object.keys(e.odds).forEach(marketKey => {
            const newMarket = e.odds[marketKey];
            const oldMarket = prevEvent?.odds?.[marketKey];

            const newSuspended = !!newMarket?.suspended;
            const oldSuspended = !!oldMarket?.suspended;
            const newReason = newMarket?.suspendReason;
            const oldReason = oldMarket?.suspendReason;

            if (newSuspended !== oldSuspended || (newSuspended && newReason !== oldReason)) {
              suspendedMarkets.push({
                eventId: e.fixture.id,
                marketId: marketKey,
                suspended: newSuspended,
                reason: newSuspended ? newReason : null
              });
            }
          });
        });

        state.lastEvents = currentEventsMap;

        // REMOVED OLD goalEvents LOGIC

        if (suspendedMarkets.length > 0) {
          suspendedMarkets.forEach(m => {
              ws.send(JSON.stringify({
                  type: 'market_suspended',
                  payload: {
                      event_id: m.eventId,
                      market: m.marketId,
                      suspended: m.suspended
                  }
              }));
          });
        }

        if (changed.length > 0) {
            ws.send(
              JSON.stringify({
                type: 'live:upsert',
                payload: changed
              })
            );
        }
      }
  } catch (outerErr) {
      console.error('[WS Process Error]', outerErr);
       if (ws.readyState === 1) {
           try {
              ws.send(JSON.stringify({ type: 'error', payload: { message: 'Internal processing error' } }));
           } catch (e) { void 0; }
       }
  }
}

import devRouter from './dev';

const app = new Hono<{ Bindings: Env }>();

// DEBUG LOGGING
app.use('*', async (c, next) => {
  console.log(`[Worker] Incoming Request: ${c.req.method} ${c.req.url}`);
  await next();
});

// Mount sub-routers
app.route('/api/dev', devRouter);

// Strict CORS Configuration - MOVED TO TOP to ensure headers are always present
const ALLOWED_ORIGINS = [
  'https://bet62.com', 
  'https://www.bet62.com',
  // Dev origins
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5177',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
  'http://127.0.0.1:5177'
];

app.use('*', cors({
  origin: (origin, c) => {
    // Always allow localhost in dev
    if (origin && (origin.includes('localhost') || origin.includes('127.0.0.1'))) return origin;
    
    // Allow requests with no origin (like curl or same-origin proxy) in dev/preview
    // We can check if the Host header is localhost
    const host = c.req.header('Host');
    if (!origin && host && (host.includes('localhost') || host.includes('127.0.0.1'))) {
       return `http://${host}`; // Return request origin as allowed origin
    }

    if (ALLOWED_ORIGINS.includes(origin)) return origin;
    if (origin && origin.endsWith('.bet62.com')) return origin; 
    return 'https://bet62.com'; // Default fallback
  },
  credentials: true,
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'Cookie', 'cache-control', 'x-requested-with', 'x-apisports-key'], // Added x-apisports-key
  exposeHeaders: ['Content-Length', 'X-Kuma-Revision'],
  maxAge: 600,
}));

app.use('*', watchdog);

// Security Hardening Headers
app.use('*', async (c, next) => {
  await next();
  c.header('X-Frame-Options', 'DENY');
  c.header('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://translate.googleapis.com https://www.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://www.gstatic.com; img-src 'self' data: https:; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self' https: wss:;");
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
});

// Global Error Handler
app.onError((err, c) => {
  let sportQuery = 'unknown';
  try { sportQuery = c.req.query('sport') || 'none'; } catch (e) { sportQuery = 'error_accessing_query'; }
  
  let envCheck = {};
  try { envCheck = { API_SPORTS_KEY: !!c.env?.API_SPORTS_KEY, ENVIRONMENT: c.env?.ENVIRONMENT }; } catch (e) { envCheck = { error: 'env_access_failed' }; }

  console.error('[Global Error]', err, 'sportQuery:', sportQuery, 'envVars:', envCheck);
  
  // Log detailed error info if available (e.g. for error 1000000)
  if ((err as any).code || (err as any).cause) {
      console.error('[Global Error Detail]', { 
          code: (err as any).code, 
          cause: (err as any).cause, 
          stack: err.stack 
      });
  }

  return c.json({
    error: 'Internal Server Error',
    message: err.message || 'Unknown error',
    path: c.req.path,
    timestamp: new Date().toISOString(),
    sportQuery,
    envCheck
  }, 500);
});

// Root Handler (Health Check)
app.get('/', (c) => c.json({
  status: 'ok',
  service: 'Bet62 API',
  version: '1.0.0',
  environment: c.env.ENVIRONMENT || 'unknown',
  time: new Date().toISOString()
}));

// Rate Limiting for Auth
// app.use(
//   '/api/auth/*',
//   rateLimiter({
//     windowMs: 15 * 60_000, // 15 minutes
//     limit: 10, // Limit each IP to 10 requests per windowMs
//     keyGenerator: (c) => c.req.header('CF-Connecting-IP') || 'unknown', // Cloudflare IP
//   })
// );

// Rate Limiting for Withdraw
// app.use(
//   '/api/wallet/withdraw',
//   rateLimiter({
//     windowMs: 15 * 60_000, // 15 minutes
//     limit: 5, // Stricter limit for withdrawals
//     keyGenerator: (c) => c.req.header('CF-Connecting-IP') || 'unknown',
//   })
// );

// Simple In-Memory Rate Limiter (Per Isolate)
const sseRateLimit = new Map<string, { count: number, resetTime: number }>();
const LIMIT_WINDOW = 60 * 1000; // 1 minute
const LIMIT_MAX = 500; // Increased limit for dev/testing to prevent connection issues

function checkRateLimit(ip: string, env?: string): boolean {
  // Bypass for local development
  if (ip === '127.0.0.1' || ip === 'localhost' || ip === '::1' || env === 'development') return true;

  const now = Date.now();
  const record = sseRateLimit.get(ip);
  
  if (!record || now > record.resetTime) {
    sseRateLimit.set(ip, { count: 1, resetTime: now + LIMIT_WINDOW });
    return true;
  }
  
  if (record.count >= LIMIT_MAX) return false;
  
  record.count++;
  return true;
}

// Helper to get latest odds
async function getLatestOdds(env: Env) {
  try {
    // Fetch latest 50 updated events across all sports
    const { results } = await env.DB.prepare(`
      SELECT io.payload, me.exposure, me.max_exposure
      FROM imported_odds io
      LEFT JOIN market_exposure me ON io.id = me.market_id
      WHERE io.publish_status = 'published'
      ORDER BY io.updated_at DESC
      LIMIT 50
    `).all();

    return results?.map((r: any) => {
        let event = null;
        try { event = JSON.parse(r.payload); } catch { return null; }
        if (!event || typeof event !== 'object') return null;

        // Clone to avoid mutation side-effects
        event = structuredClone(event);

        // FILTER: Hide past/finished games
        const status = event.fixture?.status?.short;
        if (['FT', 'AET', 'PEN', 'Finished', 'ABD', 'WO', 'INT', 'Ended', 'Final'].includes(status)) {
            return null;
        }

        // FILTER: Blacklist specific teams (e.g. Illinois vs Minnesota)
        const hName = (event.teams?.home?.name || event.home_team || '').toLowerCase();
        const aName = (event.teams?.away?.name || event.away_team || '').toLowerCase();
        if ((hName.includes('illinois') && aName.includes('minnesota')) || (aName.includes('illinois') && hName.includes('minnesota'))) {
             return null;
        }

        // Fix for Year Discrepancy (2025 vs 2026)
        const evtDate = event.event_date || event.fixture?.date;
        if (evtDate) {
            const ts = new Date(evtDate).getTime();
            const now = Date.now();
            const diff = now - ts;
            if (diff > 300 * 24 * 60 * 60 * 1000) {
                 const dYearAdj = new Date(ts);
                 dYearAdj.setFullYear(new Date(now).getFullYear());
                 const newDateIso = dYearAdj.toISOString();
                 if (event.event_date) event.event_date = newDateIso;
                 if (event.fixture) event.fixture.date = newDateIso;
            }
        }


        // Force remove Draw odd for 2-way sports (MMA, etc.)
        const sport = (event.sport || '').toLowerCase();
        const isNoDraw = ['mma', 'fighting', 'boxing', 'ufc', 'basketball', 'volleyball', 'tennis', 'american-football', 'baseball', 'handball', 'rugby', 'hockey', 'afl', 'formula'].some(s => sport.includes(s));
        
        if (isNoDraw) {
            event.draw_odd = 0;
            if (event.odds && event.odds.h2h && Array.isArray(event.odds.h2h.outcomes)) {
                event.odds.h2h.outcomes = event.odds.h2h.outcomes.filter((o: any) => {
                    const lbl = String(o.outcome || o.label || '').toLowerCase();
                    return !['x', 'draw', 'empate'].includes(lbl);
                });
            }
        }

        // Normalize ID
        if (event.fixture) event.fixture.id = String(event.fixture.id);
        if (event.id) event.id = String(event.id);

        // Fix for [object Object] league name
        if (typeof event.league === 'object' && event.league !== null) {
            event.league = event.league.name || event.league_name || (event.league.en ? event.league.en : 'Unknown League');
        } else if (event.league === '[object Object]') {
             event.league = event.league_name || 'Unknown League';
        }

        if (typeof event.league_name === 'object' && event.league_name !== null) {
             const ln: any = event.league_name;
             event.league_name = ln.name || ln.en || 'Unknown League';
             if (!event.league || event.league === 'Unknown League') event.league = event.league_name;
        }

        if (!event.league && event.league_name) {
            event.league = event.league_name;
        }

        const exposure = r.exposure || 0;
        const maxExposure = r.max_exposure || 10000;

        // Risk Engine: Auto-Suspension & Dynamic Odds
        if (exposure >= maxExposure) {
             event.suspended = true;
             event.suspendReason = 'RISK_LIMIT';
        } else if (exposure / maxExposure > 0.7) {
             // Lower odds by 5% (Anti-Sharp)
             if (event.odds) {
                 for (const k in event.odds) {
                     const m = event.odds[k];
                     if (m.outcomes) {
                         m.outcomes.forEach((o: any) => {
                             o.value = Number((o.value * 0.95).toFixed(2));
                         });
                     }
                 }
             }
        }

        return event;
    }).filter(Boolean) || [];
  } catch (e) {
    console.error('Error fetching latest odds:', e);
    return [];
  }
}

app.get('/api/live/ws', upgradeWebSocket((c) => {
  let sport: string | undefined;
  try {
    sport = c.req.query('sport');
  } catch (e) {
    // ignore query error
  }
  
  const ip = c.req.header('CF-Connecting-IP') || '127.0.0.1';
  const env = c.env;

  // STATE: Persist events for diffing during this connection

      const state = { lastEvents: new Map<string, any>() };
      
      // LOGIC: Wrapper for handleWebSocketUpdates
      const processUpdates = (ws: WSContext) => handleWebSocketUpdates(ws, env, state, sport);

  return {
    onOpen(ws: WSContext) {
      if (!checkRateLimit(ip, env.ENVIRONMENT)) {
        try {
            ws.send(JSON.stringify({ type: 'error', payload: { message: 'Too Many Requests' } }));
            ws.close(4001, 'rate_limit');
        } catch (e) { /* ignore */ }
        return;
      }

      try {
        ws.send(JSON.stringify({ type: 'connected', payload: { ok: true } }));
      } catch (e) { /* ignore */ }

      // Inicia heartbeat no servidor
      const heartbeatInterval = setInterval(() => {
        if (ws.readyState === 1) { // OPEN
          try {
            ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
          } catch (e) { void 0; }
        }
      }, 30000);

      // Inicia loop de atualização (Polling interno para enviar diffs)
      const updateInterval = setInterval(() => {
        if (ws.readyState === 1) {
             processUpdates(ws);
        } else {
             clearInterval(updateInterval);
        }
      }, 2000); // Check for updates every 2 seconds

      // Salva o timer no objeto ws para limpar depois
      (ws as any)._heartbeatInterval = heartbeatInterval;
      (ws as any)._updateInterval = updateInterval;

      // Initial Fetch (One-time)
      processUpdates(ws);
    },
    onMessage(event: MessageEvent, ws: WSContext) {
      try {
        const data = JSON.parse(event.data as string);

        // Responde imediatamente ao ping do cliente
        if (data.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
            return;
        }

        // Seu código existente de mensagens...
        processUpdates(ws);
      } catch (e) {
        // ignore
      }
    },
    onClose(_evt: CloseEvent, ws: WSContext) {
      console.log('[WS] Closed');
      const interval = (ws as any)._heartbeatInterval;
      const upInterval = (ws as any)._updateInterval;
      if (interval) clearInterval(interval);
      if (upInterval) clearInterval(upInterval);
    },
    onError(e, ws: any) { 
      console.error('[WS Error Callback]', e);
      const interval = (ws as any)._heartbeatInterval;
      const upInterval = (ws as any)._updateInterval;
      if (interval) clearInterval(interval);
      if (upInterval) clearInterval(upInterval);
    }
  };
}));

// NEW: Simple Echo Endpoint for WebSocket Testing
// This matches the user's request for a basic "Hello World" WebSocket test
app.get('/api/ws-echo', upgradeWebSocket((c) => {
  return {
    onOpen(ws: WSContext) {
      console.log("Cliente conectado (Echo)");
      ws.send("Conectado com sucesso!");
    },
    onMessage(event: MessageEvent, ws: WSContext) {
      console.log("Recebido:", event.data);
      ws.send(`Mensagem recebida pelo servidor: ${event.data}`);
    },
    onClose() {
      console.log("Cliente desconectado (Echo)");
    }
  };
}));

// import { injectOdds } from './services/oddsInjector';

// DEBUG: Manual Sync Trigger
// app.get('/api/debug/sync-feed', async (c) => {
//   const runBackground = c.req.query('background') === 'true';
//   
//   if (runBackground) {
//       c.executionCtx.waitUntil(
//           syncLiveFeed(c.env)
//             .then(res => console.log('[Background Sync] Result:', JSON.stringify(res)))
//             .catch(err => {
//                 console.error('[Background Sync] Error:', err);
//                 if (String(err).includes('1000000')) {
//                     console.error('[Background Sync] CRITICAL ERROR 1000000 DETECTED:', err);
//                 }
//             })
//       );
//       return c.json({ success: true, message: 'Sync started in background' });
//   }
//
//   try {
//       const result = await syncLiveFeed(c.env);
//       return c.json(result);
//   } catch (e: any) {
//       console.error('[Sync Feed Error]', e);
//       if (e.message?.includes('1000000') || e.code === 1000000 || e.code === '1000000') {
//           console.error('[Sync Feed] CRITICAL EXTERNAL ERROR 1000000 DETECTED:', JSON.stringify(e));
//       }
//       return c.json({ error: e.message, stack: e.stack }, 500);
//   }
// });

// NEW: Debug Endpoint for API-Sports Raw Response
// app.get('/api/debug/live-raw', async (c) => {
//     const logs: string[] = [];
//     const log = (msg: string) => logs.push(msg);
//     
//     const results: any[] = [];
//     const env = c.env;
//     
//     // Test just one sport to save time/quota: Soccer
//     const sport = 'soccer';
//     log(`Testing sport: ${sport}`);
//     
//     try {
//         const apiKey = env.API_SPORTS_KEY;
//         const cleanKey = apiKey ? apiKey.trim() : '';
//         
//         if (!cleanKey) log('API_SPORTS_KEY missing');
//         else {
//             log('API_SPORTS_KEY present (length: ' + cleanKey.length + ')');
//             log(`Key starts with: ${cleanKey.substring(0, 4)} ends with: ${cleanKey.substring(cleanKey.length - 4)}`);
//             log(`Key hex check: ${/^[a-f0-9]{32}$/i.test(cleanKey) ? 'Valid Hex' : 'Invalid Hex'}`);
//         }
//         
//         // Manual fetch to debug
//         const config = { baseUrl: 'https://v3.football.api-sports.io', endpoint: '/fixtures' };
//         const url = `${config.baseUrl}${config.endpoint}?live=all`;
//         log(`Fetching: ${url}`);
//         
//         // Attempt 1: Standard x-apisports-key
//         try {
//             log('Attempt 1: Using x-apisports-key');
//             const r1 = await withTimeout(fetch(url, { headers: { 'x-apisports-key': cleanKey } }), 8000, 'Attempt 1');
//             log(`Attempt 1 status: ${r1.status}`);
//             
//             if (!r1.ok) throw new Error(`Fetch failed: ${r1.status}`);
//
//             const t1 = await r1.text();
//             try {
//                 const d1 = JSON.parse(t1);
//                 if (d1.errors && Object.keys(d1.errors).length > 0) log(`Attempt 1 Errors: ${JSON.stringify(d1.errors)}`);
//                 else {
//                     log(`Attempt 1 Success: ${d1.response?.length} items`);
//                     results.push({ attempt: 1, data: d1 });
//                 }
//             } catch(e) { log(`Attempt 1 Parse Error: ${t1}`); }
//         } catch (e: any) { 
//             console.error('[Fetch Error Attempt 1]', e);
//             log(`Attempt 1 Exception: ${e.message}`); 
//         }
//
//         // Attempt 2: RapidAPI Header x-rapidapi-key (Just in case)
//         try {
//             log('Attempt 2: Using x-rapidapi-key');
//             const r2 = await withTimeout(fetch(url, { headers: { 'x-rapidapi-key': cleanKey } }), 8000, 'Attempt 2');
//             log(`Attempt 2 status: ${r2.status}`);
//
//             if (!r2.ok) throw new Error(`Fetch failed: ${r2.status}`);
//
//             const t2 = await r2.text();
//             try {
//                 const d2 = JSON.parse(t2);
//                 if (d2.errors && Object.keys(d2.errors).length > 0) log(`Attempt 2 Errors: ${JSON.stringify(d2.errors)}`);
//                 else {
//                     log(`Attempt 2 Success: ${d2.response?.length} items`);
//                     results.push({ attempt: 2, data: d2 });
//                 }
//             } catch(e) { log(`Attempt 2 Parse Error: ${t2}`); }
//         } catch (e: any) { 
//             console.error('[Fetch Error Attempt 2]', e);
//             log(`Attempt 2 Exception: ${e.message}`); 
//         }
//
//         // Attempt 3: RapidAPI Endpoint
//         try {
//             log('Attempt 3: RapidAPI Endpoint');
//             const rapidUrl = 'https://api-football-v1.p.rapidapi.com/v3/fixtures?live=all';
//             const rapidHeaders = {
//                 'x-rapidapi-key': cleanKey,
//                 'x-rapidapi-host': 'api-football-v1.p.rapidapi.com'
//             };
//             const r3 = await withTimeout(fetch(rapidUrl, { headers: rapidHeaders }), 8000, 'Attempt 3');
//             log(`Attempt 3 status: ${r3.status}`);
//
//             if (!r3.ok) throw new Error(`Fetch failed: ${r3.status}`);
//
//             const t3 = await r3.text();
//              try {
//                 const d3 = JSON.parse(t3);
//                 if (d3.message) log(`Attempt 3 Message: ${d3.message}`);
//                 if (d3.errors && Object.keys(d3.errors).length > 0) log(`Attempt 3 Errors: ${JSON.stringify(d3.errors)}`);
//                 else if (d3.response) {
//                     log(`Attempt 3 Success: ${d3.response?.length} items`);
//                     results.push({ attempt: 3, data: d3 });
//                 }
//             } catch(e) { log(`Attempt 3 Parse Error: ${t3}`); }
//         } catch (e: any) { 
//             console.error('[Fetch Error Attempt 3]', e);
//             log(`Attempt 3 Exception: ${e.message}`); 
//         }
//         
//         // Attempt 4: Hardcoded Key from .dev.vars
//         try {
//             log('Attempt 4: Hardcoded Key cbef02a7c902f0dfb7260b0b638fffa0');
//             const hardKey = 'cbef02a7c902f0dfb7260b0b638fffa0';
//             const r4 = await withTimeout(fetch(url, { headers: { 'x-apisports-key': hardKey } }), 8000, 'Attempt 4');
//             log(`Attempt 4 status: ${r4.status}`);
//
//             if (!r4.ok) throw new Error(`Fetch failed: ${r4.status}`);
//
//             const t4 = await r4.text();
//             try {
//                 const d4 = JSON.parse(t4);
//                 if (d4.errors && Object.keys(d4.errors).length > 0) log(`Attempt 4 Errors: ${JSON.stringify(d4.errors)}`);
//                 else {
//                     log(`Attempt 4 Success: ${d4.response?.length} items`);
//                     results.push({ attempt: 4, data: d4 });
//                 }
//             } catch(e) { log(`Attempt 4 Parse Error: ${t4}`); }
//         } catch (e: any) { 
//             console.error('[Fetch Error Attempt 4]', e);
//             log(`Attempt 4 Exception: ${e.message}`); 
//         }
//         
//     } catch (e: any) {
//         log(`Global Exception: ${e.message}`);
//     }
//     
//     return c.json({ logs, results });
// });

// Duplicate endpoint removed (merged into main endpoint below)

// Internal fetch endpoints removed



// INTERNAL: Get Events from DB (Fast, No External API)
app.get('/api/internal/events-db', async (c) => {
  try {
    const status = c.req.query('status') || 'live'; 
    
    const { results } = await c.env.DB.prepare(`
      SELECT payload FROM imported_odds 
      WHERE is_live = 1
      ORDER BY updated_at DESC 
      LIMIT 200
    `).all();
    
    const events = results.map((r: any) => {
        let e;
        try { e = JSON.parse(r.payload); } catch { return null; }
        if (!e) return null;

        // Fix for [object Object] league name
        if (typeof e.league === 'object' && e.league !== null) {
            e.league = e.league.name || e.league_name || 'Unknown League';
        } else if (!e.league && e.league_name) {
            e.league = e.league_name;
        }

        // Fix for Year Discrepancy (2025 vs 2026)
        const evtDate = e.event_date || e.fixture?.date;
        if (evtDate) {
            const ts = new Date(evtDate).getTime();
            const now = Date.now();
            const diff = now - ts;
            if (diff > 300 * 24 * 60 * 60 * 1000) {
                 const dYearAdj = new Date(ts);
                 dYearAdj.setFullYear(new Date(now).getFullYear());
                 const newDateIso = dYearAdj.toISOString();
                 if (e.event_date) e.event_date = newDateIso;
                 if (e.fixture) e.fixture.date = newDateIso;
            }
        }
        
        return e;
    }).filter((e: any) => {
        if (!e) return false;
        
        // Robust status extraction
        const s = e.fixture?.status?.short || e.status?.short || e.status;

        // STRICT FILTER: Always exclude finished events regardless of query status
        if (['FT', 'AET', 'PEN', 'Finished', 'ABD', 'WO', 'INT', 'Ended', 'Final'].includes(s)) {
            return false;
        }

        if (status === 'live') {
            // Expanded valid live statuses to include Basketball (Q1-Q4), Tennis (S1-S5), Baseball (IN1-9), etc.
            const validLiveStatuses = [
                // Soccer
                '1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE', 'PEN',
                // Basketball
                'Q1', 'Q2', 'Q3', 'Q4', 'OT', 'H1', 'H2',
                // Tennis / Volleyball
                'S1', 'S2', 'S3', 'S4', 'S5', 'Set 1', 'Set 2', 'Set 3', 'Set 4', 'Set 5',
                // Baseball
                'IN1', 'IN2', 'IN3', 'IN4', 'IN5', 'IN6', 'IN7', 'IN8', 'IN9', 'IN',
                // Hockey / Others
                'P1', 'P2', 'P3', 'Period 1', 'Period 2', 'Period 3'
            ];
            return validLiveStatuses.includes(s);
        } else if (status === 'pregame') {
            return ['NS', 'TBD'].includes(s);
        }
        return true;
    });
    
    return c.json(events);
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

app.get('/api/debug/imported', async (c) => {
    const { results } = await c.env.DB.prepare("SELECT payload FROM imported_odds WHERE is_live = 1 LIMIT 1").all();
    return c.json(results);
});

// Internal save-live-data removed

// INTERNAL: Get Single Event Details (by External ID)
app.get('/api/internal/event/:id', async (c) => {
  const id = c.req.param('id');
  try {
    // 1. Try imported_odds first (Source of Truth for Live Data)
    const imported: any = await c.env.DB.prepare('SELECT payload FROM imported_odds WHERE id = ?').bind(id).first();
    
    if (imported && imported.payload) {
        try {
            const event = JSON.parse(imported.payload);
            
            // Fix for Year Discrepancy (2025 vs 2026)
            const evtDate = event.event_date || event.fixture?.date;
            if (evtDate) {
                const ts = new Date(evtDate).getTime();
                const now = Date.now();
                const diff = now - ts;
                if (diff > 300 * 24 * 60 * 60 * 1000) {
                     const dYearAdj = new Date(ts);
                     dYearAdj.setFullYear(new Date(now).getFullYear());
                     const newDateIso = dYearAdj.toISOString();
                     if (event.event_date) event.event_date = newDateIso;
                     if (event.fixture) event.fixture.date = newDateIso;
                }
            }
            
            // Normalize teams
            let teams = event.teams;
            if (!teams && event.fixture) {
                teams = {
                    home: { name: event.fixture.home_team || event.home_team },
                    away: { name: event.fixture.away_team || event.away_team }
                };
            } else if (!teams && event.home_team && event.away_team) {
                 teams = {
                    home: { name: event.home_team },
                    away: { name: event.away_team }
                };
            }

            // Normalize league
            let league = event.league;
            if (!league && event.fixture) {
                 league = { name: event.fixture.league_name || event.league_name };
            } else if (!league && event.league_name) {
                league = { name: event.league_name };
            }
            
            return c.json({
                fixture: event.fixture,
                teams: teams,
                league: league,
                event: { ...event, id: event.fixture?.id || id } // Ensure ID compatibility
            });
        } catch (e) {
            console.warn('[InternalEvent] Failed to parse imported payload', e);
        }
    }

    // 2. Fallback to normalized events table
    // Try external_event_id first
    let event: any = await c.env.DB.prepare('SELECT * FROM events WHERE external_event_id = ?').bind(id).first();
    // Fallback to id
    if (!event) {
        event = await c.env.DB.prepare('SELECT * FROM events WHERE id = ?').bind(id).first();
    }
    
    if (!event) return c.json({ error: 'Event not found' }, 404);
    
    // Normalize for internal use
    const normalized = {
        fixture: { id: event.external_event_id || event.id, status: { short: Number(event.is_live) === 1 ? 'LIVE' : 'NS' } },
        teams: { home: { name: event.home_team }, away: { name: event.away_team } },
        league: { name: event.league },
        event 
    };
    
    return c.json(normalized);
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});









// Internal cleanup-stale-events removed



// INTERNAL: Update Event Statuses (Time-based triggers)
app.post('/api/internal/update-statuses', async (c) => {
  try {
    const result = await updateEventStatuses(c.env);
    return c.json(result);
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// Internal cleanup-stale-events (failsafe) removed

// TEMP: Force Clear Soccer Live Events
app.post('/api/internal/force-clear-soccer', async (c) => {
    try {
        await c.env.DB.prepare(`DELETE FROM imported_odds WHERE sport = 'soccer'`).run();
        await c.env.DB.prepare(`DELETE FROM events WHERE sport = 'soccer' AND is_live = 1`).run();
        return c.json({ success: true, message: "Cleared all live soccer events" });
    } catch (e: any) {
        return c.json({ error: e.message }, 500);
    }
});

// NEW: Raw Odds Snapshot (for Node Server)
app.get('/api/odds-snapshot', async (c) => {
    try {
        const { results } = await c.env.DB.prepare(
            `SELECT payload FROM imported_odds WHERE sport = 'football' OR sport = 'soccer'`
        ).all();

        const odds = results?.map((r: any) => {
            try { return JSON.parse(r.payload); } catch { return null; }
        }).filter(Boolean) || [];

        return c.json(odds, 200, {
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
        });
    } catch (e: any) {
        return c.json({ error: e.message }, 500, {
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
        });
    }
});

// Helper to ensure events table exists - REMOVED (Runtime DDL forbidden)
// const ensureEventsTable = async (db: D1Database) => { ... }

// const ensureBetsSchema = async (db: D1Database) => { ... }

const recordPerf = (name: string, duration: number, success: boolean) => {
  console.log(`[Perf] ${name}: ${duration}ms (Success: ${success})`);
};

// Mount sub-routers
app.route('/api/wallet', wallet);
app.route('/api/bets', bets);
app.route('/api/auth', auth);
app.route('/api/users', users);
app.route('/api/favorites', favorites);
app.route('/api/promotions', promotions);
app.route('/api/dev', dev);
app.route('/api/admin', admin);
app.route('/api/trading', trading);
app.route('/api/deposits', deposits);
app.route('/api/metrics', metrics);




import {
  MARKET_CONFIG,
  MARKET_GROUPS,
  BASKETBALL_GROUPS,
  TENNIS_GROUPS,
  VOLLEYBALL_GROUPS,
  AFL_GROUPS,
  BASEBALL_GROUPS,
  FORMULA1_GROUPS,
  // AMERICAN_FOOTBALL_GROUPS,
  HANDBALL_GROUPS,
  ICE_HOCKEY_GROUPS,
  MMA_GROUPS,
  RUGBY_GROUPS
} from './config/marketConfig';

// Config endpoints
app.get('/api/config/markets', cacheControl({ maxAge: 3600, staleWhileRevalidate: 7200 }), (c) => {
  return c.json({
    MARKET_CONFIG,
    MARKET_GROUPS,
    BASKETBALL_GROUPS,
    TENNIS_GROUPS,
    VOLLEYBALL_GROUPS,
    AFL_GROUPS,
    BASEBALL_GROUPS,
    FORMULA1_GROUPS,
    // AMERICAN_FOOTBALL_GROUPS,
    HANDBALL_GROUPS,
    ICE_HOCKEY_GROUPS,
    MMA_GROUPS,
    RUGBY_GROUPS
  });
});

app.get('/api/pricing/config', (c) => {
  return c.json({
    margin_pregame: 0.05,
    margin_live: 0.08,
    min_stake: 1,
    max_stake: 1000,
    currency: 'EUR'
  });
});

app.post('/api/admin/cleanup-resync', async (c) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '');
  let deletedImported = 0;
  let deletedEvents = 0;
  try {
    const di = await c.env.DB.prepare('DELETE FROM imported_odds').run();
    deletedImported = di.meta.changes || 0;
  } catch (e) { console.error('[Cleanup] Error deleting imported_odds:', e); }
  try {
    const de = await c.env.DB.prepare('DELETE FROM events').run();
    deletedEvents = de.meta.changes || 0;
  } catch (e) { console.error('[Cleanup] Error deleting events:', e); }
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dates = [today.toISOString().split('T')[0], tomorrow.toISOString().split('T')[0]];
  const sportsToSync = ['soccer','basketball','tennis','hockey','volleyball','handball','baseball','rugby','afl','formula1','mma'];
  const syncService = new EventSyncService(c.env);
  if (c.executionCtx && c.executionCtx.waitUntil) {
    c.executionCtx.waitUntil((async () => {
      // for (const sport of sportsToSync) {
      //   for (const date of dates) {
      //     console.log(`[Sync] Fetching ${sport} for ${date}...`);
      //     await fetchApiSportsData(c.env, sport, date).catch((e) => console.error(`[Sync Error] ${sport} ${date}:`, e));
      //   }
      // }
      // await syncTheOddsApi(c.env).catch((e) => console.error('[Sync Error] TheOddsApi:', e));
      await syncService.syncEventsFromImported().catch((e) => console.error('[Sync Error] SyncEvents:', e));
    })());
  } else {
    (async () => {
      // for (const sport of sportsToSync) {
      //   for (const date of dates) {
      //     console.log(`[Sync] Fetching ${sport} for ${date}...`);
      //     await fetchApiSportsData(c.env, sport, date).catch((e) => console.error(`[Sync Error] ${sport} ${date}:`, e));
      //   }
      // }
      // await syncTheOddsApi(c.env).catch((e) => console.error('[Sync Error] TheOddsApi:', e));
      await syncService.syncEventsFromImported().catch((e) => console.error('[Sync Error] SyncEvents:', e));
    })();
  }
  return c.json({
    success: true,
    deleted_imported_odds: deletedImported,
    deleted_events: deletedEvents,
    started: true,
    timestamp: new Date().toISOString()
  });
});

app.post('/api/tools/cleanup-resync', async (c) => {
  let deletedImported = 0;
  let deletedEvents = 0;
  try {
    const di = await c.env.DB.prepare('DELETE FROM imported_odds').run();
    deletedImported = di.meta.changes || 0;
  } catch { /* empty */ }
  try {
    const de = await c.env.DB.prepare('DELETE FROM events').run();
    deletedEvents = de.meta.changes || 0;
  } catch { /* empty */ }
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dates = [today.toISOString().split('T')[0], tomorrow.toISOString().split('T')[0]];
  const sportsToSync = ['soccer','basketball','tennis','hockey','volleyball','handball','baseball','rugby','afl','formula1','mma'];
  const syncService = new EventSyncService(c.env);
  if (c.executionCtx && c.executionCtx.waitUntil) {
    c.executionCtx.waitUntil((async () => {
      // for (const sport of sportsToSync) {
      //   for (const date of dates) {
      //     await fetchApiSportsData(c.env, sport, date).catch(() => { /* empty */ });
      //   }
      // }
      // await syncTheOddsApi(c.env).catch(() => { /* empty */ });
      await syncService.syncEventsFromImported().catch(() => { /* empty */ });
    })());
  } else {
    (async () => {
      // for (const sport of sportsToSync) {
      //   for (const date of dates) {
      //     await fetchApiSportsData(c.env, sport, date).catch(()=>{});
      //   }
      // }
      // await syncTheOddsApi(c.env).catch(()=>{});
      await syncService.syncEventsFromImported().catch(()=>{});
    })();
  }
  return c.json({
    success: true,
    deleted_imported_odds: deletedImported,
    deleted_events: deletedEvents,
    started: true,
    timestamp: new Date().toISOString()
  });
});

// Trading logs endpoint removed

app.get('/api/sports', cacheControl({ maxAge: 300, staleWhileRevalidate: 600 }), (c) => {
  return c.json([
    { id: 'soccer', name: 'Futebol', active: true },
    { id: 'basketball', name: 'Basquetebol', active: true },
    { id: 'tennis', name: 'Tênis', active: true },
    { id: 'hockey', name: 'Hóquei', active: true },
    { id: 'mma', name: 'MMA', active: true },
    { id: 'american-football', name: 'Futebol Americano', active: true },
    { id: 'baseball', name: 'Beisebol', active: true },
    { id: 'handball', name: 'Handebol', active: true },
    { id: 'rugby', name: 'Rúgbi', active: true },
    { id: 'volleyball', name: 'Voleibol', active: true },
    { id: 'formula1', name: 'Fórmula 1', active: true },
    { id: 'afl', name: 'AFL', active: true }
  ]);
});

// FEATURED GAMES ENDPOINT (With Scoring & Caching)
app.get('/api/featured-games', cacheControl({ maxAge: 30, staleWhileRevalidate: 60 }), async (c) => {
  try {
    // 4️⃣ LAG INTENCIONAL (ANTI-EXPLOIT) - User Requirement
    await new Promise(res => setTimeout(res, 1200));

    // 1. Check Cache (Edge/KV simulation)
    // In a real Worker with KV, we would use: await c.env.KV.get('featured-games')
    // For now, we rely on the DB being fast enough or adding simple in-memory if needed.
    // However, to follow the "Professional" instruction, we set proper Cache-Control headers.
    
    // 2. Fetch Candidates (Live + Top Upcoming)
    const now = new Date().toISOString();
    
    // Optimized Query: Use Normalized Events Table + Join for Payload
    // This avoids N+1 queries and full table scans on JSON columns
    const query = `
      SELECT e.*, io.id as external_id, io.payload, io.status
      FROM events e
      LEFT JOIN imported_odds io ON e.external_event_id = io.id
      WHERE 
          (e.is_live = 1 AND e.start_time >= datetime(?, '-24 hours'))
          OR 
          (e.start_time >= ? AND e.start_time <= datetime(?, '+48 hours'))
      ORDER BY e.is_live DESC, e.start_time ASC
      LIMIT 30
    `;
    
    const { results } = await c.env.DB.prepare(query).bind(now, now, now).all();
    let rows = results || [];

    if ((!rows || rows.length === 0) && c.env.ENVIRONMENT === 'dev') {
      const fallbackQuery = `
        SELECT e.*, io.id as external_id, io.payload, io.status
        FROM events e
        LEFT JOIN imported_odds io ON e.external_event_id = io.id
        ORDER BY e.is_live DESC, e.event_date ASC
        LIMIT 30
      `;
      const fb = await c.env.DB.prepare(fallbackQuery).all();
      rows = fb.results || [];
    }
    
    // 3. Scoring Logic (The "Brain")
    const events = rows.map((row: any) => {
        let evt: any = null;
        if (row.payload) {
            try { evt = JSON.parse(row.payload); } catch { evt = null; }
        }

        if (!evt || !evt.fixture) {
            const status = row.is_live ? 'LIVE' : 'NS';
            const h2h: any[] = [];
            if (row.home_odd) h2h.push({ label: 'home', odd: row.home_odd });
            if (row.draw_odd) h2h.push({ label: 'draw', odd: row.draw_odd });
            if (row.away_odd) h2h.push({ label: 'away', odd: row.away_odd });
            evt = {
                fixture: {
                    id: row.id,
                    date: row.event_date || row.start_time,
                    status,
                    elapsed: 0
                },
                odds: { h2h }
            };
        }

        if (String(row.external_id || '').startsWith('dev_')) return null;
        if (evt && (evt.source === 'bulk_import_tool')) return null;

        if (!evt || !evt.fixture) return null;
        
        const status = row.status || evt.fixture.status?.short || evt.fixture.status;
        if (['FT', 'AET', 'PEN', 'Finished', 'Match Finished'].includes(status)) return null;

        const score = row.is_live ? 100 : 0; // Simplified scoring since scoreEvent is removed

        // Normalize odds (Standardize & Freeze Live)
        let oddsData;
        if (isPreMatch(evt.fixture)) {
             oddsData = normalizeOdds(evt.odds, evt.fixture);
        } else {
             oddsData = { oddsFrozen: true, markets: {} };
        }

        const h2h = oddsData.markets.h2h || [];
        
        // Helper to find specific outcome
        const findOdd = (market: any[], keys: string[]) => {
            if (!market || !Array.isArray(market)) return 0;
            const match = market.find(o => keys.includes(String(o.label || o.name || o.outcome || '').toLowerCase()));
            return match ? Number(match.odd ?? match.value ?? match.price ?? 0) : 0;
        };

        const homeName = row.home_team || '';
        const awayName = row.away_team || '';

        // Force remove Draw odd for 2-way sports (MMA, etc.)
        const sport = (row.sport || '').toLowerCase();
        const isNoDraw = ['mma', 'fighting', 'boxing', 'ufc', 'basketball', 'volleyball', 'tennis', 'baseball'].some(s => sport.includes(s));

        // Prioritize calculated/payload odds over stale events table columns
        const homeOdd = findOdd(h2h, ['home', '1', 'casa', homeName.toLowerCase()]) || row.home_odd || 0;
        const drawOdd = isNoDraw ? 0 : (findOdd(h2h, ['draw', 'x', 'empate']) || row.draw_odd || 0);
        const awayOdd = findOdd(h2h, ['away', '2', 'fora', awayName.toLowerCase()]) || row.away_odd || 0;

        return {
            id: evt.fixture.id,
            fixture: evt.fixture, // Keep original fixture just in case
            league: row.league,
            home_team: row.home_team,
            away_team: row.away_team,
            event_date: row.event_date,
            status: evt.fixture.status,
            elapsed: evt.fixture.elapsed,
            is_live: row.is_live,
            home_odd: homeOdd,
            draw_odd: drawOdd,
            away_odd: awayOdd,
            _score: score
        };
    }).filter(Boolean);

    // 4. Sort and Slice
    const featured = events
        .sort((a: any, b: any) => b._score - a._score)
        .slice(0, 10); // Return top 10 (Frontend uses carousel)

    return c.json(featured, 200, {
        'Cache-Control': 'public, max-age=30, stale-while-revalidate=60',
        'CDN-Cache-Control': 'max-age=30'
    });

  } catch (e: any) {
    return c.json([], 200);
  }
});

app.get('/api/debug/db-status', async (c) => {
    try {
        const events = await c.env.DB.prepare('SELECT count(*) as c FROM events').first('c');
        const imported = await c.env.DB.prepare('SELECT count(*) as c FROM imported_odds').first('c');
        return c.json({ events, imported_odds: imported });
    } catch (e: any) {
        return c.json({ error: e.message }, 500);
    }
});

// ROBUST SYNC TEST ENDPOINT
app.get('/api/dev/force-robust-sync', async (c) => {
    try {
        const env = c.env;
        const ctx = c.executionCtx;
        
        // Run in background if possible, or await if blocking requested
        const blocking = c.req.query('blocking') === 'true';
        
        if (blocking) {
             await runRobustIntegration(env);
             return c.json({ success: true, message: 'Robust sync completed (blocking)' });
        } else {
             ctx.waitUntil(runRobustIntegration(env));
             return c.json({ success: true, message: 'Robust sync started in background' });
        }
    } catch (e: any) {
        return c.json({ error: e.message }, 500);
    }
});

// DEBUG: Inspect Imported Odds (Directly in index.ts)
app.get('/api/debug/inspect-imported', async (c) => {
    try {
        const { results: imported } = await c.env.DB.prepare(`
            SELECT payload, league_name, id, updated_at FROM imported_odds ORDER BY updated_at DESC LIMIT 5
        `).all();
        
        const { results: events } = await c.env.DB.prepare(`
            SELECT * FROM events ORDER BY updated_at DESC LIMIT 5
        `).all();
        
        const { results: stats } = await c.env.DB.prepare(`
            SELECT 
                (SELECT COUNT(*) FROM imported_odds) as imported_count,
                (SELECT COUNT(*) FROM events) as events_count,
                (SELECT COUNT(*) FROM events WHERE is_live=1) as live_events_count
        `).all();

        const parsedImported = imported.map(r => {
            try {
                return {
                    id: r.id,
                    league_col: r.league_name,
                    updated_at: r.updated_at,
                    payload: JSON.parse(r.payload as string)
                };
            } catch (e) {
                return { error: 'Parse failed', raw: r.payload };
            }
        });

        return c.json({ 
            stats: stats[0], 
            imported_samples: parsedImported,
            events_samples: events
        });
    } catch (e: any) {
        return c.json({ error: e.message }, 500);
    }
});

// Main Events Endpoint (READ ONLY FROM DB)
app.get('/api/events/by-sport', async (c) => {
  // 4️⃣ LAG INTENCIONAL (ANTI-EXPLOIT) - User Requirement
  // "Lag NÃO é bug. Lag é proteção de casa."
  // Reduced to 300ms to avoid timeouts while maintaining some protection
  await new Promise(res => setTimeout(res, 300));

  const isDevEnv = c.env.ENVIRONMENT === 'dev' || c.env.ENVIRONMENT === 'development' || c.env.DEV_MODE === 'true';

  const splitEvents = (list: any[]) => {
    const live: any[] = [];
    const pregame: any[] = [];

    // SIMULATION MODE: Fix 'now' to 2026-03-07 to match target date
    const now = new Date('2026-03-07T12:00:00Z'); 
    // const now = new Date();

    // Extended list of finished statuses
    const finishedStatuses = ['FT', 'AET', 'PEN', 'Finished', 'Match Finished', 'AOT', 'AP', 'Ended', 'Final', 'WO', 'ABD', 'AWD'];

    list.forEach((evt: any) => {
      const status = evt.fixture?.status?.short || evt.status;
      let isLive = false;

      if (typeof evt.is_live !== 'undefined' && Number(evt.is_live) === 1) {
        isLive = true;
      }

      if (!isLive) {
        if (['1H', '2H', 'HT', 'ET', 'P', 'LIVE', 'Q1', 'Q2', 'Q3', 'Q4', 'OT', 'BT', 'S1', 'S2', 'S3', 'S4', 'S5', 'P1', 'P2', 'P3', 'IN1', 'IN2', 'IN3', 'IN4', 'IN5', 'IN6', 'IN7', 'IN8', 'IN9'].includes(status)) {
          isLive = true;
        }
        if (evt.fixture?.status?.elapsed > 0 && !finishedStatuses.includes(status)) {
          isLive = true;
        }
      }

      // DEBUG LOGGING
      // console.log(`[Split] Event ${evt.id} | Status: ${status} | isLiveDB: ${evt.is_live} | CalcLive: ${isLive}`);

      // Safety Check: If Live but started > 4h ago, treat as Finished/Suspicious (hide)
      // Exception: Cricket (removed for now)
      if (isLive) {
          // STRICT: Check if status is actually finished (Safety Net)
          if (finishedStatuses.includes(status)) {
             // console.log(`[Filter] Hiding 'Live' event with finished status: ${evt.id} (${status})`);
             return;
          }

          const d = new Date(evt.event_date || evt.fixture?.date);
          // If valid date and older than 3.5 hours (Strict for Soccer/General to avoid stuck games)
          if (!Number.isNaN(d.getTime()) && d.getTime() < now.getTime() - 3.5 * 60 * 60 * 1000) {
             // console.log(`[Filter] Hiding stuck live event (>3.5h): ${evt.id} (${evt.home_team} vs ${evt.away_team}) - Date: ${d.toISOString()}`);
             return;
          }
      }

      if (isLive) {
        live.push(evt);
        return;
      }

      const dateStr = evt.event_date || evt.fixture?.date;
      if (!dateStr) return;

      const d = new Date(dateStr);
      if (Number.isNaN(d.getTime())) return;

      if (finishedStatuses.includes(status)) return;

      // Expanded to 14 days (336 hours)
      const futureWindowMs = 336 * 60 * 60 * 1000;
      // STRICT: Pre-Match events must be in the future or VERY recently started (buffer for delay)
      // Relaxed from 20 mins to 3 hours to ensure late-starting games are not hidden before they turn Live
      const pastWindowMs = 3 * 60 * 60 * 1000; 

      if (d.getTime() >= now.getTime() - pastWindowMs && d.getTime() <= now.getTime() + futureWindowMs) {
        // 🥇 REGRA DE VISIBILIDADE PRÉ-JOGO (ADAPTADA PARA 60 EVENTOS)
        // Expandido para 14 dias para garantir volume de jogos no front
        const hoursToKickoff = (d.getTime() - now.getTime()) / (1000 * 60 * 60);
        
        // Se estiver fora da janela de 14 dias (336h), esconder
        if (hoursToKickoff > 336) {
             // console.log(`[Filter] Hiding Pre-Match event outside 336h window: ${evt.id} (${hoursToKickoff.toFixed(1)}h)`);
             return;
        }

        // EXTRA SAFETY: If hoursToKickoff is negative (past), it must be very small (covered by pastWindowMs)
        // Relaxed from -0.4h to -3h to allow recently started games to appear as Pre-Match if live feed is delayed
        if (hoursToKickoff < -3) { 
             // console.log(`[Filter] Hiding Pre-Match event in the past: ${evt.id} (${hoursToKickoff.toFixed(1)}h)`);
             return;
        }

        pregame.push(evt);
      } else {
        // console.log(`[Split] Dropped event ${evt.id} (${evt.home_team} vs ${evt.away_team}) - Date: ${d.toISOString()} (Now: ${now.toISOString()})`);
      }
    });

    console.log(`[API] Split Result - Live: ${live.length}, Pregame: ${pregame.length}`);
    return { live, pregame };
  };

  // Support both 'sport' and 'sports' query params
  let sport = c.req.query('sport') || c.req.query('sports') || 'soccer';
  const league = c.req.query('league');
  const rawMode = c.req.query('raw') === '1' || c.req.query('raw') === 'true';
  
  // Clean up if multiple comma-separated values are passed (take first)
  if (sport.includes(',')) {
      sport = sport.split(',')[0];
  }
  
  // Normalize common aliases from frontend
  if (sport === 'hockey') sport = 'ice-hockey';
  if (sport === 'nba') sport = 'basketball';
  if (sport === 'football') sport = 'soccer';
  if (sport === 'soccer-all') sport = 'soccer';

  // Normalize 'all' to allow querying everything (if needed) or keep 'soccer' default
  const isAll = sport === 'all';

  // Note: DB uses 'soccer'. Do not convert to 'football'.

  // Improved Query: Prioritize Live and Upcoming, Exclude Finished
  // SIMULATION MODE: Fix 'nowDate' to 2026-03-07
  const nowDate = new Date('2026-03-07T12:00:00Z');
  // const nowDate = new Date();
  const now = nowDate.toISOString();
  // Increased window to 4h to capture long running games (NFL/MLB) that might be missing live status
  const recentWindowMs = 4 * 60 * 60 * 1000;
  const nowTs = nowDate.getTime();
  console.log(`[API] Fetching events for sport=${sport} (isAll=${isAll}) at ${now}`);
  
  // Refactored to use 'events' table for normalized data access
  // DEBUG: Check what sports are actually in the DB
  if (isDevEnv || sport === 'soccer') {
      try {
          const distinctSports = await c.env.DB.prepare("SELECT DISTINCT sport, COUNT(*) as count FROM events GROUP BY sport").all();
          console.log('[API] DB Sport Distribution:', JSON.stringify(distinctSports.results));
      } catch (e) {
          console.error('[API] Failed to query distinct sports:', e);
      }
  }

  let query = `
    SELECT 
        id, 
        external_event_id,
        league,
        home_team,
        away_team,
        home_odd,
        draw_odd,
        away_odd,
        event_date,
        status,
        is_live,
        score,
        sport,
        markets,
        market_status
    FROM events
    WHERE 
        (
            (is_live = 1)
            OR
            (
                event_date >= datetime(?, '-12 hours') 
                AND event_date <= datetime(?, '+30 days')
            )
        )
  `;
  const params: any[] = [now, now];

  if (!isAll) {
      query += ` AND sport = ?`;
      params.push(sport);
  }

  // Robust Integration already handles status filtering, but we can double check
  
  query += ` ORDER BY is_live DESC, event_date ASC LIMIT 500`;

  let results: any[] = [];
  try {
    const res = await c.env.DB.prepare(query).bind(...params).all();
    results = res.results || [];
    console.log(`[API] DB Query returned ${results.length} rows from events table for sport=${sport}`);

    if (rawMode) {
        return c.json({
            mode: 'raw',
            count: results.length,
            sample: results.slice(0, 5),
            query: query,
            params: params,
            now: now
        });
    }
  } catch (e: any) {
            console.error('[API] Error fetching events in /api/events/by-sport:', e);
            results = [];
          }

  const normalizeTeam = (s: string) =>
    String(s || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();

  const matchUID = (home: string, away: string, date: string | null | undefined) =>
    `${normalizeTeam(home)}-vs-${normalizeTeam(away)}-${String(date || '').slice(0, 10)}`;

  const scoreEventRow = (e: any) =>
    (Number(e.home_odd || 0) > 0 ? 1 : 0) +
    (Number(e.draw_odd || 0) > 0 ? 1 : 0) +
    (Number(e.away_odd || 0) > 0 ? 1 : 0) +
    (Number(e.is_live || 0) === 1 ? 1 : 0);

  const dedupEvents = (list: any[]) => {
    const by = new Map<string, any>();
    for (const e of list) {
      const k = matchUID(String(e.home_team || ''), String(e.away_team || ''), e.event_date);
      const prev = by.get(k);
      if (!prev) {
        by.set(k, e);
        continue;
      }
      const sPrev = scoreEventRow(prev);
      const sCur = scoreEventRow(e);
      if (sCur > sPrev) by.set(k, e);
    }
    return Array.from(by.values());
  };

  const events = (results || []).map((r: any) => {
      // Data is already normalized in 'events' table
      let leagueName = r.league;
      if (leagueName === '[object Object]' || typeof leagueName !== 'string') {
          leagueName = 'Unknown League';
      }
      
      const hName = (r.home_team || '').toLowerCase();
      const aName = (r.away_team || '').toLowerCase();

      // Strict Filter for Unknown Names (Backend Side)
      if (
          !hName || !aName || 
          hName.includes('unknown') || 
          aName.includes('unknown')
      ) {
          // Relaxed for development/testing if needed, but keeping for prod quality
          // return null;
      }

      // TODO: Add isSmallLeagueName check if needed, but EventSyncService should have filtered it
      if (isSmallLeagueName(leagueName, '')) return null;

      const evtDate = r.event_date;
      
      // Fix for status parsing (handle JSON string or object)
      let statusShort = 'NS';
      try {
          if (r.status) {
              if (typeof r.status === 'object') {
                  statusShort = r.status.short || 'NS';
              } else if (typeof r.status === 'string') {
                  if (r.status.startsWith('{')) {
                      const parsed = JSON.parse(r.status);
                      statusShort = parsed.short || 'NS';
                  } else {
                      const s = r.status.toUpperCase();
                      if (s.includes('[OBJECT OBJECT]') || s.includes('UNDEFINED')) {
                          statusShort = 'NS';
                      } else {
                          statusShort = r.status;
                      }
                  }
              }
          }
      } catch (e) {
          statusShort = 'NS';
      }

      const finalIsLive = r.is_live;
      
      const finalStatus = {
          short: statusShort,
          long: statusShort,
          elapsed: 0 // Placeholder as events table doesn't store elapsed yet
      };

      const tradingStatus = r.market_status || 'active';
      const manualOdds = null; // Placeholder until manual_odds column is added

      const isPast = new Date(evtDate).getTime() < Date.now();
      
      // Log for debugging
      if (isDevEnv) console.log(`[Dev] Event ${r.id} isPast: ${isPast}, status: ${statusShort}, isLive: ${finalIsLive}`);

      // 2. Filter by Status
      if (['FT', 'AET', 'PEN', 'Finished', 'Match Finished'].includes(statusShort)) return null;

      // 3. Normalize Odds
      // LOGIC: If Pre-Match, use imported odds.
      // If Live, use Internal Live Engine.
      let oddsData: { oddsFrozen: boolean; markets: any } = { oddsFrozen: false, markets: {} };
      
      // Parse markets JSON
      let markets: any = {};
      try {
          markets = r.markets ? JSON.parse(r.markets) : {};
      } catch {
          markets = {};
      }

      const isPreMatchEvent = finalIsLive === 0 && ['NS', 'PST'].includes(statusShort);

      if (isPreMatchEvent) {
          oddsData.markets = markets;
          
          // Apply Home Advantage (User Request: "Ativar vantagem de MANDO DE CAMPO")
          let h2hMarket: any = null;
          
          if (Array.isArray(oddsData.markets)) {
              h2hMarket = oddsData.markets.find((m: any) => m.key === 'h2h');
          } else if (oddsData.markets && oddsData.markets.h2h) {
              // Handle object format (legacy or alternative)
              if (Array.isArray(oddsData.markets.h2h)) {
                  // Legacy format where h2h is the array of outcomes
                   h2hMarket = { outcomes: oddsData.markets.h2h };
              } else {
                  h2hMarket = oddsData.markets.h2h;
              }
          }

          if (h2hMarket && (h2hMarket.outcomes || h2hMarket.selections)) {
             const outcomes = h2hMarket.outcomes || h2hMarket.selections;
             if (Array.isArray(outcomes)) {
                 const homeObj = outcomes.find((o: any) => String(o.outcome) === '1' || o.id === 'home' || o.id === 'sel_home');
                 const drawObj = outcomes.find((o: any) => String(o.outcome) === 'X' || o.id === 'draw' || o.id === 'sel_draw');
                 const awayObj = outcomes.find((o: any) => String(o.outcome) === '2' || o.id === 'away' || o.id === 'sel_away');
    
                 if (homeObj && awayObj) {
                     const rawOdds = {
                         home: Number(homeObj.odd || homeObj.value || homeObj.price),
                         draw: drawObj ? Number(drawObj.odd || drawObj.value || drawObj.price) : undefined,
                         away: Number(awayObj.odd || awayObj.value || awayObj.price)
                     };
                     
                     const newOdds = applyHomeAdvantage(rawOdds);
                     
                     // Update objects
                     if (newOdds.home) {
                        homeObj.odd = newOdds.home;
                        homeObj.value = newOdds.home;
                        homeObj.price = newOdds.home;
                     }
                     
                     if (drawObj && newOdds.draw) {
                         drawObj.odd = newOdds.draw;
                         drawObj.value = newOdds.draw;
                         drawObj.price = newOdds.draw;
                     }
                     
                     if (newOdds.away) {
                        awayObj.odd = newOdds.away;
                        awayObj.value = newOdds.away;
                        awayObj.price = newOdds.away;
                     }
                 }
             }
          }
          
          // Fallback if markets structure is empty but columns exist
          const hasH2HInMarkets = !!h2hMarket;

          if (!hasH2HInMarkets && (r.home_odd || r.draw_odd || r.away_odd)) {
              const colH2H: H2HOutcome[] = [];
              if (r.home_odd) colH2H.push({ outcome: '1', value: r.home_odd, odd: r.home_odd });
              if (r.draw_odd) colH2H.push({ outcome: 'X', value: r.draw_odd, odd: r.draw_odd });
              if (r.away_odd) colH2H.push({ outcome: '2', value: r.away_odd, odd: r.away_odd });
              
              // Force object structure for legacy fallback to avoid array property assignment issues
              if (Array.isArray(oddsData.markets)) {
                  oddsData.markets = {}; 
              }
              
              oddsData.markets.h2h = applyHouseMarginToH2H(colH2H);
              oddsData.oddsFrozen = false;
          }
          } else {
              // LIVE ENGINE
          if (r.market_status === 'suspended') {
              oddsData = {
                  oddsFrozen: true,
                  markets: {}
              };
          } else {
              // Use stored markets if available and valid
              if (markets && Object.keys(markets).length > 0) {
                   // Validate if markets actually has content (e.g. h2h)
                   const hasContent = markets.h2h || markets.main || (Array.isArray(markets) && markets.length > 0);
                   if (hasContent) {
                       oddsData = { oddsFrozen: false, markets: markets };
                   } else {
                       // Empty markets object -> try columns
                       if (r.home_odd || r.away_odd) {
                            oddsData = { oddsFrozen: false, markets: {} };
                            oddsData.markets.h2h = [
                                { id: '1', name: '1', outcome: '1', value: r.home_odd, odd: r.home_odd, price: r.home_odd },
                                ...(r.draw_odd ? [{ id: 'X', name: 'X', outcome: 'X', value: r.draw_odd, odd: r.draw_odd, price: r.draw_odd }] : []),
                                { id: '2', name: '2', outcome: '2', value: r.away_odd, odd: r.away_odd, price: r.away_odd }
                            ];
                       } else {
                            oddsData = { oddsFrozen: true, markets: {} };
                       }
                   }
              } else {
                   // No markets object -> try columns
                   if (r.home_odd || r.away_odd) {
                        oddsData = { oddsFrozen: false, markets: {} };
                        oddsData.markets.h2h = [
                           { id: '1', name: '1', outcome: '1', value: r.home_odd, odd: r.home_odd, price: r.home_odd },
                           ...(r.draw_odd ? [{ id: 'X', name: 'X', outcome: 'X', value: r.draw_odd, odd: r.draw_odd, price: r.draw_odd }] : []),
                           { id: '2', name: '2', outcome: '2', value: r.away_odd, odd: r.away_odd, price: r.away_odd }
                        ];
                   } else {
                        oddsData = { oddsFrozen: true, markets: {} };
                   }
              }
          }
      }

      // Apply trading panel decisions (manual odds / suspension)
      if (tradingStatus === 'suspended') {
          oddsData.oddsFrozen = true;
          oddsData.markets = {};
      } else if (tradingStatus === 'approved' && manualOdds && typeof manualOdds === 'object') {
          const manualMarkets = (manualOdds as any).markets && typeof (manualOdds as any).markets === 'object'
              ? (manualOdds as any).markets
              : manualOdds;

          if (manualMarkets && typeof manualMarkets === 'object') {
              oddsData.markets = {
                  ...oddsData.markets,
                  ...manualMarkets
              };
              oddsData.oddsFrozen = false;
          }
      }

      // Helper to find specific outcome
      const findOdd = (market: any[], keys: string[]) => {
          if (!market || !Array.isArray(market)) return 0;
          const match = market.find(o => keys.includes(String(o.label || o.name || o.outcome || '').toLowerCase()));
          return match ? Number(match.odd ?? match.value ?? match.price ?? 0) : 0;
      };

      let h2hRaw = oddsData.markets.h2h;
      // Handle { outcomes: [...] } structure common in some providers or live data
      if (h2hRaw && !Array.isArray(h2hRaw) && Array.isArray((h2hRaw as any).outcomes)) {
          h2hRaw = (h2hRaw as any).outcomes;
      }
      const h2h = Array.isArray(h2hRaw) ? h2hRaw : [];

       // Use normalized columns from events table
      const homeNameRaw = r.home_team || '';
      const awayNameRaw = r.away_team || '';

      if (isDevEnv && (!homeNameRaw || !awayNameRaw || homeNameRaw === 'Home Team')) {
          console.log(`[API Debug] Event ${r.id} (${r.external_event_id}) has suspicious names: "${homeNameRaw}" vs "${awayNameRaw}"`);
      }

      // Auto-abbreviate to avoid UI breaks
       const homeName = abbreviateTeamName(homeNameRaw);
       const awayName = abbreviateTeamName(awayNameRaw);

       const rawSportForRoot = String(r.sport || leagueName || '').toLowerCase();

      // Use helper to detect market type (1X2 vs Moneyline)
      const marketType = getMainMarketType(rawSportForRoot);
      const isNoDrawSportRoot = (marketType === 'MONEYLINE');

      const rootHomeOdd = findOdd(h2h, ['home', '1', 'casa', homeName.toLowerCase(), homeNameRaw.toLowerCase()]) || Number(r.home_odd || 0);
      const rootDrawOddRaw = findOdd(h2h, ['draw', 'x', 'empate']) || Number(r.draw_odd || 0);
      const rootAwayOdd = findOdd(h2h, ['away', '2', 'fora', awayName.toLowerCase(), awayNameRaw.toLowerCase()]) || Number(r.away_odd || 0);
      const rootDrawOdd = isNoDrawSportRoot ? 0 : rootDrawOddRaw;

      // Parse goals safely
      let goals = { home: 0, away: 0 };
      try {
          if (r.score) {
              goals = JSON.parse(r.score);
          }
      } catch (e) {
          // ignore
      }

       return {
        id: r.external_event_id || r.id,
        fixture: { 
            id: r.external_event_id || r.id, 
            date: evtDate, 
            status: finalStatus,
            timestamp: Math.floor(new Date(evtDate).getTime() / 1000)
        },
        league: leagueName,
        home: { name: homeName, logo: '' },
        away: { name: awayName, logo: '' },
        // Fallbacks for direct properties
        home_team: homeName,
        away_team: awayName,
        match: `${homeName} vs ${awayName}`,
        
        date: evtDate,
        event_date: evtDate, // Frontend often uses event_date
        status: finalStatus,
        elapsed: finalStatus.elapsed,
        is_live: finalIsLive,
        goals: goals,
        score: goals, // Ensure score is available as object (or string if preferred)
        
        oddsFrozen: oddsData.oddsFrozen,
        markets: oddsData.markets,
        
        home_odd: rootHomeOdd,
        draw_odd: rootDrawOdd,
        away_odd: rootAwayOdd
      };
  }).filter(Boolean);
  
  const eventsFiltered = (events || []).filter((e: any) => {
    const dstr = e.event_date || e.fixture?.date;
    const ts = dstr ? new Date(dstr).getTime() : 0;
    if (!ts || Number.isNaN(ts)) {
        console.log(`[Filter] Dropped ${e.id}: Invalid date ${dstr}`);
        return false;
    }

    // Fix for Year Discrepancy (2025 vs 2026)
    let targetTime = ts;
    const diff = nowTs - ts;
    const isYearOff = diff > 300 * 24 * 60 * 60 * 1000;
    if (isYearOff) {
        const dYearAdj = new Date(ts);
        dYearAdj.setFullYear(new Date(nowTs).getFullYear());
        targetTime = dYearAdj.getTime();
    }

    if (targetTime < nowTs - recentWindowMs) {
        // Exception: Allow LIVE events even if they started long ago (e.g. delays, overtime, cricket)
        const isLive = Number(e.is_live) === 1 || ['1H','2H','HT','ET','P','LIVE','IN'].includes(e.status?.short || '');
        
        if (!isLive) {
            console.log(`[Filter] Dropped ${e.id}: Date too old ${dstr} (Threshold: ${new Date(nowTs - recentWindowMs).toISOString()})`);
            return false;
        }
    }

    // Filter stale NS events (older than 3h) - likely API errors or abandoned events
    const statusShort = e.status?.short || e.fixture?.status?.short || 'NS';
    if (statusShort === 'NS' && ts < nowTs - 3 * 60 * 60 * 1000) {
        console.log(`[Filter] Dropped Stale NS ${e.id}: ${dstr}`);
        return false;
    }

    // Filter Finished events (FT, AET, PEN) to prevent "old games stuck"
    if (['FT', 'AET', 'PEN', 'Finished', 'Match Finished'].includes(statusShort)) {
        // Optional: Allow recently finished (e.g. < 30 mins ago) if needed, but usually we hide them
        // For now, strictly hide them as per user request "jogos antigos ainda no fronte"
        console.log(`[Filter] Dropped Finished Event ${e.id}: ${statusShort}`);
        return false;
    }

    const hasHome = Number(e.home_odd || 0) > 0;
    const hasDraw = Number(e.draw_odd || 0) > 0;
    const hasAway = Number(e.away_odd || 0) > 0;
    const hasPrimary = hasHome || hasDraw || hasAway;

    // Filter specific user-requested blacklisted events
    const hName = (e.home_team || '').toLowerCase();
    const aName = (e.away_team || '').toLowerCase();
    if (
        (hName.includes('illinois') && aName.includes('minnesota')) ||
        (hName.includes('nc state') && aName.includes('georgia tech')) ||
        (hName.includes('hermes') && aName.includes('keupa')) ||
        (hName.includes('jokp') && aName.includes('tuto')) ||
        (hName.includes('providence') && aName.includes('creighton')) ||
        (hName.includes('kent st') && aName.includes('toledo')) ||
        (hName.includes('hurricanes') && aName.includes('panthers')) ||
        (hName.includes('red wings') && aName.includes('sharks')) ||
        (hName.includes('pacers') && aName.includes('pelicans')) ||
        (hName.includes('76ers') && aName.includes('cavaliers'))
    ) {
        console.log(`[Filter] Dropped Blocklisted Event ${e.id}: ${hName} vs ${aName}`);
        return false;
    }

    if (!hasPrimary) {
      console.log(`[Filter] Allowed Event ${e.id} without primary odds (show fixture, odds optional)`);
      return true;
    }

    return true;
  });
  
  console.log(`[API] Events after filter: ${eventsFiltered.length} (Original: ${events.length})`);

  const eventsDeduped = dedupEvents(eventsFiltered);
  console.log(`[API] Events after dedup: ${eventsDeduped.length}`);

  if (eventsDeduped.length > 0) {
    const { live, pregame } = splitEvents(eventsDeduped);
    console.log(`[API] Split Result - Live: ${live.length}, Pregame: ${pregame.length}`);
    return c.json({ live, pregame });
  }
  
  try {
    let fallbackQuery = `
      SELECT payload, status 
      FROM imported_odds 
      WHERE ${isAll ? '1=1' : 'sport = ?'} 
    `;
    const fallbackParams: any[] = isAll ? [] : [sport];

    if (league) {
        // Heuristic: search for the first meaningful part of the slug to filter JSON payload
        // e.g. 'germany' from 'germany-2-bundesliga', 'premier' from 'premier-league'
        const parts = league.replace(/-/g, ' ').toLowerCase().split(' ');
        const term = parts.find(p => p.length > 3) || parts[0];
        
        if (term && term.length >= 3) {
             fallbackQuery += ` AND payload LIKE ?`;
             fallbackParams.push(`%${term}%`);
        }
    }

    fallbackQuery += ` ORDER BY updated_at DESC LIMIT 300`;

    const fallbackRes = await c.env.DB.prepare(fallbackQuery).bind(...fallbackParams).all();
    console.log(`[API] Fallback DB Query returned ${(fallbackRes.results || []).length} rows`);
    const fbRaw = (fallbackRes.results || []).map((r: any) => {
      try {
        const data = JSON.parse(r.payload as string);
        const status = r.status || data.fixture?.status?.short;
        if (['FT', 'AET', 'PEN', 'Finished', 'Match Finished'].includes(status)) return null;
        const leagueName = data.fixture.league_name || data.league?.name;
        const leagueCountry = data.league?.country;
        if (isSmallLeagueName(leagueName, leagueCountry)) return null;
        const oddsData = normalizeOdds(data.odds, data.fixture);
        const markets = oddsData.markets || {};
        let h2hRaw: any = markets.h2h || markets.main || null;
        if (h2hRaw && !Array.isArray(h2hRaw) && Array.isArray((h2hRaw as any).outcomes)) {
          h2hRaw = (h2hRaw as any).outcomes;
        }
        const h2h = Array.isArray(h2hRaw) ? h2hRaw : [];
        if (!markets.h2h && h2h.length > 0) {
          markets.h2h = h2h;
        }
        const homeName = (typeof data.fixture.home_team === 'object' ? data.fixture.home_team?.name : data.fixture.home_team) || '';
        const awayName = (typeof data.fixture.away_team === 'object' ? data.fixture.away_team?.name : data.fixture.away_team) || '';
        const statusVar = r.status || data.fixture?.status?.short || data.fixture?.status;
        const liveFlag = ['1H','2H','HT','ET','P','LIVE','Q1','Q2','Q3','Q4','OT','BT','S1','S2','S3','S4','S5','P1','P2','P3','IN1','IN2','IN3','IN4','IN5','IN6','IN7','IN8','IN9'].includes(statusVar) ? 1 : 0;
        return {
          id: data.fixture.id,
          fixture: data.fixture,
          league: data.fixture.league_name || data.league?.name,
          home: data.fixture.home_team,
          away: data.fixture.away_team,
          home_team: homeName,
          away_team: awayName,
          match: `${homeName} vs ${awayName}`,
          date: data.fixture.date,
          event_date: data.fixture.date,
          status: statusVar,
          elapsed: data.fixture.elapsed,
          is_live: Number(r.is_live) === 1 ? 1 : liveFlag,
          oddsFrozen: oddsData.oddsFrozen,
          markets,
          home_odd: h2h?.[0]?.odd || 0,
          draw_odd: h2h?.[1]?.odd || 0,
          away_odd: h2h?.[2]?.odd || 0
        };
      } catch { return null; }
    }).filter(Boolean);
    console.log(`[API] fbRaw length after map: ${fbRaw.length}`);
    const fb = fbRaw.filter((e: any) => {
      // Filter specific user-requested blacklisted events
      const hName = (e.home_team || '').toLowerCase();
      const aName = (e.away_team || '').toLowerCase();
      if (
          (hName.includes('illinois') && aName.includes('minnesota')) ||
          (hName.includes('nc state') && aName.includes('georgia tech')) ||
          (hName.includes('hermes') && aName.includes('keupa')) ||
          (hName.includes('jokp') && aName.includes('tuto')) ||
          (hName.includes('providence') && aName.includes('creighton')) ||
          (hName.includes('kent st') && aName.includes('toledo')) ||
          (hName.includes('hurricanes') && aName.includes('panthers')) ||
          (hName.includes('red wings') && aName.includes('sharks')) ||
          (hName.includes('pacers') && aName.includes('pelicans')) ||
          (hName.includes('76ers') && aName.includes('cavaliers'))
      ) {
          return false;
      }

      // Se for evento ao vivo (is_live=1), permitimos passar mesmo sem data ou fora da janela
      if (Number(e.is_live) === 1) {
        // Allow live events even without odds for score display
        return true;
      }

      const dstr = e.event_date || e.fixture?.date;
      const ts = dstr ? new Date(dstr).getTime() : 0;
      if (!ts || Number.isNaN(ts)) return false;
      
      // Fix for Year Discrepancy (2025 vs 2026)
      let targetTime = ts;
      const diff = nowTs - ts;
      const isYearOff = diff > 300 * 24 * 60 * 60 * 1000;
      if (isYearOff) {
          const dYearAdj = new Date(ts);
          dYearAdj.setFullYear(new Date(nowTs).getFullYear());
          targetTime = dYearAdj.getTime();
      }

      if (targetTime < nowTs - recentWindowMs) return false;
      
      return true;
    });
    if (fb.length > 0) {
      const { live, pregame } = splitEvents(fb);
      return c.json({ live, pregame });
    }
  } catch (err) {
    // ignore and try external fallback
  }

  // Fast live-only fallback for football (DISABLED)
  // getLiveScores logic removed
  /*
  try {
    if (!isAll && (sport === 'soccer' || sport === 'football')) {
       // ... code removed ...
    }
  } catch (e) {
    console.error('Live fallback error:', e);
  }
  */
 
  // Fallback to API-Sports directly if DB is empty
  const sportKey = SPORT_PARAM_TO_CONFIG[sport] || sport;
  const config = API_SPORTS_CONFIG[sportKey];

  if (config && c.env.API_SPORTS_KEY) {
        console.log(`[API] Fallback: Fetching from ${config.url} for ${sportKey}`);
        try {
            const liveUrl = `${config.url}?live=all`;
            const liveRes = await fetch(liveUrl, {
                headers: {
                    'x-apisports-key': c.env.API_SPORTS_KEY,
                    'x-rapidapi-key': c.env.API_SPORTS_KEY
                }
            });
           
           if (liveRes.ok) {
               const liveData: any = await liveRes.json();
               const liveEvents = (liveData.response || []).map((item: any) => {
                   const fixture = item.fixture || item;
                   const id = fixture.id || item.id;
                   const date = fixture.date || item.date;
                   const status = fixture.status || item.status;
                   const league = item.league;
                   const teams = item.teams || { home: item.home, away: item.away };
                   
                   return {
                       id,
                       fixture: { id, date, status, timestamp: fixture.timestamp || item.timestamp },
                       league: league?.name,
                       home: teams?.home,
                       away: teams?.away,
                       home_team: teams?.home?.name,
                       away_team: teams?.away?.name,
                       match: `${teams?.home?.name} vs ${teams?.away?.name}`,
                       event_date: date,
                       status: status?.short,
                       is_live: 1,
                       home_odd: 0,
                       draw_odd: 0,
                       away_odd: 0
                   };
               });
               
               if (liveEvents.length > 0) {
                   console.log(`[API] Fallback found ${liveEvents.length} live events`);
                   return c.json({ live: liveEvents, pregame: [] });
               }
           }
       } catch (err) {
           console.error('[API] Fallback fetch error:', err);
       }
  }

  return c.json({ live: [], pregame: [] }, 200);
});

// Debug Endpoint
app.get('/api/debug/force-sync', async (c) => {
    // 1. Check Auth (Dev or Admin)
    const token = c.req.header('Authorization')?.replace('Bearer ', '') || c.req.query('key');
    // Bypass auth for debugging locally
    // const isDev = c.env.ENVIRONMENT === 'development' || c.env.ENVIRONMENT === 'dev' || c.env.DEV_MODE === 'true';
    // if (!isDev && token !== c.env.ADMIN_TOKEN) {
    //     return c.text('Unauthorized', 401);
    // }
    console.log('[Force Sync] Auth bypassed for local test');

    const sportsToSync = [
      'soccer', 'basketball', 'tennis', 'hockey', 'volleyball', 
      'handball', 'baseball', 'rugby', 'american-football', 'mma', 'formula-1', 'boxing'
    ];

    console.log('[Force Sync] Triggering Robust Integration for ALL sports...');
    
    // Run in background (waitUntil) so we don't timeout the request, 
    // BUT for testing we might want to await it partially or return status that it started.
    // Cloudflare Workers usually require waitUntil for background tasks after response.
    // We'll use ctx.waitUntil if available, or just fire and forget promise if not critical to wait.
    
    // Since we are in an app handler, we have c.executionCtx
    c.executionCtx.waitUntil(
        runRobustIntegration(c.env, { sports: sportsToSync, days: 7 })
        .then(() => console.log('[Force Sync] Completed.'))
        .catch(err => console.error('[Force Sync] Error:', err))
    );

    return c.json({ status: 'ok', message: 'Robust Integration started for all sports (7 days)', sports: sportsToSync });
        });



app.get('/api/debug/soccer', async (c) => {
    // 1. Check Auth (Dev or Admin)
    const token = c.req.header('Authorization')?.replace('Bearer ', '') || c.req.query('key');
    const isDev = c.env.ENVIRONMENT === 'development' || c.env.ENVIRONMENT === 'dev' || c.env.DEV_MODE === 'true';
    if (!isDev && token !== c.env.ADMIN_TOKEN) {
        return c.json({ error: 'Forbidden' }, 403);
    }
    
    // Check DB for live events
    const liveCount = await c.env.DB.prepare("SELECT count(*) as c FROM events WHERE is_live=1").first('c');
    const liveEvent = await c.env.DB.prepare("SELECT * FROM events WHERE is_live=1 LIMIT 1").first();
    let imported = null;
    if (liveEvent) {
        imported = await c.env.DB.prepare("SELECT * FROM imported_odds WHERE id = ?").bind(liveEvent.external_event_id).first();
    }

    const result = await debugSoccerMatching(c.env);
    return c.json({
        db_live_count: liveCount,
        liveEvent,
        imported,
        matching_debug: result
    });
});

// Events by Sport Endpoint (for Frontend)
app.get('/api/events/by-sport-new', async (c) => {
  const sportParam = c.req.query('sports') || c.req.query('sport') || 'all';
  const leagueParam = c.req.query('league');
  
  // 4️⃣ LAG INTENCIONAL (ANTI-EXPLOIT) - Reduzido para listagem
  await new Promise(res => setTimeout(res, 1200));

  let results: any[] = [];
  try {
      // Base Query
      let query = `
        SELECT e.*, io.id as external_id, io.payload
        FROM events e
        LEFT JOIN imported_odds io ON e.external_event_id = io.id
        WHERE 1=1
      `;
      const params: any[] = [];

      // Sport Filter
      if (sportParam !== 'all') {
        // Use the normalized 'sport' column in events table which is much faster and reliable
        query += ` AND e.sport = ?`;
        params.push(sportParam);
      }

      // League Filter
      if (leagueParam) {
          query += ` AND (e.league LIKE ? OR json_extract(io.payload, '$.league.name') LIKE ?)`;
          const l = `%${leagueParam}%`;
          params.push(l, l);
      }

      // Time Filter: show events from 3h ago up to 7 days ahead (unless live)
      // In DEV we still relax the lower bound, but enforce the 7-day upper bound to avoid far-future noise
      const nowMs = Date.now();
      // Uniform lower bound: 12h atrás em qualquer ambiente
      const lowerCutoff = new Date(nowMs - 12 * 60 * 60 * 1000).toISOString();
      const upperCutoff = new Date(nowMs + 7 * 24 * 60 * 60 * 1000).toISOString();
      query += ` AND (e.is_live = 1 OR (e.event_date >= ? AND e.event_date <= ?))`;
      params.push(lowerCutoff, upperCutoff);

      // Order by is_live DESC (prioritize live), then by date
      query += ` ORDER BY e.is_live DESC, e.event_date ASC LIMIT 200`;

      const dbRes = await c.env.DB.prepare(query).bind(...params).all();
      results = dbRes.results || [];
  } catch (e: any) {
      console.error('[BySport] DB Error:', e);
      return c.json({ live: [], pregame: [] });
  }

  try {
    const live: any[] = [];
    const pregame: any[] = [];
    const now = Date.now();

    results.forEach((r: any) => {
      try {
        if (!r.payload) return;
        const data = JSON.parse(r.payload);

        // COMPATIBILITY: Handle flat structure (possibly from older sync or different source)
        if (!data.fixture && data.fixture_id) {
          const homeName = data.teams?.home?.name || data.home_team;
          const awayName = data.teams?.away?.name || data.away_team;
          const homeLogo = data.teams?.home?.logo || null;
          const awayLogo = data.teams?.away?.logo || null;
          const leagueName = data.league_obj?.name || data.league_name;
          const leagueCountry = data.league_obj?.country || '';
          const leagueLogo = data.league_obj?.logo || '';

          data.fixture = {
            id: data.fixture_id,
            status: typeof data.status === 'string' ? { short: data.status, long: data.status, elapsed: null } : data.status,
            date: data.kickoff,
            timestamp: typeof data.kickoff === 'string' ? new Date(data.kickoff).getTime() / 1000 : data.kickoff,
            teams: {
              home: { name: homeName, logo: homeLogo },
              away: { name: awayName, logo: awayLogo }
            },
            league: {
              name: leagueName,
              country: leagueCountry,
              logo: leagueLogo
            }
          };
          if (!data.league) {
            data.league = data.league_obj || { name: leagueName, country: leagueCountry, logo: leagueLogo };
          }
        }

        if (String(r.external_id || '').startsWith('dev_')) return;

        // Skip small leagues logic if needed
        const leagueName = r.league || data.fixture.league_name || data.league?.name;
        const leagueCountry = data.league?.country;

        let oddsData;
        // Prefer explicit odds field; fallback to markets array from API-Sports mapping
        let rawOdds: any = data.odds;
        if (!rawOdds && Array.isArray(data.markets) && data.markets.length > 0) {
          rawOdds = data.markets;
        }

        if (isPreMatch(data.fixture) || (rawOdds && (Array.isArray(rawOdds) ? rawOdds.length > 0 : Object.keys(rawOdds).length > 0))) {
          oddsData = normalizeOdds(rawOdds, data.fixture);
        } else {
          // Fallback for live events with no odds
          oddsData = { oddsFrozen: true, markets: {} };
        }

        const homeName = r.home_team || (typeof data.fixture.home_team === 'object' ? data.fixture.home_team?.name : data.fixture.home_team) || '';
        const awayName = r.away_team || (typeof data.fixture.away_team === 'object' ? data.fixture.away_team?.name : data.fixture.away_team) || '';

        // --- ODDS FALLBACK LOGIC ---
        let finalMarkets = oddsData.markets;
        let h = oddsData.markets.h2h?.[0]?.odd || 0;
        let d = oddsData.markets.h2h?.[1]?.odd || 0;
        let a = oddsData.markets.h2h?.[2]?.odd || 0;

        // 1. Try events table markets column (if payload failed)
        if ((!h && !a) && r.markets) {
          try {
            const dbMarkets = typeof r.markets === 'string' ? JSON.parse(r.markets) : r.markets;
            if (dbMarkets && (Object.keys(dbMarkets).length > 0)) {
              finalMarkets = dbMarkets;
              if (dbMarkets.h2h) {
                h = dbMarkets.h2h[0]?.odd || 0;
                d = dbMarkets.h2h[1]?.odd || 0;
                a = dbMarkets.h2h[2]?.odd || 0;
              }
            }
          } catch (e) { /* ignore */ }
        }

        // 2. Try events table flat columns (Last Resort)
        if (!h && !a) {
          h = r.home_odd || 0;
          d = r.draw_odd || 0;
          a = r.away_odd || 0;

          // Reconstruct markets if we found flat odds
          if (h || a) {
            finalMarkets = {
              h2h: [
                { id: '1', name: 'Home', odd: h },
                { id: '2', name: 'Draw', odd: d },
                { id: '3', name: 'Away', odd: a }
              ]
            };
          }
        }
        // ---------------------------

        const evt = {
          id: data.fixture.id,
          fixture: data.fixture,
          league: leagueName,
          home: data.fixture.home_team || data.home_team,
          away: data.fixture.away_team || data.away_team,
          home_team: homeName,
          away_team: awayName,
          match: `${homeName} vs ${awayName}`,
          date: r.event_date || data.fixture.date,
          event_date: r.event_date || data.fixture.date,
          status: data.fixture.status,
          elapsed: data.fixture.elapsed,
          is_live: r.is_live,
          oddsFrozen: oddsData.oddsFrozen,
          markets: finalMarkets,
          home_odd: h,
          draw_odd: d,
          away_odd: a
        };

        // Categorize
        const statusShortRaw = (evt as any)?.status?.short || (evt as any)?.status || '';
        const statusShort = String(statusShortRaw || '').toUpperCase();
        const finishedStatuses = ['FT','AET','PEN','FINISHED','MATCH FINISHED','ENDED','FINAL','WO','ABD','AWD'];

        let isLive = r.is_live === 1
          || ['1H', '2H', 'HT', 'ET', 'P', 'LIVE', 'IN_PLAY', 'INPLAY'].includes(statusShort)
          || /LIVE|IN_PLAY|1H|2H|HT|ET|P/.test(statusShort);

        if (finishedStatuses.includes(statusShort)) {
          isLive = false;
        }

        const dStr = evt.event_date as string | undefined;
        if (dStr) {
          const d = new Date(dStr);
          if (!Number.isNaN(d.getTime())) {
            const nowMs = Date.now();
            const diffMs = nowMs - d.getTime();

            if (isLive && diffMs > 5 * 60 * 60 * 1000) {
              isLive = false;
            }

            if (!isLive && diffMs > 2.5 * 60 * 60 * 1000 && d.getTime() < nowMs) {
              return;
            }
          }
        }
        const hasOdds = (Number(evt.home_odd || 0) > 0)
          || (Number(evt.away_odd || 0) > 0)
          || (Number(evt.draw_odd || 0) > 0)
          || (finalMarkets && typeof finalMarkets === 'object' && Object.keys(finalMarkets).length > 0);

        if (isLive) {
          if (hasOdds) {
            live.push(evt);
          } else {
            // Skip live events with no odds
          }
        } else {
          pregame.push(evt);
        }
      } catch (e) {
        console.error('[BySport] Row parse error:', e);
      }
    });

    return c.json({ live, pregame });
  } catch (e: any) {
    console.error('[BySport] Handler error:', e);
    return c.json({ live: [], pregame: [] });
  }
});

// Generic Events Endpoint (Fallback for frontend)
app.get('/api/events', async (c) => {
  // 4️⃣ LAG INTENCIONAL (ANTI-EXPLOIT)
  await new Promise(res => setTimeout(res, 1200));

  // Optimized: Query normalized events table
  let results: any[] = [];
  try {
      const dbRes = await c.env.DB.prepare(`
        SELECT e.*, io.id as external_id, io.payload
        FROM events e
        LEFT JOIN imported_odds io ON e.external_event_id = io.id
        ORDER BY e.updated_at DESC
        LIMIT 50
      `).all();
      results = dbRes.results || [];
  } catch (e: any) {
      if (e.message && (e.message.includes('busy') || e.message.includes('locked'))) {
         return new Response( 
             JSON.stringify({ error: "Banco ocupado, tente novamente" }), 
             { status: 503, headers: { 'Content-Type': 'application/json' } } 
         );
      }
      return c.json({ error: 'Database error' }, 500);
  }

  const events = results?.map((r: any) => {
    try {
      if (!r.payload) return null;
      const data = JSON.parse(r.payload);

      // COMPATIBILITY: Handle flat structure
      if (!data.fixture && data.fixture_id) {
            data.fixture = {
                id: data.fixture_id,
                status: typeof data.status === 'string' ? { short: data.status, long: data.status, elapsed: null } : data.status,
                date: data.kickoff,
                timestamp: typeof data.kickoff === 'string' ? new Date(data.kickoff).getTime() / 1000 : data.kickoff,
                home_team: typeof data.home_team === 'string' ? { name: data.home_team } : data.home_team,
                away_team: typeof data.away_team === 'string' ? { name: data.away_team } : data.away_team,
                league_name: data.league_name
            };
            if (!data.league) {
                data.league = data.league_obj || { name: data.league_name, country: '' };
            }
      }

      if (String(r.external_id || '').startsWith('dev_')) return null;
      if (data && (data.source === 'bulk_import_tool')) return null;

      // FILTER: Hide past/finished games
      const status = data.fixture?.status?.short;
      if (['FT', 'AET', 'PEN', 'Finished', 'ABD', 'WO', 'INT', 'Ended', 'Final'].includes(status)) {
          return null;
      }

      // FILTER: Blacklist specific teams (e.g. Illinois vs Minnesota)
      const hName = (r.home_team || data.fixture.home_team?.name || '').toLowerCase();
      const aName = (r.away_team || data.fixture.away_team?.name || '').toLowerCase();
      if ((hName.includes('illinois') && aName.includes('minnesota')) || (aName.includes('illinois') && hName.includes('minnesota'))) {
           return null;
      }

      let oddsData;
      
      if (isPreMatch(data.fixture) || (data.odds && (Array.isArray(data.odds) ? data.odds.length > 0 : Object.keys(data.odds).length > 0))) {
          oddsData = normalizeOdds(data.odds, data.fixture);
      } else {
          oddsData = { oddsFrozen: true, markets: {} };
      }
      const homeName = r.home_team || (typeof data.fixture.home_team === 'object' ? data.fixture.home_team?.name : data.fixture.home_team) || '';
      const awayName = r.away_team || (typeof data.fixture.away_team === 'object' ? data.fixture.away_team?.name : data.fixture.away_team) || '';

      // --- ODDS FALLBACK LOGIC ---
      let finalMarkets = oddsData.markets;
      let h = oddsData.markets.h2h?.[0]?.odd || 0;
      let d = oddsData.markets.h2h?.[1]?.odd || 0;
      let a = oddsData.markets.h2h?.[2]?.odd || 0;

      // 1. Try events table markets column (if payload failed)
      if ((!h && !a) && r.markets) {
          try {
              const dbMarkets = typeof r.markets === 'string' ? JSON.parse(r.markets) : r.markets;
              if (dbMarkets && (Object.keys(dbMarkets).length > 0)) {
                  finalMarkets = dbMarkets;
                  if (dbMarkets.h2h) {
                      h = dbMarkets.h2h[0]?.odd || 0;
                      d = dbMarkets.h2h[1]?.odd || 0;
                      a = dbMarkets.h2h[2]?.odd || 0;
                  }
              }
          } catch (e) { void 0; }
      }

      // 2. Try events table flat columns (Last Resort)
      if (!h && !a) {
          h = r.home_odd || 0;
          d = r.draw_odd || 0;
          a = r.away_odd || 0;
          
          // Reconstruct markets if we found flat odds
          if (h || a) {
              finalMarkets = {
                  h2h: [
                      { id: '1', name: 'Home', odd: h },
                      { id: '2', name: 'Draw', odd: d },
                      { id: '3', name: 'Away', odd: a }
                  ]
              };
          }
      }
      // ---------------------------

      return {
        id: data.fixture.id,
        fixture: data.fixture,
        league: r.league || data.fixture.league_name || data.league?.name,
        home: data.fixture.home_team || data.home_team,
        away: data.fixture.away_team || data.away_team,
        home_team: homeName,
        away_team: awayName,
        match: `${homeName} vs ${awayName}`,
        date: r.event_date || data.fixture.date,
        event_date: r.event_date || data.fixture.date,
        status: data.fixture.status,
        elapsed: data.fixture.elapsed,
        oddsFrozen: oddsData.oddsFrozen,
        markets: finalMarkets,
        home_odd: h,
        draw_odd: d,
        away_odd: a
      };
    } catch { return null; }
  }).filter(Boolean) || [];

  return c.json(events);
});

// Events Range Endpoint
app.get('/api/events-range', async (c) => {
  const from = c.req.query('from');
  const to = c.req.query('to');
  
  if (!from || !to) {
      return c.json({ error: 'Missing from/to parameters' }, 400);
  }

  // Optimized: Use indexed start_time column instead of json_extract
  let results: any[] = [];
  try {
      const dbRes = await c.env.DB.prepare(`
        SELECT e.*, io.id as external_id, io.payload
        FROM events e
        LEFT JOIN imported_odds io ON e.external_event_id = io.id
        WHERE e.start_time BETWEEN ? AND ?
        ORDER BY e.start_time ASC
        LIMIT 100
      `).bind(from, to).all();
      results = dbRes.results || [];
  } catch (e: any) {
      if (e.message && (e.message.includes('busy') || e.message.includes('locked'))) {
         return new Response( 
             JSON.stringify({ error: "Banco ocupado, tente novamente" }), 
             { status: 503, headers: { 'Content-Type': 'application/json' } } 
         );
      }
      throw e;
  }

  const events = results?.map((r: any) => {
    try {
        if (!r.payload) return null;
        const data = JSON.parse(r.payload);

        // COMPATIBILITY: Handle flat structure
        if (!data.fixture && data.fixture_id) {
            data.fixture = {
                id: data.fixture_id,
                status: typeof data.status === 'string' ? { short: data.status, long: data.status, elapsed: null } : data.status,
                date: data.kickoff,
                timestamp: typeof data.kickoff === 'string' ? new Date(data.kickoff).getTime() / 1000 : data.kickoff,
                home_team: typeof data.home_team === 'string' ? { name: data.home_team } : data.home_team,
                away_team: typeof data.away_team === 'string' ? { name: data.away_team } : data.away_team,
                league_name: data.league_name
            };
            if (!data.league) {
                data.league = data.league_obj || { name: data.league_name, country: '' };
            }
        }

        if (String(r.external_id || '').startsWith('dev_')) return null;
        if (data && (data.source === 'bulk_import_tool')) return null;

        // FILTER: Hide past/finished games
        const status = data.fixture?.status?.short;
        if (['FT', 'AET', 'PEN', 'Finished', 'ABD', 'WO', 'INT', 'Ended', 'Final'].includes(status)) {
            return null;
        }

        const leagueName = r.league || data.fixture.league_name || data.league?.name;
        const leagueCountry = data.league?.country;
        if (isSmallLeagueName(leagueName, leagueCountry)) return null;

        let oddsData;
        if (isPreMatch(data.fixture)) {
            oddsData = normalizeOdds(data.odds, data.fixture);
        } else {
            oddsData = { oddsFrozen: true, markets: {} };
        }

        const homeName = r.home_team || (typeof data.fixture.home_team === 'object' ? data.fixture.home_team?.name : data.fixture.home_team) || '';
        const awayName = r.away_team || (typeof data.fixture.away_team === 'object' ? data.fixture.away_team?.name : data.fixture.away_team) || '';

        return {
            id: data.fixture.id,
            fixture: data.fixture,
            league: leagueName,
            home: data.fixture.home_team || data.home_team,
            away: data.fixture.away_team || data.away_team,
            home_team: homeName,
            away_team: awayName,
            match: `${homeName} vs ${awayName}`,
            date: r.event_date || data.fixture.date,
            event_date: r.event_date || data.fixture.date,
            status: data.fixture.status,
            elapsed: data.fixture.elapsed,
            oddsFrozen: oddsData.oddsFrozen,
            markets: oddsData.markets,
            home_odd: oddsData.markets.h2h?.[0]?.odd || 0,
            draw_odd: oddsData.markets.h2h?.[1]?.odd || 0,
            away_odd: oddsData.markets.h2h?.[2]?.odd || 0
        };
    } catch { return null; }
  }).filter(Boolean) || [];

  return c.json(events);
});

// Match Detail Endpoint
  app.get('/api/match-detail', async (c) => {
      // Frontend passes many params, but we mainly need fixture_id or home/away/date to find it.
      // params: fixture_id, home_name, away_name, date, sport...
      const fixtureId = c.req.query('fixture_id');
      
      if (fixtureId && fixtureId !== '0') {
          let results: any[] = [];
          try {
              const dbRes = await c.env.DB.prepare(`
                  SELECT payload FROM imported_odds 
                  WHERE json_extract(payload, '$.fixture.id') = ?
              `).bind(Number(fixtureId)).all();
              results = dbRes.results || [];
          } catch (e: any) {
              if (e.message && (e.message.includes('busy') || e.message.includes('locked'))) {
                 return new Response( 
                     JSON.stringify({ error: "Banco ocupado, tente novamente" }), 
                     { status: 503, headers: { 'Content-Type': 'application/json' } } 
                 );
              }
              throw e;
          }
          
          if (results && results.length > 0) {
              try {
                  const data = JSON.parse(results[0].payload as string);
                  const fixture = data.fixture || {};
                  const league = data.league || {};
                  const home = fixture.home_team || data.home_team || {};
                  const away = fixture.away_team || data.away_team || {};
                  
                  // Return as MatchDetail (matching shared/types.ts)
                  return c.json({
                      match: {
                          fixture_id: fixture.id,
                          date: fixture.date,
                          competition: {
                              id: league.id || 0,
                              name: league.name || fixture.league_name || 'Unknown',
                              season: league.season || String(new Date().getFullYear()),
                              sport: data.sport || 'soccer'
                          },
                          teams: {
                              home: {
                                  id: home.id || 0,
                                  name: home.name || home,
                                  statistics: {
                                      average_score: 0,
                                      average_corners: 0,
                                      average_cards: 0,
                                      form_last_5: [],
                                      fixture_statistics: []
                                  }
                              },
                              away: {
                                  id: away.id || 0,
                                  name: away.name || away,
                                  statistics: {
                                      average_score: 0,
                                      average_corners: 0,
                                      average_cards: 0,
                                      form_last_5: [],
                                      fixture_statistics: []
                                  }
                              }
                          },
                          head_to_head: [],
                          probabilities: {
                              home_win: 0,
                              draw: 0,
                              away_win: 0,
                              source: 'Real Data'
                          },
                          league_standings: {
                              home_team: { position: 0, points: 0 },
                              away_team: { position: 0, points: 0 }
                          }
                      }
                  });
              } catch (e) {
                  // Fallback
              }
          }
      }
      
      // Fallback if not found
      return c.json({
          match: { 
              probabilities: { source: 'Dev placeholder' },
              teams: { home: { name: 'Home' }, away: { name: 'Away' } }
          }
      });
  });

// Event Players Endpoint (Mock for now)
app.get('/api/events/:id/players', async (c) => {
    return c.json({ home: [], away: [] });
});

// Dev apisports events endpoint removed

// Dev sync-odds endpoint removed

// DEV: Sync All (Simulate Cron) - Blocking for Debug
app.get('/api/dev/sync-all', async (c) => {
    return c.json({ 
        success: true, 
        message: 'Sync finished (No-op).',
        results: []
    });
});


// DEV: DB Status
app.get('/api/debug/db-status', async (c) => {
    // ... existing code ...
    const token = c.req.header('Authorization')?.replace('Bearer ', '');
    if (token !== c.env.ADMIN_TOKEN) return c.json({ error: 'Forbidden' }, 403);
    try {
        const count = await c.env.DB.prepare('SELECT COUNT(*) as c FROM imported_odds').first('c');
        const range = await c.env.DB.prepare('SELECT MIN(event_date) as min_d, MAX(event_date) as max_d FROM imported_odds').first();
        const statusCounts = await c.env.DB.prepare('SELECT status, COUNT(*) as c FROM imported_odds GROUP BY status').all();
        const sportCounts = await c.env.DB.prepare('SELECT sport, COUNT(*) as c FROM imported_odds GROUP BY sport').all();
        const liveCount = await c.env.DB.prepare('SELECT COUNT(*) as c FROM imported_odds WHERE is_live = 1').first('c');
        
        // Debug: Get samples (newest first)
        const debugQuery = `
            SELECT id, is_live, event_date, 
                   datetime('now') as now_sqlite,
                   datetime(?, '-24 hours') as cutoff,
                   (event_date >= datetime(?, '-24 hours')) as check_live
            FROM imported_odds 
            WHERE id = '10001'
        `;
        const debugRes = await c.env.DB.prepare(debugQuery).bind(new Date().toISOString(), new Date().toISOString()).all();

        const samples = await c.env.DB.prepare('SELECT id, sport, is_live, event_date, status, league_name FROM imported_odds ORDER BY event_date DESC LIMIT 10').all();

        return c.json({
            debug: debugRes.results,
            total_events: count,
            date_range: range,
            live_events: liveCount,
            status_breakdown: statusCounts.results,
            sport_breakdown: sportCounts.results,
            samples: samples.results,
            server_time: new Date().toISOString()
        });
    } catch (e: any) {
        return c.json({ error: e.message }, 500);
    }
});

// TRIGGER: Robust Integration (Fetch All Sports)
app.get('/api/debug/run-robust-integration', async (c) => {
    try {
        console.log('[Debug] Triggering Robust Integration...');
        const result = await runRobustIntegration(c.env);
        return c.json(result);
    } catch (e: any) {
        return c.json({ error: e.message }, 500);
    }
});

// TRIGGER: Event Sync (Imported -> Events)
app.get('/api/debug/sync-events', async (c) => {
    try {
        console.log('[Debug] Triggering Event Sync...');
        const syncService = new EventSyncService(c.env);
        const result = await syncService.syncEventsFromImported();
        return c.json(result);
    } catch (e: any) {
        return c.json({ error: e.message }, 500);
    }
});

app.get('/api/debug/inspect-premiership', async (c) => {
    try {
        const results = await c.env.DB.prepare(`
            SELECT id, home_team, away_team, league_name, payload 
            FROM imported_odds 
            WHERE league_name LIKE '%Premiership%' 
            LIMIT 5
        `).all();
        
        return c.json({
            count: results.results.length,
            rows: results.results.map((r: any) => ({
                ...r,
                payload_parsed: JSON.parse(r.payload)
            }))
        });
    } catch (e: any) {
        return c.json({ error: e.message }, 500);
    }
});

// DEV: Inspect Table Schema
app.get('/api/debug/schema', async (c) => {
    try {
        const tableInfo = await c.env.DB.prepare("PRAGMA table_info(imported_odds)").all();
        const indexList = await c.env.DB.prepare("PRAGMA index_list(imported_odds)").all();
        
        const indexes = [];
        for (const idx of indexList.results as any[]) {
            const info = await c.env.DB.prepare(`PRAGMA index_info(${idx.name})`).all();
            indexes.push({ name: idx.name, columns: info.results });
        }

        return c.json({ tableInfo: tableInfo.results, indexes });
    } catch (e: any) {
        return c.json({ error: e.message }, 500);
    }
});

// Dev force-sync-odds endpoint removed


// Single Event
app.get('/api/events/:id', async (c) => {
  const id = c.req.param('id');
  try {
    const event = await c.env.DB.prepare('SELECT * FROM events WHERE id = ?').bind(id).first();
    if (!event) return c.json({ error: 'Event not found' }, 404);
    return c.json(event);
  } catch (e: any) {
    if (e.message && (e.message.includes('busy') || e.message.includes('locked'))) {
        return new Response( 
            JSON.stringify({ error: "Banco ocupado, tente novamente" }), 
            { status: 503, headers: { 'Content-Type': 'application/json' } } 
        );
    }
    return c.json({ error: 'Database error' }, 500);
  }
});

// Event Odds
app.get('/api/events/:id/odds', async (c) => {
  const id = c.req.param('id');
  try {
    // 1. Try to get full detailed payload from imported_odds
    const imported = await c.env.DB.prepare('SELECT payload FROM imported_odds WHERE id = ?').bind(id).first() as { payload: string } | null;
    
    if (imported && imported.payload) {
        try {
            const data = JSON.parse(imported.payload);
            const odds = data.odds || {};
            
            // Transform for frontend if needed or pass as is
            // Frontend expects { markets: { ... }, eventOdds: { ... } }
            // If odds object already has keys like 'h2h', 'totals', 'handicap' etc (which we did in apisports.ts), we can use it.
            
            // Map array values to expected format if they aren't already
            // In apisports.ts we map to { outcome, value } which matches MarketItem
            
            // Ensure we map label correctly for frontend display if needed, 
            // but EventDetails.tsx seems to handle { outcome, value } well enough via `labelOutcome` helper
            // However, EventDetails expects:
            // interface MarketItem { label: string; odd: number; name?: string }
            // apisports.ts produces: { outcome: v.value, value: Number(v.odd) }
            
            // We need to map `outcome` -> `label` and `value` -> `odd`
            const mappedMarkets: any = {};
            const initialSuspended: any[] = [];
            
            const normalizeLabel = (label: string) => {
                const l = label.toLowerCase();
                if (l === 'home' || l === '1') return 'Casa';
                if (l === 'draw' || l === 'x') return 'Empate';
                if (l === 'away' || l === '2') return 'Fora';
                return label;
            };

            for (const [k, v] of Object.entries(odds)) {
                // New structure: v has outcomes property
                if (v && typeof v === 'object' && !Array.isArray(v) && Array.isArray((v as any).outcomes)) {
                    mappedMarkets[k] = (v as any).outcomes.map((item: any) => {
                        let labelRaw = String(item.outcome);
                        if (item.point) {
                            labelRaw += ` ${item.point}`;
                        }
                        return {
                            label: normalizeLabel(labelRaw),
                            odd: Number(item.value),
                            name: String(item.outcome) // Keep original name/outcome for code reference if needed
                        };
                    });
                    if ((v as any).suspended) {
                        initialSuspended.push({
                            eventId: Number(id),
                            marketId: k,
                            reason: (v as any).suspendReason
                        });
                    }
                }
                // Old structure: v is array
                else if (Array.isArray(v)) {
                    mappedMarkets[k] = v.map((item: any) => ({
                        label: normalizeLabel(String(item.outcome)),
                        odd: Number(item.value),
                        name: String(item.outcome)
                    }));
                }
            }

            // Sort h2h to ensure strict order: Casa, Empate, Fora
            if (mappedMarkets.h2h) {
                const order = ['Casa', 'Empate', 'Fora'];
                mappedMarkets.h2h.sort((a: any, b: any) => {
                    return order.indexOf(a.label) - order.indexOf(b.label);
                });
            }

            return c.json({
                markets: mappedMarkets,
                eventOdds: mappedMarkets, // Duplicate for compatibility as frontend checks both
                suspendedMarkets: initialSuspended
            });

        } catch (e) {
            console.error('Error parsing imported payload', e);
        }
    }

    // Fallback to basic events table if no imported data
    const event = await c.env.DB.prepare('SELECT * FROM events WHERE id = ?').bind(id).first() as any;
    if (!event) return c.json({ error: 'Event not found' }, 404);
    
    const markets: any = { h2h: [], totals: [], handicap: [] };
    
    // Populate H2H from main event data
    if (event.home_odd) {
      markets.h2h.push({ label: 'Casa', odd: event.home_odd, name: 'Home' });
      if (event.draw_odd) markets.h2h.push({ label: 'Empate', odd: event.draw_odd, name: 'Draw' });
      markets.h2h.push({ label: 'Fora', odd: event.away_odd, name: 'Away' });
    }
    
    return c.json({
      markets,
      eventOdds: { h2h: markets.h2h }
    });
  } catch (e: any) {
    if (e.message && (e.message.includes('busy') || e.message.includes('locked'))) {
        return new Response( 
            JSON.stringify({ error: "Banco ocupado, tente novamente" }), 
            { status: 503, headers: { 'Content-Type': 'application/json' } } 
        );
    }
    return c.json({ error: 'Database error' }, 500);
  }
});

app.get('/api/sports/events/:id', async (c) => {
  const id = c.req.param('id');
  try {
    const imported = await c.env.DB.prepare('SELECT payload FROM imported_odds WHERE id = ?').bind(id).first() as { payload: string } | null;
    if (imported && imported.payload) {
      try {
        const data = JSON.parse(imported.payload);
        
        // On-Demand Full Odds Fetch
        const fixture = data.fixture || {};
        const statusShort = fixture.status?.short || data.status;
        const isFinished = ['FT', 'AOT', 'AP', 'Finished', 'Ended', 'Final'].includes(statusShort);
        const sportVal = data.sport || (typeof fixture.sport === 'string' ? fixture.sport : fixture.sport?.name) || '';
        const sport = String(sportVal);

        if (!data.full_odds && !isFinished && sport && sport !== 'undefined') {
             // console.log(`[EventDetails] Triggering on-demand full odds fetch for ${id} (${sport})...`);
             try {
                 // fetchApiSportsData removed - use robustIntegration in background if needed
                 // For now, just skip on-demand fetch or trigger robust integration asynchronously
                 // c.executionCtx.waitUntil(runRobustIntegration(c.env));
             } catch (e) {
                 console.error('Error fetching on-demand odds:', e);
             }
        }

        // Re-read fixture/league from potentially updated data
        const fixtureUpdated = data.fixture || {};
        const league = data.league || {};
        const oddsRaw = data.odds || {};
        const oddsData = normalizeOdds(oddsRaw, fixtureUpdated);
        const leagueName = fixtureUpdated.league_name || league.name;
        // sportVal and sport are already defined above
        const homeRaw = fixtureUpdated.home_team || data.home_team || {};
        const awayRaw = fixtureUpdated.away_team || data.away_team || {};
        const homeName = typeof homeRaw === 'string' ? homeRaw : homeRaw.name || '';
        const awayName = typeof awayRaw === 'string' ? awayRaw : awayRaw.name || '';
        const date = data.event_date || fixtureUpdated.date || null;
        const status = fixtureUpdated.status || data.status || null;
        const elapsed = fixtureUpdated.elapsed ?? null;
        const baseEvent: any = {
          id: fixtureUpdated.id || id,
          fixture: fixtureUpdated,
          league: leagueName,
          league_name: leagueName,
          sport,
          home: fixtureUpdated.home_team || data.home_team,
          away: fixtureUpdated.away_team || data.away_team,
          home_team: homeName,
          away_team: awayName,
          match: `${homeName} vs ${awayName}`,
          date,
          event_date: date,
          status,
          elapsed,
          odds: oddsData.markets,
          oddsFrozen: oddsData.oddsFrozen
        };
        return c.json(baseEvent);
      } catch (e) {
        console.error('Error parsing imported_odds payload for single event', e);
      }
    }

    const row = await c.env.DB.prepare(`
      SELECT e.*, io.payload 
      FROM events e
      LEFT JOIN imported_odds io ON e.external_event_id = io.id
      WHERE e.id = ? OR e.external_event_id = ?
      LIMIT 1
    `).bind(id, id).first() as any;

    if (row) {
      let data: any = null;
      try {
        data = row.payload ? JSON.parse(row.payload as string) : null;
      } catch {
        data = null;
      }
      // Prepare for potential fetch
      const fixture = data?.fixture || {};
      const sportVal = row.sport || data?.sport || (typeof fixture.sport === 'string' ? fixture.sport : fixture.sport?.name) || '';
      const sport = String(sportVal);
      const statusShort = row.status || fixture.status?.short || data?.status;
      const isFinished = ['FT', 'AOT', 'AP', 'Finished', 'Ended', 'Final'].includes(statusShort);

      if ((!data || !data.full_odds) && !isFinished && sport && sport !== 'undefined') {
             try {
                 // fetchApiSportsData removed
             } catch(e) { console.error('Error fetching on-demand odds fallback:', e); }
      }

      const fixtureUpdated = data?.fixture || {};
      const league = data?.league || {};
      const rawOdds = data?.odds || {};
      const oddsData = normalizeOdds(rawOdds, fixtureUpdated);
      const leagueName = row.league || fixtureUpdated.league_name || league.name;
      // sportVal/sport defined above
      const homeRaw = fixtureUpdated.home_team || data?.home_team || row.home_team || {};
      const awayRaw = fixtureUpdated.away_team || data?.away_team || row.away_team || {};
      const homeName = typeof homeRaw === 'string' ? homeRaw : homeRaw.name || '';
      const awayName = typeof awayRaw === 'string' ? awayRaw : awayRaw.name || '';
      const date = row.event_date || fixtureUpdated.date || null;
      const status = row.status || fixtureUpdated.status || null;
      const elapsed = fixtureUpdated.elapsed ?? null;
      const baseEvent: any = {
        id: fixtureUpdated.id || row.external_event_id || row.id,
        fixture: fixtureUpdated,
        league: leagueName,
        league_name: leagueName,
        sport,
        home: fixtureUpdated.home_team || data?.home_team || row.home_team,
        away: fixtureUpdated.away_team || data?.away_team || row.away_team,
        home_team: homeName,
        away_team: awayName,
        match: `${homeName} vs ${awayName}`,
        date,
        event_date: date,
        status,
        elapsed,
        odds: oddsData.markets,
        oddsFrozen: oddsData.oddsFrozen
      };
      return c.json(baseEvent);
    }

    return c.json({ error: 'Event not found' }, 404);
  } catch (e: any) {
    if (e.message && (e.message.includes('busy') || e.message.includes('locked'))) {
      return new Response(
        JSON.stringify({ error: "Banco ocupado, tente novamente" }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return c.json({ error: 'Database error' }, 500);
  }
});

// Manual Sync Endpoint - REMOVED
// app.get('/api/sync/:sport', async (c) => {
//   return c.json({ error: 'Endpoint removed' }, 404);
// });

// app.get('/api/sync-odds-io', async (c) => {
//   return c.json({ error: 'Endpoint removed' }, 404);
// });

// NEW: Debug Robust Integration (Synchronous)
app.get('/api/debug/robust', async (c) => {
    // 1. Check Auth (Operator/Admin Only)
    const token = c.req.header('Authorization')?.replace('Bearer ', '') || c.req.query('key') || c.req.query('token');
    const isDev = c.env.ENVIRONMENT === 'development' || c.env.ENVIRONMENT === 'dev' || c.env.DEV_MODE === 'true';
    if (!isDev && token !== c.env.ADMIN_TOKEN) {
        return c.json({ error: 'Forbidden' }, 403);
    }
    
    // Run Synchronously and return result
    const daysParam = c.req.query('days');
    const targetDateParam = c.req.query('date');
    const options: any = {};
    if (daysParam) options.days = parseInt(daysParam);
    if (targetDateParam) options.targetDate = targetDateParam;

    const result = await runRobustIntegration(c.env, options);
    return c.json(result);
});

// NEW: Manual Cron Trigger Endpoint
app.all('/api/cron/run', async (c) => {
    // 1. Check Auth (Operator/Admin Only)
    const token = c.req.header('Authorization')?.replace('Bearer ', '') || c.req.query('key') || c.req.query('token');
    const isBlocking = c.req.query('blocking') === 'true';
    
    // Allow in dev mode or if token matches
    const isDev = c.env.ENVIRONMENT === 'development' || c.env.ENVIRONMENT === 'dev' || c.env.DEV_MODE === 'true';
    if (!isDev && token !== c.env.ADMIN_TOKEN) {
        return c.json({ error: 'Forbidden' }, 403);
    }

    const logs: string[] = [];
    const log = (msg: string) => {
        console.log(msg);
        logs.push(msg);
    };

    log(`[Manual Cron] Triggered via API (Dev: ${isDev}, Blocking: ${isBlocking})`);

    // 2. Run Sync Logic (Similar to scheduled event)
    const env = c.env;
    const ctx = c.executionCtx;

    // Use waitUntil to run in background
    const task = async () => {
        try {
            // Auto-migration for dev convenience (ensures tables exist)
            await ensureUserSchema(env.DB);

            // Cleanup Old Data (Manual Trigger) - UPDATED with Safe Logic & Repair
            log('[Manual Cron] Cleaning up old data (Safe Mode)...');
            
            // 1. Safe Cleanup
            await env.DB.prepare(`
                DELETE FROM imported_odds 
                WHERE event_date < date('now', '-2 days') 
                AND id NOT IN (SELECT event_id FROM bets WHERE status = 'pending')
            `).run().catch(e => log(`Cleanup Error (imported): ${e}`));

            await env.DB.prepare(`
                DELETE FROM events 
                WHERE event_date < date('now', '-2 days')
                AND external_event_id NOT IN (SELECT event_id FROM bets WHERE status = 'pending')
            `).run().catch(e => log(`Cleanup Error (events): ${e}`));

            // 2. Repair Stuck Pending Bets
            log('[Manual Cron] Checking for stuck pending bets...');
            // Stuck bet repair logic REMOVED (depended on external API)
            
            // Sync API-Sports - REMOVED
            log('[Manual Cron] Syncing API-Sports DISABLED (Cleanup)');
            
            // Sync Odds - REMOVED
            log('[Manual Cron] Syncing The Odds API (V4) DISABLED (Cleanup)');
            
            // Sync Live Odds - ENABLED for Manual Trigger
            log('[Manual Cron] Syncing Robust Integration (Live/Pregame)...');
            await runRobustIntegration(env).catch(e => log(`[Manual Cron] Robust Sync Error: ${e}`));

            // Sync Event Normalization (Imported -> Events Table)
            log('[Manual Cron] Running Event Normalization Sync...');
            const syncService = new EventSyncService(env);
            await syncService.syncEventsFromImported().catch(e => log(`[Manual Cron] Error normalizing: ${e}`));
            
        } catch (err: any) {
            log(`[Manual Cron] Critical Error: ${err.message}`);
        }
    };

    if (isBlocking) {
        await task();
        return c.json({ 
            success: true, 
            message: 'Cron triggered in blocking mode',
            logs
        });
    }

    if (ctx && ctx.waitUntil) {
        ctx.waitUntil(task());
    } else {
        // Local dev fallback
        task();
    }

    // 3. Return Metrics immediately (or partial success)
    return c.json({ 
        success: true, 
        message: 'Cron triggered in background',
        // Mock metrics for immediate feedback
        events: 0,
        imported_odds: 0,
        bets: 0 
    });
});

// NEW: Force Adaptive Polling (Live)
app.get('/api/debug/force-live-poll', async (c) => {
    const pollingService = new AdaptivePollingService(c.env);
    const syncService = new EventSyncService(c.env);

    console.log('[Force Live Poll] Starting...');
    try {
        await pollingService.run();
        const syncResult = await syncService.syncEventsFromImported();
        return c.json({ success: true, message: 'Adaptive Polling & Sync executed', syncResult });
    } catch (e: any) {
        return c.json({ success: false, error: e.message, stack: e.stack }, 500);
    }
});

// NEW: Run 22Bet Scraper Manually
app.get('/api/debug/run-22bet', async (c) => {
    try {
        const scraper = new Scraper22Bet(c.env);
        const result = await scraper.syncOdds();
        return c.json(result);
    } catch (e: any) {
        return c.json({ error: e.message }, 500);
    }
});

import scheduler from './scheduler';

let localSchedulerStarted = false;

export default {
  fetch: async (request: Request, env: Env, ctx: ExecutionContext) => {
      // Local Development Scheduler Loop
      if (!localSchedulerStarted && (env.DEV_MODE === 'true' || request.url.includes('localhost') || request.url.includes('127.0.0.1'))) {
          localSchedulerStarted = true;
          console.log('[Local Scheduler] Starting background polling loop (30s)...');
          
          const pollingService = new AdaptivePollingService(env);
          const syncService = new EventSyncService(env);
          
          // Start Loop
          setInterval(async () => {
              console.log('[Local Scheduler] Tick: Running Adaptive Polling & Sync...');
              try {
                  await pollingService.run();

                  // Run 22Bet Scraper
                  const scraper = new Scraper22Bet(env);
                  await scraper.syncOdds();

                  await syncService.syncEventsFromImported();
              } catch (e) {
                  console.error('[Local Scheduler] Error:', e);
              }
          }, 5000); // Reduced to 5 seconds for Real-Time feel
          
          // Initial Run (Async)
          if (ctx && ctx.waitUntil) {
             ctx.waitUntil((async () => {
                 console.log('[Local Scheduler] Initial Run...');
                 await pollingService.run();
                 await syncService.syncEventsFromImported();
             })());
          }
      }
      
      return app.fetch(request, env, ctx);
  },
  scheduled: scheduler.scheduled
};
