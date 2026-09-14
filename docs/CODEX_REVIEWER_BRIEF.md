# Codex reviewer brief — Cluck Norris / School of Crypto Hard Knocks (2026-09-10)

You are the second reviewer on this repo. Claude (a Claude Code session driven by the owner) builds;
you review, verify and give second opinions; the owner decides. Nobody merges to `main` but the owner.

## Read first, in this order
0. `docs/COLOSSEUM_ROADMAP.md` (PR #295, 2026-09-13) — the operating plan for the window: what is
   done, the eight workstreams, the calendar, the owner's open decisions. **Your first job in the
   window is to review this plan, not code**: post findings on PR #295 (see "Round 0" below).
1. `CLAUDE.md` — the owner's decisions and the traps that already cost days. **New 2026-09-14:
   the company theme, Educate → Build → Earn**, in the mission section, with the rule that "Earn"
   describes capability and never a promise. The school does not pause for the hackathon; the Hub
   sits on top of a live school. A reviewer without it
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

## Round 0 — DELIVERED (2026-09-13). Folded into roadmap revision 2.

Your Round 0 findings were adopted: the centerpiece confirmed, settlement rules tightened into
Addendum B, every promised test assigned or deferred, W4/W5 cut, the demo retargeted at the Hub
story, a validation deliverable added, the concurrency claim corrected, and a feature freeze plus
a phone rehearsal put before the recording slot. Two of your corrections are now load-bearing:
prior multi-tool entries *have* placed, so the single-mechanism lead is a positioning judgement
rather than a law; and a program hash served by the same server that computes the payout is
reproducible, not independently verified, so the public wording stays "reproducible from the
published inputs" until Addendum B §B5's witness exists.

## Round 1 — the window is open (from 2026-09-14 13:00 UTC, 06:00 PT — Official Rules §5)

**State as of 2026-09-14.** The window opened; the pre-event snapshot is recorded (`main` at
`75b69cc`, `develop` at `41d0a6a`, marker branches `snapshot/pre-colosseum-2026-09-14-*`) and
`docs/PRE_EVENT_STATE.md` is the disclosure. Open PRs:

- **#298 — buy-comp hold check: a lock is not a sell.** CI green. A Jupiter Lock escrow is a PDA
  and therefore off-curve, so the hold check scored every lock as a pool sale and would have
  disqualified anyone who locked during a competition window. Destinations are now resolved to
  their owning program and split three ways.
- **#299 — roadmap revision 3, the company theme, and Hub design Addendum C.**

**What we want reviewed now, ranked:**

1. **#298 is a money path** — it decides who is eligible for a prize. Is the three-way
   classification right? The conservative fallback treats an *unresolved* off-curve destination as
   a pool sale; is that the correct default, or does it hide a different false positive? Is one
   batched `getMultipleAccounts` per call the right cost/correctness trade?
2. **Addendum C (design doc).** The claim is that it needs **no schema change** a day before the
   Sep 16 freeze. Check that: is every one of the six answers genuinely derivable from §2
   entities, or does one of them smuggle in a field? The APR refusal in C3 is deliberate — argue
   it if you disagree.
3. **Roadmap revision 3's four gaps** — traction (W9), weekly updates (W10), the dry-run project
   promoted to a dated blocker, and the real-wallet smoke pulled forward. Is W9 part 2
   ("create some usage") realistic in the time, or is it a wish?
4. **The traction instrumentation itself.** Personal earn (fewer losses because you learned) is
   not honestly measurable; program earn (receipts) is. Is that split right, and is there a
   defensible metric for the first that we are missing?
5. **Anything in `PRE_EVENT_STATE.md` that reads as a claim on pre-window work.** This is the
   failure mode with the worst penalty. Be pedantic here.

Findings, not rewrites. "Reviewed, no issue" on a money path is a real answer.

## Open questions the owner would like your opinion on
- Is lock-to-earn on Jupiter Lock the right headline mechanism for a Consumer Apps entry, or is
  the read-only engine dashboard a stronger single story?
- Server-side pass enforcement versus the previous client-only gate: is the fail-open rule the
  right default for a product that promises "learning and safety stay free"?
- The traction table now leads with visitors and learners and labels CLKN's own locks as ours.
  What would you cut or add before a judge reads it?
