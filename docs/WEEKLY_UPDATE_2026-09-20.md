# Colosseum weekly update #1 — Sunday 2026-09-20 (W10)

Colosseum strongly recommends a ~1-minute video each week on what shipped and what was hard.
This is the founder's script for update #1, covering **Sep 14 13:00 UTC → Sep 20**. Drafted
2026-09-18 from the merged in-window PRs in `docs/PRE_EVENT_STATE.md`; **refresh the shipped list
on Sep 19 evening** (anything merged after this draft: batch 2 = PR #339) before recording.

Rules for the recording (from `docs/COLOSSEUM_ROADMAP.md` §W10 and CLAUDE.md): phone, one take,
no slides needed; name what shipped with a link; "Earn" is capability, never a promise; nothing
about Normie Quest prize terms; nothing about Wallet Watch; no APR/APY figures anywhere.

## The three bullets (≈55 seconds spoken)

1. **What shipped.** "Week one of the Project Hub is live at clucknorris.app/hub. A token project
   can now publish a lock-to-earn program with versioned terms, holders can see exactly why they
   qualify or don't, and every payout is a receipt with the transaction that paid it — no wallet
   needed to check. Projects onboard themselves at /hub/apply, pay their month from their own
   wallet, and run their own program from a desk their operator wallet signs into. The whole
   school's quiz bank and LP Lab were audited against how Orca, Raydium, Meteora DLMM and DAMM v2
   actually work, and the two lessons that were missing from six of our seven languages are in."
2. **What was hard.** "Money paths. A second AI reviewer found four blockers before our first
   server-signed payout — a rounded total that refused a real payout, a double-pay window on a
   timeout — and a platform-wide security pass closed nine P0s, including admin links that could
   have moved liquidity from a pasted URL. None of that is visible on a demo, all of it is the
   reason a holder can trust the receipt."
3. **What's next.** "The dry-run second project and the first real receipts a holder can
   reproduce — that's the number we'll show: receipts that reproduce, over receipts issued.
   Then the operator console end to end on a phone with a real wallet."

## Shipped this week (paste-ready, with links)

Project Hub — the entry:
- Hub W1 core: project records, program versions with hashes, ledger partition, settlement journal — #307
- Public Hub pages + receipts; lock-to-earn pays itself (server-signed, journalled before broadcast) — #315, #319
- Lock to Earn engine generalised to any project; per-project routes + access tiers — #321, #322
- Platform access payments in SOL or CLKN, verified on-chain — #323
- Self-serve onboarding `/hub/apply` and the pay page — #324
- The project desk: operator wallet signs a nonce, runs its own program — #325
- Addendum C: the six answers a holder needs before locking, derived from the program's own data — #308

Money-path hardening: buy-comp server payout — #311; four reviewer blockers fixed — #313; a lock is
not a sell — #298.

School: report cards link to a real tool — #309; honest visitor counting — #310; Q&A + LP Lab
audit, seven languages re-keyed — #328; F4 two lessons in six languages — #339 (batch 2).

Security: platform deep dive P0 + P1, Codex rounds — #329, #330, #333, #334; OnlyRose room
lockdown — #338.

Front door and evidence (batch 2, #339): `/for-projects`, traction outcome counters, engine
dashboard evidence classes — confirm merged before citing.

## Where to post
Colosseum Arena (the project's update thread) and X from the CLKN account (X Premium, no 280 limit).
The pre-window disclosure line, if asked: "everything before Sep 14 13:00 UTC is listed in
docs/PRE_EVENT_STATE.md in the repo."
