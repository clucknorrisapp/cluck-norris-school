#!/usr/bin/env node
/* Tests for the two Batch B fixes in lib/helius-trades.js. No network — global.fetch is
 * mocked per test. No keys, no wallet.
 *
 * 1. getWalletTokenPositionHelius must return null (not a clean-looking sells:0 object)
 *    when a signature page is throttled (200-with-{error}) or the request throws — a
 *    masked failure here reads as "wallet never sold" to buy-comp / Buy Special payouts.
 * 2. getTradeTapeHelius must set capped:true (never silently stay false) when a
 *    signature page errors, so callers don't treat a truncated tape as complete.
 *
 * Run: node scripts/test-helius-trades.cjs
 */
const assert = require("assert");
const {
  getWalletTokenPositionHelius,
  getTradeTapeHelius,
} = require("../lib/helius-trades");

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log(`  ok    ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.stack || e.message}`); fail++; }
}

function jsonResp(body, status = 200) {
  return { status, headers: { get: () => null }, json: async () => body };
}

// method-keyed fetch mock: `handlers[method]` is called with params for a JSON-RPC POST;
// a non-JSON-RPC POST (dexscreener discovery) matches by URL substring via `handlers.__dex`.
function mockRpc(handlers) {
  global.fetch = async (url, opts) => {
    if (typeof url === "string" && url.includes("dexscreener.com")) {
      if (handlers.__dex) return handlers.__dex();
      return jsonResp([]);
    }
    const body = JSON.parse(opts.body);
    const h = handlers[body.method];
    if (!h) throw new Error("unexpected rpc method in test: " + body.method);
    return h(body.params);
  };
}

const stubEnhancedBatched = async (sigs) => ({ txs: [] }); // should never be reached once coverage fails

console.log("\ngetWalletTokenPositionHelius: masked-failure fixes");

(async () => {
  await t("throttled sig page (200-with-{error}) returns null, not sells:0", async () => {
    mockRpc({
      getTokenAccountsByOwner: () => jsonResp({ result: { value: [
        { pubkey: "TA1", account: { data: { parsed: { info: { tokenAmount: { uiAmount: 5 } } } } } },
      ] } }),
      getSignaturesForAddress: () => jsonResp({ error: { code: -32005, message: "too many requests" } }),
    });
    let calledEnhanced = false;
    const res = await getWalletTokenPositionHelius("WalletA", "MintA", {
      heliusKey: "k", heliusEnhancedBatched: async () => { calledEnhanced = true; return { txs: [] }; },
    });
    assert.strictEqual(res, null, "a throttled sig page must not produce a trusted result");
    assert.strictEqual(calledEnhanced, false, "must not proceed to classify with an incomplete sig set");
  });

  await t("thrown fetch error on sig page returns null", async () => {
    mockRpc({
      getTokenAccountsByOwner: () => jsonResp({ result: { value: [
        { pubkey: "TA1", account: { data: { parsed: { info: { tokenAmount: { uiAmount: 5 } } } } } },
      ] } }),
      getSignaturesForAddress: () => { throw new Error("network blip"); },
    });
    const res = await getWalletTokenPositionHelius("WalletA", "MintA", {
      heliusKey: "k", heliusEnhancedBatched: stubEnhancedBatched,
    });
    assert.strictEqual(res, null);
  });

  await t("clean scan still returns a real position (no regression)", async () => {
    mockRpc({
      getTokenAccountsByOwner: () => jsonResp({ result: { value: [
        { pubkey: "TA1", account: { data: { parsed: { info: { tokenAmount: { uiAmount: 5 } } } } } },
      ] } }),
      getSignaturesForAddress: () => jsonResp({ result: [
        { signature: "sig1", err: null, blockTime: 1000 },
      ] }),
    });
    const res = await getWalletTokenPositionHelius("WalletA", "MintA", {
      heliusKey: "k",
      heliusEnhancedBatched: async () => ({ txs: [
        { signature: "sig1", timestamp: 1000, tokenTransfers: [
          { mint: "MintA", fromUserAccount: "WalletA", toUserAccount: "Buyer1", tokenAmount: 2 },
          { mint: "So11111111111111111111111111111111111111112", fromUserAccount: "Buyer1", toUserAccount: "WalletA", tokenAmount: 0.1 },
        ], nativeTransfers: [] },
      ] }),
    });
    assert.ok(res, "expected a real result on a clean scan");
    assert.strictEqual(res.balance, 5);
    assert.strictEqual(res.sells, 1);
    assert.strictEqual(res.source, "helius");
  });

  console.log("\ngetTradeTapeHelius: capped must reflect truncation, not stay false");

  await t("a sig-page error sets capped:true (was silently false)", async () => {
    mockRpc({
      getTokenLargestAccounts: () => jsonResp({ result: { value: [{ address: "Pool1" }] } }),
      getSignaturesForAddress: () => jsonResp({ error: { code: -32005, message: "quota" } }),
    });
    const res = await getTradeTapeHelius("MintA", 0, 999999999999, {
      heliusKey: "k", heliusEnhancedBatched: async () => ({ txs: [] }),
    });
    assert.ok(res, "expected a degraded-but-honest result, not null");
    assert.strictEqual(res.capped, true, "a truncated tape must report capped:true");
  });

  await t("a clean scan keeps capped:false", async () => {
    mockRpc({
      getTokenLargestAccounts: () => jsonResp({ result: { value: [{ address: "Pool1" }] } }),
      getSignaturesForAddress: (params) => jsonResp({ result: [
        { signature: "sig1", err: null, blockTime: 1000 },
      ] }),
    });
    const res = await getTradeTapeHelius("MintA", 0, 999999999999, {
      heliusKey: "k", heliusEnhancedBatched: async () => ({ txs: [
        { signature: "sig1", timestamp: 1000, tokenTransfers: [
          { mint: "MintA", fromUserAccount: "Pool1", toUserAccount: "Buyer1", tokenAmount: 10 },
          { mint: "So11111111111111111111111111111111111111112", fromUserAccount: "Buyer1", toUserAccount: "Pool1", tokenAmount: 0.5 },
        ], nativeTransfers: [] },
      ] }),
    });
    assert.ok(res);
    assert.strictEqual(res.capped, false);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
