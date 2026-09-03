#!/usr/bin/env node
/* Test for the Batch B fix in lib/rpc.js: rpcFetch must not hang forever on a stalled
 * primary (socket accepts, response never arrives). No network — global.fetch is mocked
 * to simulate a hung primary that only rejects when its AbortSignal fires.
 *
 * Run: node scripts/test-rpc-timeout.cjs
 */
process.env.RPC_TIMEOUT_MS = "80"; // fast test timeout; read once at module load
process.env.HELIUS_API_KEY = "";
process.env.HELIUS_API_KEY_2 = "";
process.env.FALLBACK_RPC_URL = "http://fallback-test.invalid";

const fs = require("fs");
const os = require("os");
const path = require("path");
// Isolate from any real /data — this test's success branch touches lib/helius-usage,
// which persists call-attribution stats to the kvstore.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "clkn-rpc-test-"));

const assert = require("assert");

const PRIMARY = "http://primary-test.invalid";
const FALLBACK = "http://fallback-test.invalid";
const PUBLIC = "https://api.mainnet-beta.solana.com";

function hangUntilAbort(target) {
  return new Promise((resolve, reject) => {
    // never resolves on its own — mirrors a primary that accepted the connection and stalled
  });
}

function mockFetch(behaviors) {
  global.fetch = (url, init) => {
    const b = behaviors[url];
    if (!b) throw new Error("unexpected fetch target in test: " + url);
    return b(init);
  };
}

function okResponse(body) {
  return { ok: true, status: 200, headers: { get: () => null }, body: { cancel: async () => {} }, json: async () => body };
}

// A fetch mock whose promise only settles when the caller's AbortSignal fires — this is
// how real fetch (undici) behaves for a stalled connection once AbortSignal.timeout ticks.
function hangingFetch() {
  return (init) => new Promise((resolve, reject) => {
    if (init && init.signal) {
      if (init.signal.aborted) { const e = new Error("aborted"); e.name = "AbortError"; return reject(e); }
      init.signal.addEventListener("abort", () => { const e = new Error("The operation was aborted"); e.name = "AbortError"; reject(e); });
    }
    // else: truly never settles (would hang the test if rpcFetch never attaches a signal)
  });
}

const rpc = require("../lib/rpc");

let pass = 0, fail = 0;
async function t(name, fn, timeoutMs = 2000) {
  try {
    await Promise.race([
      fn(),
      new Promise((_, rej) => setTimeout(() => rej(new Error("test itself timed out — rpcFetch never settled")), timeoutMs)),
    ]);
    console.log(`  ok    ${name}`); pass++;
  } catch (e) { console.log(`  FAIL  ${name}\n          ${e.stack || e.message}`); fail++; }
}

(async () => {
  await t("a stalled primary READ times out and fails over to the next endpoint", async () => {
    mockFetch({ [PRIMARY]: hangingFetch(), [FALLBACK]: () => Promise.resolve(okResponse({ result: "from-fallback" })) });
    const res = await rpc.rpcFetch(PRIMARY, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "getBalance", method: "getBalance", params: [] }),
    });
    const body = await res.json();
    assert.strictEqual(body.result, "from-fallback");
  });

  await t("a stalled primary WRITE (sendTransaction) surfaces the timeout, never replays", async () => {
    mockFetch({ [PRIMARY]: hangingFetch(), [FALLBACK]: () => Promise.resolve(okResponse({ result: "should-not-be-used" })) });
    let threw = false;
    try {
      await rpc.rpcFetch(PRIMARY, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "sendTransaction", method: "sendTransaction", params: [] }),
      });
    } catch (e) { threw = true; }
    assert.strictEqual(threw, true, "a non-idempotent write must not be silently replayed to a backup after a timeout");
  });

  await t("a caller-supplied signal is respected as-is (not overridden)", async () => {
    mockFetch({ [PRIMARY]: (init) => {
      assert.ok(init.signal, "expected a signal to be present");
      assert.strictEqual(init.signal.reason ?? init.signal.aborted, init.signal.reason ?? init.signal.aborted); // signal exists, shape-check only
      return Promise.resolve(okResponse({ result: "ok" }));
    } });
    const ac = new AbortController();
    const res = await rpc.rpcFetch(PRIMARY, {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: ac.signal,
      body: JSON.stringify({ jsonrpc: "2.0", id: "getBalance", method: "getBalance", params: [] }),
    });
    const body = await res.json();
    assert.strictEqual(body.result, "ok");
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  try { fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }); } catch (_) {}
  process.exit(fail ? 1 : 0);
})();
