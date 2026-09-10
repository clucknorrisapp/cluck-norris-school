# Colosseum "Crypto World's Fair" 2026 — submission package

**Event:** Colosseum "Crypto World's Fair", **September 14 – October 12, 2026**. Registration is
open at colosseum.com; the owner registers the team before Sep 14. **Rules that shape this
document (verified 2026-09-10):** products are judged only on work completed between the start
and end dates; pre-existing code is allowed but all prior development must be disclosed
(misrepresentation = disqualification); prize tracks are by ecosystem — we enter the **Solana**
track. The disclosure is `docs/PRE_EVENT_STATE.md`; the pitch must lead with what was built
inside the window and present everything older as the platform it was built on. Everything below is drafted from
what is LIVE on clucknorris.app on 2026-09-10 — nothing here promises a feature that does not exist.

**Submission form asks for:** product description · chain and tools used · team backgrounds ·
location · logo · GitHub repo · 2–3 minute pitch video · 3-minute product demo · go-to-market.
**Judged on:** founder–market alignment · insight · product quality and positioning · market size ·
founder communication · business viability · traction and revenue.

Sections marked `[OWNER]` need a fact only the owner has. Everything else is ready to paste.

---

## 1. Product description (paste-ready, ~250 words)

**School of Crypto Hard Knocks** is a free Solana crypto school wrapped around real research and
operator tools, live at clucknorris.app.

People lose money in crypto because nobody told them the truth plainly. The school fixes that
first: 35 lessons across three tracks (a beginner Incubator, the core belt-ranked course, and an LP
Lab with interactive calculators), in **seven languages** with read-aloud audio, plus an AI tutor
embedded in every lesson. No signup, no wallet, no catch. Finish the curriculum and you earn a
permanent transcript page and an on-chain graduation NFT, gated by a server-side lesson ledger so
the credential means something.

Around the school sit the tools people actually need once they are in: **Wallet X-Ray** (any
address's full story, true funding origin traced to its first transaction), **Holders** (human
holders separated from pools, escrows and program accounts), **Trace** (wallet × token history
with one-hop follow-the-money), **Wallet Checkup** (delegate approvals, honeypots, mint/freeze
risk — with in-place revoke), a **batch airdropper**, a **buy-competition engine** that pays on what
each wallet actually bought, a **guided token creator** that deliberately stops before liquidity,
and the **Jup Locker Room**: free, non-custodial token locking for any Solana project, built
directly on the open-source Jupiter Lock program, Token-2022 included.

The forensic rule across every tool: the chain shows *what* happened, never *why*. We only call a
wallet "creator" or "team" when a launchpad API confirms it.

The business model is a token that does work instead of begging you to buy it. Learning and safety
stay free for everyone. The heavy tools are free to anyone holding about $50 of CLKN (live-priced),
otherwise 0.05 SOL buys a 7-day pass to all of them. The whole thing is open source under MIT.

### One-liner
> A free crypto school disciplined enough to be useful, wrapped around forensic tools that tell you what's on-chain and refuse to tell you why.

---

## 2. Chain and tools used (paste-ready)

- **Chain:** Solana mainnet. Programs called directly: SPL Token and Token-2022, Jupiter Lock
  (open-source lock program, used for the Locker Room and for lock-to-earn accounting), Metaplex
  (graduation NFTs, Hatchery metadata), Orca Whirlpools / Raydium CLMM / Meteora DLMM (adapters for
  the Liquidity Engine — an operator-run concentrated-liquidity service we have run for four
  partner tokens; paused by the owner since 2026-09-05 while the public dashboard is built; not
  self-serve).
- **RPC and data:** Helius (DAS + enhanced transactions) with automatic failover; Jupiter price
  and quote APIs; DexScreener, GeckoTerminal, Bags.fm, Solana Tracker, Solscan, Bubblemaps.
- **Storage:** Arweave for permanent token metadata.
- **AI:** Anthropic Claude — the tutor, daily lessons, forensic narration.
- **Stack:** React + Vite (school), vanilla HTML tool pages, Node.js + Express on Railway, Cloudflare
  WAF/CDN in front, Capacitor wrapper live in the Solana Seeker dApp Store.
- **Wallets:** Phantom, Solflare, Backpack, OKX, Jupiter Mobile and more via legacy injection AND
  Wallet Standard discovery — all non-custodial; keys never touch the server.
- **Repo:** https://github.com/clucknorrisapp/cluck-norris-school (MIT).

---

## 3. Team and location `[OWNER]`

- **Team:** `[OWNER — names, roles, one line each. CLKN Productions LLC.]`
- **Founder background:** `[OWNER — the "hard knocks" origin: what you lost, what you learned, why a
  school. Judges score founder–market alignment; the personal story is the evidence.]`
- **Location:** `[OWNER]`
- **Logo:** the Cluck Norris mark used on the site header (`public/` icons) — export a 1024×1024 PNG.

---

## 4. Traction and revenue (true today; refresh the numbers on submission day)

Judges weight traction and revenue. These are all verifiable on-chain or on the live site.

| Signal | Today (2026-09-10) | Where to re-read it |
|---|---|---|
| Learners and visitors | 140,462 lifetime page views · 105,185 visitor-days lifetime · ~5k visitors/day this month · 22 graduates | server analytics; `/api/school-stats` |
| Partner tokens on our infrastructure | 4 — POKE, CUNA, DNC, ROSE: locking, verification, buy comps, and (paused) liquidity engine service | JVP runbook, `docs/CLKN_JUP_VERIFICATION_PROTOCOL.md` |
| Lock-to-earn — mechanism proof | First weekly payout landed 2026-09-09: 13 wallets, one transaction (proves the mechanism runs end-to-end; not a dollar claim) | tx `37hhsCCh…Z2bVkiP` |
| CLKN locks — our own supply, via our own tooling | 73 locks, 48.8% of supply (488M CLKN) | `/api/locks?mint=DW6DF2…BAGS` |
| Live product, public | clucknorris.app, since 2025; Seeker dApp Store listing live | site |
| Curriculum | 35 lessons, 7 languages, read-aloud | `/`, `/lp-lab` |
| Services model | verification, lock-to-earn, buy comps, engine — priced per project `[OWNER]` | this doc §5 |
| Community | `[OWNER — Telegram members, X followers]` | |
| Security | Cloudflare WAF cutover + origin lockdown live since 2026-08-04, from findings by our scan partner RootCrak (@ro0TCr4k, https://rootcrak.com/?ref=clucknorris) | README |

---

## 5. Go-to-market (paste-ready)

**Who it is for.** Two users, one funnel. (1) The newcomer who just bought their first Solana
token from a Telegram tip and has no idea what a delegate approval is. (2) The small project
team — a 2–5 person meme or community token — that needs to prove it can't rug, run a fair buy
competition, or airdrop a holder list, and today does it by hand or pays a bot.

**The wedge is safety, free.** Wallet Checkup, X-Ray previews and the school cost nothing and need
no wallet. They are the top of the funnel and the brand: honest, plain-spoken, forensic. A user
who arrives to check one approval finds a school and a tutor.

**The Locker Room is the flagship story.** Any project locks free, gets a public Lock of Fame page
and a broadcastable receipt with an on-chain memo. Every lock made through us announces itself on
X and Telegram, so the product markets itself each time a team uses it. Lock-to-earn on top of
that turns "we locked" into "our holders are paid to lock", which is the mechanic that keeps a
community's float off the market — proven live with the CUNA program.

**Distribution.**
1. Partner-token communities first. Each token we run infrastructure for (locks, buy comps,
   lock-to-earn, verification) brings its whole Telegram into the school and the tools. Four
   today; each one is a warm referral to the next.
2. Telegram and X automation as the content engine: a daily Claude-written lesson, in-chat tutor,
   lock celebrations, buy alerts, meme drops. Zero marginal cost per day.
3. Seven languages. Most Solana education is English-only; ES/PT/VI/HI/ZH/IT are where the next
   wave of first-timers is, and the whole school ships there already.
4. Solana Seeker dApp Store presence for mobile-first users.
5. Open source under MIT: fork the school, fork the model. Contributors and forks are reach.

**Pricing.** Learning and safety free forever. Heavy tools: hold ~$50 of CLKN or 0.05 SOL / 7 days.
Hatchery: 0.1 SOL. Project services (verification, lock-to-earn, buy comps): operator engagements
priced per project. `[OWNER — state the per-project figure or "custom"]`.

**Why now.** Rug volume is up, nobody cares about autopsies after the fact, and Jupiter Lock plus
Token-2022 made verifiable "we can't dump" cheap. The team that makes locking and proving it
one-click, and teaches the holders why it matters, owns the trust layer for small tokens.

**Market size (sourced).** Galaxy Research, *The State of Memecoins* (2025-10-01,
galaxy.com/insights/research/memecoins-pump-fun-solana-kols): more than 32 million tokens exist
on Solana, 12.9 million of them launched on Pump.fun alone, and just 12 tokens hold 56% of that
launchpad's $4.8B fully diluted value. Every one of the other millions has a team that needs to
prove it can't rug and holders who bought without a lesson. That long tail, not the 12 winners,
is our market. `[OWNER — add one line on how many of those are live communities today if you
have a number; otherwise this stands.]`

---

## 6. Three-minute product demo — script and shot list

Record at 1080p, desktop browser, plus one phone insert. Screen capture with voiceover; no
slides. Every screen below is live today. Keep a wallet with ~$50 of CLKN connected so the gate
resolves "free" on camera. **Do not open Normie Quest prize pages and do not mention Wallet Watch.**

| t | Shot | Voiceover |
|---|---|---|
| 0:00–0:15 | Landing page, slow scroll. "Where do I start?" concierge visible. | "Cluck Norris is a free crypto school on Solana, wrapped around the tools people actually need once they're in. Nothing that teaches costs anything." |
| 0:15–0:45 | Open a lesson. Switch language to Español, then हिन्दी. Tap read-aloud. Ask Cluck a question in the lesson. | "Thirty-five lessons, seven languages, read aloud, with an AI tutor in every lesson. No signup, no wallet." |
| 0:45–1:05 | `/transcript` page of a graduate; the on-chain NFT on an explorer. | "Finish the course, drop an address, and you get a permanent transcript and an on-chain graduation NFT. A server-side ledger gates it, so the credential is earned, not clicked." |
| 1:05–1:30 | `/wallet-checkup`: paste a wallet with a lingering delegate approval. Show the revoke button. | "Wallet Checkup finds what actually drains people: delegate approvals, honeypots, tokens the dev can still mint or freeze. Find one on your own wallet and revoke it right there. Free, read-only, no account." |
| 1:30–1:55 | `/wallet-xray`: paste an address. Show the funding origin trace and the behaviour read. | "X-Ray tells any wallet's whole story, traced back to its first transaction. The chain shows what happened. We never claim to know why." |
| 1:55–2:20 | `/holders`: a token. Toggle humans-only concentration. Export a slice to the airdropper. `/airdrop` with the CSV loaded, pre-flight shown. | "Holders separates humans from pools and escrows and hands any slice straight to the airdropper, with a wallet pre-flight so you check the numbers before your wallet asks." |
| 2:20–2:45 | `/locker-room`: start a lock. Show the plain-English field explanations. Cut to a Lock of Fame page and the lock celebration post on X. | "The Locker Room locks any Solana token on Jupiter Lock, free, non-custodial, Token-2022 included, every field explained before you sign. Each lock gets a public page and announces itself." |
| 2:45–3:00 | Phone insert: `/cuna-payout` receipt or the lock-to-earn page; then the GitHub repo. | "On top of locks, lock-to-earn pays holders weekly for keeping supply locked. First payout landed this week. All of it open source, MIT." |

**Shot list checklist.** Landing · lesson with language switch · transcript + NFT on explorer ·
Wallet Checkup with a real approval · X-Ray trace · Holders → airdropper hand-off · Locker Room
form + Lock of Fame + X post · phone insert · repo page. Nine captures, each under 30 seconds.

---

## 7. Two-to-three-minute pitch video — outline

Founder on camera, or voice over b-roll of the product. Judges score founder communication here;
this is the video where the owner talks, not the product.

1. **0:00–0:20 — The hard knock.** `[OWNER — the personal loss or the moment that started this.]`
   "We took the hard knocks so you don't have to."
2. **0:20–0:45 — The problem.** People lose money because nobody told them the truth plainly.
   Education is either a shill or a textbook. Tools assume you already know what you're doing.
3. **0:45–1:15 — The product.** A free school in seven languages with an AI tutor, wrapped around
   forensic tools that say what is on-chain and never why, and a free lock room any project can
   use to prove it can't dump. Guardrails before power: first-timers get warned before they can
   hurt themselves.
4. **1:15–1:45 — Traction.** Live since 2025. 73 locks and nearly half of CLKN supply locked
   through our own tooling. Lock-to-earn live for a partner token with its first payout on-chain
   this week. Four partner tokens running our infrastructure. Seeker dApp Store. `[OWNER —
   graduates and community numbers.]`
5. **1:45–2:15 — Business.** A token that does work: hold it and the heavy tools are free;
   otherwise a small SOL pass. Mint fees, trade fees, per-project services. Learning stays free
   forever because that is the funnel and the brand.
6. **2:15–2:45 — Why us, why now.** `[OWNER — founder–market fit in one breath.]` Jupiter Lock and
   Token-2022 made verifiable trust cheap; we made it one click and taught the holders why it
   matters. Open source, MIT, security-scanned with fixes shipped.
7. **2:45–3:00 — Close.** "Learn fast. Avoid rugs. Survive the schoolyard. clucknorris.app."

---

## 9. Competitive landscape — from Colosseum Copilot (read 2026-09-10)

Colosseum Copilot indexes every prior submission (Renaissance Mar 2024 · 1,076 — Radar Sep 2024 ·
1,360 — Breakout Apr 2025 · 1,416 — Cypherpunk Sep 2025 · 1,576). Judges have the same corpus.
Four similarity searches (crypto education, wallet forensics, token locking / lock-to-earn,
wallet safety), each re-run with `winnersOnly` and `acceleratorOnly`, plus an archive pass. All
claims below are "as far as the corpus shows, as of 2026-09-10" — absence of evidence is not
evidence of absence, and the current hackathon's entries are not indexed yet (a search for our
own name returns nothing).

**Education (cluster of 162).** Nearest: GALIA, Educational Platform on Blockchain Basics, Girls
That Crypto, Edu-crypto (all Renaissance, Mar 2024), CopyCats (Radar, Sep 2024). Mobile courses
and quiz games; none placed, none is still live. The only education winner in the corpus is
Zircon (Public Goods Award, Renaissance) — developer challenges, not consumer safety. No
education project has entered the accelerator. Nobody in the cluster ships seven languages, an AI
tutor, or a server-gated on-chain credential.

**Rug detection (two clusters, ~450 projects).** Rug Raider, AI Guardian, amIrug.xyz (Breakout,
Apr 2025), Pepelock, Agent Cypher, MintEye. Every one is an **AI risk score**: paste a token, get
a verdict. None placed. The winners near this space protect the *wallet*, not the judgment:
Unruggable (hardware wallet — Grand Prize Cypherpunk, accelerator C4), Lazor Kit (invisible
wallets, honourable mention Breakout). The one accelerator company touching rug-checking is
Crypto Dropcopy (C1, Renaissance: PnL + SGX rugcheck). Our angle is the opposite of a score: show
what is on-chain (funding origin, human-only holder concentration, delegate approvals) and refuse
to say why. Say it in the pitch: verdict scanners bless tokens that then rug — we retired our own
Cluck Score for exactly that reason.

**Locking.** Capult Eternal Vaults (permanent locks, Renaissance), Zenlok (private vesting on
Arcium, Cypherpunk), NOOTTOOLS (launcher with milestone locks, Cypherpunk); none placed. The one
vesting winner is Valhalla.so (honourable mention, Renaissance, Mar 2024) — a DAO-governed vesting
program. Nothing in the corpus builds on Jupiter Lock, is free for any project, or pays holders to
lock. A lock-to-earn program with a real weekly payout has no precedent we could find.

**Wallet safety.** Beyond Unruggable and Lazor Kit, the field is AI wallets (Armor, Neptune) and
link scanners (Detectify). Nothing matches Wallet Checkup's read-only scan with in-place revoke.

**Archive framing (Galaxy Research, *The State of Memecoins*, Oct 2025).** 32M+ Solana tokens,
12.9M from one launchpad, 12 of them holding 56% of its FDMC. The long tail is millions of teams
and holders with no trust layer and no education — the market in section 5.

**Positioning line for the pitch:** every overlapping entry is a prototype in one of our four
boxes, and the winners nearby protect keys, not judgment. We are the only one with all four live,
open source, with revenue, and with the honesty rule that keeps the tools from becoming another
risk score.

Source: `copilot.colosseum.com` with the owner's Copilot token (read-only, expires 2026-12-09).
The token is NOT in the repo. The Copilot skill is installed at `.agents/skills/colosseum-copilot`
(symlinked into `.claude/skills/`); a session with `COLOSSEUM_COPILOT_PAT` in its environment can
re-run any of these searches.

---

## 8. Pre-submission checklist

- [ ] Owner registers on colosseum.com before **Sep 14**; confirms the track/prize category on the
      live site (the pasted schedule was out of date — the event is the Crypto World's Fair).
- [x] Settle the Liquidity Engine / JVP wording — README, `/about`, `/liquidity-engine` and this
      doc all now carry the one sentence (2026-09-10).
- [ ] Fill every `[OWNER]` placeholder in this file.
- [ ] Refresh the traction table numbers on submission day from the endpoints listed.
- [ ] Record the nine demo captures (section 6) and the pitch video (section 7).
- [ ] Export the logo at 1024×1024.
- [ ] Keep Normie Quest to one aside at most: reward and prize terms are unagreed, so promise nothing.
- [ ] Do not mention Wallet Watch anywhere.
- [ ] Security mentions credit RootCrak and carry the referral link.
- [ ] Use the section 9 positioning line in the pitch video and the product description.
