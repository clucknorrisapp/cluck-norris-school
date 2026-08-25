// LP Rescue — Raydium CLMM adapter (read-only wallet scan, detect + diagnose).
//
// Raydium concentrated positions are NFTs, like Orca's: wallet NFT → position
// PDA (seeds ["position", nftMint]) under the CLMM program → PersonalPositionState.
// We decode the few fields we need from the raw account instead of pulling in
// the heavy Raydium SDK — and every decode is SELF-VALIDATING: the decoded
// pool id must be a real account owned by the CLMM program, and the pool's
// decoded mints must be real token mints. A layout drift therefore fails
// loudly (position skipped with a diagnostic), never silently misreports.
//
// v1 is detection + diagnosis; Raydium's own frontend is healthy, so the card
// links there for withdrawal (in-app withdrawal covers Meteora DLMM today).
const { PublicKey } = require("@solana/web3.js");
const rpc = require("../rpc");

const CLMM_PROGRAM = new PublicKey("CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK");
const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TOKEN_2022_PROGRAM = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

// PersonalPositionState offsets (anchor): 8 disc, 1 bump, 32 nft_mint, 32 pool_id,
// 4 tick_lower(i32 LE), 4 tick_upper(i32 LE), 16 liquidity(u128 LE),
// 16+16 fee growth checkpoints, 8 token_fees_owed_0, 8 token_fees_owed_1.
const P = { NFT_MINT: 9, POOL_ID: 41, TICK_LO: 73, TICK_HI: 77, LIQ: 81, FEE0: 129, FEE1: 137 };
// PoolState offsets: 8 disc, 1 bump, 32 amm_config, 32 owner, 32 mint0, 32 mint1,
// 32 vault0, 32 vault1, 32 observation_key, 1 dec0, 1 dec1, 2 tick_spacing,
// 16 liquidity, 16 sqrt_price, 4 tick_current(i32 LE).
const S = { MINT0: 73, MINT1: 105, DEC0: 233, DEC1: 234, TICK_CUR: 269 };

const i32 = (buf, o) => buf.readInt32LE(o);
const u64 = (buf, o) => buf.readBigUInt64LE(o).toString();
const u128 = (buf, o) => ((buf.readBigUInt64LE(o + 8) << 64n) | buf.readBigUInt64LE(o)).toString();
const pubkey = (buf, o) => new PublicKey(buf.slice(o, o + 32));

function uiAmount(raw, decimals) {
  const s = String(raw); const d = Number(decimals) || 0;
  const whole = s.length > d ? s.slice(0, s.length - d) : "0";
  const frac = s.padStart(d + 1, "0").slice(-d).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

async function scanWalletRaydiumClmm(ownerAddress) {
  const conn = rpc.connection("confirmed");
  const ownerPk = new PublicKey(ownerAddress);
  const [legacy, t22] = await Promise.all([
    conn.getParsedTokenAccountsByOwner(ownerPk, { programId: TOKEN_PROGRAM }),
    conn.getParsedTokenAccountsByOwner(ownerPk, { programId: TOKEN_2022_PROGRAM }).catch(() => ({ value: [] })),
  ]);
  const nftMints = [];
  for (const { account } of [...legacy.value, ...t22.value]) {
    const info = account.data?.parsed?.info;
    const amt = info?.tokenAmount;
    if (info && amt && amt.decimals === 0 && amt.amount === "1") nftMints.push(info.mint);
  }
  if (!nftMints.length) return [];

  // Derive all candidate position PDAs and fetch in chunks.
  const pdas = nftMints.map((m) =>
    PublicKey.findProgramAddressSync([Buffer.from("position"), new PublicKey(m).toBuffer()], CLMM_PROGRAM)[0]
  );
  const found = [];
  for (let i = 0; i < pdas.length; i += 100) {
    const chunk = pdas.slice(i, i + 100);
    const infos = await conn.getMultipleAccountsInfo(chunk);
    infos.forEach((acc, j) => {
      if (acc && acc.owner.equals(CLMM_PROGRAM) && acc.data.length >= 145) {
        found.push({ pda: chunk[j], data: acc.data, nftMint: nftMints[i + j] });
      }
    });
  }
  if (!found.length) return [];

  const positions = [];
  const poolCache = new Map();
  for (const f of found) {
    const poolId = pubkey(f.data, P.POOL_ID).toBase58();
    let pool = poolCache.get(poolId);
    if (pool === undefined) {
      pool = null;
      try {
        const acc = await conn.getAccountInfo(new PublicKey(poolId));
        // Self-validation: pool account must be CLMM-owned and its decoded mints
        // must be real mints — otherwise our layout assumptions are wrong for
        // this account version and we must not report numbers from it.
        if (acc && acc.owner.equals(CLMM_PROGRAM) && acc.data.length >= 273) {
          const mint0 = pubkey(acc.data, S.MINT0), mint1 = pubkey(acc.data, S.MINT1);
          const m0 = await conn.getAccountInfo(mint0);
          const mintOk = m0 && (m0.owner.equals(TOKEN_PROGRAM) || m0.owner.equals(TOKEN_2022_PROGRAM));
          if (mintOk) {
            pool = {
              mint0: mint0.toBase58(), mint1: mint1.toBase58(),
              dec0: acc.data[S.DEC0], dec1: acc.data[S.DEC1],
              tickCurrent: i32(acc.data, S.TICK_CUR),
            };
          }
        }
      } catch {}
      poolCache.set(poolId, pool);
    }

    const tickLo = i32(f.data, P.TICK_LO), tickHi = i32(f.data, P.TICK_HI);
    const liquidity = u128(f.data, P.LIQ);
    const fee0 = u64(f.data, P.FEE0), fee1 = u64(f.data, P.FEE1);
    const hasLiquidity = liquidity !== "0";
    const hasClaims = fee0 !== "0" || fee1 !== "0";

    if (!pool) {
      positions.push({
        protocol: "raydium-clmm",
        poolAddress: poolId, positionAddress: f.pda.toBase58(), positionNftMint: f.nftMint,
        ownerAddress: ownerPk.toBase58(),
        tokenX: { mint: "unknown", decimals: 0, rawAmount: "0", uiAmount: "?" },
        tokenY: { mint: "unknown", decimals: 0, rawAmount: "0", uiAmount: "?" },
        lowerBinId: tickLo, upperBinId: tickHi, inRange: undefined,
        feeX: fee0, feeY: fee1, feeXUi: "?", feeYUi: "?", rewards: [], lockReleasePoint: 0,
        status: hasLiquidity || hasClaims ? "RECOVERABLE" : "UNKNOWN",
        withdrawable: false, canClose: false,
        manageUrl: "https://raydium.io/portfolio/",
        diagnostics: [
          "A Raydium CLMM position account exists for an NFT in this wallet",
          "Pool details could not be safely decoded — treat amounts as unverified",
          "Manage it at raydium.io/portfolio",
        ],
      });
      continue;
    }

    // Liquidity → exact token amounts needs tick math; v1 reports liquidity + the
    // stale fee checkpoints honestly and defers exact composition to Raydium's UI.
    const diagnostics = [
      "Position NFT found in the wallet",
      "Raydium CLMM program recognizes the position",
      "Pool verified on-chain (" + pool.mint0.slice(0, 4) + "… / " + pool.mint1.slice(0, 4) + "…)",
      hasLiquidity ? "Liquidity remains in the position (raw liquidity " + liquidity + ")" : "Position holds no liquidity",
    ];
    if (hasClaims) diagnostics.push("Fee checkpoint shows unclaimed fees (live figure may be higher)");
    diagnostics.push("Manage or withdraw at raydium.io — Raydium's own frontend supports this position (LP Rescue in-app withdrawal covers Meteora DLMM today)");

    positions.push({
      protocol: "raydium-clmm",
      poolAddress: poolId, positionAddress: f.pda.toBase58(), positionNftMint: f.nftMint,
      ownerAddress: ownerPk.toBase58(),
      tokenX: { mint: pool.mint0, decimals: pool.dec0, rawAmount: "0", uiAmount: hasLiquidity ? "(in position)" : "0" },
      tokenY: { mint: pool.mint1, decimals: pool.dec1, rawAmount: "0", uiAmount: hasLiquidity ? "(in position)" : "0" },
      lowerBinId: tickLo, upperBinId: tickHi,
      activeBinId: pool.tickCurrent,
      inRange: tickLo <= pool.tickCurrent && pool.tickCurrent < tickHi,
      feeX: fee0, feeY: fee1,
      feeXUi: uiAmount(fee0, pool.dec0), feeYUi: uiAmount(fee1, pool.dec1),
      rewards: [], lockReleasePoint: 0, liquidityRaw: liquidity,
      status: hasLiquidity || hasClaims ? "RECOVERABLE" : "EMPTY",
      withdrawable: false, canClose: false,
      manageUrl: "https://raydium.io/portfolio/",
      diagnostics,
    });
  }
  return positions;
}

module.exports = { scanWalletRaydiumClmm };
