import process from 'node:process';
import type { NormalizedEvent, OddsResult, V1AllScoresDelta } from './sportsApiPro.js';

function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = Number(process.env[name] || '');
  if (!Number.isFinite(raw)) return fallback;
  const value = Math.floor(raw);
  return Math.max(min, Math.min(max, value));
}

const PROVIDER_TIMEOUT_MS = envInt('SPORTS_PROVIDER_TIMEOUT_MS', 15_000, 1_000, 60_000);
const PROVIDER_LIVE_TIMEOUT_MS = envInt('SPORTS_PROVIDER_LIVE_TIMEOUT_MS', 5_000, 1_000, 30_000);

function normalizeSportKey(sport: string): string {
  return String(sport || '')
    .toLowerCase()
    .trim()
    .replace(/[_\s]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
}

function statPalSportPath(sport: string): string {
  const s = normalizeSportKey(sport);
  if (s === 'football' || s === 'futebol' || s === 'soccer') return 'soccer';
  if (s === 'tennis') return 'tennis';
  if (s === 'basketball') return 'nba';
  if (s === 'baseball') return 'mlb';
  if (s === 'ice-hockey' || s === 'icehockey' || s === 'hockey') return 'nhl';
  if (s === 'volleyball' || s === 'volei' || s === 'voleyball') return 'volleyball';
  if (s === 'mma' || s === 'ufc') return 'mma';
  return s || 'soccer';
}

function statPalVersion(sport: string): 'v1' | 'v2' {
  return statPalSportPath(sport) === 'soccer' ? 'v2' : 'v1';
}

function pad2(v: number): string {
  return String(v).padStart(2, '0');
}

function formatDateVariants(raw: string): string[] {
  const value = String(raw || '').trim();
  if (!value) return [];
  const match = /^(\d{2})[./-](\d{2})[./-](\d{4})$/.exec(value);
  if (!match) return [value];
  const [, dd, mm, yyyy] = match;
  return [
    `${yyyy}-${mm}-${dd}`,
    `${dd}.${mm}.${yyyy}`,
    `${dd}/${mm}/${yyyy}`,
  ];
}

function parseStatPalDateTime(dateRaw: any, timeRaw?: any): string {
  const dateValue = String(dateRaw ?? '').trim();
  const timeValue = String(timeRaw ?? '').trim();
  if (!dateValue) return '';
  const directIso = new Date(`${dateValue}${timeValue ? ` ${timeValue}` : ''}`);
  if (Number.isFinite(directIso.getTime())) return directIso.toISOString();
  const match = /^(\d{2})[./-](\d{2})[./-](\d{4})$/.exec(dateValue);
  if (!match) return [dateValue, timeValue].filter(Boolean).join(' ').trim();
  const [, dd, mm, yyyy] = match;
  const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(timeValue);
  const hh = timeMatch ? Number(timeMatch[1]) : 0;
  const min = timeMatch ? Number(timeMatch[2]) : 0;
  const isoUtc = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), hh, min, 0));
  return Number.isFinite(isoUtc.getTime())
    ? isoUtc.toISOString()
    : `${yyyy}-${mm}-${dd}T${pad2(hh)}:${pad2(min)}:00.000Z`;
}

function dateOnlyIso(raw: string): string {
  const value = String(raw || '').trim();
  if (!value) return '';
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (isoMatch) return isoMatch[0];
  const match = /^(\d{2})[./-](\d{2})[./-](\d{4})$/.exec(value);
  if (!match) return '';
  const [, dd, mm, yyyy] = match;
  return `${yyyy}-${mm}-${dd}`;
}

function utcDayDiffFromToday(dateIso: string): number | null {
  const target = dateOnlyIso(dateIso);
  if (!target) return null;
  const today = new Date();
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(target);
  if (!match) return null;
  const [, yyyy, mm, dd] = match;
  const targetUtc = Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd));
  const diffDays = Math.round((targetUtc - todayUtc) / 86_400_000);
  return Number.isFinite(diffDays) ? diffDays : null;
}

function appendAccessKey(url: string, apiKey: string): string {
  const u = new URL(url);
  u.searchParams.set('access_key', apiKey);
  return u.toString();
}

async function fetchJson(url: string, timeoutMs: number = PROVIDER_TIMEOUT_MS): Promise<any | null> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function fetchFirstJson(urls: string[], timeoutMs: number): Promise<any | null> {
  for (const url of urls) {
    const json = await fetchJson(url, timeoutMs);
    if (json) return json;
  }
  return null;
}

function extractEvents(payload: any): any[] {
  if (!payload) return [];
  const flattenLeagueBlocks = (blocks: any[]): any[] => {
    const out: any[] = [];
    for (const block of blocks) {
      const leagueMeta = {
        id: block?.id ?? '',
        name: block?.name ?? '',
        country: block?.country ?? '',
        cup: block?.cup ?? '',
      };
      const rows = block?.match ?? block?.matches ?? block?.events ?? block?.games ?? block?.fixtures ?? [];
      if (Array.isArray(rows)) {
        for (const row of rows) out.push({ ...row, __league: leagueMeta });
        continue;
      }
      if (rows && typeof rows === 'object') {
        out.push({ ...rows, __league: leagueMeta });
      }
    }
    return out;
  };
  const flattenTournamentWeeks = (weeks: any[], tournamentMeta?: any): any[] => {
    const out: any[] = [];
    for (const week of weeks) {
      const rows = week?.match ?? week?.matches ?? week?.events ?? [];
      if (!Array.isArray(rows)) continue;
      for (const row of rows) {
        out.push({
          ...row,
          __league: {
            id: tournamentMeta?.id ?? '',
            name: tournamentMeta?.league ?? tournamentMeta?.name ?? '',
            country: payload?.matches?.country ?? tournamentMeta?.country ?? '',
            cup: tournamentMeta?.cup ?? '',
          },
        });
      }
    }
    return out;
  };

  if (Array.isArray(payload?.live_matches?.league)) return flattenLeagueBlocks(payload.live_matches.league);
  if (Array.isArray(payload?.upcoming_matches?.league)) return flattenLeagueBlocks(payload.upcoming_matches.league);
  if (Array.isArray(payload?.league)) return flattenLeagueBlocks(payload.league);
  if (Array.isArray(payload?.matches?.tournament?.week)) {
    return flattenTournamentWeeks(payload.matches.tournament.week, payload.matches.tournament);
  }
  for (const [key, value] of Object.entries(payload)) {
    if (!/^matches_\d{2}_\d{2}_\d{4}$/i.test(String(key))) continue;
    if (Array.isArray((value as any)?.league)) return flattenLeagueBlocks((value as any).league);
  }
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.matches)) return payload.matches;
  if (Array.isArray(payload.events)) return payload.events;
  if (Array.isArray(payload.games)) return payload.games;
  if (Array.isArray(payload.response)) return payload.response;
  if (Array.isArray(payload.data?.matches)) return payload.data.matches;
  if (Array.isArray(payload.data?.events)) return payload.data.events;
  if (Array.isArray(payload.data?.games)) return payload.data.games;
  if (Array.isArray(payload.data?.response)) return payload.data.response;
  if (Array.isArray(payload.livescores)) return payload.livescores;
  if (Array.isArray(payload.data?.livescores)) return payload.data.livescores;
  if (Array.isArray(payload?.live_matches?.matches)) return payload.live_matches.matches;
  if (Array.isArray(payload?.upcoming_matches?.matches)) return payload.upcoming_matches.matches;
  const blocks = payload.data?.tournaments ?? payload.tournaments ?? payload.data?.leagues ?? payload.leagues;
  if (Array.isArray(blocks)) {
    const out: any[] = [];
    for (const block of blocks) {
      const rows = block?.matches ?? block?.events ?? block?.games ?? block?.fixtures ?? [];
      if (Array.isArray(rows)) out.push(...rows);
    }
    return out;
  }
  return [];
}

function readScoreNumber(v: any): number | null {
  if (v == null) return null;
  const raw = String(v).trim();
  if (!raw || raw === '?' || raw === '-') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeStatusShort(v: any): string {
  const raw = String(v ?? '').trim();
  return raw || 'NS';
}

function normalizeStatusLong(v: any): string {
  const raw = String(v ?? '').trim();
  return raw || 'Not Started';
}

function isLiveStatus(shortStatus: string, longStatus: string): boolean {
  const short = String(shortStatus || '').trim().toLowerCase();
  const long = String(longStatus || '').trim().toLowerCase();
  if (!short && !long) return false;
  if (/^(ft|postp|postponed|ns|not started|canc|cancelled|ended|final)$/i.test(short)) return false;
  if (/^(ft|postp|postponed|not started|cancelled|ended|final)$/i.test(long)) return false;
  if (/^\d{1,3}(\+\d{1,2})?$/.test(short)) return true;
  if (/live|in play|1h|2h|ht|q1|q2|q3|q4|set|period|inning|half|playing/.test(`${short} ${long}`)) return true;
  return false;
}

function isFinishedStatus(shortStatus: string, longStatus: string): boolean {
  const short = String(shortStatus || '').trim().toLowerCase();
  const long = String(longStatus || '').trim().toLowerCase();
  if (!short && !long) return false;
  if (/^(ft|aet|pen|postp|postponed|canc|cancelled|ended|final|finished)$/i.test(short)) return true;
  if (/full[\s-]?time|match finished|ended|final|finished|postponed|cancelled|abandoned/.test(`${short} ${long}`)) return true;
  return false;
}

function extractEventId(event: any): string {
  return String(
    event?.id ??
    event?.main_id ??
    event?.mainId ??
    event?.fallback_id_1 ??
    event?.fallback_id_2 ??
    event?.fallback_id_3 ??
    event?.match_id ??
    event?.matchId ??
    event?.fixture_id ??
    event?.fixtureId ??
    event?.event_id ??
    event?.eventId ??
    '',
  ).trim();
}

function extractTournamentId(event: any): string {
  return String(
    event?.__league?.id ??
    event?.league_id ??
    event?.leagueId ??
    event?.competition_id ??
    event?.competitionId ??
    event?.tournament_id ??
    event?.tournamentId ??
    event?.league?.id ??
    event?.competition?.id ??
    event?.tournament?.id ??
    '',
  ).trim();
}

function extractTeamName(event: any, side: 'home' | 'away'): string {
  const team = side === 'home'
    ? event?.home_team ?? event?.homeTeam ?? event?.teams?.home?.name ?? event?.home?.name ?? event?.players?.home?.name
    : event?.away_team ?? event?.awayTeam ?? event?.teams?.away?.name ?? event?.away?.name ?? event?.players?.away?.name;
  return String(team ?? '').trim();
}

function extractTeamId(event: any, side: 'home' | 'away'): string {
  const teamId = side === 'home'
    ? event?.home_team_id ?? event?.homeTeamId ?? event?.teams?.home?.id ?? event?.home?.id ?? event?.players?.home?.id
    : event?.away_team_id ?? event?.awayTeamId ?? event?.teams?.away?.id ?? event?.away?.id ?? event?.players?.away?.id;
  return String(teamId ?? '').trim();
}

function extractTeamLogo(event: any, side: 'home' | 'away'): string {
  const logo = side === 'home'
    ? event?.home_team_logo ?? event?.teams?.home?.logo ?? event?.home?.logo
    : event?.away_team_logo ?? event?.teams?.away?.logo ?? event?.away?.logo;
  return String(logo ?? '').trim();
}

function normalizeEvent(event: any, sport: string): NormalizedEvent | null {
  const id = extractEventId(event);
  if (!id) return null;
  const statusShort = normalizeStatusShort(event?.status_short ?? event?.status?.short ?? event?.status ?? event?.state ?? event?.status_code);
  const statusLong = normalizeStatusLong(event?.status_long ?? event?.status?.long ?? event?.status_description ?? event?.statusText);
  const home = extractTeamName(event, 'home');
  const away = extractTeamName(event, 'away');
  const homeTeamId = extractTeamId(event, 'home');
  const awayTeamId = extractTeamId(event, 'away');
  const homeGoals = readScoreNumber(
    event?.home?.goals ??
    event?.home_score ??
    event?.score?.home ??
    event?.scores?.home ??
    event?.goals?.home ??
    event?.result?.home,
  );
  const awayGoals = readScoreNumber(
    event?.away?.goals ??
    event?.away_score ??
    event?.score?.away ??
    event?.scores?.away ??
    event?.goals?.away ??
    event?.result?.away,
  );
  const elapsedRaw = event?.elapsed ?? event?.timer?.elapsed ?? event?.clock?.elapsed ?? event?.minute ?? event?.inj_minute;
  const elapsed = Number.isFinite(Number(elapsedRaw)) ? Number(elapsedRaw) : 0;
  const timer = String(event?.timer?.display ?? event?.clock?.display ?? event?.inj_time ?? event?.time ?? '').trim();
  const score = JSON.stringify({
    home: homeGoals,
    away: awayGoals,
    raw: event?.score ?? event?.scores ?? event?.result ?? null,
  });
  const league = String(
    event?.__league?.name ??
    event?.league_name ??
    event?.league?.name ??
    event?.competition_name ??
    event?.competition?.name ??
    event?.tournament_name ??
    event?.tournament?.name ??
    '',
  ).trim();
  const country = String(
    event?.__league?.country ??
    event?.country ??
    event?.league?.country ??
    event?.competition?.country ??
    event?.tournament?.country ??
    '',
  ).trim();
  const eventDateDate = String(
    event?.event_date ??
    event?.start_time ??
    event?.startTime ??
    event?.match_time ??
    event?.date ??
    event?.scheduled_at ??
    '',
  ).trim();
  const eventDateTime = String(event?.time ?? '').trim();
  const eventDate = parseStatPalDateTime(eventDateDate, eventDateTime);
  const fromLiveEndpoint = Boolean(event?.__from_live_endpoint);
  const inplayOddsRunning = String(event?.inplay_odds_running ?? '').trim().toLowerCase() === 'true';
  const embeddedOdds = parseStatPalMatchOddsPayload(sport, event, { matchId: id, homeTeam: home, awayTeam: away });
  const liveFlag =
    isLiveStatus(statusShort, statusLong) ||
    inplayOddsRunning ||
    (fromLiveEndpoint && !isFinishedStatus(statusShort, statusLong));
  return {
    external_event_id: id,
    sport: normalizeSportKey(sport),
    league,
    home_team: home,
    away_team: away,
    team_match: home && away ? `${home} vs ${away}` : String(event?.name ?? event?.match_name ?? '').trim(),
    event_date: eventDate,
    status: statusLong,
    status_short: statusShort,
    status_long: statusLong,
    is_live: liveFlag ? 1 : 0,
    home_odd: Number(event?.home_odd ?? event?.odds?.home ?? embeddedOdds?.home ?? 0) || 0,
    draw_odd: Number(event?.draw_odd ?? event?.odds?.draw ?? embeddedOdds?.draw ?? 0) || 0,
    away_odd: Number(event?.away_odd ?? event?.odds?.away ?? embeddedOdds?.away ?? 0) || 0,
    elapsed,
    timer,
    score,
    markets: JSON.stringify(event?.markets ?? embeddedOdds?.markets ?? event?.odds ?? {}),
    country,
    home_team_id: homeTeamId,
    away_team_id: awayTeamId,
    home_team_logo: extractTeamLogo(event, 'home'),
    away_team_logo: extractTeamLogo(event, 'away'),
    fixture: event,
    teams: event?.teams ?? null,
    goals: { home: homeGoals, away: awayGoals },
    provider_status: event?.status ?? null,
  };
}

function sportBaseUrls(sport: string): string[] {
  const mapped = statPalSportPath(sport);
  const version = statPalVersion(sport);
  return [`https://statpal.io/api/${version}/${mapped}`];
}

function buildCandidateUrls(apiKey: string, sport: string, paths: string[]): string[] {
  const out: string[] = [];
  for (const base of sportBaseUrls(sport)) {
    for (const path of paths) {
      out.push(appendAccessKey(`${base}${path}`, apiKey));
    }
  }
  return out;
}

function extractOddsRows(payload: any): any[] {
  if (!payload) return [];
  if (Array.isArray(payload.response) && payload.response.length > 0) {
    for (const row of payload.response) {
      const extracted = extractOddsRows(row);
      if (extracted.length > 0) return extracted;
    }
  }
  if (Array.isArray(payload.data) && payload.data.length > 0) {
    for (const row of payload.data) {
      const extracted = extractOddsRows(row);
      if (extracted.length > 0) return extracted;
    }
  }
  if (Array.isArray(payload.odds)) {
    const bookmakerRows = payload.odds.flatMap((market: any) => {
      const books = Array.isArray(market?.bookmaker) ? market.bookmaker : [];
      return books.map((book: any) => ({
        title: market?.name ?? market?.label ?? market?.market ?? '',
        suspended: String(market?.stop ?? '').toLowerCase() === 'true',
        selections: Array.isArray(book?.odd)
          ? book.odd.map((odd: any) => ({
              name: odd?.name ?? odd?.label ?? '',
              value: odd?.value ?? odd?.odd ?? '',
              suspended: String(market?.stop ?? '').toLowerCase() === 'true',
            }))
          : [],
      }));
    });
    if (bookmakerRows.length > 0) return bookmakerRows;
  }
  if (Array.isArray(payload.bets)) {
    const rows = payload.bets.map((bet: any) => ({
      title: bet?.name ?? bet?.label ?? bet?.market ?? '',
      suspended: false,
      selections: Array.isArray(bet?.values)
        ? bet.values.map((value: any) => ({
            name: value?.value ?? value?.name ?? value?.label ?? '',
            odd: value?.odd ?? value?.price ?? value?.value_odd ?? '',
          }))
        : [],
    }));
    if (rows.length > 0) return rows;
  }
  if (Array.isArray(payload.markets)) return payload.markets;
  if (Array.isArray(payload.data?.markets)) return payload.data.markets;
  if (Array.isArray(payload.odds)) return payload.odds;
  if (Array.isArray(payload.data?.odds)) return payload.data.odds;
  if (Array.isArray(payload.bookmakers)) {
    for (const book of payload.bookmakers) {
      if (Array.isArray(book?.bets) && book.bets.length > 0) {
        const rows = book.bets.map((bet: any) => ({
          title: bet?.name ?? bet?.label ?? bet?.market ?? '',
          suspended: false,
          selections: Array.isArray(bet?.values)
            ? bet.values.map((value: any) => ({
                name: value?.value ?? value?.name ?? value?.label ?? '',
                odd: value?.odd ?? value?.price ?? value?.value_odd ?? '',
              }))
            : [],
        }));
        if (rows.length > 0) return rows;
      }
      if (Array.isArray(book?.markets) && book.markets.length > 0) return book.markets;
    }
  }
  if (Array.isArray(payload.providers)) {
    for (const provider of payload.providers) {
      if (Array.isArray(provider?.markets) && provider.markets.length > 0) return provider.markets;
    }
  }
  return [];
}

type StatPalOddsOpts = { homeTeam?: string; awayTeam?: string; matchId?: string; leagueId?: string };

function extractStatPalMatchIds(match: any): string[] {
  const ids = [
    match?.main_id,
    match?.fallback_id_1,
    match?.fallback_id_2,
    match?.fallback_id_3,
    match?.match_info?.main_id,
    match?.match_info?.fallback_id_1,
    match?.match_info?.fallback_id_2,
    match?.match_info?.fallback_id_3,
  ]
    .map((v) => String(v ?? '').trim())
    .filter(Boolean);
  return Array.from(new Set(ids));
}

function normalizeVsName(value: any): string {
  return normalizeLabel(String(value ?? '').replace(/\s+vs\s+/i, ' '));
}

function selectStatPalOddsPayload(payload: any, opts?: StatPalOddsOpts): any {
  if (!payload || !opts) return payload;
  const matchId = String(opts.matchId || '').trim();
  const homeKey = normalizeLabel(opts.homeTeam || '');
  const awayKey = normalizeLabel(opts.awayTeam || '');
  const matchByTeams = (match: any): boolean => {
    const home = normalizeLabel(match?.home?.name ?? match?.team_info?.home?.name ?? '');
    const away = normalizeLabel(match?.away?.name ?? match?.team_info?.away?.name ?? '');
    if (homeKey && awayKey) {
      return home === homeKey && away === awayKey;
    }
    const name = normalizeVsName(match?.match_info?.name ?? '');
    return !!homeKey && !!awayKey && name.includes(homeKey) && name.includes(awayKey);
  };

  if (Array.isArray(payload?.live_matches)) {
    const found = payload.live_matches.find((match: any) => {
      const ids = extractStatPalMatchIds(match);
      return (matchId && ids.includes(matchId)) || matchByTeams(match);
    });
    if (found) return { odds: found?.odds ?? [], match_info: found?.match_info ?? null };
  }

  const genericCollections = [
    Array.isArray(payload?.response) ? payload.response : null,
    Array.isArray(payload?.data) ? payload.data : null,
    Array.isArray(payload?.matches) ? payload.matches : null,
    Array.isArray(payload?.events) ? payload.events : null,
  ].filter(Boolean) as any[][];
  for (const rows of genericCollections) {
    const found = rows.find((match: any) => {
      const ids = [
        ...extractStatPalMatchIds(match),
        String(match?.id ?? '').trim(),
        String(match?.fixture?.id ?? '').trim(),
        String(match?.match_id ?? '').trim(),
        String(match?.event_id ?? '').trim(),
      ].filter(Boolean);
      return (matchId && ids.includes(matchId)) || matchByTeams(match);
    });
    if (found) return found;
  }

  const prematchLeagues = payload?.prematch_odds?.league;
  if (prematchLeagues) {
    const leagues = Array.isArray(prematchLeagues) ? prematchLeagues : [prematchLeagues];
    for (const league of leagues) {
      const matches = Array.isArray(league?.match) ? league.match : [];
      const found = matches.find((match: any) => {
        const ids = extractStatPalMatchIds(match);
        return (matchId && ids.includes(matchId)) || matchByTeams(match);
      });
      if (found) return { odds: found?.odds ?? [], match: found, league };
    }
  }

  return payload;
}

function normalizeLabel(raw: any): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function isHomeLikeLabel(labelKey: string): boolean {
  return /^(home|1|home team|team 1|player 1|participant 1|host|local|casa)$/.test(labelKey);
}

function isAwayLikeLabel(labelKey: string): boolean {
  return /^(away|2|away team|team 2|player 2|participant 2|visitor|visitante|fora)$/.test(labelKey);
}

function inferMarketKey(title: string): string {
  const t = normalizeLabel(title);
  if (!t) return 'other';
  if (/(match winner|1x2|full time result|resultado final|winner)/.test(t)) return 'h2h';
  if (/(both teams to score|btts)/.test(t)) return 'btts';
  if (/(over under|total goals|totals|total games|games total|total rounds)/.test(t)) return 'totals';
  if (/(double chance)/.test(t)) return 'double_chance';
  if (/(correct score|placar exato)/.test(t)) return 'correct_score';
  if (/(handicap|spread)/.test(t)) return 'spreads';
  if (/(next game winner)/.test(t)) return 'next_game_winner';
  if (/(set winner|current set winner)/.test(t)) return 'current_set_winner';
  return t.replace(/\s+/g, '_');
}

function readSelectionLabel(selection: any): string {
  return String(
    selection?.label ??
    selection?.name ??
    selection?.value ??
    selection?.outcome ??
    selection?.participant ??
    selection?.runner ??
    selection?.team ??
    selection?.title ??
    '',
  ).trim();
}

function readSelectionOdd(selection: any): number {
  const raw = selection?.odd ?? selection?.price ?? selection?.value ?? selection?.decimal ?? selection?.decimal_odds ?? selection?.odds;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

export function parseStatPalMatchOddsPayload(
  _sport: string,
  payload: any,
  opts?: StatPalOddsOpts
): OddsResult | null {
  const scopedPayload = selectStatPalOddsPayload(payload, opts);
  const rows = extractOddsRows(scopedPayload);
  if (!rows.length) return null;
  const markets: Record<string, any[]> = {};
  let home = 0;
  let draw = 0;
  let away = 0;
  const homeKey = normalizeLabel(opts?.homeTeam || '');
  const awayKey = normalizeLabel(opts?.awayTeam || '');

  for (const row of rows) {
    const title = String(row?.title ?? row?.name ?? row?.label ?? row?.market ?? row?.type ?? '').trim();
    const key = inferMarketKey(title);
    const selections = row?.selections ?? row?.outcomes ?? row?.choices ?? row?.options ?? row?.odds ?? row?.lines ?? [];
    if (!Array.isArray(selections) || selections.length === 0) continue;
    const out: any[] = [];
    for (const selection of selections) {
      const label = readSelectionLabel(selection);
      const odd = readSelectionOdd(selection);
      if (!label || !(odd > 1)) continue;
      const item: any = { label, value: label, odd };
      const point = selection?.point ?? selection?.line ?? selection?.handicap ?? selection?.total ?? null;
      if (point != null && String(point).trim()) item.handicap = String(point).trim();
      const suspended = Boolean(selection?.suspended || selection?.is_suspended || selection?.status === 'suspended');
      if (suspended) item.suspended = true;
      out.push(item);

      if (key === 'h2h') {
        const labelKey = normalizeLabel(label);
        if (labelKey === 'draw' || labelKey === 'empate' || labelKey === 'x') draw = odd;
        else if (isHomeLikeLabel(labelKey)) home = odd;
        else if (isAwayLikeLabel(labelKey)) away = odd;
        else if (homeKey && (labelKey === homeKey || labelKey.includes(homeKey) || homeKey.includes(labelKey))) home = odd;
        else if (awayKey && (labelKey === awayKey || labelKey.includes(awayKey) || awayKey.includes(labelKey))) away = odd;
      }
    }
    if (out.length > 0) markets[key] = out;
  }

  if (home <= 1 && away <= 1 && draw <= 1 && !Object.keys(markets).length) return null;
  return { home, draw, away, markets };
}

export async function fetchStatPalV1AllScoresDelta(apiKey: string, sport: string): Promise<V1AllScoresDelta> {
  const events = await fetchStatPalLive(apiKey, sport);
  return { events, lastUpdateId: null };
}

export async function fetchStatPalLive(apiKey: string, sport: string): Promise<NormalizedEvent[]> {
  const s = statPalSportPath(sport);
  const paths = s === 'soccer'
    ? ['/matches/live']
    : ['/livescores', '/matches/live', '/matches?status=live'];
  const json = await fetchFirstJson(buildCandidateUrls(apiKey, sport, paths), PROVIDER_LIVE_TIMEOUT_MS);
  const events = extractEvents(json)
    .map((row) => normalizeEvent({ ...row, __from_live_endpoint: true }, sport))
    .filter(Boolean) as NormalizedEvent[];
  return events;
}

export async function fetchStatPalSchedule(apiKey: string, sport: string, date: string): Promise<NormalizedEvent[]> {
  const s = statPalSportPath(sport);
  if (s === 'soccer') {
    const offset = utcDayDiffFromToday(date);
    if (offset != null && offset >= -7 && offset <= 7) {
      const targetDate = dateOnlyIso(date);
      // StatPal soccer daily has been unstable with offset=0 in production.
      // For "today", prefer the known-good -1 feed and keep only rows that
      // actually normalize to the requested date so pregame does not reuse live.
      const offsetsToTry = offset === 0 ? [-1, 0] : [offset];
      for (const dailyOffset of offsetsToTry) {
        const dailyUrl = buildCandidateUrls(apiKey, sport, [
          `/matches/daily?offset=${encodeURIComponent(String(dailyOffset))}`,
        ]);
        const dailyJson = await fetchFirstJson(dailyUrl, PROVIDER_TIMEOUT_MS);
        const dailyEvents = extractEvents(dailyJson)
          .map((row) => normalizeEvent(row, sport))
          .filter(Boolean) as NormalizedEvent[];
        if (dailyEvents.length === 0) continue;
        if (!targetDate) return dailyEvents;
        const sameDay = dailyEvents.filter((event) => dateOnlyIso(String(event?.event_date || '')) === targetDate);
        if (sameDay.length > 0) return sameDay;
        if (dailyOffset === offset) return dailyEvents;
      }
    }
    return [];
  }
  const dateVariants = Array.from(new Set(formatDateVariants(date)));
  const paths = dateVariants.flatMap((d) => [
        `/schedule?date=${encodeURIComponent(d)}`,
        `/matches?date=${encodeURIComponent(d)}`,
        `/fixtures?date=${encodeURIComponent(d)}`,
        `/upcoming?date=${encodeURIComponent(d)}`,
        `/matches/upcoming?date=${encodeURIComponent(d)}`,
      ]);
  const json = await fetchFirstJson(buildCandidateUrls(apiKey, sport, paths), PROVIDER_TIMEOUT_MS);
  const events = extractEvents(json).map((row) => normalizeEvent(row, sport)).filter(Boolean) as NormalizedEvent[];
  return events;
}

export async function fetchStatPalMatchOddsAll(
  apiKey: string,
  sport: string,
  matchId: string,
  opts?: StatPalOddsOpts
): Promise<OddsResult | null> {
  const json = await fetchFirstJson(
    buildCandidateUrls(apiKey, sport, [
      `/matches/${encodeURIComponent(matchId)}/odds`,
      `/match/${encodeURIComponent(matchId)}/odds`,
      `/matches/${encodeURIComponent(matchId)}/liveodds`,
      `/odds?match_id=${encodeURIComponent(matchId)}`,
      `/odds?event_id=${encodeURIComponent(matchId)}`,
      '/odds',
    ]),
    PROVIDER_TIMEOUT_MS,
  );
  let parsed = parseStatPalMatchOddsPayload(sport, json, { ...opts, matchId });
  if (!parsed) {
    const genericJson = await fetchFirstJson(
      buildCandidateUrls(apiKey, sport, ['/odds']),
      PROVIDER_TIMEOUT_MS,
    );
    parsed = parseStatPalMatchOddsPayload(sport, genericJson, { ...opts, matchId });
  }
  return parsed;
}

export async function fetchStatPalMatchOddsLive(
  apiKey: string,
  sport: string,
  matchId: string,
  opts?: StatPalOddsOpts
): Promise<OddsResult | null> {
  const json = await fetchFirstJson(
    buildCandidateUrls(apiKey, sport, [
      `/matches/${encodeURIComponent(matchId)}/liveodds`,
      `/match/${encodeURIComponent(matchId)}/liveodds`,
      `/matches/${encodeURIComponent(matchId)}/odds/live`,
      `/odds/live?match_id=${encodeURIComponent(matchId)}`,
      `/odds/live?event_id=${encodeURIComponent(matchId)}`,
    ]),
    PROVIDER_TIMEOUT_MS,
  );
  let parsed = parseStatPalMatchOddsPayload(sport, json, { ...opts, matchId });
  if (!parsed) {
    const liveJson = await fetchFirstJson(
      buildCandidateUrls(apiKey, sport, [
        '/odds/live',
        '/liveodds',
      ]),
      PROVIDER_TIMEOUT_MS,
    );
    parsed = parseStatPalMatchOddsPayload(sport, liveJson, { ...opts, matchId });
  }
  return parsed;
}

export async function fetchStatPalMatchOddsPreMatch(
  apiKey: string,
  sport: string,
  matchId: string,
  opts?: StatPalOddsOpts
): Promise<OddsResult | null> {
  const json = await fetchFirstJson(
    buildCandidateUrls(apiKey, sport, [
      `/matches/${encodeURIComponent(matchId)}/odds/pre-match`,
      `/match/${encodeURIComponent(matchId)}/odds/pre-match`,
      `/matches/${encodeURIComponent(matchId)}/prematch-odds`,
      `/matches/${encodeURIComponent(matchId)}/odds`,
      `/odds/prematch?match_id=${encodeURIComponent(matchId)}`,
      `/odds/prematch?event_id=${encodeURIComponent(matchId)}`,
      `/prematch-odds?match_id=${encodeURIComponent(matchId)}`,
    ]),
    PROVIDER_TIMEOUT_MS,
  );
  let parsed = parseStatPalMatchOddsPayload(sport, json, { ...opts, matchId });
  if (!parsed && statPalSportPath(sport) === 'soccer' && opts?.leagueId) {
    const prematchJson = await fetchFirstJson(
      buildCandidateUrls(apiKey, sport, [
        `/leagues/${encodeURIComponent(opts.leagueId)}/odds/prematch`,
      ]),
      PROVIDER_TIMEOUT_MS,
    );
    parsed = parseStatPalMatchOddsPayload(sport, prematchJson, { ...opts, matchId });
  }
  if (!parsed) {
    const genericJson = await fetchFirstJson(
      buildCandidateUrls(apiKey, sport, [
        '/odds/prematch',
        '/prematch-odds',
        '/odds',
      ]),
      PROVIDER_TIMEOUT_MS,
    );
    parsed = parseStatPalMatchOddsPayload(sport, genericJson, { ...opts, matchId });
  }
  return parsed;
}

export async function fetchStatPalMatchStatistics(apiKey: string, sport: string, matchId: string): Promise<any | null> {
  return fetchFirstJson(
    buildCandidateUrls(apiKey, sport, [
      `/matches/${encodeURIComponent(matchId)}/statistics`,
      `/match/${encodeURIComponent(matchId)}/statistics`,
      `/matches/${encodeURIComponent(matchId)}/stats`,
      `/match/${encodeURIComponent(matchId)}/stats`,
    ]),
    PROVIDER_TIMEOUT_MS,
  );
}

export async function fetchStatPalMatchIncidents(apiKey: string, sport: string, matchId: string): Promise<any | null> {
  return fetchFirstJson(
    buildCandidateUrls(apiKey, sport, [
      `/matches/${encodeURIComponent(matchId)}/incidents`,
      `/match/${encodeURIComponent(matchId)}/incidents`,
      `/matches/${encodeURIComponent(matchId)}/events`,
      `/match/${encodeURIComponent(matchId)}/events`,
      `/matches/${encodeURIComponent(matchId)}/play-by-play`,
    ]),
    PROVIDER_TIMEOUT_MS,
  );
}

export async function fetchStatPalH2H(apiKey: string, sport: string, matchId: string): Promise<any | null> {
  return fetchFirstJson(
    buildCandidateUrls(apiKey, sport, [
      `/matches/${encodeURIComponent(matchId)}/head-to-head`,
      `/match/${encodeURIComponent(matchId)}/head-to-head`,
      `/matches/${encodeURIComponent(matchId)}/h2h`,
      `/match/${encodeURIComponent(matchId)}/h2h`,
    ]),
    PROVIDER_TIMEOUT_MS,
  );
}

export async function fetchStatPalSoccerH2HByTeams(apiKey: string, team1Id: string, team2Id: string): Promise<any | null> {
  if (!team1Id || !team2Id) return null;
  return fetchFirstJson(
    buildCandidateUrls(apiKey, 'soccer', [
      `/head-to-head?team1_id=${encodeURIComponent(team1Id)}&team2_id=${encodeURIComponent(team2Id)}`,
    ]),
    PROVIDER_TIMEOUT_MS,
  );
}

export async function fetchStatPalSoccerInjuriesSuspensions(apiKey: string): Promise<any | null> {
  return fetchFirstJson(
    buildCandidateUrls(apiKey, 'soccer', [
      '/injuries-suspensions',
    ]),
    PROVIDER_TIMEOUT_MS,
  );
}

export async function fetchStatPalSoccerTeam(apiKey: string, teamId: string): Promise<any | null> {
  if (!teamId) return null;
  return fetchFirstJson(
    buildCandidateUrls(apiKey, 'soccer', [
      `/teams/${encodeURIComponent(teamId)}`,
    ]),
    PROVIDER_TIMEOUT_MS,
  );
}

export async function fetchStatPalSoccerPlayer(apiKey: string, playerId: string): Promise<any | null> {
  if (!playerId) return null;
  return fetchFirstJson(
    buildCandidateUrls(apiKey, 'soccer', [
      `/players/${encodeURIComponent(playerId)}`,
    ]),
    PROVIDER_TIMEOUT_MS,
  );
}

export async function fetchStatPalSoccerCoach(apiKey: string, coachId: string): Promise<any | null> {
  if (!coachId) return null;
  return fetchFirstJson(
    buildCandidateUrls(apiKey, 'soccer', [
      `/coaches/${encodeURIComponent(coachId)}`,
    ]),
    PROVIDER_TIMEOUT_MS,
  );
}

export async function fetchStatPalSoccerLiveStorylines(apiKey: string, matchId?: string): Promise<any | null> {
  const suffix = matchId ? `?match_id=${encodeURIComponent(String(matchId).trim())}` : '';
  return fetchFirstJson(
    buildCandidateUrls(apiKey, 'soccer', [
      `/live-storylines${suffix}`,
    ]),
    PROVIDER_TIMEOUT_MS,
  );
}

export async function fetchStatPalSoccerTeamLineups(apiKey: string, matchId?: string): Promise<any | null> {
  const suffix = matchId ? `?match_id=${encodeURIComponent(String(matchId).trim())}` : '';
  return fetchFirstJson(
    buildCandidateUrls(apiKey, 'soccer', [
      `/team-lineups${suffix}`,
    ]),
    PROVIDER_TIMEOUT_MS,
  );
}

export async function fetchStatPalSoccerWeatherForecast(apiKey: string): Promise<any | null> {
  return fetchFirstJson(
    buildCandidateUrls(apiKey, 'soccer', [
      '/weather-forecast',
    ]),
    PROVIDER_TIMEOUT_MS,
  );
}

export async function fetchStatPalSoccerPredictions(apiKey: string): Promise<any | null> {
  return fetchFirstJson(
    buildCandidateUrls(apiKey, 'soccer', [
      '/predictions',
    ]),
    PROVIDER_TIMEOUT_MS,
  );
}

export async function fetchStatPalSoccerLiveOddsMarkets(apiKey: string): Promise<any | null> {
  return fetchFirstJson(
    buildCandidateUrls(apiKey, 'soccer', [
      '/odds/live/markets',
    ]),
    PROVIDER_TIMEOUT_MS,
  );
}

export async function fetchStatPalSoccerLiveOddsMatchStates(apiKey: string): Promise<any | null> {
  return fetchFirstJson(
    buildCandidateUrls(apiKey, 'soccer', [
      '/odds/live/match-states',
    ]),
    PROVIDER_TIMEOUT_MS,
  );
}

export async function fetchStatPalStandings(apiKey: string, sport: string, tournamentId: string): Promise<any | null> {
  return fetchFirstJson(
    buildCandidateUrls(apiKey, sport, [
      `/leagues/${encodeURIComponent(tournamentId)}/standings`,
      `/league/${encodeURIComponent(tournamentId)}/standings`,
      `/tournaments/${encodeURIComponent(tournamentId)}/standings`,
      `/tournament/${encodeURIComponent(tournamentId)}/standings`,
    ]),
    PROVIDER_TIMEOUT_MS,
  );
}

export async function fetchStatPalLeagueMatches(apiKey: string, leagueId: string): Promise<NormalizedEvent[]> {
  const json = await fetchFirstJson(
    buildCandidateUrls(apiKey, 'soccer', [
      `/leagues/${encodeURIComponent(leagueId)}/matches`,
    ]),
    PROVIDER_TIMEOUT_MS,
  );
  return extractEvents(json).map((row) => normalizeEvent(row, 'soccer')).filter(Boolean) as NormalizedEvent[];
}

export async function fetchStatPalLeagueMatchStats(apiKey: string, leagueId: string): Promise<any | null> {
  return fetchFirstJson(
    buildCandidateUrls(apiKey, 'soccer', [
      `/leagues/${encodeURIComponent(leagueId)}/matches/stats`,
    ]),
    PROVIDER_TIMEOUT_MS,
  );
}

export async function fetchStatPalLeagueStats(apiKey: string, leagueId: string): Promise<any | null> {
  return fetchFirstJson(
    buildCandidateUrls(apiKey, 'soccer', [
      `/leagues/${encodeURIComponent(leagueId)}/stats`,
    ]),
    PROVIDER_TIMEOUT_MS,
  );
}

export async function fetchStatPalWorldCup2026(_apiKey: string): Promise<any | null> {
  return null;
}

export async function fetchStatPalWorldCup2026Info(_apiKey: string): Promise<any | null> {
  return null;
}

export async function fetchStatPalWorldCup2026Groups(_apiKey: string): Promise<any | null> {
  return null;
}

export async function fetchStatPalWorldCup2026Matches(_apiKey: string, _page: number): Promise<NormalizedEvent[]> {
  return [];
}

export function getStatPalTournamentId(event: any): string {
  return extractTournamentId(event);
}
