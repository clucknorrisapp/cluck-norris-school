// The terms a SOL payment buys — an immutable, append-only schedule keyed by WHEN the payment
// landed. Second reviewer, 2026-09-11: "changing the configured pass length changes existing
// entitlements" — with `days` read from today's config, a 7-day pass recovered after the knob
// moved to 14 became a 14-day pass, and moving it down cut purchased access short. A purchase's
// terms are fixed at payment time, so the source of truth cannot be a live env var; it is this
// table, and changing the offer means APPENDING an entry with an effective-from instant, never
// editing an old one (old entries are what past payments resolve to).
//
// Rules:
//   - entries are ascending by `from` (ms since epoch, UTC); `termsAt(t)` is the last entry with
//     `from <= t`; a payment earlier than the first entry (should not exist) gets the first;
//   - `lamports` is the minimum payment that buys `days` under that entry — checked against the
//     transaction's own amount, so a price change never invalidates a payment made before it;
//   - server.js derives TOOLGATE.days / TOOLGATE.lamports from `current()` so what the page
//     advertises and what a payment resolves to are the same number by construction.
"use strict";

const DAY_MS = 24 * 3600e3;

const SCHEDULE = Object.freeze([
  // Unified tools pass launch (owner call, 2026-08-18): 0.05 SOL → 7 days, all heavy tools.
  Object.freeze({ from: Date.UTC(2026, 7, 18), days: 7, lamports: 50_000_000 }),
  // To change the offer: append { from: Date.UTC(yyyy, m-1, d, h), days, lamports } here.
]);

for (let i = 1; i < SCHEDULE.length; i++) {
  if (!(SCHEDULE[i].from > SCHEDULE[i - 1].from)) throw new Error("tool-pass terms schedule must be ascending by `from`");
}
for (const e of SCHEDULE) {
  if (!(Number.isInteger(e.days) && e.days > 0 && Number.isInteger(e.lamports) && e.lamports > 0)) throw new Error("tool-pass terms entry malformed: " + JSON.stringify(e));
}

function termsAt(atMs, schedule = SCHEDULE) {
  let t = schedule[0];
  for (const e of schedule) { if (e.from <= atMs) t = e; else break; }
  return t;
}
function current(now = Date.now(), schedule = SCHEDULE) { return termsAt(now, schedule); }

module.exports = { SCHEDULE, termsAt, current, DAY_MS };
