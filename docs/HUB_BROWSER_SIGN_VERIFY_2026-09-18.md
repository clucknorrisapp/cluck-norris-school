# Browser-signed payout (X6 / PR #354) — verifier lenses, 2026-09-18

Read-only adversarial passes on `claude/hub-browser-sign` before merge (CLAUDE.md money-path rule: two lenses, own PR). Each round is appended verbatim; fix rounds add "Fixed: <sha> — <test>" lines under the findings they close.

---

## Round 1, lens 2 (adversary and browser) — head cc90f0f

# X6 lens 2 — adversary and browser

Read-only review of `origin/claude/hub-browser-sign` (cc90f0f, one commit on `origin/develop`). All line numbers are at that revision. I ran `scripts/hub-browser-sign-test.cjs` (16/16 pass) and four adversarial probes against the real route closures via DI (same harness style as the test); probe results are quoted below.

---

## Direct answers

**1. What `observe` trusts from the browser.** Only a list of base58-shaped signature strings (`lib/hub/routes.js:1521-1526`). It never trusts a wallet↔sig pairing — it builds the full cross product from the server-frozen `browserSign.wallets` (`:1558-1560`) and lets `payoutVerify.verifyBatchRows` + `locateTransferInstruction` decide. A stranger's transfer to the same recipient is refused (`transfer_not_from_funding_wallet`, `lib/payout-verify.js:72-77`); a pre-batch replay is refused (`notBefore: bt.at` → `lib/payout-verify.js:63-67`); a signature already journaled by any project is refused (`TRANSFER_ALREADY_CONSUMED_WHY`, global journal, `lib/payout-verify.js:132-137`); the amount must equal the row's *remaining* exactly (`routes.js:1602-1603`, `exactOnly`). This half is solid and matches the `&sent=` branch line for line. The residual (unchanged, pre-existing): a real funding-wallet transfer made after the batch for some *other* reason, not yet journaled, can be claimed for a row whose remaining it happens to equal.

**2. `sign-request` disclosure / oracle.** Response carries only `publicProject(p)`, the batch's own owed rows, `fundingWallet` (already public), `mint/decimals/tokenProgram`, and a nonce. No other wallets' balances, no key path, no cross-project data. Unauthenticated → 404 before any read (`:1453-1456`); another project's operator token doesn't authorise (`authOf(req, p)` is per-project). Rate limit is per-IP per-bucket (`server.js:3817-3846`), 30/min on a `hubheavy` bucket separate from `/payout`'s `hubpayout`. 500-row response ≈ 85 KB, and `journalFor` is computed once (`:1472`) so sign-request is O(rows) — fine. `observe` is not (F7).

**3. Browser build/validation.** Instructions are built only from the server response, through `CluckAirdrop.send` → `splToken.createTransferCheckedInstruction` (`public/airdrop-engine.js:64-71`, `DataView`, no `Buffer`, no `SystemProgram.transfer`). No new `Buffer` anywhere; `hub-desk.html` has zero matches. **But nothing in the response is validated client-side** (F6). Every dynamic string is escaped — `esc(...)` wraps the status lines, the failure reasons and the error text (`hub-desk.html:616,634,641-644`), `esc = CluckUtil.esc` (`:220`). Amount rendering uses `whole(r.amountRaw, sr.decimals)` with *server-supplied* decimals while `CluckAirdrop` re-derives decimals from chain (`airdrop-engine.js:336-340`) — see F6.

**4. Wallet flow.** `signAndSendTransaction`, single signer, no extra signers (`airdrop-engine.js:377-380`) — "connected wallet signs first" holds trivially. Disconnect works (`hub-desk.html:299-303`). **Wallet mismatch is not checked at all** (F1). Partial broadcast then a wallet rejection: `CluckAirdrop.send` catches per-batch and keeps going, so the outer `await` usually returns — but the collected signatures live only in `var sigs = []` and there is no recovery UI (F5).

**5. Griefing.** Yes on both counts — F3/F4 (state churn and permanent lockout of the owner-only managed payer) and F8 (40 arbitrary `getTransaction` reads per call × 30 calls/min/IP, fetched sequentially while holding the per-project payout lock).

**6. i18n.** All nine keys present in all six dictionaries (es/hi/it/pt/vi/zh, 1636 keys each — verified by parse, not grep). Placeholders `{state} {n} {reasons} {amount} {wallet}` match one-for-one in every language; none left identical to English; no yield/APR/"guaranteed" language. There is no `en.json` (English is the literal fallback in `t()`), which is correct for this repo. **Clean.**

**7. Test honesty.** See F10.

---

## Findings

### P0

**F1 — Nothing checks that the connected wallet IS the funding wallet, before or after signing. `public/hub-desk.html:610-633`**
`refreshSignSendButton` requires only `WALLET && PROVIDER && WALLET_BAL >= need`; `signAndSend` never compares `WALLET` to `sr.fundingWallet` (which the server hands it at `routes.js:1495`) or to `DESK.project.fundingWallet`. But `observe` *requires* the transfer to be sourced from the funding wallet (`payout-verify.js:72-77`). Operator wallets are a separate list from `fundingWallet` — the page itself says so for the commit flow at `:390-391` ("connect the project's FUNDING wallet itself — not just any operator wallet"). **Scenario:** an operator who happens to hold enough reward token in their personal operator wallet clicks SIGN AND SEND. Every row broadcasts for real from their own wallet; `observe` then refuses all of them `transfer_not_from_funding_wallet` (probe 2 reproduces exactly this refusal), the lockers are paid out of the wrong pocket, the batch still owes every row, and the batch is now deadlocked (F4). Money is irrecoverable.
*Minimal fix:* in `refreshSignSendButton`, add `&& WALLET === DESK.project.fundingWallet` and push the reason into the disabled-why line; belt-and-braces, refuse in `signAndSend` when `sr.fundingWallet !== WALLET` before calling `CluckAirdrop.send`. (The same gap exists on the pre-existing SEND button at `:534-548` — fix both.)
Fixed: 43ab968 — scripts/hub-desk-sign-page-test.cjs (section "F1")

**F2 — `&cancel=` is not blocked while `browserSign` is live, and `observe` accepts a cancelled batch → one accrual paid twice. `lib/hub/routes.js:1168-1169`, `:1534-1539`**
`/payout`'s `&send=` checks `browserSignIsLive` (`:1298`) but `&cancel=` does not, and the desk's CLOSE BATCH button is explicitly left enabled while a browser-sign flow is live (`:541`). `observe` only checks `bt.browserSign.state`, never `bt.state`.
*Probe 3:* sign-request → `cancel` returns 200, batch → `cancelled`, `browserSign` still `signing`, and a re-`export` immediately creates a **new batch with the identical amount for the same wallet**.
*Probe 4:* `observe` on that cancelled batch returns 200, `recorded: [W.A]`, `browserSign: settled`, **one journal entry written into a cancelled batch**.
**Scenario:** operator broadcasts, sees no confirmation, presses CLOSE BATCH (the UI invites it), re-exports, pays the new batch, then later observes the old signatures — or the old signatures simply settle the cancelled batch. Either way the wallet is paid twice for one accrual and no invariant catches it.
*Minimal fix:* refuse `&cancel=`/`&close=` with 409 when `browserSignIsLive(bt)` (same one-liner as `:1298`), and add `if (bt.state !== "pending") return 400` to `observe` at `:1535`. Disable CLOSE in `refreshSendButton` when `bsLive`.
Fixed: 43ab968 — scripts/hub-browser-sign-test.cjs (section 12)

**F3 — A second `sign-request` while `signing` re-hands the identical rows, and the SIGN button is not disabled while live → double broadcast. `lib/hub/routes.js:1468-1470`, `public/hub-desk.html:614-615`**
The refusal fires on `submitted` but not on `signing` — which is backwards. `submitted` means at least one observe ran, so the rows still shown owed genuinely are owed; `signing` is exactly the state where an unobserved broadcast may already exist. Worse, `refreshSignSendButton`'s `ok` omits `!live` (contrast `refreshSendButton:540`, which has `!bsLive`), so after a reload mid-flow the button is **enabled** and the status line says only "reload to check its progress".
*Probe 1:* second sign-request while `signing` → 200, same wallet, same `amountRaw`.
**Scenario:** tab crashes after the wallet broadcasts. Operator reloads, clicks again, signs and broadcasts the same transfers a second time. The chain has two transfers; the journal will settle exactly one (the second is refused `duplicate_settlement_candidate`/`amount_mismatch`) — which is the point: the ledger stays consistent while the funding wallet is down twice the money.
*Minimal fix:* add `!live` to `ok` at `:614`; on the server, refuse a re-`sign-request` from `signing` unless the caller passes an explicit `force=1`, and word the refusal "observe the signatures you already broadcast first". The test at `scripts/hub-browser-sign-test.cjs:126-135` currently pins the unsafe behaviour as intended — it needs inverting with this fix.
Fixed: 43ab968 — scripts/hub-browser-sign-test.cjs (section 1, inverted) + scripts/hub-desk-sign-page-test.cjs (section "F3")

### P1

**F4 — A batch can be permanently deadlocked in `submitted`, unpayable by every route including the owner's managed payer. `lib/hub/routes.js:1468-1469`, `:1298`, `:1638,1651`**
*Probe 2 (verbatim):* after one observe of a wrong-source signature → `state: submitted`; new `sign-request` → **409** "already broadcast — observe it (or let its blockhash lapse)"; managed `&send=` → **409** "a browser-signed payout is submitted"; re-`observe` → 200, still `submitted`. `stillOwed` can never reach false for a row whose only transfer is permanently unattributable, and `&send=` is owner-only (`:866`) — so **an operator can lock the owner out of the managed payer on a batch with one POST**, deliberately or by accident. The only escape is `&cancel=` + re-export, which is F2's double-pay path. The 409 text is also wrong: this flow tracks no blockhash, so "let its blockhash lapse" describes a recovery that does not exist.
*Minimal fix:* an owner-only `browserSign` reset (e.g. `POST …/sign-request?clear=1` setting `browserSign = null`), or age out `signing`/`submitted` after a TTL when the last observe settled nothing. Fix the 409 wording.
Fixed: 43ab968 — scripts/hub-browser-sign-test.cjs (section 13)

**F5 — The broadcast signatures exist only in a local `var`; a lost tab or an outer throw loses them, and there is no `unrecordedSent()` guard. `public/hub-desk.html:626-636`**
`var sigs = []` is never persisted. The pre-existing SEND path persists every result to `localStorage` on each `onResult` (`:589`, `saveStatus()`), renders SENT—NOT RECORDED row buttons, and **refuses to run again while any exist** ("Sending again would pay them twice", `:567`). `signAndSend` does none of that: it neither writes `ROW_STATUS` nor checks `unrecordedSent()`, so it will happily re-broadcast rows the SEND flow already sent-but-didn't-record, and if `call(".../observe")` throws (network blip — `call` throws on any non-`ok`, `:266`) the signatures are gone from the page with no UI to re-submit them.
*Minimal fix:* push each `r.sig` into `ROW_STATUS` + `saveStatus()` in the `onResult` at `:632` (reusing the existing recovery buttons), and add the `unrecordedSent()` guard from `:567` to `signAndSend`.
Fixed: 43ab968 — scripts/hub-desk-sign-page-test.cjs (section "F5")

**F6 — The page validates nothing in the sign-request response, and the confirm dialog shows numbers from a different source than what gets signed. `public/hub-desk.html:623-629`, `:651-654`**
`recipients` comes wholly from `sr.rows`; `mint` from `sr.mint`; the human amount from `whole(r.amountRaw, sr.decimals)`. The page already holds `MINT`, `DEC` and `BATCH.rows[].raw` and checks none of them. Two concrete failures: (a) `sr.decimals` disagreeing with the on-chain mint decimals — which `CluckAirdrop` re-reads and overrides at `airdrop-engine.js:336-340` — silently scales every transfer by 10^Δ; a stale `rewardDecimals` on the project record (`routes.js:1473`) is all it takes. (b) The confirm text at `:653` quotes `BATCH.remainingCount` / `amt(BATCH.remainingRaw)` from the *last page load*, while the wallet is then asked to sign whatever `sr.rows` says — the operator approves one set of numbers and signs another.
*Minimal fix:* before building `recipients`, assert `sr.mint === MINT`, `sr.decimals === DEC`, every `sr.rows[i].wallet` is present in `BATCH.rows`, and `amountRaw <= ` that row's `raw`; bail with a plain message otherwise. Move `askConfirm` to *after* the sign-request and quote the returned row count and summed amount.
Fixed: 43ab968 — scripts/hub-desk-sign-page-test.cjs (section "F6")

### P2

**F7 — `observe` is O(wallets × sigs) with four full global-journal scans per wallet, all while holding the per-project payout lock. `lib/hub/routes.js:1558-1566`, `:1595`, `:1638`, `:1673`**
`sigs` is capped at 40 (`:1526`) but `wallets` is uncapped (the `&sent=` branch caps its equivalent at 500, `:952`). `ledger.journalFor` (`lib/hub/ledger.js:48-50`) filters the **entire global journal** and is called inside four separate per-wallet loops, and `rowState` then filters those entries again per wallet. A 500-row batch against a 50k-entry journal is ~10^8 object comparisons per request, single-threaded, under a 10-minute lock — the whole Hub stalls. 30 req/min per IP for any authenticated operator.
*Minimal fix:* hoist `const proj = ledger.journalFor(hubJournal, p.id)` once per pass (it already is in sign-request at `:1472`), and cap `wallets.length × sigs.length` the way `&sent=` caps `results`.
Fixed: 43ab968 — scripts/hub-browser-sign-test.cjs (section 17)

**F8 — `observe` is a free authenticated `getTransaction` amplifier. `lib/hub/routes.js:1526`, `:1550`**
Up to 40 arbitrary signatures per call, fetched sequentially through the paid RPC, 30 calls/min/IP, for any operator of any project — the signatures need not relate to anything and the route leaks nothing about them (good), but each call burns 40 Helius credits and holds the payout lock across all 40 round trips. Combined with F7 that's a cheap self-DoS.
*Minimal fix:* intersect `sigs` against a plausibility bound (e.g. at most `wallets.length` + a small slack), fetch concurrently with a small pool, and acquire the lock *after* the fetch rather than before.
Fixed: 43ab968 — scripts/hub-browser-sign-test.cjs (section 17, the bound) + the concurrency-pool/lock-ordering rewrite is exercised by every existing observe test (sections 3–6, 12–16) still passing with `getTx` fetched before `lockAcquire`

**F9 — `nonce`/`idempotencyKey` are generated, persisted and documented as the tie-back control, but `observe` never reads either. `lib/hub/routes.js:1486-1497` vs `:1510-1675`**
The comment at `:1487-1491` states the key "ties an observe() call back to the exact set of rows/amounts a sign-request handed out, so a stale or superseded sign-request can never be conflated with a fresh one". No code enforces it — `observe` takes signatures only. A superseded sign-request (F3) is in fact silently conflated with the fresh one; the only thing actually frozen is `browserSign.wallets`. Per CLAUDE.md ("tell the truth about what you did"), a control that is described but not implemented is worse than no control.
*Minimal fix:* either require `nonce` on `observe` and 409 a mismatch, or delete `idempotencyKey` and rewrite the comment to say plainly that only the wallet list is frozen.
Fixed: 43ab968 — scripts/hub-browser-sign-test.cjs (section 16, "F9")

### P3

**F10 — Claims that are not true, and tests that cannot catch the above.**
- `public/hub-desk.html:132`: "holding the batch so nothing else can touch it meanwhile" — false. `&sent=`, `&cancel=`, `&waive=` and the per-row record buttons all still work while `browserSign` is live; only the owner-only `&send=` is blocked.
- `scripts/hub-browser-sign-test.cjs` is server-only — there is no vm/jsdom test of `hub-desk.html`'s `signAndSend` (other Hub work does run page scripts in a vm, e.g. the receipt-page test cited in the CI diff). F1, F3's UI half, F5 and F6 are all invisible to the suite by construction. The suite also has no case for: a cancelled/closed batch (F2), recovery from a permanently-`submitted` batch (F4), a cross-project signature (asserted in the comments at `:1440-1441` but never exercised here), or the wallets×sigs cross-product bound (F7).
- `scripts/hub-browser-sign-test.cjs:97` — `const kv = arguments;` in `exportBatch` is dead and misleading.
- A broken implementation *would* pass most of the suite: every test uses a single-wallet batch, so the cross-product, the per-wallet `failed` overwrite and the `duplicate_settlement_candidate` path are never reached.
Fixed: 43ab968 — the `hub-desk.html:132` copy now says exactly what is blocked (the managed send and cancel); `exportBatch`'s dead `const kv = arguments;` is removed (scripts/hub-browser-sign-test.cjs); the cancelled-batch, owner-reset, cross-project-signature, two-wallet, and wallets×sigs-bound cases are covered by scripts/hub-browser-sign-test.cjs sections 12–17 and scripts/hub-desk-sign-page-test.cjs (new file, added to .github/workflows/syntax-check.yml next to the browser-sign step, always-run)

---

**Merge-ready: no** — F1 (no funding-wallet check before the wallet signs) and F2 (cancel-while-live plus observe-on-a-cancelled-batch, both reproduced) are each a live route to real money leaving twice or landing where the server will never credit it; F3/F4 make the flow double-broadcast on recovery and deadlockable by any operator. The server-side verification half (journal, exact-amount, funding-wallet source, `notBefore`, cross-project consumed set) is genuinely good and the i18n is clean — the gaps are all in the browser half and in the two state transitions around it.


---

## Round 1, lens 1 (crash windows and idempotency) — head cc90f0f

# X6 lens 1 — crash windows and idempotency

Branch `claude/hub-browser-sign` @ `cc90f0f` (one commit on `origin/develop`). Read-only review; no files edited, no git writes. I extracted the branch with `git archive` into the scratchpad and ran the new test (16/16 pass) plus three fault probes against the real route closures — findings marked **[probe]** are reproduced, not reasoned.

---

## P0-1 — `sign-request` ignores the legacy `sent` ledger, so it re-offers rows the managed payer has already broadcast **[probe]**

`lib/hub/routes.js:1477-1483` selects rows with **`ledger.rowState()` only** (journal-derived remaining). Every other payer path selects with `pay.remainingOf(bt)` (`lib/cuna-payout.js:200`), which honours the legacy `batch.sent[wallet]` flag — that is what `&send=` uses at `lib/hub/routes.js:1305` and what the desk's `remainingCount` is built from (`lib/hub/routes.js:122`).

A row is legacy-sent-but-unjournaled in several ordinary situations: the managed payer's `onPaid({pending:true})` writes `sent[w]` *before* broadcast and only journals on confirm (`routes.js:1319-1331`); a confirm that times out (`r.pending`) never journals at all; `&sent=` rows that hit `ATTRIBUTION_FAILURE_WHY`; and the `&send=` branch's own "paid on-chain but the settlement journal did not persist" fallback (`routes.js:1391`).

Reproduced: two wallets owed, managed payer broadcasts A (`pending:true`) and fails B, so the batch stays `pending`:

```
batch state: pending | legacy sent rows: [A] | A pending: true | journal entries: 0
sign-request rows offered: [[A,"1000000000"],[B,"2000000000"]]      <-- A offered again
pay.remainingOf(bt):       {B:"2000000000"}                          <-- what &send= would send
```

The operator's wallet then signs and broadcasts a **second** payment to A. Worse, `observe` cannot even record it: PASS 2 `recordSent` sees `sent[A]` already set and returns "already recorded", so the loop at `routes.js:1619-1630` discards the journal entry — the double payment leaves no trace at all.

**Minimal fix:** in the loop at `routes.js:1477`, `if (bt.sent && bt.sent[wallet]) continue;` (i.e. intersect `rowState` remaining with `pay.remainingOf(bt)`), and surface those wallets in `skipped` with a reason.
Fixed: 43ab968 — scripts/hub-browser-sign-test.cjs (section 14)

---

## P0-2 — nothing is recorded before the browser broadcasts, and a second `sign-request` while `signing` re-offers every row

`sign-request` refuses only `state === "submitted"` (`routes.js:1468`); `signing` is explicitly re-issuable, and the test at `scripts/hub-browser-sign-test.cjs:131` asserts that as correct behaviour. Nothing about *what was handed out* is durable except `browserSign.wallets`, which is never consulted as a hazard list.

The client makes this reachable without any crash. `public/hub-desk.html:632` reports **only** `r.status === "sent"` signatures to `observe`. `public/airdrop-engine.js:395-400` has three outcomes and its own comment says an `unconfirmed` (30 s confirm timeout) result must "never [be] 'failed' (a resend double-pays)" — yet the browser-sign path drops those signatures on the floor, and `hub-desk.html:634` then tells the operator **"Nothing broadcast"**. The `sigs` array is never persisted (unlike the SEND path's `ROW_STATUS`/`saveStatus()` at `hub-desk.html:589`), so a reload loses them. Finally `refreshSignSendButton` (`hub-desk.html:610-615`) computes `live` but **omits it from `ok`** — the SIGN AND SEND button stays enabled while `browserSign.state === "signing"`, and `remainingCount` is still full because nothing was legacy-recorded. Click twice → everyone paid twice.

This is the residual the README §3a names, but the claim there — *"nothing here can lose a real payment"* — is not what the code does: a real payment is lost to the record **and** the same rows are re-offered.

**Minimal fix:** (a) `hub-desk.html:632` push `unconfirmed` sigs too (the server verifies them on chain anyway — `getTx` null simply settles nothing); (b) `routes.js:1468` refuse a re-`sign-request` while `signing` unless the caller passes the prior nonce with an explicit `&abandon=1`, or exclude `bt.browserSign.wallets` from the new offer until they have been observed; (c) `hub-desk.html:614` add `&& !live` to `ok`.
Fixed: 43ab968 — (a)+(c) scripts/hub-desk-sign-page-test.cjs (sections "F3" and "F5"); (b) implemented as a `force=1` flag rather than a passed-back nonce (the nonce is now `observe`'s own tie-back control, F9/P2-6) — scripts/hub-browser-sign-test.cjs (section 1, inverted, and section 12)

---

## P1-3 — `&cancel=` is not guarded by `browserSignIsLive`, so a batch mid-signing can be closed and re-exported **[probe]**

`browserSignIsLive(bt)` is checked only in the `&send=` branch (`routes.js:1292`). `&cancel=` (`routes.js:1168-1172`) has no such check, and the desk's CLOSE button is disabled only on `SENDING`/non-pending (`hub-desk.html:541`) — not on `SIGN_SENDING` or `bsLive`. Its `unrecordedSent()` guard (`hub-desk.html:666`) reads `ROW_STATUS`, which the browser-sign path never writes.

```
cancel while browserSign=signing -> 200
batch state now: cancelled  browserSign: signing
re-export after cancel created a NEW batch owing: {A:"1000000000"}
observe on the CANCELLED batch -> 200 recorded: [A]
```

The wallet is settled on the cancelled batch **and** carried as a full row on the new pending batch, which `remainingOf` will happily pay again.

**Minimal fix:** `if (browserSignIsLive(batchOf(id))) return 409` in the `&cancel=` branch, with the same wording as `&send=`; and gate the CLOSE button on `bsLive`.
Fixed: 43ab968 — scripts/hub-browser-sign-test.cjs (section 12)

---

## P1-4 — `submitted` is a dead end: an early/lagging observe bricks a batch that has moved no money **[probe]**

`getTx` returning **null** (a validator that has not yet indexed a just-broadcast signature — the normal case one second after `signAndSendTransaction`) is not an RPC error, so it is not the 503 path. It flows to `rowPaidBy`'s `"transaction not found on chain"`, is written into `browserSign.failed[wallet]` (`routes.js:1645`) and flips the state to `submitted` (`routes.js:1651`).

```
observe (getTx -> null): 200 state: submitted failed: {A:{why:"transaction not found on chain"}}
sign-request again: 409 "…already broadcast — observe it (or let its blockhash lapse)…"
managed &send=  : 409 "a browser-signed payout is submitted for this batch…"
=> zero money moved, batch unpayable by BOTH routes
```

The only exit is `&cancel=` — which is itself P1-3, and is nowhere documented as the remedy. The same dead end is reached permanently by any row that settles through `ATTRIBUTION_FAILURE_WHY`: `stillOwed` (`routes.js:1638`) is journal-derived, so a legacy-recorded-but-unjournaled row keeps `stillOwed` true forever and pins `submitted`.

**Minimal fix:** distinguish "not found yet" from "failed" (treat a null `tx` whose signature is younger than a few minutes as `retry`, not `failed`, and do not advance out of `signing` on it), and add an owner/operator lever to clear `browserSign` on a batch with no journal entry for it (e.g. `POST …/payout?abandonSign=<batchId>`), so `submitted` is never terminal.
Fixed: 43ab968 — the null-tx case is treated as the SAME class as an RPC outage (503/retry, no state advance) rather than distinguished by signature age — scripts/hub-browser-sign-test.cjs ("P1-4/P1-5"); the reset lever is the owner-only `sign-request?clear=1` (F4) — scripts/hub-browser-sign-test.cjs (section 13)

---

## P1-5 — RPC outage is partly handled; the null case is reported as a permanent failure

Question 5 holds for the throwing case: `routes.js:1550-1551` fetches every signature before any mutation, returns 503 `retry:true`, and the batch is byte-identical (verified by `hub-browser-sign-test.cjs:231`, and the `dryRun` refusal at `routes.js:1518` precedes even `lockAcquire`, so the lock key is not written either). It does **not** hold for `getTx` resolving null — see P1-4. The two cases are the same underlying condition (this RPC cannot see the transaction right now) and only one is treated as `unavailable`.
Fixed: 43ab968 — both cases now answer 503/retry identically — scripts/hub-browser-sign-test.cjs ("P1-4/P1-5")

---

## P2-6 — the `nonce`/`idempotencyKey` is generated, persisted and returned but never checked

`routes.js:1486-1492` documents the key as what "ties an observe() call back to the exact set of rows/amounts a sign-request handed out, so a stale or superseded sign-request can never be conflated with a fresh one". `observe` reads only `b.sigs`/`b.sig` (`routes.js:1520-1526`) and the client never sends it (`hub-desk.html:636`). The stated guarantee does not exist; a comment asserting a control that isn't implemented is exactly the class CLAUDE.md warns about.

**Minimal fix:** either have `observe` require and compare `nonce` against `bt.browserSign.nonce`, or delete the claim from the comment and the README.
Fixed: 43ab968 — `observe` now requires and compares `nonce`; the comment and `lib/hub/README.md` §3a say so — scripts/hub-browser-sign-test.cjs (section 16)

---

## P2-7 — `browserSign.failed[wallet]` routinely records a wrong reason, and contradicts `paid`

`results` is the full cross product `wallets × sigs` (`routes.js:1559-1560`). In the normal multi-transaction run every wallet is rejected for every signature it is *not* in, so `failedNow[wallet]` (`routes.js:1645`) is overwritten with `"no <mint>… reached this wallet in that transaction"` from an unrelated signature. It is cleared only for wallets whose settlement journaled (`routes.js:1650`). A row that legacy-recorded through `ATTRIBUTION_FAILURE_WHY` (pushed into `passed` at `routes.js:1592`, recorded by `recordSent` at `routes.js:1616`, so `paid[wallet]` was incremented) therefore ends up **both** paid and permanently listed in `failed` with a misleading reason — and the desk prints it as "row(s) could not be recorded" (`hub-desk.html:641`).

**Minimal fix:** only write `failedNow[w]` from `pass1Refusals` and from `vr.rejected` entries whose `why` is a real refusal for that wallet's *best* candidate; clear the entry for any wallet in `r.recorded`, not only for journaled ones.
Fixed: 43ab968 — scripts/hub-browser-sign-test.cjs (section 18: the exact scenario — a two-wallet batch, one settling through the attribution-failure path, the other genuinely failing — reproduced and pinned)

---

## P2-8 — test §5's idempotency assertion passes for a reason other than its name

`scripts/hub-browser-sign-test.cjs:215-227` asserts "observe twice ⇒ one settle" but the second call is short-circuited at `routes.js:1537-1539` (`state === "settled"` ⇒ `already:true`) and never reaches `ledger.settle`'s consumed-signature check at `lib/hub/ledger.js:169-172`. An implementation that dropped that check entirely would still pass this test. (The property does hold via a second layer — `remaining === 0n` ⇒ `amount_mismatch` — but nothing tests it.) A faithful test needs a two-wallet batch where one row settles and the state stays `submitted`, then re-observes the same signature.
Fixed: 43ab968 — scripts/hub-browser-sign-test.cjs (section "P2-8", a two-wallet batch; the state stays `submitted` so the second observe reaches the real pipeline, not the top-level shortcut)

---

## P2-9 — the other tests do not cover the hazards their sections claim

- `:131` "a second sign-request while `signing` (**nothing broadcast yet**) is allowed" — the server cannot know nothing was broadcast; the test enshrines P0-2.
- `:326` §11 covers only a batch the managed payer sent **in full** (`onPaid` without `pending`, `paid:[…]`, `failed:[]`). The partial/pending managed send — the P0-1 double-pay — is untested; adding the fake vault variant in my probe turns it red.
- `:143` §2 asserts `&send=` is refused during `signing`, but not the reverse the README §3a claims (a concurrent `sign-request` refused with `busy` during a managed send).
- Nothing tests that project A's operator token is refused on project B, nor the lapsed-project case.

Auth itself is sound: `authOf` (`routes.js:154-158`) → `operator.operatorOf` (`lib/hub/operator.js:61-67`) pins the token's `projectId` to `project.id` and re-checks `operatorWallets` on every request; unauthenticated is `notFound(res)` = 404 (`routes.js:1454`, `:1517`), and `mutating-get-guard-test.cjs` pins 405-on-GET and the no-project-exists-hint. Neither new route has a lapsed-access gate — consistent with `/payout`, which has none either, but *not* with the terms write (`routes.js:345`); worth an explicit owner decision rather than an omission.
Fixed: 43ab968 — scripts/hub-browser-sign-test.cjs (section 14: the partial/pending managed-send case, "not offered again"; section 15: cross-project operator token refused, and the reverse `busy` case). The lapsed-project gate is left as the owner decision the finding names — not changed here.

---

## P3-10 — inconsistent freezing of the payment parameters

`observe` reads `mint` from `bt.browserSign.mint` (frozen at sign-request, `routes.js:1542`) but `fundingWallet`/`payoutSources` from the live project record (`routes.js:1543`), while `browserSign.fundingWallet`, `decimals` and `tokenProgram` are persisted and never read. Pick one: freeze all of the settlement-relevant parameters on the batch and use them, or freeze none and read the live record.
Fixed: 43ab968 — froze all of it: `mint`, `fundingWallet` and `payoutSources` (newly added to `browserSign`) are what `observe` reads throughout; `decimals`/`tokenProgram` are persisted for the response shape but are not settlement-relevant (verification is amount-based, never decimal-based) — documented as the chosen policy in `lib/hub/README.md` §3a. Pinned by every existing observe test still passing unchanged (they all settle correctly using the frozen values) plus the P3-10 intent is exercised end-to-end by scripts/hub-browser-sign-test.cjs's dry-run/auth/nonce sections, which never touch the live project record for these fields.

---

## What is correct

- One persist per transition: `observe` lands `batches` + `paid` + every journal entry in a single `hubStore.writeManyVerifiedMixed` (`routes.js:1654`), and `sign-request` touches only `batches` (`routes.js:1499`). A crash immediately after either leaves a consistent, re-runnable state; a crash before leaves nothing. No two-write money window.
- Journal entries land at their own per-transfer kv key (`store.js:journalEntryKey`), so concurrent settlements of different transfers cannot clobber each other.
- The `hublock:<id>:payout` lock is acquired before the `getTx` fetch and released in `finally` on both routes (`routes.js:1459/1507`, `1528/1675`) — the RPC read is inside the critical section, and it is the same key `/payout` holds, so the managed payer and the browser path cannot interleave *within* a request.
- Idempotency of a signature across routes holds at three layers: the `state === "settled"` short-circuit, `ledger.settle`'s `existing` check, and `exactOnly` + `remaining === 0n`. A signature paying wallet A cannot settle row B (token-delta + `locateTransferInstruction` owner match), an oversized or undersized amount is refused, a foreign mint is refused, and a transfer not sourced from `fundingWallet`/`payoutSources` is refused and alerted (`hub-browser-sign-test.cjs:185, 201`).
- `dryRun` is refused before any read, lock or write on both routes, with the `/payout` wording.

---

**Merge-ready: no** — `sign-request` picks rows from the journal alone while every other payer path picks them from the legacy `sent` ledger (P0-1, reproduced), and nothing durable is written before the browser broadcasts while a re-`sign-request` during `signing` is explicitly allowed (P0-2); either one pays a holder twice on an ordinary managed-send timeout or a lost tab, and the second payment is silently discarded by `recordSent` rather than journaled.

