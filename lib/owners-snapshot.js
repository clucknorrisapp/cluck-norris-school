// ── Owners Snapshot & History — who is in, who is out, who is draining ─────────
//
// A token owner submits a mint. We walk EVERY holder worth more than a few dollars, pull each
// wallet's history for that one token, and read the on-chain facts: what they bought, what
// they sold, how often, what share of their peak they've let go, where the tokens came from
// (bought vs handed to them), who first funded the wallet, and where sell proceeds went. Then
// we link wallets that share a funder / pass tokens between each other / cash out to the
// same place, and roll the whole thing into a snapshot the owner can compare over time.
//
// DESIGN RULES (owner, 2026-09-02):
//   • "This can take hours if needed to keep price down and free." — so this is the repo's
//     first real JOB engine: one job at a time, every upstream call paced through a single
//     throttle (OWNERS_SNAPSHOT_RPS, default 4/s), progress persisted so the owner comes back
//     to a finished report. Nothing here races a request deadline.
//   • Cheap on re-runs: per-wallet history is cached per mint and refreshed INCREMENTALLY
//     (getSignaturesForAddress `until: lastSig`), a wallet's first funder is cached forever
//     (it never changes), and parsed transactions are shared across wallets of the same mint
//     (holders of one token share its pool transactions).
//   • Say what's on-chain, never why. Statuses are arithmetic over transfers (sold 60% of
//     peak across 5 sells = DRAINING). Links are stated as PATTERNS with the innocent
//     explanations attached — a shared funder is a presale, an airdrop, a CEX batch, or a
//     ring, and the chain can't tell which. We never write "team", "insider" or "ring".
//
// Everything that touches Helius goes through deps injected by server.js so this file holds
// no key and no HTTP details beyond the two endpoints the rest of the codebase already uses.

"use strict";

const fs = require("fs");
const path = require("path");
const { atomicWriteFileSync } = require("./atomic-write");

const WSOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const CBBTC = "cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij";
const JUP = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const QUOTE_MINTS = { [WSOL]: "SOL", [USDC]: "USDC", [USDT]: "USDT", [CBBTC]: "cbBTC", [JUP]: "JUP" };
const STABLES = new Set([USDC, USDT]);
const SYSTEM_PROGRAM = "11111111111111111111111111111111";

const DAY = 86400;
const STATUSES = ["ACCUMULATING", "HOLDING", "TRIMMING", "DRAINING", "OUT"];

// ── Tunables (env-overridable; defaults sized for "hours is fine, credits are not") ──────
function envNum(name, dflt) { const v = Number(process.env[name]); return Number.isFinite(v) && v > 0 ? v : dflt; }
const CFG = () => ({
  rps: envNum("OWNERS_SNAPSHOT_RPS", 4),                    // global upstream pace
  minUsd: envNum("OWNERS_SNAPSHOT_MIN_USD", 5),             // "every holder more than 5 dollars"
  maxWallets: envNum("OWNERS_SNAPSHOT_MAX_WALLETS", 1500),  // analysed holders (by USD desc)
  exitedCap: envNum("OWNERS_SNAPSHOT_EXITED_CAP", 300),     // zero/low-balance accounts checked for "OUT"
  holderPages: envNum("OWNERS_SNAPSHOT_HOLDER_PAGES", 50),  // DAS pages × 1000 accounts
  sigPages: envNum("OWNERS_SNAPSHOT_SIG_PAGES", 3),         // per wallet per run (×1000 sigs)
  funderCap: envNum("OWNERS_SNAPSHOT_FUNDER_CAP", 400),     // wallets traced to first funder per run
  funderPages: envNum("OWNERS_SNAPSHOT_FUNDER_PAGES", 5),   // sig pages walked to genesis
  proceedsCap: envNum("OWNERS_SNAPSHOT_PROCEEDS_CAP", 200), // dumpers followed one hop after selling
  keepSnapshots: envNum("OWNERS_SNAPSHOT_KEEP", 30),
  keepResults: envNum("OWNERS_SNAPSHOT_KEEP_RESULTS", 5),
  txCacheMax: envNum("OWNERS_SNAPSHOT_TXCACHE", 25000),
});

// ── Small utils ───────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const r4 = (n) => Math.round((Number(n) || 0) * 10000) / 10000;
const median = (arr) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const dayKey = (ts) => Math.floor(ts / DAY);
function safeReadJson(file, dflt) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return dflt; } }
function ensureDir(d) { try { fs.mkdirSync(d, { recursive: true }); } catch {} }
function safeMintName(s) { return String(s || "").replace(/[^A-Za-z0-9 _.\-]/g, "").slice(0, 40); }

// One global pacer — every upstream call in a job waits its turn here.
function makePacer(rps) {
  let next = 0;
  const gap = 1000 / Math.max(0.5, rps);
  return async () => {
    const now = Date.now();
    const at = Math.max(now, next);
    next = at + gap;
    if (at > now) await sleep(at - now);
  };
}

// Union-find for the cluster roll-up.
class DSU {
  constructor() { this.p = new Map(); }
  find(x) { if (!this.p.has(x)) this.p.set(x, x); let r = x; while (this.p.get(r) !== r) r = this.p.get(r); while (this.p.get(x) !== r) { const n = this.p.get(x); this.p.set(x, r); x = n; } return r; }
  union(a, b) { const ra = this.find(a), rb = this.find(b); if (ra !== rb) this.p.set(ra, rb); }
}

// ── Engine factory ────────────────────────────────────────────────────────────
// deps: {
//   dataDir, heliusKey(), rpcCall(id, method, params) → json, enhancedBatched(sigs, label, txCache) → {txs},
//   enhancedAddress(wallet, {limit, type}) → tx[], jupPriceV3(mints), getSolUsd(), classifyAddressTypes(addrs, rpcCall) → Map,
//   isOnCurve(addr), KNOWN_CEX_WALLETS, KNOWN_SERVICE_WALLETS, log(msg)
// }
function createEngine(deps) {
  const log = deps.log || ((m) => console.log("[owners-snapshot]", m));
  const ROOT = path.join(deps.dataDir || "/data", "owners-snapshot");
  const DIRS = { root: ROOT, cache: path.join(ROOT, "cache"), results: path.join(ROOT, "results"), snaps: path.join(ROOT, "snapshots") };
  for (const d of Object.values(DIRS)) ensureDir(d);
  const JOBS_FILE = path.join(ROOT, "jobs.json");

  // Job table — small, persisted on every transition so a redeploy mid-crawl resumes.
  let jobs = safeReadJson(JOBS_FILE, { queue: [], jobs: {} });
  if (!jobs || typeof jobs !== "object") jobs = { queue: [], jobs: {} };
  jobs.queue = Array.isArray(jobs.queue) ? jobs.queue : [];
  jobs.jobs = jobs.jobs && typeof jobs.jobs === "object" ? jobs.jobs : {};
  // A job that was running when the process died: put it back at the head of the queue.
  for (const j of Object.values(jobs.jobs)) {
    if (j.state === "running") { j.state = "queued"; j.stage = "resuming"; j.note = "resumed after restart"; if (!jobs.queue.includes(j.id)) jobs.queue.unshift(j.id); }
  }
  const saveJobs = () => {
    // Keep the table bounded: the 60 most recent jobs.
    const ids = Object.values(jobs.jobs).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 60).map((j) => j.id);
    const keep = {}; for (const id of ids) keep[id] = jobs.jobs[id];
    jobs.jobs = keep; jobs.queue = jobs.queue.filter((id) => keep[id]);
    try { atomicWriteFileSync(JOBS_FILE, JSON.stringify(jobs)); } catch (e) { log("jobs save failed: " + e.message); }
  };
  saveJobs();

  let running = null;          // job currently executing
  let cancelFlag = null;       // jobId requested to cancel
  const listeners = new Set(); // in-process progress subscribers (SSE not needed; polling)

  // ── Public API ──────────────────────────────────────────────────────────────
  function jobPublic(j) {
    if (!j) return null;
    const { id, mint, state, stage, progress, createdAt, startedAt, finishedAt, error, note, resultFile, snapshotTs, stats, symbol } = j;
    const pos = state === "queued" ? jobs.queue.indexOf(id) + 1 : 0;
    return { id, mint, symbol: symbol || null, state, stage, progress: progress || null, queuePosition: pos, createdAt, startedAt, finishedAt, error: error || null, note: note || null, resultTs: snapshotTs || null, stats: stats || null, hasResult: !!resultFile };
  }
  function findActiveForMint(mint) {
    return Object.values(jobs.jobs).find((j) => j.mint === mint && (j.state === "queued" || j.state === "running")) || null;
  }
  function lastFinishedForMint(mint) {
    return Object.values(jobs.jobs).filter((j) => j.mint === mint && j.state === "done").sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0))[0] || null;
  }
  function start({ mint, requestedBy = null, force = false, cooldownMs = 6 * 3600 * 1000 }) {
    const active = findActiveForMint(mint);
    if (active) { kick(); return { ok: true, job: jobPublic(active), reused: true }; }
    if (!force) {
      const last = lastFinishedForMint(mint);
      if (last && Date.now() - (last.finishedAt || 0) < cooldownMs) {
        return { ok: false, error: "cooldown", retryAfterMs: cooldownMs - (Date.now() - last.finishedAt), job: jobPublic(last) };
      }
    }
    if (jobs.queue.length >= 12) return { ok: false, error: "queue_full" };
    const id = "os_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
    jobs.jobs[id] = { id, mint, state: "queued", stage: "queued", progress: null, createdAt: Date.now(), requestedBy };
    jobs.queue.push(id);
    saveJobs();
    kick();
    return { ok: true, job: jobPublic(jobs.jobs[id]), reused: false };
  }
  function status({ jobId, mint }) {
    if (jobId && jobs.jobs[jobId]) return jobPublic(jobs.jobs[jobId]);
    if (mint) {
      const j = findActiveForMint(mint) || lastFinishedForMint(mint)
        || Object.values(jobs.jobs).filter((x) => x.mint === mint).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];
      return jobPublic(j);
    }
    return null;
  }
  function cancel(jobId) {
    const j = jobs.jobs[jobId]; if (!j) return false;
    if (j.state === "queued") { j.state = "cancelled"; jobs.queue = jobs.queue.filter((x) => x !== jobId); saveJobs(); return true; }
    if (j.state === "running") { cancelFlag = jobId; return true; }
    return false;
  }
  function listRecent(limit = 20) {
    return Object.values(jobs.jobs).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, limit).map(jobPublic);
  }
  function result({ mint, ts }) {
    const snapFile = path.join(DIRS.snaps, `${mint}.json`);
    const idx = safeReadJson(snapFile, null);
    if (!idx || !idx.snapshots || !idx.snapshots.length) return null;
    const pick = ts ? idx.snapshots.find((s) => s.ts === Number(ts)) : idx.snapshots[idx.snapshots.length - 1];
    if (!pick || !pick.resultFile) return null;
    return safeReadJson(path.join(DIRS.results, pick.resultFile), null);
  }
  function history({ mint }) {
    const idx = safeReadJson(path.join(DIRS.snaps, `${mint}.json`), null);
    if (!idx) return { mint, snapshots: [] };
    return { mint, symbol: idx.symbol || null, snapshots: idx.snapshots.map((s) => ({ ts: s.ts, summary: s.summary, diff: s.diff || null })) };
  }

  // ── Queue runner ────────────────────────────────────────────────────────────
  function kick() {
    if (running) return;
    const id = jobs.queue.shift();
    if (!id) return;
    const j = jobs.jobs[id];
    if (!j || j.state !== "queued") { saveJobs(); return kick(); }
    running = j;
    j.state = "running"; j.startedAt = Date.now(); j.stage = "starting"; saveJobs();
    runJob(j).then(() => {
      j.state = "done"; j.finishedAt = Date.now(); j.stage = "done"; j.progress = null;
    }).catch((e) => {
      const cancelled = e && e.message === "cancelled";
      j.state = cancelled ? "cancelled" : "failed"; j.finishedAt = Date.now();
      j.error = cancelled ? null : String(e && e.message || e).slice(0, 300);
      log(`job ${j.id} ${j.state}: ${j.error || ""}`);
    }).finally(() => {
      running = null; cancelFlag = null; saveJobs(); setTimeout(kick, 250);
    });
  }

  // ── The job ─────────────────────────────────────────────────────────────────
  async function runJob(job) {
    const cfg = CFG();
    const mint = job.mint;
    const pace = makePacer(cfg.rps);
    const key = deps.heliusKey();
    if (!key) throw new Error("no Helius key configured");
    const rpc = async (id, method, params) => { await pace(); return deps.rpcCall(id, method, params); };
    const checkCancel = () => { if (cancelFlag === job.id) throw new Error("cancelled"); };
    const setStage = (stage, progress) => { job.stage = stage; job.progress = progress || null; saveJobs(); };
    const txCache = new Map();
    const enhanced = async (sigs, label) => {
      await pace();
      const r = await deps.enhancedBatched(sigs, label, txCache);
      if (txCache.size > cfg.txCacheMax) txCache.clear();
      return r.txs || [];
    };

    // 1. Token facts + prices ---------------------------------------------------
    setStage("token facts", { done: 0, total: 1 });
    const [supplyRes, assetRes] = await Promise.all([
      rpc("os-supply", "getTokenSupply", [mint]),
      rpc("os-asset", "getAsset", { id: mint }).catch(() => null),
    ]);
    const decimals = supplyRes?.result?.value?.decimals;
    if (decimals == null) throw new Error("mint not found on Solana");
    const totalSupply = Number(supplyRes.result.value.amount || 0) / 10 ** decimals;
    const meta = assetRes?.result?.content?.metadata || {};
    const symbol = safeMintName(meta.symbol) || null;
    const name = safeMintName(meta.name) || null;
    job.symbol = symbol;
    const tokenProgram = assetRes?.result?.token_info?.token_program || null;
    let price = 0, solUsd = 0; const quoteUsd = { [USDC]: 1, [USDT]: 1 };
    try {
      const p = await deps.jupPriceV3([mint, WSOL, JUP, CBBTC]);
      price = Number(p?.[mint]?.usdPrice) || 0;
      solUsd = Number(p?.[WSOL]?.usdPrice) || 0;
      quoteUsd[JUP] = Number(p?.[JUP]?.usdPrice) || 0;
      quoteUsd[CBBTC] = Number(p?.[CBBTC]?.usdPrice) || 0;
    } catch {}
    if (!solUsd) { try { solUsd = Number(await deps.getSolUsd()) || 0; } catch {} }
    quoteUsd[WSOL] = solUsd;
    const priceKnown = price > 0;
    // No price = the ≥$5 filter is meaningless. Fall back to "top holders by balance" and say so.
    const minTokens = priceKnown ? cfg.minUsd / price : 0;

    // 2. Every token account for the mint (zero balances included — that's where the
    //    exited wallets live) ---------------------------------------------------------
    setStage("walking holders", { done: 0, total: cfg.holderPages });
    const balances = new Map();          // owner → ui balance
    const accountsByOwner = new Map();   // owner → [token account addresses]
    const tokenAccountAddrs = new Set();
    let holderPagesTruncated = false, accountsSeen = 0;
    for (let page = 1; page <= cfg.holderPages; page++) {
      checkCancel();
      const d = await rpc(`os-holders-${page}`, "getTokenAccounts", { page, limit: 1000, mint, displayOptions: { showZeroBalance: true } });
      const accts = d?.result?.token_accounts || [];
      setStage("walking holders", { done: page, total: cfg.holderPages, accounts: accountsSeen + accts.length });
      if (!accts.length) break;
      for (const a of accts) {
        if (!a.owner) continue;
        accountsSeen++;
        const ui = (Number(a.amount) || 0) / 10 ** decimals;
        balances.set(a.owner, (balances.get(a.owner) || 0) + ui);
        if (a.address) { tokenAccountAddrs.add(a.address); const l = accountsByOwner.get(a.owner) || []; l.push(a.address); accountsByOwner.set(a.owner, l); }
      }
      if (accts.length < 1000) break;
      if (page === cfg.holderPages) holderPagesTruncated = true;
    }

    // 3. Split people from pools/lockers/programs --------------------------------
    setStage("classifying addresses", { done: 0, total: 1 });
    const owners = [...balances.keys()];
    const offCurve = owners.filter((o) => !deps.isOnCurve(o));
    let types = new Map();
    try { types = await deps.classifyAddressTypes(offCurve, rpc); } catch {}
    const nonWallets = []; // LP / lockers / contracts / service — reported, never analysed
    const people = [];
    for (const o of owners) {
      const bal = balances.get(o) || 0;
      const t = types.get(o);
      const svc = deps.KNOWN_SERVICE_WALLETS && deps.KNOWN_SERVICE_WALLETS[o];
      if (tokenAccountAddrs.has(o)) { nonWallets.push({ wallet: o, balance: bal, category: "locker", label: "Self-owned lock" }); continue; }
      if (svc) { nonWallets.push({ wallet: o, balance: bal, category: "service", label: svc }); continue; }
      if (t && t.category !== "wallet") { nonWallets.push({ wallet: o, balance: bal, category: t.category, label: t.label }); continue; }
      if (!deps.isOnCurve(o)) { nonWallets.push({ wallet: o, balance: bal, category: "contract", label: "Program account" }); continue; }
      people.push({ wallet: o, balance: bal, usd: bal * price, cex: (deps.KNOWN_CEX_WALLETS && deps.KNOWN_CEX_WALLETS[o]) || null });
    }
    people.sort((a, b) => b.balance - a.balance);
    const nonWalletSupply = nonWallets.reduce((s, x) => s + x.balance, 0);
    const humanSupply = people.reduce((s, x) => s + x.balance, 0);

    // Analysis set: every person ≥ $5 (or top-N by balance when there's no price), plus a
    // bounded slice of the ≤$5 / zero-balance accounts so "who is OUT" has a chance.
    const above = people.filter((p) => (priceKnown ? p.usd >= cfg.minUsd : p.balance > 0)).slice(0, cfg.maxWallets);
    const aboveSet = new Set(above.map((p) => p.wallet));
    const exitedCandidates = people.filter((p) => !aboveSet.has(p.wallet)).slice(0, cfg.exitedCap);
    const analysisTruncated = people.filter((p) => (priceKnown ? p.usd >= cfg.minUsd : p.balance > 0)).length > above.length;
    const targets = [...above, ...exitedCandidates];

    // 4. Per-wallet history for THIS mint (incremental, cached per mint) ---------
    const cacheFile = path.join(DIRS.cache, `${mint}.json`);
    const cache = safeReadJson(cacheFile, { wallets: {}, funders: {} });
    cache.wallets = cache.wallets || {}; cache.funders = cache.funders || {};
    const saveCache = () => { try { atomicWriteFileSync(cacheFile, JSON.stringify(cache)); } catch (e) { log("cache save failed: " + e.message); } };
    const nowTs = Math.floor(Date.now() / 1000);
    const analysed = new Map(); // wallet → analysis record
    let done = 0;
    for (const t of targets) {
      checkCancel();
      done++;
      if (done % 5 === 0 || done === targets.length) setStage("reading wallet histories", { done, total: targets.length, cachedRows: Object.keys(cache.wallets).length });
      const accts = accountsByOwner.get(t.wallet) || [];
      const c = cache.wallets[t.wallet] || { lastSig: null, rows: [], truncated: false };
      // New signatures only (newest first, stop at the last one we parsed).
      const newSigs = new Map();
      let truncated = c.truncated;
      for (const acc of accts) {
        let before = null;
        for (let p = 0; p < cfg.sigPages; p++) {
          const opts = { limit: 1000 };
          if (before) opts.before = before;
          if (c.lastSig) opts.until = c.lastSig;
          let sigs = [];
          try { sigs = (await rpc("os-sigs", "getSignaturesForAddress", [acc, opts]))?.result || []; } catch { break; }
          if (!sigs.length) break;
          for (const s of sigs) if (!s.err) newSigs.set(s.signature, s.blockTime || 0);
          if (sigs.length < 1000) break;
          before = sigs[sigs.length - 1].signature;
          if (p === cfg.sigPages - 1) truncated = true;
        }
      }
      let rows = c.rows || [];
      if (newSigs.size) {
        const sigList = [...newSigs.keys()];
        const parsed = [];
        for (let i = 0; i < sigList.length; i += 100) {
          checkCancel();
          const txs = await enhanced(sigList.slice(i, i + 100), "owners-history");
          parsed.push(...txs);
        }
        const fresh = parsed.map((tx) => rowFromTx(tx, t.wallet, mint, quoteUsd)).filter(Boolean);
        const seen = new Set(rows.map((r) => r.sig));
        for (const r of fresh) if (!seen.has(r.sig)) rows.push(r);
        rows.sort((a, b) => a.ts - b.ts || a.sig.localeCompare(b.sig));
        // The newest signature becomes the incremental watermark — but ONLY when every requested
        // signature came back parsed. A rate-limited batch returns short; advancing the watermark
        // past it would silently lose those transactions for good (seen on the first real crawl:
        // one 429 mid-wallet). Leaving it lets the next run re-request them; rows de-dupe by sig.
        const gotAll = parsed.filter((tx) => tx && tx.signature).length >= sigList.length;
        if (gotAll) { const newest = [...newSigs.entries()].sort((a, b) => b[1] - a[1])[0]; c.lastSig = newest ? newest[0] : c.lastSig; }
        else c.partial = true;
      }
      c.rows = rows; c.truncated = truncated; c.updatedAt = nowTs;
      cache.wallets[t.wallet] = c;
      const m = metricsFor(rows, t.balance, price, truncated, nowTs, cfg.minUsd);
      analysed.set(t.wallet, { wallet: t.wallet, balance: t.balance, usd: r2(t.balance * price), supplyPct: totalSupply ? r4(100 * t.balance / totalSupply) : 0, cex: t.cex, ...m });
      if (done % 25 === 0) saveCache();
    }
    saveCache();

    // Drop wallets that were never meaningful (dust that never held ≥$5 and never sold).
    for (const [w, a] of analysed) { if (a.status === "DUST") analysed.delete(w); }

    // 5. First funder (who put the first SOL into the wallet) ---------------------
    const wantFunder = [...analysed.values()]
      .sort((a, b) => (b.flags.dumper - a.flags.dumper) || (b.usd - a.usd))
      .slice(0, cfg.funderCap);
    done = 0;
    for (const a of wantFunder) {
      checkCancel();
      done++;
      if (done % 5 === 0 || done === wantFunder.length) setStage("tracing first funders", { done, total: wantFunder.length });
      let f = cache.funders[a.wallet];
      if (!f || (f.tooDeep && !f.checkedAt) ) {
        try { f = await findFunder(a.wallet, rpc, enhanced, cfg.funderPages); } catch { f = null; }
        if (f) { f.checkedAt = nowTs; cache.funders[a.wallet] = f; }
      }
      if (f) {
        a.funder = f.funder || null; a.funderKind = f.kind || null; a.funderSol = r4(f.amountSol || 0);
        a.firstSeenTs = f.firstTs || a.firstSeenTs; a.fundingTooDeep = !!f.tooDeep; a.lifetimeTx = f.lifetimeTx || null;
        a.funderLabel = a.funder ? ((deps.KNOWN_CEX_WALLETS && deps.KNOWN_CEX_WALLETS[a.funder]) || (deps.KNOWN_SERVICE_WALLETS && deps.KNOWN_SERVICE_WALLETS[a.funder]) || null) : null;
      }
      if (done % 25 === 0) saveCache();
    }
    saveCache();

    // 6. Where did the sell proceeds go? (one hop, dumpers only) ------------------
    const dumpers = [...analysed.values()].filter((a) => a.flags.dumper && a.sellCount > 0).sort((a, b) => b.soldUsd - a.soldUsd).slice(0, cfg.proceedsCap);
    done = 0;
    for (const a of dumpers) {
      checkCancel();
      done++;
      if (done % 5 === 0 || done === dumpers.length) setStage("following sell proceeds", { done, total: dumpers.length });
      try {
        await pace();
        const txs = await deps.enhancedAddress(a.wallet, { limit: 100, type: "TRANSFER" });
        a.proceedsTo = proceedsFrom(txs, a.wallet, a.firstSellTs || 0, solUsd, deps);
      } catch { a.proceedsTo = []; }
    }

    // 7. Link the wallets ---------------------------------------------------------
    setStage("linking wallets", { done: 0, total: 1 });
    const links = buildLinks(analysed, deps);
    const clusters = buildClusters(analysed, links, totalSupply, price, deps);

    // 8. Roll up ------------------------------------------------------------------
    const walletsOut = [...analysed.values()].map((a) => {
      const { rows, ...rest } = a;
      return { ...rest, recent: (rows || []).slice(-12).reverse() };
    }).sort((a, b) => b.usd - a.usd);
    const counts = {}; for (const s of STATUSES) counts[s] = 0;
    const supplyByStatus = {}; for (const s of STATUSES) supplyByStatus[s] = 0;
    for (const a of walletsOut) { counts[a.status] = (counts[a.status] || 0) + 1; supplyByStatus[a.status] = (supplyByStatus[a.status] || 0) + a.balance; }
    const pct = (n) => totalSupply ? r4(100 * n / totalSupply) : 0;
    const summary = {
      mint, symbol, name, price: r4(price) || null, priceKnown, solUsd: r2(solUsd), decimals, totalSupply: Math.round(totalSupply),
      holdersTotal: people.length, holdersAnalysed: above.length, exitedChecked: exitedCandidates.length, analysisTruncated, holderPagesTruncated,
      nonWalletCount: nonWallets.length, nonWalletSupplyPct: pct(nonWalletSupply), humanSupplyPct: pct(humanSupply),
      counts, supplyPctByStatus: Object.fromEntries(Object.entries(supplyByStatus).map(([k, v]) => [k, pct(v)])),
      draining7dUsd: r2(walletsOut.reduce((s, a) => s + (a.soldUsd7d || 0), 0)),
      bought7dUsd: r2(walletsOut.reduce((s, a) => s + (a.boughtUsd7d || 0), 0)),
      clusterCount: clusters.length, flaggedClusters: clusters.filter((c) => c.flags.length).length,
      freeBagWallets: walletsOut.filter((a) => a.flags.freeBag).length,
      freshWallets: walletsOut.filter((a) => a.flags.fresh).length,
      minUsd: cfg.minUsd, generatedAt: Date.now(),
    };
    const watch = {
      drainingNow: walletsOut.filter((a) => a.status === "DRAINING").sort((a, b) => b.soldUsd7d - a.soldUsd7d || b.soldOfPeak - a.soldOfPeak).slice(0, 25).map(slim),
      exits: walletsOut.filter((a) => a.status === "OUT").sort((a, b) => b.peakUsd - a.peakUsd).slice(0, 25).map(slim),
      newMoney: walletsOut.filter((a) => a.boughtUsd7d > 0).sort((a, b) => b.boughtUsd7d - a.boughtUsd7d).slice(0, 25).map(slim),
      freeBags: walletsOut.filter((a) => a.flags.freeBag).sort((a, b) => b.usd - a.usd).slice(0, 25).map(slim),
      fresh: walletsOut.filter((a) => a.flags.fresh).sort((a, b) => b.usd - a.usd).slice(0, 25).map(slim),
      setups: clusters.filter((c) => c.flags.length).slice(0, 15),
    };
    const resultObj = { version: 1, summary, watch, clusters, wallets: walletsOut, nonWallets: nonWallets.sort((a, b) => b.balance - a.balance).slice(0, 200), links: links.slice(0, 2000),
      notes: NOTES };

    // 9. Persist + snapshot history + diff --------------------------------------------
    setStage("saving", { done: 0, total: 1 });
    const ts = Date.now();
    const resultFile = `${mint}-${ts}.json`;
    const snapFile = path.join(DIRS.snaps, `${mint}.json`);
    const idx = safeReadJson(snapFile, { mint, snapshots: [] });
    idx.symbol = symbol; idx.snapshots = idx.snapshots || [];
    const prev = idx.snapshots[idx.snapshots.length - 1] || null;
    const compact = {};
    for (const a of walletsOut) compact[a.wallet] = { b: Math.round(a.balance), u: a.usd, s: a.status };
    const diff = prev ? diffSnapshots(prev.wallets || {}, compact, cfg.minUsd) : null;
    resultObj.diff = diff;
    resultObj.previousTs = prev ? prev.ts : null;
    atomicWriteFileSync(path.join(DIRS.results, resultFile), JSON.stringify(resultObj));
    idx.snapshots.push({ ts, resultFile, summary: { counts, supplyPctByStatus: summary.supplyPctByStatus, holdersTotal: people.length, holdersAnalysed: above.length, price: summary.price, draining7dUsd: summary.draining7dUsd, bought7dUsd: summary.bought7dUsd, clusterCount: clusters.length }, diff: diff ? diff.summary : null, wallets: compact });
    while (idx.snapshots.length > cfg.keepSnapshots) idx.snapshots.shift();
    // Prune result files beyond keepResults (the snapshot index keeps the compact rows forever).
    const keepFiles = new Set(idx.snapshots.slice(-cfg.keepResults).map((s) => s.resultFile));
    for (const s of idx.snapshots) if (s.resultFile && !keepFiles.has(s.resultFile)) { try { fs.unlinkSync(path.join(DIRS.results, s.resultFile)); } catch {} s.resultFile = null; }
    atomicWriteFileSync(snapFile, JSON.stringify(idx));
    job.resultFile = resultFile; job.snapshotTs = ts;
    job.stats = { holders: people.length, analysed: above.length, clusters: clusters.length, ...counts };
    log(`job ${job.id} ${symbol || mint}: ${people.length} holders, ${above.length} analysed, ${clusters.length} clusters, ${JSON.stringify(counts)}`);
  }

  // Boot kick: a job re-queued above (it was running when the process died) must start on its own —
  // without this it sat "queued · resuming" until some unrelated job was submitted. Deferred a tick
  // so the caller holds the engine handle before the first stage writes.
  setTimeout(kick, 0);
  return { start, status, cancel, result, history, listRecent, get running() { return running ? jobPublic(running) : null; }, get queueLength() { return jobs.queue.length; } };
}

// ── Per-transaction row: what THIS wallet did with THIS mint in one tx ──────────
// Mirrors /api/trace's classifier (swap = token and quote move in OPPOSITE directions;
// same direction + contract counterparty = LP add/remove) and Wallet X-Ray's wSOL fix (a swap
// emits both a wSOL token transfer AND the native lamport move — same-sign legs take max,
// never sum, or every sell's proceeds double).
function rowFromTx(tx, wallet, mint, quoteUsd) {
  if (!tx || !tx.signature) return null;
  const transfers = tx.tokenTransfers || [];
  const native = tx.nativeTransfers || [];
  let tokenDelta = 0, counterIn = null, counterOut = null;
  for (const t of transfers) {
    if (t.mint !== mint) continue;
    const amt = parseFloat(t.tokenAmount) || 0;
    if (t.toUserAccount === wallet) { tokenDelta += amt; counterIn = t.fromUserAccount || counterIn; }
    if (t.fromUserAccount === wallet) { tokenDelta -= amt; counterOut = t.toUserAccount || counterOut; }
  }
  if (Math.abs(tokenDelta) < 1e-12) return null;
  const q = {};
  let wsolTok = 0;
  for (const t of transfers) {
    if (!QUOTE_MINTS[t.mint]) continue;
    const amt = parseFloat(t.tokenAmount) || 0;
    const d = (t.toUserAccount === wallet ? amt : 0) - (t.fromUserAccount === wallet ? amt : 0);
    if (t.mint === WSOL) wsolTok += d; else q[t.mint] = (q[t.mint] || 0) + d;
  }
  let lam = 0;
  for (const n of native) { const a = Number(n.amount) || 0; if (n.toUserAccount === wallet) lam += a; if (n.fromUserAccount === wallet) lam -= a; }
  const nat = lam / 1e9;
  let sol;
  if (wsolTok !== 0 && nat !== 0 && Math.sign(wsolTok) === Math.sign(nat)) sol = Math.abs(wsolTok) > Math.abs(nat) ? wsolTok : nat;
  else sol = wsolTok + nat;
  if (Math.abs(sol) > 1e-9) q[WSOL] = sol;
  // Pick the dominant quote leg (by USD where priced, else by magnitude).
  let quoteMint = null, quoteDelta = 0, usd = 0;
  for (const [m, v] of Object.entries(q)) {
    const val = Math.abs(v) * (quoteUsd[m] || 0);
    const score = val > 0 ? val : Math.abs(v) * 1e-6;
    if (score > Math.abs(usd) || (!quoteMint && Math.abs(v) > 0)) { quoteMint = m; quoteDelta = v; usd = val * Math.sign(v); }
  }
  // Fee-only SOL movement is not a quote leg (a plain send burns ~0.000005 SOL).
  if (quoteMint === WSOL && Math.abs(quoteDelta) < 0.0005 && Math.abs(tokenDelta) > 0) { quoteMint = null; quoteDelta = 0; usd = 0; }
  const counterparty = (tokenDelta > 0 ? counterIn : counterOut) || null;
  const hasQuote = quoteMint != null;
  const liqHint = /LIQUIDIT|POOL/i.test(tx.type || "");
  let action;
  if (hasQuote && tokenDelta > 0 && quoteDelta < 0) action = "buy";
  else if (hasQuote && tokenDelta < 0 && quoteDelta > 0) action = "sell";
  else if (hasQuote && tokenDelta < 0 && quoteDelta < 0) action = liqHint ? "add_lp" : "send";
  else if (hasQuote && tokenDelta > 0 && quoteDelta > 0) action = liqHint ? "withdraw_lp" : "receive";
  else if (liqHint) action = tokenDelta > 0 ? "withdraw_lp" : "add_lp";
  else action = tokenDelta > 0 ? "receive" : "send";
  // A "send" whose counterparty is off-curve is most likely an LP deposit / lock / program — the
  // status math treats it as not-a-sale either way; the label just stays honest.
  return { sig: tx.signature, ts: tx.timestamp || 0, action, tok: r4(tokenDelta), qm: quoteMint ? QUOTE_MINTS[quoteMint] : null, qd: r4(quoteDelta), usd: r2(usd), cp: counterparty, src: tx.source || null };
}

// ── Per-wallet metrics + status ─────────────────────────────────────────────────
function metricsFor(rows, liveBalance, price, truncated, nowTs, minUsd) {
  let bought = 0, sold = 0, recv = 0, sent = 0, lpIn = 0, lpOut = 0;
  let buyCount = 0, sellCount = 0, boughtUsd = 0, soldUsd = 0, soldUsd7d = 0, soldUsd30d = 0, boughtUsd7d = 0, sold7d = 0, sold30d = 0, bought7d = 0;
  let firstTs = rows.length ? rows[0].ts : 0, lastTs = rows.length ? rows[rows.length - 1].ts : 0;
  let firstBuyTs = 0, firstSellTs = 0, lastSellTs = 0, lastBuyTs = 0;
  const sellDays = new Set(), sellDays14 = new Set(), sellTs = [];
  const sendDests = new Map(), recvFrom = new Map();
  for (const r of rows) {
    const a = Math.abs(r.tok);
    const age = nowTs - r.ts;
    switch (r.action) {
      case "buy": bought += a; buyCount++; boughtUsd += Math.abs(r.usd); if (!firstBuyTs) firstBuyTs = r.ts; lastBuyTs = r.ts; if (age <= 7 * DAY) { boughtUsd7d += Math.abs(r.usd); bought7d += a; } break;
      case "sell": sold += a; sellCount++; soldUsd += Math.abs(r.usd); if (!firstSellTs) firstSellTs = r.ts; lastSellTs = r.ts; sellDays.add(dayKey(r.ts)); sellTs.push(r.ts);
        if (age <= 7 * DAY) { soldUsd7d += Math.abs(r.usd); sold7d += a; } if (age <= 30 * DAY) { soldUsd30d += Math.abs(r.usd); sold30d += a; } if (age <= 14 * DAY) sellDays14.add(dayKey(r.ts)); break;
      case "receive": recv += a; if (r.cp) recvFrom.set(r.cp, (recvFrom.get(r.cp) || 0) + a); break;
      case "send": sent += a; if (r.cp) sendDests.set(r.cp, (sendDests.get(r.cp) || 0) + a); break;
      case "add_lp": lpIn += a; break;
      case "withdraw_lp": lpOut += a; break;
    }
  }
  // Peak balance: forward walk from zero when the history is complete, otherwise anchored
  // backward from the live balance (the recent end is exact under truncation).
  let peak = 0;
  if (!truncated) { let bal = 0; for (const r of rows) { bal += r.tok; if (bal > peak) peak = bal; } peak = Math.max(peak, liveBalance); }
  else { let bal = liveBalance; peak = bal; for (let i = rows.length - 1; i >= 0; i--) { bal -= rows[i].tok; if (bal > peak) peak = bal; } }
  const soldOfPeak = peak > 0 ? Math.min(1, sold / peak) : 0;
  const sentOfPeak = peak > 0 ? Math.min(1, sent / peak) : 0;
  const peakUsd = peak * price;
  const liveUsd = liveBalance * price;
  const gaps = []; for (let i = 1; i < sellTs.length; i++) gaps.push(sellTs[i] - sellTs[i - 1]);
  const freeBag = recv > 0 && recv > bought * 2 && (peak > 0 ? recv / peak >= 0.5 : true);
  const fresh = firstTs > 0 && nowTs - firstTs <= 14 * DAY;

  let status, why;
  const meaningful = peakUsd >= minUsd || soldUsd >= minUsd || liveUsd >= minUsd;
  if (!meaningful) { status = "DUST"; why = "never held a meaningful position"; }
  else if (liveUsd < minUsd) {
    if (soldOfPeak >= 0.5) { status = "OUT"; why = `sold ${Math.round(soldOfPeak * 100)}% of peak and holds under $${minUsd}`; }
    else if (sentOfPeak >= 0.5) { status = "OUT"; why = `transferred ${Math.round(sentOfPeak * 100)}% of peak out and holds under $${minUsd}`; }
    else if (lpIn > 0 && lpIn >= peak * 0.5) { status = "HOLDING"; why = "position moved into a liquidity pool"; }
    else { status = "OUT"; why = `holds under $${minUsd} after a larger position`; }
  }
  else if (sellCount === 0 && sentOfPeak < 0.05) {
    const recentIn = (nowTs - lastBuyTs <= 7 * DAY && lastBuyTs > 0) || (bought7d > 0);
    status = recentIn ? "ACCUMULATING" : "HOLDING";
    why = sellCount === 0 ? (recentIn ? "buying in the last 7 days, no sells" : "no sells on record") : "";
  }
  else if (soldOfPeak >= 0.9) { status = "DRAINING"; why = `sold ${Math.round(soldOfPeak * 100)}% of peak — nearly out`; }
  else if ((sellCount >= 3 && soldOfPeak >= 0.25) || sellDays14.size >= 3 || (peak > 0 && sold7d / peak >= 0.10)) {
    status = "DRAINING";
    why = sellDays14.size >= 3 ? `sold on ${sellDays14.size} separate days in the last 14` : `${sellCount} sells, ${Math.round(soldOfPeak * 100)}% of peak gone`;
  }
  else if (soldOfPeak >= 0.05 || sentOfPeak >= 0.05) { status = "TRIMMING"; why = `sold ${Math.round(soldOfPeak * 100)}%${sentOfPeak >= 0.05 ? ` / transferred ${Math.round(sentOfPeak * 100)}%` : ""} of peak`; }
  else { status = "HOLDING"; why = sellCount ? "sold under 5% of peak" : "no sells on record"; }

  const topSend = [...sendDests.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([to, amt]) => ({ to, amount: Math.round(amt) }));
  const topRecv = [...recvFrom.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([from, amt]) => ({ from, amount: Math.round(amt) }));
  return {
    status, why, rows,
    bought: Math.round(bought), sold: Math.round(sold), received: Math.round(recv), sent: Math.round(sent), lpIn: Math.round(lpIn), lpOut: Math.round(lpOut),
    buyCount, sellCount, boughtUsd: r2(boughtUsd), soldUsd: r2(soldUsd), soldUsd7d: r2(soldUsd7d), soldUsd30d: r2(soldUsd30d), boughtUsd7d: r2(boughtUsd7d),
    peak: Math.round(peak), peakUsd: r2(peakUsd), soldOfPeak: r4(soldOfPeak), sentOfPeak: r4(sentOfPeak),
    sellDays: sellDays.size, sellDays14: sellDays14.size, medianSellGapHours: gaps.length ? r2(median(gaps) / 3600) : null,
    firstSeenTs: firstTs, lastActivityTs: lastTs, firstBuyTs, firstSellTs, lastSellTs, lastBuyTs,
    historyTruncated: !!truncated, txCount: rows.length,
    sendDests: topSend, recvFrom: topRecv,
    flags: { dumper: status === "DRAINING" || status === "OUT" || status === "TRIMMING", freeBag, fresh, botCadence: gaps.length >= 4 && median(gaps) < 120 },
  };
}

// ── First funder: the wallet's first real SOL inflow (dust-aware) ─────────────
async function findFunder(wallet, rpc, enhanced, maxPages) {
  let before = null, lastPage = [], total = 0, reachedGenesis = false;
  for (let p = 0; p < maxPages; p++) {
    const opts = { limit: 1000 }; if (before) opts.before = before;
    const arr = (await rpc("os-funder", "getSignaturesForAddress", [wallet, opts]))?.result || [];
    if (!arr.length) { reachedGenesis = true; break; }
    total += arr.length; lastPage = arr;
    if (arr.length < 1000) { reachedGenesis = true; break; }
    before = arr[arr.length - 1].signature;
  }
  if (!lastPage.length) return { funder: null, kind: null, amountSol: 0, firstTs: 0, tooDeep: !reachedGenesis, lifetimeTx: total };
  const oldest = lastPage.slice(-10).reverse().map((s) => s.signature);
  const parsed = (await enhanced(oldest, "owners-funder")).filter(Boolean).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  const DUST = 0.0015;
  let firstTs = parsed.length ? parsed[0].timestamp || 0 : (lastPage[lastPage.length - 1].blockTime || 0);
  let funding = null, firstTokenIn = null;
  for (const tx of parsed) {
    let best = 0, from = null;
    for (const n of tx.nativeTransfers || []) if (n.toUserAccount === wallet) { const amt = (Number(n.amount) || 0) / 1e9; if (amt > best) { best = amt; from = n.fromUserAccount; } }
    if (best >= DUST && from) { funding = { funder: from, amountSol: best, kind: "SOL", ts: tx.timestamp || 0 }; break; }
    if (!firstTokenIn) for (const t of tx.tokenTransfers || []) if (t.toUserAccount === wallet && t.fromUserAccount && t.fromUserAccount !== wallet) { firstTokenIn = { funder: t.fromUserAccount, amountSol: 0, kind: "token", ts: tx.timestamp || 0 }; break; }
  }
  if (!funding && firstTokenIn) funding = firstTokenIn;
  if (!funding && parsed[0] && parsed[0].feePayer && parsed[0].feePayer !== wallet) funding = { funder: parsed[0].feePayer, amountSol: 0, kind: "first-action", ts: parsed[0].timestamp || 0 };
  return { funder: funding ? funding.funder : null, kind: funding ? funding.kind : null, amountSol: funding ? funding.amountSol : 0, firstTs, tooDeep: !reachedGenesis, lifetimeTx: total };
}

// ── Sell proceeds: SOL / stables that LEFT the wallet after it started selling ─
function proceedsFrom(txs, wallet, sinceTs, solUsd, deps) {
  const out = new Map();
  for (const tx of txs || []) {
    if (!tx || (tx.timestamp || 0) < sinceTs) continue;
    for (const n of tx.nativeTransfers || []) {
      if (n.fromUserAccount !== wallet || !n.toUserAccount || n.toUserAccount === wallet) continue;
      const sol = (Number(n.amount) || 0) / 1e9; if (sol < 0.05) continue;
      const k = n.toUserAccount; const cur = out.get(k) || { to: k, usd: 0, sol: 0, stable: 0, n: 0 };
      cur.usd += sol * solUsd; cur.sol += sol; cur.n++; out.set(k, cur);
    }
    for (const t of tx.tokenTransfers || []) {
      if (t.fromUserAccount !== wallet || !STABLES.has(t.mint) || !t.toUserAccount || t.toUserAccount === wallet) continue;
      const amt = parseFloat(t.tokenAmount) || 0; if (amt < 5) continue;
      const k = t.toUserAccount; const cur = out.get(k) || { to: k, usd: 0, sol: 0, stable: 0, n: 0 };
      cur.usd += amt; cur.stable += amt; cur.n++; out.set(k, cur);
    }
  }
  return [...out.values()].sort((a, b) => b.usd - a.usd).slice(0, 6).map((d) => ({
    ...d, usd: r2(d.usd), sol: r4(d.sol), stable: r2(d.stable),
    label: (deps.KNOWN_CEX_WALLETS && deps.KNOWN_CEX_WALLETS[d.to]) || (deps.KNOWN_SERVICE_WALLETS && deps.KNOWN_SERVICE_WALLETS[d.to]) || null,
    onCurve: deps.isOnCurve(d.to),
  }));
}

// ── Links: transfer edges, shared funders, shared cash-out destinations ─────────
function buildLinks(analysed, deps) {
  const links = [];
  const isCexOrSvc = (a) => !!((deps.KNOWN_CEX_WALLETS && deps.KNOWN_CEX_WALLETS[a]) || (deps.KNOWN_SERVICE_WALLETS && deps.KNOWN_SERVICE_WALLETS[a]));
  const byFunder = new Map(), byProceeds = new Map(), byDistributor = new Map();
  for (const a of analysed.values()) {
    // direct token transfers to/from another wallet (any on-curve wallet, holder or not)
    for (const d of a.sendDests || []) if (d.to && deps.isOnCurve(d.to) && !isCexOrSvc(d.to)) links.push({ kind: "transfer", from: a.wallet, to: d.to, amount: d.amount });
    for (const d of a.recvFrom || []) {
      if (!d.from || !deps.isOnCurve(d.from) || isCexOrSvc(d.from)) continue;
      links.push({ kind: "transfer", from: d.from, to: a.wallet, amount: d.amount });
      const l = byDistributor.get(d.from) || []; l.push(a.wallet); byDistributor.set(d.from, l);
    }
    if (a.funder && !isCexOrSvc(a.funder)) { const l = byFunder.get(a.funder) || []; l.push(a.wallet); byFunder.set(a.funder, l); }
    for (const p of a.proceedsTo || []) if (p.to && p.onCurve && !p.label) { const l = byProceeds.get(p.to) || []; l.push(a.wallet); byProceeds.set(p.to, l); }
  }
  for (const [f, ws] of byFunder) if (ws.length >= 2) for (const w of ws) links.push({ kind: "funder", from: f, to: w });
  for (const [d, ws] of byProceeds) if (ws.length >= 2) for (const w of ws) links.push({ kind: "proceeds", from: w, to: d });
  // de-dupe
  const seen = new Set(); const out = [];
  for (const l of links) { const k = `${l.kind}|${l.from}|${l.to}`; if (seen.has(k)) continue; seen.add(k); out.push(l); }
  return out;
}

function buildClusters(analysed, links, totalSupply, price, deps) {
  const dsu = new DSU();
  for (const l of links) dsu.union(l.from, l.to);
  const groups = new Map();
  for (const l of links) for (const n of [l.from, l.to]) { const r = dsu.find(n); if (!groups.has(r)) groups.set(r, new Set()); groups.get(r).add(n); }
  const clusters = [];
  for (const nodes of groups.values()) {
    const members = [...nodes].filter((n) => analysed.has(n));
    if (members.length < 2) continue;
    const hubs = [...nodes].filter((n) => !analysed.has(n));
    const recs = members.map((w) => analysed.get(w));
    const balance = recs.reduce((s, a) => s + a.balance, 0);
    const kinds = new Set(); for (const l of links) if (nodes.has(l.from) && nodes.has(l.to)) kinds.add(l.kind);
    const draining = recs.filter((a) => a.status === "DRAINING" || a.status === "OUT").length;
    const fresh = recs.filter((a) => a.flags.fresh).length;
    const freeBag = recs.filter((a) => a.flags.freeBag).length;
    const supplyPct = totalSupply ? 100 * balance / totalSupply : 0;
    const soldUsd7d = recs.reduce((s, a) => s + (a.soldUsd7d || 0), 0);
    const flags = [];
    if (kinds.has("funder") && members.length >= 3 && supplyPct >= 1) flags.push(`${members.length} wallets share a first funder and hold ${supplyPct.toFixed(2)}% of supply together`);
    if (freeBag >= 2 && kinds.has("transfer")) flags.push(`${freeBag} wallets were handed their bags by transfer rather than buying`);
    if (fresh >= 2 && supplyPct >= 0.5) flags.push(`${fresh} wallets under 14 days old hold ${supplyPct.toFixed(2)}% of supply together`);
    if (draining >= 2 && soldUsd7d > 0) flags.push(`${draining} linked wallets selling — $${Math.round(soldUsd7d)} in the last 7 days`);
    if (kinds.has("proceeds")) flags.push("sell proceeds from more than one wallet land at the same address");
    clusters.push({
      id: dsu.find(members[0]).slice(0, 8), size: members.length, hubs: hubs.slice(0, 10).map((h) => ({ address: h, label: (deps.KNOWN_CEX_WALLETS && deps.KNOWN_CEX_WALLETS[h]) || null, holder: false })),
      linkKinds: [...kinds], balance: Math.round(balance), usd: r2(balance * price), supplyPct: r4(supplyPct),
      draining, fresh, freeBag, soldUsd7d: r2(soldUsd7d), flags,
      wallets: recs.sort((a, b) => b.balance - a.balance).slice(0, 40).map(slim),
    });
  }
  return clusters.sort((a, b) => (b.flags.length - a.flags.length) || (b.supplyPct - a.supplyPct)).slice(0, 60);
}

function slim(a) {
  return { wallet: a.wallet, status: a.status, why: a.why, balance: Math.round(a.balance), usd: a.usd, supplyPct: a.supplyPct, soldOfPeak: a.soldOfPeak, sellCount: a.sellCount, soldUsd7d: a.soldUsd7d, boughtUsd7d: a.boughtUsd7d, peakUsd: a.peakUsd, funder: a.funder || null, funderLabel: a.funderLabel || null, flags: a.flags, lastActivityTs: a.lastActivityTs, firstSeenTs: a.firstSeenTs };
}

// ── Snapshot diff: who entered, who left, who changed ───────────────────────────
function diffSnapshots(prev, cur, minUsd) {
  const entered = [], exited = [], statusChanged = [], movers = [];
  for (const [w, c] of Object.entries(cur)) {
    const p = prev[w];
    if (!p) { if (c.u >= minUsd) entered.push({ wallet: w, usd: c.u, status: c.s }); continue; }
    if (p.s !== c.s) statusChanged.push({ wallet: w, from: p.s, to: c.s, usd: c.u });
    const d = (c.b || 0) - (p.b || 0);
    if (Math.abs(d) > 0) movers.push({ wallet: w, delta: d, usdNow: c.u, status: c.s });
  }
  for (const [w, p] of Object.entries(prev)) {
    if (!cur[w] || (cur[w].s === "OUT" && p.s !== "OUT")) { if (p.u >= minUsd) exited.push({ wallet: w, usdWas: p.u, statusWas: p.s }); }
  }
  movers.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return {
    summary: { entered: entered.length, exited: exited.length, statusChanged: statusChanged.length, enteredUsd: r2(entered.reduce((s, x) => s + x.usd, 0)), exitedUsd: r2(exited.reduce((s, x) => s + x.usdWas, 0)) },
    entered: entered.sort((a, b) => b.usd - a.usd).slice(0, 50), exited: exited.sort((a, b) => b.usdWas - a.usdWas).slice(0, 50),
    statusChanged: statusChanged.slice(0, 100), topMovers: movers.slice(0, 50),
  };
}

const NOTES = {
  statuses: {
    ACCUMULATING: "No sells on record and bought inside the last 7 days.",
    HOLDING: "No sells on record, or sold under 5% of the wallet's peak balance.",
    TRIMMING: "Sold (or transferred out) between 5% and the draining threshold of peak.",
    DRAINING: "Repeated selling into the market: 3+ sells with 25%+ of peak gone, sells on 3+ separate days in the last 14, 10%+ of peak sold in the last 7 days, or 90%+ of peak gone while still holding.",
    OUT: "Held a meaningful position and now holds under the minimum — sold or transferred it away.",
  },
  honesty: [
    "Every status is arithmetic over this wallet's transfers of this one token. It says WHAT happened on-chain, never why.",
    "A shared first funder is a PATTERN, not a verdict: presale groups, airdrops, team distributions and exchange batch-withdrawals all look identical to a coordinated ring on-chain.",
    "'Free bag' means the tokens arrived by transfer rather than purchase. That is an airdrop, a gift, an OTC deal, or a distribution — the chain can't say which. It matters because a wallet with no cost basis can sell at any price.",
    "USD figures for past trades use TODAY's SOL price, not the price at the time. Token amounts and percentages are exact; dollar history is approximate.",
    "Histories longer than the per-run cap are read from the newest end; peak balance is then anchored from the live balance and may understate an older peak.",
    "Known-exchange and platform wallets are labelled from a short table and are excluded from linking. A destination we don't recognise is just 'a wallet'.",
  ],
};

module.exports = { createEngine, rowFromTx, metricsFor, diffSnapshots, buildLinks, buildClusters, STATUSES, NOTES };
