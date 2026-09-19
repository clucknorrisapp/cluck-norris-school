"use strict";
// lib/hub/demo-fixture.js — the Colosseum judges' no-wallet walkthrough (roadmap W7 acceptance
// target / design §6): a fixture project "demo" (plus "demo-b" to prove isolation) built ENTIRELY
// from the real Hub libs (project.js, engine.js, eligibility.js, ledger.js, teach.js) over
// fabricated addresses and a fabricated funding-wallet read. Every number a judge sees here is
// computed the same way a real project's would be — nothing is hand-typed.
//
// Isolation, by construction, not by a filter that could be forgotten:
//   - This module never touches the real kv, the real hub registry, or a chain RPC.
//   - "demo" / "demo-b" are never written to hubStore's registry, so hubProjects() in server.js
//     (which backs /api/hub, the Lock of Fame and the accrual scheduler in lib/hub/routes.js)
//     can never see them — there is no code path from here into any of those surfaces.
//   - Every object this module returns carries dryRun:true, and money-shaped fields (a "batch",
//     a "receipt") are additionally re-labelled `settlement: { dryRun:true, note:"no transaction
///    was sent" }` — the settle() call below uses a fabricated signature only as an internal
//     journal key, never presented as a real transaction.
//
// Built lazily (get()) and memoized for the life of the process — "at boot or lazily into an
// isolated in-memory store" per the task. reset() clears the memo (tests only).

const crypto = require("crypto");
const bs58 = require("bs58");

const proj = require("./project");
const eng = require("./engine");
const elig = require("./eligibility");
const ledger = require("./ledger");
const teach = require("./teach");

const DAY = 86400;
const HOUR = 3600;
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

// ── fabricated but syntactically real-shaped addresses/signatures ───────────────────────────────
// sha256 of a fixed label, base58-encoded — deterministic across runs (same fixture every boot),
// and never a real keypair or a real transaction.
function fakeAddr(seed) {
  const h = crypto.createHash("sha256").update("clkn-hub-demo:" + seed).digest();
  return bs58.encode(h);
}
function fakeSig(seed) {
  const h1 = crypto.createHash("sha256").update("clkn-hub-demo-sig:" + seed).digest();
  const h2 = crypto.createHash("sha256").update(h1).digest();
  return bs58.encode(Buffer.concat([h1, h2]));
}

const ADDR = {
  demoMint: fakeAddr("demo-mint"), demoFunding: fakeAddr("demo-funding"), demoOperator: fakeAddr("demo-operator"),
  holderA: fakeAddr("demo-holder-a"), holderB: fakeAddr("demo-holder-b"), holderC: fakeAddr("demo-holder-c"),
  escrowA: fakeAddr("demo-escrow-a"), escrowB: fakeAddr("demo-escrow-b"), escrowC: fakeAddr("demo-escrow-c"),
  demobMint: fakeAddr("demob-mint"), demobFunding: fakeAddr("demob-funding"), demobOperator: fakeAddr("demob-operator"),
  holderD: fakeAddr("demob-holder-d"), escrowD: fakeAddr("demob-escrow-d"),
};

const dayKeyOf = (unix) => new Date(Number(unix) * 1000).toISOString().slice(0, 10);
const alignHour = (unix) => Math.floor(Number(unix) / HOUR) * HOUR;

// A single-cliff Jupiter Lock escrow — everything releases at `cliffTime`, nothing before. The
// exact shape lib/cuna-staking.normalizeEscrow produces from a real chain read (see its header).
function mkLock({ escrow, mint, recipient, creator, firstSeenAt, termDays, amountRaw }) {
  const cliffTime = firstSeenAt + termDays * DAY;
  return {
    escrow, mint, recipient, creator,
    cancelMode: 0, cancelledAt: 0, vestingStartTime: cliffTime,
    firstSeenAt, cliffTime, fullyVestedAt: cliffTime, declaredEndAt: cliffTime,
    totalRaw: String(amountRaw), claimedRaw: "0",
    cliffUnlockRaw: String(amountRaw), perPeriodRaw: "0", frequency: 1, periods: 0,
    atRiskRaw: String(amountRaw), perDayRaw: "0",
  };
}

// Run the real accrual engine, one pure hourly slice at a time, over a fixed lock list. Returns
// the `days` ledger exactly as lib/hub/engine.accrualTick would have written it, hour by hour.
function accrueHours({ project, state, locks, fromUnix, toUnixInclusive, startDays = {} }) {
  let days = { ...startDays };
  for (let t = fromUnix; t <= toUnixInclusive; t += HOUR) {
    const res = eng.accrueSlice({ project, state, days, locks, ledgerKnown: locks.length, nowUnix: t });
    if (res.ok) days = { ...days, [res.key]: res.row };
  }
  return days;
}

function termLabel(days) {
  if (days % 30 === 0) { const m = days / 30; return `${m}-month term`; }
  return `${days}-day term`;
}

// ── one project's fixture ────────────────────────────────────────────────────────────────────
function buildDemo(nowRaw) {
  const now = alignHour(nowRaw);
  const startedAt = now - 96 * HOUR;              // "armed" 4 days ago
  const batchCutoff = now - 24 * HOUR;             // batch #1 covers the first 3 days
  const startDay = dayKeyOf(startedAt);

  const mintInfo = { decimals: 6, tokenProgram: TOKEN_PROGRAM, extensions: [] };
  const project0 = proj.validateProject({
    id: "demo", label: "Demo Community", symbol: "DEMO", mint: ADDR.demoMint, fundingWallet: ADDR.demoFunding,
    operatorWallets: [ADDR.demoOperator], accessTier: "comped", accessNote: "Colosseum judge walkthrough — fixture, no real funds",
  }, mintInfo);
  const project = { ...project0, status: "approved", approvedAt: startedAt, approvedBy: "owner", dryRun: true };

  const terms = { poolDailyRaw: "100000000000", minDurationDays: 90, maxTermDays: 540, minLockRaw: "0",
    cancelableAllowed: false, payoutSchedule: "weekly", vesting: "any" };
  const state0 = proj.createVersion({}, project, terms, { effectiveFrom: startDay, todayKey: startDay });
  const version = state0.versions[0];
  const state = { versions: state0.versions, armed: true, startedAt };

  // Three holders. A and B lock the SAME amount for different committed terms — the 6x ceiling
  // shows up as exactly a 6x difference in accrual, not a hand-typed number. C locks a real
  // amount for too short a term and is excluded by the same rule, publicly, with its code.
  const AMOUNT = "50000000000";   // 50,000 DEMO at 6 decimals
  const lockA = mkLock({ escrow: ADDR.escrowA, mint: ADDR.demoMint, recipient: ADDR.holderA, creator: ADDR.holderA, firstSeenAt: startedAt, termDays: 90, amountRaw: AMOUNT });
  const lockB = mkLock({ escrow: ADDR.escrowB, mint: ADDR.demoMint, recipient: ADDR.holderB, creator: ADDR.holderB, firstSeenAt: startedAt, termDays: 540, amountRaw: AMOUNT });
  const lockC = mkLock({ escrow: ADDR.escrowC, mint: ADDR.demoMint, recipient: ADDR.holderC, creator: ADDR.holderC, firstSeenAt: startedAt, termDays: 30, amountRaw: "1000000000" });
  const locks = [lockA, lockB, lockC];

  const cfg = eng.configFor({ project, state, nowUnix: now });

  // Accrual: batch-1 window (72 hourly slices), then a further 24 hours left un-batched so the
  // funding step has something honest to show as "owed but not yet drawn into a batch".
  const days1 = accrueHours({ project, state, locks, fromUnix: startedAt, toUnixInclusive: batchCutoff - HOUR });
  const daysAll = accrueHours({ project, state, locks, fromUnix: batchCutoff, toUnixInclusive: now, startDays: days1 });

  // Batch #1: build from the partition (real math — accrued/available/reserved/paidApplied),
  // over the first window only.
  const part1 = ledger.partition({ projectId: "demo", days: days1, batches: {}, journal: {} });
  const periods1 = Object.keys(days1).sort();
  const batch1 = ledger.buildBatch({ projectId: "demo", programVersion: version, periods: periods1, part: part1, batchId: "demo-batch-1", nowUnix: batchCutoff });

  // "Sign" it — a labelled DRY RUN settlement. The fabricated signature is only an internal
  // journal key (xferKeyOf); it is never shown to a judge as a real transaction. Receipt ids are
  // keyed off the HOLDER (a/b), never wallet-sort order, so "Holder A's receipt" is always rcpt-a.
  const walletToKey = { [lockA.recipient]: "a", [lockB.recipient]: "b" };
  let journal = {};
  const receiptIds = {};
  for (const wallet of Object.keys(batch1.amounts)) {
    const sig = fakeSig("batch1:" + wallet);
    const r = ledger.settle({ journal, projectId: "demo", batch: batch1, wallet,
      transfer: { sig, instructionIndex: 0, amountRaw: batch1.amounts[wallet], slot: 0, verifiedBy: "dry-run (fixture — no transaction was sent)" }, nowUnix: batchCutoff });
    if (r.ok) { journal = r.journal; receiptIds[wallet] = "rcpt-" + (walletToKey[wallet] || wallet.slice(0, 4).toLowerCase()); }
  }
  const batches = { [batch1.id]: batch1 };

  // Funding: obligations/reserved from the FULL ledger (including the un-batched 24h), a fixture
  // "observed" balance deliberately short of it so the coverage/shortfall story is honest, not a
  // green checkmark by construction.
  const partAll = ledger.partition({ projectId: "demo", days: daysAll, batches, journal });
  const fundingNoObserved = ledger.fundingStatus({ part: partAll, batches, journal, projectId: "demo", observed: null });
  const obligations = BigInt(fundingNoObserved.obligationsRaw);
  const observedRaw = (obligations * 2n) / 5n;   // ~40% funded — a real, visible shortfall
  const funding = { ...ledger.fundingStatus({ part: partAll, batches, journal, projectId: "demo", observed: { balanceRaw: observedRaw.toString(), at: now } }), dryRun: true, observedIsFixture: true, observedNote: "This balance is a fixture number for the walkthrough, not a live chain read." };

  const invariantViolations = ledger.checkInvariant(partAll);

  const teachBlock = teach.teachBlock({ project, version, funding });

  const holderInfo = (key, label, lock, termDays) => {
    const rec = elig.eligibilityRecord(lock, cfg, now);
    const w = lock.recipient;
    const accruedRaw = String(partAll[w] ? BigInt(partAll[w].accruedRaw) : 0n);
    const multiplier = Math.min(termDays, terms.maxTermDays) / terms.minDurationDays;
    return { key, label, wallet: w, escrow: lock.escrow, termDays, termLabel: termLabel(termDays),
      multiplier: rec.qualifies ? multiplier : 0, qualifies: rec.qualifies, reasons: rec.reasons, numbers: rec.numbers,
      accruedRaw, receiptId: receiptIds[w] || null };
  };
  const holders = [
    holderInfo("A", "Holder A", lockA, 90),
    holderInfo("B", "Holder B", lockB, 540),
    holderInfo("C", "Holder C", lockC, 30),
  ];

  const batchView = ledger.batchView(batch1, journal);
  const batchOut = {
    id: batch1.id, programVersion: batch1.programVersion, programHash: batch1.programHash,
    periods: batch1.periods, count: batch1.count, totalRaw: batch1.totalRaw, state: batchView.state,
    rows: holders.filter((h) => batch1.amounts[h.wallet]).map((h) => ({
      wallet: h.wallet, label: h.label, amountRaw: batch1.amounts[h.wallet],
      state: (batchView.rows[h.wallet] && batchView.rows[h.wallet].state) || "pending", receiptId: h.receiptId,
    })),
    settlement: { dryRun: true, note: "no transaction was sent" },
  };

  const receipts = {};
  for (const h of holders) {
    if (!h.receiptId) continue;
    const r = ledger.receipt({ projectId: "demo", batch: batch1, wallet: h.wallet, journal, project });
    receipts[h.receiptId] = { ...r, holderLabel: h.label,
      claims: { paymentVerified: false, calculationReproducible: null }, // never claim a real chain verification for a fixture
      settlement: { dryRun: true, note: "no transaction was sent" } };
  }

  return {
    dryRun: true,
    project: { id: project.id, label: project.label, symbol: project.symbol, mint: project.mint, decimals: project.decimals,
      rewardMint: project.rewardMint, rewardDecimals: project.rewardDecimals, fundingWallet: project.fundingWallet,
      operatorWallets: project.operatorWallets, status: project.status, dryRun: true },
    version,
    teach: teachBlock,
    holders, funding, batch: batchOut, receipts,
    invariantHolds: invariantViolations.length === 0,
    generatedAt: now,
  };
}

// The second, isolated project. Its own registry slot, its own ledger, its own holder — never
// merged with "demo". No batch/receipt needed; the point of this one is only that it does NOT
// show up when you ask for "demo", and "demo"'s holders do not show up here.
function buildDemoB(nowRaw) {
  const now = alignHour(nowRaw);
  const startedAt = now - 48 * HOUR;
  const startDay = dayKeyOf(startedAt);

  const mintInfo = { decimals: 6, tokenProgram: TOKEN_PROGRAM, extensions: [] };
  const project0 = proj.validateProject({
    id: "demo-b", label: "Demo Community B", symbol: "DEMOB", mint: ADDR.demobMint, fundingWallet: ADDR.demobFunding,
    operatorWallets: [ADDR.demobOperator], accessTier: "comped", accessNote: "Colosseum isolation proof — fixture, no real funds",
  }, mintInfo);
  const project = { ...project0, status: "approved", approvedAt: startedAt, approvedBy: "owner", dryRun: true };

  const terms = { poolDailyRaw: "20000000000", minDurationDays: 90, maxTermDays: 540, minLockRaw: "0",
    cancelableAllowed: false, payoutSchedule: "weekly", vesting: "any" };
  const state0 = proj.createVersion({}, project, terms, { effectiveFrom: startDay, todayKey: startDay });
  const version = state0.versions[0];
  const state = { versions: state0.versions, armed: true, startedAt };

  const lockD = mkLock({ escrow: ADDR.escrowD, mint: ADDR.demobMint, recipient: ADDR.holderD, creator: ADDR.holderD, firstSeenAt: startedAt, termDays: 180, amountRaw: "20000000000" });
  const cfg = eng.configFor({ project, state, nowUnix: now });
  const days = accrueHours({ project, state, locks: [lockD], fromUnix: startedAt, toUnixInclusive: now });
  const part = ledger.partition({ projectId: "demo-b", days, batches: {}, journal: {} });

  const rec = elig.eligibilityRecord(lockD, cfg, now);
  const accruedRaw = String(part[lockD.recipient] ? BigInt(part[lockD.recipient].accruedRaw) : 0n);
  const holderD = { key: "D", label: "Holder D", wallet: lockD.recipient, escrow: lockD.escrow, termDays: 180, termLabel: termLabel(180),
    multiplier: rec.qualifies ? 180 / terms.minDurationDays : 0, qualifies: rec.qualifies, reasons: rec.reasons, numbers: rec.numbers, accruedRaw };

  return {
    dryRun: true,
    project: { id: project.id, label: project.label, symbol: project.symbol, mint: project.mint, decimals: project.decimals,
      rewardMint: project.rewardMint, rewardDecimals: project.rewardDecimals, fundingWallet: project.fundingWallet,
      operatorWallets: project.operatorWallets, status: project.status, dryRun: true },
    version,
    holders: [holderD], batch: null, receipts: {},
    isolationNote: "This project has its own store, its own ledger and its own holder. Nothing here is shared with \"demo\" — not the wallet, not the accrual, not a batch.",
    generatedAt: now,
  };
}

let cached = null;
function build(nowUnix) {
  const now = Number.isFinite(nowUnix) ? Number(nowUnix) : Math.floor(Date.now() / 1000);
  return { demo: buildDemo(now), "demo-b": buildDemoB(now) };
}
function get() { if (!cached) cached = build(); return cached; }
function reset() { cached = null; }

module.exports = { build, get, reset, ADDR };
