import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import http from "http";
import { listenWithFallback } from "../scripts/port-utils.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, "..");
const SECRETS_FILE = join(ROOT, ".betby-secrets.json");
const APP_ENV = "eu";
const ENVIRONMENT = "prod";
const BRAND_ID = "1653815133341880320";

export const WATCHERS_ENDPOINTS = {
  settingsSecrets: "https://chat.watchers.io/secrets/settings.json",
  settingsRoot: (key) => `https://settings-service.watchers.io/settings/?apiKey=${key}`,
  settingsGlobal: (key) => `https://settings-service.watchers.io/settings/global/${key}`,
  settingsProject: (key, proj) => `https://settings-service.watchers.io/settings/project/${key}/${proj}`,
  settingsThemeList: (key) => `https://settings-service.watchers.io/settings/theme/?apiKey=${key}`,
  settingsTheme: (key, themeId) => `https://settings-service.watchers.io/settings/theme/${themeId}?apiKey=${key}`,
  authRegister: "https://chatbackend.watchers.io/auth/register",
  authLogin: "https://chatbackend.watchers.io/auth/login",
  analytics: "https://stat.watchers.io",
  chatEmbed: (roomId) => `https://chat.watchers.io/?roomId=${encodeURIComponent(roomId)}`,
  chatBackend: "https://chatbackend.watchers.io",
  tipping: "https://tipping.watchers.io",
  antimat: "https://antimat.prod.watchers.io",
  sentry: "https://b9c4e4723c874e0fa271f6ca8c679ab4@sentry.prod.watchers.io/2",
};

export const WATCHERS_DEFAULT_CREDS = {
  brandId: BRAND_ID,
  projectSuffix: "2694917589435551779",
  roomId: `${BRAND_ID}:2694917589435551779`,
  userIdB64: "FbwzJEeBMcXzRFNqBF8mdklISfiUFGiwgIuxChQR+2BY=",
  apikey: "f7fae93d-cda1-4669-9ec8-b06a2e66f650",
  preloadApiKey: "680f3738-6809-4ded-a371-99fb7900846a",
  preloadProjectId: "casabet-prod",
  project: "betby_test-prod-f7fae93d-cda1-4669-9ec8-b06a2e66f650",
  appEnvironment: APP_ENV,
  environment: ENVIRONMENT,
  defaultThemeId: 2,
  embedUrl:
    "https://chat.watchers.io/?roomId=1653815133341880320%3A2694917589435551779&userId=FbwzJEeBMcXzRFNqBF8mdklISfiUFGiwgIuxChQR%2B%2BY%3D&apikey=f7fae93d-cda1-4669-9ec8-b06a2e66f650",
  brandGA4Id: "G-7Q8ZMQJCT2",
  liveUid: "2699066598068727812",
};

const SAMPLE_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";

function getDefaultHeaders(extra = {}) {
  return {
    "User-Agent": SAMPLE_USER_AGENT,
    Accept: "application/json, text/plain, */*",
    Origin: "https://chat.watchers.io",
    Referer: "https://chat.watchers.io/",
    "sec-ch-ua": '"Not=A?Brand";v="99", "Google Chrome";v="151", "Chromium";v="151"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    ...extra,
  };
}

function buildAuthPayload(overrides = {}) {
  const id = crypto.randomUUID ? crypto.randomUUID() : (Math.random().toString(36) + Date.now().toString(36));
  const suffix = id.replace(/[^\w]/g, "").slice(0, 6);
  return {
    project: overrides.project || WATCHERS_DEFAULT_CREDS.project,
    nickname: `Bet62Guest-${suffix}`,
    apiKey: overrides.apiKey || overrides.apikey || WATCHERS_DEFAULT_CREDS.apikey,
    ...overrides,
  };
}

export function buildChatEmbedUrl(options = {}) {
  const creds = { ...WATCHERS_DEFAULT_CREDS, ...options };
  const p = new URLSearchParams({
    roomId: creds.roomId,
    userId: creds.userIdB64,
    apikey: creds.apikey,
  });
  return `https://chat.watchers.io/?${p.toString()}`;
}

export async function fetchSecretsSettings() {
  const r = await fetch(WATCHERS_ENDPOINTS.settingsSecrets, {
    headers: getDefaultHeaders(),
  });
  if (!r.ok) throw new Error(`secrets/settings.json HTTP ${r.status}`);
  return r.json();
}

export async function fetchGlobalSettings(apikey = WATCHERS_DEFAULT_CREDS.apikey) {
  const r = await fetch(WATCHERS_ENDPOINTS.settingsGlobal(apikey), {
    headers: getDefaultHeaders(),
  });
  if (!r.ok) throw new Error(`settings/global HTTP ${r.status}`);
  return r.json();
}

export async function fetchRootSettings(apikey = WATCHERS_DEFAULT_CREDS.apikey) {
  const r = await fetch(WATCHERS_ENDPOINTS.settingsRoot(apikey), {
    headers: getDefaultHeaders(),
  });
  if (!r.ok) throw new Error(`settings/?apiKey HTTP ${r.status}`);
  return r.json();
}

export async function fetchThemeList(apikey = WATCHERS_DEFAULT_CREDS.apikey) {
  const r = await fetch(WATCHERS_ENDPOINTS.settingsThemeList(apikey), {
    headers: getDefaultHeaders(),
  });
  if (!r.ok) throw new Error(`settings/theme HTTP ${r.status}`);
  return r.json();
}

export async function fetchTheme(themeId, apikey = WATCHERS_DEFAULT_CREDS.apikey) {
  const r = await fetch(WATCHERS_ENDPOINTS.settingsTheme(apikey, themeId), {
    headers: getDefaultHeaders(),
  });
  if (!r.ok) throw new Error(`settings/theme/${themeId} HTTP ${r.status}`);
  return r.json();
}

export async function registerGuest(overrides = {}) {
  const apikey = overrides.apiKey || overrides.apikey || WATCHERS_DEFAULT_CREDS.apikey;
  const body = { ...buildAuthPayload({ ...overrides, apiKey: apikey }), apiKey: apikey };
  delete body.apikey;
  const headers = getDefaultHeaders({
    "Content-Type": "application/json",
    "x-api-key": apikey,
  });
  const q = new URLSearchParams({ apiKey: apikey });
  const r = await fetch(`${WATCHERS_ENDPOINTS.authRegister}?${q.toString()}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { ok: r.ok, status: r.status, request: body, data };
}

export async function ensureSecretsFile(overrides = {}) {
  if (existsSync(SECRETS_FILE)) {
    try { return JSON.parse(readFileSync(SECRETS_FILE, "utf-8")); } catch {}
  }
  const [secrets, global, root, themeList, themeLight, themeDark] = await Promise.allSettled([
    fetchSecretsSettings(),
    fetchGlobalSettings(overrides.apikey || WATCHERS_DEFAULT_CREDS.apikey),
    fetchRootSettings(overrides.apikey || WATCHERS_DEFAULT_CREDS.apikey),
    fetchThemeList(overrides.apikey || WATCHERS_DEFAULT_CREDS.apikey),
    fetchTheme(1, overrides.apikey || WATCHERS_DEFAULT_CREDS.apikey).catch(() => null),
    fetchTheme(2, overrides.apikey || WATCHERS_DEFAULT_CREDS.apikey).catch(() => null),
  ]);
  const unwrap = (r) => (r.status === "fulfilled" ? r.value : null);
  const reg = await registerGuest({
    project: unwrap(root)?.project || WATCHERS_DEFAULT_CREDS.project,
  }).catch((e) => ({ ok: false, error: e.message }));

  const data = {
    capturedAt: new Date().toISOString(),
    creds: {
      ...WATCHERS_DEFAULT_CREDS,
      ...overrides,
      userIdB64: reg?.data?.userIdB64 || reg?.data?.encodedUserId || reg?.data?.userId || WATCHERS_DEFAULT_CREDS.userIdB64,
      authRegister: reg,
    },
    endpoints: WATCHERS_ENDPOINTS,
    secrets: unwrap(secrets),
    global: unwrap(global),
    settingsRoot: unwrap(root),
    themes: {
      list: unwrap(themeList),
      light: unwrap(themeLight),
      dark: unwrap(themeDark),
    },
  };
  if (!existsSync(ROOT)) mkdirSync(ROOT, { recursive: true });
  writeFileSync(SECRETS_FILE, JSON.stringify(data, null, 2));
  return data;
}

export function getTrackedEventUrl(eventId, extra = {}) {
  const params = new URLSearchParams({
    roomId: extra.roomId || WATCHERS_DEFAULT_CREDS.roomId,
    userId: extra.userId || WATCHERS_DEFAULT_CREDS.userIdB64,
    apikey: extra.apikey || WATCHERS_DEFAULT_CREDS.apikey,
  });
  if (eventId) params.set("eventId", String(eventId));
  return `https://chat.watchers.io/?${params.toString()}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const cmd = args[0];
  const port = Number(args[1] || process.env.PORT || 8789);
  if (cmd === "server") {
    const server = http.createServer(async (req, res) => {
      const u = new URL(req.url, `http://localhost:${port}`);
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      try {
        if (u.pathname === "/health") return res.end(JSON.stringify({ ok: 1, svc: "watchers" }));
        if (u.pathname === "/embed-url") {
          const eventId = u.searchParams.get("eventId");
          return res.end(JSON.stringify({
            default: buildChatEmbedUrl(),
            event: eventId ? getTrackedEventUrl(eventId) : null,
            roomId: WATCHERS_DEFAULT_CREDS.roomId,
          }));
        }
        if (u.pathname === "/secrets") return res.end(JSON.stringify(await fetchSecretsSettings()));
        if (u.pathname === "/global") return res.end(JSON.stringify(await fetchGlobalSettings()));
        if (u.pathname === "/settings") return res.end(JSON.stringify(await fetchRootSettings()));
        if (u.pathname === "/themes") return res.end(JSON.stringify(await fetchThemeList()));
        if (u.pathname.startsWith("/theme/")) {
          const id = Number(u.pathname.slice(7)) || 2;
          return res.end(JSON.stringify(await fetchTheme(id)));
        }
        if (u.pathname === "/auth/register" && req.method === "POST") {
          let body = {};
          for await (const c of req) body = JSON.parse(new TextDecoder().decode(c));
          return res.end(JSON.stringify(await registerGuest(body)));
        }
        if (u.pathname === "/all") return res.end(JSON.stringify(await ensureSecretsFile(), null, 2));
        res.writeHead(404);
        res.end(JSON.stringify({
          error: "not_found",
          routes: ["/health", "/embed-url", "/secrets", "/global", "/settings", "/themes", "/theme/{1|2}", "/auth/register (POST)", "/all"],
        }));
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    await listenWithFallback(server, port, {
      label: "watchers",
      onListen: () => {
        console.log(`[watchers]   GET /health, /embed-url?eventId=X`);
        console.log(`[watchers]   GET /secrets, /global, /settings, /themes, /theme/2`);
        console.log(`[watchers]   POST /auth/register {nickname, project, …}`);
      },
    });
  } else {
    ensureSecretsFile()
      .then((d) => {
        const project = d?.settingsRoot?.project || d?.global?.project;
        const be = d?.global?.backendUrl;
        console.log(`[watchers] project: ${project || "(n/a)"}`);
        console.log(`[watchers] backendUrl: ${be || "(n/a)"}`);
        console.log(`[watchers] register.status: ${d.creds.authRegister?.status} ok=${d.creds.authRegister?.ok}`);
        console.log(`[watchers] embed: ${buildChatEmbedUrl()}`);
        console.log(`[watchers] salvo em ${SECRETS_FILE}`);
      })
      .catch((e) => { console.error(e); process.exit(1); });
  }
}

export default {
  WATCHERS_ENDPOINTS,
  WATCHERS_DEFAULT_CREDS,
  buildChatEmbedUrl,
  getTrackedEventUrl,
  fetchSecretsSettings,
  fetchGlobalSettings,
  fetchRootSettings,
  fetchThemeList,
  fetchTheme,
  registerGuest,
  ensureSecretsFile,
};
