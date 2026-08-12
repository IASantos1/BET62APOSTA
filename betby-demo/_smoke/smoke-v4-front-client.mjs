import http from "http";

function getJson(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method: "GET",
      headers: { "Accept-Encoding": "identity" },
      timeout: 20000,
    }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, json: data ? JSON.parse(data) : {} });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data.slice(0, 300) });
        }
      });
    });
    req.on("timeout", () => { req.destroy(new Error("timeout")); });
    req.on("error", reject);
    req.end();
  });
}

const brand = "1653815133341880320";
const base = `http://localhost:8787/betby-api-v4/api/v4/live/brand/${brand}`;
const fallbacksIds = ["3572984491760","1786493713716","3572986388209","3572984467755","3572980716346","3572980260248"];

function countEvents(tree) {
  if (!tree) return 0;
  if (Array.isArray(tree.events)) return tree.events.length;
  if (tree.events && typeof tree.events === "object") return Object.keys(tree.events).length;
  return 0;
}

(async () => {
  console.log("=== 1) META /en/0 ===");
  const m = await getJson(`${base}/en/0`);
  console.log("HTTP", m.status, "version=", m.json?.version,
    "top_events=", m.json?.top_events_versions?.join?.(",") || m.json?.top_events_versions,
    "rest=", m.json?.rest_events_versions?.join?.(",") || m.json?.rest_events_versions,
    "status count=", m.json?.status ? Object.keys(m.json.status).length : 0);

  const dynamic = new Set();
  for (const v of m.json?.top_events_versions || []) dynamic.add(String(v));
  for (const v of m.json?.rest_events_versions || []) dynamic.add(String(v));
  if (m.json?.version) dynamic.add(String(m.json.version));
  for (const id of fallbacksIds) dynamic.add(id);

  console.log("\n=== 2) TREE candidates (total=", dynamic.size, ") ===");
  let best = null, bestId = null, bestC = -1;
  const tried = [];
  for (const id of Array.from(dynamic).slice(0, 10)) {
    try {
      const r = await getJson(`${base}/en/${id}`);
      const c = countEvents(r.json);
      tried.push({ id, http: r.status, events: c });
      if (c > bestC) { best = r.json; bestId = id; bestC = c; }
      console.log("  ", id, "HTTP", r.status, "events=", c,
        "sports=", r.json?.sports ? (Array.isArray(r.json.sports)?r.json.sports.length:Object.keys(r.json.sports).length):0,
        "cats=", r.json?.categories ? (Array.isArray(r.json.categories)?r.json.categories.length:Object.keys(r.json.categories).length):0,
        "trns=", r.json?.tournaments ? (Array.isArray(r.json.tournaments)?r.json.tournaments.length:Object.keys(r.json.tournaments).length):0,
        "status=", r.json?.status?Object.keys(r.json.status).length:0,
        "keys=", r.json?Object.keys(r.json).slice(0,10).join(","):null);
      if (c > 0) { console.log("   → HIT events>0, parando!"); break; }
    } catch (e) {
      tried.push({ id, err: e.message });
      console.log("  ", id, "ERR", e.message);
    }
  }
  console.log("\n=== 3) BEST =", bestId, "events=", bestC, "===");

  console.log("\n=== 4) EVENTO INDIVIDUAL 2696059837283966992 ===");
  try {
    const ev = await getJson(`${base}/event/en/2696059837283966992`);
    const evCount = ev.json?.events && !Array.isArray(ev.json.events) ? Object.keys(ev.json.events).length : 0;
    const firstVal = evCount > 0 ? Object.values(ev.json.events)[0] : null;
    const firstMarkets = firstVal?.markets ? Object.keys(firstVal.markets).length : 0;
    const firstKeys = firstVal ? Object.keys(firstVal).slice(0, 20) : [];
    console.log("HTTP", ev.status, "events.count=", evCount,
      "firstKeys=", firstKeys.join(","),
      "first.markets=", firstMarkets);
    if (firstMarkets > 0) {
      const mk1id = Object.keys(firstVal.markets)[0];
      const scopes = firstVal.markets[mk1id];
      const sc1id = Object.keys(scopes)[0];
      const outs = scopes[sc1id];
      const out1id = Object.keys(outs)[0];
      const o1 = outs[out1id];
      console.log("  SAMPLE odd: market=", mk1id, "scope=", sc1id, "outcome.k=", o1?.k, "outcome.name=", o1?.name);
    }
  } catch (e) {
    console.log("ERR", e.message);
  }
})();
