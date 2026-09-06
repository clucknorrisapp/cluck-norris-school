# Listing Checkup — build plan (owner ask 2026-09-06)

> "A project puts in their name, chain, contract, official website, Telegram and other info, and we
> sleuth the internet for everywhere that contract is listed — CoinGecko, CoinMarketCap, GeckoTerminal,
> DexScreener, DEXTools, all of them — and tell them where it is listed, where the info is correct,
> where it is wrong, and where to go to fix it."

Owner calls (2026-09-06): **free preview + the unified tools pass for the full sweep · Solana only for
v1 · fix LINKS only, no pre-filled request text.**

## What it is

Wallet Checkup pointed at a project's own listings. One form, one sweep, one shareable report at
`/listing/<mint>` with three lists: **correct**, **incorrect (field by field, ours vs theirs)**,
**not found**. Every incorrect row carries the exact page where the project can fix it.

The honesty rules of every other tool apply: we say what each site SHOWS, never why; "we could not
find it" is never reported as "not listed"; a source we could not read is listed as unread, not clean.

## The canonical record comes from the chain

Most aggregators pull name, symbol, image, description and socials from the **Metaplex token
metadata** (on-chain account + the off-chain JSON its URI points to). A wrong website there propagates
everywhere, so the report leads with the on-chain record and says "fix this first" when it is off.
The Hatchery already writes this metadata for tokens it mints; the report links to the Hatchery
metadata tooling for a project that needs to update theirs.

Intake fields → canonical record: `name`, `symbol`, `mint`, `website`, `telegram`, `x`, `discord`,
`logo` (URL or upload), `description`. The `/jupverify` intake collects the same set for partner
tokens; the two share one form component.

## Sources for v1 (Solana)

Tiered by how we can read them. Everything runs server-side; keys stay in Railway. Rate limits are
the vendor's published free-tier numbers and must be re-checked at build time.

| # | Source | How | What we compare | Fix link | Cost / limit |
|---|---|---|---|---|---|
| 1 | **On-chain metadata** (Metaplex + URI JSON) | Helius DAS `getAsset` + fetch URI | name, symbol, image, description, external_url, socials in JSON | Hatchery metadata update (our own) | Helius credits we already pay |
| 2 | **CoinGecko** | `GET /api/v3/coins/solana/contract/{mint}` (free API, key optional) | name, symbol, homepage, twitter, telegram, discord, image, description | coingecko.com "Request update" form on the coin page | free: ~30 req/min; cache 24h |
| 3 | **GeckoTerminal** | `GET /api/v2/networks/solana/tokens/{mint}` + `/info` | name, symbol, image, websites, twitter, telegram, discord, description | geckoterminal.com token page "Update token info" | free: 30 req/min |
| 4 | **DexScreener** | `GET /tokens/v1/solana/{mint}` (pairs carry `info.websites` / `info.socials`), `/token-profiles/latest/v1` | websites, socials, image, header | dexscreener.com "Enhanced Token Info" (paid by the project) | free: 300 req/min |
| 5 | **Jupiter** | token API `GET /tokens/v2/search?query={mint}` (or the strict list) | name, symbol, logo, tags (verified / community) | Jupiter Verify (catdet / the JVP flow we already run for partners) | free |
| 6 | **Solscan** | `GET /v2.0/token/meta?address={mint}` (key we hold) | name, symbol, icon, website, twitter, description | Solscan pulls metadata; fix on-chain | free tier on our key |
| 7 | **Rugcheck** | `GET /v1/tokens/{mint}/report` | name, symbol, links it shows, verification badge | rugcheck.xyz project verification | free |
| 8 | **Birdeye** | `GET /defi/token_overview?address={mint}` (`extensions`: website, twitter, telegram, discord, description) | those fields | birdeye.so token page "Update token profile" | needs a key; free tier is small — **owner decision** |
| 9 | **CoinMarketCap** | `GET /v2/cryptocurrency/info?address={mint}` | urls.website / twitter / chat / message_board, logo, description | coinmarketcap.com "Request update" | needs a free key (10k credits/mo) — **owner decision** |
| 10 | **pump.fun** (if the mint is a pump token) | `frontend-api` coin endpoint | name, symbol, image, website, twitter, telegram, description | pump.fun creator profile | free, unofficial — read only, tolerate failure |
| 11 | **DEXTools** | page fetch + parse (API is paid) | socials shown on the pair page | dextools.io "Update token info" form | HTML parse; mark unread on change |
| 12 | **Photon, Moonshot, CoinPaprika, LiveCoinWatch, CryptoRank** | page fetch + parse | socials / website shown | each site's update form | HTML parse; best effort, clearly labelled |
| 13 | **Wallet token lists** (Phantom / Solflare via their public token metadata endpoints) | fetch | name, symbol, image | metadata on-chain | free |
| 14 | **Discovery** — the contract address searched across the web and X | Brave Search API (free 2k/mo) and the X API recent-search on our keys | any page mentioning the mint we did not list above; clones using the project's NAME with a different mint | n/a — reported as "also seen at" and "possible impersonators" | **owner decision** on the Brave key |

Sources 1–7 and 10–13 need nothing we do not already have. 8, 9 and 14 need a key or a decision and
ship as "unread — key not configured" until then, so the tool is honest about its own coverage.

## Comparison rules (`lib/listing-checkup.js`, pure, unit-tested)

- URLs normalised before comparing: scheme dropped, `www.` dropped, trailing slash dropped, lowercase
  host, query stripped except where it identifies the target (t.me/+invite hashes kept).
- Handles compared case-insensitively with `@` stripped; `x.com` and `twitter.com` equal.
- Symbol compared case-insensitively; name by exact match after whitespace collapse (a report row
  shows both so the reader judges "Cluck Norris" vs "CluckNorris").
- Logo compared by content hash after fetch (both sides), with a "same image, different host" note
  when hashes match but URLs differ.
- Per source, per field: `match` / `differs` (ours vs theirs shown) / `missing there` / `unread`.
- Per source overall: **correct** (every provided field matches), **incorrect** (≥1 differs or
  missing), **not found** (source answered but has no record), **unread** (error / no key / blocked).

## Product shape

- **Page** `public/listing-checkup.html` (vanilla, `cluck-util.js` + `cluck-wallet.js` +
  `cluck-gate.js` like the other tools). Form → "Run checkup" → async job (the Owners Snapshot
  job pattern: `POST /api/listing-checkup/scan` returns a job id, `GET …/job/:id` polls) → the
  report renders in place and at `/listing/<mint>` (server-rendered, escaped, OG card like the
  Lock of Fame pages) for sharing.
- **Preview (free)**: on-chain metadata + CoinGecko + GeckoTerminal + DexScreener + Jupiter
  (sources 1–5) — enough to be useful, and every field is public chain data.
- **Full sweep (pass)**: all sources, the discovery tier, the shareable report page, and **rerun**
  (the report keeps the last three runs so a project can show "fixed since last week").
- **Rate limits**: the shared `forensic` bucket for the preview; full sweeps 3 per mint per day and
  20 per IP per day; results cached 24 h per mint in kv (`listingCheckup:<mint>`), capped at 2,000
  mints, oldest evicted.
- **Never**: we do not submit forms on the project's behalf, we do not store the project's uploaded
  logo beyond the run, and we do not display any field we could not read as anything but "unread".

## Cost per run

Preview ≈ 6 API calls (Helius, CoinGecko, GeckoTerminal ×2, DexScreener, Jupiter), all free tier.
Full sweep ≈ 15 API calls + up to 8 page fetches + 2 search calls; the only metered ones are Helius
(one DAS call), Birdeye and CMC (if keyed), and Brave (free 2k/mo → ~60 full sweeps a day at the
cap). At the caps above the monthly cost stays inside every free tier.

## Tests before it ships

- `scripts/listing-checkup-test.cjs` (pure): the normaliser (30 URL/handle cases), the comparator
  (match / differs / missing / unread), the per-source verdict, the cache cap and eviction.
- `scripts/listing-checkup-routes-test.cjs` (boots the server): preview needs no pass; full sweep
  refuses without the pass and without the mint; every adapter failure lands as `unread`, never a
  500; the report page escapes every field (token names are attacker-controlled).
- Fixture adapters: each source has a recorded JSON fixture so the pipeline runs offline in CI.

## Build order

1. `lib/listing-checkup.js`: canonical record, normaliser, comparator, verdicts + tests.
2. Adapters 1–5 (preview set) with fixtures; the job runner; kv cache.
3. Page + preview flow + gate; the `/listing/<mint>` report page.
4. Adapters 6–7, 10–13; the discovery tier behind its keys.
5. Docs: README tools table, `/tools` index, Telegram `/listing` command, investors line — only
   after it is live.

Estimated: steps 1–3 are one focused session; 4–5 a second. Ships through `develop` → staging for
the owner's eyeball, like every other tool page.
