
import { D1Database } from '@cloudflare/workers-types';

export interface GoalDetectionResult {
    isGoal: boolean;
    isFrozen: boolean;
    homeScore: number;
    awayScore: number;
}

export async function detectGoal(
  db: D1Database, 
  eventId: number, 
  home: number, 
  away: number 
): Promise<boolean> { 
  try {
      const row: any = await db.prepare(` 
        SELECT home_score, away_score, frozen, updated_at 
        FROM live_event_state 
        WHERE event_id = ? 
      `).bind(eventId).first(); 
    
      if (!row) { 
        await db.prepare(` 
          INSERT INTO live_event_state 
          (event_id, home_score, away_score, frozen, updated_at) 
          VALUES (?, ?, ?, 0, datetime('now')) 
        `).bind(eventId, home, away).run(); 
    
        return false; 
      } 
    
      // Detect score change
      const goal = row.home_score !== home || row.away_score !== away; 
    
      if (goal) { 
        await db.prepare(` 
          UPDATE live_event_state 
          SET home_score = ?, away_score = ?, frozen = 1, 
              updated_at = datetime('now') 
          WHERE event_id = ? 
        `).bind(home, away, eventId).run(); 
        
        return true;
      } 
      
      // Check if we should unfreeze (e.g., after 15 seconds)
      if (row.frozen === 1) {
          const lastUpdate = new Date(row.updated_at + 'Z').getTime(); // Ensure UTC
          const now = Date.now();
          const diffSeconds = (now - lastUpdate) / 1000;
          
          if (diffSeconds > 15) {
              await db.prepare(`
                  UPDATE live_event_state
                  SET frozen = 0
                  WHERE event_id = ?
              `).bind(eventId).run();
              // Note: Caller might need to know it was just unfrozen, 
              // but for now we just update state.
              // We could return 'wasUnfrozen' if needed.
          }
      }
    
      return false; // No new goal
  } catch (err) {
      console.error('Error in detectGoal:', err);
      return false;
  }
}

// Helper to check freeze status without updating score
export async function isEventFrozen(db: D1Database, eventId: number): Promise<boolean> {
    try {
        const row: any = await db.prepare(`
            SELECT frozen FROM live_event_state WHERE event_id = ?
        `).bind(eventId).first();
        return row?.frozen === 1;
    } catch (e) {
        return false;
    }
}
