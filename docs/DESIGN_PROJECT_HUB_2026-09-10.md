# Design: the Project Hub, program record and verifiable receipts

Status: **design only, no code** (owner rule 2026-09-10: publish nothing until the window opens;
build from 2026-09-14). Written for a second-reviewer pass (Codex) before implementation.
Revision 3 (2026-09-11, Codex re-review): transfer identity is chain-global with project as
metadata; a pre-broadcast `signing` state with server-side reconcile closes the
broadcast-before-recording gap; acceptance test 5 states the partition and the overpayment cases.
Revision 4 (2026-09-11, Codex round 3): every attempt is identified by its own signature,
registered before WE broadcast (sign-only wallets, no heuristic matching, incomplete history
never releases a reservation); a partial payment keeps the remainder reserved on the row. Every
acceptance test at the end is meant to become a CI script the way `scripts/cuna-payout-test.cjs`
and `scripts/tool-pass-gate-test.cjs` already are.

## 0. What this is, in one paragraph

One page per approved project where a holder can answer four questions without trusting us:
**why am I eligible, how was my reward calculated, is it funded, was I actually paid?** — and
where the project operator runs the whole loop (lock → publish terms → holders participate →
owner-signed distribution → receipts) with the tools that already exist. It generalises the CUNA
lock-to-earn programme (live since 2026-09-05, first payout 2026-09-09) to any owner-whitelisted
mint, and it makes the programme's promises checkable by publishing a versioned program record
and per-recipient receipts that link back to on-chain transactions.

Learn → Build → **Prove** → Earn: the school is the front door; the hub is where a project
builds; the program record and receipts are the proof; lock-to-earn is the earning. Holder
rewards (participation under published terms) stay distinct from any future earning through
accepted work; neither promises token appreciation.

## 1. What already exists (reused, not rewritten)

| Piece | Where | Reuse |
|---|---|---|
| Qualification, weight, daily split | `lib/cuna-staking.js` — pure, takes `cfg.mint`, `fundedBy`, `excludeWallets` | as-is; already mint-agnostic |
| Programme state, arming, terms validation, slices | `lib/cuna-programme.js` — pure; `readProgramme`, `validateConfig`, `accrualGate` | as-is behind a per-project store |
| Escrow discovery + `firstSeenAt` ledger | `lib/cuna-lock-scan.js` — `scanEscrowsByMint`, `mergeLedger` (where the attacks live) | as-is, keyed per mint |
| Owed / pending / paid bookkeeping | `lib/cuna-payout.js` — `owedNow`, `buildBatch`, `recordSent`, `cancelBatch`; row-level confirmation with signatures | as-is |
| Payout signing | `/cuna-payout` page + `CluckAirdrop.send`: the OWNER's wallet signs; server verifies each signature on-chain before marking paid | generalised: the PROJECT's funding wallet signs |
| Locks by mint, memo-tagged | `/api/locks?mint=`, `/api/lock/recent`, `/lock/:mint`, Lock of Fame | as-is |
| Holder list, buy comps, airdrops, burn receipts, listing checkup | existing tools and their routes | linked from the hub |
| Wallet proof of ownership | `POST /api/tool-gate/session` pattern (signed nonce, HMAC token) and `/api/premium-verify-sig` | the operator login |

What is CUNA-specific today and becomes per-project: seven kv keys (`cunaStake`,
`cunaStakeLedger`, `cunaStakeDays`, `cunaStakePaid`, `cunaStakeBatches`, `cunaBurn`,
`cunaBurnDays`), the `cunaProgramme()` singleton, ~15 routes under `/api/cuna-stake/*` with no
`project=` parameter, and two CUNA-branded pages. The burner stays CUNA-only and out of scope.

## 2. Entities

All identifiers are explicit; nothing is inferred from "the current project".

- **Project** `{ id, label, symbol, mint, decimals, tokenProgram, fundingWallet, operatorWallets[],
  approvedAt, approvedBy:"owner", status: draft|approved|suspended }`. Whitelisted by the owner
  only (config write behind the admin key). `fundingWallet` is the wallet that signs payouts.
  `operatorWallets` may read the operator console after a signed-nonce login. Controlling a mint
  authority is NOT identity — many legitimate tokens have revoked it.
- **Program version** `{ projectId, version, effectiveFrom, effectiveTo|null, rewardMint,
  poolDailyRaw, sliceRule, minTermDays, maxTermDays, tiers, exclusions: { creators[],
  recipients[], rule:"B" }, cancelableAllowed:false, payoutSchedule, fundingResponsibility:
  fundingWallet, signer: fundingWallet, hash }`. Immutable once effective; a change creates
  version+1 with a new `effectiveFrom`. `hash` = sha256 of the canonical JSON, shown on the page.
- **Period** — one accrual day `YYYY-MM-DD` under one program version (the existing
  `cunaStakeDays` shape: `{ distributed, credits }`), stored per project. **Version boundaries
  are UTC-day boundaries:** a new version's `effectiveFrom` is always a `YYYY-MM-DD` and takes
  effect at 00:00 UTC of that day; a period never straddles two versions. Slices already
  accrued that day under v1 are final.
- **Reward asset — first release: one immutable reward asset per project**, fixed at approval,
  equal to or different from the project mint, with `rewardMint`, `rewardTokenProgram` and
  `rewardDecimals` pinned on the Project and echoed on every program version, batch and receipt.
  Changing the reward asset is a new project id. Raw units are never summed across assets.
- **Eligibility record** — per escrow: `{ escrow, owner, amountRaw, termDays, firstSeenAt,
  fingerprint, qualifies:boolean, reasons[] }`. The `reasons[]` are the codes `disqualify()`
  already produces, made public: `below_min_lock`, `term_too_short`, `cancelable`,
  `excluded_creator`, `excluded_recipient`, `seen_before_program`, `unvested_only`, …
- **Balance states.** `accrued` is the TOTAL earned; the other three partition it:
  **`accrued = available + reserved + paid`** (estimates excluded, never stored). Example: 100
  accrued, 30 reserved, 20 paid → 50 available, not 150 of anything.
  - `estimated` — what today's slice would credit if nothing changes (page preview only, never stored)
  - `accrued` — credits written by the accrual tick (`credits` in the period), the total earned
  - `reserved` — sitting in a pending batch (`pending` in `owedNow`)
  - `paid` — confirmed rows with a transfer verified on-chain
  - `available` — `accrued − reserved − paid`, the only number a new batch may draw on
  - **Overpayment is surfaced, not floored away:** if `paid > accrued` (a manual send outside the
    system) the wallet shows `overpaidRaw` on the operator console and the public page, and the
    next batch draws nothing until accrual catches up. `owedNow`'s zero floor stays for safety;
    the delta is reported beside it.
- **Batch** — the existing `cunaStakeBatches` record plus `projectId`, `programVersion`, the
  periods it covers, and `reservedFundingRaw`. `state: pending|sent|closed|cancelled`.
- **Receipt** — one per recipient per batch: `{ projectId, programVersion, rewardMint,
  rewardDecimals, periods[], wallet, amountRaw, transferId, sig, slot, at,
  verifiedBy:"getTransaction" }`. Public at `/receipt/<batchId>/<wallet>`; the amount is the RAW
  units in the transfer that `recordSent` verified, never a recomputation. Two distinct claims are
  shown separately: **payment verified** (the transfer exists on-chain and matches) and
  **calculation reproducible** (the export below reruns to the same raw amount).
- **Reproduction export** (per receipt, JSON): the dated observations the accrual actually used —
  every eligible escrow that period with `amountRaw`, `termDays`, `firstSeenAt`, `fingerprint`,
  the exclusion list applied, `poolDailyRaw` and the slice count and timestamps, the competing
  eligible weights (or the per-escrow weight table), the rounding rule (integer floor per slice,
  remainder policy), and the algorithm/config version (`lib/cuna-staking.js` git SHA + program
  hash). A developer runs `node scripts/reproduce-receipt.cjs <export.json>` and gets the raw
  amount. Periods whose observations were not retained are labelled `inputs: missing` and the
  receipt shows "payment verified; calculation not reproducible for N of M periods".
- **Funding status** — `{ obligationsRaw (accrued − paid), reservedRaw (pending batches),
  observedBalanceRaw (funding wallet, on-chain, dated), shortfallRaw }`. An observed balance is
  NOT reserved funding; a scheduled unlock is NOT funding. The page says which of the three it is
  showing.

## 3. Storage and isolation

One kv namespace per project: `program:<projectId>:{state|ledger|days|paid|batches}`. The CUNA
keys are migrated by aliasing, not copying (`cunaStake` → `program:cuna:state`, …), with a
one-time migration script and a CI test that reads both shapes. **Every read and write takes
`projectId` explicitly**; there is no default project in this module (the vault's "default to
clkn" convention caused a live incident — see CLAUDE.md, the paused-flag story).

Isolation tests (acceptance): two projects with the same escrow set never share a ledger; a batch
id from project A is refused by project B's record/cancel routes; a receipt URL for A cannot be
served under B; identical wallets in both projects accrue independently; a mint registered twice
is refused.

## 4. Money rules carried over unchanged

- Raw integers everywhere (`BigInt` in the libs; strings on the wire). Decimals come from the
  mint on-chain at approval and are stored on the Project; a mismatch at payout time refuses the
  batch. Token-2022 mints with transfer-fee or transfer-hook extensions are refused at approval
  until supported (say so in the UI; do not silently treat every mint like CUNA).
- Rule B (exclude by recipient AND creator) generalised: the project's own treasury and known
  team wallets go in `exclusions`; the page shows the excluded list so a holder can see why the
  founder's locks are not in the pool.
- Terms measured forward from OUR `firstSeenAt`, never from `vesting_start_time`; no cliff; term
  tiers exactly as `cuna-staking.js` (1x–6x, 6x ceiling); `cancelableAllowed:false` unless a
  program version says otherwise.
- `owedNow = credits − paid − reserved`, never negative; a batch reserves atomically; a
  timed-out send is reconciled from the chain before any retry (the 2026-09-09 payout's
  `remainingLines` + `&sent=` flow, generalised).
- **Transfer identity is global — not per batch and not per project (rev 3).** A consumed
  transfer is keyed `xfer:<sig>:<instructionIndex>[:<innerIndex>]` — the chain's own identity of
  the transfer and nothing else — and stored in ONE consumed set shared by every project (the
  sig store the tools pass already uses, under its own `xfer:` namespace). Project id, reward
  mint, batch id and row id are recorded as **metadata on the consumed entry, never as part of
  the key**, so projects A and B that share a reward asset and a funding wallet cannot each
  consume the same transfer. `recordSent` verifies the specific transfer (token program, mint,
  source = fundingWallet, destination owner, raw amount) against the row and only then consumes
  the identity; "one tx = one row" is never assumed. Test: two projects with distinct project
  mints, the same reward mint, the same funding wallet, the same recipient and the same amount —
  one transfer settles exactly one row in one project; the other project's `recordSent` with the
  same `sig:index` is refused with `transfer_already_consumed` naming the owning project and row.
- **Every attempt is identified by its own transaction signature BEFORE broadcast (rev 4).**
  States: `pending → signing → submitted → paid | failed`. The payout page never uses
  `signAndSendTransaction`; it uses `signTransaction` (Wallet Standard: sign only, the wallet
  does not broadcast) and WE broadcast, so nothing can land that the server has not recorded:
  1. `POST …/rows/:id/attempt` registers `{ attemptId (client random), recentBlockhash,
     lastValidBlockHeight, startedAt }` and moves the row to `signing`; the transaction is built
     with exactly that blockhash. A row with a live attempt refuses a second `attempt`.
  2. The wallet signs. The client reads the signature off the signed transaction (it is
     deterministic for the signed bytes) and `POST …/rows/:id/attempt/:attemptId/signature`
     records it. **Only a 2xx from that call permits `sendRawTransaction`.** A tab lost before
     this call means nothing was ever broadcast — the wallet did not send it and neither did we.
  3. The client broadcasts and the row is `submitted`. A tab lost here is the case the finding
     names, and it is closed: the server holds the exact signature.
  Reconcile is by **that signature only** — `getSignatureStatuses([sig],
  {searchTransactionHistory:true})` then `getTransaction(sig)` to verify the transfer against
  the row (token program, mint, source = fundingWallet, destination owner, raw amount) before
  consuming it under the global identity. No matching by payer/recipient/mint/amount, ever:
  a shared funding wallet or a second project paying the same person the same amount can never
  be mistaken for this attempt. A row in `signing` or `submitted` **cannot be cancelled and its
  reservation cannot be released.** A `signing` row with no signature recorded returns to
  `pending` only when the blockhash has provably expired (finalized block height >
  `lastValidBlockHeight`) — a signed-but-unregistered transaction can no longer land — and a
  `submitted` row returns to `pending` only when ALL of: the blockhash has provably expired, the
  status lookup returned a complete "not found" (an RPC error, timeout, `unavailable` or a node
  that is behind keeps the row and the reservation exactly as they are), and two consecutive
  reconciles at least 60 s apart agreed. A rebuild is only possible from `pending`. Wallets that
  do not expose `signTransaction` are refused on the payout page with the reason. Residual,
  stated: a non-conforming wallet that broadcasts on `signTransaction` combined with a tab loss
  inside the blockhash window could land a transfer the server has no signature for; the
  reconcile for that case is the operator's "unmatched transfers" view (every outgoing transfer
  from `fundingWallet` in the reward asset that matches no row), which blocks the next batch for
  that wallet until resolved. Tests: (1) tab lost immediately after broadcast, before any
  callback — the row is `submitted` with its signature, cancel is refused, reconcile finds the
  transaction, the row is `paid`, a rebuild is refused; (2) tab lost after the wallet signed but
  before the signature was registered — nothing was broadcast; after blockhash expiry the row
  returns to `pending` and a rebuild is allowed; (3) reconcile while the blockhash is still valid
  finds nothing and KEEPS the state (never releases early); (4) restart mid-`signing` /
  mid-`submitted` — the attempt and signature survive on disk and reconcile behaves identically;
  (5) RPC unavailable or returning an error during reconcile — state and reservation untouched;
  (6) two projects sharing a funding wallet pay the same recipient the same amount in the same
  minute — each row resolves only by its own signature and neither can claim the other's
  transfer; plus the earlier set: two operators creating batches concurrently (only one reserves
  a given credit), a lost response after a send (row reconciles to paid from its signature,
  never resent), cancellation during confirmation (refused), late confirmation after a restart
  (row flips to paid on reconcile), and restart mid-batch (reservation survives).
- **Who signs:** the project's `fundingWallet`, from the project's own payout page, in its own
  wallet. We hold no key. The server builds nothing that moves funds; it verifies signatures
  after the fact, exactly as today.
- Nothing pays without an explicit, in-the-moment operator action; previews and dry runs are
  never permission. The owner's PLAN ≠ EXECUTE rule applies to every project.

## 5. Surfaces

Public (no wallet needed):
- `/p/<projectId>` — the hub: identity, the relevant lessons (two or three, linked at the moment
  of action), the current program version and its hash, eligibility explained in plain words,
  funding status with the three numbers labelled, payout history with receipt links, the
  project's Lock of Fame entry, and links into the tools it used (Holders, Buy Special, airdrop).
- `/p/<projectId>/program/<version>` — the versioned program record, human page + JSON.
- `/p/<projectId>/eligibility?wallet=` — why each of that wallet's locks qualifies or fails, with
  reason codes and the numbers the rule used.
- `/receipt/<batchId>/<wallet>` — the receipt, with the transaction link and a "reproduce this"
  export: the dated inputs (credits per period, program version) another developer can rerun
  through the pure libs. Missing historical inputs are labelled missing, not reconstructed.

Operator (signed-nonce login as a wallet in `operatorWallets`):
- `/p/<projectId>/operate` — draft the next program version and preview the holder view; see
  accrued/reserved/paid; create a batch; the payout page for `fundingWallet` (the existing
  `/cuna-payout` flow, project-scoped); confirm rows; funding status.

Owner (admin key, POST-only):
- approve/suspend a project; set `fundingWallet` and `operatorWallets`; arm/disarm accrual per
  project (two flags, disarmed by default, exactly like CUNA today).

APIs mirror the pages: `GET /api/program/:projectId/{config,wallet,eligibility,batches,receipt}`
public; acting routes POST-only, `project`-explicit, and authorised per the matrix below (the
`mutating-get-guard` test extends to them).

**Permission matrix** (re-checked on EVERY mutation against the current Project record — removing
an operator wallet revokes it immediately; no cached authority):

| Action | Owner (admin key, POST) | Operator (challenge-signed login, wallet ∈ `operatorWallets`) | Funding wallet |
|---|---|---|---|
| approve / suspend project, set `fundingWallet`, set `operatorWallets` | ✔ | ✖ | ✖ |
| arm / disarm accrual | ✔ | ✖ | ✖ |
| draft a program version (unpublished) | ✔ | ✔ (first cohort: owner may restrict) | ✖ |
| publish a program version | ✔ | ✖ (owner publishes in the first cohort) | ✖ |
| create a batch (reserve) | ✔ | ✔ | ✖ |
| sign and send a batch | ✖ (never holds the key) | ✖ | ✔ (its own wallet, its own page) |
| record sent rows | server verifies from the chain; any authenticated party may trigger the reconcile | | |
| cancel a batch (no submitted rows) | ✔ | ✔ | ✖ |
| read operator console | ✔ | ✔ | ✔ if also an operator |

Operator login is **not** the tools-pass session: it uses a server-issued, single-use, expiring
challenge bound to the purpose (`clkn-hub-operator`) and the project id, and its token is a
separate HMAC purpose with a short TTL. Money administration never reuses a tools-pass token.

## 6. The demo this enables (inside the window)

One project, one holder, three minutes: the operator publishes a program version → a holder's
lock shows "qualifies: 3-month term, 1x" with the rule that decided it → the funding status
shows obligations vs reserved → the operator signs a batch from their own wallet → the holder
opens the receipt and reproduces the amount. A second, dry-run project proves isolation. A real
transfer is shown from a confirmed historical transaction or a clearly labelled dry run; nothing
is paid for the camera.

## 7. Acceptance tests (each becomes a CI script)

1. Isolation: the five cases in §3.
2. Decimals: a 6-decimal and a 9-decimal project produce correct raw amounts and lines; a
   Token-2022 mint with a transfer-fee extension is refused at approval with a clear message.
3. Program versioning: editing terms creates version 2 with a new hash; periods accrued under v1
   keep v1; the record page for v1 is byte-stable.
4. Eligibility reasons: every `disqualify()` branch surfaces a code; the wallet page shows the
   numbers that decided it.
5. Balance states (rev 3 — the partition, not a sum): `estimated` never persists; the
   invariant **`accrued = available + reserved + paid`** holds after every ledger operation
   (accrue, reserve, attempt, send, confirm, cancel, reconcile, migrate) and is asserted by a CI
   check over the whole ledger, per wallet and per project; a cancelled batch returns its unsent
   rows to `available` and its sent rows stay `paid`. Overpayment cases, explicit: a verified
   transfer LARGER than the row records `paid` = the row amount and `overpaidRaw` = the excess
   on the row and the wallet (shown on the receipt and the funding status, never floored to
   zero, never credited as future accrual); a transfer SMALLER than the row (rev 4) marks
   the row `partial` with `paidRaw` = what arrived and `remainingRaw` = the rest: the transfer
   is consumed under the global identity and counted as `paid`, the remainder STAYS reserved on
   the same row, nothing returns to `available`, and the only action the row accepts is a new
   attempt for exactly `remainingRaw` (a second partial narrows it again). Test: a 100-token row
   receives 40 → the next attempt for that row can only be built for 60, never 100; then 40
   more → 20; `paid` for the wallet never exceeds `accrued`, and the partition invariant holds
   at every step. The owner (not an operator) may instead mark the remainder `waived`, which is
   an explicit, logged decision that releases it to `available` — it is still owed, the next
   batch draws it; a manual send outside the system that puts
   `paid > accrued` for a wallet shows `overpaidRaw` and draws nothing in the next batch.
6. Funding: obligations, reserved and observed balance are three different fields; the UI
   cannot show a green "funded" from an observed balance alone.
7. Receipts: the amount equals the verified transfer; a multi-transfer transaction verifies the
   right row; a receipt for an unrecorded row 404s; the reproduce export reruns to the same raw.
8. Signing: the server never holds or uses a project key; a batch recorded with a signature from
   the wrong source wallet is refused.
9. Access: operator routes need a signed-nonce login bound to `operatorWallets`; a wallet from
   another project is refused; the owner routes are POST-only and 405 on GET.
10. Migration: CUNA's live ledger reads identically through the new keys; `cuna-payout-verify`
    still verifies batch `cb_8d28a7ea39`.

## 8. Open questions for the owner

- Which second project runs the dry run first (POKE, DNC, ROSE, or a NORMIE-community token)?
- Program funding: does a project have to pre-fund a period into `fundingWallet` before accrual
  arms, or is a shortfall simply shown? (Design shows it; the owner may want to require it.)
- Operator self-service for program *drafts*: allowed, or owner-only for the first cohort?
- Public naming: `/p/<id>` vs `/project/<id>`; and whether the hub carries the project's own
  Telegram/X links (moderation implications).

## 9. Out of scope for the window

Self-service public enrollment; any escrow protocol of our own; the CUNA burner generalised; a
task marketplace (one manually reviewed pilot task at most, and only if the hub ships early);
engine restarts of any kind.

---

## Addendum A — Launch Readiness: the Hatchery as the "Build" stage (Codex proposal, 2026-09-10; adopted)

**Idea.** Extend the Hatchery from "mint a token, stop before liquidity" into a guided *launch
your project responsibly* journey whose public face is a **Launch Readiness checklist** on the
Project Hub. Every item carries one of three states, never a score:

| State | Meaning | Source of truth |
|---|---|---|
| **Explained** | the operator completed the lesson attached to the step | the school's progress ledger (`lib/school-progress.js`), per operator wallet session |
| **Declared** | the operator published an intention (allocation, vesting plan, who keeps control) | a signed statement stored on the program record, shown verbatim with its date |
| **Verified** | specific on-chain evidence exists | our existing readers: locks by mint, metadata immutability, mint/freeze authority, burn receipts, listing checkup, LP position scan |

A complete checklist is **never** a "safe token" badge (the Cluck Score lesson). The page shows
the three columns and lets the reader draw their own conclusion; "Declared" without "Verified" is
displayed as exactly that.

**The journey and what already exists for each stage**

| Stage | Hatchery helps the operator… | Exists today | New in the window |
|---|---|---|---|
| Plan | define purpose, supply, allocations, what holders are and are not promised | Hatchery explains supply/decimals/authorities; Incubator + belt lessons | a short *Plan* form → the first Declared items; the **reward-budget planner** (pure calculator on `lib/cuna-staking.js`: where rewards come from, runway in days at `poolDailyRaw`, who qualifies, what happens when funding ends, what the operator can change) |
| Create | mint with permissions, metadata and irreversible choices explained | the Hatchery, Arweave metadata, Token Metadata Lock | none beyond linking; **optional** — an existing token enters at Declare |
| Add liquidity | understand pairs, initial pricing, depth, fees, position risk before signing | LP Lab (14 lessons), LP Rescue scanner, `/api/whirlpool/pools` | the *Explained* hooks for three LP Lab lessons; a **transaction preview** explainer for the pool-creation step (what the signature does, what is irreversible) — no automated deployment |
| Explain commitments | publish allocations, vesting, liquidity arrangements, who retains control | Locker Room, Lock of Fame, Project Burn receipts | the Declared statements + Verified readers side by side; the three-way distinction taught explicitly: locking project tokens ≠ vesting allocations ≠ restricting control over LP positions |
| Support holders | set up a clearly funded participation program | CUNA lock-to-earn | the multi-project program record (§2–§5 above) |
| Prove delivery | show actual locks, terms, confirmed distributions | `/lock/:mint`, receipts (§2) | the Project Hub page composing all of it |

**Checklist items (first cut).** Purpose and promises declared · supply and decimals verified on
the mint · mint authority state verified · freeze authority state verified · metadata immutable
verified · allocation plan declared · team/treasury locks verified (with Rule B exclusions shown) ·
liquidity: pools verified, LP position ownership verified (scan), LP lock status *declared* until a
supported reader exists · listings verified (Listing Checkup) · holder program: terms published
(program record hash), funding status shown, first receipt verified · LP Lab and safety lessons
Explained per operator.

**What stays out of the window.** Farm deployment and any LP-locking integration (review the
specific protocols and position types first); automated liquidity provisioning; any new
money-moving integration. LP *education* and transaction previews come first.

**"Verified" carries a date, a scope and a freshness state.** Every verified item records
`{ observedAt, source: "chain" | "external-service", reader, evidenceRef, freshness: fresh |
stale | unavailable }`. Chain evidence (mint authority, locks, positions) is re-read on a schedule
and shown with its observation time; an external listing-service response is labelled as such and
never presented as on-chain evidence. A change of ownership, an unavailable reader, or a
contradiction between a Declared statement and a Verified reading flips the item to the honest
state (stale / unavailable / contradicted) while the historical evidence stays visible with its
date. Historical evidence is never presented as current verification.

**Acceptance tests added.** 11. Each checklist item resolves to exactly one of
explained/declared/verified/none with its evidence link, observation time and freshness; a
declared item never renders as verified; an item whose underlying assertion no longer holds
(ownership changed, reader unavailable, declaration contradicted) renders stale / unavailable /
contradicted, not verified. 12. The reward-budget planner reproduces the CUNA programme's
published figures AND handles: zero budget, zero daily distribution, eligible participation
changing mid-run, payout caps, 6- and 9-decimal assets, and an unavailable funding observation;
runway is labelled a scenario, never committed funding or guaranteed earnings. 13. A project with
no Hatchery mint (an existing token) completes the checklist from Declare onward. 14. No route or
copy anywhere renders a "safe" / "verified project" summary badge.

**Funding accounting, defined.** `obligationsRaw = accrued − paid` (project-wide); `reservedRaw`
= sum of pending + submitted batch rows — an **accounting** reservation only, nothing is moved;
`observedBalanceRaw` = the funding wallet's balance of the reward asset at `observedAt`;
`shortfallRaw = max(0, obligationsRaw − observedBalanceRaw)`. A funding wallet shared by several
projects (or by a project and its own treasury use) is flagged `sharedFunding: true` and its
observed balance is shown once with the list of projects that draw on it — it is never counted
toward each project's coverage separately. Whether a project must pre-fund before accrual arms
remains the owner's policy decision; the accounting above holds either way.

**Migration test 10, extended:** the migration script is idempotent (run twice → identical
state), survives interruption (partial run → rerun completes with no duplicates), and while both
key shapes exist the old `/api/cuna-stake/*` routes and the new `/api/program/cuna/*` routes read
one ledger — neither can accrue or reserve the same obligation twice (a reservation made through
one is visible to the other).

## Addendum B — Settlement protocol, overpayment accounting, multi-transfer receipts (Codex Round 0, 2026-09-13; adopted)

Three P1 findings on revision 4, each a contradiction an implementer could not satisfy. This
addendum **supersedes** §2's "Overpayment is surfaced, not floored away" bullet, the `paid >
accrued` sentence in test 5, and the single-transfer receipt shape in §2; everything else stands.

### B1. One idempotent settlement event, owned by the row
§4 consumed a transfer's identity in the global sig store while the row's `paid` state lived in
per-project kv, with no commit protocol between the two writes. Failing sequence: the transfer
verifies → the identity is durably consumed → crash before the row is marked paid; a retry either
refuses the consumed transfer forever or risks applying it twice, and reversing the writes
reopens cross-project reuse.

Rule: **settlement is ONE durable write.** A settlement journal keyed by the chain identity
(`settle:<sig>:<instructionIndex>[:<innerIndex>]`) holds
`{ xferKey, projectId, batchId, rowId, wallet, amountRaw, appliedRaw, excessRaw, slot, at,
verifiedBy }`, written once, in a single kv put, AFTER verification and BEFORE anything else.
Both "this identity is consumed" and "this row received this transfer" are *read from* the
journal; the global consumed set and the row's `paid` projection are **derived indexes**,
rebuilt from the journal at boot and re-derived by `reconcile`.
- Crash before the journal write: nothing is consumed; the retry re-verifies and writes.
- Crash after the journal write, before a projection update: boot or the next reconcile replays
  the journal and the projections converge; the retry finds the entry and returns the same result.
- `recordSent` retry with the same identity: if the journal entry names this row → idempotent
  success (same receipt); if it names another row or project → `transfer_already_consumed`
  naming the owner. There is no "unconsume".
- CI: fault injection before and after the journal write and before and after each projection
  update, for `recordSent`, `confirm`, `cancel`, `reconcile` and `migrate`; two projects sharing a
  reward mint, a funding wallet, a recipient and an amount (the §4 case) on top of every
  injection point.

### B2. Overpayment accounting — three numbers, never netted across wallets
Test 5 required `paid ≤ accrued` and the partition after every operation, then allowed a manual
send to make `paid > accrued`; with accrued=100 and a verified 110 the partition needs
available=−10. Two wallets made it worse: subtracting one wallet's excess project-wide erased
another wallet's unpaid 10.

Rule: per wallet per project,
- `paidTotalRaw` — the sum of every verified transfer settled to this wallet (journal entries);
- `paidAppliedRaw` — the part of `paidTotalRaw` applied against this wallet's accrual,
  `min(paidTotalRaw, accruedRaw)`; **this and only this** is the `paid` term of the partition
  `accrued = available + reserved + paidApplied`;
- `excessRaw = paidTotalRaw − paidAppliedRaw` — never negative, never credited as accrual, never
  reduces any other wallet's obligation, never reduces the project's obligations except through
  this wallet's own future accrual.
Future accrual for a wallet with `excessRaw > 0` is applied against the excess first: each new
credit raises `paidApplied` and lowers `excess` one-for-one until the excess is consumed, and
`available` stays 0 meanwhile. Obligations are `Σ(accruedRaw − paidAppliedRaw)` over wallets —
a per-wallet sum, so wallet A's excess can never hide wallet B's unpaid amount. Receipts, the
funding status and the operator console show all three numbers. The `owedNow` zero floor stays;
it is `available`, already non-negative by construction.
- CI (test 5 restated): the partition holds after every ledger operation; accrued=100, manual
  110 → applied 100, excess 10, available 0, obligations 0 for that wallet; the next 10 of
  accrual → applied 110, excess 0, available 0; a second wallet with accrued=100 and paid=90 keeps
  obligations 10 regardless of the first wallet's excess; a partial 40 of a 100 row keeps 60
  reserved on that row (rev 4 unchanged), and `waived` remains an owner-only, logged release.

### B3. Receipts carry every transfer, append-only
§2's receipt had one `amountRaw / transferId / sig` per batch-wallet, while test 5 allowed 100
owed to be paid as 40 + 40 + 20 and test 7 required "the receipt amount equals the verified
transfer" and "the export reruns to the same raw". No single signature proves the 100 and the
accrued amount is not any one 40.

Rule: a receipt is an **aggregate per (batch, wallet)** with
`totals: { owedRaw, appliedRaw, excessRaw, remainingRaw }` and an append-only
`settlements[]`, one immutable entry per journal event
`{ xferKey, sig, instructionIndex, innerIndex, slot, at, amountRaw, appliedRaw, excessRaw }`.
Earlier entries are never overwritten by later ones. Test 7 restated: each settlement entry's
`amountRaw` equals its verified transfer; `Σ appliedRaw = totals.appliedRaw`; the reproduce
export reruns to `totals.owedRaw` (the calculation), which is shown as a distinct claim from
"payment verified" (the transfers). The 40/40/20 sequence and an overpayment (a 120 transfer on a
100 row → applied 100, excess 20) are pinned in the receipt tests. The receipt URL
`/receipt/<batchId>/<wallet>` is unchanged; a per-settlement anchor `#s=<xferKey>` links one
entry.

### B4. Test ownership (every promised test assigned or deferred)
| Test | Owner | Gate |
|---|---|---|
| 1 isolation, 2 decimals, 3 versioning, 4 reasons, 5 (B2), 6 funding fields, 7 (B3), 10 migration (+ Addendum A's extension), B1 fault injection | W1 | W1 pure gate |
| 8 signing, 9 access, §4 signing/reconcile fault cases, the dry-run second project on staging | W1 + W3 | **integration gate** |
| 14 no "safe" badge anywhere | W2 | W2 |
| 11 checklist states + freshness, 12 reward-budget planner, 13 existing token from Declare | W9 (Launch Readiness) — starts only if the integration gate is green by Sep 26; otherwise the first post-hackathon item | deferred |

Schemas in §2 as amended here are **frozen on 2026-09-16**; fixture work in W2 starts on the
frozen shapes; a later schema change is a PR to this document first.

### B5. An independent witness for the program record
A hash served by the same server that computes the payout lets a reader rerun the arithmetic
over server-supplied observations; it does not establish that the server omitted no qualifying
escrow, and it is not an independently witnessed commitment. Two cheap steps in the window:
(1) at publish, the funding wallet signs a memo transaction carrying `program:<projectId>:v<n>:
<sha256>` — an on-chain, dated, third-party-observable commitment by the party that pays; (2)
the canonical JSON of every published version is mirrored under `programs/` in this repository.
Until both exist for a version, the public wording is "the calculation is reproducible from the
published inputs", never "independently verified". Completeness (no omitted escrow) remains a
separate claim that only an independent scan of the lock program can support; it is not made.

---

## Addendum C — Teach the button before you offer it (Codex, 2026-09-14; adopted)

**Headline for the impatient: this addendum requires NO schema change.** Everything it specifies
is derived from entities already in §2, plus one server-side constant. The Sep 16 freeze holds.

### C1. The principle

CLAUDE.md: *guardrails before power — first-timers get warned before they can hurt themselves.*
The Hub asks a holder to immobilise their tokens for three to eighteen months. That is the single
most consequential button anywhere in the product, and a generic locking service shows them a
term sheet and a Confirm.

We have 35 lessons, a Library, an LP Lab and an AI tutor already live. The differentiator is not
that we lock tokens. It is that **we explain what the holder is agreeing to, in the flow, before
they agree** — and that the explanation is generated from *this* program's real terms, not from
marketing copy.

> Don't just give someone a button. Teach them what the button does.

This is also where the company theme lands on one surface: **Educate** answers the questions,
**Build** is the campaign, **Earn** is the receipt. Judges score Insight; a feature list does not
earn it, and this does.

### C2. The six questions, and where each answer comes from

Every answer is computed from §2 entities. None is authored per project. The lesson link is
context, never the answer.

| Question | Answer derived from | Lesson link |
|---|---|---|
| **What happens to my tokens?** | Eligibility record `escrow`, `amountRaw`, `termDays`, `firstSeenAt`; program `minTermDays`/`maxTermDays`. Names the escrow address and the exact unlock date. | locking basics |
| **Can I sell during the lock?** | Program `cancelableAllowed:false` plus the escrow. The answer is a flat **no**, with the date, and the explicit line that **nobody can move them early, including us**. | custody + escrow |
| **Where does the reward come from?** | The **Funding status** object: `obligationsRaw`, `reservedRaw`, `observedBalanceRaw`, `shortfallRaw`, and `fundingResponsibility: fundingWallet`. Says which of the three it is showing, per §2. | who pays rewards |
| **How much will I get?** | `estimated` (preview only, never stored) plus the weight rule. See C3 — this is the dangerous one. | pool share + dilution |
| **What are the risks?** | Derived: term length, live `shortfallRaw` state, and whether `rewardMint` differs from the locked mint. | risk of locking |
| **Why lock at all?** | Generic. No project-specific claim. | why projects lock |

**The reward-asset risk is mandatory and derived**: when `rewardMint !== mint`, the block says in
plain words that the holder is locking one asset and being paid in another, and that the reward
asset's value can move independently. This falls straight out of §2's pinned reward asset.

### C3. We do not show APR. Ever.

An APR implies a rate we control and guarantee. We control neither. The pool is shared
(`poolDailyRaw` split by weight), so any individual's rate **falls when other people lock** — and
a number that moves against the holder after they commit, having been shown as a headline before
they committed, is the exact pattern this project exists to warn people about.

What the block shows instead:

- today's `estimated` slice, labelled an estimate and never stored;
- the sentence that makes it honest: **"this is today's share. It goes down when more tokens are
  locked and up when locks end. It is not a rate anyone promised you."**;
- the weight rule in words: amount multiplied by committed term.

A future version may show a modelled range with its assumptions stated. It may not show a single
APR figure. **Test 17 pins the absence.**

### C4. The lesson map is a constant, not schema

A server-side table maps each of the six concept keys to a lesson id already in the curriculum.
It lives beside the curriculum, not on the program record, because it is identical for every
project and an operator has no business choosing which lesson a holder reads.

The existing i18n audit already fails CI on a lesson id that does not resolve, so a renamed or
deleted lesson breaks the build rather than shipping a dead link. Copy goes through the seven-
language dictionary pattern like every other surface.

### C5. Placement and behaviour

- Renders on `/p/<id>` and `/p/<id>/program/<v>`, **above** the lock action, not behind a tab.
- The risk line and the "can I sell" answer are **always visible**, never collapsed and never a
  dismissible modal. The rest may be collapsed with the questions readable.
- The block reads correctly for a visitor with **no wallet connected** — all six answers work
  from the program version alone; connecting a wallet only personalises the estimate.
- Phone first. This is the surface most likely to be read on a phone at the moment of decision.

### C6. What it must never become

- Not a **"safe project"** badge, or anything a reader could mistake for our endorsement of the
  project, the token or the reward. §5's existing ban on safety badges covers this block too.
- Not a place for **operator free text** in the first release. A project-authored blurb on a page
  we render is an endorsement risk and an injection surface, and the codebase has already been
  bitten by unescaped third-party strings. Additive later if wanted; out now.
- Not a **claim of independent verification.** Per Round 0, the wording is "the calculation is
  reproducible from the published inputs" until B5's independent witness exists.

### C7. Schema impact: none

Stated explicitly so the freeze is not reopened. No new field on Project, Program version,
Period, Eligibility record, Balance states, Batch, Receipt or Funding status. Addendum C is a
**surface** (§5), a **server-side constant** (C4) and three **acceptance tests** (C8).

### C8. Acceptance tests (continuing the numbering from §7 and B4)

15. **Every answer is derived.** For a fixture program, all six answers render with no
    project-authored content; the escrow, unlock date and funding state in the copy match the
    entities exactly.
16. **The reward-asset warning is mandatory.** With `rewardMint !== mint` the differing-asset
    risk line is present; with `rewardMint === mint` it is absent. Neither is operator-controlled.
17. **No APR anywhere.** No route, template or dictionary string in the Hub surfaces renders
    "APR", "APY" or a percentage-per-year figure. Extends test 14's pattern (the "safe badge"
    guard) to rate language.

Owned by W2; they gate W2's definition of done alongside test 14.
