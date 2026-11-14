# CUNA → CLKN migration — runbook

The monitor that pays CLKN for CUNA sent in, and the one-time Day-0 batch for lockers. Code:
`lib/cuna-migration.js` (the rules), `lib/cuna-migration-attempts.js` (the attempt log),
`lib/cuna-migration-monitor.js` (the tick), wired in `server.js` next to `cunaOpsAlert`. Tests:
`scripts/cuna-migration-test.cjs` (CI).

**It ships DISARMED.** Nothing is sent unless all of these hold:

| Condition | Where |
| --- | --- |
| kv `cunaMigArmed` is `true` | `POST …/admin?arm=1&confirm=arm-cuna-migration` |
| `CUNA_MIGRATION_ON=1` | Railway env |
| `CUNA_MIGRATION_OFF` is not `1` | Railway env (the hard kill; it always wins) |
| not staging (`STAGING=1` never pays) | Railway env |
| the payer key is loaded and its pubkey is the configured payer: the treasury key with `CUNA_MIGRATION_PAYER_SOURCE=treasury` (the owner's choice), or a dedicated `CUNA_MIGRATION_PAYER_SECRET` | Railway env + `payer=` |
| treasury mode only: `CUNA_MIGRATION_SOL_RESERVE_LAMPORTS` (at least 0.05 SOL), `CUNA_MIGRATION_CLKN_RESERVE_RAW` and `CUNA_MIGRATION_MAX_CLKN_RAW` are all set explicitly (a reserve that does not parse is refused in either mode) | Railway env |
| the kv store is persistent and loaded cleanly | the `/data` volume |
| the journal is not halted | `ack=` clears a halt |

With the payer secret unset the whole thing is a safe no-op: it detects and records, it never signs.

## The rules it enforces (owner, 2026-11-06 … 11-09)

- **Rate:** 27,700 CLKN per 1,000,000 CUNA. Both mints are legacy SPL with 9 decimals, so
  `clknRaw = floor(cunaRaw × 277 / 10000)`, integer math only.
- **Holders** are paid only when they send CUNA in, from their snapshot wallet, up to that wallet's
  `sendInMax`. The **sender** is the one owner whose CUNA fell in that transaction. It is never the
  fee payer. It is paid to the wallet that sent, never to an address anyone typed.
- **Lockers** are paid once, on Day 0: locked CUNA plus their unpaid lock-to-earn rewards, as CLKN.
  Only you can start it.
- **Window:** 30 days from the start you set. A transfer is judged by the time the chain recorded
  it. A transfer inside the window whose payout lands later is still paid. A transfer after the end
  is recorded and held for you.
- The monitor **never moves CUNA**. You sell what comes in, by hand.

## What you need before you start

1. **A fresh receive wallet.** It must be a plain wallet, not the treasury, the payer or a wallet on
   the list. If you use it for anything else, those moves show up as held noise.
2. **The payer.** The owner's choice (2026-11-14: *"we are going to pay out of the current wallet we
   have keys set up on"*) is the **treasury**, `2zMCUkE9pBjcC7ihtLqm28EsCoEHVmCdJYr5262EuPy8`, whose key
   the server already holds as `MM_OPERATOR_SECRET_TREASURY`. Set `CUNA_MIGRATION_PAYER_SOURCE=treasury`
   in Railway and `payer=` the treasury address. Nothing new is pasted anywhere. This is a deliberate
   exception to the repo's "never automate with the treasury key" posture, and the code narrows it:
   - with the env set, the payer can ONLY be the treasury, and the loaded key must BE the treasury;
     without it, the treasury is refused as payer exactly as before;
   - before anything is signed, every payout transaction is checked to be exactly compute budget, an
     idempotent CLKN account create for the recipient, ONE `TransferChecked` of CLKN from the
     treasury's CLKN account for the planned amount, and the memo (`assertPayoutShape`). Any other
     instruction, mint, amount, destination or signer throws and nothing is signed. It can never send
     SOL, CUNA or any other token the treasury holds;
   - every send is still bounded by the wallet's own row and by the list total;
   - **you state three numbers in Railway or it does not arm** (the treasury's SOL and CLKN are shared
     with buy-comp, the Hub desk, diploma mints and any engine you resume):
     `CUNA_MIGRATION_SOL_RESERVE_LAMPORTS` — SOL the migration never spends, at least 50,000,000
     (0.05 SOL); `CUNA_MIGRATION_CLKN_RESERVE_RAW` — CLKN it never spends (raw units; `0` is allowed
     but must be written); and `CUNA_MIGRATION_MAX_CLKN_RAW` — the most CLKN it may pay in all, so CLKN
     that lands in the treasury for other reasons (LP pulled back, Hub fees) is not spent on payouts
     beyond that figure. A payout that would take the treasury below either reserve waits, with one
     alert. The priority fee is capped at 50,000 micro-lamports per CU in treasury mode (0.005 SOL per
     payout at most) instead of 500,000.
   The other treasury paths still spend from the same balance at the same time, so a payout and a
   buy-comp payout can race; the loser fails on chain, which is recoverable. The status's
   `payer.clknAboveReserveRaw`, `payer.solAboveReserveLamports`, `payer.coversRemaining` and
   `payer.coversSolEstimate` are the figures to watch.

   The other option, if you ever want it, is a dedicated hot wallet in `CUNA_MIGRATION_PAYER_SECRET`
   (base58 or a JSON byte array, and no `CUNA_MIGRATION_PAYER_SOURCE`). The server refuses that key if
   it is the same key as `MM_OPERATOR_SECRET`, any `MM_OPERATOR_SECRET_*` or `CUNA_BURN_SECRET`, or if
   it is the treasury, the receive wallet, a listed wallet or the CLKN mint authority. Setting both
   sources is refused. Either way, fund the payer with what the migration needs (see step 3).
3. **The list,** converted from your ledger. Rows are `{wallet, sendCuna, locks, rew}`, with CUNA and
   CLKN as decimal numbers:

   ```
   node scripts/cuna-migration-list.cjs ledger.json > upload.json
   ```

   It writes the upload body to `upload.json` and prints the row count, the totals and the sha256 to
   the terminal. Amounts are read from the JSON text exactly, never through a float. More than 9
   decimals is refused, never rounded. **Keep `ledger.json` and `upload.json` out of the repo:** the
   repo is public, and these files list real wallets.

All admin calls use the master key in the **header**. A `?key=` in the URL is refused (404).
Every write is a `POST` carrying exactly one action, and a `GET` with a write flag answers 405.

```
K=<PREMIUM_ACCESS_KEY>            # in your shell only, never in a URL or a file
A=https://clucknorris.app/api/cuna-migration/admin
```

## Steps

### 1. Configure (while disarmed)

```
curl -X POST -H "x-premium-key: $K" "$A?payer=<PAYER_PUBKEY>"
curl -X POST -H "x-premium-key: $K" "$A?receive=<RECEIVE_WALLET>"
curl -X POST -H "x-premium-key: $K" -H "Content-Type: application/json" --data @upload.json "$A?list=1"
curl -X POST -H "x-premium-key: $K" "$A?window=1&start=<UNIX_START>"          # end defaults to start + 30 days
```

- `receive=` records the chain's current slot as the **since point**. Transfers at or before it are
  never read, so configure the wallet **before** you announce the address. You can change it only
  while disarmed with an empty journal.
- `list=1` checks every row: a valid address, raw integer strings, no duplicates, and no receive
  wallet, payer or treasury on the list. It refuses the whole upload on any error. Once a transfer is
  journaled, the list cannot be replaced.
- An **off-curve** wallet (a program-derived address such as a Jupiter Lock escrow or a vault) is
  refused: nobody can sign for it, so CLKN paid there is gone. List the lock's *recipient* instead. If
  you have checked an off-curve row and still want it paid, put `"allowOffCurve": true` on that row
  of the ledger (the converter passes it through, and it is part of the sha256).

### 2. Check it against your PDF

```
curl -H "x-premium-key: $K" "$A"
```

A bare GET is a pure read. It never ticks. Check these fields:

- `list.sha256`: the same hash the converter printed.
- `list.totals`: `sendInClknRaw` (the sum of each wallet's floor), `day0LocksClknRaw`,
  `day0RewardsClknRaw`, `totalClknNeededRaw`, and the indicative `totalClknNeededUsdIndicative` at
  the live CLKN price.
- `armFacts`: every condition in the table above, one by one.
- `payer`: the payer's CLKN (`clknRaw`) and SOL (`lamports`), read on chain; the reserves
  (`solReserveLamports`, `clknReserveRaw`) and what is above them (`clknAboveReserveRaw`,
  `solAboveReserveLamports`); `coversRemaining` (CLKN above the reserve against what is still owed up
  to the cap); `solSpendEstimateLamports` for the remaining rows and `solNeededEstimateLamports` (that
  plus the reserve) with `coversSolEstimate`; and `payerHistory`, every payer ever set.

### 3. Fund the payer

- **CLKN:** `totalClknNeededRaw` from the status (raw units, so divide by 1e9 for whole CLKN). That
  covers every send-in cap plus every Day-0 amount. `CUNA_MIGRATION_MAX_CLKN_RAW` can lower the
  global cap below the list total. It can never raise it. A value that does not parse holds
  everything.
- **SOL:** roughly 0.0021 SOL per payout (fee plus the rent for the recipient's CLKN account, if it
  is missing) plus the floor the monitor always leaves untouched: 0.01 SOL for a dedicated payer, or
  your `CUNA_MIGRATION_SOL_RESERVE_LAMPORTS` (which may also raise a dedicated payer's floor). A list of
  500 new recipients needs about 1.02 SOL above the floor. The status prints the estimate.
- **Arming does not read the chain:** before you arm, check in the status that `coversRemaining` and
  `coversSolEstimate` are `true`. If they are not, payouts simply wait for funding.

When the payer is short, nothing is sent. The entry stays due and you get one alert
(`mig-short`, deduplicated for 6 h). Fund the payer and the next tick pays.

### 4. Arm (two flags)

1. In Railway, set `CUNA_MIGRATION_PAYER_SOURCE=treasury` (or a dedicated `CUNA_MIGRATION_PAYER_SECRET`)
   and `CUNA_MIGRATION_ON=1` — with the treasury also `CUNA_MIGRATION_SOL_RESERVE_LAMPORTS`,
   `CUNA_MIGRATION_CLKN_RESERVE_RAW` and `CUNA_MIGRATION_MAX_CLKN_RAW` (your numbers; `arm=1` answers
   409 naming any that is missing) — then redeploy.
2. Arm:

   ```
   curl -X POST -H "x-premium-key: $K" "$A?arm=1&confirm=arm-cuna-migration"
   ```

   The reply says whether env ON is also set and gives every arm fact.

The tick runs every 2 minutes, plus once 25 s after boot. By default it sends at most 5 payouts per
tick (`CUNA_MIGRATION_TICK_MAX`, clamped to 1–20). While disarmed it still detects transfers and
records them as **due**. That backlog pays once, when you arm.

### 5. Watch

- **Telegram:** a short silent line goes to the **treasury operator room** for each transfer in,
  each payout sent, each hold and each anomaly. It never goes to the CUNA public room, OnlyRose or
  X. An alert is a courtesy, not the record.
- **Status:** `GET $A` shows `counts` by state, plus the `due`, `sending`, `held` and `paid` lists,
  the `totals`, `lastTick` and `halted`.
- **Run one tick now:** `curl -X POST -H "x-premium-key: $K" "$A?tick=1"`. It answers 409 if a
  tick is already running.
- **Holders** can check their own row: `GET /api/cuna-migration?wallet=<their wallet>`. It shows
  that wallet's entitlement, the CUNA received, the CLKN paid and the payout signatures, and nothing
  about anyone else.

### 6. Day 0 (the lockers)

```
curl -H "x-premium-key: $K" https://clucknorris.app/api/cuna-migration/day0                       # dry run, writes nothing
curl -X POST -H "x-premium-key: $K" "https://clucknorris.app/api/cuna-migration/day0?run=1&confirm=pay-day0"
```

The dry run lists each locker's locks, rewards and total, and whether the payer covers them.
`run=1` needs the full two-flag arm. It creates one due entry per locker (key `day0:<wallet>`) and
pays them through the same journal, up to the per-tick limit. Later ticks pay the rest. A rerun
creates nothing new. A wallet that is both a holder and a locker gets both, independently.

### 7. Stop

- **Durable kill:** set `CUNA_MIGRATION_OFF=1` in Railway. The tick then does nothing at all: no
  detection, no resolution, no rebroadcast.
- **Quick stop:** `curl -X POST -H "x-premium-key: $K" "$A?disarm=1"`. The sender re-checks the arm
  before every payout, so a disarm takes effect inside one tick. While disarmed, payouts already in
  flight are still resolved from the chain and recorded, but nothing is rebroadcast.
- **Hold one entry:** `curl -X POST -H "x-premium-key: $K" "$A?hold=<key>"`. This works only on a
  due entry with nothing in flight. A held entry is never paid automatically.

## Why it cannot pay twice

1. **One journal entry per transfer.** Each incoming transfer has one entry, keyed by its signature.
   Each Day-0 wallet has one, keyed `day0:<wallet>`. The credit is assigned in chain order and
   written in the same verified kv write as the per-wallet credited total and the read cursors.
   Credit is never returned when a payout attempt dies, so two send-ins can never together exceed a
   wallet's cap.
2. **Each payout follows a fixed sequence:**
   1. It is signed first, so its signature is known.
   2. It is claimed with an O_EXCL file under `${DATA_DIR}/cuna-migration/attempts/`, which holds the
      signed bytes.
   3. It is journaled, and only after that is it broadcast.
   4. A broadcast error is never read as failure.

   **Never delete those files.** They are the copy of each signed payout that no stale kv write can
   erase.
3. **Live until the chain decides.** An attempt stays live until the chain proves it landed (at
   finalized, with exactly +amount to the recipient and −amount from the payer) or proves it dead. To
   be dead it must have failed on chain, or been not found on two reads at least 60 s apart, both
   past `lastValidBlockHeight + 150`. While live, it is rebroadcast with the **identical bytes**,
   which carry the same signature. A new attempt is built only when every earlier attempt is dead.
4. **A memo on every payout.** Every payout carries `CLKN migration <key> #<n>`. Every tick, armed
   or not, the monitor reads the history of every payer ever configured, past a durable cursor, at
   finalized. Rotating the payer does not hide the old one, even after a lost journal: every payer
   `payer=` ever set is kept append-only in the config (`payerHistory`) and in its own kv key
   (`cunaMigPayers`), outside the journal. A memo row counts only if that payer **signed** the
   transaction: anyone can send dust that names the payer, and that does nothing. Checking a row
   costs one transaction fetch, at most 50 a tick (`CUNA_MIGRATION_WITNESS_MAX_FETCH`, up to 2,000);
   a verdict is kept across ticks, so a backlog always drains. Rows not yet checked hold back only the
   payout keys **their memos name**; every other due payout goes ahead. A stranger who keeps naming
   one holder's key in more rows than a tick checks can delay that one holder (never pay them twice);
   raise the fetch limit if you see `mig-hist-keys` alerts that do not clear. One of our attempts that landed while the journal judged it dead is revived and recorded
   from the chain; if the entry was already paid by a retry, that is an `anomaly` halt. A payer-signed
   memo the journal does not own (a lost or restored journal) halts once and is adopted into its
   entry as a live attempt, so that entry can never be paid again, even after the ack.
5. **An error is final only at finalized.** A payout that shows an error at processed or confirmed
   may still land cleanly on the canonical fork, so it stays live until finalized.
6. **A dead attempt is not forgotten.** Every attempt judged expired has its status asked again on
   each tick. If it turns up, it is revived.

## Held reasons

| Reason | Meaning | Your move |
| --- | --- | --- |
| `unlisted_sender` | the sender is not on the list | refund or credit by hand |
| `over_cap` | the wallet has already been credited its full `sendInMax`; the whole transfer is excess | refund by hand |
| (excess on a due entry) | the part above the cap is recorded as `excessCunaRaw` and alerted | refund by hand |
| `before_window` / `after_window` | the transfer landed outside the window | handle individually |
| `multi_sender` | more than one owner's CUNA fell in the transaction | look at it on chain |
| `no_sender` / `no_transfer_witness` | CUNA rose, but no single sender and transfer instruction explain it | look at it on chain |
| (not an entry) `no_rise` | the receive wallet's CUNA did not rise (for example, your own sale). Counted in `skipped.noRise`, silent | nothing |
| (not an entry) dust | a transfer of **less than 1 whole CUNA**, from anyone, listed or not. Never credited. Counted in `skipped.dust`, per listed wallet in `skipped.listed`, the last 100 in `skipped.recent` | handle individually if it matters |
| `recipient_ata_closed` | the wallet was paid before and has since closed its CLKN account; re-creating it on every payout would let it drain the payer's SOL | pay by hand |
| `off_curve` | the recipient is off the curve and its row does not carry `allowOffCurve` | check the address |
| `sender_is_payer` | the payer wallet sent CUNA in | nothing |
| `attempts_exhausted` | three payout attempts died on chain | look at the payer and RPC, then pay by hand if owed |
| `owner` | you held it | — |
| `nothing_owed` (state) | the credit rounds to 0 CLKN | — |

## Halts

A halt stops **every** send until you look and acknowledge it:

```
curl -X POST -H "x-premium-key: $K" "$A?ack=<halt code>"
```

| Code | Meaning |
| --- | --- |
| `anomaly` | A payout landed with the wrong CLKN deltas, or a second payout landed for one entry. The entry stays frozen as `anomaly` after the ack and is never retried. |
| `unknown_memo` | The payer's history holds a migration payout the journal does not own: the journal was lost or edited. Compare the chain against the status before you ack. The history is read back only to slot 469,300,000 (2026-11-14, before this code existed), so a long-lived payer like the treasury stays cheap to scan. |
| `orphan_attempt` / `attempt_mismatch` | An attempt file has no journal entry, or disagrees with it. |
| `credit_mismatch` | The credited totals do not add up from the entries. Resolve it first, or the next tick halts again. |
| `two_live` | Two live attempts were found for one entry. |
| `memo_conflict` | Two payer-signed transactions carry the same `<key> #<n>`. |

The monitor refuses to run, and alerts, when the kv store is not persistent or failed to load. It
refuses **new sends** (but keeps resolving payouts in flight and keeps detecting) when the journal
holds more than 5,000 *payable* entries (Day 0, or a send-in that was credited); held entries do not
count. Payouts go out one per recipient per tick.

A signature walk that meets more than 20 pages (20,000 signatures) on one address no longer stalls:
it picks up where it got to on the next tick, and nothing is processed out of chain order meanwhile
(`lastTick.detect` reads `walk_in_progress`). Every receive-wallet token account ever seen, and the
receive wallet's CUNA ATA, is walked for good, even after it is closed; still, **do not close a
token account of the receive wallet** while the window is open.

## Env reference

| Var | Default | Effect |
| --- | --- | --- |
| `CUNA_MIGRATION_PAYER_SOURCE` | unset | `treasury` = pay from the treasury with the existing `MM_OPERATOR_SECRET_TREASURY` (owner's choice, 2026-11-14); the payer must then be the treasury |
| `CUNA_MIGRATION_PAYER_SECRET` | unset (no-op) | a dedicated payer key instead (secret, Railway only); refused if set together with the source above |
| `CUNA_MIGRATION_ON` | unset | `=1` is the second arm flag |
| `CUNA_MIGRATION_OFF` | unset | `=1` is the hard kill |
| `CUNA_MIGRATION_MAX_CLKN_RAW` | list total (REQUIRED in treasury mode) | lowers the global cap; it can never raise it |
| `CUNA_MIGRATION_SOL_RESERVE_LAMPORTS` | 0.01 SOL floor (REQUIRED in treasury mode, at least 50,000,000) | SOL the payer always keeps |
| `CUNA_MIGRATION_CLKN_RESERVE_RAW` | 0 (REQUIRED in treasury mode) | CLKN the payer always keeps |
| `CUNA_MIGRATION_TICK_MAX` | 5 | payouts per tick, 1–20 |
| `CUNA_MIGRATION_CU_PRICE` | 20000 | priority fee in micro-lamports per CU, clamped to 500,000 (50,000 in treasury mode); the CU limit is 100,000 |
| `CUNA_MIGRATION_WITNESS_MAX_FETCH` | 50 | payer-history memo rows checked per tick, 1–2,000 |
