# Buy-comp server payout — `/api/buycomp/send`

**Owner, 2026-09-15:** *"part of the buy specials in future will be automated options for me and
projects."* This is the first piece: the server pays a buy competition's sealed winner list itself,
signing with the payer project's operator key on Railway — the same key and the same vault call
(`payoutSpl`) the CUNA giveaway payout has used since 2026-09-04. Until now the only way a verified
list reached wallets was pasting it into `/airdrop` and signing in the owner's browser.

Pure half + tests: `lib/buycomp-payout.js`, `scripts/buycomp-payout-test.cjs` (CI). Route:
`app.all("/api/buycomp/send", …)` in `server.js`, next to `/api/buycomp/payout`.

## What holds the money

1. **Recipients come only from the sealed list on the comp** (`c.verified`). The send call cannot
   name an address. The list is sealed by `POST /api/buycomp/verify` (the on-chain hold check) or
   replaced by hand with `POST …&set=` (audited — the replaced list is kept on the comp in
   `verifiedHistory`). `set` exists for the case verify cannot see: a wallet whose bag sits in a
   Jupiter lock scans as balance 0 and lands in "manual" (the ROSE horse race, 2026-09-14).
2. **Every transfer is journaled on the comp BEFORE it is broadcast** (`c.payouts[wallet] = {sig,
   amountUi, at, pending}`). The vault signs first, learns the signature from the signed bytes,
   the row is written and **verified on disk** (`kv.setVerified` re-reads the file — a plain
   read-back answers from memory), and only then is the transaction sent. A write that does not
   reach the volume throws and the batch stops with nothing broadcast for that recipient. A
   broadcast that errors AFTER the row (an RPC that accepted the transaction but timed out the
   response) leaves a pending row, never a retryable blank. A pending row blocks a retry exactly
   like a confirmed one: it may already have landed. (All three rules: second reviewer, 2026-09-15.)
3. **Caps are the sealed list's own max and sum** — the vault can never send more than verify (or
   the operator) sealed — tightened by `BUYCOMP_MAX_PRIZE` / `BUYCOMP_MAX_PAYOUT` env if set. A list
   over an env cap is refused outright, not trimmed.
4. **The vault's own refusals still apply:** it will not sign with a wallet that is the token's mint
   authority, it refuses an unfunded payer, and `totalMaxUi` is mandatory.
5. **Anything that changes state is POST-only** (`run` / `sweep` / `unpay` / `set`) — a GET with one
   of those flags is 405, decided before the comp lookup. `scripts/mutating-get-guard-test.cjs` pins it.
6. **One run at a time, across processes:** a kv lock with a 10-minute TTL (Railway runs more than
   one instance; a Cloudflare 524 then a retry can land on another one).

## The flow

All calls carry the admin key in the `x-premium-key` header (`BUYCOMP_KEY` or `PREMIUM_ACCESS_KEY`).
Never put the key in a URL you paste anywhere.

```bash
K='x-premium-key: <admin key>'
B='https://clucknorris.app/api/buycomp/send?id=<comp id>'

# 1. Read. What is sealed, what is journaled, and the vault's dry run: payer balance, decimals,
#    caps, the mint-authority check, and `action: "would-pay"` with the exact rows.
curl -sS -H "$K" "$B"

# 2. (Only if verify missed someone.) Replace the sealed list by hand. Airdropper format,
#    "wallet, amount" per line, header optional. Returns the new count/total and the dry run.
curl -sS -X POST -H "$K" -H 'content-type: application/json' "$B" \
  --data-binary @- <<'EOF'
{"set": "4Gccq9pESbfNeKiW7M7qi587pYYiaQ4T4zLv3LcriGPs, 13722.42\n5WKKoF7LcDRsSfTYxccSEj7hejh9U5ZqcX74C7E5X7HG, 5301.74\n5EjuMxEyxbmja7Nn664CqF5CD47udkqR4dppqNTtDprQ, 4158.04\n5AXZPsqsQvXaWk3Mjwn4TfisFbTyvmFaodiFLcoaHS2B, 1920.20\nCwaM5dYLzya3V26VHQjnZVxh3iigrxbgVQJm4npPSBdo, 1651.25\n4tjf9BB9yEaTDcwewGf78WWz1KvvXY7wpU6AHp7SwSzS, 954.88",
 "note": "option B — pay all six who held (locked wallet was filed manual by the scanner)"}
EOF

# 3. Send. Signs on Railway with the payer's operator key. &from=treasury is the default (the
#    prize supply sits there); any vault project id works.
curl -sS -X POST -H "$K" "$B&run=1&from=treasury"

# 4. If anything came back `pending` (confirm timed out, or the broadcast errored): resolve it
#    against the chain. Landed → settled. Landed with an error → voided, owed again (the chain
#    holds a definitive record that no tokens moved). NOT FOUND → stays pending, however old: a
#    lagging node or one with a history gap answers null for a transfer that DID land, and
#    clearing it would pay that winner twice.
curl -sS -X POST -H "$K" "$B&sweep=1"

# 5. The ONLY way a not-found row is cleared: you check the signature on an explorer yourself, and
#    only if it truly never landed, clear it with the exact recorded signature.
curl -sS -X POST -H "$K" "$B&unpay=<wallet>&sig=<recorded sig>"
```

Re-running step 3 is safe: `owed` is the sealed list minus every journaled wallet, so a retry
after a 524 or a mid-run redeploy pays only whoever was not sent.

## The ROSE horse race (`bc_ec2e5f9669`)

Owner decision 2026-09-15: **Option B — pay all six who held**, 27,708.53 ROSE
(`RoSeiVjW5H48ucPAJh1LJGBBzPpqvsokfDGpgHXDtdF`), from the treasury. The six-line `set` block above
is that list; the unit test parses the same block to 6 rows / 27,708.53 as a guard against a
typo here. A75SX… is out (dumped 216,357 ROSE to a runner wallet mid-hold); CwaM5… is in (no
in-window sell or transfer; disposed 2026-09-13, after the hold ended on the 12th).

## What this is not

- Not a generic "send tokens to these addresses" endpoint. The address list is state on the comp,
  written by a separate audited call, never a parameter of the send.
- Not armed by a flag. There is nothing to leave on: each send is one explicit POST with the admin
  key, and the journal makes the second POST a no-op.
- Not the lock-to-earn payout. `/api/cuna-stake/payout` still exports batches for the airdropper;
  moving it onto this pattern is the next step of the same ask.
