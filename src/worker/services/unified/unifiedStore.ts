import type { Env } from '../../../shared/types';
import type { NormalizedEvent } from '../sportsApi';
import type { OddsEvent } from '../oddsApi';

let unifiedTablesReady: boolean | null = null;

function seasonStartYear(raw: string | undefined): string {
  const s = String(raw || '').trim();
  const m = s.match(/(\d{4})/);
  return m ? m[1] : '';
}

async function hasTable(env: Env, name: string): Promise<boolean> {
  try {
    const out = await env.DB
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=? LIMIT 1")
      .bind(name)
      .first('name');
    return !!out;
  } catch {
    return false;
  }
}

async function ensureUnifiedTables(env: Env): Promise<boolean> {
  if (unifiedTablesReady != null) return unifiedTablesReady;
  const ok = await hasTable(env, 'matches');
  unifiedTablesReady = ok;
  return ok;
}

export async function upsertUnifiedMatches(env: Env, events: NormalizedEvent[]): Promise<void> {
  if (!events.length) return;
  if (!(await ensureUnifiedTables(env))) return;
  const now = new Date().toISOString();
  const season = seasonStartYear(env.API_SPORTS_SEASON);
  const BATCH = 8;

  for (let i = 0; i < events.length; i += BATCH) {
    const batch = events.slice(i, i + BATCH);
    const ph = batch.map(() => '(?,?,?,?,?,?,?,?,?,?,?,?)').join(',');
    const vals: any[] = [];

    for (const e of batch) {
      const matchId = `m_${e.external_event_id}`;
      vals.push(
        matchId,
        e.external_event_id,
        null,
        e.sport,
        e.league,
        e.country || '',
        season,
        e.home_team,
        e.away_team,
        e.event_date,
        e.status,
        now,
      );
    }

    await env.DB.prepare(`
      INSERT INTO matches (
        match_id, api_football_id, odds_api_id, sport, league_name, country, season,
        home_team_name, away_team_name, kickoff_time, status, last_update
      ) VALUES ${ph}
      ON CONFLICT(match_id) DO UPDATE SET
        api_football_id  = excluded.api_football_id,
        sport            = excluded.sport,
        league_name      = excluded.league_name,
        country          = excluded.country,
        season           = excluded.season,
        home_team_name   = excluded.home_team_name,
        away_team_name   = excluded.away_team_name,
        kickoff_time     = excluded.kickoff_time,
        status           = excluded.status,
        last_update      = excluded.last_update
    `).bind(...vals).run();
  }
}

export async function upsertUnifiedOddsLatest(env: Env, events: NormalizedEvent[]): Promise<void> {
  if (!(await ensureUnifiedTables(env))) return;
  const now = new Date().toISOString();
  const rows = events.filter((e) => Number(e.home_odd || 0) > 1);
  if (!rows.length) return;
  const BATCH = 8;

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const ph = batch.map(() => '(?,?,?,?,?,?,?,?,?,?)').join(',');
    const vals: any[] = [];

    for (const e of batch) {
      vals.push(
        `m_${e.external_event_id}`,
        'unified',
        'best',
        'h2h',
        Number(e.home_odd) || null,
        Number(e.draw_odd) || null,
        Number(e.away_odd) || null,
        null,
        null,
        now,
      );
    }

    await env.DB.prepare(`
      INSERT INTO match_odds_latest (
        match_id, provider, bookmaker, market,
        home_odds, draw_odds, away_odds, over_2_5, under_2_5, updated_at
      ) VALUES ${ph}
      ON CONFLICT(match_id, provider, bookmaker, market) DO UPDATE SET
        home_odds   = excluded.home_odds,
        draw_odds   = excluded.draw_odds,
        away_odds   = excluded.away_odds,
        over_2_5    = excluded.over_2_5,
        under_2_5   = excluded.under_2_5,
        updated_at  = excluded.updated_at
    `).bind(...vals).run();
  }
}

export async function upsertOddsApiRaw(env: Env, sport: string, oddsEvents: OddsEvent[]): Promise<void> {
  if (!oddsEvents.length) return;
  if (!(await ensureUnifiedTables(env))) return;
  const now = new Date().toISOString();
  const BATCH = 10;

  for (let i = 0; i < oddsEvents.length; i += BATCH) {
    const batch = oddsEvents.slice(i, i + BATCH);
    const ph = batch.map(() => '(?,?,?,?,?,?,?)').join(',');
    const vals: any[] = [];

    for (const e of batch) {
      const id = String(e.id || '');
      vals.push(
        `${sport}_${id}`,
        e.date || '',
        e.league_name || e.league_slug || '',
        e.home,
        e.away,
        JSON.stringify(e),
        now,
      );
    }

    await env.DB.prepare(`
      INSERT INTO odds_api_raw (
        odds_api_id, kickoff_time, league_name, home_team_name, away_team_name, payload, updated_at
      ) VALUES ${ph}
      ON CONFLICT(odds_api_id) DO UPDATE SET
        kickoff_time     = excluded.kickoff_time,
        league_name      = excluded.league_name,
        home_team_name   = excluded.home_team_name,
        away_team_name   = excluded.away_team_name,
        payload          = excluded.payload,
        updated_at       = excluded.updated_at
    `).bind(...vals).run();
  }
}
