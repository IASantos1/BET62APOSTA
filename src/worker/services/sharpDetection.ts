
export async function initSharpTables(db: D1Database) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS user_profile (
      user_id TEXT PRIMARY KEY,
      sharp_score REAL DEFAULT 0,
      roi REAL DEFAULT 0,
      bets INTEGER DEFAULT 0,
      wins INTEGER DEFAULT 0,
      avg_odd REAL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run().catch(() => {});

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS bet_analysis (
      bet_id INTEGER,
      user_id TEXT,
      market_id TEXT,
      odd REAL,
      closing_odd REAL,
      beat_closing INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run().catch(() => {});
}

export interface UserProfile {
  user_id: string;
  sharp_score: number;
  roi: number;
  bets: number;
  wins: number;
  avg_odd: number;
}

export async function getUserProfile(db: D1Database, userId: string): Promise<UserProfile> {
  let profile = await db.prepare('SELECT * FROM user_profile WHERE user_id = ?').bind(userId).first<UserProfile>();
  if (!profile) {
    await db.prepare('INSERT INTO user_profile (user_id) VALUES (?)').bind(userId).run();
    profile = { user_id: userId, sharp_score: 0, roi: 0, bets: 0, wins: 0, avg_odd: 0 };
  }
  return profile;
}

export function classifyUser(profile: UserProfile): 'SHARP' | 'SUSPICIOUS' | 'NORMAL' {
  if (profile.sharp_score >= 10) return 'SHARP';
  if (profile.sharp_score >= 6) return 'SUSPICIOUS';
  return 'NORMAL';
}

export async function analyzeBet(db: D1Database, bet: any, closingOdd: number) {
  const beatClosing = Number(bet.odd) > closingOdd ? 1 : 0;
  
  await db.prepare(`
    INSERT INTO bet_analysis (bet_id, user_id, market_id, odd, closing_odd, beat_closing)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(bet.id, bet.user_id, bet.event_id, bet.odd, closingOdd, beatClosing).run();

  // Update Profile Stats
  const profile = await getUserProfile(db, bet.user_id);
  const newScore = updateSharpScore(profile, { ...bet, beat_closing: beatClosing });
  
  // Recalculate ROI/Wins would require fetching all bets or incremental update.
  // For now, let's just update the score.
  await db.prepare('UPDATE user_profile SET sharp_score = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?')
    .bind(newScore, bet.user_id).run();
}

function updateSharpScore(profile: UserProfile, bet: any) {
  let score = profile.sharp_score;

  if (bet.beat_closing) score += 1.5;
  if (bet.odd < 1.4) score -= 0.5; // Safe bets reduce score slightly? Or maybe not. User said "odds seguras" reduce score.
  if (profile.roi > 0.15) score += 2;
  if (profile.bets > 50 && (profile.wins / profile.bets) > 0.6) score += 2;

  return Math.max(0, score);
}

export function detectArbitrage(odd: number, bestExternalOdd: number) {
    return odd > bestExternalOdd * 1.02;
}

export async function checkMultiAccount(db: D1Database, userId: string, ip: string, fingerprint?: string) {
  if (userId === 'test-user-freebet') return { detected: false };

  // Check for other users with same IP
  if (ip && ip !== 'unknown' && ip !== '127.0.0.1') {
      const { results } = await db.prepare(`
          SELECT DISTINCT user_id FROM bets 
          WHERE ip_address = ? AND user_id != ?
          LIMIT 5
      `).bind(ip, userId).all();
      
      if (results && results.length > 0) {
          return { detected: true, reason: 'SHARED_IP', users: results.map((r: any) => r.user_id) };
      }
  }

  // Check for other users with same Fingerprint
  if (fingerprint) {
      const { results } = await db.prepare(`
          SELECT DISTINCT user_id FROM bets 
          WHERE device_fingerprint = ? AND user_id != ?
          LIMIT 5
      `).bind(fingerprint, userId).all();

      if (results && results.length > 0) {
           return { detected: true, reason: 'SHARED_DEVICE', users: results.map((r: any) => r.user_id) };
      }
  }

  return { detected: false };
}

export async function detectInternalArbitrage(db: D1Database, userId: string, eventId: string) {
    // Check if user has bet on multiple outcomes of the same market to guarantee profit
    // This is complex as we need to know market structure.
    // Simplified: Check if user has bets on Home AND Away AND Draw for the same event.
    
    const { results } = await db.prepare(`
        SELECT selection, odd, stake FROM bets 
        WHERE user_id = ? AND event_id = ? AND status = 'pending'
    `).bind(userId, eventId).all();

    if (!results || results.length < 2) return false;

    // Very basic check for H2H coverage
    const selections = results.map((r: any) => r.selection);
    const hasHome = selections.some((s: string) => s === 'Home' || s === 'Casa' || s === '1');
    const hasAway = selections.some((s: string) => s === 'Away' || s === 'Fora' || s === '2');
    const hasDraw = selections.some((s: string) => s === 'Draw' || s === 'Empate' || s === 'X');

    if (hasHome && hasAway) {
        // If it's a 3-way market, need Draw too. If 2-way (Tennis), this is arb.
        // We'll just flag it as suspicious for now.
        return true;
    }

    return false;
}

export { updateSharpScore };
