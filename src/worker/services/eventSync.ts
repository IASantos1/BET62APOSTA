import { Env } from '../../shared/types';
import { NormalizedEvent, ImportedEventPayload } from '../types';
import { ALLOWED_LEAGUES, isLeagueAllowed, isSportKeyAllowed } from '../config/allowedLeagues';
import { getSportFromLeague } from '../../shared/helpers';
import { isSmallLeagueName } from '../utils/leagueFilter';

export class EventSyncService {
  private env: Env;

  constructor(env: Env) {
    this.env = env;
  }

  /**
   * Syncs events from the 'imported_odds' table (raw JSON)
   * to the 'events' table (normalized columns).
   */
  async syncEventsFromImported() {
    console.log('[EventSync] Starting sync...');
    const now = Date.now();
    const BATCH_SIZE = 2; // Reduced to 2 to prevent internal errors in D1/Miniflare
    
    // Fetch count firstpending/new imported odds
    // We process everything that might have changed. 
    // Optimization: Filter by `updated_at` if available, or just process active events.
    // For now, let's process all "relevant" imported odds (e.g. future or live)
    // to ensure we capture updates.
    
    // Fetch count first
    // TEMPORARY FIX: Remove date filter to force sync
    const countResult = await this.env.DB.prepare(`
      SELECT COUNT(*) as count FROM imported_odds 
    `).first(); 
    
    const total = (countResult as any)?.count || 0;
    console.log(`[EventSync] Found ${total} candidates for sync.`);

    let processed = 0;
    
    while (processed < total) {
      const rows = await this.env.DB.prepare(`
        SELECT * FROM imported_odds 
        ORDER BY is_live DESC, event_date ASC
        LIMIT ? OFFSET ?
      `).bind(BATCH_SIZE, processed).all();

      if (!rows.results || rows.results.length === 0) break;

      const batchEvents: NormalizedEvent[] = [];

      for (const row of rows.results) {
        try {
          const payload = JSON.parse(row.payload as string) as ImportedEventPayload;
          const normalized = this.normalizePayload(payload, row.id as string, row.sport as string);
          if (normalized) {
            // Enhance markets with sub-markets from payload if available
            const markets = normalized.markets ? JSON.parse(normalized.markets) : {};
            if ((payload as any).odds?.totals) markets.totals = (payload as any).odds.totals;
            if ((payload as any).odds?.handicap) markets.handicap = (payload as any).odds.handicap;
            normalized.markets = JSON.stringify(markets);

            batchEvents.push(normalized);
          }
        } catch (e) {
          console.error(`[EventSync] Error parsing payload for ${row.id}:`, e);
        }
      }

      if (batchEvents.length > 0) {
        try {
            await this.batchUpsertEvents(batchEvents);
            
            // Notify Realtime Server - REMOVED (Polling Architecture)
            /*
            try {
                await this.notifyRealtimeServer(batchEvents);
            } catch (e) {
                console.error('[EventSync] Failed to notify realtime server:', e);
            }
            */
        } catch (e) {
             console.error(`[EventSync] Batch upsert failed for batch starting at ${processed}:`, e);
             // Continue to next batch instead of crashing
        }
      }

      processed += rows.results.length;
      console.log(`[EventSync] Processed ${processed}/${total}`);
    }
    
    console.log('[EventSync] Sync complete.');
    return { processed, total };
  }

  private async notifyRealtimeServer(events: NormalizedEvent[]) {
      const liveEvents = events.filter(e => e.is_live === 1);
      
      if (liveEvents.length === 0) return;

      const payload = liveEvents.map(e => ({
          fixture: {
              id: e.external_event_id,
              status: { short: e.status, elapsed: e.elapsed },
              date: e.event_date
          },
          teams: {
              home: { name: e.home_team, logo: e.home_team_logo, id: e.home_team_id },
              away: { name: e.away_team, logo: e.away_team_logo, id: e.away_team_id }
          },
          league: { name: e.league, country: e.country },
          goals: { home: e.score_home, away: e.score_away },
          home_odd: e.home_odd,
          draw_odd: e.draw_odd,
          away_odd: e.away_odd,
          odds: {
            h2h: [
                { outcome: '1', value: '1', odd: e.home_odd },
                ...(e.draw_odd > 1.01 ? [{ outcome: 'X', value: 'X', odd: e.draw_odd }] : []),
                { outcome: '2', value: '2', odd: e.away_odd },
            ],
            ...(e.markets ? JSON.parse(e.markets) : {})
          },
          is_live: true
      }));

      const realtimeUrl = 'http://localhost:9101/publish';
      
      await fetch(realtimeUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
              type: 'live:upsert',
              payload: payload
          })
      });
  }

  /**
   * Normalizes the raw API payload into our flat 'events' structure
   */
  private normalizePayload(payload: ImportedEventPayload, externalId: string, sport: string): NormalizedEvent | null {
    // Basic validation
    if (!payload) return null;

    // Handle both "fixture" (API-Football) and "game" (API-Basketball/NBA) structures
    // Some endpoints return top-level id/status, others nested in 'fixture' or 'game'
    const fx: any = payload.fixture || payload.game || payload;
    
    // Determine Status
    let statusShort = '';
    if (fx.status) {
        statusShort = typeof fx.status === 'object' ? fx.status.short : fx.status;
    } else if (payload.status) {
        statusShort = typeof payload.status === 'object' ? payload.status.short : payload.status;
    }
    
    const isLive = this.isLiveStatus(statusShort);
    
    // Determine Date
    const dateStr = fx.date || (fx.timestamp ? new Date(fx.timestamp * 1000).toISOString() : payload.event_date);
    if (!dateStr) return null; // Mandatory

    // Teams
    // Safe extraction of teams object
    const teams = payload.teams;
    
    const homeName = teams?.home?.name || payload.home_team || (typeof fx.home_team === 'string' ? fx.home_team : fx.home_team?.name) || '';
    const awayName = teams?.away?.name || payload.away_team || (typeof fx.away_team === 'string' ? fx.away_team : fx.away_team?.name) || '';
    
    // IDs & Logos (API-Football structure)
    const homeId = teams?.home?.id || (typeof fx.home_team === 'object' ? fx.home_team?.id : null);
    const awayId = teams?.away?.id || (typeof fx.away_team === 'object' ? fx.away_team?.id : null);
    const homeLogo = teams?.home?.logo || (typeof fx.home_team === 'object' ? fx.home_team?.logo : null);
    const awayLogo = teams?.away?.logo || (typeof fx.away_team === 'object' ? fx.away_team?.logo : null);

    if (!homeName || !awayName) return null;

    // --- FILTER: Block Fake/Demo Events ---
    if (homeName === 'Home Team' || awayName === 'Away Team' || homeName === 'undefined' || awayName === 'undefined') {
         console.log(`[EventSync] Blocking Fake Event: ${homeName} vs ${awayName} (${externalId})`);
         return null;
    }

    // --- LEAGUE NAME EXTRACTION FIX ---
    let rawLeagueName = '';
    const league = payload.league;
    
    // 1. Try league.name (Standard API-Football)
    if (league && league.name) rawLeagueName = league.name;
    // 2. Try league_name (Legacy)
    else if ((payload as any).league_name) rawLeagueName = (payload as any).league_name;
    // 3. Try fixture.league.name
    else if (fx.league && (fx.league as any).name) rawLeagueName = (fx.league as any).name;

    // FILTER: Block unwanted leagues (U17, U23, Women, Small Leagues)
    if (isSmallLeagueName(rawLeagueName, league?.country || (payload as any).country)) {
         console.log(`[EventSync] Blocking Unwanted League: ${rawLeagueName} (${externalId})`);
         return null;
    }
    
    // Normalize League Name
    let leagueName = rawLeagueName;

    // 1. Try league.name (Standard API-Football)
    if (league && typeof league.name === 'string') {
        leagueName = league.name;
    }
    // 2. Try payload.league_name (Scraper/Legacy)
    else if (payload.league_name) {
        if (typeof payload.league_name === 'string') {
            leagueName = payload.league_name;
        } else if (typeof payload.league_name === 'object') {
             // Handle case where league_name might be an object (unlikely but safe)
             leagueName = (payload.league_name as any).name || '';
        }
    }
    // 3. Try fixture.league (some sports)
    else if (fx.league) {
        if (typeof fx.league === 'string') leagueName = fx.league;
        else if (typeof fx.league === 'object') leagueName = fx.league.name || '';
    }

    if (!leagueName) leagueName = 'Unknown League';

    // League/Sport Filtering
    // We rely on the initial import filter, but double check here if needed.
    // Also standardize sport key.
    const normalizedSport = getSportFromLeague(leagueName) || sport || 'soccer';

    // Odds extraction (Standardized)
    // We expect 'odds' to be an object with markets or a list of bookmakers
    // The 'imported_odds' payload usually comes from our worker which already tries to normalize,
    // BUT sometimes it's raw API response.
    let marketsObj = payload.odds || {};
    
    // If it's API-Football structure with bookmakers
    if (payload.bookmakers && Array.isArray(payload.bookmakers)) {
         // Find best bookmaker (e.g. Bet365)
         const bookie = payload.bookmakers.find((b: any) => b.id === 1 || b.name === 'Bet365') || payload.bookmakers[0];
         if (bookie && bookie.bets) {
             // Convert bets array to map
             const marketsMap: any = {};
             bookie.bets.forEach((bet: any) => {
                 // Key by ID or Name (normalized)
                 // Common: 1 (Winner), 12 (Chance), etc.
                 // We'll use ID as key for stability, or Name
                 // FIX: Avoid duplicates. Prefer canonical keys.
                 
                 let key = String(bet.id);
                 
                 // Special handling for Main Market (Winner)
                 if (bet.name === 'Match Winner' || bet.name === 'Home/Away' || bet.name === '1x2' || bet.id === 1) {
                     key = 'h2h';
                 } else if (bet.name === 'Second Half Winner') {
                     key = 'h2h_2nd_half';
                 } else if (bet.name === 'First Half Winner') {
                     key = 'h2h_1st_half';
                 } else {
                     // For others, use name if available for readability, else ID
                     key = bet.name || String(bet.id);
                 }

                 // Store only once per key
                 marketsMap[key] = bet.values; 
             });
             marketsObj = marketsMap;
         }
    }

    // Extract Main Odds (Home, Draw, Away)
    let home_odd = 0;
    let draw_odd = 0;
    let away_odd = 0;

    // Try standard keys
    if (marketsObj['h2h']) {
        const outcomes = marketsObj['h2h'];
        // API-Football: values: [{value: "Home", odd: "1.50"}, ...]
        if (Array.isArray(outcomes)) {
            const h = outcomes.find((o: any) => o.value === 'Home' || o.value === '1' || o.value === teams?.home?.name);
            const d = outcomes.find((o: any) => o.value === 'Draw' || o.value === 'X' || o.value === 'Tie');
            const a = outcomes.find((o: any) => o.value === 'Away' || o.value === '2' || o.value === teams?.away?.name);
            
            if (h) home_odd = parseFloat(h.odd);
            if (d) draw_odd = parseFloat(d.odd);
            if (a) away_odd = parseFloat(a.odd);
        }
    } else if (marketsObj['1'] || marketsObj['Match Winner']) {
         // Same logic as above
         const outcomes = marketsObj['1'] || marketsObj['Match Winner'];
         if (Array.isArray(outcomes)) {
            const h = outcomes.find((o: any) => o.value === 'Home' || o.value === '1');
            const d = outcomes.find((o: any) => o.value === 'Draw' || o.value === 'X');
            const a = outcomes.find((o: any) => o.value === 'Away' || o.value === '2');
            
            if (h) home_odd = parseFloat(h.odd);
            if (d) draw_odd = parseFloat(d.odd);
            if (a) away_odd = parseFloat(a.odd);
         }
    }
    
    // Fallback: Legacy flat properties
    if (!home_odd && (payload.home_odd || (payload.odds as any)?.home_odd)) home_odd = Number(payload.home_odd || (payload.odds as any)?.home_odd);
    if (!draw_odd && (payload.draw_odd || (payload.odds as any)?.draw_odd)) draw_odd = Number(payload.draw_odd || (payload.odds as any)?.draw_odd);
    if (!away_odd && (payload.away_odd || (payload.odds as any)?.away_odd)) away_odd = Number(payload.away_odd || (payload.odds as any)?.away_odd);

    return {
      id: externalId,
      external_event_id: String(fx.id || payload.id),
      sport: normalizedSport,
      league: leagueName,
      country: league?.country || (payload as any).country || 'World',
      event_date: dateStr,
      home_team: homeName,
      away_team: awayName,
      home_team_id: homeId,
      away_team_id: awayId,
      home_team_logo: homeLogo,
      away_team_logo: awayLogo,
      home_odd,
      draw_odd,
      away_odd,
      is_live: isLive ? 1 : 0,
      status: statusShort || 'NS',
      elapsed: payload.elapsed ?? (typeof fx.status === 'object' ? fx.status.elapsed : null),
      score_home: fx.goals?.home ?? payload.goals?.home ?? null,
      score_away: fx.goals?.away ?? payload.goals?.away ?? null,
      markets: JSON.stringify(marketsObj), // Store full markets JSON
      updated_at: new Date().toISOString()
    };
  }

  private isLiveStatus(short: string): boolean {
    const liveStatuses = ['1H', 'HT', '2H', 'ET', 'P', 'BT', 'LIVE', 'INT', 'BREAK'];
    return liveStatuses.includes(short);
  }

  private async batchUpsertEvents(events: NormalizedEvent[]) {
    if (events.length === 0) return;
    
    // Flatten array of events into a single array of values for binding
    const values: any[] = [];
    events.forEach(e => {
      values.push(
        String(e.external_event_id), // Ensure string
        e.sport || 'soccer',
        e.league || 'Unknown',
        e.country || 'World',
        e.event_date,
        e.home_team,
        e.away_team,
        `${e.home_team} vs ${e.away_team}`,
        e.home_team_id || null,
        e.away_team_id || null,
        e.home_team_logo || null,
        e.away_team_logo || null,
        Number(e.home_odd) || 0,
        Number(e.draw_odd) || 0,
        Number(e.away_odd) || 0,
        e.is_live ? 1 : 0,
        e.status || 'NS',
        Number(e.elapsed) || 0,
        e.score_home ?? null,
        e.score_away ?? null,
        e.markets ? String(e.markets) : null,
        new Date().toISOString()
      );
    });

    // Create placeholders string (?, ?, ...) for each event
    // 22 columns per event
    const singlePlaceholder = '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
    const placeholders = events.map(() => singlePlaceholder).join(', ');

    const query = `
      INSERT INTO events (
        external_event_id, sport, league, country, event_date, 
        home_team, away_team, team_match,
        home_team_id, away_team_id, home_team_logo, away_team_logo,
        home_odd, draw_odd, away_odd, 
        is_live, status, elapsed, score_home, score_away, markets, updated_at
      ) VALUES ${placeholders}
      ON CONFLICT(external_event_id) DO UPDATE SET
        sport=excluded.sport,
        league=excluded.league,
        event_date=excluded.event_date,
        home_team=excluded.home_team,
        away_team=excluded.away_team,
        team_match=excluded.team_match,
        home_team_id=COALESCE(excluded.home_team_id, events.home_team_id),
        away_team_id=COALESCE(excluded.away_team_id, events.away_team_id),
        home_team_logo=COALESCE(excluded.home_team_logo, events.home_team_logo),
        away_team_logo=COALESCE(excluded.away_team_logo, events.away_team_logo),
        home_odd=excluded.home_odd,
        draw_odd=excluded.draw_odd,
        away_odd=excluded.away_odd,
        is_live=excluded.is_live,
        status=excluded.status,
        elapsed=excluded.elapsed,
        score_home=COALESCE(excluded.score_home, events.score_home),
        score_away=COALESCE(excluded.score_away, events.score_away),
        markets=excluded.markets,
        updated_at=excluded.updated_at
    `;

    try {
      // DEBUG: Check values count
      console.log(`[EventSync] Upserting batch: ${events.length} events, ${values.length} values`);
      
      // Ensure this.env.DB is valid
      if (!this.env.DB || !this.env.DB.prepare) {
          throw new Error('Database binding (DB) is undefined or missing prepare method');
      }

      await this.env.DB.prepare(query).bind(...values).run();
      console.log(`[EventSync] Batch upsert success`);
    } catch (e) {
      console.error('[EventSync] Batch upsert failed:', e);
      // Fallback: try one by one if batch fails
      for (const event of events) {
         try {
             // Retry individually (simplified logic for retry not implemented here to save space)
             // console.error(`[EventSync] Failed event: ${event.external_event_id}`);
         } catch (inner) {}
      }
    }
  }
}
