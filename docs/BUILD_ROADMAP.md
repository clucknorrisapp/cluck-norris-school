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

## Notes
- Both are **discovery/top-of-funnel** plays — the real organic-score + volume lever remains a buy
  competition (see engine notes), but these widen reach and give the brand reasons to post that
  aren't price/liquidity.
- No secrets, additive, auto-deploys from `main`.
