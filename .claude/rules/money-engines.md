---
paths:
  - "lib/whirlpool-*"
  - "lib/orca-*"
  - "whirlpool-mm.js"
  - "lib/engine-decisions.js"
  - "lib/cuna-*"
  - "scripts/engine-sim-test.cjs"
  - "docs/CUNA_STAKING_RUNBOOK.md"
---

# Money-engine traps

Moved verbatim from `AGENTS.md` (2026-09-23 split). Loads automatically for any session touching
the liquidity-engine or CUNA lock-to-earn code. Text below is unedited — see `AGENTS.md` for the
sections that stayed there.

## Money: what you may and may not touch

The owner manages all liquidity positions **manually**. Read freely; touch nothing.

- ⛔ **WATCH-ONLY.** Don't rebalance, recenter, close, redeploy, add/remove liquidity, or
  buy/sell CLKN. Don't "take over." Observe and log.
- ⛔ **NO LIQUIDITY ENGINE RUNS FOR ANY PROJECT (owner, 2026-09-05: "none of the liquidity
  engines should be running for any project").** The live vault flag reads `paused:true` for all
  five projects (poke/cuna/dnc/rose/treasury) and survived three redeploys that day. The scoped
  `poke` engine in server.js — the one carve-out from watch-only granted 2026-08-19 (two Orca
  0.01% POKEAHOE pools at ±1% for VOLUME, signing with `MM_OPERATOR_SECRET_TREASURY`, touching
  POKEAHOE/USDC/SOL only) — is **OFF BY DEFAULT in code since 2026-09-05** (owner: "flip the code
  default to off too"). It registers its scheduler only with `POKE_ENGINE_ON=1` in Railway, set by
  the owner in the moment; `POKE_ENGINE_OFF=1` still wins as a kill; the project's own `paused`
  flag is a second, independent stop. Do not resume, un-pause, arm, or widen any engine without an
  owner ask in that moment — an intent statement is a discussion, not a go. Instant stop if one is
  ever running: `curl -X POST 'https://clucknorris.app/api/whirlpool/vault/pause?project=poke&key=…'`
  — the route is **POST-only**, so a browser hit or a bare `curl` (GET) falls through to the
  `/api/*` catch-all and returns `not_found`, which looks like "endpoint gone" in the middle of a
  stop. The 2026-08-31 recoup-baseline carve-out below is unchanged but moot while nothing runs.
- ⛔ **The brand bag is protected — with ONE owner-defined carve-out (2026-08-31).** The original
  bag is never sold. But the owner revised the blanket rule: a tight-quoting engine that ABSORBS
  someone's sell may sell that absorbed inventory back to recoup its quote funds ("those sells
  would show up on the chart anyway — it's only fair we recoup as our base funds for volume").
  Mechanism: `POST /api/whirlpool/vault/recoup-baseline?project=…&arm=1` snapshots current holdings as
  a protected baseline; `manualSwap` then allows selling ONLY the amount above it. Disarmed +
  baseline-less = the historic never-sell behavior, and that is the default everywhere. Also:
  **never buy CLKN with operator funds** without asking in that moment (owner rule, after
  unwanted inventory buys).
- ⛔ **The autonomous rebalancer is hard-killed in code** (`JUP_AUTO_REBALANCE_KILLED = true`).
  Re-enabling is a deliberate two-step opt-in. Don't, without an explicit ask.
- **Read balances ON-CHAIN, never with the product tools.** `/api/wallet-xray` and autopsy are
  *activity scanners* — they undercount and miss holdings, and two wrong balance reports came from
  trusting them. Use `getTokenAccountsByOwner` (jsonParsed) for **both** token programs — legacy
  and Token-2022 — plus `getBalance`, POSTed to `/api/helius-rpc`.

Treasury wallet `2zMCUkE9pBjcC7ihtLqm28EsCoEHVmCdJYr5262EuPy8`. Canonical chart is the community
Meteora pool `64WXkHM4zyWUkYy32TfUeBV5wDAfdcUGDxe5ntM4xaTd`; engine pools are Orca. The venue
split is settled — don't re-debate it.

- **The engine boot ratchets re-assert per-project config on EVERY deploy** — a live config
  write silently reverts on the next push to `main` unless it was made with `&durable=1`
  (stored in kv `ratchetOverrides:<project>`, merged over the code defaults at boot, cleared
  by writing the key as null). This trap cost live tuning twice on 2026-08-28 before the
  override mechanism existed. ⚠️ Until the 2026-09-06 code batch only the `dnc` and `rose`
  ratchets merged the override table — `cuna` and `poke` answered `durable:true` and reverted on
  the next deploy anyway (audit #3); all four merge it now. Engine GATE logic is pure in `lib/engine-decisions.js` —
  changing a gate means updating `scripts/engine-sim-test.cjs` (CI runs it; each scenario is
  a real incident) and replaying it locally BEFORE shipping, not debugging in production.

- ⛔ **A vault `paused` flag FAILS OPEN, and a stale `lastTickTs` proves nothing.** `getState()`
  defaults to `{}` (`lib/whirlpool-vault.js` ~358), so a missing kv key reads as *not paused*; and
  `lib/kvstore.js` `mkdirSync`s `DATA_DIR` and reports persistent even when the volume is not the
  real one, so a bad mount looks healthy while every flag silently resets. cuna/dnc/rose arming
  used to fall back to `<X>_ENGINE_ON` env on kv loss the same way — **closed 2026-09-17 (deep dive
  P1-032): the kv arm key is the ONLY switch for cuna/dnc/rose, an absent key is OFF, and
  `<X>_ENGINE_ON=1` is inert (boot logs a warning if it is set)**. A durable stop is therefore an ENV
  VAR (`POKE_ENGINE_OFF=1`, `<X>_ENGINE_OFF=1`) or a code default, never a kv flag — which is why
  POKE's code default was flipped to off on 2026-09-05 (verified read-only by an adversarial pass
  that day: with the old default, a boot with an empty kv would have started POKE trading 20 s
  later, signing with the treasury operator key). Verifying a stop via `lastTickTs` is invalid:
  `tick()` returns on `paused` before writing it, so a registered scheduler no-oping every 2 min
  is indistinguishable from an unregistered one. Only `paused` + the env/code gate tell you anything.
  ⚠️ **A money journal that spans two kv keys (a batch's sent rows + the paid totals) is written with
  `kv.setManyVerified` / `hubStore.writeManyVerified` — ONE persist.** Two `setVerified` calls in a row
  left a crash window where a row was recorded sent with nothing in paid, and `owedNow` offered that
  money again (Codex, 2026-09-17). `owedNow` also treats a recorded sent row as settled on its own.
