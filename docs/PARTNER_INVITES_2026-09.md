# Partner invites — 2026-09 (W9 part 2)

Paste-ready Telegram DM drafts for the founder to send **by hand, one at a time, to a real
person he already knows at that project.** Nothing here is sent automatically — no `tgSend` or
`postToX` call site was added or changed for this file, and none should be. These are words for
the owner to copy, edit to sound like him, and send from his own account.

**Purpose.** `docs/COLOSSEUM_ROADMAP.md` §W9 part 2 lists "the existing partner tokens invited to
open a Hub page" as one of the cheapest real-usage items in the window. An invite is not traction
by itself — an operator opening `/hub/<project>` themselves, or the founder learning something
concrete from the 20-minute interview, is. This doc only gets the ask in front of the right
person; `docs/OPERATOR_INTERVIEW_SCRIPT.md` is the actual interview, and its own consent line
governs anything quoted afterward — this DM's job is only to book that call and point at the two
pages, nothing more.

**Rules every draft below follows (CLAUDE.md, "Educate → Build → Earn" + "How to say Earn
honestly"):**
- No reward, yield, APR/APY, or return is promised or implied, for the operator or their holders.
- No listing, endorsement, or "verified" claim is made or implied.
- Nothing about Normie Quest reward or prize terms — not mentioned, not hinted at.
- Every dry-run page is called a dry run, in the same message, not just on the page itself.
- Nothing claims a project's page is live if it isn't. Check the status table below before
  sending — it may be stale by the time you read this; a live `/hub/<id>` fetch is the truth.
- The interview's own consent line (`docs/OPERATOR_INTERVIEW_SCRIPT.md` §3) is what actually
  clears using their words — this DM doesn't pre-empt it or ask for quotes itself.

---

## Status check before sending (as of 2026-09-18 — re-verify before you actually send)

| Project | Hub page today | What to say |
|---|---|---|
| POKEAHOE | `/hub/poke` exists, seeded **`dryRun: true`** (Colosseum E10) — no funding wallet, nothing accrues, nothing pays | Point at the real dry-run page; call it a dry run in the same breath |
| CUNA | Lock-to-earn is live and paying **outside the Hub**, via the pre-Hub `/cuna-payout` mechanism (`docs/CUNA_STAKING_RUNBOOK.md`) — CUNA is HELD on the Hub itself (owner, 2026-09-17: "do not duplicate cuna yet") | Don't invite them to "open a Hub page" — their programme already runs; invite the interview only, and mention the no-wallet demo as "what the Hub version would look like" |
| DNC | No Hub project record yet | Invite them to open one from scratch, same as any new project via `/for-projects`; show `/hub/demo` first |
| ROSE | No Hub project record yet (ROSE was the roadmap's earlier dry-run candidate; the owner picked POKEAHOE instead on 2026-09-18) | Same as DNC — invite from scratch, show `/hub/demo` first |

---

## 1. POKEAHOE

> Hey — quick one. We built a public page for how a project's lock-to-earn terms and payouts get
> shown to holders — a "Hub" page, `clucknorris.app/hub/poke`, already has your name and logo on
> it. Right now it's a **dry run**: nothing on it accrues or pays anything, it's just there so you
> and I can look at the same screen. Wanted to show it to you properly and hear what you think —
> got 20 minutes sometime this week? No commitment, nothing to sign, nothing moves until we
> actually agree terms and you fund a wallet for it.

## 2. CUNA

> Hey — since lock-to-earn is already running for you guys outside the Hub, I wanted to show you
> what the newer public version looks like — a page a holder can open and see exactly how their
> payout was worked out, reproducible from what's published, no trusting us for the math. We're
> not touching your live payout mechanism, this is just so you can see where the Hub work is
> headed before we ever talk about moving CUNA onto it. Got 20 minutes to look at a demo (no
> wallet needed, nothing real) and talk through what would actually make your life easier?

## 3. DNC

> Hey — we built a public page any project can use to publish its lock-to-earn terms, so holders
> get a receipt they can check themselves instead of taking our word for it. Nothing's live for
> you on it yet — I'd want 20 minutes to walk you through a no-wallet demo first (completely a
> dry run, nothing real moves) and hear what your actual process looks like today before either
> of us decides if it's worth building out for real. No pressure, no commitment either way.

## 4. ROSE

> Hey — we've been building out a public page for lock-to-earn terms and receipts (the "Hub") —
> nothing set up for you on it yet. Before pitching you on anything, I'd rather show you a
> no-wallet demo (dry run, nothing real) and hear how you're actually handling this stuff today.
> 20 minutes sometime this week? No commitment, just want your honest read.

## 5. Generic — a new project arriving via `/for-projects`

For anyone who lands on `clucknorris.app/for-projects` and reaches out cold, or gets referred by
someone already using the school.

> Hey — thanks for reaching out. Before anything else: here's a no-wallet demo of how the Hub
> works — `clucknorris.app/hub/demo` — it's a **dry run fixture**, nothing on it is a real
> project and nothing pays. It shows the shape of the thing: a program's terms published, a
> holder's lock checked against them, a receipt they can reproduce themselves from the published
> numbers, no trusting us for the math. If that looks like something worth 20 minutes, I'd like
> to ask you a few questions about how you're handling this today before we talk about building
> anything real for you — nothing's promised on either side going in.

---

## Sending checklist (do this every time, not just the first)

1. Re-check the status table above against the live site — a page can go from dry-run to real,
   or a project can already be mid-conversation, since this doc was written.
2. Send the DM from your own account, in your own words if the draft doesn't sound like you.
3. If they say yes, use `docs/OPERATOR_INTERVIEW_SCRIPT.md` for the call — its own consent line
   is what actually clears quoting anything they say, not this DM.
4. Write down what happens either way (yes, no, no reply) — a decline is itself a data point for
   `docs/VALIDATION_2026-09.md`, not a gap to leave blank.
