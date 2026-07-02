#!/bin/bash
# Hourly CLKN lock-celebration runner (Mac mini, launchd) — see docs/LOCK_CELEBRATION_MAC.md
# Cheap by design: a 1-second curl decides whether anything is pending; Claude only
# launches when there is actually a new lock to celebrate.
set -euo pipefail

# Secrets live OUTSIDE the repo: ~/.clkn-env must define PREMIUM_ACCESS_KEY (chmod 600).
source "$HOME/.clkn-env"
export PREMIUM_ACCESS_KEY

REPO_DIR="${CLKN_REPO_DIR:-$HOME/cluck-norris-school}"
LOG="$HOME/Library/Logs/clkn-lock-celebration.log"
cd "$REPO_DIR"

resp=$(curl -sS --max-time 20 "https://clucknorris.app/api/lock-celebration" -H "x-premium-key: $PREMIUM_ACCESS_KEY" || echo "")
if ! printf '%s' "$resp" | grep -q '"pending":{'; then
  echo "$(date -u +%FT%TZ) no pending lock" >> "$LOG"
  exit 0
fi

echo "$(date -u +%FT%TZ) PENDING LOCK — launching Claude" >> "$LOG"
# Sonnet 5 — owner's call (2026-07-02): it writes noticeably better Higgsfield prompts.
claude -p "$(cat scripts/lock-celebration-prompt.md)" \
  --model claude-sonnet-5 \
  --allowedTools "Bash,ToolSearch,mcp__Higgsfield__generate_image,mcp__Higgsfield__job_display,mcp__Higgsfield__media_import_url,mcp__Higgsfield__list_workspaces,mcp__Higgsfield__select_workspace" \
  >> "$LOG" 2>&1
echo "$(date -u +%FT%TZ) run finished" >> "$LOG"
