// Paid tools pass — redemption of a verified SOL payment, as a pure function.
//
// Why this exists (second reviewer, 2026-09-11): the first cut consumed the payment signature in
// the sig store and THEN wrote a recoverable entitlement to the kv store — two files, two writes,
// no atomicity. A crash between them (or kvstore's swallowed persist failure) left a consumed
// payment with no pass to recover: "already redeemed", and the payer was out 0.05 SOL.
//
// The fix is to stop needing a second write. The entitlement is a CHAIN FACT: the pass belongs to
// the wallet that paid (the transaction's fee payer, already verified by the caller) and runs for
// TOOLGATE.days from the payment's block time. Given those two facts, the only durable state the
// server needs is "this signature has been consumed" — a single test-and-set in the sig store —
// and RECOVERY is simply: the same verified payer presenting the same signature again gets the
// same pass with the same expiry, however many times, on whichever device. Nobody else gets
// anything (they were refused before the sig store was touched). The kv record that is still
// written is an audit line, not something recovery depends on.
//
// Failure semantics, all of which the unit test pins:
//   - a different payer          → refused, NOTHING consumed
//   - a payment older than the pass length → refused, NOTHING consumed (the pass it bought is over)
//   - the sig store cannot record durably (fail-closed add) → 503, NOTHING consumed, retry later
//   - first redemption           → pass, recovered:false
//   - any later redemption by the same payer → pass, recovered:true, SAME expiry
//   - the audit write throwing   → does not affect the pass
"use strict";

const DAY_MS = 24 * 3600e3;

/**
 * @param {object} a
 * @param {string} a.paySig      the payment transaction signature (already length-checked)
 * @param {string} a.wallet      the wallet that proved itself on this request
 * @param {object} a.verified    result of verifySolPaymentTx: { ok, lamports, payer, blockTimeMs? }
 * @param {number} a.days        pass length in days (TOOLGATE.days)
 * @param {object} a.sigStore    { add(sig) → bool, has(sig) → bool }
 * @param {object} [a.kv]        { get(k,d), set(k,v) } — audit record only, optional
 * @param {number} [a.now]       Date.now() override for tests
 */
function redeemPaidPass({ paySig, wallet, verified, days, sigStore, kv, now }) {
  now = Number.isFinite(now) ? now : Date.now();
  if (!verified || !verified.ok) return { ok: false, status: 200, error: (verified && verified.error) || "payment not verified", lamports: verified && verified.lamports };
  // Bound to the PAYER: a signature seen on an explorer is worthless to anyone but the wallet
  // that paid, and that wallet just proved itself. Refused BEFORE anything is consumed.
  if (!verified.payer || verified.payer !== wallet) return { ok: false, status: 403, error: "payment was made by a different wallet" };
  const key = "sol:" + paySig;
  // The pass runs from the moment the payment landed. No block time (should not happen for a
  // confirmed transaction) → the audit record's first-seen time if we have one, else now; that
  // keeps a retry from extending the pass.
  const audit = kv ? safeGet(kv, "toolPassPaid:" + paySig) : null;
  const startAt = Number(verified.blockTimeMs) > 0 ? Number(verified.blockTimeMs)
    : (audit && Number(audit.startAt) > 0 ? Number(audit.startAt) : now);
  const expiresAt = startAt + days * DAY_MS;
  if (expiresAt <= now) return { ok: false, status: 200, error: "this payment is older than the pass it bought — the pass has already expired" };
  const first = sigStore.add(key);
  if (!first && !sigStore.has(key)) {
    // add() refused without the key being consumed: the store could not record durably (its
    // fail-closed path). Handing out a pass now would be a non-durable grant that becomes a free
    // replay after a restart. Refuse; nothing was consumed; the payer retries and recovers.
    return { ok: false, status: 503, error: "could not record this payment durably — nothing was consumed; try again in a moment, the same payment will be picked up" };
  }
  if (first && kv) {
    // Audit line only. Recovery never reads it for the expiry when a block time exists.
    try { kv.set("toolPassPaid:" + paySig, { wallet, startAt, expiresAt, lamports: verified.lamports, at: now }); } catch (_) { /* audit only */ }
  }
  return { ok: true, status: 200, recovered: !first, expiresAt, ttlMs: expiresAt - now, lamports: verified.lamports,
    days: Math.max(1, Math.round((expiresAt - now) / DAY_MS)) };
}

function safeGet(kv, k) { try { return kv.get(k, null); } catch (_) { return null; } }

module.exports = { redeemPaidPass, DAY_MS };
