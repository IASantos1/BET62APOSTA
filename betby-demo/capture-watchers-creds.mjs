import { writeFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const LOCAL_DIR = resolve(__dirname, ".playwright-browsers");
const GLOBAL_DIR = join(
  process.env.LOCALAPPDATA || join(process.env.USERPROFILE || "~", "AppData", "Local"),
  "ms-playwright",
);

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

const BETBY_DEMO_URL = process.env.BETBY_DEMO_URL || "https://demo.betby.com";
const OUTPUT_FILE = join(__dirname, ".betby-secrets.json");
const WATCHERS_CREDS_FILE = join(__dirname, ".betby-watchers.json");

function resolveHeadlessMode(h) {
  if (h === false) return false;
  if (h === true || h === "new") return "new";
  if (h === "old") return true;
  return "new";
}

function readJwtBrand() {
  try {
    const f = join(__dirname, ".betby-jwt.json");
    if (!existsSync(f)) return { brandId: "1653815133341880320" };
    const d = JSON.parse(readFileSync(f, "utf-8"));
    return { brandId: d.brandId || "1653815133341880320", jwt: d.jwt || null };
  } catch {
    return { brandId: "1653815133341880320" };
  }
}

export async function captureWatchersCreds({ headless = true, saveToDisk = true, waitMs } = {}) {
  const headlessMode = resolveHeadlessMode(headless);
  const { brandId } = readJwtBrand();
  let browser;
  let page;
  const results = {
    capturedAt: new Date().toISOString(),
    brandId,
    authRegister: null,
    chatEmbedIframe: null,
    pageUrlMatches: [],
    requests: [],
    userIdB64: null,
    roomId: null,
    apikey: null,
    embedUrl: null,
  };

  try {
    browser = await chromium.launch({
      headless: headlessMode,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled",
      ],
    });
    const ctx = await browser.newContext({
      viewport: { width: 1366, height: 900 },
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
    });
    page = await ctx.newPage();

    const authRegisterPromise = new Promise((resolve) => {
      let done = false;
      page.on("response", async (resp) => {
        if (done) return;
        const u = resp.url();
        if (/chatbackend\.watchers\.io\/auth\/register/.test(u)) {
          try {
            const body = await resp.text().catch(() => "");
            let data = null;
            try { data = JSON.parse(body); } catch {}
            results.authRegister = {
              url: u,
              status: resp.status(),
              requestBody: null,
              data,
            };
            try {
              const req = resp.request();
              const post = await req.postData();
              if (post) results.authRegister.requestBody = JSON.parse(post);
            } catch {}
            done = true;
            resolve();
          } catch (e) {
            results.authRegister = results.authRegister || { error: e.message };
          }
        }
      });
    });

    page.on("frameattached", (f) => {
      try {
        const u = f.url();
        if (!u) return;
        if (/watchers\.io/.test(u)) {
          const parsed = new URL(u);
          const rec = { url: u };
          const roomId = parsed.searchParams.get("roomId");
          const userId = parsed.searchParams.get("userId");
          const apikey = parsed.searchParams.get("apikey");
          if (roomId) rec.roomId = roomId;
          if (userId) rec.userId = userId;
          if (apikey) rec.apikey = apikey;
          results.pageUrlMatches.push(rec);
          if (!results.roomId && roomId) results.roomId = roomId;
          if (!results.userIdB64 && userId) results.userIdB64 = userId;
          if (!results.apikey && apikey) results.apikey = apikey;
        }
      } catch {}
    });

    const watchersCredsPromise = new Promise((resolve) => {
      let done = false;
      page.on("request", (req) => {
        const u = req.url();
        if (done) return;
        if (/chat\.watchers\.io\/?\?/.test(u)) {
          try {
            const parsed = new URL(u);
            const roomId = parsed.searchParams.get("roomId");
            const userId = parsed.searchParams.get("userId");
            const apikey = parsed.searchParams.get("apikey");
            if (roomId && userId && apikey) {
              results.roomId = roomId;
              results.userIdB64 = userId;
              results.apikey = apikey;
              results.embedUrl = u;
              done = true;
              resolve();
            }
          } catch {}
        }
      });
    });

    await page.goto(BETBY_DEMO_URL, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForTimeout(5000);

    const iframeWatchers = (await page.frames().find((f) => f.url() && /watchers\.io/.test(f.url()))) || null;
    if (iframeWatchers) {
      try {
        results.chatEmbedIframe = { url: iframeWatchers.url(), title: await iframeWatchers.title().catch(() => "") };
        const purl = new URL(iframeWatchers.url());
        if (purl.searchParams.get("roomId")) results.roomId = purl.searchParams.get("roomId");
        if (purl.searchParams.get("userId")) results.userIdB64 = purl.searchParams.get("userId");
        if (purl.searchParams.get("apikey")) results.apikey = purl.searchParams.get("apikey");
      } catch {}
    }

    const waitExtra = waitMs || (typeof process.env.WAIT_MS !== "undefined" ? Number(process.env.WAIT_MS) : 15000);
    await Promise.race([
      new Promise((r) => setTimeout(r, waitExtra)),
      authRegisterPromise,
      watchersCredsPromise,
    ]);

    if (!results.userIdB64 || !results.roomId || !results.apikey) {
      try {
        const iframes = await page.evaluate(
          () => Array.from(document.querySelectorAll("iframe")).map((f) => f.src).filter(Boolean),
        );
        const found = iframes.find((s) => /watchers\.io/.test(s));
        if (found) {
          const p = new URL(found);
          results.roomId = results.roomId || p.searchParams.get("roomId");
          results.userIdB64 = results.userIdB64 || p.searchParams.get("userId");
          results.apikey = results.apikey || p.searchParams.get("apikey");
          results.embedUrl = results.embedUrl || found;
        }
      } catch {}
    }

    if (results.userIdB64 && results.roomId && results.apikey && !results.embedUrl) {
      const p = new URLSearchParams({
        roomId: results.roomId,
        userId: results.userIdB64,
        apikey: results.apikey,
      });
      results.embedUrl = `https://chat.watchers.io/?${p.toString()}`;
    }

    const DUMPS_DIR = join(__dirname, ".dumps");
    try { mkdirSync(DUMPS_DIR, { recursive: true }); } catch {}
    try {
      const all = page.frames().map((f) => ({ url: f.url(), name: f.name() || null }));
      const html = await page.content().catch(() => "");
      writeFileSync(join(DUMPS_DIR, "watchers-capture-page.html"), html);
      writeFileSync(join(DUMPS_DIR, "watchers-capture.json"), JSON.stringify({ iframes: all, ...results }, null, 2));
    } catch {}

    if (saveToDisk) {
      results.saved = saveResults(results);
    }

    return results;
  } finally {
    try { if (page) await page.close(); } catch {}
    try { if (browser) await browser.close(); } catch {}
  }
}

function saveResults(r) {
  const data = {
    capturedAt: r.capturedAt,
    brandId: r.brandId,
    roomId: r.roomId,
    userIdB64: r.userIdB64,
    apikey: r.apikey,
    embedUrl: r.embedUrl,
    authRegister: r.authRegister,
    hint: !!(r.roomId && r.userIdB64 && r.apikey) ? "OK credenciais capturadas via Playwright abrindo demo.betby.com widget de verdade" : "CREDENCIAIS_INCOMPLETAS — tente com --headed",
  };
  if (!existsSync(__dirname)) mkdirSync(__dirname, { recursive: true });
  writeFileSync(WATCHERS_CREDS_FILE, JSON.stringify(data, null, 2));

  if (existsSync(OUTPUT_FILE)) {
    try {
      const cur = JSON.parse(readFileSync(OUTPUT_FILE, "utf-8"));
      if (r.roomId) cur.creds.roomId = r.roomId;
      if (r.userIdB64) cur.creds.userIdB64 = r.userIdB64;
      if (r.apikey) cur.creds.apikey = r.apikey;
      if (r.authRegister) cur.creds.authRegister = r.authRegister;
      if (r.embedUrl) cur.creds.embedUrl = r.embedUrl;
      const m = /^([^:]+):(.+)$/.exec(r.roomId || "");
      if (m && m[1] === r.brandId) cur.creds.projectSuffix = m[2];
      writeFileSync(OUTPUT_FILE, JSON.stringify(cur, null, 2));
    } catch {}
  }
  return { watchersFile: WATCHERS_CREDS_FILE, mergedSecrets: OUTPUT_FILE };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const headed = args.includes("--headed") || args.includes("-h");
  const wait = Number(process.env.WAIT_MS || 20000);
  captureWatchersCreds({ headless: !headed, waitMs: wait })
    .then((r) => {
      console.log("[watchers-capture] roomId:", r.roomId || "(n/a)");
      console.log("[watchers-capture] userIdB64:", r.userIdB64 ? (r.userIdB64.slice(0, 20) + "…") : "(n/a)");
      console.log("[watchers-capture] apikey:", r.apikey || "(n/a)");
      console.log("[watchers-capture] auth/register:", r.authRegister?.status || "(n/a)");
      console.log("[watchers-capture] embed:", r.embedUrl || "(n/a)");
      console.log("[watchers-capture] salvo em:", WATCHERS_CREDS_FILE);
      if (!r.userIdB64) {
        console.warn("[watchers-capture] ⚠️  Nao achou userIdB64. Tente rodar com --headed: .\\capture-watchers-creds.cmd --headed");
        process.exit(2);
      }
    })
    .catch((e) => { console.error("[watchers-capture] erro:", e); process.exit(1); });
}

export default { captureWatchersCreds };
