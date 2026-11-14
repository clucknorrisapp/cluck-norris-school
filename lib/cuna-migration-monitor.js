"use strict";
// CUNA -> CLKN migration MONITOR: the tick, the Day-0 batch and the admin actions. Every input is
// injected (kv, RPC, connection, signer, alert, clock, attempt store), so the test drives this exact
// code against a stub chain. The pure rules are lib/cuna-migration.js; the owner's runbook is
// docs/CUNA_MIGRATION_RUNBOOK.md. It ships DISARMED and nothing sends unless ALL of:
//   kv cunaMigArmed === true  AND  env CUNA_MIGRATION_ON=1  AND NOT  env CUNA_MIGRATION_OFF=1
//   AND not staging AND the payer secret is loaded and matches the configured payer pubkey
//   AND the kv store is persistent with no loadError AND the journal is not halted.
//
// NEVER PAY TWICE — how:
//  1. One journal entry per incoming transfer (key = its signature) or per Day-0 wallet
//     (key = "day0:<wallet>"). The credit is assigned in chain order at DETECTION and written in the
//     same kv.setVerified as the per-wallet credited total and the cursors (one key). It is never
//     released when a payout attempt dies: the entry still owes it.
//  2. A payout attempt is SIGNED first (so its signature is known), then claimed with an O_EXCL
//     attempt file holding the signed bytes, then journaled with setVerified (false = stop), and
//     only then broadcast. A broadcast error is ignored, never read as failure.
//  3. Every attempt the journal or an attempt file knows of is live until the chain proves it landed
//     or died; a new attempt is built only when every earlier one of that key is dead.
//  4. Every payout carries a memo "CLKN migration <key> #<n>". EVERY tick (armed or not) the history
//     of every payer the journal has ever used is read past a durable cursor. A memo row counts only
//     if that payer SIGNED the transaction (anyone can name an address). One of ours landing while
//     the journal thinks it dead revives it; a payer-signed memo the journal does not own halts all
//     sending once, and is adopted into its entry as a live attempt so it can never be paid again.
//  5. Paid only at FINALIZED, and only when the payout's CLKN deltas are exactly +amount to the
//     recipient and -amount from the payer; anything else freezes the entry and halts everything.
//
// Journal mutations are: fresh kv.get -> structuredClone -> edit -> kv.setVerified, in one
// synchronous block with no await between the read and the write. RPC facts are gathered first.

const M = require("./cuna-migration");
const { big } = M;

// `payers` is the append-only list of every payer ever configured, kept OUTSIDE the journal so a lost
// or restored journal cannot drop an old payer from the memo witness (see journalPayers).
const K = { config: "cunaMigConfig", list: "cunaMigList", armed: "cunaMigArmed", journal: "cunaMigJournal", payers: "cunaMigPayers" };
const MEMO_PROGRAM_ID = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
const ATA_RENT_LAMPORTS = 2039280;
const SOL_FLOOR_LAMPORTS = 10_000_000;     // 0.01 SOL always left on the payer
const BASE_FEE_LAMPORTS = 5000;
const CU_LIMIT = 100_000;
const CU_PRICE_DEFAULT = 20_000;           // micro-lamports per CU
const CU_PRICE_MAX = 500_000;              // a typo cannot turn the priority fee into a drain
// Paying from the TREASURY, whose SOL and CLKN every other treasury path also spends: the owner must
// set a SOL reserve of at least this (0.05 SOL), a CLKN reserve and an explicit total cap, and the
// priority-fee ceiling is lower (50,000 x 100,000 CU = 0.005 SOL per payout at most).
const TREASURY_SOL_RESERVE_MIN = 50_000_000;
const CU_PRICE_MAX_TREASURY = 50_000;
const SIG_PAGE = 1000;
const MAX_SIG_PAGES = 20;
const MAX_FETCH_PER_TICK = 50;
const MAX_ALERT_LINES = 10;

const sh = (s) => (s ? String(s).slice(0, 6) + "…" + String(s).slice(-4) : "?");
const ui = (raw) => { const b = big(raw); if (b === null) return String(raw); const w = b / 1000000000n, f = (b % 1000000000n).toString().padStart(9, "0").replace(/0+$/, ""); return w.toLocaleString("en-US") + (f ? "." + f : ""); };
const clamp = (v, lo, hi, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const clone = (o) => (typeof structuredClone === "function" ? structuredClone(o) : JSON.parse(JSON.stringify(o)));

function createMonitor(deps) {
  const { kv, rpcJson, conn, attempts, mints } = deps;
  const env = deps.env || (() => process.env);
  const loadSigner = deps.loadSigner || (() => null);
  const alertFn = deps.alert || (async () => null);
  const now = deps.now || (() => Date.now());
  const failpoint = deps.failpoint || (() => {});
  const log = deps.log || console;
  const treasury = () => (typeof deps.treasury === "function" ? deps.treasury() : deps.treasury) || null;
  const clknUsd = deps.clknUsd || (() => null);
  const isStaging = () => !!(typeof deps.isStaging === "function" ? deps.isStaging() : deps.isStaging);
  let busy = false;
  const LIM = { sigPage: SIG_PAGE, maxSigPages: MAX_SIG_PAGES, maxFetch: MAX_FETCH_PER_TICK, ...(deps.limits || {}) };
  // The payer-history witness stops here (see M.MEMO_EPOCH_SLOT). Injectable only so the stub chain,
  // whose slots start near 1000, can run with 0.
  const memoEpochSlot = deps.memoEpochSlot != null ? Number(deps.memoEpochSlot) : M.MEMO_EPOCH_SLOT;
  // Paying from the treasury is the owner's explicit choice (2026-11-14: "we are going to pay out of
  // the current wallet we have keys set up on"). It is on only when the env says so, and then the
  // payer must BE the treasury; otherwise the treasury is refused as before.
  const treasuryMode = () => String(E().CUNA_MIGRATION_PAYER_SOURCE || "").trim().toLowerCase() === "treasury";
  // In-memory signature walks (see walkAddress) and the classifications of rows that never become
  // entries. Losing either on a restart costs only a re-read, never a decision.
  const walks = new Map();
  const classified = new Map();
  // Payer-history memo rows already fetched and found NOT signed by that payer ("<payer>|<sig>"). A
  // finalized transaction's signers never change, so the next tick skips them instead of fetching
  // the same rows again: a slot holding more stranger rows than one tick's budget still drains.
  const notPayerSigned = new Map();

  const nowS = () => Math.floor(now() / 1000);
  const E = () => env() || {};
  const cfg = () => kv.get(K.config, null) || {};
  const list = () => kv.get(K.list, null);
  const journalRaw = () => kv.get(K.journal, null) || M.emptyJournal();
  const journalFresh = () => { const j = kv.get(K.journal, null); return j ? clone(j) : M.emptyJournal(); };
  const writeJournal = (j) => kv.setVerified(K.journal, j);
  const entryCount = (j) => Object.keys((j && j.entries) || {}).length;

  // Best effort, never durable state: the journal is the record, a Telegram line is a courtesy.
  function say(text, dedupeKey) {
    let p;
    try { p = alertFn(text, dedupeKey || null); } catch (e) { log.warn(`[cuna-migration] alert threw: ${e.message}`); return; }
    Promise.resolve(p).then((r) => { if (r == null && !dedupeKey) log.warn(`[cuna-migration] alert not delivered: ${String(text).slice(0, 80)}`); }).catch(() => {});
  }

  function detectReady(c, L) {
    return !!(c.receiveWallet && c.sinceSlot != null && c.window && Number(c.window.start) > 0 && Number(c.window.end) > Number(c.window.start) && L && Array.isArray(L.rows) && L.rows.length);
  }
  function configComplete(c, L) { return detectReady(c, L) && !!c.payerPubkey; }

  function signerFacts(c, L) {
    let s;
    try { s = loadSigner(); } catch (e) { s = { refused: "the payer secret could not be loaded" }; }
    if (!s) return { loaded: false, matches: false, why: "CUNA_MIGRATION_PAYER_SECRET is not set" };
    if (s.refused || !s.keypair) return { loaded: false, matches: false, why: s.refused || "no keypair" };
    const pk = s.keypair.publicKey.toBase58();
    const out = { loaded: true, matches: false, pubkey: pk };
    if (!c.payerPubkey) return { ...out, why: "no payer pubkey configured" };
    if (pk !== c.payerPubkey) return { ...out, why: `the payer secret is ${sh(pk)}, the configured payer is ${sh(c.payerPubkey)}` };
    out.source = s.source === "treasury" ? "treasury" : "dedicated";
    if (s.source === "treasury" && (!treasuryMode() || pk !== treasury())) return { ...out, why: "the treasury key was loaded but the payer source or the treasury address does not match — refused" };
    if (pk === treasury() && s.source !== "treasury") return { ...out, why: "the payer is the treasury — refused (set CUNA_MIGRATION_PAYER_SOURCE=treasury to pay from it on purpose)" };
    if (pk === c.receiveWallet) return { ...out, why: "the payer is the receive wallet — refused" };
    if (L && M.listIndex(L).has(pk)) return { ...out, why: "the payer is a listed wallet — refused" };
    return { ...out, matches: true, keypair: s.keypair };
  }

  // The SOL and CLKN the migration must never touch, and whether the env states them. In treasury
  // mode all three of the SOL reserve, the CLKN reserve and CUNA_MIGRATION_MAX_CLKN_RAW must be set
  // explicitly (an unset value is not armed, never a default); a value that does not parse is not
  // armed in either mode.
  function reserves() {
    const e = E(), tm = treasuryMode();
    const read = (name) => { const v = e[name]; if (v == null || String(v).trim() === "") return { set: false, v: null }; return { set: true, v: big(String(v).trim()) }; };
    const sol = read("CUNA_MIGRATION_SOL_RESERVE_LAMPORTS"), clkn = read("CUNA_MIGRATION_CLKN_RESERVE_RAW"), cap = read("CUNA_MIGRATION_MAX_CLKN_RAW");
    const why = [];
    if (sol.set && sol.v === null) why.push("CUNA_MIGRATION_SOL_RESERVE_LAMPORTS is not a raw integer");
    if (clkn.set && clkn.v === null) why.push("CUNA_MIGRATION_CLKN_RESERVE_RAW is not a raw integer");
    if (tm) {
      if (!sol.set) why.push("treasury mode needs CUNA_MIGRATION_SOL_RESERVE_LAMPORTS (the SOL the migration never touches)");
      else if (sol.v !== null && sol.v < BigInt(TREASURY_SOL_RESERVE_MIN)) why.push(`CUNA_MIGRATION_SOL_RESERVE_LAMPORTS must be at least ${TREASURY_SOL_RESERVE_MIN} (0.05 SOL) in treasury mode`);
      if (!clkn.set) why.push("treasury mode needs CUNA_MIGRATION_CLKN_RESERVE_RAW (the CLKN the migration never touches; 0 is allowed, but it must be said)");
      if (!cap.set) why.push("treasury mode needs CUNA_MIGRATION_MAX_CLKN_RAW (the most CLKN the migration may pay in all)");
    }
    const solFloorLamports = sol.v !== null && sol.v > BigInt(SOL_FLOOR_LAMPORTS) ? Number(sol.v) : SOL_FLOOR_LAMPORTS;
    return { ok: !why.length, why: why.length ? why.join("; ") : null, solFloorLamports, clknReserveRaw: clkn.v === null ? 0n : clkn.v };
  }

  function armFacts() {
    const e = E(), c = cfg(), L = list(), j = kv.get(K.journal, null);
    const sf = signerFacts(c, L);
    const rs = reserves();
    const f = {
      kvArm: kv.get(K.armed, null) === true,
      envOn: String(e.CUNA_MIGRATION_ON || "") === "1",
      envOff: String(e.CUNA_MIGRATION_OFF || "") === "1",
      staging: isStaging(),
      payerLoaded: sf.loaded, payerMatches: sf.matches, payerPubkeyLoaded: sf.pubkey || null, payerWhy: sf.matches ? null : sf.why,
      payerSource: sf.source || null,
      reservesOk: rs.ok, reservesWhy: rs.why, solReserveLamports: rs.solFloorLamports, clknReserveRaw: rs.clknReserveRaw.toString(),
      storePersistent: !!kv.isPersistent(), loadError: (kv.loadError && kv.loadError()) || null,
      halted: (j && j.halted) || null, configComplete: configComplete(c, L),
    };
    f.armed = f.kvArm && f.envOn && !f.envOff && !f.staging && f.payerMatches && f.reservesOk && f.storePersistent && !f.loadError && !f.halted && f.configComplete;
    return f;
  }

  function globalCap(L) {
    const listTotal = big(L.totals.totalClknNeededRaw);
    const o = E().CUNA_MIGRATION_MAX_CLKN_RAW;
    if (o == null || String(o).trim() === "") return { capRaw: listTotal.toString(), warn: null };
    const b = big(String(o).trim());
    if (b === null) return { capRaw: "0", warn: "CUNA_MIGRATION_MAX_CLKN_RAW is not a raw integer — treated as 0 (nothing sends) until fixed" };
    if (b > listTotal) return { capRaw: listTotal.toString(), warn: "CUNA_MIGRATION_MAX_CLKN_RAW is above the list total — ignored (it can only lower the cap)" };
    return { capRaw: b.toString(), warn: null };
  }
  const tickMax = () => clamp(E().CUNA_MIGRATION_TICK_MAX, 1, 20, 5);
  const witnessFetch = () => clamp(E().CUNA_MIGRATION_WITNESS_MAX_FETCH, 1, 2000, LIM.maxFetch);
  const cuPrice = () => clamp(E().CUNA_MIGRATION_CU_PRICE, 0, treasuryMode() ? CU_PRICE_MAX_TREASURY : CU_PRICE_MAX, CU_PRICE_DEFAULT);
  const feeLamports = () => BASE_FEE_LAMPORTS + Math.ceil((cuPrice() * CU_LIMIT) / 1e6);

  async function getTxFinalized(sig) {
    try {
      const r = await rpcJson("getTransaction", [sig, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "finalized" }]);
      if (!r || r.error || !r.result) return undefined;
      return r.result;
    } catch (_) { return undefined; }
  }

  // ── Phase 0: integrity ─────────────────────────────────────────────────────────────────────
  function halt(j, code, why) {
    if (!j.halted) j.halted = { code, why, at: nowS() };
  }
  function integrity(report) {
    const j0 = journalRaw();
    if (j0.halted) return true;
    const mm = M.creditedMismatch(j0);
    let two = null;
    for (const [k, e] of Object.entries(j0.entries || {})) if (M.liveAttempts(e).length > 1) { two = k; break; }
    if (!mm && !two) return true;
    const j = journalFresh();
    if (mm) halt(j, "credit_mismatch", `credited total for ${mm} does not match its entries`);
    else halt(j, "two_live", `${two} has more than one live payout attempt`);
    if (!writeJournal(j)) { report.blocked = "journal write failed"; return false; }
    say(`🛑 CUNA migration HALTED (${j.halted.code}): ${j.halted.why}. No payouts until the owner acks.`, `mig-halt:${j.halted.code}`);
    return true;
  }

  // ── Phase 1: adopt attempt files the journal does not list ─────────────────────────────────
  function adoptOrphans(report) {
    const files = attempts.list();
    if (!files.length) return true;
    const j = journalFresh();
    const byHash = new Map();
    for (const k of Object.keys(j.entries)) byHash.set(attempts.hashKey(k), k);
    let changed = false;
    for (const f of files) {
      const key = f.key || byHash.get(f.hash);
      const e = key && j.entries[key];
      if (!e) { halt(j, "orphan_attempt", `attempt file ${f.hash}.${f.n} has no journal entry (journal lost?)`); changed = true; continue; }
      if ((e.attempts || []).some((a) => Number(a.n) === Number(f.n))) continue;
      if (!f.partial && (f.recipient !== M.recipientOf(key, e) || String(f.clknRaw) !== String(e.clknRaw))) {
        halt(j, "attempt_mismatch", `attempt file ${key} #${f.n} pays ${sh(f.recipient)} ${f.clknRaw}, the entry says ${sh(M.recipientOf(key, e))} ${e.clknRaw}`);
      }
      e.attempts = (e.attempts || []).concat([f.partial
        ? { n: f.n, paySig: null, outcome: "live", partial: true, at: f.mtime, notFound: [], adopted: true }
        : { n: f.n, paySig: f.paySig, blockhash: f.blockhash, lastValidBlockHeight: f.lastValidBlockHeight, txBase64: f.txBase64,
            clknRaw: f.clknRaw, recipient: f.recipient, payer: f.payer, at: f.at, outcome: "live", notFound: [], adopted: true }]);
      e.attempts.sort((a, b) => Number(a.n) - Number(b.n));
      if (e.state !== "paid" && e.state !== "anomaly") { e.state = "sending"; e.reason = null; }
      changed = true;
      report.adopted++;
    }
    if (!changed) return true;
    if (!writeJournal(j)) { report.blocked = "journal write failed (adopt)"; return false; }
    if (j.halted && (j.halted.code === "orphan_attempt" || j.halted.code === "attempt_mismatch")) say(`🛑 CUNA migration HALTED (${j.halted.code}): ${j.halted.why}`, `mig-halt:${j.halted.code}`);
    return true;
  }

  // ── Phase 2: resolve every live attempt from the chain ─────────────────────────────────────
  async function resolveLive(report) {
    const j0 = journalRaw();
    const live = [];
    for (const [k, e] of Object.entries(j0.entries || {})) for (const a of e.attempts || []) if (a.outcome === "live") live.push({ k, n: a.n, a: clone(a), twin: M.liveAttempts(e).length > 1 });
    if (!live.length) return { blockSends: false };
    const c = cfg();
    let blockSends = false;
    let height;
    const verdicts = [];
    for (const { k, n, a, twin } of live) {
      const facts = {};
      if (a.paySig) {
        try {
          const r = await conn.getSignatureStatuses([a.paySig], { searchTransactionHistory: true });
          facts.status = r && Array.isArray(r.value) ? (r.value[0] || null) : undefined;
        } catch (_) { facts.status = undefined; }
        if (facts.status && !facts.status.err && facts.status.confirmationStatus === "finalized") facts.tx = await getTxFinalized(a.paySig);
        if (facts.status === null) {
          if (height === undefined) { try { height = Number(await conn.getBlockHeight("finalized")); } catch (_) { height = null; } }
          facts.height = height;
        }
      }
      const v = M.judgeAttempt(a, facts, { nowS: nowS(), payer: a.payer || c.payerPubkey, clknMint: mints.clkn });
      if (v.verdict === "unknown") blockSends = true;
      verdicts.push({ k, n, v, twin });
    }
    const j = journalFresh();
    const rebroadcast = [];
    const lines = [];
    for (const { k, n, v, twin } of verdicts) {
      const e = j.entries[k];
      const a = e && (e.attempts || []).find((x) => Number(x.n) === Number(n));
      if (!a || a.outcome !== "live") continue;
      const t = nowS();
      switch (v.verdict) {
        case "unknown": case "wait_tx": break;
        case "wait": if (v.seen && a.notFound && a.notFound.length) a.notFound = []; break;
        case "rebroadcast": if (!twin && a.txBase64) rebroadcast.push(a.txBase64); break;
        case "notfound": a.notFound = (a.notFound || []).concat([v.read]).slice(-6); break;
        case "failed": case "expired": case "abandoned":
          a.outcome = v.verdict; a.resolvedAt = t; if (v.why) a.why = v.why;
          if (!M.liveAttempts(e).length && e.state === "sending") {
            Object.assign(e, M.afterAllDead(e));
            if (e.state === "held") lines.push(`⚠️ CUNA migration: ${k.slice(0, 16)}… held after ${M.deadCount(e)} dead payout attempts — owner to look`);
          }
          break;
        case "paid":
          a.outcome = "landed"; a.resolvedAt = t;
          if (e.state === "paid" && e.paidSig && e.paidSig !== a.paySig) {
            e.state = "anomaly"; e.reason = `second payout landed (${a.paySig})`;
            halt(j, "anomaly", `${k}: a second payout landed`);
            lines.push(`🛑 CUNA migration ANOMALY: ${k.slice(0, 16)}… was paid twice on chain (${a.paySig}). All sends halted.`);
          } else if (e.state !== "anomaly") {
            e.state = "paid"; e.paidSig = a.paySig; e.paidAt = t; e.reason = null;
            report.resolved.push({ key: k, n, paid: a.paySig });
          }
          break;
        case "anomaly":
          a.outcome = "landed"; a.anomaly = v.why; a.resolvedAt = t;
          e.state = "anomaly"; e.reason = v.why;
          halt(j, "anomaly", `${k}: ${v.why}`);
          lines.push(`🛑 CUNA migration ANOMALY on ${k.slice(0, 16)}…: ${v.why}. All sends halted.`);
          break;
        default: break;
      }
    }
    if (!writeJournal(j)) { report.blocked = "journal write failed (resolve)"; return { blockSends: true }; }
    for (const l of lines) say(l, null);
    // Rebroadcast the IDENTICAL signed bytes (same signature — it cannot pay twice). Only while
    // armed: a disarmed monitor still records what landed but puts nothing on the wire.
    if (rebroadcast.length && E().CUNA_MIGRATION_OFF !== "1" && armFacts().armed) {
      for (const b of rebroadcast) {
        try { await conn.sendRawTransaction(Buffer.from(b, "base64"), { skipPreflight: true, maxRetries: 0 }); report.rebroadcast++; }
        catch (_) { /* ambiguous by design — the chain decides on the next tick */ }
      }
    }
    return { blockSends };
  }

  // ── Signature walks that cannot get stuck ──────────────────────────────────────────────────
  // getSignaturesForAddress pages newest-first. A walk from the newest signature back to the durable
  // cursor that gave up after N pages (and started over next tick) could be stalled for good by
  // anyone who puts more than N pages of cheap transactions on the address. Instead the walk keeps
  // its progress in memory across ticks as a list of open gaps, each paged with until/before, and
  // makes up to LIM.maxSigPages of progress per tick; the rows it has read wait in memory until every
  // gap is closed. Only a COMPLETE walk is processed, so chain order is never broken. A restart, or a
  // durable cursor that moved under it (another instance, an admin reset), starts the walk over.
  function walkState(id, baseSig) {
    let st = walks.get(id);
    if (!st || st.base !== (baseSig || null)) { st = { base: baseSig || null, head: null, gaps: [], rows: new Map() }; walks.set(id, st); }
    return st;
  }
  async function walkAddress(id, addr, baseSig, { commitment, stopSlot }) {
    const st = walkState(id, baseSig);
    if (!st.gaps.some((g) => !g.started)) st.gaps.push({ until: st.head || st.base, before: null, started: false, done: false });
    let pages = 0;
    for (const g of st.gaps) {
      while (!g.done && pages < LIM.maxSigPages) {
        const opts = { limit: LIM.sigPage, commitment };
        if (g.until) opts.until = g.until;
        if (g.before) opts.before = g.before;
        let r;
        try { r = await rpcJson("getSignaturesForAddress", [addr, opts]); } catch (_) { r = null; }
        if (!r || r.error || !Array.isArray(r.result)) return { unavailable: true };
        pages++;
        if (!g.started && g === st.gaps[st.gaps.length - 1] && r.result.length) st.head = r.result[0].signature;
        g.started = true;
        let stop = false;
        for (const x of r.result) {
          if (stopSlot != null && Number(x.slot) <= Number(stopSlot)) { stop = true; break; }
          if (!st.rows.has(x.signature)) st.rows.set(x.signature, x);
        }
        if (stop || r.result.length < LIM.sigPage) g.done = true;
        else g.before = r.result[r.result.length - 1].signature;
      }
      if (!g.done) break;
    }
    st.gaps = st.gaps.filter((g) => !g.done);
    return { complete: !st.gaps.length, rows: [...st.rows.values()] };
  }
  // After a durable cursor write: the walk now starts from it, and rows it covers are dropped.
  function advanceWalk(id, cur) {
    const st = walks.get(id);
    if (!st || !cur || !cur.sig) return;
    st.base = cur.sig;
    for (const [sig, x] of st.rows) if (Number(x.slot) <= Number(cur.slot)) st.rows.delete(sig);
  }
  const bySlotSig = (a, b) => (Number(a.slot) - Number(b.slot)) || (a.signature < b.signature ? -1 : a.signature > b.signature ? 1 : 0);
  // A cursor moves only over a whole slot whose every signature is processed: the node's order
  // inside one slot need not match ours, and `until` is positional. A cursor {sig, slot} therefore
  // means "every row at or below this slot is done".
  function slotCursor(rows, processed) {
    const sorted = rows.slice().sort(bySlotSig);
    let curRow = null;
    for (let i = 0; i < sorted.length;) {
      let jx = i;
      while (jx < sorted.length && Number(sorted[jx].slot) === Number(sorted[i].slot)) jx++;
      const group = sorted.slice(i, jx);
      if (!group.every((r) => processed.has(r.signature))) break;
      curRow = group[group.length - 1];
      i = jx;
    }
    return curRow ? { sig: curRow.signature, slot: Number(curRow.slot) } : null;
  }
  const laterCursor = (a, b) => (!a ? b : !b ? a : (Number(b.slot) > Number(a.slot) ? b : a));
  function receiveAta(wallet) {
    try {
      const { PublicKey } = require("@solana/web3.js");
      const spl = require("@solana/spl-token");
      return spl.getAssociatedTokenAddressSync(new PublicKey(mints.cuna), new PublicKey(wallet), false).toBase58();
    } catch (_) { return null; }
  }

  // ── Phase 3: detect new transfers into the receive wallet ──────────────────────────────────
  async function detect(report) {
    const c = cfg(), L = list();
    let accts;
    try {
      const r = await rpcJson("getTokenAccountsByOwner", [c.receiveWallet, { mint: mints.cuna }, { encoding: "jsonParsed", commitment: "finalized" }]);
      if (!r || r.error || !r.result || !Array.isArray(r.result.value)) throw new Error((r && r.error && r.error.message) || "no result");
      accts = r.result.value;
    } catch (e) { report.detect = "unavailable: token accounts"; return; }
    const current = [];
    for (const a of accts) {
      const prog = a && a.account && a.account.owner;
      const info = a && a.account && a.account.data && a.account.data.parsed && a.account.data.parsed.info;
      if (prog !== M.TOKEN_PROGRAM || !info || info.mint !== mints.cuna) { say(`⚠️ CUNA migration: receive-wallet token account ${sh(a && a.pubkey)} is not a legacy CUNA account — ignored`, `mig-acct:${a && a.pubkey}`); continue; }
      current.push(a.pubkey);
    }
    let j0 = journalRaw();
    // Every account ever seen is walked for good, and so is the receive wallet's CUNA ATA whether or
    // not it exists right now: a token account closed after a transfer landed in it still has that
    // transfer in its signature history, and getSignaturesForAddress answers for a closed address.
    const seen = new Set(j0.recvAccounts || []);
    const fresh = current.filter((a) => !seen.has(a));
    if (fresh.length) {
      const j = journalFresh();
      j.recvAccounts = [...new Set([...(j.recvAccounts || []), ...fresh])];
      if (!writeJournal(j)) { report.blocked = "journal write failed (accounts)"; return; }
      j0 = journalRaw();
    }
    const cursors = j0.cursors || {};
    const ata = receiveAta(c.receiveWallet);
    const accounts = [...new Set([...current, ...(j0.recvAccounts || []), ...Object.keys(cursors), ...(ata ? [ata] : [])])];
    const rowsByAcct = new Map();
    const sigAccts = new Map();
    const all = new Map();
    let incomplete = null;
    for (const acct of accounts) {
      const cur = cursors[acct];
      const w = await walkAddress("recv:" + acct, acct, cur && cur.sig, { commitment: "finalized", stopSlot: c.sinceSlot });
      if (w.unavailable) { report.detect = "unavailable: signatures"; return; }
      if (!w.complete) { incomplete = acct; continue; }
      const rows = w.rows.filter((x) => !cur || Number(x.slot) > Number(cur.slot));
      rowsByAcct.set(acct, rows);
      for (const x of rows) {
        if (!all.has(x.signature)) all.set(x.signature, x);
        (sigAccts.get(x.signature) || sigAccts.set(x.signature, []).get(x.signature)).push(acct);
      }
    }
    if (incomplete) {
      // Not stuck: the walk resumes from where it got to on the next tick. Nothing is processed out
      // of order meanwhile.
      report.detect = "walk_in_progress";
      say(`⏳ CUNA migration: more than ${LIM.maxSigPages} pages of signatures on ${sh(incomplete)} — the walk continues next tick`, `mig-walk:${incomplete}`);
      return;
    }
    const merged = [...all.values()].sort(bySlotSig);
    const processed = new Set();
    const planned = [];
    let fetches = 0;
    for (const x of merged) {
      if (x.err) { processed.add(x.signature); continue; }
      if (j0.entries && j0.entries[x.signature]) { processed.add(x.signature); continue; }
      const cached = classified.get(x.signature);
      if (cached) { processed.add(x.signature); if (cached.cls.kind !== "failed") planned.push(cached); continue; }
      if (fetches >= LIM.maxFetch) break;
      fetches++;
      const tx = await getTxFinalized(x.signature);
      if (!tx) { report.detect = "stopped at an unavailable transaction"; break; }
      const cls = M.classifyIncoming(tx, { mint: mints.cuna, receiver: c.receiveWallet });
      if (cls.kind === "unavailable") { report.detect = "stopped at an unreadable transaction"; break; }
      processed.add(x.signature);
      const p = { sig: x.signature, slot: Number(tx.slot) || Number(x.slot) || 0, blockTime: Number(tx.blockTime), cls };
      // Rows that never become an entry are remembered here, so the next tick does not fetch them
      // again while the cursor has not yet moved past them.
      if (cls.kind === "failed" || M.skipReason(cls)) { if (classified.size > 200000) classified.clear(); classified.set(x.signature, p); }
      if (cls.kind === "failed") continue;
      planned.push(p);
    }
    const newCursors = {};
    for (const [acct, rows] of rowsByAcct) { const cur = slotCursor(rows, processed); if (cur) newCursors[acct] = cur; }
    if (!planned.length && !Object.keys(newCursors).length) return;
    // Commit: fresh read, plan in chain order (credited applies cumulatively), cursors, ONE write.
    const j = journalFresh();
    const before = j.cursors || {};
    const after = { ...before };
    for (const [acct, cur] of Object.entries(newCursors)) after[acct] = laterCursor(before[acct], cur);
    const covers = (cs, p) => (sigAccts.get(p.sig) || []).every((a) => cs[a] && Number(cs[a].slot) >= Number(p.slot));
    const added = [];
    let skippedNow = 0;
    planned.sort((a, b) => (a.slot - b.slot) || (a.sig < b.sig ? -1 : 1));
    for (const p of planned) {
      const sk = M.skipReason(p.cls);
      if (sk) {
        // Counted only in the write that moves the cursor past it — and not if a cursor already had.
        if (covers(after, p)) {
          if (!covers(before, p)) { M.recordSkipped(j, p, sk, L); if (sk === "dust") skippedNow++; }
          classified.delete(p.sig);
        }
        continue;
      }
      const r = M.planIncoming(j, { list: L, config: c, sig: p.sig, slot: p.slot, blockTime: p.blockTime, cls: p.cls, now: nowS() });
      if (!r.existed) added.push([p.sig, r.entry]);
    }
    j.cursors = after;
    if (!writeJournal(j)) { report.blocked = "journal write failed (detect)"; return; }
    for (const [acct, cur] of Object.entries(after)) advanceWalk("recv:" + acct, cur);
    for (const x of merged) if (processed.has(x.signature) && covers(after, { sig: x.signature, slot: x.slot })) { const cc = classified.get(x.signature); if (cc && cc.cls.kind === "failed") classified.delete(x.signature); }
    report.detected += added.length;
    // Alerts only after the commit landed; bounded.
    const loud = added.filter(([, e]) => !e.quiet);
    for (const [sig, e] of loud.slice(0, MAX_ALERT_LINES)) {
      if (e.state === "due") say(`📥 CUNA migration: ${ui(e.receivedCunaRaw)} CUNA in from ${sh(e.sender)} — ${ui(e.clknRaw)} CLKN due${big(e.excessCunaRaw) > 0n ? ` (${ui(e.excessCunaRaw)} CUNA over the cap, held)` : ""} · ${sig.slice(0, 12)}…`, null);
      else if (e.state === "held") say(`✋ CUNA migration: ${ui(e.receivedCunaRaw)} CUNA in${e.sender ? ` from ${sh(e.sender)}` : ""} HELD (${e.reason}) · ${sig.slice(0, 12)}…`, null);
      else say(`📥 CUNA migration: ${ui(e.receivedCunaRaw)} CUNA in from ${sh(e.sender)} — ${e.state} · ${sig.slice(0, 12)}…`, null);
    }
    if (loud.length > MAX_ALERT_LINES) say(`CUNA migration: ${loud.length - MAX_ALERT_LINES} more transfers recorded this tick — see the admin status`, null);
    if (skippedNow) say(`CUNA migration: ${skippedNow} dust transfer(s) under 1 CUNA recorded (held, not credited) — see the admin status`, null);
  }

  // ── Phase 4: the memo witness, every tick ──────────────────────────────────────────────────
  // Walks each payer's history past its durable cursor. Rows that are our own attempts (key, n AND
  // signature match) are recorded in j.witnessed; a payer-SIGNED memo row the journal does not own
  // goes to j.memoUnknown and halts once. Then, from those durable maps: a witnessed attempt the
  // journal judged dead is revived (the resolver records it from the chain next tick, and a second
  // landing becomes an anomaly), and an unknown memo whose key has an entry is adopted into it as a
  // live attempt, so that entry is never paid again. Returns {blockSends}.
  // Every payer ever configured comes from THREE places, two of them outside the journal: the config
  // (payerPubkey and its append-only payerHistory) and kv cunaMigPayers. A payer rotation followed by
  // a lost journal would otherwise leave the old payer unread, and its payouts would be paid again.
  function payerHistory(c) {
    const kvList = kv.get(K.payers, null);
    return [...(Array.isArray(c.payerHistory) ? c.payerHistory : []), ...(Array.isArray(kvList) ? kvList : [])].filter((x) => typeof x === "string" && x);
  }
  function journalPayers(j, c) {
    const out = new Set();
    if (c.payerPubkey) out.add(c.payerPubkey);
    for (const p of payerHistory(c)) out.add(p);
    for (const e of Object.values(j.entries || {})) for (const a of e.attempts || []) if (a.payer) out.add(a.payer);
    for (const k of Object.keys(j.payerCursors || {})) out.add(k);
    return [...out];
  }
  async function witness(report) {
    const c = cfg();
    const j0 = journalRaw();
    const payers = journalPayers(j0, c);
    if (!payers.length) return { blockSends: false };
    const pc = j0.payerCursors || {};
    let block = null;
    const ours = [], unknownSigned = [], newCursors = {};
    // Memo rows this tick could not check name the keys they claim to pay. Only THOSE keys wait (the
    // pay loop skips them); every other due key is safe to pay, because each payout we sign carries a
    // memo naming its own key and the walk read every row above the cursor. So stranger rows that
    // name the payer cannot hold up everyone's payouts, only the keys they name, and only until the
    // checks (cached across ticks) catch up.
    const blockKeys = new Set();
    let unchecked = null;
    const budget = witnessFetch();
    let fetches = 0;
    for (const P of payers) {
      const cur = pc[P];
      const w = await walkAddress("payer:" + P, P, cur && cur.sig, { commitment: "finalized", stopSlot: memoEpochSlot });
      if (w.unavailable) { block = "payer history unavailable"; continue; }
      if (!w.complete) { block = "payer history walk in progress"; continue; }
      const rows = w.rows.filter((x) => !cur || Number(x.slot) > Number(cur.slot)).sort(bySlotSig);
      const processed = new Set();
      for (const x of rows) {
        const memos = x.err ? [] : M.keysFromMemo(x.memo);
        if (!memos.length) { processed.add(x.signature); continue; }
        const mine = memos.every(({ key, n }) => { const e = j0.entries && j0.entries[key]; return !!(e && (e.attempts || []).some((a) => Number(a.n) === n && a.paySig === x.signature)); });
        if (mine) { for (const m of memos) ours.push({ sig: x.signature, payer: P, ...m }); processed.add(x.signature); continue; }
        const vk = P + "|" + x.signature;
        if (notPayerSigned.has(vk)) { processed.add(x.signature); continue; }
        if (unchecked || fetches >= budget) { unchecked = unchecked || "payer history: memo rows left to check"; for (const m of memos) blockKeys.add(m.key); continue; }
        fetches++;
        const tx = await getTxFinalized(x.signature);
        if (!tx) { unchecked = "payer history: a memo transaction is unavailable"; for (const m of memos) blockKeys.add(m.key); continue; }
        const signed = M.payerSigned(tx, P);
        processed.add(x.signature);
        if (signed === false) {                    // someone else's transaction that names the payer: not ours, not a payout
          if (notPayerSigned.size > 200000) notPayerSigned.clear();
          notPayerSigned.set(vk, true);
          continue;
        }
        for (const m of memos) unknownSigned.push({ sig: x.signature, payer: P, ...m });
      }
      const nc = slotCursor(rows, processed);
      if (nc) newCursors[P] = nc;
    }
    // A dead attempt is never forgotten: every attempt judged EXPIRED (not found past its blockhash —
    // a judgement a lagging or failed-over node can get wrong) has its status asked again each tick.
    // If it turns up after all, it is revived below. A history cursor alone would miss a node that
    // back-fills an older row after a newer one was read.
    const expired = [];
    for (const e of Object.values(j0.entries || {})) for (const a of e.attempts || []) if (a.outcome === "expired" && a.paySig) expired.push(a.paySig);
    const turnedUp = new Set();
    for (let i = 0; i < expired.length; i += 256) {
      const chunk = expired.slice(i, i + 256);
      let r;
      try { r = await conn.getSignatureStatuses(chunk, { searchTransactionHistory: true }); } catch (_) { r = null; }
      if (!r || !Array.isArray(r.value)) break;     // the earlier judgement stands; this is a backstop
      r.value.forEach((st, k) => { if (st && !st.err) turnedUp.add(chunk[k]); });
    }
    // Commit (synchronous): fresh read, record, reconcile, one write.
    const j = journalFresh();
    let changed = false, newUnknown = 0, revived = 0, adopted = 0;
    j.witnessed = j.witnessed || {}; j.memoUnknown = j.memoUnknown || {}; j.payerCursors = j.payerCursors || {};
    for (const o of ours) if (!j.witnessed[o.sig]) { j.witnessed[o.sig] = { key: o.key, n: o.n, payer: o.payer }; changed = true; }
    for (const u of unknownSigned) {
      const id = `${u.sig}|${u.key}|${u.n}`;
      if (j.memoUnknown[id]) continue;
      j.memoUnknown[id] = { sig: u.sig, key: u.key, n: u.n, payer: u.payer, at: nowS(), adopted: false };
      newUnknown++; changed = true;
    }
    for (const [P, cur] of Object.entries(newCursors)) {
      const next = laterCursor(j.payerCursors[P], cur);
      if (!j.payerCursors[P] || next.sig !== j.payerCursors[P].sig) { j.payerCursors[P] = next; changed = true; }
    }
    for (const [sig, wv] of Object.entries(j.witnessed)) {
      const e = j.entries[wv.key];
      const a = e && (e.attempts || []).find((x) => Number(x.n) === Number(wv.n) && x.paySig === sig);
      if (!a || !M.isDead(a)) continue;
      // The journal judged it dead; the payer's finalized history shows it landed without error.
      // Revive it so the resolver records it from the chain; never build another beside it.
      a.outcome = "live"; a.notFound = []; a.revived = (a.revived || 0) + 1;
      if (e.state !== "paid" && e.state !== "anomaly") { e.state = "sending"; e.reason = null; }
      revived++; changed = true;
    }
    for (const e of Object.values(j.entries || {})) {
      for (const a of e.attempts || []) {
        if (a.outcome !== "expired" || !turnedUp.has(a.paySig)) continue;
        a.outcome = "live"; a.notFound = []; a.revived = (a.revived || 0) + 1;
        if (e.state !== "paid" && e.state !== "anomaly") { e.state = "sending"; e.reason = null; }
        revived++; changed = true;
      }
    }
    for (const u of Object.values(j.memoUnknown)) {
      if (u.adopted) continue;
      const e = j.entries[u.key];
      if (!e) continue;                                   // no entry (yet): the pay loop skips the key meanwhile
      const a = (e.attempts || []).find((x) => Number(x.n) === Number(u.n));
      if (a && a.paySig === u.sig) { u.adopted = true; changed = true; continue; }
      if (a) { halt(j, "memo_conflict", `${u.key} #${u.n} has two payer-signed transactions (${a.paySig}, ${u.sig})`); u.adopted = "conflict"; changed = true; continue; }
      e.attempts = (e.attempts || []).concat([{ n: Number(u.n), paySig: u.sig, blockhash: null, lastValidBlockHeight: 0, txBase64: null,
        clknRaw: e.clknRaw, recipient: M.recipientOf(u.key, e), payer: u.payer, at: nowS(), outcome: "live", notFound: [], adopted: "memo" }]);
      e.attempts.sort((x, y) => Number(x.n) - Number(y.n));
      if (e.state !== "paid" && e.state !== "anomaly") { e.state = "sending"; e.reason = null; }
      j.witnessed[u.sig] = { key: u.key, n: Number(u.n), payer: u.payer };
      u.adopted = true; adopted++; changed = true;
    }
    if (newUnknown) halt(j, "unknown_memo", `payer history carries ${newUnknown} payer-signed payout(s) the journal does not own: ${unknownSigned.slice(0, 3).map((u) => `${u.key} #${u.n} (${u.sig})`).join(", ")}`);
    if (changed) {
      if (!writeJournal(j)) { report.blocked = "journal write failed (memo witness)"; return { blockSends: true }; }
      for (const [P, cur] of Object.entries(j.payerCursors)) advanceWalk("payer:" + P, cur);
    }
    report.witness = { revived, adopted, newUnknown, block, unchecked, blockedKeys: blockKeys.size };
    if (newUnknown) say(`🛑 CUNA migration HALTED (unknown_memo): ${j.halted ? j.halted.why : "unknown payer-signed memo"}`, "mig-halt:unknown_memo");
    if (j.halted && j.halted.code === "memo_conflict") say(`🛑 CUNA migration HALTED (memo_conflict): ${j.halted.why}`, "mig-halt:memo_conflict");
    if (block) say(`⚠️ CUNA migration: ${block} — no sends this tick`, "mig-hist");
    else if (unchecked) say(`⚠️ CUNA migration: ${unchecked} — the ${blockKeys.size} key(s) they name wait, the rest pay`, "mig-hist-keys");
    return { blockSends: !!block, blockKeys };
  }

  // ── Chain reads the sender needs ───────────────────────────────────────────────────────────
  async function payerBalances(payer) {
    const { PublicKey } = require("@solana/web3.js");
    const spl = require("@solana/spl-token");
    const ata = spl.getAssociatedTokenAddressSync(new PublicKey(mints.clkn), new PublicKey(payer), false).toBase58();
    const b = await rpcJson("getBalance", [payer, { commitment: "confirmed" }]);
    if (!b || b.error || !b.result || !Number.isFinite(Number(b.result.value))) throw new Error("getBalance unavailable");
    const t = await rpcJson("getTokenAccountsByOwner", [payer, { mint: mints.clkn }, { encoding: "jsonParsed", commitment: "confirmed" }]);
    if (!t || t.error || !t.result || !Array.isArray(t.result.value)) throw new Error("payer token accounts unavailable");
    const row = t.result.value.find((v) => v.pubkey === ata);
    const amt = row ? big(row.account.data.parsed.info.tokenAmount.amount) : 0n;
    return { lamports: Number(b.result.value), clknRaw: amt === null ? 0n : amt, ata };
  }
  async function mintFacts() {
    const r = await rpcJson("getAccountInfo", [mints.clkn, { encoding: "jsonParsed", commitment: "confirmed" }]);
    if (!r || r.error || !r.result || !r.result.value) throw new Error("CLKN mint unavailable");
    const v = r.result.value;
    const info = v.data && v.data.parsed && v.data.parsed.info;
    if (v.owner !== M.TOKEN_PROGRAM || !info || Number(info.decimals) !== 9) throw new Error("CLKN mint is not a legacy 9-decimal SPL mint");
    return { mintAuthority: info.mintAuthority || null };
  }
  function recipientAta(recipient) {
    const { PublicKey } = require("@solana/web3.js");
    const spl = require("@solana/spl-token");
    return spl.getAssociatedTokenAddressSync(new PublicKey(mints.clkn), new PublicKey(recipient), true).toBase58();
  }
  function buildPayout(kp, recipient, amountRaw, memo, bh) {
    const { Transaction, PublicKey, ComputeBudgetProgram, TransactionInstruction } = require("@solana/web3.js");
    const spl = require("@solana/spl-token");
    const mint = new PublicKey(mints.clkn), payer = kp.publicKey, owner = new PublicKey(recipient);
    const src = spl.getAssociatedTokenAddressSync(mint, payer, false);
    const dst = spl.getAssociatedTokenAddressSync(mint, owner, true);
    const tx = new Transaction({ feePayer: payer, blockhash: bh.blockhash, lastValidBlockHeight: bh.lastValidBlockHeight })
      .add(ComputeBudgetProgram.setComputeUnitLimit({ units: CU_LIMIT }))
      .add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: cuPrice() }))
      .add(spl.createAssociatedTokenAccountIdempotentInstruction(payer, dst, owner, mint))
      .add(spl.createTransferCheckedInstruction(src, mint, dst, payer, BigInt(amountRaw), 9))
      .add(new TransactionInstruction({ keys: [], programId: new PublicKey(MEMO_PROGRAM_ID), data: Buffer.from(memo, "utf8") }));
    assertPayoutShape(tx, { payer: payer.toBase58(), mint: mints.clkn, src: src.toBase58(), dst: dst.toBase58(), owner: recipient, amountRaw });
    tx.sign(kp);
    return tx;
  }

  function holdEntry(key, reason) {
    const j = journalFresh();
    const e = j.entries[key];
    if (!e || e.state !== "due" || M.liveAttempts(e).length) return false;
    e.state = "held"; e.reason = reason;
    return writeJournal(j);
  }

  // ── Phase 4: pay due entries (only when armed) ─────────────────────────────────────────────
  async function pay(report, { blockSends, blockKeys }) {
    const f = armFacts();
    if (!f.armed) { report.pay = "disarmed"; return; }
    if (blockSends) { report.pay = "blocked: an in-flight payout or the payer history could not be resolved"; return; }
    const c = cfg(), L = list();
    const sf = signerFacts(c, L);
    if (!sf.matches) { report.pay = "payer refused"; return; }
    const due0 = Object.entries(journalRaw().entries || {}).filter(([, e]) => e.state === "due")
      .sort(([ka, a], [kb, b]) => (Number(a.slot) - Number(b.slot)) || (ka < kb ? -1 : 1)).map(([k]) => k);
    if (!due0.length) { report.pay = "nothing due"; return; }
    const payer = c.payerPubkey;
    let bal;
    try {
      const mf = await mintFacts();
      if (mf.mintAuthority && mf.mintAuthority === payer) {
        say(`🛑 CUNA migration: the payer ${sh(payer)} is the CLKN mint authority — refusing to sign`, "mig-mintauth");
        report.pay = "payer is the mint authority"; return;
      }
      bal = await payerBalances(payer);
    } catch (e) { report.pay = "unavailable: " + e.message; return; }
    if (M.payableCount(journalRaw()) > M.MAX_ENTRIES) {
      say(`🛑 CUNA migration: the journal holds more than ${M.MAX_ENTRIES} payable entries — no new sends (resolution and detection continue)`, "mig-big");
      report.pay = "journal too large"; return;
    }
    const cap = globalCap(L);
    if (cap.warn) report.capWarn = cap.warn;
    const fee = feeLamports();
    const rs = reserves();
    if (!rs.ok) { report.pay = "reserves not set"; return; }
    const solNeed = fee + ATA_RENT_LAMPORTS + rs.solFloorLamports;
    let liveClkn = 0n;
    for (const e of Object.values(journalRaw().entries || {})) for (const a of M.liveAttempts(e)) liveClkn += big(a.clknRaw) || 0n;
    // The CLKN reserve is never spent: what the payer holds above it, less what is already in flight.
    let clknAvail = bal.clknRaw - liveClkn - rs.clknReserveRaw;
    let lamports = bal.lamports;
    let sent = 0;
    const max = tickMax();
    const sentTo = new Set();                         // one payout per recipient per tick: dust cannot crowd others out
    const pendingMemo = new Set(Object.values(journalRaw().memoUnknown || {}).filter((u) => u.adopted !== true).map((u) => u.key));
    for (const key of due0) {
      if (sent >= max) { report.pay = "tick limit"; break; }
      if (pendingMemo.has(key)) continue;             // a payer-signed payout for this key exists that the journal has not adopted
      if (blockKeys && blockKeys.has(key)) continue;  // a memo row naming this key is not checked yet
      if (E().CUNA_MIGRATION_OFF === "1" || !armFacts().armed) { report.pay = "disarmed during the tick"; break; }
      const j1 = journalRaw();
      const e1 = j1.entries[key];
      if (!e1 || e1.state !== "due" || M.liveAttempts(e1).length) continue;
      if (M.deadCount(e1) >= M.MAX_ATTEMPTS) { holdEntry(key, "attempts_exhausted"); continue; }
      const cc = M.capCheck(j1, key, e1, { list: L, globalCapRaw: cap.capRaw });
      if (!cc.ok) {
        if (cc.hold) { holdEntry(key, cc.hold); say(`✋ CUNA migration: ${key.slice(0, 16)}… held (${cc.why})`, null); continue; }
        say(`✋ CUNA migration: global cap reached (${cc.why}) — due payouts wait`, "mig-globalcap");
        report.pay = "global cap"; break;
      }
      const amt = big(e1.clknRaw);
      if (clknAvail < amt || lamports < solNeed) {
        say(`⚠️ CUNA migration: payer ${sh(payer)} is short — has ${ui((clknAvail < 0n ? 0n : clknAvail).toString())} CLKN free above the reserve and ${(lamports / 1e9).toFixed(4)} SOL, the next payout needs ${ui(amt.toString())} CLKN and ${(solNeed / 1e9).toFixed(4)} SOL (${(rs.solFloorLamports / 1e9).toFixed(4)} SOL of it is the reserve). Payouts wait.`, "mig-short");
        report.pay = "payer short"; report.short = { clknAvailRaw: clknAvail.toString(), lamports, needClknRaw: amt.toString(), needLamports: solNeed };
        break;
      }
      const n0 = M.nextAttemptNo(e1, attempts.forKey(key));
      if (n0 === null) continue;
      const recipient = M.recipientOf(key, e1);
      if (sentTo.has(recipient)) continue;
      if (M.offCurveRefused(M.listIndex(L).get(recipient))) {
        holdEntry(key, "off_curve"); say(`✋ CUNA migration: ${key.slice(0, 16)}… held — the recipient ${sh(recipient)} is off the curve and not allowed on the list`, null); continue;
      }
      // The payer funds the recipient's CLKN ATA once. If a wallet that was already paid has closed
      // that account (which refunds ITS rent to whoever closes it), re-creating it on every payout
      // would let it drain the payer's SOL — so a later payout to a closed ATA is held for the owner.
      if (j1.entries && Object.entries(j1.entries).some(([k, x]) => k !== key && x.state === "paid" && M.recipientOf(k, x) === recipient)) {
        let gone;
        try {
          const r = await rpcJson("getAccountInfo", [recipientAta(recipient), { encoding: "base64", commitment: "confirmed" }]);
          if (!r || r.error || !r.result) throw new Error("no result");
          gone = !r.result.value;
        } catch (_) { report.pay = "unavailable: recipient account"; continue; }
        if (gone) {
          holdEntry(key, "recipient_ata_closed");
          say(`✋ CUNA migration: ${key.slice(0, 16)}… held — ${sh(recipient)} was paid before and has since closed its CLKN account; the owner pays this one by hand`, null);
          continue;
        }
      }
      let bh;
      try { bh = await conn.getLatestBlockhash("confirmed"); } catch (e) { report.pay = "unavailable: blockhash"; break; }
      const bs58 = require("bs58");
      const tx = buildPayout(sf.keypair, recipient, amt, M.memoFor(key, n0), bh);
      const paySig = bs58.encode(tx.signature);
      const bytes = tx.serialize();
      failpoint("after_sign", { key, n: n0 });
      // ── synchronous: fresh read, re-check, claim the attempt file, journal — no await ──
      const j2 = journalFresh();
      const e2 = j2.entries[key];
      if (!e2 || e2.state !== "due" || M.liveAttempts(e2).length || String(e2.clknRaw) !== amt.toString()) continue;
      if (M.nextAttemptNo(e2, attempts.forKey(key)) !== n0) continue;
      const rec = { paySig, blockhash: bh.blockhash, lastValidBlockHeight: bh.lastValidBlockHeight, txBase64: bytes.toString("base64"),
        clknRaw: amt.toString(), recipient, payer, at: nowS() };
      const cl = attempts.claim(key, n0, rec);
      if (cl.exists) continue;                         // another instance owns this attempt
      if (!cl.ok) { report.pay = "attempt file write failed"; say(`🛑 CUNA migration: could not write the attempt file (${cl.error}) — no sends`, "mig-attemptfile"); break; }
      failpoint("after_claim", { key, n: n0 });
      e2.attempts = (e2.attempts || []).concat([{ n: n0, ...rec, outcome: "live", notFound: [] }]);
      e2.state = "sending"; e2.reason = null;
      if (!writeJournal(j2)) { report.pay = "journal write failed"; report.blocked = "journal write failed (send)"; say("🛑 CUNA migration: the journal write failed before a send — nothing broadcast, sends stopped", "mig-journalfail"); break; }
      failpoint("after_journal", { key, n: n0 });
      // ── end synchronous ──
      if (E().CUNA_MIGRATION_OFF === "1" || !armFacts().armed) { report.pay = "disarmed before broadcast"; break; }
      try { await conn.sendRawTransaction(bytes, { skipPreflight: false, maxRetries: 0 }); }
      catch (e) { log.warn(`[cuna-migration] send ${paySig.slice(0, 12)}… returned an error (resolved from the chain next tick): ${String(e && e.message || e).slice(0, 160)}`); }
      failpoint("after_send", { key, n: n0 });
      sent++;
      sentTo.add(recipient);
      clknAvail -= amt;
      lamports -= fee + ATA_RENT_LAMPORTS;
      report.sent.push({ key, n: n0, paySig, recipient, clknRaw: amt.toString() });
      say(`💸 CUNA migration: sending ${ui(amt.toString())} CLKN to ${sh(recipient)} for ${e2.kind === "day0" ? "Day 0" : key.slice(0, 12) + "…"} · ${paySig}`, null);
    }
    if (!report.pay) report.pay = sent ? "sent" : "nothing sent";
  }

  // ── The tick ───────────────────────────────────────────────────────────────────────────────
  async function runTick(reason) {
    if (E().CUNA_MIGRATION_OFF === "1") return { ok: false, off: true };
    const c = cfg(), L = list();
    if (!detectReady(c, L)) return { ok: false, reason: "not configured" };
    if (!kv.isPersistent() || (kv.loadError && kv.loadError())) {
      say("🛑 CUNA migration: the kv store is not persistent (or failed to load) — the monitor does nothing", "mig-store");
      return { ok: false, reason: "store not persistent" };
    }
    const report = { ok: true, reason, at: nowS(), adopted: 0, resolved: [], rebroadcast: 0, detected: 0, sent: [] };
    if (!integrity(report)) return { ...report, ok: false };
    if (!adoptOrphans(report)) return { ...report, ok: false };
    const rs = await resolveLive(report);
    if (report.blocked) return { ...report, ok: false };
    await detect(report);
    if (report.blocked) return { ...report, ok: false };
    const ws = await witness(report);
    if (report.blocked) return { ...report, ok: false };
    await pay(report, { blockSends: rs.blockSends || ws.blockSends, blockKeys: ws.blockKeys });
    const j = journalFresh();
    j.lastTick = { at: nowS(), reason, detected: report.detected, sent: report.sent.length, resolved: report.resolved.length, pay: report.pay || null, detect: report.detect || "ok" };
    writeJournal(j);
    return report;
  }
  async function tick(reason = "timer") {
    if (busy) return { ok: false, busy: true };
    busy = true;
    try { return await runTick(reason); } finally { busy = false; }
  }

  // ── Day 0 ──────────────────────────────────────────────────────────────────────────────────
  function day0Rows() {
    const L = list();
    const j = journalRaw();
    const rows = [];
    let total = 0n;
    for (const r of (L && L.rows) || []) {
      const l = big(r.day0LocksClknRaw), w = big(r.day0RewardsClknRaw);
      if (l + w <= 0n) continue;
      const e = j.entries["day0:" + r.wallet];
      total += l + w;
      rows.push({ wallet: r.wallet, locksClknRaw: l.toString(), rewardsClknRaw: w.toString(), clknRaw: (l + w).toString(),
        offCurve: !M.isOnCurve(r.wallet), allowOffCurve: r.allowOffCurve === true, refusedOffCurve: M.offCurveRefused(r),
        existing: e ? { state: e.state, paySig: e.paidSig || null } : null });
    }
    return { rows, totalClknRaw: total.toString() };
  }
  async function day0Preview() {
    const { rows, totalClknRaw } = day0Rows();
    const c = cfg();
    const pending = rows.filter((r) => !r.existing).reduce((a, r) => a + big(r.clknRaw), 0n);
    let payer = null;
    if (c.payerPubkey) {
      try {
        const b = await payerBalances(c.payerPubkey), rs = reserves();
        const free = b.clknRaw > rs.clknReserveRaw ? b.clknRaw - rs.clknReserveRaw : 0n;
        payer = { clknRaw: b.clknRaw.toString(), lamports: b.lamports, clknReserveRaw: rs.clknReserveRaw.toString(), clknAboveReserveRaw: free.toString(), coversNewDay0: free >= pending };
      }
      catch (e) { payer = { error: "unavailable" }; }
    }
    return { dryRun: true, lockers: rows.length, rows, totalClknRaw, notYetCreatedClknRaw: pending.toString(), payer, armed: armFacts().armed };
  }
  async function day0Run(confirm) {
    if (String(confirm || "") !== "pay-day0") return { ok: false, status: 400, error: "paying Day 0 needs run=1&confirm=pay-day0" };
    const f = armFacts();
    if (!f.armed) return { ok: false, status: 409, error: "not armed — Day 0 pays only with both arm flags set", armFacts: f };
    if (busy) return { ok: false, status: 409, error: "a tick is running — try again in a moment" };
    busy = true;
    try {
      const L = list();
      const j = journalFresh();
      const created = [];
      for (const r of L.rows) {
        const l = big(r.day0LocksClknRaw), w = big(r.day0RewardsClknRaw);
        if (l + w <= 0n) continue;
        const key = "day0:" + r.wallet;
        if (j.entries[key]) continue;
        j.entries[key] = { kind: "day0", wallet: r.wallet, slot: 0, blockTime: 0, sender: null, receivedCunaRaw: "0", creditCunaRaw: "0", excessCunaRaw: "0",
          clknRaw: (l + w).toString(), locksClknRaw: l.toString(), rewardsClknRaw: w.toString(),
          state: "due", reason: null, detectedAt: nowS(), attempts: [], paidSig: null, paidAt: null };
        created.push(key);
      }
      if (created.length && !writeJournal(j)) return { ok: false, status: 500, error: "journal write failed — nothing created, nothing sent" };
      const tickReport = await runTick("day0");
      return { ok: true, created: created.length, tick: tickReport };
    } finally { busy = false; }
  }

  // ── Admin actions ──────────────────────────────────────────────────────────────────────────
  const fail = (status, error) => ({ ok: false, status, error });
  function disarmedAndEmpty(needEmpty) {
    if (kv.get(K.armed, null) === true) return fail(409, "disarm first");
    if (busy) return fail(409, "a tick is running — try again in a moment");
    if (needEmpty && entryCount(journalRaw())) return fail(409, "the journal already holds transfers — this can no longer change");
    return null;
  }
  async function setReceive(addr) {
    const blocked = disarmedAndEmpty(true); if (blocked) return blocked;
    const a = String(addr || "").trim();
    if (!M.isWalletAddress(a)) return fail(400, "receive wallet must be a base58 wallet address on the curve (not a program-derived address)");
    const c = cfg(), L = list();
    if (a === treasury()) return fail(400, "the receive wallet cannot be the treasury — use a fresh dedicated wallet");
    if (a === c.payerPubkey) return fail(400, "the receive wallet cannot be the payer");
    if (L && M.listIndex(L).has(a)) return fail(400, "the receive wallet is on the payout list");
    let slot;
    try {
      const ai = await rpcJson("getAccountInfo", [a, { encoding: "base64", commitment: "finalized" }]);
      if (!ai || ai.error || !ai.result) return fail(503, "could not read the receive wallet's account");
      const v = ai.result.value;
      if (v && (v.owner !== M.SYSTEM_PROGRAM || v.executable || (Array.isArray(v.data) ? String(v.data[0] || "") !== "" : !!v.data))) {
        return fail(400, "the receive wallet is not a plain system-owned wallet");
      }
      const s = await rpcJson("getSlot", [{ commitment: "finalized" }]);
      if (!s || s.error || !Number.isFinite(Number(s.result))) return fail(503, "could not read the current slot");
      slot = Number(s.result);
    } catch (e) { return fail(503, "RPC unavailable"); }
    const next = { ...c, receiveWallet: a, sinceSlot: slot, sinceUnix: nowS(), setAt: nowS() };
    const j = journalFresh(); j.cursors = {}; j.recvAccounts = [];
    for (const k of [...walks.keys()]) if (k.startsWith("recv:")) walks.delete(k);
    classified.clear();
    if (!kv.setManyVerified({ [K.config]: next, [K.journal]: j })) return fail(500, "write failed");
    return { ok: true, receiveWallet: a, sinceSlot: slot };
  }
  function setPayer(pk) {
    const blocked = disarmedAndEmpty(false); if (blocked) return blocked;
    const a = String(pk || "").trim();
    if (!M.isWalletAddress(a)) return fail(400, "payer must be a base58 wallet address on the curve");
    const c = cfg(), L = list();
    if (a === treasury() && !treasuryMode()) return fail(400, "the payer cannot be the treasury unless CUNA_MIGRATION_PAYER_SOURCE=treasury is set");
    if (treasuryMode() && a !== treasury()) return fail(400, "CUNA_MIGRATION_PAYER_SOURCE=treasury is set, so the payer must be the treasury wallet");
    if (a === c.receiveWallet) return fail(400, "the payer cannot be the receive wallet");
    if (L && M.listIndex(L).has(a)) return fail(400, "the payer is on the payout list");
    if (Object.values(journalRaw().entries || {}).some((e) => M.liveAttempts(e).length)) return fail(409, "a payout is in flight — wait for it to resolve");
    // Append-only, in the config AND in its own key, in one verified write: the witness reads every
    // payer ever set, so a rotation followed by a lost journal still sees the old payer's payouts.
    const hist = [...new Set([...payerHistory(c), ...(c.payerPubkey ? [c.payerPubkey] : []), a])];
    if (!kv.setManyVerified({ [K.config]: { ...c, payerPubkey: a, payerHistory: hist, setAt: nowS() }, [K.payers]: hist })) return fail(500, "write failed");
    return { ok: true, payerPubkey: a, payerHistory: hist };
  }
  function setList(rows) {
    const blocked = disarmedAndEmpty(true); if (blocked) return blocked;
    const c = cfg();
    const v = M.validateList(rows, { forbidden: [c.receiveWallet, c.payerPubkey, treasury()] });
    if (!v.ok) return { ok: false, status: 400, error: "list refused", errors: v.errors.slice(0, 50) };
    if (!kv.setVerified(K.list, { rows: v.rows, sha256: v.sha256, totals: v.totals, offCurve: v.offCurve, uploadedAt: nowS() })) return fail(500, "write failed");
    return { ok: true, sha256: v.sha256, totals: v.totals, offCurve: v.offCurve };
  }
  function setWindow(start, end) {
    const blocked = disarmedAndEmpty(false); if (blocked) return blocked;
    const s = Number(start);
    if (!Number.isInteger(s) || s < 1600000000 || s > 4102444800) return fail(400, "start must be a unix time in seconds");
    const e = end == null || end === "" ? s + M.WINDOW_DEFAULT_S : Number(end);
    if (!Number.isInteger(e) || e <= s) return fail(400, "end must be a unix time after start");
    const c = cfg();
    if (!kv.setVerified(K.config, { ...c, window: { start: s, end: e }, setAt: nowS() })) return fail(500, "write failed");
    return { ok: true, window: { start: s, end: e } };
  }
  function arm(confirm) {
    if (String(confirm || "") !== "arm-cuna-migration") return fail(400, "arming needs arm=1&confirm=arm-cuna-migration");
    const c = cfg(), L = list();
    if (!configComplete(c, L)) return fail(409, "set the receive wallet, payer, list and window first");
    if (!kv.isPersistent() || (kv.loadError && kv.loadError())) return fail(409, "the kv store is not persistent");
    if (journalRaw().halted) return fail(409, "the journal is halted — ack it first");
    const rs = reserves();
    if (!rs.ok) return fail(409, rs.why);
    if (!kv.setVerified(K.armed, true)) return fail(500, "write failed");
    const f = armFacts();
    return { ok: true, kvArm: true, envOn: f.envOn, armed: f.armed, armFacts: f };
  }
  function disarm() {
    const ok = kv.setVerified(K.armed, false);
    if (!ok) kv.set(K.armed, false);
    return { ok: true, kvArm: false, durable: ok, note: ok ? null : "the disarm did not verify on disk — set CUNA_MIGRATION_OFF=1 for a durable stop" };
  }
  function hold(key) {
    const k = String(key || "");
    const j = journalRaw();
    const e = j.entries[k];
    if (!e) return fail(404, "no such entry");
    if (e.state !== "due" || M.liveAttempts(e).length) return fail(409, `only a due entry with nothing in flight can be held (this one is ${e.state})`);
    if (!holdEntry(k, "owner")) return fail(500, "write failed");
    return { ok: true, key: k, state: "held", reason: "owner" };
  }
  function ack(code) {
    const j = journalFresh();
    if (!j.halted) return fail(409, "not halted");
    if (String(code || "") !== j.halted.code) return fail(400, `ack must name the halt code (${j.halted.code})`);
    const was = j.halted;
    j.halted = null;
    j.acks = (j.acks || []).concat([{ ...was, ackedAt: nowS() }]).slice(-20);
    if (!writeJournal(j)) return fail(500, "write failed");
    return { ok: true, cleared: was };
  }

  // ── Reads ──────────────────────────────────────────────────────────────────────────────────
  function publicTerms() {
    const c = cfg(), L = list();
    const configured = detectReady(c, L);
    const t = nowS();
    return { configured, receiveWallet: configured ? c.receiveWallet : null, rate: "27,700 CLKN per 1,000,000 CUNA",
      window: configured ? c.window : null, live: configured && armFacts().armed && t >= c.window.start && t < c.window.end };
  }
  function publicLookup(wallet) {
    const c = cfg(), L = list();
    if (!detectReady(c, L)) return null;
    return M.publicView(journalRaw(), L, wallet);
  }
  async function status({ chain = true } = {}) {
    const c = cfg(), L = list(), j = journalRaw(), f = armFacts();
    const entries = Object.entries(j.entries || {});
    const row = ([k, e]) => ({ key: k, kind: e.kind, recipient: M.recipientOf(k, e), receivedCunaRaw: e.receivedCunaRaw, creditCunaRaw: e.creditCunaRaw,
      excessCunaRaw: e.excessCunaRaw, clknRaw: e.clknRaw, state: e.state, reason: e.reason, paidSig: e.paidSig,
      attempts: (e.attempts || []).map((a) => ({ n: a.n, paySig: a.paySig, outcome: a.outcome, lastValidBlockHeight: a.lastValidBlockHeight, notFound: (a.notFound || []).length })) });
    let paid = 0n, sending = 0n, due = 0n;
    for (const [, e] of entries) { const v = big(e.clknRaw) || 0n; if (e.state === "paid") paid += v; else if (e.state === "sending") sending += v; else if (e.state === "due") due += v; }
    const cap = L ? globalCap(L) : null;
    const total = L ? big(L.totals.totalClknNeededRaw) : 0n;
    const price = Number(clknUsd());
    const owedRemaining = total > paid ? total - paid : 0n;
    let payer = null;
    if (c.payerPubkey) {
      const rs = reserves();
      payer = { pubkey: c.payerPubkey, payerHistory: payerHistory(c), solReserveLamports: rs.solFloorLamports, clknReserveRaw: rs.clknReserveRaw.toString(), reservesWhy: rs.why };
      const rowsLeft = L ? L.rows.filter((r) => !entries.some(([k, e]) => e.state === "paid" && M.recipientOf(k, e) === r.wallet)).length : 0;
      // What the remaining rows could still cost in SOL (fee + a new CLKN account each), on top of the reserve.
      payer.solSpendEstimateLamports = rowsLeft * (feeLamports() + ATA_RENT_LAMPORTS);
      payer.solNeededEstimateLamports = payer.solSpendEstimateLamports + rs.solFloorLamports;
      if (chain) {
        try {
          const b = await payerBalances(c.payerPubkey);
          const free = b.clknRaw > rs.clknReserveRaw ? b.clknRaw - rs.clknReserveRaw : 0n;
          const capLeft = cap ? (big(cap.capRaw) > paid ? big(cap.capRaw) - paid : 0n) : owedRemaining;
          const still = (capLeft < owedRemaining ? capLeft : owedRemaining) - sending;
          payer.clknRaw = b.clknRaw.toString(); payer.lamports = b.lamports;
          payer.clknAboveReserveRaw = free.toString();
          payer.coversRemaining = free >= (still > 0n ? still : 0n);
          payer.solAboveReserveLamports = Math.max(0, b.lamports - rs.solFloorLamports);
          payer.coversSolEstimate = b.lamports >= payer.solNeededEstimateLamports;
        } catch (e) { payer.error = "unavailable"; }
      }
    }
    return {
      config: c.receiveWallet || c.payerPubkey || c.window ? c : null,
      list: L ? { sha256: L.sha256, rowCount: L.rows.length, totals: L.totals, offCurve: L.offCurve || [], uploadedAt: L.uploadedAt,
        totalClknNeededUsdIndicative: Number.isFinite(price) && price > 0 ? Math.round(Number(total) / 1e9 * price * 100) / 100 : null, clknUsd: Number.isFinite(price) && price > 0 ? price : null } : null,
      armFacts: f,
      cap: cap ? { globalCapRaw: cap.capRaw, warn: cap.warn, tickMax: tickMax(), cuPrice: cuPrice() } : null,
      payer,
      totals: { paidClknRaw: paid.toString(), sendingClknRaw: sending.toString(), dueClknRaw: due.toString(), owedRemainingClknRaw: owedRemaining.toString() },
      counts: M.countsByState(j),
      due: entries.filter(([, e]) => e.state === "due").map(row),
      sending: entries.filter(([, e]) => e.state === "sending").map(row),
      held: entries.filter(([, e]) => e.state === "held" || e.state === "anomaly").map(row),
      paid: entries.filter(([, e]) => e.state === "paid").map(row),
      halted: j.halted || null, cursors: j.cursors || {}, lastTick: j.lastTick || null, busy,
      skipped: j.skipped || null,
      memoUnknown: Object.values(j.memoUnknown || {}),
      witnessedPayouts: Object.keys(j.witnessed || {}).length,
      payerCursors: j.payerCursors || {}, receiveAccounts: j.recvAccounts || [],
    };
  }

  return { tick, day0Preview, day0Run, status, publicTerms, publicLookup, armFacts, setReceive, setPayer, setList, setWindow, arm, disarm, hold, ack, isBusy: () => busy, KEYS: K };
}

// Belt and braces before any signature, and the reason the payer may be a wallet that holds far
// more than CLKN (the treasury): the transaction must be exactly compute budget, an idempotent
// CLKN ATA create for the recipient, ONE TransferChecked of CLKN from the payer's own CLKN ATA to
// that ATA for the planned amount, and the memo. Anything else throws and nothing is signed.
function assertPayoutShape(tx, x) {
  const { PublicKey } = require("@solana/web3.js");
  const spl = require("@solana/spl-token");
  const CB = "ComputeBudget111111111111111111111111111111";
  const ix = tx.instructions;
  const prog = ix.map((i) => i.programId.toBase58());
  const want = [CB, CB, spl.ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(), M.TOKEN_PROGRAM, MEMO_PROGRAM_ID];
  if (prog.length !== want.length || prog.some((p, i) => p !== want[i])) throw new Error("payout shape: unexpected instructions");
  if (!tx.feePayer || tx.feePayer.toBase58() !== x.payer) throw new Error("payout shape: fee payer is not the payer");
  const ata = ix[2].keys.map((k) => k.pubkey.toBase58());
  if (ata[1] !== x.dst || ata[2] !== x.owner || ata[3] !== x.mint) throw new Error("payout shape: ATA create is not the recipient's CLKN account");
  const d = spl.decodeTransferCheckedInstruction(ix[3], new PublicKey(M.TOKEN_PROGRAM));
  if (d.keys.source.pubkey.toBase58() !== x.src || d.keys.mint.pubkey.toBase58() !== x.mint || d.keys.destination.pubkey.toBase58() !== x.dst
    || d.keys.owner.pubkey.toBase58() !== x.payer || BigInt(d.data.amount) !== BigInt(x.amountRaw) || d.data.decimals !== 9) {
    throw new Error("payout shape: the transfer is not the planned CLKN amount to the recipient");
  }
  const signers = new Set();
  for (const i of ix) for (const k of i.keys) if (k.isSigner) signers.add(k.pubkey.toBase58());
  if (signers.size !== 1 || !signers.has(x.payer)) throw new Error("payout shape: a signer other than the payer");
}

// The dedicated payer key from CUNA_MIGRATION_PAYER_SECRET (base58 or a JSON byte array). Returns
// null when unset (the feature is a no-op), {refused} when it does not parse or is the SAME KEY as an
// engine operator key or the burner key — compared as strings (constant time) AND as derived
// pubkeys, so the same key in the other encoding is still caught — else {keypair}. Never logs or
// returns any secret; the caller logs only the pubkey.
function parseSecretKey(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  try {
    const { Keypair } = require("@solana/web3.js");
    const bytes = s.startsWith("[") ? Uint8Array.from(JSON.parse(s)) : require("bs58").decode(s);
    return Keypair.fromSecretKey(bytes);
  } catch (_) { return null; }
}
function sameSecret(a, b) {
  const { createHash, timingSafeEqual } = require("crypto");
  return timingSafeEqual(createHash("sha256").update(String(a)).digest(), createHash("sha256").update(String(b)).digest());
}
// CUNA_MIGRATION_PAYER_SOURCE=treasury (the owner's choice, 2026-11-14) instead loads the treasury
// operator key the server already holds, MM_OPERATOR_SECRET_TREASURY, and returns {keypair, source:
// "treasury"}; the monitor then requires the key to BE the treasury wallet and the configured payer.
// Setting both sources, or an unknown source, is refused rather than guessed.
function loadPayerSignerFromEnv(envObj) {
  const e = envObj || {};
  const raw = String(e.CUNA_MIGRATION_PAYER_SECRET || "").trim();
  const source = String(e.CUNA_MIGRATION_PAYER_SOURCE || "").trim().toLowerCase();
  if (source === "treasury") {
    if (raw) return { refused: "both CUNA_MIGRATION_PAYER_SOURCE=treasury and CUNA_MIGRATION_PAYER_SECRET are set — set only one" };
    const t = String(e.MM_OPERATOR_SECRET_TREASURY || "").trim();
    if (!t) return { refused: "CUNA_MIGRATION_PAYER_SOURCE=treasury but MM_OPERATOR_SECRET_TREASURY is not set" };
    const tkp = parseSecretKey(t);
    if (!tkp) return { refused: "MM_OPERATOR_SECRET_TREASURY does not parse (base58 or a JSON byte array)" };
    return { keypair: tkp, source: "treasury" };
  }
  if (source) return { refused: `CUNA_MIGRATION_PAYER_SOURCE=${source.slice(0, 20)} is not a known source (only "treasury")` };
  if (!raw) return null;
  const kp = parseSecretKey(raw);
  if (!kp) return { refused: "CUNA_MIGRATION_PAYER_SECRET does not parse (base58 or a JSON byte array)" };
  const others = ["MM_OPERATOR_SECRET", "CUNA_BURN_SECRET", ...Object.keys(e).filter((k) => k.startsWith("MM_OPERATOR_SECRET_"))];
  for (const k of others) {
    const v = String(e[k] || "").trim();
    if (!v) continue;
    const okp = parseSecretKey(v);
    if (sameSecret(v, raw) || (okp && okp.publicKey.equals(kp.publicKey))) return { refused: `the payer secret is the same key as ${k} — use a dedicated wallet`, pubkey: kp.publicKey.toBase58() };
  }
  return { keypair: kp };
}

module.exports = { createMonitor, loadPayerSignerFromEnv, assertPayoutShape, KEYS: K, MEMO_PROGRAM_ID, ATA_RENT_LAMPORTS, SOL_FLOOR_LAMPORTS, TREASURY_SOL_RESERVE_MIN, CU_PRICE_MAX_TREASURY, CU_LIMIT };
