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
const eng = require("./engine");
const prog = require("../cuna-programme");
const pay = require("../cuna-payout");
const bp = require("../buycomp-payout");
const pub = require("./public");
const { randomBytes } = require("crypto");

const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
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
    access: access.accessStatus(p.access, Math.floor(Date.now() / 1000)) };
}
function writeRegistryVerified(kv, registry) {
  if (typeof kv.setVerified === "function") return kv.setVerified(hubStore.REGISTRY_KEY, registry) === true;
  hubStore.writeRegistry(kv, registry); return true;
}
const fmtOwed = (owed, dec) => Object.fromEntries(Object.entries(owed).filter(([, v]) => v > 0n).map(([w, v]) => [w, pub.rawToUi(v, dec)]));

// ── mount ─────────────────────────────────────────────────────────────────────────────────────
function mount(app, deps) {
  const { kv, adminAuthOK, publicErrMsg, vault, connection, scanDeps, alert = (m) => console.warn("[hub] " + m), isDirect = (req) => !!req.cluckDirect,
    // payment leg (all optional — without them the access routes answer 503):
    sigStore = null, getTx = null, clknPriceInSol = null, payTo = null, clknMint = null, clknDecimals = 9, rateLimit = null } = deps;
  const limited = (bucket, opts) => (typeof rateLimit === "function" ? rateLimit(bucket, opts) : (req, res, next) => next());
  const nowUnix = () => Math.floor(Date.now() / 1000);
  const body = (req) => ({ ...(req.query || {}), ...(req.body || {}) });
  const notFound = (res, what = "not_found") => res.status(404).json({ ok: false, error: what });
  const mutatingOnGet = (res) => res.status(405).json({ ok: false, error: "this changes state — send it as a POST" });
  const projectOf = (req) => { const id = String(req.params.project || "").toLowerCase(); const p = (hubStore.readRegistry(kv) || {})[id]; return p && p.status === "approved" ? p : null; };
  const on = (v) => String(v || "") === "1";

  // ── registry ────────────────────────────────────────────────────────────────────────────────
  // Own root on purpose: the public GET /api/hub/:project is registered before this and would read
  // "registry" as a project id.
  app.all("/api/hub-registry", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (isDirect(req) || !adminAuthOK(req)) return notFound(res);
    const b = body(req);
    if ((b.id != null || b.suspend != null) && req.method !== "POST") return mutatingOnGet(res);
    try {
      let reg = hubStore.readRegistry(kv) || {};
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
        };
        if (b.rewardMint && String(b.rewardMint) !== String(b.mint)) { input.rewardMint = String(b.rewardMint); input.rewardMintInfo = await readMint(input.rewardMint); }
        const project = proj.validateProject(input, await readMint(input.mint));
        reg = proj.approveProject(reg, project, { nowUnix: nowUnix() });
        if (!writeRegistryVerified(kv, reg)) return res.status(500).json({ ok: false, error: "registry write did not persist — check DATA_DIR" });
        console.log(`[hub] project APPROVED: ${project.id} (${project.symbol} ${project.mint})`);
      }
      return res.status(200).json({ ok: true, projects: Object.values(reg).map(publicProject) });
    } catch (e) { return res.status(400).json({ ok: false, error: publicErrMsg(e) }); }
  });

  // ── admin: status, terms, arm, disarm, accrue ───────────────────────────────────────────────
  app.all("/api/hub/:project/admin", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (isDirect(req) || !adminAuthOK(req)) return notFound(res);
    const b = body(req);
    const mutating = on(b.terms) || on(b.arm) || on(b.off) || on(b.accrue) || on(b.rescan);
    if (mutating && req.method !== "POST") return mutatingOnGet(res);
    const p = projectOf(req);
    if (!p) return notFound(res, "no such project");
    try {
      const now = nowUnix();
      let state = hubStore.read(kv, p.id, "state", {}) || {};
      const persistState = () => { if (!hubStore.writeVerified(kv, p.id, "state", state)) throw new Error("programme state write did not persist — check DATA_DIR"); };
      if (on(b.terms)) {
        const cur = proj.versionFor(eng.readState(state), prog.sliceKey(now));
        const terms = { ...((cur && cur.terms) || {}), ...termsPatchFromQuery(b) };
        const effectiveFrom = b.effectiveFrom ? String(b.effectiveFrom) : defaultEffectiveFrom(state, now);
        state = { ...state, ...proj.createVersion(eng.readState(state), p, terms, { effectiveFrom, todayKey: dayKeyOf(now) }) };
        persistState();
        eng.resetCache(p.id);
        console.log(`[hub] ${p.id}: terms v${state.versions[state.versions.length - 1].version} from ${effectiveFrom} — ${state.versions[state.versions.length - 1].hash.slice(0, 12)}…`);
      }
      if (on(b.arm)) {
        if (String(b.confirm || "") !== "go-live") return res.status(400).json({ ok: false, error: "arming needs &arm=1&confirm=go-live — two flags on purpose" });
        const acc = access.accessStatus(p.access, now);
        if (!access.mayOperate(p.access, now)) return res.status(402).json({ ok: false, error: `platform access is ${acc.state} (tier ${acc.tier}) — a month must be paid before arming, or the owner comps the project`, access: acc });
        state = eng.arm(state, now); persistState(); eng.resetCache(p.id);
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
        ok: true, project: publicProject(p), armed: st.armed, startedAt: st.startedAt,
        versions: st.versions.map((v) => ({ version: v.version, effectiveFrom: v.effectiveFrom, effectiveTo: v.effectiveTo, hash: v.hash, terms: v.terms })),
        configInForce: cfg, slicesAccrued: Object.keys(days).length, daysAccrued: prog.daysAccruedFrom(days),
        missedSlices: missed.length, missedRecent: missed.slice(-48),
        scan: { at: snap.at || 0, ageSec: snap.at ? Math.round((Date.now() - snap.at) / 1000) : null, locks: locks.length, eligibleNow: eligible, err: snap.err || null },
        ran,
      });
    } catch (e) { return res.status(400).json({ ok: false, error: publicErrMsg(e) }); }
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

  // ── platform access: quote + pay ────────────────────────────────────────────────────────────
  // GET  /api/hub/:project/access            → status + a fresh quote (SOL, and CLKN priced now)
  // POST /api/hub/:project/access?sig=&quote= → verify the landed payment against that quote,
  //                                             extend the paid period, consume the signature.
  // Anyone may pay for a project (the payment credits the project, not the payer). The quote is
  // what makes "priced at the moment they pay" true: the CLKN amount is fixed when the quote is
  // issued and the payment must land inside the quote's window.
  const QUOTES_KEY = (id) => `hub:quotes:${id}`;
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
        book[quote.id] = quote;
        kv.set(QUOTES_KEY(p.id), book);
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
      if (typeof sigStore.has === "function" && sigStore.has(sig)) return res.status(409).json({ ok: false, error: "this payment signature was already used for something else" });
      let tx;
      try { tx = await getTx(sig); } catch (e) { return res.status(503).json({ ok: false, error: "Could not read the chain just now — nothing consumed, try again in a minute.", retry: true }); }
      const parsed = accessPay.parsePayment(tx, { payTo: dest, clknMint });
      const v = accessPay.verifyPayment({ quote, payment: parsed });
      if (!v.ok) return res.status(v.retry ? 202 : 400).json({ ok: false, error: v.reason === "short" ? "payment does not cover the quoted amount" : v.reason === "outside_quote_window" ? "payment landed outside the quote's window — request a new quote" : v.reason === "not_final_yet" ? "payment not final yet — try again in a few seconds" : v.reason, detail: v, retry: !!v.retry });
      const acc = access.applyPayment(p.access, { sig, atUnix: Math.floor(v.blockTimeMs / 1000), kind: v.kind, lamports: v.kind === "sol" ? v.lamports : undefined, clknRaw: v.kind === "clkn" ? v.clknRaw : undefined });
      const reg = hubStore.readRegistry(kv) || {};
      const next = { ...reg, [p.id]: { ...reg[p.id], access: acc } };
      if (!writeRegistryVerified(kv, next)) return res.status(503).json({ ok: false, error: "could not record the payment durably — nothing consumed, try again", retry: true });
      // The registry row is the source of truth for this payment; the signature store is the
      // cross-product guard (a hub payment can never double as a tools-pass payment).
      if (typeof sigStore.add === "function" && !sigStore.add(sig)) console.warn(`[hub] ${p.id}: access payment ${sig.slice(0, 12)}… recorded but the signature store did not persist it`);
      console.log(`[hub] ${p.id}: access PAID (${v.kind}) by ${v.payer} — paid through ${new Date(acc.paidThroughUnix * 1000).toISOString().slice(0, 10)}`);
      return res.status(200).json({ ok: true, recovered: false, payment: acc.payments[acc.payments.length - 1], access: access.accessStatus(acc, now) });
    } catch (e) { return res.status(500).json({ ok: false, error: publicErrMsg(e) }); }
  });

  // ── payout ──────────────────────────────────────────────────────────────────────────────────
  app.all("/api/hub/:project/payout", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (isDirect(req) || !adminAuthOK(req)) return notFound(res);
    const b = body(req);
    const mutating = on(b.export) || b.send || on(b.sweep) || b.void || b.sent || b.confirm || b.cancel;
    if (mutating && req.method !== "POST") return mutatingOnGet(res);
    const p = projectOf(req);
    if (!p) return notFound(res, "no such project");
    try {
      const now = nowUnix();
      const dec = Number.isInteger(p.rewardDecimals) ? p.rewardDecimals : (Number.isInteger(p.decimals) ? p.decimals : 9);
      const mint = p.rewardMint || p.mint;
      const days = hubStore.read(kv, p.id, "days", {}) || {};
      let paid = hubStore.read(kv, p.id, "paid", {}) || {};
      let batches = hubStore.read(kv, p.id, "batches", {}) || {};
      // Batches first (remainingOf is what stops a re-send), then paid; one kv persist writes the
      // whole store, so the second write carries the first. A false stops whatever is running.
      const saveMoney = () => hubStore.writeVerified(kv, p.id, "batches", batches) && hubStore.writeVerified(kv, p.id, "paid", paid);
      const report = {};
      const batchOf = (id) => { const bt = batches[String(id || "")]; if (!bt) throw new Error("no such batch (pass &batch=)"); return bt; };

      if (b.sent) {
        // Rows signed in the project's own wallet (the airdropper flow): each signature is verified
        // ON CHAIN before it is recorded — a typo or a foreign signature must not mark a row paid.
        const id = String(b.batch || ""); const bt = batchOf(id);
        let results = b.sent; if (typeof results === "string") { try { results = JSON.parse(results); } catch (_) { results = null; } }
        if (!Array.isArray(results) || results.length > 500) return res.status(400).json({ ok: false, error: "sent must be a list of {wallet, sig}" });
        const sigs = [...new Set(results.map((r) => String((r && r.sig) || "").trim()).filter((x) => SIG_RE.test(x)))];
        const landed = new Set();
        if (sigs.length) {
          const st = await connection().getSignatureStatuses(sigs, { searchTransactionHistory: true });
          ((st && st.value) || []).forEach((v, i) => { if (v && !v.err && (v.confirmationStatus === "confirmed" || v.confirmationStatus === "finalized")) landed.add(sigs[i]); });
        }
        const ok = results.filter((r) => landed.has(String((r && r.sig) || "").trim()));
        const r = pay.recordSent({ batch: bt, paid, results: ok, nowUnix: now });
        paid = r.paid; batches = { ...batches, [id]: r.batch };
        if (!saveMoney()) return res.status(500).json({ ok: false, error: "recorded in memory but the volume did not take the write — STOP and check DATA_DIR before sending more" });
        report.sent = { recorded: r.recorded, ignored: [...r.ignored, ...results.filter((x) => !landed.has(String((x && x.sig) || "").trim())).map((x) => ({ wallet: x && x.wallet, sig: x && x.sig, why: "signature not confirmed on chain" }))], remaining: Object.keys(r.remaining).length, state: r.batch.state };
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
            const r = pay.recordSent({ batch: batches[id], paid, results: [{ wallet: row.wallet, sig: row.sig, pending: !!row.pending }], nowUnix: Math.floor(Date.now() / 1000) });
            paid = r.paid; batches = { ...batches, [id]: r.batch };
            if (!saveMoney()) throw new Error("payout journal did not reach the volume — STOP; do not export another batch until this one is reconciled");
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
        batch: b.batch && batches[String(b.batch)] ? { ...batches[String(b.batch)], remainingLines: pay.toAirdropLines(pay.remainingOf(batches[String(b.batch)]), dec) } : null,
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
