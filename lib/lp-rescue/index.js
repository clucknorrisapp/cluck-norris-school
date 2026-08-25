// LP Rescue — protocol dispatcher.
//
// Pool / position / token-scoped scans are Meteora DLMM (the broken-frontend
// case the tool exists for). A WALLET-ONLY scan is the "I forgot where my LP
// even is" case, so it fans out across every supported protocol in parallel,
// and each protocol fails independently: one adapter's RPC error must never
// hide another's findings, and is reported per-protocol as a scan failure —
// never as "no positions".
const meteora = require("./meteora-dlmm");
const orca = require("./orca-whirlpool");
const raydium = require("./raydium-clmm");

async function scanRescue({ pool, owner, mint, position }) {
  // Any pool/position/mint hint → the Meteora engine handles it (incl. its own
  // wallet-only mode when combined). Wallet ALONE → multi-protocol sweep.
  if (pool || position || mint) return meteora.scanRescue({ pool, owner, mint, position });
  if (!owner) return meteora.scanRescue({}); // throws BAD_REQUEST with the right message

  const [met, orc, ray] = await Promise.allSettled([
    meteora.scanRescue({ owner }),
    orca.scanWalletOrca(owner),
    raydium.scanWalletRaydiumClmm(owner),
  ]);
  const byProtocol = {
    "meteora-dlmm": met.status === "fulfilled"
      ? { success: true, count: (met.value.positions || []).length }
      : { success: false, code: met.reason?.code || "RPC_SCAN_FAILED", error: met.reason?.message },
    "orca-whirlpool": orc.status === "fulfilled"
      ? { success: true, count: orc.value.length }
      : { success: false, code: "RPC_SCAN_FAILED", error: orc.reason?.message },
    "raydium-clmm": ray.status === "fulfilled"
      ? { success: true, count: ray.value.length }
      : { success: false, code: "RPC_SCAN_FAILED", error: ray.reason?.message },
  };
  const positions = [
    ...(met.status === "fulfilled" ? met.value.positions || [] : []),
    ...(orc.status === "fulfilled" ? orc.value : []),
    ...(ray.status === "fulfilled" ? ray.value : []),
  ];
  const allFailed = Object.values(byProtocol).every((p) => !p.success);
  if (allFailed) {
    const err = new meteora.RescueError("RPC_SCAN_FAILED", "every protocol scan failed — the network reads did not complete");
    throw err;
  }
  return { success: true, mode: "wallet-multi", byProtocol, positions };
}

module.exports = {
  scanRescue,
  buildFullWithdrawal: meteora.buildFullWithdrawal,
  RescueError: meteora.RescueError,
  DLMM_PROGRAM_ID: meteora.DLMM_PROGRAM_ID,
};
