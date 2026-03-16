// import { Queue, Worker, Job } from 'bullmq'; // Disabled due to Redis dependency issues on Windows without Docker
// import { redis } from '../config/redis';
import { cacheService } from './cacheService';
import axios from 'axios';

const API_KEY = 
  process.env.API_FOOTBALL_KEY || 
  process.env.VITE_API_FOOTBALL_KEY || 
  process.env.API_FOOTBALL_KEY_ALT || 
  process.env.X_RAPIDAPI_KEY || 
  process.env['x-rapidapi-key'] || 
  '';

const API_PROVIDER = 
  (process.env.API_FOOTBALL_PROVIDER || 
  (process.env.X_RAPIDAPI_KEY || process.env['x-rapidapi-key'] ? 'rapidapi' : 'apisports')).toLowerCase() === 'rapidapi' 
  ? 'rapidapi' 
  : 'apisports';

const RAPIDAPI_HOSTS: Record<string, string> = {
  football: 'api-football-v1.p.rapidapi.com',
  basketball: 'api-basketball.p.rapidapi.com',
  baseball: 'api-baseball.p.rapidapi.com',
  hockey: 'api-hockey.p.rapidapi.com',
  rugby: 'api-rugby.p.rapidapi.com',
  volleyball: 'api-volleyball.p.rapidapi.com',
  handball: 'api-handball.p.rapidapi.com',
  nfl: 'api-american-football.p.rapidapi.com',
  formula1: 'api-formula-1.p.rapidapi.com',
  mma: 'api-mma.p.rapidapi.com',
};

const API_ENDPOINTS: Record<string, string> = {
  football: 'https://v3.football.api-sports.io',
  basketball: 'https://v1.basketball.api-sports.io',
  baseball: 'https://v1.baseball.api-sports.io',
  hockey: 'https://v1.hockey.api-sports.io',
  rugby: 'https://v1.rugby.api-sports.io',
  volleyball: 'https://v1.volleyball.api-sports.io',
  formula1: 'https://v1.formula-1.api-sports.io',
  mma: 'https://v1.mma.api-sports.io',
  handball: 'https://v1.handball.api-sports.io',
  nfl: 'https://v1.american-football.api-sports.io',
  afl: 'https://v1.afl.api-sports.io',
};

function getBaseUrl(sport: string): string | null {
  if (API_PROVIDER === 'rapidapi') {
    const host = RAPIDAPI_HOSTS[sport];
    if (!host) return null;
    const version = sport === 'football' ? 'v3' : 'v1';
    return `https://${host}/${version}`;
  }
  return API_ENDPOINTS[sport] || null;
}

function getHeaders(sport: string): Record<string, string> {
  if (API_PROVIDER === 'rapidapi') {
    const host = RAPIDAPI_HOSTS[sport] || RAPIDAPI_HOSTS['football'];
    return {
      'x-rapidapi-key': API_KEY,
      'x-rapidapi-host': host,
    };
  }
  return {
    'x-apisports-key': API_KEY,
  };
}

// --- In-Memory Queue Implementation ---
// Replaces BullMQ to avoid Redis dependency requirement
class InMemoryQueue {
  private name: string;
  private jobs: any[] = [];
  private worker: InMemoryWorker | null = null;

  constructor(name: string, opts?: any) {
    this.name = name;
    console.log(`[Queue] Initialized In-Memory Queue: ${name}`);
  }

  async add(name: string, data: any, opts?: any) {
    // Mimic BullMQ add
    const job = { 
      id: opts?.jobId || String(Date.now() + Math.random()), 
      name, 
      data, 
      opts 
    };
    
    // console.log(`[Queue] Job added to ${this.name}:`, data.fixtureId);
    
    // Push to processing immediately if worker exists
    if (this.worker) {
      this.worker.process(job);
    } else {
      this.jobs.push(job);
    }
    return job;
  }

  setWorker(worker: InMemoryWorker) {
    this.worker = worker;
    // Process pending
    while (this.jobs.length > 0) {
      const job = this.jobs.shift();
      if (job) this.worker.process(job);
    }
  }
}

class InMemoryWorker {
  private processor: (job: any) => Promise<any>;
  private concurrency: number;
  private running: number = 0;
  private queue: any[] = [];
  private handlers: Record<string, Array<(...args: any[]) => void>> = {};

  constructor(queueName: string, processor: (job: any) => Promise<any>, opts?: any) {
    this.processor = processor;
    this.concurrency = opts?.concurrency || 1;
    // Note: We ignore rate limiter implementation for simplicity in memory mode, 
    // relying on the processing time of the job itself.
  }

  process(job: any) {
    this.queue.push(job);
    this.next();
  }

  private async next() {
    if (this.running >= this.concurrency) return;
    if (this.queue.length === 0) return;

    const job = this.queue.shift();
    if (!job) return;

    this.running++;
    try {
      const result = await this.processor(job);
      this.emit('completed', job, result);
    } catch (err) {
      this.emit('failed', job, err);
    } finally {
      this.running--;
      this.next();
    }
  }

  on(event: string, handler: (...args: any[]) => void) {
    if (!this.handlers[event]) this.handlers[event] = [];
    this.handlers[event].push(handler);
  }

  private emit(event: string, ...args: any[]) {
    if (this.handlers[event]) {
      this.handlers[event].forEach(h => h(...args));
    }
  }
}

export const oddsQueue = new InMemoryQueue('oddsQueue');

export async function fetchOddsFromApi(sport: string, fixtureId: string | number, isLive: boolean = false): Promise<any> {
  const baseUrl = getBaseUrl(sport);
  if (!baseUrl) {
    throw new Error(`Sport ${sport} not supported`);
  }

  // Use correct endpoint for LIVE odds
  // For football, /odds is pre-match, /odds/live is live.
  let endpoint = 'odds';
  if (sport === 'football' && isLive) {
      endpoint = 'odds/live';
  }

  const url = `${baseUrl}/${endpoint}`;
  const headers = getHeaders(sport);
  
  let idParam = 'fixture';
  if (sport === 'basketball' || sport === 'baseball' || sport === 'hockey') idParam = 'game';
  if (sport === 'formula1') idParam = 'race';
  if (sport === 'mma') idParam = 'fight';

  try {
    const params: any = {
      [idParam]: fixtureId,
    };

    // If fetching PRE-MATCH odds, API-Football returns ALL bookmakers by default if not specified.
    // We want ALL available so we can choose the best one in frontend/service.
    // So we don't need to pass specific bookmaker IDs here unless we want to filter server-side.
    // However, fetching ALL might be heavy? Usually it's fine for a single fixture.
    
    // Some sports/endpoints might require additional params or have different logic
    // But assuming standard API-Sports structure:
    // GET /odds?fixture=123 (Pre-match)
    // GET /odds/live?fixture=123 (Live)
    
    const response = await axios.get(url, {
      headers,
      params,
      timeout: 5000
    });

    if (response.data.errors && Object.keys(response.data.errors).length > 0) {
      // API Limit reached or other error
      // console.warn('API-Football warning: ' + JSON.stringify(response.data.errors));
      // Don't throw, just return empty to avoid crashing worker
      return response.data;
    }

    const ttl = isLive ? 10 : 60; 
    
    // Use CacheService to store (supports memory fallback)
    // Key format must match what fetchApiFootball uses: sport:endpoint:param=val
    // e.g. football:odds:fixture=123
    const cacheKey = `${sport}:${endpoint}:${idParam}=${fixtureId}`;
    await cacheService.set(cacheKey, response.data, ttl);
    
    return response.data;
  } catch (error: any) {
    console.error(`[ApiFetch] Error fetching odds for ${sport}:${fixtureId}`, error.message);
    // Return null or throw? Throwing triggers retry in BullMQ, but here in memory...
    // Let's throw to trigger 'failed' event
    throw error;
  }
}

// Create Worker
export const worker = new InMemoryWorker('oddsQueue', async (job: any) => {
  const { fixtureId, sport, isLive } = job.data;
  
  // Basic rate limiting delay (mimic 10 req/sec = 100ms delay)
  await new Promise(r => setTimeout(r, 200));

  // Check cache first via CacheService? 
  // CacheService doesn't expose 'get' easily without 'fetcher', 
  // but we can just fetch. fetchOddsFromApi handles logic.
  // Actually, let's optimize: check if we just fetched it.
  // But CacheService's getOrSetCache requires a fetcher.
  // We'll just call fetchOddsFromApi which will overwrite cache.
  // To avoid redundant API calls, we could add a check here if we had access to cache.
  // For now, simple is better.

  return await fetchOddsFromApi(sport, fixtureId, isLive);
}, {
  concurrency: 3, // Lower concurrency to be safe with API limits
});

// Link queue and worker
oddsQueue.setWorker(worker);

worker.on('completed', (job: any) => {
  // console.log(`[Worker] Job ${job.id} completed`);
});

worker.on('failed', (job: any, err: any) => {
  console.error(`[Worker] Job ${job?.id} failed: ${err.message}`);
});
