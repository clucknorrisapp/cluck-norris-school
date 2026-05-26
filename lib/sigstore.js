// Persistent "consumed payment signatures" store, backed by the Railway volume
// mounted at /data. The verify-clkn-payment endpoint applies its grants
// client-side, so without this an attacker who sees a valid on-chain unlock
// amount could replay it to unlock tools for free. Marking each transfer
// signature as redeemed-once closes the realistic replay (watch chain → replay
// later): the legitimate payer redeems first, any later replay is rejected.
//
// File-backed (one tiny JSON array). Loaded into memory on boot, rewritten on
// each new redemption (redemptions are infrequent, single-threaded Node, so a
// full rewrite is safe and cheap). Degrades gracefully to in-memory-only if the
// volume isn't mounted/writable (e.g. local dev) — no crash, just no cross-
// restart persistence in that case.
const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR || "/data";
const FILE = path.join(DATA_DIR, "consumed-signatures.json");

let consumed = new Set();
let persistent = false;

(function load() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    persistent = true;
    if (fs.existsSync(FILE)) {
      const arr = JSON.parse(fs.readFileSync(FILE, "utf8"));
      if (Array.isArray(arr)) consumed = new Set(arr);
    }
    console.log(`[sigstore] loaded ${consumed.size} consumed signatures from ${FILE}`);
  } catch (e) {
    console.warn(`[sigstore] volume unavailable (${e.message}) — running in-memory only`);
  }
})();

function persist() {
  if (!persistent) return;
  try {
    fs.writeFileSync(FILE, JSON.stringify([...consumed]));
  } catch (e) {
    console.warn(`[sigstore] persist failed: ${e.message}`);
  }
}

module.exports = {
  has: (sig) => consumed.has(sig),
  add: (sig) => { if (sig && !consumed.has(sig)) { consumed.add(sig); persist(); } },
  size: () => consumed.size,
  isPersistent: () => persistent,
};
