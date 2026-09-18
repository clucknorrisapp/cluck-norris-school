# @clkn/hub-verify

```
npx @clkn/hub-verify <receipt-url | bundle.json>
```

No clone, no build, no wallet, no login. This is the exact same verifier the
[Cluck Norris](https://clucknorris.app) Project Hub runs in three places — this command, the
`/hub/verify` page's in-browser bundle, and the repo's own `scripts/reproduce-receipt.cjs` — one
implementation, copied byte-for-byte into this package by
[`scripts/build-hub-verify-package.cjs`](https://github.com/clucknorrisapp/cluck-norris-school/blob/main/scripts/build-hub-verify-package.cjs),
never a second hand-typed copy that could drift from what the server actually does.

> **Publishing status:** this package is built and tested in the
> [cluck-norris-school](https://github.com/clucknorrisapp/cluck-norris-school) repo on every
> commit that touches it, but **publishing it to the npm registry is pending — it happens only on
> the project owner's own act.** Until then, run it straight from the repo:
> `node scripts/reproduce-receipt.cjs <receipt-url>` does exactly the same thing, or
> `npx github:clucknorrisapp/cluck-norris-school#path:packages/hub-verify` runs this package
> straight from a git ref without a registry publish at all.

## What it does

A Project Hub receipt names an amount. This command re-fetches the *published inputs* that
amount was supposed to come from (a batch's accrual periods, what was already paid or held
elsewhere) and re-derives the number itself, on your machine, using the same pure arithmetic the
server ran — never a "trust our API" round trip.

```bash
npx @clkn/hub-verify https://clucknorris.app/hub/cuna/r/<sig>
npx @clkn/hub-verify cuna hb_1a2b3c4d 4Gccq9pESbfNeKiW7M7qi587pYYiaQ4T4zLv3LcriGPs
npx @clkn/hub-verify --offline <dir> https://clucknorris.app/hub/cuna/r/<sig>
npx @clkn/hub-verify --bundle bundle.json
```

(The full usage text and every mode — `--offline`, `--bundle`, the three-argument form — are
identical to `scripts/reproduce-receipt.cjs` in the main repo; see that file's own header for the
complete walkthrough. Its banner and error text still say `scripts/reproduce-receipt.cjs` because
this **is** that file, unrenamed, on purpose — see "one code path" above.)

## What a verdict means

- **`MATCH`** (exit code `0`) — the amount is exactly reproducible from the inputs the server
  published for this receipt. This proves the number **follows the published rule**; it does not
  by itself prove the rule is fair, or that nothing eligible was left out of the calculation —
  read `/hub/trust` on the site for what independent on-chain commitment does and does not add on
  top of this.
- **`MISMATCH`** (exit code `2`) — re-deriving the amount from the published inputs gives a
  *different* number than what was actually paid. This is a real finding, not a false alarm to
  paper over; it means either the inputs or the payout disagree with each other in public.
- **`MISSING_INPUTS`** (exit code `3`) — the command names exactly which input it could not find
  (a route not yet promoted to the host you pointed it at, a payout kind reproduction isn't
  implemented for yet, or similar). This is an honest "can't check yet," never a silent pass.
- Exit code `1` — a usage error or a fetch that could not complete at all (bad URL, host
  unreachable).

Never read a `MATCH` here as "verified," "audited," or "safe" — those words describe a claim this
command does not make. It checks one arithmetic fact: does the published number follow from the
published inputs under the published rule.

## No runtime dependencies

`bin/`, `lib/` and `schema/` are plain Node (`>=20`) with zero npm dependencies — the whole
package is under a few hundred KB. `lib/` and `schema/` are a generated copy of files that live in
the main repo at `lib/hub/*.js`, `lib/sol-addr-re.js`, `lib/buycomp-payout.js` and
`lib/hub/schema/*.json`; `MANIFEST.json` (not published in the npm tarball, but present in the
git repo) records each source file's sha256 so drift between this package and the repo it was
built from is a diffable fact, not something a reader has to take on faith.

## Learn more

- [`docs/HUB_VERIFY.md`](https://github.com/clucknorrisapp/cluck-norris-school/blob/main/docs/HUB_VERIFY.md) — the full reproduction checklist, including the on-chain commitment and what is honestly not verifiable yet.
- [`/hub/trust`](https://clucknorris.app/hub/trust) — the plain-words trust-boundary page this
  README's "what a verdict means" section summarizes.
- [`/hub/verify`](https://clucknorris.app/hub/verify) — the same reproduction in a browser tab,
  for a reader who does not run Node.

MIT licensed — see `LICENSE`.
