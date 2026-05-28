import pg from 'pg';

const { Pool } = pg;

export type Db = {
  pool: pg.Pool;
};

export function createPool(): pg.Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set');
  }
  return new Pool({
    connectionString,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
}

export async function ensureSchema(pool: pg.Pool): Promise<void> {
  const sql = [
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
    `CREATE TABLE IF NOT EXISTS odds_overrides (
      event_id TEXT PRIMARY KEY,
      home_odd NUMERIC,
      draw_odd NUMERIC,
      away_odd NUMERIC,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
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
}

