# What the 2026-07-30 CLAUDE.md trim removed — and whether it mattered

Reconstructed 2026-08-01 from commit `e6825a8` ("CLAUDE.md: cut 81%, keep the mission and the
decisions").

Written because that commit deleted **1005 lines** and left behind only a one-line explanation
inside CLAUDE.md itself. An 81% cut with no record of *what* went is the kind of thing that reads
as reckless later, and the risk it carries is specific: that a live owner decision went out with
the dead history and nobody noticed for months. This note exists so that question has a written
answer instead of needing the diff re-read every time it comes up.

**Verdict up front: the trim was sound.** Almost everything it removed was dead, superseded, or —
in several cases — actively wrong. Two things are worth knowing about anyway; they are in §3.

---

## 1. What actually happened

| | |
|---|---|
| Commit | `e6825a8`, 2026-07-30 |
| CLAUDE.md | 1030 lines → 281 lines |
| Diff | 256 insertions, 1005 deletions |

It was a **rewrite, not a surgical trim**. Nearly every line in the file was touched, so a
line-level diff overstates the loss — most "removed" lines were re-said more briefly a few
sections away. The useful question is not which lines went, but which *topics* lost their
counterpart. Sixteen sections became twelve.

## 2. The part that justifies the whole cut

`docs/BRAND_AUDIT_2026-07-18.md` had already flagged the pre-trim CLAUDE.md for **doc drift** —
twelve days before the trim, and independently of it:

> *"CLAUDE.md still describes several as live"* … *"It still describes OOR alerts, Wallet Watch,
> and LP-vs-HODL DMs as live; all are killed. Silence from monitors currently means 'killed,' not
> 'fine' — dangerous given the owner's manual-redeploy posture."*

Confirmed still true in code today:

```
server.js:8217   const WALLET_WATCH_KILLED = true;
server.js:657    const LIQ_ENGINE_KILLED = true;
server.js:13218  const JUP_AUTO_REBALANCE_KILLED = true;
```

So the old file was telling sessions that killed systems were running, and that monitor silence
meant healthy. That is worse than saying nothing — it is the exact failure the trim's own
rationale names. The audit also caught it quoting locked-supply figures (19.14% / 28 escrows) that
were badly stale against live (41.07% / 53), with a warning never to copy them into public text.
The trimmed file quotes no such figures and tells you to probe the live endpoint instead.

That pattern repeats across the cut:

- **Hatchery pricing.** Old file hardcoded "0.1 SOL or 11,600 CLKN". New file says probe
  `/api/hatchery/config` and never hardcode, because it is computed live. Strict improvement.
- **CoinGecko.** Old: "REAPPLIED 2026-06-11 (awaiting decision)" with a request ID. Now correctly
  CLOSED after a third rejection.
- **Solana Foundation.** Old: "nothing has panned out." Now correctly CLOSED, denied 2026-07-31.
- **Audit status** (2026-06-10 review, ~19 lines of "already fixed" items) — historical record of
  closed work. Belongs in git, which has it.

## 3. What was genuinely lost

Only two items are both **still true** and **no longer written down anywhere a session will look**.

### 3a. Wallet Watch is private — no public surface ⚠️

The old file carried an explicit owner instruction (owner ask, 2026-07-10):

> *"Wallet Watch, a PRIVATE product test: NO public surface, don't link or mention it on the
> app/socials."*

The scheduled automation is hard-killed (`WALLET_WATCH_KILLED = true`), and the manual
`/api/wallet-watch?run=1&key=…` lever is deliberately left working for one-off owner use. Its
current public exposure is **zero** — nothing in `public/` or `src/` references it.

So the constraint is being honored by accident of the feature being dormant, not by anyone knowing
about it. It still binds: a session writing a tools roundup, an investor page, or promo copy from
a `grep` of the endpoint list has nothing telling it this one is off-limits. **This is the one
piece worth putting back into CLAUDE.md.**

### 3b. The gated admin / test endpoint reference

~40 lines cataloguing the `?key=PREMIUM_ACCESS_KEY` endpoints went with the trim: `/api/tg-test`,
the seven `*-test` scheduled-post dry-runs, `/api/buy-replay`, `/api/reconcile-test`,
`/api/health-check`, `/api/grad-watch-status`, `/api/claims`, the whirlpool vault routes.

This is a **discoverability** loss, not a correctness one — every one of them is still findable by
grepping `server.js`, and the single most important rule attached to them (Telegram posts are
silent unless `&loud=1`) was explicitly kept. Not worth restoring in full; worth knowing it was a
deliberate drop rather than an oversight.

## 4. What was cut and correctly stays cut

- **Meteora ops learnings** (~25 lines: bin-step math, ±1–1.5% sweet spot, the "another
  fund-moving op is in flight probably means the first one is EXECUTING — check
  `/api/meteora/status` before retrying" trap). All of it presumes a session *executes* liquidity
  operations. The current posture is watch-only and owner-manual, so the trap can no longer be
  sprung by a session. The detail survives in `docs/LIQUIDITY_ENGINE.md` and
  `docs/LIQUIDITY_ENGINE_TODO.md` if the posture ever changes.
- **The removed-features postmortems** (Ultimate Challenge, Survival Simulator, Coop Spinner) —
  compressed into the "Removed — don't rebuild without an explicit ask" list, which preserves the
  operative instruction. The reasoning behind each is in git.
- **The send-to-unlock retirement narrative** — the owner's own framing survived nearly verbatim
  in "How access works". Correctly treated as load-bearing.
- **Graduation is a pure client assertion** — survived into "Open decisions". Still open, still
  spending treasury SOL per graduate.
- **`/api/helius-rpc` default-deny allow-list**, the autopsy `excludeSet` fix, the `/api/claim`
  score-ignoring invariant — all enforced in code, all verifiable by reading it. Documentation of
  a fixed bug is history, not instruction.

## 5. If you are doing this again

The trim's own stated principle held up, and is worth restating: **a stale instruction stated with
authority is worse than no instruction.** The failure mode it was correcting is real and had
already been caught by an audit.

The one thing to do differently: when a cut removes a *constraint* (§3a) rather than a *fact*,
carry the constraint forward even if the feature it guards is dormant. Facts can be re-derived
from code. Constraints cannot — they only exist because someone said so.
