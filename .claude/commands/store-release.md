---
description: Cut a new store-edition release (Google Play + iOS) at a given version and re-pin the wrapper app.
argument-hint: <version, e.g. 1.1.2>
allowed-tools: Bash, mcp__github__create_pull_request, mcp__github__merge_pull_request, mcp__github__actions_run_trigger, mcp__github__get_release_by_tag, mcp__github__push_files
---

Version: `$ARGUMENTS`. Source: `.github/workflows/store-edition-release.yml`,
`docs/STORE_EDITION.md` "Publishing", and the wrapper's `store-edition.lock` pin format.

## Steps

1. **Bump the version on a branch.** Edit `store-edition/store-edition.json` → `version` to
   `$ARGUMENTS`. Open a PR, get it merged.

2. **Promote to production**: run `/promote` (only on the owner's go — same gate applies).

3. **Trigger the release workflow for both variants**, at the exact main commit sha the promotion
   landed:
   ```
   workflow_dispatch on store-edition-release.yml
     variant=google  version=$ARGUMENTS  ref=<full main sha>
     variant=ios      version=$ARGUMENTS  ref=<full main sha>
   ```
   The workflow refuses if `version` doesn't equal `store-edition/store-edition.json`'s version,
   and refuses a `ref` that isn't on `main` — that's a correctness check, not an obstacle to route
   around.

4. **Read each release's manifest** (`{version, url, sha256, sourceCommit}`) from the GitHub
   Release assets it publishes (`release/store-edition-<variant>-<version>.json`, `.tgz`,
   `.tgz.sha256`).

5. **Re-pin `store-edition.lock` in `clucknorrisapp/clkn-seeker`** with those values — **iOS by
   default**. The Play pin is a separate release decision the owner makes; say explicitly that you
   are not touching it unless told to.

6. **Trigger `android-build.yml`** on `clucknorrisapp/clkn-seeker` branch
   `claude/seeker-integration` with `platform_ref=main`, to produce a dev APK artifact for
   verification (this does not touch the store pin — it's a build check).

## Report

The store-edition PR, the promote result, both release tags + their sha256, which lock entry was
updated (and which was deliberately left alone), and the android-build run link + artifact.
