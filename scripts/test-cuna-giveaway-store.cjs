#!/usr/bin/env node
/* Tests for the two Batch B fixes in lib/cuna-giveaway.js. No network for the corruption
 * test; the save()-handle race test mocks global.fetch (runDraw's own seed-block RPC calls)
 * to simulate a concurrent process writing the ledger mid-draw. No wallet, no keys.
 *
 * 1. load() must not silently replace an unparseable EXISTING file with blank() — the next
 *    save() would overwrite a real ledger with an empty one. Quarantine + refuse to persist.
 * 2. save() must serialize the HANDLE the caller mutated, not the module's `_mem` cache,
 *    which can be swapped out from under a long-running mutator (runDraw holds `s` across
 *    two awaited RPC calls) by an intervening load() elsewhere in the same process.
 *
 * Run: node scripts/test-cuna-giveaway-store.cjs
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("assert");

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log(`  ok    ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.stack || e.message}`); fail++; }
}

function freshDir() { return fs.mkdtempSync(path.join(os.tmpdir(), "clkn-cuna-test-")); }
function requireFresh() {
  const resolved = require.resolve("../lib/cuna-giveaway");
  delete require.cache[resolved];
  return require("../lib/cuna-giveaway");
}

console.log("\nload()/save() — corrupt file is quarantined, not overwritten");

(async () => {
  await t("a corrupt ledger file is left untouched on disk after a mutation", async () => {
    const dir = freshDir();
    process.env.DATA_DIR = dir;
    const giveaway = requireFresh();
    const file = giveaway.STATE_FILE();
    fs.writeFileSync(file, "{\"wallets\": truncated garbage");

    // A mutator (setBoardMsgId) must not throw, and must not overwrite the corrupt file.
    giveaway.setBoardMsgId("msg-123");

    const onDisk = fs.readFileSync(file, "utf8");
    assert.strictEqual(onDisk, "{\"wallets\": truncated garbage", "the original corrupt file must be left exactly as found");

    const quarantined = fs.readdirSync(dir).filter((f) => f.startsWith(path.basename(file) + ".corrupt-"));
    assert.strictEqual(quarantined.length, 1, "expected exactly one quarantine copy");
  });

  await t("a missing file (fresh start) is NOT treated as corruption — no quarantine, saves normally", async () => {
    const dir = freshDir();
    process.env.DATA_DIR = dir;
    const giveaway = requireFresh();
    const file = giveaway.STATE_FILE();
    assert.ok(!fs.existsSync(file), "test assumes no pre-existing file");

    giveaway.configure({ mint: "MintA", pool: "PoolA", startMs: 1000, endMs: 2000, chatId: "chat1" });

    assert.ok(fs.existsSync(file), "a fresh ledger must be able to save");
    const quarantined = fs.readdirSync(dir).filter((f) => f.includes(".corrupt-"));
    assert.strictEqual(quarantined.length, 0, "a missing file must never be quarantined");
    const onDisk = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.strictEqual(onDisk.config.mint, "MintA");
  });

  console.log("\nsave(s) — persists the mutated handle, not a stale _mem swapped in mid-flight");

  await t("runDraw's draw survives a concurrent load() reassigning _mem during its awaits", async () => {
    const dir = freshDir();
    process.env.DATA_DIR = dir;
    const giveaway = requireFresh();
    const file = giveaway.STATE_FILE();

    // Seed a valid ledger with one eligible wallet directly on disk, then let the module load it.
    const seeded = {
      config: { mint: "MintA", pool: "PoolA", startMs: 0, endMs: 999999999999, chatId: null, exclude: [] },
      cursorMs: 0,
      wallets: { WalletA: { entries: 3, usd: 15, tokens: 100, buys: [], dq: null } },
      scans: 0, capHits: 0, lastScanAt: 0, lastError: null, traced: null, draw: null, boardMsgId: null,
    };
    fs.writeFileSync(file, JSON.stringify(seeded));

    let getSlotCalls = 0;
    global.fetch = async (url, opts) => {
      const body = JSON.parse(opts.body);
      if (body.method === "getSlot") {
        getSlotCalls++;
        // Simulate a CONCURRENT write + load in this same process while runDraw's `s` handle
        // is still in flight — the exact race that orphaned `_mem` from `s`.
        const future = new Date(Date.now() + 10000);
        fs.utimesSync(file, future, future);
        giveaway.config(); // triggers load(): reparses the (content-identical) file into a NEW object
        return { status: 200, json: async () => ({ result: 12345 }) };
      }
      if (body.method === "getBlock") {
        return { status: 200, json: async () => ({ result: { blockhash: "FakeBlockhash111" } }) };
      }
      throw new Error("unexpected RPC method in test: " + body.method);
    };

    const res = await giveaway.runDraw({ rpcUrl: "http://fake-rpc.invalid" }, { prizes: [1000], alternates: 0 });
    assert.strictEqual(res.ok, true, "runDraw should succeed: " + JSON.stringify(res));
    assert.strictEqual(getSlotCalls, 1);

    const onDisk = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.ok(onDisk.draw, "the draw computed by runDraw must have been persisted to disk, not dropped by the race");
    assert.ok(Array.isArray(onDisk.draw.winners) && onDisk.draw.winners.length === 1);
    assert.strictEqual(onDisk.draw.winners[0].wallet, "WalletA");
  });

  console.log("\ntraceOutbound() — a wallet whose scan coverage is unknown is counted, not silently dropped");

  await t("a throw and a null from getWalletTokenPositionHelius both land in `unknown`, never in `checked`", async () => {
    const dir = freshDir();
    process.env.DATA_DIR = dir;

    // Inject a fake lib/helius-trades BEFORE requiring cuna-giveaway, since cuna-giveaway
    // destructures getWalletTokenPositionHelius at require-time into a local const — mutating
    // the real module's exports afterward would not reach that reference.
    const heliusPath = require.resolve("../lib/helius-trades");
    const realHeliusExports = require.cache[heliusPath];
    require.cache[heliusPath] = {
      id: heliusPath, filename: heliusPath, loaded: true,
      exports: {
        getTradeTapeHelius: async () => ({ trades: [], capped: false }),
        // WalletA: RPC/parse throws (coverage broken). WalletB: null (incomplete coverage,
        // e.g. sig-page truncation). WalletC: a real clean position (still holding, no sells).
        getWalletTokenPositionHelius: async (wallet) => {
          if (wallet === "WalletA") throw new Error("simulated rpc failure");
          if (wallet === "WalletB") return null;
          if (wallet === "WalletC") return { sells: 0, transferDests: [] };
          throw new Error("unexpected wallet in test: " + wallet);
        },
      },
    };
    try {
      const giveaway = requireFresh();
      giveaway.configure({ mint: "MintA", pool: "PoolA", startMs: 0, endMs: 999999999999, chatId: null });
      const s = giveaway.standings(); // forces a load(); ensure config landed
      assert.strictEqual(s.config.mint, "MintA");

      // Seed three eligible wallets directly, then re-load via a mutator so traceOutbound sees them.
      const file = giveaway.STATE_FILE();
      const onDisk = JSON.parse(fs.readFileSync(file, "utf8"));
      onDisk.wallets = {
        WalletA: { entries: 1, usd: 1, tokens: 1, buys: [], dq: null },
        WalletB: { entries: 1, usd: 1, tokens: 1, buys: [], dq: null },
        WalletC: { entries: 1, usd: 1, tokens: 1, buys: [], dq: null },
      };
      fs.writeFileSync(file, JSON.stringify(onDisk));
      // Force the next load() to re-read (mtime must move forward from the write above).
      const future = new Date(Date.now() + 10000);
      fs.utimesSync(file, future, future);

      const res = await giveaway.traceOutbound({ heliusKey: "k", heliusEnhancedBatched: async () => ({ txs: [] }) }, { hops: 1 });
      assert.strictEqual(res.ok, true, JSON.stringify(res));
      assert.strictEqual(res.checked, 1, "only WalletC's scan actually completed");
      assert.strictEqual(res.unknown, 2, "WalletA (threw) and WalletB (null) must both be counted as unknown, not dropped silently");
      assert.strictEqual(res.dq, 0);
      assert.strictEqual(res.candidates, 3);

      const persisted = JSON.parse(fs.readFileSync(file, "utf8"));
      assert.strictEqual(persisted.traced.unknown, 2, "the persisted summary must carry the unknown count too");
    } finally {
      if (realHeliusExports) require.cache[heliusPath] = realHeliusExports;
      else delete require.cache[heliusPath];
    }
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
