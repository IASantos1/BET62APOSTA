import { Env } from '../../shared/types';

export async function updateEventStatuses(env: Env) {
    const now = new Date();
    const nowIso = now.toISOString();
    
    // Time threshold for forcing FINISHED status (e.g., 3 hours after start)
    // Adjust based on sport if needed, but 3h is safe for most (Soccer ~2h, NBA ~2.5h)
    const finishThreshold = new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString();

    const updates: any[] = [];
    const logs: string[] = [];

    try {
        // 1. Promote PRE-GAME -> LIVE
        // Criteria: is_live = 0 AND event_date <= NOW AND status is not Finished
        // Added more finished statuses to avoid resurrecting finished games
        const candidates = await env.DB.prepare(`
            SELECT id, payload, event_date, status FROM imported_odds 
            WHERE is_live = 0 
            AND event_date <= ? 
            AND status NOT IN ('FT', 'AET', 'PEN', 'Finished', 'ABD', 'AWD', 'WO', 'Ended', 'Final', 'PST', 'CANC', 'AOT', 'AP')
            LIMIT 50
        `).bind(nowIso).all();

        for (const row of (candidates.results || [])) {
            let event: any;
            try { event = JSON.parse(row.payload as string); } catch { continue; }

            // Double check strict time (string comparison works for ISO)
            if (event.fixture.date > nowIso) continue;

            event.fixture.status.short = 'LIVE'; 
            event.fixture.status.long = 'Live (Time-Triggered)';
            // Don't mess with elapsed if we don't know it, but setting status helps frontend
            
            updates.push(env.DB.prepare(`
                UPDATE imported_odds 
                SET is_live = 1, status = 'LIVE', payload = ?, updated_at = ? 
                WHERE id = ?
            `).bind(JSON.stringify(event), nowIso, row.id));
            
            logs.push(`Promoted ${row.id} (${event.teams?.home?.name} vs ${event.teams?.away?.name}) to LIVE`);
        }

        // 2. Demote LIVE -> FINISHED (Fallback)
        // Criteria: is_live = 1 AND event_date < 5h ago
        // This cleans up "stuck" games
        const stale = await env.DB.prepare(`
            SELECT id, payload, event_date FROM imported_odds 
            WHERE is_live = 1 AND event_date < ?
            LIMIT 50
        `).bind(finishThreshold).all();

        for (const row of (stale.results || [])) {
            let event: any;
            try { event = JSON.parse(row.payload as string); } catch { continue; }

            // Ensure fixture.status is an object
            if (typeof event.fixture.status === 'string') {
                event.fixture.status = { short: event.fixture.status, long: event.fixture.status, elapsed: 90 };
            }
            
            event.fixture.status.short = 'FT';
            event.fixture.status.long = 'Finished (Timeout)';
            event.fixture.status.elapsed = 90;

            updates.push(env.DB.prepare(`
                UPDATE imported_odds 
                SET is_live = 0, status = 'FT', payload = ?, updated_at = ? 
                WHERE id = ?
            `).bind(JSON.stringify(event), nowIso, row.id));
            
            logs.push(`Demoted ${row.id} (${event.teams?.home?.name} vs ${event.teams?.away?.name}) to FINISHED`);
        }

        // 3. Cleanup STALE PRE-GAME -> FINISHED (Safety Net)
        // Criteria: is_live = 0 AND event_date < 3h ago (missed the Live window entirely)
        // This catches events that failed to promote to Live or were ignored
        // Changed from 4h to 3h to align with frontend filtering and user request ("JA PASSOU")
        const staleThreshold = new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString();
        const stalePregame = await env.DB.prepare(`
            SELECT id, payload, event_date FROM imported_odds 
            WHERE is_live = 0 
            AND event_date < ? 
            AND status NOT IN ('FT', 'AET', 'PEN', 'Finished', 'ABD', 'AWD', 'WO', 'Ended', 'Final', 'PST', 'CANC', 'AOT', 'AP')
            LIMIT 50
        `).bind(staleThreshold).all();

        for (const row of (stalePregame.results || [])) {
            let event: any;
            try { event = JSON.parse(row.payload as string); } catch { continue; }

            // Ensure fixture.status is an object
            if (typeof event.fixture.status === 'string') {
                event.fixture.status = { short: event.fixture.status, long: event.fixture.status, elapsed: 90 };
            }
            
            event.fixture.status.short = 'FT';
            event.fixture.status.long = 'Finished (Stale Pre-Game)';
            event.fixture.status.elapsed = 90;

            updates.push(env.DB.prepare(`
                UPDATE imported_odds 
                SET is_live = 0, status = 'FT', payload = ?, updated_at = ? 
                WHERE id = ?
            `).bind(JSON.stringify(event), nowIso, row.id));
            
            logs.push(`Cleaned up Stale Pre-Game ${row.id} (${event.teams?.home?.name} vs ${event.teams?.away?.name})`);
        }

        if (updates.length > 0) {
            // Batch execution
            // Split into chunks of 10 to be safe
            const chunkSize = 10;
            for (let i = 0; i < updates.length; i += chunkSize) {
                await env.DB.batch(updates.slice(i, i + chunkSize));
            }
        }

        return { success: true, updates: updates.length, logs };

    } catch (e: any) {
        console.error('[EventStatus] Error:', e);
        return { success: false, error: e.message };
    }
}
