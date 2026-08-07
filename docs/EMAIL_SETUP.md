# Email setup — branded `@clucknorris.app` addresses (Cloudflare Email Routing)

**Why this exists:** we want branded inboxes like `team@clucknorris.app` and `help@clucknorris.app`
— first ask was for the **X Verified Organizations (Gold check)** business-email requirement, but
the same setup covers site/support/security contacts. This is a **DNS + Cloudflare-account
operation — it cannot be done from this repo or the container.** This doc is the exact procedure.

> ⛔ **Railway is not part of this.** Railway runs the app; it is not an email host and blocks
> outbound port 25. Email lives at the **DNS layer**, which for us is **Cloudflare**. Don't deploy a
> self-hosted mail server (Mailu/Postal/Maddy) on Railway — deliverability rabbit hole, wrong tool.

## The model: one real inbox, many branded front doors

Every branded address **forwards into one real Gmail: `clucknorrisapp@gmail.com`.** Cloudflare Email
Routing is **free** and handles *receiving* only. Sending *as* a branded address is a separate,
optional step (see the bottom).

MX records are **email-only** — they do **not** touch the website, the Cloudflare WAF, or the
`X-Cluck-Edge-Auth` origin lockdown. No conflict with any HTTP setup.

## Setup — Cloudflare Email Routing (free, ~5 min)

1. **Log in:** dash.cloudflare.com → open the **clucknorris.app** zone.
2. **Open Email Routing:** left sidebar → **Email → Email Routing**.
3. **Enable:** click **Get started / Enable Email Routing**. It offers to add **3 MX records + 1 SPF
   (TXT)** automatically — because our nameservers are on Cloudflare this is one click
   (**"Add records and enable"**). Do **not** hand-type these.
4. **Create an address:** Routing rules → **Custom addresses → Create address**
   - Custom address: e.g. `team`  (the `@clucknorris.app` is filled in)
   - Action: **Send to an email**
   - Destination: **clucknorrisapp@gmail.com**
   - Save. Repeat for each address in the plan below.
5. **⚠ Verify the destination (the step people miss):** Cloudflare emails `clucknorrisapp@gmail.com`
   a confirmation link. **Open Gmail and click it.** Until you do, forwarding won't work and the
   address shows "unverified." This is the #1 reason it "doesn't work."
6. **(Optional) Catch-all:** Routing rules → toggle **Catch-all** → send `*@clucknorris.app` to
   `clucknorrisapp@gmail.com`. Safety net so no message to any address is ever lost.
7. **Test:** email `team@clucknorris.app` from another account → it should land in the Gmail within a
   minute.

## Address plan (all free, all → clucknorrisapp@gmail.com)

| Address | Purpose | Notes |
|---|---|---|
| **team@** | Org identity | ← use for the **X Gold application** — reads most "company" |
| **help@** | Support / player questions | Put on the site + in-game |
| **security@** | Vuln reports | On-brand with RootCrak; a real security contact signals a serious project |
| **contact@** / **hello@** | General inbound | Friendly front door |
| **partnerships@** | BD / featuring asks | e.g. Nomadz-type conversations |
| **\*@ (catch-all)** | Safety net | Anything else → the same Gmail |

High-value three to make first: **team@**, **help@**, and the **catch-all**. Add others in 30s each.

## X Verified Organizations (Gold check) — what the email is actually for

X requires a business email on the domain so they can **send a confirmation link to it** — the only
thing that must work is **receiving**. Forwarding to Gmail is 100% sufficient; no paid mailbox
needed for the application itself. Use **team@clucknorris.app** on the form.

Reality check: Gold for orgs is a **paid monthly subscription** (verify current price on X — it
changes) and reviewers also weigh whether the org looks legitimate. The domain email clears the
"do you control this domain" bar; it isn't the whole application.

## Later: *sending* as a branded address (optional)

Email Routing is **inbound only** — replies from Gmail go out as `clucknorrisapp@gmail.com`. To send
*as* `help@` / `team@`, add one of:

- **Gmail "Send mail as" + SMTP relay** (cheap): free-tier Resend/Mailgun/Brevo for SMTP creds →
  Gmail → Settings → Accounts → **Send mail as** → add the branded address. Add the relay's
  **SPF/DKIM** records in Cloudflare so mail isn't flagged. Stays inside the Gmail you already use.
- **Real mailbox provider** (replaces Cloudflare MX with theirs — don't run both):
  - **Zoho Mail** — free for 1 domain, up to 5 users. Best free real-mailbox option.
  - **Google Workspace** — ~$7/user/mo. Cleanest "Send as", familiar Gmail UI.
  - **Fastmail** — ~$5/user/mo. Privacy-friendly.

**Recommendation:** start with Cloudflare forwarding (this doc) for the Gold check now; add
"Send mail as" only when you actually need to *reply* from the branded address.
