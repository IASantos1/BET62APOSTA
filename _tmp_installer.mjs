import { spawn } from "child_process";
import { writeFileSync, appendFileSync, existsSync, statSync } from "fs";
import { join } from "path";
const cwd = process.cwd();
const LOG_F = join(cwd, "npm-install.log");
const DONE_F = join(cwd, "npm-install.done");
writeFileSync(LOG_F, `START @ ${new Date().toISOString()}\n`);
if (existsSync(DONE_F)) { try { require("fs").unlinkSync(DONE_F); } catch {} }
function log(s) { appendFileSync(LOG_F, s + "\n"); console.log(s); }
const isWin = process.platform === "win32";
const npmCmd = isWin ? "npm.cmd" : "npm";
const args = ["install", "--no-audit", "--no-fund", "--loglevel=error"];
log(`Spawning: ${npmCmd} ${args.join(" ")}`);
log(`CWD: ${cwd}`);
const child = spawn(npmCmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
child.stdout.on("data", d => { const s = d.toString(); appendFileSync(LOG_F, s); process.stdout.write(s); });
child.stderr.on("data", d => { const s = d.toString(); appendFileSync(LOG_F, s); process.stderr.write(s); });
child.on("error", e => log(`ERROR: ${e.message}`));
child.on("exit", (code) => {
  log(`npm install exit code=${code}`);
  writeFileSync(DONE_F, `exit=${code} time=${new Date().toISOString()}`);
  // Check vite:
  try {
    const vp = join(cwd, "node_modules", "vite", "package.json");
    log(`vite exists: ${existsSync(vp)}`);
    if (existsSync(vp)) log(`vite version: ${JSON.parse(require("fs").readFileSync(vp,"utf8")).version}`);
  } catch (e: any) { log(`check err: ${e.message}`); }
  process.exit(0);
});
