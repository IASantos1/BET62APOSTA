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
DECLARE
  ref RECORD;
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
      EXECUTE format(
        'ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I',
        ref.table_name,
        ref.table_name || '_' || ref.column_name || '_fkey'
      );
    END IF;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ref.table_name
        AND column_name = ref.column_name
        AND data_type <> 'text'
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I ALTER COLUMN %I TYPE TEXT USING %I::text',
        ref.table_name,
        ref.column_name,
        ref.column_name
      );
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE
  ref RECORD;
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
END $$;

COMMIT;
