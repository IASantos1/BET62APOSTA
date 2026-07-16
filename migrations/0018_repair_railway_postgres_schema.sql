BEGIN;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF to_regclass('public.profiles') IS NULL AND to_regclass('public.user_profile') IS NOT NULL THEN
    ALTER TABLE user_profile RENAME TO profiles;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  phone TEXT,
  balance NUMERIC(18,2) NOT NULL DEFAULT 0,
  free_bet_balance NUMERIC(18,2) NOT NULL DEFAULT 0,
  kyc_verified BOOLEAN NOT NULL DEFAULT FALSE,
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  birth_date TEXT,
  self_exclude BOOLEAN NOT NULL DEFAULT FALSE,
  self_exclude_until TIMESTAMPTZ,
  is_operator BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS id TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS full_name TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS balance NUMERIC(18,2) NOT NULL DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS free_bet_balance NUMERIC(18,2) NOT NULL DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS kyc_verified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS birth_date TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS self_exclude BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS self_exclude_until TIMESTAMPTZ;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_operator BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DO $$
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
END $$;

DO $$
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
END $$;

DO $$
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
END $$;

DO $$
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
END $$;

DO $$
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
END $$;

DO $$
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
END $$;

UPDATE profiles p
SET email = COALESCE(NULLIF(p.email, ''), u.email),
    full_name = COALESCE(NULLIF(p.full_name, ''), u.name),
    updated_at = NOW()
FROM users u
WHERE u.id = p.user_id
  AND (
    p.email IS NULL OR p.email = '' OR p.full_name IS NULL OR p.full_name = ''
  );

UPDATE profiles
SET id = md5(COALESCE(user_id, '') || ':' || clock_timestamp()::text)
WHERE id IS NULL OR id = '';

INSERT INTO profiles (id, user_id, email, full_name, created_at, updated_at)
SELECT md5(u.id || ':' || clock_timestamp()::text), u.id, u.email, u.name, NOW(), NOW()
FROM users u
LEFT JOIN profiles p ON p.user_id = u.id
WHERE p.user_id IS NULL;

CREATE TABLE IF NOT EXISTS user_documents (
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
);

DO $$
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
END $$;

ALTER TABLE user_documents ADD COLUMN IF NOT EXISTS doc_type TEXT;
ALTER TABLE user_documents ADD COLUMN IF NOT EXISTS size_bytes BIGINT NOT NULL DEFAULT 0;
ALTER TABLE user_documents ALTER COLUMN content_base64 DROP NOT NULL;
ALTER TABLE user_documents ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE user_documents ADD COLUMN IF NOT EXISTS storage_disk TEXT;
ALTER TABLE user_documents ADD COLUMN IF NOT EXISTS storage_path TEXT;
ALTER TABLE user_documents ADD COLUMN IF NOT EXISTS storage_sha256 TEXT;

DO $$
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
END $$;

DO $$
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
END $$;

UPDATE user_documents
SET updated_at = COALESCE(updated_at, created_at, NOW())
WHERE updated_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_user_id ON profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_documents_user_id ON user_documents(user_id);

COMMIT;
