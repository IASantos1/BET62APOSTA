import { captureJwt, decodeJwt } from "./capture-jwt.mjs";
import { readFileSync, existsSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import http from "http";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CACHE_FILE = join(__dirname, ".betby-jwt.json");
const DEFAULT_BRAND_ID = "1653815133341880320";
const DEFAULT_LANG = "en";
const DEFAULT_API_BASE = "https://api-h-c7818b61-608.sptpub.com";
const DEFAULT_RENEW_BEFORE_SEC = 300;

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

export function getCurrentCreds() {
  return currentCreds;
}

export function getJwt() {
  return currentCreds?.jwt || null;
}

export function getBrandId() {
  return currentCreds?.brandId || DEFAULT_BRAND_ID;
}

export function getApiBase() {
  return DEFAULT_API_BASE;
}

export function isAuthenticated(marginSec = 120) {
  return isCredsValid(currentCreds, marginSec);
}

async function renewIfNeeded(force = false) {
  if (isRenewing) return currentCreds;
  if (!force && isCredsValid(currentCreds, DEFAULT_RENEW_BEFORE_SEC)) {
    return currentCreds;
  }
  isRenewing = true;
  try {
    console.log(`[jwt-service] ${force ? "Renovação forçada" : "Renovando JWT..."}`);
    const result = await captureJwt({ headless: true, saveToDisk: false });
    if (result?.jwt) {
      currentCreds = {
        ...result,
        brandId: result.brandId || currentCreds?.brandId || DEFAULT_BRAND_ID,
      };
      saveCache(currentCreds);
      console.log(
        `[jwt-service] JWT renovado. Expira em ${Math.round(
          secondsUntilExpire(currentCreds) / 60
        )} min.`
      );
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

export async function ensureJwt(force = false) {
  await renewIfNeeded(force);
  return currentCreds;
}

function scheduleRenewal() {
  if (renewTimer) clearInterval(renewTimer);
  renewTimer = setInterval(() => {
    renewIfNeeded(false);
  }, 60 * 1000);
  console.log("[jwt-service] Agendador de renovação iniciado (check a cada 60s).");
}

export async function startJwtService(options = {}) {
  const { autoRenew = true, startHttpServer = true, port = 8787 } = options;

  if (!currentCreds) {
    await renewIfNeeded(true);
  } else {
    await renewIfNeeded(false);
  }

  if (autoRenew) scheduleRenewal();

  if (startHttpServer) {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, `http://localhost:${port}`);

      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Content-Type", "application/json; charset=utf-8");

      if (url.pathname === "/health") {
        res.writeHead(200);
        return res.end(
          JSON.stringify({
            ok: true,
            authenticated: isAuthenticated(60),
            expiresInSec: secondsUntilExpire(currentCreds),
            brandId: getBrandId(),
          })
        );
      }

      if (url.pathname === "/jwt") {
        const force = url.searchParams.get("force") === "1";
        if (force || !isAuthenticated(60)) {
          await renewIfNeeded(force);
        }
        res.writeHead(currentCreds?.jwt ? 200 : 503);
        return res.end(
          JSON.stringify({
            jwt: currentCreds?.jwt || null,
            brandId: getBrandId(),
            expiresInSec: secondsUntilExpire(currentCreds),
            issuedAt: currentCreds?.issuedAt || null,
            capturedAt: currentCreds?.capturedAt || null,
            sportsbookUrl: currentCreds?.sportsbookUrl || null,
          })
        );
      }

      if (url.pathname.startsWith("/proxy/")) {
        const targetPath = url.pathname.replace(/^\/proxy/, "");
        const upstream = `${DEFAULT_API_BASE}${targetPath}${url.search}`;
        try {
          const headers = {
            Authorization: `Bearer ${getJwt()}`,
            Accept: "application/json",
            "User-Agent": "Bet62-Betby-Proxy/1.0",
          };
          const r = await fetch(upstream, { headers });
          const body = await r.text();
          res.writeHead(r.status, { "Content-Type": r.headers.get("content-type") || "application/json" });
          return res.end(body);
        } catch (e) {
          res.writeHead(502);
          return res.end(JSON.stringify({ error: "upstream_error", message: e.message }));
        }
      }

      res.writeHead(404);
      res.end(JSON.stringify({ error: "not_found", routes: ["/health", "/jwt", "/proxy/*"] }));
    });

    server.listen(port, () => {
      console.log(`[jwt-service] HTTP rodando em http://localhost:${port}`);
      console.log(`[jwt-service]   GET /health     -> status do JWT`);
      console.log(`[jwt-service]   GET /jwt?force=1 -> retorna/renova JWT`);
      console.log(`[jwt-service]   GET /proxy/<path> -> proxy para BetBY API`);
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
