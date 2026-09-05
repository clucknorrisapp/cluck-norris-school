"use strict";
// CUNA lock-to-earn: who qualifies, what they are worth, and how a day's pool is split.
//
// Shape (owner, 2026-09-04): lock CUNA for >= 1 year with a >= 6 month cliff and you earn a share
// of the daily unlock stream. Earning starts the moment the lock is created; nothing can be
// CLAIMED until the cliff has passed. Weight is amount x days remaining, so a lock with eleven
// months left is worth more per token than one with three weeks — and your weight decays as the
// lock matures, which is what makes re-locking natural instead of enforced.
//
// FIXED EMISSION, FLOATING YIELD. The pool is a share of tokens that were unlocking anyway, so it
// can never become unfundable. The published number is "N CUNA/day split across everyone locked",
// never an APY: on a token with 75% of supply still vesting, a token-denominated APY looks like a
// farm-and-dump even when it is honest.
//
// NOBODY SUBMITS PROOF. Qualification is decided by reading Jupiter Lock escrow accounts off the
// chain. Nothing a user types is an input, so there is nothing for a user to forge.
//
// TERMS ARE MEASURED FORWARD, FROM THE DAY WE FIRST SEE THE LOCK — never backward from anything
// on the escrow. `vesting_start_time` looks like a creation date and is not one: Jupiter sets it
// equal to the cliff, so a real 471-day lock reads as a 244-day one, and it is creator-set anyway
// (there are live CUNA escrows declaring start dates in 2069 and 2077). Both facts came from
// scanning the actual chain, and either one alone breaks a backward-looking rule. `firstSeenAt` is
// OUR timestamp from OUR ledger, so nobody can move it.
//
// This file is deliberately pure — no network, no clock, no disk. Every input is passed in so the
// money logic can be tested against the cases that would quietly break it.

const DAY = 86400;

// ---------------------------------------------------------------------------
// The lock shape.
//
// normalizeEscrow() is the ONLY place that knows Jupiter Lock's field names, and it is deliberately
// next to the rules that consume them. Phase 1 shipped a version of this file that invented
// `createdAt` and `cancelable`; both were absent from real escrows, so the cancelable guard read
// `undefined === true` and silently passed EVERY cancelable lock. Tests did not catch it because
// the fixtures supplied the invented fields by hand. If a rule below needs a new field, add it
// here from the on-chain layout — do not read it off the lock object directly.
//
// On-chain VestingEscrow (fetched from the deployed IDL, program LocpQgu…Qqjn):
//   recipient, token_mint, creator, base, escrow_bump, update_recipient_mode, cancel_mode,
//   token_program_flag, cliff_time, frequency, cliff_unlock_amount, amount_per_period,
//   number_of_period, total_claimed_amount, vesting_start_time, cancelled_at
// ---------------------------------------------------------------------------
function normalizeEscrow(escrowAddr, account, firstSeenAt) {
  const n = (v) => Number(v == null ? 0 : v.toString ? v.toString() : v);
  const b = (v) => BigInt(v == null ? 0 : v.toString ? v.toString() : v);
  const key = (v) => (v == null ? "" : v.toBase58 ? v.toBase58() : String(v));

  const cliffTime = n(account.cliffTime);
  const frequency = n(account.frequency) || 1;
  const periods = n(account.numberOfPeriod);
  const total = b(account.cliffUnlockAmount) + b(account.amountPerPeriod) * BigInt(periods);
  const claimed = b(account.totalClaimedAmount);

  return {
    escrow: key(escrowAddr),
    mint: key(account.tokenMint),
    recipient: key(account.recipient),
    creator: key(account.creator),
    // 0 = nobody can cancel (the strongest lock). See lib/jup-lock.js:104. A MISSING value stays
    // missing rather than coercing to 0 — Number(null) is 0, so coercing here would invent the
    // one value that means "safe" out of a field the chain never gave us.
    cancelMode: account.cancelMode == null ? null : n(account.cancelMode),
    cancelledAt: n(account.cancelledAt),
    // Informational ONLY. Never measure a term from this — see the header.
    vestingStartTime: n(account.vestingStartTime),
    // When the programme first indexed this escrow. Ours, not the chain's. Null until the ledger
    // has recorded it, and a lock without one cannot qualify.
    firstSeenAt: firstSeenAt == null ? null : Number(firstSeenAt),
    cliffTime,
    fullyVestedAt: cliffTime + frequency * periods,
    totalRaw: total.toString(),
    claimedRaw: claimed.toString(),
    // What is actually still locked up. A lock that has been fully claimed out holds nothing at
    // risk and must not keep drawing a share of the pool on the strength of its end date.
    atRiskRaw: (total > claimed ? total - claimed : 0n).toString(),
  };
}

// A day's pool, as a share of that day's unlock. Kept here rather than inline so the tests and the
// page read the same number.
function poolForDay({ dailyUnlockRaw, sharePct }) {
  const unlock = BigInt(dailyUnlockRaw);
  const pct = Number(sharePct);
  if (!(pct > 0 && pct <= 100)) throw new Error(`sharePct must be in (0,100]: got ${sharePct}`);
  // Integer maths on raw u64 amounts throughout. A JS number loses precision above ~9e15 and CUNA
  // amounts at 9 decimals pass that at 9 million tokens — well inside normal lock sizes.
  return (unlock * BigInt(Math.round(pct * 100))) / 10000n;
}

// Why a lock does NOT qualify. Returns [] when it does. Reasons are plural on purpose: telling
// someone only the first thing wrong with their lock makes them fix it and fail again.
function disqualify(lock, cfg) {
  const r = [];
  const {
    mint, startAfterUnix, minDurationDays = 365, minCliffDays = 180, excludeWallets = [],
  } = cfg || {};

  if (!lock || typeof lock !== "object") return ["not a lock"];
  if (mint && String(lock.mint) !== String(mint)) r.push("different token");

  // A cancelable lock is not a commitment: the creator can cancel and take the tokens back, so
  // rewarding it pays yield on a balance that was never really locked up. cancelMode is a NUMBER —
  // 0 is the only qualifying value, and anything unreadable must FAIL CLOSED. Note that a bare
  // `Number(x) !== 0` is not enough: Number(null) and Number("") are both 0, so a missing field
  // would read as the strongest possible lock.
  const cm = lock.cancelMode;
  const cmReadable = (typeof cm === "number" || typeof cm === "string")
    && String(cm).trim() !== "" && Number.isInteger(Number(cm));
  if (!cmReadable || Number(cm) !== 0) r.push("cancelable — the creator can take these back");
  if (Number(lock.cancelledAt || 0) > 0) r.push("already cancelled");

  // The terms, measured FORWARD from the day the programme first saw this lock. A lock that has
  // been running for six months when we launch is judged on what is still ahead of it, which is
  // the only part anyone is still committed to.
  const seen = Number(lock.firstSeenAt || 0);
  const cliff = Number(lock.cliffTime || 0);
  const end = Number(lock.fullyVestedAt || 0);
  if (!seen) r.push("not yet indexed");
  else if (startAfterUnix && seen < Number(startAfterUnix)) r.push("indexed before the programme began");
  if (!cliff) r.push("no cliff");
  else if (seen && (cliff - seen) < minCliffDays * DAY) r.push(`less than ${minCliffDays} days to the cliff`);
  if (!end) r.push("no end date");
  else if (seen && (end - seen) < minDurationDays * DAY) r.push(`less than ${minDurationDays} days left to run`);

  const who = String(lock.recipient || "");
  if (!who) r.push("no recipient");
  else if (excludeWallets.map(String).includes(who)) r.push("excluded wallet");

  let amt;
  try { amt = BigInt(lock.atRiskRaw); } catch (_) { amt = -1n; }
  if (amt <= 0n) r.push("nothing still locked");

  return r;
}

function qualifies(lock, cfg) { return disqualify(lock, cfg).length === 0; }

// amount still locked x whole days still to run. A matured lock is worth ZERO, never negative — a
// negative weight would let an expired lock subtract from the pool and hand everyone else more
// than 100%.
function weightOf(lock, nowUnix) {
  const end = Number(lock.fullyVestedAt || 0);
  const remaining = Math.max(0, Math.floor((end - Number(nowUnix)) / DAY));
  return BigInt(lock.atRiskRaw) * BigInt(remaining);
}

// Split one day's pool across qualifying locks, credited to the RECIPIENT — they are who the lock
// pays out to and who bears the commitment.
//
// Largest-remainder: integer division alone silently destroys tokens (a hundred lockers can lose a
// hundred base units a day, forever). Every unit of the pool is handed out or explicitly reported.
function accrueDay({ locks, poolRaw, nowUnix, cfg }) {
  const pool = BigInt(poolRaw);
  const eligible = [];
  const skipped = [];
  for (const l of locks || []) {
    const why = disqualify(l, cfg);
    if (why.length) { skipped.push({ escrow: l && l.escrow, reasons: why }); continue; }
    const w = weightOf(l, nowUnix);
    if (w > 0n) eligible.push({ lock: l, weight: w });
    else skipped.push({ escrow: l.escrow, reasons: ["matured — no days remaining"] });
  }
  const totalWeight = eligible.reduce((a, e) => a + e.weight, 0n);
  // Nobody locked: the day's pool is not distributed. It is NOT silently dropped either — the
  // caller decides whether it rolls forward, and undistributed is reported so it can be audited.
  if (totalWeight === 0n || pool === 0n) {
    return { credits: {}, totalWeight: 0n, distributed: 0n, undistributed: pool, eligible: 0, skipped };
  }

  const rows = eligible.map((e) => {
    const exact = pool * e.weight;
    return { who: String(e.lock.recipient), floor: exact / totalWeight, rem: exact % totalWeight, weight: e.weight };
  });
  let distributed = rows.reduce((a, r) => a + r.floor, 0n);
  let leftover = pool - distributed;
  // Hand the rounding dust to the largest remainders, ties broken by wallet so the result is
  // deterministic — the same inputs must always produce the same ledger.
  rows.sort((a, b) => (b.rem === a.rem ? (a.who < b.who ? -1 : 1) : (b.rem > a.rem ? 1 : -1)));
  for (let i = 0; i < rows.length && leftover > 0n; i++) { rows[i].floor += 1n; leftover -= 1n; distributed += 1n; }

  const credits = {};
  for (const r of rows) credits[r.who] = (credits[r.who] || 0n) + r.floor;
  return { credits, totalWeight, distributed, undistributed: pool - distributed, eligible: eligible.length, skipped };
}

// Earned from creation, CLAIMABLE only once the cliff has passed. Accrual and access are separate
// on purpose: the reward should build through the period the commitment is actually at risk.
function claimableFor({ accruedRaw, locks, nowUnix }) {
  const accrued = BigInt(accruedRaw || 0);
  const passed = (locks || []).some((l) => Number(l.cliffTime || 0) && Number(nowUnix) >= Number(l.cliffTime));
  if (!passed) {
    const next = (locks || []).map((l) => Number(l.cliffTime || 0)).filter(Boolean).sort((a, b) => a - b)[0] || null;
    return { claimable: 0n, locked: accrued, cliffPassed: false, unlocksAt: next };
  }
  return { claimable: accrued, locked: 0n, cliffPassed: true, unlocksAt: null };
}

// What the page shows instead of an APY: the pool, what is locked, and the rate that falls out of
// them. Returned as a number only because it is display copy — never used for accounting.
function yieldSnapshot({ poolRaw, totalLockedRaw }) {
  const pool = BigInt(poolRaw), locked = BigInt(totalLockedRaw || 0);
  if (locked === 0n) return { annualPct: null, note: "nothing locked yet" };
  // pool/locked x 365 x 100 for a percentage, x100 again so BigInt division keeps two decimals
  // before the final scale-down. Getting this wrong reads as 0.96% where it should say 96.85% —
  // a number that would go straight onto the page and be believed.
  return { annualPct: Number(pool * 3650000n / locked) / 100, note: null };
}

module.exports = {
  DAY, normalizeEscrow, poolForDay, disqualify, qualifies, weightOf, accrueDay, claimableFor, yieldSnapshot,
};
