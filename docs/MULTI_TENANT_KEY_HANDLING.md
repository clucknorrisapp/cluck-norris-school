# Multi-tenant key handling — design + scenarios

How outside projects safely run on the Cluck Norris Liquidity Engine. The whole game is:
**to run autonomously (auto re-center, rebalance, buyback) something must hold a hot key that
can sign LP txs continuously.** Every model below is an answer to *who holds that key and what
it can do.*

## Where we are today
- Per-project `operatorEnv` → loads a keypair from `process.env[operatorEnv]` (base58/JSON),
  cached in `_operators`. Signs LP opens/closes + swaps. Dedicated hot wallet = **float only**
  (never treasury / mint authority). Unset/invalid env = that project is a safe no-op.
- Keys live ONLY in Railway env vars. Good isolation from the repo; bad for scaling tenants
  (redeploy to add, all keys visible to anyone with Railway access, no per-tenant rotation/audit).

## The custody spectrum (matches the /liquidity-engine page: Self-Serve → Managed → Trustless)

### Model A — Self-Serve (non-custodial; client signs everything)
- Client uses `/liquidity` from their own wallet, signs every tx. We hold nothing.
- ✅ Zero custody risk for us. ❌ Not autonomous — client must sign each re-center; the
  "engine" doesn't actually *run* for them. Fine as an entry/free tier, not the product.

### Model B — Managed (we hold a scoped hot key) — the sell-now path
The pragmatic model for first paying customers. Sub-decisions:

**B1. Who generates the keypair?**
- **Client generates, keeps a copy, shares a copy with us (RECOMMENDED).** Client retains the
  ability to **sweep the float to safety anytime** (real exit), we operate. Residual trust gap:
  we *could* drain the float — bounded because it's float-only.
- We generate, client only gets the pubkey to fund: secret never leaves our system, but the
  client has no independent withdraw key (worse for trust). Avoid unless paired with a
  portal "withdraw to pre-registered cold wallet" action.

**B2. Where the key is stored (maturity ladder):**
1. **Railway env var per project** (today). Simple; doesn't scale (redeploy per tenant, broad visibility).
2. **Encrypted-at-rest in `/data` (envelope encryption).** Per-tenant secret encrypted with a
   master key (the master key stays in env/KMS). Add tenants with NO redeploy; key material
   encrypted on disk. Decrypt into memory only at operator-load time. ← next step for scale.
3. **Dedicated secrets manager (AWS KMS / GCP Secret Manager / HashiCorp Vault).** Per-tenant
   keys, access audit logs, rotation, least-privilege. ← production-grade custody.

**B3. Blast-radius containment (NON-NEGOTIABLE, all variants):**
- Wallet holds **ONLY the MM float** — never treasury, never mint authority.
- Publish the operator pubkey so the client audits it on-chain anytime.
- One-flag **kill switch** + client can sweep (if they kept their key, B1).
- Start with a **small float**; scale as trust builds. Per-tenant **spend/again caps**.
- Secret transmission (if client shares it): one-time encrypted link or paste directly into
  our setup page over TLS straight into KMS — **never logged, never in Telegram/email/plaintext.**

### Model C — Self-hosted agent (client runs it; we touch nothing)
- We package the engine + a config; client deploys it with their own key on their own infra.
- ✅ Zero custody for us. ❌ Needs client ops capability; harder to support. For technical teams.

### Model D — Trustless delegate (the endgame / the differentiator)
- An on-chain program that can **only** perform whitelisted LP operations on the client's
  positions and **cannot transfer funds to any outside address.** Client keeps full custody;
  we operate the strategy; we *can never* withdraw. Removes the trust gap entirely.
- Paths: (D1) custom Anchor vault program with LP-only delegated instructions — **needs audit**;
  (D2) native token delegate/approve — too limited for LP position mgmt; (D3) Squads multisig +
  auto-approve policy for LP ops — complex; (D4) scoped/session keys. D1 is the real answer.
- Most engineering + an audit, but it's the trust story that wins serious projects.

## Key lifecycle (operational playbook)
- **Generate:** prefer client-generated (B1) on an air-gapped/clean device → a brand-new wallet
  used for nothing else.
- **Fund:** client sends ONLY the float (SOL gas reserve + quote + their token). Document a
  minimum + recommended float per tier.
- **Onboard:** register project (mint, pools, fee tier, targets/mode, telegram room, portal
  owner wallet), set the operator secret (env → encrypted store), verify pubkey, start the vault.
- **Operate:** client watches via the portal (control-wallet login) + on-chain; kill switch live.
- **Rotate:** generate new wallet → client funds it → switch `operatorEnv`/stored secret →
  drain + retire old. Build a one-button rotation when we hit the encrypted-store stage.
- **Revoke / incident:** kill switch immediately; client sweeps float (B1); rotate; post-mortem.

## Recommendation (phased)
1. **Now → first customers:** Model B1 + storage step B2.2 (encrypted-at-rest, no-redeploy
   onboarding) + strict B3 containment + a clean onboarding flow. This is sellable and honest.
2. **As volume grows:** move storage to B2.3 (KMS/Vault) for audit + rotation + least privilege.
3. **The moat:** build Model D1 (trustless LP-only delegate) + audit — the "we literally cannot
   touch your funds" story, which is the natural endgame the engine page already promises.

## Flags / open questions
- **Regulatory:** holding client funds (even float-only) can implicate money-transmission /
  custody rules depending on jurisdiction & structure. Get real legal review before scaling the
  Managed tier commercially. (Not legal advice.)
- **Pricing ties in:** custody tier ↔ price tier (Self-Serve cheap/free, Managed setup+monthly
  +/- perf fee, Trustless premium). Decide alongside this.
- **Decide:** comfortable holding client float keys for the Managed tier (B1), or lead with
  Self-hosted (C) until Trustless (D1) ships?
