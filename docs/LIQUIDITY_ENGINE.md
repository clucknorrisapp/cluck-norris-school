# 💧 The Liquidity Engine — Product Strategy & Architecture Deep‑Dive

> Internal design doc. The strategy, custody analysis, technical architecture, pricing,
> and rollout for turning the CLKN market‑maker into a flagship, sellable Cluck Norris
> product. Written to be read top‑to‑bottom in one sitting.

---

## 0. TL;DR

We accidentally built a genuinely differentiated product. While everyone else sells
**wash‑trading "volume bots"** (fake trades, manipulation, reputational poison), we built
an **honest, automated market maker** that puts *real* concentrated‑liquidity depth into a
token's pools, fills *real* traders, and earns fees on *real* volume — and we can **prove
it with our own Token Autopsy**.

That last point is the whole moat: **the only liquidity service that passes its own
forensic audit.** It converts the thing buyers are terrified of (volume bots = scams) into
a *trust* product.

It's live on CLKN today (CLKN/USDC base + CLKN/SOL pool + upside ask‑wall, autonomous
re‑centering + Jupiter inventory rebalancing). The job now is to **productize it**:
multi‑project, a custody model that scales without sinking us in liability, CLKN‑denominated
pricing, and an education layer so customers *understand* what they're buying.

**Recommended path:** sell it in tiers — *Self‑Serve* (non‑custodial, live now), *Managed
Vault* (dedicated float wallet, autonomous, early access), and eventually *Trustless Mode*
(an on‑chain delegate that can only LP, never withdraw). Price in CLKN, holder‑gated, so the
business directly drives token demand.

---

## 1. Why this is a real product (the moat)

1. **A real, multi‑year track record.** This is something an experienced operator (you) has
   done by hand for years and it works. We're not inventing a strategy; we're automating a
   proven one.
2. **It's automated, guardrailed, and live.** Auto re‑center, auto inventory rebalance,
   anti‑thrash, daily caps, slippage caps, price‑gap guard, kill switch — running on real
   money on CLKN right now, inspectable on‑chain.
3. **It's HONEST — and that's the entire differentiator.** Every competitor wash‑trades.
   We provide real depth and can prove it. We literally also sell the tool (Token Autopsy)
   that catches the fakes. Nobody else can credibly make this claim.
4. **It fits the brand perfectly.** Cluck Norris is already: free school → free forensics →
   honest, education‑first tooling. "Operator‑grade liquidity management as a service,
   taught not rented" is the premium tier the whole thing was building toward.
5. **It has built‑in distribution.** We have an audience (the flock), a Telegram, an X
   account, a school, and a forensic toolset that other founders already use. The pitch
   reaches the exact buyer.

**Positioning line:** *"Real depth, not fake volume. The market‑making service that passes
its own audit."*

---

## 2. Product tiers

| Tier | Custody | Autonomy | Who | Status |
|---|---|---|---|---|
| **Self‑Serve** | Non‑custodial (they sign) | Manual | Hands‑on operators | **Live** (`/liquidity`) |
| **Managed Vault** | Dedicated float wallet | Fully autonomous | Founders who want hands‑off | **Early access** (live on CLKN) |
| **Trustless Mode** | On‑chain delegate (LP‑only) | Fully autonomous | Trust‑maximalists / larger clients | **Roadmap** |

The tiers are a natural funnel: try Self‑Serve free → graduate to Managed Vault → enterprises
eventually want Trustless. Each tier teaches the next.

---

## 3. Custody — the central design problem (and the recommendation)

The make‑or‑break question for any liquidity service is **"who can move the money?"** Getting
this wrong is how you become a liability or a headline. Options, honestly assessed:

### Option A — Non‑custodial, client signs every action *(Self‑Serve, live)*
- **Pros:** zero custody risk to us; keys never leave the client; nothing to hack on our side.
- **Cons:** can't be hands‑off; every re‑center/rebalance needs a human signature. Fine for a
  tool, not for a "set‑and‑forget" service.
- **Verdict:** keep as the entry tier. It's the honest, zero‑liability on‑ramp.

### Option B — We hold the client's key (full custody) *(reject)*
- **Pros:** trivial to operate; works for non‑technical clients.
- **Cons:** we'd be **custodians of customer funds** — the worst liability profile in crypto.
  One server compromise drains every client. Likely triggers money‑transmitter / custody
  regulatory exposure. A single mistake is existential.
- **Verdict:** **do not do this.** Not at any scale worth the risk.

### Option C — Dedicated float wallet, key provided or self‑hosted *(Managed Vault, recommended now)*
The client creates a **brand‑new wallet** holding **only the market‑making float** (never the
treasury, never the mint authority). The autonomous agent operates *that* wallet.
- **Pros:** worst‑case loss is **bounded to the float** (a few hundred to a few thousand $),
  not the treasury. Everything is on‑chain and auditable. Client can **withdraw the float at
  any time**. Operationally simple. This is exactly what we run on CLKN.
- **Cons:** the hot key still exists and must be protected; if we run it as a managed service,
  we hold that key (smaller blast radius than Option B, but still custody of *the float*).
- **Mitigations:** dedicated wallet only; per‑client key isolation; encrypted at rest; strict
  withdrawal‑address allowlist baked into the agent (it can only LP + swap within the float,
  it should *never* be coded to send to an arbitrary address); kill switch; transparent
  dashboard; "withdraw anytime" as a contractual + practical guarantee.
- **Two flavors:**
  - **Managed (we run it):** we hold the float key. Easiest for the client. Most liability for
    us — keep the float small and the messaging crystal clear ("this wallet holds only your MM
    float; we cannot touch your treasury").
  - **Self‑hosted (they run our agent):** the client runs the agent in their own environment
    with their own key. **We never touch funds.** Best liability profile; needs packaging
    (a deployable agent + their own config). Strong fit for technical clients.
- **Verdict:** **the pragmatic answer for launch.** Lead with the dedicated‑float model;
  offer self‑hosted to anyone who wants zero trust in us.

### Option D — On‑chain delegate / vault program (LP‑only authority) *(Trustless Mode, endgame)*
A custom Solana program where the client deposits the float into a vault they own, and grants
the agent a **constrained authority** that can **only** perform whitelisted liquidity
operations (open/close/rebalance on specific Whirlpools) and **cannot withdraw to any address
but the client's own.**
- **Pros:** the holy grail — fully autonomous *and* the client keeps custody; we **cannot**
  steal or lose their funds even if our key is compromised. Eliminates the custody liability
  entirely. Becomes a massive trust selling point.
- **Cons:** real smart‑contract engineering + audit cost. This is a project, not a config
  change.
- **Verdict:** **the roadmap differentiator.** Once there's revenue justifying it, this is
  what makes the product enterprise‑grade and basically un‑competeable‑with on trust.

> **Recommendation:** ship the **dedicated‑float Managed Vault** now (it's already built and
> running on CLKN), offer a **self‑hosted** variant for the trust‑conscious, and put the
> **on‑chain LP‑only delegate** on the roadmap as the trust endgame. Never take custody of a
> client's treasury or mint authority — ever. That restraint is part of the brand.

**Hard rules, regardless of tier:**
- We never ask for the treasury wallet or the mint/freeze authority.
- The agent code has **no path** to send funds to a non‑client address. (Audit this.)
- Withdraw‑anytime is real and one‑click.
- Everything is on‑chain; the dashboard just visualizes what anyone could verify.

---

## 4. Revenue model

Everything denominated in **CLKN**, paid via the existing on‑chain micropayment rails — so the
liquidity business is also a CLKN demand engine.

- **Self‑Serve:** free for CLKN holders, or a tiny per‑session CLKN unlock for non‑holders.
  Loss‑leader / funnel top.
- **Managed Vault:**
  - **Holder gate** — must hold a CLKN threshold to qualify (drives sustained holding).
  - **Setup fee** (one‑time, CLKN) + **monthly management** (CLKN).
  - **Optional performance component** — a small share of *fees actually earned* by the
    client's pools (aligns us with real results, not just uptime). Only meaningful once
    volumes are real; keep it clean and transparent.
- **Trustless Mode (later):** premium tier; same structure, higher trust, higher price.

**Why CLKN‑denominated matters:** a growing roster of managed clients = recurring, structural
buy‑and‑hold demand for CLKN. The product's success and the token's utility are the same line
on the graph. Utility first, speculation second — consistent with the whole project.

**Indicative, not committed:** publish ranges as "early access pricing, finalizing." Stay
honest; never quote a number we won't honor.

---

## 5. Technical architecture — from CLKN‑hardcoded to multi‑tenant

### Where we are
- `lib/orca-whirlpools.js` — the engine: pool discovery (Orca API), pool state, range math
  (single‑sided + balanced, orientation‑aware), liquidity quotes, **non‑custodial unsigned
  tx builders** (open/close, with automatic tick‑array init), position listing.
- `lib/whirlpool-vault.js` — the autonomous layer: operator keypair from env, config + state
  in `kvstore`, `tick()` (balanced base), `tickAskWall()` (upside single‑sided wall),
  `tickSol()` (CLKN/SOL pool), `rebalanceInventory()` (SOL↔USDC via Jupiter), `manualSwap()`
  (any‑direction Jupiter swap), guardrails, Telegram alerts, sanitized `publicPositions()`.
- `whirlpool-mm.js` — the router: public read/quote/build endpoints + gated `/vault/*`.
- `public/liquidity.html` — the non‑custodial tool. `public/liquidity-engine.html` — this
  product page. `/liquidity` Telegram command — public depth view.

**The constraint:** it's currently hardcoded to CLKN (mint, pools, a single operator wallet
from one env var, one config/state blob in kvstore).

### What multi‑tenant needs
1. **Per‑project config object** — `{ projectId, tokenMint, quoteMints[], pools{}, operator
   pubkey, strategy params, guardrails }`. Replace the module‑level CLKN constants with a
   config passed through the engine + vault functions. (The engine is already mostly
   parameterized — it takes `address`, `inputMint`, etc. The CLKN/USDC/SOL constants and the
   single‑operator assumption are the main hardcodes.)
2. **Per‑project state namespace** — today state keys are flat (`positionMint`, `wall*`,
   `sol_*`). Move to `vaults[projectId]{...}` (we already proved namespacing with the `sol_`
   prefix; generalize it). **Migration care:** preserve the live CLKN state when refactoring.
3. **Per‑project operator key management** — the riskiest part. For *self‑hosted*, the client
   holds it. For *managed*, an encrypted per‑project keystore (KMS / sealed secrets), never in
   the repo, with strict isolation. For *trustless*, the on‑chain delegate replaces the key
   entirely.
4. **A scheduler that iterates projects** — the current single 3‑minute tick becomes a loop
   over active project configs (staggered to respect RPC limits).
5. **Multi‑tenant dashboard** — the `/liquidity` page + `publicPositions()` generalized so
   each project sees *their* pools, depth, fees, balance status, and controls. Auth per
   project (wallet‑signature login is the clean fit — prove you own the project wallet).
6. **Onboarding flow** — guided: create dedicated wallet → fund float → set token + targets →
   choose tier → go. (The Hatchery is a good UX template for guided, decision‑by‑decision
   flows.)

### The headline feature still to build: the **equal‑pools rebalancer**
The strategy the operator described: keep **token/USDC ≈ token/SOL** in value so SOL's normal
volatility drives arbitrage between them; route big buys through the upside asks (accumulating
quote currency); then rebalance — including **buying the token back** — to hold the balance.
Design:
- **Value each position** (need a `positionValue()` primitive: token amounts from liquidity +
  range + price → USD). This is the missing primitive; build it first.
- **Target = equal value across the managed pools** (configurable split, default 50/50).
- **Rebalance bidirectionally** (SOL↔USDC) and **buy back the token** with accumulated quote
  when a side is short — all via Jupiter, all guarded (never *sell* the token unless explicitly
  enabled for distribution).
- **Deploy idle capital** automatically (we already added "deploy staged USDC" to the base and
  "deploy available SOL" to the SOL pool — generalize into one value‑targeting allocator).
- This is **both** the CLKN feature *and* the product's headline ("it holds the balance and
  replenishes inventory itself"). Build once, sell everywhere.

> ⚠️ Build the rebalancer **supervised**, not unattended — it moves real money. Ship it OFF by
> default, dry‑run first, enable with a human watching, small floats first.

---

## 6. The autonomous strategy (what's running on CLKN today)

- **Balanced CLKN/USDC base** (0.02% tier) — everyday two‑sided depth; the cheap tier wins
  Jupiter routing away from the expensive 2% Meteora main pool, so real buyers get a far
  better price (and we earn the fee). Auto re‑centers; auto‑absorbs staged USDC.
- **Upside ask‑wall** (0.65% tier, single‑sided CLKN) — premium capture selling into pumps.
- **CLKN/SOL pool** (0.02% tier) — sits on the SOL‑driven arbitrage between pools; grows as
  SOL/CLKN is funded.
- **Inventory rebalancer** — swaps SOL↔USDC via Jupiter to keep the base funded; never sells
  CLKN. Plus an ad‑hoc `manualSwap` for corrections / buybacks.
- **Guardrails** — per‑fee‑tier pools, anti‑thrash interval, daily action caps, price‑gap
  anomaly guard, slippage caps, kill switch (`/vault/pause`).

**Operating notes / gotchas learned the hard way:**
- Pristine pools need **tick‑array initialization** before the first position (the engine now
  does this automatically; it self‑heals via retry on RPC propagation races).
- Orca position‑open uses the **PriceDeviation** liquidity quote (it populates the sqrt‑price
  bounds the V2 instruction requires; the default "PriceSlippage" quote leaves them undefined
  → on‑chain error `0x17b5`).
- **CLKN is the binding constraint** across all pools (every pool needs it on one side). Keep
  enough CLKN free, or the pools starve. The equal‑pools rebalancer + buyback is the proper
  fix; until then, fund CLKN generously.
- A fee tier is **fixed per pool** — "changing the fee" means migrating liquidity to a
  different‑tier pool (the vault now does this via a pool‑migration trigger).

---

## 7. Education layer (goal "b": teach, don't just rent)

The product should *teach* liquidity, not hand over a black box — that's the brand and a
genuine differentiator. Assets:
- **The product page** (`/liquidity-engine`) — explains concentrated liquidity, single‑sided
  vs balanced, the arb flywheel, and crucially **real volume vs wash trading**.
- **The LP Lab** (already built — 12 lessons + 7 interactive tools) — the deep course;
  position the Liquidity Engine as "the LP Lab, automated."
- **A "natural volume vs wash trading" explainer** — the ethical/legal core. This is both
  education and de‑risking: customers who understand *why* we won't wash‑trade become
  advocates, not churners.
- **Transparency as teaching** — the dashboard and `/liquidity` command show real depth/fees
  so clients *see* the mechanism working. "Audit it yourself" is pedagogy.

---

## 8. Go‑to‑market / rollout

- **Phase 0 (done):** live reference on CLKN; non‑custodial tool; product + education page;
  README/investor docs updated; `/liquidity` Telegram command.
- **Phase 1 — Early access (now):** hand‑run Managed Vaults for 1–3 friendly Bags projects
  (each with a dedicated float wallet). Tight feedback loop. Use them as case studies.
- **Phase 2 — Productize:** multi‑tenant config + state, per‑project dashboard + wallet‑auth,
  guided onboarding, CLKN pricing live, self‑hosted agent package.
- **Phase 3 — Equal‑pools rebalancer + buyback** as the headline managed feature (supervised
  rollout).
- **Phase 4 — Trustless Mode:** on‑chain LP‑only delegate program (audited). The trust
  endgame; unlocks larger clients.

**Distribution:** the flock + Telegram + X, the existing forensic‑tool user base, Bags
ecosystem goodwill (we already spotlight other projects), and the hackathon/grant narrative
("we built honest liquidity infrastructure for Solana").

---

## 9. Risks & mitigations

| Risk | Mitigation |
|---|---|
| **Custody / key compromise** | Dedicated float wallets only (bounded loss); per‑client isolation; encrypted keystore; agent has no arbitrary‑withdraw path; trustless delegate as endgame |
| **Regulatory (custody / money transmission)** | Prefer non‑custodial + self‑hosted; never hold treasuries; clear ToS; "you fund and can withdraw a dedicated float" framing; legal review before scaling managed custody |
| **Impermanent loss / LVR** | Teach it honestly (LP Lab); choose ranges/fee tiers to balance fee income vs LVR; it's the client's market risk, disclosed up front; never promise profit |
| **"Isn't this just a volume bot?"** | The whole product is the rebuttal: real depth, real counterparties, audit it with our own Autopsy. Refuse fake‑volume requests publicly |
| **Operational (RPC limits, failed txs)** | Helius keys, retries, self‑healing tick‑array init, anti‑thrash, daily caps, dry‑run + supervised enablement |
| **Reputational (a managed client gets rekt)** | Small floats, guardrails, transparency, honest risk education, kill switch; under‑promise |

---

## 10. Honest current status (what's real vs designed)

- ✅ **Live on CLKN:** non‑custodial tool, autonomous vault (base + ask‑wall + SOL pool),
  inventory rebalancer (SOL↔USDC), guardrails, kill switch, `/liquidity` command, product +
  education page.
- 🟡 **Designed, not yet built:** equal‑pools value‑targeting rebalancer + buyback;
  multi‑tenant config/state/dashboard; per‑client key management; pricing/billing.
- 🔮 **Roadmap:** self‑hosted agent package; on‑chain LP‑only delegate (trustless mode).

Keep every public claim on the right side of this line. The honesty *is* the product.

---

*Cluck Norris — real depth, real fills, no fakes. 🐔*
