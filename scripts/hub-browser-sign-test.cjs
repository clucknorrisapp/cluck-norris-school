#!/usr/bin/env node
"use strict";
// Project Hub — X6/CC5: the browser-signed batch payout (lib/hub/routes.js
// POST .../batch/:batchId/sign-request and POST .../batch/:batchId/observe).
//
// Fault-injection for every transition the roadmap calls out: a crash between sign-request and
// observe leaves the batch in `signing` and refuses the managed payer; a bad signature fails that
// row without settling it; observing the same signature twice settles once; an RPC outage during
// observe answers `unavailable` and touches nothing; a dry-run project is refused before any
// write; an unauthenticated caller gets 404; a GET gets 405. Same DI style as
// scripts/hub-settle-route-test.cjs — no HTTP, no network, the real route closures.
const assert = require("assert");
const store = require("../lib/hub/store");
const proj = require("../lib/hub/project");
const ledger = require("../lib/hub/ledger");
const routes = require("../lib/hub/routes");
const payoutVerify = require("../lib/payout-verify");

let pass = 0, fail = 0;
const queue = [];
const t = (n, f) => queue.push([n, f]);
const section = (n) => queue.push([n, null]);

const W = {
  A: "4Gccq9pESbfNeKiW7M7qi587pYYiaQ4T4zLv3LcriGPs", B: "5WKKoF7LcDRsSfTYxccSEj7hejh9U5ZqcX74C7E5X7HG",
  FUND: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", MINT1: "4yro2xbCxMFVvygCsj5FZMgZnVCb8EqcbPGTbSGCgDBc",
  DEST1: "6uGpiHY7VfCryFvcz1QQg7oDG1cUuXTRVvzXBqRQqXpJ", DEST2: "8kQTLwvxJd8ZoEHVEmz8AzE5cVQyMYccUFEbEg5xJ5CY",
};
const TOK = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const SIG = (n) => "5" + Array.from({ length: 87 }, (_, i) => "abcdefghjkmnpqrstuvwxyz"[(i * 7 + n) % 23]).join("");
const NOW = 1_800_000_000;
const days = (credits, key = "2026-09-17T00") => ({ [key]: { credits, at: NOW - 3600 } });

const SRC_ATA = "SrcAta1111111111111111111111111111111";
const tokenTransfer = (destination, amount) => ({ program: "spl-token", parsed: { type: "transfer", info: { source: SRC_ATA, destination, authority: W.FUND, amount: String(amount) } } });
const bal = (accountIndex, owner, amount, mint = W.MINT1) => ({ accountIndex, mint, owner, uiTokenAmount: { amount: String(amount) } });
function txSingle({ wallet = W.A, amountRaw = "1000000000", slot = 42, sourceOwner = W.FUND } = {}) {
  return {
    slot, blockTime: NOW,
    meta: { err: null, preTokenBalances: [bal(0, sourceOwner, "999999999999999"), bal(1, wallet, 0)], postTokenBalances: [bal(1, wallet, amountRaw)] },
    transaction: { message: { accountKeys: [SRC_ATA, W.DEST1], instructions: [tokenTransfer(W.DEST1, amountRaw)] } },
  };
}
function txWrongAmount({ wallet = W.A, amountRaw = "1", slot = 43, sourceOwner = W.FUND } = {}) {
  return txSingle({ wallet, amountRaw, slot, sourceOwner });
}
function txWrongSource({ wallet = W.A, amountRaw = "1000000000", slot = 44, sourceOwner = W.DEST2 } = {}) {
  return txSingle({ wallet, amountRaw, slot, sourceOwner });
}

// ── fake Express, same shape as scripts/hub-settle-route-test.cjs ──────────────────────────────
function fakeApp() {
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
    if (!calledNext) break;
  }
  return res;
}
function fakeVault() { return { payoutSpl: async () => ({ action: "would-pay" }) }; }
function mountFor({ kv, getTx = async () => null, vault = fakeVault(), alerts = [], nowUnix = () => NOW, scanDeps = async () => ({ scan: async () => [] }), adminAuthOK = () => true, secret = "test-secret" } = {}) {
  const app = fakeApp();
  routes.mount(app, {
    kv, adminAuthOK, publicErrMsg: (e) => (e && e.message) || String(e), secret,
    vault, connection: () => ({ getSignatureStatuses: async () => ({ value: [] }), getParsedTokenAccountsByOwner: async () => ({ value: [] }) }),
    scanDeps, getTx, alert: (m) => alerts.push(m), nowUnix,
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
async function exportBatch(app, project, credits) {
  const kv = arguments; // unused, kept for readability
  const r = await call(app, "/api/hub/:project/payout", { method: "POST", params: { project }, query: { export: "1" } });
  return r.body.created.id;
}
function setup(id = "browsersign", mint = W.MINT1, credits = { [W.A]: "1000000000" }) {
  const kv = store.memoryKv();
  seedProject(kv, id, mint);
  store.write(kv, id, "days", days(credits));
  return kv;
}
const SR = "/api/hub/:project/batch/:batchId/sign-request";
const OB = "/api/hub/:project/batch/:batchId/observe";

section("1. sign-request — happy path: unsigned transfer parameters for the batch's owed rows");

t("returns mint/destination/amount/decimals/fundingWallet per row, a nonce and an idempotency key, and moves the batch to `signing`", async () => {
  const kv = setup("alpha1");
  const app = mountFor({ kv });
  const batchId = await exportBatch(app, "alpha1");
  const r = await call(app, SR, { method: "POST", params: { project: "alpha1", batchId } });
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  assert.ok(r.body.nonce && typeof r.body.nonce === "string");
  assert.ok(r.body.idempotencyKey.includes(batchId));
  assert.strictEqual(r.body.mint, W.MINT1);
  assert.strictEqual(r.body.fundingWallet, W.FUND);
  assert.strictEqual(r.body.rows.length, 1);
  assert.strictEqual(r.body.rows[0].wallet, W.A);
  assert.strictEqual(r.body.rows[0].amountRaw, "1000000000");
  assert.strictEqual(r.body.rows[0].source, W.FUND);
  assert.ok(r.body.rows[0].destination, "a destination ATA is derived server-side");
  const bt = store.read(kv, "alpha1", "batches", {})[batchId];
  assert.strictEqual(bt.browserSign.state, "signing");
  assert.strictEqual(bt.browserSign.nonce, r.body.nonce);
  assert.strictEqual(bt.state, "pending", "bt.state itself is untouched — only browserSign carries the new states");
});

t("a second sign-request while `signing` (nothing broadcast yet) is allowed and issues a fresh nonce", async () => {
  const kv = setup("alpha2");
  const app = mountFor({ kv });
  const batchId = await exportBatch(app, "alpha2");
  const first = await call(app, SR, { method: "POST", params: { project: "alpha2", batchId } });
  const second = await call(app, SR, { method: "POST", params: { project: "alpha2", batchId } });
  assert.strictEqual(second.statusCode, 200, JSON.stringify(second.body));
  assert.notStrictEqual(second.body.nonce, first.body.nonce);
});

section("2. fault: crash between sign-request and observe");

t("the batch stays `signing`, and the managed payer (&send=) is refused", async () => {
  const kv = setup("beta1");
  const app = mountFor({ kv });
  const batchId = await exportBatch(app, "beta1");
  await call(app, SR, { method: "POST", params: { project: "beta1", batchId } });
  // "Crash" == nothing else happens. Re-read fresh, as a new request would.
  const bt = store.read(kv, "beta1", "batches", {})[batchId];
  assert.strictEqual(bt.browserSign.state, "signing");
  const send = await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "beta1" }, query: { send: batchId, from: "some-vault", run: "1" } });
  assert.strictEqual(send.statusCode, 409, JSON.stringify(send.body));
  assert.ok(/browser-signed payout is signing/.test(send.body.error), send.body.error);
  // …and vice versa: the batch is still exactly `signing`, unmoved by the refused managed send.
  const bt2 = store.read(kv, "beta1", "batches", {})[batchId];
  assert.strictEqual(bt2.browserSign.state, "signing");
});

section("3. observe — happy path settles through the SAME journal as &sent=/&send=");

t("a valid signature settles the row, marks browserSign 'settled', and records the legacy paid/sent row", async () => {
  const kv = setup("gamma1");
  const app = mountFor({ kv, getTx: async (sig) => (sig === SIG(1) ? txSingle({ wallet: W.A, amountRaw: "1000000000" }) : null) });
  const batchId = await exportBatch(app, "gamma1");
  await call(app, SR, { method: "POST", params: { project: "gamma1", batchId } });
  const r = await call(app, OB, { method: "POST", params: { project: "gamma1", batchId }, query: { sig: SIG(1) } });
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.browserSign.state, "settled");
  assert.deepStrictEqual(r.body.recorded, [W.A]);
  assert.deepStrictEqual(r.body.remainingWallets, []);
  const bt = store.read(kv, "gamma1", "batches", {})[batchId];
  assert.ok(bt.sent && bt.sent[W.A] && bt.sent[W.A].sig === SIG(1), "legacy sent row recorded");
  assert.strictEqual(bt.browserSign.state, "settled");
  const journal = store.readJournal(kv);
  const entries = Object.values(journal).filter((e) => e.projectId === "gamma1" && e.batchId === batchId);
  assert.strictEqual(entries.length, 1, "one settlement journal entry, keyed by settle:<sig>:<idx>");
  assert.ok(entries[0].xferKey.startsWith(`settle:${SIG(1)}:`));
  // The managed payer is fine again now that the flow settled.
  const send = await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "gamma1" }, query: { send: batchId, from: "some-vault", run: "1" } });
  assert.notStrictEqual(send.statusCode, 409, "a settled browserSign no longer blocks the managed payer");
});

section("4. fault: observe with a bad signature");

t("a signature carrying the wrong AMOUNT settles nothing — the row is reported failed, never settled", async () => {
  const kv = setup("delta1");
  const app = mountFor({ kv, getTx: async () => txWrongAmount({ wallet: W.A, amountRaw: "1" }) });
  const batchId = await exportBatch(app, "delta1");
  await call(app, SR, { method: "POST", params: { project: "delta1", batchId } });
  const r = await call(app, OB, { method: "POST", params: { project: "delta1", batchId }, query: { sig: SIG(2) } });
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.browserSign.state, "submitted", "not settled — the row is still owed");
  assert.ok(r.body.browserSign.failed[W.A], "the wallet is recorded as a failed observe attempt");
  assert.ok(/transfer smaller than the amount owed/.test(r.body.browserSign.failed[W.A].why), r.body.browserSign.failed[W.A].why);
  const bt = store.read(kv, "delta1", "batches", {})[batchId];
  assert.ok(!bt.sent || !bt.sent[W.A], "never recorded as sent");
  const journal = store.readJournal(kv);
  assert.strictEqual(Object.values(journal).filter((e) => e.projectId === "delta1").length, 0, "nothing journaled");
});

t("a signature sourced from a wallet that is NOT the funding wallet settles nothing (adv P0-1)", async () => {
  const kv = setup("delta2");
  const app = mountFor({ kv, getTx: async () => txWrongSource({ wallet: W.A }) });
  const batchId = await exportBatch(app, "delta2");
  await call(app, SR, { method: "POST", params: { project: "delta2", batchId } });
  const r = await call(app, OB, { method: "POST", params: { project: "delta2", batchId }, query: { sig: SIG(3) } });
  assert.strictEqual(r.body.browserSign.state, "submitted");
  assert.strictEqual(r.body.browserSign.failed[W.A].why, "transfer_not_from_funding_wallet");
  const bt = store.read(kv, "delta2", "batches", {})[batchId];
  assert.ok(!bt.sent || !bt.sent[W.A]);
});

section("5. observe called twice with the same signature is idempotent — one settle, not two");

t("the second observe of an already-settled signature reports 'already settled' and journals nothing new", async () => {
  const kv = setup("epsilon1");
  const app = mountFor({ kv, getTx: async () => txSingle({ wallet: W.A, amountRaw: "1000000000", slot: 50 }) });
  const batchId = await exportBatch(app, "epsilon1");
  await call(app, SR, { method: "POST", params: { project: "epsilon1", batchId } });
  const first = await call(app, OB, { method: "POST", params: { project: "epsilon1", batchId }, query: { sig: SIG(4) } });
  assert.strictEqual(first.body.browserSign.state, "settled");
  const journalAfterFirst = Object.keys(store.readJournal(kv)).length;
  const second = await call(app, OB, { method: "POST", params: { project: "epsilon1", batchId }, query: { sig: SIG(4) } });
  assert.strictEqual(second.statusCode, 200, JSON.stringify(second.body));
  assert.strictEqual(second.body.already, true, JSON.stringify(second.body));
  assert.strictEqual(Object.keys(store.readJournal(kv)).length, journalAfterFirst, "no new journal entry from the repeat observe");
});

section("6. fault: RPC down during observe");

t("a getTx failure answers `unavailable` (503) and changes NOTHING — never settled, never failed", async () => {
  const kv = setup("zeta1");
  const app = mountFor({ kv, getTx: async () => { throw new Error("connection reset"); } });
  const batchId = await exportBatch(app, "zeta1");
  await call(app, SR, { method: "POST", params: { project: "zeta1", batchId } });
  const before = JSON.stringify(store.read(kv, "zeta1", "batches", {}));
  const r = await call(app, OB, { method: "POST", params: { project: "zeta1", batchId }, query: { sig: SIG(5) } });
  assert.strictEqual(r.statusCode, 503, JSON.stringify(r.body));
  assert.strictEqual(r.body.retry, true);
  const after = JSON.stringify(store.read(kv, "zeta1", "batches", {}));
  assert.strictEqual(before, after, "the batch (including browserSign.state, still 'signing') is byte-identical after an RPC outage");
  const bt = store.read(kv, "zeta1", "batches", {})[batchId];
  assert.strictEqual(bt.browserSign.state, "signing", "still signing — never advanced to submitted, settled, or a failure");
});

section("7. dry-run project — refused before any write, on both routes");

t("sign-request on a dry-run project is refused with 409 and the /payout &send= wording, before any store write", async () => {
  const kv = store.memoryKv();
  seedProject(kv, "demo1", W.MINT1, { dryRun: true });
  const before = JSON.stringify(kv.dump());
  const app = mountFor({ kv });
  const r = await call(app, SR, { method: "POST", params: { project: "demo1", batchId: "whatever" } });
  assert.strictEqual(r.statusCode, 409, JSON.stringify(r.body));
  assert.ok(/DRY RUN/.test(r.body.error), r.body.error);
  assert.strictEqual(JSON.stringify(kv.dump()), before, "nothing written for a dry-run project");
});

t("observe on a dry-run project is refused with 409 the same way, before any store write", async () => {
  const kv = store.memoryKv();
  seedProject(kv, "demo2", W.MINT1, { dryRun: true });
  const before = JSON.stringify(kv.dump());
  const app = mountFor({ kv });
  const r = await call(app, OB, { method: "POST", params: { project: "demo2", batchId: "whatever" }, query: { sig: SIG(6) } });
  assert.strictEqual(r.statusCode, 409, JSON.stringify(r.body));
  assert.ok(/DRY RUN/.test(r.body.error), r.body.error);
  assert.strictEqual(JSON.stringify(kv.dump()), before);
});

section("8. auth — unauthenticated is 404, on both routes, for a real and an unknown project");

t("sign-request/observe with no owner key and no operator token is 404 (never a project-exists hint)", async () => {
  const kv = setup("theta1");
  const app = mountFor({ kv, adminAuthOK: () => false });
  const batchId = await exportBatch(mountFor({ kv, adminAuthOK: () => true }), "theta1");
  let r = await call(app, SR, { method: "POST", params: { project: "theta1", batchId } });
  assert.strictEqual(r.statusCode, 404);
  assert.strictEqual(r.body.error, "not_found");
  r = await call(app, OB, { method: "POST", params: { project: "theta1", batchId }, query: { sig: SIG(7) } });
  assert.strictEqual(r.statusCode, 404);
  assert.strictEqual(r.body.error, "not_found");
});

t("sign-request/observe for an UNKNOWN project is 404 regardless of auth", async () => {
  const kv = store.memoryKv();
  const app = mountFor({ kv, adminAuthOK: () => true });
  let r = await call(app, SR, { method: "POST", params: { project: "nope", batchId: "x" } });
  assert.strictEqual(r.statusCode, 404);
  r = await call(app, OB, { method: "POST", params: { project: "nope", batchId: "x" }, query: { sig: SIG(8) } });
  assert.strictEqual(r.statusCode, 404);
});

section("9. method — GET is refused with 405 on both routes, before the project lookup");

t("GET .../sign-request and GET .../observe are refused with 405 even for an unknown project", async () => {
  const app = mountFor({ kv: store.memoryKv() });
  let r = await call(app, SR, { method: "GET", params: { project: "nope", batchId: "x" } });
  assert.strictEqual(r.statusCode, 405, JSON.stringify(r.body));
  r = await call(app, OB, { method: "GET", params: { project: "nope", batchId: "x" } });
  assert.strictEqual(r.statusCode, 405, JSON.stringify(r.body));
});

section("10. observe without a prior sign-request, and without a batch, are refused cleanly");

t("observe on a batch with no sign-request in progress is a 400, not a crash", async () => {
  const kv = setup("iota1");
  const app = mountFor({ kv });
  const batchId = await exportBatch(app, "iota1");
  const r = await call(app, OB, { method: "POST", params: { project: "iota1", batchId }, query: { sig: SIG(9) } });
  assert.strictEqual(r.statusCode, 400, JSON.stringify(r.body));
  assert.ok(/sign-request first/.test(r.body.error), r.body.error);
});

t("sign-request/observe for a batch id that does not exist is a 404", async () => {
  const kv = setup("iota2");
  const app = mountFor({ kv });
  await exportBatch(app, "iota2");
  let r = await call(app, SR, { method: "POST", params: { project: "iota2", batchId: "hb_nope" } });
  assert.strictEqual(r.statusCode, 404, JSON.stringify(r.body));
  r = await call(app, OB, { method: "POST", params: { project: "iota2", batchId: "hb_nope" }, query: { sig: SIG(10) } });
  assert.strictEqual(r.statusCode, 404, JSON.stringify(r.body));
});

section("11. a batch already fully paid by the managed payer has nothing left for sign-request");

t("sign-request on a batch the managed payer already fully sent is refused — the batch is 'sent', not 'pending'", async () => {
  const kv = setup("kappa1");
  const vault = { payoutSpl: async ({ recipients, onPaid }) => { for (const rrow of recipients) onPaid({ wallet: rrow.wallet, sig: SIG(11) }); return { action: "paid", paid: recipients.map((rrow) => ({ wallet: rrow.wallet, sig: SIG(11) })), pending: [], failed: [] }; } };
  const app = mountFor({ kv, vault, getTx: async () => txSingle({ wallet: W.A, amountRaw: "1000000000", slot: 60 }) });
  const batchId = await exportBatch(app, "kappa1");
  const sent = await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "kappa1" }, query: { send: batchId, from: "some-vault", run: "1" } });
  assert.strictEqual(sent.body.send.action, "paid", JSON.stringify(sent.body));
  const r = await call(app, SR, { method: "POST", params: { project: "kappa1", batchId } });
  assert.strictEqual(r.statusCode, 400, JSON.stringify(r.body));
  assert.ok(/batch is sent, not pending/.test(r.body.error), r.body.error);
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
