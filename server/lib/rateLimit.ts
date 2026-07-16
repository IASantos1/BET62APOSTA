type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

function cleanup(now: number): void {
  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export function hitRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { allowed: boolean; remaining: number; retryAfterMs: number } {
  const now = Date.now();
  cleanup(now);
  const safeKey = String(key || '').trim();
  if (!safeKey || limit <= 0 || windowMs <= 0) {
    return { allowed: true, remaining: Math.max(0, limit), retryAfterMs: 0 };
  }

  const current = buckets.get(safeKey);
  if (!current || current.resetAt <= now) {
    buckets.set(safeKey, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: Math.max(0, limit - 1), retryAfterMs: 0 };
  }

  current.count += 1;
  buckets.set(safeKey, current);
  if (current.count > limit) {
    return { allowed: false, remaining: 0, retryAfterMs: Math.max(0, current.resetAt - now) };
  }
  return { allowed: true, remaining: Math.max(0, limit - current.count), retryAfterMs: 0 };
}

export function clearRateLimit(key: string): void {
  const safeKey = String(key || '').trim();
  if (!safeKey) return;
  buckets.delete(safeKey);
}
