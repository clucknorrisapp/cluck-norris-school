# Seeker device test — the owner's session on the real phone

**Written 2026-09-22 for the Seeker edition (`android_package app.clucknorris.seeker`, built from
the platform repo's `develop`).** This is the PRODUCT walk: what to tap, in what order, and what
the screen must say at each step. The wallet-bridge walk (does MWA connect, cancel, sign) is the
separate 10-step list in the apps repo, `docs/MWA_PLUGIN.md` § "Device checklist" — do that one
FIRST, because everything below from step 6 on assumes a wallet can connect.

No cloud session can run any of this. Every "verified" claim about the app on a phone comes from
headless Chromium with a fake wallet (`scripts/seeker-app-boot-test.cjs`). The gate this closes is
the one AGENTS.md names: *no connect-and-sign with a real wallet has ever been exercised by a
session.*

How to report: one line per step, `OK` or what the screen actually said, plus a screenshot of
anything that is not OK. Paste the lines back into the session; the numbers below are the
reference.

## 0. Before you start

- Airplane mode OFF, a real wallet installed that speaks Mobile Wallet Adapter (Phantom, Solflare,
  Seed Vault wallet), holding a little SOL (fees) and at least one junk token.
- Know your wallet's CLKN and SKR balances in dollars. The free tier is **$10 of CLKN or $20 of SKR**
  (live-priced — the app shows the token amounts). Under both = you will see the pass sheet; over
  either = you will not.
- Fresh install, or clear the app's storage, so the school starts at zero progress.

## 1. Cold open (no wallet, no signal needed)

1. Open the app. **It must land on the school**, not the tools grid. (The 09-21 lesson: the first
   build had no school at all.)
2. Four courses listed; a lesson count on each; lessons carry their belt tag.
3. Open one lesson, complete it, back out. The course shows one lesson done. Kill the app, reopen:
   **progress survives.**
4. Use the floating language pill to pick Español. Every visible string on the school home and
   inside one lesson is Spanish. Kill and reopen: still Spanish (the choice is saved). Switch back.
5. Airplane mode ON. Open a second lesson. **It renders** (the school is bundled). Airplane mode OFF.

## 2. The tools grid

6. Tap Tools. The grid leads with the flagships in this order: Rent Reclaim, Airdropper, Locker
   Room, Firepit, Project Burn — then the rest. Every card has a tier badge: **Free / Wallet /
   Tools pass / Paid.** The Airdropper's badge is **Wallet**, not Tools pass.
7. No dollar amount, token amount or SOL price appears anywhere on the grid.

## 3. Free tools, no wallet

8. **Daily** (`/tools/alpha`): today's lesson, one question, the majors. Airplane mode ON, reopen
   it: it must say it is offline, never show yesterday's numbers as today's.
9. **Listing Checkup**: paste the CLKN mint `DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS`, run.
   A result with per-venue rows. Paste garbage: a plain validation message, no crash.
10. **Ask Cluck**: ask one question, get an answer. Ask with airplane mode ON: an offline message,
    not a spinner forever.

## 4. Wallet tools — connect once, then act

11. **Wallet Checkup** (`/checkup`): with no wallet connected it shows a paste-an-address form AND a
    connect control (or says the device has no wallet) — never ask you to connect with nothing to
    tap. Connect and it switches to scanning YOUR wallet automatically, no paste needed, plus a
    quiet "Check another" control if you want to check a different address instead — that pasted
    address wins over the connected wallet until you clear it. Lists approvals and authorities
    either way.
12. **Rent Reclaim** (`/rent`): the scan lists closable accounts and the SOL that comes back, per
    account. Close ONE. The wallet shows the exact instruction before you approve; the app then says
    landed / failed / unconfirmed — the three outcomes are worded differently. The balance goes up
    by the amount it said, minus the fee it showed.
13. **Firepit**: pick one junk token. It is priced first; anything worth money is flagged before the
    burn button is live. Burn it. Same three outcomes.
14. **Airdropper** — the free-for-everyone check: build a drop to two of your own addresses, review
    (transaction count and network cost shown before signing), send. **No pass sheet appears at any
    point.** One **sign-in prompt** appears before the first batch: a message signature ("sign in
    to the Airdropper"), not a transaction — it makes the drop's public receipt yours to write.
    Approve it. After the batches confirm, the pane offers a public receipt link; open it in the
    phone browser — BOTH rows are there, verified (one batch transaction, two recipients), and
    your wallet address is NOT on the page. Then send a second tiny drop and DECLINE the sign-in:
    the tokens still send and the pane says the drop has no public receipt.
15. **Locker Room**: preview a lock (do not have to complete one). The wallet prompt, if you go
    through with it, shows your wallet as the first signer.
16. **Project Burn**: preview only unless you mean it — burning supply is real.

## 5. The tools pass — both doors

17. Open **Wallet X-Ray**, paste any address, RUN. If your wallet holds under the free tier, the
    pass sheet opens **instead of** a result. The sheet names three things with live numbers: CLKN
    amount "(around $10 worth)", SKR amount "(around $20 worth)", and the SOL price with the day
    count. If you hold over either door, the run simply runs.
18. On the sheet, **Check my wallet**: the wallet signs a one-line message (NOT a transaction — read
    it). Then either the tool runs (holder) or the sheet says exactly which door was short and by
    how much, and that SOL payment is on the website, not in the app yet.
19. Kill the app, reopen, run X-Ray again: a held pass is remembered; a denied one asks again.
20. **Holders**, **Trace**, **Buy Special**: each behaves like 17 — a pass or a sheet, never a
    silent empty result.

## 6. The Hatchery (priced per mint)

21. Open it. The fee is shown before anything else, computed live (SOL, and the CLKN discount).
    Fill the form, upload an image, preview. Do not mint unless you want a token.

## 7. Failure states worth forcing

22. Turn airplane mode ON in the middle of a Wallet X-Ray run: the pane says unavailable / offline,
    never "0 transactions".
23. Start a Rent Reclaim scan and immediately navigate to the school: no crash, nothing lands late
    on the wrong screen.
24. Disconnect the wallet from the app's own control: every wallet pane goes back to its
    connect state; nothing keeps showing the old address.

## What "done" looks like

All 24 lines OK, or each non-OK line with the words on the screen. Anything money-shaped that
said one thing and did another (a "landed" that did not land, a fee that differed from the
preview, a pass sheet on a free tool) is a P0 and stops the submission until fixed.
