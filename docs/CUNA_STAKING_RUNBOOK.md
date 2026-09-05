# CUNA lock-to-earn + daily burn — runbook

Everything here ships **DISARMED**. Nothing earns, nothing burns, no tokens move until you arm each
one deliberately. This is the document to read before arming either.

Built 2026-09-05. Owner decisions are dated inline — where this contradicts an older note, this wins.

---

## What it is

Lock CUNA on **Jupiter Lock** for 3 months or more and earn a share of the tokens the treasury's
vesting schedules release every day. Separately, a fixed amount is burned daily.

**Nobody holds anyone's tokens — including us.** Locks live in Jupiter Lock escrows with the locker
as recipient. We only read the chain and count. That is the answer to "is this a staking contract?"
and it is on the page in those words.

**There is no proof step.** Qualification is decided by reading escrow accounts. Nothing a user
types is an input, so there is nothing to forge. A lock made on Jupiter's own site counts exactly
the same as one made on ours.

| | |
|---|---|
| Minimum term | **90 days** (owner, 09-05: *"no 3 months or bust on this deal"*) |
| Cliff | **none**, on the lock or on claiming (owner, 09-05: *"remove the cliff part"*) |
| Cancelable locks | **never earn** (owner, 09-05) |
| Tiers | 90/180/270/360/450/540 days → **1×–6×**, held for the whole lock, 6× is the ceiling |
| Pool | **345,000 CUNA/day flat** (owner, 09-05) — half the 690,000 burn, 5× the 69,000 floor, ~5.2% of the stream |
| Dust floor | **69,000** CUNA minimum lock (~$1.60). **No minimum payout** — everyone gets paid |
| Daily burn | **690,000 CUNA at 15:00 UTC** from the treasury, claim-first |

⚠️ **The fixed pool is still capped at 25% of what actually unlocked that day.** The guarantee is
that this only ever hands out tokens that were unlocking anyway — the treasury's schedules do
finish, and a flat 345,000 against a stream that has fallen to 200,000 would be a promise the chain
cannot keep. Set `poolDailyRaw=0` to fall back to the `sharePct` percentage mode.

**Weight is PER RELEASE, not per lock** (owner, 09-05, same day as the decay removal below). A lock
is a list of releases — the cliff amount, then `amountPerPeriod` every `frequency` seconds,
`periods` times — and each release commits its own tokens until its own date, so each is weighed on
its own:

```
weight = sum over releases still UNVESTED of  amount_i × clamp(days_i)
days_i = whole days from firstSeenAt to that release
clamp  = 0 below minDurationDays, else min(days_i, maxTermDays)
```

For a single-cliff lock — everything our own page builds — this collapses to exactly **amount × the
term you committed to**, held flat for the life of the lock: set the day we index it, unchanged
until the lock ends, then zero. There is no bonus table and there must never be one: the tiers are
exact 90-day steps so they pay 1× to 6× by division alone, a CI test pins those ratios, and "you can
check it yourself" is most of why this is trustworthy.

The per-release rule is what lets a lock built straight on Jupiter — which can carry several
releases on different schedules — still earn honestly: an early release that unlocks in a week
weighs zero the moment it does, while a tail still locked 90 days or more keeps earning at its own
rate regardless of what already came free. **Qualification is "at least one release is 90 days or
more out"**, not "every release is" — a lock with any qualifying release earns on that release;
`disqualify()` only rejects the whole lock when *no* release clears the bar (reason string: `no
tokens locked for 90 days or more`).

⚠️ **It used to count days REMAINING, and that was wrong** (changed 2026-09-05 on the owner's call).
The page sells a ladder, and under decay that ladder was only true on day one: a 3-month locker was
on 0.77× of their own advertised rate by day 30 and earned almost nothing in their last week —
3.68M over their term against the 6.25M the rate implies. At the top it was worse. An 18-month lock
with three months left weighed **exactly the same as a brand-new 3-month lock**, so the longest
commitment on the board finished on the entry-tier rate. Don't reintroduce the decay to encourage
re-locking; that was the old justification and it cost the people it was meant to reward.

The AMOUNT side still moves. A drip schedule that is paying tokens out loses weight as it releases,
because what has vested is no longer locked up. Only the rate is fixed.

⚠️ **6× is a CEILING, not just the top row** (`maxTermDays`, 540). Weight is amount × committed days
with nothing else bounding it, so without the cap a lock built straight on Jupiter with a five-year
term would earn **20×** — a rate the page says is not on offer. Locking longer is allowed and costs
nothing; it is simply paid the 18-month rate. The ceiling **fails closed and cannot be switched off
from config**: a cleared, missing or nonsense `maxTermDays` falls back to 540 rather than meaning
"no cap", because `Number(null)` is 0 and a config typo must never uncap the pool. Raising it raises
the maximum multiplier, so the page's ladder has to move with it.

⚠️ **Terms carry one day of grace, added by the page, and it is load-bearing.** The rule measures
from our own `firstSeenAt`, stamped when the scanner next runs — minutes after signing. A cliff at
exactly 90 days is judged at 89.9965 days and refused by our own minimum, so without the grace day
every 3-month lock the page sells would be rejected. If you change the ladder or the cliff maths,
re-run the 90-day boundary test.

---

## The four things that hold the money

Read these before changing anything.

1. **Rule B is the only thing keeping the treasury out of its own pool.** Eight of the 30 treasury
   locks pass every shape check — 2.285 BILLION CUNA against the community's 226M. Nothing about
   their *terms* disqualifies them. `validateConfig` throws if the treasury is dropped from
   `excludeWallets`, and exclusion checks the **creator** as well as the recipient, because Jupiter
   Lock can reassign a recipient.

2. **Terms are measured FORWARD from `firstSeenAt`**, never backward from `vesting_start_time`.
   Jupiter sets `vesting_start_time` equal to the cliff, so the real 226M lock (471 days to run)
   reads as a 244-day lock and would be thrown out. It is creator-set too — there are live CUNA
   escrows declaring 2069 and 2077. `firstSeenAt` is ours.

3. **`firstSeenAt` is write-once, bound to a fingerprint of the lock's terms.** An escrow address is
   a PDA from a creator-chosen `base`, so a creator can close a lock and rebuild at the same
   address. An older `firstSeenAt` makes terms *easier* to pass, so inheriting one would be an
   attack: different terms at the same address start a new clock.

4. **The pool counts only what the FUNDING wallets receive.** A community lock unlocks to its own
   owner; counting it publishes a pool the treasury cannot pay. `dailyUnlockRaw` throws if the
   funding wallets are not passed.

---

## Going live: staking

⚠️ **Every admin mutation is POST-only** — `config=1`, `arm=1`, `off=1`, `accrue=1`, `reindex=`. A
plain `curl "…"` sends a GET and gets back `405` (*"this changes the programme — send it as a
POST"*), on purpose: a GET that mutates is one pasted link away from firing on its own — link-preview
bots fetch URLs in chats, browsers prerender history. Every mutating example below needs `curl -X
POST`; reads (no flags, or `rescan=1`) stay plain GET.

```bash
# 1. Look at who qualifies TODAY, before anything is armed. Read-only.
node scripts/cuna-lock-scan-live.cjs

# 2. Check specific wallets — which are lock recipients, which actually earn.
node scripts/cuna-lock-whois.cjs <wallet> [<wallet> ...]

# 3. Add every wallet you control to the exclude list (Rule B). The treasury is already there and
#    cannot be removed. `fundedBy` is a SEPARATE config key — it names the wallets whose unlock
#    stream the pool is a share of, not who is barred from earning. Setting one does not touch
#    the other; both need to be right independently.
curl -X POST "https://clucknorris.app/api/cuna-stake/admin?key=$PREMIUM_ACCESS_KEY&config=1&excludeWallets=2zMCUkE9pBjcC7ihtLqm28EsCoEHVmCdJYr5262EuPy8,<yours>,<yours>"

# 4. Preview what a day would pay. Writes nothing — plain GET.
curl "https://clucknorris.app/api/cuna-stake/admin?key=$PREMIUM_ACCESS_KEY" | jq '.wouldPay, .eligible'

# 5. ARM. Two flags on purpose — one typo'd query param must not start an emission.
curl -X POST "https://clucknorris.app/api/cuna-stake/admin?key=$PREMIUM_ACCESS_KEY&arm=1&confirm=go-live"
```

**Repairing a ledger row:** `curl -X POST ".../api/cuna-stake/admin?key=…&reindex=<escrow>"` drops
that one escrow's `firstSeenAt`, so the next scan re-stamps it — backdated to its on-chain creation
if that lookup succeeds this time. It is the only way to fix a row that got stamped at arm time
because the creation lookup failed that day.

⚠️ **Arming stamps the programme start, and it never moves again** — not across a disarm/re-arm.
Every lock's terms are measured against it. Arming also opens the `firstSeenAt` ledger for the first
time — but a pre-existing lock is **not** stamped with the arm day. `firstSeenAt` is **backdated to
the escrow's own on-chain creation time** wherever that lookup succeeds (owner, 09-05: *"I don't
want someone that locked before today to be paid at a lower rate, they locked early"*) — see
`creationTimes` / `mergeLedger` in `lib/cuna-lock-scan.js`. Only a lock whose creation lookup fails
that day, or a **reset** (same escrow address, different terms — a creator-chosen `base` means a PDA
can be reused), falls back to being stamped `now`; a reset is never backdated on purpose, since that
would restore the exact PDA-reuse hole the fingerprint check exists to close. If a row was stamped at
arm time because its creation lookup failed then, `&reindex=<escrow>` (below) re-opens it for another
try.

Arming also **accrues the arm day immediately**, rather than waiting for the next hourly tick —
arming at 23:30 with the tick at 00:15 used to mean launch day was never accrued.

**Stop:** `&off=1`. Accrual stops; the start date is kept so resuming does not re-cut anyone's terms.

---

## Going live: the daily burn

Needs **three** separate things. Any one missing and it does nothing.

```bash
# 1. Railway: set CUNA_BURN_SECRET to the treasury key.
#    Deliberately its OWN variable, even though it is the same key as MM_OPERATOR_SECRET_TREASURY —
#    arming the burner must be a separate act. One key should never quietly gain the power to
#    destroy supply because a different feature was switched on.

# 2. Point it at the wallet.
curl "https://clucknorris.app/api/cuna-burn/admin?key=$PREMIUM_ACCESS_KEY&config=1&wallet=2zMCUkE9pBjcC7ihtLqm28EsCoEHVmCdJYr5262EuPy8"

# 3. Dry-run: everything except armed.
curl "https://clucknorris.app/api/cuna-burn/admin?key=$PREMIUM_ACCESS_KEY&run=1" | jq '.burnRun'

# 4. ARM.
curl "https://clucknorris.app/api/cuna-burn/admin?key=$PREMIUM_ACCESS_KEY&arm=1&confirm=burn-daily"
```

**Stop:** `&off=1` (immediate) or `CUNA_BURN_OFF=1` in Railway (durable, survives a redeploy).

### Bonus burns (optional, OFF by default)

```bash
curl ".../api/cuna-burn/admin?key=$PREMIUM_ACCESS_KEY&config=1&bonusEnabled=true"
```

Each day burns the 690,000 base plus a rolled bonus of 0–1,000,000, in clean 10,000 steps. The
roll is **seeded from the UTC date**, never `Math.random()`: the same day always produces the same
number, so a retry cannot roll a different amount and burn twice for two different figures, and any
day's number is reproducible from the date alone if someone asks how it was chosen.

⚠️ **2,000,000 CUNA/day is the hard ceiling on AUTOMATIC burns** (owner, 2026-09-05). That is the
number that makes the worst possible day knowable in advance — without it the worst day is whatever
the roll and the retry logic produce together. Config that would exceed it is refused at write
time, and a stale config stored under an older cap is CLAMPED at burn time rather than obeyed or
thrown (a burner that crashes on a stale config is a burner that silently stops burning).

Manual celebration burns are the owner's own transactions and are not bound by this. `&run=1` runs
the normal daily gate; anything bigger is a manual burn from the wallet, which still gets a receipt
and an announcement through `/project-burn`.

`&run=1` also reports `today` — what the roll has picked — so the number can be seen before it
fires.

**Claim-first.** The treasury's CUNA sits in Jupiter escrows and only reaches the wallet when a
claim transaction runs; without this the burner works for ~15 days and then goes short forever. 19
of the 30 treasury locks vest daily and 11 weekly, so there is normally something to claim. It
claims the **fewest** escrows that cover the need (biggest first) plus five days of headroom, so it
signs roughly weekly, not thirty transactions a day. Claiming is non-destructive: own escrow → own
wallet.

**A short balance burns NOTHING**, never a partial — a partial burn cannot be undone or topped up
without double-counting. A short day is not marked done, so a top-up plus `&run=1` still burns it.

**Every burn is announced** (owner, 2026-09-05: *"we always announce a burn"*). The burner does not
post directly — it calls `/api/burn-receipt` over a **loopback** request (`127.0.0.1:$PORT`), which
re-reads the transaction FROM THE CHAIN, confirms it carries a real burn of this mint by this
wallet, and derives the amount from the balance delta. So the post says what actually happened
rather than what the burner believed it was doing, and the receipt link in it resolves because the
same call stored it. X first, then Telegram, via the existing `broadcastBurnCelebration` carve-out.
Idempotent by signature, so a retry cannot double-post — and fire-and-forget, because a failed
announcement must never make the day look unburned and burn another 690,000 tomorrow.

⚠️ **The loopback call carries the edge header.** In production the `CF_ORIGIN_SECRET` origin
lockdown 403s any request without `X-Cluck-Edge-Auth`, `/healthz` excepted — including a request
from the box to itself — so without this, "every burn is announced" was true on staging and false
on the only box that actually burns. The burn tick sets that header on the loopback whenever
`CF_ORIGIN_SECRET` is configured. And a **failed announcement now reaches the operator chat**, not
just stdout — `cunaOpsAlert(...)` fires with the burn signature and a manual `/burn/<sig>` link to
post by hand, so a broken announce path is loud rather than something you find out about later.

⚠️ **A daily burn changes total supply every day.** CoinGecko's supply verification was accepted
just before this was built; the submitted figure starts drifting immediately. Tell them rather than
letting them notice.

---

## Paying people — WEEKLY, every Friday

**Schedule: weekly (owner, 2026-09-05 — "this is a meme project, so we are probably going to have
to do weekly rewards to keep people engaged").** Friday, covering the previous seven days, so
rewards land before the weekend when the room is busiest.

Weekly only works because there is **no minimum payout**: with a floor, the smallest lockers would
sit below it most weeks and get nothing until it accumulated. Without one, everybody gets paid
every Friday however small their share. That is the whole reason the floor came out.

### The console: `/cuna-payout`

Sending now happens **on the page**, not by pasting a file into `/airdrop`. Open
`https://clucknorris.app/cuna-payout?key=$PREMIUM_ACCESS_KEY` (owner key; the **main domain only** —
it is deliberately absent from `CUNA_STAKE_PATH`, so it bounces home on the partner hosts, and its
API refuses anything that reached us without traversing the edge, same as `/api/cuna-stake/admin`).
Connect the payer wallet there and the page walks the whole flow:

1. **Preview** — what is owed right now, and a preview of the payout lines. Changes nothing.
2. **Create the batch** — its amounts are held aside from that moment, so creating a second batch
   before confirming the first cannot offer the same money twice.
3. **Send** — the page builds and signs each transfer with the connected wallet and airdrops the
   batch directly; it is not a file handed to a separate tool.
4. **Rows confirm ONE AT A TIME as they land**, not the whole batch at once. Each confirmed transfer
   is recorded with its own signature the moment it confirms (`&sent=[{wallet,sig}]`, POST), so a
   partial send — "37 landed, 15 failed" is routine for a batch this size — leaves exactly the 15
   unsent rows owed and the 37 already paid; a retry only ever sends what is left. The batch flips
   from `pending` to `sent` on its own once every row has a signature. `&confirm=<batchId>` (mark the
   whole batch paid in one shot) still exists for a manual fallback, but the page doesn't use it.
5. **Close a batch early** (`&cancel=<batchId>`) if it should stop: rows already sent stay paid,
   unsent rows go straight back to owed — nothing is double-recorded.

⚠️ **Every mutation on this endpoint is POST-only** too — `export=1`, `sent=`, `confirm=`, `cancel=`.
Reads (no flags, or `batch=<id>` to inspect one) stay plain GET.

### The live checks, right there on the page

The five checks that used to live only in the standalone verifier now run server-side on every load
of a batch and render directly on `/cuna-payout` (`cunaPayoutChecks` in `server.js`): conservation
(everything ever credited equals owed + pending + paid — see below), no other batch is pending, no
excluded wallet is in this one, every payee actually holds a CUNA lock on-chain right now, and row
amounts add up to the batch total. A **hard** check failing holds the send button; programme-armed
is shown for context only and never blocks.

### Before a send from anywhere else, run the independent verifier

```bash
node scripts/cuna-payout-verify.cjs https://clucknorris.app "$PREMIUM_ACCESS_KEY" [batchId]
```

The point is INDEPENDENCE from the page's own checks: it pulls the day ledger, the paid record and
the batch, recomputes from scratch, and compares — never asking the server whether the server is
right. Its conservation check reads **`creditedTotalRaw`** off the `/api/cuna-stake/payout` response
(everything accrual has ever credited, from `pay.totalCredits(days)`) and reconciles it against
owed + pending + paid; the two disagreeing means somebody is about to be paid twice or not at all.
Also checks: the line items sum to the stated total, no excluded wallet is in the batch, every
recipient actually holds a CUNA lock on-chain, and there are no duplicates or non-positive rows.
Exit code is non-zero on any problem, so it can gate a script.

Inflating one line item, slipping the treasury in, inflating the batch 50×, and adding a recipient
with no lock are each caught by this script, and an untouched batch passes — that property matters
more than any single check, because a verifier that always says green is worse than none. **A green
verifier — or an all-green page — is not the same as a human having looked.** Read the wallet list
too.

There is **no minimum payout, by design** — `DEFAULT_MIN_PAYOUT_RAW` is `0`. With a floor, the
smallest lockers would sit below it most weeks and get nothing until it accumulated; without one,
everybody gets paid every Friday however small their share, which is the whole reason weekly works
at all (see above). An over-payment reads as zero owed, never as a debt.

---

## Where things are

| | |
|---|---|
| `lib/cuna-staking.js` | who qualifies, what a lock weighs, how a day's pool splits |
| `lib/cuna-lock-scan.js` | enumerating escrows + the `firstSeenAt` ledger |
| `lib/cuna-programme.js` | armed/disarmed, the config guard, one-day-once accrual |
| `lib/cuna-burn.js` | burn decisions + claim planning |
| `lib/cuna-payout.js` | owed / pending / paid bookkeeping |
| `public/cuna-staking.html` | the page — `/cuna-staking`, and `/` on the CUNA staking hosts |
| `public/cuna-payout.html` | the owner's payout console — `/cuna-payout`, main domain only |
| `scripts/cuna-*-test.cjs` | 175 tests, all in CI |
| `scripts/cuna-lock-scan-live.cjs` | who qualifies today, read from the chain |
| `scripts/cuna-lock-whois.cjs` | check wallets against every CUNA lock |
| `scripts/cuna-payout-verify.cjs` | independent pre-send recheck of a payout batch |

**The accrual scheduler is deliberately NOT inside the `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID`
block.** Everything in there silently fails to start when either is unset — an accrual that stopped
for that reason would mean people earning nothing with no error anywhere.

**A 03:00 UTC watchdog checks that today actually got accrued.** If the programme is armed and
today's day is still missing from the ledger by then, it fires one `cunaOpsAlert` to the operator
chat pointing at `/api/cuna-stake/admin` — the hourly tick keeps retrying regardless, but if the
chain read is failing, nobody earns until someone fixes it, so this is the tripwire that says so
instead of it going unnoticed for days.

**The CUNA staking hosts are exempt from the origin lockdown** for ten exact paths, anchored at
both ends. The hosts come from `CUNA_STAKE_HOSTS` (comma-separated; default
`staking.cunatoken.com,www.staking.cunatoken.com,lock.cunatoken.com,www.lock.cunatoken.com`) and are
matched WHOLE, never as a suffix. Adding an alias is two steps that must happen together: add the
custom domain in Railway, and add the host to the env var — a host that resolves to us but is
missing from the list gets a 403, which is the correct failure but reads as "the site is down". `/api/cuna-stake/admin` is deliberately absent, and the handler refuses anything carrying
`req.cluckDirect` before it even compares the key. `scripts/cuna-stake-routing-test.cjs` reads that
regex out of `server.js` so it cannot drift. **Never widen it with a prefix** — `^/api/` there is a
hole through the WAF to every money endpoint for anyone who points a DNS record at our origin.

---

## Still open

- **The owner's full wallet list** for `excludeWallets` is still just the treasury. `5WUjHiUV…` is
  **not** on it, on purpose — it actually holds **two qualifying CUNA locks** (it does not have "no
  locks at all"), and the owner uses it deliberately to watch the dashboard as a real earning
  wallet. Excluding it would defeat that.
- **A staging service exists for the CUNA hosts** — `lock.cunatoken.com` currently points at
  `staging-clkn-production.up.railway.app`, not production, so changes here can be reviewed live at
  that URL before they reach the main domain. This is separate from `staging.clucknorris.app` in
  `docs/STAGING_WORKFLOW.md`, which is a different (still not set up) environment for the rest of
  the app — don't assume "no staging exists" for CUNA work just because that one doesn't exist yet.
