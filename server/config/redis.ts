import Redis from 'ioredis';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

export const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
  retryStrategy: (times) => {
    // Retry up to 3 times, then fallback to memory only logic if handled elsewhere
    return Math.min(times * 50, 2000);
  }
});

redis.on('connect', () => {
  console.log('[Redis] Connected to Redis');
});

redis.on('error', (err) => {
  console.error('[Redis] Redis error:', err.message);
});
