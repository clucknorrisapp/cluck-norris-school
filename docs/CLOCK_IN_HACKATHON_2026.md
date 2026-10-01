# CLOCK IN — A Solana Mobile hackathon (research, 2026-09-19)

Owner asked twice for this; the first pass missed it because I checked two portals and stopped.
It is real and it is live. Everything below is read **from the hackathon's own API**, not from
press coverage — the press numbers are wrong (see "Where the articles are wrong").

## What it is

> "Build the next wave of mobile-native Solana apps for Seeker. Ship with the Solana Mobile Stack
> — Seed Vault, Mobile Wallet Adapter, and the dApp Store — and put self-custody crypto in every
> pocket."
> — hackathon record, `GET https://align-api.radiant.nexus/hackathons/running`

- Public page: <https://solanamobile.radiant.nexus/> (`https://docs.solanamobile.com/hackathon/`
  307-redirects to it). Run on Align by Radiants; the page is a client-rendered SPA, so a plain
  fetch returns only the title — the API above is how you read it without a browser.
- On-chain hackathon address: `H5jQCFppZBd6wq2XLpazBjJMeLAn1HJSmrT9PpTLM1kb`
- Discord (office hours + "Rad sessions"): <https://discord.com/invite/qGcWhr8WB>

## Dates (UTC, verbatim from the API)

| Milestone | UTC | PT |
|---|---|---|
| Sign-up + submissions open | `2026-09-08T16:00:00Z` | Sep 8, 09:00 |
| **Submissions close** | `2026-10-09T06:59:00Z` | **Oct 8, 23:59** |
| Judging opens | `2026-10-10T07:00:00Z` | Oct 10, 00:00 |
| Judging closes | `2026-11-09T07:59:00Z` | Nov 8, 23:59 |
| Prize distribution | `2026-11-11T03:00:00Z` | Nov 10, 20:00 |

As of 2026-09-19 that is **19 days of build time left**.

Recurring events on the calendar: "Office hours" (Discord, Wed 18:30 UTC) and "Rad session"
(Discord, Mon 16:30 UTC), running through Oct 20.

## Prizes

One track, "Clock In Hackathon" — top 10 by judge score:

| Place | Prize |
|---|---|
| 1st | $30,000 USDC **+ a Seeker for each team member** |
| 2nd | $25,000 USDC |
| 3rd | $20,000 USDC |
| 4th | $15,000 USDC |
| 5th | $10,000 USDC |
| 6th–10th | $5,000 USDC each |

That is **$125,000 USDC** in the track. The widely reported total of $135,000 is this plus a
separate **$10,000 SKR** prize for the best Solana Mobile Stack integration, which is not in the
track record.

## Judging — the global scoring criteria and their weights

Straight off the hackathon record (`globalScoringCriteria`), and the track uses them
(`useGlobalScoring: true`):

| Criterion | Weight |
|---|---|
| AI | 20% |
| SKR Integration | 20% |
| UX | 15% |
| UI | 15% |
| Innovation | 15% |
| Ecosystem Impact | 15% |

On this table alone, 40% of the score would be AI + SKR integration — a great mobile app with no
AI story and no SKR integration capped at 60 before UI/UX/innovation/impact are argued.

⚠️ **But the published FAQ states a different scheme entirely** (four equal 25% criteria, no AI and
no SKR among them). See the conflict under "Rules that decide whether we can enter" below, and do
not plan around either table until it is settled with the organisers.

## Rules that decide whether we can enter (from the site's own FAQ and T&C)

The page is an SPA; this text is embedded in its JS bundle, so it is the site's own copy.

- **Pre-existing products are allowed.** *"Yes, if it shows significant new mobile development
  during the hackathon. A pre-existing project with no new work is not eligible."*
- **An already-shipped app is fine** — *"there must be something new built specifically for the
  hackathon (for example a new feature, or bringing it from the Apple App Store to the Solana dApp
  Store)."*
- ⚠️ **The sentence that governs our architecture:** *"You can participate with an existing web
  app, but you must build an Android app with significant mobile-specific development. Direct ports
  or PWA wrappers with little mobile optimisation will score poorly."*
- ⚠️ **Funding bar:** *"Only teams without VC/angel funding are eligible for USDC prizes."*
- ✅ **Both hackathons are allowed:** *"Can I compete in both Clock In and Collosseum hackathons?"
  — "Yes, you may."* Entering CLOCK IN does not cost us Colosseum.
- **dApp Store publishing is not required to submit** — *"winners must publish their app on the
  Solana dApp Store to claim their prize, within 30 calendar days after winners are announced."*
- **Submit:** a functional Android APK (direct download link), a GitHub repo with the source, a demo
  video showing functionality, and a pitch deck or brief presentation. One submission per team;
  members lock once submitted; judges need repo access granted *before* submission because they
  review weeks later.
- **What to build:** *"An Android app that produces a functional APK, integrates the Solana Mobile
  Stack and Mobile Wallet Adapter, is built for mobile from the ground up, and interacts
  meaningfully with the Solana network."*
- No Seeker needed to build — emulator or any Android device. Organiser is **Radiants DAO Ltd**;
  the full T&C is the binding document and only its summary is on the page.

⚠️ **The judging criteria contradict each other, and nobody should plan around one of them alone.**
The FAQ says: *"Judges assess completion (demo video), technical depth (GitHub commits),
mobile-optimised UX and use of mobile features, interaction with the Solana network, and clarity of
the presentation. Everything is scored across four equal 25% criteria."* The platform's own scoring
config says **AI 20 · SKR Integration 20 · UX 15 · UI 15 · Innovation 15 · Ecosystem Impact 15**.
Whether skipping SKR costs a separate bonus or a fifth of the main score depends on which governs.
**Ask in office hours before deciding.** (Same rules-vs-website split as Colosseum.)

## Where we actually stand — CORRECTED 2026-09-19

An earlier version of this doc implied we have no Solana dApp Store presence. **We do.** The wrapper
lives in `clucknorrisapp/CLKN-SEEKER`, on branch `claude/cluck-norris-capacitor-setup-jOSpk` —
`main` there is an empty README, which is why it looks empty at a glance.

What that repo already gives us:

- **Capacitor 8, three targets**, cleanly separated: `solana` → appId `app.clucknorris.school`;
  `googlePlay` and `ios` → appId `app.clucknorris.edu`, with their own signing and a bundled,
  pinned frontend. The Play bundle is already insulated from anything we do for Solana.
- **`npm run build:solana` runs `assembleRelease`** — we produce a functional Android APK today.
  That is submission requirement #1, already met.
- **`dapp-store/` publishing setup**: `config.yaml`, icon, banner, editors-choice image and seven
  screenshots. (The file is marked DRAFT and its `privacy_policy_url` TODO says `/privacy` does not
  exist — the live listing was presumably finalised elsewhere; find where before building a
  submission from it.)
- **Mobile Wallet Adapter is a real dependency and is wired** —
  `@solana-mobile/wallet-adapter-mobile` in `src/wallet-provider.jsx`.

And the gap, which is the whole problem:

- The `solana` target sets `server: { url: 'https://clucknorris.app' }` and `prep-dist.mjs` writes a
  **placeholder** `dist/` for it. The shipped dApp Store app is a Capacitor shell pointed at the
  live website — not a bundled port, a *remote* one. That is the purest form of what the FAQ says
  scores poorly.
- Because that target discards the vite build, **`src/wallet-provider.jsx` is not in the shipped
  app.** It loads clucknorris.app, whose wallet layer (`cluck-wallet.js`) relies on browser
  injection and Wallet Standard discovery — neither of which exists inside a Capacitor WebView.
  **Inferred from config, not observed: wallet connect probably does not work in the shipped Seeker
  app.** Verify on the device before relying on this either way.

## What a credible entry therefore is

Not a rebuild from scratch, and not a re-skin of the remote shell: **a fourth build target** —
bundled rather than remote, the `src/` React app built mobile-first, MWA actually live (the provider
is already written), and one flow done well. Recommended flow: **rent reclaim** — real money back to
the user, needs a wallet to work, accrues again over time so there is a reason to return, and demos
in ninety seconds.

Ship it under its own appId (e.g. `app.clucknorris.seeker`) so the live listing carries zero risk;
decide after judging whether to fold it into the main listing.

## Where the articles are wrong

Do not quote these numbers:

- "Submissions close Sept. 25" — the API says **Oct 9 06:59 UTC**.
- "Ten grand prizes of $10,000 / five honorable mentions of $5,000" — the track pays a
  **$30k/$25k/$20k/$15k/$10k + 5×$5k** ladder.
- The Align listing that renders as "Live/Open" with July–August 2025 dates is a **stale page for
  last year's event** — not this one.

## Open questions for the owner

1. **VC/angel funding** — only unfunded teams are eligible for the USDC prizes.
2. **Does wallet connect work in the shipped Seeker app?** A device check settles what the config
   only implies.
3. **Go or no-go on the hackathon edition**, and whether rent reclaim is the right single flow.

Colosseum is a separate question, not a trade — their FAQ allows both.
