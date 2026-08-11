import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";
import { existsSync, mkdirSync } from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");
const BROWSERS_DIR = join(ROOT, ".playwright-browsers");

if (!existsSync(BROWSERS_DIR)) {
  try {
    mkdirSync(BROWSERS_DIR, { recursive: true });
  } catch {}
}

process.env.PLAYWRIGHT_BROWSERS_PATH = BROWSERS_DIR;
process.env.PLAYWRIGHT_SKIP_BROWSER_GC = "1";

export const PLAYWRIGHT_BROWSERS_PATH = BROWSERS_DIR;
export default BROWSERS_DIR;
