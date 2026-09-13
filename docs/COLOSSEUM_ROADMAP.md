# Colosseum window roadmap — 2026-09-14 11:00 UTC → 2026-10-12 (revision 2)

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

Owner, 2026-09-13: *"I don't think we need another cofounder, we have all the skills, ideas,
resources — cofounders don't understand what we have been building; we can do virtual agents
to help us with all aspects."* The team section of the submission says so, in the framing Codex
suggested (§6 below).

---

## 0. Where we stand on the eve

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
wall. Learn → Build → **Prove** → Earn. It must read as in-window work, started after 11:00 UTC
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
first.

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
**Done when:** every page renders in the smoke test, the i18n audit passes, a receipt for an
unrecorded row 404s, **test 14** (no route or copy renders a "safe" / "verified project" badge)
passes, and the owner has eyeballed it on staging on desktop and a phone.

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
hold-through proof page, the standalone airdrop per-drop receipt page. (Revision 1 called this
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
audit to lesson ids so it cannot recur), F12 traction table reorder, README and `/about` kept
true to the code as W1–W5 land, `PRE_EVENT_STATE.md` "built inside the window" filled in per
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
| **Sep 13 (tonight)** | "merge 284", "merge 293", "merge 294", "merge 295"; the snapshot routine at 09:00 UTC Sep 14 pushes the `snapshot/pre-colosseum-2026-09-14-*` branches; the owner pushes the real tags from the Mac. | Decide §4 items 1–3 so W1 can start at 11:00 UTC. |
| **Sep 14–16** | W6 credibility fixes; W4 (2 days); W1 libs + pure tests start; W5 hygiene lands. **Sep 16: schema freeze.** | Eyeball W4 on staging; answer §4 item 4; W6b interview script approved. |
| **Sep 17–21** | W1 pure gate done; W2 on fixtures then on W1's libs; W3 starts; first Hub demo captures. **Review slot Sep 19:** Codex on W1. | "promote" the first in-window batch to `main`; first two operator interviews. |
| **Sep 22–26** | W3 done; **integration gate** on staging with the owner's wallet; W2 done; W5 evidence pages. **Review slot Sep 24:** Codex on W3. | Pick and run the dry-run project; eyeball the hub flow end to end on a phone; pilot operator consented. |
| **Sep 27** | **Feature freeze.** Only fixes from here. | — |
| **Sep 28** | **Rehearsal:** the owner walks the demo on a phone with a real wallet, on staging. | The rehearsal. |
| **Sep 29 – Oct 1** | Demo cut, pitch recorded, traction refreshed, validation doc final, submission filed. | Record the pitch; file. |
| **Oct 2–12** | Arena presence, reviewer comments, fixes; deferred items only if the gate was green by Sep 26. | Respond to reviewers. |

---

## 4. Decisions only the owner can make (needed before or in the first days)

Each line: the question · our default · Codex's recommendation · the risk of taking the default.

1. **Which second project runs the hub dry run.** Default ROSE (richest comp history). Codex:
   ROSE, *if its operator agrees*, as a labelled dry run. Risk: rich history is not independent
   adoption; do not present the dry run as a live program.
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
