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
  if (!persistent) return false;
  try {
    fs.writeFileSync(FILE, JSON.stringify([...consumed]));
    return true;
  } catch (e) {
    // A silent persist failure is dangerous: the in-memory guard still works until
    // the next restart, after which the consumed set is empty and every prior
    // signature becomes replayable. Surface it loudly and stop claiming durability.
    persistent = false;
    console.error(`[sigstore] persist FAILED (${e.message}) — durability lost; redemptions are now in-memory only until restart`);
    return false;
  }
}

module.exports = {
  has: (sig) => consumed.has(sig),
  // Atomic test-and-set: records the signature and returns true ONLY if it was
  // newly added (caller may grant). Returns false if it was already consumed
  // (a replay) or the signature is falsy. The check-and-insert is synchronous
  // (no await), so two concurrent redemptions of the same sig can't both win.
  add: (sig) => {
    if (!sig || consumed.has(sig)) return false;
    consumed.add(sig);
    persist();
    return true;
  },
  size: () => consumed.size,
  isPersistent: () => persistent,
};
