# Colosseum window roadmap — 2026-09-14 11:00 UTC → 2026-10-12

The operating plan for the four weeks. One founder, no cofounder, an agent team: every
workstream below is a separately scoped session with a definition of done, and the founder is
the only sign-off. Written 2026-09-13, about fourteen hours before the window opens, from the
think tank (`COLOSSEUM_THINK_TANK_2026-09-10.md`), the Project Hub design
(`DESIGN_PROJECT_HUB_2026-09-10.md`, four Codex rounds) and the submission package
(`COLOSSEUM_2026_SUBMISSION.md`). This file supersedes the think tank's §6 calendar.

Owner, 2026-09-13: *"I don't think we need another cofounder, we have all the skills, ideas,
resources — cofounders don't understand what we have been building; we can do virtual agents
to help us with all aspects."* That is the team section of the submission: one founder,
agent-assisted, 600+ commits, 3,000+ CI runs, a second-reviewer AI (Codex) on every PR. Own it.

---

## 0. Where we stand on the eve

**Already live or on `develop` (pre-window, disclosed, not claimed):** the engine dashboard P0
at `/liquidity-engine`, the Lock of Fame index, the quiz-free `/curriculum`, project-team
navigation (#282); the tools pass as a signed session, server-enforced (#283, #284 pending);
`/investors` → `/about`; the prize wheel deleted; README referral params stripped; SSRF
safe-fetch merged; the store edition v1.0.2 released; the CUNA drawing registry.

**Open from the credibility list (do in the first 48 hours, they are cheap and judges see them
first):**

| # | Item | Status 2026-09-13 |
|---|---|---|
| F4 | Six translated school bundles lack the `seedphrase` and `inheritance` lessons | **Open** — `grep -c seedphrase public/i18n/<lang>.school.json` = 0 in all six. "Seven languages" is false until this ships. |
| F2 | Submission §3 team + founder story | **Open** — placeholders. The owner's answer above is the content. |
| F12 | Traction table leads with self-locks and a $12 payout | **Open** — reorder to learners → visitors → partner tokens → mechanism proof. |
| §8 checklist | Colosseum registration, `[OWNER]` placeholders, logo export, demo captures, pitch video | **Registered 2026-09-12.** Rest open. |
| #284 | Tools pass fixes (Codex rounds 1–3) | Green, clean, no round-4 review after two days. Owner's "merge 284" lands it in staging. |

**Not started (the in-window work):** everything in §2.

---

## 1. The thesis the judges will be scored on

One headline mechanism with a number, the school as the front door, everything else as a
labelled "also live, same stack" wall. The headline is the **Project Hub with verifiable
program records and receipts**: a holder can answer *why am I eligible, how was my reward
calculated, is it funded, was I actually paid?* without trusting us, and a project operator runs
the whole loop with tools that already exist. Learn → Build → **Prove** → Earn. It must read as
in-window work, started after 11:00 UTC Sep 14, with the design doc as the disclosed prior art.

Two rules that override everything: nothing arms an engine, and nothing is paid for the camera.

---

## 2. Workstreams — one session each, run in parallel

Every session gets: its own branch off `develop`, an explicit `model:` on every subagent it
spawns (Haiku for mechanical, Sonnet for the build, Fable/Opus only for money-path judgement),
CI + the visual gate before every push, a PR opened on the first commit, Codex review on the PR,
and a definition of done it can prove. Concurrency is the box, not the budget: 2–3 agents per
session, 6–8 sessions, one coordinator. Nothing merges to `main` without the owner's "promote".

### W1 — Project Hub: data layer and money rules (the centerpiece, weeks 1–2)
Branch `hub/core`. The pure libs: project record, program versions with hashes, the ledger with
the `accrued = available + reserved + paid` partition, eligibility with reason codes, batch
lifecycle including partial and overpaid rows, receipts with the reproduce export. CUNA migrates
onto it and `cuna-payout-verify` still verifies batch `cb_8d28a7ea39`.
**Done when:** the ten acceptance tests in the design doc §7 exist as CI scripts and pass; the
CUNA ledger reads identically through the new keys; `mutating-get-guard` covers every new route.
Model: Sonnet builds, Fable verifies the money rules (two lenses, per the budget rule).

### W2 — Project Hub: public surfaces (week 2)
Branch `hub/pages`. `/p/<id>`, `/p/<id>/program/<v>`, `/p/<id>/eligibility?wallet=`,
`/receipt/<batch>/<wallet>`, the JSON mirrors. Plain words, the three funding numbers labelled,
lessons linked at the moment of action. Seven languages via the dictionary pattern.
**Done when:** every page renders in the smoke test, the i18n audit passes, a receipt for an
unrecorded row 404s, and the owner has eyeballed it on staging on desktop and a phone.
Depends on W1's schemas (can start on fixtures from day 3).

### W3 — Project Hub: operator console and funding-wallet payout (week 2–3)
Branch `hub/operate`. Signed-nonce operator login (its own HMAC purpose, never the tools pass),
draft → preview → batch → the existing `/cuna-payout` flow project-scoped, server-side reconcile
from the chain. The server never holds a project key.
**Done when:** acceptance tests 8 and 9 pass; a batch signed from the wrong wallet is refused; a
dry-run second project proves isolation end to end on staging.

### W4 — For Projects hub + intake + public standings (week 1)
Branch `projects/front-door`. `/for-projects`: the guided flow lock → lock-to-earn → buy
competition → airdrop → listing checkup → owners snapshot → burn receipt, with a per-mint
checklist read from the existing feeds. "Request a lock-to-earn program" intake with an
owner-visible queue. Buy Special public standings and hold-through proof page (redacted view
over `/api/buycomp/standings` + `/verify`, now with transfer-out DQ and token-denominated
prizes from #294). Airdrop per-drop receipt page on the `/burn/:sig` pattern.
**Done when:** each page is linked from the homepage door, renders in the smoke test, and the
standings page shows a finished comp (ROSE horse race) with its DQ reasons.

### W5 — Engine dashboard P1 (week 2–3, read-only)
Branch `engine/timeline`. The `engineLog:<project>` ring buffer written where `tick()` already
calls `setState`, Helius signature backfill, the timeline with tx links, the simulator replay of
the real incidents from `scripts/engine-sim-test.cjs`, the ROSE `realizedSuspect` flag surfaced
never the poisoned number, GeckoTerminal cached 60–120 s serving last-good on 429, the operator
pubkey stripped from public bodies.
**Done when:** the timeline shows real history for all four projects with the paused banner
leading, and `engine-sim-test` still passes unchanged.

### W6 — Credibility and truth pass (first 48 hours, then continuous)
Branch `truth/window-1`. F4 translations (two lessons × six languages, then extend the i18n
audit to lesson ids so it cannot recur), F12 traction table reorder, README and `/about` kept
true to the code as W1–W5 land, `PRE_EVENT_STATE.md` "built inside the window" filled in per
merged PR with the PR link, Colosseum §8 checklist driven to done.
**Done when:** every claim in README, `/about` and the submission survives a two-minute check
against the live site, and the disclosure file lists every in-window PR.

### W7 — Story: demo, pitch, submission (weeks 3–4)
Branch `story/colosseum`. The nine demo captures recorded as each surface lands (not at the
end), the three-minute demo cut, the pitch video outline filled with the founder's own words,
the submission form fields paste-ready, logo at 1024×1024, the Arena post drafts (nothing posted
before kickoff; nothing posted claiming pre-window work as new).
**Done when:** the submission is filed by **Oct 1** with a week of slack for reviewer comments.

### W8 — Quality gate (continuous)
Not a build session. Runs the tests, the visual gate, the security review skill on every hub PR,
the adversarial pass on money paths, and reports at each phase boundary with the agent count and
ETA. Codex remains the second reviewer on every PR; findings, not rewrites.

### Stretch, only after W1–W4 are done
Airdropper resume ledger (never double-send), anti-arb badge on standings from Owners Snapshot
clustering, Holders historical snapshots, LP Rescue Orca-only withdrawal. Not this window:
Raydium withdrawal, self-service enrollment, any escrow of our own, engine restarts.

---

## 3. Calendar

| Dates | Ships | Owner touchpoints |
|---|---|---|
| **Sep 13 (tonight)** | "merge 284", "merge 293", "merge 294"; snapshot routine at 09:00 UTC Sep 14 pushes the `snapshot/pre-colosseum-2026-09-14-*` branches; owner pushes the real tags from the Mac. | Decide §4 items 1–3 so W1 can start at 11:00 UTC. |
| **Sep 14–16** | W6 credibility fixes; W4 pages start; W1 libs and acceptance tests start; W5 ring buffer lands. | Eyeball W4 on staging; answer §4 item 4. |
| **Sep 17–21** | W1 done; W2 on fixtures then on W1; W4 done; first demo captures. | "promote" the first in-window batch to `main`. |
| **Sep 22–28** | W3 operator console; W2 done; W5 timeline done; dry-run second project on staging. | Pick the dry-run project; eyeball the hub flow end to end on a phone. |
| **Sep 29 – Oct 1** | Demo cut, pitch recorded, traction refreshed, submission filed. | Record the pitch; file. |
| **Oct 2–12** | Arena presence, reviewer comments, fixes; stretch items only if green. | Respond to reviewers. |

---

## 4. Decisions only the owner can make (needed before or in the first days)

1. **Which second project runs the hub dry run** — POKE, DNC, ROSE, or a NORMIE-community
   token. Needed by Sep 22; the demo's isolation shot depends on it.
2. **Program funding rule** — must a project pre-fund a period before accrual arms, or is a
   shortfall simply shown? (Design shows it. Requiring it is safer for holders.)
3. **Operator drafts** — self-service for program *drafts* in the first cohort, or owner-only?
4. **Public naming** — `/p/<id>` or `/project/<id>`, and whether hubs carry the project's own
   Telegram/X links.
5. **Service pricing** on `/about` and in the submission — a number or "custom", but named.
6. **The founder story** — the "hard knock" in your own words for the pitch video and §3.

Recommended defaults if no answer arrives: ROSE for the dry run (its comp history is the
richest), shortfall shown not required, owner-only drafts, `/p/<id>`, "custom pricing, per
project", and the team line quoted at the top of this file.

---

## 5. Operating rules for every session in the window

- Read `CLAUDE.md`, this file, and the design doc before touching the hub.
- PR on the first commit; CI is diff-gated (#293), so a non-game PR costs minutes, not a
  quarter hour — there is no reason to batch pushes to avoid CI.
- `develop` is staging and free; `main` is production and the owner's explicit "promote" only.
- Money paths get two verifier lenses; P2/P3 polish gets none. A session that would spawn more
  than 60 agents or run past 90 minutes stops and asks with the number.
- Nothing arms an engine. Nothing is paid for the camera. Nothing about Normie Quest prizes.
  Nothing about Wallet Watch. Security mentions credit RootCrak with the referral link.
- Every merged in-window PR gets a line in `PRE_EVENT_STATE.md` the same day.
- Tell the truth about what ran. A check that did not run is reported as not run.
