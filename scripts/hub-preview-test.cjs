#!/usr/bin/env node
"use strict";
// Colosseum roadmap EE1 — "who would this pay today?" for DRAFT terms.
//
//   (a) previewing the PUBLISHED terms reproduces the tick's own next-day credits, byte for byte
//       (same eng.accrueSlice call, same lib/hub/readiness.js planBudget the live routes already
//       use — never a second formula).
//   (b) a WIDER draft term flips an excluded wallet to qualified, and the version hash differs
//       from the published one.
//   (c) an invalid draft returns the same validation error validateTerms/createVersion would give
//       a real publish.
//   (d) app-state.json is byte-identical before and after ten previews — it is a read.
//   (e) an operator on a LAPSED project gets the same refusal /admin?terms=1 gives.
//   (f) unauthenticated is 404, exactly like the desk.
//   (g) GET is refused with 405 (POST-only, because the draft is a body — never because it
//       mutates anything).
//   (h) a dry-run project's preview echoes dryRun: true.
//
// Section 1 exercises lib/hub/preview.js directly (pure, deterministic fixtures). Section 2 mounts
// lib/hub/routes.js on a REAL disk-backed kv (lib/kvstore.js, not the in-memory test double) so (d)
// can hash the actual app-state.json file the way a production volume would see it.
const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const express = require("express");

const proj = require("../lib/hub/project");
const eng = require("../lib/hub/engine");
const rdy = require("../lib/hub/readiness");
const preview = require("../lib/hub/preview");
const operator = require("../lib/hub/operator");
const store = require("../lib/hub/store");
const s = require("../lib/cuna-staking");

let pass = 0, fail = 0;
const ok = (name, cond, detail) => { if (cond) { console.log("  ✓ " + name); pass++; } else { fail++; console.log("  ✗ " + name + (detail ? "\n      " + detail : "")); } };

const W = {
  A: "4Gccq9pESbfNeKiW7M7qi587pYYiaQ4T4zLv3LcriGPs", B: "5WKKoF7LcDRsSfTYxccSEj7hejh9U5ZqcX74C7E5X7HG",
  C: "5EjuMxEyxbmja7Nn664CqF5CD47udkqR4dppqNTtDprQ",
  FUND: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", OP: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
  MINT1: "4yro2xbCxMFVvygCsj5FZMgZnVCb8EqcbPGTbSGCgDBc", MINT2: "RoSeiVjW5H48ucPAJh1LJGBBzPpqvsokfDGpgHXDtdF",
};
const TOK = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const DAY = 86400;
const TODAY = "2026-09-18";
const NOW = Math.floor(Date.parse(TODAY + "T12:00:00Z") / 1000);
const TOMORROW = new Date((NOW + DAY) * 1000).toISOString().slice(0, 10);
const TOKENS = (n) => (BigInt(n) * 10n ** 9n).toString();

const mkProject = (id, mint, over = {}) => proj.validateProject(
  { id, label: id.toUpperCase(), symbol: id.toUpperCase().slice(0, 8), mint, fundingWallet: W.FUND, operatorWallets: [W.OP], ...over },
  { decimals: 9, tokenProgram: TOK, extensions: [] },
);
const rawEscrow = (n, mint, { recipient, amount, cliffDays = 180 }) => ({
  escrow: "Esc" + String(n).padStart(29, "1") + "1111111111111",
  account: { tokenMint: mint, recipient, creator: recipient, cancelMode: 0, cancelledAt: 0, vestingStartTime: NOW - 30 * DAY,
    cliffTime: NOW + cliffDays * DAY, frequency: DAY, numberOfPeriod: 0, cliffUnlockAmount: amount, amountPerPeriod: "0", totalClaimedAmount: "0" },
});
const normalized = (e, firstSeenAt = NOW - 100 * DAY) => s.normalizeEscrow(e.escrow, e.account, firstSeenAt);

console.log("\nEE1 — Preview before publish (lib/hub/preview.js, mounted routes)\n");

console.log("1. previewTerms — pure");

const project1 = mkProject("prev1", W.MINT1);
const v1 = proj.createVersion({}, project1, {
  poolDailyRaw: TOKENS(2400), fundedBy: [project1.fundingWallet], minLockRaw: TOKENS(50), minDurationDays: 90, maxTermDays: 540,
  excludeWallets: [W.B],
}, { effectiveFrom: TODAY, todayKey: TODAY }).versions[0];
const state1 = { versions: [v1], armed: true, startedAt: NOW - 30 * DAY };

const locks1 = [
  normalized(rawEscrow(1, W.MINT1, { recipient: W.A, amount: TOKENS(1000) })),  // qualifies
  normalized(rawEscrow(2, W.MINT1, { recipient: W.B, amount: TOKENS(1000) })),  // excluded_recipient
  normalized(rawEscrow(3, W.MINT1, { recipient: W.C, amount: TOKENS(10) })),    // below_min_lock
];

t1: {
  const directTomorrow = rdy.planBudget({ programVersion: v1, locks: locks1, periods: 2 }).periods[1];
  const previewSame = preview.previewTerms({ project: project1, draftTerms: v1.terms, locks: locks1, nowUnix: NOW, state: state1, effectiveFrom: TOMORROW, todayKey: TODAY, days: 1 });
  const walletSum = previewSame.wallets.reduce((a, w) => a + BigInt(w.accrualRaw), 0n);
  ok("(a) preview of the PUBLISHED terms matches planBudget's own next-day obligation, byte for byte",
    previewSame.budget.periods[0].obligationRaw === directTomorrow.obligationRaw && walletSum.toString() === directTomorrow.obligationRaw,
    `budget=${previewSame.budget.periods[0].obligationRaw} direct=${directTomorrow.obligationRaw} walletSum=${walletSum}`);
  const a = previewSame.wallets.find((w) => w.wallet === W.A);
  const b = previewSame.wallets.find((w) => w.wallet === W.B);
  const c = previewSame.wallets.find((w) => w.wallet === W.C);
  ok("…A qualifies", a && a.qualified === true && BigInt(a.accrualRaw) > 0n, JSON.stringify(a));
  ok("…B is excluded_recipient (Rule B — draft terms name it in excludeWallets)", b && b.qualified === false && b.reason === "excluded_recipient", JSON.stringify(b));
  ok("…C is below_min_lock", c && c.qualified === false && c.reason === "below_min_lock", JSON.stringify(c));
  ok("totals.qualified / excluded count the three wallets correctly", previewSame.totals.qualified === 1 && previewSame.totals.excluded === 2, JSON.stringify(previewSame.totals));
  ok("dryRun echoes the project's flag (false here)", previewSame.dryRun === false);

  // (b) a wider draft (drop the minimum lock, and un-exclude B) flips both C and B to qualified,
  // and the version hash differs from the published one because the terms differ.
  const widerTerms = { ...v1.terms, minLockRaw: "0", excludeWallets: [] };
  const previewWider = preview.previewTerms({ project: project1, draftTerms: widerTerms, locks: locks1, nowUnix: NOW, state: state1, effectiveFrom: TOMORROW, todayKey: TODAY, days: 1 });
  ok("(b) the version hash differs from the published version's hash", previewWider.version.hash !== v1.hash, previewWider.version.hash);
  const c2 = previewWider.wallets.find((w) => w.wallet === W.C);
  const b2 = previewWider.wallets.find((w) => w.wallet === W.B);
  ok("…C now qualifies under the wider draft", c2 && c2.qualified === true, JSON.stringify(c2));
  ok("…B now qualifies once it is no longer excluded", b2 && b2.qualified === true, JSON.stringify(b2));

  // (c) an invalid draft throws the SAME error validateTerms/createVersion would for a real publish.
  let threwSameShape = false, directErr = null, previewErr = null;
  try { proj.createVersion(eng.readState(state1), project1, { ...v1.terms, sharePct: 500 }, { effectiveFrom: TOMORROW, todayKey: TODAY }); } catch (e) { directErr = e.message; }
  try { preview.previewTerms({ project: project1, draftTerms: { ...v1.terms, sharePct: 500 }, locks: locks1, nowUnix: NOW, state: state1, effectiveFrom: TOMORROW, todayKey: TODAY }); } catch (e) { previewErr = e.message; }
  threwSameShape = !!directErr && directErr === previewErr;
  ok("(c) an invalid draft throws the identical error a real publish would", threwSameShape, `direct=${directErr} preview=${previewErr}`);

  // A budget for more than one day still reuses planBudget unmodified.
  const wideBudget = preview.previewTerms({ project: project1, draftTerms: v1.terms, locks: locks1, nowUnix: NOW, state: state1, effectiveFrom: TOMORROW, todayKey: TODAY, days: 4 });
  ok("days=4 asks planBudget for 4 periods", Array.isArray(wideBudget.budget.periods) && wideBudget.budget.periods.length === 4, JSON.stringify(wideBudget.budget.periods.length));
}

// ── 2. mounted routes, real disk kv ──────────────────────────────────────────────────────────────
console.log("\n2. mounted routes on a REAL disk-backed kv (lib/kvstore.js)");

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "hub-preview-test-"));
process.env.DATA_DIR = DIR;
const kv = require("../lib/kvstore");
const routes = require("../lib/hub/routes");
const access = require("../lib/hub/access");
const APP_STATE = path.join(DIR, "app-state.json");
const hashFile = () => { try { return crypto.createHash("sha256").update(fs.readFileSync(APP_STATE)).digest("hex"); } catch (_) { return null; } };

const KEY = "preview-test-key";
const OPSECRET = "preview-op-secret";
const balances = {};
const scans = {};
const app = express();
app.use(express.json());
routes.mount(app, {
  kv, adminAuthOK: (req) => req.headers["x-premium-key"] === KEY, publicErrMsg: (e) => (e && e.message) || String(e),
  vault: {}, isDirect: () => false,
  connection: () => ({
    getParsedTokenAccountsByOwner: async (owner) => {
      const id = owner && owner.toBase58 ? owner.toBase58() : String(owner);
      const bal = balances[id];
      if (bal == null) throw new Error("rpc unavailable in this fixture");
      return { value: [{ account: { data: { parsed: { info: { tokenAmount: { amount: String(bal) } } } } } }] };
    },
  }),
  scanDeps: async () => ({ scan: async (mint) => scans[mint] || [], creationTimes: async () => ({}) }),
  alert: () => {}, secret: () => OPSECRET, verifySignature: () => true,
  sigStore: null, getTx: null, clknPriceInSol: null, payTo: null, clknMint: null, clknDecimals: 9,
  reservedMints: () => ({}), rateLimit: null,
  nowUnix: () => NOW,
});

function registerProject(input, mintInfo) {
  const project = proj.validateProject(input, mintInfo);
  let reg = store.readRegistry(kv) || {};
  reg = proj.approveProject(reg, project, { nowUnix: NOW, reserved: {} });
  store.writeRegistry(kv, reg);
  return reg[project.id];
}
function publishVersion(p, terms = {}, day = TODAY) {
  const state = store.read(kv, p.id, "state", {}) || {};
  const next = proj.createVersion(eng.readState(state), p, { poolDailyRaw: TOKENS(2400), fundedBy: [p.fundingWallet], minDurationDays: 90, maxTermDays: 540, ...terms }, { effectiveFrom: day, todayKey: day });
  store.writeVerified(kv, p.id, "state", next);
  return next.versions[next.versions.length - 1];
}

(async () => {
  const srv = await new Promise((resolve) => { const h = app.listen(0, () => resolve(h)); });
  const base = "http://127.0.0.1:" + srv.address().port;
  const ownerHdr = { "x-premium-key": KEY };
  async function postJson(p, headers, jsonBody) {
    const r = await fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...(headers || {}) }, body: jsonBody ? JSON.stringify(jsonBody) : undefined });
    let b = null; try { b = await r.json(); } catch (_) {}
    return { status: r.status, body: b };
  }
  async function getJson(p, headers) {
    const r = await fetch(base + p, { headers: headers || {} });
    let b = null; try { b = await r.json(); } catch (_) {}
    return { status: r.status, body: b };
  }

  try {
    const pFull = registerProject({ id: "route-prev", label: "Prev", symbol: "PREV", mint: W.MINT1, fundingWallet: W.FUND, operatorWallets: [W.OP], accessTier: "comped", accessNote: "ci fixture" }, { decimals: 9, tokenProgram: TOK, extensions: [] });
    const vFull = publishVersion(pFull, { minLockRaw: TOKENS(50), excludeWallets: [W.B] });
    scans[W.MINT1] = [
      rawEscrow(1, W.MINT1, { recipient: W.A, amount: TOKENS(1000) }),
      rawEscrow(2, W.MINT1, { recipient: W.B, amount: TOKENS(1000) }),
      rawEscrow(3, W.MINT1, { recipient: W.C, amount: TOKENS(10) }),
    ];

    // (f) unauthenticated is 404, like the desk.
    let r = await postJson("/api/hub/route-prev/desk/preview", {});
    ok("(f) POST without a key or operator token is 404, like /desk", r.status === 404, JSON.stringify(r.body));

    // (g) GET is refused with 405 — POST-only because the draft is a body, not because it mutates.
    r = await getJson("/api/hub/route-prev/desk/preview", ownerHdr);
    ok("(g) GET /desk/preview is refused with 405", r.status === 405, JSON.stringify(r.body));

    // hash app-state.json, then run ten previews as the owner.
    const before = hashFile();
    for (let i = 0; i < 10; i++) {
      r = await postJson("/api/hub/route-prev/desk/preview", ownerHdr, {});
    }
    const after = hashFile();
    ok("(d) app-state.json is byte-identical after ten previews — it wrote nothing", before !== null && before === after, `before=${before} after=${after}`);
    ok("…and the tenth preview itself succeeded and carries the same wallet reasons as the pure test", r.status === 200 && r.body.ok === true
      && r.body.wallets.find((w) => w.wallet === W.B).reason === "excluded_recipient"
      && r.body.wallets.find((w) => w.wallet === W.C).reason === "below_min_lock", JSON.stringify(r.body));
    ok("…and it echoes as: owner", r.body.as === "owner");

    // A wider draft over the wire also flips the hash and the exclusions, same as the pure test.
    r = await postJson("/api/hub/route-prev/desk/preview", ownerHdr, { minLockRaw: "0", excludeWallets: "" });
    ok("a wider draft posted over HTTP flips B and C to qualified", r.status === 200
      && r.body.wallets.find((w) => w.wallet === W.B).qualified === true
      && r.body.wallets.find((w) => w.wallet === W.C).qualified === true, JSON.stringify(r.body));
    ok("…and the returned hash differs from the published version's", r.body.version.hash !== vFull.hash);

    // An operator token for a project THAT IS an operator of route-prev also works.
    const opToken = operator.issueToken(OPSECRET, { projectId: "route-prev", wallet: W.OP });
    r = await postJson("/api/hub/route-prev/desk/preview", { "x-clkn-operator": opToken }, {});
    ok("an operator token for the project may preview too", r.status === 200 && r.body.as === W.OP, JSON.stringify(r.body).slice(0, 200));

    // (e) an operator on a LAPSED (never-paid, standard tier) project gets the terms-write refusal.
    const pLapsed = registerProject({ id: "route-lapsed", label: "Lapsed", symbol: "LAPS", mint: W.MINT2, fundingWallet: W.FUND, operatorWallets: [W.OP], accessTier: "standard" }, { decimals: 9, tokenProgram: TOK, extensions: [] });
    publishVersion(pLapsed);
    scans[W.MINT2] = [];
    const lapsedToken = operator.issueToken(OPSECRET, { projectId: "route-lapsed", wallet: W.OP });
    r = await postJson("/api/hub/route-lapsed/desk/preview", { "x-clkn-operator": lapsedToken }, {});
    ok("(e) an operator on a lapsed (unpaid) project is refused the same way /admin?terms=1 refuses it", r.status === 402 && /platform access is/.test(String(r.body.error)), JSON.stringify(r.body));
    // The owner is exempt from the access gate, same as the real terms write.
    r = await postJson("/api/hub/route-lapsed/desk/preview", ownerHdr, {});
    ok("…but the owner previews a lapsed project fine", r.status === 200 && r.body.ok === true, JSON.stringify(r.body).slice(0, 200));

    // (h) a dry-run project's preview echoes dryRun: true. Gives it a real fundingWallet even
    // though it is a dry run — a dry run only means "terms not yet agreed, never arm this"
    // (lib/hub/engine.js arm()), not "no funding wallet"; validateTerms unconditionally excludes
    // project.fundingWallet (Rule B), and a null one is not an address.
    const pDry = registerProject({ id: "route-dry-prev", label: "Dry", symbol: "DRYV", mint: "7LHBcRYosycMBwBqxBHeRiDQohYzpppDALKYVT4TNY5H", fundingWallet: W.FUND, operatorWallets: [W.OP], accessTier: "comped", accessNote: "dry run", dryRun: true }, { decimals: 9, tokenProgram: TOK, extensions: [] });
    publishVersion(pDry, { fundedBy: [W.FUND], excludeWallets: [] });
    scans["7LHBcRYosycMBwBqxBHeRiDQohYzpppDALKYVT4TNY5H"] = [];
    r = await postJson("/api/hub/route-dry-prev/desk/preview", ownerHdr, {});
    ok("(h) a dry-run project's preview echoes dryRun: true", r.status === 200 && r.body.dryRun === true, JSON.stringify(r.body));
  } finally {
    await new Promise((resolve) => srv.close(resolve));
    try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (_) {}
  }

  console.log(`\n${fail === 0 ? "all passed" : fail + " FAILED"} (${pass} passed)`);
  process.exit(fail ? 1 : 0);
})();
