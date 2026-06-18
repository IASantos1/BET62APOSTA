import { createPool, ensureSchema } from '../lib/db';

async function main() {
  console.log('[db:push] Connecting to database...');
  const pool = createPool();
  if (!pool) {
    console.error('[db:push] ERROR: DATABASE_URL is not set');
    process.exit(1);
  }
  try {
    await ensureSchema(pool);
    console.log('[db:push] Schema applied successfully');
  } catch (e: any) {
    console.error('[db:push] ERROR:', String(e?.message || e));
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
