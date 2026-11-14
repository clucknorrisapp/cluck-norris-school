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
| `CUNA_MIGRATION_PAYER_SECRET` is loaded and its pubkey is the configured payer | Railway env + `payer=` |
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
2. **A dedicated payer hot wallet.** Its secret goes in Railway as `CUNA_MIGRATION_PAYER_SECRET`
   (base58 or a JSON byte array). The server refuses it if it is the same key as
   `MM_OPERATOR_SECRET`, any `MM_OPERATOR_SECRET_*` or `CUNA_BURN_SECRET`. It also refuses it if it
   is the treasury, the receive wallet, a listed wallet or the CLKN mint authority. Fund it only with
   what the migration needs (see step 3).
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
- `payer`: the payer's CLKN (`clknRaw`) and SOL (`lamports`), read on chain, and
  `solNeededEstimateLamports`.

### 3. Fund the payer

- **CLKN:** `totalClknNeededRaw` from the status (raw units, so divide by 1e9 for whole CLKN). That
  covers every send-in cap plus every Day-0 amount. `CUNA_MIGRATION_MAX_CLKN_RAW` can lower the
  global cap below the list total. It can never raise it. A value that does not parse holds
  everything.
- **SOL:** roughly 0.0021 SOL per payout (fee plus the rent for the recipient's CLKN account, if it
  is missing) plus a 0.01 SOL floor the monitor always leaves untouched. The status prints the
  estimate.

When the payer is short, nothing is sent. The entry stays due and you get one alert
(`mig-short`, deduplicated for 6 h). Fund the payer and the next tick pays.

### 4. Arm (two flags)

1. In Railway, set `CUNA_MIGRATION_PAYER_SECRET` and `CUNA_MIGRATION_ON=1`, then redeploy.
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
4. **A memo on every payout.** Every payout carries `CLKN migration <key> #<n>`. Before sending
   anything, the monitor reads the payer's own history. A memo the journal cannot account for halts
   everything, even after a total kv loss.

## Held reasons

| Reason | Meaning | Your move |
| --- | --- | --- |
| `unlisted_sender` | the sender is not on the list | refund or credit by hand |
| `over_cap` | the wallet has already been credited its full `sendInMax`; the whole transfer is excess | refund by hand |
| (excess on a due entry) | the part above the cap is recorded as `excessCunaRaw` and alerted | refund by hand |
| `before_window` / `after_window` | the transfer landed outside the window | handle individually |
| `multi_sender` | more than one owner's CUNA fell in the transaction | look at it on chain |
| `no_sender` / `no_transfer_witness` | CUNA rose, but no single sender and transfer instruction explain it | look at it on chain |
| `no_rise` | the receive wallet's CUNA did not rise (for example, your own sale; that one is silent) | nothing |
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
| `unknown_memo` | The payer's history holds a migration payout the journal does not own: the journal was lost or edited. Compare the chain against the status before you ack. |
| `orphan_attempt` / `attempt_mismatch` | An attempt file has no journal entry, or disagrees with it. |
| `credit_mismatch` | The credited totals do not add up from the entries. Resolve it first, or the next tick halts again. |
| `two_live` | Two live attempts were found for one entry. |

The monitor also refuses to run, and alerts, when the kv store is not persistent or failed to load,
or when the journal holds more than 5,000 entries.

## Env reference

| Var | Default | Effect |
| --- | --- | --- |
| `CUNA_MIGRATION_PAYER_SECRET` | unset (no-op) | the dedicated payer key (secret, Railway only) |
| `CUNA_MIGRATION_ON` | unset | `=1` is the second arm flag |
| `CUNA_MIGRATION_OFF` | unset | `=1` is the hard kill |
| `CUNA_MIGRATION_MAX_CLKN_RAW` | list total | lowers the global cap; it can never raise it |
| `CUNA_MIGRATION_TICK_MAX` | 5 | payouts per tick, 1–20 |
| `CUNA_MIGRATION_CU_PRICE` | 20000 | priority fee in micro-lamports per CU, clamped to 500,000; the CU limit is 100,000 |
