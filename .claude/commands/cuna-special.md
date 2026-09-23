---
description: CUNA buy special / giveaway admin — setup, status, close, or the draw+payout preview. The draw and the real payout are the owner's own acts.
argument-hint: <setup <start> <end> <holdend> <minUsd> <displayUsd> | status | close | draw>
allowed-tools: Bash
---

⛔ **PLAN ≠ EXECUTE for money** (AGENTS.md "Working agreement"). The draw and the real payout move
prize funds — state the exact plan and STOP; execute only on the owner's explicit go.

Source: `server.js` (search `app.all("/api/cuna-giveaway/admin"`) and `lib/cuna-giveaway.js`
`configure`/`resetLedger`.

**Every write on this route is a POST — a GET answers 405.** The admin key goes in the
`x-premium-key` header. `minUsd` is what SCORES a buy; `displayUsd` is what the copy SAYS (they can
differ on purpose — e.g. scored $2.5 vs shown $3 since 2026-09-23, so a fee-shaved $3 buy still
counts).

Dispatch on `$ARGUMENTS`:

## `setup <start> <end> <holdend> <minUsd> <displayUsd>`

1. Reset the ledger (keeps config):
   ```
   curl -sS -X POST -H "x-premium-key: $PREMIUM_ACCESS_KEY" "https://clucknorris.app/api/cuna-giveaway/admin?reset=1"
   ```
2. Configure the window and scoring:
   ```
   curl -sS -X POST -H "x-premium-key: $PREMIUM_ACCESS_KEY" \
     "https://clucknorris.app/api/cuna-giveaway/admin?start=<start>&end=<end>&holdend=<holdend>&min=<minUsd>&display=<displayUsd>"
   ```
3. Kick the scanner once:
   ```
   curl -sS -X POST -H "x-premium-key: $PREMIUM_ACCESS_KEY" "https://clucknorris.app/api/cuna-giveaway/admin?scan=1"
   ```
4. Post the board:
   ```
   curl -sS -X POST -H "x-premium-key: $PREMIUM_ACCESS_KEY" "https://clucknorris.app/api/cuna-giveaway/admin?board=1"
   ```

## `status`

Public read, no key needed:
```
curl -sS "https://clucknorris.app/api/cuna-giveaway"
```
Report the standings as returned.

## `close`

Final scan, then post the final board:
```
curl -sS -X POST -H "x-premium-key: $PREMIUM_ACCESS_KEY" "https://clucknorris.app/api/cuna-giveaway/admin?scan=1"
curl -sS -X POST -H "x-premium-key: $PREMIUM_ACCESS_KEY" "https://clucknorris.app/api/cuna-giveaway/admin?board=1"
```

## `draw`

⛔ **The draw and the payout are the owner's own acts.** Print the exact commands below and STOP —
do not run them:

```
curl -sS -X POST -H "x-premium-key: $PREMIUM_ACCESS_KEY" "https://clucknorris.app/api/cuna-giveaway/admin?draw=1&prizes=4000000,3000000,2000000,1000000"

curl -sS -X POST -H "x-premium-key: $PREMIUM_ACCESS_KEY" "https://clucknorris.app/api/cuna-giveaway/admin?holdcheck=1"

# preview (no run=1):
curl -sS -X POST -H "x-premium-key: $PREMIUM_ACCESS_KEY" "https://clucknorris.app/api/cuna-giveaway/admin?payout=1"

# real send — owner's go only:
curl -sS -X POST -H "x-premium-key: $PREMIUM_ACCESS_KEY" "https://clucknorris.app/api/cuna-giveaway/admin?payout=1&run=1"
```

Report the commands as text; do not execute the `draw=1` or `payout=1&run=1` calls yourself.
