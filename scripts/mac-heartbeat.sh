#!/bin/bash
# Daily Mac-mini heartbeat (launchd) — a dead-man's switch for the unattended box.
# DMs the operator's PRIVATE Telegram (project=treasury → owner DM, NOT the community
# room) once a day: "mini alive, celebration job loaded". The point is the ABSENCE of
# this ping — if a day goes by with no heartbeat, the mini is off/asleep/broken and the
# hourly lock celebrations aren't running. See docs/LOCK_CELEBRATION_MAC.md.
set -euo pipefail

source "$HOME/.clkn-env"
export PREMIUM_ACCESS_KEY
LOG="$HOME/Library/Logs/clkn-heartbeat.log"

# Is the celebration launchd job actually loaded?
if launchctl list 2>/dev/null | grep -q 'com.clucknorris.lock-celebration'; then
  STATUS="✅ alive — lock-celebration job loaded"
else
  STATUS="⚠️ ALERT: lock-celebration launchd job is NOT loaded"
fi

# Last celebration-runner activity (tail of its log), for a quick health line.
LAST=$(tail -n 1 "$HOME/Library/Logs/clkn-lock-celebration.log" 2>/dev/null || echo "no runner log yet")

MSG="🖥️ <b>Mac mini heartbeat</b> — ${STATUS}
last runner tick: ${LAST}
$(date -u +%FT%TZ)"

curl -sS --max-time 20 -G "https://clucknorris.app/api/tg-test" \
  -H "x-premium-key: $PREMIUM_ACCESS_KEY" \
  --data-urlencode "project=treasury" \
  --data-urlencode "text=$MSG" >/dev/null 2>&1 || true

echo "$(date -u +%FT%TZ) heartbeat sent — ${STATUS}" >> "$LOG"
