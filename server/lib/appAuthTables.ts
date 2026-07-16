import type pg from 'pg';

export const APP_SESSIONS_TABLE = 'bet62_sessions';
export const APP_REFRESH_TOKENS_TABLE = 'bet62_refresh_tokens';

let __app_auth_ready = false;

export async function ensureAppAuthTables(pool: pg.Pool): Promise<void> {
  if (__app_auth_ready) return;
  await pool.query(
    `CREATE TABLE IF NOT EXISTS ${APP_SESSIONS_TABLE} (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      issued_at BIGINT NOT NULL,
      expires_at BIGINT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
  );
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_${APP_SESSIONS_TABLE}_user_id ON ${APP_SESSIONS_TABLE}(user_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_${APP_SESSIONS_TABLE}_expires_at ON ${APP_SESSIONS_TABLE}(expires_at)`);

  await pool.query(
    `CREATE TABLE IF NOT EXISTS ${APP_REFRESH_TOKENS_TABLE} (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      revoked BOOLEAN NOT NULL DEFAULT FALSE,
      user_agent TEXT,
      ip TEXT
    )`,
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_${APP_REFRESH_TOKENS_TABLE}_user_id ON ${APP_REFRESH_TOKENS_TABLE}(user_id)`,
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_${APP_REFRESH_TOKENS_TABLE}_expires_at ON ${APP_REFRESH_TOKENS_TABLE}(expires_at)`,
  );
  __app_auth_ready = true;
}
