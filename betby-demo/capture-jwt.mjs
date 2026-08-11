import { writeFileSync, existsSync, mkdirSync, readdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const LOCAL_DIR = resolve(__dirname, ".playwright-browsers");
const GLOBAL_DIR = join(process.env.LOCALAPPDATA || join(process.env.USERPROFILE || "~", "AppData", "Local"), "ms-playwright");

function hasPwArtifacts(dir) {
  if (!existsSync(dir)) return false;
  try {
    return readdirSync(dir).some((n) =>
      /^chromium(-headless-shell)?-\d+$/.test(n) ||
      /^firefox-\d+$/.test(n) || /^webkit-\d+$/.test(n) ||
      /^ffmpeg-\d+$/.test(n) || /^winldd-\d+$/.test(n));
  } catch { return false; }
}

const PICKED = (() => {
  const L = hasPwArtifacts(LOCAL_DIR), G = hasPwArtifacts(GLOBAL_DIR);
  if (L && !G) return LOCAL_DIR;
  if (G) return GLOBAL_DIR;
  if (L) return LOCAL_DIR;
  try { mkdirSync(LOCAL_DIR, { recursive: true }); } catch {}
  return LOCAL_DIR;
})();
try { mkdirSync(PICKED, { recursive: true }); } catch {}
process.env.PLAYWRIGHT_BROWSERS_PATH = PICKED;
process.env.PLAYWRIGHT_SKIP_BROWSER_GC = "1";

const { chromium } = await import("playwright");

const BETBY_DEMO_URL = "https://demo.betby.com";
const BETBY_SPORTSBOOK_URL =
  "https://demo.betby.com/sportsbook/tile/?_gl=1*5b9qwe*_gcl_au*MTQ5NDg1NjMyOC4xNzg1NjkxODYy";
const OUTPUT_FILE = join(__dirname, ".betby-jwt.json");
const TARGET_HEADERS = ["/api/v2/player", "/api/v3/", "/api/v4/"];

function decodeJwt(token) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1], "base64").toString("utf-8"));
    return payload;
  } catch {
    return null;
  }
}

function extractBrandId(payload) {
  if (!payload) return null;
  return (
    payload.brand_id ||
    payload.brandId ||
    payload["https://betby.com/brand_id"] ||
    payload.bid ||
    null
  );
}

function saveResult(jwt, payload, brandId, capturedAt) {
  const expiresAt = payload?.exp ? new Date(payload.exp * 1000).toISOString() : null;
  const issuedAt = payload?.iat ? new Date(payload.iat * 1000).toISOString() : null;

  const data = {
    jwt,
    brandId: brandId || "1653815133341880320",
    capturedAt,
    issuedAt,
    expiresAt,
    payload: payload || {},
    sportsbookUrl: BETBY_SPORTSBOOK_URL,
    demoUrl: BETBY_DEMO_URL,
  };

  if (!existsSync(__dirname)) mkdirSync(__dirname, { recursive: true });
  writeFileSync(OUTPUT_FILE, JSON.stringify(data, null, 2));
  return data;
}

function resolveHeadlessMode(h) {
  if (h === false) return false;
  if (h === "new" || h === "chrome") return h;
  return "new";
}

async function captureJwt(options = {}) {
  const { headless = true, timeoutMs = 15000, saveToDisk = true } = options;
  const headlessMode = resolveHeadlessMode(headless);

  console.log(`[betby] Launching Chromium (headless=${headlessMode})...`);
  const browser = await chromium.launch({ headless: headlessMode });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  let jwt = null;
  let capturedAt = null;
  let resolvedFrom = null;

  page.on("request", (request) => {
    const url = request.url();
    if (!jwt && TARGET_HEADERS.some((h) => url.includes(h))) {
      const auth = request.headers()["authorization"];
      if (auth?.startsWith("Bearer ")) {
        jwt = auth.slice(7);
        capturedAt = new Date().toISOString();
        resolvedFrom = `request:${url}`;
        console.log(`[betby] JWT capturado via ${resolvedFrom}`);
      }
    }
  });

  page.on("response", async (response) => {
    if (jwt) return;
    try {
      const ct = response.headers()["content-type"] || "";
      if (ct.includes("json")) {
        const text = await response.text().catch(() => "");
        const match = text.match(/"jwt"\s*:\s*"([^"]+)"/) || text.match(/"token"\s*:\s*"([^"]+)"/);
        if (match) {
          jwt = match[1];
          capturedAt = new Date().toISOString();
          resolvedFrom = `response:${response.url()}`;
          console.log(`[betby] JWT capturado via body de resposta`);
        }
      }
    } catch {}
  });

  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  try {
    console.log(`[betby] Navegando para ${BETBY_SPORTSBOOK_URL} ...`);
    await page.goto(BETBY_SPORTSBOOK_URL, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    while (Date.now() < deadline && !jwt) {
      await page.waitForTimeout(500);
      if (!jwt) {
        try {
          const evalJwt = await page.evaluate(() => {
            try {
              return (
                window.__BETBY_JWT__ ||
                window.__JWT__ ||
                window.localStorage.getItem("betby_jwt") ||
                window.localStorage.getItem("jwt") ||
                window.sessionStorage.getItem("betby_jwt") ||
                null
              );
            } catch {
              return null;
            }
          });
          if (evalJwt && !jwt) {
            jwt = evalJwt;
            capturedAt = new Date().toISOString();
            resolvedFrom = "window/localStorage";
          }
        } catch (e) {
          lastError = e.message;
        }
      }
    }
  } catch (e) {
    lastError = e.message;
    console.error(`[betby] Erro durante navegação: ${e.message}`);
  }

  await browser.close();

  if (!jwt) {
    console.error("[betby] JWT NÃO ENCONTRADO após timeout.");
    if (lastError) console.error(`[betby] Último erro: ${lastError}`);
    return null;
  }

  const payload = decodeJwt(jwt);
  const brandId = extractBrandId(payload);

  console.log(`[betby] JWT OK (${jwt.length} chars) — origem: ${resolvedFrom}`);
  if (brandId) console.log(`[betby] brand_id extraído: ${brandId}`);
  if (payload?.exp) {
    const secs = Math.max(0, payload.exp - Math.floor(Date.now() / 1000));
    console.log(`[betby] Expira em ${Math.round(secs / 60)} minutos`);
  }

  if (saveToDisk) {
    const saved = saveResult(jwt, payload, brandId, capturedAt);
    console.log(`[betby] Credenciais salvas em ${OUTPUT_FILE}`);
    return saved;
  }

  return { jwt, payload, brandId, capturedAt, resolvedFrom };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const headless = !process.argv.includes("--headed");
  captureJwt({ headless })
    .then((r) => {
      if (!r) process.exit(1);
      if (r.jwt) console.log("\nJWT:", r.jwt);
    })
    .catch((e) => {
      console.error(e);
      process.exit(2);
    });
}

export { captureJwt, decodeJwt, extractBrandId, BETBY_SPORTSBOOK_URL, BETBY_DEMO_URL };
