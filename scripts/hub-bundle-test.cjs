#!/usr/bin/env node
/*
 * HUB EVIDENCE BUNDLE — AA2 (docs/COLOSSEUM_ROADMAP.md §11): one JSON download that carries a
 * program version, a batch's published inputs and every settled receipt in it, so a holder can
 * save it once and reproduce the whole batch offline forever. This pins:
 *
 *   1. lib/hub/bundle.js in isolation — the pure SHA-256 agrees with node:crypto on boundary-
 *      length and multibyte inputs, buildBundle()'s declared hash matches a fresh recompute,
 *      tampering any byte is caught, and splitBundle() hands back the three shapes
 *      lib/hub/reproduce.js already consumes.
 *   2. GET /api/hub/:project/batch/:batchId/bundle against a seeded fixture: headers (download
 *      filename, JSON content type), an unsettled batch says `settled:false` with a plain-words
 *      note and empty receipts (never a fabricated receipt), a settled batch's hash is IDENTICAL
 *      across two separate fetches, and unknown project/batch both 404.
 *   3. `node scripts/reproduce-receipt.cjs --bundle <file>` — the bundle-hash line prints first,
 *      and its per-receipt verdicts equal what the SAME script prints per-receipt the normal way
 *      (one receipt-url invocation per wallet in the batch).
 *   4. Chromium drops the bundle file on /hub/verify (offline tab): the bundle-hash line renders
 *      before the per-receipt rows, every fixture receipt shows MATCH, and a one-byte-altered copy
 *      shows the hash-mismatch line (while still rendering a verdict per receipt underneath it).
 *   5. The demo fixture's bundle (lib/hub/demo-fixture.js DOES carry a batch — "demo-batch-1") —
 *      fetched, its hash verifies in Node, and the CLI runs over it without crashing. Its receipts
 *      are honestly MISSING_INPUTS (the fixture's batch runs on the Addendum-B ledger model,
 *      lib/hub/ledger.js, which lib/hub/reproduce.js does not read from yet — docs/HUB_VERIFY.md
 *      §g) — that is the true state of this project's payout path, not a test failure.
 *
 * Usage: node scripts/hub-bundle-test.cjs [baseUrl]
 * Env:   HUB_BUNDLE_TEST_PORT (default 3255) — used only when baseUrl is omitted (a server is booted).
 */
"use strict";
const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const { spawn, spawnSync } = require("child_process");

function resolvePlaywright() {
  const candidates = [
    "playwright-core",
    path.join(__dirname, "..", "node_modules", "playwright-core"),
    path.join(__dirname, "..", "..", "node_modules", "playwright-core"),
    "/home/user/cluck-norris-school/node_modules/playwright-core",
  ];
  for (const c of candidates) { try { return require(c); } catch (_) {} }
  throw new Error("could not resolve playwright-core from any known location");
}

const ROOT = path.join(__dirname, "..");
const ARG_BASE = process.argv.find((a) => /^https?:\/\//.test(a)) || null;
const PORT = Number(process.env.HUB_BUNDLE_TEST_PORT || 3255);
const BASE = ARG_BASE || `http://127.0.0.1:${PORT}`;

let failures = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log("  ✓ " + name);
  else { failures++; console.log("  ✗ " + name + (detail ? "\n      " + detail : "")); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const bundleLib = require("../lib/hub/bundle");

// ── fixture data — a REAL project registered in the hub kv registry (not the demo fixture) ──────
const WALLET = "4Gccq9pESbfNeKiW7M7qi587pYYiaQ4T4zLv3LcriGPs";
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const fakeAddr = (n) => Array.from({ length: 44 }, (_, i) => B58[(i * 13 + n * 7 + 5) % 58]).join("");
const fakeSig = (n) => Array.from({ length: 87 }, (_, i) => B58[(i * 11 + n * 17 + 3) % 58]).join("");
const WALLET2 = fakeAddr(2);
const SIG1 = fakeSig(1);
const SIG2 = fakeSig(2);
const PROJECT = "hbtest";
const T0 = 1_800_000_000; // fixed, arbitrary unix seconds — a fixture, not a live clock
const T1 = T0 + 3600;
const BATCH_AT = T0 + 7200;
const BATCH_ID = "hb-batch-1";
const EMPTY_BATCH_ID = "hb-batch-empty";

function buildFixtureState() {
  const days = {
    "2027-02-01T00": { credits: { [WALLET]: "1000000000", [WALLET2]: "700000000" }, at: T0 },
    "2027-02-01T01": { credits: { [WALLET]: "500000000", [WALLET2]: "100000000" }, at: T1 },
  };
  const batches = {
    [BATCH_ID]: {
      id: BATCH_ID, state: "sent", at: BATCH_AT,
      amounts: { [WALLET]: "1500000000", [WALLET2]: "800000000" },
      sent: { [WALLET]: { sig: SIG1, at: BATCH_AT + 60 }, [WALLET2]: { sig: SIG2, at: BATCH_AT + 60 } },
    },
    [EMPTY_BATCH_ID]: { id: EMPTY_BATCH_ID, state: "pending", at: BATCH_AT, amounts: { [WALLET]: "42" }, sent: {} },
  };
  return {
    "hub:projects": {
      [PROJECT]: { id: PROJECT, label: "Hub Bundle Test", symbol: "HBT", mint: fakeAddr(99), decimals: 9, rewardMint: fakeAddr(99), rewardDecimals: 9 },
    },
    [`program:${PROJECT}:days`]: days,
    [`program:${PROJECT}:batches`]: batches,
    [`program:${PROJECT}:paid`]: {},
  };
}

// ── 1. lib/hub/bundle.js in isolation ────────────────────────────────────────────────────────────
function unitTests() {
  console.log("\n1. lib/hub/bundle.js — pure unit tests (no server)\n");

  const boundaries = ["", "a", "abc", "The quick brown fox jumps over the lazy dog"];
  for (let n = 50; n <= 66; n++) boundaries.push("y".repeat(n));           // straddles the 56/64-byte padding boundary
  boundaries.push("héllo wörld 🎉", "unicode: 𝔘𝔫𝔦𝔠𝔬𝔡𝔢 emoji 😀🚀 and CJK 漢字テスト", "x".repeat(5000));
  let shaOk = true;
  for (const s of boundaries) {
    const a = bundleLib.sha256Hex(s), b = crypto.createHash("sha256").update(s, "utf8").digest("hex");
    if (a !== b) { shaOk = false; console.log("      sha256Hex mismatch on", JSON.stringify(s.slice(0, 30)), a, b); }
  }
  ok("sha256Hex(): agrees with node:crypto on empty/short/boundary/multibyte/emoji/long inputs", shaOk);

  const receiptA = { projectId: PROJECT, symbol: "HBT", dryRun: false, brand: null,
    program: { kind: "lock-to-earn", id: "lock-to-earn", label: "Lock to Earn", ticker: "HBT" },
    receipt: { wallet: WALLET, amountUi: "1.5", sig: SIG1, at: BATCH_AT + 60, state: "settled", batchId: BATCH_ID } };
  const receiptB = { projectId: PROJECT, symbol: "HBT", dryRun: false, brand: null,
    program: { kind: "lock-to-earn", id: "lock-to-earn", label: "Lock to Earn", ticker: "HBT" },
    receipt: { wallet: WALLET2, amountUi: "0.8", sig: SIG2, at: BATCH_AT + 60, state: "settled", batchId: BATCH_ID } };
  const batchInputs = { projectId: PROJECT, batchId: BATCH_ID, decimals: 9, wallets: {
    [WALLET]: { kind: "lock-to-earn", batchId: BATCH_ID, batchAt: BATCH_AT, wallet: WALLET, amountRaw: "1500000000", periods: [{ key: "a", at: T0, creditRaw: "1000000000" }, { key: "b", at: T1, creditRaw: "500000000" }], priorPaidRaw: "0", priorReservedRaw: "0" },
    [WALLET2]: { kind: "lock-to-earn", batchId: BATCH_ID, batchAt: BATCH_AT, wallet: WALLET2, amountRaw: "800000000", periods: [{ key: "a", at: T0, creditRaw: "700000000" }, { key: "b", at: T1, creditRaw: "100000000" }], priorPaidRaw: "0", priorReservedRaw: "0" },
  } };
  const bundle = bundleLib.buildBundle({ projectView: { id: PROJECT, label: "Hub Bundle Test" }, programVersion: null, batchInputs, receipts: [receiptA, receiptB] });
  ok("buildBundle(): carries kind/bundleVersion", bundle.kind === "clkn-hub-evidence-bundle" && bundle.bundleVersion === 1);
  ok("buildBundle(): settled defaults true when receipts is non-empty", bundle.settled === true);
  ok("buildBundle(): its own declared hash verifies against a fresh recompute", bundleLib.verifyBundleHash(bundle).ok === true, JSON.stringify(bundleLib.verifyBundleHash(bundle)));
  ok("buildBundle(): round-tripped through JSON.stringify/parse, the hash STILL verifies (no undefined-key drift)", bundleLib.verifyBundleHash(JSON.parse(JSON.stringify(bundle))).ok === true);

  const unsettled = bundleLib.buildBundle({ projectView: { id: PROJECT, label: "Hub Bundle Test" }, programVersion: null, batchInputs: { projectId: PROJECT, batchId: EMPTY_BATCH_ID, decimals: 9, wallets: {} }, receipts: [], note: "not settled yet" });
  ok("buildBundle(): settled:false + a note when there are no receipts", unsettled.settled === false && unsettled.note === "not settled yet");

  // Two builds of the SAME settled batch, seconds apart (generatedAt differs) — same hash.
  const bundle2 = bundleLib.buildBundle({ projectView: { id: PROJECT, label: "Hub Bundle Test" }, programVersion: null, batchInputs, receipts: [receiptA, receiptB] });
  ok("buildBundle(): two builds of the same settled batch hash identically regardless of generatedAt", bundle.hash === bundle2.hash && bundle.generatedAt !== undefined);

  const tampered = JSON.parse(JSON.stringify(bundle));
  tampered.batch.inputs[WALLET].amountRaw = "999999";
  const tv = bundleLib.verifyBundleHash(tampered);
  ok("verifyBundleHash(): a one-field tamper is caught", tv.ok === false, JSON.stringify(tv));
  ok("verifyBundleHash(): no hash on the object is reported, not thrown", bundleLib.verifyBundleHash({}).ok === false);

  const split = bundleLib.splitBundle(bundle);
  ok("splitBundle(): receipts pass through", split.receipts.length === 2);
  ok("splitBundle(): batchInputs.wallets matches batch.inputs", JSON.stringify(split.batchInputs.wallets) === JSON.stringify(bundle.batch.inputs));
  ok("splitBundle(): batchInputs.batchId/decimals carried", split.batchInputs.batchId === BATCH_ID && split.batchInputs.decimals === 9);
  ok("splitBundle(): programVersion passes through (null here)", split.programVersion === null);

  // Feeds straight into the existing pure reproduce() unchanged, per receipt.
  const { reproduce } = require("../lib/hub/reproduce");
  for (const rb of split.receipts) {
    const entry = split.batchInputs.wallets[rb.receipt.wallet];
    const r = reproduce({ programVersion: split.programVersion, inputs: { periods: entry.periods, priorPaidRaw: entry.priorPaidRaw, priorReservedRaw: entry.priorReservedRaw }, receipt: { amountRaw: entry.amountRaw } });
    ok(`splitBundle() -> reproduce(): wallet ${rb.receipt.wallet.slice(0, 6)}… reproduces to MATCH`, r.status === "MATCH", JSON.stringify(r));
  }
}

// ── 3. the CLI's --bundle verdicts vs its own per-receipt verdicts ──────────────────────────────
function runCli(args) {
  const r = spawnSync(process.execPath, [path.join(ROOT, "scripts", "reproduce-receipt.cjs"), ...args], { encoding: "utf8" });
  return { code: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}
function parseStatuses(stdout) {
  return [...stdout.matchAll(/^status:\s*(\S+)/gm)].map((m) => m[1]);
}

async function main() {
  unitTests();

  let srv = null, DIR = null;
  if (!ARG_BASE) {
    DIR = fs.mkdtempSync(path.join(os.tmpdir(), "hub-bundle-test-"));
    fs.writeFileSync(path.join(DIR, "app-state.json"), JSON.stringify(buildFixtureState()));
    const env = { ...process.env, PORT: String(PORT), DATA_DIR: DIR, TOOLGATE_OFF: "1",
      TELEGRAM_BOT_TOKEN: "", TELEGRAM_CHAT_ID: "", HELIUS_API_KEY: "", MM_OPERATOR_SECRET: "", MM_OPERATOR_SECRET_TREASURY: "",
      FALLBACK_RPC_URL: "http://127.0.0.1:9" };
    srv = spawn(process.execPath, ["server.js"], { cwd: ROOT, env, stdio: "ignore" });
    let up = false;
    for (let i = 0; i < 80; i++) { try { const r = await fetch(`${BASE}/healthz`); if (r.ok) { up = true; break; } } catch (_) {} await sleep(500); }
    if (!up) { console.error("server did not come up"); if (srv) srv.kill("SIGKILL"); process.exit(1); }
  }

  console.log("\n2. GET /api/hub/" + PROJECT + "/batch/<batchId>/bundle\n");
  let bundleBody = null;
  try {
    const r = await fetch(`${BASE}/api/hub/${PROJECT}/batch/${BATCH_ID}/bundle`);
    ok("200 for a real, settled batch", r.status === 200, "got " + r.status);
    ok("Content-Disposition names a download file", /attachment; filename="hub-hbtest-hb-batch-1-evidence\.json"/.test(r.headers.get("content-disposition") || ""), r.headers.get("content-disposition"));
    ok("Content-Type is JSON", /application\/json/.test(r.headers.get("content-type") || ""), r.headers.get("content-type"));
    ok("Cache-Control is public with a max-age", /public, max-age=\d+/.test(r.headers.get("cache-control") || ""), r.headers.get("cache-control"));
    bundleBody = await r.json();
    ok("settled:true with 2 receipts", bundleBody.settled === true && bundleBody.receipts.length === 2, JSON.stringify(bundleBody.settled) + " " + bundleBody.receipts.length);
    ok("batch.id/decimals match the fixture", bundleBody.batch.id === BATCH_ID && bundleBody.batch.decimals === 9);
    ok("batch.inputs carries both wallets", Object.keys(bundleBody.batch.inputs).sort().join(",") === [WALLET, WALLET2].sort().join(","));
    ok("hash verifies in Node", bundleLib.verifyBundleHash(bundleBody).ok === true, JSON.stringify(bundleLib.verifyBundleHash(bundleBody)));

    const r2 = await fetch(`${BASE}/api/hub/${PROJECT}/batch/${BATCH_ID}/bundle`);
    const body2 = await r2.json();
    ok("re-fetching the SAME settled batch hashes identically", bundleBody.hash === body2.hash, `${bundleBody.hash} vs ${body2.hash}`);

    const rEmpty = await fetch(`${BASE}/api/hub/${PROJECT}/batch/${EMPTY_BATCH_ID}/bundle`);
    const bodyEmpty = await rEmpty.json();
    ok("an unsettled batch is still 200", rEmpty.status === 200);
    ok("unsettled batch: settled:false, empty receipts, a plain-words note", bodyEmpty.settled === false && Array.isArray(bodyEmpty.receipts) && bodyEmpty.receipts.length === 0 && typeof bodyEmpty.note === "string" && bodyEmpty.note.length > 10, JSON.stringify(bodyEmpty));
    ok("unsettled batch: hash still verifies (nothing fabricated)", bundleLib.verifyBundleHash(bodyEmpty).ok === true);

    const rNoProj = await fetch(`${BASE}/api/hub/no-such-project-xyz/batch/${BATCH_ID}/bundle`);
    ok("unknown project -> 404", rNoProj.status === 404);
    const rNoBatch = await fetch(`${BASE}/api/hub/${PROJECT}/batch/no-such-batch-xyz/bundle`);
    ok("unknown batch -> 404", rNoBatch.status === 404);
  } catch (e) { ok("bundle route is fetchable and well-formed", false, e.stack || e.message); }

  console.log("\n3. node scripts/reproduce-receipt.cjs --bundle <file> vs per-receipt CLI verdicts\n");
  if (bundleBody) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hub-bundle-cli-"));
    const bundlePath = path.join(tmp, "bundle.json");
    fs.writeFileSync(bundlePath, JSON.stringify(bundleBody));
    const cli = runCli(["--bundle", bundlePath]);
    ok("prints the bundle-hash line FIRST", /^bundle hash: MATCHES/.test(cli.stdout.trim()), cli.stdout.split("\n")[0]);
    ok("exits 0 (hash matched, both receipts MATCH)", cli.code === 0, `exit ${cli.code}\n${cli.stdout}\n${cli.stderr}`);
    const bundleStatuses = parseStatuses(cli.stdout);
    ok("reports one status line per receipt", bundleStatuses.length === 2, JSON.stringify(bundleStatuses));

    const perReceipt = [SIG1, SIG2].map((sig) => runCli([`${BASE}/hub/${PROJECT}/r/${sig}`]));
    const perReceiptStatuses = perReceipt.map((r) => parseStatuses(r.stdout)[0]);
    ok("the --bundle verdicts equal the same script's per-receipt verdicts", JSON.stringify(bundleStatuses.slice().sort()) === JSON.stringify(perReceiptStatuses.slice().sort()), `bundle: ${bundleStatuses} vs per-receipt: ${perReceiptStatuses}`);

    const tampered = JSON.parse(JSON.stringify(bundleBody));
    tampered.batch.inputs[WALLET].amountRaw = "1";
    const tamperedPath = path.join(tmp, "tampered.json");
    fs.writeFileSync(tamperedPath, JSON.stringify(tampered));
    const cliTampered = runCli(["--bundle", tamperedPath]);
    ok("a tampered bundle: hash line says DOES NOT MATCH", /^bundle hash: DOES NOT MATCH/.test(cliTampered.stdout.trim()), cliTampered.stdout.split("\n")[0]);
    ok("a tampered bundle still reports a verdict per receipt (never crashes)", parseStatuses(cliTampered.stdout).length === 2, cliTampered.stdout);
    ok("a tampered bundle exits non-zero", cliTampered.code !== 0, String(cliTampered.code));
    fs.rmSync(tmp, { recursive: true, force: true });
  } else {
    ok("--bundle CLI test", false, "no bundleBody from step 2 — skipped");
  }

  console.log("\n4. /hub/verify — Chromium drops the bundle file (offline tab)\n");
  {
    const { chromium } = resolvePlaywright();
    const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
    try {
      const page = await browser.newPage();
      const pageErrors = [];
      page.on("pageerror", (e) => pageErrors.push(String(e)));
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hub-bundle-browser-"));
      const bundlePath = path.join(tmp, "bundle.json");
      fs.writeFileSync(bundlePath, JSON.stringify(bundleBody));

      await page.goto(`${BASE}/hub/verify`, { waitUntil: "networkidle", timeout: 20000 });
      await page.click("#tabFiles");
      await page.setInputFiles("#fileIn", [bundlePath]);
      await page.waitForSelector(".verdict .badge", { timeout: 10000 }).catch(() => {});
      const badges = await page.$$eval(".verdict .badge", (els) => els.map((e) => e.textContent));
      ok("bundle-hash line renders FIRST", badges[0] === "BUNDLE HASH: MATCHES", JSON.stringify(badges));
      ok("every fixture receipt shows MATCH", badges.slice(1).every((b) => b === "MATCH") && badges.length === 3, JSON.stringify(badges));
      ok("no uncaught page errors on a clean bundle", pageErrors.length === 0, pageErrors.join("\n"));

      const tampered = JSON.parse(JSON.stringify(bundleBody));
      tampered.batch.inputs[WALLET2].amountRaw = "1";
      const tamperedPath = path.join(tmp, "tampered.json");
      fs.writeFileSync(tamperedPath, JSON.stringify(tampered));
      await page.goto(`${BASE}/hub/verify`, { waitUntil: "networkidle", timeout: 20000 });
      await page.click("#tabFiles");
      await page.setInputFiles("#fileIn", [tamperedPath]);
      await page.waitForSelector(".verdict .badge", { timeout: 10000 }).catch(() => {});
      const badges2 = await page.$$eval(".verdict .badge", (els) => els.map((e) => e.textContent));
      ok("a one-byte-altered bundle shows the hash-mismatch line first", badges2[0] === "BUNDLE HASH: DOES NOT MATCH", JSON.stringify(badges2));
      ok("...and still renders a verdict row per receipt underneath it", badges2.length === 3, JSON.stringify(badges2));
      ok("still no uncaught page errors on the tampered bundle", pageErrors.length === 0, pageErrors.join("\n"));

      const bodyText = (await page.textContent("body").catch(() => "")).toLowerCase();
      ok("no 'verified project' / 'safe' / APR-APY language anywhere on the page", !bodyText.includes("verified project") && !/\bsafe\b/.test(bodyText) && !/\bapr\b/.test(bodyText) && !/\bapy\b/.test(bodyText));

      fs.rmSync(tmp, { recursive: true, force: true });
    } finally { await browser.close(); }
  }

  console.log("\n5. the demo fixture's bundle (lib/hub/demo-fixture.js DOES carry a batch)\n");
  try {
    const info = await fetch(`${BASE}/api/hub-demo/demo`).then((x) => x.json());
    const demoBatchId = info.project && info.project.batch && info.project.batch.id;
    ok("the demo fixture carries a batch id", !!demoBatchId, JSON.stringify(info.project && info.project.batch));
    if (demoBatchId) {
      const r = await fetch(`${BASE}/api/hub-demo/demo/batch/${demoBatchId}/bundle`);
      ok("200 for the demo project's batch", r.status === 200, String(r.status));
      const demoBundle = await r.json();
      ok("carries dryRun:true throughout", demoBundle.project.dryRun === true, JSON.stringify(demoBundle.project));
      ok("hash verifies in Node", bundleLib.verifyBundleHash(demoBundle).ok === true, JSON.stringify(bundleLib.verifyBundleHash(demoBundle)));
      ok("has at least one receipt", Array.isArray(demoBundle.receipts) && demoBundle.receipts.length > 0, demoBundle.receipts.length);

      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hub-demo-bundle-"));
      const p = path.join(tmp, "demo-bundle.json");
      fs.writeFileSync(p, JSON.stringify(demoBundle));
      const cli = runCli(["--bundle", p]);
      ok("the Node script runs over it without crashing (prints the hash line + one status per receipt)", /^bundle hash: MATCHES/.test(cli.stdout.trim()) && parseStatuses(cli.stdout).length === demoBundle.receipts.length, `exit ${cli.code}\n${cli.stdout}\n${cli.stderr}`);
      // Honest, not a bug: this fixture's batch runs on the Addendum-B ledger model, which
      // lib/hub/reproduce.js does not read from yet (docs/HUB_VERIFY.md §g) — every receipt is
      // MISSING_INPUTS, never a fabricated MATCH.
      ok("every receipt honestly reports MISSING_INPUTS (the Addendum-B gap, not a fabricated MATCH)", parseStatuses(cli.stdout).every((s) => s === "MISSING_INPUTS"), cli.stdout);
      fs.rmSync(tmp, { recursive: true, force: true });

      const rNoBatch = await fetch(`${BASE}/api/hub-demo/demo/batch/not-a-real-batch/bundle`);
      ok("an unknown demo batch id -> 404", rNoBatch.status === 404);
      const rNoProj = await fetch(`${BASE}/api/hub-demo/no-such-demo-project/batch/${demoBatchId}/bundle`);
      ok("an unknown demo project -> 404", rNoProj.status === 404);
    }
  } catch (e) { ok("demo bundle round trip", false, e.stack || e.message); }

  if (srv) { try { srv.kill("SIGKILL"); } catch (_) {} }
  if (DIR) { try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (_) {} }

  console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${failures} failing assertion${failures === 1 ? "" : "s"}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
