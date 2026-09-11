// CUNA drawing — the official entry registry, as pure logic over an injected store.
//
// Brief from the cunatoken.com site session (owner, 2026-09-11): the site is static and has
// nowhere to keep a list, so the entries for a drawing live here, on the host that already
// serves lock.cunatoken.com, under /api/cuna-draw/*. Two public routes and one export:
//
//   POST /api/cuna-draw/enter   { address }   → recorded (idempotent; a second POST is a no-op)
//   GET  /api/cuna-draw/check?address=         → { found }
//   GET  /api/cuna-draw/export                  → every row, behind a token (never public)
//
// Rules this module owns (the routes in server.js only do HTTP):
//   - an address is valid only if it base58-decodes to EXACTLY 32 bytes — a regex is not enough,
//     43-char addresses are real and a 44-char one with the last character dropped is not;
//     the canonical base58 form is what gets stored, so two spellings cannot become two entries;
//   - the window is enforced HERE, not on the client: closed before `open`, closed at/after `close`;
//   - idempotent by address: the first POST records, every later one answers found:true and
//     records nothing (created_at never moves);
//   - a total-rows cap so a spammer costs storage, not availability (prize integrity is not
//     decided here: an entry only counts if the same address also replied under the pinned
//     X post, checked by hand before the draw);
//   - the store must be durable — a memory-only store means the whole drawing silently
//     evaporates on the next deploy, so entering is refused (503) rather than accepted into
//     nothing. Reads still work.
"use strict";

const { PublicKey } = require("@solana/web3.js");

const KEY = "cunaDrawEntries";
const DEFAULT_WINDOW = Object.freeze({
  open: Date.parse("2026-09-11T15:30:00Z"),
  close: Date.parse("2026-09-13T18:00:00Z"),   // exclusive: at/after this instant the window is closed
});
const DEFAULT_CAP = 20000;

// Canonical base58 form of a 32-byte public key, or null. Anything the wallet could not have
// produced — wrong length after decoding, wrong alphabet, whitespace, an object — is null.
function canonicalAddress(input) {
  if (typeof input !== "string") return null;
  const s = input.trim();
  if (s.length < 32 || s.length > 44 || !/^[1-9A-HJ-NP-Za-km-z]+$/.test(s)) return null;
  try {
    const pk = new PublicKey(s);
    if (pk.toBytes().length !== 32) return null;
    return pk.toBase58();
  } catch (_) { return null; }
}

// Addresses that can never be an entrant's wallet: programs, mints, and PDAs. The site session's
// production test wrote the System Program (32 zero bytes) — valid base58, exactly 32 bytes, on
// the curve, and no private key exists for it. A PDA (a pool vault, a token account authority)
// is off-curve and never a wallet either. Rejected at entry so the export stays tidy; neither
// class could ever collect a prize.
const NOT_A_WALLET = new Set([
  "11111111111111111111111111111111",                  // System Program
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",       // Token Program
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",       // Token-2022
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",      // Associated Token Program
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",       // Memo
  "ComputeBudget111111111111111111111111111111",
  "BPFLoaderUpgradeab1e11111111111111111111111",
  "So11111111111111111111111111111111111111112",       // wrapped SOL mint
  "4yro2xbCxMFVvygCsj5FZMgZnVCb8EqcbPGTbSGCgDBc",      // the CUNA mint itself
  "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",       // Jupiter v6
]);
function walletReason(addr) {
  if (NOT_A_WALLET.has(addr)) return "a program or mint address, not a wallet";
  try { if (!PublicKey.isOnCurve(new PublicKey(addr).toBytes())) return "a program-derived address (off-curve), not a wallet"; } catch (_) { return "not a valid public key"; }
  return null;
}

function windowState(now, window = DEFAULT_WINDOW) {
  if (now < window.open) return "not_open";
  if (now >= window.close) return "closed";
  return "open";
}

function readAll(store) {
  const all = store.get(KEY, {});
  return all && typeof all === "object" && !Array.isArray(all) ? all : {};
}

/**
 * Record an entry. Returns { ok, status, error?, found, recorded, address? }.
 * @param {object} a
 * @param {object} a.store    { get(k,d), set(k,v), isPersistent() }
 * @param {*}      a.address  raw client input
 * @param {number} [a.now]
 * @param {object} [a.window] { open, close } ms
 * @param {string} [a.ipHash] opaque, stored beside the row for abuse review only
 * @param {number} [a.cap]
 */
function enter({ store, address, now = Date.now(), window = DEFAULT_WINDOW, ipHash = null, cap = DEFAULT_CAP }) {
  const addr = canonicalAddress(address);
  if (!addr) return { ok: false, status: 400, error: "address must be a valid Solana public key (base58, 32 bytes)", found: false, recorded: false };
  const why = walletReason(addr);
  if (why) return { ok: false, status: 400, error: "address is " + why, found: false, recorded: false };
  const w = windowState(now, window);
  if (w !== "open") return { ok: false, status: 403, error: w === "not_open" ? "the drawing has not opened yet" : "the drawing is closed", found: false, recorded: false, window: w };
  const all = readAll(store);
  if (Object.prototype.hasOwnProperty.call(all, addr)) return { ok: true, status: 200, found: true, recorded: false, address: addr, at: all[addr].at };
  if (!store.isPersistent()) return { ok: false, status: 503, error: "entry registry is not durable right now — try again in a moment; nothing was recorded", found: false, recorded: false };
  if (Object.keys(all).length >= cap) return { ok: false, status: 503, error: "entry registry is full", found: false, recorded: false };
  all[addr] = { at: now, ...(ipHash ? { ipHash } : {}) };
  store.set(KEY, all);
  return { ok: true, status: 200, found: true, recorded: true, address: addr, at: now };
}

function check({ store, address }) {
  const addr = canonicalAddress(address);
  if (!addr) return { ok: false, status: 400, error: "address must be a valid Solana public key (base58, 32 bytes)", found: false };
  const all = readAll(store);
  const row = Object.prototype.hasOwnProperty.call(all, addr) ? all[addr] : null;
  return { ok: true, status: 200, found: !!row, address: addr, ...(row ? { at: row.at } : {}) };
}

// Owner-only removal (a test row, a duplicate, a bad one). Returns removed:false when absent.
function deleteEntry({ store, address }) {
  const addr = canonicalAddress(address);
  if (!addr) return { ok: false, status: 400, error: "address must be a valid Solana public key (base58, 32 bytes)", removed: false };
  const all = readAll(store);
  if (!Object.prototype.hasOwnProperty.call(all, addr)) return { ok: true, status: 200, removed: false, address: addr };
  const was = all[addr];
  delete all[addr];
  store.set(KEY, all);
  return { ok: true, status: 200, removed: true, address: addr, was };
}

function exportRows(store) {
  const all = readAll(store);
  return Object.keys(all).sort((a, b) => (all[a].at || 0) - (all[b].at || 0) || a.localeCompare(b))
    .map((address) => ({ address, at: all[address].at, created_at: new Date(all[address].at || 0).toISOString(), ipHash: all[address].ipHash || null }));
}

function windowFromEnv(env = process.env) {
  const open = Date.parse(env.CUNA_DRAW_OPEN || "") || DEFAULT_WINDOW.open;
  const close = Date.parse(env.CUNA_DRAW_CLOSE || "") || DEFAULT_WINDOW.close;
  return { open, close };
}

module.exports = { KEY, DEFAULT_WINDOW, DEFAULT_CAP, NOT_A_WALLET, canonicalAddress, walletReason, windowState, enter, check, deleteEntry, exportRows, windowFromEnv };
