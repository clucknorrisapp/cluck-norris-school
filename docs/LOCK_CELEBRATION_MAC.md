# Lock-Celebration on the Mac mini (the permanent home)

The always-on Mac mini runs the hourly lock-celebration check via **launchd** — macOS's
built-in scheduler. Unlike a cloud Claude session (7-day cap), launchd never expires and
survives reboots. The flow:

```
Railway bot detects a new lock (30-min scan)
  → posts NOTHING (one-post redesign 2026-07-03: text + image ship together)
  → composes the announcement copy (tgText/xText) into the "celebration pending"
    flag (kv, via /api/lock-celebration)

Mac mini, hourly (launchd → scripts/lock-celebration.sh)
  → 1-second curl: anything pending?  no → exit (Claude never launches, costs nothing)
  → yes → headless Claude Code run:
      Higgsfield (owner's Plus plan) generates a UNIQUE image — Cluck hauls
      exactly newLocks bag(s) ("+X CLKN") to a vault door reading the TOTAL
      locked (upper) and the % OF SUPPLY LOCKED (lower)
      → posts ONE combined X post (pending.xText verbatim + the image)
      → THEN one silent Telegram photo (pending.tgText + the X link)
      → clears the flag
```

If the mini is ever off, nothing is lost: the flag waits, and if NOTHING picks it up
within 24h the Railway tick posts the text-only copy itself (a lock never goes silent);
a later run then adds the image threaded/replacing per pending.announced.

## One-time setup (~10 minutes, on the mini)

1. **Claude Code installed + logged in** (see `docs/MAC_SETUP.md`), and the repo cloned:
   `git clone https://github.com/clucknorrisapp/cluck-norris-school ~/cluck-norris-school`

2. **Higgsfield MCP connected in Claude Code** (also covered in MAC_SETUP.md): add the
   Higgsfield MCP server, then run `/mcp` in an interactive `claude` session once to
   complete the OAuth login (this stores the credential locally so headless runs can use
   it). Verify with a quick test: ask Claude to generate any small image via Higgsfield.

3. **Secrets file** (outside the repo, never committed):
   ```bash
   cat > ~/.clkn-env <<'EOF'
   PREMIUM_ACCESS_KEY=<the Railway PREMIUM_ACCESS_KEY>
   EOF
   chmod 600 ~/.clkn-env
   ```

4. **Make the runner executable + test it once by hand:**
   ```bash
   chmod +x ~/cluck-norris-school/scripts/lock-celebration.sh
   ~/cluck-norris-school/scripts/lock-celebration.sh
   tail ~/Library/Logs/clkn-lock-celebration.log   # expect "no pending lock"
   ```

5. **Install the launchd job** (runs hourly, forever). ⚠️ **launchd runs with a bare PATH
   (`/usr/bin:/bin:…`) that does NOT include where `claude` is installed** — so the plist MUST
   set `EnvironmentVariables > PATH` to include it, or every real run silently fails to find
   `claude`. Find your path first: `which claude` (e.g. `~/.local/bin/claude` for the standard
   installer, or `/opt/homebrew/bin/claude` via Homebrew) and make sure that directory is in the
   PATH string below.
   ```bash
   cat > ~/Library/LaunchAgents/com.clucknorris.lock-celebration.plist <<EOF
   <?xml version="1.0" encoding="UTF-8"?>
   <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
   <plist version="1.0"><dict>
     <key>Label</key><string>com.clucknorris.lock-celebration</string>
     <key>ProgramArguments</key><array>
       <string>/bin/bash</string>
       <string>$HOME/cluck-norris-school/scripts/lock-celebration.sh</string>
     </array>
     <key>EnvironmentVariables</key><dict>
       <key>PATH</key><string>$HOME/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
     </dict>
     <key>StartInterval</key><integer>3600</integer>
     <key>RunAtLoad</key><true/>
     <key>StandardOutPath</key><string>$HOME/Library/Logs/clkn-lock-celebration.err</string>
     <key>StandardErrorPath</key><string>$HOME/Library/Logs/clkn-lock-celebration.err</string>
   </dict></plist>
   EOF
   launchctl load ~/Library/LaunchAgents/com.clucknorris.lock-celebration.plist
   launchctl list | grep clucknorris          # confirm loaded
   sleep 6; tail ~/Library/Logs/clkn-lock-celebration.log   # RunAtLoad fired: expect "no pending lock"
   ```
   (`RunAtLoad` fires it once immediately as a smoke test — the script no-ops when nothing is pending.)

6. **Keep the mini awake:** System Settings → Energy → enable "Prevent automatic
   sleeping when the display is off" (or `sudo pmset -a sleep 0`).

7. **Daily heartbeat (dead-man's switch)** — the runner also auto-`git pull`s each hour
   (baked into `lock-celebration.sh`), so no manual updates. This job DMs the operator's
   PRIVATE Telegram once a day that the mini is alive + the celebration job is loaded; a
   MISSING daily ping = the mini is off/asleep/broken.
   ```bash
   chmod +x ~/cluck-norris-school/scripts/mac-heartbeat.sh
   cat > ~/Library/LaunchAgents/com.clucknorris.heartbeat.plist <<EOF
   <?xml version="1.0" encoding="UTF-8"?>
   <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
   <plist version="1.0"><dict>
     <key>Label</key><string>com.clucknorris.heartbeat</string>
     <key>ProgramArguments</key><array>
       <string>/bin/bash</string>
       <string>$HOME/cluck-norris-school/scripts/mac-heartbeat.sh</string>
     </array>
     <key>EnvironmentVariables</key><dict>
       <key>PATH</key><string>$HOME/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
     </dict>
     <key>StartInterval</key><integer>86400</integer>
     <key>RunAtLoad</key><true/>
     <key>StandardOutPath</key><string>$HOME/Library/Logs/clkn-heartbeat.err</string>
     <key>StandardErrorPath</key><string>$HOME/Library/Logs/clkn-heartbeat.err</string>
   </dict></plist>
   EOF
   launchctl load ~/Library/LaunchAgents/com.clucknorris.heartbeat.plist
   ```
   (`RunAtLoad` fires one heartbeat immediately so you see it land in your operator DM.)

## Verify it's alive
```bash
launchctl list | grep clucknorris          # job loaded
tail -f ~/Library/Logs/clkn-lock-celebration.log   # hourly "no pending lock" lines
```
The bot side is observable too: `GET /api/lock-celebration` (gated) shows `probe` — the
last run's Higgsfield status report.

## Test the whole pipeline end-to-end (optional, posts publicly!)
Only when you WANT a real celebration post: lock tokens as normal, or wait for a real
lock. There is deliberately no "fake lock" lever — the flag is only ever set by
`lockWatchTick` on a real on-chain increase.

## Interim coverage (until the mini is set up)
A cloud Claude session cron covers the same job but expires with the session (≤7 days).
Any new long-lived cloud session should re-arm it — see the CLAUDE.md
"Lock-celebration image flow" note. Once the mini job is loaded, the cloud cron is
redundant (both are idempotent — the flag clears on first success, so double-arming
can't double-post... the second runner finds pending:null and exits).
