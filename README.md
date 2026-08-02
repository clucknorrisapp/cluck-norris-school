# 🐔 Cluck Norris: School of Crypto Hard Knocks

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Built on Solana](https://img.shields.io/badge/Built%20on-Solana-9945FF)](https://solana.com)
[![Powered by Bags.fm](https://img.shields.io/badge/Powered%20by-Bags.fm-orange)](https://bags.fm?ref=firechicken007)
[![Live App](https://img.shields.io/badge/Live-clucknorris.app-green)](https://clucknorris.app)
[![Auto-deployed on Railway](https://img.shields.io/badge/Deploy-Railway-blueviolet)](https://railway.app)

> *"We took the hard knocks so you don't have to."*

**A free crypto school for Solana, wrapped around free research tools and a handful of paid operator tools — funded by a token that does real work instead of begging you to buy it.**

Everything that teaches is free. No signup, no wallet connect to learn, no subscription. The paid tools are the handful that actually cost money to run — and they are free outright if you hold CLKN.

Live at **[clucknorris.app](https://clucknorris.app)**.

---

## 🆓 The school

Three tracks, all free, in **seven languages** (English · Español · हिन्दी · Italiano · Português · Tiếng Việt · 中文), with read-aloud audio on every lesson.

| Track | Size | For |
|---|---|---|
| 🥚 **The Incubator** | 7 lessons | Total beginners — wallets, tokens, on/off-ramps, DEXs, liquidity, market cap, not getting drained |
| 🏫 **School of Hard Knocks** | 12 lessons | The core course, belt-ranked Freshman → Emeritus |
| ⚗️ **[LP Lab](https://clucknorris.app/lp-lab)** | 14 lessons | Liquidity providing in depth — impermanent loss, ranges, fees, bins, DLMM shapes, laddering — with interactive calculators throughout |

Plus **📚 the Library** (glossary + deep dives across Survival / Research / Concepts) and **🤖 Ask Cluck**, a Claude-powered tutor embedded in every lesson, live in the Telegram group, and standalone at [`/ask-cluck`](https://clucknorris.app/ask-cluck).

Finish the full curriculum, drop a Solana address, and you get a permanent, shareable **[`/transcript`](https://clucknorris.app)** page plus an on-chain graduation NFT. Learning itself stays walletless — the address is only for the transcript and the airdrop list.

A **"where do I start?"** concierge meets newcomers on the landing page and in the Telegram group, so a feature-rich app doesn't overwhelm a first-timer.

---

## 🛡 Guardrails first

Most token utilities assume you already know what you're doing. This one makes you understand first.

- Every paid tool requires an explicit **"I understand"** before payment instructions appear
- The airdropper ships with an inline lesson on how airdropping actually works
- Every action page carries a stay-safe checklist — verify the URL, never share a seed phrase, read every wallet popup, no custody
- The send screen shows a **wallet-popup pre-flight** so you can sanity-check the numbers before your wallet asks you to approve them

First-timers are the target user. The guardrails are the point, not decoration.

---

## 🔨 Free tools

No wallet connect, no account.

- **🩻 [Wallet X-Ray](https://clucknorris.app/wallet-xray)** — paste any Solana address and get its whole story: the **true funding origin** traced to its first transaction (dust filtered, exchange hot-wallets identified), every buy/sell/transfer across **every** token, and a behavior read — bot cadence, fast-flip dumping, CEX cash-out, LP, or diamond hands. Searchable timeline, charts, a deep-scan mode for heavy wallets, and a built-in AI you can ask about any single transaction.
- **👥 [Holders](https://clucknorris.app/holders)** — who *really* holds a token. Separates true human holders from LP pools, lock escrows and program accounts; measures supply concentration **on humans only** (a raw top-10 counts pool vaults as whales — they aren't); and exports any slice as an airdrop-ready CSV. Filter to any group and hand it straight to the airdropper.
- **🔍 [Trace](https://clucknorris.app/trace)** — wallet × token history: every transaction between one wallet and one mint in order, with running balance, counterparty flow map, and one-hop follow-the-money.
- **🛡 [Wallet Checkup](https://clucknorris.app/wallet-checkup)** — read-only scan for the things that actually drain people: lingering delegate approvals, honeypot / can't-sell holdings, and tokens whose dev can still mint or freeze. Find an approval on your own wallet and you can **revoke it right there**, signing yourself. (The old Security Coop merged into this page; `/security-coop` still resolves here.)
- **🎒 [Bags Hub](https://clucknorris.app/bags)** — live launches, near-graduation and recently-graduated feeds, backed by our own 48h graduation tracker.

The forensic rule holds across all of them: **the chain shows what happened, never why.** Every signal is on-chain evidence, not a verdict — and we only call a wallet "creator" or "team" when a launchpad API confirms it.

---

## 💎 Paid tools

Hold CLKN and they're free. Don't, and there's a small one-click SOL price. No
subscriptions, no accounts.

| Tool | Cost |
|---|---|
| 💰 **[Batch airdrop sender](https://clucknorris.app/airdrop)** | **Free** holding 50,000 CLKN (35 days) · else **0.05 SOL** (7 days) |
| 🎯 **[Buy Special](https://clucknorris.app/buyspecial)** — buy-competition engine | **Free** holding 2,000,000 CLKN (35 days) · else **0.05 SOL** (7 days) |
| 🔬 **[Premium Forensics](https://clucknorris.app/premium)** | Holder-gated on a live 2,000,000 CLKN balance |
| 🥚 **[The Hatchery](https://clucknorris.app/hatchery)** — guided token creator | **0.1 SOL**, or the CLKN equivalent at a **~30% discount** · free for 2M+ holders |

The Hatchery is the one place you can still *pay* in CLKN, and it's deliberately ~30%
cheaper than the SOL price. The token amount is computed live from the CLKN price so it
holds that discount as the market moves — check `/api/hatchery/config` for today's figure
rather than quoting a number. It isn't a manual send: the CLKN transfer is an instruction
inside the same mint transaction your wallet already signs, so there's nothing to copy
and nothing to wait for.

Extra AI tutoring used to be a paid unlock too. It isn't any more — Ask Cluck has a
free daily allowance and that's the whole offer.

**Buy Special** runs a full contest cycle: it discovers pools **on-chain** (a token's own AMM vaults, so it never goes blind when an indexer hasn't listed something), pays on what each wallet **actually bought in the window** rather than its balance, disqualifies wallets that sold inside the window, and traces one hop to whoever still holds when a buyer moved their tokens. Winners hand off to the airdropper in one click. It has moved real money.

**Premium Forensics** adds recipient-dump tracing, money-flow and cash-out mapping, a creator "rap sheet", wallet P&L, and a neutral shared-funding cluster map. Nothing is fabricated when a source is unavailable — every report states what it could and couldn't compute.

---

## 🥚 Connect-wallet tools

Two places you *do* connect — not to hand anything over, but to **sign your own transactions**. Keys never touch the server.

- **[The Hatchery](https://clucknorris.app/hatchery)** — a guided SPL token creator that explains every mint-time decision (supply, decimals, metadata, mint/freeze authority), stores metadata permanently on Arweave, and **deliberately stops before liquidity**. Minting a token is not launching a project, and a token with no pool can't rug anyone. 0.1 SOL, or CLKN at a discount; free for 2M+ holders.
- **[The Jup Locker Room](https://clucknorris.app/locker-room)** — free, non-custodial token locking for **any** Solana project, built directly on the open-source Jupiter Lock program, **Token-2022** mints included. Because it calls the program directly, the whole flow is ours: every field is explained in plain English before you sign, so a first-time team can prove they can't dump without needing to already understand vesting. **No fee** — users pay only network gas, and tokens go into the audited Jupiter escrow, never through us. Every lock carries a `locked via clucknorris.app` memo, and each project gets a shareable **Lock of Fame** page to broadcast the receipt.

---

## 🔐 How access works

Connect a wallet and the gate resolves itself: if you hold the threshold, the tool
unlocks free for 35 days. If you don't, one click sends the SOL price and unlocks it
for 7. Where the gate is *ownership* rather than payment — Premium Forensics, and
proving a transcript is yours — you sign a one-line message instead. That's a
signature, not a transaction: no tokens move, no spending approval is granted, and
nothing lingers afterward.

### What we tried before, and why it's gone

Until July 2026 every paid door worked without a wallet connect at all. The app minted
a unique amount like `100.347 CLKN`, you sent exactly that from any wallet, and the
server matched the decimal to your session and read your address out of the
transaction. It was replay-guarded, anti-tampered, and it worked exactly as designed.

Almost nobody used it. The idea was that skipping the connect prompt removed friction —
but copying an exact amount into a wallet by hand, sending it, and waiting for the chain
turned out to be *more* friction than the popup it avoided, not less. So we retired it.

We're saying that plainly rather than quietly deleting it, because the reasoning is the
point: we don't yet know whether the manual send was the limiting step or whether the
tools simply need more exposure. Simplifying is how we find out. **The code still
exists and the endpoint is still live** — if the simpler version doesn't move the
needle, turning it back on is a small change, not a rebuild. Being early to an idea and
being wrong about it look identical from the inside; we'd rather test it than defend
it.

- SOL payments are verified against an on-chain **minimum the server clamps up to**, so a tampered client can't bless a dust payment as a full one
- Ownership signatures must name the signing wallet and carry a **fresh nonce**, so a captured signature can't be replayed later
- A proof of ownership is never a proof of *holdings*: Premium Forensics re-reads the live CLKN balance on every single run, so a proof issued to an empty wallet buys nothing

**Holding is what earns the free tier**, and it's read live from the chain at the moment
you connect — not from a receipt, and not from anything you can hand us.

---

## 💧 The Liquidity Engine — in testing, not offered yet

Most "volume bots" wash-trade: the operator buys and sells their own token through wallets they control to fake activity. This is the opposite — a concentrated-liquidity market maker that puts **real two-sided depth** into a token's pools, so real buyers and sellers get tighter spreads and less price impact, and fees come from genuine trades.

Two layers: **non-custodial position builders** (the server builds unsigned open/close/collect transactions, the operator signs them) and an **autonomous vault** funded from a dedicated hot wallet whose key lives only in the server environment — unset means the whole thing is off, a safe no-op. Guardrails throughout: anti-thrash intervals, daily action caps, slippage and price-impact ceilings, an anomaly guard, and a one-flag kill switch.

The idea under test is **multi-quote**: pairing a token against several quote assets (USDC + SOL + JUP) means each quote's *own* volatility dislocates the token's price across pools, and third-party arbitrageurs trade it back into line — producing genuine two-way volume the project never generated itself.

**Status, honestly:** it runs on CLKN's own pools, hands-on managed, while we learn what it really does. It is **not offered to other projects**. Impermanent loss is real and the big-sell scenario is real; we'd rather under-promise and let the on-chain record speak. Runs on Orca Whirlpools, with Raydium CLMM and Meteora DLMM adapters built to the same interface.

---

## 📣 Community & automation

The product reaches into Telegram and X, not just the website.

- **Cluck's Lesson** — short crypto-safety micro-lessons written by Claude, posted daily on a fixed UTC schedule, rotating through the real curriculum without repeating until the set is exhausted
- **Ask Cluck, in-chat** — reply to any lesson and the bot answers in thread. Strictly educational: it declines price and buy/sell questions and ends every reply with a not-financial-advice line
- **Buy / sell alerts** — a 30-second poller posts every real CLKN trade with USD value, price, market cap and route, plus a ~12-minute reconciliation sweep that recovers anything a transient hiccup dropped, durably de-duped so it can never double-post
- **Lock celebrations** — a new lock is detected on-chain, composed, illustrated and posted to X and Telegram, with a progress tracker toward the next supply-locked milestone
- **Slash commands** — `/guide`, `/walletxray`, `/trace`, `/holders`, `/securitycoop`, `/buyspecial`, `/hatchery`, `/bags`, `/liquidity`, `/tools`, via a secret-validated webhook
- **📱 Solana Seeker dApp Store** — the site is wrapped as a native Android app (Capacitor) and is live in the Seeker store. It loads the live site, so every ship reaches the app instantly. *Honest scope: deeper Mobile Wallet Adapter / Seed Vault integration is roadmap, not built.*

---

## ⚙️ Tech

| Layer | Choice |
|---|---|
| Frontend | React + Vite (the school) · vanilla HTML + inline JS (tool pages) |
| Backend | Node.js + Express on Railway, auto-deployed from `main` |
| AI | Anthropic Claude — tutor, lessons, forensic narration |
| Solana RPC | Helius (DAS + enhanced transactions), with automatic failover to backup endpoints and a public node |
| Token data | Bags.fm · DexScreener · GeckoTerminal · Bubblemaps · Jupiter · Solana Tracker · Solscan |
| Liquidity venues | Orca Whirlpools · Raydium CLMM · Meteora DLMM — one engine, per-venue adapters |
| Persistence | Railway volume at `/data` — consumed payment signatures, transcripts, schedulers, analytics; survives redeploys |
| Wallet signing | Phantom · Solflare · Backpack · OKX · Jupiter + 6 more, all non-custodial |
| Security | per-IP rate limiting · default-deny RPC method allow-list · replay-proof payments · XSS output escaping · HSTS / X-Frame-Options / Referrer-Policy |

Admin, operator and holder-gated routes return **404 rather than 401**, so probing them tells you nothing.

**Public API:** `/api/wallet-xray` · `/api/snapshot` (the holder engine) · `/api/trace` · `/api/wallet-checkup` · `/api/token-overview` · `/api/ask-cluck` · `/api/verify-clkn-payment` · `/api/hatchery/*` · `/api/security-coop/*` · `/api/holders`, `/api/locks`, `/api/fees`, `/api/supply` · `/api/bags-*` · `/api/helius-rpc`, `/api/helius-tx` (keys hidden server-side) · `/api/credential/:slug`, `/api/school-stats`

### CI

There is no staging environment — `main` deploys straight to production — so the gate is a set of cheap tripwires, each of which exists because something got past the previous ones:

- `node --check` on every backend entrypoint and lib
- **undefined-JSX-component guard** — an undefined component compiles fine and only throws at runtime; one shipped and left the LP Lab blank in production for a day
- **curriculum count guard** — the landing page advertised "72 exams · 6 beginner lessons" when the truth was 70 and 7
- **render smoke test** — opens every screen and all 33 lessons in headless Chromium, failing on an uncaught error or a blank page
- **level-geometry guard** for the game — jumpability, no floating fixtures

---

## 🪙 The token

**Cluck Norris (CLKN)** — Solana SPL, partnered to the FireChicken community.

- **Mint:** `DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS`
- **Trade:** [bags.fm](https://bags.fm/DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS?ref=firechicken007) · [Jupiter](https://jup.ag/tokens/DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS)
- **Project fee:** ~1% of every CLKN trade — real SOL revenue, 100% reinvested into buying CLKN on the chart
- **Liquidity:** Meteora DAMM V2 (`64WXkHM4zyWUkYy32TfUeBV5wDAfdcUGDxe5ntM4xaTd`, the canonical chart), plus project-run Orca depth across a multi-quote layout (CLKN/USDC · CLKN/SOL · CLKN/JUP)
- **Mint and freeze authority are renounced.** A meaningful share of supply is locked across Jupiter Lock and Streamflow — verifiable by anyone, and every new lock is announced with the on-chain numbers

---

## 🤝 Ecosystem

- **🎮 Normie Quest** — a complete crypto-education platformer (original pixel art, 21 worlds, boss fights themed on real market lessons, leaderboards, playtest telemetry) built under Cluck Norris production for the **NORMIE** community — a separate project with its own token. It's the proof the stack white-labels beyond our own. Access and reward mechanics are still being agreed with the NORMIE team, so nothing about them is promised here.
- **🔒 The Locker Room as shared infrastructure** — any project locks free, gets a public Lock of Fame page, and can broadcast the receipt. The on-chain memo makes the relationship verifiable rather than claimed.
- **Building through the bear.** The tools, the school, the game and the lock infrastructure are being hardened now, so they're standing when the cycle turns.

---

## 🔥 The pitch, in one breath

A free crypto school disciplined enough to be useful, wrapped around forensic tools that tell you what's on-chain and refuse to tell you why — with the operator tools free to anyone holding the token.

Learn fast. Avoid rugs. Survive the schoolyard.

---

## 📄 License

MIT. Fork it, fork the model, build your own school. Just don't expect the bird to be impressed.

*Cluck Norris doesn't teach softly.* 🐔
