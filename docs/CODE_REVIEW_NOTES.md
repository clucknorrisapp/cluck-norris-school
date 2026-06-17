# Code Review Notes

A running log of external code/security reviews, reconciled against the actual repo.
Each review is logged verbatim-in-spirit, then **fact-checked** — claims are marked
✅ confirmed, ⚠️ corrected/nuanced, or 📌 action item. Nothing here is implemented yet;
this is the triage backlog. Add new reviews as new `## Review N` sections.

---

## Review 1 — file-by-file external review (logged 2026-06-16)

### package.json
- ✅ Stack read is accurate: Vite + React 18, Zustand, Tailwind (devDep), Anchor, Metaplex
  (umi / mpl-token-metadata / **mpl-bubblegum**), Orca Whirlpools, Raydium SDK v2, Meteora
  DLMM + cp-amm, `@napi-rs/canvas`, axios, Express, react-router, lucide-react.
- ✅ cNFT diplomas claim is CORRECT — `lib/diploma-nft.js` mints compressed NFTs via
  Metaplex Bubblegum for graduates (merkle tree `maxDepth 14` ≈ 16,384 diplomas). Not dead weight.
- ✅ Secrets are env-var-based (Helius/Bags/Telegram/Solscan), never in code.
- ⚠️ **Raydium pinned to an alpha** (`@raydium-io/raydium-sdk-v2: ^0.2.50-alpha`) — pre-release
  dep in the on-chain money path. Make this a conscious decision (pin exact / track stability).
- 📌 Add a `lint` script (ESLint + Prettier).
- 📌 Add `npm audit` (and/or dependency-vuln scan) to CI. Today CI is only `node --check`.
- 📌 Deploy with `npm ci` off the committed lockfile (not `npm install`) for reproducible builds.
- 📌 Gradual TypeScript migration — start with the money libs (`solana-addr`, `sigstore`, vault),
  for types on addresses/amounts/lamports. (TS is currently devDep-only; app is JSX.)

### src/main.jsx
- ✅ Clean, minimal React entry with StrictMode. No action.

### src/App.jsx
- ✅ Strong educational content (Survival Simulator scenarios) — the real moat.
- ✅ `generateUnlockAmount()` unique-decimal approach + anti-tamper floor is sound; matches the
  on-chain, replay-guarded payment model. `CalcErrorBoundary` isolates calculator crashes.
- ⚠️ It's a single very large file (lessons, LP Lab, scenarios, unlock flow, Jupiter widget).
  Architecture smell, not a bug.
- 📌 Split into `components/`, `data/`(scenarios/lessons), `constants/`. Highest-leverage refactor.
- 📌 Add loading/skeleton states for async (Helius/autopsy) calls; add ARIA labels.
- 📌 (If/when TS) type wallet addresses + amounts in the unlock flow.

### Cross-cutting security themes (HIGHEST PRIORITY — bigger than App.jsx)
- 📌 **Supply chain → operator hot wallet is the top theft-class risk.** The autonomous vault
  signs with `MM_OPERATOR_SECRET` and the diploma minter signs cNFT mints, both through a heavy,
  fast-moving SDK tree (incl. a Raydium *alpha*). A compromised transitive dep could abuse a
  signing key. Mitigations: `npm ci` from lockfile, audit in CI, and the standing rule that the
  MM wallet holds **only float, never a mint authority** (blast-radius limiter — verify it holds).
- 📌 **XSS surface is the vanilla `public/*.html` tool pages, NOT App.jsx.** React auto-escapes,
  so "no obvious XSS" is right for App.jsx. The real surface is `autopsy.html`, `trace.html`,
  `wallet-xray.html`, etc., which build `innerHTML` from attacker-controlled token names/symbols.
  Convention is "escape with `esc()` first"; the 2026-06-10 audit claims trace/autopsy were fixed.
  → Re-verify `esc()` coverage across ALL vanilla pages that render token-supplied strings.
- ✅ Input validation confirmed good: `SOL_ADDR_RE` (from `lib/solana-addr.js`) used fail-closed
  at 20+ server call sites; `isOnCurve` does human-vs-contract classification.

---

## Review 2 — server.js deep dive (logged 2026-06-16)

### ✅ Confirmed accurate
- `publicErrMsg()` strips keys/URLs + truncates before reaching the client.
- Admin auth prefers `x-premium-key` header, `?key=` is the deprecated fallback (`adminAuthOK`).
- Secrets all env-var-based; gated admin/debug routes return **404 (not 401)** on auth fail.
- Exact-decimal CLKN unlock + anti-tamper floor check.
- **Server-side exam scoring + one-time pass tokens with TTL** — `examPassTokens` Map carries a
  `used` flag; the session is deleted on score so it can't be re-scored. Reviewer right that
  `examSessions`/`examPassTokens` are **in-memory Maps** (TTL-swept). Reset-on-restart is fine.
  Nuance: in-memory = per-instance; wouldn't share across horizontally-scaled instances.
- `SOL_ADDR_RE` validation + Bags proxy path-traversal guard (`..` check). rpc.js failover.
- No SQL/injection surface (kv + file store, no DB string-building). Accurate.

### ❌ CORRECTION — the headline "biggest gap" is wrong
- **"Rate limiting missing" is INCORRECT.** There's a hand-rolled **per-IP sliding-window**
  limiter (`rateLimit()`, server.js ~1615) applied globally + per-route:
  `/api/` 150/min, ask-cluck 15, lp-ask 12, **verify-clkn-payment 20**, classroom-exam 25,
  graduate-claim 6, classroom 30 — all per-IP/min, with an unbounded-growth sweeper. So payment
  polling AND the costly AI endpoints ARE throttled. The reviewer likely assumed "none" because
  there's no `express-rate-limit` dependency — it's custom, not a library.
- 📌 Residual that IS valid: it's **in-memory / per-instance** (not Redis-backed) — only matters
  if scaling to multiple instances. And it keys on `req.ip` / `x-forwarded-for`, so confirm
  `app.set('trust proxy', …)` is configured for Railway so the key is the real client IP (and
  XFF can't be spoofed to dodge the cap).

### 📌 Valid action items (still stand)
- **CORS `*`** confirmed on many public routes (~1672+). Low risk here: those are public,
  unauthenticated, no-cookie JSON/proxy reads, and the admin/fund routes are header-key-gated
  (not cookie/session-based), so CORS isn't the auth exposure. Scoping `*` to known origins where
  feasible is hardening, not a hole.
- Modularize server.js into route files (echoes Review 1's size concern).
- Structured logging (Pino/Winston) + request IDs.
- `/health` (or `/ready`) endpoint — none found; low priority, handy for Railway monitoring.
- Startup **env-var validation** (zod/envalid) — would surface silent no-ops like the
  `TELEGRAM_BOT_TOKEN`+`TELEGRAM_CHAT_ID` boot gate that disables the whole scheduler block.

### Verdict
Reviewer's safety-mindset assessment is fair and most specifics check out. The **one claim to
disregard is "no rate limiting"** — it exists, per-IP, including on payments and AI.

---

## Review 3 — lib/rpc.js + lib/solana-addr.js (logged 2026-06-16)

Most positive review so far; spot-checked the concrete claims and they hold up.

### lib/rpc.js — ✅ confirmed
- **`sendTransaction` treated as non-idempotent** — `NON_IDEMPOTENT_METHODS = {sendTransaction}`
  (line 82); for writes only `res.status === 429` is retriable, reads retry 408/425/429/5xx
  (`isRetriableStatus`, lines 110/140). Exactly as the reviewer described.
- **DAS / Helius-only methods never fall through** to a non-Helius backup (line 124 + the
  `getAsset*` allow-set ~74) — avoids misleading "method not found" from generic nodes.
- No keys logged; public node is last resort; fixed small endpoint list (no DoS loop).
- 📌 **Valid recs (genuinely absent today):** there is **no inter-retry delay** — failover advances
  immediately with no jitter/backoff, so "add jitter + exponential backoff" and "circuit breaker /
  short-lived health cache for dead endpoints" are real improvements, not already-present.
- 📌 Also valid: surface which endpoint succeeded + retry count for debugging; document the env
  vars (`HELIUS_API_KEY`, `HELIUS_API_KEY_2`, `FALLBACK_RPC_URL`) — they live in CLAUDE.md today.

### lib/solana-addr.js — ✅ confirmed, with 2 notes
- **The manual ed25519 on-curve math is real and correct** (`isOnCurveBytes`, lines 50–64):
  decompress `y` from 32-byte LE, solve `x² = (y²−1)/(d·y²+1) mod p` via Fermat modular inverse
  (`_edPowMod`), then Euler's criterion for the quadratic residue. Reviewer's praise warranted —
  this is the human-vs-PDA signal underpinning Wallet X-Ray / Autopsy.
- Pure module (no I/O/secrets), self-contained base58 codec, `deriveAta` bump search. Confirmed.
- ⚠️ **"Make `SOL_ADDR_RE` stricter (44 max)" is already done** — it's `/^[1-9A-HJ-NP-Za-km-z]{32,44}$/`
  (line 7), already capped at 44. No change needed.
- 📌 Valid recs: LRU-memoize on-curve for hot/repeated addresses (it's called a lot in forensics);
  a unified `classifyAddress(pubkey) → {isWallet,isContract,label,category}` helper to tidy callers;
  unit tests for edge cases (invalid base58, all-`1`s, boundary lengths); expand classification
  tables (bridges, staking, launchpads) as forensics grows.

### Verdict
Accurate, well-deserved praise. Only adjustments: the regex-strictness rec is already satisfied,
and the rpc.js failover currently has **no backoff/jitter** (so that rec is the highest-value
follow-up here — relevant the moment a provider starts 429-ing under load).

---

## Review 4 — lib/autopsy.js + lib/premium-forensics.js (logged 2026-06-16)

### lib/autopsy.js — ✅ confirmed strengths
- `Promise.allSettled` resilience confirmed (lines 220, 1078, 1888) — one dead source doesn't kill
  the report. Read-only; mint validated via `SOL_ADDR_RE`; output sanitized; all RPC via `rpc.js`.

### ❌ Reject this rec — conflicts with a SETTLED owner decision
- **"Add a Cluck Risk Tier (Low/Med/High/Extreme) / `generateRiskScore()`."** DO NOT build this.
  The **Cluck Score was deliberately REMOVED 2026-06-15** (owner's call) precisely because a
  reassuring grade got slapped on tokens that then rugged. The current, intentional product
  philosophy is **"on-chain facts, no score, no verdict"** (literally the `token-vitals.html`
  title). A deterministic risk tier reintroduces exactly the misleading single-number the project
  chose to kill. Confirmed no `riskScore`/`riskTier`/`cluckScore` remains in autopsy.js — keep it that way.

### ⚠️ Already done
- **"Cache autopsy results (Redis / in-memory LRU + TTL)."** Already implemented: `AUTOPSY_CACHE`
  Map + `AUTOPSY_TTL_MS = 180000` (3 min) + 300-entry eviction (server.js ~7980). The only delta is
  Redis-for-multi-instance — same horizontal-scale caveat as the rate limiter. The reviewer's
  "data as of X seconds ago" idea actually pairs well with this existing cache (show cache age).

### 🐞 Latent bug the reviewer MISSED (praised a feature that's silently off)
- The reviewer lists **creator/team-network funding tracing** as a "powerful differentiator." But
  the Phase 2G-bis sub-distributor filter (`autopsy.js:2744`) references **`excludeSet`, which is
  undefined in that scope** → it throws inside the phase's try/catch → **the team-network multi-hop
  trace has never actually run in production.** Already flagged in CLAUDE.md "Deferred." Fixing it
  (e.g. `const excludeSet = new Set(Object.keys(KNOWN_CEX_WALLETS))`) ENABLES a never-exercised path
  — do it deliberately and verify report output on several mints; don't drive-by it.

### 📌 Valid recs (no conflict)
- Lightweight vs. full autopsy mode (note: server already has a `deep` flag with bigger page/deadline
  budgets — could surface a lighter public default).
- Break the long function into pure helpers (`fetchTokenMetadata`/`analyzeLiquidity`/`traceCreator…`).
- Move big classification arrays toward `solana-addr.js` / a `lib/constants.js`.
- Beginner "what this means for you" intro; versioned report schema; **graceful partial-report
  banner** when Helius quota is exhausted (good, honest degradation).

### lib/premium-forensics.js — ✅ posture confirmed
- Read-only, CLKN-gated, compute-heavier with tighter rate limits — all accurate. Funding-origin
  (CEX → dev) tracing is the real differentiator. Caveat: part of the deeper team-network tracing
  shares the `excludeSet` dependency above, so verify which premium paths actually fire once it's fixed.
- Feature recs (progressive disclosure / drill-down, a funding-flow graph) are reasonable and
  additive — UX, not safety.

### Verdict
Core value confirmed. Two must-not-miss reconciliations: **don't add a risk score/tier** (settled
removal), and **the praised team-network trace is silently disabled by the `excludeSet` bug.**

---

## Review 5 — hatchery.js + securitycoop.js (logged 2026-06-16)

### hatchery.js — ✅ confirmed
- Non-custodial (server returns unsigned tx; user signs), fees collected in-tx, `HATCHERY_TURBO_KEY`
  used only for Arweave upload. Honest "mint ≠ launch" framing. All accurate.
- ✅ **"RPC isolated, not on rpc.js — could benefit from failover" is CORRECT for hatchery.** It uses
  raw `new Connection(rpcUrl(...))` (lines 199/328/399) built from `HELIUS_API_KEY` (line 108), with
  **no failover** — if Helius is down, mint/upload fails blind. 📌 Route it through `lib/rpc.js`
  `connection()` like the rest of the app.
- ✅ Rate limiting: `/api/hatchery` (mounted server.js:1659) sits behind the global
  `/api/` 150/min/IP limiter — so yes, it IS applied. 📌 But it has **no tighter per-route bucket**
  despite costing real Arweave/Turbo money — add a tight bucket (like `pay`/`ai`) so a scripted
  hammer can't drain upload credits.
- 📌 Other valid recs: modularize (metadata/fees/tx-builder), a simulate/"preview tx" endpoint,
  return blockhash-expiry/compute-unit info, unit tests (zero supply, max decimals, long name/symbol,
  Arweave failure), document `isMutable:true` rationale.

### securitycoop.js — ⚠️ reviewer's main rec is ALREADY DONE
- ❌ **"Use lib/rpc.js instead of a local rpcConnection" — already does.** Line 14:
  `const { connection: rpcConnection } = require("./lib/rpc")` — the variable is just *named*
  `rpcConnection`, but it's the `lib/rpc` failover factory (`rpcConnection("confirmed")` at 28/60).
  The reviewer misread the name as a local connection. No change needed; it already has failover.
- ✅ Confirmed: `MAX_REVOKE_PER_TX = 20` (line 19, enforced ~101) to fit tx size; both Token +
  Token-2022; pure read + unsigned base64 tx; strict input validation; no secrets/state.
- 📌 Valid additive recs (UX, not safety): auto-chunking "Revoke All", label the likely dApp behind
  each delegate (known-delegate list), "revoke all dangerous" filter excluding known-safe delegates.

### Verdict
Both tools are as safe as the reviewer says (non-custodial, validated, no custody). Net corrections:
the rpc.js failover rec is **already satisfied for securitycoop** but **genuinely open for hatchery**,
and the cost-bearing hatchery upload deserves a **tighter rate-limit bucket** beyond the global cap.

---

## Review 6 — Liquidity Engine: whirlpool-mm.js + orca/vault/raydium/meteora adapters (logged 2026-06-16)

### ✅ Confirmed (the custody-sensitive core checks out)
- **whirlpool-mm.js auth is real:** Ed25519 wallet-sig verify via `tweetnacl`
  (`nacl.sign.detached.verify`, line 38) + HMAC-SHA256 session tokens (lines 54/65) that
  **fail closed if the admin key is unset** (line 47); `isPubkey()` validation on every route.
- **orca-whirlpools.js uses central rpc.js** (`require("./rpc")`, line 81) — failover, as claimed.
  Unsigned tx build via `serialize({requireAllSignatures:false})` (line 541) — non-custodial confirmed.
- **whirlpool-vault.js fail-closed:** every tick/action early-returns if `!isEnabled()` (no
  `MM_OPERATOR_SECRET`) — lines 684/871/976/1110/1241/1401/1600. Hot wallet is the only custody point.

### ⚠️ Already done
- **"Consider a 'pause all' kill switch in KV."** Already exists — every vault action is gated on
  `st.paused` (lines 687/875/980/1114/1246/1407/1604), toggled by `/api/whirlpool/vault/pause|resume`.

### ❌ DO NOT IMPLEMENT — directly conflicts with the owner's current direction
- **"Implement swap-based inventory rebalancing more aggressively (currently planned)."** This is the
  exact opposite of what the owner just decided. On **2026-06-16 the owner said "stop rebalancing
  period, don't touch it,"** and we **hard-killed the autonomous JUP/USDC rebalancer in code**
  (`JUP_AUTO_REBALANCE_KILLED = true`) after close→swap→reopen recentering was **crystallizing too much
  impermanent loss** in volatile markets (fees were being eaten by IL + swap cost). CLKN buybacks are
  **manual-only** (never buy/sell CLKN without an explicit owner ask). So: do NOT make rebalancing more
  aggressive. The reviewer's separate note that "rebalance/buyback are off by default = good
  conservatism" is now even stronger — autonomous rebalancing is *hard-disabled*, not just defaulted off.

### 📌 Valid, non-conflicting recs
- **Document an operator-key rotation procedure** (high value for a hot wallet) — worth a short runbook.
- On-chain **operator-wallet balance monitoring** (alert if too low/high). Pairs with the existing
  gas-floor logic (`swapSolFloor 0.2`).
- More **anomaly detection** before acting (volume-spike guard) on top of the existing price-gap guard.
- **Telegram alerts on large/failed actions** with full detail (vault already DMs on rebalance; extend
  to failed txs / large moves).
- Extract shared range/price math into a pure utils file (shared Orca↔Raydium); light (10–30s) pool-state
  cache; `simulateTx()` for pre-sign UX; more vault-cycle simulation/tests.
- **Raydium SDK is alpha** — watch version bumps closely (echoes Review 1; it's in the signing path).
- Meteora: finish write-side via the same unsigned-build + operator-sign pattern when ready.

### Verdict
Architecture and custody posture are as strong as the reviewer says. The one critical catch: **the
"rebalance more aggressively" rec must be rejected** — it contradicts the owner's just-issued hard stop
on autonomous rebalancing. The "pause-all kill switch" is already built (`st.paused`).

---

## Review 7 — lp-scanner.js + helius-trades.js + solana-tracker.js/solscan.js (logged 2026-06-16)

### lib/lp-scanner.js
- ✅ Multi-venue via GeckoTerminal, dedup, fee/volume deltas, read-only — accurate. The "cleaned up
  Cluck Score references" note is right (some of it was done this session).
- ⚠️ **"Add a caching layer with short TTL" is already done** — `_scanCache = new Map()` with
  `SCAN_TTL = 60000` (60s) so the sequential fee reads only run on a miss, plus `_coinIdCache` and a
  cached Jupiter verified-token list (lines 12–13, 130). Minor nuance: discovery is GeckoTerminal-based
  (it explicitly avoids a Solana Tracker dependency), with adapters/on-chain used for precise fee reads.
- 📌 Valid additive recs: frontend filters (min liq / age / fee tier / venue), an IL-estimator or
  fee-breakeven projection in the summary (nice LP-Lab tie-in), a "Top Movers" section, list pagination.

### lib/helius-trades.js
- ✅ Window-scoped dedup, quota awareness, raw-parse vs business-logic separation — accurate. (Mechanism
  is batched **enhanced-tx parsing**, not webhooks.)
- ⚠️ **"Add robust retry + fallback when Helius returns partial" is largely already handled** — at the
  orchestration layer, `buyersInWindowMulti` (Helius → **GeckoTerminal** → Solana Tracker, server.js:742)
  and `walletPositionMulti` (772) wrap helius-trades with a source-tagged fallback chain, so an exhausted/
  partial Helius rolls to free GeckoTerminal then ST last-resort. The 48h-hold check
  (`getWalletTokenPositionHelius`) also routes through this.
- 📌 Valid additive: export a reusable `parseHeliusTx()` helper; enrich buys with $ value (Gecko/Jup
  price); anti-sybil signals for competitions (flag one wallet with many entries) on top of the existing
  window dedup.

### lib/solana-tracker.js + lib/solscan.js
- ✅ Small wrappers with error handling/fallbacks; used for cross-verification (the "never falsely
  accuse" principle). No secrets leaked; proxied where needed.
- 📌 Valid recs: centralize external-API key handling + rate-limiting in one place (an rpc.js-style
  wrapper for external calls); cache static-ish data (holders, creator tx history) harder; document the
  fallback priority explicitly. (Note: ST is the **quota-billed last resort** by design — keep it there;
  per CLAUDE.md, don't re-point buy tracking at ST directly.)

### Verdict
Mature, focused, honest multi-source forensics — as the reviewer says. Net correction: the two headline
"add caching / add fallback" recs are **already implemented** (lp-scanner 60s cache; the Helius→Gecko→ST
buy-data chain). The remaining items are genuine UX/feature polish.

---

## Review 8 — grad-tracker.js + diploma-nft.js + credentials.js (logged 2026-06-16)

### lib/grad-tracker.js
- ✅ File-backed + in-memory fallback, dedup, 48h window + pinned manual entries — accurate.
- ⚠️ **"Add an LRU/expiration sweep to prevent unbounded growth" is already done** — `RETAIN_MS = 48h`
  with `pruneGraduated()` run on every add and list (lines 22/46/64/68). The 48h prune IS the sweep.
- 📌 Valid additive: an admin endpoint to manually pin graduations; volume/price-at-graduation
  snapshots; unit-test the prune with mock timestamps.

### lib/diploma-nft.js
- ✅ **Custody claim confirmed:** signs with `MM_OPERATOR_SECRET_TREASURY` (line 18/80), NOT the main
  MM key. `GAS_FLOOR_SOL = 0.15` skips minting below that to protect rebalancer gas (15/85); `MINTED_KV`
  idempotency prevents double-mint (13/81/104); lazy Metaplex load; `maxDepth 14` = 16,384 leaves.
  - Note: the treasury wallet (2zMCU…) is shared with the JUP/USDC position, so diploma mints draw its
    gas — hence the floor guard. Keep treasury balance monitored/minimal (matches reviewer's low risk).
- 📌 **"Add retry around `sendAndConfirm`" is valid** — confirmed there's no retry wrapper today (bare
  `.sendAndConfirm(u)` at 54/72/101). Worth adding with a sane commitment.
- 📌 Other valid recs: richer NFT metadata (belt rank, grad date); batch-backfill mode for existing
  graduates; document the collection-authority flow; track tree fill vs the 16,384 cap.

### lib/credentials.js
- ✅ Volume persistence + in-memory fallback, deterministic sha256-truncated slug, best-score/max-coursework
  merge, anonymized public stats, CLKN ownership-proof tier — all accurate.
- ⚠️ **"Add validation on incoming coursework counts (prevent absurd values)" is already done** — the
  `track()` helper clamps each count: non-negative, floored, **monotonic** (can't decrease), and
  **`Math.min(count, total)`** so it can't exceed its denominator (lines 84–92).
  - 📌 Residual (minor, cosmetic): the `total` denominator is itself client-supplied, so a wallet could
    inflate "X of Y" by inflating Y. Harmless — coursework counts are self-reported display only; the
    **diploma `verified` status is server-scored** and not affected. Could pin totals server-side later.

### Verdict
Cohesive, persistent, honest education layer — high marks deserved. Net: grad-tracker's "expiration
sweep" and credentials' "coursework validation" are **already implemented**; the one real open item is
**retry around the diploma `sendAndConfirm`**. Custody hygiene (treasury key + gas floor + idempotency) confirmed.

---

## Review 9 — kvstore.js + sigstore.js + analytics.js + recap.js + bags-context.js (logged 2026-06-16)

### lib/sigstore.js — ✅ excellent, + a verified safety analysis on the prune rec
- ✅ Fail-closed on persist fault when `volumeExpected` (rollback `consumed.delete(sig)`, line 67);
  **atomic test-and-set** confirmed live in the payment handler (`sigStore.add()` returns false on a
  concurrent claim → rejects, server.js:5368). This is the replay guard, done right.
- 🔑 **"Add a 30–60 day prune" — verified SAFE (my first instinct was wrong).** The payment verifier
  (`/api/verify-clkn-payment`) only scans the **last 10 signatures** (`getSignaturesForAddress
  {limit:10}`, server.js:5294) of the receive wallet. A consumed sig that has scrolled out of that
  10-tx window can never be matched again, so pruning old entries does NOT reopen replay — provided the
  prune horizon comfortably exceeds the time for 10 incoming transfers (true for any active wallet;
  only a near-dead receive wallet with <10 lifetime transfers in the window would be a concern).
  Net: prune is fine but **low urgency** — the set only grows by *real successful payments*. If added,
  belt-and-suspenders = also time-bound the scan, not just `limit:10`.

### lib/kvstore.js
- ✅ Minimal, atomic `persist()` on write, in-memory fallback, `DATA_DIR`-configurable. As described.
- 📌 Valid: add a `delete()` method (none today); optional per-key TTL; debounce if any high-frequency
  key is ever added (recap.js already shows the debounce pattern).

### lib/analytics.js
- ✅ Cookieless, daily-salted one-way IP+UA hash, bot filtering, 30s debounced flush. Privacy-first, accurate.
- 📌 Valid: document that the salt falls back to `PREMIUM_ACCESS_KEY` (rotating the key resets uniqueness
  counts); a gated `/api/analytics` summary endpoint.

### lib/recap.js
- ✅ 3s debounced persistence, snapshot/reset API, `MIN_BUY_USD` dust filter. As described.
- 📌 Valid: auto-reset after a max window (24–48h) if not manually reset; track `topSell` alongside `topBuy`;
  optional short history of past recaps.

### lib/bags-context.js
- ✅ 5-min per-mint TTL cache, never-throws/safe-shape, `classifyTeamActivity()` derived signal, Jupiter
  cross-check. Accurate. Keys from env only; fetches time-bounded.
- 📌 Valid: split the long `bagsFetchCtx` parser; louder logging when multiple parse paths fail (Bags API
  drift early-warning); an admin cache-clear endpoint; cache-hit-rate logging.

---

## Review 10 — Backend wrap-up + frontend (App.jsx) + project-wide (logged 2026-06-16)

High-level assessment matches what the per-file reviews found. One project-wide correction + the durable backlog.

### ⚠️ The #1 project-wide rec ("add a caching layer") is largely ALREADY DONE
- The reviewer's top polish item names autopsy, pool scanner, and bags context specifically — **all three
  already cache:** autopsy `AUTOPSY_CACHE` 3-min TTL (server.js:7980), pool scanner `_scanCache` 60s
  (lp-scanner.js:12), bags-context 5-min per-mint TTL. So "reduce Helius/Jupiter cost via caching" is
  mostly in place; the real delta is **Redis/shared cache for multi-instance**, not first-pass caching.

### Frontend (App.jsx) — consistent with Reviews 1 & 3
- ✅ Rich content, clever unlock flow, beginner UX, error boundaries — confirmed earlier.
- 📌 **Split App.jsx** is the recurring highest-leverage refactor (components/data/hooks/utils); Zustand
  is already a dep and underused. Lazy-load the 135-scenario simulator; memoize repeated calcs; loading
  skeletons; ARIA/keyboard a11y.
- ⚠️ XSS reminder (from Review 1): App.jsx auto-escapes, so "no obvious XSS" holds *there* — the real XSS
  surface is the vanilla `public/*.html` tool pages (must `esc()` token-supplied strings).

---

## Consolidated backlog (after full review, 2026-06-16)

### ❌ Rejected — conflicts with settled owner decisions (DO NOT implement)
- **Risk score / "Cluck Risk Tier" / `generateRiskScore()`** (Review 4) — Cluck Score was deliberately
  removed 2026-06-15; philosophy is "facts, no score, no verdict."
- **More aggressive autonomous rebalancing** (Review 6) — owner hard-killed the rebalancer 2026-06-16
  ("stop rebalancing period"); `JUP_AUTO_REBALANCE_KILLED = true`. CLKN buybacks stay manual-only.

### ⚠️ Already implemented (reviewers' recs that are moot)
- Rate limiting incl. on payments/AI (custom per-IP limiter) · autopsy/pool-scanner/bags caching ·
  buy-data fallback chain (Helius→Gecko→ST) · grad-tracker 48h prune · credentials coursework clamp ·
  vault "pause-all" (`st.paused`) · securitycoop already on rpc.js · `SOL_ADDR_RE` already capped at 44.

### 📌 Real open items (rough priority)
1. **Tooling/CI quick wins:** ESLint + Prettier + `lint` script; unit tests for critical paths
   (payment verify, tx builders, vault guards, address primitives, sigstore prune logic); extend CI
   beyond `node --check` to a test + `npm run build` gate; deploy via `npm ci` (lockfile).
2. **rpc.js failover backoff/jitter** (Review 3) — currently retries with no delay; highest-value the
   moment a provider 429s under load. Optional: circuit breaker / short health cache.
3. **hatchery.js → route through `lib/rpc.js`** (no failover today) + add a **tight rate-limit bucket**
   on the Arweave-cost endpoint (Review 5).
4. **Vault/hot-wallet observability** (Review 6): operator-key rotation runbook; balance monitoring
   alerts; Telegram alerts on large/failed actions; more vault-cycle simulation/tests.
5. **diploma-nft.js:** retry around `sendAndConfirm` (Review 8).
6. **App.jsx split** + Zustand + lazy-load + a11y (Reviews 1/3/10) — biggest frontend debt.
7. **Modularize** server.js + long lib parsers (bags-context, autopsy) into smaller units.
8. **Re-verify `esc()` coverage** across all vanilla `public/*.html` pages (XSS surface).
9. **Scale-prep (only if >1 instance):** Redis for the rate limiter + KV/caches/exam tokens.
10. **Gradual TypeScript** starting with the money libs (solana-addr, sigstore, vault).
11. **Lower-priority hygiene:** kvstore `delete()`; recap auto-reset + `topSell`; analytics salt doc +
    gated summary endpoint; sigstore prune (low urgency, safe per Review 9); structured logging (Pino/Winston).

### 🐞 Known latent bug (separate from reviews; pre-existing)
- `lib/autopsy.js:2744` references undefined `excludeSet` → throws in try/catch → the team-network
  multi-hop trace has never run in prod. Fixing it ENABLES a never-exercised path; do deliberately +
  verify on real mints (also in CLAUDE.md "Deferred").

<!-- Append any future external reviews below as ## Review 11, ... -->

---

## Next targets queued (security-critical core, ahead of strict file order)
1. `lib/solana-addr.js` — validation/codec primitives everything trusts.
2. Payment + replay path — `lib/sigstore.js` + CLKN payment verification + `/api/claim`
   (atomic test-and-set, fail-closed).
3. `lib/diploma-nft.js` + vault/Meteora signing path — wherever a private key signs.

<!-- Append new external reviews below as ## Review 2, ## Review 3, ... -->
