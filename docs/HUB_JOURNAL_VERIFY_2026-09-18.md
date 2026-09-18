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


---

## Round 3 — re-verification of fix round 2 (one Opus lens, read-only, 2026-09-18 ~14:40 UTC)

Verdict: item 1 (phantom excess) OPEN as P1 — the fix is order-dependent; items 2–5 CLOSED; item 6 journal half
CLOSED, page-shadowing half OPEN as P3. Three new P2 findings (N1–N3), two P3 (N4–N5). Fix round 3 follows.

READ-ONLY re-verification of PR #342 (`claude/hub-settlement-journal`, fixes `15f2bb0..7f547e6`). Nothing edited, committed or pushed; `git status --porcelain` in the worktree is unchanged (only the pre-existing `node_modules` symlink). All probes in `/tmp/claude-0/-home-user-cluck-norris-school/bcde813f-e57f-5571-b70a-272b73ac59d7/scratchpad/verify3/` (`h.cjs` copied from verify2, `p1.cjs`, `p1x.cjs`, `p25.cjs`, `p3.cjs`, `p456.cjs`), driving the REAL `routes.mount` closures through a fake Express with synthetic jsonParsed transactions. Only port 3260 was used (the guard test).

## THE SIX

### 1. adv P1-3 single-request phantom excess — **OPEN (P1)**
The fix closes the *applied:0 second entry*, not the reported harm. **Swap the order of the two rows in the same `&sent=` array and the original outcome comes back verbatim.**

Repro (`verify3/p1.cjs` §1b, run): project `alpha`, holder W owed 1.0; two genuine funding-wallet transfers to W exist — `sig_good` = 1.0, `sig_extra` = 50.0 (an unrelated transfer, e.g. an OTC sale or giveaway from the funding wallet).
```
POST /api/hub/alpha/payout?batch=<id>&sent=[{W,sig_extra},{W,sig_good}]     ← extra FIRST
→ journal: [{sig:5xenvc, amt:50000000000, applied:1000000000, excess:49000000000}]
→ receipt totals: {owedRaw:1000000000, appliedRaw:1000000000, excessRaw:49000000000}
→ partition:      {accruedRaw:1000000000, paidTotalRaw:50000000000, excessRaw:49000000000, availableRaw:0}
→ ignored: [{wallet:W, sig:sig_good, why:"row_already_settled"}]      ← the REAL payment is now permanently unjournalable
```
Why: PASS 1 (`lib/hub/routes.js:791-806`) walks `vr.accepted` **in the caller's order**, carrying `trialJournal`; the first row wins the row, the `remaining === 0n` refusal at `lib/hub/ledger.js:171` then kills the genuine one. `recordSent` records `sig_extra` as the row's signature, so the new per-(wallet,sig) guard at `routes.js:828-829` happily journals it. The shipped regression test (`scripts/hub-settle-route-test.cjs:942-966`) pins **only** the good-sig-first ordering — swapping the two array elements in that test fails it.

Worse, `verify3/p1x.cjs` (run): after 7 more days of accrual the partition reads `{accruedRaw:8000000000, paidTotalRaw:50000000000, excessRaw:42000000000, availableRaw:0}` while the legacy desk `owedNow` still says `7000000000` — the excess permanently absorbs ~49 tokens of that holder's future accrual in the Addendum-B view and the two witnesses now disagree. `owedNow` is unaffected (no double-pay), so this is receipt/ledger forgery + a holder-facing denial, reachable by any project **operator** (`&sent=` is operator-or-owner).

Same outcome with a single row and no stapling at all (`p1.cjs` §1f): one oversized genuine transfer reported as the row's settlement gives the identical `excessRaw:49000000000` receipt. So the "no phantom excess" claim only holds for one of three request shapes.

Attacks that did NOT work (all run): good-sig-first (§1a, 1 entry, excess 0); same sig twice (§1c, one entry, `paid` counted once); one signature split across two instructions to the same wallet (§1d, attribution failure, nothing journaled); leading/trailing whitespace variants of the sig (§1e, still one entry); the two-request variant (§1g, `row_already_settled`); `owedNow` never re-offers (§1h, `0`).

### 2. `lib/cuna-payout.js` NUL → `" "` — **CLOSED**
`file` reports UTF-8 text, `grep -rlP '\x00' lib/ server.js` is empty. The composite key is built in exactly two places and parsed in one, all in this file, all `" "`: `lib/cuna-payout.js:77` (`String(e.batchId) + " " + String(e.wallet)`), `:87` (`String(b.id) + " " + w`), `:107` (`rowKey.slice(rowKey.indexOf(" ") + 1)`). No other module builds or consumes it (the journal stores `batchId`/`wallet` separately). Byte-identical for the same row (`verify3/p25.cjs` §2a). Collision needs a space in a batch id or a wallet: batch ids are generated only at `lib/hub/routes.js:1004` (`hb_`+hex), `server.js:12712` (`cb_`+hex) and `lib/hub/demo-fixture.js:128` (`demo-batch-1`) — never caller-supplied (`b.batch` only *looks up*); wallets are base58 keys of `batch.amounts`. See new finding N5 for the residual.

### 3. `payoutSources` allowlist — **CLOSED** (for the stated attack)
- The round-2 operator attack is dead: an operator publishing `?terms=1&fundedBy=<FUND>,<STRANGER>` still gets 200, but the stranger's transfer is now refused `transfer_not_from_funding_wallet` and alerted (`p3.cjs` §3a) — `routes.js:711` reads `p.payoutSources`, never the version term.
- A self-serve application cannot declare it: `lib/hub/project.js:100` hard-sets `payoutSources: []`, so `apply.validateApplication` and `apply.approve` both produce `[]` even when the applicant sends `payoutSources` at project and terms level (`p3.cjs` §3b).
- Owner path only: `/api/hub-registry` 404s an operator token (`p3.cjs` §3f); the whole handler is behind `adminAuthOK` (`routes.js:153`). Set/clear works, alerts, and grows `payoutSourcesHistory` (`routes.js:211-218`); an unrelated owner edit with no `&payoutSources=` carries it forward unchanged (`routes.js:219-220`, verified §3c). No `/admin`, access-payment, suspend or milestone write drops it (they all spread `reg[p.id]`).
- `fundingWallet` is owner-only and a change **fails closed** on in-flight batches — the open batch's settlements are then refused `transfer_not_from_funding_wallet` (`p3.cjs` §3g), never widened.
Two residuals are filed as new findings N2 (the one path that *does* wipe it) and N3 (it is invisible in every API read).

### 4. Managed-payer allowance — **CLOSED**
`p456.cjs`, all run: `&send=` journals its own broadcast (§4a); `&send=&from=treasury` does **not** accept a different vault project's operator wallet (§4b, refused + alerted) — `routes.js:977` adds only `vaultOperatorPubkey(from)`; no `&sent=` shape reaches the allowance, including `&sent=…&from=treasury` and `&sent=…&send=&sweep=` in one request (§4c) — `routes.js:793` passes the narrow `fundedBy`. `vault.operatorPubkeys()` (`lib/whirlpool-vault.js:295-298`) derives only from `Keypair.fromSecretKey(process.env[proj.operatorEnv])`, so it is env-only, never kv- or attacker-supplied (`registerProject` sets `operatorEnv` but cannot create the secret). With no key loaded (`MM_OPERATOR_SECRET` unset) `operatorPubkey()` is null → the journal refuses and the operator is alerted (§4e); a throwing `operatorPubkey` is caught by `routes.js:723-724` and the request still 200s (§4f). Residual widening on `&sweep=` filed as N4.

### 5. Fraud alerts — **CLOSED** (with one caveat, and see N1)
Both named `why` values now fire: `transfer_not_from_funding_wallet` (`p3.cjs` §3a) and the PASS-1 refusals (`routes.js:772-776` runs before PASS 1, on `vr.rejected`). A refused row advances **no** durable state: the only kv keys touched by a fully-refused request are `program:alpha:batches` and `program:alpha:paid` gaining empty `sent:{}`/`{}`, no journal entry, and `milestones.firstBatchSignedAt` stays null (`p25.cjs` §5c). The alert's return value is **not** checked (`try { alert(...) } catch(_) {}`, and `hubAlert`→`cunaOpsAlert`→`tgSend` swallows) — acceptable under CLAUDE.md only because nothing durable is gated on it: an `alert` that throws neither fails the request nor records the refused row (`p456.cjs` §5a). The lost-signal risk is silent, and the volume problem is N1.

### 6. Lock-key prefix collision — **OPEN (P3)**, journal half closed
Journal half is genuinely closed: the payout lock is `hublock:alpha:payout` and the only key under `hub:settle:` is the real entry (`p456.cjs` §6b); a lock row parked under the prefix is skipped by `looksLikeJournalEntry` (`lib/hub/store.js:102-109`); the shape check does **not** drop legitimate data — a real entry round-trips through the legacy `JOURNAL_KEY` blob, and `git log -p lib/hub/ledger.js` shows the entry shape (`xferKey`/`projectId`/`batchId`/`wallet`/`amountRaw`/`appliedRaw`) unchanged since `55db277`, so no upgrade can lose an entry. `"settle"` is refused by `lib/hub/project.js:31,136`.
What is still open is the other half of the question — **page shadowing**. `reserved()` (`server.js:8160`) covers only `clkn/cuna/rose/demo/demo-b`, and `RESERVED_PROJECT_IDS` only `settle`. Repro (`p456.cjs` §6a): `approveProject` **allows** the ids `apply`, `verify`, `status`, `wallet`, `trust`, `judge`, `schema`, `registry`, `hub`. On this branch `app.get("/hub/apply")` (`server.js:8082`) is registered before `/hub/:project` (`:8092`), so a project approved as `apply` has no public page — its receipts and program page 200 with the application form. On `origin/claude/colosseum-batch-9` the same is true for `verify` (`:8319`) and `status` (`:8463`) ahead of `/hub/:project` (`:8477`). No money effect; availability/trust only.

## NEW FINDINGS (ranked)

**N1 (P2) — one operator-room alert per refused row, no cap, no rate limit.** `p456.cjs` §5b: a single `&sent=` with 23 stranger-sourced rows raised **23** alerts. `&sent=` accepts up to 500 rows (`routes.js:757`), `/api/hub/:project/payout` is not rate-limited (`limited()` is applied only at `routes.js:309, 319, 514, 568`), and `cunaOpsAlert`'s 6h dedupe key is `"hub:" + msg.slice(0,40)`, which differs per wallet — so one request can push 500 distinct Telegram messages into the operator room, repeatable. Cap the per-request fraud alerts to one summary line.

**N2 (P2) — approving an application over an existing project takes it over and wipes the allowlist.** `p25.cjs` §3h + `p3.cjs` §3d: `proj.approveProject` returns `{...project}` (`lib/hub/project.js:154`), preserving only `access`/`milestones`, and `apply.approve` builds `project` from the applicant's own fields. An application submitted with an existing project's `id` **and** `mint` (both checks at `project.js:139-146` pass) replaces `fundingWallet` and `operatorWallets` with the applicant's and resets `payoutSources`/`payoutSourcesHistory` to `[]` — so the allowlist history is not append-only across this path. Gated by the owner's click and by `routes.js:170-172` (409 once the project has program versions), so it only bites a registry-seeded, not-yet-termed project; it fails closed on the allowlist but fails **open** on who owns the project.

**N3 (P2) — the allowlist is invisible and the receipt still names the funding wallet.** `publicProject` (`routes.js:71-78`) omits `payoutSources`, so no API read — not even the owner's own `/api/hub-registry` response — echoes it (`p3.cjs` §3c); the only trace is the set-time alert and console line. Meanwhile `L.receipt` returns `fundingWallet: project.fundingWallet` (`lib/hub/ledger.js:245`) and the journal entry records no source at all (`p3.cjs` §3e: entry keys are `xferKey,sig,instructionIndex,innerIndex,projectId,batchId,rowId,wallet,amountRaw,appliedRaw,excessRaw,slot,at,verifiedBy`) — so a settlement paid by an allowlisted third wallet is publicly indistinguishable from one paid by the funding wallet. Echo `payoutSources` in `publicProject` and record the verified `sourceOwner` on the entry.

**N4 (P3) — `&sweep=` accepts *any* vault project's operator wallet.** `routes.js:899` (`fundedByForSweep = [...fundedBy, ...vaultOperatorPubkeys()]`): `p456.cjs` §4d journals a row for project `alpha` against a transfer signed by an unrelated vault project's operator wallet. Only `&send=` (owner-only) can create the pending row a sweep acts on, so it is owner-gated in practice — but combined with N3 the resulting receipt cannot be audited for it.

**N5 (P3) — the orphan-journal parse is asymmetric with the builders.** `lib/cuna-payout.js:107` splits on the **first** `" "` while `:77`/`:87` append it; `p25.cjs` §2b: a journal row whose batch was purged and whose `batchId` contains a space is attributed to a non-existent wallet, and `owedNow` then re-offers the full `1000` instead of `0`. Unreachable today only because every batch id is generated `hb_`/`cb_` hex, and nothing asserts that invariant (the same asymmetry existed with NUL).

## TEST VERDICTS (verbatim last line of each run)
- `node scripts/hub-settle-route-test.cjs` → `all passed (59 passed)`
- `node scripts/hub-core-test.cjs` → `all passed (34 passed)`
- `node scripts/payout-verify-test.cjs` → `all passed (11 passed)`
- `node scripts/traction-test.cjs` → `all passed (39 passed)`
- `node scripts/cuna-payout-test.cjs` → `all passed (30 passed)`
- `GUARD_TEST_PORT=3260 node scripts/mutating-get-guard-test.cjs` → `all passed`


---

## Round 4 — re-verification of fix round 3 (one Opus lens, read-only, 2026-09-18 ~15:30 UTC)

Verdict: all seven round-3 items CLOSED; merge-ready on the P0/P1 rule. New: N-1 (P2, alert dedupe watermark
written before the send and a 40-char key that collapses across batches), N-2 (P2, a suspended never-termed id is
takeable by a self-serve application and inherits the old ledger), N-3/N-4/N-5 (P3). N-1, N-2 and N-3 are fixed in
fix round 4 before merge; N-4 is documented; N-5 is pre-existing and outside this PR (tracked for a later batch).

READ-ONLY adversarial re-verification, round 4 — PR #342 (`claude/hub-settlement-journal`, HEAD ae7d80e). Nothing was edited, committed or pushed; the worktree is clean (`git status --porcelain` shows only the pre-existing untracked `node_modules`). Probes live in `/tmp/claude-0/-home-user-cluck-norris-school/bcde813f-e57f-5571-b70a-272b73ac59d7/scratchpad/verify4/` (`h.cjs` harness — the verify3 one with `fakeApp` fixed to take the LAST handler argument, because the round-3 fix added a `limited()` middleware in front of `/api/hub/:project/payout` that the old harness would have executed as the handler — plus `q1..q5.cjs`, 69 assertions). Ports 3323–3325 only.

## Item verdicts

**1. Exact-amount rule — CLOSED.**
- Enforcement is `lib/hub/ledger.js:185` (`if (exactOnly && amount !== remaining) return { error: "amount_mismatch" }`), set unconditionally by the only live caller, `lib/hub/settle.js:64`; selection is the order-independent per-wallet grouping at `lib/hub/routes.js:908-960` (probe → refuse-all on no exact match → earliest-slot wins on a tie → `duplicate_settlement_candidate` for the rest).
- Re-ran §1a/§1b/§1f: good-first, extra-first and single-oversized all produce one entry (or none) with `excessRaw:"0"`, identical receipts and partitions either way (`q1.cjs` 1A).
- Two rows for one wallet across two batches, two transfers: submitting both against batch 1 settles only the exact one; the other is refused and can still settle **its own** row in a later request (`q1.cjs` 1B). A wallet cannot hold two rows *inside* one batch — `batch.amounts` is keyed by wallet.
- A partial row cannot be created on the live path at all: with `exactOnly`, `applied === remaining`, so `remaining` goes straight to 0. The only way one exists is a pre-`exactOnly` or hand-written journal entry — see N-3.
- Cross-project reuse of an exact-amount transfer is still refused, at `payoutVerify.verifyBatchRows` (`TRANSFER_ALREADY_CONSUMED_WHY`), before PASS 1; nothing journaled, no legacy row (`q1.cjs` 1D).
- An exact transfer from an allowlisted `payoutSources` wallet settles and records `sourceWallet`; the receipt's `paidFrom` is that wallet while `fundingWallet` stays the project's (`q1.cjs` 1E).
- Amount shapes: leading zeros / a JS number / a float normalise to the same `amountRaw` and settle; `1e21` (a number that stringifies to `"1e+21"`) and a decimal string fail closed at `lib/payout-verify.js:16` `big()` and settle nothing (`q1.cjs` 1F). A `remaining`-0 or zero-amount row is `row_not_in_batch` / `row_already_settled`, never journaled (`q1.cjs` 1G).
- `&sweep=` and `&send=` journal their own broadcasts under the same rule: a managed-payer broadcast of the exact amount settles, the recipients list carries `amountRaw` (no ui→raw float round trip — `lib/whirlpool-vault.js:2179-2183` prefers `amountRaw`), and `&send=` pins the source to the named vault's operator, `&sweep=` to `vaultProject` only (`q2.cjs` 2A–2D).
- `excessRaw !== "0"` is unreachable on the live route. The only two `L.settle()` callers without `exactOnly` are `lib/hub/attempts.js:96` (`reconcile()` — the design-§4 browser-wallet flow, called from no route: `registerAttempt`/`reconcile` have zero callers in `lib/` or `server.js`) and `lib/hub/demo-fixture.js:138` (in-memory fixture, and it passes `amountRaw = batch.amounts[wallet]`, i.e. exact by construction).
- `owedNow` never re-offers or double-counts after a refusal: a refused row gets no legacy `sent` write (PASS 2 only sees `passed`), stays held by its pending batch, and owed reads 0 (`q1.cjs` 1A/1B, `q4.cjs` X-1). `&void=` on a journaled row is refused and `paid` is untouched, including when settle and void ride in the same request (`q4.cjs` X-2/X-3).

**2. One alert per request + rate limit — CLOSED at the route; see N-1 for delivery.**
`lib/hub/routes.js:754` wraps the payout route in the same `limited()` helper (`routes.js:148` → server.js `rateLimit`, per-IP, `server.js:3709-3732`) as every other write route on the mount: bucket `hubpayout`, `windowMs 60000`, `max 30` — same numbers as the three `pay` buckets, `hubapply` is 12 (`q3.cjs` 2-1/2-2/2-3). A 429 short-circuits before the handler, so no batch and no alert (`q3.cjs` 2-4). 400 stranger-sourced rows in one request raise exactly **one** summary alert (`q2.cjs` 2E); sweep and send collapse the same way. The alert fires **after** `writeManyVerifiedMixed`, is wrapped in try/catch, and an `alert` that throws leaves the journal and the legacy row intact with a 200 (`q2.cjs` 2F) — no durable state depends on it. A flood still needs an operator token or the owner key (`authOf` runs before any alert).

**3. Application takeover (409) — CLOSED for approved projects (one deliberate carve-out → N-2).**
`lib/hub/project.js:169-186` refuses a reserved id, a built-in id/mint, an existing mint under another id, and — with `requireNew`, set only by `lib/hub/apply.js:80` — an existing id (`code: "project_exists"` → 409 at `routes.js:287`). Owner registry create lowercases the id (`routes.js:239`) and `ID_RE` is lowercase-only, so no case-insensitive takeover; a whitespace-padded or case-flipped mint fails `addr()` outright (`q3.cjs` 3-1…3-7). The route adds a second guard: an application onto a project that already has program versions is 409 even when that project is *suspended* (`q4.cjs` 3-9/3-10). Demo seeding never touches the registry (`lib/hub/demo-fixture.js` is in-memory only) and the boot backfill `seedPokeDryRun` (`server.js:14469`) returns early if `reg.poke` exists.

**4. `payoutSources` public / history owner-only / `paidFrom` — CLOSED.**
`publicProject()` (`routes.js:79-88`) always echoes `payoutSources` and adds `payoutSourcesHistory` only under `{full:true}`, passed at `routes.js:227` and `routes.js:282` — both inside the `adminAuthOK`-gated `/api/hub-registry`. I called **every** mounted handler with a real operator token (GET and POST) and grepped each response body: zero occurrences of `payoutSourcesHistory`; the owner's registry read does carry it (`q3.cjs` 4-1/4-2). `paidFrom` is `located.sourceWallet` — the source token account's **owner** from `preTokenBalances`, never the instruction's `authority` and never the request: a `&sent=` row carrying `sourceWallet`/`paidFrom`/`from` claims is ignored and the verified `fundingWallet` wins (`q3.cjs` 4-3). The receipt schema change is purely additive (`sourceWallet`, `paidFrom` added to `properties`; both absent from `required`), so the `additionalProperties:false` blocks still validate — `hub-schema-test`, `reproduce-receipt-test` and `hub-receipt-page-test` all pass. The browser bundle is unaffected: `hub-verify-src/entry.js` imports only `reproduce`, `reproduceBuyCompRow`, `buildBatchInputs`, `validate`, `canonicalJson`, `versionHashInput`, `splitBundle`, `verifyBundleHash` — all still exported, and this branch's `reproduce.js` changes are optional trailing params (`journal`, `programState`); `public/hub-verify.html` **fetches** the schema from `body.$schema` at runtime rather than embedding it, so a new field cannot fail an older page.

**5. Reserved ids — CLOSED; nothing will be missing after the batch-11 merge.**
`node scripts/hub-reserved-ids-test.cjs` → `all passed (4 passed)`. Literal first segments registered ahead of the generic patterns on `origin/claude/colosseum-batch-11` (`server.js`): under `/hub/` — `apply`, `badge.svg`, `demo`, `demo-b`, `judge`, `schema`, `status`, `trust`, `verify`, `wallet`; under `/api/hub/` — `badge.json`, `wallet`. Every one is in `RESERVED_PROJECT_IDS` (`apply, verify, status, wallet, trust, judge, schema, registry, hub, demo, demo-b, settle, badge`), and `badge.svg`/`badge.json` cannot be project ids anyway (`ID_RE` forbids `.`). Registration order is correct on that branch — the literals sit at lines 8531–8757, the generic `["/hub", "/hub/:project", …]` at 8766 and `/api/hub/:project` at 8186 after `wallet`/`badge.json`. **No `compare` segment exists on batch 11**: the route is `/hub/:project/programs` (a sub-segment of a project, not a shadowing id) — `git grep "programs/compare"` on that branch returns nothing. So the merged list needs no additions.

**6. `vaultProject` sweep — CLOSED.**
Set only on `/api/hub-registry` (`routes.js:273-277`), which 404s without the owner key; an operator's `&terms=` cannot reach it — even with a comped (non-lapsed) project the terms write only touches `state`, never the registry row, and `vaultProject`/`payoutSources` are not in `TERM_KEYS` (`q3.cjs` 6-1/6-2, `q4.cjs` 6-1b/6-1c). Carry-forward, explicit-clear and malformed-value handling all behave: `normalizeVaultProject` throws on `"TREASURY/../poke"`, the route answers 400 and the stored value is untouched (`q4.cjs` 6-4…6-8). Unset `vaultProject` → `fundedByForSweep = [...fundedBy]` only (`routes.js:1070`), and a *set* `vaultProject` whose key is not loaded (`vault.operatorPubkey()` → null) is filtered out, so the sweep fails closed with `transfer_not_from_funding_wallet` rather than widening — all five combinations verified (`q2.cjs` 2A).

**7. cuna-payout composite key — CLOSED.**
`lib/cuna-payout.js:40-51`. The throw is unreachable from a request: batch ids are minted as `hb_<10 hex>` by the export branch, wallets are base58-validated, and journal `batchId`/`wallet` only ever come from those. A crafted `&batch=hb_a b` answers `400 no such batch (pass &batch=)`, never a 500; only a *hand-planted* space-bearing batch id in the store reaches the guard, and it degrades to a 400 rather than a silent mis-attribution (`q3.cjs` 7-1…7-5). `/cuna-payout` is byte-for-byte unaffected for real ids — `walletFromRowKey(rowKeyOf(id, w)) === w` and `cuna-payout-test` passes 33/33 including the row-key attribution case.

## NEW findings (ranked)

**N-1 (P2) — the one summary alert can be silently swallowed for 6 hours, and for long project ids it collapses across batches.** `server.js:8255` `hubAlert` → `cunaOpsAlert(text, "hub:" + text.slice(0,40))`, and `cunaOpsAlert` (`server.js:12188-12194`) **writes the 6-hour dedupe watermark before calling `tgSend`**, which swallows its own errors — the exact CLAUDE.md pattern. Worse, the key is only 40 characters of a message shaped `<projectId>: batch hb_XXXXXXXXXX — …`, so the batch id fits only while `len(projectId) ≤ 19`; `ID_RE` allows 32. Reproduction (`q5.cjs`): project id `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`, three separate batches each with one refused stranger-sourced row → three route alerts, **one** distinct dedupe key (`"hub:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa: batch "`), so only the first reaches the operator room and the next 6 hours of fraud refusals on that project are silent. Same collapse applies to the sweep and send summaries. With a short id the keys stay distinct (3/3). One sentence: put a stable discriminator (project + batch, hashed) in the dedupe key and set the watermark only on a send that returned ok.

**N-2 (P2) — a suspended, never-termed project id is takeable by a self-serve application, and the new owner inherits the old project's ledger.** `lib/hub/project.js:171-186` exempts `status === "suspended"` from both the `requireNew` id check and the duplicate-mint loop, and the route's second guard (`routes.js:222`) only fires when the project already has program versions. Reproduction (`q4.cjs` 3-11): approve project `beta` (mint M1), write `days`/`paid` for it, suspend it without ever publishing terms, then `POST /api/hub-registry?approve=<appId>` for an application with `id=beta, mint=M2, fundingWallet=<attacker>` → 200, `beta.fundingWallet` becomes the applicant's, and `store.read(kv,"beta","paid")` still holds the old `{wallet: "500000000"}` because the kv namespace is `program:beta:*`. The new project's holders are then credited/settled against a stranger's `days`/`paid`/`batches`. (The related mint carve-out is not exploitable: re-approving the suspended project later hits the duplicate-mint loop against the new row and throws, so two approved projects can never share a mint.) One sentence: either refuse a suspended id on the self-serve path too, or clear/namespace the project's store parts when its id is re-issued.

**N-3 (P3, latent) — a partial row is permanently unsettleable and has no remedy.** `&sent=` verification uses the **full** row amount as `minRaw` (`routes.js:866` passes `amounts: bt.amounts` → `rowPaidBy` "transfer smaller than the amount owed"), while the journal's `exactOnly` compares against **remaining**. So for a row with a pre-`exactOnly` (or hand-written/backfilled) partial entry, a transfer for exactly the remainder is rejected before PASS 1 ever runs and a transfer for the full amount is rejected as `amount_mismatch` — reproduction in `q1.cjs` 1C (400 of 1000 journaled, a 600 transfer settles nothing, journal report empty). `ledger.waiveRemainder` — the documented owner remedy — is wired to **no route** (`grep waiveRemainder lib/hub/routes.js server.js` → nothing). Not reachable today (no live journal, and no live path can create a partial), but it becomes reachable the moment anything backfills the journal. One sentence: pass the row's *remaining* as `minRaw`, or expose the owner waive.

**N-4 (P3) — an exact-amount refusal pins the row's money in a pending batch with only two exits.** When a real but non-exact transfer goes out (an operator fat-finger, a fee-bearing mint), the row is refused everywhere, so the batch can never reach `sent` and `owedNow` holds the amount at 0 forever; the exits are a second, exactly-correct transfer (the holder keeps the first) or `&cancel=`, which returns the money to available and pays it again. This is the deliberate blast radius of the round-3 fix, but it is undocumented in `lib/hub/README.md` and the only signal is the summary alert that N-1 can swallow. Reproduction: `q1.cjs` 1A (single oversized) — `ignored: [{why:"amount_mismatch", expectedRaw:"1000000000", actualRaw:"50000000000"}]`, `sent[wallet]` absent, batch still `pending`.

**N-5 (P3, pre-existing, outside this PR's diff) — `/api/hub-apply` is the one unauthenticated source of operator-room alerts.** `routes.js:614-648`: no signature required (`applicantWallet` is optional), 12 requests/min per IP, one `alert(…)` per accepted application, each carrying a unique `app_<hex>` id so the dedupe key never collapses, until `MAX_PENDING = 200` is reached — at which point the queue is also full and legitimate applications are refused. Cost to an attacker: 200 throwaway SPL mints (each application needs a distinct on-chain mint). Roughly 200 messages in ~17 minutes plus a denial of the onboarding queue.

## Test verdicts (verbatim last line of each run)

```
hub-settle-route-test        | all passed (69 passed)
hub-core-test                | all passed (34 passed)
hub-public-test              | all passed
hub-schema-test              | all passed
hub-apply-test               | all passed (17 passed)
reproduce-receipt-test       | all passed (33 passed)
cuna-payout-test             | all passed (33 passed)
payout-verify-test           | all passed (11 passed)
hub-reserved-ids-test        | all passed (4 passed)
hub-receipt-page-test        | all passed (3 passed)
traction-test                | all passed (50 passed)
mutating-get-guard-test      | all passed        (GUARD_TEST_PORT=3324)
```
`HUB_VERIFY_TEST_PORT=3323 node scripts/hub-verify-page-test.cjs` — **SKIPPED, cannot run in this worktree**: neither `scripts/hub-verify-page-test.cjs` nor `hub-verify-src/` nor a `build:hubverify` npm script exists on this branch (`package.json` scripts are exactly `start, dev, build, preview, test:fast, test`). All three live on `origin/develop` (batch 9, commit f9a5182) and will arrive at merge; I verified the compatibility question by inspection instead — see item 4.

Merge-ready: yes.


---

## Round 5 — narrow re-check of fix round 4 (one Opus lens, read-only, 2026-09-18 ~16:05 UTC)

Verdict: N-1, N-2, N-3 CLOSED as asked; merge-ready on the P0/P1 rule. New: NEW-1 (P2, a regression from the
round-4 alert change — check → await → set races, one message per row), NEW-2 (P2, a waive frees the partition but not
`owedNow`, so the remedy is inert until the batch is cancelled), NEW-3 (P3, an id re-issue carries access, milestones and
the allowlist). NEW-1 and NEW-2 are fixed in fix round 5 before the develop merge; NEW-3 with them.

READ-ONLY adversarial re-check, round 5 (NARROW). Worktree `…/scratchpad/journal`, branch `claude/hub-settlement-journal`. **⚠️ HEAD moved under me mid-run**: the branch is now `af9eccf`, two commits past the five listed (`8a702f1` hub-demo-fixture-test wording; `af9eccf` `lib/airdrop-receipt.js` — passes `nowUnix` into `rowPaidBy`). `git diff 4c2b3c4..af9eccf` touches only those two files, so nothing in the hub/settlement paths changed; all probes and all test runs below are at `af9eccf`. No file was edited, nothing committed or pushed. Probes in `…/scratchpad/verify5/q1–q5.cjs` (harness reused from verify4; needs `NODE_PATH=/home/user/cluck-norris-school/node_modules` — the worktree has no `node_modules`).

## 1. N-1 (alert dedupe) — CLOSED for every attack asked, but see NEW-1

- **Failed send leaves the watermark unset** — CLOSED. `server.js:8836-8847`. `cunaOpsAlert` → `tgSend` (`server.js` ~7290) returns `result ? result.message_id : null`; it can never return `{ok:false}` (that is `postToX`). Probe: null return → next call retries (2 sends); message_id → repeat suppressed (1 send). A truthy `{ok:false}` *would* be taken as a success, but no code path produces one.
- **Cross-project / cross-batch keys** — CLOSED. `lib/hub/alert-key.js:21-23`. Keys are `sha256(projectId|batchId|kind)`, so two projects sharing a batch id, two batches of one project, and the three kinds are all distinct even at the 32-char id limit (`ID_RE`, `lib/hub/store.js:36`). `|`-injection is unreachable (`ID_RE` is `[a-z0-9-]`). Partial meta falls back to the old 40-char text key; `null` message does not throw.
- **`cunaOpsAlert` byte-for-byte unchanged** — CLOSED. `server.js:12772-12787`; extracted at `c1079da` and at HEAD, `diff` is empty (16 lines, sha256 `a2e4625abc544c10`). The four `cunaOpsAlert` hits in the server.js diff are three comment lines plus the new `hubAlert` call; every CUNA caller still passes its own dedupeKey.
- **Non-summary alerts / flood** — dedupe is unchanged-but-coarse and *sane* in kind: `routes.js:263` (payoutSources) keys on `<id>: payoutSources changed by the owner t…`, i.e. one alert per project per 6 h regardless of the new list — a second change inside 6 h is silent (pre-existing). The one unauthenticated flood source is `POST /api/hub-apply` (`routes.js:654`, 12/min/IP, `MAX_PENDING` 200) — already documented as open in README N-5. `HUB_ALERT_SEEN` is unbounded, same shape as `CUNA_ALERT_SEEN` (P3).

## 2. N-2 (suspended-id takeover) — CLOSED, two namespaces not covered (see NEW-3)

`storeIsEmptyFor` (`lib/hub/store.js:92-104`) covers: all five PARTS (`state`/`ledger`/`days`/`paid`/`batches`, incl. the `cuna` legacy aliases) and every `hub:settle:*` entry tagged with the id. **Not** covered: `hub:waive:<id>:<batch>:<wallet>` (new this round, `routes.js:1099`) and `hub:quotes:<id>` (`routes.js:672`). `hublock:<id>:*` correctly does not count (ephemeral); no `hub:repro:*` keys exist on this branch (reproducibility is computed); milestones/access live on the registry row, which is replaced. Neither miss lets a stranger's *ledger* carry over — both are only reachable after the owner has cleared the PARTS the 409 names — see NEW-3 for what does carry.

- Self-serve (`requireNew`, `lib/hub/apply.js:80`) can no longer approve onto a suspended id (`project_exists`) nor re-register a suspended project's mint under a new id (`project.js:186,190`). ✔
- Owner path keeps both exemptions; **un-suspending the SAME (id, mint) still works** end-to-end through `POST /api/hub-registry?id=` (200, status→approved). ✔
- Route guard (`routes.js:282`) refuses a suspended id + populated store + new mint with 409 and leaves the registry row untouched; with an emptied store the re-issue is allowed. ✔
- Consistency nit (P3): `/api/hub-apply` still *accepts* an application for a suspended id/mint (`routes.js:645-646` exempt suspended), which `apply.approve` can now never approve — the owner gets a permanently dead application.

## 3. N-3 (`&waive=`) — CLOSED on authorisation and journal hygiene; OPEN on effect (NEW-2)

CLOSED: operator token → 403 (`routes.js:779`); unauthenticated → 404; GET → 405 (`routes.js:767`, guard test covers it); dryRun project → 403 (`routes.js:786`, `mutating` now includes `b.waive`); second waive of the same row → refused ("nothing remaining"); wallet not in batch → `row_not_in_batch`; unknown batch → refused; the waive is **never** read as a settlement (`readJournal` scans only `hub:settle:`, and `looksLikeJournalEntry` needs `xferKey`/`amountRaw`/`appliedRaw` — the waive entry has neither); the persisted batch is *not* stamped `projectId`; a `&sent=` for a waived row is refused (`amount_mismatch`, expected `0`) and journals nothing. `reason` is CR/LF-collapsed and capped at 200 chars; it is stored raw (HTML + NUL survive) but reaches **no** public surface — `pub.stakeView` builds its batch rows field-by-field and never carries `waived`/`reason`; the only live public receipt path is `pub.findReceipt` (which hardcodes `waivedRaw:"0"` and only shows `sent` rows). `ledger.receipt` is called only by `lib/hub/demo-fixture.js`.
OPEN: what a waive actually does — NEW-2.

## 4. Sweep

`git diff c1079da..4c2b3c4 --stat` = exactly the 9 files of the five listed commits (README, alert-key, project, routes, store, three test scripts, server.js); no `.claude/`, no `docs/`. Worktree clean. **Two later commits exist** (see header) — one of them, `af9eccf`, is a real `lib/airdrop-receipt.js` change outside the listed set.
`lib/hub/README.md` §5c is accurate on: refusal-everywhere (PASS 2/3 only record what PASS 1 settled), the batch never reaching `sent`, the one-summary-alert signal, `&cancel=` semantics, remainder-based verification, owner-only waive, and the `hub:waive:` prefix. **One sentence is wrong against the code**: "this only stops the batch holding it in permanent limbo" — it does not, until the batch is also cancelled (NEW-2). §6/N-5 figures (12/min, `MAX_PENDING` 200, optional `applicantWallet`) check out.

## NEW findings (3)

**NEW-1 (P2, regression introduced by `b0b59ac`) — same-key alert burst is no longer deduped: one operator-room message per row instead of one per request.** `hubAlert` (`server.js:8836`) is check → `await` send → set, so every call in one synchronous loop passes the 6 h check before any send resolves. Reproduction (`verify5/q5.cjs`, real route + real `hubAlert` source): project id `partner-lock-to-earn` (21 chars, so the wallet falls past the 40-char slice), three lockers, one signature paying each in two instructions (net delta exact → `verifyBatchRows` passes and `recordSent` records; `locateTransferInstruction` cannot attribute → the per-row alert at `routes.js:1021`, which passes **no** meta). Result: **3 Telegram sends sharing 1 dedupe key**; the same input at `c1079da` sent 1 (`verify5/q1.cjs` §(d)/(e): 50 → 50 now, 50 → 1 before). `&sent=` is operator-reachable and takes up to 500 rows at 30 req/min, so a project operator can push the operator room into Telegram's rate limiter — which would silence CUNA accrual/burn/watchdog alerts too. Not a money bug; no row is mis-settled.

**NEW-2 (P2) — a waive frees the remainder for the desk but not for the holder view or the next batch, so the documented remedy does nothing until the batch is also cancelled.** `lib/hub/ledger.js:228` clears `remaining` via `batch.waived`, which `reservedByWallet`/`partition` honour — but `pay.owedNow` (`lib/cuna-payout.js:118-120`) holds a row purely on `!b.sent[w] && b.state === "pending"` and never looks at `waived`. Reproduction (`verify5/q3.cjs` §3, `q4.cjs`): partial row 400m applied of 1000m → waive 600m → `partition.availableRaw = 600000000` while `owedNow = 0`; `/api/hub/:project/desk` (partition, `routes.js:177`) and the holder view (`engine.js:247` → `owedNow`) now disagree — the exact crash-P1-4 class this branch closed elsewhere. `L.batchView` also reports the still-`pending` batch as `sent` and the row as `paid` (`rowState`: `remaining===0 && applied>0`). After a later `&cancel=` everything agrees again (`owedNow = 600000000`). Same applies to a never-settled row: it can be waived in full, partition frees it, `owedNow` reads 0. No money moves wrongly and nothing is double-payable (a `&sent=` on a waived row is refused).

**NEW-3 (P3) — re-issuing an id to a new mint carries more than `storeIsEmptyFor` checks.** `proj.approveProject:199-204` keeps the previous row's `access` (`paidThroughUnix` + the whole `payments` list) and `milestones`, and `routes.js:277` carries `payoutSources`/`payoutSourcesHistory` (and `vaultProject`) forward when they are not named — so a brand-new mint under a reused id inherits the old project's paid Hub months, its onboarding clock, and its settlement-source allowlist; and the 409's own remedy ("clear it before re-issuing") leaves `hub:waive:<id>:*` and `hub:quotes:<id>` behind. Verified in `verify5/q2.cjs`. Owner-driven only; nothing reads `hub:waive:*` back, and a stale quote still needs `access.payerAllowed` against the *new* operator wallets.

## Test verdicts (verbatim tail, at `af9eccf`)

```
hub-settle-route-test      all passed (77 passed) [exit 0]
hub-core-test              all passed (34 passed) [exit 0]
hub-apply-test             all passed (17 passed) [exit 0]
hub-public-test            all passed [exit 0]
hub-schema-test            all passed [exit 0]
broadcast-integrity-test   all passed [exit 0]
telegram-rooms-test        all passed (13 passed) [exit 0]
payout-verify-test         all passed (11 passed) [exit 0]
cuna-payout-test           all passed (33 passed) [exit 0]
hub-receipt-page-test      all passed (3 passed) [exit 0]
reproduce-receipt-test     all passed (33 passed) [exit 0]
mutating-get-guard-test    all passed [exit 0]   (GUARD_TEST_PORT=3377)
```

## Suggestions (one line each, no fixes applied)

- NEW-1: set `HUB_ALERT_SEEN` synchronously before the send and delete the key when the send returns falsy, so the check-and-claim is atomic within one event-loop turn.
- NEW-1b: give the per-row alert at `routes.js:1021` the same `meta` treatment, or collect it into the existing end-of-branch summary like the fraud refusals.
- NEW-2: make `pay.owedNow` subtract `b.waived[w]` from the `held` amount (and `rowState` report `partial-waived` rather than `paid`), then correct the §5c sentence.
- NEW-3: add `hub:waive:<id>:` and `hub:quotes:<id>` to `storeIsEmptyFor`, and reset `access`/`milestones`/`payoutSources` when `approveProject` sees a mint change.
- Minor: in the `&waive=` block, assign `batches` only after `writeManyVerifiedMixed` returns true, so a throwing kv cannot leave a waive reported `ok:false` in memory for a later branch's `saveMoney()` to persist.

Merge-ready: yes.
