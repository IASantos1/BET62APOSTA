-- PostgreSQL only.
-- Safe for Railway/current schema because it does not reuse legacy D1 table names.

CREATE TABLE IF NOT EXISTS provider_team_mappings (
  id                        TEXT        PRIMARY KEY,
  provider                  TEXT        NOT NULL,
  provider_team_id          TEXT        NOT NULL,
  canonical_team_id         TEXT        REFERENCES teams(id) ON DELETE CASCADE,
  api_football_team_id      TEXT,
  provider_team_name        TEXT        NOT NULL,
  canonical_team_name       TEXT,
  normalized_provider_name  TEXT        NOT NULL,
  normalized_canonical_name TEXT,
  country                   TEXT,
  league_id                 TEXT        REFERENCES leagues(id) ON DELETE SET NULL,
  confidence_score          NUMERIC(5,4) NOT NULL DEFAULT 0,
  match_method              TEXT        NOT NULL DEFAULT 'manual',
  manual_override           BOOLEAN     NOT NULL DEFAULT FALSE,
  last_verified_at          TIMESTAMPTZ,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(provider, provider_team_id)
);

CREATE TABLE IF NOT EXISTS provider_fixture_mappings (
  id                      TEXT        PRIMARY KEY,
  provider                TEXT        NOT NULL,
  provider_fixture_id     TEXT        NOT NULL,
  canonical_fixture_id    TEXT        REFERENCES fixtures(id) ON DELETE CASCADE,
  api_football_fixture_id TEXT,
  provider_home_team_id   TEXT,
  provider_away_team_id   TEXT,
  provider_league_id      TEXT,
  provider_league_name    TEXT,
  provider_country        TEXT,
  provider_kickoff        TIMESTAMPTZ,
  normalized_home_team    TEXT        NOT NULL,
  normalized_away_team    TEXT        NOT NULL,
  confidence_score        NUMERIC(5,4) NOT NULL DEFAULT 0,
  match_method            TEXT        NOT NULL DEFAULT 'fixture-context',
  manual_override         BOOLEAN     NOT NULL DEFAULT FALSE,
  status                  TEXT        NOT NULL DEFAULT 'pending',
  review_reason           TEXT,
  payload                 JSONB,
  last_verified_at        TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(provider, provider_fixture_id)
);

CREATE TABLE IF NOT EXISTS provider_live_stats (
  id                   TEXT        PRIMARY KEY,
  provider             TEXT        NOT NULL,
  provider_fixture_id  TEXT        NOT NULL,
  canonical_fixture_id TEXT        REFERENCES fixtures(id) ON DELETE CASCADE,
  stats_payload        JSONB,
  momentum_payload     JSONB,
  incidents_payload    JSONB,
  raw_payload          JSONB,
  captured_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_provider_team_mappings_provider_team_id
  ON provider_team_mappings(provider, provider_team_id);

CREATE INDEX IF NOT EXISTS idx_provider_team_mappings_canonical_team_id
  ON provider_team_mappings(canonical_team_id);

CREATE INDEX IF NOT EXISTS idx_provider_team_mappings_league_id
  ON provider_team_mappings(league_id);

CREATE INDEX IF NOT EXISTS idx_provider_fixture_mappings_provider_fixture_id
  ON provider_fixture_mappings(provider, provider_fixture_id);

CREATE INDEX IF NOT EXISTS idx_provider_fixture_mappings_canonical_fixture_id
  ON provider_fixture_mappings(canonical_fixture_id);

CREATE INDEX IF NOT EXISTS idx_provider_fixture_mappings_kickoff
  ON provider_fixture_mappings(provider_kickoff);

CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_fixture_mappings_provider_fixture_unique
  ON provider_fixture_mappings(provider, canonical_fixture_id)
  WHERE canonical_fixture_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_provider_live_stats_provider_fixture_id
  ON provider_live_stats(provider, provider_fixture_id, captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_provider_live_stats_canonical_fixture_id
  ON provider_live_stats(canonical_fixture_id, captured_at DESC);
