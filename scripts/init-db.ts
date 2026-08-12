/**
 * Database initialization script for BET62APOSTA.
 * Run with: npm run db:init
 *
 * Creates all PostgreSQL tables and indexes required by the application.
 * Safe to run multiple times — all statements use IF NOT EXISTS.
 */

import pg from 'pg';

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('❌ DATABASE_URL environment variable is not set.');
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  ssl:
    process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: false }
      : false,
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

async function run(client: pg.PoolClient, label: string, sql: string): Promise<void> {
  try {
    await client.query(sql);
    console.log(`  ✅ ${label}`);
  } catch (err: any) {
    console.error(`  ❌ ${label}: ${err.message}`);
    throw err;
  }
}

async function initDb(): Promise<void> {
  console.log('🚀 Connecting to PostgreSQL…');
  const client = await pool.connect();
  console.log('✅ Connected.\n');

  try {
    await client.query('BEGIN');

    // ── users ──────────────────────────────────────────────────────────────
    console.log('📋 Creating tables…');
    await run(
      client,
      'users',
      `CREATE TABLE IF NOT EXISTS users (
        id            TEXT        PRIMARY KEY,
        email         TEXT        NOT NULL UNIQUE,
        password_hash TEXT        NOT NULL,
        password_salt TEXT        NOT NULL,
        role          TEXT        NOT NULL DEFAULT 'user',
        name          TEXT,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
    );
    await run(
      client,
      'users.id->text',
      `DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'users'
            AND column_name = 'id'
            AND data_type <> 'text'
        ) THEN
          ALTER TABLE users
            ALTER COLUMN id TYPE TEXT
            USING id::text;
        END IF;
      END $$`,
    );

    // ── profiles ───────────────────────────────────────────────────────────
    await run(
      client,
      'profiles',
      `CREATE TABLE IF NOT EXISTS profiles (
        id                    TEXT        PRIMARY KEY,
        user_id               TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        email                 TEXT        NOT NULL,
        full_name             TEXT,
        phone                 TEXT,
        balance               NUMERIC(18,2) NOT NULL DEFAULT 0,
        free_bet_balance      NUMERIC(18,2) NOT NULL DEFAULT 0,
        kyc_verified          BOOLEAN     NOT NULL DEFAULT FALSE,
        email_verified        BOOLEAN     NOT NULL DEFAULT FALSE,
        birth_date            TEXT,
        self_exclude          BOOLEAN     NOT NULL DEFAULT FALSE,
        self_exclude_until    TIMESTAMPTZ,
        is_operator           BOOLEAN     NOT NULL DEFAULT FALSE,
        verified_iban         TEXT,
        iban_holder_name      TEXT,
        created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
    );
    await run(
      client,
      'profiles.id->text',
      `DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'profiles'
            AND column_name = 'id'
            AND data_type <> 'text'
        ) THEN
          ALTER TABLE profiles
            ALTER COLUMN id TYPE TEXT
            USING id::text;
        END IF;
      END $$`,
    );
    await run(client, 'profiles.verified_iban', `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS verified_iban TEXT`);
    await run(client, 'profiles.iban_holder_name', `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS iban_holder_name TEXT`);
    await run(
      client,
      'profiles.user_id->text',
      `DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'profiles'
            AND column_name = 'user_id'
            AND data_type <> 'text'
        ) THEN
          ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_user_id_fkey;
          ALTER TABLE profiles
            ALTER COLUMN user_id TYPE TEXT
            USING user_id::text;
        END IF;
      END $$`,
    );
    await run(
      client,
      'profiles fk users(id)',
      `DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'profiles'
            AND column_name = 'user_id'
        ) AND EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'users'
            AND column_name = 'id'
        ) THEN
          ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_user_id_fkey;
          IF EXISTS (
            SELECT 1
            FROM profiles p
            LEFT JOIN users u ON u.id = p.user_id
            WHERE p.user_id IS NOT NULL
              AND u.id IS NULL
            LIMIT 1
          ) THEN
            RAISE EXCEPTION 'profiles.user_id contains values without matching users.id';
          END IF;
          ALTER TABLE profiles
            ADD CONSTRAINT profiles_user_id_fkey
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
        END IF;
      END $$`,
    );

    // ── sessions ───────────────────────────────────────────────────────────
    await run(
      client,
      'sessions',
      `CREATE TABLE IF NOT EXISTS sessions (
        token      TEXT        PRIMARY KEY,
        user_id    TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        issued_at  BIGINT      NOT NULL,
        expires_at BIGINT      NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
    );

    await run(
      client,
      'user_two_factor',
      `CREATE TABLE IF NOT EXISTS user_two_factor (
        user_id    TEXT        PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        secret     TEXT        NOT NULL,
        enabled    BOOLEAN     NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
    );

    await run(
      client,
      'favorites',
      `CREATE TABLE IF NOT EXISTS favorites (
        user_id    TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        event_id   TEXT        NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (user_id, event_id)
      )`,
    );

    await run(
      client,
      'odds_overrides',
      `CREATE TABLE IF NOT EXISTS odds_overrides (
        event_id   TEXT        PRIMARY KEY,
        home_odd   NUMERIC,
        draw_odd   NUMERIC,
        away_odd   NUMERIC,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
    );

    // ── leagues ────────────────────────────────────────────────────────────
    await run(
      client,
      'leagues',
      `CREATE TABLE IF NOT EXISTS leagues (
        id         TEXT        PRIMARY KEY,
        id_api     TEXT        NOT NULL,
        name       TEXT        NOT NULL,
        logo       TEXT,
        country    TEXT,
        sport      TEXT        NOT NULL,
        source     TEXT        NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
    );

    // ── teams ──────────────────────────────────────────────────────────────
    await run(
      client,
      'teams',
      `CREATE TABLE IF NOT EXISTS teams (
        id         TEXT        PRIMARY KEY,
        id_api     TEXT        NOT NULL,
        name       TEXT        NOT NULL,
        logo       TEXT,
        league_id  TEXT        REFERENCES leagues(id) ON DELETE SET NULL,
        sport      TEXT        NOT NULL,
        source     TEXT        NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
    );

    // ── fixtures ───────────────────────────────────────────────────────────
    await run(
      client,
      'fixtures',
      `CREATE TABLE IF NOT EXISTS fixtures (
        id                    TEXT        PRIMARY KEY,
        id_api                TEXT        NOT NULL,
        league_id             TEXT        REFERENCES leagues(id) ON DELETE SET NULL,
        home_team_id          TEXT        REFERENCES teams(id) ON DELETE SET NULL,
        away_team_id          TEXT        REFERENCES teams(id) ON DELETE SET NULL,
        kickoff               TIMESTAMPTZ,
        status                TEXT,
        minute                INTEGER,
        home_score            INTEGER,
        away_score            INTEGER,
        sport                 TEXT        NOT NULL,
        source                TEXT        NOT NULL,
        last_odds_snapshot_id TEXT,
        created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
    );

    // ── odds_snapshots ─────────────────────────────────────────────────────
    await run(
      client,
      'odds_snapshots',
      `CREATE TABLE IF NOT EXISTS odds_snapshots (
        id          TEXT        PRIMARY KEY,
        fixture_id  TEXT        NOT NULL REFERENCES fixtures(id) ON DELETE CASCADE,
        bookmaker   TEXT        NOT NULL,
        market      TEXT        NOT NULL,
        market_type TEXT        NOT NULL,
        line        TEXT,
        value       NUMERIC,
        odds        NUMERIC     NOT NULL,
        source      TEXT        NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
    );

    // ── events ─────────────────────────────────────────────────────────────
    await run(
      client,
      'events',
      `CREATE TABLE IF NOT EXISTS events (
        id         TEXT        PRIMARY KEY,
        fixture_id TEXT        NOT NULL REFERENCES fixtures(id) ON DELETE CASCADE,
        type       TEXT        NOT NULL,
        player     TEXT,
        minute     INTEGER,
        payload    JSONB,
        source     TEXT        NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
    );

    // ── statistics ─────────────────────────────────────────────────────────
    await run(
      client,
      'statistics',
      `CREATE TABLE IF NOT EXISTS statistics (
        id         TEXT        PRIMARY KEY,
        fixture_id TEXT        NOT NULL REFERENCES fixtures(id) ON DELETE CASCADE,
        payload    JSONB,
        source     TEXT        NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
    );

    // ── provider_team_mappings ─────────────────────────────────────────────
    await run(
      client,
      'provider_team_mappings',
      `CREATE TABLE IF NOT EXISTS provider_team_mappings (
        id                       TEXT        PRIMARY KEY,
        provider                 TEXT        NOT NULL,
        provider_team_id         TEXT        NOT NULL,
        canonical_team_id        TEXT        REFERENCES teams(id) ON DELETE CASCADE,
        api_football_team_id     TEXT,
        provider_team_name       TEXT        NOT NULL,
        canonical_team_name      TEXT,
        normalized_provider_name TEXT        NOT NULL,
        normalized_canonical_name TEXT,
        country                  TEXT,
        league_id                TEXT        REFERENCES leagues(id) ON DELETE SET NULL,
        confidence_score         NUMERIC(5,4) NOT NULL DEFAULT 0,
        match_method             TEXT        NOT NULL DEFAULT 'manual',
        manual_override          BOOLEAN     NOT NULL DEFAULT FALSE,
        last_verified_at         TIMESTAMPTZ,
        created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(provider, provider_team_id)
      )`,
    );

    // ── provider_fixture_mappings ──────────────────────────────────────────
    await run(
      client,
      'provider_fixture_mappings',
      `CREATE TABLE IF NOT EXISTS provider_fixture_mappings (
        id                    TEXT        PRIMARY KEY,
        provider              TEXT        NOT NULL,
        provider_fixture_id   TEXT        NOT NULL,
        canonical_fixture_id  TEXT        REFERENCES fixtures(id) ON DELETE CASCADE,
        api_football_fixture_id TEXT,
        provider_home_team_id TEXT,
        provider_away_team_id TEXT,
        provider_league_id    TEXT,
        provider_league_name  TEXT,
        provider_country      TEXT,
        provider_kickoff      TIMESTAMPTZ,
        normalized_home_team  TEXT        NOT NULL,
        normalized_away_team  TEXT        NOT NULL,
        confidence_score      NUMERIC(5,4) NOT NULL DEFAULT 0,
        match_method          TEXT        NOT NULL DEFAULT 'fixture-context',
        manual_override       BOOLEAN     NOT NULL DEFAULT FALSE,
        status                TEXT        NOT NULL DEFAULT 'pending',
        review_reason         TEXT,
        payload               JSONB,
        last_verified_at      TIMESTAMPTZ,
        created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(provider, provider_fixture_id)
      )`,
    );

    // ── provider_live_stats ────────────────────────────────────────────────
    await run(
      client,
      'provider_live_stats',
      `CREATE TABLE IF NOT EXISTS provider_live_stats (
        id                  TEXT        PRIMARY KEY,
        provider            TEXT        NOT NULL,
        provider_fixture_id TEXT        NOT NULL,
        canonical_fixture_id TEXT       REFERENCES fixtures(id) ON DELETE CASCADE,
        stats_payload       JSONB,
        momentum_payload    JSONB,
        incidents_payload   JSONB,
        raw_payload         JSONB,
        captured_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
    );

    await run(
      client,
      'idx_provider_team_mappings_provider_team_id',
      `CREATE INDEX IF NOT EXISTS idx_provider_team_mappings_provider_team_id
       ON provider_team_mappings(provider, provider_team_id)`,
    );
    await run(
      client,
      'idx_provider_team_mappings_canonical_team_id',
      `CREATE INDEX IF NOT EXISTS idx_provider_team_mappings_canonical_team_id
       ON provider_team_mappings(canonical_team_id)`,
    );
    await run(
      client,
      'idx_provider_team_mappings_league_id',
      `CREATE INDEX IF NOT EXISTS idx_provider_team_mappings_league_id
       ON provider_team_mappings(league_id)`,
    );
    await run(
      client,
      'idx_provider_fixture_mappings_provider_fixture_id',
      `CREATE INDEX IF NOT EXISTS idx_provider_fixture_mappings_provider_fixture_id
       ON provider_fixture_mappings(provider, provider_fixture_id)`,
    );
    await run(
      client,
      'idx_provider_fixture_mappings_canonical_fixture_id',
      `CREATE INDEX IF NOT EXISTS idx_provider_fixture_mappings_canonical_fixture_id
       ON provider_fixture_mappings(canonical_fixture_id)`,
    );
    await run(
      client,
      'idx_provider_fixture_mappings_kickoff',
      `CREATE INDEX IF NOT EXISTS idx_provider_fixture_mappings_kickoff
       ON provider_fixture_mappings(provider_kickoff)`,
    );
    await run(
      client,
      'idx_provider_live_stats_provider_fixture_id',
      `CREATE INDEX IF NOT EXISTS idx_provider_live_stats_provider_fixture_id
       ON provider_live_stats(provider, provider_fixture_id, captured_at DESC)`,
    );
    await run(
      client,
      'idx_provider_live_stats_canonical_fixture_id',
      `CREATE INDEX IF NOT EXISTS idx_provider_live_stats_canonical_fixture_id
       ON provider_live_stats(canonical_fixture_id, captured_at DESC)`,
    );

    // ── bets ───────────────────────────────────────────────────────────────
    await run(
      client,
      'bets',
      `CREATE TABLE IF NOT EXISTS bets (
        id               TEXT          PRIMARY KEY,
        user_id          TEXT          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        bet_type         TEXT          NOT NULL,
        stake            NUMERIC(18,2) NOT NULL,
        potential_win    NUMERIC(18,2) NOT NULL,
        total_odds       NUMERIC(18,6) NOT NULL,
        status           TEXT          NOT NULL DEFAULT 'pending',
        is_free_bet      BOOLEAN       NOT NULL DEFAULT FALSE,
        winnings         NUMERIC(18,2),
        selections       JSONB,
        total_stake      NUMERIC(18,2),
        potential_return NUMERIC(18,2),
        cashout_value    NUMERIC(18,2),
        cashout_at       TIMESTAMPTZ,
        settled_at       TIMESTAMPTZ,
        created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
      )`,
    );

    // ── transactions ───────────────────────────────────────────────────────
    await run(
      client,
      'transactions',
      `CREATE TABLE IF NOT EXISTS transactions (
        id                TEXT          PRIMARY KEY,
        user_id           TEXT          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type              TEXT          NOT NULL,
        amount            NUMERIC(18,2) NOT NULL,
        status            TEXT          NOT NULL DEFAULT 'pending',
        payment_method    TEXT,
        description       TEXT,
        external_id       TEXT,
        stripe_session_id TEXT,
        completed_at      TIMESTAMPTZ,
        created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
      )`,
    );

    // ── kyc_documents ──────────────────────────────────────────────────────
    await run(
      client,
      'user_documents',
      `CREATE TABLE IF NOT EXISTS user_documents (
        id             TEXT        PRIMARY KEY,
        user_id        TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        doc_type       TEXT        NOT NULL,
        filename       TEXT        NOT NULL,
        mime_type      TEXT        NOT NULL,
        size_bytes     BIGINT      NOT NULL DEFAULT 0,
        content_base64 TEXT,
        status         TEXT        NOT NULL DEFAULT 'SUBMITTED',
        storage_disk   TEXT,
        storage_path   TEXT,
        storage_sha256 TEXT,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
    );

    await run(
      client,
      'kyc_documents',
      `CREATE TABLE IF NOT EXISTS kyc_documents (
        id               TEXT        PRIMARY KEY,
        user_id          TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        document_type    TEXT        NOT NULL,
        file_name        TEXT        NOT NULL,
        file_url         TEXT        NOT NULL,
        status           TEXT        NOT NULL DEFAULT 'pending',
        uploaded_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        rejection_reason TEXT
      )`,
    );

    // ── audit_logs ─────────────────────────────────────────────────────────
    await run(
      client,
      'audit_logs',
      `CREATE TABLE IF NOT EXISTS audit_logs (
        id      TEXT        PRIMARY KEY,
        time    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        ip      TEXT,
        action  TEXT        NOT NULL,
        email   TEXT,
        user_id TEXT,
        success BOOLEAN     NOT NULL DEFAULT TRUE
      )`,
    );

    // ── refresh_tokens ─────────────────────────────────────────────────────
    await run(
      client,
      'refresh_tokens',
      `CREATE TABLE IF NOT EXISTS refresh_tokens (
        id         TEXT        PRIMARY KEY,
        user_id    TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT        NOT NULL UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL,
        revoked    BOOLEAN     NOT NULL DEFAULT FALSE,
        user_agent TEXT,
        ip         TEXT
      )`,
    );

    // ── promotions ─────────────────────────────────────────────────────────
    await run(
      client,
      'promotions',
      `CREATE TABLE IF NOT EXISTS promotions (
        id          TEXT          PRIMARY KEY,
        title       TEXT          NOT NULL,
        description TEXT,
        type        TEXT          NOT NULL,
        value       NUMERIC(18,2) NOT NULL DEFAULT 0,
        min_deposit NUMERIC(18,2) NOT NULL DEFAULT 0,
        max_bonus   NUMERIC(18,2) NOT NULL DEFAULT 0,
        valid_from  TIMESTAMPTZ,
        valid_until TIMESTAMPTZ,
        is_active   BOOLEAN       NOT NULL DEFAULT TRUE,
        terms       TEXT,
        created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
      )`,
    );

    // ── self_exclusions ────────────────────────────────────────────────────
    await run(
      client,
      'self_exclusions',
      `CREATE TABLE IF NOT EXISTS self_exclusions (
        id            TEXT        PRIMARY KEY,
        user_id       TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type          TEXT        NOT NULL,
        duration_days INTEGER,
        start_date    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        end_date      TIMESTAMPTZ,
        reason        TEXT,
        status        TEXT        NOT NULL DEFAULT 'active',
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
    );
    await run(
      client,
      'user_self_exclude_history',
      `CREATE TABLE IF NOT EXISTS user_self_exclude_history (
        id         TEXT        PRIMARY KEY,
        user_id    TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        action     TEXT        NOT NULL,
        until      TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
    );

    // ── matches ────────────────────────────────────────────────────────────
    await run(
      client,
      'matches',
      `CREATE TABLE IF NOT EXISTS matches (
        id          TEXT        PRIMARY KEY,
        sport       TEXT        NOT NULL,
        league      TEXT,
        home_team   TEXT        NOT NULL,
        away_team   TEXT        NOT NULL,
        start_time  TIMESTAMPTZ,
        status      TEXT        NOT NULL DEFAULT 'scheduled',
        home_score  INTEGER,
        away_score  INTEGER,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
    );
    await run(
      client,
      'normalize user FK column types',
      `DO $$
      DECLARE
        ref RECORD;
        fk RECORD;
      BEGIN
        FOR ref IN
          SELECT *
          FROM (VALUES
            ('profiles', 'user_id'),
            ('transactions', 'user_id'),
            ('bets', 'user_id'),
            ('user_two_factor', 'user_id'),
            ('favorites', 'user_id'),
            ('user_presence', 'user_id'),
            ('user_documents', 'user_id'),
            ('kyc_documents', 'user_id'),
            ('refresh_tokens', 'user_id'),
            ('self_exclusions', 'user_id'),
            ('user_self_exclude_history', 'user_id')
          ) AS refs(table_name, column_name)
        LOOP
          IF EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = ref.table_name
              AND column_name = ref.column_name
              AND data_type <> 'text'
          ) THEN
            FOR fk IN
              SELECT c.conname
              FROM pg_constraint c
              JOIN pg_class t ON t.oid = c.conrelid
              JOIN pg_namespace n ON n.oid = t.relnamespace
              JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY (c.conkey)
              WHERE c.contype = 'f'
                AND n.nspname = 'public'
                AND t.relname = ref.table_name
                AND a.attname = ref.column_name
            LOOP
              EXECUTE format(
                'ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I',
                ref.table_name,
                fk.conname
              );
            END LOOP;
            EXECUTE format(
              'ALTER TABLE %I ALTER COLUMN %I TYPE TEXT USING %I::text',
              ref.table_name,
              ref.column_name,
              ref.column_name
            );
          END IF;
        END LOOP;
      END $$`,
    );
    await run(
      client,
      'rebuild user foreign keys',
      `DO $$
      DECLARE
        ref RECORD;
        fk RECORD;
        has_orphans BOOLEAN;
      BEGIN
        FOR ref IN
          SELECT *
          FROM (VALUES
            ('profiles', 'user_id'),
            ('transactions', 'user_id'),
            ('bets', 'user_id'),
            ('user_two_factor', 'user_id'),
            ('favorites', 'user_id'),
            ('user_presence', 'user_id'),
            ('user_documents', 'user_id'),
            ('kyc_documents', 'user_id'),
            ('refresh_tokens', 'user_id'),
            ('self_exclusions', 'user_id'),
            ('user_self_exclude_history', 'user_id')
          ) AS refs(table_name, column_name)
        LOOP
          IF EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = ref.table_name
              AND column_name = ref.column_name
          ) THEN
            FOR fk IN
              SELECT c.conname
              FROM pg_constraint c
              JOIN pg_class t ON t.oid = c.conrelid
              JOIN pg_namespace n ON n.oid = t.relnamespace
              JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY (c.conkey)
              WHERE c.contype = 'f'
                AND n.nspname = 'public'
                AND t.relname = ref.table_name
                AND a.attname = ref.column_name
            LOOP
              EXECUTE format(
                'ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I',
                ref.table_name,
                fk.conname
              );
            END LOOP;
            EXECUTE format(
              'SELECT EXISTS (
                SELECT 1
                FROM %I t
                LEFT JOIN users u ON u.id = t.%I
                WHERE t.%I IS NOT NULL
                  AND u.id IS NULL
                LIMIT 1
              )',
              ref.table_name,
              ref.column_name,
              ref.column_name
            ) INTO has_orphans;
            IF has_orphans THEN
              RAISE EXCEPTION '% %.% contains values without matching users.id',
                'foreign key mismatch:',
                ref.table_name,
                ref.column_name;
            END IF;
            EXECUTE format(
              'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES users(id) ON DELETE CASCADE',
              ref.table_name,
              ref.table_name || '_' || ref.column_name || '_fkey',
              ref.column_name
            );
          END IF;
        END LOOP;
      END $$`,
    );

    // ── indexes ────────────────────────────────────────────────────────────
    console.log('\n📑 Creating indexes…');

    const indexes: [string, string][] = [
      ['idx_profiles_user_id',          'CREATE INDEX IF NOT EXISTS idx_profiles_user_id ON profiles(user_id)'],
      ['idx_sessions_user_id',          'CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)'],
      ['idx_sessions_expires_at',       'CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at)'],
      ['idx_leagues_id_api_source',     'CREATE UNIQUE INDEX IF NOT EXISTS idx_leagues_id_api_source ON leagues(id_api, source)'],
      ['idx_teams_id_api_source',       'CREATE UNIQUE INDEX IF NOT EXISTS idx_teams_id_api_source ON teams(id_api, source)'],
      ['idx_fixtures_id_api_source',    'CREATE UNIQUE INDEX IF NOT EXISTS idx_fixtures_id_api_source ON fixtures(id_api, source)'],
      ['idx_fixtures_league_id',        'CREATE INDEX IF NOT EXISTS idx_fixtures_league_id ON fixtures(league_id)'],
      ['idx_fixtures_status',           'CREATE INDEX IF NOT EXISTS idx_fixtures_status ON fixtures(status)'],
      ['idx_fixtures_kickoff',          'CREATE INDEX IF NOT EXISTS idx_fixtures_kickoff ON fixtures(kickoff)'],
      ['idx_fixtures_sport',            'CREATE INDEX IF NOT EXISTS idx_fixtures_sport ON fixtures(sport)'],
      ['idx_odds_snapshots_fixture_id', 'CREATE INDEX IF NOT EXISTS idx_odds_snapshots_fixture_id ON odds_snapshots(fixture_id)'],
      ['idx_odds_snapshots_created_at', 'CREATE INDEX IF NOT EXISTS idx_odds_snapshots_created_at ON odds_snapshots(created_at DESC)'],
      ['idx_events_fixture_id',         'CREATE INDEX IF NOT EXISTS idx_events_fixture_id ON events(fixture_id)'],
      ['idx_statistics_fixture_id',     'CREATE INDEX IF NOT EXISTS idx_statistics_fixture_id ON statistics(fixture_id)'],
      ['idx_bets_user_id',              'CREATE INDEX IF NOT EXISTS idx_bets_user_id ON bets(user_id)'],
      ['idx_bets_status',               'CREATE INDEX IF NOT EXISTS idx_bets_status ON bets(status)'],
      ['idx_bets_created_at',           'CREATE INDEX IF NOT EXISTS idx_bets_created_at ON bets(created_at DESC)'],
      ['idx_transactions_user_id',      'CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id)'],
      ['idx_transactions_type',         'CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type)'],
      ['idx_transactions_status',       'CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status)'],
      ['idx_transactions_created_at',   'CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at DESC)'],
      ['idx_user_documents_user_id',    'CREATE INDEX IF NOT EXISTS idx_user_documents_user_id ON user_documents(user_id)'],
      ['idx_kyc_documents_user_id',     'CREATE INDEX IF NOT EXISTS idx_kyc_documents_user_id ON kyc_documents(user_id)'],
      ['idx_audit_logs_user_id',        'CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id)'],
      ['idx_audit_logs_email',          'CREATE INDEX IF NOT EXISTS idx_audit_logs_email ON audit_logs(email)'],
      ['idx_audit_logs_time',           'CREATE INDEX IF NOT EXISTS idx_audit_logs_time ON audit_logs(time DESC)'],
      ['idx_refresh_tokens_user_id',    'CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id)'],
      ['idx_refresh_tokens_token_hash', 'CREATE UNIQUE INDEX IF NOT EXISTS idx_refresh_tokens_token_hash ON refresh_tokens(token_hash)'],
      ['idx_self_exclusions_user_id',   'CREATE INDEX IF NOT EXISTS idx_self_exclusions_user_id ON self_exclusions(user_id)'],
      ['idx_matches_sport_status',      'CREATE INDEX IF NOT EXISTS idx_matches_sport_status ON matches(sport, status)'],
      ['idx_matches_start_time',        'CREATE INDEX IF NOT EXISTS idx_matches_start_time ON matches(start_time)'],
    ];

    for (const [label, sql] of indexes) {
      await run(client, label, sql);
    }

    await client.query('COMMIT');
    console.log('\n🎉 Database initialized successfully.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n💥 Initialization failed — transaction rolled back.');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

initDb().catch((err) => {
  console.error(err);
  process.exit(1);
});
