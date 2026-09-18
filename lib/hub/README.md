# The Project Hub — the settlement library's public contract

This is `lib/hub/`'s contract in plain words: what it models, what it guarantees, what it serves
over HTTP today, and how a second product — one that never reads `server.js` — could consume it.
It follows `docs/DESIGN_PROJECT_HUB_2026-09-10.md` (the design) and its **Addendum B** (the
settlement protocol) and **Addendum C** (the teach block); read those for the reasoning, this file
for the shape.

No yield language here or on any surface this library feeds. Nothing is "safe" or "verified" —
see **What is NOT independently verified yet** below.

## 1. The entities

- **Project** (`lib/hub/project.js` `validateProject`/`approveProject`) — one row per project:
  its mint, its **reward asset** (may differ from the locked mint — first release is one immutable
  reward asset per project), its funding wallet, its operator wallets, and its platform-access
  tier. Owner-approved only. The public projection is `project-public.schema.json`.
- **Program version** (`lib/hub/project.js` `versionRecord`/`createVersion`) — the terms a program
  runs under: pool size, term tiers, exclusions (Rule B — the funding wallet and every wallet that
  funds the pool are always excluded), payout cadence, which lock shapes qualify. Immutable once
  effective; editing terms creates version *n+1*, effective the next UTC day, and the version it
  replaces keeps its own hash forever. `program-version.schema.json`.
- **Ledger partition** (`lib/hub/ledger.js` `partition`) — per wallet per project:
  `accrued = available + reserved + paidApplied`, with `excess = paidTotal − paidApplied` kept
  **separate and never netted** across wallets (Addendum B2). `available` is the only number a new
  batch may draw on.
- **Eligibility record** (`lib/hub/eligibility.js` `eligibilityRecord`) — per escrow, per moment:
  `qualifies` plus a `reasons[]` of stable **codes** (`below_min_lock`, `term_too_short`,
  `excluded_creator`, `seen_before_program`, …) — every branch of the underlying `disqualify()` is
  mapped to a code, and an unmapped string surfaces as `other` rather than silently vanishing (a
  test asserts none ever does). Terms are measured **forward from our own `firstSeenAt`, never from
  `vesting_start_time`** — the lock program lets a creator set that field to anything, and live
  escrows have declared 2069 and 2077.
- **Batch** (`lib/hub/ledger.js` `buildBatch`) — a set of rows reserved together, drawing only on
  `available`, paying under one program version. Lifecycle: `pending → cancelled` (nothing
  settled) or `pending → closed` (settled after some rows landed) or, as a *display* state derived
  from the journal, `sent` (every row's remainder is zero). `batch.schema.json`.
- **Settlement journal entries** (`lib/hub/ledger.js` `settle`) — Addendum B1: **one idempotent
  durable write per transfer**, keyed by the chain's own identity of the transfer
  (`settle:<sig>:<instructionIndex>[:<innerIndex>]`), global across every project. "This identity
  is consumed" and "this row received this transfer" are both *read from* the journal; a row's paid
  state is a derived index rebuilt from it, never a second source of truth to keep in sync. There
  is no unconsume, and a crash on either side of the journal write is provably safe (fault-injected
  in `scripts/hub-core-test.cjs`, section "B1").
- **Receipts** (`lib/hub/ledger.js` `receipt`) — Addendum B3: an **append-only aggregate** per
  (batch, wallet) with one immutable `settlements[]` entry per journal event. A 100-owed row paid
  as 40 + 40 + 20 carries three entries; `totals.appliedRaw` is their sum, never any one of them.
  The pure ledger's `settle()` can still compute `excessRaw` (capping an oversized transfer's
  applied amount and reporting the rest as excess) — this is exercised only by its own unit tests
  now. Every LIVE route call (`lib/hub/settle.js` `settleAndPersist`, used by every branch of
  `POST /api/hub/:project/payout`) settles with `exactOnly: true`, so a settlement is recorded only
  when its verified amount equals the row's remaining EXACTLY — an oversized or undersized transfer
  is refused (`amount_mismatch`) rather than partially applied (Round 3, docs/
  HUB_JOURNAL_VERIFY_2026-09-18.md #1). `totals.excessRaw`/`settlements[].excessRaw` are therefore
  always `"0"` on anything a live request ever writes; `paidFrom` names the verified source wallet
  when it differs from `fundingWallet` (Round 3 N3). `receipt.schema.json`.

## 2. The invariants (Addendum B — do not relax these without a design PR first)

1. **One idempotent settlement event per transfer.** A retry with the same `sig:instructionIndex`
   either returns the same result (this row already owns it) or is refused with
   `transfer_already_consumed`, naming the project/batch/wallet that does. There is no path that
   applies a transfer twice, and no path that "unconsumes" one. **This is why `&void=` on
   `POST /api/hub/:project/payout` REFUSES a row the settlement journal already holds an event
   for** (crash P1-2, docs/HUB_JOURNAL_VERIFY_2026-09-18.md, closed 2026-09-18) — "it never went"
   is not a fact this route can assert once the chain has an on-chain transfer for that exact row;
   the refusal names the `xferKey`. A legacy-recorded row whose transfer never journaled (an
   ambiguous/batched transaction — see §5) is not "already journaled" and can still be voided.
   Voiding is otherwise unchanged: the exact signature is required, the amount comes off `paid`,
   and a completed batch reopens for a re-send of that one row.
2. **Overpayment is kept as `excess`, never netted across wallets — and, on the live route path,
   never reachable at all.** `paidApplied = min(paidTotal, accrued)`; `excess = paidTotal −
   paidApplied` remains true of the pure ledger arithmetic and its own unit tests. Every live
   settlement goes through `settle()`'s `exactOnly` mode (Round 3 #1), which refuses
   (`amount_mismatch`) rather than caps a transfer that is not exactly the row's remaining, so a
   route-written entry's `excessRaw` is always `"0"`. Wallet A's excess (where it can still occur,
   in a direct pure-ledger caller) can never hide wallet B's unpaid amount — obligations are
   `Σ(accrued − paidApplied)`, a per-wallet sum.
3. **Settlement entries are append-only, per transfer.** Nothing on a receipt is ever rewritten or
   removed; a partial payment narrows what remains, it never replaces what already landed.
4. **Terms are measured forward from our own `firstSeenAt`, never from `vesting_start_time`.** This
   is a project-agnostic generalisation of the rule CUNA already shipped under
   (`docs/CUNA_STAKING_RUNBOOK.md`) — the lock program's own vesting-start field is creator-set and
   cannot be trusted as a term horizon.

The partition invariant `accrued = available + reserved + paidApplied` (with `available ≥ 0` and
`excess ≥ 0`) is asserted after every ledger operation — accrue, reserve, attempt, settle, cancel,
waive, reconcile, migrate — by `lib/hub/ledger.js checkInvariant` and pinned in
`scripts/hub-core-test.cjs`.

## 3. Batch lifecycle and the signed-attempt state machine

A batch's own stored `state` is `pending → cancelled | closed`. Per-row state (`pending → partial →
paid`, or `→ waived`) is derived, never stored: it comes from replaying the settlement journal
through `lib/hub/ledger.js rowState`.

On top of that, `lib/hub/attempts.js` implements the signed-attempt flow from design §4 (rev 4) —
every payout attempt identified by its OWN transaction signature *before* broadcast, so a lost tab
can never leave money in an unknown state:

```
pending ──attempt──▶ signing ──signature registered──▶ submitted ──reconcile: found+verified──▶ settled
             │                     │
             │ blockhash expired   │ blockhash expired AND a complete "not found"
             │                     │ AND two reconciles ≥60s apart agree
             ▼                     ▼
          pending               pending   (kept as a `failed` attempt on the row)
```

Reconcile is **by that signature only** — never by payer/recipient/mint/amount — so a shared
funding wallet or a second project paying the same person the same amount can never be mistaken
for this attempt. This state machine is complete and unit-tested
(`scripts/hub-attempts-test.cjs`, six fault cases plus the earlier concurrency set), but the FULL
`pending → signing → submitted` flow above is for a browser wallet's own `signTransaction` — no
route drives it end to end yet (that needs a UI that never calls `signAndSendTransaction`, per
`/locker-room`'s pattern). What the live payout route DOES use, since W3: two narrower, pure
after-the-fact stamps — `stampSubmitted` (the managed payer has signed and is about to broadcast —
`lib/whirlpool-vault.js`'s own "journal before broadcast" moment, which has no client-supplied
blockhash to register through `registerAttempt`) and `stampSettled` (a row's transfer has been
verified and journaled, by either payout path) — landing on the SAME `batch.attempts[wallet]` field
so the desk and `lib/traction.js`'s "batches signed" counter read it identically either way. A row
with a LIVE (`signing`/`submitted`) attempt from the actual browser-sign flow is never clobbered by
either stamp — see `lib/hub/attempts.js`'s own comment for the one exception (a stamp's own prior
`submitted` transitioning to its own `settled` is not "clobbering a different attempt").

### 3a. X6/CC5 — the browser-signed BATCH payout (`sign-request` / `observe`)

Landed with a real UI (`public/hub-desk.html`'s SIGN AND SEND FROM MY WALLET button), but as a
**batch-level** two-step, not the per-row `lib/hub/attempts.js` machine described above — that
machine (`registerAttempt`/`recordSignature`/`reconcile`, one row at a time, tracking a
`recentBlockhash`/`lastValidBlockHeight`) is still unwired to any route. This is a coarser
sibling, tracked on `batch.browserSign` (not `batch.state`, which keeps the existing
pending/sent/cancelled/closed vocabulary every other route reads):

```
POST …/batch/:batchId/sign-request        POST …/batch/:batchId/observe
  pending ────────────────────▶ signing ──(sigs fetched, some/none settle)──▶ submitted
                                    │  │                                          │
                                    │  └──(owner clear=1)──▶ cleared             (every named row's
                                    │                                             remaining reaches 0,
                                    │                                             AND no signature
                                    │                                             this call submitted
                                    │                                             is still unindexed)
                                    ▼                                              ▼
                              (stays signing until observed)                  settled
```
`cleared` and `settled` are both terminal, non-live states (`browserSignIsLive` only matches
`signing`/`submitted`); `observe` answers the same `already:true` shape for either, with a note
that differs (`browserSignAlreadyNote`).

- `sign-request` (owner, the project's funding wallet, or an allowlisted `payoutSources` wallet —
  narrowed from "any operator" in the round-2 verification pass, P2-5: an operator whose own
  wallet could never legitimately settle a row should not receive real transfer parameters to
  broadcast from it, since `observe` would just refuse and deadlock the batch behind it — POST-only,
  `hubheavy`-limited, refused for a `dryRun` project before any other branch including `clear=1`)
  computes each still-owed row's exact remaining amount (`ledger.rowState`, intersected with
  `pay.remainingOf(bt)` so a row the managed payer already broadcast — legacy-`sent`, even before it
  journals — is never re-offered here; a row settled to zero some other way, e.g. an owner waive, is
  still NAMED in `skipped` with "nothing remaining on this row" rather than silently vanishing) and
  derives its destination ATA server-side (`lib/solana-addr.js deriveAta` — no `@solana/web3.js`
  needed for this). It returns `{ mint, decimals, tokenProgram, fundingWallet, payoutSources, rows:
  [{wallet, source, destination, amountRaw}], nonce, idempotencyKey }` — a description the browser
  reuses `public/airdrop-engine.js`'s existing `splToken.*` helpers to build from (never
  `SystemProgram.transfer()`/`toBufferLE` — CLAUDE.md). It stamps `batch.browserSign =
  {state:"signing", nonce, wallets:[...], mint, decimals, tokenProgram, fundingWallet,
  payoutSources, observedSigs, ...}` in one persist — **every settlement-relevant parameter is
  FROZEN here and `observe` reads all of it back from `batch.browserSign`, never the live project
  record**, so an owner edit to `payoutSources` (say) between the two calls can never silently
  change which source wallet an already-broadcast transfer is checked against.
  - A second `sign-request` while the prior one is `signing` is refused (409) by default — nothing
    durable proves a real broadcast doesn't already exist for those rows, so silently re-issuing
    risked signing the SAME transfer twice. Pass `force=1` to explicitly abandon it and get a fresh
    nonce anyway (only when you know nothing was actually signed against the old one) — the new
    generation carries the prior one's `observedSigs` forward, so a signature already observed
    under the old nonce is never forgotten.
  - A `submitted` sign-request (something WAS observed, but rows still remain) refuses a fresh
    request outright — there is no blockhash tracked here to "lapse"; observe more signatures, or
    use the reset below.
  - **`POST …/batch/:batchId/sign-request?clear=1` — owner-only reset.** N1 (round-2 verification):
    a bare clear used to silently re-open the exact double-pay window `&cancel=` is guarded against
    — a wallet this sign-request handed out that the operator may already have broadcast for, but
    never observed, is neither legacy-`sent` nor journaled, so clearing it and letting `&cancel=`
    (now unblocked) return it to `available` would let a fresh export draw the SAME amount again.
    `clear=1` now computes that **at-risk** set (`atRisk`) and refuses (409, echoing `atRisk`,
    `observedSigs`, `failed`, `nonce`) unless `&confirm=abandon-broadcast` is also passed,
    acknowledging that risk explicitly. Sets `batch.browserSign = {state:"cleared", clearedAt,
    nonce, observedSigs, wallets, failed}` — P2-6: **kept, never nulled** — the amounts, the legacy
    sent/paid rows and the journal are all untouched either way; only the in-flight sign-request
    bookkeeping is retired, and the 200 body echoes the same `atRisk`/`observedSigs`/`failed`/
    `nonce` so the owner sees exactly what they are overriding. This is the escape hatch for a batch
    stuck in `submitted` (e.g. every named row settled through the attribution-failure path, so
    `stillOwed` can never reach false) or for an operator who broadcast from the wrong wallet (see
    F1 below) and needs the flow reset before trying again correctly. An operator token gets 403;
    the owner key or `x-clkn-operator`-less owner session succeeds.
- `observe` **requires the `nonce` sign-request handed out** (`nonce` in the request body/query) and
  answers 409 on a mismatch — this is what actually ties a call back to the exact set of
  rows/amounts a specific sign-request named, so a stale or superseded one (a `force=1` re-request,
  or an owner `clear=1`) can never be conflated with a fresh one. **N7:** the freeze also expires —
  an observe against a sign-request more than 24h old (`browserSign.requestedAt`) is refused 409
  ("request a fresh sign-request…") even with the right nonce, so a months-old frozen
  `fundingWallet`/`payoutSources` snapshot can never outlive an owner rotation indefinitely. It
  reads back the signature(s) the browser broadcast (`public/hub-desk.html` reuses
  `CluckAirdrop.send()` unchanged — the same `provider.signAndSendTransaction` path the pre-existing
  self-signed `&sent=` report already drives, not the stricter `signTransaction`-only /
  server-broadcasts invariant `lib/hub/attempts.js` implements — the desk reports BOTH a "sent" and
  an "unconfirmed" (30s confirm timeout) result to `observe`, never dropping the ambiguous case) and
  settles them through the **exact same** `lib/hub/settle.js settleAndPersist()` +
  `lib/cuna-payout.js recordSent()` pipeline `/payout`'s `&sent=` branch uses — same settlement
  journal, same `settle:<sig>:<instructionIndex>[:<innerIndex>]` idempotency key, same
  funding-wallet-sourced check (adv P0-1), same cross-project consumed-set check (adv P0-2a). A
  signature that verifies nothing, or the wrong amount, settles that row NOT AT ALL — recorded in
  `batch.browserSign.failed[wallet]` with why (only from a real refusal of that wallet's own best
  candidate — never the cross-product noise of every OTHER signature it wasn't paired with), never
  as paid; a wallet actually recorded this pass is cleared from `failed` regardless of which path
  recorded it. **N2** (round-2 verification): a wallet whose row has nothing remaining AFTER this
  pass is never written into `failed` (an ordinary idempotent re-observe of its own settling
  signature refuses as `amount_mismatch`/`duplicate_settlement_candidate`, which is correct and not
  a thing to report), and a `TRANSFER_ALREADY_CONSUMED_WHY` refusal whose consuming journal entry
  names THIS SAME project+batch is our own prior settlement, never a cross-project reuse — it is
  suppressed from both `failed` and the fraud alert. Observing the same signature twice really is
  exactly as idempotent as reporting it to `&sent=` twice, and raises no alert either. A signature
  the RPC has not indexed yet (`getTransaction` resolving `null` — the ordinary state one second
  after broadcast, not a fault) is treated like an RPC outage — but **N3** (round-2 verification):
  only when **NONE** of the submitted signatures resolved (503, `retry:true`, nothing written, the
  state never advances). If SOME resolved, the rest come back in the SAME 200 response as
  `pending: [...] , retry: true` and are simply excluded from this pass — the resolved ones still
  settle, and the state never advances to `settled` while any submitted signature remains
  unresolved (it stays `submitted`). `public/hub-desk.html`'s `signAndSend()`/`observeBroadcast()`
  retry the outstanding `pending` signatures automatically, with a short backoff, up to 3 attempts
  total, before surfacing anything. The wallets×signatures cross product is bounded (at most
  `wallets.length + 5` signatures, and their product capped at 500 — the same bound `&sent=`'s
  `results` list uses) and every signature is fetched through a small concurrency pool BEFORE the
  per-project payout lock is acquired, so a slow or flaky RPC no longer holds every other payout
  route for the project hostage across up to 40 sequential round trips.
- **What is blocked while a browser-signed flow is live (`signing`/`submitted`):** the managed
  payer (`/payout`'s `&send=`, via `browserSignIsLive(bt)`), `&cancel=` — a bare cancel + re-export
  while an already-broadcast-but-unobserved transfer exists would draw the SAME amount into a fresh
  batch while the original transfer is still real and about to be observed into the batch just
  cancelled — and, since the round-2 pass (**P2-7**), `&confirm=` too, for the same reason (marking a
  batch paid without per-row signatures while a real broadcast might already be in flight would
  settle rows a later `observe()` can never journal, and permanently pin `browserSign` live). SEND
  and SIGN AND SEND on the desk are ALSO mutually exclusive with each other while either is live.
  `observe` independently refuses any batch whose `state !== "pending"` too (defense in depth, even
  if a cancel is ever reached some other way). **What still works while live, and can even complete
  the flow:** `&sent=` (the desk's per-row "record on server" recovery button) and `&waive=`. **N5**
  (round-2 verification): the README used to claim neither touches `browserSign`/`bt.state` — false;
  `&sent=` recording the LAST unpaid row flips `bt.state` straight to `sent` the same way it always
  did, and if that happens while `browserSign` is still live, it is now stamped `state:"settled"` in
  the SAME persist, rather than left pinned `signing`/`submitted` forever with no lever but the
  owner's `clear=1`.
- **The connected wallet must be one of the project's accepted payout sources.** **P2-4** (round-2
  verification): this used to mean `fundingWallet` only — a project configured to pay from an
  owner-allowlisted `payoutSources` wallet (`/api/hub-registry`'s admin-only lever) had BOTH payout
  buttons permanently disabled with no route through but the less-guarded per-row `&sent=` buttons.
  Both the desk's SEND and SIGN AND SEND buttons are now disabled unless the connected wallet is
  `fundingWallet` OR one of `payoutSources` (`publicProject`/the sign-request response both carry
  the list; the reason line names every accepted wallet), and `signAndSend()`/`send()` refuse again
  at the top of the function before doing anything — belt-and-braces against a stale button state.
  **P2-5**: the server enforces the SAME restriction independently of the browser check — `who`
  (owner / the funding wallet / a `payoutSources` wallet) is required before `sign-request` will
  even generate transfer parameters for anyone else, naming the funding wallet in the 403. Without
  either, an operator signing (or curling) from an unaccepted wallet would broadcast a REAL transfer
  that `observe`/`&sent=` can never credit (`transfer_not_from_funding_wallet`), paying the wrong
  pocket and deadlocking the batch (the reset above is the only way out).
- **The sign-request response is validated before anything is built to sign, and the confirm
  dialog comes AFTER sign-request.** `signAndSend()` checks the returned `mint`/`decimals` against
  what the page already knows (`MINT`/`DEC`), that every offered wallet is one of `BATCH`'s own
  rows, and that no offered amount exceeds that row's own raw amount — refusing before
  `CluckAirdrop.send` is ever called. The confirm dialog then quotes the row count and summed
  amount `sign-request` actually returned, never numbers from the page's last load (which could
  disagree with what the wallet is about to sign if the batch changed in between).
- Every broadcast result (`CluckAirdrop.send`'s `onResult`) is persisted into the SAME
  `ROW_STATUS`/`localStorage` mechanism the pre-existing SEND button uses, and `signAndSend()`/
  `send()` refuse to run again while `unrecordedSent()` is non-empty (same wording as SEND) — a lost
  tab or a thrown `observe()` call used to lose the broadcast signature from the page entirely, with
  nothing to recover it from. **N4** (round-2 verification): `unrecordedSent()` now also matches an
  `unconfirmed` (30s confirm timeout — ambiguous, may still land) result, not just `sent` — it used
  to block neither a re-sign nor a re-send, and `send()`'s own pre-flight purge now keeps an
  `unconfirmed` entry too, for the same reason.
- **The status line for a live flow offers a real recovery, not a dead end.** **P3-10** (round-2
  verification): "reload to check its progress" told the operator to do something that cannot
  help — reloading just re-reads the same server state. The live-flow status line now offers an
  OBSERVE WHAT I BROADCAST button (shown whenever ROW_STATUS holds a broadcast signature for this
  batch) that re-posts exactly those signatures under `BATCH.browserSign.nonce` (the batch view
  already carries it) through the SAME `observeAll()`/retry path `signAndSend()` uses — never a
  fresh `sign-request`, which would abandon the in-flight nonce (F3). **P3-9**: the settled line
  also now reads "every row THIS PAYOUT named", not "this batch" — a row this sign-request skipped
  as already legacy-sent is excluded from `browserSign.wallets`, so "settled" only ever meant every
  row this specific sign-request named.
- **Vice versa with the managed payer**: `browserSignIsLive(bt)` (`signing`/`submitted`) refuses
  `/payout`'s `&send=` branch outright, and both `sign-request`/`observe` acquire the SAME
  per-project `hublock:<id>:payout` lock `/payout` already does, so a managed send mid-flight
  refuses a concurrent `sign-request` with `busy` even before the state check would matter.
- Fault-injection: `scripts/hub-browser-sign-test.cjs` (crash between the two calls, a bad
  signature, observing the same signature twice — including a two-wallet batch where the state
  never reaches the top-level `already:true` shortcut, forcing the real pipeline to catch the
  repeat itself — an RPC outage, a not-yet-indexed signature (all-unindexed AND partial), a dry-run
  project, no auth including cross-project, GET, a cancelled batch, the owner reset (refused/
  confirmed/journaled-is-never-at-risk/observedSigs-carried-forward), a partial managed-send row
  never re-offered, the reverse `busy` case, the wallets×signatures bound, an idempotent re-observe
  raising no alert, a `&sent=` landing mid-flow, a sign-request older than 24h, a zero-remaining row
  named in `skipped`, an operator whose own wallet cannot request instructions, `&confirm=` refused
  while live, and `&sent=` completing a batch settling a live `browserSign`) plus
  `scripts/hub-desk-sign-page-test.cjs` (the REAL `public/hub-desk.html` inline script in a Node
  vm, `CluckAirdrop.send` stubbed — the wrong-wallet refusal (now against every accepted wallet), the
  disabled-while-live button, a signature surviving a thrown `observe()`, a tampered sign-request
  response, an `unconfirmed` row blocking a re-sign/re-send and surviving the send() purge, the
  automatic retry on a `pending`/`retry:true` observe response, the reworded settled line, and the
  OBSERVE WHAT I BROADCAST recovery button, none of which the server-only suite can see).

## 4. What is served over HTTP today

Public, no wallet needed, `Cache-Control: public`:

| Route | Returns | Schema |
|---|---|---|
| `GET /api/hub` | `{ ok, projects: [{id,label,symbol,mint,programs,receipts}] }` | — (a thin index; not schema'd separately) |
| `GET /api/hub/:project` | `{ ok, project }` — `lib/hub/public.js projectView()` | `project-public.schema.json` |
| `GET /api/hub/:project/wallet/:wallet` | every role a wallet had in the project (winner/paid/disqualified/…) | — |
| `GET /api/hub/:project/r/:sig` | a payout row found by signature — the Addendum-B3 shape once a journal event exists for it, else the legacy shape | see **the receipt gap**, below |
| `GET /api/hub/:project/holder?address=` | one wallet's lock-to-earn view: `programVersion`, `programHash`, locks, accrued/paid/owed | — |
| `GET /api/hub-pricing` | live platform-access pricing | — |
| Telegram `/receipt <sig>` (BB4) | same lookup as `GET /api/hub/:project/r/:sig`, tried across every registered project, replying with the reproduce() verdict — `lib/hub/receipt-command.js` | — |
| `GET /hub/schema/:name.json` | one of the four schemas below, verbatim | itself |

Gated (owner admin key, or an operator's signed-nonce desk session), still real JSON with a real
shape a second product would need if it operates as an approved project:

| Route | Carries | Schema |
|---|---|---|
| `GET/POST /api/hub/:project/admin` | `versions: [...]` (program versions in force) | `program-version.schema.json` per entry |
| `GET /api/hub/:project/desk` | the operator's full view, including `versions` | `program-version.schema.json` per entry |
| `POST /api/hub-apply?preview=1` (public — no auth) | a draft `version` an applicant would sign up to | `program-version.schema.json` |
| `GET /api/hub/:project/reconcile` | read-only: rebuilds the consumed set from the journal and reports every (batch, wallet) row where the legacy `sent` flag and a journal event disagree — never writes | — (crash P2-2, docs/HUB_JOURNAL_VERIFY_2026-09-18.md) |

Where a program-version or project body is emitted above, the wire body (or the version entry
itself) carries a `$schema` field pointing at the served URL
(`https://clucknorris.app/hub/schema/<name>.json`) so a consumer can validate without asking us
what shape to expect. **`batch.schema.json` is NOT stamped anywhere yet** — see the next section
for why: the one live route that returns something called a "batch" (`POST
/api/hub/:project/payout?export=1`) returns a *different, smaller* shape than the one this schema
documents, and stamping `$schema` on a body that would fail its own schema is worse than leaving
it unstamped.

## 5. The receipt gap — CLOSED for a row settled since W3, still open for one that predates it

**Updated (W3, `docs/COLOSSEUM_ROADMAP.md` §W3):** `receipt.schema.json` documents
`lib/hub/ledger.js receipt()` — the Addendum B3 shape, with `settlements[]` and the
`totals`/`claims` split. It is implemented and unit-tested (`scripts/hub-core-test.cjs` §7) and is
now REACHABLE from `GET /api/hub/:project/r/:sig`: the route serves it, `$schema`-stamped, for any
row the settlement journal already has an event for. A row with no journal event — either a legacy
payout sent before this change, or one W3's dual-write could not attribute to a specific chain
instruction (see below) — still gets `lib/hub/public.js findReceipt()`'s pre-Addendum-B shape, a
single payout row from a buy competition, a Buy Special draw, the CUNA giveaway, or the legacy
lock-to-earn payout table:

```json
{ "projectId": "...", "symbol": "...", "program": { "kind": "...", "id": "...", "label": "...", "ticker": "...", "mint": "...", "prizeMint": "...", "termsHash": "..." },
  "receipt": { "wallet": "...", "amountUi": 0, "sig": "...", "at": 0, "state": "settled", "confirmedAt": 0 } }
```

This legacy body is still not schema'd — do not validate it against `receipt.schema.json`, the
shapes are unrelated, and it never carries `$schema` (it would not validate against
`receipt.schema.json`, per `scripts/hub-schema-test.cjs`'s own fixture proving exactly that).
**Fixed 2026-09-18 (adv P1-4, docs/HUB_JOURNAL_VERIFY_2026-09-18.md):** the journal-backed body
above is wrapped in the SAME envelope as the legacy one — `projectId`/`symbol`/`dryRun`/`brand`/
`program` as siblings of `receipt` — instead of being served bare; the bare shape had no
`program`/`symbol` for `public/hub.html`'s `renderReceipt()` to read, which threw and rendered an
error card for every journal-backed receipt (`scripts/hub-receipt-page-test.cjs` runs the real page
script against both shapes). Only `receipt` itself is what validates `receipt.schema.json` — the
wrapper siblings are not part of that schema, same as the legacy shape. The
design's own `/receipt/<batchId>/<wallet>` route (§5) — a separate, dedicated URL rather than
`GET /api/hub/:project/r/:sig` sniffing which shape to serve — has still not shipped; when it does,
it should route through `lib/hub/ledger.js receipt()` and reuse `receipt.schema.json` as-is (do not
invent a third shape). For reproducing the amount, see **reproduce-receipt**
(`lib/hub/reproduce.js` + `/api/hub/:project/reproducibility`), which since W3 also carries the real
program-version `hash` for a row with a journal event.

**Why a settled row can still lack a journal event.** The Addendum-B1 identity is
`settle:<sig>:<instructionIndex>[:<innerIndex>]` — the CHAIN's own identity of the transfer, never a
fabricated one. `lib/payout-verify.js locateTransferInstruction` locates it by matching the parsed
SPL-Token transfer/transferChecked instruction (top-level or inner/CPI) whose destination token
account is owned by the recipient wallet; when that match is not exactly one (the transaction could
not be read, or — a batched airdropper transaction — two transfers land on the same wallet in one
signature and neither can be told apart from chain data alone) the row is recorded in the legacy
`batches[].sent[wallet]`/`paid` ledger exactly as before, **because the transfer genuinely did
land**, but the journal entry is skipped rather than guessed; `lib/hub/routes.js` reports this per
row (`journaled:false`, with `why`) in the payout route's own response, and it never affects
`owedNow` (the legacy row already excludes it from being offered again). A row already sent BEFORE
W3 shipped has no journal event and never will on its own —
`scripts/hub-journal-backfill-preview.cjs --project <id>` prints what a backfill WOULD derive from
existing `batches[].sent` rows (signature, wallet, amount, at) but writes nothing; applying one
(which still needs a chain read per signature, exactly like a live payout) is a separate, owner-run
step this repository does not build yet.

Similarly, `batch.schema.json` documents `lib/hub/ledger.js buildBatch()`, the Addendum-B batch —
but the currently-wired `GET/POST /api/hub/:project/payout` route still BUILDS a batch with the
*older* `lib/cuna-payout.js` batch/paid model: `{ id, state, at, amounts, skippedBelowFloor,
totalRaw, count }`, with `sent: {wallet: {sig, at, pending}}` recorded separately in `paid` (now
joined, since W3, by an OPTIONAL `attempts: {wallet: {...}}` field — see `lib/hub/attempts.js`
`stampSubmitted`/`stampSettled` — which `batch.schema.json` already documents as optional). That
core shape is still missing every field this schema REQUIRES beyond `id`/`state`/`amounts`/
`skippedBelowFloor`/`totalRaw`/`count` — no `projectId`, `programVersion`, `programHash`,
`rewardMint`, `rewardDecimals`, `periods`, `reservedFundingRaw` or `waived` — so it would still fail
validation against `batch.schema.json` outright; `$schema` is still not stamped there. `lib/hub/
ledger.js buildBatch()` itself is complete, pure, and covered by CI (`hub-core-test.cjs`) but has
**zero HTTP callers today** — the payout route settles individual ROWS through it
(`lib/hub/ledger.js settle()`, via `lib/hub/settle.js`) without switching the whole batch-building
step onto it; that remains design work ahead, not something this change does silently.

## 5b. The payment-source allowlist — who a settlement may come from

**Round 2 #3/#4 (`docs/HUB_JOURNAL_VERIFY_2026-09-18.md`).** A journal entry only ever names a
transfer that was SOURCED (`meta.preTokenBalances`' source-account owner, never the instruction's
`authority`, which can be a delegate) from a wallet on the allowed list for that branch of the
payout route. There are two, deliberately different, lists:

- **`&sent=` (holder/operator-supplied signatures)** — the narrowest list: the project's
  `fundingWallet`, plus `payoutSources` (below). This is the one branch adv P0-1 targets — a
  wallet or operator hands the route a signature they found on chain, so the route must not trust
  anything about where the money came from beyond what the project itself controls.
- **`&send=` / `&sweep=` (our own broadcasts)** — the `&sent=` list, PLUS the wallet(s) that
  actually signed the broadcast: `whirlpoolMM.vault.operatorPubkey(<vault project id>)` for
  `&send=` (which names the vault project explicitly via `from=`) and
  `whirlpoolMM.vault.operatorPubkeys()` (every vault project's operator wallet) for `&sweep=`
  (which reconciles whatever a project's batches already record as pending, with no `from=` to say
  which one signed a given row). Our own signature is already trusted the moment we broadcast it —
  refusing to journal our own payout (Round 2 #4's finding) does not protect anyone, it only kills
  the receipt for a legitimately managed-payer project.

**`payoutSources`** is a small (≤5 wallets), PROJECT-RECORD field — distinct from `fundedBy`, a
program-version TERM with its own documented meaning ("wallets whose own vesting unlock feeds the
daily pool", `schema/program-version.schema.json`). `fundedBy` used to double as the payment-source
allowlist too (the original P0-1 fix) — but a desk operator can publish a new program version
through `/api/hub/:project/admin?terms=` any time the project's platform access is current, which
let an operator widen who may pay a holder by the SAME lever that changes the pool's daily
arithmetic (Round 2 #3, narrowed rather than closed by that first fix). `payoutSources` is settable
ONLY through the owner-gated `/api/hub-registry?id=&payoutSources=` admin path (the whole route
requires `adminAuthOK` — never a desk operator's terms), via `lib/hub/project.js
withPayoutSources()`, which is append-only-audited: a project record carries `payoutSources` (the
current list) and `payoutSourcesHistory` (`[{payoutSources, at}]`, grown only on an actual change)
and every change alerts the operator room. Omitting `&payoutSources=` on an otherwise-ordinary
project edit carries the existing value forward unchanged.

## 5c. When a non-exact transfer goes out (N-4, Round 4, `docs/HUB_JOURNAL_VERIFY_2026-09-18.md`)

`lib/hub/ledger.js settle()` is called with `exactOnly` on every live path (Round 3 #1) — a transfer
that is not EXACTLY the row's remaining amount is refused outright, never capped into applied/
excess. That is correct for fraud (a stranger's unrelated transfer must never claim a row), but it
is also what happens to a genuine mistake: an operator fat-fingers the amount, or the reward mint
turns out to charge a transfer fee so less arrives than was sent. The blast radius:

- **The row is refused everywhere** — not journaled, not recorded in the legacy `sent`/`paid` state
  either (`&sent=`'s PASS 2/3 only record what PASS 1 actually settled). The holder received real
  tokens on chain, but nothing in the Hub says so.
- **The batch can never reach `sent`.** `owedNow` still holds the row's full amount reserved inside
  the pending batch (it is not "sent", so it is not double-counted, but it is not released either) —
  the wallet reads owed 0 for that amount indefinitely, not because it was paid, but because it is
  stuck.
- **The signal is the summary alert** — `alert(..., { projectId, batchId, kind: "sent" })` at the
  end of the `&sent=` branch, ONE per request (N-1's dedupe key, `lib/hub/alert-key.js`, keeps a
  refusal on one batch from being silently swallowed by an unrelated batch's alert on the same
  project). No alert reaching the operator room within 6 hours of a real mismatch means something
  else is wrong with delivery, not that nothing happened — check `report.sent.ignored` in the
  route's own response, which lists every refusal individually regardless of the alert.
- **Two ways out:**
  1. **A second, exactly-correct transfer.** The holder keeps whatever the first (mismatched)
     transfer sent them — that money is real and already theirs — and the row settles normally once
     an exact-remainder (or, for a fresh row, exact-full-amount) transfer lands. This is the
     everyday remedy for an operator's own mistake, no owner action needed.
  2. **`&cancel=`**, which returns the batch's unsettled rows to available and re-offers them on the
     next `&export=`. Use this when the batch should never have existed as drawn (wrong recipients,
     wrong terms) — not as a way to "fix" one row, since it re-offers the WHOLE batch, including any
     rows that already settled correctly (those stay settled; cancelling only affects what is still
     unsettled).
- **The N-3 case — a PARTIAL row:** if a row already has a real, exact settlement for PART of its
  amount (only reachable today via a pre-`exactOnly` or backfilled journal entry — see §6), the
  route now verifies a further transfer against the row's REMAINING amount, not its original full
  amount, so an exact-remainder transfer settles it like any other exact match. If the project
  genuinely will never pay the rest (a dispute, a wallet the holder can no longer sign for), the
  owner can write it off with `POST /api/hub/:project/payout?batch=<id>&waive=<wallet>&reason=<why>`
  (owner-only; an operator gets 403) — `lib/hub/ledger.js waiveRemainder()`, journaled under its own
  `hub:waive:<projectId>:<batchId>:<wallet>` kv entry (never the settlement journal's own
  `hub:settle:` prefix, so a waiver can never be mistaken for a paid transfer) with the owner's own
  reason string. The amount is still owed in the sense that it was never collected — a waive frees
  it back to the wallet's `owedNow` and its ledger `available` in the SAME persist as the waive
  itself (NEW-2, Round 5 — `pay.owedNow` now subtracts a row's own `batch.waived` amount from what
  the batch still holds, the same way `ledger.partition` already did), so the next batch draws it
  without needing `&cancel=` first; the row's own state reads `partial-waived` (or `waived` if
  nothing was ever applied) rather than `paid`, and the batch stays `pending` rather than `sent`
  until every row on it is genuinely paid. It does not manufacture a receipt for money that never
  moved.

## 6. What is NOT independently verified yet

A program-version `hash` served by the same server that computes the payout lets a reader rerun
the arithmetic over *server-supplied* observations — it does not prove the server omitted no
qualifying escrow. Until both of Addendum B5's steps exist for a version — (1) the funding wallet
signs an on-chain memo committing `program:<projectId>:v<n>:<sha256>` at publish, and (2) the
canonical JSON of the published version is mirrored under `programs/` in this repository — the
honest public wording is **"the calculation is reproducible from the published inputs,"** never
**"independently verified."** Neither step has shipped as of this writing; both are planned as a
dry run before being treated as load-bearing. `lib/hub/teach.js` already carries this exact wording
in its `notices.reproducible` string — copy it verbatim rather than writing a new claim.

Known operational limits, tracked but not yet closed:

- **`POST /api/hub-apply` is the one unauthenticated source of operator-room alerts** (N-5, Round 4,
  `docs/HUB_JOURNAL_VERIFY_2026-09-18.md`). No signature is required — `applicantWallet` is
  optional — and every accepted application raises one alert. It is rate-limited (12/min/IP) and
  capped at `MAX_PENDING` (200) pending applications, so the cost to a griefer is bounded (roughly
  200 throwaway SPL mints for ~200 messages in ~17 minutes) but not zero, and a full queue also
  refuses legitimate applications until the owner clears some. Pre-existing, outside the settlement
  journal's own diff; not fixed here.

## 7. How a second product consumes a receipt (or any of these entities)

1. **Fetch** the JSON body from the route in §4 (or read it directly out of `lib/hub/ledger.js` /
   `lib/hub/public.js` if you're inside this codebase — same shapes either way).
2. **Validate** it against the matching schema at `https://clucknorris.app/hub/schema/<name>.json`
   (or the copy in `lib/hub/schema/`) with any standard JSON Schema (draft 2020-12) validator.
   `scripts/hub-schema-test.cjs` is a worked example — a ~100-line dependency-free validator
   covering the subset of Schema this repo actually uses (`type`, `required`, `properties`,
   `additionalProperties`, `enum`, `items`, `pattern`), plus fixtures for every shape below.
3. **Re-derive**, not just trust:
   - a program version's `hash` — recompute it from `terms` (see `lib/hub/project.js`
     `canonicalJson`/`sha256`/`verifyVersionHash`: sort every object's keys, stringify BigInts,
     and — for a version that has since been superseded — force `effectiveTo` back to `null`
     before hashing, since it is bookkeeping added after the fact and was never part of what was
     signed);
   - a receipt's `totals.appliedRaw` — sum `settlements[].appliedRaw` yourself; it must match;
   - a receipt's `totals.owedRaw` — once `reproduce-receipt` ships, rerun it over the published
     inputs rather than trusting the field.

No field on any of these schemas is a promise of yield, safety, or independent verification. Say
what is on-chain, never why — the schemas describe *what the ledger recorded*, not *why a project's
terms are trustworthy*.
