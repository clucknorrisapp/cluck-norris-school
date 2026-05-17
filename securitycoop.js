// ── Security Coop ────────────────────────────────────────────────────────────
// Wallet permission check. Scans a wallet's SPL token accounts (Token and
// Token-2022) for active delegate approvals — the one kind of "permission" that
// genuinely lingers on Solana — and builds an unsigned Revoke transaction so the
// user can clear them. Non-custodial: the wallet signs in the browser.
const express = require("express");
const { Connection, PublicKey, Transaction } = require("@solana/web3.js");
const {
  TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, createRevokeInstruction,
} = require("@solana/spl-token");

// Mainnet RPC — the project's Helius key, with a public fallback.
function rpcUrl() {
  const key = process.env.HELIUS_API_KEY;
  return key ? `https://mainnet.helius-rpc.com/?api-key=${key}` : "https://api.mainnet-beta.solana.com";
}

// One Revoke instruction per token account stays small; this many comfortably
// fit inside Solana's single-transaction size limit.
const MAX_REVOKE_PER_TX = 20;

const PROGRAMS = [
  { label: "token", id: TOKEN_PROGRAM_ID },
  { label: "token-2022", id: TOKEN_2022_PROGRAM_ID },
];

// ── Scan: find token accounts that have an active delegate ───────────────────
async function scanDelegates(owner) {
  const conn = new Connection(rpcUrl(), "confirmed");
  const ownerPk = new PublicKey(owner);
  const found = [];
  for (const { label, id } of PROGRAMS) {
    let res;
    try {
      res = await conn.getParsedTokenAccountsByOwner(ownerPk, { programId: id });
    } catch (e) {
      // Token-2022 may be unavailable on some RPCs — skip rather than fail.
      continue;
    }
    for (const { pubkey, account } of res.value) {
      const info = account.data && account.data.parsed && account.data.parsed.info;
      if (info && info.delegate) {
        found.push({
          tokenAccount: pubkey.toBase58(),
          mint: info.mint,
          delegate: info.delegate,
          program: label,
          delegatedAmount: (info.delegatedAmount && info.delegatedAmount.uiAmountString) || "0",
          balance: (info.tokenAmount && info.tokenAmount.uiAmountString) || "0",
        });
      }
    }
  }
  return found;
}

// ── Build the unsigned Revoke transaction ────────────────────────────────────
// One Revoke instruction per token account; clearing the delegate. The owner
// is the only signer — they sign and submit it in their wallet.
async function buildRevokeTransaction(owner, accounts) {
  const conn = new Connection(rpcUrl(), "confirmed");
  const ownerPk = new PublicKey(owner);
  const tx = new Transaction();
  for (const a of accounts) {
    const programId = a.program === "token-2022" ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
    tx.add(createRevokeInstruction(new PublicKey(a.tokenAccount), ownerPk, [], programId));
  }
  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  tx.feePayer = ownerPk;
  tx.recentBlockhash = blockhash;
  return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
}

// ── HTTP routes ──────────────────────────────────────────────────────────────
const router = express.Router();
router.use(express.json());

// GET /api/security-coop/scan?wallet=<addr> — list active delegate approvals.
router.get("/scan", async (req, res) => {
  try {
    const wallet = req.query.wallet;
    if (!wallet) return res.status(400).json({ error: "Missing wallet address" });
    try { new PublicKey(wallet); } catch { return res.status(400).json({ error: "Invalid wallet address" }); }
    const delegates = await scanDelegates(wallet);
    res.json({ delegates });
  } catch (e) {
    console.error("[security-coop] scan failed:", e);
    res.status(500).json({ error: e.message || "Scan failed" });
  }
});

// POST /api/security-coop/revoke — build an unsigned tx that clears the
// selected approvals. Body: { owner, accounts: [{ tokenAccount, program }] }.
router.post("/revoke", async (req, res) => {
  try {
    const { owner, accounts } = req.body || {};
    if (!owner) return res.status(400).json({ error: "Missing wallet address" });
    try { new PublicKey(owner); } catch { return res.status(400).json({ error: "Invalid wallet address" }); }
    if (!Array.isArray(accounts) || accounts.length === 0) {
      return res.status(400).json({ error: "No approvals selected" });
    }
    if (accounts.length > MAX_REVOKE_PER_TX) {
      return res.status(400).json({
        error: `Revoke up to ${MAX_REVOKE_PER_TX} at a time so the transaction fits — do the rest in a second pass.`,
      });
    }
    for (const a of accounts) {
      try { new PublicKey(a.tokenAccount); }
      catch { return res.status(400).json({ error: "Invalid token account in selection" }); }
    }
    const txBase64 = await buildRevokeTransaction(owner, accounts);
    res.json({ txBase64 });
  } catch (e) {
    console.error("[security-coop] revoke build failed:", e);
    res.status(500).json({ error: e.message || "Revoke build failed" });
  }
});

module.exports = { router, scanDelegates, buildRevokeTransaction };
