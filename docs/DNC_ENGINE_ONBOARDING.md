# DNC — liquidity engine onboarding (scoping)

**Status: PREP ONLY. Nothing is live.** The project record exists but is inert; no operator
wallet, no funds, no pools, no scheduler. Activating requires an owner decision plus a Railway
env var only the owner can set.

Written 2026-08-26 after the owner named DNC as the next liquidity-engine project ("like we did
POKEAHOE"). This captures what was measured, what is already wired, and the questions whose
answers are the owner's — not assumptions to build on.

---

## The token, as of 2026-08-26

| Fact | Value |
| --- | --- |
| Mint | `42HsffEQoHqWoeiffksYayC75fQDxaoUdMBzmeXdpump` |
| Name / symbol | Diamond Nutted Chads / DNC |
| Decimals | **6** (pump.fun mint — not the 9 that CLKN uses) |
| Supply | 955,010,388.7 |
| Mint authority | none (revoked) |
| Freeze authority | none (revoked) |
| Token program | legacy SPL (no Token-2022 extensions) |
| Holders | ~302 |
| Displayed mcap | ~$279k |
| Jupiter tag | `launchpad`, `unknown` — **not verified**; organic score **low** |

Revoked mint and freeze authorities are the two that matter for safety: no new supply can appear
and no wallet can be frozen. Verified on-chain, not taken from an aggregator.

### Existing liquidity

| Venue | Pair | Liquidity | 24h volume |
| --- | --- | --- | --- |
| PumpSwap | DNC/SOL | ~$47.9k | ~$1,014 |
| Meteora | DNC/PEPE | ~$1.54 | ~$0.02 |

Jupiter's own liquidity figure is ~$23.9k (it counts differently — see the ratio note below).

### Baseline trade impact (measured, before any engine work)

- $1k **buy**: 4.3%
- $1k **sell**: 1.8%

That asymmetry is the interesting part: the buy side is more than twice as expensive as the sell
side, so a buyer moves price far more than a seller does. Deepening the ask side is where the
first dollar of engine work pays.

---

## What the CUNA campaign taught that applies here

These were learned the expensive way over 2026-08-25/26 and are why this onboarding should be
assembly rather than research:

1. **Only USDC/USDT/SOL quote-side counts toward Jupiter's Liq/MC ratio.** Token-paired
   liquidity (DNC/PEPE here) counts for nothing on that metric, however real it is. DNC's
   PumpSwap pool is SOL-quoted, which does count.
2. **Never create a pool at an aggregator's price without checking it live.** Jupiter serves a
   *frozen* price for unverified tokens; a pool opened off-market is free money for arbs the
   moment liquidity lands. `create-pool` takes a `&price=` override for exactly this — CUNA's
   was 31% stale.
3. **Never deploy inventory across a price gap between our pools and the market.** ~$16 went to
   arbs learning this.
4. **Tight bands are the volume/impact posture; wide bands are the survive-unattended posture.**
   CUNA at ±10 measured ~3.7% impact; the same dollars at ±3.5 measured ~1.6%. Tighter also
   means more frequent re-centering rolls.
5. **Two independent metrics, two different fixes.** Ratio dollars come only from adding hard
   quote; impact comes from concentration. Adding narrow-band liquidity fixes impact without
   moving the ratio, and vice versa.
6. **A boot ratchet asserts each project's shape on every deploy.** Any hand-tuned config is
   reverted on restart unless the ratchet knows about it — see `cunaConfigRatchet` in
   `server.js`. DNC will need its own, or its config must live in the ratchet's data.

---

## What is already wired (no new code needed)

- **Project record** — registered as `dnc`, venue `orca`, decimals 6, quotes USDC + WSOL,
  `active: false`. Every vault route accepts `?project=dnc`.
- **Per-project isolation** — own kv namespace for config and state, own operator env var
  (`MM_OPERATOR_SECRET_DNC`), own optional Telegram room, own pause switch.
- **The engine itself** — balanced base position, SOL sleeve, anchors, buyback, add/remove
  liquidity, pool creation at a checked price. All project-scoped.
- **Guards that stay on** — the vault refuses to sell a project's own token unless a code-level
  carve-out names that project (`SELL_CLIP.projects` currently lists CUNA only), and the price-gap
  guard sits out cycles when a pool is far from market.

**The one hard gate:** with no `MM_OPERATOR_SECRET_DNC` set in Railway, every DNC engine call
returns `enabled: false` and does nothing. That is the safety property that makes this prep
harmless.

---

## Open questions — owner's call, not to be assumed

1. **What was actually agreed with the DNC team?** Scope, duration, who supplies liquidity, what
   we get. Nothing gets built past this doc until that is stated. (A reply is not a scope — same
   rule as Nomadz.)
2. **Whose wallet operates it?** POKEAHOE's carve-out let the engine sign with a treasury key,
   which was an explicit owner override. Default preference is a dedicated operator wallet
   holding only that project's float.
3. **Whose inventory?** DNC tokens and quote (SOL/USDC) both have to come from somewhere, and
   the split determines what the engine can hold up.
4. **Which pools?** The existing venue is PumpSwap, which this vault does not manage. Options:
   (a) create our own Orca pools as CUNA did, (b) manage only what we create and leave PumpSwap
   alone. Fee tier and width follow from the goal — verification posture or volume posture.
5. **Which carve-outs, if any?** Buyback on/off, sell-clip on/off. Both default to off, and
   sell-clip additionally requires DNC to be added to the code allowlist.
6. **Their own Telegram room?** The project record supports one; alerts otherwise land in the
   default operator chat.

---

## Activation checklist (when the owner says go)

1. Owner states the agreed scope.
2. Owner creates the operator wallet, funds it, sets `MM_OPERATOR_SECRET_DNC` in Railway.
3. Set `active: true` and the project config: pair, fee tier, widths, caps, thresholds.
4. Add a DNC entry to the boot ratchet so deploys stop reverting the config.
5. Verify the live price against a fresh Jupiter quote; create pools with `&price=` if needed.
6. Deploy inventory in one pass — never across a gap.
7. Measure $1k impact both ways before and after; that pair of numbers is the scoreboard.
8. Arm the engine, then watch a full tick cycle before walking away.
