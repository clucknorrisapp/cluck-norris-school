#!/usr/bin/env node
"use strict";
// Owner, 2026-09-11: "there is a new CUNA/SOL pool on Meteora — make sure the buy bot is
// representing all buys, add them together if split by an aggregator." Two real mainnet
// transactions from that pool's first hour are the fixtures (token balances only):
//   - buybot-cuna-split-orca-meteora.json: one Jupiter buy filled 2.09M CUNA from the Orca pool
//     and 0.37M from the Meteora pool. The old code valued it by the Orca leg only.
//   - buybot-cuna-arb-meteora-to-orca.json: an arb bot moving CUNA from Meteora into Orca —
//     must never post (owner rule 2026-08-26).
// Meteora DAMM v2 vaults are owned by the program authority HLnpSz9h…, not the pool address, so
// the pool hint never matches an owner; the authority list is what makes the arb filter see it.
const { detectBuy, POOL_AUTHORITIES } = require("../lib/buybot-detect");
const fs = require("fs"), path = require("path");
const fx = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", n), "utf8"));

let failures = 0;
const ok = (name, cond, detail) => { if (cond) console.log("  ✓ " + name); else { failures++; console.log("  ✗ " + name + (detail ? "\n      " + (typeof detail === "string" ? detail : JSON.stringify(detail)) : "")); } };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

const CUNA = "4yro2xbCxMFVvygCsj5FZMgZnVCb8EqcbPGTbSGCgDBc";
const ORCA = "2pxxjL96USyv6WPbrF2xkoKt16UdueyTuzr3CLwwTb1G";       // CUNA/SOL Orca (primary)
const METEORA = "Fdkh4qD97X3as4ZVmk14TLWY1XuxjFvn2nnzoarDRvsW";    // CUNA/SOL Meteora DAMM v2 pool
const METEORA_AUTH = "HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC";
const TREASURY = "2zMCUkE9pBjcC7ihtLqm28EsCoEHVmCdJYr5262EuPy8";
const SOL = "So11111111111111111111111111111111111111112";
const SOL_USD = 200;

// Synthetic transactions built the way the chain reports them.
function mk(rows, { err = null, sig = "S".repeat(88), blockTime = 1789135783 } = {}) {
  const pre = [], post = [];
  for (const r of rows) {
    pre.push({ owner: r.owner, mint: r.mint, uiTokenAmount: { uiAmount: r.pre } });
    post.push({ owner: r.owner, mint: r.mint, uiTokenAmount: { uiAmount: r.post } });
  }
  return { blockTime, transaction: { signatures: [sig] }, meta: { err, preTokenBalances: pre, postTokenBalances: post } };
}

console.log("the real split buy (Orca 85% + Meteora 15% in one Jupiter route)");
{
  const tx = fx("buybot-cuna-split-orca-meteora.json");
  // Seen from the Orca cursor, with the Meteora pool NOT yet on the watch list (the state on
  // 2026-09-11 13:26 when the pool went live).
  const a = detectBuy(tx, { mint: CUNA, solUsd: SOL_USD, poolHint: ORCA, knownPools: [ORCA] });
  ok("detected as a buy", !!a, a);
  ok("buyer is the treasury wallet (biggest gainer outside the pool set)", a && a.wallet === TREASURY, a && a.wallet);
  ok("token amount is the buyer's whole gain", a && near(a.tokenAmt, 2459708.282747, 1e-3), a && a.tokenAmt);
  ok("two liquidity sources found: the Orca pool and the Meteora authority", a && a.legs === 2 && a.sources.includes(ORCA) && a.sources.includes(METEORA_AUTH), a && a.sources);
  ok("SOL paid is BOTH legs summed (0.212287 + 0.037463)", a && near(a.quote.sol, 0.212287 + 0.037463, 1e-6), a && a.quote);
  ok("USD is the whole route, not one leg", a && near(a.usd, (0.212287 + 0.037463) * SOL_USD, 1e-3), a && a.usd);
  // Seen from the Meteora cursor after the pool was added: identical answer.
  const b = detectBuy(tx, { mint: CUNA, solUsd: SOL_USD, poolHint: METEORA, knownPools: [ORCA, METEORA] });
  ok("same buy from the Meteora cursor: same wallet, amount and USD", b && b.wallet === a.wallet && b.tokenAmt === a.tokenAmt && b.usd === a.usd, b);
  // The old behaviour, for the record: one leg only.
  ok("the old one-leg valuation would have been 15% short", near(0.212287 * SOL_USD / a.usd, 0.85, 0.01));
  ok("signature and block time carried through", a.sig === tx.transaction.signatures[0] && a.ts === tx.blockTime * 1000);
}

console.log("the real arb (Meteora → Orca) posts nothing");
{
  const tx = fx("buybot-cuna-arb-meteora-to-orca.json");
  ok("from the Orca cursor: null", detectBuy(tx, { mint: CUNA, solUsd: SOL_USD, poolHint: ORCA, knownPools: [ORCA] }) === null);
  ok("from the Meteora cursor: null", detectBuy(tx, { mint: CUNA, solUsd: SOL_USD, poolHint: METEORA, knownPools: [ORCA, METEORA] }) === null);
  ok("the Meteora side is recognised as a source even without the authority list (released token + took SOL)",
    detectBuy(tx, { mint: CUNA, solUsd: SOL_USD, knownPools: [ORCA], poolAuthorities: [] }) === null);
  // Documented limit: if the GAINING pool is on nobody's list it looks like a buyer. That is
  // why every pool of a project stays on the watch list — the fix is config, not heuristics.
  ok("with the Orca pool off the watch list the arb's Orca side is an unknown gainer and would post (keep every pool listed)",
    (() => { const r = detectBuy(tx, { mint: CUNA, solUsd: SOL_USD, knownPools: [], poolAuthorities: [] }); return r && r.wallet === ORCA; })());
}

console.log("the reverse arb (Orca → Meteora): what the authority list is for");
{
  // Orca releases (a source); the Meteora AUTHORITY gains CUNA and pays SOL — the pool
  // address Fdkh… is on the watch list but never appears as an owner, so only the authority
  // list can tell this gainer from a human buyer.
  const tx = mk([
    { owner: ORCA, mint: CUNA, pre: 9_000_000, post: 8_950_000 }, { owner: ORCA, mint: SOL, pre: 20, post: 20.005 },
    { owner: METEORA_AUTH, mint: CUNA, pre: 4_000_000, post: 4_050_000 }, { owner: METEORA_AUTH, mint: SOL, pre: 10, post: 9.9951 },
  ]);
  ok("with the authority list: null", detectBuy(tx, { mint: CUNA, solUsd: SOL_USD, poolHint: ORCA, knownPools: [ORCA, METEORA] }) === null);
  ok("without it the Meteora authority would be posted as the 'buyer' (the wrong-maker bug, Meteora edition)",
    (() => { const r = detectBuy(tx, { mint: CUNA, solUsd: SOL_USD, poolHint: ORCA, knownPools: [ORCA, METEORA], poolAuthorities: [] }); return r && r.wallet === METEORA_AUTH; })());
}

const BUYER = "HiahJYkBMSYzckeb8XeZ7dvxVeWTsq8jQQ2wq4Jo4SDZ";

console.log("a Meteora-only buy (pool address never appears as an owner)");
{
  const tx = mk([
    { owner: METEORA_AUTH, mint: CUNA, pre: 5_000_000, post: 4_800_000 },
    { owner: METEORA_AUTH, mint: SOL, pre: 10, post: 10.02 },
    { owner: BUYER, mint: CUNA, pre: 0, post: 200_000 },
  ]);
  const r = detectBuy(tx, { mint: CUNA, solUsd: SOL_USD, poolHint: METEORA, knownPools: [ORCA, METEORA] });
  ok("detected, buyer correct, 0.02 SOL", r && r.wallet === BUYER && near(r.quote.sol, 0.02) && near(r.usd, 4), r);
  ok("the Meteora authority is a source, never the buyer", r && r.sources[0] === METEORA_AUTH);
}

console.log("a buy split across a watched pool and a pool nobody told us about");
{
  const UNKNOWN_POOL = "7CCy8HFRH4ArD23wFDdRmqNHNsnoXhDmzm4NcnpN9HyX";
  const tx = mk([
    { owner: ORCA, mint: CUNA, pre: 9_000_000, post: 8_400_000 }, { owner: ORCA, mint: SOL, pre: 20, post: 20.06 },
    { owner: UNKNOWN_POOL, mint: CUNA, pre: 1_000_000, post: 600_000 }, { owner: UNKNOWN_POOL, mint: SOL, pre: 2, post: 2.04 },
    { owner: BUYER, mint: CUNA, pre: 100, post: 1_000_100 },
  ]);
  const r = detectBuy(tx, { mint: CUNA, solUsd: SOL_USD, poolHint: ORCA, knownPools: [ORCA] });
  ok("both legs counted: 0.10 SOL for 1,000,000 CUNA", r && near(r.quote.sol, 0.10) && r.tokenAmt === 1_000_000 && r.legs === 2, r);
}

console.log("things that are not buys");
{
  const sell = mk([
    { owner: ORCA, mint: CUNA, pre: 9_000_000, post: 9_500_000 }, { owner: ORCA, mint: SOL, pre: 20, post: 19.95 },
    { owner: BUYER, mint: CUNA, pre: 500_000, post: 0 },
  ]);
  ok("a sell → null", detectBuy(sell, { mint: CUNA, solUsd: SOL_USD, poolHint: ORCA, knownPools: [ORCA] }) === null);
  const xfer = mk([
    { owner: BUYER, mint: CUNA, pre: 500_000, post: 0 },
    { owner: TREASURY, mint: CUNA, pre: 0, post: 500_000 },
  ]);
  ok("a wallet-to-wallet transfer (no quote anywhere) → null", detectBuy(xfer, { mint: CUNA, solUsd: SOL_USD, poolHint: ORCA, knownPools: [ORCA] }) === null);
  const lpOut = mk([
    { owner: ORCA, mint: CUNA, pre: 9_000_000, post: 8_000_000 }, { owner: ORCA, mint: SOL, pre: 20, post: 19 },
    { owner: BUYER, mint: CUNA, pre: 0, post: 1_000_000 }, { owner: BUYER, mint: SOL, pre: 0, post: 1 },
  ]);
  ok("an LP withdrawal (pool released token AND quote) → null", detectBuy(lpOut, { mint: CUNA, solUsd: SOL_USD, poolHint: ORCA, knownPools: [ORCA] }) === null);
  const failed = mk([{ owner: ORCA, mint: CUNA, pre: 1, post: 0 }, { owner: ORCA, mint: SOL, pre: 0, post: 1 }, { owner: BUYER, mint: CUNA, pre: 0, post: 1 }], { err: { InstructionError: [4, { Custom: 6003 }] } });
  ok("a failed transaction → null", detectBuy(failed, { mint: CUNA, solUsd: SOL_USD }) === null);
  ok("no meta → null", detectBuy({}, { mint: CUNA }) === null && detectBuy(null, { mint: CUNA }) === null);
  const arbUnknown = mk([
    { owner: ORCA, mint: CUNA, pre: 9_000_000, post: 8_900_000 }, { owner: ORCA, mint: SOL, pre: 20, post: 20.01 },
    { owner: "AvD5K8Ls4FfdqcGAvYvEHX1auyW3sBCXezfvP6m8bHSc", mint: CUNA, pre: 100, post: 100_100 },
    { owner: "AvD5K8Ls4FfdqcGAvYvEHX1auyW3sBCXezfvP6m8bHSc", mint: SOL, pre: 5, post: 4.99 },
  ]);
  ok("an arb into a WATCHED pool → null", detectBuy(arbUnknown, { mint: CUNA, solUsd: SOL_USD, poolHint: ORCA, knownPools: [ORCA, "AvD5K8Ls4FfdqcGAvYvEHX1auyW3sBCXezfvP6m8bHSc"] }) === null);
}

console.log("valuation rules");
{
  const usdc = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  const tx = mk([
    { owner: ORCA, mint: CUNA, pre: 9_000_000, post: 8_900_000 }, { owner: ORCA, mint: usdc, pre: 1000, post: 1012.5 },
    { owner: BUYER, mint: CUNA, pre: 0, post: 100_000 },
  ]);
  const r = detectBuy(tx, { mint: CUNA, solUsd: SOL_USD, tokUsd: 0.0001, poolHint: ORCA, knownPools: [ORCA] });
  ok("USDC leg valued at face, price feed ignored when quote is readable", r && near(r.usd, 12.5), r);
  const dust = mk([
    { owner: ORCA, mint: CUNA, pre: 9_000_000, post: 8_900_000 }, { owner: ORCA, mint: SOL, pre: 20, post: 20.05 },
    { owner: METEORA_AUTH, mint: CUNA, pre: 1000, post: 1500 },   // vault-side dust into another pool: 0.5% of flow
    { owner: BUYER, mint: CUNA, pre: 0, post: 99_500 },
  ]);
  ok("pool-side dust under 1% of flow does not trip the arb filter", !!detectBuy(dust, { mint: CUNA, solUsd: SOL_USD, poolHint: ORCA, knownPools: [ORCA] }));
  ok("the authority list is frozen and carries Meteora DAMM v2", Object.isFrozen(POOL_AUTHORITIES) && POOL_AUTHORITIES.includes(METEORA_AUTH));
}

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
