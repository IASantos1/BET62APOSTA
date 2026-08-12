// Cliente BetBY v4 real com SUPORTE DUAL de formatos:
//   SCHEMA A (treeId grandes URLs coladas inicial): events/sports/categories/tournaments = ARRAY
//   SCHEMA B (treeId = VERSION ID / `/0` meta): events/status = OBJETO Record<key, payload>
//     - events: Record<string, { markets, state, score }>
//     - status: Record<string, number> (provider hashes)
// Acesso via Vite proxy: /betby/* -> http://127.0.0.1:8787 (jwt-service.mjs)

export type BetbyKind = "live" | "prematch";

export interface BetbySport {
  id: number;
  code?: string;
  name?: string;
  order?: number;
  popular?: boolean;
  has_live?: boolean;
  icon?: string;
  [k: string]: any;
}

export interface BetbyCategory {
  id: number;
  sport_id: number;
  name?: string;
  country?: string;
  country_code?: string;
  region?: string;
  order?: number;
  [k: string]: any;
}

export interface BetbyTournament {
  id: number;
  category_id: number;
  sport_id: number;
  name?: string;
  order?: number;
  popular?: boolean;
  [k: string]: any;
}

export interface BetbyOutcome {
  id?: string | number;
  type?: string;
  handicap?: number;
  total?: number;
  price: number;
  name?: string;
  raw?: any;
}

export interface BetbyMarketScope {
  scope: string;
  outcomes: BetbyOutcome[];
}

export interface BetbyMarket {
  id: number;
  name?: string;
  order?: number;
  scopes: BetbyMarketScope[];
  outcomes: BetbyOutcome[];
  countOutcomes: number;
}

export interface BetbyEventState {
  provider?: string;
  status?: number;
  match_status?: number;
  clock?: {
    match_time?: string;
    stopped?: boolean;
    timestamp?: number;
  };
  [k: string]: any;
}

export interface BetbyEventScore {
  home_score?: string | number;
  away_score?: string | number;
  period_scores?: Array<{
    match_status_code?: number;
    number?: number;
    home_score?: number;
    away_score?: number;
    [k: string]: any;
  }>;
  [k: string]: any;
}

export interface BetbyEvent {
  id: number;
  sport_id: number;
  category_id: number;
  tournament_id: number;
  name?: string;
  home?: string;
  away?: string;
  team1_name?: string;
  team2_name?: string;
  kickoff?: number;
  start_ts?: number;
  status?: "upcoming" | "live" | "ended" | string;
  live?: boolean;
  live_time?: string;
  score?: string | null;
  home_score?: number;
  away_score?: number;
  clock?: { minute?: number; second?: number; period?: string | number };
  markets?: BetbyMarket[];
  market_count?: number;
  top?: boolean;
  version?: number;
  // SCHEMA B extras:
  state?: BetbyEventState;
  score_obj?: BetbyEventScore;
  provider?: string;
  status_code?: number;
  match_status_code?: number;
  raw_key?: string;
  [k: string]: any;
}

export interface BetbyMeta {
  epoch: number;
  version: number;
  top_events_versions?: number[];
  rest_events_versions?: number[];
  generated: number;
  status?: string | Record<string, number>;
  [k: string]: any;
}

export interface BetbyFullTree extends BetbyMeta {
  sports?: BetbySport[] | Record<string | number, BetbySport>;
  categories?: BetbyCategory[] | Record<string | number, BetbyCategory>;
  tournaments?: BetbyTournament[] | Record<string | number, BetbyTournament>;
  events?: BetbyEvent[] | Record<string | number, Omit<BetbyEvent, "id"> & { [k: string]: any }>;
}

export interface BetbyBootstrap {
  jwt: string;
  brandId: string;
  v4DefaultTreeId: string;
  v4LiveFullTree: string;
  v4LiveMeta: string;
  v4PrematchFullTree: string;
  v4PrematchMeta: string;
  trackerShortcut: string;
  [k: string]: any;
}

export interface BetbyHealth {
  ok: boolean;
  authenticated: boolean;
  brandId: string;
  cfSession: {
    loaded: boolean;
    capturedAt?: string;
    userAgent?: string;
    extraHeadersCount?: number;
    cookieHas_cf_clearance?: boolean;
    cookieHas___cf_bm?: boolean;
  };
  v4Patterns: {
    note: string;
    rootMeta: string;
    fullTree: string;
    autoResolve?: any;
    shortcutsHosted: string[];
  };
  routes: string[];
  [k: string]: any;
}

const BETBY_PREFIX = "/betby";
const BETBY_V4_DEFAULT_BRAND_ID = "1653815133341880320";
const BETBY_V4_DEFAULT_LANG = "en";
const BETBY_V4_REAL_BASE = "/betby-api-v4/api/v4";
const BETBY_V4_FALLBACK_TREE_IDS = [
  "3572984491760",
  "1786493713716",
  "3572986388209",
  "3572984467755",
  "3572980716346",
  "3572980260248",
];

export const BETBY_CONSTS = {
  brandId: BETBY_V4_DEFAULT_BRAND_ID,
  lang: BETBY_V4_DEFAULT_LANG,
  defaultTreeIds: BETBY_V4_FALLBACK_TREE_IDS,
};

export function betbyUrl(path: string) {
  if (!path.startsWith("/")) path = "/" + path;
  if (path.startsWith("/health") || path.startsWith("/jwt")) return path;
  if (path.startsWith("/betby-api-v4") || path.startsWith("/betby-api") || path.startsWith("/betby-tracker") || path.startsWith("/betby-static") || path.startsWith("/tracker") || path.startsWith("/translate") || path.startsWith("/v4")) return path;
  return BETBY_PREFIX + path;
}

function realV4Url(kind: BetbyKind, tail: string) {
  return `${BETBY_V4_REAL_BASE}/${kind}/brand/${BETBY_V4_DEFAULT_BRAND_ID}/${tail}`;
}

export async function betbyFetch<T = any>(
  path: string,
  init?: RequestInit & { timeout?: number }
): Promise<T> {
  const { timeout = 30_000, signal, ...rest } = init || {};
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeout);
  if (signal) signal.addEventListener("abort", () => ctrl.abort());
  try {
    const res = await fetch(betbyUrl(path), {
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "identity",
        ...(rest.headers || {}),
      },
      ...rest,
      signal: ctrl.signal,
    });
    const text = await res.text();
    let body: any;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { _raw: text.slice(0, 500) };
    }
    if (!res.ok) {
      const err: any = new Error(
        `BetBY ${res.status} ${res.statusText}: ${body?.error || body?._raw || text.slice(0, 120)}`
      );
      err.status = res.status;
      err.data = body;
      throw err;
    }
    return body as T;
  } finally {
    clearTimeout(to);
  }
}

// ---- Endpoints curtos (URLs REAIS betby-api-v4 pass-through, funcionam em jwt-service velho) ----

export function getBetbyHealth() {
  return betbyFetch<BetbyHealth>("/health");
}

export function getBetbyBootstrap() {
  return betbyFetch<BetbyBootstrap>("/jwt");
}

export function getBetbyMeta(kind: BetbyKind) {
  return betbyFetch<BetbyMeta>(realV4Url(kind, `${BETBY_V4_DEFAULT_LANG}/0`));
}

export function getBetbyTree(kind: BetbyKind, treeId?: string | number) {
  const id = treeId ?? BETBY_V4_FALLBACK_TREE_IDS[0];
  return betbyFetch<BetbyFullTree>(realV4Url(kind, `${BETBY_V4_DEFAULT_LANG}/${id}`));
}

export function getBetbyEvent(kind: BetbyKind, eventId: string | number) {
  return betbyFetch<BetbyFullTree>(realV4Url(kind, `event/${BETBY_V4_DEFAULT_LANG}/${eventId}`));
}

function countEvents(tree: BetbyFullTree | null | undefined): number {
  if (!tree) return 0;
  if (Array.isArray(tree.events)) return tree.events.length;
  if (tree.events && typeof tree.events === "object") return Object.keys(tree.events).length;
  return 0;
}

export interface BetbyTreeBestResult {
  tree: BetbyFullTree;
  usedTreeId: string;
  tried: Array<{ id: string; events: number; ok: boolean }>;
}

export async function getBetbyTreeBest(
  kind: BetbyKind,
  opts: { explicitTreeId?: string | number; maxFallbacks?: number; skipMeta?: boolean } = {}
): Promise<BetbyTreeBestResult> {
  const { explicitTreeId, maxFallbacks = 8, skipMeta = false } = opts;
  if (explicitTreeId !== undefined && explicitTreeId !== null && explicitTreeId !== "") {
    const t = await getBetbyTree(kind, explicitTreeId);
    return { tree: t, usedTreeId: String(explicitTreeId), tried: [{ id: String(explicitTreeId), events: countEvents(t), ok: true }] };
  }

  let dynamicIds: string[] = [];
  if (!skipMeta) {
    try {
      const meta = await getBetbyMeta(kind);
      const merged = new Set<string>();
      for (const v of meta.top_events_versions || []) merged.add(String(v));
      for (const v of meta.rest_events_versions || []) merged.add(String(v));
      if (meta.version) merged.add(String(meta.version));
      dynamicIds = Array.from(merged);
    } catch {
      dynamicIds = [];
    }
  }

  const seen = new Set<string>(dynamicIds);
  for (const id of BETBY_V4_FALLBACK_TREE_IDS) {
    if (!seen.has(id)) {
      dynamicIds.push(id);
      seen.add(id);
    }
  }

  const ids = dynamicIds.slice(0, maxFallbacks);
  const tried: Array<{ id: string; events: number; ok: boolean }> = [];
  let best: BetbyFullTree | null = null;
  let bestId: string = ids[0] || BETBY_V4_FALLBACK_TREE_IDS[0];
  let bestCount = -1;
  for (const id of ids) {
    try {
      const t = await getBetbyTree(kind, id);
      const c = countEvents(t);
      tried.push({ id, events: c, ok: true });
      if (c > bestCount) { best = t; bestId = id; bestCount = c; }
      if (c > 0) break;
    } catch (e: any) {
      tried.push({ id, events: 0, ok: false });
    }
  }
  if (!best) best = await getBetbyTree(kind, ids[0] || BETBY_V4_FALLBACK_TREE_IDS[0]);
  return { tree: best, usedTreeId: bestId, tried };
}

// ---- Helpers de normalizacao DUAL schema ----

function toArray<T>(x: T[] | Record<string | number, T> | undefined | null): T[] {
  if (!x) return [];
  if (Array.isArray(x)) return x;
  if (typeof x === "object") {
    return Object.entries(x).map(([k, v]) => {
      const vv = (v as any) || {};
      if (vv.id === undefined || vv.id === null) vv.id = isNaN(Number(k)) ? k : Number(k);
      return vv as T;
    });
  }
  return [];
}

function parseMarketScopeOutcomes(raw: any): BetbyOutcome[] {
  if (!raw || typeof raw !== "object") return [];
  return Object.entries(raw).map(([oid, payload]) => {
    const p = (payload as any) || {};
    const priceRaw = p.k ?? p.price ?? p.odds ?? 0;
    const price = typeof priceRaw === "number" ? priceRaw : parseFloat(String(priceRaw).replace(",", ".")) || 0;
    return {
      id: oid,
      price: isFinite(price) ? price : 0,
      name: p.name || String(oid),
      type: p.type,
      handicap: typeof p.handicap === "number" ? p.handicap : p.hcp,
      total: typeof p.total === "number" ? p.total : undefined,
      raw: p,
    } as BetbyOutcome;
  });
}

function parseMarketsFromRawObj(rawMarkets: any): BetbyMarket[] {
  if (!rawMarkets || typeof rawMarkets !== "object") return [];
  const out: BetbyMarket[] = [];
  for (const [marketIdStr, scopesRaw] of Object.entries(rawMarkets)) {
    const mid = Number(marketIdStr);
    const market: BetbyMarket = {
      id: isNaN(mid) ? 0 : mid,
      name: null as any,
      order: 0,
      scopes: [],
      outcomes: [],
      countOutcomes: 0,
    };
    const sc = scopesRaw as any;
    if (sc && typeof sc === "object") {
      for (const [scopeKey, outcomesRaw] of Object.entries(sc)) {
        const list = parseMarketScopeOutcomes(outcomesRaw);
        market.scopes.push({ scope: scopeKey, outcomes: list });
        market.outcomes.push(...list);
      }
    }
    market.countOutcomes = market.outcomes.length;
    // Use o primeiro outcome do scope "" (sem scope) como outcomes "flat"
    const mainScope = market.scopes.find((s) => s.scope === "" || s.scope === "from=0:0|to=infinity");
    if (mainScope) market.outcomes = mainScope.outcomes;
    out.push(market);
  }
  return out;
}

function bestScore(ev: any): { home?: number; away?: number } {
  if (ev.score_obj) {
    const h = Number(ev.score_obj.home_score);
    const a = Number(ev.score_obj.away_score);
    if (isFinite(h) || isFinite(a)) return { home: isFinite(h) ? h : undefined, away: isFinite(a) ? a : undefined };
  }
  const h = ev.home_score;
  const a = ev.away_score;
  if (typeof h === "number" || typeof a === "number") return { home: h, away: a };
  if (typeof ev.score === "string") {
    const m = ev.score.match(/(\d+)\s*[:\-x]\s*(\d+)/);
    if (m) return { home: Number(m[1]), away: Number(m[2]) };
  }
  return {};
}

export interface BetbyTournamentBranch {
  tournament: BetbyTournament;
  events: BetbyEvent[];
}

export interface BetbyCategoryBranch {
  category: BetbyCategory;
  tournaments: BetbyTournamentBranch[];
}

export interface BetbySportBranch {
  sport: BetbySport;
  categories: BetbyCategoryBranch[];
  eventCount: number;
  tournamentCount: number;
  categoryCount: number;
}

export function buildBetbyTree(tree: BetbyFullTree): BetbySportBranch[] {
  const sports = toArray<BetbySport>(tree.sports);
  const categories = toArray<BetbyCategory>(tree.categories);
  const tournaments = toArray<BetbyTournament>(tree.tournaments);
  const rawEventsRaw = tree.events;

  // SCHEMA A (array):
  // SCHEMA B (objeto Record<eventKey, { markets, state, score }> — sem sport_id etc; precisamos inferir)
  const eventsArr: BetbyEvent[] = [];
  if (Array.isArray(rawEventsRaw)) {
    for (const e of rawEventsRaw) eventsArr.push(e);
  } else if (rawEventsRaw && typeof rawEventsRaw === "object") {
    const statusProviders = tree.status && typeof tree.status === "object" ? Object.keys(tree.status).length : 0;
    for (const [key, val] of Object.entries(rawEventsRaw)) {
      const v = (val || {}) as any;
      let idNum: number;
      try {
        idNum = Number(key);
        if (isNaN(idNum)) idNum = parseInt(key.replace(/\D/g, "").slice(0, 12), 10) || Date.now() & 0xffffffff;
      } catch {
        idNum = Date.now() & 0xffffffff;
      }
      const marketsParsed = parseMarketsFromRawObj(v.markets);
      // Provider: tentar status map match com o id se existe
      const state = v.state || {};
      const scr = bestScore(v);
      const clockTs = state?.clock?.timestamp;
      const startTime = typeof clockTs === "number" ? clockTs : v.kickoff || v.start_ts || 0;
      const liveTime = state?.clock?.match_time || v.live_time;
      const live = !!v.live || !!liveTime || (state?.match_status && state.match_status > 0 && state.match_status !== 7);
      const ev: BetbyEvent = {
        id: idNum,
        sport_id: 1,
        category_id: 0,
        tournament_id: 0,
        kickoff: startTime || undefined,
        start_ts: startTime || undefined,
        markets: marketsParsed,
        market_count: marketsParsed.length || 0,
        state,
        score_obj: v.score,
        home_score: scr.home,
        away_score: scr.away,
        live,
        live_time: liveTime,
        clock: state?.clock ? {
          minute: typeof state.clock.match_time === "string" ? Number(state.clock.match_time.split(":")[0]) : undefined,
          period: state.clock.stopped ? "stopped" : "running",
        } : undefined,
        provider: state?.provider || (statusProviders === 1 ? Object.keys(tree.status as any)[0] : undefined),
        status_code: typeof state?.status === "number" ? state.status : undefined,
        match_status_code: typeof state?.match_status === "number" ? state.match_status : undefined,
        raw_key: key,
      };
      eventsArr.push(ev);
    }
  }

  const bySport = new Map<number, BetbySportBranch>();
  const byCategory = new Map<number, BetbyCategoryBranch>();
  const byTournament = new Map<number, BetbyTournamentBranch>();

  if (sports.length === 0 && eventsArr.length > 0) {
    // SCHEMA B: fabricar estrutura de agrupamento por provider
    const providers = new Map<string | number, number>();
    let nextSportId = 1;
    let nextCategoryId = 1;
    let nextTournamentId = 1;
    if (tree.status && typeof tree.status === "object") {
      for (const prov of Object.keys(tree.status)) {
        providers.set(prov, nextSportId++);
      }
    }
    if (providers.size === 0) providers.set("betby-live", 1);
    for (const [prov, spId] of providers.entries()) {
      const sport: BetbySport = { id: spId, code: prov, name: prov === "betby-live" ? "Futebol (BetBY Live)" : `Provedor ${prov.slice(0, 8)}`, popular: true };
      const category: BetbyCategory = { id: nextCategoryId++, sport_id: spId, name: "Global", country: "Ao vivo", country_code: "LIVE" };
      const tournament: BetbyTournament = { id: nextTournamentId++, category_id: category.id, sport_id: spId, name: `LIVE ${tree.version || ""}`.trim(), popular: true };
      sports.push(sport);
      categories.push(category);
      tournaments.push(tournament);
    }
    // Atribuir eventos aos grupos
    const firstSp = sports[0];
    const firstCat = categories[0];
    const firstTrn = tournaments[0];
    for (const ev of eventsArr) {
      const spId = ev.provider && providers.has(ev.provider) ? providers.get(ev.provider)! : firstSp.id;
      const cat = categories.find((c) => c.sport_id === spId) || firstCat;
      const trn = tournaments.find((t) => t.category_id === cat.id) || firstTrn;
      ev.sport_id = spId;
      ev.category_id = cat.id;
      ev.tournament_id = trn.id;
      // Nomes de times: se não tivermos, gerar a partir do ID
      if (!ev.home && !ev.team1_name) ev.home = `Evento #${String(ev.id).slice(-8)}`;
      if (!ev.away && !ev.team2_name) ev.away = "vs";
    }
  }

  for (const s of sports) {
    bySport.set(s.id, {
      sport: s,
      categories: [],
      eventCount: 0,
      tournamentCount: 0,
      categoryCount: 0,
    });
  }
  for (const c of categories) {
    const branch: BetbyCategoryBranch = { category: c, tournaments: [] };
    byCategory.set(c.id, branch);
    const parent = bySport.get(c.sport_id);
    if (parent) {
      parent.categories.push(branch);
      parent.categoryCount += 1;
    }
  }
  for (const t of tournaments) {
    const branch: BetbyTournamentBranch = { tournament: t, events: [] };
    byTournament.set(t.id, branch);
    const parent = byCategory.get(t.category_id);
    if (parent) {
      parent.tournaments.push(branch);
      const sport = bySport.get(t.sport_id);
      if (sport) sport.tournamentCount += 1;
    }
  }
  for (const e of eventsArr) {
    const parent = byTournament.get(e.tournament_id);
    if (parent) {
      parent.events.push(e);
      const sport = bySport.get(e.sport_id);
      if (sport) sport.eventCount += 1;
    } else {
      // Sem torneio conhecido → criar fantasma "Outros" no primeiro sport
      const firstSportId = bySport.keys().next().value as number | undefined;
      if (firstSportId !== undefined) {
        let sp = bySport.get(firstSportId)!;
        let cat = sp.categories.find((x) => x.category.name === "Outros") || null;
        if (!cat) {
          const c: BetbyCategory = { id: (Date.now() & 0xffffffff) + Math.floor(Math.random() * 999), sport_id: firstSportId, name: "Outros" };
          cat = { category: c, tournaments: [] };
          sp.categories.push(cat);
          byCategory.set(c.id, cat);
          sp.categoryCount += 1;
        }
        let trn = cat.tournaments.find((x) => x.tournament.name === "Eventos ao vivo") || null;
        if (!trn) {
          const t: BetbyTournament = { id: (Date.now() & 0xffffffff) + Math.floor(Math.random() * 999), category_id: cat.category.id, sport_id: firstSportId, name: "Eventos ao vivo" };
          trn = { tournament: t, events: [] };
          cat.tournaments.push(trn);
          byTournament.set(t.id, trn);
          sp.tournamentCount += 1;
        }
        trn.events.push(e);
        e.category_id = cat.category.id;
        e.tournament_id = trn.tournament.id;
        if (e.sport_id <= 0) e.sport_id = firstSportId;
        sp.eventCount += 1;
      }
    }
  }

  const out = Array.from(bySport.values()).filter((s) => s.eventCount > 0 || s.sport.popular);
  out.sort(
    (a, b) =>
      Number(!!b.sport.popular) - Number(!!a.sport.popular) ||
      (a.sport.order ?? 999) - (b.sport.order ?? 999) ||
      b.eventCount - a.eventCount
  );
  for (const s of out) {
    s.categories.sort(
      (a, b) =>
        (a.category.order ?? 999) - (b.category.order ?? 999) ||
        (a.category.country || a.category.name || "").localeCompare(
          b.category.country || b.category.name || "",
          "pt"
        )
    );
    for (const c of s.categories) {
      c.tournaments.sort(
        (a, b) =>
          Number(!!b.tournament.popular) - Number(!!a.tournament.popular) ||
          (a.tournament.order ?? 999) - (b.tournament.order ?? 999) ||
          b.events.length - a.events.length
      );
      for (const t of c.tournaments) {
        t.events.sort(
          (a, b) =>
            Number(!!b.top) - Number(!!a.top) ||
            (a.kickoff ?? a.start_ts ?? 0) - (b.kickoff ?? b.start_ts ?? 0) ||
            (a.home || a.name || "").localeCompare(b.home || b.name || "", "pt")
        );
      }
    }
  }
  return out;
}

export function formatKickoff(ts: number | undefined | null) {
  if (!ts) return "—";
  const d = new Date(ts);
  const now = Date.now();
  const diffMin = Math.round((ts - now) / 60000);
  if (Math.abs(diffMin) < 60 * 24) {
    if (diffMin < 0 && diffMin > -180) return `⚡ Agora há ${Math.abs(diffMin)}min`;
    if (diffMin >= 0 && diffMin < 60) return `Em ${diffMin}min`;
    if (diffMin >= 60) return `Hoje ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    if (diffMin < 0 && diffMin >= -60 * 24) return `Ontem ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function teamNames(ev: BetbyEvent) {
  const home = ev.home || ev.team1_name || ev.name?.split(/\s*[vV]s?\s*[·\-–|]?\s*/)[0] || "";
  const away = ev.away || ev.team2_name || ev.name?.split(/\s*[vV]s?\s*[·\-–|]?\s*/)[1] || "";
  return { home: home?.trim(), away: away?.trim() };
}

export function sportLabel(sport: BetbySport) {
  const n = sport.name || sport.code || "Esporte";
  const map: Record<string, string> = {
    football: "Futebol", soccer: "Futebol", "1": "Futebol",
    basketball: "Basquete", "2": "Basquete",
    tennis: "Tênis", "3": "Tênis",
    volleyball: "Vôlei", "4": "Vôlei",
    hockey: "Hóquei", "5": "Hóquei",
    esports: "E-sports", "21": "E-sports",
    baseball: "Basebol", "6": "Basebol",
    handball: "Handebol", "7": "Handebol",
    rugby: "Rugby", "8": "Rugby",
    mma: "MMA", boxing: "Boxe",
  };
  const lower = typeof n === "string" ? n.toLowerCase() : "";
  return map[lower] || map[String(sport.id)] || n;
}
