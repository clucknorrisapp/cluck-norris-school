# Seeker money review — the SENDING half

Adversarial, read-only review of the six Seeker tools' send path, branch
`claude/seeker-selfhost-fonts` (PR #387). Scope: `src/seeker/sign.js`,
`src/seeker/tools/Airdropper.jsx` + `public/airdrop-plan.js` (+ the engine it drives,
`public/airdrop-engine.js`), `src/seeker/tools/LockerRoom.jsx`, `src/seeker/reclaim-sign.js` +
`public/rent-reclaim-plan.js`. Nothing was edited.

The question asked throughout: **where does this tell someone money moved when it didn't, or move
money they did not approve?** — plus its mirror, which is where most of what follows landed:
**where does it tell someone money did NOT move when it may have, and then offer them the button
that does it again?**

10 findings, ranked. One P0, three P1, four P2, two P3. A "checked and correct" section at the end
lists the things a future reader is most likely to suspect wrongly.

---

## Status — what was closed, 2026-09-21 (same day, branch `claude/seeker-selfhost-fonts`)

Added by the fix round, not part of the original read-only review, so the report and the code do
not drift apart. Every entry is pinned by a test, and every test was mutation-proved.

| # | State | Where it is pinned |
|---|---|---|
| P0-1 | **CLOSED** | `submitSigned()` in `src/seeker/sign.js`. Both lenses found this independently, in the same file. Boot §J. |
| P1-2 | **CLOSED** | `unconfirmed` is its own outcome and is never auto-retried. `seeker-reclaim-sign-test.cjs` §6b. |
| P1-3 | **CLOSED** | `estimateCost` now compares the send total against the balance the pane already read — `enoughToSend` / `shortBy`, exact decimal strings via `subDecimal`/`baseUnitsToDecimal`, no float anywhere. `seeker-airdrop-test.cjs`, including the finding's own 100 × 5 SOL from a 2 SOL wallet case. |
| P1-4 | **CLOSED** | `decimals` is reset on the catch and on the no-account branch (which no longer renders a Send button), and the receipt takes its figure from the engine's return value, not React state. |
| P2-5 | **CLOSED** | A native drop is recorded under the canonical wrapped-SOL mint and verified from LAMPORT deltas in `lib/airdrop-receipt.js`. `lib/payout-verify.js` — the Hub's shared money verifier — was deliberately **not** widened for this. `airdrop-receipt-test.cjs`. |
| P2-6 | **CLOSED** | The receipt flushes on batch boundaries during the run, as the comment above it always said, so a backgrounded phone risks one batch rather than the whole receipt. A flush is skipped unless the denomination is known. |
| P2-7 | **CLOSED** | `url` and `error` live in the same object; a partial receipt keeps its link and says "N of M recorded". |
| P2-8 | **CLOSED** | The Locker Room parses with `CluckAirdropPlan.parseAmount`, which refuses an ambiguous format instead of coercing it. Boot §K drives the finding's whole table through the real form and reads the amount that reaches the wire. |
| P3-9 | **CLOSED** | A stopped run says so, and counts the wallets never attempted off the engine's own reason string. |
| P3-10 | **PART CLOSED** | The closable consequence is closed: losing the wallet mid-drop now sets the stop flag, so the engine's own `shouldContinue` halts the run BEFORE the next prompt instead of building every remaining batch for the old address. |

**Still open:** the structural half of P3-10 — the Airdropper still runs its own send loop rather
than `sign.js`'s, so it has neither the live-public-key re-read nor the message-byte diff. The
engine requires `signAndSendTransaction`, which makes the byte diff impossible by construction, so
closing this properly means giving the engine a `signTransaction` branch routed through
`signSendConfirm`. That is a refactor of a file shared with the live desktop page, not a patch,
and it is the largest remaining item in this document.

---

## P0-1 — A submit that fails in transport is reported as "failed, nothing was locked", with the retry button still on screen

**Files:** `src/seeker/sign.js:185`, `:197-200` · `src/seeker/tools/LockerRoom.jsx:494`, `:557-562`
· same shape at `src/seeker/reclaim-sign.js:187` and `public/airdrop-engine.js:387`.

`signSendConfirm` signs the transaction, serialises it, and then submits it itself:

```js
const raw = realTx.serialize();
sig = await rpc("sendTransaction", [bytesToBase64(raw), {...}]);   // sign.js:185
} catch (e) {
  if (isUserRejection(e)) return { status: "declined" };
  return { status: "failed", error: (e && e.message) || String(e) };   // sign.js:199
}
```

`rpc` is `CluckUtil.rpc` (`public/cluck-util.js:35-44`). It throws in three distinct situations
that the code above cannot tell apart:

1. `fetch` rejects — the phone lost signal. The POST may already have reached the origin.
2. `r.json()` throws — the response was not JSON (a Cloudflare 502/504 HTML page, an edge
   timeout). The origin very likely *did* forward the transaction; only the answer was lost.
3. `d.error` — a real JSON-RPC error from the node. This one genuinely means the node did not
   accept it.

Only (3) proves nothing was submitted. (1) and (2) are **unconfirmed**, and the file's own header
(protection 2) says an unconfirmed outcome must never be reported as either of the other two. Here
all three become `{ status: "failed" }` with **no signature at all**, because the signature is only
ever taken from the RPC's echo — although it already exists locally, inside `realTx.signatures[0]`,
at the moment the wallet returns.

**What the user sees (Locker Room).** `LockResult`'s default branch, `LockerRoom.jsx:557-562`:

> **The lock did not go through** — Failed to fetch
> *Nothing was locked — your tokens are where they were. You can fix the problem above and try
> again.*

No Solscan link (there is no `sig`). And `LockerRoom.jsx:494` keeps the **"Lock tokens"** button on
screen for `failed` and `declined` — deliberately, and correctly for a genuine failure.

**Exact sequence that loses money.**
1. Review a lock → `plan` holds `txBase64` + `baseSecret`.
2. Tap *Confirm and sign*. Phantom signs. `sendTransaction` goes out over a mobile connection.
3. The connection drops (or Cloudflare 524s) after the request reached the origin. The escrow is
   created on chain a second later.
4. The card says *"Nothing was locked — your tokens are where they were."* The user taps **OK**,
   which runs `onDone` → `setPlan(null); setPhase("form")`.
5. They tap *Review the drop* again. `/api/lock/create-tx` mints a **new `baseSecret` and a new
   escrow**, so the second transaction is not a duplicate of the first — the network cannot
   de-duplicate it.
6. They sign. **The tokens are now locked twice, in two escrows, irreversibly** (`cancelable`
   defaults to `false`), on a pane whose own copy reads *"This lock CANNOT be canceled."*

Tapping *Lock tokens* again **without** pressing OK is survivable by luck: the same plan produces
byte-identical transaction bytes, ed25519 is deterministic, so the network sees the same signature
and de-duplicates it — until the blockhash expires (~60-90 s), after which that path fails too and
the user is pushed back to step 4 anyway.

**Fix.** Distinguish the three cases at the one place that can:
- Capture the local signature *before* submitting (`bs58.encode(realTx.signatures[0].signature)`).
- On a JSON-RPC error object → `{ status: "failed" }` as today (nothing entered the cluster).
- On any transport error → `{ status: "unconfirmed", sig: localSig }`. The unconfirmed card
  already exists, already hides the retry button, and already says *"do NOT lock again."*
- Then make `LockResult`'s failed copy conditional rather than absolute — "nothing was locked" is a
  claim, and it should only be made when a signature was confirmed failed on-chain or the wallet
  never returned one.

The same three-way split belongs in `reclaim-sign.js:187` and `airdrop-engine.js:387`
(a wallet that throws after broadcasting is the same ambiguity; for the airdrop the retry is a
double-**pay**).

---

## P1-2 — Rent Reclaim has only two outcomes: "unconfirmed" is recorded as `failed`, and then auto-retried without asking

**Files:** `public/rent-reclaim-plan.js:386`, `:466-484`, `:271-287` ·
`src/seeker/RentReclaim.jsx:100-103`, `:369`.

`sendAndConfirmBatches` maps three confirmation results onto two outcomes:

```js
if (isConfirmed)   rows.push(mergeRow(c, "confirmed", null, { sig }));
else if (err)      rows.push(mergeRow(c, "failed", "closing transaction failed on-chain: " + err, { sig }));
else               rows.push(mergeRow(c, "failed", "submitted but unconfirmed after the wait — …", { sig }));  // :386
```

There is no `unconfirmed` outcome anywhere in this module: `summarize` (`:271-287`) knows only
confirmed / failed / skipped / rejected, and `outcomeLabel` (`RentReclaim.jsx:88-93`) renders
anything that is not one of the other three as **"Failed"**.

That alone would be a reporting problem. What makes it a P1 is what happens next. The P1-D retry
at `:466-470` keys off exactly that outcome:

```js
if (repRow && repRow.outcome === "failed") retryAccounts = retryAccounts.concat(b);
```

so a batch that is merely **unconfirmed** is re-planned as one transaction per account and
**re-signed and re-sent automatically**, and the rows are then replaced wholesale:

```js
rows = rows.filter(function (r) { return !retriedTAs[r.tokenAccount]; }).concat(retried.rows);  // :481
```

**Exact sequence.**
1. Wallet with 40 dead token accounts → `planBatches` produces 2 batches (26 + 14).
2. Batch 1 is submitted; `getSignatureStatuses` returns `null` for 30 s (congestion, or a lagging
   status cache — the ordinary reason this state exists). `confirmSignature` returns `false`.
3. All 26 rows are recorded `failed` with signature `S1`.
4. `b.length > 1` and the representative row's outcome is `"failed"` → all 26 go into
   `retryAccounts`. A **second `signAllTransactions` prompt** appears, for 26 single-close
   transactions — on a feature whose spec sold "many batches, one wallet prompt".
5. `S1` lands. Each retry now closes an account that no longer exists → lands and fails →
   `confirmSignature` throws → 26 rows recorded `failed: closing transaction failed on-chain`.
6. `:481` deletes the original rows, and with them **`S1` — the only handle the user had on the
   transaction that actually worked**.
7. Final screen: **"Reclaimed this run · 0 SOL"**, 26 accounts "Failed" — while ~0.05 SOL of rent
   did arrive, and ~130,000 lamports of fees were spent on 26 landed-and-failed retries the user
   never asked for (a failed transaction still pays its fee).

`RentReclaim.jsx:245` also only accumulates `outcome === "confirmed"` into `closedTokenAccounts`,
so the session's idempotency memory does not learn about them either.

**Fix.** Give this module the third outcome the rest of the app has. `unconfirmed` gets its own
value, its own label and its own count; `summarize` reports it separately and never adds it to
`reclaimedLamports`; and **the P1-D retry triggers on `failed` only, never on `unconfirmed`**
(the comment defending the retry as safe argues from "closing twice is a no-op", which is true of
the chain but not of the report). When rows are replaced at `:481`, carry the earlier signature
forward rather than dropping it.

---

## P1-3 — The Airdropper reads the sender's token balance and throws it away, so nothing warns before a drop that runs out part-way

**Files:** `src/seeker/tools/Airdropper.jsx:182-192`, `:197`, `:437-441` ·
`public/airdrop-plan.js:244-245`.

`review()` fetches the sender's token account and pulls exactly one field out of it:

```js
const onchain = first.account.data.parsed.info.tokenAmount.decimals;   // :185-187
```

`tokenAmount.amount` — the exact base-unit balance, already in hand, in the same object — is never
read, and `parsed.total` is never compared against it. `estimateCost`
(`airdrop-plan.js:244-245`) computes `affordable` from **fees and rent only**:

```js
affordable: typeof opts.solBalanceLamports === "number"
  ? opts.solBalanceLamports >= feeLamports + rentLamports : null,
```

so the one pre-send affordability warning the pane has (`Airdropper.jsx:437-441`) can never fire
for the amount being sent. Its own text names the exact harm it is failing to prevent:

> *"Your wallet does not hold enough SOL to cover that. Top it up before starting — a drop that
> runs out part-way pays some wallets and not others."*

**Exact sequence (token mode).** Wallet holds 1,000,000 TOKEN. The operator pastes a list totalling
1,500,000. Review succeeds with no warning at all. Confirm sheet: *"You are about to send 1500000
tokens to 640 wallets."* They approve. Batches 1..k land; from batch k+1 on, every batch lands and
fails with `insufficient funds`, one wallet prompt at a time, each costing a fee. Final screen:
Sent 410, Failed 230 — and the public receipt publishes the 410 as a completed drop.

**Exact sequence (SOL mode).** Wallet holds 2 SOL. 100 wallets × 5 SOL = 500 SOL. `cost.affordable`
is `true` (2 SOL ≫ 0.000035 SOL of fees), no warning, and the confirm sheet says the drop costs
"about 0.000035 SOL". Every batch then fails.

**Fix.** Compare `parsed.total` to the balance already read — `tokenAmount.amount` for a token drop,
`solBalanceLamports − (fees + rent)` for a SOL drop — using `CluckAirdropPlan.cmpDecimal` so no
float enters, and show the existing `affordable === false` warning. This is a comparison of two
values the pane already holds; it needs no extra RPC.

---

## P1-4 — The Airdropper's `decimals` state is never reset and is not taken from the engine, so the public receipt can be recorded against the wrong mint's decimals

**Files:** `src/seeker/tools/Airdropper.jsx:127`, `:192`, `:206-210`, `:246`, `:260-264` ·
`lib/airdrop-receipt.js:47-58`, `:184-186`.

`setDecimals` is called in exactly one place — `:192`, inside the `try` in `review()`, *after* two
awaited RPC calls — and is never reset when the mint changes, when `native` is toggled, or when
that `try` fails. The catch at `:206-210` deliberately keeps the parsed list and only drops the
cost preview:

```js
} catch (_e) {
  if (!liveRef.current) return;
  setCost(null);
  setPhase("review");      // ← Send button renders; `decimals` still holds the PREVIOUS run's value
}
```

The engine's return value carries the authoritative figure (`airdrop-engine.js:416` returns
`{ sent, failed, unconfirmed, decimals }`) — `Airdropper.jsx:260` discards it, and `:246` posts the
stale React state to the receipt.

**Exact sequence.**
1. Send a drop of token **A** (6 decimals). Review succeeds → `decimals = 6`.
2. *Start another drop* (`resetRun()` clears results, not the form or `decimals`).
3. Change the mint to token **B** (9 decimals), paste the new list.
4. Tap *Review the drop*. `getTokenAccountsByOwner` throws once — a 502 from `/api/helius-rpc`, or a
   two-second tunnel. Catch fires. `decimals` is **still 6**.
5. Screen shows the list plus *"Could not read the network cost right now…"* — which reads as a
   cosmetic problem — and the Send button.
6. Send. **The chain transfer is correct**: `airdrop-engine.js:343-347` re-reads decimals from the
   mint itself and overrides `opts.decimals`.
7. `record()` posts `decimals: 6` with amounts denominated in 9. In `lib/airdrop-receipt.js`,
   `toRaw(amount, 6)` yields a `minRaw` **1000× too small**, so every row clears `rowPaidBy`
   against a threshold three orders of magnitude below what it claims: the receipt records
   `verified: true` on a check that has stopped meaning anything.
8. In the opposite direction (A = 9 then B = 6), `toRaw` is 1000× too large and **every row records
   `verified: false`** while the drop was perfect — and the pane still renders *"Public receipt:
   open it"*, because it only looks at `j.success`.

The same `try` also covers the `!first` branch at `:180-184` ("your wallet has no account for that
token") — which sets a form error but *also* sets `phase: "review"` with `parsed` already
populated, so the **Send button renders anyway** on a mint the wallet cannot send.

**Fix.** Three small changes, any one of which closes it, all three preferable:
`setDecimals(null)` in every `onChange` that already calls `setParsed(null)`; take the receipt's
decimals from the engine's return value (`const r = await E.send(...)` → `r.decimals`) rather than
from state; and `return` (not fall through to `phase: "review"`) in the `!first` branch.

---

## P2-5 — A SOL airdrop can never be recorded: the receipt is refused on every native drop

**Files:** `src/seeker/tools/Airdropper.jsx:245` · `lib/airdrop-receipt.js:184`.

The pane posts `mint: native ? "native" : mint.trim()`. `recordDrop` validates it with
`SOL_ADDR_RE` — a base58 32-44 pattern — so the literal string `"native"` is rejected:

```js
if (!SOL_ADDR_RE.test(String(mint || ""))) return { ok: false, status: 400, error: "bad mint" };
```

**Exact sequence.** Toggle *Send SOL instead of a token*, paste 50 wallets, send, everything lands.
The result screen says *"The tokens sent. The public receipt did not record them: bad mint"* —
every time, for every SOL drop, deterministically. The pane's own lede promises *"with a public
receipt anyone can check afterwards."*

The reporting is honest, which is why this is P2 rather than P1: nobody is told money moved that
didn't. But the feature simply does not exist for half the tool's modes.

**Fix.** Either give native drops a real handle on the server side (the wrapped-SOL mint
`So11111111111111111111111111111111111111112` is the obvious candidate, with the verification
switching from `tokenDeltas` to lamport deltas), or make the pane state plainly, *before* the send,
that a SOL drop has no public receipt. Do not leave it as a per-drop error.

---

## P2-6 — The receipt is posted once at the very end, although the comment above it says why it must not be

**Files:** `src/seeker/tools/Airdropper.jsx:235-256`, `:270-279`.

The comment at `:235`:

> *"Record each batch's confirmed rows as they land, not once at the end: an app backgrounded by
> the OS mid-run (a real thing on a phone) would otherwise take the whole receipt with it."*

The code does the opposite. `onResult` accumulates into a local array (`:273`), and the single
`record` call happens after the entire run:

```js
await E.send({ ... onResult: (r) => { ... if (r.status === "sent" && r.sig) pendingReceipt.push(r); } });
} catch (e) { ... }
await record(pendingReceipt);   // :279 — once, at the end
```

The desktop page it is modelled on does record per batch (`public/airdrop.html`,
`recordDropRows(rowsForBatch)` is called from inside the batch loop).

**Exact sequence.** A 600-wallet drop is ~38 batches and ~38 wallet prompts — minutes of alternating
between the wallet app and the Seeker app on a phone. iOS reclaims the tab at batch 30. Thirty
batches of tokens are on chain; `record` never ran; the receipt does not exist and there is no path
in the pane to create one from rows it no longer has. The operator has moved real tokens with no
public proof and no way to produce it.

**Fix.** Call `record(...)` from inside `onResult` (or from an `onProgress` boundary) for each
confirmed batch, exactly as the comment and the desktop page describe. `dropId` threading already
supports it — that is what the `dropId: dropId || undefined` continuation at `:245` is for.

---

## P2-7 — One failed receipt chunk erases the link to the rows that were recorded

**File:** `src/seeker/tools/Airdropper.jsx:240-255`.

`record()` chunks at 100 rows and, on the first failure, replaces the receipt state and returns:

```js
if (!j || !j.success) { setReceipt({ error: ... }); return; }
dropId = j.dropId;
if (liveRef.current) setReceipt({ url: j.url });
```

**Exact sequence.** A 250-row drop records chunks 1 and 2 (200 rows, `receipt = { url }`); chunk 3
hits the rate limiter (`rateLimit("airdropRecord", { max: 30 })` at `server.js:7792`) or a blip.
`setReceipt({ error })` **overwrites the URL**, and the screen says:

> *"The tokens sent. The public receipt did not record them: …"*

— while 200 of them are on the receipt, at a URL the user can no longer see. Two distinct facts
("no receipt" and "a partial receipt") are collapsed into the worse one, and the recoverable state
is discarded.

**Fix.** Keep `url` and `error` in the same object (`setReceipt((p) => ({ ...p, error }))`), and
say "recorded 200 of 250 — the rest did not make it" with the link still shown. Retrying the
remaining chunks against the same `dropId` is also safe and worth doing.

---

## P2-8 — The Locker Room parses the amount with `parseFloat` — the exact coercion `airdrop-plan.js` exists to refuse — and locks the result irreversibly

**Files:** `src/seeker/tools/LockerRoom.jsx:280`, `:301` · `lib/jup-lock.js:46-48` ·
`public/airdrop-plan.js:19-25`, `:55-87`.

```js
const amt = parseFloat(String(amount).trim());        // :280
if (!(amt > 0)) { setFormError("Enter an amount greater than zero."); return; }
...
amount: String(amt),                                  // :301 — what the server locks
```

`public/airdrop-plan.js`'s header, and `docs/HANDOFF_2026-09-21_SEEKER.md` §2b, both name this
exact function call as a live money bug worth writing a whole module to avoid. The module is
already loaded in this bundle. The Locker Room does not use it.

**Exact sequences.** All silent — no error, no warning:

| Typed into "Amount to lock" | `parseFloat` | What gets locked |
|---|---|---|
| `1,234.56` (English grouping) | `1` | **1** token |
| `1.234,56` (European) | `1.234` | **1.234** tokens |
| `1 000 000` (space grouping, common on phone keyboards) | `1` | **1** token |
| `1000000 CLKN` | `1000000` | correct, by luck |

The server would have handled the first of these correctly on its own — `lib/jup-lock.js:47` does
`.replace(/,/g, '')` before validating — so the client is strictly worse than the API it calls.

**What the user sees.** The confirm sheet does derive its number from the server's
`schedule.totalRaw`, so it shows the *coerced* amount — but through `fmtNum`, which renders `1` as
"1" and `1234.56` as "1.23K". A user who typed `1,234.56` and reads "Locking: **1** CLKN" may well
catch it; a user who typed `1.234,56` and reads "**1.23**" on a phone will not. And the result is a
**non-cancelable** lock of the wrong amount, on the pane whose own copy says *"The tokens cannot be
retrieved before the dates above, by anyone, including us."*

**Fix.** Replace `parseFloat` with `window.CluckAirdropPlan.parseAmount(amount)` — it is in the
bundle, it is fixture-tested, and it **refuses** an ambiguous row with a reason instead of guessing.
Send `parsed.value` (the normalised decimal string) as `amount`, never `String(parseFloat(...))`.

---

## P3-9 — After Stop, rows that were never attempted are counted under the "Failed" tile

**Files:** `public/airdrop-engine.js:361-364` · `src/seeker/tools/Airdropper.jsx:303-307`, `:315-320`.

`shouldContinue` returning false makes the engine report every remaining recipient as
`status: "failed", error: "stopped by the caller before sending"`. Per row that is defensible — the
pane's own header defines `failed` as "landed and failed, **or never went**: nobody in that batch
was paid" — and each row does render the reason text.

The summary does not. `Airdropper.jsx:315-320` shows two tiles, `Sent` and `Failed`, and nothing
else. An operator who stops a 500-wallet drop after 40 recipients sees:

> **Sent 40   Failed 460**

with no statement that they stopped it, and no count of "not attempted". "460 failed" is the
reading of a run that went badly wrong, not one that was halted on purpose.

**Fix.** Either a fourth status (`stopped`) carried through the engine's report, or — smaller — a
banner in the done view when `stopRef.current` is true: "You stopped this drop. N wallets were
never attempted; nothing was sent to them." The per-row reason string is already the right text.

---

## P3-10 — The Airdropper is the one signing tool that sits on none of `sign.js`'s protections, and an in-flight run keeps prompting after the app drops the wallet

**Files:** `public/airdrop-engine.js:384-387` · `src/seeker/tools/Airdropper.jsx:260-265` ·
`src/seeker/App.jsx:60-73` · `src/seeker/sign.js:25-33`.

`sign.js`'s header presents four protections as the ones "every tool that touches a wallet needs".
The Airdropper — the app's only bulk money mover — uses none of them: the engine requires
`provider.signAndSendTransaction` and calls it directly, so there is no live-public-key re-read
(protection 3) and no message-byte diff (protection 4, which the same header says was added because
a wallet returning reordered results was "proved to send successfully — rows silently carrying each
other's signatures"). The engine builds every batch with `feePayer: opts.walletPubkey`, a value
captured from React state when `send()` was called.

This is partly structural (the engine predates the seam and is shared with the desktop page), and
`signAndSendTransaction` makes the byte diff impossible by construction — so it is noted rather than
argued as a bug. One consequence is worth closing on its own, though:

**Exact sequence.** Mid-drop, the user switches accounts in their wallet. `App.jsx:62-66` fires and
**drops the connection entirely** (`setState({ connected: false, provider: null, ... })`) — the right
call. But the in-flight `send()` closed over `wallet.provider` and `wallet.address` at `:260-262`
and keeps going: every remaining batch is still built for the old address and still prompts the
now-different wallet. Nothing sets `stopRef.current`. Best case, the remaining batches fail with
signature-verification errors and land in the Failed count; a lenient shimmed provider is the case
protection (3) exists for.

**Fix.** A `React.useEffect` watching `wallet.connected` that sets `stopRef.current = true` when it
goes false — the engine's `shouldContinue` hook then stops the run before the next wallet prompt,
which is exactly what it is for. Separately, if the engine ever gains a `signTransaction` branch,
route it through `signSendConfirm` rather than growing a second copy of the seam.

---

## Checked and found CORRECT

Worth writing down — each of these is something a future reader is likely to suspect:

- **`confirmSignature` (`sign.js:87-88`) tests `err` before `confirmationStatus`,** and so does the
  engine's own copy (`airdrop-engine.js:310-312`). The original P0 is genuinely fixed in both
  places, and an RPC read failure during the poll `continue`s rather than fabricating a failure
  (`sign.js:80-83`) — failing all 30 attempts ends in `false` (ambiguous), never `failed`.
- **The Airdropper's on-chain amounts are never wrong, even when the pane's `decimals` state is
  stale.** `airdrop-engine.js:343-347` re-reads the mint's decimals from the sender's own token
  account and overrides `opts.decimals` before `toBaseUnits` is called. P1-4 above is a *receipt*
  bug only.
- **The amount really does stay a decimal string from paste to base units.** `airdrop-plan.js`
  parses, sums (`addDecimal`) and compares (`cmpDecimal`) without a single `Number()`;
  `Airdropper.jsx:264` passes `r.amount` through unchanged; `toBaseUnits`
  (`airdrop-engine.js:196-213`) does BigInt string surgery. The only float left in the path is
  `createSolTransferInstruction(..., Number(ix.amount))` at `airdrop-engine.js:290`, which loses
  precision above 2^53 lamports ≈ 9,007,199 SOL in a single row — not reachable in practice, but
  the `Number()` is gratuitous (the shim does `BigInt(lamports)` on the next line and would take
  the BigInt directly).
- **Only confirmed rows reach the public receipt.** `Airdropper.jsx:273` gates on
  `r.status === "sent" && r.sig`; nothing unconfirmed or failed can be posted.
- **A receipt failure is never reported as a failed send.** `Airdropper.jsx:346-349` says "The
  tokens sent. The public receipt did not record them" — the right separation. Same in the Locker
  Room (`LockerRoom.jsx:538-540`).
- **The Locker Room's two-signer order is right.** `signSendConfirm` takes the wallet's signature
  first, diffs the compiled message bytes, *then* runs `coSign` → `partialSign` with the ephemeral
  escrow key, then serialises and submits itself. It never calls `signAndSendTransaction` when a
  co-signer exists (`sign.js:186-190` refuses outright). `partialSign` does not recompile the
  message, so the diff stays meaningful.
- **The unconfirmed lock cannot be re-locked by accident.** `LockerRoom.jsx:494` removes the "Lock
  tokens" button for both `sent` and `unconfirmed`, and the unconfirmed card carries the signature
  and says not to lock again.
- **Account switching invalidates the Locker Room plan.** `App.jsx:62-66` drops the connection on
  `accountChanged`, which unmounts `CreateLockTab`'s form into `NeedsWallet` — so a server-built
  transaction cannot be signed by a different account than the one it names. (The Airdropper's
  in-flight case is P3-10.)
- **Rent Reclaim's `reclaimedLamports` counts only confirmed rows** (`rent-reclaim-plan.js:274`),
  and the fresh pre-sign re-read (`getFreshBalances` → `reverifyBalances`) returns `null` on any
  chunk failure rather than a partial result — "unknown" never reads as "safe".
- **`isUserRejection` is applied before the failure branch** in all three send paths, so a decline
  is never reported as an error the person did not cause.

---

*Written by an adversarial read-only review, 2026-09-21. Nothing in this document was fixed; the
coordinator decides what lands.*
