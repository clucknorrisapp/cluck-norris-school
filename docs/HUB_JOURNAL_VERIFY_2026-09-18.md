# Hub settlement journal (PR #342) — two-lens adversarial verification, 2026-09-18

Read-only reviews of commit 332a79c (merged onto develop as 6a94e71), run before merge per the multi-agent budget rule (money path: two lenses). Both lenses ran code against the real route closures. PR #342 is BLOCKED until the P0/P1 items are fixed on the branch and one lens re-verifies.

## Lens 1 — an adversary (operator or holder trying to get paid twice, more, or forge a receipt)

## Read-only adversarial review — Hub settlement journal (`claude/hub-settlement-journal`, commit `332a79c`)

Nothing was edited, committed, pushed, or sent to any server. All work was in the given worktree (root below) plus a scratch harness in `/tmp/claude-0/.../scratchpad/attack/` that requires the worktree's modules and drives the **real route closures** (`routes.mount` + a fake Express, the same DI style as the shipped test) with synthetic `jsonParsed` transactions. No network.

Worktree root: `/tmp/claude-0/-home-user-cluck-norris-school/bcde813f-e57f-5571-b70a-272b73ac59d7/scratchpad/journal`
(paths below are absolute under that root; they map 1:1 onto the repo).

**Tests run:** `node scripts/hub-settle-route-test.cjs` → 24 passed. `node scripts/payout-verify-test.cjs` → 11 passed. Both green, unmodified.

---

## The headline

The journal is wired in correctly as an *observer*, but **it is not authoritative where it matters**: the legacy `batches[].sent` / `paid` write is what `owedNow`, the public payout list and the desk read, and it is written **before** and **independently of** the journal's verdict. Everything the journal refuses — already-consumed transfers, unattributable transfers — still lands as a legacy "paid" row and still zeroes what the holder is owed. Separately, **nothing anywhere checks who sent the tokens**, although `lib/hub/ledger.js:146` documents that precondition ("source = fundingWallet") as the caller's job.

---

## Findings, ranked

### P0-1 — A transfer from *anyone* settles the row. The source is never checked. **CONFIRMED (ran the route)**
`lib/payout-verify.js:96-160` (`rowPaidBy`, `locateTransferInstruction`) match on **mint + destination-owner + amount** only. `verifyBatchRows` (`lib/payout-verify.js:79`) adds no source check, and `lib/hub/settle.js:43` passes the tx straight to `locateTransferInstruction`.

Attack (operator of project P, whose reward mint is the token holders trade — i.e. CUNA-shaped lock-to-earn):
1. `POST /api/hub/P/payout?export=1` → batch `hb_x`, wallet W owed 1.0.
2. Watch the chain for **any** inbound transfer of the reward mint to W of ≥ 1.0 landing after the export — a DEX buy W made herself, an airdrop, another project's payout.
3. `POST /api/hub/P/payout?batch=hb_x&sent=[{"wallet":"W","sig":"<that sig>"}]`

Result I ran: `recorded:["W"]`, `journaled:true`, one journal entry, **`owedNow` for W drops to 0**. Works identically when the SPL transfer is an **inner/CPI instruction of an unrelated program** (a Jupiter-shaped tx) — `instructionIndex:0, innerIndex:0`, journaled. The holder is never paid and the ledger says she was. The public receipt then prints `claims.paymentVerified: true` and `fundingWallet: <the project's funding wallet>` next to a transfer that came from an AMM (I rendered it — see P1-4's shape dump).

The only limits that bite are `notBefore` (`lib/payout-verify.js:49-53`: the tx must not predate the batch by >600 s — verified: a tx 4000 s older is refused) and the amount floor. Neither constrains a malicious operator, who controls when the batch is exported. A `blockTime` **10 years in the future** is also accepted (no upper bound) — confirmed.

Fix shape: require `source` (or the source ATA's owner) to be `project.fundingWallet` / one of `fundedBy`, in both `rowPaidBy` and `locateTransferInstruction`. The parsed instruction already carries `info.source` and `info.authority`; `meta.preTokenBalances` gives the source account's owner.

### P0-2 — The journal refuses "already consumed", the route records the legacy row anyway. **CONFIRMED (ran the route)**
`lib/hub/routes.js:692-698`: the settle loop only *reports* `journaled:false`; `paid` and `batches[id]` (already built by `pay.recordSent` at line 683) are persisted regardless, and the request answers 200.

(a) **Two projects, one signature.** `approveProject` (`lib/hub/project.js:100-104`) enforces uniqueness on `mint`, **not `rewardMint`** — two projects can legitimately share a reward asset. Ran it: alpha records + journals sig S for wallet W; beta then records the *same* S for W → `{recorded:["W"], ignored:[], journal:[{journaled:false, why:"transfer_already_consumed"}]}`, `beta.paid[W] = 1.0`, `owedNow(beta)[W] = 0`. One transfer, two projects' obligations discharged. (Also reachable against a Hub project whose `rewardMint` is CUNA's mint — the CUNA desk writes no journal at all, so nothing even notices.)

(b) **Two batches, one project, one signature.** `sigAlreadyUsed` (`lib/payout-verify.js:69-77`) only scans `b.sent[wallet]`, and `voidSent` (`lib/cuna-payout.js:245-249`) **deletes** that row. Ran the full sequence — settle batch1 with a real 1.0 transfer (journaled) → `void=W&sig=S&batch=b1` → `cancel=b1` → new accrual → `export=1` gives batch2 (0.5) → resubmit **the same S**: `recorded:["W"]`, `journal:[{journaled:false, why:"transfer_already_consumed"}]`, `paid = 0.5`, and the **public payouts list shows a settled 0.5 row carrying a signature that never moved 0.5 for it**. `void` and `cancel` are operator-available — only `send` and `confirm` are owner-gated (`lib/hub/routes.js:633-639`, `:711-720`).

Fix shape: when `settle` returns `transfer_already_consumed`, the row must be **rejected** (moved into `vr.rejected`), not recorded; and `sigAlreadyUsed` should consult the journal's consumed set, not just live `sent` rows.

### P1-3 — Arbitrary extra "settlements" can be stapled to an already-paid row (receipt forgery). **CONFIRMED (ran the route)**
`lib/hub/routes.js:692` iterates `vr.accepted`, **not** `r.recorded`. A row `recordSent` ignored as `"already recorded"` still goes through `settle`. `lib/hub/ledger.js:150-168` has no "this row is finished" rule — it records `applied = min(amount, remaining)` and dumps the rest into `excessRaw`.

Ran: row settled legitimately (1.0). Operator then submits a **stranger's unrelated 50-token transfer** to the same wallet, same batch → `recorded:[]` / `ignored:["already recorded"]` but **`journaled:true`**, a second journal entry `{amountRaw:"50000000000", appliedRaw:"0", excessRaw:"50000000000"}`. Public Addendum-B receipt now reads `totals.excessRaw: 50000000000`, `settlements: 2` — it claims the project paid this holder 51 tokens against a 1-token obligation. `ledger.checkInvariant` returns `[]` (clean), and `traction.compute`'s `hubReceiptsIssuedJournal` (`lib/traction.js:288-299`) counts the fake entry into the public receipts-issued number. Unbounded and repeatable.

### P1-4 — Every journal-backed receipt breaks its own public page. **CONFIRMED (shape by running `findReceipt`; break by reading the page)**
`server.js:7953` returns the Addendum-B body as `{ ok:true, receipt:{ …ledger.receipt(), $schema } }` — no `program`, no `symbol`, no `dryRun`, no `brand`. `public/hub.html:427` is `var p = r.program, x = r.receipt, sym = p.ticker || r.symbol;` → `p` is `undefined` → **TypeError**, caught by the outer handler at `public/hub.html:446-449`, so `/hub/:project/r/:sig` renders an error card. Even past the throw, `x.amountUi`, `x.sig`, `x.at` do not exist on the B shape (`sig` lives in `settlements[]`). I confirmed the served body by calling `pub.findReceipt` with the same context `server.js:7936-7943` builds: it returns the B shape with `settlements[]` for any lock-to-earn row that has a journal event — i.e. **for every payout made after this ships**. The page the hackathon pitch points at ("receipts you can verify") is the one that breaks.

### P1-5 — The journal's amount is the wallet's **net** delta, not the amount of the instruction it names. **CONFIRMED**
`lib/payout-verify.js:156-158`: after locating instruction *i*, `amountRaw` is taken from `tokenDeltas(tx, mint).get(wallet)`. Ran a tx where W receives 1.0 at instruction 0 and 0.4 of the same mint leaves another of W's accounts: located `{instructionIndex:0, amountRaw:"600000000"}`. The receipt therefore names `settle:<sig>:0` and an amount that instruction 0 does not carry — a holder checking the named instruction on-chain sees a different number. Answers question (7): yes, a journal-backed receipt can present an amount that differs from the on-chain transfer it cites. (Low reachability — needs the row's wallet to also spend the mint in the same tx — but it is a wrong receipt, not a wrong total.)

### P2-6 — One space in the signature opts a row out of the journal. **CONFIRMED**
`lib/hub/routes.js:693` does `txBySig.get(String(row.sig))` — untrimmed — while `lib/hub/routes.js:671` and `verifyBatchRows` key the map on the **trimmed** sig, and `recordSent` (`lib/cuna-payout.js:161`) trims too. Submitting `{"wallet":W,"sig":" <sig>"}` gives `recorded:["W"]` with `journaled:false` and an empty journal. So an operator can keep any row legacy-only at will — which is exactly the path where P0-2's consumption guard does not exist.

### P2-7 — `excess` never touches another wallet, but permanently absorbs the wallet's own future accrual in the Addendum-B view. **CONFIRMED**
Answering question (6): overpaying X leaves Y untouched (`partition` is per-wallet, `lib/hub/ledger.js:88-110`) — verified: Y's `availableRaw` unchanged. But `paidTotal` includes `excess`, so `applied = min(paidTotal, accrued)` eats future accrual: after an 9.0 "overpayment" against a 1.0 row, a later week's accrual gives `partition[X].availableRaw = "0"` while `owedNow[X] = 1000000000`. The live payout path builds batches from `owedNow`, so nobody is under-paid today — but the two ledgers now disagree, `checkInvariant` cannot see it, and combined with P1-3 an operator can zero any holder's Addendum-B `available` forever with one stranger transfer. `partition` is currently live only in `lib/hub/demo-fixture.js`, which is what keeps this at P2.

### P2-8 — `void` does not unconsume, and leaves the attempt stamped `settled`.
`voidSent` (`lib/cuna-payout.js:241-256`) touches only `sent`/`paid`; the journal entry and `batch.attempts[wallet] = {state:"settled"}` (written by `attempts.stampSettled`) survive. Verified the journal entry survives a void (paid → 0, entry still present). Deliberate per "there is no unconsume", but the row now reads settled on the desk/receipt and unpaid in the legacy ledger.

### P2-9 — `confirmed` commitment + an irreversible journal. **Reasoned only.**
`server.js:8158-8160` fetches with `commitment: "confirmed"`. A confirmed-but-forked transaction would be journaled permanently (no unconsume). Failed (`meta.err`), missing, and processed-only transactions are all correctly refused — verified for `meta.err` and "not found". Fork depth is the residual risk; `finalized` for the journaling read would close it.

### P2-10 — The sweep journals with no amount floor. **Reasoned.**
`lib/hub/routes.js:735-747` journals `rs.confirmed` rows via `settle` only; `rowPaidBy`'s minimum is not applied on this path, so whatever landed is journaled (`applied = min(amount, remaining)`). Rows here come from our own managed payer, so it is a divergence risk (legacy `paid` already holds the **full** batch amount from `recordSent`), not a forgery path.

### P2-11 — The receipt's `programHash` is reconstructed after the fact.
`lib/hub/public.js:305-315` / `lib/hub/reproduce.js:100-110` derive the version from `versionFor(programState, batch.at's date)`. A retroactive swap is **blocked** — I tried publishing a second version effective the same day and `createVersion` (`lib/hub/project.js:206`) refuses. But a batch whose accrual spans two versions still cites only the batch-date version as "the program version it pays under".

---

## Attacks that did NOT work (defences that hold — all run through the real route)

- Transaction pays a **different wallet** → `no 4yro2x… reached this wallet`, nothing recorded, nothing journaled.
- **Different mint** → same refusal (`tokenDeltas` filters by mint).
- **Smaller amount** (1 raw unit short) → `transfer smaller than the amount owed`, no slack.
- **Failed** (`meta.err`), **unknown/unconfirmed** (`getTx` → null) → refused at `rowPaidBy` and again at `locateTransferInstruction` (`lib/payout-verify.js:137`).
- Transaction that landed **before the batch was exported** → refused by `notBefore`.
- **Two transfers to the same wallet** in one signature → `matches.length !== 1` → never journaled, never guessed (`lib/payout-verify.js:155`); the second transfer cannot produce a second journal row later either (it stays ambiguous forever). Its *legacy* re-use is P0-2(b), not a journal failure.
- A wallet **not in the batch** submitted with a real transfer → `row_not_in_batch`, nothing stored (question 1's "wrong wallet" case, from the other side).
- **Same request replayed** → exactly one journal entry, `recorded:[]` the second time (idempotent via `xferKey`).
- **dryRun** project → every mutating action 403s before any store read; `days/batches/journal` untouched. A project **without a funding wallet** can only exist as `dryRun` (`lib/hub/project.js:64-67` throws otherwise), so question (8) is closed both ways.
- **Persist atomicity**: journal + per-project parts land together or not at all (`writeManyVerifiedMixed`, `lib/hub/store.js:56-64`); a graceful `false` answers 500 and leaves nothing behind.
- **CUNA key isolation**: `cunaStakeDays/Batches/Paid` untouched by a registry project's payout.
- **Question (9) — sanitisation**: nothing attacker-controlled is stored or rendered unsanitised. The journal only ever stores a B58-regex'd signature (`ledger.xferKeyOf`), a wallet that must already be a key of `batch.amounts` (accrual-derived), an `assertProjectId` project id, and BigInt strings; `why` values are a fixed enum. The operator's raw `wallet`/`sig` strings are echoed only in that operator's own JSON response, never persisted. `public/hub.html` escapes with `esc()` throughout. No memo or token-metadata path exists here.

---

## What I'd do before this ships

1. Check the **source** of the transfer against the project's funding wallet (P0-1).
2. Make a journal refusal **reject the row** instead of recording it, and consult the consumed set in `sigAlreadyUsed` (P0-2).
3. Iterate `r.recorded`, not `vr.accepted`, in the settle loop, and refuse a settlement against a row with `remaining === 0` (P1-3).
4. Fix `public/hub.html:427` for the new body shape, or return the B receipt with `program`/`symbol`/`dryRun`/`brand` siblings (P1-4).
5. Trim the sig at `lib/hub/routes.js:693` (P2-6) and take the amount from the located instruction, not the net delta (P1-5).

The shipped test suite is genuinely good on the *pure* layer (it even asserts `transfer_already_consumed` at `settle.js` level) — the gap is that no test asserts what the **route** does after the journal says no, and no test uses a transfer that did not come from the funding wallet.


## Lens 2 — durability and crash windows

## Read-only adversarial review — Hub settlement journal (branch `claude/hub-settlement-journal`, commit `332a79c`)

Nothing was edited, committed, pushed, or sent to any server. All work was done in the scratchpad checkout plus a `git archive` of the parent commit (`a7b8a1e`) into `/tmp/claude-0/…/scratchpad/parent2` for before/after comparison. Probe scripts live in `/tmp/claude-0/…/scratchpad/probe/` (p1, p2, p4, p7, p9).

`node scripts/hub-settle-route-test.cjs` → **24 passed**. Also ran hub-core (34), hub-attempts (11), hub-public, hub-schema, cuna-payout (30), payout-verify (11), reproduce-receipt (20) — all green.

The design intent is sound and most of the crash windows are genuinely closed. The problems are all in one place: **the journal is stored as a single whole-object kv value (`hub:settle`) that every payout request reads at its start and rewrites at its end.** That makes it last-writer-wins, which is the one property a settlement journal must not have.

---

## Findings, ranked

### P0-1 — Two overlapping payout requests erase each other's `paid`, `sent` rows AND journal entries → a verified, landed payment is paid again. **CONFIRMED by running the real route.** *(pre-existing; this change does not close it and extends its blast radius — see P1-1)*

`lib/hub/routes.js:654-656` reads `paid`, `batches`, `hubJournal` into request-local variables; `:698` (`&sent=`), `:746` (`&sweep=`) and `:804` (`&send=`) write the whole objects back. There is no lock on `&sent=`/`&sweep=`, and the only lock (`:781`, `bp.lockAcquire(kv, "hub:<p>:<batch>")`) is per-batch, `run=1` only, and released at `:785` — **before** the journal write at `:804`.

Sequence (probe `p9.cjs`, one project, one batch, two wallets):
1. Request A (`&sent=` for wallet A) reads the store, then stalls inside `await getTx(...)` at `routes.js:678` (a slow RPC read — this await is real and unbounded).
2. Request B (`&sent=` for wallet B) completes: `paid = {B: 2000000000}`, `sent[B]` written, journal entry written.
3. A resumes and writes `batches`/`paid`/journal from its stale snapshot. **B's `paid` entry, B's `sent` row and B's journal entry are all gone.**
4. `owedNow` reads 0 for B only because the batch still holds the row. Cancel that batch → **`owedNow` offers B 2,000,000,000 again.** Output: `after cancelling that batch, owedNow: {"4Gccq9":"0","5WKKoF":"2000000000"}`.

I re-ran the identical probe against the parent commit (`scratchpad/parent2`): **identical result**, so this is pre-existing from `saveMoney()` and is not a regression. I raise it as P0 because the whole stated purpose of the Addendum-B1 journal is to be the durable, idempotent witness that survives exactly this, and as written it does not — it inherits the same read-modify-write. A per-transfer kv key (`settle:<sig>:<idx>` as its own key, which is what B1's naming implies) would be immune; one blob is not.

### P1-1 — The global journal is now clobbered **across projects**. **CONFIRMED (new with this change).**
`lib/hub/store.js:17` (`JOURNAL_KEY = "hub:settle"`) is global; before this change two projects' payout requests touched strictly disjoint kv keys and could not interfere. Probe `p1.cjs`: project *alpha*'s `&sent=` stalls in `getTx`, project *beta*'s `&sent=` completes and journals, alpha's `writeManyVerifiedMixed` at `routes.js:698` overwrites `hub:settle` from its pre-beta snapshot.
```
beta journaled: true | journal keys now: 1
FINAL journal keys: 1 | projects: [ 'alpha' ]
beta's journal entry survived?  NO  <-- LOST WRITE
beta legacy sent row intact?  true
```
Consequences, none of which alert:
- **The B1 consumed-set guard is silently defeated.** Probe `p4.cjs` §6: with beta's entry present, `L.settle` for a second project returns `transfer_already_consumed`; once clobbered away, the *same signature settles a second project's row*, `ok:true`. The journal is the **only** cross-project reuse defence (`sigAlreadyUsed`, `lib/payout-verify.js:68`, is per-project by construction).
- The public receipt silently downgrades from Addendum-B3 back to the legacy shape (`lib/hub/public.js` `hasJournalEntry`).
- `lib/traction.js:288` counters undercount.

### P1-2 — `&void=` neither consults nor removes the journal entry, so a voided row diverges permanently. **CONFIRMED (new).**
`lib/hub/routes.js:716-720` calls `pay.voidSent` and persists `batches`/`paid` only. Probe `p2.cjs`/`p4.cjs`:
- After `&sent=` then `&void=`: `paid` → `0`, `sent[wallet]` deleted, **journal entry survives**. `pay.remainingOf(batch)` re-opens the row (`{wallet: "3000000000"}`) so a `&send=` on that batch sends real tokens again — while `owedNow` reports 0 owed. The two halves of the ledger now disagree about whether that row is payable.
- After `&void=` + `&cancel=`: `owedNow` **with** journal = `0`; **without** journal = `3000000000`. `lib/hub/ledger.js:20` states "There is no unconsume", and no route can delete a journal entry — so a wrongly-voided row's money is frozen forever with no operator remedy and no alert.

Either `&void=` should refuse a row that has a journal event (naming the `xferKey` — the chain says it landed), or voiding must write a compensating journal fact.

### P1-3 — `owedNow` merges the two witnesses with `max` of per-wallet **totals**, not a per-row union → under-subtraction → double pay. **CONFIRMED.**
`lib/cuna-payout.js:89-91`:
```js
let settled = paidRaw > (sentSum[w] || 0n) ? paidRaw : (sentSum[w] || 0n);
const ja = journalApplied[w] || 0n;
if (ja > settled) settled = ja;
```
`max` is only safe if one witness's row set is a superset of the other's. This change creates both ways for that to break (P1-1's lost journal write, P1-2's void). Probe `p2.cjs` §3: wallet accrued 200; batch 1 settled journal-only (legacy voided), batch 2 settled legacy-only (journal lost) — 200 genuinely left the wallet — and **`owedNow` re-offers 100**. The correct aggregation is per (batch, wallet) row: `max(legacy_row, journal_row)` summed over rows.

### P1-4 — The holder-facing "owed now" does not consult the journal, so the public page and the payout desk disagree with no alert. **CONFIRMED.**
`lib/hub/engine.js:242` (`walletView`, the `/p/<id>` wallet view) and `server.js:11705`, `:12483`, `:12688` all still call `pay.owedNow({days, paid, pending})` with no journal. In the probe-4 state the holder page would show 3,000,000,000 owed while the desk offers 0. The journal was made authoritative in exactly one of five call sites.

### P2-1 — `locateTransferInstruction`'s `amountRaw` is the wallet's **net delta across the whole transaction**, not the located instruction's amount. **CONFIRMED.**
`lib/payout-verify.js:156`: `const amountRaw = (tokenDeltas(tx, mint).get(wallet) || 0n).toString();`. Probe `p7.cjs` §8: a tx whose located instruction moves 100 to the wallet while the wallet also sends 30 of the same mint elsewhere → `{instructionIndex:0, amountRaw:"70"}`. Addendum B3 test 7 requires "each settlement entry's `amountRaw` equals its verified transfer"; `inst.parsed.info.amount` is already in hand at `payout-verify.js:141`. It fails safe (a negative net → `transfer_amount_invalid` in `ledger.js:155`), but it can understate a settlement's `amountRaw`/`excessRaw` in the published receipt.

### P2-2 — No boot replay / reconcile. Addendum B1 requires the consumed set and the row's paid projection to be "rebuilt from the journal at boot and re-derived by `reconcile`". Nothing does: `L.consumedSet` (`lib/hub/ledger.js:175`) is referenced only by tests, and no route re-derives projections. A journal/legacy divergence (P1-1/1-2/1-3) is therefore never detected, never repaired, never alerted.

### P2-3 — `journaled:false` is reported only in the JSON body, never alerted. `routes.js:693-695` / `:737-739` / `:799-801` push `{journaled:false, why}` into `report.*.journal`. The most likely real trigger is the airdropper's own batched shape — two transfers landing in two token accounts of the *same* wallet in one signature is `null` from `locateTransferInstruction` by design — leaving a permanently receipt-less row that only shows up if a human reads the response.

### P2-4 — The `&send=` "journal did not persist" alert is true on disk and false in memory. `lib/kvstore.js:103-113` `setManyVerified` assigns `state[k] = v` for every key **before** persisting, then returns `false` if the read-back fails. So after `routes.js:805` alerts "the settlement journal did not persist — the legacy record is intact", the same process continues serving the journal entries as if they had landed (they vanish on restart). The route's `else` branch correctly declines to adopt `curBatches`/`curJournal`, but the kv underneath has already taken them. Same pre-existing shape as `writeVerified`, newly relevant because this is the one path that continues after a failed money write.

### P2-5 — Receipt gating is per (project, batch, wallet), not per signature; the program hash is derived at read time. `lib/hub/public.js` `findReceipt`'s `hasJournalEntry` matches on `projectId/batchId/wallet`, and the version comes from `versionFor(programState, batch.at)`. Good news: `lib/hub/project.js:203` refuses a backdated `effectiveFrom`, so the derived hash is stable over time — receipts are not retroactively mutable. But a batch that pays periods accrued under v1 and was built on the day v2 took effect is labelled with v2's hash. (`reproduce()` only re-sums stored period credits, so this is a labelling claim, not a calculation error.)

### Good news worth recording
- **There is an undocumented repair path for a lost journal write.** Probe `p7.cjs`: after a `&send=` whose journal write failed (alert fires, row is `pending:false` so `&sweep=` will never revisit it — `routes.js:723`), re-POSTing `&sent=` with the same `{wallet, sig}` journals it. `sigAlreadyUsed` excludes the current batch (`payout-verify.js:71`), `recordSent` dedups the legacy side (`cuna-payout.js:172`), and the settle loop iterates `vr.accepted` rather than `r.recorded`, so the journal fills in. The commit message says "no automatic retry path — alerted only"; a manual one exists and should be written into the runbook.
- `dryRun` refusal genuinely covers **all seven** mutating actions including `send` and `void` (probe `p4.cjs` §5 — both 403 before any store read). `routes.js:626` + `:644`.

---

## Answers to the nine questions

1. **Crash between journal-pending and broadcast (`&send=`).** Survives. `runPayoutLoop` (`lib/whirlpool-vault.js:2310`) calls `onPaid({pending:true})` *before* `prep.submit()`; `routes.js:762-779` writes `paid[w] += amount` and `sent[w] = {sig, pending:true}` in one `writeManyVerified` persist. On resume `owedNow`'s `sentSum` covers it (`cuna-payout.js:75`) so it is not re-offered, and `pay.remainingOf` excludes it so a re-run of `&send=` reports "every row already recorded as sent" (`routes.js:758`). **No double-send.** The row does stay unpaid-but-recorded if the broadcast never happened — pre-existing and deliberate (#313: "not found never voids").
2. **Crash after broadcast, before the landed mark.** Survives. Identical state to (1): the signature is already durable in `sent[w]`, `remainingOf` excludes it, and `&sweep=` (`routes.js:722-750`) picks it up on `pending:true` and journals it there. Resume observes the signature; it never re-sends.
3. **Journal-only second pass fails after the legacy row landed (`&send=`).** Money state is consistent. `routes.js:804` only adopts `curBatches`/`curJournal` on success; on failure `:805` alerts and the legacy `sent`/`paid` (already persisted by `onPaid`) stands. Nothing later treats the row as unpaid: `owedNow` uses the legacy witness, `remainingOf` excludes it, the receipt falls back to the legacy shape. Caveats: the row will never be journaled automatically (`&sweep=` skips it, `pending:false`) — manual `&sent=` replay repairs it; and if `writeManyVerifiedMixed` *throws* instead of returning false, the outer `catch` at `routes.js:848` answers **HTTP 400 with no alert at all** — the alert is on the `false` path only.
4. **`writeManyVerifiedMixed` false vs throw.** With the real `lib/kvstore.js` it returns false and never throws, and `setManyVerified` is one `JSON.stringify(state)` file write — so no half-written pair on disk. Two gaps: (a) the fallback branch `store.js:63` (`kv` without `setManyVerified`) loops `setVerified` per key and **is** half-writable — nothing in production hits it, but nothing stops a future kv from doing so; (b) on `false`, the in-memory kv **has** been mutated (P2-4), so "nothing landed" is only true across a restart.
5. **Replay of the same request / same signature.** Exactly one event. `L.settle` (`ledger.js:156-160`) returns `{ok:true, idempotent:true}` for the same key/project/batch/wallet and `transfer_already_consumed` otherwise; `recordSent` dedups the legacy side. Verified both by the shipped test §6 and by the route's own behaviour. The one caveat is that "exactly one event" holds only as long as no concurrent request has erased the event first (P1-1).
6. **A `dryRun` project reaching any write.** No path found. `routes.js:626` computes `mutating` over all seven flags and `:644` refuses with 403 before the store is touched; I confirmed `send` and `void` (which the shipped test does not cover) are both refused, and `batches`/`hub:settle` stay empty.
7. **CUNA legacy keys touched by a registry-project payout.** No. `hubStore.keyFor` (`store.js:27-32`) maps to `cunaStake*` only for `projectId === "cuna"`, the journal key is separate and global, and `projectOf` (`routes.js:138`) resolves only approved registry rows. Confirmed by the shipped test's dump assertion. One latent note: if `cuna` ever *is* registered (the aliasing is designed for it, and CLAUDE.md marks that HELD), the dedicated `/api/cuna-stake/payout` desk at `server.js:12483`/`:12688` calls `owedNow` **without** the journal, so the two desks would disagree the moment the two witnesses diverge (P1-4).
8. **Overpayment.** `excess` is never netted across wallets: `journalApplied` is keyed per wallet (`cuna-payout.js:62-68`), `L.partition` computes `applied = min(paidTotal, accrued)` and `excess` per wallet (`ledger.js:96-104`), and `owedNow` floors at 0 per wallet. Accrued never shrinks — `totalCredits` is a pure sum over `days`, untouched by any settle path, and the shipped test asserts `accruedRaw` is unchanged after a 120-on-100 transfer. The only way the *offered* amount goes wrong is P1-3's `max`, which under-subtracts rather than netting.
9. **Receipt for an unverified transfer.** No fabricated receipt: a journal entry only exists after `locateTransferInstruction` found exactly one matching instruction in a non-errored transaction, and `claims.paymentVerified` is `settlements.length > 0` (`ledger.js:225`). Two softer issues: the gate is per (batch, wallet) rather than per sig (P2-5), and `amountRaw` can understate the transfer (P2-1). A row that was `confirmBatch`-ed (`sig: null`) can never reach the journal-backed path at all.

---

## Assessment of `scripts/hub-settle-route-test.cjs`

It is a real integration gate, not assertion theatre — it mounts the **actual** `routes.mount` closures through a fake Express and drives them end to end, and the `flakyKv` helper (test lines 258-264) correctly distinguishes `lib/kvstore.js`'s real "returns false" contract from `memoryKv`'s throw, which is the distinction most tests in this repo get wrong. Sections 6b (crash + resume on `&sent=`), 7b (lost journal write on `&send=`) and 8 (sweep) do exercise the windows they claim.

**Windows the test does not cover:**
- **Any concurrency.** Every case is strictly sequential. The P0-1 and P1-1 lost-write windows — the ones that actually lose settled money and defeat the cross-project guard — are invisible to it.
- **`&void=` against a journaled row.** `void` is never exercised at all in this file (P1-2).
- **The `owedNow` max-vs-union case (P1-3).** Both `owedNow` tests present exactly one witness; neither has legacy and journal covering *different* rows.
- **Real process death.** "crash + resume" is really "write-returned-false + retry". Nothing simulates dying between `onPaid`'s persist and `prep.submit()`, or between the two `&send=` persists; the fake vault never fails a broadcast (`fakeVault` at test line 236 only models land/stall).
- **The `&send=` journal-write *throw* path** (generic 400, no alert) — only the `false` path is tested.
- **A landed row that journals `journaled:false`** (the ambiguous batched-transfer shape) going through the whole route and leaving a legacy-only row.
- **`writeManyVerifiedMixed`'s non-atomic fallback** (a kv without `setManyVerified`, `store.js:63`).
- **`dryRun` for `send` and `void`** — the loop at test line 275 covers only export/sent/sweep/confirm/cancel. (I checked; both are refused.)
- **What the in-memory kv holds after a `false`** — section 3 asserts nothing landed, but only for the *throwing* kv; with the real `setManyVerified` semantics the memory copy is dirty (P2-4).

## Suggested order of work
1. Make the journal append-only at the kv level: one key per `xferKey`, written with `setManyVerified` alongside the project parts. That kills P1-1 outright and removes the journal from P0-1's blast radius. `lib/kvstore.js` already has `entriesWithPrefix` for reading them back.
2. Serialise the payout route per project (extend `bp.lockAcquire` to the whole handler, not just `send&run=1`, and hold it across the journal write). That is the actual fix for P0-1 and should probably ship regardless of (1).
3. Make `&void=` refuse a journaled row.
4. Change `owedNow` to a per-row union.
5. Pass the journal to `lib/hub/engine.js:242` `walletView` and the other `owedNow` call sites, or explicitly document why the holder view uses the legacy witness.
6. Use `inst.parsed.info.amount` for the settlement's `amountRaw`.


## Round 2 — re-verification of the fixes (commits 1091ff9..9faa6af), one lens

# Re-verification of PR #342 (`claude/hub-settlement-journal`, `1091ff9..9faa6af`)

Read-only. Nothing edited, committed, pushed, or sent to any server (`git status --porcelain` is empty apart from the pre-existing `node_modules` symlink). All work was in `/tmp/claude-0/.../scratchpad/journal` plus my own probe harness in `/tmp/claude-0/.../scratchpad/verify2/` (`h.cjs`, `q1`–`q8`), which mounts the **real** `routes.mount` closures through a fake Express and drives them with synthetic `jsonParsed` transactions — same DI style as the shipped tests, no network.

**Verdict: not clean. One P1 from the original report reproduces verbatim, one P0 is narrowed rather than closed, and the fix introduced three new issues — one of which makes the money diff unreviewable in the PR itself.**

Repo suites re-run, all green: `hub-settle-route-test` (44), `hub-receipt-page-test` (3), `payout-verify-test` (11), `cuna-payout-test` (30), `hub-core-test` (34), `hub-attempts-test` (11), `hub-public-test`, `hub-schema-test`, `reproduce-receipt-test` (20), `traction-test` (39), `hub-engine-test` (17), `hub-commit-test`, `hub-brand-test`.

---

## OPEN

### 1. adv P1-3 — the phantom-excess receipt forgery reproduces. **OPEN (P1)** — same outcome, different request shape
`lib/hub/routes.js:761` — `if (!r.recorded.includes(x.wallet))` — is a **per-WALLET** guard, not per-row. `pay.recordSent` records a wallet once from the first row; every *later* row for that same wallet **in the same request** still satisfies `r.recorded.includes(...)` and is journaled in PASS 3. The fix only closed the two-request version of the attack.

Ran (`verify2/q7.cjs` §7a): row settled legitimately for 1.0, then one `&sent=` carrying **both** `{W, sig_good}` and `{W, sig_extra}` where `sig_extra` is a genuine 50-token funding-wallet transfer to the same wallet:
```
journal entries: 2
  {sig:5wdmub, amt:1000000000,  applied:1000000000, excess:0}
  {sig:5xenvc, amt:50000000000, applied:0,          excess:50000000000}
receipt totals: {owedRaw:1000000000, appliedRaw:1000000000, excessRaw:50000000000, ...}  settlements: 2
partition:      {accruedRaw:1000000000, paidTotalRaw:51000000000, excessRaw:50000000000, availableRaw:0}
```
That is the original finding's literal outcome — *"it claims the project paid this holder 51 tokens against a 1-token obligation"* — plus P2-7's permanent poisoning of the holder's Addendum-B `available`. `owedNow` is unaffected (`appliedRaw` is 0), so it is receipt/ledger forgery, not a double-pay — exactly as P1-3 was originally scoped. Repeatable and unbounded.

Two-request variant IS closed (verified, `q4.cjs` §4a: both a stranger's and a genuine funding-wallet extra transfer are refused on a second request, journal stays at 1 entry, `excessRaw:"0"`).

Fix shape: make the PASS-3 guard per (wallet, sig) rather than per wallet, or refuse in `lib/hub/ledger.js:163-164` when `remaining === 0n` instead of writing an `applied:0` entry.

### 2. `lib/cuna-payout.js` is now a **binary file in git** — the money diff is unreviewable. **OPEN (process blocker)**
Commit `6841638` (the `owedNow` per-row-union fix) embedded **3 raw NUL bytes** as the row-key separator:
```
lib/cuna-payout.js:77   const k      = String(e.batchId) + "\0" + String(e.wallet);
lib/cuna-payout.js:88   const rowKey = String(b.id)      + "\0" + w;
lib/cuna-payout.js:108  const w = rowKey.slice(rowKey.indexOf("\0") + 1);
```
(byte offsets 4318 / 4690 / 6061; `file` reports `data`; parent `1091ff9` was clean `UTF-8 text`).

Consequence, verified: `git diff 1091ff9..HEAD -- lib/cuna-payout.js` → `Binary files a/... and b/... differ`, `--numstat` → `-  -`. **The change to the function that decides what every holder is owed is invisible in PR #342 to a human reviewer, to Codex, and on GitHub.** `node --check` passes, so nothing catches it.

Functionally the separator is fine (batch ids are `hb_<hex>`, so NUL can't collide) and arguably better than a space — but a raw NUL is fragile under any text round-trip (an editor, `sed`, a lint autofix) that would silently drop it and collapse the key to `batchId+wallet`, a silent collision. Change the three literals to `" "` (identical runtime string, file stays text) and the diff becomes reviewable with zero behaviour change.

---

## NARROWED

### 3. adv P0-1 — source check holds against a stranger, but a project's **own operator** can re-open it via `fundedBy`
Closed for everything the report demonstrated *without* an operator act (see CLOSED list). What remains: `lib/hub/routes.js:681` resolves the allowed source set from the program version's `fundedBy`, and `lib/hub/project.js:147` validates `fundedBy` entries for **base58 shape only** — no ownership, authority or relationship check. `lib/hub/routes.js:226-232` lets a **non-owner operator** (desk token + paid/comped access) publish a version, and `lib/hub/project.js:200-206` allows `effectiveFrom = today` whenever the current version is older, so it takes effect immediately.

Ran end to end (`verify2/q1h.cjs`), all through the real routes with `adminAuthOK: () => false` and a real `operator.issueToken`:
```
control: stranger's transfer refused (transfer_not_from_funding_wallet)
operator (as=<its own wallet>, not owner) POSTs /admin?terms=1&fundedBy=<FUND>,<STRANGER>&effectiveFrom=<today>  -> 200
same stranger transfer, resubmitted -> recorded:[W], journaled:true, owedNow[W] = 0
alerts raised in the whole sequence: []
```
Mitigations that do apply: it is a deliberate, published act — the wallet lands in the version's `terms.fundedBy`, in `exclusions.wallets` (`project.js:150`), and inside the version `hash` that every receipt cites. It is auditable after the fact; it is not prevented, and nothing alerts.

Also note `fundedBy`'s documented meaning is *"wallets whose own vesting unlock feeds the daily pool"* (`schema/program-version.schema.json:29`) — the fix repurposes it as the payment-source allowlist, so widening the payout allowlist and changing the pool arithmetic are now the same lever. Worth a separate `payoutSources` term, or owner-only approval for `fundedBy` changes.

### 4. NEW — the source check now refuses **our own managed-payer broadcasts**
`&send=` and `&sweep=` pass `fundingWallet: p.fundingWallet` to `settle.settleAndPersist` (`routes.js:831`, `:903`) even though those signatures are ones *we* broadcast. The managed payer signs with the vault project's operator key (`MM_OPERATOR_SECRET_*`), which is generally **not** `p.fundingWallet`.

Ran (`q7.cjs` §7b, vault wallet ≠ fundingWallet):
```
send report journal: [{journaled:false, why:"transfer_not_from_funding_wallet"}]
journal entries: 0          legacy paid row: 1000000000 (money did move)
alert: "alpha: batch … wallet 4Gccq9… paid but journal refused it — transfer_not_from_funding_wallet"
```
§7c confirms it journals normally when the vault signs from the funding wallet, and §7d confirms `&sweep=` behaves the same way. Not a money loss (legacy record intact, operator alerted), but **every managed-payer project silently stops issuing receipts** — the exact surface the hackathon pitch points at. Either add the managed payer's wallet to the allowed set on the `&send=`/`&sweep=` paths (our own signature, already trusted), or document that a managed-payer project must list it in `fundedBy`.

### 5. NEW — the "fraud signal" alert added by `ca082c1` is effectively unreachable for the two `why` values it names
`routes.js:743` alerts on a PASS-1 hard refusal. But `payoutVerify.verifyBatchRows` now catches **both** named cases first and drops them into `vr.rejected` **silently**: `rowPaidBy` returns `transfer_not_from_funding_wallet` (`payout-verify.js:75-76`), and `sigAlreadyUsed` catches cross-project reuse via the journal (`payout-verify.js:100-106`).

Ran: `q1.cjs` §1a/§1b (stranger top-level and DEX inner-CPI) → `alerts: []`. `q8.cjs` §8a (cross-project signature reuse) → `alerts: []`. The only hard refusal that does alert is `row_not_in_batch` (`q8.cjs` §8b, confirmed firing). So the refusal works; the *visibility* the commit message claims does not. Move the alert to cover `vr.rejected` entries whose `why` is one of the fraud values.

### 6. NEW (P3) — `hub:settle:` prefix collides with the new lock keys
`hubStore.JOURNAL_PREFIX = "hub:settle:"` (`store.js:30`) vs the lock keys `hub:<project>:payout` (`routes.js:662`) and `hub:<project>:<batchId>` (`routes.js:883`). A project whose id is literally `settle` (allowed by `ID_RE`) puts its lock inside the journal's prefix. Ran (`q3.cjs` §3f):
```
readJournal() -> { "settle:payout": { at: 1789739056791, token: "held" } }
```
Traced the impact: `sigAlreadyUsed`, `owedNow`, `L.settle` and `findReceipt` all skip it (no `sig`/`projectId`/key match), so no money effect — but `lib/traction.js:288-291` increments `journalLifetime` for it (public receipts-issued counter) and `reconcile`'s `consumedGlobalCount` is inflated. Reserve the id, or prefix the locks `hublock:`.

---

## CLOSED (one line each — what I ran)

**adv P0-1 (the non-operator half)** — `q1.cjs`: stranger's top-level transfer → `transfer_not_from_funding_wallet`, nothing recorded, no legacy `sent` row, `paid` untouched, `owedNow` still 1000000000; DEX-shaped inner-CPI from a stranger → same; `blockTime` +10 years → refused (`payout-verify.js:62`, `:226`); a source account absent from `preTokenBalances` fails **closed**; and the opposite direction holds — a genuine funding-wallet transfer delivered via an **inner CPI** is accepted and journaled at `{instructionIndex:0, innerIndex:0}` (`payout-verify.js:193-216` reads the source owner from `meta.preTokenBalances`, never the instruction's `authority`).

**adv P0-2 (two projects, one shared reward mint)** — `q2.cjs` §2a: alpha settles; beta's reuse of the same signature is refused, **no** legacy `sent` row, **no** `paid` entry, **no** attempt stamp, journal still 1 entry; after cancelling beta's batch `owedNow` still offers the full 1000000000.

**adv P0-2 — "does the refused row leave ANY legacy trace?"** — `q2d.cjs`: byte-diff of the whole kv across the refused request shows only `program:beta:batches` gaining `"sent":{}` and `program:beta:paid` being created as `{}`. Semantically inert — `owedNow` reads `b.sent[w]` → undefined, `remainingOf` unchanged, batch stays `pending`. No meaningful trace.

**adv P0-2(b) void + cancel + resubmit / crash P1-2** — `q2.cjs` §2b: void of a journaled row is refused naming the `xferKey` (`routes.js:803-805`), `paid` not rolled back, legacy row survives; after cancel + a new batch, resubmitting the same signature is refused (`sigAlreadyUsed` now consults the global journal). §2c: a legacy-only (attribution-failure) row can **still** be voided — the escape hatch is intact.

**crash P0-1 / P1-1 (concurrency)** — `q3.cjs`: two projects interleaved on a stalled `getTx` → **both** journal entries, both legacy `sent` rows and both `paid` entries survive, and the cross-project consumed guard still sees the sibling's entry afterwards (per-transfer kv keys, `store.js:30-34`, `:94-104`). Two overlapping requests on the **same** project → the second gets **409 busy** (not a silent lost write), retries cleanly after release, both entries land, `owedNow` re-offers nothing. A flag-less GET is never blocked.

**crash P0-1 — lock release on throw / deadlock** — `q3.cjs` §3d: a throwing request answers 400, alerts (`routes.js:953`) **and** releases the lock in the `finally` (`routes.js:955-957`); §3e: a lock left by a dead process blocks for at most `LOCK_TTL_MS` = **10 min** (`store.js:153`) and then expires — no permanent deadlock. `store.lockAcquire` is fully synchronous with a check-after-write token re-read (`store.js:154-162`), so it is correct against both the event loop and a second process through `kvstore.refresh()`.

**crash P1-3 (`owedNow` per-row union)** — `q4.cjs` §4b: the report's exact 200/two-batch case (batch1 journal-only, batch2 legacy-only) now returns **0 owed**; the old per-wallet max would have re-offered 100. §4c: an orphaned journal row (batch purged) still settles. §4d: one row seen by *both* witnesses is subtracted **once** (100 left of 200) — no over-subtraction.

**crash P1-4 (walletView vs desk)** — `q4.cjs` §4e/§4f: with only the journal witness present, `eng.walletView` and the payout desk both report 0 (without the journal it would say 1000000000); the live `GET /api/hub/:project/holder` (`routes.js:485-487`) passes the journal and returns `owedRaw: 0`. All three Hub `owedNow` call sites now pass it (`routes.js:347`, `:923`, `engine.js:247`); the three `server.js` ones are the dedicated CUNA desk, commented as intentionally journal-free.

**adv P1-4 (receipt page)** — `q5.cjs` §5a drives the **real end-to-end path** the shipped test does not cover (real route settle → real `pub.stakeView`/`projectView`/`findReceipt` → the exact `server.js:7957` transform → `public/hub.html`'s real inline script in a vm): the wrapper is present (`projectId/symbol/dryRun/brand/program/receipt`), the page renders with **no error card**, real signature, real amount, no `NaN`/`undefined`. §5b: the legacy shape still renders. `scripts/hub-receipt-page-test.cjs` asserts three things — no `class="err"` card, and that the sig / shortened wallet / state / amount / (for the 3-settlement case) `Every settlement (3)` + both earlier sigs are present — against **hand-built** API bodies, which is why I re-ran it against the real ones.

**adv P1-5 / crash P2-1 (amount)** — `q5.cjs` §5c + `q5c.cjs`: for a transaction where the wallet receives 1.0 at instruction 0 and separately sends 0.4 of the same mint, `locateTransferInstruction` returns `amountRaw: "1000000000"` (the instruction's own amount, not the 600000000 net delta) and the journal entry through the real route carries `{amountRaw:"1000000000", appliedRaw:"500000000", excessRaw:"500000000"}`; a zero/negative net delta is still refused (the floor at `payout-verify.js:261-262`).

**`GET /api/hub/:project/reconcile`** — `q6.cjs`: byte-identical kv dump before/after (**writes nothing**); reports the manufactured divergence correctly; body carries only `projectId / as / journalEntries / consumedGlobalCount / divergent[{batchId, wallet, legacySent, journalSettled, legacySig, legacyManual, xferKeys}]` — no operator key, no token, no balances or amounts. Unauthenticated → 404; a forged `op` token → 404; **another project's** valid operator token → 404; the project's own operator → 200; a lapsed project's operator → 200 (read-only, correct).

**The lock's 409 path** — `q6.cjs` §6d/§6e: an unauthenticated mutating request is refused at `routes.js:640` **before** `lockAcquire` and never takes the lock; a `dryRun` project is refused 403 at `:653`, also before the lock; the 409 body discloses only `since`/`ageMs`, never the lock token.

**adv P2-6 (sig trim)**, **crash P2-9 (`finalized`)**, **P2-2 (reconcile exists)**, **P2-3/P2-4 (alerts on unjournalable rows and on a throw)** — covered by the shipped suite (§19-21) and re-confirmed green; `getTx` commitment change verified at `server.js:8165`. Per-entry journal keys are genuinely safe against a concurrent process: `lib/kvstore.js:103-113` `setManyVerified` calls `refresh()` (re-reads disk) before setting only the named keys.

---

## Recommendation

Do **not** merge as-is. Two blockers, both small:

1. **adv P1-3** — one-line class of fix in `routes.js:761` (guard per `(wallet, sig)`) or `ledger.js:163` (refuse `remaining === 0n`), plus a test case that puts two signatures for one wallet in a single `&sent=`.
2. **`lib/cuna-payout.js` binary** — replace the three raw NULs with `" "`, so the owedNow money change can actually be reviewed before it ships. This one matters on its own: the PR is currently asking for a sign-off on a diff nobody can see.

Then the owner's call on #3 (`fundedBy` as an operator-settable payment-source allowlist) and #4 (managed-payer receipts) — neither loses money, but #4 silently kills receipts on the managed path and #3 leaves the original P0-1 outcome reachable by the actor the finding named.
