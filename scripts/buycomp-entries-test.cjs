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
console.log(`\nall passed (${n})`);
