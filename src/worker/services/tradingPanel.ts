
import { Env } from '../../shared/types';
import { TradingLogger } from './tradingLogger';

/**
 * Core Trading Logic
 * Manages event lifecycle: Fixture -> Odds -> Published -> Live -> Settled
 */
export class TradingPanel {
  private env: Env;
  private logger: TradingLogger;

  constructor(env: Env) {
    this.env = env;
    this.logger = new TradingLogger(env);
  }

  /**
   * Registers or updates a fixture (event metadata)
   */
  async registerEvent(event: {
    id: string;
    sport: string;
    league: string;
    home: string;
    away: string;
    date: string;
    status?: string;
  }) {
    const gameKey = event.id;
    const initialStatus = 'PENDING';

    try {
        // Upsert Event
        // We use the existing 'events' table structure but ensure we track it as managed by TradingPanel
        // Assuming 'events' table has: id, sport, league, home_team, away_team, event_date, status
        
        await this.env.DB.prepare(`
            INSERT INTO events (id, sport, league, home_team, away_team, event_date, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
            ON CONFLICT(id) DO UPDATE SET
                sport = excluded.sport,
                league = excluded.league,
                home_team = excluded.home_team,
                away_team = excluded.away_team,
                event_date = excluded.event_date,
                updated_at = datetime('now')
                -- We don't overwrite status blindly if it's already active/live
        `).bind(
            event.id,
            event.sport,
            event.league,
            event.home,
            event.away,
            event.date,
            initialStatus
        ).run();

        await this.logger.log({
            type: 'FIXTURE_REGISTERED',
            sport: event.sport,
            league: event.league,
            match: `${event.home} vs ${event.away}`,
            status: initialStatus,
            details: `ID: ${event.id}`
        });

    } catch (e: any) {
        console.error('[TradingPanel] registerEvent error:', e);
    }
  }

  /**
   * Updates odds for an event (Pre-match)
   * Applies house margin automatically.
   */
  async updateOddsFromApi({ 
    id, 
    odds, 
    margin = 0.07 
  }: { 
    id: string; 
    odds: { home: number; draw?: number; away: number }; 
    margin?: number;
  }) {
    try {
        // 1. Calculate House Odds
        const houseOdds = this.applyMargin(odds, margin);

        // 2. Update DB
        // Assuming events table has home_odd, draw_odd, away_odd
        await this.env.DB.prepare(`
            UPDATE events 
            SET 
                home_odd = ?, 
                draw_odd = ?, 
                away_odd = ?,
                status = CASE WHEN status = 'PENDING' THEN 'PUBLISHED' ELSE status END,
                updated_at = datetime('now')
            WHERE id = ?
        `).bind(
            houseOdds.home,
            houseOdds.draw || null,
            houseOdds.away,
            id
        ).run();

        await this.logger.log({
            type: 'ODDS_UPDATE',
            sport: 'unknown', // In a real scenario we'd fetch the event to know the sport, or pass it in
            match: id,
            odds: houseOdds,
            status: 'PUBLISHED',
            details: `Margin: ${margin * 100}%`
        });

        return houseOdds;

    } catch (e: any) {
        console.error('[TradingPanel] updateOddsFromApi error:', e);
        return null;
    }
  }

  /**
   * Updates Live Odds
   */
  async updateLiveOdds({ 
    id, 
    odds, 
    margin = 0.07 // Standardized margin (Overround 1.07)
  }: { 
    id: string; 
    odds: { home: number; draw?: number; away: number }; 
    margin?: number;
  }) {
     try {
        const houseOdds = this.applyMargin(odds, margin);

        await this.env.DB.prepare(`
            UPDATE events 
            SET 
                home_odd = ?, 
                draw_odd = ?, 
                away_odd = ?,
                status = 'LIVE',
                updated_at = datetime('now')
            WHERE id = ?
        `).bind(
            houseOdds.home,
            houseOdds.draw || null,
            houseOdds.away,
            id
        ).run();

        await this.logger.log({
            type: 'LIVE_ODDS_UPDATE',
            sport: 'unknown',
            match: id,
            odds: houseOdds,
            status: 'LIVE'
        });

        return houseOdds;
     } catch (e: any) {
         console.error('[TradingPanel] updateLiveOdds error:', e);
         return null;
     }
  }

  /**
   * Helper: Apply Home Advantage (Mando de Campo)
   * Boosts Home team probability and penalizes Away team.
   * Default: +10% Home, -5% Away (User Config).
   */
  public applyHomeAdvantage(odds: { home?: number; draw?: number; away?: number }, boost: number = 0.10) {
      if (!odds.home || !odds.away) return odds;

      let pH = 1 / odds.home;
      let pA = 1 / odds.away;
      let pD = odds.draw ? (1 / odds.draw) : 0;
      
      // Normalize to 100% first
      const baseSum = pH + pA + pD;
      pH = pH / baseSum;
      pA = pA / baseSum;
      pD = pD / baseSum;

      // Apply Boost
      const awayDisadvantage = 0.05; // 5%
      
      pH += boost;
      pA = Math.max(0.01, pA - awayDisadvantage);
      // Draw absorbs remaining or we re-normalize
      
      // Re-normalize to 100%
      const newSum = pH + pA + pD;
      pH = pH / newSum;
      pA = pA / newSum;
      pD = pD / newSum;
      
      // Re-calculate
      const newOdds: any = { ...odds };
      newOdds.home = parseFloat((1 / pH).toFixed(2));
      newOdds.away = parseFloat((1 / pA).toFixed(2));
      if (odds.draw) newOdds.draw = parseFloat((1 / pD).toFixed(2));
      
      return newOdds;
  }

  /**
   * Helper: Apply Safe Limits (Sanity Checks)
   * Enforces min/max odds for favorites/underdogs.
   */
  public applySafeLimits(odds: { home?: number; draw?: number; away?: number }, isHomeFavoritePre: boolean, isAwayUnderdogPre: boolean) {
       const result: any = { ...odds };
       
       // Rule: "Favorito claro em casa NUNCA pode ter odd maior que 1.60"
       if (isHomeFavoritePre && result.home && result.home > 1.60) {
           result.home = 1.60;
       }
       
       // Rule: "Azarão fora NUNCA menor que 4.50"
       if (isAwayUnderdogPre && result.away && result.away < 4.50) {
           result.away = 4.50;
       }
       
       return result;
  }

  /**
   * Helper: Apply Margin (Overround Normalization)
   * Ensures Sum(1/Odd) = Target Overround (e.g. 1.07)
   */
  public applyMargin(odds: { [key: string]: number | undefined }, margin: number) {
      const result: any = {};
      
      // Check if we have a full set to normalize properly
      const hasH2H = odds.home && odds.away; 
      
      if (hasH2H) {
          // Advanced Normalization (Probability based)
          let pH = 1 / (odds.home as number);
          let pA = 1 / (odds.away as number);
          let pD = odds.draw ? (1 / (odds.draw as number)) : 0;
          
          // 1. Normalize to 100%
          const sum = pH + pA + pD;
          pH = pH / sum;
          pA = pA / sum;
          pD = pD / sum;

          // 2. Sanity Check (Draw > 40%)
          // If market is broken, reconstruct it
          if (pD > 0.40) {
              const forcedDraw = 0.26;
              const ratio = pH / (pH + pA);
              pD = forcedDraw;
              const remaining = 1 - pD;
              pH = remaining * ratio;
              pA = remaining * (1 - ratio);
          }

          // 3. Apply Target Overround
          const targetOverround = 1 + margin; 
          
          result.home = parseFloat((1 / (pH * targetOverround)).toFixed(2));
          result.away = parseFloat((1 / (pA * targetOverround)).toFixed(2));
          if (odds.draw) {
              result.draw = parseFloat((1 / (pD * targetOverround)).toFixed(2));
          }
          
          // Copy non-numeric or invalid
          for (const [key, value] of Object.entries(odds)) {
             if (key !== 'home' && key !== 'away' && key !== 'draw') result[key] = value;
          }
          
      } else {
          // Fallback to simple reduction
          for (const [key, value] of Object.entries(odds)) {
              if (typeof value === 'number' && value > 1) {
                  result[key] = parseFloat((value * (1 - margin)).toFixed(2));
              } else {
                  result[key] = value;
              }
          }
      }

      return result;
  }
}
