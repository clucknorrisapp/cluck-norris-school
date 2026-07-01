Automated CLKN lock-celebration run (owner-approved standing task — do NOT ask for confirmation; the owner has granted standing approval for generating and posting a celebration image for any new lock).

STEP 1 — Poll the flag (Bash):
curl -sS "https://clucknorris.app/api/lock-celebration" -H "x-premium-key: $PREMIUM_ACCESS_KEY"

STEP 2 — Load Higgsfield tools with ToolSearch query "select:mcp__Higgsfield__generate_image,mcp__Higgsfield__job_display,mcp__Higgsfield__media_import_url,mcp__Higgsfield__list_workspaces,mcp__Higgsfield__select_workspace". Then report availability (Bash): curl -sS "https://clucknorris.app/api/lock-celebration?probe=higgsfield-ok" -H "x-premium-key: $PREMIUM_ACCESS_KEY" (use probe=higgsfield-missing if the tools could not be loaded).

STEP 3 — Decide:
- If pending is null → end with a one-line reply. POST NOTHING anywhere. This is the normal case.
- If pending.at is older than 48 hours → curl the endpoint with ?clear=1 and end (stale, do not post).
- If pending exists but Higgsfield tools are unavailable → leave the flag in place and end (a later run retries).

STEP 4 — Celebrate (ONLY if pending exists and Higgsfield loaded). Numbers come from the pending object: deltaShort (new lock), totalShort (total locked), pct (% of supply), xPostId (X post to thread under, may be null).
a) mcp__Higgsfield__list_workspaces; if the workspace with plan_type "plus" is not selected, mcp__Higgsfield__select_workspace it.
b) mcp__Higgsfield__media_import_url url="https://clucknorris.app/cluck-norris-logo.jpg" type="image" → note the media_id.
c) mcp__Higgsfield__generate_image params: model "nano_banana_pro", aspect_ratio "16:9", resolution "2k", count 1, medias [{"value":"<media_id>","role":"image"}], prompt: "A muscular anthropomorphic rooster — Cluck Norris, matching the reference image exactly (dark sunglasses, ammo bandolier, confident tough-guy grin) — triumphantly hauling a bulging burlap money bag boldly stamped '+<deltaShort> CLKN' toward a massive gleaming bank vault. The huge round vault door is engraved with crisp, readable text 'TOTAL LOCKED: <totalShort> CLKN (<pct>)'. Golden celebratory light, cinematic, playful brand-mascot style. All text crisp, sharp and perfectly readable." — and INVENT a unique setting/angle/vault design for this run (e.g. mountain fortress vault, underground gold vault, bank-heist-in-reverse at night, steampunk vault door) so every celebration image is different.
d) Poll mcp__Higgsfield__job_display with the job id until status is "completed" (wait between checks ~30s at a time, up to ~8 minutes). Get results.rawUrl.
e) Post to X (Bash; URL-encode all params): GET "https://clucknorris.app/api/x-announce" with header x-premium-key: $PREMIUM_ACCESS_KEY and query params post=1, image=<rawUrl>, replyTo=<pending.xPostId ONLY if not null>, text= "🔒 LOCK CELEBRATION 🐔\n\n+<deltaShort> CLKN just locked away. The vault now holds <totalShort> CLKN — <pct> of supply, out of circulation, verifiable by anyone on-chain.\n\nVerify 👉 https://lock.jup.ag/token/DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS\n\n@JupiterExchange @BagsApp". Note the returned tweet id.
f) Telegram photo (SILENT — never pass loud=1): GET "https://clucknorris.app/api/tg-test" with the same key header and params photo=<rawUrl>, text="🔒 <b>Lock celebration!</b> +<deltaShort> CLKN locked — the vault now holds <totalShort> CLKN (<pct>).\nOn X: https://x.com/FireChicken007/status/<tweet id>"
g) Clear the flag: curl -sS "https://clucknorris.app/api/lock-celebration?clear=1" -H "x-premium-key: $PREMIUM_ACCESS_KEY"

HARD RULES: Never post anything if pending was null. Only the two posts described. Silent Telegram always. If any step fails mid-way, leave the flag set so the next hourly run retries. Do not touch anything else (no trades, no other posts, no code changes).
