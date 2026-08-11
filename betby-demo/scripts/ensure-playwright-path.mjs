import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";
import { existsSync, mkdirSync, readdirSync } from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");
const LOCAL_DIR = join(ROOT, ".playwright-browsers");
const GLOBAL_DIR = join(process.env.LOCALAPPDATA || join(process.env.USERPROFILE || "~", "AppData", "Local"), "ms-playwright");

function hasPlaywrightArtifacts(dir) {
  if (!existsSync(dir)) return false;
  try {
    const entries = readdirSync(dir);
    return entries.some((n) => /^chromium(-headless-shell)?-\d+$/.test(n) || /^firefox-\d+$/.test(n) || /^webkit-\d+$/.test(n) || /^ffmpeg-\d+$/.test(n) || /^winldd-\d+$/.test(n));
  } catch {
    return false;
  }
}

const PICKED_DIR = (() => {
  const localHas = hasPlaywrightArtifacts(LOCAL_DIR);
  const globalHas = hasPlaywrightArtifacts(GLOBAL_DIR);
  if (localHas && !globalHas) return LOCAL_DIR;
  if (globalHas) return GLOBAL_DIR;
  if (localHas) return LOCAL_DIR;
  try { mkdirSync(LOCAL_DIR, { recursive: true }); } catch {}
  return LOCAL_DIR;
})();

try { mkdirSync(PICKED_DIR, { recursive: true }); } catch {}
process.env.PLAYWRIGHT_BROWSERS_PATH = PICKED_DIR;
process.env.PLAYWRIGHT_SKIP_BROWSER_GC = "1";

export const PLAYWRIGHT_BROWSERS_PATH = PICKED_DIR;
export const PLAYWRIGHT_BROWSERS_LOCAL = LOCAL_DIR;
export const PLAYWRIGHT_BROWSERS_GLOBAL = GLOBAL_DIR;
export default PICKED_DIR;
