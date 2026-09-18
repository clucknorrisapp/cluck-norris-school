"use strict";
// Did THIS transaction actually pay THIS wallet THIS much of THIS token?
//
// Both payout journals (/api/cuna-stake/payout and /api/hub/:project/payout, the `sent=` rows the
// airdropper hands back) used to accept a row on getSignatureStatuses alone: confirmed + no error.
// Nothing looked at the mint, the destination or the amount, so one unrelated confirmed signature
// could mark every row in a batch paid — and the public "VERIFY ON-CHAIN" then printed ✓ beside
// a wallet and an amount the chain never carried (deep dive 2026-09-17, P1-048 / P1-035).
//
// This reads the parsed transaction (getTransaction, jsonParsed) and computes the per-OWNER token
// deltas for the mint from meta.pre/postTokenBalances — the same technique lib/hub/access-pay.js
// uses for platform payments. Pure: no RPC here, the caller fetches. BigInt throughout.

// Whole raw units only. BigInt("") is 0n and BigInt(" 12 ") parses, so the shape is checked first —
// an empty or decimal ledger amount is a repair job, never zero owed.
function big(v) { const s = String(v == null ? "" : v).trim(); if (!/^\d+$/.test(s)) return null; try { return BigInt(s); } catch (_) { return null; } }

// Map of token-account OWNER → net delta (post − pre) of `mint` in this transaction, raw units.
// A batch transaction that pays several wallets shows each of them here.
function tokenDeltas(tx, mint) {
  const out = new Map();
  const meta = (tx && tx.meta) || {};
  const add = (rows, sign) => {
    for (const r of rows || []) {
      if (!r || r.mint !== mint || !r.owner) continue;
      const amt = big(r.uiTokenAmount && r.uiTokenAmount.amount);
      if (amt === null) continue;
      out.set(r.owner, (out.get(r.owner) || 0n) + sign * amt);
    }
  };
  add(meta.preTokenBalances, -1n);
  add(meta.postTokenBalances, 1n);
  return out;
}

// Verdict for one journal row. `minRaw` is the amount the batch owes the wallet (raw units) and
// the transfer must cover it EXACTLY or more — the airdropper sends whole raw units from the
// batch's own lines, so there is nothing to round (a 0.1% slack used to mark a short transfer
// fully paid — Codex 2026-09-17). A ledger amount that does not parse is refused, never waved
// through. `notBefore` (unix seconds, the batch's creation time) refuses a transaction that
// landed before the batch existed: it cannot be that batch's payment.
//
// `fundingWallet`/`fundedBy` (optional — adv P0-1, docs/HUB_JOURNAL_VERIFY_2026-09-18.md): when
// either is supplied, a positive verdict additionally requires that AT LEAST one SPL transfer
// instruction (top-level or inner/CPI) delivering `mint` into `wallet`'s own token account was
// itself SOURCED from a token account owned by `fundingWallet` or one of `fundedBy` — never a
// transfer from an unrelated wallet (a DEX buy the holder made herself, an airdrop, another
// project's payout). Omitting both preserves the exact pre-P0-1 behavior (every caller that has
// not been updated to pass them sees what it always saw); every live call site in lib/hub/routes.js
// passes the project's funding wallet, so the check is unconditional in production.
const NOT_BEFORE_SKEW_S = 600;
const FUTURE_SKEW_S = 600;
function rowPaidBy(tx, { mint, wallet, minRaw, notBefore, fundingWallet, fundedBy, nowUnix } = {}) {
  if (!tx) return { ok: false, why: "transaction not found on chain" };
  if (tx.meta && tx.meta.err) return { ok: false, why: "transaction failed on chain" };
  if (!mint || !wallet) return { ok: false, why: "no mint or wallet to check against" };
  if (minRaw !== undefined && minRaw !== null) {
    const need = big(minRaw);
    if (need === null || need < 0n) return { ok: false, why: "the batch's amount for this wallet is not a whole raw number — ledger needs repair" };
  }
  const now = Number.isFinite(Number(nowUnix)) ? Number(nowUnix) : Math.floor(Date.now() / 1000);
  if (tx.blockTime && Number(tx.blockTime) > now + FUTURE_SKEW_S) return { ok: false, why: "this transaction's blockTime is more than 10 minutes in the future — refusing rather than trusting it" };
  if (notBefore) {
    const bt = Number(tx.blockTime);
    if (!(bt > 0)) return { ok: false, why: "the chain has not timestamped this transaction yet — try again" };
    if (bt < Number(notBefore) - NOT_BEFORE_SKEW_S) return { ok: false, why: "this transaction landed before the batch was exported — it cannot be this batch's payment" };
  }
  const delta = tokenDeltas(tx, mint).get(wallet) || 0n;
  if (delta <= 0n) return { ok: false, why: "no " + mint.slice(0, 6) + "… reached this wallet in that transaction", deltaRaw: delta.toString() };
  const need = big(minRaw);
  if (need !== null && need > 0n && delta < need) return { ok: false, why: "transfer smaller than the amount owed (" + delta.toString() + " < " + need.toString() + ")", deltaRaw: delta.toString() };
  const allowed = allowedSourceSet(fundingWallet, fundedBy);
  if (allowed.size) {
    const authorizedRaw = transfersIntoWallet(tx, { mint, wallet }).filter((x) => x.sourceOwner && allowed.has(x.sourceOwner)).reduce((a, x) => a + (big(x.amountRaw) || 0n), 0n);
    if (authorizedRaw <= 0n) return { ok: false, why: "transfer_not_from_funding_wallet", deltaRaw: delta.toString() };
    if (need !== null && need > 0n && authorizedRaw < need) return { ok: false, why: "transfer_not_from_funding_wallet", deltaRaw: delta.toString(), authorizedRaw: authorizedRaw.toString() };
  }
  return { ok: true, deltaRaw: delta.toString() };
}

// Has this (wallet, signature) pair already been recorded as a sent row in ANOTHER batch? One
// transaction can pay several wallets (a batch transfer), so the key is the pair, not the
// signature alone; the current batch is excluded because recordSent resolves its own pending row
// by the same signature. Returns the batch id that holds it, or null. (Codex 2026-09-17,
// finding 3: an earlier payout's signature settled the next batch without a new transfer.)
//
// `journal`/`projectId` (optional — adv P0-2, docs/HUB_JOURNAL_VERIFY_2026-09-18.md): the legacy
// `batches` map passed in is always THIS project's own, so it can never see a sibling project
// reusing the same signature (two projects sharing a reward mint — Codex's original two-project
// attack). The settlement journal is global, so it is the one witness that CAN see across
// projects: any journal entry carrying this exact `sig` that does not belong to this row (a
// different project, batch or wallet) means the identity is already spoken for.
// Round 2 #5 (docs/HUB_JOURNAL_VERIFY_2026-09-18.md): the fraud-signal alert routes.js raises
// needs to tell Codex's original two-project attack (adv P0-2a — a signature that already settled
// a DIFFERENT project's, or a different batch's, row via the GLOBAL journal) apart from the
// routine same-project case (a batch simply re-reporting a row it already recorded, via the
// legacy per-project `batches[].sent` scan) — only the former is a signal worth surfacing. The
// legacy hit keeps returning a plain batch-id string exactly as before (every existing caller
// depends on that shape); only the journal (cross-project) hit is tagged.
const TRANSFER_ALREADY_CONSUMED_WHY = "transfer_already_consumed";
function sigAlreadyUsed(batches, wallet, sig, currentBatchId, { journal, projectId } = {}) {
  if (!wallet || !sig) return null;
  for (const [id, b] of Object.entries(batches || {})) {
    if (id === currentBatchId || !b || !b.sent) continue;
    const row = b.sent[wallet];
    if (row && row.sig && String(row.sig) === String(sig)) return id;
  }
  if (journal) {
    for (const e of Object.values(journal)) {
      if (!e || e.sig !== sig) continue;
      if (e.projectId === projectId && e.batchId === currentBatchId && e.wallet === wallet) continue;
      return { crossProject: true, where: `${e.projectId}:${e.batchId}` };
    }
  }
  return null;
}

// The whole `sent=` row check both payout desks run: for each {wallet, sig} row, the transaction
// must be known, must not have already settled that wallet in another batch (or, cross-project,
// already been consumed by the settlement journal), and must have paid the wallet the batch's
// amount, from the project's own funding wallet, after the batch was exported. `txBySig` is the
// caller's fetched map (sig → parsed tx | null). Returns the rows to record and the rows to
// report back with why.
function verifyBatchRows({ results, txBySig, batches, batchId, mint, amounts, notBefore, fundingWallet, fundedBy, nowUnix, journal, projectId } = {}) {
  const accepted = [], rejected = [];
  for (const r of results || []) {
    const sg = String((r && r.sig) || "").trim();
    const w = String((r && r.wallet) || "");
    let v;
    if (!txBySig || typeof txBySig.has !== "function" || !txBySig.has(sg)) v = { ok: false, why: "no transaction signature" };
    else {
      const prior = sigAlreadyUsed(batches, w, sg, batchId, { journal, projectId });
      if (prior && typeof prior === "object" && prior.crossProject) {
        // Round 2 #5: tagged with the exact `why` the alert at lib/hub/routes.js checks for.
        v = { ok: false, why: TRANSFER_ALREADY_CONSUMED_WHY, detail: `this signature already settled ${prior.where}` };
      } else if (prior) {
        v = { ok: false, why: "this signature already paid " + w.slice(0, 6) + "… in batch " + prior };
      } else {
        v = rowPaidBy(txBySig.get(sg), { mint, wallet: w, minRaw: (amounts || {})[w], notBefore, fundingWallet, fundedBy, nowUnix });
      }
    }
    if (v.ok) accepted.push(r); else rejected.push({ wallet: r && r.wallet, sig: r && r.sig, why: v.why });
  }
  return { accepted, rejected };
}

// ── Addendum B1: the chain's own identity of a transfer, not a fabricated index ─────────────────
// The settlement journal is keyed `settle:<sig>:<instructionIndex>[:<innerIndex>]` (lib/hub/ledger.js
// xferKeyOf) — the chain's own identity of the transfer and nothing else. rowPaidBy/tokenDeltas
// above only prove "this wallet's balance moved in this signature", which is enough for the legacy
// paid/sent bookkeeping but NOT enough to key a journal entry: a batched transaction can carry
// several recipients' transfers under one signature, and a wrong or guessed instruction index would
// let two different wallets collide on the same journal key (or worse, let one wallet's real
// transfer masquerade as a settlement for another). So this locates the SPECIFIC instruction —
// top-level or inner (CPI) — whose parsed SPL-Token transfer/transferChecked moved `mint` into a
// token account owned by `wallet`, using only chain-supplied data (account keys, post-token-balance
// owners): never a position we invented. Returns null — never a guess — when the transfer cannot be
// found or is ambiguous (e.g. two instructions credit the same wallet in one signature); the caller
// then records the legacy sent/paid row as it already does, but skips the journal entry for that row
// and reports why (see lib/hub/settle.js), rather than approximating an identity.
const TOKEN_PROGRAM_NAMES = new Set(["spl-token", "spl-token-2022"]);
function isParsedTransfer(inst) {
  return !!(inst && inst.parsed && TOKEN_PROGRAM_NAMES.has(inst.program) && (inst.parsed.type === "transfer" || inst.parsed.type === "transferChecked"));
}
// token-account ADDRESS -> its index in the transaction's own account key list (works for legacy
// and versioned/v0 messages — jsonParsed getTransaction appends loaded address-table entries onto
// the same accountKeys array).
function accountIndexMap(tx) {
  const keys = (((tx.transaction || {}).message || {}).accountKeys || []);
  const out = new Map();
  keys.forEach((k, i) => { const addr = typeof k === "string" ? k : (k && k.pubkey); if (addr) out.set(addr, i); });
  return out;
}
// accountIndex -> owner, for token accounts of THIS mint only (from postTokenBalances — the
// destination of any transfer we ever construct holds the mint once the transfer lands, whether the
// account pre-existed or was just created in the same transaction).
function ownerByIndexForMint(tx, mint) {
  const out = new Map();
  for (const r of (tx.meta && tx.meta.postTokenBalances) || []) {
    if (r && r.mint === mint && r.owner != null && Number.isInteger(r.accountIndex)) out.set(r.accountIndex, r.owner);
  }
  return out;
}
// Same shape as ownerByIndexForMint but over an arbitrary balances array — used for
// preTokenBalances, whose owner is the SOURCE account's owner (the owner of an existing token
// account never changes across a transfer, so its pre-balance entry is authoritative even for the
// source, which usually shows up only there once its balance goes to zero and it closes).
function ownerByIndexFromBalances(balances, mint) {
  const out = new Map();
  for (const r of balances || []) {
    if (r && r.mint === mint && r.owner != null && Number.isInteger(r.accountIndex)) out.set(r.accountIndex, r.owner);
  }
  return out;
}
function allowedSourceSet(fundingWallet, fundedBy) {
  const set = new Set();
  if (fundingWallet) set.add(String(fundingWallet));
  for (const w of (Array.isArray(fundedBy) ? fundedBy : [])) if (w) set.add(String(w));
  return set;
}
// Every SPL transfer/transferChecked instruction (top-level or inner/CPI) in `tx` that delivers
// `mint` into a token account owned by `wallet`, with the OWNER of its source account (from
// meta.preTokenBalances — never trusted from the instruction's own claim of who signed it, since
// `authority` can be a delegate, not the account owner) and the instruction's own stated amount.
// Adv P0-1: this is what both `rowPaidBy` (the legacy `&sent=` check) and `locateTransferInstruction`
// (the journal) use to require the money came FROM the project, not merely INTO the holder.
function transfersIntoWallet(tx, { mint, wallet } = {}) {
  if (!tx || !tx.meta || tx.meta.err || !mint || !wallet) return [];
  const idxOf = accountIndexMap(tx);
  const destOwnerOf = ownerByIndexForMint(tx, mint);
  const srcOwnerOf = ownerByIndexFromBalances(tx.meta.preTokenBalances, mint);
  const out = [];
  const consider = (inst, instructionIndex, innerIndex) => {
    if (!isParsedTransfer(inst)) return;
    const info = inst.parsed.info || {};
    const dest = info.destination;
    if (!dest) return;
    const destIdx = idxOf.get(dest);
    if (destIdx == null || destOwnerOf.get(destIdx) !== wallet) return;
    const src = info.source;
    const srcIdx = src ? idxOf.get(src) : undefined;
    const sourceOwner = srcIdx != null ? (srcOwnerOf.get(srcIdx) || null) : null;
    const amountRaw = info.amount != null ? String(info.amount) : (info.tokenAmount && info.tokenAmount.amount != null ? String(info.tokenAmount.amount) : null);
    out.push({ instructionIndex, innerIndex, sourceOwner, amountRaw });
  };
  const top = (((tx.transaction || {}).message || {}).instructions || []);
  top.forEach((inst, i) => consider(inst, i, null));
  for (const grp of (tx.meta.innerInstructions || [])) (grp.instructions || []).forEach((inst, j) => consider(inst, Number(grp.index), j));
  return out;
}
// `fundingWallet`/`fundedBy`/`nowUnix` optional, same contract as rowPaidBy above: omitted, the
// pre-P0-1 behavior; supplied (every live call site does), a found-and-unique transfer whose
// source is not one of those wallets is refused — `{ refused: "transfer_not_from_funding_wallet" }`
// rather than null, so the caller (lib/hub/settle.js) can tell "ambiguous/not found" (never a
// fraud signal — the transfer DID land, see that file's header) from "found, but not authorized"
// (a hard refusal — P0-2 requires the caller reject the row entirely, never record it).
function locateTransferInstruction(tx, { mint, wallet, fundingWallet, fundedBy, nowUnix } = {}) {
  if (!tx || !tx.meta || tx.meta.err || !mint || !wallet) return null;
  const now = Number.isFinite(Number(nowUnix)) ? Number(nowUnix) : Math.floor(Date.now() / 1000);
  if (tx.blockTime && Number(tx.blockTime) > now + FUTURE_SKEW_S) return { refused: "transfer_blocktime_in_future" };
  const idxOf = accountIndexMap(tx);
  const ownerOf = ownerByIndexForMint(tx, mint);
  const matches = [];
  const consider = (inst, instructionIndex, innerIndex) => {
    if (!isParsedTransfer(inst)) return;
    const dest = inst.parsed.info && inst.parsed.info.destination;
    if (!dest) return;
    const accIdx = idxOf.get(dest);
    if (accIdx == null) return;
    if (ownerOf.get(accIdx) !== wallet) return;
    matches.push({ instructionIndex, innerIndex });
  };
  const top = (((tx.transaction || {}).message || {}).instructions || []);
  top.forEach((inst, i) => consider(inst, i, null));
  for (const grp of (tx.meta.innerInstructions || [])) {
    (grp.instructions || []).forEach((inst, j) => consider(inst, Number(grp.index), j));
  }
  if (matches.length !== 1) return null;   // none found, or ambiguous — never guess which one
  const m = matches[0];
  const transfers = transfersIntoWallet(tx, { mint, wallet });
  const found = transfers.find((x) => x.instructionIndex === m.instructionIndex && x.innerIndex === m.innerIndex);
  // adv P1-5 / crash P2-1: the receipt names THIS instruction, so its amount must be the amount
  // IT carries — never the wallet's net delta across the whole transaction (which can be smaller
  // than any one instruction when the wallet also sends the same mint elsewhere in the same
  // signature — the report's example: instruction 0 delivers 1.0, the wallet separately sends 0.4
  // elsewhere, net delta reads 0.6, and the OLD code journaled 0.6 as "instruction 0's amount",
  // which instruction 0 never carried). The net delta is kept as a FLOOR, not a cap: this
  // instruction's own destination-owner match already proves the wallet's balance for this mint
  // increased somewhere in the transaction, and requiring that increase be POSITIVE (never
  // requiring it be exactly this instruction's amount) is what "kept as a floor" means — a
  // transaction that somehow nets to zero or negative for this wallet is refused regardless of
  // what any single instruction claims.
  const instAmt = found ? big(found.amountRaw) : null;
  if (instAmt === null || instAmt <= 0n) return null;
  const netDelta = tokenDeltas(tx, mint).get(wallet) || 0n;
  if (netDelta <= 0n) return null;
  const allowed = allowedSourceSet(fundingWallet, fundedBy);
  if (allowed.size) {
    if (!found || !found.sourceOwner || !allowed.has(found.sourceOwner)) return { refused: "transfer_not_from_funding_wallet" };
  }
  return { instructionIndex: m.instructionIndex, innerIndex: m.innerIndex, amountRaw: instAmt.toString(), slot: Number(tx.slot) || 0 };
}

module.exports = { tokenDeltas, rowPaidBy, sigAlreadyUsed, verifyBatchRows, locateTransferInstruction, transfersIntoWallet, allowedSourceSet, NOT_BEFORE_SKEW_S, FUTURE_SKEW_S, TRANSFER_ALREADY_CONSUMED_WHY };
