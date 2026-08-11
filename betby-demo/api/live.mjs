import { ensureJwt, getJwt, getBrandId, getApiBase } from "../jwt-service.mjs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { writeFileSync, existsSync, mkdirSync } from "fs";
import http from "http";
import { listenWithFallback } from "../scripts/port-utils.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DUMP_DIR = join(__dirname, "..", ".dumps");

const UPSTREAMS = {
  sptpub: {
    label: "sptpub (v4)",
    base: () => getApiBase(),
    liveUrl: (apiBase, bid, lang, sportIdOr0) =>
      `${apiBase}/api/v4/live/brand/${bid}/${lang}/${sportIdOr0}`,
    prematchUrl: (apiBase, bid, lang, sportIdOr0) =>
      `${apiBase}/api/v4/prematch/brand/${bid}/${lang}/${sportIdOr0}`,
    needsAuth: true,
  },
  demoapi: {
    label: "demoapi.betby.com (v4 live/prematch + v1 promo/widget)",
    base: () => "https://demoapi.betby.com",
    liveUrl: (apiBase, bid, lang, sportIdOr0) =>
      `${apiBase}/api/v4/live/brand/${bid}/${lang}/${sportIdOr0}`,
    prematchUrl: (apiBase, bid, lang, sportIdOr0) =>
      `${apiBase}/api/v4/prematch/brand/${bid}/${lang}/${sportIdOr0}`,
    promoWidgetUrl: (apiBase, bid, lang) =>
      `${apiBase}/api/v1/promo/widget/${bid}/${lang}`,
    needsAuth: true,
  },
  demoUI: {
    label: "demo.betby.com (customisator/themes)",
    base: () => "https://demo.betby.com",
    customisatorThemesUrl: (apiBase) => `${apiBase}/api/v2/customisator/themes`,
    needsAuth: true,
  },
  staticThemes: {
    label: "bt-app-static-themes.sptpub.com (theme.json tile)",
    base: () => "https://bt-app-static-themes.sptpub.com",
    blueDarkTile: (apiBase) => `${apiBase}/master/betby-demo-blue-dark-tile/theme.json`,
    needsAuth: false,
  },
};

function ensureDumpDir() {
  if (!existsSync(DUMP_DIR)) mkdirSync(DUMP_DIR, { recursive: true });
}

function headersWithToken(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
    Origin: "https://demo.betby.com",
    Referer: "https://demo.betby.com/",
  };
}

export async function fetchBetbyEvents(options = {}) {
  const {
    mode = "live",
    lang = "en",
    sportId = 0,
    jwt = null,
    brandId = null,
    dump = false,
    upstream = "demoapi",
  } = options;

  const up = UPSTREAMS[upstream] || UPSTREAMS.demoapi;
  const creds = jwt && brandId ? { jwt, brandId } : await ensureJwt();
  const token = jwt || creds.jwt;
  const bid = brandId || creds.brandId || getBrandId();
  const apiBase = up.base();

  const url = mode === "prematch"
    ? up.prematchUrl(apiBase, bid, lang, sportId || 0)
    : up.liveUrl(apiBase, bid, lang, sportId || 0);

  console.log(`[live/${mode}/${upstream}] GET ${url.replace(apiBase, "<" + upstream + ">")}`);
  const res = await fetch(url, { headers: headersWithToken(token) });

  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }

  if (dump) {
    ensureDumpDir();
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const file = join(DUMP_DIR, `${mode}-${upstream}-sport${sportId || 0}-${ts}.json`);
    writeFileSync(file, JSON.stringify(data, null, 2));
    console.log(`[live/${mode}/${upstream}] Dump salvo em ${file}`);
  }

  if (!res.ok) {
    console.error(`[live/${mode}/${upstream}] HTTP ${res.status}: ${res.statusText}`);
    if (res.status === 401) console.error(`[live/${mode}/${upstream}] Token expirado ou inválido.`);
  }

  const countFirst = Array.isArray(data?.items) ? data.items.length :
    Array.isArray(data?.events) ? data.events.length :
    Array.isArray(data?.rest) ? (data.top?.length || 0) + data.rest.length :
    Array.isArray(data) ? data.length : 0;

  return {
    ok: res.ok,
    status: res.status,
    mode,
    upstream,
    upstreamBase: apiBase,
    url,
    data,
    sportId,
    brandId: bid,
    lang,
    count: countFirst,
  };
}

async function rawGet(label, url, { jwt, dump, filename, acceptAuth = true } = {}) {
  const creds = jwt ? { jwt } : (acceptAuth ? await ensureJwt() : { jwt: null });
  const token = acceptAuth ? creds.jwt : null;
  const baseHeaders = headersWithToken(token || "x");
  if (!token) delete baseHeaders.Authorization;
  baseHeaders.Accept = baseHeaders.Accept || "*/*";
  console.log(`[${label}] GET ${url}`);
  const r = await fetch(url, { headers: baseHeaders });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (dump) {
    ensureDumpDir();
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const f = filename ? filename.replace(/\$\{ts\}/g, ts) : `${label}-${ts}.json`;
    writeFileSync(join(DUMP_DIR, f), typeof data === "string" ? data : JSON.stringify(data, null, 2));
  }
  return { ok: r.ok, status: r.status, url, data };
}

export async function fetchCustomisatorThemes(options = {}) {
  const up = UPSTREAMS.demoUI;
  const url = up.customisatorThemesUrl(up.base());
  return rawGet("customisator-themes", url, { jwt: options.jwt, dump: options.dump });
}

export async function fetchPromoWidget(options = {}) {
  const lang = options.lang || "en";
  const up = UPSTREAMS.demoapi;
  const creds = options.jwt && options.brandId ? { jwt: options.jwt, brandId: options.brandId } : await ensureJwt();
  const bid = options.brandId || creds.brandId || getBrandId();
  const url = up.promoWidgetUrl(up.base(), bid, lang);
  return rawGet("promo-widget", url, { jwt: creds.jwt, dump: options.dump });
}

export async function fetchTileTheme(options = {}) {
  const up = UPSTREAMS.staticThemes;
  const url = up.blueDarkTile(up.base());
  return rawGet("static-theme-tile", url, { jwt: null, acceptAuth: false, dump: options.dump });
}

export function normalizeLiveItems(payload) {
  const items =
    payload?.items ||
    payload?.data?.items ||
    payload?.events ||
    (Array.isArray(payload) ? payload : []);
  const top = Array.isArray(payload?.top) ? payload.top : [];
  const rest = Array.isArray(payload?.rest) ? payload.rest : [];
  const pool = items.length ? items : [...top, ...rest];

  return pool.map((ev) => ({
    id: ev.id || ev.event_id || ev.externalId || ev.eid,
    sport: ev.sport?.name || ev.sport_name || ev.sport,
    sportId: ev.sport?.id || ev.sport_id || ev.sid,
    league: ev.league?.name || ev.tournament?.name || ev.league_name,
    leagueId: ev.league?.id || ev.tournament?.id || ev.lid,
    home: ev.home?.name || ev.team1_name || ev.home_name || ev.teams?.[0]?.name,
    away: ev.away?.name || ev.team2_name || ev.away_name || ev.teams?.[1]?.name,
    homeId: ev.home?.id || ev.team1_id,
    awayId: ev.away?.id || ev.team2_id,
    score: {
      home: ev.score?.home ?? ev.result_1 ?? ev.scores?.[0] ?? null,
      away: ev.score?.away ?? ev.result_2 ?? ev.scores?.[1] ?? null,
    },
    elapsed: ev.elapsed ?? ev.current_time ?? ev.minute ?? null,
    startedAt: ev.started_at || ev.start_time || ev.kickoff || ev.starts_at,
    isLive: ev.is_live ?? ev.live ?? true,
    marketsCount: ev.markets_count ?? ev.markets ?? ev.total_markets ?? 0,
    raw: ev,
  }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const port = Number(args.find(a => /^\d+$/.test(a)) || process.env.PORT || 8788);
  const modeServer = args.includes("--server") || args.includes("server");

  if (modeServer) {
    const server = http.createServer(async (req, res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      const u = new URL(req.url, `http://localhost:${port}`);

      if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
      if (u.pathname === "/health") {
        res.writeHead(200);
        return res.end(JSON.stringify({ ok: true, service: "betby-live", upstreams: Object.keys(UPSTREAMS) }));
      }
      if (u.pathname === "/live" || u.pathname === "/prematch") {
        const mode = u.pathname === "/prematch" ? "prematch" : "live";
        const lang = u.searchParams.get("lang") || "en";
        const sportId = u.searchParams.get("sportId") || u.searchParams.get("offset") || 0;
        const upstream = UPSTREAMS[u.searchParams.get("src")] ? u.searchParams.get("src") : "demoapi";
        const normalize = u.searchParams.get("normalize") !== "0";
        try {
          const r = await fetchBetbyEvents({ mode, lang, sportId, upstream, dump: u.searchParams.get("dump") === "1" });
          res.writeHead(r.status);
          const body = normalize && r.ok
            ? { ...r, data: { ...r.data, items: normalizeLiveItems(r.data) } }
            : r;
          return res.end(JSON.stringify(body));
        } catch (e) {
          res.writeHead(500);
          return res.end(JSON.stringify({ error: e.message }));
        }
      }
      if (u.pathname === "/upstreams") {
        res.writeHead(200);
        return res.end(JSON.stringify(Object.fromEntries(
          Object.entries(UPSTREAMS).map(([k, v]) => [k, { label: v.label, base: v.base() }])
        )));
      }
      if (u.pathname === "/themes" || u.pathname === "/customisator/themes") {
        try {
          const r = await fetchCustomisatorThemes({ dump: u.searchParams.get("dump") === "1" });
          res.writeHead(r.status);
          return res.end(JSON.stringify(r));
        } catch (e) { res.writeHead(500); return res.end(JSON.stringify({ error: e.message })); }
      }
      if (u.pathname === "/promo/widget" || u.pathname.startsWith("/api/v1/promo/widget/")) {
        try {
          const parts = u.pathname.split("/").filter(Boolean);
          const guessBrand = parts[4] || null;
          const guessLang = parts[5] || null;
          const r = await fetchPromoWidget({
            lang: guessLang || u.searchParams.get("lang") || "en",
            brandId: guessBrand || u.searchParams.get("brandId") || undefined,
            dump: u.searchParams.get("dump") === "1",
          });
          res.writeHead(r.status);
          return res.end(JSON.stringify(r));
        } catch (e) { res.writeHead(500); return res.end(JSON.stringify({ error: e.message })); }
      }
      if (u.pathname === "/static-theme" || u.pathname.endsWith("/betby-demo-blue-dark-tile/theme.json")) {
        try {
          const r = await fetchTileTheme({ dump: u.searchParams.get("dump") === "1" });
          res.writeHead(r.status);
          return res.end(JSON.stringify(r));
        } catch (e) { res.writeHead(500); return res.end(JSON.stringify({ error: e.message })); }
      }
      res.writeHead(404);
      res.end(JSON.stringify({
        error: "not_found",
        routes: [
          "/health",
          "/live?lang=en&sportId=0&src=demoapi|sptpub&normalize=1",
          "/prematch?lang=en&sportId=0&src=demoapi|sptpub&normalize=1",
          "/upstreams",
          "/themes  (-> demo.betby.com /api/v2/customisator/themes)",
          "/promo/widget?brandId=X&lang=en   (-> demoapi.betby.com)",
          "/static-theme  (-> bt-app-static-themes.sptpub.com /master/betby-demo-blue-dark-tile/theme.json)",
        ],
      }));
    });
    await listenWithFallback(server, port, {
      label: "live-api",
      onListen: (p) => {
        console.log(`[live] HTTP em http://localhost:${p}`);
        console.log(`[live]   /live        -> live events (demoapi default)`);
        console.log(`[live]   /prematch    -> prematch events`);
        console.log(`[live]   ?src=demoapi | ?src=sptpub`);
        console.log(`[live]   ?sportId=0 (0=todos, ex: 3572968592260 = filtrar esporte)`);
        console.log(`[live]   /upstreams    -> lista hosts disponiveis`);
        console.log(`[live]   /themes       -> customisator themes (demo.betby.com v2)`);
        console.log(`[live]   /promo/widget?brandId=X&lang=en`);
        console.log(`[live]   /static-theme -> tema tile (betby-demo-blue-dark-tile/theme.json)`);
      },
    });
  } else {
    const upstream = args.includes("--sptpub") ? "sptpub" : "demoapi";
    const mode = args.includes("--prematch") ? "prematch" : "live";
    const sportArg = args.find((a) => /^--sportId=\d+$/.test(a));
    const sportId = sportArg ? Number(sportArg.split("=")[1]) : 0;
    const langArg = args.find((a) => /^--lang=/.test(a));
    const lang = langArg ? langArg.split("=")[1] : "en";
    const dump = args.includes("--dump");
    const onlyThemes = args.includes("--themes");
    const onlyPromo = args.includes("--promo");
    const onlyTileTheme = args.includes("--tile-theme");

    if (onlyThemes) {
      fetchCustomisatorThemes({ dump }).then((r) => {
        console.log(`[customisator-themes] status=${r.status} keys=${r.data && typeof r.data === "object" ? Object.keys(r.data).slice(0,10).join(",") : "?"}`);
      }).catch(fatal);
    } else if (onlyPromo) {
      fetchPromoWidget({ lang, dump }).then((r) => {
        console.log(`[promo-widget] status=${r.status} type=${typeof r.data} keys=${r.data && typeof r.data === "object" ? Object.keys(r.data).slice(0,10).join(",") : "?"}`);
      }).catch(fatal);
    } else if (onlyTileTheme) {
      fetchTileTheme({ dump }).then((r) => {
        console.log(`[static-theme-tile] status=${r.status} keys=${r.data && typeof r.data === "object" ? Object.keys(r.data).slice(0,10).join(",") : "?"}`);
      }).catch(fatal);
    } else {
      fetchBetbyEvents({ mode, upstream, sportId, lang, dump })
        .then(async (r) => {
          console.log(`[${mode}/${r.upstream}] Status=${r.status} | Items=${r.count}`);
          const norm = normalizeLiveItems(r.data);
          norm.slice(0, 6).forEach((e) => {
            const sc = (e.score.home ?? "?") + "-" + (e.score.away ?? "?");
            console.log(`  • ${e.sport || "?"} | ${e.league || "?"} | ${e.home || "?"} x ${e.away || "?"} — ${sc}`);
          });
          if (norm.length > 6) console.log(`  ... +${norm.length - 6} eventos`);
          if (r.count === 0 && r.data) console.log("[dica] payload keys:", Object.keys(r.data).slice(0, 12));
        })
        .catch(fatal);
    }
  }
}

function fatal(e) { console.error(e); process.exit(1); }

export default {
  fetchBetbyEvents,
  fetchCustomisatorThemes,
  fetchPromoWidget,
  fetchTileTheme,
  normalizeLiveItems,
  UPSTREAMS,
};
