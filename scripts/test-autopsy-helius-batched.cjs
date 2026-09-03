#!/usr/bin/env node
/* Test for lib/autopsy.js's heliusEnhancedBatched — the canonical batched Helius helper
 * that Batch B routed five previously-raw fetches through (lifetime sample, DBC buyers,
 * Pump bonding-curve buyers, holder acquisition attribution, distributor attribution).
 * Confirms retry-on-429, a 5xx retry, and scanQuality accounting all still work — the
 * exact behavior those five call sites now inherit instead of silently swallowing a
 * throttle/error. No network — global.fetch and setTimeout are mocked.
 *
 * Run: node scripts/test-autopsy-helius-batched.cjs
 */
const assert = require("assert");

// Collapse the helper's backoff waits to 0ms so the test runs instantly, without
// touching Node's own timer semantics (still a real, just immediate, setTimeout).
const realSetTimeout = global.setTimeout;
global.setTimeout = (fn, _ms) => realSetTimeout(fn, 0);

const { heliusEnhancedBatched } = require("../lib/autopsy");

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log(`  ok    ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.stack || e.message}`); fail++; }
}

function jsonResp(status, body) {
  return { status, ok: status >= 200 && status < 300, json: async () => body };
}

(async () => {
  await t("retries a 429 then succeeds, and scanQuality.heliusRateLimited counts it", async () => {
    let calls = 0;
    global.fetch = async () => {
      calls++;
      if (calls === 1) return jsonResp(429, {});
      return jsonResp(200, [{ signature: "sig1", tokenTransfers: [] }]);
    };
    const scanQuality = { heliusBatches: 0, heliusBatchesSucceeded: 0, heliusRateLimited: 0 };
    const res = await heliusEnhancedBatched(["sig1"], "k", "test-phase", new Map(), scanQuality);
    assert.strictEqual(calls, 2, "expected one 429 then one success");
    assert.strictEqual(res.txs.length, 1);
    assert.strictEqual(res.succeeded, 1);
    assert.strictEqual(scanQuality.heliusRateLimited, 1);
    assert.strictEqual(scanQuality.heliusBatchesSucceeded, 1);
  });

  await t("retries a 5xx then succeeds", async () => {
    let calls = 0;
    global.fetch = async () => {
      calls++;
      if (calls === 1) return jsonResp(503, {});
      return jsonResp(200, [{ signature: "sig2", tokenTransfers: [] }]);
    };
    const res = await heliusEnhancedBatched(["sig2"], "k", "test-phase", new Map(), null);
    assert.strictEqual(calls, 2);
    assert.strictEqual(res.txs.length, 1);
  });

  await t("all attempts exhausted (persistent 429) degrades to empty, never throws", async () => {
    global.fetch = async () => jsonResp(429, {});
    const scanQuality = { heliusBatches: 0, heliusBatchesSucceeded: 0, heliusRateLimited: 0 };
    const res = await heliusEnhancedBatched(["sig3"], "k", "test-phase", new Map(), scanQuality);
    assert.strictEqual(res.txs.length, 0);
    assert.strictEqual(res.succeeded, 0);
    assert.strictEqual(scanQuality.heliusRateLimited, 4, "expected all 4 attempts to be counted rate-limited");
  });

  await t("a thrown network error is retried and can still succeed", async () => {
    let calls = 0;
    global.fetch = async () => {
      calls++;
      if (calls === 1) throw new Error("network blip");
      return jsonResp(200, [{ signature: "sig4", tokenTransfers: [] }]);
    };
    const res = await heliusEnhancedBatched(["sig4"], "k", "test-phase", new Map(), null);
    assert.strictEqual(res.txs.length, 1);
  });

  await t("cached signatures are served from txCache without a fetch", async () => {
    const cache = new Map([["sigCached", { signature: "sigCached", tokenTransfers: [] }]]);
    global.fetch = async () => { throw new Error("must not fetch a cached sig"); };
    const res = await heliusEnhancedBatched(["sigCached"], "k", "test-phase", cache, null);
    assert.strictEqual(res.cached, 1);
    assert.strictEqual(res.attempted, 0);
    assert.strictEqual(res.txs.length, 1);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  global.setTimeout = realSetTimeout;
  process.exit(fail ? 1 : 0);
})();
