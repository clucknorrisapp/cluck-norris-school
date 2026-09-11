#!/usr/bin/env node
// Build the STORE edition of the school — the education-only bundle the Google Play / iOS
// wrapper ships INSIDE the app (docs/STORE_EDITION.md; contract: the wrapper repo's
// DELIVERY-CONTRACT.md). Usage: node scripts/build-store-edition.mjs [google|ios]
//
// What it does, and why each step exists:
//   1. `vite build` with STORE_EDITION set → src/edition.js folds STORE=true, the excluded flows
//      (wallet claim, trade links, token widget, live-site nav) compile OUT, every API call is
//      absolute to the live backend, and publicDir is off so nothing is copied blindly.
//   2. Copies an explicit allow-list from public/ (store-edition/store-edition.json): the two
//      tool pages the edition carries, the shared scripts they need, i18n, images. The pages are
//      transformed: <!-- STORE:OUT --> … <!-- /STORE:OUT --> blocks (and the /* STORE:OUT */ form)
//      are REMOVED, <!-- STORE:IN … /STORE:IN --> blocks are REVEALED, and "/api/…" becomes absolute.
//   3. Verifies the output the way a reviewer would: no forbidden string anywhere (wallet, pass,
//      swap widget, analytics, links to pages that are not in the bundle), no relative /api ref,
//      every local src/href resolves inside the bundle, required files present.
//   4. Tars it as store-edition-<variant>-<version>.tgz with ONE top-level directory (the wrapper
//      extracts with --strip-components=1), writes the sha256 and a JSON manifest with the source
//      commit. Deterministic tar flags so the same commit yields the same digest.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "store-edition", "store-edition.json"), "utf8"));
const variant = String(process.argv[2] || "google").toLowerCase();
if (!cfg.variants.includes(variant)) { console.error(`unknown variant "${variant}" — one of ${cfg.variants.join(", ")}`); process.exit(2); }
const OUT = path.join(ROOT, `dist-store-${variant}`);
const NAME = `store-edition-${variant}-${cfg.version}`;
const REL = path.join(ROOT, "release");
const log = (m) => console.log(`[store-edition] ${m}`);

// 1. vite
fs.rmSync(OUT, { recursive: true, force: true });
execFileSync("npx", ["vite", "build", "--outDir", OUT, "--emptyOutDir"], { cwd: ROOT, stdio: "inherit",
  env: { ...process.env, STORE_EDITION: variant } });

// 2. allow-listed files, transformed
const API = cfg.apiBase.replace(/\/+$/, "");
function transform(text) {
  let t = text;
  t = t.replace(/<!--\s*STORE:OUT[\s\S]*?<!--\s*\/STORE:OUT\s*-->/g, "");
  t = t.replace(/\/\*\s*STORE:OUT[^*]*\*\/[\s\S]*?\/\*\s*\/STORE:OUT\s*\*\//g, "");
  t = t.replace(/<!--\s*STORE:IN\s([\s\S]*?)\s\/STORE:IN\s*-->/g, "$1");
  t = t.replace(/\/\*\s*STORE:IN\s([\s\S]*?)\s\/STORE:IN\s*\*\//g, "$1");
  t = t.replace(/(["'`])\/api\//g, `$1${API}/api/`);
  return t;
}
const copy = (rel, tf) => {
  const src = path.join(ROOT, "public", rel), dst = path.join(OUT, rel);
  if (!fs.existsSync(src)) throw new Error(`allow-listed file missing: public/${rel}`);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  if (tf) fs.writeFileSync(dst, transform(fs.readFileSync(src, "utf8")));
  else fs.copyFileSync(src, dst);
};
// The vite chunks call api("/api/…") (src/edition.js) — the prefix is applied here, not at runtime.
for (const f of fs.readdirSync(path.join(OUT, "assets"))) if (/\.js$/.test(f)) {
  const fp = path.join(OUT, "assets", f);
  fs.writeFileSync(fp, fs.readFileSync(fp, "utf8").replace(/(["'`])\/api\//g, `$1${API}/api/`));
}
for (const p of cfg.pages) copy(p, true);
for (const f of cfg.files) copy(f, /\.(js|css)$/.test(f));
for (const d of cfg.dirs) for (const f of fs.readdirSync(path.join(ROOT, "public", d))) if (!/\.locker\.json$/.test(f)) copy(path.join(d, f), false);   // the Locker Room dictionary belongs to a page the bundle does not carry
// A tiny back link so a tool page always has a way home inside the app.
for (const p of cfg.pages) {
  const f = path.join(OUT, p); let t = fs.readFileSync(f, "utf8");
  if (!t.includes('href="./index.html"')) t = t.replace(/<body[^>]*>/, (m) => `${m}\n<a href="./index.html" style="position:fixed;top:calc(8px + env(safe-area-inset-top,0px));left:10px;z-index:9;font-family:var(--disp,sans-serif);font-size:12px;letter-spacing:1px;color:#FFB627;text-decoration:none;background:rgba(0,0,0,.55);border:1px solid rgba(255,182,39,.35);border-radius:8px;padding:6px 10px">← SCHOOL</a>`);
  fs.writeFileSync(f, t);
}

// 3. verify
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const files = walk(OUT);
const textFiles = files.filter((f) => /\.(html|js|css|json|webmanifest)$/.test(f));
const problems = [];
for (const f of textFiles) {
  const t = fs.readFileSync(f, "utf8"), rel = path.relative(OUT, f);
  // Translation dictionaries are inert text (site-wide strings); they are checked for API refs and
  // markers like everything else, but not for page paths a translated label may mention.
  if (!rel.endsWith(".json")) for (const bad of cfg.forbidden) if (t.includes(bad)) problems.push(`${rel}: forbidden "${bad}"`);
  const relApi = t.match(/["'`]\/api\/[a-zA-Z]/g); if (relApi) problems.push(`${rel}: relative /api reference (${relApi.length})`);
  if (/STORE:(OUT|IN)/.test(t)) problems.push(`${rel}: unprocessed STORE marker`);
  if (rel.endsWith(".html")) {
    for (const m of t.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
      const u = m[1];
      if (/^(https?:|mailto:|tel:|data:|#|javascript:)/.test(u)) { if (/^https?:/.test(u) && !cfg.remotes.some((r) => u.startsWith(r)) && !/^https?:\/\/(solscan\.io|x\.com|twitter\.com|t\.me|github\.com|rootcrak\.com)/.test(u)) problems.push(`${rel}: remote not allow-listed: ${u}`); continue; }
      const local = u.replace(/[?#].*$/, "").replace(/^\.\//, "").replace(/^\//, "");
      if (!local) continue;
      if (!fs.existsSync(path.join(OUT, local))) problems.push(`${rel}: local reference not in bundle: ${u}`);
    }
  }
}
for (const need of ["index.html", ...cfg.pages, "theme.css", "cluck-util.js", "i18n/es.json"]) if (!fs.existsSync(path.join(OUT, need))) problems.push(`missing required file: ${need}`);
if (!files.some((f) => /assets[\\/]index-.*\.js$/.test(f))) problems.push("missing the vite entry chunk");
if (problems.length) { console.error("[store-edition] VERIFICATION FAILED:\n  " + problems.join("\n  ")); process.exit(1); }
log(`verified ${files.length} files, no forbidden content, no relative /api refs`);

// 4. tar + sha256 + manifest
fs.mkdirSync(REL, { recursive: true });
const staging = path.join(REL, ".stage-" + variant); fs.rmSync(staging, { recursive: true, force: true }); fs.mkdirSync(staging, { recursive: true });
fs.cpSync(OUT, path.join(staging, NAME), { recursive: true });
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT }).toString().trim();
const commitTime = execFileSync("git", ["show", "-s", "--format=%ct", "HEAD"], { cwd: ROOT }).toString().trim();
const tgz = path.join(REL, `${NAME}.tgz`);
execFileSync("tar", ["--sort=name", "--owner=0", "--group=0", "--numeric-owner", `--mtime=@${commitTime}`, "-I", "gzip -n", "-cf", tgz, "-C", staging, NAME]);
fs.rmSync(staging, { recursive: true, force: true });
const sha256 = createHash("sha256").update(fs.readFileSync(tgz)).digest("hex");
fs.writeFileSync(`${tgz}.sha256`, `${sha256}  ${path.basename(tgz)}\n`);
const manifest = { variant, version: cfg.version, file: path.basename(tgz), bytes: fs.statSync(tgz).size, sha256, sourceCommit, builtAt: new Date().toISOString(), apiBase: cfg.apiBase, topDir: NAME, stripComponents: 1 };
fs.writeFileSync(path.join(REL, `${NAME}.json`), JSON.stringify(manifest, null, 2) + "\n");
log(`wrote release/${path.basename(tgz)} (${manifest.bytes} bytes) sha256 ${sha256} from ${sourceCommit.slice(0, 10)}`);
console.log(JSON.stringify(manifest));
