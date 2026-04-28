function sendJson(res: any, status: number, payload: any) {
  res.statusCode = status;
  if (typeof res.setHeader === 'function') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
  }
  res.end(JSON.stringify(payload));
}

export default async function handler(req: any, res: any) {
  const method = String(req?.method || 'GET').toUpperCase();
  if (method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  sendJson(res, 200, { user: null });
}
