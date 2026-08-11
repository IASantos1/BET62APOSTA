import { ensureJwt, getJwt, getBrandId, getApiBase } from "../jwt-service.mjs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { writeFileSync, existsSync, mkdirSync } from "fs";
import http from "http";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DUMP_DIR = join(__dirname, "..", ".dumps");

function ensureDumpDir() {
  if (!existsSync(DUMP_DIR)) mkdirSync(DUMP_DIR, { recursive: true });
}

function buildLiveUrl(apiBase, brandId, lang = "en", offset = 0) {
  return `${apiBase}/api/v4/live/brand/${brandId}/${lang}/${offset}`;
}

export async function fetchLiveEvents(options = {}) {
  const {
    lang = "en",
    offset = 0,
    jwt = null,
    brandId = null,
    dump = false,
  } = options;

  const creds = jwt && brandId ? { jwt, brandId } : await ensureJwt();
  const token = jwt || creds.jwt;
  const bid = brandId || creds.brandId || getBrandId();
  const url = buildLiveUrl(getApiBase(), bid, lang, offset);

  console.log(`[live] GET ${url.replace(getApiBase(), "<API>")}`);
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "User-Agent": "Bet62-Betby-Client/1.0",
    },
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  if (dump) {
    ensureDumpDir();
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const file = join(DUMP_DIR, `live-${ts}.json`);
    writeFileSync(file, JSON.stringify(data, null, 2));
    console.log(`[live] Dump salvo em ${file}`);
  }

  if (!res.ok) {
    console.error(`[live] HTTP ${res.status}: ${res.statusText}`);
    if (res.status === 401) console.error("[live] Token expirado ou inválido. Use force=1.");
  }

  return {
    ok: res.ok,
    status: res.status,
    data,
    url,
    count: Array.isArray(data?.items) ? data.items.length : Array.isArray(data) ? data.length : 0,
  };
}

export function normalizeLiveItems(payload) {
  const items =
    payload?.items ||
    payload?.data?.items ||
    payload?.events ||
    (Array.isArray(payload) ? payload : []);
  return items.map((ev) => ({
    id: ev.id || ev.event_id || ev.externalId,
    sport: ev.sport?.name || ev.sport_name || ev.sport,
    sportId: ev.sport?.id || ev.sport_id,
    league: ev.league?.name || ev.tournament?.name || ev.league_name,
    leagueId: ev.league?.id || ev.tournament?.id,
    home: ev.home?.name || ev.team1_name || ev.home_name,
    away: ev.away?.name || ev.team2_name || ev.away_name,
    homeId: ev.home?.id || ev.team1_id,
    awayId: ev.away?.id || ev.team2_id,
    score: {
      home: ev.score?.home ?? ev.result_1 ?? null,
      away: ev.score?.away ?? ev.result_2 ?? null,
    },
    elapsed: ev.elapsed ?? ev.current_time ?? null,
    startedAt: ev.started_at || ev.start_time || ev.kickoff,
    isLive: ev.is_live ?? true,
    marketsCount: ev.markets_count ?? ev.markets ?? 0,
    raw: ev,
  }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const port = Number(args[0] || process.env.PORT || 8788);
  const mode = args.includes("--server") ? "server" : "once";

  if (mode === "server") {
    const server = http.createServer(async (req, res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      const u = new URL(req.url, `http://localhost:${port}`);
      if (u.pathname === "/health") {
        res.writeHead(200);
        return res.end(JSON.stringify({ ok: true, service: "betby-live" }));
      }
      if (u.pathname === "/live") {
        const lang = u.searchParams.get("lang") || "en";
        const offset = Number(u.searchParams.get("offset") || 0);
        const normalize = u.searchParams.get("normalize") !== "0";
        try {
          const r = await fetchLiveEvents({ lang, offset });
          res.writeHead(r.status);
          const body = normalize && r.ok
            ? { ...r, data: normalizeLiveItems(r.data) }
            : r;
          return res.end(JSON.stringify(body));
        } catch (e) {
          res.writeHead(500);
          return res.end(JSON.stringify({ error: e.message }));
        }
      }
      res.writeHead(404);
      res.end(JSON.stringify({ error: "not_found" }));
    });
    server.listen(port, () => {
      console.log(`[live] HTTP server em http://localhost:${port}/live`);
    });
  } else {
    fetchLiveEvents({ dump: true })
      .then((r) => {
        console.log(`[live] Status=${r.status} | Items=${r.count}`);
        const norm = normalizeLiveItems(r.data);
        norm.slice(0, 5).forEach((e) => {
          console.log(`  • ${e.sport} | ${e.league} | ${e.home} x ${e.away} — ${e.score.home}-${e.score.away}`);
        });
        if (norm.length > 5) console.log(`  ... +${norm.length - 5} eventos`);
      })
      .catch((e) => {
        console.error(e);
        process.exit(1);
      });
  }
}
