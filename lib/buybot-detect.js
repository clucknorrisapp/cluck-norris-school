// Buy detection for the project buy bots — one jsonParsed transaction in, one buy (or null) out.
//
// Pulled out of server.js on 2026-09-11 when CUNA got a second CUNA/SOL pool on Meteora DAMM v2
// and the owner asked that "the buy bot represent all buys, adding them together if split by an
// aggregator". Two things were wrong with the inline version:
//
//   1. It valued a buy by the quote received by ONE pool (the cursor's pool, or the largest
//      holder in the tx). A Jupiter route that fills 85% from Orca and 15% from Meteora posted
//      85% of the money next to 100% of the tokens — a wrong fill price on every split buy.
//      Now every LIQUIDITY SOURCE in the transaction — an owner that released the token AND
//      received quote for it — is summed, whether or not we were told about that pool.
//   2. Meteora DAMM v2 does not hold its vaults under the pool address: every pool's vaults
//      are owned by the program's authority PDA (HLnpSz9h…), so the pool address never appears
//      as a token-balance owner. The hint never matched and the arb filter could not see the
//      pool. Known DEX authorities are part of the pool set now, always.
//
// The rules, unchanged in spirit from the ROSE bot the owner tuned by hand:
//   - a BUY is: some owner outside the pool set is the biggest net gainer of the token, and
//     the liquidity sources took in quote (SOL / USDC / USDT / JUP) for what they released;
//   - an ARB between pools (a pool-set member GAINS token in the same tx that another releases)
//     posts nothing (owner call 2026-08-26) — 1%-of-flow epsilon for vault-side dust;
//   - a pool address is never the "maker" (wrong-maker bug, 2026-08-25);
//   - value = what was actually paid, never the lagging price feed; price feed only as a
//     fallback when no quote can be read.
"use strict";

const SOL_MINT = "So11111111111111111111111111111111111111112";
const DEFAULT_QUOTES = {
  [SOL_MINT]: "sol",
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v": "stable",   // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB": "stable",   // USDT
};
const JUP_MINT = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";

// DEX programs whose pools do NOT own their own vaults: the owner in pre/postTokenBalances is a
// program-wide authority PDA, the same for every pool of that program. Verified on chain
// 2026-09-11 (Meteora DAMM v2, CUNA/SOL pool Fdkh4qD9…: vault owner HLnpSz9h…).
const POOL_AUTHORITIES = Object.freeze([
  "HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC",   // Meteora DAMM v2 (cp-amm) pool authority
  "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1",   // Raydium AMM v4 authority
  "GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL",   // Raydium CPMM authority
]);

const num = (b) => Number((b && b.uiTokenAmount && b.uiTokenAmount.uiAmount) || 0);

/**
 * @param {object} tx        jsonParsed getTransaction result
 * @param {object} o
 * @param {string} o.mint    the project token
 * @param {number} o.tokUsd  token price (fallback valuation only)
 * @param {number} o.solUsd  SOL price
 * @param {number} [o.jupUsd]
 * @param {string} [o.poolHint]     the pool whose cursor produced this signature (may be absent from owners)
 * @param {string[]} [o.knownPools] every watched pool address for this project
 * @param {object} [o.quotes]       mint → "sol" | "stable"
 * @param {string[]} [o.poolAuthorities]
 * @returns {null | { wallet, tokenAmt, usd, sig, ts, legs, quote: {sol, stable, jup}, sources: string[] }}
 */
function detectBuy(tx, { mint, tokUsd = 0, solUsd = 0, jupUsd = 0, poolHint = null, knownPools = [], quotes = DEFAULT_QUOTES, poolAuthorities = POOL_AUTHORITIES } = {}) {
  const meta = tx && tx.meta; if (!meta || meta.err || !mint) return null;
  // Net token delta per owner, and net quote delta per owner (in each quote unit).
  const tok = {}, q = {};
  const bump = (b, sign) => {
    if (!b || !b.owner) return;
    if (b.mint === mint) { tok[b.owner] = (tok[b.owner] || 0) + sign * num(b); return; }
    const kind = quotes[b.mint] || (b.mint === JUP_MINT ? "jup" : null);
    if (!kind) return;
    const row = q[b.owner] || (q[b.owner] = { sol: 0, stable: 0, jup: 0 });
    row[kind] += sign * num(b);
  };
  for (const b of (meta.preTokenBalances || [])) bump(b, -1);
  for (const b of (meta.postTokenBalances || [])) bump(b, +1);
  const owners = Object.keys(tok); if (!owners.length) return null;

  // Liquidity sources: released the token AND took in quote for it. A pool that only released
  // token (an LP withdrawal, a transfer out) is not a source; a wallet sending tokens to a friend
  // is not a source either.
  const usdOf = (row) => (row ? row.sol * (solUsd || 0) + row.stable + row.jup * (jupUsd || 0) : 0);
  const rawQuote = (row) => (row ? row.sol + row.stable + row.jup : 0);
  const sources = owners.filter((o) => (tok[o] || 0) < 0 && rawQuote(q[o]) > 0);
  if (!sources.length) return null;

  // The pool set: everything we were told about, every known DEX authority, the cursor's own
  // pool, and every source found in this tx. Nothing in it can ever be posted as the buyer.
  const poolSet = new Set([...(knownPools || []), ...(poolAuthorities || []), ...sources]);
  if (poolHint) poolSet.add(poolHint);

  // ARB FILTER: a pool-set member GAINING the token while sources release it is tokens moving
  // between pools, not a purchase. 1%-of-flow epsilon so vault-side dust cannot trip it.
  const poolOut = -owners.filter((o) => poolSet.has(o)).reduce((s, o) => s + Math.min(0, tok[o] || 0), 0);
  const poolIn = owners.filter((o) => poolSet.has(o)).reduce((s, o) => s + Math.max(0, tok[o] || 0), 0);
  if (poolIn > poolOut * 0.01) return null;

  // The buyer is the biggest net gainer outside the pool set.
  let buyer = null, gain = 0;
  for (const o of owners) { if (poolSet.has(o)) continue; const d = tok[o] || 0; if (d > gain) { gain = d; buyer = o; } }
  if (!buyer || gain <= 0) return null;

  // Value = the quote EVERY source took in, summed — the whole route, not one leg of it.
  const quote = { sol: 0, stable: 0, jup: 0 };
  for (const s of sources) { const r = q[s]; quote.sol += r.sol; quote.stable += r.stable; quote.jup += r.jup; }
  const quoteUsd = usdOf(quote);
  const usd = quoteUsd > 0 ? quoteUsd : (tokUsd > 0 ? gain * tokUsd : null);
  const sig = (tx.transaction && tx.transaction.signatures && tx.transaction.signatures[0]) || null;
  const ts = tx.blockTime ? tx.blockTime * 1000 : Date.now();
  return { wallet: buyer, tokenAmt: gain, usd, sig, ts, legs: sources.length, quote, sources };
}

module.exports = { detectBuy, POOL_AUTHORITIES, DEFAULT_QUOTES, JUP_MINT, SOL_MINT };
