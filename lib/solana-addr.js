// Pure Solana address primitives + program/wallet constant tables — no network,
// no env, no Express. Shared by /api/trace, /api/snapshot, /api/cluck-score and
// the Token Autopsy so there is exactly one source of truth for "what is this
// address" classification.
const { createHash } = require("crypto");

const SOL_ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/; // base58 mint/wallet shape

// -- ed25519 curve check — the deterministic human-vs-contract signal --
// Real Solana wallets are ed25519 keypairs whose public key lies ON the curve.
// Program-derived addresses (AMM pool authorities, lock/vesting escrows, program
// PDAs) are generated specifically to land OFF the curve so no private key can
// exist for them. So "on curve" == a real wallet someone controls; "off curve"
// == a contract. This needs no RPC call and has none of the ambiguity of
// checking account owners or balances (a real wallet with 0 SOL returns null).
const _B58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58Decode(str) {
  // Leading '1' chars each encode one leading zero byte — count them separately
  // so a key with leading zero bytes decodes to the correct length.
  let zeros = 0;
  while (zeros < str.length && str[zeros] === "1") zeros++;
  const bytes = []; // little-endian numeric accumulator
  for (let i = zeros; i < str.length; i++) {
    const c = _B58_ALPHABET.indexOf(str[i]);
    if (c < 0) return null;
    let carry = c;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  const out = new Uint8Array(zeros + bytes.length);
  for (let i = 0; i < bytes.length; i++) out[zeros + bytes.length - 1 - i] = bytes[i];
  return out;
}
const _ED_P = (1n << 255n) - 19n;
const _ED_D = 37095705934669439343138083508754565189542113879843219016388785533085940283555n;
function _edPowMod(base, exp, mod) {
  let result = 1n;
  base %= mod;
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % mod;
    base = (base * base) % mod;
    exp >>= 1n;
  }
  return result;
}
function isOnCurveBytes(bytes) {
  if (!bytes || bytes.length !== 32) return false;
  // Compressed point: the 32 bytes are y little-endian, top bit is x's sign.
  let y = 0n;
  for (let i = 31; i >= 0; i--) y = (y << 8n) | BigInt(bytes[i]);
  y &= (1n << 255n) - 1n;
  if (y >= _ED_P) return false;
  const y2 = (y * y) % _ED_P;
  // x² = (y² - 1) / (d·y² + 1) mod p
  const num = (y2 - 1n + _ED_P) % _ED_P;
  const den = (_ED_D * y2 + 1n) % _ED_P;
  const x2 = (num * _edPowMod(den, _ED_P - 2n, _ED_P)) % _ED_P;
  if (x2 === 0n) return true;
  // On curve iff x² is a quadratic residue mod p (Euler's criterion)
  return _edPowMod(x2, (_ED_P - 1n) / 2n, _ED_P) === 1n;
}
function isOnCurve(pubkeyBase58) {
  return isOnCurveBytes(base58Decode(pubkeyBase58));
}

// Base58 encoder + associated-token-account (ATA) derivation. Used by /api/trace
// to find a wallet's token account for a mint — including a CLOSED one — so the
// full transaction history can be pulled from getSignaturesForAddress.
function base58Encode(bytes) {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const digits = [];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) { digits.push(carry % 58); carry = (carry / 58) | 0; }
  }
  let str = "1".repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i--) str += _B58_ALPHABET[digits[i]];
  return str;
}
const _TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const _ATA_PROGRAM_ID = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const _PDA_MARKER = Buffer.from("ProgramDerivedAddress", "utf8");
function deriveAta(wallet, mint, tokenProgram = _TOKEN_PROGRAM_ID) {
  const w = base58Decode(wallet), t = base58Decode(tokenProgram), m = base58Decode(mint);
  if (!w || !t || !m) return null;
  const seeds = [Buffer.from(w), Buffer.from(t), Buffer.from(m)];
  const progId = Buffer.from(base58Decode(_ATA_PROGRAM_ID));
  // find_program_address: highest bump whose hash lands off-curve is the PDA
  for (let bump = 255; bump >= 0; bump--) {
    const h = createHash("sha256");
    for (const s of seeds) h.update(s);
    h.update(Buffer.from([bump]));
    h.update(progId);
    h.update(_PDA_MARKER);
    const digest = h.digest();
    if (!isOnCurveBytes(digest)) return base58Encode(digest);
  }
  return null;
}

// Known Solana program IDs, used to sub-classify off-curve (contract) holders
// so the snapshot UI can tell users WHAT each excluded address is. Best-effort —
// anything not matched falls back to a generic "contract" label.
const DEX_PROGRAMS = new Set([
  "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8", // Raydium AMM v4
  "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK", // Raydium CLMM
  "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C", // Raydium CPMM
  "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",  // Orca Whirlpool
  "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo",  // Meteora DLMM
  "Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB", // Meteora Pools (DAMM v1)
  "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG",  // Meteora DAMM v2
  "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN",  // Meteora DBC (Bags bonding curve)
  "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA",  // PumpSwap (pump.fun AMM)
]);
const LOCKER_PROGRAMS = new Set([
  "strmRqUCoQUgGUan5YhzUZa6KqdzwX5L6FpUxfmKg5m", // Streamflow
  "LocpQgucEQHbqNABEYvBvwoxCPsSbG91A1QaQhQQqjn", // Jupiter Lock
  "CChTq6PthWU82YZkbveA3WDf7s97BWhBK4Vx9bmsT743", // Bonfida token-vesting (verified: official repo README + executable on-chain, 2026-07-19)
]);
// SPL Token + Token-2022. A *holder* address owned by one of these programs is
// itself a token account — which only happens when that account is self-owned
// (its authority = its own address): an immovable, permanent lock.
const TOKEN_PROGRAMS = new Set([
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", // SPL Token
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", // Token-2022
]);
// Program ID → human label, used by /api/trace to name contract counterparties.
const PROGRAM_LABELS = {
  "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8": "Raydium",
  "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK": "Raydium CLMM",
  "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C": "Raydium CPMM",
  "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc":  "Orca",
  "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo":  "Meteora DLMM",
  "Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB": "Meteora",
  "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG":  "Meteora DAMM v2",
  "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN":  "Meteora DBC",
  "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA":  "PumpSwap",
  "strmRqUCoQUgGUan5YhzUZa6KqdzwX5L6FpUxfmKg5m":  "Streamflow Lock",
  "LocpQgucEQHbqNABEYvBvwoxCPsSbG91A1QaQhQQqjn":  "Jupiter Lock",
  "CChTq6PthWU82YZkbveA3WDf7s97BWhBK4Vx9bmsT743": "Bonfida Vesting",
  "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4":  "Jupiter",
  "FEE2tBhCKAt7shrod19QttSVREUYPiyMzoku1mL1gqVK": "Bags Fee Shares", // creator fee-claim program
};
// Known SERVICE wallets (on-curve, so not caught by the PDA classifier) that are
// platform infrastructure, NOT people. Labeling them keeps the forensic tools
// honest — e.g. the Bags fee relayer fronts a 1-SOL float on every creator fee
// claim (paid back in the same tx); naive tools mis-read that as a cash-out.
const KNOWN_SERVICE_WALLETS = {
  "BGASPyexYFLvAUEJVGcfvh9bymeCB1Xh34dLTRv5CKyL": "Bags fee relayer",
  "BAGSB9TpGrZxQbEsrEznv5jXXdwyP6AXerN8aVRiAmcv": "Bags platform launcher",
};

// Known CEX hot/custodial wallets on Solana. A token held in one of these among
// its top holders is exchange-CUSTODIED (many users' tokens) — NOT single-entity
// whale concentration — and a token an exchange actually lists/supports is a
// strong legitimacy signal (it cleared the exchange's due diligence and carries
// off-chain order-book liquidity our on-chain view can't see). Shared by the
// free autopsy concentration calc and the premium acquisition trace.
const KNOWN_CEX_WALLETS = {
  "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM": "Coinbase",
  "H8sMJSCQxfKiFTCfDR3DUMLPwcRbM61LGFJ8N4dK3WjS": "Coinbase",
  "2ojv9BAiHUrvsm9gxDe7fJSzbNZSJcxZvf8dqmWGHG8S": "Binance",
  "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9": "Binance",
  "FWznbcNXWQuHTawe9RxvQ2LdCENssh12dsznf4RiouN5": "Kraken",
  "ASTyfSima4LLAdDgoFGkgqoKowG1LZFDr9fAQrg7iaJZ": "OKX",
  "AC5RDfQFmDS1deWZos921JfqscXdByf8BKHs5ACWjtW2": "Bybit",
};

module.exports = {
  SOL_ADDR_RE,
  base58Decode, base58Encode,
  isOnCurveBytes, isOnCurve,
  deriveAta,
  DEX_PROGRAMS, LOCKER_PROGRAMS, TOKEN_PROGRAMS,
  PROGRAM_LABELS, KNOWN_SERVICE_WALLETS, KNOWN_CEX_WALLETS,
};
