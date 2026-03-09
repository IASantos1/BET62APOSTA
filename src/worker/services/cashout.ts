
const CASHOUT_FACTOR = 0.88;

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
