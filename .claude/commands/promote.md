---
description: Promote develop to main (production release). Runs only on the owner's explicit go in the moment.
argument-hint: (no arguments — run only when the owner has just said "promote")
allowed-tools: Bash, mcp__github__create_pull_request, mcp__github__merge_pull_request, mcp__github__pull_request_read, mcp__github__get_check_run, mcp__github__list_commits
---

⛔ **This runs only on the owner's explicit "promote" in the moment — never inferred, never as a
matter of course.** (AGENTS.md "Branching": *"promote `develop` → `main` only on an explicit owner
go in the moment; never automatically, never inferred."*) If you were not just told to promote,
stop here and say so instead of running this.

Source: `docs/STAGING_WORKFLOW.md` + the exact sequence that worked on 2026-09-22.

## Steps

1. **Deepen and fetch both refs** (a shallow clone lies about the diff):
   ```
   git fetch --deepen=400 origin main develop
   ```

2. **Local dry-run merge, zero side effects.** From a temp branch based on `origin/main`:
   ```
   git checkout -b _promote-dryrun origin/main
   git merge --no-commit --no-ff origin/develop
   ```
   - If this reports **zero conflicts**, abort the merge (`git merge --abort`) and clean up the
     temp branch — the real merge will be a PR merge, not a local push.
   - If it **conflicts**: merge `origin/main` INTO `develop` instead, keeping `develop`'s side on
     every conflict, then **assert `git diff --cached origin/develop --stat` is EMPTY before
     committing** — a squash-divergence merge once silently re-added a file `develop` had deleted.
     A non-empty diff here means something is about to regress; stop and report it rather than
     committing.

3. **Open the PR `develop` → `main`** (if one isn't already open).

4. **Merge only once CI is green on the head sha** (a push-event run on that same sha counts as
   green too — it doesn't have to be the PR-triggered run). Merge with:
   ```
   merge_method: "merge"
   ```
   **Never squash** — a squash merge here is what causes the divergence problem in step 2 on the
   *next* promotion.

5. **Poll production** until it has the promoted commit:
   ```
   curl -sS https://clucknorris.app/api/build
   ```
   until the returned `sha` matches the merge commit (or the `develop` head it carried).

6. **Verify whatever this promotion carried** — the specific surface(s) named in the task or PR,
   not just that `/healthz` returns 200.

## Report

The PR number, the merge commit sha, how long `/api/build` took to reflect it, and the specific
verification you did for what this promotion shipped.
