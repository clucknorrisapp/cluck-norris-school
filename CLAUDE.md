# CLAUDE.md

The operating notes for this repo live in **[AGENTS.md](AGENTS.md)** — one file, read by Claude
Code and by other agent tools (Codex) alike, so there is a single source of truth and nothing to
keep in sync.

@AGENTS.md

<!--
  WHY THIS FILE STILL EXISTS — do not "tidy" it away.

  Claude Code reads AGENTS.md automatically ONLY when all of these hold:
    • Claude Code v2.1.277 or later, AND
    • no CLAUDE.md / .claude/CLAUDE.md / CLAUDE.local.md exists on the path, AND
    • the session can fetch feature flags from Anthropic.

  A session on Bedrock or Vertex, one with telemetry disabled, or an older build reads
  CLAUDE.md files ONLY. If this file were deleted, such a session would load NO project
  instructions at all — silently, with no error. For a file whose whole job is carrying the
  traps that already cost someone a day, that is the worst possible failure mode.

  The `@AGENTS.md` import above is the documented pattern for sharing one instruction file
  across tools. Claude Code skips an AGENTS.md it has already loaded, so this never
  double-loads. A symlink would also work for reading, but a committed symlink checks out as a
  one-line text file on Windows without core.symlinks — which would quietly gut the
  instructions for that clone.
-->
