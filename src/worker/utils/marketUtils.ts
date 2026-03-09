import { D1Database } from '@cloudflare/workers-types';

export interface MarketLinkParams {
    matchId: number;
    marketKey: string;
    marketName: string;
    bookmaker?: string;
}

export async function linkMarketsToMatch(db: D1Database, params: MarketLinkParams) {
    const { matchId, marketKey, marketName, bookmaker = 'Generic' } = params;

    try {
        // 1. Check if market exists for this match
        const existing = await db.prepare(`
            SELECT id FROM markets 
            WHERE match_id = ? AND market_key = ? AND bookmaker = ?
        `).bind(matchId, marketKey, bookmaker).first();

        if (existing) {
            // Market already linked
            return { success: true, id: existing.id, action: 'skipped' };
        }

        // 2. Insert new market link
        const result = await db.prepare(`
            INSERT INTO markets (match_id, market_key, market_name, bookmaker)
            VALUES (?, ?, ?, ?)
        `).bind(matchId, marketKey, marketName, bookmaker).run();

        return { success: true, id: result.meta.last_row_id, action: 'inserted' };
    } catch (error: any) {
        console.error('[MarketUtils] Error linking market:', error);
        return { success: false, error: error.message };
    }
}

export async function findMatchId(db: D1Database, homeTeam: string, awayTeam: string, date: string): Promise<number | null> {
    // Fuzzy search or exact match logic
    // For now, simple exact match on normalized names or exact date
    try {
        const result = await db.prepare(`
            SELECT id FROM events 
            WHERE (home_team = ? OR home_team LIKE ?) 
            AND (away_team = ? OR away_team LIKE ?)
            AND date(event_date) = date(?)
        `).bind(
            homeTeam, `%${homeTeam}%`, 
            awayTeam, `%${awayTeam}%`, 
            date
        ).first();

        return result ? (result.id as number) : null;
    } catch (e) {
        console.error('[MarketUtils] Error finding match:', e);
        return null;
    }
}
