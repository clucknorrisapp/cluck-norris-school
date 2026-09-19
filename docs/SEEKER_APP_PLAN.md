# The Seeker app — CLOCK IN hackathon build plan

**Owner decision, 2026-09-19: we are building it, and we are building it to win.**
*"I want the complete rebuild. I want to win the Solana Mobile Hackathon."*

This document exists because two sessions each gave a half-answer to "which repo?" and the owner
could not get a straight one. **It is the decision of record. Do not re-litigate it; amend it.**

---

## 1. Which repo — the straight answer

**Build the app HERE. Ship it from `CLKN-SEEKER`.**

A Capacitor app's screens, wallet flows, on-chain calls and logic are a web bundle. That bundle is
built in this repo, as a fourth store variant (`store-seeker`), and handed to the apps repo as a
pinned `store-edition-seeker-<ver>.tgz` exactly like `google` and `ios` already are.

| Work | Repo | Rough share |
|---|---|---|
| Mobile-first screens, wallet UX, on-chain calls, AI, copy, i18n, tests | **this repo** | ~85–90% |
| 4th Capacitor target, MWA native plugin, Seed Vault, signing, dApp Store publish | `CLKN-SEEKER` | ~10–15% |

The apps repo is **blocked** until the artifact exists — `store-edition.lock` has only `google` and
`ios` today. So this repo goes first.

## 2. What "complete rebuild" means, precisely

**Rebuild the CLIENT. Keep the PLATFORM.**

- ✅ A new mobile-first frontend variant, designed for a phone from the ground up — not a
  responsive website in a shell, and not the desktop tool pages reflowed.
- ⛔ **Do not rewrite `server.js`, `lib/`, the endpoints, the engines or the school.** A live site,
  a Google Play app and an iOS app all depend on that exact surface. The new app calls it.

The hackathon's own rule is the reason this distinction matters, not a preference:
*"Direct ports or PWA wrappers with little mobile optimisation will score poorly."* A port is what
loses; a new client over a proven backend is what wins.

## 3. What we already have (so this is 19 days, not 90)

Verified in-repo, not assumed:

- **Wallet connect and signing** — `cluck-wallet.js` does legacy injection *and* Wallet Standard
  discovery (added 2026-09-05 after a Jupiter Mobile user could not connect in-wallet).
- **A working paid-access model** — the unified tools pass, a **signed session**: the wallet signs
  a nonce, `POST /api/tool-gate/session` verifies it and issues an HMAC token. Not a pasted address.
- **An AI tutor** — Ask Cluck, already a product, in seven languages.
- **RPC plumbing** — `/api/helius-rpc`, `lib/rpc` failover, both token programs.
- **The rent maths** — shipped and tested on `/solana/rent` (#362).
- **An APK pipeline** — `npm run build:solana` → `assembleRelease` in the apps repo.
- **A dApp Store publisher account, listing assets and screenshots.**

⚠️ The one thing we do **not** have and cannot get from a container: **a real connect-and-sign on a
device.** No session has ever exercised it. The owner has the Seeker and the Mac; that is a hard
dependency on his time, not an optional check.

## 4. What the app is

One thing done superbly beats five done adequately. Judged on stickiness, UX, mobile-native use and
Solana interaction:

**Hero: rent reclaim.** Your wallet has dead token accounts holding your SOL. Connect, scan, see
exactly what is reclaimable and what is not, tap, sign with MWA, watch the SOL arrive.
Real money back, needs a wallet to work, accrues again over time so there is a reason to return,
and it demos in ninety seconds.

**Second: Ask Cluck.** The AI tutor as a first-class mobile surface. Under one published scoring
scheme AI is 20% of the score; we already have the product.

**Third: Wallet Checkup.** Approvals, freeze/mint authority, honeypot risk — read-only, free, and
the brand.

Everything else stays on the web.

⚠️ **Money-path discipline applies.** Closing a token account moves a user's funds: never close one
holding a balance, refuse wrapped SOL explicitly, confirm before every signature, and the flow gets
an adversarial review pass before it ships. Server advises what is reclaimable; **the client builds
and signs. The server never signs for a user.**

## 5. Deadline and what it is judged on

**Submissions close 2026-10-09 06:59 UTC (Oct 8, 23:59 PT).** Full detail, including the two
contradictory published scoring schemes and the eligibility rules, is in
`docs/CLOCK_IN_HACKATHON_2026.md`. Submit: a functional APK, a public repo, a demo video, a deck.

## 6. Plan

| Days | Here | Apps repo |
|---|---|---|
| 1–3 | `store-seeker` variant scaffold, mobile shell, MWA-aware wallet layer | 4th target, MWA plugin, first signed APK |
| 4–10 | Rent reclaim end to end | — |
| 11–14 | Ask Cluck + Wallet Checkup mobile, empty/error/offline states | Seed Vault, deep links, push |
| 15–17 | Demo video, deck, repo hygiene, judge access | fresh dApp Store listing + screenshots |
| 18–19 | Buffer | — |

**Gate at day 3:** a real wallet connects on the owner's Seeker. If that does not happen, the plan
changes rather than the deadline.

## 7. Open, and the owner's to decide

1. **appId** — ship under a new one (zero risk to the live listing) or replace the live app.
2. **SKR** — one published scheme makes SKR integration 20% of the main score, the other makes it a
   separate $10k bonus. **Ask in the CLOCK IN office hours before deciding to skip it.**
3. **What gives** — the Colosseum Hub extension roadmap (GG2/GG4/GG5 and beyond) is the proposed
   pause. Colosseum itself continues; their FAQ explicitly allows both hackathons.

## 8. Needs doing regardless of any of the above

The live dApp Store listing advertises **Cluck Score, Survival Simulator and the Ultimate
Challenge** — all deleted — and the retired CLKN-micropayment model. A judge who opens our store
page today reads a description of an app that does not exist. Rewrite it.
