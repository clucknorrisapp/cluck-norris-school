"use strict";
// CUNA lock-to-earn: who qualifies, what they are worth, and how a day's pool is split.
//
// Shape (owner, 2026-09-05, superseding the 1-year/6-month-cliff rule of 09-04): lock CUNA for at
// least 3 months and you earn a share of the daily unlock stream. Weight is amount x days
// remaining, so a lock with eleven months left is worth more per token than one with three weeks —
// and your weight decays as the lock matures, which is what makes re-locking natural instead of
// enforced. That single formula is also what tiers the terms: 3/6/9/12/15/18 months pay exactly
// 1x to 6x per token with no bonus multipliers anywhere, and anyone can check it themselves.
//
// NO CLIFF, of any kind (owner, 2026-09-05: "remove the cliff part, that isn't necessary"). Not on
// the lock, and not on claiming — everything accrued is claimable immediately. The earlier design
// gated claims on the lock's own cliff, which does not survive short tiers: a 90-day lock cannot
// carry a 180-day cliff, and a lock whose cliff has ALREADY passed would let someone claim at
// once. It is safe to drop because a qualifying lock is non-cancelable — the principal is stuck
// whatever happens, so early claiming was never the risk. Rewards are earned per day of
// commitment; taking them daily changes nothing about the commitment.
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
    // The schedule itself, kept because "how much is still locked" cannot be answered without it.
    // A lock with a 1-day cliff vesting over 18 months releases tokens continuously; one with a
    // single cliff at 18 months releases nothing until the end. Same totalRaw, same fullyVestedAt,
    // completely different commitments.
    cliffUnlockRaw: b(account.cliffUnlockAmount).toString(),
    perPeriodRaw: b(account.amountPerPeriod).toString(),
    frequency,
    periods,
    // What is actually still locked up. A lock that has been fully claimed out holds nothing at
    // risk and must not keep drawing a share of the pool on the strength of its end date.
    atRiskRaw: (total > claimed ? total - claimed : 0n).toString(),
    // Linear release rate once past the cliff, per day. This is what the pool is a share of, and
    // it is computed from the schedule rather than stored anywhere — the published "N CUNA/day"
    // must move when the real unlock stream moves.
    perDayRaw: ((b(account.amountPerPeriod) * BigInt(DAY)) / BigInt(frequency)).toString(),
  };
}

// A day's pool. Two ways to say it, and the owner picked the first:
//
//   fixedRaw   a flat, round, announceable number — 345,000 CUNA/day. Exactly half the 690,000
//              daily burn, so "two tokens burned for every one earned" is literally true rather
//              than approximately, and 5x the 69,000 minimum lock. A percentage of a live stream
//              gives numbers like 331,643, which reads as arithmetic rather than a decision.
//   sharePct   a percentage of that day's unlock, used when no fixed amount is set.
//
// ⚠️ A FIXED POOL IS STILL CAPPED BY THE STREAM. The whole reason this can never become
// unfundable is that it only ever hands out tokens that were unlocking anyway. A flat number
// alone loses that: the treasury's schedules DO finish, and a fixed 345,000 against a stream that
// has fallen to 200,000 is a promise the chain cannot keep. maxSharePct is the ceiling that keeps
// the guarantee — the pool is never more than that fraction of what actually arrived today.
function poolForDay({ dailyUnlockRaw, sharePct, fixedRaw, maxSharePct = 25 }) {
  const unlock = BigInt(dailyUnlockRaw);
  const ceilingPct = Number(maxSharePct);
  if (!(ceilingPct > 0 && ceilingPct <= 100)) throw new Error(`maxSharePct must be in (0,100]: got ${maxSharePct}`);
  const ceiling = (unlock * BigInt(Math.round(ceilingPct * 100))) / 10000n;

  if (fixedRaw != null && String(fixedRaw) !== "" && String(fixedRaw) !== "0") {
    let fixed;
    try { fixed = BigInt(fixedRaw); } catch (_) { throw new Error(`fixedRaw must be whole base units: got ${fixedRaw}`); }
    if (fixed <= 0n) throw new Error(`fixedRaw must be positive: got ${fixedRaw}`);
    return fixed <= ceiling ? fixed : ceiling;
  }

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
    mint, startAfterUnix, minDurationDays = 90, minLockRaw = 0, excludeWallets = [],
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

  // The term, measured FORWARD from the day the programme first saw this lock. A lock that has
  // been running for six months when we launch is judged on what is still ahead of it, which is
  // the only part anyone is still committed to. There is no cliff requirement: cliffTime is read
  // for display, never for qualification.
  const seen = Number(lock.firstSeenAt || 0);
  const end = Number(lock.fullyVestedAt || 0);
  if (!seen) r.push("not yet indexed");
  else if (startAfterUnix && seen < Number(startAfterUnix)) r.push("indexed before the programme began");
  if (!end) r.push("no end date");
  else if (seen && (end - seen) < minDurationDays * DAY) r.push(`less than ${minDurationDays} days left to run`);

  // A dust floor, not a wealth gate. Every lock is a permanent ledger row and a line in every
  // chain scan, and at a 3-month minimum spamming them is cheap — without this, ten thousand
  // 1-token locks would bloat the scan for the price of rent.
  let amt;
  try { amt = BigInt(lock.atRiskRaw); } catch (_) { amt = -1n; }
  if (amt <= 0n) r.push("nothing still locked");
  else if (minLockRaw && amt < BigInt(minLockRaw)) r.push("below the minimum lock size");

  // Exclusion checks the CREATOR as well as the recipient. Jupiter Lock has an
  // update_recipient_mode, so a recipient is not fixed: an excluded wallet could point one of its
  // own locks at a fresh address and start earning. Rule B is the only thing keeping the treasury
  // out of its own emission — a hole in it is the whole pool.
  const who = String(lock.recipient || "");
  const by = String(lock.creator || "");
  const excluded = excludeWallets.map(String);
  if (!who) r.push("no recipient");
  else if (excluded.includes(who)) r.push("excluded wallet");
  if (by && excluded.includes(by)) r.push("created by an excluded wallet");

  return r;
}

function qualifies(lock, cfg) { return disqualify(lock, cfg).length === 0; }

// How much of a lock is STILL LOCKED right now — not merely unclaimed.
//
// ⚠️ THIS IS THE DIFFERENCE THAT MATTERS. Using total-minus-claimed lets someone set a 1-day cliff
// vesting over 18 months, never press claim, and collect full weight for eighteen months while
// being free to withdraw a growing share any day they like. That is the cancelable-lock problem
// wearing a different hat. What is unvested cannot be taken out at all, by anyone, so it is the
// only honest measure of commitment.
function unvestedRaw(lock, nowUnix) {
  const now = Number(nowUnix);
  const total = BigInt(lock.totalRaw || 0);
  const cliff = Number(lock.cliffTime || 0);
  if (!cliff || now < cliff) return total;                       // nothing has vested yet
  const freq = Number(lock.frequency) || 1;
  const periods = Number(lock.periods) || 0;
  const elapsed = Math.min(periods, Math.floor((now - cliff) / freq));
  const unlocked = BigInt(lock.cliffUnlockRaw || 0) + BigInt(lock.perPeriodRaw || 0) * BigInt(Math.max(0, elapsed));
  return total > unlocked ? total - unlocked : 0n;
}

// The three quantities a lock is made of at any moment. They always sum to the total:
//
//   unvested          cannot be taken out by anyone — THIS is what earns
//   vestedUnclaimed   already released, sitting in the escrow, withdrawable this second
//   claimed           already in their wallet
//
// `atRiskRaw` (total minus claimed) lumps the first two together, which is what let a near cliff
// with a big unlock keep full weight while being freely withdrawable. Anything deciding rewards
// must use `unvested`; the other two are for showing someone what they actually have.
function splitOf(lock, nowUnix) {
  const total = BigInt(lock.totalRaw || 0);
  const claimed = BigInt(lock.claimedRaw || 0);
  const unvested = unvestedRaw(lock, nowUnix);
  const vested = total > unvested ? total - unvested : 0n;
  const vestedUnclaimed = vested > claimed ? vested - claimed : 0n;
  return { totalRaw: total.toString(), unvestedRaw: unvested.toString(),
           vestedUnclaimedRaw: vestedUnclaimed.toString(), claimedRaw: claimed.toString() };
}

// amount still LOCKED x whole days still to run. A matured lock is worth ZERO, never negative — a
// negative weight would let an expired lock subtract from the pool and hand everyone else more
// than 100%.
function weightOf(lock, nowUnix) {
  const end = Number(lock.fullyVestedAt || 0);
  const remaining = Math.max(0, Math.floor((end - Number(nowUnix)) / DAY));
  return unvestedRaw(lock, nowUnix) * BigInt(remaining);
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
  // Weight is per LOCK but the cap is per WALLET, so fold multiple locks together first —
  // otherwise splitting one position across three locks would buy three times the cap.
  const byWallet = new Map();
  for (const e of eligible) {
    const who = String(e.lock.recipient);
    byWallet.set(who, (byWallet.get(who) || 0n) + e.weight);
  }
  const totalWeight = [...byWallet.values()].reduce((a, w) => a + w, 0n);
  // Nobody locked: the day's pool is not distributed. It is NOT silently dropped either — the
  // caller decides whether it rolls forward, and undistributed is reported so it can be audited.
  if (totalWeight === 0n || pool === 0n) {
    return { credits: {}, totalWeight: 0n, distributed: 0n, undistributed: pool, eligible: 0, capped: [], skipped };
  }

  // Optional per-wallet ceiling on a day's pool. OFF by default (0 = no cap).
  //
  // Concentration, not total emission, is the thing a cap fixes: on the day this was written ONE
  // wallet took 92% of the pool, which is small in dollars now but is hundreds of millions of CUNA
  // a year to a single address. Anything a capped wallet cannot take is simply NOT EMITTED — it is
  // reported as undistributed, never redistributed to a debt or carried forward. Emitting fewer
  // tokens when few people are locked is the conservative outcome and the one the owner wants.
  const capPct = Number((cfg || {}).maxWalletSharePct || 0);
  if (!(capPct > 0 && capPct < 100)) {
    return splitByWeight({ pool, byWallet, totalWeight, skipped, eligible: eligible.length, capped: [] });
  }
  const capRaw = (pool * BigInt(Math.round(capPct * 100))) / 10000n;
  const fixed = new Map();          // wallet -> exactly capRaw
  let free = new Map(byWallet);
  // Each pass fixes at least one wallet at the cap, so this terminates in at most one pass per
  // wallet — no unbounded loop even on pathological weights.
  for (let guard = 0; guard <= byWallet.size; guard++) {
    const freePool = pool - BigInt(fixed.size) * capRaw;
    const freeWeight = [...free.values()].reduce((a, w) => a + w, 0n);
    if (freeWeight === 0n || freePool <= 0n) break;
    let movedOne = false;
    for (const [who, w] of free) {
      if ((freePool * w) / freeWeight > capRaw) { fixed.set(who, capRaw); free.delete(who); movedOne = true; }
    }
    if (!movedOne) break;
  }
  const freePool = pool - BigInt(fixed.size) * capRaw;
  const freeWeight = [...free.values()].reduce((a, w) => a + w, 0n);
  const rest = (freeWeight > 0n && freePool > 0n)
    ? splitByWeight({ pool: freePool, byWallet: free, totalWeight: freeWeight, skipped, eligible: eligible.length, capped: [] })
    : { credits: {}, distributed: 0n };
  const credits = { ...rest.credits };
  let distributed = rest.distributed;
  for (const [who, raw] of fixed) { credits[who] = (credits[who] || 0n) + raw; distributed += raw; }
  return {
    credits, totalWeight, distributed, undistributed: pool - distributed,
    eligible: eligible.length, capped: [...fixed.keys()], skipped,
  };
}

// Largest-remainder split of a pool across weighted wallets. Integer division alone silently
// destroys tokens (a hundred lockers can lose a hundred base units a day, forever), so every unit
// is handed out or explicitly reported.
function splitByWeight({ pool, byWallet, totalWeight, skipped, eligible, capped }) {
  const rows = [...byWallet].map(([who, weight]) => {
    const exact = pool * weight;
    return { who, floor: exact / totalWeight, rem: exact % totalWeight, weight };
  });
  let distributed = rows.reduce((a, r) => a + r.floor, 0n);
  let leftover = pool - distributed;
  // Dust to the largest remainders, ties broken by wallet so the result is deterministic — the
  // same inputs must always produce the same ledger.
  rows.sort((a, b) => (b.rem === a.rem ? (a.who < b.who ? -1 : 1) : (b.rem > a.rem ? 1 : -1)));
  for (let i = 0; i < rows.length && leftover > 0n; i++) { rows[i].floor += 1n; leftover -= 1n; distributed += 1n; }
  const credits = {};
  for (const r of rows) credits[r.who] = (credits[r.who] || 0n) + r.floor;
  return { credits, totalWeight, distributed, undistributed: pool - distributed, eligible, capped, skipped };
}

// Everything accrued is claimable. There is no cliff (owner, 2026-09-05) — see the header for why
// that is safe. Kept as a function rather than inlined so the page has one place to ask, and so a
// gate can be reinstated in exactly one place if the owner ever wants one.
function claimableFor({ accruedRaw }) {
  const accrued = BigInt(accruedRaw || 0);
  return { claimable: accrued, locked: 0n, cliffPassed: true, unlocksAt: null };
}

// The stream the pool is drawn from: what the vesting schedules release TODAY *to the wallets that
// fund the programme*, across every lock past its cliff and not yet finished.
//
// ⚠️ `fundedBy` is not optional decoration. A community member's lock also unlocks daily — but those
// tokens go to THEM, not to us, and we cannot pay a reward pool out of tokens that land in someone
// else's wallet. Counting every lock inflated the published pool by ~4% with tokens the treasury
// never receives. Pass the funding wallets (the treasury) and nothing else.
//
// Locks still inside their cliff release nothing yet, and finished ones release nothing any more —
// counting either would publish a pool the schedules cannot actually fund.
function dailyUnlockRaw(locks, nowUnix, fundedBy) {
  const now = Number(nowUnix);
  const funders = (fundedBy || []).map(String);
  if (!funders.length) throw new Error("dailyUnlockRaw needs the funding wallets — see the note above");
  let sum = 0n;
  for (const l of locks || []) {
    if (!funders.includes(String(l.recipient))) continue;
    const cliff = Number(l.cliffTime || 0), end = Number(l.fullyVestedAt || 0);
    if (!cliff || now < cliff) continue;
    if (end && now >= end) continue;
    sum += BigInt(l.perDayRaw || 0);
  }
  return sum;
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
  DAY, normalizeEscrow, poolForDay, dailyUnlockRaw, disqualify, qualifies, weightOf, unvestedRaw, splitOf,
  accrueDay,
  claimableFor, yieldSnapshot,
};
