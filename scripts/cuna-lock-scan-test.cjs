"use strict";
// Tests for lib/cuna-lock-scan.js — the ledger that decides what "firstSeenAt" means.
//
// Every case here is a way to move firstSeenAt. Moving it EARLIER lengthens the horizon the
// qualification rules measure, so it is the one number in this system worth attacking.

const assert = require("assert");
const scan = require("../lib/cuna-lock-scan");
const s = require("../lib/cuna-staking");

let pass = 0, fail = 0;
const queue = [];
function t(n, f) { queue.push([n, f]); }
function section(n) { queue.push([n, null]); }

const DAY = 86400;
const NOW = 1_800_000_000;

const acct = (over = {}) => ({
  recipient: "Alice", tokenMint: "CUNA", creator: "Creator", cancelMode: 0, cancelledAt: 0,
  vestingStartTime: NOW, cliffTime: NOW + 180 * DAY, frequency: DAY, numberOfPeriod: 185,
  cliffUnlockAmount: 0n, amountPerPeriod: 1000n, totalClaimedAmount: 0n, ...over,
});

section("the memcmp offset");

t("token_mint sits at byte 40 — 8 discriminator + 32 recipient", () => {
  // Wrong by even one byte and the scan matches nothing: zero locks found, everybody silently
  // stops earning, and nothing errors.
  assert.strictEqual(scan.TOKEN_MINT_OFFSET, 8 + 32);
});

section("firstSeenAt is write-once");

t("a new lock gets today's date", () => {
  const r = scan.mergeLedger({ scanned: [{ escrow: "E1", account: acct() }], ledger: {}, nowUnix: NOW });
  assert.strictEqual(r.locks[0].firstSeenAt, NOW);
  assert.deepStrictEqual(r.added, ["E1"]);
});

t("RE-SCANNING NEVER MOVES IT — not later, not earlier", () => {
  const scanned = [{ escrow: "E1", account: acct() }];
  let led = scan.mergeLedger({ scanned, ledger: {}, nowUnix: NOW }).ledger;
  for (const later of [NOW + DAY, NOW + 400 * DAY, NOW - 900 * DAY]) {
    const r = scan.mergeLedger({ scanned, ledger: led, nowUnix: later });
    assert.strictEqual(r.locks[0].firstSeenAt, NOW, `scan at ${later} moved it`);
    assert.deepStrictEqual(r.reset, []);
    led = r.ledger;
  }
});

t("the input ledger is not mutated", () => {
  const before = {};
  scan.mergeLedger({ scanned: [{ escrow: "E1", account: acct() }], ledger: before, nowUnix: NOW });
  assert.deepStrictEqual(before, {}, "mergeLedger wrote through to the caller's ledger");
});

t("a bad clock is refused rather than written into the ledger", () => {
  for (const bad of [0, -1, NaN, null, undefined, "soon"]) {
    assert.throws(() => scan.mergeLedger({ scanned: [], ledger: {}, nowUnix: bad }), /nowUnix/);
  }
});

section("PDA reuse — closing a lock and rebuilding at the same address");

t("THE ONE THAT MATTERS: different terms at the same address start a NEW clock", () => {
  // An escrow address is a PDA from a creator-chosen `base`, so the same address can be reused.
  // Inheriting the old firstSeenAt would let a throwaway lock buy horizon for a short one.
  const ledger = scan.mergeLedger({
    scanned: [{ escrow: "E1", account: acct({ cliffTime: NOW + 10 * DAY, numberOfPeriod: 5 }) }],
    ledger: {}, nowUnix: NOW,
  }).ledger;

  const muchLater = NOW + 300 * DAY;
  const r = scan.mergeLedger({
    scanned: [{ escrow: "E1", account: acct({ cliffTime: muchLater + 200 * DAY, numberOfPeriod: 200 }) }],
    ledger, nowUnix: muchLater,
  });
  assert.strictEqual(r.locks[0].firstSeenAt, muchLater, "the rebuilt lock inherited the old clock");
  assert.deepStrictEqual(r.reset, ["E1"]);
});

t("the attack fails end to end: a rebuilt short lock does not qualify", () => {
  const CFG = { mint: "CUNA", minDurationDays: 90 };
  const ledger = scan.mergeLedger({
    scanned: [{ escrow: "E1", account: acct({ cliffTime: NOW + DAY, numberOfPeriod: 2 }) }],
    ledger: {}, nowUnix: NOW,
  }).ledger;
  // A year on, rebuild at the same address with only 60 days to run. Against a stale firstSeenAt
  // of NOW its horizon would read as 425 days and sail through the 90-day minimum.
  const later = NOW + 365 * DAY;
  const r = scan.mergeLedger({
    scanned: [{ escrow: "E1", account: acct({ cliffTime: later + 10 * DAY, numberOfPeriod: 50 }) }],
    ledger, nowUnix: later,
  });
  assert.strictEqual(Math.round((r.locks[0].fullyVestedAt - later) / DAY), 60, "fixture should be a 60-day lock");
  const why = s.disqualify(r.locks[0], CFG);
  assert.ok(why.some((rr) => /no tokens locked for 90 days or more/.test(rr)), why.join("; "));
});

t("every immutable term is part of the fingerprint", () => {
  const base = scan.fingerprintOf(acct());
  const changes = {
    tokenMint: "OTHER", creator: "Someone", cliffTime: NOW + 181 * DAY, frequency: DAY * 2,
    numberOfPeriod: 186, cliffUnlockAmount: 1n, amountPerPeriod: 1001n,
  };
  for (const [k, v] of Object.entries(changes)) {
    assert.notStrictEqual(scan.fingerprintOf(acct({ [k]: v })), base, `${k} is not fingerprinted`);
  }
});

t("fields that legitimately move are NOT fingerprinted — claiming must not reset your clock", () => {
  const base = scan.fingerprintOf(acct());
  for (const k of ["totalClaimedAmount", "cancelledAt", "vestingStartTime", "recipient"]) {
    assert.strictEqual(scan.fingerprintOf(acct({ [k]: 999 })), base, `${k} resets firstSeenAt`);
  }
});

section("locks that come and go");

t("a lock missing from a scan is reported, not deleted", () => {
  // An escrow can drop out of an RPC index for a moment — that already stalled the liquidity
  // vault once. Deleting the entry would restart the clock in the holder's favour.
  const ledger = scan.mergeLedger({
    scanned: [{ escrow: "E1", account: acct() }, { escrow: "E2", account: acct() }],
    ledger: {}, nowUnix: NOW,
  }).ledger;
  const r = scan.mergeLedger({ scanned: [{ escrow: "E1", account: acct() }], ledger, nowUnix: NOW + DAY });
  assert.deepStrictEqual(r.vanished, ["E2"]);
  assert.strictEqual(r.ledger.E2.firstSeenAt, NOW, "the vanished lock lost its clock");
  assert.strictEqual(r.locks.length, 1, "a vanished lock must not be handed to accrual");
});

t("a lock that comes back keeps its original clock", () => {
  const scanned = [{ escrow: "E1", account: acct() }];
  let led = scan.mergeLedger({ scanned, ledger: {}, nowUnix: NOW }).ledger;
  led = scan.mergeLedger({ scanned: [], ledger: led, nowUnix: NOW + DAY }).ledger;
  const back = scan.mergeLedger({ scanned, ledger: led, nowUnix: NOW + 2 * DAY });
  assert.strictEqual(back.locks[0].firstSeenAt, NOW);
});

section("normalization through the scanner");

t("scanned locks arrive ready for the rules, with anchor types unwrapped", () => {
  const pk = (k) => ({ toBase58: () => k });
  const bn = (n) => ({ toString: () => String(n) });
  const r = scan.mergeLedger({
    scanned: [{ escrow: pk("E1"), account: {
      recipient: pk("Alice"), tokenMint: pk("CUNA"), creator: pk("Creator"),
      cancelMode: 0, cancelledAt: bn(0), vestingStartTime: bn(NOW), cliffTime: bn(NOW + 180 * DAY),
      frequency: bn(DAY), numberOfPeriod: bn(185), cliffUnlockAmount: bn(500),
      amountPerPeriod: bn(1000), totalClaimedAmount: bn(200),
    } }], ledger: {}, nowUnix: NOW,
  });
  const l = r.locks[0];
  assert.strictEqual(l.escrow, "E1");
  assert.strictEqual(l.recipient, "Alice");
  assert.strictEqual(l.totalRaw, "185500");
  assert.strictEqual(l.atRiskRaw, "185300");
  assert.deepStrictEqual(s.disqualify(l, { mint: "CUNA", minDurationDays: 90 }), []);
});

section("Rule B — keeping the treasury out of its own pool");

t("an excluded wallet cannot escape by reassigning the recipient", () => {
  // update_recipient_mode means a recipient is not fixed. Excluding only by recipient would let
  // the treasury point a lock at a fresh address and collect.
  const CFG = { mint: "CUNA", minDurationDays: 90, excludeWallets: ["Treasury"] };
  const moved = scan.mergeLedger({
    scanned: [{ escrow: "T", account: acct({ recipient: "FreshWallet", creator: "Treasury" }) }],
    ledger: {}, nowUnix: NOW,
  }).locks[0];
  const why = s.disqualify(moved, CFG);
  assert.ok(why.some((r) => /created by an excluded wallet/.test(r)), why.join("; "));
});

section("backdating — crediting a lock from the day it was actually made");

t("a new lock is credited from its on-chain creation, not from when we looked", () => {
  const acc = acct({ cliffTime: NOW + 200 * DAY });
  const r = scan.mergeLedger({
    scanned: [{ escrow: "E1", account: acc }], ledger: {}, nowUnix: NOW,
    createdAt: { E1: NOW - 14 * DAY },
  });
  assert.strictEqual(r.ledger.E1.firstSeenAt, NOW - 14 * DAY, "the early locker was not credited");
  assert.strictEqual(r.ledger.E1.backdated, true);
  assert.strictEqual(r.locks[0].firstSeenAt, NOW - 14 * DAY, "the lock handed to the rules is not backdated");
});

t("THE ONE THAT MATTERS: a reset is NEVER backdated", () => {
  // Same address, different terms = a rebuilt lock. Handing it the original account's creation
  // date would restore the exact PDA-reuse hole the fingerprint exists to close: index a throwaway
  // lock, close it, rebuild something short at the same address and have it read as long.
  const first = acct({ cliffTime: NOW + 200 * DAY });
  const a = scan.mergeLedger({ scanned: [{ escrow: "E1", account: first }], ledger: {}, nowUnix: NOW - 100 * DAY,
    createdAt: { E1: NOW - 400 * DAY } });
  const rebuilt = acct({ cliffTime: NOW + 30 * DAY });
  const b = scan.mergeLedger({ scanned: [{ escrow: "E1", account: rebuilt }], ledger: a.ledger, nowUnix: NOW,
    createdAt: { E1: NOW - 400 * DAY } });
  assert.deepStrictEqual(b.reset, ["E1"]);
  assert.strictEqual(b.ledger.E1.firstSeenAt, NOW, "a rebuilt lock inherited an older clock");
  assert.ok(!b.ledger.E1.backdated);
});

t("an unknown, zero, or future creation time falls back to now — the strict direction", () => {
  const acc = acct({ cliffTime: NOW + 200 * DAY });
  for (const bad of [undefined, 0, null, NaN, "nonsense", NOW + 5 * DAY, -1]) {
    const r = scan.mergeLedger({ scanned: [{ escrow: "E1", account: acc }], ledger: {}, nowUnix: NOW,
      createdAt: { E1: bad } });
    assert.strictEqual(r.ledger.E1.firstSeenAt, NOW, `createdAt=${String(bad)} moved the clock`);
  }
});

t("backdating never touches a lock the ledger already knows", () => {
  // firstSeenAt stays write-once. A later scan supplying a creation date must not move a stamp
  // that already exists, in either direction.
  const acc = acct({ cliffTime: NOW + 200 * DAY });
  const a = scan.mergeLedger({ scanned: [{ escrow: "E1", account: acc }], ledger: {}, nowUnix: NOW });
  const b = scan.mergeLedger({ scanned: [{ escrow: "E1", account: acc }], ledger: a.ledger, nowUnix: NOW + DAY,
    createdAt: { E1: NOW - 400 * DAY } });
  assert.strictEqual(b.ledger.E1.firstSeenAt, NOW);
  assert.deepStrictEqual(b.added, []);
});

section("creation lookup — only a walk that reached the first signature counts");

t("a lookup that runs out of pages is OMITTED, not reported as the 5,000th-newest signature", async () => {
  // Five full pages, all newer than the true creation. The old loop fell out and used the last
  // one it saw — a confidently wrong, too-late time that ~$5 of memo spam can manufacture.
  const page = Array.from({ length: 1000 }, (_, i) => ({ signature: "s" + i, blockTime: 1_800_000_000 - i }));
  const conn = { getSignaturesForAddress: async () => page };
  // a REAL pubkey string: "E1" would make new PublicKey() throw and pass this test for the wrong reason
  const ESC = "11111111111111111111111111111111";
  const out = await scan.creationTimes(conn, [ESC], { maxPages: 5, pageSize: 1000 });
  assert.deepStrictEqual(out, {}, "a truncated walk must not produce a time");
  // a short walk (fewer than a page) IS the creation
  const conn2 = { getSignaturesForAddress: async () => page.slice(0, 3) };
  const out2 = await scan.creationTimes(conn2, [ESC]);
  assert.strictEqual(out2[ESC], 1_800_000_000 - 2, "a short walk is the creation");
});

t("backdating is BOUNDED: never past the cap, never before the token existed", () => {
  const acc = acct({ cliffTime: NOW + 200 * DAY });
  // a reused address whose oldest signature is 400 days old gets at most the cap
  const r = scan.mergeLedger({ scanned: [{ escrow: "E1", account: acc }], ledger: {}, nowUnix: NOW,
    createdAt: { E1: NOW - 400 * DAY }, backdateCapDays: 30, notBefore: 0 });
  assert.strictEqual(r.ledger.E1.firstSeenAt, NOW - 30 * DAY);
  // and never before notBefore even inside the cap
  const r2 = scan.mergeLedger({ scanned: [{ escrow: "E1", account: acc }], ledger: {}, nowUnix: NOW,
    createdAt: { E1: NOW - 20 * DAY }, backdateCapDays: 30, notBefore: NOW - 10 * DAY });
  assert.strictEqual(r2.ledger.E1.firstSeenAt, NOW - 10 * DAY);
  // a genuine early locker inside both bounds is credited exactly
  const r3 = scan.mergeLedger({ scanned: [{ escrow: "E1", account: acc }], ledger: {}, nowUnix: NOW,
    createdAt: { E1: NOW - 5 * DAY }, backdateCapDays: 30, notBefore: NOW - 10 * DAY });
  assert.strictEqual(r3.ledger.E1.firstSeenAt, NOW - 5 * DAY);
});

(async () => {
  for (const [n, f] of queue) {
    if (!f) { console.log("\n" + n); continue; }
    try { await f(); console.log("  ✓ " + n); pass++; }
    catch (e) { console.log("  ✗ " + n + "\n      " + e.message); fail++; }
  }
  console.log(`\n${fail === 0 ? "all passed" : fail + " FAILED"} (${pass} passed)`);
  process.exit(fail ? 1 : 0);
})();
