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
  // 10% of the day's unlock (owner, 2026-09-05, down from 20: "we can always go up on it later").
  // That direction matters: raising the share is a gift to everyone already locked, cutting it
  // takes back something people committed on the strength of. Starting low is the reversible choice.
  sharePct: 10,
  // 3 months (owner, 2026-09-05, down from 365): "we may need to have terms down to even 3 months
  // or no one will lock on their own as this is a meme project." The 3/6/9/12/15/18 month ladder
  // the page offers needs no separate tier table — weight is amount x days remaining, so those
  // terms already pay exactly 1x to 6x per token.
  minDurationDays: 90,
  // Dust floor, not a wealth gate. Every lock is a permanent ledger row and a line in every chain
  // scan; at a 3-month minimum, spamming them is cheap. 100k CUNA is a rounding error to a real
  // participant. Set by me, not the owner — change it freely.
  minLockRaw: "100000000000000",   // 100,000 CUNA at 9dp
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
  c.minDurationDays = Math.floor(num("minDurationDays", 1, 3650));
  // 0 means off. Anything in (0,100) is a real ceiling; 100 or more is meaningless as a cap.
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

// Whether a day may be accrued at all, and why not. Returned rather than thrown so a scheduler can
// log a reason without a stack trace every minute.
function accrualGate({ programme, paidDays, nowUnix }) {
  const p = readProgramme(programme);
  if (!p.armed) return { ok: false, reason: "programme is not armed — nobody earns until it is" };
  if (!p.startedAt) return { ok: false, reason: "armed with no start date" };
  const now = Number(nowUnix);
  if (!Number.isFinite(now) || now <= 0) return { ok: false, reason: `bad clock: ${nowUnix}` };
  if (now < p.startedAt) return { ok: false, reason: "clock is before the programme start" };
  const key = dayKey(now);
  if (paidDays && Object.prototype.hasOwnProperty.call(paidDays, key)) {
    return { ok: false, reason: `${key} is already accrued`, day: key };
  }
  return { ok: true, day: key, config: p.config, startedAt: p.startedAt };
}

// UTC days between the programme start and yesterday that were never accrued. A day is missed
// when the app was down across a whole calendar day, and it CANNOT be reconstructed: weight is
// amount x days remaining, so replaying it against today's locks would pay the wrong people the
// wrong amounts. They are reported so the owner can decide (top up, or let it go) rather than
// silently vanishing — a day that pays nobody must never look the same as a day that never ran.
function missedDays({ programme, paidDays, nowUnix }) {
  const p = readProgramme(programme);
  const now = Number(nowUnix);
  if (!p.startedAt || !Number.isFinite(now) || now <= 0) return [];
  const paid = paidDays || {};
  const out = [];
  // Walk calendar days, not now-minus-N-seconds: DST does not apply to UTC but a clock jump does,
  // and this must not loop forever on one.
  const MAX = 400;
  for (let i = 1; i <= MAX; i++) {
    const t = now - i * DAY;
    if (t < p.startedAt) break;
    const k = dayKey(t);
    if (!Object.prototype.hasOwnProperty.call(paid, k)) out.push(k);
  }
  return out.reverse();
}

module.exports = {
  DAY, DEFAULTS, validateConfig, readProgramme, arm, disarm, dayKey, accrualGate, missedDays,
};
