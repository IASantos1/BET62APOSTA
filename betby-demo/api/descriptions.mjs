import { ensureJwt, getJwt, getBrandId, getApiBase } from "../jwt-service.mjs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { writeFileSync, existsSync, mkdirSync } from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DUMP_DIR = join(__dirname, "..", ".dumps");

function ensureDumpDir() {
  if (!existsSync(DUMP_DIR)) mkdirSync(DUMP_DIR, { recursive: true });
}

function buildDescriptionUrl(apiBase, brandId, eventId, lang = "en") {
  return `${apiBase}/api/v3/descriptions/brand/${brandId}/event/${eventId}/${lang}`;
}

export async function fetchEventDescription(eventId, options = {}) {
  const { lang = "en", jwt = null, brandId = null, dump = false } = options;

  if (!eventId) throw new Error("eventId é obrigatório");

  const creds = jwt && brandId ? { jwt, brandId } : await ensureJwt();
  const token = jwt || creds.jwt;
  const bid = brandId || creds.brandId || getBrandId();
  const url = buildDescriptionUrl(getApiBase(), bid, eventId, lang);

  console.log(`[desc] GET /descriptions/.../event/${eventId}`);
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
    const file = join(DUMP_DIR, `desc-${eventId}-${ts}.json`);
    writeFileSync(file, JSON.stringify(data, null, 2));
    console.log(`[desc] Dump salvo em ${file}`);
  }

  return { ok: res.ok, status: res.status, data, url };
}

export function normalizeDescription(d) {
  if (!d) return null;
  const root = d?.data || d?.event || d?.description || d;
  return {
    id: root.id || root.event_id,
    name: root.name || root.event_name,
    sport: root.sport?.name || root.sport_name,
    league: root.league?.name || root.tournament?.name,
    home: {
      id: root.home?.id,
      name: root.home?.name,
      logo: root.home?.logo || root.home?.image,
    },
    away: {
      id: root.away?.id,
      name: root.away?.name,
      logo: root.away?.logo || root.away?.image,
    },
    venue: root.venue || root.stadium || null,
    referee: root.referee || null,
    attendance: root.attendance || null,
    startedAt: root.start_time || root.kickoff || root.started_at,
    elapsed: root.elapsed || root.current_time,
    score: {
      home: root.score?.home ?? root.result_1 ?? null,
      away: root.score?.away ?? root.result_2 ?? null,
      ht: root.ht_score || { home: root.ht1 ?? null, away: root.ht2 ?? null },
      ft: root.ft_score || null,
    },
    markets: root.markets
      ? root.markets.map((m) => ({
          id: m.id,
          name: m.name,
          group: m.group,
          outcomes: m.outcomes?.map?.((o) => ({
            id: o.id,
            name: o.name,
            price: o.price || o.odds,
            line: o.line ?? o.handicap ?? null,
          })),
        }))
      : [],
    statistics: root.statistics || root.stats || null,
    miniPitch: root.mini_field || root.mini_pitch || root.pitch || null,
    tracker: root.tracker || root.live_tracker || null,
    raw: d,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const eventId = args[0] || process.env.EVENT_ID;
  if (!eventId) {
    console.error("Uso: node descriptions.mjs <eventId> [--dump]");
    console.error("Exemplo: node descriptions.mjs 2672006592026779683 --dump");
    process.exit(1);
  }
  const dump = args.includes("--dump");
  fetchEventDescription(eventId, { dump })
    .then((r) => {
      console.log(`[desc] Status=${r.status}`);
      const norm = normalizeDescription(r.data);
      if (norm) {
        console.log(`  ${norm.home?.name} x ${norm.away?.name}`);
        console.log(`  Placar: ${norm.score?.home} - ${norm.score?.away}`);
        console.log(`  Mercados: ${norm.markets?.length ?? 0}`);
      } else {
        console.log("  Sem descrição normalizada.");
      }
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
