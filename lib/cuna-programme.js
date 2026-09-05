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
  sharePct: 20,                                                // of the day's unlock (owner)
  minDurationDays: 365,
  minCliffDays: 180,
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
  c.minCliffDays = Math.floor(num("minCliffDays", 0, 3650));
  if (c.minCliffDays > c.minDurationDays) {
    throw new Error(`minCliffDays (${c.minCliffDays}) cannot exceed minDurationDays (${c.minDurationDays})`);
  }
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

module.exports = { DAY, DEFAULTS, validateConfig, readProgramme, arm, disarm, dayKey, accrualGate };
