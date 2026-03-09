import { D1Database } from '@cloudflare/workers-types';
import { updateSharpScore, getUserProfile } from './sharpDetection';
import { LedgerService } from './ledger';
import { AuditService } from './audit';

interface SettlementBet {
    id: number;
    user_id: string;
    event_id: string | number;
    selection: string;
    stake: number;
    odd: number;
    potential_win: number;
    status: string;
    type?: string;
}

// Helper to determine bet result
function calculateBetResult(bet: any, event: any): 'won' | 'lost' | 'void' | 'pending' {
    if (!event || !event.fixture || !['FT', 'AET', 'PEN'].includes(event.fixture.status)) {
        return 'pending';
    }

    const homeGoals = event.fixture.goals.home;
    const awayGoals = event.fixture.goals.away;

    if (homeGoals === null || awayGoals === null) return 'pending';

    // Parse selection and market
    // This is a simplified settlement logic. 
    // real-world requires strict parsing of market types.
    
    // H2H (Match Winner)
    // Selection is usually 'Home', 'Draw', 'Away' or Team Names
    // We need to map selection to outcome
    
    // Normalize selection
    const selection = bet.selection; // "Home", "Away", "Draw" or Team Name
    const marketType = 'h2h'; // Defaulting to H2H for now as per simple implementation
    
    // In a real system, bet would store market_type. 
    // We'll infer from the selection string for this demo or assume H2H/Totals
    
    if (selection === 'Home' || selection === event.fixture.home_team) {
        return homeGoals > awayGoals ? 'won' : 'lost';
    }
    if (selection === 'Away' || selection === event.fixture.away_team) {
        return awayGoals > homeGoals ? 'won' : 'lost';
    }
    if (selection === 'Draw' || selection === 'Empate') {
        return homeGoals === awayGoals ? 'won' : 'lost';
    }

    // Totals (Over/Under 2.5)
    // Selection ex: "Over 2.5", "Under 2.5"
    if (selection.includes('Over') || selection.includes('Mais de')) {
        const line = parseFloat(selection.match(/[\d.]+/)[0]);
        return (homeGoals + awayGoals) > line ? 'won' : 'lost';
    }
    if (selection.includes('Under') || selection.includes('Menos de')) {
        const line = parseFloat(selection.match(/[\d.]+/)[0]);
        return (homeGoals + awayGoals) < line ? 'won' : 'lost';
    }

    return 'void'; // Fallback
}

export async function processSettlements(db: D1Database) {
    console.log('[Settlement] Starting settlement job...');
    
    // 1. Get Pending Bets
    const { results } = await db.prepare(`
        SELECT * FROM bets WHERE status = 'pending' LIMIT 100
    `).all();
    
    const bets = results as unknown as SettlementBet[];

    if (!bets || bets.length === 0) return;

    let settledCount = 0;
    const audit = new AuditService(db);
    const ledger = new LedgerService(db, audit);

    for (const bet of bets) {
        let result: 'won' | 'lost' | 'void' | 'pending' = 'pending';

        if (bet.type === 'multi') {
            // Handle Multiple
            const { results: selections } = await db.prepare('SELECT * FROM bet_selections WHERE bet_id = ?').bind(bet.id).all();
            
            if (!selections || selections.length === 0) {
                 // Should not happen, but treat as void or ignore
                 continue; 
            }

            let anyLost = false;
            let anyPending = false;
            // let allWon = true; // Implicit if !anyLost && !anyPending

            for (const sel of selections as any[]) {
                 // Check if individual selection is already settled (optimization)
                 if (sel.status === 'lost') {
                     anyLost = true;
                     break; // Fast fail
                 }
                 if (sel.status === 'won' || sel.status === 'void') {
                     continue;
                 }

                 const eventRecord = await db.prepare('SELECT payload FROM imported_odds WHERE id = ?').bind(sel.event_id).first();
                 if (!eventRecord) {
                     anyPending = true;
                     continue;
                 }
                 const event = JSON.parse(eventRecord.payload as string);
                 
                 // Reuse calculateBetResult but pass selection specific data
                 const selResult = calculateBetResult({ selection: sel.selection }, event);
                 
                 if (selResult === 'pending') {
                     anyPending = true;
                 } else {
                     // Update selection status
                     await db.prepare('UPDATE bet_selections SET status = ? WHERE id = ?').bind(selResult, sel.id).run();
                     if (selResult === 'lost') anyLost = true;
                 }
            }
            
            if (anyLost) result = 'lost';
            else if (anyPending) result = 'pending';
            else result = 'won'; // All settled and none lost

        } else {
            // Handle Single
            const eventRecord = await db.prepare('SELECT payload FROM imported_odds WHERE id = ?').bind(bet.event_id).first();
            if (!eventRecord) continue;

            const event = JSON.parse(eventRecord.payload as string);
            result = calculateBetResult(bet, event);
            
            // Also update the single entry in bet_selections if it exists (for consistency)
             await db.prepare('UPDATE bet_selections SET status = ? WHERE bet_id = ?').bind(result, bet.id).run().catch(() => {});
        }
        
        if (result !== 'pending') {
            // Settle
            const payout = result === 'won' ? (bet.potential_win || bet.stake * bet.odd) : 0;
            
            // Tier-1: Ledger Credit
            if (result === 'won' && payout > 0) {
                 const wallet = await db.prepare('SELECT id FROM wallets WHERE user_id = ?').bind(bet.user_id).first();
                 if (wallet) {
                     await ledger.addTransaction(
                         (wallet as any).id,
                         'credit',
                         payout,
                         `WIN:${bet.id}`,
                         'Bet Win',
                         { actorId: 'system', ip: 'settlement-job' }
                     );
                 }
            }
            
            // Update Bet Status
            await db.prepare('UPDATE bets SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
                  .bind(result, bet.id).run();
            
            settledCount++;
        }
    }

    console.log(`[Settlement] Settled ${settledCount} bets.`);
}

export async function processAnalysis(db: D1Database) {
    console.log('[Analysis] Starting CLV analysis...');

    // 1. Get Settled Bets that are NOT in bet_analysis
    const { results } = await db.prepare(`
        SELECT b.* 
        FROM bets b
        LEFT JOIN bet_analysis ba ON b.id = ba.bet_id
        WHERE b.status IN ('won', 'lost') 
        AND ba.bet_id IS NULL
        LIMIT 50
    `).all();

    const bets = results as unknown as SettlementBet[];

    if (!bets || bets.length === 0) return;

    for (const bet of bets) {
        if (bet.type === 'multi' || bet.event_id === 0) continue; // Skip multiples for now

        // Get Event Final State (Closing Line)
        const eventRecord = await db.prepare('SELECT payload FROM imported_odds WHERE id = ?').bind(bet.event_id).first();
        if (!eventRecord) continue;

        const event = JSON.parse(eventRecord.payload as string);
        
        // Find Closing Odd
        // We look for the same selection in the final payload
        let closingOdd = 0;
        
        // Traverse markets to find matching selection
        // This relies on 'h2h' etc being present in the payload
        if (event.odds) {
             for (const k in event.odds) {
                 const market = event.odds[k];
                 // Assuming standard format { outcomes: [{outcome: 'Home', value: 1.5}, ...] }
                 if (market.outcomes) {
                     const match = market.outcomes.find((o: any) => o.outcome === bet.selection);
                     if (match) {
                         closingOdd = Number(match.value);
                         break;
                     }
                 }
             }
        }

        // If we can't find it, we skip analysis or assume 1.0
        if (closingOdd <= 1) continue;

        // Calculate CLV
        // beat_closing = 1 if user odd > closing odd
        const beatClosing = bet.odd > closingOdd ? 1 : 0;

        // Insert Analysis
        await db.prepare(`
            INSERT INTO bet_analysis (bet_id, user_id, market_id, odd, closing_odd, beat_closing)
            VALUES (?, ?, ?, ?, ?, ?)
        `).bind(bet.id, bet.user_id, bet.event_id, bet.odd, closingOdd, beatClosing).run();

        // Update User Sharp Score
        const profile = await getUserProfile(db, bet.user_id);
        const newScore = updateSharpScore(profile, {
            beat_closing: beatClosing,
            odd: bet.odd
        });

        // Save Score
        await db.prepare(`
            INSERT INTO user_profile (user_id, sharp_score, bets, wins)
            VALUES (?, ?, 1, ?)
            ON CONFLICT(user_id) DO UPDATE SET
                sharp_score = ?,
                bets = bets + 1,
                wins = wins + ?
        `).bind(
            bet.user_id, 
            newScore, 
            bet.status === 'won' ? 1 : 0,
            newScore,
            bet.status === 'won' ? 1 : 0
        ).run();
    }
    
    console.log(`[Analysis] Analyzed ${bets.length} bets.`);
}
