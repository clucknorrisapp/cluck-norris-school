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
| Tiers | 3/6/9/12/15/18 months → **1×–6×**, from the weight formula alone |
| Pool | **10%** of the treasury's daily unlock (owner, 09-05, down from 20: *"we can always go up later"*) |
| Dust floor | 100,000 CUNA minimum lock; 1,000 CUNA minimum payout |
| Daily burn | **690,000 CUNA at 15:00 UTC** from the treasury, claim-first |

**Your share is your amount × days still to run.** That one line is the whole formula. There is no
bonus table and there must never be one — the tiers already pay 1× to 6×, a CI test pins those
ratios, and "you can check it yourself" is most of why this is trustworthy.

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

## Paying people

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
| `public/cuna-staking.html` | the page — `/cuna-staking`, and `/` on staking.cunatoken.com |
| `scripts/cuna-*-test.cjs` | 127 tests, all in CI |
| `scripts/cuna-lock-scan-live.cjs` | who qualifies today, read from the chain |
| `scripts/cuna-lock-whois.cjs` | check wallets against every CUNA lock |

**The accrual scheduler is deliberately NOT inside the `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID`
block.** Everything in there silently fails to start when either is unset — an accrual that stopped
for that reason would mean people earning nothing with no error anywhere.

**`staking.cunatoken.com` is exempt from the origin lockdown** for eight exact paths, anchored at
both ends. `/api/cuna-stake/admin` is deliberately absent, and the handler refuses anything carrying
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
