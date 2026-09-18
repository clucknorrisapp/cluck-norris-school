"use strict";
// lib/hub/commit.js — Addendum B5: an independent, on-chain witness for a program version's hash
// (Colosseum roadmap E3). Pure. lib/hub/routes.js does the (lazily required) @solana/web3.js
// instruction/transaction construction and the actual chain read; this module is everything worth
// testing byte-exact and without a network: the memo format, verifying an ALREADY-FETCHED
// transaction, and applying an observed commitment to a project's state — once, never overwritten.
//
// The claim this exists to make honest (design Addendum B5): a program-version hash served by the
// same server that computes the payout only lets a reader rerun the arithmetic over
// server-supplied observations — that is reproducible, not independently verified. An on-chain
// memo signed by the project's own FUNDING WALLET, independently checkable by anyone with an
// explorer, is what upgrades the public claim to "independently committed" — and only once THIS
// server has actually observed it land, never on the desk's say-so (a browser can lie about what
// it sent; the chain cannot).

const bs58 = require("bs58");

const MEMO_PROGRAM_ID = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
const PROJECT_ID_RE = /^[a-z0-9][a-z0-9-]{1,31}$/;
const HASH_RE = /^[0-9a-f]{64}$/;

// clkn-hub:v1:<projectId>:<versionId>:<sha256 hash> — its own namespace, versioned ("v1" of the
// MEMO format, unrelated to the program version number that follows it) so a future memo shape
// (a different field order, a JSON body) can never be mistaken for this one by a reader replaying
// old memos.
function memoText(projectId, version, hash) {
  if (!PROJECT_ID_RE.test(String(projectId || ""))) throw new Error(`bad projectId: ${projectId}`);
  if (!Number.isInteger(version) || version < 1) throw new Error(`bad version: ${version}`);
  if (!HASH_RE.test(String(hash || ""))) throw new Error(`bad hash: ${hash}`);
  return `clkn-hub:v1:${projectId}:${version}:${hash}`;
}
// The exact bytes the memo instruction's `data` must carry — UTF-8 of the text above. This is the
// one thing a test diffs against a hand-built Uint8Array before this ships (CLAUDE.md: never ship
// an instruction encoding unchecked), and the only place routes.js needs to reach for the encoding.
function memoBytes(projectId, version, hash) { return Buffer.from(memoText(projectId, version, hash), "utf8"); }

// May this project build a commitment transaction at all? Pure precondition, checked before any
// chain call. A dry-run fixture (lib/hub/demo-fixture.js's "demo"/"demo-b", and any future project
// seeded with `dryRun:true` — Colosseum E10 plans exactly this for a branded pre-terms project)
// never has real money behind it, so a "build" response — which implies "sign this, it costs a
// real fee" — must never reach one. A project with no funding wallet on file (should not happen
// for an approved project, but nothing here assumes the caller checked) has nothing that could
// sign it either.
function assertCanCommit(project) {
  if (!project) throw new Error("no such project");
  if (project.dryRun === true) throw new Error("dry-run projects cannot commit — this is a demo fixture, never a funded programme");
  if (!project.fundingWallet) throw new Error("this project has no funding wallet on file — nothing can sign a commitment");
}

// Every memo instruction's decoded text, found in the TOP-LEVEL instructions of a jsonParsed
// getTransaction result — whichever shape the RPC returned it in: a native "spl-memo" parser
// gives back `parsed` as the plain string itself; without one it comes back as a
// PartiallyDecodedInstruction with base58 `data`, so that's decoded here. Only top-level
// instructions count: the transaction this module's caller builds is a single memo instruction at
// the top level, so a memo nested inside another program's CPI (an inner instruction) was never
// what the funding wallet was asked to sign and is deliberately not treated as a commitment.
function memoTextsIn(tx) {
  const msg = (tx && tx.transaction && tx.transaction.message) || {};
  const ixs = Array.isArray(msg.instructions) ? msg.instructions : [];
  const out = [];
  for (const ix of ixs) {
    if (!ix) continue;
    const pid = ix.programId || ix.program_id || null;
    if (pid !== MEMO_PROGRAM_ID) continue;
    if (typeof ix.parsed === "string") { out.push(ix.parsed); continue; }
    if (typeof ix.data === "string") {
      try { out.push(Buffer.from(bs58.decode(ix.data)).toString("utf8")); }
      catch (_) { out.push(null); }
      continue;
    }
    out.push(null);
  }
  return out;
}

// Verify an ALREADY-FETCHED jsonParsed transaction actually committed `expectedMemo`, paid for by
// `expectedPayer` — never the client's claim of what it sent. `tx` null/undefined means "not found
// or not confirmed yet" (the same convention lib/hub/access-pay.js's parsePayment uses); a failed
// transaction (`meta.err`) never counts as a commitment, whatever it logged.
function verifyCommitTx(tx, { expectedPayer, expectedMemo }) {
  if (!tx) return { ok: false, reason: "transaction not found — not confirmed yet", retry: true };
  if (tx.meta && tx.meta.err) return { ok: false, reason: "transaction failed on-chain" };
  const msg = (tx.transaction || {}).message || {};
  const keys = (msg.accountKeys || []).map((k) => (typeof k === "string" ? k : k && (k.pubkey || k.publicKey)));
  const payer = keys[0] || null;
  if (!payer || payer !== expectedPayer) return { ok: false, reason: "fee payer is not the project's funding wallet", payer };
  const memos = memoTextsIn(tx).filter((m) => m != null);
  if (memos.length !== 1) {
    return { ok: false, reason: memos.length === 0 ? "no memo instruction found on this transaction" : "more than one memo instruction — expected exactly one", count: memos.length };
  }
  if (memos[0] !== expectedMemo) return { ok: false, reason: "memo text does not match this program version", found: memos[0] };
  return { ok: true, payer, slot: Number.isFinite(Number(tx.slot)) ? Number(tx.slot) : null, blockTimeMs: tx.blockTime ? Number(tx.blockTime) * 1000 : null };
}

// Which version a build/observe request targets: an explicit `wanted` (a version number, possibly
// as a string off the wire), or the latest published version when omitted. Returns
// { version, index } or null — never throws, so a route 404s rather than 500s on a project with no
// versions yet or an unknown version number.
function resolveVersion(versions, wanted) {
  const list = Array.isArray(versions) ? versions : [];
  if (wanted != null && wanted !== "") {
    const n = Number(wanted);
    const idx = list.findIndex((v) => v.version === n);
    return idx < 0 ? null : { version: list[idx], index: idx };
  }
  if (!list.length) return null;
  return { version: list[list.length - 1], index: list.length - 1 };
}

// Apply an observed commitment to `state.versions[index]` — ONCE. A version that already carries a
// commitment is returned unchanged (`already:true`) rather than overwritten: Addendum B's
// append-only discipline for settlement entries extends here too — a commitment is a fact about
// what landed on chain at one moment, and a later, different-looking observation of the SAME
// version never replaces it. (Two concurrent observations of the SAME signature would compute the
// same commitment value and are harmless either way; this only refuses to overwrite an existing,
// possibly different, one.)
function applyCommitment(state, index, commitment) {
  const st = state && typeof state === "object" ? state : {};
  const versions = Array.isArray(st.versions) ? st.versions : [];
  if (!Number.isInteger(index) || index < 0 || index >= versions.length) throw new Error("no such program version");
  const existing = versions[index];
  if (existing.commitment) return { state: st, already: true, commitment: existing.commitment };
  const nextVersions = versions.map((v, i) => (i === index ? { ...v, commitment } : v));
  return { state: { ...st, versions: nextVersions }, already: false, commitment };
}

module.exports = { MEMO_PROGRAM_ID, memoText, memoBytes, assertCanCommit, memoTextsIn, verifyCommitTx, resolveVersion, applyCommitment };
