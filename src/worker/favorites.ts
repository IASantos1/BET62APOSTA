import { Hono } from 'hono';
import { Env } from '../shared/types';
import { verifyAuth } from './middleware/jwtAuth';
import { ensureUserSchema } from './db';

type Variables = {
    user: {
        userId: string;
    }
};

const favorites = new Hono<{ Bindings: Env; Variables: Variables }>();

favorites.use('*', verifyAuth);

// GET /api/favorites
favorites.get('/', async (c) => {
    try {
        await ensureUserSchema(c.env.DB);
        const userId = c.get('user').userId;

        const { results } = await c.env.DB.prepare(
            'SELECT event_id FROM user_favorites WHERE user_id = ? ORDER BY created_at DESC'
        ).bind(userId).all();

        return c.json(results || []);
    } catch (e: any) {
        console.error('Error fetching favorites:', e);
        return c.json({ error: 'Failed to fetch favorites' }, 500);
    }
});

// POST /api/favorites
favorites.post('/', async (c) => {
    try {
        await ensureUserSchema(c.env.DB);
        const userId = c.get('user').userId;

        const { event_id } = await c.req.json();
        if (!event_id) return c.json({ error: 'Event ID required' }, 400);

        await c.env.DB.prepare(
            'INSERT OR IGNORE INTO user_favorites (user_id, event_id) VALUES (?, ?)'
        ).bind(userId, event_id).run();

        return c.json({ success: true });
    } catch (e: any) {
        console.error('Error adding favorite:', e);
        return c.json({ error: 'Failed to add favorite' }, 500);
    }
});

// DELETE /api/favorites/:eventId
favorites.delete('/:eventId', async (c) => {
    try {
        await ensureUserSchema(c.env.DB);
        const userId = c.get('user').userId;

        const eventId = c.req.param('eventId');
        if (!eventId) return c.json({ error: 'Event ID required' }, 400);

        await c.env.DB.prepare(
            'DELETE FROM user_favorites WHERE user_id = ? AND event_id = ?'
        ).bind(userId, eventId).run();

        return c.json({ success: true });
    } catch (e: any) {
        console.error('Error removing favorite:', e);
        return c.json({ error: 'Failed to remove favorite' }, 500);
    }
});

export default favorites;
