// Pure helper for the "fresh signatures since the durable cursor" walk shared by three watchers
// in server.js: the ROSE buy bot (roseBuyBotPollOnce), the generic per-project buy bot
// (projectBuyPollOnce), and the burn watcher (projectBurnPollOnce). All three call
// getSignaturesForAddress (newest-first) and need the same thing: which of those signatures are
// new since the last cursor, in the order the site should PROCESS them (oldest first), with
// err'd entries dropped and the cursor's own signature never included.
//
// This module is pure — no kv, no network, no logging. Each site keeps its own kv read/write,
// first-run handling ("no cursor → record the head, scan nothing"), and gap policy ("cursor not
// found within the window" — ROSE logs a kv gap marker + counter, the generic buy bot just warns,
// the burn watcher doesn't check cursorFound at all since a missed burn still gets caught by the
// supply-drop fallback). Only the walk itself is shared.
//
// REPLAY HORIZON (incident 2026-09-17): the ROSE bot had been disarmed for days, so its cursor was
// far behind the pool head. A single poll — fired by a plain GET on its admin route, which ran a
// full cycle "even while disarmed" — walked the whole 100-signature window and posted every buy
// above the floor into the OnlyRose room, one after another. A buy bot exists to announce buys as
// they happen; a resume after a pause (disarm, outage, redeploy) must never narrate history. So
// the walk can take `maxAgeS` + `nowS`: signatures whose blockTime is older than the horizon come
// back in `stale` (the caller marks them seen and steps the cursor over them) instead of `fresh`.
// A signature with no blockTime is treated as fresh — dropping it would lose a real buy, which is
// the worse failure. Without `maxAgeS` the walk is unchanged and `stale` is always empty.
//
// @param {Array<{signature: string, err: any, blockTime?: number}>} sigs - newest-first.
// @param {string|null|undefined} lastSig - the durable cursor (a signature), or falsy if unknown.
// @param {{maxAgeS?: number, nowS?: number}} [opts] - replay horizon in seconds + the clock.
// @returns {{fresh: string[], stale: string[], cursorFound: boolean, head: string|null}}
//   fresh: signatures strictly newer than lastSig, err'd ones dropped, oldest-first, within the
//     horizon when one is given.
//   stale: the same walk's signatures that fell OUTSIDE the horizon, oldest-first (empty without
//     a horizon). The caller marks them seen so the cursor advances past them without posting.
//   cursorFound: whether lastSig was seen in `sigs` (false means either there was no cursor, or
//     it fell outside the window — the caller distinguishes those with its own lastSig check).
//   head: sigs[0].signature, or null if sigs is empty — what a first-run site records as its cursor.
function freshSince(sigs, lastSig, opts) {
  const list = Array.isArray(sigs) ? sigs : [];
  const maxAgeS = opts && Number.isFinite(opts.maxAgeS) && opts.maxAgeS > 0 ? opts.maxAgeS : null;
  const nowS = opts && Number.isFinite(opts.nowS) ? opts.nowS : Math.floor(Date.now() / 1000);
  const fresh = [];
  const stale = [];
  let cursorFound = false;
  for (const s of list) {
    if (s.signature === lastSig) { cursorFound = true; break; }
    if (s.err) continue;
    const bt = Number(s.blockTime);
    if (maxAgeS !== null && Number.isFinite(bt) && bt > 0 && nowS - bt > maxAgeS) stale.push(s.signature);
    else fresh.push(s.signature);
  }
  fresh.reverse();
  stale.reverse();
  return {
    fresh,
    stale,
    cursorFound,
    head: (list[0] && list[0].signature) || null,
  };
}

module.exports = { freshSince };
