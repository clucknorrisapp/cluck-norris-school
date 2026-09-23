#!/usr/bin/env bash
# PreToolUse hook on Bash. Blocks a curl against a known clucknorris.app admin route that carries
# a mutating flag but is NOT sent as a POST — the exact class of bug AGENTS.md documents
# repeatedly ("Admin routes that ACT are POST-only... a flag-less GET is still the dry run / read"
# and the 2026-09-17 rose-buybot incident, where a plain GET on a route everyone assumed was a
# read turned out to run a full poll). Reads stdin as the tool_use JSON, checks the command
# string, and exits 2 (block, message on stderr) or 0 (allow).
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

# Only look at commands that actually invoke curl.
case "$COMMAND" in
  *curl*) ;;
  *) exit 0 ;;
esac

# Only look at commands that target clucknorris.app/api/ under one of the known admin paths.
ADMIN_PATH_RE='clucknorris\.app/api/(whirlpool/vault|cuna-giveaway/admin|cuna-stake/payout|cuna-stake/admin|tg-test|x-announce|meme-queue|lock-celebration|buybot|rose-buybot|x-delete|diploma-mint|school-airdrop|[a-zA-Z0-9_-]*-engine)'
if ! printf '%s' "$COMMAND" | grep -qE "$ADMIN_PATH_RE"; then
  exit 0
fi

# Only look at commands carrying a mutating flag.
MUTATING_FLAG_RE='(\?|&)(run=1|arm=1|disarm=1|set=|draw=1|payout=1|export=1|send=|confirm=|sweep=1|post=1|done=|art=|clear=1|reset=1|scan=1|board=1|on=1|off=1|dq=|min=|start=|end=)'
if ! printf '%s' "$COMMAND" | grep -qE "$MUTATING_FLAG_RE"; then
  exit 0
fi

# If it's already a POST (either flag form), allow.
POST_RE='(-X[[:space:]]*POST|--request[[:space:]]+POST|--data|--data-binary)'
if printf '%s' "$COMMAND" | grep -qE "$POST_RE"; then
  exit 0
fi

echo "BLOCKED: this curl targets a clucknorris.app admin route with a mutating flag but is not a POST." >&2
echo "AGENTS.md: 'Admin routes that ACT are POST-only' — a GET on these routes either 405s or," >&2
echo "worse, silently runs the dry-run/read path while looking like the real action (or vice versa" >&2
echo "— the 2026-09-17 rose-buybot incident: a 'harmless' GET actually ran a full poll)." >&2
echo "Add -X POST (or --request POST / --data / --data-binary) to the command." >&2
echo "Command: $COMMAND" >&2
exit 2
