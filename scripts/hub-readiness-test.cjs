#!/usr/bin/env node
"use strict";
// Launch Readiness (design doc, Addendum A) — acceptance tests 11, 12, 13.
//   11. Each checklist item resolves to exactly one of ok/warn/block with a detail and a rule;
//       a fully funded program is ready.
//   12. The reward-budget planner reproduces one accrual period of the live engine on the same
//       locks (same function, by construction), and handles zero budget, zero daily distribution,
//       payout caps and an unavailable funding observation; a shortfall blocks arming via
//       &arm=1&confirm=go-live and the route names the blocking item's key.
//   13. A project with no Hatchery mint (readiness reads nothing Hatchery-specific — it works
//       from Project/version/funding/locks alone) completes the checklist; the differing-reward-
//       asset warning is present and cannot be dismissed by any operator field; a dry-run project
//       is always blocked; the public body carries no readiness data; the desk's new section
//       carries no APR/APY/rate language and no "safe project" summary badge.
//
// Section 1 tests lib/hub/readiness.js directly (pure). Section 2 mounts lib/hub/routes.js on a
// real Express app + memoryKv to prove the HTTP surface — the operator-gated read, and the
// arm-time refusal — behaves the same way.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const express = require("express");
const store = require("../lib/hub/store");
const proj = require("../lib/hub/project");
const eng = require("../lib/hub/engine");
const ledger = require("../lib/hub/ledger");
const rdy = require("../lib/hub/readiness");
const routes = require("../lib/hub/routes");
const prog = require("../lib/cuna-programme");
const s = require("../lib/cuna-staking");
const T = require("../lib/hub/teach");

let pass = 0, fail = 0;
const queue = [];
const t = (n, f) => queue.push([n, f]);
const section = (n) => queue.push([n, null]);

const W = {
  A: "4Gccq9pESbfNeKiW7M7qi587pYYiaQ4T4zLv3LcriGPs", B: "5WKKoF7LcDRsSfTYxccSEj7hejh9U5ZqcX74C7E5X7HG",
  FUND: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", OP: "5EjuMxEyxbmja7Nn664CqF5CD47udkqR4dppqNTtDprQ",
  MINT1: "4yro2xbCxMFVvygCsj5FZMgZnVCb8EqcbPGTbSGCgDBc", MINT2: "RoSeiVjW5H48ucPAJh1LJGBBzPpqvsokfDGpgHXDtdF",
  MINT3: "CwaM5dYLzya3V26VHQjnZVxh3iigrxbgVQJm4npPSBdo",
};
const TOK = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const DAY = 86400;
const TODAY = "2026-09-18";
const NOW = Math.floor(Date.parse(TODAY + "T12:00:00Z") / 1000);
const TOKENS = (n) => (BigInt(n) * 10n ** 9n).toString();

const mkProject = (id, mint, over = {}) => proj.validateProject(
  { id, label: id.toUpperCase(), symbol: id.toUpperCase().slice(0, 8), mint, fundingWallet: W.FUND, operatorWallets: [W.OP], ...over },
  { decimals: 9, tokenProgram: TOK, extensions: [] },
);
const mkVersion = (project, terms = {}, day = TODAY) =>
  proj.createVersion({}, project, { poolDailyRaw: TOKENS(2400), fundedBy: [project.fundingWallet], minLockRaw: 0, minDurationDays: 90, maxTermDays: 540, ...terms }, { effectiveFrom: day, todayKey: day }).versions[0];

// Raw scanned-escrow shape (what a chain scan returns) and its normalized form (what the engine
// consumes) — same builders lib/hub/engine's own test uses, so a fixture here means what it means
// there.
const rawEscrow = (n, mint, { recipient = W.A, creator = W.A, amount = TOKENS(100), cliffDays = 180, periods = 0, perPeriod = "0", cancelMode = 0, cancelledAt = 0, freqDays = 30 } = {}) => ({
  escrow: "Esc" + String(n).padStart(29, "1") + "1111111111111",
  account: { tokenMint: mint, recipient, creator, cancelMode, cancelledAt, vestingStartTime: NOW - 30 * DAY,
    cliffTime: NOW + cliffDays * DAY, frequency: freqDays * DAY, numberOfPeriod: periods, cliffUnlockAmount: amount, amountPerPeriod: perPeriod, totalClaimedAmount: "0" },
});
const normalized = (e, firstSeenAt = NOW - 10 * DAY) => s.normalizeEscrow(e.escrow, e.account, firstSeenAt);

section("11. the checklist — every item is ok/warn/block with a detail and a rule");

t("a fresh project with no version blocks on program_version, term_range and budget; not ready", () => {
  const p = mkProject("fresh", W.MINT1);
  const r = rdy.readiness({ project: p, programVersion: null, state: {}, fundingStatus: {}, locks: [] });
  assert.strictEqual(r.ready, false);
  for (const it of r.items) {
    assert.ok(["ok", "warn", "block"].includes(it.status), it.key);
    assert.ok(it.detail && it.detail.length > 0, it.key + " has no detail");
    assert.ok(it.rule && it.rule.length > 0, it.key + " has no rule");
  }
  assert.strictEqual(r.items.find((i) => i.key === "program_version").status, "block");
  assert.strictEqual(r.items.find((i) => i.key === "term_range").status, "block");
  assert.strictEqual(r.items.find((i) => i.key === "budget").status, "block");
  assert.strictEqual(r.items.find((i) => i.key === "dry_run").status, "ok");
  assert.strictEqual(r.items.find((i) => i.key === "funding_wallet").status, "ok");
});

t("a fully funded, single-holder program is ready (coverage exactly 1.0 is not a shortfall)", () => {
  const p = mkProject("full", W.MINT1);
  const v = mkVersion(p);
  const locks = [normalized(rawEscrow(1, W.MINT1, { amount: TOKENS(100) }))];
  const plan1 = rdy.planBudget({ programVersion: v, locks, periods: 1, startUnix: NOW });
  const need = BigInt(plan1.periods[0].obligationRaw);
  assert.ok(need > 0n, "the fixture should project a positive obligation");
  const fs1 = ledger.fundingStatus({ part: {}, batches: {}, journal: {}, projectId: "full", observed: { balanceRaw: need.toString(), at: NOW } });
  const r = rdy.readiness({ project: p, programVersion: v, state: { versions: [v] }, fundingStatus: fs1, locks });
  assert.strictEqual(r.ready, true, JSON.stringify(r.items.filter((i) => i.status === "block")));
  for (const it of r.items) assert.notStrictEqual(it.status, "block", it.key);
});

t("a shortfall against the coming period's projection blocks the budget item only", () => {
  const p = mkProject("short", W.MINT1);
  const v = mkVersion(p);
  const locks = [normalized(rawEscrow(1, W.MINT1, { amount: TOKENS(100) }))];
  const plan1 = rdy.planBudget({ programVersion: v, locks, periods: 1, startUnix: NOW });
  const need = BigInt(plan1.periods[0].obligationRaw);
  const half = (need / 2n).toString();
  const fs1 = ledger.fundingStatus({ part: {}, batches: {}, journal: {}, projectId: "short", observed: { balanceRaw: half, at: NOW } });
  const r = rdy.readiness({ project: p, programVersion: v, state: { versions: [v] }, fundingStatus: fs1, locks });
  assert.strictEqual(r.ready, false);
  const budget = r.items.find((i) => i.key === "budget");
  assert.strictEqual(budget.status, "block");
  assert.ok(/coverage 0\./.test(budget.detail), budget.detail);
  // only the budget item should be blocking in this fixture
  assert.deepStrictEqual(r.items.filter((i) => i.status === "block").map((i) => i.key), ["budget"]);
});

t("an unavailable funding observation is a warn, never a block and never treated as zero", () => {
  const p = mkProject("unavail", W.MINT1);
  const v = mkVersion(p);
  const locks = [normalized(rawEscrow(1, W.MINT1, { amount: TOKENS(100) }))];
  const fs1 = ledger.fundingStatus({ part: {}, batches: {}, journal: {}, projectId: "unavail", observed: null });
  const r = rdy.readiness({ project: p, programVersion: v, state: { versions: [v] }, fundingStatus: fs1, locks });
  const budget = r.items.find((i) => i.key === "budget");
  assert.strictEqual(budget.status, "warn");
  assert.ok(/could not be read/.test(budget.detail));
  assert.strictEqual(r.ready, true, "an unreadable balance is a warn, not a block, on its own");
});

t("program_version: a tampered hash blocks even with terms present", () => {
  const p = mkProject("tamper", W.MINT1);
  const v = mkVersion(p);
  const bad = { ...v, hash: "0".repeat(64) };
  const r = rdy.readiness({ project: p, programVersion: bad, state: { versions: [bad] }, fundingStatus: {}, locks: [] });
  assert.strictEqual(r.items.find((i) => i.key === "program_version").status, "block");
});

t("term_range: defensively blocks a corrupted version even though validateTerms would never produce one", () => {
  const p = mkProject("corrupt", W.MINT1);
  const v = mkVersion(p);
  const corrupted = { ...v, terms: { ...v.terms, minDurationDays: 400, maxTermDays: 90 } };   // min > max
  const r = rdy.readiness({ project: p, programVersion: corrupted, state: { versions: [corrupted] }, fundingStatus: {}, locks: [] });
  assert.strictEqual(r.items.find((i) => i.key === "term_range").status, "block");
});

t("commitment: absent is a warn labelled exactly 'not yet committed (dry run)'; a signed one is ok", () => {
  const p = mkProject("commit", W.MINT1);
  const v = mkVersion(p);
  const bare = rdy.readiness({ project: p, programVersion: v, state: { versions: [v] }, fundingStatus: {}, locks: [] });
  const c1 = bare.items.find((i) => i.key === "commitment");
  assert.strictEqual(c1.status, "warn");
  assert.strictEqual(c1.detail, "not yet committed (dry run)");
  const committed = { ...v, commitment: { sig: "Hash1111111111111111111111111111111111111111", at: NOW } };
  const done = rdy.readiness({ project: p, programVersion: committed, state: { versions: [committed] }, fundingStatus: {}, locks: [] });
  assert.strictEqual(done.items.find((i) => i.key === "commitment").status, "ok");
});

t("funding_wallet: present and distinct from every operator wallet is ok; equal to one is a warn, not a block", () => {
  const p = mkProject("fundeq", W.MINT1, { fundingWallet: W.OP, operatorWallets: [W.OP] });
  const r = rdy.readiness({ project: p, programVersion: null, state: {}, fundingStatus: {}, locks: [] });
  const it = r.items.find((i) => i.key === "funding_wallet");
  assert.strictEqual(it.status, "warn");
  assert.notStrictEqual(r.items.filter((i) => i.status === "block").map((i) => i.key).includes("funding_wallet"), true);
});

section("11b. dry run always blocks, whatever else is green");

t("a dry-run project is blocked with exactly the required label, even when fully funded", () => {
  const p = mkProject("dryok", W.MINT1, { accessTier: "comped", accessNote: "dry run — pilot for W6b" });
  const v = mkVersion(p);
  const locks = [normalized(rawEscrow(1, W.MINT1, { amount: TOKENS(100) }))];
  const plan1 = rdy.planBudget({ programVersion: v, locks, periods: 1, startUnix: NOW });
  const need = BigInt(plan1.periods[0].obligationRaw).toString();
  const fs1 = ledger.fundingStatus({ part: {}, batches: {}, journal: {}, projectId: "dryok", observed: { balanceRaw: need, at: NOW } });
  const r = rdy.readiness({ project: p, programVersion: v, state: { versions: [v] }, fundingStatus: fs1, locks });
  assert.strictEqual(r.ready, false);
  const it = r.items.find((i) => i.key === "dry_run");
  assert.strictEqual(it.status, "block");
  assert.strictEqual(it.detail, "dry run — terms not agreed");
  assert.deepStrictEqual(r.items.filter((i) => i.status === "block").map((i) => i.key), ["dry_run"]);
});

section("13. reward-asset warning is mandatory and cannot be dismissed by any field");

t("rewardMint differing from mint is a warn present on every call, regardless of extra fields", () => {
  const p = mkProject("diff", W.MINT2, { rewardMint: W.MINT1, rewardMintInfo: { decimals: 9, tokenProgram: TOK, extensions: [] } });
  assert.strictEqual(p.rewardMint, W.MINT1);
  const withoutVersion = rdy.readiness({ project: p, programVersion: null, state: {}, fundingStatus: {}, locks: [], ignoreRewardWarning: true, operatorOverride: "yes" });
  assert.strictEqual(withoutVersion.items.find((i) => i.key === "reward_asset").status, "warn");
  const v = mkVersion(p);
  const withVersion = rdy.readiness({ project: p, programVersion: v, state: { versions: [v] }, fundingStatus: {}, locks: [] });
  const it = withVersion.items.find((i) => i.key === "reward_asset");
  assert.strictEqual(it.status, "warn");
  assert.ok(it.detail.includes(W.MINT2) && it.detail.includes(W.MINT1), it.detail);
  // readiness() has no parameter that could suppress it — the function's own arity proves it:
  // only { project, programVersion, state, fundingStatus, locks } are ever read.
  assert.strictEqual(rdy.readiness.length <= 1, true);
});

t("same mint for reward and lock is ok, not warn", () => {
  const p = mkProject("same", W.MINT1);
  const r = rdy.readiness({ project: p, programVersion: null, state: {}, fundingStatus: {}, locks: [] });
  assert.strictEqual(r.items.find((i) => i.key === "reward_asset").status, "ok");
});

section("12. the reward-budget planner");

t("period-1 obligation equals 24 direct accrueSlice ticks on the SAME locks — same function, by construction", () => {
  const p = mkProject("plan1", W.MINT1);
  const v = mkVersion(p);
  const locks = [normalized(rawEscrow(1, W.MINT1, { recipient: W.A, amount: TOKENS(100) })), normalized(rawEscrow(2, W.MINT1, { recipient: W.B, amount: TOKENS(300) }))];
  const plan = rdy.planBudget({ programVersion: v, locks, periods: 1, startUnix: NOW });
  // Independently replay the same 24 hours through lib/hub/engine.accrueSlice directly — the
  // exact call the live scheduler makes every tick — and sum the distributed amounts by hand.
  const project = { mint: v.mint };
  // Mirror planBudget's own window formula exactly (never before the version's effectiveFrom,
  // floored to the UTC hour) so this replay walks the SAME 24 hours planBudget just did — and its
  // own startedAt=1 (never re-litigating when a lock was first seen; see readiness.js's comment).
  const effFromUnix = Math.floor(Date.parse(v.effectiveFrom + "T00:00:00Z") / 1000);
  const windowStart = Math.floor(Math.max(NOW, effFromUnix) / 3600) * 3600;
  const state = { versions: [v], armed: true, startedAt: 1 };
  let days = {}, sum = 0n;
  for (let h = 0; h < prog.SLICES_PER_DAY; h++) {
    const nowUnix = windowStart + h * 3600;
    const res = eng.accrueSlice({ project, state, days, locks, ledgerKnown: locks.length, nowUnix });
    assert.ok(res.ok, res.reason);
    days = { ...days, [res.key]: res.row };
    sum += BigInt(res.row.distributedRaw);
  }
  assert.strictEqual(plan.periods[0].obligationRaw, sum.toString());
  assert.strictEqual(plan.dailyRaw, sum.toString());
  // A single eligible weight class shares the WHOLE fixed daily pool with none held back to a
  // funder stream — the fixture's pool distributes in full.
  assert.strictEqual(sum.toString(), TOKENS(2400));
});

t("4 periods cumulate correctly and each period's window is a real UTC day after the version's effectiveFrom", () => {
  const p = mkProject("plan4", W.MINT1);
  const v = mkVersion(p);
  const locks = [normalized(rawEscrow(1, W.MINT1, { amount: TOKENS(100) }))];
  const plan = rdy.planBudget({ programVersion: v, locks, periods: 4, startUnix: NOW });
  assert.strictEqual(plan.periods.length, 4);
  let cum = 0n;
  for (const row of plan.periods) { cum += BigInt(row.obligationRaw); assert.strictEqual(row.cumulativeRaw, cum.toString()); }
  assert.strictEqual(plan.totalRaw, cum.toString());
  assert.strictEqual(plan.periods[1].fromUnix - plan.periods[0].fromUnix, DAY);
  assert.ok(plan.periods[0].fromUnix >= Math.floor(Date.parse(v.effectiveFrom + "T00:00:00Z") / 1000));
});

t("zero daily distribution (no funder stream, poolDailyRaw 0, sharePct only) projects zero without throwing", () => {
  const p = mkProject("plan0", W.MINT1);
  const v = mkVersion(p, { poolDailyRaw: "0", sharePct: 5 });
  const locks = [normalized(rawEscrow(1, W.MINT1, { amount: TOKENS(100) }))];   // no funder escrow -> no stream
  const plan = rdy.planBudget({ programVersion: v, locks, periods: 2, startUnix: NOW });
  assert.strictEqual(plan.periods[0].obligationRaw, "0");
  assert.strictEqual(plan.periods[1].cumulativeRaw, "0");
});

t("no locks at all projects zero for every period without throwing (an empty first scan, not a missed one)", () => {
  const p = mkProject("planempty", W.MINT1);
  const v = mkVersion(p);
  const plan = rdy.planBudget({ programVersion: v, locks: [], periods: 3, startUnix: NOW });
  assert.strictEqual(plan.totalRaw, "0");
});

t("a per-wallet cap (maxWalletSharePct) is honoured — planBudget never re-derives the split itself", () => {
  const p = mkProject("plancap", W.MINT1);
  const v = mkVersion(p, { maxWalletSharePct: 10 });   // no single wallet may take more than 10% of the pool
  const locks = [normalized(rawEscrow(1, W.MINT1, { amount: TOKENS(100) }))];   // the only eligible wallet
  const plan = rdy.planBudget({ programVersion: v, locks, periods: 1, startUnix: NOW });
  // With only one eligible wallet capped at 10%, at most 10% of the daily pool can be distributed;
  // the rest is undistributed that day (accrueDay's own rule — planBudget just reports its output).
  const cap = BigInt(TOKENS(2400)) / 10n;
  assert.ok(BigInt(plan.periods[0].obligationRaw) <= cap, plan.periods[0].obligationRaw);
});

t("planBudget is decimals-agnostic — it works in raw units regardless of the mint's own decimals", () => {
  // decimals come from the mint account the caller reads, never typed in (lib/hub/project.js).
  const p6d = proj.validateProject({ id: "plan6d", label: "Plan6D", symbol: "P6D", mint: W.MINT3, fundingWallet: W.FUND, operatorWallets: [W.OP] }, { decimals: 6, tokenProgram: TOK, extensions: [] });
  const v6 = proj.createVersion({}, p6d, { poolDailyRaw: (2400n * 10n ** 6n).toString(), fundedBy: [W.FUND], minDurationDays: 90, maxTermDays: 540 }, { effectiveFrom: TODAY, todayKey: TODAY }).versions[0];
  const locks6 = [normalized(rawEscrow(1, W.MINT3, { amount: (100n * 10n ** 6n).toString() }))];
  const plan6 = rdy.planBudget({ programVersion: v6, locks: locks6, periods: 1, startUnix: NOW });
  assert.strictEqual(plan6.periods[0].obligationRaw, (2400n * 10n ** 6n).toString());
});

(async () => {
  for (const [n, f] of queue) {
    if (!f) { console.log("\n" + n); continue; }
    try { await f(); console.log("  ✓ " + n); pass++; }
    catch (e) { console.log("  ✗ " + n + "\n      " + (e && e.stack ? e.stack.split("\n").slice(0, 3).join("\n      ") : e)); fail++; }
  }

  console.log("\n11/12/13. the mounted routes on memoryKv (operator-gated read, the arm refusal, the public body, the desk section)");

  // ── a minimal Express host for lib/hub/routes.js, no chain, no secrets ───────────────────────
  const KEY = "readiness-test-key";
  const kv = store.memoryKv();
  const balances = {};   // projectId -> raw string, or null for "RPC unavailable"
  const scans = {};      // projectId -> raw scanned escrows (the shape a chain scan returns)
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
    alert: () => {}, secret: () => KEY, verifySignature: () => true,
    sigStore: null, getTx: null, clknPriceInSol: null, payTo: null, clknMint: null, clknDecimals: 9,
    reservedMints: () => ({}), rateLimit: null,
  });
  const srv = await new Promise((resolve) => { const h = app.listen(0, () => resolve(h)); });
  const base = "http://127.0.0.1:" + srv.address().port;
  const ownerHdr = { "x-premium-key": KEY };
  async function getJson(p, headers) { const r = await fetch(base + p, { headers: headers || {} }); let b = null; try { b = await r.json(); } catch (_) {} return { status: r.status, body: b }; }
  async function postJson(p, headers) { const r = await fetch(base + p, { method: "POST", headers: headers || {} }); let b = null; try { b = await r.json(); } catch (_) {} return { status: r.status, body: b }; }
  function registerProject(input, mintInfo) {
    const project = proj.validateProject(input, mintInfo);
    let reg = store.readRegistry(kv);
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
  const ok = (name, cond, detail) => { if (cond) { console.log("  ✓ " + name); pass++; } else { fail++; console.log("  ✗ " + name + (detail ? "\n      " + detail : "")); } };

  try {
    // test 11: fully funded program is ready via the real route.
    const pFull = registerProject({ id: "route-full", label: "Full", symbol: "FULL", mint: W.MINT1, fundingWallet: W.FUND, operatorWallets: [W.OP], accessTier: "comped", accessNote: "ci fixture" }, { decimals: 9, tokenProgram: TOK, extensions: [] });
    const vFull = publishVersion(pFull);
    scans[W.MINT1] = [rawEscrow(1, W.MINT1, { amount: TOKENS(100) })];
    const planned = rdy.planBudget({ programVersion: vFull, locks: [normalized(rawEscrow(1, W.MINT1, { amount: TOKENS(100) }))], periods: 1 });
    balances[W.FUND] = planned.periods[0].obligationRaw;
    let r = await getJson("/api/hub/route-full/readiness", ownerHdr);
    ok("GET /readiness (owner) 200s for a fully funded program", r.status === 200 && r.body.ok === true, JSON.stringify(r.body));
    ok("…and reports ready: true with no block items", r.body.readiness.ready === true && r.body.readiness.items.every((i) => i.status !== "block"), JSON.stringify(r.body.readiness));
    ok("…and the planner's period-1 obligation matches the pure computation exactly", r.body.plan.periods[0].obligationRaw === planned.periods[0].obligationRaw, JSON.stringify(r.body.plan));
    ok("GET /readiness without a key or operator token is 404 (it reveals a funding balance)", (await getJson("/api/hub/route-full/readiness")).status === 404);

    // test 12: a shortfall blocks arming via &arm=1&confirm=go-live and names the item.
    const pShort = registerProject({ id: "route-short", label: "Short", symbol: "SHORT", mint: W.MINT2, fundingWallet: W.FUND, operatorWallets: [W.OP], accessTier: "comped", accessNote: "ci fixture" }, { decimals: 9, tokenProgram: TOK, extensions: [] });
    const vShort = publishVersion(pShort, {}, TODAY);
    scans[W.MINT2] = [rawEscrow(1, W.MINT2, { amount: TOKENS(100) })];
    const plannedShort = rdy.planBudget({ programVersion: vShort, locks: [normalized(rawEscrow(1, W.MINT2, { amount: TOKENS(100) }))], periods: 1 });
    balances[W.FUND] = (BigInt(plannedShort.periods[0].obligationRaw) / 2n).toString();   // half of what is owed
    r = await postJson("/api/hub/route-short/admin?arm=1&confirm=go-live", ownerHdr);
    ok("POST .../admin?arm=1&confirm=go-live is refused (409) when the checklist has a block item", r.status === 409, JSON.stringify(r.body));
    ok("…and names the budget item as the blocker", Array.isArray(r.body.items) && r.body.items.some((i) => i.key === "budget"), JSON.stringify(r.body.items));
    ok("…and the response carries the full readiness object, not just the item", r.body.readiness && r.body.readiness.ready === false);
    balances[W.FUND] = null;   // undo, so no other fixture accidentally shares this wallet's balance
    const restShort = store.read(kv, "route-short", "state", {});
    ok("the project was NOT armed by the refused attempt", eng.readState(restShort).armed === false);

    // test 13a: a dry-run project always blocks arming, whatever else is green.
    const pDry = registerProject({ id: "route-dry", label: "Dry", symbol: "DRYP", mint: W.MINT3, fundingWallet: W.FUND, operatorWallets: [W.OP], accessTier: "comped", accessNote: "dry run — staging rehearsal" }, { decimals: 9, tokenProgram: TOK, extensions: [] });
    const vDry = publishVersion(pDry);
    scans[W.MINT3] = [rawEscrow(1, W.MINT3, { amount: TOKENS(100) })];
    const plannedDry = rdy.planBudget({ programVersion: vDry, locks: [normalized(rawEscrow(1, W.MINT3, { amount: TOKENS(100) }))], periods: 1 });
    balances[W.FUND] = plannedDry.periods[0].obligationRaw;   // fully funded — only the dry-run label should block
    r = await postJson("/api/hub/route-dry/admin?arm=1&confirm=go-live", ownerHdr);
    ok("a dry-run project is refused arming even when fully funded", r.status === 409 && r.body.items.some((i) => i.key === "dry_run"), JSON.stringify(r.body));
    balances[W.FUND] = null;

    // test 13b: the differing reward-asset warning survives on the route too, and is not
    // dismissable by any query field an operator could pass.
    const diffMint = "7LHBcRYosycMBwBqxBHeRiDQohYzpppDALKYVT4TNY5H";
    const pDiff = registerProject({ id: "route-diff", label: "Diff", symbol: "DIFF", mint: diffMint, fundingWallet: W.FUND, operatorWallets: [W.OP], rewardMint: W.MINT1, rewardMintInfo: { decimals: 9, tokenProgram: TOK, extensions: [] } }, { decimals: 9, tokenProgram: TOK, extensions: [] });
    r = await getJson("/api/hub/route-diff/readiness?ignoreRewardWarning=1&dismiss=reward_asset", ownerHdr);
    ok("the reward-asset warning is present on the route and ignores unrecognised query fields", r.status === 200 && r.body.readiness.items.find((i) => i.key === "reward_asset").status === "warn", JSON.stringify(r.body.readiness && r.body.readiness.items));

    // test 13c: the public body carries no readiness data at all.
    r = await getJson("/api/hub/route-full/holder?address=" + encodeURIComponent(W.A));
    const raw = JSON.stringify(r.body || {});
    ok("the public holder view answers without any readiness/plan/budget fields", !/readiness|checklist|planBudget|obligationRaw/i.test(raw), raw.slice(0, 300));
  } finally {
    await new Promise((resolve) => srv.close(resolve));
  }

  // ── desk section: no rate language, no "safe project" summary badge ─────────────────────────
  const deskPath = path.join(__dirname, "..", "public", "hub-desk.html");
  const deskHtml = fs.readFileSync(deskPath, "utf8");
  const htmlSection = deskHtml.split("<!-- LAUNCH READINESS (design Addendum A) — begin")[1];
  const jsSection = deskHtml.split("// ── LAUNCH READINESS (design Addendum A)")[1];
  ok("the desk HTML markers for the new section are both present", !!htmlSection && !!jsSection, "check the HTML comment / JS comment markers in public/hub-desk.html");
  if (htmlSection && jsSection) {
    const htmlBody = htmlSection.split("<!-- LAUNCH READINESS (design Addendum A) — end -->")[0];
    const corpus = [htmlBody, jsSection];
    for (const c of corpus) {
      ok("no APR/APY/per-year rate language in the desk's Launch Readiness section", !T.RATE_LANGUAGE.test(c), c.slice(0, 200));
      ok("no 'safe project' / 'verified project' summary badge language in the same section", !/\b(safe (project|token)|verified project|independently verified|endorsed)\b/i.test(c), c.slice(0, 200));
    }
  }

  console.log(`\n${fail === 0 ? "all passed" : fail + " FAILED"} (${pass} passed)`);
  process.exit(fail ? 1 : 0);
})();
