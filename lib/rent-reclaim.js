// lib/rent-reclaim.js — Rent Reclaim, READ SIDE ONLY. Powers GET /api/seeker/reclaimable
// (src/seeker's Rent Reclaim pane, increment 2 of docs/SEEKER_APP_PLAN.md).
//
// This module NEVER builds or signs a transaction — it enumerates a wallet's token accounts and
// classifies each one honestly. Signing is increment 3, with its own adversarial review, because
// it moves user funds (CLAUDE.md: "PLAN != EXECUTE for money"). The server never signs for a
// user; when signing lands, the CLIENT builds and the wallet signs.
//
// Enumerates BOTH token programs (lib/solana-addr's TOKEN_PROGRAMS: SPL Token + Token-2022) —
// CLAUDE.md calls out missing one of these as a recurring bug class here. Reuses lib/rpc's
// failover-aware fetch (the same mechanism /api/helius-rpc itself is built on) rather than a bare
// unguarded fetch(), so a primary RPC outage rolls to a backup instead of going blind.
//
// Reclaimable rent per account is the account's OWN on-chain lamport balance (`account.lamports`
// from getTokenAccountsByOwner), not a recomputed rent-exempt minimum from lib/rent-math's byte
// schedule — that schedule prices a FRESH account today; an existing account keeps the deposit it
// was opened with (rates only ever fell), so its real balance is exactly what closing it returns.
// /api/burn-scan (server.js) already established this same "exact reclaimable rent for THIS
// account" reading; this module follows it rather than inventing a second convention. Only
// lib/rent-math's lamports<->SOL conversion is reused here (see its header for the reuse chain).
//
// ⚠️ RPC failure must read as "unavailable", never as an empty/zero result (CLAUDE.md's rule for
// the tool gate applies equally here — a user must never be told "nothing to reclaim" when we
// simply could not look). So a failure on EITHER program's scan aborts the whole read; it never
// falls back to treating the failed program as if it had zero accounts.
"use strict";

const rpc = require("./rpc");
const { TOKEN_PROGRAMS } = require("./solana-addr");
// rent-math.js lives under public/ (not lib/) so the seeker store-edition build can copy it as a
// browser asset the same way it already copies cluck-util.js/cluck-wallet.js — see its own header.
const { lamportsToSol } = require("../public/rent-math");

// Wrapped SOL is refused outright, regardless of balance — closing it is not something this tool
// offers (its "token balance" IS SOL; treating it like a dead account risks confusing "empty
// wrapped SOL account" with "no SOL here", which is the opposite of true half the time).
const WSOL_MINT = "So11111111111111111111111111111111111111112";

// Bound the work rather than silently truncating: an active DeFi wallet can hold hundreds of
// dust token accounts. `truncated` tells the caller (and the pane) plainly that more exist.
const MAX_ACCOUNTS = 300;

const RPC_TIMEOUT_MS = 15000;

async function rpcCall(url, method, params) {
  const r = await rpc.rpcFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: method, method, params }),
    signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(`RPC ${r.status}`);
  const j = await r.json();
  // A clean HTTP 200 carrying a JSON-RPC-level error is still a failure — never let it fall
  // through as an empty `result` (which downstream would silently read as "zero accounts").
  if (j && j.error) throw new Error((j.error && j.error.message) || "RPC error");
  return j;
}

function classify(raw) {
  if (raw.mint === WSOL_MINT) {
    return { status: "refused", reason: "Wrapped SOL — closing it is not offered here." };
  }
  if (raw.uiAmount > 0) {
    return { status: "holds_balance", reason: "Still holds a token balance — closing it would lose that balance." };
  }
  return { status: "reclaimable", reason: null };
}

// Enumerate `wallet`'s token accounts across both token programs and classify each one.
// Returns { wallet, accountsExamined, accountsTotal, truncated, totalReclaimableLamports,
//           totalReclaimableSol, accounts: [...] }.
// Throws on any RPC failure — the caller (server.js) turns that into an "unavailable" response,
// never a 200 with an empty/zero body.
async function scanReclaimable(wallet) {
  const url = rpc.primaryRpcUrl();
  const raw = [];
  for (const programId of TOKEN_PROGRAMS) {
    const d = await rpcCall(url, "getTokenAccountsByOwner", [wallet, { programId }, { encoding: "jsonParsed" }]);
    const list = (d && d.result && d.result.value) || [];
    for (const acc of list) {
      const info = acc && acc.account && acc.account.data && acc.account.data.parsed && acc.account.data.parsed.info;
      if (!info || !info.mint || !acc.pubkey) continue;
      const ta = info.tokenAmount || {};
      raw.push({
        tokenAccount: acc.pubkey,
        mint: info.mint,
        program: programId,
        uiAmount: Number(ta.uiAmount) || 0,
        decimals: Number(ta.decimals) || 0,
        lamports: Number(acc.account.lamports) || 0,
      });
    }
  }

  const truncated = raw.length > MAX_ACCOUNTS;
  const list = raw.slice(0, MAX_ACCOUNTS);

  let totalReclaimableLamports = 0;
  const accounts = list.map((a) => {
    const c = classify(a);
    if (c.status === "reclaimable") totalReclaimableLamports += a.lamports;
    return { ...a, status: c.status, reason: c.reason };
  });

  return {
    wallet,
    accountsExamined: accounts.length,
    accountsTotal: raw.length,
    truncated,
    totalReclaimableLamports,
    totalReclaimableSol: lamportsToSol(totalReclaimableLamports),
    accounts,
  };
}

module.exports = { scanReclaimable, WSOL_MINT, MAX_ACCOUNTS };
