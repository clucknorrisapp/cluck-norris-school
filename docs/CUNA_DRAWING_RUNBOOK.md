# CUNA 0.25 SOL drawing — how to pick and pay the winner

The promo ran on cunatoken.com from **2026-09-11 15:30 UTC to 2026-09-13 18:00 UTC** (Sunday
1:00 PM Central). The rules as published on `cunatoken.com/draw.html`:

1. Follow @cunatoken and **reply to the pinned post with your Solana address**.
2. Enter **the same address** on the drawing page. That list lives here:
   `GET /api/cuna-draw/export` (owner key). "On X only, or here only, is not an entry."
3. Hold **more than $1 of $CUNA at that address at the time of the drawing** → a second entry.
4. One winner, **0.25 SOL**, "drawn on a prize wheel from every valid entry".

The registry closed with **38 entries from 20 distinct IP hashes** (six IPs entered more than
once — that is allowed by the rules as written, and the X-reply check is what stops one person
stuffing the list with addresses they never posted).

## Step 1 — the X check (the by-hand half)

Every address on the list must also appear in a reply under the pinned @cunatoken post. Two ways:

- **Automatic** (needs the app's X keys, so it runs against production):
  `GET https://clucknorris.app/api/cuna-draw/x-replies?post=<pinned tweet id>` with
  `x-premium-key` (or `x-draw-token`). It reads the whole conversation through X's recent
  search, extracts every wallet-shaped address from the reply text, and returns `matched`
  (on the list AND replied), `unmatchedEntries` (on the list, no reply found) and
  `unmatchedReplies` (replied, never entered). ⚠️ **X recent search only reaches back 7 days**:
  replies were posted Sep 11–13, so this stops working around **Sep 18–20**. If the app's X
  tier has no search, the route returns X's error verbatim — fall back to the manual way.
- **Manual**: open the pinned post, scroll every reply, and paste the thread text (or one
  address per line) into a file. The script pulls the addresses out of the text; you don't
  have to tidy it.

## Step 2 — the draw

```
export PREMIUM_ACCESS_KEY=…          # or CUNA_DRAW_EXPORT_TOKEN
node scripts/cuna-draw-pick.cjs --live --x-post <tweet id>        # automatic X check
node scripts/cuna-draw-pick.cjs --live --verified replies.txt     # pasted thread
node scripts/cuna-draw-pick.cjs --live --preview                  # no X check, labelled PREVIEW
```

What it does, in order: pulls the registry → keeps only X-verified addresses → reads each
wallet's CUNA balance on-chain (both token programs, through the app's RPC proxy) and prices
it from the deepest DexScreener pair → over $1 = 2 chances, else 1 → takes the **latest
finalized Solana blockhash as the seed** (slot recorded) → walks the same SHA256 draw the Buy
Special raffle publishes → writes `cuna-draw-result-<time>.json` with the winner, three
alternates, the seed, the priced entry list and its hash.

A run refuses to finish if any balance could not be read (`--allow-balance-errors` counts that
wallet as one entry instead). Nothing here signs or sends.

**Publish the result JSON with the announcement.** Seed + entries + the algorithm in
`lib/cuna-draw.js` (`drawFromSeed`) let anyone re-run it; the alternates are there in case the
winner turns out not to have replied on X after all, or never comes forward.

## Step 3 — pay

Manual, owner only: 0.25 SOL from the wallet the owner chooses to the winning address, then
post the winner + the tx signature under the pinned post. Nothing in this repo sends it.

## Housekeeping after

- `DELETE /api/cuna-draw/entry?address=` removes a test row if one crept in (owner key).
- The window is env-overridable (`CUNA_DRAW_OPEN` / `CUNA_DRAW_CLOSE`) for the next drawing;
  the registry key is `cunaDrawEntries` in kv — reset it before reusing the page for another run.
- `scripts/cuna-draw-test.cjs` (CI) pins the registry rules and the draw algorithm.

## The 2026-09-15 draw (owner's call: draw first, X check after)

Owner, 2026-09-15: *"pick a winner from what we have, I will then go make sure they are on the
X thread and payout, if not we will pick again."* So the draw runs over the site entries with
`--x-check-after`; the winner's reply under the pinned post is verified afterwards, and if it is
missing the next alternate takes the prize under the same seed and list.

**Draw 1 was VOIDED and redrawn.** Its first pick was a friend of the team; rather than skip a
pick after the fact, the owner had the whole draw run again with that address excluded UP FRONT
(`--exclude`), so the rule "friends and anyone connected to the team are not eligible" is
applied before the seed is taken, not after. Draw 1 is kept for the record as
`docs/CUNA_DRAWING_RESULT_2026-09-15_draw1_voided.json`; nothing was paid on it.

**Draw 2 (the one that counts):** `docs/CUNA_DRAWING_RESULT_2026-09-15.json` — 37 entries
(`GCL4YcNn…jMnrPD` excluded), 50 chances, 13 wallets over $1 at $0.00001036, seed = finalized
blockhash `4PTLTWfY4JjnktcdUKjXXa847wCFVfjewtrbiypTDHfh` at slot 447120174.

| Order | Address |
|---|---|
| Winner | `BFRNi9rQ77CKax7SAQBYRiFDb5cN69kkFKr1mutbSnnD` |
| Alternate 1 | `Hihe7JZ5X8Kx7q9JVfRgGTKWRqUAmJyWP3Yu3pJRRprF` |
| Alternate 2 | `8V3e5KZ5UUSvKcmn5GCroHxf8WjSCf2qSe9cYx1EUjYC` |
| Alternate 3 | `z34bpAMoDZF3tvwP4rWogsDBqRQUWnRM2W2PT9VTT4o` |
| Alternate 4 | `9EURgiCG6GUAmm66TfLF9kQPkCjjxnWGTZwbgoiVWZFt` |
| Alternate 5 | `AgWXzUfLKc2MtUeyj871Co4V3Afhdit1QaE36E3sDv8D` |

Announce it with the exclusion stated, the seed, and the slot; publish the JSON.

**Closed 2026-09-15 01:07 UTC.** Owner confirmed the winner on the X thread and paid 0.25 SOL
from the treasury wallet: tx `zMcUGwv5eFoErdPvxAZMqyGzHEyNEU4FgbVL9qgDnJjrFWDTF6qHqSZNELppomVBiZDKqmXCd6aJRq5DJiMuM5M`
(verified on-chain: system transfer of 250,000,000 lamports to the winner). Announced on the CLKN
X account (post `2099666914339398087`, via `/api/x-post-test&force=1`, owner ask) and in the
CUNA Cummunity room (message 10443, silent). ⚠️ X refused the first attempt with "Posts are
limited to a maximum of one cashtag" — `$CUNA` twice in one post is a 403, write the second as
plain CUNA.
