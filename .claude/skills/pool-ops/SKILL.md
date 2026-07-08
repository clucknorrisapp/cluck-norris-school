---
name: pool-ops
description: Safely read, tighten, widen, close, or redeploy the CLKN Orca liquidity pools (treasury wallet). Use for any owner ask that moves LP positions — "tighten pools", "pull the pools", "redeploy at ±X%", "check pools".
---

# Pool ops — the verified ritual (treasury project)

⛔ **PLAN ≠ EXECUTE:** for anything fund-moving, state the exact plan (pools, amounts, widths)
and STOP until the owner replies with an explicit go. Reads are always fine.
⛔ NEVER sell CLKN. NEVER buy CLKN without an explicit owner ask in that moment.
⚠️ ALWAYS pass `project=treasury` — omitting it targets the CLKN engine project instead.

All endpoints gated with `&key=$PREMIUM_ACCESS_KEY`, base `https://clucknorris.app`.

## Read (always start here)
- Status/config/float: `GET /api/whirlpool/vault/status?key=…&project=treasury`
- Positions: `GET /api/whirlpool/positions?key=…&owner=2zMCUkE9pBjcC7ihtLqm28EsCoEHVmCdJYr5262EuPy8`
  (⚠️ the param is `owner=` — `wallet=`/`address=` return "Invalid wallet address")
- Per position compute: half-width % = `(upperPriceClkn−lowerPriceClkn)/2/currentPriceClkn·100`;
  <10% = tight position, >100% = permanent wide anchor (NEVER touch anchors ~$60-80 each).
- Wallet balances: on-chain only via `/api/helius-rpc` (both token programs) — never forensic tools.

## Retune width (close → reopen, per pool, one at a time)
1. Set config: `POST /vault/config?key=…&project=treasury` body `{"widthPct":X,"solWidthPct":X,"jupWidthPct":X}`
2. Close the tight position: `GET /vault/close-position?key=…&project=treasury&mint=<positionMint>&run=1`
3. Wait ~6s, re-read status; confirm freed tokens landed in `float` (a "failed" call may have EXECUTED — status first, never blind-retry).
4. Dry-run the reopen: `GET /vault/open-anchor?key=…&project=treasury&quote=SOL|USDC|JUP&usd=<clknSideUsd>&down=X&up=X`
   — `usd` sizes the CLKN side; `est.maxQuote` shows the quote it will pull. Size so maxQuote ≤ float
   (leave ≥0.35 SOL gas). Symmetric retune at same center = ~50/50 redeposit, NO swap needed.
5. Execute with `&run=1` → returns `positionMint` (auto-PINNED in anchorMints; automation can't adopt it).
6. Verify: re-read positions — width correct, `inRange`, price ~50% in band. Then re-baseline:
   `GET /vault/lp-vs-hodl?key=…&project=treasury&reset=1`

## Full pull / redeploy
Same ritual: close tights one at a time (keep the wide anchors — they keep pools quoted so price
never dislocates), verify float on-chain, then reopen per the owner's widths.

## Invariants after ANY op
- Vault stays **paused** unless the owner explicitly says resume (`/vault/pause|resume?…&project=treasury&run=1`).
- The wpTightOorTick alert (server.js) DMs the PRIVATE treasury chat, loud, on OOR — leave it alone.
- Report the final table (pool, mint, width, $, in-range) to the owner; update CLAUDE.md's engine
  status banner if the structure changed.
