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
// Terms (rev 2 of this module, second reviewer): the pass length and the minimum amount come
// from lib/tool-pass-terms.js resolved at the payment's block time — never from today's config —
// so changing the offer later neither extends nor shortens a pass already bought. A payment the
// chain has not timestamped is "not verifiable yet" (retry, nothing consumed), never guessed
// from a clock or an audit record: a guess is exactly the second write this module exists to
// remove, and a retry against a guess extends the pass.
//
// Failure semantics, all of which the unit test pins:
//   - a different payer          → refused, NOTHING consumed
//   - no block time yet          → refused as retryable, NOTHING consumed
//   - below the minimum in force AT PAYMENT TIME → refused, NOTHING consumed
//   - a payment older than the pass it bought → refused, NOTHING consumed
//   - the sig store cannot record durably (fail-closed add) → 503, NOTHING consumed, retry later
//   - first redemption           → pass, recovered:false
//   - any later redemption by the same payer → pass, recovered:true, SAME expiry, under the
//     SAME terms even if the schedule has since gained a new entry
//   - the audit write throwing   → does not affect the pass
"use strict";

const terms = require("./tool-pass-terms");
const DAY_MS = terms.DAY_MS;

/**
 * @param {object} a
 * @param {string} a.paySig      the payment transaction signature (already length-checked)
 * @param {string} a.wallet      the wallet that proved itself on this request
 * @param {object} a.verified    result of verifySolPaymentTx: { ok, lamports, payer, blockTimeMs }
 * @param {object} a.sigStore    { add(sig) → bool, has(sig) → bool }
 * @param {object} [a.kv]        { set(k,v) } — audit record only, optional, never read
 * @param {function} [a.termsAt] (blockTimeMs) → { days, lamports }; defaults to the schedule
 * @param {number} [a.now]       Date.now() override for tests
 */
function redeemPaidPass({ paySig, wallet, verified, sigStore, kv, termsAt, now }) {
  now = Number.isFinite(now) ? now : Date.now();
  termsAt = termsAt || terms.termsAt;
  if (!verified || !verified.ok) return { ok: false, status: 200, error: (verified && verified.error) || "payment not verified", lamports: verified && verified.lamports };
  // Bound to the PAYER: a signature seen on an explorer is worthless to anyone but the wallet
  // that paid, and that wallet just proved itself. Refused BEFORE anything is consumed.
  if (!verified.payer || verified.payer !== wallet) return { ok: false, status: 403, error: "payment was made by a different wallet" };
  const startAt = Number(verified.blockTimeMs);
  if (!(startAt > 0)) return { ok: false, status: 200, retry: true, error: "the chain has not timestamped this payment yet — try again in a moment; nothing was consumed" };
  const t = termsAt(startAt);
  if (!(Number(verified.lamports) >= t.lamports)) return { ok: false, status: 200, error: "amount too low", lamports: verified.lamports, needed: t.lamports };
  const expiresAt = startAt + t.days * DAY_MS;
  if (expiresAt <= now) return { ok: false, status: 200, error: "this payment is older than the pass it bought — the pass has already expired" };
  const key = "sol:" + paySig;
  const first = sigStore.add(key);
  if (!first && !sigStore.has(key)) {
    // add() refused without the key being consumed: the store could not record durably (its
    // fail-closed path). Handing out a pass now would be a non-durable grant that becomes a free
    // replay after a restart. Refuse; nothing was consumed; the payer retries and recovers.
    return { ok: false, status: 503, retry: true, error: "could not record this payment durably — nothing was consumed; try again in a moment, the same payment will be picked up" };
  }
  if (first && kv) {
    // Audit line only — never read back by this module.
    try { kv.set("toolPassPaid:" + paySig, { wallet, startAt, expiresAt, days: t.days, lamports: verified.lamports, at: now }); } catch (_) { /* audit only */ }
  }
  return { ok: true, status: 200, recovered: !first, expiresAt, ttlMs: expiresAt - now, lamports: verified.lamports, termDays: t.days,
    days: Math.max(1, Math.round((expiresAt - now) / DAY_MS)) };
}

module.exports = { redeemPaidPass, DAY_MS };
