import { Hono } from 'hono';
import { Env } from '../shared/types';
import { verifyAuth } from './middleware/jwtAuth';
import { ensureUserSchema } from './db';
import { ImportedEventPayload } from './types';
import { PasswordService } from './services/security/passwordService';
import { EventSyncService } from './services/eventSync';
import { SPORTS_CONFIG } from './config/sports';
import { generateMockData } from './utils/mockData';
import { TokenService } from './services/security/tokenService';
import { teamsData, marketsData } from './utils/seedData';
import { linkMarketsToMatch } from './utils/marketUtils';
import { runRobustIntegration, debugSoccerMatching, fetchLiveFixtures, fetchApiSportsOddsForFixtures, API_SPORTS_CONFIG } from './services/robustIntegration';
import { AdaptivePollingService } from './services/adaptivePolling';

const dev = new Hono<{ Bindings: Env, Variables: { user: { userId: string } } }>();

dev.post('/force-import', async (c) => {
    try {
        const body = await c.req.json().catch(() => ({}));
        const targetDate = body.date || '2026-03-07';
        const sports = body.sports || Object.keys(API_SPORTS_CONFIG);
        // Default to 3 days to cover pre-games
        const days = body.days || 3; 

        console.log(`[ForceImport] Starting manual import for ${targetDate} (+${days} days) covering ${sports.length} sports...`);

        const syncService = new EventSyncService(c.env);
        
        // 1. Run Robust Integration (fetch from API -> imported_odds)
        const result = await runRobustIntegration(c.env, { 
            targetDate: targetDate,
            sports: sports,
            days: days
        });

        // 2. Sync to Events table (imported_odds -> events)
        console.log('[ForceImport] Syncing to events table...');
        await syncService.syncEventsFromImported();

        return c.json({ 
            success: true, 
            message: "Import completed", 
            details: result 
        });
    } catch (e: any) {
        console.error('[ForceImport] Error:', e);
        return c.json({ error: e.message, stack: e.stack }, 500);
    }
});

dev.get('/force-poll', async (c) => {
    try {
        const pollingService = new AdaptivePollingService(c.env);
        const syncService = new EventSyncService(c.env);
        
        const task = async () => {
            console.log('[ForcePoll] Starting background update...');
            // 1. Run Robust Integration
            console.log('[ForcePoll] Running Robust Integration...');
            await runRobustIntegration(c.env).catch(e => console.error(`[ForcePoll] Robust Error: ${e}`));
            
            // 2. Run Adaptive Polling
            console.log('[ForcePoll] Running Adaptive Polling...');
            await pollingService.run().catch(e => console.error(`[ForcePoll] Polling Error: ${e}`));
            
            // 3. Run Sync
            console.log('[ForcePoll] Running Event Sync...');
            await syncService.syncEventsFromImported().catch(e => console.error(`[ForcePoll] Sync Error: ${e}`));
            console.log('[ForcePoll] Completed.');
        };

        if (c.executionCtx && c.executionCtx.waitUntil) {
            c.executionCtx.waitUntil(task());
        } else {
            // Local dev fallback
            task(); 
        }

        return c.json({ success: true, message: "Update process started in background" });
    } catch (e: any) {
        return c.json({ error: e.message, stack: e.stack }, 500);
    }
});

dev.get('/debug-sync', async (c) => {
    const logs: string[] = [];
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;

    try {
        console.log = (...args) => {
            logs.push(`[LOG] ${args.join(' ')}`);
            originalLog(...args);
        };
        console.warn = (...args) => {
            logs.push(`[WARN] ${args.join(' ')}`);
            originalWarn(...args);
        };
        console.error = (...args) => {
            logs.push(`[ERROR] ${args.join(' ')}`);
            originalError(...args);
        };

        const syncService = new EventSyncService(c.env);
        await syncService.syncEventsFromImported();

        return c.json({ success: true, logs });
    } catch (e: any) {
        return c.json({ success: false, error: e.message, stack: e.stack, logs }, 500);
    } finally {
        console.log = originalLog;
        console.warn = originalWarn;
        console.error = originalError;
    }
});

dev.get('/debug-matching', async (c) => {
    try {
        const result = await debugSoccerMatching(c.env);
        return c.json(result);
    } catch (e: any) {
        return c.json({ error: e.message, stack: e.stack }, 500);
    }
});

dev.get('/check-missing-odds', async (c) => {
    try {
        // Check for specific event payload structure
    const specificId = c.req.query('id');
    if (specificId) {
        const imported = await c.env.DB.prepare('SELECT id, payload FROM imported_odds WHERE id = ?').bind(specificId).first();
        if (imported) {
                return c.json({ found: true, imported });
            }
            return c.json({ found: false });
        }
        
        // Default: check generic stats
        const stats = await c.env.DB.prepare(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN json_extract(payload, '$.odds') IS NULL THEN 1 ELSE 0 END) as missing_odds,
                SUM(CASE WHEN json_extract(payload, '$.odds.h2h') IS NULL THEN 1 ELSE 0 END) as missing_h2h
            FROM imported_odds
        `).first();
        
        return c.json(stats);
    } catch (e: any) {
        return c.json({ error: e.message }, 500);
    }
});

dev.post('/sql', async (c) => {
    try {
        const body = await c.req.json();
        const query = body.query;
        const params = body.params || [];
        const res = await c.env.DB.prepare(query).bind(...params).all();
        return c.json(res);
    } catch (e: any) {
        return c.json({ error: e.message }, 500);
    }
});

dev.get('/check-odds/:fixtureId', async (c) => {
    const fixtureId = c.req.param('fixtureId');
    const apiKey = c.env.API_SPORTS_KEY;
    if (!apiKey) return c.json({ error: 'API_SPORTS_KEY not set' }, 500);

    const url = `https://v3.football.api-sports.io/odds?fixture=${fixtureId}`;
    console.log(`[CheckOdds] Fetching: ${url}`);
    try {
        const response = await fetch(url, {
            headers: {
                'x-apisports-key': apiKey
            }
        });
        const data = await response.json();
        return c.json(data);
    } catch (e: any) {
        return c.json({ error: e.message }, 500);
    }
});

dev.get('/check-imported-status', async (c) => {
    try {
        const { results } = await c.env.DB.prepare("SELECT count(*) as total, is_live, status, market_status FROM imported_odds GROUP BY is_live, status, market_status").all();
        return c.json(results);
    } catch (e: any) {
        return c.json({ error: e.message }, 500);
    }
});

dev.get('/check-imported-odds-schema', async (c) => {
    try {
        const { results } = await c.env.DB.prepare("PRAGMA table_info(imported_odds)").all();
        return c.json(results);
    } catch (e: any) {
        return c.json({ error: e.message }, 500);
    }
});

dev.get('/check-payload', async (c) => {
    try {
        const { results } = await c.env.DB.prepare("SELECT payload FROM imported_odds LIMIT 1").all();
        return c.json(results);
    } catch (e: any) {
        return c.json({ error: e.message }, 500);
    }
});


dev.get('/check-live-ids', async (c) => {
    try {
        const { results } = await c.env.DB.prepare("SELECT id, external_event_id, sport, status FROM events WHERE is_live=1 LIMIT 20").all();
        return c.json(results);
    } catch (e: any) {
        return c.json({ error: e.message }, 500);
    }
});

dev.get('/test-odds-fetch', async (c) => {
    try {
        const fixtureId = c.req.query('fixture');
        const sport = c.req.query('sport') || 'soccer';
        const apiKey = c.env.API_SPORTS_KEY;
        
        if (!fixtureId) return c.json({ error: 'Missing fixture param' }, 400);
        if (!apiKey) return c.json({ error: 'Missing API Key' }, 500);
        
        let url = '';
        if (sport === 'soccer') {
             url = `https://v3.football.api-sports.io/odds?fixture=${fixtureId}`;
        } else if (sport === 'basketball') {
             url = `https://v1.basketball.api-sports.io/odds?game=${fixtureId}`;
        } else {
             return c.json({ error: 'Unsupported sport for test' }, 400);
        }

        console.log(`[TestOdds] Fetching: ${url}`);
        const res = await fetch(url, {
            headers: {
                'x-apisports-key': apiKey
            }
        });
        
        const data = await res.json();
        return c.json({ 
            status: res.status, 
            url,
            response: data 
        });
    } catch (e: any) {
        return c.json({ error: e.message }, 500);
    }
});


dev.get('/check-fixture-payload', async (c) => {
    try {
        const id = c.req.query('id');
        if (!id) return c.json({ error: 'Missing id param' }, 400);

        // Use json_extract for more accurate fixture ID matching if possible, otherwise LIKE fallback
        // Here we keep LIKE but add logging for debugging
        console.log(`[CheckFixturePayload] Searching for ID: ${id}`);
        
        const { results } = await c.env.DB.prepare("SELECT payload FROM imported_odds WHERE payload LIKE ? LIMIT 1").bind(`%${id}%`).all();
        
        if (results && results.length > 0) {
            const p = JSON.parse(results[0].payload as string);
            return c.json({ 
                found: true, 
                payload_summary: {
                    id: p.fixture?.id || p.id,
                    odds_keys: Object.keys(p.odds || {}),
                    markets_keys: Object.keys(p.markets || {}),
                    bookmakers: p.bookmakers ? p.bookmakers.length : 0,
                    is_live: p.is_live,
                    status: p.fixture?.status?.short || p.status
                },
                full_payload: p
            });
        }
        return c.json({ found: false });
    } catch (e: any) {
        return c.json({ error: e.message }, 500);
    }
});

dev.get('/test-odds-fetch', async (c) => {
    try {
        const apiKey = c.env.API_SPORTS_KEY;
        if (!apiKey) return c.json({ error: 'Missing API Key' }, 500);

        const sport = 'soccer';
        const log = (msg: string) => console.log(msg);
        
        const fixtures = await fetchLiveFixtures(apiKey, sport, log);
        const count = fixtures.length;
        
        let oddsResult: any = "No fixtures found";
        let sampleFixture = null;
        let oddsMapResult = {};
        
        if (count > 0) {
            sampleFixture = fixtures[0];
            // Test with first 5 fixtures
            const subset = fixtures.slice(0, 5);
            const oddsMap = await fetchApiSportsOddsForFixtures(apiKey, sport, subset, log);
            
            // Convert Map to Object for JSON response
            for (const [key, val] of oddsMap.entries()) {
                (oddsMapResult as any)[key] = val;
            }
        }
        
        return c.json({
            fixturesCount: count,
            sampleFixture,
            oddsResult: oddsMapResult
        });
    } catch (e: any) {
        return c.json({ error: e.message, stack: e.stack }, 500);
    }
});

dev.get('/check-events-status', async (c) => {
    try {
        const { results } = await c.env.DB.prepare("SELECT * FROM events LIMIT 10").all();
        console.log('[CheckEvents] Found:', results?.length);
        return c.json({ count: results?.length, events: results });
    } catch (e: any) {
        return c.json({ error: e.message }, 500);
    }
});

dev.get('/check-events-schema', async (c) => {
    try {
        const { results } = await c.env.DB.prepare("PRAGMA table_info(events)").all();
        return c.json(results);
    } catch (e: any) {
        return c.json({ error: e.message }, 500);
    }
});

dev.get('/add-status-column', async (c) => {
    try {
        await c.env.DB.prepare("ALTER TABLE events ADD COLUMN status TEXT").run();
        return c.json({ success: true, message: "Added status column to events table" });
    } catch (e: any) {
        return c.json({ error: e.message }, 500);
    }
});

dev.get('/add-markets-column', async (c) => {
    try {
        await c.env.DB.prepare("ALTER TABLE events ADD COLUMN markets TEXT").run();
        return c.json({ success: true, message: "Added markets column to events table" });
    } catch (e: any) {
        return c.json({ error: e.message }, 500);
    }
});

dev.get('/check-premiership', async (c) => {
    try {
        const { results } = await c.env.DB.prepare(`
            SELECT id, league_name, payload FROM imported_odds 
            WHERE league_name LIKE '%Premiership%' OR league_name LIKE '%Scotland%'
        `).all();
        return c.json({ count: results.length, events: results });
            } catch (e: any) {
                return c.json({ error: e.message }, 500);
            }
        });

        dev.get('/sample-event', async (c) => {
            try {
                const event = await c.env.DB.prepare('SELECT * FROM events LIMIT 1').first();
                return c.json({ event });
            } catch (e: any) {
                return c.json({ error: e.message }, 500);
            }
        });

        dev.get('/sample-imported-volleyball', async (c) => {
            try {
                const id = c.req.query('id');
                const sql = id 
                    ? 'SELECT * FROM imported_odds WHERE id = ?'
                    : 'SELECT * FROM imported_odds WHERE sport = ? LIMIT 1';
                const params = id ? [id] : ['volleyball'];
                
                const event: any = await c.env.DB.prepare(sql).bind(...params).first();
                if (event && event.payload) {
                    try {
                        event.payload = JSON.parse(event.payload);
                    } catch (e) { void e; }
                }
                return c.json({ event });
            } catch (e: any) {
                return c.json({ error: e.message }, 500);
            }
        });

        dev.get('/status-breakdown', async (c) => {
            try {
                const sql = `
                    SELECT sport, status, COUNT(*) as count 
                    FROM events 
                    GROUP BY sport, status
                    ORDER BY sport, status
                `;
                const res = await c.env.DB.prepare(sql).all();
                return c.json(res.results);
            } catch (e: any) {
                return c.json({ error: e.message }, 500);
            }
        });

dev.get('/active-sports', async (c) => {
  return c.json({ error: 'The Odds API desativada. Use apenas API-Football.' }, 400);
});

dev.get('/test-apisports-soccer-key', async (c) => {
    try {
        const apiKey = c.env.API_SPORTS_KEY;
        if (!apiKey) return c.json({ error: 'No API_SPORTS_KEY configured' }, 400);
        const url = 'https://v3.football.api-sports.io/status';
        const res = await fetch(url, {
            headers: {
                'x-apisports-key': apiKey
            }
        });
        const data = await res.json();
        return c.json({
            ok: res.ok,
            status: res.status,
            host: 'v3.football.api-sports.io',
            response: data
        });
    } catch (e: any) {
        return c.json({ error: e.message }, 500);
    }
});

dev.get('/test-rapidapi-football-status', async (c) => {
    try {
        const rawEnv: any = c.env as any;
        const rapidKey = rawEnv['x-rapidapi-key'] || rawEnv.X_RAPIDAPI_KEY;
        if (!rapidKey) return c.json({ error: 'No x-rapidapi-key configured' }, 400);
        const url = 'https://api-football-v1.p.rapidapi.com/v3/status';
        const res = await fetch(url, {
            headers: {
                'x-rapidapi-key': rapidKey,
                'x-rapidapi-host': 'api-football-v1.p.rapidapi.com'
            }
        });
        const data = await res.json();
        return c.json({
            ok: res.ok,
            status: res.status,
            host: 'api-football-v1.p.rapidapi.com',
            response: data
        });
    } catch (e: any) {
        return c.json({ error: e.message }, 500);
    }
});

dev.get('/test-apisports-volleyball', async (c) => {
        try {
            const apiKey = c.env.API_SPORTS_KEY;
            if (!apiKey) return c.json({ error: 'No API Key' });
            
            // Try fetching games for today/tomorrow
            const date = new Date().toISOString().split('T')[0];
            const url = `https://v1.volleyball.api-sports.io/games?date=${date}`;
            
            const res = await fetch(url, {
                headers: {
                    'x-apisports-key': apiKey
                }
            });
            const data = await res.json();
            return c.json(data);
        } catch (e: any) {
            return c.json({ error: e.message }, 500);
        }
    });

    dev.get('/test-apisports-volleyball-odds', async (c) => {
            try {
                const apiKey = c.env.API_SPORTS_KEY;
                if (!apiKey) return c.json({ error: 'No API Key' });
                
                // Game ID from query or default
                const gameId = c.req.query('game');
                const date = c.req.query('date');
                const league = c.req.query('league');
                const season = c.req.query('season');
                
                let url = '';
                if (gameId) {
                     url = `https://v1.volleyball.api-sports.io/odds?game=${gameId}`;
                } else if (date) {
                     url = `https://v1.volleyball.api-sports.io/odds?date=${date}`;
                } else if (league && season) {
                     url = `https://v1.volleyball.api-sports.io/odds?league=${league}&season=${season}`;
                } else {
                     // Default to a game
                     url = `https://v1.volleyball.api-sports.io/odds?game=185657`;
                }
                
                const res = await fetch(url, {
                    headers: {
                        'x-apisports-key': apiKey
                    }
                });
                const data = await res.json();
                return c.json(data);
            } catch (e: any) {
                return c.json({ error: e.message }, 500);
            }
        });
    dev.get('/test-apisports-handball', async (c) => {
        try {
            const apiKey = c.env.API_SPORTS_KEY;
            if (!apiKey) return c.json({ error: 'No API Key' });
            
            const date = new Date().toISOString().split('T')[0];
            const url = `https://v1.handball.api-sports.io/games?date=${date}`;
            
            const res = await fetch(url, {
                headers: {
                    'x-apisports-key': apiKey
                }
            });
            const data = await res.json();
            return c.json(data);
        } catch (e: any) {
            return c.json({ error: e.message }, 500);
        }
    });
    dev.get('/count-by-sport', async (c) => {
        try {
            const res = await c.env.DB.prepare('SELECT sport, COUNT(*) as count FROM imported_odds GROUP BY sport').all();
            return c.json(res.results);
        } catch (e: any) {
            return c.json({ error: e.message }, 500);
        }
    });

dev.get('/db-status', async (c) => {
    try {
        const eventsTotal = await c.env.DB.prepare('SELECT count(*) as c FROM events').first('c');
        const eventsLive = await c.env.DB.prepare('SELECT count(*) as c FROM events WHERE is_live=1').first('c');
        const importedTotal = await c.env.DB.prepare('SELECT count(*) as c FROM imported_odds').first('c');
        const importedLive = await c.env.DB.prepare('SELECT count(*) as c FROM imported_odds WHERE is_live=1').first('c');
        
        return c.json({ 
            events: { total: eventsTotal, live: eventsLive }, 
            imported_odds: { total: importedTotal, live: importedLive } 
        });
    } catch (e: any) {
        return c.json({ error: e.message }, 500);
    }
});

dev.post('/run-sync', async (c) => {
            try {
                console.log('[Dev] Triggering Manual Event Sync...');
                const syncService = new EventSyncService(c.env);
                const result = await syncService.syncEventsFromImported();
                return c.json(result);
            } catch (e: any) {
                return c.json({ error: e.message, stack: e.stack }, 500);
            }
        });

        dev.post('/force-import', async (c) => {
            try {
                console.log('[Dev] Triggering Force Import (Background)...');
                const syncService = new EventSyncService(c.env);
                const pollingService = new AdaptivePollingService(c.env);
                
                const task = async () => {
                    console.log('[ForceImport] Starting background tasks...');
                    try {
                        // 1. Run Robust Integration (Scrapers/API)
                        console.log('[ForceImport] Running Robust Integration...');
                        await runRobustIntegration(c.env);
                        
                        // 2. Run Polling
                        console.log('[ForceImport] Running PollingService...');
                        await pollingService.run();
                        
                        // 3. Sync to DB
                        console.log('[ForceImport] Syncing to DB...');
                        const syncResult = await syncService.syncEventsFromImported();
                        console.log('[ForceImport] Completed successfully:', syncResult);
                    } catch (err) {
                        console.error('[ForceImport] Background Error:', err);
                    }
                };

                if (c.executionCtx && c.executionCtx.waitUntil) {
                    c.executionCtx.waitUntil(task());
                } else {
                    // Local dev fallback - just run it without awaiting for response
                    task();
                }
                
                return c.json({ success: true, message: "Import process started in background" });
            } catch (e: any) {
                console.error('[ForceImport] Error:', e);
                return c.json({ error: e.message, stack: e.stack }, 500);
            }
        });

    dev.post('/force-robust-sync', async (c) => {
        try {
            const body = await c.req.json().catch(() => ({}));
            const sports = body.sports || ['basketball', 'tennis', 'mma', 'hockey']; // Default to non-soccer for test
            const days = body.days || 3;
            
            console.log(`[Dev] Forcing Robust Sync for ${sports} (days=${days})...`);
            const result = await runRobustIntegration(c.env, { sports, days });
            
            return c.json(result);
        } catch (e: any) {
            return c.json({ error: e.message, stack: e.stack }, 500);
        }
    });

dev.post('/clear-all-events', async (c) => {
    try {
        console.log('[Dev] Clearing ALL events from D1...');
        await c.env.DB.prepare('DELETE FROM events').run();
        await c.env.DB.prepare('DELETE FROM imported_odds').run();
        console.log('[Dev] All events cleared.');
        return c.json({ success: true, message: 'All events cleared from D1' });
    } catch (e: any) {
        return c.json({ error: e.message }, 500);
    }
});

dev.post('/cleanup-excluded', async (c) => {
    return c.json({ success: true, message: 'Cleanup disabled' });
});

dev.get('/inspect-imported', async (c) => {
    try {
        const { results } = await c.env.DB.prepare(`
            SELECT payload, league_name, id FROM imported_odds LIMIT 5
        `).all();
        
        const parsed = results.map(r => {
            try {
                return {
                    id: r.id,
                    league_col: r.league_name,
                    payload: JSON.parse(r.payload as string)
                };
            } catch (e) {
                return { error: 'Parse failed', raw: r.payload };
            }
        });

        return c.json({ count: results.length, samples: parsed });
    } catch (e: any) {
        return c.json({ error: e.message }, 500);
    }
});

    dev.get('/list-odds', async (c) => {
        try {
            const limit = parseInt(c.req.query('limit') || '50');
            const { results } = await c.env.DB.prepare(`
                SELECT id, home_team, away_team, league_name, is_live, updated_at, payload, sport
                FROM imported_odds 
                ORDER BY updated_at DESC 
                LIMIT ?
            `).bind(limit).all();

            const mapped = results.map((r: any) => {
                 let source = 'unknown';
                 let markets = [];
                 try {
                     const p = JSON.parse(r.payload);
                     source = p.source || 'unknown';
                     markets = p.markets || [];
                } catch(e) { void 0; }

                 return {
                     id: r.id,
                     sport: r.sport,
                     home_team: r.home_team,
                     away_team: r.away_team,
                     teams: { home: r.home_team, away: r.away_team },
                     league: r.league_name,
                     live: r.is_live === 1,
                     updated: r.updated_at,
                     source,
                     markets,
                     has_odds: markets.length > 0,
                     payload: r.payload // Include payload for debug
                 };
            });

            return c.json({ count: results.length, events: mapped });
        } catch (e: any) {
            return c.json({ error: e.message }, 500);
        }
    });

    dev.get('/check-datetime', async (c) => {
    const { results } = await c.env.DB.prepare(`
        SELECT id, event_date, datetime(event_date) as parsed_dt 
        FROM events 
        WHERE event_date IS NOT NULL 
        LIMIT 10
    `).all();
    return c.json({ results });
});

dev.post('/query', async (c) => {
    try {
        const body = await c.req.json();
        const query = body.query;
        if (!query) return c.json({ error: 'No query provided' }, 400);
        const { results } = await c.env.DB.prepare(query).all();
        return c.json({ results });
    } catch (e: any) {
        return c.json({ error: e.message }, 500);
    }
});

dev.get('/list-events', async (c) => {
        try {
            const limit = parseInt(c.req.query('limit') || '50');
            const { results } = await c.env.DB.prepare(`
                SELECT id, home_team, away_team, league, is_live, status, markets, score, sport, home_odd, draw_odd, away_odd, event_date
                FROM events 
                ORDER BY event_date DESC 
                LIMIT ?
            `).bind(limit).all();

            const mapped = results.map((r: any) => {
                 let markets = [];
                 try {
                     markets = typeof r.markets === 'string' ? JSON.parse(r.markets) : r.markets;
                 } catch (e) { void 0; }
                 return {
                     id: r.id,
                     home_team: r.home_team,
                     away_team: r.away_team,
                     league: r.league,
                     live: r.is_live,
                     status: r.status,
                     sport: r.sport,
                     markets,
                     score: r.score,
                     home_odd: r.home_odd,
                     draw_odd: r.draw_odd,
                     away_odd: r.away_odd,
                     event_date: r.event_date
                 };
            });

            return c.json({ count: results.length, events: mapped });
        } catch (e: any) {
            return c.json({ error: e.message }, 500);
        }
    });

dev.post('/test-setup-freebet', async (c) => {
    try {
        await ensureUserSchema(c.env.DB);
        const userId = 'test-user-freebet';
        
        // 1. Ensure User
        await c.env.DB.prepare(`
            INSERT INTO user (id, username)
            VALUES (?, ?)
            ON CONFLICT(id) DO NOTHING
        `).bind(userId, 'TestUserFreebet').run();

        // 2. Ensure Wallet
        await c.env.DB.prepare(`
            INSERT INTO wallets (user_id, balance, currency, created_at)
            VALUES (?, 0, 'EUR', CURRENT_TIMESTAMP)
            ON CONFLICT(user_id, currency) DO NOTHING
        `).bind(userId).run();

        // 2b. Ensure KYC Verified
        await c.env.DB.prepare('DELETE FROM kyc_profiles WHERE user_id = ?').bind(userId).run();
        await c.env.DB.prepare(`
            INSERT INTO kyc_profiles (id, user_id, status, risk_level, verified_at, created_at)
            VALUES (?, ?, 'verified', 'low', datetime('now'), datetime('now'))
        `).bind(crypto.randomUUID(), userId).run();
        
        // Ensure bets table has device_fingerprint
        try { await c.env.DB.prepare("ALTER TABLE bets ADD COLUMN device_fingerprint TEXT").run(); } catch (e) { void 0; }
        try { await c.env.DB.prepare("ALTER TABLE bets ADD COLUMN ip_address TEXT").run(); } catch (e) { void 0; }

        // 3. Give Freebet (Expire in 1 day)
        // Clean old unused freebets for this test user first to avoid clutter
        await c.env.DB.prepare('DELETE FROM user_freebets WHERE user_id = ? AND used = 0').bind(userId).run();
        
        const freebetId = crypto.randomUUID();
        await c.env.DB.prepare(`
            INSERT INTO user_freebets (id, user_id, amount_eur, expires_at, created_at, used, source)
            VALUES (?, ?, 50, datetime('now', '+1 day'), datetime('now'), 0, 'manual_test')
        `).bind(freebetId, userId).run();

        // 4. Generate Token
        const tokenService = new TokenService(c.env.JWT_SECRET || 'secret');
        const token = await tokenService.createAccessToken(userId);

        // 5. Get a valid Event ID for testing
        // Try to find a live event first, then any event
        let event = await c.env.DB.prepare('SELECT id, home_team, away_team FROM imported_odds WHERE is_live = 1 LIMIT 1').first();
        if (!event) {
            event = await c.env.DB.prepare('SELECT id, home_team, away_team FROM imported_odds LIMIT 1').first();
        }

        return c.json({
            success: true,
            userId,
            token,
            freebetId,
            event,
            curlCommand: `curl -X POST http://localhost:8787/api/bets -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" -d '{"stake": 10, "use_freebet": true, "bets": [{"event_id": "${event?.id || 'EVENT_ID'}", "selection": "Home", "odd": 1.5, "market_key": "h2h"}]}'`
        });
    } catch (e: any) {
        return c.json({ error: e.message, stack: e.stack }, 500);
    }
});

dev.post('/seed-initial', async (c) => {
    try {
        console.log('[Seed] Starting initial seed...');
        
        // Ensure Schema exists
        await ensureUserSchema(c.env.DB);
        
        // 1. Seed Teams
        for (const team of teamsData) {
            await c.env.DB.prepare(`
                INSERT INTO teams (official, aliases) 
                VALUES (?, ?) 
                ON CONFLICT(official) DO NOTHING
            `).bind(team.official, JSON.stringify(team.aliases)).run();
        }
        console.log('[Seed] Teams populated.');

        // 2. Seed Markets
        // Using match_id = 0 as per instructions
        for (const market of marketsData) {
            await c.env.DB.prepare(`
                INSERT INTO markets (match_id, market_key, market_name, bookmaker) 
                VALUES (0, ?, ?, 'Generic') 
                ON CONFLICT(match_id, market_key, bookmaker) DO NOTHING
            `).bind(market, market).run();
        }
        console.log('[Seed] Markets populated.');

        return c.json({ success: true, message: 'Database seeded successfully with teams and markets.' });
    } catch (e: any) {
        console.error('[Seed] Error:', e);
        return c.json({ error: e.message }, 500);
    }
});

dev.get('/schema', async (c) => {
    try {
        const { results } = await c.env.DB.prepare("PRAGMA table_info(imported_odds)").all();
        return c.json(results);
    } catch (e: any) {
        return c.json({ error: e.message }, 500);
    }
});

dev.post('/link-markets/:matchId', async (c) => {
    try {
        const matchId = c.req.param('matchId');
        if (!matchId) return c.json({ error: 'Missing matchId' }, 400);

        // Since linkMarketsToMatch expects MarketLinkParams object, we need to adapt this endpoint
        // Assuming body contains the market details
        const body = await c.req.json().catch(() => ({}));
        
        await linkMarketsToMatch(c.env.DB, {
             matchId: Number(matchId),
             marketKey: body.marketKey || 'h2h',
             marketName: body.marketName || 'Match Winner',
             bookmaker: body.bookmaker || 'Generic'
        });

        return c.json({ success: true, message: `Markets linked to match ${matchId}` });
    } catch (e: any) {
        return c.json({ error: e.message }, 500);
    }
});

dev.post('/run-robust-integration', async (c) => {
    try {
        const result = await runRobustIntegration(c.env);
        return c.json(result);
    } catch (e: any) {
        return c.json({ error: e.message }, 500);
    }
});

dev.post('/sync-events', async (c) => {
    try {
        console.log('[Dev] Triggering Event Sync...');
        const service = new EventSyncService(c.env);
        const result = await service.syncEventsFromImported();
        return c.json(result);
    } catch (e: any) {
        return c.json({ error: e.message }, 500);
    }
});

dev.get('/debug-volleyball-fixtures', async (c) => {
            try {
                const apiKey = c.env.API_SPORTS_KEY;
                if (!apiKey) return c.json({ error: 'No API Key' });
                
                // Fetch tomorrow
                const d = new Date();
                d.setDate(d.getDate() + 1);
                const dateStr = d.toISOString().split('T')[0];

                const url = `https://v1.volleyball.api-sports.io/games?date=${dateStr}`;
                const res = await fetch(url, { headers: { 'x-apisports-key': apiKey } });
                const data: any = await res.json();
                
                return c.json({
                    date: dateStr,
                    count: data.response?.length,
                    sample: data.response ? data.response.slice(0, 3) : [],
                    raw: data
                });
            } catch (e: any) {
                return c.json({ error: e.message }, 500);
            }
        });

dev.get('/check-odds-pages', async (c) => {
        const date = c.req.query('date') || new Date().toISOString().split('T')[0];
        const apiKey = c.env.API_SPORTS_KEY;
        if (!apiKey) return c.json({ error: 'Missing API Key' }, 500);

        const url = `https://v3.football.api-sports.io/odds?date=${date}&page=1`;
        
        try {
            const response = await fetch(url, { headers: { 'x-apisports-key': apiKey } });
            const data = await response.json();
            return c.json(data);
        } catch (e: any) {
            return c.json({ error: e.message }, 500);
        }
    });

    dev.get('/test-fetch', async (c) => {
    try {
        const date = c.req.query('date') || new Date().toISOString().split('T')[0];
        const sport = c.req.query('sport') || 'soccer';
        const apiKey = c.env.API_SPORTS_KEY;
        if (!apiKey) return c.json({ error: 'Missing API Key' }, 500);
        
        // Inline simple fetch to debug
        const API_SPORTS_CONFIG: Record<string, { url: string }> = {
            soccer: { url: "https://v3.football.api-sports.io/fixtures" },
            basketball: { url: "https://v1.basketball.api-sports.io/games" }
        };
        
        const config = API_SPORTS_CONFIG[sport];
        if (!config) return c.json({ error: "Invalid sport" });
        
        const url = `${config.url}?date=${date}&timezone=Europe/Lisbon`;
        console.log(`Testing fetch: ${url}`);
        
        const res = await fetch(url, { headers: { "x-apisports-key": apiKey } });
        const data: any = await res.json();
        
        return c.json({ 
            url, 
            status: res.status, 
            result_count: data.results,
            response_count: data.response ? data.response.length : 0,
            fixtures: data.response || []
        });
    } catch (e: any) {
        return c.json({ error: e.message }, 500);
    }
});

dev.get('/check-event/:id', async (c) => {
        try {
            const id = c.req.param('id');
            const event = await c.env.DB.prepare('SELECT * FROM events WHERE id = ?').bind(id).first();
            if (event) {
                return c.json({ found: true, event });
            }
            return c.json({ found: false });
        } catch (e: any) {
            return c.json({ error: e.message }, 500);
        }
    });

    dev.get('/check-imported/:id', async (c) => {
        try {
            const id = c.req.param('id');
            const imported = await c.env.DB.prepare('SELECT id, is_live, updated_at, event_date, payload FROM imported_odds WHERE id = ?').bind(id).first();
            if (imported) {
                return c.json({ found: true, imported });
            }
            return c.json({ found: false });
        } catch (e: any) {
            return c.json({ error: e.message }, 500);
        }
    });

dev.post('/mock-data', async (c) => {
    try {
        const result = await generateMockData(c.env);
        return c.json({ success: true, ...result });
    } catch (e: any) {
        return c.json({ error: e.message, stack: e.stack }, 500);
    }
});

export default dev;
