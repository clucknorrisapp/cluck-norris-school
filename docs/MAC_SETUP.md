# Mac setup — Claude Code for Cluck Norris (~20 min)

The one-time setup to make a MacBook / Mac mini your Claude Code build bench. Nothing here touches production — Railway keeps running regardless; the Mac and any web session both point at the same GitHub.

## 1. Install Claude Code
```bash
npm install -g @anthropic-ai/claude-code   # CLI
# optional: the VS Code extension (inline diffs) and/or the desktop app
claude            # sign in
```

## 2. Get the repo running
```bash
git clone https://github.com/clucknorrisapp/cluck-norris-school.git
cd cluck-norris-school
npm install
node --check server.js        # sanity
npm start                     # serves the app locally (needs .env, below)
```

## 3. Local `.env` (NEVER commit — it's gitignored)
Copy the runtime secrets from Railway into a local `.env` for testing. Minimum to do useful work:
```
HELIUS_API_KEY=...
ANTHROPIC_API_KEY=...
PREMIUM_ACCESS_KEY=...
# optional, to test features locally:
SOLANA_TRACKER_API_KEY=...
BAGS_API_KEY=...
WEBACY_API_KEY=...          # lights up the DD.xyz cross-check
TELEGRAM_BOT_TOKEN=...      # only if testing the bot locally (usually leave to Railway)
```

## 4. Wire the MCP servers (this is the big iPad→Mac unlock)
Add to your Claude Code MCP config (`~/.claude.json` via `claude mcp add`, or a project `.mcp.json`). Browser now available → use the full routes.

**X API — full route (acts as @firechicken007; can search AND post):**
```bash
claude mcp add xapi npx -e CLIENT_ID=YOUR_X_OAUTH2_CLIENT_ID -e CLIENT_SECRET=YOUR_X_OAUTH2_CLIENT_SECRET -- -y @xdevplatform/xurl mcp https://api.x.com/mcp
```
- Needs **OAuth 2.0 enabled** on your X app + redirect URI `http://localhost:8080/callback` registered. First tool call opens the browser once to log in, then auto-refreshes forever.
- *Read-only alternative (simpler, no bridge):* point it at `https://api.x.com/mcp` with header `Authorization: Bearer <APP_ONLY_BEARER>` — good for search/lookup only.

**X docs (free, no auth):**
```bash
claude mcp add x-docs --url https://docs.x.com/mcp
```

**Higgsfield (images for posts):**
```bash
claude mcp add higgsfield --url https://mcp.higgsfield.ai/mcp
```

Verify: `claude mcp list` → all green.

## 5. Review the overnight work
```bash
git fetch origin
git log main..origin/claude/overnight-build --oneline   # the 7 staged features
# merge the ones you want, e.g.:  git checkout main && git merge origin/claude/overnight-build
```
Branch has: Safety Badge + /badge page, in-chat /autopsy, token-QA, Forensic API v1, Watchlists, CoinGecko webhook receiver. (Security fixes + content engine are already on main/live.)

## Notes
- **Mac mini option:** leave it on as an always-on bench and remote in from the iPad (Tailscale + SSH + tmux running `claude`) — full local power from anywhere. The MacBook is the carry-it version. Either works; you don't need both.
- **Don't commit secrets.** `.env`, `~/.claude.json`, and `~/.xurl` (X tokens) are all secrets — keep them local.
- Production is **Railway from `main`** — unaffected by any of this; it just runs.
