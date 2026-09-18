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
  Overpayment is shown as `totals.excessRaw`, never floored away and never credited toward another
  row or wallet. `receipt.schema.json`.

## 2. The invariants (Addendum B — do not relax these without a design PR first)

1. **One idempotent settlement event per transfer.** A retry with the same `sig:instructionIndex`
   either returns the same result (this row already owns it) or is refused with
   `transfer_already_consumed`, naming the project/batch/wallet that does. There is no path that
   applies a transfer twice, and no path that "unconsumes" one.
2. **Overpayment is kept as `excess`, never netted across wallets.** `paidApplied =
   min(paidTotal, accrued)`; `excess = paidTotal − paidApplied`. Wallet A's excess can never hide
   wallet B's unpaid amount — obligations are `Σ(accrued − paidApplied)`, a per-wallet sum.
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
| `GET /hub/schema/:name.json` | one of the four schemas below, verbatim | itself |

Gated (owner admin key, or an operator's signed-nonce desk session), still real JSON with a real
shape a second product would need if it operates as an approved project:

| Route | Carries | Schema |
|---|---|---|
| `GET/POST /api/hub/:project/admin` | `versions: [...]` (program versions in force) | `program-version.schema.json` per entry |
| `GET /api/hub/:project/desk` | the operator's full view, including `versions` | `program-version.schema.json` per entry |
| `POST /api/hub-apply?preview=1` (public — no auth) | a draft `version` an applicant would sign up to | `program-version.schema.json` |

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
`receipt.schema.json`, per `scripts/hub-schema-test.cjs`'s own fixture proving exactly that). The
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
