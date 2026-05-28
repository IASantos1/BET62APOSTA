import type http from 'http';
import type { Duplex } from 'stream';
import WebSocket, { WebSocketServer } from 'ws';
import { fetchSportsApiProLive } from '../services/sportsApiPro';

type ClientInfo = { ws: WebSocket; sport: string };
type UpstreamInfo = {
  localSport: string;
  wsSport: string;
  ws: WebSocket | null;
  backoffMs: number;
  connecting: boolean;
  stopped: boolean;
  lastMessageAt: number;
  pingTimer: NodeJS.Timeout | null;
};

export function createLiveWs(apiKey: string) {
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Set<ClientInfo>();
  const timers = new Map<string, NodeJS.Timeout>();
  const lastSent = new Map<string, number>();
  const upstreams = new Map<string, UpstreamInfo>();
  const SPORTS_DEFAULT = ['soccer', 'tennis', 'basketball', 'ice-hockey', 'baseball'];

  const normalize = (s: string) => String(s || '').trim().toLowerCase() || 'all';

  const toWsSport = (localSport: string): string => {
    const s = String(localSport || '').trim().toLowerCase();
    if (s === 'soccer') return 'football';
    if (s === 'ice-hockey') return 'ice-hockey';
    return s;
  };

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

  const connectUpstream = (sport: string) => {
    const localSport = String(sport || '').trim().toLowerCase();
    if (!localSport || localSport === 'all') return;
    const wsSport = toWsSport(localSport);
    const existing = upstreams.get(localSport);
    if (existing && (existing.connecting || (existing.ws && existing.ws.readyState === WebSocket.OPEN))) return;

    const u: UpstreamInfo = existing || {
      localSport,
      wsSport,
      ws: null,
      backoffMs: 1000,
      connecting: false,
      stopped: false,
      lastMessageAt: 0,
      pingTimer: null,
    };
    u.connecting = true;
    u.stopped = false;
    upstreams.set(localSport, u);

    const url = `wss://v2.${wsSport}.sportsapipro.com/ws?x-api-key=${encodeURIComponent(apiKey)}`;
    const ws = new WebSocket(url, { headers: { 'x-sport': wsSport } as any });
    u.ws = ws;

    ws.on('open', () => {
      u.connecting = false;
      u.backoffMs = 1000;
      try {
        ws.send(JSON.stringify({ action: 'subscribe', channel: 'live-scores' }));
      } catch {
        void 0;
      }
      if (u.pingTimer) clearInterval(u.pingTimer);
      u.pingTimer = setInterval(() => {
        if (!u.ws || u.ws.readyState !== WebSocket.OPEN) return;
        try {
          u.ws.send(JSON.stringify({ action: 'ping', channel: 'live-scores' }));
        } catch {
          void 0;
        }
      }, 30_000);
      sendSnapshot(localSport).catch(() => null);
    });

    ws.on('message', () => {
      u.lastMessageAt = Date.now();
      sendSnapshot(localSport).catch(() => null);
      sendSnapshot('all').catch(() => null);
    });

    const scheduleReconnect = () => {
      if (u.stopped) return;
      if (u.pingTimer) {
        clearInterval(u.pingTimer);
        u.pingTimer = null;
      }
      const delay = Math.min(20_000, Math.max(1000, u.backoffMs));
      u.backoffMs = Math.min(20_000, u.backoffMs * 2);
      setTimeout(() => {
        const stillNeeded = Array.from(clients).some((c) => c.sport === localSport || c.sport === 'all');
        if (!stillNeeded) return;
        connectUpstream(localSport);
      }, delay);
    };

    ws.on('close', scheduleReconnect);
    ws.on('error', scheduleReconnect);
  };

  const stopUpstreamIfUnused = (sport: string) => {
    const localSport = String(sport || '').trim().toLowerCase();
    if (!localSport || localSport === 'all') return;
    const any = Array.from(clients).some((c) => c.sport === localSport || c.sport === 'all');
    if (any) return;
    const u = upstreams.get(localSport);
    if (!u) return;
    u.stopped = true;
    if (u.pingTimer) {
      clearInterval(u.pingTimer);
      u.pingTimer = null;
    }
    if (u.ws) {
      try {
        u.ws.close();
      } catch {
        void 0;
      }
      u.ws = null;
    }
  };

  const ensureTimer = (sport: string) => {
    if (timers.has(sport)) return;
    if (sport === 'all') {
      for (const s of SPORTS_DEFAULT) connectUpstream(s);
    } else {
      connectUpstream(sport);
    }
    const id = setInterval(() => {
      sendSnapshot(sport).catch(() => null);
    }, 20_000);
    timers.set(sport, id);
    sendSnapshot(sport).catch(() => null);
  };

  const cleanupTimer = (sport: string) => {
    const any = Array.from(clients).some((c) => c.sport === sport && c.ws.readyState === WebSocket.OPEN);
    if (any) return;
    const t = timers.get(sport);
    if (t) clearInterval(t);
    timers.delete(sport);
    if (sport === 'all') {
      for (const s of SPORTS_DEFAULT) stopUpstreamIfUnused(s);
    } else {
      stopUpstreamIfUnused(sport);
    }
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
