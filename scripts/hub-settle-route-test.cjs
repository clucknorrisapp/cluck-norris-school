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
const assert = require("assert");
const store = require("../lib/hub/store");
const proj = require("../lib/hub/project");
const L = require("../lib/hub/ledger");
const attempts = require("../lib/hub/attempts");
const settle = require("../lib/hub/settle");
const payoutVerify = require("../lib/payout-verify");
const pay = require("../lib/cuna-payout");
const routes = require("../lib/hub/routes");

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
const tokenTransfer = (destination, amount, extra = {}) => ({ program: "spl-token", parsed: { type: "transfer", info: { source: "SrcAta1111111111111111111111111111111", destination, authority: W.PAYER, amount: String(amount) } }, ...extra });
const bal = (accountIndex, owner, amount, mint = W.MINT1) => ({ accountIndex, mint, owner, uiTokenAmount: { amount: String(amount) } });
// One recipient, one top-level transfer instruction — the exact shape lib/whirlpool-vault.js
// payoutSpl (prepareOne) and, usually, the airdropper construct.
function txSingle({ wallet = W.A, amountRaw = "1000000000", slot = 42, err = null } = {}) {
  return {
    slot, blockTime: NOW,
    meta: { err, preTokenBalances: [bal(1, wallet, 0)], postTokenBalances: [bal(1, wallet, amountRaw)] },
    transaction: { message: { accountKeys: [W.PAYER, W.DEST1], instructions: [tokenTransfer(W.DEST1, amountRaw)] } },
  };
}
// Two recipients, two top-level instructions, ONE signature — the airdropper's batched-transaction
// shape (public/airdrop-engine.js planBatches).
function txBatched({ a = { wallet: W.A, amountRaw: "1000000000" }, b = { wallet: W.B, amountRaw: "2000000000" } } = {}) {
  return {
    slot: 43, blockTime: NOW,
    meta: { err: null, preTokenBalances: [bal(1, a.wallet, 0), bal(2, b.wallet, 0)], postTokenBalances: [bal(1, a.wallet, a.amountRaw), bal(2, b.wallet, b.amountRaw)] },
    transaction: { message: { accountKeys: [W.PAYER, W.DEST1, W.DEST2], instructions: [tokenTransfer(W.DEST1, a.amountRaw), tokenTransfer(W.DEST2, b.amountRaw)] } },
  };
}
// A CPI-wrapped transfer: the top-level instruction is some other program; the actual SPL transfer
// is an inner instruction.
function txInner({ wallet = W.A, amountRaw = "1000000000" } = {}) {
  return {
    slot: 44, blockTime: NOW,
    meta: { err: null, preTokenBalances: [bal(2, wallet, 0)], postTokenBalances: [bal(2, wallet, amountRaw)],
      innerInstructions: [{ index: 0, instructions: [tokenTransfer(W.DEST1, amountRaw)] }] },
    transaction: { message: { accountKeys: [W.PAYER, "SomeOtherProgram1111111111111111111111111", W.DEST1], instructions: [{ program: "some-wrapper", parsed: null }] } },
  };
}
// Two transfers into two DIFFERENT token accounts both owned by the SAME wallet, in one signature —
// ambiguous: which one is "this row's" payment cannot be told apart from chain data alone.
function txAmbiguous({ wallet = W.A } = {}) {
  return {
    slot: 45, blockTime: NOW,
    meta: { err: null, preTokenBalances: [bal(1, wallet, 0), bal(2, wallet, 0)], postTokenBalances: [bal(1, wallet, "50"), bal(2, wallet, "50")] },
    transaction: { message: { accountKeys: [W.PAYER, W.DEST1, W.DEST2], instructions: [tokenTransfer(W.DEST1, "50"), tokenTransfer(W.DEST2, "50")] } },
  };
}

section("1. locateTransferInstruction — the chain's own identity, never a guessed index");

t("a single-recipient transaction locates instructionIndex 0, innerIndex null", () => {
  const r = payoutVerify.locateTransferInstruction(txSingle({ wallet: W.A, amountRaw: "1000000000" }), { mint: W.MINT1, wallet: W.A });
  assert.deepStrictEqual(r, { instructionIndex: 0, innerIndex: null, amountRaw: "1000000000", slot: 42 });
});

t("a batched (two-recipient) transaction locates each wallet's OWN instruction — no cross-contamination", () => {
  const tx = txBatched({ a: { wallet: W.A, amountRaw: "1000000000" }, b: { wallet: W.B, amountRaw: "2000000000" } });
  const ra = payoutVerify.locateTransferInstruction(tx, { mint: W.MINT1, wallet: W.A });
  const rb = payoutVerify.locateTransferInstruction(tx, { mint: W.MINT1, wallet: W.B });
  assert.strictEqual(ra.instructionIndex, 0); assert.strictEqual(ra.amountRaw, "1000000000");
  assert.strictEqual(rb.instructionIndex, 1); assert.strictEqual(rb.amountRaw, "2000000000");
});

t("a CPI (inner-instruction) transfer locates instructionIndex + innerIndex", () => {
  const r = payoutVerify.locateTransferInstruction(txInner({ wallet: W.A, amountRaw: "777" }), { mint: W.MINT1, wallet: W.A });
  assert.deepStrictEqual(r, { instructionIndex: 0, innerIndex: 0, amountRaw: "777", slot: 44 });
});

t("two transfers to the same wallet in one signature are AMBIGUOUS — never a guess, returns null", () => {
  assert.strictEqual(payoutVerify.locateTransferInstruction(txAmbiguous({ wallet: W.A }), { mint: W.MINT1, wallet: W.A }), null);
});

t("a failed transaction, or no match, returns null — never a fabricated identity", () => {
  assert.strictEqual(payoutVerify.locateTransferInstruction(txSingle({ err: { InstructionError: [0, "Custom"] } }), { mint: W.MINT1, wallet: W.A }), null);
  assert.strictEqual(payoutVerify.locateTransferInstruction(txSingle({ wallet: W.A, amountRaw: "1000000000" }), { mint: W.MINT1, wallet: W.B }), null);
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
  assert.strictEqual(store.writeManyVerifiedMixed(kv, "alpha", { batches: { x: 1 }, paid: { y: 2 } }, { [store.JOURNAL_KEY]: { z: 3 } }), true);
  assert.deepStrictEqual(store.read(kv, "alpha", "batches", null), { x: 1 });
  assert.deepStrictEqual(store.read(kv, "alpha", "paid", null), { y: 2 });
  assert.deepStrictEqual(store.readJournal(kv), { z: 3 });
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
  const handlers = new Map();   // path -> handler (app.all/app.get both just need "the" handler; the
                                 // route itself branches on req.method, exactly as Express would call it)
  return { get: (p, h) => handlers.set(p, h), all: (p, h) => handlers.set(p, h), handlers };
}
function fakeRes() {
  const r = { statusCode: 200 };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = () => {};
  return r;
}
async function call(app, path, { method = "GET", params = {}, query = {}, body = {} } = {}) {
  const h = app.handlers.get(path);
  if (!h) throw new Error(`no handler mounted for ${path}`);
  const req = { method, params, query, body, headers: {}, cluckDirect: false };
  const res = fakeRes();
  await h(req, res);
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
function flakyKv(kv, { failOnKeys }) {
  return {
    ...kv,
    setManyVerified: (entries) => (Object.keys(entries).some((k) => failOnKeys.has(k)) ? false : kv.setManyVerified(entries)),
  };
}

function mountFor({ kv, getTx = async () => null, vault = fakeVault(), alerts = [] } = {}) {
  const app = fakeApp();
  routes.mount(app, {
    kv, adminAuthOK: () => true, publicErrMsg: (e) => (e && e.message) || String(e),
    vault, connection: () => ({ getSignatureStatuses: async () => ({ value: [] }), getParsedTokenAccountsByOwner: async () => ({ value: [] }) }),
    scanDeps: async () => ({}), getTx, alert: (m) => alerts.push(m),
  });
  return app;
}
function seedProject(kv, id, mint, over = {}) {
  const p = proj.validateProject({ id, label: id.toUpperCase(), symbol: id.toUpperCase().slice(0, 6), mint, fundingWallet: W.FUND, operatorWallets: [W.A], ...over }, { decimals: 9, tokenProgram: TOK, extensions: [] });
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
  for (const q of [{ export: "1" }, { sent: JSON.stringify([{ wallet: W.A, sig: SIG(1) }]), batch: "x" }, { sweep: "1", batch: "x" }, { confirm: "x" }, { cancel: "x" }]) {
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
  // clear message — never a generic error, never a partial write.
  const kv1raw = store.memoryKv(dump);
  const kv1 = flakyKv(kv1raw, { failOnKeys: new Set([store.JOURNAL_KEY]) });
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

t("an overpaid transfer records excess, caps applied, and never touches accrued", async () => {
  const kv = store.memoryKv();
  seedProject(kv, "alpha", W.MINT1);
  store.write(kv, "alpha", "days", days({ [W.A]: "1000000000" }));
  const app = mountFor({ kv, getTx: async () => txSingle({ wallet: W.A, amountRaw: "1200000000" }) });   // 200000000 more than owed
  const exp = await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "alpha" }, query: { export: "1" } });
  const batchId = exp.body.created.id;
  await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "alpha" }, query: { sent: JSON.stringify([{ wallet: W.A, sig: SIG(14) }]), batch: batchId } });
  const j = store.readJournal(kv);
  const entry = Object.values(j).find((e) => e.projectId === "alpha" && e.batchId === batchId);
  assert.strictEqual(entry.appliedRaw, "1000000000"); assert.strictEqual(entry.excessRaw, "200000000");
  const part = L.partition({ projectId: "alpha", days: store.read(kv, "alpha", "days", {}), batches: store.read(kv, "alpha", "batches", {}), journal: j });
  assert.strictEqual(part[W.A].accruedRaw, "1000000000");   // accrued is untouched by the overpay
  assert.strictEqual(part[W.A].paidAppliedRaw, "1000000000");
  assert.strictEqual(part[W.A].excessRaw, "200000000");
  assert.deepStrictEqual(L.checkInvariant(part), []);
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
  const kvFaultRaw = store.memoryKv(kv.dump());
  const kvFault = flakyKv(kvFaultRaw, { failOnKeys: new Set([store.JOURNAL_KEY]) });
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
    const rec = pub.findReceipt(view, SIG(30), { journal: store.readJournal(kv), batches: store.read(kv, "delta", "batches", {}), project, programState: store.read(kv, "delta", "state", {}) });
    assert.ok(rec && Array.isArray(rec.settlements), "the Addendum-B shape was served");
    assert.strictEqual(rec.settlements.length, 1);
    assert.strictEqual(rec.totals.appliedRaw, "1000000000");

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

(async () => {
  for (const [n, f] of queue) {
    if (!f) { console.log("\n" + n); continue; }
    try { await f(); console.log("  ✓ " + n); pass++; }
    catch (e) { console.log("  ✗ " + n + "\n      " + (e.stack || e.message).split("\n").slice(0, 6).join("\n      ")); fail++; }
  }
  console.log(`\n${fail === 0 ? "all passed" : fail + " FAILED"} (${pass} passed)`);
  process.exit(fail ? 1 : 0);
})();
