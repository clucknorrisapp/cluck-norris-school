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
  heliusKey, heliusEnhancedBatched, solUsd = 0, tokenPriceUsd = 0, maxSigPagesPerPool = 12, txCache = null,
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
    const quoteOutSol = solOut + (solUsd > 0 ? usdcOut / solUsd : 0);
    // Real buy = token IN + quote OUT. Value it by the TOKENS RECEIVED * price (the
    // actual buy size), capped at the quote actually spent — never the wallet's raw
    // SOL throughput, which balloons on multi-hop swaps, wSOL wrapping, and arb.
    if (mintIn > 1e-9 && quoteOutSol > 1e-9) {
      const tokenValueSol = (tokenPriceUsd > 0 && solUsd > 0) ? (mintIn * tokenPriceUsd) / solUsd : quoteOutSol;
      const buySol = Math.min(tokenValueSol, quoteOutSol);
      const cur = buyers.get(w) || { wallet: w, buyCount: 0, volumeSol: 0, maxBuySol: 0 };
      cur.buyCount++; cur.volumeSol += buySol;
      if (buySol > cur.maxBuySol) cur.maxBuySol = buySol;
      buyers.set(w, cur);
    }
  }
  return { buyers: [...buyers.values()], txsScanned: txs.length, source: "helius" };
}

// Helius equivalent of ST's getWalletTokenPosition — for the buy-comp / buyspecial
// 48h HOLD check. Returns { balance, sells, transfersOut } in the same shape the
// verify logic expects (parseStPosition gives {sells, balance}). balance from
// getTokenAccountsByOwner; sells/transfers from parsing the token account's txns:
// a SELL = wallet net -token and +SOL/USDC in one tx; a TRANSFER-OUT = net -token
// with no quote in (moved to another wallet — the "transferred out" manual flag).
async function getWalletTokenPositionHelius(wallet, mint, {
  heliusKey, heliusEnhancedBatched, maxSigPages = 3, txCache = null,
} = {}) {
  if (!wallet || !mint || !heliusKey || !heliusEnhancedBatched) return null;
  const rpcUrl = `https://mainnet.helius-rpc.com/?api-key=${heliusKey}`;
  const rpc = async (method, params) => {
    const r = await (await fetch(rpcUrl, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "wp", method, params }),
    })).json();
    return r.result;
  };
  // 1. current balance + the token-account address(es)
  let balance = 0; const tokenAccounts = [];
  try {
    const res = await rpc("getTokenAccountsByOwner", [wallet, { mint }, { encoding: "jsonParsed" }]);
    for (const a of ((res && res.value) || [])) {
      tokenAccounts.push(a.pubkey);
      balance += Number(a.account?.data?.parsed?.info?.tokenAmount?.uiAmount) || 0;
    }
  } catch (_) { return null; }
  // 2. signatures touching those token accounts (closed-out wallets have none → balance 0)
  const sigs = new Set();
  for (const ta of tokenAccounts) {
    let before = null;
    for (let p = 0; p < maxSigPages; p++) {
      let arr = [];
      try { arr = await rpc("getSignaturesForAddress", [ta, { limit: 1000, ...(before ? { before } : {}) }]) || []; } catch (_) { break; }
      if (!arr.length) break;
      for (const s of arr) if (!s.err) sigs.add(s.signature);
      if (arr.length < 1000) break;
      before = arr[arr.length - 1].signature;
    }
  }
  let sells = 0, transfersOut = 0;
  if (sigs.size) {
    const { txs } = await heliusEnhancedBatched([...sigs], heliusKey, "wp", txCache || new Map(), null);
    for (const tx of txs) {
      if (!tx || tx.feePayer !== wallet || !Array.isArray(tx.tokenTransfers)) continue;
      let mintOut = 0, quoteIn = 0;
      for (const t of tx.tokenTransfers) {
        const amt = Number(t.tokenAmount) || 0;
        if (t.mint === mint) { if (t.fromUserAccount === wallet) mintOut += amt; if (t.toUserAccount === wallet) mintOut -= amt; }
        else if (t.mint === WSOL || t.mint === USDC) { if (t.toUserAccount === wallet) quoteIn += amt; }
      }
      for (const n of (tx.nativeTransfers || [])) { if (n.toUserAccount === wallet) quoteIn += (Number(n.amount) || 0) / 1e9; }
      if (mintOut > 1e-9) { if (quoteIn > 1e-6) sells++; else transfersOut++; }
    }
  }
  return { balance, sells, transfersOut, source: "helius" };
}

module.exports = { getTokenBuyersInWindowHelius, getWalletTokenPositionHelius };
