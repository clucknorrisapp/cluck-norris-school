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

**F2 — `&cancel=` is not blocked while `browserSign` is live, and `observe` accepts a cancelled batch → one accrual paid twice. `lib/hub/routes.js:1168-1169`, `:1534-1539`**
`/payout`'s `&send=` checks `browserSignIsLive` (`:1298`) but `&cancel=` does not, and the desk's CLOSE BATCH button is explicitly left enabled while a browser-sign flow is live (`:541`). `observe` only checks `bt.browserSign.state`, never `bt.state`.
*Probe 3:* sign-request → `cancel` returns 200, batch → `cancelled`, `browserSign` still `signing`, and a re-`export` immediately creates a **new batch with the identical amount for the same wallet**.
*Probe 4:* `observe` on that cancelled batch returns 200, `recorded: [W.A]`, `browserSign: settled`, **one journal entry written into a cancelled batch**.
**Scenario:** operator broadcasts, sees no confirmation, presses CLOSE BATCH (the UI invites it), re-exports, pays the new batch, then later observes the old signatures — or the old signatures simply settle the cancelled batch. Either way the wallet is paid twice for one accrual and no invariant catches it.
*Minimal fix:* refuse `&cancel=`/`&close=` with 409 when `browserSignIsLive(bt)` (same one-liner as `:1298`), and add `if (bt.state !== "pending") return 400` to `observe` at `:1535`. Disable CLOSE in `refreshSendButton` when `bsLive`.

**F3 — A second `sign-request` while `signing` re-hands the identical rows, and the SIGN button is not disabled while live → double broadcast. `lib/hub/routes.js:1468-1470`, `public/hub-desk.html:614-615`**
The refusal fires on `submitted` but not on `signing` — which is backwards. `submitted` means at least one observe ran, so the rows still shown owed genuinely are owed; `signing` is exactly the state where an unobserved broadcast may already exist. Worse, `refreshSignSendButton`'s `ok` omits `!live` (contrast `refreshSendButton:540`, which has `!bsLive`), so after a reload mid-flow the button is **enabled** and the status line says only "reload to check its progress".
*Probe 1:* second sign-request while `signing` → 200, same wallet, same `amountRaw`.
**Scenario:** tab crashes after the wallet broadcasts. Operator reloads, clicks again, signs and broadcasts the same transfers a second time. The chain has two transfers; the journal will settle exactly one (the second is refused `duplicate_settlement_candidate`/`amount_mismatch`) — which is the point: the ledger stays consistent while the funding wallet is down twice the money.
*Minimal fix:* add `!live` to `ok` at `:614`; on the server, refuse a re-`sign-request` from `signing` unless the caller passes an explicit `force=1`, and word the refusal "observe the signatures you already broadcast first". The test at `scripts/hub-browser-sign-test.cjs:126-135` currently pins the unsafe behaviour as intended — it needs inverting with this fix.

### P1

**F4 — A batch can be permanently deadlocked in `submitted`, unpayable by every route including the owner's managed payer. `lib/hub/routes.js:1468-1469`, `:1298`, `:1638,1651`**
*Probe 2 (verbatim):* after one observe of a wrong-source signature → `state: submitted`; new `sign-request` → **409** "already broadcast — observe it (or let its blockhash lapse)"; managed `&send=` → **409** "a browser-signed payout is submitted"; re-`observe` → 200, still `submitted`. `stillOwed` can never reach false for a row whose only transfer is permanently unattributable, and `&send=` is owner-only (`:866`) — so **an operator can lock the owner out of the managed payer on a batch with one POST**, deliberately or by accident. The only escape is `&cancel=` + re-export, which is F2's double-pay path. The 409 text is also wrong: this flow tracks no blockhash, so "let its blockhash lapse" describes a recovery that does not exist.
*Minimal fix:* an owner-only `browserSign` reset (e.g. `POST …/sign-request?clear=1` setting `browserSign = null`), or age out `signing`/`submitted` after a TTL when the last observe settled nothing. Fix the 409 wording.

**F5 — The broadcast signatures exist only in a local `var`; a lost tab or an outer throw loses them, and there is no `unrecordedSent()` guard. `public/hub-desk.html:626-636`**
`var sigs = []` is never persisted. The pre-existing SEND path persists every result to `localStorage` on each `onResult` (`:589`, `saveStatus()`), renders SENT—NOT RECORDED row buttons, and **refuses to run again while any exist** ("Sending again would pay them twice", `:567`). `signAndSend` does none of that: it neither writes `ROW_STATUS` nor checks `unrecordedSent()`, so it will happily re-broadcast rows the SEND flow already sent-but-didn't-record, and if `call(".../observe")` throws (network blip — `call` throws on any non-`ok`, `:266`) the signatures are gone from the page with no UI to re-submit them.
*Minimal fix:* push each `r.sig` into `ROW_STATUS` + `saveStatus()` in the `onResult` at `:632` (reusing the existing recovery buttons), and add the `unrecordedSent()` guard from `:567` to `signAndSend`.

**F6 — The page validates nothing in the sign-request response, and the confirm dialog shows numbers from a different source than what gets signed. `public/hub-desk.html:623-629`, `:651-654`**
`recipients` comes wholly from `sr.rows`; `mint` from `sr.mint`; the human amount from `whole(r.amountRaw, sr.decimals)`. The page already holds `MINT`, `DEC` and `BATCH.rows[].raw` and checks none of them. Two concrete failures: (a) `sr.decimals` disagreeing with the on-chain mint decimals — which `CluckAirdrop` re-reads and overrides at `airdrop-engine.js:336-340` — silently scales every transfer by 10^Δ; a stale `rewardDecimals` on the project record (`routes.js:1473`) is all it takes. (b) The confirm text at `:653` quotes `BATCH.remainingCount` / `amt(BATCH.remainingRaw)` from the *last page load*, while the wallet is then asked to sign whatever `sr.rows` says — the operator approves one set of numbers and signs another.
*Minimal fix:* before building `recipients`, assert `sr.mint === MINT`, `sr.decimals === DEC`, every `sr.rows[i].wallet` is present in `BATCH.rows`, and `amountRaw <= ` that row's `raw`; bail with a plain message otherwise. Move `askConfirm` to *after* the sign-request and quote the returned row count and summed amount.

### P2

**F7 — `observe` is O(wallets × sigs) with four full global-journal scans per wallet, all while holding the per-project payout lock. `lib/hub/routes.js:1558-1566`, `:1595`, `:1638`, `:1673`**
`sigs` is capped at 40 (`:1526`) but `wallets` is uncapped (the `&sent=` branch caps its equivalent at 500, `:952`). `ledger.journalFor` (`lib/hub/ledger.js:48-50`) filters the **entire global journal** and is called inside four separate per-wallet loops, and `rowState` then filters those entries again per wallet. A 500-row batch against a 50k-entry journal is ~10^8 object comparisons per request, single-threaded, under a 10-minute lock — the whole Hub stalls. 30 req/min per IP for any authenticated operator.
*Minimal fix:* hoist `const proj = ledger.journalFor(hubJournal, p.id)` once per pass (it already is in sign-request at `:1472`), and cap `wallets.length × sigs.length` the way `&sent=` caps `results`.

**F8 — `observe` is a free authenticated `getTransaction` amplifier. `lib/hub/routes.js:1526`, `:1550`**
Up to 40 arbitrary signatures per call, fetched sequentially through the paid RPC, 30 calls/min/IP, for any operator of any project — the signatures need not relate to anything and the route leaks nothing about them (good), but each call burns 40 Helius credits and holds the payout lock across all 40 round trips. Combined with F7 that's a cheap self-DoS.
*Minimal fix:* intersect `sigs` against a plausibility bound (e.g. at most `wallets.length` + a small slack), fetch concurrently with a small pool, and acquire the lock *after* the fetch rather than before.

**F9 — `nonce`/`idempotencyKey` are generated, persisted and documented as the tie-back control, but `observe` never reads either. `lib/hub/routes.js:1486-1497` vs `:1510-1675`**
The comment at `:1487-1491` states the key "ties an observe() call back to the exact set of rows/amounts a sign-request handed out, so a stale or superseded sign-request can never be conflated with a fresh one". No code enforces it — `observe` takes signatures only. A superseded sign-request (F3) is in fact silently conflated with the fresh one; the only thing actually frozen is `browserSign.wallets`. Per CLAUDE.md ("tell the truth about what you did"), a control that is described but not implemented is worse than no control.
*Minimal fix:* either require `nonce` on `observe` and 409 a mismatch, or delete `idempotencyKey` and rewrite the comment to say plainly that only the wallet list is frozen.

### P3

**F10 — Claims that are not true, and tests that cannot catch the above.**
- `public/hub-desk.html:132`: "holding the batch so nothing else can touch it meanwhile" — false. `&sent=`, `&cancel=`, `&waive=` and the per-row record buttons all still work while `browserSign` is live; only the owner-only `&send=` is blocked.
- `scripts/hub-browser-sign-test.cjs` is server-only — there is no vm/jsdom test of `hub-desk.html`'s `signAndSend` (other Hub work does run page scripts in a vm, e.g. the receipt-page test cited in the CI diff). F1, F3's UI half, F5 and F6 are all invisible to the suite by construction. The suite also has no case for: a cancelled/closed batch (F2), recovery from a permanently-`submitted` batch (F4), a cross-project signature (asserted in the comments at `:1440-1441` but never exercised here), or the wallets×sigs cross-product bound (F7).
- `scripts/hub-browser-sign-test.cjs:97` — `const kv = arguments;` in `exportBatch` is dead and misleading.
- A broken implementation *would* pass most of the suite: every test uses a single-wallet batch, so the cross-product, the per-wallet `failed` overwrite and the `duplicate_settlement_candidate` path are never reached.

---

**Merge-ready: no** — F1 (no funding-wallet check before the wallet signs) and F2 (cancel-while-live plus observe-on-a-cancelled-batch, both reproduced) are each a live route to real money leaving twice or landing where the server will never credit it; F3/F4 make the flow double-broadcast on recovery and deadlockable by any operator. The server-side verification half (journal, exact-amount, funding-wallet source, `notBefore`, cross-project consumed set) is genuinely good and the i18n is clean — the gaps are all in the browser half and in the two state transitions around it.

