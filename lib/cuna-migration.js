"use strict";
// CUNA -> CLKN migration: the PURE decisions. No IO, no clock, no RPC — every input is passed in,
// so scripts/cuna-migration-test.cjs can drive each rule directly. The tick that uses these lives
// in lib/cuna-migration-monitor.js; the runbook is docs/CUNA_MIGRATION_RUNBOOK.md.
//
// Owner's rules (2026-11-06 … 11-09): 27,700 CLKN per 1,000,000 CUNA, both mints legacy SPL with 9
// decimals, so raw -> raw is clknRaw = floor(cunaRaw * 277 / 10000). The payout list is FIXED from
// the snapshot and uploaded by the owner, never committed. Holders are paid only when they send CUNA
// in, up to their row's sendInMax; lockers are paid once on Day 0.
//
// BigInt end to end; every amount that reaches JSON (kv, a route) is a decimal string, because
// JSON.stringify of a BigInt throws and a Number silently loses the low digits of a raw amount.

const { createHash } = require("crypto");
const { tokenDeltas, transfersIntoWallet } = require("./payout-verify");
const { base58Decode, isOnCurve } = require("./solana-addr");

const RATE_NUM = 277n;
const RATE_DEN = 10000n;
const MAX_ROWS = 500;
const WINDOW_DEFAULT_S = 30 * 24 * 3600;
const EXPIRY_MARGIN = 150;          // blocks past lastValidBlockHeight before a not-found may count
const NOTFOUND_GAP_S = 60;          // two not-found reads, at least this far apart
const PARTIAL_ABANDON_S = 600;      // an attempt with no signature (torn file) is dead after this
const MAX_ATTEMPTS = 3;             // dead attempts before an entry is held for the owner
const MAX_ENTRIES = 5000;           // a journal bigger than this is something wrong: refuse to send
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const MEMO_PREFIX = "CLKN migration ";

const DEAD = new Set(["failed", "expired", "abandoned"]);
const COMMITTED_STATES = new Set(["sending", "paid", "anomaly"]);

// Whole raw units only. BigInt("") is 0n and BigInt(" 1 ") parses, so the shape is checked first.
function big(v) {
  if (typeof v === "bigint") return v >= 0n ? v : null;
  const s = String(v == null ? "" : v);
  if (!/^\d+$/.test(s)) return null;
  try { return BigInt(s); } catch (_) { return null; }
}
const str = (b) => (typeof b === "bigint" ? b.toString() : String(b));
const minB = (...xs) => xs.reduce((a, b) => (b < a ? b : a));

function clknForCuna(cunaRaw) {
  const c = big(cunaRaw);
  if (c === null) throw new Error("clknForCuna: not a whole raw amount");
  return (c * RATE_NUM) / RATE_DEN;    // BigInt division truncates toward zero = floor for c >= 0
}

function isAddress(s) {
  if (typeof s !== "string" || s.length < 32 || s.length > 44) return false;
  const b = base58Decode(s);
  return !!b && b.length === 32;
}
function isWalletAddress(s) { return isAddress(s) && isOnCurve(s); }

// ── The uploaded list ─────────────────────────────────────────────────────────────────────────
// rows: [{wallet, sendInMaxCunaRaw, day0LocksClknRaw, day0RewardsClknRaw}] — all four fields,
// raw decimal strings. Anything wrong is a refusal of the WHOLE upload, never a silently dropped
// row: a dropped row is a holder who is quietly not paid.
function canonicalRows(rows) {
  return rows.slice().sort((a, b) => (a.wallet < b.wallet ? -1 : a.wallet > b.wallet ? 1 : 0))
    .map((r) => ({ wallet: r.wallet, sendInMaxCunaRaw: r.sendInMaxCunaRaw, day0LocksClknRaw: r.day0LocksClknRaw, day0RewardsClknRaw: r.day0RewardsClknRaw }));
}
function listSha256(rows) {
  return createHash("sha256").update(JSON.stringify(canonicalRows(rows))).digest("hex");
}
function listTotals(rows) {
  let sendIn = 0n, sendInClkn = 0n, locks = 0n, rewards = 0n, lockers = 0, holders = 0;
  for (const r of rows) {
    const s = big(r.sendInMaxCunaRaw), l = big(r.day0LocksClknRaw), w = big(r.day0RewardsClknRaw);
    sendIn += s; sendInClkn += clknForCuna(s); locks += l; rewards += w;
    if (s > 0n) holders++;
    if (l + w > 0n) lockers++;
  }
  return {
    rowCount: rows.length, holders, lockers,
    sendInMaxCunaRaw: str(sendIn), sendInClknRaw: str(sendInClkn),
    day0LocksClknRaw: str(locks), day0RewardsClknRaw: str(rewards),
    totalClknNeededRaw: str(sendInClkn + locks + rewards),
  };
}
function validateList(rows, { forbidden = [] } = {}) {
  const errors = [];
  if (!Array.isArray(rows) || !rows.length) return { ok: false, errors: ["rows must be a non-empty array"] };
  if (rows.length > MAX_ROWS) return { ok: false, errors: [`at most ${MAX_ROWS} rows (got ${rows.length})`] };
  const bad = new Set(forbidden.filter(Boolean));
  const seen = new Set();
  const out = [];
  rows.forEach((r, i) => {
    const at = `row ${i + 1}`;
    if (!r || typeof r !== "object") { errors.push(`${at}: not an object`); return; }
    const wallet = typeof r.wallet === "string" ? r.wallet.trim() : "";
    if (!isAddress(wallet)) { errors.push(`${at}: wallet is not a 32-byte base58 address`); return; }
    if (seen.has(wallet)) errors.push(`${at}: ${wallet} is listed twice`);
    seen.add(wallet);
    if (bad.has(wallet)) errors.push(`${at}: ${wallet} is the receive wallet, the payer or the treasury — it cannot be on the list`);
    const row = { wallet };
    for (const f of ["sendInMaxCunaRaw", "day0LocksClknRaw", "day0RewardsClknRaw"]) {
      const v = r[f];
      if (typeof v !== "string" || !/^\d+$/.test(v)) { errors.push(`${at}: ${f} must be a raw integer STRING (got ${JSON.stringify(v)})`); continue; }
      row[f] = BigInt(v).toString();   // normalise "007" -> "7" so the hash cannot differ by formatting
    }
    if (Object.keys(row).length === 4 && big(row.sendInMaxCunaRaw) + big(row.day0LocksClknRaw) + big(row.day0RewardsClknRaw) === 0n) {
      errors.push(`${at}: ${wallet} has no amount at all`);
    }
    out.push(row);
  });
  if (errors.length) return { ok: false, errors };
  return { ok: true, rows: canonicalRows(out), sha256: listSha256(out), totals: listTotals(out), offCurve: out.filter((r) => !isOnCurve(r.wallet)).map((r) => r.wallet) };
}
function listIndex(list) {
  const m = new Map();
  for (const r of (list && list.rows) || []) m.set(r.wallet, r);
  return m;
}

// ── Reading one incoming transaction ──────────────────────────────────────────────────────────
// Returns {kind:"unavailable"} (retry; never "no CUNA moved"), {kind:"failed"} (meta.err — skip),
// {kind:"held", reason, quiet} or {kind:"ok", sender, receivedRaw, inRaw, outRaw, ixRaw}.
// The sender is the ONE owner other than the receive wallet whose CUNA fell, netted by OWNER from
// pre/post token balances (never by account index, never the fee payer). A source account closed
// in the same transaction is only in preTokenBalances, so it still nets as a fall.
function classifyIncoming(tx, { mint, receiver }) {
  if (!tx || !tx.meta) return { kind: "unavailable", why: "no transaction or meta" };
  const meta = tx.meta;
  if (meta.err) return { kind: "failed" };
  if (!Array.isArray(meta.preTokenBalances) || !Array.isArray(meta.postTokenBalances)) return { kind: "unavailable", why: "token balance arrays missing" };
  if (!(Number(tx.blockTime) > 0)) return { kind: "unavailable", why: "no blockTime yet" };
  const net = tokenDeltas(tx, mint);
  const receiverNet = net.get(receiver) || 0n;
  const fallers = [...net.entries()].filter(([o, d]) => o !== receiver && d < 0n);
  if (receiverNet <= 0n) {
    // The owner moving CUNA OUT of the receive wallet by hand (selling it) lands here: quiet.
    return { kind: "held", reason: "no_rise", quiet: fallers.length === 0, inRaw: "0" };
  }
  if (fallers.length === 0) return { kind: "held", reason: "no_sender", inRaw: str(receiverNet) };
  if (fallers.length > 1) return { kind: "held", reason: "multi_sender", inRaw: str(receiverNet), fallers: fallers.map(([o]) => o) };
  const [sender, d] = fallers[0];
  const outRaw = -d;
  const ixRaw = transfersIntoWallet(tx, { mint, wallet: receiver })
    .filter((x) => x.sourceOwner === sender)
    .reduce((a, x) => a + (big(x.amountRaw) || 0n), 0n);
  if (ixRaw <= 0n) return { kind: "held", reason: "no_transfer_witness", sender, inRaw: str(receiverNet) };
  return { kind: "ok", sender, receivedRaw: str(minB(receiverNet, outRaw, ixRaw)), inRaw: str(receiverNet), outRaw: str(outRaw), ixRaw: str(ixRaw) };
}

// ── Planning: turn one classified transfer into one journal entry, in chain order ───────────────
// Mutates `journal` (the caller's CLONE): adds the entry and moves credited[sender] in the same
// object, so both land in one verified write. Credit is consumed here, at detection, and never
// returned — a payout attempt that expires leaves the entry owing it, so the cap cannot be spent
// twice by two send-ins whose payouts are both in doubt.
function newEntryBase(sig, { slot, blockTime, now }) {
  return { kind: "sendin", sig, slot: Number(slot) || 0, blockTime: Number(blockTime) || 0, sender: null,
    receivedCunaRaw: "0", creditCunaRaw: "0", excessCunaRaw: "0", clknRaw: "0",
    state: "held", reason: null, detectedAt: now, attempts: [], paidSig: null, paidAt: null };
}
function planIncoming(journal, { list, config, sig, slot, blockTime, cls, now }) {
  if (journal.entries[sig]) return { entry: journal.entries[sig], existed: true };
  const e = newEntryBase(sig, { slot, blockTime, now });
  const hold = (reason) => { e.state = "held"; e.reason = reason; };
  if (cls.kind !== "ok") {
    e.sender = cls.sender || null;
    e.receivedCunaRaw = cls.inRaw || "0";
    e.excessCunaRaw = e.receivedCunaRaw;
    hold(cls.reason);
    if (cls.quiet) e.quiet = true;
    journal.entries[sig] = e;
    return { entry: e };
  }
  e.sender = cls.sender;
  e.receivedCunaRaw = cls.receivedRaw;
  const received = big(cls.receivedRaw);
  const row = listIndex(list).get(cls.sender);
  const w = config.window || {};
  if (cls.sender === config.payerPubkey) { e.excessCunaRaw = str(received); hold("sender_is_payer"); }
  else if (!row) { e.excessCunaRaw = str(received); hold("unlisted_sender"); }
  else if (!(Number(blockTime) >= Number(w.start))) { e.excessCunaRaw = str(received); hold("before_window"); }
  else if (Number(blockTime) >= Number(w.end)) { e.excessCunaRaw = str(received); hold("after_window"); }
  else {
    const cap = big(row.sendInMaxCunaRaw);
    const already = big((journal.credited || {})[cls.sender] || "0") || 0n;
    const room = cap > already ? cap - already : 0n;
    const credit = minB(received, room);
    e.creditCunaRaw = str(credit);
    e.excessCunaRaw = str(received - credit);
    if (credit === 0n) hold("over_cap");
    else {
      journal.credited = journal.credited || {};
      journal.credited[cls.sender] = str(already + credit);
      const clkn = clknForCuna(credit);
      e.clknRaw = str(clkn);
      if (clkn === 0n) { e.state = "nothing_owed"; e.reason = "credit rounds to zero CLKN"; }
      else { e.state = "due"; e.reason = null; }
    }
  }
  journal.entries[sig] = e;
  return { entry: e };
}

// The per-wallet credit, re-derived from the entries. A mismatch with journal.credited means the
// journal was edited or torn: halt rather than pay against a cap nobody can explain.
function derivedCredited(journal) {
  const out = {};
  for (const e of Object.values(journal.entries || {})) {
    if (e.kind !== "sendin" || !e.sender) continue;
    const c = big(e.creditCunaRaw) || 0n;
    if (c === 0n) continue;
    out[e.sender] = str((big(out[e.sender] || "0") || 0n) + c);
  }
  return out;
}
function creditedMismatch(journal) {
  const d = derivedCredited(journal), c = journal.credited || {};
  const keys = new Set([...Object.keys(d), ...Object.keys(c)]);
  for (const k of keys) if (String(d[k] || "0") !== String(c[k] || "0")) return k;
  return null;
}

// ── Attempts ──────────────────────────────────────────────────────────────────────────────────
function isDead(a) { return !!a && DEAD.has(a.outcome); }
function liveAttempts(entry) { return (entry.attempts || []).filter((a) => a.outcome === "live"); }
function deadCount(entry) { return (entry.attempts || []).filter(isDead).length; }

// The next attempt number for a key, or null when ANY attempt the journal or the attempt files know
// of is not provably dead. A file the journal does not list counts as live: a new attempt is never
// built beside one that could still land.
function nextAttemptNo(entry, fileAttempts) {
  const byN = new Map();
  for (const a of entry.attempts || []) byN.set(Number(a.n), a);
  let max = 0;
  for (const a of entry.attempts || []) { if (!isDead(a)) return null; max = Math.max(max, Number(a.n)); }
  for (const f of fileAttempts || []) {
    const j = byN.get(Number(f.n));
    if (!j || !isDead(j)) return null;
    max = Math.max(max, Number(f.n));
  }
  return max + 1;
}

// Judge one live attempt from chain facts gathered by the caller.
//   facts.status: undefined = the status read failed; null = not found; else {err, confirmationStatus}
//   facts.height: finalized block height (only needed when status is null)
//   facts.tx: the finalized parsed payout transaction (undefined = not read / unavailable)
// Verdicts: unknown (block new sends) | failed | wait | wait_tx | paid | anomaly | rebroadcast |
//           notfound (append a read) | expired | abandoned
function judgeAttempt(a, facts, { nowS, payer, clknMint }) {
  if (!a.paySig) {
    return (nowS - Number(a.at || 0) > PARTIAL_ABANDON_S) ? { verdict: "abandoned" } : { verdict: "wait" };
  }
  if (facts.status === undefined) return { verdict: "unknown" };
  const st = facts.status;
  if (st) {
    if (st.err) return { verdict: "failed", why: JSON.stringify(st.err).slice(0, 200) };
    if (st.confirmationStatus !== "finalized") return { verdict: "wait", seen: true };
    const tx = facts.tx;
    if (!tx) return { verdict: "wait_tx", seen: true };
    if (tx.meta && tx.meta.err) return { verdict: "failed", why: "meta.err " + JSON.stringify(tx.meta.err).slice(0, 200) };
    const d = tokenDeltas(tx, clknMint);
    const want = big(a.clknRaw);
    const got = d.get(a.recipient) || 0n, paid = d.get(payer) || 0n;
    if (want !== null && got === want && paid === -want) return { verdict: "paid" };
    return { verdict: "anomaly", why: `landed with recipient ${got} / payer ${paid}, expected +${want} / -${want}` };
  }
  const h = Number(facts.height);
  if (!Number.isFinite(h)) return { verdict: "unknown" };
  const limit = Number(a.lastValidBlockHeight) + EXPIRY_MARGIN;
  if (h <= limit) return { verdict: "rebroadcast" };
  const prior = (a.notFound || []).filter((r) => Number(r.h) > limit && nowS - Number(r.at) >= NOTFOUND_GAP_S);
  if (prior.length >= 1) return { verdict: "expired" };
  return { verdict: "notfound", read: { at: nowS, h } };
}

// The state an entry returns to once all its attempts are dead.
function afterAllDead(entry) {
  if (deadCount(entry) >= MAX_ATTEMPTS) return { state: "held", reason: "attempts_exhausted" };
  return { state: "due", reason: null };
}

// ── Memo witness ──────────────────────────────────────────────────────────────────────────────
function memoFor(key, n) { return `${MEMO_PREFIX}${key} #${n}`; }
// Every (key, n) a getSignaturesForAddress `memo` field (or a raw memo string) names.
function keysFromMemo(memo) {
  const out = [];
  const re = /CLKN migration (\S+) #(\d+)/g;
  let m;
  while ((m = re.exec(String(memo || "")))) out.push({ key: m[1], n: Number(m[2]) });
  return out;
}

// ── Caps ──────────────────────────────────────────────────────────────────────────────────────
function committedClkn(journal, pred) {
  let t = 0n;
  for (const [k, e] of Object.entries(journal.entries || {})) {
    if (!COMMITTED_STATES.has(e.state)) continue;
    if (pred && !pred(k, e)) continue;
    t += big(e.clknRaw) || 0n;
  }
  return t;
}
function walletCapClkn(row, kind) {
  if (!row) return 0n;
  if (kind === "day0") return big(row.day0LocksClknRaw) + big(row.day0RewardsClknRaw);
  return clknForCuna(row.sendInMaxCunaRaw);
}
function recipientOf(key, entry) { return entry.kind === "day0" ? entry.wallet : entry.sender; }
// Can THIS due entry be sent within the caps? Returns {ok} or {ok:false, why, hold}.
function capCheck(journal, key, entry, { list, globalCapRaw }) {
  const amt = big(entry.clknRaw) || 0n;
  if (amt <= 0n) return { ok: false, why: "nothing to pay", hold: "nothing_owed" };
  const g = committedClkn(journal) + amt;
  if (g > big(globalCapRaw)) return { ok: false, why: `global cap ${globalCapRaw} would be exceeded (${g})` };
  const who = recipientOf(key, entry);
  const row = listIndex(list).get(who);
  const cap = walletCapClkn(row, entry.kind);
  const mine = committedClkn(journal, (k, e) => e.kind === entry.kind && recipientOf(k, e) === who) + amt;
  if (mine > cap) return { ok: false, why: `wallet cap ${cap} would be exceeded (${mine})`, hold: "wallet_cap" };
  return { ok: true };
}

// ── Views ─────────────────────────────────────────────────────────────────────────────────────
function emptyJournal() { return { v: 1, entries: {}, credited: {}, cursors: {}, halted: null, lastTick: null }; }
function countsByState(journal) {
  const c = {};
  for (const e of Object.values(journal.entries || {})) {
    const k = e.state === "held" ? `held:${e.reason}` : e.state;
    c[k] = (c[k] || 0) + 1;
  }
  return c;
}
function publicView(journal, list, wallet) {
  const row = listIndex(list).get(wallet) || null;
  const sendInMax = row ? big(row.sendInMaxCunaRaw) : 0n;
  const credited = big(((journal && journal.credited) || {})[wallet] || "0") || 0n;
  const transfers = [];
  let cunaReceived = 0n, clknPaid = 0n;
  let day0 = null;
  for (const [k, e] of Object.entries((journal && journal.entries) || {})) {
    if (e.kind === "day0" && e.wallet === wallet) {
      day0 = { clknRaw: e.clknRaw, state: e.state, paySig: (e.state === "paid" || e.state === "sending") ? (e.paidSig || lastSig(e)) : null };
      if (e.state === "paid") clknPaid += big(e.clknRaw) || 0n;
      continue;
    }
    if (e.kind !== "sendin" || e.sender !== wallet) continue;
    cunaReceived += big(e.receivedCunaRaw) || 0n;
    if (e.state === "paid") clknPaid += big(e.clknRaw) || 0n;
    transfers.push({ sig: k, slot: e.slot, receivedCunaRaw: e.receivedCunaRaw, creditCunaRaw: e.creditCunaRaw, excessCunaRaw: e.excessCunaRaw,
      clknRaw: e.clknRaw, state: e.state, heldReason: e.state === "held" ? e.reason : null,
      paySig: (e.state === "paid" || e.state === "sending") ? (e.paidSig || lastSig(e)) : null });
  }
  transfers.sort((a, b) => (a.slot - b.slot) || (a.sig < b.sig ? -1 : a.sig > b.sig ? 1 : 0));
  if (!day0 && row && big(row.day0LocksClknRaw) + big(row.day0RewardsClknRaw) > 0n) {
    day0 = { clknRaw: str(big(row.day0LocksClknRaw) + big(row.day0RewardsClknRaw)), state: "not_started", paySig: null };
  }
  return {
    wallet, listed: !!row,
    sendInMaxCunaRaw: str(sendInMax), creditedCunaRaw: str(credited),
    remainingCunaRaw: str(sendInMax > credited ? sendInMax - credited : 0n),
    day0, transfers, totals: { cunaReceivedRaw: str(cunaReceived), clknPaidRaw: str(clknPaid) },
  };
}
function lastSig(e) { const a = (e.attempts || []).filter((x) => x.paySig); return a.length ? a[a.length - 1].paySig : null; }

module.exports = {
  RATE_NUM, RATE_DEN, MAX_ROWS, WINDOW_DEFAULT_S, EXPIRY_MARGIN, NOTFOUND_GAP_S, PARTIAL_ABANDON_S, MAX_ATTEMPTS, MAX_ENTRIES,
  TOKEN_PROGRAM, SYSTEM_PROGRAM, MEMO_PREFIX,
  big, clknForCuna, isAddress, isWalletAddress,
  validateList, listSha256, listTotals, canonicalRows, listIndex,
  classifyIncoming, planIncoming, derivedCredited, creditedMismatch,
  isDead, liveAttempts, deadCount, nextAttemptNo, judgeAttempt, afterAllDead,
  memoFor, keysFromMemo, committedClkn, walletCapClkn, recipientOf, capCheck,
  emptyJournal, countsByState, publicView,
};
