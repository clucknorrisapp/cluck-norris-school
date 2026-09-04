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
// This file is deliberately pure — no network, no clock, no disk. Every input is passed in so the
// money logic can be tested against the cases that would quietly break it.

const DAY = 86400;

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

  // A cancelable lock is not a commitment. The creator can cancel and take the tokens back, so
  // rewarding it pays yield on a balance that was never actually locked up.
  if (lock.cancelable === true) r.push("cancelable — the creator can take these back");

  const created = Number(lock.createdAt || 0);
  // The cutoff is what keeps the programme from paying its own treasury: every pre-existing
  // vesting lock is on the wrong side of it, with no wallet list to maintain and get wrong.
  if (!created) r.push("unknown creation time");
  else if (startAfterUnix && created < Number(startAfterUnix)) r.push("created before the programme started");

  const cliff = Number(lock.cliffTime || 0);
  const end = Number(lock.fullyVestedAt || 0);
  if (!cliff) r.push("no cliff");
  else if (created && (cliff - created) < minCliffDays * DAY) r.push(`cliff shorter than ${minCliffDays} days`);
  if (!end) r.push("no end date");
  else if (created && (end - created) < minDurationDays * DAY) r.push(`locked for less than ${minDurationDays} days`);

  const who = String(lock.recipient || "");
  if (!who) r.push("no recipient");
  else if (excludeWallets.map(String).includes(who)) r.push("excluded wallet");

  let amt;
  try { amt = BigInt(lock.amountRaw); } catch (_) { amt = -1n; }
  if (amt <= 0n) r.push("no amount");

  return r;
}

function qualifies(lock, cfg) { return disqualify(lock, cfg).length === 0; }

// amount x whole days still to run. A matured lock is worth ZERO, never negative — a negative
// weight would let an expired lock subtract from the pool and hand everyone else more than 100%.
function weightOf(lock, nowUnix) {
  const end = Number(lock.fullyVestedAt || 0);
  const remaining = Math.max(0, Math.floor((end - Number(nowUnix)) / DAY));
  return BigInt(lock.amountRaw) * BigInt(remaining);
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

module.exports = { DAY, poolForDay, disqualify, qualifies, weightOf, accrueDay, claimableFor, yieldSnapshot };
