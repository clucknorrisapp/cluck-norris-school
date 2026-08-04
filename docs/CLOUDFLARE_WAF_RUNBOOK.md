# Cloudflare / WAF runbook — clearing RootCrak `WAF-NONE` (CVSS 7.0)

**Why this exists:** the site is served straight from Railway (`server: railway-hikari`, no
`cf-ray` header), so there is no WAF/CDN in front of the origin. RootCrak flags this as
`WAF-NONE` / "Direct origin server access may be possible." The fix is to put **Cloudflare's proxy
(the orange cloud)** in front of `clucknorris.app`. That is a DNS + Cloudflare-account operation —
**it cannot be done from this repo or the container.** This doc is the exact procedure.

> ⛔ **THE ONE THING THAT WILL BREAK THE BOT.** Cloudflare's **Bot Fight Mode** and Managed
> Challenges will block Telegram's servers and our own callers, because they look "bot-like." The
> **Telegram webhook** (`/api/tg/<secret>`, `server.js:5687`) and the **Solana RPC proxy /
> payment-verify** endpoints live under `/api/`. If `/api/` is not exempted, the bot goes silent,
> wallet balance reads fail, and payment verification breaks — with no error, just silence. The
> `/api/` skip rule below is the load-bearing step, not an optional extra.

---

## What's already protecting the origin (so it isn't naked during setup)

- **Rate limiting** — `/api/` capped at 150/min, `/api/ask-cluck` at 15/min, keyed on the real
  client IP (last hop, not a spoofable XFF entry). Returns `429` past the cap. (`server.js:2285+`)
- **Security headers** — HSTS, CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy,
  Permissions-Policy on every response; `X-Powered-By` suppressed.
- **Webhook auth** — the Telegram webhook is validated by a `secret_token` (sha256 of the bot
  token), so a random POST to it is rejected even without a WAF.

These reduce the blast radius but do **not** clear `WAF-NONE` — only a proxy in front does.

---

## Procedure (Cloudflare free tier is enough — ~15 min + DNS propagation)

1. **Add the site to Cloudflare.** Dashboard → Add a site → `clucknorris.app` → Free plan. Let it
   import existing DNS. **Verify** the record for `clucknorris.app` (and `www`) points at Railway's
   target (a `CNAME` to `…up.railway.app`, or the A record Railway gave). Do not change the target.

2. **Point the nameservers.** At the domain registrar, replace the nameservers with the two
   Cloudflare gave you. Activation is usually minutes to a few hours.

3. **Proxy the records (orange cloud ON).** In Cloudflare DNS, set `clucknorris.app` and `www` to
   **Proxied**. (Grey cloud = DNS-only = no WAF; that is the current state.)

4. **TLS mode: Full (strict).** SSL/TLS → Overview → **Full (strict)**. Railway serves a valid cert
   for the custom domain, so strict validates cleanly. **Never use Flexible** — it causes redirect
   loops against an HTTPS origin. If you hit a cert error at cutover, the robust fix is a Cloudflare
   **Origin Certificate** installed on Railway; failing that, temporarily use **Full** (not strict).

5. ⛔ **Exempt `/api/` from bots + challenges + WAF managed rules (the load-bearing step).**
   Either leave **Bot Fight Mode OFF**, or if you enable it, add a **WAF → Custom rule** first:
   - **Field:** `URI Path` **contains** `/api/`
   - **Action:** **Skip** → check *Bot Fight Mode / Super Bot Fight Mode*, *Managed Rules*,
     *Rate limiting*, and *Managed Challenge*.
   - Put this rule **at the top** so it evaluates first.
   The Telegram webhook path `/api/tg/<secret>` MUST reach the origin. `/healthz` (Railway's
   readiness probe) must stay reachable too — Cloudflare won't challenge it, but don't add a rule
   that would.

6. **Don't cache HTML or `/api/`.** Leave caching on "respect origin headers" (default). Do **not**
   turn on "Cache Everything" for `/api/*` — it would serve stale JSON and cache the RPC proxy.
   The Normie Quest game page and static assets can cache normally (they already send cache
   headers; the PWA service worker is network-first so a deploy still wins).

7. **Optional hardening once green:** turn on a WAF managed ruleset (OWASP core) scoped to
   everything **except** `/api/` via the skip rule above; enable rate-limiting rules on any
   login/payment path you want throttled at the edge (the origin already throttles).

---

## Verify (do all of these before calling it done)

```
curl -sI https://clucknorris.app/ | grep -iE 'server:|cf-ray'
#   → expect  server: cloudflare  AND a  cf-ray:  header  (currently: server: railway-hikari, no cf-ray)
```

- **Telegram bot:** send a test post (`/api/tg-test?key=$PREMIUM_ACCESS_KEY&text=cf%20cutover%20ok`)
  and confirm the webhook still receives updates (`/api/tg-webhook-info?key=…` shows a recent
  delivery, 0 queued). This is the check that catches the Bot-Fight-Mode trap.
- **Wallet reads:** open `/wallet-checkup` or `/locker-room`, connect, confirm a balance loads
  (exercises the `/api/helius-rpc` proxy).
- **Game:** `/normie-quest-x7` loads and plays.
- **Re-scan RootCrak** → `WAF-NONE` clears, grade rises.

## Rollback

Set the DNS records back to **DNS-only** (grey cloud), or revert nameservers at the registrar. The
origin keeps working exactly as it does today (that's the current state).

---

# Copy-paste config

> **Minimal to clear `WAF-NONE`:** just proxying the domain (orange cloud, step 3) makes a `cf-ray`
> header appear and Cloudflare's default protections engage — RootCrak detects that and the flag
> clears. Everything below is doing it *correctly* (protecting the site without breaking the bot).

## 1. WAF → Custom rules → **the API + webhook bypass** (create this FIRST, put it at order #1)

Cloudflare's free **Bot Fight Mode** is a global on/off with **no per-path exemptions** — it cannot
be scoped and it WILL challenge Telegram's webhook and our RPC/payment callers. So: **leave Bot
Fight Mode OFF** (Security → Bots → off) and use this Skip rule as the guard for `/api/`.

- **Rule name:** `API + webhook bypass`
- **Action:** **Skip**
- **Skip components** (check every box that your plan shows): *All remaining custom rules*,
  *All managed rules*, *Rate limiting rules*, *Super Bot Fight Mode*, *Browser Integrity Check*.
- **Expression** — click **Edit expression** and paste exactly:

```
starts_with(http.request.uri.path, "/api/") or http.request.uri.path eq "/healthz"
```

That path set is everything that must reach the origin unfiltered: the Telegram webhook
(`/api/tg/<secret>`), the Helius RPC proxy (`/api/helius-rpc`), SOL payment verify
(`/api/verify-sol-payment`), the airdropper/hatchery/locker calls, and Railway's `/healthz` probe.

## 2. WAF → Managed rules → **turn the WAF on** (this is what RootCrak detects)

Deploy the **Cloudflare Managed Ruleset** (free tier gets the "Cloudflare Free Managed Ruleset";
Pro+ gets the full OWASP Core Ruleset). Default action **Managed Challenge / Block** is fine — the
Skip rule above already carves out `/api/`, so managed rules apply to the site's HTML/asset surface
only. No expression needed; it deploys zone-wide.

## 3. (Optional, Pro+) Super Bot Fight Mode instead of the free toggle

If you upgrade to Pro, use **Super Bot Fight Mode** (it *is* path-scopable) and rely on the Skip
rule in §1 to exempt `/api/`. On free tier, skip this — the WAF managed ruleset already clears
`WAF-NONE`; you do not need any bot mode for that.

## 4. (Optional) One edge rate-limit rule (free tier = 1 rule)

The origin already rate-limits, so this is belt-and-suspenders. If you add one, scope it to a
specific hot path and **never** the webhook:

- **Expression:**

```
http.request.uri.path eq "/api/ask-cluck"
```

- **Rate:** 20 requests per 1 minute, per IP → **Managed Challenge** (or Block). (The origin caps
  this same path at 15/min, so the edge rule just sheds load before it arrives.)

## 5. TLS that won't fight Railway

Railway already serves a valid Let's Encrypt cert for the custom domain, so **SSL/TLS → Full
(strict)** works out of the box. The most robust option (survives Railway cert renewals behind the
proxy) is a **Cloudflare Origin Certificate**:

1. SSL/TLS → Origin Server → **Create Certificate** (15-year, covers `clucknorris.app` + `*.clucknorris.app`).
2. Install it on the Railway service's custom domain (Railway → service → Settings → Networking →
   custom domain → provide cert/key) if Railway exposes cert upload for your plan; otherwise leave
   Railway's own cert in place and keep Cloudflare on **Full (strict)** — that already validates it.
3. Turn on **Always Use HTTPS** and **Automatic HTTPS Rewrites** (SSL/TLS → Edge Certificates). Our
   app already sends HSTS, so this just backstops it at the edge.

## 6. Caching (don't let it cache JSON)

Default "respect origin headers" is correct — leave it. Do **not** create a Cache Rule with "Cache
Everything" over `/api/*` (it would cache the RPC proxy and payment responses). If you add a cache
rule for the game/static assets, bypass `/api/`:

```
not starts_with(http.request.uri.path, "/api/")
```

---

# Post-cutover checklist (run every item — the bot failure is silent)

```
# 1) Proxy is live (this is what clears WAF-NONE):
curl -sI https://clucknorris.app/ | grep -iE 'server:|cf-ray'
#    expect:  server: cloudflare   +   cf-ray: <hash>-<POP>

# 2) Telegram webhook still delivering (the Bot-Fight-Mode trap check):
curl -s "https://clucknorris.app/api/tg-webhook-info?key=$PREMIUM_ACCESS_KEY"
#    expect: webhook url registered, pending/queued 0, a recent last-delivery time, no last_error

# 3) Bot can still post out:
curl -s "https://clucknorris.app/api/tg-test?key=$PREMIUM_ACCESS_KEY&text=cf%20cutover%20ok"

# 4) RPC proxy works (wallet balance path): open /wallet-checkup or /locker-room, connect, read a balance.
# 5) Game loads: open /normie-quest-x7.
# 6) Re-scan RootCrak → WAF-NONE clears.
```

If step 2 shows a `last_error` about the webhook being unreachable or challenged, the §1 Skip rule
is missing or Bot Fight Mode is on — fix that first, then re-register the webhook via
`/api/tg-webhook-info?key=…&reset=1` (add `&drop=1` to also clear any queued backlog).

---

# Origin lockdown — make the WAF non-bypassable (closes "direct origin access")

Cloudflare in front does nothing if an attacker just hits the Railway origin IP (`69.46.46.60`)
directly — that skips the WAF. RootCrak's finding says exactly this: *"Direct origin server access
may be possible."* The app has a guard for it (`server.js`, `CF_ORIGIN_SECRET`): when that env var
is set, every request must carry a secret header that **Cloudflare injects**, and anything without
it gets `403`. So only traffic that came through Cloudflare is accepted.

⚠️ **Order matters — do the Cloudflare rule FIRST, then set the env var.** If you set the env var
before the Transform Rule exists, Cloudflare's proxied requests won't carry the header and the whole
site 403s. `/healthz` is exempt in code (Railway's probe hits the origin directly).

1. **Pick a long random secret** (e.g. `openssl rand -hex 32`). Call it `<SECRET>`.

2. **Cloudflare → Rules → Transform Rules → Modify Request Header → Create rule.**
   - Name: `inject origin secret`
   - **If… Custom filter expression:** `true` (match all requests — the Skip rule doesn't apply
     here; every proxied request should carry it, including `/api/`).
   - **Then… Set static:** Header name `X-Cluck-Edge-Auth`, Value `<SECRET>`.
     (NOT `x-cf-*` — Cloudflare reserves that prefix and rejects custom headers using it.)
   - Deploy. (This header is added between Cloudflare and your origin; it is never visible to
     browsers.)

3. **Verify the rule is live** (still works because the env var isn't set yet, so nothing is
   enforced): `curl -sI https://clucknorris.app/` should still be `200`.

4. **Set the env var on Railway:** `CF_ORIGIN_SECRET=<SECRET>` (same value). Railway redeploys.
   On boot you'll see `[security] origin lockdown ON` in the logs.

5. **Confirm it's working:**
   ```
   curl -sI https://clucknorris.app/                       # through Cloudflare → 200 (header present)
   curl -sI --resolve clucknorris.app:443:69.46.46.60 https://clucknorris.app/   # direct to origin → 403
   ```
   The second command hitting `403` is the whole point: the WAF can no longer be bypassed.

6. **Re-check the bot + wallet reads** (all go through Cloudflare, so they carry the header):
   `/api/tg-webhook-info?key=…` shows recent delivery; a wallet balance still loads.

**Rollback:** unset `CF_ORIGIN_SECRET` on Railway (redeploys to the safe no-op). The Transform Rule
can stay — an unused header is harmless.

---

# Bonus quick win now that Cloudflare owns your DNS — SPF/DMARC (clears the email-spoofing findings)

RootCrak also flags `DNS-SPF-MISSING` / `DNS-DMARC-MISSING` (Info/noise). The domain doesn't send
email, so the correct, spoof-proof answer is "no mail, reject everything." Add these **TXT records**
in **Cloudflare → DNS → Records** (30-second job while you're in there):

| Type | Name | Content |
|---|---|---|
| TXT | `clucknorris.app` (or `@`) | `v=spf1 -all` |
| TXT | `_dmarc` | `v=DMARC1; p=reject; sp=reject; adkim=s; aspf=s;` |
| TXT | `*._domainkey` | `v=DKIM1; p=` |

`v=spf1 -all` = "nothing is authorised to send mail as this domain." `p=reject` DMARC = "reject any
mail claiming to be from us." The wildcard DKIM with an empty key revokes all DKIM. Together they
tell the world nobody can spoof `@clucknorris.app`, and they clear the three DNS findings. **Skip
these if you ever plan to send email from the domain** (newsletters, transactional) — then you'd
publish real SPF/DKIM for your mail provider instead.
