
import { D1Database } from '@cloudflare/workers-types';

export interface MarketOutcome {
    label: string;
    odd: number;
    name?: string;
    id?: string;
}

export async function balanceMarket(
    db: D1Database, 
    marketUniqueId: string, 
    currentOdds: MarketOutcome[]
): Promise<MarketOutcome[]> {
    // 1. Get Exposures
    const exposures = await db.prepare(`
        SELECT outcome, exposure, max_exposure 
        FROM outcome_exposure 
        WHERE market_unique_id = ?
    `).bind(marketUniqueId).all();
    
    const exposureMap = new Map<string, number>();
    let maxExposureLimit = 10000;
    
    if (exposures.results) {
        for (const row of exposures.results) {
            const outcomeName = String(row.outcome);
            const exposure = Number(row.exposure);
            exposureMap.set(outcomeName, exposure);
            if (row.max_exposure) maxExposureLimit = Number(row.max_exposure);
        }
    }

    // 2. Adjust Odds based on Imbalance
    let newOdds = currentOdds.map(outcome => {
        // Try matching by label or name
        const key = outcome.label || outcome.name || '';
        const exposure = exposureMap.get(key) || 0;
        
        const imbalance = exposure / maxExposureLimit;
        let adjustmentFactor = 1.0;
        
        // Rules
        if (imbalance > 0.9) {
            adjustmentFactor = 0.90; // Strong drop
        } else if (imbalance > 0.7) {
            adjustmentFactor = 0.95; // Moderate drop
        } else if (imbalance < 0.2) {
            adjustmentFactor = 1.05; // Increase to attract bets
        }
        
        return {
            ...outcome,
            odd: Number((outcome.odd * adjustmentFactor).toFixed(2))
        };
    });

    // 3. Check Overround
    const impliedProb = newOdds.reduce((sum, o) => sum + (1 / o.odd), 0);
    const overround = impliedProb * 100;
    
    // 4. Normalize if overround < 104% (Arbitrage Protection)
    if (overround < 104) {
        const targetOverround = 1.07; // Target 107% (Standardized)
        // We want newImpliedProb = targetOverround (1.07)
        // CurrentImpliedProb = sum(1/odd)
        // Scaling factor for probabilities: K = Target / Current
        // NewProb = OldProb * K
        // NewOdd = 1 / NewProb
        
        const scale = targetOverround / impliedProb;
        
        newOdds = newOdds.map(o => ({
            ...o,
            odd: Number((1 / ((1 / o.odd) * scale)).toFixed(2))
        }));
    }

    return newOdds;
}

export async function saveBalancedOdds(db: D1Database, eventId: string, marketKey: string, newOutcomes: MarketOutcome[]) {
    // We need to update imported_odds payload
    // This is expensive if we do it for every bet. 
    // Ideally we update a separate 'dynamic_odds' table or column, but let's stick to imported_odds for now.
    
    const record = await db.prepare('SELECT payload FROM imported_odds WHERE event_id = ?').bind(eventId).first();
    if (!record || !record.payload) return;

    try {
        const payload = JSON.parse(record.payload as string);
        if (!payload.odds) payload.odds = {};
        
        // Update the specific market
        if (payload.odds[marketKey]) {
            // Check if outcomes is array (old) or object with outcomes (new)
            if (Array.isArray(payload.odds[marketKey].outcomes)) {
                 payload.odds[marketKey].outcomes = newOutcomes.map(o => ({
                     outcome: o.label || o.name,
                     value: o.odd
                 }));
            } else if (Array.isArray(payload.odds[marketKey])) {
                 payload.odds[marketKey] = newOutcomes.map(o => ({
                     outcome: o.label || o.name,
                     value: o.odd
                 }));
            }
        }
        
        // Mark as dynamic/balanced
        payload.isBalanced = true;
        payload.lastBalanced = Date.now();

        await db.prepare('UPDATE imported_odds SET payload = ? WHERE event_id = ?')
            .bind(JSON.stringify(payload), eventId).run();

        return payload;
    } catch (e) {
        console.error('Failed to save balanced odds', e);
        return null;
    }
}
