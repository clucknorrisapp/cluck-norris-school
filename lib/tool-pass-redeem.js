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
  // THE LEG CLAIM (Codex, #421 round 2). One signature, one owner: the first redeemer to claim it
  // owns it as {kind, wallet} (lib/sigstore.js claimLeg — a single atomic durable write), and every
  // later presenter must BE that kind and wallet or is refused. It is READ first, before any check
  // can depend on a half-written state, and WRITTEN before any other record (the shared "sol:" key
  // is the commit point and follows it). So a redemption that dies between the claim and the commit
  // leaves a signature that only the SAME kind + wallet can finish — never one a different kind or a
  // co-signer can slip into (SKR-partial then SOL, SOL-partial then SKR). Recovery of a consumed
  // signature likewise needs the same kind + wallet.
  if (typeof sigStore.claimLeg !== "function" || typeof sigStore.getLeg !== "function") return { ok: false, status: 503, retry: true, error: "the signature store cannot record who redeemed this payment — nothing was consumed" };
  const myKind = isSkr ? "skr" : "sol";
  const has = (k) => typeof sigStore.has === "function" && sigStore.has(k);
  const alreadyConsumed = has(key);
  const owned = sigStore.getLeg(paySig);
  if (owned && (owned.kind !== myKind || owned.wallet !== wallet)) return { ok: false, status: 409, definitive: true, code: "already_redeemed", error: owned.kind !== myKind ? "this payment was already claimed as a " + owned.kind.toUpperCase() + " payment" : "this payment was already redeemed" };
  if (isSkr) {
    if (alreadyConsumed) {
      // Recovery: only by the claimed payer, on the leg that consumed it (a signature consumed
      // before legs existed, or by the SOL leg, has no matching SKR claim). Its amount and window
      // were checked the first time.
      if (!owned) return { ok: false, status: 409, definitive: true, code: "already_redeemed", error: "this payment was already redeemed" };
    } else {
      if (!t.skr) return { ok: false, status: 200, definitive: true, code: "no_skr_terms", error: "no SKR pass was on offer when this payment landed" };
      if (!quote) {
        // definitive when a quote was PRESENTED and does not verify (a rotated key, a forgery): the
        // payment is real and nothing will ever make that quote verify, so it needs a human, not a
        // retry loop. No quote at all is a client that can still go and fetch the stored one.
        return quoteInvalid
          ? { ok: false, status: 401, definitive: true, code: "skr_quote_invalid", error: "skr quote invalid — request a new one" }
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
  // Claim the leg FIRST (see above). Nothing else has been written; a store that cannot record it
  // durably answers 503 with nothing claimed and nothing consumed.
  if (!owned) {
    const c = sigStore.claimLeg(paySig, myKind, wallet);
    if (!c || !c.ok) return { ok: false, status: 503, retry: true, error: "could not record this payment durably — nothing was consumed; try again in a moment, the same payment will be picked up" };
    if (c.leg.kind !== myKind || c.leg.wallet !== wallet) return { ok: false, status: 409, definitive: true, code: "already_redeemed", error: "this payment was already redeemed" };
  }
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

// The public GET /api/verify-sol-payment consumes the same "sol:" key without going through
// redeemPaidPass, so it takes the SAME leg claim (as {sol, the transaction's payer}) before it
// consumes — otherwise a signature it consumed could be recovered on the SKR leg, or the reverse.
function claimSolLeg(sigStore, sig, payer) {
  if (!payer || !sigStore || typeof sigStore.claimLeg !== "function" || typeof sigStore.getLeg !== "function") return { ok: false, status: 503, error: "This payment cannot be attributed to a wallet right now." };
  const owned = sigStore.getLeg(sig);
  if (owned) return owned.kind === "sol" && owned.wallet === payer ? { ok: true } : { ok: false, status: 409, error: "This payment was already claimed for something else." };
  const c = sigStore.claimLeg(sig, "sol", payer);
  if (!c || !c.ok) return { ok: false, status: 503, error: "Could not record this payment durably — try again in a moment." };
  if (c.leg.kind !== "sol" || c.leg.wallet !== payer) return { ok: false, status: 409, error: "This payment was already claimed for something else." };
  return { ok: true };
}

module.exports = { redeemPaidPass, claimSolLeg, DAY_MS };
