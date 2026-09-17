"use strict";
// Platform access tiers (owner, 2026-09-16): standard 0.5 SOL/month, small 0.25 SOL/month,
// comped free. Tier is the owner's at approval; price is an append-only schedule resolved at the
// payment instant; the CLKN alternative is priced at that instant too. Zero-dependency.
const assert = require("assert");
const A = require("../lib/hub/access");
const proj = require("../lib/hub/project");
const P = require("../lib/hub/access-pay");

let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log("  ✓ " + n); } catch (e) { fail++; console.log("  ✗ " + n + "\n    " + (e && e.message)); } };
const LAUNCH = Date.UTC(2026, 8, 16);
const NOW = 1_800_000_000;
const TOK = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const MINT = "4yro2xbCxMFVvygCsj5FZMgZnVCb8EqcbPGTbSGCgDBc", FUND = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const mk = (over = {}) => proj.validateProject({ id: "tt", label: "TT", symbol: "TT", mint: MINT, fundingWallet: FUND, ...over }, { decimals: 9, tokenProgram: TOK, extensions: [] });

console.log("1. the schedule");
t("launch prices: standard 0.5 SOL, small 0.25 SOL, comped 0", () => {
  assert.strictEqual(A.priceLamports("standard", LAUNCH), 500_000_000);
  assert.strictEqual(A.priceLamports("small", LAUNCH), 250_000_000);
  assert.strictEqual(A.priceLamports("comped", LAUNCH), 0);
});
t("a payment before the first entry resolves to the first entry (never undefined)", () => { assert.strictEqual(A.priceLamports("standard", LAUNCH - 1e9), 500_000_000); });
t("an appended price change applies only from its instant", () => {
  const sched = [...A.SCHEDULE, { from: LAUNCH + 30 * A.DAY_MS, lamports: { standard: 1_000_000_000, small: 250_000_000, comped: 0 } }];
  assert.strictEqual(A.priceLamports("standard", LAUNCH + 29 * A.DAY_MS, sched), 500_000_000);
  assert.strictEqual(A.priceLamports("standard", LAUNCH + 30 * A.DAY_MS, sched), 1_000_000_000);
});
t("unknown tier refused; tier defaults to standard", () => {
  assert.throws(() => A.assertTier("vip"), /accessTier must be one of/);
  assert.strictEqual(A.assertTier(undefined), "standard");
  assert.strictEqual(A.assertTier("Small"), "small");
});

console.log("2. the CLKN alternative, priced at the payment instant");
t("0.5 SOL at 0.0001 SOL/CLKN = 5,000 CLKN (raw, 6 decimals)", () => { assert.strictEqual(A.clknRawFor(500_000_000, 0.0001, 6), 5_000_000_000n); });
t("price doubles → half the CLKN (early buyers pay less)", () => { assert.strictEqual(A.clknRawFor(500_000_000, 0.0002, 6), 2_500_000_000n); });
t("rounds UP so a payment never falls short by dust", () => { assert.strictEqual(A.clknRawFor(500_000_000, 0.0003, 0), 1667n); });
t("refuses a zero / missing price and bad decimals", () => {
  assert.throws(() => A.clknRawFor(500_000_000, 0, 6), /positive/);
  assert.throws(() => A.clknRawFor(500_000_000, NaN, 6), /positive/);
  assert.throws(() => A.clknRawFor(500_000_000, 0.1, 19), /decimals/);
});

console.log("3. does a payment cover a month?");
t("SOL: exact covers, 2% short covers (slack), 3% short does not", () => {
  assert.strictEqual(A.paymentCovers({ tier: "standard", atMs: LAUNCH, paid: { lamports: 500_000_000 } }).ok, true);
  assert.strictEqual(A.paymentCovers({ tier: "standard", atMs: LAUNCH, paid: { lamports: 490_000_000 } }).ok, true);
  const r = A.paymentCovers({ tier: "standard", atMs: LAUNCH, paid: { lamports: 485_000_000 } });
  assert.strictEqual(r.ok, false); assert.strictEqual(r.reason, "short"); assert.strictEqual(r.owedLamports, 500_000_000);
});
t("small tier: 0.25 SOL covers; 0.25 does NOT cover standard", () => {
  assert.strictEqual(A.paymentCovers({ tier: "small", atMs: LAUNCH, paid: { lamports: 250_000_000 } }).ok, true);
  assert.strictEqual(A.paymentCovers({ tier: "standard", atMs: LAUNCH, paid: { lamports: 250_000_000 } }).ok, false);
});
t("CLKN: covered at the block price, short when the price moved up after the quote", () => {
  const ok = A.paymentCovers({ tier: "standard", atMs: LAUNCH, paid: { clknRaw: "5000000000", solPerClkn: 0.0001, decimals: 6 } });
  assert.strictEqual(ok.ok, true); assert.strictEqual(ok.kind, "clkn"); assert.strictEqual(ok.owedClknRaw, "5000000000");
  const short = A.paymentCovers({ tier: "standard", atMs: LAUNCH, paid: { clknRaw: "5000000000", solPerClkn: 0.00005, decimals: 6 } });
  assert.strictEqual(short.ok, false); assert.strictEqual(short.owedClknRaw, "10000000000");
});
t("comped never pays; no payment is no cover", () => {
  assert.strictEqual(A.paymentCovers({ tier: "comped", atMs: LAUNCH, paid: { lamports: 1 } }).reason, "comped_never_pays");
  assert.strictEqual(A.paymentCovers({ tier: "small", atMs: LAUNCH, paid: null }).reason, "no_payment");
});

console.log("4. the access block on the project record");
t("default tier is standard, unpaid, may not operate", () => {
  const p = mk();
  assert.strictEqual(p.access.tier, "standard");
  assert.deepStrictEqual(A.accessStatus(p.access, NOW), { tier: "standard", state: "unpaid", paidThroughUnix: null, daysLeft: 0 });
  assert.strictEqual(A.mayOperate(p.access, NOW), false);
});
t("comped needs a note saying why; then it may operate forever", () => {
  assert.throws(() => mk({ accessTier: "comped" }), /accessNote/);
  const p = mk({ accessTier: "comped", accessNote: "promo partner" });
  assert.strictEqual(A.accessStatus(p.access, NOW).state, "comped");
  assert.strictEqual(A.mayOperate(p.access, NOW + 10 * 365 * 86400), true);
});
t("a payment buys 30 days; a second stacks on the end, not on today; same sig refused", () => {
  let a = mk({ accessTier: "small" }).access;
  a = A.applyPayment(a, { sig: "s1", atUnix: NOW, kind: "sol", lamports: 250_000_000 });
  assert.strictEqual(a.paidThroughUnix, NOW + 30 * 86400);
  assert.strictEqual(A.accessStatus(a, NOW + 86400).state, "active");
  assert.strictEqual(A.accessStatus(a, NOW + 86400).daysLeft, 29);
  a = A.applyPayment(a, { sig: "s2", atUnix: NOW + 5 * 86400, kind: "clkn", clknRaw: "123" });
  assert.strictEqual(a.paidThroughUnix, NOW + 60 * 86400);
  assert.throws(() => A.applyPayment(a, { sig: "s2", atUnix: NOW, kind: "sol", lamports: 1 }), /already recorded/);
  assert.strictEqual(A.accessStatus(a, NOW + 61 * 86400).state, "expired");
  assert.strictEqual(A.mayOperate(a, NOW + 61 * 86400), false);
});
t("a lapsed project that pays again starts from today, not from the old end", () => {
  let a = A.applyPayment(mk().access, { sig: "s1", atUnix: NOW, kind: "sol", lamports: 500_000_000 });
  a = A.applyPayment(a, { sig: "s2", atUnix: NOW + 100 * 86400, kind: "sol", lamports: 500_000_000 });
  assert.strictEqual(a.paidThroughUnix, NOW + 130 * 86400);
});
t("re-approving keeps the months already paid but re-decides the tier", () => {
  const p1 = mk({ accessTier: "small" });
  let reg = proj.approveProject({}, p1, { nowUnix: NOW });
  reg = { ...reg, tt: { ...reg.tt, access: A.applyPayment(reg.tt.access, { sig: "s1", atUnix: NOW, kind: "sol", lamports: 250_000_000 }) } };
  const p2 = mk({ accessTier: "comped", accessNote: "now a partner" });
  const reg2 = proj.approveProject(reg, p2, { nowUnix: NOW + 10 });
  assert.strictEqual(reg2.tt.access.tier, "comped");
  assert.strictEqual(reg2.tt.access.payments.length, 1);
});

console.log("5. the payment leg — quote, parse, verify (pure)");
const SOL_TO = "7LHBcRYosycMBwBqxBHeRiDQohYzpppDALKYVT4TNY5H", CLKN_TO = "2zMCUkE9pBjcC7ihtLqm28EsCoEHVmCdJYr5262EuPy8", CLKN = "DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS";
const PAYTO = { sol: SOL_TO, clkn: CLKN_TO };
const T0 = Date.UTC(2026, 8, 20, 12);
const mkTx = ({ blockTime, solDelta = 0, clknDelta = 0n, payer = "4Gccq9pESbfNeKiW7M7qi587pYYiaQ4T4zLv3LcriGPs", err = null, mint = CLKN, owner = CLKN_TO }) => ({
  blockTime, meta: { err, preBalances: [10e9, 5e9], postBalances: [10e9 - solDelta - 5000, 5e9 + solDelta],
    preTokenBalances: [{ accountIndex: 2, mint, owner, uiTokenAmount: { amount: "1000" } }],
    postTokenBalances: [{ accountIndex: 2, mint, owner, uiTokenAmount: { amount: (1000n + clknDelta).toString() } }] },
  transaction: { message: { accountKeys: [{ pubkey: payer }, { pubkey: SOL_TO }, { pubkey: "ata" }] } },
});
t("a quote fixes the CLKN amount at issue time and carries a 30-minute window", () => {
  const q = P.makeQuote({ tier: "standard", atMs: T0, solPerClkn: 0.0001, clknDecimals: 9, nowId: () => "q_test" });
  assert.strictEqual(q.lamports, 500_000_000);
  assert.strictEqual(q.clknRaw, "5000000000000");
  assert.strictEqual(q.expiresMs - q.atMs, 30 * 60e3);
  assert.throws(() => P.makeQuote({ tier: "comped", atMs: T0, solPerClkn: 0.0001, clknDecimals: 9 }), /nothing to pay/);
});
t("no CLKN price → SOL-only quote (clknRaw null), never a guessed number", () => {
  const q = P.makeQuote({ tier: "small", atMs: T0, solPerClkn: 0, clknDecimals: 9 });
  assert.strictEqual(q.lamports, 250_000_000); assert.strictEqual(q.clknRaw, null);
});
t("parse: SOL leg is the platform wallet's lamport gain; CLKN leg is the treasury's token gain", () => {
  const a = P.parsePayment(mkTx({ blockTime: 1_800_000_000, solDelta: 500_000_000 }), { payTo: PAYTO, clknMint: CLKN });
  assert.strictEqual(a.ok, true); assert.strictEqual(a.lamports, 500_000_000); assert.strictEqual(a.clknRaw, 0n); assert.strictEqual(a.blockTimeMs, 1_800_000_000_000);
  const b = P.parsePayment(mkTx({ blockTime: 1_800_000_000, clknDelta: 5_000_000_000_000n }), { payTo: PAYTO, clknMint: CLKN });
  assert.strictEqual(b.clknRaw, 5_000_000_000_000n); assert.strictEqual(b.lamports, 0);
});
t("parse: failed tx, wrong mint, wrong owner, or nothing to us → not a payment", () => {
  assert.strictEqual(P.parsePayment(mkTx({ blockTime: 1, solDelta: 1e9, err: { x: 1 } }), { payTo: PAYTO, clknMint: CLKN }).ok, false);
  assert.strictEqual(P.parsePayment(mkTx({ blockTime: 1, clknDelta: 10n, mint: "other" }), { payTo: PAYTO, clknMint: CLKN }).ok, false);
  assert.strictEqual(P.parsePayment(mkTx({ blockTime: 1, clknDelta: 10n, owner: "someone" }), { payTo: PAYTO, clknMint: CLKN }).ok, false);
  assert.strictEqual(P.parsePayment(null, { payTo: PAYTO, clknMint: CLKN }).ok, false);
});
const Q = P.makeQuote({ tier: "standard", atMs: T0, solPerClkn: 0.0001, clknDecimals: 9, nowId: () => "q1" });
const at = (offsetMs) => Math.floor((T0 + offsetMs) / 1000);
t("verify: SOL covering inside the window → ok sol; CLKN covering → ok clkn", () => {
  const s = P.verifyPayment({ quote: Q, payment: P.parsePayment(mkTx({ blockTime: at(60e3), solDelta: 500_000_000 }), { payTo: PAYTO, clknMint: CLKN }) });
  assert.strictEqual(s.ok, true); assert.strictEqual(s.kind, "sol");
  const c = P.verifyPayment({ quote: Q, payment: P.parsePayment(mkTx({ blockTime: at(60e3), clknDelta: 4_950_000_000_000n }), { payTo: PAYTO, clknMint: CLKN }) });
  assert.strictEqual(c.ok, true); assert.strictEqual(c.kind, "clkn");
});
t("verify: short on both legs → short with what was needed", () => {
  const r = P.verifyPayment({ quote: Q, payment: P.parsePayment(mkTx({ blockTime: at(60e3), solDelta: 100_000_000, clknDelta: 10n }), { payTo: PAYTO, clknMint: CLKN }) });
  assert.strictEqual(r.ok, false); assert.strictEqual(r.reason, "short"); assert.strictEqual(r.needLamports, 500_000_000); assert.strictEqual(r.needClknRaw, "5000000000000");
});
t("verify: a payment outside the quote window is refused (a stale quote never prices a later payment)", () => {
  const late = P.verifyPayment({ quote: Q, payment: P.parsePayment(mkTx({ blockTime: at(41 * 60e3), solDelta: 500_000_000 }), { payTo: PAYTO, clknMint: CLKN }) });
  assert.strictEqual(late.ok, false); assert.strictEqual(late.reason, "outside_quote_window");
  const early = P.verifyPayment({ quote: Q, payment: P.parsePayment(mkTx({ blockTime: at(-3 * 60e3), solDelta: 500_000_000 }), { payTo: PAYTO, clknMint: CLKN }) });
  assert.strictEqual(early.ok, false);
  const grace = P.verifyPayment({ quote: Q, payment: P.parsePayment(mkTx({ blockTime: at(39 * 60e3), solDelta: 500_000_000 }), { payTo: PAYTO, clknMint: CLKN }) });
  assert.strictEqual(grace.ok, true, "10 min late grace for a slow confirmation");
});
t("verify: no block time yet → retry, never a guess", () => {
  const r = P.verifyPayment({ quote: Q, payment: P.parsePayment(mkTx({ blockTime: null, solDelta: 500_000_000 }), { payTo: PAYTO, clknMint: CLKN }) });
  assert.strictEqual(r.ok, false); assert.strictEqual(r.retry, true);
});
t("quote book prunes entries a day past expiry", () => {
  const book = { a: { expiresMs: T0 }, b: { expiresMs: T0 + 25 * 3600e3 } };
  assert.deepStrictEqual(Object.keys(P.pruneQuotes(book, T0 + 24 * 3600e3 + 1)), ["b"]);
});

console.log("who may claim a payment (deep dive 2026-09-17 P0-007)");
t("payerAllowed: only an operator wallet of THAT project", () => {
  const p = mk({ operatorWallets: [FUND] });
  assert.strictEqual(A.payerAllowed(p, FUND), true);
  assert.strictEqual(A.payerAllowed(p, MINT), false, "a stranger's payment is refused");
  assert.strictEqual(A.payerAllowed(p, null), false);
  assert.strictEqual(A.payerAllowed(p, ""), false);
  assert.strictEqual(A.payerAllowed(mk(), FUND), false, "no operator wallets → nobody may pay (the owner comps instead)");
  assert.strictEqual(A.payerAllowed(null, FUND), false);
});
t("sigUsedInRegistry: a signature on ANY project's ledger is found; a fresh one is not", () => {
  const sig = "5".repeat(88);
  const reg = {
    a: { access: A.applyPayment(A.normalizeAccess({ tier: "small" }), { sig, atUnix: NOW, kind: "sol", lamports: 250_000_000 }) },
    b: { access: A.normalizeAccess({ tier: "standard" }) },
    c: null,
    d: { access: { payments: null } },
  };
  assert.strictEqual(A.sigUsedInRegistry(reg, sig), "a");
  assert.strictEqual(A.sigUsedInRegistry(reg, "6".repeat(88)), null);
  assert.strictEqual(A.sigUsedInRegistry(reg, ""), null);
  assert.strictEqual(A.sigUsedInRegistry(null, sig), null);
});

console.log(`\n${fail ? "FAILED" : "all passed"} (${pass} passed${fail ? `, ${fail} failed` : ""})`);
process.exit(fail ? 1 : 0);
