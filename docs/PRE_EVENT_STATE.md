# Pre-event state — what existed before the Colosseum window

Colosseum's rule: pre-existing code is allowed, all prior development must be disclosed, and only
work completed between 2026-09-14 and 2026-10-12 is judged. This file is that disclosure.

**Finalised 2026-09-14 09:00 UTC**, two hours before the window opens at 11:00 UTC
(04:00 PDT). Everything reachable from the two commits below predates the window and is **not**
claimed as hackathon work.

## The snapshot commits

| Branch | Commit | Head at snapshot |
|---|---|---|
| `main` (production) | `75b69cc64a8f87a65482dc7673590c6d0b0a8bbd` | Retired-feature sweep on main (#297) |
| `develop` (staging) | `41d0a6a2a590fb5b32b6b634419ff0e19917f552` | Merge `origin/main` into develop |

Durable markers pushed at those SHAs:

- `snapshot/pre-colosseum-2026-09-14-main`
- `snapshot/pre-colosseum-2026-09-14-develop`

These are **branches, not tags**. The cloud session's push credential is branch-scoped and
cannot create tags, which was proven on 2026-09-11 with `store-google-v1.0.0` and confirmed again
here. The branches pin the same commits and serve the same disclosure purpose. To add the real
annotated tags from a machine with tag push rights:

```
git fetch origin
git tag -a pre-colosseum-2026-09-14 origin/main -m "pre-Colosseum snapshot"
git push origin pre-colosseum-2026-09-14
git tag -a pre-colosseum-2026-09-14-develop origin/develop -m "pre-Colosseum snapshot (develop)"
git push origin pre-colosseum-2026-09-14-develop
```

## Platform that existed before Sep 14 (baseline, disclosed, not claimed as hackathon work)

- The school: 35 lessons in three tracks, seven languages, read-aloud, Ask Cluck tutor,
  server-gated graduation credential and on-chain NFT, quiz-free public syllabus.
- The tools: Wallet X-Ray, Holders, Trace, Wallet Checkup (free), Listing Checkup, Owners
  Snapshot, LP Rescue (Meteora recovery; Orca/Raydium diagnosis), Firepit, Project Burn, Token
  Metadata Lock, the Hatchery, the batch airdropper, Buy Special, the unified tools pass (signed
  session, server-enforced).
- The Locker Room on Jupiter Lock (free, Token-2022), Lock of Fame pages and index, lock
  celebrations to X and Telegram.
- CUNA lock-to-earn (single mint): hourly accrual, weekly owner-signed payouts, first payout
  2026-09-09.
- The Liquidity Engine (JVP): operator-run for four partner tokens, paused since 2026-09-05; the
  public read-only dashboard at `/liquidity-engine`.
- Telegram and X automation, Normie Quest (separate product, not part of the entry), the Seeker
  dApp Store wrapper, CI with the visual gate and the decision simulator.

## Shipped between the first draft of this file and the snapshot

All of the following are **pre-window** and covered by the baseline above. Listed separately
because they landed after this file was first drafted and must not be mistaken for in-window work.

On `main`:

- Store edition, the education-only Google Play / iOS bundle: #288, then 1.0.1 #291,
  1.0.2 #292, 1.0.3 #296 (Concierge landing, Ask Cluck first, graceful web pointers).
- Store edition legal pages `/privacy/store` and `/terms/store`: #290.
- Store edition release workflow, a manual `workflow_dispatch` run that creates the release tag
  at a named `main` commit: #289.
- CUNA drawing entry registry on the lock host, and its owner-only delete: #286, #287.
- Buy competitions: pinned pools and sell detection across any pool vault #280; transfer-out
  during the hold disqualifies, and percentage prizes are a percentage of tokens bought #294.
- Buy bot: split routes summed across pools, Meteora DAMM v2 vault authority #285.
- Retired-feature sweep: prize wheel page and route deleted, historical diploma relabelled #297.

On `develop`, merged before the window and **not yet promoted to `main`**:

- Hackathon batch 2: Liquidity Engine dashboard, Lock of Fame index, quiz-free syllabus,
  project-team navigation: #282.
- Tools pass hardening, Codex rounds 1 to 4: single-use server challenges, pay intent, paid-pass
  recovery, attempt made durable before broadcast: #284.
- CI: push runs gated by the pushed diff: #293.
- Docs: Colosseum window roadmap revision 2, Project Hub design Addendum B: #295.

**On #282 specifically.** It was merged to `develop` on 2026-09-12 as pre-window work and is
disclosed as such here. Promoting it to `main` after 11:00 UTC is a deployment of pre-window
code, not the creation of new work, and it is not claimed as in-window.

## Built inside the window (filled in as it ships; each line links a PR merged after Sep 14)

- (empty until Sep 14 11:00 UTC)

## How to read the delta

The scored delta is everything after the two snapshot commits above.

```
git log 75b69cc..origin/main
git log 41d0a6a..origin/develop
```

Nothing in the pitch, the demo or the submission that predates those commits is presented as
hackathon work. Where an in-window feature builds on a pre-window component, the pre-window part
is named in the disclosure line for that feature.
