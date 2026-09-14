# Official Rules — what the PDF says, and where it differs from the website

Source: `Crypto World's Fair Hackathon Rules` PDF, supplied by the owner 2026-09-14 and read in
full. The PDF is the **contract** — §4(a): clicking the Official Rules checkbox at registration
signifies acceptance in their entirety, and prize receipt depends on full compliance. The
colosseum.com page is guidance. Where they differ, this file records both.

## 1. The window is two hours later than we had it

**§5 Timing: the Contest Period starts 6:00am PT on 2026-09-14 and ends 11:59pm PT on 2026-10-12.**

| | UTC |
|---|---|
| Opens | **2026-09-14 13:00** |
| Closes | **2026-10-13 06:59** |

Every document here previously said 04:00 PDT / 11:00 UTC. That was wrong by two hours and has
been corrected. **No harm done:** the pre-event snapshot was taken at 09:00 UTC, still safely
pre-window, and every commit we labelled in-window lands after 13:00 UTC — the earliest by about
ten minutes.

Also §5: the Administrator's computer is the official clock, and dates may shift with notice on
the contest site, so re-check before the deadline rather than trusting this file.

## 2. The judging criteria are NOT the seven on the website

This is the important find. **§8 Winner Determination** lists six:

| # | Official criterion | What it asks |
|---|---|---|
| a | **Functionality** | How well does it work? **What is the quality of the code?** |
| b | **Potential Impact** | Total addressable market; impact on the broader crypto ecosystem |
| c | **Novelty** | How unique is the concept? |
| d | **UX** | How well does it use blockchain to create great UX **for downstream users**? |
| e | **Open-source** | Is it open-source? How well does it **compose with other primitives**? |
| f | **Business Plan** | Is there a viable business? How adept is the team at executing? |

The website instead lists Founder + Market Fit, Insight, Product + Execution, Potential Market
Size, Founder Communication, Viability and Traction.

**What is in the rules but not on the website:** open-source, composability, explicit code
quality, and UX for downstream users.

**What is on the website but not in the rules:** Traction, Founder Communication, Insight,
Founder + Market Fit as named criteria.

### What this changes for us

- **Open-source is a scored criterion and we already win it.** The repo is public and MIT
  licensed. We were not claiming this anywhere. Say it plainly in the submission.
- **Composability is scored.** We build on Jupiter Lock, Orca Whirlpools, Raydium CLMM, Meteora
  DLMM, Metaplex and Jupiter. That is a genuine composition story we have been treating as
  plumbing rather than as a judged strength.
- **Code quality is scored explicitly**, which is unusual and happens to suit us: a public repo
  with a diff-gated CI suite, a decision simulator built from real incidents, and money-path tests.
- **Traction is not a named criterion in the contract.** Roadmap revision 3 called it "a seventh
  of the score" on the strength of the website. W9 is still worth doing, because Potential Impact
  and Business Plan both lean on evidence of demand, but it should not outrank Functionality, UX
  or Open-source. **Treat the union of both lists as the target and stop treating traction as the
  single biggest gap.**

## 3. The pre-existing-code disclosure rule is not in the contract

The words "pre-existing", "prior development" and "disclose" do not appear anywhere in the
Official Rules. That rule lives only on the website.

**Keep doing it anyway.** It is honest, it costs nothing, and §4(e) lets the Administrator
disqualify anyone "acting in violation of the Official Rules or in an unsportsmanlike or
disruptive manner", which is exactly where a misrepresented timeline would land. But we should
stop describing it as a contractual rule with a stated penalty, because the PDF does not say that.

## 4. A real obligation we had not noticed

**§9:** *"Entrants agree to inform Administrator of the status and ownership of any open-source or
other third party code, intellectual property filings, or searches related to their Project
Submission."*

That is a live obligation, and broader than the disclosure we have prepared. It wants a
dependency and licence inventory, not a narrative. Worth generating from `package.json` and the
SDKs before submission. Also §9: entrants keep their own IP, and protecting it is our
responsibility.

## 5. Terms worth knowing before clicking accept

Nothing here is unusual for a hackathon, but the owner should know what he is agreeing to.

- **§10 Creative Materials.** The Administrator retains all rights in Contest marketing materials
  it produces, which **may include the entrant's name, image, likeness and Content**. Marketing
  usage, not ownership of the project.
- **§11 Personal information.** Agreeing shares submitted information with judges and Contest
  Sponsors, opts the entrant in to Colosseum emails, and consents to storage and processing on US
  servers.
- **§4(g).** The Administrator may change these rules at any time, with reasonable efforts to
  notify.
- **§3 Eligibility.** 18 or the local age of majority, with sanctions and export-control
  exclusions by country and by sanctioned-entity employment.
- **§7 Limits.** One team per person, one Project Submission per team at a time. Matches what we
  already assumed.
- **§6 Registration.** Every team member registers on colosseum.com; the **team leader** uploads
  the submission before the entry period ends. Registration closes 11:59pm PT 2026-10-12, the same
  moment the contest does. Our roadmap targets filing by Oct 1, which keeps the slack.

## 6. What did not change

The single-mechanism entry, the schema freeze, the workstreams, the money rules and the
Educate → Build → Earn theme all stand. This file changes two things: the clock, and the relative
weight of what we optimise for.
