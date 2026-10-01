#!/usr/bin/env node
/*
 * HUB LOAD FIXTURE — Colosseum roadmap §15 EE3 ("Load proof for the public reads").
 *
 * Writes a deterministic (seeded PRNG), throwaway `app-state.json` for the real kv store,
 * registering `--projects` (default 50) Hub projects, each with:
 *   - one published program version (`lib/hub/project.js` createVersion — the exact call
 *     scripts/hub-bundle-test.cjs already seeds a fixture project's version with);
 *   - 30 days of hourly-slice accrual (`program:<id>:days`), one credited hour per day for
 *     fixture-build speed — the key format and per-slice shape are the real thing
 *     (lib/hub/engine.js's accrual row: `{ credits: {wallet: raw}, at }`), just a lower cadence
 *     than the live 24-slice/day engine so a 50x200 fixture builds in seconds, not minutes;
 *   - `--receipts` (default 200) lock-to-earn receipts spread across ~4 sent batches, built with
 *     the REAL `lib/cuna-payout.js` `buildBatch`/`recordSent` — the same pipeline the live
 *     `/cuna-payout` and `/api/hub/:project/payout` routes run — driven hour-by-hour over the
 *     accrual so each batch pays exactly the credits new since the last one. That is what makes
 *     `/api/hub/:project/reproducibility` compute real MATCHes: nothing here hand-types a
 *     receipt or a verdict, only the ledger inputs a real payout run would have produced;
 *   - 3 holder snapshots (`lib/holders-snapshot.js` `appendSnapshot`, via `lib/hub/store.js`'s
 *     `memoryKv()` scratch store so the real hashing/id logic runs unmodified and the result is
 *     merged into the fixture's kv dump).
 *
 * One wallet (`crossWallet` in the manifest) is seeded into EVERY project, so
 * `/api/hub/wallet/:wallet` (the platform-wide "one wallet, every project" roll-up, and the
 * un-rate-limited route P1-03 flags) has real, non-trivial work to do across the whole registry
 * — not a single-project lookup that undercounts the route's true cost.
 *
 * Determinism: this process's own `Math.random` is replaced with a seeded PRNG for its entire
 * run (`--seed`, default fixed) BEFORE any fixture code runs, so every amount, snapshot id and
 * holder balance is reproducible across machines — including inside `lib/holders-snapshot.js`'s
 * own `Math.random()`-based id suffix. Addresses/signatures use a collision-free counter-based
 * base58 formula (the same shape `hub-bundle-test.cjs`/`hub-status-test.cjs` already use), so
 * they need no PRNG of their own.
 *
 * Output: `<out>/app-state.json` (the kv file `DATA_DIR` boots from) and `<out>/manifest.json`
 * (project ids/mints/wallets/batch ids `hub-load-smoke.cjs` needs to hit real data without
 * re-deriving the address formula itself).
 *
 * Usage: node scripts/hub-load-fixture.cjs [--projects N] [--receipts M] [--seed S] [--out DIR]
 * Default --out is a FIXED path (not a fresh tmpdir) so a bare `node hub-load-smoke.cjs` run
 * right after finds it with no flags of its own: `<os.tmpdir()>/hub-load-fixture`.
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");

const hubStore = require("../lib/hub/store");
const proj = require("../lib/hub/project");
const pay = require("../lib/cuna-payout");
const holders = require("../lib/holders-snapshot");

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1 || i === process.argv.length - 1) return def;
  return process.argv[i + 1];
}
const PROJECTS_N = Math.max(1, parseInt(arg("projects", "50"), 10) || 50);
const RECEIPTS_M = Math.max(4, parseInt(arg("receipts", "200"), 10) || 200);
const SEED = parseInt(arg("seed", "424242"), 10) >>> 0;
const OUT_DIR = arg("out", path.join(os.tmpdir(), "hub-load-fixture"));

// ── seeded PRNG, installed as Math.random for this process's whole run ─────────────────────────
// mulberry32 — small, fast, good enough distribution for fixture amounts (not cryptography).
function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
Math.random = mulberry32(SEED); // deterministic for the rest of this process (a one-shot script)

// ── collision-free fake base58 addresses/signatures (same formula the existing hub tests use) ─
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const fakeAddr = (n) => Array.from({ length: 44 }, (_, i) => B58[(i * 13 + n * 7 + 5) % 58]).join("");
const fakeSig = (n) => Array.from({ length: 87 }, (_, i) => B58[(i * 11 + n * 17 + 3) % 58]).join("");
let addrCounter = 0, sigCounter = 0;
const nextAddr = () => fakeAddr(addrCounter++);
const nextSig = () => fakeSig(sigCounter++);

const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const T0 = 1_700_000_000; // fixed, arbitrary unix seconds — a fixture, not a live clock
const DAY = 86400;
const ACCRUAL_DAYS = 30;
const BATCH_BOUNDARIES = [7, 14, 21, 29]; // day-index (0-based) a batch is cut on — ~4 batches
const WALLETS_PER_PROJECT = Math.max(2, Math.ceil(RECEIPTS_M / BATCH_BOUNDARIES.length));

function isoHourKey(unixSec) { return new Date(unixSec * 1000).toISOString().slice(0, 13); }
function isoDate(unixSec) { return new Date(unixSec * 1000).toISOString().slice(0, 10); }
function randRaw(minWhole, maxWhole, decimals = 9) {
  const whole = minWhole + Math.random() * (maxWhole - minWhole);
  return BigInt(Math.floor(whole * 10 ** decimals)).toString();
}

function buildOneProject(idx, crossWallet) {
  const id = `load-${idx}`;
  const mint = nextAddr();
  const fundingWallet = nextAddr();
  const wallets = [crossWallet];
  while (wallets.length < WALLETS_PER_PROJECT) wallets.push(nextAddr());

  // one published program version — the exact builder scripts/hub-bundle-test.cjs seeds with.
  const versionProject = { id, mint, rewardMint: mint, rewardDecimals: 9, rewardTokenProgram: TOKEN_PROGRAM, fundingWallet };
  const effectiveFrom = isoDate(T0 - 2 * DAY);
  const version = proj.createVersion({}, versionProject, {
    poolDailyRaw: "5000000000000", minDurationDays: 1, maxTermDays: 540,
    payoutSchedule: "weekly", vesting: "any", fundedBy: [fundingWallet],
  }, { effectiveFrom, todayKey: effectiveFrom }).versions[0];

  // 30 days of accrual, one credited hour per day (fixture-build speed — see file header).
  // Built up incrementally so batches cut at day boundaries only ever see credits already
  // written by that point, the same way a live hourly tick would.
  const days = {};
  const batches = {};
  let paid = {};
  let batchN = 0;
  for (let d = 0; d < ACCRUAL_DAYS; d++) {
    const at = T0 + d * DAY;
    const key = isoHourKey(at);
    const credits = {};
    for (const w of wallets) credits[w] = randRaw(1, 50);
    days[key] = { at, credits };

    if (BATCH_BOUNDARIES.includes(d)) {
      const owed = pay.owedNow({ days, paid, pending: batches });
      const batchId = `load-${idx}-batch-${batchN}`;
      const batchAt = at + 300; // a few minutes after the last accrued hour
      const batch = pay.buildBatch({ owed, batchId, nowUnix: batchAt });
      const results = Object.keys(batch.amounts).map((w) => ({ wallet: w, sig: nextSig() }));
      const rec = pay.recordSent({ batch, paid, results, nowUnix: batchAt + 60 });
      paid = rec.paid;
      batches[batchId] = rec.batch;
      batchN++;
    }
  }

  return {
    id, mint, fundingWallet, wallets, decimals: 9,
    registry: { id, label: `Load Test ${idx}`, symbol: `LD${idx}`, mint, decimals: 9, rewardMint: mint, rewardDecimals: 9 },
    state: { versions: [version] },
    days, batches, paid,
    batchIds: Object.keys(batches),
  };
}

// hubStore.memoryKv() has no setVerified (only lib/kvstore.js's real store does), and
// appendSnapshot() requires it — the same small wrapper scripts/holders-snapshot-diff-test.cjs
// adds around the same memoryKv() shape for its own unit tests.
function verifiedMemoryKv() {
  const kv = hubStore.memoryKv();
  kv.setVerified = (k, v) => { kv.set(k, v); return true; };
  return kv;
}

function buildHolderSnapshots(kv, project) {
  const { mint, wallets } = project;
  const top = wallets.slice(0, 25).map((w, i) => ({ wallet: w, amount: Math.floor(1_000_000 - i * 10_000 + Math.random() * 5000) }));
  const fullList = wallets.map((w, i) => ({ wallet: w, amount: Math.floor(500_000 - i * 100 + Math.random() * 500) }));
  for (let s = 0; s < 3; s++) {
    const at = (T0 + s * 10 * DAY) * 1000; // ms, matching lib/holders-snapshot.js's `at`
    holders.appendSnapshot(kv, {
      mint, at, holderCount: wallets.length + s, top,
      totalSupplyRaw: String(BigInt(wallets.length) * 1_000_000_000_000n + BigInt(s)),
      fullList, symbol: project.registry.symbol,
    });
  }
}

function main() {
  const t0 = Date.now();
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const crossWallet = nextAddr(); // present in EVERY project — stresses the wallet roll-up route
  const state = { "hub:projects": {} };
  const manifestProjects = [];
  let totalReceipts = 0;

  // one scratch kv per project for the holder-snapshot writer, merged into `state` afterward —
  // reuses the real appendSnapshot()/computeListHash() logic unmodified (lib/hub/store.js's own
  // memoryKv(), the same throwaway kv the store module ships for exactly this purpose).
  const snapKv = verifiedMemoryKv();

  for (let i = 0; i < PROJECTS_N; i++) {
    const p = buildOneProject(i, crossWallet);
    state["hub:projects"][p.id] = p.registry;
    state[`program:${p.id}:state`] = p.state;
    state[`program:${p.id}:days`] = p.days;
    state[`program:${p.id}:batches`] = p.batches;
    state[`program:${p.id}:paid`] = p.paid;
    buildHolderSnapshots(snapKv, p);
    const receiptsHere = Object.values(p.batches).reduce((n, b) => n + Object.keys(b.sent || {}).length, 0);
    totalReceipts += receiptsHere;
    manifestProjects.push({
      id: p.id, mint: p.mint, decimals: p.decimals, wallets: p.wallets,
      batchIds: p.batchIds, receipts: receiptsHere,
    });
  }
  Object.assign(state, snapKv.dump());

  const appStatePath = path.join(OUT_DIR, "app-state.json");
  const manifestPath = path.join(OUT_DIR, "manifest.json");
  fs.writeFileSync(appStatePath, JSON.stringify(state));
  fs.writeFileSync(manifestPath, JSON.stringify({
    generatedAt: new Date().toISOString(), seed: SEED,
    projectsRequested: PROJECTS_N, receiptsRequested: RECEIPTS_M,
    walletsPerProject: WALLETS_PER_PROJECT, totalReceipts,
    crossWallet, projects: manifestProjects,
  }, null, 2));

  const elapsedMs = Date.now() - t0;
  const sizeBytes = fs.statSync(appStatePath).size;
  console.log(`fixture: ${PROJECTS_N} projects x ~${WALLETS_PER_PROJECT} wallets, ${totalReceipts} receipts across ${BATCH_BOUNDARIES.length} batches/project`);
  console.log(`app-state.json: ${(sizeBytes / 1024 / 1024).toFixed(2)} MB (${sizeBytes} bytes)`);
  console.log(`elapsed: ${(elapsedMs / 1000).toFixed(2)}s`);
  console.log(`path: ${OUT_DIR}`);
  console.log(`FIXTURE_DIR=${OUT_DIR}`);
  if (elapsedMs > 60000) { console.error(`WARNING: exceeded the 60s budget for a 50x200-class fixture`); }
}

main();
