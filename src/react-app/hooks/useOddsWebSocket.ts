import { useEffect, useMemo, useRef, useState } from 'react';
import { WS_BASE } from '@/react-app/utils/api';

type OddsMessage =
  | { type: 'connected' }
  | { type: 'subscribed'; id: string }
  | { type: 'odds'; id: string; markets?: Record<string, any[]>; home_odd?: number; draw_odd?: number; away_odd?: number; updated_at?: string; provider?: string }
  | { type: 'error'; error: string };

export function useOddsWebSocket(eventId: string, enabled: boolean) {
  const [markets, setMarkets] = useState<Record<string, any[]> | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number>(0);
  const wsRef = useRef<WebSocket | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const url = useMemo(() => {
    const base = String(WS_BASE || '').replace(/\/+$/, '');
    if (!base) return '';
    return `${base}/api/live/ws`;
  }, []);

  useEffect(() => {
    if (!enabled) return;
    if (!eventId) return;
    if (typeof window === 'undefined' || !('WebSocket' in window)) return;
    if (!url) return;

    let alive = true;
    let backoffMs = 400;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (tickRef.current) clearInterval(tickRef.current);
      tickRef.current = null;
      if (wsRef.current) {
        try { wsRef.current.close(); } catch { void 0; }
      }
      wsRef.current = null;
      setIsConnected(false);
    };

    const connect = () => {
      cleanup();
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!alive) return;
        backoffMs = 400;
        setIsConnected(true);
        try {
          ws.send(JSON.stringify({ type: 'subscribe_odds', id: eventId, realtime: 1 }));
        } catch { void 0; }
        if (tickRef.current) clearInterval(tickRef.current);
        tickRef.current = setInterval(() => {
          try { ws.send(JSON.stringify({ type: 'tick' })); } catch { void 0; }
        }, 1200);
      };

      ws.onmessage = (ev) => {
        if (!alive) return;
        try {
          const msg = JSON.parse(String(ev.data || '{}')) as OddsMessage;
          if (!msg || typeof msg !== 'object') return;
          if (msg.type === 'odds' && msg.id === eventId) {
            if (msg.markets && typeof msg.markets === 'object') setMarkets(msg.markets);
            else {
              const h2h: any[] = [];
              if (Number(msg.home_odd || 0) > 1) h2h.push({ name: 'Casa', label: 'Casa', odd: msg.home_odd, price: msg.home_odd });
              if (Number(msg.draw_odd || 0) > 1) h2h.push({ name: 'Empate', label: 'Empate', odd: msg.draw_odd, price: msg.draw_odd });
              if (Number(msg.away_odd || 0) > 1) h2h.push({ name: 'Fora', label: 'Fora', odd: msg.away_odd, price: msg.away_odd });
              if (h2h.length >= 2) setMarkets({ h2h });
            }
            setLastUpdatedAt(Date.now());
          }
        } catch { void 0; }
      };

      const scheduleReconnect = () => {
        if (!alive) return;
        cleanup();
        const ms = Math.min(10_000, backoffMs);
        backoffMs = Math.min(10_000, Math.floor(backoffMs * 1.7));
        reconnectTimer = setTimeout(connect, ms);
      };

      ws.onerror = () => {
        scheduleReconnect();
      };

      ws.onclose = () => {
        scheduleReconnect();
      };
    };

    connect();

    return () => {
      alive = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      cleanup();
    };
  }, [enabled, eventId, url]);

  return { markets, isConnected, lastUpdatedAt };
}

