# Solana Foundation Funding Application — FINAL answers (paste-ready)

> Built from a v1 draft reviewed by a five-lens audit panel (skeptical Foundation reviewer,
> accuracy/overclaim auditor, milestones specialist, positioning critic, copy editor — all five:
> "maybe → yes if fixed"; every fix is applied below), plus the owner's directives: no graduate
> counts, the product is FULLY BUILT and the ask is an adoption plan, $6,000 request (owner said
> $5–7k), and the Foundation's recognition matters as much as the money.
>
> Form rules honored: no links in fields that don't ask for them (the Website URL field carries
> the link); milestones in the "$X due upon completion…" format with use-of-funds + verification.
> Bracketed [SLOTS] are the only things left for the owner to fill.

---

## Company name
Cluck Norris — School of Crypto Hard Knocks

## Website URL
https://clucknorris.app

## Country
United States

## First Name / Last Name / Email Address
[legal first name] / [legal last name] / [email]

## Solana On-Chain Accounts
DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS (project token mint), [OPTIONAL: operations/fee-payer wallet — recommend listing 2zMCUkE9pBjcC7ihtLqm28EsCoEHVmCdJYr5262EuPy8, it's already publicly linked to the project on-chain]. No custom program deployed — the app composes existing programs (Jupiter Lock, Orca Whirlpools, Meteora DLMM, Metaplex) rather than introducing new on-chain risk.

## Funding Amount
$6,000

## Which funding category are you applying for?
Developer Education & Ecosystem

## Your project / idea
Cluck Norris is a free, MIT-licensed crypto school where Solana newcomers learn on-chain safety by doing — and then prove it: the final exam is drawn from a 210-question bank, scored server-side so the answer key never reaches the browser, and a pass at the 94% bar mints a permanent, wallet-keyed transcript anyone can verify. It is proof of passed knowledge, not a completion badge.

The school runs from "what is a wallet" to advanced liquidity strategy, in seven languages with text-to-speech: a beginner track, a 12-lesson core course, an LP School with interactive impermanent-loss and fee-breakeven calculators, a Survival Simulator that drills learners with simulated capital — 10 scenarios per run drawn from a bank of 135 real-world cases (rug pulls, drainer links, honeypots) — and a curriculum-grounded AI tutor. The thesis is that safety education only sticks when it ends in action, so the school's lab is a suite of free, token-agnostic tools that work on any Solana token or wallet with no signup and no wallet-connect: Token Autopsy (multi-phase forensics on any mint), Wallet X-Ray (any wallet's full history and behavior), holder Snapshots, and a Wallet Safety Checkup for the lingering approvals and honeypots that actually drain beginners. The newest expression of that thesis is the Locker Room: free, non-custodial token locking for any Solana project, built directly on the open-source Jupiter Lock program — no fee, no token cut, lock education attached, and a public "Lock of Fame" so any holder can verify a project's locked supply. Because it calls the program directly, it locks any token, including unverified Token-2022 mints other lock interfaces won't list yet; third-party projects used it within days of launch. The same open-source codebase gives developers forkable primitives: the server-scored credential system, the forensic engines, and a no-wallet-connect on-chain micropayment pattern.

Why I want to work on this: the retail wave arriving through Solana launchpads is full of first-time users who don't know what a token approval is or what a rug looks like — and Solana's fees are low enough that safety can be taught by doing, not by slideshow. The ecosystem above is fully built, live in production, free, and on the Solana Seeker dApp Store. What it needs now is not construction but reach — this application is a plan to introduce more people to it.

I was not referred by a Solana Foundation partner. This is a reapplication: an earlier, much smaller version was reviewed previously and we were told a reapplication would be welcome once things had changed for us. They have — the server-scored credential system, seven languages, the forensic suite, the Locker Room, and the Seeker release all shipped since.

## Is / will this project be open sourced?
Yes

## Specify the amount of funding you are requesting and list the milestones
Requesting $6,000 total, milestone-based. The product is fully built and self-hosting, so every dollar funds adoption — introducing more people to a working ecosystem — and every completion criterion is verifiable by the Foundation without trusting us: product work ships in the MIT-licensed public repository, adoption numbers come from on-chain data, public pages the Foundation can enumerate itself, or a third-party analytics dashboard shared read-only.

$1,500 due upon completion of Milestone 1 deliverable (Product for growth — target: month 2): (a) every Locker Room lock transaction tagged with an on-chain attribution memo, so third-party use of the free locker becomes permanently countable by anyone with a block explorer; (b) the school's full translation layer extended to two additional languages (seven → nine), live with text-to-speech; (c) the crawlable curriculum layer and shareable outputs (verifiable transcripts, Lock of Fame reports) expanded so every learner artifact is a public, linkable page. Verification: all live in production, visible in the public repo's commit history. Funds cover native-speaker translation review, text-to-speech synthesis costs, and development time.

$2,250 due upon completion of Milestone 2 deliverable (Adoption — people — target: month 4): 2,500 unique monthly visitors and 1,500 monthly free-tool runs across the school and tools, measured by a third-party analytics service with a read-only dashboard shared with the Foundation (not self-reported summaries). Funds cover the outreach that causes those numbers — translated launch pushes in each of the school's languages, workshops and content collaborations with Solana communities — plus the marginal infrastructure of serving free users at that scale (AI-tutor inference, text-to-speech, RPC).

$2,250 due upon completion of Milestone 3 deliverable (Adoption — ecosystem — target: month 6): (a) 25 distinct third-party token projects (mints other than our own) with locks created through the free Locker Room, each countable on-chain via the Milestone 1 attribution memo against the Jupiter Lock program — no trust in our reporting required; and (b) 5 outside projects publicly using the free tools, evidenced by public posts from each project's own official channels (an announcement, a holder snapshot, or a competition run on our tooling) — a list of links the Foundation clicks, not analytics we compile. Funds cover hands-on onboarding of projects to the Locker Room and sustaining it as free, zero-fee, zero-token-cut public infrastructure.

## Relevant metrics about the usage of your project/product
The strongest signal so far is that the ecosystem is used by projects beyond our own community, and that usage is publicly checkable:
- Within days of the Locker Room launching, third-party projects (e.g. XPX, ROSE) created token locks through it — those escrows exist on the Jupiter Lock program today and are enumerable on-chain.
- The Rose community runs its buy competitions and holder snapshots on our free tooling.
- The app is live on the Solana Seeker dApp Store, ships in seven languages with text-to-speech, and has shipped continuously since April 2026 — the public commit history shows the cadence.
- [FILL FROM ANALYTICS BEFORE SUBMITTING — the form explicitly asks for visits/usage: "X unique visitors and Y free-tool runs in the last 30 days" — pull from /api/stats; state plainly as the baseline Milestone 2 grows from.]
- We practice what we teach: roughly 19% of our own token's supply is locked across 28+ on-chain escrows, publicly visible in the Lock of Fame we built — the same standard of public verifiability the milestones above use.
- An active Telegram community where the free AI tutor answers learner questions in-chat daily.

## Competition
Direct competitors, closest first:
- Solana-native education (Superteam's learning content, Ackee's School of Solana, Rise In): the closest in spirit, but they teach developers how to build on Solana. Nobody in that group teaches retail users how to survive Solana — wallets, approvals, rugs, honeypots — end-to-end, in seven languages, ending in an earned credential. Our diploma requires passing a 50-question server-scored exam at a 94% bar and mints a permanent wallet-keyed transcript: proof of passed knowledge, where quest-style credentials attest task completion.
- Generic crypto academies and quest platforms (Coinbase Learn, Binance Academy, Layer3): chain-agnostic content or click-through-for-rewards tasks; no hands-on practice environment, no exam bar.
- Token-vetting tools (RugCheck, Bubblemaps, DexScreener audit tabs): strong single-purpose forensics that hand users findings without teaching what the findings mean. Our tools are the lab attached to a curriculum, covering the full journey — wallet history, token forensics, approval safety, snapshots — free, in one place, with no signup and no wallet-connect.
- Lock interfaces (Jupiter Lock's own UI, Streamflow, UNCX): we build ON Jupiter Lock rather than against it. Our edge: zero fee and zero token cut, lock education attached, a shareable Lock of Fame for public accountability, and locking any token including unverified Token-2022 mints other UIs won't list yet.
The one-line differentiator: nowhere else on Solana does retail safety education end in a server-scored, wallet-keyed credential plus the free tools to act on it — taught by a project that runs those same tools on its own token in public.

## How is this project a public good?
It qualifies both ways the Foundation defines the term:
- Meaningful free community offering: the entire school (curriculum, Survival Simulator, AI tutor, server-scored exams, verifiable diplomas, seven languages) and every core tool (Wallet X-Ray, Token Autopsy, Snapshot, Wallet Safety Checkup, the Locker Room) are free and token-agnostic — they work for any Solana user and any Solana project, with no signup and no wallet-connect required to learn. The Locker Room charges no fee and takes no cut of locked tokens.
- Significant open-source contribution: the whole codebase is MIT-licensed and public — the curriculum engine, the server-scored credential system, the forensic engines, and a reusable no-wallet-connect micropayment pattern (verify an on-chain SPL payment with no wallet-connect, no signature request, no custody) that any Solana builder can fork to lower the friction and risk surface of paid features.
The free layer is not a funnel: none of it requires holding our token, and this grant funds that free layer's reach specifically.

## Why You?
I'm a solo builder who has already shipped the entire thing — school, server-scored exams, wallet-keyed credentials, seven languages, the forensic tool suite, the Locker Room, and the Solana Seeker release — live in production with near-daily updates since April 2026, all visible in the public commit history. For milestone-based funding, that's the evidence that matters: these milestones extend a shipping machine, they don't fund a roadmap. The curriculum is honest because it comes from operating experience with exactly the mechanics that hurt newcomers — token approvals, rug pulls, honeypots, impermanent loss, locks and vesting — learned firsthand, including locking roughly 19% of our own token's supply in public escrows. I entered Solana through a launchpad community and built the school for the first-time users I watched get hurt there; supporting other projects with free tooling is already how we operate. Because everything is MIT-licensed in a public repository with infrastructure anyone can redeploy, the public good doesn't depend on me personally — the milestones stay auditable either way. The project already has working revenue plumbing (optional micro-payments of about a cent on a few premium operator tools), so it builds on with or without funding; this grant accelerates next year's push to bring more people in. And candidly, the Foundation's recognition would compound whatever the dollars do: a public signal that free, honest safety education belongs on Solana puts it in front of the newcomers who need it in a way no budget can.

---

## PRE-SUBMISSION CHECKLIST (do these, then submit)
1. [ ] Fill the [SLOTS]: legal name, email, the 30-day visitors/tool-runs numbers from /api/stats, and decide whether to list the ops wallet.
2. [x] Repo consistency: CLAUDE.md language count updated six → seven (audit caught it contradicting the application).
3. [ ] Milestone 1(a) head start: the Locker Room attribution memo is small to build — shipping it BEFORE submitting turns a promise into "already live." Say the word.
4. [ ] Form fields "Company name → Email" and the category dropdown per this doc; "Open sourced" = Yes radio.
5. [ ] Do NOT paste any URL outside the Website URL field (all answers above are link-free by design).
