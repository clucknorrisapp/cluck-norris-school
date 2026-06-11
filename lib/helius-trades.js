// Helius-based "who bought token X in a time window" scanner — the buy-comp's
// primary data source (replaces Solana Tracker's /trades, which is quota-billed).
// Approach: discover the token's pools via DexScreener, page each pool's tx
// signatures back to the window start, parse the txs through the Helius enhanced
// API (batched), and classify a BUY as: the fee payer's wallet had a NET INFLOW
// of the token and a NET OUTFLOW of SOL/wSOL/USDC in the same tx. volumeSol is
// the quote outflow (USDC converted at the supplied SOL price).
const WSOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

async function getTokenBuyersInWindowHelius(mint, fromMs, toMs, {
  heliusKey, heliusEnhancedBatched, solUsd = 0, maxSigPagesPerPool = 12, txCache = null,
} = {}) {
  if (!mint || !heliusKey || !heliusEnhancedBatched) return null;
  const rpcUrl = `https://mainnet.helius-rpc.com/?api-key=${heliusKey}`;
  // 1. pools via DexScreener (free)
  let pools = [];
  try {
    const dx = await (await fetch(`https://api.dexscreener.com/token-pairs/v1/solana/${mint}`, { signal: AbortSignal.timeout(8000) })).json();
    if (Array.isArray(dx)) pools = dx.map((p) => p.pairAddress).filter(Boolean);
  } catch (_) {}
  if (!pools.length) return null;

  // 2. signatures per pool, paging back until before the window start
  const sigs = new Set();
  for (const pool of pools.slice(0, 6)) {
    let before = null;
    for (let page = 0; page < maxSigPagesPerPool; page++) {
      const params = [pool, { limit: 1000, ...(before ? { before } : {}) }];
      let arr = [];
      try {
        const r = await (await fetch(rpcUrl, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: "bc-sigs", method: "getSignaturesForAddress", params }),
        })).json();
        arr = r.result || [];
      } catch (_) { break; }
      if (!arr.length) break;
      let oldest = Infinity;
      for (const s of arr) {
        const tMs = (s.blockTime || 0) * 1000;
        if (tMs < oldest) oldest = tMs;
        if (s.err) continue;
        if (tMs >= fromMs && tMs <= toMs) sigs.add(s.signature);
      }
      if (oldest < fromMs) break;            // covered the whole window for this pool
      before = arr[arr.length - 1].signature;
    }
  }
  if (!sigs.size) return { buyers: [], txsScanned: 0, source: "helius" };

  // 3. enhanced parse (batched, cached, throttled by the shared fetcher)
  const { txs } = await heliusEnhancedBatched([...sigs], heliusKey, "buycomp", txCache || new Map(), null);

  // 4. classify buys from token transfers: fee payer nets +mint and -quote
  const buyers = new Map();
  for (const tx of txs) {
    if (!tx || !tx.feePayer || !Array.isArray(tx.tokenTransfers)) continue;
    const w = tx.feePayer;
    let mintIn = 0, solOut = 0, usdcOut = 0;
    for (const t of tx.tokenTransfers) {
      const amt = Number(t.tokenAmount) || 0;
      if (t.mint === mint) {
        if (t.toUserAccount === w) mintIn += amt;
        if (t.fromUserAccount === w) mintIn -= amt;
      } else if (t.mint === WSOL) {
        if (t.fromUserAccount === w) solOut += amt;
        if (t.toUserAccount === w) solOut -= amt;
      } else if (t.mint === USDC) {
        if (t.fromUserAccount === w) usdcOut += amt;
        if (t.toUserAccount === w) usdcOut -= amt;
      }
    }
    // native SOL movement (non-wrapped) — netted from nativeTransfers
    for (const n of (tx.nativeTransfers || [])) {
      const amt = (Number(n.amount) || 0) / 1e9;
      if (n.fromUserAccount === w) solOut += amt;
      if (n.toUserAccount === w) solOut -= amt;
    }
    const quoteSol = solOut + (solUsd > 0 ? usdcOut / solUsd : 0);
    if (mintIn > 1e-9 && quoteSol > 1e-6) {     // a real buy: token in, quote out
      const cur = buyers.get(w) || { wallet: w, buyCount: 0, volumeSol: 0, maxBuySol: 0 };
      cur.buyCount++; cur.volumeSol += quoteSol;
      if (quoteSol > cur.maxBuySol) cur.maxBuySol = quoteSol;
      buyers.set(w, cur);
    }
  }
  return { buyers: [...buyers.values()], txsScanned: txs.length, source: "helius" };
}

module.exports = { getTokenBuyersInWindowHelius };
