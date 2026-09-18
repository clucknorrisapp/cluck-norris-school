#!/usr/bin/env node
"use strict";
// DD1 (docs/COLOSSEUM_ROADMAP.md §14): packages/hub-verify must be a BUILD OUTPUT of
// scripts/build-hub-verify-package.cjs, never a hand-maintained second copy of the repo's
// verifier — and the three places that run this verifier (the repo script, the packaged `npx`
// CLI, and the browser bundle at public/hub-verify.bundle.js) must agree, not merely "look
// similar". Four layers, cheapest first:
//
//   (a) build-determinism — re-running the build script into a throwaway temp dir reproduces
//       packages/hub-verify/{lib,schema,bin,MANIFEST.json} byte-for-byte. A hand-edit to the
//       committed package, or a source change with no rebuild, fails here.
//   (b) fixture parity — the SAME fixtures scripts/hub-verify-page-test.cjs uses (MATCH/MISMATCH/
//       MISSING_INPUTS, a buy-comp row, schema validate(), canonicalJson()) run through the repo
//       lib, the packaged lib, and the built browser bundle; all three must produce identical
//       output. Then, against a real ephemeral fixture server, `node scripts/reproduce-receipt.cjs
//       <url>` and `node packages/hub-verify/bin/hub-verify.cjs <url>` must print identical output
//       and exit with the same code.
//   (c) `npm pack --dry-run` in the package directory must produce a tarball under 200 KB
//       containing only the allowlisted files (bin/, lib/, schema/, README.md, LICENSE,
//       package.json — nothing else, in particular never MANIFEST.json or a stray build artifact).
//   (d) requiring the package's own lib/ from a directory OUTSIDE this repo must work with no
//       throw — the guard against an accidental repo-relative require (e.g. `../../../lib/x`)
//       that only happens to resolve while the package still lives inside the monorepo checkout.
//
// Usage: node scripts/hub-verify-package-test.cjs

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const PKG_DIR = path.join(ROOT, "packages", "hub-verify");
const BUNDLE_PATH = path.join(ROOT, "public", "hub-verify.bundle.js");

let failures = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log("  ✓ " + name);
  else { failures++; console.log("  ✗ " + name + (detail ? "\n      " + detail : "")); }
};

// ── (a) build-determinism ───────────────────────────────────────────────────────────────────────
console.log("\n(a) rebuilding packages/hub-verify into a temp dir matches the committed copy byte-for-byte\n");
const { build } = require("./build-hub-verify-package.cjs");
const tmpBuild = fs.mkdtempSync(path.join(os.tmpdir(), "hub-verify-pkg-build-"));
build(tmpBuild);

function listFilesRel(dir) {
  const out = [];
  (function walk(d, rel) {
    for (const name of fs.readdirSync(d)) {
      const abs = path.join(d, name);
      const relPath = rel ? rel + "/" + name : name;
      if (fs.statSync(abs).isDirectory()) walk(abs, relPath);
      else out.push(relPath);
    }
  })(dir, "");
  return out.sort();
}
const committedFiles = listFilesRel(PKG_DIR).filter((f) => f !== "package.json" && f !== "README.md" && f !== "LICENSE");
const freshFiles = listFilesRel(tmpBuild);
ok("the build produced the same file list as the committed package (lib/schema/bin/MANIFEST.json)",
  JSON.stringify(committedFiles) === JSON.stringify(freshFiles),
  `committed: ${JSON.stringify(committedFiles)}\n      fresh:     ${JSON.stringify(freshFiles)}`);
for (const rel of freshFiles) {
  const a = fs.readFileSync(path.join(PKG_DIR, rel));
  const b = fs.readFileSync(path.join(tmpBuild, rel));
  ok(`${rel} is byte-identical to the committed copy`, Buffer.compare(a, b) === 0);
}
fs.rmSync(tmpBuild, { recursive: true, force: true });

// ── (b) fixture parity — three verifiers, one set of fixtures ──────────────────────────────────
console.log("\n(b) the repo lib, the packaged lib and the browser bundle agree on every fixture\n");

if (!fs.existsSync(BUNDLE_PATH)) {
  console.log("building public/hub-verify.bundle.js (npm run build:hubverify)…");
  const r = spawnSync(process.execPath, [path.join(ROOT, "node_modules", ".bin", "vite"), "build", "--config", "vite.hubverify.config.js"], { cwd: ROOT, stdio: "inherit" });
  if (r.status !== 0 || !fs.existsSync(BUNDLE_PATH)) { console.error("could not build the bundle"); process.exit(1); }
}

async function fixtureParity() {
  const repoLib = require("../lib/hub/reproduce");
  const pkgLib = require("../packages/hub-verify/lib/hub/reproduce");
  const bundle = await import("file://" + BUNDLE_PATH);
  const repoSchema = require("../lib/hub/schema-validate");
  const pkgSchema = require("../packages/hub-verify/lib/hub/schema-validate");
  const repoCanon = require("../lib/hub/canonical");
  const pkgCanon = require("../packages/hub-verify/lib/hub/canonical");

  const cases = [
    { name: "reproduce() MATCH", fn: "reproduce", args: [{ programVersion: null, inputs: { periods: [{ key: "a", at: 1, creditRaw: "1000000000" }, { key: "b", at: 2, creditRaw: "500000000" }], priorPaidRaw: "0", priorReservedRaw: "0" }, receipt: { amountRaw: "1500000000" } }], expectStatus: "MATCH" },
    { name: "reproduce() MISMATCH", fn: "reproduce", args: [{ programVersion: null, inputs: { periods: [{ key: "a", at: 1, creditRaw: "1000000000" }, { key: "b", at: 2, creditRaw: "500000000" }], priorPaidRaw: "0", priorReservedRaw: "0" }, receipt: { amountRaw: "1600000000" } }], expectStatus: "MISMATCH" },
    { name: "reproduce() MISSING_INPUTS", fn: "reproduce", args: [{ programVersion: null, inputs: null, receipt: { amountRaw: "1500000000" } }], expectStatus: "MISSING_INPUTS" },
    { name: "reproduceBuyCompRow() flat prize MATCH", fn: "reproduceBuyCompRow", args: [{ terms: { places: [{ amount: 10 }], pctPrize: false }, rank: 1, tokensBought: null, valueSol: null, published: 10 }], expectStatus: "MATCH" },
    { name: "reproduceBuyCompRow() percent prize", fn: "reproduceBuyCompRow", args: [{ terms: { places: [{ amount: 5 }], pctPrize: true }, rank: 1, tokensBought: 1000, valueSol: null, published: 50 }], expectStatus: "MATCH" },
  ];
  for (const c of cases) {
    const repoResult = repoLib[c.fn](...c.args);
    const pkgResult = pkgLib[c.fn](...c.args);
    const bundleResult = bundle[c.fn](...c.args);
    const allEqual = JSON.stringify(repoResult) === JSON.stringify(pkgResult) && JSON.stringify(repoResult) === JSON.stringify(bundleResult);
    ok(`${c.name}: repo lib === packaged lib === browser bundle`, allEqual,
      JSON.stringify({ repoResult, pkgResult, bundleResult }));
    ok(`...and the verdict is ${c.expectStatus}`, repoResult.status === c.expectStatus, "got " + repoResult.status);
  }

  const schema = { type: "object", required: ["a"], properties: { a: { type: "string" } }, additionalProperties: false };
  const good = { a: "x" }, bad = { a: 1, b: 2 };
  ok("schema validate() valid body: repo === packaged === bundle",
    JSON.stringify(repoSchema.validate(schema, good)) === JSON.stringify(pkgSchema.validate(schema, good)) &&
    JSON.stringify(repoSchema.validate(schema, good)) === JSON.stringify(bundle.validate(schema, good)));
  ok("schema validate() invalid body: repo === packaged === bundle",
    JSON.stringify(repoSchema.validate(schema, bad)) === JSON.stringify(pkgSchema.validate(schema, bad)) &&
    JSON.stringify(repoSchema.validate(schema, bad)) === JSON.stringify(bundle.validate(schema, bad)));

  const body = { projectId: "x", version: 1, effectiveFrom: "2027-01-01", effectiveTo: null, mint: "a", terms: { a: 1, z: 2 } };
  ok("canonicalJson(): repo === packaged === bundle",
    repoCanon.canonicalJson(body) === pkgCanon.canonicalJson(body) &&
    repoCanon.canonicalJson(body) === bundle.canonicalJson(body));
}

// ── CLI parity against a real ephemeral fixture server ──────────────────────────────────────────
const WALLET = "4Gccq9pESbfNeKiW7M7qi587pYYiaQ4T4zLv3LcriGPs";
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const fakeSig = (n) => Array.from({ length: 87 }, (_, i) => B58[(i * 11 + n * 17 + 3) % 58]).join("");
const PROJECT = "hvpkgtest";
const T0 = 1_800_000_000, BATCH_AT = T0 + 7200;
const SIG_MATCH = fakeSig(11), SIG_MISMATCH = fakeSig(12);

function buildFixtureState() {
  const days = { "2027-01-15T00": { credits: { [WALLET]: "1000000000" }, at: T0 } };
  const batches = {
    "hv-batch-match": { id: "hv-batch-match", state: "sent", at: BATCH_AT, amounts: { [WALLET]: "1000000000" }, sent: { [WALLET]: { sig: SIG_MATCH, at: BATCH_AT + 60 } } },
    "hv-batch-mismatch": { id: "hv-batch-mismatch", state: "sent", at: BATCH_AT, amounts: { [WALLET]: "999999999" }, sent: { [WALLET]: { sig: SIG_MISMATCH, at: BATCH_AT + 60 } } },
  };
  return {
    "hub:projects": { [PROJECT]: { id: PROJECT, label: "Hub Verify Package Test", symbol: "HVP", mint: "So11111111111111111111111111111111111111112", decimals: 9, rewardMint: "So11111111111111111111111111111111111111112", rewardDecimals: 9 } },
    [`program:${PROJECT}:days`]: days,
    [`program:${PROJECT}:batches`]: batches,
    [`program:${PROJECT}:paid`]: {},
  };
}

async function cliParity() {
  console.log("\n...CLI parity: `node scripts/reproduce-receipt.cjs` vs `node packages/hub-verify/bin/hub-verify.cjs`\n");
  const { spawn } = require("child_process");
  const PORT = Number(process.env.HUB_VERIFY_PKG_TEST_PORT || 3339);
  const BASE = `http://127.0.0.1:${PORT}`;
  const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "hub-verify-pkg-"));
  fs.writeFileSync(path.join(DIR, "app-state.json"), JSON.stringify(buildFixtureState()));
  const env = { ...process.env, PORT: String(PORT), DATA_DIR: DIR, TOOLGATE_OFF: "1",
    TELEGRAM_BOT_TOKEN: "", TELEGRAM_CHAT_ID: "", HELIUS_API_KEY: "", MM_OPERATOR_SECRET: "", MM_OPERATOR_SECRET_TREASURY: "",
    FALLBACK_RPC_URL: "http://127.0.0.1:9" };
  const srv = spawn(process.execPath, ["server.js"], { cwd: ROOT, env, stdio: "ignore" });
  try {
    let up = false;
    for (let i = 0; i < 80; i++) { try { const r = await fetch(`${BASE}/healthz`); if (r.ok) { up = true; break; } } catch (_) {} await new Promise((res) => setTimeout(res, 500)); }
    if (!up) { ok("fixture server came up", false); return; }

    function runBoth(url) {
      const repo = spawnSync(process.execPath, [path.join(ROOT, "scripts", "reproduce-receipt.cjs"), url], { encoding: "utf8" });
      const pkg = spawnSync(process.execPath, [path.join(PKG_DIR, "bin", "hub-verify.cjs"), url], { encoding: "utf8" });
      return { repo, pkg };
    }
    for (const [label, url] of [["MATCH", `${BASE}/hub/${PROJECT}/r/${SIG_MATCH}`], ["MISMATCH", `${BASE}/hub/${PROJECT}/r/${SIG_MISMATCH}`]]) {
      const { repo, pkg } = runBoth(url);
      ok(`${label}: exit codes agree (repo=${repo.status}, pkg=${pkg.status})`, repo.status === pkg.status);
      ok(`${label}: stdout agrees`, repo.stdout === pkg.stdout, `repo:\n${repo.stdout}\npkg:\n${pkg.stdout}`);
    }
  } finally {
    try { srv.kill("SIGKILL"); } catch (_) {}
    fs.rmSync(DIR, { recursive: true, force: true });
  }
}

// ── (c) npm pack --dry-run: size + allowlist ────────────────────────────────────────────────────
function packCheck() {
  console.log("\n(c) `npm pack --dry-run` — tarball size and file allowlist\n");
  const r = spawnSync("npm", ["pack", "--dry-run", "--json"], { cwd: PKG_DIR, encoding: "utf8" });
  ok("npm pack --dry-run ran", r.status === 0, r.stderr);
  let info;
  try { info = JSON.parse(r.stdout)[0]; } catch (e) { ok("npm pack --dry-run produced parseable JSON", false, r.stdout + r.stderr); return; }
  ok("tarball is under 200 KB", info.size < 200 * 1024, `size: ${info.size} bytes`);
  const ALLOWED_PREFIXES = ["bin/", "lib/", "schema/"];
  const ALLOWED_EXACT = new Set(["package.json", "README.md", "LICENSE"]);
  for (const f of info.files) {
    const allowed = ALLOWED_EXACT.has(f.path) || ALLOWED_PREFIXES.some((p) => f.path.startsWith(p));
    ok(`tarball entry "${f.path}" is in the allowlist`, allowed);
  }
  ok("MANIFEST.json is NOT in the published tarball", !info.files.some((f) => f.path === "MANIFEST.json"));
}

// ── (d) requiring the package's lib/ from outside the repo ─────────────────────────────────────
function outsideRepoCheck() {
  console.log("\n(d) require()ing the package's lib/ from a directory OUTSIDE this repo\n");
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "hub-verify-outside-"));
  try {
    fs.cpSync(PKG_DIR, path.join(outside, "hub-verify"), { recursive: true });
    const script = `
      const r = require(${JSON.stringify(path.join(outside, "hub-verify", "lib", "hub", "reproduce.js"))});
      const out = r.reproduce({ programVersion: null, inputs: { periods: [{ key: "a", at: 1, creditRaw: "1000000000" }], priorPaidRaw: "0", priorReservedRaw: "0" }, receipt: { amountRaw: "1000000000" } });
      if (out.status !== "MATCH") { console.error("unexpected status: " + out.status); process.exit(1); }
      console.log("OK");
    `;
    // cwd is OUTSIDE the repo entirely and HOME/NODE_PATH stripped, so any accidental
    // repo-relative or environment-dependent require would fail here and nowhere else.
    const r = spawnSync(process.execPath, ["-e", script], { cwd: os.tmpdir(), env: { PATH: process.env.PATH } });
    ok("require() from outside the repo works with no throw", r.status === 0 && String(r.stdout).includes("OK"),
      `status=${r.status}\nstdout=${r.stdout}\nstderr=${r.stderr}`);
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
  }
}

async function main() {
  await fixtureParity();
  await cliParity();
  packCheck();
  outsideRepoCheck();
  console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${failures} failing assertion${failures === 1 ? "" : "s"}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
