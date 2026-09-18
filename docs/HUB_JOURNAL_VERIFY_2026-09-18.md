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
