import postgres from 'postgres';

let sql;
let _schemaReady;

function getSql() {
  if (sql) return sql;
  const url = String(process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL || process.env.DATABASE_URL || process.env.POSTGRES_PRISMA_URL || '').trim();
  if (!url) throw new Error('missing_postgres_url');
  sql = postgres(url, {
    ssl: 'require',
    max: 1,
    idle_timeout: 20,
    connect_timeout: 30,
  });
  return sql;
}

function sqliteToPg(text) {
  let out = '';
  let i = 0;
  let idx = 1;
  let inSingle = false;
  let inDouble = false;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      out += ch;
      i++;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      out += ch;
      i++;
      continue;
    }
    if (!inSingle && !inDouble && ch === '?') {
      out += `$${idx++}`;
      i++;
      continue;
    }
    out += ch;
    i++;
  }
  return out
    .replaceAll('datetime(\'now\')', 'NOW()')
    .replaceAll('datetime("now")', 'NOW()')
    .replaceAll("datetime('now', '-3 hours')", "(NOW() - interval '3 hours')")
    .replaceAll("datetime('now', '-5 hours')", "(NOW() - interval '5 hours')")
    .replaceAll("datetime('now', '-6 hours')", "(NOW() - interval '6 hours')")
    .replaceAll("datetime('now', '+14 days')", "(NOW() + interval '14 days')")
    .replaceAll("datetime('now', '+7 days')", "(NOW() + interval '7 days')")
    .replaceAll('datetime(event_date)', 'event_date')
    .replaceAll('datetime( event_date )', 'event_date')
    .replaceAll('AUTOINCREMENT', '')
    .replaceAll('INSERT OR REPLACE', 'INSERT')
    .replaceAll('INSERT OR IGNORE', 'INSERT');
}

async function ensureSchema() {
  if (_schemaReady) return _schemaReady;
  _schemaReady = (async () => {
    const s = getSql();
    await s.unsafe(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        twofa_enabled INTEGER DEFAULT 0,
        twofa_secret TEXT,
        role TEXT DEFAULT 'user',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS user_credentials (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        hashed_password TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS user_profile (
        id BIGSERIAL PRIMARY KEY,
        user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        email TEXT,
        first_name TEXT,
        last_name TEXT,
        full_name TEXT,
        phone TEXT,
        birth_date TEXT,
        country TEXT DEFAULT 'PT',
        kyc_status TEXT DEFAULT 'unverified',
        is_operator INTEGER DEFAULT 0,
        self_exclude INTEGER DEFAULT 0,
        self_exclude_until TIMESTAMPTZ,
        sharp_score DOUBLE PRECISION DEFAULT 0,
        roi DOUBLE PRECISION DEFAULT 0,
        bets_count INTEGER DEFAULT 0,
        wins_count INTEGER DEFAULT 0,
        terms_accepted_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token TEXT NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        revoked INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS wallets (
        id BIGSERIAL PRIMARY KEY,
        user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        currency TEXT DEFAULT 'EUR',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS ledger_transactions (
        id TEXT PRIMARY KEY,
        wallet_id BIGINT NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        amount DOUBLE PRECISION NOT NULL,
        reference TEXT,
        description TEXT,
        status TEXT DEFAULT 'confirmed',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_ledger_wallet ON ledger_transactions(wallet_id);
      CREATE INDEX IF NOT EXISTS idx_ledger_ref ON ledger_transactions(reference);

      CREATE TABLE IF NOT EXISTS bets (
        id BIGSERIAL PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type TEXT DEFAULT 'single',
        selection TEXT NOT NULL,
        odd DOUBLE PRECISION NOT NULL,
        stake DOUBLE PRECISION NOT NULL,
        potential_win DOUBLE PRECISION NOT NULL,
        status TEXT DEFAULT 'pending',
        result TEXT,
        event_id TEXT,
        ip_address TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_bets_user ON bets(user_id);
      CREATE INDEX IF NOT EXISTS idx_bets_status ON bets(status);
      CREATE INDEX IF NOT EXISTS idx_bets_event ON bets(event_id);

      CREATE TABLE IF NOT EXISTS bet_selections (
        id BIGSERIAL PRIMARY KEY,
        bet_id BIGINT NOT NULL REFERENCES bets(id) ON DELETE CASCADE,
        event_id TEXT,
        market_key TEXT,
        selection TEXT NOT NULL,
        odd DOUBLE PRECISION NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_bet_sel_bet ON bet_selections(bet_id);

      CREATE TABLE IF NOT EXISTS events (
        id BIGSERIAL PRIMARY KEY,
        external_event_id TEXT UNIQUE,
        sport TEXT DEFAULT 'soccer',
        league TEXT,
        country TEXT,
        home_team TEXT NOT NULL,
        away_team TEXT NOT NULL,
        team_match TEXT,
        home_team_logo TEXT,
        away_team_logo TEXT,
        event_date TIMESTAMPTZ,
        status TEXT DEFAULT 'NS',
        is_live INTEGER DEFAULT 0,
        elapsed INTEGER DEFAULT 0,
        score TEXT DEFAULT '{"home":null,"away":null}',
        home_odd DOUBLE PRECISION DEFAULT 0,
        draw_odd DOUBLE PRECISION DEFAULT 0,
        away_odd DOUBLE PRECISION DEFAULT 0,
        markets TEXT DEFAULT '{}',
        market_status TEXT DEFAULT 'active',
        red_cards_home INTEGER DEFAULT 0,
        red_cards_away INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_events_live ON events(is_live);
      CREATE INDEX IF NOT EXISTS idx_events_sport ON events(sport);
      CREATE INDEX IF NOT EXISTS idx_events_date ON events(event_date);
      CREATE INDEX IF NOT EXISTS idx_events_ext ON events(external_event_id);

      CREATE TABLE IF NOT EXISTS kyc_profiles (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        status TEXT DEFAULT 'unverified',
        risk_level TEXT DEFAULT 'low',
        locked_iban TEXT,
        verified_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS kyc_documents (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kyc_profile_id TEXT REFERENCES kyc_profiles(id) ON DELETE SET NULL,
        type TEXT NOT NULL,
        filename TEXT,
        mime_type TEXT,
        content BYTEA,
        status TEXT DEFAULT 'uploaded',
        notes TEXT,
        ip_address TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS withdrawals (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        wallet_id BIGINT REFERENCES wallets(id) ON DELETE SET NULL,
        amount DOUBLE PRECISION NOT NULL,
        method TEXT NOT NULL,
        destination TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_withdrawals_user ON withdrawals(user_id);
      CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals(status);

      CREATE TABLE IF NOT EXISTS deposits (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        amount DOUBLE PRECISION NOT NULL,
        method TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        provider_ref TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS transactions (
        id BIGSERIAL PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        amount DOUBLE PRECISION NOT NULL,
        status TEXT DEFAULT 'pending',
        payment_method TEXT,
        description TEXT,
        account_details TEXT,
        reference TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);

      CREATE TABLE IF NOT EXISTS user_favorites (
        id BIGSERIAL PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        event_id TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, event_id)
      );

      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        message TEXT NOT NULL,
        read_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        actor_id TEXT,
        actor_type TEXT DEFAULT 'user',
        action TEXT NOT NULL,
        entity TEXT NOT NULL,
        entity_id TEXT,
        before_state TEXT,
        after_state TEXT,
        ip_address TEXT,
        user_agent TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS payment_events (
        id BIGSERIAL PRIMARY KEY,
        provider TEXT NOT NULL,
        reference TEXT NOT NULL UNIQUE,
        amount DOUBLE PRECISION,
        status TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS api_usage (
        id BIGSERIAL PRIMARY KEY,
        date TEXT NOT NULL,
        provider TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        count INTEGER DEFAULT 1,
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(date, provider, endpoint)
      );

      CREATE TABLE IF NOT EXISTS promotions (
        id TEXT PRIMARY KEY,
        user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        code TEXT UNIQUE,
        type TEXT DEFAULT 'freebet',
        amount DOUBLE PRECISION,
        used INTEGER DEFAULT 0,
        expires_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS user_iban (
        id BIGSERIAL PRIMARY KEY,
        user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        iban TEXT NOT NULL,
        holder_name TEXT,
        verified INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await s.unsafe(`
      ALTER TABLE events ADD COLUMN IF NOT EXISTS market_status TEXT DEFAULT 'active';
    `);
  })();
  return _schemaReady;
}

export function getDb() {
  const s = getSql();
  return {
    prepare: (text) => {
      const q = sqliteToPg(text);
      return {
        all: async (...args) => {
          await ensureSchema();
          return await s.unsafe(q, args);
        },
        get: async (...args) => {
          await ensureSchema();
          const rows = await s.unsafe(q, args);
          return rows?.[0] || undefined;
        },
        run: async (...args) => {
          await ensureSchema();
          const rows = await s.unsafe(q, args);
          const changes = Number(rows?.count || 0);
          return { changes };
        },
      };
    },
    exec: async (text) => {
      await ensureSchema();
      await s.unsafe(text);
    },
  };
}
