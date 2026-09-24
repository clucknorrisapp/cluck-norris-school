#!/usr/bin/env bash
# PreToolUse hook on Bash. Thin, portable wrapper — every bit of the actual decision (quote-aware
# segmentation, curl's effective-method computation) lives in no-mutating-get.js, run under Node.
# This script must work even on macOS's stock Bash 3.2, so it deliberately avoids everything that
# breaks there: no `${var//'x'/y}` with quoted patterns, no `read -a`, no `$'\x01'` tricks, no
# associative arrays, no `mapfile`. It reads stdin once, hands it to node, and exits with node's
# exit code — nothing here parses the command itself.
#
# Codex round 24 (#414 P2s), the reason this file no longer contains any logic:
#   1. The previous bash string-splitting version did not work on Bash 3.2 — its own `;`/`&&` test
#      cases FAILED there (the unsafe GET was allowed), and a background `&` or a nested
#      `$(curl …)`/backtick invocation bypassed the split entirely regardless of bash version.
#   2. An explicit POST ANYWHERE in a segment was accepted immediately, so
#      `curl -X POST -X GET <admin-url>?draw=1` was allowed even though curl itself sends that as
#      a GET (curl honours the LAST `-X`).
# Both are fixed by moving the whole decision into Node (see no-mutating-get.js), which parses the
# same way on every runner Node itself runs on.

INPUT="$(cat)"

HOOK_DIR="$(dirname "$0")"

if command -v node >/dev/null 2>&1; then
  printf '%s' "$INPUT" | node "$HOOK_DIR/no-mutating-get.js"
  exit $?
fi

# node is not on PATH. We cannot do quote-aware segmentation or curl's effective-method logic in
# portable shell, so this is a deliberately crude, fail-CLOSED fallback rather than a silent
# bypass: if the raw text mentions a clucknorris.app admin route AND any mutating flag name
# anywhere at all, block and say why; otherwise allow.
if printf '%s' "$INPUT" | grep -q 'clucknorris\.app/api/' \
  && printf '%s' "$INPUT" | grep -Eq 'run=1|arm=1|disarm=1|set=|draw=1|payout=1|export=1|send=|confirm=|sweep=1|post=1|done=|art=|clear=1|reset=1|scan=1|board=1|on=1|off=1|dq=|min=|start=|end='
then
  echo "BLOCKED: node is required to evaluate this command (no-mutating-get.js needs Node 18+)." >&2
  echo "The raw command text mentions a clucknorris.app admin path and a mutating flag name, and" >&2
  echo "this fallback cannot tell whether it is actually an unsafe GET without Node to parse it." >&2
  echo "Install node on this runner (or make sure it is on PATH) and re-run." >&2
  exit 2
fi

exit 0
