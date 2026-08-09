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

### 1. Enable DNSSEC  ← biggest single DNS win
Signs your DNS so nobody can spoof it. Currently OFF (no DS record; DNS not validated).

1. Cloudflare → select **clucknorris.app** → **DNS → Settings** → find **DNSSEC** → **Enable DNSSEC**.
2. Cloudflare shows a **DS record** (Key Tag, Algorithm, Digest Type, Digest — often a ready-made line).
3. Add that DS record at your **registrar** (where the domain was *bought* — not the Cloudflare DNS
   tab). Registrar → clucknorris.app → DNSSEC → add DS with the exact values from step 2.
   - If the domain is on **Cloudflare Registrar**, this is **one click** — Cloudflare sets the DS for
     you, nothing to paste. (You're on Cloudflare nameservers; if you also registered there, done.)
4. ⚠️ **Order matters:** enable at Cloudflare FIRST, then add the DS at the registrar. A DS that
   doesn't match Cloudflare's keys makes the **whole domain fail to resolve** until removed.
5. Verify (minutes–2h): `dig +short DS clucknorris.app` returns records, or check dnsviz.net /
   Verisign DNSSEC Analyzer — all green.

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
