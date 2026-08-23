# CUNA volume engine — runbook

**Status: WIRED AND DISARMED.** The code is deployed but the engine does not trade.
Going live is one Railway env var. Nothing in this document has been executed.

Owner brief (2026-08-23): CUNA lost its Jupiter organic score, the Express-verification
retry lands within ~24h, and the plan is the POKEAHOE playbook — tight 0.01% Orca pools
that recenter often and let arbitrage generate the volume — but at **±2.5% instead of
±1%**, because CUNA is volatile enough that ±1% would sit out of range more than in it.

---

## Arming and stopping

| Action | Lever |
|---|---|
| **Go live** | `CUNA_ENGINE_ON=1` in Railway |
| Hard override (wins over ON) | `CUNA_ENGINE_OFF=1` |
| Instant stop, no deploy | `/api/whirlpool/vault/pause?project=cuna` |
| Retune anything | `/api/whirlpool/vault/config?project=cuna&<key>=<value>` |
| Inspect before arming | `/api/whirlpool/vault/status?project=cuna` |

The project registers at boot even while disarmed, so the config can be reviewed before
anything is armed. Registration is pure KV — no chain calls, no signing. That is safe
because the multi-tenant vault scheduler runs through `liqInterval`, a no-op while
`LIQ_ENGINE_KILLED` is true; only the scoped tick can trade this project.

**Verified:** with no operator key present, `rebalancePools` / `tick` / `tickSol` /
`buyback` all return `"none"`. Arming without funding the wallet is a safe no-op.

---

## The operator wallet — decide this before arming

The default is a **dedicated wallet**, `MM_OPERATOR_SECRET_CUNA`. Override with
`CUNA_OPERATOR_ENV` if you want a different one. Two reasons not to reuse the treasury:

1. **POKEAHOE already runs on the treasury** (`2zMCU…EuPy8`) with live caps
   `maxUsd: 99999`, `usdcFloor: 0`, `deployFrac: 0.97`, ticking every 2 minutes. USDC and
   SOL deposited there for CUNA would be pulled into the POKE pools before the CUNA engine
   ever saw them. (POKE is currently paused — but pause is one call from being undone.)
2. **The treasury is CUNA's mint authority** (`scopes:["full"]`). `CLAUDE.md` says the MM
   operator must never be the treasury or a mint authority. POKEAHOE has an explicit owner
   override for the treasury part; the mint-authority overlap is new and worse.

A dedicated wallet holding only the float fixes both, and satisfies the owner's
"we don't touch any other tokens from other projects" constraint by construction.

---

## Funding

Owner's sizing: **~$200 USDC + ~$200 SOL + ~$400 CUNA in play**, split evenly so each pool
holds ~$200 CUNA against ~$200 of quote.

At **SOL $95.62** and **CUNA $0.00001554** (2026-08-23):

| Asset | Deploy target | Fund this much | Why the difference |
|---|---|---|---|
| USDC | $200 | **$205** | `usdcFloor: 5` is never deployed |
| SOL | $200 ≈ 2.09 SOL | **≈ 2.35 SOL** | `solGasReserve: 0.25` for gas + position rent |
| CUNA | $400 ≈ 25.7M CUNA | **≈ 26M CUNA** | ~$200 per pool |

For reference the treasury currently holds ~60.8M CUNA (~$946), so the CUNA side can be
funded from there without buying any.

---

## Config as seeded

Both pools: **0.01% fee tier, ±2.5% band**, recentering when price reaches 30% of the way
to an edge (≈0.75% move) — that is what converts volatility into rolls, and rolls into volume.

| | Base (CUNA/USDC) | SOL (CUNA/SOL) |
|---|---|---|
| Fee tier | 0.01% | 0.01% |
| Width | ±2.5% | ±2.5% |
| Cap | `maxUsd: 250` | `solMaxSol: 2.5` |
| Deploy threshold | $25 free USDC | 0.2 SOL |

Guards: `priceGapGuardPct: 25` (skip a tick on a >25% gap — the book is only ~$7.3k, so a
spike is as likely to be someone pushing it as real price), `slippageBps: 250` (150 would
fail fills on a book this thin), `minRebalanceIntervalSec: 300`, `maxActionsPerDay: 96`.

**Never sells CUNA.** The swap layer is SOL↔USDC only, keeping the two pools even so they
arb against each other. Buyback (`maxBuybackUsdPerCycle: 50`, 12/day) only ever *buys* CUNA
with excess USDC. The only CUNA that leaves is what the pools' ask side sells into genuine
buying — which is what quoting a market means. Net CUNA sold should sit near zero over a
full cycle.

**Off for now:** ask wall, cbBTC, dual sleeve, and the **JUP pool** — owner: "may scale out
and then add a Jupiter pool if needed". Adding it later is a `quoteMints` append plus
`jupEnabled: true`, mirroring the poke ratchet.

**Alerts** bind to the treasury's private ops room and the code *refuses* to bind to the
public CUNA community chat (`-1003938497778`) — on 2026-08-20 a poke ops overview briefly
posted to a community room and had to be deleted.

---

## Interaction with the CUNA giveaway

The giveaway tracker is **mint-scoped, not pool-scoped** — it discovers pools via
DexScreener + `getTokenLargestAccounts`, so **new engine pools are scanned automatically**.
Being small does not keep trades out of it. Also note the $4.75 threshold applies to *buys*
only: **sells have no minimum**, and any sell disqualifies a wallet.

Three things contain this:

- **The scan ceiling is `min(now, endMs)`.** After the window closes the tracker stops
  looking entirely, so engine activity after that is invisible to it.
- **The engine's wallet is excluded** — PR #128 filters it from the board, the draw, and the
  published entry list. If a shared wallet is used, that exclusion is load-bearing.
- **Arb bots self-disqualify.** Anything that round-trips is DQ'd by its first sell. Only a
  buy-and-hold-through-the-window wallet keeps entries, which is not arb-bot behaviour.

**The one residual risk to real participants:** the tape pages to `maxSigs: 900` per
10-minute slice. CUNA does ~259 txns/24h today and `capHits` is 0. Multiply volume 10–50×
and a slice could exceed 900, at which point trades are dropped and **genuine community
buyers silently lose entries**.

**Cheapest mitigation by far: do not arm the engine until the giveaway window has closed.**
Zero overlap, zero pollution. If it must run during the window, drop `SLICE_MS` in
`lib/cuna-giveaway.js` from 10 min to 2 min and watch `capHits` in the admin payload.

---

## Go-live checklist

1. Decide the operator wallet (dedicated recommended); set `MM_OPERATOR_SECRET_CUNA`
2. Fund it: ~$205 USDC, ~2.35 SOL, ~26M CUNA
3. Confirm the giveaway window has closed (or accept the cap risk above)
4. `GET /api/whirlpool/vault/status?project=cuna` — check operator pubkey and caps
5. Set `CUNA_ENGINE_ON=1` → redeploy
6. Watch the log for `[cuna] CUNA engine ARMED`, then the first roll ~25s later
7. Watch `capHits` on the giveaway admin endpoint if the window is still open

## What to watch once live

- Pool count on DexScreener should go 1 → 3 as the two engine pools index
- Volume and unique-trader count are the metrics Jupiter's organic score reads
- Crystallized IL is expected and accepted — the brief is volume
- If price runs hard, the ask side converts CUNA to quote; buyback pulls it back
