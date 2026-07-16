BEGIN;

DO $$
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
END $$;

DO $$
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
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = 'user_id'
  ) THEN
    ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_user_id_fkey;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = 'user_id'
      AND data_type <> 'text'
  ) THEN
    ALTER TABLE profiles
      ALTER COLUMN user_id TYPE TEXT
      USING user_id::text;
  END IF;
END $$;

DO $$
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
END $$;

COMMIT;
