"use strict";
// ───────────────────────────────────────────────────────────────────────────
// Premium forensics — the heavy "follow the money / follow the people" traces.
//
// PRIVATE: surfaced only via the gated /api/autopsy-premium endpoint, which
// requires PREMIUM_ACCESS_KEY. Not linked anywhere in the free product. The
// gate can later be swapped for token-gating / payment without touching any
// of this logic.
//
// This module holds the PURE aggregation/report-building. All I/O (Helius
// signature scans, Solana Tracker calls) is injected by the caller so the
// reports stay testable and fully isolated from the free autopsy code path.
//
// Feature roadmap (premium-feature-candidates memory):
//   1. recipient-dump trace      — IMPLEMENTED (buildRecipientDumpReport)
//   2. P&L Express               — IMPLEMENTED (buildPnlExpress)
//   3. creator rap sheet         — planned
//   4. wallet cluster detection  — planned
//   5. money-flow / cash-out     — planned
// ───────────────────────────────────────────────────────────────────────────

// First finite number among the candidates, else 0.
const num = (...vals) => {
  for (const v of vals) {
    if (v != null && v !== "" && !Number.isNaN(Number(v))) return Number(v);
  }
  return 0;
};

// Normalize a Solana Tracker /v2/pnl/wallets/{wallet}/tokens/{token} position
// into the shape the premium reports use. Mirrors the exact field mapping the
// free autopsy's Phase 2G cross-check uses, so numbers stay consistent.
function parseStPosition(stPos) {
  if (!stPos) return null;
  const pnl = stPos.pnl || {}, cur = stPos.current || {}, vol = stPos.volume || {},
        cnt = stPos.counts || {}, tim = stPos.timing || {};
  return {
    realizedUsd:   num(pnl.realized, stPos.realized),
    unrealizedUsd: num(pnl.unrealized, stPos.unrealized),
    buys:          num(cnt.buys, stPos.buys),
    sells:         num(cnt.sells, stPos.sells),
    balance:       num(cur.balance, stPos.balance),
    boughtUsd:     num(vol.buyUsd, stPos.totalBought),
    soldUsd:       num(vol.sellUsd, stPos.totalSold),
    investedUsd:   num(stPos.invested),
    proceedsUsd:   num(stPos.proceeds),
    roi:           num(stPos.roi),
    firstTradeTs:  tim.firstTrade || stPos.firstBuyTime || stPos.firstBuyTs || null,
    lastTradeTs:   tim.lastTrade  || stPos.lastTradeTime || stPos.lastTradeTs || null,
  };
}

// ── Feature #1: Recipient-dump trace ──────────────────────────────────────
// The free tier flags THAT the creator funneled tokens out to N wallets.
// Premium opens the door: for each recipient wallet we pull its Solana Tracker
// position on this mint and show whether it SOLD, how much, and the proceeds.
// "0 market sells from the creator" is exactly the hidden-exit this proves.
//
// recipients: [{ wallet, tokensReceived, position(parsed|null) }]
function buildRecipientDumpReport({ creatorWallet, mint, recipients, supplyTokens, priceCrashTs }) {
  const rows = recipients.map(r => {
    const type = r.accountType || "wallet";
    // People (a real wallet OR an airdrop recipient) get sell analysis; LP/locks/programs can't "sell".
    const isPerson = type === "wallet" || type === "airdrop";
    const p = isPerson ? r.position : null;
    const sells = p ? p.sells : null;
    const balance = p ? p.balance : null;
    const fullyExited = p ? (p.sells > 0 && p.balance <= 0.0000001) : false;
    const partiallySold = p ? (p.sells > 0 && p.balance > 0.0000001) : false;
    const proceedsUsd = p ? Math.round(num(p.proceedsUsd, p.soldUsd)) : null;
    const soldAfterCrash = (priceCrashTs && p && p.lastTradeTs)
      ? (p.lastTradeTs * (p.lastTradeTs > 1e12 ? 1 : 1000)) >= priceCrashTs
      : null;
    return {
      wallet: r.wallet,
      accountType: type,
      accountLabel: r.accountLabel || "Wallet",
      tokensReceived: Math.round(r.tokensReceived),
      shareOfSupplyPct: supplyTokens > 0 ? Number((r.tokensReceived / supplyTokens * 100).toFixed(2)) : null,
      sells, proceedsUsd,
      currentBalance: balance != null ? Math.round(balance) : null,
      // Non-person destinations show their LABEL (LP / lock / program), not a sell verdict.
      status: !isPerson ? (r.accountLabel || "contract")
        : !p ? "no-st-data"
        : fullyExited ? "FULLY EXITED"
        : partiallySold ? "partially sold"
        : sells === 0 ? "holding (no sells)"
        : "unknown",
      soldAfterCrash,
      lastTradeTs: p ? p.lastTradeTs : null,
      hasStData: !!p,
    };
  }).sort((a, b) => (b.proceedsUsd || 0) - (a.proceedsUsd || 0));

  const walletRows = rows.filter(r => r.accountType === "wallet");     // genuine individual recipients (the real "funnel" signal)
  const airdropRows = rows.filter(r => r.accountType === "airdrop");   // batch-distribution recipients
  const contractRows = rows.filter(r => r.accountType !== "wallet" && r.accountType !== "airdrop");
  const sumTokens = (arr) => arr.reduce((s, r) => s + r.tokensReceived, 0);
  const totalFunneled = recipients.reduce((s, r) => s + r.tokensReceived, 0);
  const toContractsTokens = sumTokens(contractRows);
  const airdroppedTokens = sumTokens(airdropRows);
  const toWalletsTokens = sumTokens(walletRows);
  // Dump verdict is over GENUINE individual wallets only — not airdrops, LP, or locks.
  const totalProceedsUsd = walletRows.reduce((s, r) => s + (r.proceedsUsd || 0), 0);
  const soldCount = walletRows.filter(r => (r.sells || 0) > 0).length;
  const exitedCount = walletRows.filter(r => r.status === "FULLY EXITED").length;
  const walletsChecked = walletRows.filter(r => r.hasStData).length;
  const anySold = soldCount > 0;
  const airdropSold = airdropRows.filter(r => (r.sells || 0) > 0).length;
  const contractDesc = contractRows.length
    ? `${contractRows.length} destination(s) holding ${Math.round(toContractsTokens).toLocaleString()} tokens are LP pools / token locks / programs (labeled — not a dump)`
    : "";
  const airdropDesc = airdropRows.length
    ? `${Math.round(airdroppedTokens).toLocaleString()} tokens went to ${airdropRows.length} wallet(s) in equal-amount BATCH sends — a distribution pattern to EXAMINE (a legitimate airdrop/reward OR a coordinated/sybil set${airdropSold ? `; ${airdropSold} have since sold` : ""})`
    : "";

  return {
    feature: "recipient-dump-trace",
    status: "computed",
    creatorWallet, mint,
    recipientCount: recipients.length,
    walletRecipientCount: walletRows.length,
    airdropRecipientCount: airdropRows.length,
    contractRecipientCount: contractRows.length,
    recipientsTraced: walletsChecked,
    totalFunneledTokens: Math.round(totalFunneled),
    tokensToWallets: Math.round(toWalletsTokens),
    tokensAirdropped: Math.round(airdroppedTokens),
    tokensToContracts: Math.round(toContractsTokens),
    funneledShareOfSupplyPct: supplyTokens > 0 ? Number((totalFunneled / supplyTokens * 100).toFixed(2)) : null,
    recipientsWhoSold: soldCount,
    recipientsWhoFullyExited: exitedCount,
    totalProceedsUsd: Math.round(totalProceedsUsd),
    verdict: walletRows.length === 0
      ? (airdropRows.length > 0 ? "BATCH_DISTRIBUTION_REVIEW" : "ALL_TO_LP_LOCKS_POOLS")
      : !anySold
        ? (walletsChecked < walletRows.length ? "NO_SELLS_AMONG_CHECKED" : "NO_DOWNSTREAM_SELLS")
        : totalProceedsUsd > 0 ? "PROVEN_DOWNSTREAM_DUMP" : "DOWNSTREAM_SELLS_DETECTED",
    summary: walletRows.length === 0
      ? `No covert funnel to a few individuals${airdropRows.length ? `, but a BATCH DISTRIBUTION is present — examine it: ${airdropDesc}` : ""}${contractRows.length ? `${airdropRows.length ? ". Also, " : ". "}${contractDesc}` : ""}. Equal amounts to many wallets can be a legit airdrop OR coordination — the chain shows the pattern, not the intent.`
      : !anySold
        ? `${Math.round(toWalletsTokens).toLocaleString()} tokens went to ${walletRows.length} individual wallet(s); ${walletsChecked} had Solana Tracker data and NONE sold${walletRows.length - walletsChecked > 0 ? ` (${walletRows.length - walletsChecked} unknown — no indexer data)` : ""}.${airdropRows.length ? ` Separately, a batch distribution: ${airdropDesc}.` : ""}${contractRows.length ? ` ${contractDesc}.` : ""}`
        : `Of ${Math.round(toWalletsTokens).toLocaleString()} tokens to ${walletRows.length} individual wallet(s), ${soldCount} sold (${exitedCount} fully exited), extracting ~$${Math.round(totalProceedsUsd).toLocaleString()} downstream.${airdropRows.length ? ` Separately, a batch distribution to examine: ${airdropDesc}.` : ""}${contractRows.length ? ` ${contractDesc}.` : ""} LP & locks are excluded from this sell count.`,
    note: "Cross-referenced against the autopsy classifier + batch-send detection. EQUAL-AMOUNT BATCH SENDS (one tx → many recipients) are flagged as a 'batch distribution' to EXAMINE — same amount to many wallets can be a legit airdrop/reward OR a coordinated/sybil set, so the tool surfaces the pattern (and whether recipients sold) without judging intent. LP pools, token locks, and programs are labeled and excluded from the dump count. Only genuine individual recipients are checked for downstream dumping; no-st-data = unknown, not proven.",
    rows,
  };
}

// ── Feature #2: P&L Express ────────────────────────────────────────────────
// The full wallet P&L ledger that was pulled from the free autopsy (Phase 2F)
// for rate-limit reasons. Solana Tracker's /v2/pnl/tokens/{token}/traders does
// the P&L for us, so this is a cheap-but-premium surface: winners, losers,
// biggest sellers, cash-out wallets.
//
// traders: raw ST /traders response (array, or { wallets|traders|data: [] }).
function buildPnlExpress(traders) {
  const list = Array.isArray(traders) ? traders
    : (traders && (traders.wallets || traders.traders || traders.data)) || [];
  if (!Array.isArray(list) || list.length === 0) {
    return { feature: "pnl-express", status: "no-data", note: "Solana Tracker returned no trader P&L for this token." };
  }
  const norm = list.map(t => {
    const pnl = t.pnl || {}, vol = t.volume || {}, cur = t.current || {}, cnt = t.counts || {};
    return {
      wallet: t.wallet || t.address || t.owner || null,
      realizedUsd:   Math.round(num(pnl.realized, t.realized)),
      unrealizedUsd: Math.round(num(pnl.unrealized, t.unrealized)),
      totalUsd:      Math.round(num(pnl.total, t.total, num(pnl.realized) + num(pnl.unrealized))),
      investedUsd:   Math.round(num(t.invested, vol.buyUsd)),
      soldUsd:       Math.round(num(t.proceeds, vol.sellUsd, t.totalSold)),
      buys:          num(cnt.buys, t.buys),
      sells:         num(cnt.sells, t.sells),
      balance:       num(cur.balance, t.balance),
      roi:           num(t.roi),
    };
  }).filter(t => t.wallet);

  const byRealizedDesc = [...norm].sort((a, b) => b.realizedUsd - a.realizedUsd);
  const cashedOut = norm.filter(t => t.sells > 0 && t.balance <= 0.0000001 && t.realizedUsd > 0)
    .sort((a, b) => b.realizedUsd - a.realizedUsd);
  return {
    feature: "pnl-express",
    status: "computed",
    walletsAnalyzed: norm.length,
    biggestWinners: byRealizedDesc.slice(0, 10),
    biggestLosers: byRealizedDesc.slice(-10).reverse(),
    biggestSellers: [...norm].sort((a, b) => b.soldUsd - a.soldUsd).slice(0, 10),
    cashOutWallets: cashedOut.slice(0, 10),
    cashOutCount: cashedOut.length,
    note: "Lifetime realized/unrealized P&L per wallet, priced by Solana Tracker. cashOutWallets = wallets that sold their entire position for a realized profit and walked.",
  };
}

// ── Feature #3: Creator Rap Sheet ──────────────────────────────────────────
// Every token the on-chain deployer has launched, and how each one ended.
// Turns "deployed N tokens" into "...and here's the body count." Built from a
// single Solana Tracker /deployer call (each item carries the token's current
// liquidity/MC/volume/status), so it's cheap. Outcome per token is classified
// from its live state. Bags' platform deployer launches thousands, so we flag
// isPlatformLauncher and tell the reader NOT to attribute it to one dev.
const PLATFORM_DEPLOYERS = new Set([
  "BAGSB9TpGrZxQbEsrEznv5jXXdwyP6AXerN8aVRiAmcv", // Bags.fm program launcher
]);
function classifyLaunchOutcome(t) {
  const liq = num(t.liquidityUsd), vol24 = num(t.volume_24h);
  const ageMs = t.createdAt ? Date.now() - t.createdAt : null;
  const olderThanDay = ageMs != null && ageMs > 86400000;
  if (t.status === "graduated") {
    if (liq >= 5000 && vol24 > 50) return "ALIVE_GRADUATED";
    if (liq < 500) return "GRADUATED_THEN_DIED";
    return "GRADUATED_FADING";
  }
  if (liq < 500 && olderThanDay) return "DEAD_OR_RUGGED";
  if (liq >= 5000 && vol24 > 50) return "ALIVE";
  if (liq >= 500) return "FADING";
  if (!olderThanDay) return "TOO_NEW";
  return "DEAD_OR_RUGGED";
}
function buildCreatorRapSheet({ deployerWallet, total, totalUniqueTokens, tokens }) {
  const isPlatform = PLATFORM_DEPLOYERS.has(deployerWallet) || (total != null && total > 200);
  const rows = (tokens || []).map(t => ({
    mint: t.mint,
    name: t.name,
    symbol: t.symbol,
    status: t.status || null,
    liquidityUsd: Math.round(num(t.liquidityUsd)),
    marketCapUsd: Math.round(num(t.marketCapUsd)),
    volume24h: Math.round(num(t.volume_24h)),
    holders: t.holders != null ? t.holders : null,
    riskScore: t.riskScore != null ? t.riskScore : null,
    top10Pct: t.top10 != null ? Number(num(t.top10).toFixed(1)) : null,
    snipersPct: t.snipers != null ? Number(num(t.snipers).toFixed(1)) : null,
    createdAt: t.createdAt || null,
    creator: t.creator || null,
    outcome: classifyLaunchOutcome(t),
  })).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  const counts = {};
  for (const r of rows) counts[r.outcome] = (counts[r.outcome] || 0) + 1;
  const analyzed = rows.length;
  const alive = rows.filter(r => r.outcome === "ALIVE" || r.outcome === "ALIVE_GRADUATED").length;
  const dead = rows.filter(r => r.outcome === "DEAD_OR_RUGGED" || r.outcome === "GRADUATED_THEN_DIED").length;
  const verdict = isPlatform ? "PLATFORM_LAUNCHER"
    : (total || 0) >= 25 ? "SERIAL_DEPLOYER"
    : (total || 0) >= 2 ? "REPEAT_LAUNCHER"
    : "FIRST_OR_SINGLE_LAUNCH";

  return {
    feature: "creator-rap-sheet",
    status: "computed",
    deployerWallet,
    totalLaunched: total,
    totalUniqueTokens: totalUniqueTokens != null ? totalUniqueTokens : null,
    analyzed,
    isPlatformLauncher: isPlatform,
    verdict,
    outcomeCounts: counts,
    aliveCount: alive,
    deadOrRuggedCount: dead,
    survivalRatePct: analyzed ? Number((alive / analyzed * 100).toFixed(0)) : null,
    diedRatePct: analyzed ? Number((dead / analyzed * 100).toFixed(0)) : null,
    summary: isPlatform
      ? `Deployer is a PLATFORM/mass launcher (${total != null ? total.toLocaleString() : "200+"} tokens) — this is the launchpad's program wallet, NOT one dev's record. Do not attribute these outcomes to the token's actual team.`
      : analyzed === 0
        ? `No prior launches indexed for this deployer.`
        : `This deployer has launched ${total != null ? total.toLocaleString() : analyzed} token(s); of the ${analyzed} analyzed, ${alive} still alive and ${dead} dead/rugged (${analyzed ? Math.round(dead / analyzed * 100) : 0}% died).`,
    note: "Outcomes classified from each token's CURRENT on-chain state (liquidity, 24h volume, graduation status). 'DEAD_OR_RUGGED' means collapsed liquidity on a >1-day-old token — it does not by itself prove intent. A high died-rate from a non-platform wallet is a serial-failure / mill signal.",
    rows: rows.slice(0, 50),
  };
}

// ── Feature #5: Money-flow / cash-out trace ────────────────────────────────
// Follow the creator's SOL out the door: how much they pulled in (fees), how
// much went straight to a centralized exchange (a confirmed cash-out), and how
// much went to other wallets (operational, OTC, or a hop toward a CEX). Built
// from the SAME creator-tx scan the recipient-dump uses (nativeTransfers), so
// it's free once that scan has run.
const KNOWN_CEX = {
  "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM": "Coinbase",
  "H8sMJSCQxfKiFTCfDR3DUMLPwcRbM61LGFJ8N4dK3WjS": "Coinbase",
  "2ojv9BAiHUrvsm9gxDe7fJSzbNZSJcxZvf8dqmWGHG8S": "Binance",
  "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9": "Binance",
};
// solOutByDest: array of [wallet, lamports]. claimedFeesSol: from Bags context.
function buildMoneyFlow({ creatorWallet, solOutByDest, solInByDest, solInLamports, claimedFeesSol, destTypes }) {
  const typeOf = (w) => (destTypes && (typeof destTypes.get === "function" ? destTypes.get(w) : destTypes[w])) || null;
  const inMap = new Map((solInByDest || []).map(([w, l]) => [w, Number(l)]));
  // NET per counterparty: SOL out to X minus SOL back in from X. This cancels
  // round-trips — the Bags fee-claim 1-SOL float (BagsFeeShares fronts 1 SOL,
  // repaid in the same tx), swap/LP routing, etc. — so they don't read as a
  // cash-out. Only genuine NET outflows survive.
  const rows = (solOutByDest || []).map(([wallet, lamports]) => {
    const grossOut = Number(lamports);
    const net = grossOut - (inMap.get(wallet) || 0);
    const t = typeOf(wallet);
    const isCex = !!KNOWN_CEX[wallet];
    return {
      wallet,
      sol: Number((net / 1e9).toFixed(3)),                 // NET out to this counterparty
      grossSol: Number((grossOut / 1e9).toFixed(3)),
      cex: KNOWN_CEX[wallet] || null,
      isCex,
      accountType: isCex ? "cex" : (t ? t.category : "wallet"),
      accountLabel: isCex ? KNOWN_CEX[wallet] : (t ? t.label : "Wallet"),
    };
  }).filter(r => r.sol > 0.0005).sort((a, b) => b.sol - a.sol);   // real net outflows only

  const grossOutTotal = (solOutByDest || []).reduce((s, [, l]) => s + Number(l), 0) / 1e9;
  const netOut = rows.reduce((s, r) => s + r.sol, 0);
  const toCex = rows.filter(r => r.isCex).reduce((s, r) => s + r.sol, 0);
  const toContracts = rows.filter(r => !r.isCex && r.accountType !== "wallet").reduce((s, r) => s + r.sol, 0);
  const toWallets = netOut - toCex - toContracts;
  const walletDests = rows.filter(r => !r.isCex && r.accountType === "wallet").length;
  const roundTripped = Number((grossOutTotal - netOut).toFixed(3));   // gross that cancelled out
  return {
    feature: "money-flow-cashout",
    status: "computed",
    creatorWallet,
    solIn: solInLamports != null ? Number((Number(solInLamports) / 1e9).toFixed(3)) : null,
    claimedFeesSol: claimedFeesSol != null ? Number(Number(claimedFeesSol).toFixed(3)) : null,
    grossSolOut: Number(grossOutTotal.toFixed(3)),
    netSolOut: Number(netOut.toFixed(3)),
    roundTrippedSol: roundTripped,
    solToCex: Number(toCex.toFixed(3)),
    solToContracts: Number(toContracts.toFixed(3)),
    solToWallets: Number(toWallets.toFixed(3)),
    destinationCount: rows.length,
    directCexCashOut: toCex > 0,
    verdict: netOut <= 0.001 ? "NO_NET_SOL_LEFT" : toCex > 0 ? "NET_CEX_CASH_OUT" : "NET_SOL_OUT",
    summary: netOut <= 0.001
      ? `No NET SOL left this wallet. ~${grossOutTotal.toFixed(1)} SOL of gross transfers all round-tripped back — e.g. Bags fee-claim 1-SOL floats (the platform fronts 1 SOL per claim, repaid in the same tx) and swap/LP routing. Nothing was actually cashed out.`
      : toCex > 0
        ? `NET ~${netOut.toFixed(1)} SOL left the wallet, including ~${toCex.toFixed(1)} SOL to a known exchange (confirmed cash-out). ~${roundTripped.toFixed(1)} SOL of gross flow round-tripped and was excluded.`
        : `NET ~${netOut.toFixed(1)} SOL left the wallet to ${walletDests} wallet(s)/${rows.length} destination(s); no direct CEX in the window. ~${roundTripped.toFixed(1)} SOL of gross flow round-tripped (fee-claim floats / routing) and was excluded.`,
    note: "NET per counterparty: SOL out minus SOL back, per address. This cancels round-trips like the Bags fee-claim 1-SOL float (the BagsFeeShares program fronts 1 SOL and is repaid in the same transaction — common to EVERY Bags creator) and swap/LP routing, so they don't read as a cash-out. Only net outflows are shown. A net deposit to a known CEX is a confirmed cash-out; net SOL to other wallets may be operational, OTC, or a hop.",
    rows: rows.slice(0, 30),
  };
}

// ── Feature #4: Wallet clusters (NEUTRAL funding-source map) ────────────────
// Groups top holders that trace to a COMMON funding wallet. CRITICAL: this is
// a PATTERN, never a verdict. A shared funder is most often a presale group, a
// post-launch airdrop, team distribution, or a CEX batch withdrawal — and only
// SOMETIMES a coordinated ring. On-chain data cannot tell these apart, so we
// state the fact and list the innocent explanations. We never label a cluster
// a "ring." (Chain shows WHAT, never WHY.)
// holders: [{ wallet, tokensHeld, funder|null, fundingTooDeep }]
function buildWalletClusters({ holders }) {
  const byFunder = new Map();
  for (const h of (holders || [])) {
    if (!h.funder) continue;
    if (!byFunder.has(h.funder)) byFunder.set(h.funder, []);
    byFunder.get(h.funder).push(h);
  }
  const clusters = [...byFunder.entries()]
    .filter(([, ws]) => ws.length >= 2)
    .map(([funder, ws]) => ({
      funder,
      cexFunder: !!KNOWN_CEX[funder],
      cexName: KNOWN_CEX[funder] || null,
      walletCount: ws.length,
      wallets: ws.map(w => ({ wallet: w.wallet, tokensHeld: Math.round(w.tokensHeld) })),
    }))
    .sort((a, b) => b.walletCount - a.walletCount);
  const analyzed = (holders || []).length;
  const resolved = (holders || []).filter(h => h.funder).length;
  const tooDeep = (holders || []).filter(h => h.fundingTooDeep).length;
  // Clusters whose common source is a known exchange are almost certainly
  // independent users (CEX withdrawals), not coordination — separate them out.
  const nonCexClusters = clusters.filter(c => !c.cexFunder);
  return {
    feature: "wallet-clusters",
    status: "computed",
    holdersAnalyzed: analyzed,
    fundingResolved: resolved,
    fundingUnreachable: tooDeep,
    clusterCount: clusters.length,
    nonCexClusterCount: nonCexClusters.length,
    largestClusterSize: clusters.length ? clusters[0].walletCount : 0,
    clusters: clusters.slice(0, 15),
    summary: clusters.length === 0
      ? `No shared-funding clusters among the ${analyzed} top holders checked (funding resolved for ${resolved}${tooDeep ? `, ${tooDeep} too active to trace` : ''}).`
      : `${clusters.length} group(s) of top holders share a common funding wallet (largest: ${clusters[0].walletCount}). ${nonCexClusters.length} are non-exchange sources. This is a PATTERN to investigate, NOT a verdict.`,
    note: "A shared funder is NEUTRAL. It most commonly means a PRESALE group, a post-launch AIRDROP, TEAM distribution, or a CEX BATCH withdrawal — and only sometimes a coordinated ring. On-chain data cannot distinguish them, so this is a research lead, never proof. cexFunder=true ⇒ the common source is a known exchange (independent users withdrawing, essentially never coordination). fundingUnreachable = wallets too active to trace to their first funder within the scan cap.",
  };
}

module.exports = {
  parseStPosition,
  buildRecipientDumpReport,
  buildPnlExpress,
  buildCreatorRapSheet,
  classifyLaunchOutcome,
  buildMoneyFlow,
  buildWalletClusters,
  KNOWN_CEX,
  _num: num,
};
