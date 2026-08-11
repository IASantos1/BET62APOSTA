import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";
import tls from "https";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BETBY_ROOT = resolve(__dirname, "..");
const BRAND = "1653815133341880320";
const LANG = "en";
const JWT = JSON.parse(readFileSync(join(BETBY_ROOT, ".betby-jwt.json"), "utf8")).jwt;
const SESS = JSON.parse(readFileSync(join(BETBY_ROOT, ".betby-session.json"), "utf8"));

const UA = SESS.userAgent || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const COOKIE_SAMPLE = SESS.cookieHeader_demoapiBetby || SESS.cookieHeader_demoBetby || "";
const EXTRA = {};
for (const [k, v] of Object.entries(SESS.extra?.requestHeadersSeen || {})) {
  if (k.startsWith("sec-ch")) EXTRA[k] = v;
}
EXTRA["X-Requested-With"] = "XMLHttpRequest";

function httpsGet(urlStr, { auth, cookie, origin } = {}) {
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
          ...(cookie ? { Cookie: COOKIE_SAMPLE } : {}),
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
            summary = `RAW(${body.length}b): ${body.slice(0, 150).replace(/\s+/g, " ")}`;
          }
          resolve({ status: res.statusCode, size: body.length, summary, server: res.headers["server"] || "" });
        });
      }
    );
    req.on("error", (e) => resolve({ error: e.message }));
    req.end();
  });
}

const BASE = `https://demoapi.betby.com`;
const ORIGIN = "https://demo.betby.com";
const EXACT_USER_URL = `https://demoapi.betby.com/api/v4/live/brand/1653815133341880320/en/3572980260248`;

const PATHS_TO_TRY = [
  // URL EXATA fornecida pelo usuário
  `/api/v4/live/brand/${BRAND}/${LANG}/3572980260248`,

  // Variações da mesma estrutura (id=0 ou sem o id final pra pegar a lista topo)
  `/api/v4/live/brand/${BRAND}/${LANG}`,
  `/api/v4/live/brand/${BRAND}/${LANG}/1`,
  `/api/v4/live/brand/${BRAND}/${LANG}/0`,

  // Prematch analógico (troca live por prematch)
  `/api/v4/prematch/brand/${BRAND}/${LANG}`,
  `/api/v4/prematch/brand/${BRAND}/${LANG}/1`,
  `/api/v4/prematch/brand/${BRAND}/${LANG}/0`,

  // Lista de esportes / live count
  `/api/v4/sports/list/brand/${BRAND}/${LANG}`,
  `/api/v4/live/sports/brand/${BRAND}/${LANG}`,
  `/api/v4/prematch/sports/brand/${BRAND}/${LANG}`,

  // /api/v4/count/... /api/v4/tree/... (padrões comuns)
  `/api/v4/live/tree/brand/${BRAND}/${LANG}`,
  `/api/v4/prematch/tree/brand/${BRAND}/${LANG}`,
  `/api/v4/live/count/brand/${BRAND}/${LANG}`,
  `/api/v4/prematch/count/brand/${BRAND}/${LANG}`,

  // Detalhe de evento (sem brand/encapsulado)
  `/api/v4/events/3572980260248/${LANG}`,
  `/api/v4/event/3572980260248/${LANG}`,

  // Mercados do evento
  `/api/v4/events/3572980260248/markets/${LANG}`,
  `/api/v4/event/3572980260248/markets/${LANG}`,

  // Fallback: padrão v3/v2
  `/api/v4/live/list?brandId=${BRAND}&lang=${LANG}`,
];

console.log(`JWT length=${JWT.length}, cookieHeader size=${COOKIE_SAMPLE.length}`);
console.log(`Testando URL EXATA do usuário primeiro: ${EXACT_USER_URL}`);
console.log("");

(async () => {
  // primeiro a URL exata, com auth E cookie
  const tests = [];
  for (const p of PATHS_TO_TRY) {
    tests.push({ label: "Bearer+Cookie", path: p, opts: { auth: true, cookie: true, origin: ORIGIN } });
  }
  const results = [];
  for (const t of tests) {
    const r = await httpsGet(BASE + t.path, t.opts);
    if (r.error) {
      console.log(`  ❌ ${t.label} ${t.path.slice(0, 80)} => ${r.error}`);
    } else {
      const is2xx = r.status >= 200 && r.status < 300;
      const isJson = !r.summary.startsWith("RAW") && !r.summary.startsWith("ERROR:");
      const flag = (is2xx && isJson) ? "✅" : (is2xx ? "🟡" : "⚠️");
      console.log(`  ${flag} ${t.label} status=${r.status} size=${r.size} ${t.path}`);
      console.log(`         ${r.summary.slice(0, 140)}`);
      if (flag === "✅") results.push({ ...t, ...r });
    }
    // throttle leve
    await new Promise(res => setTimeout(res, 120));
  }
  console.log("");
  console.log(`=== Total de endpoints 200+JSON: ${results.length} ===`);
  for (const r of results) {
    console.log(`   🎯 ${r.path}`);
    console.log(`         ${r.summary}`);
  }
})();
