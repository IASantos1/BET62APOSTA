import type http from 'http';
import type { Duplex } from 'stream';
import WebSocket, { WebSocketServer } from 'ws';
import { fetchSportsApiProLive } from '../services/sportsApiPro';

type ClientInfo = { ws: WebSocket; sport: string };

export function createLiveWs(apiKey: string) {
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Set<ClientInfo>();
  const timers = new Map<string, NodeJS.Timeout>();
  const lastSent = new Map<string, number>();

  const normalize = (s: string) => String(s || '').trim().toLowerCase() || 'all';

  const sendSnapshot = async (sport: string) => {
    const now = Date.now();
    const prev = lastSent.get(sport) || 0;
    if (now - prev < 2500) return;
    lastSent.set(sport, now);

    const sports = sport === 'all' ? ['soccer', 'tennis', 'basketball', 'ice-hockey', 'baseball'] : [sport];
    const liveAll: any[] = [];
    for (const s of sports) {
      const list = await fetchSportsApiProLive(apiKey, s).catch(() => []);
      const normalizedList = (Array.isArray(list) ? list : []).map((e: any) => {
        const id = String((e as any).id || '').trim() || String((e as any).external_event_id || '').split('_').pop() || '';
        return { ...e, id };
      });
      liveAll.push(...normalizedList.filter((e: any) => Number(e?.is_live || 0) === 1));
    }

    const msg = JSON.stringify({ type: 'snapshot', live: liveAll });
    for (const c of clients) {
      if (c.sport !== sport) continue;
      if (c.ws.readyState !== WebSocket.OPEN) continue;
      try {
        c.ws.send(msg);
      } catch {
        void 0;
      }
    }
  };

  const ensureTimer = (sport: string) => {
    if (timers.has(sport)) return;
    const id = setInterval(() => {
      sendSnapshot(sport).catch(() => null);
    }, 10_000);
    timers.set(sport, id);
    sendSnapshot(sport).catch(() => null);
  };

  const cleanupTimer = (sport: string) => {
    const any = Array.from(clients).some((c) => c.sport === sport && c.ws.readyState === WebSocket.OPEN);
    if (any) return;
    const t = timers.get(sport);
    if (t) clearInterval(t);
    timers.delete(sport);
  };

  wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
    const u = new URL(req.url || '', 'http://localhost');
    const sport = normalize(u.searchParams.get('sport') || 'all');
    const c: ClientInfo = { ws, sport };
    clients.add(c);
    ensureTimer(sport);

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(String(data || ''));
        if (msg?.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
        }
      } catch {
        void 0;
      }
    });

    ws.on('close', () => {
      clients.delete(c);
      cleanupTimer(sport);
    });
    ws.on('error', () => {
      clients.delete(c);
      cleanupTimer(sport);
    });
  });

  const handleUpgrade = (req: http.IncomingMessage, socket: Duplex, head: Buffer) => {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  };

  return { wss, handleUpgrade };
}

