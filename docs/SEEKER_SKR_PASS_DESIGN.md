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
a:amountRaw, exp })`, `sig = HMAC-sha256(PREMIUM_ACCESS_KEY, "tools-skr." + body)` — the same
scheme as `issuePayIntent`, its own purpose string so a pay-intent or a tools token can never
be presented as a quote. Add `issueSkrQuote` / `verifySkrQuote` beside them; `verifySkrQuote`
returns `{ amountRaw, exp }` only when the HMAC, purpose and wallet all match.

### `POST /api/tool-gate/session` — the SKR leg
Body gains `skrQuote`. When `paySig` and `skrQuote` are both present:
1. `verifySkrQuote(skrQuote, wallet)` — fail → 401 `skr quote invalid or expired — request a new one`.
2. `verifySkrPaymentTx(paySig)` (new, beside `verifySolPaymentTx`): `getTransaction` jsonParsed
   (`maxSupportedTransactionVersion:1`, `confirmed`); refuse on `meta.err`; payer = `accountKeys[0]`;
   the SKR delta is read from `meta.preTokenBalances` / `postTokenBalances` for entries with
   `mint === SKR_MINT` AND `owner === SOL_UNLOCK_WALLET` (owner, never account index — a
   look-alike account is the obvious forgery), summed as BigInt strings: `amountRaw`. Returns
   `{ ok, kind:"skr", amountRaw, payer, blockTimeMs }`.
3. `redeemPaidPass(...)` — extended, still pure: `verified.kind === "skr"` uses the quote's
   `amountRaw` as the minimum (`BigInt(verified.amountRaw) >= BigInt(quote.amountRaw)`),
   requires `termsAt(blockTimeMs).skr` to exist, requires `blockTimeMs <= quote.exp + 5 min`
   (a payment that landed after the quote expired was priced on a stale number → refused,
   nothing consumed; the person re-quotes and the SAME signature cannot be reused because it is
   refused before the store is touched), and everything else identical: payer must equal the
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
5. Outcomes: `sent` → `POST /api/tool-gate/session { wallet, payIntent, paySig, skrQuote }` →
   `CluckGate.grant(days, "paid-skr", pass)` → unlocked. `unconfirmed` → keep the signature in
   localStorage under the wallet (mirror `cluck-gate.js`'s pending-pay record, same key shape
   so a recovered payment is found the same way), show "Your payment may still be landing —
   check it before paying again", with a **Check payment** button that re-posts the session with
   the stored signature (recovery). `failed` → the error, nothing stored, retry allowed.
   `declined` → back to the sheet. On reopen, a stored pending signature for this wallet is
   re-posted automatically before anything else, like `cluck-gate.js` does.
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
  below → refused nothing consumed); quote expired before block time (+5 min grace) → refused;
  wrong payer → refused; recovery without quote after consumption → recovered:true same expiry;
  unconsumed + no quote → refused; hub-access collision → 409; fail-closed store → 503.
- New `scripts/tool-pass-skr-test.cjs`: `issueSkrQuote`/`verifySkrQuote` (tamper the amount,
  the wallet, the purpose, expiry); `verifySkrPaymentTx` against a fixture `getTransaction`
  response with pre/post token balances — the right owner+mint entry is summed, a same-mint
  entry owned by someone else is ignored, a same-owner entry of another mint is ignored, a
  failed tx is refused; `amountRaw` from a price (BigInt ceiling, no float drift at 6 and 9
  decimals).
- `scripts/tool-pass-gate-test.cjs` (the real-keypair end-to-end) gains one SKR leg with the
  RPC stubbed.

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
