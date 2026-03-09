
const MIN_LIQUIDITY = 500; // Adjustment per sport/market

export function shouldSuspendMarket(market: any, event: any): string | null {
  // 1. Event Frozen (Goal, VAR, Red Card, etc.)
  if (event.oddsFrozen) {
    return 'EVENT_FROZEN';
  }

  // 2. Low Liquidity
  // Ensure liquidity exists, if not, assume it's low or use a default if we are simulating
  // The caller is responsible for setting market.liquidity before calling this if they want to test it.
  if (typeof market.liquidity === 'number' && market.liquidity < MIN_LIQUIDITY) {
    return 'LOW_LIQUIDITY';
  }

  // 3. Risk Margin (Overround)
  // market.overround should be calculated before this check
  if (typeof market.overround === 'number' && market.overround < 103) {
    return 'RISK_MARGIN';
  }

  return null;
}
