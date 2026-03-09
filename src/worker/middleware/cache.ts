
import { MiddlewareHandler } from 'hono';

interface CacheOptions {
  maxAge: number;
  staleWhileRevalidate?: number;
  isPrivate?: boolean;
}

export const cacheControl = (options: CacheOptions): MiddlewareHandler => async (c, next) => {
  await next();

  const { maxAge, staleWhileRevalidate, isPrivate = false } = options;

  if (isPrivate) {
    c.header('Cache-Control', 'private, no-store, no-cache, must-revalidate');
    return;
  }

  let value = `public, max-age=${maxAge}`;
  if (staleWhileRevalidate !== undefined) {
    value += `, stale-while-revalidate=${staleWhileRevalidate}`;
  }

  c.header('Cache-Control', value);
  c.header('CDN-Cache-Control', `max-age=${maxAge}`);
  c.header('Vary', 'Accept-Encoding');
  
  // Headers de compatibilidade
  c.header('Expires', new Date(Date.now() + maxAge * 1000).toUTCString());
};
