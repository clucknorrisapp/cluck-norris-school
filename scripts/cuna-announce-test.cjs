"use strict";
// Lock announcements: a PUBLIC post built from chain data. These pin the three things that keep
// it safe — nothing free-form from the chain reaches the text, only qualifying locks are posted,
// and it cannot be made to spam.

const assert = require("assert");
const ann = require("../lib/cuna-announce");
const s = require("../lib/cuna-staking");

let pass = 0, fail = 0;
const queue = [];
function t(n, f) { queue.push([n, f]); }

const DAY = 86400;
const NOW = 1_800_000_000;
const CFG = { mint: "CUNA", minDurationDays: 90, maxTermDays: 540, minLockRaw: "69000000000000", excludeWallets: ["TREAS"] };
const bn = (n) => ({ toString: () => String(n) });
const mk = (escrow, { who = "5WUjHiUVxmUuBnYZx3b5SyFiR7vW2N19VUhgCr2ZRZQ", days = 365, amount = "431359000000000", seen = NOW } = {}) =>
  s.normalizeEscrow(escrow, {
    recipient: who, tokenMint: "CUNA", creator: who, cancelMode: 0, cancelledAt: 0,
    vestingStartTime: bn(seen), cliffTime: bn(seen + days * DAY), frequency: bn(DAY), numberOfPeriod: bn(1),
    cliffUnlockAmount: bn(amount), amountPerPeriod: bn(0), totalClaimedAmount: bn(0),
  }, seen);

t("a new qualifying lock is announced with amount, date, short wallet and multiplier", () => {
  const l = mk("E1");
  const out = ann.pickAnnouncements({ added: ["E1"], locks: [l], cfg: CFG, staking: s, nowUnix: NOW, ledger: {}, url: "https://staking.cunatoken.com" });
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].escrow, "E1");
  assert.ok(/431,359 CUNA/.test(out[0].text), out[0].text);
  assert.ok(/5WUj…ZRZQ/.test(out[0].text), "wallet must be shortened, never the full address");
  assert.ok(/4\.06× the entry rate|4\.05× the entry rate/.test(out[0].text), out[0].text);
  assert.ok(/12 months/.test(out[0].text));
  assert.ok(/https:\/\/staking\.cunatoken\.com/.test(out[0].text));
});

t("NOTHING FREE-FORM FROM THE CHAIN reaches the text — only numbers, dates and a short address", () => {
  // The escrow metadata name is creator-set and could be anything; it is not even an input here.
  const l = mk("E1");
  l.name = "<script>alert(1)</script> CUNA TEAM OFFICIAL";
  const out = ann.pickAnnouncements({ added: ["E1"], locks: [l], cfg: CFG, staking: s, nowUnix: NOW, ledger: {} });
  assert.ok(!/script|OFFICIAL|TEAM/.test(out[0].text), out[0].text);
  // and the address itself is escaped/shortened even if it were hostile
  const hostile = mk("E2", { who: "<b>x</b>" + "A".repeat(40) });
  const out2 = ann.pickAnnouncements({ added: ["E2"], locks: [hostile], cfg: CFG, staking: s, nowUnix: NOW, ledger: {} });
  // the heading carries our OWN <b>; the wallet line must carry the escaped form, never a raw tag
  const walletLine = out2[0].text.split("\n").find((x) => /^Wallet /.test(x));
  assert.ok(/^Wallet &lt;b&gt;/.test(walletLine), "raw HTML in an address must be escaped: " + walletLine);
});

t("locks that do not qualify are NOT announced (dust, short, excluded)", () => {
  const dust = mk("D", { amount: "1000000000" });                 // 1 CUNA
  const short = mk("S", { days: 30 });
  const treasury = mk("T", { who: "TREAS" });
  const out = ann.pickAnnouncements({ added: ["D", "S", "T"], locks: [dust, short, treasury], cfg: CFG, staking: s, nowUnix: NOW, ledger: {} });
  assert.deepStrictEqual(out, []);
});

t("a lock the ledger already announced is never announced again (restart-safe)", () => {
  const l = mk("E1");
  const out = ann.pickAnnouncements({ added: ["E1"], locks: [l], cfg: CFG, staking: s, nowUnix: NOW, ledger: { E1: { announcedAt: NOW - 100 } } });
  assert.deepStrictEqual(out, []);
});

t("THE ONE THAT MATTERS: the hourly cap holds — a burst of locks cannot spam the room", () => {
  const locks = Array.from({ length: 40 }, (_, i) => mk("E" + i, { who: "W" + String(i).padStart(43, "x") }));
  const added = locks.map((l) => l.escrow);
  const out = ann.pickAnnouncements({ added, locks, cfg: CFG, staking: s, nowUnix: NOW, ledger: {}, maxPerHour: 10, recentAnnounced: 3 });
  assert.strictEqual(out.length, 7, "10 per hour minus 3 already posted this hour");
  const none = ann.pickAnnouncements({ added, locks, cfg: CFG, staking: s, nowUnix: NOW, ledger: {}, maxPerHour: 10, recentAnnounced: 10 });
  assert.deepStrictEqual(none, []);
});

t("an escrow in `added` that is not in the scan is skipped, not thrown on", () => {
  const out = ann.pickAnnouncements({ added: ["GHOST"], locks: [], cfg: CFG, staking: s, nowUnix: NOW, ledger: {} });
  assert.deepStrictEqual(out, []);
});

t("a multi-release lock says EARNING ON X OF Y, never a fractional multiplier", () => {
  // Shaped like the real 50M lock: cliff today releasing 0, then 6 monthly tranches. The first
  // two tranches are under 90 days and earn nothing; the text must say what earns of what.
  const per = 8_333_333n * 10n ** 9n;
  const l = s.normalizeEscrow("DRIP", {
    recipient: "6A5uicTYmdVerq5JDKcb3XC9J8sv5F7zMKGqBBYXcnrh", tokenMint: "CUNA", creator: "x", cancelMode: 0, cancelledAt: 0,
    vestingStartTime: bn(NOW), cliffTime: bn(NOW), frequency: bn(30 * DAY), numberOfPeriod: bn(6),
    cliffUnlockAmount: bn(0), amountPerPeriod: bn(per), totalClaimedAmount: bn(0),
  }, NOW);
  const out = ann.pickAnnouncements({ added: ["DRIP"], locks: [l], cfg: CFG, staking: s, nowUnix: NOW, ledger: {} });
  assert.strictEqual(out.length, 1);
  assert.ok(/earning lock-to-earn rewards on 33,333,332 of 49,999,998 CUNA/.test(out[0].text), out[0].text);
  assert.ok(!/× the entry rate/.test(out[0].text), "no multiplier on a multi-release lock");
  // a drip whose every tranche is 90+ days out: "on all N"
  const all = s.normalizeEscrow("ALL", {
    recipient: "AZHiexsgs5XvzSvfqmGwsQ3dhU5FFTXaqNCEy3BVknX1", tokenMint: "CUNA", creator: "y", cancelMode: 0, cancelledAt: 0,
    vestingStartTime: bn(NOW), cliffTime: bn(NOW + 200 * DAY), frequency: bn(30 * DAY), numberOfPeriod: bn(8),
    cliffUnlockAmount: bn(126_000_000n * 10n ** 9n), amountPerPeriod: bn(12_500_000n * 10n ** 9n), totalClaimedAmount: bn(0),
  }, NOW);
  const out2 = ann.pickAnnouncements({ added: ["ALL"], locks: [all], cfg: CFG, staking: s, nowUnix: NOW, ledger: {} });
  assert.ok(/earning lock-to-earn rewards on all 226,000,000 CUNA/.test(out2[0].text), out2[0].text);
  // and a single-cliff lock keeps its clean tier multiplier
  const single = mk("S1", { days: 180 });
  const out3 = ann.pickAnnouncements({ added: ["S1"], locks: [single], cfg: CFG, staking: s, nowUnix: NOW, ledger: {} });
  assert.ok(/at 2× the entry rate/.test(out3[0].text), out3[0].text);
});

(async () => {
  for (const [n, f] of queue) {
    try { await f(); console.log("  ✓ " + n); pass++; }
    catch (e) { console.log("  ✗ " + n + "\n      " + e.message); fail++; }
  }
  console.log(`\n${fail === 0 ? "all passed" : fail + " FAILED"} (${pass} passed)`);
  process.exit(fail ? 1 : 0);
})();
