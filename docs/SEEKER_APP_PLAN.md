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

> ⚠️ **SUPERSEDED IN PART, 2026-09-21.** §4 below describes a three-surface app (Rent Reclaim,
> Ask Cluck, Wallet Checkup). The owner widened that the same night — *"I want to build all the
> tools into the seeker app appropriately"* — and the tool surface is now the decision of record
> in **`docs/SEEKER_TOOLS_BUILD.md`**: fifteen tools, each rebuilt phone-native, with the
> operator/desk surfaces explicitly out of scope. Everything else in THIS file (which repo, what
> "complete rebuild" means, the deadline, SKR, solo entry, registration mechanics) still stands.
> Night's handoff: `docs/HANDOFF_2026-09-21_SEEKER.md`.

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

## 7. Decided (owner, 2026-09-19)

### SKR — an additional door, never a gate

**Hold ~$50 of SKR → the heavy tools are free in the Seeker app**, alongside the two doors that
already exist (hold CLKN, or pay the SOL pass). Owner's call, same evening.

- **Mint: `SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3`** — SPL Token, 6 decimals.
  ⚠️ **Verified before use, and this mattered:** a second mint also calls itself SKR
  (`79dd8EvWuGjPTnTMMBoY6Nqtdw5u1cXaGh4azuLGjiAj`, name "Seeker | Solana Mobile👇") and is an
  impersonator — unverified, 4 holders, no market cap, organic score 0, and it is what surfaced
  first in a web search. The real one is Jupiter-verified with ~45.8k holders. **Never take a mint
  from a search result; check the registry and the chain.**
  ⚠️ **Correction, 2026-09-19:** an earlier version of this doc said SKR's public description
  claims a "fixed 10B" supply while the chain shows ~10.6B with an active mint authority, implying
  a discrepancy. **There is none.** solanamobile.com/skr states an *initial* total supply of 10
  billion and publishes a linear inflation schedule (10% in year one, decaying 25% annually,
  terminal 2%). ~10.6B in circulation with an active mint authority is exactly what that predicts.
  The "fixed" wording came from a search summary, not from Solana Mobile, and was wrong. It was
  also about to ship onto a public page; it did not.
- **$50 worth, live-priced, never hardcoded** — same rule as the CLKN threshold.
- **Same comp criteria as the existing hold**: re-checked at use, fails open when pricing is down.
  No new behaviour to reason about.
- **Seeker app only.** The web, Google Play and iOS editions are unchanged.
- ⛔ **Nothing is gated behind SKR** — least of all Rent Reclaim. Charging someone to get their own
  money back is wrong, and a token purchase in front of the hero flow would wreck the stickiness
  score we are chasing. No swap prompt either: steering people into a token cuts against
  "say what's on-chain, never what to buy."

### Entry: SOLO

Registered as a solo participant, not a team. Consequences to keep in mind: switching to a team
later requires deleting the solo registration first; once a submission is made the entrant is
locked for the rest of the hackathon; and the 1st prize's "a Seeker for each team member" is one
device. One submission per contestant — multiple entries forfeit.

### Registration mechanics (checked against the site, 2026-09-19)

- **There is no separate sign-up deadline.** The event record carries only `signUpOpenDate`
  (Sep 8) and `submissionCloseDate` (Oct 9 06:59 UTC), and the site's registration logic gates on
  exactly those two. The FAQ's "register before the sign-up deadline" resolves to the submission
  deadline.
- **Submissions have a DRAFT state.** *"You may edit your submission at any time before the
  deadline whilst it is in draft. However you may not edit your submission if you have completed
  the final submission agreement."* So: register, open the draft early, keep editing it, and
  ⛔ **do not complete the final submission agreement until the work is done.** It locks.
- **Grant judges GitHub access before submitting** — they review weeks after the deadline.

## 8. Still open

1. **appId** — ship under a new one (zero risk to the live listing) or replace the live app.
2. **Which repo the submission names.** The app source is here and this repo is public; the APK is
   built in `CLKN-SEEKER`. Recommendation: point judges here and describe the packaging repo in the
   writeup — but "technical depth (GitHub commits)" is scored, and the hackathon work is a handful
   of PRs inside a large history, so the writeup must name the exact PRs and this document.
3. **SKR's weight** — one published scheme makes SKR integration 20% of the main score, the other a
   separate $10k bonus, and they may mean on-chain activity rather than holdings. **Ask in office
   hours (Wednesdays 18:30 UTC, Discord) before assuming the holdings shape is enough.**
4. ~~**What gives** — the Colosseum Hub extension roadmap (GG2/GG4/GG5 and beyond) is the proposed
   pause. Colosseum itself continues; their FAQ explicitly allows both hackathons.~~ **Settled
   2026-09-21: Colosseum is off entirely (owner). This plan, the product and the partner projects
   are the whole focus until Oct 8.**

## 9. Needs doing regardless of any of the above

The live dApp Store listing advertises **Cluck Score, Survival Simulator and the Ultimate
Challenge** — all deleted — and the retired CLKN-micropayment model. A judge who opens our store
page today reads a description of an app that does not exist. Rewrite it.
