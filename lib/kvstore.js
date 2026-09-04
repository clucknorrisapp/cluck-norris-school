// Tiny persistent key-value store, backed by the Railway volume at /data.
// Used for small bits of state that should survive deploys/restarts — currently
// the Telegram auto-post trackers (last message id + last fired hour for each
// recurring post), so the bot can delete its previous message after a deploy
// instead of leaving a straggler, and won't double-post if a deploy lands in a
// firing window. Same graceful-degradation pattern as lib/sigstore.js: if the
// volume isn't mounted/writable, it runs in-memory only and never crashes.
const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR || "/data";
const FILE = path.join(DATA_DIR, "app-state.json");

let state = {};
let persistent = false;
let stateMtime = 0;

(function load() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    persistent = true;
    if (fs.existsSync(FILE)) {
      const o = JSON.parse(fs.readFileSync(FILE, "utf8"));
      if (o && typeof o === "object") state = o;
      try { stateMtime = fs.statSync(FILE).mtimeMs; } catch (_) { stateMtime = 0; }
    }
    console.log(`[kvstore] loaded ${Object.keys(state).length} keys from ${FILE}`);
  } catch (e) {
    console.warn(`[kvstore] volume unavailable (${e.message}) — running in-memory only`);
  }
})();

// Cache invalidation by mtime — the same fix lib/cuna-giveaway.js needed for the same
// reason. This process cached `state` forever and persist() writes the WHOLE blob, so with
// more than one process (Railway) a set() from a stale snapshot silently erased every key
// another process had written since ITS boot. That is how a liquidity-sleeve position mint
// vanished right after a successful open on 2026-08-27 (jup_positionMint → null while the
// position sat on-chain), which would have made the engine open a duplicate from float.
// Re-read when the file has moved on; keep the cache when it hasn't. Not a real lock — two
// writes inside the same instant can still race — but it shrinks the stale window from
// process-lifetime to milliseconds, which is what actually bit.
function refresh() {
  if (!persistent) return;
  try {
    const st = fs.statSync(FILE);
    if (st.mtimeMs === stateMtime) return;
    const o = JSON.parse(fs.readFileSync(FILE, "utf8"));
    if (o && typeof o === "object") { state = o; stateMtime = st.mtimeMs; }
  } catch (_) { /* missing/unreadable — keep the in-memory copy */ }
}

function persist() {
  if (!persistent) return;
  try {
    require("./atomic-write").atomicWriteFileSync(FILE, JSON.stringify(state));
    try { stateMtime = fs.statSync(FILE).mtimeMs; } catch (_) { stateMtime = 0; }
  } catch (e) {
    console.warn(`[kvstore] persist failed: ${e.message}`);
  }
}

module.exports = {
  get: (k, d) => { refresh(); return Object.prototype.hasOwnProperty.call(state, k) ? state[k] : d; },
  set: (k, v) => { refresh(); state[k] = v; persist(); },
};
