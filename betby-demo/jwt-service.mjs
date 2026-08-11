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
const BETBY_DEMOAPI_UPSTREAM = "https://demoapi.betby.com";
const BETBY_STATIC_UPSTREAM = "https://bt-app-static-themes.sptpub.com";
const TRANSLATE_UPSTREAM = "https://translate.googleapis.com";
const STATIC_ROOT = __dirname;
const SPORTSBOOK_DEFAULT =
  "/sportsbook/tile/?_gl=1*5b9qwe*_gcl_au*MTQ5NDg1NjMyOC4xNzg1NjkxODYy";
const BETBY_TRACKER_DEFAULT_BUILD = "05d0f564";
const BETBY_TRACKER_PROVIDER_ID = "statscore";

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

function buildTrackerProviders({ eventId, sportId = 1, lang = DEFAULT_LANG, live = true, provider = BETBY_TRACKER_PROVIDER_ID }) {
  return { id: provider, sportId: String(sportId), lang, liveEvent: !!live, eventId: Number(eventId) };
}
function buildTrackerUrl({ eventId, sportId, lang, live, provider, build = BETBY_TRACKER_DEFAULT_BUILD, providers }) {
  const p = providers || buildTrackerProviders({ eventId, sportId, lang, live, provider });
  return `/${build}/tracker.html?providers=${encodeURIComponent(JSON.stringify(p))}`;
}

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
    .replaceAll(/\/\/api-h-c7818b61-608\.sptpub\.com\//g, `//${hostHeader}/betby-api/`)
    .replaceAll(/https?:\/\/demoapi\.betby\.com\//g, `${publicBase}/betby-tracker/`)
    .replaceAll(/\/\/demoapi\.betby\.com\//g, `//${hostHeader}/betby-tracker/`)
    .replaceAll(/https?:\/\/bt-app-static-themes\.sptpub\.com\//g, `${publicBase}/betby-static/`)
    .replaceAll(/\/\/bt-app-static-themes\.sptpub\.com\//g, `//${hostHeader}/betby-static/`)
    .replaceAll(/https?:\/\/translate\.googleapis\.com\//g, `${publicBase}/translate/`)
    .replaceAll(/\/\/translate\.googleapis\.com\//g, `//${hostHeader}/translate/`);
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
      else if (loc.startsWith(BETBY_DEMOAPI_UPSTREAM)) loc = `${proto}://${hostHeader}/betby-tracker${loc.slice(BETBY_DEMOAPI_UPSTREAM.length)}`;
      else if (loc.startsWith(BETBY_STATIC_UPSTREAM)) loc = `${proto}://${hostHeader}/betby-static${loc.slice(BETBY_STATIC_UPSTREAM.length)}`;
      else if (loc.startsWith(TRANSLATE_UPSTREAM)) loc = `${proto}://${hostHeader}/translate${loc.slice(TRANSLATE_UPSTREAM.length)}`;
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
            "/betby/*", "/betby-api/*", "/betby-api-v4/*",
            "/betby-static/*", "/translate/*",
            "/betby/api/v2/customisator/themes",
            "/betby-api-v4/api/v1/promo/widget/{brandId}/{lang}",
            "/tracker?eventId=&sportId=&lang=&live=",
            `/betby-tracker/{build}/tracker.html?providers=JSON  (Tracker StatScore BetBY, CSP/X-Frame stripado, URLs reescritas. Ex.: /betby-tracker/${BETBY_TRACKER_DEFAULT_BUILD}/tracker.html?providers=...)`,
          ],
        }));
      }

      if (p === "/jwt") {
        const force = url.searchParams.get("force") === "1";
        if (force || !isAuthenticated(60)) await renewIfNeeded(force);
        res.writeHead(currentCreds?.jwt ? 200 : 503, { "Content-Type": "application/json; charset=utf-8" });
        const sampleTrackerUrl = buildTrackerUrl({
          eventId: url.searchParams.get("eventId") || 6670958,
          sportId: url.searchParams.get("sportId") || 1,
          lang: url.searchParams.get("lang") || DEFAULT_LANG,
          live: url.searchParams.get("live") !== "false",
          provider: BETBY_TRACKER_PROVIDER_ID,
        });
        return res.end(JSON.stringify({
          jwt: currentCreds?.jwt || null,
          brandId: getBrandId(),
          expiresInSec: secondsUntilExpire(currentCreds),
          issuedAt: currentCreds?.issuedAt || null,
          capturedAt: currentCreds?.capturedAt || null,
          sportsbookUrl: currentCreds?.sportsbookUrl || null,
          embedProxy: `http://${req.headers["host"]}/betby${SPORTSBOOK_DEFAULT}`,
          customisatorThemes: `http://${req.headers["host"]}/betby/api/v2/customisator/themes`,
          promoWidget: `http://${req.headers["host"]}/betby-api-v4/api/v1/promo/widget/${getBrandId()}/en`,
          blueDarkTileTheme: `http://${req.headers["host"]}/betby-static/master/betby-demo-blue-dark-tile/theme.json`,
          trackerBuild: BETBY_TRACKER_DEFAULT_BUILD,
          trackerProvider: BETBY_TRACKER_PROVIDER_ID,
          trackerUrl: `http://${req.headers["host"]}/betby-tracker${sampleTrackerUrl}`,
          trackerShortcut: `http://${req.headers["host"]}/tracker?eventId=6670958&sportId=1&lang=en&live=1`,
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

      // ===== CDN estático sptpub (bt-app-static-themes) =====
      if (p.startsWith("/betby-static/")) {
        const targetPath = p.replace(/^\/betby-static/, "");
        return proxyPass(req, res, BETBY_STATIC_UPSTREAM, targetPath + url.search, {
          host: "bt-app-static-themes.sptpub.com",
          rewriteHtml: false,
        });
      }

      // ===== Rota atalho /tracker?eventId=X&sportId=Y&lang=Z&live=1&provider=statscore (302) =====
      if (p === "/tracker") {
        const b = url.searchParams.get("build") || BETBY_TRACKER_DEFAULT_BUILD;
        const rawProviders = url.searchParams.get("providers");
        const trackerUpstream = rawProviders
          ? `/${b}/tracker.html?providers=${rawProviders}`
          : buildTrackerUrl({
              eventId: url.searchParams.get("eventId"),
              sportId: url.searchParams.get("sportId") || 1,
              lang: url.searchParams.get("lang") || DEFAULT_LANG,
              live: url.searchParams.get("live") === null || url.searchParams.get("live") === "1" || url.searchParams.get("live") === "true",
              provider: url.searchParams.get("provider") || BETBY_TRACKER_PROVIDER_ID,
              build: b,
            });
        const redirectTo = `http://${req.headers["host"]}/betby-tracker${trackerUpstream}`;
        res.writeHead(302, { "Location": redirectTo, "Cache-Control": "no-store" });
        return res.end(JSON.stringify({
          ok: 1,
          providers: (() => {
            try { return rawProviders ? JSON.parse(decodeURIComponent(rawProviders)) : buildTrackerProviders({
              eventId: url.searchParams.get("eventId"),
              sportId: url.searchParams.get("sportId") || 1,
              lang: url.searchParams.get("lang") || DEFAULT_LANG,
              live: url.searchParams.get("live") === null || url.searchParams.get("live") === "1" || url.searchParams.get("live") === "true",
              provider: url.searchParams.get("provider") || BETBY_TRACKER_PROVIDER_ID,
            }); } catch { return null; }
          })(),
          redirect: redirectTo,
        }));
      }

      // ===== Proxy BetBY Tracker StatScore (demoapi.betby.com/<build>/tracker.html?providers=...) =====
      // IMPORTANTE: vem ANTES de /betby-api-v4/* pois o tracker é HTML/JS e precisa rewriteHtml=true
      //   e é servido SEM Bearer (público via demoapi.betby.com URL colada pelo usuário)
      if (p.startsWith("/betby-tracker/")) {
        const targetPath = p.replace(/^\/betby-tracker/, "");
        return proxyPass(req, res, BETBY_DEMOAPI_UPSTREAM, targetPath + url.search, {
          host: "demoapi.betby.com",
          rewriteHtml: true,
        });
      }

      // ===== Google Translate (anti-CORS) =====
      if (p === "/translate" || p.startsWith("/translate/")) {
        const targetPath = p === "/translate" ? "/" : p.slice("/translate".length);
        return proxyPass(req, res, TRANSLATE_UPSTREAM, targetPath + url.search, {
          host: "translate.googleapis.com",
          rewriteHtml: false,
        });
      }

      // ===== Promo Widget (demoapi) =====
      if (p.startsWith("/betby-api-v4/api/v1/promo/widget/")) {
        const targetPath = p.replace(/^\/betby-api-v4/, "");
        return proxyPass(req, res, BETBY_DEMOAPI_UPSTREAM, targetPath + url.search, {
          host: "demoapi.betby.com",
          authHeader: `Bearer ${getJwt()}`,
          rewriteHtml: false,
        });
      }

      // ===== Customisator Themes (demo.betby.com) =====
      if (p.startsWith("/betby/api/v2/customisator/")) {
        const targetPath = p.replace(/^\/betby/, "");
        return proxyPass(req, res, BETBY_UPSTREAM, targetPath + url.search, {
          host: "demo.betby.com",
          authHeader: `Bearer ${getJwt()}`,
          rewriteHtml: false,
        });
      }

      // ===== Proxy BetBY API v4 demoapi.betby.com =====
      if (p.startsWith("/betby-api-v4/")) {
        const targetPath = p.replace(/^\/betby-api-v4/, "");
        return proxyPass(req, res, BETBY_DEMOAPI_UPSTREAM, targetPath + url.search, {
          host: "demoapi.betby.com",
          authHeader: `Bearer ${getJwt()}`,
          rewriteHtml: false,
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
          "proxy-betby-api":  "/betby-api/<path> (sptpub, Authorization: Bearer injetado)",
          "proxy-betby-demoapi-v4": "/betby-api-v4/api/v4/<path> (demoapi.betby.com, v4 live/prematch, Bearer injetado)",
          "proxy-betby-promo":  "/betby-api-v4/api/v1/promo/widget/<brandId>/<lang>",
          "proxy-betby-custom": "/betby/api/v2/customisator/themes",
          "proxy-betby-static": "/betby-static/master/betby-demo-blue-dark-tile/theme.json  (CDN sptpub)",
          "proxy-translate":    "/translate/_/translate_http/… (Google Translate, anti-CORS)",
          "betby-tracker-live": `/betby-tracker/${BETBY_TRACKER_DEFAULT_BUILD}/tracker.html?providers=JSON  (Tracker StatScore, rewrite URLs) ou atalho: /tracker?eventId=<ID>&sportId=1&lang=en&live=1`,
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
        console.log(`[jwt-service]   ${base}/betby-api-v4/<p> -> demoapi.betby.com (v4 live/prematch, Auth Bearer injetado)`);
        console.log(`[jwt-service]   ${base}/betby-static/master/betby-demo-blue-dark-tile/theme.json  <- tema tile`);
        console.log(`[jwt-service]   ${base}/betby/api/v2/customisator/themes`);
        console.log(`[jwt-service]   ${base}/betby-api-v4/api/v1/promo/widget/${DEFAULT_BRAND_ID}/en`);
        console.log(`[jwt-service]   ${base}/translate/* -> Google Translate (anti-CORS)`);
        console.log(`[jwt-service]   ${base}/tracker?eventId=6670958&sportId=1&lang=en&live=1  (atalho 302)`);
        console.log(`[jwt-service]   ${base}/betby-tracker/${BETBY_TRACKER_DEFAULT_BUILD}/tracker.html?providers=…  ← Tracker StatScore BetBY (sem CSP / X-Frame!)`);
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
