"use strict";
// The programme itself: whether it is running, on what terms, and what it has already paid.
//
// ARMED IS OFF UNTIL THE OWNER SAYS OTHERWISE (owner, 2026-09-05: "no one earns until I make the
// announcements"). Disarmed is not a quiet no-op — accrual refuses, the ledger is not written, and
// nothing is claimable. Every entry point here fails closed, so forgetting to check the flag
// cannot start the emission by accident.
//
// Why the ledger stays shut until arming, rather than indexing quietly in the meantime: terms are
// measured forward from firstSeenAt. Index a lock three weeks before launch and it carries a
// timestamp from before the programme existed, which the launch cutoff then rejects. Holding the
// ledger closed means every lock that predates the announcement is first seen ON announcement day,
// which is the model the owner was shown. Scans before arming are PREVIEW ONLY and write nothing.
//
// Pure module. State is passed in and returned; the caller persists it.

const DAY = 86400;

const DEFAULTS = {
  mint: "4yro2xbCxMFVvygCsj5FZMgZnVCb8EqcbPGTbSGCgDBc",       // CUNA
  // 345,000 CUNA/day, flat (owner, 2026-09-05: 5%, "make it a nice round number"). Exactly half
  // the 690,000 daily burn — so "two burned for every one earned" is literally true — and 5x the
  // 69,000 minimum lock. About 5.2% of today's stream; a percentage would give 331,643, which
  // reads as arithmetic rather than a decision.
  //
  // Direction matters: raising this is a gift to everyone already locked, cutting it takes back
  // something people committed on the strength of. Starting low is the reversible choice.
  poolDailyRaw: "345000000000000",
  // Used only if poolDailyRaw is cleared. Kept so the percentage mode stays available.
  sharePct: 5,
  // The pool is never more than this share of what actually unlocked today — the guarantee that
  // it can never become unfundable, which a flat number alone would lose as the schedules finish.
  maxSharePct: 25,
  // 3 months (owner, 2026-09-05, down from 365): "we may need to have terms down to even 3 months
  // or no one will lock on their own as this is a meme project." The 3/6/9/12/15/18 month ladder
  // the page offers needs no separate tier table — weight is amount x the committed term, and the
  // tiers are exact 90-day steps, so they already pay exactly 1x to 6x per token.
  minDurationDays: 90,
  // The top of the ladder, and the CEILING on what any term can earn. 18 months = 6x is what the
  // page advertises; without this a lock built straight on Jupiter with a five-year term would
  // earn 20x, a rate we do not offer (owner, 2026-09-05: "max to qualify for reward is 18 months,
  // make it longer than that there is no benefit"). Locking longer is allowed and costs nothing —
  // it simply earns the top-tier rate. Raising this raises the maximum multiplier, so the page's
  // ladder has to move with it.
  maxTermDays: 540,
  // Dust floor, not a wealth gate. Every lock is a permanent ledger row and a line in every chain
  // scan; at a 3-month minimum, spamming them is cheap. 100k CUNA is a rounding error to a real
  // participant. Set by me, not the owner — change it freely.
  // 69,000 CUNA — about $1.60 at today's price (owner, 2026-09-05: "its catchy lol"). A dust
  // floor, not a wealth gate: every lock is a permanent ledger row and a line in every chain scan,
  // and at a 3-month minimum spamming them is cheap. Easy to lower later; raising it would strand
  // people who already locked under it.
  minLockRaw: "69000000000000",
  // Per-wallet ceiling on a day's pool. 0 = OFF, which is the default and the shipped behaviour.
  // Built but not switched on: concentration is the risk a cap fixes (one wallet took 92% of the
  // pool the day it was written), but switching it on also THROTTLES total emission until enough
  // people are locked — at 33%, two lockers cap the day at 66%. That trade-off is the owner's.
  maxWalletSharePct: 0,
  // Rule B (owner): the treasury never earns from its own emission. Checked against a lock's
  // creator AND its recipient — Jupiter Lock can reassign a recipient. This list is the only
  // thing standing between the treasury's 7.1B of vesting and the pool; nothing about those
  // locks' TERMS keeps them out.
  excludeWallets: ["2zMCUkE9pBjcC7ihtLqm28EsCoEHVmCdJYr5262EuPy8"],
  // The wallets whose vesting schedules FUND the pool — the treasury, and nothing else. This is a
  // different list from excludeWallets even though today both hold one address: Rule B's list is
  // meant to grow (every wallet the owner controls), and every wallet added to it was, until
  // 2026-09-05, silently joining the funding set and inflating the 25%-of-stream ceiling that
  // keeps the pool fundable. Only put a wallet here if its unlocks actually land in the wallet
  // that pays rewards.
  fundedBy: ["2zMCUkE9pBjcC7ihtLqm28EsCoEHVmCdJYr5262EuPy8"],
  // Backdating bounds (see lib/cuna-lock-scan.js mergeLedger). The cap is the longest a lock can
  // be credited before we first index it; notBefore is the CUNA mint's birth — nothing holding
  // CUNA can be older, whatever an address's signature history says.
  backdateCapDays: 30,
  backdateNotBefore: 1787270400,   // 2026-08-17 00:00 UTC, comfortably before the first CUNA escrow (2026-08-23)
};

const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// Reject a bad config rather than storing it. A silently-clamped share or a typo'd exclude entry
// is an emission-sized mistake, and it would be discovered by looking at a payout.
function validateConfig(patch, base) {
  const c = { ...DEFAULTS, ...(base || {}), ...(patch || {}) };
  const num = (k, lo, hi) => {
    const v = Number(c[k]);
    if (!Number.isFinite(v) || v < lo || v > hi) throw new Error(`${k} must be between ${lo} and ${hi}: got ${c[k]}`);
    return v;
  };
  c.sharePct = num("sharePct", 0.01, 100);
  c.maxSharePct = num("maxSharePct", 1, 100);
  // "" or "0" clears it and falls back to the percentage; anything else must be whole base units.
  if (c.poolDailyRaw == null || String(c.poolDailyRaw) === "" || String(c.poolDailyRaw) === "0") {
    c.poolDailyRaw = "0";
  } else {
    let pool;
    try { pool = BigInt(c.poolDailyRaw); } catch (_) { throw new Error(`poolDailyRaw must be whole base units: got ${c.poolDailyRaw}`); }
    if (pool <= 0n) throw new Error(`poolDailyRaw must be positive or 0 to disable: got ${c.poolDailyRaw}`);
    c.poolDailyRaw = pool.toString();
  }
  c.minDurationDays = Math.floor(num("minDurationDays", 1, 3650));
  c.maxTermDays = Math.floor(num("maxTermDays", 1, 3650));
  c.fundedBy = Array.isArray(c.fundedBy) ? c.fundedBy.map(String).filter(Boolean) : [];
  if (!c.fundedBy.length) throw new Error("fundedBy must name at least one funding wallet (the treasury)");
  for (const w of c.fundedBy) if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(w)) throw new Error(`fundedBy has a bad address: ${w}`);
  c.backdateCapDays = Math.floor(num("backdateCapDays", 0, 3650));
  c.backdateNotBefore = Math.floor(num("backdateNotBefore", 0, 4102444800));
  if (c.maxTermDays < c.minDurationDays) {
    throw new Error(`maxTermDays (${c.maxTermDays}) cannot be below minDurationDays (${c.minDurationDays}) — no term would qualify`);
  }
  // 0 means off. Anything in (0,100) is a real ceiling; 100 or more is meaningless as a cap.
  // A CLEARED value is refused, not read as 0: Number(null) and Number("") are both 0, and here 0
  // means "no ceiling" — so a mistakenly blanked field would silently REMOVE the cap rather than
  // leave it alone. Say what you mean.
  if (c.maxWalletSharePct === null || c.maxWalletSharePct === "" || typeof c.maxWalletSharePct === "boolean") {
    throw new Error(`maxWalletSharePct must be 0 (off) or between 0 and 100: got ${JSON.stringify(c.maxWalletSharePct)}`);
  }
  const cap = Number(c.maxWalletSharePct);
  if (!Number.isFinite(cap) || cap < 0 || cap >= 100) {
    throw new Error(`maxWalletSharePct must be 0 (off) or between 0 and 100: got ${c.maxWalletSharePct}`);
  }
  c.maxWalletSharePct = cap;
  // Raw base units, so it must survive as a STRING — 100,000 CUNA at 9dp is 1e14, and larger
  // floors pass what a JS number holds exactly.
  try {
    const floor = BigInt(c.minLockRaw == null ? 0 : c.minLockRaw);
    if (floor < 0n) throw new Error("negative");
    c.minLockRaw = floor.toString();
  } catch (_) { throw new Error(`minLockRaw must be a whole number of base units: got ${c.minLockRaw}`); }
  if (!B58.test(String(c.mint))) throw new Error(`mint is not an address: ${c.mint}`);
  const ex = Array.isArray(c.excludeWallets) ? c.excludeWallets.map(String) : [];
  for (const w of ex) if (!B58.test(w)) throw new Error(`excludeWallets entry is not an address: ${w}`);
  // Dropping the treasury out of the exclude list is the single most expensive edit available
  // here, and it would look like a tidy-up in a diff. It has to be deliberate.
  for (const w of DEFAULTS.excludeWallets) {
    if (!ex.includes(w)) throw new Error(`refusing to drop ${w} from excludeWallets — that is the treasury (Rule B)`);
  }
  c.excludeWallets = ex;
  // A funder must also be excluded, or it earns from its own stream.
  for (const w of c.fundedBy) if (!ex.includes(w)) throw new Error(`fundedBy wallet ${w} must also be in excludeWallets`);
  return c;
}

// The stored programme, with anything missing filled in safely. A programme that has never been
// written is disarmed with no start date.
function readProgramme(stored) {
  const p = stored && typeof stored === "object" ? stored : {};
  return {
    armed: p.armed === true,
    startedAt: Number(p.startedAt) > 0 ? Number(p.startedAt) : null,
    config: validateConfig(p.config || {}, {}),
  };
}

// Arming is one-way for the START DATE. Disarming and re-arming must never move it: everyone's
// terms are measured from firstSeenAt, and a start date that can slide would let a pause-and-resume
// re-cut every lock's horizon.
function arm(stored, nowUnix) {
  const p = readProgramme(stored);
  const now = Number(nowUnix);
  if (!Number.isFinite(now) || now <= 0) throw new Error(`arm needs a real nowUnix: ${nowUnix}`);
  return { ...p, armed: true, startedAt: p.startedAt || now };
}

// Stops accrual. Keeps startedAt, so resuming does not hand anybody a fresh clock.
function disarm(stored) {
  return { ...readProgramme(stored), armed: false };
}

// UTC calendar day. The accrual ledger is keyed by this so a redeploy, a retry or two schedulers
// racing cannot pay the same day twice.
function dayKey(unix) {
  const d = new Date(Number(unix) * 1000);
  if (isNaN(d.getTime())) throw new Error(`dayKey needs a real unix time: ${unix}`);
  return d.toISOString().slice(0, 10);
}

// HOURLY SLICES (owner, 2026-09-05: "others should have a chance for today"). A day used to be
// credited in one piece at the first tick after midnight, so whoever was locked at that instant
// took the whole day and a lock made at 14:00 earned nothing until tomorrow. Now each UTC hour is
// its own slice of the daily pool, credited to whoever qualifies at that hour: lock at 14:00 and
// you earn 10 of today's 24 slices. The pool, the ladder and the multipliers are untouched.
const SLICES_PER_DAY = 24;
function sliceKey(unix) {
  const d = new Date(Number(unix) * 1000);
  if (isNaN(d.getTime())) throw new Error(`sliceKey needs a real unix time: ${unix}`);
  return d.toISOString().slice(0, 13);            // "YYYY-MM-DDTHH"
}
function sliceIndexOf(unix) { return new Date(Number(unix) * 1000).getUTCHours(); }
// One hour's share of the daily pool. Integer division leaves a remainder; the LAST slice of the
// day carries it, so twenty-four slices sum to exactly the daily pool — never a base unit short.
function slicePoolRaw(dailyRaw, sliceIndex) {
  const daily = BigInt(dailyRaw || 0);
  const each = daily / BigInt(SLICES_PER_DAY);
  if (Number(sliceIndex) === SLICES_PER_DAY - 1) return daily - each * BigInt(SLICES_PER_DAY - 1);
  return each;
}

// Whether a day may be accrued at all, and why not. Returned rather than thrown so a scheduler can
// log a reason without a stack trace every minute.
function accrualGate({ programme, paidDays, nowUnix }) {
  const p = readProgramme(programme);
  if (!p.armed) return { ok: false, reason: "programme is not armed — nobody earns until it is" };
  if (!p.startedAt) return { ok: false, reason: "armed with no start date" };
  const now = Number(nowUnix);
  if (!Number.isFinite(now) || now <= 0) return { ok: false, reason: `bad clock: ${nowUnix}` };
  if (now < p.startedAt) return { ok: false, reason: "clock is before the programme start" };
  const key = sliceKey(now);
  if (paidDays && Object.prototype.hasOwnProperty.call(paidDays, key)) {
    return { ok: false, reason: `${key} is already accrued`, day: key, slice: key };
  }
  // `day` keeps its name for callers and logs; it is now the slice key ("YYYY-MM-DDTHH").
  return { ok: true, day: key, slice: key, sliceIndex: sliceIndexOf(now), config: p.config, startedAt: p.startedAt };
}

// UTC days between the programme start and yesterday that were never accrued. A day is missed
// when the app was down across a whole calendar day, and it CANNOT be reconstructed: weight is
// amount x days remaining, so replaying it against today's locks would pay the wrong people the
// wrong amounts. They are reported so the owner can decide (top up, or let it go) rather than
// silently vanishing — a day that pays nobody must never look the same as a day that never ran.
function missedDays({ programme, paidDays, nowUnix }) { return missedSlices({ programme, paidDays, nowUnix }); }

// UTC HOURS between the hour the programme was armed and the previous full hour that were never
// accrued. A slice is missed when the app was down across it, and it CANNOT be reconstructed:
// weight depends on what was locked at that hour, so replaying it against later locks would pay
// the wrong people. Reported so the owner can decide (top up, or let it go) rather than silently
// vanishing — a slice that pays nobody must never look the same as a slice that never ran.
function missedSlices({ programme, paidDays, nowUnix }) {
  const p = readProgramme(programme);
  const now = Number(nowUnix);
  if (!p.startedAt || !Number.isFinite(now) || now <= 0) return [];
  const paid = paidDays || {};
  const out = [];
  const HOUR = 3600;
  const firstKey = sliceKey(p.startedAt);          // the arm hour itself counts
  const MAX = 400 * SLICES_PER_DAY;                // bounded walk, whatever the clock does
  for (let i = 1; i <= MAX; i++) {
    const t = now - i * HOUR;
    const k = sliceKey(t);
    if (k < firstKey) break;
    if (!Object.prototype.hasOwnProperty.call(paid, k)) out.push(k);
  }
  return out.reverse();
}

module.exports = {
  SLICES_PER_DAY, sliceKey, sliceIndexOf, slicePoolRaw, missedSlices,
  DAY, DEFAULTS, validateConfig, readProgramme, arm, disarm, dayKey, accrualGate, missedDays,
};
