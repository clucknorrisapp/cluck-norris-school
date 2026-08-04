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
