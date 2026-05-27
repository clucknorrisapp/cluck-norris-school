# 🐔 Cluck Norris: School of Crypto Hard Knocks

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Built on Solana](https://img.shields.io/badge/Built%20on-Solana-9945FF)](https://solana.com)
[![Powered by Bags.fm](https://img.shields.io/badge/Powered%20by-Bags.fm-orange)](https://bags.fm?ref=firechicken007)
[![Live App](https://img.shields.io/badge/Live-clucknorris.app-green)](https://clucknorris.app)
[![Auto-deployed on Railway](https://img.shields.io/badge/Deploy-Railway-blueviolet)](https://railway.app)

> *"No participation trophies. No hand‑holding. Just hard knocks."*
>
> **A Bags.fm token where the school is free, token research is free, and premium tools are paid for in CLKN — wrapped in guardrails that teach first‑timers before they can hurt themselves.**

Four things, in one product:

1. 🆓 **A free crypto school** — disciplined, voice‑driven, no signup, no wallet
2. 🩺 **Free token research** — a 0–100 health score, holder snapshots and transaction tracing for any Solana mint, plus a free wallet‑safety checker
3. 🔒 **Premium operator tools** — buy‑competition trackers and a batch airdrop sender, unlocked with on‑chain CLKN micropayments
4. 🥚 **A guided token creator** — mint a real SPL token, taught decision by decision

The token does real work. The school keeps people alive long enough to use it.

---

## 🛡 Guardrails first

Most token utilities treat users like they already know what they're doing. **Cluck makes you understand before you can use.**

- Every paid tool requires an **"I understand"** acknowledgment before payment instructions appear
- The airdropper has a built‑in **"How airdropping works"** lesson the user can expand inline
- The school's Library has a full standalone **"How to Use an Airdropper Without Burning Yourself"** deep dive — same content, lives independent of the tool
- Every action page shows a **stay‑safe checklist** (verify URL, never share seed phrase, read every wallet popup, no custody)
- The send screen shows a **wallet‑popup pre‑flight** so users can sanity‑check the numbers their wallet will ask them to approve

First‑timers are the target user. The guardrails are the differentiator.

---

## 🆓 The Schoolyard — free, forever

Disciplined learning, real value, zero gatekeeping. The flock learns or the flock gets rugged.

- 🥚 **The Incubator** — 7 lessons for total beginners. Wallets, tokens, on-ramps & off-ramps, DEXs, liquidity, market cap, how not to get drained
- 🏫 **School of Hard Knocks** — 12 progressive lessons with a belt ranking from **Freshman → Emeritus**. Pass to promote
- 🥊 **The Ultimate Challenge** — 50 questions. 94% to pass. No study guide. Most don't make it. That's the point
- 🎮 **Survival Simulator** — start with $1,000 simulated capital. Each run draws 10 scenarios at random from a bank of **135** real‑world crypto situations (DM "alpha", dev wallet dumps, FOMO buys, 900% APR pools, phishing impersonators, wallet drainers, leverage liquidations, exchange freezes, vesting unlocks) — so no two playthroughs are alike. Every choice has a multiplier; Cluck explains why each move worked or didn't. **Practice the decisions before you have to make them with real money.**
- ⚗️ **LP Lab** — interactive liquidity training. IL calculator, fee breakeven, capital efficiency, AMM price impact. Works on Meteora, Raydium, Orca, Uniswap — anywhere you LP
- 📚 **The Library** — 50‑term glossary, deep‑dives across Survival / Research / Concepts (including 🪂 *How to Use an Airdropper Without Burning Yourself*), curated resources
- 🤖 **Ask Cluck Norris** — Claude Haiku tough‑love crypto professor embedded in every lesson. 10 questions/day. No signup. No wallet
- 🩺 **Cluck Score** — free 0–100 token‑health score for **any** Solana mint, served at [`/score`](https://clucknorris.app/score). Six weighted factors, LP‑filtered top‑10 concentration, sharable PNG card. **Live now.**
- ⚡ **Embedded Jupiter** — full DEX aggregator, CLKN preselected
- 🎒 **Live Bags Feed** — every new launch, real‑time prices, direct trade links

---

## 💎 Pay the bird — premium tools, CLKN only

Pay only when you use it. No subscriptions. No accounts. No wallet connect. Just send the exact decimal and the tool unlocks.

| Tool | Cost | ≈ USD | What unlocks |
|---|---|---|---|
| 🤖 More AI tutoring | **500 CLKN** | ~$0.06 | 20 extra questions |
| 🪧 Cluck Score card (sharable PNG) | **100 CLKN** | ~$0.01 | 1 card |
| 💰 Batch airdrop sender | **100 CLKN** | ~$0.01 | 1 unlock session, any batch size |
| 📈 Buy‑competition trackers (Buy Special · Rose) | **500 CLKN** | ~$0.06 | **7 days unlimited runs** each — full contest cycle (initial scan + tweaks + hold check + re‑verification) |

Pennies to pay, accessible to anyone. The token does real work without becoming a paywall.

**Holder bonus, on‑chain, unforgeable.** When the server verifies your payment, it also reads how much CLKN you have *left* in the same transaction. Keep **≥ 2M CLKN** (~$240) after the send and every unlock is multiplied **5×**. The send proves custody. The post‑send balance proves holding. Neither requires a wallet connect. A serious holder paying 500 CLKN for the buy‑comp analyzer gets a full **35 days** unlimited.

---

## 🥚 Create & protect — connect‑wallet tools

Two tools where you *do* connect a wallet — not to hand over anything, but to **sign your own transactions**. Keys never touch the server.

- **🥚 The Hatchery** — a guided SPL token creator. It walks you through every mint‑time decision (supply, decimals, metadata, mint/freeze authority) and deploys the token, with metadata stored permanently on Arweave. It **deliberately stops at liquidity** — minting a token is not launching a project, and a token with no pool can't rug anyone. Flat fee: **0.1 SOL**, or the CLKN equivalent at a built‑in discount; **free for 2M+ CLKN holders**.
- **🔒 Security Coop** — a free wallet permission check. Scans your SPL token accounts for lingering **delegate approvals** — the one permission that genuinely persists on Solana — and revokes any you don't recognise. Connecting a wallet grants nothing; signing an "approve" does, and this is how you take it back.

---

## 🔐 How the no‑wallet‑connect payment works

You hit a paid feature. The app generates a unique amount like `100.347 CLKN` (3‑decimal precision = 1000 unique values per tool — server matches the exact decimal to your session). You send exactly that amount from any wallet you control. The server polls Solana, finds the matching transaction, identifies your sending wallet from the tx metadata, and unlocks the feature.

- **No Phantom popup. No connect button. No signature request.**
- **2‑minute polling cap** with a "↻ check again" restart — saves Helius quota from idle visitors
- **Sticky countdown banner** shows exactly how long the unlock has left (`5d 0h 0m`, `0:32:15`, etc.)
- **Anti‑tampering**: floor of the paid amount must match the tool's declared price. Can't pay 100 CLKN to unlock a 500‑CLKN tool.

The tools that *do* execute on‑chain — the airdrop sender, the Hatchery, and Security Coop — use a **Phantom · Solflare · Jupiter** wallet picker and you approve every transaction yourself. Connecting shares only your address; the server never sees a key.

---

## 🩺 Cluck Score — the free moat

[clucknorris.app/score](https://clucknorris.app/score) — paste any Solana mint, get a 0–100 health score in seconds.

**Six weighted factors:**

| Factor | Weight | What it measures |
|---|---|---|
| Holders | 20% | Anchored to Jupiter's verification minimum (500 holders = 50 score, 5000 = 100) |
| Liquidity health | 25% | Liq÷FDV summed across all Solana pools. +5 bonus for multi‑DEX presence |
| Top‑10 concentration | 20% | **LP / lock / program filtered** — only counts actual human wallets |
| Mint authority | 15% | Revoked = 100, still active = 0 |
| Freeze authority | 10% | Revoked = 100, still active = 0 |
| 24h volume | 10% | Log scale — $10k+ = 100 |

The concentration filter is the differentiator: we fetch the owner of each top‑20 token account and exclude positions held by AMM pool authorities, Streamflow/Jupiter Lock contracts, and program PDAs. The "top 10 wallets" number reflects **actual humans**, not the AMM holding the LP.

Open the score directly with a query param — handy for sharing or linking:
```
https://clucknorris.app/score?mint=DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS
```

Cards (`/api/cluck-card?mint=…`) unfurl on Twitter / Telegram / Discord automatically.

---

## 🤔 Why this is different from every other token

| Most tokens | CLKN |
|---|---|
| Wallet connect for everything | Free school and research never connect; you connect only to *sign your own* transactions in the create / send / revoke tools |
| "Governance rights" you'll never exercise | Real tools you actually use |
| One‑time staking lock that ties up supply | Per‑use micropayments — token actually changes hands |
| Roadmap promises | Already deployed, working, in production on Railway |
| User figures it out themselves | Education built into every paid action, with a hard acknowledgment gate before the first send |

---

## 🛠 Token‑agnostic Solana tooling (the moat)

1. **🩺 Cluck Score** — public 0–100 health score for any Solana mint, with LP‑filtered concentration and a sharable PNG card. Free.
2. **🐔 Holder Truth Engine** *(internal, powers Cluck Score)* — six‑signal classification (on‑chain owner field → known programs → DexScreener pairs → AMM pool vault bytecode scan → Bubblemaps → activity heuristic → manual overrides). Catches Bags.fm DBC pool authorities that look System‑Program‑owned but aren't. The LP‑filtered concentration logic in Cluck Score runs on this engine.
3. **📈 Buy‑Competition Trackers** — two flavours on one engine: **buyspecial** (every qualifying buyer rewarded) and **Rose** (ranked prizes for the top buyers). A value‑flow engine reads net on‑chain balances, so it counts every real buy — any pool, any aggregator, any pay currency — never miscounts a wallet‑to‑wallet transfer as a buy, splits credit by who actually holds the tokens, and traces transfers one hop to the wallet that should be paid. Hands results straight to the airdropper.
4. **💰 Batch Airdrop Sender** — Phantom / Solflare / Jupiter‑signed SPL transfers, auto‑ATA creation, deduping, CSV / manual / equal‑split modes, dynamic batching for Solana's 1232‑byte tx limit, SOL rent pre‑flight estimate, exportable send record with Solscan links. The user's keys, never the server's.
5. **🥚 The Hatchery** — guided SPL token creator. Every mint‑time decision explained, metadata to Arweave, stops at liquidity on purpose. Flat SOL/CLKN fee.
6. **🔒 Security Coop** — wallet permission check: scans for lingering token‑delegate approvals and revokes them. Free, non‑custodial.
7. **📸 Snapshot** — holder snapshot for any Solana mint: every wallet and balance, LP and locked liquidity filtered out by default, exported as an airdrop‑ready CSV. Free, no wallet connect.
8. **🔍 Trace** — wallet × token forensic history: every transaction between a wallet and a mint in chronological order, with running balance and fund origin. Free.

---

## ⚙️ Tech stack

| Layer | Choice |
|---|---|
| Frontend | React + Vite + vanilla HTML for tool pages |
| Backend | Node.js + Express on Railway |
| AI tutor | Anthropic Claude Haiku 4.5 |
| Solana RPC | Helius (DAS + enhanced txns) |
| Token data | Bags.fm API + DexScreener + Bubblemaps + Jupiter |
| Score card rendering | `@napi-rs/canvas` with bundled Oswald typeface |
| Trophy log | Google Sheets (JWT auth) |
| Wallet signing | Phantom · Solflare · Jupiter Wallet |
| Security | HSTS, X‑Frame‑Options, Content‑Type‑Options, Referrer‑Policy on every response |
| License | MIT |

**Public API:**
- `/api/cluck-score?mint=…` — 0–100 score with full factor breakdown (JSON)
- `/api/cluck-card?mint=…` — 1200×630 PNG card for sharing
- `/api/verify-clkn-payment` — tool‑aware unlock verification with holder bonus
- `/api/ask-cluck` — Claude‑powered tutor
- `/api/hatchery/*` — token creator: Arweave metadata upload, unsigned mint‑tx build, live fee config
- `/api/security-coop/*` — wallet delegate‑approval scan + unsigned revoke‑tx build
- `/api/holders`, `/api/locks`, `/api/fees`, `/api/supply`, `/api/bubblemaps` — Solana token telemetry proxies
- `/api/bags-proxy`, `/api/helius-rpc`, `/api/helius-tx` — Bags / Helius proxies with API keys hidden server‑side
- `/api/claim` — trophy submissions to Google Sheets

---

## 🪙 The token

**Cluck Norris (CLKN)** — Solana SPL token, partnered to the FireChicken community

- **Contract:** `DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS`
- **Trade:** [bags.fm](https://bags.fm/DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS?ref=firechicken007) · [Jupiter](https://jup.ag/tokens/DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS)
- **Project fee:** ~1% on every CLKN trade — real SOL revenue, 100% reinvested into buying CLKN on the chart
- **Jupiter Ref:** `A4fSbCMAya9rLWY4incNYaVfhYA9mpCownbFEW3dUZAg` — 0.1% swap fee
- **Liquidity:** Meteora DAMM V2 (`64WXkHM4zyWUkYy32TfUeBV5wDAfdcUGDxe5ntM4xaTd`)
- **Live stats:** Holder count and lifetime trading fees are pulled fresh from on‑chain via `/api/holders` and `/api/fees`. See current numbers on the [TOKEN DATA tab](https://clucknorris.app) of the live app.

---

## 🔥 The whole pitch in one breath

Cluck Norris is the only project on Bags.fm where every premium feature is a CLKN micropayment verified on‑chain — no wallet connect, no custody, no subscription — wrapped around a free crypto school disciplined enough to fail you, funny enough to keep you coming back, and **opinionated enough to slow you down at the moment you might hurt yourself**.

Learn fast. Avoid rugs. Survive the schoolyard.

---

## 📄 License

MIT. Open source. Fork it, fork the model, build your own school. Just don't expect the bird to be impressed.

*Cluck Norris doesn't teach softly.* 🐔
