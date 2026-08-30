#!/usr/bin/env node
// LP Rescue — Phase 0 spike (read-only, NEVER builds or sends a withdrawal).
// Runs the spec §29 checklist against the first real-world fixture:
//   pool     ECqUX31VhAgkKuVYwNsAUtqXhFqyDQco3sSEeRkPXbED  (Meteora DLMM, hidden on app.meteora.ag)
//   owner    D9MizWDURC2AhMUPfAbYtpqRgb521RC6CQRxBEzzQUK   (community member's public wallet)
//   position 49tX35oS1oBXBxksoLErb9UfxR1EayTUyuVZGpjxgeTa  (candidate — must be verified, not assumed)
// Usage: node scripts/test-meteora-rescue.cjs [rpcUrl]
//   rpcUrl defaults to the app's public RPC proxy so no key is needed.

const { Connection, PublicKey } = require("@solana/web3.js");
// The SDK's CJS interop shim makes require() return the DLMM class itself
// (NOT a namespace with .default — that path is undefined).
const DLMM = require("@meteora-ag/dlmm");

const POOL = "ECqUX31VhAgkKuVYwNsAUtqXhFqyDQco3sSEeRkPXbED";
const OWNER = "D9MizWDURC2AhMUPfAbYtpqRgb521RC6CQRxBEzzQUK";
const CANDIDATE = "49tX35oS1oBXBxksoLErb9UfxR1EayTUyuVZGpjxgeTa";
const RPC = process.argv[2] || "https://clucknorris.app/api/helius-rpc";

const short = (a) => a.slice(0, 7) + "…" + a.slice(-4);

(async () => {
  console.log("=== LP RESCUE SPIKE — read-only ===");
  console.log("RPC:", RPC, "\n");
  const conn = new Connection(RPC, "confirmed");

  // 1. Raw pool account
  const raw = await conn.getAccountInfo(new PublicKey(POOL));
  if (!raw) { console.log("POOL ACCOUNT NOT FOUND — abort"); process.exit(1); }
  console.log("1. pool account exists — owner program:", raw.owner.toBase58(), "size:", raw.data.length);

  // 2. SDK recognizes the pool
  const pool = await DLMM.create(conn, new PublicKey(POOL));
  console.log("2. DLMM.create OK");

  // 3. Token identification
  const x = pool.tokenX, y = pool.tokenY;
  console.log("3. tokenX:", x.publicKey.toBase58(), "decimals:", x.mint?.decimals ?? x.decimal);
  console.log("   tokenY:", y.publicKey.toBase58(), "decimals:", y.mint?.decimals ?? y.decimal);

  // 4. Active bin
  const active = await pool.getActiveBin();
  console.log("4. active bin:", active.binId, "price:", active.price, "(per token, quote units)");
  console.log("   binStep:", pool.lbPair.binStep, "status:", pool.lbPair.status);

  // 5. Positions for the owner in this pool
  const { userPositions } = await pool.getPositionsByUserAndLbPair(new PublicKey(OWNER));
  console.log("5. positions owned by", short(OWNER), "in this pool:", userPositions.length);

  // 6-7. Print each, compare to candidate
  let matched = false;
  for (const p of userPositions) {
    const pk = p.publicKey.toBase58();
    const d = p.positionData;
    if (pk === CANDIDATE) matched = true;
    console.log("   —", pk, pk === CANDIDATE ? "★ MATCHES CANDIDATE" : "");
    console.log("     version:", p.version, "bins:", d.lowerBinId, "→", d.upperBinId);
    console.log("     totalX:", String(d.totalXAmount), " totalY:", String(d.totalYAmount));
    console.log("     feeX:", d.feeX?.toString?.(), " feeY:", d.feeY?.toString?.());
    console.log("     rewards:", (d.rewardOne?.toString?.() ?? "-") + " / " + (d.rewardTwo?.toString?.() ?? "-"));
    const lock = d.lockReleasePoint?.toString?.();
    if (lock && lock !== "0") console.log("     ⚠ lockReleasePoint:", lock);
  }
  console.log("7. candidate " + short(CANDIDATE) + " matched:", matched);

  // 8-11. Direct position load
  const pos = await pool.getPosition(new PublicKey(CANDIDATE));
  const pd = pos.positionData;
  const ownerStr = pd.owner?.toBase58?.() ?? String(pd.owner);
  console.log("8. direct getPosition OK — version:", pos.version);
  console.log("9. on-chain owner:", ownerStr, ownerStr === OWNER ? "✓ MATCHES EXPECTED OWNER" : "✗ DIFFERENT OWNER");
  console.log("10. liquidity  X:", String(pd.totalXAmount), " Y:", String(pd.totalYAmount));
  console.log("11. fees       X:", pd.feeX?.toString?.(), " Y:", pd.feeY?.toString?.());
  console.log("\n12. NO withdrawal built — spike is read-only by design.");
  console.log("=== SPIKE COMPLETE ===");
})().catch((e) => { console.error("SPIKE FAILED:", e.message || e); process.exit(1); });
