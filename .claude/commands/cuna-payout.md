---
description: Weekly CUNA lock-to-earn payout batch — read-only by default. Pass "go" to allow the send and sweep steps.
argument-hint: [go]
allowed-tools: Bash
---

⛔ **PLAN ≠ EXECUTE for money** (AGENTS.md "Working agreement"). For anything that moves funds:
state the exact plan and STOP. Execute only on an explicit go. An owner message describing intent
opens a discussion, not authorisation.

Source: `docs/CUNA_STAKING_RUNBOOK.md` "Server-signed send (2026-09-16)".

The admin key goes in the `x-premium-key` **header**, never the query string (a `?key=…` on the
URL lands in shell history and server logs).

## Always: read the ledger first

```
curl -sS -H "x-premium-key: $PREMIUM_ACCESS_KEY" "https://clucknorris.app/api/cuna-stake/payout"
```

Print: total owed, the wallet count, the last batch (id + when), and days since the last payout.
This is a read; run it regardless of `$ARGUMENTS`.

## Step 1 — export (build the batch)

```
curl -sS -X POST -H "x-premium-key: $PREMIUM_ACCESS_KEY" "https://clucknorris.app/api/cuna-stake/payout?export=1"
```
Note the returned batch id.

## Step 2 — dry run

```
curl -sS -X POST -H "x-premium-key: $PREMIUM_ACCESS_KEY" "https://clucknorris.app/api/cuna-stake/payout?send=<id>"
```
(POST without `run=1` — a GET with `send=` is 405.) Report payer balance, caps, and the would-pay
rows.

## Step 3 — independent verification

```
node scripts/cuna-payout-verify.cjs https://clucknorris.app "$PREMIUM_ACCESS_KEY" <batchId>
```
This is INDEPENDENT of the page's own checks — it recomputes from scratch and reports non-zero on
any problem: line items not summing, an excluded wallet in the batch, a recipient with no live
CUNA lock, duplicates. Report its exit code and full output.

## STOP HERE unless `$ARGUMENTS` is literally `go`

If the command was invoked with anything other than the literal argument `go`, stop after step 3
and report the plan: the batch id, the total, the wallet count, and what step 4 would do. Do not
proceed.

---

**Only past this point if invoked as `/cuna-payout go`:**

## Step 4 — send

```
curl -sS -X POST -H "x-premium-key: $PREMIUM_ACCESS_KEY" "https://clucknorris.app/api/cuna-stake/payout?send=<id>&run=1&from=treasury"
```
Railway signs; `sendReport` carries every signature.

## Step 5 — sweep (settle anything left pending)

```
curl -sS -X POST -H "x-premium-key: $PREMIUM_ACCESS_KEY" "https://clucknorris.app/api/cuna-stake/payout?sweep=1&batch=<id>"
```

## Confirm on chain

For every signature in `sendReport`, confirm it independently — don't trust the route's own
"sent" status as proof of landing:
```
curl -sS -X POST https://clucknorris.app/api/helius-rpc \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getSignatureStatuses","params":[["<sig1>","<sig2>"]]}'
```

## Report

Batch id, total paid, every signature and its confirmed status, and anything that landed in
`pending` (not yet confirmed) or was voided.
