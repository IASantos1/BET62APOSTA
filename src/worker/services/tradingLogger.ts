
import { Env } from '../../shared/types';

export class TradingLogger {
  private env: Env;

  constructor(env: Env) {
    this.env = env;
  }

  /**
   * Logs trading activity to the database (trading_logs table).
   * This is persistent and queryable via the Admin UI.
   */
  async log({
    type,
    sport,
    league,
    match,
    odds,
    status,
    details
  }: {
    type: string;
    sport: string;
    league?: string;
    match?: string;
    odds?: any;
    status?: string;
    details?: string;
  }) {
    try {
      const timestamp = new Date().toISOString();
      const oddsStr = odds ? JSON.stringify(odds) : null;
      
      // In a real Worker, we might want to use a specific logging service or just console.log 
      // which is captured by Cloudflare Logs.
      // But for the requirement "tradingLogger.js – Logs detalhados", we'll persist to DB.
      
      // Ensure table exists (best effort, assuming migration ran)
      // CREATE TABLE IF NOT EXISTS trading_logs (id INTEGER PRIMARY KEY, type TEXT, sport TEXT, league TEXT, match TEXT, odds TEXT, status TEXT, details TEXT, created_at DATETIME);

      await this.env.DB.prepare(`
        INSERT INTO trading_logs (type, sport, league, match, odds, status, details, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        type, 
        sport, 
        league || null, 
        match || null, 
        oddsStr, 
        status || null, 
        details || null,
        timestamp
      ).run();

      console.log(`[TradingLogger] [${type}] ${sport} - ${match || 'N/A'} (${status || '-'})`);

    } catch (e: any) {
      // Fallback to console if DB fails
      console.error('[TradingLogger] Failed to persist log:', e.message, { type, sport, match });
    }
  }

  /**
   * Retrieves recent logs for display in the admin panel.
   */
  async getRecentLogs(limit = 100) {
    try {
      const { results } = await this.env.DB.prepare(`
        SELECT * FROM trading_logs ORDER BY created_at DESC LIMIT ?
      `).bind(limit).all();
      return results || [];
    } catch (e) {
      console.error('[TradingLogger] Failed to fetch logs', e);
      return [];
    }
  }
}
