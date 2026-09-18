# Operator interview script (20 minutes)

For the founder to read to a partner-project operator — POKE, CUNA, DNC or ROSE — as part of
`docs/COLOSSEUM_ROADMAP.md` §W6b. The goal is one honest answer to *"which independent operator
will pay you, for which repeated job, and what becomes easier enough that they return?"* — not a
sales pitch and not a demo review. Answers go straight into
`docs/VALIDATION_2026-09.md` §(b), verbatim.

**Rules for the founder running this, not just the operator being interviewed:**
- Don't lead the witness. If a question's phrasing below sounds like it's fishing for a "yes,"
  it's wrong — flag it back to whoever wrote this script rather than reading it as-is.
- Write down what they actually say, not what you meant them to say. A vague answer is a real
  answer; don't tighten it up on their behalf.
- Nothing here promises a reward, a yield, a specific return, or a listing. **Earn describes
  capability, never a promise** (`CLAUDE.md` — "Educate → Build → Earn"). If they ask what
  they'd earn, answer with what the tools let a holder check, not a number.
- Nothing here is about Normie Quest reward or prize terms — those are unagreed; don't discuss
  them even if asked, beyond "that's still being worked out with the NORMIE team directly."
- If they decline to be quoted, or decline the interview outright, that is itself worth a line in
  the record — "declined" is data, not a gap to leave blank.

---

## 0. Opening (1 minute) — what we are and are not asking

Read close to verbatim:

> "Thanks for doing this. This isn't a sales call and I'm not trying to get you to sign anything
> today. We built a public settlement system for project rewards programs — the Hub — and before
> we build more of it, I want to understand what your team actually does today, by hand, and
> whether anything we've built or could build makes that easier enough that you'd keep using it
> and pay for it. I'm going to ask you a few questions, then show you a couple of screens on my
> phone — some of what I show you is a dry run, clearly labelled, nothing real moves. At the end
> I'll ask if I can quote anything you said, and you can say no to any part of that."

## 1. Five questions (10 minutes) — the job, the pain, today, the price, the return

Ask in order. Don't skip ahead to the price question — it lands better after they've described
the actual work.

1. **The job.** "Walk me through the last time you had to [run a lock-to-earn payout / run a buy
   competition / do a listing checkup / put together a burn receipt / pull a holder snapshot] for
   your community — whichever of those is actually something you do. What did that look like,
   start to finish?"
   - Listen for: who touched it, what tools, how long, what went wrong last time if anything.
2. **The pain.** "What's the part of that you'd cut first if you could?"
   - Don't suggest an answer. If they say "nothing, it's fine," write that down as the answer —
     it's informative.
3. **What they do today.** "If we disappeared tomorrow, how would you do this instead? Spreadsheet,
   another bot, by hand in a group chat, a dev on your team?"
   - This is the real competitive baseline — write down the actual tool or process named.
4. **Willingness to pay.** "If this kept working exactly as it does now, hands-off, is that
   something you'd pay for? Rough range is fine — don't need an exact number."
   - Record the number or range they give, or "declined to give a number," or "no." Don't round
     it up or read enthusiasm into a vague answer.
5. **What makes them return.** "Say we run this again next month with no changes. What would make
   you want to keep going versus go back to doing it yourself?"
   - Listen for a concrete trigger (a specific report, a specific time saved, a specific person
     freed up) versus a general "it's nice to have."

## 2. Phone walkthrough of the Hub dry run (5 minutes)

Show, don't narrate over. Say what's real and what's a dry run before you open each screen.

1. Open `/hub/demo` on your phone. Say: "This is a fixture — nothing here is a real project,
   nothing pays out, it's here so you can see the shape of the thing without any real money
   involved." Walk the single-holder story: a program version → a holder's lock qualifying under
   a stated rule → funding coverage shown against what's owed → a receipt → the receipt
   reproducing its own number.
2. If it exists at the time of the interview, open `/hub/poke` (or the operator's own project
   page, if a project record exists for them) and say plainly: "This one has your name on it, and
   it's still a dry run — the `DRY RUN` badge on it means nothing has accrued and nothing has
   paid. This becomes real once we agree terms and you fund a wallet for it, and not before."
   Never let this look, sound, or read as already live.
3. If neither page shows anything relevant yet, say so directly: "We haven't built your page yet
   — this is what it would look like for another project," and show `/hub/demo` only.

## 3. The consent line (1 minute)

Ask this exactly, and write down the exact answer:

> "Is it okay if I quote what you said today — your words, not paraphrased — in a document we
> use to explain what we've learned? You can say yes to all of it, yes to some of it, or no. And
> if you say yes today, you can still tell me later to take a quote out."

Record: yes / yes-with-exceptions (name which) / no. If yes-with-exceptions, note exactly which
answers are in and which are out before ending the call.

## 4. The close (3 minutes)

> "That's everything I needed — thank you. Nothing changes for you today; we're not asking you to
> sign up to anything or move any funds. If we do build more of this for your project, the next
> step would be [terms discussion / a funded wallet / nothing yet, we're still learning] and I'll
> come back to you directly before anything goes live. Anything you want to ask me?"

Answer their questions plainly. If asked about pricing, the honest current answer is "custom,
per project — we don't have a standard number yet, which is part of why I'm asking you these
questions" (`docs/COLOSSEUM_ROADMAP.md` §4 item 5). If asked whether this is connected to the
Colosseum hackathon, say yes and that their answers (with their stated consent) may appear in the
submission, described honestly either way.

---

## After the call

Fill the matching block in `docs/VALIDATION_2026-09.md` §(b) the same day, while the answers are
fresh, verbatim where they gave you a quote and consent, summarized in your own words otherwise
(and marked as your paraphrase, not their words). Do not soften a "no" or a vague answer into
something that reads better in a submission — the honest headline in §(d) depends on this record
being accurate, not encouraging.
