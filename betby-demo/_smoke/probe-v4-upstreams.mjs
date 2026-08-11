import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";
import tls from "https";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BETBY_ROOT = resolve(__dirname, "..");
const BRAND = "1653815133341880320";
const JWT = JSON.parse(readFileSync(join(BETBY_ROOT, ".betby-jwt.json"), "utf8")).jwt;
const SESS = JSON.parse(readFileSync(join(BETBY_ROOT, ".betby-session.json"), "utf8"));

const UA = SESS.userAgent || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const EXTRA = {};
for (const [k, v] of Object.entries(SESS.extra?.requestHeadersSeen || {})) {
  if (k.startsWith("sec-ch")) EXTRA[k] = v;
}
EXTRA["X-Requested-With"] = "XMLHttpRequest";

function httpsGet(urlStr, { auth, origin } = {}) {
  return new Promise((resolve) => {
    const u = new URL(urlStr);
    const req = tls.request(
      {
        host: u.hostname, port: u.port || 443, path: u.pathname + u.search, method: "GET",
        headers: {
          "Accept": "application/json, text/plain, */*",
          "Accept-Language": "en-US,en;q=0.9",
          "User-Agent": UA,
          ...(auth ? { Authorization: `Bearer ${JWT}` } : {}),
          ...(origin ? { Origin: origin, Referer: origin + "/" } : {}),
          ...EXTRA,
        },
        rejectUnauthorized: false,
      },
      (res) => {
        const c = [];
        res.on("data", (x) => c.push(x));
        res.on("end", () => {
          const body = Buffer.concat(c).toString("utf8");
          let summary = "";
          try {
            const o = JSON.parse(body);
            if (o.error) summary = `ERROR: ${o.error}`;
            else if (o.message) summary = `MSG: ${String(o.message).slice(0, 80)}`;
            else if (Array.isArray(o)) summary = `ARRAY(${o.length})`;
            else if (Array.isArray(o.data)) summary = `data.len=${o.data.length} keys=${Object.keys(o).filter(k => k !== "data").slice(0, 5).join(",")}`;
            else summary = `keys=${Object.keys(o).slice(0, 8).join(",")}`;
          } catch {
            summary = `RAW(${body.length}b): ${body.slice(0, 120).replace(/\s+/g, " ")}`;
          }
          resolve({ status: res.statusCode, size: body.length, summary, server: res.headers["server"] || res.headers["cf-ray"] || "" });
        });
      }
    );
    req.on("error", (e) => resolve({ error: e.message }));
    req.end();
  });
}

const liveQs = `brandId=${BRAND}&lang=en`;
const UPSTREAMS = [
  { label: "demoapi.betby.com (atual)", urlBase: "https://demoapi.betby.com", origin: "https://demo.betby.com" },
  { label: "sptpub (api-h)", urlBase: "https://api-h-c7818b61-608.sptpub.com", origin: "https://demo.betby.com" },
  { label: "demo.betby.com (origem widget)", urlBase: "https://demo.betby.com", origin: "https://demo.betby.com" },
];
const PATHS = [
  `/api/v4/sports/list?${liveQs}`,
  `/api/v4/sports/events/live/list?${liveQs}`,
  `/api/v4/sports/events/prematch/list?${liveQs}`,
];

console.log(`JWT length: ${JWT.length}`);
console.log(`UA: ${UA.slice(0, 80)}`);
console.log("");

(async () => {
  for (const up of UPSTREAMS) {
    console.log(`===== ${up.label} =====`);
    for (const p of PATHS) {
      for (const auth of [true, false]) {
        const r = await httpsGet(up.urlBase + p, { auth, origin: up.origin });
        const flag = r.status >= 200 && r.status < 300 && !r.summary.startsWith("ERROR") ? "✅" : "⚠️";
        const authLabel = auth ? "Bearer" : "noAuth";
        if (r.error) console.log(`  ❌ ${p.slice(0, 70)} [${authLabel}] => ${r.error}`);
        else console.log(`  ${flag} ${p.slice(0, 70)} [${authLabel}] => status=${r.status} size=${r.size} ${r.summary} ${r.server ? "[" + String(r.server).slice(0, 40) + "]" : ""}`);
      }
    }
    console.log("");
  }
})();
