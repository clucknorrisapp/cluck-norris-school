#!/usr/bin/env node
// CLKN liquidity-engine pool-spread diagnostic.
// Compares the Liquidity-Engine Orca pools (the tiers the vault manages) against the TRUE
// market price — the main LP, which lives on Meteora — to gauge dislocation after a big
// trade and confirm the pools have re-converged before staging liquidity back in.
//
//   node scripts/clkn-pool-spread.js              (CLKN, against the live app)
//   APP_URL=http://localhost:3000 node scripts/clkn-pool-spread.js
//   node scripts/clkn-pool-spread.js <MINT> <SYMBOL>
//
// - Market ref = the DEEPEST-liquidity pool on DexScreener (real price discovery; for CLKN
//   that's the Meteora main LP).
// - Engine pools = the on-chain Orca tick (same /api/whirlpool/pools read the vault uses, so
//   it's exactly what suggestRanges will center a new position on), shown ONLY for the pools
//   that actually trade (matched to DexScreener) — dead/empty tiers are ignored.
// - Jupiter is shown as a cross-check and flagged when it has gone stale (it lags the real
//   price when the Orca pools it leans on are drained).

const APP = process.env.APP_URL || "https://clucknorris.app";
const TOKEN = process.argv[2] || "DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS"; // CLKN
const SYMBOL = process.argv[3] || "CLKN";
const SOL = "So11111111111111111111111111111111111111112";

const j = (u, o) => fetch(u, o).then((r) => r.json());

async function main() {
  const [poolsRes, jup, ds] = await Promise.all([
    j(`${APP}/api/whirlpool/pools?token=${TOKEN}&symbol=${SYMBOL}`).catch(() => ({})),
    j(`https://lite-api.jup.ag/price/v3?ids=${TOKEN},${SOL}`).catch(() => ({})),
    j(`https://api.dexscreener.com/latest/dex/tokens/${TOKEN}`).catch(() => ({})),
  ]);
  const solUsd = Number(jup[SOL] && jup[SOL].usdPrice) || 0;
  const jupUsd = Number(jup[TOKEN] && jup[TOKEN].usdPrice) || 0;

  const pairs = (ds.pairs || []).slice().sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
  const main = pairs[0];
  const refUsd = main ? Number(main.priceUsd) : jupUsd;
  if (!(refUsd > 0)) return console.log("No market price available.");

  // ── Market reference: the main LP (deepest pool) ──
  const mc = main ? Math.round(main.fdv || main.marketCap || 0) : 0;
  console.log(`\nMAIN LP / market ref:  $${refUsd.toPrecision(6)}` +
    (main ? `  (${main.dexId} ${main.baseToken.symbol}/${main.quoteToken.symbol}, $${Math.round(main.liquidity?.usd || 0).toLocaleString()} liq)` : "") +
    (mc ? `  |  MC $${mc.toLocaleString()}` : ""));
  if (main?.priceChange) console.log(`                       24h ${main.priceChange.h24 ?? "?"}%  6h ${main.priceChange.h6 ?? "?"}%  1h ${main.priceChange.h1 ?? "?"}%`);
  if (jupUsd > 0) {
    const jd = ((jupUsd - refUsd) / refUsd) * 100;
    console.log(`Jupiter cross-check:   $${jupUsd.toPrecision(6)}  (${jd >= 0 ? "+" : ""}${jd.toFixed(2)}% vs market)${Math.abs(jd) > 2 ? "  ⚠️ STALE — lagging real price" : ""}`);
  }

  // ── Engine pools: on-chain Orca ticks for the pools that actually trade ──
  const liveAddrs = new Set(pairs.map((p) => p.pairAddress));
  const eng = (poolsRes.pools || [])
    .filter((p) => liveAddrs.has(p.address)) // only the pools DexScreener tracks (the real ones)
    .map((p) => {
      const usd = p.pair.endsWith("/SOL") ? p.clknPriceInQuote * solUsd : p.clknPriceInQuote;
      const dsP = pairs.find((d) => d.pairAddress === p.address);
      return { pair: p.pair, fee: p.feeTierPct, usd, liq: dsP ? (dsP.liquidity?.usd || 0) : 0, spread: ((usd - refUsd) / refUsd) * 100 };
    })
    .filter((r) => r.pair.toUpperCase().includes("CLKN") || true)
    .sort((a, b) => a.usd - b.usd);

  if (!eng.length) { console.log("\n(No engine Orca pools matched the live market list.)\n"); return; }
  const pad = (s, n) => String(s).padEnd(n);
  console.log(`\nEngine pools (Orca on-chain tick vs main LP):`);
  console.log(pad("  pair", 13) + pad("fee%", 6) + pad("tick USD", 15) + pad("vs main", 11) + "pool liq");
  console.log("  " + "-".repeat(53));
  for (const r of eng) {
    const sp = (r.spread >= 0 ? "+" : "") + r.spread.toFixed(2) + "%";
    console.log("  " + pad(r.pair, 11) + pad(r.fee, 6) + pad("$" + r.usd.toPrecision(6), 15) + pad(sp, 11) + "$" + Math.round(r.liq).toLocaleString());
  }

  const worst = Math.max(...eng.map((r) => Math.abs(r.spread)));
  const funded = eng.some((r) => r.liq > 50);
  console.log(`\nmax dislocation of engine pools vs main LP: ${worst.toFixed(2)}%`);
  console.log(worst < 1 ? "✅ CONVERGED  (<1% off the main LP — safe to add the rest)"
    : worst < 3 ? "🟡 NEARLY converged  (1-3% — give it a few more min)"
    : funded ? "🔴 DIVERGED  (>3% off the main LP — let it settle / keep adds small)"
    : "🔴 STALE vs main LP (>3%) — engine pools are empty, their tick won't self-correct; a small seed must absorb the arb before a full add at the corrected price.\n");
}
main().catch((e) => { console.error("spread check failed:", e.message); process.exit(1); });
