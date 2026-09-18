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
const prog = require("../cuna-programme");
const pay = require("../cuna-payout");
const bp = require("../buycomp-payout");
const pub = require("./public");
const commit = require("./commit");     // B5: independent on-chain commitment of a version's hash (E3)
const teach = require("./teach");
const payoutVerify = require("../payout-verify");
const { randomBytes } = require("crypto");

const B58 = require("../solana-addr").SOL_ADDR_RE;
const SIG_RE = /^[1-9A-HJ-NP-Za-km-z]{60,100}$/;

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
function publicProject(p) {
  return { id: p.id, label: p.label, symbol: p.symbol, mint: p.mint, decimals: p.decimals, rewardMint: p.rewardMint, rewardDecimals: p.rewardDecimals,
    fundingWallet: p.fundingWallet, operatorWallets: p.operatorWallets || [], status: p.status, approvedAt: p.approvedAt || null,
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
    schemaUrl = null } = deps;
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
  const nowUnix = () => Math.floor(Date.now() / 1000);
  const body = (req) => ({ ...(req.query || {}), ...(req.body || {}) });
  const notFound = (res, what = "not_found") => res.status(404).json({ ok: false, error: what });
  const mutatingOnGet = (res) => res.status(405).json({ ok: false, error: "this changes state — send it as a POST" });
  const projectOf = (req) => { const id = String(req.params.project || "").toLowerCase(); const p = (hubStore.readRegistry(kv) || {})[id]; return p && p.status === "approved" ? p : null; };
  const on = (v) => String(v || "") === "1";
  const writeVerified = (key, value) => (typeof kv.setVerified === "function" ? kv.setVerified(key, value) === true : (kv.set(key, value), true));
  const reserved = () => { try { const r = typeof reservedMints === "function" ? reservedMints() : reservedMints; return r && typeof r === "object" ? r : {}; } catch (_) { return {}; } };
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
  app.all("/api/hub-registry", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (isDirect(req) || !adminAuthOK(req)) return notFound(res);
    const b = body(req);
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
        return res.status(200).json({ ok: true, project: publicProject(r.project), version: { version: 1, effectiveFrom: r.state.versions[0].effectiveFrom, hash: r.state.versions[0].hash }, next: `the project pays a month at /hub/${r.project.id}/pay, then arm with POST /api/hub/${r.project.id}/admin?arm=1&confirm=go-live` });
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
        const project = proj.validateProject(input, await readMint(input.mint));
        reg = proj.approveProject(reg, project, { nowUnix: nowUnix(), reserved: reserved() });
        if (!writeRegistryVerified(kv, reg)) return res.status(500).json({ ok: false, error: "registry write did not persist — check DATA_DIR" });
        console.log(`[hub] project APPROVED: ${project.id} (${project.symbol} ${project.mint})`);
      }
      return res.status(200).json({ ok: true, projects: Object.values(reg).map(publicProject) });
    } catch (e) { return res.status(400).json({ ok: false, error: publicErrMsg(e) }); }
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
      const owed = pay.owedNow({ days, paid, pending: batches });
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
      const view = eng.walletView({ project: p, state, addr, locks: snap.locks,
        days: hubStore.read(kv, p.id, "days", {}) || {}, paid: hubStore.read(kv, p.id, "paid", {}) || {}, batches: hubStore.read(kv, p.id, "batches", {}) || {}, nowUnix: now });
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
      if (reg[app0.projectId] && reg[app0.projectId].status !== "suspended") return res.status(409).json({ ok: false, error: `the project id "${app0.projectId}" is taken` });
      if (Object.values(reg).some((p) => p && p.mint === app0.project.mint && p.status !== "suspended") || reservedBy(app0.project.mint)) return res.status(409).json({ ok: false, error: "this mint already runs a program here" });
      if (Object.prototype.hasOwnProperty.call(reserved(), app0.projectId)) return res.status(409).json({ ok: false, error: `the project id "${app0.projectId}" is taken` });
      const book = apply.addToBook(kv.get(APPLICATIONS_KEY, {}) || {}, app0);
      if (!writeVerified(APPLICATIONS_KEY, book)) return res.status(503).json({ ok: false, error: "could not save the application — try again in a minute", retry: true });
      console.log(`[hub] application ${app0.id}: ${app0.projectId} (${app0.project.symbol} ${app0.project.mint}) tier ${app0.tierRequested} — ${app0.contact}`);
      try { alert(`new Lock to Earn application ${app0.id}: ${app0.projectId} (${app0.project.symbol}) tier ${app0.tierRequested} — approve at /api/hub-registry?approve=${app0.id}`); } catch (_) {}
      return res.status(200).json({ ok: true, application: { id: app0.id, projectId: app0.projectId, status: app0.status, submittedAt: app0.submittedAt }, project: publicProject(app0.project), terms: app0.terms, tierRequested: app0.tierRequested, ...pv,
        next: "The owner reviews it. Once approved, the project pays its first month at /hub/" + app0.projectId + "/pay and the program is armed." });
    } catch (e) { return res.status(400).json({ ok: false, error: publicErrMsg(e) }); }
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
  app.all("/api/hub/:project/payout", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (isDirect(req)) return notFound(res);
    const b = body(req);
    const mutating = on(b.export) || b.send || on(b.sweep) || b.void || b.sent || b.confirm || b.cancel;
    if (mutating && req.method !== "POST") return mutatingOnGet(res);
    const p = projectOf(req);
    if (!p) return adminAuthOK(req) ? notFound(res, "no such project") : notFound(res);
    const who = authOf(req, p);
    if (!who) return notFound(res);
    // The managed payer signs with a key Railway holds — the owner's call, never an operator's.
    if (b.send && who !== "owner") return res.status(403).json({ ok: false, error: "the managed payer is owner-only — export the batch and sign it in your own wallet" });
    // Marking a whole batch paid WITHOUT per-row signatures writes sig:null rows that void cannot
    // undo — an operator could settle every locker's credit with one call (deep dive P1-047).
    // Operators record what they actually sent with &sent= (verified on chain); the override is the owner's.
    if (b.confirm && who !== "owner") return res.status(403).json({ ok: false, error: "marking a batch paid without per-row signatures is owner-only — record signed rows with &sent=" });
    // A dry run never accrues, so there is never anything owed to export or send (Colosseum E10).
    // Refused explicitly rather than relying on "nothing owed" reading as a no-op, in case a real
    // program version is ever created for a dry-run project before the flag is turned off.
    if (p.dryRun && (on(b.export) || b.send)) return res.status(403).json({ ok: false, error: `${p.id} is a DRY RUN — nothing accrues, so there is nothing to export or send.` });
    try {
      const now = nowUnix();
      const dec = Number.isInteger(p.rewardDecimals) ? p.rewardDecimals : (Number.isInteger(p.decimals) ? p.decimals : 9);
      const mint = p.rewardMint || p.mint;
      const days = hubStore.read(kv, p.id, "days", {}) || {};
      let paid = hubStore.read(kv, p.id, "paid", {}) || {};
      let batches = hubStore.read(kv, p.id, "batches", {}) || {};
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
        const id = String(b.batch || ""); const bt = batchOf(id);
        let results = b.sent; if (typeof results === "string") { try { results = JSON.parse(results); } catch (_) { results = null; } }
        if (!Array.isArray(results) || results.length > 500) return res.status(400).json({ ok: false, error: "sent must be a list of {wallet, sig}" });
        const sigs = [...new Set(results.map((r) => String((r && r.sig) || "").trim()).filter((x) => SIG_RE.test(x)))];
        // Confirmed is not paid: the status said the transaction landed, not that it moved the
        // reward token to THIS wallet for THIS amount, so one unrelated confirmed signature marked
        // every row paid and the public "VERIFY ON-CHAIN" printed ✓ beside it (deep dive P1-048 /
        // P1-035). Read each transaction once and check the wallet's own token delta.
        if (typeof getTx !== "function") return res.status(503).json({ ok: false, error: "chain reads are not configured on this server — nothing recorded" });
        const txBySig = new Map();
        try { for (const sg of sigs) txBySig.set(sg, (await getTx(sg)) || null); }
        catch (e) { return res.status(503).json({ ok: false, error: "could not read the transactions on chain right now — nothing recorded, try again: " + publicErrMsg(e), retry: true }); }
        // The same row verification the CUNA payout runs (lib/payout-verify.verifyBatchRows).
        const vr = payoutVerify.verifyBatchRows({ results, txBySig, batches, batchId: id, mint, amounts: bt.amounts, notBefore: bt.at });
        const ok = vr.accepted;
        const r = pay.recordSent({ batch: bt, paid, results: ok, nowUnix: now });
        paid = r.paid; batches = { ...batches, [id]: r.batch };
        if (!saveMoney()) return res.status(500).json({ ok: false, error: "recorded in memory but the volume did not take the write — STOP and check DATA_DIR before sending more" });
        // Onboarding clock (E7): the first batches[].sent write for this project, ever — the
        // mechanism that actually pays today (lib/traction.js's header explains why, not the
        // not-yet-mounted settlement journal).
        if (r.recorded.length) markMilestone(kv, p.id, "firstBatchSignedAt", now);
        report.sent = { recorded: r.recorded, ignored: [...r.ignored, ...vr.rejected], remaining: Object.keys(r.remaining).length, state: r.batch.state };
      }
      if (b.confirm) {
        const id = String(b.confirm); const r = pay.confirmBatch({ batch: batchOf(id), paid, nowUnix: now });
        paid = r.paid; batches = { ...batches, [id]: { ...r.batch, confirmedAt: now, note: String(b.note || "").slice(0, 200) } };
        if (!saveMoney()) return res.status(500).json({ ok: false, error: "confirm did not persist — check DATA_DIR" });
        report.confirmed = id;
      }
      if (b.cancel) {
        const id = String(b.cancel); batches = { ...batches, [id]: { ...pay.cancelBatch({ batch: batchOf(id) }), cancelledAt: now } };
        if (!hubStore.writeVerified(kv, p.id, "batches", batches)) return res.status(500).json({ ok: false, error: "cancel did not persist — check DATA_DIR" });
        report.cancelled = id;
      }
      if (b.void) {
        const id = String(b.batch || ""); const v = pay.voidSent({ batch: batchOf(id), paid, wallet: String(b.void), sig: String(b.sig || ""), nowUnix: now });
        report.void = v;
        if (v.ok) { paid = v.paid; batches = { ...batches, [id]: v.batch }; if (!saveMoney()) return res.status(500).json({ ok: false, error: "void did not persist — check DATA_DIR" }); }
      }
      if (on(b.sweep)) {
        const id = String(b.batch || ""); const bt = batchOf(id);
        const rows = Object.entries(bt.sent || {}).filter(([, s]) => s && s.pending && s.sig).map(([wallet, s]) => ({ wallet, sig: s.sig }));
        if (!rows.length) report.sweep = { ok: true, checked: 0 };
        else {
          const st = await connection().getSignatureStatuses(rows.map((x) => x.sig), { searchTransactionHistory: true });
          const vals = (st && st.value) || [];
          const rs = pay.resolveSent({ batch: bt, paid, rows: rows.map((x, i) => ({ ...x, status: vals[i] || null })), nowUnix: now });
          paid = rs.paid; batches = { ...batches, [id]: rs.batch };
          if (!saveMoney()) return res.status(500).json({ ok: false, error: "sweep did not persist — check DATA_DIR" });
          report.sweep = { ok: true, checked: rows.length, confirmed: rs.confirmed, voided: rs.voided, stillPending: rs.stillPending };
        }
      }
      if (b.send) {
        // MANAGED payer: a vault project whose operator key Railway holds. Self-sign projects
        // export and sign in their own wallet instead — this path is never the default.
        const id = String(b.send); const bt = batchOf(id);
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
            paid = r.paid; batches = { ...batches, [id]: r.batch };
            if (!saveMoney()) throw new Error("payout journal did not reach the volume — STOP; do not export another batch until this one is reconciled");
            // Onboarding clock (E7): same choke point as the &sent= branch above, for the managed payer.
            if (r.recorded.length) markMilestone(kv, p.id, "firstBatchSignedAt", sentAt);
          };
          const lock = run ? bp.lockAcquire(kv, `hub:${p.id}:${id}`) : { ok: true, token: null };
          if (!lock.ok) return res.status(409).json({ ok: false, error: "payout_in_flight", lock });
          let r;
          try { r = await vault.payoutSpl({ projectId: from, mintAddr: mint, recipients, perRecipientMaxUi: perMax, totalMaxUi: totalUi, dryRun: !run, onPaid }); }
          finally { if (lock.token) bp.lockRelease(kv, lock.token); }
          report.send = { ...r, batch: id, payer: from, ran: run, caps: { perRecipientMaxUi: perMax, totalMaxUi: totalUi } };
          if (run) console.log(`[hub-payout] ${p.id} batch ${id} SERVER-SENT from ${from}: ${r.action} — paid ${(r.paid || []).length}, pending ${(r.pending || []).length}, failed ${(r.failed || []).length}`);
        }
      }

      const owed = pay.owedNow({ days, paid, pending: batches });
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
    } catch (e) { return res.status(400).json({ ok: false, error: publicErrMsg(e) }); }
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
