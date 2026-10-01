"use strict";
// The program version IN FORCE on a given day: the last version whose effectiveFrom is on or
// before that day. Pure — no crypto, no store — so the browser bundle (hub-verify-src) and the
// standalone @clkn/hub-verify package can share it with lib/hub/project.js, which re-exports it.
// (W3 wired lib/hub/reproduce.js to look up the version a journal-backed row was paid under;
// requiring project.js from there dragged Node's crypto into a browser-safe module.)
function versionFor(state, periodKey) {
  const day = String(periodKey).slice(0, 10);
  const versions = Array.isArray(state && state.versions) ? state.versions : [];
  let hit = null;
  for (const v of versions) if (v.effectiveFrom <= day) hit = v;
  return hit;
}
module.exports = { versionFor };
