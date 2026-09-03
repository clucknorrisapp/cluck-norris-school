// Helius-based "who bought token X in a time window" scanner — the buy-comp's
// primary data source (replaces Solana Tracker's /trades, which is quota-billed).
// Approach: discover the token's pools via DexScreener, page each pool's tx
// signatures back to the window start, parse the txs through the Helius enhanced
// API (batched), and classify a BUY as: the fee payer's wallet had a NET INFLOW
// of the token and a NET OUTFLOW of SOL/wSOL/USDC in the same tx. volumeSol is
// the quote outflow (USDC converted at the supplied SOL price).
const { isOnCurve } = require("./solana-addr");   // real wallets are on-curve; pool vaults / PDAs are off-curve
const WSOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

// POST a JSON-RPC body with bounded retry on 429 / 5xx / network error. Helius
// rate-limits burst batches; a bare fetch that swallows a 429 silently drops a
// whole 100-signature batch — up to 100 buys vanish while the scan still reports
// "complete" (the exact silent-undercount class that hid a real buy). Retry with
// backoff, honouring Retry-After; throw only after all tries are exhausted so the
// caller can mark coverage incomplete rather than trusting a partial result.
async function heliusPost(rpcUrl, body, { timeoutMs = 20000, tries = 4 } = {}) {
  let delay = 500;
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      const r = await fetch(rpcUrl, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
      if (r.status === 429 || r.status >= 500) {
        if (attempt === tries - 1) throw new Error("helius " + r.status);
        const ra = Number(r.headers.get("retry-after")) * 1000;
        await new Promise(res => setTimeout(res, ra > 0 ? Math.min(ra, 8000) : delay));
        delay = Math.min(delay * 2, 8000);
        continue;
      }
      return await r.json();
    } catch (e) {
      if (attempt === tries - 1) throw e;
      await new Promise(res => setTimeout(res, delay));
      delay = Math.min(delay * 2, 8000);
    }
  }
  throw new Error("helius post failed after retries");
}

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
  // DexScreener pairs FIRST so an indexed pool is never displaced out of the top-10 target slice
  // by large NON-pool holders (locked-LP, CEX hot wallets, treasury, airdrop escrows) — that
  // silently undercounted buys on any token whose pool vault ranked below 10th by balance.
  try {
    const dx = await (await fetch(`https://api.dexscreener.com/token-pairs/v1/solana/${mint}`, { signal: AbortSignal.timeout(8000) })).json();
    if (Array.isArray(dx)) for (const p of dx) if (p && p.pairAddress) targets.add(p.pairAddress);
  } catch (_) {}
  try {
    const largest = await rpcCall("getTokenLargestAccounts", [mint]);
    for (const a of ((largest && largest.value) || [])) if (a && a.address) targets.add(a.address);
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
      let arr = [], rpcErr = false;
      try {
        // Retry transient 429/5xx before giving up — otherwise one throttle blip forces the
        // whole comp scan to fall back to the quota-billed secondary source.
        const r = await heliusPost(rpcUrl, { jsonrpc: "2.0", id: "bc-sigs", method: "getSignaturesForAddress", params }, { tries: 4 });
        if (r && r.error) rpcErr = true;       // 200-with-{error} (throttle/quota) — NOT an empty page
        arr = (r && r.result) || [];
      } catch (_) { rpcErr = true; }
      if (rpcErr) break;                        // RPC error → coverage unknown (covered stays false → reachedWindowStart=false → caller falls back)
      if (!arr.length) { covered = true; break; }   // genuinely ran out of history → fully covered
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

  // 3. fetch RAW transactions and classify from meta pre/post balances.
  // We deliberately use raw getTransaction (jsonParsed) rather than Helius's ENHANCED
  // /v0/transactions here: the enhanced tokenTransfers/accountData attribute a
  // stablecoin-routed swap's quote leg to a Jupiter/aggregator intermediate, so a
  // USDC/USDT buy showed "tokens in, nothing spent" and was silently dropped (SOL/wSOL
  // buys were unaffected). meta.pre/postTokenBalances + pre/postBalances are the
  // authoritative net deltas per OWNER — immune to that quirk — so USDC and "other
  // crypto swapped" buys are counted. (heliusEnhancedBatched is still used elsewhere.)
  const cache = txCache || new Map();
  const sigList = [...sigs];
  const rawTxs = [];
  const toFetch = [];
  for (const s of sigList) {
    if (cache.has(s)) { const t = cache.get(s); if (t) rawTxs.push(t); }
    else toFetch.push(s);
  }
  const RAW_BATCH = 100;          // Helius supports JSON-RPC batching
  const RAW_CONC = 4;             // batches in flight at once
  const batches = [];
  for (let i = 0; i < toFetch.length; i += RAW_BATCH) batches.push(toFetch.slice(i, i + RAW_BATCH));
  let rawBatchFailed = false;    // a permanently-failed batch means we scanned fewer txs than we have sigs
  for (let i = 0; i < batches.length; i += RAW_CONC) {
    await Promise.all(batches.slice(i, i + RAW_CONC).map(async (batch) => {
      const body = batch.map((sig, idx) => ({ jsonrpc: "2.0", id: idx, method: "getTransaction",
        params: [sig, { maxSupportedTransactionVersion: 1, encoding: "jsonParsed" }] }));
      let arr = [];
      try {
        arr = await heliusPost(rpcUrl, body, { timeoutMs: 20000, tries: 4 });
      } catch (_) { rawBatchFailed = true; return; }   // exhausted retries → coverage now incomplete
      if (!Array.isArray(arr)) { rawBatchFailed = true; return; }
      for (const item of arr) {
        const tx = item && item.result;
        if (!tx) continue;
        const sig = (tx.transaction && tx.transaction.signatures && tx.transaction.signatures[0]) || null;
        if (sig) cache.set(sig, tx);
        rawTxs.push(tx);
      }
    }));
  }

  // 4. classify buys from raw meta deltas (pure, unit-tested — see classifyBuyersFromRawTxs).
  // If any raw batch permanently failed we undercounted buys — degrade reachedWindowStart so
  // the caller falls back instead of trusting a partial list as authoritative (same contract
  // as the sig-paging rpcErr break above).
  const buyers = classifyBuyersFromRawTxs(rawTxs, mint, { solUsd, tokenPriceUsd });
  return { buyers, txsScanned: rawTxs.length, source: "helius", reachedWindowStart: reachedWindowStart && !rawBatchFailed };
}

// Recognized quote assets a buy can be paid in. Kept in sync with getTradeTapeHelius.
const BC_QUOTES = {
  [WSOL]: 1, [USDC]: 1,
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB": 1,   // USDT
  "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN": 1,    // JUP
};
const USDT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const BC_SOL_FEE_FLOOR = 0.002;   // native SOL out below this is just fees/rent, not a buy

// Classify a list of Helius-enhanced txs into per-wallet buy aggregates.
// A buy = the FEE PAYER netted +mint AND spent value (any recognized quote, or native
// SOL beyond the fee floor) in the same tx. The fee payer's NET balance deltas come from
// Helius's `accountData` (nativeBalanceChange + signed tokenBalanceChanges) rather than
// from `tokenTransfers`. Why: on a USDC- or other-stablecoin-routed swap, Helius often
// attributes the quote leg's `fromUserAccount` to a Jupiter/aggregator intermediate, not
// the buyer — so a tokenTransfers-based scan sees ZERO quote out and silently DROPS the
// buy (SOL/wSOL buys are unaffected because native/wSOL moves sit on the wallet).
// accountData is the authoritative pre/post net delta and is immune to that attribution
// quirk, so USDC and "other crypto swapped" buys are counted. tokenTransfers is kept as a
// fallback for any tx Helius didn't enrich with accountData.
// ⛔ DEPRECATED / FEE-PAYER-CENTRIC — DO NOT WIRE THIS IN. It credits buys to `tx.feePayer`,
// which drops gasless/relayer and many Jupiter-routed buys (the same bug fixed in
// classifyBuyersFromRawTxs). It currently has ZERO call sites and is kept only for reference.
// Use classifyBuyersFromRawTxs (owner-centric, raw meta) instead.
function classifyBuyersFromTxs(txs, mint, { solUsd = 0, tokenPriceUsd = 0 } = {}) {
  const buyers = new Map();
  for (const tx of (txs || [])) {
    if (!tx || !tx.feePayer) continue;
    const w = tx.feePayer;
    let mintIn = 0;
    const qOut = {};    // recognized quote mint -> amount SPENT by the wallet (positive)
    let solSpent = 0;   // native SOL spent (lamports→SOL), fee-floored below
    let usedAccountData = false;

    // Preferred: authoritative net deltas from accountData.
    const ad = Array.isArray(tx.accountData) ? tx.accountData : [];
    for (const a of ad) {
      if (!a) continue;
      if (a.account === w && a.nativeBalanceChange != null) {
        const net = (Number(a.nativeBalanceChange) || 0) / 1e9;   // negative = spent
        if (net < 0) solSpent += -net;
      }
      for (const c of (a.tokenBalanceChanges || [])) {
        if (!c || c.userAccount !== w) continue;
        usedAccountData = true;
        const dec = Number((c.rawTokenAmount && c.rawTokenAmount.decimals) || 0);
        const amt = (Number(c.rawTokenAmount && c.rawTokenAmount.tokenAmount) || 0) / Math.pow(10, dec); // signed
        if (c.mint === mint) mintIn += amt;
        else if (BC_QUOTES[c.mint] && amt < 0) qOut[c.mint] = (qOut[c.mint] || 0) + -amt;
      }
    }

    // Fallback: derive from tokenTransfers/nativeTransfers when accountData is absent.
    if (!usedAccountData) {
      mintIn = 0; solSpent = 0;
      for (const t of (tx.tokenTransfers || [])) {
        const amt = Number(t.tokenAmount) || 0;
        if (t.mint === mint) {
          if (t.toUserAccount === w) mintIn += amt;
          if (t.fromUserAccount === w) mintIn -= amt;
        } else if (BC_QUOTES[t.mint]) {
          const net = (t.fromUserAccount === w ? amt : 0) - (t.toUserAccount === w ? amt : 0);
          if (net > 0) qOut[t.mint] = (qOut[t.mint] || 0) + net;
        }
      }
      for (const n of (tx.nativeTransfers || [])) {
        const amt = (Number(n.amount) || 0) / 1e9;
        const net = (n.fromUserAccount === w ? amt : 0) - (n.toUserAccount === w ? amt : 0);
        if (net > 0) solSpent += net;
      }
    }

    // A buy needs token IN and value OUT. Value out = any recognized stable/token quote
    // spent, OR native SOL spent beyond the fee floor (so a self-claim/airdrop that only
    // pays the tx fee is never mistaken for a buy).
    const stableOrTokenOut = Object.values(qOut).some((v) => v > 1e-9);
    const solOut = solSpent > BC_SOL_FEE_FLOOR ? solSpent : 0;
    if (mintIn > 1e-9 && (stableOrTokenOut || solOut > 0)) {
      // Value by the TOKENS RECEIVED × price (the real buy size), robust across every
      // quote. Fall back to the SOL + USDC/USDT outflow converted to SOL when no token
      // price is available. (JUP/other non-stable quotes still COUNT the buy; they just
      // don't contribute to the SOL fallback valuation, which the token-leg path covers.)
      const wsolOut = qOut[WSOL] || 0;
      const stableOut = (qOut[USDC] || 0) + (qOut[USDT] || 0);
      const quoteOutSol = solOut + wsolOut + (solUsd > 0 ? stableOut / solUsd : 0);
      const tokenValueSol = (tokenPriceUsd > 0 && solUsd > 0) ? (mintIn * tokenPriceUsd) / solUsd : 0;
      const buySol = tokenValueSol > 0 ? tokenValueSol : Math.max(quoteOutSol, 0);
      const cur = buyers.get(w) || { wallet: w, buyCount: 0, volumeSol: 0, maxBuySol: 0, tokensBought: 0 };
      cur.buyCount++; cur.volumeSol += buySol; cur.tokensBought += mintIn;   // token amount received (for pct-of-token payouts)
      if (buySol > cur.maxBuySol) cur.maxBuySol = buySol;
      buyers.set(w, cur);
    }
  }
  return [...buyers.values()];
}

// Classify RAW getTransaction results (jsonParsed) into per-wallet buy aggregates.
// A buy = the FEE PAYER (accountKeys[0]) netted +mint AND spent value in the same tx.
// Deltas come from meta.pre/postTokenBalances (per OWNER, via uiTokenAmount) and
// meta.pre/postBalances (native SOL). This is the authoritative on-chain net movement
// and — unlike Helius's enhanced tokenTransfers/accountData — is not fooled by
// aggregator-attributed quote legs, so USDC/USDT/other-quote buys are counted.
function classifyBuyersFromRawTxs(rawTxs, mint, { solUsd = 0, tokenPriceUsd = 0 } = {}) {
  const buyers = new Map();
  const JUP = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
  for (const tx of (rawTxs || [])) {
    if (!tx || !tx.meta || tx.meta.err) continue;
    const msg = tx.transaction && tx.transaction.message;
    const keys = msg && Array.isArray(msg.accountKeys)
      ? msg.accountKeys.map((k) => (typeof k === "string" ? k : k && k.pubkey)) : null;
    if (!keys || !keys.length) continue;

    // OWNER-CENTRIC: net token deltas per OWNER (from meta pre/postTokenBalances), so a buy is
    // credited to whoever actually RECEIVED the token — NOT keys[0]/the fee payer. The old
    // fee-payer assumption silently dropped every gasless/relayer buy and many Jupiter-routed
    // buys, where a relayer/router pays the fee (nets 0 mint) but a different wallet gets the
    // token. Pools are excluded via the on-curve check: a pool vault's owner is an off-curve
    // PDA, so on a SELL (pool RECEIVES the token) the pool would otherwise look like a buyer.
    const byOwner = new Map();   // owner -> { [tokenMint]: netUiDelta }
    const add = (owner, m, amt) => {
      if (!owner || !m || !amt) return;
      let d = byOwner.get(owner); if (!d) { d = {}; byOwner.set(owner, d); }
      d[m] = (d[m] || 0) + amt;
    };
    for (const b of (tx.meta.preTokenBalances || [])) add(b.owner, b.mint, -(Number(b.uiTokenAmount && b.uiTokenAmount.uiAmount) || 0));
    for (const b of (tx.meta.postTokenBalances || [])) add(b.owner, b.mint, +(Number(b.uiTokenAmount && b.uiTokenAmount.uiAmount) || 0));

    // native SOL delta per account key (a wallet holds its native SOL at its own pubkey)
    const solByKey = new Map();
    const preB = tx.meta.preBalances || [], postB = tx.meta.postBalances || [];
    for (let i = 0; i < keys.length; i++) {
      const dv = ((Number(postB[i]) || 0) - (Number(preB[i]) || 0)) / 1e9;
      if (dv) solByKey.set(keys[i], dv);
    }

    for (const [owner, d] of byOwner) {
      const mintIn = d[mint] || 0;
      if (mintIn <= 1e-9) continue;          // must RECEIVE the token (a pool net-loses it on a buy)
      if (!isOnCurve(owner)) continue;       // exclude pool vaults / PDAs (off-curve) — kills the sell-side false positive
      const stableOut = Math.max(0, -(d[USDC] || 0)) + Math.max(0, -(d[USDT] || 0));
      const wsolOut = Math.max(0, -(d[WSOL] || 0));
      const jupOut = Math.max(0, -(d[JUP] || 0));
      const solDelta = solByKey.get(owner) || 0;
      const solOut = solDelta < -BC_SOL_FEE_FLOOR ? -solDelta : 0;   // native SOL spent beyond fees
      const spentQuote = stableOut > 1e-9 || wsolOut > 1e-9 || jupOut > 1e-9 || solOut > 0;
      if (!spentQuote) continue;             // received the token but paid no quote → transfer/airdrop, not a buy

      const quoteOutSol = solOut + wsolOut + (solUsd > 0 ? stableOut / solUsd : 0);
      const tokenValueSol = (tokenPriceUsd > 0 && solUsd > 0) ? (mintIn * tokenPriceUsd) / solUsd : 0;
      const buySol = tokenValueSol > 0 ? tokenValueSol : Math.max(quoteOutSol, 0);
      const cur = buyers.get(owner) || { wallet: owner, buyCount: 0, volumeSol: 0, maxBuySol: 0, tokensBought: 0 };
      cur.buyCount++; cur.volumeSol += buySol; cur.tokensBought += mintIn;
      if (buySol > cur.maxBuySol) cur.maxBuySol = buySol;
      buyers.set(owner, cur);
    }
  }
  return [...buyers.values()];
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
// Coverage cap: maxSigPages pages (3k sigs) per token account. A scan that hits that cap
// (or errors on a page) is INCOMPLETE, so it returns null rather than a confident sells:0 —
// the caller falls through to the Solana Tracker source instead of trusting a partial scan.
async function getWalletTokenPositionHelius(wallet, mint, {
  heliusKey, heliusEnhancedBatched, maxSigPages = 3, txCache = null, fromMs = null, toMs = null,
} = {}) {
  if (!wallet || !mint || !heliusKey || !heliusEnhancedBatched) return null;
  const rpcUrl = `https://mainnet.helius-rpc.com/?api-key=${heliusKey}`;
  // Retry + timeout (heliusPost) and treat a 200-with-{error} as a real error, never as an
  // empty page — a throttled/errored scan must not silently read as "sells: 0, still
  // holding" (see getTokenBuyersInWindowHelius's rpcErr handling above, which this mirrors).
  const rpc = async (method, params) => {
    const r = await heliusPost(rpcUrl, { jsonrpc: "2.0", id: "wp", method, params });
    if (r && r.error) throw new Error("helius rpc error: " + (r.error.message || r.error.code || "unknown"));
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
  let coverageOk = true;
  for (const ta of tokenAccounts) {
    let before = null;
    for (let p = 0; p < maxSigPages; p++) {
      let arr = [];
      try { arr = await rpc("getSignaturesForAddress", [ta, { limit: 1000, ...(before ? { before } : {}) }]) || []; }
      catch (_) { coverageOk = false; break; }
      if (!arr.length) break;
      for (const s of arr) if (!s.err) sigs.add(s.signature);
      if (arr.length < 1000) break;   // short page = we reached the end of this account's history
      before = arr[arr.length - 1].signature;
      // The LAST allowed page came back FULL, so there is older history we never read. This
      // truncation is DETERMINISTIC and attacker-controlled: a buy-comp entrant can pad their
      // own token account past maxSigPages*1000 signatures with cheap self-transfers until
      // their real sell falls off the end, and a truncated scan reports sells:0. Treat it
      // exactly like an RPC failure — incomplete is incomplete.
      if (p === maxSigPages - 1) coverageOk = false;
    }
  }
  // An errored OR truncated page means the sig set (and therefore sells/transfersOut below) is
  // INCOMPLETE — returning it as sells:0 reads as "still holding, never sold" to every
  // money-adjacent caller (buy-comp verify, ROSE/CUNA payouts, hold-check). Return null so
  // walletPositionMulti falls through to the Solana Tracker fallback instead of trusting a
  // partial scan.
  if (!coverageOk) return null;
  let sells = 0, transfersOut = 0;
  const transferDests = {};   // destination WALLET -> total mint amount moved there (non-sell transfers)
  if (sigs.size) {
    const { txs } = await heliusEnhancedBatched([...sigs], heliusKey, "wp", txCache || new Map(), null);
    for (const tx of txs) {
      // NOTE: do NOT gate on tx.feePayer === wallet — that dropped gasless/relayer-paid SELLS,
      // letting a dumper who sells via a relayer stay eligible. The mint legs below are already
      // owner-centric (fromUserAccount === wallet), and we only scan this wallet's own token
      // accounts, so every tx here already touches the wallet's position.
      if (!tx || !Array.isArray(tx.tokenTransfers)) continue;
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
    const r = await heliusPost(rpcUrl, { jsonrpc: "2.0", id: "tape-disc", method, params });
    if (r && r.error) throw new Error("helius rpc error: " + (r.error.message || r.error.code || "unknown"));
    return r.result;
  };
  // ON-CHAIN FIRST pool discovery (see getTokenBuyersInWindowHelius) — the token's pool
  // vaults are its largest on-chain accounts, so we never go blind on a token DexScreener
  // doesn't index; DexScreener pairs are a union supplement.
  const targets = new Set();
  // DexScreener pairs FIRST so an indexed pool is never displaced out of the top-10 target slice
  // by large NON-pool holders (locked-LP, CEX hot wallets, treasury, airdrop escrows) — that
  // silently undercounted buys on any token whose pool vault ranked below 10th by balance.
  try {
    const dx = await (await fetch(`https://api.dexscreener.com/token-pairs/v1/solana/${mint}`, { signal: AbortSignal.timeout(8000) })).json();
    if (Array.isArray(dx)) for (const p of dx) if (p && p.pairAddress) targets.add(p.pairAddress);
  } catch (_) {}
  try {
    const largest = await rpcCall("getTokenLargestAccounts", [mint]);
    for (const a of ((largest && largest.value) || [])) if (a && a.address) targets.add(a.address);
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
        // heliusPost retries 429/5xx with backoff before giving up. A 200-with-{error}
        // (throttle/quota) is a REAL error, not "ran out of history" — treat it as a
        // truncation (capped=true) rather than silently dropping this pool's remaining
        // pages while the caller still reports the tape as complete.
        const r = await heliusPost(rpcUrl, { jsonrpc: "2.0", id: "tape-sigs", method: "getSignaturesForAddress", params: [pool, { limit: 1000, ...(before ? { before } : {}) }] });
        if (r && r.error) { capped = true; break; }
        arr = r.result || [];
      } catch (_) { capped = true; break; }
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
    if (!tx || !Array.isArray(tx.tokenTransfers)) continue;
    const ts = (Number(tx.timestamp) || 0) * 1000;
    if (!ts) continue;
    // OWNER-CENTRIC (not tx.feePayer): net the target mint per OWNER, and the trader is the
    // ON-CURVE wallet whose mint balance moved the most — the human counterparty, immune to
    // gasless/relayer fee payers and Jupiter routers (which net ~0 of the mint). Pools are
    // off-curve, so they're skipped. Requires some quote to have moved (else it's a transfer/LP).
    const mintNetByOwner = new Map();
    let quoteMoved = false;
    for (const t of tx.tokenTransfers) {
      const amt = Number(t.tokenAmount) || 0;
      if (!amt) continue;
      if (t.mint === mint) {
        if (t.toUserAccount) mintNetByOwner.set(t.toUserAccount, (mintNetByOwner.get(t.toUserAccount) || 0) + amt);
        if (t.fromUserAccount) mintNetByOwner.set(t.fromUserAccount, (mintNetByOwner.get(t.fromUserAccount) || 0) - amt);
      } else if (QUOTES[t.mint]) { quoteMoved = true; }
    }
    if (!quoteMoved && (tx.nativeTransfers || []).some(n => (Number(n.amount) || 0) / 1e9 > BC_SOL_FEE_FLOOR)) quoteMoved = true;
    if (!quoteMoved) continue;
    let trader = null, best = 0;
    for (const [owner, net] of mintNetByOwner) {
      if (!owner || !isOnCurve(owner)) continue;
      if (Math.abs(net) > Math.abs(best)) { best = net; trader = owner; }
    }
    if (!trader || Math.abs(best) <= 1e-9) continue;
    const tokenAbs = Math.abs(best);
    const usd = tokenPriceUsd > 0 ? tokenAbs * tokenPriceUsd : null;
    trades.push({ ts, side: best > 0 ? "buy" : "sell", wallet: trader, tokenAmt: tokenAbs, usd, sig: tx.signature });
  }
  trades.sort((a, b) => a.ts - b.ts);
  return { trades, txsScanned: txs.length, capped };
}

module.exports = { getTokenBuyersInWindowHelius, getWalletTokenPositionHelius, getTradeTapeHelius, classifyBuyersFromTxs, classifyBuyersFromRawTxs };
