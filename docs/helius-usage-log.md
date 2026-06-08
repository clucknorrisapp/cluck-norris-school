# Helius credit usage — daily tracking

**Plan:** 10,000,000 credits / month.
**Break-even budget:** ~333,000 / day · ~13,900 / hour · **~231 / min** sustained.
Stay under these and we're within the 10M monthly plan.

> NOTE: the burn optimizations — vault tick **3m → 10m** + **shared per-tick position read**
> (~15× less vault RPC) — deployed ~09:00 CT on 2026-06-08. The cumulative counter before the
> 09:19 anchor includes pre-optimization burn, the post-upgrade catch-up, a USDC→SOL swap, and
> Claude-session testing — so the **clean optimized background rate is measured from 09:19 forward.**

## Readings (Central Time, 2026-06-08)
| Time (CT) | Cumulative | Δ credits | Δ min | rate (cr/min) | projected/day | notes |
|-----------|-----------:|----------:|------:|--------------:|--------------:|-------|
| 09:19 | 8,982 | — | — | — | — | baseline anchor (optimizations live; Claude testing stopped) |
| 09:30 | 10,561 | +1,579 | 11 | ~144 | ~207k | **62% of budget — under.** Window included Claude git pushes → redeploys (cold-cache boot ticks), so true steady-state is likely lower. |

_Each new reading: Δcredits ÷ Δmin = current background rate. Compare to the 231/min line._
