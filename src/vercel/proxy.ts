type ProxyOptions = {
  targetBase: string;
  targetPath: string;
  passThroughSearch?: boolean;
};

async function readBodyAsArrayBuffer(req: any): Promise<ArrayBuffer | undefined> {
  const m = String(req.method || 'GET').toUpperCase();
  if (m === 'GET' || m === 'HEAD') return undefined;
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve());
    req.on('error', (e: any) => reject(e));
  });
  const buf = Buffer.concat(chunks);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

export async function proxyTo(req: any, res: any, opts: ProxyOptions) {
  const url = new URL(String(req.url || ''), 'http://localhost');
  const base = String(opts.targetBase || '').replace(/\/+$/, '');
  const path = String(opts.targetPath || '');
  const target = opts.passThroughSearch ? `${base}${path}${url.search || ''}` : `${base}${path}`;

  const body = await readBodyAsArrayBuffer(req);
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers || {})) {
    if (!v) continue;
    const key = String(k);
    const lk = key.toLowerCase();
    if (lk === 'host') continue;
    if (lk === 'content-length') continue;
    if (Array.isArray(v)) headers[key] = v.join(', ');
    else headers[key] = String(v);
  }

  const resp = await fetch(target, {
    method: String(req.method || 'GET'),
    headers,
    body,
  });

  res.statusCode = resp.status;
  resp.headers.forEach((value, key) => {
    const lk = key.toLowerCase();
    if (lk === 'transfer-encoding') return;
    res.setHeader(key, value);
  });

  const arr = new Uint8Array(await resp.arrayBuffer());
  res.end(Buffer.from(arr));
}

