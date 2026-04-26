
const CASHOUT_FACTOR = 0.88; // 12% house margin on cashouts

export type CashoutBlockReason =
  | 'market_suspended'
  | 'odds_frozen'
  | 'critical_phase'        // last minutes with tight scoreline
  | 'incident_cooldown'     // recent goal/red card/penalty
  | 'odds_too_low'          // currentOdd <= 1.05 — protect house exposure
  | 'event_finished'
  | 'no_live_odds';

export function calculateCashout({
  stake,
  originalOdd,
  currentOdd,
  suspended,
}: {
  stake: number;
  originalOdd: number;
  currentOdd: number;
  suspended?: boolean;
}) {
  if (suspended) return null;
  if (!currentOdd || currentOdd <= 1) return null;

  const raw = stake * (originalOdd / currentOdd);
  const cashout = raw * CASHOUT_FACTOR;

  return Math.max(cashout, 0);
}

/**
 * Critical-moment guard. Returns null if cashout is allowed,
 * or a reason string if cashout must be blocked to protect the house.
 *
 * Rules (single bets only — multi cashout is disabled in the API for now):
 *  - market.suspended or payload.oddsFrozen → block.
 *  - event status finished (FT/AET/PEN) → block.
 *  - currentOdd <= 1.05 (selection nearly certain to win) → block;
 *    paying out near-full would leak house margin while there's
 *    still latency / live-odds noise.
 *  - Last 10 minutes of regulation when score margin <= 1
 *    AND user is "winning" (currentOdd < originalOdd) → block.
 *    Final minutes have huge swing risk (late goals, red cards).
 *  - Recent incident cooldown: if eventPayload.lastIncidentAt is
 *    within the last 90s → block ("lance crítico").
 */
export function evaluateCashoutBlock({
  status,
  isLive,
  elapsed,
  homeScore,
  awayScore,
  currentOdd,
  originalOdd,
  suspended,
  oddsFrozen,
  lastIncidentAt,
  now = Date.now(),
}: {
  status?: string | null;
  isLive?: number | boolean;
  elapsed?: number | null;
  homeScore?: number | null;
  awayScore?: number | null;
  currentOdd: number;
  originalOdd: number;
  suspended?: boolean;
  oddsFrozen?: boolean;
  lastIncidentAt?: number | null;
  now?: number;
}): CashoutBlockReason | null {
  if (suspended) return 'market_suspended';
  if (oddsFrozen) return 'odds_frozen';

  const finishedStatuses = new Set(['FT', 'AET', 'PEN', 'FINISHED', 'ENDED', 'POSTP', 'CANC', 'ABD']);
  if (status && finishedStatuses.has(String(status).toUpperCase())) return 'event_finished';

  if (!currentOdd || currentOdd <= 1) return 'no_live_odds';
  if (currentOdd <= 1.05) return 'odds_too_low';

  if (lastIncidentAt && now - lastIncidentAt < 90_000) return 'incident_cooldown';

  if (isLive && typeof elapsed === 'number' && elapsed >= 80) {
    const margin = Math.abs((homeScore ?? 0) - (awayScore ?? 0));
    const userWinning = currentOdd < originalOdd;
    if (margin <= 1 && userWinning) return 'critical_phase';
  }

  return null;
}
