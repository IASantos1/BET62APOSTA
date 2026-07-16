import pg from 'pg';
import { ensureAppAuthTables } from './appAuthTables';
import { ensureAppFinancialTables } from './appTables';

const { Pool } = pg;

export type Db = {
  pool: pg.Pool;
};

function firstEnv(...keys: string[]): string {
  for (const key of keys) {
    const value = String(process.env[key] || '').trim();
    if (value) return value;
  }
  return '';
}

function resolveSsl(connectionString: string): false | { rejectUnauthorized: false } {
  const explicit = firstEnv('PGSSLMODE', 'DB_SSL', 'DATABASE_SSL');
  const normalized = explicit.toLowerCase();
  if (['disable', 'false', '0', 'off', 'no'].includes(normalized)) return false;
  if (['require', 'true', '1', 'on', 'yes', 'verify-ca', 'verify-full'].includes(normalized)) {
    return { rejectUnauthorized: false };
  }

  if (process.env.NODE_ENV === 'production') return { rejectUnauthorized: false };
  if (/sslmode=require/i.test(connectionString)) return { rejectUnauthorized: false };
  if (/railway|rlwy|proxy\.rlwy\.net|render\.com|supabase\.co|neon\.tech/i.test(connectionString)) {
    return { rejectUnauthorized: false };
  }

  return false;
}

export function createPool(): pg.Pool | null {
  const connectionString = firstEnv(
    'DATABASE_URL',
    'DATABASE_PRIVATE_URL',
    'DATABASE_URL_INTERNAL',
    'DATABASE_URL_UNPOOLED',
    'POSTGRES_URL',
    'POSTGRESQL_URL',
    'DATABASE_PUBLIC_URL',
    'POSTGRES_PRIVATE_URL',
  );
  const host = firstEnv('PGHOST', 'POSTGRES_HOST');
  const user = firstEnv('PGUSER', 'POSTGRES_USER');
  const password = firstEnv('PGPASSWORD', 'POSTGRES_PASSWORD');
  const database = firstEnv('PGDATABASE', 'POSTGRES_DB');
  const port = Number(firstEnv('PGPORT', 'POSTGRES_PORT') || 0) || undefined;

  if (!connectionString && !(host && user && database)) return null;

  return new Pool({
    connectionString: connectionString || undefined,
    host: host || undefined,
    port,
    user: user || undefined,
    password: password || undefined,
    database: database || undefined,
    ssl: resolveSsl(connectionString),
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
}

export async function ensureSchema(pool: pg.Pool | null): Promise<void> {
  if (!pool) return;
  const sql = [
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
    `DO $$
    BEGIN
      IF to_regclass('public.profiles') IS NULL AND to_regclass('public.user_profile') IS NOT NULL THEN
        ALTER TABLE user_profile RENAME TO profiles;
      END IF;
    END $$`,
    `CREATE TABLE IF NOT EXISTS profiles (
      id               TEXT          PRIMARY KEY,
      user_id          TEXT          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      email            TEXT          NOT NULL,
      full_name        TEXT,
      phone            TEXT,
      balance          NUMERIC(18,2) NOT NULL DEFAULT 0,
      free_bet_balance NUMERIC(18,2) NOT NULL DEFAULT 0,
      kyc_verified     BOOLEAN       NOT NULL DEFAULT FALSE,
      email_verified   BOOLEAN       NOT NULL DEFAULT FALSE,
      birth_date       TEXT,
      self_exclude     BOOLEAN       NOT NULL DEFAULT FALSE,
      self_exclude_until TIMESTAMPTZ,
      is_operator      BOOLEAN       NOT NULL DEFAULT FALSE,
      created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
    )`,
    `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS id TEXT`,
    `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS user_id TEXT`,
    `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email TEXT`,
    `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS full_name TEXT`,
    `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS phone TEXT`,
    `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS balance NUMERIC(18,2) NOT NULL DEFAULT 0`,
    `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS free_bet_balance NUMERIC(18,2) NOT NULL DEFAULT 0`,
    `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS kyc_verified BOOLEAN NOT NULL DEFAULT FALSE`,
    `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE`,
    `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS birth_date TEXT`,
    `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS self_exclude BOOLEAN NOT NULL DEFAULT FALSE`,
    `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS self_exclude_until TIMESTAMPTZ`,
    `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_operator BOOLEAN NOT NULL DEFAULT FALSE`,
    `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS verified_iban TEXT`,
    `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS iban_holder_name TEXT`,
    `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
    `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
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
    `DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'profiles'
          AND column_name = 'self_exclusion_until'
      ) AND NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'profiles'
          AND column_name = 'self_exclude_until'
      ) THEN
        ALTER TABLE profiles RENAME COLUMN self_exclusion_until TO self_exclude_until;
      END IF;
    END $$`,
    `DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'profiles'
          AND column_name = 'self_exclude'
          AND data_type IN ('smallint', 'integer', 'bigint', 'numeric')
      ) THEN
        ALTER TABLE profiles
          ALTER COLUMN self_exclude TYPE BOOLEAN
          USING CASE WHEN COALESCE(self_exclude::numeric, 0) <> 0 THEN TRUE ELSE FALSE END;
      END IF;
    END $$`,
    `DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'profiles'
          AND column_name = 'is_operator'
          AND data_type IN ('smallint', 'integer', 'bigint', 'numeric')
      ) THEN
        ALTER TABLE profiles
          ALTER COLUMN is_operator TYPE BOOLEAN
          USING CASE WHEN COALESCE(is_operator::numeric, 0) <> 0 THEN TRUE ELSE FALSE END;
      END IF;
    END $$`,
    `DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'profiles'
          AND column_name = 'kyc_status'
      ) THEN
        UPDATE profiles
        SET kyc_verified = CASE
          WHEN UPPER(COALESCE(kyc_status, '')) IN ('VERIFIED', 'APPROVED', 'OK') THEN TRUE
          ELSE FALSE
        END
        WHERE kyc_verified IS DISTINCT FROM CASE
          WHEN UPPER(COALESCE(kyc_status, '')) IN ('VERIFIED', 'APPROVED', 'OK') THEN TRUE
          ELSE FALSE
        END;
      END IF;
    END $$`,
    `DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'profiles'
          AND column_name = 'first_name'
      ) AND EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'profiles'
          AND column_name = 'last_name'
      ) THEN
        EXECUTE $sql$
          UPDATE profiles
          SET full_name = NULLIF(TRIM(CONCAT(COALESCE(first_name, ''), ' ', COALESCE(last_name, ''))), '')
          WHERE COALESCE(full_name, '') = ''
        $sql$;
      ELSIF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'profiles'
          AND column_name = 'first_name'
      ) THEN
        EXECUTE $sql$
          UPDATE profiles
          SET full_name = NULLIF(TRIM(COALESCE(first_name, '')), '')
          WHERE COALESCE(full_name, '') = ''
        $sql$;
      ELSIF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'profiles'
          AND column_name = 'last_name'
      ) THEN
        EXECUTE $sql$
          UPDATE profiles
          SET full_name = NULLIF(TRIM(COALESCE(last_name, '')), '')
          WHERE COALESCE(full_name, '') = ''
        $sql$;
      END IF;
    END $$`,
    `DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'profiles'
          AND column_name = 'self_exclude_until'
          AND data_type IN ('text', 'character varying', 'character')
      ) THEN
        ALTER TABLE profiles
          ALTER COLUMN self_exclude_until TYPE TIMESTAMPTZ
          USING CASE
            WHEN NULLIF(BTRIM(self_exclude_until::text), '') IS NULL THEN NULL
            ELSE self_exclude_until::timestamptz
          END;
      END IF;
    END $$`,
    `UPDATE profiles p
     SET email = COALESCE(NULLIF(p.email, ''), u.email),
         full_name = COALESCE(NULLIF(p.full_name, ''), u.name),
         updated_at = NOW()
     FROM users u
     WHERE u.id = p.user_id
       AND (
         p.email IS NULL OR p.email = '' OR p.full_name IS NULL OR p.full_name = ''
       )`,
    `UPDATE profiles
     SET id = md5(COALESCE(user_id, '') || ':' || clock_timestamp()::text)
     WHERE id IS NULL OR id = ''`,
    `INSERT INTO profiles (id, user_id, email, full_name, created_at, updated_at)
     SELECT md5(u.id || ':' || clock_timestamp()::text), u.id, u.email, u.name, NOW(), NOW()
     FROM users u
     LEFT JOIN profiles p ON p.user_id = u.id
     WHERE p.user_id IS NULL`,
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
    `CREATE TABLE IF NOT EXISTS sessions (
      token      TEXT        PRIMARY KEY,
      user_id    TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      issued_at  BIGINT      NOT NULL,
      expires_at BIGINT      NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
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
    `CREATE TABLE IF NOT EXISTS bets (
      id               TEXT          PRIMARY KEY,
      user_id          TEXT          NOT NULL,
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
    `CREATE TABLE IF NOT EXISTS user_two_factor (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      secret TEXT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS favorites (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      event_id TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, event_id)
    )`,
    `CREATE TABLE IF NOT EXISTS user_presence (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      last_seen BIGINT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS user_documents (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      doc_type TEXT NOT NULL,
      filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes BIGINT NOT NULL DEFAULT 0,
      content_base64 TEXT,
      status TEXT NOT NULL DEFAULT 'SUBMITTED',
      storage_disk TEXT,
      storage_path TEXT,
      storage_sha256 TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'user_documents'
          AND column_name = 'id'
          AND data_type <> 'text'
      ) THEN
        ALTER TABLE user_documents ALTER COLUMN id TYPE TEXT USING id::text;
      END IF;
    END $$`,
    `ALTER TABLE user_documents ADD COLUMN IF NOT EXISTS doc_type TEXT`,
    `ALTER TABLE user_documents ADD COLUMN IF NOT EXISTS size_bytes BIGINT NOT NULL DEFAULT 0`,
    `ALTER TABLE user_documents ALTER COLUMN content_base64 DROP NOT NULL`,
    `ALTER TABLE user_documents ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
    `ALTER TABLE user_documents ADD COLUMN IF NOT EXISTS storage_disk TEXT`,
    `ALTER TABLE user_documents ADD COLUMN IF NOT EXISTS storage_path TEXT`,
    `ALTER TABLE user_documents ADD COLUMN IF NOT EXISTS storage_sha256 TEXT`,
    `DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'user_documents'
          AND column_name = 'type'
      ) THEN
        UPDATE user_documents
        SET doc_type = COALESCE(NULLIF(doc_type, ''), type)
        WHERE COALESCE(doc_type, '') = '';
      END IF;
    END $$`,
    `DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'user_documents'
          AND column_name = 'size'
      ) THEN
        UPDATE user_documents
        SET size_bytes = CASE
          WHEN COALESCE(size_bytes, 0) = 0 THEN COALESCE(size::bigint, 0)
          ELSE size_bytes
        END
        WHERE COALESCE(size_bytes, 0) = 0;
      END IF;
    END $$`,
    `UPDATE user_documents
     SET updated_at = COALESCE(updated_at, created_at, NOW())
     WHERE updated_at IS NULL`,
    `CREATE INDEX IF NOT EXISTS idx_user_documents_user_id ON user_documents(user_id)`,
    `CREATE TABLE IF NOT EXISTS user_self_exclude_history (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      action TEXT NOT NULL,
      until TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
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
    `CREATE INDEX IF NOT EXISTS idx_user_self_exclude_history_user_id ON user_self_exclude_history(user_id)`,
    `CREATE TABLE IF NOT EXISTS odds_overrides (
      event_id TEXT PRIMARY KEY,
      home_odd NUMERIC,
      draw_odd NUMERIC,
      away_odd NUMERIC,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_profiles_user_id ON profiles(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at)`,
    `CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_bets_user_id ON bets(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_bets_created_at ON bets(created_at DESC)`,
  ];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const q of sql) await client.query(q);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  // Keep the runtime tables used by auth, bets and wallet aligned with bootstrap.
  await ensureAppAuthTables(pool);
  await ensureAppFinancialTables(pool);
}

