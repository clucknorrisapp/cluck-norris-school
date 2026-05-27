// ── The Hatchery ─────────────────────────────────────────────────────────────
// Guided token CREATOR. Mints an SPL token — supply, metadata, optional
// authority revocation — and deliberately STOPS there. No liquidity, no pool:
// minting is not launching. See STRATEGY.md ("mint != launch").
//
// Architecture: the server uploads metadata to Arweave and builds the
// (mint-keypair-partially-signed) unsigned transaction. The user's wallet
// signs and submits it in the browser. Private keys never reach the server.
const express = require("express");
const {
  Connection, Keypair, PublicKey, Transaction, TransactionInstruction,
  SystemProgram,
} = require("@solana/web3.js");
const {
  MINT_SIZE, TOKEN_PROGRAM_ID, AuthorityType,
  createInitializeMint2Instruction, createMintToInstruction,
  createAssociatedTokenAccountInstruction, getAssociatedTokenAddressSync,
  createSetAuthorityInstruction, getMinimumBalanceForRentExemptMint,
  createTransferInstruction, createAssociatedTokenAccountIdempotentInstruction,
} = require("@solana/spl-token");
const { createData, SolanaSigner } = require("@dha-team/arbundles");

// Metaplex Token Metadata program — same on devnet and mainnet.
const TOKEN_METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
// Bundler uploads at or under 100 KiB are free — keeping logos under this
// means every mint's metadata upload costs nothing.
const MAX_LOGO_BYTES = 100 * 1024;
// ArDrive Turbo bundler endpoint — accepts a signed ANS-104 data item and
// settles it to Arweave proper (retrievable at arweave.net, many gateways).
const ARWEAVE_UPLOAD_URL = "https://upload.ardrive.io/tx";
// Flat-fee treasury — the project's CLKN-receive wallet (the same address the
// token-gated tools collect CLKN at). Any mint fee is sent here.
const HATCHERY_TREASURY = new PublicKey("7LHBcRYosycMBwBqxBHeRiDQohYzpppDALKYVT4TNY5H");
// Per-mint flat fee in lamports, from the HATCHERY_FEE_LAMPORTS env var. Unset
// or 0 means free (the current beta). 0.1 SOL = 100000000.
function hatcheryFeeLamports() {
  const n = parseInt(process.env.HATCHERY_FEE_LAMPORTS || "0", 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
// The fee can also be paid in CLKN, the project token (9 decimals).
const CLKN_MINT = new PublicKey("DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS");
const CLKN_DECIMALS = 9;
// HATCHERY_FEE_CLKN_SOL is the value, in SOL, the CLKN fee should be worth
// (e.g. 0.07). The CLKN token amount is computed live so it stays at that value.
function hatcheryFeeClknSol() {
  const n = parseFloat(process.env.HATCHERY_FEE_CLKN_SOL || "0");
  return Number.isFinite(n) && n > 0 ? n : 0;
}
// Wallets holding at least HATCHERY_FREE_HOLDER_CLKN whole CLKN mint for free.
// 0 (unset) disables the perk.
function hatcheryFreeHolderClkn() {
  const n = parseInt(process.env.HATCHERY_FREE_HOLDER_CLKN || "0", 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// ── CLKN price (drives the dynamic CLKN fee) ─────────────────────────────────
// The CLKN/SOL pool on GeckoTerminal reports CLKN's price in SOL directly.
// Cached 10 minutes; if a refresh fails the last good value is reused.
const CLKN_POOL = "64WXkHM4zyWUkYy32TfUeBV5wDAfdcUGDxe5ntM4xaTd";
let clknPriceCache = { solPerClkn: 0, ts: 0 };
async function clknPriceInSol() {
  if (clknPriceCache.solPerClkn && Date.now() - clknPriceCache.ts < 10 * 60 * 1000) {
    return clknPriceCache.solPerClkn;
  }
  try {
    const res = await fetch(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${CLKN_POOL}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json();
    const a = d?.data?.attributes || {};
    const baseId = d?.data?.relationships?.base_token?.data?.id || "";
    // "native currency" on Solana is SOL — pick whichever side of the pool is CLKN.
    const price = parseFloat(baseId.includes(CLKN_MINT.toBase58())
      ? a.base_token_price_native_currency : a.quote_token_price_native_currency);
    if (!Number.isFinite(price) || price <= 0) throw new Error("no usable price");
    clknPriceCache = { solPerClkn: price, ts: Date.now() };
    return price;
  } catch (e) {
    console.warn("[hatchery] CLKN price lookup failed:", e.message);
    return clknPriceCache.solPerClkn || 0;   // stale fallback; 0 if never fetched
  }
}
// The CLKN fee as a whole-token amount worth ~HATCHERY_FEE_CLKN_SOL of SOL,
// rounded to 3 significant figures for a tidy number. 0 means unavailable.
async function clknFeeWhole() {
  const targetSol = hatcheryFeeClknSol();
  if (targetSol <= 0) return 0;
  const solPerClkn = await clknPriceInSol();
  if (!solPerClkn) return 0;
  const raw = targetSol / solPerClkn;
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)) - 2);
  return Math.max(1, Math.round(raw / mag) * mag);
}
// Total CLKN a wallet holds, in raw units, summed across its token accounts.
async function clknBalanceRaw(conn, ownerPk) {
  const r = await conn.getParsedTokenAccountsByOwner(ownerPk, { mint: CLKN_MINT });
  let total = 0n;
  for (const { account } of r.value) {
    total += BigInt(account.data.parsed.info.tokenAmount.amount || "0");
  }
  return total;
}

// RPC endpoint per cluster. Mainnet uses the project's Helius key; devnet uses
// the public endpoint (only exercised by our own testing).
function rpcUrl(cluster) {
  if (cluster === "devnet") return "https://api.devnet.solana.com";
  const key = process.env.HELIUS_API_KEY;
  return key ? `https://mainnet.helius-rpc.com/?api-key=${key}` : "https://api.mainnet-beta.solana.com";
}

// Upload one item to Arweave: build a signed ANS-104 data item and POST it to
// the Turbo bundler, which settles it to Arweave proper. Returns the permanent
// arweave.net URL. Items <=100 KiB upload free.
async function arweaveUpload(signer, data, contentType) {
  const item = createData(data, signer, { tags: [{ name: "Content-Type", value: contentType }] });
  await item.sign(signer);
  const res = await fetch(ARWEAVE_UPLOAD_URL, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: await item.getRaw(),
  });
  if (!res.ok) throw new Error(`Arweave upload failed (HTTP ${res.status})`);
  const body = await res.json().catch(() => ({}));
  if (!body.id) throw new Error("Arweave upload returned no transaction id");
  return `https://arweave.net/${body.id}`;
}

// ── Permanent metadata upload (Arweave) ──────────────────────────────────────
// Uploads the logo, then a Metaplex-standard metadata JSON pointing at it, to
// Arweave permanent storage. Returns the metadata URI for the on-chain account.
// HATCHERY_TURBO_KEY is a base58 Solana secret key — the data-item signer (the
// env var name is legacy).
async function uploadMetadata({ imageBuffer, imageMime, name, symbol, description }) {
  const key = process.env.HATCHERY_TURBO_KEY;
  if (!key) throw new Error("Metadata uploads are not configured (HATCHERY_TURBO_KEY missing)");
  const signer = new SolanaSigner(key);

  const imageUri = await arweaveUpload(signer, imageBuffer, imageMime);
  const metadata = { name, symbol, description: description || "", image: imageUri };
  const metadataUri = await arweaveUpload(
    signer, Buffer.from(JSON.stringify(metadata)), "application/json",
  );
  return { metadataUri, imageUri };
}

// ── Metaplex CreateMetadataAccountV3 instruction (hand-built) ────────────────
// The Metaplex JS SDK is ESM-only and fights this CommonJS server, so the one
// instruction we need is constructed directly — same approach the Airdrop tool
// uses for its token instructions.
function borshString(s) {
  const body = Buffer.from(String(s), "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32LE(body.length, 0);
  return Buffer.concat([len, body]);
}
function metadataPda(mint) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), TOKEN_METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    TOKEN_METADATA_PROGRAM_ID,
  )[0];
}
function createMetadataV3Ix({ mint, authority, name, symbol, uri }) {
  const data = Buffer.concat([
    Buffer.from([33]),   // CreateMetadataAccountV3 discriminator
    borshString(name),
    borshString(symbol),
    borshString(uri),
    Buffer.alloc(2),     // sellerFeeBasisPoints: u16 = 0
    Buffer.from([0]),    // creators:  None
    Buffer.from([0]),    // collection: None
    Buffer.from([0]),    // uses:       None
    Buffer.from([1]),    // isMutable:  true (update authority can fix metadata later)
    Buffer.from([0]),    // collectionDetails: None
  ]);
  return new TransactionInstruction({
    programId: TOKEN_METADATA_PROGRAM_ID,
    keys: [
      { pubkey: metadataPda(mint),       isSigner: false, isWritable: true  },
      { pubkey: mint,                    isSigner: false, isWritable: false },
      { pubkey: authority,               isSigner: true,  isWritable: false }, // mint authority
      { pubkey: authority,               isSigner: true,  isWritable: true  }, // payer
      { pubkey: authority,               isSigner: false, isWritable: false }, // update authority
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

// ── Build the unsigned mint transaction ──────────────────────────────────────
// One transaction: create + initialize the mint, create the creator's token
// account, mint the full supply, attach metadata, and optionally revoke the
// mint authority. The freeze authority is set (or omitted) at initialization.
async function buildMintTransaction({
  creator, cluster, rpcUrlOverride, decimals, supply, name, symbol, metadataUri,
  revokeMint, revokeFreeze, payWith,
}) {
  // rpcUrlOverride lets tests point at a local validator; production passes only cluster.
  const conn = new Connection(rpcUrlOverride || rpcUrl(cluster), "confirmed");
  const creatorPk = new PublicKey(creator);
  const mintKp = Keypair.generate();
  const mint = mintKp.publicKey;

  const rent = await getMinimumBalanceForRentExemptMint(conn);
  const ata = getAssociatedTokenAddressSync(mint, creatorPk);
  const rawSupply = BigInt(supply) * (10n ** BigInt(decimals));

  const ixs = [
    SystemProgram.createAccount({
      fromPubkey: creatorPk, newAccountPubkey: mint,
      space: MINT_SIZE, lamports: rent, programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMint2Instruction(
      mint, decimals, creatorPk,
      revokeFreeze ? null : creatorPk,   // freeze authority — null means none ever
      TOKEN_PROGRAM_ID,
    ),
    createAssociatedTokenAccountInstruction(creatorPk, ata, creatorPk, mint),
    createMintToInstruction(mint, ata, creatorPk, rawSupply),
    createMetadataV3Ix({ mint, authority: creatorPk, name, symbol, uri: metadataUri }),
  ];
  // Revoke the mint authority AFTER minting the supply — once gone, supply is fixed.
  if (revokeMint) {
    ixs.push(createSetAuthorityInstruction(mint, creatorPk, AuthorityType.MintTokens, null));
  }
  // ── Mint fee ──
  // Wallets holding enough CLKN mint for free. Otherwise the fee is paid in SOL
  // or CLKN, collected into the treasury inside this same transaction.
  const freeThreshold = hatcheryFreeHolderClkn();   // whole CLKN; 0 = perk off
  const wantsClkn = payWith === "clkn";
  let creatorClkn = null;
  if (freeThreshold > 0 || wantsClkn) {
    // An RPC failure leaves this null → no waiver granted, fee still charged.
    try { creatorClkn = await clknBalanceRaw(conn, creatorPk); } catch { creatorClkn = null; }
  }
  const waived = freeThreshold > 0 && creatorClkn !== null
    && creatorClkn >= BigInt(freeThreshold) * (10n ** BigInt(CLKN_DECIMALS));

  if (!waived && wantsClkn) {
    const feeClkn = await clknFeeWhole();
    if (!feeClkn) throw new Error("CLKN pricing is temporarily unavailable — please pay the fee in SOL.");
    const need = BigInt(feeClkn) * (10n ** BigInt(CLKN_DECIMALS));
    if (creatorClkn === null || creatorClkn < need) {
      throw new Error(`Paying with CLKN needs about ${feeClkn.toLocaleString()} CLKN in your wallet — you don't have enough. Pay with SOL instead, or get CLKN first.`);
    }
    const fromAta = getAssociatedTokenAddressSync(CLKN_MINT, creatorPk);
    const toAta = getAssociatedTokenAddressSync(CLKN_MINT, HATCHERY_TREASURY);
    // Idempotent: creates the treasury's CLKN account only if it doesn't exist.
    ixs.push(createAssociatedTokenAccountIdempotentInstruction(creatorPk, toAta, HATCHERY_TREASURY, CLKN_MINT));
    ixs.push(createTransferInstruction(fromAta, toAta, creatorPk, need));
  } else if (!waived) {
    const feeLamports = hatcheryFeeLamports();
    if (feeLamports > 0) {
      ixs.push(SystemProgram.transfer({ fromPubkey: creatorPk, toPubkey: HATCHERY_TREASURY, lamports: feeLamports }));
    }
  }

  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  const tx = new Transaction();
  tx.feePayer = creatorPk;
  tx.recentBlockhash = blockhash;
  tx.add(...ixs);
  // The mint keypair does NOT sign here. Phantom's Lighthouse flags a multi-signer
  // transaction that already carries a signature when it reaches the wallet — the
  // wallet has to sign FIRST. The client signs with the wallet, then partial-signs
  // with this mint keypair (its secret is returned below). Per Phantom support.
  const txBase64 = tx
    .serialize({ requireAllSignatures: false, verifySignatures: false })
    .toString("base64");
  return {
    txBase64,
    mintAddress: mint.toBase58(),
    mintSecret: Buffer.from(mintKp.secretKey).toString("base64"),
  };
}

// ── Telegram hatch announcement ──────────────────────────────────────────────
function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
// Post a successful-hatch announcement to the project's Telegram room — same
// bot and chat as the buy/sell alerts. Best-effort; never throws.
async function announceHatch(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
  } catch (e) {
    console.warn("[hatchery] Telegram announce failed:", e.message);
  }
}
// Mints the Hatchery has built this run. The /minted announcement is only
// honoured for these, so the endpoint can't be used to spam the room.
const hatcheryMints = new Set();
const announcedMints = new Set();

// ── HTTP routes ──────────────────────────────────────────────────────────────
const router = express.Router();
router.use(express.json({ limit: "5mb" })); // a base64 logo exceeds express's default 100kb

// GET /api/hatchery/config — current fee setup, so the page renders the right
// fee UI without hardcoding amounts. Pass ?wallet=<addr> to also learn whether
// that wallet holds enough CLKN to mint for free.
router.get("/config", async (req, res) => {
  try {
    const feeLamports = hatcheryFeeLamports();
    const feeSol = feeLamports / 1e9;
    const feeClknSol = hatcheryFeeClknSol();
    const feeClkn = await clknFeeWhole();
    const holderThreshold = hatcheryFreeHolderClkn();
    // Percent saved by paying in CLKN instead of SOL (e.g. 0.1 → 0.07 = 30%).
    const clknSavingPct = (feeSol > 0 && feeClknSol > 0 && feeClknSol < feeSol)
      ? Math.round((1 - feeClknSol / feeSol) * 100) : 0;
    const out = {
      feeSol, feeClkn, feeClknSol, clknSavingPct, holderThreshold,
      solEnabled: feeLamports > 0,
      clknEnabled: feeClkn > 0,
      feeWaived: false,
    };
    const wallet = req.query.wallet;
    if (wallet && holderThreshold > 0) {
      try {
        const conn = new Connection(rpcUrl("mainnet-beta"), "confirmed");
        const bal = await clknBalanceRaw(conn, new PublicKey(wallet));
        out.feeWaived = bal >= BigInt(holderThreshold) * (10n ** BigInt(CLKN_DECIMALS));
      } catch { /* leave feeWaived false */ }
    }
    res.json(out);
  } catch (e) {
    res.json({ solEnabled: false, clknEnabled: false });
  }
});

// POST /api/hatchery/build — upload metadata + build the unsigned mint tx.
router.post("/build", async (req, res) => {
  try {
    const {
      creator, name, symbol, description, decimals, supply,
      imageBase64, imageMime, revokeMint, revokeFreeze, cluster, payWith,
    } = req.body || {};

    if (!creator) return res.status(400).json({ error: "Missing creator wallet address" });
    try { new PublicKey(creator); } catch { return res.status(400).json({ error: "Invalid creator wallet address" }); }
    if (!name || name.length > 32) return res.status(400).json({ error: "Token name is required (max 32 characters)" });
    if (!symbol || symbol.length > 10) return res.status(400).json({ error: "Token symbol is required (max 10 characters)" });
    const dec = Number(decimals);
    if (!Number.isInteger(dec) || dec < 0 || dec > 9) return res.status(400).json({ error: "Decimals must be a whole number from 0 to 9" });
    let sup;
    try { sup = BigInt(supply); } catch { return res.status(400).json({ error: "Supply must be a whole number" }); }
    if (sup <= 0n) return res.status(400).json({ error: "Supply must be greater than 0" });
    if (!imageBase64 || !imageMime) return res.status(400).json({ error: "A logo image is required" });

    const imageBuffer = Buffer.from(imageBase64, "base64");
    if (imageBuffer.length === 0) return res.status(400).json({ error: "The logo image could not be read" });
    if (imageBuffer.length > MAX_LOGO_BYTES) {
      return res.status(400).json({
        error: `Logo must be ${MAX_LOGO_BYTES / 1024} KB or smaller (keeps the upload free) — yours is ${(imageBuffer.length / 1024).toFixed(0)} KB.`,
      });
    }
    const useCluster = cluster === "devnet" ? "devnet" : "mainnet-beta";

    // Bound the description — it's uploaded to Arweave on the project's Turbo
    // key, so an unbounded field is a credit-drain vector.
    const desc = String(description || "").slice(0, 1000);
    const { metadataUri, imageUri } = await uploadMetadata({ imageBuffer, imageMime, name, symbol, description: desc });
    const { txBase64, mintAddress, mintSecret } = await buildMintTransaction({
      creator, cluster: useCluster, decimals: dec, supply: sup.toString(),
      name, symbol, metadataUri, revokeMint: !!revokeMint, revokeFreeze: !!revokeFreeze,
      payWith: payWith === "clkn" ? "clkn" : "sol",
    });

    // Remember this mint so a later /minted report can be trusted + announced.
    hatcheryMints.add(mintAddress);
    if (hatcheryMints.size > 5000) hatcheryMints.delete(hatcheryMints.values().next().value);

    res.json({ txBase64, mintAddress, mintSecret, metadataUri, imageUri, cluster: useCluster });
  } catch (e) {
    console.error("[hatchery] build failed:", e);
    res.status(500).json({ error: e.message || "Mint build failed" });
  }
});

// POST /api/hatchery/minted — the browser reports a confirmed mint. If it's a
// mint the Hatchery actually built and the transaction is real, announce it to
// the Telegram room. Best-effort: anything failing here never affects the user.
router.post("/minted", async (req, res) => {
  try {
    const { signature, mintAddress, name, symbol } = req.body || {};
    if (!signature || !mintAddress) return res.json({ ok: false });
    // Only announce mints the Hatchery built, and only once each.
    if (!hatcheryMints.has(mintAddress) || announcedMints.has(mintAddress)) return res.json({ ok: false });

    // Confirm the transaction is real and succeeded before announcing.
    const conn = new Connection(rpcUrl("mainnet-beta"), "confirmed");
    const tx = await conn.getTransaction(signature, { maxSupportedTransactionVersion: 0 });
    if (!tx || (tx.meta && tx.meta.err)) return res.json({ ok: false });

    announcedMints.add(mintAddress);
    const short = `${mintAddress.slice(0, 4)}…${mintAddress.slice(-4)}`;
    const nm = escapeHtml(String(name || "A new token").slice(0, 48));
    const sym = escapeHtml(String(symbol || "").slice(0, 16));
    await announceHatch(
      "🥚 <b>NEW TOKEN HATCHED</b>\n" +
      `<b>${nm}</b>${sym ? ` ($${sym})` : ""} was just created with The Hatchery.\n` +
      `Mint: <code>${short}</code>\n` +
      `<a href="https://solscan.io/token/${mintAddress}">↗ View on Solscan</a>\n` +
      "🐔 <a href=\"https://clucknorris.app/hatchery\">Hatch your own at clucknorris.app/hatchery</a>"
    );
    res.json({ ok: true });
  } catch (e) {
    console.error("[hatchery] minted announce failed:", e);
    res.json({ ok: false });
  }
});

module.exports = { router, uploadMetadata, buildMintTransaction };
