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

**Your share is your amount × the term you committed to.** That one line is the whole formula, and
the rate is **held flat for the life of the lock** — set the day we index it, unchanged until the
lock ends, then zero. There is no bonus table and there must never be one: the tiers are exact
90-day steps so they pay 1× to 6× by division alone, a CI test pins those ratios, and "you can
check it yourself" is most of why this is trustworthy.

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

```bash
# 1. Look at who qualifies TODAY, before anything is armed. Read-only.
node scripts/cuna-lock-scan-live.cjs

# 2. Check specific wallets — which are lock recipients, which actually earn.
node scripts/cuna-lock-whois.cjs <wallet> [<wallet> ...]

# 3. Add every wallet you control to the exclude list (Rule B). The treasury is already there and
#    cannot be removed.
curl "https://clucknorris.app/api/cuna-stake/admin?key=$PREMIUM_ACCESS_KEY&config=1&excludeWallets=2zMCUkE9pBjcC7ihtLqm28EsCoEHVmCdJYr5262EuPy8,<yours>,<yours>"

# 4. Preview what a day would pay. Writes nothing.
curl "https://clucknorris.app/api/cuna-stake/admin?key=$PREMIUM_ACCESS_KEY" | jq '.wouldPay, .eligible'

# 5. ARM. Two flags on purpose — one typo'd query param must not start an emission.
curl "https://clucknorris.app/api/cuna-stake/admin?key=$PREMIUM_ACCESS_KEY&arm=1&confirm=go-live"
```

⚠️ **Arming stamps the programme start, and it never moves again** — not across a disarm/re-arm.
Every lock's terms are measured against it. Arming also opens the `firstSeenAt` ledger for the first
time, so **every pre-existing lock is first seen on the day you arm**. That is deliberate: index
earlier and those locks carry a date from before the programme existed, which the cutoff then
rejects.

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
post directly — it calls `/api/burn-receipt`, which re-reads the transaction FROM THE CHAIN,
confirms it carries a real burn of this mint by this wallet, and derives the amount from the
balance delta. So the post says what actually happened rather than what the burner believed it was
doing, and the receipt link in it resolves because the same call stored it. X first, then Telegram,
via the existing `broadcastBurnCelebration` carve-out. Idempotent by signature, so a retry cannot
double-post — and fire-and-forget, because a failed announcement must never make the day look
unburned and burn another 690,000 tomorrow.

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

### Before EVERY send, run the verifier

```bash
node scripts/cuna-payout-verify.cjs https://clucknorris.app "$PREMIUM_ACCESS_KEY" [batchId]
```

It does not ask the server whether the server is right — it pulls the day ledger, the paid record
and the batch, recomputes from scratch, and compares. Checks: the line items sum to the stated
total, owed + pending + paid reconciles with everything ever credited, no excluded wallet is in the
batch, every recipient actually holds a CUNA lock on-chain, the batch is within days × daily pool,
and there are no duplicates or non-positive rows.

**It is tamper-tested**, which matters more than the checks themselves — a verifier that always
says green is worse than none. Inflating one line item, slipping the treasury in, inflating the
batch 50×, and adding a recipient with no lock are each caught, and an untouched batch passes.

Exit code is non-zero on any problem, so it can gate a script. **A green verifier is not the same
as a human having looked** — read the wallet list too.



Accrual writes what is owed. **Sending is your airdrop, signed by you.** Three steps, and the middle
one is what stops anyone being paid twice.

```bash
P="https://clucknorris.app/api/cuna-stake/payout?key=$PREMIUM_ACCESS_KEY"

curl "$P"                       # what is owed, and a preview of the file. Changes nothing.
curl "$P&export=1"              # create a PENDING batch — its amounts are held aside immediately
                                # -> .created.airdropLines, paste into /airdrop (manual mode)
curl "$P&confirm=<batchId>"     # AFTER the airdrop lands: pending -> paid
curl "$P&cancel=<batchId>"      # it never went: back to owed, nothing written to paid
```

**Export twice without confirming and the second one finds nothing** — the first batch is holding
it. That is the guard; do not route around it. Confirming credits only what *that batch* contained,
so accrual during its flight is still owed afterwards.

Dust under 1,000 CUNA stays owed and rolls forward. An over-payment reads as zero owed, never as a
debt.

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
| `scripts/cuna-*-test.cjs` | 175 tests, all in CI |
| `scripts/cuna-lock-scan-live.cjs` | who qualifies today, read from the chain |
| `scripts/cuna-lock-whois.cjs` | check wallets against every CUNA lock |

**The accrual scheduler is deliberately NOT inside the `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID`
block.** Everything in there silently fails to start when either is unset — an accrual that stopped
for that reason would mean people earning nothing with no error anywhere.

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

- **The owner's full wallet list** for `excludeWallets`. Two supplied so far: `5WUjHiUV…` (no CUNA
  locks at all) and the treasury.
- **`staging.clucknorris.app` does not exist** — the one-time Railway/Cloudflare setup in
  `docs/STAGING_WORKFLOW.md` was never done, so nothing can be reviewed on staging yet. Until then,
  changes are rendered locally with Playwright and sent as screenshots.
