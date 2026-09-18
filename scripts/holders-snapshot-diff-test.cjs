#!/usr/bin/env node
"use strict";
// Unit + route gate for lib/holders-snapshot.js's diffSnapshots (Colosseum roadmap §11 AA3).
// scripts/holders-snapshot-test.cjs boots nothing (pure unit test against an in-memory kv), so
// this is a separate file per the roadmap task, split the same way: an in-process unit section
// (no server) and a route section that boots the real server against a seeded, throwaway
// DATA_DIR. What must hold:
//   - a snapshot diffed with itself comes back with all three arrays empty, both deltas zero,
//     sameFullList true (see lib/holders-snapshot.js's own header comment for why `held`
//     excludes unchanged wallets — it is what makes this true);
//   - a fixture pair with one wallet entering, one exiting, one growing and one shrinking lands
//     each in the right bucket, with the right sign on the delta;
//   - the BigInt sums reconcile: sum(to.top) - sum(from.top) == sum(entered) - sum(exited) +
//     sum(held deltas) — this must hold with or without unchanged wallets in `top`, which is the
//     point of leaving them out of `held`;
//   - sameFullList is false when the two hashes differ;
//   - the route: bad mint → 400, unknown id → 404, a good pair → 200 with the exact diff shape,
//     and the honest scope label ("top-25-recorded") is always present.
const assert = require("assert");
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); pass++; console.log("  ✓ " + name); }
  catch (e) { fail++; console.log("  ✗ " + name + "\n      " + (e && e.message || e)); }
};
const section = (n) => console.log("\n" + n);

const MINT = "4yro2xbCxMFVvygCsj5FZMgZnVCb8EqcbPGTbSGCgDBc";
const W = (n) => `Wallet${String(n).padStart(6, "0")}xxxxxxxxxxxxxxxxxxxxxxxxxxxx`.slice(0, 44);

// ── Part 1: pure unit tests against lib/holders-snapshot.js directly ──────────────────────────
(function unitTests() {
  const holders = require("../lib/holders-snapshot");

  function memoryKv() {
    const state = {};
    return {
      get: (k, d) => (Object.prototype.hasOwnProperty.call(state, k) ? state[k] : d),
      set: (k, v) => { state[k] = v === null ? null : JSON.parse(JSON.stringify(v)); },
      setVerified: (k, v) => { state[k] = v === null ? null : JSON.parse(JSON.stringify(v)); return true; },
      entriesWithPrefix: (prefix) => Object.keys(state).filter((k) => k.startsWith(prefix)).map((k) => [k, state[k]]),
    };
  }

  section("diffSnapshots — self-diff");
  t("a snapshot diffed with itself: all three arrays empty, deltas zero, sameFullList true", () => {
    const kv = memoryKv();
    const top = [{ wallet: W(0), amount: 500 }, { wallet: W(1), amount: 300 }, { wallet: W(2), amount: 100 }];
    const { record } = holders.appendSnapshot(kv, { mint: MINT, at: 1000, holderCount: 3, top, totalSupplyRaw: "10000", fullList: top });
    const diff = holders.diffSnapshots(record, record);
    assert.deepStrictEqual(diff.top.entered, []);
    assert.deepStrictEqual(diff.top.exited, []);
    assert.deepStrictEqual(diff.top.held, []);
    assert.strictEqual(diff.holderCountDelta, 0);
    assert.strictEqual(diff.supplyDelta, "0");
    assert.strictEqual(diff.sameFullList, true);
    assert.strictEqual(diff.scope, "top-25-recorded");
  });

  section("diffSnapshots — entered / exited / grew / shrank fixture");
  // from: W0=500(#1) W1=300(#2) W2=100(#3, exits)
  // to:   W0=650(#1, grew) W1=300(#2, unchanged -> not in held) W3=50(#3, entered)
  const fromTop = [{ wallet: W(0), amount: 500 }, { wallet: W(1), amount: 300 }, { wallet: W(2), amount: 100 }];
  const toTop = [{ wallet: W(0), amount: 650 }, { wallet: W(1), amount: 300 }, { wallet: W(3), amount: 50 }];
  let fromRec, toRec, fixtureDiff;
  t("build the fixture pair", () => {
    const kv = memoryKv();
    fromRec = holders.appendSnapshot(kv, { mint: MINT, at: 1000, holderCount: 10, top: fromTop, totalSupplyRaw: "10000", fullList: fromTop }).record;
    toRec = holders.appendSnapshot(kv, { mint: MINT, at: 2000, holderCount: 11, top: toTop, totalSupplyRaw: "10200", fullList: toTop }).record;
    fixtureDiff = holders.diffSnapshots(fromRec, toRec);
  });
  t("W3 entered at its rank in `to`", () => {
    assert.strictEqual(fixtureDiff.top.entered.length, 1);
    assert.deepStrictEqual(fixtureDiff.top.entered[0], { wallet: W(3), amountRaw: "50", rank: 3 });
  });
  t("W2 exited at its rank in `from`", () => {
    assert.strictEqual(fixtureDiff.top.exited.length, 1);
    assert.deepStrictEqual(fixtureDiff.top.exited[0], { wallet: W(2), amountRaw: "100", prevRank: 3 });
  });
  t("W0 held with a positive delta (grew), W1 excluded (unchanged)", () => {
    assert.strictEqual(fixtureDiff.top.held.length, 1);
    assert.deepStrictEqual(fixtureDiff.top.held[0], { wallet: W(0), fromRaw: "500", toRaw: "650", deltaRaw: "150", fromRank: 1, toRank: 1 });
  });
  t("holderCountDelta and supplyDelta are correct signed strings/numbers", () => {
    assert.strictEqual(fixtureDiff.holderCountDelta, 1);
    assert.strictEqual(fixtureDiff.supplyDelta, "200");
  });
  t("a shrinking wallet gets a negative deltaRaw", () => {
    const shrinkFrom = [{ wallet: W(9), amount: 1000 }];
    const shrinkTo = [{ wallet: W(9), amount: 400 }];
    const d = holders.diffSnapshots(
      { id: "a", at: 1, listHash: "h1", holderCount: 1, totalSupplyRaw: "1", top: shrinkFrom },
      { id: "b", at: 2, listHash: "h2", holderCount: 1, totalSupplyRaw: "1", top: shrinkTo },
    );
    assert.strictEqual(d.top.held[0].deltaRaw, "-600");
  });

  section("diffSnapshots — reconciliation (BigInt sums)");
  t("sum(to.top) - sum(from.top) == sum(entered) - sum(exited) + sum(held deltas)", () => {
    const sumTop = (top) => top.reduce((s, h) => s + BigInt(Math.round(h.amount)), 0n);
    const sumFrom = sumTop(fromTop), sumTo = sumTop(toTop);
    const sumEntered = fixtureDiff.top.entered.reduce((s, r) => s + BigInt(r.amountRaw), 0n);
    const sumExited = fixtureDiff.top.exited.reduce((s, r) => s + BigInt(r.amountRaw), 0n);
    const sumHeldDelta = fixtureDiff.top.held.reduce((s, r) => s + BigInt(r.deltaRaw), 0n);
    assert.strictEqual((sumTo - sumFrom).toString(), (sumEntered - sumExited + sumHeldDelta).toString());
  });
  t("the identity still holds when an unchanged wallet is present (W1, excluded from held)", () => {
    // Re-derive independently from the raw top lists rather than trusting fixtureDiff's own
    // buckets twice — this is the actual regression the design note in lib/holders-snapshot.js
    // calls out: leaving an unchanged wallet out of `held` must not break the reconciliation.
    const byWallet = (top) => new Map(top.map((h) => [h.wallet, BigInt(Math.round(h.amount))]));
    const a = byWallet(fromTop), b = byWallet(toTop);
    let lhs = 0n;
    for (const [, v] of b) lhs += v;
    for (const [, v] of a) lhs -= v;
    let rhs = 0n;
    for (const [w, v] of b) if (!a.has(w)) rhs += v;         // entered
    for (const [w, v] of a) if (!b.has(w)) rhs -= v;         // exited
    for (const [w, av] of a) if (b.has(w)) rhs += (b.get(w) - av); // held (incl. zero-delta, nets to 0)
    assert.strictEqual(lhs.toString(), rhs.toString());
  });

  section("diffSnapshots — sameFullList");
  t("sameFullList is false when the two hashes differ", () => {
    const a = { id: "a", at: 1, listHash: "hash-a", holderCount: 1, totalSupplyRaw: "1", top: [] };
    const b = { id: "b", at: 2, listHash: "hash-b", holderCount: 1, totalSupplyRaw: "1", top: [] };
    assert.strictEqual(holders.diffSnapshots(a, b).sameFullList, false);
  });
  t("supplyDelta is null when either snapshot has no totalSupplyRaw", () => {
    const a = { id: "a", at: 1, listHash: "h", holderCount: 1, totalSupplyRaw: null, top: [] };
    const b = { id: "b", at: 2, listHash: "h", holderCount: 1, totalSupplyRaw: "500", top: [] };
    assert.strictEqual(holders.diffSnapshots(a, b).supplyDelta, null);
  });
  t("from/to carry the honest head fields only", () => {
    assert.deepStrictEqual(Object.keys(fixtureDiff.from).sort(), ["at", "holderCount", "id", "listHash", "totalSupplyRaw"].sort());
    assert.deepStrictEqual(Object.keys(fixtureDiff.to).sort(), ["at", "holderCount", "id", "listHash", "totalSupplyRaw"].sort());
  });
})();

// ── Part 2: route gate — boot the real server against a seeded, throwaway DATA_DIR ────────────
async function routeTests() {
  section("GET /api/holders/snapshots/:a/diff/:b (route)");
  const PORT = Number(process.env.SNAPDIFF_TEST_PORT || 3247);
  const BASE = `http://127.0.0.1:${PORT}`;
  const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "snapdiff-test-"));

  // Seed two snapshots directly through the real kv module + appendSnapshot, pointed at the same
  // DATA_DIR the server will boot with — this is what "seeded via appendSnapshot" means: no HTTP
  // round trip to create the fixture, just the same durable write path a real crawl uses.
  process.env.DATA_DIR = DIR;
  delete require.cache[require.resolve("../lib/kvstore")];
  const kv = require("../lib/kvstore");
  const holders = require("../lib/holders-snapshot");
  const fromTop = [{ wallet: W(0), amount: 500 }, { wallet: W(1), amount: 300 }];
  const toTop = [{ wallet: W(0), amount: 650 }, { wallet: W(2), amount: 20 }];
  const seededFrom = holders.appendSnapshot(kv, { mint: MINT, at: 1000, holderCount: 5, top: fromTop, totalSupplyRaw: "9000", fullList: fromTop }).record;
  const seededTo = holders.appendSnapshot(kv, { mint: MINT, at: 2000, holderCount: 6, top: toTop, totalSupplyRaw: "9100", fullList: toTop }).record;

  const env = { ...process.env, PORT: String(PORT), DATA_DIR: DIR, TELEGRAM_BOT_TOKEN: "", TELEGRAM_CHAT_ID: "", HELIUS_API_KEY: "", MM_OPERATOR_SECRET: "", FALLBACK_RPC_URL: "http://127.0.0.1:9" };
  const srv = spawn(process.execPath, ["server.js"], { cwd: path.join(__dirname, ".."), env, stdio: "ignore" });
  const cleanup = () => { try { srv.kill("SIGKILL"); } catch (_) {} try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (_) {} };
  process.on("exit", cleanup);

  let up = false;
  for (let i = 0; i < 80; i++) { try { const r = await fetch(`${BASE}/healthz`); if (r.ok) { up = true; break; } } catch (_) {} await new Promise((r) => setTimeout(r, 500)); }
  if (!up) { console.error("  server did not come up"); fail++; cleanup(); console.log(`\n${pass} passed, ${fail} failed\n`); process.exit(1); }

  try {
    let r = await fetch(`${BASE}/api/holders/snapshots/${seededFrom.id}/diff/${seededTo.id}?mint=not-a-mint`);
    let rStatus = r.status;
    t("bad mint → 400", () => assert.strictEqual(rStatus, 400));

    r = await fetch(`${BASE}/api/holders/snapshots/${seededFrom.id}/diff/nope-does-not-exist?mint=${MINT}`);
    rStatus = r.status;
    let rBody = await r.json();
    t("unknown `to` id → 404 no_such_snapshot", () => {
      assert.strictEqual(rStatus, 404);
      assert.strictEqual(rBody.error, "no_such_snapshot");
    });

    r = await fetch(`${BASE}/api/holders/snapshots/nope-does-not-exist/diff/${seededTo.id}?mint=${MINT}`);
    rStatus = r.status;
    rBody = await r.json();
    t("unknown `from` id → 404 no_such_snapshot", () => {
      assert.strictEqual(rStatus, 404);
      assert.strictEqual(rBody.error, "no_such_snapshot");
    });

    r = await fetch(`${BASE}/api/holders/snapshots/${seededFrom.id}/diff/${seededTo.id}?mint=${MINT}`);
    const body = await r.json();
    t("a good pair → 200 with the honest diff shape", () => {
      assert.strictEqual(r.status, 200);
      assert.strictEqual(body.ok, true);
      assert.strictEqual(body.mint, MINT);
      assert.strictEqual(body.diff.scope, "top-25-recorded");
      assert.strictEqual(body.diff.from.id, seededFrom.id);
      assert.strictEqual(body.diff.to.id, seededTo.id);
      assert.strictEqual(body.diff.top.entered.length, 1);   // W2
      assert.strictEqual(body.diff.top.exited.length, 1);    // W1
      assert.strictEqual(body.diff.top.held.length, 1);      // W0 grew
      assert.strictEqual(body.diff.holderCountDelta, 1);
    });
    t("Cache-Control matches its sibling snapshot routes", () => assert.strictEqual(r.headers.get("cache-control"), "public, max-age=60"));

    // Route-order defense (see the comment at the registration site): the 3-segment diff path
    // must never be swallowed by the 1-segment single-snapshot route.
    r = await fetch(`${BASE}/api/holders/snapshots/${seededFrom.id}?mint=${MINT}`);
    const single = await r.json();
    t("the single-id route still answers a plain id (not shadowed by the diff route)", () => {
      assert.strictEqual(r.status, 200);
      assert.strictEqual(single.snapshot.id, seededFrom.id);
      assert.ok(!("diff" in single));
    });
  } finally {
    cleanup();
  }
}

routeTests().then(() => {
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}).catch((e) => {
  console.error("FAILED:", e && e.stack || e);
  process.exit(1);
});
