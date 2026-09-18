#!/usr/bin/env node
"use strict";
// Project Hub — W3 integration gate (docs/COLOSSEUM_ROADMAP.md §W3): the settlement journal
// dual-write in POST /api/hub/:project/payout. Every case here is a way the journal-first ordering
// (lib/hub/README.md "the receipt gap") could pay twice, journal a transfer it never verified, or
// silently drop the legacy safety net that already stops a double-pay today.
//
// No HTTP, no network — the same DI style every other hub test uses (store.memoryKv, a fake
// `getTx`), plus a minimal in-process Express stand-in so the fault-injection cases exercise the
// REAL route closures in lib/hub/routes.js rather than a re-implementation of their logic.
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const store = require("../lib/hub/store");
const proj = require("../lib/hub/project");
const L = require("../lib/hub/ledger");
const attempts = require("../lib/hub/attempts");
const settle = require("../lib/hub/settle");
const payoutVerify = require("../lib/payout-verify");
const pay = require("../lib/cuna-payout");
const routes = require("../lib/hub/routes");
const eng = require("../lib/hub/engine");
const operator = require("../lib/hub/operator");
const access = require("../lib/hub/access");

let pass = 0, fail = 0;
const queue = [];
const t = (n, f) => queue.push([n, f]);
const section = (n) => queue.push([n, null]);

const W = {
  A: "4Gccq9pESbfNeKiW7M7qi587pYYiaQ4T4zLv3LcriGPs", B: "5WKKoF7LcDRsSfTYxccSEj7hejh9U5ZqcX74C7E5X7HG",
  FUND: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", MINT1: "4yro2xbCxMFVvygCsj5FZMgZnVCb8EqcbPGTbSGCgDBc",
  PAYER: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", DEST1: "6uGpiHY7VfCryFvcz1QQg7oDG1cUuXTRVvzXBqRQqXpJ", DEST2: "8kQTLwvxJd8ZoEHVEmz8AzE5cVQyMYccUFEbEg5xJ5CY",
};
const TOK = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const SIG = (n) => "5" + Array.from({ length: 87 }, (_, i) => "abcdefghjkmnpqrstuvwxyz"[(i * 7 + n) % 23]).join("");
const NOW = 1_800_000_000;
const days = (credits, key = "2026-09-17T00") => ({ [key]: { credits, at: NOW - 3600 } });

const mkProject = (id, mint, over = {}) => proj.approveProject({}, proj.validateProject({ id, label: id.toUpperCase(), symbol: id.toUpperCase().slice(0, 6), mint, fundingWallet: W.FUND, operatorWallets: [W.A], ...over }, { decimals: 9, tokenProgram: TOK, extensions: [] }), { nowUnix: NOW })[id];
const mkVersion = (project) => proj.createVersion({}, project, { poolDailyRaw: "1000000000000" }, { effectiveFrom: "2026-09-17", todayKey: "2026-09-17" });

// ── synthetic jsonParsed transactions (the RPC shape getTransaction returns) ────────────────────
// SRC_ATA: the token account every fixture transfer is SOURCED from. Its OWNER (never the mere
// "authority" on the instruction, which can be a delegate) is what adv P0-1 requires to equal the
// project's funding wallet (W.FUND, which is also W.PAYER's value in this file) or a listed
// fundedBy wallet — see lib/payout-verify.js transfersIntoWallet. `sourceOwner` lets a test build
// the ATTACK shape: the same instruction, but sourced from a wallet that is NOT the funding wallet.
const SRC_ATA = "SrcAta1111111111111111111111111111111";
const tokenTransfer = (destination, amount, extra = {}) => ({ program: "spl-token", parsed: { type: "transfer", info: { source: SRC_ATA, destination, authority: W.PAYER, amount: String(amount) } }, ...extra });
const bal = (accountIndex, owner, amount, mint = W.MINT1) => ({ accountIndex, mint, owner, uiTokenAmount: { amount: String(amount) } });
// One recipient, one top-level transfer instruction — the exact shape lib/whirlpool-vault.js
// payoutSpl (prepareOne) and, usually, the airdropper construct.
function txSingle({ wallet = W.A, amountRaw = "1000000000", slot = 42, err = null, sourceOwner = W.FUND } = {}) {
  return {
    slot, blockTime: NOW,
    meta: { err, preTokenBalances: [bal(0, sourceOwner, "999999999999999"), bal(1, wallet, 0)], postTokenBalances: [bal(1, wallet, amountRaw)] },
    transaction: { message: { accountKeys: [SRC_ATA, W.DEST1], instructions: [tokenTransfer(W.DEST1, amountRaw)] } },
  };
}
// Two recipients, two top-level instructions, ONE signature — the airdropper's batched-transaction
// shape (public/airdrop-engine.js planBatches).
function txBatched({ a = { wallet: W.A, amountRaw: "1000000000" }, b = { wallet: W.B, amountRaw: "2000000000" }, sourceOwner = W.FUND } = {}) {
  return {
    slot: 43, blockTime: NOW,
    meta: { err: null, preTokenBalances: [bal(0, sourceOwner, "999999999999999"), bal(1, a.wallet, 0), bal(2, b.wallet, 0)], postTokenBalances: [bal(1, a.wallet, a.amountRaw), bal(2, b.wallet, b.amountRaw)] },
    transaction: { message: { accountKeys: [SRC_ATA, W.DEST1, W.DEST2], instructions: [tokenTransfer(W.DEST1, a.amountRaw), tokenTransfer(W.DEST2, b.amountRaw)] } },
  };
}
// A CPI-wrapped transfer: the top-level instruction is some other program; the actual SPL transfer
// is an inner instruction. This is also the "DEX-shaped" fixture: an AMM's own inner instruction
// crediting the holder from ITS pool account (sourceOwner defaults to a wallet that is NOT the
// funding wallet — a real DEX buy the holder made herself), used by adv-P0-1's test.
function txInner({ wallet = W.A, amountRaw = "1000000000", sourceOwner = W.DEST2 } = {}) {
  return {
    slot: 44, blockTime: NOW,
    meta: { err: null, preTokenBalances: [bal(0, sourceOwner, "999999999999999"), bal(2, wallet, 0)], postTokenBalances: [bal(2, wallet, amountRaw)],
      innerInstructions: [{ index: 0, instructions: [tokenTransfer(W.DEST1, amountRaw)] }] },
    transaction: { message: { accountKeys: [SRC_ATA, "SomeOtherProgram1111111111111111111111111", W.DEST1], instructions: [{ program: "some-wrapper", parsed: null }] } },
  };
}
// Two transfers into two DIFFERENT token accounts both owned by the SAME wallet, in one signature —
// ambiguous: which one is "this row's" payment cannot be told apart from chain data alone.
function txAmbiguous({ wallet = W.A, sourceOwner = W.FUND } = {}) {
  return {
    slot: 45, blockTime: NOW,
    meta: { err: null, preTokenBalances: [bal(0, sourceOwner, "999999999999999"), bal(1, wallet, 0), bal(2, wallet, 0)], postTokenBalances: [bal(1, wallet, "50"), bal(2, wallet, "50")] },
    transaction: { message: { accountKeys: [SRC_ATA, W.DEST1, W.DEST2], instructions: [tokenTransfer(W.DEST1, "50"), tokenTransfer(W.DEST2, "50")] } },
  };
}

section("1. locateTransferInstruction — the chain's own identity, never a guessed index");

t("a single-recipient transaction locates instructionIndex 0, innerIndex null", () => {
  const r = payoutVerify.locateTransferInstruction(txSingle({ wallet: W.A, amountRaw: "1000000000" }), { mint: W.MINT1, wallet: W.A, nowUnix: NOW });
  // sourceWallet (Round 3 N3): txSingle's default sourceOwner is W.FUND.
  assert.deepStrictEqual(r, { instructionIndex: 0, innerIndex: null, amountRaw: "1000000000", slot: 42, sourceWallet: W.FUND });
});

t("a batched (two-recipient) transaction locates each wallet's OWN instruction — no cross-contamination", () => {
  const tx = txBatched({ a: { wallet: W.A, amountRaw: "1000000000" }, b: { wallet: W.B, amountRaw: "2000000000" } });
  const ra = payoutVerify.locateTransferInstruction(tx, { mint: W.MINT1, wallet: W.A, nowUnix: NOW });
  const rb = payoutVerify.locateTransferInstruction(tx, { mint: W.MINT1, wallet: W.B, nowUnix: NOW });
  assert.strictEqual(ra.instructionIndex, 0); assert.strictEqual(ra.amountRaw, "1000000000");
  assert.strictEqual(rb.instructionIndex, 1); assert.strictEqual(rb.amountRaw, "2000000000");
});

t("a CPI (inner-instruction) transfer locates instructionIndex + innerIndex", () => {
  const r = payoutVerify.locateTransferInstruction(txInner({ wallet: W.A, amountRaw: "777" }), { mint: W.MINT1, wallet: W.A, nowUnix: NOW });
  // sourceWallet (Round 3 N3): txInner's default sourceOwner is W.DEST2.
  assert.deepStrictEqual(r, { instructionIndex: 0, innerIndex: 0, amountRaw: "777", slot: 44, sourceWallet: W.DEST2 });
});

t("two transfers to the same wallet in one signature are AMBIGUOUS — never a guess, returns null", () => {
  assert.strictEqual(payoutVerify.locateTransferInstruction(txAmbiguous({ wallet: W.A }), { mint: W.MINT1, wallet: W.A, nowUnix: NOW }), null);
});

t("a failed transaction, or no match, returns null — never a fabricated identity", () => {
  assert.strictEqual(payoutVerify.locateTransferInstruction(txSingle({ err: { InstructionError: [0, "Custom"] } }), { mint: W.MINT1, wallet: W.A }), null);
  assert.strictEqual(payoutVerify.locateTransferInstruction(txSingle({ wallet: W.A, amountRaw: "1000000000" }), { mint: W.MINT1, wallet: W.B, nowUnix: NOW }), null);
  assert.strictEqual(payoutVerify.locateTransferInstruction(null, { mint: W.MINT1, wallet: W.A }), null);
});

section("2. lib/hub/settle.js settleAndPersist — the journal + attempt dual-write, pure");

t("a located transfer settles the journal and stamps the attempt 'settled'", () => {
  const P = mkProject("alpha", W.MINT1); const V = mkVersion(P).versions[0];
  const part = L.partition({ projectId: "alpha", days: days({ [W.A]: "1000000000" }), batches: {}, journal: {} });
  const batch = L.buildBatch({ projectId: "alpha", programVersion: V, periods: [], part, batchId: "b1", nowUnix: NOW });
  const r = settle.settleAndPersist({ projectId: "alpha", journal: {}, batches: { b1: batch }, batchId: "b1", wallet: W.A, sig: SIG(1), tx: txSingle({ wallet: W.A, amountRaw: "1000000000" }), mint: W.MINT1, nowUnix: NOW });
  assert.strictEqual(r.journaled, true);
  assert.strictEqual(Object.keys(r.journal).length, 1);
  const stamped = r.batches.b1.attempts[W.A];
  assert.strictEqual(stamped.state, "settled"); assert.strictEqual(stamped.sig, SIG(1)); assert.strictEqual(stamped.xferKey, r.xferKey);
});

t("a transfer that cannot be attributed to one instruction is NOT journaled — batches/journal come back unchanged", () => {
  const P = mkProject("alpha", W.MINT1); const V = mkVersion(P).versions[0];
  const part = L.partition({ projectId: "alpha", days: days({ [W.A]: "50" }), batches: {}, journal: {} });
  const batch = L.buildBatch({ projectId: "alpha", programVersion: V, periods: [], part, batchId: "b2", nowUnix: NOW });
  const r = settle.settleAndPersist({ projectId: "alpha", journal: {}, batches: { b2: batch }, batchId: "b2", wallet: W.A, sig: SIG(2), tx: txAmbiguous({ wallet: W.A }), mint: W.MINT1, nowUnix: NOW });
  assert.strictEqual(r.journaled, false);
  assert.deepStrictEqual(r.journal, {});
  assert.strictEqual(r.batches.b2.attempts, undefined, "no attempt fabricated for an un-journaled row");
});

t("the same transfer settled twice is idempotent — one event, not two", () => {
  const P = mkProject("alpha", W.MINT1); const V = mkVersion(P).versions[0];
  const part = L.partition({ projectId: "alpha", days: days({ [W.A]: "1000000000" }), batches: {}, journal: {} });
  const batch = L.buildBatch({ projectId: "alpha", programVersion: V, periods: [], part, batchId: "b3", nowUnix: NOW });
  const first = settle.settleAndPersist({ projectId: "alpha", journal: {}, batches: { b3: batch }, batchId: "b3", wallet: W.A, sig: SIG(3), tx: txSingle({ wallet: W.A, amountRaw: "1000000000" }), mint: W.MINT1, nowUnix: NOW });
  const second = settle.settleAndPersist({ projectId: "alpha", journal: first.journal, batches: first.batches, batchId: "b3", wallet: W.A, sig: SIG(3), tx: txSingle({ wallet: W.A, amountRaw: "1000000000" }), mint: W.MINT1, nowUnix: NOW + 5 });
  assert.strictEqual(second.journaled, true); assert.strictEqual(second.idempotent, true);
  assert.strictEqual(Object.keys(second.journal).length, 1);
});

t("a transfer already claimed by another project's row is refused, naming the owner — never applied here", () => {
  const A = mkProject("alpha", W.MINT1); const VA = mkVersion(A).versions[0];
  const B = mkProject("beta", W.MINT1); const VB = mkVersion(B).versions[0];
  const partA = L.partition({ projectId: "alpha", days: days({ [W.A]: "1000000000" }), batches: {}, journal: {} });
  const ba = L.buildBatch({ projectId: "alpha", programVersion: VA, periods: [], part: partA, batchId: "ba", nowUnix: NOW });
  const partB = L.partition({ projectId: "beta", days: days({ [W.A]: "1000000000" }), batches: {}, journal: {} });
  const bb = L.buildBatch({ projectId: "beta", programVersion: VB, periods: [], part: partB, batchId: "bb", nowUnix: NOW });
  const first = settle.settleAndPersist({ projectId: "alpha", journal: {}, batches: { ba }, batchId: "ba", wallet: W.A, sig: SIG(4), tx: txSingle({ wallet: W.A, amountRaw: "1000000000" }), mint: W.MINT1, nowUnix: NOW });
  const second = settle.settleAndPersist({ projectId: "beta", journal: first.journal, batches: { bb }, batchId: "bb", wallet: W.A, sig: SIG(4), tx: txSingle({ wallet: W.A, amountRaw: "1000000000" }), mint: W.MINT1, nowUnix: NOW });
  assert.strictEqual(second.journaled, false); assert.strictEqual(second.why, "transfer_already_consumed");
  assert.deepStrictEqual(second.owner, { projectId: "alpha", batchId: "ba", wallet: W.A });
});

section("3. store.writeManyVerifiedMixed — all-or-nothing across the journal + per-project keys");

t("a fault on the journal key lands NEITHER the journal nor the project part", () => {
  const kv = store.memoryKv({}, { failOn: (k) => k === store.JOURNAL_KEY });
  assert.throws(() => store.writeManyVerifiedMixed(kv, "alpha", { batches: { x: 1 } }, { [store.JOURNAL_KEY]: { y: 2 } }), /injected fault/);
  assert.deepStrictEqual(store.read(kv, "alpha", "batches", null), null);
  assert.deepStrictEqual(store.readJournal(kv), {});
});

t("with no fault, all keys land together", () => {
  const kv = store.memoryKv();
  // Round 2 #6 (docs/HUB_JOURNAL_VERIFY_2026-09-18.md): readJournal now ignores anything that is
  // not shaped like a real settlement entry (store.looksLikeJournalEntry) — the placeholder `{z:
  // 3}` this test used to write no longer round-trips, so a real-shaped entry is used instead; the
  // point of the test (a raw journal key lands atomically alongside the per-project parts) is
  // unchanged.
  const entry = { xferKey: "settle:" + SIG(9) + ":0", projectId: "alpha", batchId: "b1", wallet: W.A, amountRaw: "3", appliedRaw: "3", excessRaw: "0" };
  assert.strictEqual(store.writeManyVerifiedMixed(kv, "alpha", { batches: { x: 1 }, paid: { y: 2 } }, { [store.JOURNAL_KEY]: { [entry.xferKey]: entry } }), true);
  assert.deepStrictEqual(store.read(kv, "alpha", "batches", null), { x: 1 });
  assert.deepStrictEqual(store.read(kv, "alpha", "paid", null), { y: 2 });
  assert.deepStrictEqual(store.readJournal(kv), { [entry.xferKey]: entry });
});

section("4. owedNow consults the journal — never re-offers a settled row, never nets across wallets");

t("a wallet with a journal event for this project's batch is treated as settled even if `paid` never got the write", () => {
  const journal = { k1: { projectId: "alpha", batchId: "b1", wallet: W.A, amountRaw: "1000000000", appliedRaw: "1000000000", excessRaw: "0" } };
  const owed = pay.owedNow({ days: days({ [W.A]: "1000000000" }), paid: {}, pending: {}, journal, projectId: "alpha" });
  assert.strictEqual(owed[W.A].toString(), "0");
});

t("a journal event for a DIFFERENT project never reduces this project's owed amount", () => {
  const journal = { k1: { projectId: "beta", batchId: "b1", wallet: W.A, amountRaw: "1000000000", appliedRaw: "1000000000", excessRaw: "0" } };
  const owed = pay.owedNow({ days: days({ [W.A]: "1000000000" }), paid: {}, pending: {}, journal, projectId: "alpha" });
  assert.strictEqual(owed[W.A].toString(), "1000000000");
});

t("callers that pass no journal see exactly the pre-W3 behavior", () => {
  const owed = pay.owedNow({ days: days({ [W.A]: "1000000000" }), paid: {}, pending: {} });
  assert.strictEqual(owed[W.A].toString(), "1000000000");
});

// ── section 5+: the REAL route, invoked directly (no HTTP/network — a fake Express `app` that
// just records the handler closures, so these exercise lib/hub/routes.js's actual code) ──────────
function fakeApp() {
  // path -> [fn, fn, ...] — app.all/app.get both just need "the" chain; the route itself branches
  // on req.method, exactly as Express would call it. N1 (Round 3) added a real middleware
  // (`limited(...)`) ahead of the /payout handler, so this now stores and RUNS every fn given,
  // Express-style (each fn gets its own `next`), rather than assuming there is exactly one.
  const handlers = new Map();
  const register = (p, ...fns) => handlers.set(p, fns);
  return { get: register, all: register, handlers };
}
function fakeRes() {
  const r = { statusCode: 200 };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = () => {};
  return r;
}
async function call(app, path, { method = "GET", params = {}, query = {}, body = {}, headers = {} } = {}) {
  const fns = app.handlers.get(path);
  if (!fns) throw new Error(`no handler mounted for ${path}`);
  const req = { method, params, query, body, headers, cluckDirect: false };
  const res = fakeRes();
  for (const fn of fns) {
    let calledNext = false;
    await fn(req, res, () => { calledNext = true; });
    if (!calledNext) break;   // the middleware/handler sent a response and never called next()
  }
  return res;
}

// A fake managed-payer vault: mirrors lib/whirlpool-vault.js payoutSpl's onPaid protocol exactly
// (pending:true BEFORE "broadcast", then either a landed row with no `pending`, or a still-pending
// row with `pending:true` again) — controllable per test via `outcomes` = { [wallet]: "land"|"stall" }.
function fakeVault(outcomes = {}) {
  return {
    payoutSpl: async ({ recipients, dryRun, onPaid }) => {
      if (dryRun) return { action: "would-pay", recipients };
      const paidRows = [], pendingRows = [];
      for (const r of recipients) {
        const sig = SIG(1000 + recipients.indexOf(r) + (fakeVault._n = (fakeVault._n || 0) + 1));
        onPaid({ wallet: r.wallet, amountUi: r.amountUi, sig, pending: true });
        if ((outcomes[r.wallet] || "land") === "land") { onPaid({ wallet: r.wallet, sig }); paidRows.push({ wallet: r.wallet, sig, amountUi: r.amountUi }); }
        else { onPaid({ wallet: r.wallet, sig, pending: true, error: "confirm timed out" }); pendingRows.push({ wallet: r.wallet, sig, amountUi: r.amountUi }); }
      }
      return { action: paidRows.length && !pendingRows.length ? "paid" : "partial", paid: paidRows, pending: pendingRows, failed: [] };
    },
  };
}

// A kv that reports a FAILED verified write WITHOUT throwing — the real lib/kvstore.js contract
// (setManyVerified never throws; it returns false when the on-disk read-back does not match, e.g.
// a full or detached volume). store.memoryKv's `failOn` throws instead (it stands in for a hard
// process crash mid-write, used above for the "the whole request errors out, nothing lands"
// cases) — this wraps a real memoryKv to exercise the OTHER production path: the route's own
// `if (!writeManyVerifiedMixed(...))` / `else { alert(...) }` graceful-degradation handling.
function flakyKv(kv, { failOnKeys, failOnPrefix } = {}) {
  return {
    ...kv,
    setManyVerified: (entries) => {
      const keys = Object.keys(entries);
      const bad = (failOnKeys && keys.some((k) => failOnKeys.has(k))) || (failOnPrefix && keys.some((k) => k.startsWith(failOnPrefix)));
      return bad ? false : kv.setManyVerified(entries);
    },
  };
}

function mountFor({ kv, getTx = async () => null, vault = fakeVault(), alerts = [], nowUnix = () => NOW, scanDeps = async () => ({ scan: async () => [] }), adminAuthOK = () => true, secret = "test-secret", rateLimit = null, reservedMints = null } = {}) {
  const app = fakeApp();
  routes.mount(app, {
    kv, adminAuthOK, publicErrMsg: (e) => (e && e.message) || String(e), secret,
    vault, connection: () => ({
      getSignatureStatuses: async () => ({ value: [] }), getParsedTokenAccountsByOwner: async () => ({ value: [] }),
      // /api/hub-registry's readMint reads this — a fixed valid mint account for any pubkey asked,
      // matching seedProject's own assumed { decimals: 9, tokenProgram: TOK }.
      getParsedAccountInfo: async () => ({ value: { owner: TOK, data: { parsed: { type: "mint", info: { decimals: 9, extensions: [] } } } } }),
    }),
    scanDeps, getTx, alert: (m) => alerts.push(m),
    // The route's own clock, injected so a fixture's fabricated `blockTime: NOW` agrees with "now"
    // (adv P0-1's future-blockTime refusal in lib/payout-verify.js compares against it).
    nowUnix, rateLimit, reservedMints,
  });
  return app;
}
// N1 (docs/HUB_JOURNAL_VERIFY_2026-09-18.md, Round 3): a minimal per-bucket counting limiter, the
// same DI shape lib/hub/routes.js's `limited(bucket, opts)` expects — refuses past `opts.max`
// calls to the SAME bucket, resettable between tests by constructing a fresh one.
function fakeRateLimit() {
  const counts = new Map();
  return (bucket, opts) => (req, res, next) => {
    const n = (counts.get(bucket) || 0) + 1;
    counts.set(bucket, n);
    if (n > (opts && opts.max)) return res.status(429).json({ ok: false, error: "rate_limited" });
    next();
  };
}
function seedProject(kv, id, mint, over = {}) {
  const p = proj.validateProject({ id, label: id.toUpperCase(), symbol: id.toUpperCase().slice(0, 6), mint, fundingWallet: W.FUND, operatorWallets: [W.A], ...over }, { decimals: 9, tokenProgram: TOK, extensions: [] });
  const reg = proj.approveProject(store.readRegistry(kv) || {}, p, { nowUnix: NOW });
  store.writeRegistry(kv, reg);
  const state = proj.createVersion({}, reg[id], { poolDailyRaw: "1000000000000" }, { effectiveFrom: "2026-09-17", todayKey: "2026-09-17" });
  store.write(kv, id, "state", state);
  return reg[id];
}
// Two projects, DIFFERENT locked mints (approveProject enforces uniqueness on `mint`, not
// `rewardMint`), SAME reward mint — the adv-P0-2(a) shape: one transfer of the shared reward
// asset can be aimed at either project's row.
function seedProjectReward(kv, id, mint, rewardMint, over = {}) {
  const p = proj.validateProject({ id, label: id.toUpperCase(), symbol: id.toUpperCase().slice(0, 6), mint, rewardMint, rewardMintInfo: { decimals: 9, tokenProgram: TOK, extensions: [] }, fundingWallet: W.FUND, operatorWallets: [W.A], ...over }, { decimals: 9, tokenProgram: TOK, extensions: [] });
  const reg = proj.approveProject(store.readRegistry(kv) || {}, p, { nowUnix: NOW });
  store.writeRegistry(kv, reg);
  const state = proj.createVersion({}, reg[id], { poolDailyRaw: "1000000000000" }, { effectiveFrom: "2026-09-17", todayKey: "2026-09-17" });
  store.write(kv, id, "state", state);
  return reg[id];
}

section("5. the payout route — dryRun refused before any write");

t("a dryRun:true project refuses EVERY mutating payout action, before touching days/paid/batches/journal", async () => {
  const kv = store.memoryKv();
  const p = seedProject(kv, "poke", W.MINT1, { dryRun: true });
  store.write(kv, "poke", "days", days({ [W.A]: "1000000000" }));
  const app = mountFor({ kv });
  // scripts/hub-settle-route-test.cjs coverage gap (verify report, "windows the test does not
  // cover"): the original loop covered export/sent/sweep/confirm/cancel only — send and void join it.
  for (const q of [{ export: "1" }, { sent: JSON.stringify([{ wallet: W.A, sig: SIG(1) }]), batch: "x" }, { sweep: "1", batch: "x" }, { confirm: "x" }, { cancel: "x" }, { send: "x", from: "poke-vault", run: "1" }, { void: W.A, sig: SIG(1), batch: "x" }]) {
    const res = await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "poke" }, query: q });
    assert.strictEqual(res.statusCode, 403, JSON.stringify(q));
    assert.ok(/DRY RUN/.test(res.body.error), JSON.stringify(res.body));
  }
  // Nothing was ever written — the days seeded above are untouched, and no batches/journal exist.
  assert.deepStrictEqual(store.read(kv, "poke", "batches", {}), {});
  assert.deepStrictEqual(store.readJournal(kv), {});
});

section("6. the payout route — self-signed &sent=, journal-first dual-write, crash + resume");

t("happy path: &sent= verifies on chain, records the legacy row, and settles the journal in ONE persist", async () => {
  const kv = store.memoryKv();
  seedProject(kv, "alpha", W.MINT1);
  store.write(kv, "alpha", "days", days({ [W.A]: "1000000000" }));
  const app = mountFor({ kv, getTx: async (sig) => (sig === SIG(10) ? txSingle({ wallet: W.A, amountRaw: "1000000000" }) : null) });
  const exp = await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "alpha" }, query: { export: "1" } });
  assert.strictEqual(exp.statusCode, 200);
  const batchId = exp.body.created.id;
  const sent = await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "alpha" }, query: { sent: JSON.stringify([{ wallet: W.A, sig: SIG(10) }]), batch: batchId } });
  assert.strictEqual(sent.statusCode, 200, JSON.stringify(sent.body));
  assert.deepStrictEqual(sent.body.sent.recorded, [W.A]);
  assert.strictEqual(sent.body.sent.journal[0].journaled, true);
  // Persisted for real: a fresh read of the store shows the legacy row AND the journal entry.
  const batches = store.read(kv, "alpha", "batches", {});
  assert.strictEqual(batches[batchId].sent[W.A].sig, SIG(10));
  assert.strictEqual(batches[batchId].attempts[W.A].state, "settled");
  const j = store.readJournal(kv);
  assert.strictEqual(Object.values(j).filter((e) => e.projectId === "alpha" && e.batchId === batchId).length, 1);
});

t("crash between the legacy write and the journal write: the row is reserved and owedNow does not re-offer it; a resume marks it settled", async () => {
  const kv0 = store.memoryKv();
  seedProject(kv0, "alpha", W.MINT1);
  store.write(kv0, "alpha", "days", days({ [W.A]: "1000000000" }));
  const app0 = mountFor({ kv: kv0, getTx: async () => txSingle({ wallet: W.A, amountRaw: "1000000000" }) });
  const exp = await call(app0, "/api/hub/:project/payout", { method: "POST", params: { project: "alpha" }, query: { export: "1" } });
  const batchId = exp.body.created.id;
  const dump = kv0.dump();

  // Simulate the crash: a volume that reports FALSE (never throws — lib/kvstore.js's real
  // contract) for exactly the write that would land BOTH the legacy sent row and the journal
  // entry. The route's own `if (!writeManyVerifiedMixed(...))` catches this and answers 500 with a
  // clear message — never a generic error, never a partial write. Since crash P0-1/P1-1, the
  // journal lands at its OWN per-transfer key (store.journalEntryKey), never the old whole-blob key.
  const xferKey11 = L.xferKeyOf({ sig: SIG(11), instructionIndex: 0, innerIndex: null });
  const kv1raw = store.memoryKv(dump);
  const kv1 = flakyKv(kv1raw, { failOnKeys: new Set([store.journalEntryKey(xferKey11)]) });
  const app1 = mountFor({ kv: kv1, getTx: async () => txSingle({ wallet: W.A, amountRaw: "1000000000" }) });
  const crashed = await call(app1, "/api/hub/:project/payout", { method: "POST", params: { project: "alpha" }, query: { sent: JSON.stringify([{ wallet: W.A, sig: SIG(11) }]), batch: batchId } });
  assert.strictEqual(crashed.statusCode, 500, JSON.stringify(crashed.body));
  assert.ok(/did not take the write/.test(crashed.body.error), crashed.body.error);
  // NOTHING landed — not the legacy row, not the journal (all-or-nothing, store.writeManyVerifiedMixed).
  assert.deepStrictEqual(store.read(kv1raw, "alpha", "batches", {})[batchId].sent, undefined);
  assert.deepStrictEqual(store.readJournal(kv1raw), {});
  // owedNow (with the journal consulted) reads 0 — not because the money vanished, but because the
  // row is still RESERVED by the pending batch itself (unchanged since the export, above): a new
  // batch cannot double-claim it. It is neither offered again nor silently forgotten — cancelling
  // this exact batch is the only thing that would return it to `available`.
  const owedBefore = pay.owedNow({ days: store.read(kv1raw, "alpha", "days", {}), paid: store.read(kv1raw, "alpha", "paid", {}), pending: store.read(kv1raw, "alpha", "batches", {}), journal: store.readJournal(kv1raw), projectId: "alpha" });
  assert.strictEqual(owedBefore[W.A].toString(), "0");

  // RESUME: the same request, retried, against a store with the fault lifted.
  const kv2 = store.memoryKv(kv1raw.dump());
  const app2 = mountFor({ kv: kv2, getTx: async () => txSingle({ wallet: W.A, amountRaw: "1000000000" }) });
  const retry = await call(app2, "/api/hub/:project/payout", { method: "POST", params: { project: "alpha" }, query: { sent: JSON.stringify([{ wallet: W.A, sig: SIG(11) }]), batch: batchId } });
  assert.strictEqual(retry.statusCode, 200, JSON.stringify(retry.body));
  assert.strictEqual(retry.body.sent.journal[0].journaled, true);
  const batches2 = store.read(kv2, "alpha", "batches", {});
  assert.strictEqual(batches2[batchId].sent[W.A].sig, SIG(11));
  assert.strictEqual(batches2[batchId].attempts[W.A].state, "settled");
  assert.strictEqual(Object.keys(store.readJournal(kv2)).length, 1);
});

t("the same &sent= request submitted twice produces exactly ONE journal event, never two, and is reported as recorded once", async () => {
  const kv = store.memoryKv();
  seedProject(kv, "alpha", W.MINT1);
  store.write(kv, "alpha", "days", days({ [W.A]: "1000000000" }));
  const app = mountFor({ kv, getTx: async () => txSingle({ wallet: W.A, amountRaw: "1000000000" }) });
  const exp = await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "alpha" }, query: { export: "1" } });
  const batchId = exp.body.created.id;
  const q = { sent: JSON.stringify([{ wallet: W.A, sig: SIG(12) }]), batch: batchId };
  const first = await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "alpha" }, query: q });
  assert.strictEqual(first.body.sent.recorded.length, 1);
  const second = await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "alpha" }, query: q });
  // The row is already `sent` — verifyBatchRows' sigAlreadyUsed / recordSent dedup refuses a
  // second record of the SAME row (pre-existing behavior); the journal has exactly one entry.
  assert.strictEqual(second.body.sent.recorded.length, 0);
  assert.strictEqual(Object.keys(store.readJournal(kv)).length, 1);
});

t("a registry project's payout NEVER touches the dedicated CUNA keys", async () => {
  const kv = store.memoryKv({ cunaStakeDays: { untouched: 1 }, cunaStakeBatches: { untouched: 1 }, cunaStakePaid: { untouched: 1 } });
  seedProject(kv, "alpha", W.MINT1);
  store.write(kv, "alpha", "days", days({ [W.A]: "1000000000" }));
  const app = mountFor({ kv, getTx: async () => txSingle({ wallet: W.A, amountRaw: "1000000000" }) });
  const exp = await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "alpha" }, query: { export: "1" } });
  await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "alpha" }, query: { sent: JSON.stringify([{ wallet: W.A, sig: SIG(13) }]), batch: exp.body.created.id } });
  const dump = kv.dump();
  assert.deepStrictEqual(dump.cunaStakeDays, { untouched: 1 });
  assert.deepStrictEqual(dump.cunaStakeBatches, { untouched: 1 });
  assert.deepStrictEqual(dump.cunaStakePaid, { untouched: 1 });
  // and the alpha project's own keys are namespaced separately, per lib/hub/store.js
  assert.ok(Object.prototype.hasOwnProperty.call(dump, "program:alpha:batches"));
});

t("Round 3 #1: an oversized transfer is REFUSED as amount_mismatch, never journaled, never recorded sent — the row stays open for the genuine amount", async () => {
  const kv = store.memoryKv();
  seedProject(kv, "alpha", W.MINT1);
  store.write(kv, "alpha", "days", days({ [W.A]: "1000000000" }));
  const app = mountFor({ kv, getTx: async () => txSingle({ wallet: W.A, amountRaw: "1200000000" }) });   // 200000000 more than owed
  const exp = await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "alpha" }, query: { export: "1" } });
  const batchId = exp.body.created.id;
  const r = await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "alpha" }, query: { sent: JSON.stringify([{ wallet: W.A, sig: SIG(14) }]), batch: batchId } });
  assert.deepStrictEqual(r.body.sent.recorded, [], "the oversized transfer never gets recorded sent");
  assert.ok(r.body.sent.ignored.some((x) => x.wallet === W.A && x.why === "amount_mismatch" && x.expectedRaw === "1000000000" && x.actualRaw === "1200000000"), JSON.stringify(r.body.sent.ignored));
  const j = store.readJournal(kv);
  assert.strictEqual(Object.keys(j).filter((k) => j[k].projectId === "alpha" && j[k].batchId === batchId).length, 0, "nothing journaled — no phantom excess");
  const part = L.partition({ projectId: "alpha", days: store.read(kv, "alpha", "days", {}), batches: store.read(kv, "alpha", "batches", {}), journal: j });
  assert.strictEqual(part[W.A].accruedRaw, "1000000000");
  assert.strictEqual(part[W.A].paidAppliedRaw, "0");
  assert.strictEqual(part[W.A].excessRaw, "0", "excess is unreachable on the live path");
  assert.deepStrictEqual(L.checkInvariant(part), []);
  // The genuine, exactly-matching transfer settles it in a LATER request — the row was never
  // stapled shut by the oversized one.
  const app2 = mountFor({ kv, getTx: async () => txSingle({ wallet: W.A, amountRaw: "1000000000" }) });
  const r2 = await call(app2, "/api/hub/:project/payout", { method: "POST", params: { project: "alpha" }, query: { sent: JSON.stringify([{ wallet: W.A, sig: SIG(15) }]), batch: batchId } });
  assert.deepStrictEqual(r2.body.sent.recorded, [W.A]);
  assert.strictEqual(Object.keys(store.readJournal(kv)).filter((k) => store.readJournal(kv)[k].batchId === batchId).length, 1);
});

section("7. the payout route — managed-payer &send=, submitted-then-settled, and a lost journal write never loses the payment");

t("&send= stamps 'submitted' before broadcast, 'settled' once landed, and journals the transfer", async () => {
  const kv = store.memoryKv();
  seedProject(kv, "beta", W.MINT1);
  store.write(kv, "beta", "days", days({ [W.A]: "1000000000" }));
  const sigBox = {};
  const vault = { payoutSpl: async ({ recipients, onPaid }) => {
    const sig = SIG(20);
    onPaid({ wallet: recipients[0].wallet, amountUi: recipients[0].amountUi, sig, pending: true });
    // At this moment (mid-flow) the row must already read `submitted`, before the "landed" call.
    sigBox.midFlightState = store.read(kv, "beta", "batches", {})[sigBox.batchId].attempts[recipients[0].wallet].state;
    onPaid({ wallet: recipients[0].wallet, sig });
    return { action: "paid", paid: [{ wallet: recipients[0].wallet, sig, amountUi: recipients[0].amountUi }], pending: [], failed: [] };
  } };
  const app = mountFor({ kv, vault, getTx: async () => txSingle({ wallet: W.A, amountRaw: "1000000000" }) });
  const exp = await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "beta" }, query: { export: "1" } });
  sigBox.batchId = exp.body.created.id;
  const sent = await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "beta" }, query: { send: sigBox.batchId, from: "beta-vault", run: "1" } });
  assert.strictEqual(sent.statusCode, 200, JSON.stringify(sent.body));
  assert.strictEqual(sigBox.midFlightState, "submitted");
  assert.strictEqual(sent.body.send.journal[0].journaled, true);
  const batches = store.read(kv, "beta", "batches", {});
  assert.strictEqual(batches[sigBox.batchId].attempts[W.A].state, "settled");
  assert.strictEqual(Object.keys(store.readJournal(kv)).length, 1);
});

t("a lost journal write after a landed managed-payer send never loses the payment — the legacy row is intact and an alert fires", async () => {
  const kv = store.memoryKv();
  seedProject(kv, "beta", W.MINT1);
  store.write(kv, "beta", "days", days({ [W.A]: "1000000000" }));
  const vault = fakeVault({ [W.A]: "land" });
  const alerts = [];
  const exportApp = mountFor({ kv, vault, getTx: async () => txSingle({ wallet: W.A, amountRaw: "1000000000" }) });
  const exp = await call(exportApp, "/api/hub/:project/payout", { method: "POST", params: { project: "beta" }, query: { export: "1" } });
  const batchId = exp.body.created.id;
  // Fault ONLY the journal key, for the SECOND persist (the post-vault settle pass) — the FIRST
  // persist (onPaid's own legacy pending/paid write, a 2-key writeManyVerified with no journal key
  // in it) must go through untouched. Never-throws (flakyKv), matching the real volume's contract —
  // this is the route's own `else { alert(...) }` graceful path, not the outer catch-all.
  // The managed-payer's own signature is generated inside fakeVault from a shared counter, so its
  // exact value is not known ahead of time here — fail on ANY per-transfer journal key instead of
  // one exact xferKey (crash P0-1/P1-1: every journal write now lands at its own key under this prefix).
  const kvFaultRaw = store.memoryKv(kv.dump());
  const kvFault = flakyKv(kvFaultRaw, { failOnPrefix: store.JOURNAL_PREFIX });
  const app = mountFor({ kv: kvFault, vault, getTx: async () => txSingle({ wallet: W.A, amountRaw: "1000000000" }), alerts });
  const sent = await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "beta" }, query: { send: batchId, from: "beta-vault", run: "1" } });
  assert.strictEqual(sent.statusCode, 200, "the payout itself is NOT failed by a journal-only write problem");
  const batches = store.read(kvFaultRaw, "beta", "batches", {});
  assert.strictEqual(batches[batchId].sent[W.A].sig, sent.body.send.paid[0].sig, "the legacy paid/sent record is intact");
  assert.deepStrictEqual(store.readJournal(kvFaultRaw), {}, "the journal write did not land");
  assert.ok(alerts.some((m) => /settlement journal did not persist/.test(m)), "the gap is surfaced, not swallowed");
});

section("8. the payout route — &sweep= settles the journal for a row confirmed late (#313's rule)");

t("a row confirmed by a sweep after a prior request left it pending is journaled on the sweep, not before", async () => {
  const kv = store.memoryKv();
  seedProject(kv, "gamma", W.MINT1);
  store.write(kv, "gamma", "days", days({ [W.A]: "1000000000" }));
  const vault = fakeVault({ [W.A]: "stall" });   // confirm times out — the row stays pending
  const app = mountFor({ kv, vault, getTx: async () => txSingle({ wallet: W.A, amountRaw: "1000000000" }) });
  const exp = await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "gamma" }, query: { export: "1" } });
  const batchId = exp.body.created.id;
  const sent = await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "gamma" }, query: { send: batchId, from: "gamma-vault", run: "1" } });
  assert.strictEqual(sent.body.send.journal, undefined, "nothing landed yet, so the journal pass never ran");
  assert.strictEqual(sent.body.send.pending.length, 1);
  assert.deepStrictEqual(store.readJournal(kv), {});

  // Now a sweep resolves it (getSignatureStatuses says confirmed; getTx supplies the transfer).
  const app2 = mountFor({ kv, vault, getTx: async () => txSingle({ wallet: W.A, amountRaw: "1000000000" }) });
  // Patch the fake connection's getSignatureStatuses just for this call by remounting with one.
  const app3 = fakeApp();
  routes.mount(app3, {
    kv, adminAuthOK: () => true, publicErrMsg: (e) => (e && e.message) || String(e), vault,
    connection: () => ({ getSignatureStatuses: async () => ({ value: [{ err: null, confirmationStatus: "finalized" }] }) }),
    scanDeps: async () => ({}), getTx: async () => txSingle({ wallet: W.A, amountRaw: "1000000000" }),
    nowUnix: () => NOW,
  });
  const swept = await call(app3, "/api/hub/:project/payout", { method: "POST", params: { project: "gamma" }, query: { sweep: "1", batch: batchId } });
  assert.strictEqual(swept.statusCode, 200, JSON.stringify(swept.body));
  assert.strictEqual(swept.body.sweep.confirmed.length, 1);
  assert.strictEqual(swept.body.sweep.journal[0].journaled, true);
  assert.strictEqual(Object.keys(store.readJournal(kv)).length, 1);
});

section("9. a journal-backed public receipt validates against receipt.schema.json");

t("findReceipt serves the Addendum-B3 shape once a journal event exists, and it validates the schema", () => {
  const kv = store.memoryKv();
  seedProject(kv, "delta", W.MINT1);
  store.write(kv, "delta", "days", days({ [W.A]: "1000000000" }));
  const app = mountFor({ kv, getTx: async () => txSingle({ wallet: W.A, amountRaw: "1000000000" }) });
  return (async () => {
    const exp = await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "delta" }, query: { export: "1" } });
    const batchId = exp.body.created.id;
    await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "delta" }, query: { sent: JSON.stringify([{ wallet: W.A, sig: SIG(30) }]), batch: batchId } });

    const pub = require("../lib/hub/public");
    const project = store.readRegistry(kv).delta;
    const view = pub.projectView({ project, stake: pub.stakeView({ days: store.read(kv, "delta", "days", {}), paid: store.read(kv, "delta", "paid", {}), batches: store.read(kv, "delta", "batches", {}), decimals: 9 }) });
    const wrapped = pub.findReceipt(view, SIG(30), { journal: store.readJournal(kv), batches: store.read(kv, "delta", "batches", {}), project, programState: store.read(kv, "delta", "state", {}) });
    // adv P1-4: findReceipt now wraps the B3 shape in the SAME envelope the legacy shape uses
    // ({projectId, symbol, dryRun, brand, program, receipt}) — public/hub.html's renderReceipt
    // reads `r.program`/`r.symbol`/`r.dryRun`/`r.brand`/`r.receipt` regardless of which shape
    // `r.receipt` turns out to be; assert every field it reads is actually present.
    assert.ok(wrapped && wrapped.receipt && Array.isArray(wrapped.receipt.settlements), "the Addendum-B shape was served, wrapped");
    const rec = wrapped.receipt;
    assert.strictEqual(rec.settlements.length, 1);
    assert.strictEqual(rec.totals.appliedRaw, "1000000000");
    assert.strictEqual(typeof wrapped.symbol, "string");
    assert.strictEqual(wrapped.dryRun, false);
    assert.ok("brand" in wrapped);
    assert.ok(wrapped.program && typeof wrapped.program.label === "string" && typeof wrapped.program.kind === "string");
    assert.ok(wrapped.program.ticker); assert.ok(wrapped.program.mint); assert.ok(wrapped.program.prizeMint);
    assert.ok(wrapped.program.termsHash, "termsHash is the receipt's own programHash, not null");
    // Exactly what public/hub.html's renderReceipt reads off `x` (= wrapped.receipt) for the B
    // shape: wallet, state, and per-settlement sig/at (there is no single top-level amountUi/sig/at
    // on this shape — the page derives them from totals + the last settlement, see its own code).
    assert.strictEqual(rec.wallet, W.A);
    assert.ok(["pending", "partial", "paid", "waived"].includes(rec.state));
    assert.strictEqual(typeof rec.settlements[0].sig, "string");
    assert.strictEqual(typeof rec.settlements[0].at, "number");
    assert.strictEqual(typeof rec.rewardDecimals, "number");

    // Minimal validator, matching scripts/hub-schema-test.cjs's own (kept self-contained on
    // purpose — this file must not depend on another test file's internals).
    const fs = require("fs"); const path = require("path");
    const schema = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "lib", "hub", "schema", "receipt.schema.json"), "utf8"));
    const typeOf = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : Number.isInteger(v) ? "integer" : typeof v);
    const typeOk = (t2, v) => (t2 === "integer" ? Number.isInteger(v) : t2 === "number" ? (typeof v === "number" && Number.isFinite(v)) : typeOf(v) === t2);
    function validate(sch, data, at = "$", errors = []) {
      if (!sch || typeof sch !== "object") return errors;
      if (sch.type) { const types = Array.isArray(sch.type) ? sch.type : [sch.type]; if (!types.some((tt) => typeOk(tt, data))) { errors.push(`${at}: expected ${types.join("|")}, got ${typeOf(data)}`); return errors; } }
      if (sch.pattern && typeof data === "string" && !new RegExp(sch.pattern).test(data)) errors.push(`${at}: "${data}" fails /${sch.pattern}/`);
      if (data && typeof data === "object" && !Array.isArray(data)) {
        for (const req of sch.required || []) if (!Object.prototype.hasOwnProperty.call(data, req)) errors.push(`${at}: missing "${req}"`);
        if (sch.properties) for (const [k, v] of Object.entries(data)) { if (Object.prototype.hasOwnProperty.call(sch.properties, k)) validate(sch.properties[k], v, `${at}.${k}`, errors); else if (sch.additionalProperties === false) errors.push(`${at}.${k}: not allowed`); }
      }
      if (Array.isArray(data) && sch.items) data.forEach((item, i) => validate(sch.items, item, `${at}[${i}]`, errors));
      return errors;
    }
    const errors = validate(schema, rec);
    assert.deepStrictEqual(errors, []);
  })();
});

// ── everything below is new coverage from docs/HUB_JOURNAL_VERIFY_2026-09-18.md (two-lens
// adversarial verification, PR #342 blocked on its P0/P1 findings) — each section names the
// finding(s) it closes. ─────────────────────────────────────────────────────────────────────────

const MINT_B = "5zro2xbCxMFVvygCsj5FZMgZnVCb8EqcbPGTbSGCgDBc"; // a distinct LOCKED mint for the shared-reward-mint tests below

section("10. adv P0-1 — a transfer must be SOURCED from the project's funding wallet (or a listed fundedBy wallet)");

t("a DEX-shaped inner-CPI transfer (source owned by a stranger) is refused, never legacy-recorded, never journaled", async () => {
  const kv = store.memoryKv();
  seedProject(kv, "alpha10", W.MINT1);
  store.write(kv, "alpha10", "days", days({ [W.A]: "1000000000" }));
  const app = mountFor({ kv, getTx: async () => txInner({ wallet: W.A, amountRaw: "1000000000", sourceOwner: W.DEST2 }) });
  const exp = await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "alpha10" }, query: { export: "1" } });
  const batchId = exp.body.created.id;
  const sent = await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "alpha10" }, query: { sent: JSON.stringify([{ wallet: W.A, sig: SIG(40) }]), batch: batchId } });
  assert.strictEqual(sent.statusCode, 200, JSON.stringify(sent.body));
  assert.deepStrictEqual(sent.body.sent.recorded, []);
  assert.ok(sent.body.sent.ignored.some((x) => x.why === "transfer_not_from_funding_wallet"), JSON.stringify(sent.body.sent.ignored));
  assert.deepStrictEqual(store.read(kv, "alpha10", "batches", {})[batchId].sent, {});
  assert.deepStrictEqual(store.readJournal(kv), {});
});

t("a top-level airdrop-shaped transfer from a stranger wallet is refused the same way", async () => {
  const kv = store.memoryKv();
  seedProject(kv, "alpha10b", W.MINT1);
  store.write(kv, "alpha10b", "days", days({ [W.A]: "1000000000" }));
  const app = mountFor({ kv, getTx: async () => txSingle({ wallet: W.A, amountRaw: "1000000000", sourceOwner: W.DEST2 }) });
  const exp = await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "alpha10b" }, query: { export: "1" } });
  const batchId = exp.body.created.id;
  const sent = await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "alpha10b" }, query: { sent: JSON.stringify([{ wallet: W.A, sig: SIG(41) }]), batch: batchId } });
  assert.deepStrictEqual(sent.body.sent.recorded, []);
  assert.ok(sent.body.sent.ignored.some((x) => x.why === "transfer_not_from_funding_wallet"));
  assert.deepStrictEqual(store.readJournal(kv), {});
});

t("a genuine funding-wallet transfer, even via an inner CPI instruction, is accepted and journaled", async () => {
  const kv = store.memoryKv();
  seedProject(kv, "alpha10c", W.MINT1);
  store.write(kv, "alpha10c", "days", days({ [W.A]: "1000000000" }));
  const app = mountFor({ kv, getTx: async () => txInner({ wallet: W.A, amountRaw: "1000000000", sourceOwner: W.FUND }) });
  const exp = await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "alpha10c" }, query: { export: "1" } });
  const batchId = exp.body.created.id;
  const sent = await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "alpha10c" }, query: { sent: JSON.stringify([{ wallet: W.A, sig: SIG(42) }]), batch: batchId } });
  assert.deepStrictEqual(sent.body.sent.recorded, [W.A]);
  assert.strictEqual(sent.body.sent.journal[0].journaled, true);
  assert.strictEqual(Object.keys(store.readJournal(kv)).length, 1);
});

t("a transaction with a blockTime more than 10 minutes in the future is refused, source aside", async () => {
  const kv = store.memoryKv();
  seedProject(kv, "alpha10d", W.MINT1);
  store.write(kv, "alpha10d", "days", days({ [W.A]: "1000000000" }));
  const futureTx = { ...txSingle({ wallet: W.A, amountRaw: "1000000000" }), blockTime: NOW + 700 };
  const app = mountFor({ kv, getTx: async () => futureTx });
  const exp = await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "alpha10d" }, query: { export: "1" } });
  const batchId = exp.body.created.id;
  const sent = await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "alpha10d" }, query: { sent: JSON.stringify([{ wallet: W.A, sig: SIG(43) }]), batch: batchId } });
  assert.deepStrictEqual(sent.body.sent.recorded, []);
  assert.ok(sent.body.sent.ignored.some((x) => /blockTime/.test(x.why)), JSON.stringify(sent.body.sent.ignored));
});

section("11. adv P0-2 — a journal refusal REJECTS the row; the journal is the cross-project reuse guard");

t("two projects sharing a reward mint: the same signature settles the FIRST project's row; the second is refused with NOTHING written, legacy or journal", async () => {
  const kv = store.memoryKv();
  seedProjectReward(kv, "alpha11", W.MINT1, W.MINT1);
  seedProjectReward(kv, "beta11", MINT_B, W.MINT1);
  store.write(kv, "alpha11", "days", days({ [W.A]: "1000000000" }));
  store.write(kv, "beta11", "days", days({ [W.A]: "1000000000" }));
  const tx = txSingle({ wallet: W.A, amountRaw: "1000000000" });
  const app = mountFor({ kv, getTx: async () => tx });
  const eA = await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "alpha11" }, query: { export: "1" } });
  const eB = await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "beta11" }, query: { export: "1" } });
  const first = await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "alpha11" }, query: { sent: JSON.stringify([{ wallet: W.A, sig: SIG(50) }]), batch: eA.body.created.id } });
  assert.deepStrictEqual(first.body.sent.recorded, [W.A]);
  const second = await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "beta11" }, query: { sent: JSON.stringify([{ wallet: W.A, sig: SIG(50) }]), batch: eB.body.created.id } });
  assert.deepStrictEqual(second.body.sent.recorded, [], "the second project's row is REJECTED, not legacy-recorded");
  // Caught cross-project by the legacy sigAlreadyUsed check (now journal-aware — adv P0-2's own
  // suggested fix) BEFORE it would even reach the journal's own "transfer_already_consumed" —
  // belt-and-suspenders: either wording is a correct refusal, this just asserts SOME refusal fires.
  assert.ok(second.body.sent.ignored.some((x) => /already[ _]consumed|already paid/.test(x.why)), JSON.stringify(second.body.sent.ignored));
  assert.deepStrictEqual(store.read(kv, "beta11", "batches", {})[eB.body.created.id].sent, {}, "nothing legacy-written for beta11");
  assert.deepStrictEqual(Object.values(store.readJournal(kv)).filter((e) => e.projectId === "beta11"), [], "no journal entry for beta11");
  // Cancel beta11's now-untouched batch and confirm the full amount is still owed — proving
  // nothing was actually settled for it despite the money having "existed" in a pending batch.
  await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "beta11" }, query: { cancel: eB.body.created.id } });
  const owedBeta = pay.owedNow({ days: store.read(kv, "beta11", "days", {}), paid: store.read(kv, "beta11", "paid", {}), pending: store.read(kv, "beta11", "batches", {}), journal: store.readJournal(kv), projectId: "beta11" });
  assert.strictEqual(owedBeta[W.A].toString(), "1000000000", "beta11's obligation is untouched — still fully owed");
});

t("void + cancel + resubmit the same signature is refused — closed at the void step, because the row is already journaled (crash P1-2)", async () => {
  const kv = store.memoryKv();
  seedProject(kv, "alpha12", W.MINT1);
  store.write(kv, "alpha12", "days", days({ [W.A]: "1000000000" }));
  const app = mountFor({ kv, getTx: async () => txSingle({ wallet: W.A, amountRaw: "1000000000" }) });
  const exp = await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "alpha12" }, query: { export: "1" } });
  const batchId = exp.body.created.id;
  await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "alpha12" }, query: { sent: JSON.stringify([{ wallet: W.A, sig: SIG(51) }]), batch: batchId } });
  assert.strictEqual(Object.keys(store.readJournal(kv)).length, 1);
  const voided = await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "alpha12" }, query: { void: W.A, sig: SIG(51), batch: batchId } });
  assert.strictEqual(voided.body.void.ok, false);
  assert.match(voided.body.void.error, /cannot be voided/);
  // The row is UNCHANGED — still recorded sent, journal intact — so there is nothing for a
  // cancel+resubmit of the same signature to reopen anywhere else.
  assert.strictEqual(store.read(kv, "alpha12", "batches", {})[batchId].sent[W.A].sig, SIG(51));
  assert.strictEqual(Object.keys(store.readJournal(kv)).length, 1);
});

t("void on a legacy-recorded row that never journaled (attribution failure) still works — only a JOURNALED row is refused", async () => {
  const kv = store.memoryKv();
  seedProject(kv, "alpha13", W.MINT1);
  store.write(kv, "alpha13", "days", days({ [W.A]: "50" }));
  const app = mountFor({ kv, getTx: async () => txAmbiguous({ wallet: W.A }) });
  const exp = await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "alpha13" }, query: { export: "1" } });
  const batchId = exp.body.created.id;
  const sent = await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "alpha13" }, query: { sent: JSON.stringify([{ wallet: W.A, sig: SIG(72) }]), batch: batchId } });
  assert.deepStrictEqual(sent.body.sent.recorded, [W.A]);
  assert.strictEqual(sent.body.sent.journal[0].journaled, false);
  assert.deepStrictEqual(store.readJournal(kv), {});
  const voided = await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "alpha13" }, query: { void: W.A, sig: SIG(72), batch: batchId } });
  assert.strictEqual(voided.body.void.ok, true, JSON.stringify(voided.body));
});

section("12. crash P0-1/P1-1 — the journal is append-only per transfer; interleaved requests across two projects both survive");

t("project alpha stalls on getTx while beta completes and journals — beta's entry survives the interleave", async () => {
  const kv = store.memoryKv();
  seedProject(kv, "alpha14", W.MINT1);
  seedProjectReward(kv, "beta14", MINT_B, W.MINT1); // distinct LOCKED mint (uniqueness), reward mint matches the txSingle fixture
  store.write(kv, "alpha14", "days", days({ [W.A]: "1000000000" }));
  store.write(kv, "beta14", "days", days({ [W.B]: "2000000000" }));
  let release; const gate = new Promise((r) => { release = r; });
  let first = true;
  const appAlpha = mountFor({ kv, getTx: async () => { if (first) { first = false; await gate; } return txSingle({ wallet: W.A, amountRaw: "1000000000" }); } });
  const appBeta = mountFor({ kv, getTx: async () => txSingle({ wallet: W.B, amountRaw: "2000000000" }) });
  const eA = await call(appAlpha, "/api/hub/:project/payout", { method: "POST", params: { project: "alpha14" }, query: { export: "1" } });
  const eB = await call(appBeta, "/api/hub/:project/payout", { method: "POST", params: { project: "beta14" }, query: { export: "1" } });
  const pA = call(appAlpha, "/api/hub/:project/payout", { method: "POST", params: { project: "alpha14" }, query: { sent: JSON.stringify([{ wallet: W.A, sig: SIG(60) }]), batch: eA.body.created.id } });
  await new Promise((r) => setImmediate(r));
  const rB = await call(appBeta, "/api/hub/:project/payout", { method: "POST", params: { project: "beta14" }, query: { sent: JSON.stringify([{ wallet: W.B, sig: SIG(61) }]), batch: eB.body.created.id } });
  assert.strictEqual(rB.body.sent.recorded.length, 1, "beta completed while alpha was still stalled");
  assert.strictEqual(Object.keys(store.readJournal(kv)).length, 1, "beta's journal entry is durable the moment it lands");
  release();
  const rA = await pA;
  assert.strictEqual(rA.body.sent.recorded.length, 1);
  // BOTH entries survive — the old whole-blob journal would have had alpha's persist (built from a
  // pre-beta snapshot) silently erase beta's entry here (durability lens P1-1).
  assert.strictEqual(Object.keys(store.readJournal(kv)).length, 2);
  const jr = store.readJournal(kv);
  assert.ok(Object.values(jr).some((e) => e.projectId === "alpha14"));
  assert.ok(Object.values(jr).some((e) => e.projectId === "beta14"));
  // The cross-project consumed guard holds after the interleave: neither entry can settle the
  // OTHER project's row for the same identity.
  const s = L.settle({ journal: jr, projectId: "alpha14", batch: { id: eA.body.created.id, projectId: "alpha14", amounts: { [W.A]: "1000000000" } }, wallet: W.B, transfer: { sig: SIG(61), instructionIndex: 0, innerIndex: null, amountRaw: "1000000000", slot: 1 }, nowUnix: NOW });
  assert.strictEqual(s.ok, false); assert.strictEqual(s.error, "transfer_already_consumed");
});

section("13. crash P0-1 — the payout route is serialised per project; a second concurrent mutating request gets 409, never a lost write");

t("two overlapping &sent= requests for DIFFERENT wallets on the SAME project: the second waits (409 busy) instead of racing the first's read-modify-write", async () => {
  const kv = store.memoryKv();
  seedProject(kv, "gamma15", W.MINT1);
  store.write(kv, "gamma15", "days", days({ [W.A]: "1000000000", [W.B]: "2000000000" }));
  const seedApp = mountFor({ kv });
  const exp = await call(seedApp, "/api/hub/:project/payout", { method: "POST", params: { project: "gamma15" }, query: { export: "1" } });
  const batchId = exp.body.created.id;
  let release; const gate = new Promise((r) => { release = r; });
  let first = true;
  const appA = mountFor({ kv, getTx: async () => { if (first) { first = false; await gate; } return txSingle({ wallet: W.A, amountRaw: "1000000000" }); } });
  const appB = mountFor({ kv, getTx: async () => txSingle({ wallet: W.B, amountRaw: "2000000000" }) });
  const pA = call(appA, "/api/hub/:project/payout", { method: "POST", params: { project: "gamma15" }, query: { sent: JSON.stringify([{ wallet: W.A, sig: SIG(62) }]), batch: batchId } });
  await new Promise((r) => setImmediate(r));
  const rB = await call(appB, "/api/hub/:project/payout", { method: "POST", params: { project: "gamma15" }, query: { sent: JSON.stringify([{ wallet: W.B, sig: SIG(63) }]), batch: batchId } });
  assert.strictEqual(rB.statusCode, 409, JSON.stringify(rB.body));
  assert.strictEqual(rB.body.error, "busy");
  release();
  const rA = await pA;
  assert.strictEqual(rA.statusCode, 200, JSON.stringify(rA.body));
  assert.strictEqual(rA.body.sent.recorded.length, 1);
  // B was never lost — it simply never ran; a caller retries once the lock clears.
  const retryB = await call(appB, "/api/hub/:project/payout", { method: "POST", params: { project: "gamma15" }, query: { sent: JSON.stringify([{ wallet: W.B, sig: SIG(63) }]), batch: batchId } });
  assert.strictEqual(retryB.statusCode, 200, JSON.stringify(retryB.body));
  assert.strictEqual(retryB.body.sent.recorded.length, 1);
  assert.strictEqual(Object.keys(store.readJournal(kv)).length, 2);
  // A non-mutating GET is never blocked by the lock.
  const read = await call(appB, "/api/hub/:project/payout", { method: "GET", params: { project: "gamma15" }, query: {} });
  assert.strictEqual(read.statusCode, 200);
});

section("14. adv P1-3 — a stranger's transfer stapled to an already-settled row is not journaled");

t("row settled at 1.0; a second, unrelated 50-token transfer to the SAME wallet in the SAME batch is not journaled — no phantom excess", async () => {
  const kv = store.memoryKv();
  seedProject(kv, "eps16", W.MINT1);
  store.write(kv, "eps16", "days", days({ [W.A]: "1000000000" }));
  const app = mountFor({ kv, getTx: async (sig) => (sig === SIG(70) ? txSingle({ wallet: W.A, amountRaw: "1000000000" }) : txSingle({ wallet: W.A, amountRaw: "50000000000", slot: 99 })) });
  const exp = await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "eps16" }, query: { export: "1" } });
  const batchId = exp.body.created.id;
  const first = await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "eps16" }, query: { sent: JSON.stringify([{ wallet: W.A, sig: SIG(70) }]), batch: batchId } });
  assert.strictEqual(first.body.sent.recorded.length, 1);
  assert.strictEqual(Object.keys(store.readJournal(kv)).length, 1);
  const second = await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "eps16" }, query: { sent: JSON.stringify([{ wallet: W.A, sig: SIG(71) }]), batch: batchId } });
  assert.deepStrictEqual(second.body.sent.recorded, [], "already recorded — the stapled transfer records nothing new");
  // Round 2 #1 (docs/HUB_JOURNAL_VERIFY_2026-09-18.md): lib/hub/ledger.js `settle` now refuses a
  // row whose remaining is already 0 BEFORE PASS 1 ever calls recordSent, so this shows up as a
  // hard rejection (PASS 1, alerted) rather than reaching PASS 3's journal report at all.
  //
  // Round 3 #1: the PASS-1 grouping refuses this the same way it refuses ANY non-matching amount —
  // `amount_mismatch` against a remaining of "0" — rather than the more specific
  // `row_already_settled` lib/hub/ledger.js settle() itself still reports when called directly (see
  // the pure-ledger test below); the route's own grouping never gets far enough to ask settle()
  // that question, since no candidate for this wallet equals the row's remaining.
  assert.strictEqual(second.body.sent.journal.length, 0, "never reaches PASS 3 — refused earlier, in PASS 1");
  assert.ok(second.body.sent.ignored.some((x) => x.wallet === W.A && x.sig === SIG(71) && x.why === "amount_mismatch" && x.expectedRaw === "0" && x.actualRaw === "50000000000"), JSON.stringify(second.body.sent.ignored));
  assert.strictEqual(Object.keys(store.readJournal(kv)).length, 1, "still exactly one journal entry — no phantom excess, no second settlement");
});

section("15. crash P1-3 (durability lens) — owedNow takes the per-ROW union, not the per-wallet max of totals");

t("wallet accrued 200 across two batches: batch1 settled journal-only (legacy voided), batch2 settled legacy-only (journal lost) — owedNow reads 0, not 100", () => {
  const b1 = { id: "b1", amounts: { [W.A]: "100" } };                                     // legacy voided: no sent[w]
  const b2 = { id: "b2", amounts: { [W.A]: "100" }, sent: { [W.A]: { sig: SIG(80) } } };   // journal write lost
  const journal = { k1: { projectId: "eta17", batchId: "b1", wallet: W.A, appliedRaw: "100" } };
  const owed = pay.owedNow({ days: days({ [W.A]: "200" }), paid: {}, pending: { b1, b2 }, journal, projectId: "eta17" });
  assert.strictEqual(owed[W.A].toString(), "0", "200 genuinely left the wallet across the two rows — nothing left to re-offer");
});

t("a journal row whose batch is no longer present in the batches map still counts (an orphaned/purged batch is not lost money)", () => {
  const journal = { k1: { projectId: "theta18", batchId: "gone", wallet: W.A, appliedRaw: "300" } };
  const owed = pay.owedNow({ days: days({ [W.A]: "300" }), paid: {}, pending: {}, journal, projectId: "theta18" });
  assert.strictEqual(owed[W.A].toString(), "0");
});

section("16. crash P1-4 — the public holder view (GET /api/hub/:project/holder) agrees with the payout desk");

t("the holder view's owedRaw drops to 0 once the row is journaled, even if `paid` never got the write", async () => {
  const kv = store.memoryKv();
  seedProject(kv, "iota19", W.MINT1);
  store.write(kv, "iota19", "days", days({ [W.A]: "1000000000" }));
  const app = mountFor({ kv, getTx: async () => txSingle({ wallet: W.A, amountRaw: "1000000000" }) });
  const exp = await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "iota19" }, query: { export: "1" } });
  const batchId = exp.body.created.id;
  await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "iota19" }, query: { sent: JSON.stringify([{ wallet: W.A, sig: SIG(90) }]), batch: batchId } });
  const holder = await call(app, "/api/hub/:project/holder", { method: "GET", params: { project: "iota19" }, query: { address: W.A } });
  assert.strictEqual(holder.statusCode, 200, JSON.stringify(holder.body));
  assert.strictEqual(holder.body.owedRaw, "0", "the holder view must agree with the desk — the row is journaled and legacy-recorded");
});

section("17. adv P1-5 / crash P2-1 — the journal's amount is the LOCATED INSTRUCTION's own amount, floored at a positive net delta");

t("an instruction moves 1.0 to the wallet while the wallet separately sends 0.4 elsewhere in the same signature — the journal names 1.0, not the 0.6 net delta", () => {
  const tx = {
    slot: 77, blockTime: NOW,
    meta: {
      err: null,
      preTokenBalances: [bal(0, W.FUND, "999999999999999"), bal(1, W.A, "400000000")],
      postTokenBalances: [bal(1, W.A, "1000000000")],   // net delta across the tx: +1.0 in, -0.4 out elsewhere = +0.6 net
    },
    transaction: { message: { accountKeys: [SRC_ATA, W.DEST1], instructions: [tokenTransfer(W.DEST1, "1000000000")] } },
  };
  const r = payoutVerify.locateTransferInstruction(tx, { mint: W.MINT1, wallet: W.A, nowUnix: NOW });
  assert.ok(r && !r.refused, JSON.stringify(r));
  assert.strictEqual(r.amountRaw, "1000000000", "the instruction's own amount, not the net delta");
});

t("a transaction that nets to zero or negative for the wallet is refused regardless of what any instruction claims (the floor)", () => {
  const tx = {
    slot: 78, blockTime: NOW,
    meta: {
      err: null,
      preTokenBalances: [bal(0, W.FUND, "999999999999999"), bal(1, W.A, "1000000000")],
      postTokenBalances: [bal(1, W.A, "1000000000")],   // instruction claims +1.0 in, but the wallet's balance for this mint did not move at all
    },
    transaction: { message: { accountKeys: [SRC_ATA, W.DEST1], instructions: [tokenTransfer(W.DEST1, "1000000000")] } },
  };
  assert.strictEqual(payoutVerify.locateTransferInstruction(tx, { mint: W.MINT1, wallet: W.A, nowUnix: NOW }), null);
});

section("18. crash P2-2 — GET /api/hub/:project/reconcile rebuilds the consumed set and reports divergence, read-only");

t("reports a legacy-sent row with no journal entry as divergent, and a fully-agreeing row as not — never writes anything", async () => {
  const kv = store.memoryKv();
  seedProject(kv, "kappa20", W.MINT1);
  store.write(kv, "kappa20", "days", days({ [W.A]: "1000000000", [W.B]: "50" }));
  const app = mountFor({ kv, getTx: async (sig) => (sig === SIG(91) ? txSingle({ wallet: W.A, amountRaw: "1000000000" }) : txAmbiguous({ wallet: W.B })) });
  const exp = await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "kappa20" }, query: { export: "1" } });
  const batchId = exp.body.created.id;
  await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "kappa20" }, query: { sent: JSON.stringify([{ wallet: W.A, sig: SIG(91) }, { wallet: W.B, sig: SIG(92) }]), batch: batchId } });
  const before = kv.dump();
  const r = await call(app, "/api/hub/:project/reconcile", { method: "GET", params: { project: "kappa20" }, query: {} });
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.divergentCount, 1, JSON.stringify(r.body.divergent));
  assert.strictEqual(r.body.divergent[0].wallet, W.B, "B's transfer never attributed to one instruction — legacy sent, no journal entry");
  assert.strictEqual(r.body.divergent[0].legacySent, true);
  assert.strictEqual(r.body.divergent[0].journalSettled, false);
  assert.deepStrictEqual(kv.dump(), before, "reconcile writes nothing");
});

section("19. crash P2-3/P2-4 — journaled:false and a genuine throw both alert, never silently swallowed");

t("a landed, legacy-recorded row that could not be journaled (attribution failure) alerts the operator", async () => {
  const kv = store.memoryKv();
  seedProject(kv, "lambda21", W.MINT1);
  store.write(kv, "lambda21", "days", days({ [W.A]: "50" }));
  const alerts = [];
  const app = mountFor({ kv, getTx: async () => txAmbiguous({ wallet: W.A }), alerts });
  const exp = await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "lambda21" }, query: { export: "1" } });
  const batchId = exp.body.created.id;
  await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "lambda21" }, query: { sent: JSON.stringify([{ wallet: W.A, sig: SIG(93) }]), batch: batchId } });
  assert.ok(alerts.some((m) => /recorded sent but not journaled/.test(m)), JSON.stringify(alerts));
});

t("a genuine THROW mid-request (not a graceful false) still alerts, not just a silent 400", async () => {
  const kv = store.memoryKv({}, { failOn: (k) => k.startsWith(store.JOURNAL_PREFIX) });
  seedProject(kv, "mu22", W.MINT1);
  store.write(kv, "mu22", "days", days({ [W.A]: "1000000000" }));
  const alerts = [];
  const app = mountFor({ kv, getTx: async () => txSingle({ wallet: W.A, amountRaw: "1000000000" }), alerts });
  const exp = await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "mu22" }, query: { export: "1" } });
  const batchId = exp.body.created.id;
  const res = await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "mu22" }, query: { sent: JSON.stringify([{ wallet: W.A, sig: SIG(94) }]), batch: batchId } });
  assert.strictEqual(res.statusCode, 400, JSON.stringify(res.body));
  assert.ok(alerts.some((m) => /payout request threw/.test(m)), JSON.stringify(alerts));
  // The lock is released even on a throw (the route's `finally`) — a following mutating request
  // is never stuck behind a stale lock left by the crash (409 would mean the finally didn't run).
  const retry = await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "mu22" }, query: { export: "1" } });
  assert.strictEqual(retry.statusCode, 200, JSON.stringify(retry.body));
});

section("20. dryRun (Colosseum E10) never reaches send or void either");

t("a dryRun project's &send= and &void= are both refused before any store read", async () => {
  const kv = store.memoryKv();
  seedProject(kv, "nu23", W.MINT1, { dryRun: true });
  const app = mountFor({ kv });
  const send = await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "nu23" }, query: { send: "x", from: "nu23-vault", run: "1" } });
  assert.strictEqual(send.statusCode, 403); assert.ok(/DRY RUN/.test(send.body.error));
  const voidRes = await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "nu23" }, query: { void: W.A, sig: SIG(1), batch: "x" } });
  assert.strictEqual(voidRes.statusCode, 403); assert.ok(/DRY RUN/.test(voidRes.body.error));
});

section("21. adv P2-6 — a signature with stray whitespace is trimmed consistently, not opted out of the journal");

t("a submitted signature with a leading/trailing space still verifies and journals — the untrimmed lookup used to silently keep it legacy-only", async () => {
  const kv = store.memoryKv();
  seedProject(kv, "xi24", W.MINT1);
  store.write(kv, "xi24", "days", days({ [W.A]: "1000000000" }));
  const app = mountFor({ kv, getTx: async () => txSingle({ wallet: W.A, amountRaw: "1000000000" }) });
  const exp = await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "xi24" }, query: { export: "1" } });
  const batchId = exp.body.created.id;
  const sent = await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "xi24" }, query: { sent: JSON.stringify([{ wallet: W.A, sig: "  " + SIG(95) + "  " }]), batch: batchId } });
  assert.deepStrictEqual(sent.body.sent.recorded, [W.A]);
  assert.strictEqual(sent.body.sent.journal[0].journaled, true, JSON.stringify(sent.body.sent.journal));
  assert.strictEqual(Object.keys(store.readJournal(kv)).length, 1);
  assert.strictEqual(store.read(kv, "xi24", "batches", {})[batchId].sent[W.A].sig, SIG(95), "the stored signature is the trimmed one");
});

section("22. Round 2 #1 (docs/HUB_JOURNAL_VERIFY_2026-09-18.md) — the single-request stapled-excess variant");

t("ONE &sent= request carrying a genuine good sig AND a genuine but unrelated extra transfer for the SAME wallet journals only the good one — no phantom excess", async () => {
  const kv = store.memoryKv();
  seedProject(kv, "psi25", W.MINT1);
  store.write(kv, "psi25", "days", days({ [W.A]: "1000000000" }));
  const good = txSingle({ wallet: W.A, amountRaw: "1000000000", slot: 201 });
  const extra = txSingle({ wallet: W.A, amountRaw: "50000000000", slot: 202 });
  const app = mountFor({ kv, getTx: async (sig) => (sig === SIG(210) ? good : extra) });
  const exp = await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "psi25" }, query: { export: "1" } });
  const batchId = exp.body.created.id;
  const r = await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "psi25" },
    query: { batch: batchId, sent: JSON.stringify([{ wallet: W.A, sig: SIG(210) }, { wallet: W.A, sig: SIG(211) }]) } });
  assert.deepStrictEqual(r.body.sent.recorded, [W.A]);
  const j = store.readJournal(kv);
  assert.strictEqual(Object.keys(j).length, 1, "exactly one journal entry — the second sig never lands, in the SAME request");
  const entry = Object.values(j)[0];
  assert.strictEqual(entry.excessRaw, "0", "no phantom excess");
  assert.strictEqual(entry.sig, SIG(210));
  const batch = store.read(kv, "psi25", "batches", {})[batchId];
  const rec = L.receipt({ projectId: "psi25", batch: { ...batch, projectId: "psi25" }, wallet: W.A, journal: j, project: { fundingWallet: W.FUND } });
  assert.strictEqual(rec.totals.excessRaw, "0", "the public receipt shows no phantom excess");
  assert.strictEqual(rec.settlements.length, 1);
  const part = L.partition({ projectId: "psi25", days: store.read(kv, "psi25", "days", {}), batches: store.read(kv, "psi25", "batches", {}), journal: j });
  assert.strictEqual(part[W.A].excessRaw, "0", "the Addendum-B partition is not poisoned");
});

t("Round 3 #1 — the SAME request with the two sigs SWAPPED (extra first, good second) settles identically: order never decides the winner", async () => {
  const kv = store.memoryKv();
  seedProject(kv, "psi25b", W.MINT1);
  store.write(kv, "psi25b", "days", days({ [W.A]: "1000000000" }));
  const good = txSingle({ wallet: W.A, amountRaw: "1000000000", slot: 201 });
  const extra = txSingle({ wallet: W.A, amountRaw: "50000000000", slot: 202 });
  const app = mountFor({ kv, getTx: async (sig) => (sig === SIG(212) ? good : extra) });
  const exp = await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "psi25b" }, query: { export: "1" } });
  const batchId = exp.body.created.id;
  // EXTRA FIRST this time — SIG(213) is the oversized one, SIG(212) the genuine match.
  const r = await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "psi25b" },
    query: { batch: batchId, sent: JSON.stringify([{ wallet: W.A, sig: SIG(213) }, { wallet: W.A, sig: SIG(212) }]) } });
  assert.deepStrictEqual(r.body.sent.recorded, [W.A], "the genuine transfer still wins the row, wherever it sits in the array");
  const j = store.readJournal(kv);
  assert.strictEqual(Object.keys(j).length, 1, "exactly one journal entry, whichever order the sigs arrived in");
  const entry = Object.values(j)[0];
  assert.strictEqual(entry.sig, SIG(212), "the GOOD sig settled it, not whichever came first");
  assert.strictEqual(entry.excessRaw, "0", "no phantom excess");
  assert.strictEqual(entry.appliedRaw, "1000000000");
  assert.ok(r.body.sent.ignored.some((x) => x.sig === SIG(213) && x.why === "amount_mismatch"), JSON.stringify(r.body.sent.ignored));
  const batch = store.read(kv, "psi25b", "batches", {})[batchId];
  const rec = L.receipt({ projectId: "psi25b", batch: { ...batch, projectId: "psi25b" }, wallet: W.A, journal: j, project: { fundingWallet: W.FUND } });
  assert.strictEqual(rec.totals.excessRaw, "0"); assert.strictEqual(rec.totals.appliedRaw, "1000000000"); assert.strictEqual(rec.totals.remainingRaw, "0");
  const part = L.partition({ projectId: "psi25b", days: store.read(kv, "psi25b", "days", {}), batches: store.read(kv, "psi25b", "batches", {}), journal: j });
  assert.strictEqual(part[W.A].excessRaw, "0");
  const owed = pay.owedNow({ days: store.read(kv, "psi25b", "days", {}), paid: store.read(kv, "psi25b", "paid", {}), pending: store.read(kv, "psi25b", "batches", {}), journal: j, projectId: "psi25b" });
  assert.strictEqual(String(owed[W.A]), "0", "owedNow for the next period is unaffected — nothing left owed, nothing extra absorbed");
});

t("Round 3 #1 — TWO genuine transfers of the exact same amount in one request: the EARLIEST by slot wins, the other is refused as duplicate_settlement_candidate", async () => {
  const kv = store.memoryKv();
  seedProject(kv, "psi25c", W.MINT1);
  store.write(kv, "psi25c", "days", days({ [W.A]: "1000000000" }));
  const later = txSingle({ wallet: W.A, amountRaw: "1000000000", slot: 300 });
  const earlier = txSingle({ wallet: W.A, amountRaw: "1000000000", slot: 100 });
  const app = mountFor({ kv, getTx: async (sig) => (sig === SIG(214) ? later : earlier) });
  const exp = await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "psi25c" }, query: { export: "1" } });
  const batchId = exp.body.created.id;
  // The LATER-slot sig listed FIRST in the array — order must not decide it, slot must.
  const r = await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "psi25c" },
    query: { batch: batchId, sent: JSON.stringify([{ wallet: W.A, sig: SIG(214) }, { wallet: W.A, sig: SIG(215) }]) } });
  assert.deepStrictEqual(r.body.sent.recorded, [W.A]);
  const j = store.readJournal(kv);
  assert.strictEqual(Object.keys(j).length, 1, "only one of the two identical-amount transfers is journaled");
  assert.strictEqual(Object.values(j)[0].sig, SIG(215), "the EARLIER slot won, despite being listed second");
  assert.ok(r.body.sent.ignored.some((x) => x.sig === SIG(214) && x.why === "duplicate_settlement_candidate"), JSON.stringify(r.body.sent.ignored));
});

t("lib/hub/ledger.js settle() itself refuses a transfer against a row whose remaining is already 0 — never writes an applied:0/excess-only entry", () => {
  const batch = { id: "b1", projectId: "chi26", amounts: { [W.A]: "1000000000" } };
  const first = L.settle({ journal: {}, projectId: "chi26", batch, wallet: W.A, transfer: { sig: SIG(220), instructionIndex: 0, amountRaw: "1000000000", slot: 1 }, nowUnix: NOW });
  assert.ok(first.ok);
  const second = L.settle({ journal: first.journal, projectId: "chi26", batch, wallet: W.A, transfer: { sig: SIG(221), instructionIndex: 0, amountRaw: "50000000000", slot: 2 }, nowUnix: NOW });
  assert.strictEqual(second.ok, false);
  assert.strictEqual(second.error, "row_already_settled");
  assert.strictEqual(Object.keys(first.journal).length, 1, "the refused second transfer never entered the journal");
});

section("23. Round 2 #2 — lib/cuna-payout.js has no raw NUL bytes (the owedNow money diff must be reviewable)");

t("lib/cuna-payout.js is a plain text file with no \\x00 byte anywhere", () => {
  const p = path.join(__dirname, "..", "lib", "cuna-payout.js");
  const buf = fs.readFileSync(p);
  const nulAt = buf.indexOf(0);
  assert.strictEqual(nulAt, -1, `found a raw NUL byte at offset ${nulAt} — the money diff becomes invisible to a human reviewer, Codex, and GitHub`);
});

section("24. Round 2 #3 — payoutSources is a project-record field only the OWNER can set, never a desk operator's terms");

t("an operator (desk token, not owner) widening the program version's fundedBy does NOT open the payment-source allowlist any more", async () => {
  const kv = store.memoryKv();
  const secret = "s3cr3t-24";
  seedProject(kv, "om27", W.MINT1);
  let reg = store.readRegistry(kv);
  reg.om27 = { ...reg.om27, access: access.normalizeAccess({ tier: "comped", note: "test" }) };
  store.writeRegistry(kv, reg);
  store.write(kv, "om27", "days", days({ [W.A]: "1000000000" }));
  const token = operator.issueToken(secret, { projectId: "om27", wallet: W.A });
  const strangerTx = txSingle({ wallet: W.A, amountRaw: "1000000000", sourceOwner: W.B });
  const app = mountFor({ kv, secret, adminAuthOK: () => false, getTx: async () => strangerTx });
  let r = await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "om27" }, query: { export: "1" }, headers: { "x-clkn-operator": token } });
  const id0 = r.body.created.id;
  r = await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "om27" }, query: { batch: id0, sent: JSON.stringify([{ wallet: W.A, sig: SIG(230) }]) }, headers: { "x-clkn-operator": token } });
  assert.strictEqual(r.body.sent.recorded.length, 0, "the stranger's transfer is still refused before any operator terms change");
  await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "om27" }, query: { cancel: id0 }, headers: { "x-clkn-operator": token } });
  // The operator widens `fundedBy` on the program version — the ORIGINAL P0-1 narrowing (this is
  // exactly the lever the finding named).
  r = await call(app, "/api/hub/:project/admin", { method: "POST", params: { project: "om27" }, query: { terms: "1", fundedBy: `${W.FUND},${W.B}`, effectiveFrom: "2027-01-15" }, headers: { "x-clkn-operator": token } });
  assert.strictEqual(r.statusCode, 200); assert.strictEqual(r.body.as, W.A, "authOf returns the operator's own wallet, never the owner's");
  r = await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "om27" }, query: { export: "1" }, headers: { "x-clkn-operator": token } });
  const id = r.body.created.id;
  r = await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "om27" }, query: { batch: id, sent: JSON.stringify([{ wallet: W.A, sig: SIG(230) }]) }, headers: { "x-clkn-operator": token } });
  assert.strictEqual(r.body.sent.recorded.length, 0, "widening `fundedBy` through the desk no longer opens the payment-source allowlist");
  assert.strictEqual(Object.keys(store.readJournal(kv)).length, 0);
});

t("the OWNER setting payoutSources through /api/hub-registry (never a desk operator) DOES open the allowlist, and alerts", async () => {
  const kv = store.memoryKv(); const alerts = [];
  seedProject(kv, "pi28", W.MINT1);
  store.write(kv, "pi28", "days", days({ [W.A]: "1000000000" }));
  const app = mountFor({ kv, alerts, adminAuthOK: () => true, getTx: async () => txSingle({ wallet: W.A, amountRaw: "1000000000", sourceOwner: W.B }) });
  // The owner sets payoutSources through the SAME registry admin path a project is registered on
  // — never through /api/hub/:project/admin (the desk operator's path).
  const proj0 = store.readRegistry(kv).pi28;
  const upd = await call(app, "/api/hub-registry", { method: "POST",
    query: { id: "pi28", label: "PI28", symbol: "PI28", mint: proj0.mint, fundingWallet: proj0.fundingWallet, payoutSources: W.B } });
  assert.strictEqual(upd.statusCode, 200, JSON.stringify(upd.body));
  assert.ok(alerts.some((a) => /payoutSources changed by the owner/.test(a)), JSON.stringify(alerts));
  assert.deepStrictEqual(store.readRegistry(kv).pi28.payoutSources, [W.B]);
  assert.strictEqual(store.readRegistry(kv).pi28.payoutSourcesHistory.length, 1);
  let r = await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "pi28" }, query: { export: "1" } });
  const id = r.body.created.id;
  r = await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "pi28" }, query: { batch: id, sent: JSON.stringify([{ wallet: W.A, sig: SIG(240) }]) } });
  assert.deepStrictEqual(r.body.sent.recorded, [W.A], "the owner-set payoutSources wallet is now an accepted source");
  assert.strictEqual(Object.keys(store.readJournal(kv)).length, 1);
  // A later edit that does not mention payoutSources carries the value forward unchanged.
  const upd2 = await call(app, "/api/hub-registry", { method: "POST", query: { id: "pi28", label: "PI28 v2", symbol: "PI28", mint: proj0.mint, fundingWallet: proj0.fundingWallet } });
  assert.strictEqual(upd2.statusCode, 200, JSON.stringify(upd2.body));
  assert.deepStrictEqual(store.readRegistry(kv).pi28.payoutSources, [W.B], "an unrelated edit never clears payoutSources");
});

t("proj.validatePayoutSources refuses more than 5 DISTINCT wallets (dedup happens first) and a bad address", () => {
  assert.deepStrictEqual(proj.validatePayoutSources(Array(6).fill(W.A)), [W.A], "6 copies of the same wallet dedup to 1 — not a violation");
  const sixDistinct = ["1111111111111111111111111111111111111112", "SysvarC1ock11111111111111111111111111111", "SysvarRent111111111111111111111111111111",
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", W.A];
  assert.throws(() => proj.validatePayoutSources(sixDistinct), /at most 5/);
  assert.throws(() => proj.validatePayoutSources(["not-an-address"]), /payoutSources entry/);
});

t("a self-serve /hub-apply application can never smuggle payoutSources onto its own project — validateProject never reads it from input", () => {
  const project = proj.validateProject({ id: "rho29", label: "RHO", symbol: "RHO", mint: W.MINT1, fundingWallet: W.FUND, operatorWallets: [W.A], payoutSources: [W.B] }, { decimals: 9, tokenProgram: TOK, extensions: [] });
  assert.deepStrictEqual(project.payoutSources, [], "payoutSources on the input is silently ignored by validateProject");
});

section("25. Round 2 #4 — managed-payer (&send=/&sweep=) broadcasts are journaled, never refused for OUR OWN signature");

t("&send= from a vault whose operator wallet is NOT the project's fundingWallet still journals (the vault's own wallet is an allowed source for THIS project's send)", async () => {
  const kv = store.memoryKv(); const alerts = [];
  seedProject(kv, "sig30", W.MINT1);
  store.write(kv, "sig30", "days", days({ [W.A]: "1000000000" }));
  const tx = txSingle({ wallet: W.A, amountRaw: "1000000000", sourceOwner: W.B });   // W.B signs, NOT fundingWallet
  const vault = {
    operatorPubkey: (id) => (id === "treasury" ? W.B : null),
    payoutSpl: async ({ recipients, dryRun, onPaid }) => {
      if (dryRun) return { action: "would-pay", recipients };
      const paid = [];
      for (const rr of recipients) { const sig = SIG(250); onPaid({ wallet: rr.wallet, sig, pending: true }); onPaid({ wallet: rr.wallet, sig }); paid.push({ wallet: rr.wallet, sig, amountUi: rr.amountUi }); }
      return { action: "paid", paid, pending: [], failed: [] };
    },
  };
  const app = mountFor({ kv, alerts, vault, getTx: async () => tx });
  let r = await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "sig30" }, query: { export: "1" } });
  const id = r.body.created.id;
  r = await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "sig30" }, query: { send: id, from: "treasury", run: "1" } });
  assert.strictEqual(r.body.send.journal[0].journaled, true, JSON.stringify(r.body.send.journal));
  assert.strictEqual(Object.keys(store.readJournal(kv)).length, 1);
  assert.strictEqual(alerts.filter((a) => /journal refused/.test(a)).length, 0);
});

t("&send= does NOT accept a DIFFERENT vault project's operator wallet as this project's source", async () => {
  const kv = store.memoryKv(); const alerts = [];
  seedProject(kv, "tau31", W.MINT1);
  store.write(kv, "tau31", "days", days({ [W.A]: "1000000000" }));
  const tx = txSingle({ wallet: W.A, amountRaw: "1000000000", sourceOwner: W.B });
  const vault = {
    operatorPubkey: (id) => (id === "some-other-vault" ? W.B : null),   // "treasury" resolves to null — not W.B
    payoutSpl: async ({ recipients, dryRun, onPaid }) => {
      if (dryRun) return { action: "would-pay", recipients };
      const paid = [];
      for (const rr of recipients) { const sig = SIG(251); onPaid({ wallet: rr.wallet, sig, pending: true }); onPaid({ wallet: rr.wallet, sig }); paid.push({ wallet: rr.wallet, sig, amountUi: rr.amountUi }); }
      return { action: "paid", paid, pending: [], failed: [] };
    },
  };
  const app = mountFor({ kv, alerts, vault, getTx: async () => tx });
  let r = await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "tau31" }, query: { export: "1" } });
  const id = r.body.created.id;
  r = await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "tau31" }, query: { send: id, from: "treasury", run: "1" } });
  assert.strictEqual(r.body.send.journal[0].journaled, false);
  assert.strictEqual(Object.keys(store.readJournal(kv)).length, 0);
  assert.ok(alerts.some((a) => /journal refused/.test(a)));
});

t("&sweep= accepts the project's OWN named vaultProject's operator wallet (superseded by N4/Round 3 — it used to accept ANY vault operator; see section 29)", async () => {
  const kv = store.memoryKv(); const alerts = [];
  seedProject(kv, "ups32", W.MINT1);
  let reg32 = store.readRegistry(kv); reg32.ups32 = { ...reg32.ups32, vaultProject: "ups32-vault" }; store.writeRegistry(kv, reg32);
  store.write(kv, "ups32", "days", days({ [W.A]: "1000000000" }));
  store.write(kv, "ups32", "batches", { b1: { id: "b1", state: "pending", at: NOW, count: 1, totalRaw: "1000000000",
    amounts: { [W.A]: "1000000000" }, sent: { [W.A]: { sig: SIG(252), at: NOW, pending: true } } } });
  store.write(kv, "ups32", "paid", { [W.A]: "1000000000" });
  const tx = txSingle({ wallet: W.A, amountRaw: "1000000000", sourceOwner: W.B });
  const vault = { operatorPubkey: (id) => (id === "ups32-vault" ? W.B : null), payoutSpl: async () => ({ action: "none" }) };
  const app = mountFor({ kv, alerts, vault, getTx: async () => tx,
    scanDeps: async () => ({ scan: async () => [] }) });
  // sweep uses connection().getSignatureStatuses — build a bespoke app with that stubbed to confirm.
  const app2 = fakeApp();
  routes.mount(app2, {
    kv, adminAuthOK: () => true, publicErrMsg: (e) => e.message, secret: "s", vault,
    connection: () => ({ getSignatureStatuses: async () => ({ value: [{ confirmationStatus: "finalized", err: null }] }) }),
    scanDeps: async () => ({ scan: async () => [] }), getTx: async () => tx, alert: (m) => alerts.push(m), nowUnix: () => NOW,
  });
  const r = await call(app2, "/api/hub/:project/payout", { method: "POST", params: { project: "ups32" }, query: { batch: "b1", sweep: "1" } });
  assert.strictEqual(r.body.sweep.journal[0].journaled, true, JSON.stringify(r.body.sweep));
  assert.strictEqual(Object.keys(store.readJournal(kv)).length, 1);
});

section("26. Round 2 #5 — the fraud-signal alert fires for BOTH named `why` values, not just row_not_in_batch");

t("a stranger's top-level transfer (transfer_not_from_funding_wallet, adv P0-1) alerts even though it never reaches recordSent", async () => {
  const kv = store.memoryKv(); const alerts = [];
  seedProject(kv, "phi33", W.MINT1);
  store.write(kv, "phi33", "days", days({ [W.A]: "1000000000" }));
  const app = mountFor({ kv, alerts, getTx: async () => txSingle({ wallet: W.A, amountRaw: "1000000000", sourceOwner: W.B }) });
  let r = await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "phi33" }, query: { export: "1" } });
  const id = r.body.created.id;
  await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "phi33" }, query: { batch: id, sent: JSON.stringify([{ wallet: W.A, sig: SIG(260) }]) } });
  assert.ok(alerts.some((a) => /settlement REFUSED/.test(a) && /transfer_not_from_funding_wallet/.test(a)), JSON.stringify(alerts));
});

t("a cross-project signature-reuse attempt (adv P0-2a) alerts too — it used to be caught silently", async () => {
  const kv = store.memoryKv(); const alerts = [];
  const MINT_C = "6zro2xbCxMFVvygCsj5FZMgZnVCb8EqcbPGTbSGCgDBc"; // a distinct LOCKED mint, same reward mint as MINT_B's sibling below
  seedProjectReward(kv, "chi34", MINT_B, W.MINT1);
  seedProjectReward(kv, "psi34", MINT_C, W.MINT1);
  store.write(kv, "chi34", "days", days({ [W.A]: "1000000000" }));
  store.write(kv, "psi34", "days", days({ [W.A]: "1000000000" }));
  const tx = txSingle({ wallet: W.A, amountRaw: "1000000000" });
  const app = mountFor({ kv, alerts, getTx: async () => tx });
  let r = await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "chi34" }, query: { export: "1" } });
  await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "chi34" }, query: { batch: r.body.created.id, sent: JSON.stringify([{ wallet: W.A, sig: SIG(261) }]) } });
  alerts.length = 0;
  r = await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "psi34" }, query: { export: "1" } });
  r = await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "psi34" }, query: { batch: r.body.created.id, sent: JSON.stringify([{ wallet: W.A, sig: SIG(261) }]) } });
  assert.ok(alerts.some((a) => /settlement REFUSED/.test(a) && /transfer_already_consumed/.test(a)), JSON.stringify(alerts));
  assert.strictEqual(r.body.sent.recorded.length, 0);
});

section("27. Round 2 #6 — the lock-key namespace no longer collides with the journal's own kv prefix");

t("a project id of 'settle' is refused outright (approveProject)", () => {
  assert.throws(() => proj.approveProject({}, proj.validateProject({ id: "settle", label: "SETTLE", symbol: "STL", mint: W.MINT1, fundingWallet: W.FUND, operatorWallets: [W.A] }, { decimals: 9, tokenProgram: TOK, extensions: [] }), { nowUnix: NOW }), /reserved/);
});

t("the payout lock key lives under hublock:, never inside the journal's hub:settle: prefix", async () => {
  const kv = store.memoryKv();
  seedProject(kv, "upsilon35", W.MINT1);
  store.write(kv, "upsilon35", "days", days({ [W.A]: "1000000000" }));
  const app = mountFor({ kv, getTx: async () => txSingle({ wallet: W.A, amountRaw: "1000000000" }) });
  // Simulate a held lock exactly as the route would while a request is in flight.
  kv.set("hublock:upsilon35:payout", { at: Date.now(), token: "held" });
  const j = store.readJournal(kv);
  assert.strictEqual(Object.keys(j).length, 0, "the lock row is not under the journal's own prefix, and would be filtered by shape even if it were");
  const r = await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "upsilon35" }, query: { export: "1" } });
  assert.strictEqual(r.statusCode, 409, "the lock, from ANY source under this key, still serialises the route");
});

t("store.readJournal ignores a non-journal-shaped value even under the legacy JOURNAL_KEY blob or the JOURNAL_PREFIX", () => {
  const kv = store.memoryKv();
  store.writeJournal(kv, { "settle:payout": { at: Date.now(), token: "held" } });
  kv.set(store.journalEntryKey("settle:bogus:0"), { at: Date.now(), token: "held" });
  assert.deepStrictEqual(store.readJournal(kv), {}, "neither lock-shaped value is read back as a settlement");
});

section("28. N1 (docs/HUB_JOURNAL_VERIFY_2026-09-18.md, Round 3) — one alert per request, and the payout route is rate-limited");

t("23 stranger-sourced rows in ONE &sent= request raise exactly ONE operator alert, not 23", async () => {
  const kv = store.memoryKv();
  seedProject(kv, "n1a", W.MINT1);
  const N = 23;
  const wallets = Array.from({ length: N }, (_, i) => "n1wallet" + String(i).padStart(3, "0"));
  store.write(kv, "n1a", "days", days(Object.fromEntries(wallets.map((w) => [w, "1000000000"]))));
  const alerts = [];
  const sigFor = (i) => SIG(400 + i);
  const txBySig = new Map(wallets.map((w, i) => [sigFor(i), txSingle({ wallet: w, amountRaw: "1000000000", sourceOwner: W.B })]));
  const app = mountFor({ kv, alerts, getTx: async (sig) => txBySig.get(sig) || null });
  const exp = await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "n1a" }, query: { export: "1" } });
  const batchId = exp.body.created.id;
  const sent = wallets.map((w, i) => ({ wallet: w, sig: sigFor(i) }));
  const r = await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "n1a" }, query: { batch: batchId, sent: JSON.stringify(sent) } });
  assert.deepStrictEqual(r.body.sent.recorded, [], "every row refused — all stranger-sourced");
  assert.strictEqual(r.body.sent.ignored.filter((x) => x.why === "transfer_not_from_funding_wallet").length, N, "all 23 refusals are still reported back to the caller");
  const fraudAlerts = alerts.filter((a) => /settlement REFUSED/.test(a));
  assert.strictEqual(fraudAlerts.length, 1, "exactly one summary alert, not one per rejected row: " + JSON.stringify(alerts));
  assert.ok(new RegExp(`${N} settlement REFUSED`).test(fraudAlerts[0]), fraudAlerts[0]);
  assert.ok(/transfer_not_from_funding_wallet/.test(fraudAlerts[0]), fraudAlerts[0]);
});

t("POST /api/hub/:project/payout is rate-limited per IP like every other write route on this mount", async () => {
  const kv = store.memoryKv();
  seedProject(kv, "n1b", W.MINT1);
  const rateLimit = fakeRateLimit();
  const app = mountFor({ kv, rateLimit });
  let last;
  for (let i = 0; i < 35; i++) last = await call(app, "/api/hub/:project/payout", { method: "GET", params: { project: "n1b" }, query: {} });
  assert.strictEqual(last.statusCode, 429, "a burst past the limiter's max is refused");
});

section("29. N4 (docs/HUB_JOURNAL_VERIFY_2026-09-18.md, Round 3) — &sweep= is pinned to the project's OWN vaultProject, never every vault operator");

t("&sweep= accepts the named vaultProject's operator wallet, and refuses an unrelated vault's", async () => {
  const kv = store.memoryKv();
  seedProject(kv, "n4a", W.MINT1);
  // vaultProject is owner-set only (never read from validateProject's own input, same discipline
  // as payoutSources) — set it directly on the registry row, exactly as /api/hub-registry would.
  let reg4a = store.readRegistry(kv); reg4a.n4a = { ...reg4a.n4a, vaultProject: "treasury" }; store.writeRegistry(kv, reg4a);
  store.write(kv, "n4a", "batches", { b1: { id: "b1", state: "pending", at: NOW, count: 1, totalRaw: "1000000000",
    amounts: { [W.A]: "1000000000" }, sent: { [W.A]: { sig: SIG(420), at: NOW, pending: true } } } });
  store.write(kv, "n4a", "paid", { [W.A]: "1000000000" });
  const tx = txSingle({ wallet: W.A, amountRaw: "1000000000", sourceOwner: W.B });
  const vault = { operatorPubkey: (id) => (id === "treasury" ? W.B : null) };
  const app2 = fakeApp();
  routes.mount(app2, {
    kv, adminAuthOK: () => true, publicErrMsg: (e) => e.message, secret: "s", vault,
    connection: () => ({ getSignatureStatuses: async () => ({ value: [{ confirmationStatus: "finalized", err: null }] }) }),
    scanDeps: async () => ({ scan: async () => [] }), getTx: async () => tx, alert: () => {}, nowUnix: () => NOW,
  });
  const r = await call(app2, "/api/hub/:project/payout", { method: "POST", params: { project: "n4a" }, query: { batch: "b1", sweep: "1" } });
  assert.strictEqual(r.body.sweep.journal[0].journaled, true, JSON.stringify(r.body.sweep));
});

t("&sweep= with NO vaultProject set accepts only the funding wallet + payoutSources — never any vault operator", async () => {
  const kv = store.memoryKv();
  seedProject(kv, "n4b", W.MINT1);   // no vaultProject
  store.write(kv, "n4b", "batches", { b1: { id: "b1", state: "pending", at: NOW, count: 1, totalRaw: "1000000000",
    amounts: { [W.A]: "1000000000" }, sent: { [W.A]: { sig: SIG(421), at: NOW, pending: true } } } });
  store.write(kv, "n4b", "paid", { [W.A]: "1000000000" });
  const tx = txSingle({ wallet: W.A, amountRaw: "1000000000", sourceOwner: W.B });   // W.B is SOME vault's operator, just not named
  const vault = { operatorPubkey: (id) => (id === "some-vault" ? W.B : null) };
  const app2 = fakeApp();
  routes.mount(app2, {
    kv, adminAuthOK: () => true, publicErrMsg: (e) => e.message, secret: "s", vault,
    connection: () => ({ getSignatureStatuses: async () => ({ value: [{ confirmationStatus: "finalized", err: null }] }) }),
    scanDeps: async () => ({ scan: async () => [] }), getTx: async () => tx, alert: () => {}, nowUnix: () => NOW,
  });
  const r = await call(app2, "/api/hub/:project/payout", { method: "POST", params: { project: "n4b" }, query: { batch: "b1", sweep: "1" } });
  assert.strictEqual(r.body.sweep.journal[0].journaled, false, JSON.stringify(r.body.sweep));
});

t("&vaultProject= is owner-set via /api/hub-registry, carried forward on an unrelated edit, and validated as a short lowercase id", async () => {
  const kv = store.memoryKv();
  seedProject(kv, "n4c", W.MINT1);
  const app = mountFor({ kv });
  const set = await call(app, "/api/hub-registry", { method: "POST", query: { id: "n4c", label: "N4C", symbol: "N4C", mint: W.MINT1, fundingWallet: W.FUND, vaultProject: "Treasury " } });
  assert.strictEqual(set.statusCode, 200, JSON.stringify(set.body));
  assert.strictEqual(store.readRegistry(kv).n4c.vaultProject, "treasury", "normalized to lowercase, trimmed");
  const edit = await call(app, "/api/hub-registry", { method: "POST", query: { id: "n4c", label: "N4C renamed", symbol: "N4C", mint: W.MINT1, fundingWallet: W.FUND } });
  assert.strictEqual(edit.statusCode, 200, JSON.stringify(edit.body));
  assert.strictEqual(store.readRegistry(kv).n4c.vaultProject, "treasury", "an unrelated edit carries vaultProject forward unchanged");
});

section("30. N2 (docs/HUB_JOURNAL_VERIFY_2026-09-18.md, Round 3) — an application cannot take over an existing project");

t("POST /api/hub-registry?approve= refuses 409 project_exists when the id was registered AFTER the application was filed (the stale-application race N2 describes)", async () => {
  const kv = store.memoryKv();
  const app = mountFor({ kv });
  // The application is filed FIRST, while "n2a" is not yet a project — /api/hub-apply's own
  // "id is taken" check (routes.js, unrelated to this finding) cannot see a race that hasn't
  // happened yet, which is exactly how a stale application ends up pointed at an id that gets
  // registered later, by a completely different route.
  const apply = await call(app, "/api/hub-apply", { method: "POST",
    query: { id: "n2a", label: "Impostor", symbol: "IMP", mint: "6zro2xbCxMFVvygCsj5FZMgZnVCb8EqcbPGTbSGCgDBc", fundingWallet: W.B, operatorWallets: W.B, contact: "@impostor", terms: { poolDailyRaw: "1" } } });
  assert.strictEqual(apply.statusCode, 200, JSON.stringify(apply.body));
  const appId = apply.body.application.id;
  // NOW "n2a" gets registered for real, but WITHOUT a program version yet — exactly the
  // "registry-seeded, not-yet-termed project" the finding names (seedProject() always creates v1,
  // which would trip routes.js's OLDER, narrower "already has program versions" 409 instead of
  // reaching the code this test is actually pinning).
  const seeded = proj.validateProject({ id: "n2a", label: "N2A", symbol: "N2A", mint: MINT_B, fundingWallet: W.FUND, operatorWallets: [W.A] }, { decimals: 9, tokenProgram: TOK, extensions: [] });
  store.writeRegistry(kv, proj.approveProject(store.readRegistry(kv) || {}, seeded, { nowUnix: NOW }));
  const beforeFundingWallet = store.readRegistry(kv).n2a.fundingWallet;
  const r = await call(app, "/api/hub-registry", { method: "POST", query: { approve: appId } });
  assert.strictEqual(r.statusCode, 409, JSON.stringify(r.body));
  assert.ok(/project_exists|already exists/.test(r.body.error), r.body.error);
  assert.strictEqual(store.readRegistry(kv).n2a.fundingWallet, beforeFundingWallet, "the existing project's fundingWallet is untouched");
  assert.strictEqual(store.readRegistry(kv).n2a.payoutSourcesHistory.length, 0, "and its (empty) payoutSourcesHistory was not reset by the refused approval");
});

t("payoutSourcesHistory survives every other mutating registry/admin write on the same project — append-only, never reset", async () => {
  const kv = store.memoryKv();
  seedProject(kv, "n2b", W.MINT1);
  const app = mountFor({ kv });
  const proj0 = store.readRegistry(kv).n2b;
  await call(app, "/api/hub-registry", { method: "POST", query: { id: "n2b", label: "N2B", symbol: "N2B", mint: proj0.mint, fundingWallet: proj0.fundingWallet, payoutSources: W.B } });
  const grown = store.readRegistry(kv).n2b.payoutSourcesHistory.length;
  assert.strictEqual(grown, 1);
  // suspend + admin terms=1 (a desk operator/owner write to a DIFFERENT kv part, "state") — neither
  // path may shrink or reset the registry row's payoutSourcesHistory.
  await call(app, "/api/hub-registry", { method: "POST", query: { suspend: "n2b" } });
  assert.strictEqual(store.readRegistry(kv).n2b.payoutSourcesHistory.length, grown, "suspend preserves history");
  store.writeRegistry(kv, { ...store.readRegistry(kv), n2b: { ...store.readRegistry(kv).n2b, status: "approved" } });   // un-suspend for the next call
  await call(app, "/api/hub/:project/admin", { method: "POST", params: { project: "n2b" }, query: { terms: "1", poolDailyRaw: "5" } });
  assert.strictEqual(store.readRegistry(kv).n2b.payoutSourcesHistory.length, grown, "an admin terms write never touches the registry row's history");
  assert.deepStrictEqual(store.readRegistry(kv).n2b.payoutSources, [W.B], "and payoutSources itself is unchanged by an unrelated write");
});

section("31. N3 (docs/HUB_JOURNAL_VERIFY_2026-09-18.md, Round 3) — payoutSources is echoed publicly; history only on the owner's own registry read");

t("publicProject() echoes payoutSources everywhere; payoutSourcesHistory is added only with {full:true}, which /api/hub-registry alone passes", async () => {
  const kv = store.memoryKv();
  seedProject(kv, "n3a", W.MINT1);
  const app = mountFor({ kv, adminAuthOK: () => true });
  const set = await call(app, "/api/hub-registry", { method: "POST", query: { id: "n3a", label: "N3A", symbol: "N3A", mint: W.MINT1, fundingWallet: W.FUND, payoutSources: W.B } });
  assert.strictEqual(set.statusCode, 200, JSON.stringify(set.body));
  const reg = await call(app, "/api/hub-registry", { method: "GET", query: {} });
  const row = reg.body.projects.find((x) => x.id === "n3a");
  assert.deepStrictEqual(row.payoutSources, [W.B], "the owner's own registry read echoes payoutSources");
  assert.ok(Array.isArray(row.payoutSourcesHistory) && row.payoutSourcesHistory.length === 1, "and the full history, since this call passes {full:true}");
  const desk = await call(app, "/api/hub/:project/desk", { method: "GET", params: { project: "n3a" }, query: {} });
  assert.deepStrictEqual(desk.body.project.payoutSources, [W.B], "an operator/owner desk view also sees payoutSources — it is not secret");
  assert.strictEqual(desk.body.project.payoutSourcesHistory, undefined, "but not the full history, outside the owner registry read");
});

section("32. N-2 (docs/HUB_JOURNAL_VERIFY_2026-09-18.md, Round 4) — a suspended, never-termed project id is no longer takeable");

t("a self-serve application can no longer take over a SUSPENDED, never-termed project id and inherit its days/paid store", async () => {
  const kv = store.memoryKv();
  // Seeded WITHOUT a state/version (unlike seedProject) — a suspended project that was never
  // termed, exactly the gap N-2 named. approveProject directly, never through the route, so the
  // routes.js "already has program versions" pre-check (a DIFFERENT, older guard) never fires and
  // this test actually exercises proj.approveProject's own requireNew path.
  const p = proj.validateProject({ id: "beta", label: "Beta", symbol: "BETA", mint: W.MINT1, fundingWallet: W.FUND, operatorWallets: [W.A] }, { decimals: 9, tokenProgram: TOK, extensions: [] });
  store.writeRegistry(kv, proj.approveProject({}, p, { nowUnix: NOW }));
  const reg0 = store.readRegistry(kv); store.writeRegistry(kv, { ...reg0, beta: { ...reg0.beta, status: "suspended" } });
  store.write(kv, "beta", "days", days({ [W.A]: "1000000000" }));
  store.write(kv, "beta", "paid", { [W.A]: "500000000" });
  const app = mountFor({ kv, adminAuthOK: () => true });
  const apply = await call(app, "/api/hub-apply", { method: "POST",
    query: { id: "beta", label: "Takeover", symbol: "TKO", mint: MINT_B, fundingWallet: W.B, operatorWallets: W.B, contact: "@impostor", terms: { poolDailyRaw: "1000000000000" } } });
  assert.strictEqual(apply.statusCode, 200, JSON.stringify(apply.body));
  const appId = apply.body.application.id;
  const r = await call(app, "/api/hub-registry", { method: "POST", query: { approve: appId } });
  assert.strictEqual(r.statusCode, 409, JSON.stringify(r.body));
  assert.ok(/project_exists|already exists/.test(r.body.error), r.body.error);
  assert.strictEqual(store.readRegistry(kv).beta.fundingWallet, W.FUND, "the suspended project's fundingWallet is untouched");
  assert.strictEqual(store.read(kv, "beta", "paid", {})[W.A], "500000000", "and its ledger was never inherited by the applicant");
});

t("the owner's own re-approve of the SAME (id, mint) still works after N-2", async () => {
  const kv = store.memoryKv();
  seedProject(kv, "gamma", W.MINT1);
  const app = mountFor({ kv, adminAuthOK: () => true });
  const r = await call(app, "/api/hub-registry", { method: "POST", query: { id: "gamma", label: "Gamma Renamed", symbol: "GAMMA", mint: W.MINT1, fundingWallet: W.FUND } });
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  assert.strictEqual(store.readRegistry(kv).gamma.label, "Gamma Renamed");
});

t("N-2: the owner re-issuing a suspended id to a NEW mint is refused while the id's store still holds data", async () => {
  const kv = store.memoryKv();
  const p = proj.validateProject({ id: "delta", label: "Delta", symbol: "DELTA", mint: W.MINT1, fundingWallet: W.FUND, operatorWallets: [W.A] }, { decimals: 9, tokenProgram: TOK, extensions: [] });
  store.writeRegistry(kv, proj.approveProject({}, p, { nowUnix: NOW }));
  const reg0 = store.readRegistry(kv); store.writeRegistry(kv, { ...reg0, delta: { ...reg0.delta, status: "suspended" } });
  store.write(kv, "delta", "days", days({ [W.A]: "1000000000" }));
  const app = mountFor({ kv, adminAuthOK: () => true });
  const r = await call(app, "/api/hub-registry", { method: "POST", query: { id: "delta", label: "Delta II", symbol: "DELTA", mint: MINT_B, fundingWallet: W.B } });
  assert.strictEqual(r.statusCode, 409, JSON.stringify(r.body));
  assert.strictEqual(store.readRegistry(kv).delta.mint, W.MINT1, "the mint was never changed");
});

t("N-2: …and is allowed once the id's store is completely empty", async () => {
  const kv = store.memoryKv();
  const p = proj.validateProject({ id: "epsilon", label: "Epsilon", symbol: "EPS", mint: W.MINT1, fundingWallet: W.FUND, operatorWallets: [W.A] }, { decimals: 9, tokenProgram: TOK, extensions: [] });
  store.writeRegistry(kv, proj.approveProject({}, p, { nowUnix: NOW }));
  const reg0 = store.readRegistry(kv); store.writeRegistry(kv, { ...reg0, epsilon: { ...reg0.epsilon, status: "suspended" } });
  assert.strictEqual(store.storeIsEmptyFor(kv, "epsilon"), true, "nothing was ever written for this id");
  const app = mountFor({ kv, adminAuthOK: () => true });
  const r = await call(app, "/api/hub-registry", { method: "POST", query: { id: "epsilon", label: "Epsilon II", symbol: "EPS", mint: MINT_B, fundingWallet: W.B } });
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  assert.strictEqual(store.readRegistry(kv).epsilon.mint, MINT_B);
});

(async () => {
  for (const [n, f] of queue) {
    if (!f) { console.log("\n" + n); continue; }
    try { await f(); console.log("  ✓ " + n); pass++; }
    catch (e) { console.log("  ✗ " + n + "\n      " + (e.stack || e.message).split("\n").slice(0, 6).join("\n      ")); fail++; }
  }
  console.log(`\n${fail === 0 ? "all passed" : fail + " FAILED"} (${pass} passed)`);
  process.exit(fail ? 1 : 0);
})();
