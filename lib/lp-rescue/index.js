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
const { PublicKey } = require("@solana/web3.js");
const rpc = require("../rpc");

const ORCA_PROGRAM = "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc";
const RAYDIUM_CLMM_PROGRAM = "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK";
// Friendly names for programs we recognize but don't (yet) scan — so a pasted
// address gets "this is a Raydium V4 pool" instead of a bare program id.
const KNOWN_PROGRAMS = {
  "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8": "Raydium AMM v4 (classic LP-token pool)",
  "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C": "Raydium CPMM (LP-token pool)",
  "Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB": "Meteora DAMM v1 pool",
  "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG": "Meteora DAMM v2 pool",
};

async function scanRescue({ pool, owner, mint, position }) {
  // Pool mode routes by the pool account's OWNING PROGRAM — a pasted pool
  // address should work whether it's Meteora, Orca, or Raydium CLMM.
  if (pool && !position) {
    let acc = null;
    try { acc = await rpc.connection().getAccountInfo(new PublicKey(String(pool).trim())); }
    catch (e) {
      if (/Invalid public key|Non-base58/i.test(String(e.message))) throw new meteora.RescueError("BAD_ADDRESS", "pool address is not a valid Solana address");
      throw new meteora.RescueError("RPC_SCAN_FAILED", "could not read the pool account: " + (e.message || e));
    }
    if (acc) {
      const prog = acc.owner.toBase58();
      if (prog === ORCA_PROGRAM) return { mode: owner ? "pool+wallet" : "pool", ...(await orca.scanPoolOrca(pool, owner)) };
      if (prog === RAYDIUM_CLMM_PROGRAM) return { mode: owner ? "pool+wallet" : "pool", ...(await raydium.scanPoolRaydiumClmm(pool, owner)) };
      if (prog !== meteora.DLMM_PROGRAM_ID) {
        const name = KNOWN_PROGRAMS[prog];
        return {
          success: true, mode: "pool", poolFound: true, positions: [],
          note: name
            ? "This is a " + name + " — LP Rescue can't scan this pool type yet. Try the wallet-only scan, or manage it in that DEX's own app."
            : "This account is a pool or program we don't recognize yet (program " + prog + "). Try the wallet-only scan.",
        };
      }
    }
    // Meteora DLMM pool (or no account — meteora path reports that cleanly).
    return meteora.scanRescue({ pool, owner, mint, position });
  }
  // Position/mint hints → the Meteora engine handles them. Wallet ALONE → sweep.
  if (position || mint) return meteora.scanRescue({ pool, owner, mint, position });
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
