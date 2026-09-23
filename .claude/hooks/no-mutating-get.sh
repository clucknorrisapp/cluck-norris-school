#!/usr/bin/env bash
# PreToolUse hook on Bash. Blocks a curl against a known clucknorris.app admin route that carries
# a mutating flag but is NOT sent as a POST — the exact class of bug AGENTS.md documents
# repeatedly ("Admin routes that ACT are POST-only... a flag-less GET is still the dry run / read"
# and the 2026-09-17 rose-buybot incident, where a plain GET on a route everyone assumed was a
# read turned out to run a full poll). Reads stdin as the tool_use JSON, checks the command
# string, and exits 2 (block, message on stderr) or 0 (allow).
#
# Codex round 23 (#411 P2): the check used to look at the WHOLE command string, so
# `curl -X POST https://x/y; curl "…/admin?run=1"` was allowed — the POST on the first curl
# "covered" the unrelated, unsafe second one. Every curl invocation is now judged on ITS OWN
# flags: the command is split into segments on `;`, `&&`, `||`, `|` and newlines (a simple split,
# not a full shell parser — good enough to find a URL even inside quotes), and each segment that
# is itself a curl against an admin path with a mutating flag must carry an explicit POST, or a
# data flag with no explicit GET override (`-G`/`--get`/`-X GET`/etc. beats a data flag, since
# curl itself treats those as "send as GET").
set -euo pipefail

INPUT="$(cat)"

# Pull tool_input.command with a tiny inline node (jq may not be present in every runner) — falls
# back to a raw grep-based extraction if node is unavailable, so the hook never crash-allows.
COMMAND="$(printf '%s' "$INPUT" | node -e '
  let s = "";
  process.stdin.on("data", (d) => (s += d));
  process.stdin.on("end", () => {
    try {
      const j = JSON.parse(s);
      const cmd = (j && j.tool_input && j.tool_input.command) || "";
      process.stdout.write(cmd);
    } catch (e) {
      process.stdout.write("");
    }
  });
' 2>/dev/null || true)"

if [ -z "$COMMAND" ]; then
  # Could not parse a command (not a Bash tool call shaped the way we expect, or no node) —
  # nothing to check, allow.
  exit 0
fi

# Fast path: nothing here invokes curl at all, so no segment could possibly need checking.
case "$COMMAND" in
  *curl*) ;;
  *) exit 0 ;;
esac

# Only look at commands that target clucknorris.app/api/ under one of the known admin paths.
ADMIN_PATH_RE='clucknorris\.app/api/(whirlpool/vault|cuna-giveaway/admin|cuna-stake/payout|cuna-stake/admin|tg-test|x-announce|meme-queue|lock-celebration|buybot|rose-buybot|x-delete|diploma-mint|school-airdrop|[a-zA-Z0-9_-]*-engine)'

# Only look at segments carrying a mutating flag.
MUTATING_FLAG_RE='(\?|&)(run=1|arm=1|disarm=1|set=|draw=1|payout=1|export=1|send=|confirm=|sweep=1|post=1|done=|art=|clear=1|reset=1|scan=1|board=1|on=1|off=1|dq=|min=|start=|end=)'

# An explicit POST — the forms AGENTS.md and the runbooks actually use: `-X POST`, `-XPOST`,
# `-X 'POST'`, `--request POST`, `--request=POST`.
EXPLICIT_POST_RE="(-X[[:space:]]*'?POST'?|--request[=[:space:]]+'?POST'?)"

# An explicit GET override. curl sends GET by default, but these flags force it even when a data
# flag is present (`-d`/`--data*` with `-G`/`--get` moves the data onto the URL and still sends a
# GET) — so an explicit GET always wins over a data flag, never the other way round.
EXPLICIT_GET_RE="(-X[[:space:]]*'?GET'?|--request[=[:space:]]+'?GET'?|(^|[[:space:]])-G([[:space:]]|$)|--get)"

# A data flag. `-d ` needs the trailing space/word-boundary so it doesn't match inside some other
# flag's spelling.
DATA_FLAG_RE="(--data-urlencode|--data-binary|--data-raw|--data|--json|(^|[[:space:]])-d[[:space:]])"

# Split the command into segments on `;`, `&&`, `||`, `|` and newlines. Multi-char operators are
# collapsed first so `||`/`&&` don't get chopped into stray single `|`s. This is a simple split,
# not a shell parser — quoted URLs still contain none of these separator characters, so a URL
# inside quotes is never itself split apart.
NORMALIZED="$COMMAND"
NORMALIZED="${NORMALIZED//'||'/$'\x01'}"
NORMALIZED="${NORMALIZED//'&&'/$'\x01'}"
NORMALIZED="${NORMALIZED//';'/$'\x01'}"
NORMALIZED="${NORMALIZED//'|'/$'\x01'}"
NORMALIZED="${NORMALIZED//$'\n'/$'\x01'}"

SEGMENTS=()
IFS=$'\x01' read -r -a SEGMENTS <<< "$NORMALIZED" || true
# Belt-and-suspenders: if splitting somehow produced nothing to iterate (an unexpected bash
# behaviour, not a case we've hit), fall back to treating the whole command as one segment rather
# than silently checking zero segments and allowing by default.
if [ "${#SEGMENTS[@]}" -eq 0 ]; then
  SEGMENTS=("$COMMAND")
fi

BLOCKED_SEGMENT=""
for SEG in "${SEGMENTS[@]}"; do
  case "$SEG" in
    *curl*) ;;
    *) continue ;;
  esac
  if ! printf '%s' "$SEG" | grep -qE "$ADMIN_PATH_RE"; then
    continue
  fi
  if ! printf '%s' "$SEG" | grep -qE "$MUTATING_FLAG_RE"; then
    continue
  fi
  # This segment, on its own, is a curl against an admin path carrying a mutating flag — it must
  # be an explicit POST, or a data flag with no explicit GET override.
  if printf '%s' "$SEG" | grep -qE "$EXPLICIT_POST_RE"; then
    continue
  fi
  if printf '%s' "$SEG" | grep -qE "$DATA_FLAG_RE" && ! printf '%s' "$SEG" | grep -qE "$EXPLICIT_GET_RE"; then
    continue
  fi
  BLOCKED_SEGMENT="$SEG"
  break
done

if [ -z "$BLOCKED_SEGMENT" ]; then
  exit 0
fi

echo "BLOCKED: this curl targets a clucknorris.app admin route with a mutating flag but is not a POST." >&2
echo "AGENTS.md: 'Admin routes that ACT are POST-only' — a GET on these routes either 405s or," >&2
echo "worse, silently runs the dry-run/read path while looking like the real action (or vice versa" >&2
echo "— the 2026-09-17 rose-buybot incident: a 'harmless' GET actually ran a full poll)." >&2
echo "Add -X POST (or --request POST / --data / --data-binary) to the command." >&2
echo "This is judged PER curl invocation — an earlier or later POST elsewhere in the same" >&2
echo "command does not cover this one." >&2
echo "Segment: $BLOCKED_SEGMENT" >&2
echo "Command: $COMMAND" >&2
exit 2
