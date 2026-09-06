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
// Operator wallets that ALWAYS mint for free, whatever their CLKN balance — the CLKN
// treasury and the Hatchery fee wallet (a fee paid from either to itself is a no-op anyway).
const HATCHERY_FREE_WALLETS = new Set([
  "2zMCUkE9pBjcC7ihtLqm28EsCoEHVmCdJYr5262EuPy8", // CLKN treasury / operator
  "7LHBcRYosycMBwBqxBHeRiDQohYzpppDALKYVT4TNY5H", // Hatchery fee treasury
]);
function isHatcheryFreeWallet(pk) {
  try { return HATCHERY_FREE_WALLETS.has(pk && pk.toBase58 ? pk.toBase58() : String(pk)); }
  catch { return false; }
}
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
// Default 100,000 (owner, 2026-08-13). NOTE: the Railway env var OVERRIDES this default, and
// the number actually live at any given time is whatever Railway has it set to — check
// `/api/hatchery/config` for the live figure, never assume a value here or quote one in docs
// (README/investors have gone stale against the live env before). Set the env to 0 to turn
// the perk off.
function hatcheryFreeHolderClkn() {
  const raw = process.env.HATCHERY_FREE_HOLDER_CLKN;
  if (raw === "0") return 0;                       // explicit off
  const n = parseInt(raw || "100000", 10);
  return Number.isFinite(n) && n > 0 ? n : 100000;
}

// ── CLKN price (drives the dynamic CLKN fee) ─────────────────────────────────
// CLKN's price in SOL, from TWO independent indexers so a single hiccup can't blank out
// CLKN pricing in the Hatchery. Cached 10 min; on total failure the last good value is
// reused at ANY age. The single-source version failed exactly like this: Railway redeploys
// on every push (resetting the in-process cache to cold), and if the first price fetch after
// a deploy hit a GeckoTerminal rate-limit, feeClkn went to 0 and the page showed
// "CLKN pricing not available" until GT recovered.
const CLKN_POOL = "64WXkHM4zyWUkYy32TfUeBV5wDAfdcUGDxe5ntM4xaTd";
const SOL_MINT_B58 = "So11111111111111111111111111111111111111112";
let clknPriceCache = { solPerClkn: 0, ts: 0 };
// Source 1 — GeckoTerminal's CLKN/SOL pool reports CLKN's price in SOL directly.
async function clknPriceFromGT() {
  const res = await fetch(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${CLKN_POOL}`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`GT HTTP ${res.status}`);
  const d = await res.json();
  const a = d?.data?.attributes || {};
  const baseId = d?.data?.relationships?.base_token?.data?.id || "";
  // "native currency" on Solana is SOL — pick whichever side of the pool is CLKN.
  const price = parseFloat(baseId.includes(CLKN_MINT.toBase58())
    ? a.base_token_price_native_currency : a.quote_token_price_native_currency);
  if (!Number.isFinite(price) || price <= 0) throw new Error("GT: no usable price");
  return price;
}
// Source 2 — DexScreener's deepest CLKN/SOL pair; priceNative IS CLKN's price in SOL.
async function clknPriceFromDexScreener() {
  const res = await fetch(`https://api.dexscreener.com/token-pairs/v1/solana/${CLKN_MINT.toBase58()}`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`DS HTTP ${res.status}`);
  const arr = await res.json();
  const pairs = (Array.isArray(arr) ? arr : []).filter((p) =>
    p?.baseToken?.address === CLKN_MINT.toBase58() &&
    p?.quoteToken?.address === SOL_MINT_B58 &&
    parseFloat(p.priceNative) > 0);
  pairs.sort((x, y) => ((y.liquidity && y.liquidity.usd) || 0) - ((x.liquidity && x.liquidity.usd) || 0));
  const price = parseFloat(pairs[0] && pairs[0].priceNative);
  if (!Number.isFinite(price) || price <= 0) throw new Error("DS: no CLKN/SOL pair");
  return price;
}
async function clknPriceInSol() {
  if (clknPriceCache.solPerClkn && Date.now() - clknPriceCache.ts < 10 * 60 * 1000) {
    return clknPriceCache.solPerClkn;
  }
  for (const src of [clknPriceFromGT, clknPriceFromDexScreener]) {
    try {
      const price = await src();
      if (Number.isFinite(price) && price > 0) {
        clknPriceCache = { solPerClkn: price, ts: Date.now() };
        return price;
      }
    } catch (e) {
      console.warn("[hatchery] CLKN price source failed:", e.message);
    }
  }
  return clknPriceCache.solPerClkn || 0;   // last good value at any age; 0 only if never once fetched
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

// Upload an arbitrary metadata JSON to Arweave and return its permanent URI.
//
// Split out for /api/token-metadata/prepare-lock: making a token's metadata immutable freezes its
// URI forever, and a great many tokens were minted pointing at https://ipfs.io/ipfs/… — a gateway
// now being retired. Repointing at Arweave in the SAME transaction as the lock is the difference
// between "immutable" and "immutably broken". Same free Turbo path uploadMetadata already uses;
// a metadata JSON is ~1 KB, far under the 100 KiB free ceiling.
// Mirror arbitrary bytes (an image) to Arweave. Separate from uploadJsonToArweave because the
// size story differs: a metadata JSON is ~1 KB and always free, whereas a real logo can exceed
// Turbo's 100 KiB free ceiling and then needs a funded account. The caller is expected to CATCH
// the failure and fall back rather than treat it as fatal — see /api/token-metadata/rebuild-json.
async function uploadBytesToArweave(bytes, contentType) {
  const key = process.env.HATCHERY_TURBO_KEY;
  if (!key) throw new Error("Arweave uploads are not configured (HATCHERY_TURBO_KEY missing)");
  if (!Buffer.isBuffer(bytes) || !bytes.length) throw new Error("no bytes to upload");
  return arweaveUpload(new SolanaSigner(key), bytes, String(contentType || "application/octet-stream"));
}

async function uploadJsonToArweave(obj) {
  const key = process.env.HATCHERY_TURBO_KEY;
  if (!key) throw new Error("Arweave uploads are not configured (HATCHERY_TURBO_KEY missing)");
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) throw new Error("metadata must be a JSON object");
  const body = Buffer.from(JSON.stringify(obj));
  if (body.length > 100 * 1024) throw new Error("metadata JSON exceeds the 100 KiB free upload limit");
  return arweaveUpload(new SolanaSigner(key), body, "application/json");
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
  const freeWallet = isHatcheryFreeWallet(creatorPk);   // treasury/operator always mints free
  let creatorClkn = null;
  if (!freeWallet && (freeThreshold > 0 || wantsClkn)) {
    // An RPC failure leaves this null → no waiver granted, fee still charged.
    try { creatorClkn = await clknBalanceRaw(conn, creatorPk); } catch { creatorClkn = null; }
  }
  const waived = freeWallet || (freeThreshold > 0 && creatorClkn !== null
    && creatorClkn >= BigInt(freeThreshold) * (10n ** BigInt(CLKN_DECIMALS)));

  if (!waived && wantsClkn) {
    const feeClkn = await clknFeeWhole();
    if (!feeClkn) throw new Error("CLKN pricing is temporarily unavailable — please pay the fee in SOL.");
    const need = BigInt(feeClkn) * (10n ** BigInt(CLKN_DECIMALS));
    const ata = getAssociatedTokenAddressSync(CLKN_MINT, creatorPk);
    const toAta = getAssociatedTokenAddressSync(CLKN_MINT, HATCHERY_TREASURY);
    // Pick the SOURCE account for the fee. The transfer pulls from ONE token account, but a wallet
    // can hold CLKN across several (the ATA plus others — e.g. a CEX withdrawal that opened its own
    // account). The summed balance can be >= the fee while no single account is, which used to build
    // a tx that failed on-chain at this transfer ("custom program error 0x1" = InsufficientFunds) —
    // and Phantom then blocked the failing tx as "this dApp could be malicious." Prefer the ATA;
    // otherwise the richest single account that can cover it. Require ONE account to hold the fee.
    let accs = null;
    try {
      const r = await conn.getParsedTokenAccountsByOwner(creatorPk, { mint: CLKN_MINT });
      accs = r.value.map((v) => ({ pubkey: v.pubkey, amount: BigInt(v.account.data.parsed.info.tokenAmount.amount || "0") }));
    } catch { accs = null; }
    let source;
    if (accs) {
      accs.sort((a, b) => (a.amount < b.amount ? 1 : a.amount > b.amount ? -1 : 0));
      const pick = accs.find((a) => a.pubkey.equals(ata) && a.amount >= need) || accs.find((a) => a.amount >= need);
      if (!pick) {
        const total = accs.reduce((s, a) => s + a.amount, 0n);
        const whole = Number(total / (10n ** BigInt(CLKN_DECIMALS))).toLocaleString();
        if (total < need) {
          throw new Error(`Paying with CLKN needs about ${feeClkn.toLocaleString()} CLKN, but your wallet holds ${whole}. Get more CLKN, or pay the fee in SOL.`);
        }
        throw new Error(`You hold enough CLKN (${whole}), but it's split across ${accs.length} accounts — the fee has to come from one. Consolidate your CLKN into a single account, or pay the fee in SOL.`);
      }
      source = pick.pubkey;
    } else {
      // balance read failed → fall back to the ATA + the summed pre-check (fail OPEN, don't block a
      // funded mint on a flaky RPC read).
      if (creatorClkn !== null && creatorClkn < need) {
        throw new Error(`Paying with CLKN needs about ${feeClkn.toLocaleString()} CLKN in your wallet — you don't have enough. Pay with SOL instead, or get CLKN first.`);
      }
      source = ata;
    }
    // Idempotent: creates the treasury's CLKN account only if it doesn't exist.
    ixs.push(createAssociatedTokenAccountIdempotentInstruction(creatorPk, toAta, HATCHERY_TREASURY, CLKN_MINT));
    ixs.push(createTransferInstruction(source, toAta, creatorPk, need));
  } else if (!waived) {
    const feeLamports = hatcheryFeeLamports();
    if (feeLamports > 0) {
      ixs.push(SystemProgram.transfer({ fromPubkey: creatorPk, toPubkey: HATCHERY_TREASURY, lamports: feeLamports }));
    }
  }

  // ── SOL preflight ──
  // Every mint spends ~0.01 SOL of NON-refundable-at-mint-time rent (new mint account, the
  // creator's token account, the metadata account) plus network fees, BEFORE the fee transfer
  // runs. An underfunded wallet therefore fails deep in the transaction — at the fee instruction —
  // with "custom program error 0x1" (System ResultWithNegativeLamports / SPL-Token InsufficientFunds),
  // an opaque error that Phantom then blocks as "this dApp could be malicious." Check up front and
  // return a plain-English shortfall instead. Fail OPEN on a flaky balance read — never block a
  // funded mint over an RPC hiccup.
  const RENT_NETWORK_BUFFER = 12_000_000; // ~0.012 SOL: mint + ATA + metadata rent + network fees
  let solNeeded = RENT_NETWORK_BUFFER;
  if (!waived && !wantsClkn) solNeeded += hatcheryFeeLamports();
  let payerLamports = null;
  try { payerLamports = await conn.getBalance(creatorPk, "confirmed"); } catch { payerLamports = null; }
  if (payerLamports !== null && payerLamports < solNeeded) {
    const needSol = (solNeeded / 1e9).toFixed(3);
    const haveSol = (payerLamports / 1e9).toFixed(3);
    throw new Error(
      `Not enough SOL to mint: this needs about ${needSol} SOL (${wantsClkn ? "on-chain rent + network fees; the fee itself is paid in CLKN" : "the 0.1 SOL fee plus ~0.01 SOL of on-chain rent + network fees"}), but your wallet has ${haveSol} SOL. Top up a little SOL and try again${wantsClkn ? "." : ", or switch the fee to CLKN (which only needs ~0.01 SOL for rent)."}`
    );
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
// Telegram parse_mode:"HTML" sink: escape ONLY & < > (what Telegram requires and decodes).
// Do NOT add &quot;/&#39; here — Telegram renders the numeric apostrophe entity literally,
// so a name like "Bob's Coin" would post as "Bob&#39;s Coin".
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
// Mints the Hatchery has built. The /minted announcement is only honoured for
// these, so the endpoint can't be used to spam the room. Persisted to the /data
// volume: main auto-deploys frequently, and an in-memory-only set would (a) lose
// a legit /minted whose /build happened before a redeploy and (b) let an
// already-announced mint be re-announced (room spam) after a redeploy.
const kv = require("./lib/kvstore");
const HATCHERY_KV = "hatchery_mints_v1";
const hatcheryMints = new Set();
// mintAddress -> the name/symbol the Hatchery actually built it with (see /minted).
const hatcheryMeta = new Map();
const announcedMints = new Set();
(function loadHatcheryState() {
  try {
    const s = kv.get(HATCHERY_KV, null);
    if (s) { for (const m of (s.built || [])) hatcheryMints.add(m); for (const m of (s.announced || [])) announcedMints.add(m); }
  } catch (_) {}
})();
function saveHatcheryState() {
  try { kv.set(HATCHERY_KV, { built: [...hatcheryMints], announced: [...announcedMints] }); } catch (_) {}
}

// Mint transactions built and awaiting the wallet's signature. The mint keypair is a
// REQUIRED signer (SystemProgram.createAccount), and we deliberately keep it SERVER-SIDE:
// the browser signs the unsigned, fee-inclusive tx and posts it to /submit, and the server
// co-signs with the mint key ONLY after confirming the returned tx is byte-for-byte the one
// it built — so the fee instruction can't be stripped and the mint completed for free.
// In-memory + short TTL, and NEVER persisted: it holds a private key.
const pendingMints = new Map();   // mintAddress -> { mintSecret(b64), builtTxB64, cluster, ts }
const PENDING_TTL_MS = 10 * 60 * 1000;
const PENDING_MAX = 500;
function reapPending() {
  const now = Date.now();
  for (const [k, v] of pendingMints) if (now - v.ts > PENDING_TTL_MS) pendingMints.delete(k);
  while (pendingMints.size > PENDING_MAX) pendingMints.delete(pendingMints.keys().next().value);
}

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
    if (wallet) {
      try {
        const pk = new PublicKey(wallet);
        if (isHatcheryFreeWallet(pk)) {
          out.feeWaived = true;                      // treasury/operator — always free
        } else if (holderThreshold > 0) {
          const conn = new Connection(rpcUrl("mainnet-beta"), "confirmed");
          const bal = await clknBalanceRaw(conn, pk);
          out.feeWaived = bal >= BigInt(holderThreshold) * (10n ** BigInt(CLKN_DECIMALS));
        }
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

    // Keep the mint secret SERVER-SIDE (never sent to the browser) so the fee can't be
    // stripped: /submit co-signs with it only after verifying the wallet signed the exact
    // fee-inclusive tx we built here.
    reapPending();
    pendingMints.set(mintAddress, { mintSecret, builtTxB64: txBase64, cluster: useCluster, ts: Date.now() });

    // Remember this mint so a later /minted report can be trusted + announced — and remember the
    // name/symbol WE built it with, because /minted must not take them from the request body.
    hatcheryMints.add(mintAddress);
    hatcheryMeta.set(mintAddress, { name: String(name || "").slice(0, 48), symbol: String(symbol || "").slice(0, 16) });
    if (hatcheryMeta.size > 5000) hatcheryMeta.delete(hatcheryMeta.keys().next().value);
    if (hatcheryMints.size > 5000) hatcheryMints.delete(hatcheryMints.values().next().value);
    saveHatcheryState();

    res.json({ txBase64, mintAddress, metadataUri, imageUri, cluster: useCluster });
  } catch (e) {
    console.error("[hatchery] build failed:", e);
    res.status(500).json({ error: e.message || "Mint build failed" });
  }
});

// Compare a client-signed tx against the tx we built, tolerating ONLY wallet-injected
// ComputeBudget instructions (priority fee / CU limit). Those move no funds and modern wallets
// (Phantom) add them at sign time — a strict whole-message compare wrongly rejected them as
// tampering and broke minting outright. Every NON-ComputeBudget instruction we built — mint init,
// ATA, metadata, and crucially the fee transfer — must still be present, in order, byte-for-byte,
// so the fee can't be stripped before we co-sign with the mint key.
// Last time a wallet modified a mint tx vs what we built — programIds only (no secrets),
// exposed at GET /api/hatchery/_diag for diagnosing wallet quirks. Reset on process restart.
let lastHatcheryDiff = null;
const COMPUTE_BUDGET_PROGRAM = "ComputeBudget111111111111111111111111111111";
function coreInstructions(tx) {
  return (tx.instructions || []).filter((ix) => ix.programId.toBase58() !== COMPUTE_BUDGET_PROGRAM);
}
function ixEqual(a, b) {
  if (a.programId.toBase58() !== b.programId.toBase58()) return false;
  const ka = a.keys || [], kb = b.keys || [];
  if (ka.length !== kb.length) return false;
  for (let i = 0; i < ka.length; i++) {
    if (ka[i].pubkey.toBase58() !== kb[i].pubkey.toBase58()) return false;
    if (!!ka[i].isSigner !== !!kb[i].isSigner) return false;
    if (!!ka[i].isWritable !== !!kb[i].isWritable) return false;
  }
  return Buffer.compare(Buffer.from(a.data || []), Buffer.from(b.data || [])) === 0;
}
// True if every instruction we built survives — unchanged and in order — as a SUBSEQUENCE of the
// client's signed tx. Modern wallets bracket the tx with their own instructions: Phantom wraps it
// in Lighthouse assertion guards (program L2TEx…) plus ComputeBudget priority-fee ixs. A strict
// same-length compare rejected all of that and broke minting. A subsequence check lets the wallet
// inject whatever it wants around ours, while guaranteeing OUR instructions — including the fee
// transfer — can't be dropped, reordered, or altered. This stays fee-safe even against arbitrary
// injected instructions: a tx executes all-or-nothing (so if it lands with our fee transfer in it,
// the fee was paid), the treasury never signs this tx (so nothing can move funds out of it), and
// the only key we co-sign with is the ephemeral mint account, which holds nothing.
function builtIxsPreserved(builtTx, clientTx) {
  const built = coreInstructions(builtTx);
  const client = clientTx.instructions || [];
  let ci = 0;
  for (const bx of built) {
    let found = false;
    while (ci < client.length) {
      const match = ixEqual(bx, client[ci]);
      ci++;
      if (match) { found = true; break; }
    }
    if (!found) return false;
  }
  return true;
}

// POST /api/hatchery/submit — the browser returns the WALLET-signed (but not
// mint-signed) transaction. We verify its core instructions match the fee-inclusive tx we
// built at /build (allowing wallet-added ComputeBudget priority-fee ixs), then co-sign with the
// server-held mint key and submit. This is what makes the fee enforceable: the mint account is a
// required signer, we hold its key, and we only add our signature to a tx that still carries the fee.
router.post("/submit", async (req, res) => {
  try {
    const { mintAddress, signedTxBase64 } = req.body || {};
    if (!mintAddress || !signedTxBase64) return res.status(400).json({ error: "Missing mint address or signed transaction" });
    reapPending();
    const pending = pendingMints.get(String(mintAddress));
    if (!pending) return res.status(410).json({ error: "This mint request expired or was already submitted — build it again." });

    // Parse the client's signed tx.
    let clientTx;
    try { clientTx = Transaction.from(Buffer.from(String(signedTxBase64), "base64")); }
    catch { return res.status(400).json({ error: "Could not read the signed transaction" }); }

    // The tamper-check exists ONLY to protect the fee. A fee-inclusive built tx has an
    // instruction that touches the Hatchery treasury; a WAIVED mint (treasury/holder) has none,
    // so there's nothing to strip and nothing to protect — co-sign whatever the wallet signed.
    const builtTx = Transaction.from(Buffer.from(pending.builtTxB64, "base64"));
    const builtCore = coreInstructions(builtTx), clientCore = coreInstructions(clientTx);
    const feeAtRisk = builtCore.some((ix) => (ix.keys || []).some((k) => {
      try { return k.pubkey.equals(HATCHERY_TREASURY); } catch { return false; }
    }));
    // Always capture what (if anything) the wallet changed, so the paid-path check can be made
    // robust to whatever Phantom does — visible via GET /api/hatchery/_diag.
    const preserved = builtIxsPreserved(builtTx, clientTx);
    if (!preserved) {
      const bp = builtCore.map((i) => i.programId.toBase58());
      const cp = clientCore.map((i) => i.programId.toBase58());
      lastHatcheryDiff = { at: Date.now(), feeAtRisk, builtCount: bp.length, clientCount: cp.length, built: bp, client: cp };
      console.warn(`[hatchery] wallet dropped/altered a built ix — feeAtRisk=${feeAtRisk} built=[${bp.join(",")}] client=[${cp.join(",")}]`);
    }
    if (feeAtRisk && !preserved) {
      // A fee-bearing mint is missing one of our built instructions — the fee may have been
      // stripped or altered. Refuse to co-sign. Nothing was charged.
      return res.status(400).json({ error: "Your wallet changed the transaction while signing, so we can't safely co-sign it (no fee was charged). Please try again, or mint with a different wallet." });
    }

    // Co-sign with the mint key (required signer), then require BOTH signatures valid —
    // verifySignatures() is true only if the connected wallet (fee payer) also signed.
    const mintKp = Keypair.fromSecretKey(Uint8Array.from(Buffer.from(pending.mintSecret, "base64")));
    clientTx.partialSign(mintKp);
    if (!clientTx.verifySignatures()) return res.status(400).json({ error: "Wallet signature missing or invalid — approve the transaction and try again." });

    // Single-use: remove the pending entry BEFORE submit so a retry can't double-submit
    // (Solana also dedupes by signature, but we don't rely on that).
    pendingMints.delete(String(mintAddress));

    const conn = new Connection(rpcUrl(pending.cluster), "confirmed");
    const signature = await conn.sendRawTransaction(clientTx.serialize(), { preflightCommitment: "confirmed", maxRetries: 3 });
    return res.json({ signature });
  } catch (e) {
    console.error("[hatchery] submit failed:", e);
    return res.status(500).json({ error: e.message || "Mint submit failed" });
  }
});

// GET /api/hatchery/_diag — the last wallet-modified-tx diff (programIds only, no secrets).
// Diagnostic for the co-sign path; safe to expose since it carries no keys or user data.
router.get("/_diag", (req, res) => { res.json(lastHatcheryDiff || { none: true }); });

// POST /api/hatchery/minted — the browser reports a confirmed mint. If it's a
// mint the Hatchery actually built and the transaction is real, announce it to
// the Telegram room. Best-effort: anything failing here never affects the user.
router.post("/minted", async (req, res) => {
  try {
    const { signature, mintAddress, name, symbol } = req.body || {};
    if (!signature || !mintAddress) return res.json({ ok: false });
    // Only announce mints the Hatchery built, and only once each.
    if (!hatcheryMints.has(mintAddress) || announcedMints.has(mintAddress)) return res.json({ ok: false });

    // Confirm the transaction is real, succeeded, AND ACTUALLY CREATED THIS MINT.
    //
    // The previous version only checked that `signature` resolved to some successful mainnet
    // transaction — any signature at all, entirely unrelated. Combined with /build being
    // unauthenticated (no wallet signature, no payment, and it adds the address to hatcheryMints
    // before anything is signed), that let anyone post arbitrary "NEW TOKEN HATCHED" messages to
    // the real Telegram channel, for a mint that was never created, with a name and symbol of
    // their choosing: build to get an address, pair it with any confirmed signature from any
    // wallet, POST /minted. The comment here claimed the check this now performs.
    const conn = new Connection(rpcUrl("mainnet-beta"), "confirmed");
    const tx = await conn.getTransaction(signature, { maxSupportedTransactionVersion: 1 });
    if (!tx || (tx.meta && tx.meta.err)) return res.json({ ok: false });
    // The transaction must reference this exact mint. Covers both legacy and v0 messages.
    let keys = [];
    try {
      const msg = tx.transaction && tx.transaction.message;
      const acct = (typeof msg.getAccountKeys === "function"
        ? msg.getAccountKeys({ accountKeysFromLookups: tx.meta && tx.meta.loadedAddresses })
        : null);
      keys = acct ? acct.keySegments().flat().map((k) => k.toBase58())
                  : (msg.accountKeys || []).map((k) => (k.toBase58 ? k.toBase58() : String(k)));
    } catch (_) { keys = []; }
    if (!keys.includes(mintAddress)) return res.json({ ok: false, error: "signature_does_not_reference_mint" });
    // And the mint must actually exist on-chain now — a referenced-but-never-created address is
    // still not a hatched token.
    try {
      const info = await conn.getParsedAccountInfo(new PublicKey(mintAddress));
      const parsed = info && info.value && info.value.data && info.value.data.parsed;
      if (!parsed || parsed.type !== "mint") return res.json({ ok: false, error: "not_a_mint" });
    } catch (_) { return res.json({ ok: false, error: "mint_read_failed" }); }

    announcedMints.add(mintAddress);
    if (announcedMints.size > 5000) announcedMints.delete(announcedMints.values().next().value);
    saveHatcheryState();
    const short = `${mintAddress.slice(0, 4)}…${mintAddress.slice(-4)}`;
    // Name and symbol come from what the Hatchery BUILT, never from this request body — the body
    // is attacker-controlled free text heading for a brand channel. Escaped either way.
    const built = hatcheryMeta.get(mintAddress) || {};
    const nm = escapeHtml(String(built.name || "A new token").slice(0, 48));
    const sym = escapeHtml(String(built.symbol || "").slice(0, 16));
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

// Generic permanent-image upload on the same funded signer — used by the owner's
// /host-image tool in server.js. Returns { url, txid }. Same free-under-100KiB /
// credits-above economics as the metadata path.
async function uploadPublicFile(buffer, contentType) {
  const key = process.env.HATCHERY_TURBO_KEY;
  if (!key) throw new Error("Uploads are not configured (HATCHERY_TURBO_KEY missing)");
  const signer = new SolanaSigner(key);
  const url = await arweaveUpload(signer, buffer, contentType);
  return { url, txid: url.split("/").pop() };
}

module.exports = { uploadBytesToArweave, uploadJsonToArweave, router, uploadMetadata, buildMintTransaction, uploadPublicFile };
