import { writeFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "fs";
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

const BETBY_SPORTSBOOK_URL =
  "https://demo.betby.com/sportsbook/tile/?_gl=1*5b9qwe*_gcl_au*MTQ5NDg1NjMyOC4xNzg1NjkxODYy";
const SESSION_FILE = join(__dirname, ".betby-session.json");
const BRAND_ID = "1653815133341880320";

const DEMOAPI_HOST = "demoapi.betby.com";
const BETBY_HOSTS = ["demo.betby.com", DEMOAPI_HOST];

function saveSession({ cookies, userAgent, extra, capturedAt }) {
  const cookieHosts = new Set();
  for (const c of cookies || []) cookieHosts.add(c.domain);
  const cf = {};
  const cookieMap = {};
  for (const c of cookies || []) {
    cookieMap[c.name] = { ...c };
  }
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

async function main() {
  const headless = !process.argv.includes("--headed");
  const headlessMode = resolveHeadlessMode(headless);
  console.log(`[v4-cf] Launching Chromium (headless=${headlessMode})...`);

  const browser = await chromium.launch({ headless: headlessMode });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  const extra = {
    requestHeadersSeen: {},
    v4RequestCaptured: null,
    v4Response: null,
  };

  page.on("request", (request) => {
    const url = request.url();
    try {
      for (const [k, v] of Object.entries(request.headers())) {
        if (k.startsWith("cf-") || k.startsWith("sec-") || ["x-requested-with","x-csrf-token","x-xsrf-token"].includes(k)) {
          extra.requestHeadersSeen[k] = extra.requestHeadersSeen[k] || v;
        }
      }
      if (/api\/v4\/sports\//.test(url)) {
        const allHeaders = request.headers();
        extra.v4RequestCaptured = {
          url,
          method: request.method(),
          headers: allHeaders,
          resourceType: request.resourceType(),
          at: new Date().toISOString(),
        };
        console.log(`[v4-cf] 🔴 Request v4/sports capturado: ${url.slice(0, 120)}`);
        console.log(`[v4-cf]    Headers importantes: cookie=${allHeaders.cookie ? allHeaders.cookie.slice(0, 200) + "..." : "(vazio)"}, cf-ray=${allHeaders["cf-ray"] || "-"}, sec-ch-ua=${allHeaders["sec-ch-ua"] || "-"}`);
      }
    } catch {}
  });

  page.on("response", async (response) => {
    const url = response.url();
    if (/api\/v4\/sports\//.test(url)) {
      try {
        extra.v4Response = {
          url,
          status: response.status(),
          headers: response.headers(),
          bodySize: 0,
          bodyPreview: "",
        };
        try {
          const text = await response.text().catch(() => "");
          extra.v4Response.bodySize = text.length;
          extra.v4Response.bodyPreview = text.slice(0, 500);
          console.log(`[v4-cf] 🔵 Response v4/sports: status=${response.status()} size=${text.length}`);
          if (text) console.log(`[v4-cf]    Body preview: ${text.slice(0, 200).replace(/\s+/g, " ")}`);
        } catch {}
      } catch {}
    }
  });

  let lastError = null;
  try {
    console.log(`[v4-cf] Navegando para ${BETBY_SPORTSBOOK_URL} ...`);
    await page.goto(BETBY_SPORTSBOOK_URL, { waitUntil: "networkidle", timeout: 60000 });

    const WAIT_MS_BASE = 8000;
    console.log(`[v4-cf] Esperando ${WAIT_MS_BASE}ms para estabilizar + desafio CF...`);
    await page.waitForTimeout(WAIT_MS_BASE);

    console.log(`[v4-cf] Tentando fetch explícito na página (origin demo.betby.com) para /api/v4/sports/list?...`);
    const fetchResult = await page.evaluate(async (brand) => {
      const results = [];
      const paths = [
        `/api/v4/sports/list?brandId=${brand}&lang=en`,
        `/api/v4/sports/events/live/list?brandId=${brand}&lang=en`,
        `/api/v4/sports/events/prematch/list?brandId=${brand}&lang=en`,
      ];
      for (const p of paths) {
        try {
          const start = Date.now();
          const r = await fetch(p, {
            method: "GET",
            credentials: "include",
            headers: {
              "Accept": "application/json, text/plain, */*",
              "X-Requested-With": "XMLHttpRequest",
            },
          });
          const text = await r.text();
          results.push({
            path: p,
            status: r.status,
            ms: Date.now() - start,
            ok: r.ok,
            bodySize: text.length,
            preview: text.slice(0, 200),
          });
          console.log(`fetch ${p}: ${r.status} ${text.length}b`);
        } catch (e) {
          results.push({ path: p, error: e.message || String(e) });
        }
      }
      try {
        const stor = {};
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          stor[k] = (localStorage.getItem(k) || "").slice(0, 200);
        }
        return { results, documentCookie: document.cookie, localStorage: stor };
      } catch (e) {
        return { results, documentCookie: document.cookie, localStorageError: e.message };
      }
    }, BRAND_ID).catch(e => ({ error: e.message }));

    extra.pageFetchResults = fetchResult;
    console.log(`[v4-cf] Fetch na página concluído. Resultados:`);
    if (fetchResult?.results) {
      for (const r of fetchResult.results) {
        if (r.error) console.log(`   ❌ ${r.path.slice(0, 70)}... ERROR=${r.error}`);
        else {
          const flag = r.ok ? "✅" : "⚠️";
          console.log(`   ${flag} ${r.path.slice(0, 70)}... status=${r.status} size=${r.bodySize}ms=${r.ms || "-"} preview=${r.preview?.slice(0, 80) || ""}`);
        }
      }
    } else {
      console.log(`   Nenhum resultado (fetch erro: ${fetchResult?.error || "desconhecido"})`);
    }
    if (fetchResult?.documentCookie) {
      console.log(`[v4-cf] document.cookie (${fetchResult.documentCookie.length} chars): ${fetchResult.documentCookie.slice(0, 300)}`);
    } else {
      console.log(`[v4-cf] document.cookie VAZIO`);
    }

    console.log(`[v4-cf] Esperando mais 5s para requests completarem...`);
    await page.waitForTimeout(5000);
  } catch (e) {
    lastError = e.message;
    console.error(`[v4-cf] Erro durante navegação: ${e.message}`);
  }

  const finalUserAgent = String(await page.evaluate(() => navigator.userAgent).catch(() => context._options?.userAgent || "") || context._options?.userAgent || "");

  let cookies = [];
  try { cookies = await context.cookies(); } catch (e) { lastError = lastError || e.message; }
  try {
    const storageState = await context.storageState();
    if (storageState?.cookies?.length) {
      for (const sc of storageState.cookies) {
        if (!cookies.some(c => c.name === sc.name && c.domain === sc.domain && c.path === sc.path)) cookies.push(sc);
      }
    }
  } catch {}
  try {
    const docCookieStr = extra.pageFetchResults?.documentCookie || await page.evaluate(() => document.cookie).catch(() => "");
    if (docCookieStr) {
      const host = "demo.betby.com";
      for (const pair of docCookieStr.split(/\s*;\s*/)) {
        const eq = pair.indexOf("=");
        if (eq < 1) continue;
        const name = decodeURIComponent(pair.slice(0, eq).trim());
        const value = decodeURIComponent(pair.slice(eq + 1).trim());
        if (!name || !value) continue;
        if (!cookies.some(c => c.name === name && c.domain && (c.domain.includes(host) || c.domain.includes("betby") || c.domain.includes("sptpub")))) {
          cookies.push({ name, value, domain: host, path: "/", expires: -1, httpOnly: false, secure: true, sameSite: "Lax" });
        }
      }
    }
  } catch {}

  await browser.close();

  console.log(`[v4-cf] Total de cookies capturados: ${cookies.length}`);
  const cfNames = ["cf_clearance", "__cf_bm", "__cflb", "cf_ob_info"];
  const cfFound = cookies.filter(c => cfNames.includes(c.name));
  console.log(`[v4-cf] Cookies Cloudflare: ${cfFound.length ? cfFound.map(c => `${c.name}=${String(c.value).slice(0, 20)}...@${c.domain}`).join(", ") : "(nenhum)"}`);

  const sess = saveSession({ cookies, userAgent: finalUserAgent, extra, capturedAt: new Date().toISOString() });
  console.log(`[v4-cf] Sessão salva em ${SESSION_FILE}`);
  console.log(`[v4-cf] cookieHeader_demoapiBetby tamanho=${sess.cookieHeader_demoapiBetby.length}`);
  console.log(`[v4-cf] cookieHeader_demoBetby tamanho=${sess.cookieHeader_demoBetby.length}`);
  console.log(`[v4-cf] Concluído.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
    .then(() => process.exit(0))
    .catch(e => { console.error(e); process.exit(1); });
}
