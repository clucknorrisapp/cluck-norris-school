// Persistent "consumed payment signatures" store, backed by the Railway volume
// mounted at /data. Its consumer is /api/verify-sol-payment (the SOL tools pass;
// it records "sol:<sig>"), which applies its grant client-side — so without this
// an attacker who sees a valid on-chain payment could replay it to unlock tools
// for free. Marking each transfer signature as redeemed-once closes the realistic
// replay (watch chain → replay later): the legitimate payer redeems first, any
// later replay is rejected. (The retired verify-clkn-payment / send-to-unlock
// endpoint used to be the other consumer; normie-burn keeps its own sibling store.)
//
// File-backed (one tiny JSON array). Loaded into memory on boot, rewritten on
// each new redemption (redemptions are infrequent, single-threaded Node, so a
// full rewrite is safe and cheap). Degrades gracefully to in-memory-only if the
// volume isn't mounted/writable (e.g. local dev) — no crash, just no cross-
// restart persistence in that case.
const fs = require("fs");
const path = require("path");
const { atomicWriteFileSync } = require("./atomic-write");

const DATA_DIR = process.env.DATA_DIR || "/data";
const FILE = path.join(DATA_DIR, "consumed-signatures.json");

let consumed = new Set();
let persistent = false;
let volumeExpected = false; // true once we've successfully reached a writable volume on boot

(function load() {
  // Reaching a writable volume and PARSING the existing file are two distinct steps. The old
  // code set persistent/volumeExpected=true and then parsed inside the same try, so a CORRUPT
  // existing file (torn write from a redeploy SIGKILL) threw into the catch with persistent
  // still true and an empty set — and the first add() then OVERWROTE the file with just the new
  // sig, permanently erasing every consumed signature and re-opening replay of all historical
  // payments. Split the steps and fail closed on corruption.
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    persistent = true;
    volumeExpected = true;
  } catch (e) {
    console.warn(`[sigstore] volume unavailable (${e.message}) — running in-memory only`);
    return;
  }
  if (!fs.existsSync(FILE)) { console.log(`[sigstore] no existing consumed-sig file — starting fresh at ${FILE}`); return; }
  try {
    const arr = JSON.parse(fs.readFileSync(FILE, "utf8"));
    if (!Array.isArray(arr)) throw new Error("not a JSON array");
    consumed = new Set(arr);
    console.log(`[sigstore] loaded ${consumed.size} consumed signatures from ${FILE}`);
  } catch (e) {
    // CORRUPT existing file. Do NOT silently start empty (that re-opens replay). Quarantine a
    // copy and DISABLE persistence so add() fails closed (rejects grants) until an operator
    // restores/clears the file — pausing new unlocks is far safer than allowing free replays.
    persistent = false;
    try { fs.copyFileSync(FILE, `${FILE}.corrupt-${Date.now()}`); } catch (_) {}
    console.error(`[sigstore] CONSUMED-SIG FILE CORRUPT (${e.message}) — persistence DISABLED, unlocks paused (fail-closed). Restore ${FILE} from a good copy, then restart.`);
  }
})();

// ── leg claims ──────────────────────────────────────────────────────────────────
// ONE payment signature can be presented to more than one redeemer (the SOL pass, the SKR pass, the
// public /api/verify-sol-payment) and to more than one wallet named in the same transaction. Each
// consumes a different key, so "was this signature consumed" alone cannot say WHO redeemed it or AS
// WHAT — and a redemption that dies half-way (key A written, key B refused) used to leave a state
// the OTHER redeemer ignored (Codex, #421 round 2: X gets a SOL pass, then Y recovers an SKR pass
// off the same signature). A LEG CLAIM is the single, atomic, first write that settles it: the
// first redeemer to claim a signature owns it as {kind, wallet}; every later presenter either IS
// that kind+wallet (a recovery) or is refused. It is one string in the same durable array
// ("leg:" + sig + "|" + kind + "|" + wallet), so one persist() makes it exist or not exist — there
// is no state in which the kind is recorded and the wallet is not. Base58 contains no "|".
const legs = new Map();   // sig -> { kind, wallet }
for (const k of consumed) {
  if (typeof k !== "string" || !k.startsWith("leg:")) continue;
  const [sig, kind, wallet] = k.slice(4).split("|");
  if (sig && kind && wallet && !legs.has(sig)) legs.set(sig, { kind, wallet });
}
function claimLeg(sig, kind, wallet) {
  if (!sig || !kind || !wallet || /[|]/.test(sig + kind + wallet)) return { ok: false, error: "bad claim" };
  const existing = legs.get(sig);
  if (existing) return { ok: true, claimed: false, leg: existing };   // already owned: the caller compares
  const entry = "leg:" + sig + "|" + kind + "|" + wallet;
  consumed.add(entry);                       // synchronous check-and-insert: two concurrent claims cannot both win
  const ok = persist();
  if (!ok && volumeExpected) { consumed.delete(entry); return { ok: false, unavailable: true, error: "could not record the claim durably" }; }   // fail closed, nothing claimed
  const leg = { kind, wallet };
  legs.set(sig, leg);
  return { ok: true, claimed: true, leg };
}

function persist() {
  if (!persistent) return false;
  try {
    // Atomic replace (temp + rename): a crash mid-write leaves the .tmp, never a
    // half-written FILE that would read back as corrupt (or empty) on the next boot.
    atomicWriteFileSync(FILE, JSON.stringify([...consumed]));
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
  // Atomic test-and-set: records the signature and returns true ONLY if it was
  // newly added (caller may grant). Returns false if it was already consumed
  // (a replay) or the signature is falsy. The check-and-insert is synchronous
  // (no await), so two concurrent redemptions of the same sig can't both win.
  add: (sig) => {
    if (!sig || consumed.has(sig)) return false;
    consumed.add(sig);
    const ok = persist();
    // A7 — FAIL CLOSED: if the volume was expected (production) but the write failed, we cannot
    // durably record this redemption → after a restart it would be replayable. Roll back and
    // refuse the grant rather than hand out a non-durable unlock. (Local dev with no volume —
    // volumeExpected=false — keeps the in-memory-only behavior and still grants.)
    if (!ok && volumeExpected) { consumed.delete(sig); return false; }
    return true;
  },
  // Read-only membership. Lets a caller tell "add() returned false because the sig was already
  // consumed" (a replay, or a legitimate payer recovering their pass) apart from "add() returned
  // false because the store could not record it" (fail-closed above — nothing was consumed).
  has: (sig) => !!sig && consumed.has(sig),
  // The leg claim (see above): claimLeg(sig, kind, wallet) → { ok, claimed, leg } | { ok:false }.
  claimLeg,
  getLeg: (sig) => legs.get(sig) || null,
};
