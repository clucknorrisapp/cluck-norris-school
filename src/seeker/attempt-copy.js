// The two sentences for a signing ATTEMPT THAT HAS NO SIGNATURE, shared by the Swap and Project
// Burn panes (Codex on #479 at b0d381a4, P1 — "signature-less wallet errors still permit a
// second swap or burn").
//
// A send-capable wallet (signAndSendTransaction, MWA) can broadcast and then throw before it hands
// the signature back. sign.js reports that as `unconfirmed` + `noSignature`; the pane's record of
// the attempt was written BEFORE the wallet was asked (sign.js `beforeSign`), so there is always
// something to track — and these are the only two things the panes may say about it:
//
//   · while it is unresolved: no signature came back, it may still land, check before trying again;
//   · once its blockhash is proven dead (sign.js checkUnsignedPending): it can no longer land, but
//     expiry says NOTHING about whether it landed earlier, so the balance re-read is the only claim.
//
// Never "failed", never "did not land", never a retry button. One module so the key text cannot
// drift between the two panes (the English text IS the i18n key — scripts/seeker-i18n-keys.cjs).
import { t } from "./i18n.js";

export function noSignatureSentence() {
  return t("No signature came back from your wallet. If it already sent this, it may still land — check before trying again.");
}
export function releasedSentence() {
  return t("That attempt can no longer land, and with no signature there is nothing to look up — whether it landed earlier can't be said from here. Your balance was just re-read from the chain; that is the record.");
}
