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
const skrPass = require("./tool-pass-skr");
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
 *
 * The SKR leg (the Seeker app, docs/SEEKER_SKR_PASS_DESIGN.md) is the same function with
 * `verified.kind === "skr"` (lib/tool-pass-skr.js verifySkrPaymentTx) plus:
 * @param {object} [a.quote]        verifySkrQuote's answer { amountRaw, iat, exp }, or null
 * @param {boolean} [a.quoteInvalid] a quote WAS presented and did not verify (HMAC / purpose / wallet)
 *
 * SKR differences, and nothing else: the minimum is the QUOTE's amountRaw (the schedule only says
 * whether an SKR term exists at the payment's block time), the payment must sit inside the quote's
 * two-sided window on CHAIN time, and a signature that is ALREADY consumed is recovered by the
 * same payer with no quote at all (the amount and window were checked when it was first consumed).
 * Both legs share the "sol:" + sig namespace, so one signature can never buy twice across them.
 */
function redeemPaidPass({ paySig, wallet, verified, sigStore, kv, termsAt, now, usedElsewhere, quote, quoteInvalid }) {
  now = Number.isFinite(now) ? now : Date.now();
  termsAt = termsAt || terms.termsAt;
  if (!verified || !verified.ok) {
    const out = { ok: false, status: (verified && verified.status) || 200, error: (verified && verified.error) || "payment not verified", lamports: verified && verified.lamports };
    for (const k of ["retry", "definitive", "code"]) if (verified && verified[k] !== undefined) out[k] = verified[k];
    return out;
  }
  const isSkr = verified.kind === "skr";
  // Bound to the PAYER: a signature seen on an explorer is worthless to anyone but the wallet
  // that paid, and that wallet just proved itself. Refused BEFORE anything is consumed.
  if (!verified.payer || verified.payer !== wallet) return { ok: false, status: 403, definitive: true, code: "different_wallet", error: "payment was made by a different wallet" };
  const startAt = Number(verified.blockTimeMs);
  if (!(startAt > 0)) return { ok: false, status: 200, retry: true, code: "no_block_time", error: "the chain has not timestamped this payment yet — try again in a moment; nothing was consumed" };
  const t = termsAt(startAt);
  const key = "sol:" + paySig;
  const alreadyConsumed = typeof sigStore.has === "function" && sigStore.has(key);
  if (isSkr) {
    // A consumed signature is a recovery: it passed the amount and window checks the first time.
    if (!alreadyConsumed) {
      if (!t.skr) return { ok: false, status: 200, definitive: true, code: "no_skr_terms", error: "no SKR pass was on offer when this payment landed" };
      if (!quote) {
        return quoteInvalid
          ? { ok: false, status: 401, code: "skr_quote_invalid", error: "skr quote invalid — request a new one" }
          : { ok: false, status: 400, code: "skr_needs_quote", error: "skr payment needs its quote" };
      }
      const paid = /^\d+$/.test(String(verified.amountRaw)) ? BigInt(verified.amountRaw) : 0n;
      if (paid < BigInt(quote.amountRaw)) return { ok: false, status: 200, definitive: true, code: "amount_too_low", error: "amount too low", amountRaw: String(verified.amountRaw), needed: quote.amountRaw };
      const outside = skrPass.checkPaymentWindow(quote, startAt);
      if (outside) return { ok: false, status: 200, definitive: true, code: "outside_window", error: outside };
    }
  } else if (!(Number(verified.lamports) >= t.lamports)) {
    return { ok: false, status: 200, error: "amount too low", lamports: verified.lamports, needed: t.lamports };
  }
  const expiresAt = startAt + t.days * DAY_MS;
  if (expiresAt <= now) return { ok: false, status: 200, definitive: true, code: "pass_expired", error: "this payment is older than the pass it bought — the pass has already expired" };
  // A payment already claimed as a Lock-to-Earn platform month (lib/hub/routes.js) lands in the
  // SAME wallet and clears the pass amount many times over — it must not also buy a tools pass.
  if (typeof sigStore.has === "function" && sigStore.has("hub-access:" + paySig)) return { ok: false, status: 409, definitive: true, code: "used_elsewhere", error: "this payment was already used for a platform-access month" };
  // The hub's durable truth is its registry, not the signature store (which can fail to record);
  // the caller hands in that check so one payment can never buy a month AND a pass.
  try { if (typeof usedElsewhere === "function" && usedElsewhere(paySig)) return { ok: false, status: 409, definitive: true, code: "used_elsewhere", error: "this payment was already used for a platform-access month" }; } catch (_) { /* a broken check must not grant */ return { ok: false, status: 503, retry: true, error: "could not check the payment against the platform ledger — try again" }; }
  const first = sigStore.add(key);
  if (!first && !sigStore.has(key)) {
    // add() refused without the key being consumed: the store could not record durably (its
    // fail-closed path). Handing out a pass now would be a non-durable grant that becomes a free
    // replay after a restart. Refuse; nothing was consumed; the payer retries and recovers.
    return { ok: false, status: 503, retry: true, error: "could not record this payment durably — nothing was consumed; try again in a moment, the same payment will be picked up" };
  }
  if (first && kv) {
    // Audit line only — never read back by this module.
    try {
      kv.set("toolPassPaid:" + paySig, isSkr
        ? { wallet, startAt, expiresAt, days: t.days, kind: "skr", amountRaw: String(verified.amountRaw), quoteAmountRaw: quote ? quote.amountRaw : null, at: now }
        : { wallet, startAt, expiresAt, days: t.days, lamports: verified.lamports, at: now });
    } catch (_) { /* audit only */ }
  }
  return { ok: true, status: 200, recovered: !first, expiresAt, ttlMs: expiresAt - now, termDays: t.days,
    ...(isSkr ? { kind: "skr", amountRaw: String(verified.amountRaw) } : { lamports: verified.lamports }),
    days: Math.max(1, Math.round((expiresAt - now) / DAY_MS)) };
}

module.exports = { redeemPaidPass, DAY_MS };
