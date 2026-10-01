# Architecture — which repo does what

Two repos, one boundary. Written down 2026-09-19 because a session spent an hour reasoning
about the wrong one.

## The boundary

**This repo is the PLATFORM. `clucknorrisapp/CLKN-SEEKER` is the APPS repo.**

- **Platform** (here) — anything with a database, a secret, or a decision in it: the backend,
  every API endpoint, the schedulers, the web app, the business logic, the i18n dictionaries and
  the tests. Everything that decides **what is true**.
- **Apps** (`CLKN-SEEKER`) — every client that ships to an app store: the Google Play wrapper,
  the iOS wrapper, the live Solana dApp Store app, and the planned native Seeker app. Everything
  that decides **how it looks on a device**. It is **packaging-only and contains no product code**
  (`play-store/WRAPPER-BUILD-TARGETS.md` over there is the decision of record).

There is no third repo, and the app is not built here-and-there: its **frontend** is built here,
its **package** is built there.

## The two contracts between them

Never shared source. Two interfaces, both of which already exist:

1. **The HTTP API.** Store clients depend on a versioned endpoint set — `STORE_API_RE` in
   `server.js` is exactly that, and renaming one of those routes or changing its response shape
   requires cutting a new client release. Treat it as a published contract, not internal code.
2. **The pinned frontend artifact.** This repo builds and publishes a checksummed `.tgz` per
   store variant as a GitHub release; the apps repo pins it by `sha256` in `store-edition.lock`
   and bundles it. Format and rules: `play-store/DELIVERY-CONTRACT.md` in the apps repo.
   Consequence, and the point of the whole design: **a deploy of this website can never change an
   installed store app.**

⚠️ **The tripwire.** If you find yourself copying logic across the boundary — rent maths, holder
rules, checkup heuristics — the boundary is in the wrong place. The fix is to put that logic
behind an endpoint here, never to keep two copies. This codebase has been bitten repeatedly by
duplicated implementations drifting apart.

## Store variants

| Variant | Built where | Delivery | Store |
|---|---|---|---|
| `store-google` | here → pinned `.tgz` | bundled | Google Play |
| `store-ios` | here → pinned `.tgz` | bundled | Apple App Store |
| FULL (`solana` target) | — | **remote**, loads `clucknorris.app` | Solana dApp Store (live) |
| `store-seeker` | here → pinned `.tgz` | bundled | Solana dApp Store (planned) |

The planned **native Seeker app** fits this model without changing it: a mobile-first frontend
variant built here, published as a pinned artifact, packaged in the apps repo with the Mobile
Wallet Adapter native plugin, and shipped under its own appId so the live listing carries no risk.
Extend `DELIVERY-CONTRACT.md` with the `seeker` variant before building against it.

## Working across the two

- **A session can attach both repos.** The apps session attaches this one **read-only**
  (`add_repo` → clone → `register_repo_root`) to read endpoint shapes. A session here does not
  need the apps repo.
- **Coordinate through the repos, not between sessions.** Session-to-session messaging does not
  survive a session ending; a doc does.
- **Releases are built on the owner's Mac.** Signing needs the keystore and iOS needs macOS, so a
  cloud container cannot produce a store artifact. Cloud sessions write code and open PRs; the Mac
  signs and publishes.

## Known drift (2026-09-19)

- `CLAUDE.md` here says the Play app shipped as `store-google-v1.0.0` built from `dc8652a`.
  `store-edition.lock` in the apps repo pins **1.0.3**, built from `dd115d2`. One of them is
  stale; the lock is the operative one.
- The apps repo's `dapp-store/config.yaml` listing copy still advertises retired features
  (Cluck Score, Survival Simulator, the Ultimate Challenge) and the retired CLKN-micropayment
  model. It needs a rewrite before the next dApp Store republish.
