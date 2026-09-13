# Codex reviewer brief — Cluck Norris / School of Crypto Hard Knocks (2026-09-10)

You are the second reviewer on this repo. Claude (a Claude Code session driven by the owner) builds;
you review, verify and give second opinions; the owner decides. Nobody merges to `main` but the owner.

## Read first, in this order
0. `docs/COLOSSEUM_ROADMAP.md` (PR #295, 2026-09-13) — the operating plan for the window: what is
   done, the eight workstreams, the calendar, the owner's open decisions. **Your first job in the
   window is to review this plan, not code**: post findings on PR #295 (see "Round 0" below).
1. `CLAUDE.md` — the owner's decisions and the traps that already cost days. A reviewer without it
   flags intentional things as bugs. The rules that matter most for you: docs must match the code;
   the chain shows *what*, never *why*; Wallet Watch is private (never mention it); no Normie Quest
   reward promises; admin routes that act are POST-only; `develop` is staging, `main` is production.
2. `docs/COLOSSEUM_THINK_TANK_2026-09-10.md` — the hackathon plan: eight-lens findings, the fix
   list, the two build tracks, the owner decisions still open.
3. `docs/COLOSSEUM_2026_SUBMISSION.md` — what we will tell the judges. Anything it claims must be
   true in the code.

## Where things are (updated 2026-09-13; the roadmap §0 is the live version of this list)
- **Merged to develop (staging):** PR #282 (dashboard, Lock of Fame index, syllabus, navigation),
  PR #283 (tools pass as a signed session), the store-edition batch (#288–#292), CUNA drawing
  (#286, #287). **Open:** #284 (tools pass rounds 1–3 fixes — your round-4 re-review never
  arrived; say "reviewed, no issue" or post findings), #293 (CI diff-gated on pushes), #294 (buy
  comps: transfer out during the hold = DQ; % prizes = % of tokens bought), #295 (the roadmap).
- Earlier state, kept for context:
- **Merged to develop (staging):** PR #281 — tools pass enforced server-side on the heavy APIs
  (`toolPassGate` in `server.js`, proof carried by `public/cluck-gate.js`), operator consoles no
  longer served raw, `/about` replaces the investors page, diploma NFT persisted on the credential,
  two lessons translated into six languages, copy drift fixed.
- **Open, green, awaiting the owner's merge call:** PR #282 — the Liquidity Engine dashboard
  (`public/liquidity-engine.html`, data layer `lib/jvp-dashboard.js`, routes `/api/jvp/*`), the
  Lock of Fame index (`public/lock-of-fame.html`), the quiz-free syllabus generator
  (`scripts/build-curriculum.cjs`), and project-team navigation (`public/home.html`,
  `public/tools.html`, `public/cluck-nav.js`, `src/App.jsx`).
- **Not started:** the For Projects hub, public Buy Special standings and hold-through proof,
  the lock-to-earn intake form, the airdrop receipt page, the dashboard's P1 timeline and
  simulator replay, and multi-mint lock-to-earn (design below).

## What to review first (ranked)
1. **The server-side tools pass (PR #281, money path).** `toolPassGate` / `requireToolPass` in
   `server.js`; the proof format `w:<wallet>` (live CLKN balance at the tool-gate price, or a
   comped wallet) and `s:<sig>` (a SOL payment signature redeemed by `/api/verify-sol-payment`,
   recorded as `toolPass:<sig>` in kv). Questions: can a proof be forged, replayed across users,
   or kept alive past expiry? Is the fail-open on missing price / RPC failure abusable? Does the
   5-minute holder cache create a window worth caring about? `scripts/tool-pass-gate-test.cjs`
   pins the current behaviour; say if the pins are the wrong ones.
2. **Dashboard sanitisation (PR #282).** `lib/jvp-dashboard.js` is the only thing between the
   vault's `status()` (which carries the operator pubkey, float balances, P&L, chat ids) and a
   public page. Read `sanitizeStatus`, `sanitizePositions`, `sanitizeDislocation` and the two
   routes. Does anything leak, directly or through error strings? Are the GET routes truly
   read-only (`scripts/mutating-get-guard-test.cjs` is the CI pin)?
3. **The decision replay.** `deriveDecisions` in the same file feeds live inputs to
   `lib/engine-decisions.js`, the pure gates the vault actually calls. Are the derived inputs
   (`frac`, staged quote, idle token, dwell/last-buyback assumptions) honest, and is anything
   presented as a decision that the code would not actually make?
4. **Multi-mint lock-to-earn, design only, no code yet.** The math in `lib/cuna-staking.js`,
   `lib/cuna-programme.js`, `lib/cuna-payout.js` is already pure and mint-agnostic; the CUNA
   wiring is seven kv keys, one singleton and branded pages. Owner's design: owner-whitelisted
   mints (config, not self-serve); **the project's own funding wallet signs its own payout batch**
   from its own payout page, so no second key is ever held by us. Poke holes in that before it is
   built: sybil, term gaming, Rule B (exclude by recipient and creator) generalised, payout
   double-count across projects, what a hostile project could do to its own holders.

## How to deliver findings
- Post them as review comments on the PR (Claude is subscribed and acts on them), or hand them to
  the owner. Findings, not rewrites: two agents editing one branch is how files get clobbered.
- Rank by severity, cite `file:line`, give the failing input. A finding on a money path with a
  reproduction is worth more than ten style notes. P2/P3 polish gets no verifier here.
- Say when something is fine. "Reviewed, no issue" on a money path is a real result.
- Never run anything that arms, pauses, rolls, pays or posts. Reads are always fine. All
  liquidity engines are paused by the owner; leave them so. Never `&loud=1`; never print or commit
  a secret; the admin key travels only in an `x-premium-key` header.

## Round 0 — review the plan before the window opens (owner ask, 2026-09-13)
Read `docs/COLOSSEUM_ROADMAP.md` and `docs/DESIGN_PROJECT_HUB_2026-09-10.md` together, then post
findings on PR #295, ranked. What we want from you, in order:
1. **Is the Project Hub the right in-window centerpiece**, against what has placed at Colosseum
   before (one sharp mechanism with a number)? If not, name the one thing you would lead with and
   why it reads better to a judge in three minutes.
2. **The eight workstreams**: which one is under-scoped, which is a week of work dressed as three
   days, which dependency is wrong. W1's ten acceptance tests are the money path — say whether
   they are the right pins before they are written.
3. **What is missing.** The plan is built from our own docs; name the judge question none of the
   surfaces answer.
4. **What to cut.** Four weeks, one founder, 2–3 agents concurrently per session. If the calendar
   is a fantasy, say which rows.
5. **The six owner decisions in §4**: your recommendation on each, one line, with the risk if the
   default is taken.
6. **The team story**: one founder plus an agent team, second-reviewer AI on every PR. Is that a
   strength or a liability in front of these judges, and how would you word it?
Findings, not rewrites. A "the plan is fine, ship it" on any item is a real answer.

## Open questions the owner would like your opinion on
- Is lock-to-earn on Jupiter Lock the right headline mechanism for a Consumer Apps entry, or is
  the read-only engine dashboard a stronger single story?
- Server-side pass enforcement versus the previous client-only gate: is the fail-open rule the
  right default for a product that promises "learning and safety stay free"?
- The traction table now leads with visitors and learners and labels CLKN's own locks as ours.
  What would you cut or add before a judge reads it?
