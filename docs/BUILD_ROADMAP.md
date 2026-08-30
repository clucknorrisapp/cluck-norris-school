# Cluck Norris — Build Roadmap

Growth/education features beyond the core school. Captured so nothing's lost across sessions.
Owner-prioritized; add/re-order freely.

---

## 1. Per-asset education pages (`/learn/<asset>`)  🟡 IN PROGRESS

**Vision (owner):** dedicated pages for the assets people actually search for — BTC, ETH, SOL, XLM,
etc. Each teaches the project/chain/platform honestly. Doubles as a **discovery engine**: every page
is a landing target we can post under that asset's $TICKER on X to introduce the school to that
coin's community + rank in search ("what is XLM").

**Status:** SOL exemplar page built (`public/learn/sol.html`, live at `/learn/sol`) as the design +
content template. Awaiting design sign-off before fanning out.

**Architecture (planned, once design approved):**
- Data-driven: one template + `data/learn-assets.json` (one object per asset) + a `/learn/:asset`
  route that renders the template with per-asset **server-side OG/meta** (critical for good X cards).
  Adding an asset = one JSON entry.
- `/learn` hub index page listing all assets (cross-linked; nav from `/tools` + school).
- Each page: what it is → how it works → quick-facts table → ecosystem → **honest risks** (matches
  our no-shill ethos) → how to start safely → CTA back to the free school + tools. Live price strip
  via Jupiter's free API (no key).

**Design decisions to confirm:**
- **Asset roster / order** (owner's call — pick by X-community size for reach). Candidate starter set:
  SOL, BTC, ETH, XRP, XLM, DOGE, ADA, LINK, + partners JUP / BAGS. Expand over time.
- **Live data:** keep the live price strip? (built into exemplar; adds freshness + a reason to revisit)
- **Translations:** the school ships 6–7 languages. Start English-only, translate later? (recommended)
- **Static-per-file vs data-driven route** — recommend data-driven for scale + SEO.

**Content accuracy:** each asset gets genuinely researched, balanced copy (grant/hackathon-grade).
Fan-out will use per-asset drafting so facts are right, not filler.

---

## 2. Daily "what do you want to learn?" feedback loop  🔵 QUEUED

**Vision (owner):** post daily on X asking the community what they want to learn about → collect the
replies → turn the most-requested topics into lessons / `/learn` pages / Ask-Cluck content. Turns the
audience into the content roadmap and creates a visible "we listen and ship" flywheel.

**Rough shape (to design):**
- A daily scheduled X post (rotates prompt copy) inviting topic requests — fits the existing scheduler
  pattern (like `tool-spotlight`), tagging @JupiterExchange / @BagsApp for reach.
- A lightweight way to capture/triage replies into a request backlog (kv-backed list, or a gated
  `/api/learn-requests` inbox the operator reviews).
- Close the loop publicly: when a requested topic ships (a `/learn` page or lesson), post "you asked,
  we built it → [link]" and @-reply the requester. That public follow-through is the whole point.
- Pairs naturally with #1: requests feed the `/learn` asset/topic roster.

---

## 3. Depth Desk — non-custodial impact-protection dashboard  🔵 QUEUED · **CLKN Productions service offering**

**Origin (owner, 2026-08-27):** working through Jupiter verification for CUNA and DNC surfaced a
product. Engine work on an outside token is *business* under CLKN Productions LLC — CLKN is our
token, CUNA is a side project. Two hard constraints came out of that conversation and they define
the whole design:

1. **We never hold a client's wallet keys.** Owner: *"I don't want to do that ever."*
2. **CLKN Productions capital never enters a client pool.** We do not absorb someone else's dump.

**The insight that makes it work: the ask ladder is PASSIVE.** The autonomous arb engine needs a
hot key because it re-centers every ~90s. A ladder of single-sided *token* positions sitting ABOVE
spot does not — it is consumed only by buying, needs attention when a tier fills, and is otherwise
inert. So it can be driven entirely by the client signing in their own browser, with the position
NFTs staying in **their** wallet. They can close any tier themselves, without us, at any time.

This **supersedes the "Model A is not the product" conclusion** in `MULTI_TENANT_KEY_HANDLING.md`.
That verdict was correct when the only product was continuous re-centering. It is wrong for a
passive product.

**Second structural property: an ask ladder cannot be drained by a dump.** It sits entirely above
spot; a seller pushes price *down*, away from it. That is exactly the failure that emptied the
narrow two-sided pools on 2026-08-26 — bid-side quote got converted to token by one large sell.
Dump risk lives on the BID side and only there, because bid depth requires quote.

**What it does (all non-custodial):**
- **Six-criteria diagnosis** — read the token against Jupiter's actual verification criteria and
  name which one is blocking. CUNA and DNC were blocked on *different* ones (liquidity vs social),
  same operator, same week — so triage first, never a one-size playbook.
- **Compute the ladder** — tier bands + sizes for a target price impact at a target trade size.
- **One-click deploy** — client connects their wallet, we build the tx unsigned, they sign.
- **Monitor + alert** — tier filled, position out of range, impact drifted, score moved.
- **Verification support** — metadata/circulating-supply correction, application, reassessment.

**Build notes:**
- `openWall()` already takes explicit `lower`/`upper` + USD size, requires the band be above spot,
  and pins each position in `st.anchorMints`. A ladder is N calls — **no new engine code**.
- Reference impl for browser signing is `/locker-room`: build unsigned server-side →
  `provider.signTransaction(tx)` → submit raw. Connected wallet signs FIRST or Phantom flags it.
- ⚠️ Never `SystemProgram.transfer()` in the page (no `Buffer` global) — see CLAUDE.md.
- ⚠️ **Blocker to fix first:** `anchorMints` is honoured in only ONE of three adoption paths
  (the ask-wall stray adopter). `tickTreasury()` and `concentrate()` adopt orphans **by width** and
  would swallow a ladder tier. Harmless today (`dualSleeveEnabled: false` everywhere) but it must
  land before a ladder is standard practice. Two lines, two places.

**The honest limit, to be priced and stated plainly:** without a key we cannot offer autonomous
re-centering, so a non-custodial client gets impact protection + diagnosis but NOT the organic-score
engine. Autonomous service requires the client to **provide tokens** to a dedicated per-client
operator wallet (owner, 2026-08-27) — float only, never a treasury or mint authority, one wallet per
client, never shared. (DNC and CUNA currently share one; that is fine in-house and would be
commingling for a client.)

---

## Notes
- Both #1 and #2 are **discovery/top-of-funnel** plays — the real organic-score + volume lever remains a buy
  competition (see engine notes), but these widen reach and give the brand reasons to post that
  aren't price/liquidity.
- No secrets, additive, auto-deploys from `main`.
