import type http from 'http';

export async function readJsonBody<T = any>(req: http.IncomingMessage, maxBytes = 0): Promise<T> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (maxBytes > 0 && total > maxBytes) throw new Error('Payload too large');
    chunks.push(buf);
  }
  if (chunks.length === 0) return {} as T;
  const raw = Buffer.concat(chunks).toString('utf-8').trim();
  if (!raw) return {} as T;
  return JSON.parse(raw) as T;
}

export function sendJson(res: http.ServerResponse, status: number, body: any): void {
  const json = JSON.stringify(body ?? {});
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(json);
}

export function sendText(res: http.ServerResponse, status: number, body: string): void {
  res.statusCode = status;
  res.setHeader('content-type', 'text/plain; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(body);
}

export function notFound(res: http.ServerResponse): void {
  sendJson(res, 404, { error: 'Not found' });
}

export function methodNotAllowed(res: http.ServerResponse): void {
  sendJson(res, 405, { error: 'Method not allowed' });
}

export function badRequest(res: http.ServerResponse, message: string): void {
  sendJson(res, 400, { error: message });
}

export function payloadTooLarge(res: http.ServerResponse, message = 'Payload too large'): void {
  sendJson(res, 413, { error: message });
}

export function unauthorized(res: http.ServerResponse): void {
  sendJson(res, 401, { error: 'Unauthorized' });
}

export function forbid(res: http.ServerResponse): void {
  sendJson(res, 403, { error: 'Forbidden' });
}

