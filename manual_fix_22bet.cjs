const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Set env var for local wrangler
process.env.WRANGLER_HOME = ".\\.wrangler_local";

const EVENT_ID = '22bet_698449049';

try {
    console.log(`Fetching payload for ${EVENT_ID}...`);
    // Fetch payload using wrangler
    // Note: We need to be careful with JSON parsing of command output
    const cmd = `npx wrangler d1 execute bet62-db --local --command "SELECT payload FROM imported_odds WHERE external_event_id = '${EVENT_ID}'" --json`;
    const output = execSync(cmd, { encoding: 'utf-8' });
    
    // Wrangler output might contain logs, find the JSON array
    const jsonStart = output.indexOf('[');
    const jsonEnd = output.lastIndexOf(']');
    if (jsonStart === -1 || jsonEnd === -1) {
        throw new Error('Could not parse JSON output from wrangler');
    }
    
    const jsonStr = output.substring(jsonStart, jsonEnd + 1);
    const rows = JSON.parse(jsonStr);
    
    if (rows.length === 0 || !rows[0].payload) {
        console.log('No payload found for this event.');
        process.exit(1);
    }
    
    const payload = JSON.parse(rows[0].payload);
    console.log('Payload fetched successfully.');
    
    // --- LOGIC FROM eventSync.ts (Simplified for this script) ---
    let h = 0, d = 0, a = 0;
    
    // 1. Try generic 'odds' object (e.g. from scraping)
    if (h === 0 && a === 0 && payload.odds && typeof payload.odds === 'object' && !Array.isArray(payload.odds)) {
        const marketKey = Object.keys(payload.odds).find(k => k.includes('winner') || k.includes('1x2') || k.includes('h2h'));
        if (marketKey && payload.odds[marketKey]) {
            let outcomes = null;
            const mData = payload.odds[marketKey];
            if (Array.isArray(mData)) {
                outcomes = mData;
            } else if (mData && Array.isArray(mData.outcomes)) {
                outcomes = mData.outcomes;
            }

            if (outcomes) {
                outcomes.forEach((o) => {
                    const val = String(o.outcome || o.name || '').toLowerCase();
                    const odd = Number(o.value || o.price || o.odd || 0);
                    // normalize
                    const homeName = (payload.home_team || '').toLowerCase();
                    const awayName = (payload.away_team || '').toLowerCase();

                    if (['1', 'home', 'casa', 'v1'].includes(val) || val === homeName) h = odd;
                    else if (['x', 'draw', 'tie', 'empate'].includes(val)) d = odd;
                    else if (['2', 'away', 'fora', 'v2', 'visitante'].includes(val) || val === awayName) a = odd;
                });
            }
        }
    }

    // 2. Fallback flattened odds (Legacy)
    // FIX: Use 'if' instead of 'else if' to ensure it runs if odds are still 0
    if (h === 0 && a === 0 && (payload.home_odd || (payload.odds && payload.odds.home_odd))) {
        // Handle flat odds structure
        h = Number(payload.home_odd || (payload.odds && payload.odds.home_odd) || 0);
        d = Number(payload.draw_odd || (payload.odds && payload.odds.draw_odd) || 0);
        a = Number(payload.away_odd || (payload.odds && payload.odds.away_odd) || 0);
    }
    
    console.log(`Extracted Odds: Home=${h}, Draw=${d}, Away=${a}`);
    
    if (h === 0 && a === 0) {
        console.log('Still no odds extracted. Aborting update.');
        process.exit(1);
    }
    
    // Construct UPDATE query
    const updateCmd = `UPDATE events SET home_odd = ${h}, draw_odd = ${d}, away_odd = ${a}, updated_at = '${new Date().toISOString()}' WHERE external_event_id = '${EVENT_ID}'`;
    console.log(`Executing SQL: ${updateCmd}`);
    
    // Execute UPDATE
    execSync(`npx wrangler d1 execute bet62-db --local --command "${updateCmd}"`, { stdio: 'inherit' });
    console.log('Update executed successfully.');
    
} catch (e) {
    console.error('Error:', e.message);
    if (e.stderr) console.error('Stderr:', e.stderr.toString());
    process.exit(1);
}
