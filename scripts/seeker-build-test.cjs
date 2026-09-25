#!/usr/bin/env node
"use strict";
// The Seeker app, increment 1 (docs/SEEKER_APP_PLAN.md) — a third, additive store-edition
// variant for the Solana dApp Store, alongside the existing google/ios education-only bundles.
// Pins:
//
//   (a) BUILD: `node scripts/build-store-edition.mjs seeker` succeeds and writes a tarball whose
//       manifest matches its own contents (same shape store-edition-test.cjs already checks for
//       google/ios).
//   (b) SELF-CONTAINED + HASH-ROUTED: the bundle is one top-level dir with index.html at its
//       root after --strip-components=1 (no server.url remote load — everything the app needs is
//       IN the tarball), every local src/href in index.html resolves inside the bundle, no
//       relative "/api/…" reference survives anywhere, and the shell's own source
//       (src/seeker/App.jsx) uses HashRouter, never BrowserRouter — a bundled Capacitor app has
//       no server to rewrite a deep path back to index.html.
//   (c) GOOGLE/IOS UNAFFECTED: two separate questions, and only the first is an invariant.
//       HARD — no seeker content leaks into an education-only bundle: no seeker-shaped path, no
//       seeker marker string, and no seeker-only i18n key in any dictionary the bundle ships
//       (the excludeKeys prune, checked against the built artifact rather than the config).
//       EXPLAINED — the bundles are also rebuilt from a PRISTINE checkout of origin/develop (a
//       disposable git worktree, node_modules symlinked in — no second `npm install`) and
//       content-diffed against this tree's (a content diff, not a raw .tgz compare: the tar's
//       deterministic mtime is tied to HEAD's commit time and legitimately differs). A diff here
//       is NOT automatically a fault — the school IS the google/ios editions' content, so a
//       lesson or a translation legitimately moves those bytes. So the diff fails only when this
//       branch changed NOTHING the bundles are built from and they moved anyway; otherwise it is
//       reported in full, beside the branch's own shared-file changes that explain it.
//       (An earlier revision asserted "byte-identical, always" and correctly caught a real
//       change — lesson 16 — as if it were a leak. Do not restore that form: it makes every
//       school edit red and teaches people to ignore this section.)
//   (d) MWA-AWARE WALLET LAYER: public/cluck-wallet.js's registry, driven with an INJECTED FAKE
//       Capacitor.Plugins.CluckMWA bridge in a Node `vm` sandbox (no real device exists to test
//       against, same posture as scripts/wallet-standard-test.cjs's fake standard wallet) —
//       connect() returns a real address through the shared connect()/available() surface,
//       sign/send/message round-trip through the fake bridge, disconnect clears state, and on the
//       web (no Capacitor) the SAME file falls back to its existing legacy/standard detection
//       completely unchanged.
//   (e) SHELL TAP TARGETS: every interactive control in src/seeker/seeker.css declares a
//       min-height/min-width >= 44px (static, so this always runs with no browser); when
//       playwright-core is resolvable (skipped gracefully otherwise, same posture as
//       hub-glossary-test.cjs), a real headless Chromium also renders the bundle, taps through
//       the bottom nav (hash changes, no page reload), and drives a full connect through a fake
//       MWA bridge end to end.
//   (f) I18N: the 8 new curated keys this increment added exist, byte-for-byte the same English
//       key, in all six public/i18n/<lang>.json dictionaries, and `node scripts/i18n-audit.cjs`
//       itself exits 0 with no gating findings.
//
// Usage: node scripts/seeker-build-test.cjs

const { execFileSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");

// The curated English keys increment 1 added for the seeker shell. They must exist in all six
// public/i18n/<lang>.json dictionaries (section f) AND must never reach a google/ios bundle
// (section c) — store-edition.json's excludeKeys prunes them out of the education-only copy.
// ⚠️ GENERATED, NOT KEPT BY HAND. Every string src/seeker passes to t(), extracted from the
// source by scripts/seeker-i18n-keys.cjs. It used to be eight literals typed into this file,
// which was fine while the app had three panes and became a lie the moment it had fifteen: the
// list would have stayed at eight while 600 new strings shipped untranslated and unexcluded,
// and every assertion below would have gone on passing. The extractor is the single source for
// this test, for store-edition.json's excludeKeys (--sync-exclude), and for the translation
// work itself (--missing <lang>).
const KEYS_MOD = require(path.join(__dirname, "seeker-i18n-keys.cjs"));
const SEEKER_KEYS = KEYS_MOD.keys();
// store-edition v1.1.0: google/ios are the shell's EDUCATION edition, so the keys that must not
// reach them are the ones only a WALLET pane renders — every seeker key MINUS the education
// edition's own (computed from src/seeker/edition/edu.jsx's import graph, same extractor).
const EDU_KEYS = new Set(KEYS_MOD.eduKeys());
const WALLET_ONLY_KEYS = SEEKER_KEYS.filter((k) => !EDU_KEYS.has(k));
// Strings that only ever exist because of the WALLET half of the shell. Generic wording
// ("Disconnect") is deliberately NOT in here — it appears legitimately in shared code; these do
// not. "seeker-edition" / "src/seeker" are gone from this list: since v1.1.0 the education
// bundle is built from src/seeker, and its chunk is named after seeker.html.
// ⚠️ Not "Locker Room" or "Firepit": both are website pages the shared dictionaries and the
// curriculum name legitimately ("lock your own tokens free at the Locker Room" is lesson copy).
const SEEKER_MARKERS = ["Rent Reclaim", "CluckMWA", "Connect Wallet", "Disconnect wallet", "reclaim-sign"];
let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (detail ? "\n      " + (typeof detail === "string" ? detail : JSON.stringify(detail)) : "")); }
};

function walk(d) {
  return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
}

function buildVariant(cwd, variant) {
  const outText = execFileSync(process.execPath, [path.join(cwd, "scripts", "build-store-edition.mjs"), variant], { cwd, stdio: ["ignore", "pipe", "pipe"] }).toString();
  return JSON.parse(outText.trim().split("\n").pop());
}

(async () => {
  // ══════════════════════════════════════════════════════════════════════════════════════════
  // (a) build
  // ══════════════════════════════════════════════════════════════════════════════════════════
  console.log("\n(a) build — the seeker variant\n");
  let manifest;
  try {
    manifest = buildVariant(ROOT, "seeker");
    ok("build succeeds and writes a tarball", true);
  } catch (e) {
    ok("build succeeds and writes a tarball", false, (e && e.stack) || String(e));
    console.log(`\n${fail} FAILED (could not proceed past the build)`);
    process.exit(1);
  }
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "store-edition", "seeker-edition.json"), "utf8"));
  const tgz = path.join(ROOT, "release", manifest.file);
  ok("tarball named per the version in seeker-edition.json", manifest.file === `store-edition-seeker-${cfg.version}.tgz`, manifest.file);
  ok("manifest sha256 matches the file on disk", fs.existsSync(tgz) && crypto.createHash("sha256").update(fs.readFileSync(tgz)).digest("hex") === manifest.sha256);
  ok("sourceCommit is a full git sha", /^[0-9a-f]{40}$/.test(manifest.sourceCommit));

  const extractDir = fs.mkdtempSync(path.join(os.tmpdir(), "seeker-bundle-"));
  const listing = execFileSync("tar", ["-tzf", tgz]).toString().trim().split("\n");
  const top = new Set(listing.map((l) => l.split("/")[0]));
  ok("exactly one top-level directory, named like the file", top.size === 1 && [...top][0] === manifest.topDir, [...top]);
  execFileSync("tar", ["-xzf", tgz, "-C", extractDir, "--strip-components=1"]);

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // (b) self-contained + hash-routed
  // ══════════════════════════════════════════════════════════════════════════════════════════
  console.log("\n(b) self-contained + hash routing\n");
  ok("index.html sits at the bundle root (--strip-components=1, no server needed to find it)", fs.existsSync(path.join(extractDir, "index.html")));
  const indexHtml = fs.readFileSync(path.join(extractDir, "index.html"), "utf8");
  const bundleFiles = walk(extractDir);
  const bundleRel = new Set(bundleFiles.map((f) => path.relative(extractDir, f).split(path.sep).join("/")));

  // every local src/href resolves INSIDE the bundle — nothing assumes a remote page load found it
  const localRefs = [...indexHtml.matchAll(/(?:src|href)=["']([^"']+)["']/g)].map((m) => m[1])
    .filter((u) => !/^(https?:|mailto:|tel:|#|data:|javascript:)/.test(u))
    .map((u) => u.replace(/^\//, "").replace(/[?#].*$/, ""));
  for (const ref of localRefs) ok(`index.html's local reference resolves inside the bundle: ${ref}`, bundleRel.has(ref));
  ok("index.html has at least one bundled script and one bundled stylesheet", localRefs.length >= 2, localRefs);

  const textFiles = bundleFiles.filter((f) => /\.(html|js|css|json)$/.test(f));
  const allText = textFiles.map((f) => fs.readFileSync(f, "utf8")).join("\n");
  ok("no relative /api reference anywhere in the bundle (self-contained — no local server to call)", !/["'`]\/api\/[a-zA-Z]/.test(allText));
  ok("no reference to a remote page load (Capacitor server.url) — everything ships IN the bundle", !/\bserver\.url\b/.test(allText));

  const appSrc = fs.readFileSync(path.join(ROOT, "src", "seeker", "App.jsx"), "utf8");
  ok("the shell routes with HashRouter (a bundled app has no server to rewrite a deep path)", /\bHashRouter\b/.test(appSrc));
  ok("the shell never uses BrowserRouter", !/\bBrowserRouter\b/.test(appSrc));
  ok("seeker.html's own script tags are root-absolute (no server.url dependency, matches the proven google/ios pattern)",
    /<link rel="stylesheet" href="\/theme\.css"/.test(fs.readFileSync(path.join(ROOT, "seeker.html"), "utf8")));

  for (const bad of cfg.forbidden) ok(`bundle never contains "${bad}"`, !allText.includes(bad));
  for (const pat of cfg.forbiddenPatterns || []) ok(`bundle never matches /${pat}/`, !new RegExp(pat).test(allText));

  fs.rmSync(extractDir, { recursive: true, force: true });

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // (c) google/ios — no seeker leakage (hard), and any bundle change explained (see the header)
  // ══════════════════════════════════════════════════════════════════════════════════════════
  console.log("\n(c) google/ios — no seeker leakage, and any bundle change explained by this branch\n");
  let baseline = null, baselineWt = null;
  try {
    execFileSync("git", ["rev-parse", "--verify", "origin/develop"], { cwd: ROOT });
    baselineWt = fs.mkdtempSync(path.join(os.tmpdir(), "seeker-baseline-"));
    fs.rmdirSync(baselineWt);   // `git worktree add` wants to create the dir itself
    execFileSync("git", ["worktree", "add", "--detach", "--quiet", baselineWt, "origin/develop"], { cwd: ROOT, stdio: "pipe" });
    // Resolve the REAL node_modules directory via require.resolve rather than assuming
    // path.join(ROOT, "node_modules") — this session runs from a git worktree nested under the
    // main checkout (.claude/worktrees/<id>), which has no node_modules of its own and instead
    // gets one for free from Node's ancestor-directory module resolution (require.resolve('vite')
    // here resolves to the MAIN checkout's node_modules, two directories up). Symlinking
    // path.join(ROOT, "node_modules") in that setup creates a DANGLING symlink (fs.symlinkSync
    // never checks the target exists), which fails silently here and only surfaces later as a
    // confusing "Cannot find module 'vite'" from inside the pristine worktree's own vite.config.js
    // — this resolves the actual directory instead, which is a no-op on a normal checkout (where
    // ROOT/node_modules is that same directory) and correct here too.
    const realNodeModules = path.dirname(path.dirname(require.resolve("vite/package.json")));
    fs.symlinkSync(realNodeModules, path.join(baselineWt, "node_modules"));
    baseline = baselineWt;
  } catch (e) {
    console.log("  · could not set up a pristine origin/develop worktree — skipping the comparison");
    console.log("    (" + ((e && e.message) || String(e)).split("\n")[0] + ")");
  }
  function extractedFiles(tgz) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "seeker-cmp-"));
    execFileSync("tar", ["-xzf", tgz, "-C", dir, "--strip-components=1"]);
    const map = new Map();
    for (const f of walk(dir)) map.set(path.relative(dir, f).split(path.sep).join("/"), fs.readFileSync(f));
    fs.rmSync(dir, { recursive: true, force: true });
    return map;
  }

  // What THIS branch changed, relative to origin/develop, that a google/ios bundle is actually
  // built from. Non-empty ⇒ a bundle diff is expected and gets reported rather than failed;
  // empty ⇒ a bundle that moved anyway is unexplained, and that is the real alarm. Paths that
  // cannot reach an education-only bundle (the seeker shell, the seeker edition config) are
  // excluded on purpose — they must never be the explanation for a google/ios change.
  let sharedChanges = null;
  try {
    const mb = execFileSync("git", ["merge-base", "origin/develop", "HEAD"], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
    sharedChanges = execFileSync("git", ["diff", "--name-only", mb, "HEAD"], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] })
      .toString().split("\n").map((x) => x.trim()).filter(Boolean)
      .filter((f) => /^(src\/|public\/|store-edition\/|data\/|index\.html$|vite\.config\.js$)/.test(f))
      // v1.1.0: src/seeker IS what google/ios are built from now, so a change there is a valid
      // explanation for a bundle diff. Only the seeker variant's own config stays excluded.
      .filter((f) => f !== "store-edition/seeker-edition.json");
  } catch (_) { sharedChanges = null; }

  let googleTgz = null;
  for (const variant of ["google", "ios"]) {
    const here = buildVariant(ROOT, variant);
    if (variant === "google") googleTgz = path.join(ROOT, "release", here.file);
    ok(`${variant}: this tree's build verifies clean (build-store-edition.mjs's own checks passed)`, true);

    // ── HARD: nothing WALLET-shaped ships inside an education-only bundle ────────────────────
    // ⚠️ RESTATED for store-edition v1.1.0 (owner, 2026-09-21). google/ios are now built FROM the
    // seeker shell (its education edition, src/seeker/edition/edu.jsx), so "no seeker-shaped
    // path" is no longer the invariant — the entry chunk is literally named seeker-*.js. What
    // must still be true, and is stronger: none of the WALLET half of the shell is in the bundle.
    // Not the files (cluck-wallet.js, cluck-gate.js, the vendored web3, the reclaim/airdrop
    // helpers), not the globals, not the marker strings of the wallet panes, and not the
    // dictionary keys that only a wallet pane renders.
    const hereFiles = extractedFiles(path.join(ROOT, "release", here.file));
    const herePaths = [...hereFiles.keys()].sort();
    // ⚠️ rent-math.js is NOT wallet-shaped (v1.2.0, the Solana Room's rent page): pure lamport/SOL
    // arithmetic, no wallet call, no address, no network — it now ships in BOTH editions on
    // purpose (seeker.html loads it outside the EDU:OUT block) so the room's numbers and
    // /solana/rent's numbers are the same computation. Dropped from this pattern deliberately;
    // everything else here is still real wallet code and must still never appear.
    const walletFiles = herePaths.filter((f) => /cluck-wallet\.js|cluck-gate\.js|solana-web3|rent-reclaim-plan|airdrop-(engine|plan)\.js/.test(f));
    ok(`${variant}: none of the wallet half's files are in the bundle`, walletFiles.length === 0, walletFiles);
    const hereText = herePaths.filter((f) => /\.(html|js|css|json)$/.test(f))
      .map((f) => hereFiles.get(f).toString("utf8")).join("\n");
    // ⚠️ v1.2.0: the Solana Room's own ported wallet.html content legitimately QUOTES the phrase
    // "Connect Wallet" as prose ("Clicking \"Connect Wallet\" asks your wallet extension for one
    // thing…") — it's the website's existing explainer copy, not the wallet pane's button, and it
    // ships in the education edition on purpose (the room has no wallet gate). Stripping this one
    // known, audited sentence before the marker scan keeps the check meaningful for an actual
    // leaked wallet control (a bare `t("Connect Wallet")` button label reaching the bundle) rather
    // than a false alarm on the room's own text. scripts/seeker-solana-room-test.cjs separately
    // pins that this exact sentence exists in content.js and matches the website verbatim.
    // The quoted phrase appears at a DIFFERENT position in each language's own sentence order
    // (e.g. Hindi puts it first: `"Connect Wallet" पर क्लिक करना…`), and JSON-escaped as \"…\" in
    // every dictionary — so this strips the quoted phrase itself, in either escaping, rather than
    // trying to match one language's whole sentence.
    const KNOWN_ROOM_QUOTES = [/\\?"Connect Wallet\\?"/g];
    const hereTextForMarkers = KNOWN_ROOM_QUOTES.reduce((s, re) => s.replace(re, ""), hereText);
    const foundMarkers = SEEKER_MARKERS.filter((m) => hereTextForMarkers.includes(m));
    ok(`${variant}: no wallet-pane marker string anywhere in the bundle`, foundMarkers.length === 0, foundMarkers);
    const walletGlobals = ["CluckWallet", "CluckGate", "CluckMWA", "signTransaction", "signAndSendTransaction"].filter((g) => hereText.includes(g));
    ok(`${variant}: no wallet global is referenced anywhere in the bundle`, walletGlobals.length === 0, walletGlobals);
    const i18nPaths = herePaths.filter((f) => /^i18n\/.+\.json$/.test(f));
    ok(`${variant}: the bundle actually ships i18n dictionaries (so the next two checks mean something)`, i18nPaths.length > 0);
    const leaked = [], kept = [];
    for (const f of i18nPaths) {
      let dict = {};
      try { dict = JSON.parse(hereFiles.get(f).toString("utf8")); } catch (_) { dict = {}; }
      for (const k of WALLET_ONLY_KEYS) if (Object.prototype.hasOwnProperty.call(dict, k)) leaked.push(`${f} → ${k}`);
      // And the OPPOSITE failure: the shell's own strings pruned out of its own dictionaries,
      // which is what the old "exclude every seeker key" rule would have done to this bundle —
      // a Spanish-speaking learner would get an English app. Sampled on one load-bearing key.
      if (/\/es\.json$/.test(f) && !Object.prototype.hasOwnProperty.call(dict, "School of Crypto Hard Knocks")) kept.push(f);
    }
    ok(`${variant}: no bundled dictionary carries a WALLET-only key (the excludeKeys prune held on the ARTIFACT)`, leaked.length === 0, leaked);
    ok(`${variant}: ⚠️ and the shell's OWN strings survived the prune (es.json still translates the school title)`, kept.length === 0, kept);

    if (!baseline) continue;

    // ── EXPLAINED: content diff against a pristine origin/develop build ──────────────────────
    let base;
    try { base = buildVariant(baseline, variant); }
    catch (e) { ok(`${variant}: pristine origin/develop build also succeeds`, false, (e && e.stack) || String(e)); continue; }
    // topDir is `store-edition-<variant>-<version>`, so it moves with every version bump (1.0.3 →
    // 1.1.0 here); it is checked against THIS tree's config below, not against the baseline.
    for (const field of ["variant", "apiBase", "stripComponents"]) {
      ok(`${variant}: manifest.${field} matches the pristine build`, JSON.stringify(here[field]) === JSON.stringify(base[field]), `here=${here[field]} base=${base[field]}`);
    }
    {
      const cfgNow = JSON.parse(fs.readFileSync(path.join(ROOT, "store-edition", "store-edition.json"), "utf8"));
      ok(`${variant}: manifest.topDir names this tree's version (${cfgNow.version})`, here.topDir === `store-edition-${variant}-${cfgNow.version}`, here.topDir);
    }
    const baseFiles = extractedFiles(path.join(baseline, "release", base.file));
    const basePaths = [...baseFiles.keys()].sort();
    const delta = {
      onlyHere: herePaths.filter((f) => !baseFiles.has(f)),
      onlyBase: basePaths.filter((f) => !hereFiles.has(f)),
      differing: herePaths.filter((f) => baseFiles.has(f) && Buffer.compare(hereFiles.get(f), baseFiles.get(f)) !== 0),
    };
    const moved = delta.onlyHere.length + delta.onlyBase.length + delta.differing.length;
    if (moved === 0) {
      ok(`${variant}: byte-identical to a pristine origin/develop build`, true);
    } else if (sharedChanges === null) {
      console.log(`  · ${variant}: differs from a pristine origin/develop build in ${moved} path(s) — could not read this branch's own diff (shallow clone?), so this is reported, not judged`);
      console.log("      " + JSON.stringify(delta));
    } else if (sharedChanges.length > 0) {
      pass++;
      console.log(`  ✓ ${variant}: differs from pristine origin/develop in ${moved} path(s), and this branch edited ${sharedChanges.length} file(s) the bundle is built from — expected`);
      console.log("      bundle: " + JSON.stringify(delta));
      console.log("      branch: " + JSON.stringify(sharedChanges));
    } else {
      ok(`${variant}: an UNEXPLAINED change to the education-only bundle — this branch touched nothing the bundle is built from, yet it moved`, false, delta);
    }
  }
  // A pristine origin/develop SEEKER bundle too, kept in a standalone dir (independent of the
  // worktree, which is about to be removed) so section (e) below can render both this tree's
  // header and the pristine one at the same viewport and compare .seeker-header's actual height —
  // the regression that matters here is a wallet-zone/logo change that pushes the header onto two
  // rows, and a byte diff alone can't tell you that; only a render can.
  let baselineSeekerDir = null;
  if (baseline) {
    try {
      const baseSeeker = buildVariant(baseline, "seeker");
      baselineSeekerDir = fs.mkdtempSync(path.join(os.tmpdir(), "seeker-baseline-render-"));
      execFileSync("tar", ["-xzf", path.join(baseline, "release", baseSeeker.file), "-C", baselineSeekerDir, "--strip-components=1"]);
    } catch (e) {
      console.log("  · could not build a pristine origin/develop seeker bundle for the header-height check — skipping it");
      console.log("    (" + ((e && e.message) || String(e)).split("\n")[0] + ")");
      baselineSeekerDir = null;
    }
  }
  if (baselineWt) { try { execFileSync("git", ["worktree", "remove", "--force", baselineWt], { cwd: ROOT, stdio: "pipe" }); } catch (_) {} }

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // (d) MWA-aware wallet layer — fake Capacitor.Plugins.CluckMWA bridge, driven in a vm sandbox
  // ══════════════════════════════════════════════════════════════════════════════════════════
  console.log("\n(d) MWA-aware wallet layer (fake bridge, no real device)\n");
  const walletSrc = fs.readFileSync(path.join(ROOT, "public", "cluck-wallet.js"), "utf8");

  function makeSandbox() {
    const sandbox = {};
    sandbox.console = { log() {}, warn() {}, error() {} };
    sandbox.navigator = { userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel Fold) AppleWebKit/537.36" };
    sandbox.location = { href: "https://localhost/", origin: "https://localhost" };
    const listeners = {};
    sandbox.addEventListener = (t, cb) => { (listeners[t] = listeners[t] || []).push(cb); };
    sandbox.removeEventListener = (t, cb) => { if (listeners[t]) listeners[t] = listeners[t].filter((x) => x !== cb); };
    sandbox.dispatchEvent = (ev) => { (listeners[ev.type] || []).forEach((cb) => cb(ev)); return true; };
    sandbox.CustomEvent = function (type, init) { this.type = type; this.detail = init && init.detail; };
    sandbox.TextEncoder = TextEncoder;
    sandbox.btoa = (s) => Buffer.from(s, "binary").toString("base64");
    sandbox.atob = (s) => Buffer.from(s, "base64").toString("binary");
    sandbox.setTimeout = setTimeout;
    sandbox.clearTimeout = clearTimeout;
    vm.createContext(sandbox);
    return sandbox;
  }

  // The real plugin returns the address as BASE64 of the 32 key bytes (CluckMWAPlugin.kt), so the
  // fake does too — the first cut returned base58 here and hid the bug the owner then hit on the
  // device ("5lrl…qeM=" shown as the connected wallet, pass sheet "could not reach the pass
  // service"). ADDR is what the app must SEE (base58); ADDR_B64 is what the bridge SENDS.
  const KEY_BYTES = Buffer.from(Array.from({ length: 32 }, (_, i) => (i * 29 + 3) % 256));
  const ADDR_B64 = KEY_BYTES.toString("base64");
  const ADDR = (() => { const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"; let n = 0n; for (const b of KEY_BYTES) n = n * 256n + BigInt(b); let o = ""; while (n > 0n) { o = A[Number(n % 58n)] + o; n /= 58n; } for (const b of KEY_BYTES) { if (b === 0) o = "1" + o; else break; } return o; })();
  const SIG = "5FakeSig1111111111111111111111111111111111111111111111111111111111111111";
  function fakeBridge(calls) {
    return {
      authorize: async (a) => { calls.push(["authorize", a]); return { address: ADDR_B64, authToken: "tok-1" }; },
      reauthorize: async (a) => { calls.push(["reauthorize", a]); return { address: ADDR_B64, authToken: "tok-1" }; },
      deauthorize: async (a) => { calls.push(["deauthorize", a]); return {}; },
      signTransactions: async (a) => { calls.push(["signTransactions", a]); return { signedTransactions: a.transactions }; },
      signAndSendTransactions: async (a) => { calls.push(["signAndSendTransactions", a]); return { signatures: [SIG] }; },
      signMessages: async (a) => { calls.push(["signMessages", a]); return { signedMessages: a.messages }; },
    };
  }

  {
    const sandbox = makeSandbox();
    const calls = [];
    sandbox.Capacitor = { isNativePlatform: () => true, getPlatform: () => "android", Plugins: { CluckMWA: fakeBridge(calls) } };
    vm.runInContext(walletSrc, sandbox, { filename: "cluck-wallet.js" });
    const list = sandbox.CluckWallet.available();
    ok("inside the Capacitor Android app with the bridge present, MWA is the (only) entry", list.length === 1 && list[0].id === "mwa" && !!list[0].mwa, JSON.stringify(list.map((w) => w.id)));

    const r = await sandbox.CluckWallet.connect("mwa");
    ok("connect() returns the address as BASE58 (the bridge sent base64) through the shared connect() surface", r && r.pubkey === ADDR && r.id === "mwa", JSON.stringify(r));
    ok("the base58 address has no base64 padding or symbols", typeof r.pubkey === "string" && !/[=+\/]/.test(r.pubkey) && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(r.pubkey), String(r && r.pubkey));
    ok("authorize() was the call made (not reauthorize, first connect)", calls.map((c) => c[0])[0] === "authorize");

    const entry = sandbox.CluckWallet.available()[0];
    const bytes = vm.runInContext("new Uint8Array([1,2,3,4,5])", sandbox);
    const signed = await entry.provider.signTransaction(bytes);
    ok("signTransaction round-trips bytes through the fake bridge (base64 in, base64 out)", JSON.stringify(Array.from(signed)) === JSON.stringify([1, 2, 3, 4, 5]));
    const sent = await entry.provider.signAndSendTransaction(bytes);
    ok("signAndSendTransaction returns the bridge's signature", sent.signature === SIG);
    const sig = await entry.provider.signMessage("hello");
    // ArrayBuffer.isView, not `instanceof Uint8Array` — the sandbox is a SEPARATE vm realm with
    // its own Uint8Array class, so a host-realm instanceof check on a value the sandbox built
    // would always (and wrongly) read false. ArrayBuffer.isView works cross-realm by spec.
    ok("signMessage returns signed bytes", ArrayBuffer.isView(sig.signature) && sig.signature.length === 5, JSON.stringify(Array.from(sig.signature || [])));
    const smCall = calls.find((c) => c[0] === "signMessages");
    ok("signMessages hands the bridge back ITS encoding of the address (base64), not the base58 the app shows", !!smCall && JSON.stringify(smCall[1].addresses) === JSON.stringify([ADDR_B64]), JSON.stringify(smCall && smCall[1].addresses));

    sandbox.CluckWallet.disconnect();
    ok("disconnect() calls the bridge's deauthorize and clears state", calls.some((c) => c[0] === "deauthorize") && sandbox.CluckWallet.available()[0].id === "mwa");

    // a SECOND connect after disconnect re-authorizes rather than reusing the old token
    calls.length = 0;
    await sandbox.CluckWallet.connect("mwa");
    ok("reconnecting after disconnect() calls authorize again (no stale token reused)", calls.map((c) => c[0])[0] === "authorize");
  }

  // No Capacitor at all (a plain web browser): falls back to the existing legacy detection,
  // completely unchanged — MWA never displaces it, never leaves an empty picker in its place.
  {
    const sandbox = makeSandbox();
    vm.runInContext(walletSrc, sandbox, { filename: "cluck-wallet.js" });
    sandbox.phantom = { solana: { isPhantom: true, connect: async () => ({ publicKey: { toString: () => "WEBADDR1111111111111111111111111111111111" } }) } };
    const list = sandbox.CluckWallet.available();
    ok("no Capacitor (plain web): falls back to the existing legacy/standard detection unchanged", list.length === 1 && list[0].id === "phantom", JSON.stringify(list.map((w) => w.id)));
  }

  // Capacitor present but NOT native (a Capacitor web build) or native but iOS: MWA never offered
  // (it is an Android-only protocol — CLAUDE.md), falls through the same as no Capacitor at all.
  {
    const sandbox = makeSandbox();
    sandbox.Capacitor = { isNativePlatform: () => false, getPlatform: () => "web", Plugins: {} };
    vm.runInContext(walletSrc, sandbox, { filename: "cluck-wallet.js" });
    ok("Capacitor present but not a native platform: MWA not offered", sandbox.CluckWallet.available().length === 0);

    const sandboxIOS = makeSandbox();
    const iosCalls = [];
    sandboxIOS.Capacitor = { isNativePlatform: () => true, getPlatform: () => "ios", Plugins: { CluckMWA: fakeBridge(iosCalls) } };
    vm.runInContext(walletSrc, sandboxIOS, { filename: "cluck-wallet.js" });
    ok("native iOS (even with a bridge object present): MWA not offered — it is Android-only", sandboxIOS.CluckWallet.available().length === 0);
  }

  // Android native but the plugin has not registered yet (increment 1 ships no native plugin) —
  // available() must return [], never throw, so the shell falls through to its own empty state.
  {
    const sandbox = makeSandbox();
    sandbox.Capacitor = { isNativePlatform: () => true, getPlatform: () => "android", Plugins: {} };
    vm.runInContext(walletSrc, sandbox, { filename: "cluck-wallet.js" });
    let threw = false, list = null;
    try { list = sandbox.CluckWallet.available(); } catch (e) { threw = true; }
    ok("Android native with no CluckMWA bridge yet: available() returns [] without throwing", !threw && Array.isArray(list) && list.length === 0);
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // (e) shell tap targets — static (always runs) + rendered (Chromium, skipped gracefully)
  // ══════════════════════════════════════════════════════════════════════════════════════════
  console.log("\n(e) shell tap targets (>=44px)\n");
  // v1.1.0: the wallet zone's rules live in src/seeker/edition/full.css (the FULL edition's own
  // sheet, so the Play/iOS bundle never carries a wallet control's CSS); both sheets are one
  // shell to a thumb, so both are read here.
  const css = ["seeker.css", path.join("edition", "full.css")]
    .map((f) => fs.readFileSync(path.join(ROOT, "src", "seeker", f), "utf8")).join("\n");
  function floorPx(selector, prop) {
    const block = new RegExp(selector.replace(/[.#]/g, "\\$&") + "\\s*\\{([^}]*)\\}").exec(css);
    if (!block) return null;
    const m = new RegExp(prop + ":\\s*(\\d+)px").exec(block[1]);
    return m ? Number(m[1]) : null;
  }
  for (const [selector, label] of [[".seeker-navbtn", "bottom nav tab"], [".seeker-walletbtn", "wallet connect/disconnect button"]]) {
    const h = floorPx(selector, "min-height"), w = floorPx(selector, "min-width");
    ok(`${label} (${selector}) declares min-height >= 44px`, h !== null && h >= 44, `min-height:${h}px`);
    ok(`${label} (${selector}) declares min-width >= 44px`, w !== null && w >= 44, `min-width:${w}px`);
  }

  console.log("\n  (rendered check, Chromium)\n");
  const pw = resolvePlaywright();
  if (!pw) {
    console.log("  · playwright(-core) not resolvable — skipping the rendered check (everything above still ran)");
  } else {
    await renderedCheck(pw, baselineSeekerDir);
  }
  if (baselineSeekerDir) { try { fs.rmSync(baselineSeekerDir, { recursive: true, force: true }); } catch (_) {} }

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // (e-edu) the EDUCATION edition's rendered nav — owner (Xcode review, 2026-09-24): "wallet and
  // listing probably don't deserve their own tabs, we have a whole school, lp lab, ask cluck,
  // solana room, daily stuff." Rendered against the GOOGLE variant built in section (c) above
  // (google and ios share the same src/seeker/edition/edu.jsx, so one render stands for both —
  // ios itself is checked bundle-side in (c)). Pins:
  //   · exactly five tabs, in order: School, LP Lab, Ask, Solana, Daily;
  //   · every tab icon is a real SVG (a drawn icon component), never emoji TEXT — the whole point
  //     of the icon files this PR added;
  //   · /checkup and /tools/listing still render (routes kept even though their tabs are gone —
  //     the school home's Safety tools card and any stray deep link still work);
  //   · the LP Lab tab reads active while inside the course AND one of its lessons.
  console.log("\n(e-edu) education edition — rendered nav (Chromium)\n");
  if (!pw) {
    console.log("  · playwright(-core) not resolvable — skipping (everything above still ran)");
  } else if (!googleTgz) {
    ok("education edition rendered nav — google bundle was built (section c)", false, "googleTgz not set");
  } else {
    await renderedEduCheck(pw, googleTgz);
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // (e2) ONE tools-pass gate, not one per tool
  // ══════════════════════════════════════════════════════════════════════════════════════════
  // The gate shipped as three byte-identical 79-line copies (WalletXray/Holders/Trace) that
  // differed by a single sentence, each carrying a note saying "if this drifts, extract it".
  // It was extracted to src/seeker/passgate.jsx before it drifted — and this is what keeps it
  // extracted, because the next tool that needs a gate will be written by copying a pane that
  // already has one. It is a SIGNING path: CLAUDE.md's rule about private copies of shared
  // browser modules exists because copies of exactly this kind drifted into real bugs.
  //
  // Asserted on the SOURCE, because that is where a second copy would appear; the bundle-level
  // half (the gate is really enforced at runtime) is section F of seeker-app-boot-test.cjs.
  // Source scanning and rendered measurement have complementary blind spots — run both.
  console.log("\n(e2) one tools-pass gate for the whole app\n");
  {
    const gateFile = path.join(ROOT, "src", "seeker", "passgate.jsx");
    ok("the gate lives in src/seeker/passgate.jsx", fs.existsSync(gateFile));
    const panes = fs.readdirSync(path.join(ROOT, "src", "seeker", "tools")).filter((f) => f.endsWith(".jsx"));
    const redefiners = panes.filter((f) => {
      const t = fs.readFileSync(path.join(ROOT, "src", "seeker", "tools", f), "utf8");
      // Any form of a second definition — `function PassGate(`, `const PassGate =`, and the two
      // helpers it owns. Checking one spelling is how the esc() migration missed six copies.
      return /(^|\n)\s*(export\s+)?(async\s+)?function\s+(PassGate|gatedToolFetch|passGateWindow)\s*\(/.test(t) ||
             /(^|\n)\s*(export\s+)?(const|let|var)\s+(PassGate|gatedToolFetch|passGateWindow)\s*=/.test(t);
    });
    ok("no pane defines its own PassGate / gatedToolFetch / passGateWindow", redefiners.length === 0, redefiners.join(", "));
    const users = panes.filter((f) => /<PassGate[\s>]/.test(fs.readFileSync(path.join(ROOT, "src", "seeker", "tools", f), "utf8")));
    ok("the panes that gate do import it from there", users.length > 0 && users.every((f) =>
      /from "\.\.\/passgate\.jsx"/.test(fs.readFileSync(path.join(ROOT, "src", "seeker", "tools", f), "utf8"))), users.join(", "));
    // Every gating pane must name a tool the sheet has a sentence for — a typo'd id would
    // silently fall back to the generic line, which reads fine and says less than it should.
    const gate = fs.readFileSync(gateFile, "utf8");
    const known = new Set([...gate.matchAll(/^\s{2}([a-z]+):\s*"/gm)].map((m) => m[1]));
    const unknown = [];
    for (const f of users) {
      const t = fs.readFileSync(path.join(ROOT, "src", "seeker", "tools", f), "utf8");
      for (const m of t.matchAll(/<PassGate[^>]*\btool="([^"]+)"/g)) if (!known.has(m[1])) unknown.push(`${f}:${m[1]}`);
    }
    ok("every gating pane names a tool the sheet has a sentence for", unknown.length === 0, unknown.join(", "));

    // ── and ONE signing seam, for the same reason ──────────────────────────────────────────
    // src/seeker/sign.js carries four protections, and the first of them — checking `err` before
    // `confirmationStatus` — shipped WRONG in two copy-pasted places at once and was found by two
    // independent reviewers on the same day. Five panes now sign; none of them may grow a sixth
    // copy. Asserted as: no pane and no other app file calls getSignatureStatuses or
    // sendTransaction directly, and nothing re-declares the seam's exported names.
    //
    // public/airdrop-engine.js is deliberately NOT in scope: it is the platform's shared engine,
    // loaded by the live website and the store bundles as well as this app, and it carries its
    // own hardened copy with the same fix and the same comment. Rewriting a live money path to
    // import an app-local ESM module is not a change to slip into an app build.
    const appFiles = [];
    (function walk(dir) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const fp = path.join(dir, e.name);
        if (e.isDirectory()) walk(fp);
        // Two files may talk to the chain directly, and only these two:
        //   sign.js        — the seam itself.
        //   reclaim-sign.js — Rent Reclaim signs MANY batches in ONE wallet prompt
        //                     (signAllTransactions), a genuinely different shape from the seam's
        //                     one-transaction flow. It is exempt from the raw-RPC rule and NOT
        //                     from the rest: the assertion below pins that it imports the seam's
        //                     protections instead of keeping the copies it used to define.
        else if (/\.(jsx?|mjs)$/.test(e.name)
                 && fp !== path.join(ROOT, "src", "seeker", "sign.js")
                 && fp !== path.join(ROOT, "src", "seeker", "reclaim-sign.js")) appFiles.push(fp);
      }
    })(path.join(ROOT, "src", "seeker"));
    const raw = [], redeclared = [];
    for (const fp of appFiles) {
      const t = fs.readFileSync(fp, "utf8")
        // Comments name these on purpose — they are the record of why the seam exists.
        .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      const rel = path.relative(ROOT, fp);
      if (/["'`]getSignatureStatuses["'`]|["'`]sendTransaction["'`]/.test(t)) raw.push(rel);
      if (/(^|\n)\s*(export\s+)?(async\s+)?function\s+(confirmSignature|isUserRejection|signSendConfirm|assertSameAccount)\s*\(/.test(t) ||
          /(^|\n)\s*(export\s+)?(const|let|var)\s+(confirmSignature|isUserRejection|signSendConfirm|assertSameAccount)\s*=/.test(t)) redeclared.push(rel);
    }
    ok("only the seam (and Rent Reclaim's batch path) talks to getSignatureStatuses / sendTransaction", raw.length === 0, raw.join(", "));
    {
      // The exemption is for the RPC call, not for the protections. reclaim-sign.js used to
      // DEFINE confirmSignature and isUserRejection — that is where one half of the P0 lived.
      const rs = fs.readFileSync(path.join(ROOT, "src", "seeker", "reclaim-sign.js"), "utf8");
      ok("reclaim-sign.js gets its protections FROM the seam, not from copies of its own",
         /from "\.\/sign\.js"/.test(rs) && !/^\s*export async function confirmSignature\(/m.test(rs)
           && !/^\s*export function isUserRejection\(/m.test(rs),
         "reclaim-sign.js still defines its own confirmSignature/isUserRejection");
      ok("and its batch path still diffs the wallet's returned message bytes",
         /if \(!sameBytes\(messageBytes\(txs\[i\]\), messageBytes\(realTx\)\)\)/.test(rs));
    }
    ok("no file re-declares confirmSignature / isUserRejection / signSendConfirm / assertSameAccount", redeclared.length === 0, redeclared.join(", "));
    // The ordering itself, positively: a negative regex would pass against the broken code.
    {
      const seam = fs.readFileSync(path.join(ROOT, "src", "seeker", "sign.js"), "utf8");
      const iErr = seam.indexOf("if (st && st.err) throw new Error");
      const iStatus = seam.indexOf('if (st && (st.confirmationStatus === "confirmed"');
      ok("⚠️ sign.js checks st.err BEFORE st.confirmationStatus — the P0 that shipped twice",
         iErr > 0 && iStatus > iErr, `err@${iErr} status@${iStatus}`);
      ok("and an RPC read failure keeps polling rather than reporting a failure that did not happen",
         /catch \(_\) \{\s*\n(\s*\/\/.*\n)*\s*continue;/.test(seam));
      ok("sign.js re-reads the LIVE public key before anything is built for signing",
         /export function assertSameAccount\(/.test(seam) && /live !== expected/.test(seam));
      ok("and diffs the wallet's returned message bytes against what it built",
         /if \(!sameBytes\(messageBytes\(tx\), messageBytes\(realTx\)\)\)/.test(seam));
    }
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // (f) i18n
  // ══════════════════════════════════════════════════════════════════════════════════════════
  console.log(`\n(f) i18n — every one of the app's ${SEEKER_KEYS.length} strings, in all six dictionaries\n`);
  const NEW_KEYS = SEEKER_KEYS;
  // ⚠️ The school ships in SEVEN languages (AGENTS.md) and this app is part of it. An English-only
  // app beside a seven-language school is not a smaller version of the same product — it is a
  // different one for everybody who does not read English. Asserted against the GENERATED key
  // list, so a new pane's copy fails here until it is translated, instead of shipping in English
  // and being noticed by a user.
  for (const lang of ["es", "zh", "hi", "it", "pt", "vi"]) {
    const dict = JSON.parse(fs.readFileSync(path.join(ROOT, "public", "i18n", `${lang}.json`), "utf8"));
    const missing = NEW_KEYS.filter((k) => !Object.prototype.hasOwnProperty.call(dict, k));
    ok(`${lang}.json carries all ${NEW_KEYS.length} of the app's strings`, missing.length === 0,
       `${missing.length} missing, e.g. ${JSON.stringify(missing.slice(0, 3))} — run: node scripts/seeker-i18n-keys.cjs --missing ${lang}`);
  }
  // ⚠️ public/i18n/en.json MUST NOT EXIST. English is the key text; an en.json would make every
  // key look translated and silently disarm the six checks above. Two builders proposed creating
  // one on the same day, independently, which is why it is asserted rather than remembered.
  ok("public/i18n/en.json does not exist (English IS the key text)",
     !fs.existsSync(path.join(ROOT, "public", "i18n", "en.json")));
  // the SAME 8 keys must NOT reach the google/ios bundle (excludeKeys prune) — the pristine
  // baseline comparison above already proves this at the byte level when it can run; this checks
  // it directly too, so the assertion still means something even when that comparison is skipped.
  {
    const seekerCfg = JSON.parse(fs.readFileSync(path.join(ROOT, "store-edition", "store-edition.json"), "utf8"));
    const ex = new Set(seekerCfg.excludeKeys || []);
    // The store bundles are a PINNED, EDUCATION-ONLY edition: no wallet, no payments, no address
    // (docs/STORE_EDITION.md). Since v1.1.0 that bundle IS this shell's education edition, so the
    // dictionaries it ships must carry the education edition's keys and must NOT carry the keys
    // only a wallet pane renders. Both directions, by name.
    const missing = WALLET_ONLY_KEYS.filter((k) => !ex.has(k));
    ok(`store-edition.json excludes every WALLET-ONLY key from the google/ios dictionary copy (${WALLET_ONLY_KEYS.length} of ${NEW_KEYS.length})`,
       missing.length === 0, `${missing.length} not excluded — run: node scripts/seeker-i18n-keys.cjs --sync-exclude`);
    const wrongly = [...EDU_KEYS].filter((k) => ex.has(k));
    ok(`store-edition.json does NOT exclude any education-edition key (${EDU_KEYS.size} keys the Play/iOS shell renders)`,
       wrongly.length === 0, wrongly.slice(0, 5));
  }
  try {
    execFileSync(process.execPath, [path.join(ROOT, "scripts", "i18n-audit.cjs")], { cwd: ROOT, stdio: "pipe" });
    ok("node scripts/i18n-audit.cjs exits 0 (no gating findings)", true);
  } catch (e) {
    ok("node scripts/i18n-audit.cjs exits 0 (no gating findings)", false, (e && e.stdout && e.stdout.toString().slice(-2000)) || String(e));
  }

  console.log(fail ? `\n${fail} FAILED (${pass} passed)` : `\nall passed (${pass} passed)`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("FAILED:", (e && e.stack) || e); process.exit(1); });

function resolvePlaywright() {
  const candidates = [
    "playwright",
    "playwright-core",
    path.join(__dirname, "..", "node_modules", "playwright"),
    path.join(__dirname, "..", "node_modules", "playwright-core"),
    "/home/user/cluck-norris-school/node_modules/playwright",
    "/home/user/cluck-norris-school/node_modules/playwright-core",
  ];
  for (const c of candidates) { try { return require(c); } catch (_) {} }
  return null;
}

async function renderedCheck(pw, baselineSeekerDir) {
  const http = require("http");
  const extractDir = fs.mkdtempSync(path.join(os.tmpdir(), "seeker-render-"));
  const tgz = path.join(ROOT, "release", `store-edition-seeker-${JSON.parse(fs.readFileSync(path.join(ROOT, "store-edition", "seeker-edition.json"), "utf8")).version}.tgz`);
  execFileSync("tar", ["-xzf", tgz, "-C", extractDir, "--strip-components=1"]);
  const mime = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split("?")[0]);
    if (p === "/") p = "/index.html";
    const fp = path.join(extractDir, p);
    if (!fp.startsWith(extractDir) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "Content-Type": mime[path.extname(fp)] || "application/octet-stream" });
    fs.createReadStream(fp).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const findChromium = () => {
    const c = [process.env.PLAYWRIGHT_CHROMIUM_PATH, "/opt/pw-browsers/chromium"].filter(Boolean);
    for (const p of c) if (fs.existsSync(p)) return p;
    return undefined;
  };
  const browser = await pw.chromium.launch({ executablePath: findChromium(), args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.addInitScript(() => {
      window.__mwaCalls = [];
      window.Capacitor = {
        isNativePlatform: () => true,
        getPlatform: () => "android",
        Plugins: {
          CluckMWA: {
            authorize: async (a) => { window.__mwaCalls.push(["authorize", a]); return { address: "HYyhgbGvBjQoGvP85fKeBh4N8+pFghiNlZ//5dVq6R8=", authToken: "tok" }; },  // base64, like the real plugin
            deauthorize: async () => { window.__mwaCalls.push(["deauthorize"]); return {}; },
            signTransactions: async (a) => ({ signedTransactions: a.transactions }),
            signAndSendTransactions: async () => ({ signatures: ["5Sig"] }),
            signMessages: async (a) => ({ signedMessages: a.messages }),
          },
        },
      };
    });
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle", timeout: 20000 });
    await page.waitForFunction(() => !!(window.CluckWallet && document.querySelector(".seeker-nav")), null, { timeout: 15000 });

    // ⚠️ THE SCHOOL IS THE FRONT DOOR. This assertion previously pinned #/tools, and pinning it
    // is how the app shipped with no school in it at all: the build scope doc listed fifteen
    // TOOLS, the toolkit became the whole app, and the test agreed with it. The owner found that
    // on his Seeker ("where is the whole school? that is the whole major part of the app").
    // AGENTS.md now records the flagship list, school first. Do not move this back to #/tools
    // without an owner decision that says so.
    ok("rendered: default route redirects to #/school (the school leads, AGENTS.md flagships)",
       (await page.evaluate(() => location.hash)) === "#/school");
    const navCount = await page.locator(".seeker-navbtn").count();
    ok("rendered: five bottom-nav tabs, School first", navCount === 5, navCount);
    const firstTab = await page.locator(".seeker-navbtn").first().getAttribute("href");
    ok("rendered: the FIRST nav tab is the school", /#\/school$/.test(String(firstTab)), firstTab);
    const boxes = await page.locator(".seeker-navbtn").evaluateAll((els) => els.map((e) => e.getBoundingClientRect()));
    ok("rendered: every nav tab is actually >=44x44 on screen", boxes.every((b) => b.width >= 44 && b.height >= 44), JSON.stringify(boxes));
    const walletBox = await page.locator(".seeker-walletbtn").boundingBox();
    ok("rendered: the wallet button is actually >=44x44 on screen", !!walletBox && walletBox.width >= 44 && walletBox.height >= 44, JSON.stringify(walletBox));

    // Nav labels are now short single words (Toolkit/Rent/Ask/Checkup, App.jsx's TABS) rather than
    // full tool names — click by the tab's own hash href, which is stable regardless of label text.
    await page.locator('.seeker-navbtn[href="#/ask"]').click();
    await page.waitForTimeout(150);
    ok("rendered: tapping a nav tab changes the hash (client-side route, no reload)", (await page.evaluate(() => location.hash)) === "#/ask");
    // Ask Cluck is real content as of increment 3 (AskCluck.jsx), not the placeholder <Pane> —
    // its own title class, not the shared .seeker-pane the other still-placeholder tab uses.
    ok("rendered: the Ask Cluck pane is now showing", /Ask Cluck/.test(await page.locator(".seeker-ask-title").innerText()));
    const starterBox = await page.locator(".seeker-ask-starter").first().boundingBox();
    ok("rendered: an Ask Cluck starter prompt is actually >=44px tall on screen", !!starterBox && starterBox.height >= 44, JSON.stringify(starterBox));

    await page.locator(".seeker-walletbtn").click();
    // Generous timeout: this runs after two vite builds + a dozen vm-sandbox checks earlier in
    // the same process, so the host can be under real load by the time Chromium gets here.
    const gotDisconnect = await page.waitForFunction(() => /disconnect/i.test(document.querySelector(".seeker-walletbtn").textContent), null, { timeout: 15000 }).then(() => true).catch(() => false);
    // .innerText() reflects the button's CSS `text-transform: uppercase`, unlike the raw
    // .textContent the waitForFunction above reads — case-insensitive here too, same button.
    const btnText = await page.locator(".seeker-walletbtn").innerText();
    const errCount = await page.locator(".seeker-walleterr").count();
    const errText = errCount ? await page.locator(".seeker-walleterr").innerText() : null;
    ok("rendered: tapping Connect Wallet runs a real MWA authorize() through the fake bridge and shows Disconnect",
      gotDisconnect && /disconnect/i.test(btnText), `btnText=${JSON.stringify(btnText)} err=${JSON.stringify(errText)}`);
    const calls = await page.evaluate(() => window.__mwaCalls.map((c) => c[0]));
    ok("rendered: the authorize call actually reached the fake Capacitor bridge", calls.includes("authorize"), JSON.stringify(calls));

    // ── the 🌐 pill never covers content, 360x800 (the size the real device screenshots that
    // found this bug were taken at) ─────────────────────────────────────────────────────────
    // The pill (#clkn-lang-toggle, public/i18n.js) is `position:fixed`, so it sits in the same
    // screen band on every pane regardless of scroll position — a bug here is never "the page is
    // too short", it's a card that happens to land in that band on first paint. Found in real
    // Seeker-edition screenshots: the school home's progress-card note ("Progress here stays on
    // this phone…") and the checkup pane's risky-holding line ("supply can be inf…") were both
    // hidden under it. The fix is the data-clkn-avoid / data-clkn-avoid-kids markers those two
    // elements were missing (School.jsx, WalletCheckup.jsx) — clkn-dock-float.js already lifts
    // the pill off anything so marked; it just never knew these existed.
    console.log("\n  (🌐 pill collision, 360x800)\n");
    const pillPage = await browser.newPage({ viewport: { width: 360, height: 800 } });
    await pillPage.addInitScript(() => {
      window.Capacitor = {
        isNativePlatform: () => true,
        getPlatform: () => "android",
        Plugins: {
          CluckMWA: {
            authorize: async () => ({ address: "HYyhgbGvBjQoGvP85fKeBh4N8+pFghiNlZ//5dVq6R8=", authToken: "tok" }),
            deauthorize: async () => ({}),
            signTransactions: async (a) => ({ signedTransactions: a.transactions }),
            signAndSendTransactions: async () => ({ signatures: ["5Sig"] }),
            signMessages: async (a) => ({ signedMessages: a.messages }),
          },
        },
      };
    });
    // The checkup pane fetches GET /api/wallet-checkup — this static-file server (see above) has
    // no such route, so it is stubbed with a fixture carrying a risky holding whose issue text
    // reproduces the real report ("supply can be inf…" truncated by the card's own width, not by
    // this fixture — the point is that SOME issue text renders low enough on a 360px-wide card to
    // reach the pill's band).
    await pillPage.route("**/api/wallet-checkup*", (route) => route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({
        success: true, scanned: 1, tokensHeld: 1, capped: false, atRiskUsd: 12.34,
        approvals: [],
        riskyHoldings: [{
          mint: "RiskyMint11111111111111111111111111111111", symbol: "RUG", amount: 1000, valueUsd: 12.34, severity: 2,
          issues: ["Mint authority is still active — supply can be inflated at any time by the token's creator."],
        }],
      }),
    }));
    await pillPage.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle", timeout: 20000 });
    await pillPage.waitForFunction(() => !!(window.CluckWallet && document.getElementById("clkn-lang-toggle")), null, { timeout: 15000 });

    function overlaps(a, b) {
      if (!a || !b) return false;
      return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    }

    // School home is the default route.
    await pillPage.waitForSelector(".seeker-school-overall", { timeout: 15000 });
    const pillBoxSchool = await pillPage.locator("#clkn-lang-toggle").boundingBox();
    const progressBox = await pillPage.locator(".seeker-school-overall").boundingBox();
    ok("rendered: the 🌐 pill does not cover the school home's progress card (360x800)",
       !overlaps(pillBoxSchool, progressBox), `pill=${JSON.stringify(pillBoxSchool)} progress=${JSON.stringify(progressBox)}`);
    // The header logo (2026-09-24) pushed everything below it further down the page, including
    // the hero title and lede — re-check that whole band, not only the progress card underneath
    // it. (Marking only the lede once let the pill lift clean past the unmarked title next to it
    // and land there instead — both need their own check, not just their own marker.)
    const heroTitleBox = await pillPage.locator(".seeker-school >> h1.seeker-school-title").boundingBox();
    ok("rendered: the 🌐 pill does not cover the school home's hero title (360x800)",
       !overlaps(pillBoxSchool, heroTitleBox), `pill=${JSON.stringify(pillBoxSchool)} title=${JSON.stringify(heroTitleBox)}`);
    const heroLedeBox = await pillPage.locator(".seeker-school >> p.seeker-tool-lede").boundingBox();
    ok("rendered: the 🌐 pill does not cover the school home's hero lede (360x800)",
       !overlaps(pillBoxSchool, heroLedeBox), `pill=${JSON.stringify(pillBoxSchool)} lede=${JSON.stringify(heroLedeBox)}`);

    // ── the header stays ONE row at 360px, unchanged from a pristine origin/develop build ──────
    // Adding the header logo narrowed the brand's own share of the row; if the wallet zone (status
    // + button) can't shrink to fit what's left, the header wraps onto two rows and roughly
    // doubles in height — exactly the class of bug a byte diff in section (c) can't see. Compared
    // against a pristine origin/develop render at the same viewport, not a hardcoded pixel count,
    // so this doesn't need updating every time the header's own padding or font size changes for
    // an unrelated reason.
    const hereHeaderHeight = (await pillPage.locator(".seeker-header").boundingBox()).height;
    if (baselineSeekerDir) {
      const http2 = require("http");
      const mime2 = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };
      const baseServer = http2.createServer((req, res) => {
        let p = decodeURIComponent(req.url.split("?")[0]);
        if (p === "/") p = "/index.html";
        const fp = path.join(baselineSeekerDir, p);
        if (!fp.startsWith(baselineSeekerDir) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { "Content-Type": mime2[path.extname(fp)] || "application/octet-stream" });
        fs.createReadStream(fp).pipe(res);
      });
      await new Promise((resolve) => baseServer.listen(0, "127.0.0.1", resolve));
      const basePort = baseServer.address().port;
      const basePage = await browser.newPage({ viewport: { width: 360, height: 800 } });
      try {
        await basePage.goto(`http://127.0.0.1:${basePort}/`, { waitUntil: "networkidle", timeout: 20000 });
        await basePage.waitForSelector(".seeker-header", { timeout: 15000 });
        const baseHeaderHeight = (await basePage.locator(".seeker-header").boundingBox()).height;
        ok("rendered: .seeker-header's height at 360px is unchanged from a pristine origin/develop build (still one row)",
           Math.abs(hereHeaderHeight - baseHeaderHeight) <= 1,
           `here=${hereHeaderHeight}px base=${baseHeaderHeight}px`);
      } finally {
        await basePage.close();
        await new Promise((resolve) => baseServer.close(resolve));
      }
    } else {
      console.log("  · no pristine origin/develop seeker bundle available — reporting this tree's header height only: " + hereHeaderHeight + "px");
    }

    // ── quiz auto-scroll, in the APP (owner 2026-09-24, first asked for on the iOS edition) ──
    // #434 shipped a helper that scrolled `.seeker-main`, but the document is what scrolls in this
    // shell (`.seeker-shell` is min-height, not height), so answering left Next ~200px under the
    // bottom nav with no scroll at all. This answers a real question at 360x800 and requires the
    // Next button to land between the sticky header and the fixed nav, then requires the next
    // question's heading to land just under the header. Works whether the lesson opens as the
    // single page or the lesson stepper (the quiz button is on the stepper's last step).
    await pillPage.goto(`http://127.0.0.1:${port}/#/school/lp/8`, { waitUntil: "networkidle", timeout: 20000 });
    await pillPage.waitForSelector(".seeker-school-title, .seeker-step", { timeout: 15000 });
    if (await pillPage.locator(".seeker-step").count()) {
      await pillPage.locator(".seeker-step-seg").last().click();
      await pillPage.waitForTimeout(300);
      await pillPage.locator(".seeker-step-next").click();
    } else {
      await pillPage.locator(".seeker-school-start").click();
    }
    await pillPage.waitForSelector(".seeker-school-option", { timeout: 15000 });
    await pillPage.waitForTimeout(400);
    await pillPage.locator(".seeker-school-option").first().click();
    await pillPage.waitForTimeout(1100);
    const quizGeom = await pillPage.evaluate(() => {
      const next = document.querySelector(".seeker-school-explain .seeker-btn");
      const head = document.querySelector(".seeker-header").getBoundingClientRect().bottom;
      const navTop = document.querySelector(".seeker-nav").getBoundingClientRect().top;
      const r = next ? next.getBoundingClientRect() : null;
      return { top: r && r.top, bottom: r && r.bottom, head, navTop, scrollY: window.scrollY };
    });
    ok("rendered: after answering a quiz question in the app, Next is fully between the header and the bottom nav (360x800)",
       quizGeom.top != null && quizGeom.top >= quizGeom.head - 1 && quizGeom.bottom <= quizGeom.navTop + 1, quizGeom);
    await pillPage.locator(".seeker-school-explain .seeker-btn").click();
    await pillPage.waitForTimeout(1100);
    const headGeom = await pillPage.evaluate(() => {
      const q = document.querySelector(".seeker-school-quizhead").getBoundingClientRect().top;
      const head = document.querySelector(".seeker-header").getBoundingClientRect().bottom;
      return { q, head, scrollY: window.scrollY };
    });
    // Either the heading was scrolled to just under the header, or the page is already at its top
    // (a short question that fits on one screen has nothing to scroll, and sits under the pane's
    // own top padding) — both put the question where the eye starts. Behind the header is the fail.
    ok("rendered: Next brings the next question's heading under the app header, or the page is already at its top (360x800)",
       headGeom.q >= headGeom.head - 1 && (headGeom.q <= headGeom.head + 40 || headGeom.scrollY === 0), headGeom);

    // Connect the wallet (same fake MWA bridge), then open the checkup pane.
    await pillPage.locator(".seeker-walletbtn").click();
    await pillPage.waitForFunction(() => /disconnect/i.test(document.querySelector(".seeker-walletbtn").textContent), null, { timeout: 15000 }).catch(() => {});
    await pillPage.locator('.seeker-navbtn[href="#/checkup"]').click();
    await pillPage.waitForSelector(".seeker-checkup-issue", { timeout: 15000 });
    const pillBoxCheckup = await pillPage.locator("#clkn-lang-toggle").boundingBox();
    const issueBoxes = await pillPage.locator(".seeker-checkup-issue").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()));
    const issueOverlap = issueBoxes.some((b) => overlaps(pillBoxCheckup, b));
    ok("rendered: the 🌐 pill does not cover a risky-holding issue line on Wallet Checkup (360x800)",
       !issueOverlap, `pill=${JSON.stringify(pillBoxCheckup)} issues=${JSON.stringify(issueBoxes)}`);

    // ── the Solana Room, offline, 360x800 — the full drift/i18n gate lives in
    // scripts/seeker-solana-room-test.cjs; this is just the smoke check that /solana and
    // /solana/rent actually mount and render a real heading in the built bundle. ────────────────
    await pillPage.goto(`http://127.0.0.1:${port}/#/solana`, { waitUntil: "networkidle", timeout: 20000 });
    await pillPage.waitForSelector(".seeker-solana h1", { timeout: 15000 });
    const roomH1 = await pillPage.locator(".seeker-solana h1").innerText();
    ok("rendered: /solana shows the Solana Room heading (360x800)", /Solana Room/i.test(roomH1), roomH1);
    await pillPage.close();

    // ⚠️ The bug this pins (found on the Solana Room index at 360x800, #431 follow-up): a whole
    // tall multi-topic card marked as one data-clkn-avoid-kids child made clkn-dock-float.js
    // climb to clear the CARD's own top instead of the nearest row, lifting #clkn-lang-toggle to
    // `top: -38px` — fully off the top of the viewport. Each check opens a FRESH page and
    // navigates straight to the deep link, the same way the real device screenshots that found
    // this bug were taken (a hash-only route change inside one already-open page never re-runs
    // clkn-dock-float.js's fit(), so reusing one page across routes would just keep re-measuring
    // the FIRST route's stale position). Checks both halves of the fix: the pill stays fully
    // on-screen, and where a real gap exists, it doesn't land on top of anything marked to avoid.
    async function assertPillClear(hashPath, headingRe, expectClear) {
      const p2 = await browser.newPage({ viewport: { width: 360, height: 800 } });
      await p2.goto(`http://127.0.0.1:${port}/#${hashPath}`, { waitUntil: "networkidle", timeout: 20000 });
      await p2.waitForSelector(".seeker-solana h1", { timeout: 15000 });
      if (headingRe) ok(`rendered: ${hashPath} shows its own heading (360x800)`, headingRe.test(await p2.locator(".seeker-solana h1").innerText()));
      await p2.waitForTimeout(2700); // let both delayed fit() passes (800ms, 2500ms) settle
      const result = await p2.evaluate(() => {
        const pill = document.getElementById("clkn-lang-toggle");
        if (!pill) return null;
        const p = pill.getBoundingClientRect();
        const avoidEls = document.querySelectorAll("[data-clkn-avoid],[data-clkn-avoid-kids] > *");
        let hit = null;
        for (const e of avoidEls) {
          if (pill.contains(e)) continue;
          const r = e.getBoundingClientRect();
          if (!r.width || !r.height) continue;
          const ox = Math.min(p.right, r.right) - Math.max(p.left, r.left);
          const oy = Math.min(p.bottom, r.bottom) - Math.max(p.top, r.top);
          if (ox > 0 && oy > 0) { hit = r.toJSON(); break; }
        }
        return { pill: p.toJSON(), hit, vw: window.innerWidth, vh: window.innerHeight };
      });
      await p2.close();
      const inViewport = !!result && result.pill.top >= 0 && result.pill.left >= 0 &&
        result.pill.bottom <= result.vh && result.pill.right <= result.vw;
      ok(`rendered: the 🌐 pill stays fully inside the viewport on ${hashPath} (360x800)`,
         inViewport, JSON.stringify(result));
      if (expectClear) {
        ok(`rendered: the 🌐 pill doesn't overlap a data-clkn-avoid element on ${hashPath} (360x800)`,
           !!result && !result.hit, JSON.stringify(result));
      } else {
        // The Room INDEX's own topic rows butt directly against each other (solana.css gives
        // .seeker-solana-topic a border-top, not a margin) — there is no gap on this page taller
        // than the pill anywhere in the first ~800px of layout, on the website or in the app, so
        // clkn-dock-float.js's climb-and-clear loop can never find a truly clean spot here and the
        // documented fallback (its own hard floor) rests at the default position instead of
        // flying off — which is the actual bug this pins. That default CAN still land on a topic
        // row's own text on this one densely-packed page; the invariant that must hold everywhere,
        // and does, is staying on-screen (checked above), not zero overlap on a page with no gap
        // to give it.
        console.log(`  · ${hashPath}: not asserting zero-overlap — this page has no gap taller than the pill (see comment); reported for visibility: hit=${JSON.stringify(result && result.hit)}`);
      }
    }
    await assertPillClear("/solana", /Solana Room/i, false);
    await assertPillClear("/solana/rent", /deposit/i, true);
    // /solana/seeker/skr — the Seeker-edition-only wing page (SeekerWing.jsx), never reachable in
    // the education edition. This build is the seeker tarball, so the route exists.
    await assertPillClear("/solana/seeker/skr", null, true);
  } finally {
    await browser.close();
    server.close();
    fs.rmSync(extractDir, { recursive: true, force: true });
  }
}

// Section (e-edu): the education edition (google/ios — same src/seeker/edition/edu.jsx, so one
// render stands for both) at 360x800, the phone size the real device screenshots this PR's owner
// review was based on used elsewhere in this file.
async function renderedEduCheck(pw, tgz) {
  const http = require("http");
  const extractDir = fs.mkdtempSync(path.join(os.tmpdir(), "seeker-edu-render-"));
  execFileSync("tar", ["-xzf", tgz, "-C", extractDir, "--strip-components=1"]);
  const mime = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split("?")[0]);
    if (p === "/") p = "/index.html";
    const fp = path.join(extractDir, p);
    if (!fp.startsWith(extractDir) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "Content-Type": mime[path.extname(fp)] || "application/octet-stream" });
    fs.createReadStream(fp).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const findChromium = () => {
    const c = [process.env.PLAYWRIGHT_CHROMIUM_PATH, "/opt/pw-browsers/chromium"].filter(Boolean);
    for (const p of c) if (fs.existsSync(p)) return p;
    return undefined;
  };
  const browser = await pw.chromium.launch({ executablePath: findChromium(), args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage({ viewport: { width: 360, height: 800 } });
    // The checkup pane fetches GET /api/wallet-checkup — no backend behind this static server, so
    // it's stubbed (same shape as the seeker render's fixture above) purely so the pane mounts
    // cleanly rather than sitting on a load spinner while we check the nav around it.
    await page.route("**/api/wallet-checkup*", (route) => route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ success: true, scanned: 0, tokensHeld: 0, capped: false, atRiskUsd: 0, approvals: [], riskyHoldings: [] }),
    }));
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle", timeout: 20000 });
    await page.waitForSelector(".seeker-nav", { timeout: 15000 });

    ok("rendered (edu): default route redirects to #/school (the school leads)",
       (await page.evaluate(() => location.hash)) === "#/school");

    const labels = await page.locator(".seeker-navbtn .seeker-navlabel").allInnerTexts();
    ok("rendered (edu): exactly five bottom-nav tabs, in order — School, LP Lab, Ask, Solana, Daily",
       JSON.stringify(labels) === JSON.stringify(["School", "LP Lab", "Ask", "Solana", "Daily"]),
       JSON.stringify(labels));

    // Every tab icon is a drawn SVG, never emoji text — this PR's whole point for these five tabs.
    const iconCounts = await page.locator(".seeker-navbtn .seeker-navicon").evaluateAll((els) =>
      els.map((e) => ({ svg: e.querySelectorAll("svg").length, text: (e.textContent || "").trim() })));
    ok("rendered (edu): every nav tab icon is an SVG (no emoji text node in .seeker-navicon)",
       iconCounts.length === 5 && iconCounts.every((c) => c.svg === 1 && c.text === ""),
       JSON.stringify(iconCounts));

    // /checkup and /tools/listing lost their tab, not their route — a deep link and the school
    // home's own Safety tools card both still have to work.
    await page.goto(`http://127.0.0.1:${port}/#/checkup`, { waitUntil: "networkidle", timeout: 20000 });
    await page.waitForSelector(".seeker-pane", { timeout: 15000 });
    ok("rendered (edu): /checkup still renders with no tab pointing at it",
       (await page.locator(".seeker-pane").count()) > 0);

    await page.goto(`http://127.0.0.1:${port}/#/tools/listing`, { waitUntil: "networkidle", timeout: 20000 });
    // ListingCheckup wraps itself in the shared <Pane> (pane.jsx), whose own class is
    // .seeker-tool — not .seeker-pane, which only the checkup/school panes use.
    await page.waitForSelector(".seeker-tool", { timeout: 15000 });
    ok("rendered (edu): /tools/listing still renders with no tab pointing at it",
       (await page.locator(".seeker-tool").count()) > 0);

    // The Safety tools card on the school home links to both.
    await page.goto(`http://127.0.0.1:${port}/#/school`, { waitUntil: "networkidle", timeout: 20000 });
    await page.waitForSelector(".seeker-school-safety", { timeout: 15000 });
    const safetyHrefs = await page.locator(".seeker-school-safety-card").evaluateAll((els) => els.map((e) => e.getAttribute("href")));
    ok("rendered (edu): the school home's Safety tools card links to #/checkup and #/tools/listing",
       safetyHrefs.includes("#/checkup") && safetyHrefs.includes("#/tools/listing"), JSON.stringify(safetyHrefs));

    // The LP Lab tab is active on the course page AND one of its own lessons.
    await page.locator('.seeker-navbtn[href="#/school/lp"]').click();
    await page.waitForTimeout(150);
    let lpActive = await page.locator('.seeker-navbtn[href="#/school/lp"]').getAttribute("class");
    ok("rendered (edu): the LP Lab tab is active on the course page",
       /\bactive\b/.test(String(lpActive)), lpActive);
    const lessonLink = await page.locator(".seeker-school-lesson").first().getAttribute("href").catch(() => null);
    if (lessonLink) {
      await page.goto(`http://127.0.0.1:${port}/${lessonLink}`, { waitUntil: "networkidle", timeout: 20000 });
      await page.waitForTimeout(150);
      lpActive = await page.locator('.seeker-navbtn[href="#/school/lp"]').getAttribute("class");
      ok("rendered (edu): the LP Lab tab is STILL active on one of its own lessons",
         /\bactive\b/.test(String(lpActive)), `href=${lessonLink} class=${lpActive}`);
    } else {
      ok("rendered (edu): the LP Lab tab is STILL active on one of its own lessons", false, "no lesson link found on the course page");
    }

    // And the School tab itself is NOT active while inside the LP Lab course (it's the exact-match
    // "/school" tab — someone editing that back to a prefix match would silently double-highlight).
    const schoolTabClass = await page.locator('.seeker-navbtn[href="#/school"]').getAttribute("class");
    ok("rendered (edu): the School tab is not ALSO active while on the LP Lab course",
       !/\bactive\b/.test(String(schoolTabClass)), schoolTabClass);
  } finally {
    await browser.close();
    server.close();
    fs.rmSync(extractDir, { recursive: true, force: true });
  }
}
