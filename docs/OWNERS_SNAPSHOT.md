# Owners Snapshot & History

**Route:** `/owners-snapshot` (alias `/owners`) · **Engine:** `lib/owners-snapshot.js` · **Routes:** `server.js` (search `OWNERS-SNAPSHOT`) · **Free** (no tools pass).

Owner's brief (2026-09-02): *"a token owner can submit contract. We go through every holder more than 5 dollars.
Transaction history. Dumping patterns. Linked wallets. Try to follow dumping wallets to see if linked to other
wallets. Basically who is in. Who is out. And who is draining me or setting me up for failure."* And: *"This can
take hours if needed to keep price down and free."*

## What it does

1. **Token facts** — supply/decimals (`getTokenSupply`), name/symbol (`getAsset`), price (Jupiter v3), SOL price.
2. **Holders** — DAS `getTokenAccounts` for the mint, `showZeroBalance: true` (zero-balance accounts are where the
   exited wallets live), up to 50 pages. Off-curve owners are classified (`classifyAddressTypes`) and reported as
   pools/lockers/programs, never analysed.
3. **Analysis set** — every person ≥ `$5` (`OWNERS_SNAPSHOT_MIN_USD`), capped at `OWNERS_SNAPSHOT_MAX_WALLETS`
   (1500) by USD, plus up to `OWNERS_SNAPSHOT_EXITED_CAP` (300) low/zero-balance accounts so "OUT" has a chance.
4. **Per-wallet history for this one mint** — `getSignaturesForAddress` on the wallet's token accounts (newest
   first, `until: lastSig` so re-runs only read what's new), enhanced-parsed through `heliusEnhancedBatched` with a
   shared tx cache. The row classifier is /api/trace's (opposite-direction = swap) plus Wallet X-Ray's wSOL fix.
5. **Status** (arithmetic, see `NOTES.statuses` in the lib): ACCUMULATING · HOLDING · TRIMMING · DRAINING · OUT,
   plus flags `freeBag` (received ≫ bought), `fresh` (< 14 days old), `botCadence`.
6. **First funder** — dust-aware oldest-SOL-inflow walk (`findFunder`, mirrors `wxFindOrigin`), cached forever per
   wallet. Dumpers and the biggest holders first, cap `OWNERS_SNAPSHOT_FUNDER_CAP` (400).
7. **Proceeds** — for dumpers only, one page of the wallet's TRANSFER history: SOL ≥ 0.05 / stables ≥ $5 leaving
   the wallet after its first sell, grouped by destination, exchange-labelled where known.
8. **Links / clusters** — edges: direct token transfers between wallets, shared non-exchange first funder, shared
   non-exchange proceeds destination. Union-find → clusters with combined supply %, and *flags* worded as
   patterns (never "team"/"insider"/"ring").
9. **Snapshot history** — every run stores a compact `{wallet: {bal, usd, status}}` map; the next run diffs it:
   entered / left / status changed / biggest moves. Full reports are pruned to the last 5, summaries kept for 30.

## The job pattern (first in the repo)

- One job at a time, FIFO queue (max 12), state in `DATA_DIR/owners-snapshot/jobs.json`. A job that was
  `running` at restart is re-queued and resumes from the per-mint cache.
- Every upstream call goes through one pacer: `OWNERS_SNAPSHOT_RPS` (default 4/s). Hours are fine; credits are not.
- Per-mint cooldown 6h on `/start` (owner key + `&force=1` bypasses), per-IP 6 starts/hour.
- Endpoints: `POST /api/owners-snapshot/start {mint}` · `GET /status?mint=|jobId=` · `GET /result?mint=[&ts=]` ·
  `GET /history?mint=` · owner `GET /admin?key=[&cancel=<jobId>]`.

## Storage

```
DATA_DIR/owners-snapshot/
  jobs.json                  queue + last 60 jobs
  cache/<mint>.json          per-wallet rows + lastSig watermark, per-wallet funder (never expires)
  results/<mint>-<ts>.json   full report (last 5 per mint)
  snapshots/<mint>.json      snapshot index: summaries + compact wallet maps (last 30)
```

## Honesty rules baked in

Every status is arithmetic over transfers. USD for past trades uses today's SOL price (token amounts are exact).
Truncated histories anchor peak from the live balance and say so. A shared funder is a pattern with the innocent
explanations attached in the UI copy. Exchange/platform tables are short (`lib/solana-addr.js`) — an unrecognised
destination is "a wallet", nothing more.

## Verify

`node --check lib/owners-snapshot.js server.js`; the mocked end-to-end (job run → statuses → clusters → incremental
re-run → diff) lives in the session that built it (2026-09-02) and is easy to recreate from `createEngine(deps)` with
fake `rpcCall`/`enhancedBatched`. A real run needs `HELIUS_API_KEY` — test on staging.
