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

⚠️ **This command is read-only by default.** `POST ?export=1` (Step 1) is not a preview — it
creates a DURABLE pending batch and moves those amounts out of "owed" (`docs/CUNA_STAKING_RUNBOOK.md`).
So it never runs without the literal `go` argument. Everything below the STOP line is a plain read.

## Always: read the ledger, and preview the payout lines — both plain GETs, no `$ARGUMENTS` gate

```
curl -sS -H "x-premium-key: $PREMIUM_ACCESS_KEY" "https://clucknorris.app/api/cuna-stake/payout"
```
Print: total owed, the wallet count, the last batch (id + when), days since the last payout, and
the response's own `previewLines` — a preview of what a batch would pay right now, computed
without exporting one (`docs/CUNA_STAKING_RUNBOOK.md`, the payout console's step 1: *"Preview —
what is owed right now, and a preview of the payout lines. Changes nothing."*).

```
curl -sS -H "x-premium-key: $PREMIUM_ACCESS_KEY" "https://clucknorris.app/api/cuna-stake/admin" | jq '.wouldPay, .eligible'
```
Also a plain GET (`docs/CUNA_STAKING_RUNBOOK.md`: *"Preview what a day would pay. Writes nothing —
plain GET."*) — today's accrual eligibility, for context on what is still landing before any batch
is built. Run both regardless of `$ARGUMENTS`; neither writes anything.

## STOP HERE unless `$ARGUMENTS` is literally `go`

If the command was invoked with anything other than the literal argument `go`, stop here and
report the plan from the two reads above: total owed, wallet count, last batch, days since, and
the preview lines. Do not export a batch. Do not proceed to Step 1 below.

---

**Only past this point if invoked as `/cuna-payout go`:**

## Step 1 — export (build the batch)

```
curl -sS -X POST -H "x-premium-key: $PREMIUM_ACCESS_KEY" "https://clucknorris.app/api/cuna-stake/payout?export=1"
```
Note the returned batch id. This is the first mutating call — it holds the owed amounts aside so
a second export cannot offer the same money twice.

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

⛔ **If the verify script exits non-zero: STOP here and report it. Do not proceed to Step 4 — do
not send.** The batch stays exported and pending; fix the underlying problem (or ask the owner)
before trying again.

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
