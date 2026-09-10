# Design: the Project Hub, program record and verifiable receipts

Status: **design only, no code** (owner rule 2026-09-10: publish nothing until the window opens;
build from 2026-09-14). Written for a second-reviewer pass (Codex) before implementation. Every
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
- **Transfer identity is global, not per batch.** A consumed transfer is keyed
  `<projectId>:<rewardMint>:<sig>:<instructionIndex>[:<innerIndex>]` and stored in one
  project-wide consumed set; the same on-chain transfer can never satisfy two batches, two rows,
  or two projects. `recordSent` verifies the specific transfer (token program, mint, source =
  fundingWallet, destination owner, raw amount) and consumes that identity; "one tx = one row"
  is never assumed.
- **Batch rows carry a `submitted` state.** `pending → submitted (sig known, unconfirmed) →
  paid | failed`. A batch with any `submitted` row cannot be cancelled and its reservation cannot
  be released until every submitted row resolves from the chain (confirmed, or expired blockhash
  with no confirmation). Tests: two operators creating batches concurrently (only one reserves a
  given credit), a lost response after a send (row reconciles to paid from the chain, never
  resent), cancellation during confirmation (refused), late confirmation after a restart (row
  flips to paid on reconcile), and restart mid-batch (reservation survives).
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
5. Balance states: `estimated` never persists; `accrued + reserved + paid` reconcile to the
   ledger; a cancelled batch returns its unsent rows to owed and its sent rows stay paid.
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
