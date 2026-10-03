// Cluck Norris — Seeker app, Project Burn's UNRESOLVED ATTEMPT record.
//
// ⚠️ Codex on #479 (b0d381a4), P1 — "signature-less wallet errors still permit a second burn." A
// send-capable wallet (signAndSendTransaction, MWA) can broadcast and then throw before it hands
// back the signature. sign.js reports that honestly as `unconfirmed` with `noSignature: true` —
// but Project Burn kept its outcome in React state only and offered "OK" for a signature-less
// unconfirmed result, which cleared the card, restored the burn form and let the same amount be
// burned a second time, permanently. The record below is what stops that: it is written BEFORE
// the wallet is asked (sign.js `beforeSign`, so a one-step sign-and-send wallet has already left
// it behind), the signature is filled in when the wallet returns it (`onSigned`), and the burn
// form stays off until the attempt is RESOLVED by the chain — landed, failed on chain, or (for a
// signature-less record) its blockhash proven dead followed by a balance re-read — or the person
// stops watching through the 10-minute escape hatch. A missing signature is a thing to track,
// never "nothing happened".
//
// Same shape and rules as revoke.js's record (loadRevokePending/saveRevokePending), keyed by
// wallet address; this file is pure (no window at module load) so scripts/seeker-attempt-guard-
// test.cjs can drive it under Node with a fake storage.
//
// Record: { sig (null until the wallet has signed), mint, symbol, decimals, rawAmt, amount,
//           isFullBalance, recentBlockhash, lastValidBlockHeight, wallet, at }

export const BURN_PENDING_KEY = "clkn_seeker_burn_pending";
// Same figure as Swap's PENDING_MANUAL_ESCAPE_MS and revoke.js's REVOKE_PENDING_ESCAPE_MS.
export const BURN_PENDING_ESCAPE_MS = 10 * 60 * 1000;

function store(storage) {
  if (storage) return storage;
  try { return typeof window !== "undefined" && window.localStorage ? window.localStorage : null; } catch (_) { return null; }
}
function readMap(storage) {
  try {
    const st = store(storage);
    const raw = st && st.getItem(BURN_PENDING_KEY);
    const m = raw ? JSON.parse(raw) : null;
    return m && typeof m === "object" && !Array.isArray(m) ? m : {};
  } catch (_) { return {}; }
}
// ⚠️ Writes are VERIFIED by reading back (Swap's savePending rule): `setItem` throws on a full
// quota in most browsers, but some environments silently no-op or truncate, and this record is
// the only thing standing between a lost wallet reply and a second burn. Returns false on any
// failure — the caller passes that to sign.js as "do not ask the wallet".
function writeMap(m, storage) {
  try {
    const st = store(storage);
    if (!st) return false;
    if (Object.keys(m).length) {
      const json = JSON.stringify(m);
      st.setItem(BURN_PENDING_KEY, json);
      return st.getItem(BURN_PENDING_KEY) === json;
    }
    st.removeItem(BURN_PENDING_KEY);
    return true;
  } catch (_) { return false; }
}

function normalise(rec) {
  return {
    sig: rec.sig ? String(rec.sig) : null,
    mint: String(rec.mint || ""),
    symbol: rec.symbol == null ? "" : String(rec.symbol),
    decimals: Number.isInteger(rec.decimals) ? rec.decimals : null,
    rawAmt: rec.rawAmt == null ? null : String(rec.rawAmt),
    amount: typeof rec.amount === "number" && isFinite(rec.amount) ? rec.amount : null,
    isFullBalance: !!rec.isFullBalance,
    recentBlockhash: rec.recentBlockhash ? String(rec.recentBlockhash) : null,
    lastValidBlockHeight: typeof rec.lastValidBlockHeight === "number" && isFinite(rec.lastValidBlockHeight) ? rec.lastValidBlockHeight : null,
    wallet: String(rec.wallet),
    at: typeof rec.at === "number" ? rec.at : Date.now(),
  };
}

// The record for THIS wallet, or null. A record stored for another wallet is never applied.
export function loadBurnPending(wallet, storage) {
  if (!wallet) return null;
  const rec = readMap(storage)[wallet];
  if (!rec || typeof rec !== "object" || rec.wallet !== wallet || !rec.mint) return null;
  return normalise(rec);
}
export function saveBurnPending(rec, storage) {
  if (!rec || !rec.wallet || !rec.mint) return false;
  const m = readMap(storage);
  m[rec.wallet] = normalise(rec);
  return writeMap(m, storage);
}
export function clearBurnPending(wallet, storage) {
  if (!wallet) return;
  const m = readMap(storage);
  if (!(wallet in m)) return;
  delete m[wallet];
  writeMap(m, storage);
}
