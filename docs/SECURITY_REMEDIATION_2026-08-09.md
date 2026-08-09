# Security remediation — clucknorris.app (RootCrak 90/100, 2026-08-09)

Snapshot: **90/100**, 30 issues, **0 critical/high**. Category drags: **DNS Security 90**,
**Web Security 78**. Everything below is either already fixed in the repo, a Cloudflare/registrar
change only the owner can make, or a deliberate trade-off. Nothing here is urgent (0 critical/high).

---

## ✅ Already fixed in the repo (deployed)

- **Sub-Resource Integrity (DAST-90003, 2.0)** — `integrity` + `crossorigin="anonymous"` added to
  the two external CDN scripts (Phaser on the game, `@solana/web3.js` on locker-room / swap /
  buyspecial). sha384 computed from the exact served bytes; version-pinned URLs, so the hashes are
  stable. **Verify once on a real device:** the game loads + a wallet connects on locker-room/swap.
  This should recover part of the Web Security score on the next scan.

---

## 🌐 DNS Security 90 → ~100 (Cloudflare + registrar — owner only)

### 1. DNSSEC — ⚠️ blocked by the registrar (domain is registered at **Railway**)
Signs your DNS so nobody can spoof it. Currently OFF. **The catch:** DNS is at Cloudflare but the
domain is *registered at Railway*, and the DS record has to be published at the **registrar** (Railway)
— which does **not** document DNSSEC/DS support, and there are community reports of DNSSEC interfering
with Railway's domain verification. So this is **not a quick Cloudflare toggle** here.

Options, in order of sanity:
- **A — Skip it (recommended for now).** DNSSEC is one slice of a non-critical DNS-90 score (0
  critical/high overall). Do SPF + CAA below instead; they don't touch Railway.
- **B — Ask Railway support** whether they can add a DS record for clucknorris.app. If yes: enable
  DNSSEC in Cloudflare (DNS → Settings → Enable DNSSEC) to get the DS, then have Railway publish it.
- **C — Transfer the registration to Cloudflare Registrar** (cleanest if you want DNSSEC). DNS is
  already on Cloudflare, so a transfer makes DNSSEC **one-click and automatic**, and Cloudflare
  Registrar is at-cost. Needs the domain >60 days old + an auth/EPP code from Railway; ~5–7 days.
- ⚠️ Whatever you do, don't hand-craft a DS that doesn't match Cloudflare's keys — a mismatched DS
  takes the **whole domain offline** until removed.

### 2. SPF `~all` → `-all`
Current: `v=spf1 include:_spf.mx.cloudflare.net ~all` (soft-fail lets spoofers slip past DMARC).

1. Cloudflare → **DNS → Records** → find the root **TXT** record above.
2. Edit → change the trailing `~all` to `-all` → Save.
   New value: `v=spf1 include:_spf.mx.cloudflare.net -all`
3. ⚠️ `-all` tells receivers to **reject** any mail claiming to be from @clucknorris.app that
   doesn't come through Cloudflare's mail servers. You only **receive** (Cloudflare Email Routing
   forwards to Gmail) and you **send from clucknorrisapp@gmail.com** (a gmail.com address — SPF
   unaffected). So `-all` is **safe for you today.**
   - The ONE future gotcha: if you ever set up Gmail **"Send mail as chuck@clucknorris.app"**, first
     add Google's include, or those sends bounce:
     `v=spf1 include:_spf.mx.cloudflare.net include:_spf.google.com -all`

### 3. CAA records  (optional, small)
Restricts which Certificate Authorities may issue TLS certs for the domain. Currently none.

1. Easiest + safest: Cloudflare → **SSL/TLS → Edge Certificates → "Add CAA records"** helper — it
   pre-fills the CAs Cloudflare actually uses. Use that rather than hand-typing.
2. If adding manually: DNS → Add record → **CAA**, Name `@`, Tag `issue`, CA `pki.goog`; add a second
   for `letsencrypt.org`.
3. ⚠️ A CAA that omits Cloudflare's CA breaks **cert renewals** (site loses HTTPS). If unsure, skip —
   it's a minor score item.

---

## 🔒 Web Security 78 → higher

### 4. SRI — done (see top). Re-scan to clear it.

### 5. CSP `style-src 'unsafe-inline'` (DAST-10055, 2.0) — **recommend: leave it**
- Where: `server.js`, the `CSP` constant (~line 2218): `style-src 'self' 'unsafe-inline' …`.
- Why it's there: every tool page, the game, and the operator dashboard use inline `<style>` blocks
  and `style="…"` attributes. `'unsafe-inline'` is what lets them apply.
- To actually earn the points you'd move to a **nonce/hash CSP**: a per-request nonce on every
  `<style>` tag, and remove `'unsafe-inline'`. But inline `style="…"` **attributes can't take a
  nonce** — they'd all have to become classes. Across dozens of pages + the 10 MB game, that's a
  large, risky refactor for a 2.0. Same story for `script-src 'unsafe-inline' 'unsafe-eval'` (the
  game needs inline scripts; Phaser can need eval).
- **Verdict:** accepted, industry-common trade-off. If you insist on chasing it, it's an
  incremental page-by-page job, game last.

### 6. Source Code Disclosure – SQL (DAST-10099, 5.0) — **investigated: no real vector found**
- `public/` is not statically mounted; the catch-all 404s unknown/source extensions; **all SQL
  lives in server-side modules never sent to a client**; API errors return generic messages.
- ZAP rule 10099 is notoriously false-positive on JS-heavy pages, and the 10 MB inlined game JS is a
  textbook trigger. **Almost certainly a false positive.**
- To close it for certain: open the finding at root-core.web.app/dashboard, grab the **affected
  URL / evidence**, and hand it over — then it's confirmed FP or a real fix.

---

## After the changes
Re-run the RootCrak scan. Expected: **DNS 90 → ~100** (DNSSEC + SPF), **Web Security 78 → ~90+**
(SRI already in; CSP + the source-disclosure FP likely remain, as accepted / not-real).

> House rule (CLAUDE.md): if any of this gets written up publicly, credit **RootCrak (@ro0TCr4k)**
> and include **https://rootcrak.com/?ref=clucknorris**.
