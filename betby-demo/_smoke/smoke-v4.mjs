import http from "http";

const HOST = "localhost";
const PORT = 8787;
const BRAND = "1653815133341880320";

function get(path) {
  return new Promise((resolve) => {
    const req = http.request(
      { host: HOST, port: PORT, path, method: "GET", headers: { "Accept": "application/json" } },
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

const TESTS = [
  ["/health", "health"],
  [`/betby/api/v2/customisator/themes`, "customisator themes (demo.betby.com com Bearer)"],
  [`/betby-api-v4/api/v1/promo/tournaments/brand/${BRAND}/lang/en`, "promo tournaments brand (demoapi Bearer)"],
  [`/betby-api-v4/api/v1/promo/widget/${BRAND}/en`, "promo widget (demoapi Bearer)"],
  [`/betby-api-v4/api/v4/sports/events/live/list?brandId=${BRAND}&lang=en`, "v4 live list"],
  [`/betby-api-v4/api/v4/sports/events/prematch/list?brandId=${BRAND}&lang=en`, "v4 prematch list"],
  [`/betby-api-v4/api/v4/sports/list?brandId=${BRAND}&lang=en`, "v4 sports list"],
];

(async () => {
  for (const [path, label] of TESTS) {
    const r = await get(path);
    if (r.error) {
      console.log(`\n❌ ${label}\n   ${path}\n   ERROR: ${r.error}`);
      continue;
    }
    let preview = "";
    try {
      const isJson = /json/.test(r.headers["content-type"] || "") || r.body.trim().startsWith("{") || r.body.trim().startsWith("[");
      if (r.body && isJson) {
        const o = JSON.parse(r.body);
        preview = ` | keys=${Object.keys(o).slice(0, 8).join(",")}`;
        if (Array.isArray(o.data)) preview += ` | data.length=${o.data.length}`;
        if (o.error) preview += ` | error="${o.error}"`;
        if (o.message) preview += ` | msg="${String(o.message).slice(0,80)}"`;
      } else {
        preview = ` | body_preview="${r.body.slice(0, 160).replace(/\s+/g, " ")}"`;
      }
    } catch (e) {
      preview = ` | PARSE_ERR ${e.message} | raw="${r.body.slice(0, 160)}"`;
    }
    const ok = r.status >= 200 && r.status < 300 ? "✅" : "⚠️";
    console.log(`${ok} ${label}\n   ${path}\n   status=${r.status} size=${r.size}${preview}`);
  }
})();
