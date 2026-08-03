# CLKN ⇄ NORMIE swap desk — design

**Status: DESIGN. Nothing funded, nothing armed.** Written 2026-08-02 on the owner's ask for an
in-depth, live-priced swap. Read this before writing or reviewing the code.

The owner's brief, in his words: *"either a pool or a contract where I load up Normie and Cluck
Norris tokens. If somebody wants to swap their cluck for Normie, they can do so. It happens dollar
per dollar. It does not affect the price of the pool. It only works if there's enough tokens
available in the swapper."* Purpose: let CLKN holders reach NORMIE (and vice versa) **without
trading through either chart.**

---

## 0. The two things the owner has to decide

Neither blocks writing the code. Both block turning it on.

1. **Funding is his action, not a session's.** No signing key exists in a cloud container, and
   loading inventory moves real funds — CLAUDE.md's PLAN ≠ EXECUTE rule applies. The desk ships
   **disabled**: with `SWAP_OPERATOR_SECRET` unset every endpoint is a structured no-op, matching
   the `isEnabled()` convention in `lib/whirlpool-vault.js:258` and `lib/school-airdrop.js`.

2. **A public CLKN⇄NORMIE desk is a louder partnership claim than the game's token gate.**
   CLAUDE.md is explicit that there is no agreement with the NORMIE team on access or rewards, and
   the owner reconfirmed on 2026-08-02 that Normie Quest gating stays testing-only and unlinked.
   A swap desk on a public page says "these two projects are connected" more strongly than
   anything in the game does. The build assumes the **same posture as the game**: unlinked, no
   promises, no NORMIE branding beyond identity. Promoting it is a separate decision.

There is also a narrower flag worth stating once. CLAUDE.md says *never buy CLKN with operator
funds without asking in that moment.* Every time a user swaps NORMIE → CLKN, the desk acquires
NORMIE and releases CLKN; the reverse direction acquires CLKN. Standing inventory means standing
acquisition. That is inherent to the product the owner asked for — it just should be a thing he
said yes to knowingly, not a side effect he discovers later.

---

## 1. Why not an AMM pool, and why not an on-chain program

**Not a pool.** A constant-product pool is *defined* by price impact — that is what an AMM is. The
owner's requirement ("does not affect the price") rules it out by construction.

**Not a new on-chain program.** An Anchor program means writing, auditing and deploying custody
code, and an unaudited custody program holding real inventory is the single riskiest thing this
project could ship. It buys nothing here: the desk is discretionary, inventory-bounded and
owner-funded, so trustlessness is not the property being sold.

**A server-mediated atomic swap.** One transaction with two token-transfer legs — user → desk and
desk → user. It either lands whole or not at all, so neither side can be left short. It reuses the
signing pattern already proven in `/locker-room`, the failover RPC in `lib/rpc.js`, the durable
replay guard in `lib/sigstore.js`, and the rate limiter in `server.js:2250`. No new trust
primitives.

---

## 2. The fundamental economic problem, stated plainly

**A fixed-price swap with no price impact is an arbitrage magnet.** This is not a hypothetical
risk to note and move past — it is the failure mode that kills desks like this, so the mitigations
below are load-bearing, not garnish.

The mechanism: the desk prices off a feed. The market moves. For as long as the desk's price lags
the market, someone can swap the cheap side at the desk and sell it into the real market. Repeat
until the desk is empty of whichever asset it was underpricing. The counterparty is not a CLKN
holder wanting NORMIE — it is a bot, and it will find the desk within hours of it going live.

Second-order version, and the more dangerous one here: **both tokens are thin.** If NORMIE's price
can be moved cheaply on its main pool, an attacker can move the *feed*, then swap against the desk
at the poisoned price, then let the pool revert. The desk's own price source becomes the attack
surface. The repo has already been burned by exactly this class of thing — `lib/whirlpool-vault.js:2154`
records the owner's 2026-06-27 decision that DexScreener's top-pair `priceUsd` is untrustworthy
after a CLKN/JUP pool reported \$1.19 against a real \$0.0002.

So: **"dollar per dollar" is the right user-facing promise and the wrong internal implementation.**
Internally it has to be "dollar per dollar, priced at execution, inside a spread, within sanity
bands, under a cap, while the feed agrees with itself."

### The mitigations, and what each one is actually for

| Control | Default | Stops |
|---|---|---|
| **Spread** | 75 bps each way | Makes small lag unprofitable to farm. The single highest-value control. |
| **Re-price at execution** | max 50 bps drift from quote | Closes the gap between "user saw a price" and "chain settled it" — the owner's to-the-second requirement, implemented. |
| **Quote TTL** | 30 s, HMAC-signed | Stops a user sitting on a favourable quote waiting for the market to move. |
| **Sanity bands** | per-mint plausible USD range | Rejects a poisoned or broken feed outright. Same idiom as `server.js:11063`. |
| **Temporal gap guard** | 25% vs last observed | Sits the swap out when the feed jumps implausibly. Mirrors `priceGapGuardPct`, `whirlpool-vault.js:64`. |
| **Per-wallet daily cap** | \$250 | Bounds any single actor's extraction per day. |
| **Global daily cap** | \$2,500 | Bounds total daily loss to a number the owner picks deliberately. |
| **Inventory floor** | 10% of each side | The desk refuses to sell its last tokens, so it can never be fully drained and always has something for a real user. |
| **Kill switch** | `SWAP_KILLED` const + env-absence | Two independent ways to stop it instantly. |
| **Rate limit** | dedicated tight bucket | Blunts automated probing. |

Every number above is a starting proposal, not a decision. They belong to the owner.

**An honest bound on all of this:** these controls make the desk *expensive to farm*, not
*impossible to farm*. A patient arbitrageur operating inside the caps still extracts roughly the
spread-vs-drift difference over time. The daily caps are what convert an unbounded risk into a
known, budgeted one — treat the global cap as the maximum you are willing to lose in a day, not
as a limit you expect to be hit.

---

## 3. Flow

```
  ┌── GET /api/swap/quote ─────────────────────────────────────────────┐
  │  jupPriceV3([CLKN, NORMIE])   ← uncached, live, the trusted source │
  │  stamp priceAt = Date.now()   ← no price fn in this repo returns a │
  │                                 timestamp; we make our own         │
  │  sanity-band both prices → reject if implausible                   │
  │  gap-guard vs kv last-seen    → sit out if it jumped               │
  │  outRaw = inRaw · (priceIn/priceOut) · (1 − spread), decimals-exact│
  │  inventory check: outRaw ≤ deskBalance − floor                     │
  │  cap check: per-wallet + global daily USD                          │
  │  → signed quote {…, priceAt, exp: +30s}  HMAC-SHA256               │
  └────────────────────────────────────────────────────────────────────┘
                                   ↓
  ┌── POST /api/swap/build ────────────────────────────────────────────┐
  │  verify HMAC + expiry                                              │
  │  RE-PRICE. |newPrice − quotePrice| > 50 bps → 409, requote         │
  │  build unsigned tx, feePayer = user:                               │
  │     1. createAssociatedTokenAccountIdempotent (user's out-ATA,     │
  │        rent paid by USER — desk-paid rent is a drain vector)       │
  │     2. transferChecked  user → desk   (in leg)                     │
  │     3. transferChecked  desk → user   (out leg)                    │
  │  simulate before returning (never hand over a doomed tx)           │
  │  stash the exact serialized message bytes server-side, 60s TTL     │
  │  → { txBase64, buildToken }                                        │
  └────────────────────────────────────────────────────────────────────┘
                                   ↓
  ┌── client ──────────────────────────────────────────────────────────┐
  │  refresh blockhash → provider.signTransaction(tx)   ← WALLET FIRST │
  │  POST the signed tx back                                           │
  └────────────────────────────────────────────────────────────────────┘
                                   ↓
  ┌── POST /api/swap/submit ───────────────────────────────────────────┐
  │  ⚠️ compare incoming message bytes to the stashed bytes, EXACTLY   │
  │  consume buildToken (durable, fail-closed)                         │
  │  THE FINAL LOOK (added 2026-08-03): one last live price read at    │
  │  the instant of co-signing; drift > SWAP_SUBMIT_DRIFT_BPS (100) →  │
  │  refuse, nothing traded. Fail closed if the feed is unreachable.   │
  │  partialSign(deskKeypair) → sendRawTransaction → confirm           │
  └────────────────────────────────────────────────────────────────────┘
```

### 3a. The one place a mistake is catastrophic

**`/api/swap/submit` must never partial-sign a transaction it did not itself construct.**

The desk keypair can move the desk's entire inventory. If the submit endpoint signs whatever
arrives, an attacker submits a transaction whose "out leg" is *the desk's whole balance to
themselves*, and the server signs it. That is a total-loss bug, and it is an easy one to write —
the natural-looking implementation (deserialize, `partialSign`, send) is exactly the vulnerable one.

The defence is byte equality, not inspection. At build time the server stashes the serialized
message it created. At submit time it re-serializes the incoming transaction's **message** and
compares it byte-for-byte to the stash. Any difference at all — one lamport, one account index,
an extra instruction — fails closed. Signatures live outside the message, so the user's signature
does not disturb the comparison.

Do not substitute "parse the instructions and check they look right" for this. Instruction
inspection is a whitelist you will get wrong; byte equality is a fingerprint you cannot.

### 3b. Why this differs from the `/locker-room` pattern

`/locker-room` ships a secret key **to the browser** (`lib/jup-lock.js:152`). That is safe there,
and the reasoning is written at `jup-lock.js:148-151`: the `base` keypair is disposable, holds no
funds and retains no authority once the escrow exists.

**That reasoning does not transfer.** The desk's second signer is a funded wallet. Its key never
leaves the server, which inverts the last step: instead of the client signing and submitting,
the client signs and *posts back*, and the server signs and submits. No endpoint in this repo does
that today — it is the genuinely new piece of infrastructure.

Everything else from the locker room carries over unchanged and should be copied, not reinvented:
wallet signs before any other signer (Phantom's Lighthouse flags a pre-signed multi-signer tx),
blockhash refreshed immediately before signing, `skipPreflight: true` because preflight's
`finalized` commitment rejects a fresh `confirmed` blockhash, and the `confirmSig` poll loop.

---

## 4. Money-safety rules for the implementation

- **Desk wallet holds the swap float and nothing else.** Never the treasury, never a mint
  authority. Same rule as `MM_OPERATOR_SECRET` (CLAUDE.md) and for the same reason.
- **Decimals are read from chain, never hardcoded.** `whirlpool-vault.js:1971` does this and says
  why. CLKN and NORMIE are both 6dp today; that is not a licence to assume it.
- **All arithmetic in raw integer units (`BigInt`).** Convert to UI amounts only for display.
  Floats are fine at these magnitudes for *showing* a number and wrong for *moving* one.
- **Token program resolved per mint** via `getAccountInfo(mint).owner`, as `lib/jup-lock.js:66`
  does — and reject `NonTransferable` / `TransferHook` extensions. A transfer-hook token breaks
  atomicity in a way that surfaces as an unreadable simulation failure.
- **Ambiguous send = possibly landed.** `sendTransaction` is in `NON_IDEMPOTENT_METHODS`
  (`lib/rpc.js:87`); a 5xx is not a signal to retry. Verify by signature first, exactly as
  `lib/school-airdrop.js:86` does.
- **`publicErrMsg()` on every error path**, or a Helius URL with an embedded API key can leak to
  the client.
- **Never fabricate a price.** Return `null` and refuse the swap, per `server.js:11136`.

---

## 5. Files

| Path | Role |
|---|---|
| `lib/swap-desk.js` | Pricing, quoting, inventory, caps, tx construction, submit. All logic. |
| `swap.js` | Express router. Mounted at `server.js:2317`, **above** the global `express.json()` at `:2318`, so it must install its own body parser or every POST silently 400s. |
| `public/swap.html` | The UI. `public/` is not statically mounted — needs an explicit `app.get` route. |
| `server.js` | Three lines: require, rate-limit bucket, `app.use`. Plus the new env vars in the boot audit at `:12755`. |

### Environment

| Var | Unset behaviour |
|---|---|
| `SWAP_OPERATOR_SECRET` | **Desk fully disabled.** Safe no-op. This is the master arm switch. |
| `SWAP_QUOTE_SECRET` | Refuse to issue *or* verify quotes — fail closed, no fallback constant, per `whirlpool-mm.js:52`. |
| `SWAP_SPREAD_BPS` | 75 |
| `SWAP_MAX_DRIFT_BPS` | 50 |
| `SWAP_WALLET_DAILY_USD` | 250 |
| `SWAP_GLOBAL_DAILY_USD` | 2500 |
| `SWAP_INVENTORY_FLOOR_PCT` | 10 |
| `SWAP_ADMIN_KEY` | Scoped key for the operator view, so `PREMIUM_ACCESS_KEY` is not exposed in a browser. Follows the `BUYCOMP_KEY` precedent at `server.js:5705`. Unset → 404, never 401. |
| `SWAP_ALERT_CHAT_ID` | Telegram room for desk alerts. Falls back to `TELEGRAM_CHAT_ID`. |
| `SWAP_LOW_INVENTORY_USD` | 200 — warn when a side has less than this left to trade |
| `SWAP_BAND_ROSE_MIN/MAX` | ROSE sanity band (added 2026-08-03 with the third token) |
| `SWAP_SUBMIT_DRIFT_BPS` | 100 — max drift between quote and the final look at co-sign time |
| `SWAP_GAP_BASELINE_TTL_MIN` | 15 — how long a pumped price must HOLD before the guard accepts it as the new baseline |

### Token registry (updated 2026-08-03)

The desk trades a REGISTRY, not a pair: `TOKENS` in `lib/swap-desk.js` maps mint → symbol, any
two distinct entries form a valid pair, and the page builds its pickers from `/api/swap/config`.
Three tokens today — CLKN, NORMIE, **ROSE** (`RoSeiVjW5H48ucPAJh1LJGBBzPpqvsokfDGpgHXDtdF`) —
which is six directed pairs, all covered by the same quote/build/submit path and the same tests.

Adding a token = one registry entry + one sanity band + funding its side of the desk wallet.
Before adding one, check its POOL DEPTH on Jupiter first: ROSE went in with ~$14K of liquidity
against ~$44K (CLKN) and ~$64K (NORMIE), measured on-pool 2026-08-03, and the thinnest token's pool is the cheapest feed to
manipulate — it sets the desk's real exposure, whatever the caps say. The desk needs a funded
token account for every registry entry, or that side simply refuses quotes.

---

## 7. Monitoring

A desk holding real money that nobody can watch is the part worth being uneasy about. On-chain
history exists, but reading it requires someone to go and look, which means a drained side — or a
bot quietly working the spread — stays invisible until the owner happens to check. So the desk
reports on itself.

| | |
|---|---|
| **Per-swap Telegram alert** | direction, amounts, USD, wallet, Solscan link |
| **Low-inventory warning** | once per side per day, when what's left to trade falls under `SWAP_LOW_INVENTORY_USD` |
| **Durable swap log** | kv-backed (`swapLog`, last 500), so it survives the redeploys that happen most often |
| **Operator view** | `GET /api/swap/admin` — recent swaps, today's cap usage per wallet, live inventory |

Three deliberate choices:

- **Alerts are silent** (`disable_notification`). These are operational events; a desk that buzzes
  a phone at 3am gets muted, and a muted alert is worse than none.
- **Low inventory warns once per side per day**, not per swap. A draining side would otherwise
  fire on every subsequent swap and train the reader to ignore it.
- **Everything runs after the send and swallows its own errors.** The swap has already settled
  on-chain; a Telegram outage or a failed disk write must never surface to the user as a failure.

The low-inventory warning is the one that will actually matter. The stated use case — CLKN holders
acquiring NORMIE to reach the higher game levels — is **one-directional**, so NORMIE drains while
CLKN accumulates. That is the expected behaviour, not a fault, and it means the desk needs manual
rebalancing. Standing inventory on one side is also, economically, a standing bid for the other.

---

## 6. What must be true before this is armed

Ordered. Do not skip on the grounds that the code looks right — CLAUDE.md's own verification
section exists because "reported green on the wrong thing" is this project's most common failure.

1. `node --check` on every touched backend file.
2. Unit-level: quote maths against known prices and decimals, in both directions, including a
   token with a different `decimals` than CLKN to prove nothing is hardcoded.
3. **Adversarial test of §3a specifically.** Construct a tampered transaction — swap the out-leg
   amount, add a fourth instruction, change the destination — and assert `/api/swap/submit`
   refuses each one. This test is the reason the endpoint is safe; without it the safety is a
   claim, not a property.
4. Cap and floor enforcement, including the boundary (exactly at the cap, one unit over).
5. Disabled-path test: with `SWAP_OPERATOR_SECRET` unset, every endpoint returns its structured
   no-op and the page says so plainly.
6. Simulation against mainnet with a real user pubkey and a **funded desk on devnet** or a
   deliberately tiny mainnet float — the first real swap should be worth less than lunch.
7. Owner funds the desk and sets the secret. **His action.**

Note what this list cannot cover from a cloud container: no session has ever completed a
connect-and-sign with a real wallet (CLAUDE.md's own "never verified end-to-end" list). The
signing leg will be exercised for the first time by a human, and it should be the owner, with a
trivial amount, before anyone else touches it.
