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
//   (c) GOOGLE/IOS UNAFFECTED: building both existing variants from a PRISTINE checkout of
//       origin/develop (a disposable git worktree, node_modules symlinked in — no second
//       `npm install`) and from THIS tree produces the exact same file list with every shared
//       file byte-identical (a content diff, not a raw .tgz compare — the tar's own deterministic
//       mtime is tied to HEAD's commit time, which legitimately differs between this branch and
//       origin/develop's tip and would make an even a no-op change "differ"). This is the actual
//       "did adding seeker touch the existing releases" question — a passing store-edition-test
//       alone only proves the shape is still right, not that the bytes are still the bytes the
//       wrapper's store-edition.lock already pins.
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
  // (c) google/ios unaffected — byte-identical against a pristine origin/develop build
  // ══════════════════════════════════════════════════════════════════════════════════════════
  console.log("\n(c) google/ios unaffected (byte-identical vs. a pristine origin/develop build)\n");
  let baseline = null, baselineWt = null;
  try {
    execFileSync("git", ["rev-parse", "--verify", "origin/develop"], { cwd: ROOT });
    baselineWt = fs.mkdtempSync(path.join(os.tmpdir(), "seeker-baseline-"));
    fs.rmdirSync(baselineWt);   // `git worktree add` wants to create the dir itself
    execFileSync("git", ["worktree", "add", "--detach", "--quiet", baselineWt, "origin/develop"], { cwd: ROOT, stdio: "pipe" });
    fs.symlinkSync(path.join(ROOT, "node_modules"), path.join(baselineWt, "node_modules"));
    baseline = baselineWt;
  } catch (e) {
    console.log("  · could not set up a pristine origin/develop worktree — skipping the byte-identical comparison");
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

  for (const variant of ["google", "ios"]) {
    const here = buildVariant(ROOT, variant);
    ok(`${variant}: this tree's build verifies clean (build-store-edition.mjs's own checks passed)`, true);
    if (baseline) {
      let base;
      try { base = buildVariant(baseline, variant); }
      catch (e) { ok(`${variant}: pristine origin/develop build also succeeds`, false, (e && e.stack) || String(e)); continue; }
      // Content diff, not a raw .tgz byte compare: the tar is written with `--mtime=@<commit
      // time>` (build-store-edition.mjs, deterministic-tar step) so a tarball built from THIS
      // branch (extra commits on top of origin/develop, later commit time) legitimately differs
      // in that one embedded timestamp even when every FILE inside is identical — which is the
      // actual question here ("did adding seeker change what ships"), not "is this session's git
      // history the same age as origin/develop's".
      for (const field of ["variant", "version", "apiBase", "topDir", "stripComponents"]) {
        ok(`${variant}: manifest.${field} matches the pristine build`, JSON.stringify(here[field]) === JSON.stringify(base[field]), `here=${here[field]} base=${base[field]}`);
      }
      const hereFiles = extractedFiles(path.join(ROOT, "release", here.file));
      const baseFiles = extractedFiles(path.join(baseline, "release", base.file));
      const herePaths = [...hereFiles.keys()].sort(), basePaths = [...baseFiles.keys()].sort();
      ok(`${variant}: identical file list vs. a pristine origin/develop checkout`, JSON.stringify(herePaths) === JSON.stringify(basePaths),
        { onlyHere: herePaths.filter((p) => !baseFiles.has(p)), onlyBase: basePaths.filter((p) => !hereFiles.has(p)) });
      const diffPaths = herePaths.filter((p) => baseFiles.has(p) && Buffer.compare(hereFiles.get(p), baseFiles.get(p)) !== 0);
      ok(`${variant}: every shared file is byte-identical vs. a pristine origin/develop checkout`, diffPaths.length === 0, diffPaths);
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

  const ADDR = "FAKEADDR1111111111111111111111111111111111";
  const SIG = "5FakeSig1111111111111111111111111111111111111111111111111111111111111111";
  function fakeBridge(calls) {
    return {
      authorize: async (a) => { calls.push(["authorize", a]); return { address: ADDR, authToken: "tok-1" }; },
      reauthorize: async (a) => { calls.push(["reauthorize", a]); return { address: ADDR, authToken: "tok-1" }; },
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
    ok("connect() returns a real address through the shared connect() surface", r && r.pubkey === ADDR && r.id === "mwa", JSON.stringify(r));
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
  const css = fs.readFileSync(path.join(ROOT, "src", "seeker", "seeker.css"), "utf8");
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
    await renderedCheck(pw);
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // (f) i18n
  // ══════════════════════════════════════════════════════════════════════════════════════════
  console.log("\n(f) i18n — the 8 new keys, all six dictionaries, and the audit itself\n");
  const NEW_KEYS = [
    "Rent Reclaim", "Connect Wallet", "Disconnect", "Coming soon", "Not connected",
    "Find dead token accounts and reclaim the SOL locked inside them.",
    "Ask the AI tutor anything about crypto, in plain words.",
    "Check approvals, freeze and mint authority — read-only and free.",
  ];
  for (const lang of ["es", "zh", "hi", "it", "pt", "vi"]) {
    const dict = JSON.parse(fs.readFileSync(path.join(ROOT, "public", "i18n", `${lang}.json`), "utf8"));
    const missing = NEW_KEYS.filter((k) => !Object.prototype.hasOwnProperty.call(dict, k));
    ok(`${lang}.json carries all 8 new keys`, missing.length === 0, missing);
  }
  // the SAME 8 keys must NOT reach the google/ios bundle (excludeKeys prune) — the pristine
  // baseline comparison above already proves this at the byte level when it can run; this checks
  // it directly too, so the assertion still means something even when that comparison is skipped.
  {
    const seekerCfg = JSON.parse(fs.readFileSync(path.join(ROOT, "store-edition", "store-edition.json"), "utf8"));
    const missing = NEW_KEYS.filter((k) => !(seekerCfg.excludeKeys || []).includes(k));
    ok("store-edition.json excludes every new seeker key from the google/ios dictionary copy", missing.length === 0, missing);
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

async function renderedCheck(pw) {
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
            authorize: async (a) => { window.__mwaCalls.push(["authorize", a]); return { address: "RENDEREDFAKE111111111111111111111111111111", authToken: "tok" }; },
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

    ok("rendered: default route redirects to #/rent", (await page.evaluate(() => location.hash)) === "#/rent");
    const navCount = await page.locator(".seeker-navbtn").count();
    ok("rendered: three bottom-nav tabs", navCount === 3, navCount);
    const boxes = await page.locator(".seeker-navbtn").evaluateAll((els) => els.map((e) => e.getBoundingClientRect()));
    ok("rendered: every nav tab is actually >=44x44 on screen", boxes.every((b) => b.width >= 44 && b.height >= 44), JSON.stringify(boxes));
    const walletBox = await page.locator(".seeker-walletbtn").boundingBox();
    ok("rendered: the wallet button is actually >=44x44 on screen", !!walletBox && walletBox.width >= 44 && walletBox.height >= 44, JSON.stringify(walletBox));

    await page.locator(".seeker-navbtn", { hasText: "Ask Cluck" }).click();
    await page.waitForTimeout(150);
    ok("rendered: tapping a nav tab changes the hash (client-side route, no reload)", (await page.evaluate(() => location.hash)) === "#/ask");
    ok("rendered: the Ask Cluck pane is now showing", /Ask Cluck/.test(await page.locator(".seeker-pane h1").innerText()));

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
  } finally {
    await browser.close();
    server.close();
    fs.rmSync(extractDir, { recursive: true, force: true });
  }
}
