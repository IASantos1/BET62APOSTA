import http from "http";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BETBY_ROOT = resolve(__dirname, "..");

const BRAND = "1653815133341880320";
const jwtPath = join(BETBY_ROOT, ".betby-jwt.json");
const JWT = JSON.parse(readFileSync(jwtPath, "utf8")).jwt;

function get(host, port, path) {
  return new Promise((resolve) => {
    const req = http.request(
      { host, port, path, method: "GET", headers: { "Accept": "*/*", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" } },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          resolve({ status: res.statusCode, headers: res.headers, body, size: body.length });
        });
      }
    );
    req.on("error", (e) => resolve({ error: e.message }));
    req.end();
  });
}

(async () => {
  console.log("==> 1) Baixando página tile do sportsbook proxyada");
  const tile = await get("localhost", 8787, "/betby/sportsbook/tile/");
  console.log(`    tile status=${tile.status} size=${tile.size}`);

  const searchPatterns = [
    /api\/v4\/sports["'`]/g,
    /api\/v4\/sports[^"'`\s)]{0,80}/g,
    /[a-z0-9.-]*sptpub\.com/g,
    /demoapi\.betby\.com/g,
    /api-h-[a-z0-9-]+\.sptpub\.com/g,
    /betby\.com\/api\/v4/g,
    /live\/list/g,
    /prematch\/list/g,
    /baseUrl|apiBase|api_url|"api":"[^"]+"/g,
  ];

  console.log("\n==> 2) Procurando padrões no HTML do tile");
  for (const pat of searchPatterns) {
    const matches = tile.body.match(pat);
    if (matches) {
      const uniq = Array.from(new Set(matches));
      console.log(`    [${pat}] ${uniq.length} matches:`);
      for (const m of uniq.slice(0, 8)) console.log(`      - ${m.slice(0, 200)}`);
    }
  }

  console.log("\n==> 3) Extraindo <script src> do tile");
  const scripts = [...tile.body.matchAll(/<script[^>]+src=["']([^"']+)["']/g)].map(m => m[1]);
  console.log(`    ${scripts.length} scripts encontrados`);
  for (const s of scripts.slice(0, 20)) console.log(`      - ${s.slice(0, 150)}`);

  console.log("\n==> 4) Testando hosts ALTERNATIVOS para v4/sports diretamente via proxy contra os 3 upstreams conhecidos");
  const pathsToTest = [
    `/betby/api/v4/sports/list?brandId=${BRAND}&lang=en`,
    `/betby/api/v4/sports/events/live/list?brandId=${BRAND}&lang=en`,
    `/betby-api/api/v4/sports/list?brandId=${BRAND}&lang=en`,
    `/betby-api/api/v4/sports/events/live/list?brandId=${BRAND}&lang=en`,
  ];
  for (const p of pathsToTest) {
    const r = await get("localhost", 8787, p);
    let preview = "";
    try {
      const o = JSON.parse(r.body);
      preview = `keys=${Object.keys(o).join(",")}`;
      if (o.error) preview += ` error="${o.error}"`;
    } catch { preview = r.body.slice(0, 80).replace(/\s+/g, " "); }
    console.log(`    status=${r.status} size=${r.size} ${p.slice(0, 120)} => ${preview}`);
  }

  console.log("\n==> 5) Testando direto ao demoapi.betby.com (sem proxy) com Bearer JWT via Node https");
  const tls = await import("https");
  function httpsGet(urlStr, opts = {}) {
    return new Promise((resolve) => {
      const u = new URL(urlStr);
      const req = tls.request(
        {
          host: u.hostname, port: u.port || 443, path: u.pathname + u.search, method: "GET",
          headers: {
            "Accept": "application/json",
            "User-Agent": opts.ua || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            ...(opts.auth ? { Authorization: `Bearer ${JWT}` } : {}),
            ...(opts.cookie ? { Cookie: opts.cookie } : {}),
            ...(opts.extra || {}),
          },
          rejectUnauthorized: false,
        },
        (res) => {
          const c = [];
          res.on("data", (x) => c.push(x));
          res.on("end", () => {
            const body = Buffer.concat(c).toString("utf8");
            resolve({ status: res.statusCode, headers: res.headers, body, size: body.length });
          });
        }
      );
      req.on("error", (e) => resolve({ error: e.message }));
      req.end();
    });
  }

  const sessData = JSON.parse(readFileSync(join(BETBY_ROOT, ".betby-session.json"), "utf8"));
  const sessHeaders = sessData.extra?.requestHeadersSeen || {};
  const extra = {};
  for (const [k, v] of Object.entries(sessHeaders)) {
    if (k.startsWith("sec-ch") || k.startsWith("cf-") || k === "x-requested-with") extra[k] = v;
  }
  extra["X-Requested-With"] = "XMLHttpRequest";
  extra["Origin"] = "https://demo.betby.com";
  extra["Referer"] = "https://demo.betby.com/";

  const directUrls = [
    `https://demoapi.betby.com/api/v4/sports/list?brandId=${BRAND}&lang=en`,
    `https://demoapi.betby.com/api/v4/sports/events/live/list?brandId=${BRAND}&lang=en`,
  ];
  for (const u of directUrls) {
    const r1 = await httpsGet(u, { auth: true, extra }); // só Bearer + sec-ch
    let p1 = "";
    try { const o = JSON.parse(r1.body); p1 = o.error || o.message || (Array.isArray(o.data) ? `data[${o.data.length}]` : Object.keys(o).slice(0, 6).join(",")); }
    catch { p1 = r1.body.slice(0, 120).replace(/\s+/g, " "); }
    console.log(`    [BEARER-only] status=${r1.status} size=${r1.size} ${u.slice(0, 110)} => ${p1}`);
  }
})();
