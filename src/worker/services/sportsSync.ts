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
  applyOdds,
  fetchDayOdds,
  fetchLiveOdds,
  fetchOddsForEvents,
  fetchLiveFixtures,
  fetchDateFixtures,
  NormalizedEvent,
  SPORT_CONFIG,
} from './sportsApi';
import { fetchOddsApiEvents, fetchOddsApiMarketsForFixture } from './oddsApi';
import { upsertOddsApiRaw, upsertUnifiedMatches, upsertUnifiedOddsLatest } from './unified/unifiedStore';
import { getApiSportsKey, getOddsApiKey } from './env';

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
  const apiKey = getApiSportsKey(env);
  const oddsKey = getOddsApiKey(env);
  if (!apiKey && !oddsKey) {
    console.log('[SportsSync] Skipped: no API_SPORTS_KEY and no ODDS_API_KEY');
    return { synced: 0, sports: [] };
  }

  syncCycle++;
  const isFullSync = opts?.forceFull ? true : (syncCycle % 6 === 1); // ciclo 1, 7, 13... = full sync
  console.log(`[SportsSync] Cycle ${syncCycle} (${isFullSync ? 'FULL' : 'live-only'})`);

  let totalSynced = 0;
  const syncedSports: string[] = [];

  // ── Soccer: eventos via API-Football (se disponível), odds complementares via odds-api.io
  if (apiKey) {
    try {
      const count = await syncSoccer(env, isFullSync);
      if (count > 0) { totalSynced += count; syncedSports.push('soccer'); }
    } catch (err) {
      console.error('[SportsSync] soccer error:', err);
    }
  }

  // ── Outros desportos: só no full sync ─────────────────────────────
  if (apiKey && isFullSync) {
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

  if (oddsKey && isFullSync) {
    for (const sport of ['soccer', 'basketball', 'tennis', 'mma', 'boxing', 'afl', 'formula1']) {
      try {
        const count = await syncOddsApiOnlySport(env, sport);
        if (count > 0) { totalSynced += count; syncedSports.push(sport); }
      } catch (err) {
        console.error(`[SportsSync] odds-only ${sport} error:`, err);
      }
    }
  }

  await cleanupOldEvents(env);

  console.log(`[SportsSync] Done. ${totalSynced} events synced [${syncedSports.join(', ')}]`);
  return { synced: totalSynced, sports: syncedSports };
}

// ── Soccer sync com odds ──────────────────────────────────────────────
async function syncSoccer(env: Env, isFullSync: boolean): Promise<number> {
  const apiKey = getApiSportsKey(env);
  if (!apiKey) return 0;

  const liveWithOdds = await fetchLiveFixtures(apiKey, 'soccer');

  let scheduledWithOdds: NormalizedEvent[] = [];

  if (isFullSync) {
    // 2. Fetch scheduled fixtures para os próximos 3 dias
    const today = new Date();
    const scheduledResults: NormalizedEvent[] = [];

    for (let d = 0; d <= 2; d++) {
      const dt = new Date(today);
      dt.setDate(today.getDate() + d);
      const dateStr = dt.toISOString().slice(0, 10);

      const fixtures = await fetchDateFixtures(apiKey, 'soccer', dateStr);
      scheduledResults.push(...fixtures);
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

  // 4. Preencher odds via API-Football (/odds/live + /odds?date=YYYY-MM-DD + por-jogo)
  try {
    const liveOdds = await fetchLiveOdds(apiKey);

    const dates: string[] = [];
    const today = new Date();
    const daysAhead = isFullSync ? 2 : 0;
    for (let d = 0; d <= daysAhead; d++) {
      const dt = new Date(today);
      dt.setDate(today.getDate() + d);
      dates.push(dt.toISOString().slice(0, 10));
    }

    const dayMaps = new Map<string, any>();
    if (dates.length) {
      for (const ds of dates) {
        const dayMap = await fetchDayOdds(apiKey, ds, 0, 6);
        dayMaps.set(ds, dayMap);
      }
    }

    for (let i = 0; i < merged.length; i++) {
      let ev = merged[i];
      ev = applyOdds(ev, liveOdds);
      for (const [, dm] of dayMaps) {
        ev = applyOdds(ev, dm);
      }
      merged[i] = ev;
    }

    const missing = merged
      .filter((e) => Number(e.home_odd || 0) <= 1)
      .slice(0, isFullSync ? 90 : 35);
    if (missing.length > 0) {
      const perGame = await fetchOddsForEvents(apiKey, 'soccer', missing, missing.length, 4);
      if (perGame.size > 0) {
        for (let i = 0; i < merged.length; i++) {
          merged[i] = applyOdds(merged[i], perGame);
        }
      }
    }
  } catch (err) {
    console.error('[SportsSync] soccer: api-football odds fill error:', err);
  }

  // 5. Fallback odds via odds-api.io para eventos ainda sem odds
  const oddsKey = getOddsApiKey(env);
  if (oddsKey) {
    try {
      const ordered = [...merged].sort((a, b) => {
        const al = Number(a.is_live || 0);
        const bl = Number(b.is_live || 0);
        if (al !== bl) return bl - al;
        return String(a.event_date || '').localeCompare(String(b.event_date || ''));
      });

      const books = env.ODDS_API_BOOKMAKERS || 'Bet365,1xbet,Betano,888Sport,SportingBet';
      const limit = Math.min(160, ordered.length);
      let filled = 0;

      for (let i = 0; i < limit; i++) {
        const ev = ordered[i];
        if (Number(ev.home_odd || 0) > 1) continue;
        const out = await fetchOddsApiMarketsForFixture(
          oddsKey,
          { league: ev.league, home: ev.home_team, away: ev.away_team, kickoff: ev.event_date, sport: 'soccer' },
          books,
          'pending,live',
        );
        if (!out || Number(out.home_odd || 0) <= 1) continue;
        ev.home_odd = out.home_odd;
        ev.draw_odd = out.draw_odd;
        ev.away_odd = out.away_odd;
        ev.markets = JSON.stringify(out.markets || {});
        filled++;
      }

      console.log(`[SportsSync] soccer: odds-api.io filled ${filled}/${limit}`);
    } catch (err) {
      console.error('[SportsSync] odds-api.io fallback error:', err);
    }
  }

  console.log(`[SportsSync] soccer: ${liveWithOdds.length} live + ${scheduledWithOdds.length} scheduled → ${merged.length} unique`);
  await upsertEvents(env, merged);
  try { await upsertUnifiedMatches(env, merged); } catch (err) { console.warn('[SportsSync] upsertUnifiedMatches skipped:', err); }
  try { await upsertUnifiedOddsLatest(env, merged); } catch (err) { console.warn('[SportsSync] upsertUnifiedOddsLatest skipped:', err); }
  return merged.length;
}

async function syncOtherSport(env: Env, sport: string): Promise<number> {
  const apiKey = getApiSportsKey(env);
  if (!apiKey) return 0;
  const today = new Date();
  const results: NormalizedEvent[] = [];

  for (let d = 0; d <= 1; d++) {
    const dt = new Date(today);
    dt.setDate(today.getDate() + d);
    const dateStr = dt.toISOString().slice(0, 10);
    const fixtures = await fetchDateFixtures(apiKey, sport, dateStr);
    results.push(...fixtures);
  }

  if (!results.length) return 0;

  const seen = new Set<string>();
  const merged: NormalizedEvent[] = [];
  for (const e of results) {
    if (seen.has(e.external_event_id)) continue;
    seen.add(e.external_event_id);
    merged.push(e);
  }

  const oddsKey = getOddsApiKey(env);
  if (oddsKey) {
    try {
      const ordered = [...merged].sort((a, b) => {
        const al = Number(a.is_live || 0);
        const bl = Number(b.is_live || 0);
        if (al !== bl) return bl - al;
        return String(a.event_date || '').localeCompare(String(b.event_date || ''));
      });

      const books = env.ODDS_API_BOOKMAKERS || 'Bet365,1xbet,Betano,888Sport,SportingBet';
      const limit = Math.min(180, ordered.length);
      let filled = 0;

      for (let i = 0; i < limit; i++) {
        const ev = ordered[i];
        const out = await fetchOddsApiMarketsForFixture(
          oddsKey,
          { league: ev.league, home: ev.home_team, away: ev.away_team, kickoff: ev.event_date, sport },
          books,
          'pending,live',
        );
        if (!out || Number(out.home_odd || 0) <= 1) continue;
        ev.home_odd = out.home_odd;
        ev.draw_odd = out.draw_odd;
        ev.away_odd = out.away_odd;
        ev.markets = JSON.stringify(out.markets || {});
        filled++;
      }

      console.log(`[SportsSync] ${sport}: odds-api.io filled ${filled}/${limit}`);
    } catch (err) {
      console.error(`[SportsSync] ${sport} odds-api.io fallback error:`, err);
    }
  }

  await upsertEvents(env, merged);
  return merged.length;
}

async function syncOddsApiOnlySport(env: Env, sport: string): Promise<number> {
  const oddsKey = getOddsApiKey(env);
  if (!oddsKey) return 0;
  const oddsApiEvents = await fetchOddsApiEvents(
    oddsKey,
    sport,
    3,
    env.ODDS_API_BOOKMAKERS || 'Bet365,1xbet,Betano,888Sport,SportingBet',
    'pending,live',
    120,
    3,
  );
  if (!oddsApiEvents.length) return 0;
  try { await upsertOddsApiRaw(env, sport, oddsApiEvents); } catch (err) { console.warn('[SportsSync] upsertOddsApiRaw skipped:', err); }

  const events: NormalizedEvent[] = oddsApiEvents
    .map((e) => {
      const home = String(e.home || '').trim();
      const away = String(e.away || '').trim();
      const dt = String(e.date || '').trim();
      if (!home || !away || !dt) return null;
      const dateIso = new Date(dt);
      if (Number.isNaN(dateIso.getTime())) return null;

      return {
        external_event_id: `${sport}_${String(e.id)}`,
        sport,
        league: String(e.league_name || e.league_slug || ''),
        home_team: home,
        away_team: away,
        team_match: `${home} vs ${away}`,
        event_date: dateIso.toISOString(),
        status: String(e.status || '').toLowerCase().includes('live') ? 'LIVE' : 'NS',
        is_live: String(e.status || '').toLowerCase().includes('live') ? 1 : 0,
        home_odd: Number(e.home_odd || 0),
        draw_odd: Number(e.draw_odd || 0),
        away_odd: Number(e.away_odd || 0),
        elapsed: 0,
        timer: '',
        score: '{"home":null,"away":null}',
        markets: '{}',
        country: '',
        home_team_logo: '',
        away_team_logo: '',
      };
    })
    .filter(Boolean) as NormalizedEvent[];

  if (!events.length) return 0;
  await upsertEvents(env, events);
  return events.length;
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
