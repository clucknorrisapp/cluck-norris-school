# App Store listing — iOS education edition (v1.1.1)

The exact text for every App Store Connect field for the education-only bundle, bundle id
`app.clucknorris.edu`, built from the same code as the Google Play education edition
(`docs/STORE_EDITION.md`, `docs/SEEKER_DEMO_INVENTORY.md` §2 "Education (Play/iOS) edition —
routes"). This bundle has **no wallet, no payments, and no address of its own** — nothing here
describes one, and no future edit to this file should add one.

Screenshots are generated separately (a throwaway Playwright script against the built `ios`
tarball, not committed) — see the session's handback for file paths and verified dimensions.

---

## Name (30 char limit)

```
Cluck Norris
```

## Subtitle (30 char limit)

```
Free Solana Crypto School
```

## Promotional text (170 char limit)

```
Learn Solana the honest way: 58 free lessons in 7 languages, an AI tutor, and two scan tools for any wallet or token. No wallet connect, no signup, no cost.
```

## Description (4000 char limit)

```
People lose money in crypto because nobody told them the truth plainly. Cluck Norris is a free Solana crypto school built to fix that, with no catch attached.

Inside is a full curriculum: 58 lessons across four courses, from absolute basics (what a wallet is, how a seed phrase works, custodial versus non-custodial) through liquidity pools, rug patterns, and deeper research skills. Every lesson is bundled with the app and works with no signal, so you can learn on a plane, on a train, or anywhere your connection drops. The whole school is offered in seven languages: English, Spanish, Hindi, Italian, Portuguese, Vietnamese, and Chinese.

Ask Cluck is a built-in AI tutor. Ask it anything about crypto in plain words and it answers in plain words back, with a Report control on every answer so anything wrong or unhelpful can be flagged. It gives no financial advice and makes no promises about price, yield, or return. It teaches.

Two free scan tools work on any address you paste in, no wallet connection required:

Wallet Checkup reads a Solana wallet address and reports back what it finds: open approvals, mint authorities, and anything that looks unusual. It is read-only. Nothing is stored, nothing is signed, nothing leaves your control.

Listing Checkup looks up a token by its mint address and surfaces where it is actually listed, so you can check a token's footprint before trusting a claim about it.

Finish every lesson and the app issues a certificate of completion: a dated record with its own verification code, generated from your own progress on your own device. There is no wallet involved and nothing is transferred — the name on the certificate stays on your phone unless you choose to share it yourself.

This app has no wallet, no payments, and nothing to buy. It does not ask for a seed phrase, does not connect to a wallet, and never will. The goal is simple: teach people what is actually true about how crypto works, before they get hurt by not knowing it.
```

## Keywords (100 char limit, comma-separated, no spaces after commas)

```
solana,crypto,blockchain,education,school,wallet,defi,web3,learn,ai tutor,safety,scam,token,checkup
```

## Support URL

```
https://clucknorris.app
```

## Marketing URL

```
https://clucknorris.app
```

## Privacy Policy URL

```
https://clucknorris.app/privacy/store
```

## Copyright

```
2026 CLKN Productions LLC
```

## Category

- Primary: **Education**
- Secondary: **Finance**

## Age rating notes

- No gambling, no simulated gambling, no loot boxes — nothing in this app resembles wagering.
- No unrestricted web access. External links (the site root at clucknorris.app, and — inside
  Listing Checkup only — a fixed allow-list of listing/research sites: DexScreener, GeckoTerminal,
  Birdeye, CoinGecko, CoinMarketCap, Solscan, RugCheck, Bubblemaps, solana.com) open the system
  browser; the app itself embeds no web view of arbitrary sites.
- No user-generated content shared with other users. The one place a user's own words leave the
  device is Ask Cluck: a question typed to an AI tutor (`POST /api/ask-cluck`), answered by the
  model, never published or shown to any other user. Its "Report this answer" control sends the
  question, the answer and a reason (inaccurate / harmful / offensive / other) to the operator —
  a moderation report, not a social feature.
- No account creation, no messaging between users, no chat with other people.

## App Privacy — data collection, as implemented

Read against `STORE_API_RE` in `server.js` and the boot test's section F (nothing the app requests
leaves the bundle's origin except calls to `clucknorris.app`). No account, no email, no login, no
third-party analytics SDK, no advertising SDK, no IDFA use, no tracking across apps or websites.

| Data type | Collected? | Detail | Linked to identity? | Used for tracking? |
|---|---|---|---|---|
| Contact info (name, email, phone) | No | — | — | — |
| Identifiers (device ID, user ID) | Yes — a locally-generated random id (`clkn_sid`), not a device identifier | Sent with lesson-progress events and the certificate request so a certificate can be issued against this device's own progress; stored in local storage on-device | No — no account exists to link it to | No |
| User content (the questions you ask) | Yes | Ask Cluck sends the question text (and lesson context) to generate an answer; a report sends the question, the answer, and a reason | No — not tied to an account or identity | No |
| Other user-provided data (pasted addresses) | Yes | A Solana wallet address (Wallet Checkup) or a token mint address (Listing Checkup), typed by the user, sent only to run that one scan | No | No |
| Usage data (lesson completion events) | Yes | Which lessons were viewed/passed, sent with the anonymous session id above, to drive the progress bar and the certificate gate | No | No |
| Location | No | — | — | — |
| Financial info | No | No payment method, no purchase, nothing billed | — | — |
| Diagnostics / crash data | No custom SDK | Standard OS-level crash reporting only, if the user opts in at the OS level; the app adds no crash/analytics SDK of its own | — | — |

No data is sold. No data is used for third-party advertising. Local storage only, on-device:
lesson progress, bookmarks, language preference, and the certificate name field (never
transmitted).

## What's New in 1.1.1

```
Version 1.1.1 brings the school into a phone-native app shell: the same 58 lessons in 7 languages, Ask Cluck, Wallet Checkup, Listing Checkup, and Daily, now in a faster, simpler interface built for touch. The certificate of completion has been carried forward unchanged: finish every lesson, get a dated record with a verification code, no wallet needed. No account, no payments, no address collection — same as before.
```
