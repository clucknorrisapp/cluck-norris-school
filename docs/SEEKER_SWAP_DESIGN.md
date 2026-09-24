# Seeker app — in-app swap (Jupiter) and the SKR integrations

**Owner decision, 2026-09-24:** *"we go full bore into swap feature on the Seeker app, we have it
on our web app so we should have most of what we need … any integration of SKR we can do lets do
it."* This reverses the 2026-09-19 "no swap prompt" line in `docs/SEEKER_APP_PLAN.md` §7 for the
Seeker app specifically. The Play/iOS education edition never carries any of this (compiled out,
`docs/STORE_EDITION.md`).

Why the Seeker app and not the stores: Google Play and the App Store forbid in-app crypto
purchases; the Solana dApp Store does not. And the hackathon scores "SKR integration" — one
published scheme at 20% of the main score, the other as a separate $10k prize
(`docs/CLOCK_IN_HACKATHON_2026.md`). Today's SKR integration is a read-only holdings check on the
tools pass; nothing moves SKR on-chain. A swap the user signs from inside the app is on-chain SKR
activity from a Seeker app, with the user's own funds and nothing custodied by us.

This is a MONEY PATH: user funds, a wallet signature, a third-party transaction. It gets the full
treatment — the design here, a builder that follows it, a read-only adversarial review before it
merges to `develop`, and the owner's device test before it is promoted.

## What "we have on the web app" actually is

- `public/home.html` and `public/clkn.html` load the **Jupiter Plugin** (`plugin.jup.ag`) — a
  hosted widget with its own wallet adapter. It is not reusable in the Capacitor webview: the
  plugin's adapter list does not see our Mobile Wallet Adapter bridge, and a plugin transaction
  never passes through the app's signing seam. Not used here.
- `src/App.jsx` (the school's LP Lab) pulls a **quote** from `lite-api.jup.ag/swap/v1/quote`
  (SOL → CLKN, `slippageBps`, 30 s refresh). A quote, not a swap. The field names it reads
  (`outAmount`) are the ones the app reads too.
- `lib/swap-desk.js` is the owner-funded CLKN↔NORMIE desk (off unless `SWAP_OPERATOR_SECRET`).
  Not a Jupiter swap and not involved.
- `server.js` already has the keyed-host-then-lite-api pattern for Jupiter (`jupTokensSearch`,
  `JUPITER_API_KEY` with automatic fallback to `lite-api.jup.ag`). The swap proxy reuses it.
- The Seeker app already has the one signing seam every wallet-touching tool uses
  (`src/seeker/sign.js` `signSendConfirm`, four protections) and Mobile Wallet Adapter wired in
  `public/cluck-wallet.js` (`mwaProvider`). The swap signs through that seam, never beside it.

## The one technical gap: versioned transactions

Jupiter returns a **v0 `VersionedTransaction`** (address lookup tables; multi-hop routes need
them). The seam today assumes a legacy `Transaction`:

| Where | Today | Needs |
|---|---|---|
| `src/seeker/sign.js` `messageBytes(tx)` | `tx.compileMessage().serialize()` — throws on v0, returns null, and the byte diff (protection 4) then FAILS every swap as "the wallet returned a different transaction" | `tx.version !== undefined ? tx.message.serialize() : tx.compileMessage().serialize()` |
| `src/seeker/sign.js` `signatureOf(tx)` | reads `tx.signatures[0].signature` — on v0 `signatures[0]` is a `Uint8Array`, so this returns null and protection 5 (a transport failure keeps the local signature) is silently lost | handle `Uint8Array` entries (all-zero = unsigned → null) |
| `public/cluck-wallet.js` `asTransaction(signed, original)` | turns any bytes into a LEGACY `Transaction.from(...)` — corrupts a v0 | when `original.version !== undefined`: a `VersionedTransaction` instance passes through; bytes/ArrayBuffer/`{signedTransaction}` → `VersionedTransaction.deserialize`; a foreign-web3 versioned object → round-trip through `serialize()`; the bare-`{signatures}` graft is legacy-only and must throw a readable error for v0 |
| `public/cluck-wallet.js` `txToBytes` / `txFromBytes` | already handle v0 | unchanged |
| `src/seeker/sign.js` `signSendConfirm` | fetches a blockhash and passes it to `build()` | unchanged — the swap's `build()` ignores it (Jupiter's transaction carries its own); `submitSigned` serializes a v0 correctly |

`asLegacyTransaction: true` on Jupiter's swap call is NOT the fix: Jupiter documents that it fails
for routes that need lookup tables, which is any multi-hop route, and SKR and CLKN both route
through SOL from most inputs.

Pinned by a new `scripts/seeker-sign-versioned-test.cjs`: build a real v0 transaction with
`@solana/web3.js` in Node, run `messageBytes`/`sameBytes`/`signatureOf` on it, and drive
`asTransaction` with each return shape (instance, bytes, ArrayBuffer, wrapper, foreign object,
bare signatures) for BOTH a legacy and a v0 original. The legacy cases must keep passing byte-for-
byte — Firepit, Project Burn, Rent Reclaim, the Locker Room and the Airdropper all sign legacy
transactions through the same helpers.

## Server: the swap proxy (`server.js`)

The app never calls Jupiter directly. Reasons: the API key and its rate limits stay server-side;
the mint allowlist and any platform fee live in one place; the app's `allowedHosts`
(`store-edition/seeker-edition.json`) does not grow a third-party host; and the CORS test can
see the whole endpoint inventory.

Both endpoints go into `SEEKER_API_RE` (server.js ~3924) — `scripts/seeker-cors-test.cjs` fails
otherwise. Both are public reads/relays with no admin key and nothing server-signed: the server
holds no key that can move anything here.

### `GET /api/seeker/swap/config`
```
200 { ok:true,
      mints: [ { symbol:"SOL",  mint:"So11111111111111111111111111111111111111112", decimals:9 },
               { symbol:"SKR",  mint:"SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3", decimals:<from chain, cached> },
               { symbol:"CLKN", mint:"DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS", decimals:<from chain, cached> },
               { symbol:"USDC", mint:"EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals:6 } ],
      defaultIn:"SOL", defaultOut:"SKR",
      slippageBpsOptions:[50,100,300], defaultSlippageBps:100,
      platformFeeBps:0 }
```
`SKR_MINT` comes from `lib/tool-pass-qualify.js` (never retyped — a look-alike mint exists).
Decimals are read once from the chain (`getTokenSupply` or the mint account) and cached; never
hardcoded for SKR/CLKN. Any pair of two distinct allowlisted mints is a valid pair. The
allowlist is the v1 boundary — a free-text mint picker is a later increment, not this one.

### `GET /api/seeker/swap/quote?inputMint=&outputMint=&amount=&slippageBps=`
Validates: both mints in the allowlist and distinct; `amount` a positive integer string in base
units (≤ 20 digits, no float); `slippageBps` one of the options. Calls Jupiter
`GET /swap/v1/quote` (keyed `api.jup.ag` with `x-api-key`, automatic fallback to
`lite-api.jup.ag` — same pattern as `jupTokensSearch`) with `restrictIntermediateTokens=true`
and `platformFeeBps` when configured. Returns Jupiter's quote object under `quote` plus a
`quoteId` (sha256 of the quote JSON, kept server-side in a 60 s in-memory map keyed by id) and
`{ ok:true }`. Errors: 400 `bad_request` with the field named; 502 `quote_unavailable` when
Jupiter fails (never a fabricated quote). 8 s timeout on the upstream call. Rate limit: reuse
the existing per-IP limiter helper used by the public Hub reads (60/min is plenty — the app
refreshes every 15 s).

### `POST /api/seeker/swap/tx`  body `{ quoteId, userPublicKey }`
Looks up the quote by `quoteId` (expired or unknown → 409 `quote_expired`, the app re-quotes),
validates `userPublicKey` (base58, 32 bytes — reuse the server's existing `SOL_ADDR_RE`), calls
Jupiter `POST /swap/v1/swap` with
```
{ quoteResponse:<the stored quote>, userPublicKey, wrapAndUnwrapSol:true,
  dynamicComputeUnitLimit:true, asLegacyTransaction:false,
  prioritizationFeeLamports:{ priorityLevelWithMaxLamports:{ maxLamports:1000000, priorityLevel:"high" } },
  feeAccount:<only when a platform fee is configured> }
```
and returns `{ ok:true, swapTransaction:<base64>, lastValidBlockHeight, inputMint, outputMint,
inAmount, outAmount, otherAmountThreshold, priceImpactPct }` — the amounts echoed from the STORED
quote, not from the request, so the confirm sheet and the transaction come from the same object.
Errors: 400 / 409 / 502 as above.

⚠️ The builder must verify the Jupiter request and response field names against a LIVE call
(`curl` to `lite-api.jup.ag`, no key needed) before writing the route, and record one real quote
and one real swap response (with a throwaway public key) as fixtures under
`scripts/fixtures/seeker-swap/`. The test drives the routes with `JUP_SWAP_BASE` pointed at a
local stub that serves those fixtures — never a live call in CI.

### Platform fee — OWNER DECISION, default OFF
Jupiter supports a referral fee (`platformFeeBps` on the quote, `feeAccount` on the swap). It is a
revenue line for CLKN Productions but it is the owner's parameter: which bps, and whether at all.
Env: `SEEKER_SWAP_FEE_BPS` (default 0 = off) and `SEEKER_SWAP_FEE_ACCOUNT` (the referral token
account). With bps 0 the swap call carries no fee fields. The config endpoint publishes
`platformFeeBps` so the confirm sheet shows it when it is non-zero — never a hidden fee.

## App: the Swap pane (`src/seeker/tools/Swap.jsx`)

Registry (`src/seeker/tools/registry.js`): `{ id:"swap", route:"/tools/swap", title:"Swap",
icon:"🔁", tier:"wallet", ready:true, blurb:"Swap SOL, SKR, CLKN and USDC in this app. Every
quote shows the rate, the minimum you receive and the price impact before you sign." }`. Not a
flagship. Route in `src/seeker/edition/full.jsx` ONLY — `edu.jsx` never imports it.

Layout, top to bottom:
1. **Pay** row: mint picker (the four), amount input (decimal string, validated against the
   mint's decimals — convert to base units with string math, never `parseFloat × 10^d`), the
   wallet's balance of that mint with a "Max" that leaves 0.01 SOL for fees when paying SOL.
   Balances are read on-chain through `/api/helius-rpc` (`getBalance` +
   `getTokenAccountsByOwner` for BOTH token programs, per AGENTS.md — never a product scanner).
2. Flip button.
3. **Receive** row: mint picker, the quoted `outAmount` rendered in the mint's decimals.
4. Quote card, only when a quote exists: rate (1 IN = x OUT), **minimum received**
   (`otherAmountThreshold`), **price impact** (`priceImpactPct`), slippage chip (0.5% / 1% / 3%,
   default 1%), route hop count, and the platform fee line when non-zero. Refreshes every 15 s
   while the pane is visible and the amount is non-empty; a stale quote (older than 60 s, or the
   server's 409) is re-fetched before the confirm sheet opens, and the sheet shows the FRESH
   numbers.
5. **Guardrails before power** (AGENTS.md): price impact ≥ 1% renders amber with the sentence
   "This trade moves the price by {pct}%."; ≥ 5% renders in the danger style and the confirm
   sheet uses `typeToConfirm:"SWAP"`. Not a block — a clear warning, then their call.
6. Button "Review swap" → the shared `Confirm` sheet (`src/seeker/pane.jsx`) with the composed
   lines: pay X, receive at least Y, price impact, slippage, fee. Then `signSendConfirm`.

Signing:
```js
const res = await signSendConfirm({
  provider: wallet.provider, owner: wallet.address,
  build: (web3) => web3.VersionedTransaction.deserialize(base64ToBytes(swapTransaction)),
});
```
The four outcomes are kept apart exactly as Firepit does: `sent` → signature + Solscan link +
balances re-read; `unconfirmed` → the signature with "may still land — check it before trying
again", never a retry button; `failed` → the error, retry allowed; `declined` → back to the
form, not an error. `POST /api/seeker/swap/tx` is called only after the person taps confirm, and
the `userPublicKey` sent is the LIVE address the seam re-reads (build receives it; the pane must
request the transaction with the same address it will sign with — request it inside the confirm
handler after `assertSameAccount`, not at quote time).

States (every pane has them — `docs/SEEKER_DEMO_INVENTORY.md`): not connected → `NeedsWallet`;
offline → `Unavailable kind="offline"`; quote unavailable → `Unavailable` with retry; refused
(400) → `Refused` with the server's field. Nothing renders a price chart, a "buy" nudge, or any
sentence about where a price is going. Copy is "Swap", never "Buy CLKN". Say what's on-chain,
never why.

The pass sheet (`src/seeker/passgate.jsx`) gains one line under the SKR sentence: "Swap for SKR
in this app" linking to `/tools/swap?out=SKR`. The Swap pane reads `?in=`/`?out=` symbols to
preselect. That is the whole tie-in to the tools pass — the school never shows a swap.

## i18n, inventory, edition locks, tests

- Every new string goes through `t()`/`tf()`; translate into es/hi/it/pt/vi/zh with
  `scripts/seeker-i18n-keys.cjs --missing <lang>` → `scripts/seeker-i18n-merge.cjs` (the
  dictionaries are appended as text; never re-serialised; `public/i18n/en.json` must never
  exist).
- `docs/SEEKER_DEMO_INVENTORY.md` gains the `/tools/swap` row (signs: yes; offline: no;
  flagship: no) — `scripts/seeker-demo-inventory-test.cjs` pins the route table.
- `store-edition/store-edition.json` `forbidden` gains `"/api/seeker/swap"` and `"swap/v1"` so an
  education build that ever pulled the pane in fails the scan. `store-edition/seeker-edition.json`
  `forbidden` is unchanged (the Seeker edition is allowed to carry it).
- Tests, all in CI via the existing `node-check` job: `scripts/seeker-sign-versioned-test.cjs`
  (the seam, above), `scripts/seeker-swap-test.cjs` (the three routes against the fixture stub:
  allowlist, amount validation, quoteId expiry, the stored-quote echo, fee fields absent at bps
  0, upstream failure → 502 never a fake quote), and the existing `seeker-cors-test.cjs`,
  `seeker-demo-inventory-test.cjs`, `seeker-build-test.cjs`, `store-edition-test.cjs` must stay
  green.

## Review before merge (read-only, adversarial)

What the reviewer tries to break, at minimum: the v0 byte diff (can a wallet substitute a
transaction the diff does not catch?); the quoteId path (can a client get a transaction for a
quote it did not receive, or with amounts it did not see?); `userPublicKey` vs the signing
account (stale-account swap); the transport-failure path on a v0 (is the local signature really
recovered?); the slippage/impact display vs what the transaction enforces (`otherAmountThreshold`
is the only number the chain honours); decimals and base-unit string math on the input; the
education edition (does any swap symbol reach the edu bundle?); and the `Max` button leaving
enough SOL for fees and rent.

## The rest of "any integration of SKR we can do"

Beyond the swap (which defaults to SOL → SKR), in order of on-chain substance:

1. **Pay the 7-day tools pass in SKR.** Today the pass is 0.05 SOL, verified by
   `/api/verify-sol-payment`, with the paid terms an append-only schedule in
   `lib/tool-pass-terms.js` resolved at the payment's block time. An SKR term is a new schedule
   entry (a fixed SKR amount, like the fixed lamports) plus an SPL-transfer verification path
   (the payer's SKR token account → the treasury's, exact amount, memo-free, consumed once). Makes
   SKR a payment token in the app. ⛔ **Needs the owner's number** — the SKR amount is his
   parameter, not a computed one. Not started until he gives it.
2. **Locker Room preset for SKR.** Any mint already locks on Jupiter Lock through the pane; SKR
   becomes a one-tap preset in the mint field so a Seeker holder can lock SKR and get the public
   proof. Small; ships with the swap PR or the next.
3. **The SKR door stays as is** (`lib/tool-pass-qualify.js`; CLKN checked first, SKR only when
   the app asks, never graces). The swap's `?out=SKR` link from the pass sheet is the only new
   surface on it.
4. **Jupiter Perpetuals** — the owner floated it. Needs its own look before any design:
   Jupiter's perps are an on-chain program with an SDK, not a swap-style REST call, and leverage
   is the fastest way a first-timer loses everything — the school's whole reason to exist is
   "guardrails before power". If it is built, it sits behind the warnings, never on the home
   grid. Separate doc when asked.

## Owner decisions this design leaves to him

- Platform fee on swaps: bps and whether at all (default off).
- The SKR price of the 7-day pass (item 1 above).
- Device test before promote: connect, quote SOL → SKR, sign, see the balance change, then the
  same for a decline and for an unconfirmed result (airplane mode after signing).
