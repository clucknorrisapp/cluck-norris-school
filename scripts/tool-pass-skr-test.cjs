#!/usr/bin/env node
"use strict";
// The Seeker app's SKR-paid tools pass (docs/SEEKER_SKR_PASS_DESIGN.md) — a MONEY PATH, so every
// rule is pinned three ways:
//   A. lib/tool-pass-skr.js     the quote token, the BigInt amount, and the on-chain evidence reader,
//                               against fixture getTransaction responses (pure, no network);
//   B. lib/tool-pass-redeem.js  the SKR leg of redemption with fault injection (window, recovery,
//                               store failure, hub collision) — pure;
//   C. the REAL server          booted with a stub JSON-RPC node and a real ed25519 keypair standing
//                               in for the wallet: quote → pay → session, plus every refusal.
// Zero outside network is required: the stub is the only RPC endpoint the server is given first,
// and the SKR price is seeded into the kv file the server reads at boot.
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const { PublicKey, Keypair } = require("@solana/web3.js");
const splToken = require("@solana/spl-token");

const SKR = require("../lib/tool-pass-skr");
const { redeemPaidPass, DAY_MS } = require("../lib/tool-pass-redeem");
const TERMS = require("../lib/tool-pass-terms");
const { SKR_MINT } = require("../lib/tool-pass-qualify");

let failures = 0;
const ok = (name, cond, detail) => { if (cond) console.log("  ✓ " + name); else { failures++; console.log("  ✗ " + name + (detail !== undefined ? "\n      " + (typeof detail === "string" ? detail : JSON.stringify(detail)) : "")); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const RECEIVER = "7LHBcRYosycMBwBqxBHeRiDQohYzpppDALKYVT4TNY5H";   // SOL_UNLOCK_WALLET — the same receiver the SOL pass pays
const KEY = "skr-pass-test-key";
const pk = () => Keypair.generate().publicKey.toBase58();
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58(bytes) { let n = 0n; for (const b of bytes) n = n * 256n + BigInt(b); let s = ""; while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; } for (let i = 0; i < bytes.length && bytes[i] === 0; i++) s = "1" + s; return s; }
const newSig = () => { let s; do { s = b58(crypto.randomBytes(64)); } while (s.length < 86 || s.length > 90); return s; };

// ───────────────────────────── A. the library ─────────────────────────────
console.log("\nA1. amountRaw — BigInt ceiling, no float drift\n");
{
  ok("$1 at $0.02 with 6 decimals = 50 SKR exactly", SKR.skrAmountRaw(1, 0.02, 6) === "50000000", SKR.skrAmountRaw(1, 0.02, 6));
  ok("rounds UP: $1 at $0.03 → 33.333334 SKR (never worth less than the dollar)", SKR.skrAmountRaw(1, 0.03, 6) === "33333334", SKR.skrAmountRaw(1, 0.03, 6));
  ok("9 decimals: $1 at $0.03 → 33.333333334", SKR.skrAmountRaw(1, 0.03, 9) === "33333333334", SKR.skrAmountRaw(1, 0.03, 9));
  ok("an exactly-representable price is exact: $1 at $0.25 → 4 SKR", SKR.skrAmountRaw(1, 0.25, 6) === "4000000");
  ok("float noise in the price (0.1 + 0.2) lands on the integer ceiling, not a float multiply", SKR.skrAmountRaw(1, 0.1 + 0.2, 7) === "33333334", SKR.skrAmountRaw(1, 0.1 + 0.2, 7));
  const big = SKR.skrAmountRaw(1, 0.000123456789, 6);
  ok("a tiny price stays an integer string", /^[1-9][0-9]*$/.test(big), big);
  for (const bad of [0, -1, NaN, Infinity, "x", 1e-30]) {
    let threw = false; try { SKR.skrAmountRaw(1, bad, 6); } catch (_) { threw = true; }
    ok("price " + String(bad) + " is refused, not turned into a number", threw);
  }
  ok("rawToUi trims trailing zeros", SKR.rawToUi("50000000", 6) === "50" && SKR.rawToUi("33333334", 6) === "33.333334" && SKR.rawToUi("5", 6) === "0.000005");
}

console.log("\nA2. the quote token — HMAC, purpose, wallet; timing is NOT its job\n");
const W = pk();
{
  const NOW = 1_800_000_000_000;
  const q = SKR.issueSkrQuote({ secret: KEY, wallet: W, amountRaw: "50000000", now: NOW });
  const v = SKR.verifySkrQuote({ secret: KEY, token: q.token, wallet: W });
  ok("a fresh quote verifies and returns {amountRaw, iat, exp}", v && v.amountRaw === "50000000" && v.iat === NOW && v.exp === NOW + 10 * 60e3, v);
  ok("an EXPIRED quote still verifies — timing is judged on the payment's chain time (Codex r27 f4)", !!SKR.verifySkrQuote({ secret: KEY, token: SKR.issueSkrQuote({ secret: KEY, wallet: W, amountRaw: "5", now: 1000 }).token, wallet: W }));
  ok("another wallet cannot present it", SKR.verifySkrQuote({ secret: KEY, token: q.token, wallet: pk() }) === null);
  ok("a different secret refuses it", SKR.verifySkrQuote({ secret: "other", token: q.token, wallet: W }) === null);
  const [body, sig] = q.token.split(".");
  const payload = JSON.parse(Buffer.from(body, "base64url").toString());
  const reb = (over) => Buffer.from(JSON.stringify({ ...payload, ...over })).toString("base64url") + "." + sig;
  ok("tampered amount → refused", SKR.verifySkrQuote({ secret: KEY, token: reb({ a: "1" }), wallet: W }) === null);
  ok("tampered wallet → refused", SKR.verifySkrQuote({ secret: KEY, token: reb({ w: pk() }), wallet: W }) === null);
  ok("tampered iat → refused", SKR.verifySkrQuote({ secret: KEY, token: reb({ iat: payload.iat - 3600e3 }), wallet: W }) === null);
  ok("tampered exp → refused", SKR.verifySkrQuote({ secret: KEY, token: reb({ exp: payload.exp + 3600e3 }), wallet: W }) === null);
  ok("tampered purpose → refused", SKR.verifySkrQuote({ secret: KEY, token: reb({ t: "tools-pay" }), wallet: W }) === null);
  // A real token of ANOTHER purpose, signed with the real key, must not pass as a quote.
  const payBody = Buffer.from(JSON.stringify({ t: "tools-pay", w: W, a: "50000000", iat: NOW, exp: NOW + 6e5 })).toString("base64url");
  const payTok = payBody + "." + crypto.createHmac("sha256", KEY).update("tools-pay." + payBody).digest("base64url");
  ok("a pay-intent-shaped token is not a quote", SKR.verifySkrQuote({ secret: KEY, token: payTok, wallet: W }) === null);
  const longBody = Buffer.from(JSON.stringify({ t: "tools-skr", w: W, a: "50000000", iat: NOW, exp: NOW + 24 * 3600e3 })).toString("base64url");
  const longTok = longBody + "." + crypto.createHmac("sha256", KEY).update("tools-skr." + longBody).digest("base64url");
  ok("even a validly-signed token claiming a day-long life is refused (bounded span)", SKR.verifySkrQuote({ secret: KEY, token: longTok, wallet: W }) === null);
  ok("garbage / empty / no secret → null, never a throw", SKR.verifySkrQuote({ secret: KEY, token: "x", wallet: W }) === null && SKR.verifySkrQuote({ secret: KEY, token: "", wallet: W }) === null && SKR.verifySkrQuote({ secret: "", token: q.token, wallet: W }) === null);
  ok("the window is two-sided on chain time", SKR.checkPaymentWindow(v, v.iat) === null && SKR.checkPaymentWindow(v, v.exp + 4 * 60e3) === null
    && !!SKR.checkPaymentWindow(v, v.iat - 3 * 60e3) && !!SKR.checkPaymentWindow(v, v.exp + 6 * 60e3));
}

console.log("\nA3. the on-chain evidence — whose SKR fell, whose rose, which instruction moved it\n");
// A parsed getTransaction fixture. The wallet's SKR account is SRC (owner `srcOwner`), the
// receiver's is DST (owner `dstOwner`).
function fixtureTx(o = {}) {
  const wallet = o.srcOwner || W, feePayer = o.feePayer || wallet;
  const mint = o.mint || SKR_MINT, prog = o.program || SKR.TOKEN_CLASSIC;
  const SRC = o.src || pk(), DST = o.dst || pk();
  const keys = [feePayer, SRC, DST, mint, prog, wallet];
  const amt = BigInt(o.amount === undefined ? "50000000" : o.amount);
  const srcBefore = amt + 1_000_000_000n;
  const bal = (idx, owner, m, v) => ({ accountIndex: idx, mint: m, owner, uiTokenAmount: { amount: v.toString(), decimals: 6 } });
  const dstBefore = BigInt(o.dstBefore || 0);
  const dstAfter = o.dstAfter !== undefined ? BigInt(o.dstAfter) : dstBefore + amt;
  const pre = [bal(1, wallet, mint, srcBefore)]; if (o.dstExistsBefore) pre.push(bal(2, o.dstOwner || RECEIVER, mint, dstBefore));
  const post = [bal(1, wallet, mint, srcBefore - amt), bal(2, o.dstOwner || RECEIVER, mint, dstAfter)];
  for (const extra of o.extraPre || []) pre.push(extra);
  for (const extra of o.extraPost || []) post.push(extra);
  const parsedIx = (type) => ({ program: prog === SKR.TOKEN_2022 ? "spl-token-2022" : "spl-token", programId: prog, parsed: type === "plain"
    ? { type: "transfer", info: { source: SRC, destination: DST, authority: wallet, amount: amt.toString() } }
    : { type: "transferChecked", info: { source: SRC, destination: DST, mint, authority: wallet, tokenAmount: { amount: amt.toString(), decimals: 6, uiAmountString: "x" } } } });
  const kind = o.ix === undefined ? "checked" : o.ix;
  const top = []; const inner = [];
  if (kind === "checked" || kind === "plain") top.push(parsedIx(kind));
  if (kind === "inner") inner.push({ index: 0, instructions: [parsedIx("checked")] });
  if (kind === "inner") top.push({ programId: "SomeRouter1111111111111111111111111111111111", accounts: [], data: "" });
  return { blockTime: o.blockTime === undefined ? Math.floor(Date.now() / 1000) : o.blockTime, transaction: { message: { accountKeys: keys.map((k) => ({ pubkey: k, signer: false, writable: true })), instructions: top } },
    meta: { err: o.err || null, preTokenBalances: pre, postTokenBalances: post, innerInstructions: inner } };
}
const ev = (tx, wallet = W) => SKR.evaluateSkrPayment(tx, { mint: SKR_MINT, receiver: RECEIVER, wallet });
{
  let r = ev(fixtureTx());
  ok("happy path: payer is the wallet, amount = what left AND arrived AND was transferred", r.ok && r.payer === W && r.amountRaw === "50000000" && r.kind === "skr", r);
  ok("a plain `transfer` instruction (no mint field) is witnessed through the balances", ev(fixtureTx({ ix: "plain" })).payer === W);
  ok("a transfer in an INNER instruction counts", ev(fixtureTx({ ix: "inner" })).payer === W);
  ok("a Token-2022 mint's transfer counts", ev(fixtureTx({ program: SKR.TOKEN_2022 })).payer === W);
  r = ev(fixtureTx({ mint: "So11111111111111111111111111111111111111112" }));
  ok("WRONG MINT: another token landing at the receiver is no payment", r.ok === false && r.code === "no_payment_to_receiver" && r.definitive === true, r);
  r = ev(fixtureTx({ dstOwner: pk() }));
  ok("WRONG DESTINATION: SKR to a different owner is no payment", r.ok === false && r.code === "no_payment_to_receiver", r);
  r = ev(fixtureTx({ err: { InstructionError: [0, "Custom"] } }));
  ok("a transaction that failed on chain moved nothing", r.ok === false && r.code === "tx_failed", r);
  r = ev(fixtureTx({ srcOwner: pk(), feePayer: W }), W);
  ok("FEE PAYER IS THE WALLET but another owner's SKR fell → not the payer (Codex r27 f2)", r.ok === true && r.payer === null, r);
  const Y = pk();
  r = ev(fixtureTx({ srcOwner: Y, feePayer: pk() }), Y);
  ok("…and the owner whose SKR fell IS the payer even when someone else paid the fee", r.ok && r.payer === Y, r);
  r = ev(fixtureTx({ ix: "none" }));
  ok("balances moved but no SPL transfer instruction names the wallet → refused (second witness)", r.ok === false && r.code === "no_transfer_instruction", r);
  // Netting: the receiver also sends 20 SKR back out inside the same transaction → true increase is 30.
  r = ev(fixtureTx({ amount: "50000000", dstAfter: 30_000_000 }));
  ok("SKR moved back OUT of the receiver nets to its true increase", r.ok && r.amountRaw === "30000000" && r.inRaw === "30000000", r);
  r = ev(fixtureTx({ dstExistsBefore: true, dstBefore: 7_000_000, dstAfter: 57_000_000 }));
  ok("a pre-existing receiver balance is subtracted (only the INCREASE counts)", r.ok && r.amountRaw === "50000000", r);
  const decoy = [{ accountIndex: 9, mint: SKR_MINT, owner: pk(), uiTokenAmount: { amount: "999999999", decimals: 6 } }];
  r = ev(fixtureTx({ extraPost: decoy }));
  ok("a same-mint balance owned by SOMEONE ELSE is ignored", r.ok && r.amountRaw === "50000000", r);
  const otherMintSameOwner = { accountIndex: 8, mint: "So11111111111111111111111111111111111111112", owner: RECEIVER, uiTokenAmount: { amount: "888888888", decimals: 9 } };
  r = ev(fixtureTx({ extraPost: [otherMintSameOwner] }));
  ok("a same-OWNER entry of another mint is ignored", r.ok && r.amountRaw === "50000000" && r.inRaw === "50000000", r);
  r = ev(fixtureTx(), RECEIVER);
  ok("the receiver cannot be its own payer", r.ok === false && r.code === "self_payment", r);
  r = ev({ blockTime: 1, transaction: { message: {} }, meta: null });
  ok("a transaction with no meta is unavailable, not a denial", r.ok === false && r.unavailable === true && r.retry === true && !r.definitive, r);
  // Review of #421, P3-5: absent token-balance arrays are an incomplete answer, not "no SKR moved".
  for (const drop of ["preTokenBalances", "postTokenBalances"]) {
    const t0 = fixtureTx(); delete t0.meta[drop];
    r = ev(t0);
    ok("absent " + drop + " → unavailable/retry (NOT a final no_payment_to_receiver)", r.ok === false && r.unavailable === true && r.retry === true && !r.definitive && r.code !== "no_payment_to_receiver", r);
  }
  // Review of #421, P1: more than one owner's SKR fell → refused for EVERYONE, definitively.
  {
    const W2 = pk(), tb = (i, owner, amt) => ({ accountIndex: i, mint: SKR_MINT, owner, uiTokenAmount: { amount: String(amt), decimals: 6 } });
    const poc = fixtureTx({ srcOwner: W, amount: "50000000" });
    poc.meta.preTokenBalances.push(tb(7, W2, 1)); poc.meta.postTokenBalances.push(tb(7, W2, 0));
    poc.meta.postTokenBalances.find((b) => b.owner === RECEIVER).uiTokenAmount.amount = "50000001";
    const keys = poc.transaction.message.accountKeys.map((k) => k.pubkey);
    keys[7] = "W2Account111111111111111111111111111111111111";
    poc.transaction.message.accountKeys = keys.map((k) => ({ pubkey: k }));
    const dstKey = keys[2];
    poc.transaction.message.instructions.push({ program: "spl-token", programId: SKR.TOKEN_CLASSIC, parsed: { type: "transfer", info: { source: keys[7], destination: dstKey, authority: W2, amount: "1" } } });
    const rW = ev(poc, W), rW2 = ev(poc, W2);
    ok("P1 PoC: a transaction where TWO owners' SKR fell is refused for the payer…", rW.ok === false && rW.code === "multiple_payers" && rW.definitive === true, rW);
    ok("…and for the 1-unit co-signer leg, who used to be named the payer and 'recover' the pass", rW2.ok === false && rW2.code === "multiple_payers", rW2);
    // The receiver's own outflow is not a second payer (the netting case stays valid).
    const net = fixtureTx({ amount: "50000000", dstAfter: 30_000_000 });
    ok("a receiver that also sends SKR out is not a second payer", ev(net).ok === true);
  }
}

console.log("\nA5. the quote's own price guard — history, median, 3× (review of #421, P2)\n");
{
  const now = 1_800_000_000_000, h = 3600e3;
  const hist = (...ps) => ps.map((p, i) => [p, now - (ps.length - i) * h]);
  ok("cold start (no history) → refuses to quote", SKR.quotePriceGate({ anchors: [], current: 0.05, now }).ok === false);
  ok("two ticks are not enough", SKR.quotePriceGate({ anchors: hist(0.05, 0.05), current: 0.05, now }).ok === false);
  ok("three agreeing ticks → quotes", SKR.quotePriceGate({ anchors: hist(0.05, 0.05, 0.05), current: 0.05, now }).ok === true);
  ok("a 10× spike against the median → refuses (the band that does not apply on a cold start)", SKR.quotePriceGate({ anchors: hist(0.05, 0.05, 0.05), current: 0.5, now }).ok === false);
  ok("a 10× collapse → refuses", SKR.quotePriceGate({ anchors: hist(0.05, 0.05, 0.05), current: 0.005, now }).ok === false);
  ok("2.9× is inside the band, 3.1× is outside", SKR.quotePriceGate({ anchors: hist(0.05, 0.05, 0.05), current: 0.145, now }).ok === true && SKR.quotePriceGate({ anchors: hist(0.05, 0.05, 0.05), current: 0.155, now }).ok === false);
  ok("ticks older than 24 h do not count", SKR.quotePriceGate({ anchors: [[0.05, now - 25 * h], [0.05, now - 26 * h], [0.05, now - 27 * h]], current: 0.05, now }).ok === false);
  // A ratchet: every minute the price steps ~2× up (each step passes a per-tick 10× band). The median
  // of the 24 h that came before does not follow it.
  let list = hist(0.05, 0.05, 0.05, 0.05, 0.05), price = 0.05, t = now;
  for (let i = 0; i < 4; i++) { price *= 2; t += 61e3; list = SKR.pushAnchor(list, price, t); }
  ok("a 2×-per-minute ratchet is refused by the time it has moved 3× from the median", SKR.quotePriceGate({ anchors: list, current: price, now: t }).ok === false, { price });
  ok("pushAnchor: drops ticks closer than a minute, ignores junk, prunes >24 h", SKR.pushAnchor([[0.05, now - 10e3]], 0.06, now).length === 1 && SKR.pushAnchor([], NaN, now).length === 0 && SKR.pushAnchor([[0.05, now - 25 * h]], 0.06, now).length === 1);
  ok("garbage anchors in storage are ignored, not thrown on", SKR.quotePriceGate({ anchors: [null, "x", [NaN, 1], [0.05, now - h], [0.05, now - 2 * h], [0.05, now - 3 * h]], current: 0.05, now }).ok === true);
}

console.log("\nA4. RPC trouble is `unavailable` — never a grant, never a denial\n");
(async () => {
  const mk = (rpcJson) => SKR.verifySkrPaymentTx({ rpcJson, sig: newSig(), wallet: W, mint: SKR_MINT, receiver: RECEIVER });
  let r = await mk(async () => { throw new Error("fetch failed"); });
  ok("transport failure → 503, retryable, not definitive", r.ok === false && r.status === 503 && r.retry === true && r.unavailable === true && !r.definitive, r);
  r = await mk(async () => ({ jsonrpc: "2.0", id: 1, error: { code: -32005, message: "Node is unhealthy" } }));
  ok("a JSON-RPC error body → unavailable", r.ok === false && r.status === 503 && r.unavailable === true, r);
  r = await mk(async () => ({ jsonrpc: "2.0", id: 1, result: null }));
  ok("result:null → 'not visible yet', retryable, not definitive", r.ok === false && r.retry === true && r.notFound === true && !r.definitive, r);
  r = await mk(async () => ({ result: fixtureTx() }));
  ok("a good response evaluates", r.ok && r.payer === W, r);
  r = await mk(async () => null);
  ok("an empty body is unavailable", r.ok === false && r.unavailable === true, r);

  // ───────────────────────────── B. redemption ─────────────────────────────
  console.log("\nB. redeemPaidPass — the SKR leg\n");
  const NOW = Date.UTC(2026, 9, 5, 12, 0, 0);
  const SIG = "7".repeat(88);
  const QUOTE = SKR.verifySkrQuote({ secret: KEY, token: SKR.issueSkrQuote({ secret: KEY, wallet: W, amountRaw: "50000000", now: NOW - 60e3 }).token, wallet: W });   // iat = NOW − 1 min
  const skrV = (over = {}) => ({ ok: true, kind: "skr", payer: W, amountRaw: "50000000", blockTimeMs: NOW - 30e3, ...over });
  const fakeSigStore = () => { const set = new Set(); let failing = false; return { add: (s) => { if (!s || set.has(s) || failing) return false; set.add(s); return true; }, has: (s) => set.has(s), size: () => set.size, fail: (v) => { failing = v; } }; };
  const fakeKv = () => { const m = new Map(); return { get: (k, d) => (m.has(k) ? m.get(k) : d), set: (k, v) => m.set(k, v), raw: m }; };
  const run = (a) => redeemPaidPass({ paySig: SIG, wallet: W, verified: skrV(), now: NOW, quote: QUOTE, ...a });
  {
    const s = fakeSigStore(), kv = fakeKv();
    const a = run({ sigStore: s, kv });
    ok("exact quoted amount is honoured; the term is the schedule's days from the BLOCK time", a.ok && a.recovered === false && a.kind === "skr" && a.termDays === 7 && a.expiresAt === NOW - 30e3 + 7 * DAY_MS, a);
    ok("consumed in the SAME namespace the SOL pass uses ('sol:' + sig)", s.has("sol:" + SIG) && s.has("skr:" + SIG) && s.has("skrpayer:" + SIG + ":" + W) && s.size() === 3);
    const audit = kv.raw.get("toolPassPaid:" + SIG);
    ok("audit line records kind, paid amount and the quote's amount", audit && audit.kind === "skr" && audit.amountRaw === "50000000" && audit.quoteAmountRaw === "50000000", audit);
    ok("an overpayment is honoured too", run({ sigStore: fakeSigStore(), verified: skrV({ amountRaw: "99999999" }) }).ok === true);
  }
  {
    const s = fakeSigStore();
    const r = run({ sigStore: s, verified: skrV({ amountRaw: "49999999" }) });
    ok("one base unit short → refused, definitive, NOTHING consumed", !r.ok && r.error === "amount too low" && r.definitive === true && r.needed === "50000000" && s.size() === 0, r);
  }
  {
    const s = fakeSigStore();
    let r = run({ sigStore: s, verified: skrV({ blockTimeMs: QUOTE.exp + 6 * 60e3 }) });
    ok("block time after exp + 5 min → refused (priced on a stale number), nothing consumed", !r.ok && r.code === "outside_window" && r.definitive === true && s.size() === 0, r);
    r = run({ sigStore: s, verified: skrV({ blockTimeMs: QUOTE.iat - 3 * 60e3 }) });
    ok("block time before iat − 2 min → refused (the short-payment-then-cheaper-quote replay, Codex r27 f3)", !r.ok && r.code === "outside_window" && s.size() === 0, r);
    r = run({ sigStore: s, verified: skrV({ blockTimeMs: QUOTE.exp + 4 * 60e3 }), now: QUOTE.exp + 4.5 * 60e3 });
    ok("landing inside the 5-minute grace after exp is honoured", r.ok === true, r);
  }
  {
    const s = fakeSigStore();
    const r = run({ sigStore: s, verified: skrV({ blockTimeMs: QUOTE.exp - 60e3 }), now: QUOTE.exp + 2 * 60e3 });
    ok("paid at minute nine, redeemed at minute eleven (clock PAST exp) → HONOURED (Codex r27 f4)", r.ok === true && r.recovered === false, r);
  }
  {
    const s = fakeSigStore();
    let r = run({ sigStore: s, verified: skrV({ payer: pk() }) });
    ok("a different payer → 403, nothing consumed", !r.ok && r.status === 403 && r.definitive === true && s.size() === 0, r);
    r = run({ sigStore: s, verified: skrV({ payer: null }) });
    ok("payer null (somebody else's SKR funded it) → 403, nothing consumed", !r.ok && r.status === 403 && s.size() === 0, r);
    r = run({ sigStore: s, verified: skrV({ blockTimeMs: 0 }) });
    ok("no block time → retryable, nothing consumed", !r.ok && r.retry === true && s.size() === 0, r);
    r = run({ sigStore: s, quote: null });
    ok("unconsumed + no quote → 400 'skr payment needs its quote', nothing consumed", !r.ok && r.status === 400 && r.error === "skr payment needs its quote" && s.size() === 0, r);
    r = run({ sigStore: s, quote: null, quoteInvalid: true });
    ok("unconsumed + a quote that did not verify → 401, DEFINITIVE (a rotated key must not loop forever), nothing consumed", !r.ok && r.status === 401 && r.code === "skr_quote_invalid" && r.definitive === true && s.size() === 0, r);
    r = run({ sigStore: s, termsAt: () => ({ from: 0, days: 7, lamports: 50_000_000 }) });
    ok("a payment landing when the schedule had no `skr` term is refused", !r.ok && r.code === "no_skr_terms" && s.size() === 0, r);
    r = run({ sigStore: s, verified: { ok: false, status: 503, retry: true, unavailable: true, code: "skr_unavailable", error: "down" } });
    ok("an unavailable verification passes through as a retryable 503", !r.ok && r.status === 503 && r.retry === true && s.size() === 0, r);
  }
  {
    const s = fakeSigStore();
    const a = run({ sigStore: s });
    const later = run({ sigStore: s, quote: null, now: NOW + 3600e3 });
    ok("RECOVERY with no quote after consumption: same payer, same expiry, recovered:true", later.ok && later.recovered === true && later.expiresAt === a.expiresAt, later);
    ok("…and a different wallet is still refused", !run({ sigStore: s, quote: null, wallet: pk() }).ok);
    const again = run({ sigStore: s, quote: null, verified: skrV({ amountRaw: "1" }), now: NOW + 7200e3 });
    ok("recovery never re-extends: still the one pass (one shared key, one leg marker, one payer record)", again.ok && again.expiresAt === a.expiresAt && s.size() === 3, again);
  }
  {
    const s = fakeSigStore(); s.add("hub-access:" + SIG);
    const r = run({ sigStore: s });
    ok("a platform-access month's signature cannot also buy a pass → 409", !r.ok && r.status === 409, r);
    const r2 = run({ sigStore: fakeSigStore(), usedElsewhere: (x) => x === SIG });
    ok("…nor one the hub REGISTRY holds → 409", !r2.ok && r2.status === 409, r2);
  }
  console.log("\nB2. one payment, one pass, one payer (review of #421, P1)\n");
  {
    // The PoC from the review, verbatim in spirit: W1 pays 1 SKR, W2 has a 1-unit leg in the SAME tx.
    const W1 = pk(), W2 = pk();
    const tb = (i, owner, amt) => ({ accountIndex: i, mint: SKR_MINT, owner, uiTokenAmount: { amount: String(amt) } });
    const bt = Math.floor(NOW / 1000) - 30;
    const poc = { blockTime: bt, meta: { err: null, preTokenBalances: [tb(1, W1, 2000000), tb(2, W2, 1), tb(3, RECEIVER, 0)], postTokenBalances: [tb(1, W1, 1000000), tb(2, W2, 0), tb(3, RECEIVER, 1000001)], innerInstructions: [] },
      transaction: { message: { accountKeys: [W1, "A1", "A2", "RA"].map((p) => ({ pubkey: p })), instructions: [
        { programId: SKR.TOKEN_CLASSIC, program: "spl-token", parsed: { type: "transfer", info: { source: "A1", destination: "RA", amount: "1000000" } } },
        { programId: SKR.TOKEN_CLASSIC, program: "spl-token", parsed: { type: "transfer", info: { source: "A2", destination: "RA", amount: "1" } } } ] } } };
    const s = fakeSigStore();
    const mk = (w) => SKR.evaluateSkrPayment(poc, { mint: SKR_MINT, receiver: RECEIVER, wallet: w });
    const q1 = SKR.verifySkrQuote({ secret: KEY, token: SKR.issueSkrQuote({ secret: KEY, wallet: W1, amountRaw: "1000000", now: NOW - 60e3 }).token, wallet: W1 });
    const first = redeemPaidPass({ paySig: SIG, wallet: W1, verified: mk(W1), sigStore: s, quote: q1, now: NOW });
    const second = redeemPaidPass({ paySig: SIG, wallet: W2, verified: mk(W2), sigStore: s, quote: null, now: NOW });
    ok("PoC end to end: neither wallet gets a pass off a two-payer transaction", !first.ok && !second.ok && s.size() === 0, { first, second });
  }
  {
    // Independent of the evaluator: even if a verifier named another wallet as payer for a signature
    // that is already consumed, only the RECORDED payer recovers it.
    const W1 = pk(), W2 = pk(), s = fakeSigStore();
    const a = run({ sigStore: s, wallet: W1, verified: skrV({ payer: W1 }), quote: QUOTE });
    ok("setup: the real payer redeems", a.ok && a.recovered === false && s.has("skrpayer:" + SIG + ":" + W1) && s.has("skr:" + SIG) && s.has("sol:" + SIG), a);
    const b = run({ sigStore: s, wallet: W2, verified: skrV({ payer: W2, amountRaw: "1" }), quote: null });
    ok("another wallet (verified as 'payer' with a 1-unit leg) 'recovering' the consumed signature → refused, not recovered", !b.ok && b.code === "already_redeemed" && b.status === 409 && b.definitive === true, b);
    const b2 = run({ sigStore: s, wallet: W2, verified: skrV({ payer: W2 }), quote: QUOTE });
    ok("…even holding a quote of its own for that amount", !b2.ok && b2.code === "already_redeemed", b2);
    ok("the recorded payer still recovers (same expiry)", run({ sigStore: s, wallet: W1, verified: skrV({ payer: W1 }), quote: null }).recovered === true);
    ok("exactly one signature consumed, one payer record", s.size() === 3);
  }
  {
    // Cross-kind. A SOL-consumed signature never recovers on the SKR leg; an SKR-consumed one never on the SOL leg.
    const s = fakeSigStore(), cur = TERMS.current(NOW);
    const sol = redeemPaidPass({ paySig: SIG, wallet: W, verified: { ok: true, lamports: cur.lamports, payer: W, blockTimeMs: NOW - 30e3 }, sigStore: s, now: NOW });
    ok("setup: a SOL-pass redemption consumes the signature", sol.ok && s.has("sol:" + SIG) && !s.has("skr:" + SIG), sol);
    const co = pk();
    const viaSkr = run({ sigStore: s, wallet: co, verified: skrV({ payer: co, amountRaw: "1" }), quote: null });
    ok("a co-signer's 1-unit SKR leg cannot recover a SOL-consumed signature (no SKR checks were ever run on it)", !viaSkr.ok && viaSkr.code === "already_redeemed", viaSkr);
    const viaSkrSamePayer = run({ sigStore: s, wallet: W, verified: skrV({ payer: W }), quote: null });
    ok("…nor can the SOL payer themselves, on the SKR leg", !viaSkrSamePayer.ok && viaSkrSamePayer.code === "already_redeemed", viaSkrSamePayer);
    const s2 = fakeSigStore();
    ok("setup: an SKR redemption consumes the signature", run({ sigStore: s2, verified: skrV(), quote: QUOTE }).ok === true);
    const solAfter = redeemPaidPass({ paySig: SIG, wallet: W, verified: { ok: true, lamports: cur.lamports, payer: W, blockTimeMs: NOW - 30e3 }, sigStore: s2, now: NOW });
    ok("an SKR-consumed signature is refused on the SOL leg", !solAfter.ok && solAfter.code === "already_redeemed", solAfter);
    ok("the SOL leg still recovers its own signature (unchanged)", redeemPaidPass({ paySig: SIG, wallet: W, verified: { ok: true, lamports: cur.lamports, payer: W, blockTimeMs: NOW - 30e3 }, sigStore: s, now: NOW + 1000 }).recovered === true);
  }
  {
    // The payer record and leg marker are written BEFORE the shared key (the commit point): a store
    // that dies after them leaves the signature unconsumed, and the same payer simply redeems again.
    const writes = [], set = new Set();
    const s = { add: (k) => { if (set.has(k)) return false; if (k.startsWith("sol:")) return false; set.add(k); writes.push(k); return true; }, has: (k) => set.has(k) };
    const r = run({ sigStore: s });
    ok("a store that cannot write the shared key → 503, signature NOT consumed", !r.ok && r.status === 503 && !set.has("sol:" + SIG), r);
    ok("the payer record and leg marker were written first, shared key last (it is the commit point)", writes.length === 2 && writes[0].startsWith("skrpayer:") && writes[1].startsWith("skr:"), writes);
    s.add = (k) => { if (set.has(k)) return false; set.add(k); return true; };
    const r2 = run({ sigStore: s });
    ok("…and the same payer redeems on retry", r2.ok && r2.recovered === false, r2);
    let dead = true; const s3 = { add: (k) => (dead ? false : true), has: () => false };
    ok("a store that cannot record the payer record → 503, nothing consumed", run({ sigStore: s3 }).status === 503);
  }
  {
    const s = fakeSigStore(); s.fail(true);
    const r = run({ sigStore: s });
    ok("a sig store that cannot record durably → 503, nothing consumed", !r.ok && r.status === 503 && r.retry === true && s.size() === 0, r);
    s.fail(false);
    ok("…and the same payment redeems once the store is back", run({ sigStore: s }).ok === true);
  }
  {
    const s = fakeSigStore();
    const r = run({ sigStore: s, now: NOW + 8 * DAY_MS });
    ok("a payment older than the pass it bought is refused", !r.ok && r.code === "pass_expired", r);
  }
  {
    // The SOL leg is byte-for-byte what it was: no quote involved, lamports against the schedule.
    const s = fakeSigStore();
    const cur = TERMS.current(NOW);
    const r = redeemPaidPass({ paySig: SIG, wallet: W, verified: { ok: true, lamports: cur.lamports, payer: W, blockTimeMs: NOW - 30e3 }, sigStore: s, now: NOW });
    ok("the SOL leg is unchanged (0.05 SOL → 7 days) and needs no quote", r.ok && r.lamports === cur.lamports && r.termDays === 7 && !r.kind, r);
    const low = redeemPaidPass({ paySig: SIG, wallet: W, verified: { ok: true, lamports: cur.lamports - 1, payer: W, blockTimeMs: NOW - 30e3 }, sigStore: fakeSigStore(), now: NOW });
    ok("…and SOL 'amount too low' still reads as before", !low.ok && low.error === "amount too low" && low.needed === cur.lamports, low);
  }

  // ───────────────────────────── C. the real server ─────────────────────────────
  console.log("\nC. the real server — stub RPC, real ed25519 wallet\n");
  const wallet = (() => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
    const raw = Buffer.from(publicKey.export({ format: "jwk" }).x, "base64url");
    return { pub: new PublicKey(raw).toBase58(), sign: (msg) => crypto.sign(null, Buffer.from(msg, "utf8"), privateKey).toString("base64") };
  })();
  const MINT_PROGRAM = SKR.TOKEN_CLASSIC;   // what the chain says today (verified live 2026-10-03: owner Tokenkeg…, 6 decimals)
  const RECEIVER_ATA = splToken.getAssociatedTokenAddressSync(new PublicKey(SKR_MINT), new PublicKey(RECEIVER), true, splToken.TOKEN_PROGRAM_ID).toBase58();
  const fixtures = new Map(); let rpcMode = "ok", ataExists = false; const rpcLog = [];
  const stub = http.createServer((req, res) => {
    let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
      let j; try { j = JSON.parse(b); } catch (_) { j = {}; }
      rpcLog.push(j.method);
      const reply = (o) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ jsonrpc: "2.0", id: j.id, ...o })); };
      if (rpcMode === "outage") return reply({ error: { code: -32005, message: "Node is unhealthy" } });
      if (j.method === "getAccountInfo") {
        const a = j.params[0];
        if (a === SKR_MINT) return reply({ result: { value: { owner: MINT_PROGRAM, data: { program: "spl-token", parsed: { type: "mint", info: { decimals: 6, isInitialized: true } } } } } });
        if (a === RECEIVER_ATA) return reply({ result: { value: ataExists ? { lamports: 2039280, owner: MINT_PROGRAM, data: ["", "base64"] } : null } });
        return reply({ result: { value: null } });
      }
      if (j.method === "getTransaction") { const t = fixtures.get(j.params[0]); return reply({ result: t || null }); }
      return reply({ result: null });
    });
  });
  await new Promise((r) => stub.listen(0, "127.0.0.1", r));
  const stubUrl = "http://127.0.0.1:" + stub.address().port;

  let ipn = 1;
  async function call(base, method, p, body, headers) {
    const r = await fetch(base + p, { method, headers: { "content-type": "application/json", "x-forwarded-for": "10.9." + (Math.floor(ipn / 250) % 250) + "." + (ipn++ % 250), ...(headers || {}) }, body: body ? JSON.stringify(body) : undefined });
    let j = null; try { j = await r.json(); } catch (_) {}
    return { status: r.status, body: j };
  }
  async function boot(port, seed) {
    const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "skr-pass-test-"));
    if (seed) fs.writeFileSync(path.join(DIR, "app-state.json"), JSON.stringify(seed));
    const env = { ...process.env, PORT: String(port), DATA_DIR: DIR, PREMIUM_ACCESS_KEY: KEY, TOOLGATE_OFF: "", TOOLGATE_SKR_PASS_USD: "", TOOLGATE_SKR_WARMUP_OFF: "1",
      TELEGRAM_BOT_TOKEN: "", TELEGRAM_CHAT_ID: "", HELIUS_API_KEY: "", HELIUS_API_KEY_2: "", MM_OPERATOR_SECRET: "", MM_OPERATOR_SECRET_TREASURY: "", FALLBACK_RPC_URL: stubUrl };
    const srv = spawn(process.execPath, ["server.js"], { cwd: path.join(__dirname, ".."), env, stdio: "ignore" });
    const base = `http://127.0.0.1:${port}`;
    let up = false;
    for (let i = 0; i < 90; i++) { try { const r = await fetch(`${base}/healthz`); if (r.ok) { up = true; break; } } catch (_) {} await sleep(500); }
    const stop = () => { try { srv.kill("SIGKILL"); } catch (_) {} try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (_) {} };
    if (!up) { stop(); throw new Error("server did not come up on " + port); }
    return { base, stop };
  }

  const P1 = Number(process.env.SKR_PASS_TEST_PORT || 3157);
  // Seeds: the price the server boots with, and (review of #421, P2) the 24 h history of accepted
  // ticks the QUOTE path requires — three agreeing ticks, as a server that has been up a while has.
  const hrs = (n) => Date.now() - n * 3600e3;
  const goodHistory = [[0.05, hrs(3)], [0.05, hrs(2)], [0.05, hrs(1)]];
  const A = await boot(P1, { toolGateSkrUsd: 0.05, toolGateSkrUsdAt: Date.now(), toolGateSkrAnchors: goodHistory });
  let B = null, C = null, D = null;
  try {

    // ── quote ──
    let q = await call(A.base, "GET", "/api/tool-gate/skr-quote");
    ok("quote: no wallet → 400", q.status === 400, q);
    q = await call(A.base, "GET", "/api/tool-gate/skr-quote?wallet=" + RECEIVER);
    ok("quote: the receiver itself is refused", q.status === 400, q);
    q = await call(A.base, "GET", "/api/tool-gate/skr-quote?wallet=" + wallet.pub);
    const Q = q.body || {};
    ok("quote: 200 with the verified mint, decimals read from the chain, and the legacy token program", q.status === 200 && Q.success && Q.mint === SKR_MINT && Q.decimals === 6 && Q.program === MINT_PROGRAM, q);
    ok("quote: amountRaw = ceil($usd / price) in BigInt on the server's own price (no client number)", Q.amountRaw === SKR.skrAmountRaw(Q.usd, Q.priceUsd, Q.decimals) && Q.usd === 1 && Q.days === 7, Q);
    ok("quote: receiver is the SOL pass's unlock wallet; its SKR account matches @solana/spl-token's derivation", Q.receiver === RECEIVER && Q.receiverAta === RECEIVER_ATA, Q);
    ok("quote: says the receiving account does not exist yet (the payer opens it)", Q.receiverAtaExists === false, Q.receiverAtaExists);
    const qv = SKR.verifySkrQuote({ secret: KEY, token: Q.quote, wallet: wallet.pub });
    ok("quote: the token verifies for this wallet only and pins {amountRaw, iat, exp ≈ iat + 10 min}", qv && qv.amountRaw === Q.amountRaw && qv.exp - qv.iat === 600000 && SKR.verifySkrQuote({ secret: KEY, token: Q.quote, wallet: pk() }) === null, qv);
    const nowS = () => Math.floor(Date.now() / 1000);
    const pay = (o) => { const sig = newSig(); fixtures.set(sig, fixtureTx({ srcOwner: wallet.pub, blockTime: nowS(), amount: Q.amountRaw, ...o })); return sig; };
    // forged pay intent: the documented format (tools-pay) — the same trick tool-pass-gate-test uses
    const intent = (w, ttl = 900e3) => { const body = Buffer.from(JSON.stringify({ t: "tools-pay", w, exp: Date.now() + ttl })).toString("base64url"); return body + "." + crypto.createHmac("sha256", KEY).update("tools-pay." + body).digest("base64url"); };
    const redeem = (w, sig, extra) => call(A.base, "POST", "/api/tool-gate/session", { wallet: w, payIntent: intent(w), paySig: sig, payKind: "skr", ...extra });

    // ── refusals first, each on a fresh signature; none may consume it ──
    let s = await redeem(wallet.pub, pay({}), { skrQuote: "not.a.token" });
    ok("TAMPERED quote (garbage) → 401, nothing granted", s.status === 401 && !s.body.success && s.body.code === "skr_quote_invalid", s);
    const [qb, qs] = Q.quote.split(".");
    const forgedBody = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(qb, "base64url")), a: "1" })).toString("base64url");
    s = await redeem(wallet.pub, pay({}), { skrQuote: forgedBody + "." + qs });
    ok("FORGED quote (amount rewritten to 1 unit, original MAC) → 401", s.status === 401 && s.body.code === "skr_quote_invalid", s);
    const otherQ = await call(A.base, "GET", "/api/tool-gate/skr-quote?wallet=" + pk());
    s = await redeem(wallet.pub, pay({}), { skrQuote: otherQ.body.quote });
    ok("a quote issued to ANOTHER wallet cannot be presented → 401", s.status === 401, s);
    s = await redeem(wallet.pub, pay({}), {});
    ok("no quote on an unconsumed payment → 400 'needs its quote' (payKind skr)", s.status === 400 && s.body.code === "skr_needs_quote", s);
    s = await redeem(wallet.pub, pay({ mint: "So11111111111111111111111111111111111111112" }), { skrQuote: Q.quote });
    ok("WRONG MINT → refused, definitive", s.status === 200 && !s.body.success && s.body.code === "no_payment_to_receiver" && s.body.definitive === true, s);
    s = await redeem(wallet.pub, pay({ dstOwner: pk() }), { skrQuote: Q.quote });
    ok("WRONG DESTINATION → refused, definitive", !s.body.success && s.body.code === "no_payment_to_receiver" && s.body.definitive === true, s);
    s = await redeem(wallet.pub, pay({ amount: String(BigInt(Q.amountRaw) - 1n) }), { skrQuote: Q.quote });
    ok("SHORT AMOUNT (one unit under the quote) → 'amount too low', definitive", !s.body.success && s.body.error === "amount too low" && s.body.definitive === true && s.body.needed === Q.amountRaw, s);
    s = await redeem(wallet.pub, pay({ srcOwner: pk() }), { skrQuote: Q.quote });
    ok("PAID BY A DIFFERENT WALLET → 403", s.status === 403 && !s.body.success && s.body.code === "different_wallet", s);
    s = await redeem(wallet.pub, pay({ srcOwner: pk(), feePayer: wallet.pub }), { skrQuote: Q.quote });
    ok("proven wallet only paid the FEE (another owner's SKR moved) → 403", s.status === 403 && s.body.code === "different_wallet", s);
    s = await redeem(wallet.pub, pay({ blockTime: Math.floor((qv.exp + 6 * 60e3) / 1000) }), { skrQuote: Q.quote });
    ok("EXPIRED QUOTE (payment landed > 5 min after exp) → refused, definitive", !s.body.success && s.body.code === "outside_window" && s.body.definitive === true, s);
    s = await redeem(wallet.pub, pay({ blockTime: Math.floor((qv.iat - 3 * 60e3) / 1000) }), { skrQuote: Q.quote });
    ok("payment that predates the quote → refused", !s.body.success && s.body.code === "outside_window", s);
    s = await redeem(wallet.pub, pay({ err: { InstructionError: [1, "Custom"] } }), { skrQuote: Q.quote });
    ok("a payment that failed on chain → refused, definitive", !s.body.success && s.body.code === "tx_failed" && s.body.definitive === true, s);
    const missing = newSig();
    s = await redeem(wallet.pub, missing, { skrQuote: Q.quote });
    ok("a signature the chain does not show yet → retryable (kept, not a denial)", !s.body.success && s.body.retry === true && s.body.code === "skr_not_found_yet" && !s.body.definitive, s);

    // ── RPC outage: unavailable, not a denial, not a grant, and the payment still redeems after ──
    const outSig = pay({});
    rpcMode = "outage";
    s = await redeem(wallet.pub, outSig, { skrQuote: Q.quote });
    ok("RPC OUTAGE → 503 'unavailable', retryable, no pass, not definitive", s.status === 503 && !s.body.success && s.body.retry === true && s.body.code === "skr_unavailable" && !s.body.definitive && !s.body.pass, s);
    rpcMode = "ok";
    s = await redeem(wallet.pub, outSig, { skrQuote: Q.quote });
    ok("…the outage cached nothing: the SAME payment redeems once the node is back", s.status === 200 && s.body.success && s.body.via === "paid-skr" && s.body.recovered === false, s);

    // ── the happy path through the REAL signed-session route (ed25519) ──
    const hSig = pay({});
    const chR = await call(A.base, "GET", "/api/tool-gate/challenge?wallet=" + wallet.pub);
    const msg = chR.body.message;
    s = await call(A.base, "POST", "/api/tool-gate/session", { wallet: wallet.pub, message: msg, signature: wallet.sign(msg), paySig: hSig, skrQuote: Q.quote });
    const tok = s.body && s.body.pass;
    ok("HAPPY PATH (signed challenge + SKR payment + quote) → pass, via paid-skr, a 7-day term", s.status === 200 && s.body.success && s.body.via === "paid-skr" && s.body.recovered === false && s.body.termDays === 7 && s.body.amountRaw === Q.amountRaw && /^t:/.test(tok), s);
    const g = await call(A.base, "GET", "/api/wallet-xray?wallet=" + pk(), null, { "x-clkn-pass": tok });
    ok("that pass opens the gate (reaches the tool; 402/403 would mean it was not accepted as a paid pass)", g.status !== 402 && g.status !== 403, "status " + g.status);

    // ── replay: a payment signature is evidence, bound to its payer, consumed once ──
    const other = pk();
    const oq = await call(A.base, "GET", "/api/tool-gate/skr-quote?wallet=" + other);
    s = await redeem(other, hSig, { skrQuote: oq.body.quote });
    ok("REPLAY by another wallet (even with its own valid quote) → refused", s.status === 403 && !s.body.success && s.body.code === "different_wallet", s);
    const first = await redeem(wallet.pub, hSig, { skrQuote: Q.quote });
    ok("the payer presenting it again is a RECOVERY of the same pass, not a second one", first.body.success && first.body.recovered === true && first.body.termDays === 7, first);
    const noQ = await redeem(wallet.pub, hSig, {});
    ok("recovery works with no quote at all (lost response / other device)", noQ.body.success && noQ.body.recovered === true, noQ);
    const nq2 = await call(A.base, "GET", "/api/tool-gate/skr-quote?wallet=" + wallet.pub);
    const fresh = await redeem(wallet.pub, hSig, { skrQuote: nq2.body.quote });
    ok("a NEWER quote does not buy a second term for the same signature", fresh.body.success && fresh.body.recovered === true, fresh);

    // config LAST: its first read starts a live price refresh, which must not run under the cases above.
    const cfg = await call(A.base, "GET", "/api/tool-gate/config");
    const pass = cfg.body && cfg.body.skr && cfg.body.skr.pass;
    ok("config publishes the SKR pass terms from the schedule (usd 1, days 7) — the app renders them, never hardcodes", pass && pass.usd === 1 && pass.days === 7, cfg.body && cfg.body.skr);
    ok("config's skrNeeded is derived from a finite positive live price, or null", pass && (pass.skrNeeded === null || (Number.isFinite(cfg.body.skr.priceUsd) && pass.skrNeeded === Math.ceil(1 / cfg.body.skr.priceUsd))), pass);

    // ── P1 end to end: a two-payer transaction pays for no one ──
    {
      const W2 = pk(), tb = (i, owner, amt) => ({ accountIndex: i, mint: SKR_MINT, owner, uiTokenAmount: { amount: String(amt), decimals: 6 } });
      const sig = newSig();
      const t0 = fixtureTx({ srcOwner: wallet.pub, blockTime: Math.floor(Date.now() / 1000), amount: Q.amountRaw });
      t0.meta.preTokenBalances.push(tb(7, W2, 1)); t0.meta.postTokenBalances.push(tb(7, W2, 0));
      t0.meta.postTokenBalances.find((b) => b.owner === RECEIVER).uiTokenAmount.amount = String(BigInt(Q.amountRaw) + 1n);
      fixtures.set(sig, t0);
      const w2q = await call(A.base, "GET", "/api/tool-gate/skr-quote?wallet=" + W2);
      const r1 = await redeem(wallet.pub, sig, { skrQuote: Q.quote });
      const r2 = await redeem(W2, sig, { skrQuote: w2q.body.quote });
      ok("two owners' SKR fell in one transaction → neither wallet gets a pass", !r1.body.success && !r2.body.success && r1.body.code === "multiple_payers" && r2.body.code === "multiple_payers", { r1: r1.body, r2: r2.body });
    }

    // ── stale price → no quote (separate server: last accepted tick 2 h old, far outside any live band) ──
    B = await boot(P1 + 1, { toolGateSkrUsd: 1e6, toolGateSkrUsdAt: Date.now() - 2 * 3600e3, toolGateSkrAnchors: goodHistory });
    const sq = await call(B.base, "GET", "/api/tool-gate/skr-quote?wallet=" + wallet.pub);
    ok("STALE SKR PRICE → 503 skr_price_unavailable, NO quote, NO amount (SKR never graces)", sq.status === 503 && sq.body.error === "skr_price_unavailable" && !sq.body.quote && !sq.body.amountRaw, sq);

    // ── P2: the quote's own guard (a fresh, in-band-looking price that is NOT backed by history) ──
    C = await boot(P1 + 2, { toolGateSkrUsd: 0.05, toolGateSkrUsdAt: Date.now() });   // cold start: no history at all
    const cq = await call(C.base, "GET", "/api/tool-gate/skr-quote?wallet=" + wallet.pub);
    ok("COLD START (fresh price, no accepted-tick history) → 503, NO amount", cq.status === 503 && cq.body.error === "skr_price_unavailable" && !cq.body.quote && !cq.body.amountRaw, cq);
    D = await boot(P1 + 3, { toolGateSkrUsd: 0.5, toolGateSkrUsdAt: Date.now(), toolGateSkrAnchors: goodHistory });   // 10× the median
    const dq = await call(D.base, "GET", "/api/tool-gate/skr-quote?wallet=" + wallet.pub);
    ok("PRICE 10× THE 24 h MEDIAN (a spike / ratchet that the 6 h single-anchor band let through) → 503, NO amount (quote would have been ~0.1 SKR of value)", dq.status === 503 && !dq.body.quote && !dq.body.amountRaw, dq);
  } finally {
    A.stop(); if (B) B.stop(); if (C) C.stop(); if (D) D.stop(); stub.close();
  }
  console.log(failures ? `\n${failures} FAILED` : "\nall passed");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
