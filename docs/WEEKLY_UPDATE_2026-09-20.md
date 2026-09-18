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

## Refresh on Sep 19 checklist (before recording)

Confirm these before finalizing the script and picking the demo URL to show on camera. Don't
assume from this file — re-check on the day.

- [ ] `git log origin/develop` — confirm PR #339 (Colosseum batch 2: `/for-projects`, traction
      counters, roadmap extension E1–E9, weekly-update script) is merged. It is, as of this
      writing (`83e5b11`).
- [ ] Confirm whether PR #340 (batch 3: E1 reproduce-a-receipt, E2 `/hub/demo`, E4 settlement
      schemas + README, E5 receipt-teaches, E7 onboarding clock, W5 engine dashboard evidence
      classes, and the seven-language parity fix for the seedphrase/inheritance lessons) has
      merged to `develop`. As of 2026-09-18 it has not — it's still on the
      `claude/normie-quest-sprite-swap-gljw2i` branch.
- [ ] `git log origin/main` — confirm which of the above is actually **promoted** (owner's
      explicit go; never assumed). As of 2026-09-18, `main` is at PR #337 — the Hub core, public
      pages, apply/pay/desk and generalised Lock to Earn engine (W1–W3) are live in production;
      the front door, traction counters, W5, and every extension item (E1/E2/E4/E5/E7) are on
      staging only, not yet promoted.
- [ ] Pick the demo URL to show on camera based on what's actually promoted at recording time:
      - If only W1–W3 are promoted: show `clucknorris.app/hub` and a real project page
        (`clucknorris.app/hub/cuna`) — the live, working settlement flow.
      - If PR #340 is merged and promoted by recording day: show `clucknorris.app/hub/demo` (the
        no-wallet, DRY-RUN-labelled single-holder walkthrough) instead — it's the cleaner demo
        surface and needs no wallet on camera.
      - Never show a `develop`/staging URL as if it were the live product.
- [ ] Re-read `docs/ARENA_POSTS.md`'s status table immediately before posting anything from it —
      it is a snapshot from 2026-09-18 and will be stale by the time PR #340 lands.
