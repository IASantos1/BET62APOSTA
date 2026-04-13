export type SseHandler<T> = (msg: T) => void;

export function startSse<T = any>(
  url: string,
  onMessage: SseHandler<T>,
  opts?: { retryMs?: number; maxRetryMs?: number }
) {
  const initialRetry = Math.max(50, Number(opts?.retryMs ?? 500));
  const maxRetry = Math.max(initialRetry, Number(opts?.maxRetryMs ?? 5000));
  const ac = new AbortController();
  let stopped = false;

  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  const run = async () => {
    let retry = initialRetry;
    while (!stopped) {
      try {
        const res = await fetch(url, {
          method: 'GET',
          headers: { Accept: 'text/event-stream' },
          cache: 'no-store',
          signal: ac.signal,
        });
        if (!res.ok) throw new Error(`sse_status_${res.status}`);
        const body = res.body;
        if (!body || typeof (body as any).getReader !== 'function') throw new Error('sse_no_body');

        const reader = body.getReader();
        const dec = new TextDecoder();
        let buf = '';

        while (!stopped) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          buf = buf.replace(/\r/g, '');
          let sep = buf.indexOf('\n\n');
          while (sep >= 0) {
            const chunk = buf.slice(0, sep);
            buf = buf.slice(sep + 2);
            const dataLines = chunk
              .split('\n')
              .filter((l) => l.startsWith('data:'))
              .map((l) => l.slice(5).trimStart());
            if (dataLines.length === 0) continue;
            const payload = dataLines.join('\n').trim();
            if (!payload) continue;
            try {
              onMessage(JSON.parse(payload) as T);
            } catch {
              void 0;
            }
            sep = buf.indexOf('\n\n');
          }
        }

        retry = initialRetry;
      } catch (e: any) {
        if (stopped) break;
        const name = String(e?.name || '');
        const msg = String(e?.message || '');
        const isAbort = name === 'AbortError' || /aborted|abort/i.test(msg);
        if (isAbort) break;
      }

      if (!stopped) {
        await sleep(retry);
        retry = Math.min(maxRetry, Math.round(retry * 1.5));
      }
    }
  };

  run();

  return () => {
    stopped = true;
    try { ac.abort(); } catch { void 0; }
  };
}
