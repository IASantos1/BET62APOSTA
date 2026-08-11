import { readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
const base = process.cwd();
const files = [
  { label: "betby-v4-live", rel: "betby-demo/dumps/smoke_live.json" },
  { label: "betby-v4-prematch", rel: "betby-demo/dumps/smoke_prematch.json" },
  { label: "betby-sptpub-sports", rel: "betby-demo/dumps/smoke_sptpub.json" },
];
for (const f of files) {
  const path = join(base, f.rel);
  const line = () => console.log("\n" + "=".repeat(70) + "\n  " + f.label + "\n" + "=".repeat(70));
  if (!existsSync(path)) { line(); console.log("(arquivo ainda NAO GERADO — curl nao rodou pra ele ainda)"); continue; }
  const sz = statSync(path).size;
  const raw = readFileSync(path, "utf8");
  line();
  console.log("tamanho_bytes:", sz);
  console.log("head_400chars:", raw.slice(0, 400).replace(/\s+/g, " "));
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch (e) {
    console.log("NAO_EH_JSON. Erro:", e.message.split("\n")[0]);
    if (raw.startsWith("<!doctype") || raw.startsWith("<html")) console.log("resposta_HTML (BetBY bloqueou/redirecionou?)");
    continue;
  }
  const t = Array.isArray(parsed) ? "array[" + parsed.length + "]" : typeof parsed;
  console.log("tipo_parsed:", t);
  if (Array.isArray(parsed)) {
    console.log("elementos_count:", parsed.length);
    if (parsed[0]) console.log("primeiro_chaves:", Object.keys(parsed[0]).slice(0, 20).join(", "));
  } else if (parsed && typeof parsed === "object") {
    const topKeys = Object.keys(parsed);
    console.log("topo_chaves (" + topKeys.length + "):", topKeys.join(", "));
    // keys comuns BetBY
    for (const k of ["data", "events", "items", "result", "sports", "leagues", "matches", "live"]) {
      if (k in parsed && Array.isArray(parsed[k])) console.log(`  • ${k}: array com ${parsed[k].length} itens`);
      else if (k in parsed && parsed[k] && typeof parsed[k] === "object") console.log(`  • ${k}: objeto com chaves -> ` + Object.keys(parsed[k]).slice(0, 10).join(", "));
    }
    // se tem data (o mais comum)
    if ("data" in parsed) {
      const d = parsed.data;
      if (Array.isArray(d)) {
        console.log("\nPrimeiro evento (se data[0] existe):");
        const e0 = d[0];
        if (e0) {
          const ek = Object.keys(e0);
          console.log("  chaves:", ek.slice(0, 30).join(", "));
          const pick = {};
          for (const want of ["id","eventId","sportId","sport_name","leagueName","tournamentName","leagueId","tournamentId","homeName","awayName","team1Name","team2Name","team1","team2","startDate","startTime","kickoffTime","status","markets","marketCount","isLive","liveData","score","currentScore"]) {
            if (want in e0) pick[want] = typeof e0[want] === "object" ? (Array.isArray(e0[want]) ? `array[${e0[want].length}]` : `object(${Object.keys(e0[want]).slice(0,5).join(",")})`) : e0[want];
          }
          console.log("  resumo:", JSON.stringify(pick, null, 2).replace(/^/gm, "    ").slice(4));
          if (Array.isArray(e0.markets) && e0.markets[0]) {
            const m0 = e0.markets[0];
            console.log("\n  Primeiro market (markets[0]):");
            const mp = {};
            for (const mw of ["id","name","type","order","outcomes","outcomeName"]) if (mw in m0) mp[mw] = (Array.isArray(m0[mw])?`array[${m0[mw].length}]`:m0[mw]);
            console.log("    resumo:", JSON.stringify(mp, null, 2).replace(/^/gm,"      ").slice(6));
          }
        }
      } else if (d && typeof d === "object") {
        console.log("  data: objeto -> chaves:", Object.keys(d).slice(0, 20).join(", "));
      }
    }
  }
}
