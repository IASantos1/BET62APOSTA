import { spawn, exec } from "child_process";
import { writeFileSync, appendFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
const cwd = process.cwd();
const selfPid = process.pid;
const logFile = join(cwd, "betby-demo", "_relaunch.log");
writeFileSync(logFile, `RELAUNCH @ ${new Date().toISOString()} selfPid=${selfPid}\n`);
function log(s) { appendFileSync(logFile, s + "\n"); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function execCmd(cmd) {
  return new Promise(resolve => {
    exec(cmd, { timeout: 20000, windowsHide: true, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ err: err?.message || null, stdout: String(stdout || ""), stderr: String(stderr || "") });
    });
  });
}
async function listNodePids() {
  const r = await execCmd('tasklist /FI "IMAGENAME eq node.exe" /FO CSV /NH');
  const pids = new Set();
  (r.stdout || "").split(/\r?\n/).forEach(line => {
    const m = line.match(/"node.exe"\s*,\s*"(\d+)"/);
    if (m) { const pid = parseInt(m[1], 10); if (pid && pid !== selfPid) pids.add(pid); }
  });
  return Array.from(pids);
}
log("Listing pids...");
const firstPids = await listNodePids();
log(`Other node pids: [${firstPids.join(", ")}]`);
for (let rep = 0; rep < 5; rep++) {
  const pids = await listNodePids();
  if (pids.length === 0) { log(`No other nodes at rep ${rep}`); break; }
  log(`Rep ${rep}: killing ${pids.length} pids: ${pids.join(", ")}`);
  for (const pid of pids) { try { process.kill(pid, "SIGKILL"); } catch(e) { log(` kill ${pid} err: ${e.message}`); } }
  await sleep(650);
}
await sleep(2500);
const finalPids = await listNodePids();
log(`After kill: remaining others: [${finalPids.join(", ")}]`);
const outLog = join(cwd, "betby-demo", "jwt-service.out.log");
const errLog = join(cwd, "betby-demo", "jwt-service.err.log");
for (const f of [outLog, errLog]) if (existsSync(f)) { try { writeFileSync(f, ""); } catch {} }
log(`Spawning NEW jwt-service...`);
const child = spawn(process.execPath, ["betby-demo/jwt-service.mjs"], {
  cwd,
  detached: true,
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});
child.stdout.on("data", d => { try { appendFileSync(outLog, d); } catch {} });
child.stderr.on("data", d => { try { appendFileSync(errLog, d); } catch {} });
child.on("error", e => log(`spawn err: ${e.message}`));
child.unref();
log(`New PID=${child.pid}`);
await sleep(6500);
log(`Final pids (including self): ${JSON.stringify(await listNodePids())}`);
log(`done. unref and exit`);
setTimeout(() => process.exit(0), 800);
