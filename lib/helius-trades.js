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
  const rpcCall = async (method, params) => {
    const r = await (await fetch(rpcUrl, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "bc-disc", method, params }),
    })).json();
    return r.result;
  };

  // 1. Discover what to scan — ON-CHAIN FIRST, no indexer dependency.
  // A token's pool-routed swaps land in its AMM pool VAULTS — the token accounts that
  // hold the most of its supply — which are visible purely on-chain via
  // getTokenLargestAccounts. Scanning those vaults' signatures captures every swap,
  // whether or not DexScreener/GeckoTerminal indexes the token (ROSE, e.g., returns 0
  // DexScreener pairs but its vaults are right there on-chain). DexScreener pairs are
  // ADDED as a union supplement for any pool whose vault isn't in the top balances —
  // but the scanner no longer DEPENDS on any indexer to see buys.
  const targets = new Set();
  try {
    const largest = await rpcCall("getTokenLargestAccounts", [mint]);
    for (const a of ((largest && largest.value) || [])) if (a && a.address) targets.add(a.address);
  } catch (_) {}
  try {
    const dx = await (await fetch(`https://api.dexscreener.com/token-pairs/v1/solana/${mint}`, { signal: AbortSignal.timeout(8000) })).json();
    if (Array.isArray(dx)) for (const p of dx) if (p && p.pairAddress) targets.add(p.pairAddress);
  } catch (_) {}
  if (!targets.size) return null;

  // 2. signatures per target, paging back until before the window start.
  // Coverage caps: top 10 accounts, maxSigPagesPerPool pages (12k sigs) each — plenty for
  // normal tokens, but a hyperactive token can truncate. reachedWindowStart reports
  // honestly whether EVERY scanned target got back to the window start (or end of its
  // history); false = the oldest in-window buys may be missing.
  const sigs = new Set();
  let reachedWindowStart = true;
  for (const pool of [...targets].slice(0, 10)) {
    let before = null;
    let covered = false;
    for (let page = 0; page < maxSigPagesPerPool; page++) {
      const params = [pool, { limit: 1000, ...(before ? { before } : {}) }];
      let arr = [];
      try {
        const r = await (await fetch(rpcUrl, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: "bc-sigs", method: "getSignaturesForAddress", params }),
        })).json();
        arr = r.result || [];
      } catch (_) { break; }                   // fetch error → coverage unknown, not covered
      if (!arr.length) { covered = true; break; }   // ran out of history → fully covered
      let oldest = Infinity;
      for (const s of arr) {
        const tMs = (s.blockTime || 0) * 1000;
        if (tMs < oldest) oldest = tMs;
        if (s.err) continue;
        if (tMs >= fromMs && tMs <= toMs) sigs.add(s.signature);
      }
      if (oldest < fromMs) { covered = true; break; }   // paged past the window start
      if (arr.length < 1000) { covered = true; break; } // short page = end of history
      before = arr[arr.length - 1].signature;
    }
    if (!covered) reachedWindowStart = false;
  }
  if (!sigs.size) return { buyers: [], txsScanned: 0, source: "helius", reachedWindowStart };

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
    // Known skew: tokenPriceUsd is a single CURRENT-price snapshot, not the buy-time
    // price — fine for short comps, but over a long window early buys get revalued
    // at the latest price (the quote-spent cap bounds it from above only).
    if (mintIn > 1e-9 && quoteOutSol > 1e-9) {
      const tokenValueSol = (tokenPriceUsd > 0 && solUsd > 0) ? (mintIn * tokenPriceUsd) / solUsd : quoteOutSol;
      const buySol = Math.min(tokenValueSol, quoteOutSol);
      const cur = buyers.get(w) || { wallet: w, buyCount: 0, volumeSol: 0, maxBuySol: 0, tokensBought: 0 };
      cur.buyCount++; cur.volumeSol += buySol; cur.tokensBought += mintIn;   // token amount received (for pct-of-token payouts)
      if (buySol > cur.maxBuySol) cur.maxBuySol = buySol;
      buyers.set(w, cur);
    }
  }
  return { buyers: [...buyers.values()], txsScanned: txs.length, source: "helius", reachedWindowStart };
}

// Helius equivalent of ST's getWalletTokenPosition — for the buy-comp / buyspecial
// 48h HOLD check. Returns { balance, sells, transfersOut } in the same shape the
// verify logic expects (parseStPosition gives {sells, balance}). balance from
// getTokenAccountsByOwner; sells/transfers from parsing the token account's txns:
// a SELL = wallet net -token and +SOL/USDC in one tx; a TRANSFER-OUT = net -token
// with no quote in (moved to another wallet — the "transferred out" manual flag).
// Optional fromMs/toMs scope the sell/transfer count to a time window (e.g. a buy
// competition's window) — when set, only sells whose tx timestamp falls inside the
// window are counted. Unset (the default, used by the 48h hold check) = all-time.
// Coverage cap: maxSigPages pages (3k sigs) per token account — a wallet with a
// deeper history than that on this token could have older sells missed.
async function getWalletTokenPositionHelius(wallet, mint, {
  heliusKey, heliusEnhancedBatched, maxSigPages = 3, txCache = null, fromMs = null, toMs = null,
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
  const transferDests = {};   // destination WALLET -> total mint amount moved there (non-sell transfers)
  if (sigs.size) {
    const { txs } = await heliusEnhancedBatched([...sigs], heliusKey, "wp", txCache || new Map(), null);
    for (const tx of txs) {
      if (!tx || tx.feePayer !== wallet || !Array.isArray(tx.tokenTransfers)) continue;
      // Window scope: tx.timestamp is unix seconds. If a window is requested and the tx
      // can't be placed inside it (or has no timestamp), skip it — never risk counting a
      // pre-window sell against an in-window rule.
      if (fromMs != null || toMs != null) {
        const tsMs = (Number(tx.timestamp) || 0) * 1000;
        if (!tsMs) continue;
        if (fromMs != null && tsMs < fromMs) continue;
        if (toMs != null && tsMs > toMs) continue;
      }
      let mintOut = 0, quoteIn = 0; const outTo = {};   // recipient wallet -> mint amount, this tx
      for (const t of tx.tokenTransfers) {
        const amt = Number(t.tokenAmount) || 0;
        if (t.mint === mint) {
          if (t.fromUserAccount === wallet) { mintOut += amt; if (t.toUserAccount && t.toUserAccount !== wallet) outTo[t.toUserAccount] = (outTo[t.toUserAccount] || 0) + amt; }
          if (t.toUserAccount === wallet) mintOut -= amt;
        } else if (t.mint === WSOL || t.mint === USDC) { if (t.toUserAccount === wallet) quoteIn += amt; }
      }
      for (const n of (tx.nativeTransfers || [])) { if (n.toUserAccount === wallet) quoteIn += (Number(n.amount) || 0) / 1e9; }
      if (mintOut > 1e-9) {
        if (quoteIn > 1e-6) sells++;
        else { transfersOut++; for (const [to, a] of Object.entries(outTo)) transferDests[to] = (transferDests[to] || 0) + a; }
      }
    }
  }
  // transferDests as a sorted [{ to, amount }] list (biggest first) for one-hop payout tracing.
  const dests = Object.entries(transferDests).map(([to, amount]) => ({ to, amount })).sort((a, b) => b.amount - a.amount);
  return { balance, sells, transfersOut, transferDests: dests, source: "helius" };
}

// Full trade TAPE for a token in a window — classifies EACH swap as buy/sell from
// the fee payer's net token+quote movement, returning a time-sorted list. Powers
// flow stats + reactive-sell detection (a sell firing seconds after a buy = the
// off-chain bot pattern resting-order scans can't see). Same pool-sig + enhanced-
// parse approach as the buyers scanner.
async function getTradeTapeHelius(mint, fromMs, toMs, {
  heliusKey, heliusEnhancedBatched, solUsd = 0, tokenPriceUsd = 0, maxSigPagesPerPool = 4, maxSigs = 900, txCache = null,
} = {}) {
  if (!mint || !heliusKey || !heliusEnhancedBatched) return null;
  const rpcUrl = `https://mainnet.helius-rpc.com/?api-key=${heliusKey}`;
  const rpcCall = async (method, params) => {
    const r = await (await fetch(rpcUrl, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "tape-disc", method, params }),
    })).json();
    return r.result;
  };
  // ON-CHAIN FIRST pool discovery (see getTokenBuyersInWindowHelius) — the token's pool
  // vaults are its largest on-chain accounts, so we never go blind on a token DexScreener
  // doesn't index; DexScreener pairs are a union supplement.
  const targets = new Set();
  try {
    const largest = await rpcCall("getTokenLargestAccounts", [mint]);
    for (const a of ((largest && largest.value) || [])) if (a && a.address) targets.add(a.address);
  } catch (_) {}
  try {
    const dx = await (await fetch(`https://api.dexscreener.com/token-pairs/v1/solana/${mint}`, { signal: AbortSignal.timeout(8000) })).json();
    if (Array.isArray(dx)) for (const p of dx) if (p && p.pairAddress) targets.add(p.pairAddress);
  } catch (_) {}
  if (!targets.size) return null;
  const sigs = new Set();
  let capped = false;
  outer:
  for (const pool of [...targets].slice(0, 10)) {
    let before = null;
    for (let page = 0; page < maxSigPagesPerPool; page++) {
      let arr = [];
      try {
        const r = await (await fetch(rpcUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: "tape-sigs", method: "getSignaturesForAddress", params: [pool, { limit: 1000, ...(before ? { before } : {}) }] }) })).json();
        arr = r.result || [];
      } catch (_) { break; }
      if (!arr.length) break;
      let oldest = Infinity;
      for (const s of arr) { const tMs = (s.blockTime || 0) * 1000; if (tMs < oldest) oldest = tMs; if (s.err) continue; if (tMs >= fromMs && tMs <= toMs) { sigs.add(s.signature); if (sigs.size >= maxSigs) { capped = true; break outer; } } }
      if (oldest < fromMs || arr.length < 1000) break;
      before = arr[arr.length - 1].signature;
    }
  }
  if (!sigs.size) return { trades: [], txsScanned: 0, capped };
  const { txs } = await heliusEnhancedBatched([...sigs], heliusKey, "tape", txCache || new Map(), null);
  // Count ANY common quote leaving/entering the wallet (SOL, USDC, USDT, JUP) — a
  // multi-quote token (e.g. CLKN/JUP) is otherwise invisible. Direction (spent vs
  // received quote) is per-asset so multi-quote swaps classify correctly; value
  // comes from the token leg × price (robust across quotes). Net-neutral txs (arb,
  // LP) move no quote on net → correctly skipped.
  const QUOTES = { "So11111111111111111111111111111111111111112": 1, "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v": 1, "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB": 1, "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN": 1 };
  const trades = [];
  for (const tx of txs) {
    if (!tx || !tx.feePayer || !Array.isArray(tx.tokenTransfers)) continue;
    const w = tx.feePayer; let mintNet = 0; const qNet = {};
    for (const t of tx.tokenTransfers) {
      const amt = Number(t.tokenAmount) || 0;
      if (t.mint === mint) { if (t.toUserAccount === w) mintNet += amt; if (t.fromUserAccount === w) mintNet -= amt; }
      else if (QUOTES[t.mint]) { qNet[t.mint] = (qNet[t.mint] || 0) + (t.fromUserAccount === w ? amt : 0) - (t.toUserAccount === w ? amt : 0); }
    }
    for (const n of (tx.nativeTransfers || [])) { const amt = (Number(n.amount) || 0) / 1e9; const k = "So11111111111111111111111111111111111111112"; qNet[k] = (qNet[k] || 0) + (n.fromUserAccount === w ? amt : 0) - (n.toUserAccount === w ? amt : 0); }
    const anyQuoteOut = Object.values(qNet).some(v => v > 1e-9);   // wallet spent quote → buy side
    const anyQuoteIn = Object.values(qNet).some(v => v < -1e-9);   // wallet received quote → sell side
    const ts = (Number(tx.timestamp) || 0) * 1000;
    if (!ts) continue;
    const tokenAbs = Math.abs(mintNet);
    const usd = tokenPriceUsd > 0 ? tokenAbs * tokenPriceUsd : null;
    if (mintNet > 1e-9 && anyQuoteOut) trades.push({ ts, side: "buy", wallet: w, tokenAmt: tokenAbs, usd, sig: tx.signature });
    else if (mintNet < -1e-9 && anyQuoteIn) trades.push({ ts, side: "sell", wallet: w, tokenAmt: tokenAbs, usd, sig: tx.signature });
  }
  trades.sort((a, b) => a.ts - b.ts);
  return { trades, txsScanned: txs.length, capped };
}

module.exports = { getTokenBuyersInWindowHelius, getWalletTokenPositionHelius, getTradeTapeHelius };
