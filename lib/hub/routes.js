"use strict";
// lib/hub/routes.js — the per-project Lock to Earn routes (Phase 1a-ii of
// docs/LOCK_TO_EARN_PLATFORM_2026-09-16.md) on top of lib/hub/engine.js, plus the scheduler.
//
//   GET/POST /api/hub-registry             owner: list / approve / suspend projects (mint read on-chain)
//   GET/POST /api/hub/:project/admin       owner: status, terms → a new version, arm (two flags), disarm, accrue
//   GET      /api/hub/:project/holder      public: one wallet — locked / how long / earned / paid / owed
//   GET/POST /api/hub/:project/payout      owner: owed, export a batch (self-sign), send from a managed
//                                          payer, record signed rows, sweep, void, confirm, cancel
//
// Same discipline as the CUNA and buy-comp routes: anything that changes state is POST-only and
// refused BEFORE the project lookup (a pasted link never touches anything); arming needs two
// flags; money parts are written through the disk-verified store write; recipients of a send come
// only from the batch on file; every transfer is journaled pending before it is broadcast.
//
// Nothing here requires @solana/web3.js at load — the CI node-check job has no dependencies —
// so the chain reads come through `deps` and the web3 constructor is required lazily.

const hubStore = require("./store");
const proj = require("./project");
const access = require("./access");
const accessPay = require("./access-pay");
const apply = require("./apply");
const operator = require("./operator");
const traction = require("../traction"); // "wallets connected" — see its file header
const elig = require("./eligibility");
const eng = require("./engine");
const ledger = require("./ledger");
const rdy = require("./readiness");
const preview = require("./preview");   // EE1: "who would this pay today?" for draft terms — a read, nothing persisted
const prog = require("../cuna-programme");
const pay = require("../cuna-payout");
const bp = require("../buycomp-payout");
const pub = require("./public");
const commit = require("./commit");     // B5: independent on-chain commitment of a version's hash (E3)
const teach = require("./teach");
const payoutVerify = require("../payout-verify");
const attempts = require("./attempts");
const settle = require("./settle");
const { randomBytes } = require("crypto");

const solAddr = require("../solana-addr");
const B58 = solAddr.SOL_ADDR_RE;
const SIG_RE = /^[1-9A-HJ-NP-Za-km-z]{60,100}$/;
// X6/CC5 (design §4, roadmap): the browser-signed batch payout's live browserSign.state values —
// a batch carrying one of these refuses the managed payer (&send=), and vice versa a batch already
// mid managed-send (held under the SAME per-project payout lock) refuses a concurrent sign-request.
const BROWSER_SIGN_LIVE = new Set(["signing", "submitted"]);
function browserSignIsLive(bt) { return !!(bt && bt.browserSign && BROWSER_SIGN_LIVE.has(bt.browserSign.state)); }
// The exact wording the /payout route's dryRun refusal uses (see mount() below) — X6/CC5 asks for
// this same text ahead of the browser-sign flow too, at 409 (a precondition on the whole flow)
// rather than that route's 403 (a refused field on an otherwise-live route).
function dryRunSignRefusal(p) { return { ok: false, error: `${p.id} is a DRY RUN — nothing accrues, so there is nothing to export, send, confirm, cancel, void or sweep.` }; }
// P2-6/N5 (docs/HUB_BROWSER_SIGN_VERIFY_2026-09-18.md): a browserSign that reached a TERMINAL,
// non-live state (settled by observe(), settled by &sent=/&confirm= completing the batch some
// other way, or cleared by the owner) all answer the SAME `already:true` shape from observe() —
// only the note differs, so an operator polling a stale nonce sees why, not a generic 400.
function browserSignAlreadyNote(bs) {
  if (bs && bs.state === "cleared") return "this batch's browser-signed sign-request was cleared by the owner — request a fresh sign-request and re-broadcast from what it returns";
  return "this batch's browser-signed flow is already settled";
}

// ── pure helpers (tested in scripts/hub-engine-test.cjs) ─────────────────────────────────────
// { decimals, tokenProgram, extensions[] } from a getParsedAccountInfo value — what validateProject
// insists comes from the chain, never from a form.
function mintInfoFromParsed(value) {
  const parsed = value && value.data && value.data.parsed;
  const info = parsed && parsed.type === "mint" && parsed.info;
  if (!info || !Number.isInteger(Number(info.decimals))) throw new Error("mint account did not parse as a mint");
  return {
    decimals: Number(info.decimals),
    tokenProgram: String(value.owner || ""),
    extensions: (Array.isArray(info.extensions) ? info.extensions : []).map((e) => String((e && e.extension) || e || "")).filter(Boolean),
  };
}
const dayKeyOf = (nowUnix) => new Date(Number(nowUnix) * 1000).toISOString().slice(0, 10);
// The first version starts today; a later edit starts tomorrow, so no accrued hour changes version.
function defaultEffectiveFrom(state, nowUnix) {
  const st = eng.readState(state);
  if (!st.versions.length) return dayKeyOf(nowUnix);
  return dayKeyOf(Number(nowUnix) + 86400);
}
// The terms fields a request may carry. Lists come as CSV or arrays; the boolean as 1/true.
const TERM_KEYS = ["poolDailyRaw", "sharePct", "maxSharePct", "minDurationDays", "maxTermDays", "minLockRaw", "maxWalletSharePct", "backdateCapDays", "backdateNotBefore", "payoutSchedule", "vesting"];
function termsPatchFromQuery(q) {
  const out = {};
  for (const k of TERM_KEYS) if (q[k] != null && q[k] !== "") out[k] = q[k];
  if (q.cancelableAllowed != null) out.cancelableAllowed = q.cancelableAllowed === true || String(q.cancelableAllowed) === "1" || String(q.cancelableAllowed) === "true";
  for (const k of ["fundedBy", "excludeWallets"]) if (q[k] != null) out[k] = Array.isArray(q[k]) ? q[k] : String(q[k]).split(",").map((s) => s.trim()).filter(Boolean);
  return out;
}
// N3 (docs/HUB_JOURNAL_VERIFY_2026-09-18.md, Round 3): `payoutSources` is a list of wallets the
// PROJECT ITSELF authorised as a settlement source — not a secret, and hiding it made a
// settlement's real payer invisible everywhere, including to the owner's own registry read. It is
// echoed on every publicProject() call. `payoutSourcesHistory` (every past change, with a
// timestamp) is more than a holder needs and is only added when `full` is set — today, only the
// owner-gated /api/hub-registry responses pass that.
function publicProject(p, { full = false } = {}) {
  return { id: p.id, label: p.label, symbol: p.symbol, mint: p.mint, decimals: p.decimals, rewardMint: p.rewardMint, rewardDecimals: p.rewardDecimals,
    fundingWallet: p.fundingWallet, operatorWallets: p.operatorWallets || [], status: p.status, approvedAt: p.approvedAt || null,
    payoutSources: Array.isArray(p.payoutSources) ? p.payoutSources : [],
    ...(full ? { payoutSourcesHistory: Array.isArray(p.payoutSourcesHistory) ? p.payoutSourcesHistory : [] } : {}),
    // dryRun/brand (Colosseum E10) — in every JSON body that mentions the project, per the
    // no-POKE-only-template rule: this is generic for any project, not a POKE special case.
    dryRun: p.dryRun === true, brand: p.brand || null,
    access: access.accessStatus(p.access, Math.floor(Date.now() / 1000)) };
}
// Accepts an object as-is, or a JSON string (query-string admin calls send brand as text).
function parseJsonMaybe(v) {
  if (v == null || typeof v === "object") return v;
  try { return JSON.parse(String(v)); } catch (_) { return v; } // let validateBrand reject the bad shape with a clear message
}
const APPLICATIONS_KEY = "hub:applications";
function writeRegistryVerified(kv, registry) {
  if (typeof kv.setVerified === "function") return kv.setVerified(hubStore.REGISTRY_KEY, registry) === true;
  hubStore.writeRegistry(kv, registry); return true;
}
// The operator onboarding clock (Colosseum E7): set a milestone on the registry row exactly once,
// re-reading the registry fresh so a concurrent write (a payment, an arm) is never clobbered. A
// no-op once the milestone already has a value — every call site can call this unconditionally.
function markMilestone(kv, projectId, key, value) {
  const reg = hubStore.readRegistry(kv) || {};
  const cur = reg[projectId];
  if (!cur || (cur.milestones && cur.milestones[key] != null)) return;
  const milestones = proj.setMilestoneOnce(cur.milestones, key, value);
  writeRegistryVerified(kv, { ...reg, [projectId]: { ...cur, milestones } });
}
// A batch as the desk renders it: one row per wallet with what is recorded as sent.
function deskBatch(bt, dec) {
  const remaining = pay.remainingOf(bt);
  let remainingRaw = 0n; for (const v of Object.values(remaining)) remainingRaw += v;
  const rows = Object.entries(bt.amounts || {}).map(([wallet, raw]) => {
    const st = (bt.sent || {})[wallet];
    return { wallet, raw: String(raw), sent: !!st, sig: st ? st.sig || null : null, pending: !!(st && st.pending), manual: !!(st && st.manual) };
  }).sort((a, b) => (BigInt(b.raw) > BigInt(a.raw) ? 1 : -1));
  return { ...bt, rows, remainingCount: Object.keys(remaining).length, remainingRaw: remainingRaw.toString(), remainingLines: pay.toAirdropLines(remaining, dec) };
}
const fmtOwed = (owed, dec) => Object.fromEntries(Object.entries(owed).filter(([, v]) => v > 0n).map(([w, v]) => [w, pub.rawToUi(v, dec)]));

// ── mount ─────────────────────────────────────────────────────────────────────────────────────
function mount(app, deps) {
  const { kv, adminAuthOK, publicErrMsg, vault, connection, scanDeps, alert = (m) => console.warn("[hub] " + m), isDirect = (req) => !!req.cluckDirect,
    // payment leg (all optional — without them the access routes answer 503):
    sigStore = null, getTx = null, clknPriceInSol = null, payTo = null, clknMint = null, clknDecimals = 9, rateLimit = null,
    reservedMints = null,   // () => { id: mint } for the built-in programmes (P1-030)
    // project desk (operator sessions): the HMAC secret and the ed25519 verifier live in server.js
    secret = () => process.env.PREMIUM_ACCESS_KEY, verifySignature = null,
    // E4: (name) => the served schema URL for that entity, so a program-version or batch body can
    // carry $schema without this file hardcoding a deployment domain. Omitted in tests that call
    // pure helpers directly — every use below tolerates that and simply omits the field.
    schemaUrl = null,
    // Injectable clock — real Date.now() by default. Every test in scripts/hub-settle-route-test.cjs
    // that fabricates a transaction's `blockTime` needs the route's own "now" to agree with it, so
    // the adv-P0-1 future-blockTime refusal (lib/payout-verify.js) can be exercised deterministically
    // instead of racing the real wall clock.
    nowUnix: nowUnixDep = null } = deps;
  const withSchema = (name, obj) => (typeof schemaUrl === "function" ? { ...obj, $schema: schemaUrl(name) } : obj);
  // Who is asking: "owner" (the admin key), an operator wallet (a desk token for THIS project,
  // re-checked against the record on every request), or null. Never the request's own claim.
  const challenges = new Map();
  const secretNow = () => (typeof secret === "function" ? secret() : secret);
  const authOf = (req, p) => {
    if (adminAuthOK(req)) return "owner";
    const tok = String(req.headers["x-clkn-operator"] || (req.query && req.query.op) || "");
    return tok && p ? operator.operatorOf(secretNow(), tok, p) : null;
  };
  const limited = (bucket, opts) => (typeof rateLimit === "function" ? rateLimit(bucket, opts) : (req, res, next) => next());
  const nowUnix = typeof nowUnixDep === "function" ? nowUnixDep : () => Math.floor(Date.now() / 1000);
  const body = (req) => ({ ...(req.query || {}), ...(req.body || {}) });
  const notFound = (res, what = "not_found") => res.status(404).json({ ok: false, error: what });
  const mutatingOnGet = (res) => res.status(405).json({ ok: false, error: "this changes state — send it as a POST" });
  const projectOf = (req) => { const id = String(req.params.project || "").toLowerCase(); const p = (hubStore.readRegistry(kv) || {})[id]; return p && p.status === "approved" ? p : null; };
  const on = (v) => String(v || "") === "1";
  const writeVerified = (key, value) => (typeof kv.setVerified === "function" ? kv.setVerified(key, value) === true : (kv.set(key, value), true));
  // Item 5 (docs/HUB_JOURNAL_VERIFY_2026-09-18.md, Round 3): the injected `reservedMints` only ever
  // named the built-in MINTS (clkn/cuna/rose) plus the two demo-fixture IDs — proj.RESERVED_PROJECT_IDS
  // is the single, authoritative list of ids that would shadow a page or API route registered ahead
  // of /hub/:project or /api/hub/:project (server.js), so it is merged in here unconditionally,
  // regardless of what the caller injects, mapped to `null` (they have no associated mint).
  const reserved = () => {
    const base = {};
    try { const r = typeof reservedMints === "function" ? reservedMints() : reservedMints; if (r && typeof r === "object") Object.assign(base, r); } catch (_) {}
    for (const id of proj.RESERVED_PROJECT_IDS) if (!(id in base)) base[id] = null;
    return base;
  };
  const reservedBy = (mint) => Object.entries(reserved()).find(([, m]) => m === String(mint || ""));

  // Launch Readiness (design Addendum A): one place that gathers what lib/hub/readiness.js needs
  // — the version in force, the funding partition + observed balance, and a fresh lock scan — so
  // the read-only /readiness route and the arm-time refusal below compute it identically and
  // never drift into two answers for the same project at the same moment.
  async function computeReadiness(p, state, now) {
    const days = hubStore.read(kv, p.id, "days", {}) || {};
    const batches = hubStore.read(kv, p.id, "batches", {}) || {};
    const journal = hubStore.readJournal(kv) || {};
    const part = ledger.partition({ projectId: p.id, days, batches, journal });
    const snap = await eng.scanLocks({ kv, projectId: p.id, project: p, state, nowUnix: now, deps: await scanDeps(), onAlert: alert });
    const locks = snap.locks || [];
    // The funding wallet's observed balance — a read, never a reservation (same as /desk).
    let observed = null;
    try {
      const { PublicKey } = require("@solana/web3.js");
      const r = await connection().getParsedTokenAccountsByOwner(new PublicKey(p.fundingWallet), { mint: new PublicKey(p.rewardMint || p.mint) });
      let bal = 0n; for (const a of (r && r.value) || []) { try { bal += BigInt(a.account.data.parsed.info.tokenAmount.amount); } catch (_) {} }
      observed = bal.toString();
    } catch (_) { observed = null; }
    const funding = ledger.fundingStatus({ part, batches, journal, projectId: p.id, observed: observed == null ? null : { balanceRaw: observed, at: now } });
    const inForce = proj.versionFor(eng.readState(state), prog.sliceKey(now));
    const checklist = rdy.readiness({ project: p, programVersion: inForce, state, fundingStatus: funding, locks });
    const plan = inForce ? rdy.planBudget({ programVersion: inForce, locks, periods: 4 }) : null;
    return { checklist, plan, funding, locks, scan: snap, inForce };
  }

  // ── registry ────────────────────────────────────────────────────────────────────────────────
  // Own root on purpose: the public GET /api/hub/:project is registered before this and would read
  // "registry" as a project id.
  //
  // GG3 fix 1 (docs/POKEAHOE_REHEARSAL_2026-09.md §4): the outward concept is "access tier", but
  // the field this route has always read off the body is `tier=` — a caller (or a hand-typed admin
  // URL, exactly what the rehearsal did) sending `accessTier=` instead changed nothing, silently,
  // and still got back `ok: true` with the access tier quietly unchanged. Fixed two ways: (a)
  // `accessTier` is now accepted as an alias for `tier`, and (b) any OTHER field name this handler
  // does not read is refused outright with 400 and the accepted list, rather than being silently
  // ignored — a body this route does not understand is the caller's mistake, not a no-op to absorb
  // quietly. `key` is listed because `?key=` is `adminAuthOK`'s own deprecated auth fallback (read
  // directly off `req.query`, never off `b`) — a bookmarked admin link with `?key=...` must not
  // itself trip "unrecognized field". scripts/hub-registry-test.cjs pins both halves of this fix.
  const HUB_REGISTRY_FIELDS = new Set([
    "key",
    "applications", "approve", "reject", "reason",
    "suspend",
    "id", "label", "symbol", "mint", "fundingWallet", "operatorWallets",
    "tier", "accessTier", "accessNote",
    "dryRun", "brand", "rewardMint", "payoutSources", "vaultProject",
  ]);
  const HUB_REGISTRY_ACCEPTED = [...HUB_REGISTRY_FIELDS].filter((f) => f !== "key");
  app.all("/api/hub-registry", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (isDirect(req) || !adminAuthOK(req)) return notFound(res);
    const b = body(req);
    const unknownFields = Object.keys(b).filter((k) => !HUB_REGISTRY_FIELDS.has(k));
    if (unknownFields.length) {
      return res.status(400).json({ ok: false, error: `unrecognized field(s): ${unknownFields.join(", ")} — accepted fields are: ${HUB_REGISTRY_ACCEPTED.join(", ")}`, acceptedFields: HUB_REGISTRY_ACCEPTED });
    }
    if (b.accessTier != null && b.tier == null) b.tier = b.accessTier;
    if ((b.id != null || b.suspend != null || b.approve != null || b.reject != null) && req.method !== "POST") return mutatingOnGet(res);
    try {
      let reg = hubStore.readRegistry(kv) || {};
      if (on(b.applications)) return res.status(200).json({ ok: true, applications: apply.listView(kv.get(APPLICATIONS_KEY, {}) || {}) });
      if (b.approve != null || b.reject != null) {
        const book = kv.get(APPLICATIONS_KEY, {}) || {};
        if (b.reject != null) {
          const nb = apply.reject(book, String(b.reject), { reason: b.reason, nowUnix: nowUnix() });
          if (!writeVerified(APPLICATIONS_KEY, nb)) return res.status(500).json({ ok: false, error: "applications write did not persist — check DATA_DIR" });
          return res.status(200).json({ ok: true, application: apply.listView(nb).find((x) => x.id === String(b.reject)) });
        }
        const app0 = book[String(b.approve)];
        if (!app0) return notFound(res, "no such application");
        const conn = connection();
        const { PublicKey } = require("@solana/web3.js");
        const readMint = async (m) => mintInfoFromParsed((await conn.getParsedAccountInfo(new PublicKey(String(m)))).value);
        const freshMintInfo = await readMint(app0.project.mint);
        const freshRewardMintInfo = app0.project.rewardMint !== app0.project.mint ? await readMint(app0.project.rewardMint) : undefined;
        const existing = hubStore.read(kv, app0.projectId, "state", {}) || {};
        if (Array.isArray(existing.versions) && existing.versions.length) return res.status(409).json({ ok: false, error: `project "${app0.projectId}" already has program versions — approve it by hand through /api/hub-registry?id=` });
        const r = apply.approve(book, reg, String(b.approve), { reserved: reserved(), tier: b.tier, note: b.accessNote, nowUnix: nowUnix(), freshMintInfo, freshRewardMintInfo });
        if (!writeRegistryVerified(kv, r.registry)) return res.status(500).json({ ok: false, error: "registry write did not persist — check DATA_DIR" });
        if (!hubStore.writeVerified(kv, r.project.id, "state", r.state)) return res.status(500).json({ ok: false, error: "state write did not persist — the project is registered but has no terms; set them with /admin?terms=1" });
        writeVerified(APPLICATIONS_KEY, r.book);
        console.log(`[hub] application ${app0.id} APPROVED → project ${r.project.id} (${r.project.symbol}), tier ${r.project.access.tier}, terms v1 from ${r.state.versions[0].effectiveFrom}`);
        return res.status(200).json({ ok: true, project: publicProject(r.project, { full: true }), version: { version: 1, effectiveFrom: r.state.versions[0].effectiveFrom, hash: r.state.versions[0].hash }, next: `the project pays a month at /hub/${r.project.id}/pay, then arm with POST /api/hub/${r.project.id}/admin?arm=1&confirm=go-live` });
      }
      if (b.suspend != null) {
        const id = String(b.suspend);
        if (!reg[id]) return notFound(res, "no such project");
        reg = { ...reg, [id]: { ...reg[id], status: "suspended", suspendedAt: nowUnix() } };
        if (!writeRegistryVerified(kv, reg)) return res.status(500).json({ ok: false, error: "registry write did not persist — check DATA_DIR" });
      }
      if (b.id != null) {
        const conn = connection();
        const { PublicKey } = require("@solana/web3.js");
        const readMint = async (m) => { if (!B58.test(String(m || ""))) throw new Error(`not a mint address: ${m}`); return mintInfoFromParsed((await conn.getParsedAccountInfo(new PublicKey(String(m)))).value); };
        const input = {
          id: String(b.id).toLowerCase(), label: b.label, symbol: b.symbol, mint: b.mint, fundingWallet: b.fundingWallet,
          operatorWallets: Array.isArray(b.operatorWallets) ? b.operatorWallets : String(b.operatorWallets || "").split(",").map((s) => s.trim()).filter(Boolean),
          accessTier: b.tier, accessNote: b.accessNote,
          // dryRun (owner-only, this is the direct admin path) and brand — same validation as an
          // application (lib/hub/project.js validateProject -> lib/hub/brand.js).
          dryRun: b.dryRun, brand: parseJsonMaybe(b.brand),
        };
        if (b.rewardMint && String(b.rewardMint) !== String(b.mint)) { input.rewardMint = String(b.rewardMint); input.rewardMintInfo = await readMint(input.rewardMint); }
        let project = proj.validateProject(input, await readMint(input.mint));
        // Round 2 #3 (docs/HUB_JOURNAL_VERIFY_2026-09-18.md): payoutSources lives ONLY on this
        // owner-gated path (the whole /api/hub-registry route requires adminAuthOK — see the top
        // of this handler), never on a desk operator's /admin?terms=. Not naming &payoutSources=
        // on an otherwise-ordinary edit carries the project's EXISTING value forward unchanged
        // (this is a general project-record edit, not a reset); naming it — even as an explicit
        // empty list — applies proj.withPayoutSources, which alerts and grows the append-only
        // history ONLY when the resulting set actually differs from what was there.
        const existingRow = reg[project.id];
        // NEW-3 (Round 5, docs/HUB_JOURNAL_VERIFY_2026-09-18.md): an id re-issued to a DIFFERENT
        // mint is a fresh project wearing an old name — the settlement-source allowlist and the
        // vault-sweep wallet named a DIFFERENT escrow's funders, and neither is the new mint's to
        // inherit. Only a mint change resets them; the ordinary same-mint edit / re-approve /
        // un-suspend path below is unaffected.
        const mintChanged = !!(existingRow && existingRow.mint !== project.mint);
        if (b.payoutSources != null) {
          const list = Array.isArray(b.payoutSources) ? b.payoutSources : String(b.payoutSources).split(",").map((s) => s.trim()).filter(Boolean);
          const applied = proj.withPayoutSources(mintChanged ? project : (existingRow || project), list, { nowUnix: nowUnix() });
          project = { ...project, payoutSources: applied.project.payoutSources, payoutSourcesHistory: applied.project.payoutSourcesHistory };
          if (applied.changed) {
            console.log(`[hub] ${project.id}: payoutSources set by the owner to [${applied.project.payoutSources.join(", ") || "(none)"}]`);
            try { alert(`${project.id}: payoutSources changed by the owner to [${applied.project.payoutSources.join(", ") || "(none)"}] — these wallets, plus fundingWallet, are now accepted as a settlement's source`); } catch (_) {}
          }
        } else if (mintChanged) {
          const history = Array.isArray(existingRow.payoutSourcesHistory) ? existingRow.payoutSourcesHistory : [];
          project = { ...project, payoutSources: [], payoutSourcesHistory: [...history, { payoutSources: [], at: nowUnix(), note: `reset: id re-issued to a new mint (was ${existingRow.mint})` }] };
          console.log(`[hub] ${project.id}: payoutSources reset — id re-issued to a new mint`);
        } else if (existingRow) {
          project = { ...project, payoutSources: existingRow.payoutSources || [], payoutSourcesHistory: existingRow.payoutSourcesHistory || [] };
        }
        // N4 (docs/HUB_JOURNAL_VERIFY_2026-09-18.md, Round 3): `vaultProject` — which ONE of our
        // own vault operator wallets a `&sweep=` may accept for this project — is owner-set here,
        // same carry-forward discipline as payoutSources: naming it changes it, leaving it off
        // carries the existing value forward, and a brand-new project starts with none (sweep then
        // allows only the funding wallet + payoutSources, never every vault operator). NEW-3: a
        // mint change is the same reset case as payoutSources above, for the same reason.
        if (b.vaultProject != null) {
          project = { ...project, vaultProject: proj.normalizeVaultProject(b.vaultProject) };
        } else if (mintChanged) {
          project = { ...project, vaultProject: null };
        } else if (existingRow) {
          project = { ...project, vaultProject: existingRow.vaultProject || null };
        }
        // N-2 (Round 4, docs/HUB_JOURNAL_VERIFY_2026-09-18.md): the owner's own edit path may
        // re-issue an id to a DIFFERENT mint (proj.approveProject only blocks that outright while
        // the row is `approved` — a suspended id is fair game, on purpose, for a deliberate relaunch).
        // But re-issuing an id whose store namespace still holds a stranger's days/paid/batches/
        // journal would let the new project silently inherit that ledger under its own name. Refuse
        // unless the id's store is completely empty; the owner clears it (or picks a new id) first.
        if (existingRow && existingRow.status !== "approved" && mintChanged && !hubStore.storeIsEmptyFor(kv, project.id)) {
          return res.status(409).json({ ok: false, error: `project "${project.id}" already has program data (days/paid/batches/journal) recorded under its previous mint — clear it before re-issuing this id to a new mint, or pick a new id` });
        }
        reg = proj.approveProject(reg, project, { nowUnix: nowUnix(), reserved: reserved() });
        if (!writeRegistryVerified(kv, reg)) return res.status(500).json({ ok: false, error: "registry write did not persist — check DATA_DIR" });
        console.log(`[hub] project APPROVED: ${project.id} (${project.symbol} ${project.mint})`);
      }
      return res.status(200).json({ ok: true, projects: Object.values(reg).map((x) => publicProject(x, { full: true })) });
    } catch (e) {
      // N2 (docs/HUB_JOURNAL_VERIFY_2026-09-18.md, Round 3): apply.approve → proj.approveProject
      // refuses an application that targets an id or mint already belonging to a registered
      // project with a tagged `project_exists` error — surfaced as 409, not the generic 400 every
      // other validation failure here gets, so a client (and a test) can tell "bad input" from
      // "that project already exists" without parsing the message text.
      if (e && e.code === "project_exists") return res.status(409).json({ ok: false, error: publicErrMsg(e) });
      return res.status(400).json({ ok: false, error: publicErrMsg(e) });
    }
  });

  // ── admin: status, terms, arm, disarm, accrue ───────────────────────────────────────────────
  app.all("/api/hub/:project/admin", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (isDirect(req)) return notFound(res);
    const b = body(req);
    const mutating = on(b.terms) || on(b.arm) || on(b.off) || on(b.accrue) || on(b.rescan);
    if (mutating && req.method !== "POST") return mutatingOnGet(res);
    const p = projectOf(req);
    if (!p) return adminAuthOK(req) ? notFound(res, "no such project") : notFound(res);
    const who = authOf(req, p);
    if (!who) return notFound(res);
    try {
      const now = nowUnix();
      let state = hubStore.read(kv, p.id, "state", {}) || {};
      const persistState = () => { if (!hubStore.writeVerified(kv, p.id, "state", state)) throw new Error("programme state write did not persist — check DATA_DIR"); };
      if (on(b.terms)) {
        // Same gate as arming (deep dive P1-034): an unpaid or lapsed project cannot re-term itself
        // through its desk. The owner can always edit — that is how a comped project is set up.
        if (who !== "owner" && !access.mayOperate(p.access, now)) {
          const acc = access.accessStatus(p.access, now);
          return res.status(402).json({ ok: false, error: `platform access is ${acc.state} (tier ${acc.tier}) — a month must be paid before the terms can change`, access: acc });
        }
        const wasFirstVersion = !eng.readState(state).versions.length;
        const cur = proj.versionFor(eng.readState(state), prog.sliceKey(now));
        const terms = { ...((cur && cur.terms) || {}), ...termsPatchFromQuery(b) };
        const effectiveFrom = b.effectiveFrom ? String(b.effectiveFrom) : defaultEffectiveFrom(state, now);
        state = { ...state, ...proj.createVersion(eng.readState(state), p, terms, { effectiveFrom, todayKey: dayKeyOf(now) }) };
        persistState();
        eng.resetCache(p.id);
        // Onboarding clock (E7): a project the owner seeds directly via /api/hub-registry?id= has
        // no version until its first &terms=1 here — a project onboarded through /hub-apply already
        // got this milestone at approval (apply.js approve()), so this is a no-op for it.
        if (wasFirstVersion) markMilestone(kv, p.id, "firstVersionPublishedAt", now);
        console.log(`[hub] ${p.id}: terms v${state.versions[state.versions.length - 1].version} from ${effectiveFrom} — ${state.versions[state.versions.length - 1].hash.slice(0, 12)}…`);
      }
      if (on(b.arm)) {
        // A dry run (Colosseum E10: terms/funding not yet agreed, e.g. POKEAHOE) must never be
        // armed. Checked first, before the two-flag confirm, so this is the message an owner or
        // operator actually sees rather than a generic "no program version" once terms are added.
        if (p.dryRun) return res.status(403).json({ ok: false, error: `${p.id} (${p.label}) is a DRY RUN — terms are not yet agreed with the team, so arming is refused. Nothing may accrue or pay.` });
        if (String(b.confirm || "") !== "go-live") return res.status(400).json({ ok: false, error: "arming needs &arm=1&confirm=go-live — two flags on purpose" });
        const acc = access.accessStatus(p.access, now);
        if (!access.mayOperate(p.access, now)) return res.status(402).json({ ok: false, error: `platform access is ${acc.state} (tier ${acc.tier}) — a month must be paid before arming, or the owner comps the project`, access: acc });
        // Launch Readiness (Addendum A): the numbers must show the program CAN be honoured before
        // it starts. readiness() always classifies a known shortfall (or a dry run, or a missing
        // version) as a `block` item; this is the one place that turns that into an actual
        // refusal — the checklist itself stays a read everywhere else (GET /readiness never
        // refuses anything, it only reports).
        const preArm = await computeReadiness(p, state, now);
        if (!preArm.checklist.ready) {
          const blockers = preArm.checklist.items.filter((i) => i.status === "block");
          return res.status(409).json({ ok: false, error: "launch readiness blocks arming — " + blockers.map((i) => i.key).join(", "), items: blockers, readiness: preArm.checklist });
        }
        state = eng.arm(state, now, { dryRun: p.dryRun === true }); persistState(); eng.resetCache(p.id);
        // Onboarding clock (E7): state.startedAt is set once by eng.arm and never moves — a
        // disarm/re-arm cycle keeps the original start, so this mirrors "first armed" exactly.
        markMilestone(kv, p.id, "firstArmedAt", eng.readState(state).startedAt);
        console.log(`[hub] ${p.id}: ARMED at ${state.startedAt} — the emission has started`);
        b.accrue = "1";
      } else if (on(b.off)) {
        state = eng.disarm(state); persistState();
        console.log(`[hub] ${p.id}: DISARMED — accrual stopped, start date kept`);
      }
      let ran = null;
      const sd = await scanDeps();
      if (on(b.accrue)) ran = await eng.accrualTick({ kv, projectId: p.id, project: p, nowUnix: now, deps: sd, onAlert: alert, reason: "manual" });
      const days = hubStore.read(kv, p.id, "days", {}) || {};
      const st = eng.readState(state);
      const cfg = eng.configFor({ project: p, state, nowUnix: now });
      const snap = await eng.scanLocks({ kv, projectId: p.id, project: p, state, nowUnix: now, force: on(b.rescan), deps: sd, onAlert: alert });
      const locks = snap.locks || [];
      const s = require("../cuna-staking");
      const eligible = cfg ? locks.filter((l) => s.qualifies(l, cfg)).length : 0;
      const missed = eng.missedSlices({ state, days, nowUnix: now });
      return res.status(200).json({
        ok: true, as: who, project: publicProject(p), armed: st.armed, startedAt: st.startedAt,
        versions: st.versions.map((v) => withSchema("program-version", { version: v.version, effectiveFrom: v.effectiveFrom, effectiveTo: v.effectiveTo, hash: v.hash, terms: v.terms, commitment: pub.commitmentView(v) })),
        configInForce: cfg, slicesAccrued: Object.keys(days).length, daysAccrued: prog.daysAccruedFrom(days),
        missedSlices: missed.length, missedRecent: missed.slice(-48),
        scan: { at: snap.at || 0, ageSec: snap.at ? Math.round((Date.now() - snap.at) / 1000) : null, locks: locks.length, eligibleNow: eligible, err: snap.err || null },
        ran,
      });
    } catch (e) { return res.status(400).json({ ok: false, error: publicErrMsg(e) }); }
  });

  // ── the project desk: operator session + the operator's view ──────────────────────────────
  // An operator wallet listed on the project signs a one-line nonce (nothing typed, no key) and
  // gets a 12-hour token for THIS project; the admin and payout routes accept it in
  // `x-clkn-operator`. The managed payer stays owner-only.
  app.get("/api/hub/:project/desk/challenge", limited("pay", { windowMs: 60000, max: 30 }), (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const p = projectOf(req);
    if (!p) return notFound(res, "no such project");
    const wallet = String(req.query.wallet || "").trim();
    if (!B58.test(wallet)) return res.status(400).json({ ok: false, error: "need wallet" });
    if (!(p.operatorWallets || []).includes(wallet)) return res.status(403).json({ ok: false, error: "this wallet is not an operator of the project" });
    try { return res.status(200).json({ ok: true, ...operator.issueChallenge(challenges, { projectId: p.id, symbol: p.symbol, wallet }) }); }
    catch (e) { return res.status(503).json({ ok: false, error: publicErrMsg(e) }); }
  });
  app.all("/api/hub/:project/desk/session", limited("pay", { windowMs: 60000, max: 30 }), (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "POST") return mutatingOnGet(res);
    const p = projectOf(req);
    if (!p) return notFound(res, "no such project");
    if (!secretNow() || typeof verifySignature !== "function") return res.status(503).json({ ok: false, error: "desk sessions are not configured on this server" });
    const b = body(req);
    const wallet = String(b.wallet || "").trim(), message = String(b.message || ""), signature = String(b.signature || "");
    if (!B58.test(wallet) || !message || !signature) return res.status(400).json({ ok: false, error: "need wallet, message, signature" });
    const m = operator.parseMessage(message);
    if (!m || m.wallet !== wallet || m.projectId !== p.id) return res.status(400).json({ ok: false, error: "message does not match this project and wallet" });
    // Consumed on this attempt no matter what follows: a signed message is good for one session.
    if (!operator.consumeChallenge(challenges, { nonce: m.nonce, projectId: p.id, wallet })) return res.status(400).json({ ok: false, error: "challenge missing, expired or already used — request a new one" });
    if (message !== operator.message(p.id, p.symbol, wallet, m.nonce)) return res.status(400).json({ ok: false, error: "message does not match the issued challenge" });
    if (!(p.operatorWallets || []).includes(wallet)) return res.status(403).json({ ok: false, error: "this wallet is not an operator of the project" });
    if (!verifySignature(message, signature, wallet)) return res.status(401).json({ ok: false, error: "signature did not verify" });
    const token = operator.issueToken(secretNow(), { projectId: p.id, wallet });
    try { traction.recordWalletConnect(kv, { source: "hub-operator", wallet }); } catch (_) { /* counter only, never blocks the session */ }
    console.log(`[hub] ${p.id}: desk session for operator ${wallet.slice(0, 6)}…`);
    return res.status(200).json({ ok: true, token, wallet, project: p.id, expiresAt: Date.now() + operator.SESSION_TTL_MS });
  });
  // The operator's view: every lock with its eligibility record and weight, what is owed, the
  // pending batches, the funding wallet's three numbers, access, and the versions.
  app.get("/api/hub/:project/desk", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (isDirect(req)) return notFound(res);
    const p = projectOf(req);
    if (!p) return adminAuthOK(req) ? notFound(res, "no such project") : notFound(res);
    const who = authOf(req, p);
    if (!who) return notFound(res);
    try {
      const now = nowUnix();
      const state = hubStore.read(kv, p.id, "state", {}) || {};
      const days = hubStore.read(kv, p.id, "days", {}) || {};
      const paid = hubStore.read(kv, p.id, "paid", {}) || {};
      const batches = hubStore.read(kv, p.id, "batches", {}) || {};
      const st = eng.readState(state);
      const cfg = eng.configFor({ project: p, state, nowUnix: now });
      const dec = Number.isInteger(p.rewardDecimals) ? p.rewardDecimals : (Number.isInteger(p.decimals) ? p.decimals : 9);
      const snap = await eng.scanLocks({ kv, projectId: p.id, project: p, state, nowUnix: now, force: on(req.query.rescan), deps: await scanDeps(), onAlert: alert });
      const s = require("../cuna-staking");
      const lockers = (snap.locks || []).map((l) => {
        const rec = cfg ? elig.eligibilityRecord(l, cfg, now) : { escrow: l.escrow, owner: l.recipient, creator: l.creator, qualifies: false, reasons: [{ code: "no_program", text: "no program version in force" }], numbers: {} };
        const end = Number(l.fullyVestedAt || 0);
        return { ...rec, amountRaw: String(l.atRiskRaw || 0), cliffTime: l.cliffTime || null, fullyVestedAt: l.fullyVestedAt || null, firstSeenAt: l.firstSeenAt || null,
          weight: cfg && rec.qualifies ? s.weightOf(l, now, cfg).toString() : "0", daysLeft: end ? Math.max(0, Math.ceil((end - now) / 86400)) : null };
      }).sort((a, b) => (BigInt(b.weight) > BigInt(a.weight) ? 1 : BigInt(b.weight) < BigInt(a.weight) ? -1 : 0));
      const owed = pay.owedNow({ days, paid, pending: batches, journal: hubStore.readJournal(kv) || {}, projectId: p.id });
      let owedTotal = 0n; for (const v of Object.values(owed)) owedTotal += v;
      const pending = Object.values(batches).filter((x) => x && x.state === "pending");
      let reserved = 0n; for (const bt of pending) for (const v of Object.values(pay.remainingOf(bt))) reserved += v;
      let credited = 0n; for (const d of Object.values(days)) for (const c of Object.values((d && d.credits) || {})) { try { credited += BigInt(c); } catch (_) {} }
      let paidTotal = 0n; for (const v of Object.values(paid)) { try { paidTotal += BigInt(v); } catch (_) {} }
      // The funding wallet's observed balance — a read, never a reservation.
      let observed = null, observedAt = null;
      try {
        const { PublicKey } = require("@solana/web3.js");
        const r = await connection().getParsedTokenAccountsByOwner(new PublicKey(p.fundingWallet), { mint: new PublicKey(p.rewardMint || p.mint) });
        let bal = 0n; for (const a of (r && r.value) || []) { try { bal += BigInt(a.account.data.parsed.info.tokenAmount.amount); } catch (_) {} }
        observed = bal.toString(); observedAt = now;
      } catch (_) { observed = null; }
      const obligations = owedTotal + reserved;
      const shortfall = observed == null ? null : (obligations > BigInt(observed) ? (obligations - BigInt(observed)).toString() : "0");
      return res.status(200).json({
        ok: true, as: who, project: publicProject(p), access: access.accessStatus(p.access, now),
        armed: st.armed, startedAt: st.startedAt, versions: st.versions.map((v) => withSchema("program-version", { version: v.version, effectiveFrom: v.effectiveFrom, effectiveTo: v.effectiveTo, hash: v.hash, terms: v.terms, commitment: pub.commitmentView(v) })),
        configInForce: cfg, decimals: dec, rewardMint: p.rewardMint || p.mint,
        accrual: { slices: Object.keys(days).length, days: prog.daysAccruedFrom(days), missed: eng.missedSlices({ state, days, nowUnix: now }).length, creditedRaw: credited.toString(), paidRaw: paidTotal.toString() },
        scan: { at: snap.at || 0, ageSec: snap.at ? Math.round((Date.now() - snap.at) / 1000) : null, locks: lockers.length, eligibleNow: lockers.filter((x) => x.qualifies).length, err: snap.err || null },
        lockers,
        owed: fmtOwed(owed, dec), owedTotalRaw: owedTotal.toString(),
        pendingBatches: pending.map((x) => ({ id: x.id, at: x.at, count: x.count, totalRaw: x.totalRaw, remaining: Object.keys(pay.remainingOf(x)).length })),
        funding: { wallet: p.fundingWallet, obligationsRaw: obligations.toString(), reservedRaw: reserved.toString(), observedBalanceRaw: observed, observedAt, shortfallRaw: shortfall },
      });
    } catch (e) { return res.status(500).json({ ok: false, error: publicErrMsg(e) }); }
  });

  // ── desk: preview a DRAFT (Colosseum roadmap EE1) ──────────────────────────────────────────
  // "Who would this pay today?" for terms that have not been published. POST-only because the
  // draft terms are a request BODY, not because anything is written — this route never calls
  // hubStore.write / writeVerified / kv.set, and never touches `state` on disk; see
  // lib/hub/preview.js's header and scripts/hub-preview-test.cjs, which hashes app-state.json
  // before and after ten previews to prove it. Gated exactly like the terms write itself
  // (operator-token or owner, same lapsed-project refusal as /admin?terms=1 — a preview must
  // never suggest a publish that the platform would actually refuse) and rate-limited like the
  // other heavy reads.
  app.all("/api/hub/:project/desk/preview", limited("hubheavy", { windowMs: 60000, max: 60 }), async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "POST") return mutatingOnGet(res);
    if (isDirect(req)) return notFound(res);
    const p = projectOf(req);
    if (!p) return adminAuthOK(req) ? notFound(res, "no such project") : notFound(res);
    const who = authOf(req, p);
    if (!who) return notFound(res);
    const now = nowUnix();
    // Same gate as the terms write (deep dive P1-034): an unpaid or lapsed project's operator
    // cannot re-term itself through the desk, so a preview never dangles a publish the platform
    // would refuse a moment later. The owner is exempt, exactly as for the real write.
    if (who !== "owner" && !access.mayOperate(p.access, now)) {
      const acc = access.accessStatus(p.access, now);
      return res.status(402).json({ ok: false, error: `platform access is ${acc.state} (tier ${acc.tier}) — a month must be paid before the terms can change`, access: acc });
    }
    try {
      const b = body(req);
      const state = hubStore.read(kv, p.id, "state", {}) || {};
      // The same merge the terms write performs (routes.js /admin?terms=1 above): the draft is
      // the in-force terms patched by whatever fields the form sent, so previewing the unmodified
      // form reproduces the currently published version exactly.
      const cur = proj.versionFor(eng.readState(state), prog.sliceKey(now));
      const draftTerms = { ...((cur && cur.terms) || {}), ...termsPatchFromQuery(b) };
      const effectiveFrom = b.effectiveFrom ? String(b.effectiveFrom) : defaultEffectiveFrom(state, now);
      const snap = await eng.scanLocks({ kv, projectId: p.id, project: p, state, nowUnix: now, deps: await scanDeps(), onAlert: alert });
      if (snap.locks == null) return res.status(503).json({ ok: false, error: "Could not read the chain just now — try again in a minute.", scanError: snap.err || "no scan yet" });
      const days = Math.max(1, Math.min(preview.MAX_DAYS, Math.floor(Number(b.days) || 1)));
      const result = preview.previewTerms({ project: p, draftTerms, locks: snap.locks, days, nowUnix: now, state, effectiveFrom, todayKey: dayKeyOf(now) });
      return res.status(200).json({ ok: true, as: who, project: publicProject(p), effectiveFrom, ...result });
    } catch (e) { return res.status(400).json({ ok: false, error: publicErrMsg(e) }); }
  });

  // ── launch readiness (operator/owner) ──────────────────────────────────────────────────────
  // A READ, not an admin action — it reveals the funding wallet's observed balance (which the
  // public project page does not), so it needs the same operator/owner session as /desk, but it
  // never refuses to arm anything itself: that refusal lives on the &arm=1&confirm=go-live path
  // above. This route only reports the same checklist and the reward-budget planner's next four
  // periods.
  app.get("/api/hub/:project/readiness", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (isDirect(req)) return notFound(res);
    const p = projectOf(req);
    if (!p) return adminAuthOK(req) ? notFound(res, "no such project") : notFound(res);
    const who = authOf(req, p);
    if (!who) return notFound(res);
    try {
      const now = nowUnix();
      const state = hubStore.read(kv, p.id, "state", {}) || {};
      const r = await computeReadiness(p, state, now);
      return res.status(200).json({
        ok: true, as: who, project: publicProject(p),
        programVersion: r.inForce ? { version: r.inForce.version, effectiveFrom: r.inForce.effectiveFrom, hash: r.inForce.hash } : null,
        readiness: r.checklist, plan: r.plan, funding: r.funding,
        scan: { at: r.scan.at || 0, locks: r.locks.length, err: r.scan.err || null },
      });
    } catch (e) { return res.status(500).json({ ok: false, error: publicErrMsg(e) }); }
  });

  // ── B5: independent on-chain commitment of a program-version hash (Colosseum roadmap E3) ─────
  // The server BUILDS an unsigned memo transaction from the project's own terms; it never signs
  // anything itself. The desk sends it wallet-first (CLAUDE.md: the connected wallet signs first,
  // no other signer here — /locker-room's rule) and reports back the signature it got; only once
  // THIS server has independently read that signature off the chain (commit/observe) and checked
  // the fee payer and the memo text does a version's public claim upgrade from "reproducible from
  // published inputs" to "independently committed" (lib/hub/README.md §6). A client's claim of
  // what it sent is never trusted on its own — see lib/hub/commit.js verifyCommitTx.
  app.all("/api/hub/:project/commit/build", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "POST") return mutatingOnGet(res);
    if (isDirect(req)) return notFound(res);
    const p = projectOf(req);
    if (!p) return adminAuthOK(req) ? notFound(res, "no such project") : notFound(res);
    const who = authOf(req, p);
    if (!who) return notFound(res);
    try {
      commit.assertCanCommit(p);
      const b = body(req);
      const state = hubStore.read(kv, p.id, "state", {}) || {};
      const st = eng.readState(state);
      const found = commit.resolveVersion(st.versions, b.version);
      if (!found) return res.status(404).json({ ok: false, error: st.versions.length ? `no such program version: ${b.version}` : "this project has no program version published yet" });
      const v = found.version;
      if (v.commitment) return res.status(409).json({ ok: false, error: `v${v.version} is already committed on-chain`, commitment: pub.commitmentView(v) });
      const memo = commit.memoText(p.id, v.version, v.hash);
      const { PublicKey, Transaction, TransactionInstruction } = require("@solana/web3.js");
      const conn = connection();
      const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
      const ix = new TransactionInstruction({ keys: [], programId: new PublicKey(commit.MEMO_PROGRAM_ID), data: commit.memoBytes(p.id, v.version, v.hash) });
      const tx = new Transaction({ feePayer: new PublicKey(p.fundingWallet), blockhash, lastValidBlockHeight }).add(ix);
      // Unsigned on purpose (requireAllSignatures:false) — the funding wallet signs client-side;
      // the server never holds or touches a project's key. Diffed byte-for-byte against a
      // hand-built Uint8Array in scripts/hub-commit-test.cjs before this ever shipped.
      const txBase64 = tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
      return res.status(200).json({ ok: true, projectId: p.id, version: v.version, hash: v.hash, memo, fundingWallet: p.fundingWallet, lastValidBlockHeight, txBase64 });
    } catch (e) { return res.status(400).json({ ok: false, error: publicErrMsg(e) }); }
  });
  app.all("/api/hub/:project/commit/observe", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "POST") return mutatingOnGet(res);
    if (isDirect(req)) return notFound(res);
    const p = projectOf(req);
    if (!p) return adminAuthOK(req) ? notFound(res, "no such project") : notFound(res);
    const who = authOf(req, p);
    if (!who) return notFound(res);
    if (typeof getTx !== "function") return res.status(503).json({ ok: false, error: "chain reads are not configured on this server" });
    const b = body(req);
    const sig = String(b.sig || "").trim();
    if (!SIG_RE.test(sig)) return res.status(400).json({ ok: false, error: "bad transaction signature" });
    try {
      const state = hubStore.read(kv, p.id, "state", {}) || {};
      const st = eng.readState(state);
      const found = commit.resolveVersion(st.versions, b.version);
      if (!found) return res.status(404).json({ ok: false, error: st.versions.length ? `no such program version: ${b.version}` : "this project has no program version published yet" });
      if (found.version.commitment) return res.status(200).json({ ok: true, already: true, projectId: p.id, version: found.version.version, commitment: pub.commitmentView(found.version) });
      const expectedMemo = commit.memoText(p.id, found.version.version, found.version.hash);
      let tx;
      try { tx = await getTx(sig); } catch (e) { return res.status(503).json({ ok: false, error: "Could not read the chain just now — try again in a minute.", retry: true }); }
      const check = commit.verifyCommitTx(tx, { expectedPayer: p.fundingWallet, expectedMemo });
      if (!check.ok) return res.status(check.retry ? 202 : 400).json({ ok: false, error: check.reason, detail: check });
      const commitment = { sig, slot: check.slot, observedAt: nowUnix(), memo: expectedMemo };
      const applied = commit.applyCommitment(state, found.index, commitment);
      if (!applied.already) {
        // A last-write-wins persist, not lock-guarded like the payment path: two concurrent
        // observations of the SAME signature compute the identical commitment value (harmless
        // either way), and no other flow can ever race a write onto this exact array slot — unlike
        // a payment signature, a commitment observation never moves or consumes funds.
        if (!hubStore.writeVerified(kv, p.id, "state", applied.state)) return res.status(503).json({ ok: false, error: "could not record the commitment durably — try again", retry: true });
        eng.resetCache(p.id);
        console.log(`[hub] ${p.id}: v${found.version.version} committed on-chain — ${sig.slice(0, 12)}…`);
      }
      return res.status(200).json({ ok: true, already: applied.already, projectId: p.id, version: found.version.version, commitment: pub.commitmentView({ commitment: applied.commitment }) });
    } catch (e) { return res.status(500).json({ ok: false, error: publicErrMsg(e) }); }
  });
  // Public, no wallet, no key: whatever a version's admin/desk view already shows an operator
  // (hash, terms) a holder gets too — this is the route the eventual /p/:id/program/:v page reads,
  // and the JSON a reader validates before trusting a receipt's arithmetic (README §7).
  app.get("/api/hub/:project/program/:version", (req, res) => {
    res.setHeader("Cache-Control", "public, max-age=30");
    const p = projectOf(req);
    if (!p) return notFound(res, "no such project");
    try {
      const state = hubStore.read(kv, p.id, "state", {}) || {};
      const st = eng.readState(state);
      const found = commit.resolveVersion(st.versions, req.params.version);
      if (!found) return notFound(res, "no such program version");
      // full:true (AA2 bug fix, 2026-09-18): this is "the JSON a reader validates before trusting
      // a receipt's arithmetic" (see the comment above) — it must carry every field
      // lib/hub/project.js verifyVersionHash hashes, or the recompute can never pass. See
      // lib/hub/public.js programVersionView's own comment for why every added field is public.
      const version = withSchema("program-version", pub.programVersionView(found.version, { full: true }));
      const notice = version.commitment ? teach.COMMITTED_NOTICE : teach.REPRODUCIBLE_NOTICE;
      return res.status(200).json({ ok: true, projectId: p.id, version, notice });
    } catch (e) { return res.status(500).json({ ok: false, error: publicErrMsg(e) }); }
  });

  // ── holder view (public) ────────────────────────────────────────────────────────────────────
  app.get("/api/hub/:project/holder", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const p = projectOf(req);
    if (!p) return notFound(res, "no such project");
    const addr = String(req.query.address || "").trim();
    if (!B58.test(addr)) return res.status(400).json({ ok: false, error: "address must be a Solana wallet" });
    try {
      const now = nowUnix();
      const state = hubStore.read(kv, p.id, "state", {}) || {};
      const snap = await eng.scanLocks({ kv, projectId: p.id, project: p, state, nowUnix: now, deps: await scanDeps(), onAlert: alert });
      if (snap.locks == null) return res.status(503).json({ ok: false, error: "Could not read the chain just now — try again in a minute.", scanError: snap.err || "no scan yet" });
      // crash P1-4 (docs/HUB_JOURNAL_VERIFY_2026-09-18.md): the public holder view must agree with
      // the payout desk (which already passes the journal — see the /payout route below) about
      // what is owed, or the two silently diverge on any row the two witnesses disagree about.
      const view = eng.walletView({ project: p, state, addr, locks: snap.locks,
        days: hubStore.read(kv, p.id, "days", {}) || {}, paid: hubStore.read(kv, p.id, "paid", {}) || {}, batches: hubStore.read(kv, p.id, "batches", {}) || {}, nowUnix: now,
        journal: hubStore.readJournal(kv) || {} });
      return res.status(view.ok ? 200 : 400).json({ ...view, project: { id: p.id, label: p.label, symbol: p.symbol, mint: p.mint, decimals: p.decimals, rewardMint: p.rewardMint, rewardDecimals: p.rewardDecimals }, scanAgeSec: Math.round((Date.now() - snap.at) / 1000) });
    } catch (e) { return res.status(500).json({ ok: false, error: publicErrMsg(e) }); }
  });

  // ── self-serve onboarding: GET ?mint= checks a mint, POST previews or submits an application ──
  // Own root like the registry (the public /api/hub/:project would read "apply" as a project).
  // An application grants nothing; the owner approves it from /api/hub-registry?approve=.
  app.all("/api/hub-apply", limited("hubapply", { windowMs: 60000, max: 12 }), async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const b = body(req);
    try {
      const conn = connection();
      const { PublicKey } = require("@solana/web3.js");
      const readMint = async (m) => { if (!B58.test(String(m || ""))) throw new Error(`not a mint address: ${m}`); return mintInfoFromParsed((await conn.getParsedAccountInfo(new PublicKey(String(m)))).value); };
      if (req.method !== "POST") {
        if (!b.mint) return res.status(400).json({ ok: false, error: "GET needs ?mint= (a mint check); submitting is a POST" });
        const info = await readMint(b.mint);
        const bad = info.extensions.filter((e) => proj.UNSUPPORTED_EXTENSIONS.has(e));
        const reg = hubStore.readRegistry(kv) || {};
        const taken = Object.values(reg).find((p) => p && p.mint === String(b.mint) && p.status !== "suspended");
        const rsv = reservedBy(b.mint);
        return res.status(200).json({ ok: true, mint: String(b.mint), ...info, supported: !bad.length && proj.TOKEN_PROGRAMS.has(info.tokenProgram), unsupportedExtensions: bad, alreadyRegistered: taken ? taken.id : (rsv ? rsv[0] : null) });
      }
      const input = { ...b, terms: termsPatchFromQuery(b.terms || {}) };
      if (typeof input.operatorWallets === "string") input.operatorWallets = input.operatorWallets.split(",").map((x) => x.trim()).filter(Boolean);
      if (input.rewardMint && String(input.rewardMint) !== String(input.mint)) input.rewardMintInfo = await readMint(input.rewardMint);
      const now = nowUnix();
      const app0 = apply.validateApplication(input, await readMint(input.mint), { nowUnix: now });
      const pv0 = apply.preview(app0, { nowUnix: now });
      const pv = { ...pv0, version: withSchema("program-version", pv0.version) };
      if (on(b.preview)) return res.status(200).json({ ok: true, preview: true, project: publicProject(app0.project), terms: app0.terms, tierRequested: app0.tierRequested, ...pv });
      const reg = hubStore.readRegistry(kv) || {};
      // Consistency nit (Round 5, docs/HUB_JOURNAL_VERIFY_2026-09-18.md): this used to exempt a
      // SUSPENDED project's id/mint, on the theory that a suspended row was fair game to reapply
      // for. But `apply.approve` -> `proj.approveProject` sets `requireNew: true` (N2, Round 3) and
      // that refuses ANY existing id, suspended or not, with `code: "project_exists"` — so an
      // application accepted here for a suspended id/mint could NEVER be approved; the owner would
      // only ever see a permanently dead application. Refuse it at the door instead, with the same
      // code, so the applicant learns the id/mint is unavailable immediately rather than after
      // waiting for an approval that will always 409.
      if (reg[app0.projectId]) {
        const err = new Error(`the project id "${app0.projectId}" is taken`);
        err.code = "project_exists";
        throw err;
      }
      if (Object.values(reg).some((p) => p && p.mint === app0.project.mint) || reservedBy(app0.project.mint)) {
        const err = new Error("this mint already runs a program here");
        err.code = "project_exists";
        throw err;
      }
      if (Object.prototype.hasOwnProperty.call(reserved(), app0.projectId)) return res.status(409).json({ ok: false, error: `the project id "${app0.projectId}" is taken` });
      const book = apply.addToBook(kv.get(APPLICATIONS_KEY, {}) || {}, app0);
      if (!writeVerified(APPLICATIONS_KEY, book)) return res.status(503).json({ ok: false, error: "could not save the application — try again in a minute", retry: true });
      console.log(`[hub] application ${app0.id}: ${app0.projectId} (${app0.project.symbol} ${app0.project.mint}) tier ${app0.tierRequested} — ${app0.contact}`);
      try { alert(`new Lock to Earn application ${app0.id}: ${app0.projectId} (${app0.project.symbol}) tier ${app0.tierRequested} — approve at /api/hub-registry?approve=${app0.id}`); } catch (_) {}
      return res.status(200).json({ ok: true, application: { id: app0.id, projectId: app0.projectId, status: app0.status, submittedAt: app0.submittedAt }, project: publicProject(app0.project), terms: app0.terms, tierRequested: app0.tierRequested, ...pv,
        next: "The owner reviews it. Once approved, the project pays its first month at /hub/" + app0.projectId + "/pay and the program is armed." });
    } catch (e) {
      // Same 409/project_exists surfacing /api/hub-registry?approve= already uses (Round 3 N2) —
      // a client (and a test) can tell "this id/mint is taken" from every other validation failure
      // here without parsing the message text.
      if (e && e.code === "project_exists") return res.status(409).json({ ok: false, error: publicErrMsg(e) });
      return res.status(400).json({ ok: false, error: publicErrMsg(e) });
    }
  });

  // ── platform access: quote + pay ────────────────────────────────────────────────────────────
  // GET  /api/hub/:project/access            → status + a fresh quote (SOL, and CLKN priced now)
  // POST /api/hub/:project/access?sig=&quote= → verify the landed payment against that quote,
  //                                             extend the paid period, consume the signature.
  // The payment must come from one of the project's OPERATOR WALLETS (access.payerAllowed): a
  // landed transfer is public, and an unbound claim let any project race the rightful one to a
  // fresh quote and take its month (deep dive 2026-09-17 P0-007). The quote is what makes "priced
  // at the moment they pay" true: the CLKN amount is fixed when the quote is issued and the payment
  // must land inside the quote's window. A signature is consumed ONCE across the whole product:
  // the registry (every project's ledger), then the shared signature store under its own
  // namespace — and the tools-pass namespace ("sol:") is checked both ways, since both flows
  // collect into the same wallet.
  const QUOTES_KEY = (id) => `hub:quotes:${id}`;
  const SIG_KEY = (sig) => "hub-access:" + sig;
  const MAX_QUOTES_PER_PROJECT = 1000;   // rate-limited to 30/min already; this only bounds the kv row under abuse
  const payReady = () => !!(sigStore && getTx && payTo && clknMint);
  const payToNow = () => (typeof payTo === "function" ? payTo() : payTo);
  app.all("/api/hub/:project/access", limited("pay", { windowMs: 60000, max: 30 }), async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const b = body(req);
    const paying = b.sig != null || b.quote != null;
    if (paying && req.method !== "POST") return mutatingOnGet(res);
    const p = projectOf(req);
    if (!p) return notFound(res, "no such project");
    if (!payReady()) return res.status(503).json({ ok: false, error: "platform payments are not configured on this server" });
    const now = nowUnix();
    const status = access.accessStatus(p.access, now);
    const dest = payToNow();
    try {
      if (!paying) {
        if (status.tier === "comped") return res.status(200).json({ ok: true, project: publicProject(p), access: status, quote: null, note: "comped — nothing to pay" });
        let solPerClkn = 0;
        try { solPerClkn = typeof clknPriceInSol === "function" ? Number(await clknPriceInSol()) : 0; } catch (_) { solPerClkn = 0; }
        const quote = accessPay.makeQuote({ tier: status.tier, atMs: Date.now(), solPerClkn, clknDecimals });
        const book = accessPay.pruneQuotes(kv.get(QUOTES_KEY(p.id), {}) || {}, Date.now());
        // A quote is needed for as long as a payment against it can still verify: its TTL PLUS
        // the late grace (a refresh used to evict an expired-but-still-verifiable quote and strand
        // the landed payment — Codex 2026-09-17, finding 4). Only quotes past that window go; the
        // cap then takes the oldest, and only under abuse (deep dive P1-054).
        const nowMs = Date.now();
        Object.keys(book).filter((k) => (book[k].expiresMs || 0) + accessPay.QUOTE_LATE_MS < nowMs).forEach((k) => { delete book[k]; });
        const ids = Object.keys(book);
        if (ids.length >= MAX_QUOTES_PER_PROJECT) {
          ids.sort((a, c) => (book[a].atMs || 0) - (book[c].atMs || 0)).slice(0, ids.length - MAX_QUOTES_PER_PROJECT + 1).forEach((k) => { delete book[k]; });
        }
        book[quote.id] = quote;
        // The quote is the payment's only redemption key: a book write the volume swallowed made a
        // landed payment permanently unredeemable. Verified write, or no payTo is shown.
        if (!writeVerified(QUOTES_KEY(p.id), book)) return res.status(503).json({ ok: false, error: "could not issue a quote durably right now — try again in a minute; do not pay against a quote you were not shown", retry: true });
        return res.status(200).json({ ok: true, project: publicProject(p), access: status,
          quote: { ...quote, sol: quote.lamports / 1e9, clknUi: quote.clknRaw ? pub.rawToUi(BigInt(quote.clknRaw), clknDecimals) : null, validForMin: accessPay.QUOTE_TTL_MIN },
          payTo: { sol: dest.sol, clkn: dest.clkn, clknMint }, clknPriceUnavailable: !quote.clknRaw });
      }
      const sig = String(b.sig || "").trim();
      if (sig.length < 80 || sig.length > 100) return res.status(400).json({ ok: false, error: "bad payment signature" });
      const book = kv.get(QUOTES_KEY(p.id), {}) || {};
      const quote = book[String(b.quote || "")];
      if (!quote) return res.status(400).json({ ok: false, error: "unknown or expired quote — request a new one with GET and pay against it" });
      if (status.tier === "comped") return res.status(400).json({ ok: false, error: "comped project has nothing to pay" });
      // Recovery: the same signature presented again reports the period it already bought.
      const prior = ((p.access && p.access.payments) || []).find((x) => x.sig === sig);
      if (prior) return res.status(200).json({ ok: true, recovered: true, payment: prior, access: status });
      const usedBy = access.sigUsedInRegistry(hubStore.readRegistry(kv) || {}, sig);
      if (usedBy) return res.status(409).json({ ok: false, error: "this payment signature already bought a month for another project" });
      if (typeof sigStore.has === "function" && (sigStore.has(SIG_KEY(sig)) || sigStore.has(sig) || sigStore.has("sol:" + sig))) return res.status(409).json({ ok: false, error: "this payment signature was already used for something else" });
      // One verification per signature at a time (deep dive P1-053): the replay checks above run
      // before the chain read, so two tabs posting the same signature together both passed them
      // and both granted. The lock is the store-backed one the payout path uses, so it also holds
      // across Railway's processes; it self-clears after its TTL.
      const lock = bp.lockAcquire(kv, "hub-access:" + sig);
      if (!lock.ok) return res.status(409).json({ ok: false, error: "this payment is already being verified — wait a moment and retry", retry: true });
      try {
      let tx;
      try { tx = await getTx(sig); } catch (e) { return res.status(503).json({ ok: false, error: "Could not read the chain just now — nothing consumed, try again in a minute.", retry: true }); }
      const parsed = accessPay.parsePayment(tx, { payTo: dest, clknMint });
      const v = accessPay.verifyPayment({ quote, payment: parsed });
      if (!v.ok) return res.status(v.retry ? 202 : 400).json({ ok: false, error: v.reason === "short" ? "payment does not cover the quoted amount" : v.reason === "outside_quote_window" ? "payment landed outside the quote's window — request a new quote" : v.reason === "not_final_yet" ? "payment not final yet — try again in a few seconds" : v.reason, detail: v, retry: !!v.retry });
      if (!access.payerAllowed(p, v.payer)) return res.status(403).json({ ok: false, error: "the payment must come from one of this project's operator wallets — it was sent by " + String(v.payer || "an unknown wallet") + "; nothing consumed, the SOL stays where it landed", payer: v.payer || null, operatorWallets: p.operatorWallets || [] });
      const paidAtUnix = Math.floor(v.blockTimeMs / 1000);
      const acc = access.applyPayment(p.access, { sig, atUnix: paidAtUnix, kind: v.kind, lamports: v.kind === "sol" ? v.lamports : undefined, clknRaw: v.kind === "clkn" ? v.clknRaw : undefined });
      const reg = hubStore.readRegistry(kv) || {};
      // Onboarding clock (E7): the first access payment verified for this project, ever.
      const milestones = proj.setMilestoneOnce(reg[p.id] && reg[p.id].milestones, "firstPaidAt", paidAtUnix);
      const next = { ...reg, [p.id]: { ...reg[p.id], access: acc, milestones } };
      if (!writeRegistryVerified(kv, next)) return res.status(503).json({ ok: false, error: "could not record the payment durably — nothing consumed, try again", retry: true });
      // The registry row is the source of truth for this payment; the signature store is the
      // cross-product guard (a hub payment can never double as a tools-pass payment).
      if (typeof sigStore.add === "function" && !sigStore.add(SIG_KEY(sig)) && !(typeof sigStore.has === "function" && sigStore.has(SIG_KEY(sig)))) {
        // The registry row above is the durable truth and every other consumer of this wallet
        // consults it (tools pass, verify-sol-payment); the store is the fast path. Say so loudly.
        try { alert(`${p.id}: access payment ${sig.slice(0, 12)}… recorded in the registry but the signature store did not take it — check the volume`); } catch (_) {}
      }
      console.log(`[hub] ${p.id}: access PAID (${v.kind}) by ${v.payer} — paid through ${new Date(acc.paidThroughUnix * 1000).toISOString().slice(0, 10)}`);
      return res.status(200).json({ ok: true, recovered: false, payment: acc.payments[acc.payments.length - 1], access: access.accessStatus(acc, now) });
      } finally { if (lock.token) bp.lockRelease(kv, lock.token); }
    } catch (e) { return res.status(500).json({ ok: false, error: publicErrMsg(e) }); }
  });

  // ── payout ──────────────────────────────────────────────────────────────────────────────────
  // N1 (docs/HUB_JOURNAL_VERIFY_2026-09-18.md, Round 3): the same per-IP limiter every other
  // write route on this mount already carries — a burst of &sent= requests (each up to 500 rows)
  // was otherwise unbounded, which is half of the alert-flood finding (the other half is the
  // one-summary-alert change inside the handler, below).
  app.all("/api/hub/:project/payout", limited("hubpayout", { windowMs: 60000, max: 30 }), async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (isDirect(req)) return notFound(res);
    const b = body(req);
    const mutating = on(b.export) || b.send || on(b.sweep) || b.void || b.sent || b.confirm || b.cancel || b.waive;
    if (mutating && req.method !== "POST") return mutatingOnGet(res);
    const p = projectOf(req);
    if (!p) return adminAuthOK(req) ? notFound(res, "no such project") : notFound(res);
    const who = authOf(req, p);
    if (!who) return notFound(res);
    // The managed payer signs with a key Railway holds — the owner's call, never an operator's.
    if (b.send && who !== "owner") return res.status(403).json({ ok: false, error: "the managed payer is owner-only — export the batch and sign it in your own wallet" });
    // N-3 (Round 4): writing off a partial row's remainder (ledger.waiveRemainder) is owner-only —
    // an operator records what actually landed (&sent=), never what the project chooses not to pay.
    if (b.waive && who !== "owner") return res.status(403).json({ ok: false, error: "waiving a row's remainder is owner-only" });
    // Marking a whole batch paid WITHOUT per-row signatures writes sig:null rows that void cannot
    // undo — an operator could settle every locker's credit with one call (deep dive P1-047).
    // Operators record what they actually sent with &sent= (verified on chain); the override is the owner's.
    if (b.confirm && who !== "owner") return res.status(403).json({ ok: false, error: "marking a batch paid without per-row signatures is owner-only — record signed rows with &sent=" });
    // A dry run never accrues, so there is never anything owed to export or send (Colosseum E10).
    // Refused explicitly rather than relying on "nothing owed" reading as a no-op, in case a real
    // program version is ever created for a dry-run project before the flag is turned off. W3:
    // refused for EVERY mutating action on this route, before any store read — not just
    // export/send — so a dry-run project can never acquire a sent/confirmed/journaled row by any
    // path (§ "A dryRun: true project must be refused before anything else").
    if (p.dryRun && mutating) return res.status(403).json({ ok: false, error: `${p.id} is a DRY RUN — nothing accrues, so there is nothing to export, send, confirm, cancel, void or sweep.` });
    // crash P0-1 (docs/HUB_JOURNAL_VERIFY_2026-09-18.md): serialise the WHOLE mutating handler for
    // this project — not just the managed payer's own broadcast (the narrower lock further below
    // already covered that). Two overlapping mutating requests for the SAME project used to each
    // read the store, do their own work, and write back a stale snapshot that erased whichever
    // sibling persisted first (a real "&sent=" for two different wallets, interleaved on a slow
    // getTx, silently lost one wallet's paid row AND journal entry — the probe in that report is
    // now scripts/hub-settle-route-test.cjs section 11). Held across every persist in this
    // request, including the journal write; released in the finally below, whatever happens.
    // Round 2 #6 (docs/HUB_JOURNAL_VERIFY_2026-09-18.md): a distinct `hublock:` namespace, never
    // `hub:<project>:…` — that pattern collided with the journal's own `hub:settle:` kv prefix for
    // a project literally named "settle" ("hub:settle:payout" read back as a fake journal entry).
    // "settle" is also now a reserved project id (lib/hub/project.js), and lib/hub/store.js's
    // readJournal ignores anything under either prefix that is not shaped like a real entry —
    // three independent layers on the same finding.
    const payoutLockKey = `hublock:${p.id}:payout`;
    let payoutLock = { ok: true, token: null };
    if (mutating) {
      payoutLock = hubStore.lockAcquire(kv, payoutLockKey);
      if (!payoutLock.ok) return res.status(409).json({ ok: false, error: "busy", detail: "another payout request for this project is in flight — wait a moment and retry", lock: payoutLock });
    }
    try {
      const now = nowUnix();
      const dec = Number.isInteger(p.rewardDecimals) ? p.rewardDecimals : (Number.isInteger(p.decimals) ? p.decimals : 9);
      const mint = p.rewardMint || p.mint;
      const days = hubStore.read(kv, p.id, "days", {}) || {};
      let paid = hubStore.read(kv, p.id, "paid", {}) || {};
      let batches = hubStore.read(kv, p.id, "batches", {}) || {};
      // adv P0-1 → Round 2 #3 (docs/HUB_JOURNAL_VERIFY_2026-09-18.md): which wallets a
      // HOLDER/OPERATOR-SUPPLIED transfer (the &sent= branch) is allowed to have come FROM. This
      // used to read the program version's `fundedBy` TERM — but that term has its own documented
      // meaning ("wallets whose own vesting unlock feeds the daily pool", lib/hub/project.js
      // validateTerms) and a desk operator can publish a new version through
      // /api/hub/:project/admin?terms= any time the project's platform access is current, which
      // let an operator widen who a settlement may come from by the SAME lever that changes the
      // pool's daily arithmetic — the P0-1 finding, narrowed rather than closed. `payoutSources`
      // is a distinct PROJECT-RECORD field, settable only through the owner-gated
      // /api/hub-registry admin path (lib/hub/project.js withPayoutSources), never a desk
      // operator's terms. See lib/hub/README.md §"payment-source allowlist".
      const fundedBy = [p.fundingWallet, ...(Array.isArray(p.payoutSources) ? p.payoutSources : [])];
      // Round 2 #4 (docs/HUB_JOURNAL_VERIFY_2026-09-18.md, NEW): the MANAGED payer (&send=) and
      // &sweep= branches settle a transfer WE ourselves broadcast — our own signature is already
      // trusted, so the vault's own operator wallet(s) must also be an allowed source there, or
      // every managed-payer project silently stops issuing receipts (money still moves — the
      // legacy paid/sent row is unaffected — but the journal refuses every one of its own
      // settlements). &send= names the vault project explicitly (`from=`), so only THAT project's
      // operator wallet is added; &sweep= has no `from` (it reconciles whatever this project's
      // batches already record as pending, however they were signed), so every vault project's
      // operator wallet is allowed there — still only OUR OWN signing keys, never a holder- or
      // operator-supplied one. Neither is used on &sent=, which is exactly the branch adv P0-1
      // targets (adv P0-1 is holder/operator-supplied input; this branch is ours).
      const vaultOperatorPubkey = (id) => { try { return typeof vault.operatorPubkey === "function" ? vault.operatorPubkey(id) : null; } catch (_) { return null; } };
      // W3 (Addendum B1): the global settlement journal. Read once; every branch below that lands
      // a verified transfer folds its update into the SAME persist as the legacy batches/paid write
      // it already does — never a second, separate write (CLAUDE.md: a journal spanning kv keys is
      // one persist). crash P0-1/P1-1: persisted per-transfer (hubStore.journalEntryKey), never as
      // the whole blob — see lib/hub/store.js.
      let hubJournal = hubStore.readJournal(kv) || {};
      // Batches first (remainingOf is what stops a re-send), then paid; one kv persist writes the
      // whole store, so the second write carries the first. A false stops whatever is running.
      // ONE persist for both money parts: written one after the other, a crash between them left a
      // sent row with nothing in paid and the ledger offered that money again (Codex, finding 1).
      const saveMoney = () => hubStore.writeManyVerified(kv, p.id, { batches, paid });
      const report = {};
      const batchOf = (id) => { const bt = batches[String(id || "")]; if (!bt) throw new Error("no such batch (pass &batch=)"); return bt; };

      if (b.sent) {
        // Rows signed in the project's own wallet (the airdropper flow): each signature is verified
        // ON CHAIN before it is recorded — a typo or a foreign signature must not mark a row paid.
        // This whole branch is HOLDER/OPERATOR-SUPPLIED input (unlike &sweep=/&send=, where the
        // signature is one WE broadcast ourselves), so it is the one path adv P0-1/P0-2 target.
        const id = String(b.batch || ""); const bt = batchOf(id);
        let results = b.sent; if (typeof results === "string") { try { results = JSON.parse(results); } catch (_) { results = null; } }
        if (!Array.isArray(results) || results.length > 500) return res.status(400).json({ ok: false, error: "sent must be a list of {wallet, sig}" });
        const sigs = [...new Set(results.map((r) => String((r && r.sig) || "").trim()).filter((x) => SIG_RE.test(x)))];
        // Confirmed is not paid: the status said the transaction landed, not that it moved the
        // reward token to THIS wallet for THIS amount, so one unrelated confirmed signature marked
        // every row paid and the public "VERIFY ON-CHAIN" printed ✓ beside it (deep dive P1-048 /
        // P1-035). Read each transaction once and check the wallet's own token delta.
        if (typeof getTx !== "function") return res.status(503).json({ ok: false, error: "chain reads are not configured on this server — nothing recorded" });
        // adv P2-6: `sigs` is already trimmed (the `.map((r) => ... .trim())` above), and every
        // later lookup below trims its own key again before reading `txBySig` — untrimmed here
        // used to opt a row out of the journal by a stray leading space, silently keeping P0-2's
        // consumption guard from ever running on it.
        const txBySig = new Map();
        try { for (const sg of sigs) txBySig.set(sg, (await getTx(sg)) || null); }
        catch (e) { return res.status(503).json({ ok: false, error: "could not read the transactions on chain right now — nothing recorded, try again: " + publicErrMsg(e), retry: true }); }
        // The same row verification the CUNA payout runs (lib/payout-verify.verifyBatchRows), now
        // also requiring the transfer to be SOURCED from the project's funding wallet (adv P0-1)
        // and consulting the journal's global consumed set for a cross-project reuse (adv P0-2a).
        //
        // N-3 (Round 4, docs/HUB_JOURNAL_VERIFY_2026-09-18.md): this used to pass `bt.amounts` — the
        // row's FULL original amount, fixed forever — as `minRaw`, so a transfer for exactly a
        // pre-existing partial row's REMAINDER was rejected here as "transfer smaller than the
        // amount owed" before PASS 1 (which already compares against `remaining`) ever ran. Building
        // the same per-wallet remaining map PASS 1 uses (`ledger.rowState`, journal-aware) and
        // passing THAT as `amounts` makes the two checks agree. For a row with nothing journaled yet
        // (the overwhelming common case), remaining === the full amount, so this changes nothing.
        const remainingByWallet = {};
        for (const w of Object.keys(bt.amounts || {})) {
          const rs = ledger.rowState(bt, w, ledger.journalFor(hubJournal, p.id));
          if (rs) remainingByWallet[w] = rs.remainingRaw;
        }
        const vr = payoutVerify.verifyBatchRows({ results, txBySig, batches, batchId: id, mint, amounts: remainingByWallet, notBefore: bt.at, fundingWallet: p.fundingWallet, fundedBy, nowUnix: now, journal: hubJournal, projectId: p.id });
        // N1 (docs/HUB_JOURNAL_VERIFY_2026-09-18.md, Round 3): every refusal collected in this
        // branch — from the legacy check below, from PASS 1 — is gathered here instead of alerting
        // per row; ONE summary alert fires at the end of the branch (see below), never one per
        // rejected row (a single request carrying up to 500 stranger-sourced rows used to raise up
        // to 500 separate Telegram messages into the operator room).
        // `alertRefusals` feeds ONLY the one summary alert below. `pass1Refusals` feeds
        // `report.sent.ignored` too — kept separate from `alertRefusals` so a vr.rejected-sourced
        // refusal (already spread into `ignored` via `...vr.rejected` at the bottom of this branch)
        // is never reported to the CALLER twice, even though it counts once in the alert.
        const alertRefusals = [];   // { wallet, sig, why, expectedRaw?, actualRaw? }
        const pass1Refusals = [];   // same shape — PASS-1-originated only, never a vr.rejected dup
        // Round 2 #5: a row the legacy check above refuses as `transfer_not_from_funding_wallet`
        // (adv P0-1, a stranger's transfer) or as a cross-project signature reuse (adv P0-2a,
        // `payoutVerify.TRANSFER_ALREADY_CONSUMED_WHY` — Codex's original two-project attack) never
        // reaches the PASS-1 loop at all — both are fraud signals, collected here the same way.
        for (const rj of vr.rejected) {
          if (rj.why === "transfer_not_from_funding_wallet" || rj.why === payoutVerify.TRANSFER_ALREADY_CONSUMED_WHY) {
            alertRefusals.push({ wallet: rj.wallet, sig: rj.sig, why: rj.why });
          }
        }
        // PASS 1 — the journal's own verdict, BEFORE any legacy write (adv P0-2): a row the legacy
        // check above accepted can still be a settlement the journal must REFUSE.
        //
        // Round 3 #1 (docs/HUB_JOURNAL_VERIFY_2026-09-18.md): this must be ORDER-INDEPENDENT. The
        // old sequential "first row in the array wins the row" loop meant swapping the order of two
        // sigs in the SAME `&sent=` array reversed which one settled it — an oversized, unrelated
        // transfer riding first could claim the row and permanently strand the genuine one behind
        // `row_already_settled`. Fixed by grouping every accepted row by WALLET, locating each
        // candidate's on-chain transfer up front (pure — no journal writes yet), and choosing among
        // them by the row's own remaining amount, never by array position:
        //   - none of a wallet's candidates equal the remaining exactly → refuse ALL of them as
        //     `amount_mismatch` (an oversized OR undersized transfer never settles a row it does
        //     not exactly cover — see lib/hub/ledger.js settle()'s `exactOnly`);
        //   - exactly one does → it wins, whatever position it held in the request;
        //   - more than one does (a genuine duplicate-amount transfer) → the EARLIEST by slot wins,
        //     the rest are refused as `duplicate_settlement_candidate` — never "whichever came
        //     first in the array".
        // An attribution failure (settle.ATTRIBUTION_FAILURE_WHY, "could not attribute…") is NOT a
        // refusal — the transfer DID land, it just cannot be keyed into the journal (e.g. a batched
        // transaction) — so it proceeds to the legacy write exactly as it always did.
        let trialJournal = hubJournal;
        const passed = [];        // { wallet, sig, settled } — survived the fraud filter
        const refusePass1 = (row) => { alertRefusals.push(row); pass1Refusals.push(row); };
        const byWallet = new Map();
        for (const row of vr.accepted) {
          const sigTrim = String(row.sig || "").trim();
          if (!byWallet.has(row.wallet)) byWallet.set(row.wallet, []);
          byWallet.get(row.wallet).push(sigTrim);
        }
        for (const [wallet, walletSigs] of byWallet) {
          const probed = walletSigs.map((sigTrim) => {
            let located = null;
            try { located = payoutVerify.locateTransferInstruction(txBySig.get(sigTrim), { mint, wallet, fundingWallet: p.fundingWallet, fundedBy, nowUnix: now }); }
            catch (_) { located = null; }
            return { sig: sigTrim, located };
          });
          for (const c of probed) {
            if (c.located) continue;
            // Never located — attribution failure, not a fraud signal (see above).
            passed.push({ wallet, sig: c.sig, settled: { journaled: false, why: settle.ATTRIBUTION_FAILURE_WHY, journal: trialJournal, batches: { [id]: bt } } });
          }
          for (const c of probed) {
            if (!c.located || !c.located.refused) continue;
            // adv P0-1: found, but not sourced from an allowed wallet — a hard refusal, independent
            // of whatever else this wallet submitted.
            refusePass1({ wallet, sig: c.sig, why: c.located.refused });
          }
          const attributable = probed.filter((c) => c.located && !c.located.refused);
          if (!attributable.length) continue;
          const rowNow = ledger.rowState(bt, wallet, ledger.journalFor(trialJournal, p.id));
          if (!rowNow) { for (const c of attributable) refusePass1({ wallet, sig: c.sig, why: "row_not_in_batch" }); continue; }
          const remaining = BigInt(rowNow.remainingRaw);
          const matches = attributable.filter((c) => BigInt(c.located.amountRaw) === remaining);
          if (!matches.length) {
            for (const c of attributable) refusePass1({ wallet, sig: c.sig, why: "amount_mismatch", expectedRaw: remaining.toString(), actualRaw: c.located.amountRaw });
            continue;
          }
          matches.sort((a, b) => (a.located.slot || 0) - (b.located.slot || 0));
          const winner = matches[0];
          const dupSet = new Set(matches.slice(1));
          for (const c of attributable) {
            if (c === winner) continue;
            refusePass1(dupSet.has(c)
              ? { wallet, sig: c.sig, why: "duplicate_settlement_candidate" }
              : { wallet, sig: c.sig, why: "amount_mismatch", expectedRaw: remaining.toString(), actualRaw: c.located.amountRaw });
          }
          const settled = settle.settleAndPersist({ projectId: p.id, journal: trialJournal, batches: { [id]: bt }, batchId: id, wallet, sig: winner.sig, tx: txBySig.get(winner.sig), mint, nowUnix: now, fundingWallet: p.fundingWallet, fundedBy });
          if (!settled.journaled && settled.why !== settle.ATTRIBUTION_FAILURE_WHY) {
            refusePass1({ wallet, sig: winner.sig, why: settled.why, expectedRaw: settled.expectedRaw, actualRaw: settled.actualRaw });
            continue;
          }
          if (settled.journaled) trialJournal = settled.journal;
          passed.push({ wallet, sig: winner.sig, settled });
        }
        // PASS 2 — the legacy record, exactly as before, but only for rows that survived PASS 1.
        // recordSent is what actually decides which rows are NEW (r.recorded) versus a duplicate
        // report for a row already settled — adv P1-3's "stapled extra transfer" case.
        const r = pay.recordSent({ batch: bt, paid, results: passed.map((x) => ({ wallet: x.wallet, sig: x.sig })), nowUnix: now });
        // PASS 3 — journal ONLY the rows recordSent actually recorded as NEW (adv P1-3): a row
        // already fully recorded gets no second journal entry for an unrelated "extra" transfer,
        // however real that transfer is on-chain — it simply is not THIS row's payment. Per-row
        // append-only persist (crash P0-1/P1-1): each settled row lands at its OWN kv key
        // (hubStore.journalEntryKey), never as a rewrite of the whole journal blob.
        //
        // Round-2 #1 (adv P1-3, single-request variant): the guard used to be PER WALLET
        // (`r.recorded.includes(x.wallet)`) — a wallet is recorded once by the FIRST matching row
        // in `results`, so a SECOND row for the same wallet in the SAME request (a stapled extra
        // transfer, e.g. a genuine 50-token funding-wallet transfer riding beside the real 1-token
        // payment) still passed the wallet-level check and got journaled as a second settlement.
        // recordSent leaves the sig it actually recorded at `finalBatch's` predecessor
        // `r.batch.sent[wallet].sig` — comparing THAT against this row's own sig makes the guard
        // per (wallet, sig): only the one row recordSent actually landed for this wallet may ever
        // be journaled from this loop. (Belt and suspenders with the ledger.js `remaining === 0n`
        // refusal above, which closes the same hole even across separate requests.)
        let finalBatch = r.batch;
        const journalRaw = {}, journalReport = [];
        // NEW-1b (Round 5, docs/HUB_JOURNAL_VERIFY_2026-09-18.md): this used to alert once PER ROW
        // inside the loop below, with no `meta` — every alert for one project's batch shared the
        // same message-only dedupe key (the wallet is the only thing that varies, and it sits past
        // the 40-char slice for anything but a short project id), so a batched/ambiguous payout
        // covering many wallets in one signature could raise one Telegram message per row. Collect
        // them here and send exactly ONE summary after the loop, the same shape as the fraud-
        // refusal summary below, so a 500-row request can never produce more than one message per
        // (project, batch, kind).
        const unjournaledRows = [];   // { wallet, why }
        for (const x of passed) {
          const sentRow = (r.batch.sent || {})[x.wallet];
          if (!r.recorded.includes(x.wallet) || !sentRow || sentRow.sig !== x.sig) { journalReport.push({ wallet: x.wallet, sig: x.sig, journaled: false, why: "row was not newly recorded (already sent, or zero amount, or a different signature settled this row) — an unrelated transfer for it is not journaled" }); continue; }
          const { settled } = x;
          if (settled.journaled) {
            const entry = settled.journal[settled.xferKey];
            journalRaw[hubStore.journalEntryKey(settled.xferKey)] = entry;
            hubJournal = { ...hubJournal, [settled.xferKey]: entry };
            finalBatch = attempts.stampSettled(finalBatch, x.wallet, { sig: x.sig, xferKey: settled.xferKey, amountRaw: entry.appliedRaw, nowUnix: now });
          } else {
            // crash P2-3: a landed, legacy-recorded row that could not be journaled (the
            // attribution-failure case — a batched/ambiguous transaction) is worth an operator's
            // attention: it will never get a public receipt without a manual repair. NEW-1b:
            // collected, not alerted here — see the one summary alert after this loop.
            unjournaledRows.push({ wallet: x.wallet, why: settled.why });
          }
          journalReport.push({ wallet: x.wallet, sig: x.sig, journaled: settled.journaled, why: settled.why || null });
        }
        // N5 (docs/HUB_BROWSER_SIGN_VERIFY_2026-09-18.md): &sent= can complete a batch (every row
        // now legacy-sent) while a browser-signed flow for it is still `signing`/`submitted` — the
        // README claimed this never happens, and recording the last row by hand (the desk's own
        // recovery button) is exactly how it does. A batch fully paid must not pin browserSign live
        // forever (observe/sign-request would both then read `bt.state !== "pending"` with no
        // lever but the owner's clear=1); if &sent= just finished it, the flow this data belongs to
        // is done too.
        if (finalBatch.state === "sent" && browserSignIsLive(finalBatch)) {
          finalBatch = { ...finalBatch, browserSign: { ...finalBatch.browserSign, state: "settled" } };
        }
        paid = r.paid; batches = { ...batches, [id]: finalBatch };
        if (!hubStore.writeManyVerifiedMixed(kv, p.id, { batches, paid }, journalRaw)) return res.status(500).json({ ok: false, error: "recorded in memory but the volume did not take the write — STOP and check DATA_DIR before sending more" });
        // Onboarding clock (E7): the first batches[].sent write for this project, ever — the
        // mechanism that actually pays today (lib/traction.js's header explains why the journal
        // counters are separate).
        if (r.recorded.length) markMilestone(kv, p.id, "firstBatchSignedAt", now);
        // N1: ONE summary alert for every fraud refusal collected above (both the legacy-check's
        // and PASS 1's), never one per row — counted per `why`, first three wallets named, the
        // rest counted. `ignored` below still reports every refusal individually to the CALLER —
        // this only changes what the operator-room ALERT looks like.
        if (alertRefusals.length) {
          const counts = {};
          for (const fr of alertRefusals) counts[fr.why] = (counts[fr.why] || 0) + 1;
          const whyList = Object.entries(counts).map(([why, n]) => `${why} x${n}`).join(", ");
          const wallets = alertRefusals.slice(0, 3).map((fr) => String(fr.wallet || "").slice(0, 6) + "…").join(", ");
          const more = alertRefusals.length > 3 ? `, +${alertRefusals.length - 3} more` : "";
          // N-1 (Round 4): meta lets the caller's alert() build a stable per-(project,batch,kind)
          // dedupe key (lib/hub/alert-key.js) instead of hashing a 40-char slice of this text,
          // which collapsed distinct batches once the project id ran past ~19 characters.
          try { alert(`${p.id}: batch ${id} — ${alertRefusals.length} settlement REFUSED (not recorded): ${whyList} — wallets ${wallets}${more}`, { projectId: p.id, batchId: id, kind: "sent" }); } catch (_) {}
        }
        // NEW-1b (Round 5): same treatment for the attribution-failure case — a row that DID land
        // and DID get recorded sent, but could not be journaled (a batched/ambiguous transaction).
        // A distinct `kind` ("sent-unjournaled") keeps this from ever sharing a dedupe key with the
        // fraud-refusal summary above, even on the same batch in the same request.
        if (unjournaledRows.length) {
          const counts = {};
          for (const ur of unjournaledRows) counts[ur.why] = (counts[ur.why] || 0) + 1;
          const whyList = Object.entries(counts).map(([why, n]) => `${why} x${n}`).join(", ");
          const wallets = unjournaledRows.slice(0, 3).map((ur) => String(ur.wallet || "").slice(0, 6) + "…").join(", ");
          const more = unjournaledRows.length > 3 ? `, +${unjournaledRows.length - 3} more` : "";
          try { alert(`${p.id}: batch ${id} — ${unjournaledRows.length} row(s) recorded sent but not journaled: ${whyList} — wallets ${wallets}${more}`, { projectId: p.id, batchId: id, kind: "sent-unjournaled" }); } catch (_) {}
        }
        report.sent = { recorded: r.recorded, ignored: [...r.ignored, ...vr.rejected, ...pass1Refusals], remaining: Object.keys(r.remaining).length, state: finalBatch.state, journal: journalReport };
      }
      if (b.confirm) {
        const id = String(b.confirm); const bt0 = batchOf(id);
        // P2-7 (docs/HUB_BROWSER_SIGN_VERIFY_2026-09-18.md): the same guard F2 gave &cancel= — a
        // manual "mark it all paid, sig:null" while a browser-signed flow might already have a
        // real, unobserved broadcast for this batch would settle rows a later observe() can never
        // journal (the signature was never reported), and permanently pins browserSign live (the
        // batch is no longer `pending`, so both sign-request and observe refuse it — no lever but
        // the owner's clear=1 to get out, and clear=1 does not un-confirm the rows).
        if (browserSignIsLive(bt0)) return res.status(409).json({ ok: false, error: `a browser-signed payout is ${bt0.browserSign.state} for this batch — resolve it with sign-request/observe (or ask the owner to clear it) before confirming` });
        const r = pay.confirmBatch({ batch: bt0, paid, nowUnix: now });
        paid = r.paid; batches = { ...batches, [id]: { ...r.batch, confirmedAt: now, note: String(b.note || "").slice(0, 200) } };
        if (!saveMoney()) return res.status(500).json({ ok: false, error: "confirm did not persist — check DATA_DIR" });
        report.confirmed = id;
      }
      if (b.cancel) {
        const id = String(b.cancel); const bt0 = batchOf(id);
        // F2 (docs/HUB_BROWSER_SIGN_VERIFY_2026-09-18.md): a batch mid browser-signed flow must
        // never be cancelled — cancelBatch returns any row with NO settlement to `available`, and a
        // browser-sign wallet the operator already broadcast for (but has not yet observed) has no
        // settlement on file yet. Re-exporting after a bare cancel would draw the SAME amount into
        // a brand-new batch while the original transfer is still real, on chain, and about to be
        // observed into the batch this just cancelled — a double payment neither side's bookkeeping
        // would ever flag on its own. Same check the managed payer (`&send=`) already uses.
        if (browserSignIsLive(bt0)) return res.status(409).json({ ok: false, error: `a browser-signed payout is ${bt0.browserSign.state} for this batch — resolve it with sign-request/observe (or ask the owner to clear it) before cancelling` });
        batches = { ...batches, [id]: { ...pay.cancelBatch({ batch: bt0 }), cancelledAt: now } };
        if (!hubStore.writeVerified(kv, p.id, "batches", batches)) return res.status(500).json({ ok: false, error: "cancel did not persist — check DATA_DIR" });
        report.cancelled = id;
      }
      if (b.void) {
        const id = String(b.batch || ""); const wallet = String(b.void);
        // crash P1-2 (docs/HUB_JOURNAL_VERIFY_2026-09-18.md): the journal has no "unconsume"
        // (lib/hub/ledger.js: "There is no unconsume") — voiding a row the journal already holds an
        // event for used to leave the two witnesses disagreeing forever, with no operator remedy
        // (owedNow reads 0 via the journal while the legacy side reopens the row for a re-send —
        // real money could go out twice). Refuse the void outright and name the xferKey: the chain
        // says the transfer landed, so "it never went" is not a fact this route can assert.
        const journaledEntry = Object.values(hubJournal).find((e) => e && e.projectId === p.id && e.batchId === id && e.wallet === wallet);
        if (journaledEntry) {
          report.void = { ok: false, error: "a settled transfer is on the settlement journal for this row — it cannot be voided (the chain says it landed)", xferKey: journaledEntry.xferKey };
        } else {
          const v = pay.voidSent({ batch: batchOf(id), paid, wallet, sig: String(b.sig || ""), nowUnix: now });
          report.void = v;
          if (v.ok) { paid = v.paid; batches = { ...batches, [id]: v.batch }; if (!saveMoney()) return res.status(500).json({ ok: false, error: "void did not persist — check DATA_DIR" }); }
        }
      }
      if (b.waive) {
        // N-3 (Round 4, docs/HUB_JOURNAL_VERIFY_2026-09-18.md): the documented owner remedy for a
        // partial row (lib/hub/ledger.js waiveRemainder — "still owed, the next batch draws it") was
        // wired to no route at all. Owner-only (checked above, before `mutating` is even acquired):
        // an operator can record what actually landed on chain (&sent=), but writing off money the
        // project never sent is the owner's call.
        const id = String(b.batch || ""); const wallet = String(b.waive);
        const reason = String(b.reason || "").replace(/[\r\n]+/g, " ").trim().slice(0, 200);
        try {
          const bt0 = batchOf(id);
          // ledger.waiveRemainder reads `batch.projectId` (it was written for lib/hub/ledger.js's
          // OWN buildBatch, which stamps it) to filter the global journal down to this project's
          // entries. The live route's batches are built by lib/cuna-payout.js buildBatch instead,
          // which carries no `projectId` at all — merge it in for this call only; never let it leak
          // into what actually gets persisted below (bt0's own shape is untouched).
          const result = ledger.waiveRemainder({ batch: { ...bt0, projectId: p.id }, journal: hubJournal, wallet, by: "owner", nowUnix: now, reason });
          const waived = result.waived[wallet];
          const bt2 = { ...bt0, waived: result.waived };
          // Minor (Round 5, docs/HUB_JOURNAL_VERIFY_2026-09-18.md): compute the NEXT `batches`
          // locally and only assign it to the outer, request-scoped `batches` variable once the
          // persist below actually succeeds. Writing the outer variable first (as this used to)
          // left it holding an un-persisted waive on a throwing kv — a later branch in the SAME
          // request (e.g. `&sweep=`) that calls `saveMoney()`/writes `batches` again would then
          // persist that waive anyway, even though this branch itself reported `ok:false`.
          const nextBatches = { ...batches, [id]: bt2 };
          // Journaled as its OWN entry kind, under a prefix distinct from the settlement journal's
          // (`hub:settle:` — lib/hub/store.js JOURNAL_PREFIX) so hubStore.readJournal's shape check
          // (looksLikeJournalEntry) never mistakes it for a settled transfer: this is a paper trail
          // for the amount NOT collected, never something owedNow or a receipt should sum as paid.
          const waiveEntryKey = `hub:waive:${p.id}:${id}:${wallet}`;
          const waiveEntry = { kind: "waive", projectId: p.id, batchId: id, wallet, amountRaw: waived.amountRaw, by: "owner", at: now, reason };
          if (!hubStore.writeManyVerifiedMixed(kv, p.id, { batches: nextBatches }, { [waiveEntryKey]: waiveEntry })) {
            return res.status(500).json({ ok: false, error: "waive did not persist — check DATA_DIR" });
          }
          batches = nextBatches;
          report.waive = { ok: true, wallet, batchId: id, amountRaw: waived.amountRaw, reason };
        } catch (e) { report.waive = { ok: false, error: publicErrMsg(e) }; }
      }
      if (on(b.sweep)) {
        const id = String(b.batch || ""); const bt = batchOf(id);
        const rows = Object.entries(bt.sent || {}).filter(([, s]) => s && s.pending && s.sig).map(([wallet, s]) => ({ wallet, sig: s.sig }));
        if (!rows.length) report.sweep = { ok: true, checked: 0 };
        else {
          const st = await connection().getSignatureStatuses(rows.map((x) => x.sig), { searchTransactionHistory: true });
          const vals = (st && st.value) || [];
          const rs = pay.resolveSent({ batch: bt, paid, rows: rows.map((x, i) => ({ ...x, status: vals[i] || null })), nowUnix: now });
          paid = rs.paid; let bt2 = rs.batch;
          // W3: a row a sweep just confirmed (#313's rule — "not found" never voids, only a
          // definitive on-chain confirmation or error does) is exactly the "landed after
          // confirmation" moment for a managed- or self-signed row still pending from an earlier
          // request — settle its journal the same way &sent=/&send= do, in the SAME persist.
          const journalReport = [], journalRaw = {};
          // N4 (docs/HUB_JOURNAL_VERIFY_2026-09-18.md, Round 3): Round 2 #4 allowed EVERY vault
          // project's operator wallet here, reasoning that &sweep= has no `from=` to say which one
          // signed a given row — but that widened the allowlist project-wide rather than pinning it
          // to the ONE vault this project is actually paid from. `vaultProject` (owner-set via
          // /api/hub-registry, carried forward like payoutSources) names that one vault; a project
          // that never set it gets no vault-operator addition at all here — sweep then allows only
          // the funding wallet + payoutSources, the same set &sent= would (never every vault
          // operator, never a holder- or operator-supplied wallet).
          const fundedByForSweep = p.vaultProject ? [...fundedBy, ...([vaultOperatorPubkey(p.vaultProject)].filter(Boolean))] : [...fundedBy];
          // N1: collected, not alerted per row — one summary fires after the loop.
          const sweepIssues = [];   // { wallet, why, refused: bool }
          if (typeof getTx === "function" && rs.confirmed && rs.confirmed.length) {
            let curJournal = hubJournal;
            for (const row of rs.confirmed) {
              const sigTrim = String(row.sig || "").trim();
              let tx = null; try { tx = await getTx(sigTrim); } catch (_) { tx = null; }
              const settled = settle.settleAndPersist({ projectId: p.id, journal: curJournal, batches: { [id]: bt2 }, batchId: id, wallet: row.wallet, sig: sigTrim, tx, mint, nowUnix: now, fundingWallet: p.fundingWallet, fundedBy: fundedByForSweep });
              if (settled.journaled) {
                curJournal = settled.journal; bt2 = settled.batches[id];
                journalRaw[hubStore.journalEntryKey(settled.xferKey)] = curJournal[settled.xferKey];
              } else if (settled.why !== settle.ATTRIBUTION_FAILURE_WHY) {
                // A row WE ourselves already recorded confirmed (this is our own broadcast, not
                // holder-supplied input) but the journal refuses it — surfaced, never silently
                // dropped; the legacy confirmed state is left exactly as resolveSent set it above.
                sweepIssues.push({ wallet: row.wallet, why: settled.why, refused: true });
              } else {
                sweepIssues.push({ wallet: row.wallet, why: settled.why, refused: false });
              }
              journalReport.push({ wallet: row.wallet, sig: row.sig, journaled: settled.journaled, why: settled.why || null });
            }
            hubJournal = curJournal;
          }
          if (sweepIssues.length) {
            const refusedN = sweepIssues.filter((x) => x.refused).length, attrN = sweepIssues.length - refusedN;
            const parts = [];
            if (refusedN) parts.push(`${refusedN} confirmed by sweep but journal refused it`);
            if (attrN) parts.push(`${attrN} confirmed by sweep but not journaled (attribution)`);
            const wallets = sweepIssues.slice(0, 3).map((x) => String(x.wallet || "").slice(0, 6) + "…").join(", ");
            const more = sweepIssues.length > 3 ? `, +${sweepIssues.length - 3} more` : "";
            try { alert(`${p.id}: batch ${id} sweep — ${parts.join("; ")} — wallets ${wallets}${more}`, { projectId: p.id, batchId: id, kind: "sweep" }); } catch (_) {}
          }
          batches = { ...batches, [id]: bt2 };
          if (!hubStore.writeManyVerifiedMixed(kv, p.id, { batches, paid }, journalRaw)) return res.status(500).json({ ok: false, error: "sweep did not persist — check DATA_DIR" });
          report.sweep = { ok: true, checked: rows.length, confirmed: rs.confirmed, voided: rs.voided, stillPending: rs.stillPending, journal: journalReport };
        }
      }
      if (b.send) {
        // MANAGED payer: a vault project whose operator key Railway holds. Self-sign projects
        // export and sign in their own wallet instead — this path is never the default.
        const id = String(b.send); const bt = batchOf(id);
        // X6/CC5: a batch with a LIVE browser-signed flow (signing = the operator has not yet
        // broadcast; submitted = broadcast but not yet fully observed) must never also be payable
        // by the managed payer — the belt on top of the shared `hublock:<id>:payout` these two
        // flows already contend for (see the sign-request/observe routes below): this check still
        // fires even once that lock has been released between an operator's sign-request response
        // and their observe call, which is exactly the window a lock alone cannot cover.
        if (browserSignIsLive(bt)) return res.status(409).json({ ok: false, error: `a browser-signed payout is ${bt.browserSign.state} for this batch — resolve it with sign-request/observe (or let it fail) before using the managed payer` });
        if (bt.state !== "pending") return res.status(400).json({ ok: false, error: `batch is ${bt.state}, not pending` });
        const from = String(b.from || "");
        if (!from) return res.status(400).json({ ok: false, error: "from=<vault project> names the managed payer — or export the batch and sign it in the project's wallet" });
        const recipients = Object.entries(pay.remainingOf(bt)).map(([wallet, raw]) => ({ wallet, amountUi: Number(pub.rawToUi(raw, dec)), amountRaw: String(raw) }));
        if (!recipients.length) report.send = { action: "none", reason: "every row in this batch is already recorded as sent" };
        else {
          const run = on(b.run);
          const totalUi = recipients.reduce((t, r) => t + r.amountUi, 0), perMax = recipients.reduce((m, r) => Math.max(m, r.amountUi), 0);
          const onPaid = (row) => {
            const sentAt = Math.floor(Date.now() / 1000);
            const r = pay.recordSent({ batch: batches[id], paid, results: [{ wallet: row.wallet, sig: row.sig, pending: !!row.pending }], nowUnix: sentAt });
            paid = r.paid;
            let bt2 = r.batch;
            // W3 attempt stamp (Addendum B1 / design §4): the vault has signed and is about to
            // broadcast (lib/whirlpool-vault.js prepareOne/runPayoutLoop calls onPaid with
            // {pending:true} in exactly this "journal before broadcast" moment) — the signature is
            // known before anything is sent, matching the design's invariant. The settlement
            // journal entry itself needs a verified on-chain transfer, which does not exist yet at
            // this synchronous callback (onPaid is called without await by the vault's own loop),
            // so it is written once the row lands — see the getTx pass right after this call
            // returns, below.
            if (row.pending) bt2 = attempts.stampSubmitted(bt2, row.wallet, { sig: row.sig, amountRaw: (batches[id].amounts || {})[row.wallet], nowUnix: sentAt });
            batches = { ...batches, [id]: bt2 };
            if (!saveMoney()) throw new Error("payout journal did not reach the volume — STOP; do not export another batch until this one is reconciled");
            // Onboarding clock (E7): same choke point as the &sent= branch above, for the managed payer.
            if (r.recorded.length) markMilestone(kv, p.id, "firstBatchSignedAt", sentAt);
          };
          const lock = run ? bp.lockAcquire(kv, `hublock:${p.id}:${id}`) : { ok: true, token: null };
          if (!lock.ok) return res.status(409).json({ ok: false, error: "payout_in_flight", lock });
          let r;
          try { r = await vault.payoutSpl({ projectId: from, mintAddr: mint, recipients, perRecipientMaxUi: perMax, totalMaxUi: totalUi, dryRun: !run, onPaid }); }
          finally { if (lock.token) bp.lockRelease(kv, lock.token); }
          report.send = { ...r, batch: id, payer: from, ran: run, caps: { perRecipientMaxUi: perMax, totalMaxUi: totalUi } };
          if (run) console.log(`[hub-payout] ${p.id} batch ${id} SERVER-SENT from ${from}: ${r.action} — paid ${(r.paid || []).length}, pending ${(r.pending || []).length}, failed ${(r.failed || []).length}`);
          // W3 dual-write, part 2: every row the vault itself confirmed landed (r.paid) — verify the
          // specific transfer and settle the journal, in ONE further persist alongside the attempt's
          // "settled" stamp. onPaid above already wrote the legacy sent/paid row for each of these
          // (it happens before this loop runs); this only adds the journal on top, never re-records
          // the legacy side. A row still pending (confirm timed out — r.pending) or failed keeps its
          // "submitted"/absent attempt state; #313's rule ("not found" never voids) means it is
          // reconciled later, by &sweep=, never guessed here.
          if (typeof getTx === "function" && Array.isArray(r.paid) && r.paid.length) {
            let curBatches = batches, curJournal = hubJournal;
            const journalReport = [], journalRaw = {};
            // Round 2 #4: &send= names the vault project explicitly (`from=`) — only THAT
            // project's own operator wallet is an allowed source for settlements landed by this
            // broadcast. Our own signature, already trusted; never a holder-supplied wallet.
            const fundedByForSend = [...fundedBy, ...([vaultOperatorPubkey(from)].filter(Boolean))];
            // N1: collected, not alerted per row — one summary fires after the loop.
            const sendIssues = [];   // { wallet, why, refused: bool }
            for (const row of r.paid) {
              const sigTrim = String(row.sig || "").trim();
              let tx = null; try { tx = await getTx(sigTrim); } catch (_) { tx = null; }
              const settled = settle.settleAndPersist({ projectId: p.id, journal: curJournal, batches: curBatches, batchId: id, wallet: row.wallet, sig: sigTrim, tx, mint, nowUnix: now, fundingWallet: p.fundingWallet, fundedBy: fundedByForSend });
              if (settled.journaled) {
                curJournal = settled.journal; curBatches = settled.batches;
                journalRaw[hubStore.journalEntryKey(settled.xferKey)] = curJournal[settled.xferKey];
              } else if (settled.why === settle.ATTRIBUTION_FAILURE_WHY) {
                // crash P2-3: this landed row will never get a public receipt without a manual repair.
                sendIssues.push({ wallet: row.wallet, why: settled.why, refused: false });
              } else {
                // Our own broadcast, journal refused it anyway (should not happen — surfaced, not swallowed).
                sendIssues.push({ wallet: row.wallet, why: settled.why, refused: true });
              }
              journalReport.push({ wallet: row.wallet, sig: row.sig, journaled: settled.journaled, why: settled.why || null });
            }
            if (sendIssues.length) {
              const refusedN = sendIssues.filter((x) => x.refused).length, attrN = sendIssues.length - refusedN;
              const parts = [];
              if (refusedN) parts.push(`${refusedN} paid but journal refused it`);
              if (attrN) parts.push(`${attrN} paid but not journaled (attribution)`);
              const wallets = sendIssues.slice(0, 3).map((x) => String(x.wallet || "").slice(0, 6) + "…").join(", ");
              const more = sendIssues.length > 3 ? `, +${sendIssues.length - 3} more` : "";
              try { alert(`${p.id}: batch ${id} send — ${parts.join("; ")} — wallets ${wallets}${more}`, { projectId: p.id, batchId: id, kind: "send" }); } catch (_) {}
            }
            if (hubStore.writeManyVerifiedMixed(kv, p.id, { batches: curBatches }, journalRaw)) { batches = curBatches; hubJournal = curJournal; }
            else { try { alert(`${p.id}: batch ${id} paid on-chain but the settlement journal did not persist — check DATA_DIR; the legacy paid/sent record is intact`); } catch (_) {} }
            report.send = { ...report.send, journal: journalReport };
          }
        }
      }

      const owed = pay.owedNow({ days, paid, pending: batches, journal: hubJournal, projectId: p.id });
      let created = null, note = null;
      if (on(b.export)) {
        const id = "hb_" + randomBytes(5).toString("hex");
        const batch = pay.buildBatch({ owed, batchId: id, nowUnix: now, minPayoutRaw: b.minPayoutRaw != null ? b.minPayoutRaw : 0 });
        if (!batch.count) note = "nothing to pay right now — everything owed is either below the floor or already in a pending batch";
        else {
          batches = { ...batches, [id]: batch };
          if (!hubStore.writeVerified(kv, p.id, "batches", batches)) return res.status(500).json({ ok: false, error: "batch write did not persist — check DATA_DIR" });
          created = { ...batch, airdropLines: pay.toAirdropLines(batch.amounts, dec), mint };
          console.log(`[hub-payout] ${p.id} batch ${id} created — ${batch.count} wallets, ${pub.rawToUi(batch.totalRaw, dec)} ${p.symbol} PENDING`);
        }
      }
      let totalPaid = 0n; for (const v of Object.values(paid)) { try { totalPaid += BigInt(v); } catch (_) {} }
      const pending = Object.values(batches).filter((x) => x && x.state === "pending");
      return res.status(200).json({
        ok: true, project: publicProject(p), mint, decimals: dec,
        owed: fmtOwed(owed, dec), owedTotalRaw: Object.values(owed).reduce((a, v) => a + v, 0n).toString(),
        totalPaidRaw: totalPaid.toString(), created, note,
        previewLines: created ? null : pay.toAirdropLines(pay.buildBatch({ owed, batchId: "preview", nowUnix: now }).amounts, dec),
        pendingBatches: pending.map((x) => ({ id: x.id, at: x.at, count: x.count, totalRaw: x.totalRaw, remaining: Object.keys(pay.remainingOf(x)).length })),
        batch: b.batch && batches[String(b.batch)] ? deskBatch(batches[String(b.batch)], dec) : null,
        as: who,
        ...report,
      });
    } catch (e) {
      // crash P2-4 (docs/HUB_JOURNAL_VERIFY_2026-09-18.md): a THROW out of a mutating request (as
      // opposed to a graceful `false` from writeManyVerifiedMixed, which already alerts at its own
      // call site) used to answer a generic 400 with no alert at all — the one path that could
      // leave money in flight without anyone being told to look.
      if (mutating) { try { alert(`${p.id}: payout request threw — ${publicErrMsg(e)}`); } catch (_) {} }
      return res.status(400).json({ ok: false, error: publicErrMsg(e) });
    } finally {
      if (payoutLock.token) hubStore.lockRelease(kv, payoutLockKey, payoutLock.token);
    }
  });

  // ── browser-signed batch payout (Colosseum roadmap X6/CC5, design §4) ──────────────────────────
  // A second way to pay a batch, alongside the self-signed `&sent=` report and the managed payer
  // (`&send=`) above: the OPERATOR's own connected wallet signs and broadcasts — never the server,
  // which holds no key that could (CLAUDE.md: the connected wallet signs first, no other signer
  // here). Two steps, the same build/observe discipline as lib/hub/commit.js's on-chain
  // commitment, applied to money:
  //
  //   POST .../batch/:batchId/sign-request — for the batch's still-owed rows, returns the transfer
  //     PARAMETERS (mint, destination ATA, raw amount, decimals, the funding wallet as payer) the
  //     browser needs to build the SAME instructions public/airdrop-engine.js already knows how to
  //     (splToken.createTransferCheckedInstruction / createAssociatedTokenAccountIdempotentInstruction)
  //     — never a signed transaction, never a key, and never SystemProgram.transfer()/toBufferLE
  //     (CLAUDE.md — no Buffer polyfill in a browser page). The batch's browserSign moves
  //     pending -> signing in one persist and refuses the managed payer for as long as it stays
  //     live (browserSignIsLive above; the /payout route's &send= branch checks it).
  //
  //   POST .../batch/:batchId/observe — the operator hands back the signature(s) they broadcast.
  //     Each is read straight off the chain (getTransaction) and settled through the EXACT same
  //     lib/hub/settle.js settleAndPersist() + lib/cuna-payout.js recordSent() pipeline the
  //     self-signed `&sent=` branch above uses — same settlement journal, same idempotency key
  //     (`settle:<sig>:<instructionIndex>[:<innerIndex>]`, lib/hub/ledger.js xferKeyOf), same
  //     funding-wallet-sourced check (adv P0-1), same cross-project consumed-set check (adv P0-2a).
  //     A signature that verifies nothing, or verifies a different amount, settles NOTHING for
  //     that row — reported back as a failure, never recorded paid. Observing the same signature
  //     twice is exactly as idempotent as reporting it to `&sent=` twice (ledger.settle's own
  //     already-consumed check).
  //
  // State lives on the batch as `batch.browserSign` — never on `batch.state`, which keeps the
  // existing pending/sent/cancelled/closed vocabulary every other route already reads.
  app.all("/api/hub/:project/batch/:batchId/sign-request", limited("hubheavy", { windowMs: 60000, max: 30 }), async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "POST") return mutatingOnGet(res);
    if (isDirect(req)) return notFound(res);
    const p = projectOf(req);
    if (!p) return adminAuthOK(req) ? notFound(res, "no such project") : notFound(res);
    const who = authOf(req, p);
    if (!who) return notFound(res);
    const b = body(req);
    const batchId = String(req.params.batchId || "");

    // N6 (docs/HUB_BROWSER_SIGN_VERIFY_2026-09-18.md): the dry-run refusal now runs before EVERY
    // branch on this route, including clear=1 — a demo fixture has nothing real behind it to
    // clear, sign for, or observe (W3, Colosseum E10; same wording the /payout route uses).
    if (p.dryRun) return res.status(409).json(dryRunSignRefusal(p));

    // F4 (docs/HUB_BROWSER_SIGN_VERIFY_2026-09-18.md): an owner-only reset. `submitted` used to be a
    // dead end — no route could clear it once a signature landed unattributable or a confirm was
    // still lagging (P1-4/P1-5 below), and the ONLY other escape was &cancel=, which is itself a
    // double-pay path (F2) since a browserSign.wallets entry the browser already broadcast for is
    // never legacy-`sent` and so returns to `available` on a cancel. This clears `browserSign`
    // WITHOUT touching amounts, the legacy sent/paid rows or the journal — nothing here can ever
    // "un-journal" a real settlement, it only forgets the in-flight sign-request bookkeeping so a
    // fresh sign-request (or the managed payer) can be tried again. Owner-only because it is a
    // judgment call about a batch an operator's own wallet may have broadcast for.
    if (on(b.clear)) {
      if (who !== "owner") return res.status(403).json({ ok: false, error: "clearing a browser-signed payout's state is owner-only" });
      const payoutLockKey = `hublock:${p.id}:payout`;
      const lock = hubStore.lockAcquire(kv, payoutLockKey);
      if (!lock.ok) return res.status(409).json({ ok: false, error: "busy", detail: "another payout request for this project is in flight — wait a moment and retry", lock });
      try {
        const now = nowUnix();
        const batches = hubStore.read(kv, p.id, "batches", {}) || {};
        const bt = batches[batchId];
        if (!bt) return res.status(404).json({ ok: false, error: "no such batch (pass the batch id in the URL)" });
        if (!bt.browserSign) return res.status(200).json({ ok: true, cleared: false, batchId, note: "no browser-signed flow was in progress for this batch" });
        // N1 (docs/HUB_BROWSER_SIGN_VERIFY_2026-09-18.md): clear=1 is exactly the lever that used to
        // silently re-open F2's cancel guard — a wallet this sign-request handed out that the
        // operator may already have broadcast for, but never observed, is neither legacy-`sent` nor
        // journaled, so `&cancel=` (unblocked the instant browserSign is gone) returns it straight
        // to `available` while the real transfer is still on chain — a fresh export then draws the
        // SAME amount again. Compute that at-risk set and refuse unless explicitly acknowledged.
        const hubJournal = hubStore.readJournal(kv) || {};
        const entries = ledger.journalFor(hubJournal, p.id);
        const bsWallets = bt.browserSign.wallets || [];
        const atRisk = bsWallets.filter((w) => {
          if (bt.sent && bt.sent[w]) return false;   // legacy-recorded — safe, &cancel= cannot re-open it
          const rs = ledger.rowState(bt, w, entries);
          return rs && rs.remainingRaw !== "0";      // journaled/waived to zero is also safe
        });
        const observedSigs = bt.browserSign.observedSigs || [];
        const failed = bt.browserSign.failed || {};
        const nonce = bt.browserSign.nonce;
        console.log(`[hub-payout] ${p.id} batch ${batchId} browserSign clear requested by owner — ${atRisk.length} at-risk wallet(s), ${observedSigs.length} signature(s) already observed`);
        if (atRisk.length && b.confirm !== "abandon-broadcast") {
          return res.status(409).json({
            ok: false,
            error: `${atRisk.length} wallet(s) this sign-request handed out may already have a real, unobserved broadcast on chain for the full row amount — clearing now and re-exporting would draw the SAME amount again. Observe their signatures first, or pass &confirm=abandon-broadcast if you have verified none of these actually landed.`,
            batchId, atRisk, observedSigs, failed, nonce,
          });
        }
        // P2-6 (docs/HUB_BROWSER_SIGN_VERIFY_2026-09-18.md): keep the record instead of erasing it.
        // `cleared` is a terminal, non-live state (browserSignIsLive only matches signing/submitted)
        // so every other route treats it exactly like `null` did, but the owner — and a later
        // force=1 re-request, which carries `observedSigs` forward — can still see exactly what this
        // flow handed out and observed before it was cleared.
        const clearedBrowserSign = { state: "cleared", clearedAt: now, nonce, observedSigs, wallets: bsWallets, failed };
        const nextBatches = { ...batches, [batchId]: { ...bt, browserSign: clearedBrowserSign } };
        if (!hubStore.writeVerified(kv, p.id, "batches", nextBatches)) return res.status(500).json({ ok: false, error: "clear did not persist — check DATA_DIR" });
        console.log(`[hub-payout] ${p.id} batch ${batchId} browserSign RESET by owner`);
        return res.status(200).json({ ok: true, cleared: true, batchId, atRisk, observedSigs, failed, nonce });
      } catch (e) { return res.status(400).json({ ok: false, error: publicErrMsg(e) }); }
      finally { if (lock.token) hubStore.lockRelease(kv, payoutLockKey, lock.token); }
    }

    const payoutLockKey = `hublock:${p.id}:payout`;
    const lock = hubStore.lockAcquire(kv, payoutLockKey);
    if (!lock.ok) return res.status(409).json({ ok: false, error: "busy", detail: "another payout request for this project is in flight — wait a moment and retry", lock });
    try {
      const now = nowUnix();
      const batches = hubStore.read(kv, p.id, "batches", {}) || {};
      const bt = batches[batchId];
      if (!bt) return res.status(404).json({ ok: false, error: "no such batch (pass the batch id in the URL)" });
      // P2-5 (docs/HUB_BROWSER_SIGN_VERIFY_2026-09-18.md): F1 only stops the BROWSER from
      // broadcasting for the wrong wallet — this route would otherwise hand real transfer
      // PARAMETERS to any authenticated operator, including one whose own wallet is not an
      // allowed settlement source. That operator could broadcast from it anyway, and `observe`
      // would permanently deadlock the batch (F4) behind an unattributable transfer. Only the
      // owner, the funding wallet itself, or an allowlisted payout source may even ask.
      if (who !== "owner" && who !== p.fundingWallet && !(Array.isArray(p.payoutSources) && p.payoutSources.includes(who))) {
        return res.status(403).json({ ok: false, error: `only the project's funding wallet (${p.fundingWallet}) — or an allowlisted payout source — may request transfer instructions to sign` });
      }
      if (bt.state !== "pending") return res.status(400).json({ ok: false, error: `batch is ${bt.state}, not pending` });
      // F3 (docs/HUB_BROWSER_SIGN_VERIFY_2026-09-18.md): `signing` means the operator has not yet
      // reported broadcasting anything back — exactly the state where a real broadcast may ALREADY
      // exist unobserved (a lost tab, a slow wallet). Re-issuing silently (the old behaviour) risks a
      // second real broadcast for the same rows; refuse it by default and require an explicit
      // `force=1` acknowledging that risk (e.g. after confirming nothing was actually signed).
      if (bt.browserSign && bt.browserSign.state === "signing" && !on(b.force)) {
        return res.status(409).json({ ok: false, error: "a browser-signed payout for this batch is already SIGNING — observe the signatures you already broadcast first, or pass force=1 to abandon it and request a fresh one (only if you know nothing was actually signed)", browserSign: { state: bt.browserSign.state, nonce: bt.browserSign.nonce } });
      }
      // F4: `submitted` means at least one signature WAS broadcast and observed — there is no
      // blockhash tracked here to "lapse" (the old wording claimed one); the only ways out are
      // observing more signatures, or the owner-only reset above.
      if (bt.browserSign && bt.browserSign.state === "submitted") {
        return res.status(409).json({ ok: false, error: "a browser-signed payout for this batch was already broadcast and is still being observed — observe it, or ask the owner to clear it (sign-request?clear=1), before requesting a new one", browserSign: { state: bt.browserSign.state, nonce: bt.browserSign.nonce } });
      }
      const hubJournal = hubStore.readJournal(kv) || {};
      const entries = ledger.journalFor(hubJournal, p.id);
      const dec = Number.isInteger(p.rewardDecimals) ? p.rewardDecimals : (Number.isInteger(p.decimals) ? p.decimals : 9);
      const mint = p.rewardMint || p.mint;
      const tokenProgram = p.rewardTokenProgram || p.tokenProgram || "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
      // crash P0-1 (lens 1, docs/HUB_BROWSER_SIGN_VERIFY_2026-09-18.md): every OTHER payer path
      // (`&send=`, the desk's own remainingCount) selects rows through `pay.remainingOf(bt)`, which
      // honours the legacy `batch.sent[wallet]` flag; this used to select from the journal alone, so
      // a row the managed payer already broadcast (onPaid stamps `sent` before it ever journals —
      // routes.js's &send= branch above) was offered again here. A wallet already legacy-`sent` is
      // never re-offered, no matter what the journal says about it yet.
      const remaining = pay.remainingOf(bt);
      const rows = [];
      for (const wallet of Object.keys(bt.amounts || {}).sort()) {
        if (!(wallet in remaining)) { rows.push({ wallet, ok: false, error: "already recorded as sent — awaiting confirmation, not offered again" }); continue; }
        const rs = ledger.rowState(bt, wallet, entries);
        if (!rs) continue;
        // N8 (docs/HUB_BROWSER_SIGN_VERIFY_2026-09-18.md): a row settled to zero (paid or waived)
        // used to just `continue`, vanishing from BOTH `rows` and `skipped` — the P0-1 fix's own
        // promise that every named wallet is accounted for became incomplete again for this case.
        if (rs.remainingRaw === "0") { rows.push({ wallet, ok: false, error: "nothing remaining on this row" }); continue; }
        const destination = solAddr.deriveAta(wallet, mint, tokenProgram);
        if (!destination) { rows.push({ wallet, ok: false, error: "could not derive a token account for this wallet" }); continue; }
        rows.push({ wallet, ok: true, source: p.fundingWallet, destination, amountRaw: rs.remainingRaw });
      }
      const signable = rows.filter((r) => r.ok);
      if (!signable.length) return res.status(400).json({ ok: false, error: "nothing remaining on this batch — every row is already paid, waived, or awaiting confirmation", rows });
      const nonce = randomBytes(12).toString("hex");
      // The idempotency key for THIS sign-request generation — distinct from (and never a
      // substitute for) the settlement journal's own per-transfer xferKey, which cannot exist
      // until a transfer is actually signed and broadcast. `nonce` is REQUIRED on observe() (below)
      // — it ties an observe() call back to the exact set of rows/amounts THIS sign-request handed
      // out, so a stale or superseded sign-request (a force=1 re-request, or an owner clear) can
      // never be conflated with a fresh one on the same batch.
      const idempotencyKey = `hub:signreq:${p.id}:${batchId}:${nonce}`;
      // P3-10: freeze every settlement-relevant parameter onto the batch, not just mint — observe()
      // reads fundingWallet/payoutSources from HERE, never the live project record, so an owner edit
      // to either between sign-request and observe can never silently change which source wallet an
      // already-broadcast transfer is checked against.
      const browserSign = {
        nonce, idempotencyKey, state: "signing", requestedAt: now,
        mint, decimals: dec, tokenProgram, fundingWallet: p.fundingWallet,
        payoutSources: Array.isArray(p.payoutSources) ? [...p.payoutSources] : [],
        wallets: signable.map((r) => r.wallet), failed: (bt.browserSign && bt.browserSign.failed) || {},
        // P2-6: a force=1 re-request (or one issued right after a clear=1) carries the PRIOR
        // generation's observed signatures forward — clearing/superseding a sign-request must never
        // make an already-broadcast signature un-observable under the new nonce.
        observedSigs: (bt.browserSign && bt.browserSign.observedSigs) || [],
      };
      const nextBatches = { ...batches, [batchId]: { ...bt, browserSign } };
      if (!hubStore.writeVerified(kv, p.id, "batches", nextBatches)) return res.status(500).json({ ok: false, error: "sign-request did not persist — check DATA_DIR" });
      console.log(`[hub-payout] ${p.id} batch ${batchId} sign-request — ${signable.length} wallet(s), nonce ${nonce.slice(0, 8)}…`);
      return res.status(200).json({
        ok: true, project: publicProject(p), batchId, nonce, idempotencyKey, requestedAt: now,
        mint, decimals: dec, tokenProgram, fundingWallet: p.fundingWallet, payoutSources: browserSign.payoutSources,
        rows: signable, skipped: rows.filter((r) => !r.ok),
      });
    } catch (e) { return res.status(400).json({ ok: false, error: publicErrMsg(e) }); }
    finally { if (lock.token) hubStore.lockRelease(kv, payoutLockKey, lock.token); }
  });

  app.all("/api/hub/:project/batch/:batchId/observe", limited("hubheavy", { windowMs: 60000, max: 30 }), async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "POST") return mutatingOnGet(res);
    if (isDirect(req)) return notFound(res);
    const p = projectOf(req);
    if (!p) return adminAuthOK(req) ? notFound(res, "no such project") : notFound(res);
    const who = authOf(req, p);
    if (!who) return notFound(res);
    if (p.dryRun) return res.status(409).json(dryRunSignRefusal(p));
    if (typeof getTx !== "function") return res.status(503).json({ ok: false, error: "chain reads are not configured on this server — nothing recorded" });
    const b = body(req);
    let sigsIn = b.sigs != null ? b.sigs : (b.sig != null ? [b.sig] : []);
    if (typeof sigsIn === "string") { try { sigsIn = JSON.parse(sigsIn); } catch (_) { sigsIn = [sigsIn]; } }
    if (!Array.isArray(sigsIn)) sigsIn = [sigsIn];
    const sigs = [...new Set(sigsIn.map((s) => String(s || "").trim()).filter((s) => SIG_RE.test(s)))];
    if (!sigs.length) return res.status(400).json({ ok: false, error: "need at least one transaction signature (sig=… or sigs=[…])" });
    if (sigs.length > 40) return res.status(400).json({ ok: false, error: "too many signatures in one observe call" });
    const batchId = String(req.params.batchId || "");
    const nonce = b.nonce != null ? String(b.nonce) : "";

    // F2/F7/F8/F9 (docs/HUB_BROWSER_SIGN_VERIFY_2026-09-18.md): a LOCK-FREE read first — only to
    // check the batch is still `pending` and to size the bounds below and freeze which
    // wallets/nonce this call is answering for. Everything taken from this read is re-verified
    // against a FRESH read taken once the lock (below) is actually held: the nonce check there is
    // what catches a stale read (a force=1 re-request or an owner clear changed the nonce between
    // this read and the lock), refusing the whole call before anything is written.
    const preBatches = hubStore.read(kv, p.id, "batches", {}) || {};
    const preBt = preBatches[batchId];
    if (!preBt) return res.status(404).json({ ok: false, error: "no such batch (pass the batch id in the URL)" });
    if (!preBt.browserSign) return res.status(400).json({ ok: false, error: "no sign-request in progress for this batch — call sign-request first" });
    // A browserSign that already reached its terminal state answers the same `already:true` no
    // matter what `bt.state` is by then — a fully-settled single-wallet batch legitimately flips
    // to `bt.state === "sent"` in the SAME call that settles it, and replaying its signature (a
    // network retry) must still be the harmless idempotent read this always was, not a 400.
    if (preBt.browserSign.state !== "signing" && preBt.browserSign.state !== "submitted") {
      return res.status(200).json({ ok: true, already: true, batchId, browserSign: preBt.browserSign, note: browserSignAlreadyNote(preBt.browserSign) });
    }
    // F2: a batch mid-flow (`signing`/`submitted`, checked above) whose STATE is no longer
    // `pending` was moved out from under this flow some other way — a cancel, a manual confirm —
    // and must never be observed into: rows it might still name could have gone straight back to
    // `available` (cancelBatch), and a settlement here would pay them a second time through the
    // very next export.
    if (preBt.state !== "pending") return res.status(400).json({ ok: false, error: `batch is ${preBt.state}, not pending` });
    // F9: required, not merely accepted — ties this call back to the EXACT sign-request that
    // handed out `wallets`/`mint`/`fundingWallet` below, so a stale or superseded one can never be
    // conflated with a fresh one (the comment used to claim this; nothing enforced it).
    if (!nonce || nonce !== preBt.browserSign.nonce) {
      return res.status(409).json({ ok: false, error: "this observe call's nonce does not match the batch's current sign-request — request a fresh one (sign-request) and re-broadcast from what it returns", batchId });
    }
    // N7 (docs/HUB_BROWSER_SIGN_VERIFY_2026-09-18.md): a frozen sign-request never expired — a
    // months-old `signing` record could still credit a transfer sourced from a since-rotated
    // funding wallet at any time after the batch was created. Bounded to 24h; the row's money is
    // unaffected — a fresh sign-request re-offers it under a new nonce.
    const BROWSER_SIGN_MAX_AGE_S = 24 * 3600;
    if (nowUnix() - (Number(preBt.browserSign.requestedAt) || 0) > BROWSER_SIGN_MAX_AGE_S) {
      return res.status(409).json({ ok: false, error: "this sign-request is more than 24 hours old — request a fresh sign-request and re-broadcast from what it returns", batchId });
    }
    const preWallets = preBt.browserSign.wallets || [];
    // F7: bound the wallets×signatures cross product the same way &sent= bounds its `results`
    // list (400, never silently truncated) — `sigs` alone was capped at 40 but `wallets` was not,
    // so a large batch made every observe call O(large × 40) under the payout lock.
    const maxSigs = Math.max(1, preWallets.length + 5);
    if (sigs.length > maxSigs) return res.status(400).json({ ok: false, error: `too many signatures for a batch of ${preWallets.length} wallet(s) — observe at most ${maxSigs} at a time` });
    if (preWallets.length * sigs.length > 500) return res.status(400).json({ ok: false, error: `too many wallet×signature combinations to verify in one call (${preWallets.length} wallet(s) × ${sigs.length} signature(s)) — observe fewer signatures at a time` });

    // F8: fetch every submitted signature ONCE, through a small concurrency pool, and BEFORE the
    // payout lock — a slow or flaky RPC used to hold the lock (blocking every other payout route
    // for this project) across up to 40 SEQUENTIAL round trips. Still all-or-nothing: an RPC
    // failure on any of them aborts with `unavailable` before the lock is ever taken.
    const txBySig = new Map();
    {
      const POOL = 3;
      let cursor = 0, rpcError = null;
      const worker = async () => {
        while (cursor < sigs.length && !rpcError) {
          const sg = sigs[cursor++];
          try { txBySig.set(sg, (await getTx(sg)) || null); } catch (e) { rpcError = e; }
        }
      };
      await Promise.all(Array.from({ length: Math.min(POOL, sigs.length) }, worker));
      if (rpcError) return res.status(503).json({ ok: false, error: "could not read the transactions on chain right now — nothing recorded, try again: " + publicErrMsg(rpcError), retry: true });
    }
    // P1-4/P1-5 (lens 1): `getTx` resolving null (not yet indexed — the ORDINARY state one second
    // after signAndSendTransaction, not a fault) used to flow through as a permanent per-wallet
    // "transaction not found on chain" failure and flip `signing` -> `submitted` forever, since
    // nothing ever un-sticks `submitted` on its own. Treated as the SAME class as the RPC-throw
    // above: 503, nothing written, batch state unchanged, retry shortly.
    //
    // N3 (docs/HUB_BROWSER_SIGN_VERIFY_2026-09-18.md): this used to be all-or-nothing — ONE
    // not-yet-indexed signature 503'd the WHOLE call, settling nothing even when every other
    // submitted signature had already landed. Only 503 (touching nothing) when NONE of them
    // resolved; otherwise drop the unindexed ones from the wallets×sigs pass below and settle
    // what did resolve, reporting the rest back as `pending`/`retry:true` so the caller can
    // observe just those once they land — never advancing to `settled` while any remain.
    const notYetIndexed = sigs.filter((sg) => txBySig.get(sg) == null);
    if (notYetIndexed.length === sigs.length) {
      return res.status(503).json({ ok: false, error: `the chain has not indexed ${notYetIndexed.length} of these signature(s) yet — try again in a few seconds (nothing recorded, batch state unchanged)`, retry: true, pending: notYetIndexed });
    }
    const resolvedSigs = sigs.filter((sg) => txBySig.get(sg) != null);

    const payoutLockKey = `hublock:${p.id}:payout`;
    const lock = hubStore.lockAcquire(kv, payoutLockKey);
    if (!lock.ok) return res.status(409).json({ ok: false, error: "busy", detail: "another payout request for this project is in flight — wait a moment and retry", lock });
    try {
      const now = nowUnix();
      let batches = hubStore.read(kv, p.id, "batches", {}) || {};
      const bt = batches[batchId];
      if (!bt) return res.status(404).json({ ok: false, error: "no such batch (pass the batch id in the URL)" });
      if (!bt.browserSign) return res.status(400).json({ ok: false, error: "no sign-request in progress for this batch — call sign-request first" });
      if (bt.browserSign.state !== "signing" && bt.browserSign.state !== "submitted") {
        return res.status(200).json({ ok: true, already: true, batchId, browserSign: bt.browserSign, note: browserSignAlreadyNote(bt.browserSign) });
      }
      if (bt.state !== "pending") return res.status(400).json({ ok: false, error: `batch is ${bt.state}, not pending` });
      // Re-checked against the FRESH read, still inside the lock — this is what actually catches a
      // sign-request that superseded the one this call's signatures were issued against.
      if (!nonce || nonce !== bt.browserSign.nonce) {
        return res.status(409).json({ ok: false, error: "this observe call's nonce does not match the batch's current sign-request — request a fresh one (sign-request) and re-broadcast from what it returns", batchId });
      }
      let paid = hubStore.read(kv, p.id, "paid", {}) || {};
      let hubJournal = hubStore.readJournal(kv) || {};
      // P3-10: every settlement-relevant parameter comes from what sign-request FROZE onto the
      // batch — never the live project record — so an owner edit to payoutSources (say) between
      // sign-request and observe can never silently change which source wallet an already-
      // broadcast transfer is checked against. See the matching note in sign-request above.
      const mint = bt.browserSign.mint;
      const fundingWalletFrozen = bt.browserSign.fundingWallet;
      const fundedBy = [fundingWalletFrozen, ...(Array.isArray(bt.browserSign.payoutSources) ? bt.browserSign.payoutSources : [])];

      // The frozen wallet list from sign-request × every submitted signature. The browser only
      // ever reports "here are the signatures I broadcast", never which wallet landed in which
      // one — payoutVerify.verifyBatchRows' rowPaidBy check (a REAL token-balance-delta read on
      // the fetched transaction) is what proves or refutes each candidate pair; the client's
      // pairing (or lack of one) is never trusted on its own.
      const wallets = bt.browserSign.wallets || [];
      const results = [];
      // N3: only the signatures the RPC actually resolved this pass — an unindexed one is reported
      // back as `pending`, never fed into verification (it would only ever refuse as "no
      // transaction signature" and could never settle anything anyway).
      for (const wallet of wallets) for (const sig of resolvedSigs) results.push({ wallet, sig });
      // F7: hoisted ONCE for this pass, not re-scanned per wallet (it was called inside the loop).
      const hubEntries = ledger.journalFor(hubJournal, p.id);
      const remainingByWallet = {};
      for (const w of wallets) {
        const rs = ledger.rowState(bt, w, hubEntries);
        if (rs) remainingByWallet[w] = rs.remainingRaw;
      }
      const vr = payoutVerify.verifyBatchRows({ results, txBySig, batches, batchId, mint, amounts: remainingByWallet, notBefore: bt.at, fundingWallet: fundingWalletFrozen, fundedBy, nowUnix: now, journal: hubJournal, projectId: p.id });

      // PASS 1 — the journal's own verdict, order-independent, exactly as the /payout route's
      // &sent= branch runs it (see the long comment there): group survivors by wallet, locate each
      // candidate's specific transfer instruction, and settle only the one whose amount equals the
      // row's own remaining, whichever signature it rode in on.
      // N2(b) (docs/HUB_BROWSER_SIGN_VERIFY_2026-09-18.md): a signature already consumed by THIS
      // project's THIS batch (an earlier observe() call — including one for a different wallet in
      // the same batched transaction) is our own prior settlement, never a reuse — an ordinary
      // idempotent retry must not raise the cross-project-reuse fraud alert or mark an unrelated
      // wallet failed for a signature that never could have paid it.
      const ownPriorSettlement = (rj) => rj && rj.why === payoutVerify.TRANSFER_ALREADY_CONSUMED_WHY
        && Object.values(hubJournal).some((e) => e && e.sig === rj.sig && e.projectId === p.id && e.batchId === batchId);
      const alertRefusals = [];
      const pass1Refusals = [];
      for (const rj of vr.rejected) {
        if (ownPriorSettlement(rj)) continue;
        if (rj.why === "transfer_not_from_funding_wallet" || rj.why === payoutVerify.TRANSFER_ALREADY_CONSUMED_WHY) alertRefusals.push({ wallet: rj.wallet, sig: rj.sig, why: rj.why });
      }
      let trialJournal = hubJournal;
      // F7: an incremental append, not a re-scan of `trialJournal` per wallet — `settle.
      // settleAndPersist` hands back the exact xferKey it just added, so the next wallet's
      // `rowState` sees it for O(1) instead of O(journal size).
      let trialEntries = hubEntries;
      const passed = [];
      const refusePass1 = (row) => { alertRefusals.push(row); pass1Refusals.push(row); };
      const byWallet = new Map();
      for (const row of vr.accepted) {
        if (!byWallet.has(row.wallet)) byWallet.set(row.wallet, []);
        byWallet.get(row.wallet).push(String(row.sig || "").trim());
      }
      for (const [wallet, walletSigs] of byWallet) {
        const probed = walletSigs.map((sigTrim) => {
          let located = null;
          try { located = payoutVerify.locateTransferInstruction(txBySig.get(sigTrim), { mint, wallet, fundingWallet: fundingWalletFrozen, fundedBy, nowUnix: now }); }
          catch (_) { located = null; }
          return { sig: sigTrim, located };
        });
        for (const c of probed) { if (!c.located) passed.push({ wallet, sig: c.sig, settled: { journaled: false, why: settle.ATTRIBUTION_FAILURE_WHY, journal: trialJournal, batches: { [batchId]: bt } } }); }
        for (const c of probed) { if (c.located && c.located.refused) refusePass1({ wallet, sig: c.sig, why: c.located.refused }); }
        const attributable = probed.filter((c) => c.located && !c.located.refused);
        if (!attributable.length) continue;
        const rowNow = ledger.rowState(bt, wallet, trialEntries);
        if (!rowNow) { for (const c of attributable) refusePass1({ wallet, sig: c.sig, why: "row_not_in_batch" }); continue; }
        const remaining = BigInt(rowNow.remainingRaw);
        const matches = attributable.filter((c) => BigInt(c.located.amountRaw) === remaining);
        if (!matches.length) { for (const c of attributable) refusePass1({ wallet, sig: c.sig, why: "amount_mismatch", expectedRaw: remaining.toString(), actualRaw: c.located.amountRaw }); continue; }
        matches.sort((a, b2) => (a.located.slot || 0) - (b2.located.slot || 0));
        const winner = matches[0];
        const dupSet = new Set(matches.slice(1));
        for (const c of attributable) {
          if (c === winner) continue;
          refusePass1(dupSet.has(c) ? { wallet, sig: c.sig, why: "duplicate_settlement_candidate" } : { wallet, sig: c.sig, why: "amount_mismatch", expectedRaw: remaining.toString(), actualRaw: c.located.amountRaw });
        }
        const settled = settle.settleAndPersist({ projectId: p.id, journal: trialJournal, batches: { [batchId]: bt }, batchId, wallet, sig: winner.sig, tx: txBySig.get(winner.sig), mint, nowUnix: now, fundingWallet: fundingWalletFrozen, fundedBy });
        if (!settled.journaled && settled.why !== settle.ATTRIBUTION_FAILURE_WHY) { refusePass1({ wallet, sig: winner.sig, why: settled.why, expectedRaw: settled.expectedRaw, actualRaw: settled.actualRaw }); continue; }
        if (settled.journaled) { trialJournal = settled.journal; trialEntries = trialEntries.concat([trialJournal[settled.xferKey]]); }
        passed.push({ wallet, sig: winner.sig, settled });
      }

      // PASS 2 — the legacy record (exactly the /payout route's &sent= branch's own PASS 2), only
      // for rows that survived PASS 1.
      const r = pay.recordSent({ batch: bt, paid, results: passed.map((x) => ({ wallet: x.wallet, sig: x.sig })), nowUnix: now });
      let finalBatch = r.batch;
      const journalRaw = {}, journalReport = [];
      for (const x of passed) {
        const sentRow = (r.batch.sent || {})[x.wallet];
        if (!r.recorded.includes(x.wallet) || !sentRow || sentRow.sig !== x.sig) { journalReport.push({ wallet: x.wallet, sig: x.sig, journaled: false, why: "row was not newly recorded (already sent, or zero amount, or a different signature settled this row)" }); continue; }
        const { settled } = x;
        if (settled.journaled) {
          const entry = settled.journal[settled.xferKey];
          journalRaw[hubStore.journalEntryKey(settled.xferKey)] = entry;
          hubJournal = { ...hubJournal, [settled.xferKey]: entry };
          finalBatch = attempts.stampSettled(finalBatch, x.wallet, { sig: x.sig, xferKey: settled.xferKey, amountRaw: entry.appliedRaw, nowUnix: now });
        }
        journalReport.push({ wallet: x.wallet, sig: x.sig, journaled: settled.journaled, why: settled.why || null });
      }
      paid = r.paid;

      // F7: one final hoist, reused by both `stillOwed` and `remainingWallets` in the response below
      // — `hubJournal` here is the batch's fully-updated journal after PASS 2's writes above.
      const finalEntries = ledger.journalFor(hubJournal, p.id);
      // The batch-level browserSign state: signing -> submitted the moment at least one submitted
      // signature has actually been fetched and processed (whether or not it settled anything) ->
      // settled once every wallet this sign-request named has nothing left owed. A bad signature or
      // an unattributable one never regresses this back to `signing` — the browser DID broadcast
      // something; `submitted` holds until every named row resolves.
      const stillOwed = wallets.some((w) => { const rs = ledger.rowState(finalBatch, w, finalEntries); return rs && rs.remainingRaw !== "0"; });
      // N2(a) (docs/HUB_BROWSER_SIGN_VERIFY_2026-09-18.md): re-observing a signature that already
      // settled a row is an ordinary idempotent retry, not a failure — PASS 1 correctly refuses the
      // repeat as `amount_mismatch`/`duplicate_settlement_candidate` (remaining is now 0), but that
      // refusal is worth neither a per-row "could not be recorded" nor an operator-room alert once
      // the wallet it names has nothing left owed.
      for (let i = alertRefusals.length - 1; i >= 0; i--) {
        const rj = alertRefusals[i];
        if (!rj || !rj.wallet || (rj.why !== "amount_mismatch" && rj.why !== "duplicate_settlement_candidate")) continue;
        const rs = ledger.rowState(finalBatch, rj.wallet, finalEntries);
        if (rs && rs.remainingRaw === "0") alertRefusals.splice(i, 1);
      }
      // P2-7 (lens 1): `vr.rejected` is the FULL wallets×sigs cross product's rejections, so a
      // wallet with a genuine signature elsewhere in the batch also carries a "no <mint>… reached
      // this wallet" refusal for every OTHER signature it was never paired with — that noise used
      // to overwrite the wallet's real reason (or invent one for a wallet PASS 1 already settled
      // through the attribution-failure path, leaving it marked both paid AND failed). Only two
      // sources are trusted now: PASS 1's own verdict (the journal-aware, most specific one, for a
      // wallet it actually probed) and, for a wallet PASS 1 never even reached (no candidate
      // survived rowPaidBy at all), a REAL refusal from vr.rejected — never the generic
      // "wrong pairing" noise a cross product produces for every unrelated signature.
      const NOISE_WHY_RE = /^no .+ reached this wallet in that transaction$/;
      const failedNow = {};
      for (const rj of pass1Refusals) if (rj && rj.wallet) failedNow[rj.wallet] = { why: rj.why, at: now };
      for (const rj of vr.rejected) {
        if (!rj || !wallets.includes(rj.wallet) || failedNow[rj.wallet]) continue;
        if (byWallet.has(rj.wallet)) continue;   // PASS 1 already owns this wallet's verdict
        if (NOISE_WHY_RE.test(String(rj.why || ""))) continue;   // this sig simply wasn't for this wallet
        if (ownPriorSettlement(rj)) continue;   // N2(b): our own prior settlement, not a reuse
        failedNow[rj.wallet] = { why: rj.why, at: now };
      }
      // N2(a): a wallet whose row has nothing remaining AFTER this pass is not a failure, whatever
      // noise the cross product produced for it — a signature retried against an already-paid row
      // refuses as `amount_mismatch`/`row_already_settled`, which is the correct, harmless outcome,
      // not a thing to report back as "could not be recorded".
      for (const w of Object.keys(failedNow)) {
        const rs = ledger.rowState(finalBatch, w, finalEntries);
        if (rs && rs.remainingRaw === "0") delete failedNow[w];
      }
      const nextFailed = { ...(bt.browserSign.failed || {}), ...failedNow };
      // A wallet actually RECORDED this pass (legacy sent — including the attribution-failure path,
      // which lands a real payment with no journal entry) is cleared from `failed`: a prior bad
      // attempt, or this pass's own noise, should never still read as failed once the money moved.
      for (const w of r.recorded) delete nextFailed[w];
      // N3: never advance to `settled` (or even `submitted`, if the batch already stopped owing)
      // while a signature the caller submitted still has not been indexed — it may yet be the
      // transfer that settles a still-owed row, so the caller must be told to come back to it.
      const nextState = stillOwed || notYetIndexed.length ? "submitted" : "settled";
      const nextBrowserSign = { ...bt.browserSign, state: nextState, lastObservedAt: now, observedSigs: [...new Set([...(bt.browserSign.observedSigs || []), ...resolvedSigs])], failed: nextFailed };
      finalBatch = { ...finalBatch, browserSign: nextBrowserSign };
      batches = { ...batches, [batchId]: finalBatch };
      if (!hubStore.writeManyVerifiedMixed(kv, p.id, { batches, paid }, journalRaw)) return res.status(500).json({ ok: false, error: "recorded in memory but the volume did not take the write — STOP and check DATA_DIR before observing again" });
      if (r.recorded.length) markMilestone(kv, p.id, "firstBatchSignedAt", now);

      if (alertRefusals.length) {
        const counts = {};
        for (const fr of alertRefusals) counts[fr.why] = (counts[fr.why] || 0) + 1;
        const whyList = Object.entries(counts).map(([why, n]) => `${why} x${n}`).join(", ");
        const walletsTxt = alertRefusals.slice(0, 3).map((fr) => String(fr.wallet || "").slice(0, 6) + "…").join(", ");
        const more = alertRefusals.length > 3 ? `, +${alertRefusals.length - 3} more` : "";
        try { alert(`${p.id}: batch ${batchId} — ${alertRefusals.length} browser-signed settlement REFUSED (not recorded): ${whyList} — wallets ${walletsTxt}${more}`, { projectId: p.id, batchId, kind: "browser-sign" }); } catch (_) {}
      }

      return res.status(200).json({
        ok: true, project: publicProject(p), batchId, as: who,
        browserSign: nextBrowserSign,
        recorded: r.recorded, ignored: [...r.ignored, ...pass1Refusals], journal: journalReport,
        remainingWallets: wallets.filter((w) => { const rs = ledger.rowState(finalBatch, w, finalEntries); return rs && rs.remainingRaw !== "0"; }),
        // N3: the signatures this call could not yet check — the caller (signAndSend()'s retry
        // loop) should observe just these again, not the whole set, once the chain catches up.
        ...(notYetIndexed.length ? { pending: notYetIndexed, retry: true } : {}),
      });
    } catch (e) {
      try { alert(`${p.id}: batch ${batchId} observe threw — ${publicErrMsg(e)}`); } catch (_) {}
      return res.status(400).json({ ok: false, error: publicErrMsg(e) });
    } finally { if (lock.token) hubStore.lockRelease(kv, payoutLockKey, lock.token); }
  });

  // ── reconcile (read-only) ───────────────────────────────────────────────────────────────────
  // crash P2-2 (docs/HUB_JOURNAL_VERIFY_2026-09-18.md): rebuilds the consumed set from the journal
  // and reports every row where the legacy `sent` flag and the journal's own settlement disagree —
  // a lost journal write (should be closed by the append-only per-entry keys above, but this is
  // the "trust nothing, verify" check for whatever a live volume already holds from before that
  // change), a voided legacy row the journal still remembers, or a manual/confirmBatch row
  // (sig:null) that legitimately has no journal event. NEVER WRITES ANYTHING — an operator session
  // only, same gate as every other desk route.
  app.get("/api/hub/:project/reconcile", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (isDirect(req)) return notFound(res);
    const p = projectOf(req);
    if (!p) return adminAuthOK(req) ? notFound(res, "no such project") : notFound(res);
    const who = authOf(req, p);
    if (!who) return notFound(res);
    try {
      const batches = hubStore.read(kv, p.id, "batches", {}) || {};
      const journal = hubStore.readJournal(kv) || {};
      const entries = Object.values(journal).filter((e) => e && e.projectId === p.id);
      const divergent = [];
      for (const [batchId, bt] of Object.entries(batches)) {
        for (const w of Object.keys((bt && bt.amounts) || {})) {
          const legacySent = !!(bt.sent && bt.sent[w]);
          const rowEntries = entries.filter((e) => e.batchId === batchId && e.wallet === w);
          const journalSettled = rowEntries.length > 0;
          if (legacySent !== journalSettled) {
            divergent.push({
              batchId, wallet: w, legacySent, journalSettled,
              legacySig: legacySent ? (bt.sent[w].sig || null) : null,
              legacyManual: legacySent ? !!bt.sent[w].manual : false,
              xferKeys: rowEntries.map((e) => e.xferKey),
            });
          }
        }
      }
      return res.status(200).json({ ok: true, as: who, projectId: p.id, journalEntries: entries.length, consumedGlobalCount: Object.keys(journal).length, divergentCount: divergent.length, divergent });
    } catch (e) { return res.status(500).json({ ok: false, error: publicErrMsg(e) }); }
  });
}

// ── the scheduler ─────────────────────────────────────────────────────────────────────────────
// Every 10 minutes, every armed project in the registry (an hour is credited at the first tick
// inside it; the gate refuses the rest). Does nothing until a project is armed with the two flags.
// HUB_ENGINE_OFF=1 is the kill, like every engine here.
function startScheduler({ kv, scanDeps, alert = (m) => console.warn("[hub] " + m), intervalMs = 10 * 60 * 1000, skip = ["cuna"], bootDelayMs = 45 * 1000 }) {
  if (process.env.HUB_ENGINE_OFF === "1") { console.log("[hub-accrual] scheduler OFF (HUB_ENGINE_OFF=1)"); return null; }
  const tick = async (reason) => {
    try {
      const registry = hubStore.readRegistry(kv) || {};
      if (!Object.keys(registry).some((id) => !skip.includes(id))) return;   // nothing to do, and no chain client is built
      const out = await eng.runAll({ kv, nowUnix: Math.floor(Date.now() / 1000), deps: await scanDeps(), skip, onAlert: alert, reason });
      const ran = Object.entries(out).filter(([, r]) => r && r.ok);
      if (ran.length) console.log("[hub-accrual] " + ran.map(([id, r]) => `${id}: ${r.key} — ${r.eligible} earning`).join("; "));
    } catch (e) { console.warn("[hub-accrual] " + (e && e.message)); }
  };
  const h = setInterval(() => tick("timer"), intervalMs);
  setTimeout(() => tick("boot"), bootDelayMs);
  return h;
}

module.exports = { mount, startScheduler, mintInfoFromParsed, defaultEffectiveFrom, termsPatchFromQuery, publicProject, TERM_KEYS };
