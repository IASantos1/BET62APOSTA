import { useEffect, useMemo, useState } from 'react';

type LiveStreamMessage =
  | { type: 'hello' }
  | { type: 'ping' }
  | { type: 'bye' }
  | { type: 'error'; error: string }
  | { type: 'live'; updates: any[] };

export function useLiveSSEUpdates(sport: string, enabled: boolean) {
  const [updatesById, setUpdatesById] = useState<Map<string, any>>(new Map());
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number>(0);
  const [nonce, setNonce] = useState(0);

  const url = useMemo(() => {
    const s = String(sport || 'all').trim();
    return `/api/live/stream?sports=${encodeURIComponent(s)}`;
  }, [sport]);

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === 'undefined' || !('EventSource' in window)) return;

    let alive = true;
    const es = new EventSource(url);
    es.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data || '{}')) as LiveStreamMessage;
        if (!msg || typeof msg !== 'object') return;
        if (msg.type === 'live' && Array.isArray((msg as any).updates)) {
          const arr = (msg as any).updates as any[];
          setUpdatesById((prev) => {
            const next = new Map(prev);
            for (const u of arr) {
              const id = String(u?.id || u?.external_event_id || '');
              if (!id) continue;
              next.set(id, u);
            }
            return next;
          });
          setLastUpdatedAt(Date.now());
        }
        if (msg.type === 'bye') {
          try { es.close(); } catch { void 0; }
          setTimeout(() => { if (alive) setNonce((n) => n + 1); }, 150);
        }
      } catch { void 0; }
    };

    es.onerror = () => {
      try { es.close(); } catch { void 0; }
      setTimeout(() => { if (alive) setNonce((n) => n + 1); }, 700);
    };

    return () => {
      alive = false;
      try { es.close(); } catch { void 0; }
    };
  }, [enabled, url, nonce]);

  return { updatesById, lastUpdatedAt };
}
