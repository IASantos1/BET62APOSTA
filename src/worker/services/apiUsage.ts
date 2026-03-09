import { Env } from '../../shared/types';

export const trackApiUsage = async (env: Env, provider: string, endpoint: string) => {
  const date = new Date().toISOString().split('T')[0];
  try {
    await env.DB.prepare(`
      INSERT INTO api_usage_daily (date, provider, endpoint, count)
      VALUES (?, ?, ?, 1)
      ON CONFLICT(date, provider, endpoint) DO UPDATE SET
        count = count + 1,
        updated_at = CURRENT_TIMESTAMP
    `)
      .bind(date, provider, endpoint)
      .run();
  } catch (e) {
    console.error('[API Usage] Failed to track usage:', e);
  }
};

