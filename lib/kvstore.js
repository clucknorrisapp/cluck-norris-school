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
// Why persistence is off, when it is. null = persisting normally. "no-volume" is the benign
// local-dev case; "corrupt" is an OPERATOR EMERGENCY — see health() and the load() note below.
// Same shape as lib/credentials.js's health(), so a caller can check either store the same way.
let degraded = null;
let lastPersistError = null;

(function load() {
  // Reaching a writable volume and PARSING the existing file are two distinct steps (same
  // bug class as lib/sigstore.js). The old code set persistent=true and then parsed inside
  // the same try, so a CORRUPT existing file left persistent true with an empty state — and
  // the next set() then OVERWROTE the file with just that one key, wiping jup_positionMint,
  // ratchetOverrides:<project>, diplomaTreeV1, schoolAirdropPaidV1 and everything else this
  // store holds. Split the steps and fail closed on corruption.
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    persistent = true;
  } catch (e) {
    degraded = "no-volume";
    console.warn(`[kvstore] volume unavailable (${e.message}) — running in-memory only`);
    return;
  }
  if (!fs.existsSync(FILE)) { console.log(`[kvstore] no existing state file — starting fresh at ${FILE}`); return; }
  try {
    const o = JSON.parse(fs.readFileSync(FILE, "utf8"));
    if (!o || typeof o !== "object" || Array.isArray(o)) throw new Error("not a JSON object");
    state = o;
    try { stateMtime = fs.statSync(FILE).mtimeMs; } catch (_) { stateMtime = 0; }
    console.log(`[kvstore] loaded ${Object.keys(state).length} keys from ${FILE}`);
  } catch (e) {
    // CORRUPT existing file. Do NOT silently start empty (the next set() would overwrite it).
    // Quarantine a copy and DISABLE persistence so set() stays in-memory-only until an
    // operator restores the file — losing durability until restart is far safer than
    // silently destroying every other key this store holds.
    persistent = false;
    degraded = "corrupt";
    try { fs.copyFileSync(FILE, `${FILE}.corrupt-${Date.now()}`); } catch (_) {}
    console.error(`[kvstore] STATE FILE CORRUPT (${e.message}) — persistence DISABLED (fail-closed). Restore ${FILE} from a good copy, then restart.`);
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
    lastPersistError = e.message;
    console.warn(`[kvstore] persist failed: ${e.message}`);
  }
}

// Is a set() written right now actually going to survive a redeploy? The engine's position
// pointers (jup_positionMint, sol_positionMint, tw_wideMint, ratchetOverrides:<project>) live
// in this store with no other copy anywhere; when this says ok:false those keys are in-memory
// only and vanish at the next deploy, so a caller (e.g. /api/whirlpool/vault/status) should
// surface it rather than let it live only in a console.error nobody is watching. `reason` is
// "corrupt" (operator emergency — restore the quarantined file), "no-volume" (local dev), or
// "write-failed" (the volume went read-only / full after boot).
function health() {
  const reason = degraded || (lastPersistError ? "write-failed" : null);
  return { ok: persistent && !lastPersistError, persistent, reason, detail: lastPersistError || null };
}

module.exports = {
  get: (k, d) => { refresh(); return Object.prototype.hasOwnProperty.call(state, k) ? state[k] : d; },
  set: (k, v) => { refresh(); state[k] = v; persist(); },
  isPersistent: () => persistent,
  health,
};
