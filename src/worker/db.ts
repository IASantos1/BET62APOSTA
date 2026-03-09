
import { D1Database } from '@cloudflare/workers-types';

export const ensureUserSchema = async (db: D1Database) => {
  await db.prepare(`CREATE TABLE IF NOT EXISTS user_key (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, hashed_password TEXT, FOREIGN KEY (user_id) REFERENCES user(id))`).run().catch(() => { /* empty */ });
  await db.prepare(`CREATE TABLE IF NOT EXISTS user_session (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, active_expires INTEGER NOT NULL, idle_expires INTEGER NOT NULL, FOREIGN KEY (user_id) REFERENCES user(id))`).run().catch(() => { /* empty */ });
  await db.prepare(`CREATE TABLE IF NOT EXISTS refresh_tokens (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, revoked INTEGER DEFAULT 0, FOREIGN KEY (user_id) REFERENCES user(id))`).run().catch(() => { /* empty */ });
  await db.prepare(`CREATE TABLE IF NOT EXISTS user (id TEXT PRIMARY KEY, username TEXT UNIQUE)`).run().catch(() => { /* empty */ });
  await db.prepare(`CREATE TABLE IF NOT EXISTS user_profile (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, email TEXT, full_name TEXT, phone TEXT, balance REAL DEFAULT 0, currency TEXT DEFAULT 'EUR', created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, is_operator INTEGER DEFAULT 0, twofa_enabled INTEGER DEFAULT 0, twofa_secret TEXT, sharp_score REAL DEFAULT 0, roi REAL DEFAULT 0, bets INTEGER DEFAULT 0, wins INTEGER DEFAULT 0, FOREIGN KEY (user_id) REFERENCES user(id))`).run().catch(() => { /* empty */ });
  
  // Legacy Events Table (for Event Details)
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        team_match TEXT NOT NULL,
        league TEXT,
        home_team TEXT NOT NULL,
        away_team TEXT NOT NULL,
        home_odd REAL,
        draw_odd REAL,
        away_odd REAL,
        event_date TEXT,
        is_live INTEGER NOT NULL DEFAULT 0,
        score TEXT,
        start_time DATETIME,
        end_time DATETIME,
        external_event_id TEXT,
        external_provider TEXT,
        sport TEXT,
        status TEXT,
        market_status TEXT DEFAULT 'active',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run().catch(() => { /* empty */ });
  try { await db.prepare('CREATE INDEX IF NOT EXISTS idx_events_is_live ON events(is_live)').run(); } catch { /* empty */ }
  try { await db.prepare('CREATE INDEX IF NOT EXISTS idx_events_start_time ON events(start_time)').run(); } catch { /* empty */ }
  try { await db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS uniq_events_league_teams_start ON events(league, home_team, away_team, start_time)').run(); } catch { /* empty */ }
  // Ensure unique index for ON CONFLICT logic in EventSyncService
  try { await db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS uniq_events_home_away_date ON events(home_team, away_team, event_date)').run(); } catch { /* empty */ }
  
  // MIGRATIONS
  try { await db.prepare("ALTER TABLE events ADD COLUMN sport TEXT").run(); } catch { /* empty */ }
  try { await db.prepare("ALTER TABLE events ADD COLUMN market_status TEXT DEFAULT 'active'").run(); } catch { /* empty */ }
  try { await db.prepare("ALTER TABLE events ADD COLUMN status TEXT DEFAULT 'NS'").run(); } catch { /* empty */ }
    try { await db.prepare("ALTER TABLE events ADD COLUMN markets TEXT").run(); } catch { /* empty */ }
    try { await db.prepare("ALTER TABLE events ADD COLUMN score TEXT").run(); } catch { /* empty */ }

  // Bets Table
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS bets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        event_id INTEGER NOT NULL, -- 0 for multiples
        selection TEXT NOT NULL,   -- Description or JSON for multiples
        odd REAL NOT NULL,         -- Total Odds
        stake REAL NOT NULL,
        potential_win REAL NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        result TEXT,
        type TEXT DEFAULT 'single', -- single, multi
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run().catch(() => { /* empty */ });
  try { await db.prepare('CREATE INDEX IF NOT EXISTS idx_bets_user_id ON bets(user_id)').run(); } catch { /* empty */ }
  try { await db.prepare('CREATE INDEX IF NOT EXISTS idx_bets_status ON bets(status)').run(); } catch { /* empty */ }
  
  // Migration for existing bets table
  try { await db.prepare("ALTER TABLE bets ADD COLUMN type TEXT DEFAULT 'single'").run(); } catch { /* empty */ }
  try { await db.prepare("ALTER TABLE bets ADD COLUMN ip_address TEXT").run(); } catch { /* empty */ }
  try { await db.prepare("ALTER TABLE bets ADD COLUMN device_fingerprint TEXT").run(); } catch { /* empty */ }

  // Bet Selections Table (New - For Multiples & Normalization)
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS bet_selections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bet_id INTEGER NOT NULL,
        event_id TEXT NOT NULL,
        market_key TEXT,
        selection TEXT NOT NULL,
        odd REAL NOT NULL,
        status TEXT DEFAULT 'pending', -- pending, won, lost, void
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (bet_id) REFERENCES bets(id)
    )
  `).run().catch(() => { /* empty */ });
  try { await db.prepare('CREATE INDEX IF NOT EXISTS idx_bet_selections_bet_id ON bet_selections(bet_id)').run(); } catch { /* empty */ }
  try { await db.prepare('ALTER TABLE bet_selections ADD COLUMN market_key TEXT').run(); } catch { /* empty */ }

  // Migrations for existing tables
  try { await db.prepare('ALTER TABLE user_profile ADD COLUMN twofa_enabled INTEGER DEFAULT 0').run(); } catch { /* empty */ }
  try { await db.prepare('ALTER TABLE user_profile ADD COLUMN twofa_secret TEXT').run(); } catch { /* empty */ }
  try { await db.prepare('ALTER TABLE user_profile ADD COLUMN country TEXT DEFAULT "PT"').run(); } catch { /* empty */ }
  try { await db.prepare('ALTER TABLE user_profile ADD COLUMN sharp_score REAL DEFAULT 0').run(); } catch { /* empty */ }
  try { await db.prepare('ALTER TABLE user_profile ADD COLUMN roi REAL DEFAULT 0').run(); } catch { /* empty */ }
  try { await db.prepare('ALTER TABLE user_profile ADD COLUMN bets INTEGER DEFAULT 0').run(); } catch { /* empty */ }
  try { await db.prepare('ALTER TABLE user_profile ADD COLUMN wins INTEGER DEFAULT 0').run(); } catch { /* empty */ }

  // Imported Odds Table for Odds-API.io caching
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS imported_odds (
      id TEXT PRIMARY KEY, -- external_event_id from API-Football
      sport TEXT,
      league_name TEXT,
      home_team TEXT,
      away_team TEXT,
      event_date TEXT,
      status TEXT,
      payload TEXT,
      is_live INTEGER DEFAULT 0,
      publish_status TEXT DEFAULT 'hidden',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run().catch(() => { /* empty */ });
  try { await db.prepare('CREATE INDEX IF NOT EXISTS idx_imported_odds_sport ON imported_odds(sport)').run(); } catch { /* empty */ }
  try { await db.prepare('CREATE INDEX IF NOT EXISTS idx_imported_odds_is_live ON imported_odds(is_live)').run(); } catch { /* empty */ }

  // Odds Snapshots Table (Adaptive Polling History)
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS odds_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        match_uid TEXT NOT NULL, -- Link to imported_odds.id or events.id
        snapshot TEXT NOT NULL,  -- JSON content of odds/score
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run().catch(() => { /* empty */ });
  try { await db.prepare('CREATE INDEX IF NOT EXISTS idx_odds_snapshots_match_uid ON odds_snapshots(match_uid)').run(); } catch { /* empty */ }
  try { await db.prepare('CREATE INDEX IF NOT EXISTS idx_odds_snapshots_created_at ON odds_snapshots(created_at)').run(); } catch { /* empty */ }

  // Odds Table (From User Script)
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS odds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fixture_id TEXT,
      bookmaker TEXT,
      market TEXT,
      outcome TEXT,
      odd REAL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run().catch(() => { /* empty */ });
  try { await db.prepare('CREATE INDEX IF NOT EXISTS idx_odds_fixture ON odds(fixture_id)').run(); } catch { /* empty */ }


  // Add columns if they don't exist (Migration)
  try { await db.prepare('ALTER TABLE imported_odds ADD COLUMN home_team TEXT').run(); } catch { /* empty */ }
  try { await db.prepare('ALTER TABLE imported_odds ADD COLUMN away_team TEXT').run(); } catch { /* empty */ }
  try { await db.prepare('ALTER TABLE imported_odds ADD COLUMN event_date TEXT').run(); } catch { /* empty */ }
  try { await db.prepare('ALTER TABLE imported_odds ADD COLUMN is_live INTEGER DEFAULT 0').run(); } catch { /* empty */ }
  try { await db.prepare("ALTER TABLE imported_odds ADD COLUMN publish_status TEXT DEFAULT 'hidden'").run(); } catch { /* empty */ }



  // Favorites Table
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS user_favorites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      event_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES user(id),
      UNIQUE(user_id, event_id)
    )
  `).run().catch(() => { /* empty */ });

  // Teams Table (Seed)
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS teams (
        official TEXT PRIMARY KEY,
        aliases TEXT -- JSON array of aliases
    )
  `).run().catch(() => { /* empty */ });

  // Markets Table (Seed)
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS markets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        match_id INTEGER NOT NULL,
        market_key TEXT NOT NULL,
        market_name TEXT NOT NULL,
        bookmaker TEXT DEFAULT 'Generic',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(match_id, market_key, bookmaker)
    )
  `).run().catch(() => { /* empty */ });

  // Event Images Table (Scraper B)
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS event_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      match_id TEXT,
      team_id TEXT,
      player_id TEXT,
      image_type TEXT NOT NULL, -- 'logo', 'banner', 'player'
      url TEXT NOT NULL,
      source TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(match_id, team_id, player_id, image_type)
    )
  `).run().catch(() => { /* empty */ });

  try { await db.prepare('ALTER TABLE imported_odds ADD COLUMN is_live INTEGER DEFAULT 0').run(); } catch { /* empty */ }

  // KYC Profiles Table
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS kyc_profiles (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      status TEXT DEFAULT 'unverified',
      risk_level TEXT DEFAULT 'low',
      verified_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES user(id)
    )
  `).run().catch(() => { /* empty */ });

  // KYC Documents Table
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS kyc_documents (
      id TEXT PRIMARY KEY,
      kyc_profile_id TEXT NOT NULL,
      type TEXT NOT NULL,
      file_path TEXT NOT NULL,
      status TEXT DEFAULT 'uploaded',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      ip_address TEXT,
      content BLOB,
      mime_type TEXT,
      filename TEXT,
      FOREIGN KEY (kyc_profile_id) REFERENCES kyc_profiles(id)
    )
  `).run().catch(() => { /* empty */ });

  // Add columns if they don't exist (Migration for kyc_documents)
  try { await db.prepare('ALTER TABLE kyc_documents ADD COLUMN ip_address TEXT').run(); } catch { /* empty */ }
  try { await db.prepare('ALTER TABLE kyc_documents ADD COLUMN content BLOB').run(); } catch { /* empty */ }
  try { await db.prepare('ALTER TABLE kyc_documents ADD COLUMN mime_type TEXT').run(); } catch { /* empty */ }
  try { await db.prepare('ALTER TABLE kyc_documents ADD COLUMN filename TEXT').run(); } catch { /* empty */ }

  // --- FINANCIAL TABLES ---

  // Wallets Table
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS wallets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        currency TEXT DEFAULT 'EUR',
        balance REAL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES user(id),
        UNIQUE(user_id, currency)
    )
  `).run().catch(() => { /* empty */ });

  // Deposits Table
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS deposits (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        amount_eur REAL NOT NULL,
        method TEXT NOT NULL, -- 'MULTIBANCO', 'MBWAY', 'CC'
        status TEXT NOT NULL DEFAULT 'PENDING',
        provider_ref TEXT, -- MB Reference or MBWay Request ID
        provider_entity TEXT, -- MB Entity
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES user(id)
    )
  `).run().catch(() => { /* empty */ });

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS user_freebets (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        amount_eur REAL NOT NULL,
        source TEXT NOT NULL,
        used INTEGER DEFAULT 0,
        expires_at DATETIME NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES user(id)
    )
  `).run().catch(() => {});
  try { await db.prepare('CREATE INDEX IF NOT EXISTS idx_user_freebets_user_id ON user_freebets(user_id)').run(); } catch (e) { void e; }

  try { await db.prepare('CREATE INDEX IF NOT EXISTS idx_deposits_provider_ref ON deposits(provider_ref)').run(); } catch { /* empty */ }
  try { await db.prepare('ALTER TABLE deposits ADD COLUMN provider_entity TEXT').run(); } catch { /* empty */ }
  try { await db.prepare('ALTER TABLE deposits ADD COLUMN provider_ref TEXT').run(); } catch { /* empty */ }

  // Transactions Table (Ledger)
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        wallet_id INTEGER NOT NULL,
        type TEXT NOT NULL, -- 'DEPOSIT', 'WITHDRAWAL', 'BET', 'WIN'
        amount REAL NOT NULL,
        status TEXT DEFAULT 'COMPLETED',
        external_id TEXT, -- Reference to deposit_id, bet_id, etc.
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (wallet_id) REFERENCES wallets(id)
    )
  `).run().catch(() => { /* empty */ });

  // Payment Events (Idempotency)
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS payment_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT NOT NULL,
        reference TEXT NOT NULL,
        amount REAL,
        status TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(provider, reference)
    )
  `).run().catch(() => { /* empty */ });

  // Audit Logs Table
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        actor_type TEXT NOT NULL,
        actor_id TEXT,
        action TEXT NOT NULL,
        entity TEXT NOT NULL,
        entity_id TEXT,
        before_state TEXT,
        after_state TEXT,
        ip_address TEXT,
        user_agent TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run().catch(() => { /* empty */ });

  // Withdrawals Table
    await db.prepare(`
    CREATE TABLE IF NOT EXISTS withdrawals (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        amount REAL NOT NULL,
        method TEXT NOT NULL,
        destination TEXT NOT NULL,
        status TEXT DEFAULT 'PENDING',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES user(id)
    )
  `).run().catch(() => { /* empty */ });

  // --- NEW TABLES FOR KYC BACKOFFICE & WITHDRAWAL LOGIC ---

  // Ledger Transactions (Correcting potential missing table)
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS ledger_transactions (
        id TEXT PRIMARY KEY,
        wallet_id INTEGER NOT NULL,
        type TEXT NOT NULL, -- 'credit', 'debit', 'hold', 'release'
        amount REAL NOT NULL,
        reference TEXT,
        status TEXT DEFAULT 'confirmed',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (wallet_id) REFERENCES wallets(id)
    )
  `).run().catch(() => { /* empty */ });
  try { await db.prepare('CREATE INDEX IF NOT EXISTS idx_ledger_wallet_id ON ledger_transactions(wallet_id)').run(); } catch { /* empty */ }

  // Locks Table (for Advisory Locks)
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS locks (
        key TEXT PRIMARY KEY,
        expires_at DATETIME NOT NULL
    )
  `).run().catch(() => { /* empty */ });

  // Withdraw Requests (Used by WithdrawService)
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS withdraw_requests (
        id TEXT PRIMARY KEY,
        wallet_id INTEGER NOT NULL,
        amount REAL NOT NULL,
        method TEXT NOT NULL, -- 'SEPA', 'CRYPTO', etc.
        destination TEXT NOT NULL, -- IBAN or Address
        status TEXT NOT NULL, -- 'requested', 'approved', 'processing', 'paid', 'rejected'
        idempotency_key TEXT,
        requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        processed_at DATETIME,
        FOREIGN KEY (wallet_id) REFERENCES wallets(id)
    )
  `).run().catch(() => { /* empty */ });
  try { await db.prepare('CREATE INDEX IF NOT EXISTS idx_withdraw_requests_idempotency ON withdraw_requests(idempotency_key)').run(); } catch { /* empty */ }
  try { await db.prepare('CREATE INDEX IF NOT EXISTS idx_withdraw_requests_status ON withdraw_requests(status)').run(); } catch { /* empty */ }

  // Notifications Table
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL, -- 'info', 'success', 'warning', 'error'
        message TEXT NOT NULL,
        read INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES user(id)
    )
  `).run().catch(() => { /* empty */ });
  try { await db.prepare('CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, read)').run(); } catch { /* empty */ }

  // Trading Decisions Table (Ensured for Events API)
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS trading_decisions (
        event_id TEXT PRIMARY KEY,
        status TEXT,
        manual_odds TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run().catch(() => { /* empty */ });

  // Migrations for KYC Backoffice
  try { await db.prepare('ALTER TABLE kyc_documents ADD COLUMN notes TEXT').run(); } catch { /* empty */ }
  try { await db.prepare('ALTER TABLE kyc_profiles ADD COLUMN locked_iban TEXT').run(); } catch { /* empty */ }
  try { await db.prepare('ALTER TABLE kyc_documents ADD COLUMN ip_address TEXT').run(); } catch { /* empty */ }
  try { await db.prepare('ALTER TABLE kyc_documents ADD COLUMN content BLOB').run(); } catch { /* empty */ }
  try { await db.prepare('ALTER TABLE kyc_documents ADD COLUMN mime_type TEXT').run(); } catch { /* empty */ }
  try { await db.prepare('ALTER TABLE kyc_documents ADD COLUMN filename TEXT').run(); } catch { /* empty */ }

  // API Usage Table
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS api_usage_daily (
        date TEXT NOT NULL, -- YYYY-MM-DD
        provider TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        count INTEGER DEFAULT 0,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (date, provider, endpoint)
    )
  `).run().catch(() => { /* empty */ });

};
