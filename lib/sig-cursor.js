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
// Verified identical across all three sites before extraction: ROSE and the generic buy bot write
// `if (s.err) continue;` before pushing; the burn watcher writes `if (!s.err) fresh.push(...)` —
// same semantics, just the positive form of the same skip. All three collect newest-first while
// scanning, then reverse once at the end to hand back oldest-first (the order each site processes
// in, oldest transaction first). None of the three ever include the cursor signature itself.
//
// @param {Array<{signature: string, err: any}>} sigs - getSignaturesForAddress result, newest-first.
// @param {string|null|undefined} lastSig - the durable cursor (a signature), or falsy if unknown.
// @returns {{fresh: string[], cursorFound: boolean, head: string|null}}
//   fresh: signatures strictly newer than lastSig, err'd ones dropped, oldest-first.
//   cursorFound: whether lastSig was seen in `sigs` (false means either there was no cursor, or
//     it fell outside the window — the caller distinguishes those with its own lastSig check).
//   head: sigs[0].signature, or null if sigs is empty — what a first-run site records as its cursor.
function freshSince(sigs, lastSig) {
  const list = Array.isArray(sigs) ? sigs : [];
  const fresh = [];
  let cursorFound = false;
  for (const s of list) {
    if (s.signature === lastSig) { cursorFound = true; break; }
    if (s.err) continue;
    fresh.push(s.signature);
  }
  fresh.reverse();
  return {
    fresh,
    cursorFound,
    head: (list[0] && list[0].signature) || null,
  };
}

module.exports = { freshSince };
