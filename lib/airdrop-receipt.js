"use strict";
// The airdropper's per-drop public receipt (Colosseum roadmap §W4/§Extension — the Earn leg for
// airdrops: "a holder who can check what they were owed and what arrived").
//
// Today an airdrop is signed in the operator's browser and the result is shown once, as a
// copy-only text block (public/airdrop.html exportAirdropRecord()) — nothing durable exists.
// This module is the durable side: a DROP is a small record — mint, decimals, the moment it was
// created, and a set of ROWS keyed by their own transaction signature. The airdrop page posts
// rows to it as batches confirm; the server here verifies each one against the chain before it
// is ever shown as paid.
//
// Verification reuses lib/payout-verify.js (`rowPaidBy`/`tokenDeltas`) — the same on-chain-delta
// check the CUNA and Hub payout journals run: the signature's parsed transaction must show the
// wallet's own token balance for `mint` increasing by at least the row's amount, and the
// transaction must not predate the drop (the `notBefore` skew check). A row that does not verify
// is recorded `verified:false` with the reason — never silently dropped, never marked paid.
//
// Pure module: no RPC and no kv writes happen implicitly. Callers (server.js) inject `getTx(sig)`
// (an async signature -> parsed-transaction lookup, or a mock in tests) and a `kv`-shaped store
// (get/set, optionally setVerified — see lib/hub/store.js memoryKv for the same convention).

const crypto = require("crypto");
const payoutVerify = require("./payout-verify");
const { SOL_ADDR_RE } = require("./solana-addr");

// No existing cap bounds how many recipients one airdrop can carry — planBatches() in
// airdrop-engine.js only chunks by per-transaction byte budget, it never caps the total. This is
// a NEW bound, chosen generously above any realistic single-operator drop, so this endpoint (and
// the public page rendering it) never has to hold an unbounded payload. Not "the airdropper's
// existing batch limit" — there isn't one; see the commit message / handback report.
const MAX_ROWS_PER_DROP = 2000;
// How many distinct drops one operator wallet may START in a UTC day. Only checked when a NEW
// dropId is minted — adding more verified rows to a drop already in progress today never counts
// against it, so a single legitimate multi-batch send is never throttled mid-flight.
const MAX_DROPS_PER_OPERATOR_PER_DAY = 20;

const SIG_RE = /^[1-9A-HJ-NP-Za-km-z]{60,100}$/;
let bs58;
function wellFormedSig(s) {
  if (typeof s !== "string" || !SIG_RE.test(s)) return false;
  try { bs58 = bs58 || require("bs58"); return bs58.decode(s).length === 64; } catch (_) { return false; }
}

function dayKeyUtc(ms) { return new Date(ms).toISOString().slice(0, 10); }

// decimal string/number -> raw base-unit BigInt, fixed-point (never amount * 10**decimals, whose
// float multiply loses precision — same technique as lib/jup-lock.js toRaw). Returns null instead
// of throwing so a bad row can be reported as "invalid amount" rather than aborting the batch.
function toRaw(amount, decimals) {
  const s = String(amount == null ? "" : amount).trim().replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const dec = Number(decimals);
  if (!Number.isInteger(dec) || dec < 0 || dec > 18) return null;
  const [i, f = ""] = s.split(".");
  if (f.length > dec && /[1-9]/.test(f.slice(dec))) return null; // more precision than the mint has — refuse rather than truncate silently
  const frac = (f + "0".repeat(dec)).slice(0, dec);
  try { return BigInt((i || "0") + frac); } catch (_) { return null; }
}

// raw base units -> whole-token decimal string, by string surgery (never division) — same
// technique as lib/hub/public.js rawToUi, kept local so this module has no server.js dependency.
function rawToUi(raw, decimals) {
  let s = (typeof raw === "bigint" ? raw : BigInt(raw || 0)).toString();
  const neg = s.startsWith("-"); if (neg) s = s.slice(1);
  const dec = Number(decimals) || 0;
  if (!(dec > 0)) return (neg ? "-" : "") + s;
  if (s.length <= dec) s = "0".repeat(dec - s.length + 1) + s;
  const w = s.slice(0, s.length - dec), f = s.slice(s.length - dec).replace(/0+$/, "");
  return (neg ? "-" : "") + w + (f ? "." + f : "");
}

// The reason recorded (and shown in the PUBLIC body — never the operator wallet itself) when a
// transfer pays the right mint/wallet/amount but did not move out of the drop's own operator —
// finding #1 (Codex brief, Round 2, batch 8): rowPaidBy alone matches mint + destination owner +
// amount, so a stranger's unrelated transfer of the same mint to the same recipient would record
// as this operator's airdrop. lib/payout-verify.js is the settlement-journal's file (PR #342 adds
// its own funding-wallet check there for CUNA/Hub payouts) — this drop's check lives here instead
// so the two branches never touch the same lines.
const SOURCE_MISMATCH_REASON = "transfer_not_from_operator";

// Account-index → pubkey list for a jsonParsed getTransaction, tolerant of both accountKeys shapes
// (plain strings on legacy txs, {pubkey,...} objects on versioned ones with address-table lookups).
function accountKeysOf(tx) {
  const msg = tx && tx.transaction && tx.transaction.message;
  const keys = msg && msg.accountKeys;
  if (!Array.isArray(keys)) return [];
  return keys.map((k) => (typeof k === "string" ? k : (k && k.pubkey) || null));
}

// The wallet that PAID FOR this transaction: the first account key is the fee payer on every
// Solana transaction, and on the airdropper (web page and Seeker app alike) that is the operator's
// own wallet — it signs every batch and funds every transfer. This is how a drop learns its
// operator since the Airdropper went free for everyone (owner, 2026-09-22: "airdropper should be
// free for everyone on all platforms"): there is no pass any more, so no signed session names the
// wallet. The chain names it instead, which is stronger — a pass proved a wallet OWNED a key; the
// fee payer proves which wallet PAID for the rows being recorded. Returns null on anything that
// is not a well-formed address, never throws.
function feePayerOf(tx) {
  const first = accountKeysOf(tx)[0];
  return typeof first === "string" && SOL_ADDR_RE.test(first) ? first : null;
}

// Resolve a token ACCOUNT address (as named by a parsed instruction's `source`) to its owner
// WALLET, via the same pre/postTokenBalances rows tokenDeltas reads — they carry `accountIndex`
// and `owner` but not the token account's own address, so the account-keys list is the bridge.
function ownerOfTokenAccount(tx, tokenAccountAddr) {
  if (!tokenAccountAddr) return null;
  const keys = accountKeysOf(tx);
  const idx = keys.indexOf(tokenAccountAddr);
  if (idx < 0) return null;
  const meta = tx.meta || {};
  const row = (meta.postTokenBalances || []).find((b) => b && b.accountIndex === idx)
    || (meta.preTokenBalances || []).find((b) => b && b.accountIndex === idx);
  return (row && row.owner) || null;
}

// Every parsed instruction in the transaction, top-level AND inner (a DEX or any other CPI moves
// the mint through a NESTED instruction, not a top-level one — the "inner-CPI transfer" case this
// exists to catch).
function allParsedInstructions(tx) {
  const out = [];
  const top = tx && tx.transaction && tx.transaction.message && tx.transaction.message.instructions;
  if (Array.isArray(top)) out.push(...top);
  const inner = tx && tx.meta && tx.meta.innerInstructions;
  if (Array.isArray(inner)) for (const grp of inner) if (grp && Array.isArray(grp.instructions)) out.push(...grp.instructions);
  return out;
}

// Did `operator` fund this transfer? Two independent reads, either is enough:
//  1) pre/postTokenBalances delta — the owner whose balance of `mint` DECREASED by at least the
//     row's amount. This is the primary check: it reflects the transaction's NET effect regardless
//     of how many programs or CPI hops moved the tokens, so a DEX-routed inner-CPI transfer still
//     shows the DEX's own pool/authority losing the balance, never the operator, and is correctly
//     rejected without needing to understand the DEX's instruction shape at all.
//  2) a parsed spl-token `transfer`/`transferChecked` instruction (top-level or inner) naming the
//     operator as `info.authority` directly, or as the OWNER of `info.source` (the token account
//     doing the sending) once resolved via ownerOfTokenAccount(). Belt-and-suspenders for a
//     transaction shape where (1) is inconclusive (e.g. a delegate authority, or a partial mock).
// Returns false (never throws) when `operator` is falsy — callers only run this when the drop has
// one on record; a drop with no stored operator has nothing to compare against.
// ── native SOL ───────────────────────────────────────────────────────────────────────────────
// A SOL drop could never be recorded at all (adversarial review P2-5, 2026-09-21): the pane
// posted the literal string "native" as the mint, SOL_ADDR_RE rejected it, and every SOL drop
// died on "bad mint" — deterministically, for half the tool's modes, under a lede promising
// "a public receipt anyone can check afterwards".
//
// The handle is the canonical wrapped-SOL mint address. It is a real base58 address, so it needs
// no special case in storage, in the URL, or on the receipt page.
//
// ⚠️ Verification CANNOT go through payoutVerify.rowPaidBy for a native drop: that reads
// pre/postTokenBalances, and a plain SystemProgram transfer touches none. Rather than widen the
// Hub's shared money verifier — which settles real payouts and has its own tests — the native
// path is computed here, locally, from the lamport balances the same transaction already
// carries. Nothing in lib/payout-verify.js changes.
const NATIVE_MINT = "So11111111111111111111111111111111111111112";
function isNativeMint(mint) { return String(mint || "") === NATIVE_MINT; }

// accountKeys are strings on a jsonParsed tx and {pubkey} objects on some shapes; tolerate both.
function accountKeyStrings(tx) {
  const keys = (tx && tx.transaction && tx.transaction.message && tx.transaction.message.accountKeys) || [];
  return keys.map((k) => (typeof k === "string" ? k : (k && k.pubkey) || ""));
}
// Net lamport change for `wallet` in this transaction. A recipient of a SystemProgram transfer
// gains exactly the transferred amount (the FEE is charged to the fee payer, not to them), so a
// positive delta of at least the owed amount is the same evidence tokenDeltas gives for a token.
function lamportDelta(tx, wallet) {
  const keys = accountKeyStrings(tx);
  const i = keys.indexOf(String(wallet || ""));
  if (i < 0) return null;
  const pre = tx && tx.meta && Array.isArray(tx.meta.preBalances) ? tx.meta.preBalances[i] : undefined;
  const post = tx && tx.meta && Array.isArray(tx.meta.postBalances) ? tx.meta.postBalances[i] : undefined;
  if (!Number.isFinite(Number(pre)) || !Number.isFinite(Number(post))) return null;
  return BigInt(Math.trunc(Number(post))) - BigInt(Math.trunc(Number(pre)));
}
// The native mirror of rowPaidBy — same shape, same refusals, same ordering. It says nothing
// about WHO paid; nativeSourceIsOperator below is the separate question, exactly as for tokens.
function nativeRowPaid(tx, { wallet, minRaw, notBefore, nowUnix }) {
  if (!tx) return { ok: false, why: "transaction not found on chain" };
  if (tx.meta && tx.meta.err) return { ok: false, why: "transaction failed on chain" };
  const now = Number.isFinite(Number(nowUnix)) ? Number(nowUnix) : Math.floor(Date.now() / 1000);
  if (tx.blockTime && Number(tx.blockTime) > now + 600) {
    return { ok: false, why: "this transaction's blockTime is more than 10 minutes in the future — refusing rather than trusting it" };
  }
  if (notBefore) {
    const bt = Number(tx.blockTime);
    if (!(bt > 0)) return { ok: false, why: "the chain has not timestamped this transaction yet — try again" };
    if (bt < Number(notBefore) - 120) return { ok: false, why: "this transaction landed before the drop started — it cannot be this drop's payment" };
  }
  const delta = lamportDelta(tx, wallet);
  if (delta === null) return { ok: false, why: "this wallet is not in that transaction" };
  if (delta <= 0n) return { ok: false, why: "no SOL reached this wallet in that transaction", deltaRaw: delta.toString() };
  const need = BigInt(String(minRaw || "0"));
  if (need > 0n && delta < need) return { ok: false, why: "transfer smaller than the amount owed (" + delta.toString() + " < " + need.toString() + ")", deltaRaw: delta.toString() };
  return { ok: true, deltaRaw: delta.toString() };
}
// Did the operator fund it? Their lamports must have gone DOWN by at least the row's amount.
// Deliberately ignores the fee: a drop's fee is far below any real row and demanding
// `amount + fee` would fail honest rows, while demanding only `amount` cannot pass a
// transaction that did not actually move that much out of them.
function nativeSourceIsOperator(tx, { operator, minRaw }) {
  if (!operator) return false;
  const need = typeof minRaw === "bigint" ? minRaw : BigInt(String(minRaw || "0"));
  const delta = lamportDelta(tx, operator);
  return delta !== null && delta <= -need;
}

function sourceIsOperator(tx, { mint, operator, minRaw }) {
  if (!operator) return false;
  const need = typeof minRaw === "bigint" ? minRaw : BigInt(minRaw || 0);

  const deltas = payoutVerify.tokenDeltas(tx, mint);
  for (const [owner, delta] of deltas) {
    if (owner === operator && delta <= -need) return true;
  }

  for (const ix of allParsedInstructions(tx)) {
    const parsed = ix && ix.parsed;
    if (!parsed || typeof parsed !== "object") continue;
    if (parsed.type !== "transfer" && parsed.type !== "transferChecked") continue;
    const info = parsed.info || {};
    if (info.mint && info.mint !== mint) continue; // transferChecked names its mint directly
    const who = info.authority || ownerOfTokenAccount(tx, info.source);
    if (who === operator) return true;
  }
  return false;
}

function kvKey(dropId) { return `airdropDrop:${dropId}`; }
function opDayKey(operator, day) { return `airdropOpDrops:${operator}:${day}`; }

// Same fallback lib/hub/store.js writeVerified uses: a real setVerified re-reads the file and
// answers true only when the value is on disk; a store without one (the memoryKv test fixture,
// or a caller that doesn't need the guarantee) gets a plain set and is trusted.
function saveDrop(kv, drop) {
  if (typeof kv.setVerified === "function") return kv.setVerified(kvKey(drop.dropId), drop) === true;
  kv.set(kvKey(drop.dropId), drop);
  return true;
}

function newDropId() {
  // 12 bytes base64url ≈ 16 chars — unguessable (this is a public, shareable URL) and never
  // collides in practice; loadDrop() below still checks for an existing id defensively.
  return crypto.randomBytes(12).toString("base64url");
}

function loadDrop(kv, dropId) { return kv.get(kvKey(dropId), null); }

// Verify + record one call's worth of rows against an existing or brand-new drop.
//   kv        — the store (get/set[/setVerified]).
//   dropId    — omitted to start a NEW drop; otherwise must name an existing one with the SAME
//               mint/decimals/createdAt already on record (a drop's identity is immutable).
//   mint, decimals, createdAt (ms) — the drop's terms; required to CREATE, must match to CONTINUE.
//   rows      — [{ wallet, amount, sig }], the batch just confirmed on-chain by the airdrop page.
//   operator  — OPTIONAL, and normally omitted since 2026-09-22: the drop's operator is DERIVED
//               from the chain as the fee payer of the first row whose transaction can be read
//               (feePayerOf), then every row must be funded by that wallet (sourceIsOperator) and
//               the daily-drop cap is keyed on it. A caller that already knows the operator (an
//               operator surface with its own credential) may still pass it; a derived or passed
//               operator is never stored publicly. A drop whose first transactions cannot be read
//               keeps operator:null until a row CAN be read, and the cap is not enforced against
//               nobody.
//   getTx(sig)— async sig -> parsed transaction (jsonParsed getTransaction shape) or null/throws.
//   now       — Date.now() by default; overridable for tests.
function capReached(kv, operator, now) {
  const seen = kv.get(opDayKey(operator, dayKeyUtc(now)), []);
  return (Array.isArray(seen) ? seen : []).length >= MAX_DROPS_PER_OPERATOR_PER_DAY;
}
function capRefusal() {
  return { ok: false, status: 429, error: `daily drop cap reached (${MAX_DROPS_PER_OPERATOR_PER_DAY}/day per operator) — try again tomorrow, or keep recording into an existing dropId` };
}
async function recordDrop({ kv, dropId, mint, decimals, createdAt, rows, operator, getTx, now }) {
  now = Number.isFinite(now) ? now : Date.now();
  if (!kv || typeof kv.get !== "function" || typeof kv.set !== "function") throw new Error("recordDrop needs a kv store");
  if (typeof getTx !== "function") throw new Error("recordDrop needs getTx(sig)");

  if (!SOL_ADDR_RE.test(String(mint || ""))) return { ok: false, status: 400, error: "bad mint" };
  const dec = Number(decimals);
  if (!Number.isInteger(dec) || dec < 0 || dec > 18) return { ok: false, status: 400, error: "bad decimals" };
  const created = Number(createdAt);
  if (!Number.isFinite(created) || created <= 0 || created > now + 5 * 60 * 1000) return { ok: false, status: 400, error: "bad createdAt" };
  if (!Array.isArray(rows) || rows.length === 0) return { ok: false, status: 400, error: "rows must be a non-empty list of {wallet, amount, sig}" };

  let drop, isNew = false;
  if (dropId) {
    drop = loadDrop(kv, dropId);
    if (!drop) return { ok: false, status: 404, error: "unknown dropId" };
    if (drop.mint !== mint || Number(drop.decimals) !== dec || Number(drop.createdAt) !== created) {
      return { ok: false, status: 400, error: "mint/decimals/createdAt do not match the drop already on record — start a new drop instead" };
    }
    // Only the operator who started a drop may add to it (when both sides know who that is) — a
    // guessed/observed dropId lets a stranger READ the public receipt, never append rows to it.
    if (drop.operator && operator && drop.operator !== operator) {
      return { ok: false, status: 403, error: "this dropId belongs to a different operator" };
    }
  } else {
    isNew = true;
    if (operator && capReached(kv, operator, now)) return capRefusal();
    dropId = newDropId();
    // A fresh id colliding with a stored one would be a bug (16 random bytes), but never silently
    // overwrite someone else's drop if it somehow did.
    if (loadDrop(kv, dropId)) return { ok: false, status: 500, error: "dropId collision — try again" };
    drop = { dropId, mint, decimals: dec, createdAt: created, operator: operator || null, rows: {}, updatedAt: now };
  }

  const existingCount = Object.keys(drop.rows || {}).length;
  const incomingSigs = new Set(rows.map((r) => String((r && r.sig) || "").trim()).filter(wellFormedSig));
  const newSigs = [...incomingSigs].filter((s) => !drop.rows[s]);
  if (existingCount + newSigs.length > MAX_ROWS_PER_DROP) {
    return { ok: false, status: 400, error: `this drop would exceed the ${MAX_ROWS_PER_DROP}-row cap — start a new drop for the rest` };
  }

  const notBeforeSec = Math.floor(created / 1000);
  const results = [];
  for (const r of rows) {
    const wallet = String((r && r.wallet) || "").trim();
    const amount = r && r.amount;
    const sig = String((r && r.sig) || "").trim();

    if (!SOL_ADDR_RE.test(wallet)) { results.push({ wallet, sig, verified: false, reason: "not a wallet address" }); continue; }
    if (!wellFormedSig(sig)) { results.push({ wallet, sig, verified: false, reason: "not a valid transaction signature" }); continue; }

    // Idempotent on sig: a sig already recorded and verified is a no-op — return what's on file
    // rather than re-hit the chain. One that was recorded but never verified (a transient RPC
    // failure last time) is retried, since nothing was ever shown as paid for it.
    const existing = drop.rows[sig];
    if (existing && existing.verified === true) { results.push({ wallet: existing.wallet, sig, amount: existing.amount, verified: true, reason: null, alreadyRecorded: true }); continue; }

    const raw = toRaw(amount, dec);
    if (raw === null) { drop.rows[sig] = { wallet, amount: String(amount), sig, verified: false, reason: "invalid amount", recordedAt: now }; results.push({ wallet, sig, verified: false, reason: "invalid amount" }); continue; }

    let tx = null, fetchErr = null;
    try { tx = await getTx(sig); } catch (e) { fetchErr = String((e && e.message) || e); }
    if (fetchErr) {
      drop.rows[sig] = { wallet, amount: String(amount), sig, verified: false, reason: `could not read the chain: ${fetchErr}`, recordedAt: now };
      results.push({ wallet, sig, verified: false, reason: drop.rows[sig].reason });
      continue;
    }
    // No operator yet (the normal case since 2026-09-22 — nothing names the wallet but the chain):
    // the first transaction that can be read names it, as its fee payer. For a NEW drop the daily
    // cap is checked the moment the operator is known, before anything is saved.
    if (!drop.operator) {
      const fp = feePayerOf(tx);
      if (fp) {
        if (isNew && capReached(kv, fp, now)) return capRefusal();
        drop.operator = fp;
      }
    }
    const native = isNativeMint(mint);
    const v = native
      ? nativeRowPaid(tx, { wallet, minRaw: raw.toString(), notBefore: notBeforeSec, nowUnix: Math.floor(now / 1000) })
      : payoutVerify.rowPaidBy(tx, { mint, wallet, minRaw: raw.toString(), notBefore: notBeforeSec, nowUnix: Math.floor(now / 1000) });
    // rowPaidBy only matches mint + destination owner + amount — it says nothing about WHO paid.
    // A transfer of the same mint into the recipient from a stranger (or routed through a DEX via
    // an inner CPI) would otherwise record as this operator's airdrop. Only checked when the drop
    // has an operator on record (see sourceIsOperator's own doc).
    let ok = !!v.ok, reason = v.ok ? null : v.why;
    const fundedByOperator = native
      ? nativeSourceIsOperator(tx, { operator: drop.operator, minRaw: raw })
      : sourceIsOperator(tx, { mint, operator: drop.operator, minRaw: raw });
    if (ok && drop.operator && !fundedByOperator) {
      ok = false; reason = SOURCE_MISMATCH_REASON;
    }
    drop.rows[sig] = { wallet, amount: String(amount), sig, verified: ok, reason, deltaRaw: v.deltaRaw || null, recordedAt: now };
    results.push({ wallet, sig, verified: ok, reason });
  }

  drop.updatedAt = now;
  const persisted = saveDrop(kv, drop);
  if (!persisted) return { ok: false, status: 500, error: "record did not reach the store — try again" };
  // A new drop counts against its operator's day only once it is on record (and only when the
  // operator is known — a drop whose transactions could not be read yet is not attributed to anyone).
  if (isNew && drop.operator) {
    const key = opDayKey(drop.operator, dayKeyUtc(now));
    const list = Array.isArray(kv.get(key, [])) ? kv.get(key, []) : [];
    if (!list.includes(dropId)) kv.set(key, [...list, dropId]);
  }

  const verifiedCount = Object.values(drop.rows).filter((r) => r.verified).length;
  return { ok: true, dropId, drop, results, totals: { rows: Object.keys(drop.rows).length, verified: verifiedCount } };
}

// The PUBLIC body for GET /api/airdrop/r/:dropId — whitelisted, never the stored record itself:
// no operator wallet, ever (the drop id is the only identifier a reader gets).
function publicDrop(drop, { symbol } = {}) {
  const rows = Object.values(drop.rows || {})
    .sort((a, b) => (a.recordedAt || 0) - (b.recordedAt || 0))
    .map(publicRow);
  let totalRaw = 0n;
  for (const r of Object.values(drop.rows || {})) {
    if (!r.verified) continue;
    const raw = toRaw(r.amount, drop.decimals);
    if (raw !== null) totalRaw += raw;
  }
  return {
    dropId: drop.dropId, mint: drop.mint, symbol: symbol || null, decimals: drop.decimals,
    createdAt: drop.createdAt, count: rows.length,
    verifiedCount: rows.filter((r) => r.verified).length,
    total: rawToUi(totalRaw, drop.decimals),
    rows,
  };
}
function publicRow(r) {
  return { wallet: r.wallet, amount: r.amount, sig: r.sig, verified: !!r.verified, reason: r.verified ? null : (r.reason || null) };
}

module.exports = { feePayerOf,
  NATIVE_MINT,
  isNativeMint,
  lamportDelta,
  nativeRowPaid,
  nativeSourceIsOperator,
  MAX_ROWS_PER_DROP, MAX_DROPS_PER_OPERATOR_PER_DAY, SOURCE_MISMATCH_REASON,
  toRaw, rawToUi, dayKeyUtc, wellFormedSig, kvKey,
  recordDrop, loadDrop, publicDrop, publicRow, sourceIsOperator,
};
