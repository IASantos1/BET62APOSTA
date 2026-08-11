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
const SESSION_FILE = join(__dirname, ".betby-session.json");
const TARGET_HEADERS = ["/api/v2/player", "/api/v3/", "/api/v4/"];
const DEMOAPI_HOST = "demoapi.betby.com";
const BETBY_HOSTS = ["demo.betby.com", DEMOAPI_HOST];

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

function saveSession({ cookies, userAgent, extra, capturedAt }) {
  const cookieMap = {};
  const cookieHosts = new Set();
  for (const c of cookies || []) {
    cookieHosts.add(c.domain);
    const key = (c.name);
    if (!cookieMap[key] || c.value) cookieMap[key] = { ...c };
  }
  const cf = {};
  for (const k of ["cf_clearance", "__cf_bm", "__cflb", "cf_ob_info"]) {
    if (cookieMap[k]) cf[k] = { value: cookieMap[k].value, domain: cookieMap[k].domain, expires: cookieMap[k].expires || null };
  }
  function cookieHeaderFor(host) {
    const parts = [];
    const hostL = String(host || "").replace(/^\./, "");
    for (const c of cookies || []) {
      const d = String(c.domain || "").replace(/^\./, "");
      if (!d) continue;
      const match = hostL === d || hostL.endsWith("." + d) || d.endsWith(hostL) || BETBY_HOSTS.some(h => hostL === h || hostL.endsWith("." + h));
      if (!match && c.domain && !BETBY_HOSTS.some(h => String(c.domain).includes(h))) continue;
      if (c.name && c.value) parts.push(`${encodeURIComponent(c.name)}=${encodeURIComponent(c.value)}`);
    }
    return Array.from(new Set(parts)).join("; ");
  }
  const sess = {
    capturedAt: capturedAt || new Date().toISOString(),
    userAgent,
    cookies: cookies || [],
    cookieHosts: Array.from(cookieHosts),
    cookieHeader_demoBetby: cookieHeaderFor("demo.betby.com"),
    cookieHeader_demoapiBetby: cookieHeaderFor(DEMOAPI_HOST),
    cookieHeader_sptpub: cookieHeaderFor("sptpub.com"),
    cloudflareCookies: cf,
    extra: extra || {},
  };
  if (!existsSync(__dirname)) mkdirSync(__dirname, { recursive: true });
  writeFileSync(SESSION_FILE, JSON.stringify(sess, null, 2));
  return sess;
}

function resolveHeadlessMode(h) {
  if (h === false) return false;
  if (h === "new" || h === "chrome") return h;
  return "new";
}

async function captureJwt(options = {}) {
  const { headless = true, timeoutMs = 20000, saveToDisk = true, waitAfterMs = 6000 } = options;
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
  const extra = {
    requestHeadersSeen: {},
    lastRequestAuthByUrl: {},
    setCookiesSeen: [],
  };

  page.on("request", (request) => {
    const url = request.url();
    try {
      const host = new URL(url).hostname;
      for (const [k, v] of Object.entries(request.headers())) {
        if (k.startsWith("cf-") || k.startsWith("sec-") || ["x-requested-with","x-csrf-token","x-xsrf-token"].includes(k)) {
          extra.requestHeadersSeen[k] = extra.requestHeadersSeen[k] || v;
        }
      }
      if (BETBY_HOSTS.some(h => host.endsWith(h))) {
        const auth = request.headers()["authorization"];
        if (auth) extra.lastRequestAuthByUrl[host] = url;
      }
      const cookieReq = request.headers()["cookie"];
      if (cookieReq) {
        const host = new URL(url).hostname;
        extra.requestHeadersSeen[`cookie-sample-${host}`] = cookieReq.slice(0, 300);
      }
    } catch {}
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
    try {
      const sc = response.headers()["set-cookie"];
      if (sc) {
        extra.setCookiesSeen.push({ url: response.url().slice(0, 150), setCookie: sc });
      }
    } catch {}
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
      waitUntil: "networkidle",
      timeout: 45000,
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

    if (waitAfterMs && waitAfterMs > 0) {
      try { await page.waitForTimeout(waitAfterMs); } catch {}
    }
  } catch (e) {
    lastError = e.message;
    console.error(`[betby] Erro durante navegação: ${e.message}`);
  }

  const finalUserAgent = String(await page.evaluate(() => navigator.userAgent).catch(() => context._options?.userAgent || "") ||
    context._options?.userAgent || "");

  let cookies = [];
  try {
    cookies = await context.cookies();
  } catch (e) { lastError = lastError || e.message; }

  try {
    const storageState = await context.storageState();
    if (storageState?.cookies?.length) {
      for (const sc of storageState.cookies) {
        if (!cookies.some(c => c.name === sc.name && c.domain === sc.domain && c.path === sc.path)) {
          cookies.push(sc);
        }
      }
    }
  } catch {}

  try {
    const docCookieStr = await page.evaluate(() => document.cookie).catch(() => "");
    if (docCookieStr) {
      const url = new URL(BETBY_DEMO_URL);
      for (const pair of docCookieStr.split(/\s*;\s*/)) {
        const eq = pair.indexOf("=");
        if (eq < 1) continue;
        const name = decodeURIComponent(pair.slice(0, eq).trim());
        const value = decodeURIComponent(pair.slice(eq + 1).trim());
        if (!name || !value) continue;
        if (!cookies.some(c => c.name === name && c.domain && (c.domain.includes("betby") || c.domain.includes("sptpub")))) {
          cookies.push({ name, value, domain: url.hostname, path: "/", expires: -1, httpOnly: false, secure: url.protocol === "https:", sameSite: "Lax" });
        }
      }
    }
  } catch {}

  try {
    const localStorageDump = await page.evaluate(() => {
      try {
        const o = {};
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          o[k] = (localStorage.getItem(k) || "").slice(0, 200);
        }
        return o;
      } catch { return {}; }
    }).catch(() => ({}));
    extra.localStorage = localStorageDump;
  } catch {}

  await browser.close();

  if (!jwt) {
    console.error("[betby] JWT NÃO ENCONTRADO após timeout.");
    if (lastError) console.error(`[betby] Último erro: ${lastError}`);
    if (saveToDisk) {
      try {
        const sessAt = new Date().toISOString();
        saveSession({ cookies, userAgent: finalUserAgent, extra, capturedAt: sessAt });
        console.log("[betby] Mesmo sem JWT, sessão CF foi salva (cookies/UA) — pode ajudar proxies.");
      } catch {}
    }
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
  {
    const cfNames = ["cf_clearance","__cf_bm","__cflb","cf_ob_info"];
    const cf = cookies.filter(c => cfNames.includes(c.name)).map(c => c.name).join(", ") || "(nenhum cookie CF)";
    console.log(`[betby] Cookies totais: ${cookies.length} — Cloudflare: ${cf}`);
    if (cookies.length) {
      const sptC = cookies.filter(c => /sptpub|betby/i.test(c.domain)).length;
      console.log(`[betby] Cookies betby/sptpub: ${sptC}`);
    }
    const setCookiesCount = (extra.setCookiesSeen || []).length;
    if (setCookiesCount) console.log(`[betby] set-cookie headers vistos em responses: ${setCookiesCount}`);
    const sampleKeys = Object.keys(extra.requestHeadersSeen || {}).filter(k => k.startsWith("cookie-sample"));
    if (sampleKeys.length) console.log(`[betby] request cookie header samples encontrados: ${sampleKeys.join(", ")}`);
  }

  let session = null;
  if (saveToDisk) {
    const saved = saveResult(jwt, payload, brandId, capturedAt);
    console.log(`[betby] Credenciais salvas em ${OUTPUT_FILE}`);
    session = saveSession({ cookies, userAgent: finalUserAgent, extra, capturedAt });
    console.log(`[betby] Sessão CF (cookies + UA + headers) salva em ${SESSION_FILE}`);
    return { ...saved, session };
  }

  return { jwt, payload, brandId, capturedAt, resolvedFrom, session: { cookies, userAgent: finalUserAgent, extra } };
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
