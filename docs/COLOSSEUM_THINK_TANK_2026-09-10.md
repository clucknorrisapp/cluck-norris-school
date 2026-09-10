# Colosseum think tank — how we get at least an honourable mention (2026-09-10)

Eight lenses, one box, ~45 minutes wall clock, under the multi-agent budget: judge (Opus),
red team (Opus), engine dashboard (Opus), inventory, first-run, winners-corpus via Colosseum
Copilot, feasibility, proof numbers (Sonnet + owner session). Raw lens notes are in the session
scratchpad; this is the synthesis. Every "verified" below was re-run by the session itself on
2026-09-10, not taken from an agent on trust.

Owner brief, verbatim intent: everything on display, one-stop shop, "we meet you where you
are"; project tools take a big stage (airdropper, Buy Special, Locker Room); **the big prize is
the liquidity engine and it needs a more advanced dashboard**; the school is the face and the
intro, then we transition to how we help others build, then how we reward them (lock-to-earn,
whitelistable for anyone); "I am building an empire."

---

## 1. The verdict in five lines

1. **The product is a school. The pitch materials are a token.** Homepage, seven-language
   school, Wallet Checkup, Locker Room all read as someone building a school. README leads with
   "funded by a token", `/investors` is titled INVEST IN THE COMMUNITY, and the traction table is
   five token rows and two empty learner rows. Flip the materials, not the product.
2. **Breadth is not a thesis, it is evidence of velocity.** Across Breakout and Cypherpunk, no
   multi-tool bundle and no education-framed entry has ever placed. Every honourable mention is
   one sharp mechanism. So: one headline mechanism with a number, the school as the front door,
   everything else as a labelled "also live, same stack" wall.
3. **Three claims fail a two-minute check today**: the tools pass (X-Ray API answers with no
   pass), "seven languages" (two newest lessons untranslated in all six), and "multi-quote
   generates volume" (every Orca pool at $0 because the engines are paused). Fix or reword each.
4. **The numbers that survive multiplication:** 105k visitor-days lifetime, ~5k visitors/day
   this month, 4 client tokens on our infrastructure, first lock-to-earn payout on-chain. The
   numbers that don't: $12 payout, $2.2k lifetime fees all reinvested, 1 tools pass ever sold.
5. **The engine dashboard is the right showpiece, if it leads with the paused state.** No
   action history exists in the store yet, and a fake-live gauge would be found out. History,
   the anti-wash organic-versus-router split, and the pure decision engine are the story.

Track to enter: **the Solana ecosystem prize track.** (Corrected 2026-09-10 after Codex read the
live rules: this event's prize tracks are by blockchain ecosystem, not by product area. The
"Consumer Apps" framing from the historical corpus still describes the *shape* judges reward.)

## 0. The rule that reorders everything (verified on colosseum.com/hackathon, 2026-09-10)

> "Teams may begin development before the hackathon, but products are judged only on the work
> completed between the competition's start and end dates." · "Builders may use pre-existing
> code, but teams must disclose all relevant past development work in the submission form."

So: **everything built before Sep 14 is baseline; everything built Sep 14 – Oct 12 is what is
scored.** The owner's call (2026-09-10): *thoughts now, build inside the window.* Until Sep 14 we
fix, document, design and record the baseline; the headline builds start Sep 14 so the scored
delta is large, visible and honestly disclosed. `docs/PRE_EVENT_STATE.md` will be the disclosure
(a tag `pre-colosseum-2026-09-14` on `main` and `develop`, plus an inventory of what existed).

**Before Sep 14 (allowed, not scored):** security and bug fixes (the signed tools pass, PR #283),
docs and designs (this file, the lock-to-earn design, the For Projects spec), the pre-event
inventory, registration, the repo description, the founder story, the staging eyeball and the
promotion of what is already built. **Sep 14 onward (scored):** multi-mint lock-to-earn for
whitelisted projects (the headline — Codex independently landed on the same feature: "a
project-owned holder rewards program with verifiable terms and payouts"), the For Projects hub,
public Buy Special standings and hold-through proof, airdrop receipts, the dashboard's timeline
and simulator replay, the embeddable trust badge from the red team, and the demo and pitch
videos of that work.

---

## 2. The pitch: Learn → Build → Earn, told as one loop

**Headline mechanism (the one sentence):** *Lock-to-earn on Jupiter Lock — a community locks its
float, the project pays them weekly for keeping it locked, and every lock announces itself. Free
for any project we whitelist.* First real payout landed 2026-09-09. This is the only thing in the
5,400-entry corpus with no precedent.

**The loop.** LEARN: the school is the front door, free, seven languages, an AI tutor, a
server-verified credential (105k visitor-days say people come). BUILD: the same team gets the
project toolkit — lock on Jupiter Lock, run a fair buy competition, airdrop the holder list,
check listings, burn with a receipt — and, for tokens that qualify, the liquidity engine that
puts real two-sided depth on Orca so aggregators route through them. EARN: lock-to-earn keeps the
float off the market and pays the community for it. The four client tokens (POKE, CUNA, DNC,
ROSE) are the first tenants of the platform. That is the empire, stated honestly: owner-run
services today, whitelisted onboarding, not self-serve.

**The demo's nine shots collapse to five**, each 30+ seconds: Wallet Checkup (free safety, the
newcomer's first minute) → a lesson with language switch and tutor → Locker Room create-a-lock
→ lock-to-earn page and the payout receipt → the engine dashboard. Everything else is one
screenshot wall with a caption.

---

## 3. Fix first: credibility items, each under a day (do all of them, week 1)

Verified by the session unless marked (agent).

| # | Item | Evidence | Fix |
|---|---|---|---|
| F1 | GitHub repo description advertises Cluck Score and "built for the Bags Hackathon" | api.github.com repo `description` | Rewrite the description (owner, one field in GitHub settings) |
| F2 | Contributor graph: 71% of commits authored by Claude, team section blank (agent; consistent with `git log`) | contributors API | Own it in the founder story: one founder, agent-assisted build, 612 commits, 3,013 CI runs. Fill §3 of the submission |
| F3 | X-Ray / Holders / Trace APIs answer with no pass; gate is client-side only | `curl /api/wallet-xray?wallet=…` → 200, 247 KB | Enforce the pass server-side using the Owners Snapshot pattern (`server.js` ~16202), or reword README to "pass on the page, API open" — pick one; the first is right |
| F4 | Six translated school bundles lack `seedphrase` + `inheritance` (added 2026-09-04) | `grep -c` = 0 in es/hi/it/pt/vi/zh | Translate the two lessons; the i18n audit CI should have caught this — extend it to lesson ids |
| F5 | `prize-wheel.html` (the removed Coop Spinner) and six admin consoles served raw at `/<name>.html`; `cuna-payout.html` lacks the noindex header the route sets | HTTP 200 on all | Delete the prize wheel file; add explicit routes with noindex for the consoles or move them out of `public/` |
| F6 | Diploma mint signature never persisted; transcript cannot link to an explorer | `/api/credential/<slug>` has no mint (agent) | Persist `nft` on claim into the credential record; add the Solscan link on `/transcript` |
| F7 | Liquidity Engine described four ways (README "not offered", `/liquidity` "in development", investors "multi-tenant live", submission "run for four tokens") | files cited in lens notes | One sentence everywhere, owner's wording (see decisions) |
| F8 | README claims live Orca multi-quote depth; every Orca pool shows $0 24h volume because engines are paused | GeckoTerminal (agent) | Say "paused by the owner since 2026-09-05; history on the dashboard" |
| F9 | `?ref=firechicken007` on the two trade links in README; all socials are FireChicken handles | README:5, :212 | Strip the referral params; add the CLKN X account |
| F10 | `/investors` titled INVEST IN THE COMMUNITY, price-appreciation copy, and says send-to-unlock is "still live" (it was deleted) | investors.html:230–239, :512 | Retitle to `/about` for judges and partners; move holder copy to an unlinked page; fix the send-to-unlock line |
| F11 | Open PR #212 "SSRF: validate every redirect hop" sitting open under a README that touts security fixes | GitHub | Merge or close before Sep 14 |
| F12 | Submission traction table leads with self-locks ("73 locks, 48.8%") and a $12 payout | submission §4 | Lead with learners and visitors; keep lock-to-earn as mechanism proof, not as a dollar figure |

---

## 4. Build: three weeks, two tracks, honest day counts

Capacity assumption: one owner plus agents, ~20–24 engineer-days across the window, everything
through staging with the owner's eyeball. Both tracks are read-only against money; nothing arms
an engine.

### Track A — the liquidity engine dashboard (the owner's big prize) · P0 ≈ 9.5 days

Route `/liquidity-engine` (replaces `public/liquidity-locked.html`; both `/liquidity` and
`/liquidity-engine` serve it). GET-only, no controls, never holds a key. Leads with a banner:
*all engines stopped by the owner 2026-09-05; the organic score decays to 0 without runtime, and
CLKN reads 0 today* — the stop levers proven on live data.

| Panel | Source | Days |
|---|---|---|
| Fleet header: 4 projects, paused/armed, last tick, pools, mode | sanitised new `/api/jvp/overview` from `vault.status()` | 1 |
| Live pool map: price vs ±1% ranges per quote | `/api/whirlpool/pools`, `publicPositions()`, `dislocation()` | 2 |
| Volume generated per pool, hourly, vs baseline | GeckoTerminal pool `volume_usd` + `/ohlcv/hour` (~40 days, free) | 2 |
| Organic score + holder trajectory, all 4 projects | `clknOrganicLog`, extend `recordOrganicSnapshot()` (server.js ~17466) to POKE/ROSE with holders/liq/mcap | 1.5 |
| Organic vs router volume split — the anti-wash proof | Jupiter `tokens/v2` `buyOrganicVolume` vs `buyVolume` | 1 |
| "What the engine would do now" | new GET `/api/engine-decision?project=` over the pure `lib/engine-decisions.js` | 2 |

P1 (≈8.5 days, after P0 ships): engine timeline with tx links (needs the one new kv ring
buffer `engineLog:<project>` written where `tick()` already calls `setState`, plus a Helius
signature backfill), simulator replay of the real incidents from `scripts/engine-sim-test.cjs`,
fee/inventory P&L behind admin or client wallet auth (surface the ROSE `realizedSuspect` flag,
never the poisoned number), the per-client Telegram-safe view over the existing `/vault/client/*`.

Two hygiene items ride along: strip the operator pubkey the `/vault` wrapper injects into every
public body, and cache GeckoTerminal 60–120 s serving last-good on 429. Every new route must
pass `mutating-get-guard` CI.

Judge questions the dashboard answers on its face: *wash trading?* No — two-sided depth filled
by third parties, organic share shown beside total, router flow greyed exactly as Jupiter does.
*Who signs?* A per-project operator hot wallet holding only the client float, never a mint or
freeze authority. *Custody?* Yes, named as custody. *Is the score bought?* Rented — it decays to
0 when the engine stops, which the dashboard shows.

### Track B — the project suite takes the stage · ≈ 12 days on the honest line

1. **For Projects hub** (`/for-projects`, 3.5 d): one guided flow — lock → lock-to-earn → buy
   competition → airdrop → listing checkup → owners snapshot → burn receipt — with a per-mint
   checklist read from `/api/locks`, `recentLockEvents`, comp list, listing report, burn receipts.
2. **Nav and concierge** (1 d): a seventh homepage door "I run a project"; Wallet Checkup as a
   homepage tile and first in the "research" line; `/tools` grouped under three headers (For your
   project / Research any wallet or token / Safety); "Buy Special — Buy Competition" in the card
   and H1; Locker Room opens on Create-a-Lock when arriving from the tile; fix the phone overlap
   of the Listen and language pills on the first tile row; link the orphans worth keeping.
3. **Lock of Fame index** (2 d): every memo-tagged lock grouped by mint, from the feed that
   already exists (`recentLockEvents` + `/api/lock/recent`). This is also the only honest way to
   count third-party adoption of the Locker Room.
4. **Buy Special public standings + hold-through proof page** (3 d): `/api/buycomp/standings`
   and `/verify` exist and work, admin-only; make a public, redacted view. The airdropper handoff
   already exists.
5. **"Request a lock-to-earn program" intake** (1 d): a form and an owner-visible queue. Tells
   the whitelist story to judges now, without the full build.
6. **Airdrop per-drop public receipt page** (1.5 d): the `/burn/:sig` pattern, verbatim.

Stretch, only if the line above is done: airdropper resume ledger (2–2.5 d; must never
double-send), anti-arb advisory badge on standings using the Owners Snapshot clustering (+1 d),
Holders historical snapshots (3–4 d, fulfils the page's own "coming soon"), LP Rescue Orca-only
withdrawal (3 d). Not this window: Raydium withdrawal (hand-encoded money instruction, no way to
test with real funds from here).

### The multiplier — lock-to-earn for any whitelisted mint · 5–6 days dry-run, 8–10 live

The accrual, weight and payout math in `lib/cuna-staking.js` and `lib/cuna-payout.js` is already
pure and mint-agnostic. What is CUNA-specific is wiring: seven hardcoded kv keys, one programme
singleton, branded pages, no `project=` on ~15 routes. Design, per the owner on 2026-09-10:
**owner-whitelisted mints, not self-serve; the project's own funding wallet signs its own payout
batch from its own payout page** — no second key at CLKN, so the custody trap never opens. Ship
the intake (B5) now; build the multi-mint version as the first post-hackathon item unless the
dashboard P0 lands early, in which case a dry-run for one second mint is the best closing shot
the demo could have.

### Removed features — the calls

- **Bring back one: `/curriculum` as a quiz-free syllabus.** 35 lesson titles, concepts,
  objectives, seven flags, no questions, no answer key. A judge cannot see what the school
  teaches without walking the SPA today, which is why the token pages are the most readable thing
  on the site. Half a day; keeps 100% of the value and 0% of the leak that killed it.
- **Never: Cluck Score.** Its retirement is the sharpest line in the pitch.
- **Delete now: the Prize Wheel file.** A slot machine on a school's domain is the cheapest
  screenshot a competitor could take. The provably-fair RNG lives on inside real draws.
- **Leave dead:** Ultimate Challenge, Survival Simulator (a measured zero), Token Vitals
  (duplicates Holders).
- **Say out loud:** three of eight removals were for user harm, not unpopularity. That is
  discipline, and it is on brand.

---

## 5. Decisions only the owner can make

1. **The one sentence about the liquidity engine** that README, `/liquidity`, `/about` and the
   submission will all carry. Proposed: *"An operator-run concentrated-liquidity service we have
   run for four partner tokens; paused since 2026-09-05 while we build the dashboard; not
   self-serve."*
2. **Server-side enforcement of the tools pass** on the three heavy APIs (recommended) versus
   rewording the README.
3. **`/investors` → `/about`** and where the token-holder copy lives.
4. **What goes public on a traction page** (visitors, graduates, locks by third parties, client
   count). Revenue figures: the pass and Hatchery have earned effectively nothing; fees are $2.2k
   lifetime and reinvested by public commitment. Recommend publishing visitors, learners, locks and
   clients, and stating the services model with a price rather than a revenue figure.
5. **Service pricing** for the platform tier (verification, lock-to-earn, buy comps, engine) —
   a number or "custom", but named.
6. **Order of the two build tracks**, or both in parallel with agents. Recommendation: Track B
   items 2, 3, 5 and the fix list in week 1 (they are cheap and they change what judges see
   first), Track A P0 in weeks 1–2, Track B items 1, 4, 6 in week 2–3, submit Oct 1.

---

## 6. Calendar

- **Sep 11–14:** fix list F1–F12; nav/concierge/tools grouping; syllabus page; Lock of Fame
  index; lock-to-earn intake; register; founder story written. Staging → owner eyeball → promote.
- **Sep 15–21:** engine dashboard P0 (six panels); For Projects hub; Buy Special public
  standings + proof; record the five demo shots as each lands.
- **Sep 22–28:** dashboard P1 timeline + replay; airdrop receipt page; stretch items; pitch
  video; refresh the traction numbers.
- **Sep 29 – Oct 1:** submit. Oct 2–12: Arena presence, respond to reviewer comments, fix
  what they surface.

---

## Appendix — what each lens contributed (one line each)

- **Judge:** scores 4/8/6/5/5/3/3 (alignment, insight, quality, TAM, communication, viability,
  traction); the two 3s are the whole game.
- **Red team:** the twelve fix-list items; "breadth hurts at this stage and it isn't close";
  the competitor threat is an embeddable trust badge that lives on other people's sites — our
  Lock of Fame page is 80% of that and should become embeddable next.
- **Winners corpus:** no education entry has placed; one mechanism wins; Consumer Apps; kit is
  repo + separate technical demo video + live X.
- **Engine dashboard:** history-first, paused banner, free data sources for volume, organic
  split and score; pure decision engine as the differentiator; P0 9.5 days.
- **Inventory:** 43 routed surfaces, 9 orphans, the half-shipped list, restore commits for
  every removed feature.
- **First run:** no door for project teams; Wallet Checkup invisible from the homepage; phone
  pill overlap on first paint; `/tools` a flat wall of 15 cards.
- **Feasibility:** the 12-day line above; lock-to-earn math already mint-agnostic.
- **Proof:** 140,462 views / 105,185 visitor-days lifetime; 22 graduates; 1 pass sold; hatchery
  and pass share one receiver with five signatures ever.
