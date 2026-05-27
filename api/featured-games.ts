export default async function handler(req: any, res: any) {
  const origin = process.env.RAILWAY_ORIGIN || 'https://bet62aposta-production.up.railway.app';
  try {
    const u = new URL(String(req?.url || '/api/featured-games'), 'http://localhost');
    const upstream = new URL('/api/featured-games', origin);
    upstream.search = u.search;
    const r = await fetch(upstream.toString());
    const text = await r.text();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.statusCode = r.status;
    res.end(text);
  } catch {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.statusCode = 200;
    res.end(JSON.stringify([]));
  }
}
