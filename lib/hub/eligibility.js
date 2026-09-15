"use strict";
// Eligibility records — every disqualify() branch as a public reason CODE, with the numbers
// that decided it (design §2, test 4). The strings lib/cuna-staking.js produces are for humans
// and may be reworded; the codes here are the contract the wallet page and the JSON mirror use.

const s = require("../cuna-staking");

// Prefix → code. Order matters only where prefixes overlap (none do today). A string that maps
// to nothing becomes `other` and the raw text is kept, so a new branch in disqualify() can never
// hide a reason — it surfaces as `other` until it is given a code, and a test asserts none is.
const REASON_CODES = [
  ["not a lock", "not_a_lock"],
  ["different token", "different_token"],
  ["cancelable", "cancelable"],
  ["already cancelled", "cancelled"],
  ["not yet indexed", "not_indexed"],
  ["indexed before the programme began", "seen_before_program"],
  ["no unlock schedule", "no_schedule"],
  ["no tokens locked for", "term_too_short"],
  ["nothing still locked", "nothing_locked"],
  ["below the minimum lock size", "below_min_lock"],
  ["no recipient", "no_recipient"],
  ["excluded wallet", "excluded_recipient"],
  ["created by an excluded wallet", "excluded_creator"],
];
function codeFor(text) {
  const t = String(text || "");
  for (const [prefix, code] of REASON_CODES) if (t.startsWith(prefix)) return code;
  return "other";
}

// One record per escrow. `numbers` is what the page shows next to the verdict.
function eligibilityRecord(lock, cfg, nowUnix) {
  const texts = s.disqualify(lock, cfg);
  const reasons = texts.map((text) => ({ code: codeFor(text), text }));
  const unvested = (() => { try { return s.unvestedRaw(lock, nowUnix).toString(); } catch (_) { return null; } })();
  return {
    escrow: lock && lock.escrow ? String(lock.escrow) : null,
    owner: lock && lock.recipient ? String(lock.recipient) : null,
    creator: lock && lock.creator ? String(lock.creator) : null,
    qualifies: reasons.length === 0,
    reasons,
    numbers: {
      atRiskRaw: lock && lock.atRiskRaw != null ? String(lock.atRiskRaw) : null,
      unvestedRaw: unvested,
      firstSeenAt: lock && lock.firstSeenAt ? Number(lock.firstSeenAt) : null,
      cliffTime: lock && lock.cliffTime ? Number(lock.cliffTime) : null,
      cancelMode: lock ? lock.cancelMode : null,
      minLockRaw: cfg && cfg.minLockRaw != null ? String(cfg.minLockRaw) : "0",
      minDurationDays: cfg && cfg.minDurationDays != null ? Number(cfg.minDurationDays) : null,
      programStartedAt: cfg && cfg.startAfterUnix ? Number(cfg.startAfterUnix) : null,
    },
  };
}

module.exports = { REASON_CODES, codeFor, eligibilityRecord };
