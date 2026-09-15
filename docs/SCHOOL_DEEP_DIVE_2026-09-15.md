# The School — deep dive, findings and ideas (2026-09-15, overnight)

Owner ask (2026-09-15, 03:30 UTC): *"Keep working through the night on plans for hackathon. Deep
dive on the school. Lessons. Everything. Ideas for making things better."*

Everything below is from the code on `develop` at `982e9e7`, the live site, and the server's own
90-day analytics and learning funnel read on 2026-09-15. Numbers are quoted with their source so
they can be re-read. Opinions are marked as opinions.

---

## 0. The five things that matter

1. **The school loses half of everyone at lesson one, and almost nobody after it.** 90 days: 270
   started the school → 197 opened lesson 1 (*Liquidity Pools*) → 87 finished it (44%) → 65
   opened lesson 2. From lesson 2 on, completion is 90–128% (people finish more than they start,
   because backfilled completions count). Whoever survives lesson 1 graduates. Lesson 1 is the
   product's biggest single lever and it is one array reorder away.
2. **The core school is thin.** Each of the 14 core lessons is ~110–150 words of intro, five
   glossary cards and a 5–7 question quiz you pass with 2 correct. The LP Lab lessons are
   600–1,300 words with sections, hooks and verdicts. The flagship is the shallow one.
3. **The traffic number in the Colosseum copy is not a learner number and should not be used.**
   The analytics count every non-API GET with a non-bot user agent, across every host (the game
   and the CUNA staking site land in the same bucket). Since 2026-08-16 the site records
   ~5,000 views a day from ~4,500 "visitors" — one page each, with under 1% carrying a referrer —
   where the pre-August baseline was ~1,000 views from ~300 visitors at three pages each. Normie
   Quest has four verified players on its all-time leaderboard, so it is not the game. That shape
   is automated traffic. The honest, verifiable figures are the on-chain ones (graduates, locks,
   payouts) and the funnel. **The judges-note line has been corrected in the submission doc;
   the form field needs the same edit (owner).**
4. **The school is hard to find from the traffic the site does get.** `/` (the marketing homepage)
   is the top path; `/school` had 1,055 views in 90 days and the school produced 270 starts. The
   homepage's school links go to `/education`, a static page, which links to the school. Two hops
   and a page of copy before lesson one.
5. **There are three overlapping curricula** — the React school (14 core + 7 Incubator + 14 LP
   Lab), the Library (11 articles + 10 LP notes), and the AI Classroom (4 courses, 52 lessons
   generated from a separate `CURRICULUM`). The Telegram guide prompt still says "12-lesson
   course". A judge clicking around will find three different lesson counts.

---

## 1. Inventory — what exists today

| Surface | Where | Size | Notes |
|---|---|---|---|
| **Incubator** (absolute beginner) | `/school` → Incubator | 7 lessons, 110–200 words + 4 cards + 3 true/false-ish questions each | Good voice ("a wallet holds KEYS, not money"). 44 starts, 13 completions in 90 days (30%). |
| **Core school** (belt-ranked) | `/school` → The Schoolyard | 14 lessons, ~120 words + 5 cards + 5–7 MCQs; pass = 2 correct; sequential lock | Lessons 13–14 (Seed Phrase Survival, If Something Happens To You) are 280–310 words and the best of the set. |
| **LP Lab** | `/lp-lab` | 14 lessons, 565–1,337 words, sections + `cluckHook` + `cluckVerdict` + 3–8 questions | The real curriculum. Owner-named specialty. |
| **Library** | `/school` → Library | 11 deep dives (600–890 words) + 10 short LP notes + one 2,800-word LP strategy piece | Self-paced, no exams. Strong content, weak discovery. |
| **AI Classroom** | `/classroom` | 4 courses / 52 lessons (`/api/curriculum`), live lecture + exam mode, its own graduate claim | A parallel school with different counts. |
| **Chain pages** | `/learn/<asset>` ×7 languages | one page per coin | SEO surface; `es/doge` and `zh/doge` are in the top-15 paths. |
| **Ask Cluck** | in every lesson (compact) + landing + `/ask-cluck` | Claude, 15/min, 150/day per IP | Present where it should be. |
| **Read-aloud** | `public/read-aloud.js` | ElevenLabs with browser fallback | Works on lesson text; quiz chrome is `data-read-skip`. |
| **Languages** | `public/i18n/<lang>.school.json` | 7 languages, ~4,000 keys each | Text-keyed dictionary swept over the DOM: **editing an English sentence orphans its key in six languages** (CLAUDE.md trap). Any lesson rewrite must go through `scripts/i18n-sweep.js`. |
| **Graduation** | `/api/claim` → transcript + cNFT | 12 of 14 lessons, ≥15 min, ≥3 five-minute windows | Enforcing since 2026-09-02; 22 graduates all-time; 19 graduation events in 90 days. |
| **Deep link to a lesson** | `/#lesson=<id>` | shipped tonight (#308) | Did not exist before; the daily lesson tweet could never link to a lesson. |

Funnel, 90 days to 2026-09-15 (`/api/stats` `funnel`):

```
school_start 270   incubator_start 44 → incubator_complete 13   graduation 19

lesson         start  complete  rate
lp               197       87    44%   ← lesson 1
rugs              65       60    92%
volatility        46       45    98%
slippage          38       36    95%
wallets           36       41   114%
tokenomics        31       32   103%
marketcap         30       27    90%
memecoins         22       22   100%
bags              20       22   110%
onchain           19       23   121%
staking           18       23   128%
dex               18       22   122%
```

(`seedphrase`, `inheritance` and `liquidity` have 1–3 events — the two late core lessons are barely
reached; `liquidity` is the Incubator's.)

---

## 2. The funnel, read plainly

- **197 → 87 at lesson 1 is not the quiz.** The pass mark is 2 of 5 and the explanations teach
  the answer. People leave on the *content*: *Liquidity Pools* opens with "smart contract holding
  two tokens", "AMM", "impermanent loss" — five pieces of jargon in 125 words, to someone who
  clicked "Enter School" from a page that promised plain words. The Incubator exists for exactly
  this person, but the landing's primary button starts the core school (270 vs 44 starts).
- **87 → 65 at the lesson-2 door** is the second leak: a third of the people who passed lesson 1
  did not open lesson 2. The report card says "This school has no participation trophies. Hit the
  books." on a fail and "NEXT CLASS →" on a pass; there is no "here's what you just learned and
  why the next one matters" — the bridge is a button.
- **Everything after lesson 2 holds.** Whatever the lesson design is, it works once someone is in.
  The content per lesson is thin (see §3) but the *format* retains. Don't redesign the format;
  fix the entrance and deepen the content.
- **The Incubator's 30% completion** over seven very short lessons suggests its 3-question
  true/false quizzes and "continue" flow are not the issue so much as that people arrive there by
  accident (a small secondary button) rather than by placement.
- **Graduation is 19 in 90 days from 270 starts (7%).** Against lesson-1 survivors it is 22% —
  fine for a 12-lesson requirement. The gate is not the problem; the door is.

---

## 3. Quality, surface by surface (opinion, with the evidence)

**Core lessons.** Format is good (quote → intro → cards → exam → report card → next). Depth is
not. 120 words cannot carry "the truth, plainly" about rugs or tokenomics; the cards are
definitions, not explanations, and there is no example. Compare the LP Lab's *Impermanent Loss*
(868 words, a worked number) with the core *Liquidity Pools* card "When token prices diverge, your
pool share shifts — you may end up with less than just holding." The two late lessons the owner
wrote later (*Seed Phrase Survival*, *If Something Happens To You*) are 2.5× longer, story-first,
and are the standard the other twelve should meet.

**Tone.** "No participation trophies. No hand-holding. Just hard knocks." / "Hit the books. Try
again." is the brand and it is fine — but the owner's own line is *a school that assumes you know
nothing and never assumes you are stupid*. A first-timer failing lesson 1 sees the former. The
fail card should teach, then tease; it can keep the voice.

**Incubator.** The best-pitched copy in the product. Undersold by placement.

**LP Lab.** Already the thing a judge should see. Owner-run book, real numbers, verdicts. Two
notes: lesson 8 is 1,337 words (long for a phone); `/education` advertises "fee APR versus IL" —
correct in an LP context and outside the Hub's no-APR rule, but worth a glance.

**Library.** Eleven real articles nobody is routed to. `/school` → Library tab is the only door.
"How to Research a Token" and "Wallet Security Deep Dive" are the two most useful pages on the
site for the person the mission describes, and neither is linked from a lesson.

**AI Classroom.** A second school. Fine as a mode ("prefer a live teacher?") but its 12-lesson
Fundamentals course is not the 14-lesson core, its counts appear in the Telegram guide prompt,
and it has its own graduate claim. For the hackathon window it is simplest to present it as *the
same curriculum, taught live* and make its course list derive from the same arrays.

**Ask Cluck.** Right place, right prompt (educational only, no advice, no politics). The compact
box in every lesson is the feature to show judges; it is not visible on the lesson intro until you
scroll. The 150/day per-IP cap is generous.

**Read-aloud.** Works. Not advertised on the lesson screen itself — the button is easy to miss.

**Languages.** Real (static dictionaries, ~4,000 keys), which is rare. The trap is real too:
edit one English sentence and six languages silently show English. Any content work below has a
translation step, and `scripts/i18n-sweep.js` is how it is found.

**`/education` page.** Still carries "the chain shows what, never why" in the footer — the
phrasing the owner asked to retire — and describes the LP Lab as "Built on a live LP book we run
ourselves". Both are copy fixes; the second should be checked against what the engine is doing now
(all engines paused since 2026-09-05).

---

## 4. Ideas, ranked by (evidence × impact) ÷ effort

Each has: what · why · effort · in-window?

### A. Fix the entrance (the 197 → 87 → 65 leak)

- **A1. Put a placement step in front of "Enter School".** Three taps — *Have you owned crypto?
  Have you used a wallet? Have you lost money to a scam or a dump?* — route to Incubator, core
  lesson 1, or a later lesson. The landing already has the concierge; this is deterministic and
  needs no AI. Effort: half a day. In-window: yes (product-facing → staging).
- **A2. Make *Wallets & Keys* lesson 1 and *Liquidity Pools* lesson 4.** The belt names are
  positional (FRESHMAN … EMERITUS) so the reorder is a swap of `belt` values plus the array order;
  completion state is by `id`, so nobody loses progress. Rationale: the wallet lesson is what
  every first-timer needs on day one, and its 114% completion says it retains. Effort: an hour +
  i18n sweep (titles unchanged, so near zero). In-window: yes. **Owner decision** — it changes
  the belt ladder people have seen.
- **A3. Replace the hard lock with a recommended path.** Keep the numbered order and the ✅/🔒
  visuals, but let a learner open any lesson; graduation still needs 12. Effort: one line
  (`locked` → `recommended`). Risk: none to the credential (server ledger counts marks, not
  order). In-window: yes.
- **A4. A real bridge on the report card.** Pass: two sentences — what you can now do, and the one
  thing the next lesson protects you from. Fail: the two questions you missed, restated as the
  lesson's point, then "try again". Effort: a day for 14 lessons of copy + i18n. In-window: yes.
- **A5. Rewrite lesson 1's intro in plain words** regardless of A2. Sample, 118 words, same
  facts, no jargon before its definition:

  > When you buy a token on Solana you are not buying from a person. You are buying from a pot
  > of tokens that other people put in — a *liquidity pool*. The pot holds two things, say SOL
  > and the token, and a formula sets the price from how much of each is in the pot. Every trade
  > pays a small fee to the people who filled it. That is all a DEX is. Three things follow, and
  > each one has cost somebody money: a small pot moves price a lot; the people who filled the pot
  > can empty it; and filling a pot yourself can leave you with less than if you had just held.
  > This lesson is those three things.

### B. Make the core lessons real

- **B1. Bring the twelve short core lessons up to the standard of the two long ones.** Target
  350–500 words each, story-first, one worked example from Solana, then the cards, then the exam.
  Draft with Claude against the LP Lab house style, owner reads every one. Effort: 2–3 days of
  drafting + owner review + a full i18n sweep and re-translation (the expensive part: 12 × 6). In
  window: yes, and it is the single most visible "the school keeps getting better" item. **Owner
  decision** — approve the standard on one sample lesson first (A5 is that sample's opening).
- **B2. Every lesson links the tool that shows the concept live** — Rugs → Wallet Checkup,
  Tokenomics → Holders, On-Chain → X-Ray, Liquidity → LP Lab, Wallets → Firepit, Bags → Listing
  Checkup. "Now go look at a real one." That is the Educate → Build bridge in one line per lesson
  and no competitor has it. Effort: a day. In-window: yes.
- **B3. Link the Library from the lessons** (Rugs → *How to Research a Token*; Wallets → *Wallet
  Security Deep Dive*; On-Chain → *Reading Solscan*). Effort: hours.
- **B4. Raise the pass mark to 3 of 5 only after B1** — with richer content it stops being a
  hurdle and starts being a signal. Not before.

### C. Make the school findable

- **C1. Homepage → lesson one in one tap.** The homepage's school CTA goes to `/education`
  (copy) which goes to `/school` (landing) which goes to a lesson. Send the primary CTA to the
  placement step (A1) directly. Effort: hours. In-window: yes.
- **C2. Use the new `/#lesson=<id>` link everywhere a lesson is mentioned** — the daily lesson
  tweet, the Telegram bump, the `/education` cards, the Hub's Addendum C block. Effort: hours.
- **C3. Retire "the chain shows what, never why" from `/education`** and re-check the LP-book
  sentence against the paused engines. Effort: minutes.
- **C4. One lesson count, everywhere.** Derive the Classroom's Fundamentals course and the
  Telegram guide prompt from the same arrays `lib/curriculum.js` already extracts. Effort: half a
  day.

### D. Measure honestly (W9 in the roadmap)

- **D1. Stop citing raw views.** Correct the Colosseum judges note (done in the doc, form pending)
  and the `/about` traction table to on-chain and funnel numbers only.
- **D2. Split analytics by host and add a human signal.** Key `paths` by `host` so the game and
  the staking site stop landing in `/`; count a visitor as human only after a second page or a
  funnel event; report both. Effort: half a day; keeps the 90-day history. In-window: yes.
- **D3. Instrument the leak.** Two funnel events — `lesson_intro_read` (scrolled to the exam
  button) and `quiz_start` — so "left on the reading" and "left on the exam" can be told apart.
  Effort: an hour.
- **D4. Weekly funnel line in the ops report** (the 12-hour report already exists).

### E. Accessibility and languages (the owner's standing priority)

- **E1. Add languages by demand.** `/learn/es/…` and `/learn/zh/…` are in the top-15 paths, so
  Spanish and Chinese are the ones people already find. Next by Solana community size: French,
  Indonesian, Turkish, Russian, Korean. The pipeline exists (`i18n-sweep.js` + Claude MT); each
  language is a dictionary of ~5,000 keys and an audit run. Effort: a day each including a
  native-speaker pass on the 30 most-read strings. In-window: yes. **Owner decision** — which.
- **E2. Put the read-aloud control on the lesson header**, not the corner. Minutes.
- **E3. Phone-first pass on the exam screen** — option buttons under 44 px tall on small phones.
- **E4. Continue where you left off across devices** once a wallet is connected (the transcript
  is wallet-keyed already; progress is localStorage only).

### F. What the hackathon judges will actually click

The demo script opens a lesson, switches language, taps read-aloud, asks Cluck. Today that
lesson will be *Liquidity Pools* at 125 words. If only one content change ships in the window,
it should be **lesson 1 rewritten to the long-lesson standard, with its tool link (B2) and its
Library link (B3)** — the first ninety seconds of Educate, done properly. Everything else in A–E
compounds it.

---

## 5. Proposed plan (no owner input needed for the first block)

**Tonight / tomorrow, on `develop`, no decisions required:**
1. C3 — retire the retired phrasing on `/education`; check the LP-book sentence.
2. D1 — corrected judges note (done); flag the form field.
3. D3 — the two funnel events.
4. B2 + B3 — tool and Library links on the lesson report card (the bridge A4 will use).
5. E2 — read-aloud control to the header.

**Needs one owner answer each, then ships:**
- A2 lesson order (yes/no) · A3 unlock (yes/no) · B1 standard (approve the A5 sample or edit it)
  · E1 languages (which two first) · C4 Classroom consolidation (present as "same curriculum, live"?)

**Bigger, in-window, sequenced after the Hub's W2 pages start on the frozen schema:**
- B1 full rewrite of twelve lessons with re-translation (2–3 days + review).
- A1 placement step and C1 homepage path (1 day).
- D2 host-split analytics (half a day).

---

## 6. Not doing without an ask

Nothing that changes what a graduate has to do (12 lessons, the ledger), nothing that touches
the claim/mint path, no new AI surfaces, no change to the Classroom's exam or graduate claim, and
no reordering of lessons (A2) until the owner says so — people have belts.
