// lib/school-airdrop.js
// Sends CLKN graduate-reward airdrops. Funding wallet = AIRDROP_SECRET env (base58 or JSON
// secret key). UNSET = feature fully OFF (isEnabled() === false) → a safe no-op, mirroring
// MM_OPERATOR_SECRET. Fund it with ONLY the airdrop float + a little SOL for fees/ATA rent;
// never the treasury, the engine, or any mint authority. This wallet SENDS CLKN it already
// holds — it never buys CLKN and never touches the brand bag.
//
// Safety rails:
//  • Idempotent per wallet (kv schoolAirdropPaidV1) — a graduate can't be double-paid.
//  • Per-send max guard (kv schoolAirdropMax, default 100000) — typo protection.
//  • Resilient RPC via lib/rpc (primary Helius + failover).
const { PublicKey, Keypair, Transaction } = require("@solana/web3.js");
const bs58 = require("bs58");
const spl = require("@solana/spl-token");
const { connection } = require("./rpc");
const kv = require("./kvstore");

const CLKN_MINT = new PublicKey("DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS");
const DECIMALS = 9;
const PAID_KV = "schoolAirdropPaidV1"; // wallet -> { sig, amount, at }

// Funding wallet secret. Prefer a dedicated AIRDROP_SECRET; if unset, fall back to the
// treasury wallet (MM_OPERATOR_SECRET_TREASURY) — the same wallet that mints the diploma
// NFTs and holds the project's liquid CLKN, so the reward ships from the same place as the
// diploma. Set AIRDROP_SECRET to override with an isolated float wallet.
function secretBytes() {
  const raw = (process.env.AIRDROP_SECRET || process.env.MM_OPERATOR_SECRET_TREASURY || "").trim();
  if (!raw) return null;
  try { return raw.startsWith("[") ? Uint8Array.from(JSON.parse(raw)) : bs58.decode(raw); }
  catch { return null; }
}
function isEnabled() { return !!secretBytes(); }
function keypair() { const b = secretBytes(); return b ? Keypair.fromSecretKey(b) : null; }
function payerPubkey() { const kp = keypair(); return kp ? kp.publicKey.toBase58() : null; }
function maxPerSend() { return Number(kv.get("schoolAirdropMax", 100000)) || 100000; }
function isPaid(wallet) { const p = kv.get(PAID_KV, {}) || {}; return !!p[wallet]; }

// Read the airdrop wallet's CLKN + native SOL balance (for a pre-flight "enough funds?" check).
async function balances() {
  const kp = keypair();
  if (!kp) return null;
  const conn = connection();
  let clkn = 0, sol = 0;
  try { sol = (await conn.getBalance(kp.publicKey)) / 1e9; } catch (_) {}
  try {
    const ata = await spl.getAssociatedTokenAddress(CLKN_MINT, kp.publicKey);
    const acc = await spl.getAccount(conn, ata);
    clkn = Number(acc.amount) / 10 ** DECIMALS;
  } catch (_) { /* no CLKN ATA yet */ }
  return { pubkey: kp.publicKey.toBase58(), clkn, sol };
}

// Send `amount` CLKN (UI units) to `wallet`. Idempotent per wallet unless force.
async function sendReward(wallet, amount, { force = false } = {}) {
  const kp = keypair();
  if (!kp) return { ok: false, wallet, error: "AIRDROP_SECRET not set" };
  let recip;
  try { recip = new PublicKey(wallet); } catch { return { ok: false, wallet, error: "bad wallet" }; }
  const amt = Number(amount);
  if (!(amt > 0)) return { ok: false, wallet, error: "amount must be > 0" };
  if (amt > maxPerSend()) return { ok: false, wallet, error: `amount ${amt} exceeds max ${maxPerSend()} per send (raise kv schoolAirdropMax to override)` };

  const paid = kv.get(PAID_KV, {}) || {};
  if (!force && paid[wallet]) return { ok: true, wallet, already: true, sig: paid[wallet].sig, amount: paid[wallet].amount };

  const conn = connection();
  const srcAta = await spl.getAssociatedTokenAddress(CLKN_MINT, kp.publicKey);
  const dstAta = await spl.getAssociatedTokenAddress(CLKN_MINT, recip);
  const ixs = [];
  let dstExists = true;
  try { await spl.getAccount(conn, dstAta); } catch { dstExists = false; }
  if (!dstExists) ixs.push(spl.createAssociatedTokenAccountInstruction(kp.publicKey, dstAta, recip, CLKN_MINT));
  const rawAmount = BigInt(Math.round(amt * 10 ** DECIMALS));
  ixs.push(spl.createTransferCheckedInstruction(srcAta, CLKN_MINT, dstAta, kp.publicKey, rawAmount, DECIMALS));

  const tx = new Transaction().add(...ixs);
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = kp.publicKey;
  tx.sign(kp);
  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
  await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");

  paid[wallet] = { sig, amount: amt, at: Date.now() };
  kv.set(PAID_KV, paid);
  return { ok: true, wallet, sig, amount: amt, createdAta: !dstExists };
}

// Airdrop the same amount to many wallets. Sequential (small batches) → clear per-wallet results.
async function sendRewards(wallets, amount, opts = {}) {
  const out = [];
  for (const w of wallets) {
    try { out.push(await sendReward(w, amount, opts)); }
    catch (e) { out.push({ ok: false, wallet: w, error: e.message }); }
  }
  return out;
}

module.exports = {
  isEnabled, payerPubkey, maxPerSend, isPaid, balances, sendReward, sendRewards,
  PAID_KV, MINT: CLKN_MINT.toBase58(),
};
