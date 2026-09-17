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
let lastPersistError = null;   // the last persist() failure, or null after a write that landed
let loadError = null;          // why the store is in-memory when it should not be (corrupt file), else null

(function load() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(FILE)) {
      // A file that exists but does not parse is NOT an empty store. The old order set
      // `persistent = true` first, so a truncated or half-written app-state.json booted as a
      // healthy, persistent, EMPTY store — the next set() then overwrote the only copy of every
      // ledger (payout journals, accrual days, engine flags) and reported success (deep dive
      // 2026-09-17 P0-005). Now: preserve the file under a new name, stay in-memory, and say so.
      // setVerified() answers false until an operator restores the file, which is what stops a
      // money path from running on a blank ledger.
      const raw = fs.readFileSync(FILE, "utf8");
      let o;
      try { o = JSON.parse(raw); }
      catch (e) {
        const keep = FILE + ".corrupt-" + new Date().toISOString().replace(/[:.]/g, "-");
        try { fs.copyFileSync(FILE, keep); } catch (_) {}
        loadError = `${FILE} is not valid JSON (${e.message}; ${raw.length} bytes) — preserved as ${keep}; running IN-MEMORY, verified writes refuse until the file is restored`;
        console.error(`[kvstore] ${loadError}`);
        return;
      }
      if (o && typeof o === "object") state = o;
      try { stateMtime = fs.statSync(FILE).mtimeMs; } catch (_) { stateMtime = 0; }
    }
    persistent = true;
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
    lastPersistError = null;
  } catch (e) {
    lastPersistError = String(e && e.message || e);
    console.warn(`[kvstore] persist failed: ${e.message}`);
  }
}

// A write a MONEY PATH can trust. set() swallows the persist error, get() answers from memory, and
// isPersistent() only says the directory existed at boot — so "set, then read it back, then check
// isPersistent()" passes with the volume gone (second reviewer, 2026-09-15, reproduced with a
// broken target). This one re-reads the FILE and answers true only when the value is on disk.
// A payout journal row that this returns false for must stop the batch: the transfer may already
// be in flight, and a restart would forget it was ever sent.
function setVerified(k, v) {
  refresh();
  state[k] = v;
  persist();
  if (!persistent || lastPersistError) return false;
  try {
    const o = JSON.parse(fs.readFileSync(FILE, "utf8"));
    return !!o && Object.prototype.hasOwnProperty.call(o, k) && JSON.stringify(o[k]) === JSON.stringify(v);
  } catch (_) { return false; }
}

module.exports = {
  get: (k, d) => { refresh(); return Object.prototype.hasOwnProperty.call(state, k) ? state[k] : d; },
  set: (k, v) => { refresh(); state[k] = v; persist(); },
  // Whether writes actually reach the volume. A money path must refuse to hand out anything
  // payable when this is false: a memory-only store loses the batch record on the next restart
  // and the same money is offered again.
  isPersistent: () => persistent,
  setVerified,
  lastPersistError: () => lastPersistError,
  // Non-null when the store found a file it could not parse at boot (see load()). The server
  // alerts the operator room on it; nothing else should try to "recover" automatically.
  loadError: () => loadError,
};
