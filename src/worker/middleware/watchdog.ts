import { MiddlewareHandler } from 'hono';

export const watchdog: MiddlewareHandler = async (c, next) => {
  const start = Date.now();
  const isInternal = c.req.path.startsWith('/api/internal/');
  const timeoutMs = isInternal ? 120_000 : 45_000; // 120s for internal sync, 45s for user requests

  try {
    const res = await Promise.race([
      next(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Request watchdog timeout')), timeoutMs)
      ),
    ]);

    console.log(
      `[OK] ${c.req.method} ${c.req.path} (${Date.now() - start}ms)`
    );

    return res as Response;
  } catch (err: any) {
    console.error(
      `[FREEZE] ${c.req.method} ${c.req.path}`,
      err.message
    );

    return c.json(
      {
        error: 'Request timeout',
        path: c.req.path,
      },
      504
    );
  }
};
