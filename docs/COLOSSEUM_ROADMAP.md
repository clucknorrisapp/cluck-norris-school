# Colosseum window roadmap — 2026-09-14 13:00 UTC → 2026-10-13 06:59 UTC (revision 3)

The operating plan for the four weeks. One founder, no cofounder, an agent team: every
workstream below is a separately scoped session with a definition of done, and the founder is
the only sign-off. Written 2026-09-13 from the think tank
(`COLOSSEUM_THINK_TANK_2026-09-10.md`), the Project Hub design
(`DESIGN_PROJECT_HUB_2026-09-10.md`, four Codex rounds, plus **Addendum B** added with this
revision) and the submission package (`COLOSSEUM_2026_SUBMISSION.md`). This file supersedes the
think tank's §6 calendar.

**Revision 2 (2026-09-13 21:00 UTC)** folds in Codex's Round 0 review of revision 1 (PR #295):
the centerpiece is confirmed; the settlement rules are tightened (Addendum B); every promised
test is assigned or explicitly deferred; W4 and W5 are cut to what the Hub integration gate
needs; the demo target is the Hub story, not the pre-window tour; a validation deliverable is
added; the concurrency claim is corrected; a feature freeze and a phone rehearsal precede the
recording slot.

**Revision 3 (2026-09-14 13:30 UTC, in-window).** Written after the judging criteria were
**read directly from colosseum.com/hackathon** rather than from memory or a summary. All seven
criteria confirmed: Founder + Market Fit, Insight, Product + Execution, Potential Market Size,
Founder Communication, Viability, **Traction** ("does the product demonstrate existing demand or
revenue"). Also confirmed: a 2–3 minute presentation video and a **separate** demo video of at
most 3 minutes; pre-existing code allowed but all prior development must be disclosed, with
misrepresentation carrying **disqualification, future bans and prize revocation**; one product
per builder; weekly ~1-minute updates strongly recommended.

Revisions 1 and 2 optimised for Insight and Product + Execution and were close to silent on
Traction, which is a seventh of the score. Revision 3 fixes four gaps:

1. **Traction was measured, not made.** Revision 2 had "traction refreshed" in the final three
   days and a table to reorder. There was no plan to *create* any, and `lib/analytics.js`
   counts page views and tool hits, not product outcomes. → new **W9**, and §4 item 1 is
   promoted from a decision to a **dated blocker**.
2. **Weekly updates were absent entirely.** → new **W10**, on the calendar.
3. **The GitHub repo is a graded artifact and ours is misdescribed** — the description still
   says "built for the Bags Hackathon" and advertises Cluck Score, a feature retired for giving
   good scores to tokens that then rugged. → added to W6, first 48 hours.
4. **Nothing has been verified end to end with a real wallet** and the first attempt was
   scheduled for the Sep 28 rehearsal, one day after feature freeze. → a real-wallet smoke is
   pulled forward to the Sep 17–21 block.

Nothing in revisions 1–2 is reversed. The thesis, the schema freeze, the workstreams and the
money rules stand.

Owner, 2026-09-13: *"I don't think we need another cofounder, we have all the skills, ideas,
resources — cofounders don't understand what we have been building; we can do virtual agents
to help us with all aspects."* The team section of the submission says so, in the framing Codex
suggested (§6 below).

---

## 0. Where we stand on the eve

### Status as of 2026-09-18

Derived from what has actually merged (`git log`, `docs/PRE_EVENT_STATE.md` "Built inside the
window"), not from intent.

| Workstream | Status | Note |
|---|---|---|
| W1 — Hub core (settlement protocol) | **Shipped** | #307 (pure gate). |
| W2 — Hub public surfaces | **Shipped** | #315 (first cut), #319 (page scoping + honest "owed"). |
| W3 — Operator desk | **Shipped** | #325 (wallet-signed operator session). |
| — Apply / pay (self-serve onboarding) | **Shipped** | #323 (payments), #324 (apply + pay pages). |
| — Lock to Earn engine (generalised) | **Shipped** | #321 (engine), #322 (per-project routes + tiers). |
| W4 — `/for-projects` front door | **Not started** | No `/for-projects` route in `server.js`. Being built now. |
| W5 — Engine dashboard evidence boundaries | **Not started** | No `engineLog:<project>` ring buffer or illustrative/historical/retained split in code yet. |
| W6 — Credibility and truth pass | **Partial** | Repo description fixed (no more "Bags Hackathon" / Cluck Score — confirmed live). F4 (seedphrase/inheritance lessons in the six translated bundles) still **open** — `grep -c seedphrase public/i18n/<lang>.school.json` = 0 in all six. F12 (traction table order) **done** — the table now leads with Learners, cites the on-chain funnel, and the page-view figure was removed (commits `a28a471`/`f9ee792`, PR #310 fixed the analytics behind it). |
| W6b — Validation (operator interviews, one pilot) | **Not started** | No `docs/VALIDATION_2026-09.md`. Owner-led. |
| W7 — Story: demo, pitch, submission | **Not started** | Submission copy landed (#303) but the demo cut, pitch recording and filing have not. |
| W9 — Traction: instrument + create | **Part 1 being built now** | No outcome counters (wallets connected, programs created, receipts issued, etc.) in `lib/analytics.js` yet; no `docs/TRACTION_2026-09.md`. |
| W10 — Weekly updates | **First update due Sep 20** | None posted yet; the calendar's first Sunday slot has not arrived. |
| §4 item 1 — dry-run second project | **Still undecided, overdue** | Was "decide by Sep 17"; today is Sep 18 and no second project has been named in the roadmap or the code. This is the longest pole in the traction plan (§4 item 1, §1). |

---

**Already live or on `develop` (pre-window, disclosed, not claimed):** the engine dashboard P0
at `/liquidity-engine`, the Lock of Fame index, the quiz-free `/curriculum`, project-team
navigation (#282); the tools pass as a signed session, server-enforced (#283; #284 carries the
Codex round 1–4 fixes and is green); `/investors` → `/about`; the prize wheel deleted; README
referral params stripped; SSRF safe-fetch merged; the store edition v1.0.2 released; the CUNA
drawing registry.

**Open from the credibility list (first 48 hours; judges see these first):**

| # | Item | Status 2026-09-13 |
|---|---|---|
| F4 | Six translated school bundles lack the `seedphrase` and `inheritance` lessons | **Open** — `grep -c seedphrase public/i18n/<lang>.school.json` = 0 in all six. "Seven languages" is false until this ships. |
| F2 | Submission §3 team + founder story | **Open** — placeholders. Framing in §6 below; the incident itself is the owner's to supply. |
| F12 | Traction table leads with self-locks and a $12 payout | **Open** — reorder to learners → visitors → partner tokens → mechanism proof. |
| repo | GitHub description says "built for the Bags Hackathon", advertises retired Cluck Score | **Open (found 2026-09-14)** — the repo link is a required submission field and a judge opens it first. |
| §8 checklist | Colosseum registration, `[OWNER]` placeholders, logo export, demo captures, pitch video | **Registered 2026-09-12.** Rest open. |
| #284 | Tools pass fixes (Codex rounds 1–4) | Round-4 findings fixed 2026-09-13 (attempt durable before broadcast; offer read per request; client test). Green. Owner's "merge 284" lands it in staging. |

**Not started (the in-window work):** everything in §2.

---

## 1. The thesis the judges will be scored on

Lead with **a project-owned rewards program whose terms, eligibility and payments a holder can
check without trusting us**: the Project Hub with versioned program records and per-recipient
receipts. The three-minute question is *"can a holder independently check what they earned and
what actually arrived?"* Show one holder, one program version, a funding coverage/shortfall
state, a historical payment and its calculation export, then a clearly labelled second-project
dry run. The school is the front door; every other tool is a labelled "also live, same stack"
wall. The company theme is the owner's: **Educate → Build → Earn** (CLAUDE.md, the mission).
**Prove** is not a fourth pillar, it is what makes Earn believable, and it is the leg this entry
is built on — a holder who can check what they were owed and what arrived. It must read as in-window work, started after 11:00 UTC
Sep 14, with the design doc as the disclosed prior art.

**The number.** *Reproducible receipts ÷ total receipts*, with the period and the denominator
stated (e.g. "12 of 13 receipts in the Sep 9 batch reproduce; 1 has missing inputs"). A measured
figure, never a target presented as achieved.

**Two corrections from Round 0.** (1) Revision 1 repeated the think tank's line that no
multi-tool bundle has ever placed at Colosseum. Codex checked: Unruggable, Seer and Hyperstack
placed in the Cypherpunk results. The single-mechanism lead is a positioning judgement (one
legible buyer and problem), not a statistical law, and the plan stands on that judgement. (2) A
program hash served by the same server that computes the payout is arithmetic a reader can rerun
over *server-supplied* observations; it is not proof that the server omitted no qualifying
escrow. Until an independent commitment exists (Addendum B §B5: the hash committed in a memo
transaction signed by the funding wallet at publish, and mirrored in the repo), the public claim
is "the calculation is reproducible from the published inputs", not "independently verified".

**One product, and Normie Quest is not it.** Colosseum allows one product per builder, so the
entry is the Hub. That decision stands and is not reopened. But Normie Quest is our strongest
*evidence* — a shipped, gated, played product — and the Hub will have few users by Oct 12.
Excluding it from the entry does not mean hiding it: it belongs in the **traction and team**
sections as evidence of founder–market fit and of our ability to ship and attract users, clearly
labelled as a separate product and never as the submission. Same for the school's learners.
Claiming it as the entry would be misrepresentation; citing it as evidence is simply true.

Two rules that override everything: nothing arms an engine, and nothing is paid for the camera.

---

## 2. Workstreams — one session each

Every session gets: its own branch off `develop`, an explicit `model:` on every subagent it
spawns (Haiku for mechanical, Sonnet for the build, Fable/Opus only for money-path judgement),
CI + the visual gate before every push, a PR opened on the first commit, Codex review on the PR,
and a definition of done it can prove. **Concurrency, corrected:** each remote session runs in its
own container with CLAUDE.md's 2–3-agent cap applying *inside* it, but the founder is one
reviewer and staging is one environment, so the coordinator runs **at most three sessions at a
time** and books explicit integration and review slots (§3) rather than multiplying agents.
Nothing merges to `main` without the owner's "promote".

**Schema freeze: Sep 16, end of day.** The entities in design §2 as amended by Addendum B are
frozen before any fixture work in W2 starts; a schema change after that is a PR to the design doc
first. **Addendum C (the education block, adopted 2026-09-14) adds no entities** — it is a
surface, a server-side lesson map and three tests — so it does not touch the freeze.

### W1 — Project Hub: the settlement protocol and money rules (weeks 1–2)
Branch `hub/core`. The pure libs: project record, program versions with hashes, the ledger with
the partition `accrued = available + reserved + paidApplied`, eligibility with reason codes, the
batch lifecycle, and — new with Addendum B — **one idempotent settlement journal event per
transfer** that is the sole source of truth for both "identity consumed" and "row paid",
**overpayment accounting** with `paidTotal` / `paidApplied` / `excess` kept distinct and never
netted across wallets, and **append-only per-transfer settlement entries** on every receipt. CUNA
migrates onto it.
**Done when (pure gate):** acceptance tests **1, 2, 3, 4, 5 (as restated in B2), 6, 7 (as
restated in B3), 10** and Addendum B's **fault-injection cases before and after each durable
boundary** exist as CI scripts and pass; `cuna-payout-verify` still verifies batch
`cb_8d28a7ea39`; `mutating-get-guard` covers every new route. Tests 8 and 9 are NOT W1's gate —
they need W3 (below).
Model: Sonnet builds, Fable verifies the money rules (two lenses, per the budget rule).

### W2 — Project Hub: public surfaces (week 2)
Branch `hub/pages`. `/p/<id>`, `/p/<id>/program/<v>`, `/p/<id>/eligibility?wallet=`,
`/receipt/<batch>/<wallet>` with its settlement entries and totals, the JSON mirrors, and the
**independent commitment of each published program hash** (Addendum B §B5). Plain words, the
three funding numbers labelled, lessons linked at the moment of action. Seven languages via the
dictionary pattern. Starts on frozen-schema fixtures from Sep 17, switches to W1's libs as they
land.
Also W2: **the Addendum C education block** — the six questions a holder should have answered
before they immobilise tokens for months, every answer *derived* from the program's own entities
rather than authored, rendered above the lock action and readable with no wallet connected. This
is where the theme lands on one surface: Educate answers, Build is the campaign, Earn is the
receipt. It is also the thing a generic locking service does not do.
**Done when:** every page renders in the smoke test, the i18n audit passes, a receipt for an
unrecorded row 404s, **test 14** (no route or copy renders a "safe" / "verified project" badge)
and **tests 15, 16 and 17** (every answer derived; the differing-reward-asset warning is
mandatory and not operator-controlled; no APR, APY or per-year rate anywhere) pass, and the owner
has eyeballed it on staging on desktop and a phone.

### W3 — Project Hub: operator console and funding-wallet payout (weeks 2–3)
Branch `hub/operate`. Signed-nonce operator login (its own HMAC purpose, never the tools pass),
draft → preview → batch → the existing `/cuna-payout` flow project-scoped, server-side
reconcile from the chain, partial and overpaid rows handled per Addendum B. The server never
holds a project key.
**Done when:** the **integration gate** passes — acceptance tests **8 and 9**, the §4 signing
and reconcile fault cases, and a dry-run second project proving isolation end to end on staging
with the owner's own wallet as the funding wallet. This gate is a W1+W3 deliverable and it is the
condition for everything in the "deferred until the gate" lists below.

### W4 — For Projects front door + intake (week 1, cut to 2 days)
Branch `projects/front-door`. `/for-projects`: the guided flow lock → lock-to-earn → buy
competition → airdrop → listing checkup → owners snapshot → burn receipt, **linking the tools
that exist** with a per-mint checklist read from the existing feeds; the "Request a lock-to-earn
program" intake with an owner-visible queue. That is all.
**Deferred until the integration gate is green:** the public Buy Special standings and
hold-through proof page, the standalone airdrop per-drop receipt page. *(Both pulled forward on
2026-09-18 under the owner's "build non-stop" directive once the gate's PR was green on CI and
under verifier review — they move no money and arm nothing; batch 8.)* (Revision 1 called this
one week; the think tank's own estimates summed to nine days.) Any public-data sanitisation fix
found along the way ships regardless.
**Done when:** both pages are linked from the homepage door and render in the smoke test.

### W5 — Engine dashboard: evidence boundaries and hygiene (week 2, read-only)
Branch `engine/timeline`. Three kinds of evidence, never mixed: **historical transactions**
(backfilled from Helius, labelled as transfers — what moved, not why), **retained decision
events** (the `engineLog:<project>` ring buffer written where `tick()` calls `setState`, which
records nothing while every engine stays paused and says so on the page), and **illustrative
simulator runs** (the real incidents from `scripts/engine-sim-test.cjs`, labelled illustrative).
Missing history stays missing. Plus the hygiene items: the operator pubkey stripped from public
bodies, GeckoTerminal cached 60–120 s serving last-good on 429, the ROSE `realizedSuspect` flag
surfaced never the poisoned number.
**Deferred until the integration gate is green:** the full timeline and replay UI.
**Done when:** the three evidence classes are rendered with their labels, no engine was
started to satisfy any check, and `engine-sim-test` passes unchanged.

### W6 — Credibility and truth pass (first 48 hours, then continuous)
Branch `truth/window-1`. F4 translations (two lessons × six languages, then extend the i18n
audit to lesson ids so it cannot recur), F12 traction table reorder, **the GitHub repo
description and README** (the repo is a graded submission artifact; the description still reads
"built for the Bags Hackathon" and advertises Cluck Score, retired for giving good scores to
tokens that then rugged), the `/about` and `/investors` surfaces stating the Colosseum entry,
README and `/about` kept true to the code as W1–W5 land, `PRE_EVENT_STATE.md` "built inside the window" filled in per
merged PR with the PR link, Colosseum §8 checklist driven to done, and the narrowed
reproducibility wording from §1 everywhere the old wording appears.
**Done when:** every claim in README, `/about` and the submission survives a two-minute check
against the live site, and the disclosure file lists every in-window PR.

### W6b — Validation: the judge question none of the surfaces answer (weeks 1–3, owner-led)
*"Which independent project operator will pay you, for which repeated job, and what becomes
easier enough that they return?"* Four partner-token names and visitor-days do not answer it.
Deliverable, written into the submission whether the answer is strong or weak: operator
interviews with the four partner projects (agent-prepared script; the owner holds the
relationships), **one consented pilot** on the Hub dry run, observed setup and reconciliation
time, repeat use, support cost, and stated willingness to pay — with founder-operated use,
independent adoption and dry runs reported as three separate columns.
**Done when:** `docs/VALIDATION_2026-09.md` exists with the numbers and the quotes, and the
submission's traction section cites it.

### W7 — Story: demo, pitch, submission (weeks 3–4)
Branch `story/colosseum`. **The acceptance target is the Hub's single-holder demonstration**
(design §6): operator publishes a program version → a holder's lock shows "qualifies, 3-month
term, 1x" with the rule that decided it → funding status shows obligations vs reserved vs
observed → the operator signs a batch from their own wallet → the holder opens the receipt and
reproduces the amount → the second-project dry run proves isolation. A real transfer is shown
from a confirmed historical transaction or a clearly labelled dry run; nothing is paid for the
camera. The pre-window tour (school, Checkup, X-Ray, Holders, Locker Room) becomes **one
labelled aside of at most 30 seconds**. The pitch video outline is filled with the founder's own
words (§6 framing); submission fields paste-ready; logo at 1024×1024; Arena post drafts.
**Done when:** the submission is filed by **Oct 1** with a week of slack for reviewer comments.

### W8 — Quality gate (continuous)
Not a build session. Runs the tests, the visual gate, the security review skill on every hub PR,
the adversarial pass on money paths, and reports at each phase boundary with the agent count and
ETA. Codex remains the second reviewer on every PR; findings, not rewrites.

### W9 — Traction: measure the outcomes, then create some (week 1, then continuous)
Branch `traction/instrument`. Traction is a seventh of the score and we currently cannot answer
it with a number a judge would accept.

**Part 1 — instrument the outcomes (Sep 15–17).** `lib/analytics.js` records views, tool hits and
funnel strings. None of those is a product outcome. Add first-class counters, each one derived
from something already durable so it can be recomputed rather than trusted: **wallets connected**,
**programs created**, **program versions published**, **receipts issued**, **receipts opened by a
holder**, **batches signed**, **repeat operators** (an operator returning in a later period), and
**revenue** (tools-pass purchases and Hatchery fees, priced at the payment's block time). Expose
them on an owner-only endpoint, and keep the raw events so every figure is reproducible. Same
honesty rule as the receipts: report the period and the denominator, never a target as an
achievement.

**Part 2 — create some (Sep 15 → Oct 1).** Instrumentation with no usage is still zero. The
sources of real usage available inside the window, cheapest first: the **dry-run project running a
real program** (§4 item 1 — the long pole), the existing partner tokens invited to open a Hub
page, the school's existing learners pointed at the front door, and the buy competitions already
running, whose receipts become Hub receipts once W1 lands.

**Done when:** `docs/TRACTION_2026-09.md` exists, every number in it is reproducible from stored
events by a script in `scripts/`, the submission's traction section cites it, and each figure is
labelled founder-operated / dry run / independent — the three columns W6b already requires.
Model: Sonnet builds; no verifier tier needed (this path moves no money).

### W10 — Weekly updates (every Sunday, 5 minutes of the founder's time)
Not a build session. Colosseum strongly recommends a ~1-minute video each week on what shipped
and what was hard. Four of them across the window, on **Sep 20, Sep 27, Oct 4, Oct 11**. The
agent side prepares the shipped-list from that week's merged PRs and a three-bullet script the
night before; the founder records on a phone and posts. This is the cheapest scoring item in the
whole plan and revision 2 omitted it.
**Done when:** four updates are posted, each naming what shipped with a link.

### Deferred, explicitly (start only if the integration gate is green by Sep 26)
- **Launch Readiness** (design Addendum A): the checklist page, the reward-budget planner,
  signed declarations, wallet-bound lesson evidence — acceptance tests **11, 12, 13**. Owned by
  a W9 session if and only if the gate is green in time; otherwise the first post-hackathon item.
- Public Buy Special standings + proof page; airdrop per-drop receipts; the engine timeline and
  replay UI (from W4/W5 above).
- Airdropper resume ledger, anti-arb badge, Holders historical snapshots.

### Not this window, at all
LP Rescue withdrawal (Orca or Raydium), the airdropper resume ledger on the critical path, any
money-moving stretch item before submission, self-service enrollment, any escrow of our own,
engine restarts of any kind.

---

## 3. Calendar

| Dates | Ships | Owner touchpoints |
|---|---|---|
| **Sep 13–14 (done)** | #284/#293/#294/#295 merged; the 09:00 UTC snapshot recorded — `snapshot/pre-colosseum-2026-09-14-main` at `75b69cc`, `…-develop` at `41d0a6a`, `PRE_EVENT_STATE.md` finalised (`c1f267d`). Tags could not be pushed from a cloud session; the branches pin the same commits. | Push the real tags from the Mac (one-liner in the disclosure file). **Decide §4 item 1 — now a dated blocker.** |
| **Sep 14–16** | W6 credibility fixes **including the GitHub repo description**; W4 (2 days); W1 libs + pure tests start; W5 hygiene lands; **W9 part 1 — outcome counters**. **Sep 16: schema freeze.** | Eyeball W4 on staging; answer §4 item 4; W6b interview script approved. |
| **Sep 17–21** | W1 pure gate done; W2 on fixtures then on W1's libs; W3 starts; first Hub demo captures; **a real-wallet smoke on staging — one lock, one connect-and-sign, one rendered report — pulled forward out of the rehearsal**. **Review slot Sep 19:** Codex on W1. | "promote" the first in-window batch to `main`; first two operator interviews; **the real-wallet smoke is the owner's hands, nobody else can do it**. |
| **Sep 20** | — | **W10 weekly update #1.** |
| **Sep 22–26** | W3 done; **integration gate** on staging with the owner's wallet; W2 done; W5 evidence pages; **the dry-run project's real program is live and accruing** (W9 part 2). | Eyeball the hub flow end to end on a phone; pilot operator consented. |
| **Sep 27** | **Feature freeze.** Only fixes from here. | **W10 weekly update #2.** |
| **Sep 28** | **Rehearsal:** the owner walks the demo on a phone with a real wallet, on staging. Because the Sep 17–21 smoke already proved the primitives, this is a rehearsal, not a first attempt. | The rehearsal. |
| **Sep 29 – Oct 1** | Demo cut, **pitch recorded (separate video, 2–3 min; the demo is its own ≤3 min)**, `TRACTION_2026-09.md` final, validation doc final, submission filed. | Record both videos; file. |
| **Oct 2–12** | Arena presence, reviewer comments, fixes; deferred items only if the gate was green by Sep 26. | Respond to reviewers. **W10 updates #3 (Oct 4) and #4 (Oct 11).** |

---

## 4. Decisions only the owner can make (needed before or in the first days)

Each line: the question · our default · Codex's recommendation · the risk of taking the default.

1. ⏰ **Which second project runs the hub dry run — DECIDE BY Sep 17.** Default ROSE (richest
   comp history). Codex: ROSE, *if its operator agrees*, as a labelled dry run. Risk: rich
   history is not independent adoption; do not present the dry run as a live program.
   **Revision 3 promotes this from a decision to a dated blocker.** It is no longer a demo
   detail — it is the traction decision and the longest pole in the plan. A real program needs
   an operator who agrees, a funded wallet, a published version and then *elapsed time* before
   there are receipts worth showing. Decided Sep 17, there is time for real usage. Decided in
   the Sep 22–26 block as revision 2 had it, the entry ships with a dry run and no users.
   ✅ **DECIDED 2026-09-18 (owner): POKEAHOE.** "pokeahoe will be our dry run or next project to
   use the lock and earn, we will build them a page just with their logos and make it special for
   them." So the second project is POKE (mint `HRvw81mktEraX9gZLTHKeYGaFygCSNKuAwNLVE6Tpump`, the
   community the engine work already served). It ships as a **labelled dry run** until the POKE
   team agrees terms and a funding wallet — nothing accrues or pays before that — with a branded
   project page (their logo and colours, "project-provided", never endorsement). Item **E10** in §7.
2. **Program funding rule.** Default: shortfall shown, not required. Codex: **require a fresh
   funding check for the next period before initial arming**, plus explicit shortfall and
   outage behaviour. Risk of the default: obligations grow with no demonstrated ability to pay.
   Either way a withdrawable wallet is not escrow, and accrued debt is never erased.
3. **Operator drafts.** Default owner-only in the first cohort. Codex agrees. Risk: the founder
   becomes the bottleneck; measure onboarding time before widening.
4. **Public naming and project socials.** Default `/p/<id>`. Codex: fine; allow only reviewed
   HTTPS project socials, marked "project-provided", never endorsement. The default omits the
   links/moderation decision — decide it.
5. **Service pricing.** Default "custom pricing, per project". Codex: pair it with a precisely
   scoped service and the observed operator cost from W6b. Risk: no evidence of margins or
   willingness to pay — which is what W6b exists to gather.
6. **The founder story.** The owner supplies the real incident and what changed; nothing is
   invented. A commit-count line does not answer founder–market fit.

---

## 5. Operating rules for every session in the window

- Read `CLAUDE.md`, this file, the design doc **and Addendum B** before touching the hub.
- PR on the first commit; CI is diff-gated (#293), so a non-game PR costs minutes, not a
  quarter hour — there is no reason to batch pushes to avoid CI.
- `develop` is staging and free; `main` is production and the owner's explicit "promote" only.
- Money paths get two verifier lenses; P2/P3 polish gets none. A session that would spawn more
  than 60 agents or run past 90 minutes stops and asks with the number.
- Nothing arms an engine. Nothing is paid for the camera. Nothing about Normie Quest prizes.
  Nothing about Wallet Watch. Security mentions credit RootCrak with the referral link — RootCrak
  is the scan partner, never a claim of independent certification of the Hub.
- Every merged in-window PR gets a line in `PRE_EVENT_STATE.md` the same day.
- Tell the truth about what ran. A check that did not run is reported as not run.

---

## 6. The team story (Codex's framing, adopted)

> I founded CLKN Productions LLC and own product decisions, customer relationships and releases.
> I use AI coding agents for implementation and a separate AI review pass to challenge changes.
> Money paths receive targeted tests; I approve releases after staging review.

State the key-person limit honestly. Commit and CI counts are supporting provenance, not
traction. The strength of this story is accountable judgement and fast response to actual users;
it becomes a liability the moment an agent count is offered in place of ownership, availability
or verification.

---

## 7. Extension — 2026-09-18 (owner: "get creative, take our narrative of educate, build, earn and let's win the hackathon")

Written in-window. Everything W1–W10 stands; this adds the items that turn the thesis from
"a rewards program you can check" into **a rewards program a stranger can re-derive**, and puts
the owner's theme on every surface a judge touches. Each item names the criterion it moves.
Nothing here arms an engine, moves money, or promises a yield.

The one-sentence pitch this extension is built to make true: *"Learn how locking works, lock
with a project that published its terms, and get a receipt you can reproduce yourself — from
the published inputs, offline, without trusting us."*

| # | Item | Theme leg | Criterion | Definition of done |
|---|---|---|---|---|
| **E1** | **Reproduce-a-receipt, holder side.** `scripts/reproduce-receipt.cjs <receipt-url \| batch/wallet>` fetches the public JSON mirrors (program version, the batch's published inputs, the receipt) and re-derives the amount with the pure libs — no server call to "verify", the arithmetic runs on the reader's machine. Plus `GET /api/hub/:project/reproducibility` and a line on every program page: **"N of M receipts in <batch> reproduce; K have missing inputs"** — the roadmap's headline number (§1), measured by the script, never asserted. | Earn (prove) | Insight, Product | The script reproduces every settled row in the live CUNA batches the page lists, or names the row and the missing input; the page number equals the script's; `scripts/reproduce-receipt-test.cjs` in CI with a tampered fixture that must FAIL to reproduce. |
| **E2** | **The demo walkthrough, no wallet: `/hub/demo`.** A clearly labelled **DRY RUN** fixture project (badge on every screen, `dryRun:true` in every JSON body, excluded from every count and feed) that carries the single-holder story of §W7 end to end: program version → a holder's lock "qualifies, 3-month term, 1×" with the rule that decided it → funding coverage vs shortfall → a signed batch → the receipt → reproduce it (E1) → a second project proving isolation. The judges click it; the video records it. | Build | Product, Founder Communication | Renders in the smoke test; every fixture number is derived by the real libs from the fixture inputs (nothing hand-typed); test 14 (no "safe" badge), 15–17 (no APR) still pass; the fixture is invisible to `/api/hub`, the Lock of Fame and the traction counters. |
| **E3** | **Independent commitment of the program hash (Addendum B §B5).** At publish, the desk builds an unsigned memo transaction carrying the program-version hash for the operator to sign from the funding wallet; the program page shows the signature and a reader can check the memo on any explorer. Repo mirror: `docs/hub/commitments.md`, appended by the same path. Ships as **dry-run** until the owner signs the first real one; the page says which it is. | Earn (prove) | Insight, Viability | Unsigned tx bytes diffed against the library in Node before shipping (CLAUDE.md rule); the desk shows "committed on-chain" only after the memo is observed on-chain by the server; the public claim wording upgrades from "reproducible from published inputs" to "independently committed" only on that observation. |
| **E4** | **The settlement library as a public, composable module.** `lib/hub/README.md` (the contract in plain words), JSON Schemas for `ProgramVersion`, `Batch`, `Receipt` under `lib/hub/schema/`, every public JSON body validated against them in the test, and the receipt JSON carrying `$schema`. Open-source and composability are scored in the Official Rules (§302 notes). | Build | Product, Potential Market | Schemas exist, public bodies validate, README explains how a second product would consume a receipt. |
| **E5** | **The receipt teaches.** Every receipt page gets "how this number was computed" — the holder's own term, multiplier and pro-rata share walked through with their own numbers, derived by the libs (the post-payment mirror of Addendum C's pre-lock block). Educate inside Earn, personalised by data, never authored copy. | Educate | Insight | Renders for every settled receipt; the walkthrough's total equals the receipt's amount by construction (same function); no APR anywhere (test 17). |
| **E6** | **School → Hub bridge.** The Lock-to-Earn lessons end on a "Ready to lock?" card that deep-links to `/hub` (and to the project page when arrived from one); a project page shows, anonymously and in aggregate, how many visitors read the lock lessons before the lock action (a `hub_lesson_read` funnel event, no wallet). It is the one Educate→Earn number we can show honestly. | Educate | Traction, Founder+Market Fit | The card renders in the school (seven languages via the dictionary); the count appears on the project page with its period and denominator; W9's report script prints it. |
| **E7** | **Operator onboarding clock.** Setup time measured automatically from `apply` → first program version published → first batch signed, per project, stored with the project record, printed by the W9 report as the W6b "observed setup time" column. | Build | Viability | The timestamps exist for every new project; the report prints the three deltas; CUNA (pre-window) is labelled n/a. |
| **E8** | **Hub pages in seven languages.** `/hub`, project, program, receipt, apply and pay through the tool-page dictionary pattern (`public/i18n/*.json`), and the i18n audit extended to the Hub pages so a missing key fails CI. | Educate | Product | Audit passes for all seven; the owner eyeballs es + zh on a phone. |
| **E9** | **Arena + X cadence.** The four W10 updates, plus one Arena post per shipped extension item (draft in `docs/ARENA_POSTS.md`, owner posts). No post before Sep 14 kickoff was the rule; after it, cadence is the cheapest visible traction. | Build (with others) | Founder Communication | Drafts exist for E1–E8 as each merges; the owner posts. |

| **E10** | **POKEAHOE, the second project — branded and dry-run first (owner, 2026-09-18).** Project branding on the Hub record (`brand: { logo, accent, tagline }` — reviewed, project-provided, rendered with the "project-provided" label), a special POKE project page and lock site carrying their logo and colours, seeded as a **dry run** (`dryRun: true`, excluded from counts, "terms to be agreed with the POKEAHOE team" on the page) so the owner can show it to the team and flip it to live once terms and a funding wallet exist. | Build (with others) | Traction, Founder+Market Fit | Renders at `/hub/poke` with the badge; nothing accrues or pays; the brand fields are the only project-specific code path (no POKE-only template). |

**Order:** E1 → E2 → E4 → E5 → E3 → E6 → E7 → E8, with E9 alongside. E1 and E2 start
2026-09-18 (batch 3). E3 is the only item that needs the owner's hand (a signature) and ships
dry-run first so nothing waits on it. Everything else is buildable without the owner and lands
on `develop` on green CI; promotion stays the owner's "promote".

## 8. Extension 2 — 2026-09-18 evening (the list ran out; owner: "never idle because the list ran out")

Everything in §7 except the owner's own acts (E3's first real signature, E9's posting, W6b's
interviews, W10's recordings) is merged or on a PR by the end of 2026-09-18. These are the next
items, in order, each still inside the thesis (a rewards program a stranger can re-derive) and
the theme. Same rules: nothing arms, nothing pays, Earn is capability.

| # | Item | Criterion | Definition of done |
|---|---|---|---|
| **X1** | **Codex reviewer brief caught up.** `docs/CODEX_REVIEWER_BRIEF.md` lists every in-window PR since #338 with the one question each needs answered (the money-path PR #342 first), so the owner's terminal Codex pass starts from a list, not a diff. | Product | The brief names #339–#346 and #342 with review questions; findings land as fixes on the next batch. |
| **X2** | **"Verify it yourself" for judges.** `docs/HUB_VERIFY.md`: the two-minute reproduction a judge runs — curl the public JSON, validate against the served schema, run `reproduce-receipt.cjs --offline`, check a memo on an explorer once one exists — every command copy-pasteable against production, with the dry-run caveats. Linked from README, `/about` and the Hub index footer. | Founder Communication | Every command in the doc runs against staging in the smoke job (a script asserts the doc's commands are the ones the test runs). |
| **X3** | **The aggregate reproducibility ratio includes buy-comp rows.** `/api/hub/:project/reproducibility` counts sealed buy-comp rows via `reproduceBuyCompRow`; the "N of M" line on a project page therefore covers every program kind that has published inputs; giveaway rows stay "not implemented" and are named as such. | Insight | The ratio's denominator is every settled row of every kind with published inputs; a tampered buy-comp fixture counts as a mismatch. |
| **X4** | **New surfaces in seven languages.** The airdrop receipt page, the standings table, the readiness desk section and the door lines get curated dictionary keys and pass the Hub i18n coverage gate. | Product | Audit gating clean; the owner eyeballs es + zh on a phone. |
| **X5** | **Engine timeline UI (deferred W5), read-only.** The three evidence classes on `/liquidity-engine` become a single time-ordered strip per project — transfers, retained decisions, illustrative runs — each row keeping its label; a replay control steps through the retained decisions against the recorded inputs with the pure gate (`lib/engine-decisions.js`) so a reader sees what the gate decided and why, never a live engine. | Product, Insight | Renders with the labels intact; `engine-sim-test` unchanged; no engine started to satisfy any check. |
| **X6** | **Browser-signed payout (design §4), after #342 merges.** The operator signs a batch in the desk with the connected wallet (wallet signs first, no `SystemProgram.transfer` in the page), the server observes the signature and journals it through the same `settle.js` path the managed payer uses — pending → signing → submitted → settled, one persist per transition. Money path: two verifier lenses, own PR, Codex. | Viability | Fault-injection tests for every transition; the same idempotency key as #342; the dry-run project refused first. |
| **X7** | **Holders historical snapshots (deferred).** The owners-snapshot tool keeps a dated, hashed snapshot per run so a project can show holder-count history with the hash a reader can recompute from the published list. | Traction | Snapshots are append-only, hashed, and served read-only; the Hub project page links the latest. |

**Owner-side, still open:** promote `develop` → `main` (nothing from batches 2–8 is on production until then); the first real on-chain commitment (E3); the four operator interviews (W6b) and the POKEAHOE terms; the Sep 20 recording (W10); the real-wallet smoke on staging.

## 9. Extension 3 — 2026-09-18 night (X1–X5, X7 landed on batch 8; X6 waits on #342)

| # | Item | Criterion | Definition of done |
|---|---|---|---|
| **Y1** | **Reproduce in the browser: `/hub/verify`.** The same pure `lib/hub/reproduce.js` + `lib/hub/schema-validate.js` bundled for the browser (a vite library build, no server call to "verify"): paste a receipt URL or drop the saved JSON files, the page fetches the public inputs, validates them against the served schema, re-derives the amount on the reader's machine and shows MATCH / MISMATCH / MISSING_INPUTS with the arithmetic steps. Works offline once loaded. Linked from every receipt page and from `HUB_VERIFY.md`. | Insight, Product | The browser bundle and the Node script agree on every fixture (a test runs both); the page renders in the smoke job; no wallet needed. |
| **Y2** | **The school teaches the receipt.** A new lesson, "Read a payout receipt", derived from the Hub's own concepts (program version and hash, eligibility reason codes, term and multiplier, pro-rata share, settlement entry, reproduce it yourself), in all seven languages, ending on the `/hub/demo` receipt and the E5 explanation block. Educate → Earn on one path. | Founder+Market Fit, Insight | The lesson passes the i18n coverage gate in all six translations, the smoke test renders it, and its report card links the demo receipt and `/hub/verify`. |
| **Y3** | **The founder's two videos, scripted to the second.** `docs/PITCH_SCRIPT.md`: the 2–3 minute presentation video word for word with timings (thesis, insight, what shipped in-window from the disclosure, traction as mechanism + honesty, the team story §6, the ask), and the ≤3 minute demo narration aligned to `DEMO_STORYBOARD.md`'s shots; plus `docs/WEEKLY_UPDATE_2026-09-27.md` as a skeleton for update #2. | Founder Communication | Every claim in both scripts is true on `develop` (checked against the code), the dry-run labels are spoken aloud where they apply, no yield language. |
| **Y4** | **Shareable receipts.** Server-rendered Open Graph meta per Hub project, program and receipt page (title, description with the amount and the "reproducible from published inputs" line, a branded static image), so a holder who shares their receipt on X or Telegram shows a card that says what it is. No dynamic image generation. | Traction | Cards validate with X's and Telegram's unfurlers (documented check), no data beyond what the public JSON already exposes. |

**Owner-side, unchanged:** promote; the first on-chain commitment; the interviews and POKEAHOE terms; the Sep 20 recording; the real-wallet smoke.

## 10. Extension 4 — 2026-09-18 afternoon (Y1, Y3, Y4 landed; Y2, Z1–Z3 in flight)

| # | Item | Criterion | Definition of done |
|---|---|---|---|
| **Z1** | **Weekly updates from the record, not from memory.** `scripts/weekly-update-draft.cjs --from <date> --to <date>` builds the "shipped this week" list from the merged PRs (git log on `develop` and `main`, PR numbers from squash subjects, production-vs-staging per item) and the three-bullet skeleton, so each Sunday's W10 refresh is a run, not a rewrite; `docs/WEEKLY_UPDATE_2026-09-20.md` regenerated with it. Plus Arena/X drafts round 2 in `docs/ARENA_POSTS.md` for everything merged since batch 4. | Founder Communication | The script's output for Sep 14–18 matches the disclosure file's PR list; the drafts keep every honesty rule. |
| **Z2** | **`/hub/status` — what is live, where, and how reproducible.** A public page fed only by existing public JSON: per project the program count, receipts issued, the reproducibility ratio (the E1/X3 number), the latest holder snapshot, the on-chain commitment state (none yet), and a "live on production / on staging" line derived from the build's own commit (a `GET /api/build` that returns the git sha and branch baked at boot). The transparency surface a judge opens first. | Insight, Founder Communication | Renders in the smoke and a11y jobs; every number is fetched from a route the judge can open; no wallet. |
| **Z3** | **Public-route hygiene.** The new public read routes (standings, snapshots, reproducibility, batch inputs, receipts, the verify bundle, schemas) get ETags + `Cache-Control` consistent with the existing Hub reads, a per-IP rate limit on the heavier ones (reproducibility computes over the whole ledger), and a cap on `hours`/`limit` query params; `scripts/public-route-hygiene-test.cjs` pins the headers and the limits. | Viability | Headers present on every listed route; the limiter refuses a burst and never affects a normal page load; nothing else changes. |

**Owner-side, unchanged:** promote; the first on-chain commitment; the interviews and POKEAHOE terms; the Sep 20 recording; the real-wallet smoke.

## 11. Extension 5 — 2026-09-18 evening (all of Y1–Y4, Z1–Z3 landed on batch 9)

The Hub now answers "what was this holder paid and can I re-derive it" per project. Extension 5
turns the same public record toward the three readers we still serve badly: the **holder** who
belongs to more than one project, the **judge** who has fifteen minutes and needs a map, and the
**skeptic** who wants to know what the Hub does *not* prove. Nothing here needs a wallet, a new
secret, or a live engine. Every number is fetched from a route the reader can open themselves.

| # | Item | Criterion | Definition of done |
|---|---|---|---|
| **AA1** | **One wallet, every project: `/hub/wallet/<address>`.** A typed address (no connect) returns, across every registered Hub project, each program the wallet qualified for or was excluded from (with the reason code), each receipt with its settlement signature, and — where a batch has been settled — what it was owed against what the chain shows arriving. This is the strongest honest form of "Earn" in `CLAUDE.md`: a holder who can check what they were owed and what arrived. Backed by `GET /api/hub/wallet/:wallet` composed only from `hubPublic.walletLookup` per project (no private field, demo projects excluded from the roll-up as everywhere else). | Insight, Product | Renders in the smoke and a11y jobs; a malformed address is a 400 with a plain reason; an unknown wallet is an honest "no Hub program has seen this wallet" page, not an error; a test drives a fixture wallet across two projects. |
| **AA2** | **The evidence bundle.** `GET /api/hub/:project/batch/:batchId/bundle` returns one JSON document (program version, the batch's published inputs, the receipts, the schema versions and a canonical hash of the whole) with a `Content-Disposition` download name, and `/hub/verify` accepts a dropped bundle in one move where today it needs the separate files. The same bundle is what a holder keeps offline and what `docs/HUB_VERIFY.md` tells a reviewer to save first. | Insight, Viability | The bundle re-verifies to MATCH in `/hub/verify` for every demo fixture (a test does the round trip through the browser bundle); the hash is reproducible by the Node script; a bundle for an unsettled batch says so instead of pretending. |
| **AA3** | **Snapshot diff, over what a snapshot actually keeps.** A snapshot record stores `holderCount`, `totalSupplyRaw`, the ordered top-25 `top` holders, and a `listHash` of the FULL list — the full list itself is never stored, only hashed, to keep the append-only table small. So between any two X7 holder snapshots of a project, a public read (`GET /api/holders/snapshots/:a/diff/:b`) and a Compare panel on the history page (`/holders`) list entered / exited / held-through wallets and balance deltas **exactly over the recorded top-25**, plus the two snapshots' hashes so the diff is reproducible and a plain "full list: unchanged / changed (hash differs)" line from comparing the two hashes — never a reconstruction of the full holder base. This is the hold-through story the Buy Special standings tell for one comp, told honestly for the top of the holder base, labelled as exactly that everywhere it appears (the code, the page, this row). | Traction, Insight | Diff of a snapshot with itself is empty (`scripts/holders-snapshot-diff-test.cjs`); the panel is a phone-first Compare block on `/holders` with a visible scope note ("Compares the 25 largest holders recorded in each snapshot; the full list is hashed, not stored") — `/holders` is not in `hub-a11y-test.cjs`'s five-page list, so this is not that job's gate; the BigInt sums reconcile to the two snapshots' recorded top-25 totals in a test; wallets are shortened on the page and full in the JSON; the route is registered ahead of the single-id snapshot route and both are tested. |
| **AA4** | **The judge's fifteen minutes: `docs/JUDGE_GUIDE.md` + `/hub/judge`.** One page mapping each of the five judging criteria to the exact URLs to open (in order, with what to look for on each) and the test file that pins it, then the one-paragraph "what was here before the window" pointer to `PRE_EVENT_STATE.md`. The public page is the same content rendered from the markdown at build time, so the two cannot drift (a test compares them). | Founder Communication | Every URL on the page returns 200 on a no-build boot in CI (a link-check step); every claim names a route or a test; no yield language; the dry-run labels are named where they apply. |
| **AA5** | **What the Hub does not prove: `/hub/trust`.** The trust-boundary page in plain words: the chain shows *what*, never *why*; the funding wallet is the project's, not ours; a program hash commits to terms, not to intent; a receipt proves a payment matched a rule, not that the rule was fair; what a DRY RUN is and is not; what a reproducibility ratio below 1.0 means and what to do about it; the four things that still need a human (the owner-side list). Linked from every Hub page footer and from the school's receipt lesson. | Insight, Founder Communication | Rendered in seven languages through the existing Hub i18n path; the a11y job passes; a doc-drift test keeps `HUB_VERIFY.md`'s boundary list and the page's in step. |

**Owner-side, unchanged:** promote; the first on-chain commitment; the interviews and POKEAHOE
terms; the Sep 20 recording; the real-wallet smoke.

## 12. Extension 6 — 2026-09-18 evening (AA1, AA3, AA5 landed on batch 10; AA2, AA4 in flight)

The Hub's public record is now readable by a holder (AA1), a judge (AA4), a skeptic (AA5) and a
script (AA2). Extension 6 closes the loop back to the two pillars the record depends on: the
**school** must not silently rot while the Hub grows (the Live Classroom bug the Y2 builder found),
and the record must reach people where they already are (Telegram, the README) without a single
claim we cannot recompute. Nothing here needs a wallet, a new secret or a live engine.

| # | Item | Criterion | Definition of done |
|---|---|---|---|
| **BB1** | **The Live Classroom reads the real curriculum again.** `data/curriculum.json` (consumed by the classroom at boot, `server.js` ~76) was generated on 2026-06-14 from a multi-source extractor that no longer exists; today's `scripts/extract-curriculum.js` reads only `src/App.jsx`, so a re-run silently drops the LP Lab (22) and deep-dive (11) courses, and its bracket scanner corrupts on an apostrophe inside an in-array comment. Fix the extractor to read every course from its real source (`src/App.jsx`, `src/sections/LPLab.jsx`, the deep dives), make the scanner comment-safe, regenerate the file, and pin the per-course counts in `scripts/check-counts.js` so the next drift fails CI. | Product (Educate) | The regenerated file carries all four courses with the counts the school renders; a test fails if any course count changes without the pin moving; the classroom endpoints still answer. |
| **BB2** | **Docs drift round 3.** `docs/CODEX_REVIEWER_BRIEF.md` catches up on batches 9–10 (#347, #348) and the journal fix rounds; `docs/HUB_VERIFY.md` names `/hub/wallet`, `/hub/trust`, `/hub/status`, `/hub/judge` and the evidence bundle as the reviewer's path; `docs/DEMO_STORYBOARD.md` gains the shots for those pages (real captures under `docs/demo/<date>/`) and `docs/DEMO_NARRATION.md` the lines that go with them. Every drift test stays green. | Founder Communication | `hub-verify-doc-test`, `hub-trust-doc-test`, `hub-judge-doc-test` green; every capture is of the merged tree; no yield language. |
| **BB3** | **A reproducibility badge that is computed, not typed.** `GET /api/hub/badge.json` (shields.io endpoint schema: `schemaVersion`, `label`, `message`, `color`) and `GET /hub/badge.svg` (a small server-rendered SVG, numbers only, escaped) reporting "receipts reproducible: N of M across K projects" from the same `projectReproducibility` the status page uses, demo projects excluded, cached like the other public reads. The README's badge row gets it, pointed at production, so the number on GitHub is the live one. | Insight, Traction | The JSON validates against shields' endpoint schema (a test); the SVG contains no unescaped input; a fresh install shows "no receipts yet" rather than 0/0; the README line is true. |
| **BB4** | **`/receipt <signature>` in Telegram.** The Cluck bot answers a `/receipt` command in any room it may post in (never the OnlyRose room — `lib/telegram-rooms.js` already refuses it at the choke point) with the reproduce verdict for that settlement signature (MATCH / MISMATCH / MISSING_INPUTS, the project, the amount the rule computes) and the link to the receipt page, built from the same public view functions as `/api/hub/:project/r/:sig`. Silent by default. A signature the Hub has never seen gets a plain "no Hub receipt carries that signature". | Build (communities), Insight | The reply is composed only from public fields; a test drives the command handler with a fixture receipt and asserts the OnlyRose refusal still holds; no send advances any durable state. |
| **BB5** | **The receipt lesson, measured.** The school's `hub_lesson_read` counter (E6) grows a per-lesson breakdown so the traction report shows how many learners reached the "Read a payout receipt" finish card and how many clicked through to `/hub/demo`, `/hub/verify` or `/hub/trust` from it, with the same per-install salt and no per-user tracking. | Traction | Counts appear in `scripts/traction-report.cjs` output with the page views as the denominator; the analytics test covers the new event names; nothing identifies a learner. |

**Owner-side, unchanged:** promote; the first on-chain commitment; the interviews and POKEAHOE
terms; the Sep 20 recording; the real-wallet smoke.
