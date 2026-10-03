#!/usr/bin/env node
// Pins what a Firepit Rescan may hide after this session closed an account or withdrew a surplus
// (src/seeker/tools/firepit-recent.js, and the same rule in public/firepit.html — both copies run
// against every case so they can't drift apart).
//
// Codex review of #473 broke the earlier slot rule both ways: a getSlot read after confirmation is
// not the transaction's slot, and a scan-wide slot says nothing about one account. The rule now:
// only a row EXACTLY the state we acted on is a suspect, and a suspect is hidden only when the
// chain itself — read at minContextSlot = the slot our transaction landed in — says it is gone
// (or, for a withdrawal, lower). No proof, no hiding.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

let failures = 0;
const ok = (name, cond, extra) => { console.log(`  ${cond ? "✓" : "✗"} ${name}${cond || extra === undefined ? "" : "  — " + JSON.stringify(extra)}`); if (!cond) failures++; };

const ACC = "Acct1111111111111111111111111111111111111111";
const OTHER = "Other111111111111111111111111111111111111111";
const row = (o) => Object.assign({ tokenAccount: ACC, amountRaw: "1000000", rentLamports: 2039280, surplusLamports: 0, surplusEligible: false }, o);

// A scripted chain. `nodes` is the sequence of nodes the load balancer hands out, each with the
// slot it has processed; `accounts` is the chain's truth past our transaction.
function chain({ nodes, accounts }) {
  const calls = [];
  let n = 0;
  const rpc = async (method, params) => {
    calls.push({ method, params });
    if (method !== "getMultipleAccounts") throw new Error("unexpected " + method);
    const node = nodes[Math.min(n++, nodes.length - 1)];
    const min = params[1] && params[1].minContextSlot;
    if (node === "down") throw new Error("network");
    if (typeof min === "number" && node < min) { const e = new Error("Minimum context slot has not been reached"); e.rpcCode = -32016; throw e; }
    return { context: { slot: node }, value: params[0].map((k) => (k in accounts ? accounts[k] : null)) };
  };
  return { rpc, calls };
}
const noSleep = () => Promise.resolve();

function appCopy(mod) {
  let recent;
  return {
    reset() { recent = { closed: {}, withdrawn: {} }; },
    closed(e) { recent.closed[ACC] = e; },
    withdrawn(e) { recent.withdrawn[ACC] = { at: e.at, prior: e.prior, txSlot: e.txSlot }; },
    run(list, rpc, now) { return mod.reconcileRecent(list, recent, rpc, { now, sleep: noSleep }); },
  };
}
function webCopy() {
  const html = fs.readFileSync(path.join(__dirname, "..", "public", "firepit.html"), "utf8");
  const start = html.indexOf("var RECENT_MS = 120000;");
  const end = html.indexOf("async function scan(){");
  if (start < 0 || end < 0) throw new Error("could not find reconcileRecent in public/firepit.html");
  const ctx = { rpc: null, Promise, setTimeout, Math, Number, String, Object, Array, isFinite };
  vm.createContext(ctx);
  vm.runInContext(html.slice(start, end), ctx);
  return {
    reset() { for (const k of Object.keys(ctx.recentlyClosed)) delete ctx.recentlyClosed[k]; for (const k of Object.keys(ctx.recentlyWithdrawn)) delete ctx.recentlyWithdrawn[k]; },
    closed(e) { ctx.recentlyClosed[ACC] = { at: e.at, amountRaw: e.amountRaw, lamports: e.lamports, txSlot: e.txSlot }; },
    withdrawn(e) { ctx.recentlyWithdrawn[ACC] = { at: e.at, priorLamports: e.prior, txSlot: e.txSlot }; },
    run(list, rpc, now) { ctx.rpc = rpc; return ctx.reconcileRecent(list, { now, sleep: noSleep }); },
  };
}

async function suite(label, c) {
  console.log(`\n${label}`);
  const now = Date.now();
  const snap = { at: now, amountRaw: "1000000", lamports: 2039280, txSlot: 100 };
  let ch, out;

  // Codex case 1: closed at 100, recreated with identical balances at 105, scanned at 110.
  c.reset(); c.closed(snap); ch = chain({ nodes: [110], accounts: { [ACC]: { lamports: 2039280 } } });
  out = await c.run([row()], ch.rpc, now);
  ok("Codex: an account recreated with identical balances after our close is SHOWN", out.length === 1);
  ok("…and the proof read asked for exactly that account at minContextSlot = our transaction's slot",
    ch.calls.length === 1 && ch.calls[0].params[0].length === 1 && ch.calls[0].params[0][0] === ACC && ch.calls[0].params[1].minContextSlot === 100, ch.calls.map((x) => x.params));

  // Codex case 2: closed at 100, the scan came from a node at 95 (stale). The first proof node is
  // also behind and refuses; a caught-up node says the account is gone.
  c.reset(); c.closed(snap); ch = chain({ nodes: [95, 120], accounts: {} });
  out = await c.run([row()], ch.rpc, now);
  ok("Codex: a stale view of the account we closed is HIDDEN once a node past our slot says it's gone", out.length === 0);
  ok("…a node below our slot is never taken as the answer (it was retried)", ch.calls.length === 2);

  c.reset(); c.closed({ ...snap, txSlot: null }); ch = chain({ nodes: [120], accounts: {} });
  out = await c.run([row()], ch.rpc, now);
  ok("no transaction slot recorded → no proof → the row is shown, and the chain isn't even asked", out.length === 1 && ch.calls.length === 0);

  c.reset(); c.closed(snap); ch = chain({ nodes: [90, 91, 92], accounts: {} });
  out = await c.run([row()], ch.rpc, now);
  ok("no node ever reaches our slot → no proof → the row is shown", out.length === 1 && ch.calls.length === 3);

  c.reset(); c.closed(snap); ch = chain({ nodes: ["down"], accounts: {} });
  out = await c.run([row()], ch.rpc, now);
  ok("the RPC is down → no proof → the row is shown", out.length === 1);

  c.reset(); c.closed(snap); ch = chain({ nodes: [120], accounts: {} });
  out = await c.run([row({ amountRaw: "5000000" })], ch.rpc, now);
  ok("a row that differs from what we closed is new state: shown, and never re-checked", out.length === 1 && ch.calls.length === 0);

  c.reset(); c.closed({ ...snap, at: now - 121000 }); ch = chain({ nodes: [120], accounts: {} });
  out = await c.run([row()], ch.rpc, now);
  ok("after two minutes the record lapses: shown, not re-checked", out.length === 1 && ch.calls.length === 0);

  c.reset(); c.closed(snap); ch = chain({ nodes: [120], accounts: {} });
  out = await c.run([row(), row({ tokenAccount: OTHER })], ch.rpc, now);
  ok("other accounts pass through untouched, and only the suspect is re-read", out.length === 1 && out[0].tokenAccount === OTHER && ch.calls[0].params[0].join() === ACC);

  // Withdrawals.
  const prior = 1855569, after = 1488440;
  const wSnap = { at: now, prior, txSlot: 100 };
  c.reset(); c.withdrawn(wSnap); ch = chain({ nodes: [95, 120], accounts: { [ACC]: { lamports: after } } });
  out = await c.run([row({ rentLamports: prior, surplusLamports: 367129, surplusEligible: true })], ch.rpc, now);
  ok("a stale view of a surplus we withdrew is corrected from the chain (no surplus re-offered)",
    out.length === 1 && out[0].rentLamports === after && out[0].surplusLamports === 0 && out[0].surplusEligible === false, out[0]);

  c.reset(); c.withdrawn(wSnap); ch = chain({ nodes: [120], accounts: {} });
  out = await c.run([row({ rentLamports: prior + 50000, surplusLamports: 417129, surplusEligible: true })], ch.rpc, now);
  ok("a genuine new deposit (different lamports) is offered and never re-checked", out[0].surplusEligible === true && out[0].surplusLamports === 417129 && ch.calls.length === 0);

  c.reset(); c.withdrawn(wSnap); ch = chain({ nodes: [120], accounts: { [ACC]: { lamports: prior } } });
  out = await c.run([row({ rentLamports: prior, surplusLamports: 367129, surplusEligible: true })], ch.rpc, now);
  ok("a deposit that lands the balance back at exactly the old figure is confirmed by the chain and offered", out[0].surplusEligible === true && out[0].surplusLamports === 367129);

  c.reset(); c.withdrawn({ ...wSnap, txSlot: null }); ch = chain({ nodes: [120], accounts: {} });
  out = await c.run([row({ rentLamports: prior, surplusLamports: 367129, surplusEligible: true })], ch.rpc, now);
  ok("a withdrawal with no recorded slot hides nothing", out[0].surplusEligible === true && ch.calls.length === 0);
}

(async () => {
  const mod = await import(path.join(__dirname, "..", "src", "seeker", "tools", "firepit-recent.js"));
  console.log("\nFirepit — what a Rescan may hide");
  await suite("app (src/seeker/tools/firepit-recent.js)", appCopy(mod));
  await suite("website (public/firepit.html)", webCopy());

  // The app's tx-slot source: sign.js signatureSlot reads the chain's own status entry.
  console.log("\nsign.js signatureSlot");
  const sign = await import(path.join(__dirname, "..", "src", "seeker", "sign.js"));
  const st = (v) => async (m, p) => { if (m !== "getSignatureStatuses" || !(p[1] && p[1].searchTransactionHistory)) throw new Error("bad call"); return v; };
  ok("a landed signature gives its slot", (await sign.signatureSlot(st({ value: [{ slot: 4242, err: null, confirmationStatus: "confirmed" }] }), "S")) === 4242);
  ok("a FAILED signature gives no slot (nothing was closed)", (await sign.signatureSlot(st({ value: [{ slot: 4242, err: { x: 1 } }] }), "S")) === null);
  ok("no status / a malformed answer / an RPC error → null (no proof)",
    (await sign.signatureSlot(st({ value: [null] }), "S")) === null && (await sign.signatureSlot(st({}), "S")) === null &&
    (await sign.signatureSlot(async () => { throw new Error("down"); }, "S")) === null);
  console.log(failures ? `\n${failures} FAILED` : "\nall passed");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
