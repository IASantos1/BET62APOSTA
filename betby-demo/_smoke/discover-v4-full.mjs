import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";
import tls from "https";
import http from "http";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BETBY_ROOT = resolve(__dirname, "..");
const BRAND = "1653815133341880320";
const LANG = "en";
const JWT = JSON.parse(readFileSync(join(BETBY_ROOT, ".betby-jwt.json"), "utf8")).jwt;
const SESS = JSON.parse(readFileSync(join(BETBY_ROOT, ".betby-session.json"), "utf8"));

const UA = SESS.userAgent || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const COOKIE = SESS.cookieHeader_demoapiBetby || SESS.cookieHeader_demoBetby || "";
const EXTRA = {};
for (const [k, v] of Object.entries(SESS.extra?.requestHeadersSeen || {})) {
  if (k.startsWith("sec-ch")) EXTRA[k] = v;
}
EXTRA["X-Requested-With"] = "XMLHttpRequest";

function getLocal(path) {
  return new Promise((resolve) => {
    const req = http.request(
      { host: "localhost", port: 8787, path, method: "GET", headers: { "Accept": "application/json" } },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          resolve({ status: res.statusCode, body, size: body.length });
        });
      }
    );
    req.on("error", (e) => resolve({ error: e.message }));
    req.end();
  });
}

function httpsGet(urlStr, { auth, cookie } = {}) {
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
          ...(cookie ? { Cookie: COOKIE } : {}),
          "Origin": "https://demo.betby.com",
          "Referer": "https://demo.betby.com/",
          ...EXTRA,
        },
        rejectUnauthorized: false,
      },
      (res) => {
        const c = [];
        res.on("data", (x) => c.push(x));
        res.on("end", () => {
          const body = Buffer.concat(c).toString("utf8");
          resolve({ status: res.statusCode, size: body.length, body });
        });
      }
    );
    req.on("error", (e) => resolve({ error: e.message }));
    req.end();
  });
}

function summary(body) {
  try {
    const o = JSON.parse(body);
    const keys = Object.keys(o);
    if (o.error) return `ERROR:${o.error}`;
    const part1 = [];
    if (typeof o.epoch === "number") part1.push(`epoch=${o.epoch}`);
    if (typeof o.status === "number") part1.push(`status=${o.status}`);
    if (Array.isArray(o.sports)) part1.push(`sports[${o.sports.length}]`);
    if (Array.isArray(o.events)) part1.push(`events[${o.events.length}]`);
    if (Array.isArray(o.categories)) part1.push(`cats[${o.categories.length}]`);
    if (Array.isArray(o.tournaments)) part1.push(`trns[${o.tournaments.length}]`);
    if (o.top_events_versions) part1.push(`topVers=${JSON.stringify(o.top_events_versions).slice(0, 80)}`);
    if (o.rest_events_versions) part1.push(`restVers=${JSON.stringify(o.rest_events_versions).slice(0, 80)}`);
    if (o.sports?.length) {
      const names = o.sports.slice(0, 6).map(s => `${s.id}:${(s.name || s.code || "?").slice(0, 10)}`).join(", ");
      part1.push(`sample_sports:${names}`);
    }
    return `keys=${keys.join(",")} ${part1.join(" | ")}`;
  } catch {
    return `RAW:${body.slice(0, 100).replace(/\s+/g, " ")}`;
  }
}

(async () => {
  // ====== PARTE 1: Verificar jwt-service está UP ======
  console.log("=== [1/3] Health check jwt-service localhost:8787 ===");
  const h = await getLocal("/health");
  if (h.error) console.log("  ⚠️  jwt-service indisponível:", h.error);
  else {
    try {
      const o = JSON.parse(h.body);
      console.log(`  OK authenticated=${o.authenticated} cfSession.loaded=${o.cfSession?.loaded} cf_clearance=${o.cfSession?.cookieHas_cf_clearance} extraHeaders=${o.cfSession?.extraHeadersCount}`);
    } catch (e) {
      console.log(`  ⚠️  /health não é JSON? status=${h.status} body[:100]=${String(h.body).slice(0, 100)} err=${e.message}`);
    }
  }

  // ====== PARTE 2: Descobrir esportes disponiveis (IDs 0..20 + IDs extraídos do live/0) ======
  console.log("\n=== [2/3] Descobrindo IDs de esportes via /api/v4/live/brand/.../en/<id> (direto demoapi) ===");
  const candidateIds = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 3572980260248];
  const live0 = await httpsGet(`https://demoapi.betby.com/api/v4/live/brand/${BRAND}/${LANG}/0`, { auth: true, cookie: true });
  if (live0.status === 200) {
    try {
      const o = JSON.parse(live0.body);
      // extrai sportIds que aparecem como keys nos versions
      for (const v of [o.top_events_versions, o.rest_events_versions]) {
        if (v && typeof v === "object") {
          for (const k of Object.keys(v)) {
            const num = Number(k);
            if (Number.isFinite(num) && !candidateIds.includes(num)) candidateIds.push(num);
          }
        }
      }
    } catch {}
  }
  const workingLive = [];
  for (const id of candidateIds) {
    const r = await httpsGet(`https://demoapi.betby.com/api/v4/live/brand/${BRAND}/${LANG}/${id}`, { auth: true, cookie: true });
    const flag = r.status === 200 && !r.body.includes('"error":"access blocked') ? "✅" : (r.status === 200 ? "🟡" : "⚠️");
    if (flag === "✅") workingLive.push({ id, size: r.size, body: r.body });
    console.log(`  ${flag} live id=${id} status=${r.status} size=${r.size} ${summary(r.body).slice(0, 180)}`);
    await new Promise(res => setTimeout(res, 100));
  }

  console.log("\n=== [2b/3] Prematch /0 /1 /id_esportes_que_funcionaram ===");
  const pmIds = Array.from(new Set([0, 1, 2, 3, ...workingLive.map(x => x.id)]));
  for (const id of pmIds) {
    const r = await httpsGet(`https://demoapi.betby.com/api/v4/prematch/brand/${BRAND}/${LANG}/${id}`, { auth: true, cookie: true });
    const flag = r.status === 200 && !r.body.includes('"error":"access blocked') ? "✅" : (r.status === 200 ? "🟡" : "⚠️");
    console.log(`  ${flag} prematch id=${id} status=${r.status} size=${r.size} ${summary(r.body).slice(0, 180)}`);
    await new Promise(res => setTimeout(res, 100));
  }

  // ====== PARTE 3: Testar PROXY jwt-service (localhost:8787/betby-api-v4/...) ======
  console.log("\n=== [3/3] Testando o proxy do jwt-service localhost:8787/betby-api-v4/* ===");
  const proxyPaths = [
    `/betby-api-v4/api/v4/live/brand/${BRAND}/${LANG}/0`,
    `/betby-api-v4/api/v4/live/brand/${BRAND}/${LANG}/1`,
    `/betby-api-v4/api/v4/prematch/brand/${BRAND}/${LANG}/0`,
    `/betby-api-v4/api/v1/promo/widget/${BRAND}/${LANG}`,
  ];
  for (const p of proxyPaths) {
    const r = await getLocal(p);
    if (r.error) { console.log(`  ❌ ${p.slice(0, 90)} => ${r.error}`); continue; }
    const ok = r.status >= 200 && r.status < 300 && !(String(r.body).includes('"error":"access blocked'));
    const flag = ok ? "✅" : "⚠️";
    console.log(`  ${flag} status=${r.status} size=${r.size} ${p.slice(0, 90)}`);
    if (r.body) console.log(`         ${summary(r.body).slice(0, 200)}`);
  }
})();
