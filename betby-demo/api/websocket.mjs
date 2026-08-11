import { WebSocket } from "ws";
import { ensureJwt, getJwt, getBrandId, getApiBase } from "../jwt-service.mjs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { appendFileSync, existsSync, mkdirSync } from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const LOG_DIR = join(__dirname, "..", ".dumps", "ws");
const DEFAULT_WS_BASE = "wss://api-h-c7818b61-608.sptpub.com";

function ensureLogDir() {
  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
}

function buildWsUrl(brandId, lang = "en") {
  return `${DEFAULT_WS_BASE}/api/v1/ws_new?brand_id=${brandId}&lang=${lang}`;
}

export class BetbyWsClient {
  constructor(options = {}) {
    this.options = {
      lang: "en",
      subscribeToLive: true,
      heartbeatMs: 25000,
      reconnectMs: 5000,
      maxReconnectTries: 20,
      log: false,
      ...options,
    };
    this.ws = null;
    this.heartbeatTimer = null;
    this.reconnectTimer = null;
    this.tries = 0;
    this.isClosed = false;
    this.handlers = {
      open: [],
      message: [],
      event: [],
      market: [],
      ping: [],
      error: [],
      close: [],
      handshake: [],
    };
    this.lastMessageAt = null;
    this.creds = null;
  }

  on(type, cb) {
    if (!this.handlers[type]) this.handlers[type] = [];
    this.handlers[type].push(cb);
    return () => this.off(type, cb);
  }

  off(type, cb) {
    if (!this.handlers[type]) return;
    this.handlers[type] = this.handlers[type].filter((f) => f !== cb);
  }

  emit(type, payload) {
    (this.handlers[type] || []).forEach((fn) => {
      try {
        fn(payload, this);
      } catch (e) {
        console.error(`[ws] handler error (${type}):`, e.message);
      }
    });
  }

  async connect(forceNewCreds = false) {
    this.creds = await ensureJwt(forceNewCreds);
    const jwt = getJwt() || this.creds?.jwt;
    const brandId = getBrandId() || this.creds?.brandId;
    if (!jwt || !brandId) throw new Error("Sem credenciais para conectar no WS");

    this.isClosed = false;
    const url = buildWsUrl(brandId, this.options.lang);
    if (this.options.log) console.log(`[ws] Conectando ${url.replace(DEFAULT_WS_BASE, "<WS>")}...`);

    this.ws = new WebSocket(url, {
      headers: {
        "User-Agent": "Bet62-Betby-Ws/1.0",
      },
    });

    this.ws.once("open", () => {
      this.tries = 0;
      if (this.options.log) console.log("[ws] open");
      this.send({
        action: "handshake",
        payload: { token: jwt },
      });
      this.startHeartbeat();
      this.emit("open", { brandId, jwt });
    });

    this.ws.on("message", (raw) => {
      this.lastMessageAt = Date.now();
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (this.options.log) {
        ensureLogDir();
        const ts = new Date().toISOString().slice(0, 10);
        const file = join(LOG_DIR, `${ts}.log`);
        appendFileSync(file, JSON.stringify({ t: new Date().toISOString(), msg }) + "\n");
      }

      const action = msg?.action || msg?.type;
      const payload = msg?.payload || msg?.data || msg;

      if (action === "handshake" || action === "handshake_ack" || payload?.ok) {
        if (this.options.log) console.log("[ws] handshake ok");
        this.emit("handshake", payload);
        if (this.options.subscribeToLive) {
          this.send({
            action: "subscribe",
            payload: { channel: "live_events" },
          });
          this.send({
            action: "subscribe",
            payload: { channel: "markets" },
          });
        }
      }

      if (action === "pong" || (action === "ping" && this.ws)) {
        if (action === "ping") this.send({ action: "pong" });
        this.emit("ping", payload);
      }

      if (action?.includes("event") || payload?.event_id || payload?.id) {
        this.emit("event", payload);
      }
      if (action?.includes("market") || payload?.market_id || payload?.odds) {
        this.emit("market", payload);
      }
      this.emit("message", { action, payload, raw: msg });
    });

    this.ws.on("error", (err) => {
      console.error(`[ws] error: ${err.message}`);
      this.emit("error", err);
    });

    this.ws.on("close", (code, reason) => {
      this.stopHeartbeat();
      if (this.options.log) console.log(`[ws] close code=${code} reason=${reason}`);
      this.emit("close", { code, reason: reason?.toString() });
      if (!this.isClosed) this.scheduleReconnect();
    });
  }

  send(obj) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(obj));
    return true;
  }

  startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (!this.send({ action: "ping" })) {
        console.warn("[ws] ping falhou, tentando recriar conexão...");
        this.ws?.terminate();
      }
    }, this.options.heartbeatMs);
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  scheduleReconnect() {
    if (this.isClosed) return;
    this.tries++;
    if (this.tries > this.options.maxReconnectTries) {
      console.error(`[ws] Máximo de retentativas (${this.options.maxReconnectTries}) excedido.`);
      this.isClosed = true;
      return;
    }
    console.log(`[ws] Tentando reconectar em ${this.options.reconnectMs}ms (t=${this.tries})`);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.connect(this.tries % 3 === 0), this.options.reconnectMs);
  }

  close() {
    this.isClosed = true;
    this.stopHeartbeat();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) {
      try {
        this.ws.close(1000, "client_close");
      } catch {}
      this.ws = null;
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const client = new BetbyWsClient({ log: true, subscribeToLive: true });
  client.on("handshake", () => console.log("[ws cli] Handshake concluído."));
  client.on("event", (ev) => {
    const id = ev.id || ev.event_id;
    console.log(`[ws cli] evento id=${id} home=${ev.home_name || ev.home?.name} away=${ev.away_name || ev.away?.name}`);
  });
  client.on("market", (m) => {
    console.log(`[ws cli] mercado m=${m.market_id || m.id} odds=${JSON.stringify(m.odds || m.price)}`);
  });
  client.connect().catch((e) => {
    console.error(e);
    process.exit(1);
  });

  process.on("SIGINT", () => {
    console.log("\n[ws cli] Encerrando...");
    client.close();
    process.exit(0);
  });
}
