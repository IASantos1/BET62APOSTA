
import { getUserProfile, classifyUser } from './sharpDetection';

export async function initRiskTables(db: D1Database) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS market_exposure (
      market_id TEXT PRIMARY KEY,
      exposure REAL DEFAULT 0,
      max_exposure REAL DEFAULT 10000,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run().catch(() => {});

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS outcome_exposure (
      market_unique_id TEXT,
      outcome TEXT,
      exposure REAL DEFAULT 0,
      max_exposure REAL DEFAULT 10000,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (market_unique_id, outcome)
    )
  `).run().catch(() => {});

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS user_limits (
      user_id TEXT PRIMARY KEY,
      max_stake REAL DEFAULT 1000,
      max_daily REAL DEFAULT 5000
    )
  `).run().catch(() => {});

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS risk_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT,
      message TEXT,
      data TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      read INTEGER DEFAULT 0
    )
  `).run().catch(() => {});
}

export async function notifyAdmins(db: D1Database, alert: any) {
    try {
        await db.prepare(`
            INSERT INTO risk_alerts (type, message, data)
            VALUES (?, ?, ?)
        `).bind(alert.type, alert.message, JSON.stringify(alert)).run();
    } catch (e) {
        console.error('Failed to create risk alert', e);
    }
}

export async function updateExposure(db: D1Database, marketId: string, outcome: string, stake: number, odd: number) {
  const potentialPayout = stake * odd;
  
  // Update General Market Exposure (Legacy/Global Limit)
  // We use the marketId as the key.
  await db.prepare(`
    INSERT INTO market_exposure (market_id, exposure)
    VALUES (?, ?)
    ON CONFLICT(market_id)
    DO UPDATE SET exposure = exposure + ?
  `).bind(marketId, potentialPayout, potentialPayout).run();

  // Update Outcome Specific Exposure (For Book Balancing)
  await db.prepare(`
    INSERT INTO outcome_exposure (market_unique_id, outcome, exposure)
    VALUES (?, ?, ?)
    ON CONFLICT(market_unique_id, outcome)
    DO UPDATE SET exposure = exposure + ?
  `).bind(marketId, outcome, potentialPayout, potentialPayout).run();
}

export type UserLimitCheckResult = 
  | { ok: false; reason: string; maxStake: number }
  | { ok: true; maxStake: number };

export type RiskCheckResult = 
  | { ok: false; reason: string; maxStake?: number }
  | { ok: true; liability: number; currentExposure: number; maxExposure: number; modifiedOdd: number; delayMs: number };

export async function canPlaceBet({
  db,
  userId,
  marketId,
  stake,
  odd,
}: {
  db: D1Database;
  userId: string;
  marketId: string;
  stake: number;
  odd: number;
}): Promise<RiskCheckResult> {
  const liability = stake * (odd - 1);

  // Check Market Exposure
  const market = await db.prepare(
    `SELECT exposure, max_exposure FROM market_exposure WHERE market_id = ?`
  ).bind(marketId).first<{ exposure: number; max_exposure: number }>();

  // If market entry doesn't exist, we assume it's safe (0 exposure) or create it with default.
  // The query above returns null if not found.
  // Default max_exposure is 10000 per the table definition.
  const currentExposure = market?.exposure || 0;
  const maxExposure = market?.max_exposure || 10000;

  if (currentExposure + liability > maxExposure) {
    // Notify Admins
    await notifyAdmins(db, {
        type: 'RISK_LIMIT',
        marketId,
        message: `Market exposure limit exceeded: ${currentExposure + liability} > ${maxExposure}`,
        exposure: currentExposure,
        liability
    });
    return { ok: false, reason: 'MARKET_LIMIT_EXCEEDED' };
  }

  // Check User Limits
  const userCheck = await checkUserLimit(db, userId, stake);
  if (!userCheck.ok) {
      return userCheck;
  }

  // Sharp Detection Checks
  const profile = await getUserProfile(db, userId);
  const userType = classifyUser(profile);
  
  let modifiedOdd = odd;
  let delayMs = 0;

  if (userType === 'SHARP') {
      // 20% of normal limit check (already checked general limit, but maybe reduce max stake here?
      // Actually user instructions said: maxStake = baseStake * 0.2.
      // We already checked limit. If limit is 1000, sharp limit is 200.
      const sharpMaxStake = (userCheck.maxStake || 1000) * 0.2;
      if (stake > sharpMaxStake) {
          return { ok: false, reason: 'SHARP_LIMIT_EXCEEDED' };
      }
      modifiedOdd = odd * 0.97;
      delayMs = 3000;
  } else if (userType === 'SUSPICIOUS') {
      const suspMaxStake = (userCheck.maxStake || 1000) * 0.5;
      if (stake > suspMaxStake) {
           return { ok: false, reason: 'SUSPICIOUS_LIMIT_EXCEEDED' };
      }
      delayMs = 1000;
  }

  return { ok: true, liability, currentExposure, maxExposure, modifiedOdd, delayMs };
}

export async function checkUserLimit(db: D1Database, userId: string, stake: number): Promise<UserLimitCheckResult> {
  const user = await db.prepare(
    `SELECT max_stake FROM user_limits WHERE user_id = ?`
  ).bind(userId).first<{ max_stake: number }>();

  const maxStake = user?.max_stake || 1000; // Default 1000

  if (stake > maxStake) {
    return { ok: false, reason: 'USER_LIMIT_EXCEEDED', maxStake };
  }
  return { ok: true, maxStake };
}
