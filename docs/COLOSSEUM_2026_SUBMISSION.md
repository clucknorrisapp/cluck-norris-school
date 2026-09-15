# Colosseum "Crypto World's Fair" 2026 — submission package

**Event:** Colosseum "Crypto World's Fair". **Contest Period: 2026-09-14 06:00 PT (13:00 UTC) →
2026-10-12 23:59 PT (2026-10-13 06:59 UTC)**, per §5 of the Official Rules PDF. Registered
2026-09-12; project draft created 2026-09-14. The disclosure is `docs/PRE_EVENT_STATE.md`; the
pitch leads with what was built inside the window and presents everything older as the platform it
was built on. Nothing here promises a feature that does not exist.

⚠️ **Read `docs/COLOSSEUM_OFFICIAL_RULES_NOTES.md` before writing submission copy.** The Official
Rules are the contract and the website is guidance, and they do not list the same judging criteria.
**§8 judges on: Functionality (including code quality) · Potential Impact · Novelty · UX for
downstream users · Open-source and composability · Business Plan.** Open-source, composability and
code quality are scored and were being claimed nowhere; traction and founder communication are
website language, not named criteria in the contract. Also §9: we must inform the Administrator of
the status and ownership of any open-source or third-party code, which needs a dependency and
licence inventory before submission.

**Submission form asks for:** product description · chain and tools used · team backgrounds ·
location · logo · GitHub repo · 2–3 minute pitch video · 3-minute product demo · go-to-market.
**Judged on (Official Rules §8):** functionality and code quality · potential impact · novelty ·
UX for downstream users · open-source and composability · business plan. (The website's seven —
founder–market fit, insight, product, market size, founder communication, viability, traction —
are guidance; target the union, lead with the six.)

Sections marked `[OWNER]` need a fact only the owner has. Everything else is ready to paste.

---

## 0. AS SUBMITTED — the exact project record (2026-09-14)

This is what was entered on colosseum.com. **Everything else in this document must stay
consistent with it.** If a line below changes, this section is the source of truth and the rest of
the package follows it, not the other way round.

The four long-form answers below are the merged final (2026-09-14): the session's drafts were
reworded independently by Codex and by a second reviewer after the owner rejected the drafts'
register ("liquidity maths is a calculator you can move", "about to get hurt"), and the best
sentences of each were combined. Every fact was re-checked against the code after the merge;
nothing on the must-survive list was lost. The RootCrak credit stays without the referral URL —
a `?ref=` link on a judged technology list reads as promotional; the URL belongs on the site and
in social posts, per CLAUDE.md.

**Project name**

```
Cluck Norris
```

**Brief description** (the form caps this at 500 characters; this is 495 — count characters, not bytes: `awk length` reports 497 because the em dash is three bytes in UTF-8)

```
Cluck Norris (clucknorris.app) is a live Solana platform. What we're working toward: educate, build, earn. Educate: a free crypto school — courses, a hands-on LP Lab, a reference library, live token data and an AI tutor, in multiple languages, no signup. Build: forensics, holder analysis, non-custodial locking and campaign tools projects use to strengthen their communities. Earn: reward programs whose terms and payouts any holder can verify without trusting us. Open source, live on mainnet.
```

**Category**

```
Consumer apps
```

The dropdown also offered AI platform / agent, Token launch / tokenomics, ZK / crypto research and
AI / ML models, among others. Consumer apps is the honest fit: the product is a live consumer
surface — a free school anyone opens with no signup, plus tools a person points at their own
wallet — and two of the six criteria §8 actually scores, Potential Impact and UX for downstream
users, read naturally in that bracket. The runner-up was **Token launch / tokenomics**, which would
have put the Locker Room, lock-to-earn and the in-window Project Hub in front of judges who care
about lock mechanics; it was not chosen because the guided token creator deliberately stops before
liquidity, so that bracket invites a launchpad comparison we lose on purpose, and because it
describes one slice of a school-first platform. AI platform / agent was declined for the same class
of reason — the tutor is a feature of the school, not the product. We train no models, so AI / ML
models and ZK / crypto research do not apply.

**Teammates:** none — §7 limits each person to one team, so an invite would spend that person's
only entry.

**What are you building, and who is it for?** (cap 1000; this is 933)

```
Cluck Norris (clucknorris.app) is a live Solana platform for two audiences.

Individuals learning crypto get a free school: courses from absolute beginner through a belt-ranked core, a hands-on LP Lab with interactive calculators, a reference library, live token data, and an AI tutor in every lesson. Multiple languages, read-aloud audio, no signup, no wallet. Graduates receive a transcript page and an on-chain graduation NFT; a server-side lesson ledger checks completion before the claim is approved.

Small projects growing beyond launch get the operator tools: wallet and token forensics; holder analysis that separates wallets from pools, escrows and program accounts; delegate-approval checks with in-place revocation; batch airdrops; buy competitions paid on verified on-chain buys; and free, non-custodial token locking on the open-source Jupiter Lock program, with Token-2022 support and publicly verifiable lock records.
```

**Why did you decide to build this, and why build it now?** (cap 1000; this is 991)

```
Four or five years ago, not understanding wallets, contracts, liquidity and how price actually moves cost me real money in projects I believed were safe. As a newcomer I also sold out of small projects without understanding what that did to them. Later I was part of a project with a six-figure presale. People around it did not act in good faith and it never found traction. We refunded every presale holder the BNB they put in, but BNB had lost more than half its value by then. I left the space.

When I came back, I decided the only way I would trust a project to do the right thing was to run it myself. I asked several developers to build the school; every one dropped out, so I built it.

Why now: the school is live at clucknorris.app, I have formed CLKN Productions LLC to put a legal structure behind it, and I am moving to the tools other projects can use — liquidity, buy competitions, lock-to-earn. I have done the groundwork to know this is what I want to build and that I can.
```

**How does your product use these chains?** (cap 500; this is 492)

```
Solana mainnet only.

Reads: RPC and DAS for balances, transfer history, holders and pools across SPL Token and Token-2022. Transactions are parsed directly rather than inferred from price feeds, so forensics and buy competitions stay defensible.

Writes touching user funds are non-custodial: built unsigned on the server, signed in the user's wallet. Locks use the open-source Jupiter Lock program. The platform signs only the graduation NFT, paid from the treasury so learners need no SOL.
```

⚠️ That last line is load-bearing and was checked against the code, not assumed. `lib/diploma-nft.js`
signs the graduation mint with the treasury wallet (`MM_OPERATOR_SECRET_TREASURY`) so a learner
needs no SOL. An earlier draft said "we never hold a key", which is false. Every other write path
is genuinely wallet-signed.

**What technologies are you using or integrating with?** (no cap)

```
Chain: Solana web3.js, SPL Token and Token-2022, Anchor, and Metaplex (Token Metadata and Bubblegum for compressed NFTs). All locking uses the open-source Jupiter Lock program. Pool and position reads use the Orca Whirlpools, Raydium v2, and Meteora DLMM, CP-AMM and Dynamic Bonding Curve SDKs, plus the Raydium and Meteora public APIs. Jupiter price and quote APIs, the Jupiter Verified token list, and the embedded Jupiter Terminal plugin for on-site swaps. Wallets connect through Wallet Standard discovery and legacy injection, so in-app wallet browsers work.

Data and risk: Helius RPC and DAS as primary, with failover to public RPC. DexScreener, GeckoTerminal, Birdeye, Solana Tracker, Solscan, CoinGecko and CoinMarketCap for pricing, listings and cross-checks; Rugcheck and DD.xyz (by Webacy) as independent risk signals; pump.fun and Bags.fm launchpad APIs to confirm creator wallets rather than infer them.

Storage: Arweave via ArDrive for permanent token metadata, with Solana-signed upload bundles; IPFS gateway reads; a file-backed key-value store with atomic writes on a persistent volume for consumed payment signatures, the lesson ledger and scheduler state.

Application and infrastructure: Node.js and Express, React 18 with Vite, Tailwind and Zustand; vanilla HTML tool pages; the game runs on Phaser 3. Hosted on Railway behind Cloudflare WAF with origin lockdown. Capacitor wraps the site for the Solana Seeker dApp Store and an education-only Google Play build. Security scanning by RootCrak.

Automation and distribution: Telegram Bot API for a command bot, daily lessons, buy alerts and lock and burn announcements; X API with media upload for automated lesson posts and lock announcements; Google Sheets API for the graduate roster; Google Analytics. Server-side media through node-canvas, gifenc and sharp for share cards and live GIFs, QuickChart for chart images, and Higgsfield for generated artwork.

AI and development: Anthropic Claude — Sonnet 5 for the in-lesson tutor and long-form generation, Haiku 4.5 for classification and live translation — and ElevenLabs for read-aloud audio, with browser speech as a fallback. Claude Code is the primary development tool and has produced a substantial share of the codebase alongside the founder; Codex reviews pull requests.

Testing: GitHub Actions CI with Playwright visual-regression tests on the game, an engine decision simulator that replays real incidents, a multilingual translation audit, and a money-path test battery covering payment verification, hold checks and mutating-route guards.
```

**Is your project a mobile-focused dApp?** — **unchecked.** The web app is mobile-responsive and a
Google Play build shipped 2026-09-11, but that bundle is education-only by design: no wallet, no
payments, no address (`docs/STORE_EDITION.md`). Ticking the box would claim the Play app is the
dApp, and it deliberately is not.

**Notes for judges — Did anyone not listed on the team here do meaningful work on this project?** (cap 600; this is 560)

```
No other people. Cluck Norris is a solo-founder project. A substantial share of the code was written with Claude Code (Anthropic) under the founder's direction, and Codex reviews pull requests; both are tools, not contributors. RootCrak performed external security scanning and we fixed what it found. Everything else is open-source dependencies listed in package.json, and open-source on-chain programs (Jupiter Lock, SPL Token, Metaplex) called as published. Pre-hackathon work and third-party code are disclosed in docs/PRE_EVENT_STATE.md in the repository.
```

The owner asked why a "no" needs five sentences. Because Official Rules §9 obliges us to disclose
third-party code, and an AI tool having written much of the codebase is better heard from us than
discovered. A bare "No" would be accurate about people and silent about that.

**Notes for judges — Is there anything else judges should know about your project that isn't captured above?** (cap 500; this is 500)

```
Beyond the tools above, clucknorris.app also ships Firepit (burn junk tokens, reclaim rent), Project Burn with on-chain proof, Listing Checkup, LP Rescue, Owners Snapshot, Trace, a guided token creator and public Lock of Fame pages. Live since 2025; the pre-window snapshot is commit 75b69cc in docs/PRE_EVENT_STATE.md and the in-window build is the Project Hub. On-chain today: 22 graduates, 488M CLKN locked through our tooling, weekly lock-to-earn payouts. Solo founder, CLKN Productions LLC. MIT.
```

This carries the disclosure line in the form's own words — the platform predates the window, the
snapshot commit and `docs/PRE_EVENT_STATE.md` draw the boundary, the Project Hub is named as the
in-window build — plus the verifiable figures judges would not otherwise see. **The page-view figure was removed on
2026-09-15**: the server analytics count every non-API GET across every host and, since 2026-08-16,
record ~4,500 one-page "visitors" a day with no referrer — automated traffic, not learners (see
`docs/SCHOOL_DEEP_DIVE_2026-09-15.md` §0.3). Only on-chain numbers are claimed now. **The form field
still carries the old text and needs the same edit (owner).** The Bags hackathon was dropped from the form at the owner's call — it reads as a footnote —
and stays only in the §3 founder background.

**Project website:** `https://clucknorris.app`

**Still owner-only on the form:** country of residence, and a team Telegram contact — that field is
how Colosseum reaches us about prize distribution and accelerator interviews, so it must be one
that gets read.

### Why the copy reads the way it does

- **A tool is named only if it is on the tools index or the homepage.** A route answering 200 is
  not the test — `/autopsy` and `/lp-scanner` both answer and both are retired from the product
  surface (owner, 2026-09-14: "we don't use token autopsy anymore"). Check `public/tools.html` and
  `public/home.html`, not the route table.


- **The three words are the aim, not the architecture.** "What we're working toward" — the owner's
  correction. Saying the platform is *built on* educate, build, earn would claim the goal as the
  foundation. Each of the three then shows what already exists under it, which keeps the ambition
  and the evidence visibly separate.
- **"Multiple languages", not a number.** More ship during the window; a count would go stale.
  This applies to paste-ready public copy only — the internal evidence tables below still cite
  today's seven, where being exact is the point.
- **No lesson count.** The school is courses, the LP Lab, the Library and live token data, and a
  lesson tally undersells it.
- **No partner names.** The multi-project layer is the in-window build. Naming partner programs
  now would blur the pre-window line for no gain.
- **Open source and composability are stated on purpose** — both are scored under §8(e) and we
  were claiming neither.
- **"Verify without trusting us"** carries Novelty §8(c) without a yield figure, a rate, or any
  claim that a token is safe. Per CLAUDE.md, Earn describes capability, never a promise.

---

## 1. Product description (paste-ready, ~250 words)

**Cluck Norris** (clucknorris.app) is a free Solana crypto school wrapped around real research and
operator tools. What we are working toward: educate, build, earn.

People lose money in crypto because nobody told them the truth plainly. The school fixes that
first: courses from absolute beginner through a belt-ranked core, a hands-on LP Lab where
liquidity maths is a calculator you can move rather than a lecture, a reference library and live
token data — in multiple languages, with read-aloud audio and an AI tutor embedded in every
lesson. No signup, no wallet, no catch. Finish the curriculum and you earn a permanent transcript
page and an on-chain graduation NFT, gated by a server-side lesson ledger so the credential means
something.

Around the school sit the tools projects need once they are past launch: **Wallet X-Ray** (any
address's observed history, funding origin traced back through recorded transfers), **Holders**
(wallet addresses separated from pools, escrows and program accounts — address classification,
not personhood), **Trace** (wallet × token history
with one-hop follow-the-money), **Wallet Checkup** (delegate approvals, honeypots, mint/freeze
risk — with in-place revoke), a **batch airdropper**, a **buy-competition engine** that pays on what
each wallet actually bought, a **guided token creator** that deliberately stops before liquidity,
and the **Jup Locker Room**: free, non-custodial token locking for any Solana project, built
directly on the open-source Jupiter Lock program, Token-2022 included.

The rule across every tool: a claim has to be backed by something you can open yourself — a
transaction, an account, a launchpad API. We label a wallet "creator" or "team" only when a
launchpad confirms it, never on inference.

The business model is a token that does work instead of begging you to buy it. Learning and safety
stay free for everyone. The heavy tools are free to anyone holding about $50 of CLKN (live-priced),
otherwise 0.05 SOL buys a 7-day pass to all of them. The whole thing is open source under MIT.

### One-liner
> A free crypto school in multiple languages, wrapped around the forensic and operator tools a Solana project needs after launch.

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
  WAF/CDN in front, Capacitor wrapper in the Solana Seeker dApp Store, plus an education-only
  Google Play build (no wallet, no payments — `docs/STORE_EDITION.md`).
- **Wallets:** Phantom, Solflare, Backpack, OKX, Jupiter Mobile and more via legacy injection AND
  Wallet Standard discovery — all non-custodial; a user's keys never touch the server. (The one
  transaction we sign ourselves is the graduation NFT, paid by the treasury so learners need no SOL.)
- **Repo:** https://github.com/clucknorrisapp/cluck-norris-school (MIT).

---

## 3. Team and location

- **Team:** solo founder, operating as CLKN Productions LLC. No co-developers by design (see
  below). `[OWNER — name as it should appear, and whether to state the LLC on the form.]`
- **Location:** `[OWNER — country of residence, as the form asks.]`
- **Logo:** the Cluck Norris mark used on the site header (`public/` icons) — export a 1024×1024 PNG.

### Founder background (owner's own account, 2026-09-14; paste-ready for the form's team section, the pitch video's "why us" beat, and `/about`)

Four or five years ago the founder lost real money in projects he believed were safe, for the
reason the school now exists: nobody had explained wallets, contracts, liquidity, liquidity
percentages, or how price movement actually happens. He also did what newcomers do — held when he
should have taken profit, and sold out of small projects without understanding what a single exit
does to a thin pool or a young community. He was later part of a project with a six-figure presale
that never found traction after people around it failed to act in good faith. The team refunded
every presale holder the BNB they had put in; by the time the refunds landed, BNB had lost more than
half its value. He left the space.

He came back about a year to eighteen months later with one rule: he would not trust anyone else
to do the right thing with a project, so he would run one himself and be the only person
accountable for it. That is why there are no co-developers. He launched Fire Chicken, started
planning a school, and approached several developers to build it; every one dropped out. He built it
himself, and over the following six to nine months learned to build properly — the right tools, no
shortcuts. The project rebranded to Cluck Norris and entered the Bags hackathon as a late entry, which
went nowhere but proved the product could ship. The school at clucknorris.app has grown organically
since, without a team, paid promotion, or a raise.

The larger vision is an ecosystem where the tools he wished he had as a project owner — liquidity
management, buy competitions, lock-to-earn, holder analysis — are available to other projects, on the
belief that projects working together find and build stronger communities than projects competing
alone. He recently formed CLKN Productions LLC to put a legal structure behind the work — the groundwork,
in his words, to know this is what he wants to do and that it can be done. He expects to bring
people on as the brand grows, but wants the base product and its traction to be earned first.

**How to use it.** The form's "why" field carries the compressed version (§0). The pitch video's
"why us" beat is the second paragraph. `/about` gets the whole thing. Keep the two dollar figures
vague — "six-figure", "more than half" — the owner's numbers are close but approximate, and nothing
here should be disputable.

---

## 4. Traction and revenue (true today; refresh the numbers on submission day)

Judges weight traction and revenue. These are all verifiable on-chain or on the live site.

| Signal | Today (2026-09-10) | Where to re-read it |
|---|---|---|
| Learners | 22 graduates with on-chain transcripts; 90-day funnel: 270 school starts → 87 through lesson 1 → 19 graduations (`/api/stats` funnel). **Do not cite page views**: since 2026-08-16 the analytics record ~4,500 one-page, no-referrer "visitors" a day across every host — automated traffic (`docs/SCHOOL_DEEP_DIVE_2026-09-15.md` §0.3) | `/api/school-stats`; `/api/stats` funnel |
| Partner tokens on our infrastructure | 4 — POKE, CUNA, DNC, ROSE: locking, verification, buy comps, and (paused) liquidity engine service | JVP runbook, `docs/CLKN_JUP_VERIFICATION_PROTOCOL.md` |
| Lock-to-earn — mechanism proof | First weekly payout landed 2026-09-09: 13 wallets, one transaction (proves the mechanism runs end-to-end; not a dollar claim) | tx `37hhsCCh…Z2bVkiP` |
| CLKN locks — our own supply, via our own tooling | 73 locks, 48.8% of supply (488M CLKN) | `/api/locks?mint=DW6DF2…BAGS` |
| Live product, public | clucknorris.app, since 2025; Seeker dApp Store listing; education-only Google Play build shipped 2026-09-11 | site |
| Curriculum | 35 lessons, 7 languages, read-aloud, plus the LP Lab and reference Library | `/`, `/lp-lab` |
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
   lock celebrations, buy alerts, meme drops. Low marginal cost per day — model and API usage, measured, not zero.
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
| 0:15–0:45 | Open a lesson. Switch language to Español, then हिन्दी. Tap read-aloud. Ask Cluck a question in the lesson. | "Courses from your first day through advanced, in multiple languages, read aloud, with an AI tutor in every lesson. No signup, no wallet." |
| 0:45–1:05 | `/transcript` page of a graduate; the on-chain NFT on an explorer. | "Finish the course, drop an address, and you get a permanent transcript and an on-chain graduation NFT. A server-side ledger gates it, so the credential is earned, not clicked." |
| 1:05–1:30 | `/wallet-checkup`: paste a wallet with a lingering delegate approval. Show the revoke button. | "Wallet Checkup finds what actually drains people: delegate approvals, honeypots, tokens the dev can still mint or freeze. Find one on your own wallet and revoke it right there. Free, read-only, no account." |
| 1:30–1:55 | `/wallet-xray`: paste an address. Show the funding origin trace and the behaviour read. | "X-Ray tells any wallet's whole story, traced back to its first transaction — and every line of it is a transaction you can open yourself." |
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
3. **0:45–1:15 — The product.** A free school in multiple languages with an AI tutor, wrapped around
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
what is on-chain (funding origin, holder concentration on classified wallets, delegate approvals) and refuse
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
