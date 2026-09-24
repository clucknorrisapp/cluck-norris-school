# Seeker app — pay the 7-day tools pass in SKR

**Owner decision, 2026-09-24:** *"a dollar in SKR would be plenty for 7 day pass."* And, same
day: *"I do not want to collect any platform fee"* (that one is about the swap; recorded in
`docs/SEEKER_SWAP_DESIGN.md`).

Today the paid pass is 0.05 SOL for 7 days, verified by the server as a SOL transfer to the
unlock wallet, with the terms an append-only schedule in `lib/tool-pass-terms.js` resolved at
the payment's block time. The Seeker app shows that price but cannot pay it — the pass sheet
says *"that payment flow isn't built into this app yet"*. This adds the in-app payment, in SKR,
at one US dollar's worth, and leaves the SOL price and the website untouched.

This is a MONEY PATH (a real transfer, a credential issued for it). Same treatment as the swap:
this design, a builder that follows it, a read-only adversarial review, the owner's device test
before promote. It starts AFTER PR #420 (the swap) has merged — both touch `server.js`'s
tool-gate block and `src/seeker/passgate.jsx`.

## The problem a dollar price creates, and the answer

The schedule's SOL term is a fixed lamport amount, checked against the transaction's own amount
at the block time's terms. "A dollar in SKR" is a USD figure: the SKR amount moves with the price,
and the server must be able to verify LATER that what landed was the right amount THEN — without
storing a price history and without trusting the client's number.

Answer: **a server-signed quote.** The app asks for an SKR quote, the server computes the SKR
amount from its own sanity-banded SKR price (the same `toolGatePrice.skrUsd` the holdings door
uses; `lib/tool-pass-qualify.js` `acceptPrice`) and returns it inside an HMAC token that pins
`{ wallet, amountRaw, expiresAt }`. The app pays exactly that amount and hands the token back with
the payment signature. The server verifies the token, then verifies on-chain that at least
`amountRaw` of SKR reached the unlock wallet from that payer, in a transaction whose block time
is before the quote expired. The price never needs to be remembered; the quote is the record.
A quote is good for 10 minutes. No SKR price → no quote (503, said plainly) — SKR never graces
(the door rule), so a missing price never becomes a free pass or a guessed amount.

## Terms schedule (`lib/tool-pass-terms.js`)

Append one entry (never edit the 2026-08-18 one):
```js
Object.freeze({ from: Date.UTC(2026, 8, 25), days: 7, lamports: 50_000_000, skr: Object.freeze({ usd: 1 }) }),
```
`from` is the deploy day (set it to the actual promote instant when known; a payment landing
before it resolves to the previous entry, which has no `skr`, and is refused — a payment cannot
be made before the app that makes it exists, so this only ever bites a forged one). Validation:
when `skr` is present, `usd` must be a finite positive number. `termsAt`/`current` unchanged.
`scripts/tool-pass-terms-test.cjs` (create if absent) pins: ascending `from`, the old entry
intact, `current().skr.usd === 1`, `termsAt(before).skr === undefined`.

## Server (`server.js`, tool-gate block ~9622–10260; pure logic in `lib/`)

### Receiver
The SOL unlock wallet `SOL_UNLOCK_WALLET` (`7LHBcRYosycMBwBqxBHeRiDQohYzpppDALKYVT4TNY5H`) is the
receiver for SKR too — its associated token account for the SKR mint under whichever token
program SKR uses (the builder reads the mint account once and caches `program` + `decimals`;
never assumes legacy SPL). The app's payment transaction includes
`createAssociatedTokenAccountIdempotent` for that ATA before the transfer, so the first ever
payment creates it (the payer funds the rent, ~0.002 SOL, shown on the confirm sheet) and every
later one is a no-op. ⚠️ Do not create the ATA server-side with any key: the server signs
nothing here.

### `GET /api/tool-gate/skr-quote?wallet=`  (rate-limited like `/challenge`; in `SEEKER_API_RE`)
```
200 { success:true, mint, decimals, program, usd:1, priceUsd, amountRaw:"<string>",
      amountUi:"<string>", days:7, receiver:SOL_UNLOCK_WALLET, receiverAta, expiresAt,
      quote:"<token>" }
503 { success:false, error:"skr_price_unavailable" }   — no sanity-banded SKR price right now
400 { success:false, error:"need wallet" }
```
`amountRaw = ceil(usd / priceUsd × 10^decimals)` as an integer string (BigInt math, never a
float multiply on the final step). Token: `body = base64url({ t:"tools-skr", w:wallet,
a:amountRaw, iat, exp })`, `sig = HMAC-sha256(PREMIUM_ACCESS_KEY, "tools-skr." + body)` — the
same scheme as `issuePayIntent`, its own purpose string so a pay-intent or a tools token can
never be presented as a quote. `iat` is the issue instant, `exp = iat + 10 min`. Add
`issueSkrQuote` / `verifySkrQuote` beside them; `verifySkrQuote` returns `{ amountRaw, iat, exp }`
when the HMAC, purpose and wallet all match — **it does NOT compare `exp` to the current time**
(Codex round 27, finding 4): a quote's timing is judged against the PAYMENT's chain timestamp
in step 3, never against the clock at verification, so a payment made at minute nine and
redeemed at minute eleven is honoured. The window has BOTH ends (finding 3): the payment's
block time must satisfy `iat − 2 min ≤ blockTimeMs ≤ exp + 5 min`. Without the lower bound a
transfer sent earlier and too small could be redeemed later against a cheaper quote after the
SKR price rose.

### `POST /api/tool-gate/session` — the SKR leg
Body gains `skrQuote`. When `paySig` and `skrQuote` are both present:
1. `verifySkrQuote(skrQuote, wallet)` — fail → 401 `skr quote invalid or expired — request a new one`.
2. `verifySkrPaymentTx(paySig, wallet)` (new, beside `verifySolPaymentTx`): `getTransaction`
   jsonParsed (`maxSupportedTransactionVersion:1`, `confirmed`); refuse on `meta.err`. **The
   payer is the wallet whose SKR left, not the fee payer** (Codex round 27, finding 2: wallet X
   can pay the fee while wallet Y supplies the tokens — the same trap the airdrop receipts closed
   with "funding = the operator's own balance change"). From `meta.preTokenBalances` /
   `postTokenBalances`, keyed by `owner` + `mint` (never account index — a look-alike account is
   the obvious forgery), compute two BigInt deltas for `mint === SKR_MINT`: `outRaw` = the
   DECREASE across every account owned by the proven `wallet`, and `inRaw` = the INCREASE across
   every account owned by `SOL_UNLOCK_WALLET`. Both must be ≥ the quoted amount; a transaction
   where the receiver's balance rose but the proven wallet's did not fall by that much is refused
   ("payment was funded by a different wallet"). As a second, independent check, the parsed
   instructions must contain an SPL `transfer`/`transferChecked` of the SKR mint whose
   `authority`/`source` owner is `wallet` and whose destination is owned by `SOL_UNLOCK_WALLET`;
   its `amount` ≥ quoted. Returns `{ ok, kind:"skr", amountRaw: min(outRaw, inRaw), payer:
   wallet, feePayer: accountKeys[0], blockTimeMs }` — `payer` is only ever set when the
   token-balance evidence names that wallet, so `redeemPaidPass`'s existing "payer must equal the
   proven wallet" rule keeps its meaning.
3. `redeemPaidPass(...)` — extended, still pure: `verified.kind === "skr"` uses the quote's
   `amountRaw` as the minimum (`BigInt(verified.amountRaw) >= BigInt(quote.amountRaw)`),
   requires `termsAt(blockTimeMs).skr` to exist, requires the payment window
   `quote.iat − 2 min ≤ blockTimeMs ≤ quote.exp + 5 min` judged on CHAIN time only (a payment
   that landed after the quote expired was priced on a stale number, and one that landed before
   the quote was issued was never priced by it → refused, nothing consumed; the person re-quotes
   and re-pays, and the old signature stays unconsumed and unusable because it is refused before
   the store is touched), and everything else identical: payer must equal the
   proven wallet, block time required, older-than-its-pass refused, hub-access cross-check,
   the `"sol:" + sig` namespace (a signature is unique; one namespace means one signature can
   never buy twice across SOL and SKR), fail-closed store → 503 nothing consumed.
   **Recovery without a quote:** the same payer presenting the same signature again (lost
   response, other device) may no longer hold the quote. When `sigStore.has("sol:"+sig)` is
   already true and the payer matches, the pass is recovered from the audit-free chain facts
   exactly as today (block time + the SKR term's days); the amount check is skipped because it
   was passed when the signature was first consumed. A signature NOT yet consumed with no quote
   → 400 `skr payment needs its quote`.
4. Answer `{ success:true, via:"paid-skr", recovered, amountRaw, termDays, pass, days }`.
The audit line `toolPassPaid:<sig>` records `{ wallet, startAt, expiresAt, days, kind:"skr",
amountRaw, quoteAmountRaw, at }`.

`/api/verify-sol-payment` is NOT extended — it is the website's SOL path and stays SOL-only.

### `GET /api/tool-gate/config`
The `skr` block gains `pass: { usd: current().skr.usd, days: current().days }` when the current
term carries `skr`; the app renders the sentence from it and never hardcodes 1 or 7.

## App (`src/seeker/passgate.jsx`, one new file `src/seeker/skr-pay.js`)

The pass sheet's "isn't built into this app yet" line goes. After `insufficient_holdings` (the
server already returns `payIntent` with that answer), the sheet shows:

> Pay about {skr} SKR (around ${usd}) for a {days}-day pass to all of them, in this app.
> [Pay in SKR]   [Swap for SKR in this app →]

Flow on tap (`src/seeker/skr-pay.js`, thin — the seam does the signing):
1. `GET /api/tool-gate/skr-quote?wallet=` → amounts + `quote`. 503 → `Unavailable` copy: "SKR
   pricing is unavailable right now — try again in a minute." (never a guessed amount).
2. Read the payer's SKR balance on-chain (`getTokenAccountsByOwner` for the SKR mint under both
   programs via `/api/helius-rpc`). Below `amountRaw` → the sheet says so and the swap link is
   the way forward (`/tools/swap?out=SKR`). Not a dead end.
3. Shared `Confirm` sheet: pay {amountUi} SKR (≈ $1), 7-day pass, to {receiver short}, "+ about
   0.002 SOL once, to open the receiving account" when `receiverAta` does not exist yet (the
   quote route says whether it exists: `receiverAtaExists`).
4. `signSendConfirm({ provider, owner, build })` where `build` returns a legacy `Transaction`:
   `createAssociatedTokenAccountIdempotentInstruction(payer, receiverAta, receiver, mint, program)`
   + `createTransferCheckedInstruction(payerAta, mint, receiverAta, payer, amountRaw, decimals,
   program)` from the `splToken` shim (`splTokenShim()` in `sign.js` — the Airdropper already
   sends tokens through it; confirm both instruction builders exist in
   `public/airdrop-engine.js`'s shim before relying on them, and never call a web3.js layout
   encoder in the page — AGENTS.md). `feePayer` = payer.
5. **Persist BEFORE redeeming** (Codex round 27, finding 5): the moment `signSendConfirm`
   returns a signature — `sent` OR `unconfirmed` — write `{ wallet, paySig, skrQuote, payIntent,
   at }` to localStorage under the wallet (mirror `cluck-gate.js`'s pending-pay record shape so a
   recovered payment is found the same way). First redemption needs the quote, and a confirmed
   payment whose redemption request then fails (network, 5xx, closed app) must still be
   redeemable. Then: `sent` → `POST /api/tool-gate/session { wallet, payIntent, paySig,
   skrQuote }` → `CluckGate.grant(days, "paid-skr", pass)` → unlocked → clear the record.
   `unconfirmed` → show "Your payment may still be landing — check it before paying again" with
   a **Check payment** button that re-posts the stored record. A redemption answer that is a
   RETRYABLE refusal (the chain has not timestamped it yet, the store could not record, a
   transport failure) keeps the record. The record is cleared only on a verified grant or a
   DEFINITIVE refusal (a different wallet funded it, amount below the quote, outside the payment
   window, signature already used elsewhere) — and a definitive refusal is shown with its reason
   so the person knows that transfer will never buy a pass. `failed` (nothing landed, the node
   refused it) → nothing stored, the error, retry allowed. `declined` → back to the sheet. On
   reopen, a stored record for this wallet is re-posted automatically before anything else, like
   `cluck-gate.js` does; a stored quote that has expired is still sent — the server judges the
   payment by chain time, not by the clock.
6. A session answer of `pay intent expired` → re-run the signed challenge (the existing
   `checkHolder` path) which returns a fresh `payIntent`, then re-post with the same signature.

Copy: facts only. The amount, the dollar figure the server priced it at, the days. No "cheaper
than SOL", no value talk.

## i18n, CORS, inventory, edition locks
- New strings through `t()`/`tf()`, six languages via the keys/merge scripts; `en.json` never.
- `/api/tool-gate/skr-quote` added to `SEEKER_API_RE`; the CORS test derives the rest.
- `docs/SEEKER_DEMO_INVENTORY.md`: the pass sheet's row now "signs: yes (SKR pass payment via
  signSendConfirm)".
- `store-edition/store-edition.json` `forbidden` gains `"skr-quote"` — the education edition
  never pays anything.

## Tests
- `scripts/tool-pass-redeem-test.cjs` gains the SKR cases: quote amount honoured (exact, above,
  below → refused nothing consumed); block time after `exp` + 5 min → refused; block time before
  `iat` − 2 min → refused (the short-payment-then-cheaper-quote replay, finding 3); block time at
  minute nine redeemed at minute eleven with `now` past `exp` → HONOURED (finding 4); wrong
  payer → refused; fee payer X with token source Y where X is the proven wallet → refused
  (finding 2); recovery without quote after consumption → recovered:true same expiry;
  unconsumed + no quote → refused; hub-access collision → 409; fail-closed store → 503.
- New `scripts/tool-pass-skr-test.cjs`: `issueSkrQuote`/`verifySkrQuote` (tamper the amount,
  the wallet, the purpose, `iat`, `exp`; an expired quote still VERIFIES — timing is not this
  function's job); `verifySkrPaymentTx` against fixture `getTransaction` responses with pre/post
  token balances and parsed instructions — the proven wallet's decrease and the receiver's
  increase are both required; a fixture where the fee payer is the proven wallet but another
  owner's SKR fell is refused; a same-mint entry owned by someone else is ignored; a same-owner
  entry of another mint is ignored; a transaction that also moves SKR back OUT of the receiver
  nets to its true increase; a failed tx is refused; `amountRaw` from a price (BigInt ceiling,
  no float drift at 6 and 9 decimals).
- App-side `scripts/seeker-skr-pay-test.cjs` (fake window, fake provider, fake fetch): the
  pending record is written BEFORE the session request; a 5xx on redemption keeps it; a
  definitive refusal clears it and surfaces the reason; a grant clears it; reopen re-posts it.
- `scripts/tool-pass-gate-test.cjs` (the real-keypair end-to-end) gains one SKR leg with the
  RPC stubbed.

## Codex round 27 (2026-09-24, design review of 8987d0e) — folded in above
Finding 2 (fee payer ≠ token source) → the payer is the wallet whose SKR balance fell, with the
parsed transfer instruction as a second witness. Finding 3 (a later, cheaper quote validating an
earlier short payment) → `iat` in the token and a two-sided payment window on chain time.
Finding 4 (a timely payment stranded by a clock check) → the token is authenticated without an
`exp` clock check; timing is judged only against the block time. Finding 5 (recovery needs the
quote, and a confirmed payment with a failed redemption needs recovery) → signature + quote +
pay-intent persisted before the redemption request, kept through retryable refusals, cleared
only on a grant or a definitive refusal. Finding 1 (the seam's in-place mutation) is fixed on
PR #420, which this builds on. Each is pinned by a named test below.

## Review before merge (read-only, adversarial)
The quote token (forge, replay across wallets, replay after expiry, a quote from a low price
tick — the sanity band is the guard, say whether it is enough); the token-balance read (owner
vs account, Token-2022 extensions on SKR if any, a transfer that also moves SKR OUT of the
receiver in the same tx netting to zero); the recovery path (can an unconsumed signature be
"recovered" by a different wallet, or the same wallet without ever having paid enough?); the
session route's branch ordering (SKR leg before SOL leg, neither reachable without a proven
wallet); the pending-signature localStorage record (a stale record replaying against a new
quote); and the store-edition lock.

## Owner decisions, recorded
- SKR pass price: **$1 in SKR, 7 days** (2026-09-24).
- SOL price and the website's flow: unchanged (0.05 SOL, 7 days).
- Device test before promote: pay in SKR from a wallet holding SKR; a wallet holding none
  (the swap link); a decline; airplane mode after signing, then "Check payment".
