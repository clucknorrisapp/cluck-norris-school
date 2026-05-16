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
} = require("@solana/spl-token");
const { Uploader } = require("@irys/upload");
const { Solana } = require("@irys/upload-solana");

// Metaplex Token Metadata program — same on devnet and mainnet.
const TOKEN_METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
// Irys uploads at or under 100 KiB are free — keeping logos under this means
// every mint's metadata upload costs nothing.
const MAX_LOGO_BYTES = 100 * 1024;

// RPC endpoint per cluster. Mainnet uses the project's Helius key; devnet uses
// the public endpoint (only exercised by our own testing).
function rpcUrl(cluster) {
  if (cluster === "devnet") return "https://api.devnet.solana.com";
  const key = process.env.HELIUS_API_KEY;
  return key ? `https://mainnet.helius-rpc.com/?api-key=${key}` : "https://api.mainnet-beta.solana.com";
}

// ── Permanent metadata upload (via Irys) ─────────────────────────────────────
// Uploads the logo, then a Metaplex-standard metadata JSON pointing at it, to
// Irys permanent storage. Returns the metadata URI for the on-chain account.
// HATCHERY_TURBO_KEY is a base58 Solana secret key — the upload signer (the
// env var name is legacy). Uploads at/under 100 KiB are free.
async function uploadMetadata({ imageBuffer, imageMime, name, symbol, description }) {
  const key = process.env.HATCHERY_TURBO_KEY;
  if (!key) throw new Error("Metadata uploads are not configured (HATCHERY_TURBO_KEY missing)");
  const irys = await Uploader(Solana).withWallet(key);

  const imgRes = await irys.upload(imageBuffer, {
    tags: [{ name: "Content-Type", value: imageMime }],
  });
  const imageUri = `https://gateway.irys.xyz/${imgRes.id}`;

  const metadata = { name, symbol, description: description || "", image: imageUri };
  const metaRes = await irys.upload(JSON.stringify(metadata), {
    tags: [{ name: "Content-Type", value: "application/json" }],
  });
  return { metadataUri: `https://gateway.irys.xyz/${metaRes.id}`, imageUri };
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
  creator, cluster, rpcUrlOverride, decimals, supply, name, symbol, metadataUri, revokeMint, revokeFreeze,
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

  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  const tx = new Transaction();
  tx.feePayer = creatorPk;
  tx.recentBlockhash = blockhash;
  tx.add(...ixs);
  tx.partialSign(mintKp);   // mint keypair signs createAccount; the user signs the rest

  const txBase64 = tx
    .serialize({ requireAllSignatures: false, verifySignatures: false })
    .toString("base64");
  return { txBase64, mintAddress: mint.toBase58() };
}

// ── HTTP routes ──────────────────────────────────────────────────────────────
const router = express.Router();
router.use(express.json({ limit: "5mb" })); // a base64 logo exceeds express's default 100kb

// POST /api/hatchery/build — upload metadata + build the unsigned mint tx.
router.post("/build", async (req, res) => {
  try {
    const {
      creator, name, symbol, description, decimals, supply,
      imageBase64, imageMime, revokeMint, revokeFreeze, cluster,
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

    const { metadataUri, imageUri } = await uploadMetadata({ imageBuffer, imageMime, name, symbol, description });
    const { txBase64, mintAddress } = await buildMintTransaction({
      creator, cluster: useCluster, decimals: dec, supply: sup.toString(),
      name, symbol, metadataUri, revokeMint: !!revokeMint, revokeFreeze: !!revokeFreeze,
    });

    res.json({ txBase64, mintAddress, metadataUri, imageUri, cluster: useCluster });
  } catch (e) {
    console.error("[hatchery] build failed:", e);
    res.status(500).json({ error: e.message || "Mint build failed" });
  }
});

module.exports = { router, uploadMetadata, buildMintTransaction };
