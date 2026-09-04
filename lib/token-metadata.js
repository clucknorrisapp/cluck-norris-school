"use strict";
/**
 * Reading a Metaplex metadata account, and building the ONE transaction that makes it immutable.
 *
 * Why this exists: a token whose metadata is still mutable gets a red banner on CoinGecko (via
 * Rugcheck) warning that "the contract creator can make changes… disabling sells, changing fees,
 * unrestrictive minting". For a token that has already revoked mint AND freeze authority almost
 * every clause of that is false — but it is unrebuttable, sits at the top of the page, and the
 * reader cannot check it. Setting is_mutable = false is the only thing that clears it.
 *
 * ⚠️ THE EDIT THIS BUILDS IS THE LAST ONE EVER POSSIBLE on the account. Two consequences shape
 * everything below:
 *
 *   1. EVERY FIELD MUST BE PRESERVED EXACTLY. UpdateMetadataAccountV2 takes a WHOLE DataV2, not a
 *      patch — anything omitted is written as empty/None permanently. ROSE carries a VERIFIED
 *      creator at share 100; passing creators: None would erase it on the one edit that can never
 *      be undone. So we read the live account and echo every field back, changing only what the
 *      caller explicitly asked to change.
 *   2. THE URI IS USUALLY WORTH FIXING IN THE SAME TRANSACTION. Tokens minted with an IPFS gateway
 *      URL (https://ipfs.io/ipfs/…) are everywhere, and that gateway is being retired — it already
 *      429s. Freezing a dying URL forever is a worse outcome than the banner. One instruction sets
 *      the new URI and the immutable flag together; that is the intended use, hence `newUri`.
 *
 * The instruction is hand-built rather than pulled from the Metaplex SDK for the reason
 * hatchery.js already documents (the SDK is ESM-only and fights this CommonJS server).
 * scripts/token-metadata-lock-test.cjs byte-diffs what we build against the real library's own
 * serializer, so "hand-built" never means "unverified" — the repo has been bitten by exactly that
 * before (the web3.js Buffer/toBufferLE trap in CLAUDE.md).
 */
const { PublicKey, Transaction, TransactionInstruction } = require("@solana/web3.js");

const TOKEN_METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
const IX_UPDATE_METADATA_ACCOUNT_V2 = 15;

function metadataPda(mint) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), TOKEN_METADATA_PROGRAM_ID.toBuffer(), new PublicKey(mint).toBuffer()],
    TOKEN_METADATA_PROGRAM_ID,
  )[0];
}

// ---- decode ----------------------------------------------------------------------------------
// Borsh, read straight through. Layout is the Metadata account (NOT DataV2): collection and uses
// live at the ACCOUNT level, after token_standard — a detail worth stating because DataV2 (what
// the update instruction takes) nests them inside, and mixing the two silently drops them.
function decodeMetadata(buf) {
  let o = 0;
  const u8 = () => buf[o++];
  const u16 = () => { const v = buf.readUInt16LE(o); o += 2; return v; };
  const u64 = () => { const v = buf.readBigUInt64LE(o); o += 8; return v.toString(); };
  const pubkey = () => { const p = new PublicKey(buf.subarray(o, o + 32)); o += 32; return p.toBase58(); };
  // Metaplex pads strings to a fixed capacity with NULs. Strip them, or a round-trip re-writes the
  // padding and the name comes back with invisible junk welded on — permanently, in this case.
  const str = () => {
    const n = buf.readUInt32LE(o); o += 4;
    const s = buf.subarray(o, o + n).toString("utf8").replace(/\0+$/, ""); o += n; return s;
  };
  const option = (fn) => (u8() ? fn() : null);

  const key = u8();
  if (key !== 4) return null;                                   // 4 = MetadataV1
  const updateAuthority = pubkey();
  const mint = pubkey();
  const name = str(), symbol = str(), uri = str();
  const sellerFeeBasisPoints = u16();
  const creators = option(() => {
    const n = buf.readUInt32LE(o); o += 4;
    const out = [];
    for (let i = 0; i < n; i++) out.push({ address: pubkey(), verified: !!u8(), share: u8() });
    return out;
  });
  const primarySaleHappened = !!u8();
  const isMutable = !!u8();
  const editionNonce = option(() => u8());
  const tokenStandard = option(() => u8());
  const collection = option(() => ({ verified: !!u8(), key: pubkey() }));
  const uses = option(() => ({ useMethod: u8(), remaining: u64(), total: u64() }));
  return { key, updateAuthority, mint, name, symbol, uri, sellerFeeBasisPoints, creators,
           primarySaleHappened, isMutable, editionNonce, tokenStandard, collection, uses };
}

// ---- encode ----------------------------------------------------------------------------------
const bStr = (s) => {
  const body = Buffer.from(String(s), "utf8");
  const len = Buffer.alloc(4); len.writeUInt32LE(body.length, 0);
  return Buffer.concat([len, body]);
};
const bOpt = (v, enc) => (v == null ? Buffer.from([0]) : Buffer.concat([Buffer.from([1]), enc(v)]));
const bU16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n, 0); return b; };
const bU64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n), 0); return b; };

function encodeDataV2(d) {
  return Buffer.concat([
    bStr(d.name), bStr(d.symbol), bStr(d.uri), bU16(d.sellerFeeBasisPoints || 0),
    bOpt(d.creators, (cs) => {
      const len = Buffer.alloc(4); len.writeUInt32LE(cs.length, 0);
      return Buffer.concat([len, ...cs.map((c) => Buffer.concat([
        new PublicKey(c.address).toBuffer(), Buffer.from([c.verified ? 1 : 0]), Buffer.from([c.share & 0xff]),
      ]))]);
    }),
    bOpt(d.collection, (c) => Buffer.concat([Buffer.from([c.verified ? 1 : 0]), new PublicKey(c.key).toBuffer()])),
    bOpt(d.uses, (u) => Buffer.concat([Buffer.from([u.useMethod]), bU64(u.remaining), bU64(u.total)])),
  ]);
}

/**
 * UpdateMetadataAccountV2 data:
 *   u8 discriminator | Option<DataV2> | Option<Pubkey> newUpdateAuthority
 *   | Option<bool> primarySaleHappened | Option<bool> isMutable
 */
function encodeUpdateV2({ data = null, newUpdateAuthority = null, primarySaleHappened = null, isMutable = null }) {
  return Buffer.concat([
    Buffer.from([IX_UPDATE_METADATA_ACCOUNT_V2]),
    bOpt(data, encodeDataV2),
    bOpt(newUpdateAuthority, (pk) => new PublicKey(pk).toBuffer()),
    bOpt(primarySaleHappened, (v) => Buffer.from([v ? 1 : 0])),
    bOpt(isMutable, (v) => Buffer.from([v ? 1 : 0])),
  ]);
}

/**
 * Build the unsigned update transaction.
 *
 * TWO STEPS, NOT ONE — and the separation is the whole safety model.
 *
 *   step 1  makeImmutable: false   repoint the URI while the account is STILL MUTABLE. Go look at
 *                                  the token in a wallet, an explorer and the aggregators. If the
 *                                  new JSON is wrong, malformed, or the image does not render, fix
 *                                  it and run step 1 again. Nothing is permanent yet.
 *   step 2  makeImmutable: true    only once you have SEEN it render correctly. Irreversible.
 *
 * An earlier draft did both in a single instruction to avoid freezing a dying URI. That is worse:
 * it makes the first time you ever see the new metadata the moment it becomes unchangeable. Two
 * transactions cost fractions of a cent and buy you a verification window.
 *
 * `current` is the DECODED live account — required, not optional, because building this from
 * anything other than what is actually on-chain is how fields get silently erased.
 * Returns { ix, preserved, changes } so a UI can show exactly what will and will not change
 * before a human signs.
 */
function buildUpdateIx({ current, newUri = null, makeImmutable = false }) {
  if (!current || current.key !== 4) throw new Error("no metadata account to update");
  if (!current.isMutable) throw new Error("metadata is already immutable — nothing can be changed");
  if (newUri == null && !makeImmutable) throw new Error("nothing to do: pass a newUri, makeImmutable, or both");
  const uri = newUri == null ? current.uri : String(newUri);
  if (!/^(https:\/\/|ipfs:\/\/|ar:\/\/)/i.test(uri)) throw new Error(`refusing a non-https/ipfs/ar URI: ${uri}`);

  const data = {
    name: current.name, symbol: current.symbol, uri,
    sellerFeeBasisPoints: current.sellerFeeBasisPoints,
    creators: current.creators, collection: current.collection, uses: current.uses,
  };
  const ix = new TransactionInstruction({
    programId: TOKEN_METADATA_PROGRAM_ID,
    keys: [
      { pubkey: metadataPda(current.mint), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(current.updateAuthority), isSigner: true, isWritable: false },
    ],
    // isMutable is only sent when the caller is deliberately locking. On a step-1 URI update it
    // is omitted entirely (Option = None), which leaves the flag exactly as it is — sending
    // `true` would be a no-op today but would silently re-open a locked token if this were ever
    // pointed at one. newUpdateAuthority always stays null: we are never reassigning ownership,
    // and conflating that with locking on an irreversible call is asking for an accident.
    data: encodeUpdateV2({ data, ...(makeImmutable ? { isMutable: false } : {}) }),
  });
  return {
    ix,
    preserved: { name: data.name, symbol: data.symbol, sellerFeeBasisPoints: data.sellerFeeBasisPoints,
                 creators: data.creators, collection: data.collection, uses: data.uses,
                 updateAuthority: current.updateAuthority },
    changes: { uri: { from: current.uri, to: uri, changed: uri !== current.uri },
               isMutable: makeImmutable ? { from: true, to: false } : { from: true, to: true, changed: false } },
    irreversible: !!makeImmutable,
  };
}

async function buildUpdateTx({ connection, current, newUri = null, makeImmutable = false }) {
  const { ix, preserved, changes, irreversible } = buildUpdateIx({ current, newUri, makeImmutable });
  const tx = new Transaction().add(ix);
  tx.feePayer = new PublicKey(current.updateAuthority);
  tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
  // Unsigned, serialized for the browser to hand to Phantom. NEVER pre-signed server-side — see
  // the multi-signer note in CLAUDE.md; here the update authority is the only signer and it is the
  // user's own wallet, so the server must never hold or apply a signature.
  const unsignedBase64 = tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
  return { unsignedBase64, preserved, changes, irreversible, metadataPda: metadataPda(current.mint).toBase58() };
}

/**
 * Pick a DURABLE home for a token's image, in the owner's stated order of preference.
 *
 *   C  mirror the ORIGINAL bytes to Arweave — exact and permanent. Can fail: over Turbo's 100 KiB
 *      free ceiling it needs a funded account, so this must never be the only path.
 *   A  rewrite as ipfs://<CID> — the gateway-AGNOSTIC form. Byte-identical file, and consumers
 *      resolve it through their OWN gateway instead of the dying ipfs.io one. Permanent only as
 *      long as the CID stays pinned.
 *
 * Pure, with the upload injected, because the interesting behaviour is what happens when C FAILS —
 * and that cannot be staged against a live Turbo account. Never downscales or substitutes a
 * different file: reusing an aggregator's smaller copy would silently freeze a lower-resolution
 * logo, which is the mistake this function exists to make impossible.
 */
async function chooseDurableImage({ imageUrl, mirror = null, override = null }) {
  const url = String(imageUrl || "");
  const steps = [];
  // An explicit override wins over everything. The reason it exists: re-pinning content under
  // YOUR OWN account is what removes the dependency on whoever pinned it originally, and a
  // re-upload legitimately produces a DIFFERENT CID — Pinata's free UI writes CIDv1-raw
  // (bafkrei…) where the original was CIDv0 dag-pb (Qm…). Same pixels, different address. Without
  // this the rebuild would derive the CID from the old metadata and quietly re-point at the pin
  // we were trying to stop relying on.
  if (override) {
    const o = String(override).trim();
    if (!/^(https:\/\/|ipfs:\/\/|ar:\/\/)/i.test(o)) throw new Error(`refusing a non-https/ipfs/ar image override: ${o}`);
    steps.push(`using the supplied image: ${o}`);
    return { image: o, method: "override", steps };
  }
  const cid = (url.match(/\/ipfs\/([A-Za-z0-9]+)/) || [])[1] || null;
  if (mirror && /^https:\/\//i.test(url)) {
    try {
      const uri = await mirror(url);
      if (!uri) throw new Error("mirror returned nothing");
      steps.push(`mirrored the original image to Arweave: ${uri}`);
      return { image: uri, method: "arweave-mirror", steps };
    } catch (e) {
      steps.push(`Arweave mirror unavailable (${String((e && e.message) || e).slice(0, 120)}) — falling back`);
    }
  }
  if (cid) {
    steps.push(`rewrote the image as ipfs://${cid} — same file, resolved by each consumer's own gateway`);
    return { image: `ipfs://${cid}`, method: "ipfs-scheme", steps };
  }
  if (/^(ipfs|ar):\/\//i.test(url)) {
    steps.push("image is already scheme-based and durable — left as-is");
    return { image: url, method: "unchanged", steps };
  }
  steps.push("no durable option: the image is not on IPFS and could not be mirrored");
  return { image: null, method: null, steps };
}

module.exports = {
  TOKEN_METADATA_PROGRAM_ID, IX_UPDATE_METADATA_ACCOUNT_V2,
  metadataPda, decodeMetadata, encodeDataV2, encodeUpdateV2, buildUpdateIx, buildUpdateTx, chooseDurableImage,
};
