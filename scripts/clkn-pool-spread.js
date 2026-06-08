#!/usr/bin/env node
// CLKN pool-spread diagnostic.
// Shows how far each Orca CLKN pool's on-chain price is from the Jupiter market
// reference (and from each other) — to gauge dislocation after a big trade and to
// confirm the pools have re-converged before staging more liquidity in.
//
//   node scripts/clkn-pool-spread.js              (CLKN, against the live app)
//   APP_URL=http://localhost:3000 node scripts/clkn-pool-spread.js
//   node scripts/clkn-pool-spread.js <MINT>       (any token with Orca pools)
//
// On-chain prices come from the same /api/whirlpool/pools read the vault uses, so this
// reflects exactly what the engine sees. Pools with zero liquidity are flagged "stale"
// (their tick price drifts with nothing to arb it) and excluded from the convergence
// verdict, which only weighs LIVE (funded) pools.

const APP = process.env.APP_URL || "https://clucknorris.app";
const TOKEN = process.argv[2] || "DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS"; // CLKN
const SYMBOL = process.argv[3] || "CLKN";
const SOL = "So11111111111111111111111111111111111111112";

const j = (u, o) => fetch(u, o).then((r) => r.json());

async function main() {
  const [poolsRes, jup] = await Promise.all([
    j(`${APP}/api/whirlpool/pools?token=${TOKEN}&symbol=${SYMBOL}`),
    j(`https://lite-api.jup.ag/price/v3?ids=${TOKEN},${SOL}`),
  ]);
  const refUsd = Number(jup[TOKEN] && jup[TOKEN].usdPrice);
  const solUsd = Number(jup[SOL] && jup[SOL].usdPrice);
  const pools = poolsRes.pools || [];
  if (!pools.length) return console.log("No Orca pools for this token.");
  if (!(refUsd > 0)) console.log("⚠️  No Jupiter reference price — showing pool-vs-pool spread only.\n");
  else console.log(`\nMarket ref (Jupiter): $${refUsd.toPrecision(6)}   |   SOL: $${solUsd.toFixed(2)}\n`);

  const rows = pools
    .map((p) => {
      const isSol = p.pair.endsWith("/SOL");
      const usd = isSol ? p.clknPriceInQuote * solUsd : p.clknPriceInQuote; // USDC ≈ $1
      const live = String(p.liquidity) !== "0";
      const spread = refUsd > 0 ? ((usd - refUsd) / refUsd) * 100 : null;
      return { pair: p.pair, fee: p.feeTierPct, usd, live, spread, address: p.address };
    })
    .sort((a, b) => a.usd - b.usd);

  const pad = (s, n) => String(s).padEnd(n);
  console.log(pad("pair", 11) + pad("fee%", 6) + pad("price USD", 15) + pad("vs ref", 10) + "liquidity");
  console.log("-".repeat(56));
  for (const r of rows) {
    const sp = r.spread == null ? "—" : (r.spread >= 0 ? "+" : "") + r.spread.toFixed(2) + "%";
    console.log(pad(r.pair, 11) + pad(r.fee, 6) + pad("$" + r.usd.toPrecision(6), 15) + pad(sp, 10) + (r.live ? "funded" : "— stale"));
  }

  // Convergence is judged on FUNDED pools' deviation from the market reference — dead
  // (zero-liquidity) tiers never get arbed and would otherwise dominate the number.
  const live = rows.filter((r) => r.live && r.spread != null);
  if (!live.length) {
    console.log(`\nNo funded pools right now — every tier is stale (no liquidity to arb).`);
    console.log(`Seed Stage-1 liquidity first, then re-run: the funded pools should pull onto the market ref.\n`);
    return;
  }
  const worst = Math.max(...live.map((r) => Math.abs(r.spread)));
  console.log(`\nmax deviation from market across ${live.length} FUNDED pool(s): ${worst.toFixed(2)}%`);
  const verdict = worst < 1 ? "✅ CONVERGED  (<1% off market — safe to add the rest)"
    : worst < 3 ? "🟡 NEARLY converged  (1-3% — almost there, give it another few min)"
    : "🔴 DIVERGED  (>3% off market — let it settle / keep the add small)";
  console.log(verdict + "\n");
}
main().catch((e) => { console.error("spread check failed:", e.message); process.exit(1); });
