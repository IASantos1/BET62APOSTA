import { Env } from '../shared/types';
import { processWithdrawals } from './jobs';
import { processSettlements } from './services/settlement';
import { EventSyncService } from './services/eventSync';
import { AdaptivePollingService } from './services/adaptivePolling';
import { runRobustIntegration } from './services/robustIntegration';

const ensureCronLockTable = async (db: D1Database) => {
    await db.prepare('CREATE TABLE IF NOT EXISTS cron_lock (id INTEGER PRIMARY KEY, locked INTEGER, last_run DATETIME)').run().catch(() => { /* empty */ });
};

const acquireLock = async (db: D1Database, lockId: number) => {
    await ensureCronLockTable(db);
    // Ensure row exists
    await db.prepare('INSERT OR IGNORE INTO cron_lock (id, locked, last_run) VALUES (?, 0, CURRENT_TIMESTAMP)').bind(lockId).run().catch(() => { /* empty */ });
    
    // Atomic Acquire
    const res = await db.prepare('UPDATE cron_lock SET locked = 1, last_run = CURRENT_TIMESTAMP WHERE id = ? AND locked = 0').bind(lockId).run();
    
    if (res.meta.changes > 0) {
        return true; // Acquired
    }

    // If we are here, it was already locked. Check for staleness.
    const lock = await db.prepare('SELECT locked, last_run FROM cron_lock WHERE id = ?').bind(lockId).first<{locked: number, last_run: string}>();
    if (lock && lock.locked === 1) {
       const lastRun = new Date(lock.last_run).getTime();
       // 2 min timeout for Live Loop (id=1), 15 min for Sync (id=2/3)
       const timeout = lockId === 1 ? 120000 : 900000;
       if (Date.now() - lastRun > timeout) {
           console.log(`[Lock] Lock ${lockId} stale. Forcing acquire.`);
           // Force acquire
           await db.prepare('UPDATE cron_lock SET locked = 1, last_run = CURRENT_TIMESTAMP WHERE id = ?').bind(lockId).run();
           return true;
       }
    }
    
    return false; // Locked
};

const releaseLock = async (db: D1Database, lockId: number) => {
    await db.prepare('UPDATE cron_lock SET locked = 0 WHERE id = ?').bind(lockId).run();
};

export default {
  // Dummy fetch to satisfy Cloudflare Worker requirements if needed, or for health checks
  fetch: async (request: Request, env: Env, ctx: ExecutionContext) => {
      return new Response("Scheduler Worker Active", { status: 200 });
  },

  scheduled: async (event: ScheduledEvent, env: Env, ctx: ExecutionContext) => {
    console.log('[Scheduler] Triggered:', event.cron);
    
    // Cron Patterns
    const CRON_DAILY = "0 0 * * *";
    const CRON_10MIN = "*/10 * * * *";
    const CRON_5MIN = "*/5 * * * *";
    const CRON_1MIN = "* * * * *";
    
    // Define sports to sync
    const sportsToSync = [
      'soccer', 'basketball', 'tennis', 'hockey', 'volleyball', 
      'handball', 'baseball', 'rugby', 'american-football', 'mma', 'formula-1', 'boxing'
    ];

    const syncService = new EventSyncService(env);
    
    // 1. Daily: Fetch Sports List & Cleanup
    if (event.cron === CRON_DAILY) {
        console.log('[Scheduler] Daily execution started');
        
        let deletedImported = 0;
        let deletedEvents = 0;
        let deletedUpdates = 0;

        console.log('[Scheduler] Cleaning up old data...');
        try {
            // 1. Cleanup Imported Odds (Keep events with PENDING bets)
                const di = await env.DB.prepare(`
                    DELETE FROM imported_odds 
                    WHERE event_date < date('now', '-1 days') 
                    AND id NOT IN (SELECT event_id FROM bets WHERE status = 'pending')
                `).run();

                // 2. Cleanup Events (Keep events with PENDING bets)
                const de = await env.DB.prepare(`
                    DELETE FROM events 
                    WHERE event_date < date('now', '-1 days')
                    AND external_event_id NOT IN (SELECT event_id FROM bets WHERE status = 'pending')
                `).run();
                
                const du = await env.DB.prepare("DELETE FROM event_updates WHERE created_at < datetime('now', '-2 hours')").run();

            deletedImported = di.meta.changes || 0;
            deletedEvents = de.meta.changes || 0;
            deletedUpdates = du.meta.changes || 0;

            console.log(`[Scheduler] Daily cleanup finished. Deleted: ${deletedImported} odds, ${deletedEvents} events, ${deletedUpdates} updates.`);

        } catch (e: any) {
            console.error('[Scheduler] Cleanup failed:', e);
        }
    }
    
    // 2. 10 Min: Robust Integration (Odds Sync)
    if (event.cron === CRON_DAILY) {
         console.log('[Scheduler] Running Robust Integration (daily window)...');
         ctx.waitUntil(runRobustIntegration(env, { sports: sportsToSync, days: 7 }).catch(err => console.error('[Scheduler] Robust Sync Error:', err)));
    } else if (event.cron === CRON_10MIN || !event.cron) {
         console.log('[Scheduler] Running Robust Integration (short window)...');
         ctx.waitUntil(runRobustIntegration(env, { sports: sportsToSync, days: 1 }).catch(err => console.error('[Scheduler] Robust Sync Error:', err)));
    }

    // 3. 5 Min: Process Withdrawals & Settlements
    if (event.cron === CRON_5MIN || event.cron === CRON_DAILY || !event.cron) {
        // Run Withdrawal Processing (Tier-1 Job)
        ctx.waitUntil(processWithdrawals(env).catch(console.error));

        // Lock ID 3 for Settlements
        if (await acquireLock(env.DB, 3)) {
            try {
                await processSettlements(env.DB);
            } catch (e: any) {
                console.error('[Scheduler] Settlement Error:', e);
            } finally {
                await releaseLock(env.DB, 3);
            }
        } else {
             console.log('[Scheduler] Settlements (Lock 3) locked. Skipping.');
        }
    }

    // 4. 1 Min: Adaptive Polling (Heartbeat) & Event Sync
    if (event.cron === CRON_1MIN || !event.cron) {
        console.log('[Scheduler] Running Adaptive Polling & Sync (1 min)...');
        
        // A. Run Event Sync (Imported -> Events)
        // This ensures new events from RobustIntegration are visible to Polling & Frontend
        ctx.waitUntil(syncService.syncEventsFromImported().catch(err => console.error('[Scheduler] Event Sync Error:', err)));

        // B. Run Adaptive Polling
        const pollingService = new AdaptivePollingService(env);
        
        // Run immediately (T+0s)
        ctx.waitUntil(pollingService.run().catch(err => console.error('[Scheduler] Adaptive Polling Error (0s):', err)));

        // Run again at T+30s for Live events (simulated sub-minute interval)
        // Note: In a separate worker, this blocking wait is less critical than in the WS worker,
        // but it still consumes an invocation duration. 
        ctx.waitUntil(new Promise<void>(resolve => {
            setTimeout(async () => {
                try {
                    console.log('[Scheduler] Adaptive Polling (30s mark)...');
                    await pollingService.run();
                } catch (e) {
                    console.error('[Scheduler] Adaptive Polling Error (30s):', e);
                }
                resolve();
            }, 30000);
        }));
    }
  }
};
