// Diploma NFT minter — compressed NFTs (Metaplex Bubblegum) for school GRADUATES only.
// Cheapest path: ONE shared merkle tree (created once, ~0.3 SOL), then mints are ~free
// (tx fees only). Payer/authority = the treasury wallet (MM_OPERATOR_SECRET_TREASURY).
// Transferable; graduation-only; art = the personalized credential card served at
// /api/diploma-metadata/:slug. Idempotent per wallet. Helius RPC via lib/rpc.
const { Keypair } = require("@solana/web3.js");
const bs58 = require("bs58");
const { primaryRpcUrl } = require("./rpc");
const kv = require("./kvstore");

const TREE_KV = "diplomaTreeV1";     // { tree, createdAt }
const MINTED_KV = "diplomaMintedV1"; // wallet -> { sig, slug, at }
const ORIGIN = "https://clucknorris.app";
const GAS_FLOOR_SOL = 0.15;          // never mint below this treasury SOL (protect rebalancer gas)

function secretBytes() {
  const raw = (process.env.MM_OPERATOR_SECRET_TREASURY || "").trim();
  if (!raw) return null;
  try { return raw.startsWith("[") ? Uint8Array.from(JSON.parse(raw)) : bs58.decode(raw); } catch { return null; }
}
function isEnabled() { return !!secretBytes(); }
function payerPubkey() {
  const b = secretBytes(); if (!b) return null;
  try { return Keypair.fromSecretKey(b).publicKey.toBase58(); } catch { return null; }
}

// Lazy umi build (heavy SDK; only loaded when we actually mint).
let _umi = null;
function umi() {
  if (_umi) return _umi;
  const { createUmi } = require("@metaplex-foundation/umi-bundle-defaults");
  const { keypairIdentity } = require("@metaplex-foundation/umi");
  const { mplBubblegum } = require("@metaplex-foundation/mpl-bubblegum");
  const u = createUmi(primaryRpcUrl()).use(mplBubblegum());
  u.use(keypairIdentity(u.eddsa.createKeypairFromSecretKey(secretBytes())));
  _umi = u;
  return u;
}

async function treasurySol(u) {
  try { const b = await u.rpc.getBalance(u.identity.publicKey); return Number(b.basisPoints) / 1e9; } catch { return 0; }
}

// Create the shared tree once (idempotent via kv). One-time ~0.3 SOL.
async function ensureTree() {
  const existing = kv.get(TREE_KV, null);
  if (existing && existing.tree) return existing.tree;
  const u = umi();
  const { generateSigner } = require("@metaplex-foundation/umi");
  const { createTree } = require("@metaplex-foundation/mpl-bubblegum");
  const merkleTree = generateSigner(u);
  await (await createTree(u, { merkleTree, maxDepth: 14, maxBufferSize: 64 })).sendAndConfirm(u); // holds 16,384 diplomas
  const tree = merkleTree.publicKey.toString();
  kv.set(TREE_KV, { tree, createdAt: Date.now() });
  return tree;
}

// Mint a diploma cNFT to a graduate's wallet. Idempotent (won't double-mint a wallet).
async function mintDiploma(wallet, slug, { force = false } = {}) {
  if (!isEnabled()) return { ok: false, reason: "mint wallet (MM_OPERATOR_SECRET_TREASURY) not set" };
  const minted = kv.get(MINTED_KV, {});
  if (!force && minted[wallet]) return { ok: true, already: true, sig: minted[wallet].sig };
  const u = umi();
  const sol = await treasurySol(u);
  if (sol < GAS_FLOOR_SOL) return { ok: false, reason: `treasury SOL ${sol.toFixed(3)} below gas floor ${GAS_FLOOR_SOL} — skipped to protect rebalancer` };
  const tree = await ensureTree();
  const { publicKey, none } = require("@metaplex-foundation/umi");
  const { mintV1 } = require("@metaplex-foundation/mpl-bubblegum");
  const r = await mintV1(u, {
    leafOwner: publicKey(wallet),
    merkleTree: publicKey(tree),
    metadata: {
      name: "Cluck Norris Diploma",
      uri: `${ORIGIN}/api/diploma-metadata/${slug}`,
      sellerFeeBasisPoints: 0,
      collection: none(),
      creators: [],
    },
  }).sendAndConfirm(u);
  const sig = bs58.encode(r.signature);
  minted[wallet] = { sig, slug, at: Date.now() };
  kv.set(MINTED_KV, minted);
  return { ok: true, sig, tree };
}

function status() {
  const tree = kv.get(TREE_KV, null);
  const minted = kv.get(MINTED_KV, {});
  return { enabled: isEnabled(), payer: payerPubkey(), tree: tree && tree.tree, mintedCount: Object.keys(minted).length };
}

module.exports = { isEnabled, payerPubkey, ensureTree, mintDiploma, status, MINTED_KV };
