#!/usr/bin/env node
// gif-forge — render an HTML scene template to a looping GIF, frame by frame.
//
//   node tools/gif-forge/render.mjs --scene neon-pulse --sticker path/to/cutout.png \
//        --out cuna.gif [--frames 32] [--size 480] [--ms 45] [--text CUNA]
//
// Scenes are deterministic: they expose setup(stickerDataUri, text) and setT(t) with
// t in [0,1), every motion built from sin/cos of 2πt (or mod-wrapped translates) so
// frame N-1 flows seamlessly back into frame 0. No CSS animations, no clocks — the
// renderer owns time, which is what makes the loop perfect and the output reproducible.
//
// Chromium comes from the preinstalled Playwright browsers (PLAYWRIGHT_BROWSERS_PATH);
// when the runtime can't resolve it (version-pinned checkouts), we fall back to the
// first chrome binary under /opt/pw-browsers.
import { readFileSync, mkdtempSync, writeFileSync, rmSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name, dflt) => {
  const i = process.argv.indexOf("--" + name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};

const scene = arg("scene", "bounce");
const sticker = arg("sticker", join(here, "..", "..", "public", "img-cuna-taco.png"));
const out = arg("out", "cuna.gif");
const frames = Math.max(8, Math.min(64, Number(arg("frames", 32))));
const size = Math.max(240, Math.min(720, Number(arg("size", 480))));
const ms = Math.max(30, Math.min(120, Number(arg("ms", 45))));
const text = String(arg("text", "CUNA")).slice(0, 12);
const colors = Math.max(32, Math.min(256, Number(arg("colors", 160))));

const scenePath = join(here, "scenes", scene + ".html");
if (!existsSync(scenePath)) {
  const avail = readdirSync(join(here, "scenes")).filter(f => f.endsWith(".html")).map(f => f.replace(/\.html$/, ""));
  console.error(`unknown scene "${scene}" — available: ${avail.join(", ")}`);
  process.exit(1);
}
const stickerB64 = `data:image/png;base64,${readFileSync(resolve(sticker)).toString("base64")}`;

function findChrome() {
  const roots = ["/opt/pw-browsers"];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const d of readdirSync(root)) {
      const p = join(root, d, "chrome-linux", "chrome");
      if (existsSync(p)) return p;
    }
  }
  return null;
}

const { chromium } = await import("playwright");
let browser;
try { browser = await chromium.launch(); }
catch {
  const exe = findChrome();
  if (!exe) throw new Error("no chromium available");
  browser = await chromium.launch({ executablePath: exe });
}

const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(scenePath).href);
await page.evaluate(([src, txt]) => window.setup(src, txt), [stickerB64, text]);
await page.waitForFunction(() => window.__ready === true, { timeout: 10000 });

const dir = mkdtempSync(join(tmpdir(), "gifforge-"));
for (let i = 0; i < frames; i++) {
  await page.evaluate(t => window.setT(t), i / frames);
  const buf = await page.screenshot({ type: "png" });
  writeFileSync(join(dir, `f${String(i).padStart(3, "0")}.png`), buf);
}
await browser.close();

const py = spawnSync("python3", [join(here, "assemble.py"), dir, resolve(out), String(ms), String(colors)], { stdio: "inherit" });
rmSync(dir, { recursive: true, force: true });
if (py.status !== 0) process.exit(py.status || 1);
console.log(`gif-forge: ${out} (${scene}, ${frames}f @ ${ms}ms, ${size}px)`);
