import { Env } from '../../shared/types';
import { normalizeOdds } from '../utils/normalizeOdds';
import { generateLiveOdds } from '../engine/liveOddsEngine';
import { fetchOddsForSingleFixture } from './robustIntegration';

interface PollCandidate {
    id: number;
    external_event_id: string;
    sport: string;
    status: string;
    is_live: number;
    updated_at: string;
    league: string;
    event_date: string;
}

const API_SPORTS_CONFIG: Record<string, { url: string, type: 'fixture' | 'game' | 'fight' | 'race', host: string }> = {
    'soccer': { url: "https://v3.football.api-sports.io/fixtures", type: 'fixture', host: 'v3.football.api-sports.io' },
    'basketball': { url: "https://v1.basketball.api-sports.io/games", type: 'game', host: 'v1.basketball.api-sports.io' },
    'baseball': { url: "https://v1.baseball.api-sports.io/games", type: 'game', host: 'v1.baseball.api-sports.io' },
    'american-football': { url: "https://v1.american-football.api-sports.io/games", type: 'game', host: 'v1.american-football.api-sports.io' },
    'hockey': { url: "https://v1.hockey.api-sports.io/games", type: 'game', host: 'v1.hockey.api-sports.io' },
    'rugby': { url: "https://v1.rugby.api-sports.io/games", type: 'game', host: 'v1.rugby.api-sports.io' },
    'volleyball': { url: "https://v1.volleyball.api-sports.io/games", type: 'game', host: 'v1.volleyball.api-sports.io' },
    'handball': { url: "https://v1.handball.api-sports.io/games", type: 'game', host: 'v1.handball.api-sports.io' },
    'tennis': { url: "https://v3.tennis.api-sports.io/games", type: 'game', host: 'v3.tennis.api-sports.io' },
    'mma': { url: "https://v1.mma.api-sports.io/fights", type: 'fight', host: 'v1.mma.api-sports.io' },
    'formula-1': { url: "https://v1.formula-1.api-sports.io/races", type: 'race', host: 'v1.formula-1.api-sports.io' },
    'boxing': { url: "https://v1.boxing.api-sports.io/games", type: 'game', host: 'v1.boxing.api-sports.io' }
};

export class AdaptivePollingService {
    private env: Env;

    constructor(env: Env) {
        this.env = env;
    }

    /**
     * Main entry point for adaptive polling.
     * Should be called every minute by the cron job.
     * It handles sub-minute intervals for live events internally or via repeated calls.
     */
    async run() {
        console.log('[AdaptivePolling] Starting cycle...');
        const now = Date.now();
        
        // 1. Identify candidates and their required interval
        const candidates = await this.getCandidates();
        const toPoll: PollCandidate[] = [];

        for (const c of candidates) {
            const lastUpdate = new Date(c.updated_at).getTime();
            const interval = this.getIntervalMs(c.status, c.event_date);
            
            if (interval === -1) continue; // Stop polling (FT)

            if (now - lastUpdate >= interval) {
                toPoll.push(c);
            }
        }

        console.log(`[AdaptivePolling] Found ${toPoll.length} events to poll.`);

        // 2. Batch processing
        // Group by sport to optimize API calls
        const bySport: Record<string, PollCandidate[]> = {};
        for (const ev of toPoll) {
            if (!bySport[ev.sport]) bySport[ev.sport] = [];
            bySport[ev.sport].push(ev);
        }

        for (const [sport, events] of Object.entries(bySport)) {
            // Process in chunks of 10
            const chunks = this.chunkArray(events, 10);
            for (const chunk of chunks) {
                await this.processBatch(sport, chunk);
            }
        }
    }

    private getIntervalMs(status: string, eventDate?: string): number {
        // NS (não iniciado): Adaptive based on time to kickoff
        if (['NS', 'TBD', 'Not Started'].includes(status)) {
            if (!eventDate) return 10 * 60 * 1000; // Default fallback
            return this.getPreMatchInterval(eventDate);
        }
        
        // 1H / 2H / ET / P (LIVE): 30 segundos
        // Include common short statuses for other sports: Q1, Q2, S1, S2, etc.
        if (['1H', '2H', 'ET', 'P', 'LIVE', 'IN_PLAY', 'Q1', 'Q2', 'Q3', 'Q4', 'OT', 'S1', 'S2', 'S3', 'S4', 'S5'].includes(status)) return 30 * 1000;
        
        // HT (intervalo): 2 minutos
        if (['HT', 'Halftime', 'Break'].includes(status)) return 2 * 60 * 1000;
        
        // FT (finalizado): Parar
        if (['FT', 'AOT', 'AP', 'Finished', 'Ended', 'Final', 'Complete'].includes(status)) return -1;

        // Default fallback (e.g. Suspended, Postponed)
        return 10 * 60 * 1000; 
    }

    private getPreMatchInterval(eventDateStr: string): number {
        const eventDate = new Date(eventDateStr).getTime();
        const now = Date.now();
        const diffMs = eventDate - now;
        const hoursToKickoff = diffMs / (1000 * 60 * 60);

        // > 24h: 2–6 hours (Using 4 hours)
        if (hoursToKickoff > 24) return 4 * 60 * 60 * 1000; 
        
        // 24h – 12h: 30–60 min (Using 45 min)
        if (hoursToKickoff > 12) return 45 * 60 * 1000; 
        
        // 12h – 3h: 10–15 min (Using 15 min)
        if (hoursToKickoff > 3) return 15 * 60 * 1000; 
        
        // 3h – 30min: 2–5 min (Using 3 min)
        if (hoursToKickoff > 0.5) return 3 * 60 * 1000; 
        
        // < 30min: 30–60s (Using 1 min)
        // Note: Cron runs every 30s-1min. 
        return 60 * 1000; 
    }

    private async getCandidates(): Promise<PollCandidate[]> {
        // Fetch active events (Live or Pre-Game starting soon/recently)
        // We select from 'events' table which should be the source of truth for current state
        const query = `
            SELECT id, external_event_id, sport, status, is_live, updated_at, league, event_date
            FROM events
            WHERE 
                (is_live = 1) 
                OR 
                (event_date BETWEEN datetime('now', '-2 hours') AND datetime('now', '+24 hours'))
        `;
        const { results } = await this.env.DB.prepare(query).all();
        return results as unknown as PollCandidate[];
    }

    private chunkArray<T>(array: T[], size: number): T[][] {
        const result = [];
        for (let i = 0; i < array.length; i += size) {
            result.push(array.slice(i, i + size));
        }
        return result;
    }

    private async processBatch(sport: string, events: PollCandidate[]) {
        const ids = events
            .filter(e => e.external_event_id)
            .map(e => {
                // Strip sport prefix to get raw ID for API
                // Format is usually "sport_id", e.g. "soccer_123456"
                // But we must be careful if ID doesn't have prefix (legacy data?)
                // We assume consistent prefixing from robustIntegration.ts
                const prefix = `${sport}_`;
                if (e.external_event_id.startsWith(prefix)) {
                    return e.external_event_id.slice(prefix.length);
                }
                // Fallback: split by underscore and take last part, or return as is
                const parts = e.external_event_id.split('_');
                return parts.length > 1 ? parts[parts.length - 1] : e.external_event_id;
            })
            .join('-');

        if (ids) {
            await this.fetchApiSports(sport, ids);
        }
    }

    private async fetchApiSports(sport: string, ids: string) {
        if (!this.env.API_SPORTS_KEY) {
            console.error('[AdaptivePolling] Missing API_SPORTS_KEY');
            return;
        }

        const config = API_SPORTS_CONFIG[sport];
        if (!config) {
            console.warn(`[AdaptivePolling] No config for sport: ${sport}`);
            return;
        }

        // Handle URL differences
        const url = `${config.url}?ids=${ids}`;
        if (sport === 'formula-1' || sport === 'mma') {
             // Some APIs might use different params, usually 'ids' works for V1 games/fights
             // Check documentation if needed. Assuming 'ids' is standard for now.
             // F1 uses /races?id=... (singular) usually, but let's try ids.
             // If F1 fails, we might need loop.
        }

        console.log(`[AdaptivePolling] Fetching ${sport}: ${url}`);

        try {
            const resp = await fetch(url, {
                headers: {
                    'x-apisports-key': this.env.API_SPORTS_KEY
                }
            });

            if (!resp.ok) {
                console.error(`[AdaptivePolling] API Error (${sport}): ${resp.status}`);
                return;
            }

            const data: any = await resp.json();
            if (!data.response) return;

            for (const item of data.response) {
                await this.updateEvent(sport, item);
            }

        } catch (e) {
            console.error(`[AdaptivePolling] Fetch Error (${sport}):`, e);
        }
    }

    private async updateEvent(sport: string, apiData: any) {
        let fixture, goals, score, status, id;

        let existingPayload: any = null;

        // Normalize Data based on Sport
        if (sport === 'soccer') {
            fixture = apiData.fixture;
            goals = apiData.goals;
            score = apiData.score;
            status = fixture.status.short;
            id = String(fixture.id);
        } else if (['basketball', 'baseball', 'american-football', 'hockey', 'rugby', 'volleyball', 'handball', 'tennis', 'boxing'].includes(sport)) {
            // V1 Standard: game { id, status }, scores
            fixture = apiData.game || apiData.fixture; // Tennis V3 uses fixture? No, usually game in V1. Tennis V3 uses 'id' at root? No.
            // Let's assume standard V1 structure:
            // response: { game: { id, status: { short, long }, ... }, scores: { ... } }
            // Exception: Tennis V3 might be different.
            
            if (!fixture && apiData.id) {
                 // Maybe it's at root
                 fixture = apiData;
            }
            
            status = fixture?.status?.short;
            id = String(fixture?.id);
            score = apiData.scores || apiData.score; 
            
            // Explicitly extract elapsed for V1 sports (timer) or V3 (elapsed)
            if (fixture?.status?.timer) {
                // V1 often uses 'timer'
                if (!existingPayload) existingPayload = {} as any; // Temporary holder if needed, though usually handled below
                // We'll set it in the payload later, but let's capture it here
                // Actually, let's attach it to fixture.status for consistency
                if (fixture.status) fixture.status.elapsed = fixture.status.timer;
            }

            if (sport === 'basketball') {
                console.log(`[AdaptivePolling] Basketball Debug: ID=${id}, Status=${JSON.stringify(status)}, Timer=${fixture?.status?.timer}, ScoreKeys=${score ? Object.keys(score) : 'null'}`);
            }

            goals = null; // Generic
        } else if (sport === 'mma') {
            // Fights: { id, status, ... }
            fixture = apiData; // often the root object is the fight
            if (apiData.fight) fixture = apiData.fight;
            
            status = fixture?.status?.short;
            id = String(fixture?.id);
            score = apiData.score;
        } else if (sport === 'formula-1') {
             // Races: { id, status, ... }
             fixture = apiData; // root or race
             status = fixture?.status?.short || fixture?.status;
             id = String(fixture?.id);
        }

        if (!id || !status) {
            // console.warn('[AdaptivePolling] Could not parse event data', sport, apiData);
            return;
        }

        // Fix: Ensure ID is prefixed with sport to match database keys
        // DB uses "soccer_123456", API returns "123456"
        const rawId = id;
        // Check if ID already has prefix (unlikely from API but safe to check)
        if (!id.startsWith(`${sport}_`)) {
            id = `${sport}_${id}`;
        }

        // 1. Snapshot creation (JSONB style)
        const snapshot = JSON.stringify({
            status: fixture.status, // save full status obj
            goals,
            score,
            updated_at: new Date().toISOString()
        });

        // 2. Fetch Existing Payload to generate Live Odds
        // existingPayload declared at top
        let eventExists = false;
        try {
            const row: any = await this.env.DB.prepare('SELECT payload FROM imported_odds WHERE id = ?').bind(id).first();
            if (row) {
                eventExists = true;
                if (row.payload) {
                    existingPayload = JSON.parse(row.payload);
                }
            }
        } catch (e) {
            console.error(`[AdaptivePolling] Failed to fetch existing payload for ${id}`, e);
        }
        // FALLBACK: If no existing payload OR no odds in existing payload, try to fetch base odds
        if (!existingPayload || (!existingPayload.home_odd && !existingPayload.base_home_odd)) {
            // Only try to fetch if we have an external ID (which we do, apiData usually has it or we can deduce)
            const extId = apiData.fixture?.id || apiData.id || apiData.game?.id;
            if (extId) {
                try {
                    // Use a rate-limit friendly check? Or just try. 
                    // Adaptive polling runs often, but "new" live events without odds shouldn't be too many.
                    console.log(`[AdaptivePolling] Missing base odds for ${id} (ext: ${extId}). Fetching...`);
                    const fetchedOdds = await fetchOddsForSingleFixture(this.env, sport, String(extId));
                    
                    if (fetchedOdds && fetchedOdds.markets) {
                        const h2h = fetchedOdds.markets.find((m: any) => m.key === 'h2h');
                        if (h2h) {
                            const home = h2h.outcomes.find((o: any) => o.id === '1' || o.name === 'Home' || o.name === fetchedOdds.homeName)?.price;
                            const draw = h2h.outcomes.find((o: any) => o.id === 'X' || o.name === 'Draw')?.price;
                            const away = h2h.outcomes.find((o: any) => o.id === '2' || o.name === 'Away' || o.name === fetchedOdds.awayName)?.price;

                            if (home && away) {
                                if (!existingPayload) {
                                    // Create skeleton payload if totally missing
                                    existingPayload = {
                                        id, sport, 
                                        home_team: fetchedOdds.homeName,
                                        away_team: fetchedOdds.awayName,
                                        teams: { home: { name: fetchedOdds.homeName }, away: { name: fetchedOdds.awayName } },
                                        league: fixture.league || { name: 'Unknown' },
                                        status: fixture.status,
                                        is_live: true
                                    };
                                }
                                existingPayload.base_home_odd = home;
                                existingPayload.base_draw_odd = draw;
                                existingPayload.base_away_odd = away;
                                existingPayload.markets = fetchedOdds.markets; // Save initial markets
                                console.log(`[AdaptivePolling] Successfully fetched base odds for ${id}: ${home}/${draw}/${away}`);
                            }
                        }
                    }
                } catch (e) {
                    console.error(`[AdaptivePolling] Fallback odds fetch failed for ${id}`, e);
                }
            }
        }

        // 
        // 3. Generate Live Odds (if we have base data)
        let liveMarkets = null;
        if (existingPayload) {
            try {
                // Extract Pre-Match Base Odds (from original payload or preserved)
                // We need these to calculate live odds shift
                const baseHome = existingPayload.home_odd || existingPayload.base_home_odd;
                const baseDraw = existingPayload.draw_odd || existingPayload.base_draw_odd;
                const baseAway = existingPayload.away_odd || existingPayload.base_away_odd;

                // Construct Fixture object for Engine
                const engineFixture = {
                    id: id,
                    elapsed: fixture.status?.elapsed || 0,
                    goals: goals || score || { home: 0, away: 0 },
                    sport: sport,
                    home_odd: baseHome,
                    draw_odd: baseDraw,
                    away_odd: baseAway
                };

                const liveResult = generateLiveOdds(engineFixture);
                liveMarkets = liveResult.markets;

                // Merge into payload
                if (liveMarkets) {
                    // Update markets
                    // We need to transform liveMarkets (h2h array) into the standard markets structure
                    // The standard structure is markets: [{ key: 'h2h', outcomes: [...] }]
                    
                    const newMarkets = [];
                    
                    if (liveMarkets.h2h) {
                         const mappedOutcomes = liveMarkets.h2h.map((o: any) => {
                             const outcomeId = o.label === 'Casa' ? '1' : (o.label === 'Empate' ? 'X' : '2');
                             return {
                                 id: outcomeId,
                                 name: outcomeId,
                                 outcome: outcomeId,
                                 label: o.label,
                                 price: Number(o.odd),
                                 value: Number(o.odd),
                                 odd: Number(o.odd)
                             };
                         });

                         newMarkets.push({
                             key: 'h2h',
                             outcomes: mappedOutcomes
                         });
                         
                         // Update flat odds for legacy compatibility
                         const h = liveMarkets.h2h.find((o: any) => o.label === 'Casa')?.odd;
                         const d = liveMarkets.h2h.find((o: any) => o.label === 'Empate')?.odd;
                         const a = liveMarkets.h2h.find((o: any) => o.label === 'Fora')?.odd;
                         
                         if (h) existingPayload.home_odd = h;
                         if (d) existingPayload.draw_odd = d;
                         if (a) existingPayload.away_odd = a;
                         
                         // Ensure odds object also has the correct structure if used
                         if (!existingPayload.odds) existingPayload.odds = {};
                         existingPayload.odds.h2h = { outcomes: mappedOutcomes };
                    }
                    
                    existingPayload.markets = newMarkets;
                    
                    // Preserve base odds if not present (so we don't lose the reference for next calc)
                    if (!existingPayload.base_home_odd && baseHome) existingPayload.base_home_odd = baseHome;
                    if (!existingPayload.base_draw_odd && baseDraw) existingPayload.base_draw_odd = baseDraw;
                    if (!existingPayload.base_away_odd && baseAway) existingPayload.base_away_odd = baseAway;
                }
                
                // Update live fields
                existingPayload.is_live = true;
                existingPayload.status = status;
                if (!existingPayload.fixture) existingPayload.fixture = {};
                existingPayload.fixture.status = fixture.status;
                existingPayload.goals = goals;
                existingPayload.score = score;
                // Explicitly set elapsed for EventSync
                if (fixture.status && fixture.status.elapsed !== undefined) {
                    existingPayload.elapsed = fixture.status.elapsed;
                }
                
            } catch (e) {
                console.error(`[AdaptivePolling] Live Odds Generation Failed for ${id}`, e);
            }
        }

        // 4. Database Transactions
        try {
            const isLive = ['1H','2H','ET','P','HT','LIVE','IN_PLAY','Q1','Q2','Q3','Q4','OT','S1','S2','S3','S4','S5'].includes(status) ? 1 : 0;
            
            if (!eventExists) {
                // INSERT NEW EVENT
                if (!existingPayload) {
                     existingPayload = {
                        id, sport, 
                        home_team: apiData.teams?.home?.name || 'Home',
                        away_team: apiData.teams?.away?.name || 'Away',
                        teams: apiData.teams,
                        league: apiData.league || { name: 'Unknown' },
                        status: fixture.status,
                        is_live: true,
                        fixture: fixture.fixture || fixture,
                        goals: goals,
                        score: score,
                        updated_at: new Date().toISOString()
                    };
                }
                
                existingPayload.is_live = true;
                existingPayload.status = status;
                if (goals) existingPayload.goals = goals;
                if (score) existingPayload.score = score;

                await this.env.DB.prepare(`
                    INSERT INTO imported_odds (id, sport, league, home_team, away_team, event_date, status, is_live, payload, updated_at, publish_status)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 'published')
                `).bind(
                    id,
                    sport,
                    existingPayload.league?.name || 'Unknown',
                    existingPayload.home_team,
                    existingPayload.away_team,
                    fixture.fixture?.date || new Date().toISOString(),
                    status,
                    isLive,
                    JSON.stringify(existingPayload)
                ).run();
            } else {
                const batch = [
                    // Update Events
                    this.env.DB.prepare(`
                        UPDATE events 
                        SET 
                            status = ?, 
                            score = ?, 
                            is_live = ?,
                            updated_at = CURRENT_TIMESTAMP
                        WHERE external_event_id = ?
                    `).bind(
                        status, 
                        JSON.stringify(score || goals || {}), 
                        isLive,
                        id
                    ),

                    // Update Imported Odds (Status + Payload)
                    this.env.DB.prepare(`
                        UPDATE imported_odds
                        SET 
                            status = ?,
                            payload = ?,
                            updated_at = CURRENT_TIMESTAMP,
                            is_live = ?
                        WHERE id = ?
                    `).bind(
                        status, 
                        existingPayload ? JSON.stringify(existingPayload) : null, // Safe because we check existingPayload below
                        isLive,
                        id
                    )
                ];

                const finalBatch = [];
                
                // Always update events table
                finalBatch.push(batch[0]);
                
                if (existingPayload) {
                    // Full update including odds
                    finalBatch.push(batch[1]);
                } else {
                    // Fallback: Status only update (original behavior)
                    finalBatch.push(this.env.DB.prepare(`
                        UPDATE imported_odds
                        SET status = ?, is_live = ?, updated_at = CURRENT_TIMESTAMP
                        WHERE id = ?
                    `).bind(status, isLive, id));
                }

                await this.env.DB.batch(finalBatch);
            }
            // console.log(`[AdaptivePolling] Processed ${sport} event ${id} (${status})`);

        } catch (e) {
            console.error(`[AdaptivePolling] DB Update Error (${id}):`, e);
        }
    }
}
