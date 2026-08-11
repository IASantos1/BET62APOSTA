import { captureJwt, decodeJwt } from "./capture-jwt.mjs";
import { readFileSync, existsSync, writeFileSync, createReadStream, statSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join, extname, resolve } from "path";
import http from "http";
import { listenWithFallback } from "./scripts/port-utils.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CACHE_FILE = join(__dirname, ".betby-jwt.json");
const DEFAULT_BRAND_ID = "1653815133341880320";
const DEFAULT_LANG = "en";
const DEFAULT_API_BASE = "https://api-h-c7818b61-608.sptpub.com";
const DEFAULT_RENEW_BEFORE_SEC = 300;

const BETBY_UPSTREAM = "https://demo.betby.com";
const BETBY_API_UPSTREAM = DEFAULT_API_BASE;
const STATIC_ROOT = __dirname;
const SPORTSBOOK_DEFAULT =
  "/sportsbook/tile/?_gl=1*5b9qwe*_gcl_au*MTQ5NDg1NjMyOC4xNzg1NjkxODYy";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".mjs":  "application/javascript; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".svg":  "image/svg+xml",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif":  "image/gif",
  ".webp": "image/webp",
  ".ico":  "image/x-icon",
  ".woff": "font/woff",
  ".woff2":"font/woff2",
  ".ttf":  "font/ttf",
  ".map":  "application/json; charset=utf-8",
  ".txt":  "text/plain; charset=utf-8",
};

let currentCreds = loadCache();
let renewTimer = null;
let isRenewing = false;

function loadCache() {
  try {
    if (existsSync(CACHE_FILE)) {
      const raw = readFileSync(CACHE_FILE, "utf-8");
      return JSON.parse(raw);
    }
  } catch {}
  return null;
}

function saveCache(creds) {
  writeFileSync(CACHE_FILE, JSON.stringify(creds, null, 2));
}

function secondsUntilExpire(creds) {
  if (!creds?.payload?.exp) return 0;
  return Math.max(0, creds.payload.exp - Math.floor(Date.now() / 1000));
}

function isCredsValid(creds, marginSec = 60) {
  if (!creds?.jwt) return false;
  if (!creds.payload?.exp) return true;
  return secondsUntilExpire(creds) > marginSec;
}

export function getCurrentCreds(){ return currentCreds; }
export function getJwt(){ return currentCreds?.jwt || null; }
export function getBrandId(){ return currentCreds?.brandId || DEFAULT_BRAND_ID; }
export function getApiBase(){ return DEFAULT_API_BASE; }
export function isAuthenticated(marginSec = 120){ return isCredsValid(currentCreds, marginSec); }

async function renewIfNeeded(force = false) {
  if (isRenewing) return currentCreds;
  if (!force && isCredsValid(currentCreds, DEFAULT_RENEW_BEFORE_SEC)) return currentCreds;
  isRenewing = true;
  try {
    console.log(`[jwt-service] ${force ? "Renovação forçada" : "Renovando JWT..."}`);
    const result = await captureJwt({ headless: true, saveToDisk: false });
    if (result?.jwt) {
      currentCreds = { ...result, brandId: result.brandId || currentCreds?.brandId || DEFAULT_BRAND_ID };
      saveCache(currentCreds);
      console.log(`[jwt-service] JWT renovado. Expira em ${Math.round(secondsUntilExpire(currentCreds)/60)} min.`);
    } else {
      console.error("[jwt-service] Falha ao renovar JWT. Mantendo credencial atual.");
    }
  } catch (e) {
    console.error(`[jwt-service] Erro renovação: ${e.message}`);
  } finally {
    isRenewing = false;
  }
  return currentCreds;
}

export async function ensureJwt(force = false){ await renewIfNeeded(force); return currentCreds; }

function scheduleRenewal() {
  if (renewTimer) clearInterval(renewTimer);
  renewTimer = setInterval(() => renewIfNeeded(false), 60 * 1000);
  console.log("[jwt-service] Agendador de renovação iniciado (check a cada 60s).");
}

function sendLocalFile(res, relPath, status = 200) {
  const abs = resolve(STATIC_ROOT, relPath);
  if (!abs.startsWith(STATIC_ROOT)) { res.writeHead(403); return res.end(JSON.stringify({error:"forbidden"})); }
  try {
    const st = statSync(abs);
    if (!st.isFile()) throw new Error("not file");
    res.writeHead(status, {
      "Content-Type": MIME[extname(abs).toLowerCase()] || "application/octet-stream",
      "Content-Length": st.size,
      "Cache-Control": extname(abs) === ".html" ? "no-cache" : "public, max-age=300",
    });
    return createReadStream(abs).pipe(res);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("404 not found: " + relPath);
  }
}

function rewriteBetbyBody(text, hostHeader, reqProto) {
  const publicBase = `${reqProto}://${hostHeader}`;
  return text
    .replaceAll(/https?:\/\/demo\.betby\.com\//g, `${publicBase}/betby/`)
    .replaceAll(/\/\/demo\.betby\.com\//g, `//${hostHeader}/betby/`)
    .replaceAll(/"demo\.betby\.com"/g, `"${hostHeader}"`)
    .replaceAll(/https?:\/\/api-h-c7818b61-608\.sptpub\.com\//g, `${publicBase}/betby-api/`)
    .replaceAll(/\/\/api-h-c7818b61-608\.sptpub\.com\//g, `//${hostHeader}/betby-api/`);
}

function stripBlockingHeaders(headersIn, hostHeader) {
  const out = {};
  const blocked = new Set([
    "content-security-policy",
    "content-security-policy-report-only",
    "x-frame-options",
    "frame-options",
    "set-cookie",
    "strict-transport-security",
    "cross-origin-opener-policy",
    "cross-origin-opener-policy-report-only",
    "cross-origin-embedder-policy",
    "cross-origin-resource-policy",
    "content-length",
    "transfer-encoding",
    "connection",
    "host",
  ]);
  for (const [k, v] of Object.entries(headersIn)) {
    if (blocked.has(k.toLowerCase())) continue;
    out[k] = v;
  }
  out["Access-Control-Allow-Origin"] = "*";
  out["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS, PATCH";
  out["Access-Control-Allow-Headers"] = "Authorization, Content-Type, Accept, Origin, X-Requested-With";
  out["X-Frame-Options"] = "SAMEORIGIN";
  out["Referrer-Policy"] = "no-referrer-when-downgrade";
  return out;
}

async function proxyPass(req, res, upstreamBase, pathAndQuery, { host = null, authHeader = null, rewriteHtml = false, extraOutHeaders = {} } = {}) {
  const upstream = `${upstreamBase.replace(/\/$/, "")}${pathAndQuery}`;
  const proxyHeaders = {
    Host: host || new URL(upstreamBase).host,
    Accept: req.headers["accept"] || "*/*",
    "Accept-Encoding": "",
    "Accept-Language": req.headers["accept-language"] || "pt-BR,pt;q=0.9,en;q=0.8",
    "User-Agent": req.headers["user-agent"] || "Bet62-NodeProxy/1.0",
    Origin: upstreamBase,
    Referer: `${upstreamBase}/`,
    ...(authHeader ? { Authorization: authHeader } : {}),
  };
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : null;
  try {
    const r = await fetch(upstream, {
      method: req.method,
      headers: proxyHeaders,
      body,
      redirect: "manual",
    });
    let outStatus = r.status;
    if ([301,302,303,307,308].includes(r.status) && r.headers.get("location")) {
      let loc = r.headers.get("location");
      const hostHeader = req.headers["host"];
      const proto = (req.headers["x-forwarded-proto"] || "http");
      if (loc.startsWith(BETBY_UPSTREAM)) loc = `${proto}://${hostHeader}/betby${loc.slice(BETBY_UPSTREAM.length)}`;
      else if (loc.startsWith(BETBY_API_UPSTREAM)) loc = `${proto}://${hostHeader}/betby-api${loc.slice(BETBY_API_UPSTREAM.length)}`;
      extraOutHeaders["Location"] = loc;
    }
    const raw = await r.arrayBuffer();
    const ctype = (r.headers.get("content-type") || "").toLowerCase();
    let bodyOut = Buffer.from(raw);
    const isText = ctype.includes("text/") || ctype.includes("json") || ctype.includes("javascript") || ctype.includes("css") || ctype.includes("html");
    const hostHeader = req.headers["host"];
    const reqProto = (req.headers["x-forwarded-proto"] || "http");
    if (rewriteHtml && isText) {
      try {
        bodyOut = Buffer.from(rewriteBetbyBody(bodyOut.toString("utf8"), hostHeader, reqProto), "utf8");
      } catch {}
    }
    const finalHeaders = stripBlockingHeaders(Object.fromEntries(r.headers.entries()), hostHeader);
    finalHeaders["Content-Length"] = bodyOut.byteLength;
    if (isText && !finalHeaders["Content-Type"]) finalHeaders["Content-Type"] = ctype || "text/plain; charset=utf-8";
    res.writeHead(outStatus, { ...finalHeaders, ...extraOutHeaders });
    return res.end(bodyOut);
  } catch (e) {
    res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ error: "upstream_error", message: e.message, upstream }));
  }
}

export async function startJwtService(options = {}) {
  const { autoRenew = true, startHttpServer = true, port = 8787 } = options;

  if (!currentCreds) await renewIfNeeded(true);
  else await renewIfNeeded(false);

  if (autoRenew) scheduleRenewal();

  if (startHttpServer) {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, `http://${req.headers["host"] || "localhost"}`);
      const p = url.pathname;

      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "Access-Control-Allow-Origin":"*",
          "Access-Control-Allow-Methods":"GET, POST, PUT, DELETE, OPTIONS, PATCH",
          "Access-Control-Allow-Headers":"Authorization, Content-Type, Accept, Origin, X-Requested-With",
          "Access-Control-Max-Age":"86400",
        });
        return res.end();
      }

      // ===== Rotas de controle =====
      if (p === "/health") {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        return res.end(JSON.stringify({
          ok: true,
          authenticated: isAuthenticated(60),
          expiresInSec: secondsUntilExpire(currentCreds),
          brandId: getBrandId(),
          routes: [
            "/health", "/jwt", "/proxy/*", "/iframe.html", "/",
            "/betby/*", "/betby-api/*",
          ],
        }));
      }

      if (p === "/jwt") {
        const force = url.searchParams.get("force") === "1";
        if (force || !isAuthenticated(60)) await renewIfNeeded(force);
        res.writeHead(currentCreds?.jwt ? 200 : 503, { "Content-Type": "application/json; charset=utf-8" });
        return res.end(JSON.stringify({
          jwt: currentCreds?.jwt || null,
          brandId: getBrandId(),
          expiresInSec: secondsUntilExpire(currentCreds),
          issuedAt: currentCreds?.issuedAt || null,
          capturedAt: currentCreds?.capturedAt || null,
          sportsbookUrl: currentCreds?.sportsbookUrl || null,
          embedProxy: `http://${req.headers["host"]}/betby${SPORTSBOOK_DEFAULT}`,
        }));
      }

      if (p.startsWith("/proxy/")) {
        const targetPath = p.replace(/^\/proxy/, "");
        return proxyPass(req, res, BETBY_API_UPSTREAM, targetPath + url.search, {
          host: new URL(BETBY_API_UPSTREAM).host,
          authHeader: `Bearer ${getJwt()}`,
        });
      }

      // ===== Páginas estáticas locais =====
      if (p === "/" || p === "/index.html" || p === "/betby") {
        return sendLocalFile(res, "iframe.html");
      }
      if (p === "/iframe.html") {
        return sendLocalFile(res, "iframe.html");
      }

      // ===== Proxy BetBY UI (strip CSP, rewrite URLs) =====
      if (p === "/betby" || p.startsWith("/betby/")) {
        let realPath = p === "/betby" ? "/" : p.slice("/betby".length);
        if (realPath === "" || realPath === "/") realPath = SPORTSBOOK_DEFAULT;
        return proxyPass(req, res, BETBY_UPSTREAM, realPath + url.search, {
          host: "demo.betby.com",
          rewriteHtml: true,
        });
      }

      // ===== Proxy BetBY API sptpub =====
      if (p.startsWith("/betby-api/")) {
        const targetPath = p.replace(/^\/betby-api/, "");
        return proxyPass(req, res, BETBY_API_UPSTREAM, targetPath + url.search, {
          host: new URL(BETBY_API_UPSTREAM).host,
          authHeader: `Bearer ${getJwt()}`,
          rewriteHtml: false,
        });
      }

      // Fallback: servir arquivo estático local se existir
      const rel = p.replace(/^\//, "");
      if (rel && !rel.includes("..")) {
        const abs = resolve(STATIC_ROOT, rel);
        try { if (statSync(abs).isFile()) return sendLocalFile(res, rel); } catch {}
      }

      res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({
        error: "not_found",
        got: p,
        routes: {
          controle: ["/health", "/jwt?force=1", "/proxy/<path-sptpub>"],
          locais:  ["/", "/iframe.html"],
          "proxy-betby-ui":   "/betby/sportsbook/tile?… (CSP/X-Frame removidos, URLs reescritas)",
          "proxy-betby-api":  "/betby-api/<path> (Authorization: Bearer injetado)",
        },
      }));
    });

    await listenWithFallback(server, port, {
      label: "jwt-service",
      onListen: (p) => {
        const base = `http://localhost:${p}`;
        console.log(`[jwt-service]   ${base}/health          -> status / rotas`);
        console.log(`[jwt-service]   ${base}/jwt?force=1    -> retorna / renova JWT`);
        console.log(`[jwt-service]   ${base}/proxy/<path>   -> BetBY sptpub API`);
        console.log(`[jwt-service]   ${base}/iframe.html    -> página BET62 split local`);
        console.log(`[jwt-service]   ${base}/betby${SPORTSBOOK_DEFAULT}`);
        console.log(`[jwt-service]                     ^^^ Sportsbook PROXYADO (sem CSP / X-Frame!)`);
        console.log(`[jwt-service]   ${base}/betby-api/<p>  -> sptpub (Auth Bearer injetado)`);
      },
    });
  }

  return currentCreds;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || process.argv[2] || 8787);
  startJwtService({ port }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

export { secondsUntilExpire };
