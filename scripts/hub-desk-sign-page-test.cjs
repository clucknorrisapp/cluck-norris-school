#!/usr/bin/env node
"use strict";
// F10 (docs/HUB_BROWSER_SIGN_VERIFY_2026-09-18.md): the browser-signed batch payout
// (signAndSend/refreshSignSendButton in public/hub-desk.html) had NO vm/jsdom test — every UI
// guard fixed in this round (F1, F3, F5, F6) was invisible to the server-only suite
// (scripts/hub-browser-sign-test.cjs) by construction. This runs the REAL inline script from
// public/hub-desk.html — extracted verbatim, not reimplemented — in a Node vm context with a
// minimal DOM/wallet/fetch stub, the same pattern scripts/hub-receipt-page-test.cjs uses for
// public/hub.html. `CluckAirdrop.send` is stubbed (never a real wallet/RPC); everything else
// (cluck-util.js) is the real shared module.
//
// Covers:
//   F1 — SIGN AND SEND (and SEND) refuse a wallet that is not the project's funding wallet,
//        BEFORE ever calling CluckAirdrop.send or the sign-request endpoint.
//   F3 — SIGN AND SEND is disabled while a browser-signed payout is `signing`/`submitted`.
//   F5 — a broadcast signature is persisted into localStorage (ROW_STATUS) even when the
//        following observe() call throws, and a second attempt refuses while it is unrecorded.
//   F6 — a sign-request response with a different mint/decimals, an unknown wallet, or an amount
//        bigger than the batch's own row is refused before CluckAirdrop.send is ever called.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

let pass = 0, fail = 0;
const queue = [];
const t = (n, f) => queue.push([n, f]);
const section = (n) => queue.push([n, null]);

const htmlSrc = fs.readFileSync(path.join(__dirname, "..", "public", "hub-desk.html"), "utf8");
const cluckUtilSrc = fs.readFileSync(path.join(__dirname, "..", "public", "cluck-util.js"), "utf8");

// The main inline script sits right after the /airdrop-engine.js <script src> tag.
const anchorIdx = htmlSrc.indexOf('<script src="/airdrop-engine.js"></script>');
if (anchorIdx === -1) throw new Error("could not find the /airdrop-engine.js <script src> tag in public/hub-desk.html — has the marker text changed?");
const MARKER = "<script>";
const startIdx = htmlSrc.indexOf(MARKER, anchorIdx);
if (startIdx === -1) throw new Error("could not find the main inline <script> in public/hub-desk.html");
const bodyStart = startIdx + MARKER.length;
const endIdx = htmlSrc.indexOf("</script>", bodyStart);
if (endIdx === -1) throw new Error("unterminated <script> in public/hub-desk.html");
const pageScript = htmlSrc.slice(bodyStart, endIdx);

// ── fixtures ─────────────────────────────────────────────────────────────────────────────────
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const fakeAddr = (n) => Array.from({ length: 44 }, (_, i) => B58[(i * 13 + n * (i + 11) + 5) % 58]).join("");
const fakeSig = (n) => Array.from({ length: 87 }, (_, i) => B58[(i * 11 + n * (i + 17) + 3) % 58]).join("");
const PID = "testproj";
const FUND = fakeAddr(1);
const OTHER_WALLET = fakeAddr(2);
const W1 = fakeAddr(3);
const MINT = fakeAddr(4);
const SYM = "TEST";
const DEC = 9;
const NONCE = "nonce-abc123";
const NOW = 1_800_000_000;

function batchFixture(over) {
  return Object.assign({
    id: "hb_test1", state: "pending", count: 1, totalRaw: "1000000000",
    sent: {},
    rows: [{ wallet: W1, raw: "1000000000", sent: false, sig: null, pending: false, manual: false }],
    remainingCount: 1, remainingRaw: "1000000000", remainingLines: W1 + ",1",
    browserSign: null,
  }, over || {});
}
function deskFixture(over) {
  return Object.assign({
    ok: true, as: "owner",
    project: { id: PID, symbol: SYM, fundingWallet: FUND, operatorWallets: [FUND], payoutSources: [] },
    rewardMint: MINT, decimals: DEC,
    armed: true, startedAt: NOW - 86400,
    access: { state: "active", daysLeft: 10 },
    configInForce: null,
    accrual: { slices: 1, days: 1, missed: 0, creditedRaw: "1000000000", paidRaw: "0" },
    owed: { [W1]: 1 }, owedTotalRaw: "1000000000",
    scan: { locks: 1, eligibleNow: 1 },
    funding: { wallet: FUND, obligationsRaw: "1000000000", observedBalanceRaw: "5000000000", shortfallRaw: "0" },
    lockers: [], versions: [],
    pendingBatches: [{ id: "hb_test1", at: NOW, count: 1, totalRaw: "1000000000", remaining: 1 }],
  }, over || {});
}
function signRequestFixture(over) {
  return Object.assign({
    ok: true, project: { id: PID }, batchId: "hb_test1", nonce: NONCE, idempotencyKey: "hub:signreq:x",
    requestedAt: NOW, mint: MINT, decimals: DEC, tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    fundingWallet: FUND, payoutSources: [],
    rows: [{ wallet: W1, ok: true, source: FUND, destination: fakeAddr(9), amountRaw: "1000000000" }],
    skipped: [],
  }, over || {});
}

// ── a small, self-contained fake DOM (pattern from hub-receipt-page-test.cjs's makeDom, extended
// with click()/addEventListener()/innerHTML-driven querySelector — hub-desk.html's askConfirm()
// builds a confirm bar dynamically and this needs to answer it) ────────────────────────────────
function makeEl(dom, id) {
  const listeners = {};
  const el = {
    _id: id || "",
    get id() { return this._id; },
    set id(v) { this._id = v; if (v) dom.els.set(v, el); },
    _text: "", get textContent() { return this._text; }, set textContent(v) { this._text = String(v); },
    _html: "",
    get innerHTML() { return this._html; },
    set innerHTML(v) {
      this._html = String(v);
      // Re-derive queryable children every time markup is (re)written — good enough for the
      // fixed shapes this page actually builds (askConfirm's confirm bar, in particular).
      this._byId = {};
      this.firstChild = makeEl(dom);
      const re = /id="([^"]+)"/g; let m;
      while ((m = re.exec(this._html))) { const cid = m[1]; if (!this._byId[cid]) this._byId[cid] = makeEl(dom); }
    },
    _value: "", get value() { return this._value; }, set value(v) { this._value = v; },
    disabled: false, hidden: false,
    style: { setProperty() {}, cssText: "" },
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener() {},
    click() { (listeners.click || []).forEach((fn) => fn()); },
    appendChild(c) { return c; },
    insertAdjacentHTML(pos, html) { this._html += html; },
    remove() {},
    scrollIntoView() {},
    setAttribute() {}, getAttribute() { return null; },
    querySelector(sel) {
      const cid = String(sel || "").replace(/^#/, "");
      return (this._byId && this._byId[cid]) || makeEl(dom);
    },
    querySelectorAll() { return []; },
    firstChild: null,
    parentNode: null,
  };
  return el;
}
function makeDom() {
  const els = new Map();
  const dom = {
    els,
    getElementById(id) { if (!els.has(id)) els.set(id, makeEl(dom, id)); return els.get(id); },
    createElement() { return makeEl(dom); },
    querySelector() { return makeEl(dom); },
    body: null,
  };
  dom.body = makeEl(dom, "");
  return dom;
}

// ── the sandbox — one fresh instance per test, its own STATE the fetch/wallet stubs read ──────
function makeSandbox({ connectWallet = FUND, batch = batchFixture(), desk = deskFixture(),
  signRequest = () => signRequestFixture(), observe = () => ({ ok: true, project: {}, batchId: "hb_test1", as: "owner", browserSign: { state: "settled", failed: {} }, recorded: [W1], ignored: [], journal: [], remainingWallets: [] }),
  cluckAirdropSend = null, walletBalanceUi = 1000 } = {}) {
  const dom = makeDom();
  const store = { local: new Map(), session: new Map() };
  const calls = { fetch: [], sends: 0 };
  const fakeStorage = (map) => ({
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  });
  const defaultSend = async (opts) => {
    calls.sends++;
    // A single-row happy broadcast unless a test supplies its own stub.
    opts.onResult && opts.onResult({ addr: (opts.recipients[0] || {}).addr, amount: (opts.recipients[0] || {}).amount, status: "sent", sig: fakeSig(50) });
  };
  const sandbox = {
    document: dom,
    location: { pathname: "/hub/" + PID + "/desk", search: "" },
    localStorage: fakeStorage(store.local),
    sessionStorage: fakeStorage(store.session),
    console,
    URLSearchParams,
    TextEncoder,
    btoa: (s) => Buffer.from(s, "binary").toString("base64"),
    atob: (s) => Buffer.from(s, "base64").toString("binary"),
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},
    CluckAirdrop: { send: cluckAirdropSend || defaultSend },
    CluckWallet: {
      available: () => [{ id: "fake", name: "FakeWallet" }],
      isMobile: () => false,
      mobileLinksHTML: () => "",
      connect: async () => ({ pubkey: connectWallet, provider: { signMessage: async () => ({ signature: new Uint8Array([1, 2, 3]) }), signAndSendTransaction: async () => { throw new Error("not used — CluckAirdrop.send is stubbed"); } } }),
      disconnect: () => {},
    },
    fetch: async (url, opts) => {
      calls.fetch.push(url);
      const method = (opts && opts.method) || "GET";
      const body = opts && opts.body ? JSON.parse(opts.body) : null;
      const json = (obj) => ({ ok: true, status: 200, json: async () => obj });
      if (/\/desk\/challenge/.test(url)) return json({ ok: true, message: "sign this" });
      if (/\/desk\/session$/.test(url)) return json({ ok: true, token: "tok1", expiresAt: Date.now() + 3600e3 });
      if (/\/api\/helius-rpc$/.test(url)) {
        const m = body && body.method;
        if (m === "getTokenAccountsByOwner") return json({ result: { value: [{ account: { data: { parsed: { info: { tokenAmount: { uiAmount: walletBalanceUi } } } } } }] } });
        return json({ result: null });
      }
      if (/\/desk$/.test(url)) return json(desk);
      if (/\/readiness$/.test(url)) return json({ ok: true, readiness: { items: [] }, plan: { periods: [] } });
      if (/\/sign-request$/.test(url)) { let r; try { r = signRequest(body); } catch (e) { return json({ ok: false, error: e.message }); } return json(r); }
      if (/\/observe$/.test(url)) {
        let r;
        // N3: a thrown error may carry `.retry`/`.pending` (the 503 "not indexed yet" shape) —
        // propagate both into the JSON body exactly like the real route, so observeAll()'s retry
        // loop (which reads them off the Error call() throws) has something to see.
        try { r = observe(body); } catch (e) { return { ok: false, status: 503, json: async () => ({ ok: false, error: e.message, retry: e.retry, pending: e.pending }) }; }
        return json(r);
      }
      if (/\/payout(\?|$)/.test(url)) return json({ ok: true, project: desk.project, mint: MINT, decimals: DEC, batch: batch, owed: {}, owedTotalRaw: "0", created: null, note: null, previewLines: null, pendingBatches: [] });
      return json({ ok: false, error: "unmocked: " + url });
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(cluckUtilSrc, sandbox, { filename: "cluck-util.js" });
  vm.runInContext(pageScript, sandbox, { filename: "hub-desk.html inline script" });
  return { dom, sandbox, calls, store };
}
async function settle(n) { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); }
async function connectAndLoad(env) {
  env.dom.getElementById("connect").click();
  await settle(15);
}
// Both SEND (unconditionally) and, since F6, SIGN AND SEND (after a successful sign-request) show
// an in-page confirm bar (askConfirm()) before doing anything real — click it, or the flow just
// sits there waiting for a human. `settleBefore` gives the fetch(es) leading up to the bar time to
// resolve; the bar itself is built synchronously once its promise executor runs.
async function confirmYes(env, settleBefore = 8, settleAfter = 15) {
  await settle(settleBefore);
  const bar = env.dom.els.get("confirmBar");
  if (bar) bar.querySelector("#confirmYes").click();
  await settle(settleAfter);
  return !!bar;
}

// ── F1 ───────────────────────────────────────────────────────────────────────────────────────
section("F1 — SIGN AND SEND and SEND refuse a wallet that is not the project's funding wallet");

t("SIGN AND SEND is disabled for a non-funding wallet, and refuses even if force-enabled (belt-and-braces, before any sign-request fetch)", async () => {
  const env = makeSandbox({ connectWallet: OTHER_WALLET });
  await connectAndLoad(env);
  const signSend = env.dom.getElementById("signSend");
  assert.strictEqual(signSend.disabled, true, "disabled — connected wallet is not the funding wallet");
  const fetchesBefore = env.calls.fetch.length;
  signSend.disabled = false;   // simulate a stale/raced enable — the belt-and-braces check must still catch it
  signSend.click();
  await settle(10);
  assert.strictEqual(env.calls.fetch.filter((u) => /sign-request/.test(u)).length, 0, "never even reached sign-request");
  assert.strictEqual(env.calls.sends, 0, "CluckAirdrop.send was never called");
  assert.ok(env.calls.fetch.length === fetchesBefore, "no new network calls at all");
  const status = env.dom.getElementById("signSendStatus").innerHTML;
  assert.ok(/accepted payout wallet/.test(status), status);
});

t("SEND is disabled for a non-funding wallet, and refuses even if force-enabled, before CluckAirdrop.send", async () => {
  const env = makeSandbox({ connectWallet: OTHER_WALLET });
  await connectAndLoad(env);
  const send = env.dom.getElementById("send");
  assert.strictEqual(send.disabled, true);
  send.disabled = false;
  send.click();   // SEND always confirms first, unconditionally — the funding-wallet check is inside send() itself
  await confirmYes(env);
  assert.strictEqual(env.calls.sends, 0, "CluckAirdrop.send was never called");
  const status = env.dom.getElementById("progressText").innerHTML;
  assert.ok(/accepted payout wallet/.test(status), status);
});

t("SIGN AND SEND and SEND are both enabled for the funding wallet (sanity check on the guard's other side)", async () => {
  const env = makeSandbox({ connectWallet: FUND });
  await connectAndLoad(env);
  assert.strictEqual(env.dom.getElementById("signSend").disabled, false);
  assert.strictEqual(env.dom.getElementById("send").disabled, false);
});

// ── F3 ───────────────────────────────────────────────────────────────────────────────────────
section("F3 — SIGN AND SEND is disabled while a browser-signed payout is signing/submitted");

t("disabled + a status line naming the live state, for `signing`", async () => {
  const env = makeSandbox({ connectWallet: FUND, batch: batchFixture({ browserSign: { state: "signing", nonce: NONCE, wallets: [W1], failed: {} } }) });
  await connectAndLoad(env);
  assert.strictEqual(env.dom.getElementById("signSend").disabled, true);
  const status = env.dom.getElementById("signSendStatus").innerHTML;
  assert.ok(/signing/.test(status), status);
});

t("disabled for `submitted` too", async () => {
  const env = makeSandbox({ connectWallet: FUND, batch: batchFixture({ browserSign: { state: "submitted", nonce: NONCE, wallets: [W1], failed: {} } }) });
  await connectAndLoad(env);
  assert.strictEqual(env.dom.getElementById("signSend").disabled, true);
  const status = env.dom.getElementById("signSendStatus").innerHTML;
  assert.ok(/submitted/.test(status), status);
});

// ── F5 ───────────────────────────────────────────────────────────────────────────────────────
section("F5 — a broadcast signature is persisted (ROW_STATUS/localStorage) even when observe() throws, and a second attempt refuses while unrecorded");

t("signature survives a thrown observe(), and signAndSend refuses to run again until it is recorded", async () => {
  const SIG1 = fakeSig(60);
  const env = makeSandbox({
    connectWallet: FUND,
    cluckAirdropSend: async (opts) => { opts.onResult({ addr: W1, amount: "1", status: "sent", sig: SIG1 }); },
    observe: () => { throw new Error("network blip"); },
  });
  await connectAndLoad(env);
  env.dom.getElementById("signSend").click();
  const hadConfirm = await confirmYes(env);
  assert.ok(hadConfirm, "a confirm bar should have appeared after a valid sign-request");
  // The failed observe() surfaced as an error, not a crash.
  const status1 = env.dom.getElementById("signSendStatus").innerHTML;
  assert.ok(/network blip/.test(status1), status1);
  // The signature is NOT lost — it is in localStorage under this batch's key, same mechanism
  // (ROW_STATUS + saveStatus()) the pre-existing SEND path already used.
  const key = "hub_desk_rows_" + PID + "_hb_test1";
  const saved = JSON.parse(env.store.local.get(key) || "{}");
  assert.ok(saved[W1], "the wallet's broadcast result was persisted");
  assert.strictEqual(saved[W1].status, "sent");
  assert.strictEqual(saved[W1].sig, SIG1);
  // A second attempt must refuse — same "record it first" guard the SEND button already enforces.
  const sendsBefore = env.calls.sends;
  const signRequestFetchesBefore = env.calls.fetch.filter((u) => /sign-request/.test(u)).length;
  env.dom.getElementById("signSend").click();
  await settle(15);
  assert.strictEqual(env.calls.sends, sendsBefore, "CluckAirdrop.send did not run a second time");
  assert.strictEqual(env.calls.fetch.filter((u) => /sign-request/.test(u)).length, signRequestFetchesBefore, "did not even re-request signing");
  const status2 = env.dom.getElementById("signSendStatus").innerHTML;
  assert.ok(/pay them twice|Record the SENT/.test(status2), status2);
});

t("an `unconfirmed` broadcast (30s confirm timeout) is still reported to observe() and still persisted — never silently dropped", async () => {
  const SIG2 = fakeSig(61);
  let observedSigs = null;
  const env = makeSandbox({
    connectWallet: FUND,
    cluckAirdropSend: async (opts) => { opts.onResult({ addr: W1, amount: "1", status: "unconfirmed", sig: SIG2, error: "submitted but unconfirmed after 30s" }); },
    observe: (body) => { observedSigs = body.sigs; return { ok: true, project: {}, batchId: "hb_test1", as: "owner", browserSign: { state: "settled", failed: {} }, recorded: [W1], ignored: [], journal: [], remainingWallets: [] }; },
  });
  await connectAndLoad(env);
  env.dom.getElementById("signSend").click();
  await confirmYes(env);
  assert.deepStrictEqual(observedSigs, [SIG2], "the unconfirmed signature was still handed to observe(), not dropped");
  const status = env.dom.getElementById("signSendStatus").innerHTML;
  assert.ok(/Settled/.test(status), status);
});

// ── F6 ───────────────────────────────────────────────────────────────────────────────────────
section("F6 — a tampered/stale sign-request response is refused before CluckAirdrop.send ever runs");

t("a different MINT than the batch's own is refused", async () => {
  const env = makeSandbox({ connectWallet: FUND, signRequest: () => signRequestFixture({ mint: fakeAddr(77) }) });
  await connectAndLoad(env);
  env.dom.getElementById("signSend").click();
  await settle(15);
  assert.strictEqual(env.calls.sends, 0, "CluckAirdrop.send never ran");
  assert.ok(/different token mint/.test(env.dom.getElementById("signSendStatus").innerHTML));
});

t("different DECIMALS than the batch's own is refused", async () => {
  const env = makeSandbox({ connectWallet: FUND, signRequest: () => signRequestFixture({ decimals: 6 }) });
  await connectAndLoad(env);
  env.dom.getElementById("signSend").click();
  await settle(15);
  assert.strictEqual(env.calls.sends, 0);
  assert.ok(/different decimals/.test(env.dom.getElementById("signSendStatus").innerHTML));
});

t("a wallet not present in this batch's own rows is refused", async () => {
  const env = makeSandbox({ connectWallet: FUND, signRequest: () => signRequestFixture({ rows: [{ wallet: fakeAddr(88), ok: true, source: FUND, destination: fakeAddr(9), amountRaw: "1000000000" }] }) });
  await connectAndLoad(env);
  env.dom.getElementById("signSend").click();
  await settle(15);
  assert.strictEqual(env.calls.sends, 0);
  assert.ok(/not part of this batch/.test(env.dom.getElementById("signSendStatus").innerHTML));
});

t("an amount bigger than the batch's own row is refused", async () => {
  const env = makeSandbox({ connectWallet: FUND, signRequest: () => signRequestFixture({ rows: [{ wallet: W1, ok: true, source: FUND, destination: fakeAddr(9), amountRaw: "9999999999" }] }) });
  await connectAndLoad(env);
  env.dom.getElementById("signSend").click();
  await settle(15);
  assert.strictEqual(env.calls.sends, 0);
  // esc() renders the apostrophe as &#39; — match around it, not through it.
  assert.ok(/asked for more than this batch/.test(env.dom.getElementById("signSendStatus").innerHTML));
});

t("a matching, untampered sign-request response is accepted and CluckAirdrop.send runs (sanity check)", async () => {
  const env = makeSandbox({ connectWallet: FUND });
  await connectAndLoad(env);
  env.dom.getElementById("signSend").click();
  const hadConfirm = await confirmYes(env);
  assert.ok(hadConfirm, "a confirm bar should have appeared — nothing here should have been refused");
  assert.strictEqual(env.calls.sends, 1, "CluckAirdrop.send ran exactly once");
  assert.ok(/Settled/.test(env.dom.getElementById("signSendStatus").innerHTML));
});

// ── P2-4 ─────────────────────────────────────────────────────────────────────────────────────
section("P2-4 — the desk accepts any of the project's accepted payout wallets, not just fundingWallet");

t("a payoutSources wallet (not fundingWallet) is accepted for both SEND and SIGN AND SEND", async () => {
  const VAULT = fakeAddr(20);
  const env = makeSandbox({ connectWallet: VAULT, desk: deskFixture({ project: { id: PID, symbol: SYM, fundingWallet: FUND, operatorWallets: [FUND], payoutSources: [VAULT] } }) });
  await connectAndLoad(env);
  assert.strictEqual(env.dom.getElementById("signSend").disabled, false);
  assert.strictEqual(env.dom.getElementById("send").disabled, false);
});

t("the reason line names the accepted wallets (short addresses) when the connected wallet is none of them", async () => {
  const env = makeSandbox({ connectWallet: OTHER_WALLET, desk: deskFixture({ project: { id: PID, symbol: SYM, fundingWallet: FUND, operatorWallets: [FUND], payoutSources: [fakeAddr(21)] } }) });
  await connectAndLoad(env);
  const status = env.dom.getElementById("signSendStatus").innerHTML;
  assert.ok(/accepted payout wallet/.test(status), status);
});

t("sign-request's own frozen `payoutSources` widens the belt-and-braces check after sign-request returns", async () => {
  const VAULT = fakeAddr(22);
  const env = makeSandbox({
    connectWallet: VAULT,
    desk: deskFixture({ project: { id: PID, symbol: SYM, fundingWallet: FUND, operatorWallets: [FUND], payoutSources: [VAULT] } }),
    signRequest: () => signRequestFixture({ fundingWallet: FUND, payoutSources: [VAULT] }),
  });
  await connectAndLoad(env);
  env.dom.getElementById("signSend").click();
  const hadConfirm = await confirmYes(env);
  assert.ok(hadConfirm, "the server's own payoutSources list must clear the belt-and-braces check too");
  assert.strictEqual(env.calls.sends, 1);
});

// ── N4 ───────────────────────────────────────────────────────────────────────────────────────
section("N4 — an `unconfirmed` (not just `sent`) ROW_STATUS entry blocks a re-sign/re-send, and the send() purge keeps it");

t("an unconfirmed row (with a signature) blocks SIGN AND SEND from re-broadcasting", async () => {
  const SIG1 = fakeSig(70);
  const env = makeSandbox({ connectWallet: FUND });
  await connectAndLoad(env);
  env.store.local.set("hub_desk_rows_" + PID + "_hb_test1", JSON.stringify({ [W1]: { status: "unconfirmed", sig: SIG1 } }));
  env.dom.getElementById("reload").click();
  await settle(20);
  env.dom.getElementById("signSend").click();
  await settle(15);
  assert.strictEqual(env.calls.sends, 0, "CluckAirdrop.send did not run — the unconfirmed row is still unrecorded");
  assert.ok(/pay them twice|Record the SENT/.test(env.dom.getElementById("signSendStatus").innerHTML));
});

t("an unconfirmed row (with a signature) blocks SEND from re-broadcasting", async () => {
  const SIG1 = fakeSig(71);
  const env = makeSandbox({ connectWallet: FUND });
  await connectAndLoad(env);
  env.store.local.set("hub_desk_rows_" + PID + "_hb_test1", JSON.stringify({ [W1]: { status: "unconfirmed", sig: SIG1 } }));
  env.dom.getElementById("reload").click();
  await settle(20);
  env.dom.getElementById("send").click();
  await confirmYes(env, 4, 15);
  assert.strictEqual(env.calls.sends, 0, "CluckAirdrop.send did not run");
  assert.ok(/pay them twice|Record the SENT/.test(env.dom.getElementById("progressText").innerHTML));
});

t("the send() purge keeps an unconfirmed ROW_STATUS entry even when it carries no signature yet (unrecordedSent() itself requires one)", async () => {
  const env = makeSandbox({ connectWallet: FUND, cluckAirdropSend: async (opts) => { opts.onResult && opts.onResult({ addr: W1, amount: "1", status: "sent", sig: fakeSig(72) }); } });
  await connectAndLoad(env);
  const key = "hub_desk_rows_" + PID + "_hb_test1";
  env.store.local.set(key, JSON.stringify({ [W1]: { status: "unconfirmed", sig: null } }));
  env.dom.getElementById("reload").click();
  await settle(20);
  env.dom.getElementById("send").click();
  await confirmYes(env, 4, 15);
  const saved = JSON.parse(env.store.local.get(key) || "{}");
  assert.ok(saved[W1], "the unconfirmed (sig-less) entry survived send()'s purge");
  assert.strictEqual(saved[W1].status, "sent", "…then was overwritten by this send's own real result, same as any other row");
});

// ── N3 ───────────────────────────────────────────────────────────────────────────────────────
section("N3 — signAndSend retries observe() on a `pending`/`retry:true` response before surfacing anything");

t("a partial observe (one signature still pending) is retried automatically and settles on the second attempt", async () => {
  let calls = 0;
  const SIG1 = fakeSig(80);
  const env = makeSandbox({
    connectWallet: FUND,
    observe: () => {
      calls++;
      if (calls === 1) return { ok: true, project: {}, batchId: "hb_test1", as: "owner", browserSign: { state: "signing", failed: {} }, recorded: [], ignored: [], journal: [], remainingWallets: [W1], pending: [SIG1], retry: true };
      return { ok: true, project: {}, batchId: "hb_test1", as: "owner", browserSign: { state: "settled", failed: {} }, recorded: [W1], ignored: [], journal: [], remainingWallets: [] };
    },
  });
  await connectAndLoad(env);
  env.dom.getElementById("signSend").click();
  await settle(8);
  const bar = env.dom.els.get("confirmBar");
  assert.ok(bar, "a confirm bar should have appeared");
  bar.querySelector("#confirmYes").click();
  // observeAll()'s backoff is a REAL setTimeout (production timing) — settle() only drains
  // microtasks/setImmediate, so this waits real wall-clock time long enough for the one retry.
  await new Promise((r) => setTimeout(r, 800));
  assert.strictEqual(calls, 2, "observe() was retried exactly once after the pending response");
  assert.ok(/Settled/.test(env.dom.getElementById("signSendStatus").innerHTML));
});

t("a thrown retry:true (the all-unindexed 503 shape) is retried up to 3 tries total, then surfaced", async () => {
  let calls = 0;
  const env = makeSandbox({
    connectWallet: FUND,
    observe: () => { calls++; throw Object.assign(new Error("the chain has not indexed these signature(s) yet"), { retry: true, pending: [fakeSig(81)] }); },
  });
  await connectAndLoad(env);
  env.dom.getElementById("signSend").click();
  await settle(8);
  const bar = env.dom.els.get("confirmBar");
  assert.ok(bar, "a confirm bar should have appeared");
  bar.querySelector("#confirmYes").click();
  await new Promise((r) => setTimeout(r, 1500));
  assert.strictEqual(calls, 3, "exactly 3 attempts before giving up");
  assert.ok(/not indexed/.test(env.dom.getElementById("signSendStatus").innerHTML));
});

// ── P3-9 / P3-10 ─────────────────────────────────────────────────────────────────────────────
section("P3-9/P3-10 — the settled wording says 'this payout', and a stuck live flow offers a real recovery button");

t("the settled line reads 'every row this payout named', not 'this batch'", async () => {
  const env = makeSandbox({ connectWallet: FUND });
  await connectAndLoad(env);
  env.dom.getElementById("signSend").click();
  await confirmYes(env);
  const status = env.dom.getElementById("signSendStatus").innerHTML;
  assert.ok(/this payout named/.test(status), status);
  assert.ok(!/this batch named/.test(status), status);
});

t("a live (signing/submitted) browserSign with a broadcast signature on file offers an OBSERVE WHAT I BROADCAST button that re-posts it under the batch's own nonce", async () => {
  const SIG1 = fakeSig(90);
  let observedBody = null;
  // A mutable batch: the mock /payout route always echoes THIS object, so mutating its
  // browserSign in the observe() stub — the way a real observe() call updates the real batch —
  // is what the finally-block reload after the click actually sees, instead of a static fixture
  // that would still read "signing" forever and re-clobber the settled status line.
  const liveBatch = batchFixture({ browserSign: { state: "signing", nonce: NONCE, wallets: [W1], failed: {} } });
  const env = makeSandbox({
    connectWallet: FUND,
    batch: liveBatch,
    observe: (body) => {
      observedBody = body;
      liveBatch.browserSign = { state: "settled", nonce: NONCE, wallets: [W1], failed: {} };
      return { ok: true, project: {}, batchId: "hb_test1", as: "owner", browserSign: liveBatch.browserSign, recorded: [W1], ignored: [], journal: [], remainingWallets: [] };
    },
  });
  await connectAndLoad(env);
  env.store.local.set("hub_desk_rows_" + PID + "_hb_test1", JSON.stringify({ [W1]: { status: "sent", sig: SIG1 } }));
  env.dom.getElementById("reload").click();
  await settle(20);
  const btn = env.dom.getElementById("observeBroadcastBtn");
  assert.ok(btn, "the OBSERVE WHAT I BROADCAST button must exist while live with a broadcast on file");
  btn.click();
  await settle(20);
  assert.deepStrictEqual(observedBody && observedBody.sigs, [SIG1], "it re-posts exactly the signature this browser broadcast");
  assert.strictEqual(observedBody && observedBody.nonce, NONCE, "…under the batch's OWN current nonce, never a fresh sign-request's");
  assert.ok(/Settled/.test(env.dom.getElementById("signSendStatus").innerHTML));
});

t("no OBSERVE button when live but nothing was ever broadcast (ROW_STATUS empty)", async () => {
  const env = makeSandbox({ connectWallet: FUND, batch: batchFixture({ browserSign: { state: "signing", nonce: NONCE, wallets: [W1], failed: {} } }) });
  await connectAndLoad(env);
  assert.strictEqual(env.dom.els.has("observeBroadcastBtn"), false);
});

// ── P1-A ─────────────────────────────────────────────────────────────────────────────────────
section("P1-A — observeAll() chunks a large sign-request across multiple observe() calls, each within the server's wallets×signatures bound");

t("a 90-row sign-request yields multiple observe() calls, none exceeding the per-call signature bound", async () => {
  const N = 90;
  const wallets = Array.from({ length: N }, (_, i) => fakeAddr(100 + i));
  const batchRows = wallets.map((w) => ({ wallet: w, raw: "1000000000", sent: false, sig: null, pending: false, manual: false }));
  const srRows = wallets.map((w) => ({ wallet: w, ok: true, source: FUND, destination: fakeAddr(9), amountRaw: "1000000000" }));
  const observeCallSizes = [];
  const env = makeSandbox({
    connectWallet: FUND,
    batch: batchFixture({ id: "hb_big", count: N, totalRaw: "90000000000", rows: batchRows, remainingCount: N, remainingRaw: "90000000000" }),
    signRequest: () => signRequestFixture({ batchId: "hb_big", rows: srRows }),
    // Mirrors CluckAirdrop.planBatches' real packing (16 recipients per transaction, one shared
    // signature per transaction) without pulling in the real chain-building code — P1-A's bound
    // crosses at N≈84 rows for exactly this reason.
    cluckAirdropSend: async (opts) => {
      var recs = opts.recipients;
      for (var i = 0; i < recs.length; i += 16) {
        var sig = fakeSig(300 + i);
        recs.slice(i, i + 16).forEach(function (r) { opts.onResult({ addr: r.addr, amount: r.amount, status: "sent", sig: sig }); });
      }
    },
    observe: (body) => {
      observeCallSizes.push((body.sigs || []).length);
      return { ok: true, project: {}, batchId: "hb_big", as: "owner", browserSign: { state: "submitted", nonce: NONCE, wallets: wallets, failed: {} }, recorded: [], ignored: [], journal: [], remainingWallets: wallets };
    },
  });
  await connectAndLoad(env);
  env.dom.getElementById("signSend").click();
  await confirmYes(env, 8, 10);
  // 18 sequential chunked observe() calls, each a real Promise chain (no fake timers) — give the
  // event loop plenty of ticks to drain all of them.
  await settle(400);
  assert.ok(observeCallSizes.length > 1, "a 90-row sign-request must be chunked into more than one observe() call — got " + observeCallSizes.length);
  const per = Math.max(1, Math.min(40, N + 5, Math.floor(500 / N)));
  observeCallSizes.forEach((n) => assert.ok(n > 0 && n <= per, "every observe() call must stay within the bound (<=" + per + " for " + N + " wallets): got " + n));
});

// ── R3-6/R3-7/P3-F ───────────────────────────────────────────────────────────────────────────
section("R3-6/R3-7/P3-F — START A FRESH SIGN-REQUEST recovers a live flow by rotating the nonce and re-observing under it, never re-broadcasting");

t("the button appears for the accepted wallet while live, POSTs force=1, and re-observes the known broadcast signature under the NEW nonce", async () => {
  const SIG1 = fakeSig(95);
  const NEW_NONCE = "nonce-fresh-999";
  let signRequestForce = null;
  let observedNonce = null;
  const liveBatch = batchFixture({ browserSign: { state: "submitted", nonce: NONCE, wallets: [W1], failed: {} } });
  const env = makeSandbox({
    connectWallet: FUND,
    batch: liveBatch,
    signRequest: (body) => { signRequestForce = body && body.force; return signRequestFixture({ nonce: NEW_NONCE }); },
    observe: (body) => {
      observedNonce = body.nonce;
      liveBatch.browserSign = { state: "settled", nonce: NEW_NONCE, wallets: [W1], failed: {} };
      return { ok: true, project: {}, batchId: "hb_test1", as: "owner", browserSign: liveBatch.browserSign, recorded: [W1], ignored: [], journal: [], remainingWallets: [] };
    },
  });
  await connectAndLoad(env);
  env.store.local.set("hub_desk_rows_" + PID + "_hb_test1", JSON.stringify({ [W1]: { status: "sent", sig: SIG1, nonce: NONCE } }));
  env.dom.getElementById("reload").click();
  await settle(20);
  const btn = env.dom.getElementById("startFreshBtn");
  assert.ok(btn, "the START A FRESH SIGN-REQUEST button must exist for the accepted wallet while live");
  btn.click();
  await settle(30);
  assert.strictEqual(signRequestForce, "1", "force=1 — an explicit abandon-and-reissue, never a silent double sign-request");
  assert.strictEqual(observedNonce, NEW_NONCE, "the already-broadcast signature is re-observed under the NEW nonce, not the stale one — never re-signed");
  assert.ok(/Settled/.test(env.dom.getElementById("signSendStatus").innerHTML));
});

t("no START A FRESH SIGN-REQUEST button when the connected wallet is not an accepted payout source", async () => {
  const env = makeSandbox({ connectWallet: OTHER_WALLET, batch: batchFixture({ browserSign: { state: "submitted", nonce: NONCE, wallets: [W1], failed: {} } }) });
  await connectAndLoad(env);
  assert.strictEqual(env.dom.els.has("startFreshBtn"), false);
});

(async () => {
  for (const [n, f] of queue) {
    if (!f) { console.log("\n" + n); continue; }
    try { await f(); console.log("  ✓ " + n); pass++; }
    catch (e) { console.log("  ✗ " + n + "\n      " + (e.stack || e.message).split("\n").slice(0, 10).join("\n      ")); fail++; }
  }
  console.log(`\n${fail === 0 ? "all passed" : fail + " FAILED"} (${pass} passed)`);
  process.exit(fail ? 1 : 0);
})();
