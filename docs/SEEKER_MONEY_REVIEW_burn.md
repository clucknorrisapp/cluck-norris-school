# Seeker money review — the irreversible half

**Scope:** `src/seeker/tools/Firepit.jsx`, `src/seeker/tools/ProjectBurn.jsx`,
`src/seeker/tools/Hatchery.jsx`, `src/seeker/RentReclaim.jsx` (with its two dependencies
`src/seeker/reclaim-sign.js` and `public/rent-reclaim-plan.js`), and the `window.splToken`
instruction shim at `public/airdrop-engine.js:1-170`. Shared seam `src/seeker/sign.js` and the
three server endpoints these panes call were read as part of the same trace.
Branch `claude/seeker-selfhost-fonts` (PR #387), read-only review, 2026-09-21.

**The question asked throughout:** what gets destroyed that the person did not agree to
destroy — and what are they told afterwards?

**Result: 2 P0, 4 P1, 3 P2, 1 P3.** Both P0s are the same shape — an irreversible thing that
happened, reported as a thing that did not happen, with a retry offered on top.

---

## Status — what was closed, 2026-09-21 (same day, branch `claude/seeker-selfhost-fonts`)

This section is the only part of this document that is not the original read-only review. It
records what the fix round actually did, so the report and the code do not drift apart. Every
entry has a test behind it, and every test was mutation-proved — broken on purpose, watched go
red, restored. A guard that has never been seen to fail is not known to work.

| # | State | Where it is pinned |
|---|---|---|
| P0-1 | **CLOSED** | `submitSigned()` in `src/seeker/sign.js` is the one submit path; a transport failure keeps the signature it already holds and falls through to the poll, a node-refused send stays `failed`. `seeker-app-boot-test.cjs` §J drives both shapes through the Locker Room. |
| P0-2 | **CLOSED** | `unconfirmed` is its own outcome in `public/rent-reclaim-plan.js`, counted apart, lamports never added to the reclaimed total, and never auto-retried. `seeker-reclaim-sign-test.cjs` §6b. |
| P1-3 | **CLOSED** | The `Confirm` sheet gained `rows` and `typeToConfirm`; Firepit renders one line per account and requires typing BURN on the desktop's own condition. Boot §L. |
| P1-4 | **CLOSED** | wSOL lamports are added to the SOL-returning total, given their own line, and the permanence sentence is only shown when something is really burned. Boot §L. |
| P1-5 | **CLOSED** | Every logo is re-encoded through a canvas (EXIF cannot survive it), PNG stays PNG, and a line above **Review mint** says the upload is permanent and public before it happens. |
| P1-6 | **CLOSED** | `empty` is derived from the base-unit string in `server.js`, **and** independently in the pane (`isEmpty()`), because the store build is a pinned bundle talking to a live API. Boot §L pre-selection assertion. |
| P2-7 | **CLOSED** | A failed chunk is re-planned as singles and retried once, then the run carries on; only a decline stops it. |
| P2-8 | **CLOSED** | `canBurn` requires a readable balance, and "we could not read it" is its own message, never "your balance changed". |
| P2-9 | **CLOSED for Firepit** | Boot §L is the behavioural test this finding asked for. Project Burn and the Hatchery still have only §B ("it mounts") — see below. |
| P3-10 | **CLOSED** | Each number on the action row has its own label. |

**Found while fixing, not in this review:** Firepit's `fmtSol` took SOL while all eight of its
call sites passed LAMPORTS, so every SOL figure in the tool rendered a billion times too large —
a row's rent as `2039280 SOL` instead of `0.00204 SOL`, including on the action line directly
above the Burn button and on the confirm sheet. Neither adversarial pass caught it and no source
scan could: `fmtSol(a.rentLamports)` looks correct until you read what `fmtSol` does with it. It
was surfaced by §L's wrapped-SOL assertion failing against a number that could not be explained.
Firepit now delegates to the shared `CluckRentMath.fmtSol`, as Rent Reclaim already did.

**Still open:** P2-9 for Project Burn and the Hatchery — both still have no behavioural test
beyond "it mounts", and the Hatchery's Arweave upload in particular has no test at all.

---

## P0-1 · A lost send response tells the user "Nothing was burned", and offers Try again

**Files:** `src/seeker/sign.js:185` and `:197`; `src/seeker/tools/ProjectBurn.jsx:322`, `:122`,
`:352`.

`signSendConfirm` wraps sign + submit in one `try`:

```js
const signed = await provider.signTransaction(tx);          // sign.js:180
…
sig = await rpc("sendTransaction", [bytesToBase64(raw), …]); // sign.js:185
} catch (e) {                                                // sign.js:197
  if (isUserRejection(e)) return { status: "declined" };
  return { status: "failed", error: … };                     // no sig
}
```

A throw from `sendTransaction` is **not** evidence that nothing landed. `CluckUtil.rpc` POSTs to
`/api/helius-rpc`; on a phone that request dies for the ordinary reasons — a cell-to-wifi
handover, a 502 from the edge, a timeout — *after* the RPC node has already forwarded the
transaction to the leader. The transaction is signed, it is valid, and its blockhash is good for
another 60-90 seconds.

**Exact sequence.** Connect, load a mint, type an amount that is **at most half** the balance,
Burn → Confirm → approve in the wallet. The send POST fails. `signSendConfirm` returns
`{status:"failed"}` with no signature. `settleOutcome` (ProjectBurn.jsx:322) stores it, and the
outcome card renders:

> ⚠️ **Burn failed**
> Nothing was burned — the transaction did not land.   *[Try again]*

There is no signature shown (the failed branch never renders one, and there is none to render),
so the user has nothing to check on Solscan. They tap **Try again** → `retryFromOutcome`
(`:352`) clears the card → they tap Burn → `openConfirm` re-reads the balance, which is now
`B − X` → because `X ≤ B − X` the amount still validates → the sheet opens → they sign again.

**X is burned twice. The user approved the second burn on the strength of a sentence the code
could not support.**

**Why Firepit survives the same seam and this does not:** Firepit's transaction is burn **+
close**, so a landed burn removes the token account, and Firepit's pre-sign rescan then finds
nothing to match and refuses (`Firepit.jsx:251-255` → `confirmPhase "stale"`). Project Burn
leaves the account open by design — nothing in the fresh re-read distinguishes "already burned"
from "never burned".

**Suggested fix.** The seam is holding the signed transaction when the send throws, so the
signature is recoverable: read `realTx.signatures[0].signature` (base58) before submitting, and
on a thrown `sendTransaction` return `{status:"unconfirmed", sig}`. Only a *structured*
JSON-RPC error carrying a preflight result (`InstructionError`, `BlockhashNotFound`,
`AlreadyProcessed`) is a true `failed`. Independently, ProjectBurn must not print "the
transaction did not land" or offer Try again for a `failed` that carries no signature — route
that to the ambiguous card the Hatchery already has.

---

## P0-2 · Rent Reclaim collapses "unconfirmed" into "failed", auto-retries it, and reports 0 SOL after the accounts closed

**Files:** `public/rent-reclaim-plan.js:386`, `:467-472`, `:481`;
`src/seeker/RentReclaim.jsx:88-93`, `:369`.

```js
if (isConfirmed) rows.push(mergeRow(c, "confirmed", null, { sig }));
else if (err)    rows.push(mergeRow(c, "failed", "closing transaction failed on-chain: " + err, { sig }));
else             rows.push(mergeRow(c, "failed", "submitted but unconfirmed after the wait — …", { sig }));  // :386
```

`io.confirmSignature` returning `false` is the **ambiguous** outcome — `sign.js`'s own
protection (2) says so in as many words: *"false = 30s with no status, AMBIGUOUS… 'failed'
invites a resend that double-pays. The caller must keep all three."* This caller keeps two. Rent
Reclaim is also the one signing tool missing from the handoff's "three outcomes… carried end to
end" list (`docs/HANDOFF_2026-09-21_SEEKER.md` §2.3), and it is indeed two.

Then the P1-D retry block picks it up:

```js
if (repRow && repRow.outcome === "failed") retryAccounts = retryAccounts.concat(b);  // :470
…
rows = rows.filter(r => !retriedTAs[r.tokenAccount]).concat(retried.rows);            // :481
```

**Exact sequence.** A wallet with ≥2 reclaimable accounts (the retry only fires for
`b.length > 1`). Tap Reclaim → Confirm → sign. The batch **lands**, but no
`confirmationStatus` comes back inside the 30-attempt poll — congestion, or our RPC proxy
blipping for 30 seconds (every attempt `continue`s on a throw and the loop ends `false`,
`sign.js:78-80`). Every row becomes `failed`. The retry re-plans the batch as N single-close
transactions, **asks the wallet to sign a second time**, and every one fails because the
accounts no longer exist. Line 481 then *replaces* the original rows, discarding both the honest
"submitted but unconfirmed" reason and the original signature.

**What the user sees:** `Reclaimed this run · 0.000000 SOL` (RentReclaim.jsx:369), N red
**Failed** rows (`outcomeLabel`, `:88-93`) carrying a raw on-chain error, and no signature to
check. Their SOL is in fact already in the wallet and the accounts are gone — which the
follow-up `scan()` then confirms as an empty Reclaimable list, reading like a broken feature.

**Suggested fix.** Add `unconfirmed` as a real outcome in `sendAndConfirmBatches`, never feed it
to the retry, keep its signature, render it as its own state in `ResultRow`. Retry only when
`confirmError` was thrown — a genuinely landed-and-failed transaction.

---

## P1-3 · Firepit's burn sheet names no token and no amount, and has no type-to-confirm — the desktop tool it claims to copy has both

**Files:** `src/seeker/tools/Firepit.jsx:336-346` (`burnLines`), `:460-470`;
`src/seeker/pane.jsx:143-161`. Desktop original: `public/firepit.html:505-541`.

**Exact sequence.** Tick 12 rows under "Burn tokens", tap Burn. The whole sheet is:

> **Confirm burn**
> Accounts affected: **12**
> SOL returning to your wallet: **0.0244 SOL**
> Known value being destroyed: **$6.10**
> 3 tokens could not be priced — their value is unknown, not zero. They may be worth money.
> This burns the token balance permanently. It cannot be undone — the tokens cannot be recovered.
> *[Cancel] [Confirm and sign]*

Not one symbol, mint or amount. And `openConfirm` can have **silently shrunk** the set between
the tick and the sheet (`:251-255` drops any row that stopped matching on the fresh re-read), so
the count on the sheet can differ from what the user ticked with no row-level account of which
rows went.

`public/firepit.html` does both of the things this drops:
- **a per-row list** — `burn 1.2M · value unknown`, `unwrap 4.1 SOL → back to you`,
  `reclaim 0.00204 SOL` (`firepit.html:505-513`);
- **a typed BURN gate** — `m-go` stays disabled until the word is typed whenever
  `val > TYPE_THRESHOLD || unpriced.length > 0` (`firepit.html:521`, `:538-540`).

The pane header at `Firepit.jsx:18-26` states the guard is *"carried over FAITHFULLY from
public/firepit.html's burnable() / openConfirm() logic"*. It is not; the two pieces of friction
that stand between a mis-tap and a permanent burn are the pieces that were dropped.
`docs/SEEKER_TOOLS_BUILD.md` §3.4 requires "a confirm step naming the exact consequence".

**Suggested fix.** Render `confirmSel` as rows in the sheet (symbol or short mint + the exact
action and amount in the user's own units), and restore the typed-BURN gate on the same
condition the desktop uses.

---

## P1-4 · Wrapped SOL: the sheet says the balance is burned forever and understates the SOL returning by the entire wrapped amount

**Files:** `src/seeker/tools/Firepit.jsx:77`, `:79`, `:235`, `:297`, `:336-346`, `:425`.

wSOL is non-empty, not frozen and not an NFT, so `actionable()` (`:76`) is true: it lands in the
Burn group and **"Select all" ticks it** (`:425`). `burnValueUsd` excludes it (`:336`) and
`isUnpriced` excludes it (`:79`), so neither the value line nor the unpriced warning fires.

**Exact sequence.** A wallet holding 5 wSOL. Burn group → Select all → Burn. The sheet:

> Accounts affected: **1**
> SOL returning to your wallet: **0.00204 SOL**
> This burns the token balance permanently. It cannot be undone — the tokens cannot be recovered.

**What actually happens** (and line `:297` is correct about it): no burn instruction is built,
CloseAccount unwraps, and **5.00204 SOL** comes back. Nothing is destroyed.

Both numbers and the one sentence on the sheet are false, on the screen this product stakes
"guardrails before power" on, immediately before a signature. The row tag at `:88` does say
"Wrapped SOL — unwraps, isn't burned" — but the sheet is a full-screen overlay
(`tools.css:118-126`) and the tag is behind it.

**Suggested fix.** Give wSOL its own confirm line ("Unwrapping 5 wSOL — 5.00204 SOL comes back
to you, nothing is destroyed") and add its lamports to the "SOL returning" total. Falls out of
P1-3's per-row list for free.

---

## P1-5 · The Hatchery permanently publishes the user's photo on "Review mint", before any confirm step

**Files:** `src/seeker/tools/Hatchery.jsx:376` (`review()` POSTs `/build`), `:566` (the button),
`:571` (the loading label), `:178-181` (`prepareLogo` passes a fitting file through untouched);
`hatchery.js:530` (`await uploadMetadata(...)` runs *before* the transaction is built).

**Exact sequence.** Fill the form; tap "Choose a logo image" — `accept="image/*"` (`:532`), so
on a phone this is the camera roll; tap **Review mint**. `/api/hatchery/build` uploads the image
*and* the metadata JSON (name, symbol, description) to **Arweave — permanent, public, on the
project's Turbo key** — as the first thing it does, before it has built anything. The user then
sees a review card with a **"Start over"** button and, after that, a Confirm sheet. Both imply
nothing has happened yet. Cancel anywhere and the image is still permanently retrievable at
`arweave.net/<id>`.

The only hint is the spinner text "Uploading metadata and preparing the mint…", which appears
*after* the upload is already in flight and does not say permanent, public, or undoable.

Two aggravations:
- **EXIF rides along.** A file already ≤100 KiB and png/jpeg/webp is sent byte-for-byte
  (`:178-181`), so a JPEG's GPS coordinates go into a permanent public store. Only the
  *oversized* path re-encodes through canvas and strips it.
- The pane's own header (`:34`) records that `/build` is "a REAL, permanent action — this is not
  a dry-run"; the UI never passes that on to the person.

**Suggested fix.** One line above the button before `/build` runs ("This uploads your logo and
token details permanently and publicly — it can't be deleted later"), and always re-encode
through the canvas so EXIF is stripped regardless of file size.

---

## P1-6 · `/api/burn-scan` decides "empty" from `uiAmount` — and "nothing of value is destroyed" is built on it

**Files:** `server.js:14735` (`uiAmount: Number(ta.uiAmount) || 0`), `server.js:14763`
(`empty: a.uiAmount === 0`); consumed at `Firepit.jsx:199`, `:297`, `:330`.

`uiAmount` is `f64 | null` in the RPC schema and `Number(null) || 0` is `0`. Any account the RPC
declines to ui-scale — the Token-2022 withheld-transfer-fee case that
`public/rent-reclaim-plan.js:95-104` documents by name as P1-B, and fixed on that side — is
therefore classified **empty** here.

**Exact sequence.** Such an account appears in the scan with `empty:true`. Firepit
**pre-selects every empty row on every scan** (`:199`) — nothing else in the app pre-selects
anything. The user taps Reclaim. The sheet asserts:

> These accounts are empty — nothing of value is destroyed.

`onConfirmed` builds CloseAccount only, with no burn (`:297` skips the burn for `a.empty`).

**What stops this being a P0:** the token program refuses to close a non-native account that
still holds a balance, so the transaction reverts and nothing is destroyed. The cost is a false
all-clear in the one sentence that is supposed to be load-bearing, plus the whole 8-account
chunk reported "Failed" and the rest of the run abandoned (`:310-312`). The brief's `uiAmount`
rule was applied to Rent Reclaim and not to the other half of the same job.

**Suggested fix.** `empty: String(ta.amount) === "0"` in `burn-scan`, off the base-unit string
the same response already carries as `amountRaw`; and in the pane, a row whose `amountRaw` is
missing or non-numeric is never `empty`.

---

## P2-7 · One poisoned account fails a whole Firepit chunk and ends the run; Rent Reclaim's retry-as-singles was not carried over

**Files:** `src/seeker/tools/Firepit.jsx:279-316` (chunk loop, `break` at `:312`) versus
`public/rent-reclaim-plan.js:457-483` (the P1-D fix for exactly this).

**Exact sequence.** 24 empty accounts selected, one of them a Token-2022 account with withheld
fees (or frozen-after-scan, or anything the classifier does not model). Chunk 1 fails
atomically. Rows 1-8 all render "Failed" with the raw on-chain error; `runNotAttempted` = 16
accounts "never attempted and are unchanged"; the loop `break`s. Nothing identifies the poisoned
row, and repeating the run reproduces it — the only way forward is bisecting the selection by
hand.

Rent Reclaim already solved this: re-plan a batch that failed outright as one transaction per
account and retry once. Firepit gets neither the retry nor a continue-to-next-chunk.

**Suggested fix.** On a `failed` chunk, re-plan it as singles and retry once, then carry on to
the remaining chunks instead of breaking. (Note P0-2 first: the retry trigger must be a *thrown*
confirmation, never an ambiguous one.)

---

## P2-8 · Project Burn arms the Burn button on an unreadable balance, then blames the user's balance for changing

**Files:** `ProjectBurn.jsx:214`, `:217`, `:219`, `:246`, `:438`; `server.js:17498`.

`/api/burn-token-info` swallows a failed `getTokenAccountsByOwner` and returns 200 with
`walletBalance: null` (`server.js:17498`). In the pane, `balance` is then `null`, `overBalance`
is `false` because it is guarded on `balance != null` (`:217`), and `canBurn` (`:219`) never
requires a known balance — so the card shows **"Your balance: Unknown"** while offering a live
amount field and a live Burn button.

**Exact sequence.** Tap Burn. `openConfirm` re-reads, gets null again, hits
`if (freshBal == null || …) setConfirmPhase("stale")` (`:246`), and prints:

> Your balance changed since this page loaded — reduce the amount or reload, then try again.

A claim about the user's wallet the app has no basis for. The true fact is "we could not read
your balance" — `pane.jsx:29-35`'s own rule is that a failed read is never rendered as the
user's fault and never as a number.

**Suggested fix.** Require `balance != null` in `canBurn`; split the stale branch into "your
balance changed" and "we couldn't read your balance — try again".

---

## P2-9 · Three of the four irreversible tools have no behavioural test

`scripts/seeker-app-boot-test.cjs` has a section G for the Airdropper's three outcomes and a
section H for the Locker Room's two signatures. Grepping it for `firepit` / `burn` returns one
unrelated comment (line 569). Firepit, Project Burn and the Hatchery are covered only by section
B — "it mounts".

Every finding above sits in code no test exercises, including the confirm-sheet content, which
is the surface `docs/SEEKER_TOOLS_BUILD.md` §3.4 makes the guardrails promise on.

**Suggested fix.** One section per irreversible tool, each written as a mutation (break it,
watch it go red): the burn sheet names its rows; a wSOL row is described as an unwrap; a
`sendTransaction` throw never renders "Nothing was burned"; an unconfirmed result never leaves a
retry control on screen.

---

## P3-10 · Firepit's burn action row renders a doubled label

`Firepit.jsx:433` — the trailing `: <strong>{fmtSol(burnLamports)}</strong>` sits *outside* the
ternary, so with any known value the line reads:

> Value to destroy: **$6.10**: **0.0244 SOL**

The SOL figure loses its own label and reads as an equivalence with the dollar figure. Cosmetic,
but it is the line directly above the Burn button.

---

## Checked and found CORRECT — do not re-open these

- **The instruction shim's bytes** (`airdrop-engine.js:22-160`). BurnChecked opcode 15 /
  amount u64 LE / decimals u8; CloseAccount opcode 9; TransferChecked 12; ATA CreateIdempotent
  1; System Transfer `u32(2) + u64` — all match the library layouts, and the account metas match
  too (`mint` writable on burn, `owner` signer-and-not-writable, `destination` writable on
  close). `BigInt(amount)` throws on a float or an exponent string, so a float that ever reached
  the encoder fails the build rather than burning a wrong amount.
- **Base units end to end in both burn paths.** Firepit passes the server's `amountRaw` string
  straight through (`Firepit.jsx:298`); Project Burn's `scaleToRaw` (`:71-78`) is pure string
  arithmetic, and the full-balance case deliberately uses the chain's `walletBalanceRaw` rather
  than the float (`:250`). No float re-enters either burn amount. (The floats that *do* exist —
  `balance`, `amtNum`, the 25/50/100% buttons — only gate and display; a float that cannot be
  expressed as a plain decimal string fails closed at `scaleToRaw`.)
- **Firepit's pre-sign rescan can only SHRINK the frozen set.** `matched` filters the fresh scan
  by the ids already selected (`:254`), so a row can never be *added* between the tick and the
  signature; and because burn + close removes the account, a lost-response retry finds nothing
  to burn a second time. This is a real protection, and it is the one Project Burn lacks
  (P0-1).
- **Project Burn keeps the receipt apart from the burn.** A receipt failure renders "The tokens
  were burned. The verified receipt could not be recorded: …" with a Solscan link
  (`ProjectBurn.jsx:107`), never as a failed burn — and `/api/burn-receipt` re-derives the
  burned amount from the pre/post token-balance delta in BigInt (`server.js:17540-17545`), never
  the client's claim.
- **`recheckPending` cannot fabricate a failure.** `confirmSignature` swallows RPC read errors
  and returns `false` ("still ambiguous, unchanged"), and the recheck passes
  `searchHistory: true` so an hours-old signature can actually resolve instead of reading
  ambiguous forever.
- **The Hatchery's permanent choices are in the row.** Both authority consequences are spelled
  out on the toggle itself (`:539-550`) *and* as their own confirm lines (`:493-497`), in both
  the revoked and the kept wording — not a tooltip. The fee is read live from
  `/api/hatchery/config` on connect and again right before the sheet (`:376`), with no hardcoded
  figure anywhere, and the endpoint's degraded catch-all shape is detected and rendered as
  "Couldn't confirm today's fee" rather than a confident "free".
- **The Hatchery's ambiguous state is right.** A submit-time 5xx and a confirmation timeout both
  route to one non-retryable "Couldn't confirm what happened" card that links the mint and says
  starting again could create a second token — correct, because `hatchery.js:657` deletes the
  pending mint keypair *before* `sendRawTransaction`, so that exact signed transaction can never
  be resubmitted.
- **`Confirm` is a real modal.** `tools.css:118-126` is `position:fixed; inset:0; z-index:30`, so
  nothing behind a confirm sheet can be toggled while it is open, and `pane.jsx:145` returns
  `null` when closed — there is no path to `onConfirmed` that does not go through the sheet.
- **Rent Reclaim's classification is sound** where Firepit's (P1-6) is not: base-unit string only
  (`rent-reclaim-plan.js:102`), wSOL refused outright (`:110`), and the fresh re-read re-checks
  the mint *and* the parsed authority against the connected wallet before anything is built
  (`:187-198`).
- **The Hatchery image path.** Known-untested, as documented — nothing found that is worse than
  untested. `prepareLogo` fails loudly rather than shipping a wrong or unconverted image, and
  chooses JPEG specifically to minimise format branches. The only note is the EXIF pass-through
  folded into P1-5.

---

*Read-only review. No source file was modified. Findings ranked; the coordinator decides what
lands.*
