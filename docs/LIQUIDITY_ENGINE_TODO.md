# 💧 Liquidity Engine — Review & To‑Do List

> The running checklist for the Liquidity Engine product. Review items, build backlog,
> open decisions, and new ideas. Committed so it survives between sessions.
> Companion to `docs/LIQUIDITY_ENGINE.md` (the full strategy/architecture deep‑dive).

---

## ✅ Shipped & live (for review — confirm you're happy with each)

- [ ] **Non‑custodial tool** (`/liquidity`) — connect wallet, pick pool + fee tier, single‑sided / balanced ranges, preview, sign your own txs. Auto tick‑array init for fresh pools.
- [ ] **Autonomous vault** (operator‑gated, off unless `MM_OPERATOR_SECRET` set) — balanced CLKN/USDC base + upside ask‑wall (0.65%) + CLKN/SOL pool; auto re‑center; auto inventory rebalance (SOL↔USDC via Jupiter, never sells CLKN); ad‑hoc `manualSwap`.
- [ ] **Guardrails** — anti‑thrash interval, daily action caps, price‑gap anomaly guard, slippage caps, per‑fee‑tier pools, kill switch (`/api/whirlpool/vault/pause`).
- [ ] **`/liquidity` Telegram command** — public, sanitized depth view (no wallet/balances).
- [ ] **24h volume** shown on buy/sell alerts + the `/liquidity` post.
- [ ] **Buy‑alert floors** — $20 buys / $50 sells (env‑overridable).
- [ ] **Product + education page** (`/liquidity-engine`) — intro, live CLKN proof, real‑vs‑wash education, custody model, pricing, early‑access CTA.
- [ ] **Strategy deep‑dive** (`docs/LIQUIDITY_ENGINE.md`).
- [ ] **Docs updated** — README "Liquidity Engine" section; investors page card + momentum item.
- [ ] **Discovery links** — `/tools` flagship card + link from `/liquidity` tool page.

## ⚙️ Current live CLKN state (review)
- [ ] Base CLKN/USDC (0.02%) ≈ $1.1k; CLKN/SOL (0.02%) ≈ $0.9–1k (roughly balanced — the arb setup). Ask‑wall (0.65%) ≈ $240.
- [ ] Auto‑swap currently **paused** (`swapEnabled:false`) so SOL stays for the SOL pool. `askWallClknFraction:0.2`, `solMaxSol:7`, `minRebalanceIntervalSec:1800`.
- [ ] Reminder: **CLKN is the binding constraint** across all pools — keep it funded until the equal‑pools rebalancer lands.

---

## 🔨 Build backlog (next, in rough priority)

- [ ] **Equal‑pools rebalancer + buyback** *(headline feature; build SUPERVISED, off by default, dry‑run first)*
  - [ ] Build `positionValue()` primitive (token amounts from liquidity + range + price → USD).
  - [ ] Target equal value across managed pools (configurable split).
  - [ ] Bidirectional SOL↔USDC + **buy CLKN back** with accumulated quote; never sell CLKN unless explicitly enabled.
  - [ ] Fold the existing "deploy staged USDC" / "deploy available SOL" triggers into one value‑targeting allocator.
- [ ] **Multi‑tenant refactor** (makes it sellable) — staged; CLKN stays live & untouched throughout.
  - [x] **Stage 1 — project context layer (DONE, live, zero behavior change).** Project registry
        (built‑in `clkn` uses LEGACY kv keys + `MM_OPERATOR_SECRET` = byte‑for‑byte unchanged;
        others get `wpVaultConfig:<id>`/`wpVaultState:<id>` + own operator env). `getConfig/
        setConfig/getState/setState/operator` take optional `projectId` (default clkn).
        `operatorPubkeys()` + poller skips ALL managed wallets. Gated `/vault/projects` CRUD.
  - [x] **Stage 2 — generalize the engine (DONE, live).** `orca-whirlpools.js` works against a
        token context `{ mint, symbol, quoteMints }` defaulting to CLKN. `discoverPools/
        getPoolState/listPositions/suggestRanges` take the context; `quote/open/close` were
        already token-agnostic. Results keep `clkn*` aliases + add `token*` names → no consumer
        changes. Verified: CLKN identical; BONK discovers 9 Orca pools generically.
  - [x] **Stage 3 — project-scoped execution (DONE, live).** AsyncLocalStorage carries the
        active `{ projectId, tok }` through each call tree, so the bare resolver calls scope to
        the project (concurrency-safe; defaults clkn). All engine/mint sites use `tok()`. Exports
        wrapped in `withProject`. Scheduler loops over every ACTIVE project whose operator key is
        loaded (sequential = staggered). Verified: CLKN identical post-deploy.
  - [x] **Stage 4 — per-project admin (DONE, live).** `?project=` on status/costs/earnings/tick/
        wall-tick/sol-tick/rebalance/swap/pause/resume/config/mode. Public `/pools?token=` for a
        feasibility check (`hasOrcaPools`).
  - [x] **Stage 5/6 — POOL BOOTSTRAP + per-project Telegram + PDA resolve (DONE, live).**
        engine.buildCreatePool + vault.createPool (gated /vault/create-pool) create a new Orca
        pool at live market price. engine.poolAddressFor + vault.resolvePoolAddress derive the
        pool PDA (no Orca-API indexing wait). notify() routes to each project's telegramChatId.
  - [x] **🌹 ROSE LAUNCHED ON ENGINE (live).** First non-CLKN project running end-to-end on Orca.
        Created ROSE/USDC @0.02% (7QY4CbWq…) + ROSE/SOL @0.08% (13Vz9h4me…) at market; seeded both
        (positions 83hWFJTP… + 9QFHtWX2…, both in range). Operator 7W3tYEoo…. Ask wall stays on
        the existing Raydium CLMM pool (manual). Note: Orca's ts-8 fee is now 0.08% (legacy 0.05%).
  - [ ] **ROSE follow-ups:** set ROSE-room telegramChatId (per-project alerts); consider enabling
        swapEnabled for cross-pool rebalancing once quote builds; optionally build Raydium tx-layer
        later to manage the ask wall autonomously.
  - [ ] **Stage 5b — key management**: encrypted keystore for fully-managed clients (vs the
        per-project env var used now). DECISION FORK.
  - [~] **Stage 7 — MULTI-VENUE (Raydium CLMM) — IN PROGRESS.** Many tokens live on Raydium CLMM,
        not Orca (e.g. ROSE/OnlyRose = one Raydium CLMM ROSE/SOL pool, 0.25%, tickSpacing 60).
        - [x] `@raydium-io/raydium-sdk-v2` added (verified installs + live app healthy after deploy).
        - [x] `lib/raydium-clmm.js` read-side: `discoverPools(tok)` via Raydium API v3, normalized to
              the Orca shape (clkn*/token* aliases). VERIFIED live on ROSE.
        - [ ] Raydium SDK tx layer: getPoolState (getRpcClmmPoolInfo), suggestRanges (tick math),
              quote (PoolUtils.getLiquidityAmountOutFromAmountIn), listPositions (getOwnerPositionInfo),
              buildOpenPosition (openPositionFromBase → unsigned), buildClosePosition (closePosition).
        - [ ] Venue wiring in the vault: `project.venue` (orca|raydium) → `eng()` via ALS scope.
        - [ ] VALIDATE with a SMALL live ROSE position before autonomous use.
        - [ ] (Later) Stage 6 pool BOOTSTRAP also applies per venue (Raydium createPool exists too).
        - NEEDED FROM OPERATOR: a dedicated ROSE hot wallet (a little ROSE + SOL), key set as
          `MM_OPERATOR_SECRET_ROSE` on Railway; then register {id:"rose", venue:"raydium", tokenMint, symbol}.
  - [ ] **Stage 6 — POOL BOOTSTRAP (needed for onboarding):** the engine currently REQUIRES an
        existing Orca pool (it opens positions, and inits tick arrays on pristine pools, but does
        NOT create the Whirlpool itself). Orca SDK supports pool creation (createPool /
        createSplashPool / createConcentratedPool). Add: (a) non-custodial create-pool tx builder
        for the `/liquidity` tool, and (b) an operator/auto path so onboarding a token with no
        pool can stand one up from token + SOL/USDC. Until then, a project's pool must be created
        manually (on Orca) before the vault can manage it. Most Bags tokens graduate to METEORA,
        not Orca — so a brand-new Orca pool will usually be needed.
- [ ] **Client dashboard** — per‑project depth / fees / balance / controls; wallet‑signature auth.
- [ ] **Guided onboarding flow** — create dedicated wallet → fund float → set token + targets → choose tier → go (Hatchery‑style UX).
- [ ] **Pricing / billing** — CLKN setup + monthly, holder‑gate, optional perf fee.
- [ ] **Self‑hosted agent package** — deployable agent + client config (we touch nothing).
- [ ] **Trustless Mode** — on‑chain LP‑only delegate program (audited). The trust endgame.
- [x] **Pending‑fee readout** — DONE. Real‑time uncollected fees per position via
      `collectFeesQuote` (the on‑chain feeOwed checkpoint reads ~0 while still earning), plus
      realized fees banked on each roll. Gated `/vault/earnings` + folded into `/vault/status`
      with a `netPnlUsd` (fees earned − tx‑fee cost). PRIVATE.
- [x] **Operational cost tracker** — DONE. Per‑tx fees accumulated (today + lifetime, SOL + USD)
      in `/vault/costs` + `/vault/status`. PRIVATE. Good "true ongoing cost" proof for pitching
      other groups; would flag a pricier venue (Meteora/Raydium).
- [ ] **grant.html** — mirror the Liquidity Engine into the grant page for consistency.
- [ ] **Make init+open atomic** — remove the tick‑array init/open RPC propagation race (self‑heals today, but cleaner atomic build later).

---

## ⭐ NEW IDEA — "Meet projects where they are" + bootstrap‑from‑a‑seed *(captured 2026‑06; develop this)*

**Core philosophy:** meet developers and communities **where they're at** — even with only a
little token, SOL, or USDC, there are healthy ways to grow it. A huge underserved market of
low/mid‑cap projects. The product shouldn't require a big treasury to start.

**The bootstrap mechanic (genuinely strong — make this a headline use‑case):**
A just‑launching project usually has **lots of its own token but little SOL/USDC.** Instead of
the usual playbook (team wallet market‑dumps tokens → crashes price → spends the proceeds on
dumb/paid advertising → nothing lasting), they:
1. Put a **small % of supply single‑sided** (CLKN‑only **asks above price**) — costs **zero**
   SOL/USDC to deploy.
2. As organic buyers take those asks, the project **accumulates USDC/SOL** — selling token
   **into demand at rising prices** (healthy distribution, not a dump).
3. **Reinvest those proceeds** into building the real two‑sided liquidity machine (balanced
   base + SOL pool) — which deepens the market → smoother buys → more organic demand →
   **flywheel.**
4. The same token supply becomes **permanent liquidity infrastructure** instead of a one‑time
   dump. Healthier for price, holders, and reputation.

**Why it's better than the status quo:** a dump destroys price and trust and the cash is gone;
this turns supply into depth, distributes into strength (not weakness), and compounds. It's
*teachable* (fits the school) and *honest* (real liquidity, not fake volume).

**Product implications to develop:**
- [ ] A **"Liquidity Bootstrap" tier / mode** for new + low‑cap projects: start single‑sided
      from token only, auto‑reinvest proceeds into the two‑sided machine as it grows.
- [ ] **Tiny‑budget on‑ramp** — works with a little SOL/USDC/token; grows from there. No
      minimum‑treasury gate to begin.
- [ ] **Education module** — "How to bootstrap healthy liquidity from your own supply (without
      dumping)" — strong school content + lead magnet.
- [ ] **Positioning** — explicitly contrast with "team wallet dumps + paid shills." The honest,
      compounding alternative.
- [ ] Menu of offerings for low/mid‑cap projects (depth, bootstrap, rebalancing, education,
      audits) — define the full suite.

---

## 🎛️ ENGINE MODES — headline product feature *(captured 2026‑06; design below)*

**Core idea:** the engine is ONE machine with a dial. "Modes" are named presets over
config knobs we ALREADY have (`widthPct`, `edgeTriggerFrac`, `minRebalanceIntervalSec`,
`maxActionsPerDay`, `askWall*`, `solEnabled`, `swapEnabled`, `poolBalanceTolPct`). Not a
rebuild — a preset table + an apply path. The marketed product sells the *mode*, not the knobs.

### Taxonomy: 3 intensities × a tilt, + a bootstrap lifecycle

**Intensity (how tight/active):**
- ⚡ **Active (Tight & Busy)** — quick volume + arbitrage, lively chart. Tight range (±3–5%),
  aggressive re-center (~10–15 min), high daily cap (~24), SOL pool + rebalancer ON.
  Most fees BUT most IL/LVR + gas; wants monitoring. Targets the ~20–50k/day ceiling at size.
- 🌿 **Steady (Balanced)** — *current CLKN setup.* Healthy depth, slow-steady drift. Medium
  range (±10%) wide base + tight ask wall, 30-min cadence, ~12/day. Low-touch default.
- 🪨 **Foundation (Wide & Passive)** — deep, stable floor; set-and-forget. Wide range
  (±25–50%), rare re-center (6–24h), low cap (~2), ask wall optional/off, swap OFF. Lowest
  fees/volume BUT lowest IL, lowest gas, max stability, near-zero maintenance. For treasuries /
  long-term liquidity that just needs to exist and be deep.

**Tilt overlay (orthogonal — layers on any intensity):**
- **Balanced** (default) / **Distribution** (ask-heavy — sell into strength; what CLKN runs) /
  **Accumulation** (bid-heavy — support + accumulate).

**Bootstrap (lifecycle mode):** start single-sided CLKN asks from token only (zero quote),
accumulate quote from organic buys, AUTO-GRADUATE into Steady as the quote base grows.
(See the bootstrap idea section above — this is its mode form.)

### UX (on-brand by construction)
- **Beginner:** pick by GOAL in plain English — "Lively & active / Steady & healthy /
  Deep & hands-off / Just starting out." No knobs.
- **Advanced:** see + tune every lever = "Custom" mode.

### Build plan (non-destructive — current live config must stay untouched)
- [x] `MODES` preset table in `lib/whirlpool-vault.js` (each = a partial config) + `TILTS`
      overlay (balanced/distribution/accumulation). Shape knobs only — reserves, fee tier, pair
      untouched.
- [x] `applyMode(name, tilt?)` patches config; `mode`/`tilt` recorded in state; snapshots prior
      config so `name=custom` restores it. **Default = "custom" (current config); nothing
      auto-applies.** Verified live: Steady+Distribution diff vs the live CLKN config = [] (the
      presets match the hand-tuned setup).
- [x] Endpoint `GET /vault/mode` (list + current) + `POST /vault/mode` (gated): DRY-RUN preview
      of the exact diff by default; `&run=1` to apply.
- [x] Surface active mode in `/vault/status` (`mode`/`tilt`).
- [x] Surface active mode on the `/liquidity` post (only when a NAMED mode is applied —
      "custom" stays hidden so CLKN's post isn't cluttered until a mode is chosen).
- [x] Mode education on `/liquidity-engine` — an "🎛️ Engine Modes" section: beginner
      pick-by-goal cards (Active/Steady/Foundation) + tilt callout + an Advanced `<details>`
      knob table. Brand standard (beginner + advanced) satisfied.
- [ ] OPTIONAL: apply Steady·Distribution to CLKN (zero-diff — only labels the state) so the
      `/liquidity` post shows the mode. Pending user OK (non-destructive principle = don't
      auto-apply).
- [ ] (Later, multi-tenant) mode is a per-project setting.

---

## 📈 PROFIT-TAKING & COUNTER-CYCLICAL RESERVE *(captured 2026‑06; design — revisit)*

**The risk being solved (user's instinct, and it's correct):** as price rises — especially
after big/fast moves — downswings get more likely. A naive MM that re-centers TIGHT at each
new high and reinvests 100% of its gains into that tight band concentrates all its quote
exactly where mean-reversion runs it over (textbook **LVR**), and leaves nothing below to
catch the dip. So: as price climbs, THROTTLE deployment / BROADEN ranges / HOLD some gains
back — turn "USDC made on the way up" into a catch-fund below, not more top-of-book risk.

**Mechanisms (all are dials on existing knobs; extend the static reserve → dynamic):**
- [ ] **A. Profit-skim reinvestment ratio.** Ask-wall/upside proceeds split: X% back into
      depth, (1−X)% banked to reserve. Catch-fund grows automatically as we climb; auto-raise
      the skim after big/fast moves. *(Biggest lever for this concern.)*
- [ ] **B. Asymmetric "catch ladder."** After an up-move, place the USDC bid side LOWER than
      price (a ladder of bids below) instead of a symmetric band at the new high. Sell high →
      buy low; accumulated cheap CLKN becomes ask-wall ammo on the next rise. Flywheel.
- [ ] **C. Volatility-scaled width.** Calm chop → tight (max fees). Right after a big/fast move
      → broaden ranges (dump takes less per level; depth spread down to catch the fall).
- [ ] **D. Counter-cyclical deploy fraction.** Deploy a smaller share of float as price rises
      (reserve more at the top); release it as bids as price falls toward the catch zone.
- [ ] **E. Drawdown-aware reserve floor.** The dry-powder floor scales up with realized gains /
      price, so the cushion below always grows with the move.

**Honest caveat (product vs our own use):** catching dips = accumulating inventory INTO
weakness = a CONVICTION posture. Great for a project's own token (CLKN — long-term bullish,
*want* to accumulate cheap), so a fine default for project-owned liquidity. As a SOLD service
it's the opt-in **Accumulation tilt**, with falling-knife / IL risk stated honestly (ties to
the big-sell disclaimer). A project that isn't bullish should run the tighter neutral profile.

**Folds into MODES:** a "Profit & Reserve policy" overlay (skim ratio + dynamic floor + deploy
curve) + the **Distribution → Accumulation tilt cycle** (distribute up, accumulate down).
Status: user marinating — wants more thought before we build. Don't implement yet.

### Refinement from user's hands-on experience *(captured 2026‑06)*

**Two concrete techniques the user has run before, to build in:**

1. **Single-bin round-trip (+ half-skim).** A tight single-sided band IS a limit order: token-
   only above price → fills to USDC on the way up (a sell); leave it (or HALF of it) in that
   same bin and it flips to a resting buy (USDC→token) when price falls back through. Round-
   trips the same level — sell high / buy low repeatedly, earning spread + fees each cycle.
   User's rule: on fill, **pull half (bank the gain = profit-skim, mechanism A), leave half
   (keep the level armed).** Net-distributes tokens slowly at that level = healthy distribution.
   Ideal for a calm, low-FOMO, oscillating community. *Note:* a narrow Orca tick-range ≈ a
   Meteora DLMM bin (likely the source of the user's experience); reproduce with tight ranges.
   - [ ] Implement an "on-fill: pull X% / leave (1−X)%" round-trip rule for tight single-sided bins.

2. **Deep dormant catch ladder = THE use case for single-sided USDC.** Single-sided USDC
   positions placed FAR below price in the SAME CLKN/USDC pool (no separate pool needed). Key
   property: **out-of-range positions cost nothing** — parked deep they're 100% USDC, zero IL,
   zero earnings, just waiting. On a big sell, price falls into them and they **buy CLKN cheap,
   atomically with the dump** — cushioning the crash AND handing back cheap inventory (→ ask-wall
   ammo on recovery). **This resolves the user's earlier open question** ("don't want a single-
   sided USDC pool *right now*, but it should be an option"): the option's killer use is dormant
   downside crash-insurance, not USDC sitting at price.
   - [ ] Build it as a **LADDER** (e.g. −15% / −30% / −50%), not one band → DCA-into-a-dump.
   - [ ] **Hybrid sizing:** modest pre-placed ladder (always armed, fills instantly, no reaction
         lag) + free dry-powder reserve (flexible). Pre-placed guarantees the catch; free gives
         optionality.
   - Tradeoffs to respect: committed USDC earns nothing while waiting (opportunity cost vs free
     reserve); if the crash never comes that capital sat idle — so size as INSURANCE, not bulk;
     and it's a conviction/bullish posture (opt-in Accumulation tilt for the sold product).

### ✅ AUTHORITATIVE LIVE POSTURE FOR CLKN *(user-confirmed 2026‑06 — don't second-guess)*

**Asymmetric by design: thick up / thin down / reactive crash buyback.**
- **Upside ask wall = THICK** (`askWallClknFraction: 0.9`, intentionally). A big BUY walks
  through more CLKN asks → less price impact / smoother fills, distributes token into real
  demand, accumulates quote. **Keep it thick.**
- **Downside bid = LIGHT, on purpose.** Don't pre-commit much USDC to the opposite (bid) side.
  A big SELL hits thinner liquidity → dumpers eat more slippage/fees, and no USDC is locked
  down there.
- **Crashes handled REACTIVELY** — keep reserve (free dry powder) and buy back on the dip with
  own/set-aside funds, on the operator's terms. The autonomous equivalent = a crash-response
  trigger ("fast drop >X% → deploy a slice of reserve as bids / buy back"). The deep dormant
  catch ladder (above) is the OPTIONAL hands-off version, NOT the default.
- **This refines/supersedes the earlier "buy support should be deeper" note:** buy support
  should exist and be reasonable, but the engine is deliberately upside-weighted and the bulk of
  crash-catching is reactive reserve, NOT a deep pre-placed bid wall. "Keep it light" = applies
  to the DOWNSIDE, not the upside ask wall.

### 🧠 WHY reactive > ladder — community morale (user-confirmed 2026‑06)

The decisive reason to prefer reactive buyback over a dormant catch ladder is PSYCHOLOGICAL,
and it's sound:
- **A ladder absorbs the sell, it doesn't answer it.** USDC parked low fills INTO the dump —
  same downward move, one shallower red candle, no visible response. Community sees red, feels
  red; the cushion is invisible.
- **A reactive buyback is a separate, visible event.** Let the dump express (red), then step in
  with buys (green) → a V/recovery pattern that reads as "we got hit and buyers stepped back in."
  Far more reassuring, and honest (it really is two distinct events).
- **Letting price drop GIVES the community the dip.** A ladder steals their entry by buying the
  bottom first. Letting it fall hands a loyal, low-FOMO base a real chance to average down
  themselves — worth more than shaving a few % off drawdown depth. Turns a scare into a shared win.
- **Bonus:** sell-then-buyback = two real fills = more genuine two-way volume + better organic score.

**Design implications for the (future, optional) auto crash-response:**
- [ ] Make it **delayed + staged**, NOT instant/atomic — instant just mimics the ladder. Let the
      red land, a floor form, give the community a window, THEN print green in a few visible steps.
- [ ] Timing is the one real risk (the art): too fast suppresses the dip window + recovery story;
      too slow sags morale into "death spiral." Tune the delay/threshold deliberately.
- [ ] **Visibility:** chart shows green from ANY wallet (chart-morale always works). Telegram buy
      alerts SKIP the MM operator wallet — so buy back from a NON-operator wallet to also show as
      community green in chat; OR if automated from the engine, give it its OWN intentional
      "🟢 Liquidity Engine bought the dip" announcement (not the suppressed-operator path).

---

## ❓ Open decisions for review
- [ ] Custody: confirm the tiered model (Self‑Serve → Managed dedicated‑float → Trustless delegate). Comfortable holding the float key for managed, or lead with self‑hosted?
- [ ] Pricing specifics (setup / monthly / holder‑gate threshold / perf‑fee %).
- [ ] Which to build first: equal‑pools rebalancer, multi‑tenant, or the Bootstrap tier?
- [ ] Should the CLKN auto‑swap stay paused, or re‑enable with a higher SOL floor so both pools and the SOL arb stay funded?

---

## 🎯 BRAND STANDARD — applies to EVERY product (not just this one)

> "Everything needs to be easy to understand. Every product we build we need a beginner's
> guide and an advanced guide. We have to meet people where they are and help them. This is
> our brand." — the directive, captured.

- [ ] **Every product ships with a Beginner's Guide AND an Advanced Guide.** Plain‑English
      beginner track + a depth track for operators. (Consider adding this to `CLAUDE.md` so
      every future session enforces it.)
- [ ] **Default to readable.** No scientific notation, no jargon without explanation; show
      dollars + token amounts, not raw units. (Fixed for `/liquidity`.)
- [ ] **Meet people where they are** — low/tiny‑budget on‑ramps, no gatekeeping to learn,
      education built into every tool.
- [ ] **Audit / sweep existing products** to make sure each has both guide tracks and is
      genuinely easy to understand.

### Done for the Liquidity Engine (this brand standard, applied)
- [x] `/liquidity` Telegram post rewritten: **dollar depth + token amounts**, no e‑notation.
- [x] `/liquidity-engine` page now has a **🐣 Beginner's Guide** and a **🎓 Advanced Guide**
      (expandable tracks on the page).
- [x] X + Telegram **teaser** posted (what we're building with liquidity management).

### Late-session fixes & state (latest)
- [x] **Reinvestment-alert spam fixed** — the buy poller now skips the MM operator wallet's
      own ops (they were posting as "community reinvestment"). Watch to confirm it's fully quiet.
- [x] **Ask wall strengthened & relocated** — moved from the thin 0.65% pool (stale price,
      mis-behaving) into the deep 0.02% pool (real price, where Jupiter routes buyers); set
      `askWallClknFraction:0.9`; rebuilt as ~2.16M CLKN single-sided asks above price. Funded
      by CLKN only (no USDC), as intended. (Terminology: ASK = sell above price = sells as
      buyers push price up = the engine; BID = buy below price = buy support.)
- [x] **Ask vs Bid added to lessons** — glossary entries + a recurring Cluck's Lesson topic.
- [ ] **Buy support still needs USDC to deepen** — only ~$7 free USDC; it deepens naturally as
      the ask wall sells into buys (accumulates USDC), or add USDC / convert a little SOL.
- [ ] **Add a deploy-idle-CLKN trigger to the ask wall** so it auto-grows as CLKN is added
      (today it only re-centers on price moves / migration). Mirror of the SOL deploy trigger.
- [ ] **Full LP Lab lesson on Ask vs Bid** (supervised — needs quiz mirroring into
      `data/question-bank.json` per the question-bank note).
- [ ] Revisit premium-fee ask wall (0.65%) once pools are deeper — for now 0.02% is correct
      (real price + actually gets routed/filled).
