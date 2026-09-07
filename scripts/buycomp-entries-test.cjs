#!/usr/bin/env node
"use strict";
// Buy-comp entries ("every $3 buy = 2 horses"): counted per qualifying BUY, priced from each
// buy's SOL size; null (never a false zero) when a source carries no per-buy sizes.
const assert = require("assert");
const { entriesFromBuys, classifyBuyersFromRawTxs } = require("../lib/helius-trades");
let n = 0; const ok = (name, fn) => { fn(); n++; console.log("  ✓ " + name); };
ok("three $3+ buys and one dust buy at $200/SOL → 3 entries, 6 horses", () => {
  assert.deepStrictEqual(entriesFromBuys([0.02, 0.015, 0.05, 0.001], 200, 3, 2), { entries: 3, horses: 6 });
});
ok("a $9 buy is ONE entry (per buy, not per $3 of volume)", () => {
  assert.deepStrictEqual(entriesFromBuys([0.045], 200, 3, 2), { entries: 1, horses: 2 });
});
ok("exactly $3.00 qualifies (no float slop)", () => {
  assert.deepStrictEqual(entriesFromBuys([0.015], 200, 3, 2), { entries: 1, horses: 2 });
});
ok("no per-buy sizes (fallback source) → null, not 0", () => {
  assert.strictEqual(entriesFromBuys(undefined, 200, 3, 2), null);
});
ok("no entry rule or no SOL price → null", () => {
  assert.strictEqual(entriesFromBuys([0.02], 200, 0, 2), null);
  assert.strictEqual(entriesFromBuys([0.02], 0, 3, 2), null);
});
ok("entryHorses floors to at least 1", () => {
  assert.deepStrictEqual(entriesFromBuys([0.02], 200, 3, 0), { entries: 1, horses: 1 });
});
ok("the classifier records each buy's SOL size on the aggregate", () => {
  assert.strictEqual(typeof classifyBuyersFromRawTxs, "function");
  const src = require("fs").readFileSync(require("path").join(__dirname, "..", "lib", "helius-trades.js"), "utf8");
  assert.ok(/buysSol:\s*\[\]/.test(src) && /cur\.buysSol\.push\(buySol\)/.test(src), "buysSol is kept per wallet");
});

// ---- buys PAID BY SOMEONE ELSE (Phantom "buy with cash", fiat on-ramps, relayers) ----
// Real tx from the OnlyRose comp, 2026-09-07 21:56Z: Phantom's cash account BLTf69… spent 49.97 CASH,
// the Raydium pool gave up 146,298 ROSE, and the ROSE landed in the customer's wallet HiahJYkB…,
// which spent nothing itself. It never reached the board ("this can't happen" — owner).
const ROSE = "RoSeiVjW5H48ucPAJh1LJGBBzPpqvsokfDGpgHXDtdF";
const fx = JSON.parse(require("fs").readFileSync(require("path").join(__dirname, "fixtures", "rose-phantom-cash-buy.json"), "utf8"));
ok("a Phantom Cash buy is credited to the wallet that RECEIVED the token, sized by the cash the payer spent", () => {
  const out = classifyBuyersFromRawTxs([fx], ROSE, { solUsd: 104, tokenPriceUsd: 0 });
  assert.strictEqual(out.length, 1, "exactly one buyer");
  assert.strictEqual(out[0].wallet, "HiahJYkBMSYzckeb8XeZ7dvxVeWTsq8jQQ2wq4Jo4SDZ");
  assert.ok(Math.abs(out[0].tokensBought - 146298.064) < 0.01, "tokens bought = the pool's ROSE out");
  assert.ok(out[0].volumeSol > 0.45 && out[0].volumeSol < 0.52, "≈49.97 CASH at $104/SOL ≈ 0.48 SOL, got " + out[0].volumeSol);
  assert.deepStrictEqual(entriesFromBuys(out[0].buysSol, 104, 3, 2), { entries: 1, horses: 2 }, "a $49 buy is ONE entry = 2 horses");
});
ok("the payer's cash account is NOT a buyer (it received no token)", () => {
  const out = classifyBuyersFromRawTxs([fx], ROSE, { solUsd: 104, tokenPriceUsd: 0 });
  assert.ok(!out.some((b) => b.wallet === "BLTf69fRRYLv7L27TppmGX9ZCosVb28Ripc6BbjTRCc8"));
});
ok("an airdrop / wallet-to-wallet transfer is still not a buy (no pool gave up the token)", () => {
  const A = "HiahJYkBMSYzckeb8XeZ7dvxVeWTsq8jQQ2wq4Jo4SDZ", B = "BLTf69fRRYLv7L27TppmGX9ZCosVb28Ripc6BbjTRCc8";
  const tx = { transaction: { message: { accountKeys: [B, A] } }, meta: { err: null,
    preBalances: [1e9, 1e9], postBalances: [1e9 - 5000, 1e9],
    preTokenBalances: [{ owner: B, mint: ROSE, uiTokenAmount: { uiAmount: 1000 } }, { owner: A, mint: ROSE, uiTokenAmount: { uiAmount: 0 } }],
    postTokenBalances: [{ owner: B, mint: ROSE, uiTokenAmount: { uiAmount: 0 } }, { owner: A, mint: ROSE, uiTokenAmount: { uiAmount: 1000 } }] } };
  assert.deepStrictEqual(classifyBuyersFromRawTxs([tx], ROSE, { solUsd: 104 }), []);
});
ok("a pool swap where the receiver paid nothing and NOBODY else spent quote is still not a buy", () => {
  const A = "HiahJYkBMSYzckeb8XeZ7dvxVeWTsq8jQQ2wq4Jo4SDZ", POOL = "7JtHjSAm7emq5Mc9GQgVZwfDY3Ma1TcE2cEwiy9mgkP6";
  const tx = { transaction: { message: { accountKeys: [A] } }, meta: { err: null, preBalances: [1e9], postBalances: [1e9 - 5000],
    preTokenBalances: [{ owner: POOL, mint: ROSE, uiTokenAmount: { uiAmount: 1000 } }],
    postTokenBalances: [{ owner: POOL, mint: ROSE, uiTokenAmount: { uiAmount: 0 } }, { owner: A, mint: ROSE, uiTokenAmount: { uiAmount: 1000 } }] } };
  assert.deepStrictEqual(classifyBuyersFromRawTxs([tx], ROSE, { solUsd: 104 }), []);
});
console.log(`\nall passed (${n})`);
