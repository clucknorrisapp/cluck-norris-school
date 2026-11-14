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
//  4. Every payout carries a memo "CLKN migration <key> #<n>". Before any send the payer's own
//     signature history is read; a memo the journal cannot account for halts all sending.
//  5. Paid only at FINALIZED, and only when the payout's CLKN deltas are exactly +amount to the
//     recipient and -amount from the payer; anything else freezes the entry and halts everything.
//
// Journal mutations are: fresh kv.get -> structuredClone -> edit -> kv.setVerified, in one
// synchronous block with no await between the read and the write. RPC facts are gathered first.

const M = require("./cuna-migration");
const { big } = M;

const K = { config: "cunaMigConfig", list: "cunaMigList", armed: "cunaMigArmed", journal: "cunaMigJournal" };
const MEMO_PROGRAM_ID = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
const ATA_RENT_LAMPORTS = 2039280;
const SOL_FLOOR_LAMPORTS = 10_000_000;     // 0.01 SOL always left on the payer
const BASE_FEE_LAMPORTS = 5000;
const CU_LIMIT = 100_000;
const CU_PRICE_DEFAULT = 20_000;           // micro-lamports per CU
const CU_PRICE_MAX = 500_000;              // a typo cannot turn the priority fee into a drain
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
    if (pk === treasury()) return { ...out, why: "the payer is the treasury — refused" };
    if (pk === c.receiveWallet) return { ...out, why: "the payer is the receive wallet — refused" };
    if (L && M.listIndex(L).has(pk)) return { ...out, why: "the payer is a listed wallet — refused" };
    return { ...out, matches: true, keypair: s.keypair };
  }

  function armFacts() {
    const e = E(), c = cfg(), L = list(), j = kv.get(K.journal, null);
    const sf = signerFacts(c, L);
    const f = {
      kvArm: kv.get(K.armed, null) === true,
      envOn: String(e.CUNA_MIGRATION_ON || "") === "1",
      envOff: String(e.CUNA_MIGRATION_OFF || "") === "1",
      staging: isStaging(),
      payerLoaded: sf.loaded, payerMatches: sf.matches, payerPubkeyLoaded: sf.pubkey || null, payerWhy: sf.matches ? null : sf.why,
      storePersistent: !!kv.isPersistent(), loadError: (kv.loadError && kv.loadError()) || null,
      halted: (j && j.halted) || null, configComplete: configComplete(c, L),
    };
    f.armed = f.kvArm && f.envOn && !f.envOff && !f.staging && f.payerMatches && f.storePersistent && !f.loadError && !f.halted && f.configComplete;
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
  const cuPrice = () => clamp(E().CUNA_MIGRATION_CU_PRICE, 0, CU_PRICE_MAX, CU_PRICE_DEFAULT);
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
        case "rebroadcast": if (!twin) rebroadcast.push(a.txBase64); break;
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

  // ── Phase 3: detect new transfers into the receive wallet ──────────────────────────────────
  async function detect(report) {
    const c = cfg(), L = list();
    let accts;
    try {
      const r = await rpcJson("getTokenAccountsByOwner", [c.receiveWallet, { mint: mints.cuna }, { encoding: "jsonParsed", commitment: "finalized" }]);
      if (!r || r.error || !r.result || !Array.isArray(r.result.value)) throw new Error((r && r.error && r.error.message) || "no result");
      accts = r.result.value;
    } catch (e) { report.detect = "unavailable: token accounts"; return; }
    const accounts = [];
    for (const a of accts) {
      const prog = a && a.account && a.account.owner;
      const info = a && a.account && a.account.data && a.account.data.parsed && a.account.data.parsed.info;
      if (prog !== M.TOKEN_PROGRAM || !info || info.mint !== mints.cuna) { say(`⚠️ CUNA migration: receive-wallet token account ${sh(a && a.pubkey)} is not a legacy CUNA account — ignored`, `mig-acct:${a && a.pubkey}`); continue; }
      accounts.push(a.pubkey);
    }
    const j0 = journalRaw();
    const cursors = j0.cursors || {};
    const rowsByAcct = new Map();
    const all = new Map();
    for (const acct of accounts) {
      const cur = cursors[acct];
      const rows = [];
      let before = null, pages = 0, complete = false;
      while (pages < MAX_SIG_PAGES) {
        const opts = { limit: SIG_PAGE, commitment: "finalized" };
        if (cur && cur.sig) opts.until = cur.sig;
        if (before) opts.before = before;
        let r;
        try { r = await rpcJson("getSignaturesForAddress", [acct, opts]); } catch (_) { r = null; }
        if (!r || r.error || !Array.isArray(r.result)) { report.detect = "unavailable: signatures"; return; }
        pages++;
        let stop = false;
        for (const s of r.result) { if (Number(s.slot) <= Number(c.sinceSlot)) { stop = true; break; } rows.push(s); }
        if (stop || r.result.length < SIG_PAGE) { complete = true; break; }
        before = r.result[r.result.length - 1].signature;
      }
      if (!complete) {
        // Never process a partial walk: a later signature credited before an earlier one breaks the
        // per-wallet cap order. Nothing advances; the owner is told.
        say(`⚠️ CUNA migration: signature walk on ${sh(acct)} hit ${MAX_SIG_PAGES} pages — detection paused`, `mig-walk:${acct}`);
        report.detect = "walk_truncated";
        return;
      }
      rowsByAcct.set(acct, rows);
      for (const s of rows) if (!all.has(s.signature)) all.set(s.signature, s);
    }
    const cmp = (a, b) => (Number(a.slot) - Number(b.slot)) || (a.signature < b.signature ? -1 : a.signature > b.signature ? 1 : 0);
    const merged = [...all.values()].sort(cmp);
    const processed = new Set();
    const planned = [];
    let fetches = 0;
    for (const s of merged) {
      if (s.err) { processed.add(s.signature); continue; }
      if (j0.entries && j0.entries[s.signature]) { processed.add(s.signature); continue; }
      if (fetches >= MAX_FETCH_PER_TICK) break;
      fetches++;
      const tx = await getTxFinalized(s.signature);
      if (!tx) { report.detect = "stopped at an unavailable transaction"; break; }
      const cls = M.classifyIncoming(tx, { mint: mints.cuna, receiver: c.receiveWallet });
      if (cls.kind === "unavailable") { report.detect = "stopped at an unreadable transaction"; break; }
      processed.add(s.signature);
      if (cls.kind === "failed") continue;
      planned.push({ sig: s.signature, slot: Number(tx.slot) || Number(s.slot) || 0, blockTime: Number(tx.blockTime), cls });
    }
    // A cursor moves only over a whole slot whose every signature is processed: the node's order
    // inside one slot need not match ours, and `until` is positional.
    const newCursors = {};
    for (const [acct, rows] of rowsByAcct) {
      const sorted = rows.slice().sort(cmp);
      let curRow = null;
      for (let i = 0; i < sorted.length;) {
        let jx = i;
        while (jx < sorted.length && Number(sorted[jx].slot) === Number(sorted[i].slot)) jx++;
        const group = sorted.slice(i, jx);
        if (!group.every((r) => processed.has(r.signature))) break;
        curRow = group[group.length - 1];
        i = jx;
      }
      if (curRow) newCursors[acct] = { sig: curRow.signature, slot: Number(curRow.slot) };
    }
    if (!planned.length && !Object.keys(newCursors).length) return;
    // Commit: fresh read, plan in chain order (credited applies cumulatively), cursors, ONE write.
    const j = journalFresh();
    const added = [];
    for (const p of planned) {
      const r = M.planIncoming(j, { list: L, config: c, sig: p.sig, slot: p.slot, blockTime: p.blockTime, cls: p.cls, now: nowS() });
      if (!r.existed) added.push([p.sig, r.entry]);
    }
    j.cursors = j.cursors || {};
    for (const [acct, cur] of Object.entries(newCursors)) j.cursors[acct] = cur;
    if (!writeJournal(j)) { report.blocked = "journal write failed (detect)"; return; }
    report.detected += added.length;
    // Alerts only after the commit landed; bounded.
    const loud = added.filter(([, e]) => !e.quiet);
    for (const [sig, e] of loud.slice(0, MAX_ALERT_LINES)) {
      if (e.state === "due") say(`📥 CUNA migration: ${ui(e.receivedCunaRaw)} CUNA in from ${sh(e.sender)} — ${ui(e.clknRaw)} CLKN due${big(e.excessCunaRaw) > 0n ? ` (${ui(e.excessCunaRaw)} CUNA over the cap, held)` : ""} · ${sig.slice(0, 12)}…`, null);
      else if (e.state === "held") say(`✋ CUNA migration: ${ui(e.receivedCunaRaw)} CUNA in${e.sender ? ` from ${sh(e.sender)}` : ""} HELD (${e.reason}) · ${sig.slice(0, 12)}…`, null);
      else say(`📥 CUNA migration: ${ui(e.receivedCunaRaw)} CUNA in from ${sh(e.sender)} — ${e.state} · ${sig.slice(0, 12)}…`, null);
    }
    if (loud.length > MAX_ALERT_LINES) say(`CUNA migration: ${loud.length - MAX_ALERT_LINES} more transfers recorded this tick — see the admin status`, null);
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
  async function payerHistory(payer) {
    const rows = [];
    let before = null;
    for (let p = 0; p < MAX_SIG_PAGES; p++) {
      const opts = { limit: SIG_PAGE, commitment: "confirmed" };
      if (before) opts.before = before;
      const r = await rpcJson("getSignaturesForAddress", [payer, opts]);
      if (!r || r.error || !Array.isArray(r.result)) throw new Error("payer history unavailable");
      rows.push(...r.result);
      if (r.result.length < SIG_PAGE) return rows;
      before = r.result[r.result.length - 1].signature;
    }
    throw new Error("payer history longer than the walk allows");
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
  async function pay(report, { blockSends }) {
    const f = armFacts();
    if (!f.armed) { report.pay = "disarmed"; return; }
    if (blockSends) { report.pay = "blocked: an in-flight payout could not be resolved"; return; }
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
    // Memo witness: every memo'd payout the payer ever signed must be one the journal owns.
    let hist;
    try { hist = await payerHistory(payer); } catch (e) { report.pay = "unavailable: " + e.message; say(`⚠️ CUNA migration: payer history unreadable (${e.message}) — no sends`, "mig-hist"); return; }
    {
      const j = journalFresh();
      const unknown = [];
      let revived = 0;
      for (const row of hist) {
        for (const { key, n } of M.keysFromMemo(row.memo)) {
          const e = j.entries[key];
          const a = e && (e.attempts || []).find((x) => Number(x.n) === n && x.paySig === row.signature);
          if (!a) { unknown.push(`${key} #${n} (${row.signature})`); continue; }
          if (!row.err && M.isDead(a)) {
            // The journal judged it dead, the payer's own history shows it succeeded: a lagging node.
            // Revive it so the resolver records it from the chain; never build a second one.
            a.outcome = "live"; a.notFound = []; a.revived = (a.revived || 0) + 1;
            if (e.state !== "paid" && e.state !== "anomaly") { e.state = "sending"; e.reason = null; }
            revived++;
          }
        }
      }
      if (unknown.length) halt(j, "unknown_memo", `payer history carries payouts the journal does not own: ${unknown.slice(0, 3).join(", ")}`);
      if (unknown.length || revived) {
        if (!writeJournal(j)) { report.pay = "journal write failed (memo guard)"; return; }
        if (unknown.length) { say(`🛑 CUNA migration HALTED (unknown_memo): ${j.halted.why}`, "mig-halt:unknown_memo"); report.pay = "halted: unknown memo"; return; }
      }
    }
    const cap = globalCap(L);
    if (cap.warn) report.capWarn = cap.warn;
    const fee = feeLamports();
    const solNeed = fee + ATA_RENT_LAMPORTS + SOL_FLOOR_LAMPORTS;
    let liveClkn = 0n;
    for (const e of Object.values(journalRaw().entries || {})) for (const a of M.liveAttempts(e)) liveClkn += big(a.clknRaw) || 0n;
    let clknAvail = bal.clknRaw - liveClkn;
    let lamports = bal.lamports;
    let sent = 0;
    const max = tickMax();
    for (const key of due0) {
      if (sent >= max) { report.pay = "tick limit"; break; }
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
        say(`⚠️ CUNA migration: payer ${sh(payer)} is short — has ${ui(clknAvail.toString())} CLKN free and ${(lamports / 1e9).toFixed(4)} SOL, the next payout needs ${ui(amt.toString())} CLKN and ${(solNeed / 1e9).toFixed(4)} SOL. Payouts wait.`, "mig-short");
        report.pay = "payer short"; report.short = { clknAvailRaw: clknAvail.toString(), lamports, needClknRaw: amt.toString(), needLamports: solNeed };
        break;
      }
      const n0 = M.nextAttemptNo(e1, attempts.forKey(key));
      if (n0 === null) continue;
      const recipient = M.recipientOf(key, e1);
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
    if (entryCount(journalRaw()) > M.MAX_ENTRIES) {
      say(`🛑 CUNA migration: the journal holds more than ${M.MAX_ENTRIES} entries — refusing to run`, "mig-big");
      return { ok: false, reason: "journal too large" };
    }
    const report = { ok: true, reason, at: nowS(), adopted: 0, resolved: [], rebroadcast: 0, detected: 0, sent: [] };
    if (!integrity(report)) return { ...report, ok: false };
    if (!adoptOrphans(report)) return { ...report, ok: false };
    const rs = await resolveLive(report);
    if (report.blocked) return { ...report, ok: false };
    await detect(report);
    if (report.blocked) return { ...report, ok: false };
    await pay(report, rs);
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
      try { const b = await payerBalances(c.payerPubkey); payer = { clknRaw: b.clknRaw.toString(), lamports: b.lamports, coversNewDay0: b.clknRaw >= pending }; }
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
    const j = journalFresh(); j.cursors = {};
    if (!kv.setManyVerified({ [K.config]: next, [K.journal]: j })) return fail(500, "write failed");
    return { ok: true, receiveWallet: a, sinceSlot: slot };
  }
  function setPayer(pk) {
    const blocked = disarmedAndEmpty(false); if (blocked) return blocked;
    const a = String(pk || "").trim();
    if (!M.isWalletAddress(a)) return fail(400, "payer must be a base58 wallet address on the curve");
    const c = cfg(), L = list();
    if (a === treasury()) return fail(400, "the payer cannot be the treasury");
    if (a === c.receiveWallet) return fail(400, "the payer cannot be the receive wallet");
    if (L && M.listIndex(L).has(a)) return fail(400, "the payer is on the payout list");
    if (Object.values(journalRaw().entries || {}).some((e) => M.liveAttempts(e).length)) return fail(409, "a payout is in flight — wait for it to resolve");
    if (!kv.setVerified(K.config, { ...c, payerPubkey: a, setAt: nowS() })) return fail(500, "write failed");
    return { ok: true, payerPubkey: a };
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
      payer = { pubkey: c.payerPubkey };
      if (chain) {
        try { const b = await payerBalances(c.payerPubkey); payer.clknRaw = b.clknRaw.toString(); payer.lamports = b.lamports; payer.coversRemaining = b.clknRaw >= owedRemaining - sending; }
        catch (e) { payer.error = "unavailable"; }
      }
      const rowsLeft = L ? L.rows.filter((r) => !entries.some(([k, e]) => e.state === "paid" && M.recipientOf(k, e) === r.wallet)).length : 0;
      payer.solNeededEstimateLamports = rowsLeft * (feeLamports() + ATA_RENT_LAMPORTS) + SOL_FLOOR_LAMPORTS;
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
    };
  }

  return { tick, day0Preview, day0Run, status, publicTerms, publicLookup, armFacts, setReceive, setPayer, setList, setWindow, arm, disarm, hold, ack, isBusy: () => busy, KEYS: K };
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
function loadPayerSignerFromEnv(envObj) {
  const e = envObj || {};
  const raw = String(e.CUNA_MIGRATION_PAYER_SECRET || "").trim();
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

module.exports = { createMonitor, loadPayerSignerFromEnv, KEYS: K, MEMO_PROGRAM_ID, ATA_RENT_LAMPORTS, SOL_FLOOR_LAMPORTS, CU_LIMIT };
