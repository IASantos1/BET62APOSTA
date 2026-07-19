import type pg from 'pg';

export const APP_BETS_TABLE = 'bet62_bets';
export const APP_TRANSACTIONS_TABLE = 'bet62_transactions';

let __app_bets_ready = false;
let __app_transactions_ready = false;
let __app_bets_ready_promise: Promise<void> | null = null;
let __app_transactions_ready_promise: Promise<void> | null = null;

export async function ensureAppBetsTable(pool: pg.Pool): Promise<void> {
  if (__app_bets_ready) return;
  if (__app_bets_ready_promise) return __app_bets_ready_promise;
  __app_bets_ready_promise = (async () => {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS ${APP_BETS_TABLE} (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        bet_type TEXT NOT NULL,
        stake NUMERIC(18,2) NOT NULL,
        potential_win NUMERIC(18,2) NOT NULL,
        total_odds NUMERIC(18,6) NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        is_free_bet BOOLEAN NOT NULL DEFAULT FALSE,
        winnings NUMERIC(18,2),
        selections JSONB,
        total_stake NUMERIC(18,2),
        potential_return NUMERIC(18,2),
        cashout_value NUMERIC(18,2),
        cashout_at TIMESTAMPTZ,
        settled_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
    );
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_${APP_BETS_TABLE}_user_id ON ${APP_BETS_TABLE}(user_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_${APP_BETS_TABLE}_created_at ON ${APP_BETS_TABLE}(created_at DESC)`);
    __app_bets_ready = true;
  })();
  try {
    await __app_bets_ready_promise;
  } finally {
    __app_bets_ready_promise = null;
  }
}

export async function ensureAppTransactionsTable(pool: pg.Pool): Promise<void> {
  if (__app_transactions_ready) return;
  if (__app_transactions_ready_promise) return __app_transactions_ready_promise;
  __app_transactions_ready_promise = (async () => {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS ${APP_TRANSACTIONS_TABLE} (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL,
        amount NUMERIC(18,2) NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        payment_method TEXT,
        description TEXT,
        external_id TEXT,
        stripe_session_id TEXT,
        completed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
    );
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_${APP_TRANSACTIONS_TABLE}_user_id ON ${APP_TRANSACTIONS_TABLE}(user_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_${APP_TRANSACTIONS_TABLE}_created_at ON ${APP_TRANSACTIONS_TABLE}(created_at DESC)`);
    __app_transactions_ready = true;
  })();
  try {
    await __app_transactions_ready_promise;
  } finally {
    __app_transactions_ready_promise = null;
  }
}

export async function ensureAppFinancialTables(pool: pg.Pool): Promise<void> {
  await ensureAppBetsTable(pool);
  await ensureAppTransactionsTable(pool);
}
