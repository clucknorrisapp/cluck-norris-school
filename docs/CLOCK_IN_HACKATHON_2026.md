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

Read that honestly: **40% of the score is AI + SKR integration.** A great mobile app with no AI
story and no SKR integration is capped at 60 before UI/UX/innovation/impact are even argued.

## What entering would actually require

The brief names three Solana Mobile Stack pieces — **Seed Vault, Mobile Wallet Adapter, and the
dApp Store**. Our shipped Google Play bundle (`store-google-v1.0.0`, `docs/STORE_EDITION.md`) is a
pinned, education-only WebView wrapper with **no wallet, no payments, no address** — deliberately,
for the store review. It is the opposite of what this hackathon scores.

So a credible entry is a **new, native Android surface**, not a re-skin of the store build:

1. Mobile Wallet Adapter connect/sign (the store edition has none by design).
2. Something the Seed Vault actually protects.
3. A dApp Store listing (Solana's, not Google's).
4. An SKR integration that is not decorative — it is a fifth of the score.
5. An AI story — we have one (the Cluck tutor, ask-cluck) but it must be mobile-native, not an
   iframe of the website.

⚠️ The track record's `state` is `"Draft"` as of this writing, which on Align means the track is
not yet open for submissions even though sign-up is. Check the site before assuming you can submit
today.

## Where the articles are wrong

Do not quote these numbers:

- "Submissions close Sept. 25" — the API says **Oct 9 06:59 UTC**.
- "Ten grand prizes of $10,000 / five honorable mentions of $5,000" — the track pays a
  **$30k/$25k/$20k/$15k/$10k + 5×$5k** ladder.
- The Align listing that renders as "Live/Open" with July–August 2025 dates is a **stale page for
  last year's event** — not this one.

## Open question for the owner

This is a mobile-native build, judged on AI + SKR + UX, due Oct 8. It is not something the
existing Play wrapper can be stretched into. Deciding to enter is a decision about where the next
three weeks go — his call, not a session's.
