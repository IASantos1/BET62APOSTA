export default function handler(_req: any, res: any) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.statusCode = 200;
  res.end(JSON.stringify({ status: 'ok', ts: new Date().toISOString() }));
}
