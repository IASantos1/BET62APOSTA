import { Hono } from 'hono';
import { Env } from '../shared/types';

const metrics = new Hono<{ Bindings: Env }>();

// GET /api/metrics/users
metrics.get('/users', async (c) => {
  try {
    const userCount = await c.env.DB.prepare('SELECT count(*) as count FROM user').first('count');
    const betCount = await c.env.DB.prepare('SELECT count(*) as count FROM bets').first('count');
    return c.json({
      users: userCount || 0,
      bets: betCount || 0
    });
  } catch (e) {
    return c.json({ users: 0, bets: 0 });
  }
});

// GET /api/metrics/odds
metrics.get('/odds', async (c) => {
  try {
    const eventCount = await c.env.DB.prepare('SELECT count(*) as count FROM events').first('count');
    const oddsCount = await c.env.DB.prepare('SELECT count(*) as count FROM events WHERE home_odd > 0').first('count');
    const liveCount = await c.env.DB.prepare('SELECT count(*) as count FROM events WHERE is_live = 1').first('count');
    return c.json({
      events: eventCount || 0,
      imported_odds: oddsCount || 0,
      live: liveCount || 0,
    });
  } catch (e) {
    return c.json({ events: 0, imported_odds: 0, live: 0 });
  }
});

// GET /api/metrics/api-usage
metrics.get('/api-usage', async (c) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const { results } = await c.env.DB.prepare(`
      SELECT provider, endpoint, count
      FROM api_usage_daily
      WHERE date = ?
      ORDER BY provider, count DESC
    `).bind(today).all();
    
    // Filter out forbidden providers
    const filteredResults = (results || []).filter((r: any) => {
      const p = (r.provider || '').toLowerCase();
      return !p.includes('odds') && !p.includes('sports');
    });

    const total = filteredResults.reduce((acc: number, r: any) => acc + (r.count || 0), 0);

    return c.json({
      date: today,
      total,
      details: filteredResults
    });
  } catch (e) {
    console.error(e);
    return c.json({ date: new Date().toISOString().split('T')[0], total: 0, details: [] });
  }
});

export default metrics;
