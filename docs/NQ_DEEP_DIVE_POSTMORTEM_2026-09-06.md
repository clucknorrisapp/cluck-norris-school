# Postmortem — the Normie Quest deep dive took 18+ hours (2026-09-06)

Owner: *"we have to figure out why it took almost 24 hours to do the deep dive into normie, this is
unacceptable."* Agreed. This is the measured answer, from the workflow's own journal and the 873
agent transcripts on disk, and the rules that stop it recurring.

## The numbers

| Measure | Value |
|---|---|
| Workflow start → still verifying at time of writing | 03:52 → 22:00 UTC, **18.1 h** |
| Earlier aborted attempts the night before (planning, two false starts) | ~3 h more, hence "almost 24" |
| Unique agent jobs the script defined | **592** (3 inventory + 18 finders + 3 verifier votes × findings) |
| Agent runs actually executed | **874** — 282 were re-runs of already-finished jobs |
| Agent time consumed | **34.8 agent-hours** (median agent 2.0 min, p90 4.4 min, max 16 min) |
| Concurrency this box actually gave the workflow | **2–3 agents at a time** (never above 5); 0 idle minutes |
| Findings from the 18 finders | 201 (6 P0, 71 P1, 79 P2, 45 P3) |
| Verifier votes planned by the original script | 201 × 3 = **603** (cut to P0/P1 only at hour 16 → 231) |

## Why, in order of blame

1. **The fan-out was designed for a box that does not exist.** Three adversarial votes on every one
   of 201 findings is 603 verifier agents. At the 2–3 concurrency this box actually provides and a
   2.4-minute median agent, that is ~10 hours before anything else. Most of those votes went to P2/P3
   polish items ("this label could be bigger") that never needed money-grade verification. CLAUDE.md
   already said *"a verifier on a stale comment is not worth the tier"*; the script ignored it. This
   was my design error.
2. **No budget, no ETA, no gate.** The script computed nothing up front. It should have printed
   "592 agents ≈ 24 agent-hours ≈ 10 h wall at 2.5 concurrent" and stopped for a decision. It ran
   until the owner asked what was going on at hour 16.
3. **Resumes re-executed a third of the work.** Two container restarts and one deliberate stop each
   resumed the run. The journal cache was supposed to replay finished agents instantly; instead 267
   of 592 keys were started twice or three times and 245 produced two results — **282 wasted runs,
   ~11 agent-hours**. Whether this is a harness bug or a keying issue, the operational fact is: on
   this stack a resume costs a third of the run.
4. **Nothing was delivered until the end.** All 201 findings existed by hour ~4. A report from those
   alone, with P0s marked "unverified", would have been useful at hour 4. Instead the owner saw no
   output for 18 hours because the script only wrote the report after the last vote.
5. **Concurrency ceiling.** The Workflow runtime ran 2 agents at a time on this box (3 when a
   pipeline stage overlapped). That is the environment; the design has to plan for it rather than
   assume 15 parallel agents.

## What was NOT the cause

Not model speed (median agent 2 minutes, that is fine), not the repo (the finders were done in
hours), not CPU (load average sat under 2). It was arithmetic: too many agents through too narrow a
pipe, with a third of them run twice.

## Rules from here (added to CLAUDE.md, "Multi-agent budget")

- **Budget first, every time.** A workflow script computes its agent count and prints
  `agents × median 2.5 min ÷ 2.5 concurrent` as the ETA before running anything. Over **60 agents or
  90 minutes** → stop and ask the owner with the number; do not start.
- **Verify only what costs money if wrong.** P0/P1 get ONE verifier (Opus); money / PII / engine
  paths get two more lenses. P2/P3 never get a verifier — the finder's confidence is the grade.
- **Cap findings per finder at 10, ranked.** 201 findings was the multiplier; a finder that returns
  40 has not ranked anything.
- **Deliver at the phase boundary.** The findings list is written to `docs/` and shown to the owner
  the moment the Find phase ends. Verification and synthesis refine it; they never gate it.
- **Report at every phase boundary with the ETA.** If the ETA is past the budget, cut the plan there
  and say what was cut.
- **Never resume twice.** One resume, or finish, or kill and synthesize from what is on disk. Every
  result is in the journal; a crash loses at most the two agents in flight.
- **Plan for 2–3 concurrent agents on this box**, not N. Parallelism buys nothing past that here.

## Where the deep dive itself stands

Finders and 842 verifier votes are on disk. The remaining P0/P1 votes are running; the synthesis
(one agent) follows. If it is not finished by 23:00 UTC it gets killed and the report is written
from the journal as it stands. The freeze bug found today (PR #242, stale `runner` sprite on the
reused LevelClear scene) was found by the beat test, not by the deep dive — a reminder that a
30-second targeted test can beat 800 agents.
