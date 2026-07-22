import process from 'node:process';
import type { NormalizedEvent, OddsResult, V1AllScoresDelta } from './types.js';

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

// SportsApiPro-compatible fetch: sends x-api-key HEADER (no query param).
// StatPal non-soccer subdomain endpoints (v2.basketball.statpal.io etc.) use this auth format.
async function fetchJsonXApiKey(url: string, apiKey: string, timeoutMs: number = PROVIDER_TIMEOUT_MS): Promise<any | null> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'x-api-key': apiKey, accept: 'application/json' },
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

async function fetchFirstJsonXApiKey(urls: string[], apiKey: string, timeoutMs: number): Promise<any | null> {
  for (const url of urls) {
    const json = await fetchJsonXApiKey(url, apiKey, timeoutMs);
    if (json) return json;
  }
  return null;
}

// Map sport to the SportsApiPro-compatible subdomain slug.
// StatPal non-soccer uses: https://v2.{sub}.statpal.io/api/... with x-api-key header.
function sportsApiProSubdomain(sport: string): string {
  const s = normalizeSportKey(sport);
  if (s === 'soccer' || s === 'football' || s === 'futebol') return 'football';
  if (s === 'ice-hockey' || s === 'icehockey' || s === 'hockey' || s === 'nhl') return 'hockey';
  if (s === 'basketball' || s === 'nba') return 'basketball';
  if (s === 'baseball' || s === 'mlb') return 'baseball';
  if (s === 'tennis') return 'tennis';
  if (s === 'volleyball' || s === 'volei') return 'volleyball';
  if (s === 'mma' || s === 'ufc') return 'mma';
  return s || 'football';
}

// Build SportsApiPro-compatible subdomain URLs for StatPal (no auth appended — use fetchJsonXApiKey).
// Produces: https://v2.{sub}.statpal.io{path} and https://v1.{sub}.statpal.io{path}
function buildSportsApiProStyleUrls(sport: string, paths: string[]): string[] {
  const sub = sportsApiProSubdomain(sport);
  const out: string[] = [];
  for (const path of paths) {
    out.push(`https://v2.${sub}.statpal.io${path}`);
    out.push(`https://v1.${sub}.statpal.io${path}`);
  }
  return out;
}

function extractEvents(payload: any): any[] {
  if (!payload) return [];
  const flattenLeagueBlocks = (blocks: any[]): any[] => {
    const out: any[] = [];
    for (const block of blocks) {
      // Support both English and Portuguese (StatPal /matches/daily) keys
      const leagueMeta = {
        id: block?.id ?? '',
        name: block?.name ?? block?.nome ?? '',
        country: block?.country ?? block?.país ?? block?.pais ?? '',
        cup: block?.cup ?? block?.xícara ?? block?.xicara ?? '',
      };
      // "corresponder" = Portuguese for "match" (used in /matches/daily, livescores, upcoming-schedule)
      const directRows = block?.match ?? block?.corresponder ?? block?.matches ?? block?.events ?? block?.games ?? block?.fixtures;
      if (Array.isArray(directRows)) {
        for (const row of directRows) out.push({ ...row, __league: leagueMeta });
        continue;
      }
      // V1 extended_fixtures / results: weeks array ("semana" = Portuguese for "week")
      // Structure: liga[].semana[].corresponder[]
      const weeks = block?.semana ?? block?.week;
      if (Array.isArray(weeks)) {
        for (const week of weeks) {
          const weekRows = week?.match ?? week?.corresponder ?? week?.matches ?? week?.events ?? [];
          if (Array.isArray(weekRows)) {
            for (const row of weekRows) out.push({ ...row, __league: leagueMeta });
          }
        }
        continue;
      }
      // Single match object (not array) — e.g. comentários.liga.corresponder
      if (directRows && typeof directRows === 'object') {
        out.push({ ...directRows, __league: leagueMeta });
      }
    }
    return out;
  };
  const flattenDirectMatchRows = (rows: any[], extra?: Record<string, any>): any[] =>
    rows.map((row) => ({ ...(row || {}), ...(extra || {}) }));
  const flattenPrematchLeagueBlocks = (blocks: any[]): any[] => {
    const out: any[] = [];
    for (const block of blocks) {
      const leagueMeta = {
        id: block?.id ?? block?.league_id ?? block?.league?.id ?? '',
        name: block?.name ?? block?.league_name ?? block?.league?.name ?? '',
        country: block?.country ?? block?.league?.country ?? '',
        cup: block?.cup ?? '',
      };
      const rows = block?.match ?? block?.matches ?? block?.events ?? block?.games ?? [];
      if (Array.isArray(rows)) {
        for (const row of rows) out.push({ ...row, __league: leagueMeta });
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
  if (Array.isArray(payload?.data?.live_matches?.league)) return flattenLeagueBlocks(payload.data.live_matches.league);
  if (Array.isArray(payload?.upcoming_matches?.league)) return flattenLeagueBlocks(payload.upcoming_matches.league);
  if (Array.isArray(payload?.data?.upcoming_matches?.league)) return flattenLeagueBlocks(payload.data.upcoming_matches.league);
  if (Array.isArray(payload?.live_matches)) return flattenDirectMatchRows(payload.live_matches, { __from_live_endpoint: true });
  if (Array.isArray(payload?.data?.live_matches)) return flattenDirectMatchRows(payload.data.live_matches, { __from_live_endpoint: true });
  if (Array.isArray(payload?.upcoming_matches)) return flattenDirectMatchRows(payload.upcoming_matches);
  if (Array.isArray(payload?.data?.upcoming_matches)) return flattenDirectMatchRows(payload.data.upcoming_matches);
  if (Array.isArray(payload?.prematch_odds?.league)) return flattenPrematchLeagueBlocks(payload.prematch_odds.league);
  if (Array.isArray(payload?.data?.prematch_odds?.league)) return flattenPrematchLeagueBlocks(payload.data.prematch_odds.league);
  if (Array.isArray(payload?.league)) return flattenLeagueBlocks(payload.league);
  // Portuguese top-level key: "liga" = "league" (e.g. StatPal /leagues endpoint)
  if (Array.isArray(payload?.liga)) return flattenLeagueBlocks(payload.liga);

  // StatPal v1 soccer endpoints — all use Portuguese root keys wrapping a "liga" array:
  // /livescores, /daily/d-N      → "livescore"        (placar ao vivo)
  // /upcoming-schedule/region   → "acessórios"        (acessorios = fixtures)
  // /extended-schedule/region   → "extended_fixtures" (semana[].corresponder[])
  // /results/region             → "resultados"        (semana[].corresponder[])
  // /live-match-stats/region    → "comentários"       (liga is single object)
  if (Array.isArray(payload?.livescore?.liga)) return flattenLeagueBlocks(payload.livescore.liga);
  if (Array.isArray(payload?.['acessórios']?.liga)) return flattenLeagueBlocks(payload['acessórios'].liga);
  if (Array.isArray(payload?.acessorios?.liga)) return flattenLeagueBlocks(payload.acessorios.liga);
  if (Array.isArray(payload?.extended_fixtures?.liga)) return flattenLeagueBlocks(payload.extended_fixtures.liga);
  if (Array.isArray(payload?.resultados?.liga)) return flattenLeagueBlocks(payload.resultados.liga);
  // comentários.liga may be a single object (not array) — wrap it
  if (payload?.['comentários']?.liga && !Array.isArray(payload?.['comentários']?.liga)) {
    return flattenLeagueBlocks([payload['comentários'].liga]);
  }
  if (payload?.comentarios?.liga && !Array.isArray(payload?.comentarios?.liga)) {
    return flattenLeagueBlocks([payload.comentarios.liga]);
  }

  // StatPal v1 tennis endpoints — use "torneio" (tournament) instead of "liga"
  // /livescores  → "pontuações ao vivo".torneio[]  (key has spaces!)
  // /livestats   → "estatísticas ao vivo".torneio[]
  // /daily/d-N   → "pontuações".torneio[]  (can be array or single object with semana[])
  // /tournament  → "pontuações".torneio{}  (single object, has semana[].corresponder[])
  // Tournament blocks have "corresponder" (single obj or array) or "semana[].corresponder[]"
  // flattenLeagueBlocks already handles both patterns.
  if (Array.isArray(payload?.['pontuações ao vivo']?.torneio)) return flattenLeagueBlocks(payload['pontuações ao vivo'].torneio);
  // NBA livescores: "pontuações ao vivo".torneio is a single object (not array) with corresponder[]
  if (payload?.['pontuações ao vivo']?.torneio && !Array.isArray(payload['pontuações ao vivo'].torneio)) {
    return flattenLeagueBlocks([payload['pontuações ao vivo'].torneio]);
  }
  if (Array.isArray(payload?.['estatísticas ao vivo']?.torneio)) return flattenLeagueBlocks(payload['estatísticas ao vivo'].torneio);
  // NBA/basketball livestats: "estatísticas ao vivo".torneio may also be a single object
  if (payload?.['estatísticas ao vivo']?.torneio && !Array.isArray(payload['estatísticas ao vivo'].torneio)) {
    return flattenLeagueBlocks([payload['estatísticas ao vivo'].torneio]);
  }
  if (Array.isArray(payload?.['pontuações']?.torneio)) return flattenLeagueBlocks(payload['pontuações'].torneio);
  if (payload?.['pontuações']?.torneio && !Array.isArray(payload['pontuações'].torneio)) {
    // Single tournament object (e.g. NBA /daily, /season-schedule, tennis /tournament/{id})
    return flattenLeagueBlocks([payload['pontuações'].torneio]);
  }
  if (Array.isArray(payload?.matches?.tournament?.week)) {
    return flattenTournamentWeeks(payload.matches.tournament.week, payload.matches.tournament);
  }
  if (Array.isArray(payload?.data?.matches?.tournament?.week)) {
    return flattenTournamentWeeks(payload.data.matches.tournament.week, payload.data.matches.tournament);
  }
  for (const [key, value] of Object.entries(payload)) {
    if (!/^matches_\d{2}_\d{2}_\d{4}$/i.test(String(key))) continue;
    if (Array.isArray((value as any)?.league)) return flattenLeagueBlocks((value as any).league);
    // Portuguese: "liga" = "league" (StatPal /matches/daily returns Portuguese keys)
    if (Array.isArray((value as any)?.liga)) return flattenLeagueBlocks((value as any).liga);
  }
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.matches)) return payload.matches;
  if (Array.isArray(payload.events)) return payload.events;
  if (Array.isArray(payload.games)) return payload.games;
  if (Array.isArray(payload.response)) return payload.response;
  if (Array.isArray(payload.schedule)) return payload.schedule;
  if (Array.isArray(payload.data?.matches)) return payload.data.matches;
  if (Array.isArray(payload.data?.events)) return payload.data.events;
  if (Array.isArray(payload.data?.games)) return payload.data.games;
  if (Array.isArray(payload.data?.response)) return payload.data.response;
  if (Array.isArray(payload.data?.schedule)) return payload.data.schedule;
  if (Array.isArray(payload.livescores)) return payload.livescores;
  if (Array.isArray(payload.data?.livescores)) return payload.data.livescores;
  // StatPal v1: livescores is an object with nested game/match array (e.g. NBA, MLB, NHL, Tennis)
  if (payload?.livescores && typeof payload.livescores === 'object' && !Array.isArray(payload.livescores)) {
    for (const key of ['game', 'match', 'games', 'matches', 'events', 'fixture', 'fixtures', 'records']) {
      if (Array.isArray((payload.livescores as any)[key]) && (payload.livescores as any)[key].length > 0) {
        return (payload.livescores as any)[key];
      }
    }
  }
  if (payload?.data?.livescores && typeof payload.data.livescores === 'object' && !Array.isArray(payload.data.livescores)) {
    for (const key of ['game', 'match', 'games', 'matches', 'events', 'fixture', 'fixtures', 'records']) {
      if (Array.isArray((payload.data.livescores as any)[key]) && (payload.data.livescores as any)[key].length > 0) {
        return (payload.data.livescores as any)[key];
      }
    }
  }
  if (Array.isArray(payload?.live_matches?.matches)) return payload.live_matches.matches;
  if (Array.isArray(payload?.data?.live_matches?.matches)) return payload.data.live_matches.matches;
  if (Array.isArray(payload?.upcoming_matches?.matches)) return payload.upcoming_matches.matches;
  if (Array.isArray(payload?.data?.upcoming_matches?.matches)) return payload.data.upcoming_matches.matches;
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
  const raw = readStatusValue(v, ['short', 'short_name', 'status_short', 'code', 'type', 'display', 'name']);
  return raw || 'NS';
}

function normalizeStatusLong(v: any): string {
  const raw = readStatusValue(v, ['long', 'long_name', 'status_long', 'description', 'display', 'name', 'short']);
  return raw || 'Not Started';
}

function isLiveStatus(shortStatus: string, longStatus: string): boolean {
  const short = String(shortStatus || '').trim().toLowerCase();
  const long = String(longStatus || '').trim().toLowerCase();
  if (!short && !long) return false;
  // Portuguese tennis/soccer finished statuses: "Concluído" = completed, "Aposentado" = retired
  if (/^(ft|postp|postponed|ns|not started|canc|cancelled|ended|final|conclu[íi]do|aposentado|retired|walkover)$/i.test(short)) return false;
  if (/^(ft|postp|postponed|not started|cancelled|ended|final|conclu[íi]do|aposentado|retired)$/i.test(long)) return false;
  if (/^\d{1,3}(\+\d{1,2})?$/.test(short)) return true;
  if (/live|in play|1h|2h|ht|q1|q2|q3|q4|1q|2q|3q|4q|set|period|inning|half|playing|overtime|ot\b|p1\b|p2\b|p3\b|in_progress|ongoing|active/.test(`${short} ${long}`)) return true;
  return false;
}

function isFinishedStatus(shortStatus: string, longStatus: string): boolean {
  const short = String(shortStatus || '').trim().toLowerCase();
  const long = String(longStatus || '').trim().toLowerCase();
  if (!short && !long) return false;
  // Portuguese tennis statuses: "Concluído" = completed, "Aposentado" = retired/walkover
  if (/^(ft|aet|pen|postp|postponed|canc|cancelled|ended|final|finished|conclu[íi]do|aposentado|retired|walkover|tempo integral)$/i.test(short)) return true;
  if (/full[\s-]?time|match finished|ended|final|finished|postponed|cancelled|abandoned|conclu[íi]do|aposentado/.test(`${short} ${long}`)) return true;
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
    event?.match_info?.main_id ??
    event?.match_info?.fallback_id_1 ??
    event?.match_info?.fallback_id_2 ??
    event?.match_info?.fallback_id_3 ??
    event?.match_info?.match_id ??
    event?.match_info?.id ??
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
    event?.match_info?.league_id ??
    event?.match_info?.competition_id ??
    event?.match_info?.tournament_id ??
    '',
  ).trim();
}

function extractTeamName(event: any, side: 'home' | 'away'): string {
  // Tennis: jogador[] = players array (jogador[0] = home/player1, jogador[1] = away/player2)
  const players = Array.isArray(event?.jogador) ? event.jogador : null;
  const team = side === 'home'
    // English keys, then Portuguese: "lar" = home, "nome" = name (StatPal /matches/daily)
    ? event?.home_team ?? event?.homeTeam ?? event?.player_1 ??
      event?.teams?.home?.name ?? event?.home?.name ?? event?.home?.nome ??
      event?.lar?.name ?? event?.lar?.nome ??
      event?.players?.home?.name ?? event?.team_info?.home?.name ?? event?.match_info?.team_info?.home?.name ??
      players?.[0]?.nome  // Tennis player 1
    // English keys, then Portuguese: "ausente" = away (StatPal /matches/daily)
    : event?.away_team ?? event?.visitor_team ?? event?.guest_team ?? event?.awayTeam ?? event?.player_2 ??
      event?.teams?.away?.name ?? event?.away?.name ?? event?.away?.nome ??
      event?.ausente?.name ?? event?.ausente?.nome ??
      event?.players?.away?.name ?? event?.team_info?.away?.name ?? event?.match_info?.team_info?.away?.name ??
      players?.[1]?.nome;  // Tennis player 2
  return String(team ?? '').trim();
}

function extractTeamId(event: any, side: 'home' | 'away'): string {
  const players = Array.isArray(event?.jogador) ? event.jogador : null;
  const teamId = side === 'home'
    ? event?.home_team_id ?? event?.homeTeamId ??
      event?.teams?.home?.id ?? event?.home?.id ?? event?.lar?.id ??
      event?.players?.home?.id ?? event?.team_info?.home?.id ?? event?.match_info?.team_info?.home?.id ??
      players?.[0]?.id  // Tennis player 1
    : event?.away_team_id ?? event?.awayTeamId ??
      event?.teams?.away?.id ?? event?.away?.id ?? event?.ausente?.id ??
      event?.players?.away?.id ?? event?.team_info?.away?.id ?? event?.match_info?.team_info?.away?.id ??
      players?.[1]?.id;  // Tennis player 2
  return String(teamId ?? '').trim();
}

function extractTeamLogo(event: any, side: 'home' | 'away'): string {
  const logo = side === 'home'
    ? event?.home_team_logo ?? event?.teams?.home?.logo ?? event?.home?.logo ?? event?.team_info?.home?.logo ?? event?.match_info?.team_info?.home?.logo
    : event?.away_team_logo ?? event?.teams?.away?.logo ?? event?.away?.logo ?? event?.team_info?.away?.logo ?? event?.match_info?.team_info?.away?.logo;
  return String(logo ?? '').trim();
}

function parseScoreText(raw: any): { home: number | null; away: number | null } {
  const value = String(raw ?? '').trim();
  if (!value) return { home: null, away: null };
  const match = value.match(/(\d+)\s*[:\-]\s*(\d+)/);
  if (!match) return { home: null, away: null };
  return { home: Number(match[1]), away: Number(match[2]) };
}

function normalizeEvent(event: any, sport: string): NormalizedEvent | null {
  const id = extractEventId(event);
  if (!id) return null;
  const statusShort = normalizeStatusShort(
    event?.status_short ??
    event?.status?.short ??
    event?.status ??
    event?.state ??
    event?.status_code ??
    event?.match_info?.status_short ??
    event?.match_info?.status ??
    event?.match_info?.state ??
    event?.match_info?.period ??
    event?.match_info?.match_status
  );
  const statusLong = normalizeStatusLong(
    event?.status_long ??
    event?.status?.long ??
    event?.status_description ??
    event?.statusText ??
    event?.match_info?.status_long ??
    event?.match_info?.status_description ??
    event?.match_info?.status_text ??
    event?.match_info?.period ??
    event?.match_info?.state
  );
  const home = extractTeamName(event, 'home');
  const away = extractTeamName(event, 'away');
  const homeTeamId = extractTeamId(event, 'home');
  const awayTeamId = extractTeamId(event, 'away');
  const parsedMatchInfoScore = parseScoreText(event?.match_info?.score);
  // Tennis: jogador[0]/[1] = players, totalscore = sets won
  const tennisPlayers = Array.isArray(event?.jogador) ? event.jogador : null;
  const homeGoals = readScoreNumber(
    event?.home?.goals ??
    event?.home?.score ??     // /leagues/{id}/matches uses "score" not "goals"
    event?.lar?.metas ??      // Portuguese /matches/daily: home goals ("metas" or "gols")
    event?.lar?.gols ??
    event?.lar?.totalscore ?? // NBA/basketball: total points scored by home team
    event?.home_score ??
    event?.score?.home ??
    event?.scores?.home ??
    event?.goals?.home ??
    event?.result?.home ??
    parsedMatchInfoScore.home ??
    tennisPlayers?.[0]?.totalscore,  // Tennis: sets won by player 1
  );
  const awayGoals = readScoreNumber(
    event?.away?.goals ??
    event?.away?.score ??     // /leagues/{id}/matches uses "score" not "goals"
    event?.ausente?.gols ??   // Portuguese /matches/daily: away goals ("gols" or "metas")
    event?.ausente?.metas ??
    event?.ausente?.totalscore ?? // NBA/basketball: total points scored by away team
    event?.away_score ??
    event?.score?.away ??
    event?.scores?.away ??
    event?.goals?.away ??
    event?.result?.away ??
    parsedMatchInfoScore.away ??
    tennisPlayers?.[1]?.totalscore,  // Tennis: sets won by player 2
  );
  const elapsedRaw = event?.elapsed ?? event?.timer?.elapsed ?? event?.clock?.elapsed ?? event?.minute ?? event?.inj_minute ?? event?.match_info?.minute;
  const elapsed = Number.isFinite(Number(elapsedRaw)) ? Number(elapsedRaw) : 0;
  const timer = String(event?.timer?.display ?? event?.clock?.display ?? event?.inj_time ?? event?.time ?? event?.match_info?.minute ?? '').trim();
  const score = JSON.stringify({
    home: homeGoals,
    away: awayGoals,
    raw: event?.score ?? event?.scores ?? event?.result ?? event?.match_info?.score ?? null,
  });
  const league = String(
    event?.__league?.name ??
    event?.league_name ??
    event?.league?.name ??
    event?.competition_name ??
    event?.competition?.name ??
    event?.tournament_name ??
    event?.tournament?.name ??
    event?.match_info?.league_name ??
    event?.match_info?.competition_name ??
    event?.match_info?.tournament_name ??
    '',
  ).trim();
  const country = String(
    event?.__league?.country ??
    event?.country ??
    event?.league?.country ??
    event?.competition?.country ??
    event?.tournament?.country ??
    event?.match_info?.country ??
    '',
  ).trim();
  const eventDateDate = String(
    event?.event_date ??
    event?.start_time ??
    event?.startTime ??
    event?.match_time ??
    event?.date ??
    event?.data ??            // Portuguese /matches/daily: "data" = date
    event?.scheduled_at ??
    event?.match_info?.date ??
    event?.match_info?.match_date ??
    '',
  ).trim();
  const eventDateTime = String(
    event?.time ??
    event?.hora ??            // Portuguese /matches/daily: "hora" = time
    event?.match_info?.time ??
    event?.match_info?.kickoff_time ??
    ''
  ).trim();
  const eventDate = parseStatPalDateTime(eventDateDate, eventDateTime);
  const fromLiveEndpoint = Boolean(event?.__from_live_endpoint);
  const inplayOddsRunning = String(event?.inplay_odds_running ?? '').trim().toLowerCase() === 'true';
  const embeddedOdds = parseStatPalMatchOddsPayload(sport, event, { matchId: id, homeTeam: home, awayTeam: away });
  const notFinished = !isFinishedStatus(statusShort, statusLong);
  const liveFlag =
    isLiveStatus(statusShort, statusLong) ||
    // Guard inplay_odds_running with "not finished" — StatPal keeps this flag "True" during
    // the cool-down period after a match ends (status="FT"), which would wrongly mark the
    // match as live. Only trust it when status is not a finished/terminal state.
    (inplayOddsRunning && notFinished) ||
    (fromLiveEndpoint && notFinished && (elapsed > 0 || hasActiveClockLike(timer)));
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
  if (mapped === 'soccer') {
    return [
      'https://statpal.io/api/v2/soccer',
      'https://statpal.io/api/v1/soccer',
    ];
  }
  const aliases =
    mapped === 'nba' ? ['basketball', 'nba'] :
    mapped === 'mlb' ? ['baseball', 'mlb'] :
    mapped === 'nhl' ? ['ice-hockey', 'hockey', 'nhl'] :
    [mapped];
  return Array.from(new Set(aliases.map((name) => `https://statpal.io/api/${version}/${name}`)));
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
  // When selectStatPalOddsPayload returns a { match, odds, match_info } wrapper (because it
  // found a specific match within a larger odds payload), recurse into the match object so
  // extractOddsRows can still reach the embedded chances/tipo structure.
  if (payload?.match && typeof payload.match === 'object' && !Array.isArray(payload.match)) {
    const fromMatch = extractOddsRows(payload.match);
    if (fromMatch.length > 0) return fromMatch;
  }
  // StatPal v1 soccer/tennis/NBA odds format:
  //   chances.tipo[] = markets  ("tipo" = "type")
  //   tipo[].apostador[].chance[]           = selections (for 1x2, correct_score, btts)
  //   tipo[].apostador[].desvantagem[].chance[] = handicap lines  ("desvantagem" = "handicap")
  //   tipo[].apostador[].total[].chance[]   = totals lines
  //   Line value in desvantagem/total[].nome (e.g. "-0,75", "2,5"), comma decimal
  //   NBA: market name is in tipo[].valor (not .nome!)
  if (Array.isArray(payload?.chances?.tipo)) {
    const rows: any[] = [];
    for (const market of payload.chances.tipo) {
      // NBA uses "valor" for market name; soccer/tennis use "nome"
      const marketName = String(market?.nome ?? market?.valor ?? market?.name ?? '').trim();
      // "apostador" can be a single object (not always array) — e.g. volleyball Acima/Abaixo
      const books = Array.isArray(market?.apostador) ? market.apostador
        : (market?.apostador ? [market.apostador] : []);
      for (const book of books) {
        // Direct selections (1x2, btts, correct_score, etc.)
        if (Array.isArray(book?.chance) && book.chance.length > 0) {
          rows.push({
            title: marketName,
            suspended: false,
            selections: book.chance.map((odd: any) => ({
              nome: String(odd?.nome ?? odd?.name ?? '').trim(),
              name: String(odd?.nome ?? odd?.name ?? '').trim(),
              valor: String(odd?.valor ?? odd?.value ?? '').replace(',', '.'),
              value: String(odd?.valor ?? odd?.value ?? '').replace(',', '.'),
            })),
          });
          break;
        }
        // Asian Handicap: desvantagem[].chance[] ("desvantagem" = handicap)
        if (Array.isArray(book?.desvantagem)) {
          const mainLine = book.desvantagem.find(
            (d: any) => /^(verdadeiro|true)$/i.test(String(d?.ismain ?? '')),
          ) ?? book.desvantagem[0];
          if (mainLine && Array.isArray(mainLine?.chance)) {
            const point = String(mainLine?.nome ?? '').replace(',', '.');
            rows.push({
              title: marketName,
              suspended: /^(verdadeiro|true)$/i.test(String(mainLine?.parar ?? '')),
              selections: mainLine.chance.map((odd: any) => ({
                nome: String(odd?.nome ?? odd?.name ?? '').trim(),
                name: String(odd?.nome ?? odd?.name ?? '').trim(),
                valor: String(odd?.valor ?? odd?.value ?? '').replace(',', '.'),
                value: String(odd?.valor ?? odd?.value ?? '').replace(',', '.'),
                point,
              })),
            });
          }
          break;
        }
        // Over/Under: total[].chance[]
        if (Array.isArray(book?.total)) {
          const mainLine = book.total.find(
            (t: any) => /^(verdadeiro|true)$/i.test(String(t?.ismain ?? '')),
          ) ?? book.total[0];
          if (mainLine && Array.isArray(mainLine?.chance)) {
            const point = String(mainLine?.nome ?? '').replace(',', '.');
            rows.push({
              title: marketName,
              suspended: /^(verdadeiro|true)$/i.test(String(mainLine?.parar ?? '')),
              selections: mainLine.chance.map((odd: any) => ({
                nome: String(odd?.nome ?? odd?.name ?? '').trim(),
                name: String(odd?.nome ?? odd?.name ?? '').trim(),
                valor: String(odd?.valor ?? odd?.value ?? '').replace(',', '.'),
                value: String(odd?.valor ?? odd?.value ?? '').replace(',', '.'),
                point,
              })),
            });
          }
          break;
        }
      }
    }
    if (rows.length > 0) return rows;
  }
  // StatPal Portuguese odds format (v2 prematch):
  //   chances[] = markets array  ("chances" = Portuguese for "odds/chances")
  //   chances[].apostador[] = bookmakers  ("apostador" = "bookmaker")
  //   chances[].apostador[].chance[] = selections  ("chance" = "odd/selection")
  //   selection: { nome: "Casa", valor: "1,64" }  (Portuguese labels, comma decimal)
  if (Array.isArray(payload?.chances)) {
    const rows: any[] = [];
    for (const market of payload.chances) {
      // "apostador" can be a single object (not always array) — normalize defensively
      const books = Array.isArray(market?.apostador) ? market.apostador
        : (market?.apostador ? [market.apostador] : []);
      const suspended = String(market?.parar ?? market?.stop ?? '').toLowerCase() === 'true';
      for (const book of books) {
        const selections = Array.isArray(book?.chance)
          ? book.chance.map((odd: any) => ({
              nome: String(odd?.nome ?? odd?.name ?? '').trim(),  // Portuguese label
              name: String(odd?.nome ?? odd?.name ?? '').trim(),
              valor: String(odd?.valor ?? odd?.value ?? '').replace(',', '.'),  // comma→dot
              value: String(odd?.valor ?? odd?.value ?? '').replace(',', '.'),
              suspended,
            }))
          : [];
        if (selections.length > 0) {
          rows.push({
            title: String(market?.nome ?? market?.name ?? '').trim(),
            suspended,
            selections,
          });
          break; // Take only the first bookmaker's odds to avoid duplicates
        }
      }
    }
    if (rows.length > 0) return rows;
  }
  return [];
}

type StatPalOddsOpts = { homeTeam?: string; awayTeam?: string; matchId?: string; matchIds?: string[]; leagueId?: string };

function extractStatPalMatchIds(match: any): string[] {
  const ids = [
    match?.id,
    match?.match_id,
    match?.event_id,
    match?.fixture_id,
    match?.fixture?.id,
    match?.main_id,
    match?.fallback_id_1,
    match?.fallback_id_2,
    match?.fallback_id_3,
    match?.match_info?.main_id,
    match?.match_info?.fallback_id_1,
    match?.match_info?.fallback_id_2,
    match?.match_info?.fallback_id_3,
    match?.match_info?.match_id,
    match?.match_info?.id,
    // MLB: livescores have "oddsid" linking to odds endpoint's "id"
    match?.oddsid,
    // MLB: odds have "mlbid" linking to livescores "id"
    match?.mlbid,
    // Portuguese /odds/live: IDs nested under "informação_da_partida"
    match?.['informação_da_partida']?.main_id,
    match?.['informação_da_partida']?.fallback_id_1,
    match?.['informação_da_partida']?.fallback_id_2,
    match?.['informação_da_partida']?.fallback_id_3,
  ]
    .map((v) => String(v ?? '').trim())
    .filter(Boolean);
  return Array.from(new Set(ids));
}

function normalizeVsName(value: any): string {
  return normalizeLabel(String(value ?? '').replace(/\s+vs\s+/i, ' '));
}

function flattenStatPalLeagueMatches(blocks: any[]): any[] {
  const out: any[] = [];
  for (const block of blocks) {
    // "corresponder" = Portuguese for "match" (StatPal prematch odds: probabilidades_pré-jogo.liga.corresponder)
    const rows = block?.match ?? block?.corresponder ?? block?.matches ?? block?.events ?? block?.games ?? [];
    if (!Array.isArray(rows)) continue;
    for (const row of rows) out.push(row);
  }
  return out;
}

function selectStatPalOddsPayload(payload: any, opts?: StatPalOddsOpts): any {
  if (!payload || !opts) return payload;
  const matchIds = Array.from(new Set([
    String(opts.matchId || '').trim(),
    ...((Array.isArray(opts.matchIds) ? opts.matchIds : []).map((id) => String(id || '').trim())),
  ].filter(Boolean)));
  const homeKey = normalizeLabel(opts.homeTeam || '');
  const awayKey = normalizeLabel(opts.awayTeam || '');
  const matchByTeams = (match: any): boolean => {
    const players = Array.isArray(match?.jogador) ? match.jogador : null;
    const home = normalizeLabel(
      match?.home?.name ?? match?.team_info?.home?.name ??
      // Portuguese keys (prematch odds: lar, live odds: informações_da_equipe.lar)
      match?.lar?.nome ?? match?.['informações_da_equipe']?.lar?.nome ??
      // Tennis: jogador[0] = player 1 (home)
      players?.[0]?.nome ?? '',
    );
    const away = normalizeLabel(
      match?.away?.name ?? match?.team_info?.away?.name ??
      // Portuguese keys
      match?.ausente?.nome ?? match?.['informações_da_equipe']?.ausente?.nome ??
      // Tennis: jogador[1] = player 2 (away)
      players?.[1]?.nome ?? '',
    );
    if (homeKey && awayKey) {
      return home === homeKey && away === awayKey;
    }
    const name = normalizeVsName(match?.match_info?.name ?? '');
    return !!homeKey && !!awayKey && name.includes(homeKey) && name.includes(awayKey);
  };
  const findMatch = (rows: any[]): any | null => {
    const found = rows.find((match: any) => {
      const ids = extractStatPalMatchIds(match);
      return (matchIds.length > 0 && matchIds.some((id) => ids.includes(id))) || matchByTeams(match);
    });
    return found || null;
  };

  const directLiveMatches = [
    ...(Array.isArray(payload?.live_matches) ? payload.live_matches : []),
    ...(Array.isArray(payload?.data?.live_matches) ? payload.data.live_matches : []),
    ...(Array.isArray(payload?.upcoming_matches) ? payload.upcoming_matches : []),
    ...(Array.isArray(payload?.data?.upcoming_matches) ? payload.data.upcoming_matches : []),
    // V1 tennis odds: chances.torneio[].partidas.corresponder
    // Each tournament block has "partidas.corresponder" — may be single object or array
    // Matches have embedded chances.tipo[] handled by extractOddsRows.
    ...(Array.isArray(payload?.chances?.torneio)
      ? payload.chances.torneio.flatMap((t: any) => {
          const corr = t?.partidas?.corresponder;
          return !corr ? [] : Array.isArray(corr) ? corr : [corr];
        })
      : []),
    // V1 NBA odds: chances.categoria.partidas.corresponder[] — flat array of matches
    ...(Array.isArray(payload?.chances?.categoria?.partidas?.corresponder)
      ? payload.chances.categoria.partidas.corresponder
      : []),
    // Portuguese /odds/live: "partidas_ao_vivo" — flatten "informação_da_partida" to root for ID lookup
    ...(Array.isArray(payload?.partidas_ao_vivo)
      ? payload.partidas_ao_vivo.map((item: any) => ({
          ...(item?.['informação_da_partida'] ?? {}),
          ...item,
          // Normalize team info to flat keys for matchByTeams
          lar: item?.['informações_da_equipe']?.lar ?? item?.lar,
          ausente: item?.['informações_da_equipe']?.ausente ?? item?.ausente,
        }))
      : []),
  ];
  const directFound = findMatch(directLiveMatches);
  if (directFound) return { odds: directFound?.odds ?? [], match_info: directFound?.match_info ?? null, match: directFound };

  const leagueCollections = [
    ...(Array.isArray(payload?.live_matches?.league) ? [payload.live_matches.league] : []),
    ...(Array.isArray(payload?.data?.live_matches?.league) ? [payload.data.live_matches.league] : []),
    ...(Array.isArray(payload?.upcoming_matches?.league) ? [payload.upcoming_matches.league] : []),
    ...(Array.isArray(payload?.data?.upcoming_matches?.league) ? [payload.data.upcoming_matches.league] : []),
    ...(Array.isArray(payload?.prematch_odds?.league) ? [payload.prematch_odds.league] : []),
    ...(Array.isArray(payload?.data?.prematch_odds?.league) ? [payload.data.prematch_odds.league] : []),
    // Portuguese /odds/prematch: "probabilidades_pré-jogo.liga" is a single object (not array)
    // that contains a "corresponder" array of matches — wrap as a one-element league array
    ...(payload?.['probabilidades_pré-jogo']?.liga != null
      ? [[payload['probabilidades_pré-jogo'].liga]]
      : []),
    // V1 soccer odds: exemplo.odds_feed.liga[] or odds_feed.liga[]
    ...(Array.isArray(payload?.exemplo?.odds_feed?.liga) ? [payload.exemplo.odds_feed.liga] : []),
    ...(Array.isArray(payload?.odds_feed?.liga) ? [payload.odds_feed.liga] : []),
  ];
  for (const leagues of leagueCollections) {
    const found = findMatch(flattenStatPalLeagueMatches(leagues));
    if (found) return { odds: found?.odds ?? [], match_info: found?.match_info ?? null, match: found };
  }

  const genericCollections = [
    Array.isArray(payload?.response) ? payload.response : null,
    Array.isArray(payload?.data) ? payload.data : null,
    Array.isArray(payload?.data?.response) ? payload.data.response : null,
    Array.isArray(payload?.matches) ? payload.matches : null,
    Array.isArray(payload?.events) ? payload.events : null,
  ].filter(Boolean) as any[][];
  for (const rows of genericCollections) {
    const found = findMatch(rows);
    if (found) return found;
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

function readStatusValue(raw: any, keys: string[]): string {
  if (raw == null) return '';
  if (typeof raw === 'string' || typeof raw === 'number') return String(raw).trim();
  if (typeof raw === 'object') {
    for (const key of keys) {
      const value = (raw as any)?.[key];
      if (value != null && String(value).trim()) return String(value).trim();
    }
  }
  return '';
}

function hasActiveClockLike(raw: any): boolean {
  const value = String(raw ?? '').trim();
  if (!value) return false;
  return /^\d{1,3}(?:[:']\d{1,2})?$/.test(value);
}

function isHomeLikeLabel(labelKey: string): boolean {
  return /^(home|1|home team|team 1|player 1|participant 1|host|local|casa)$/.test(labelKey);
}

function isAwayLikeLabel(labelKey: string): boolean {
  // "ausente" = Portuguese StatPal selection label for away team in 1x2 markets
  return /^(away|2|away team|team 2|player 2|participant 2|visitor|visitante|fora|ausente)$/.test(labelKey);
}

function inferMarketKey(title: string): string {
  const t = normalizeLabel(title);
  if (!t) return 'other';
  if (/(double chance).*(first half|1st half)|(^first half|^1st half).*(double chance)/.test(t)) return 'double_chance_1st_half';
  if (/(double chance).*(second half|2nd half)|(^second half|^2nd half).*(double chance)/.test(t)) return 'double_chance_2nd_half';
  if (/(draw no bet|dnb|empate anula).*(first half|1st half)|(^first half|^1st half).*(draw no bet|dnb|empate anula)/.test(t)) return 'draw_no_bet_1st_half';
  if (/(draw no bet|dnb|empate anula).*(second half|2nd half)|(^second half|^2nd half).*(draw no bet|dnb|empate anula)/.test(t)) return 'draw_no_bet_2nd_half';
  if (/(draw no bet|dnb|empate anula)/.test(t)) return 'draw_no_bet';
  if (/(results? both teams score|results? both teams to score|both teams score result|both teams to score result)/.test(t)) return 'btts_and_result';
  if (/(both teams (to )?score|btts).*(first half|1st half)|(^first half|^1st half).*(both teams (to )?score|btts)/.test(t)) return 'btts_first_half';
  if (/(both teams (to )?score|btts).*(second half|2nd half)|(^second half|^2nd half).*(both teams (to )?score|btts)/.test(t)) return 'btts_second_half';
  if (/(both teams (to )?score|btts)/.test(t)) return 'btts';
  if (/(goals over under|goal line|over under|total goals|totals|total games|games total|total rounds).*(first half|1st half)|(^first half|^1st half).*(goals over under|goal line|over under|total goals|totals|total games|games total|total rounds)/.test(t)) return '1st_half_totals';
  if (/(goals over under|goal line|over under|total goals|totals|total games|games total|total rounds).*(second half|2nd half)|(^second half|^2nd half).*(goals over under|goal line|over under|total goals|totals|total games|games total|total rounds)/.test(t)) return '2nd_half_totals';
  if (/(over under|goal line|total goals|totals|total games|games total|total rounds)/.test(t)) return 'totals';
  if (/(first half winner|1st half winner|half time result|first half result)/.test(t)) return 'first_half_h2h';
  if (/(second half winner|2nd half winner|second half result)/.test(t)) return 'second_half_h2h';
  // Portuguese market names from StatPal v1 odds endpoint
  if (/(pontuacao correta|placar correto)/.test(t)) return 'correct_score';
  if (/(ambas as equipes marcam|ambas equipes marcam)/.test(t)) return 'btts';
  if (/(acima abaixo|acima sob)/.test(t)) return 'totals';
  // "resultado em tempo integral" = Portuguese for "full time result"
  // "casa fora" = Portuguese for "home away" — tennis win market (no draw)
  // "resultado de 3 vias" = NBA 3-way result (Portuguese for "3-way result")
  if (/^(match winner|1x2|full time result|resultado final|resultado em tempo integral|winner|casa fora|casa ausente)$/.test(t)) return 'h2h';
  if (/resultado de (3|tr[eê]s) vias/.test(t)) return 'h2h';
  if (/^home away$/.test(t)) return 'home_away';
  if (/(correct score|placar exato)/.test(t)) return 'correct_score';
  if (/(asian handicap).*(first half|1st half)|(^first half|^1st half).*(asian handicap)/.test(t)) return '1st_half_spreads';
  if (/(asian handicap).*(second half|2nd half)|(^second half|^2nd half).*(asian handicap)/.test(t)) return '2nd_half_spreads';
  if (/(handicap|spread)/.test(t)) return 'spreads';
  if (/(next game winner)/.test(t)) return 'next_game_winner';
  if (/(set winner|current set winner)/.test(t)) return 'current_set_winner';
  return t.replace(/\s+/g, '_');
}

function readSelectionLabel(selection: any): string {
  return String(
    selection?.label ??
    selection?.nome ??  // Portuguese StatPal key
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
  const raw = selection?.odd ?? selection?.price
    ?? selection?.valor  // Portuguese StatPal key ("valor" = value/price)
    ?? selection?.value ?? selection?.decimal ?? selection?.decimal_odds ?? selection?.odds;
  // StatPal (Portuguese locale) uses comma as decimal separator: "1,64" — convert to dot
  const normalized = typeof raw === 'string' ? raw.replace(',', '.') : raw;
  const n = Number(normalized);
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

      if (key === 'h2h' || key === 'home_away') {
        const labelKey = normalizeLabel(label);
        // "desenho" = Portuguese StatPal translation for "draw"
        if (labelKey === 'draw' || labelKey === 'empate' || labelKey === 'x' || labelKey === 'desenho') draw = odd;
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

function attachOddsToEvents(events: NormalizedEvent[], oddsJson: any, sport: string): NormalizedEvent[] {
  if (!oddsJson) return events;
  return events.map((event) => {
    if ((event.home_odd > 1 || event.away_odd > 1) && event.markets && event.markets !== '{}') return event;
    const matched = parseStatPalMatchOddsPayload(sport, oddsJson, {
      matchId: event.external_event_id,
      homeTeam: event.home_team,
      awayTeam: event.away_team,
    });
    if (!matched) return event;
    return {
      ...event,
      home_odd: matched.home > 1 ? matched.home : event.home_odd,
      draw_odd: matched.draw > 1 ? matched.draw : event.draw_odd,
      away_odd: matched.away > 1 ? matched.away : event.away_odd,
      markets: matched.markets && Object.keys(matched.markets).length > 0
        ? JSON.stringify(matched.markets)
        : event.markets,
    };
  });
}

export async function fetchStatPalLive(apiKey: string, sport: string): Promise<NormalizedEvent[]> {
  const s = statPalSportPath(sport);

  if (s === 'soccer') {
    // Try /odds/live first — it embeds match data + odds together in one response.
    // If that fails or yields no events, fall back to /matches/live then livescores.
    const primaryPaths = ['/odds/live', '/matches/live', '/livescores', '/matches?status=live'];
    let liveEvents: NormalizedEvent[] = [];
    let usedOddsLive = false;

    for (const url of buildCandidateUrls(apiKey, sport, primaryPaths)) {
      const json = await fetchJson(url, PROVIDER_LIVE_TIMEOUT_MS);
      const events = extractEvents(json)
        .map((row) => normalizeEvent({ ...row, __from_live_endpoint: true }, sport))
        .filter((row) => !!row && Number((row as any)?.is_live || 0) === 1) as NormalizedEvent[];
      if (events.length > 0) {
        liveEvents = events;
        usedOddsLive = url.includes('/odds/live');
        break;
      }
    }

    if (liveEvents.length === 0) return [];

    // If we didn't get events from /odds/live (i.e. events came without embedded odds),
    // fetch /odds/live separately and merge odds into the events.
    const hasEmbeddedOdds = liveEvents.some((e) => e.home_odd > 1 || e.away_odd > 1);
    if (!usedOddsLive && !hasEmbeddedOdds) {
      const oddsUrl = buildCandidateUrls(apiKey, sport, ['/odds/live'])[0];
      const oddsJson = await fetchJson(oddsUrl, PROVIDER_TIMEOUT_MS).catch(() => null);
      if (oddsJson) liveEvents = attachOddsToEvents(liveEvents, oddsJson, sport);
    }

    return liveEvents;
  }

  // Non-soccer sports (NBA, MLB, NHL, Tennis, Volleyball, MMA)
  // StatPal livescores/daily is the primary source; /odds carries current odds for all matches.
  const paths = ['/livescores', '/daily/d-0', '/matches/live', '/matches?status=live'];
  for (const url of buildCandidateUrls(apiKey, sport, paths)) {
    const json = await fetchJson(url, PROVIDER_LIVE_TIMEOUT_MS);
    let liveEvents = extractEvents(json)
      .map((row) => normalizeEvent({ ...row, __from_live_endpoint: true }, sport))
      .filter((row) => !!row && Number((row as any)?.is_live || 0) === 1) as NormalizedEvent[];
    if (liveEvents.length > 0) {
      // Fetch the sport-level odds endpoint and attach to live events (same endpoint
      // covers all live + upcoming matches for NBA/MLB/volleyball etc.)
      const hasOdds = liveEvents.some((e) => e.home_odd > 1 || e.away_odd > 1);
      if (!hasOdds) {
        const oddsJson = await fetchFirstJson(
          buildCandidateUrls(apiKey, sport, ['/odds']),
          PROVIDER_TIMEOUT_MS,
        ).catch(() => null);
        if (oddsJson) liveEvents = attachOddsToEvents(liveEvents, oddsJson, sport);
      }
      return liveEvents;
    }
  }

  // Fallback: SportsApiPro-compatible subdomain format with x-api-key header.
  // StatPal non-soccer sports are also accessible at https://v2.{sport}.statpal.io/api/...
  // using the same URL/auth format as SportsApiPro ("ambas apis usam curl iguais").
  const sapiLivePaths = ['/api/live', '/games/allscores?onlyLiveGames=true'];
  for (const url of buildSportsApiProStyleUrls(sport, sapiLivePaths)) {
    const json = await fetchJsonXApiKey(url, apiKey, PROVIDER_LIVE_TIMEOUT_MS);
    let liveEvents = extractEvents(json)
      .map((row) => normalizeEvent({ ...row, __from_live_endpoint: true }, sport))
      .filter((row) => !!row && Number((row as any)?.is_live || 0) === 1) as NormalizedEvent[];
    if (liveEvents.length > 0) {
      const hasOdds = liveEvents.some((e) => e.home_odd > 1 || e.away_odd > 1);
      if (!hasOdds) {
        const oddsJson = await fetchFirstJsonXApiKey(
          buildSportsApiProStyleUrls(sport, ['/api/odds', '/odds']),
          apiKey,
          PROVIDER_TIMEOUT_MS,
        ).catch(() => null);
        if (oddsJson) liveEvents = attachOddsToEvents(liveEvents, oddsJson, sport);
      }
      return liveEvents;
    }
  }
  return [];
}

async function fetchSoccerPreMatchOdds(apiKey: string, sport: string): Promise<any | null> {
  const oddsJson = await fetchFirstJson(
    buildCandidateUrls(apiKey, sport, ['/odds/prematch', '/prematch-odds', '/odds']),
    PROVIDER_TIMEOUT_MS,
  ).catch(() => null);
  return oddsJson;
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
        // Fetch daily schedule (StatPal has no global /odds/prematch — must use per-league endpoint)
        const dailyJson = await fetchFirstJson(dailyUrl, PROVIDER_TIMEOUT_MS);
        const rawRows = extractEvents(dailyJson);
        const dailyEvents = rawRows.map((row) => normalizeEvent(row, sport)).filter(Boolean) as NormalizedEvent[];
        if (dailyEvents.length === 0) continue;
        // Extract unique league IDs from raw rows so we can fetch prematch odds per league
        const leagueIds = Array.from(new Set(
          rawRows.map((row: any) => String(row?.__league?.id ?? row?.league_id ?? '')).filter(Boolean),
        ));
        // Fetch /leagues/{id}/odds/prematch for each league in parallel (cap at 8 to limit API calls)
        const leagueOddsJsons = leagueIds.length > 0
          ? await Promise.all(
              leagueIds.slice(0, 8).map((leagueId) =>
                fetchFirstJson(
                  buildCandidateUrls(apiKey, sport, [`/leagues/${encodeURIComponent(leagueId)}/odds/prematch`]),
                  PROVIDER_TIMEOUT_MS,
                ).catch(() => null),
              ),
            )
          : [];
        // Attach prematch odds from each league — events with no odds yet are enriched iteratively
        let enriched = dailyEvents;
        for (const leagueOddsJson of leagueOddsJsons) {
          if (leagueOddsJson) enriched = attachOddsToEvents(enriched, leagueOddsJson, sport);
        }
        if (!targetDate) return enriched;
        const sameDay = enriched.filter((event) => dateOnlyIso(String(event?.event_date || '')) === targetDate);
        if (sameDay.length > 0) return sameDay;
        if (dailyOffset === offset) return enriched;
      }
    }
    const dateVariants = Array.from(new Set(formatDateVariants(date)));
    const fallbackPaths = dateVariants.flatMap((d) => [
      `/schedule?date=${encodeURIComponent(d)}`,
      `/matches?date=${encodeURIComponent(d)}`,
      `/fixtures?date=${encodeURIComponent(d)}`,
      `/upcoming?date=${encodeURIComponent(d)}`,
      `/matches/upcoming?date=${encodeURIComponent(d)}`,
    ]);
    for (const url of buildCandidateUrls(apiKey, sport, fallbackPaths)) {
      const json = await fetchJson(url, PROVIDER_TIMEOUT_MS);
      const events = extractEvents(json).map((row) => normalizeEvent(row, sport)).filter(Boolean) as NormalizedEvent[];
      if (events.length > 0) return events;
    }
    return [];
  }
  // Non-soccer sports: NBA, MLB, NHL, Tennis, Volleyball, MMA
  // StatPal v1 uses /daily/d-N as the primary schedule endpoint (not date-param URLs).
  const targetDate = dateOnlyIso(date);
  const dayOffset = utcDayDiffFromToday(date);
  // Build /daily/d-N paths: d-0=today, d-1=yesterday, d+1=tomorrow etc.
  const dailyPaths: string[] = [];
  if (dayOffset != null && Math.abs(dayOffset) <= 7) {
    // Most reliable: exact offset first, then adjacent days as fallback
    const abs = Math.abs(dayOffset);
    const sign = dayOffset <= 0 ? '-' : '+';
    dailyPaths.push(`/daily/d${sign}${abs}`);
    if (abs !== 0) dailyPaths.push('/daily/d-0');   // today as secondary
    if (abs !== 1) dailyPaths.push('/daily/d-1');   // yesterday as tertiary
  } else {
    dailyPaths.push('/daily/d-0', '/daily/d-1');
  }
  const dateVariants = Array.from(new Set(formatDateVariants(date)));
  const datePaths = dateVariants.flatMap((d) => [
    `/schedule?date=${encodeURIComponent(d)}`,
    `/games?date=${encodeURIComponent(d)}`,
    `/matches?date=${encodeURIComponent(d)}`,
    `/fixtures?date=${encodeURIComponent(d)}`,
    `/upcoming?date=${encodeURIComponent(d)}`,
    `/matches/upcoming?date=${encodeURIComponent(d)}`,
  ]);
  // Daily paths first (known to work for NBA/MLB/volleyball), then generic date params, then livescores
  const allPaths = [...new Set([...dailyPaths, ...datePaths, '/livescores', '/matches/live', '/matches?status=live'])];
  for (const url of buildCandidateUrls(apiKey, sport, allPaths)) {
    const json = await fetchJson(url, PROVIDER_TIMEOUT_MS);
    let events = extractEvents(json)
      .map((row) => normalizeEvent(row, sport))
      .filter(Boolean) as NormalizedEvent[];
    if (events.length === 0) continue;
    // StatPal non-soccer: fetch the sport-level /odds endpoint and attach prematch odds.
    // Unlike soccer (which uses /leagues/{id}/odds/prematch per-league), non-soccer sports
    // expose a single /odds endpoint that covers all upcoming + live matches.
    const hasOdds = events.some((e) => e.home_odd > 1 || e.away_odd > 1);
    if (!hasOdds) {
      const oddsJson = await fetchFirstJson(
        buildCandidateUrls(apiKey, sport, ['/odds']),
        PROVIDER_TIMEOUT_MS,
      ).catch(() => null);
      if (oddsJson) events = attachOddsToEvents(events, oddsJson, sport);
    }
    if (!targetDate) return events;
    const sameDay = events.filter((event) => dateOnlyIso(String(event?.event_date || '')) === targetDate);
    if (sameDay.length > 0) return sameDay;
    // Return all if we got data but none matched the exact date (avoids silent empty)
    return events;
  }

  // Fallback: SportsApiPro v2 schedule format with x-api-key header.
  // StatPal non-soccer: https://v2.{sport}.statpal.io/api/schedule/{date}
  const sapiSchedulePaths = [
    `/api/schedule/${encodeURIComponent(date)}?timezoneName=UTC`,
    `/api/schedule/${encodeURIComponent(date)}`,
  ];
  for (const url of buildSportsApiProStyleUrls(sport, sapiSchedulePaths)) {
    const json = await fetchJsonXApiKey(url, apiKey, PROVIDER_TIMEOUT_MS);
    let events = extractEvents(json).map((row) => normalizeEvent(row, sport)).filter(Boolean) as NormalizedEvent[];
    if (events.length === 0) continue;
    const hasOdds = events.some((e) => e.home_odd > 1 || e.away_odd > 1);
    if (!hasOdds) {
      const oddsJson = await fetchFirstJsonXApiKey(
        buildSportsApiProStyleUrls(sport, ['/api/odds', '/odds']),
        apiKey,
        PROVIDER_TIMEOUT_MS,
      ).catch(() => null);
      if (oddsJson) events = attachOddsToEvents(events, oddsJson, sport);
    }
    if (!targetDate) return events;
    const sameDay = events.filter((ev) => dateOnlyIso(String(ev?.event_date || '')) === targetDate);
    if (sameDay.length > 0) return sameDay;
    return events;
  }
  return [];
}

export async function fetchStatPalMatchOddsAll(
  apiKey: string,
  sport: string,
  matchId: string,
  opts?: StatPalOddsOpts
): Promise<OddsResult | null> {
  const matchIds = Array.from(new Set([matchId, ...((opts?.matchIds || []).map((id) => String(id || '').trim()))].filter(Boolean)));
  const json = await fetchFirstJson(
    buildCandidateUrls(apiKey, sport, [
      ...matchIds.flatMap((id) => [
        `/matches/${encodeURIComponent(id)}/odds`,
        `/match/${encodeURIComponent(id)}/odds`,
        `/matches/${encodeURIComponent(id)}/liveodds`,
        `/odds?match_id=${encodeURIComponent(id)}`,
        `/odds?event_id=${encodeURIComponent(id)}`,
      ]),
      '/odds',
    ]),
    PROVIDER_TIMEOUT_MS,
  );
  let parsed = parseStatPalMatchOddsPayload(sport, json, { ...opts, matchId, matchIds });
  if (!parsed) {
    const genericJson = await fetchFirstJson(
      buildCandidateUrls(apiKey, sport, ['/odds']),
      PROVIDER_TIMEOUT_MS,
    );
    parsed = parseStatPalMatchOddsPayload(sport, genericJson, { ...opts, matchId, matchIds });
  }
  // SportsApiPro-compatible format fallback: /api/match/{id}/odds/all with x-api-key header
  if (!parsed) {
    for (const id of matchIds) {
      const sapiJson = await fetchFirstJsonXApiKey(
        buildSportsApiProStyleUrls(sport, [
          `/api/match/${encodeURIComponent(id)}/odds/all`,
          `/api/match/${encodeURIComponent(id)}/odds`,
          `/api/odds?match_id=${encodeURIComponent(id)}`,
        ]),
        apiKey,
        PROVIDER_TIMEOUT_MS,
      );
      parsed = parsed || parseStatPalMatchOddsPayload(sport, sapiJson, { ...opts, matchId, matchIds });
      if (parsed) break;
    }
  }
  return parsed;
}

export async function fetchStatPalMatchOddsLive(
  apiKey: string,
  sport: string,
  matchId: string,
  opts?: StatPalOddsOpts
): Promise<OddsResult | null> {
  const matchIds = Array.from(new Set([matchId, ...((opts?.matchIds || []).map((id) => String(id || '').trim()))].filter(Boolean)));
  const json = await fetchFirstJson(
    buildCandidateUrls(apiKey, sport, [
      ...matchIds.flatMap((id) => [
        `/matches/${encodeURIComponent(id)}/liveodds`,
        `/match/${encodeURIComponent(id)}/liveodds`,
        `/matches/${encodeURIComponent(id)}/odds/live`,
        `/odds/live?match_id=${encodeURIComponent(id)}`,
        `/odds/live?event_id=${encodeURIComponent(id)}`,
      ]),
    ]),
    PROVIDER_TIMEOUT_MS,
  );
  let parsed = parseStatPalMatchOddsPayload(sport, json, { ...opts, matchId, matchIds });
  if (!parsed) {
    const liveJson = await fetchFirstJson(
      buildCandidateUrls(apiKey, sport, [
        '/odds/live',
        '/liveodds',
      ]),
      PROVIDER_TIMEOUT_MS,
    );
    parsed = parseStatPalMatchOddsPayload(sport, liveJson, { ...opts, matchId, matchIds });
  }
  // SportsApiPro-compatible format fallback: /api/match/{id}/odds/live with x-api-key header
  if (!parsed) {
    for (const id of matchIds) {
      const sapiJson = await fetchFirstJsonXApiKey(
        buildSportsApiProStyleUrls(sport, [
          `/api/match/${encodeURIComponent(id)}/odds/live`,
          `/api/match/${encodeURIComponent(id)}/liveodds`,
          `/api/odds/live?match_id=${encodeURIComponent(id)}`,
        ]),
        apiKey,
        PROVIDER_TIMEOUT_MS,
      );
      parsed = parsed || parseStatPalMatchOddsPayload(sport, sapiJson, { ...opts, matchId, matchIds });
      if (parsed) break;
    }
  }
  return parsed;
}

export async function fetchStatPalMatchOddsPreMatch(
  apiKey: string,
  sport: string,
  matchId: string,
  opts?: StatPalOddsOpts
): Promise<OddsResult | null> {
  const matchIds = Array.from(new Set([matchId, ...((opts?.matchIds || []).map((id) => String(id || '').trim()))].filter(Boolean)));
  const json = await fetchFirstJson(
    buildCandidateUrls(apiKey, sport, [
      ...matchIds.flatMap((id) => [
        `/matches/${encodeURIComponent(id)}/odds/pre-match`,
        `/match/${encodeURIComponent(id)}/odds/pre-match`,
        `/matches/${encodeURIComponent(id)}/prematch-odds`,
        `/matches/${encodeURIComponent(id)}/odds`,
        `/odds/prematch?match_id=${encodeURIComponent(id)}`,
        `/odds/prematch?event_id=${encodeURIComponent(id)}`,
        `/prematch-odds?match_id=${encodeURIComponent(id)}`,
      ]),
    ]),
    PROVIDER_TIMEOUT_MS,
  );
  let parsed = parseStatPalMatchOddsPayload(sport, json, { ...opts, matchId, matchIds });
  if (!parsed && statPalSportPath(sport) === 'soccer' && opts?.leagueId) {
    const prematchJson = await fetchFirstJson(
      buildCandidateUrls(apiKey, sport, [
        `/leagues/${encodeURIComponent(opts.leagueId)}/odds/prematch`,
      ]),
      PROVIDER_TIMEOUT_MS,
    );
    parsed = parseStatPalMatchOddsPayload(sport, prematchJson, { ...opts, matchId, matchIds });
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
    parsed = parseStatPalMatchOddsPayload(sport, genericJson, { ...opts, matchId, matchIds });
  }
  // SportsApiPro-compatible format fallback: /api/match/{id}/odds/pre-match with x-api-key header
  if (!parsed) {
    for (const id of matchIds) {
      const sapiJson = await fetchFirstJsonXApiKey(
        buildSportsApiProStyleUrls(sport, [
          `/api/match/${encodeURIComponent(id)}/odds/pre-match`,
          `/api/match/${encodeURIComponent(id)}/prematch-odds`,
          `/api/match/${encodeURIComponent(id)}/odds`,
          `/api/odds/prematch?match_id=${encodeURIComponent(id)}`,
        ]),
        apiKey,
        PROVIDER_TIMEOUT_MS,
      );
      parsed = parsed || parseStatPalMatchOddsPayload(sport, sapiJson, { ...opts, matchId, matchIds });
      if (parsed) break;
    }
    // Generic SportsApiPro odds endpoint as last resort
    if (!parsed) {
      const sapiGenericJson = await fetchFirstJsonXApiKey(
        buildSportsApiProStyleUrls(sport, ['/api/odds/prematch', '/api/odds']),
        apiKey,
        PROVIDER_TIMEOUT_MS,
      );
      parsed = parseStatPalMatchOddsPayload(sport, sapiGenericJson, { ...opts, matchId, matchIds });
    }
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

// ── Provider config (single source of truth) ─────────────────────────────────

const STATPAL_DEFAULT_KEY = 'b5b07a3f-b019-4a18-8969-6045169feda9';

function resolveStatPalApiKey(): string {
  if (process.env.STATPAL_ACCESS_KEY) return String(process.env.STATPAL_ACCESS_KEY).trim();
  if (process.env.STATPAL_KEY) return String(process.env.STATPAL_KEY).trim();
  return STATPAL_DEFAULT_KEY;
}

export function getStatPalConfig(): { provider: 'statpal'; apiKey: string; supportsUpstreamWs: false } {
  return {
    provider: 'statpal',
    apiKey: resolveStatPalApiKey(),
    supportsUpstreamWs: false,
  };
}
