import { useEffect, useMemo, useState } from 'react';
import { startSse } from '../utils/sse';

type LiveStreamMessage =
  | { type: 'hello' }
  | { type: 'ping' }
  | { type: 'bye' }
  | { type: 'error'; error: string }
  | { type: 'live'; updates: any[] };

export function useLiveSSEUpdates(sport: string, enabled: boolean) {
  const [updatesById, setUpdatesById] = useState<Map<string, any>>(new Map());
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number>(0);

  const url = useMemo(() => {
    const s = String(sport || 'all').trim();
    return `/api/live/stream?sports=${encodeURIComponent(s)}`;
  }, [sport]);

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === 'undefined') return;

    const stop = startSse<LiveStreamMessage>(url, (msg) => {
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
    });

    return () => stop();
  }, [enabled, url]);

  return { updatesById, lastUpdatedAt };
}
