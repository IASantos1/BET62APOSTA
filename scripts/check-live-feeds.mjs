import WebSocket from 'ws';

const DEFAULT_BASE_URL = 'http://127.0.0.1:8787';
const DEFAULT_SPORTS = ['soccer', 'tennis', 'basketball', 'baseball', 'ice-hockey', 'volleyball', 'mma'];

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

const state = {
  pass: 0,
  warn: 0,
  fail: 0,
};

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] || '').trim();
    const next = String(argv[i + 1] || '').trim();
    if (arg === '--help' || arg === '-h') out.help = true;
    else if (arg === '--base-url' && next) {
      out.baseUrl = next;
      i += 1;
    } else if (arg === '--sports' && next) {
      out.sports = next;
      i += 1;
    } else if (arg === '--strict-live') {
      out.strictLive = true;
    } else if (arg === '--http-timeout' && next) {
      out.httpTimeoutMs = Number(next);
      i += 1;
    } else if (arg === '--ws-timeout' && next) {
      out.wsTimeoutMs = Number(next);
      i += 1;
    } else if (arg === '--summary-chars' && next) {
      out.summaryChars = Number(next);
      i += 1;
    }
  }
  return out;
}

const cli = parseArgs(process.argv.slice(2));
const HTTP_TIMEOUT_MS = Number(cli.httpTimeoutMs || process.env.HTTP_TIMEOUT_MS || 8000);
const WS_TIMEOUT_MS = Number(cli.wsTimeoutMs || process.env.WS_TIMEOUT_MS || 5000);
const SUMMARY_CHARS = Number(cli.summaryChars || process.env.SUMMARY_CHARS || 220);
const STRICT_LIVE = Boolean(cli.strictLive) || String(process.env.STRICT_LIVE || '').trim() === '1';

function color(text, tone) {
  return `${colors[tone] || ''}${text}${colors.reset}`;
}

function pass(message) {
  state.pass += 1;
  console.log(color(`PASS ${message}`, 'green'));
}

function warn(message) {
  state.warn += 1;
  console.warn(color(`WARN ${message}`, 'yellow'));
}

function fail(message) {
  state.fail += 1;
  console.error(color(`FAIL ${message}`, 'red'));
}

function section(title) {
  console.log('');
  console.log(color(`== ${title} ==`, 'cyan'));
}

function normalizeBaseUrl(raw) {
  const value = String(raw || DEFAULT_BASE_URL).trim();
  return value.replace(/\/+$/, '');
}

function getSports() {
  const raw = String(cli.sports || process.env.SPORTS || '').trim();
  if (!raw) return DEFAULT_SPORTS.slice();
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildUrl(baseUrl, path) {
  return `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

function buildWsUrl(baseUrl, sport) {
  const u = new URL(baseUrl);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  u.pathname = '/api/live/ws';
  u.search = `sport=${encodeURIComponent(sport)}`;
  return u.toString();
}

function shortBody(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return String(text || '').replace(/\s+/g, ' ').slice(0, SUMMARY_CHARS);
}

function eventIdOf(event) {
  if (!event || typeof event !== 'object') return '';
  return String(event.id || event.external_event_id || event.fixture?.id || '').trim();
}

function listFromPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.live)) return payload.live;
  return [];
}

function describeEvent(event, fallbackSport) {
  if (!event || typeof event !== 'object') return 'evento-desconhecido';
  const id = eventIdOf(event) || 'sem-id';
  const sport = String(event.sport || fallbackSport || '').trim() || 'sport?';
  const home = String(event.home_team || event.teams?.home?.name || '').trim() || 'Home';
  const away = String(event.away_team || event.teams?.away?.name || '').trim() || 'Away';
  const status =
    String(event.status?.short || event.status_short || event.status || event.fixture?.status?.short || '').trim() || 'status?';
  return `${sport} ${id} ${home} vs ${away} [${status}]`;
}

async function httpGetJson(url, timeoutMs = HTTP_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      cache: 'no-store',
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return {
      ok: response.ok,
      status: response.status,
      text,
      json,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      text: '',
      json: null,
      error: String(error?.message || error),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function checkJsonEndpoint(label, url, expectedStatuses = [200]) {
  const result = await httpGetJson(url);
  const ok = expectedStatuses.includes(result.status);
  if (!ok) {
    fail(`${label} -> ${result.status} ${result.error || shortBody(result.text)}`);
    return { ok: false, result };
  }
  pass(`${label} -> ${result.status}`);
  return { ok: true, result };
}

async function checkWs(baseUrl, sport) {
  const url = buildWsUrl(baseUrl, sport);
  return new Promise((resolve) => {
    let settled = false;
    let opened = false;
    let received = 0;
    let lastPreview = '';
    const ws = new WebSocket(url);
    const finish = (outcome, message) => {
      if (settled) return;
      settled = true;
      try {
        ws.close();
      } catch {
        // ignore close race
      }
      if (outcome === 'pass') pass(message);
      else if (outcome === 'warn') warn(message);
      else fail(message);
      resolve({ opened, received, lastPreview });
    };

    const timer = setTimeout(() => {
      if (received > 0) {
        finish('pass', `WS ${sport} abriu e recebeu ${received} mensagem(ns)`);
        return;
      }
      if (opened) {
        finish('warn', `WS ${sport} abriu, mas não recebeu dados em ${WS_TIMEOUT_MS}ms`);
        return;
      }
      finish('fail', `WS ${sport} não abriu em ${WS_TIMEOUT_MS}ms`);
    }, WS_TIMEOUT_MS);

    ws.on('open', () => {
      opened = true;
      try {
        ws.send(JSON.stringify({ type: 'subscribe', sport }));
      } catch {
        // open is enough for smoke purposes
      }
    });

    ws.on('message', (data) => {
      received += 1;
      if (!lastPreview) lastPreview = shortBody(String(data || ''));
    });

    ws.on('error', (error) => {
      clearTimeout(timer);
      finish('fail', `WS ${sport} erro: ${String(error?.message || error)}`);
    });

    ws.on('close', () => {
      clearTimeout(timer);
      if (received > 0) {
        finish('pass', `WS ${sport} abriu e recebeu ${received} mensagem(ns)`);
        return;
      }
      if (opened) {
        finish('warn', `WS ${sport} abriu e fechou sem mensagem`);
        return;
      }
      finish('fail', `WS ${sport} fechou antes de abrir`);
    });
  });
}

async function checkSport(baseUrl, sport) {
  section(`Sport ${sport}`);

  const listPath = `/api/events/by-sport?sports=${encodeURIComponent(sport)}&realtime=1&include=odds&only=live&days=0`;
  const listUrl = buildUrl(baseUrl, listPath);
  const listCheck = await checkJsonEndpoint(`${sport} live list`, listUrl, [200]);
  if (!listCheck.ok) return;

  const liveEvents = listFromPayload(listCheck.result.json);
  if (!Array.isArray(liveEvents)) {
    fail(`${sport} live list retornou formato inesperado`);
    return;
  }

  if (liveEvents.length === 0) {
    const note = `${sport} sem evento live agora`;
    if (STRICT_LIVE) fail(note);
    else warn(note);
    await checkWs(baseUrl, sport);
    return;
  }

  pass(`${sport} live list trouxe ${liveEvents.length} evento(s)`);
  const event = liveEvents.find((item) => eventIdOf(item)) || liveEvents[0];
  const eventId = eventIdOf(event);
  if (!eventId) {
    fail(`${sport} live list não trouxe id utilizável`);
    await checkWs(baseUrl, sport);
    return;
  }

  pass(`${sport} evento alvo: ${describeEvent(event, sport)}`);

  const scorePath = `/api/events/${encodeURIComponent(eventId)}/score?realtime=1&sport=${encodeURIComponent(sport)}`;
  const scoreUrl = buildUrl(baseUrl, scorePath);
  const scoreCheck = await checkJsonEndpoint(`${sport} score`, scoreUrl, [200]);
  if (scoreCheck.ok) {
    const scoreJson = scoreCheck.result.json || {};
    const hasScore = scoreJson.score != null || scoreJson.goals != null;
    const scoreSummary = hasScore ? shortBody(scoreJson.score ?? scoreJson.goals) : 'sem payload de score';
    if (hasScore) pass(`${sport} score payload: ${scoreSummary}`);
    else warn(`${sport} score sem score/goals: ${shortBody(scoreJson)}`);

    const lastUpdateId = String(scoreJson.lastUpdateId || '').trim();
    if (lastUpdateId) {
      pass(`${sport} score lastUpdateId=${lastUpdateId}`);
      const deltaPath = `${scorePath}&lastUpdateId=${encodeURIComponent(lastUpdateId)}`;
      await checkJsonEndpoint(`${sport} score delta`, buildUrl(baseUrl, deltaPath), [200]);
    } else {
      warn(`${sport} score não devolveu lastUpdateId`);
    }
  }

  const oddsPath = `/api/events/${encodeURIComponent(eventId)}/odds?realtime=1&markets=full&sport=${encodeURIComponent(sport)}`;
  const oddsCheck = await checkJsonEndpoint(`${sport} odds`, buildUrl(baseUrl, oddsPath), [200]);
  if (oddsCheck.ok) {
    const oddsJson = oddsCheck.result.json || {};
    const marketCount = oddsJson.markets && typeof oddsJson.markets === 'object'
      ? Object.keys(oddsJson.markets).length
      : 0;
    if (marketCount > 0) pass(`${sport} odds com ${marketCount} mercado(s)`);
    else warn(`${sport} odds sem markets utilizáveis: ${shortBody(oddsJson)}`);
  }

  const incidentsPath = `/api/events/${encodeURIComponent(eventId)}/incidents?sport=${encodeURIComponent(sport)}`;
  const incidentsCheck = await checkJsonEndpoint(`${sport} incidents`, buildUrl(baseUrl, incidentsPath), [200]);
  if (incidentsCheck.ok) {
    const incidentsJson = incidentsCheck.result.json || {};
    const count = Array.isArray(incidentsJson.incidents) ? incidentsJson.incidents.length : 0;
    pass(`${sport} incidents retornou ${count} incidente(s)`);
  }

  await checkWs(baseUrl, sport);
}

async function main() {
  if (cli.help) {
    console.log('Uso: node scripts/check-live-feeds.mjs [--base-url URL] [--sports soccer,tennis] [--strict-live] [--http-timeout 8000] [--ws-timeout 5000]');
    console.log('Tambem aceita BASE_URL, SPORTS, STRICT_LIVE, HTTP_TIMEOUT_MS, WS_TIMEOUT_MS e SUMMARY_CHARS.');
    return;
  }

  const baseUrl = normalizeBaseUrl(cli.baseUrl || process.env.BASE_URL);
  const sports = getSports();

  section('Config');
  console.log(`BASE_URL=${baseUrl}`);
  console.log(`SPORTS=${sports.join(',')}`);
  console.log(`STRICT_LIVE=${STRICT_LIVE ? '1' : '0'}`);
  console.log(`HTTP_TIMEOUT_MS=${HTTP_TIMEOUT_MS}`);
  console.log(`WS_TIMEOUT_MS=${WS_TIMEOUT_MS}`);

  section('Health');
  await checkJsonEndpoint('health', buildUrl(baseUrl, '/health'), [200]);

  for (const sport of sports) {
    await checkSport(baseUrl, sport);
  }

  section('Resumo');
  console.log(`PASS=${state.pass} WARN=${state.warn} FAIL=${state.fail}`);

  if (state.fail > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  fail(`erro fatal: ${String(error?.stack || error?.message || error)}`);
  process.exit(1);
});
