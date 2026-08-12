import { spawn, exec } from "child_process";
import { writeFileSync, appendFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cwd = process.cwd();
const statusFile = join(cwd, "betby-demo", "status_check.txt");
const outLog = join(cwd, "betby-demo", "jwt-service.out.log");
const errLog = join(cwd, "betby-demo", "jwt-service.err.log");
const selfPid = process.pid;

function writeStatus(s) {
  appendFileSync(statusFile, String(s) + "\n");
}

writeFileSync(statusFile, `=== RESTART JWT (node script) ${new Date().toISOString()} ===\n`);
writeStatus(`SELF PID=${selfPid}`);
writeStatus(`CWD=${cwd}`);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function run(cmd) {
  return new Promise((resolve) => {
    exec(cmd, { timeout: 15000, windowsHide: true }, (err, stdout, stderr) => {
      resolve({ err: err ? err.message : null, stdout: String(stdout || ""), stderr: String(stderr || "") });
    });
  });
}

async function listNodePids() {
  const powershellCmd = `Get-Process node -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id`;
  const r = await run(`powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "${powershellCmd}"`);
  const pids = (r.stdout || "").split(/\s+/).map(x => x.trim()).filter(x => x && /^\d+$/.test(x)).map(Number).filter(p => p !== selfPid);
  return pids;
}

writeStatus("\n--- KILLING NODES ---");
for (let i = 0; i < 6; i++) {
  const pids = await listNodePids();
  if (pids.length === 0) { writeStatus(`  Loop ${i}: 0 nodes remaining`); break; }
  writeStatus(`  Loop ${i}: kill PIDs=${pids.join(", ")}`);
  for (const pid of pids) { try { process.kill(pid, "SIGTERM"); } catch {} }
  await sleep(700);
  for (const pid of await listNodePids()) { try { process.kill(pid, "SIGKILL"); } catch {} }
  await sleep(500);
}

await sleep(2500);

writeStatus("\n--- CHECK PORT 8787 BEFORE START ---");
for (let i = 0; i < 15; i++) {
  const r = await run(`powershell.exe -NoProfile -Command "netstat -ano | Select-String ':8787' | Select-String 'LISTENING'"`);
  const lines = (r.stdout || "").trim();
  if (!lines) { writeStatus(`  Port 8787 free (check ${i+1})`); break; }
  await sleep(600);
}

for (const f of [outLog, errLog]) { if (existsSync(f)) { try { writeFileSync(f, ""); } catch {} } }

writeStatus("\n--- SPAWNING JWT-SERVICE ---");
const child = spawn(process.execPath, ["betby-demo/jwt-service.mjs"], {
  cwd,
  detached: true,
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});
let stdoutBuf = ""; let stderrBuf = "";
child.stdout.on("data", d => { stdoutBuf += d.toString(); try { appendFileSync(outLog, d); } catch {} });
child.stderr.on("data", d => { stderrBuf += d.toString(); try { appendFileSync(errLog, d); } catch {} });
child.on("error", e => writeStatus(`  SPAWN ERROR: ${e.message}`));
child.unref();
writeStatus(`  Spawned child PID=${child.pid}`);
await sleep(6000);

writeStatus("\n--- CHECK PORT 8787 UP ---");
let portUp = false;
for (let i = 0; i < 25; i++) {
  const r = await run(`powershell.exe -NoProfile -Command "netstat -ano | Select-String ':8787' | Select-String 'LISTENING'"`);
  const lines = (r.stdout || "").trim();
  if (lines) { writeStatus(`  Port 8787 UP after ${i+1} checks`); writeStatus(`    ${lines.split("\n")[0]}`); portUp = true; break; }
  await sleep(800);
}
if (!portUp) {
  writeStatus("  FAIL PORT 8787 NOT UP after 20s!");
  writeStatus(`  stderr tail: ${stderrBuf.slice(-600)}`);
}

await sleep(2500);

writeStatus("\n--- FETCH http://localhost:8787/health ---");
try {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 30000);
  const r = await fetch("http://localhost:8787/health", { signal: ctrl.signal });
  clearTimeout(to);
  writeStatus(`  HTTP status=${r.status}`);
  const text = await r.text();
  try {
    const j = JSON.parse(text);
    writeStatus(`  authenticated=${j.authenticated}`);
    writeStatus(`  brandId=${j.brandId}`);
    writeStatus(`  shortcutsHosted[0]=${j.v4Patterns?.shortcutsHosted?.[0] || "N/A"}`);
    const auto = j.v4Patterns?.autoResolve;
    if (auto) {
      writeStatus(`  NEW CODE: autoResolve EXISTS`);
      writeStatus(`  autoResolve.userIds=${JSON.stringify(auto.userIds)}`);
      writeStatus(`  autoResolve.live=${JSON.stringify(auto.live)}`);
      writeStatus(`  autoResolve.prematch=${JSON.stringify(auto.prematch)}`);
      const routesStr = JSON.stringify(j.routes || []);
      writeStatus(`  hasDebugRoute=${/debug/.test(routesStr)}`);
      writeStatus(`  hasEventRoute=${/event/.test(routesStr)}`);
    } else {
      writeStatus(`  OLD CODE: AUTORESOLVE MISSING!!! v4Patterns keys=${JSON.stringify(Object.keys(j.v4Patterns || {}))}`);
    }
  } catch (e) {
    writeStatus(`  PARSE ERR: ${e.message}  text_preview=${text.slice(0,400)}`);
  }
} catch (e) {
  writeStatus(`  FETCH ERR: ${e.message}`);
}

writeStatus("\n--- OUT.LOG LAST 10 LINES ---");
if (existsSync(outLog)) {
  const lines = (await import("fs")).readFileSync(outLog, "utf8").split(/\n/).slice(-10);
  lines.forEach(l => writeStatus(`  ${l}`));
} else { writeStatus("  out.log not found"); }

writeStatus("\n=== DONE ===");
process.exit(0);
