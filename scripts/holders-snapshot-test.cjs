#!/usr/bin/env node
"use strict";
// Unit gate for lib/holders-snapshot.js (Colosseum roadmap §8 X7). What must hold:
//   - append-only: a second run for the same mint ADDS a record, never edits an earlier one;
//   - the 90-cap drops the OLDEST snapshot first, and only once the cap is exceeded;
//   - the hash recomputes from a holder list and changes on a one-unit change to that list;
//   - the dated series carries counts and hashes, never wallets or a top list;
//   - the Hub project view's holders fact line appears only when a snapshot exists.
const assert = require("assert");
const holders = require("../lib/holders-snapshot");
const pub = require("../lib/hub/public");

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); pass++; console.log("  ✓ " + name); }
  catch (e) { fail++; console.log("  ✗ " + name + "\n      " + (e && e.message || e)); }
};
const section = (n) => console.log("\n" + n);

// A throwaway in-memory kv with the exact four-method surface lib/kvstore.js exports that this
// module actually uses — get/set/setVerified/entriesWithPrefix. `setVerified` mirrors the real
// store's contract (write, then read back and confirm) so a bug in appendSnapshot's use of it
// would show up here the same way it would against the real file-backed store.
function memoryKv() {
  const state = {};
  return {
    get: (k, d) => (Object.prototype.hasOwnProperty.call(state, k) ? state[k] : d),
    set: (k, v) => { state[k] = v === null ? null : JSON.parse(JSON.stringify(v)); },
    setVerified: (k, v) => { state[k] = v === null ? null : JSON.parse(JSON.stringify(v)); return true; },
    entriesWithPrefix: (prefix) => Object.keys(state).filter((k) => k.startsWith(prefix)).map((k) => [k, state[k]]),
  };
}

const MINT = "4yro2xbCxMFVvygCsj5FZMgZnVCb8EqcbPGTbSGCgDBc";
const W = (n) => `Wallet${String(n).padStart(6, "0")}xxxxxxxxxxxxxxxxxxxxxxxxxxxx`.slice(0, 44);
function fullList(n, base = 1000) {
  const out = [];
  for (let i = 0; i < n; i++) out.push({ wallet: W(i), amount: base - i });
  return out;
}

section("computeListHash / canonicalHolderList");

t("the hash is the same regardless of input order", () => {
  const list = fullList(20);
  const shuffled = [...list].reverse();
  assert.strictEqual(holders.computeListHash(list), holders.computeListHash(shuffled));
});

t("changing one wallet's amount by one unit changes the hash", () => {
  const list = fullList(20);
  const h1 = holders.computeListHash(list);
  const bumped = list.map((h, i) => (i === 5 ? { ...h, amount: h.amount + 1 } : h));
  const h2 = holders.computeListHash(bumped);
  assert.notStrictEqual(h1, h2);
});

t("accepts {wallet,balance} rows the same as {wallet,amount}", () => {
  const asAmount = [{ wallet: W(0), amount: 42 }];
  const asBalance = [{ wallet: W(0), balance: 42 }];
  assert.strictEqual(holders.computeListHash(asAmount), holders.computeListHash(asBalance));
});

section("appendSnapshot — append-only");

t("a second run for the same mint ADDS a record, never edits the first", () => {
  const kv = memoryKv();
  const r1 = holders.appendSnapshot(kv, { mint: MINT, at: 1000, holderCount: 10, top: fullList(5), totalSupplyRaw: "1000000", fullList: fullList(10) });
  const r2 = holders.appendSnapshot(kv, { mint: MINT, at: 2000, holderCount: 12, top: fullList(5), totalSupplyRaw: "1000000", fullList: fullList(12) });
  assert.ok(r1.ok && r2.ok, "both writes verify");
  assert.notStrictEqual(r1.record.id, r2.record.id, "distinct ids");
  const series = holders.series(kv, MINT);
  assert.strictEqual(series.length, 2, "both records are present");
  assert.strictEqual(series[0].holderCount, 10, "the first record is unchanged");
  assert.strictEqual(series[1].holderCount, 12);
  // The first record's own fields, read back by id, are exactly what was written — not merged
  // or overwritten by the second append.
  const snap1 = holders.getSnapshot(kv, MINT, r1.record.id);
  assert.strictEqual(snap1.holderCount, 10);
  assert.strictEqual(snap1.listHash, r1.record.listHash);
});

t("snapshots for two different mints never collide", () => {
  const kv = memoryKv();
  holders.appendSnapshot(kv, { mint: MINT, at: 1000, holderCount: 1, top: [], totalSupplyRaw: "1", fullList: fullList(1) });
  const otherMint = "RoSeiVjW5H48ucPAJh1LJGBBzPpqvsokfDGpgHXDtdF";
  holders.appendSnapshot(kv, { mint: otherMint, at: 1000, holderCount: 2, top: [], totalSupplyRaw: "1", fullList: fullList(2) });
  assert.strictEqual(holders.series(kv, MINT).length, 1);
  assert.strictEqual(holders.series(kv, otherMint).length, 1);
});

section("the 90-snapshot cap");

t("the cap is not exceeded, and the oldest is the one dropped", () => {
  const kv = memoryKv();
  const total = holders.KEEP + 5;
  for (let i = 0; i < total; i++) {
    holders.appendSnapshot(kv, { mint: MINT, at: 1000 + i, holderCount: i, top: [], totalSupplyRaw: "1", fullList: fullList(1) });
  }
  const series = holders.series(kv, MINT);
  assert.strictEqual(series.length, holders.KEEP, `kept exactly ${holders.KEEP}`);
  // Oldest-first order (readAll sorts by `at`): the surviving window is the newest KEEP.
  assert.strictEqual(series[0].holderCount, total - holders.KEEP, "the oldest surviving record is the (total-KEEP)th one");
  assert.strictEqual(series[series.length - 1].holderCount, total - 1, "the newest record is still there");
});

t("staying at or under the cap never drops anything", () => {
  const kv = memoryKv();
  for (let i = 0; i < holders.KEEP; i++) {
    holders.appendSnapshot(kv, { mint: MINT, at: 1000 + i, holderCount: i, top: [], totalSupplyRaw: "1", fullList: fullList(1) });
  }
  assert.strictEqual(holders.series(kv, MINT).length, holders.KEEP);
});

section("public read shapes");

t("the series carries no wallets or top list", () => {
  const kv = memoryKv();
  holders.appendSnapshot(kv, { mint: MINT, at: 1000, holderCount: 3, top: fullList(3), totalSupplyRaw: "1", fullList: fullList(3) });
  const series = holders.series(kv, MINT);
  const json = JSON.stringify(series);
  assert.deepStrictEqual(Object.keys(series[0]).sort(), ["at", "holderCount", "id", "listHash"].sort());
  assert.ok(!json.includes(W(0)), "no wallet address anywhere in the series body");
});

t("a single snapshot carries its capped top list", () => {
  const kv = memoryKv();
  const { record } = holders.appendSnapshot(kv, { mint: MINT, at: 1000, holderCount: 30, top: fullList(30), totalSupplyRaw: "1", fullList: fullList(30) });
  const snap = holders.getSnapshot(kv, MINT, record.id);
  assert.ok(snap.top.length <= 25, "top is capped at 25 even when more were passed in");
  assert.ok(snap.top.every((h) => typeof h.wallet === "string" && typeof h.amount === "number"));
});

t("getSnapshot answers null for an unknown id, and latest() answers null for an uncrawled mint", () => {
  const kv = memoryKv();
  assert.strictEqual(holders.getSnapshot(kv, MINT, "nope"), null);
  assert.strictEqual(holders.latest(kv, MINT), null);
});

t("latest() is the newest record, public fields only", () => {
  const kv = memoryKv();
  holders.appendSnapshot(kv, { mint: MINT, at: 1000, holderCount: 10, top: [], totalSupplyRaw: "1", fullList: fullList(10) });
  holders.appendSnapshot(kv, { mint: MINT, at: 2000, holderCount: 20, top: [], totalSupplyRaw: "1", fullList: fullList(20) });
  const l = holders.latest(kv, MINT);
  assert.strictEqual(l.holderCount, 20);
  assert.deepStrictEqual(Object.keys(l).sort(), ["at", "holderCount", "id", "listHash"].sort());
});

section("Hub project page fact line");

t("projectView carries no `holders` fact when no snapshot was passed", () => {
  const v = pub.projectView({ project: { id: "cuna", label: "CUNA", symbol: "CUNA", mint: MINT, decimals: 9 } });
  assert.strictEqual(v.holders, null);
});

t("projectView carries the fact line's four fields, and nothing else, when a snapshot exists", () => {
  const kv = memoryKv();
  const { record } = holders.appendSnapshot(kv, { mint: MINT, at: 1700000000000, holderCount: 421, top: fullList(25), totalSupplyRaw: "999", fullList: fullList(421) });
  const snap = holders.latest(kv, MINT);
  const v = pub.projectView({ project: { id: "cuna", label: "CUNA", symbol: "CUNA", mint: MINT, decimals: 9 }, holderSnapshot: snap });
  assert.ok(v.holders, "the fact line is present");
  assert.strictEqual(v.holders.holderCount, 421);
  assert.strictEqual(v.holders.id, record.id);
  assert.strictEqual(v.holders.listHash, record.listHash);
  assert.deepStrictEqual(Object.keys(v.holders).sort(), ["at", "holderCount", "id", "listHash"].sort(), "never a top list or a wallet on the Hub's public view");
});

section("recompute (the reader-side check)");

t("computeListHash on the exact list a snapshot was taken over matches its published listHash", () => {
  const kv = memoryKv();
  const list = fullList(50);
  const { record } = holders.appendSnapshot(kv, { mint: MINT, at: 1000, holderCount: 50, top: list.slice(0, 25), totalSupplyRaw: "1", fullList: list });
  assert.strictEqual(holders.computeListHash(list), record.listHash);
  const tampered = list.map((h, i) => (i === 0 ? { ...h, amount: h.amount + 1 } : h));
  assert.notStrictEqual(holders.computeListHash(tampered), record.listHash);
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
