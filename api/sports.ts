export default async function handler(_req: any, res: any) {
  const origin = process.env.RAILWAY_ORIGIN || 'https://bet62aposta-production.up.railway.app';
  try {
    const r = await fetch(`${origin}/api/sports`);
    const text = await r.text();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.statusCode = r.status;
    res.end(text);
  } catch {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.statusCode = 200;
    res.end(
      JSON.stringify([
        { id: 'soccer', name: 'Futebol', active: true },
        { id: 'basketball', name: 'Basquetebol', active: true },
        { id: 'tennis', name: 'Tênis', active: true },
        { id: 'ice-hockey', name: 'Hóquei no Gelo', active: true },
      ]),
    );
  }
}
