import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import Stripe from 'stripe';
 
import { fetchSportsApiProLive, fetchSportsApiProMatchOdds, fetchSportsApiProSchedule } from '../src/worker/services/sportsApiPro';

const PORT = Number(process.env.PORT || process.env.RAILWAY_PORT || process.env.API_PORT || 4000);
const stripeSecretKey = process.env.STRIPE_SECRET_KEY || '';
const stripeWebhookSecret =
  process.env.STRIPE_WEBHOOK_SECRET || process.env.WEBHOOK_SECRET || '';
const stripe = stripeSecretKey ? new Stripe(stripeSecretKey, { apiVersion: '2024-06-20' as any }) : null;

type User = {
  id: string;
  email: string;
  password_hash: string;
  password_salt: string;
  role: 'user' | 'admin';
  name?: string;
};

type Session = {
  token: string;
  userId: string;
  issuedAt: number;
  expiresAt: number;
};

type AuditLog = {
  id: string;
  time: string;
  ip: string;
  action: 'signup' | 'login' | 'verify_request' | 'verify_complete' | 'password_reset_request' | 'password_reset_complete';
  email: string;
  userId?: string;
  success: boolean;
};
type League = {
  id: string;
  id_api: string;
  name: string;
  logo: string;
  country: string;
  sport: string;
  source: string;
};
type Team = {
  id: string;
  id_api: string;
  name: string;
  logo: string;
  league_id: string;
  sport: string;
  source: string;
};
type Fixture = {
  id: string;
  id_api: string;
  league_id: string;
  home_team_id: string;
  away_team_id: string;
  kickoff: string;
  status: string;
  minute: number | null;
  home_score: number | null;
  away_score: number | null;
  sport: string;
  source: string;
  last_odds_snapshot_id?: string;
};
type OddsSnapshot = {
  id: string;
  fixture_id: string;
  bookmaker: string;
  market: string;
  market_type: string;
  line: string | null;
  value: number;
  odds: number;
  created_at: string;
  source: string;
};
type Event = {
  id: string;
  fixture_id: string;
  type: string;
  player: string | null;
  minute: number | null;
  payload: any;
  created_at: string;
  source: string;
};
type Statistics = {
  id: string;
  fixture_id: string;
  payload: any;
  created_at: string;
  source: string;
};
const users = new Map<string, User>();
const sessions = new Map<string, Session>();
const walletBalances = new Map<string, { balance: number }>();
const profiles = new Map<
  string,
  {
    id: string;
    user_id: string;
    email: string;
    full_name?: string;
    name?: string;
    phone?: string;
    balance: number;
    free_bet_balance?: number;
    is_admin?: boolean;
    status?: string;
    kyc_verified?: boolean;
    email_verified?: boolean;
    birth_date?: string;
    created_at: string;
    updated_at?: string;
    self_exclusion_until?: string;
    cooling_off_until?: string;
    limits?: Record<string, number>;
    saved_iban?: string;
    saved_account_holder?: string;
    self_exclusion_reason?: string;
  }
>();
const leaguesStore: League[] = [];
const teamsStore: Team[] = [];
const fixturesStore: Fixture[] = [];
const oddsHistoryStore: OddsSnapshot[] = [];
const eventsStore: Event[] = [];
const statisticsStore: Statistics[] = [];
const sportsApiProOddsCache = new Map<string, { ts: number; odds: { home: number; draw: number; away: number; markets: Record<string, any[]> } | null }>();
const sportsApiProV2IdByV1IdCache = new Map<string, { ts: number; id: string | null }>();
const sportsApiProV2ScheduleIndexCache = new Map<string, { ts: number; index: Map<string, string> }>();
const sportsApiProV2LiveIndexCache = new Map<string, { ts: number; index: Map<string, string> }>();

function normalizeTeamKey(name: string): string {
  return String(name || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function matchupKey(home: string, away: string): string {
  return `${normalizeTeamKey(home)}__${normalizeTeamKey(away)}`;
}

async function getSportsApiProV2ScheduleIndex(apiKey: string, sport: string, date: string): Promise<Map<string, string>> {
  const ttlMs = 10 * 60 * 1000;
  const k = `${sport}:${date}`;
  const cached = sportsApiProV2ScheduleIndexCache.get(k);
  if (cached && Date.now() - cached.ts < ttlMs) return cached.index;

  const index = new Map<string, string>();
  const items = await fetchSportsApiProSchedule(apiKey, sport, date).catch(() => []);
  for (const e of items) {
    const id = String(e?.external_event_id || '').split('_').slice(1).join('_');
    if (!id) continue;
    const mk = matchupKey(String(e?.home_team || ''), String(e?.away_team || ''));
    if (!mk || mk === '__') continue;
    if (!index.has(mk)) index.set(mk, id);
  }

  sportsApiProV2ScheduleIndexCache.set(k, { ts: Date.now(), index });
  return index;
}

async function getSportsApiProV2LiveIndex(apiKey: string, sport: string): Promise<Map<string, string>> {
  const ttlMs = 2 * 60 * 1000;
  const cached = sportsApiProV2LiveIndexCache.get(sport);
  if (cached && Date.now() - cached.ts < ttlMs) return cached.index;

  const index = new Map<string, string>();
  const items = await fetchSportsApiProLive(apiKey, sport).catch(() => []);
  for (const e of items) {
    const id = String(e?.external_event_id || '').split('_').slice(1).join('_');
    if (!id) continue;
    const mk = matchupKey(String(e?.home_team || ''), String(e?.away_team || ''));
    if (!mk || mk === '__') continue;
    if (!index.has(mk)) index.set(mk, id);
  }

  sportsApiProV2LiveIndexCache.set(sport, { ts: Date.now(), index });
  return index;
}

async function resolveSportsApiProV2MatchId(
  apiKey: string,
  sport: string,
  date: string,
  homeTeam: string,
  awayTeam: string,
  live: boolean,
): Promise<string | null> {
  const mk = matchupKey(homeTeam, awayTeam);
  if (!mk || mk === '__') return null;

  const scheduleIndex = await getSportsApiProV2ScheduleIndex(apiKey, sport, date);
  const direct = scheduleIndex.get(mk) || scheduleIndex.get(matchupKey(awayTeam, homeTeam)) || null;
  if (direct) return direct;

  if (live) {
    const liveIndex = await getSportsApiProV2LiveIndex(apiKey, sport);
    return liveIndex.get(mk) || liveIndex.get(matchupKey(awayTeam, homeTeam)) || null;
  }

  return null;
}
const kycDocuments: {
  id: string;
  user_id: string;
  document_type: 'id_front' | 'id_back' | 'proof_address' | 'selfie';
  file_name: string;
  file_url: string;
  status: 'pending' | 'approved' | 'rejected';
  uploaded_at: string;
  rejection_reason?: string;
}[] = [];
const transactionsStore: {
  id: string;
  user_id: string;
  type: 'deposit' | 'withdrawal' | 'bet' | 'win' | 'cashout';
  amount: number;
  status: 'pending' | 'completed' | 'failed' | 'cancelled';
  payment_method?: string;
  description?: string;
  external_id?: string;
  stripe_session_id?: string;
  completed_at?: string;
  created_at: string;
  updated_at: string;
}[] = [];

function isLeagueBlocked(name: string): boolean {
  const n = name.toLowerCase();

  const femaleKeywords = ['women', 'feminino', 'feminina', 'feminine', 'womens'];
  if (femaleKeywords.some((k) => n.includes(k))) return true;

  const youthKeywords = [
    'u17',
    'u18',
    'u19',
    'u20',
    'u21',
    'u23',
    'youth',
    'junior',
    'júnior',
    'juniors',
    'sub-17',
    'sub-18',
    'sub-19',
    'sub-20',
    'sub-21',
    'sub-23',
  ];
  if (youthKeywords.some((k) => n.includes(k))) return true;

  const reserveKeywords = ['reserve', 'reserves', 'b team', 'b-team', 'ii', 'iii'];
  if (reserveKeywords.some((k) => n.includes(k))) return true;

  const friendlyKeywords = ['friendly', 'amistoso', 'club friendlies', 'friendlies'];
  if (friendlyKeywords.some((k) => n.includes(k))) return true;

  return false;
}

function ensureLeagueFromApiFootball(payload: any): League | null {
  const leagueApiId = payload && payload.id != null ? String(payload.id) : '';
  if (!leagueApiId) {
    return null;
  }

  let league = leaguesStore.find(
    (l) => l.id_api === leagueApiId && l.source === 'api-football',
  );

  const name = String(payload.name || '');

  if (isLeagueBlocked(name)) {
    return null;
  }

  if (!league) {
    league = {
      id: randomBytes(16).toString('hex'),
      id_api: leagueApiId,
      name,
      logo: String(payload.logo || ''),
      country: String(payload.country || ''),
      sport: 'football',
      source: 'api-football',
    };
    leaguesStore.push(league);
  }

  return league;
}

function ensureTeamFromApiFootball(payload: any, league: League | null): Team | null {
  const teamApiId = payload && payload.id != null ? String(payload.id) : '';
  if (!teamApiId) {
    return null;
  }

  let team = teamsStore.find(
    (t) => t.id_api === teamApiId && t.source === 'api-football',
  );

  if (!team) {
    team = {
      id: randomBytes(16).toString('hex'),
      id_api: teamApiId,
      name: String(payload.name || ''),
      logo: String(payload.logo || ''),
      league_id: league ? league.id : '',
      sport: 'football',
      source: 'api-football',
    };
    teamsStore.push(team);
  }

  return team;
}

function registerOddsSnapshot(
  fixtureId: string,
  bookmaker: string,
  market: string,
  marketType: string,
  line: string | null,
  value: number,
  odds: number,
  source: string,
) {
  if (!fixtureId || !Number.isFinite(odds) || odds <= 1) {
    return;
  }

  for (let i = oddsHistoryStore.length - 1; i >= 0; i--) {
    const s = oddsHistoryStore[i];
    if (
      s.fixture_id === fixtureId &&
      s.bookmaker === bookmaker &&
      s.market === market &&
      s.market_type === marketType &&
      s.line === line &&
      s.value === value
    ) {
      if (Math.abs(s.odds - odds) < 0.0001) {
        return;
      }
      break;
    }
  }

  const now = new Date().toISOString();
  const snapshot: OddsSnapshot = {
    id: randomBytes(16).toString('hex'),
    fixture_id: fixtureId,
    bookmaker,
    market,
    market_type: marketType,
    line,
    value,
    odds,
    created_at: now,
    source,
  };

  oddsHistoryStore.push(snapshot);

  const fixtureIndex = fixturesStore.findIndex((f) => f.id === fixtureId);
  if (fixtureIndex !== -1) {
    fixturesStore[fixtureIndex].last_odds_snapshot_id = snapshot.id;
  }
}

async function syncLiveFixturesFromApiFootball() {
  const data = await fetchApiFootball('football', 'fixtures', { live: 'all' });
  if (!data || !Array.isArray(data.response)) {
    return;
  }

  for (const item of data.response) {
    const fixturePayload = item && item.fixture ? item.fixture : {};
    const leaguePayload = item && item.league ? item.league : {};
    const teamsPayload = item && item.teams ? item.teams : {};
    const goalsPayload = item && item.goals ? item.goals : {};

    const league = ensureLeagueFromApiFootball(leaguePayload);
    if (!league) {
      continue;
    }
    const homeTeam = ensureTeamFromApiFootball(teamsPayload.home, league);
    const awayTeam = ensureTeamFromApiFootball(teamsPayload.away, league);

    const fixtureApiId =
      fixturePayload && fixturePayload.id != null ? String(fixturePayload.id) : '';
    if (!fixtureApiId || !homeTeam || !awayTeam || !league) {
      continue;
    }

    const statusPayload = fixturePayload.status || {};
    const statusShort = String(
      statusPayload.short || statusPayload.long || 'NS',
    );
    const minute =
      typeof statusPayload.elapsed === 'number' ? statusPayload.elapsed : null;

    const homeScore =
      goalsPayload && typeof goalsPayload.home === 'number'
        ? goalsPayload.home
        : null;
    const awayScore =
      goalsPayload && typeof goalsPayload.away === 'number'
        ? goalsPayload.away
        : null;

    const kickoff = fixturePayload.date
      ? String(fixturePayload.date)
      : new Date().toISOString();

    let fixture = fixturesStore.find(
      (f) => f.id_api === fixtureApiId && f.source === 'api-football',
    );

    if (!fixture) {
      fixture = {
        id: randomBytes(16).toString('hex'),
        id_api: fixtureApiId,
        league_id: league.id,
        home_team_id: homeTeam.id,
        away_team_id: awayTeam.id,
        kickoff,
        status: statusShort,
        minute,
        home_score: homeScore,
        away_score: awayScore,
        sport: 'football',
        source: 'api-football',
      };
      fixturesStore.push(fixture);
    } else {
      fixture.league_id = league.id;
      fixture.home_team_id = homeTeam.id;
      fixture.away_team_id = awayTeam.id;
      fixture.kickoff = kickoff;
      fixture.status = statusShort;
      fixture.minute = minute;
      fixture.home_score = homeScore;
      fixture.away_score = awayScore;
    }
  }
}

async function syncUpcomingFixturesFromApiFootball() {
  const data = await fetchApiFootball('football', 'fixtures', { next: 60 });
  if (!data || !Array.isArray(data.response)) {
    return;
  }

  for (const item of data.response) {
    const fixturePayload = item && item.fixture ? item.fixture : {};
    const leaguePayload = item && item.league ? item.league : {};
    const teamsPayload = item && item.teams ? item.teams : {};
    const goalsPayload = item && item.goals ? item.goals : {};

    const league = ensureLeagueFromApiFootball(leaguePayload);
    if (!league) {
      continue;
    }
    const homeTeam = ensureTeamFromApiFootball(teamsPayload.home, league);
    const awayTeam = ensureTeamFromApiFootball(teamsPayload.away, league);

    const fixtureApiId =
      fixturePayload && fixturePayload.id != null ? String(fixturePayload.id) : '';
    if (!fixtureApiId || !homeTeam || !awayTeam || !league) {
      continue;
    }

    const statusPayload = fixturePayload.status || {};
    const statusShort = String(statusPayload.short || statusPayload.long || 'NS');
    const minute =
      typeof statusPayload.elapsed === 'number' ? statusPayload.elapsed : null;

    const homeScore =
      goalsPayload && typeof goalsPayload.home === 'number'
        ? goalsPayload.home
        : null;
    const awayScore =
      goalsPayload && typeof goalsPayload.away === 'number'
        ? goalsPayload.away
        : null;

    const kickoff = fixturePayload.date
      ? String(fixturePayload.date)
      : new Date().toISOString();

    let fixture = fixturesStore.find(
      (f) => f.id_api === fixtureApiId && f.source === 'api-football',
    );

    if (!fixture) {
      fixture = {
        id: randomBytes(16).toString('hex'),
        id_api: fixtureApiId,
        league_id: league.id,
        home_team_id: homeTeam.id,
        away_team_id: awayTeam.id,
        kickoff,
        status: statusShort,
        minute,
        home_score: homeScore,
        away_score: awayScore,
        sport: 'football',
        source: 'api-football',
      };
      fixturesStore.push(fixture);
    } else {
      fixture.league_id = league.id;
      fixture.home_team_id = homeTeam.id;
      fixture.away_team_id = awayTeam.id;
      fixture.kickoff = kickoff;
      fixture.status = statusShort;
      fixture.minute = minute;
      fixture.home_score = homeScore;
      fixture.away_score = awayScore;
    }
  }
}

async function syncLiveEventsFromApiFootball() {
  const targets = fixturesStore.filter(
    (f) =>
      f.sport === 'football' &&
      f.source === 'api-football' &&
      f.minute !== null &&
      f.status !== 'FT',
  );

  for (const fixture of targets) {
    const data = await fetchApiFootball('football', 'fixtures/events', {
      fixture: fixture.id_api,
    });
    if (!data || !Array.isArray(data.response)) {
      continue;
    }

    for (const item of data.response) {
      const timePayload = item && item.time ? item.time : {};
      const playerPayload = item && item.player ? item.player : {};

      const minute =
        typeof timePayload.elapsed === 'number' ? timePayload.elapsed : null;
      const type = String(item.type || '');
      const player = playerPayload.name ? String(playerPayload.name) : null;

      const exists = eventsStore.some(
        (e) =>
          e.fixture_id === fixture.id &&
          e.type === type &&
          e.player === player &&
          e.minute === minute,
      );

      if (exists) {
        continue;
      }

      const event: Event = {
        id: randomBytes(16).toString('hex'),
        fixture_id: fixture.id,
        type,
        player,
        minute,
        payload: item,
        created_at: new Date().toISOString(),
        source: 'api-football',
      };

      eventsStore.push(event);
    }
  }
}

async function syncLiveOddsFromApiFootball() {
  const candidates = fixturesStore.filter((f) => {
    if (f.sport !== 'football') return false;
    if (f.status && ['1H', '2H', 'ET', 'PEN', 'LIVE', 'INPLAY', 'HT'].includes(String(f.status).toUpperCase())) {
      return true;
    }
    if (f.minute !== null && f.status !== 'FT') {
      return true;
    }
    return false;
  });

  const ids = candidates.map((f) => f.id_api).slice(0, 40);
  for (const id of ids) {
    const data = await fetchApiFootball('football', 'odds/live', { fixture: id });
    if (!data || !Array.isArray(data.response) || data.response.length === 0) {
      continue;
    }

    const item = data.response[0];
    const fixture = fixturesStore.find(
      (f) => f.id_api === String(id) && f.source === 'api-football',
    );
    if (!fixture) {
      continue;
    }

    const bookmakers = Array.isArray(item.bookmakers) ? item.bookmakers : [];
    if (!bookmakers.length) {
      continue;
    }

    const mainBookmaker = bookmakers[0];
    const bookmakerName = String(mainBookmaker.name || mainBookmaker.bookmaker || 'api-football');
    const bets = Array.isArray(mainBookmaker.bets) ? mainBookmaker.bets : [];

    for (const bet of bets) {
      const betName = String(bet.name || '');
      const betId = typeof bet.id === 'number' ? bet.id : parseInt(String(bet.id || ''), 10);
      const values = Array.isArray(bet.values) ? bet.values : [];
      if (!values.length) continue;

      const normalizedName = betName.toLowerCase();
      const isMatchWinnerBet =
        betId === 1 ||
        normalizedName.includes('match winner') ||
        normalizedName.includes('matchwinner') ||
        normalizedName.includes('1x2') ||
        normalizedName.includes('fulltime result') ||
        normalizedName.includes('full time result') ||
        normalizedName.includes('resultado final');

      if (!isMatchWinnerBet) continue;

      for (const v of values) {
        const rawValue = String(v.value || '');
        const odd = v.odd != null ? Number(v.odd) : NaN;
        if (!Number.isFinite(odd)) continue;

        let line: string | null = null;
        const normalized = rawValue.toLowerCase();
        if (normalized === 'home' || normalized === '1') line = 'home';
        else if (normalized === 'draw' || normalized === 'x') line = 'draw';
        else if (normalized === 'away' || normalized === '2') line = 'away';
        else continue;

        registerOddsSnapshot(
          fixture.id,
          bookmakerName,
          '1X2',
          'match_winner',
          line,
          0,
          odd,
          'api-football',
        );
      }
    }
  }
}

function getLatestLiveOddsSnapshotForFixture(
  fixtureId: string,
): { home: number; draw: number; away: number } | null {
  const snapshots = oddsHistoryStore.filter(
    (s) => s.fixture_id === fixtureId && s.market === '1X2' && s.market_type === 'match_winner',
  );

  if (!snapshots.length) {
    return null;
  }

  snapshots.sort((a, b) => {
    if (a.created_at < b.created_at) return -1;
    if (a.created_at > b.created_at) return 1;
    return 0;
  });

  let home: number | null = null;
  let draw: number | null = null;
  let away: number | null = null;

  for (let i = snapshots.length - 1; i >= 0; i--) {
    const s = snapshots[i];
    if (s.line === 'home' && home == null) {
      home = s.odds;
    } else if (s.line === 'draw' && draw == null) {
      draw = s.odds;
    } else if (s.line === 'away' && away == null) {
      away = s.odds;
    }

    if (home != null && draw != null && away != null) {
      break;
    }
  }

  if (home == null || away == null) {
    return null;
  }

  return { home, draw: draw ?? 0, away };
}

const betsStore: {
  id: string;
  user_id: string;
  bet_type: 'single' | 'multiple' | 'system';
  stake: number;
  potential_win: number;
  total_odds: number;
  status: 'pending' | 'won' | 'lost' | 'cashout' | 'void';
  is_free_bet: boolean;
  winnings?: number | null;
  created_at: string;
  selections?: any[];
  total_stake?: number;
  potential_return?: number;
  cashout_value?: number;
  cashout_at?: string;
  settled_at?: string;
}[] = [];

interface UserStakeLimits {
  user_id: string;
  max_stake_per_bet: number;
  max_payout: number;
}

const userStakeLimitsStore: UserStakeLimits[] = [];
const matchesStore: {
  id: string;
  sport: string;
  league: string;
  home_team: string;
  away_team: string;
  start_time: string;
  status: 'scheduled' | 'live' | 'finished' | 'cancelled';
  home_score: number | null;
  away_score: number | null;
  created_at: string;
}[] = [];
const promotionsStore: {
  id: string;
  title: string;
  description: string;
  type: 'deposit_bonus' | 'free_bet' | 'cashback' | 'welcome_bonus' | string;
  value: number;
  min_deposit: number;
  max_bonus: number;
  valid_from: string;
  valid_until: string;
  is_active: boolean;
  terms: string;
  created_at: string;
}[] = [];
const auditLogs: AuditLog[] = [];
type RefreshToken = {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
  revoked: boolean;
  userAgent?: string;
  ip?: string;
};
const refreshTokens = new Map<string, RefreshToken>();
const userRefreshIndex = new Map<string, Set<string>>();
type VerificationRequest = {
  email: string;
  userId: string;
  codeHash: string;
  codeSalt: string;
  expiresAt: number;
  attempts: number;
  sentAt: number;
};
type PasswordResetRequest = {
  email: string;
  userId: string;
  codeHash: string;
  codeSalt: string;
  expiresAt: number;
  attempts: number;
  sentAt: number;
};
const verificationRequests = new Map<string, VerificationRequest>();
const passwordResetRequests = new Map<string, PasswordResetRequest>();
const paymentSettingsStore: {
  id: number;
  paypal_enabled: boolean;
  paypal_mode: 'sandbox' | 'live';
  created_at: string;
  updated_at: string;
}[] = [
  {
    id: 1,
    paypal_enabled: true,
    paypal_mode: 'sandbox',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];
const selfExclusionStore: {
  id: string;
  user_id: string;
  type: 'temporary' | 'permanent';
  duration_days?: number;
  start_date: string;
  end_date?: string;
  reason?: string;
  status: 'active' | 'completed' | 'cancelled';
  created_at: string;
}[] = [];

const apiFootballKey =
  process.env.API_FOOTBALL_KEY ||
  process.env.VITE_API_FOOTBALL_KEY ||
  process.env.API_FOOTBALL_KEY_ALT ||
  process.env.X_RAPIDAPI_KEY ||
  process.env['x-rapidapi-key'] ||
  '';
const apiFootballProvider =
  (process.env.API_FOOTBALL_PROVIDER ||
    (process.env.X_RAPIDAPI_KEY || process.env['x-rapidapi-key'] ? 'rapidapi' : 'apisports')).toLowerCase() ===
  'rapidapi'
    ? 'rapidapi'
    : 'apisports';

const apiFootballEndpoints: Record<string, string> = {
  football: 'https://v3.football.api-sports.io',
  basketball: 'https://v1.basketball.api-sports.io',
  baseball: 'https://v1.baseball.api-sports.io',
  hockey: 'https://v1.hockey.api-sports.io',
  rugby: 'https://v1.rugby.api-sports.io',
  volleyball: 'https://v1.volleyball.api-sports.io',
  formula1: 'https://v1.formula-1.api-sports.io',
  mma: 'https://v1.mma.api-sports.io',
  handball: 'https://v1.handball.api-sports.io',
  nfl: 'https://v1.american-football.api-sports.io',
  afl: 'https://v1.afl.api-sports.io',
};

const apiFootballRateLimit: Record<string, { count: number; resetTime: number }> = {};

function getApiFootballBaseUrl(sport: string): string | null {
  if (apiFootballProvider === 'rapidapi') {
    if (sport !== 'football') {
      console.error('RapidAPI atualmente suportado apenas para football');
      return null;
    }
    return 'https://api-football-v1.p.rapidapi.com/v3';
  }

  const baseUrl = apiFootballEndpoints[sport];
  if (!baseUrl) {
    return null;
  }
  return baseUrl;
}

function getApiFootballHeaders(): Record<string, string> {
  if (apiFootballProvider === 'rapidapi') {
    return {
      'x-rapidapi-key': apiFootballKey,
      'x-rapidapi-host': 'api-football-v1.p.rapidapi.com',
    };
  }

  return {
    'x-apisports-key': apiFootballKey,
  };
}

function checkApiFootballRateLimit(sport: string): { allowed: boolean; remaining: number; resetIn: number } {
  const now = Date.now();
  const LIMIT_PER_MINUTE = 1200;
  const WINDOW_MS = 60 * 1000;

  if (!apiFootballRateLimit[sport]) {
    apiFootballRateLimit[sport] = {
      count: 0,
      resetTime: now + WINDOW_MS,
    };
  }

  const limiter = apiFootballRateLimit[sport];

  if (now >= limiter.resetTime) {
    limiter.count = 0;
    limiter.resetTime = now + WINDOW_MS;
  }

  if (limiter.count >= LIMIT_PER_MINUTE) {
    const resetIn = Math.ceil((limiter.resetTime - now) / 1000);
    return {
      allowed: false,
      remaining: 0,
      resetIn,
    };
  }

  limiter.count++;

  return {
    allowed: true,
    remaining: LIMIT_PER_MINUTE - limiter.count,
    resetIn: Math.ceil((limiter.resetTime - now) / 1000),
  };
}

function buildApiFootballFixturesFromStore(liveOnly: boolean) {
  const items = fixturesStore.filter((f) => {
    if (f.sport !== 'football') return false;
    const league = leaguesStore.find((l) => l.id === f.league_id);
    if (!league || isLeagueBlocked(league.name)) return false;
    if (liveOnly) {
      if (f.status && ['1H', '2H', 'ET', 'PEN', 'LIVE', 'INPLAY', 'HT'].includes(String(f.status).toUpperCase())) {
        return true;
      }
      if (f.minute !== null && f.status !== 'FT') return true;
      return false;
    } else {
      const isNotStarted = !f.minute && (!f.status || ['NS', 'TBD', 'PST'].includes(String(f.status).toUpperCase()));
      if (!isNotStarted) return false;
      const kickoffTs = f.kickoff ? Date.parse(f.kickoff) : Date.now();
      return kickoffTs >= Date.now();
    }
  });
  const response = items.map((f) => {
    const league = leaguesStore.find((l) => l.id === f.league_id);
    const home = teamsStore.find((t) => t.id === f.home_team_id);
    const away = teamsStore.find((t) => t.id === f.away_team_id);
    const fixtureIdNum = Number.parseInt(String(f.id_api || ''), 10);
    return {
      fixture: {
        id: Number.isFinite(fixtureIdNum) ? fixtureIdNum : 0,
        date: f.kickoff || new Date().toISOString(),
        status: {
          short: f.status || 'NS',
          elapsed: f.minute != null ? f.minute : null,
        },
        venue: {
          name: '',
        },
      },
      league: {
        name: league ? league.name : '',
        logo: league ? league.logo : '',
        country: league ? league.country : '',
        flag: '',
      },
      teams: {
        home: {
          name: home ? home.name : '',
          logo: home ? home.logo : '',
        },
        away: {
          name: away ? away.name : '',
          logo: away ? away.logo : '',
        },
      },
      goals: {
        home: f.home_score != null ? f.home_score : null,
        away: f.away_score != null ? f.away_score : null,
      },
    };
  });
  return { response };
}

async function fetchApiFootball(
  sport: string,
  endpoint: string,
  params: Record<string, string | number | boolean> = {},
): Promise<any | null> {
  const baseUrl = getApiFootballBaseUrl(sport);
  if (!baseUrl) {
    console.error('Desporto não suportado para API-Football:', sport);
    return null;
  }

  if (!apiFootballKey) {
    console.error('API_FOOTBALL_KEY não configurada');
    return null;
  }

  const rateLimit = checkApiFootballRateLimit(sport);
  if (!rateLimit.allowed) {
    console.warn(
      `Rate limit excedido para API-Football (${sport}), reset em ${rateLimit.resetIn}s`,
    );
    return null;
  }

  const apiUrl = new URL(`${baseUrl}/${endpoint}`);
  Object.entries(params).forEach(([key, value]) => {
    apiUrl.searchParams.append(key, String(value));
  });

  const requestOptions: https.RequestOptions = {
    method: 'GET',
    headers: getApiFootballHeaders(),
  };

  const client = apiUrl.protocol === 'https:' ? https : http;

  return await new Promise((resolve) => {
    const externalReq = client.request(apiUrl.toString(), requestOptions, (externalRes) => {
      const chunks: Buffer[] = [];
      externalRes.on('data', (chunk) => chunks.push(chunk));
      externalRes.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        try {
          const data = raw ? JSON.parse(raw) : {};
          if (data.errors && Object.keys(data.errors).length > 0) {
            console.error(
              'API-Football retornou erro',
              {
                sport,
                endpoint,
                statusCode: externalRes.statusCode,
              },
              data.errors,
            );
            resolve(null);
            return;
          }
          console.log('API-Football resposta', {
            sport,
            endpoint,
            statusCode: externalRes.statusCode,
            hasResponse: Array.isArray((data as any).response),
          });
          resolve(data);
        } catch (err) {
          console.error('Resposta inválida da API-Football', {
            sport,
            endpoint,
            statusCode: externalRes.statusCode,
            error: err,
            rawSample: raw.slice(0, 200),
          });
          resolve(null);
        }
      });
    });

    externalReq.on('error', (err) => {
      console.error('Erro ao chamar API-Football', {
        sport,
        endpoint,
        error: err instanceof Error ? err.message : String(err),
      });
      resolve(null);
    });

    externalReq.end();
  });
}

function getAllowedOrigin(req?: http.IncomingMessage): string {
  const fallback = process.env.CLIENT_ORIGIN || 'http://localhost:4000';
  const originsRaw = (process.env.CLIENT_ORIGINS || fallback).trim();
  const allowList = originsRaw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const origin = (req?.headers?.origin as string) || '';
  if (origin.startsWith('http://localhost')) {
    return origin;
  }
  if (!origin) return allowList[0] || fallback;
  if (allowList.includes(origin)) return origin;
  return allowList[0] || fallback;
}

function sendJson(res: http.ServerResponse, status: number, data: any, req?: http.IncomingMessage) {
  const allowedOrigin = getAllowedOrigin(req);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Credentials': 'true',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy':
      "default-src 'none'; connect-src 'self' http://localhost:5173 http://localhost:4000 ws:; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; font-src 'self' data:",
  } as any);
  res.end(JSON.stringify(data));
}

function parseBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve({});
      }
    });
  });
}

function getAuthToken(req: http.IncomingMessage): string | null {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return null;
  }
  return auth.substring('Bearer '.length);
}

function getUserFromRequest(req: http.IncomingMessage): User | null {
  const token = getAuthToken(req);
  if (!token) {
    return null;
  }
  const session = sessions.get(token);
  if (!session) {
    return null;
  }
  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  const user = users.get(session.userId);
  return user || null;
}

function logAudit(
  action:
    | 'signup'
    | 'login'
    | 'verify_request'
    | 'verify_complete'
    | 'password_reset_request'
    | 'password_reset_complete',
  ip: string,
  email: string,
  success: boolean,
  userId?: string
) {
  auditLogs.push({
    id: randomBytes(8).toString('hex'),
    time: new Date().toISOString(),
    ip,
    action,
    email,
    userId,
    success,
  });
}

function hashPassword(password: string, saltHex?: string): { hashHex: string; saltHex: string } {
  const salt = saltHex ? Buffer.from(saltHex, 'hex') : randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return { hashHex: hash.toString('hex'), saltHex: salt.toString('hex') };
}

function verifyPassword(password: string, saltHex: string, hashHex: string): boolean {
  const salt = Buffer.from(saltHex, 'hex');
  const hash = Buffer.from(hashHex, 'hex');
  const candidate = scryptSync(password, salt, 64);
  try {
    return timingSafeEqual(candidate, hash);
  } catch {
    return false;
  }
}

const loginAttempts = new Map<
  string,
  { count: number; firstAttemptAt: number; lockUntil: number }
>();

function isValidEmail(email: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
}

function isStrongPassword(pw: string): boolean {
  if (pw.length < 8) return false;
  const hasLetter = /[A-Za-z]/.test(pw);
  const hasNumber = /[0-9]/.test(pw);
  return hasLetter && hasNumber;
}

function parseAmount(value: any): number {
  const n = Number(value);
  if (!isFinite(n)) return 0;
  return n;
}

function setCookie(res: http.ServerResponse, name: string, value: string, maxAgeSeconds: number) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  const cookie = `${name}=${value}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
  const existing = res.getHeader('Set-Cookie');
  if (!existing) {
    res.setHeader('Set-Cookie', cookie);
  } else if (Array.isArray(existing)) {
    res.setHeader('Set-Cookie', [...existing, cookie]);
  } else {
    res.setHeader('Set-Cookie', [String(existing), cookie]);
  }
}

function clearCookie(res: http.ServerResponse, name: string) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  const cookie = `${name}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure}`;
  res.setHeader('Set-Cookie', cookie);
}

function getCookie(req: http.IncomingMessage, name: string): string | null {
  const raw = req.headers.cookie || '';
  const parts = raw.split(';').map((p) => p.trim());
  for (const p of parts) {
    if (p.startsWith(name + '=')) {
      return p.substring(name.length + 1);
    }
  }
  return null;
}

function hashToken(token: string): string {
  const buf = scryptSync(token, Buffer.from('rf'), 32);
  return buf.toString('hex');
}
async function seedAdmin(): Promise<void> {
  for (const u of users.values()) {
    if (u.role === 'admin') {
      return;
    }
  }
  const email = (process.env.ADMIN_EMAIL || 'admin@platform.local').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || 'Admin123!';
  const name = process.env.ADMIN_NAME || 'Platform Admin';
  if (!isValidEmail(email)) {
    return;
  }
  const { hashHex, saltHex } = hashPassword(password);
  const id = randomBytes(16).toString('hex');
  const user: User = {
    id,
    email,
    password_hash: hashHex,
    password_salt: saltHex,
    role: 'admin',
    name,
  };
  users.set(id, user);
  walletBalances.set(id, { balance: 0 });
  const now = new Date().toISOString();
  profiles.set(id, {
    id,
    user_id: id,
    email,
    full_name: name,
    name,
    phone: '',
    balance: 0,
    free_bet_balance: 0,
    is_admin: true,
    status: 'active',
    kyc_verified: false,
    email_verified: true,
    created_at: now,
  });
  console.log(`Seeded admin user ${email}`);
}
const server = http.createServer(async (req, res) => {
  if (!req.url) {
    sendJson(res, 404, { error: 'Not found' }, req);
    return;
  }

  if (req.method === 'OPTIONS') {
    const allowedOrigin = getAllowedOrigin(req);
    res.writeHead(200, {
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Credentials': 'true',
    });
    res.end();
    return;
  }

  if (req.url === '/health' && req.method === 'GET') {
    sendJson(res, 200, { status: 'ok' }, req);
    return;
  }

  if (req.method === 'GET' && req.url.startsWith('/api/health')) {
    const commit =
      process.env.RAILWAY_GIT_COMMIT_SHA ||
      process.env.GITHUB_SHA ||
      process.env.VERCEL_GIT_COMMIT_SHA ||
      '';
    sendJson(res, 200, { status: 'ok', ts: new Date().toISOString(), commit: String(commit || '') }, req);
    return;
  }

  if (req.url === '/api/sports' && req.method === 'GET') {
    sendJson(
      res,
      200,
      [
        { id: 'soccer', name: 'Futebol', active: true },
        { id: 'basketball', name: 'Basquetebol', active: true },
        { id: 'tennis', name: 'Tênis', active: true },
        { id: 'ice-hockey', name: 'Hóquei no Gelo', active: true },
      ],
      req,
    );
    return;
  }

  if (req.url === '/api/pricing/config' && req.method === 'GET') {
    sendJson(
      res,
      200,
      {
        margin_pregame: 0.05,
        margin_live: 0.08,
        min_stake: 1,
        max_stake: 1000,
        currency: 'EUR',
      },
      req,
    );
    return;
  }

  if (req.method === 'GET' && req.url.startsWith('/api/featured-games')) {
    try {
      const apiKey = String(process.env.SPORTSAPI_PRO_KEY || '').trim();
      if (!apiKey) {
        sendJson(res, 200, [], req);
        return;
      }

      const urlObj = new URL(req.url, `http://localhost:${PORT}`);
      const include = String(urlObj.searchParams.get('include') || '');
      const wantsOdds = include.split(',').map((s) => s.trim()).includes('odds');

      const sportList = ['soccer', 'basketball', 'tennis', 'ice-hockey'];
      const today = new Date();
      const dates: string[] = [];
      for (let d = 0; d <= 2; d++) {
        const dt = new Date(today);
        dt.setDate(today.getDate() + d);
        dates.push(dt.toISOString().slice(0, 10));
      }

      const perSport = await Promise.all(
        sportList.map(async (sp) => {
          const live = await fetchSportsApiProLive(apiKey, sp).catch(() => []);
          const scheduledChunks = await Promise.all(dates.map((ds) => fetchSportsApiProSchedule(apiKey, sp, ds).catch(() => [])));
          const scheduled = scheduledChunks.flat();
          return [...live, ...scheduled];
        }),
      );

      const seen = new Set<string>();
      const merged = perSport.flat().filter((e: any) => {
        const id = String(e?.external_event_id || '');
        if (!id) return false;
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });

      merged.sort((a: any, b: any) => {
        const al = Number(a?.is_live || 0) === 1 ? 1 : 0;
        const bl = Number(b?.is_live || 0) === 1 ? 1 : 0;
        if (al !== bl) return bl - al;
        return String(a?.event_date || '').localeCompare(String(b?.event_date || ''));
      });

      const picked = merged.slice(0, 30);

      if (wantsOdds) {
        const targets = picked
          .filter((e: any) => {
            const mk = (e as any)?.markets;
            const mkEmpty =
              !mk ||
              (typeof mk === 'string'
                ? (() => {
                    const t = mk.trim();
                    return !t || t === '{}' || t === 'null';
                  })()
                : typeof mk === 'object'
                ? Object.keys(mk || {}).length === 0
                : true);
            return Number(e?.home_odd || 0) <= 1 || mkEmpty;
          })
          .slice(0, 20);
        for (const ev of targets) {
          const sport = String(ev?.sport || 'soccer');
          const matchId = String(ev?.external_event_id || '').split('_').slice(1).join('_');
          if (!matchId) continue;
          const odds = await fetchSportsApiProMatchOdds(apiKey, sport, matchId, { scope: 'featured', provider: 1, homeTeam: ev.home_team, awayTeam: ev.away_team }).catch(() => null);
          if (!odds) continue;
          if (odds.home > 1 || Object.keys(odds.markets || {}).length > 0) {
            ev.home_odd = odds.home;
            ev.draw_odd = odds.draw;
            ev.away_odd = odds.away;
            ev.markets = JSON.stringify(odds.markets || {});
          }
        }
      }

      const parseScore = (raw: any) => {
        try {
          const sc = typeof raw === 'string' ? JSON.parse(raw) : raw;
          return { home: sc?.home ?? null, away: sc?.away ?? null };
        } catch {
          return { home: null, away: null };
        }
      };

      const toMarketsObject = (raw: any) => {
        if (!raw) return {};
        if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
        if (typeof raw === 'string') {
          try {
            const o = JSON.parse(raw);
            return o && typeof o === 'object' ? o : {};
          } catch {
            return {};
          }
        }
        return {};
      };

      const out = picked.map((e: any) => {
        const id = String(e.external_event_id || '');
        const goals = parseScore(e.score);
        const date = String(e.event_date || '');
        const ts = date ? Math.floor(new Date(date).getTime() / 1000) : 0;
        const statusShort = String(e.status || 'NS').trim() || 'NS';
        const elapsed = Number(e.elapsed || 0) || 0;
        const timer = String(e.timer || '').trim();
        return {
          id,
          external_event_id: id,
          match: `${e.home_team} vs ${e.away_team}`,
          league: e.league || '',
          country: e.country || '',
          home_team: e.home_team,
          away_team: e.away_team,
          home_odd: Number(e.home_odd || 0) || 0,
          draw_odd: Number(e.draw_odd || 0) || 0,
          away_odd: Number(e.away_odd || 0) || 0,
          event_date: date,
          is_live: Number(e.is_live || 0) || 0,
          score: e.score || null,
          goals,
          elapsed,
          timer,
          status: { short: statusShort, long: statusShort, elapsed, timer },
          fixture: { id, date, timestamp: ts, status: { short: statusShort, long: statusShort, elapsed, timer } },
          teams: {
            home: { name: e.home_team, logo: e.home_team_logo || '' },
            away: { name: e.away_team, logo: e.away_team_logo || '' },
          },
          home_team_logo: e.home_team_logo || '',
          away_team_logo: e.away_team_logo || '',
          sport: String(e.sport || ''),
          markets: toMarketsObject((e as any).markets),
        };
      });

      sendJson(res, 200, out, req);
      return;
    } catch (err: any) {
      sendJson(res, 200, [], req);
      return;
    }
  }

  if (req.url === '/api/debug/sportsapipro' && req.method === 'GET') {
    try {
      const apiKey = String(process.env.SPORTSAPI_PRO_KEY || '').trim();
      const hasKey = !!apiKey;

      const withTimeout = async (url: string) => {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 8000);
        try {
          const r = await fetch(url, { headers: hasKey ? { 'x-api-key': apiKey, 'accept': 'application/json' } : { 'accept': 'application/json' }, signal: controller.signal });
          const text = await r.text().catch(() => '');
          return {
            url,
            ok: r.ok,
            status: r.status,
            bodySnippet: String(text || '').slice(0, 300),
          };
        } catch (e: any) {
          return { url, ok: false, status: 0, error: String(e?.message || e) };
        } finally {
          clearTimeout(t);
        }
      };

      const today = new Date();
      const startDate = today.toISOString().slice(0, 10);
      const end = new Date(today);
      end.setDate(today.getDate() + 2);
      const endDate = end.toISOString().slice(0, 10);

      const probes = await Promise.all([
        withTimeout('https://v1.football.sportsapipro.com/account/status'),
        withTimeout('https://v1.football.sportsapipro.com/api/v1/football/live'),
        withTimeout('https://v1.football.sportsapipro.com/games/current'),
        withTimeout('https://v1.football.sportsapipro.com/games/allscores'),
        withTimeout(`https://v1.football.sportsapipro.com/api/v1/games?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}&sportId=1`),
      ]);

      sendJson(res, 200, { hasKey, startDate, endDate, probes }, req);
      return;
    } catch (err: any) {
      sendJson(res, 200, { ok: false, error: String(err?.message || err) }, req);
      return;
    }
  }

  if (req.method === 'GET' && req.url.startsWith('/api/debug/odds')) {
    try {
      const apiKey = String(process.env.SPORTSAPI_PRO_KEY || '').trim();
      if (!apiKey) {
        sendJson(res, 200, { ok: false, error: 'SPORTSAPI_PRO_KEY missing' }, req);
        return;
      }

      const urlObj = new URL(req.url, `http://localhost:${PORT}`);
      const sportRaw = String(urlObj.searchParams.get('sport') || 'soccer');
      const gameId = String(urlObj.searchParams.get('gameId') || '').trim();
      const topBookmaker = Number(urlObj.searchParams.get('topBookmaker') || '14') || 14;
      const scopeRaw = String(urlObj.searchParams.get('scope') || 'featured').toLowerCase().trim();
      const scope = scopeRaw === 'all' ? 'all' : 'featured';

      const normalizeSport = (s: string) => {
        const v0 = String(s || '').toLowerCase().trim();
        const v1 = (v0.split(',')[0] || '').split('|')[0] || '';
        const v = v1.replace(/[_\s]+/g, '-').trim();
        if (v === 'football' || v === 'futebol' || v === 'soccer') return 'soccer';
        if (v === 'hockey' || v === 'icehockey' || v === 'ice_hockey' || v === 'ice-hockey') return 'ice-hockey';
        if (v.startsWith('basketball')) return 'basketball';
        if (v.startsWith('tennis')) return 'tennis';
        return v;
      };
      const sport = normalizeSport(sportRaw);
      if (!gameId) {
        sendJson(res, 200, { ok: false, error: 'missing gameId', sport }, req);
        return;
      }

      const toV2Sub = (s: string) => {
        if (s === 'soccer') return 'football';
        if (s === 'ice-hockey') return 'hockey';
        return s;
      };

      const withTimeout = async (url: string) => {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 8000);
        try {
          const r = await fetch(url, {
            headers: { 'x-api-key': apiKey, accept: 'application/json' },
            signal: controller.signal,
          });
          const text = await r.text().catch(() => '');
          return {
            url,
            ok: r.ok,
            status: r.status,
            bodySnippet: String(text || '').slice(0, 500),
          };
        } catch (e: any) {
          return { url, ok: false, status: 0, error: String(e?.message || e) };
        } finally {
          clearTimeout(t);
        }
      };

      const sub = toV2Sub(sport);
      const urlOdds = `https://v2.${sub}.sportsapipro.com/api/match/${encodeURIComponent(gameId)}/odds?scope=${encodeURIComponent(scope)}&provider=1`;
      const urlLive = `https://v2.${sub}.sportsapipro.com/api/live`;

      const [probeOdds, probeLive, parsed] = await Promise.all([
        withTimeout(urlOdds),
        withTimeout(urlLive),
        fetchSportsApiProMatchOdds(apiKey, sport, gameId, { scope, provider: 1 }).catch(() => null),
      ]);

      sendJson(
        res,
        200,
        {
          ok: true,
          sport,
          gameId,
          topBookmaker,
          parsedOdds: parsed,
          probes: [probeOdds, probeLive],
        },
        req,
      );
      return;
    } catch (err: any) {
      sendJson(res, 200, { ok: false, error: String(err?.message || err) }, req);
      return;
    }
  }

  if (req.method === 'GET' && req.url.startsWith('/api/events/by-sport')) {
    try {
      const apiKey = String(process.env.SPORTSAPI_PRO_KEY || '').trim();
      if (!apiKey) {
        sendJson(res, 200, [], req);
        return;
      }

      const urlObj = new URL(req.url, `http://localhost:${PORT}`);
      const rawSport = urlObj.searchParams.get('sports') || urlObj.searchParams.get('sport') || 'soccer';
      const include = String(urlObj.searchParams.get('include') || '');
      const wantsOdds = include.split(',').map((s) => s.trim()).includes('odds');

      const normalizeSport = (s: string) => {
        const v0 = String(s || '').toLowerCase().trim();
        const v1 = (v0.split(',')[0] || '').split('|')[0] || '';
        const v = v1.replace(/[_\s]+/g, '-').trim();
        if (v === 'football' || v === 'futebol' || v === 'soccer') return 'soccer';
        if (v === 'hockey' || v === 'icehockey' || v === 'ice_hockey' || v === 'ice-hockey') return 'ice-hockey';
        if (v.startsWith('basketball')) return 'basketball';
        if (v.startsWith('tennis')) return 'tennis';
        return v;
      };

      const sportList =
        rawSport === 'all'
          ? ['soccer', 'basketball', 'tennis', 'ice-hockey']
          : [normalizeSport(rawSport.split(',')[0])];

      const today = new Date();
      const dates: string[] = [];
      const days = rawSport === 'all' ? 1 : 2;
      for (let d = 0; d <= days; d++) {
        const dt = new Date(today);
        dt.setDate(today.getDate() + d);
        dates.push(dt.toISOString().slice(0, 10));
      }

      const perSport = await Promise.all(
        sportList.map(async (sp) => {
          const live = await fetchSportsApiProLive(apiKey, sp).catch(() => []);
          const scheduledChunks = await Promise.all(dates.map((ds) => fetchSportsApiProSchedule(apiKey, sp, ds).catch(() => [])));
          const scheduled = scheduledChunks.flat();
          return [...live, ...scheduled];
        }),
      );

      const seen = new Set<string>();
      const merged = perSport.flat().filter((e: any) => {
        const id = String(e?.external_event_id || '');
        if (!id) return false;
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });
      const requestedSport = sportList.length === 1 ? sportList[0] : null;
      let mergedFiltered = requestedSport
        ? merged.filter((e: any) => String(e?.external_event_id || '').startsWith(`${requestedSport}_`))
        : merged;
      const leagueFilter = String(urlObj.searchParams.get('league') || '').toLowerCase().trim();
      if (leagueFilter) {
        mergedFiltered = mergedFiltered.filter((e: any) => String(e?.league || '').toLowerCase().includes(leagueFilter));
      }
      const isRealtime = urlObj.searchParams.get('realtime') === '1';

      const parseScore = (raw: any) => {
        try {
          const sc = typeof raw === 'string' ? JSON.parse(raw) : raw;
          return { home: sc?.home ?? null, away: sc?.away ?? null };
        } catch {
          return { home: null, away: null };
        }
      };

      const toResponse = (e: any) => {
        const id = String(e.external_event_id || '');
        const goals = parseScore(e.score);
        const date = String(e.event_date || '');
        const ts = date ? Math.floor(new Date(date).getTime() / 1000) : 0;
        const statusShort = String(e.status || 'NS').trim() || 'NS';
        const elapsed = Number(e.elapsed || 0) || 0;
        const timer = String(e.timer || '').trim();
        const sport = String(e.sport || '');
        return {
          id,
          external_event_id: id,
          match: `${e.home_team} vs ${e.away_team}`,
          league: e.league || '',
          country: e.country || '',
          home_team: e.home_team,
          away_team: e.away_team,
          home_odd: Number(e.home_odd || 0) || 0,
          draw_odd: Number(e.draw_odd || 0) || 0,
          away_odd: Number(e.away_odd || 0) || 0,
          event_date: date,
          is_live: Number(e.is_live || 0) || 0,
          score: e.score || null,
          goals,
          elapsed,
          timer,
          status: { short: statusShort, long: statusShort, elapsed, timer },
          fixture: { id, date, timestamp: ts, status: { short: statusShort, long: statusShort, elapsed, timer } },
          teams: {
            home: { name: e.home_team, logo: e.home_team_logo || '' },
            away: { name: e.away_team, logo: e.away_team_logo || '' },
          },
          home_team_logo: e.home_team_logo || '',
          away_team_logo: e.away_team_logo || '',
          sport,
          markets: e.markets || {},
          odds: e.odds || {},
        };
      };

      if (wantsOdds) {
        const nowMs = Date.now();
        const parseMarketsKeys = (mk: any): string[] => {
          if (!mk) return [];
          if (typeof mk === 'string') {
            const t = mk.trim();
            if (!t || t === '{}' || t === 'null') return [];
            try {
              const o = JSON.parse(t);
              return o && typeof o === 'object' && !Array.isArray(o) ? Object.keys(o) : [];
            } catch {
              return [];
            }
          }
          if (typeof mk === 'object' && !Array.isArray(mk)) return Object.keys(mk);
          return [];
        };

        const needsMarketsEnrich = (e: any) => {
          const keys = parseMarketsKeys(e?.markets);
          if (!keys.length) return true;
          const extras = ['totals', 'alternate_totals', 'btts', 'double_chance', 'dnb', 'handicap', 'spreads'];
          return !keys.some((k) => extras.includes(String(k || '').toLowerCase()));
        };

        const targets = mergedFiltered
          .filter((e: any) => {
            const mkKeys = parseMarketsKeys(e?.markets);
            const mkEmpty = mkKeys.length === 0;
            const needMore = needsMarketsEnrich(e);
            if (Number(e.home_odd || 0) > 1 && !mkEmpty && !needMore) return false;
            const dateMs = Date.parse(String(e.event_date || ''));
            if (!Number.isFinite(dateMs)) return false;
            const st = String(e.status || '').toLowerCase();
            const finished =
              st.includes('final') ||
              st.includes('ended') ||
              st === 'ft' ||
              st.includes('full time') ||
              st.includes('cancel') ||
              st.includes('postpon') ||
              st.includes('aband') ||
              st.includes('suspend');
            if (finished) return false;
            return dateMs > nowMs - 6 * 60 * 60 * 1000;
          })
          .slice(0, 120);
        const ttlMs = isRealtime ? 5_000 : 10 * 60 * 1000;
        const missTtlMs = isRealtime ? 1_500 : 10_000;
        let idx = 0;
        const workers = Array.from({ length: 6 }, async () => {
          while (idx < targets.length) {
            const ev = targets[idx++];
            const sport = String(ev.sport || 'soccer');
            const matchId = String(ev.external_event_id || '').split('_').slice(1).join('_');
            if (!matchId) continue;
            const cacheKey = `v2:${sport}:${matchId}`;
            const cached = sportsApiProOddsCache.get(cacheKey);
            const now = Date.now();
            if (cached) {
              if (cached.odds) {
                if (now - cached.ts < ttlMs) {
                  const odds = cached.odds;
                  if (odds && (odds.home > 1 || Object.keys(odds.markets || {}).length > 0)) {
                    ev.home_odd = odds.home;
                    ev.draw_odd = odds.draw;
                    ev.away_odd = odds.away;
                    ev.markets = JSON.stringify(odds.markets || {});
                  }
                  continue;
                }
              } else {
                if (now - cached.ts < missTtlMs) continue;
              }
            }
            const odds = await fetchSportsApiProMatchOdds(apiKey, sport, matchId, { scope: 'featured', provider: 1, homeTeam: ev.home_team, awayTeam: ev.away_team });
            sportsApiProOddsCache.set(cacheKey, { ts: Date.now(), odds: odds ?? null });
            if (!odds) continue;
            if (odds.home > 1 || Object.keys(odds.markets || {}).length > 0) {
              ev.home_odd = odds.home;
              ev.draw_odd = odds.draw;
              ev.away_odd = odds.away;
              ev.markets = JSON.stringify(odds.markets || {});
            }
          }
        });
        await Promise.all(workers);
      }

      const outAll = mergedFiltered
        .map(toResponse)
        .filter((e: any) => e && e.home_team && e.away_team)
        .sort((a: any, b: any) => {
          const al = Number(a.is_live) === 1 ? 1 : 0;
          const bl = Number(b.is_live) === 1 ? 1 : 0;
          if (al !== bl) return bl - al;
          return String(a.event_date || '').localeCompare(String(b.event_date || ''));
        })
        .slice(0, 800);

      const live = outAll.filter((e: any) => Number(e?.is_live || 0) === 1).slice(0, 250);
      const pregame = outAll.filter((e: any) => Number(e?.is_live || 0) !== 1).slice(0, 550);

      sendJson(res, 200, { live, pregame }, req);
      return;
    } catch (err: any) {
      console.error('[api/events/by-sport] error:', String(err?.message || err));
      sendJson(res, 200, { live: [], pregame: [] }, req);
      return;
    }
  }

  if (
    req.method === 'GET' &&
    (req.url?.startsWith('/media-proxy') || req.url?.startsWith('/api/media-proxy'))
  ) {
    try {
      const urlObj = new URL(req.url!, `http://localhost:${PORT}`);
      const target = urlObj.searchParams.get('url') || '';
      if (!target) {
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end('');
        return;
      }

      let parsed: URL;
      try {
        parsed = new URL(target);
      } catch {
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end('');
        return;
      }

      const host = parsed.hostname.toLowerCase();
      const allowed =
        host === 'media.api-sports.io' || host.endsWith('.api-sports.io');
      if (!allowed || (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')) {
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end('');
        return;
      }

      const client = parsed.protocol === 'https:' ? https : http;
      const proxyReq = client.request(parsed.toString(), { method: 'GET' }, (proxyRes) => {
        const status = proxyRes.statusCode || 200;
        const type = proxyRes.headers['content-type'] || 'image/png';
        res.writeHead(200, { 'Content-Type': Array.isArray(type) ? type[0] : type });
        proxyRes.pipe(res);
      });
      proxyReq.on('error', () => {
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end('');
      });
      proxyReq.end();
    } catch {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end('');
    }
    return;
  }

  if (
    req.method === 'GET' &&
    (req.url.startsWith('/sports/api-football-proxy') ||
      req.url.startsWith('/api/sports/api-football-proxy') ||
      req.url === '/football/odds/live' ||
      req.url === '/api/football/odds/live' ||
      req.url.startsWith('/football/odds/live?') ||
      req.url.startsWith('/api/football/odds/live?') ||
      req.url === '/football/odds/upcoming' ||
      req.url === '/api/football/odds/upcoming' ||
      req.url.startsWith('/football/odds/upcoming?') ||
      req.url.startsWith('/api/football/odds/upcoming?') ||
      req.url === '/basketball/odds/live' ||
      req.url === '/api/basketball/odds/live' ||
      req.url.startsWith('/basketball/odds/live?') ||
      req.url.startsWith('/api/basketball/odds/live?'))
  ) {
    sendJson(res, 200, { response: [] }, req);
    return;
  }

  if (req.method === 'GET' && (req.url === '/api/events' || req.url.startsWith('/api/events?'))) {
    try {
      const apiKey = String(process.env.SPORTSAPI_PRO_KEY || '').trim();
      const urlObj = new URL(req.url, `http://localhost:${PORT}`);
      const slug = String(urlObj.searchParams.get('slug') || '').replace(/^\/+/, '');
      const include = String(urlObj.searchParams.get('include') || '');
      const wantsOdds = include.split(',').map((s) => s.trim()).includes('odds');

      if (!apiKey) {
        sendJson(res, 200, slug ? { error: 'Not found' } : { live: [], pregame: [] }, req);
        return;
      }

      if (!slug) {
        const rawSport = String(urlObj.searchParams.get('sports') || urlObj.searchParams.get('sport') || 'all').toLowerCase().trim();
        const normalizeSportListKey = (s: string) => {
          const v = String(s || '').toLowerCase().trim();
          if (v === 'football' || v === 'futebol') return 'soccer';
          if (v === 'hockey' || v === 'icehockey' || v === 'ice_hockey') return 'ice-hockey';
          return v;
        };
        const sportParam = normalizeSportListKey(rawSport);
        const sportList = sportParam === 'all' ? ['soccer', 'basketball', 'tennis', 'ice-hockey'] : [normalizeSportListKey(sportParam.split(',')[0])];

        const today = new Date();
        const start = new Date(today);
        start.setDate(today.getDate() - 1);
        const end = new Date(today);
        end.setDate(today.getDate() + 7);

        const dates: string[] = [];
        const startDate = start.toISOString().slice(0, 10);
        const endDate = end.toISOString().slice(0, 10);
        const startMs = new Date(`${startDate}T00:00:00.000Z`).getTime();
        const endMs = new Date(`${endDate}T00:00:00.000Z`).getTime();
        for (let t = startMs; Number.isFinite(t) && t <= endMs; t += 24 * 60 * 60 * 1000) {
          dates.push(new Date(t).toISOString().slice(0, 10));
        }

        const perSport = await Promise.all(
          sportList.map(async (sp) => {
            const [live, scheduledChunks] = await Promise.all([
              fetchSportsApiProLive(apiKey, sp).catch(() => []),
              Promise.all(dates.map((ds) => fetchSportsApiProSchedule(apiKey, sp, ds).catch(() => []))),
            ]);
            return [...live, ...scheduledChunks.flat()];
          }),
        );

        const seen = new Set<string>();
        const merged = perSport.flat().filter((e: any) => {
          const id = String(e?.external_event_id || '');
          if (!id) return false;
          if (seen.has(id)) return false;
          seen.add(id);
          return true;
        });

        if (wantsOdds) {
          const nowMs = Date.now();
          const parseMarketsKeys = (mk: any): string[] => {
            if (!mk) return [];
            if (typeof mk === 'string') {
              const t = mk.trim();
              if (!t || t === '{}' || t === 'null') return [];
              try {
                const o = JSON.parse(t);
                return o && typeof o === 'object' && !Array.isArray(o) ? Object.keys(o) : [];
              } catch {
                return [];
              }
            }
            if (typeof mk === 'object' && !Array.isArray(mk)) return Object.keys(mk);
            return [];
          };
          const needsMarketsEnrich = (e: any) => {
            const keys = parseMarketsKeys(e?.markets);
            if (!keys.length) return true;
            const extras = ['totals', 'alternate_totals', 'btts', 'double_chance', 'dnb', 'handicap', 'spreads'];
            return !keys.some((k) => extras.includes(String(k || '').toLowerCase()));
          };

          const targets = merged
            .filter((e: any) => {
              const mkKeys = parseMarketsKeys(e?.markets);
              const mkEmpty = mkKeys.length === 0;
              const needMore = needsMarketsEnrich(e);
              if (Number(e.home_odd || 0) > 1 && !mkEmpty && !needMore) return false;
              const dateMs = Date.parse(String(e.event_date || ''));
              if (!Number.isFinite(dateMs)) return false;
              const st = String(e.status || '').toLowerCase();
              const finished =
                st.includes('final') ||
                st.includes('ended') ||
                st === 'ft' ||
                st.includes('full time') ||
                st.includes('cancel') ||
                st.includes('postpon') ||
                st.includes('aband') ||
                st.includes('suspend');
              if (finished) return false;
              return dateMs > nowMs - 6 * 60 * 60 * 1000;
            })
            .slice(0, 160);

          const ttlMs = 5_000;
          const missTtlMs = 2_000;
          let idx = 0;
          const workers = Array.from({ length: 6 }, async () => {
            while (idx < targets.length) {
              const ev = targets[idx++];
              const sport = String(ev.sport || 'soccer');
              const matchId = String(ev.external_event_id || '').split('_').slice(1).join('_');
              if (!matchId) continue;
              const cacheKey = `v2:${sport}:${matchId}`;
              const cached = sportsApiProOddsCache.get(cacheKey);
              const now = Date.now();
              if (cached) {
                if (cached.odds) {
                  if (now - cached.ts < ttlMs) {
                    const odds = cached.odds;
                    if (odds && (odds.home > 1 || Object.keys(odds.markets || {}).length > 0)) {
                      ev.home_odd = odds.home;
                      ev.draw_odd = odds.draw;
                      ev.away_odd = odds.away;
                      ev.markets = JSON.stringify(odds.markets || {});
                    }
                    continue;
                  }
                } else {
                  if (now - cached.ts < missTtlMs) continue;
                }
              }
              const odds = await fetchSportsApiProMatchOdds(apiKey, sport, matchId, { scope: 'featured', provider: 1, homeTeam: ev.home_team, awayTeam: ev.away_team }).catch(() => null);
              sportsApiProOddsCache.set(cacheKey, { ts: Date.now(), odds: odds ?? null });
              if (!odds) continue;
              if (odds.home > 1 || Object.keys(odds.markets || {}).length > 0) {
                ev.home_odd = odds.home;
                ev.draw_odd = odds.draw;
                ev.away_odd = odds.away;
                ev.markets = JSON.stringify(odds.markets || {});
              }
            }
          });
          await Promise.all(workers);
        }

        const parseScore = (raw: any) => {
          try {
            const sc = typeof raw === 'string' ? JSON.parse(raw) : raw;
            return { home: sc?.home ?? null, away: sc?.away ?? null };
          } catch {
            return { home: null, away: null };
          }
        };
        const toResponse = (e: any) => {
          const id = String(e.external_event_id || '');
          const goals = parseScore(e.score);
          const date = String(e.event_date || '');
          const ts = date ? Math.floor(new Date(date).getTime() / 1000) : 0;
          const statusShort = String(e.status || 'NS').trim() || 'NS';
          const elapsed = Number(e.elapsed || 0) || 0;
          const timer = String(e.timer || '').trim();
          const sport = String(e.sport || '');
          return {
            id,
            external_event_id: id,
            match: `${e.home_team} vs ${e.away_team}`,
            league: e.league || '',
            country: e.country || '',
            home_team: e.home_team,
            away_team: e.away_team,
            home_odd: Number(e.home_odd || 0) || 0,
            draw_odd: Number(e.draw_odd || 0) || 0,
            away_odd: Number(e.away_odd || 0) || 0,
            event_date: date,
            is_live: Number(e.is_live || 0) || 0,
            score: e.score || null,
            goals,
            elapsed,
            timer,
            status: { short: statusShort, long: statusShort, elapsed, timer },
            fixture: { id, date, timestamp: ts, status: { short: statusShort, long: statusShort, elapsed, timer } },
            teams: {
              home: { name: e.home_team, logo: e.home_team_logo || '' },
              away: { name: e.away_team, logo: e.away_team_logo || '' },
            },
            home_team_logo: e.home_team_logo || '',
            away_team_logo: e.away_team_logo || '',
            sport,
            markets: e.markets || {},
            odds: e.odds || {},
          };
        };

        const outAll = merged
          .map(toResponse)
          .filter((e: any) => e && e.home_team && e.away_team)
          .sort((a: any, b: any) => {
            const al = Number(a.is_live) === 1 ? 1 : 0;
            const bl = Number(b.is_live) === 1 ? 1 : 0;
            if (al !== bl) return bl - al;
            return String(a.event_date || '').localeCompare(String(b.event_date || ''));
          })
          .slice(0, 1200);

        const live = outAll.filter((e: any) => Number(e?.is_live || 0) === 1).slice(0, 250);
        const pregame = outAll.filter((e: any) => Number(e?.is_live || 0) !== 1).slice(0, 850);
        sendJson(res, 200, { live, pregame }, req);
        return;
      }

      const oddsMatch = slug.match(/^(.+?)\/odds$/);
      const statsMatch = slug.match(/^(.+?)\/stats$/);
      const h2hMatch = slug.match(/^(.+?)\/h2h$/);
      const requestedId = oddsMatch ? oddsMatch[1] : statsMatch ? statsMatch[1] : h2hMatch ? h2hMatch[1] : slug;
      const parts = String(requestedId || '').split('_');
      const sportRaw = parts.length >= 2 ? parts[0] : 'soccer';
      const normalizeSport = (s: string) => {
        const v = String(s || '').toLowerCase().trim();
        if (v === 'football' || v === 'futebol') return 'soccer';
        if (v === 'hockey' || v === 'icehockey' || v === 'ice_hockey') return 'ice-hockey';
        return v;
      };
      const sport = normalizeSport(sportRaw);

      const today = new Date();
      const start = new Date(today);
      start.setDate(today.getDate() - 1);
      const startDate = start.toISOString().slice(0, 10);
      const end = new Date(today);
      end.setDate(today.getDate() + 7);
      const endDate = end.toISOString().slice(0, 10);

      const dates: string[] = [];
      const startMs = new Date(`${startDate}T00:00:00.000Z`).getTime();
      const endMs = new Date(`${endDate}T00:00:00.000Z`).getTime();
      for (let t = startMs; Number.isFinite(t) && t <= endMs; t += 24 * 60 * 60 * 1000) {
        dates.push(new Date(t).toISOString().slice(0, 10));
      }
      const [live, scheduledChunks] = await Promise.all([
        fetchSportsApiProLive(apiKey, sport).catch(() => []),
        Promise.all(dates.map((ds) => fetchSportsApiProSchedule(apiKey, sport, ds).catch(() => []))),
      ]);
      const scheduled = scheduledChunks.flat();

      const all = [...live, ...scheduled];
      const evt = all.find((e: any) => String(e?.external_event_id || '') === requestedId);

      if (!evt) {
        sendJson(res, 404, { error: 'Not found' }, req);
        return;
      }

      if (statsMatch) {
        sendJson(res, 200, { stats: [], events: [] }, req);
        return;
      }

      if (h2hMatch) {
        sendJson(res, 200, { h2h: [] }, req);
        return;
      }

      const mk = (evt as any)?.markets;
      const mkEmpty =
        !mk ||
        (typeof mk === 'string'
          ? (() => {
              const t = mk.trim();
              return !t || t === '{}' || t === 'null';
            })()
          : typeof mk === 'object'
          ? Object.keys(mk || {}).length === 0
          : true);

      if (wantsOdds && (Number(evt.home_odd || 0) <= 1 || mkEmpty)) {
        const matchId = String(evt.external_event_id || '').split('_').slice(1).join('_');
        if (matchId) {
            const odds = await fetchSportsApiProMatchOdds(apiKey, sport, matchId, { scope: 'all', provider: 1, homeTeam: evt.home_team, awayTeam: evt.away_team }).catch(() => null);
          if (odds && (odds.home > 1 || Object.keys(odds.markets || {}).length > 0)) {
            evt.home_odd = odds.home;
            evt.draw_odd = odds.draw;
            evt.away_odd = odds.away;
            evt.markets = JSON.stringify(odds.markets || {});
          }
        }
      }

      const parseScore = (raw: any) => {
        try {
          const sc = typeof raw === 'string' ? JSON.parse(raw) : raw;
          return { home: sc?.home ?? null, away: sc?.away ?? null };
        } catch {
          return { home: null, away: null };
        }
      };

      const toMarketsObject = (raw: any) => {
        if (!raw) return {};
        if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
        if (typeof raw === 'string') {
          try {
            const o = JSON.parse(raw);
            return o && typeof o === 'object' ? o : {};
          } catch {
            return {};
          }
        }
        return {};
      };

      if (oddsMatch) {
        sendJson(
          res,
          200,
          {
            home_odd: Number(evt.home_odd || 0),
            draw_odd: Number(evt.draw_odd || 0),
            away_odd: Number(evt.away_odd || 0),
            markets: toMarketsObject((evt as any).markets),
            updated_at: new Date().toISOString(),
            provider: 'sportsapipro',
            suspended: false,
            suspended_reason: '',
          },
          req,
        );
        return;
      }

      const goals = parseScore(evt.score);
      const date = String(evt.event_date || '');
      const ts = date ? Math.floor(new Date(date).getTime() / 1000) : 0;
      const statusShort = String(evt.status || 'NS').trim() || 'NS';
      const elapsed = Number(evt.elapsed || 0) || 0;
      const timer = String(evt.timer || '').trim();

      sendJson(
        res,
        200,
        {
          id: String(evt.external_event_id || ''),
          external_event_id: String(evt.external_event_id || ''),
          match: `${evt.home_team} vs ${evt.away_team}`,
          league: evt.league || '',
          country: evt.country || '',
          home_team: evt.home_team,
          away_team: evt.away_team,
          home_odd: Number(evt.home_odd || 0) || 0,
          draw_odd: Number(evt.draw_odd || 0) || 0,
          away_odd: Number(evt.away_odd || 0) || 0,
          event_date: date,
          is_live: Number(evt.is_live || 0) || 0,
          score: evt.score || null,
          goals,
          elapsed,
          timer,
          status: { short: statusShort, long: statusShort, elapsed, timer },
          fixture: { id: String(evt.external_event_id || ''), date, timestamp: ts, status: { short: statusShort, long: statusShort, elapsed, timer } },
          teams: {
            home: { name: evt.home_team, logo: evt.home_team_logo || '' },
            away: { name: evt.away_team, logo: evt.away_team_logo || '' },
          },
          home_team_logo: evt.home_team_logo || '',
          away_team_logo: evt.away_team_logo || '',
          sport: String(evt.sport || sport),
          markets: toMarketsObject((evt as any).markets),
          odds: (evt as any).odds || {},
        },
        req,
      );
      return;
    } catch (err: any) {
      sendJson(res, 500, { error: String(err?.message || err) }, req);
      return;
    }
  }

  if (req.url === '/odds/sports' && req.method === 'GET') {
    const sports = [
      {
        key: 'soccer_portugal_primeira_liga',
        group: 'soccer',
        title: 'Primeira Liga Portugal',
        description: 'Liga principal de futebol em Portugal',
        active: true,
        has_outrights: false,
      },
      {
        key: 'soccer_epl',
        group: 'soccer',
        title: 'Premier League',
        description: 'Liga principal de futebol em Inglaterra',
        active: true,
        has_outrights: false,
      },
      {
        key: 'soccer_spain_la_liga',
        group: 'soccer',
        title: 'La Liga',
        description: 'Liga principal de futebol em Espanha',
        active: true,
        has_outrights: false,
      },
      {
        key: 'basketball_nba',
        group: 'basketball',
        title: 'NBA',
        description: 'Liga profissional de basquetebol dos EUA',
        active: true,
        has_outrights: false,
      },
      {
        key: 'icehockey_nhl',
        group: 'icehockey',
        title: 'NHL',
        description: 'Liga principal de hóquei no gelo na América do Norte',
        active: true,
        has_outrights: false,
      },
    ];

    sendJson(res, 200, sports, req);
    return;
  }

  if (req.url && (req.url === '/api/setIsSelect' || req.url.startsWith('/api/setIsSelect'))) {
    sendJson(res, 200, { ok: true }, req);
    return;
  }

  if (req.url && (req.url === '/api/webviewClick' || req.url.startsWith('/api/webviewClick'))) {
    sendJson(res, 200, { ok: true }, req);
    return;
  }

  if (req.url === '/auth/session' && req.method === 'GET') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 200, { user: null }, req);
      return;
    }
    const { password_hash: _, password_salt: __, ...safeUser } = user;
    sendJson(res, 200, { user: safeUser }, req);
    return;
  }

  if (req.url === '/sports/odds-history' && req.method === 'POST') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' });
      return;
    }
    const body = await parseBody(req);
    const fixtureId = String(body.fixture_id || '');
    const bookmaker = String(body.bookmaker || '');
    const market = String(body.market || '');
    const marketType = String(body.market_type || '');
    const line =
      typeof body.line === 'string' || typeof body.line === 'number'
        ? String(body.line)
        : null;
    const value = Number(body.value || 0);
    const odds = Number(body.odds || 0);
    const source = String(body.source || 'api-football');

    if (!fixtureId || !bookmaker || !market || !marketType || !odds || !Number.isFinite(odds)) {
      sendJson(res, 400, { error: 'Dados de odds inválidos' }, req);
      return;
    }

    const fixture = fixturesStore.find((f) => f.id === fixtureId);
    if (!fixture) {
      sendJson(res, 404, { error: 'Fixture não encontrada' }, req);
      return;
    }

    const now = new Date().toISOString();
    const snapshotId = randomBytes(16).toString('hex');
    const snapshot: OddsSnapshot = {
      id: snapshotId,
      fixture_id: fixtureId,
      bookmaker,
      market,
      market_type: marketType,
      line,
      value,
      odds,
      created_at: now,
      source,
    };
    oddsHistoryStore.push(snapshot);
    fixture.last_odds_snapshot_id = snapshotId;
    sendJson(res, 200, { snapshot }, req);
    return;
  }

  if (req.url?.startsWith('/sports/odds-history') && req.method === 'GET') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' });
      return;
    }
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const fixtureId = url.searchParams.get('fixture_id');
    const limitParam = url.searchParams.get('limit');
    const limit = limitParam ? Number(limitParam) : 200;
    if (!fixtureId) {
      sendJson(res, 400, { error: 'fixture_id é obrigatório' }, req);
      return;
    }
    const list = oddsHistoryStore
      .filter((o) => o.fixture_id === fixtureId)
      .sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
      .slice(-Math.max(1, Math.min(1000, limit)));
    sendJson(res, 200, { history: list }, req);
    return;
  }

  if (req.url === '/auth/signup' && req.method === 'POST') {
    const body = await parseBody(req);
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const name = body.name ? String(body.name) : undefined;

    if (!email || !password) {
      sendJson(res, 400, { error: 'Email e password são obrigatórios' }, req);
      return;
    }
    if (!isValidEmail(email)) {
      logAudit('signup', req.socket.remoteAddress || 'unknown', email, false);
      sendJson(res, 400, { error: 'Email inválido' }, req);
      return;
    }
    if (!isStrongPassword(password)) {
      logAudit('signup', req.socket.remoteAddress || 'unknown', email, false);
      sendJson(res, 400, { error: 'Password fraca. Use 8+ caracteres com letras e números.' }, req);
      return;
    }
    if (name && name.length > 80) {
      logAudit('signup', req.socket.remoteAddress || 'unknown', email, false);
      sendJson(res, 400, { error: 'Nome demasiado longo' }, req);
      return;
    }

    for (const user of users.values()) {
      if (user.email === email) {
        logAudit('signup', req.socket.remoteAddress || 'unknown', email, false);
        sendJson(res, 400, { error: 'Este email já está registado. Tente fazer login.' }, req);
        return;
      }
    }

    const id = randomBytes(16).toString('hex');
    const { hashHex, saltHex } = hashPassword(password);
    const user: User = {
      id,
      email,
      password_hash: hashHex,
      password_salt: saltHex,
      role: 'user',
      name,
    };
    users.set(id, user);
    walletBalances.set(id, { balance: 0 });

    const createdAt = new Date().toISOString();
    profiles.set(id, {
      id,
      user_id: id,
      email,
      full_name: name || '',
      name,
      phone: '',
      balance: 0,
      free_bet_balance: 0,
      is_admin: false,
      status: 'active',
      kyc_verified: false,
      email_verified: false,
      created_at: createdAt,
    });

    const token = randomBytes(24).toString('hex');
    const nowMs = Date.now();
    const ttlMs = 15 * 60 * 1000;
    sessions.set(token, { token, userId: id, issuedAt: nowMs, expiresAt: nowMs + ttlMs });
    const rtVal = randomBytes(32).toString('hex');
    const rtId = randomBytes(8).toString('hex');
    const rt: RefreshToken = {
      id: rtId,
      userId: id,
      tokenHash: hashToken(rtVal),
      createdAt: new Date(nowMs).toISOString(),
      expiresAt: new Date(nowMs + 7 * 24 * 60 * 60 * 1000).toISOString(),
      revoked: false,
      userAgent: String(req.headers['user-agent'] || ''),
      ip: String(req.socket.remoteAddress || ''),
    };
    refreshTokens.set(rtId, rt);
    const idx = userRefreshIndex.get(id) || new Set<string>();
    idx.add(rtId);
    userRefreshIndex.set(id, idx);
    setCookie(res, 'refresh_token', `${rtId}:${rtVal}`, 7 * 24 * 60 * 60);

    const { password_hash: ___, password_salt: ____, ...safeUser } = user;
    sendJson(res, 200, { token, user: safeUser }, req);
    logAudit('signup', req.socket.remoteAddress || 'unknown', email, true, id);
    return;
  }

  if (req.url === '/auth/login' && req.method === 'POST') {
    const body = await parseBody(req);
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');

    if (!email || !password) {
    sendJson(res, 400, { error: 'Email e password são obrigatórios' }, req);
      return;
    }

    const ip = req.socket.remoteAddress || 'unknown';
    const attempt = loginAttempts.get(ip) || { count: 0, firstAttemptAt: 0, lockUntil: 0 };
    const nowMs = Date.now();
    if (attempt.lockUntil && nowMs < attempt.lockUntil) {
    sendJson(res, 429, { error: 'Muitas tentativas. Tente mais tarde.' }, req);
      return;
    }

    let found: User | null = null;
    for (const user of users.values()) {
      if (user.email === email) {
        found = user;
        break;
      }
    }

    if (!found) {
      attempt.count = attempt.firstAttemptAt && nowMs - attempt.firstAttemptAt < 10 * 60 * 1000
        ? attempt.count + 1
        : 1;
      attempt.firstAttemptAt = attempt.firstAttemptAt && nowMs - attempt.firstAttemptAt < 10 * 60 * 1000
        ? attempt.firstAttemptAt
        : nowMs;
      if (attempt.count >= 5) {
        attempt.lockUntil = nowMs + 15 * 60 * 1000;
      }
      loginAttempts.set(ip, attempt);
      logAudit('login', ip, email, false);
      sendJson(res, 400, { error: 'Email ou senha incorretos' }, req);
      return;
    }

    const valid = verifyPassword(password, found.password_salt, found.password_hash);
    if (!valid) {
      attempt.count = attempt.firstAttemptAt && nowMs - attempt.firstAttemptAt < 10 * 60 * 1000
        ? attempt.count + 1
        : 1;
      attempt.firstAttemptAt = attempt.firstAttemptAt && nowMs - attempt.firstAttemptAt < 10 * 60 * 1000
        ? attempt.firstAttemptAt
        : nowMs;
      if (attempt.count >= 5) {
        attempt.lockUntil = nowMs + 15 * 60 * 1000;
      }
      loginAttempts.set(ip, attempt);
      logAudit('login', ip, email, false, found.id);
      sendJson(res, 400, { error: 'Email ou senha incorretos' }, req);
      return;
    }

    loginAttempts.delete(ip);

    const token = randomBytes(24).toString('hex');
    const ttlMs = 15 * 60 * 1000;
    sessions.set(token, { token, userId: found.id, issuedAt: nowMs, expiresAt: nowMs + ttlMs });
    const rtVal = randomBytes(32).toString('hex');
    const rtId = randomBytes(8).toString('hex');
    const rt: RefreshToken = {
      id: rtId,
      userId: found.id,
      tokenHash: hashToken(rtVal),
      createdAt: new Date(nowMs).toISOString(),
      expiresAt: new Date(nowMs + 7 * 24 * 60 * 60 * 1000).toISOString(),
      revoked: false,
      userAgent: String(req.headers['user-agent'] || ''),
      ip: String(req.socket.remoteAddress || ''),
    };
    refreshTokens.set(rtId, rt);
    const idx = userRefreshIndex.get(found.id) || new Set<string>();
    idx.add(rtId);
    userRefreshIndex.set(found.id, idx);
    setCookie(res, 'refresh_token', `${rtId}:${rtVal}`, 7 * 24 * 60 * 60);

    const { password_hash: ___, password_salt: ____, ...safeUser } = found;
    sendJson(res, 200, { token, user: safeUser }, req);
    logAudit('login', ip, email, true, found.id);
    return;
  }

  if (req.url === '/auth/logout' && req.method === 'POST') {
    const token = getAuthToken(req);
    if (token) {
      const session = sessions.get(token);
      sessions.delete(token);
      if (session) {
        const idx = userRefreshIndex.get(session.userId);
        if (idx) {
          for (const rid of idx) {
            const rt = refreshTokens.get(rid);
            if (rt) {
              rt.revoked = true;
              refreshTokens.set(rid, rt);
            }
          }
          userRefreshIndex.delete(session.userId);
        }
      }
    }
    clearCookie(res, 'refresh_token');
    sendJson(res, 200, { ok: true }, req);
    return;
  }

  if (req.url === '/auth/refresh' && req.method === 'POST') {
    const cookieVal = getCookie(req, 'refresh_token');
    if (cookieVal) {
      const [rid, rtoken] = cookieVal.split(':');
      const rt = refreshTokens.get(rid);
      if (!rt || rt.revoked) {
        clearCookie(res, 'refresh_token');
        sendJson(res, 401, { error: 'Sessão inválida' }, req);
        return;
      }
      if (new Date(rt.expiresAt).getTime() <= Date.now()) {
        rt.revoked = true;
        refreshTokens.set(rid, rt);
        clearCookie(res, 'refresh_token');
        sendJson(res, 401, { error: 'Sessão expirada' }, req);
        return;
      }
      if (rt.tokenHash !== hashToken(rtoken)) {
        sendJson(res, 401, { error: 'Sessão inválida' }, req);
        return;
      }
      const user = users.get(rt.userId);
      if (!user) {
        sendJson(res, 401, { error: 'Sessão inválida' }, req);
        return;
      }
      rt.revoked = true;
      refreshTokens.set(rid, rt);
      const newRtVal = randomBytes(32).toString('hex');
      const newRtId = randomBytes(8).toString('hex');
      const nowMs = Date.now();
      const newRt: RefreshToken = {
        id: newRtId,
        userId: rt.userId,
        tokenHash: hashToken(newRtVal),
        createdAt: new Date(nowMs).toISOString(),
        expiresAt: new Date(nowMs + 7 * 24 * 60 * 60 * 1000).toISOString(),
        revoked: false,
        userAgent: String(req.headers['user-agent'] || ''),
        ip: String(req.socket.remoteAddress || ''),
      };
      refreshTokens.set(newRtId, newRt);
      const idx = userRefreshIndex.get(rt.userId) || new Set<string>();
      idx.add(newRtId);
      userRefreshIndex.set(rt.userId, idx);
      setCookie(res, 'refresh_token', `${newRtId}:${newRtVal}`, 7 * 24 * 60 * 60);
      const access = randomBytes(24).toString('hex');
      sessions.set(access, {
        token: access,
        userId: rt.userId,
        issuedAt: nowMs,
        expiresAt: nowMs + 15 * 60 * 1000,
      });
      const { password_hash: ___, password_salt: ____, ...safeUser } = user;
    sendJson(res, 200, { token: access, user: safeUser }, req);
      return;
    } else {
      const token = getAuthToken(req);
      if (!token) {
        sendJson(res, 401, { error: 'Não autenticado' }, req);
        return;
      }
      const session = sessions.get(token);
      if (!session) {
        sendJson(res, 401, { error: 'Sessão inválida' }, req);
        return;
      }
      if (session.expiresAt <= Date.now()) {
        sessions.delete(token);
        sendJson(res, 401, { error: 'Sessão expirada' }, req);
        return;
      }
      const user = users.get(session.userId);
      if (!user) {
        sendJson(res, 401, { error: 'Sessão inválida' }, req);
        return;
      }
      sessions.delete(token);
      const newToken = randomBytes(24).toString('hex');
      const nowRefresh = Date.now();
      sessions.set(newToken, {
        token: newToken,
        userId: session.userId,
        issuedAt: nowRefresh,
        expiresAt: nowRefresh + 15 * 60 * 1000,
      });
      const { password_hash: ___, password_salt: ____, ...safeUser } = user;
    sendJson(res, 200, { token: newToken, user: safeUser }, req);
      return;
    }
  }

  if (req.url === '/auth/request-verification' && req.method === 'POST') {
    const body = await parseBody(req);
    const email = String(body.email || '').toLowerCase();
    if (!isValidEmail(email)) {
    sendJson(res, 400, { error: 'Email inválido' }, req);
      return;
    }
    let found: User | null = null;
    for (const u of users.values()) {
      if (u.email === email) {
        found = u;
        break;
      }
    }
    if (!found) {
    sendJson(res, 404, { error: 'Conta não encontrada' }, req);
      return;
    }
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const salt = randomBytes(8).toString('hex');
    const hash = scryptSync(code, Buffer.from(salt, 'hex'), 32).toString('hex');
    const reqObj: VerificationRequest = {
      email,
      userId: found.id,
      codeHash: hash,
      codeSalt: salt,
      expiresAt: Date.now() + 15 * 60 * 1000,
      attempts: 0,
      sentAt: Date.now(),
    };
    verificationRequests.set(email, reqObj);
    logAudit('verify_request', req.socket.remoteAddress || 'unknown', email, true, found.id);
    const debug = process.env.NODE_ENV !== 'production' ? { debugCode: code } : {};
    sendJson(res, 200, { ok: true, ...debug }, req);
    return;
  }

  if (req.url === '/auth/verify' && req.method === 'POST') {
    const body = await parseBody(req);
    const email = String(body.email || '').toLowerCase();
    const code = String(body.code || '');
    const reqObj = verificationRequests.get(email);
    if (!reqObj) {
      sendJson(res, 400, { error: 'Solicite o código primeiro' });
      return;
    }
    if (Date.now() > reqObj.expiresAt) {
      verificationRequests.delete(email);
      sendJson(res, 400, { error: 'Código expirado' });
      return;
    }
    reqObj.attempts += 1;
    if (reqObj.attempts > 5) {
      verificationRequests.delete(email);
      sendJson(res, 429, { error: 'Muitas tentativas. Solicite novo código.' });
      return;
    }
    const candidate = scryptSync(code, Buffer.from(reqObj.codeSalt, 'hex'), 32).toString('hex');
    if (candidate !== reqObj.codeHash) {
      sendJson(res, 400, { error: 'Código inválido' });
      return;
    }
    verificationRequests.delete(email);
    const profile = profiles.get(reqObj.userId);
    if (profile) {
      (profile as any).email_verified = true;
      profiles.set(reqObj.userId, profile);
    }
    logAudit('verify_complete', req.socket.remoteAddress || 'unknown', email, true, reqObj.userId);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.url === '/auth/request-password-reset' && req.method === 'POST') {
    const body = await parseBody(req);
    const email = String(body.email || '').toLowerCase();
    if (!isValidEmail(email)) {
      sendJson(res, 400, { error: 'Email inválido' });
      return;
    }
    let found: User | null = null;
    for (const u of users.values()) {
      if (u.email === email) {
        found = u;
        break;
      }
    }
    if (!found) {
      sendJson(res, 404, { error: 'Conta não encontrada' });
      return;
    }
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const salt = randomBytes(8).toString('hex');
    const hash = scryptSync(code, Buffer.from(salt, 'hex'), 32).toString('hex');
    const reqObj: PasswordResetRequest = {
      email,
      userId: found.id,
      codeHash: hash,
      codeSalt: salt,
      expiresAt: Date.now() + 15 * 60 * 1000,
      attempts: 0,
      sentAt: Date.now(),
    };
    passwordResetRequests.set(email, reqObj);
    logAudit('password_reset_request', req.socket.remoteAddress || 'unknown', email, true, found.id);
    const debug = process.env.NODE_ENV !== 'production' ? { debugCode: code } : {};
    sendJson(res, 200, { ok: true, ...debug });
    return;
  }

  if (req.url === '/auth/reset-password' && req.method === 'POST') {
    const body = await parseBody(req);
    const email = String(body.email || '').toLowerCase();
    const code = String(body.code || '');
    const newPassword = String(body.newPassword || '');
    if (!isStrongPassword(newPassword)) {
      sendJson(res, 400, { error: 'Password fraca. Use 8+ caracteres com letras e números.' });
      return;
    }
    const reqObj = passwordResetRequests.get(email);
    if (!reqObj) {
      sendJson(res, 400, { error: 'Solicite o código primeiro' });
      return;
    }
    if (Date.now() > reqObj.expiresAt) {
      passwordResetRequests.delete(email);
      sendJson(res, 400, { error: 'Código expirado' });
      return;
    }
    reqObj.attempts += 1;
    if (reqObj.attempts > 5) {
      passwordResetRequests.delete(email);
      sendJson(res, 429, { error: 'Muitas tentativas. Solicite novo código.' });
      return;
    }
    const candidate = scryptSync(code, Buffer.from(reqObj.codeSalt, 'hex'), 32).toString('hex');
    if (candidate !== reqObj.codeHash) {
      sendJson(res, 400, { error: 'Código inválido' });
      return;
    }
    passwordResetRequests.delete(email);
    const user = users.get(reqObj.userId);
    if (!user) {
      sendJson(res, 404, { error: 'Conta não encontrada' });
      return;
    }
    const { hashHex, saltHex } = hashPassword(newPassword);
    user.password_hash = hashHex;
    user.password_salt = saltHex;
    users.set(reqObj.userId, user);
    // revoke sessions and refresh tokens
    for (const [tok, sess] of sessions.entries()) {
      if (sess.userId === reqObj.userId) {
        sessions.delete(tok);
      }
    }
    const idx = userRefreshIndex.get(reqObj.userId);
    if (idx) {
      for (const rid of idx) {
        const rt = refreshTokens.get(rid);
        if (rt) {
          rt.revoked = true;
          refreshTokens.set(rid, rt);
        }
      }
      userRefreshIndex.delete(reqObj.userId);
    }
    clearCookie(res, 'refresh_token');
    logAudit('password_reset_complete', req.socket.remoteAddress || 'unknown', email, true, reqObj.userId);
    sendJson(res, 200, { ok: true });
    return;
  }
  if (req.url === '/wallet' && req.method === 'GET') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' }, req);
      return;
    }

    const balanceEntry = walletBalances.get(user.id) || { balance: 0 };
    const allUserTransactions = transactionsStore
      .filter((t) => t.user_id === user.id)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      .slice(0, 50);

    const completedDeposits = allUserTransactions.filter(
      (t) => t.type === 'deposit' && t.status === 'completed',
    );
    const completedWithdrawals = allUserTransactions.filter(
      (t) => t.type === 'withdrawal' && t.status === 'completed',
    );
    const bets = allUserTransactions.filter((t) => t.type === 'bet' && t.status === 'completed');
    const wins = allUserTransactions.filter((t) => t.type === 'win' && t.status === 'completed');
    const pendingDeps = allUserTransactions.filter(
      (t) => t.type === 'deposit' && t.status === 'pending',
    );
    const pendingWiths = allUserTransactions.filter(
      (t) => t.type === 'withdrawal' && t.status === 'pending',
    );

    const totalDeposited = completedDeposits.reduce((sum, t) => sum + Number(t.amount), 0);
    const totalWithdrawn = completedWithdrawals.reduce((sum, t) => sum + Number(t.amount), 0);
    const totalBets = bets.reduce((sum, t) => sum + Number(t.amount), 0);
    const totalWins = wins.reduce((sum, t) => sum + Number(t.amount), 0);
    const pendingDeposits = pendingDeps.reduce((sum, t) => sum + Number(t.amount), 0);
    const pendingWithdrawals = pendingWiths.reduce((sum, t) => sum + Number(t.amount), 0);

    const profile = profiles.get(user.id);

    sendJson(
      res,
      200,
      {
        balance: balanceEntry.balance,
        bonusBalance: 0,
        freeBetBalance: 0,
        totalDeposited,
        totalWithdrawn,
        totalBets,
        totalWins,
        pendingDeposits,
        pendingWithdrawals,
        profile: profile || null,
        recentTransactions: allUserTransactions,
      },
      req,
    );
    return;
  }

  if (req.url === '/risk/user-limits' && req.method === 'GET') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' }, req);
      return;
    }

    let limits = userStakeLimitsStore.find((l) => l.user_id === user.id);

    if (!limits) {
      limits = {
        user_id: user.id,
        max_stake_per_bet: 1000,
        max_payout: 50000,
      };
      userStakeLimitsStore.push(limits);
    }

    sendJson(
      res,
      200,
      {
        maxStakePerBet: limits.max_stake_per_bet,
        maxPayout: limits.max_payout,
      },
      req,
    );
    return;
  }

  if (req.url === '/wallet/deposit' && req.method === 'POST') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' });
      return;
    }

    const body = await parseBody(req);
    const amount = parseAmount(body.amount || 0);

    if (!amount || amount <= 0) {
      sendJson(res, 400, { error: 'Valor inválido' });
      return;
    }

    const entry = walletBalances.get(user.id) || { balance: 0 };
    entry.balance += amount;
    walletBalances.set(user.id, entry);

    const now = new Date().toISOString();

    const profile = profiles.get(user.id);
    if (profile) {
      profile.balance = entry.balance;
      profile.updated_at = now;
      profiles.set(user.id, profile);
    }
    const tx = {
      id: randomBytes(16).toString('hex'),
      user_id: user.id,
      type: 'deposit' as const,
      amount,
      status: 'completed' as const,
      payment_method: body.payment_method || 'manual',
      description: body.description || 'Depósito',
      external_id: body.external_id,
      stripe_session_id: body.stripe_session_id,
      completed_at: now,
      created_at: now,
      updated_at: now,
    };
    transactionsStore.push(tx);

    sendJson(res, 200, { ok: true, balance: entry.balance, transaction: tx });
    return;
  }

  if (req.url === '/payments/stripe/card' && req.method === 'POST') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' }, req);
      return;
    }
    if (!stripe) {
      sendJson(res, 500, { error: 'Stripe não configurado' }, req);
      return;
    }

    const body = await parseBody(req);
    const rawAmount = Number(body.amount || 0);

    if (!rawAmount || rawAmount <= 0) {
      sendJson(res, 400, { error: 'Valor inválido' }, req);
      return;
    }

    const amountCents = Math.round(rawAmount * 100);

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: 'eur',
      payment_method_types: ['card'],
      description: body.description || 'Depósito Cartão via Stripe',
      statement_descriptor: 'BET62',
      metadata: {
        user_id: user.id,
        user_email: user.email,
        type: 'deposit',
        payment_method: 'card',
        description: body.description || 'Depósito Cartão via Stripe',
      },
    });

    sendJson(
      res,
      200,
      {
        ok: true,
        payment_intent_id: paymentIntent.id,
        client_secret: paymentIntent.client_secret,
      },
      req,
    );
    return;
  }

  if (req.url === '/payments/stripe/mbway' && req.method === 'POST') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' }, req);
      return;
    }
    if (!stripe) {
      sendJson(res, 500, { error: 'Stripe não configurado' }, req);
      return;
    }

    const body = await parseBody(req);
    const rawAmount = Number(body.amount || 0);
    const phone = body.phone ? String(body.phone).trim() : '';

    if (!rawAmount || rawAmount <= 0) {
      sendJson(res, 400, { error: 'Valor inválido' }, req);
      return;
    }

    const amountCents = Math.round(rawAmount * 100);

    try {
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amountCents,
        currency: 'eur',
        payment_method_types: ['mb_way'],
        description: body.description || 'Depósito MB WAY',
        statement_descriptor: 'BET62',
        metadata: {
          user_id: user.id,
          user_email: user.email,
          type: 'deposit',
          payment_method: 'mbway',
          ...(phone ? { phone } : {}),
        },
      });

      sendJson(
        res,
        200,
        {
          ok: true,
          payment_intent_id: paymentIntent.id,
          client_secret: paymentIntent.client_secret,
        },
        req,
      );
    } catch (err: any) {
      console.error('Stripe MB WAY error:', err?.message || err);
      sendJson(
        res,
        500,
        {
          error:
            err?.message ||
            'Erro ao iniciar pagamento MB WAY. Verifica configuração da conta Stripe e método MB WAY.',
        },
        req,
      );
    }
    return;
  }

  if (req.url === '/payments/stripe/mbway/confirm' && req.method === 'POST') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' }, req);
      return;
    }
    if (!stripe) {
      sendJson(res, 500, { error: 'Stripe não configurado' }, req);
      return;
    }

    const body = await parseBody(req);
    const paymentIntentId = typeof body.payment_intent_id === 'string' ? body.payment_intent_id : '';

    if (!paymentIntentId) {
      sendJson(res, 400, { error: 'payment_intent_id é obrigatório' }, req);
      return;
    }

    try {
      const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
      const metadata: any = pi.metadata || {};
      const userId = (metadata.user_id as string) || '';

      if (!userId || userId !== user.id) {
        sendJson(res, 403, { error: 'Pagamento não pertence a este utilizador' }, req);
        return;
      }

      const amountReceived =
        typeof pi.amount_received === 'number' && pi.amount_received > 0
          ? pi.amount_received
          : typeof pi.amount === 'number'
          ? pi.amount
          : 0;

      if (pi.status !== 'succeeded' || amountReceived <= 0) {
        sendJson(res, 400, { error: 'Pagamento MB WAY ainda não foi confirmado' }, req);
        return;
      }

      const existing = transactionsStore.find(
        (t) => t.external_id === pi.id || t.stripe_session_id === pi.id,
      );

      if (existing) {
        sendJson(res, 200, { ok: true, balance: walletBalances.get(userId)?.balance ?? 0 }, req);
        return;
      }

      const amount = amountReceived / 100;
      const entry = walletBalances.get(userId) || { balance: 0 };
      entry.balance += amount;
      walletBalances.set(userId, entry);

      const now = new Date().toISOString();
      const profile = profiles.get(userId);
      if (profile) {
        profile.balance = entry.balance;
        profile.updated_at = now;
        profiles.set(userId, profile);
      }

      const tx = {
        id: randomBytes(16).toString('hex'),
        user_id: userId,
        type: 'deposit' as const,
        amount,
        status: 'completed' as const,
        payment_method: (metadata.payment_method as string) || 'mbway',
        description: (metadata.description as string) || 'Depósito MB WAY via Stripe',
        external_id: pi.id as string,
        stripe_session_id: pi.id as string,
        completed_at: now,
        created_at: now,
        updated_at: now,
      };
      transactionsStore.push(tx);

      sendJson(res, 200, { ok: true, balance: entry.balance, transaction: tx }, req);
    } catch (err: any) {
      console.error('Stripe MB WAY confirm error:', err?.message || err);
      sendJson(
        res,
        500,
        {
          error:
            err?.message ||
            'Erro ao confirmar pagamento MB WAY. Verifica configuração da conta Stripe.',
        },
        req,
      );
    }
    return;
  }

  if (req.url === '/wallet/withdraw' && req.method === 'POST') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' });
      return;
    }

    const body = await parseBody(req);
    const amount = parseAmount(body.amount || 0);

    if (!amount || amount <= 0) {
      sendJson(res, 400, { error: 'Valor inválido' });
      return;
    }

    const entry = walletBalances.get(user.id) || { balance: 0 };

    if (entry.balance < amount) {
      sendJson(res, 400, { error: 'Saldo insuficiente' });
      return;
    }

    entry.balance -= amount;
    walletBalances.set(user.id, entry);

    const now = new Date().toISOString();

    const profile = profiles.get(user.id);
    if (profile) {
      profile.balance = entry.balance;
      profile.updated_at = now;
      profiles.set(user.id, profile);
    }
    const tx = {
      id: randomBytes(16).toString('hex'),
      user_id: user.id,
      type: 'withdrawal' as const,
      amount,
      status: 'pending' as const,
      payment_method: body.payment_method || 'manual',
      description: body.description || 'Levantamento',
      external_id: body.external_id,
      stripe_session_id: body.stripe_session_id,
      completed_at: now,
      created_at: now,
      updated_at: now,
    };
    transactionsStore.push(tx);

    sendJson(res, 200, { ok: true, balance: entry.balance, transaction: tx });
    return;
  }

  if (req.url === '/wallet/withdraw/cancel' && req.method === 'POST') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' });
      return;
    }
    const body = await parseBody(req);
    const id = String(body.transactionId || '');
    if (!id) {
      sendJson(res, 400, { error: 'transactionId é obrigatório' });
      return;
    }

    const idx = transactionsStore.findIndex((t) => t.id === id && t.user_id === user.id && t.type === 'withdrawal');
    if (idx === -1) {
      sendJson(res, 404, { error: 'Transação não encontrada' });
      return;
    }
    const tx = transactionsStore[idx];
    if (tx.status !== 'pending') {
      sendJson(res, 400, { error: 'Apenas levantamentos pendentes podem ser cancelados' });
      return;
    }

    // Refund
    const entry = walletBalances.get(user.id) || { balance: 0 };
    entry.balance += tx.amount;
    walletBalances.set(user.id, entry);
    const profile = profiles.get(user.id);
    if (profile) {
      profile.balance = entry.balance;
      profile.updated_at = new Date().toISOString();
      profiles.set(user.id, profile);
    }

    transactionsStore[idx] = { ...tx, status: 'cancelled', updated_at: new Date().toISOString() };
    sendJson(res, 200, { ok: true, balance: entry.balance, transaction: transactionsStore[idx] });
    return;
  }

  if (req.url === '/wallet/bet' && req.method === 'POST') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' });
      return;
    }

    const body = await parseBody(req);
    const amount = parseAmount(body.amount || 0);
    const betId = body.betId ? String(body.betId) : undefined;
    const betType = (body.betType as 'single' | 'multiple' | 'system') || 'single';
    const totalOdds = parseAmount(body.totalOdds || 1);
    const potentialWin = parseAmount(body.potentialWin || amount * totalOdds);
    const isFreeBet = Boolean(body.isFreeBet || false);
    const selections = Array.isArray(body.selections) ? body.selections : [];

    if (!amount || amount <= 0) {
      sendJson(res, 400, { error: 'Valor inválido' });
      return;
    }
    if (!totalOdds || totalOdds <= 1) {
      sendJson(res, 400, { error: 'Odds inválidas' });
      return;
    }
    if (!Array.isArray(selections) || selections.length < 1) {
      sendJson(res, 400, { error: 'Seleções inválidas' });
      return;
    }

    const entry = walletBalances.get(user.id) || { balance: 0 };

    if (entry.balance < amount) {
      sendJson(res, 400, { error: 'Saldo insuficiente' });
      return;
    }

    entry.balance -= amount;
    walletBalances.set(user.id, entry);

    const now = new Date().toISOString();

    const profile = profiles.get(user.id);
    if (profile) {
      profile.balance = entry.balance;
      profile.updated_at = now;
      profiles.set(user.id, profile);
    }

    const tx = {
      id: randomBytes(16).toString('hex'),
      user_id: user.id,
      type: 'bet' as const,
      amount,
      status: 'completed' as const,
      payment_method: undefined,
      description: betId ? `Aposta #${betId.slice(0, 8)}` : 'Aposta colocada',
      external_id: undefined,
      stripe_session_id: undefined,
      completed_at: now,
      created_at: now,
      updated_at: now,
    };
    transactionsStore.push(tx);

    const bet = {
      id: betId || randomBytes(16).toString('hex'),
      user_id: user.id,
      bet_type: betType,
      stake: amount,
      potential_win: potentialWin,
      total_odds: totalOdds,
      status: 'pending' as const,
      is_free_bet: isFreeBet,
      winnings: null,
      created_at: now,
      selections,
      total_stake: amount,
      potential_return: potentialWin,
    };
    betsStore.push(bet);

    sendJson(res, 200, { ok: true, balance: entry.balance, transaction: tx, bet });
    return;
  }

  if (req.url === '/wallet/win' && req.method === 'POST') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' });
      return;
    }

    const body = await parseBody(req);
    const amount = Number(body.amount || 0);
    const betId = body.betId ? String(body.betId) : undefined;

    if (!amount || amount <= 0) {
      sendJson(res, 400, { error: 'Valor inválido' });
      return;
    }

    const entry = walletBalances.get(user.id) || { balance: 0 };
    entry.balance += amount;
    walletBalances.set(user.id, entry);

    const now = new Date().toISOString();

    const profile = profiles.get(user.id);
    if (profile) {
      profile.balance = entry.balance;
      profile.updated_at = now;
      profiles.set(user.id, profile);
    }
    const tx = {
      id: randomBytes(16).toString('hex'),
      user_id: user.id,
      type: 'win' as const,
      amount,
      status: 'completed' as const,
      payment_method: undefined,
      description: betId ? `Ganho da aposta #${betId.slice(0, 8)}` : 'Ganhos de aposta',
      external_id: undefined,
      stripe_session_id: undefined,
      completed_at: now,
      created_at: now,
      updated_at: now,
    };
    transactionsStore.push(tx);

    sendJson(res, 200, { ok: true, balance: entry.balance, transaction: tx });
    return;
  }

  if (req.url === '/webhooks/stripe' && req.method === 'POST') {
    let event: any;

    if (stripe && stripeWebhookSecret) {
      let rawBody = '';
      await new Promise<void>((resolve, reject) => {
        req.on('data', (chunk) => {
          rawBody += chunk;
        });
        req.on('end', () => resolve());
        req.on('error', reject);
      });
      const sig = (req.headers['stripe-signature'] as string) || '';
      try {
        event = stripe.webhooks.constructEvent(rawBody, sig, stripeWebhookSecret);
      } catch {
        sendJson(res, 400, { error: 'Webhook inválido' });
        return;
      }
    } else {
      const body = await parseBody(req);
      event = body;
    }

    if (event && event.type === 'payment_intent.succeeded') {
      const pi = event.data?.object as any;
      const metadata = pi?.metadata || {};
      const userId = (metadata.user_id as string) || '';
      const amountReceived =
        typeof pi?.amount_received === 'number' && pi.amount_received > 0
          ? pi.amount_received
          : typeof pi?.amount === 'number'
          ? pi.amount
          : 0;

      if (userId && amountReceived > 0) {
        const existing = transactionsStore.find(
          (t) => t.external_id === pi.id || t.stripe_session_id === pi.id,
        );

        if (!existing) {
          const amount = amountReceived / 100;
          const entry = walletBalances.get(userId) || { balance: 0 };
          entry.balance += amount;
          walletBalances.set(userId, entry);

          const now = new Date().toISOString();
          const profile = profiles.get(userId);
          if (profile) {
            profile.balance = entry.balance;
            profile.updated_at = now;
            profiles.set(userId, profile);
          }

          const paymentMethod =
            (metadata.payment_method as string) ||
            (Array.isArray(pi.payment_method_types) ? pi.payment_method_types[0] : '') ||
            'stripe';

          const tx = {
            id: randomBytes(16).toString('hex'),
            user_id: userId,
            type: 'deposit' as const,
            amount,
            status: 'completed' as const,
            payment_method: paymentMethod,
            description:
              (metadata.description as string) || 'Depósito via Stripe',
            external_id: pi.id as string,
            stripe_session_id: pi.id as string,
            completed_at: now,
            created_at: now,
            updated_at: now,
          };
          transactionsStore.push(tx);
        }
      }
    }

    sendJson(res, 200, { received: true });
    return;
  }

  if (req.url === '/wallet/cashout' && req.method === 'POST') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' });
      return;
    }

    const body = await parseBody(req);
    const amount = Number(body.amount || 0);
    const betId = body.betId ? String(body.betId) : '';

    if (!betId) {
      sendJson(res, 400, { error: 'betId é obrigatório' });
      return;
    }
    if (!amount || amount <= 0) {
      sendJson(res, 400, { error: 'Valor inválido' });
      return;
    }

    const idx = betsStore.findIndex((b) => b.id === betId && b.user_id === user.id);
    if (idx === -1) {
      sendJson(res, 404, { error: 'Aposta não encontrada' });
      return;
    }

    const existingBet = betsStore[idx];
    if (existingBet.status !== 'pending') {
      sendJson(res, 400, { error: 'Apenas apostas pendentes podem fazer cash out' });
      return;
    }

    if (amount > existingBet.potential_win) {
      sendJson(res, 400, { error: 'Valor de cash out inválido' });
      return;
    }

    const now = new Date().toISOString();

    const entry = walletBalances.get(user.id) || { balance: 0 };
    entry.balance += amount;
    walletBalances.set(user.id, entry);

    const profile = profiles.get(user.id);
    if (profile) {
      profile.balance = entry.balance;
      profile.updated_at = now;
      profiles.set(user.id, profile);
    }

    const updatedBet = {
      ...existingBet,
      status: 'cashout' as const,
      cashout_value: amount,
      cashout_at: now,
      settled_at: now,
      winnings: amount,
    };
    betsStore[idx] = updatedBet;

    const tx = {
      id: randomBytes(16).toString('hex'),
      user_id: user.id,
      type: 'cashout' as const,
      amount,
      status: 'completed' as const,
      payment_method: undefined,
      description: `Cash out da aposta #${betId.slice(0, 8)}`,
      external_id: undefined,
      stripe_session_id: undefined,
      completed_at: now,
      created_at: now,
      updated_at: now,
    };
    transactionsStore.push(tx);

    sendJson(res, 200, { ok: true, balance: entry.balance, bet: updatedBet, transaction: tx });
    return;
  }

  if (req.url === '/transactions' && req.method === 'GET') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' });
      return;
    }

    const list = transactionsStore
      .filter((t) => t.user_id === user.id)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

    sendJson(res, 200, { transactions: list });
    return;
  }

  if (req.url === '/bets' && req.method === 'GET') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' });
      return;
    }

    const list = betsStore
      .filter((b) => b.user_id === user.id)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

    sendJson(res, 200, { bets: list });
    return;
  }

  if (req.url === '/transactions' && req.method === 'POST') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' });
      return;
    }

    const body = await parseBody(req);
    const amount = parseAmount(body.amount || 0);

    if (!amount || amount <= 0) {
      sendJson(res, 400, { error: 'Valor inválido' });
      return;
    }
    const validTypes = new Set(['deposit', 'withdrawal', 'bet', 'win', 'cashout']);
    const validStatuses = new Set(['pending', 'completed', 'failed', 'cancelled']);
    const type = (body.type || 'deposit') as string;
    const status = (body.status || 'completed') as string;
    if (!validTypes.has(type) || !validStatuses.has(status)) {
      sendJson(res, 400, { error: 'Tipo ou estado inválido' });
      return;
    }

    const now = new Date().toISOString();
    const tx = {
      id: randomBytes(16).toString('hex'),
      user_id: user.id,
      type: type as any,
      amount,
      status: status as any,
      payment_method: body.payment_method,
      description: body.description,
      external_id: body.external_id,
      stripe_session_id: body.stripe_session_id,
      completed_at: body.completed_at || now,
      created_at: now,
      updated_at: now,
    } as (typeof transactionsStore)[number];

    transactionsStore.push(tx);

    sendJson(res, 200, { transaction: tx });
    return;
  }

  if (req.url?.startsWith('/admin/audit-logs') && req.method === 'GET') {
    const user = getUserFromRequest(req);
    if (!user || user.role !== 'admin') {
      sendJson(res, 403, { error: 'Acesso negado' });
      return;
    }
    const [pathOnly, query = ''] = req.url.split('?');
    const params = new URLSearchParams(query);
    const limit = Math.max(1, Math.min(500, Number(params.get('limit') || 100)));
    const action = params.get('action') as 'signup' | 'login' | null;
    const email = params.get('email');
    let list = auditLogs.slice().reverse();
    if (action) {
      list = list.filter((l) => l.action === action);
    }
    if (email) {
      const q = String(email).toLowerCase();
      list = list.filter((l) => l.email.toLowerCase() === q);
    }
    sendJson(res, 200, { logs: list.slice(0, limit) });
    return;
  }

  if (req.url.startsWith('/transactions/') && req.method === 'PUT') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' });
      return;
    }

    const id = req.url.split('/')[2];
    const body = await parseBody(req);

    const idx = transactionsStore.findIndex((t) => t.id === id && t.user_id === user.id);
    if (idx === -1) {
      sendJson(res, 404, { error: 'Transação não encontrada' });
      return;
    }

    const existing = transactionsStore[idx];
    const updated = {
      ...existing,
      ...body,
      updated_at: new Date().toISOString(),
    };

    transactionsStore[idx] = updated;

    sendJson(res, 200, { transaction: updated });
    return;
  }

  if (req.url === '/kyc/documents' && req.method === 'GET') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' });
      return;
    }

    const docs = kycDocuments
      .filter((d) => d.user_id === user.id)
      .sort((a, b) => (a.uploaded_at < b.uploaded_at ? 1 : -1));

    sendJson(res, 200, { documents: docs });
    return;
  }

  if (req.url === '/kyc/documents' && req.method === 'POST') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' });
      return;
    }

    const body = await parseBody(req);
    const documentType = body.documentType as
      | 'id_front'
      | 'id_back'
      | 'proof_address'
      | 'selfie';
    const fileName = String(body.fileName || '');
    const fileData = String(body.fileData || '');

    const allowedTypes = new Set(['id_front', 'id_back', 'proof_address', 'selfie']);
    if (!allowedTypes.has(documentType) || !fileName || !fileData) {
      sendJson(res, 400, { error: 'Dados do documento em falta' });
      return;
    }
    if (fileName.length > 128) {
      sendJson(res, 400, { error: 'Nome de ficheiro demasiado longo' });
      return;
    }
    if (fileData.length > 2_000_000) {
      sendJson(res, 413, { error: 'Documento demasiado grande' });
      return;
    }

    for (let i = kycDocuments.length - 1; i >= 0; i -= 1) {
      const doc = kycDocuments[i];
      if (doc.user_id === user.id && doc.document_type === documentType) {
        kycDocuments.splice(i, 1);
      }
    }

    const now = new Date().toISOString();
    const id = randomBytes(16).toString('hex');

    const doc = {
      id,
      user_id: user.id,
      document_type: documentType,
      file_name: fileName,
      file_url: fileData,
      status: 'pending' as const,
      uploaded_at: now,
    };

    kycDocuments.push(doc);

    sendJson(res, 200, { document: doc });
    return;
  }

  if (req.url?.startsWith('/matches/') && req.url.endsWith('/incidents') && req.method === 'GET') {
    const parts = req.url.split('/');
    const fixtureId = parts[2];

    // Neste mock não temos incidentes reais, devolvemos lista vazia
    sendJson(res, 200, {
      fixtureId,
      incidents: [],
    });
    return;
  }

  if (req.url?.startsWith('/kyc/documents/') && req.method === 'DELETE') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' });
      return;
    }

    const id = req.url.split('/')[3];
    const index = kycDocuments.findIndex((d) => d.id === id && d.user_id === user.id);
    if (index === -1) {
      sendJson(res, 404, { error: 'Documento não encontrado' });
      return;
    }

    kycDocuments.splice(index, 1);

    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.url === '/admin/users' && req.method === 'GET') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' });
      return;
    }
    if (user.role !== 'admin') {
      sendJson(res, 403, { error: 'Acesso negado' });
      return;
    }

    const list = Array.from(profiles.values()).map((p) => ({
      id: p.id,
      email: p.email,
      full_name: p.full_name ?? null,
      balance: p.balance ?? 0,
      status: p.status ?? 'active',
      is_admin: p.is_admin ?? false,
      created_at: p.created_at,
      kyc_verified: p.kyc_verified ?? false,
      phone: p.phone ?? null,
    }));

    list.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

    sendJson(res, 200, { users: list });
    return;
  }

  if (req.url?.startsWith('/admin/users/') && req.method === 'PUT') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' });
      return;
    }
    if (user.role !== 'admin') {
      sendJson(res, 403, { error: 'Acesso negado' });
      return;
    }

    const targetId = req.url.split('/')[3];
    const body = await parseBody(req);

    const existing = profiles.get(targetId);
    if (!existing) {
      sendJson(res, 404, { error: 'Utilizador não encontrado' });
      return;
    }

    const now = new Date().toISOString();
    const updated = {
      ...existing,
      full_name: body.full_name ?? existing.full_name,
      status: body.status ?? existing.status,
      is_admin: typeof body.is_admin === 'boolean' ? body.is_admin : existing.is_admin,
      kyc_verified: typeof body.kyc_verified === 'boolean' ? body.kyc_verified : existing.kyc_verified,
      phone: body.phone ?? existing.phone,
      balance: typeof body.balance === 'number' ? body.balance : existing.balance,
      updated_at: now,
    };

    profiles.set(targetId, updated);

    const balanceEntry = walletBalances.get(targetId) || { balance: 0 };
    balanceEntry.balance = updated.balance ?? balanceEntry.balance;
    walletBalances.set(targetId, balanceEntry);

    const userEntry = users.get(targetId);
    if (userEntry) {
      userEntry.role = updated.is_admin ? 'admin' : 'user';
      users.set(targetId, userEntry);
    }

    sendJson(res, 200, { user: {
      id: updated.id,
      email: updated.email,
      full_name: updated.full_name ?? null,
      balance: updated.balance ?? 0,
      status: updated.status ?? 'active',
      is_admin: updated.is_admin ?? false,
      created_at: updated.created_at,
      kyc_verified: updated.kyc_verified ?? false,
      phone: updated.phone ?? null,
    } });
    return;
  }

  if (req.url === '/admin/transactions' && req.method === 'GET') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' });
      return;
    }
    if (user.role !== 'admin') {
      sendJson(res, 403, { error: 'Acesso negado' });
      return;
    }

    const list = transactionsStore
      .slice()
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      .slice(0, 100)
      .map((t) => {
        const p = profiles.get(t.user_id);
        return {
          id: t.id,
          user_id: t.user_id,
          type: t.type,
          amount: t.amount,
          status: t.status,
          payment_method: t.payment_method || '',
          created_at: t.created_at,
          user: p
            ? {
                email: p.email,
                full_name: p.full_name ?? null,
              }
            : undefined,
        };
      });

    sendJson(res, 200, { transactions: list });
    return;
  }

  if (req.url?.startsWith('/admin/transactions/') && req.method === 'PUT') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' });
      return;
    }
    if (user.role !== 'admin') {
      sendJson(res, 403, { error: 'Acesso negado' });
      return;
    }

    const id = req.url.split('/')[3];
    const idx = transactionsStore.findIndex((t) => t.id === id);
    if (idx === -1) {
      sendJson(res, 404, { error: 'Transação não encontrada' });
      return;
    }

    const body = await parseBody(req);
    const now = new Date().toISOString();
    const existing = transactionsStore[idx];
    const newStatus = (body.status as (typeof existing.status)) ?? existing.status;

    if (existing.type === 'deposit' && existing.status !== 'completed' && newStatus === 'completed') {
      const entry = walletBalances.get(existing.user_id) || { balance: 0 };
      entry.balance += existing.amount;
      walletBalances.set(existing.user_id, entry);
      const profile = profiles.get(existing.user_id);
      if (profile) {
        profile.balance = entry.balance;
        profile.updated_at = now;
        profiles.set(existing.user_id, profile);
      }
    }

    const updated = {
      ...existing,
      status: newStatus,
      updated_at: now,
    };
    transactionsStore[idx] = updated;

    sendJson(res, 200, { transaction: updated });
    return;
  }

  if (req.url === '/admin/bets' && req.method === 'GET') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' });
      return;
    }
    if (user.role !== 'admin') {
      sendJson(res, 403, { error: 'Acesso negado' });
      return;
    }

    const list = betsStore
      .slice()
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      .slice(0, 100)
      .map((b) => {
        const p = profiles.get(b.user_id);
        return {
          ...b,
          user: p
            ? {
                email: p.email,
                full_name: p.full_name ?? null,
              }
            : undefined,
        };
      });

    sendJson(res, 200, { bets: list });
    return;
  }

  if (req.url?.startsWith('/admin/bets/') && req.method === 'PUT') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' });
      return;
    }
    if (user.role !== 'admin') {
      sendJson(res, 403, { error: 'Acesso negado' });
      return;
    }

    const id = req.url.split('/')[3];
    const idx = betsStore.findIndex((b) => b.id === id);
    if (idx === -1) {
      sendJson(res, 404, { error: 'Aposta não encontrada' });
      return;
    }

    const body = await parseBody(req);
    const existing = betsStore[idx];
    const newStatus = (body.status as typeof existing.status) || existing.status;

    const updated = {
      ...existing,
      status: newStatus,
      winnings: newStatus === 'won' ? existing.potential_win : newStatus === 'lost' ? 0 : existing.winnings ?? null,
    };

    betsStore[idx] = updated;

    sendJson(res, 200, { bet: updated });
    return;
  }

  if (req.url === '/admin/matches' && req.method === 'GET') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' });
      return;
    }
    if (user.role !== 'admin') {
      sendJson(res, 403, { error: 'Acesso negado' });
      return;
    }

    const list = matchesStore.slice().sort((a, b) => (a.start_time > b.start_time ? 1 : -1));
    sendJson(res, 200, { matches: list });
    return;
  }

  if (req.url === '/admin/matches' && req.method === 'POST') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' });
      return;
    }
    if (user.role !== 'admin') {
      sendJson(res, 403, { error: 'Acesso negado' });
      return;
    }

    const body = await parseBody(req);
    const now = new Date().toISOString();
    const id = randomBytes(16).toString('hex');
    const match = {
      id,
      sport: String(body.sport || 'football'),
      league: String(body.league || ''),
      home_team: String(body.home_team || ''),
      away_team: String(body.away_team || ''),
      start_time: body.start_time ? String(body.start_time) : now,
      status: (body.status as 'scheduled' | 'live' | 'finished' | 'cancelled') || 'scheduled',
      home_score:
        typeof body.home_score === 'number' ? body.home_score : body.home_score ? Number(body.home_score) : null,
      away_score:
        typeof body.away_score === 'number' ? body.away_score : body.away_score ? Number(body.away_score) : null,
      created_at: now,
    };
    matchesStore.push(match);
    sendJson(res, 200, { match });
    return;
  }

  if (req.url?.startsWith('/admin/matches/') && req.method === 'PUT') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' });
      return;
    }
    if (user.role !== 'admin') {
      sendJson(res, 403, { error: 'Acesso negado' });
      return;
    }

    const id = req.url.split('/')[3];
    const idx = matchesStore.findIndex((m) => m.id === id);
    if (idx === -1) {
      sendJson(res, 404, { error: 'Jogo não encontrado' });
      return;
    }

    const body = await parseBody(req);
    const existing = matchesStore[idx];
    const updated = {
      ...existing,
      sport: body.sport ?? existing.sport,
      league: body.league ?? existing.league,
      home_team: body.home_team ?? existing.home_team,
      away_team: body.away_team ?? existing.away_team,
      start_time: body.start_time ? String(body.start_time) : existing.start_time,
      status: (body.status as typeof existing.status) ?? existing.status,
      home_score:
        typeof body.home_score === 'number' ? body.home_score : body.home_score ? Number(body.home_score) : existing.home_score,
      away_score:
        typeof body.away_score === 'number' ? body.away_score : body.away_score ? Number(body.away_score) : existing.away_score,
    };
    matchesStore[idx] = updated;
    sendJson(res, 200, { match: updated });
    return;
  }

  if (req.url?.startsWith('/admin/matches/') && req.method === 'DELETE') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' });
      return;
    }
    if (user.role !== 'admin') {
      sendJson(res, 403, { error: 'Acesso negado' });
      return;
    }

    const id = req.url.split('/')[3];
    const idx = matchesStore.findIndex((m) => m.id === id);
    if (idx === -1) {
      sendJson(res, 404, { error: 'Jogo não encontrado' });
      return;
    }
    matchesStore.splice(idx, 1);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.url === '/admin/promotions' && req.method === 'GET') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' });
      return;
    }
    if (user.role !== 'admin') {
      sendJson(res, 403, { error: 'Acesso negado' });
      return;
    }

    const list = promotionsStore.slice().sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    sendJson(res, 200, { promotions: list });
    return;
  }

  if (req.url === '/admin/promotions' && req.method === 'POST') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' });
      return;
    }
    if (user.role !== 'admin') {
      sendJson(res, 403, { error: 'Acesso negado' });
      return;
    }

    const body = await parseBody(req);
    const now = new Date().toISOString();
    const id = randomBytes(16).toString('hex');
    const promo = {
      id,
      title: String(body.title || ''),
      description: String(body.description || ''),
      type: String(body.type || 'deposit_bonus'),
      value: Number(body.value || 0),
      min_deposit: Number(body.min_deposit || 0),
      max_bonus: Number(body.max_bonus || 0),
      valid_from: String(body.valid_from || now.slice(0, 10)),
      valid_until: String(body.valid_until || now.slice(0, 10)),
      is_active: Boolean(body.is_active ?? true),
      terms: String(body.terms || ''),
      created_at: now,
    };
    promotionsStore.push(promo);
    sendJson(res, 200, { promotion: promo });
    return;
  }

  if (req.url?.startsWith('/admin/promotions/') && req.method === 'PUT') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' });
      return;
    }
    if (user.role !== 'admin') {
      sendJson(res, 403, { error: 'Acesso negado' });
      return;
    }

    const id = req.url.split('/')[3];
    const idx = promotionsStore.findIndex((p) => p.id === id);
    if (idx === -1) {
      sendJson(res, 404, { error: 'Promoção não encontrada' });
      return;
    }

    const body = await parseBody(req);
    const existing = promotionsStore[idx];
    const updated = {
      ...existing,
      title: body.title ?? existing.title,
      description: body.description ?? existing.description,
      type: body.type ?? existing.type,
      value: typeof body.value === 'number' ? body.value : existing.value,
      min_deposit: typeof body.min_deposit === 'number' ? body.min_deposit : existing.min_deposit,
      max_bonus: typeof body.max_bonus === 'number' ? body.max_bonus : existing.max_bonus,
      valid_from: body.valid_from ?? existing.valid_from,
      valid_until: body.valid_until ?? existing.valid_until,
      is_active: typeof body.is_active === 'boolean' ? body.is_active : existing.is_active,
      terms: body.terms ?? existing.terms,
    };
    promotionsStore[idx] = updated;
    sendJson(res, 200, { promotion: updated });
    return;
  }

  if (req.url?.startsWith('/admin/promotions/') && req.method === 'DELETE') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' });
      return;
    }
    if (user.role !== 'admin') {
      sendJson(res, 403, { error: 'Acesso negado' });
      return;
    }

    const id = req.url.split('/')[3];
    const idx = promotionsStore.findIndex((p) => p.id === id);
    if (idx === -1) {
      sendJson(res, 404, { error: 'Promoção não encontrada' });
      return;
    }
    promotionsStore.splice(idx, 1);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.url === '/admin/payment-settings' && req.method === 'GET') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' });
      return;
    }
    if (user.role !== 'admin') {
      sendJson(res, 403, { error: 'Acesso negado' });
      return;
    }

    const settings = paymentSettingsStore[0];
    sendJson(res, 200, { settings });
    return;
  }

  if (req.url === '/admin/payment-settings' && req.method === 'PUT') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' });
      return;
    }
    if (user.role !== 'admin') {
      sendJson(res, 403, { error: 'Acesso negado' });
      return;
    }

    const body = await parseBody(req);
    const current = paymentSettingsStore[0];
    const updated = {
      ...current,
      paypal_enabled: body.paypal_enabled ?? current.paypal_enabled,
      paypal_mode: body.paypal_mode ?? current.paypal_mode,
      updated_at: new Date().toISOString(),
    };
    paymentSettingsStore[0] = updated;
    sendJson(res, 200, { settings: updated });
    return;
  }

  if (req.url === '/admin/paypal/test' && req.method === 'POST') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' });
      return;
    }
    if (user.role !== 'admin') {
      sendJson(res, 403, { error: 'Acesso negado' });
      return;
    }
    sendJson(res, 200, { success: true });
    return;
  }

  if (req.url === '/auth/resend' && req.method === 'POST') {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.url?.startsWith('/stats/standings') && req.method === 'GET') {
    const u = new URL(req.url!, 'http://localhost');
    const sport = u.searchParams.get('sport') || 'football';
    const league = u.searchParams.get('league');
    const season = u.searchParams.get('season') || String(new Date().getFullYear());
    sendJson(res, 200, { sport, league, season, standings: [] }, req);
    return;
  }

  if (req.url?.startsWith('/stats/proxy') && req.method === 'GET') {
    sendJson(res, 200, {}, req);
    return;
  }
  if (req.url === '/payments/paypal/create-order' && req.method === 'POST') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' });
      return;
    }
    const orderId = randomBytes(12).toString('hex');
    sendJson(res, 200, { ok: true, order_id: orderId });
    return;
  }
  if (req.url === '/payments/paypal/capture-order' && req.method === 'POST') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' });
      return;
    }
    sendJson(res, 200, { ok: true });
    return;
  }
  if (req.url === '/payments/multibanco/generate' && req.method === 'POST') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' }, req);
      return;
    }
    const body = await parseBody(req);
    const rawAmount = Number(body.amount || 0);
    if (!rawAmount || rawAmount <= 0) {
      sendJson(res, 400, { error: 'Valor inválido' }, req);
      return;
    }
    const amountCents = Math.round(rawAmount * 100);

    if (!stripe) {
      sendJson(
        res,
        500,
        {
          error:
            'Multibanco não está configurado na Stripe. Verifica STRIPE_SECRET_KEY e os métodos de pagamento.',
        },
        req,
      );
      return;
    }

    try {
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amountCents,
        currency: 'eur',
        payment_method_types: ['multibanco'],
        payment_method_data: {
          type: 'multibanco',
          billing_details: {
            email: user.email,
            name: user.name || user.email,
          },
        } as any,
        confirmation_method: 'automatic',
        confirm: true,
        description: body.description || 'Depósito Multibanco',
        statement_descriptor: 'BET62',
        metadata: {
          user_id: user.id,
          user_email: user.email,
          type: 'deposit',
          payment_method: 'multibanco',
        },
      });

      const nextAction: any = paymentIntent.next_action || {};
      const details: any = nextAction.multibanco_display_details || {};

      const entity = details.entity || details.entity_number || '';
      const reference = details.reference || details.reference_number || '';
      const expires_at = typeof details.expires_at === 'number' ? details.expires_at : null;
      const hosted_voucher_url = details.hosted_voucher_url || null;

      if (!entity || !reference) {
        sendJson(
          res,
          500,
          {
            error:
              'Não foi possível obter entidade/referência Multibanco da Stripe. Verifica a configuração do método Multibanco na conta Stripe.',
          },
          req,
        );
        return;
      }

      sendJson(
        res,
        200,
        {
          entity,
          reference,
          expires_at,
          hosted_voucher_url,
          payment_intent_id: paymentIntent.id,
        },
        req,
      );
    } catch (err: any) {
      console.error('Stripe Multibanco error:', err?.message || err);
      sendJson(
        res,
        500,
        {
          error:
            err?.message ||
            'Erro ao gerar referência Multibanco. Verifica a configuração da conta Stripe e do método Multibanco.',
        },
        req,
      );
    }
    return;
  }
  if (req.url === '/bets' && req.method === 'GET') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' });
      return;
    }
    const list = betsStore
      .filter((b) => b.user_id === user.id)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    sendJson(res, 200, { bets: list });
    return;
  }
  if (req.url === '/self-exclusion' && req.method === 'GET') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' });
      return;
    }
    const list = selfExclusionStore.filter((r) => r.user_id === user.id).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    sendJson(res, 200, { records: list });
    return;
  }

  if (req.url === '/self-exclusion' && req.method === 'POST') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' });
      return;
    }
    const body = await parseBody(req);
    const now = new Date().toISOString();
    const record = {
      id: randomBytes(16).toString('hex'),
      user_id: user.id,
      type: body.type || 'temporary',
      duration_days: typeof body.duration_days === 'number' ? body.duration_days : undefined,
      start_date: body.start_date || now,
      end_date: body.end_date,
      reason: body.reason,
      status: body.status || 'active',
      created_at: now,
    };
    selfExclusionStore.push(record);
    sendJson(res, 200, { record });
    return;
  }
  if (req.url === '/profile' && req.method === 'GET') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' }, req);
      return;
    }

    let profile = profiles.get(user.id);
    if (!profile) {
      const balanceEntry = walletBalances.get(user.id) || { balance: 0 };
      const createdAt = new Date().toISOString();
      profile = {
        id: user.id,
        user_id: user.id,
        email: user.email,
        full_name: user.name || '',
        name: user.name,
        phone: '',
        balance: balanceEntry.balance,
        free_bet_balance: 0,
        is_admin: user.role === 'admin',
        status: 'active',
        kyc_verified: false,
        created_at: createdAt,
      };
      profiles.set(user.id, profile);
    }

    sendJson(res, 200, { profile }, req);
    return;
  }

  if (req.url === '/profile' && req.method === 'PUT') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' }, req);
      return;
    }

    const body = await parseBody(req);
    const existing = profiles.get(user.id);

    const now = new Date().toISOString();
    const profile = {
      id: existing?.id || user.id,
      user_id: existing?.user_id || user.id,
      email: existing?.email || user.email,
      full_name: body.full_name ?? existing?.full_name ?? user.name ?? '',
      name: body.name ?? existing?.name ?? user.name,
      phone: body.phone ?? existing?.phone ?? '',
      balance: typeof body.balance === 'number' ? body.balance : existing?.balance ?? 0,
      free_bet_balance:
        typeof body.free_bet_balance === 'number'
          ? body.free_bet_balance
          : existing?.free_bet_balance ?? 0,
      is_admin: existing?.is_admin ?? user.role === 'admin',
      status: body.status ?? existing?.status ?? 'active',
      kyc_verified: body.kyc_verified ?? existing?.kyc_verified ?? false,
      birth_date: body.birth_date ?? existing?.birth_date,
      created_at: existing?.created_at || now,
      updated_at: now,
      self_exclusion_until: body.self_exclusion_until ?? existing?.self_exclusion_until,
      cooling_off_until: body.cooling_off_until ?? existing?.cooling_off_until,
      limits: body.limits ?? existing?.limits,
      saved_iban: body.saved_iban ?? existing?.saved_iban,
      saved_account_holder: body.saved_account_holder ?? existing?.saved_account_holder,
      self_exclusion_reason: body.self_exclusion_reason ?? existing?.self_exclusion_reason,
    };

    profiles.set(user.id, profile);

    const balanceEntry = walletBalances.get(user.id) || { balance: 0 };
    balanceEntry.balance = profile.balance;
    walletBalances.set(user.id, balanceEntry);

    sendJson(res, 200, { profile }, req);
    return;
  }

  if (req.url === '/profile/balance' && req.method === 'POST') {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Não autenticado' }, req);
      return;
    }

    const body = await parseBody(req);
    const amount = Number(body.amount || 0);
    const operation = body.operation === 'subtract' ? 'subtract' : 'add';

    if (!amount || amount <= 0) {
      sendJson(res, 400, { error: 'Valor inválido' }, req);
      return;
    }

    const balanceEntry = walletBalances.get(user.id) || { balance: 0 };

    let newBalance =
      operation === 'add'
        ? balanceEntry.balance + Math.abs(amount)
        : balanceEntry.balance - Math.abs(amount);

    if (newBalance < 0) {
      newBalance = 0;
    }

    balanceEntry.balance = newBalance;
    walletBalances.set(user.id, balanceEntry);

    const existing = profiles.get(user.id);
    const now = new Date().toISOString();
    const profile = {
      id: existing?.id || user.id,
      user_id: existing?.user_id || user.id,
      email: existing?.email || user.email,
      full_name: existing?.full_name || user.name || '',
      name: existing?.name || user.name,
      phone: existing?.phone || '',
      balance: newBalance,
      free_bet_balance: existing?.free_bet_balance ?? 0,
      is_admin: existing?.is_admin ?? user.role === 'admin',
      status: existing?.status ?? 'active',
      kyc_verified: existing?.kyc_verified ?? false,
      birth_date: existing?.birth_date,
      created_at: existing?.created_at || now,
      updated_at: now,
      self_exclusion_until: existing?.self_exclusion_until,
      cooling_off_until: existing?.cooling_off_until,
      limits: existing?.limits,
      saved_iban: existing?.saved_iban,
      saved_account_holder: existing?.saved_account_holder,
      self_exclusion_reason: existing?.self_exclusion_reason,
    };

    profiles.set(user.id, profile);

    sendJson(res, 200, { profile });
    return;
  }

  if (req.url?.startsWith('/odds/events') && req.method === 'GET') {
    sendJson(res, 200, [], req);
    return;
  }

  const liveOddsMatch = req.url?.match(/^\/([a-zA-Z0-9]+)\/odds\/live$/);
  if (liveOddsMatch && req.method === 'GET') {
    sendJson(res, 200, [], req);
    return;
  }

  if (req.method === 'GET') {
    try {
      const distDir = path.resolve(process.cwd(), 'dist');
      const url = new URL(req.url, `http://localhost:${PORT}`);
      const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
      const safePath = pathname.replace(/^\/+/, '');
      const filePath = path.join(distDir, safePath);

      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath).toLowerCase();
        const contentType =
          ext === '.html'
            ? 'text/html; charset=utf-8'
            : ext === '.js'
            ? 'application/javascript; charset=utf-8'
            : ext === '.css'
            ? 'text/css; charset=utf-8'
            : ext === '.json'
            ? 'application/json; charset=utf-8'
            : ext === '.svg'
            ? 'image/svg+xml'
            : ext === '.png'
            ? 'image/png'
            : ext === '.jpg' || ext === '.jpeg'
            ? 'image/jpeg'
            : ext === '.gif'
            ? 'image/gif'
            : 'application/octet-stream';

        res.writeHead(200, { 'Content-Type': contentType });
        fs.createReadStream(filePath).pipe(res);
        return;
      }

      const indexPath = path.join(distDir, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        fs.createReadStream(indexPath).pipe(res);
        return;
      }
    } catch { void 0; }
  }

  sendJson(res, 404, { error: 'Not found' });
});

function loadData(): void {}

// Load persisted data on startup
loadData();

server.listen(PORT, async () => {
  try {
    await seedAdmin();
  } catch (err) {
    console.error('seedAdmin error', err);
  }
  console.log(`API server running on port ${PORT}`);
});
