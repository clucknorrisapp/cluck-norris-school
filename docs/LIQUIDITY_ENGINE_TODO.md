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
- [ ] **Multi‑tenant refactor** (makes it sellable)
  - [ ] Per‑project config object (token, quotes, pools, operator, strategy, guardrails).
  - [ ] Per‑project state namespace (generalize the `sol_` prefix pattern; preserve live CLKN state on migration).
  - [ ] Scheduler loops over active projects (staggered for RPC limits).
  - [ ] Per‑project key management (encrypted keystore for managed; self‑hosted option for trust).
- [ ] **Client dashboard** — per‑project depth / fees / balance / controls; wallet‑signature auth.
- [ ] **Guided onboarding flow** — create dedicated wallet → fund float → set token + targets → choose tier → go (Hatchery‑style UX).
- [ ] **Pricing / billing** — CLKN setup + monthly, holder‑gate, optional perf fee.
- [ ] **Self‑hosted agent package** — deployable agent + client config (we touch nothing).
- [ ] **Trustless Mode** — on‑chain LP‑only delegate program (audited). The trust endgame.
- [ ] **Pending‑fee readout** — show accrued (uncollected) fees so earnings are visible live.
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
- [ ] `MODES` preset table in `lib/whirlpool-vault.js` (each = a partial config + a tilt).
- [ ] `applyMode(name, tilt?)` that patches config; add a `mode`/`tilt` field to state so we
      can show the active mode. **Default = "custom" (current config); applying nothing changes
      nothing** — never auto-apply a mode to the live CLKN vault.
- [ ] Endpoint `POST /api/whirlpool/vault/mode?key=…` (gated) + dry-run preview of the diff.
- [ ] Surface active mode in `/vault/status`, the `/liquidity` post, and the product page.
- [ ] Per-mode Beginner + Advanced guide copy on `/liquidity-engine` (brand standard).
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
