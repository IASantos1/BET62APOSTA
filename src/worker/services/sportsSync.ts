/**
 * sportsSync.ts — Sincronização de eventos desportivos (API-Sports plano pago)
 *
 * Estratégia de quota (1500 req/dia por desporto):
 *   - Sync parcial (a cada 5 min): live fixtures + live odds  → ~2 req soccer
 *   - Sync completo (a cada 30 min): + scheduled fixtures + day odds → ~8 req soccer
 *
 * Outros desportos: sync completo a cada 30 min apenas (sem odds)
 */

import { Env } from '../../shared/types';
import {
  fetchLiveFixtures,
  fetchDateFixtures,
  fetchLiveOdds,
  fetchDayOdds,
  fetchDayOddsForSport,
  fetchOddsForEvents,
  applyOdds,
  NormalizedEvent,
  SPORT_CONFIG,
} from './sportsApi';
import { fetchOddsApiEvents, matchOddsEvent } from './oddsApi';
import { upsertOddsApiRaw, upsertUnifiedMatches, upsertUnifiedOddsLatest } from './unified/unifiedStore';

const FINISHED_STATUSES = [
  'FT', 'AET', 'PEN', 'AWD', 'WO', 'ABD', 'FT_PEN', 'AOT', 'AP',
  'Finished', 'Match Finished', 'Final', 'Ended',
];

// Controlo de ciclos para full sync (a cada 6 ciclos = 30 min)
let syncCycle = 0;

export async function runSportsSync(
  env: Env,
  opts?: { forceFull?: boolean },
): Promise<{ synced: number; sports: string[] }> {
  if (!env.API_SPORTS_KEY) {
    console.log('[SportsSync] Skipped: no API_SPORTS_KEY');
    return { synced: 0, sports: [] };
  }

  syncCycle++;
  const isFullSync = opts?.forceFull ? true : (syncCycle % 6 === 1); // ciclo 1, 7, 13... = full sync
  console.log(`[SportsSync] Cycle ${syncCycle} (${isFullSync ? 'FULL' : 'live-only'})`);

  let totalSynced = 0;
  const syncedSports: string[] = [];

  // ── Soccer: usa odds da API-Football ──────────────────────────────
  try {
    const count = await syncSoccer(env, isFullSync);
    if (count > 0) { totalSynced += count; syncedSports.push('soccer'); }
  } catch (err) {
    console.error('[SportsSync] soccer error:', err);
  }

  // ── Outros desportos: só no full sync ─────────────────────────────
  if (isFullSync) {
    for (const sport of Object.keys(SPORT_CONFIG)) {
      if (sport === 'soccer') continue;
      try {
        const count = await syncOtherSport(env, sport);
        if (count > 0) { totalSynced += count; syncedSports.push(sport); }
      } catch (err) {
        console.error(`[SportsSync] ${sport} error:`, err);
      }
    }
  }

  await cleanupOldEvents(env);

  console.log(`[SportsSync] Done. ${totalSynced} events synced [${syncedSports.join(', ')}]`);
  return { synced: totalSynced, sports: syncedSports };
}

// ── Soccer sync com odds ──────────────────────────────────────────────
async function syncSoccer(env: Env, isFullSync: boolean): Promise<number> {
  const apiKey = env.API_SPORTS_KEY!;

  // 1. Fetch live fixtures + live odds (sempre)
  const [liveFixtures, liveOddsMap] = await Promise.all([
    fetchLiveFixtures(apiKey, 'soccer'),
    fetchLiveOdds(apiKey),
  ]);

  // Aplicar live odds
  const liveWithOdds = liveFixtures.map(e => applyOdds(e, liveOddsMap));

  let scheduledWithOdds: NormalizedEvent[] = [];

  if (isFullSync) {
    // 2. Fetch scheduled fixtures para os próximos 3 dias
    const today = new Date();
    const scheduledResults: NormalizedEvent[] = [];

    for (let d = 0; d <= 2; d++) {
      const dt = new Date(today);
      dt.setDate(today.getDate() + d);
      const dateStr = dt.toISOString().slice(0, 10);

      const [fixtures, dayOdds] = await Promise.all([
        fetchDateFixtures(apiKey, 'soccer', dateStr),
        fetchDayOdds(apiKey, dateStr, 8, 5),
      ]);

      scheduledResults.push(...fixtures.map(e => applyOdds(e, dayOdds)));
    }

    scheduledWithOdds = scheduledResults;
  }

  // 3. Merge: live tem prioridade sobre scheduled (de-dup por ID)
  const seen = new Set<string>();
  const merged: NormalizedEvent[] = [];

  for (const e of [...liveWithOdds, ...scheduledWithOdds]) {
    if (!seen.has(e.external_event_id)) {
      seen.add(e.external_event_id);
      merged.push(e);
    }
  }

  if (!merged.length) {
    console.log('[SportsSync] soccer: no events');
    return 0;
  }

  // 4. Fallback odds via odds-api.io para eventos sem odds da API-Football
  if (env.ODDS_API_KEY) {
    try {
      const missingOddsCount = merged.reduce((acc, e) => acc + (Number(e.home_odd || 0) > 1 ? 0 : 1), 0);
      const maxEvents = Math.min(30, Math.max(0, missingOddsCount));
      const oddsApiEvents = maxEvents > 0
        ? await fetchOddsApiEvents(
            env.ODDS_API_KEY,
            'soccer',
            3,
            env.ODDS_API_BOOKMAKERS || 'Bet365,1xbet,Betano,888Sport,SportingBet',
            'pending,live',
            maxEvents,
            3,
          )
        : [];
      if (oddsApiEvents.length > 0) {
        await upsertOddsApiRaw(env, 'soccer', oddsApiEvents);
        let filled = 0;
        for (let i = 0; i < merged.length; i++) {
          if (merged[i].home_odd > 0) continue;
          const best = matchOddsEvent(
            { league: merged[i].league, home: merged[i].home_team, away: merged[i].away_team, kickoff: merged[i].event_date },
            oddsApiEvents,
          );
          if (best && best.home_odd > 1) {
            merged[i] = { ...merged[i], home_odd: best.home_odd, draw_odd: best.draw_odd, away_odd: best.away_odd };
            filled++;
          }
        }
        console.log(`[SportsSync] soccer: odds-api.io filled ${filled} events`);
      }
    } catch (err) {
      console.error('[SportsSync] odds-api.io fallback error:', err);
    }
  }

  console.log(`[SportsSync] soccer: ${liveWithOdds.length} live + ${scheduledWithOdds.length} scheduled → ${merged.length} unique`);
  await upsertEvents(env, merged);
  await upsertUnifiedMatches(env, merged);
  await upsertUnifiedOddsLatest(env, merged);
  return merged.length;
}

async function syncOtherSport(env: Env, sport: string): Promise<number> {
  const apiKey = env.API_SPORTS_KEY!;
  const today = new Date();
  const results: NormalizedEvent[] = [];

  for (let d = 0; d <= 1; d++) {
    const dt = new Date(today);
    dt.setDate(today.getDate() + d);
    const dateStr = dt.toISOString().slice(0, 10);
    const [fixtures, oddsMap] = await Promise.all([
      fetchDateFixtures(apiKey, sport, dateStr),
      fetchDayOddsForSport(apiKey, sport, dateStr, 2),
    ]);
    results.push(...fixtures.map((e) => applyOdds(e, oddsMap)));
  }

  if (!results.length) return 0;

  const seen = new Set<string>();
  const merged: NormalizedEvent[] = [];
  for (const e of results) {
    if (seen.has(e.external_event_id)) continue;
    seen.add(e.external_event_id);
    merged.push(e);
  }

  if (merged.length > 0) {
    const missing = merged.filter((e) => Number(e.home_odd || 0) <= 0);
    if (missing.length > 0) {
      try {
        const oddsMap = await fetchOddsForEvents(apiKey, sport, missing, 35, 3);
        for (let i = 0; i < merged.length; i++) {
          if (Number(merged[i].home_odd || 0) > 0) continue;
          merged[i] = applyOdds(merged[i], oddsMap);
        }
      } catch (err) {
        console.error(`[SportsSync] ${sport} per-game odds error:`, err);
      }
    }
  }

  if (env.ODDS_API_KEY && ['basketball', 'baseball', 'ice-hockey'].includes(sport)) {
    try {
      const missingOddsCount = merged.reduce((acc, e) => acc + (Number(e.home_odd || 0) > 1 ? 0 : 1), 0);
      const maxEvents = Math.min(25, Math.max(0, missingOddsCount));
      const oddsApiEvents = maxEvents > 0
        ? await fetchOddsApiEvents(
            env.ODDS_API_KEY,
            sport,
            2,
            env.ODDS_API_BOOKMAKERS || 'Bet365,1xbet,Betano,888Sport,SportingBet',
            'pending',
            maxEvents,
            3,
          )
        : [];
      if (oddsApiEvents.length > 0) {
        let filled = 0;
        for (let i = 0; i < merged.length; i++) {
          if (merged[i].home_odd > 0) continue;
          const best = matchOddsEvent(
            { league: merged[i].league, home: merged[i].home_team, away: merged[i].away_team, kickoff: merged[i].event_date },
            oddsApiEvents,
            70,
          );
          if (best && best.home_odd > 1) {
            merged[i] = { ...merged[i], home_odd: best.home_odd, draw_odd: best.draw_odd, away_odd: best.away_odd };
            filled++;
          }
        }
        console.log(`[SportsSync] ${sport}: odds-api.io filled ${filled} events`);
      }
    } catch (err) {
      console.error(`[SportsSync] ${sport} odds-api.io fallback error:`, err);
    }
  }

  await upsertEvents(env, merged);
  return merged.length;
}

// ── Upsert para D1 ────────────────────────────────────────────────────
// D1 limit: 100 bind vars. 19 cols × 5 rows = 95 < 100
const BATCH = 5;

async function upsertEvents(env: Env, events: NormalizedEvent[]): Promise<void> {
  for (let i = 0; i < events.length; i += BATCH) {
    const batch = events.slice(i, i + BATCH);
    try {
      await upsertBatch(env, batch);
    } catch (err) {
      console.error(`[SportsSync] upsert batch ${i} failed:`, err);
    }
    if (i + BATCH < events.length && i % 50 === 0) {
      await new Promise(res => setTimeout(res, 5));
    }
  }
}

async function upsertBatch(env: Env, events: NormalizedEvent[]): Promise<void> {
  const now  = new Date().toISOString();
  const ph   = events.map(() => '(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').join(',');
  const vals: any[] = [];

  for (const e of events) {
    vals.push(
      e.external_event_id, e.sport, e.league, e.home_team, e.away_team,
      e.team_match, e.event_date, e.status, e.is_live,
      e.home_odd, e.draw_odd, e.away_odd,
      e.elapsed, e.score, e.markets,
      e.home_team_logo || '', e.away_team_logo || '',
      e.country || '',
      now,
    );
  }

  const sql = `
    INSERT INTO events (
      external_event_id, sport, league, home_team, away_team, team_match,
      event_date, status, is_live, home_odd, draw_odd, away_odd,
      elapsed, score, markets, home_team_logo, away_team_logo, country, updated_at
    ) VALUES ${ph}
    ON CONFLICT(external_event_id) DO UPDATE SET
      sport           = excluded.sport,
      league          = excluded.league,
      home_team       = excluded.home_team,
      away_team       = excluded.away_team,
      team_match      = excluded.team_match,
      event_date      = excluded.event_date,
      status          = excluded.status,
      is_live         = excluded.is_live,
      home_odd        = CASE WHEN excluded.home_odd > 0   THEN excluded.home_odd   ELSE events.home_odd END,
      draw_odd        = CASE WHEN excluded.draw_odd > 0   THEN excluded.draw_odd   ELSE events.draw_odd END,
      away_odd        = CASE WHEN excluded.away_odd > 0   THEN excluded.away_odd   ELSE events.away_odd END,
      elapsed         = excluded.elapsed,
      score           = CASE WHEN excluded.score    != '{"home":null,"away":null}' THEN excluded.score    ELSE events.score    END,
      markets         = CASE WHEN excluded.markets  != '{}' THEN excluded.markets  ELSE events.markets  END,
      home_team_logo  = CASE WHEN excluded.home_team_logo != '' THEN excluded.home_team_logo ELSE events.home_team_logo END,
      away_team_logo  = CASE WHEN excluded.away_team_logo != '' THEN excluded.away_team_logo ELSE events.away_team_logo END,
      country         = CASE WHEN excluded.country != '' THEN excluded.country ELSE events.country END,
      updated_at      = excluded.updated_at
  `;

  await env.DB.prepare(sql).bind(...vals).run();
}

async function cleanupOldEvents(env: Env): Promise<void> {
  try {
    const ph = FINISHED_STATUSES.map(() => '?').join(',');
    await env.DB.prepare(`
      DELETE FROM events
      WHERE status IN (${ph})
        AND event_date < datetime('now', '-3 hours')
        AND CAST(id AS TEXT) NOT IN (
          SELECT DISTINCT CAST(event_id AS TEXT) FROM bets WHERE status = 'pending'
        )
    `).bind(...FINISHED_STATUSES).run();

    // Also clean stale NS/PST events that started >4h ago (never updated)
    await env.DB.prepare(`
      DELETE FROM events
      WHERE status IN ('NS', 'PST', 'TBD')
        AND event_date < datetime('now', '-4 hours')
    `).run();

    // Reset is_live flag for events that are >5h old (stuck live)
    await env.DB.prepare(`
      UPDATE events SET is_live = 0
      WHERE is_live = 1
        AND event_date < datetime('now', '-5 hours')
    `).run();
  } catch (err) {
    console.error('[SportsSync] cleanup error:', err);
  }
}
