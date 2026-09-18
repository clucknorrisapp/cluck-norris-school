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
const operator = require("../lib/hub/operator");

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
const B58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
// A distinct, valid-SHAPE (and validly base58-decodable) wallet address for bulk/bound tests —
// section 16 needs many DIFFERENT wallets, not just many signatures. Hashed, not a linear index
// formula, so it does not wrap into duplicates over a few dozen values (a linear one did).
const WALLETN = (n) => {
  const h = require("crypto").createHash("sha256").update("hub-browser-sign-test-wallet:" + n).digest();
  return Array.from(h.slice(0, 32), (byte) => B58_ALPHABET[byte % 58]).join("");
};
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
// P2-7 (lens 1): the token DELTA (rowPaidBy, the legacy `&sent=`-style check) sums across BOTH
// instructions and matches the row's full remaining exactly — accepted — but
// locateTransferInstruction (the journal's OWN attribution) finds TWO instructions crediting the
// same destination account in this one signature and refuses to guess which one is "the" transfer
// — ambiguous, never attributed. This is the real, reproducible shape of `ATTRIBUTION_FAILURE_WHY`
// on a row that DOES get legacy-recorded (paid) despite never journaling.
function txAmbiguousAttribution({ wallet = W.A, amountRaw = "1000000000", slot = 45, sourceOwner = W.FUND } = {}) {
  const half = (BigInt(amountRaw) / 2n).toString();
  const rest = (BigInt(amountRaw) - BigInt(half)).toString();
  return {
    slot, blockTime: NOW,
    meta: { err: null, preTokenBalances: [bal(0, sourceOwner, "999999999999999"), bal(1, wallet, 0)], postTokenBalances: [bal(1, wallet, amountRaw)] },
    transaction: { message: { accountKeys: [SRC_ATA, W.DEST1], instructions: [tokenTransfer(W.DEST1, half), tokenTransfer(W.DEST1, rest)] } },
  };
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
async function exportBatch(app, project) {
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
// F9: observe() now REQUIRES the nonce sign-request handed out — every test below drives the two
// routes through this pair of helpers so a real sign-request's nonce always reaches observe().
async function signRequest(app, project, batchId, query = {}) {
  return call(app, SR, { method: "POST", params: { project, batchId }, query });
}
async function observe(app, project, batchId, nonce, sigOrQuery) {
  const query = typeof sigOrQuery === "string" ? { sig: sigOrQuery } : (sigOrQuery || {});
  return call(app, OB, { method: "POST", params: { project, batchId }, query: { ...query, nonce } });
}

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

t("F3: a second sign-request while `signing` is REFUSED (409) — nothing durable proves nothing was already broadcast", async () => {
  const kv = setup("alpha2");
  const app = mountFor({ kv });
  const batchId = await exportBatch(app, "alpha2");
  const first = await signRequest(app, "alpha2", batchId);
  const second = await signRequest(app, "alpha2", batchId);
  assert.strictEqual(second.statusCode, 409, JSON.stringify(second.body));
  assert.ok(/observe the signatures you already broadcast first/.test(second.body.error), second.body.error);
  const bt = store.read(kv, "alpha2", "batches", {})[batchId];
  assert.strictEqual(bt.browserSign.nonce, first.body.nonce, "unchanged — the refused call issued no fresh nonce");
});

t("F3: force=1 explicitly abandons a `signing` sign-request and issues a fresh nonce", async () => {
  const kv = setup("alpha3");
  const app = mountFor({ kv });
  const batchId = await exportBatch(app, "alpha3");
  const first = await signRequest(app, "alpha3", batchId);
  const second = await signRequest(app, "alpha3", batchId, { force: "1" });
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
  const sr = await signRequest(app, "gamma1", batchId);
  const r = await observe(app, "gamma1", batchId, sr.body.nonce, SIG(1));
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
  const sr = await signRequest(app, "delta1", batchId);
  const r = await observe(app, "delta1", batchId, sr.body.nonce, SIG(2));
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
  const sr = await signRequest(app, "delta2", batchId);
  const r = await observe(app, "delta2", batchId, sr.body.nonce, SIG(3));
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
  const sr = await signRequest(app, "epsilon1", batchId);
  const first = await observe(app, "epsilon1", batchId, sr.body.nonce, SIG(4));
  assert.strictEqual(first.body.browserSign.state, "settled");
  const journalAfterFirst = Object.keys(store.readJournal(kv)).length;
  const second = await observe(app, "epsilon1", batchId, sr.body.nonce, SIG(4));
  assert.strictEqual(second.statusCode, 200, JSON.stringify(second.body));
  assert.strictEqual(second.body.already, true, JSON.stringify(second.body));
  assert.strictEqual(Object.keys(store.readJournal(kv)).length, journalAfterFirst, "no new journal entry from the repeat observe");
});

t("P2-8 (lens 1): a TWO-wallet batch — one settles, the state stays open, and re-observing that same signature hits the ledger's OWN consumed check (not just the settled short-circuit)", async () => {
  const kv = setup("epsilon2", W.MINT1, { [W.A]: "1000000000", [W.B]: "2000000000" });
  const app = mountFor({ kv, getTx: async (sig) => (sig === SIG(41) ? txSingle({ wallet: W.A, amountRaw: "1000000000", slot: 51 }) : null) });
  const batchId = await exportBatch(app, "epsilon2");
  const sr = await signRequest(app, "epsilon2", batchId);
  const first = await observe(app, "epsilon2", batchId, sr.body.nonce, SIG(41));
  assert.strictEqual(first.statusCode, 200, JSON.stringify(first.body));
  assert.strictEqual(first.body.browserSign.state, "submitted", "B still owed — the batch stays open, so the top-level `already` short-circuit cannot fire on the next call");
  assert.deepStrictEqual(first.body.recorded, [W.A]);
  const journalAfterFirst = Object.keys(store.readJournal(kv)).length;
  // Re-observe the SAME signature. `browserSign.state` is `submitted`, not settled, so this call
  // reaches the real verification pipeline again — it must be `ledger.settle`'s own already-
  // consumed check (or PASS 1's `remaining === 0n` -> amount_mismatch) that stops a second credit,
  // not the route's top-level short-circuit.
  const second = await observe(app, "epsilon2", batchId, sr.body.nonce, SIG(41));
  assert.strictEqual(second.statusCode, 200, JSON.stringify(second.body));
  assert.ok(!second.body.already, "reached the real pipeline, not the settled short-circuit");
  assert.deepStrictEqual(second.body.recorded, [], "A is not recorded a second time");
  assert.strictEqual(Object.keys(store.readJournal(kv)).length, journalAfterFirst, "no new journal entry");
  const bt = store.read(kv, "epsilon2", "batches", {})[batchId];
  assert.ok(bt.sent[W.A] && !bt.sent[W.B], "A stays paid once; B is still unpaid");
});

section("6. fault: RPC down during observe");

t("a getTx failure answers `unavailable` (503) and changes NOTHING — never settled, never failed", async () => {
  const kv = setup("zeta1");
  const app = mountFor({ kv, getTx: async () => { throw new Error("connection reset"); } });
  const batchId = await exportBatch(app, "zeta1");
  const sr = await signRequest(app, "zeta1", batchId);
  const before = JSON.stringify(store.read(kv, "zeta1", "batches", {}));
  const r = await observe(app, "zeta1", batchId, sr.body.nonce, SIG(5));
  assert.strictEqual(r.statusCode, 503, JSON.stringify(r.body));
  assert.strictEqual(r.body.retry, true);
  const after = JSON.stringify(store.read(kv, "zeta1", "batches", {}));
  assert.strictEqual(before, after, "the batch (including browserSign.state, still 'signing') is byte-identical after an RPC outage");
  const bt = store.read(kv, "zeta1", "batches", {})[batchId];
  assert.strictEqual(bt.browserSign.state, "signing", "still signing — never advanced to submitted, settled, or a failure");
});

t("P1-4/P1-5 (lens 1): getTx resolving NULL (not yet indexed) is the SAME class as an RPC outage — 503, retry, nothing advances", async () => {
  const kv = setup("zeta2");
  const app = mountFor({ kv, getTx: async () => null });
  const batchId = await exportBatch(app, "zeta2");
  const sr = await signRequest(app, "zeta2", batchId);
  const before = JSON.stringify(store.read(kv, "zeta2", "batches", {}));
  const r = await observe(app, "zeta2", batchId, sr.body.nonce, SIG(51));
  assert.strictEqual(r.statusCode, 503, JSON.stringify(r.body));
  assert.strictEqual(r.body.retry, true);
  assert.deepStrictEqual(r.body.pending, [SIG(51)]);
  const after = JSON.stringify(store.read(kv, "zeta2", "batches", {}));
  assert.strictEqual(before, after, "byte-identical — a not-yet-indexed signature must never write `failed` or advance the state");
  const bt = store.read(kv, "zeta2", "batches", {})[batchId];
  assert.strictEqual(bt.browserSign.state, "signing");
  assert.deepStrictEqual(bt.browserSign.failed, {}, "never permanently marked failed for a transaction the chain simply hasn't indexed yet");
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

section("12. F2: a browser-signed flow blocks &cancel=, and observe() independently refuses a non-pending batch");

t("F2: &cancel= is refused (409) while browserSign is live — no double-pay window through cancel + re-export", async () => {
  const kv = setup("nu1");
  const app = mountFor({ kv });
  const batchId = await exportBatch(app, "nu1");
  await signRequest(app, "nu1", batchId);
  const r = await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "nu1" }, query: { cancel: batchId } });
  assert.strictEqual(r.statusCode, 409, JSON.stringify(r.body));
  assert.ok(/browser-signed payout is signing/.test(r.body.error), r.body.error);
  const bt = store.read(kv, "nu1", "batches", {})[batchId];
  assert.strictEqual(bt.state, "pending", "never cancelled");
});

t("F2: observe() independently refuses a batch that is not `pending` — defense in depth even if a cancel is ever reached some other way", async () => {
  const kv = setup("nu2");
  const app = mountFor({ kv, getTx: async () => txSingle({ wallet: W.A, amountRaw: "1000000000", slot: 60 }) });
  const batchId = await exportBatch(app, "nu2");
  const sr = await signRequest(app, "nu2", batchId);
  // Simulate a state a bypassed cancel would have produced — the route's OWN check on `bt.state`
  // inside observe() (not just the &cancel= guard) must still catch it.
  const batches = store.read(kv, "nu2", "batches", {});
  store.write(kv, "nu2", "batches", { ...batches, [batchId]: { ...batches[batchId], state: "cancelled" } });
  const r = await observe(app, "nu2", batchId, sr.body.nonce, SIG(61));
  assert.strictEqual(r.statusCode, 400, JSON.stringify(r.body));
  assert.ok(/batch is cancelled, not pending/.test(r.body.error), r.body.error);
});

section("13. F4: an owner-only reset clears a stuck browserSign without touching amounts, the journal or the legacy state");

t("an operator cannot clear; the owner can (with confirm=abandon-broadcast, since a real broadcast may be unobserved), and a fresh sign-request works afterwards with no force needed", async () => {
  const kv = setup("xi1");
  const app = mountFor({ kv, getTx: async () => null });
  const batchId = await exportBatch(app, "xi1");
  await signRequest(app, "xi1", batchId);
  const appOperator = mountFor({ kv, adminAuthOK: () => false });
  const opToken = operator.issueToken("test-secret", { projectId: "xi1", wallet: W.A });
  const opAttempt = await call(appOperator, SR, { method: "POST", params: { project: "xi1", batchId }, query: { clear: "1", confirm: "abandon-broadcast" }, headers: { "x-clkn-operator": opToken } });
  assert.strictEqual(opAttempt.statusCode, 403, JSON.stringify(opAttempt.body));
  assert.ok(store.read(kv, "xi1", "batches", {})[batchId].browserSign, "unchanged by the refused operator attempt");
  const cleared = await signRequest(app, "xi1", batchId, { clear: "1", confirm: "abandon-broadcast" });
  assert.strictEqual(cleared.statusCode, 200, JSON.stringify(cleared.body));
  assert.strictEqual(cleared.body.cleared, true);
  const bt = store.read(kv, "xi1", "batches", {})[batchId];
  assert.strictEqual(bt.browserSign.state, "cleared");
  assert.strictEqual(bt.state, "pending", "amounts/state untouched — only browserSign was reset");
  const fresh = await signRequest(app, "xi1", batchId);
  assert.strictEqual(fresh.statusCode, 200, JSON.stringify(fresh.body), "no force=1 needed — the reset, not a force, is what cleared `signing`");
});

t("an owner reset on a batch with no browserSign in progress is a no-op (200, cleared:false)", async () => {
  const kv = setup("xi2");
  const app = mountFor({ kv });
  const batchId = await exportBatch(app, "xi2");
  const r = await signRequest(app, "xi2", batchId, { clear: "1" });
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.cleared, false);
});

section("13b. N1: clear=1 refuses an at-risk clear without confirm=abandon-broadcast, and succeeds — echoing everything — with it");

t("clear=1 with an unobserved, at-risk wallet is refused (409), listing it in `atRisk`, and changes nothing", async () => {
  const kv = setup("xi3");
  const app = mountFor({ kv, getTx: async () => null });
  const batchId = await exportBatch(app, "xi3");
  const sr = await signRequest(app, "xi3", batchId);
  const before = JSON.stringify(store.read(kv, "xi3", "batches", {}));
  const r = await signRequest(app, "xi3", batchId, { clear: "1" });
  assert.strictEqual(r.statusCode, 409, JSON.stringify(r.body));
  assert.deepStrictEqual(r.body.atRisk, [W.A]);
  assert.deepStrictEqual(r.body.observedSigs, []);
  assert.deepStrictEqual(r.body.failed, {});
  assert.strictEqual(r.body.nonce, sr.body.nonce);
  assert.strictEqual(JSON.stringify(store.read(kv, "xi3", "batches", {})), before, "nothing changed by the refused clear");
});

t("clear=1&confirm=abandon-broadcast clears it anyway and echoes the same atRisk/observedSigs/failed/nonce in the 200", async () => {
  const kv = setup("xi4");
  const app = mountFor({ kv, getTx: async () => null });
  const batchId = await exportBatch(app, "xi4");
  const sr = await signRequest(app, "xi4", batchId);
  const r = await signRequest(app, "xi4", batchId, { clear: "1", confirm: "abandon-broadcast" });
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.cleared, true);
  assert.deepStrictEqual(r.body.atRisk, [W.A]);
  assert.deepStrictEqual(r.body.observedSigs, []);
  assert.strictEqual(r.body.nonce, sr.body.nonce);
});

t("a JOURNALED (fully paid) wallet is never at-risk — clear=1 succeeds with no confirm needed", async () => {
  const kv = setup("xi5");
  const app = mountFor({ kv, getTx: async () => txSingle({ wallet: W.A, amountRaw: "1000000000", slot: 61 }) });
  const batchId = await exportBatch(app, "xi5");
  const sr = await signRequest(app, "xi5", batchId);
  await observe(app, "xi5", batchId, sr.body.nonce, SIG(62));
  // Force the batch back into a stuck browserSign state (a batched/ambiguous attribution-failure
  // pin would produce exactly this in real life) so clear=1 has something to do.
  const batches0 = store.read(kv, "xi5", "batches", {});
  store.write(kv, "xi5", "batches", { ...batches0, [batchId]: { ...batches0[batchId], browserSign: { ...batches0[batchId].browserSign, state: "submitted" } } });
  const r = await signRequest(app, "xi5", batchId, { clear: "1" });
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body), "A is fully paid/journaled — never at-risk");
  assert.deepStrictEqual(r.body.atRisk, []);
});

t("a `cleared` browserSign is NOT live — &cancel= and a fresh sign-request both work right after", async () => {
  const kv = setup("xi6");
  const app = mountFor({ kv, getTx: async () => null });
  const batchId = await exportBatch(app, "xi6");
  await signRequest(app, "xi6", batchId);
  await signRequest(app, "xi6", batchId, { clear: "1", confirm: "abandon-broadcast" });
  const cancel = await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "xi6" }, query: { cancel: batchId } });
  assert.strictEqual(cancel.statusCode, 200, JSON.stringify(cancel.body), "cleared is not live — cancel is not blocked by it");
});

t("force=1 after a clear carries `observedSigs` forward into the new sign-request", async () => {
  const kv = setup("xi7", W.MINT1, { [W.A]: "1000000000", [W.B]: "2000000000" });
  const app = mountFor({ kv, getTx: async (sig) => (sig === SIG(63) ? txSingle({ wallet: W.A, amountRaw: "1000000000", slot: 63 }) : null) });
  const batchId = await exportBatch(app, "xi7");
  const sr1 = await signRequest(app, "xi7", batchId);
  const ob = await observe(app, "xi7", batchId, sr1.body.nonce, SIG(63));
  assert.strictEqual(ob.body.recorded.length, 1, "A settled, B still owed — browserSign stays live (submitted)");
  await signRequest(app, "xi7", batchId, { clear: "1", confirm: "abandon-broadcast" });
  const sr2 = await signRequest(app, "xi7", batchId);
  assert.strictEqual(sr2.statusCode, 200, JSON.stringify(sr2.body));
  const bt = store.read(kv, "xi7", "batches", {})[batchId];
  assert.deepStrictEqual(bt.browserSign.observedSigs, [SIG(63)], "the signature observed before the clear is not forgotten");
});

section("14. P0-1 (lens 1): sign-request never re-offers a row the managed payer already broadcast, even before it journals");

t("a managed-send row broadcast with pending:true is NOT re-offered by sign-request; the other still-owed wallet is", async () => {
  const kv = setup("omicron1", W.MINT1, { [W.A]: "1000000000", [W.B]: "2000000000" });
  const vault = {
    payoutSpl: async ({ recipients, onPaid }) => {
      const rowA = recipients.find((rr) => rr.wallet === W.A);
      const rowB = recipients.find((rr) => rr.wallet === W.B);
      if (rowA) onPaid({ wallet: W.A, sig: SIG(70), pending: true });   // broadcast — legacy-sent, not yet confirmed or journaled
      return { action: "partial", paid: [], pending: rowA ? [{ wallet: W.A, sig: SIG(70) }] : [], failed: rowB ? [{ wallet: W.B, error: "simulated failure" }] : [] };
    },
  };
  const app = mountFor({ kv, vault, getTx: async () => null });
  const batchId = await exportBatch(app, "omicron1");
  const sent = await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "omicron1" }, query: { send: batchId, from: "some-vault", run: "1" } });
  assert.strictEqual(sent.statusCode, 200, JSON.stringify(sent.body));
  const bt0 = store.read(kv, "omicron1", "batches", {})[batchId];
  assert.ok(bt0.sent && bt0.sent[W.A] && bt0.sent[W.A].pending, "A is legacy-recorded as sent (pending), not yet journaled");
  assert.ok(!bt0.sent[W.B], "B never landed");
  assert.strictEqual(bt0.state, "pending", "not every row sent yet, so the batch itself is still pending");
  const sr = await signRequest(app, "omicron1", batchId);
  assert.strictEqual(sr.statusCode, 200, JSON.stringify(sr.body));
  const offered = sr.body.rows.map((rr) => rr.wallet);
  assert.ok(!offered.includes(W.A), "A must NOT be offered again — it may already be broadcast on chain");
  assert.ok(offered.includes(W.B));
  assert.ok(sr.body.skipped.some((rr) => rr.wallet === W.A), "A is named in `skipped`, with a reason");
});

section("15. P2-9 (lens 1): cross-project auth, and the reverse busy case the README claims");

t("an operator token valid for project A is refused (404) on project B", async () => {
  const kv = store.memoryKv();
  const MINT2 = "8kQTLwvxJd8ZoEHVEmz8AzE5cVQyMYccUFEbEg5xJ5CZ";
  seedProject(kv, "pi1", W.MINT1);
  seedProject(kv, "pi2", MINT2);
  store.write(kv, "pi1", "days", days({ [W.A]: "1000000000" }));
  store.write(kv, "pi2", "days", days({ [W.A]: "1000000000" }));
  const app = mountFor({ kv, adminAuthOK: () => false });
  const appOwner = mountFor({ kv });
  const batchIdB = await exportBatch(appOwner, "pi2");
  const tokenForA = operator.issueToken("test-secret", { projectId: "pi1", wallet: W.A });
  const r = await call(app, SR, { method: "POST", params: { project: "pi2", batchId: batchIdB }, headers: { "x-clkn-operator": tokenForA } });
  assert.strictEqual(r.statusCode, 404, JSON.stringify(r.body));
  assert.strictEqual(r.body.error, "not_found");
});

t("a sign-request mid a concurrent managed &send= is refused `busy` — the two paths share the SAME per-project payout lock", async () => {
  const kv = setup("rho1");
  let releaseVault;
  const vault = { payoutSpl: () => new Promise((resolve) => { releaseVault = () => resolve({ action: "would-pay", paid: [], pending: [], failed: [] }); }) };
  const app = mountFor({ kv, vault });
  const batchId = await exportBatch(app, "rho1");
  const sendPromise = call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "rho1" }, query: { send: batchId, from: "some-vault", run: "1" } });
  await new Promise((resolve) => setImmediate(resolve));   // let the send request acquire the lock first
  const sr = await signRequest(app, "rho1", batchId);
  assert.strictEqual(sr.statusCode, 409, JSON.stringify(sr.body));
  assert.strictEqual(sr.body.error, "busy", JSON.stringify(sr.body));
  releaseVault();
  await sendPromise;
});

section("16. F9: observe() requires the sign-request's own nonce, and answers 409 on a mismatch");

t("no nonce at all is refused (409), before any RPC read", async () => {
  const kv = setup("tau1");
  const app = mountFor({ kv, getTx: async () => { throw new Error("must not be called"); } });
  const batchId = await exportBatch(app, "tau1");
  await signRequest(app, "tau1", batchId);
  const r = await call(app, OB, { method: "POST", params: { project: "tau1", batchId }, query: { sig: SIG(90) } });   // no nonce=
  assert.strictEqual(r.statusCode, 409, JSON.stringify(r.body));
  assert.ok(/nonce/.test(r.body.error), r.body.error);
});

t("a WRONG nonce (a superseded sign-request's) is refused (409), not silently conflated with the fresh one", async () => {
  const kv = setup("tau2");
  const app = mountFor({ kv, getTx: async () => txSingle({ wallet: W.A, amountRaw: "1000000000", slot: 70 }) });
  const batchId = await exportBatch(app, "tau2");
  const stale = await signRequest(app, "tau2", batchId);
  const fresh = await signRequest(app, "tau2", batchId, { force: "1" });
  assert.notStrictEqual(stale.body.nonce, fresh.body.nonce);
  const r = await observe(app, "tau2", batchId, stale.body.nonce, SIG(91));
  assert.strictEqual(r.statusCode, 409, JSON.stringify(r.body));
  assert.ok(/nonce/.test(r.body.error), r.body.error);
  // The CORRECT (current) nonce still works.
  const ok = await observe(app, "tau2", batchId, fresh.body.nonce, SIG(91));
  assert.strictEqual(ok.statusCode, 200, JSON.stringify(ok.body));
  assert.strictEqual(ok.body.browserSign.state, "settled");
});

section("17. F7: the wallets×signatures cross product is bounded, matching &sent='s 500-pair cap");

t("observe refuses a call whose wallets×signatures product exceeds 500", async () => {
  const wallets = Array.from({ length: 60 }, (_, i) => WALLETN(i));
  const credits = {}; for (const w of wallets) credits[w] = "1000000000";
  const kv = setup("sigma1", W.MINT1, credits);
  const app = mountFor({ kv });
  const batchId = await exportBatch(app, "sigma1");
  const sr = await signRequest(app, "sigma1", batchId);
  assert.ok(sr.body.rows.length >= 60, "a large batch, on purpose");
  const manySigs = Array.from({ length: 9 }, (_, i) => SIG(80 + i));   // 60 wallets x 9 sigs = 540 > 500
  const r = await observe(app, "sigma1", batchId, sr.body.nonce, { sigs: manySigs });
  assert.strictEqual(r.statusCode, 400, JSON.stringify(r.body));
  assert.ok(/too many/.test(r.body.error), r.body.error);
});

section("18. P2-7 (lens 1): failed[wallet] is written only from a real refusal of that wallet's OWN candidate, and cleared for any RECORDED wallet — not just journaled ones");

t("wallet A settles through the attribution-failure path (paid, never journaled) and is NOT marked failed; wallet B genuinely fails and IS, with its own real reason (never the cross-product 'no mint reached this wallet' noise)", async () => {
  const kv = setup("upsilon1", W.MINT1, { [W.A]: "1000000000", [W.B]: "2000000000" });
  const SIG_A = SIG(95), SIG_B = SIG(96);
  const app = mountFor({
    kv,
    getTx: async (sig) => {
      if (sig === SIG_A) return txAmbiguousAttribution({ wallet: W.A, amountRaw: "1000000000" });
      if (sig === SIG_B) return txWrongAmount({ wallet: W.B, amountRaw: "1" });
      return null;
    },
  });
  const batchId = await exportBatch(app, "upsilon1");
  const sr = await signRequest(app, "upsilon1", batchId);
  const r = await observe(app, "upsilon1", batchId, sr.body.nonce, { sigs: [SIG_A, SIG_B] });
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepStrictEqual(r.body.recorded, [W.A], "A is legacy-recorded (paid) despite the ambiguous attribution");
  const bt = store.read(kv, "upsilon1", "batches", {})[batchId];
  assert.ok(bt.sent && bt.sent[W.A], "A really is paid");
  const journal = store.readJournal(kv);
  assert.strictEqual(Object.values(journal).filter((e) => e.projectId === "upsilon1").length, 0, "…but never journaled — the attribution genuinely failed");
  assert.ok(!r.body.browserSign.failed[W.A], "A must NOT be in `failed` — it is paid, not failed");
  assert.ok(r.body.browserSign.failed[W.B], "B genuinely never paid and IS in `failed`");
  assert.ok(!/no .+ reached this wallet/.test(r.body.browserSign.failed[W.B].why), "B's reason is its OWN refusal (wrong amount), never the cross-product noise from A's signature: " + r.body.browserSign.failed[W.B].why);
});

section("19. N2: an idempotent re-observe (or a &sent= landing in between) never marks a PAID row failed or fires a fraud alert");

t("observing the same signature twice on a two-wallet batch: the second call's `failed` is empty for the paid wallet and raises no alert", async () => {
  const kv = setup("chi1", W.MINT1, { [W.A]: "1000000000", [W.B]: "2000000000" });
  const alerts = [];
  const app = mountFor({ kv, alerts, getTx: async (sig) => (sig === SIG(100) ? txSingle({ wallet: W.A, amountRaw: "1000000000", slot: 100 }) : null) });
  const batchId = await exportBatch(app, "chi1");
  const sr = await signRequest(app, "chi1", batchId);
  const first = await observe(app, "chi1", batchId, sr.body.nonce, SIG(100));
  assert.deepStrictEqual(first.body.recorded, [W.A]);
  const alertsAfterFirst = alerts.length;
  const second = await observe(app, "chi1", batchId, sr.body.nonce, SIG(100));
  assert.strictEqual(second.statusCode, 200, JSON.stringify(second.body));
  assert.deepStrictEqual(second.body.recorded, []);
  assert.ok(!second.body.browserSign.failed[W.A], "A is paid — re-observing its own settling signature is not a failure: " + JSON.stringify(second.body.browserSign.failed));
  assert.strictEqual(alerts.length, alertsAfterFirst, "no new alert fired on the idempotent retry");
});

t("a &sent= landing between sign-request and observe (the desk's own 'record on server' recovery button) leaves NO `failed` entry for that now-paid row", async () => {
  const kv = setup("chi2", W.MINT1, { [W.A]: "1000000000", [W.B]: "2000000000" });
  const SIG_A = SIG(101);
  const app = mountFor({ kv, getTx: async (sig) => (sig === SIG_A ? txSingle({ wallet: W.A, amountRaw: "1000000000", slot: 101 }) : null) });
  const batchId = await exportBatch(app, "chi2");
  const sr = await signRequest(app, "chi2", batchId);
  const sent = await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "chi2" }, query: { batch: batchId, sent: JSON.stringify([{ wallet: W.A, sig: SIG_A }]) } });
  assert.strictEqual(sent.statusCode, 200, JSON.stringify(sent.body));
  assert.deepStrictEqual(sent.body.sent.recorded, [W.A]);
  const bt0 = store.read(kv, "chi2", "batches", {})[batchId];
  assert.strictEqual(bt0.browserSign.state, "signing", "B still owed — &sent= alone does not complete the batch");
  const ob = await observe(app, "chi2", batchId, sr.body.nonce, SIG_A);
  assert.strictEqual(ob.statusCode, 200, JSON.stringify(ob.body));
  assert.deepStrictEqual(ob.body.recorded, [], "A was already recorded — nothing NEW for observe to record");
  assert.ok(!ob.body.browserSign.failed[W.A], "A is paid — reporting the same signature that already paid it is not a failure: " + JSON.stringify(ob.body.browserSign.failed));
});

section("20. N3: observe partially resolves — settles what the RPC indexed, reports the rest as `pending`, never advances to `settled` while any remain");

t("one indexed signature settles its row; the other (not yet indexed) comes back in `pending` with retry:true; the state stays `submitted`", async () => {
  const kv = setup("psi1", W.MINT1, { [W.A]: "1000000000", [W.B]: "2000000000" });
  const SIG_OK = SIG(110), SIG_DROPPED = SIG(111);
  const app = mountFor({ kv, getTx: async (sig) => (sig === SIG_OK ? txSingle({ wallet: W.A, amountRaw: "1000000000", slot: 110 }) : null) });
  const batchId = await exportBatch(app, "psi1");
  const sr = await signRequest(app, "psi1", batchId);
  const r = await observe(app, "psi1", batchId, sr.body.nonce, { sigs: [SIG_OK, SIG_DROPPED] });
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepStrictEqual(r.body.recorded, [W.A], "the indexed signature settled its row");
  assert.strictEqual(r.body.retry, true);
  assert.deepStrictEqual(r.body.pending, [SIG_DROPPED]);
  assert.strictEqual(r.body.browserSign.state, "submitted", "B still owed AND a signature is still pending");
  const bt = store.read(kv, "psi1", "batches", {})[batchId];
  assert.ok(bt.sent && bt.sent[W.A], "A really is paid");
});

t("even when the resolved signature settles EVERY named row, the state stays `submitted` (not `settled`) while another submitted signature is still unindexed", async () => {
  const kv = setup("psi2");
  const SIG_OK = SIG(112), SIG_DROPPED = SIG(113);
  const app = mountFor({ kv, getTx: async (sig) => (sig === SIG_OK ? txSingle({ wallet: W.A, amountRaw: "1000000000", slot: 112 }) : null) });
  const batchId = await exportBatch(app, "psi2");
  const sr = await signRequest(app, "psi2", batchId);
  const r = await observe(app, "psi2", batchId, sr.body.nonce, { sigs: [SIG_OK, SIG_DROPPED] });
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepStrictEqual(r.body.recorded, [W.A]);
  assert.strictEqual(r.body.browserSign.state, "submitted", "nothing named is owed any more, but a submitted signature is still unresolved");
  assert.deepStrictEqual(r.body.pending, [SIG_DROPPED]);
});

t("all-unindexed is unchanged: 503, retry:true, the batch byte-identical (P1-4/P1-5 still hold)", async () => {
  const kv = setup("psi3");
  const app = mountFor({ kv, getTx: async () => null });
  const batchId = await exportBatch(app, "psi3");
  const sr = await signRequest(app, "psi3", batchId);
  const before = JSON.stringify(store.read(kv, "psi3", "batches", {}));
  const r = await observe(app, "psi3", batchId, sr.body.nonce, { sigs: [SIG(114), SIG(115)] });
  assert.strictEqual(r.statusCode, 503, JSON.stringify(r.body));
  assert.strictEqual(r.body.retry, true);
  assert.deepStrictEqual(r.body.pending, [SIG(114), SIG(115)]);
  assert.strictEqual(JSON.stringify(store.read(kv, "psi3", "batches", {})), before);
});

section("21. N7: a frozen sign-request expires after 24h");

t("observe refuses a sign-request more than 24h old, naming 'request a fresh sign-request'", async () => {
  let clock = NOW;
  const kv = setup("omega1");
  const app = mountFor({ kv, nowUnix: () => clock, getTx: async () => txSingle({ wallet: W.A, amountRaw: "1000000000", slot: 120 }) });
  const batchId = await exportBatch(app, "omega1");
  const sr = await signRequest(app, "omega1", batchId);
  clock = NOW + 24 * 3600 + 1;
  const r = await observe(app, "omega1", batchId, sr.body.nonce, SIG(121));
  assert.strictEqual(r.statusCode, 409, JSON.stringify(r.body));
  assert.ok(/24 hours old/.test(r.body.error), r.body.error);
  assert.ok(/request a fresh sign-request/.test(r.body.error), r.body.error);
});

t("well within 24h, observe proceeds normally", async () => {
  let clock = NOW;
  const kv = setup("omega2");
  const app = mountFor({ kv, nowUnix: () => clock, getTx: async () => txSingle({ wallet: W.A, amountRaw: "1000000000", slot: 121 }) });
  const batchId = await exportBatch(app, "omega2");
  const sr = await signRequest(app, "omega2", batchId);
  clock = NOW + 3600;
  const r = await observe(app, "omega2", batchId, sr.body.nonce, SIG(122));
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.browserSign.state, "settled");
});

section("22. N8: a zero-remaining row is named in `skipped`, never silently vanishes");

t("a fully waived row (remaining 0) appears in `skipped` with 'nothing remaining on this row', not dropped entirely", async () => {
  const kv = setup("phi1", W.MINT1, { [W.A]: "1000000000", [W.B]: "2000000000" });
  const app = mountFor({ kv });
  const batchId = await exportBatch(app, "phi1");
  const waived = await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "phi1" }, query: { batch: batchId, waive: W.A } });
  assert.strictEqual(waived.statusCode, 200, JSON.stringify(waived.body));
  const sr = await signRequest(app, "phi1", batchId);
  assert.strictEqual(sr.statusCode, 200, JSON.stringify(sr.body));
  const offered = sr.body.rows.map((rr) => rr.wallet);
  assert.ok(!offered.includes(W.A), "A has nothing remaining — not offered to sign");
  assert.ok(offered.includes(W.B));
  const skippedA = sr.body.skipped.find((rr) => rr.wallet === W.A);
  assert.ok(skippedA, "A must be NAMED in `skipped`, not vanish entirely");
  assert.strictEqual(skippedA.error, "nothing remaining on this row");
});

section("23. P2-5: sign-request refuses an operator whose own wallet is not an allowed settlement source");

t("an operator wallet that is NOT the funding wallet (and not in payoutSources) is refused 403", async () => {
  const kv = store.memoryKv();
  seedProject(kv, "rho2", W.MINT1, { operatorWallets: [W.A] });
  store.write(kv, "rho2", "days", days({ [W.A]: "1000000000" }));
  const appOwner = mountFor({ kv });
  const batchId = await exportBatch(appOwner, "rho2");
  const appOperator = mountFor({ kv, adminAuthOK: () => false });
  const opToken = operator.issueToken("test-secret", { projectId: "rho2", wallet: W.A });
  const r = await call(appOperator, SR, { method: "POST", params: { project: "rho2", batchId }, headers: { "x-clkn-operator": opToken } });
  assert.strictEqual(r.statusCode, 403, JSON.stringify(r.body));
});

t("the funding wallet itself, connected as an operator, is allowed (200)", async () => {
  const kv = store.memoryKv();
  seedProject(kv, "rho3", W.MINT1, { operatorWallets: [W.FUND] });
  store.write(kv, "rho3", "days", days({ [W.A]: "1000000000" }));
  const appOwner = mountFor({ kv });
  const batchId = await exportBatch(appOwner, "rho3");
  const appOperator = mountFor({ kv, adminAuthOK: () => false });
  const opToken = operator.issueToken("test-secret", { projectId: "rho3", wallet: W.FUND });
  const r = await call(appOperator, SR, { method: "POST", params: { project: "rho3", batchId }, headers: { "x-clkn-operator": opToken } });
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
});

section("24. P2-7: &confirm= is refused while a browser-signed flow is live, the same guard &cancel= already has");

t("&confirm= is refused (409) while browserSign is signing — no manually-marked-paid row while a real broadcast may be in flight", async () => {
  const kv = setup("sigma2");
  const app = mountFor({ kv });
  const batchId = await exportBatch(app, "sigma2");
  await signRequest(app, "sigma2", batchId);
  const r = await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "sigma2" }, query: { confirm: batchId } });
  assert.strictEqual(r.statusCode, 409, JSON.stringify(r.body));
  assert.ok(/browser-signed payout is signing/.test(r.body.error), r.body.error);
  const bt = store.read(kv, "sigma2", "batches", {})[batchId];
  assert.strictEqual(bt.state, "pending", "never confirmed");
});

section("25. N5: &sent= completing a batch while a browser-signed flow is live stamps it settled, never pinning it live forever");

t("recording the last row via &sent= while browserSign is signing flips it straight to settled", async () => {
  const kv = setup("tau3");
  const SIG_A = SIG(130);
  const app = mountFor({ kv, getTx: async (sig) => (sig === SIG_A ? txSingle({ wallet: W.A, amountRaw: "1000000000", slot: 130 }) : null) });
  const batchId = await exportBatch(app, "tau3");
  await signRequest(app, "tau3", batchId);
  const sent = await call(app, "/api/hub/:project/payout", { method: "POST", params: { project: "tau3" }, query: { batch: batchId, sent: JSON.stringify([{ wallet: W.A, sig: SIG_A }]) } });
  assert.strictEqual(sent.statusCode, 200, JSON.stringify(sent.body));
  const bt = store.read(kv, "tau3", "batches", {})[batchId];
  assert.strictEqual(bt.state, "sent");
  assert.strictEqual(bt.browserSign.state, "settled", "N5: &sent= completing the batch settles the live browserSign too");
  const sr2 = await signRequest(app, "tau3", batchId);
  assert.strictEqual(sr2.statusCode, 400, JSON.stringify(sr2.body));
  assert.ok(/batch is sent, not pending/.test(sr2.body.error), sr2.body.error);
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
