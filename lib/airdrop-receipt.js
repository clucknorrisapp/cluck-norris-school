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
// One kv key PER SIGNATURE (`airdropReceiptSig:<sig>` → dropId), never one object holding every
// signature ever recorded. The first version of "one signature, one receipt" (Codex round 16) was
// a single map read at the top of the call and written back whole at the end — a read-modify-write
// across the `await getTx()` gap. Two calls in flight at once each wrote back their own copy, and
// the second erased the first's entry: the signature it had just recorded was unindexed again and
// could be recorded on a third receipt (Codex round 17, reproduced). A key per signature means a
// write can only ever claim ITS signature; it cannot forget anyone else's.
const SIG_KEY_PREFIX = "airdropReceiptSig:";
function sigKey(sig) { return SIG_KEY_PREFIX + sig; }
function receiptOfSig(kv, sig) { const v = kv.get(sigKey(sig), null); return typeof v === "string" && v ? v : null; }
// A ROW is one recipient paid in one transaction, so its identity is (signature, wallet) — never
// the signature alone (Codex round 18, P1: the airdropper pays MANY recipients per transaction,
// and rows keyed by signature kept one recipient of each batch and reported the rest as
// duplicates). Transaction OWNERSHIP (one signature, one receipt — the per-signature key above)
// is a separate question from row identity: one signature owns many rows on one receipt.
// Rows written before this change were keyed by the bare signature; rowOnDrop reads both shapes
// so a retry of an old row is still recognised and never stored twice.
function rowKey(sig, wallet) { return sig + ":" + wallet; }
function rowOnDrop(drop, sig, wallet) {
  const rows = (drop && drop.rows) || {};
  const r = rows[rowKey(sig, wallet)];
  if (r) return r;
  const legacy = rows[sig];
  return legacy && legacy.wallet === wallet ? legacy : null;
}

function newDropId() {
  // 12 bytes base64url ≈ 16 chars — unguessable (this is a public, shareable URL) and never
  // collides in practice; loadDrop() below still checks for an existing id defensively.
  return crypto.randomBytes(12).toString("base64url");
}

function loadDrop(kv, dropId) { return kv.get(kvKey(dropId), null); }

// Verify + record one call's worth of rows against an existing or brand-new drop.
//   kv        — the store (get/set[/setVerified/setManyVerified]).
//   dropId    — omitted to start a NEW drop; otherwise must name an existing one with the SAME
//               mint/decimals/createdAt already on record (a drop's identity is immutable).
//   mint, decimals, createdAt (ms) — the drop's terms; required to CREATE, must match to CONTINUE.
//   rows      — [{ wallet, amount, sig }], the batch just confirmed on-chain by the airdrop page.
//   ⚠️ ONLY VERIFIED ROWS ARE EVER STORED (Codex, round 16, 2026-09-22). Until then a row that
//   failed local validation, could not be read, or did not match was written to the drop with its
//   reason, so the public page could show it. Once the route took no credential that became a
//   write anyone could make: 1,999 junk rows appended to a known dropId hit the row cap and the
//   operator's next real row was refused; a replayed FAILED transaction created 20 empty drops and
//   burned its fee payer's daily quota. Now a row is stored only when the chain shows it landed
//   and the drop's operator funded it; every other row comes back in `results` with its reason and
//   touches nothing. A NEW drop is created only when at least one row verified in the same call
//   (else 409 and nothing written), so a drop always has an operator and the cap is charged at
//   the moment the first real row lands. A verified signature belongs to exactly one receipt.
//   ⚠️ TWO PHASES, AND THE SECOND NEVER AWAITS (Codex, round 17, 2026-09-22). Phase 1 verifies
//   every row against the chain and WRITES NOTHING — it only collects candidates. Phase 2 (commit)
//   re-reads the drop and each candidate signature's owner from the store and writes, all in one
//   synchronous stretch: no `await` between the check and the persist, so within this process two
//   calls can never both claim one signature and never lose each other's rows. Round 16 checked
//   the signature index and mutated a drop loaded BEFORE the chain round-trip, then wrote both
//   back whole: the same signature posted twice at once made two receipts; two batches of one drop
//   posted at once kept only the second's rows. Across PROCESSES the store's own mtime refresh is
//   the only guard (lib/kvstore.js — "not a real lock"); that limit is the store's, stated there.
//   A call that put NOTHING on the receipt — and found none of its rows already there — is a
//   409 whether the drop is new or existing, so a client can never count a batch as recorded
//   because the call "succeeded" (round 17: an existing drop answered 200 + nothingNew for a
//   batch of which zero rows verified, and the pane counted the whole chunk as on the receipt).
//   operator  — the wallet the caller has PROVEN (server.js: the receipt session — the wallet
//               signed a nonce; no holdings check, so the Airdropper stays free). Every row must
//               be funded by that wallet (sourceIsOperator), an existing drop must belong to it
//               (403 otherwise), and the daily-drop cap is keyed on it. It is never stored
//               publicly. Codex round 18, P2: with the operator only DERIVED from the chain
//               (feePayerOf, rounds 15–17), a stranger who knew an operator's unrecorded public
//               transfer could claim it on a receipt of their own first, and the operator's own
//               recording then got 409 — so the route requires the session now. The derived path
//               remains for a caller that passes no operator (tests; nothing on the surface).
//   A row's identity is (signature, wallet) — see rowKey — because one batch transaction pays
//   many recipients; the signature alone is only the OWNERSHIP key (one signature, one receipt).
//   getTx(sig)— async sig -> parsed transaction (jsonParsed getTransaction shape) or null/throws.
//   now       — Date.now() by default; overridable for tests.
//   Returns { ok, dropId, drop, results, totals } — `results` is one entry per input row, in input
//   order, each { wallet, sig, verified, reason[, amount, alreadyRecorded] }; `totals` carries
//   `stored` (rows this call put on the receipt), `alreadyRecorded` (rows of this call that were
//   already on it) and `refused` (rows of this call that are not on it) beside the receipt-wide
//   `rows` / `verified`, so a client counts what LANDED and never the chunk it sent.
const ALREADY_ELSEWHERE = "already recorded on another receipt";
function capReached(kv, operator, now) {
  const seen = kv.get(opDayKey(operator, dayKeyUtc(now)), []);
  return (Array.isArray(seen) ? seen : []).length >= MAX_DROPS_PER_OPERATOR_PER_DAY;
}
function capRefusal() {
  return { ok: false, status: 429, error: `daily drop cap reached (${MAX_DROPS_PER_OPERATOR_PER_DAY}/day per operator) — try again tomorrow, or keep recording into an existing dropId` };
}
function nothingRecorded(isNew, results) {
  return { ok: false, status: 409, error: isNew
    ? "no row could be verified on-chain yet — nothing was recorded; retry once the transactions are readable"
    : "none of these rows could be verified on-chain — nothing was added to the receipt; see each row's reason", results };
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

  // The drop as it stands when the call starts. Phase 1 READS it (identity, operator, which
  // signatures are already on it); phase 2 re-reads it fresh and is the only thing that writes.
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
  const incomingKeys = new Set(rows.map((r) => [String((r && r.sig) || "").trim(), String((r && r.wallet) || "").trim()]).filter(([s, w]) => wellFormedSig(s) && SOL_ADDR_RE.test(w)).map(([s, w]) => rowKey(s, w)));
  const newKeys = [...incomingKeys].filter((k) => !drop.rows[k] && !rowOnDrop(drop, k.slice(0, k.lastIndexOf(":")), k.slice(k.lastIndexOf(":") + 1)));
  if (existingCount + newKeys.length > MAX_ROWS_PER_DROP) {
    return { ok: false, status: 400, error: `this drop would exceed the ${MAX_ROWS_PER_DROP}-row cap — start a new drop for the rest` };
  }

  // ── Phase 1: verify. Reads the chain, writes nothing, mutates nothing on `drop`. ────────────
  const notBeforeSec = Math.floor(created / 1000);
  const results = new Array(rows.length);
  const candidates = [];            // { i, sig, row } — rows the chain confirmed, pending commit
  const firstIndexOfRow = new Map(); // the same (signature, wallet) twice in one call is answered once
  const native = isNativeMint(mint);
  let op = drop.operator || null;    // adopted from the first verified row when the drop has none
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const wallet = String((r && r.wallet) || "").trim();
    const amount = r && r.amount;
    const sig = String((r && r.sig) || "").trim();

    // Every early exit below REPORTS and stores nothing — see the header. A row that is not on
    // the chain the way the caller says is not part of the receipt, whoever the caller is.
    if (!SOL_ADDR_RE.test(wallet)) { results[i] = { wallet, sig, verified: false, reason: "not a wallet address" }; continue; }
    if (!wellFormedSig(sig)) { results[i] = { wallet, sig, verified: false, reason: "not a valid transaction signature" }; continue; }
    const rk = rowKey(sig, wallet);
    if (firstIndexOfRow.has(rk)) { results[i] = { dupOf: firstIndexOfRow.get(rk) }; continue; }
    firstIndexOfRow.set(rk, i);

    // Idempotent on the ROW: a (signature, wallet) already on this receipt is a no-op — return
    // what's on file rather than re-hit the chain. (Only verified rows are ever on file.)
    const existing = rowOnDrop(drop, sig, wallet);
    if (existing && existing.verified === true) { results[i] = { wallet: existing.wallet, sig, amount: existing.amount, verified: true, reason: null, alreadyRecorded: true }; continue; }
    // One signature, one receipt — checked here to spare the chain round-trip, and AGAIN at commit.
    const owner = receiptOfSig(kv, sig);
    if (owner && owner !== dropId) { results[i] = { wallet, sig, verified: false, reason: ALREADY_ELSEWHERE }; continue; }

    const raw = toRaw(amount, dec);
    if (raw === null) { results[i] = { wallet, sig, verified: false, reason: "invalid amount" }; continue; }

    let tx = null, fetchErr = null;
    try { tx = await getTx(sig); } catch (e) { fetchErr = String((e && e.message) || e); }
    if (fetchErr) { results[i] = { wallet, sig, verified: false, reason: `could not read the chain: ${fetchErr}` }; continue; }

    // The operator: on record, or — the normal case since 2026-09-22, nothing names the wallet
    // but the chain — the fee payer of this transaction, adopted only if this row then verifies.
    let rowOp = op;
    if (!rowOp) {
      rowOp = feePayerOf(tx);
      if (!rowOp) { results[i] = { wallet, sig, verified: false, reason: "transaction names no fee payer" }; continue; }
    }
    const v = native
      ? nativeRowPaid(tx, { wallet, minRaw: raw.toString(), notBefore: notBeforeSec, nowUnix: Math.floor(now / 1000) })
      : payoutVerify.rowPaidBy(tx, { mint, wallet, minRaw: raw.toString(), notBefore: notBeforeSec, nowUnix: Math.floor(now / 1000) });
    // rowPaidBy only matches mint + destination owner + amount — it says nothing about WHO paid.
    // A transfer of the same mint into the recipient from a stranger (or routed through a DEX via
    // an inner CPI) would otherwise record as this operator's airdrop; sourceIsOperator closes it,
    // and it runs on every row now that every drop has an operator from its first row on.
    let ok = !!v.ok, reason = v.ok ? null : v.why;
    if (ok) {
      const fundedByOperator = native
        ? nativeSourceIsOperator(tx, { operator: rowOp, minRaw: raw })
        : sourceIsOperator(tx, { mint, operator: rowOp, minRaw: raw });
      if (!fundedByOperator) { ok = false; reason = SOURCE_MISMATCH_REASON; }
    }
    if (!ok) { results[i] = { wallet, sig, verified: false, reason }; continue; }

    // The first verified row of a NEW drop fixes its operator and charges the daily cap — before
    // anything is written, so a refused drop leaves no trace.
    if (!op) {
      if (isNew && capReached(kv, rowOp, now)) return capRefusal();
      op = rowOp;
    }
    candidates.push({ i, sig, row: { wallet, amount: String(amount), sig, verified: true, reason: null, deltaRaw: v.deltaRaw || null, recordedAt: now } });
  }

  // ── Phase 2: commit. Synchronous from here to the persist — no await, so nothing can land in
  // the store between a check and the write that depends on it. ──────────────────────────────
  let fresh = drop;
  if (!isNew) {
    fresh = loadDrop(kv, dropId);
    if (!fresh) return { ok: false, status: 409, error: "the drop is no longer on record — retry", results: finishResults(results) };
  }
  if (!fresh.rows || typeof fresh.rows !== "object") fresh.rows = {};
  // The daily cap, AGAIN, here where nothing can interleave (Codex round 18, P2: the check in the
  // verify phase ran before further awaited lookups, so two overlapping first-row calls both saw
  // 19 and both created a 20th and a 21st). A new drop with candidates always has `op` by now.
  if (isNew && candidates.length && op && capReached(kv, op, now)) return capRefusal();
  const entries = {};
  let stored = 0;
  for (const c of candidates) {
    const rk = rowKey(c.sig, c.row.wallet);
    // Another call landed this row on THIS receipt while we were reading the chain.
    const already = rowOnDrop(fresh, c.sig, c.row.wallet);
    if (already) { results[c.i] = { wallet: already.wallet, sig: c.sig, amount: already.amount, verified: true, reason: null, alreadyRecorded: true }; continue; }
    // Or on another one. The verify-phase check spares the chain round-trip; THIS one is the
    // guarantee, because nothing can interleave between it and the persist below.
    const owner = receiptOfSig(kv, c.sig);
    if (owner && owner !== dropId) { results[c.i] = { wallet: c.row.wallet, sig: c.sig, verified: false, reason: ALREADY_ELSEWHERE }; continue; }
    if (Object.keys(fresh.rows).length >= MAX_ROWS_PER_DROP) { results[c.i] = { wallet: c.row.wallet, sig: c.sig, verified: false, reason: `this drop is at the ${MAX_ROWS_PER_DROP}-row cap — start a new drop for the rest` }; continue; }
    // A drop's operator is immutable once set; a candidate verified against a different wallet
    // (only possible if the drop gained an operator under this call) is not this drop's row.
    if (fresh.operator && op && fresh.operator !== op) { results[c.i] = { wallet: c.row.wallet, sig: c.sig, verified: false, reason: SOURCE_MISMATCH_REASON }; continue; }
    fresh.rows[rk] = c.row;
    entries[sigKey(c.sig)] = dropId;   // idempotent: every row of one batch transaction names the same receipt
    stored++;
    results[c.i] = { wallet: c.row.wallet, sig: c.sig, verified: true, reason: null };
  }
  const finished = finishResults(results);
  const alreadyRecorded = finished.filter((x) => x.verified && x.alreadyRecorded).length;
  const refused = finished.filter((x) => !x.verified).length;

  if (stored === 0) {
    // Nothing verified. A new drop is NOT created (there is nothing true to put on a public page,
    // and an empty drop would still carry an operator and a quota charge); an existing one is
    // left exactly as it was. A retry whose rows are ALL already on the receipt is a success
    // (idempotent); a batch with nothing on the receipt is a 409, new drop or not.
    if (alreadyRecorded === 0) return nothingRecorded(isNew, finished);
    const n = Object.keys(fresh.rows).length;
    return { ok: true, dropId, drop: fresh, results: finished, nothingNew: true, totals: { rows: n, verified: n, stored: 0, alreadyRecorded, refused } };
  }

  if (!fresh.operator) fresh.operator = op;
  fresh.updatedAt = now;
  // The drop and its new signature keys in ONE persist where the store supports it (kvstore's
  // setManyVerified), so a crash between them can never leave a stored row unindexed.
  entries[kvKey(dropId)] = fresh;
  const persisted = typeof kv.setManyVerified === "function"
    ? kv.setManyVerified(entries) === true
    : (saveDrop(kv, fresh) && (Object.keys(entries).filter((k) => k !== kvKey(dropId)).forEach((k) => kv.set(k, entries[k])), true));
  if (!persisted) return { ok: false, status: 500, error: "record did not reach the store — try again" };
  // A new drop counts against its operator's day once it is on record (it always has an operator
  // by now — its first verified row named one).
  if (isNew && fresh.operator) {
    const key = opDayKey(fresh.operator, dayKeyUtc(now));
    const list = Array.isArray(kv.get(key, [])) ? kv.get(key, []) : [];
    if (!list.includes(dropId)) kv.set(key, [...list, dropId]);
  }

  const n = Object.keys(fresh.rows).length;
  return { ok: true, dropId, drop: fresh, results: finished, totals: { rows: n, verified: n, stored, alreadyRecorded, refused } };
}
// Resolve the in-call duplicates: a signature sent twice in one call gets the first copy's
// outcome, flagged alreadyRecorded + duplicateInCall when that copy landed. A client that counts
// verified rows therefore counts the row as on the receipt (it is) — once per input row.
function finishResults(results) {
  return results.map((x) => {
    if (x && typeof x.dupOf === "number") {
      const first = results[x.dupOf] || { verified: false, reason: "duplicate row in this call" };
      return first.verified ? { ...first, alreadyRecorded: true, duplicateInCall: true } : { ...first, duplicateInCall: true };
    }
    return x || { verified: false, reason: "not processed" };
  });
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
  toRaw, rawToUi, dayKeyUtc, wellFormedSig, kvKey, sigKey, SIG_KEY_PREFIX, receiptOfSig, rowKey, rowOnDrop,
  recordDrop, loadDrop, publicDrop, publicRow, sourceIsOperator,
};
