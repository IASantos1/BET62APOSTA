import http from "http";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BETBY_ROOT = resolve(__dirname, "..");
const BRAND = "1653815133341880320";
const LANG = "en";
const TREE_ID = "3572980260248";

function get(path) {
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

function summarize(body) {
  try {
    const o = JSON.parse(body);
    if (o.error) return `ERROR=${o.error}`;
    const keys = Object.keys(o);
    const bits = [];
    bits.push(`keys=${keys.join(",")}`);
    if (Array.isArray(o.sports)) {
      const sportsSample = o.sports.slice(0, 5).map(s => `${s.id}:${(s.name||s.code||"?").slice(0,10)}`).join(",");
      bits.push(`sports[${o.sports.length}]=${sportsSample}`);
    }
    if (Array.isArray(o.events)) bits.push(`events[${o.events.length}]`);
    if (Array.isArray(o.categories)) bits.push(`cats[${o.categories.length}]`);
    if (Array.isArray(o.tournaments)) bits.push(`trns[${o.tournaments.length}]`);
    if (o.epoch) bits.push(`epoch=${o.epoch}`);
    if (o.top_events_versions) bits.push(`topVers=${JSON.stringify(o.top_events_versions).slice(0, 80)}`);
    if (o.rest_events_versions) bits.push(`restVers=${JSON.stringify(o.rest_events_versions).slice(0, 80)}`);
    return bits.join(" | ");
  } catch {
    return `RAW(${body.length}b): ${body.slice(0, 120).replace(/\s+/g, " ")}`;
  }
}

const TESTS = [
  ["/health", "health (meta)"],
  ["/jwt", "jwt endpoint"],
  ["/v4/live", "atalho v4/live FULL TREE"],
  ["/v4/live/0", "atalho v4/live/0 META"],
  ["/v4/live/3572980260248", "atalho v4/live/{treeId} colado usuario 1"],
  ["/v4/live/3572980716346", "atalho v4/live/{treeId} colado usuario 2"],
  ["/v4/prematch", "atalho v4/prematch FULL TREE"],
  ["/v4/prematch/0", "atalho v4/prematch/0 META"],
  [`/betby-api-v4/api/v4/live/brand/${BRAND}/${LANG}/${TREE_ID}`, "path completo betby-api-v4 LIVE"],
  [`/betby-api-v4/api/v4/prematch/brand/${BRAND}/${LANG}/${TREE_ID}`, "path completo betby-api-v4 PREMATCH"],
];

(async () => {
  console.log(`TreeId default=${TREE_ID}`);
  for (const [path, label] of TESTS) {
    const r = await get(path);
    if (r.error) { console.log(`❌ ${label}\n   ${path.slice(0, 90)}\n   ERROR: ${r.error}\n`); continue; }
    const is2xx = r.status >= 200 && r.status < 300;
    const bodySum = summarize(r.body);
    const isError = bodySum.startsWith("ERROR=") || bodySum.includes("access blocked");
    const flag = is2xx && !isError ? "✅" : "⚠️";
    console.log(`${flag} ${label}`);
    console.log(`   status=${r.status} size=${r.size} ${path.slice(0, 120)}`);
    console.log(`   ${bodySum.slice(0, 300)}\n`);
  }
})();
