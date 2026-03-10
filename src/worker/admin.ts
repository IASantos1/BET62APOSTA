import { Hono } from 'hono';
import { Env } from '../shared/types';
import { verifyAuth } from './middleware/jwtAuth';
import { KYCService } from './services/kyc';
import { AuditService } from './services/audit';
import { KYCStatus } from './services/accountState';

type Variables = {
    user: {
        userId: string;
    }
};

const admin = new Hono<{ Bindings: Env; Variables: Variables }>();

// Middleware to ensure admin
admin.use('*', verifyAuth);

admin.use('*', async (c, next) => {
    const userId = c.get('user').userId;
    const profile = await c.env.DB.prepare('SELECT is_operator FROM user_profile WHERE user_id = ?').bind(userId).first();
    
    if (!profile || (profile as any).is_operator !== 1) {
        console.warn(`[Admin Middleware] Forbidden: User ${userId} is not an operator`);
        return c.json({ error: 'Forbidden' }, 403);
    }
    
    await next();
});

admin.get('/users', async (c) => {
    try {
        // Ensure kyc_profiles table exists to avoid SQL error if not migrated
        // This is a safety check because the LEFT JOIN below depends on it
        // We can also wrap the query in a try-catch to return empty list or fallback
        
        // Join with kyc_profiles for better overview
        const users = await c.env.DB.prepare(`
            SELECT u.id, up.email, up.is_operator, up.sharp_score, up.roi, up.bets, up.wins, kp.status as kyc_status, kp.risk_level
            FROM user u 
            LEFT JOIN user_profile up ON u.id = up.user_id
            LEFT JOIN kyc_profiles kp ON u.id = kp.user_id
            ORDER BY up.sharp_score DESC
        `).all();
        
        return c.json(users.results || []);
    } catch (e: any) {
        console.error('[Admin] Error fetching users:', e);
        // Fallback query if kyc_profiles is missing
        try {
            const users = await c.env.DB.prepare(`
                SELECT u.id, up.email, up.is_operator, up.sharp_score, up.roi, up.bets, up.wins
                FROM user u 
                LEFT JOIN user_profile up ON u.id = up.user_id
                ORDER BY up.sharp_score DESC
            `).all();
            return c.json(users.results || []);
        } catch (innerError) {
            console.error('[Admin] Fatal error fetching users:', innerError);
            return c.json({ error: 'Failed to fetch users' }, 500);
        }
    }
});

admin.post('/users/:userId/toggle-operator', async (c) => {
    const userId = c.req.param('userId');
    const { is_operator } = await c.req.json();
    
    await c.env.DB.prepare('UPDATE user_profile SET is_operator = ? WHERE user_id = ?')
        .bind(is_operator ? 1 : 0, userId).run();
        
    return c.json({ success: true });
});

// KYC Management (Tier-1 State Machine)
admin.get('/kyc/pending', async (c) => {
    const pending = await c.env.DB.prepare(`
        SELECT kp.id as kyc_id, kp.user_id, kp.status, kp.created_at, u.username, up.email, up.created_at as registration_date, up.country, up.full_name
        FROM kyc_profiles kp
        JOIN user u ON kp.user_id = u.id
        LEFT JOIN user_profile up ON u.id = up.user_id
        WHERE kp.status = 'pending'
    `).all();

    const results = [];
    for (const p of (pending.results || [])) {
        const docs = await c.env.DB.prepare('SELECT id, type, created_at, ip_address, status FROM kyc_documents WHERE kyc_profile_id = ?').bind(p.kyc_id).all();
        results.push({
            ...p,
            documents: (docs.results || []).map((d: any) => ({
                ...d,
                url: `/api/admin/kyc/document/${d.id}`
            }))
        });
    }

    return c.json(results);
});

admin.get('/kyc/document/:id', async (c) => {
    const id = c.req.param('id');
    const doc = await c.env.DB.prepare('SELECT content, mime_type, filename FROM kyc_documents WHERE id = ?').bind(id).first<any>();
    
    if (!doc || !doc.content) {
        return c.text('Document not found', 404);
    }
    
    // Handle D1 BLOB format (likely number[] or ArrayBuffer)
    let content = doc.content;
    if (Array.isArray(content)) {
        content = new Uint8Array(content);
    }
    
    return c.body(content, 200, {
        'Content-Type': doc.mime_type || 'application/octet-stream',
        'Content-Disposition': `inline; filename="${doc.filename || 'document'}"`
    });
});

admin.post('/kyc/decision', async (c) => {
    const adminId = c.get('user').userId;
    const { kyc_id, decision, reason } = await c.req.json();
    
    if (!['verified', 'rejected'].includes(decision)) {
        return c.json({ error: 'Invalid decision' }, 400);
    }

    if (!reason) {
        return c.json({ error: 'Reason is required' }, 400);
    }

    // Get userId from kyc_id
    const profile = await c.env.DB.prepare('SELECT user_id FROM kyc_profiles WHERE id = ?').bind(kyc_id).first();
    if (!profile) {
        return c.json({ error: 'KYC Profile not found' }, 404);
    }

    const audit = new AuditService(c.env.DB);
    const kycService = new KYCService(c.env.DB, audit);
    
    try {
        await kycService.updateStatus(profile.user_id as string, decision as KYCStatus, adminId, reason, { ip: c.req.header('CF-Connecting-IP'), userAgent: c.req.header('User-Agent') });
        return c.json({ success: true });
    } catch (e: any) {
        return c.json({ error: e.message }, 500);
    }
});

admin.post('/users/:userId/suspend', async (c) => {
    const adminId = c.get('user').userId;
    const userId = c.req.param('userId');
    const { reason } = await c.req.json();

    const audit = new AuditService(c.env.DB);
    const kycService = new KYCService(c.env.DB, audit);
    try {
        await kycService.updateStatus(userId, 'suspended', adminId, reason || 'Manual suspension', { ip: c.req.header('CF-Connecting-IP'), userAgent: c.req.header('User-Agent') });
        return c.json({ success: true });
    } catch (e: any) {
        return c.json({ error: e.message }, 500);
    }
});

// Deprecated Stubs (kept for backward compat if UI calls them)
admin.post('/kyc/documents/:docId/status', async (c) => {
    // This assumes old system or needs mapping. For now, just return success.
    // Ideally we update the document status in kyc_documents if docId matches UUID
    const docId = c.req.param('docId');
    const { status } = await c.req.json();
    // Try update new table
    await c.env.DB.prepare('UPDATE kyc_documents SET status = ? WHERE id = ?').bind(status, docId).run();
    return c.json({ success: true });
});

admin.post('/kyc/approve', async (c) => {
    const uid = c.req.query('uid');
    const adminId = c.get('user').userId;
    if (uid) {
         const audit = new AuditService(c.env.DB);
         const kycService = new KYCService(c.env.DB, audit);
         await kycService.updateStatus(uid, 'verified', adminId, 'Legacy approval', { ip: c.req.header('CF-Connecting-IP'), userAgent: c.req.header('User-Agent') });
    }
    return c.json({ success: true });
});

// Payout Stub
admin.post('/profit/payout', async (c) => {
    // Just return success for now to avoid errors in UI
    return c.json({ success: true });
});

// Fix for Missing Route: /api/admin/profit/payouts
admin.get('/profit/payouts', async (c) => {
    try {
        // Return dummy data or empty list for now
        return c.json({ 
            success: true, 
            payouts: [] 
        });
    } catch (e) {
        return c.json({ success: false, error: 'Failed to fetch payouts' }, 500);
    }
});

admin.get('/alerts', async (c) => {
    const limitParam = c.req.query('limit');
    const limit = Math.min(Math.max(Number(limitParam) || 50, 1), 200);
    const res = await c.env.DB.prepare(`
        SELECT id, type, message, data, created_at
        FROM risk_alerts
        ORDER BY id DESC
        LIMIT ?
    `).bind(limit).all();
    return c.json(res.results || []);
});

// Cache & Events Cleanup
admin.post('/cache/clear', async (c) => {
    try {
        const tables = ['imported_odds', 'event_updates', 'events', 'live_event_state'];
        const cleared: Record<string, number> = {};
        for (const t of tables) {
            try {
                const row = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first<{ n: number }>();
                cleared[t] = row?.n || 0;
                await c.env.DB.prepare(`DELETE FROM ${t}`).run();
            } catch {
                cleared[t] = -1;
            }
        }
        return c.json({ success: true, cleared }, 200, {
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
        });
    } catch (e: any) {
        return c.json({ success: false, error: e.message }, 500, {
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
        });
    }
});

// --- WITHDRAWAL MANAGEMENT ---
admin.get('/withdrawals', async (c) => {
    // List all withdrawals, sorted by date DESC
    // Join with user and bank info
    const withdrawals = await c.env.DB.prepare(`
        SELECT w.*, u.username, up.email, uba.iban, uba.holder_name, uba.bank_name
        FROM withdrawals w
        JOIN user u ON w.user_id = u.id
        LEFT JOIN user_profile up ON u.id = up.user_id
        LEFT JOIN user_bank_accounts uba ON w.iban_id = uba.id
        ORDER BY w.created_at DESC
    `).all();
    return c.json({ success: true, withdrawals: withdrawals.results || [] });
});

admin.post('/withdrawals/:id/approve', async (c) => {
    const adminId = c.get('user').userId;
    const withdrawalId = c.req.param('id');
    const audit = new AuditService(c.env.DB);

    const w = await c.env.DB.prepare('SELECT * FROM withdrawals WHERE id = ?').bind(withdrawalId).first<any>();
    if (!w) return c.json({ error: 'Withdrawal not found' }, 404);

    if (w.status !== 'REQUESTED' && w.status !== 'IBAN_PENDING_REVIEW') {
        return c.json({ error: 'Withdrawal not in pending state' }, 400);
    }

    try {
        // Logic:
        // If amount <= 300, set to AUTHORIZED so the auto-job picks it up (if valid).
        // If amount > 300, the auto-job ignores it (limit 300). So Admin approval implies Manual Payout.
        // We mark it as PAID immediately.
        
        let newStatus = 'AUTHORIZED';
        if (w.amount_eur > 300) {
            newStatus = 'PAID';
        }

        const queries = [
            c.env.DB.prepare("UPDATE withdrawals SET status = ? WHERE id = ?").bind(newStatus, withdrawalId)
        ];

        if (newStatus === 'PAID') {
             queries.push(
                 c.env.DB.prepare("UPDATE transactions SET status = 'COMPLETED' WHERE type = 'WITHDRAWAL' AND external_id = ?")
                 .bind(`WTH-${withdrawalId}`)
             );
        }

        await c.env.DB.batch(queries);

        await audit.log({
            actorType: 'admin',
            actorId: adminId,
            action: newStatus === 'PAID' ? 'WITHDRAWAL_MANUALLY_PAID' : 'WITHDRAWAL_APPROVED',
            entity: 'withdrawal',
            entityId: withdrawalId,
            before: JSON.stringify({ status: w.status }),
            after: JSON.stringify({ status: newStatus }),
            ip: c.req.header('CF-Connecting-IP') || 'unknown',
            userAgent: c.req.header('User-Agent')
        });

        return c.json({ success: true, status: newStatus });
    } catch (e) {
        return c.json({ error: 'Database error' }, 500);
    }
});

admin.post('/withdrawals/:id/reject', async (c) => {
    const adminId = c.get('user').userId;
    const withdrawalId = c.req.param('id');
    const { reason } = await c.req.json();
    const audit = new AuditService(c.env.DB);

    const w = await c.env.DB.prepare('SELECT * FROM withdrawals WHERE id = ?').bind(withdrawalId).first<any>();
    if (!w) return c.json({ error: 'Withdrawal not found' }, 404);
    
    if (['PAID', 'REJECTED'].includes(w.status)) {
        return c.json({ error: 'Withdrawal already finalized' }, 400);
    }

    try {
        // Refund logic: Credit wallet back
        // We need to find the wallet. Usually user has 1 EUR wallet.
        const wallet = await c.env.DB.prepare("SELECT id FROM wallets WHERE user_id = ? AND currency = 'EUR'").bind(w.user_id).first<any>();
        
        if (!wallet) return c.json({ error: 'User wallet not found for refund' }, 500);

        await c.env.DB.batch([
            c.env.DB.prepare("UPDATE withdrawals SET status = 'REJECTED' WHERE id = ?").bind(withdrawalId),
            c.env.DB.prepare("UPDATE wallets SET balance = balance + ? WHERE id = ?").bind(w.amount_eur, wallet.id),
            c.env.DB.prepare(`
                INSERT INTO transactions (wallet_id, type, amount, status, external_id, created_at, metadata)
                VALUES (?, 'REFUND', ?, 'COMPLETED', ?, CURRENT_TIMESTAMP, ?)
            `).bind(wallet.id, w.amount_eur, `REF-${withdrawalId}`, JSON.stringify({ reason }))
        ]);

        await audit.log({
            actorType: 'admin',
            actorId: adminId,
            action: 'WITHDRAWAL_REJECTED',
            entity: 'withdrawal',
            entityId: withdrawalId,
            before: JSON.stringify({ status: w.status }),
            after: JSON.stringify({ status: 'REJECTED', reason }),
            ip: c.req.header('CF-Connecting-IP') || 'unknown',
            userAgent: c.req.header('User-Agent')
        });

        return c.json({ success: true });
    } catch (e) {
        console.error(e);
        return c.json({ error: 'Database error' }, 500);
    }
});

admin.post('/leagues/refresh', async (c) => {
    return c.json({ success: true, count: 0 });
});

// GET /api/admin/odds — Painel de Odds: lista todos os eventos com odds
admin.get('/odds', async (c) => {
    try {
        const res = await c.env.DB.prepare(`
            SELECT external_event_id as id, home_team, away_team, league, sport,
                   home_odd, draw_odd, away_odd, is_live, status, event_date, updated_at
            FROM events
            ORDER BY is_live DESC, event_date ASC
            LIMIT 500
        `).all();
        return c.json(res.results || []);
    } catch (err) {
        console.error('[Admin] /odds error:', err);
        return c.json({ events: [] });
    }
});

// POST /api/admin/odds/:id — Override manual de odds
admin.post('/odds/:id', async (c) => {
    try {
        const id = c.req.param('id');
        const body = await c.req.json() as any;
        const home = parseFloat(body.home_odd) || 0;
        const draw = parseFloat(body.draw_odd) || 0;
        const away = parseFloat(body.away_odd) || 0;

        const h2h = JSON.stringify([
            { value: 'Home', odd: String(home) },
            { value: 'Draw', odd: String(draw) },
            { value: 'Away', odd: String(away) },
        ]);

        await c.env.DB.prepare(`
            UPDATE events
            SET home_odd = ?, draw_odd = ?, away_odd = ?,
                markets = json_patch(COALESCE(markets, '{}'), json_object('h2h', json(?)))
            WHERE external_event_id = ? OR CAST(id AS TEXT) = ?
        `).bind(home, draw, away, h2h, id, id).run();

        return c.json({ success: true });
    } catch (err) {
        console.error('[Admin] /odds/:id error:', err);
        return c.json({ error: 'Update failed' }, 500);
    }
});

export default admin;
