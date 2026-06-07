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
