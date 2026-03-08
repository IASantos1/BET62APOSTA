import Redis from 'ioredis';
import axios, { AxiosRequestConfig } from 'axios';

// TTL Configuration (in seconds)
export const TTL = {
  liveFixtures: 15,    // Aggressive updates for live games
  liveOdds: 10,        // Ultra sensitive for live betting
  preMatchOdds: 60,    // Standard for pre-match
  standings: 300,      // 5 minutes
  leagues: 86400,      // 24 hours
  teams: 86400,        // 24 hours
  upcomingFixtures: 600 // 10 minutes
};

class CacheService {
  private redis: Redis | null = null;
  private memoryFallback: Map<string, { value: any; expiry: number }> = new Map();
  private useRedis: boolean = false;

  constructor() {
    const redisUrl = process.env.REDIS_URL;
    if (redisUrl) {
      this.redis = new Redis(redisUrl, {
        retryStrategy: (times) => {
          // Retry up to 3 times, then fallback to memory only
          if (times > 3) {
            console.warn('[CacheService] Redis connection failed, switching to memory-only mode.');
            this.useRedis = false;
            return null;
          }
          return Math.min(times * 50, 2000);
        }
      });

      this.redis.on('connect', () => {
        console.log('[CacheService] Connected to Redis');
        this.useRedis = true;
      });

      this.redis.on('error', (err: any) => {
        console.error('[CacheService] Redis error:', err.message);
        // Don't disable useRedis immediately on temporary errors, but handled in operations
      });
    } else {
      console.log('[CacheService] No REDIS_URL provided, running in memory-only mode.');
    }
  }

  private async sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async set(key: string, value: any, ttlSeconds: number) {
    if (this.useRedis && this.redis) {
      try {
        await this.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
      } catch (err) {
        console.error(`[CacheService] Redis set error for ${key}:`, err);
      }
    }
    this.memoryFallback.set(key, {
      value: value,
      expiry: Date.now() + (ttlSeconds * 1000)
    });
  }

  /**
   * Fetch data with retry logic and exponential backoff
   */
  async fetchWithRetry(url: string, config: AxiosRequestConfig, retries = 3): Promise<any> {
    try {
      const response = await axios(url, config);
      return response.data;
    } catch (err: any) {
      if (err.response?.status === 429 && retries > 0) {
        const delay = 2000 * (4 - retries);
        console.warn(`[CacheService] 429 Rate Limit on ${url}. Retrying in ${delay}ms...`);
        await this.sleep(delay);
        return this.fetchWithRetry(url, config, retries - 1);
      }
      throw err;
    }
  }

  /**
   * Get data from cache or fetch it if missing/stale
   * Implements "Stale-While-Revalidate" pattern logic via locking
   */
  async getOrSetCache<T>(
    key: string,
    ttlSeconds: number,
    fetcher: () => Promise<T>
  ): Promise<T> {
    // 1. Try to get from Redis
    if (this.useRedis && this.redis) {
      try {
        const cached = await this.redis.get(key);
        if (cached) {
          return JSON.parse(cached);
        }
      } catch (err) {
        console.error(`[CacheService] Redis get error for ${key}:`, err);
        // Fallback to memory check below
      }
    }

    // 2. Try Memory Fallback
    const memCached = this.memoryFallback.get(key);
    if (memCached) {
      if (Date.now() < memCached.expiry) {
        return memCached.value;
      }
      // If expired but exists, we might return it if lock fails (stale-while-revalidate soft fallback)
      // But here we proceed to fetch fresh data
    }

    // 3. Acquire Lock to prevent Cache Stampede
    const lockKey = `lock:${key}`;
    let lockAcquired = false;

    const redis = this.redis;
    if (this.useRedis && redis) {
      try {
        const lock = await (redis as any).set(lockKey, '1', 'EX', 5, 'NX'); // 5s lock
        lockAcquired = lock === 'OK';
      } catch (e) {
        // Redis failed, use internal memory lock mechanism could be implemented here
        // For now, proceed as if locked if Redis is down (or just race)
        lockAcquired = true; 
      }
    } else {
      // Simple in-memory lock check (not distributed, but works for single instance)
      // For this simplified version, we'll skip complex in-memory locking and just rely on the promise
      lockAcquired = true;
    }

    if (!lockAcquired) {
      // Wait and retry
      await this.sleep(100);
      return this.getOrSetCache(key, ttlSeconds, fetcher);
    }

    try {
      // 4. Fetch Fresh Data
      const freshData = await fetcher();

      // 5. Save to Cache
      if (this.useRedis && redis) {
        try {
          await (redis as any).set(key, JSON.stringify(freshData), 'EX', ttlSeconds);
        } catch (e) {
          console.error(`[CacheService] Redis set error for ${key}:`, e);
        }
      }

      // Always update memory fallback
      this.memoryFallback.set(key, {
        value: freshData,
        expiry: Date.now() + (ttlSeconds * 1000)
      });

      return freshData;
    } catch (err) {
      console.error(`[CacheService] Error fetching data for ${key}:`, err);
      // Return stale data if available
      if (memCached) {
        console.warn(`[CacheService] Returning stale data for ${key} due to fetch error.`);
        return memCached.value;
      }
      throw err;
    } finally {
      // 6. Release Lock
      if (this.useRedis && this.redis) {
        try {
          await this.redis.del(lockKey);
        } catch (e) { /* ignore */ }
      }
    }
  }

  // --- Specific Helpers for API-Football ---

  async getLiveFixtures(sport: string, apiKey: string, baseUrl: string) {
    // Determine params based on sport (reusing logic from index.ts)
    const isFootball = sport === 'football';
    const params = isFootball ? 'live=all' : `date=${new Date().toISOString().split('T')[0]}`;
    const url = `${baseUrl}/${isFootball ? 'fixtures' : 'games'}?${params}`;

    return this.getOrSetCache(
      `live:fixtures:${sport}`,
      TTL.liveFixtures,
      async () => {
        return this.fetchWithRetry(url, {
          headers: {
            'x-apisports-key': apiKey,
            'x-rapidapi-host': new URL(baseUrl).host
          }
        });
      }
    );
  }

  async getLiveOdds(sport: string, apiKey: string, baseUrl: string) {
    // Only football supports 'live=all' reliably for odds in some plans, 
    // but we'll assume the standard endpoint structure.
    // For other sports, we might need to fetch by date or specific fixture, 
    // but the generic 'odds/live' endpoint exists for football.
    const url = `${baseUrl}/odds/live`;
    
    return this.getOrSetCache(
      `live:odds:${sport}`,
      TTL.liveOdds,
      async () => {
        return this.fetchWithRetry(url, {
          headers: {
            'x-apisports-key': apiKey,
            'x-rapidapi-host': new URL(baseUrl).host
          }
        });
      }
    );
  }
}

export const cacheService = new CacheService();
