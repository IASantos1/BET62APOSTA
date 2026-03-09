import { Hono } from 'hono';
import { Env } from '../shared/types';
import { verifyAuth } from './middleware/jwtAuth';
import { checkSelfExclusion } from './middleware/selfExclusion';

type Variables = {
    user: {
        userId: string;
    }
};

const promotions = new Hono<{ Bindings: Env; Variables: Variables }>();

promotions.use('*', verifyAuth);

promotions.use('/redeem', checkSelfExclusion);

promotions.get('/freebets', async (c) => {
    const userId = c.get('user').userId;
    const now = new Date().toISOString();

    const existing = await c.env.DB.prepare(`
        SELECT id FROM user_freebets 
        WHERE user_id = ? AND source = ?
        LIMIT 1
    `).bind(userId, 'WELCOME_20_4').first();

    if (!existing) {
        const firstDeposit = await c.env.DB.prepare(`
            SELECT created_at FROM deposits 
            WHERE user_id = ? AND status = 'PAID' AND amount_eur >= 20 
            ORDER BY created_at ASC 
            LIMIT 1
        `).bind(userId).first<{ created_at: string }>();

        if (firstDeposit && firstDeposit.created_at) {
            const betCountRow = await c.env.DB.prepare(`
                SELECT COUNT(*) as cnt 
                FROM bets 
                WHERE user_id = ? AND created_at >= ?
            `).bind(userId, firstDeposit.created_at).first<{ cnt: number }>();

            const cnt = betCountRow && typeof betCountRow.cnt === 'number' ? betCountRow.cnt : 0;

            if (cnt >= 4) {
                const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
                const id = crypto.randomUUID();
                await c.env.DB.prepare(`
                    INSERT INTO user_freebets (id, user_id, amount_eur, source, used, expires_at)
                    VALUES (?, ?, ?, ?, 0, ?)
                `).bind(id, userId, 10, 'WELCOME_20_4', expiresAt).run();
            }
        }
    }

    const row = await c.env.DB.prepare(`
        SELECT COALESCE(SUM(amount_eur), 0) as amount_eur 
        FROM user_freebets 
        WHERE user_id = ? AND used = 0 AND expires_at > ?
    `).bind(userId, now).first<{ amount_eur: number }>();

    const amount = row && typeof row.amount_eur === 'number' ? row.amount_eur : 0;
    return c.json({ amount_eur: amount });
});

promotions.post('/redeem', async (c) => {
    const { code } = await c.req.json();
    return c.json({ error: 'Invalid code' }, 400); 
});

export default promotions;
