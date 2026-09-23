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

Split out of `AGENTS.md` on 2026-09-23. Loads automatically for any session touching the
liquidity-engine or CUNA lock-to-earn code. **The posture itself — WATCH-ONLY, no engine runs, the
brand-bag carve-out, the rebalancer hard-kill, read balances on-chain, the treasury and
canonical-chart addresses — stays in `AGENTS.md` ("Money: what you may and may not touch") and
loads for every session.** This file carries only the implementation traps below, unedited.

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
