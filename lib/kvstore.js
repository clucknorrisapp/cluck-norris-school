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

(function load() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    persistent = true;
    if (fs.existsSync(FILE)) {
      const o = JSON.parse(fs.readFileSync(FILE, "utf8"));
      if (o && typeof o === "object") state = o;
    }
    console.log(`[kvstore] loaded ${Object.keys(state).length} keys from ${FILE}`);
  } catch (e) {
    console.warn(`[kvstore] volume unavailable (${e.message}) — running in-memory only`);
  }
})();

function persist() {
  if (!persistent) return;
  try {
    fs.writeFileSync(FILE, JSON.stringify(state));
  } catch (e) {
    console.warn(`[kvstore] persist failed: ${e.message}`);
  }
}

module.exports = {
  get: (k, d) => (Object.prototype.hasOwnProperty.call(state, k) ? state[k] : d),
  set: (k, v) => { state[k] = v; persist(); },
  isPersistent: () => persistent,
};
