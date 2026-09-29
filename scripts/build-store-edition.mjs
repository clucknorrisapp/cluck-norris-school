#!/usr/bin/env node
// Build a STORE-family edition of the school. Usage: node scripts/build-store-edition.mjs
// [google|ios|seeker]
//
// google/ios — the education-only bundle the Google Play / iOS wrapper ships INSIDE the app
// (docs/STORE_EDITION.md; contract: the wrapper repo's DELIVERY-CONTRACT.md). UNCHANGED by the
// addition of the third variant below — same config file (store-edition/store-edition.json),
// same steps, same output.
//
// seeker — the Solana dApp Store variant (docs/SEEKER_APP_PLAN.md), added 2026-09-19. Its own
// config, store-edition/seeker-edition.json: no wallet/payment ban (the opposite of google/ios —
// full features, on purpose), a fresh mobile shell entry (seeker.html / src/seeker/*, hash-routed
// since a bundled Capacitor app has no server to rewrite deep paths) instead of the desktop React
// school, and its own short forbidden-word list (the hard rules — no Wallet Watch / Nomadz /
// Solana Foundation mentions, no yield/APR/APY/guaranteed language) rather than the store-edition
// wallet ban. Reuses every mechanical step below (vite build, copy+transform, verify, tar+manifest)
// — the seeker-only differences are called out at each step rather than forked into a new file.
//
// What each step does, and why it exists (variant-generic; per-variant behaviour comes from cfg):
//   1. `vite build` with STORE_EDITION set → for google/ios, src/edition.js folds STORE=true and
//      the excluded flows compile out (unchanged); for seeker, vite.config.js instead swaps the
//      build ENTRY to seeker.html (vite.config.js's SEEKER branch) — the only vite.config.js
//      change this variant needed. Every variant gets publicDir off (nothing copied blindly) and
//      every "/api/…" made absolute to the live backend.
//   2. Copies an explicit allow-list from public/ (cfg.pages / cfg.files / cfg.dirs): google/ios
//      carry the two tool pages the edition needs; seeker carries none (cfg.pages: []) and instead
//      just the shared scripts its shell loads (cluck-util.js, cluck-wallet.js, i18n.js, theme.css,
//      icon). Any HTML copied this way is transformed: <!-- STORE:OUT --> … blocks removed,
//      <!-- STORE:IN --> blocks revealed, "/api/…" made absolute — a no-op on seeker's shared .js
//      files where none of those markers exist, but the same "/api/…" → absolute rewrite still
//      applies (cluck-util.js's RPC helper and i18n.js's translate fallback both call it).
//   3. Verifies the output the way a reviewer would: no forbidden string anywhere (cfg.forbidden /
//      cfg.forbiddenPatterns — the wallet/pass/swap-widget ban for google/ios, the hard-rule words
//      for seeker), no relative /api ref, every local src/href resolves inside the bundle, every
//      allowedHosts, required files present, and — seeker only — hash routing (the shell's own
//      router) and no reliance on a remote server.url load.
//   4. Tars it as store-edition-<variant>-<version>.tgz with ONE top-level directory (the wrapper
//      extracts with --strip-components=1), writes the sha256 and a JSON manifest with the source
//      commit. Deterministic tar flags so the same commit yields the same digest. Unchanged code
//      path for every variant.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const variant = String(process.argv[2] || "google").toLowerCase();
const SEEKER_VARIANTS = ["seeker"];
const isSeeker = SEEKER_VARIANTS.includes(variant);
// Each family owns its own config file — google/ios keep reading exactly the file they always
// did, so nothing about their build can change from seeker existing.
const cfgFile = isSeeker ? "seeker-edition.json" : "store-edition.json";
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "store-edition", cfgFile), "utf8"));
if (!cfg.variants.includes(variant)) {
  const known = [...JSON.parse(fs.readFileSync(path.join(ROOT, "store-edition", "store-edition.json"), "utf8")).variants, ...SEEKER_VARIANTS];
  console.error(`unknown variant "${variant}" — one of ${known.join(", ")}`); process.exit(2);
}
// store-edition v1.1.0 (owner, 2026-09-21): google/ios are built from the SEEKER SHELL (seeker.html,
// src/seeker/*) in its education edition — `entry: "seeker"` in store-edition.json. The v1.0.x
// website bundle is still what a config WITHOUT `entry` builds, byte for byte. STORE_ENTRY tells
// vite.config.js to use the shell entry and the education alias; the html rename and the chunk
// check below follow the same branch the seeker variant already took.
const useShell = !isSeeker && cfg.entry === "seeker";
const OUT = path.join(ROOT, `dist-store-${variant}`);
const NAME = `store-edition-${variant}-${cfg.version}`;
const REL = path.join(ROOT, "release");
const log = (m) => console.log(`[store-edition] ${m}`);

// 1. vite
fs.rmSync(OUT, { recursive: true, force: true });
execFileSync("npx", ["vite", "build", "--outDir", OUT, "--emptyOutDir"], { cwd: ROOT, stdio: "inherit",
  env: { ...process.env, STORE_EDITION: variant, ...(useShell ? { STORE_ENTRY: "seeker" } : {}) } });
// seeker builds a DIFFERENT html entry (seeker.html, vite.config.js's SEEKER branch) — the
// Capacitor wrapper (and this script's own verify/tar steps below) both expect the app's single
// entry at the bundle root as index.html, same as every other variant.
if (isSeeker || useShell) {
  const from = path.join(OUT, "seeker.html"), to = path.join(OUT, "index.html");
  if (!fs.existsSync(from)) throw new Error("vite did not produce seeker.html — check vite.config.js's SHELL branch");
  fs.renameSync(from, to);
}

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
// Translation dictionaries are the whole site's tables, so they are PRUNED, not copied: any entry
// whose key or value carries a forbidden string or matches a forbidden pattern is dropped (v1.0.1
// shipped the CLKN mint inside an orphaned Survival-Simulator line in six dictionaries — the
// English text no longer existed, the translations did). A pruned entry only ever costs a
// translation falling back to English; it can never leak. The verifier below then scans the
// copied JSON with the same rules as code.
const forbiddenHit = (t) => cfg.forbidden.some((b) => t.includes(b)) || (cfg.forbiddenPatterns || []).some((p) => new RegExp(p).test(t));
// EXACT-key exclusion (google/ios only — cfg.excludeKeys is undefined everywhere else),
// 2026-09-19: the Seeker app's own copy (docs/SEEKER_APP_PLAN.md) is curated into these SAME
// shared public/i18n/<lang>.json files, per the site-wide convention (same files
// hub-glossary.html / solana-room.html curate into) — there is no seeker-only dictionary family.
// Those entries are harmless to carry (neither store-edition page ever renders them) but pruning
// them by SUBSTRING the way `forbidden` above does would risk collateral damage — e.g. adding the
// literal word "Disconnect" would also match the existing, unrelated key that CONTAINS
// "Disconnecting" — so this is an exact, whole-key match instead, keeping google/ios's shipped
// dictionaries (and their tarball) byte-for-byte unaffected by an unrelated feature's new copy.
const EXCLUDE_KEYS = new Set(cfg.excludeKeys || []);
let pruned = 0;
for (const d of cfg.dirs) for (const f of fs.readdirSync(path.join(ROOT, "public", d))) {
  if (/\.locker\.json$/.test(f)) continue;   // the Locker Room dictionary belongs to a page the bundle does not carry
  const src = path.join(ROOT, "public", d, f), dst = path.join(OUT, d, f);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  if (!f.endsWith(".json")) { fs.copyFileSync(src, dst); continue; }
  const dict = JSON.parse(fs.readFileSync(src, "utf8")); const out = {};
  for (const [k, v] of Object.entries(dict)) { if (EXCLUDE_KEYS.has(k) || forbiddenHit(k) || (typeof v === "string" && forbiddenHit(v))) { pruned++; continue; } out[k] = v; }
  fs.writeFileSync(dst, JSON.stringify(out));
}
log(`dictionaries: pruned ${pruned} entries that carried forbidden content`);
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
  {   // every text file, the pruned dictionaries included: default-deny, no exemptions
    for (const bad of cfg.forbidden) if (t.includes(bad)) problems.push(`${rel}: forbidden "${bad}"`);
    // Regexes for the shapes a plain string can miss: any jup.ag route, any referral parameter on
    // any URL (RootCrak's ?ref=clucknorris is the one allowed credit), the trade venues.
    for (const pat of cfg.forbiddenPatterns || []) { const m = t.match(new RegExp(pat)); if (m) problems.push(`${rel}: forbidden pattern /${pat}/ → "${m[0].slice(0, 80)}"`); }
    // ALLOW-list of outbound hosts (Codex, 2026-09-12): a deny-list can only name what it already
    // knows. Every http(s) URL in every copied file — JS, HTML, CSS, JSON — must point at a host on
    // the list, or the build fails and the new host is a deliberate, reviewed addition.
    // VENDORED third-party bundles are exempt from the host scan, and this is deliberate.
    // They are pinned artifacts we do not author: @solana/web3.js's UMD carries feross.org and
    // github.com in its licence comments and api.{devnet,testnet,mainnet-beta}.solana.com as
    // library defaults our code never calls. Scanning them forced those hosts onto the GLOBAL
    // allow-list, which quietly blunted it — api.mainnet-beta.solana.com sitting in the list
    // would have let a future accident bypass our own /api/helius-rpc proxy without the build
    // saying a word. An allow-list that has to be widened for strings nobody can act on stops
    // being a guard.
    // What covers vendored files instead is the RUNTIME half: scripts/seeker-app-boot-test.cjs
    // boots the shipped tarball and asserts it reaches nothing off-device but our own API. Build
    // scan for the code we write, runtime scan for everything that actually executes — the
    // complementary-blind-spots pairing AGENTS.md calls "check every form, not one form".
    const vendored = /(^|\/)vendor\//.test(rel);
    if (!vendored) {
      for (const m of t.matchAll(/https?:\/\/([a-zA-Z0-9.-]+)/g)) if (!cfg.allowedHosts.includes(m[1])) problems.push(`${rel}: host not allow-listed: ${m[1]}`);
    }
  }
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
// google/ios keep the exact original assertion (their chunk is always named "index-*"). seeker's
// entry is seeker.html, so vite names its chunk after THAT basename instead — checked separately
// rather than loosening the shared regex, so google/ios can't silently pass a broken build.
if (isSeeker) {
  if (!fs.existsSync(path.join(OUT, "cluck-wallet.js"))) problems.push("missing required file: cluck-wallet.js");
  if (!files.some((f) => /assets[\\/].*\.js$/.test(f))) problems.push("missing the vite entry chunk");
  // Self-contained + hash-routed (docs/SEEKER_APP_PLAN.md; CLKN-SEEKER's DELIVERY-CONTRACT.md): a
  // bundled Capacitor app has no server to rewrite a deep path back to index.html, so the shell
  // must route off the # fragment. Checked against the SOURCE (src/seeker/App.jsx), not the built
  // chunk — production minification renames local identifiers like `HashRouter` to something
  // unminifiable-searchable, so a source-level check is the reliable one (and it also means the
  // check still catches a regression before a single byte gets minified).
  const appSrc = fs.readFileSync(path.join(ROOT, "src", "seeker", "App.jsx"), "utf8");
  if (!/\bHashRouter\b/.test(appSrc)) problems.push("src/seeker/App.jsx does not use HashRouter — a bundled app has no server to rewrite deep paths, it must hash-route");
  if (/\bBrowserRouter\b/.test(appSrc)) problems.push("src/seeker/App.jsx uses BrowserRouter — a bundled app has no server to rewrite deep paths, it must hash-route");
} else if (useShell) {
  // The education edition of the shell. Its chunk is named after seeker.html, like the seeker
  // variant's; what distinguishes it is what must NOT be there, and the forbidden list above
  // already refuses cluck-wallet.js, cluck-gate.js, solana-web3 and the wallet globals. Two
  // structural checks on top: the wallet scripts were actually stripped from the html, and the
  // shell still hash-routes (a bundled app has no server to rewrite deep paths).
  if (!files.some((f) => /assets[\\/].*\.js$/.test(f))) problems.push("missing the vite entry chunk");
  const html = fs.readFileSync(path.join(OUT, "index.html"), "utf8");
  if (/EDU:OUT/.test(html)) problems.push("index.html: EDU:OUT block was not stripped — the wallet scripts are in the education bundle");
  for (const bad of ["cluck-wallet.js", "cluck-gate.js", "solana-web3", "rent-reclaim-plan.js", "airdrop-engine.js"]) if (html.includes(bad)) problems.push(`index.html: loads ${bad} — the education edition must not carry the wallet half of the shell`);
  if (!/data-i18n-packs="school"/.test(html)) problems.push("index.html: the shell must declare data-i18n-packs=\"school\" or the curated lesson translations never load");
  const appSrc = fs.readFileSync(path.join(ROOT, "src", "seeker", "App.jsx"), "utf8");
  if (!/\bHashRouter\b/.test(appSrc) || /\bBrowserRouter\b/.test(appSrc)) problems.push("src/seeker/App.jsx must hash-route — a bundled app has no server to rewrite deep paths");
  const eduSrc = fs.readFileSync(path.join(ROOT, "src", "seeker", "edition", "edu.jsx"), "utf8");
  for (const bad of ["needswallet", "RentReclaim", "ToolsHome", "tools/registry", "passgate", "pass.js", "reclaim-sign", "Firepit", "LockerRoom", "Airdropper", "Hatchery", "BuySpecial", "WalletXray", "Holders", "Trace", "ProjectBurn"]) {
    if (new RegExp("import[^\\n]*" + bad.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).test(eduSrc)) problems.push(`src/seeker/edition/edu.jsx imports ${bad} — the education edition's import list is the safety argument; a wallet pane in it is a wallet in the store`);
  }
} else {
  if (!files.some((f) => /assets[\\/]index-.*\.js$/.test(f))) problems.push("missing the vite entry chunk");
}
if (problems.length) { console.error("[store-edition] VERIFICATION FAILED:\n  " + problems.join("\n  ")); process.exit(1); }
log(`verified ${files.length} files, no forbidden content, no relative /api refs`);

// 4. tar + sha256 + manifest
fs.mkdirSync(REL, { recursive: true });
const staging = path.join(REL, ".stage-" + variant); fs.rmSync(staging, { recursive: true, force: true }); fs.mkdirSync(staging, { recursive: true });
fs.cpSync(OUT, path.join(staging, NAME), { recursive: true });
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT }).toString().trim();
const commitTime = execFileSync("git", ["show", "-s", "--format=%ct", "HEAD"], { cwd: ROOT }).toString().trim();
const tgz = path.join(REL, `${NAME}.tgz`);
// GNU tar makes the archive byte-reproducible (sorted entries, fixed owner and mtime). macOS ships
// bsdtar, which refuses --sort/--mtime/-I and failed the owner's `npm run build:ios-dev` on his
// Mac (2026-09-25) before Xcode ever got the new files — so Xcode kept showing an old build. Use
// GNU tar wherever it exists (`tar` on Linux and CI, `gtar` from Homebrew's gnu-tar), and only
// otherwise fall back to a plain bsdtar archive: same contents, not byte-reproducible. Releases
// that get pinned are built in CI, on GNU tar.
function gnuTar() {
  for (const bin of ["tar", "gtar"]) {
    try { if (/GNU tar/.test(execFileSync(bin, ["--version"], { stdio: ["ignore", "pipe", "ignore"] }).toString())) return bin; } catch (_) {}
  }
  return null;
}
const tarBin = gnuTar();
if (tarBin) {
  execFileSync(tarBin, ["--sort=name", "--owner=0", "--group=0", "--numeric-owner", `--mtime=@${commitTime}`, "-I", "gzip -n", "-cf", tgz, "-C", staging, NAME]);
} else {
  log("GNU tar not found (macOS bsdtar) — archive contents are identical but NOT byte-reproducible; fine for a local dev build, never pin it");
  // COPYFILE_DISABLE keeps macOS from adding ._ AppleDouble files to the archive.
  execFileSync("tar", ["--uid", "0", "--gid", "0", "-czf", tgz, "-C", staging, NAME], { env: { ...process.env, COPYFILE_DISABLE: "1" } });
}
fs.rmSync(staging, { recursive: true, force: true });
const sha256 = createHash("sha256").update(fs.readFileSync(tgz)).digest("hex");
fs.writeFileSync(`${tgz}.sha256`, `${sha256}  ${path.basename(tgz)}\n`);
const manifest = { variant, version: cfg.version, file: path.basename(tgz), bytes: fs.statSync(tgz).size, sha256, sourceCommit, builtAt: new Date().toISOString(), apiBase: cfg.apiBase, topDir: NAME, stripComponents: 1 };
fs.writeFileSync(path.join(REL, `${NAME}.json`), JSON.stringify(manifest, null, 2) + "\n");
log(`wrote release/${path.basename(tgz)} (${manifest.bytes} bytes) sha256 ${sha256} from ${sourceCommit.slice(0, 10)}`);
console.log(JSON.stringify(manifest));
