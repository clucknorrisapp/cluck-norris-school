# Project Hub — the public page (`/hub`, `/hub/:project`, `/hub/:project/r/:sig`)

**Owner, 2026-09-15:** *"lets build on 1 and brainstorm on how to make it really awesome."* — the
Colosseum in-window centrepiece from `CLAUDE.md`: **verifiable program terms and receipts.**
The theme's own test for Earn — *a holder who can check what they were owed and what arrived* —
rendered as a page that needs no wallet and re-checks itself against the chain.

## What it shows

One page per project (built-ins `clkn`, `cuna`, `rose`; anything approved into the Hub registry
`hub:projects` joins automatically). For every program the routes already keep:

| kind | source | receipts |
|---|---|---|
| buy competition | `buyComps` kv (the comp record) | the `payouts` journal `/api/buycomp/send` writes — one signature per winner |
| Buy Special draw | `buySpecialDraws` kv | none on file (paid through the airdropper before the Hub) — said plainly on the card |
| holder giveaway (CUNA) | `lib/cuna-giveaway` sealed draw + payouts | the server-signed payouts, per round |
| lock to earn | `program:<id>:{days,paid,batches}` (CUNA: the legacy keys, aliased by `lib/hub/store`) | every batch row with a signature |

Each card carries: a **timeline** pinned to timestamps (window → hold → verified → paid), the
**terms** it ran under with a **sha256 terms hash** (over the fields that decide the outcome only —
stable across key order, unchanged by results or bookkeeping), **totals** a holder could recompute
by hand, the **winners with their transaction**, and the **reviewed-and-not-paid wallets with the
observed on-chain fact** (sold in the window; moved the bag out during the hold; balance read 0
with no sell seen). Brand rule: what is on-chain, never why.

Two things the page does that a table cannot:

- **Verify on-chain** — re-reads every signature on the page through `/api/helius-rpc`
  (`getSignatureStatuses`, history search on) and marks each row. Not-found is reported as
  *"not found by this RPC"*, never as "unpaid" — a lagging node says that about real transfers.
- **Check a wallet** — paste any address: every program it appears in, as winner, paid,
  disqualified or "needs a look", with the fact that decided it.

`/hub/:project/r/:sig` is a permalink per receipt with the exact JSON-RPC request anyone can send
to any node to confirm it.

## Where the code is

- `lib/hub/public.js` — pure view builders. **Whitelists, never filters:** every public field is
  named there, so a comp's `payoutToken`, `chatId` or `boardMsgId` cannot leak by default.
  `scripts/hub-public-test.cjs` (CI) asserts the JSON of every view carries none of them, that
  the terms hash is stable, and that totals are honest.
- `server.js` — `GET /api/hub`, `/api/hub/:project`, `/api/hub/:project/wallet/:wallet`,
  `/api/hub/:project/r/:sig` (all public, cacheable, read-only) and the page routes (explicit,
  so a no-build boot serves them).
- `public/hub.html` — vanilla page on `theme.css` + `cluck-util.js`; phone-first, tables scroll
  inside their card.

## Not yet (v2)

Re-run-the-draw in the browser (SHA-256 over the published entry list), Locker Room locks as
Build receipts, `og:image` cards per receipt, the seven languages, and the operator's desk on the
same page.
