-- Drop the problematic bets_user_id_fkey constraint that's blocking startup
-- The bets table will keep the user_id column but without the FK constraint
-- to allow for existing orphaned bet records

BEGIN;

-- Drop the constraint if it exists
ALTER TABLE IF EXISTS bets DROP CONSTRAINT IF EXISTS bets_user_id_fkey;

-- Also clean up any other old constraint names that might exist
ALTER TABLE IF EXISTS bets DROP CONSTRAINT IF EXISTS "bets_user_id_fkey";

COMMIT;

