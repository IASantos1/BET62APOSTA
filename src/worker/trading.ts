import { Hono } from 'hono';
import { Env } from '../shared/types';
import { verifyAuth } from './middleware/jwtAuth';

type Variables = {
    user: {
        userId: string;
    }
};

const trading = new Hono<{ Bindings: Env; Variables: Variables }>();

// Middleware to ensure operator
trading.use('*', verifyAuth);
trading.use('*', async (c, next) => {
    const userId = c.get('user').userId;
    const profile = await c.env.DB.prepare('SELECT is_operator FROM user_profile WHERE user_id = ?').bind(userId).first();
    const envVal = c.env.ENVIRONMENT;
    const devMode = c.env.DEV_MODE;
    const isDevEnv = envVal === 'development' || envVal === 'dev' || devMode === 'true';

    console.log(`[Trading Middleware] User: ${userId}, Env: ${envVal}, DevMode: ${devMode}, IsDev: ${isDevEnv}, Operator: ${profile?.is_operator}`);

    // Loose equality check for operator status (handles 1, '1', true)
    const isOp = profile && ((profile as any).is_operator == 1 || (profile as any).is_operator === '1' || (profile as any).is_operator === true);

    if (!isOp) {
        // Always allow in development environment to avoid blocking testing
        if (isDevEnv || !envVal) { // Treat missing env as dev for safety in local testing
            console.warn(`[Trading Middleware] Dev override: User ${userId} is not marked as operator, allowing access`);
            return next();
        }
        console.warn(`[Trading Middleware] Forbidden: User ${userId} is not an operator`);
        return c.json({ error: 'Forbidden', debug: { env: envVal, devMode } }, 403);
    }
    
    await next();
});

// Ensure table exists
async function ensureTradingTable(db: D1Database) {
    try {
        await db.prepare(`
            CREATE TABLE IF NOT EXISTS trading_decisions (
                event_id TEXT PRIMARY KEY,
                status TEXT,
                manual_odds TEXT,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `).run();
    } catch (e) {
        console.error('Error creating trading table', e);
    }
}

// GET /events - List all events with trading status
trading.get('/events', async (c) => {
    const sport = c.req.query('sport') || 'all';
    const statusFilter = c.req.query('status') || 'all'; // all, pending, approved, suspended
    
    await ensureTradingTable(c.env.DB);
    
    let query = `
        SELECT e.*, td.status as trading_status, td.manual_odds
        FROM events e
        LEFT JOIN trading_decisions td ON e.id = td.event_id
        WHERE e.start_time >= datetime('now', '-24 hours')
    `;
    
    const params: any[] = [];
    
    if (sport !== 'all') {
        query += ` AND e.sport = ?`;
        params.push(sport);
    }
    
    // Status filter logic
    if (statusFilter === 'pending') {
        query += ` AND (td.status IS NULL OR td.status = 'pending')`;
    } else if (statusFilter === 'approved') {
        query += ` AND td.status = 'approved'`;
    } else if (statusFilter === 'suspended') {
        query += ` AND td.status = 'suspended'`;
    }

    // Always exclude deleted events unless explicitly asked (future proofing)
    query += ` AND (td.status IS NULL OR td.status != 'deleted')`;
    
    query += ` ORDER BY e.start_time ASC LIMIT 100`;
    
    try {
        const res = await c.env.DB.prepare(query).bind(...params).all();
        
        // Parse manual_odds if present
        const results = (res.results || []).map((r: any) => {
            if (r.manual_odds) {
                try {
                    r.manual_odds = JSON.parse(r.manual_odds);
                } catch (e) {
                    // ignore parse error
                }
            }
            
            // Construct match name if missing
            if (!r.match) {
                const home = r.home_team || 'Home';
                const away = r.away_team || 'Away';
                r.match = `${home} vs ${away}`;
            }

            // Default status for UI if null
            if (!r.trading_status) r.trading_status = 'pending';
            return r;
        });

        return c.json(results);
    } catch (e: any) {
        return c.json({ error: e.message }, 500);
    }
});

// POST /decision - Approve/Suspend/Update
trading.post('/decision', async (c) => {
    const body = await c.req.json();
    const { eventId, status, manualOdds } = body; // status: 'approved' | 'suspended'
    
    if (!eventId || !status) {
        return c.json({ error: 'Missing eventId or status' }, 400);
    }
    
    await ensureTradingTable(c.env.DB);
    
    try {
        await c.env.DB.prepare(`
            INSERT INTO trading_decisions (event_id, status, manual_odds, updated_at)
            VALUES (?, ?, ?, datetime('now'))
            ON CONFLICT(event_id) DO UPDATE SET
                status = excluded.status,
                manual_odds = excluded.manual_odds,
                updated_at = excluded.updated_at
        `).bind(eventId, status, manualOdds ? JSON.stringify(manualOdds) : null).run();
        
        return c.json({ success: true, eventId, status });
    } catch (e: any) {
        return c.json({ error: e.message }, 500);
    }
});

export default trading;
