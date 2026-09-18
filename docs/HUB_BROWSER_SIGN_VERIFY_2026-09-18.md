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


---

## Round 2, lens 1 (crash windows and idempotency) — head 5ffc393

# X6 lens 1, round 2 — crash windows and idempotency

Read-only pass on `origin/claude/hub-browser-sign` @ `5ffc393`. No files edited, no git writes, no work-tree touches. I extracted the branch with `git archive` into the scratchpad, ran `scripts/hub-browser-sign-test.cjs` (**30/30 pass**) and `scripts/hub-desk-sign-page-test.cjs` (**12/12 pass**), and drove eleven fault probes against the real route closures through the same DI harness. Findings marked **[probe]** are reproduced output, not reasoning. All line numbers are at `5ffc393`.

---

## Part 1 — are the round-1 findings really closed?

**P0-1 — sign-request re-offered legacy-sent rows. CLOSED.**
`lib/hub/routes.js:1531` `const remaining = pay.remainingOf(bt);` and `:1534` `if (!(wallet in remaining)) { rows.push({wallet, ok:false, error:"already recorded as sent — awaiting confirmation, not offered again"}); continue; }`. This is the intersection the finding asked for, and the skipped wallet is surfaced with a reason. Test §14 (`scripts/hub-browser-sign-test.cjs:481-508`) builds the exact probe scenario — a fake vault whose `onPaid` stamps `{pending:true}` for A and fails B — and asserts A is absent from `rows`, present in `skipped`, and B still offered. A journal-only selection offers A, so the test is red without the fix. Verified independently: **[probe P10]** a managed send that legacy-stamps every row flips `bt.state` to `sent` and `sign-request` then answers `400 batch is sent, not pending`.

**P0-2 — nothing durable before broadcast; re-sign while `signing`. CLOSED** (one deliberate residual).
Server half at `routes.js:1511-1513`: `signing` + no `force` ⇒ 409, and the refusal echoes `{state, nonce}`. Test `:163-172` asserts the 409 *and* that the refused call issued no fresh nonce; `:174-182` asserts `force=1` issues a different one. Client half at `public/hub-desk.html:630` (`!live` is now in `ok`) and `:687-688` (both `sent` **and** `unconfirmed` results persisted to `ROW_STATUS` and pushed to `sigs`), pinned by `hub-desk-sign-page-test.cjs:272-286` (disabled for `signing` *and* `submitted`) and `:291-334`. Two tabs are covered by the server, not the button: a stale tab's `sign-request` gets the 409. Residual, by design and documented: `force=1` re-offers rows whose signatures are genuinely in flight — **[probe P5]** confirms it re-offers the wallet, but also that the old signature is still settleable under the **new** nonce (`200 recorded:[A]`), so the operator can recover instead of double-paying. That is the right trade.

**P1-3 — `&cancel=` unguarded during a browser-sign flow. CLOSED at `&cancel=`, re-opened elsewhere (see N1).**
`routes.js:1177` refuses 409 while `browserSignIsLive(bt0)`, with the F2 reasoning at `:1170-1176`. `observe` independently refuses a non-`pending` batch twice — `:1615` on the lock-free pre-read and `:1669` on the fresh in-lock read. Test §12 (`:422-448`) covers both, including a hand-forged `cancelled` state to prove the second check is not dead code. The desk gates CLOSE on `bsLive` (`hub-desk.html:548`).

**P1-4 — `submitted` was a dead end. CLOSED.** Both named fixes shipped: the null-`getTx` case is now 503/retry (`:1652-1655`) and the owner-only reset exists (`:1476-1491`). Test §13 (`:450-479`) proves an operator gets 403, the owner gets `cleared:true`, amounts/state/journal are untouched, and a fresh `sign-request` then succeeds **without** `force`. Residual unchanged and acknowledged in the fix note: a row that settles through `ATTRIBUTION_FAILURE_WHY` is legacy-recorded but never journaled, so `stillOwed` (`:1779`, journal-derived) stays true and pins `submitted` for good — an ordinary batched/ambiguous transaction therefore still needs the owner. That matters because the lever it forces you onto is N1.

**P1-5 — RPC outage vs null. CLOSED.** `:1645` (throw) and `:1652-1655` (null) return the same 503 `retry:true` shape before the lock is ever taken. Tests `zeta1`/`zeta2` (`:296-328`) assert the batch JSON is **byte-identical** afterwards and that `failed` stays `{}`. A broken implementation that wrote `failed` or advanced state fails on the byte-compare.

**P2-6 — the nonce was decorative. CLOSED, and load-bearing.** Required at `:1591`/`:1619-1621` (pre-read) and re-checked against the fresh read at `:1672-1674`. Test §16 (`:542-568`) covers both the missing and the superseded nonce. This is also what makes the new lock-free pre-read safe (see Part 2).

**P2-7 — `failed[wallet]` recorded wrong reasons. PARTIAL.** Fixed for the *within-one-call* cross-product noise (`NOISE_WHY_RE` at `:1789`, the `byWallet.has` skip at `:1794`, the `r.recorded` clear at `:1802`), and test §18 (`:586-612`) reproduces the exact attribution-failure-plus-genuine-failure scenario. But the *across-calls* case is wide open — see **N2**, reproduced.

**P2-8 — the idempotency test passed for the wrong reason. CLOSED.** `:270-294` uses a two-wallet batch, asserts `browserSign.state === "submitted"` so the top-level short-circuit cannot fire, and asserts `!second.body.already` — i.e. it genuinely reaches the pipeline. (It is `remaining === 0n` ⇒ `amount_mismatch` that stops A and the ledger's consumed check that stops B; both are the real second layer.) Note the test never inspects `failed` on that second call, which is precisely why N2 was invisible to it.

**P2-9 — tests did not cover what their names claimed. CLOSED as scoped.** §1 inverted, §14 (partial/pending managed send), §15 (cross-project token ⇒ 404; concurrent `&send=` ⇒ `busy` through the shared lock). Lapsed-project access left as the owner decision the finding named.

**P3-10 — inconsistent freezing. CLOSED.** Frozen at `:1555-1558` (`mint`, `decimals`, `tokenProgram`, `fundingWallet`, `payoutSources`), read back at `:1681-1683` and used throughout `verifyBatchRows`/`locateTransferInstruction`/`settleAndPersist` (`:1700`, `:1726`, `:1746`). **[probe P6]** rotating the project's `fundingWallet` between sign-request and observe still settles the old-wallet transfer (`200 recorded:[A]`) — the correct answer for a transfer the operator was told to make. See N7 for the missing staleness bound.

---

## Part 2 — new findings

### N1 (P1) — `sign-request?clear=1` silently re-opens the exact double-pay window F2 was built to close
`lib/hub/routes.js:1476-1491`, against the F2 reasoning at `:1170-1176`.

`clear=1` nulls `browserSign`, which makes `browserSignIsLive(bt)` false, which un-blocks `&cancel=`. `cancelBatch` returns every row with no settlement to `available` — and a wallet the sign-request handed out, that the operator broadcast for but never observed, has no settlement on file. **[probe P8]**, two wallets, A offered and (in the real world) broadcast but never observed, B observed:

```
P8 observe B:        200 state submitted recorded [B] failed []
P8 clear:            200 {"ok":true,"cleared":true,"batchId":"hb_a6136331cc"}    <-- no warning, no wallet list
P8 cancel after clear: 200 "hb_a6136331cc"
P8 re-export owes:   {"4Gccq9pE…":"1000000000"}    <-- A drawn again, full amount
P8 alerts:           []
```

The route comment claims "nothing here can ever un-journal a real settlement" — true, and `clear` is correctly safe for journaled rows (**[probe P4]**: after a real observed settle, clear + fresh sign-request re-offers only the unpaid wallet and lists the paid one in `skipped`). The hazard is the unjournaled, unobserved handout, which is the whole reason F2 exists. It is made worse by P1-4's residual: an ordinary batched/ambiguous transaction pins `submitted`, and `clear=1` is the documented remedy, so this is not an exotic path.

**Minimal fix:** in the clear branch, compute `atRisk = (bt.browserSign.wallets||[]).filter(w => !(bt.sent && bt.sent[w]) && ledger.rowState(bt, w, entries)?.remainingRaw !== "0")`. If `atRisk.length`, refuse unless a second explicit flag (`confirm=abandon-broadcast`) is passed, and echo `atRisk`, `observedSigs` and `nonce` in the 200 body and the console line either way.
Fixed: 6d2480f — scripts/hub-browser-sign-test.cjs (section 13b: "clear=1 with an unobserved, at-risk wallet is refused… listing it in atRisk", "clear=1&confirm=abandon-broadcast clears it anyway and echoes…", "a JOURNALED (fully paid) wallet is never at-risk…") plus section 13's own test updated to pass `confirm=abandon-broadcast`.

### N2 (P1) — an ordinary idempotent re-observe marks a PAID row failed and fires a fraud alert
`lib/hub/routes.js:1706-1710` and `:1790-1802`.

The README promises "Observing the same signature twice is exactly as idempotent as reporting it to `&sent=` twice". It is not, on the reporting side. **[probe P1 / P9]**, two-wallet batch, observe `SIG_A` twice:

```
PROBE1 second: 200 recorded [] failed {"4Gccq9pE…":{"why":"amount_mismatch"},
                                       "5WKKoF7L…":{"why":"transfer_already_consumed"}}
PROBE1 A paid? true   (stored on the batch, not just in the response)
P9 alerts on an idempotent retry:
  ["p9: batch hb_… — 2 browser-signed settlement REFUSED (not recorded):
     transfer_already_consumed x1, amount_mismatch x1 — wallets 5WKKoF…, 4Gccq9…"]
```

Two separate lies. (a) Wallet A is paid and journaled; its remaining is 0, so PASS 1 refuses its own signature as `amount_mismatch`, `refusePass1` writes `failed[A]`, and `:1802` cannot clear it because A is not in `r.recorded` any more. The entry persists for the life of that `browserSign`, including into the terminal `settled` record, and `hub-desk.html:702` prints "1 row(s) could not be recorded: A (amount_mismatch)" for a row that is paid. (b) Wallet B — which has nothing to do with that signature — is rejected as `TRANSFER_ALREADY_CONSUMED_WHY`, which is not caught by `NOISE_WHY_RE`, so it is written into `failed[B]` **and** into `alertRefusals` (`:1709`), raising the adv P0-2a cross-project-reuse **fraud** alert into the operator room on a plain retry. The same shape appears without any retry: **[probe P2]** recording a row through `&sent=` (the desk's own "record on server" recovery button) between sign-request and observe leaves `failed = {A: amount_mismatch}` on a row `&sent=` just paid, while the call reports `state: settled`.

**Minimal fix:** (a) before writing `failedNow[w]`, skip any wallet whose post-pass `ledger.rowState(finalBatch, w, finalEntries).remainingRaw === "0"` — nothing owed is not a failure; (b) at `:1709`, suppress a `TRANSFER_ALREADY_CONSUMED_WHY` whose consuming journal entry names this same `projectId`+`batchId` (it is our own prior settlement, not a reuse) from both `alertRefusals` and `failedNow`.
Fixed: 6d2480f — (a) also extended to `alertRefusals` itself (an `amount_mismatch`/`duplicate_settlement_candidate` refusal against an already-zero-remaining row raises no alert either, matching the "no alert" requirement) — scripts/hub-browser-sign-test.cjs (section 19: "observing the same signature twice on a two-wallet batch: the second call's `failed` is empty for the paid wallet and raises no alert"); (b) scripts/hub-browser-sign-test.cjs (section 19: "a &sent= landing between sign-request and observe… leaves NO `failed` entry for that now-paid row").

### N3 (P2) — observe is all-or-nothing on unindexed signatures, and the desk deliberately sends the signatures most likely to be unindexed
`lib/hub/routes.js:1652-1655`; `public/hub-desk.html:688, 693`.

`notYetIndexed.length` aborts the **whole** call, so signatures that *are* indexed settle nothing. **[probe P3]**: two sigs, one indexed, one not → `503 … has not indexed 1 of these signature(s) yet`, `A paid? false`, `state signing`. Meanwhile the F5 fix at `:688` now pushes `unconfirmed` results (30 s confirm timeout) into `sigs` — exactly the ones the RPC is least likely to have indexed — and `:693` calls observe seconds after `CluckAirdrop.send()` returns, with no retry and no backoff. The likely day-one outcome is a 503, `browserSign` still `signing`, and SEND / SIGN AND SEND / CLOSE all disabled behind `bsLive` (`hub-desk.html:547-548, 630`). It is recoverable — `&sent=` is not blocked while live and the per-row "record on server" buttons exist for both `sent` and `unconfirmed` rows (`hub-desk.html:504, 506`, confirmed by probe P2) — but the feature's own path is stuck, and it leads straight into N5.

**Minimal fix:** drop `notYetIndexed` from `sigs`, settle the rest, never advance to `settled` while any remain, and return 200 with `pendingSigs` + `retry:true`; or, at minimum, have `signAndSend()` retry observe on a 503 with `retry:true` after a short backoff before surfacing the error.
Fixed: 6d2480f — both halves: server returns `pending`/`retry:true` on a partial resolve and settles the rest (never advancing to `settled` while any signature is still unindexed), and `call()`/`observeAll()` in `hub-desk.html` retry the outstanding signatures with backoff, up to 3 tries, before surfacing — scripts/hub-browser-sign-test.cjs (section 20: partial resolve settles+reports pending+stays `submitted`; "even when the resolved signature settles EVERY named row, the state stays `submitted`…"; all-unindexed unchanged) and scripts/hub-desk-sign-page-test.cjs (section "N3": the partial-then-settle retry, and the thrown-503 3-tries-then-surface case).

### N4 (P3) — `unrecordedSent()`, the guard F5 leans on, still ignores `unconfirmed`
`public/hub-desk.html:572`, used at `:578`, `:646`, `:729`; purge at `:580`.

F5's own comment (`:683-686`) says an `unconfirmed` result "may still land" and must never be dropped, and the fix duly reports it to observe. But the double-pay guard still filters `l.status === "sent"` only, so an unconfirmed-but-landed row blocks neither a re-sign nor a CLOSE, and `send()`'s purge at `:580` deletes its `ROW_STATUS` entry outright — taking its "record on server" button with it. `bsLive` masks most of this today (the buttons are disabled while the flow is live), which is why this is P3 and not higher; it is exposed once `browserSign` is cleared or `settled`. The page test's "refuses to run again" case (`hub-desk-sign-page-test.cjs:291-321`) uses `status:"sent"`, and the `unconfirmed` case (`:323-334`) only covers a *successful* observe, so neither catches it.

**Minimal fix:** `:572` → `return !r.sent && l && (l.status === "sent" || l.status === "unconfirmed") && l.sig;`, and make `:580`'s purge keep `unconfirmed` too.
Fixed: 6d2480f — exactly this change, both sites (`unrecordedSent()` and `send()`'s purge) — scripts/hub-desk-sign-page-test.cjs (section "N4": an unconfirmed row blocks SIGN AND SEND / SEND from re-broadcasting, and the purge keeps an unconfirmed sig-less entry that the old code would have dropped).

### N5 (P3) — `&sent=` flips `bt.state`, pinning `browserSign` at `signing` forever; the README says it cannot
`lib/cuna-payout.js:246-250`; `routes.js:1505, 1669`; `lib/hub/README.md` §3a ("What still works while live: `&sent=`, `&waive=`, and the per-row 'record on server' recovery buttons — **none of those touch `browserSign` or `bt.state`**"). `recordSent` flips a pending batch to `sent` once every row is recorded. **[probe Q1]**, recovering the last row with the row button:

```
Q1 after &sent= of every row: bt.state = sent | browserSign.state = signing
Q1 observe now:      400 batch is sent, not pending
Q1 sign-request:     400 batch is sent, not pending
Q1 cancel:           409 a browser-signed payout is signing for this batch
Q1 browserSign stuck at: signing   (browserSignIsLive forever)
```

The money is fine (the batch is fully paid), but the state machine has no terminal transition for it and the contract doc is wrong — which matters because the only tidy-up is the owner's `clear=1`, i.e. N1's lever.

**Minimal fix:** in `observe`, treat `bt.state === "sent"` with nothing still owed as the `already:true` terminal rather than a 400, or stamp `browserSign.state = "settled"` when `recordSent` completes a batch; and correct the README sentence.
Fixed: 6d2480f — stamps `browserSign.state = "settled"` in the same persist when `&sent=` completes the batch while live (the `&confirm=` half is instead refused outright while live, P2-7, so it can never reach this state) — scripts/hub-browser-sign-test.cjs (section 25: "recording the last row via &sent= while browserSign is signing flips it straight to settled"); README corrected (lib/hub/README.md §3a).

### N6 (P3) — the clear branch runs before the dry-run refusal and reports nothing it discarded
`routes.js:1476` (clear) sits above `:1496` (`if (p.dryRun) …`), so a dry-run project accepts a clear — harmless, but the only branch on either route that does. The 200 body is `{ok, cleared, batchId}`: `wallets`, `observedSigs`, `nonce` and `failed` are destroyed with no echo, so after a clear there is no record anywhere of what the sign-request handed out (the journal and legacy `sent` rows survive, the handout does not). Fold the echo into N1's fix and move the dry-run check above the branch.
Fixed: 6d2480f — the dry-run check now runs before `clear=1` (before any branch on the route), and the clear response echoes `atRisk`/`observedSigs`/`failed`/`nonce` per N1's fix above — scripts/hub-browser-sign-test.cjs (section 13b covers the echo; dry-run-first ordering is structural, read-verified).

### N7 (P3) — a frozen `browserSign` never expires
`routes.js:1555-1558` / `:1681-1683`. The freeze is right (probe P6), but there is no staleness bound on it — only `notBefore: bt.at`. A months-old `signing` record can still credit a transfer made from a since-rotated funding wallet at any time after the batch was created. **Minimal fix:** refuse an observe whose `browserSign.requestedAt` is older than a bounded window (24 h), with the "request a fresh one" wording the nonce mismatch already uses; the row's money is unaffected and a fresh sign-request re-offers it.
Fixed: 6d2480f — 24h bound added, "request a fresh sign-request" wording — scripts/hub-browser-sign-test.cjs (section 21: "observe refuses a sign-request more than 24h old…"; "well within 24h, observe proceeds normally").

### N8 (P3) — `skipped` is not the complement of `rows`
`routes.js:1536`: `if (!rs || rs.remainingRaw === "0") continue;` drops a zero-remaining row from **both** `rows` and `skipped`, so a fully-waived or journalled-to-zero wallet simply vanishes from the response the P0-1 fix otherwise made complete. `rows.push({wallet, ok:false, error:"nothing remaining on this row"})`.
Fixed: 6d2480f — exactly this — scripts/hub-browser-sign-test.cjs (section 22: "a fully waived row (remaining 0) appears in `skipped`… not dropped entirely").

---

## The specific questions asked

**Can the batch change between the RPC fetch and the lock?** Yes, and it is handled. Everything carried across the gap is either client input (`sigs`, `nonce`) or immutable chain data (`txBySig`); `preWallets` is used only for the `:1626-1628` bounds. Inside the lock, `bt`, `paid`, the journal, `remainingByWallet`, `notBefore`, `wallets` and all frozen parameters come from a **fresh** read (`:1662-1700`), and four re-checks fire before any write: `!bt.browserSign` (a `clear=1` landed) `:1665`, terminal state `:1666`, `bt.state !== "pending"` (a cancel landed) `:1669`, and the nonce (a `force=1` landed) `:1672`. A managed `&sent=` in the gap is the one thing that can change the batch without tripping any of them — and it is safe for money (fresh `rowState` ⇒ `amount_mismatch`, `recordSent` ⇒ "already recorded"), but it is what produces N2's false `failed` and N5's pin. **[probe P2]** confirms both. A managed `&send=` cannot interleave at all (`:1307`).

**Is `clear=1` safe after a real broadcast?** For a *journaled* settlement, yes — probe P4. For a broadcast that was never observed, no — that is N1.

**Does `force=1` re-offer in-flight rows?** Yes, by design and with an explicit warning in the 409 it replaces; probe P5 also shows the old signature stays settleable under the new nonce, so the operator has a non-destructive recovery.

**Is every multi-key write one `writeManyVerified`?** Yes. `observe` lands `batches` + `paid` + every journal entry in a single `hubStore.writeManyVerifiedMixed` (`:1806`), which funnels into `kv.setManyVerified` (`lib/hub/store.js:79-84`) — all-or-nothing in both the real kvstore and the test kv. `sign-request` and `clear=1` each touch only `batches` via `writeVerified`. The only write outside the money persist is `markMilestone` (`:1807`), which writes the registry after the fact and cannot lose money.

**Does the frozen-parameters policy create a rotation window?** It settles old-wallet transfers, which is correct — the operator was told to pay from that wallet and the holder was really paid. The gap is the unbounded lifetime, N7.

---

## Findings table

| Finding | Verdict | Evidence |
|---|---|---|
| P0-1 sign-request ignored the legacy `sent` ledger | **CLOSED** | `routes.js:1531,1534`; test §14 `:481-508`; probe P10 |
| P0-2 nothing durable before broadcast / re-sign while `signing` | **CLOSED** | `routes.js:1511-1513`; `hub-desk.html:630,687-688`; tests `:163-182`, page test `:272-334` |
| P1-3 `&cancel=` unguarded mid-flow | **CLOSED** (re-opened by N1) | `routes.js:1177,1615,1669`; test §12 `:422-448` |
| P1-4 `submitted` was a dead end | **CLOSED** (attribution-failure pin remains, exit is N1's lever) | `routes.js:1652-1655,1476-1491`; test §13 `:450-479` |
| P1-5 null `getTx` reported as permanent failure | **CLOSED** | `routes.js:1645,1652-1655`; tests `:296-328` (byte-identical) |
| P2-6 nonce generated but never checked | **CLOSED** | `routes.js:1591,1619-1621,1672-1674`; test §16 `:542-568` |
| P2-7 `failed[wallet]` records a wrong reason | **PARTIAL** — same-call noise fixed, across-call case open (N2) | `routes.js:1789-1802`; test §18; probes P1/P2/P9 |
| P2-8 §5's assertion passed for the wrong reason | **CLOSED** | test `:270-294` |
| P2-9 tests did not cover their claims | **CLOSED** as scoped | tests §14, §15, §1 |
| P3-10 inconsistent parameter freezing | **CLOSED** (no expiry — N7) | `routes.js:1555-1558,1681-1683`; probe P6 |

New: **N1 (P1)**, **N2 (P1)**, **N3 (P2)**, **N4–N8 (P3)**.

**Merge-ready: no** — `sign-request?clear=1` (`routes.js:1476-1491`) hands the owner a one-call bypass of the F2 cancel guard that re-draws an already-broadcast, unobserved row into a fresh batch with no warning and no record of what it discarded (**[probe P8]**), and an ordinary idempotent re-observe writes `failed: amount_mismatch` onto a paid, journaled row while firing the `transfer_already_consumed` fraud alert at the operator room (**[probe P9]**). Both are small, local fixes; with N1 and N2 closed and N3 decided, the rest are P3 polish and I would merge.


---

## Round 2, lens 2 (adversary and browser) — head 5ffc393

# X6 lens 2, round 2 — adversary and browser

Read-only re-review of `origin/claude/hub-browser-sign` @ `5ffc393`. All line numbers are at that revision. I extracted the branch with `git archive` into the scratchpad and **ran** both suites (`hub-browser-sign-test.cjs` 30/30, `hub-desk-sign-page-test.cjs` 12/12), then ran **negative mutations** of each fix to prove the tests bite, plus seven adversarial probes against the real route closures and the real inline page script. Probe output is quoted, not reasoned. The work tree was never touched (`git status` clean, still on `claude/colosseum-batch-18`).

---

## Part 1 — are F1–F10 real, complete, and test-backed?

I mutated the branch in a scratchpad copy and re-ran. Results (each line = "remove the fix → this many tests fail"):

| mutation | result |
|---|---|
| `signing` refusal → `if (false)` | 1 FAILED (§1, inverted test) |
| nonce checks (both) → `if (false)` | 2 FAILED (§16) |
| cancel `browserSignIsLive` → `if (false)` | 1 FAILED (§12) |
| both `state !== "pending"` in observe → `if (false)` | 1 FAILED (§12) |
| `who !== "owner"` on `clear=1` → `if (false)` | 1 FAILED (§13) |
| strip `walletIsFunding`, `!live`, ROW_STATUS persist, `unrecordedSent()`, mint/dec/row checks from the page | **9 of 12 page tests FAILED** |

The page test is honest: it extracts the real inline script from `public/hub-desk.html` (throws if the anchor text moves) and runs it in a vm. A broken implementation does **not** pass it.

**F1 — CLOSED.** `public/hub-desk.html:546,547` (SEND), `:629,630` (SIGN AND SEND), `:554,634` (the reason lines), `:640` and `:643` (belt-and-braces inside `send()`/`signAndSend()`), `:654` (`sr.fundingWallet !== WALLET` after the call). Both buttons and both functions. See new findings P2-4/P2-5 for what the check gets *wrong* and what the server still does not check.

**F2 — CLOSED.** `lib/hub/routes.js:1177` (409 on `&cancel=` while live), `:1616` (pre-lock `preBt.state !== "pending"`), `:1668` (the same check re-run in-lock), `hub-desk.html:548` (CLOSE disabled while `bsLive`). Two independent layers; removing either fails a test. See P2-7 — `&confirm=` was left out of the same class.

**F3 — CLOSED.** `routes.js:1511-1513` (409 from `signing` unless `force=1`), `hub-desk.html:626,630` (`!live` is now inside `ok`). §1's old test really was inverted, not just renamed.

**F4 — CLOSED, and the auth path is sound.** `routes.js:1477-1493`. `who !== "owner"` → 403. `authOf` (`routes.js:154-158`) returns `"owner"` **only** from `adminAuthOK(req)`; the operator branch returns `operator.operatorOf(...)`, which returns `t.wallet` (`lib/hub/operator.js:59-64`) — a base58 address validated through `addr()` at `lib/hub/project.js:97`. An operator token can never produce the literal `"owner"`. **An operator token holder cannot call `clear=1`** — confirmed by §13 and by mutation. See P2-6 for what the clear destroys.

**F5 — PARTIAL.** The persistence (`hub-desk.html:687`) and the guard (`:646`) are real and the page test proves both. But `unrecordedSent()` (`:572`) still matches **only** `status === "sent"`, while this same commit started persisting and reporting `"unconfirmed"` as a real broadcast (`:688`). That hole is new P1-1 below, and I reproduced a double broadcast through it.

**F6 — CLOSED** (with a P3 note). `:658,659` (mint/decimals), `:661-666` (wallet membership + amount ceiling), `:671` (`askConfirm` after sign-request, quoting `sr.rows.length` and the BigInt sum of `sr.rows[].amountRaw`). Four page tests, all fail when stripped. *On "is that the right side to trust":* `MINT`/`DEC` come from `/desk` at page load and `sr.mint`/`sr.decimals` from the live project record — **both sides are the server**, so this catches an owner edit mid-session and a tampered response but not a wrong project record. The one value the browser could verify independently is the mint's decimals, and `CluckAirdrop.send` silently **overrides** `sr.decimals` with the on-chain value (`public/airdrop-engine.js:336-340`) *after* the page has already converted raw→human with `sr.decimals` (`hub-desk.html:674`). In practice unreachable — `p.rewardDecimals` is chain-read via `readMint()` at registration (`routes.js:249,262,711`) and SPL decimals are immutable — so P3, not P1. Noted as P3-9.

**F7 — CLOSED.** `routes.js:1626-1628` (maxSigs = wallets+5, and the 500-pair product cap), `:1698` (`hubEntries` hoisted once), `:1712` (`trialEntries` grown by `concat` of the one xferKey `settleAndPersist` returns, not re-scanned), `:1766` (`finalEntries` hoisted and reused by both `stillOwed` and `remainingWallets`). §17 covers the bound; the hoists are read-verified and correct (`settleAndPersist` returns exactly one xferKey, and `journalFor` filters on the same `projectId`).

**F8 — CLOSED.** `routes.js:1632-1647`: a pool of 3, `await Promise.all`, 503 on any throw, and `lockAcquire` only at `:1657`. Read-verified. No dedicated test — the commit message's "exercised by every existing observe test still passing" is true only in the weak sense; the ordering itself is unguarded. Acceptable, but the lock-ordering is the kind of thing a later refactor silently undoes.

**F9 — CLOSED.** `routes.js:1591` (parsed), `:1619-1621` (pre-lock), `:1672-1674` (re-checked in-lock against the fresh read, which is what actually catches a `force=1` or a `clear=1` landing in the window). §16 covers both the missing and the wrong nonce. See P1-2/P2-6 for what the nonce requirement costs on the recovery side.

**F10 — CLOSED, with one doc inaccuracy.** `hub-desk.html:132` now names exactly what is blocked and what still works; `const kv = arguments` is gone from `scripts/hub-browser-sign-test.cjs`; the page test exists and is wired into `.github/workflows/syntax-check.yml` as an always-run step next to the server suite. The inaccuracy is in `lib/hub/README.md` §3a — see P3-8.

**i18n — clean.** Programmatic check over every `t()`/`tf()` literal in `hub-desk.html`: **17 keys, present in all six dictionaries** (es/hi/it/pt/vi/zh, 1644 keys each, equal counts), placeholders `{state} {n} {reasons} {amount} {wallet}` match one-for-one, none left identical to English, no APR/APY/yield/guaranteed language anywhere in them, no `en.json` (correct for this repo).

**Escaping — clean.** Every new `innerHTML` assignment in the `hub-desk.html` diff goes through `esc()` (`CluckUtil.esc`) except one static English literal (`:646`). The new status/failure/reason lines — `bs.state`, `bs.failed[w].why`, the joined `reasons`, `e.message` — are all escaped at the join (`:632`, `:701`, `:703`). The `unconfirmed` row renders through the pre-existing `UNCONFIRMED` pill + `txLink()` (`encodeURIComponent` in the href, `esc` in the text) + `recordBtn` (both attributes `esc`'d) — no leak, no mis-render.

---

## New findings

### P1-1 — `unrecordedSent()` ignores `unconfirmed`, so the fix round's own new unconfirmed-persistence re-broadcasts a transfer that may have landed
`public/hub-desk.html:572` vs `:687-688`

`:688` deliberately treats `"unconfirmed"` as a real broadcast ("dropping it here could report 'nothing broadcast' for a transfer that actually landed") and `:687` persists it. But `unrecordedSent()` at `:572` filters `l.status === "sent"` only — so the guard F5 added at `:646` (and the pre-existing one at `:578` and `:729`) never sees it.

**Reproduced** (page-test harness, real inline script): ROW_STATUS seeded with `{status:"unconfirmed", sig}` and `browserSign: null` (i.e. after the owner's F4 reset) →

```
signSend disabled: false
CluckAirdrop.send calls: 1     <-- re-broadcast the same row
status: Settled — every row this batch named is fully paid.
```

The same seed with `status:"sent"` → `CluckAirdrop.send calls: 0`, guard held. **Scenario:** an ordinary 30 s confirm timeout on a congested network; the first `observe` 503s (see P1-2, which is the *common* case seconds after broadcast); the operator asks the owner to clear the stuck flow (the documented remedy the 409 text itself points at); the button re-enables, the guard reads empty, the wallet signs a second transfer, and if the first landed the locker is paid twice. The second one settles cleanly because the first was never journaled.
*Minimal fix:* `return !r.sent && l && (l.status === "sent" || l.status === "unconfirmed") && l.sig;` — the UNCONFIRMED row already renders its own "record on server" button, so the recovery UI exists.
Fixed: 6d2480f — same finding as lens 1's N4, closed there — scripts/hub-desk-sign-page-test.cjs (section "N4").

### P1-2 — one dropped signature 503s every `observe` for that batch, permanently, and the desk can only ever send the whole set
`lib/hub/routes.js:1649-1655`, `public/hub-desk.html:693`

`notYetIndexed` is all-or-nothing: if **any** submitted signature resolves `null`, the whole call returns 503 `"try again in a few seconds"` and nothing is recorded. A dropped transaction (blockhash lapsed, never landed) is never indexed — and the page reports exactly those as `"unconfirmed"` (`airdrop-engine.js:395-400`) and pushes them into `sigs`.

**Probe A** (multi-transaction batch, SIG_OK landed, SIG_DROPPED never indexed):
```
observe status: 503  "the chain has not indexed 1 of these signature(s) yet — try again in a few seconds"
batch state: pending | browserSign: signing | sent: [] | journal entries: 0
retry status: 503
observe(good only) status: 200  recorded ["4Gccq9…"]
```
The landed one is recoverable — but **only by sending a subset**, and `hub-desk.html:693` always sends the full `sigs` array and never retries. So from the UI the flow is stuck in `signing` forever: SIGN AND SEND disabled (`!live`), CLOSE BATCH disabled, the managed payer 409s, and the status line says "reload to check its progress", which can never change anything. The only exits are the per-row `&sent=` buttons (which do work — probe E) or the owner reset, which lands you in P1-1.
*Minimal fix:* drop the unindexed signatures, process the ones that resolved, return the rest in `pending` with `retry:true`, and 503 only when **none** resolved. `zeta2` (§6) only covers the all-null case, so nothing catches this today.
Fixed: 6d2480f — same finding as lens 1's N3, closed there — scripts/hub-browser-sign-test.cjs (section 20) and scripts/hub-desk-sign-page-test.cjs (section "N3").

### P1-3 — merge hazard: the branch is 3 commits **behind** `origin/develop`, and the diff as presented reads as 1,945 deletions of develop's work
`git merge-base origin/develop origin/claude/hub-browser-sign` → `115aa18`; `origin/develop` is at `b3ca3e2`, three PRs ahead (#353, #355, #356).

`git diff origin/develop..branch` therefore shows develop's newer work as removals: `docs/CODEX_REVIEWER_BRIEF.md`, `docs/POKEAHOE_REHEARSAL_2026-09.md`, all 13 `docs/demo/2026-09-18/*.png`, **and two CI test files** (`scripts/hub-registry-test.cjs`, `scripts/demo-storyboard-inventory-test.cjs`). Worse, develop changed the *same files this branch rewrote*: `public/hub-desk.html` (+12 — the GG3 funding-wallet prerequisite warning in `renderTermsForm`), `lib/hub/routes.js` (+25 — `HUB_REGISTRY_FIELDS` unknown-field refusal and the `accessTier` alias), `lib/hub/project.js` (+12), and all six i18n files. CLAUDE.md's standing conflict rule ("keep the branch side — it is the superset") is **false here** and would silently revert that work.
*Minimal fix:* merge `origin/develop` into the branch and re-run both suites before the PR is looked at again. Nothing below was assessed against a merged tree.
Fixed: this round's builder merged `claude/hub-browser-sign` into a fresh worktree branched from `develop` (head `386c759`, itself a fast-forward superset already carrying this branch's tip) before any other change — the round-2 findings below were all read and fixed against that merged tree, never the pre-merge one.

### P2-4 — F1's client check is stricter than the server's own rule: it accepts `fundingWallet` only, never `payoutSources`
`public/hub-desk.html:546,629,654` vs `lib/hub/routes.js:919` and `:1684`

The server accepts a settlement sourced from `fundedBy = [fundingWallet, ...payoutSources]` — the owner-set allowlist the admin route documents at `routes.js:262-272` ("these wallets, plus fundingWallet, are now accepted as a settlement's source"). The page hardcodes `WALLET === DESK.project.fundingWallet`, and `sign-request`'s response carries only `fundingWallet` (`:1566`), so `:654` is stuck the same way. A project configured to pay from an allowlisted vault/treasury wallet now has **both** buttons permanently disabled, and its operator's only route is a terminal broadcast plus the per-row `&sent=` buttons — the *less* guarded path.
*Minimal fix:* `publicProject` already exposes `payoutSources` (`routes.js:92`); compare against `[fundingWallet, ...payoutSources]`, and add the frozen `payoutSources` to the sign-request response so `:654` can use the same list. Also worth saying in the readiness item: `readiness.js:86-93` tells projects to keep `fundingWallet` **out of** `operatorWallets`, and `/desk/challenge` only issues a session to an operator wallet (`routes.js:422`) — so with the readiness-"ok" configuration, both payout buttons are owner-key-only in practice. That is consistent with the existing COMMIT button (`hub-desk.html:390`), so not a regression, but it deserves a line in §3a.
Fixed: 6d2480f — `acceptedWallets()`/`walletIsAccepted()`/`acceptedWalletsText()` in `hub-desk.html` compare against `[fundingWallet, ...payoutSources]` everywhere F1's check ran, the reason line names every accepted wallet, and `sign-request` now returns `payoutSources` alongside `fundingWallet` — scripts/hub-desk-sign-page-test.cjs (section "P2-4": a payoutSources wallet accepted for both buttons; the reason line names the accepted wallets; sign-request's own frozen payoutSources widens the belt-and-braces check).

### P2-5 — the server hands transfer parameters to any operator session, including one whose own wallet is not the funding wallet
`lib/hub/routes.js:1461`

F1 is a browser-only fix. `authOf` returns the operator's **actual wallet address** (`operator.js:63`), so the server knows who is asking and could refuse cheaply — it doesn't. A curl user, or a stale tab, still gets a full sign-request, broadcasts from the wrong pocket, and the batch goes to `submitted` with an unattributable transfer (probe B reproduces exactly this state). The client check is the only thing standing there.
*Minimal fix:* after `const who = authOf(req, p)`, refuse unless `who === "owner" || who === p.fundingWallet || (p.payoutSources || []).includes(who)`, naming the funding wallet in the error.
Fixed: 6d2480f — exactly this check, added right after the batch lookup, 403 naming the funding wallet — scripts/hub-browser-sign-test.cjs (section 23: "an operator wallet that is NOT the funding wallet… is refused 403"; "the funding wallet itself, connected as an operator, is allowed (200)").

### P2-6 — the owner reset and `force=1` both discard `observedSigs`/`failed`, and the clear echoes nothing about what it overrode
`lib/hub/routes.js:1486`, `:1555-1560`, `:1489`

**Probe B:**
```
before clear: state submitted  observedSigs 1  failed ['4Gccq9…']
clear response: 200 {"ok":true,"cleared":true,"batchId":"hb_775f66571d"}
after clear:  browserSign = null
fresh sign-request re-offers: [ ['4Gccq9', '1000000000'] ]
```
**Probe C** (`force=1`): nonce rotates, and the new object's keys are `nonce,idempotencyKey,state,requestedAt,mint,decimals,tokenProgram,fundingWallet,payoutSources,wallets,failed` — no `observedSigs`. Either way the server's only record of which signatures this flow already presented is destroyed, and those signatures can no longer be observed at all (old nonce → 409, confirmed). That record is precisely what the owner needs to decide whether clearing is safe, and what P1-1 needs to not double-pay.
*Minimal fix:* keep it — e.g. `browserSign = { state: "cleared", clearedAt, observedSigs, wallets, failed }` (treat `"cleared"` as not-live) instead of `null`, carry `observedSigs` through a `force=1` re-request, and echo the cleared `observedSigs`/`failed` in the 200 so the owner sees what they are overriding.
Fixed: 6d2480f — exactly this, folded into N1's rewrite of the clear branch — scripts/hub-browser-sign-test.cjs (section 13b: "clear=1&confirm=abandon-broadcast clears it anyway and echoes… atRisk/observedSigs/failed/nonce"; "a `cleared` browserSign is NOT live"; "force=1 after a clear carries `observedSigs` forward into the new sign-request").

### P2-7 — `&confirm=` is not blocked while a browser-signed flow is live (the one-liner F2 added to `&cancel=`)
`lib/hub/routes.js:1162-1167`

**Probe D:**
```
confirm status: 200  "hb_7f5ce190ae"
batch state now: sent | browserSign: signing | sent: {"4Gccq9…":{"sig":null,"at":…,"manual":true}}
observe after confirm: 400  "batch is sent, not pending"
journal entries: 0
```
No double payment (`confirmBatch` marks rows paid, it does not return them to owed), but a real broadcast for that batch can then never be journaled: the signature never enters the global consumed set, `reconcile` will report the row divergent forever, and if the broadcast actually failed the rows are marked paid manually with `sig:null`.
*Minimal fix:* the same `if (browserSignIsLive(bt0)) return 409` on the `b.confirm` branch.
Fixed: 6d2480f — exactly this, same wording as `&cancel=` — scripts/hub-browser-sign-test.cjs (section 24: "&confirm= is refused (409) while browserSign is signing…").

### P3-8 — `lib/hub/README.md` §3a mis-states what still works while live
It says: *"**What still works while live:** `&sent=`, `&waive=`, and the per-row recovery buttons — none of those touch `browserSign` or `bt.state`."* **Probe E** shows `&sent=` flipping the batch straight to `bt.state: "sent"` while `browserSign` stays `signing`. And `&confirm=` — which also still works and also flips `bt.state` (probe D) — is not in the list at all. CLAUDE.md's "public docs must match the code" applies to a money runbook more than to anything else.
Fixed: 6d2480f — `lib/hub/README.md` §3a rewritten: `&confirm=` moved into "what is blocked while live" (P2-7) rather than "what still works", and the surviving `&sent=`/`&waive=` claim is corrected to say `&sent=` completing a batch now stamps a live `browserSign` settled (N5) instead of pinning it forever.

### P3-9 — the page's F6 validation never consults the chain, and one status line overstates what settled
`hub-desk.html:659`, `:674`, `:700`. `sr.decimals === DEC` compares two values from the same project record; the transfer is denominated by the chain decimals `CluckAirdrop` re-reads. `readWalletBal()` (`:557-563`) already fetches `getTokenAccountsByOwner` and could read `tokenAmount.decimals` for a one-line independent assertion. Separately, `"Settled — every row this batch named is fully paid."` is computed over `browserSign.wallets` — *this sign-request's* rows, not the batch's (rows skipped as already legacy-`sent` are excluded at `:1529`). Reword to "every row this payout named".
Fixed: 6d2480f — the reword, exactly as specified — scripts/hub-desk-sign-page-test.cjs (section "P3-9/P3-10": "the settled line reads 'every row this payout named', not 'this batch'"). The chain-decimals independent-read half is left as the accepted residual lens 2 itself calls "in practice unreachable" (`p.rewardDecimals` is chain-read at registration and SPL decimals are immutable) — not changed here.

### P3-10 — the live-flow status line still tells the operator to do something that cannot help
`hub-desk.html:632`: *"A browser-signed payout is {state} for this batch — reload to check its progress."* Reloading re-reads the same server state; nothing the operator can do in the page changes it. Given P1-2 this is the line they will stare at. The page already receives `BATCH.browserSign.nonce` (the batch view spreads the whole record — `routes.js:128`) and holds the signatures in `ROW_STATUS`, so an "OBSERVE WHAT I BROADCAST" button is buildable from what is already on the page — which is also the direct answer to *"can the operator ever observe those signatures after a reload?"*: **the nonce is not in localStorage, but the server echoes it in the batch view, so yes in principle and no in practice.** Also, `:646` is the one new operator-facing string not routed through `t()` — it stays English in all six languages.
Fixed: 6d2480f — the "reload…" wording dropped, an OBSERVE WHAT I BROADCAST button now renders whenever ROW_STATUS holds a broadcast signature for this batch, re-posting it via `observeAll()` under `BATCH.browserSign.nonce`; the `unrecordedSent()` refusal string inside `signAndSend()` now runs through `t()` — scripts/hub-desk-sign-page-test.cjs (section "P3-9/P3-10": the OBSERVE button re-posts the right sigs/nonce; no button when nothing was broadcast) plus the new `"Record the SENT — NOT RECORDED…"` key added to all six `public/i18n/*.json`.

---

## Per-finding table

| # | verdict | evidence |
|---|---|---|
| F1 | **CLOSED** (see P2-4, P2-5) | `hub-desk.html:546,547,629,630,640,643,654`; page test §F1 fails on mutation |
| F2 | **CLOSED** (see P2-7) | `routes.js:1177,1616,1668`; `hub-desk.html:548`; §12 fails on mutation, twice |
| F3 | **CLOSED** | `routes.js:1511-1513`; `hub-desk.html:626,630`; §1 inverted + page test §F3, both fail on mutation |
| F4 | **CLOSED** (see P2-6) | `routes.js:1477-1493`; `authOf` → `operatorOf` → base58 wallet; §13 fails on mutation |
| F5 | **PARTIAL** | persist `:687` + guard `:646` real and test-backed, but `unrecordedSent():572` misses `unconfirmed` → **P1-1**, reproduced |
| F6 | **CLOSED** (P3-9 note) | `hub-desk.html:658,659,661-666,671`; 4 page tests fail on mutation |
| F7 | **CLOSED** | `routes.js:1626-1628,1698,1712,1766`; §17 covers the bound, hoists read-verified |
| F8 | **CLOSED** | `routes.js:1632-1647` pool before `lockAcquire` at `:1657`; read-verified, no dedicated test |
| F9 | **CLOSED** (see P1-2, P2-6) | `routes.js:1591,1619-1621,1672-1674`; §16 fails on mutation, twice |
| F10 | **CLOSED** (see P3-8) | copy `:132`, dead `kv` gone, page test wired into `syntax-check.yml`; README §3a inaccurate |

**Merge-ready: no** — P1-1 is a one-line hole in the very guard this round added (`unconfirmed` sails past `unrecordedSent()`), and I reproduced it re-broadcasting a row through the real page script; P1-2 makes the owner reset that triggers it a routine event rather than a rare one, because one dropped signature 503s every `observe` for that batch forever with no way to send a subset from the desk. Both are small, local fixes. Separately, the branch is three commits behind `origin/develop` and touches the same files develop just changed, so it must be merged forward before anyone reads the diff as the change (P1-3). Everything F1–F10 claimed is genuinely implemented and genuinely tested — the negative mutations prove the suites bite — and the server-side verification half (frozen parameters, nonce, journal, exact-amount, funding-wallet source, cross-project consumed set, bounded cross product, lock-after-fetch) is good work.

---

## Round 3, lens 1 (crash windows and idempotency) — head 801e00f

# X6 lens 1, round 3 — crash windows and idempotency

Read-only pass on `origin/claude/hub-browser-sign` @ `801e00f`. No files edited, no git writes, no work-tree touches. I extracted the branch with `git archive` into the scratchpad, ran `scripts/hub-browser-sign-test.cjs` (**47/47 pass**) and `scripts/hub-desk-sign-page-test.cjs` (**23/23 pass**), drove **nine fault probes** against the real route closures through the same DI harness, and **mutation-tested seven of the eight named fixes** (revert the fix, re-run the suite, confirm it goes red). Findings marked **[probe]** are reproduced output. All line numbers are at `801e00f`.

---

## Part 1 — are N1–N8 closed?

**N1 — `clear=1` re-opened F2's cancel window. CLOSED.** `routes.js:1543-1567`: `atRisk` filters `bt.browserSign.wallets` by "not legacy-sent AND `rowState().remainingRaw !== "0"`", 409s without `&confirm=abandon-broadcast`, and echoes `atRisk/observedSigs/failed/nonce` on both the refusal and the 200. **[mutation]** `if (false && b.confirm !== …)` → §13b "clear=1 with an unobserved, at-risk wallet is refused (409)…" goes red (1 FAILED / 46 passed). **[probe P8]** the echo is real (`observedSigs ["5pwdmu"] atRisk ["5WKKoF"]`) and a journaled wallet is correctly excluded from `atRisk`. **But the same window is still open through `&waive=` — R3-1.**

**N2 — an idempotent re-observe marked a paid row failed and fired the fraud alert. PARTIAL.** The within-call case is genuinely fixed: **[probe P7]** two-wallet batch, observe `SIG_A` twice → second call `failed: {}`, `alerts: []`. **[mutation]** dropping `ownPriorSettlement(rj) continue` at `:1815` → §19 goes red. The **carried-forward** case is open: the N2(a) zero-remaining sweep at `:1943-1946` runs over `failedNow` only, and `:1947` then merges `bt.browserSign.failed` back in — **[probe P6]** a terminal record that reads `state:"settled"`, `remainingWallets:[]` **and** `failed:{A:"transfer smaller than the amount owed (1 < 1000000000)"}` for a fully-paid row. See **R3-3**.

**N3 — observe was all-or-nothing on unindexed signatures. CLOSED, with a new hazard.** `routes.js:1768-1776` 503s only when `notYetIndexed.length === sigs.length`, settles `resolvedSigs`, returns `pending`/`retry:true`; `hub-desk.html:691-705` retries just the outstanding set with backoff, 3 tries. **[mutation]** restoring `if (notYetIndexed.length)` → 2 FAILED. **But the new `nextState` rule bricks a fully-paid batch — R3-2.**

**N4 — `unrecordedSent()` ignored `unconfirmed`. CLOSED.** `hub-desk.html:609` and the purge at `:620`. **[mutation]** reverting `:609` to `l.status === "sent"` → page test 2 FAILED.

**N5 — `&sent=` pinned `browserSign` live forever. CLOSED for `&sent=`.** `routes.js:1167-1169` stamps `settled` inside the **same** `writeManyVerifiedMixed` at `:1170` — one persist, verified by reading and **[probe P5]** (`&sent=` at +25 h → `bt.state sent`, `bs.state settled`, journal written). **[mutation]** `if (false && browserSignIsLive(finalBatch))` → §25 goes red. Can it stamp `settled` while a browser-signed row is still owed? Only in the legacy sense it cannot: `recordSent` flips `state:"sent"` only when **every** row of `batch.amounts` carries a `sent[w]` flag, and `browserSign.wallets ⊆ batch.amounts`, so no named wallet can still be legacy-owed. A row recorded through `ATTRIBUTION_FAILURE_WHY` is journal-owed but legacy-paid — the pre-existing, documented residual, not a new one. **The same pin returns through `observe` — R3-2.**

**N6 — clear ran before the dry-run refusal. CLOSED.** `routes.js:1519` (dry run) sits above `:1531` (`if (on(b.clear))`). **[probe]** a dry-run project's `clear=1` → `409 "… is a DRY RUN …"`. Echo covered by §13b.

**N7 — a frozen `browserSign` never expired. CLOSED.** `routes.js:1728-1731`, 24 h, correct wording. **[mutation]** ×100000 on the constant → §21 goes red. It does **not** block the owner reset (**[probe P4]** `clear=1` at +25 h reaches its own `atRisk` logic) and does not block `&sent=` (**[probe P5]**, +25 h, 200, journaled) — but the 409 names neither recovery. See **R3-7**.

**N8 — `skipped` was not the complement of `rows`. CLOSED.** `routes.js:1633`. **[mutation]** restoring the bare `continue` → §22 goes red.

---

## Part 2 — new findings

### R3-1 (P1) — `&waive=` is the third un-guarded lever into F2's double-pay window, and README §3a advertises it as safe
`lib/hub/routes.js:1250` (the `b.waive` branch, no `browserSignIsLive` check) vs `:1213` (`&confirm=`) and `:1228` (`&cancel=`); `lib/hub/README.md:244-245`.

`&cancel=` got the guard (F2), `&confirm=` got it in this very fix round (P2-7). `&waive=` did not — and `ledger.waiveRemainder` frees the row's unsettled remainder straight back to `available` (`lib/cuna-payout.js:119-127`: "an owner waive … frees a row's unsettled remainder back to `ledger.partition`'s `available`"), which is exactly what made a bare cancel a double payment.

**[probe P2]**, one wallet, sign-request issued and (in the real world) broadcast but never observed:
```
P2 sign-request:        200  wallets ["4Gccq9pE…"]
P2 waive while live:    200  {"ok":true,"wallet":"4Gccq9pE…","amountRaw":"1000000000","reason":"looked stuck"}
P2 bs.state after waive: signing   bt.state pending      <-- no guard, no warning, flow still "live"
P2 re-export created:   hb_121ba9c2af  owes {"4Gccq9pE…":"1000000000"}   <-- SAME amount drawn again
```
It is also **silent afterwards**: the real transfer can never be journaled (`rowState` remaining is now 0 → `amount_mismatch`), and N2(a)'s own new sweep at `:1943-1946` then *deletes* that entry from `failed`, so the operator is told nothing. And the sequencing makes it likely rather than exotic — the owner facing a stuck flow now gets a 409 from `clear=1` demanding `confirm=abandon-broadcast`, while `&waive=` (the documented remedy for a row that "looks stuck") takes no flag at all.

*Minimal fix:* `if (browserSignIsLive(bt0)) return res.status(409).json({…})` on the `b.waive` branch, same wording as `:1228`; if waiving mid-flow must stay possible, require `&confirm=abandon-broadcast` there too and echo the at-risk set. Move `&waive=` out of README §3a's "what still works while live".

### R3-2 (P2) — the N3 fix re-creates N5's pin: every row settles, one signature stays unindexed, and the batch is live forever
`lib/hub/routes.js:1955` (`const nextState = stillOwed || notYetIndexed.length ? "submitted" : "settled";`) — observe never got the one-liner `&sent=` was given at `:1167`.

**[probe P1]**, one wallet, `sigs=[GOOD, DEAD]`, `DEAD` never indexed:
```
P1 observe:              200  bs.state submitted  bt.state sent  pending [DEAD]
P1 re-observe DEAD:      400  "batch is sent, not pending"
P1 fresh sign-request:   400  "batch is sent, not pending"
P1 cancel:               409  "a browser-signed payout is submitted for this batch…"
P1 owner clear:          200  {"cleared":true,"atRisk":[]}          <-- the ONLY exit
```
Money is safe (everything is paid and journaled), but `browserSignIsLive` is true forever on a batch no route will touch. On the desk it is worse than a dead end: `loadBatch` purges `ROW_STATUS` for every `sent` row (`hub-desk.html:510`), so `liveSigs` is empty and **no OBSERVE WHAT I BROADCAST button renders** (`:672-680`) — the operator gets the bare line "A browser-signed payout is submitted for this batch." with SIGN AND SEND and CLOSE both disabled. And `observeAll`'s own retry (`:701`) re-posts `[DEAD]`, gets the 400, and `call()` throws — so the last thing the operator sees after a fully successful payout is a red *"batch is sent, not pending"*.

Test §20 (`scripts/hub-browser-sign-test.cjs:735-746`) is **this exact scenario** ("even when the resolved signature settles EVERY named row, the state stays `submitted`…") and asserts the pin as intended — it never reads `bt.state`, which is what makes it terminal.

*Minimal fix:* mirror `:1167` — when `finalBatch.state === "sent"` (nothing is legacy-owed, so no still-unindexed signature can settle anything more), use `settled` regardless of `notYetIndexed`; or let observe/sign-request through when `bt.state === "sent"` and nothing is owed.

### R3-3 (P2) — carried-forward `failed` entries are never re-checked, so the terminal `settled` record names a fully-paid row as failed
`lib/hub/routes.js:1943-1951`. The N2(a) zero-remaining sweep runs over `failedNow`; `:1947` then does `nextFailed = { ...bt.browserSign.failed, ...failedNow }`, and only `r.recorded` **of this pass** clears entries at `:1951`. A row that failed in an earlier pass and was later paid some other way (the desk's own `&sent=` recovery button) is never in `r.recorded` again.

**[probe P6]** wrong-amount observe → `failed[A]`; A really paid via `&sent=`; next observe settles B:
```
P6 observe B: 200 recorded ["5WKKoF…"]  bs settled  remainingWallets []
              failed {"4Gccq9pE…":{"why":"transfer smaller than the amount owed (1 < 1000000000)"}}
```
`hub-desk.html:716-717` then renders both sentences at once: *"Settled — every row this payout named is fully paid. 1 row(s) could not be recorded: 4Gccq9… (transfer smaller than the amount owed …)"*. That is N2(a)'s complaint, unfixed for the carried case, and it persists into the record that outlives the flow.

*Minimal fix:* run the zero-remaining sweep over `nextFailed` **after** the merge at `:1947`, not over `failedNow` before it.

### R3-4 (P2) — any operator can flip a live flow to `submitted` with one junk signature, and `submitted` has no `force=1` escape
`lib/hub/routes.js:1681` (observe takes any operator session), `:1955` (state advances whenever *anything* resolved, attributed or not), `:1611` (`submitted` 409s **even with `force=1`**), `:136` (`deskBatch` spreads `...bt`, so `browserSign.nonce` is readable from the batch view).

P2-5 restricted **sign-request** to owner/funding/`payoutSources`; **observe** got no matching check. **[probe]** three observe calls carrying nine unrelated-but-resolvable signatures, none of which touched any named wallet:
```
observedSigs after 3 junk observes: 9   failed: []   bs submitted
```
From `submitted` the funding wallet's sign-request 409s with and without `force=1` (**[probe P4]** confirms both), and the only exit is the owner's `clear=1` — which now refuses without `confirm=abandon-broadcast` whenever the handed-out wallets are still owed. That is F4's deadlock, re-reachable in one POST by any operator wallet, including the exact wallet class P2-5 was added to keep off this flow.

*Minimal fix:* advance `signing → submitted` only when this pass attributed something to a named wallet (`r.recorded.length || Object.keys(failedNow).length`), and/or apply sign-request's caller restriction to observe.

### R3-5 (P3) — `browserSign.observedSigs` grows without bound from caller-supplied signatures
`lib/hub/routes.js:1956`: `observedSigs: [...new Set([...prev, ...resolvedSigs])]`. Every signature the caller names that the RPC can resolve is appended to the batch record forever — up to ~40 per call, 30 calls/min/IP, and `batches` is read and rewritten **whole** by every payout route (the probe above added 9 in 3 calls). *Minimal fix:* keep only signatures that attributed to a named wallet, or cap at a bounded ring of the most recent N.

### R3-6 (P3) — the `cleared` note and the stale-nonce 409 both tell the operator to "re-broadcast", which is the double-pay action
`lib/hub/routes.js:59` (`browserSignAlreadyNote`), `:1722`, `:1730` — all three end "*request a fresh sign-request and **re-broadcast from what it returns***". **[probe P3]** shows the correct recovery is the opposite: fresh sign-request, then observe the **same old signature** under the **new** nonce → `200 recorded ["4Gccq9pE…"]`. (The per-row `&sent=` button is the other one.) The copy names neither, and on a `cleared` record the desk stops rendering OBSERVE WHAT I BROADCAST (`hub-desk.html:672`, gated on `live`), so the in-page recovery disappears exactly when this note appears. *Minimal fix:* "…then observe the signatures you already broadcast under its new nonce — do not broadcast again until you have."

### R3-7 (P3) — `submitted` + >24 h is owner-only and abandon-flavoured; the errors name no working recovery
`:1611` + `:1729`. **[probe P4]**: observe `409 more than 24 hours old`; sign-request `409` (and `force=1` gives the identical 409); `clear=1` `409 atRisk ["5WKKoF"]`. So the documented path out requires the owner to assert `confirm=abandon-broadcast` — "I verified none of these landed" — for a transfer that may well have landed. **[probe P5]** shows `&sent=` is unaffected by the 24 h bound, journals the transfer and (via N5) stamps `settled`. Say that in the 409 text.

### R3-8 (P3) — a `force=1` or post-clear sign-request carries `failed` into a generation that never produced it
`lib/hub/routes.js:1657` (`failed: (bt.browserSign && bt.browserSign.failed) || {}`). Carrying `observedSigs` forward is load-bearing (P2-6); carrying `failed` is not, and with R3-3 the new flow opens already reporting a stale failure for a row it has not touched. *Minimal fix:* start `failed: {}` on a new generation, or move the old map to a `previousFailed` key the response does not render.

---

## The specific questions asked

**Is `cleared` not-live everywhere?** Yes. `browserSignIsLive` (`routes.js:49`) is the single reader-side predicate (`:1167, :1213, :1228, :1358`) and matches only `signing`/`submitted`; the desk's two local copies (`hub-desk.html:574`, `:666`) spell the same pair. Observe's terminal check at `:1709` and its in-lock twin at `:1784` both treat `cleared` as terminal **before** the nonce check, so **a stale observe with the old nonce cannot settle against a `cleared` record** — **[probe P3]**: `200 already:true`, journal entries 0, nothing written. A `force=1` (or plain) sign-request after `cleared` succeeds and carries `observedSigs` forward (**[probe P8]**: `["5pwdmu"]` survives into the new generation), and the old signature then settles under the new nonce.

**Can a batch be left `submitted` with `pending` sigs and no way out but `clear`?** Yes, two ways: R3-2 (everything paid, one dead signature — the only exit is the owner) and R3-4 (a junk observe from any operator). In the ordinary partial case the desk's retry plus the OBSERVE button do get out.

**Does a partially-settled observe persist exactly once?** Yes — one `hubStore.writeManyVerifiedMixed(kv, p.id, { batches, paid }, journalRaw)` at `:1959`, covering the batch, `paid` and every journal entry. `markMilestone` at `:1960` is the only write outside it and cannot lose money (pre-existing).

**Is `settled` ever stamped while `pending` is non-empty?** No — `:1955` ORs `notYetIndexed.length` into `submitted`. That is the correct half of the rule; it is the missing `bt.state === "sent"` half that bricks it (R3-2).

**Does `&sent=` stamping `settled` happen in one persist, and can it fire while a browser-signed row is still owed?** One persist (`:1167-1170`). It cannot fire with a named row legacy-owed — `recordSent` requires every `batch.amounts` key to carry a `sent` flag, and `browserSign.wallets ⊆ batch.amounts`.

**Does the 24 h bound block the owner reset or a legitimate late observe?** Not the reset (**[probe P4]**). It does block a late observe of a genuinely landed transfer, and recovery is `&sent=` with that signature (**[probe P5]**, works at +25 h) — see R3-7.

**Is P2-5's `who` compared the way `payoutSources` is stored?** Yes. `authOf` (`:162-166`) returns the literal `"owner"` or `operator.operatorOf`'s `t.wallet` (`lib/hub/operator.js:63`), which must already be in `project.operatorWallets`; `payoutSources` entries pass through `proj.addr()` (`lib/hub/project.js:135`). Both are canonical base58 strings, so `p.payoutSources.includes(who)` at `:1596` is a like-for-like compare, and no base58 address can collide with the `"owner"` sentinel. The gap is that **observe carries no equivalent check** (R3-4).

---

## Findings table

| Finding | Verdict | Evidence |
|---|---|---|
| N1 `clear=1` re-opened the cancel window | **CLOSED** (re-opened by `&waive=`, R3-1) | `routes.js:1543-1567`; §13b; mutation → 1 FAILED; probe P8 |
| N2 idempotent re-observe marked a paid row failed + alerted | **PARTIAL** — within-call closed, carried-forward open (R3-3) | `routes.js:1815, 1943-1951`; §19; mutation → 1 FAILED; probes P6/P7 |
| N3 observe all-or-nothing on unindexed sigs | **CLOSED** (introduces R3-2) | `routes.js:1768-1776`; `hub-desk.html:691-705`; §20; mutation → 2 FAILED |
| N4 `unrecordedSent()` ignored `unconfirmed` | **CLOSED** | `hub-desk.html:609, 620`; page-test mutation → 2 FAILED |
| N5 `&sent=` pinned `browserSign` live | **CLOSED** for `&sent=` (pin returns via observe, R3-2) | `routes.js:1167-1170`; §25; mutation → 1 FAILED; probe P5 |
| N6 clear ran before the dry-run refusal / echoed nothing | **CLOSED** | `routes.js:1519` above `:1531`; probe (dry-run clear → 409); §13b echo |
| N7 a frozen `browserSign` never expired | **CLOSED** (recovery wording, R3-7) | `routes.js:1728-1731`; §21; mutation → 1 FAILED; probes P4/P5 |
| N8 `skipped` was not the complement of `rows` | **CLOSED** | `routes.js:1633`; §22; mutation → 1 FAILED |

New this round: **R3-1 (P1)**, **R3-2 (P2)**, **R3-3 (P2)**, **R3-4 (P2)**, **R3-5 (P3)**, **R3-6 (P3)**, **R3-7 (P3)**, **R3-8 (P3)**.

**Merge-ready: no** — `&waive=` is the one lever into the F2 double-pay window that never got the guard `&cancel=` and `&confirm=` now have, and `lib/hub/README.md:244-245` still names it as safe to use while a flow is live; **[probe P2]** waives a handed-out, broadcast, unobserved row and re-exports the identical amount into a fresh batch with no warning, no alert and no trace. That is one line of code and one line of README. Everything else is recoverable: R3-2/R3-4 brick the state machine behind an owner `clear=1` without losing money, R3-3 makes a paid batch *read* failed, and the rest is copy and hygiene. N1 and N3–N8 are genuinely implemented and genuinely test-backed — every named test goes red when I revert its fix — and the server-side verification core (nonce, frozen parameters, single persist, journal, exact-amount, funding-wallet source, bounded cross product, lock-after-fetch) remains solid.


---

## Round 3, lens 2 (adversary and browser) — head 801e00f

# X6 lens 2, round 3 — adversary and browser

Read-only re-review of `origin/claude/hub-browser-sign` @ `801e00f`. All line numbers are at that revision. I extracted the branch with `git archive` into the scratchpad (work tree never touched), ran both suites (`hub-browser-sign-test.cjs` **47/47**, `hub-desk-sign-page-test.cjs` **23/23**), ran **ten negative mutations** to prove each round-2 fix is test-backed, and ran two adversarial probes against the real route closures. Probe output is quoted, not reasoned.

---

## Part 1 — are P1-1 … P3-10 closed?

Mutation results (remove the fix → which suite fails):

| mutation | server suite | page suite |
|---|---|---|
| M1 P2-5 403 → `if (false)` | **FAIL** | pass |
| M2 P2-7 `&confirm=` guard → `if (false)` | **FAIL** | pass |
| M3 N1 clear `confirm=abandon-broadcast` guard → `if (false)` | **FAIL** | pass |
| M4 N3 partial-observe → back to all-or-nothing | **FAIL** | pass |
| M5 P1-1 `unconfirmed` dropped from `unrecordedSent()` | pass | **FAIL** |
| M6 P2-4 `payoutSources` dropped from `acceptedWallets()` | pass | **FAIL** |
| M7 P3-10 OBSERVE button → `canObserve = false` | pass | **FAIL** |
| M8 P3-9 wording reverted to "this batch" | pass | **FAIL** |
| M9 N7 24h age check → `if (false)` | **FAIL** | pass |
| M10 `observeAll` pending-retry → `if (false)` | pass | **FAIL** |
| M11 `clearedBrowserSign = null` (P2-6a) | **FAIL** | pass |
| M12 `observedSigs: []` on re-request (P2-6b) | **FAIL** | pass |

Every claimed fix bites. Details:

- **P1-1 — CLOSED.** `public/hub-desk.html:609` now `(l.status === "sent" || l.status === "unconfirmed")`; the `send()` pre-flight purge keeps `unconfirmed` too (`:620`).
- **P1-2 — CLOSED.** `lib/hub/routes.js:1770` 503s only when *none* resolved; `:1955` never advances past `submitted` while `notYetIndexed.length`; `pending`/`retry:true` in the 200 body; `hub-desk.html:691-705` `observeAll()` retries only the outstanding set, 3 attempts, 300/600 ms backoff, and re-throws any non-`retry` error (`call()` copies `retry`/`pending` onto the Error at `:274-277`). Bounded — it cannot hammer the RPC amplifier.
- **P1-3 — PARTIAL.** The merge forward happened (`386c759`, merge-base `b3ca3e2`), but `origin/develop` has since moved to `62d2051` (PR #357) and the branch is **one commit behind again**. See new **P2-D**.
- **P2-4 — CLOSED, and correct against a tampered response.** `hub-desk.html:560-566` (`acceptedWallets`/`walletIsAccepted`/`acceptedWalletsText`), used at `:580`, `:614`, `:669`, `:739`. The `sr.payoutSources` check at `:751-752` is an **AND** on top of the project-record check, not an OR — a tampered/widened `sr.payoutSources` cannot make a wrong wallet sign; it can only narrow. Server freezes and echoes `payoutSources` (`routes.js:1656`, `:1668`).
- **P2-5 — CLOSED and unspoofable.** `routes.js:1596`. `who` comes from `authOf` → `operator.operatorOf` → HMAC-verified token whose `wallet` must be base58 (`B58` test, so the literal `"owner"` can never pass) *and* present in `project.operatorWallets`. A `payoutSources` wallet being allowed is correct (it is a wallet the project pays **from**).
- **P2-6 — CLOSED.** `routes.js:1532-1577` (at-risk set, 409 unless `confirm=abandon-broadcast`, `{state:"cleared", clearedAt, nonce, observedSigs, wallets, failed}`), `:1661` carries `observedSigs` through a `force=1`. The clear branch is behind `who !== "owner"` → 403 *before* anything is computed, so the 409/200 echo (`atRisk`, `observedSigs`, `failed`, `nonce`) **leaks nothing to an operator**.
- **P2-7 — CLOSED.** `routes.js:1213`.
- **P3-8 — CLOSED.** `lib/hub/README.md:126-250` now states the state machine (incl. `cleared`), the P2-5 caller gate, what is blocked while live (with `&confirm=`), and N5's settled stamp. Accurate against the code.
- **P3-9 — CLOSED.** `hub-desk.html:716`.
- **P3-10 — CLOSED** (see new P3-E/P3-F for what it opened). Button at `:677-681`, recovery path `:724-733`, `t()` routing at `:743`.

**i18n — clean.** Programmatic check: the 19 `t()`/`tf()` literals in `hub-desk.html` are present in all six dictionaries (es/hi/it/pt/vi/zh, 1649 keys each, equal counts); placeholders `{state} {n} {reasons} {amount} {wallet} {wallets}` match one-for-one; none left identical to English; no APR/APY/yield/guaranteed language. The **5 removed keys are genuinely dead** — grepped across `public/`, `src/`, `scripts/`, `lib/`, `server.js`: zero references (only a comment quoting the old wording at `hub-desk.html:673`).

**Escaping — clean.** All 14 new `innerHTML` assignments go through `CluckUtil.esc` (`hub-desk.html:128,173,176,211,222,232,236,245,249,250,254,255,282,293` of the diff). The OBSERVE button's markup is static plus `esc(t(...))`; `askConfirm` sets its message with `textContent` (`:546`). No new unescaped sink.

**The OBSERVE button, specifically.** `ROW_STATUS` is keyed `hub_desk_rows_<PID>_<BATCH.id>` (`:255`) and `loadStatus()` runs inside `loadBatch()` after `BATCH` is set — so it **cannot** carry another batch's or another project's signatures. It cannot observe anything the operator did not broadcast in a way that matters: the payload is signatures only, and `observe` re-verifies each on chain against the frozen wallets/mint/funding wallet/exact remaining. Concurrency is serialised by the per-project payout lock.

---

## Part 2 — new findings

### P1-A — the desk's own `observe` call is refused (400) for any real-size batch, *after* the money has been broadcast; the page never chunks
`lib/hub/routes.js:1738` vs `public/hub-desk.html:794` (`observeAll(sigs, sr.nonce)`) and `public/airdrop-engine.js:176,218-227`

`CluckAirdrop.planBatches` packs **16 recipients per transaction** (8 when recipients need an ATA created), so a sign-request of *N* rows produces `ceil(N/16)` distinct signatures. F7's bound refuses `wallets × sigs > 500`. That crosses at **N ≈ 84 rows** (N ≈ 63 when ATAs are needed). `signAndSend()` posts the whole set in one call and never slices; the OBSERVE button posts the same set.

**Probe A (verbatim, real route closures, 90-row batch):**
```
PROBE A — sign-request rows: 90 status 200
PROBE A — observe(6 sigs for 90 wallets): 400
  {"ok":false,"error":"too many wallet×signature combinations to verify in one call
   (90 wallet(s) × 6 signature(s)) — observe fewer signatures at a time"}
   n=5 -> (accepted)     n=6 -> 400     n=7 -> 400
```
**Scenario:** a 90-locker payout. The wallet signs and broadcasts six real transactions, then the observe is hard-refused with a message the operator cannot act on from the UI; `browserSign` stays `signing`, the managed payer stays blocked, `&cancel=`/`&confirm=` stay blocked, and the only route left is 90 individual per-row "record on server" clicks — the *less* guarded `&sent=` path this feature exists to replace. Nothing in either suite uses a batch above two wallets, so this is invisible to CI. The README (§3a) states the bound as a safety property without noting that the browser's own output exceeds it.
*Minimal fix:* chunk in `observeAll()` — `per = Math.max(1, Math.min(40, wallets + 5, Math.floor(500 / wallets)))`, loop the slices, merge the reports (the server is already idempotent per signature). Add a ≥90-row case to `hub-browser-sign-test.cjs`.

### P1-B — any operator can lock a batch with one POST, and round 2's own clear-guard turned the owner's escape into a false-alarm override
`lib/hub/routes.js:1675-1682` (no caller gate on `observe`), `:136` (`deskBatch` spreads the whole `browserSign`, nonce included), `:1611` (`submitted` refuses even `force=1`), `:1955`, `:1560-1566`

P2-5 gated `sign-request` but **not** `observe`, and the ordinary batch view hands every operator the live `nonce`. Any resolvable mainnet signature flips `signing → submitted` (`:1955` — `stillOwed` is true, so the state advances even when *nothing* was recorded).

**Probe B (verbatim):**
```
PROBE B — funding wallet sign-request: 200  nonce e7c288dc
PROBE B — griefer sign-request: 403 only the project's funding wallet (9WzDXwBbmkg8…
PROBE B — nonce readable from /payout?batch= by the griefer: e7c288dc… YES
PROBE B — griefer observe: 200  browserSign.state -> submitted  recorded []
PROBE B — funding wallet re-sign-request: 409 …already broadcast and is still being observed…
PROBE B — with force=1:                   409 …already broadcast and is still being observed…
PROBE B — owner clear=1: 409 1 wallet(s) this sign-request handed out may already have a real,
          unobserved broadcast on chain for the full row amount…  atRisk ["4Gccq9pESbf…"]
```
`force=1` covers `signing` only, so the legitimate funding wallet has no lever at all. The owner's only exit is `&confirm=abandon-broadcast` — an assertion that *"I have verified none of these actually landed"* — in a case where nothing was ever broadcast and the owner has no way to know that. Round 2 correctly hardened `clear=1`; the unguarded `observe` turns that hardening into a griefing amplifier.
*Minimal fix:* two lines. (1) Apply P2-5's gate to `observe` (`who === "owner" || who === p.fundingWallet || payoutSources.includes(who)`). (2) Do not advance `signing → submitted` when this pass attributed nothing to any wallet in the batch (`if (!r.recorded.length && !Object.keys(failedNow).length) keep "signing"`). Either alone closes the probe; both is right.

### P2-C — the live `nonce` and `idempotencyKey` are handed to every operator session
`lib/hub/routes.js:136` (`return { ...bt, rows, … }`)

`deskBatch` spreads the raw batch, so `/payout?batch=` returns `browserSign.{nonce, idempotencyKey, observedSigs, wallets, fundingWallet, payoutSources}` to any operator token. F9's stated property is that the nonce binds a call to one sign-request generation; P2-5 now withholds sign-request from most operators while this hands them its nonce anyway — which is what makes P1-B a one-request attack instead of a guess.
*Minimal fix:* in `deskBatch`, redact `nonce`/`idempotencyKey` unless the caller is the owner or an accepted payout wallet (the desk page only needs the nonce in exactly that case — the OBSERVE button belongs to a wallet that can sign).

### P2-D — the merge hazard is back: the branch would delete PR #356's disclosure entry
`docs/PRE_EVENT_STATE.md`, `docs/HANDOFF_2026-09-18.md`

`origin/develop` is at `62d2051` (PR #357, docs-only); the branch's merge-base is `b3ca3e2`. `git diff origin/develop..branch` therefore shows `docs/PRE_EVENT_STATE.md | 7 -` — a clean **deletion of the "Colosseum batch 17 … PR #356" bullet** from the Colosseum disclosure document — plus a revert of `docs/HANDOFF_2026-09-18.md`. CLAUDE.md's standing conflict rule ("keep the branch side — it is the superset") is false here again, and the file it would silently revert is the hackathon disclosure.
*Minimal fix:* merge `origin/develop` (one commit) before the PR is merged or re-read; confirm `docs/PRE_EVENT_STATE.md` still carries the #356 bullet afterwards.

### P3-E — the OBSERVE button re-labels an older generation's signatures with the batch's *current* nonce, so F9's claim is now stronger than the code
`public/hub-desk.html:677-681`, `:724-733` vs `lib/hub/routes.js:1642-1647` and `README.md:195-198`

The button posts signatures from `ROW_STATUS` (which has no nonce attached) under `BATCH.browserSign.nonce`, whatever generation that is. After a `force=1` re-request or a clear-and-re-request, the old generation's signatures are observed under the new nonce — precisely the conflation the comment and §3a say "can never" happen. It is money-safe (the chain re-verification, the exact-remaining match and `duplicate_settlement_candidate` still decide), and it is the recovery the operator needs, but the documented control is now advisory.
*Minimal fix:* store the nonce alongside each broadcast in `ROW_STATUS` (`{status, sig, nonce}`) and post that one; or reword the comment and §3a to say the nonce binds a call to the batch's *current* generation, not to the generation that issued the signatures.

### P3-F — N7's 24-hour expiry has no way out from the page
`lib/hub/routes.js:1728-1731`, `public/hub-desk.html:670`, `:677-681`

Past 24 h a `signing` flow's OBSERVE button answers 409 ("more than 24 hours old"), SIGN AND SEND is disabled by `!live`, CLOSE BATCH is disabled, `&confirm=` and the managed payer are 409, and the desk exposes no `force=1` control. The only exits are the per-row record buttons or an owner clear — for a flow whose signatures may be perfectly good.
*Minimal fix:* on that specific 409, offer a "start a fresh sign-request" action that POSTs `force=1` (the carried-forward `observedSigs` already makes it safe), and say in §3a that a >24 h flow is recovered that way.

### P3-G — `browserSign.observedSigs` is unbounded and rewrites the whole `batches` blob on every observe
`lib/hub/routes.js:1956`

`observedSigs: [...new Set([...prev, ...resolvedSigs])]` never caps and is never cleared, including after `settled`. An operator can add up to `min(40, wallets+5, floor(500/wallets))` resolvable signatures per call at 30 calls/min (`hubheavy`), each call re-persisting the full project `batches` object to the volume. Slow, but it is unbounded growth on a money record driven by an untrusted caller, and each signature also costs a Helius `getTransaction`.
*Minimal fix:* keep the last ~100 (`.slice(-100)`), or only union signatures that actually settled or failed a named wallet.

### P3-H — `sign-request` names `source: p.fundingWallet` on every row even when an allowlisted `payoutSources` wallet is the caller
`lib/hub/routes.js:1637`

After P2-4/P2-5 the signer may legitimately be a `payoutSources` wallet, but each row still declares the funding wallet as its source. `hub-desk.html` ignores `source` (it builds from `walletPubkey`), so nothing breaks today — but the field is now a lie for that caller, and any second client that honoured it would build a transfer from a wallet it cannot sign for.
*Minimal fix:* `source: (who === "owner" ? p.fundingWallet : who)`, or drop the field and state in §3a that the source is whichever accepted wallet connects.

### P3-I — the round translated one of three sibling guard strings
`public/hub-desk.html:743` (`t(...)`) vs `:615` and `:824` (raw English), and `:586` (raw) vs `:683` (`tf(...)`)

`signAndSend()`'s "Record the SENT — NOT RECORDED rows first…" now renders in all seven languages; the identical guard on SEND and on CLOSE BATCH, and `refreshSendButton`'s live-flow reason line, stay English. The two `Record the SENT…` strings pre-date this branch, so this is an inconsistency introduced by fixing only one of them, not a regression.
*Minimal fix:* route `:615`, `:824` and `:586` through `t()`/`tf()` and add the two keys to all six dictionaries (the third is already there).

---

## Per-finding table

| # | verdict | evidence |
|---|---|---|
| P1-1 | **CLOSED** | `hub-desk.html:609`, `:620`; M5 → page suite fails |
| P1-2 | **CLOSED** | `routes.js:1770,1955` + `pending/retry` body; `hub-desk.html:691-705`; M4 and M10 both fail |
| P1-3 | **PARTIAL** | merged at `386c759`, but one commit behind `62d2051` again → **P2-D** |
| P2-4 | **CLOSED** | `hub-desk.html:560-566,580,614,669,739,751-752`; `routes.js:1656,1668`; M6 fails; response widening impossible (AND, not OR) |
| P2-5 | **CLOSED** | `routes.js:1596`; M1 fails; `who` HMAC-bound + `operatorWallets` + base58 — unspoofable. Gap is `observe`, not this route → **P1-B** |
| P2-6 | **CLOSED** | `routes.js:1532-1577,1661`; M11 and M12 both fail; owner-only, no operator-visible leak |
| P2-7 | **CLOSED** | `routes.js:1213`; M2 fails |
| P3-8 | **CLOSED** | `lib/hub/README.md:126-250`, accurate against the code |
| P3-9 | **CLOSED** | `hub-desk.html:716`; M8 fails |
| P3-10 | **CLOSED** | `hub-desk.html:677-681,724-733,743`; M7 fails; per-batch `ROW_STATUS` key, everything escaped — see **P3-E/P3-F** |

**Merge-ready: no** — **P1-A** makes the happy path fail for any batch above ~84 rows *after real money has left the wallet* (probe A: 90 rows → the desk's own observe is 400ed, and the page never chunks), and **P1-B** lets any operator lock a batch with one POST while round 2's new clear-guard turns the owner's only escape into a "confirm nothing landed" override of a broadcast that never happened (probe B, end to end, `force=1` included). Both fixes are small and local — a chunking loop in `observeAll()`, and P2-5's gate copied onto `observe`. Everything P1-1…P3-10 claimed is genuinely implemented and genuinely test-backed (twelve negative mutations, every one caught), the i18n and escaping are clean, and the server-side verification half remains good work.

