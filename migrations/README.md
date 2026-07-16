# Migrations Strategy

This repository contains two different migration histories:

- `migrations/*.sql`: legacy D1/SQLite migrations kept for historical reference.
- `server/lib/db.ts` + `scripts/init-db.ts`: the current source of truth for Railway/PostgreSQL.

## Railway / PostgreSQL

For Railway, do **not** apply the legacy D1/SQLite chain blindly.

Use one of these safe paths instead:

1. Preferred: run `npm run db:railway:push`
2. Manual repair for an existing Railway database with drift: apply `migrations/0018_repair_railway_postgres_schema.sql`
3. If PostgreSQL reports `profiles_user_id_fkey cannot be implemented`: apply `migrations/0037_fix_profiles_users_fk_postgres.sql`

The current PostgreSQL schema uses:

- `users(id)` as the canonical auth table
- `profiles.user_id REFERENCES users(id) ON DELETE CASCADE`

## Legacy Files

These files still reference the old SQLite/D1 auth table `user(id)` and should not be used as Railway/PostgreSQL migrations:

- `migrations/0002_consolidate_schema.sql`
- `migrations/0016_security_hardening.sql`
- `migrations/0017_add_kyc_state_engine.sql`
- `migrations/0019_tier1_payment_system.sql`
- `migrations/0021_allow_paypal_deposits.sql`

They also contain legacy SQLite/D1-specific patterns such as:

- `AUTOINCREMENT`
- `PRAGMA foreign_keys=OFF`
- `CURRENT_TIMESTAMP` / integer timestamp patterns intended for D1

## Quick Checks

Verify the canonical tables exist:

```sql
SELECT to_regclass('public.users');
SELECT to_regclass('public.user');
SELECT to_regclass('public.profiles');
```

Verify the foreign key on `profiles.user_id`:

```sql
SELECT
  tc.constraint_name,
  kcu.column_name,
  ccu.table_name AS foreign_table_name,
  ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_name = 'profiles';
```
