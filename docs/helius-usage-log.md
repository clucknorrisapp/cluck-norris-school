# Helius credit usage — daily tracking

**Plan:** 10,000,000 credits / month (Helius **Developer** tier).
**Upgraded Free (500k/mo) → Developer (10M/mo) on 2026-06-08.** The readings below were
captured earlier the SAME day while still on the FREE tier — whose ~500k/mo (~16.7k/day,
**~11.6/min**) budget the burn was well over, which is what tripped the credit cap that took
on-chain reads offline and motivated the failover layer (`lib/rpc.js`). From the upgrade
forward the 10M budget applies; the %-of-budget figures in the table are what each measured
rate means against the new 10M plan.
**Break-even budget (10M plan):** ~333,000 / day · ~13,900 / hour · **~231 / min** sustained.
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
| 11:23 | 22,827 | +12,266 | 113 | ~109 | ~157k | **47% of budget — under.** Nearly 2h window, cold-boot noise washed out → steady-state settling lower than the 09:30 reading, as expected. |
| 12:53 | 27,770 | +4,943 | 90 | ~55 | ~79k | **~24% of budget — well under.** Steady-state still dropping as boot/test noise fully clears; clean background burn ~55/min. |

_Each new reading: Δcredits ÷ Δmin = current background rate. Compare to the 231/min line._
