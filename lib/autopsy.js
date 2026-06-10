// lib/autopsy.js — the Token Autopsy engine, extracted from server.js.
//
// runAutopsy(mint, { nocache }) builds the full forensic report and returns
// { status, body } (HTTP status code + the JSON object). The /api/autopsy
// route in server.js stays thin: validation, the 3-min hot cache, headers —
// then this. The output JSON shape is depended on by public/autopsy.html;
// don't change it.
//
// Shared helpers that other server.js routes also use (bagsFetch for
// /api/fees and /api/reinvestment, heliusEnhancedBatched for the premium
// forensics routes, BAGS_BASE for the Bags proxy/feed) are exported below so
// there is exactly one definition.

const { PublicKey } = require("@solana/web3.js");
const solscan = require("./solscan");
const solanaTracker = require("./solana-tracker");
const {
  isOnCurve, DEX_PROGRAMS, LOCKER_PROGRAMS, TOKEN_PROGRAMS, PROGRAM_LABELS,
  KNOWN_CEX_WALLETS,
} = require("./solana-addr");

const BAGS_BASE = "https://public-api-v2.bags.fm/api/v1/";

// Pump.fun program — used to derive the per-creator "creator vault" PDA where
// Pump creator fees accrue. Seeds ["creator-vault", creator] per the Pump IDL.
// This is the cheap, deterministic way to surface a Pump creator's fee
// earnings without a paid indexer: derive the vault, read its balance
// (unclaimed) + activity. See memory: build-decision-principle.
const PUMP_PROGRAM_ID = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
function derivePumpCreatorVault(creatorWallet) {
  try {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("creator-vault"), new PublicKey(creatorWallet).toBuffer()],
      PUMP_PROGRAM_ID
    );
    return pda.toBase58();
  } catch (_) { return null; }
}

async function bagsFetch(endpoint, API_KEY) {
  const url = `${BAGS_BASE}${endpoint}`;
  console.log("-> Bags test:", url);
  const response = await fetch(url, { headers: { "x-api-key": API_KEY } });
  const text = await response.text();
  console.log("<- Bags test:", response.status, text.slice(0, 300));
  return { status: response.status, text };
}

// "Best observed" creator-trace cache. Forensic counters (buyCount, lockCount,
// boughtSol, claimedSol, lockedTokens) are MONOTONICALLY INCREASING by
// definition — a wallet can't un-buy or un-lock something. If a later run
// shows fewer buys than an earlier one, that's always a capture failure
// (Helius rate-limited, batch retry exhausted, GeckoTerminal down, etc.),
// never reality. So we keep the max() of each counter across all runs for a
// given (creatorWallet, mint) pair. The user sees stable numbers that only
// improve, never silently regress.
const CREATOR_TRACE_CACHE = new Map();
const CREATOR_TRACE_TTL_MS = 60 * 60 * 1000; // 1 hour
function bestObservedTrace(wallet, mint, fresh) {
  const key = `${wallet}:${mint}`;
  const cached = CREATOR_TRACE_CACHE.get(key);
  // If no cache, store fresh and return as-is.
  if (!cached || Date.now() - cached.savedAt > CREATOR_TRACE_TTL_MS) {
    CREATOR_TRACE_CACHE.set(key, { trace: fresh, savedAt: Date.now() });
    return { trace: fresh, usedCache: false };
  }
  // Merge — keep the max of each monotonic field, plus newest timestamps.
  const c = cached.trace;
  const merged = { ...fresh };
  const monotonic = ["buyCount", "sellCount", "lockCount", "transferInCount", "transferOutCount",
    "boughtTokens", "soldTokens", "lockedTokens", "transferInTokens", "transferOutTokens",
    "boughtUsd", "soldUsd", "boughtSol", "soldSol", "sigsScanned"];
  let regressedAny = false;
  for (const k of monotonic) {
    const newVal = Number(fresh[k]) || 0;
    const cachedVal = Number(c[k]) || 0;
    if (cachedVal > newVal) {
      merged[k] = cachedVal;
      regressedAny = true;
    } else {
      merged[k] = newVal;
    }
  }
  // Recompute derived fields after merging
  merged.netUsd = merged.boughtUsd - merged.soldUsd;
  merged.netSol = merged.boughtSol - merged.soldSol;
  if (merged.claimedSol && merged.claimedSol > 0) {
    merged.pctReinvested = Math.min(100, (merged.boughtSol / merged.claimedSol) * 100);
  }
  // Timestamps — keep newest lastTs, oldest firstTs
  if (c.lastTs && (!merged.lastTs || c.lastTs > merged.lastTs)) merged.lastTs = c.lastTs;
  if (c.firstTs && (!merged.firstTs || c.firstTs < merged.firstTs)) merged.firstTs = c.firstTs;
  // teamNetwork: keep the one with more wallets / activity
  if (c.teamNetwork && (!merged.teamNetwork
    || (c.teamNetwork.totalBuyCount || 0) > (merged.teamNetwork.totalBuyCount || 0))) {
    merged.teamNetwork = c.teamNetwork;
  }
  // Store merged back (only if we actually improved or kept stable)
  CREATOR_TRACE_CACHE.set(key, { trace: merged, savedAt: Date.now() });
  if (regressedAny) {
    console.log(`[CREATOR-TRACE-CACHE] ${wallet.slice(0,8)}…:${mint.slice(0,6)} — fresh run regressed; using cached best (buys: ${c.buyCount} vs fresh ${fresh.buyCount}, locks: ${c.lockCount} vs fresh ${fresh.lockCount}, boughtSol: ${c.boughtSol?.toFixed(2)} vs fresh ${fresh.boughtSol?.toFixed(2)})`);
  }
  return { trace: merged, usedCache: regressedAny };
}

// Helius Enhanced API batch fetch with retry-on-429 + in-memory dedup cache.
// One canonical helper that all autopsy phases use, so a single rate-limit
// event during Phase 2F doesn't cascade into Phase 2G returning empty.
// Returns { txs, attempted, succeeded, cached, rateLimited } for diagnostics.
async function heliusEnhancedBatched(sigs, HELIUS_KEY, label, txCache, scanQuality) {
  if (!sigs || sigs.length === 0) return { txs: [], attempted: 0, succeeded: 0, cached: 0, rateLimited: 0 };
  const result = { txs: [], attempted: 0, succeeded: 0, cached: 0, rateLimited: 0 };
  // De-dupe vs cache up front so we never re-fetch a sig we already have.
  const uncached = [];
  for (const s of sigs) {
    if (txCache && txCache.has(s)) {
      const cachedTx = txCache.get(s);
      if (cachedTx) result.txs.push(cachedTx);
      result.cached++;
    } else {
      uncached.push(s);
    }
  }
  // Fetch the uncached sigs in 100-batches with retry-on-429.
  // PROACTIVE THROTTLE: pace batches with a small inter-batch delay so we
  // never trip the rate limit in the first place. Reactive backoff (waiting
  // until a 429 lands) was dropping batches on busy wallets — the creator
  // trace fires 30+ batches and slamming them back-to-back exhausted the
  // 3-retry budget on some. ~140ms between batches keeps us under ~7 req/s,
  // comfortably below the Helius limit, at the cost of a few seconds per
  // scan. Skipped before the first batch and when there's only one.
  const INTER_BATCH_MS = 140;
  let batchIndex = 0;
  for (let i = 0; i < uncached.length; i += 100) {
    if (batchIndex > 0) await new Promise(res => setTimeout(res, INTER_BATCH_MS));
    batchIndex++;
    const batch = uncached.slice(i, i + 100);
    result.attempted++;
    let attempt = 0;
    let success = false;
    while (attempt < 4 && !success) {
      try {
        const r = await fetch(`https://api.helius.xyz/v0/transactions?api-key=${HELIUS_KEY}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transactions: batch }),
          signal: AbortSignal.timeout(20000),
        });
        if (r.status === 429) {
          attempt++;
          result.rateLimited++;
          const waitMs = Math.min(4000, 600 * Math.pow(2, attempt - 1)); // 600, 1200, 2400
          console.warn(`[AUTOPSY] Helius ${label} 429 rate-limited, backing off ${waitMs}ms (attempt ${attempt}/4)`);
          await new Promise(res => setTimeout(res, waitMs));
          continue;
        }
        if (r.status >= 500 && r.status < 600) {
          attempt++;
          const waitMs = 500 * attempt;
          console.warn(`[AUTOPSY] Helius ${label} status=${r.status}, retrying after ${waitMs}ms (attempt ${attempt}/4)`);
          await new Promise(res => setTimeout(res, waitMs));
          continue;
        }
        if (!r.ok) {
          console.warn(`[AUTOPSY] Helius ${label} non-OK status=${r.status} — giving up on this batch`);
          break;
        }
        const data = await r.json();
        if (Array.isArray(data)) {
          for (const tx of data) {
            if (tx && tx.signature && txCache) txCache.set(tx.signature, tx);
            if (tx) result.txs.push(tx);
          }
        }
        result.succeeded++;
        success = true;
      } catch (e) {
        attempt++;
        console.warn(`[AUTOPSY] Helius ${label} batch ${i} attempt ${attempt} threw:`, e.message);
        if (attempt < 3) await new Promise(res => setTimeout(res, 500 * attempt));
      }
    }
  }
  if (scanQuality) {
    scanQuality.heliusBatches += result.attempted;
    scanQuality.heliusBatchesSucceeded += result.succeeded;
    scanQuality.heliusRateLimited += result.rateLimited;
  }
  return result;
}

// The report builder. `nocache` is accepted for signature parity with the
// route (the route owns the report cache; nothing inside the build currently
// branches on it).
async function runAutopsy(mint, { nocache = false } = {}) { // eslint-disable-line no-unused-vars
  const HELIUS_KEY = process.env.HELIUS_API_KEY;
  if (!HELIUS_KEY) return { status: 500, body: { success: false, error: "Server not configured" } };
  const rpcUrl = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`;
  // Per-request Helius enhanced-tx cache + scan-quality tracker. Stops us
  // re-fetching the same sig across phases and gives the UI a way to flag
  // when Helius was throttling us mid-run.
  const heliusTxCache = new Map();
  const scanQuality = {
    heliusBatches: 0,
    heliusBatchesSucceeded: 0,
    heliusRateLimited: 0,
    phasesCompleted: [],
    phasesFailed: [],
  };
  function rpcCall(id, method, params) {
    return fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params })
    }).then(r => r.json());
  }

  try {
    const [dexData, supplyData, mintInfoData] = await Promise.allSettled([
      fetch(`https://api.dexscreener.com/token-pairs/v1/solana/${mint}`).then(r => r.json()),
      rpcCall("autopsy-supply", "getTokenSupply", [mint]),
      rpcCall("autopsy-mint", "getAccountInfo", [mint, { encoding: "jsonParsed" }]),
    ]);

    const allPairs = dexData.status === "fulfilled" && Array.isArray(dexData.value) ? dexData.value : [];
    const solPairs = allPairs.filter(p => p.chainId === "solana" || !p.chainId);
    const totalLiqUsd = solPairs.reduce((s, p) => s + (parseFloat(p.liquidity?.usd) || 0), 0);
    const totalVol24h = solPairs.reduce((s, p) => s + (parseFloat(p.volume?.h24) || 0), 0);
    const buys24h = solPairs.reduce((s, p) => s + (p.txns?.h24?.buys || 0), 0);
    const sells24h = solPairs.reduce((s, p) => s + (p.txns?.h24?.sells || 0), 0);
    const txns24h = buys24h + sells24h;
    const topPair = solPairs.length
      ? solPairs.slice().sort((a, b) => (parseFloat(b.liquidity?.usd) || 0) - (parseFloat(a.liquidity?.usd) || 0))[0]
      : null;
    const pairCreatedMs = topPair?.pairCreatedAt ? Number(topPair.pairCreatedAt) : null;
    const ageDays = pairCreatedMs ? (Date.now() - pairCreatedMs) / 86400000 : null;
    // Price trend — without this the AI thinks every low-volume token is fading.
    // DexScreener's priceChange is a % number (e.g. 12.5 means +12.5%).
    const priceChangeH1  = topPair?.priceChange?.h1  ?? null;
    const priceChangeH6  = topPair?.priceChange?.h6  ?? null;
    const priceChangeH24 = topPair?.priceChange?.h24 ?? null;

    const rawSupply = supplyData.status === "fulfilled" ? supplyData.value?.result?.value?.amount : null;
    const decimals = supplyData.status === "fulfilled" ? (supplyData.value?.result?.value?.decimals || 9) : 9;
    const supplyTokens = rawSupply ? parseInt(rawSupply) / Math.pow(10, decimals) : null;

    const mintParsed = mintInfoData.status === "fulfilled" ? mintInfoData.value?.result?.value?.data?.parsed?.info : null;
    const mintAuthority = mintParsed?.mintAuthority || null;
    const freezeAuthority = mintParsed?.freezeAuthority || null;

    // --- Token-2022 extension scan (modern honeypot / rug vectors) ---
    // The classic mint/freeze authority check is blind to Token-2022
    // extensions, which are how today's honeypots actually trap buyers: a
    // transfer hook routes every trade through a custom program that can
    // reject sells; a 100% transfer fee is an unsellable sell tax; a
    // permanent delegate can seize anyone's tokens; a non-transferable or
    // default-frozen mint blocks selling outright. The jsonParsed
    // getAccountInfo already returns these under info.extensions and the
    // owning program under value.owner — we just read them. This only fires
    // for Token-2022 mints, so standard SPL pump/Bags tokens are untouched.
    const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
    const SYS_PROGRAM = "11111111111111111111111111111111";
    const tokenProgramOwner = mintInfoData.status === "fulfilled" ? mintInfoData.value?.result?.value?.owner : null;
    const isToken2022 = tokenProgramOwner === TOKEN_2022_PROGRAM;
    const mintExtensions = Array.isArray(mintParsed?.extensions) ? mintParsed.extensions : [];
    const extByType = {};
    for (const e of mintExtensions) { if (e && e.extension) extByType[e.extension] = e.state || e; }

    const token2022Risks = [];
    let transferFeeBps = null;
    if (extByType.transferFeeConfig) {
      const cfg = extByType.transferFeeConfig;
      // Read the *newer* (currently-effective) fee. jsonParsed nests it under
      // newerTransferFee.transferFeeBasisPoints (camelCase).
      transferFeeBps = cfg?.newerTransferFee?.transferFeeBasisPoints
        ?? cfg?.newerTransferFee?.transfer_fee_basis_points
        ?? null;
      if (transferFeeBps != null) {
        const pct = (transferFeeBps / 100).toFixed(transferFeeBps % 100 === 0 ? 0 : 1);
        if (transferFeeBps >= 9000) token2022Risks.push({ kind: "transfer-fee", severity: "honeypot", bps: transferFeeBps, label: `${pct}% transfer fee`, msg: `Token-2022 transfer fee is ${pct}% — every sell is taxed into oblivion. Effectively unsellable (honeypot-grade sell tax).` });
        else if (transferFeeBps >= 1000) token2022Risks.push({ kind: "transfer-fee", severity: "severe", bps: transferFeeBps, label: `${pct}% transfer fee`, msg: `Token-2022 transfer fee is ${pct}% — a heavy sell tax skims every trade.` });
        else if (transferFeeBps > 0) token2022Risks.push({ kind: "transfer-fee", severity: "caution", bps: transferFeeBps, label: `${pct}% transfer fee`, msg: `Token-2022 transfer fee of ${pct}% applies to every transfer.` });
      }
    }
    if (extByType.transferHook) {
      const hookProg = extByType.transferHook?.programId || extByType.transferHook?.program_id || null;
      if (hookProg && hookProg !== SYS_PROGRAM) token2022Risks.push({ kind: "transfer-hook", severity: "honeypot", program: hookProg, label: "active transfer hook", msg: `A Token-2022 transfer hook routes every trade through a custom program (${hookProg.slice(0, 4)}…${hookProg.slice(-4)}) that can block sells at will — a common honeypot mechanism.` });
    }
    if (extByType.permanentDelegate) {
      const del = extByType.permanentDelegate?.delegate || null;
      if (del && del !== SYS_PROGRAM) token2022Risks.push({ kind: "permanent-delegate", severity: "severe", delegate: del, label: "permanent delegate", msg: `A permanent delegate (${del.slice(0, 4)}…${del.slice(-4)}) can move or burn tokens from ANY wallet, forever — your holdings are seizable.` });
    }
    if (extByType.defaultAccountState) {
      const st = extByType.defaultAccountState?.accountState || extByType.defaultAccountState?.state || extByType.defaultAccountState;
      if (typeof st === "string" && st.toLowerCase() === "frozen") token2022Risks.push({ kind: "default-frozen", severity: "honeypot", label: "accounts frozen by default", msg: "New token accounts are FROZEN by default — buyers can't sell until the team manually thaws each wallet. Classic restricted-sell honeypot." });
    }
    if (extByType.nonTransferable || extByType.nonTransferableAccount) {
      token2022Risks.push({ kind: "non-transferable", severity: "honeypot", label: "non-transferable", msg: "Token is NON-TRANSFERABLE — it can never be sold or moved. Hard honeypot (or a soul-bound token, but never tradeable)." });
    }
    const hasHoneypotExtension = token2022Risks.some(r => r.severity === "honeypot");
    const hasSevereExtension = token2022Risks.some(r => r.severity === "severe" || r.severity === "honeypot");

    // --- Top 100 holders via paginated getTokenAccounts (DAS) ---
    // getTokenLargestAccounts caps at 20. The DAS getTokenAccounts gives us
    // pagination (up to 1000 per page) and the owner field directly, so we
    // can both walk deeper AND skip a batched RPC call later.
    const MAX_HOLDER_PAGES = 5;
    const allTokenAccounts = [];
    for (let p = 1; p <= MAX_HOLDER_PAGES; p++) {
      try {
        const r = await rpcCall(`autopsy-tas-${p}`, "getTokenAccounts", {
          page: p, limit: 1000, mint, displayOptions: { showZeroBalance: false }
        });
        const accs = r?.result?.token_accounts || [];
        if (accs.length === 0) break;
        allTokenAccounts.push(...accs);
        if (accs.length < 1000) break;
      } catch (e) {
        console.warn(`[AUTOPSY] token accounts page ${p} failed:`, e.message);
        break;
      }
    }
    const largestRaw = allTokenAccounts
      .map(a => ({
        address: a.address,                                              // token account address
        amount: a.amount,
        uiAmount: parseInt(a.amount || "0") / Math.pow(10, decimals),
        owner: a.owner,                                                   // wallet authority — directly available
      }))
      .filter(a => a.uiAmount > 0)
      .sort((a, b) => b.uiAmount - a.uiAmount)
      .slice(0, 100);
    const top10Sum = largestRaw.slice(0, 10).reduce((s, a) => s + (parseFloat(a.uiAmount) || 0), 0);
    const top10Share = supplyTokens > 0 ? top10Sum / supplyTokens : null;

    // CEX custody recognition. A known exchange wallet among the top holders is
    // custodial (many users' tokens), NOT single-entity whale concentration — so
    // we net it out of the concentration risk. And a token an exchange actually
    // lists is a real legitimacy signal, surfaced separately. Labels come from
    // Solana Tracker holder identity enrichment (authoritative — covers the many
    // rotating per-token exchange wallets a static list can't), merged with our
    // static fallback. Cached 10min; degrades to no-CEX on failure/quota.
    // Normalize "Binance 3" / "Binance Cold Wallet" / "OKX: Hot Wallet" → brand.
    const cexBrand = (n) => { if (!n) return n; const s = String(n).replace(/:.*/, "").replace(/\s*(hot|cold)\s+wallet.*$/i, "").replace(/\s+wallet.*$/i, "").replace(/\s*#?\d+\s*$/, "").trim(); return s || n; };
    // Derive CEX presence from ST's TRUE top-holder list (Helius getTokenAccounts
    // only returns an arbitrary first-5000 slice — for a million-holder token the
    // real whales, exchanges included, aren't in it). ST gives sorted holders with
    // percentage + identity tags. Cached 10min; degrades to no-CEX on failure.
    const cexWalletNames = new Map();   // owner → exchange name (for Helius-side netting)
    const cexBrands = new Set();        // brands among the true top holders
    let cexTop10Share = 0;              // CEX share within ST's true top-10 (fraction of supply)
    try {
      const eh = await solanaTracker.getEnrichedHolders(mint, { enrich: "identity" });
      const accts = (eh && Array.isArray(eh.accounts) ? eh.accounts : []);
      accts.forEach((h, rank) => {
        const id = h.identity || {};
        const isExch = id.type === "exchange" || (Array.isArray(id.tags) && id.tags.includes("exchange"));
        if (!isExch) return;
        const name = (id.exchange && id.exchange.name) || id.name || "Exchange";
        if (h.wallet) cexWalletNames.set(h.wallet, name);
        const pct = Number(h.percentage) || 0;            // ST returns % of supply
        if (pct >= 0.1) cexBrands.add(cexBrand(name));     // ignore dust deposit wallets
        if (rank < 10) cexTop10Share += pct / 100;
      });
    } catch (_) {}
    const cexExchanges = [...cexBrands];
    // Net CEX custody out of the Helius-basis concentration too (covers the case
    // where a CEX wallet IS in the visible slice). Use whichever share is larger.
    const cexNameOf = (owner) => cexWalletNames.get(owner) || KNOWN_CEX_WALLETS[owner] || null;
    const cexTop10ShareHelius = supplyTokens > 0
      ? largestRaw.slice(0, 10).filter(a => cexNameOf(a.owner)).reduce((s, a) => s + (parseFloat(a.uiAmount) || 0), 0) / supplyTokens
      : 0;
    const concentrationExCex = top10Share != null ? Math.max(0, top10Share - cexTop10ShareHelius) : null;
    const cexPresence = cexExchanges.length ? { exchanges: cexExchanges, top10Share: cexTop10Share } : null;

    const symbol = topPair?.baseToken?.symbol || "UNKNOWN";
    const name = topPair?.baseToken?.name || symbol;
    const priceUsd = topPair ? parseFloat(topPair.priceUsd) : null;
    const fdv = topPair?.fdv || null;
    const marketCap = topPair?.marketCap || null;
    // Turnover = 24h volume ÷ market cap. The honest "is it trading?" signal:
    // $1K/day is healthy for a $100K token (1%) but near-dead for a $40M one
    // (0.0025%). Absolute volume thresholds can't compare across sizes — turnover
    // can. Falls back to FDV when MC is missing; null when neither is known.
    const mcapForTurnover = marketCap || fdv || null;
    const turnover = (mcapForTurnover && mcapForTurnover > 0) ? totalVol24h / mcapForTurnover : null;

    // --- LP burn/lock status (classic rug vector) ---
    // Solana Tracker reports per-pool `lpBurn` = % of the pool's LP tokens that
    // are burned/locked. 100 = liquidity permanently locked (cannot be pulled);
    // low = the LP is still dev-controlled and the pool can be rugged. For
    // bonding-curve pools, liquidity is program-custodied until graduation, so
    // the classic LP-rug doesn't apply yet.
    let lpStatus = null;
    try {
      const stInfo = await solanaTracker.getTokenInfo(mint); // cached (1h)
      const liqOf = p => ((p.liquidity || {}).usd) || 0;
      const stPools = (Array.isArray(stInfo?.pools) ? stInfo.pools : []).filter(p => liqOf(p) > 0);
      if (stPools.length) {
        const totalLiq = stPools.reduce((s, p) => s + liqOf(p), 0);
        const primary = stPools.reduce((b, p) => (liqOf(p) > liqOf(b) ? p : b), stPools[0]);
        const primaryShare = totalLiq > 0 ? liqOf(primary) / totalLiq : 1;
        const meaningfulPools = stPools.filter(p => totalLiq > 0 && liqOf(p) / totalLiq >= 0.05).length; // pools holding ≥5% of liq
        const lpBurnPct = primary.lpBurn != null ? Number(primary.lpBurn) : null;
        const lpMarket = primary.market || null;
        const onCurveMkt = solanaTracker.isLaunchpadCurveMarket(lpMarket);
        // Concentrated-liquidity AMMs (Raydium CLMM, Meteora DLMM, Orca Whirlpool)
        // hold liquidity as NFT positions, not fungible LP tokens — there is
        // nothing to "burn", so a 0% lpBurn there is a NON-signal, not a rug flag.
        const concentratedMkt = /clmm|dlmm|whirlpool/i.test(String(lpMarket || ""));
        // Liquidity-weighted burn across every pool that reports a burn %.
        let wNum = 0, wDen = 0;
        for (const p of stPools) { const liq = liqOf(p); if (p.lpBurn != null && liq > 0) { wNum += Number(p.lpBurn) * liq; wDen += liq; } }
        const weightedBurn = wDen > 0 ? wNum / wDen : null;
        // "Distributed" = an established multi-pool token where no SINGLE pool's
        // lock % is a ruggability verdict (the BONK case: liquidity across ~40 pools).
        const distributed = meaningfulPools >= 3 || primaryShare < 0.6;
        let status, label;
        if (onCurveMkt) {
          status = "curve";
          label = "Liquidity is custodied in the launchpad bonding curve — program-locked until graduation, not dev-withdrawable. Classic LP-rug doesn't apply at this stage.";
        } else if (distributed) {
          status = "distributed";
          const wb = weightedBurn != null ? ` (~${weightedBurn.toFixed(0)}% liquidity-weighted LP burned across pools)` : "";
          label = `Liquidity is spread across ${meaningfulPools} significant pools of ${stPools.length} total${wb}. LP-lock analysis is most meaningful for single-pool launch tokens; for an established multi-pool token, no single pool's lock status determines ruggability — review each major pool on its own.`;
        } else if (concentratedMkt && (lpBurnPct == null || lpBurnPct < 50)) {
          status = "na";
          label = `The main pool is a concentrated-liquidity market (${lpMarket}), which holds liquidity as NFT positions rather than burnable LP tokens — the LP-burn metric doesn't apply, so a low value here is not a rug signal.`;
        } else if (lpBurnPct == null) {
          status = "unknown";
          label = "LP lock/burn status couldn't be determined for this pool type.";
        } else if (lpBurnPct >= 99) {
          status = "burned";
          label = "LP tokens are ~100% burned — pool liquidity is permanently locked and cannot be pulled. Strongest liquidity-safety signal.";
        } else if (lpBurnPct >= 50) {
          status = "partial";
          label = `~${lpBurnPct.toFixed(0)}% of LP is burned/locked — the remainder is still dev-withdrawable.`;
        } else {
          status = "unlocked";
          label = `Only ~${lpBurnPct.toFixed(0)}% of the main pool's LP is burned — that pool's liquidity is largely withdrawable by whoever holds the LP tokens. A pull risk unless it's locked elsewhere; weigh it against the token's age and how liquidity is spread across pools.`;
        }
        lpStatus = { lpBurnPct, weightedBurn, market: lpMarket, status, label, poolCount: stPools.length, meaningfulPools, primaryShare: Math.round(primaryShare * 100) };
      }
    } catch (e) { console.warn("[AUTOPSY] LP-lock check failed:", e.message); }

    // --- Metadata mutability + update authority (bait-and-switch rug vector) ---
    // A mutable token lets whoever holds the update authority change the name,
    // symbol, image and socials AFTER launch. On launchpad tokens (Bags/Pump/etc.)
    // the PLATFORM holds that authority by design — normal, not a dev risk. On a
    // hand-rolled mint, a still-active non-platform authority is the real
    // bait-and-switch vector. Helius DAS getAsset gives mutability + authority.
    let metadataStatus = null;
    try {
      const ga = await rpcCall("autopsy-getasset", "getAsset", { id: mint });
      const asset = ga?.result || null;
      if (asset && typeof asset.mutable === "boolean") {
        const fullAuth = (asset.authorities || []).find(a => Array.isArray(a.scopes) && a.scopes.includes("full")) || (asset.authorities || [])[0] || null;
        const updateAuthority = fullAuth?.address || null;
        const mintLc = mint.toLowerCase();
        const launchpadMint = mintLc.endsWith("pump") || mintLc.endsWith("bags") || mintLc.endsWith("bonk") || mintLc.endsWith("moon");
        const platformHeld = (updateAuthority || "").startsWith("BAGS") || launchpadMint;
        let status, label;
        if (!asset.mutable) {
          status = "immutable";
          label = "Metadata is immutable — name, symbol, image and links are permanently locked and can't be changed.";
        } else if (platformHeld) {
          status = "mutable-platform";
          label = "Metadata is mutable, but the update authority is held by the launchpad platform (standard for Bags/Pump launches) — the team can't unilaterally rebrand the token.";
        } else {
          status = "mutable-risk";
          label = `Metadata is mutable and the update authority${updateAuthority ? ` (${updateAuthority.slice(0, 4)}…${updateAuthority.slice(-4)})` : ""} is not a launchpad platform — the name, image and links can be changed after launch (bait-and-switch vector). Verify who controls it before trusting the branding.`;
        }
        metadataStatus = { mutable: asset.mutable, updateAuthority, platformHeld, status, label };
      }
    } catch (e) { console.warn("[AUTOPSY] metadata mutability check failed:", e.message); }

    // --- Red flags (factual, not invented) ---
    const redFlags = [];
    if (mintAuthority) redFlags.push("Mint authority is still active — the creator can print more supply at any time.");
    if (freezeAuthority) redFlags.push("Freeze authority is still active — individual wallets can be frozen.");
    for (const r of token2022Risks) redFlags.push(r.msg);
    if (concentrationExCex !== null && concentrationExCex > 0.5) redFlags.push(`Top 10 wallets hold roughly ${(concentrationExCex * 100).toFixed(0)}% of supply${cexPresence ? " (excluding exchange-custodied holdings)" : ""} — heavy concentration.`);
    // Low turnover for a sizable token — thin trading relative to its market cap.
    if (turnover !== null && (marketCap || 0) >= 1000000 && turnover < 0.0005 && totalVol24h < 25000) redFlags.push(`24h volume is only ${(turnover * 100).toFixed(3)}% of market cap — very low turnover for a $${(marketCap / 1e6).toFixed(1)}M token; trading interest is thin relative to its size (exit at size may be hard).`);
    if (totalLiqUsd > 0 && totalLiqUsd < 500) redFlags.push(`Pool liquidity is only $${totalLiqUsd.toFixed(0)} — there is effectively no exit at size.`);
    if (totalLiqUsd === 0 && solPairs.length > 0) redFlags.push("DexScreener shows pools but zero current liquidity — the LP has been pulled or migrated.");
    if (lpStatus && lpStatus.status === "unlocked") redFlags.push(`Liquidity is NOT locked — only ~${lpStatus.lpBurnPct.toFixed(0)}% of LP tokens are burned, so whoever holds the LP can withdraw the pool (classic rug vector). Verify it's locked elsewhere before trusting the depth.`);
    else if (lpStatus && lpStatus.status === "partial" && lpStatus.lpBurnPct < 80) redFlags.push(`Only ~${lpStatus.lpBurnPct.toFixed(0)}% of LP is burned/locked — the rest is dev-withdrawable.`);
    if (metadataStatus && metadataStatus.status === "mutable-risk") redFlags.push(metadataStatus.label);
    if (solPairs.length === 0) redFlags.push("No DexScreener pool found at all — the token never launched a tradeable market, or it has been delisted.");
    if (buys24h > 20 && sells24h === 0) redFlags.push(`${buys24h} buys today and zero sells — classic restricted-sell / honeypot pattern.`);
    if (buys24h > 0 && sells24h > 0 && buys24h / sells24h > 10) redFlags.push(`Buys outpace sells ${buys24h}-to-${sells24h} — sells may be partially restricted.`);
    if (ageDays !== null && ageDays > 7 && txns24h < 5 && totalLiqUsd > 0) redFlags.push("Activity has gone near-silent but the pool still technically exists — quiet-fade pattern.");

    // --- Verdict classification (heuristic, ordered) ---
    // Honesty rule: "Cause of Death" framing is reserved for tokens that are
    // genuinely dead — no pool, honeypot, drained LP, or true quiet-fade
    // (silent AND collapsed AND tiny). A still-trading token with a real
    // market cap in a drawdown is RETRACED, not dead. The earlier verdict
    // would mislabel a $68K-MC token as "QUIET FADE" off a single slow-volume
    // day — that's wrong, and we said it wouldn't happen.
    let verdict;
    if (solPairs.length === 0) {
      verdict = { type: "GHOST", label: "Cause of Death: NEVER LAUNCHED", severity: "DEAD", color: "#6B7280", icon: "👻" };
    } else if (hasHoneypotExtension) {
      // Proactive: a non-transferable / default-frozen / active-transfer-hook /
      // ~100% transfer-fee Token-2022 mint is a honeypot by construction — flag
      // it before it has to trap 20 buyers behaviorally.
      verdict = { type: "HONEYPOT", label: "Cause of Death: HONEYPOT (Token-2022)", severity: "DEAD", color: "#EF4444", icon: "🪤" };
    } else if (buys24h >= 20 && sells24h === 0 && totalLiqUsd > 0) {
      verdict = { type: "HONEYPOT", label: "Cause of Death: HONEYPOT", severity: "DEAD", color: "#EF4444", icon: "🪤" };
    } else if (totalLiqUsd < 500 && ageDays !== null && ageDays > 1) {
      verdict = { type: "LP_RUG", label: "Cause of Death: LP RUG", severity: "DEAD", color: "#EF4444", icon: "💀" };
    } else if (
      // True QUIET FADE: all of: older than 7 days, near-zero 24h volume AND
      // near-zero 24h transactions AND tiny market cap (≤ $25K). A slow day
      // alone is not death.
      ageDays !== null && ageDays > 7 &&
      totalVol24h < 50 && txns24h < 5 &&
      totalLiqUsd >= 500 &&
      (marketCap === null || marketCap <= 25000)
    ) {
      verdict = { type: "SOFT_RUG", label: "Cause of Death: QUIET FADE", severity: "DYING", color: "#F59E0B", icon: "🐌" };
    } else if (mintAuthority || freezeAuthority || hasSevereExtension || (concentrationExCex !== null && concentrationExCex > 0.5)) {
      verdict = { type: "AT_RISK", label: "Status: ALIVE BUT AT RISK", severity: "AT_RISK", color: "#F59E0B", icon: "⚠️" };
    } else if (totalLiqUsd >= 5000 && totalVol24h >= 100 && (turnover === null || turnover >= 0.001 || totalVol24h >= 25000)) {
      // Needs healthy liquidity + real volume, AND — when we know the market cap —
      // at least 0.1% daily turnover. Keeps a healthy microcap ALIVE (vol ≥ $100
      // on a ≤$100K token already clears 0.1%) while a bloated-MC token doing
      // pocket-change volume drops to UNCLEAR instead of a false "ALIVE". The
      // ≥$25K absolute-volume escape protects obviously-trading tokens when the
      // market cap is unreliable (e.g. DexScreener phantom-pool / decimals quirks).
      verdict = { type: "ALIVE", label: "Status: ALIVE & TRADING", severity: "ALIVE", color: "#10B981", icon: "🐔" };
    } else {
      verdict = { type: "UNCLEAR", label: "Status: UNCLEAR", severity: "UNCLEAR", color: "#6B7280", icon: "❓" };
    }

    // --- Report mode: autopsy framing only fits dead/dying tokens ---
    // For an alive token, calling the page a "Token Autopsy" is wrong. Cluck
    // came with a scalpel — but the patient is breathing. Swap the framing
    // to a Full Health Checkup. Same forensic depth, honest framing.
    let reportMode;
    let reportHeadline;
    let reportSubhead;
    if (verdict.severity === "ALIVE") {
      reportMode = "health-checkup";
      reportHeadline = "🚫 AUTOPSY CANCELED";
      reportSubhead = "Patient is alive and trading. Pulled out the scalpel, didn't need it. This is a Full Health Checkup instead.";
    } else if (verdict.severity === "AT_RISK") {
      reportMode = "health-assessment";
      reportHeadline = "⚠️ AUTOPSY ON STANDBY";
      reportSubhead = "Patient is alive but showing warning signs. Health Assessment with concerns.";
    } else if (verdict.type === "RETRACED") {
      reportMode = "health-assessment";
      reportHeadline = "📉 AUTOPSY ON STANDBY";
      reportSubhead = "Patient is alive but heavily bruised. Health Assessment of a token in a drawdown.";
    } else if (verdict.severity === "UNCLEAR") {
      reportMode = "autopsy";
      reportHeadline = "🔬 TOKEN AUTOPSY";
      reportSubhead = verdict.label;
    } else {
      // DEAD or DYING — true autopsy framing.
      reportMode = "autopsy";
      reportHeadline = "🔬 TOKEN AUTOPSY";
      reportSubhead = verdict.label;
    }

    // --- Linked lessons from the school ---
    const lessonMap = {
      GHOST:     [{ id: "rugs", title: "Lesson 2 — Rugs & Scams" }, { id: "onchain", title: "Lesson 9 — On-Chain Analysis" }],
      HONEYPOT:  [{ id: "rugs", title: "Lesson 2 — Rugs & Scams" }, { id: "tokenomics", title: "Lesson 6 — Tokenomics" }],
      LP_RUG:    [{ id: "rugs", title: "Lesson 2 — Rugs & Scams" }, { id: "onchain", title: "Lesson 9 — On-Chain Analysis" }],
      SOFT_RUG:  [{ id: "onchain", title: "Lesson 9 — On-Chain Analysis" }, { id: "volatility", title: "Lesson 3 — Volatility & Weak Hands" }],
      RETRACED:  [{ id: "volatility", title: "Lesson 3 — Volatility & Weak Hands" }, { id: "marketcap", title: "Lesson 7 — Market Cap vs Price" }],
      AT_RISK:   [{ id: "tokenomics", title: "Lesson 6 — Tokenomics" }, { id: "rugs", title: "Lesson 2 — Rugs & Scams" }],
      CREATOR_EXTRACTED: [{ id: "rugs", title: "Lesson 2 — Rugs & Scams" }, { id: "tokenomics", title: "Lesson 6 — Tokenomics" }],
      ALIVE:     [{ id: "marketcap", title: "Lesson 7 — Market Cap vs Price" }],
      UNCLEAR:   [],
    };
    const lessons = lessonMap[verdict.type] || [];

    // --- Phase 2B: Lifetime Analysis ---
    // Walk the mint's signature history back to genesis, sample parsed
    // transactions across the lifetime, classify event types (mints / burns /
    // large transfers), and surface a chronological timeline of the
    // highest-impact moments. This is the part that makes the autopsy feel
    // like an agent that actually investigated the chain over time.
    let lifetime = null;
    let priceHistory = null;
    // Hoisted out so Phase 2F (P&L ledger) can reuse the lifetime walk + price candles.
    let lifetimeAllSigs = [];
    const priceCandlesByDay = new Map(); // dayKey (floor ts/86400000) → close price USD
    try {
      const MAX_SIG_PAGES = 5;
      const allSigs = [];
      let before = undefined;
      for (let page = 0; page < MAX_SIG_PAGES; page++) {
        const params = before ? [mint, { limit: 1000, before }] : [mint, { limit: 1000 }];
        const sigsRes = await rpcCall(`autopsy-mint-sigs-${page}`, "getSignaturesForAddress", params);
        const sigs = sigsRes?.result || [];
        if (sigs.length === 0) break;
        allSigs.push(...sigs);
        if (sigs.length < 1000) break;
        before = sigs[sigs.length - 1].signature;
      }
      const truncated = allSigs.length >= MAX_SIG_PAGES * 1000;
      // Hoist for Phase 2F (P&L engine).
      lifetimeAllSigs = allSigs;

      let genesisTimestamp = null;
      let genesisSig = null;
      if (allSigs.length > 0) {
        const oldest = allSigs[allSigs.length - 1];
        genesisTimestamp = oldest.blockTime ? oldest.blockTime * 1000 : null;
        genesisSig = oldest.signature;
      }

      // Sample signatures across the lifetime to fetch parsed details for.
      // Sampling instead of fetching all 5000 keeps response time reasonable
      // while still surfacing major events across the token's history.
      const sample = new Set();
      if (allSigs.length > 0) {
        // Oldest 10 (around launch — where mint events and initial LP add live)
        for (let i = Math.max(0, allSigs.length - 10); i < allSigs.length; i++) {
          sample.add(allSigs[i].signature);
        }
        // Most recent 10 (current activity)
        for (let i = 0; i < Math.min(10, allSigs.length); i++) {
          sample.add(allSigs[i].signature);
        }
        // 20 evenly-spaced middle samples
        if (allSigs.length > 40) {
          const step = Math.floor(allSigs.length / 22);
          for (let i = 1; i < 21; i++) {
            const idx = step * i;
            if (idx < allSigs.length) sample.add(allSigs[idx].signature);
          }
        }
      }
      const sampleArr = [...sample];

      // Batch-fetch parsed transactions via Helius Enhanced API (one call, up
      // to 100 sigs at a time — way faster than getTransaction one-by-one).
      let parsedTxs = [];
      if (sampleArr.length > 0) {
        try {
          const heliusUrl = `https://api.helius.xyz/v0/transactions?api-key=${HELIUS_KEY}`;
          const parsedRes = await fetch(heliusUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ transactions: sampleArr.slice(0, 100) })
          });
          const data = await parsedRes.json();
          if (Array.isArray(data)) parsedTxs = data;
        } catch (e) {
          console.warn("[AUTOPSY] Helius enhanced parse failed:", e.message);
        }
      }

      // Classify each parsed tx — mint events, burns, large transfers
      const events = [];
      for (const tx of parsedTxs) {
        if (!tx || tx.transactionError) continue;
        const ts = tx.timestamp ? tx.timestamp * 1000 : null;
        // Token mint events targeting OUR mint = potential dilution
        if (tx.type === "TOKEN_MINT" && Array.isArray(tx.tokenTransfers)) {
          for (const tt of tx.tokenTransfers) {
            if (tt.mint === mint) {
              events.push({
                type: "MINT_EVENT",
                timestamp: ts,
                signature: tx.signature,
                amount: tt.tokenAmount,
                to: tt.toUserAccount,
                description: `${Number(tt.tokenAmount || 0).toLocaleString()} ${symbol} minted${tt.toUserAccount ? ` to ${tt.toUserAccount.slice(0, 6)}…` : ""}`
              });
            }
          }
        }
        // Burn events
        if (tx.type === "BURN" || tx.type === "TOKEN_BURN") {
          if (Array.isArray(tx.tokenTransfers)) {
            for (const tt of tx.tokenTransfers) {
              if (tt.mint === mint) {
                events.push({
                  type: "BURN_EVENT",
                  timestamp: ts,
                  signature: tx.signature,
                  amount: tt.tokenAmount,
                  description: `${Number(tt.tokenAmount || 0).toLocaleString()} ${symbol} burned`
                });
              }
            }
          }
        }
        // Large transfers — >1% of supply moved in a single tx
        if (supplyTokens > 0 && Array.isArray(tx.tokenTransfers)) {
          for (const tt of tx.tokenTransfers) {
            if (tt.mint === mint && tt.tokenAmount > supplyTokens * 0.01) {
              events.push({
                type: "LARGE_TRANSFER",
                timestamp: ts,
                signature: tx.signature,
                amount: tt.tokenAmount,
                from: tt.fromUserAccount,
                to: tt.toUserAccount,
                description: `${((tt.tokenAmount / supplyTokens) * 100).toFixed(2)}% of supply moved${tt.fromUserAccount ? ` from ${tt.fromUserAccount.slice(0, 6)}…` : ""}${tt.toUserAccount ? ` to ${tt.toUserAccount.slice(0, 6)}…` : ""}`
              });
            }
          }
        }
      }

      // Always include the genesis as the bottom event
      if (genesisTimestamp) {
        events.push({
          type: "GENESIS",
          timestamp: genesisTimestamp,
          signature: genesisSig,
          description: `${symbol} mint created on Solana`
        });
      }

      // Dedupe by signature, sort newest-first, cap at 15
      const seenSigs = new Set();
      const keyEvents = events
        .filter(e => e.timestamp && e.signature && !seenSigs.has(e.signature) && seenSigs.add(e.signature))
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 15);

      const postGenesisMints = keyEvents.filter(e => e.type === "MINT_EVENT");
      if (postGenesisMints.length > 0) {
        redFlags.push(`${postGenesisMints.length} post-launch mint event(s) detected — the mint authority was actively used to print supply after launch.`);
      }

      // Detect whether the token went through a bonding-curve phase before
      // its DEX pool existed. Bags.fm tokens graduate from Meteora DBC; Pump.fun
      // tokens graduate from their own bonding curve program. Critically, we
      // restrict detection to the OLDEST sampled txs — checking all sampled txs
      // produces false positives because Jupiter aggregator sometimes routes
      // post-graduation trades through PumpSwap's AMM, which is NOT the same as
      // the token having had a Pump.fun bonding curve.
      const BAGS_DBC = "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN";       // Meteora DBC (Bags bonding curve)
      const PUMP_FUN_BC = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";    // Pump.fun bonding curve program
      // Sort sampled parsed txs by timestamp ascending, only check the oldest
      // 15 (genesis era) for bonding-curve program activity.
      const earlyTxs = parsedTxs
        .filter(t => t && t.timestamp)
        .sort((a, b) => a.timestamp - b.timestamp)
        .slice(0, 15);
      let bondingCurveDetected = false;
      let bondingCurveSource = null;
      for (const tx of earlyTxs) {
        const accounts = tx?.accountData || [];
        const instructions = tx?.instructions || [];
        const checkSet = new Set();
        accounts.forEach(a => a?.account && checkSet.add(a.account));
        instructions.forEach(ix => ix?.programId && checkSet.add(ix.programId));
        if (checkSet.has(BAGS_DBC)) { bondingCurveDetected = true; bondingCurveSource = "Bags.fm (Meteora DBC)"; break; }
        if (checkSet.has(PUMP_FUN_BC)) { bondingCurveDetected = true; bondingCurveSource = "Pump.fun"; break; }
      }

      // --- Total burned aggregation (cumulative, from sampled events) ---
      const burnedFromEvents = keyEvents
        .filter(e => e.type === "BURN_EVENT")
        .reduce((s, e) => s + (Number(e.amount) || 0), 0);

      // --- Airdrop / dust-drop detection ---
      // A single tx with many tokenTransfers from the SAME source = a bulk
      // distribution event. We classify each by recipient count and per-recipient
      // amount: dust drops (tiny amounts, designed to inflate holder count) vs
      // real airdrops (meaningful amounts to many wallets).
      const airdropEvents = [];
      for (const tx of parsedTxs) {
        if (!tx || !Array.isArray(tx.tokenTransfers)) continue;
        const mineForMint = tx.tokenTransfers.filter(tt => tt && tt.mint === mint);
        if (mineForMint.length < 5) continue; // need at least 5 transfers to call it bulk
        const bySource = {};
        for (const tt of mineForMint) {
          if (!tt.fromUserAccount) continue;
          (bySource[tt.fromUserAccount] = bySource[tt.fromUserAccount] || []).push(tt);
        }
        for (const [src, transfers] of Object.entries(bySource)) {
          if (transfers.length < 5) continue;
          const totalAmount = transfers.reduce((s, tt) => s + (Number(tt.tokenAmount) || 0), 0);
          const avgPerRecipient = totalAmount / transfers.length;
          const sharePerRecipient = supplyTokens > 0 ? avgPerRecipient / supplyTokens : 0;
          // Dust drop: each recipient gets less than 0.0001% of supply
          const kind = sharePerRecipient < 0.000001 ? "dust" : "airdrop";
          airdropEvents.push({
            timestamp: tx.timestamp ? tx.timestamp * 1000 : null,
            signature: tx.signature,
            source: src,
            recipients: transfers.length,
            totalAmount,
            avgPerRecipient,
            kind,
          });
        }
      }
      const dustDropCount = airdropEvents.filter(a => a.kind === "dust").length;
      if (dustDropCount > 0) {
        const totalDustRecipients = airdropEvents.filter(a => a.kind === "dust").reduce((s, a) => s + a.recipients, 0);
        redFlags.push(`${dustDropCount} dust-drop event(s) detected (~${totalDustRecipients} dust recipients) — pattern often used to inflate holder count artificially.`);
      }

      // --- Creator wallet detection ---
      // Use the fee payer of the genesis transaction as the creator wallet
      // proxy. Helius enhanced parsed txs include the feePayer field.
      let creatorWallet = null;
      if (genesisSig) {
        const genesisTx = parsedTxs.find(t => t?.signature === genesisSig);
        if (genesisTx?.feePayer) creatorWallet = genesisTx.feePayer;
      }

      lifetime = {
        genesisTimestamp,
        genesisSignature: genesisSig,
        totalKnownSignatures: allSigs.length,
        signatureHistoryTruncated: truncated,
        keyEvents,
        bondingCurveDetected,
        bondingCurveSource,
        totalBurnedObserved: burnedFromEvents,
        airdropEvents,
        creatorWallet,
      };
    } catch (e) {
      console.warn("[AUTOPSY] lifetime analysis failed:", e.message);
    }

    // --- Phase 2B: Historical price + market cap via GeckoTerminal OHLCV ---
    // DexScreener gives us current snapshot. GeckoTerminal lets us pull daily
    // candles across the lifetime — we use that to find the peak price/MC and
    // the drawdown to "now," which is the missing context that turns a number
    // into a story.
    if (topPair && topPair.pairAddress) {
      try {
        const gtUrl = `https://api.geckoterminal.com/api/v2/networks/solana/pools/${topPair.pairAddress}/ohlcv/day?aggregate=1&limit=365`;
        const gtRes = await fetch(gtUrl);
        const gtData = await gtRes.json();
        const candles = gtData?.data?.attributes?.ohlcv_list || [];
        if (candles.length > 0) {
          // Each candle = [timestamp_seconds, open, high, low, close, volume]
          // Use the daily CLOSE (where price actually settled) not the daily HIGH
          // (which can be a single-tick spike during a thin candle). The close
          // is what the token genuinely traded at by end of that day — the
          // honest forensic answer to "what was the peak."
          let peakPrice = 0, peakTs = 0;
          for (const c of candles) {
            const close = Number(c[4]) || 0;
            const tsSec = Number(c[0]) || 0;
            if (close > peakPrice) { peakPrice = close; peakTs = tsSec * 1000; }
            // Stash for Phase 2F P&L valuation — index by UTC day key.
            if (tsSec > 0 && close > 0) {
              const dayKey = Math.floor((tsSec * 1000) / 86400000);
              priceCandlesByDay.set(dayKey, close);
            }
          }
          const currentPrice = priceUsd || (candles[0] && Number(candles[0][4])) || 0;
          const drawdownPct = peakPrice > 0 ? ((currentPrice - peakPrice) / peakPrice) * 100 : null;
          const peakMarketCap = supplyTokens > 0 && peakPrice > 0 ? peakPrice * supplyTokens : null;
          // Multi-window volume sums from the same daily candles we already
          // walked above — no extra API call. This gives an honest "is this
          // token actually being traded over a longer window" signal so a
          // single quiet 24h doesn't make a healthy token look UNCLEAR. We
          // bucket by candle age in ms rather than array index because
          // GeckoTerminal's return order isn't documented and can drift.
          const nowMs = Date.now();
          let vol24h = 0, vol48h = 0, vol7d = 0, vol30d = 0;
          for (const c of candles) {
            const tsMs = (Number(c[0]) || 0) * 1000;
            const volUsd = Number(c[5]) || 0;
            const ageMs = nowMs - tsMs;
            if (ageMs < 0) continue;
            if (ageMs <= 1 * 86400000)  vol24h += volUsd;
            if (ageMs <= 2 * 86400000)  vol48h += volUsd;
            if (ageMs <= 7 * 86400000)  vol7d  += volUsd;
            if (ageMs <= 30 * 86400000) vol30d += volUsd;
          }
          priceHistory = {
            peakPrice,
            peakTimestamp: peakTs,
            peakMarketCap,
            currentPrice,
            drawdownFromPeakPct: drawdownPct,
            candleCount: candles.length,
            // Multi-window volume context. Use these to spot tokens that
            // look quiet today but are clearly trading over the week or
            // month. Verdict ladder uses vol7d to promote UNCLEAR → ALIVE
            // when there's real cumulative activity.
            volumeWindows: { vol24h, vol48h, vol7d, vol30d },
          };
          if (drawdownPct !== null && drawdownPct < -90 && peakPrice > 0) {
            redFlags.push(`Down ${drawdownPct.toFixed(0)}% from all-time high — price has effectively collapsed from peak.`);
          } else if (drawdownPct !== null && drawdownPct < -70 && peakPrice > 0) {
            redFlags.push(`Down ${drawdownPct.toFixed(0)}% from all-time high — significant retracement.`);
          }
        }
      } catch (e) {
        console.warn("[AUTOPSY] GeckoTerminal OHLCV failed:", e.message);
      }
    }

    // --- Verdict re-classification with priceHistory in hand ---
    // The first-pass verdict couldn't see drawdown-from-peak. Now we can.
    // Upgrade a generic UNCLEAR / SOFT_RUG to RETRACED when the token is
    // still trading at a real market cap but is heavily off its highs — the
    // honest framing for "I know it went really high but is it really that bad?"
    if (
      priceHistory && priceHistory.drawdownFromPeakPct !== null &&
      priceHistory.drawdownFromPeakPct < -70 &&
      totalLiqUsd >= 500 &&
      (marketCap === null || marketCap > 25000) &&
      (verdict.type === "UNCLEAR" || verdict.type === "SOFT_RUG" || verdict.type === "AT_RISK")
    ) {
      verdict = { type: "RETRACED", label: "Status: HEAVILY RETRACED — STILL TRADING", severity: "AT_RISK", color: "#F59E0B", icon: "📉" };
      // Refresh report mode for the upgraded verdict.
      reportMode = "health-assessment";
      reportHeadline = "📉 AUTOPSY ON STANDBY";
      reportSubhead = "Patient is alive but heavily bruised. Health Assessment of a token in a drawdown.";
    }

    // --- Verdict promotion: low 24h volume but healthy weekly trading ---
    // The first-pass ALIVE rule requires DexScreener 24h volume ≥ $100, which
    // mislabels two kinds of token as UNCLEAR:
    //  1. A healthy token after a single quiet day (7d volume is fine).
    //  2. A FRESH graduating pump.fun token DexScreener hasn't indexed yet —
    //     it shows $0 DexScreener liquidity/volume even while trading heavily
    //     on its new pool (we see the real volume via GeckoTerminal candles).
    // Promote UNCLEAR → ALIVE when EITHER:
    //  • vol7d is substantial (≥ $5k) — that volume PROVES liquidity exists
    //    (you can't trade $5k+/wk against nothing), so missing DexScreener
    //    liquidity data doesn't mean the token is dead; OR
    //  • vol7d ≥ $700 AND DexScreener confirms liquidity ≥ $5k (the original
    //    quiet-day case).
    const vw = priceHistory && priceHistory.volumeWindows;
    if (
      vw && verdict.type === "UNCLEAR" && (
        vw.vol7d >= 5000 ||
        (vw.vol7d >= 700 && totalLiqUsd >= 5000)
      )
    ) {
      verdict = { type: "ALIVE", label: "Status: ALIVE & TRADING", severity: "ALIVE", color: "#10B981", icon: "🐔" };
      reportMode = "health-checkup";
      reportHeadline = "🚫 AUTOPSY CANCELED";
      reportSubhead = "Patient is alive and trading. Full Health Checkup of a token doing fine.";
    }
    // Refresh lessons after potential verdict upgrade.
    const lessonsFinal = lessonMap[verdict.type] || lessons;

    // --- Phase 2A: Top Holders Forensic Panel ---
    // Take the top 10 token accounts and:
    //   1) Look up each token account's "authority" (.data.parsed.info.owner)
    //   2) Look up that authority's program-owner — System Program = human wallet;
    //      a DEX program = LP; a known locker program = locked; the SPL Token
    //      program itself = self-owned lock (permanent).
    //   3) For human-wallet holders, walk their token account's signature history,
    //      grab the OLDEST signature (their first interaction with this token),
    //      and fetch that transaction to find how much they first received.
    //   4) Classify acquisition timing (sniper / very_early / early / first_week
    //      / later) vs the token's pool-creation timestamp, and behavior
    //      (HELD / ACCUMULATED / REDUCED / EXITED_MOSTLY) by comparing the
    //      first-received amount to their current balance.
    const AUTOPSY_SYS_PROGRAM = "11111111111111111111111111111111";
    let topHolders = [];
    const holderBreakdown = { sniper: 0, very_early: 0, early: 0, first_week: 0, later: 0, pre_pool: 0, bonding_curve: 0, locker: 0, lp: 0, selflock: 0, program: 0 };
    // Hoisted: bagsInfo / pumpInfo are populated later (Phase 2D / 2E) but
    // bondingCurveActive needs the references here. Avoid TDZ by declaring early.
    let bagsInfo = null;
    let creatorVerification = null;   // Bags creator social-verification signal (set once bagsInfo resolves)
    let pumpInfo = null;
    const dbcBuyerSet = new Set();
    // Bags/Pump-verified bonding curve gets priority over the on-chain heuristic.
    // Read as a function so it picks up bagsInfo/pumpInfo once they're populated.
    // Did this token launch through a bonding curve (Bags DBC / Pump.fun)?
    // If so, holders who acquired "before the DEX pool" bought ON THE CURVE
    // before graduation — a legitimate early-buyer path, NOT pre-launch
    // insiders. lifetime.bondingCurveDetected is unreliable (only fires if the
    // sampled sig-walk happened to catch the DBC program), so we also trust
    // the mint-suffix vanity conventions: Pump.fun mints end "pump", Bags
    // mints commonly end "BAGS". Either is definitive enough to treat
    // pre-pool acquisition as bonding-curve buying, not insider allocation.
    const MINT_LOWER = (mint || "").toLowerCase();
    const isLaunchpadMint = MINT_LOWER.endsWith("pump") || MINT_LOWER.endsWith("bags") || MINT_LOWER.endsWith("bonk") || MINT_LOWER.endsWith("moon");
    const bondingCurveActive = () => !!(lifetime && lifetime.bondingCurveDetected)
      || !!(bagsInfo && bagsInfo.dbcBuyersIdentified > 0)
      || !!(pumpInfo && pumpInfo.bcBuyersIdentified > 0)
      || isLaunchpadMint;
    const behaviorBreakdown = { HELD: 0, ACCUMULATED: 0, REDUCED: 0, EXITED_MOSTLY: 0, UNKNOWN: 0 };
    let lockedSupplyShare = 0;
    // Authoritative locked-token COUNT from holder classification. This is
    // the reliable source — it sums actual current balances held in locker
    // PDAs (Jupiter Lock / Streamflow / self-owned locks), unlike the Phase
    // 2G creator-trace which only catches lock DEPOSITS the creator wallet
    // made inside our signature scan window (and badly under-counts: 60M
    // traced vs 145M actually locked for CLKN). The /api/locks endpoint
    // can't be used here — it queries by owner=JUPITER_LOCK_PROGRAM which
    // returns 0 because Jupiter Lock holds tokens in PDAs, not under the
    // program ID directly.
    let lockedSupplyTokens = 0;
    let humanSupplyShare = 0;
    try {
      const TOP_N = 100;
      const targets = largestRaw.slice(0, TOP_N);
      if (targets.length > 0) {
        // Step 1: Authority is already on each largestRaw entry (a.owner) —
        // skipped the per-token-account RPC because getTokenAccounts gave us
        // the wallet directly.
        const authorities = targets.map(a => a.owner);

        // Step 2: Authority → program owner (so we can classify). For 100
        // wallets that's potentially many getMultipleAccounts batches —
        // chunked into 100s as the RPC accepts.
        const uniqueAuths = [...new Set(authorities.filter(Boolean))];
        const authOwnerMap = new Map();
        for (let i = 0; i < uniqueAuths.length; i += 100) {
          const chunk = uniqueAuths.slice(i, i + 100);
          try {
            const authRes = await rpcCall(`autopsy-auths-${i}`, "getMultipleAccounts", [
              chunk, { encoding: "base64", dataSlice: { offset: 0, length: 0 } }
            ]);
            const authInfos = authRes?.result?.value || [];
            chunk.forEach((a, j) => authOwnerMap.set(a, authInfos[j]?.owner || null));
          } catch (e) {
            console.warn(`[AUTOPSY] auth batch ${i} failed:`, e.message);
          }
        }

        // Helper: determine if a pubkey is on the ed25519 curve (real wallet)
        // vs off-curve (a program-derived address / PDA). Matches the engine
        // the Holders tool uses to distinguish AMM pool-authority PDAs from
        // human wallets when both look "System Program owned" to a naive read.
        const isOnCurveSafe = (pk) => { try { return isOnCurve(pk); } catch { return false; } };

        topHolders = targets.map((acc, i) => {
          const auth = authorities[i];
          const authOwner = auth ? authOwnerMap.get(auth) : null;
          const uiAmount = parseFloat(acc.uiAmount) || 0;
          const share = supplyTokens > 0 ? uiAmount / supplyTokens : 0;
          let category, label;
          if (!auth) { category = "unknown"; label = "Unknown"; }
          // The full LP-vs-wallet logic, matching what the Holders engine does:
          //   on-curve = real ed25519 keypair → human wallet
          //   off-curve + (no account OR System-Program owned) → pool-authority PDA / LP
          //   off-curve + program owned → that program (locker / DEX / other)
          // An on-curve wallet with no account info just means it has never paid
          // for a SOL transaction (received tokens but no SOL itself) — still
          // a human wallet, NOT an LP.
          else if (!authOwner &&  isOnCurveSafe(auth)) { category = "wallet"; label = "Human wallet"; }
          else if (!authOwner && !isOnCurveSafe(auth)) { category = "lp";     label = "Liquidity pool"; }
          else if (authOwner === AUTOPSY_SYS_PROGRAM && !isOnCurveSafe(auth)) { category = "lp";     label = "Liquidity pool"; }
          else if (authOwner === AUTOPSY_SYS_PROGRAM) { category = "wallet"; label = "Human wallet"; }
          else if (DEX_PROGRAMS.has(authOwner)) { category = "lp"; label = PROGRAM_LABELS[authOwner] || "Liquidity pool"; }
          else if (LOCKER_PROGRAMS.has(authOwner)) { category = "locker"; label = PROGRAM_LABELS[authOwner] || "Token lock"; }
          else if (TOKEN_PROGRAMS.has(authOwner)) { category = "selflock"; label = "Self-owned lock (permanent)"; }
          else { category = "program"; label = PROGRAM_LABELS[authOwner] || "Program account"; }
          if (category === "locker" || category === "selflock") { lockedSupplyShare += share; lockedSupplyTokens += uiAmount; }
          if (category === "wallet") humanSupplyShare += share;
          return {
            rank: i + 1,
            tokenAccount: acc.address,
            authority: auth,
            uiAmount,
            share,
            category, label,
            firstAcquiredAt: null,
            firstAcquiredAmount: null,
            behavior: null,
            acquisitionTiming: null,
            sigCount: null,
          };
        });

        // Step 3: For each wallet holder, walk their token-account history (parallel)
        const walletHolders = topHolders.filter(h => h.category === "wallet");
        await Promise.allSettled(walletHolders.map(async (h, idx) => {
          try {
            const sigsRes = await rpcCall(`autopsy-sigs-${idx}`, "getSignaturesForAddress", [
              h.tokenAccount, { limit: 1000 }
            ]);
            const sigs = sigsRes?.result || [];
            h.sigCount = sigs.length;
            if (sigs.length === 0) return;
            const oldestSig = sigs[sigs.length - 1];
            h.firstAcquiredAt = oldestSig.blockTime ? oldestSig.blockTime * 1000 : null;
            h.firstAcquiredSignature = oldestSig.signature; // for acquisition-source attribution below
            // Acquisition timing vs pool launch
            if (h.firstAcquiredAt && pairCreatedMs) {
              const dms = h.firstAcquiredAt - pairCreatedMs;
              if (dms < -60_000) {
                // Had tokens before the current DEX pool existed. If the token
                // had a Bags/Pump bonding-curve phase, this means they bought
                // through the bonding curve (a legitimate early-supporter path,
                // not necessarily an insider pre-allocation).
                h.acquisitionTiming = bondingCurveActive() ? "bonding_curve" : "pre_pool";
              }
              else if (dms < 60_000) h.acquisitionTiming = "sniper";
              else if (dms < 3_600_000) h.acquisitionTiming = "very_early";
              else if (dms < 86_400_000) h.acquisitionTiming = "early";
              else if (dms < 7 * 86_400_000) h.acquisitionTiming = "first_week";
              else h.acquisitionTiming = "later";
            }
            // BAGS-VERIFIED OVERRIDE: if this wallet appears in the DBC pool's
            // buyer set (a fact, not an inference), upgrade their label from
            // "pre_pool"/"later" to "bonding_curve" with a verified flag.
            if (dbcBuyerSet.has(h.authority)) {
              h.dbcVerified = true;
              h.acquisitionTiming = "bonding_curve";
            }
            // Fetch first tx to read first-received amount
            const txRes = await rpcCall(`autopsy-tx-${idx}`, "getTransaction", [
              oldestSig.signature,
              { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }
            ]);
            const tx = txRes?.result;
            if (tx?.meta?.postTokenBalances) {
              const accountKeys = tx.transaction?.message?.accountKeys || [];
              const post = tx.meta.postTokenBalances.find(b => {
                const k = accountKeys[b.accountIndex];
                const kStr = typeof k === "string" ? k : k?.pubkey;
                return kStr === h.tokenAccount;
              });
              if (post?.uiTokenAmount) h.firstAcquiredAmount = parseFloat(post.uiTokenAmount.uiAmount) || 0;
            }
            if (h.firstAcquiredAmount !== null && h.firstAcquiredAmount > 0) {
              const ratio = h.uiAmount / h.firstAcquiredAmount;
              if (ratio >= 1.10) h.behavior = "ACCUMULATED";
              else if (ratio >= 0.90) h.behavior = "HELD";
              else if (ratio >= 0.10) h.behavior = "REDUCED";
              else h.behavior = "EXITED_MOSTLY";
            } else {
              h.behavior = "UNKNOWN";
            }
          } catch (e) {
            console.warn(`[AUTOPSY] holder rank ${h.rank} walk failed:`, e.message);
          }
        }));

        // Aggregate breakdowns + extra red flags
        topHolders.forEach(h => {
          if (h.acquisitionTiming && holderBreakdown[h.acquisitionTiming] !== undefined) holderBreakdown[h.acquisitionTiming]++;
          if (h.category === "locker") holderBreakdown.locker++;
          if (h.category === "lp") holderBreakdown.lp++;
          if (h.category === "selflock") holderBreakdown.selflock++;
          if (h.category === "program") holderBreakdown.program++;
          if (h.behavior && behaviorBreakdown[h.behavior] !== undefined) behaviorBreakdown[h.behavior]++;
        });
        if (behaviorBreakdown.EXITED_MOSTLY >= 3) redFlags.push(`${behaviorBreakdown.EXITED_MOSTLY} of the top 10 holders have sold most of their original position — distribution pattern.`);
        if (holderBreakdown.sniper >= 4) {
          // Honesty: "insider entry" asserts team coordination we can't prove
          // from timing alone (snipers are usually bots/public). And on a
          // launchpad token, buying within a minute of the pool is often just
          // early bonding-curve buying, not graduation-sniping. Word it for
          // what it is — concentrated early entry — and name the launchpad case.
          const launchpad = bondingCurveActive() || isLaunchpadMint;
          const lp = MINT_LOWER.endsWith("pump") ? "Pump.fun" : "launchpad";
          redFlags.push(launchpad
            ? `${holderBreakdown.sniper} of the top 10 bought within the first minute — concentrated early entry. On a ${lp} token this is typically early bonding-curve buyers or snipers/bots, NOT proof of team or insider coordination.`
            : `${holderBreakdown.sniper} of the top 10 bought within the first minute — heavy early concentration (snipers/bots or coordinated entry; on-chain timing alone can't tell which).`);
        }
        if (holderBreakdown.locker + holderBreakdown.selflock === 0 && verdict.type !== "ALIVE" && verdict.type !== "AT_RISK") redFlags.push("None of the top 10 holdings are in a recognized lock — no enforced supply restrictions.");
      }
    } catch (err) {
      console.warn("[AUTOPSY] top-holder analysis failed:", err.message);
    }

    // --- Phase 2D: Bags.fm API deep integration ---
    // For Bags.fm tokens we can pull official metadata + creators + the DBC
    // (bonding-curve) pool key. Walking the DBC pool's signatures gives us
    // VERIFIED bonding-curve buyer wallets — replacing the "had tokens before
    // the DEX pool = bonding curve buyer" inference with hard fact.
    // bagsInfo + dbcBuyerSet hoisted above for TDZ; reuse them here.
    const BAGS_API_KEY = process.env.BAGS_API_KEY;
    if (BAGS_API_KEY) {
      // Initialize an empty bagsInfo upfront. Any single Bags endpoint
      // returning real data is enough to confirm this is a Bags token —
      // do NOT gate the integration on a single endpoint (token-launch/info
      // currently 404s for some mints, including CLKN, and was blocking
      // everything downstream).
      const bagsCandidate = {
        isBagsToken: false,
        name: null,
        symbol: null,
        status: null,
        launchSignature: null,
        officialCreators: [],
        dbcPoolKey: null,
        dammV2PoolKey: null,
        dbcSignaturesScanned: 0,
        dbcBuyersIdentified: 0,
      };

      // 1) Official creators — the most important call. If this returns
      // creators, we know it's a Bags token AND we have the operational
      // wallets.
      try {
        const r = await bagsFetch(`token-launch/creator/v3?tokenMint=${mint}`, BAGS_API_KEY);
        console.log(`[AUTOPSY] Bags creator/v3 status=${r.status} bodyHead=${(r.text || "").slice(0, 300)}`);
        if (r.status === 200) {
          const parsed = JSON.parse(r.text);
          const creators = (Array.isArray(parsed) && parsed)
            || (Array.isArray(parsed?.response) && parsed.response)
            || (Array.isArray(parsed?.response?.creators) && parsed.response.creators)
            || (Array.isArray(parsed?.creators) && parsed.creators)
            || (Array.isArray(parsed?.data) && parsed.data)
            || null;
          if (creators && creators.length > 0) {
            bagsCandidate.officialCreators = creators.map(c => {
              const provider = c.provider || c.socialProvider || null;
              const username = c.providerUsername || c.username || c.handle || c.twitterUsername || null;
              return {
                wallet: c.wallet || c.walletAddress || c.walletPubkey || c.creatorWallet || null,
                provider,
                username,
                twitterUsername: c.twitterUsername || (provider === "twitter" ? username : null),
                // Bags only surfaces a social identity for wallets with a VERIFIED
                // linked profile — so a provider+handle present here = verified.
                verified: !!(provider && username),
                isAdmin: !!c.isAdmin,
                royaltyBps: c.royaltyBps ?? c.royaltyBasisPoints ?? null,
              };
            }).filter(c => c.wallet);
            if (bagsCandidate.officialCreators.length > 0) {
              bagsCandidate.isBagsToken = true;
              console.log(`[AUTOPSY] Bags creator/v3 parsed ${bagsCandidate.officialCreators.length} creators: ${bagsCandidate.officialCreators.map(c => c.wallet.slice(0,8) + "…").join(", ")}`);
            }
          } else {
            console.warn(`[AUTOPSY] Bags creator/v3 returned 200 but no creators array found.`);
          }
        }
      } catch (e) { console.warn("[AUTOPSY] Bags creator/v3 failed:", e.message); }

      // 2) Token launch info — best-effort. May 404 for some mints; if it
      // works, it gives us name/symbol/status/launchSignature.
      try {
        const r = await bagsFetch(`token-launch/info?tokenMint=${mint}`, BAGS_API_KEY);
        console.log(`[AUTOPSY] Bags info status=${r.status}`);
        if (r.status === 200) {
          const parsed = JSON.parse(r.text);
          const info = parsed?.response?.token || parsed?.response || parsed;
          if (info && (info.tokenMint || info.status || info.launchSignature || info.symbol || info.name)) {
            bagsCandidate.isBagsToken = true;
            bagsCandidate.name = info.name || bagsCandidate.name;
            bagsCandidate.symbol = info.symbol || bagsCandidate.symbol;
            bagsCandidate.status = info.status || bagsCandidate.status;
            bagsCandidate.launchSignature = info.launchSignature || bagsCandidate.launchSignature;
            if (info.dbcPoolKey) bagsCandidate.dbcPoolKey = info.dbcPoolKey;
            if (info.dammV2PoolKey) bagsCandidate.dammV2PoolKey = info.dammV2PoolKey;
          }
        }
      } catch (e) { console.warn("[AUTOPSY] Bags token-launch/info failed:", e.message); }

      // Adopt the candidate if any signal confirms it's a Bags token.
      if (bagsCandidate.isBagsToken) {
        bagsInfo = bagsCandidate;
      }

      if (bagsInfo) {

        // Creator social-verification signal. Bags only surfaces a social
        // identity for fee wallets with a VERIFIED linked profile, so an
        // official creator carrying a provider+handle = verified/accountable;
        // a Bags token whose creators are all wallet-only = anonymous fee
        // earners. Bags-confirmed identity → we can assert it (forensic rule).
        const ocs = bagsInfo.officialCreators || [];
        if (ocs.length) {
          const verified = ocs.filter(c => c.verified && c.username);
          creatorVerification = {
            status: verified.length ? "verified" : "anonymous",
            verifiedCount: verified.length,
            totalCreators: ocs.length,
            handles: verified.map(c => ({ provider: c.provider, username: c.username })),
          };
        }

        // 3) Pool info — DBC + DAMM V2 pool keys
        try {
          const r = await bagsFetch(`token-launch/pool-info?tokenMint=${mint}`, BAGS_API_KEY);
          console.log(`[AUTOPSY] Bags pool-info status=${r.status}`);
          if (r.status === 200) {
            const parsed = JSON.parse(r.text);
            const info = parsed?.response || parsed;
            if (info) {
              // Only overwrite when the call returns a real value — don't
              // clobber a key we already learned from token-launch/info.
              if (info.dbcPoolKey) bagsInfo.dbcPoolKey = info.dbcPoolKey;
              if (info.dammV2PoolKey) bagsInfo.dammV2PoolKey = info.dammV2PoolKey;
            }
          }
        } catch (e) { console.warn("[AUTOPSY] Bags pool-info failed:", e.message); }

        // 3b) Lifetime fees — total project revenue claimed to date.
        // Forensic signal: how much have the registered creator wallets
        // actually extracted? A high number + recent activity = active project
        // operating off creator-fee revenue; zero or stale = abandoned launch.
        bagsInfo.lifetimeFeesSol = null;
        try {
          const r = await bagsFetch(`token-launch/lifetime-fees?tokenMint=${mint}`, BAGS_API_KEY);
          if (r.status === 200) {
            const parsed = JSON.parse(r.text);
            const data = parsed?.success ? parsed.response : parsed;
            // Bags returns lifetime fees in lamports under various field names
            // depending on the response shape — be tolerant.
            const lamports = data?.lifetimeFees ?? data?.totalFees ?? data?.amount ?? null;
            if (lamports !== null && Number.isFinite(Number(lamports))) {
              bagsInfo.lifetimeFeesSol = Number(lamports) / 1e9;
            }
          }
        } catch (e) { console.warn("[AUTOPSY] Bags lifetime-fees failed:", e.message); }

        // 3c) Claim events — itemized history of fee claims. Used to compute
        // claim count + last-claim timestamp ("when did the team last touch
        // their revenue?") which separates active from abandoned projects.
        // Bags returns events in chronological order (oldest first) so a
        // single page of 100 can hide recent claims for active wallets that
        // have claimed >100 times. Paginate up to 5 pages = 500 events to
        // catch the actual most-recent claim.
        bagsInfo.claimEventCount = 0;
        bagsInfo.lastClaimTimestamp = null;
        bagsInfo.totalClaimedSol = null;
        try {
          let allEvents = [];
          for (let page = 0; page < 5; page++) {
            const offset = page * 100;
            const r = await bagsFetch(`fee-share/token/claim-events?tokenMint=${mint}&mode=offset&limit=100&offset=${offset}`, BAGS_API_KEY);
            if (r.status !== 200) break;
            const parsed = JSON.parse(r.text);
            const events = parsed?.success && parsed.response && Array.isArray(parsed.response.events)
              ? parsed.response.events : [];
            if (events.length === 0) break;
            allEvents.push(...events);
            if (events.length < 100) break;
          }
          bagsInfo.claimEventCount = allEvents.length;
          let totalLamports = 0;
          let latestTs = 0;
          for (const ev of allEvents) {
            const amt = Number(ev.amount);
            if (Number.isFinite(amt)) totalLamports += amt;
            let ts = ev.timestamp;
            if (typeof ts === "number" || /^\d+$/.test(String(ts))) {
              let n = Number(ts);
              if (n < 1e12) n *= 1000;
              if (n > latestTs) latestTs = n;
            }
          }
          if (totalLamports > 0) bagsInfo.totalClaimedSol = totalLamports / 1e9;
          if (latestTs > 0) bagsInfo.lastClaimTimestamp = latestTs;
          console.log(`[AUTOPSY] Bags claim-events: count=${allEvents.length} totalClaimedSol=${totalLamports / 1e9} latestTs=${latestTs ? new Date(latestTs).toISOString() : "—"}`);
        } catch (e) { console.warn("[AUTOPSY] Bags claim-events failed:", e.message); }

        // 3d) Claim STATS — per-claimer breakdown. Tells us EXACTLY which
        // wallet claimed how much SOL across the lifetime, along with their
        // username/social handle. More precise than creator/v3 (which only
        // shows registered shares; this shows actual collected amounts).
        bagsInfo.claimers = [];
        try {
          const r = await bagsFetch(`token-launch/claim-stats?tokenMint=${mint}`, BAGS_API_KEY);
          if (r.status === 200) {
            const parsed = JSON.parse(r.text);
            const claimers = (Array.isArray(parsed?.response) && parsed.response)
              || (Array.isArray(parsed) && parsed)
              || null;
            if (claimers) {
              bagsInfo.claimers = claimers.map(c => ({
                wallet: c.wallet || null,
                username: c.username || c.bagsUsername || c.providerUsername || null,
                provider: c.provider || null,
                twitterUsername: c.twitterUsername || null,
                pfp: c.pfp || null,
                totalClaimedSol: c.totalClaimed != null ? Number(c.totalClaimed) / 1e9 : null,
                royaltyBps: c.royaltyBps ?? null,
                isCreator: !!c.isCreator,
                isAdmin: !!c.isAdmin,
              })).filter(c => c.wallet);
              console.log(`[AUTOPSY] Bags claim-stats: ${bagsInfo.claimers.length} claimers — ${bagsInfo.claimers.map(c => `${c.username || c.wallet.slice(0,6)}=${(c.totalClaimedSol || 0).toFixed(2)}SOL`).join(", ")}`);
            }
          }
        } catch (e) { console.warn("[AUTOPSY] Bags claim-stats failed:", e.message); }

        // 4) Walk the DBC pool's signatures via Helius RPC, batch-parse via
        // Helius Enhanced to identify verified bonding-curve buyer wallets.
        // For each parsed tx, any tokenTransfer FROM dbcPoolKey of OUR mint
        // identifies a real DBC buyer.
        if (bagsInfo.dbcPoolKey) {
          try {
            const dbcSigs = [];
            let dbcBefore = undefined;
            for (let p = 0; p < 2; p++) {
              const params = dbcBefore ? [bagsInfo.dbcPoolKey, { limit: 1000, before: dbcBefore }] : [bagsInfo.dbcPoolKey, { limit: 1000 }];
              const r = await rpcCall(`autopsy-dbc-sigs-${p}`, "getSignaturesForAddress", params);
              const ss = r?.result || [];
              if (ss.length === 0) break;
              dbcSigs.push(...ss);
              if (ss.length < 1000) break;
              dbcBefore = ss[ss.length - 1].signature;
            }
            bagsInfo.dbcSignaturesScanned = dbcSigs.length;
            if (dbcSigs.length > 0) {
              // Sample up to 100 sigs evenly across the lifetime
              const sampled = [];
              const SAMPLE_SIZE = 100;
              const step = Math.max(1, Math.floor(dbcSigs.length / SAMPLE_SIZE));
              for (let i = 0; i < dbcSigs.length; i += step) {
                sampled.push(dbcSigs[i].signature);
                if (sampled.length >= SAMPLE_SIZE) break;
              }
              try {
                const dRes = await fetch(`https://api.helius.xyz/v0/transactions?api-key=${HELIUS_KEY}`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ transactions: sampled })
                });
                const dData = await dRes.json();
                if (Array.isArray(dData)) {
                  for (const tx of dData) {
                    if (!tx || !Array.isArray(tx.tokenTransfers)) continue;
                    for (const tt of tx.tokenTransfers) {
                      if (tt && tt.mint === mint && tt.fromUserAccount === bagsInfo.dbcPoolKey && tt.toUserAccount) {
                        dbcBuyerSet.add(tt.toUserAccount);
                      }
                    }
                  }
                }
                bagsInfo.dbcBuyersIdentified = dbcBuyerSet.size;
              } catch (e) { console.warn("[AUTOPSY] DBC pool parse failed:", e.message); }
            }
          } catch (e) { console.warn("[AUTOPSY] DBC sig walk failed:", e.message); }
        }
      }
    }
    console.log(`[AUTOPSY] Bags integration: ${bagsInfo ? `isBagsToken=true creators=${bagsInfo.officialCreators.length} dbcSigs=${bagsInfo.dbcSignaturesScanned} dbcBuyers=${bagsInfo.dbcBuyersIdentified}` : "not a Bags token"}`);

    // --- Phase 2H: Jupiter independent cross-verification ---
    // Jupiter's v2 token search endpoint returns far more than "is listed".
    // It gives us independent holder count, market data, audit data
    // (mint/freeze authority status from Jupiter's POV), launchpad
    // confirmation, organic-trade score, and devMigrations/devMints —
    // the LATTER is the definitive proof that the on-chain genesis-fee-payer
    // wallet is a platform launcher (a wallet with 1956 migrations is not
    // a project dev). Cross-references all this against our own measurements
    // so the user sees agreement / disagreement.
    let jupiterInfo = null;
    try {
      const r = await fetch(`https://lite-api.jup.ag/tokens/v2/search?query=${mint}`, {
        signal: AbortSignal.timeout(8000),
      });
      if (r.ok) {
        const data = await r.json();
        if (Array.isArray(data) && data.length > 0) {
          const t = data.find(d => d.id === mint) || data[0];
          jupiterInfo = {
            listed: true,
            name: t.name || null,
            symbol: t.symbol || null,
            icon: t.icon || null,
            tags: Array.isArray(t.tags) ? t.tags : [],
            launchpad: t.launchpad || null,
            metaLaunchpad: t.metaLaunchpad || null,
            graduatedAt: t.graduatedAt || null,
            graduatedPool: t.graduatedPool || null,
            holderCount: t.holderCount ?? null,
            fdv: t.fdv ?? null,
            mcap: t.mcap ?? null,
            usdPrice: t.usdPrice ?? null,
            liquidity: t.liquidity ?? null,
            twitter: t.twitter || null,
            telegram: t.telegram || null,
            website: t.website || null,
            stats24h: t.stats24h || null,
            stats6h: t.stats6h || null,
            // Audit block — Jupiter's independent reading of mint/freeze
            // authority status + top-holder concentration + dev-wallet stats.
            audit: t.audit ? {
              mintAuthorityDisabled: !!t.audit.mintAuthorityDisabled,
              freezeAuthorityDisabled: !!t.audit.freezeAuthorityDisabled,
              topHoldersPercentage: t.audit.topHoldersPercentage ?? null,
              devMigrations: t.audit.devMigrations ?? null,
              devMints: t.audit.devMints ?? null,
            } : null,
            organicScore: t.organicScore ?? null,
            organicScoreLabel: t.organicScoreLabel || null,
            // The on-chain "dev" wallet per Jupiter = genesis-tx fee payer.
            // For platform launches (Bags / Pump) this is the PLATFORM wallet,
            // and audit.devMigrations is the smoking gun (thousands of migrations).
            onChainDevPerJupiter: t.dev || null,
          };
        }
      } else if (r.status === 404) {
        jupiterInfo = { listed: false };
      }
    } catch (e) {
      console.warn("[AUTOPSY] Jupiter v2 search failed:", e.message);
    }
    console.log(`[AUTOPSY] Jupiter cross-verify: ${jupiterInfo ? (jupiterInfo.listed ? `holderCount=${jupiterInfo.holderCount} mcap=${jupiterInfo.mcap} tags=${jupiterInfo.tags.join(",")} devMigrations=${jupiterInfo.audit?.devMigrations}` : "not listed") : "no response"}`);

    // --- Phase 2E: Pump.fun frontend API integration ---
    // Symmetric to Bags: pull official metadata + creator + full pre-graduation
    // price history from Pump.fun's unauthenticated frontend API. Then walk
    // the bonding-curve account's signatures for verified buyers (same trick
    // as Bags DBC). Unlike GeckoTerminal which only sees post-graduation data,
    // Pump.fun's chart goes all the way back to mint.
    // pumpInfo hoisted above for TDZ; reuse it here.
    if (!bagsInfo) {
      try {
        const r = await fetch(`https://frontend-api.pump.fun/coins/${mint}`, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; CluckNorrisAutopsy/1.0)" },
          signal: AbortSignal.timeout(10000),
        });
        if (r.ok) {
          const data = await r.json();
          if (data && data.mint === mint) {
            pumpInfo = {
              isPumpToken: true,
              name: data.name || null,
              symbol: data.symbol || null,
              createdTimestamp: data.created_timestamp || null,
              creator: data.creator || null,
              complete: !!data.complete, // graduated?
              marketCapUsd: data.usd_market_cap || null,
              raydiumPool: data.raydium_pool || null,
              twitter: data.twitter || null,
              telegram: data.telegram || null,
              website: data.website || null,
              imageUri: data.image_uri || null,
              bondingCurve: data.bonding_curve || null,
              associatedBondingCurve: data.associated_bonding_curve || null,
              bcSignaturesScanned: 0,
              bcBuyersIdentified: 0,
              priceHistory: null,
            };
          }
        }
      } catch (e) { console.warn("[AUTOPSY] Pump.fun coins fetch failed:", e.message); }
    }

    // Synthesized recognition for graduated Pump tokens. Pump's frontend API
    // only serves tokens still on the bonding curve — once a token graduates
    // it 404s, so pumpInfo stays null and the launchpad card never shows even
    // though the mint suffix proves it's a Pump.fun token. Synthesize minimal
    // recognition (it's a Pump token, and graduated since a DEX pool exists)
    // so the card shows its launchpad provenance. Creator is filled in after
    // creator detection from the ST-resolved creator; bonding-curve buyer
    // stats stay 0 (the API that would provide them is gone for graduated
    // tokens — we're honest about that rather than faking it).
    if (!pumpInfo && !bagsInfo && MINT_LOWER.endsWith("pump")) {
      // Graduation status MUST come from a reliable source — NOT from whether
      // GeckoTerminal has candles (it indexes on-curve pump pools too, so
      // price history is NOT proof of graduation). Ask Solana Tracker: a pool
      // with market "pumpfun" is still on the bonding curve. This getTokenInfo
      // call is cached and reused by the creator lookup below — no double fetch.
      let stMarket = null;
      try { stMarket = await solanaTracker.getTokenMarketStatus(mint); } catch (e) { /* degrade */ }
      pumpInfo = {
        isPumpToken: true,
        synthesized: true,
        symbol: symbol || null,
        // graduated only when ST confirms a non-curve market; if ST is
        // unavailable, leave null (unknown) rather than guessing wrong.
        complete: stMarket ? stMarket.graduated : null,
        onBondingCurve: stMarket ? stMarket.onBondingCurve : null,
        curvePercentage: stMarket ? stMarket.curvePercentage : null,
        market: stMarket ? stMarket.market : null,
        stLiquidityUsd: stMarket ? stMarket.liquidityUsd : null,
        creator: null,            // filled post-creator-detection
        bondingCurve: null,
        bcSignaturesScanned: 0,
        bcBuyersIdentified: 0,
        priceHistory: null,
      };
      console.log(`[AUTOPSY] Pump.fun: synthesized recognition — market=${stMarket?.market || "?"} graduated=${stMarket?.graduated} curve=${stMarket?.curvePercentage}% stLiq=$${stMarket?.liquidityUsd}`);
    }

    // Pump.fun candlestick history — full chart back to mint (the OHLCV gap
    // fix). Skip for synthesized (graduated) tokens — the API won't have them.
    if (pumpInfo && !pumpInfo.synthesized) {
      try {
        const r = await fetch(`https://frontend-api.pump.fun/candlesticks/${mint}?offset=0&limit=1000&timeframe=5`, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; CluckNorrisAutopsy/1.0)" },
          signal: AbortSignal.timeout(15000),
        });
        if (r.ok) {
          const data = await r.json();
          if (Array.isArray(data) && data.length > 0) {
            let peakPrice = 0, peakTs = 0;
            for (const c of data) {
              const close = Number(c.close) || 0;
              if (close > peakPrice) { peakPrice = close; peakTs = (c.timestamp || 0) * 1000; }
            }
            const latest = data[data.length - 1];
            const pumpCurrentPrice = priceUsd || Number(latest?.close) || 0;
            const drawdown = peakPrice > 0 ? ((pumpCurrentPrice - peakPrice) / peakPrice) * 100 : null;
            pumpInfo.priceHistory = {
              peakPrice,
              peakTimestamp: peakTs,
              peakMarketCap: supplyTokens > 0 && peakPrice > 0 ? peakPrice * supplyTokens : null,
              currentPrice: pumpCurrentPrice,
              drawdownFromPeakPct: drawdown,
              candleCount: data.length,
              source: "Pump.fun",
            };
            // Override GeckoTerminal-derived priceHistory if Pump's is fuller
            // (Pump.fun includes pre-graduation candles GeckoTerminal can't see)
            if (!priceHistory || data.length > (priceHistory.candleCount || 0)) {
              priceHistory = pumpInfo.priceHistory;
            }
          }
        }
      } catch (e) { console.warn("[AUTOPSY] Pump.fun candlesticks failed:", e.message); }
    }

    // Walk Pump.fun bonding-curve account for verified buyers (same as Bags DBC)
    if (pumpInfo && pumpInfo.bondingCurve) {
      try {
        const bcSigs = [];
        let bcBefore = undefined;
        for (let p = 0; p < 2; p++) {
          const params = bcBefore ? [pumpInfo.bondingCurve, { limit: 1000, before: bcBefore }] : [pumpInfo.bondingCurve, { limit: 1000 }];
          const sigRes = await rpcCall(`autopsy-pump-sigs-${p}`, "getSignaturesForAddress", params);
          const ss = sigRes?.result || [];
          if (ss.length === 0) break;
          bcSigs.push(...ss);
          if (ss.length < 1000) break;
          bcBefore = ss[ss.length - 1].signature;
        }
        pumpInfo.bcSignaturesScanned = bcSigs.length;
        if (bcSigs.length > 0) {
          const sampled = [];
          const SAMPLE_SIZE = 100;
          const step = Math.max(1, Math.floor(bcSigs.length / SAMPLE_SIZE));
          for (let i = 0; i < bcSigs.length; i += step) {
            sampled.push(bcSigs[i].signature);
            if (sampled.length >= SAMPLE_SIZE) break;
          }
          const dRes = await fetch(`https://api.helius.xyz/v0/transactions?api-key=${HELIUS_KEY}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ transactions: sampled })
          });
          const dData = await dRes.json();
          if (Array.isArray(dData)) {
            for (const tx of dData) {
              if (!tx || !Array.isArray(tx.tokenTransfers)) continue;
              for (const tt of tx.tokenTransfers) {
                if (tt && tt.mint === mint && tt.fromUserAccount === pumpInfo.bondingCurve && tt.toUserAccount) {
                  dbcBuyerSet.add(tt.toUserAccount); // unified set — Bags + Pump both feed into here
                }
              }
            }
          }
          pumpInfo.bcBuyersIdentified = dbcBuyerSet.size - (bagsInfo?.dbcBuyersIdentified || 0);
        }
      } catch (e) { console.warn("[AUTOPSY] Pump bonding curve walk failed:", e.message); }
    }
    console.log(`[AUTOPSY] Pump.fun integration: ${pumpInfo ? `isPumpToken=true complete=${pumpInfo.complete} bcSigs=${pumpInfo.bcSignaturesScanned} bcBuyers=${pumpInfo.bcBuyersIdentified}` : "not a Pump token"}`);

    // (KNOWN_CEX_WALLETS is now a module-level constant — shared with the free
    // autopsy concentration calc. Used below to refine acquisition labels.)

    // --- Phase 2D/2E post-pass: tag fee-receiver wallets on the holder rows ---
    // For Bags tokens, the creator/v3 endpoint returns every wallet entitled
    // to creator-fee royalties (with royaltyBps). For Pump.fun tokens, the
    // coins endpoint returns the launch creator. These ARE the project's
    // operational wallets — they receive the cash. We tag any top-100 holder
    // whose authority matches as a `bagsFeeWallet` / `pumpCreator` so the UI
    // can surface a prominent badge and the AI prompt can use it. Generic fix
    // for ANY Bags token, not CLKN-specific.
    const projectFeeWalletMap = new Map(); // wallet → { source, royaltyBps?, username?, provider? }
    if (bagsInfo && Array.isArray(bagsInfo.officialCreators)) {
      for (const c of bagsInfo.officialCreators) {
        if (c.wallet) {
          projectFeeWalletMap.set(c.wallet, {
            source: "bags",
            royaltyBps: c.royaltyBps,
            username: c.username,
            provider: c.provider,
            isAdmin: c.isAdmin,
          });
        }
      }
    }
    if (pumpInfo && pumpInfo.creator) {
      // Pump creator gets a separate badge; if it ALSO matches a Bags receiver
      // (rare cross-launch case), the Bags entry wins for label clarity.
      if (!projectFeeWalletMap.has(pumpInfo.creator)) {
        projectFeeWalletMap.set(pumpInfo.creator, { source: "pump" });
      }
    }
    if (projectFeeWalletMap.size > 0 && Array.isArray(topHolders)) {
      for (const h of topHolders) {
        const w = h.authority || h.wallet;
        const meta = w ? projectFeeWalletMap.get(w) : null;
        if (meta) {
          h.projectFeeWallet = meta;
          // Royalty share string for badge display.
          if (meta.royaltyBps != null) {
            h.projectFeeRoyaltyPct = Number(meta.royaltyBps) / 100;
          }
        }
      }
    }

    // --- Phase 2C: Acquisition-source attribution + distributors ---
    // For each wallet holder, fetch their first-tx via the Helius Enhanced API
    // and classify HOW they acquired their tokens:
    //   BOUGHT   — via a DEX swap
    //   TRANSFER — sent directly from another wallet (airdrop / gift / OTC)
    //   MINTED   — direct mint instruction (initial allocation from creator)
    // For TRANSFER cases we capture the source wallet, then aggregate to find
    // "distributors": wallets that sent tokens to multiple top holders (the
    // signal that says "this is an airdrop / bulk distribution event").
    let distributors = [];
    try {
      // Include wallets + lockers + selflocks. A team-distribution wallet may
      // have sent tokens both to human holders AND to lock contracts; we want
      // to show ALL of those recipients with the right label, not just the
      // wallet-side ones. Excludes LP and generic program accounts (those
      // aren't normal distribution targets).
      const walletHoldersAll = topHolders.filter(h =>
        h.category === "wallet" || h.category === "locker" || h.category === "selflock"
      );
      const firstSigsToFetch = walletHoldersAll
        .filter(h => h.firstAcquiredSignature)
        .map(h => h.firstAcquiredSignature);
      if (firstSigsToFetch.length > 0) {
        const acqUrl = `https://api.helius.xyz/v0/transactions?api-key=${HELIUS_KEY}`;
        const acqRes = await fetch(acqUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transactions: firstSigsToFetch.slice(0, 100) })
        });
        const acqData = await acqRes.json();
        const acqMap = new Map();
        if (Array.isArray(acqData)) for (const tx of acqData) { if (tx?.signature) acqMap.set(tx.signature, tx); }
        for (const h of walletHoldersAll) {
          const tx = acqMap.get(h.firstAcquiredSignature);
          if (!tx) { h.acquisitionType = "UNKNOWN"; continue; }
          const tts = Array.isArray(tx.tokenTransfers) ? tx.tokenTransfers : [];
          // Find the transfer where THIS wallet received OUR mint
          const ours = tts.find(tt => tt && tt.mint === mint && tt.toUserAccount === h.authority);
          if (ours) {
            if (!ours.fromUserAccount) {
              h.acquisitionType = "MINTED"; h.acquisitionSource = null;
            } else if (tx.type === "SWAP") {
              h.acquisitionType = "BOUGHT"; h.acquisitionSource = ours.fromUserAccount;
            } else {
              h.acquisitionType = "TRANSFER"; h.acquisitionSource = ours.fromUserAccount;
            }
          } else {
            if (tx.type === "SWAP") h.acquisitionType = "BOUGHT";
            else if (tx.type === "TOKEN_MINT") h.acquisitionType = "MINTED";
            else h.acquisitionType = "OTHER";
          }
        }

        // --- Refine acquisition sources: distinguish CEX withdrawals and pool
        // routing from genuine wallet-to-wallet transfers. Currently anything
        // not classified as SWAP is "TRANSFER" — but most of those are actually
        // Coinbase/Binance withdrawals (which are real users withdrawing from
        // an exchange, not airdrop recipients) or Jupiter routing through pool
        // authorities (which is really a BUY). We look up each source's owner
        // program to refine the label.
        const allSourceAddrs = new Set();
        for (const h of walletHoldersAll) { if (h.acquisitionSource) allSourceAddrs.add(h.acquisitionSource); }
        const sourceArr = [...allSourceAddrs];
        const sourceOwnerMap = new Map();
        for (let i = 0; i < sourceArr.length; i += 100) {
          try {
            const so = await rpcCall(`autopsy-src-${i}`, "getMultipleAccounts", [
              sourceArr.slice(i, i + 100),
              { encoding: "base64", dataSlice: { offset: 0, length: 0 } }
            ]);
            const sInfos = so?.result?.value || [];
            sourceArr.slice(i, i + 100).forEach((a, j) => sourceOwnerMap.set(a, sInfos[j]?.owner || null));
          } catch (e) { console.warn(`[AUTOPSY] source batch ${i} failed:`, e.message); }
        }
        for (const h of walletHoldersAll) {
          if (!h.acquisitionSource) continue;
          const src = h.acquisitionSource;
          const sOwner = sourceOwnerMap.get(src);
          if (KNOWN_CEX_WALLETS[src]) {
            h.acquisitionType = "CEX_WITHDRAWAL";
            h.acquisitionSourceLabel = KNOWN_CEX_WALLETS[src];
          } else if (sOwner && DEX_PROGRAMS.has(sOwner)) {
            // Source is owned by a DEX program — this was actually a swap routed
            // through that pool, not a wallet-to-wallet transfer.
            h.acquisitionType = "BOUGHT";
            h.acquisitionSourceLabel = PROGRAM_LABELS[sOwner] || "DEX pool";
          } else if (sOwner && LOCKER_PROGRAMS.has(sOwner)) {
            h.acquisitionType = "LOCK_UNLOCK";
            h.acquisitionSourceLabel = PROGRAM_LABELS[sOwner] || "Token lock";
          } else if (sOwner && sOwner !== "11111111111111111111111111111111") {
            // Source is owned by SOME program (not the System Program), which
            // means it isn't a human wallet — it's a PDA / program-controlled
            // account. Even if we don't have a friendly label for the owning
            // program, we know this wasn't a wallet-to-wallet transfer.
            // Falling back to the program-id short hash is honest and stops
            // it from being misread as an insider airdrop.
            h.acquisitionType = "PROGRAM_ROUTE";
            h.acquisitionSourceLabel = PROGRAM_LABELS[sOwner] || `Program ${sOwner.slice(0, 6)}…${sOwner.slice(-4)}`;
            h.acquisitionProgramId = sOwner;
          }
          // else: source IS owned by the System Program → genuine human-wallet
          // sender → keep as TRANSFER.
        }

        // Aggregate distributors: source wallets that sent tokens to 2+ top holders.
        // Crucially, ONLY count genuine wallet-to-wallet TRANSFERs after the
        // refinement above — CEX withdrawals and pool routing don't count.
        const distMap = new Map();
        for (const h of walletHoldersAll) {
          if (h.acquisitionType === "TRANSFER" && h.acquisitionSource) {
            const cur = distMap.get(h.acquisitionSource) || {
              recipients: [], totalShare: 0,
              lockedRecipients: 0, walletRecipients: 0, lockedShare: 0, walletShare: 0,
            };
            const isLocker = h.category === "locker" || h.category === "selflock";
            cur.recipients.push({
              rank: h.rank,
              authority: h.authority,
              share: h.share,
              category: h.category,
              label: h.label,
              isLocker,
              firstAcquiredAmount: h.firstAcquiredAmount || null,
              currentBalance: h.uiAmount || 0,
            });
            cur.totalShare += h.share || 0;
            if (isLocker) {
              cur.lockedRecipients++;
              cur.lockedShare += h.share || 0;
            } else {
              cur.walletRecipients++;
              cur.walletShare += h.share || 0;
            }
            distMap.set(h.acquisitionSource, cur);
          }
        }
        // Threshold lowered to 1 — even a single-recipient distributor is
        // worth surfacing now that each row shows the actual recipient list
        // with categories. Sort by total recipient count desc.
        distributors = [...distMap.entries()]
          .filter(([_, info]) => info.recipients.length >= 1)
          .map(([source, info]) => ({
            sourceWallet: source,
            recipientsInTop20: info.recipients.length,
            walletRecipientsInTop20: info.walletRecipients,
            lockedRecipientsInTop20: info.lockedRecipients,
            totalShareDistributed: info.totalShare,
            walletShareDistributed: info.walletShare,
            lockedShareDistributed: info.lockedShare,
            recipients: info.recipients,
            // Filled in by the distributor-attribution pass below
            firstAcquiredAt: null,
            firstAcquiredSignature: null,
            acquisitionType: null,
            acquisitionTiming: null,
          }))
          .sort((a, b) => b.recipientsInTop20 - a.recipientsInTop20);
        // Tag each distributor with whether they're a VERIFIED team wallet
        // (Bags/Pump official creator). A verified team wallet doing
        // distribution is normal migration / airdrop / team allocation — not
        // an insider rug. The forensic interpretation is completely different.
        for (const d of distributors) {
          d.isVerifiedTeamWallet = projectFeeWalletMap && projectFeeWalletMap.has(d.sourceWallet);
        }
        // Red flag only when distributor is NOT a verified team wallet AND
        // they're sending to actual human WALLETS (not locks). Sending to
        // locks is a positive supply-removal signal, the opposite of an
        // airdrop / insider distribution.
        const topDist = distributors[0];
        if (topDist && topDist.walletRecipientsInTop20 >= 5 && !topDist.isVerifiedTeamWallet) {
          redFlags.push(`One wallet (${topDist.sourceWallet.slice(0, 8)}…) distributed tokens to ${topDist.walletRecipientsInTop20} of the top 20 human-holder wallets — bulk-distribution / airdrop source (NOT a verified team wallet — investigate whether this is insider distribution).`);
        } else if (topDist && topDist.walletRecipientsInTop20 >= 3 && !topDist.isVerifiedTeamWallet) {
          redFlags.push(`One wallet sent tokens to ${topDist.walletRecipientsInTop20} top-20 human holders — concentrated distribution source.`);
        } else if (topDist && topDist.isVerifiedTeamWallet) {
          console.log(`[AUTOPSY] Verified team-wallet distribution suppressed from red flags: source=${topDist.sourceWallet.slice(0,8)}… recipients=${topDist.recipientsInTop20} (wallets=${topDist.walletRecipientsInTop20}, locks=${topDist.lockedRecipientsInTop20})`);
        }

        // --- Distributor acquisition attribution ---
        // For each identified distributor, figure out HOW they got the tokens
        // they later distributed. The classic "bought big at launch then
        // airdropped to past supporters" pattern shows up as
        // acquisitionType=BOUGHT + acquisitionTiming=sniper/bonding_curve.
        const DIST_CAP = Math.min(distributors.length, 5);
        await Promise.allSettled(distributors.slice(0, DIST_CAP).map(async (dist, di) => {
          try {
            const tacRes = await rpcCall(`autopsy-dist-tac-${di}`, "getTokenAccountsByOwner", [
              dist.sourceWallet, { mint }, { encoding: "jsonParsed" }
            ]);
            const accs = tacRes?.result?.value || [];
            if (accs.length === 0) return;
            const tac = accs[0].pubkey;
            const distSigsRes = await rpcCall(`autopsy-dist-sigs-${di}`, "getSignaturesForAddress", [
              tac, { limit: 1000 }
            ]);
            const distSigs = distSigsRes?.result || [];
            if (distSigs.length === 0) return;
            const oldest = distSigs[distSigs.length - 1];
            dist.firstAcquiredAt = oldest.blockTime ? oldest.blockTime * 1000 : null;
            dist.firstAcquiredSignature = oldest.signature;
            // Timing classification (matches the same buckets as top holders)
            if (dist.firstAcquiredAt && pairCreatedMs) {
              const dms = dist.firstAcquiredAt - pairCreatedMs;
              if (dms < -60_000) dist.acquisitionTiming = bondingCurveActive() ? "bonding_curve" : "pre_pool";
              else if (dms < 60_000) dist.acquisitionTiming = "sniper";
              else if (dms < 3_600_000) dist.acquisitionTiming = "very_early";
              else if (dms < 86_400_000) dist.acquisitionTiming = "early";
              else if (dms < 7 * 86_400_000) dist.acquisitionTiming = "first_week";
              else dist.acquisitionTiming = "later";
            }
          } catch (e) {
            console.warn(`[AUTOPSY] distributor ${di} history failed:`, e.message);
          }
        }));

        // Batch-fetch parsed first-txs for distributors via Helius Enhanced
        const distSigsToFetch = distributors.slice(0, DIST_CAP).filter(d => d.firstAcquiredSignature).map(d => d.firstAcquiredSignature);
        if (distSigsToFetch.length > 0) {
          try {
            const dUrl = `https://api.helius.xyz/v0/transactions?api-key=${HELIUS_KEY}`;
            const dRes = await fetch(dUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ transactions: distSigsToFetch })
            });
            const dData = await dRes.json();
            const dMap = new Map();
            if (Array.isArray(dData)) for (const t of dData) { if (t?.signature) dMap.set(t.signature, t); }
            for (const dist of distributors.slice(0, DIST_CAP)) {
              const tx = dMap.get(dist.firstAcquiredSignature);
              if (!tx) { dist.acquisitionType = "UNKNOWN"; continue; }
              const tts = Array.isArray(tx.tokenTransfers) ? tx.tokenTransfers : [];
              const ours = tts.find(tt => tt && tt.mint === mint && tt.toUserAccount === dist.sourceWallet);
              if (ours) {
                if (!ours.fromUserAccount) dist.acquisitionType = "MINTED";
                else if (tx.type === "SWAP") dist.acquisitionType = "BOUGHT";
                else dist.acquisitionType = "TRANSFER";
              } else {
                if (tx.type === "SWAP") dist.acquisitionType = "BOUGHT";
                else if (tx.type === "TOKEN_MINT") dist.acquisitionType = "MINTED";
                else dist.acquisitionType = "OTHER";
              }
            }
          } catch (e) {
            console.warn("[AUTOPSY] distributor enhanced fetch failed:", e.message);
          }
        }

        // Promote one final red flag if a distributor bought-then-distributed
        const buyerDistributor = distributors.find(d =>
          d.acquisitionType === "BOUGHT" &&
          (d.acquisitionTiming === "sniper" || d.acquisitionTiming === "very_early" || d.acquisitionTiming === "bonding_curve") &&
          d.recipientsInTop20 >= 3
        );
        if (buyerDistributor) {
          redFlags.push(`A wallet bought a large position at launch (${buyerDistributor.acquisitionTiming}) and then distributed it to ${buyerDistributor.recipientsInTop20} top-20 holders — classic "buy big then airdrop" pattern.`);
        }
      }
    } catch (e) {
      console.warn("[AUTOPSY] acquisition attribution failed:", e.message);
    }

    // --- Creator status: did the creator wallet keep or sell their stake? ---
    // Cross-reference the creator wallet against the top holders. For Bags
    // tokens we use the OFFICIAL creator wallet from /token-launch/creator/v3
    // (which often includes a Twitter handle) — far more accurate than the
    // "genesis tx fee payer" heuristic (which catches the Bags platform).
    let creatorStatus = null;
    let effectiveCreatorWallet = lifetime?.creatorWallet || null;
    let effectiveCreatorSource = "genesis-tx-fee-payer";
    let bagsCreatorMeta = null;
    if (bagsInfo && bagsInfo.officialCreators && bagsInfo.officialCreators.length > 0) {
      // Prefer the first admin creator; fall back to the first creator listed.
      const admin = bagsInfo.officialCreators.find(c => c.isAdmin) || bagsInfo.officialCreators[0];
      effectiveCreatorWallet = admin.wallet;
      effectiveCreatorSource = "bags-official";
      bagsCreatorMeta = admin;
    } else if (pumpInfo && pumpInfo.creator) {
      effectiveCreatorWallet = pumpInfo.creator;
      effectiveCreatorSource = "pump-official";
    } else {
      // Bags/Pump platform APIs didn't return a creator. Before trusting the
      // genesis-tx fee payer (which on launchpad tokens is the PLATFORM wallet
      // — the shared Bags/Pump address that paid for thousands of launches,
      // NOT the project team), ask Solana Tracker. Its indexer returns the
      // real token creator even for graduated Pump.fun tokens where Pump's own
      // API no longer serves pre-graduation data. This is what stops us
      // fingering the platform wallet as "the dev" and falsely narrating
      // "creator exited." Pump mints (…pump suffix) are flagged so we never
      // fall back to the genesis payer for them.
      const isPumpMint = typeof mint === "string" && mint.toLowerCase().endsWith("pump");
      let stCreator = null;
      try { stCreator = await solanaTracker.getTokenCreator(mint); } catch (e) { /* degrade */ }
      if (stCreator && stCreator.wallet) {
        effectiveCreatorWallet = stCreator.wallet;
        effectiveCreatorSource = "solana-tracker";
      } else if (bagsInfo || pumpInfo || isPumpMint) {
        // Known launchpad token but NO source could give us the real creator.
        // Refuse to show the genesis fee payer (platform wallet) as the dev.
        effectiveCreatorWallet = null;
        effectiveCreatorSource = "unverified-platform-launch";
        redFlags.push(
          bagsInfo
            ? "Bags-platform-launched token, but no registered creator was returned by the Bags API — the on-chain genesis tx was paid by the Bags platform wallet, not by the project team. Treat any 'dev wallet' label from other tools (DexScreener, etc.) as misleading for this token."
            : "Pump.fun token, but neither Pump nor Solana Tracker returned a verified creator — the on-chain genesis tx was paid by the Pump platform wallet, not by the project team. Don't trust any 'dev wallet' label here."
        );
      }
      // else: not a launchpad token and ST had nothing — keep the genesis-tx
      // fee payer default (for a plain SPL token, the genesis payer usually
      // IS the creator).
    }
    if (effectiveCreatorWallet) {
      const creatorInTop = topHolders.find(h => h.authority === effectiveCreatorWallet);
      if (creatorInTop) {
        creatorInTop.isCreator = true;
        creatorInTop.creatorMeta = bagsCreatorMeta;
        const creatorLabel = bagsCreatorMeta?.username ? `Creator (@${bagsCreatorMeta.username})` : "Creator wallet";
        creatorStatus = {
          wallet: effectiveCreatorWallet,
          source: effectiveCreatorSource,
          bagsCreatorMeta,
          inTopHolders: true,
          rank: creatorInTop.rank,
          currentShare: creatorInTop.share,
          behavior: creatorInTop.behavior,
          summary: creatorInTop.behavior === "EXITED_MOSTLY"
            ? `${creatorLabel} is in the top 100 but has sold most of their original position.`
            : creatorInTop.behavior === "REDUCED"
            ? `${creatorLabel} is in the top 100 and has trimmed their position.`
            : creatorInTop.behavior === "HELD"
            ? `${creatorLabel} is in the top 100 and is still holding their original position.`
            : creatorInTop.behavior === "ACCUMULATED"
            ? `${creatorLabel} is in the top 100 and has accumulated more since launch.`
            : `${creatorLabel} is in the top 100 at rank ${creatorInTop.rank}.`,
        };
      } else {
        // Creator not in top 100. For Bags-verified creators this is OFTEN
        // normal — the fee-receiving wallet receives SOL royalties and may
        // never hold tokens (buy-backs typically route to LP or burn, not
        // back to the operational wallet). We'll enrich this status with
        // actual on-chain activity from walletPnl below, after that's built.
        // Don't pre-emptively red-flag it.
        // On a bonding curve (ANY launchpad) the supply lives in the curve
        // contract, so the creator not being a top holder is NORMAL — it is
        // NOT an exit or distribution. Resolve curve status here (ST call is
        // cached) so we don't mis-fire "creator exited" on a fresh launchpad
        // token (this mis-fired on LetsBonk/Raydium on-curve tokens).
        let creatorOnCurve = false;
        try {
          if (pumpInfo) creatorOnCurve = pumpInfo.onBondingCurve === true;
          else { const stm = await solanaTracker.getTokenMarketStatus(mint); creatorOnCurve = !!(stm && stm.onBondingCurve); }
        } catch (_) {}
        creatorStatus = {
          wallet: effectiveCreatorWallet,
          source: effectiveCreatorSource,
          bagsCreatorMeta,
          inTopHolders: false,
          summary: effectiveCreatorSource === "bags-official"
            ? `Bags-verified creator${bagsCreatorMeta?.username ? ` (@${bagsCreatorMeta.username})` : ""} does not currently hold tokens in the top 100 — common for fee-receiving operational wallets. See the P&L Ledger PROJECT WALLETS tab for their on-chain activity.`
            : effectiveCreatorSource === "pump-official"
            ? "Pump-verified creator does not currently hold tokens in the top 100 — common for fee-receiving operational wallets."
            : creatorOnCurve
            ? "Creator isn't a top holder, but the token is still on the bonding curve — the supply is held by the curve contract, not distributed out. That's normal pre-graduation, NOT an exit signal."
            : "Creator wallet is NOT in the top 100 holders — they've either fully exited their initial position or distributed it out.",
        };
        // Red-flag the genesis-fee-payer case ONLY when the token has a real
        // DEX pool (graduated / non-launchpad). On a curve it's a false signal.
        if (effectiveCreatorSource === "genesis-tx-fee-payer" && !creatorOnCurve) {
          redFlags.push("Creator wallet (genesis-tx fee payer) does not appear in the top 100 — they have either exited or distributed their initial stake.");
        }
      }
    }

    // Backfill the synthesized Pump card's creator from the ST-resolved one.
    if (pumpInfo && pumpInfo.synthesized && !pumpInfo.creator && effectiveCreatorWallet) {
      pumpInfo.creator = effectiveCreatorWallet;
    }

    // ── On-bonding-curve detection + verdict correction (Pump.fun OR Bags) ──
    // A token still on its launchpad bonding curve has NO DEX pool yet, so
    // DexScreener shows ~$0 (or a phantom near-zero-liquidity pool) — which
    // falsely trips LP_RUG / GHOST / UNCLEAR / SOFT_RUG, or lands AT_RISK off
    // early-stage concentration + "no exit". It isn't rugged; its liquidity is
    // the curve reserve. Pump on-curve is detected during synthesis
    // (pumpInfo.onBondingCurve); Bags tokens carry no market status, so resolve
    // it from Solana Tracker here (market "meteora-curve" / "…curve" = still on
    // the Bags DBC curve). Same root cause we fixed for the launches feed.
    let lpOnCurve = pumpInfo ? (pumpInfo.onBondingCurve === true) : false;
    let lpCurvePct = pumpInfo ? pumpInfo.curvePercentage : null;
    let lpCurveLiqUsd = pumpInfo ? (pumpInfo.stLiquidityUsd || 0) : 0;
    let lpName = pumpInfo ? "Pump.fun" : (bagsInfo ? "Bags" : "the launchpad");
    // For ANY non-Pump token, resolve curve status from Solana Tracker — this
    // covers Bags (meteora-curve), Raydium LaunchLab / LetsBonk
    // (raydium-launchpad) and any other launchpad curve, not just Bags. ST's
    // getTokenInfo is already cached from creator detection, so this is ~free.
    if (!pumpInfo) {
      try {
        const stm = await solanaTracker.getTokenMarketStatus(mint);
        if (stm) {
          if (bagsInfo) {
            bagsInfo.onBondingCurve = stm.onBondingCurve;
            bagsInfo.graduated = stm.graduated;
            bagsInfo.curvePercentage = stm.curvePercentage;
            bagsInfo.market = stm.market;
            bagsInfo.stLiquidityUsd = stm.liquidityUsd;
          }
          lpOnCurve = stm.onBondingCurve === true;
          lpCurvePct = stm.curvePercentage;
          lpCurveLiqUsd = stm.liquidityUsd || 0;
          if (!bagsInfo && lpOnCurve) {
            const m = (stm.market || "").toLowerCase();
            lpName = m === "meteora-curve" ? "Bags"
              : m.includes("launchpad") ? (MINT_LOWER.endsWith("bonk") ? "LetsBonk" : "Raydium LaunchLab")
              : m === "moonshot" ? "Moonshot"
              : m === "pumpfun" ? "Pump.fun"
              : "the launchpad";
          }
          console.log(`[AUTOPSY] market status: market=${stm.market} onCurve=${stm.onBondingCurve} curve=${stm.curvePercentage}% stLiq=$${stm.liquidityUsd}`);
        }
      } catch (e) { /* degrade — leave as graduated/unknown */ }
    }

    if (lpOnCurve && lpCurveLiqUsd >= 500
      && ["LP_RUG", "GHOST", "UNCLEAR", "SOFT_RUG", "AT_RISK"].includes(verdict.type)) {
      const curveStr = lpCurvePct != null ? ` (${lpCurvePct.toFixed(1)}% to graduation)` : "";
      verdict = { type: "ON_CURVE", label: "Status: ON THE BONDING CURVE — PRE-GRADUATION", severity: "AT_RISK", color: "#F59E0B", icon: "🌱" };
      reportMode = "health-assessment";
      reportHeadline = "🌱 ON THE BONDING CURVE";
      reportSubhead = `Still on the ${lpName} bonding curve${curveStr} — it hasn't graduated to a DEX pool yet. No DEX pool is normal at this stage (liquidity is the curve reserve, ~$${Math.round(lpCurveLiqUsd).toLocaleString()}), not a rug. Early and speculative by definition.`;
      // Strip the misleading DexScreener-liquidity red flags (meaningless
      // pre-graduation) and replace with the honest curve-reserve fact.
      const drop = ["effectively no exit", "zero current liquidity", "No DexScreener pool", "never launched a tradeable"];
      for (let i = redFlags.length - 1; i >= 0; i--) {
        if (drop.some(d => redFlags[i].includes(d))) redFlags.splice(i, 1);
      }
      redFlags.push(`Still on the ${lpName} bonding curve${curveStr} with ~$${Math.round(lpCurveLiqUsd).toLocaleString()} in curve-reserve liquidity — early and speculative, but the curve is intact (the DEX pool comes at graduation, not a rug).`);
      // At low curve %, the bonding-curve contract itself is the biggest "holder",
      // so a raw top-10 % reads as false whale concentration. Reframe it.
      if (lpCurvePct != null && lpCurvePct < 60) {
        for (let i = 0; i < redFlags.length; i++) {
          if (redFlags[i].includes("heavy concentration")) {
            redFlags[i] = `Top-10 holder share looks high, but the token is only ${lpCurvePct.toFixed(0)}% through its bonding curve — most of that supply still sits in the curve contract (unbought), not in whale wallets. Re-check holder concentration after it graduates.`;
          }
        }
      }
    }

    // --- Phase 2J: Pump.fun creator-fee tracking ---
    // Pump.fun creators earn a per-trade creator fee that accrues in a
    // "creator vault" PDA (seeds ["creator-vault", creator] on the Pump
    // program). This is the cheap, deterministic Pump-fee source — derive the
    // vault, read its current balance (unclaimed fees) + signature activity
    // (every accrual/claim leaves a tx). No paid indexer needed. Only runs for
    // pump-suffixed mints with an identified creator.
    let pumpCreatorFees = null;
    try {
      const isPumpMint = typeof mint === "string" && mint.toLowerCase().endsWith("pump");
      if (isPumpMint && effectiveCreatorWallet) {
        const vault = derivePumpCreatorVault(effectiveCreatorWallet);
        if (vault) {
          const [balRes, sigRes] = await Promise.all([
            rpcCall("autopsy-pump-vault-bal", "getBalance", [vault]),
            rpcCall("autopsy-pump-vault-sigs", "getSignaturesForAddress", [vault, { limit: 1000 }]),
          ]);
          // Distinguish a genuine empty/new vault from a FAILED lookup. A
          // failed RPC has no `result` field at all — showing "0 fees" in that
          // case would falsely tell an upset holder "the dev took nothing"
          // when we simply didn't get an answer. If the signatures lookup
          // didn't return an array, treat the whole thing as a miss and skip
          // (panel hides) rather than reporting a misleading zero.
          const sigsOk = Array.isArray(sigRes?.result);
          if (!sigsOk) {
            console.warn(`[AUTOPSY] Phase 2J vault lookup failed (no result) for ${vault.slice(0,8)} — skipping to avoid false zero`);
            throw new Error("vault-lookup-failed");
          }
          const unclaimedLamports = balRes?.result?.value || 0;
          const sigs = sigRes.result;
          const oldestTs = sigs.length ? sigs[sigs.length - 1].blockTime : null;
          // Lifetime CLAIMED — walk the vault history and sum SOL that left
          // the vault to the creator (the claim outflows). This is the honest
          // "how much did the dev extract in creator fees" number — the one an
          // upset holder of a failed token actually wants. We use this vault's
          // own outflows (nativeTransfers from vault → creator) so a claim that
          // batched multiple tokens' vaults is attributed correctly to THIS
          // token only. Walks up to the 1000-sig cap; flagged as a lower bound
          // if capped. Cheap now that Phase 2F is gone.
          let lifetimeClaimedSol = null;
          try {
            const sigList = sigs.map(s => s.signature).filter(Boolean);
            if (sigList.length > 0) {
              const walk = await heliusEnhancedBatched(sigList, HELIUS_KEY, "phase-2J-vault", heliusTxCache, scanQuality);
              let claimedLamports = 0;
              for (const tx of (walk.txs || [])) {
                for (const nt of (tx.nativeTransfers || [])) {
                  if (nt && nt.fromUserAccount === vault && nt.toUserAccount === effectiveCreatorWallet) {
                    claimedLamports += Number(nt.amount) || 0;
                  }
                }
              }
              lifetimeClaimedSol = claimedLamports / 1e9;
            }
          } catch (e) {
            console.warn("[AUTOPSY] Phase 2J claimed-fee walk failed:", e.message);
          }
          pumpCreatorFees = {
            vault,
            unclaimedSol: unclaimedLamports / 1e9,
            // Lifetime SOL the creator pulled out of this token's fee vault.
            lifetimeClaimedSol,
            // Total fees the creator has realized from this token = claimed +
            // what's still sitting unclaimed in the vault.
            lifetimeTotalSol: lifetimeClaimedSol != null ? lifetimeClaimedSol + unclaimedLamports / 1e9 : null,
            // Number of on-chain fee events touching the vault (accruals +
            // claims). A proxy for how actively the token generated creator
            // fees. Capped at 1000 by the signature page; show "1000+" then.
            feeEventCount: sigs.length,
            feeEventsCapped: sigs.length >= 1000,
            firstFeeEventTs: oldestTs ? oldestTs * 1000 : null,
          };
          console.log(`[AUTOPSY] Phase 2J pump creator fees: vault=${vault.slice(0,8)}… unclaimed=${pumpCreatorFees.unclaimedSol.toFixed(4)} claimed=${lifetimeClaimedSol != null ? lifetimeClaimedSol.toFixed(3) : "?"} SOL events=${sigs.length}${pumpCreatorFees.feeEventsCapped ? "+" : ""}`);
        }
      }
    } catch (e) {
      console.warn("[AUTOPSY] Phase 2J pump creator-fee tracking failed:", e.message);
    }

    // --- Phase 2K: Creator wallet profile + funding source ---
    // Is the creator wallet an established operator wallet or a fresh throwaway
    // deployer? One signatures page answers it cheaply: 1000+ txs = established
    // (NOT a burner). For a FRESH wallet (genesis reachable in one page) we
    // trace one hop back — who funded it — because "creator funds a brand-new
    // deployer from a single source right before launch" is the obfuscation
    // pattern the funding-source check (from the research note) is meant to
    // catch. We don't deep-paginate active wallets — that would violate the
    // cheap-first rule and the activity level already tells the story.
    let creatorWalletProfile = null;
    try {
      if (effectiveCreatorWallet) {
        const profRes = await rpcCall("autopsy-creator-profile", "getSignaturesForAddress", [effectiveCreatorWallet, { limit: 1000 }]);
        const psigs = profRes?.result;
        if (Array.isArray(psigs) && psigs.length > 0) {
          const isEstablished = psigs.length >= 1000;
          const oldestSeen = psigs[psigs.length - 1].blockTime;
          let fundingSource = null;
          if (!isEstablished) {
            // Genesis reachable in one page — the oldest tx is the wallet's
            // first. Parse it (enhanced) and read who sent the creator its
            // first SOL. That sender is the funding source.
            try {
              const gSig = psigs[psigs.length - 1].signature;
              const gWalk = await heliusEnhancedBatched([gSig], HELIUS_KEY, "phase-2K-genesis", heliusTxCache, scanQuality);
              const gtx = (gWalk.txs || [])[0];
              if (gtx && Array.isArray(gtx.nativeTransfers)) {
                let best = null;
                for (const nt of gtx.nativeTransfers) {
                  if (nt && nt.toUserAccount === effectiveCreatorWallet && nt.fromUserAccount && nt.fromUserAccount !== effectiveCreatorWallet) {
                    if (!best || (Number(nt.amount) || 0) > (Number(best.amount) || 0)) best = nt;
                  }
                }
                if (best) {
                  fundingSource = {
                    wallet: best.fromUserAccount,
                    solAmount: (Number(best.amount) || 0) / 1e9,
                    label: KNOWN_CEX_WALLETS[best.fromUserAccount] || null,
                  };
                }
              }
            } catch (e) { /* funding trace best-effort */ }
          }
          // Serial-deployer signal — how many tokens this wallet has launched.
          // A high count flips "established wallet" from reassuring to a
          // token-mill risk flag. Best-effort via Solana Tracker.
          let deployedTokens = null;
          try { deployedTokens = await solanaTracker.getDeployerTokenCount(effectiveCreatorWallet); } catch (e) { /* degrade */ }
          const deployCount = deployedTokens ? deployedTokens.count : null;
          const deployExact = deployedTokens ? deployedTokens.exact : false;
          // Tiered: 25+ = serial launcher (token mill), 5-24 = multiple tokens.
          const isSerialDeployer = deployCount != null && deployCount >= 25;
          creatorWalletProfile = {
            txCountAtLeast: psigs.length,
            isEstablished,
            oldestSeenTs: oldestSeen ? oldestSeen * 1000 : null,
            fundingSource,
            deployedTokenCount: deployCount,
            deployedTokenCountExact: deployExact,
            isSerialDeployer,
          };
          if (isSerialDeployer) {
            redFlags.push(`Creator wallet has deployed ${deployExact ? "" : "at least "}${deployCount} tokens — a serial-launcher pattern. A long wallet history here is a token-mill signal, not a sign of a committed operator.`);
          }
          console.log(`[AUTOPSY] Phase 2K creator profile: ${effectiveCreatorWallet.slice(0,8)}… established=${isEstablished} txs>=${psigs.length} deployed=${deployCount != null ? (deployExact ? "" : ">=") + deployCount : "?"} serial=${isSerialDeployer} funder=${fundingSource ? (fundingSource.label || fundingSource.wallet.slice(0,8)) : "n/a"}`);
        }
      }
    } catch (e) {
      console.warn("[AUTOPSY] Phase 2K creator profile failed:", e.message);
    }

    // --- Per-wallet P&L ledger: REMOVED ---
    // The Helius-based lifetime P&L walk was the heaviest, most rate-limit-prone
    // part of the free autopsy and had already been disabled behind a flag.
    // Removed entirely; everything downstream null-guards walletPnl. The token-
    // gated "P&L Express" (Solana Tracker /traders) in lib/premium-forensics.js
    // is the path forward if a per-wallet ledger is ever wanted again.
    let walletPnl = null;

    // --- Creator-status enrichment from walletPnl ---
    // Now that we know what every wallet actually did on-chain, replace the
    // "creator not in top 100 → must have exited" inference with the actual
    // truth: did they buy? sell? do buy-backs? sit dormant? This is the
    // honest answer for fee-receiving operational wallets that legitimately
    // don't hold tokens at any given snapshot.
    // --- Phase 2G: Direct creator-wallet trace ---
    // The Phase 2F lifetime walk can miss daily creator buy-backs when they
    // route through Jupiter (multi-hop token transfers don't fit the clean
    // pool→wallet pattern). Walk the creator wallet's OWN signatures directly
    // and count CLKN buys/sells/locks. Targeted and accurate — independent of
    // how the swap was routed.
    let creatorTrace = null;
    if (creatorStatus && creatorStatus.wallet) {
      try {
        // Rebuild a small lockerAddressSet here so we can detect lock deposits
        // independently of Phase 2F's scope.
        const traceLockerSet = new Set();
        for (const p of LOCKER_PROGRAMS) traceLockerSet.add(p);
        for (const h of topHolders) {
          const addr = h.authority || h.wallet;
          if ((h.category === "locker" || h.category === "selflock") && addr) {
            traceLockerSet.add(addr);
          }
        }
        // Paginate aggressively — heavy buy-back wallets accumulate thousands
        // of sigs (every claim, every buy, every lock, every transfer). Cap
        // at 5000 sigs (5 pages × 1000) to give honest coverage.
        const allCreatorSigs = [];
        let beforeSig = undefined;
        for (let p = 0; p < 5; p++) {
          const params = beforeSig
            ? [creatorStatus.wallet, { limit: 1000, before: beforeSig }]
            : [creatorStatus.wallet, { limit: 1000 }];
          const sigsRes = await rpcCall(`autopsy-creator-direct-sigs-${p}`, "getSignaturesForAddress", params);
          const pageSigs = sigsRes?.result || [];
          if (pageSigs.length === 0) break;
          allCreatorSigs.push(...pageSigs);
          if (pageSigs.length < 1000) break;
          beforeSig = pageSigs[pageSigs.length - 1].signature;
        }
        const sigs = allCreatorSigs.map(s => s.signature);
        // Critical: only SWAP-type transactions count as buys/sells. A
        // non-SWAP outflow is a transfer or a lock deposit, NOT a sell.
        // Earlier version conflated all outflows as sells which produced the
        // wrong "163 sells" result for wallets that only buy-and-lock.
        let buyCount = 0, sellCount = 0, lockCount = 0;
        let transferInCount = 0, transferOutCount = 0;
        let boughtTokens = 0, soldTokens = 0, lockedTokens = 0;
        let transferInTokens = 0, transferOutTokens = 0;
        // Per-destination CLKN flow out — used to identify sub-distributor
        // wallets for the multi-hop team-network trace below.
        const transferOutByDest = new Map(); // wallet → tokens transferred out
        // Per-source CLKN flow in (in case sub-wallets sent CLKN back).
        const transferInBySource = new Map();
        // Per-destination SOL flow out (non-swap). Critical for buy-and-lock
        // teams: creator claims SOL fees and sends SOL (not CLKN) to a
        // sub-wallet that does the buys + locks. Without this, multi-hop
        // misses the whole "fees → SOL → sub-wallet buys" path.
        const solOutByDest = new Map(); // wallet → lamports
        let boughtUsd = 0, soldUsd = 0;
        // SOL actually spent on buys. This is the most honest "$ into the
        // token" signal because it tracks what the user paid in SOL terms,
        // independent of when CLKN's daily-close price was for USD valuation.
        let boughtSolLamports = 0, soldSolLamports = 0;
        let firstTs = null, lastTs = null;
        // Phase 2G creator-trace through the same retry-aware helper.
        const creatorFetchResult = await heliusEnhancedBatched(
          sigs, HELIUS_KEY, "phase-2G-creator", heliusTxCache, scanQuality
        );
        {
          const dataR = creatorFetchResult.txs;
          {
            for (const tx of dataR) {
              if (!tx || tx.transactionError) continue;
              const ts = tx.timestamp ? tx.timestamp * 1000 : null;
              const dayKey = ts ? Math.floor(ts / 86400000) : null;
              let dayUsd = dayKey !== null ? priceCandlesByDay.get(dayKey) : null;
              if (!dayUsd && dayKey !== null) {
                for (let off = 1; off <= 3 && !dayUsd; off++) {
                  dayUsd = priceCandlesByDay.get(dayKey - off) || priceCandlesByDay.get(dayKey + off) || null;
                }
              }
              const isSwap = tx.type === "SWAP";
              // SOL cost flows through BOTH nativeTransfers (raw SOL) and WSOL
              // tokenTransfers (the common Jupiter path). Sum both for EVERY tx
              // — not just type==="SWAP" — because Helius mislabels many real
              // swaps (Jupiter/aggregator/newer launchpad routes) as UNKNOWN or
              // TRANSFER. We reclassify by value flow below.
              const WSOL_MINT = "So11111111111111111111111111111111111111112";
              let netSolForCreatorLamports = 0;
              if (Array.isArray(tx.nativeTransfers)) {
                for (const nt of tx.nativeTransfers) {
                  if (!nt) continue;
                  if (nt.fromUserAccount === creatorStatus.wallet) {
                    netSolForCreatorLamports -= Number(nt.amount) || 0;
                  } else if (nt.toUserAccount === creatorStatus.wallet) {
                    netSolForCreatorLamports += Number(nt.amount) || 0;
                  }
                }
              }
              if (Array.isArray(tx.tokenTransfers)) {
                for (const tt of tx.tokenTransfers) {
                  if (!tt || tt.mint !== WSOL_MINT) continue;
                  // WSOL has 9 decimals — tokenAmount IS the SOL-equivalent.
                  const lamports = Math.round((Number(tt.tokenAmount) || 0) * 1e9);
                  if (tt.fromUserAccount === creatorStatus.wallet) {
                    netSolForCreatorLamports -= lamports;
                  } else if (tt.toUserAccount === creatorStatus.wallet) {
                    netSolForCreatorLamports += lamports;
                  }
                }
              }
              // ── Value-flow trade detection (the 2G under-count fix) ──
              // A BUY = creator RECEIVED CLKN and PAID SOL (net SOL out); a SELL
              // = creator SENT CLKN and RECEIVED SOL. True regardless of the
              // Helius `type` label, so it captures the buys/sells previously
              // dropped into the transfer bucket (e.g. 71 of 128 → full count).
              const SOL_TRADE_LAMPORTS = 1_000_000; // 0.001 SOL — ignore dust/fees
              let clknIn = false, clknOut = false;
              for (const tt of (Array.isArray(tx.tokenTransfers) ? tx.tokenTransfers : [])) {
                if (!tt || tt.mint !== mint) continue;
                if (tt.toUserAccount === creatorStatus.wallet) clknIn = true;
                else if (tt.fromUserAccount === creatorStatus.wallet) clknOut = true;
              }
              const buyByFlow  = clknIn  && (isSwap || netSolForCreatorLamports <= -SOL_TRADE_LAMPORTS);
              const sellByFlow = clknOut && (isSwap || netSolForCreatorLamports >=  SOL_TRADE_LAMPORTS);
              const isCreatorTrade = buyByFlow || sellByFlow;
              // NON-swap SOL outflows to genuine human-wallet destinations.
              // CRITICAL: Helius sometimes classifies multi-hop swaps as
              // type !== "SWAP" — we must defensively exclude any destination
              // that's a DEX program, locker, LP authority, CEX, token
              // program, or system program. Otherwise we count routing SOL
              // as if it were a transfer to a sub-distributor (the bug that
              // produced "193 SOL sent to sub-wallets" on CLKN).
              if (!isCreatorTrade && Array.isArray(tx.nativeTransfers)) {
                for (const nt of tx.nativeTransfers) {
                  if (!nt) continue;
                  if (nt.fromUserAccount === creatorStatus.wallet
                    && nt.toUserAccount
                    && nt.toUserAccount !== creatorStatus.wallet) {
                    const dest = nt.toUserAccount;
                    // Reject any program/system destination — only true
                    // wallet-to-wallet SOL transfers count.
                    if (DEX_PROGRAMS.has(dest) || LOCKER_PROGRAMS.has(dest)
                      || TOKEN_PROGRAMS.has(dest) || traceLockerSet.has(dest)
                      || KNOWN_CEX_WALLETS[dest]
                      || dest === "11111111111111111111111111111111") continue;
                    const lamports = Number(nt.amount) || 0;
                    if (lamports >= 10_000_000) { // ≥ 0.01 SOL → meaningful
                      solOutByDest.set(
                        dest,
                        (solOutByDest.get(dest) || 0) + lamports
                      );
                    }
                  }
                }
              }
              const tts = Array.isArray(tx.tokenTransfers) ? tx.tokenTransfers : [];
              // To avoid double-counting SOL across multiple tokenTransfers in
              // the same swap (Jupiter routes), record one SOL leg per swap.
              let solRecordedForThisSwap = false;
              for (const tt of tts) {
                if (!tt || tt.mint !== mint) continue;
                const amt = Number(tt.tokenAmount) || 0;
                if (amt <= 0) continue;
                const touched = ts;
                // Creator received CLKN
                if (tt.toUserAccount === creatorStatus.wallet) {
                  if (buyByFlow) {
                    // Market buy — received CLKN and paid SOL (or Helius typed
                    // it SWAP). Counts routed/aggregator buys, not just SWAPs.
                    buyCount++;
                    boughtTokens += amt;
                    if (dayUsd) boughtUsd += amt * dayUsd;
                    // SOL spent on this buy = negative netSol. Record once per tx.
                    if (!solRecordedForThisSwap && netSolForCreatorLamports < 0) {
                      boughtSolLamports += Math.abs(netSolForCreatorLamports);
                      solRecordedForThisSwap = true;
                    }
                  } else {
                    // Received CLKN with no SOL paid — a genuine transfer-in
                    // (gift/airdrop/sub-wallet return), not a market buy.
                    transferInCount++;
                    transferInTokens += amt;
                    if (tt.fromUserAccount) {
                      transferInBySource.set(
                        tt.fromUserAccount,
                        (transferInBySource.get(tt.fromUserAccount) || 0) + amt
                      );
                    }
                  }
                  if (touched) {
                    if (!firstTs || touched < firstTs) firstTs = touched;
                    if (!lastTs || touched > lastTs) lastTs = touched;
                  }
                }
                // Creator sent CLKN
                else if (tt.fromUserAccount === creatorStatus.wallet) {
                  if (traceLockerSet.has(tt.toUserAccount)) {
                    // Lock deposit — supply removed (never a sell, even if SOL moved).
                    lockCount++;
                    lockedTokens += amt;
                  } else if (sellByFlow) {
                    // Market sell — sent CLKN and received SOL (or Helius typed
                    // it SWAP). Locks/transfers are NOT sells.
                    sellCount++;
                    soldTokens += amt;
                    if (dayUsd) soldUsd += amt * dayUsd;
                    // SOL received from this sell = positive netSol for creator.
                    if (!solRecordedForThisSwap && netSolForCreatorLamports > 0) {
                      soldSolLamports += netSolForCreatorLamports;
                      solRecordedForThisSwap = true;
                    }
                  } else {
                    // Sent to another wallet — transfer-out, NOT a sell. Could
                    // be a sub-distributor wallet, a team operational move, or
                    // a gift; the hidden-exit detection (Phase 2C-bis) will
                    // surface if those recipients subsequently dump.
                    transferOutCount++;
                    transferOutTokens += amt;
                    if (tt.toUserAccount) {
                      transferOutByDest.set(
                        tt.toUserAccount,
                        (transferOutByDest.get(tt.toUserAccount) || 0) + amt
                      );
                    }
                  }
                  if (touched) {
                    if (!firstTs || touched < firstTs) firstTs = touched;
                    if (!lastTs || touched > lastTs) lastTs = touched;
                  }
                }
              }
            }
          }
        }
        if (creatorFetchResult.rateLimited > 0) scanQuality.phasesFailed.push("phase-2G-partial");
        else scanQuality.phasesCompleted.push("phase-2G");
        const boughtSol = boughtSolLamports / 1e9;
        const soldSol = soldSolLamports / 1e9;
        // VERIFICATION — fetch the creator wallet's current SOL balance and
        // compute: claimed - bought - currentBalance - knownSent ≈ 0 if we
        // captured everything. Surfaces undercounting honestly.
        let creatorSolBalanceNow = null;
        let unaccountedSol = null;
        try {
          const balRes = await rpcCall("autopsy-creator-bal", "getBalance", [creatorStatus.wallet]);
          if (balRes && balRes.result && balRes.result.value != null) {
            creatorSolBalanceNow = Number(balRes.result.value) / 1e9;
          }
        } catch (e) { console.warn("[AUTOPSY] Creator wallet balance fetch failed:", e.message); }
        const claimedSolNow = bagsInfo?.totalClaimedSol || bagsInfo?.lifetimeFeesSol || null;
        const knownSolSentToSubs = [...solOutByDest.values()].reduce((a, b) => a + b, 0) / 1e9;
        if (claimedSolNow != null && creatorSolBalanceNow != null) {
          unaccountedSol = claimedSolNow - boughtSol - creatorSolBalanceNow - knownSolSentToSubs;
          console.log(`[AUTOPSY] SOL verification — claimed=${claimedSolNow.toFixed(3)}  buys=${boughtSol.toFixed(3)}  currentBal=${creatorSolBalanceNow.toFixed(3)}  sentToSubs=${knownSolSentToSubs.toFixed(3)}  unaccounted=${unaccountedSol.toFixed(3)}`);
        }
        // Cross-reference against the Bags lifetime fees: how much of the SOL
        // claimed in creator fees is the wallet actually putting back into
        // buy-backs? > 80% = "reinvesting everything". Strongest project signal.
        const claimedSol = bagsInfo?.totalClaimedSol || bagsInfo?.lifetimeFeesSol || null;
        const pctReinvested = claimedSol && claimedSol > 0
          ? Math.min(100, (boughtSol / claimedSol) * 100)
          : null;
        creatorTrace = {
          sigsScanned: sigs.length,
          buyCount, sellCount, lockCount,
          transferInCount, transferOutCount,
          // Distinct recipient wallets of the creator's token transfers-out.
          // The COUNT is free (we already have the dest map); the per-wallet
          // sell-trace (did each recipient dump?) is the premium feature.
          transferOutDistinctRecipients: transferOutByDest.size,
          boughtTokens, soldTokens, lockedTokens,
          transferInTokens, transferOutTokens,
          boughtUsd, soldUsd,
          boughtSol, soldSol,
          netUsd: boughtUsd - soldUsd,
          netSol: boughtSol - soldSol,
          claimedSol,
          pctReinvested,
          firstTs, lastTs,
          // Verification balance — lets the UI flag if numbers don't add up.
          creatorSolBalanceNow,
          knownSolSentToSubs,
          unaccountedSol,
        };
        console.log(`[AUTOPSY] Phase 2G creator trace for ${creatorStatus.wallet.slice(0,8)}…: sigs=${sigs.length} buys=${buyCount}(${boughtSol.toFixed(3)} SOL) sells=${sellCount} locks=${lockCount} claimed=${claimedSol || "?"} SOL pctReinvested=${pctReinvested !== null ? pctReinvested.toFixed(0) + "%" : "—"}`);

        // Merge with best-observed cache — forensic counters can only grow,
        // so a lower fresh observation than cached is always capture failure.
        const merged = bestObservedTrace(creatorStatus.wallet, mint, creatorTrace);
        creatorTrace = merged.trace;
        creatorTrace.usedBestObservedCache = merged.usedCache;

        // ── Solana Tracker independent cross-verification ───────────────
        // Same wallet, same mint, computed server-side from their indexer
        // rather than our Helius signature scan. This is the "second
        // opinion" that lets the UI show a ✓ badge when numbers agree
        // (high confidence) or surface the discrepancy when they don't.
        // Free tier — gracefully no-op if key is missing or quota is hit.
        try {
          const stPos = await solanaTracker.getWalletTokenPosition(creatorStatus.wallet, mint);
          if (stPos) {
            // Actual response shape (verified from production debug 2026-05-21):
            //   { wallet, identity, pnlMode, token,
            //     pnl:     { realized, realizedRaw, unrealized, total },
            //     invested, proceeds, roi,
            //     current: { balance, costBasis, value, price, avgCost },
            //     volume:  { tokensBought, tokensSold, buyUsd, sellUsd },
            //     averages:{ buy, sell },
            //     counts:  { buys, sells, total },
            //     timing:  { firstBuy, lastBuy, firstTrade, lastTrade, holdTimeSecs },
            //     meta:    { symbol, name, decimals, price, marketCap, liquidity, primaryMarket } }
            // Read defensively in case a future schema tweak nests fields
            // differently — fall back to the flat shape if the namespaced
            // one isn't present.
            const pnlNs   = stPos.pnl     || {};
            const curNs   = stPos.current || {};
            const volNs   = stPos.volume  || {};
            const cntNs   = stPos.counts  || {};
            const timeNs  = stPos.timing  || {};
            const stRealized   = Number(pnlNs.realized   != null ? pnlNs.realized   : stPos.realized   || 0);
            const stUnrealized = Number(pnlNs.unrealized != null ? pnlNs.unrealized : stPos.unrealized || 0);
            const stTotal      = Number(pnlNs.total      != null ? pnlNs.total      : (stRealized + stUnrealized));
            const stBuys       = Number(cntNs.buys       != null ? cntNs.buys       : stPos.buys       || 0);
            const stSells      = Number(cntNs.sells      != null ? cntNs.sells      : stPos.sells      || 0);
            const stBalance    = Number(curNs.balance    != null ? curNs.balance    : stPos.balance    || 0);
            const stCostUsd    = Number(curNs.costBasis  != null ? curNs.costBasis  : stPos.costBasis  || 0);
            const stValueUsd   = Number(curNs.value      != null ? curNs.value      : stPos.value      || 0);
            const stBoughtUsd  = Number(volNs.buyUsd     != null ? volNs.buyUsd     : stPos.totalBought || 0);
            const stSoldUsd    = Number(volNs.sellUsd    != null ? volNs.sellUsd    : stPos.totalSold  || 0);
            const stInvested   = Number(stPos.invested   != null ? stPos.invested   : 0);
            const stProceeds   = Number(stPos.proceeds   != null ? stPos.proceeds   : 0);
            const stRoi        = Number(stPos.roi        != null ? stPos.roi        : 0);
            const stFirstBuy   = timeNs.firstBuy || null;
            const stLastBuy    = timeNs.lastBuy  || null;
            // Compare with our own counters. We treat <=20% absolute drift
            // on bought-USD or buy count as "in agreement" since the two
            // sources price slightly differently (theirs uses their own
            // OHLCV at fill time; ours uses GeckoTerminal closes).
            const ourBuys      = creatorTrace.buyCount || 0;
            const ourBoughtUsd = creatorTrace.boughtUsd || 0;
            const buysAgree    = stBuys === 0 ? ourBuys === 0
              : Math.abs(stBuys - ourBuys) / Math.max(stBuys, ourBuys, 1) <= 0.2;
            const usdAgree     = stBoughtUsd === 0 ? ourBoughtUsd === 0
              : Math.abs(stBoughtUsd - ourBoughtUsd) / Math.max(stBoughtUsd, ourBoughtUsd, 1) <= 0.2;
            // Divergence classification — not all mismatches are alarming.
            // Three states:
            //   "agree"        → numbers match within tolerance (green ✓)
            //   "st-sees-more" → ST captured MORE buys than us but both agree
            //                    on zero sells. That's just our trace being
            //                    conservative (signature-walk gaps), NOT a
            //                    red flag. Neutral/blue badge.
            //   "concerning"   → ST caught sells we missed, or the numbers
            //                    conflict in a way worth a manual look. Red.
            const ourSells = creatorTrace.sellCount || 0;
            const sellsMatch = stSells === ourSells || (stSells === 0 && ourSells === 0);
            let divergenceKind;
            if (buysAgree && usdAgree) {
              divergenceKind = "agree";
            } else if (stBuys >= ourBuys && stSells === 0 && ourSells === 0) {
              // ST sees same-or-more buys, nobody sold — pure capture gap.
              divergenceKind = "st-sees-more";
            } else {
              divergenceKind = "concerning";
            }
            // Identity tags (developer / pool / arbitrage etc.) — surface
            // them for UI labeling even if the position numbers don't agree.
            const stIdentity = stPos.identity || null;
            creatorTrace.solanaTrackerCrossCheck = {
              source: "solana-tracker /v2/pnl/wallets/{wallet}/tokens/{token}",
              pnlMode: stPos.pnlMode || "strict",
              identity: stIdentity,
              realized: stRealized,
              unrealized: stUnrealized,
              total: stTotal,
              buys: stBuys,
              sells: stSells,
              balance: stBalance,
              costBasisUsd: stCostUsd,
              valueUsd: stValueUsd,
              totalBoughtUsd: stBoughtUsd,
              totalSoldUsd: stSoldUsd,
              // Per-token "invested" (personal USD into this mint) and
              // proceeds (USD pulled out via sells). Together with ROI
              // these answer "did the dev actually put their own money in".
              invested: stInvested,
              proceeds: stProceeds,
              roi: stRoi,
              firstBuyTs: stFirstBuy,
              lastBuyTs: stLastBuy,
              // Tells the UI whether to show a green ✓ or an amber !
              agrees: buysAgree && usdAgree,
              buysAgree, usdAgree,
              // "agree" | "st-sees-more" | "concerning" — drives the badge.
              divergenceKind,
              // Useful headline fact: dev has never sold this token.
              neverSold: stSells === 0 && stSoldUsd === 0,
            };
            console.log(`[AUTOPSY] Phase 2G Solana Tracker cross-check: stBuys=${stBuys} stBoughtUsd=$${stBoughtUsd.toFixed(2)} stSells=${stSells} ourBuys=${ourBuys} ourBoughtUsd=$${ourBoughtUsd.toFixed(2)} agrees=${buysAgree && usdAgree}`);
          } else {
            console.log("[AUTOPSY] Phase 2G Solana Tracker cross-check skipped (no data — key missing or quota hit)");
          }
        } catch (e) {
          console.warn("[AUTOPSY] Phase 2G Solana Tracker cross-check failed:", e.message);
        }

        // --- Phase 2G-bis: Multi-hop sub-distributor trace ---
        // The creator often routes through sub-distributor wallets that do
        // the actual lock deposits or additional buys. To get the FULL team
        // picture, identify the top sub-distributors the creator transferred
        // CLKN to, trace their CLKN activity, and aggregate everything into
        // a "team network" total. This is what closes the gap between
        // "creator wallet buys" and "every fee went into the token".
        try {
          // Sub-distributor candidates = wallets that received either
          // significant CLKN OR significant SOL from the creator. This
          // covers BOTH paths: (a) creator buys CLKN + transfers to sub,
          // and (b) creator transfers SOL → sub buys CLKN itself. Without
          // path (b) we miss most buy-and-lock teams.
          const candidateMap = new Map();
          for (const [w, tokens] of transferOutByDest) {
            candidateMap.set(w, { wallet: w, clknTokens: tokens, solLamports: 0 });
          }
          for (const [w, lamports] of solOutByDest) {
            const existing = candidateMap.get(w) || { wallet: w, clknTokens: 0, solLamports: 0 };
            existing.solLamports = lamports;
            candidateMap.set(w, existing);
          }
          // Rank by combined "value flowed" — treat 1 SOL ≈ 1e6 CLKN units
          // for ranking purposes (rough; just needs to be in the same
          // ballpark). Then keep top 3 candidates not already in the
          // locker / LP / CEX exclusion sets.
          const subDistCandidates = [...candidateMap.values()]
            .filter(c => !traceLockerSet.has(c.wallet) && !excludeSet.has(c.wallet))
            .map(c => ({
              ...c,
              tokensReceived: c.clknTokens,
              solReceived: c.solLamports / 1e9,
              rankScore: c.clknTokens + (c.solLamports / 1e9) * 1_000_000,
            }))
            .filter(c => c.solReceived >= 0.1 || c.clknTokens > 0)
            .sort((a, b) => b.rankScore - a.rankScore)
            .slice(0, 3);
          console.log(`[AUTOPSY] Phase 2G-bis sub-distributor candidates: ${subDistCandidates.map(c => `${c.wallet.slice(0,8)}…(clkn=${Math.round(c.clknTokens)}, sol=${c.solReceived.toFixed(2)})`).join(", ") || "(none)"}`);

          const teamSubTraces = [];
          for (const cand of subDistCandidates) {
            try {
              // Walk the sub-distributor wallet's sigs (smaller cap — these
              // are secondary in the chain).
              const subSigs = [];
              let subBefore = undefined;
              for (let p = 0; p < 3; p++) {
                const params = subBefore
                  ? [cand.wallet, { limit: 1000, before: subBefore }]
                  : [cand.wallet, { limit: 1000 }];
                const r = await rpcCall(`autopsy-subdist-${cand.wallet.slice(0,8)}-${p}`, "getSignaturesForAddress", params);
                const pageSigs = r?.result || [];
                if (pageSigs.length === 0) break;
                subSigs.push(...pageSigs);
                if (pageSigs.length < 1000) break;
                subBefore = pageSigs[pageSigs.length - 1].signature;
              }
              const subSigList = subSigs.map(s => s.signature);
              let sBuy = 0, sSell = 0, sLock = 0, sTransOut = 0;
              let sBoughtTokens = 0, sSoldTokens = 0, sLockedTokens = 0;
              let sBoughtSolLamports = 0, sSoldSolLamports = 0;
              let sBoughtUsd = 0, sSoldUsd = 0;
              const subFetchResult = await heliusEnhancedBatched(
                subSigList, HELIUS_KEY, `phase-2G-sub-${cand.wallet.slice(0,6)}`, heliusTxCache, scanQuality
              );
              {
                {
                  const dataR = subFetchResult.txs;
                  for (const tx of dataR) {
                    if (!tx || tx.transactionError) continue;
                    const ts = tx.timestamp ? tx.timestamp * 1000 : null;
                    const dayKey = ts ? Math.floor(ts / 86400000) : null;
                    let dayUsd = dayKey !== null ? priceCandlesByDay.get(dayKey) : null;
                    if (!dayUsd && dayKey !== null) {
                      for (let off = 1; off <= 3 && !dayUsd; off++) {
                        dayUsd = priceCandlesByDay.get(dayKey - off) || priceCandlesByDay.get(dayKey + off) || null;
                      }
                    }
                    const isSwap = tx.type === "SWAP";
                    let netSolLamports = 0;
                    if (isSwap && Array.isArray(tx.nativeTransfers)) {
                      for (const nt of tx.nativeTransfers) {
                        if (!nt) continue;
                        if (nt.fromUserAccount === cand.wallet) netSolLamports -= Number(nt.amount) || 0;
                        else if (nt.toUserAccount === cand.wallet) netSolLamports += Number(nt.amount) || 0;
                      }
                    }
                    // Same WSOL fix as creator trace — Jupiter/Bags routes
                    // move SOL via WSOL token transfers, not native transfers.
                    const WSOL_MINT_SUB = "So11111111111111111111111111111111111111112";
                    if (isSwap && Array.isArray(tx.tokenTransfers)) {
                      for (const tt of tx.tokenTransfers) {
                        if (!tt || tt.mint !== WSOL_MINT_SUB) continue;
                        const solEquiv = Number(tt.tokenAmount) || 0;
                        const lamports = Math.round(solEquiv * 1e9);
                        if (tt.fromUserAccount === cand.wallet) netSolLamports -= lamports;
                        else if (tt.toUserAccount === cand.wallet) netSolLamports += lamports;
                      }
                    }
                    let solRecorded = false;
                    const tts = Array.isArray(tx.tokenTransfers) ? tx.tokenTransfers : [];
                    for (const tt of tts) {
                      if (!tt || tt.mint !== mint) continue;
                      const amt = Number(tt.tokenAmount) || 0;
                      if (amt <= 0) continue;
                      if (tt.toUserAccount === cand.wallet) {
                        if (isSwap) {
                          sBuy++;
                          sBoughtTokens += amt;
                          if (dayUsd) sBoughtUsd += amt * dayUsd;
                          if (!solRecorded && netSolLamports < 0) {
                            sBoughtSolLamports += Math.abs(netSolLamports);
                            solRecorded = true;
                          }
                        }
                      } else if (tt.fromUserAccount === cand.wallet) {
                        if (isSwap) {
                          sSell++;
                          sSoldTokens += amt;
                          if (dayUsd) sSoldUsd += amt * dayUsd;
                          if (!solRecorded && netSolLamports > 0) {
                            sSoldSolLamports += netSolLamports;
                            solRecorded = true;
                          }
                        } else if (traceLockerSet.has(tt.toUserAccount)) {
                          sLock++;
                          sLockedTokens += amt;
                        } else {
                          sTransOut++;
                        }
                      }
                    }
                  }
                }
              }
              const subBoughtSol = sBoughtSolLamports / 1e9;
              const subSoldSol = sSoldSolLamports / 1e9;
              // Only include this sub-wallet if it shows TEAM-like behavior:
              // either it locked tokens (clear team signal), or it
              // accumulated more than it sold (buy-and-hold for the team).
              // Excludes wallets that received some CLKN from the creator
              // but then traded against the team (unrelated personal trading).
              const subAccumulating = sBuy > sSell && sBoughtTokens > sSoldTokens;
              const isTeamLike = sLock > 0 || (sBuy >= 3 && subAccumulating);
              if (isTeamLike) {
                teamSubTraces.push({
                  wallet: cand.wallet,
                  tokensReceivedFromCreator: cand.tokensReceived,
                  sigsScanned: subSigList.length,
                  buyCount: sBuy, sellCount: sSell, lockCount: sLock, transferOutCount: sTransOut,
                  boughtTokens: sBoughtTokens, soldTokens: sSoldTokens, lockedTokens: sLockedTokens,
                  boughtUsd: sBoughtUsd, soldUsd: sSoldUsd,
                  boughtSol: subBoughtSol, soldSol: subSoldSol,
                });
                console.log(`[AUTOPSY] Phase 2G-bis sub-trace ${cand.wallet.slice(0,8)}…: buys=${sBuy} locks=${sLock} solSpent=${subBoughtSol.toFixed(3)}`);
              }
            } catch (e) {
              console.warn(`[AUTOPSY] Phase 2G-bis sub-distributor walk failed for ${cand.wallet.slice(0,8)}:`, e.message);
            }
          }

          // Aggregate into a teamNetwork total (creator + sub-distributors).
          if (teamSubTraces.length > 0) {
            let netBuy = buyCount, netSell = sellCount, netLock = lockCount;
            let netBoughtSol = boughtSol, netSoldSol = soldSol;
            let netBoughtUsd = boughtUsd, netSoldUsd = soldUsd;
            let netLockedTokens = lockedTokens;
            for (const sub of teamSubTraces) {
              netBuy += sub.buyCount;
              netSell += sub.sellCount;
              netLock += sub.lockCount;
              netBoughtSol += sub.boughtSol;
              netSoldSol += sub.soldSol;
              netBoughtUsd += sub.boughtUsd;
              netSoldUsd += sub.soldUsd;
              netLockedTokens += sub.lockedTokens;
            }
            const netPctReinvested = claimedSol && claimedSol > 0
              ? Math.min(100, (netBoughtSol / claimedSol) * 100)
              : null;
            creatorTrace.teamNetwork = {
              walletCount: 1 + teamSubTraces.length,
              subWallets: teamSubTraces.map(s => ({
                wallet: s.wallet,
                buyCount: s.buyCount,
                lockCount: s.lockCount,
                boughtSol: s.boughtSol,
                lockedTokens: s.lockedTokens,
                tokensReceivedFromCreator: s.tokensReceivedFromCreator,
              })),
              totalBuyCount: netBuy,
              totalSellCount: netSell,
              totalLockCount: netLock,
              totalBoughtSol: netBoughtSol,
              totalLockedTokens: netLockedTokens,
              totalBoughtUsd: netBoughtUsd,
              totalSoldUsd: netSoldUsd,
              netUsd: netBoughtUsd - netSoldUsd,
              pctReinvestedNetwork: netPctReinvested,
            };
            console.log(`[AUTOPSY] Phase 2G-bis team network: wallets=${1 + teamSubTraces.length} totalBuys=${netBuy} totalLocks=${netLock} totalSolSpent=${netBoughtSol.toFixed(3)} pctReinvestedNetwork=${netPctReinvested !== null ? netPctReinvested.toFixed(0) + "%" : "—"}`);
          }
        } catch (e) {
          console.warn("[AUTOPSY] Phase 2G-bis multi-hop trace failed:", e.message);
        }
      } catch (e) {
        console.warn("[AUTOPSY] Phase 2G creator-trace failed:", e.message);
      }
    }

    // This enrichment now runs whether or not the creator sits in top 100 —
    // a creator who's "in the top 100 at rank 12" doing daily buy-backs is a
    // completely different story than one sitting dormant at rank 12. The
    // direct creator trace (Phase 2G) is authoritative when present; otherwise
    // fall back to projectWallets from the mint-side walk.
    if (creatorStatus && (creatorTrace || (walletPnl && walletPnl.projectWallets && walletPnl.projectWallets.length > 0))) {
      const creatorActivity = creatorTrace || (walletPnl && walletPnl.projectWallets.find(p => p.wallet === creatorStatus.wallet));
      if (creatorActivity) {
        const handle = bagsCreatorMeta?.username ? `@${bagsCreatorMeta.username}` : "Verified creator";
        const netUsd = creatorActivity.boughtUsd - creatorActivity.soldUsd;
        // Buy frequency: if firstTs available and they have many buys, compute
        // buys-per-active-day for the "buys every day" claim verification.
        let buyFreqStr = "";
        if (creatorActivity.firstTs && creatorActivity.buyCount > 0) {
          const daysActive = Math.max(1, (Date.now() - creatorActivity.firstTs) / 86400000);
          const buysPerDay = creatorActivity.buyCount / daysActive;
          if (buysPerDay >= 0.7) {
            buyFreqStr = ` (~${buysPerDay.toFixed(1)} buys/day on average over ${Math.round(daysActive)} days)`;
          } else if (buysPerDay >= 0.1) {
            buyFreqStr = ` (~${(buysPerDay * 7).toFixed(1)} buys/week)`;
          }
        }
        creatorStatus.onChainActivity = {
          buyCount: creatorActivity.buyCount,
          sellCount: creatorActivity.sellCount,
          lockCount: creatorActivity.lockCount || 0,
          transferInCount: creatorActivity.transferInCount || 0,
          transferOutCount: creatorActivity.transferOutCount || 0,
          boughtTokens: creatorActivity.boughtTokens,
          soldTokens: creatorActivity.soldTokens,
          // Traced lock deposits from the creator wallet (signature-walk
          // subset). Kept for the "N lock deposits" count.
          lockedTokens: creatorActivity.lockedTokens || 0,
          // Authoritative total currently locked across ALL locker PDAs,
          // from holder classification. This is what "X CLKN permanently
          // locked" should display — 145M for CLKN, not the 60M we traced.
          lockedTokensActual: lockedSupplyTokens > 0
            ? Math.max(lockedSupplyTokens, creatorActivity.lockedTokens || 0)
            : (creatorActivity.lockedTokens || 0),
          transferOutTokens: creatorActivity.transferOutTokens || 0,
          transferOutDistinctRecipients: creatorActivity.transferOutDistinctRecipients || 0,
          boughtUsd: creatorActivity.boughtUsd,
          soldUsd: creatorActivity.soldUsd,
          // SOL flow — what the user actually paid in SOL for buy-backs.
          boughtSol: creatorActivity.boughtSol || 0,
          soldSol: creatorActivity.soldSol || 0,
          netSol: creatorActivity.netSol || 0,
          claimedSol: creatorActivity.claimedSol || null,
          pctReinvested: creatorActivity.pctReinvested != null ? creatorActivity.pctReinvested : null,
          creatorSolBalanceNow: creatorActivity.creatorSolBalanceNow != null ? creatorActivity.creatorSolBalanceNow : null,
          knownSolSentToSubs: creatorActivity.knownSolSentToSubs || 0,
          unaccountedSol: creatorActivity.unaccountedSol != null ? creatorActivity.unaccountedSol : null,
          netUsd,
          lastActivityTs: creatorActivity.lastTs,
          firstActivityTs: creatorActivity.firstTs,
          buyFrequencyStr: buyFreqStr,
          // Multi-hop team network — sub-distributor wallets aggregated.
          teamNetwork: creatorActivity.teamNetwork || null,
          // Solana Tracker independent cross-verification of the above
          // numbers. Null if the key is missing, quota is hit, or the
          // wallet has no indexed PnL position yet.
          solanaTrackerCrossCheck: creatorActivity.solanaTrackerCrossCheck || null,
        };
        const isLocking = (creatorActivity.lockedTokens || 0) > 0 && (creatorActivity.lockCount || 0) >= 1;
        // Behavior correction: the Phase 2A behavior tag compared "first
        // received vs current balance" — which mislabels a buy-and-lock
        // wallet as REDUCED because locked tokens left the wallet the same
        // way a sell would. If we have proof the creator did 0 market sells
        // AND has lock deposits accounting for the gap, override the holder
        // row's behavior to "ACCUMULATED" (they put more in than they took
        // out — the locks are removal-from-circulation, not a sell).
        if (creatorStatus.inTopHolders && creatorActivity.sellCount === 0
          && (creatorActivity.lockedTokens || 0) > 0) {
          const creatorHolder = topHolders.find(h => (h.authority || h.wallet) === creatorStatus.wallet);
          if (creatorHolder && (creatorHolder.behavior === "REDUCED" || creatorHolder.behavior === "EXITED_MOSTLY")) {
            const oldBehavior = creatorHolder.behavior;
            creatorHolder.behavior = "ACCUMULATED";
            creatorHolder.behaviorOverride = {
              from: oldBehavior,
              reason: `Wallet did 0 market sells. Apparent reduction (${(creatorHolder.firstAcquiredAmount - creatorHolder.uiAmount).toLocaleString()} tokens) is explained by ${creatorActivity.lockCount} lock deposit${creatorActivity.lockCount === 1 ? "" : "s"} totaling ${Math.round(creatorActivity.lockedTokens).toLocaleString()} CLKN sent to lock contracts.`,
            };
            // Rebuild breakdown counts so summary stays consistent.
            if (behaviorBreakdown && behaviorBreakdown[oldBehavior] > 0) {
              behaviorBreakdown[oldBehavior]--;
              behaviorBreakdown.ACCUMULATED = (behaviorBreakdown.ACCUMULATED || 0) + 1;
            }
            console.log(`[AUTOPSY] Behavior override for creator ${creatorStatus.wallet.slice(0,8)}…: ${oldBehavior} → ACCUMULATED (locks=${creatorActivity.lockCount}, sells=0)`);
          }
        }
        // Override summary based on actual behavior — this REPLACES the
        // generic "is in the top 100 at rank X" with the story that matters.
        // Buy-and-lock is the strongest project signal: buy supply from market,
        // then permanently remove it via the locker. Highlight that explicitly.
        const sellsAreNegligible = creatorActivity.sellCount === 0
          || (creatorActivity.buyCount > creatorActivity.sellCount * 1.5 && creatorActivity.boughtUsd > creatorActivity.soldUsd);
        // Prefer team-network totals when sub-distributors were detected —
        // that's the honest "every fee went into the token" picture.
        const tn = creatorActivity.teamNetwork;
        const effectiveBuys = tn ? tn.totalBuyCount : creatorActivity.buyCount;
        const effectiveSells = tn ? tn.totalSellCount : creatorActivity.sellCount;
        const effectiveLocks = tn ? tn.totalLockCount : creatorActivity.lockCount;
        const effectiveBoughtSol = tn ? tn.totalBoughtSol : (creatorActivity.boughtSol || 0);
        // "Permanently locked" should reflect what's ACTUALLY locked right
        // now (holder-classification total across all locker PDAs), not just
        // the deposits we traced from the creator wallet. Phase 2G traced 60M
        // of direct deposits for CLKN; holder classification sees the real
        // 145M. Use the larger/authoritative holder total when we have it,
        // falling back to the traced number if classification found nothing.
        const tracedLockedTokens = tn ? tn.totalLockedTokens : creatorActivity.lockedTokens;
        const effectiveLockedTokens = lockedSupplyTokens > 0
          ? Math.max(lockedSupplyTokens, tracedLockedTokens || 0)
          : tracedLockedTokens;
        const effectivePctReinvested = tn ? tn.pctReinvestedNetwork : creatorActivity.pctReinvested;
        const effectiveNetUsd = tn ? tn.netUsd : netUsd;
        const networkSuffix = tn && tn.walletCount > 1
          ? ` across creator + ${tn.walletCount - 1} sub-distributor wallet${tn.walletCount - 1 === 1 ? '' : 's'}`
          : '';
        if ((isLocking || (tn && tn.totalLockCount > 0)) && effectiveBuys >= 3 && sellsAreNegligible) {
          const rankSuffix = creatorStatus.inTopHolders && creatorStatus.rank ? ` (rank ${creatorStatus.rank})` : "";
          const solStr = effectiveBoughtSol > 0
            ? ` ${effectiveBoughtSol.toFixed(2)} SOL spent on buy-backs${networkSuffix}`
            : "";
          const reinvestedStr = effectivePctReinvested != null && creatorActivity.claimedSol
            ? ` (~${effectivePctReinvested.toFixed(0)}% of the ${creatorActivity.claimedSol.toFixed(2)} SOL claimed in lifetime creator fees recycled back into buys)`
            : "";
          // Dual-funding-source insert — when Solana Tracker's independent
          // indexer captures meaningfully more buys than our trace AND the
          // extra capital is real (>$50) AND zero sells, surface BOTH
          // funding paths rather than letting "100% of fees recycled"
          // imply our trace tells the whole story. Two stacking signals:
          // fee recycling (our Phase 2G) + personal capital on top (theirs).
          const stx = creatorActivity.solanaTrackerCrossCheck;
          let dualFundingStr = "";
          if (stx && stx.sells === 0 && stx.buys > effectiveBuys && stx.invested > 50) {
            const extraBuys = stx.buys - effectiveBuys;
            const extraUsd = Math.max(0, (stx.totalBoughtUsd || 0) - (creatorActivity.boughtUsd || 0));
            const roiStr = stx.roi ? `, ${stx.roi.toFixed(0)}% ROI` : "";
            const unrealStr = stx.unrealized > 0 ? `, $${Math.round(stx.unrealized).toLocaleString()} unrealized gain` : "";
            dualFundingStr = ` Solana Tracker (independent indexer) sees ${extraBuys} additional buys funded by personal capital — ~$${Math.round(extraUsd).toLocaleString()} added on top, bringing lifetime totals to ${stx.buys} buys, $${Math.round(stx.invested).toLocaleString()} personal investment${unrealStr}${roiStr}.`;
          }
          creatorStatus.summary = `🔄🔒 ${handle}${rankSuffix} is running a buy-and-lock — ${effectiveBuys} market buys + ${effectiveLocks} lock deposits, ${effectiveSells} actual market sells lifetime${buyFreqStr}.${solStr}${reinvestedStr}.${dualFundingStr} ${Math.round(effectiveLockedTokens).toLocaleString()} CLKN permanently locked.`;
          creatorStatus.behaviorKind = "BUY_AND_LOCK";
        } else if (effectiveBuys >= 3 && effectiveBuys > effectiveSells * 1.5 && (tn ? tn.totalBoughtUsd : creatorActivity.boughtUsd) > (tn ? tn.totalSoldUsd : creatorActivity.soldUsd)) {
          const rankSuffix = creatorStatus.inTopHolders && creatorStatus.rank ? ` and sits at rank ${creatorStatus.rank}` : "";
          creatorStatus.summary = `🔄 ${handle} is actively buying back${rankSuffix} — ${creatorActivity.buyCount} buys vs ${creatorActivity.sellCount} sells lifetime${buyFreqStr}, net +$${netUsd.toFixed(2)} into the token.`;
          creatorStatus.behaviorKind = "BUY_BACK_ACTIVE";
        } else if (creatorActivity.sellCount >= 3 && creatorActivity.sellCount > creatorActivity.buyCount * 2 && creatorActivity.soldUsd > creatorActivity.boughtUsd * 1.5) {
          creatorStatus.summary = `${handle} has been net-selling — ${creatorActivity.sellCount} sells vs ${creatorActivity.buyCount} buys, net −$${Math.abs(netUsd).toFixed(2)} out. This is distribution, not buy-back behavior.`;
          creatorStatus.behaviorKind = "NET_SELLING";
          redFlags.push(`${handle} has been net-selling: ${creatorActivity.sellCount} sells vs ${creatorActivity.buyCount} buys lifetime. The fee-receiving wallet is taking tokens OUT, not putting them back.`);
        } else if (creatorActivity.buyCount > 0 || creatorActivity.sellCount > 0) {
          const rankSuffix = creatorStatus.inTopHolders && creatorStatus.rank ? ` (rank ${creatorStatus.rank})` : "";
          creatorStatus.summary = `${handle}${rankSuffix} has on-chain activity: ${creatorActivity.buyCount} buys, ${creatorActivity.sellCount} sells, net ${netUsd >= 0 ? "+" : "−"}$${Math.abs(netUsd).toFixed(2)}.`;
          creatorStatus.behaviorKind = "MIXED";
        }

        // --- Extraction overlay (hidden-dump detection) ---------------------
        // A "buy-back" / "buy-and-lock" can still be a NET EXTRACTION when the
        // creator claimed far more in fees than they recycled, or funneled a
        // large multiple of their on-market buys out to other wallets. The
        // creator's own wallet showing 0 market sells is exactly what makes a
        // dev dump hard to see — the value leaves via FEE CLAIMS and TOKEN
        // TRANSFERS, not swaps. These two factual signals catch that without
        // asserting intent (we state the chain; we don't claim the recipients
        // dumped unless a downstream trace proves it). GSD case: claimed
        // 1,135 SOL, reinvested 11%, funneled 42.7M tokens out, token -99%.
        const _claimed = creatorActivity.claimedSol || 0;
        const _reinv = effectivePctReinvested;
        const _boughtSol = creatorActivity.boughtSol || 0;
        const _outTok = creatorActivity.transferOutTokens || 0;
        const _boughtTok = creatorActivity.boughtTokens || 0;
        const _outShare = supplyTokens > 0 ? _outTok / supplyTokens : 0;
        // Fee extraction dominates when meaningful fees were claimed but only a
        // small fraction was recycled into buys.
        if (_claimed >= 10 && _reinv != null && _reinv < 50) {
          const _net = Math.max(0, _claimed - _boughtSol);
          creatorStatus.onChainActivity.feeExtractionDominant = true;
          creatorStatus.onChainActivity.netFeeExtractionSol = Number(_net.toFixed(2));
          redFlags.push(`${handle} claimed ~${_claimed.toFixed(0)} SOL in creator fees but recycled only ${_reinv.toFixed(0)}% (~${_boughtSol.toFixed(0)} SOL) back into buys — roughly ${_net.toFixed(0)} SOL kept. The buy-back is real but a minority of the money flow; fee extraction dominates.`);
        }
        // Funnel-heavy when the creator moved far more tokens OUT to other
        // wallets than they bought on-market, and it's a real share of supply.
        if (_outTok > 0 && _boughtTok > 0 && _outTok > _boughtTok * 3 && _outShare > 0.03) {
          creatorStatus.onChainActivity.funnelHeavy = true;
          creatorStatus.onChainActivity.transferOutShareOfSupply = Number((_outShare * 100).toFixed(1));
          const _recip = creatorActivity.transferOutDistinctRecipients || 0;
          const _recipStr = _recip > 0 ? ` across ${_recip} distinct wallet${_recip === 1 ? "" : "s"}` : "";
          redFlags.push(`${handle} transferred ${Math.round(_outTok).toLocaleString()} tokens (~${(_outShare * 100).toFixed(0)}% of supply) out${_recipStr} — far more than the ${Math.round(_boughtTok).toLocaleString()} bought on-market. The creator wallet shows 0 market sells, but a funnel this large is a potential hidden-exit vector: the selling may have happened from the recipient wallets.`);
        }
      }
    }

    // --- Hidden Exit Distributors: transfer-then-dump pattern ---
    // The forensic signal users care about most: a wallet that distributes
    // tokens to multiple other wallets which THEN dump them. Classic exit
    // obfuscation — the source wallet looks innocent ("just transferred to
    // friends") while the actual selling happens from the recipient wallets,
    // so they evade simple top-seller scans. Detect by walking each
    // distributor's recipient list and measuring how many recipients have
    // dumped most of what they received.
    // --- Phase 2I: Lock Attribution ---
    // For each detected lock holder account (locker / selflock category),
    // trace its single funding transaction to find WHO locked (the fee-payer
    // signer) and via WHAT platform (the program in the create instruction).
    // Every lock account has exactly one tx — created+funded, then immovable —
    // so this is cheap: one getSignaturesForAddress + one getTransaction each.
    //
    // Why account-state classification isn't enough: a Streamflow / Jupiter
    // lock leaves tokens in a self-owned escrow that, by current on-chain
    // state, is indistinguishable from a generic self-lock. The platform and
    // the locker's identity live ONLY in the funding tx. So we read it there.
    //
    // Per the forensic-evidence-rule, we label a locker "team" ONLY when its
    // wallet matches the verified creator. Otherwise it's shown neutrally —
    // it could be the team, or a conviction community holder, and we can't
    // prove which from the chain alone. Unknown locker programs are surfaced
    // by their program ID so the tool learns new lockers organically.
    const LOCK_PLATFORM_BY_PROGRAM = {
      "strmRqUCoQUgGUan5YhzUZa6KqdzwX5L6FpUxfmKg5m": "Streamflow",
      "LocpQgucEQHbqNABEYvBvwoxCPsSbG91A1QaQhQQqjn": "Jupiter Lock",
    };
    const LOCK_INFRA_PROGRAMS = new Set([
      "11111111111111111111111111111111",
      "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
      "ComputeBudget111111111111111111111111111111",
      "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
    ]);
    let lockAttribution = null;
    try {
      const lockHolders = topHolders.filter(h =>
        (h.category === "locker" || h.category === "selflock") && h.tokenAccount);
      if (lockHolders.length > 0) {
        // Verified team wallets — only the proven creator. We do NOT guess.
        const teamWallets = new Set();
        if (creatorStatus && creatorStatus.wallet && creatorStatus.verified !== false
          && creatorStatus.source !== "genesis-tx-fee-payer") {
          teamWallets.add(creatorStatus.wallet);
        }
        const lockers = [];
        const platformTotals = {};
        for (const lh of lockHolders.slice(0, 15)) {
          try {
            const sigRes = await rpcCall(`autopsy-lock-sigs-${lh.rank}`, "getSignaturesForAddress", [lh.tokenAccount, { limit: 1000 }]);
            const sigs = sigRes?.result || [];
            if (!sigs.length) continue;
            const fundingSig = sigs[sigs.length - 1].signature; // oldest = creation/funding
            const txRes = await rpcCall(`autopsy-lock-tx-${lh.rank}`, "getTransaction", [fundingSig, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }]);
            const txr = txRes?.result;
            if (!txr) continue;
            const msg = (txr.transaction || {}).message || {};
            const keys = msg.accountKeys || [];
            const lockerWallet = (keys.find(k => k && k.signer) || {}).pubkey || null;
            // Collect every program touched (top-level + inner instructions).
            const progIds = new Set();
            (msg.instructions || []).forEach(ix => { if (ix && ix.programId) progIds.add(ix.programId); });
            ((txr.meta || {}).innerInstructions || []).forEach(inner =>
              (inner.instructions || []).forEach(ix => { if (ix && ix.programId) progIds.add(ix.programId); }));
            let platform = null, platformProgram = null;
            for (const pid of progIds) {
              if (LOCK_PLATFORM_BY_PROGRAM[pid]) { platform = LOCK_PLATFORM_BY_PROGRAM[pid]; platformProgram = pid; break; }
            }
            if (!platform) {
              // No recognized locker — surface the non-infrastructure program
              // so we can identify and name it later. If there's only infra,
              // it's a plain self-owned lock (authority set to self / burned).
              platformProgram = [...progIds].find(p => !LOCK_INFRA_PROGRAMS.has(p)) || null;
              platform = platformProgram ? "Unrecognized locker" : "Self-owned lock";
            }
            const isTeam = !!(lockerWallet && teamWallets.has(lockerWallet));
            lockers.push({
              lockAccount: lh.tokenAccount,
              lockerWallet,
              amount: lh.uiAmount,
              share: lh.share,
              platform,
              platformProgram,
              isTeam,
              fundingSig,
            });
            platformTotals[platform] = (platformTotals[platform] || 0) + (lh.share || 0);
          } catch (e) {
            console.warn(`[AUTOPSY] Phase 2I lock trace failed for ${lh.tokenAccount.slice(0,8)}:`, e.message);
          }
        }
        if (lockers.length > 0) {
          const totalShare = lockers.reduce((s, l) => s + (l.share || 0), 0);
          const teamShare = lockers.filter(l => l.isTeam).reduce((s, l) => s + (l.share || 0), 0);
          lockAttribution = {
            lockers: lockers.sort((a, b) => (b.share || 0) - (a.share || 0)),
            totalLockedShare: totalShare,
            teamLockedShare: teamShare,
            // "Unlabeled" = locked by wallets we can't verify as team. Could be
            // team or conviction community holders — we don't assert which.
            unlabeledLockedShare: totalShare - teamShare,
            platformTotals,
          };
          console.log(`[AUTOPSY] Phase 2I lock attribution: ${lockers.length} locks, ${(totalShare * 100).toFixed(1)}% total (${(teamShare * 100).toFixed(1)}% verified-team, rest unlabeled), platforms: ${Object.keys(platformTotals).join(", ")}`);
        }
      }
    } catch (e) {
      console.warn("[AUTOPSY] Phase 2I lock attribution failed:", e.message);
    }

    let hiddenExitDistributors = [];
    try {
      if (distributors && distributors.length > 0 && topHolders && topHolders.length > 0) {
        // Build a set of "legitimate" source wallets to exclude — verified
        // Bags / Pump creator wallets and recognized lockers. Their transfers
        // are normal team distribution, not hidden exits.
        const legitSourceSet = new Set();
        if (projectFeeWalletMap && projectFeeWalletMap.size > 0) {
          for (const w of projectFeeWalletMap.keys()) legitSourceSet.add(w);
        }
        for (const h of topHolders) {
          const addr = h.authority || h.wallet;
          if ((h.category === "locker" || h.category === "selflock" || h.category === "lp") && addr) {
            legitSourceSet.add(addr);
          }
        }

        for (const d of distributors) {
          if (legitSourceSet.has(d.sourceWallet)) continue;
          const recipientStats = (d.recipients || []).map(r => {
            const h = topHolders.find(th => (th.authority || th.wallet) === r.authority);
            if (!h || !h.firstAcquiredAmount || h.firstAcquiredAmount <= 0) return null;
            const cur = Number(h.uiAmount) || 0;
            const first = Number(h.firstAcquiredAmount) || 0;
            const dumpRatio = first > 0 ? Math.max(0, (first - cur) / first) : 0;
            return {
              rank: r.rank,
              authority: r.authority,
              receivedAmount: first,
              currentBalance: cur,
              dumpRatio,
              dumpedMost: dumpRatio > 0.7,
              dumpedHalf: dumpRatio > 0.5,
              status: dumpRatio > 0.95 ? "EXITED"
                : dumpRatio > 0.7 ? "DUMPED_MOST"
                : dumpRatio > 0.3 ? "TRIMMED"
                : dumpRatio < -0.2 ? "ACCUMULATED"
                : "HELD",
            };
          }).filter(Boolean);
          if (recipientStats.length < 2) continue;
          const dumpedMostCount = recipientStats.filter(r => r.dumpedMost).length;
          const dumpedHalfCount = recipientStats.filter(r => r.dumpedHalf).length;
          const exitedCount = recipientStats.filter(r => r.status === "EXITED").length;
          const dumpedMostPct = dumpedMostCount / recipientStats.length;
          // Threshold: 50%+ of recipients dumped > 70% of what they received.
          // For 2-recipient distributors require both; for 3+ require majority.
          const isCoordinatedExit = recipientStats.length >= 2 && dumpedMostPct >= 0.5;
          if (isCoordinatedExit) {
            hiddenExitDistributors.push({
              sourceWallet: d.sourceWallet,
              totalRecipients: recipientStats.length,
              dumpedMostCount,
              dumpedHalfCount,
              exitedCount,
              dumpedMostPct,
              // Was the source wallet ITSELF a seller? Cross-reference walletPnl
              // to flag the strongest "transfer-out + sell-the-rest" combo.
              sourceAlsoSold: (() => {
                if (!walletPnl) return null;
                const sp = (walletPnl.topSellers || []).find(s => s.wallet === d.sourceWallet);
                if (sp) return { soldUsd: sp.soldUsd, sellCount: sp.sellCount };
                return null;
              })(),
              recipientStats,
            });
          }
        }

        // Red flags for any coordinated-exit patterns we found.
        for (const ex of hiddenExitDistributors) {
          const srcShort = ex.sourceWallet.slice(0, 8) + "…";
          const alsoSold = ex.sourceAlsoSold
            ? ` AND the source wallet itself sold $${ex.sourceAlsoSold.soldUsd.toFixed(0)} across ${ex.sourceAlsoSold.sellCount} swaps`
            : "";
          redFlags.push(`🚨 HIDDEN-EXIT PATTERN: Wallet ${srcShort} transferred to ${ex.totalRecipients} top holders and ${ex.dumpedMostCount} of them have dumped > 70% of what they received${alsoSold}. Coordinated transfer-then-dump signature — the source wallet looks clean on a simple sell scan, but the recipients are the ones doing the selling.`);
        }
      }
    } catch (e) {
      console.warn("[AUTOPSY] Hidden-exit distributor detection failed:", e.message);
    }

    // --- Soften bulk-distribution red flag for bonding-curve tokens ---
    // For Bags/Pump tokens it's common for one bonding-curve buyer to be the
    // team's distribution wallet — they bought in size during the BC then
    // distributed to a holder list. That's a legitimate launch pattern, not
    // an insider rug. We don't suppress the signal entirely (it's still
    // useful information), but we add context so it's not read as fraud.
    if (bondingCurveActive() && distributors && distributors.length > 0) {
      // Find any bulk-distribution flag we added earlier and reframe it.
      for (let i = 0; i < redFlags.length; i++) {
        if (redFlags[i].includes("distributed tokens to") && redFlags[i].includes("top 20 holders")) {
          redFlags[i] += " (Context: this token launched via a bonding-curve platform — a single wallet distributing to many top holders is consistent with the team buying through the BC and then distributing to a known holder list, which is a legitimate launch pattern. Verify the distributor wallet's history before treating this as insider activity.)";
        }
      }
    }

    // --- TRANSFER source enrichment ---
    // A holder labeled "WALLET TRANSFER from <opaque hash>" looks suspicious
    // even when the source is a known team-distribution wallet (a wallet that
    // bought big on the bonding curve then airdropped to a holder list — a
    // legitimate pattern for Bags/Pump launches with a previous-project list).
    // Enrich each TRANSFER holder with what the source wallet actually IS, so
    // the UI can show "from team distribution wallet" instead of a raw hash.
    // FORENSIC PRINCIPLE: we only label a wallet "team" / "creator" when we
    // have VERIFIED evidence — i.e., it's registered with Bags or Pump as an
    // official creator. Everything else gets a factual, neutral label that
    // describes what the wallet DID without assuming intent. A wallet that
    // received from a verified creator could be a legitimate sub-distributor
    // OR a coordinated dump-prep wallet — on-chain data alone can't tell
    // them apart, so we don't pretend it can.
    try {
      const distSourceSet = new Set((distributors || []).map(d => d.sourceWallet));
      const bagsCreatorWallets = new Set(
        (bagsInfo?.officialCreators || []).map(c => c.wallet).filter(Boolean)
      );

      for (const h of topHolders) {
        if (h.acquisitionType === "TRANSFER" && h.acquisitionSource) {
          const src = h.acquisitionSource;
          if (bagsCreatorWallets.has(src)) {
            // PROVEN — Bags creator/v3 explicitly lists this wallet.
            h.acquisitionSourceKind = "bags-creator";
            h.acquisitionSourceContext = "Bags-verified creator wallet";
          } else if (distSourceSet.has(src)) {
            // Distributor — neutral fact only. Does NOT claim team status.
            // Could be team operations, could be coordinated insider
            // distribution, could be a public airdrop. The data shows what
            // happened, not WHY.
            const dist = (distributors || []).find(d => d.sourceWallet === src);
            const cnt = dist ? (dist.walletRecipientsInTop20 || dist.recipientsInTop20 || 0) : 0;
            h.acquisitionSourceKind = "distributor";
            h.acquisitionSourceContext = cnt >= 2
              ? `Distributor wallet (sent to ${cnt} top-20 holders — origin not verified)`
              : null;
          } else if (dbcBuyerSet && dbcBuyerSet.has(src)) {
            // PROVEN — we walked the DBC pool and saw this wallet buy.
            h.acquisitionSourceKind = "bc-buyer";
            h.acquisitionSourceContext = bagsInfo ? "Bags bonding-curve buyer (verified)" : "Pump bonding-curve buyer (verified)";
          }
        }
      }
    } catch (e) {
      console.warn("[AUTOPSY] TRANSFER source enrichment failed:", e.message);
    }

    // --- Solscan enrichment pass ---
    // Independent wallet labels (CEX hot wallets, market makers, known team
    // wallets, etc.) for any counterparty we don't already recognize. Pulls
    // labels from Solscan in batch with a small concurrency cap to be polite
    // to the free-tier quota. Degrades to no-op if the API key is missing.
    let solscanHolderCount = null;
    if (solscan.isConfigured()) {
      try {
        // Independent holder count — third source alongside Helius (our walk)
        // and Jupiter (their indexer). When all three agree, high confidence.
        solscanHolderCount = await solscan.getTokenHolderCount(mint);
        // Collect addresses that need a label: top-100 holders that aren't
        // already classified as LP/locker/program, plus distinct distributor
        // sources, plus distinct TRANSFER acquisition-sources. Cap total
        // batch at 60 addresses per autopsy to stay quota-friendly.
        const needLabels = new Set();
        for (const h of topHolders) {
          if (h.category !== "wallet") continue;
          const addr = h.authority || h.wallet;
          if (addr) needLabels.add(addr);
          if (h.acquisitionSource) needLabels.add(h.acquisitionSource);
        }
        for (const d of (distributors || [])) {
          if (d.sourceWallet) needLabels.add(d.sourceWallet);
        }
        const addrs = [...needLabels].slice(0, 60);
        const labelMap = await solscan.batchAccountLabels(addrs);
        // Apply labels to topHolders + distributors
        for (const h of topHolders) {
          const addr = h.authority || h.wallet;
          if (addr && labelMap.get(addr)) h.solscanLabel = labelMap.get(addr);
          if (h.acquisitionSource && labelMap.get(h.acquisitionSource)) {
            h.acquisitionSourceSolscanLabel = labelMap.get(h.acquisitionSource);
          }
        }
        for (const d of (distributors || [])) {
          if (d.sourceWallet && labelMap.get(d.sourceWallet)) {
            d.solscanLabel = labelMap.get(d.sourceWallet);
          }
        }
        const labelHitCount = [...labelMap.values()].filter(Boolean).length;
        console.log(`[AUTOPSY] Solscan: labels requested for ${addrs.length} wallets, ${labelHitCount} returned non-null. holderCount=${solscanHolderCount}`);
      } catch (e) {
        console.warn("[AUTOPSY] Solscan enrichment failed:", e.message);
      }
    }

    // --- Extraction verdict correction (hidden dev-dump guard) -------------
    // The base verdict ladder runs before the creator trace, so a token that
    // is technically still trading (real liquidity + volume) lands on ALIVE /
    // "AUTOPSY CANCELED" even when the creator quietly extracted heavily via
    // FEES and TOKEN TRANSFERS rather than market sells. That cheerful frame
    // is the exact false-reassurance failure mode this tool exists to avoid.
    // Once the creator analysis has run, downgrade an ALIVE verdict to AT_RISK
    // when the extraction overlay fired AND the price has genuinely collapsed
    // (so we don't ding a healthy token whose creator merely claimed fees).
    {
      const oa = creatorStatus && creatorStatus.onChainActivity;
      const extractionFlag = oa && (oa.feeExtractionDominant || oa.funnelHeavy);
      const drawdown = priceHistory && priceHistory.drawdownFromPeakPct != null ? priceHistory.drawdownFromPeakPct : null;
      const collapsed = (drawdown != null && drawdown <= -80) || (priceChangeH24 != null && priceChangeH24 <= -50);
      if (verdict.severity === "ALIVE" && extractionFlag && collapsed) {
        verdict = { type: "CREATOR_EXTRACTED", label: "Status: TRADING — BUT CREATOR EXTRACTED", severity: "AT_RISK", color: "#F59E0B", icon: "🩸" };
        reportMode = "health-assessment";
        reportHeadline = "🩸 AUTOPSY ON STANDBY";
        reportSubhead = oa.funnelHeavy && oa.feeExtractionDominant
          ? "Still trading, but the creator extracted value via fees and funneled a large share of supply out to other wallets while the price collapsed. Their own wallet shows no market sells — the dump hid in fee claims and transfers."
          : oa.feeExtractionDominant
          ? "Still trading, but the creator claimed far more in fees than they recycled while the price collapsed. The buy-back is real but a minority of the money flow."
          : "Still trading, but the creator funneled a large share of supply out to other wallets while the price collapsed — a potential hidden-exit vector.";
      }
    }

    // --- AI Narration (Claude Haiku, Cluck's voice, deterministic facts only) ---
    const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
    let narrative = null;
    if (ANTHROPIC_KEY) {
      const facts = {
        symbol, name,
        verdict: verdict.type,
        ageDays: ageDays !== null ? Math.round(ageDays) : null,
        totalLiquidityUsd: Number(totalLiqUsd.toFixed(2)),
        volume24hUsd: Number(totalVol24h.toFixed(2)),
        priceChange1h:  priceChangeH1  !== null ? `${priceChangeH1  >= 0 ? "+" : ""}${priceChangeH1.toFixed(1)}%`  : null,
        priceChange6h:  priceChangeH6  !== null ? `${priceChangeH6  >= 0 ? "+" : ""}${priceChangeH6.toFixed(1)}%`  : null,
        priceChange24h: priceChangeH24 !== null ? `${priceChangeH24 >= 0 ? "+" : ""}${priceChangeH24.toFixed(1)}%` : null,
        buys24h, sells24h,
        mintAuthorityActive: !!mintAuthority,
        freezeAuthorityActive: !!freezeAuthority,
        // Token-2022 extension risks (modern honeypot vectors). Only present
        // for Token-2022 mints; null/empty for standard SPL tokens. When a
        // honeypot-grade extension is present this is the headline finding.
        token2022: isToken2022 ? {
          isToken2022: true,
          transferFeePct: transferFeeBps != null ? `${(transferFeeBps / 100).toFixed(2)}%` : null,
          risks: token2022Risks.map(r => ({ kind: r.kind, severity: r.severity, label: r.label })),
          hasHoneypotExtension,
          note: hasHoneypotExtension
            ? "HONEYPOT-GRADE Token-2022 extension present (non-transferable, default-frozen, active transfer hook, or ~100% transfer fee). This is the headline — buyers cannot reliably sell. Lead with it and name the exact mechanism from risks[]."
            : token2022Risks.length > 0
            ? "Token-2022 extensions present that affect trading (transfer fee and/or permanent delegate). Name them plainly as costs/risks; a permanent delegate means holdings are seizable, a transfer fee taxes every trade."
            : "Token-2022 mint with no dangerous extensions detected — note the program but no extension-based red flag.",
        } : null,
        top10Concentration: top10Share !== null ? `${(top10Share * 100).toFixed(0)}%` : null,
        priceUsd, fdv, marketCap,
        poolCount: solPairs.length,
        topHolderForensics: {
          lockedSupplyShare: `${(lockedSupplyShare * 100).toFixed(1)}%`,
          humanSupplyShare: `${(humanSupplyShare * 100).toFixed(1)}%`,
          snipersInTop20: holderBreakdown.sniper,
          earlyBuyersInTop20: holderBreakdown.very_early + holderBreakdown.early,
          bondingCurveBuyersInTop20: holderBreakdown.bonding_curve,
          prePoolHoldersInTop20: holderBreakdown.pre_pool,
          lockedPositionsInTop20: holderBreakdown.locker + holderBreakdown.selflock,
          lpPositionsInTop20: holderBreakdown.lp,
          holding: behaviorBreakdown.HELD,
          accumulated: behaviorBreakdown.ACCUMULATED,
          reduced: behaviorBreakdown.REDUCED,
          exitedMostly: behaviorBreakdown.EXITED_MOSTLY,
        },
        // Lock attribution — who locked supply, via what platform. Feed this
        // so the narrator credits locked supply as conviction and NEVER reads
        // "creator not a top holder" as "abandoned" when supply is locked.
        // teamLocked = verified-creator locks; unlabeledLocked = locks by
        // wallets we can't prove are team (could be team OR community holders
        // — do NOT assert which).
        lockAttribution: lockAttribution ? {
          totalLockedPctOfSupply: `${(lockAttribution.totalLockedShare * 100).toFixed(1)}%`,
          teamVerifiedLockedPct: `${(lockAttribution.teamLockedShare * 100).toFixed(1)}%`,
          unlabeledLockedPct: `${(lockAttribution.unlabeledLockedShare * 100).toFixed(1)}%`,
          lockerWalletCount: lockAttribution.lockers.length,
          platforms: Object.keys(lockAttribution.platformTotals),
          note: "Unlabeled locks are by wallets not verified as team — they may be team OR conviction community holders. Do not claim which. Locked supply is removed from circulation; treat it as a commitment signal, not 'abandoned'.",
        } : null,
        // Creator wallet profile — established operator wallet vs fresh
        // throwaway deployer, plus funding source for fresh wallets.
        creatorWalletProfile: creatorWalletProfile ? {
          established: creatorWalletProfile.isEstablished,
          txCountAtLeast: creatorWalletProfile.txCountAtLeast,
          deployedTokenCount: creatorWalletProfile.deployedTokenCount,
          deployedTokenCountExact: creatorWalletProfile.deployedTokenCountExact,
          isSerialDeployer: creatorWalletProfile.isSerialDeployer,
          fundedBy: creatorWalletProfile.fundingSource
            ? (creatorWalletProfile.fundingSource.label || creatorWalletProfile.fundingSource.wallet)
            : null,
          note: creatorWalletProfile.isSerialDeployer
            ? "SERIAL DEPLOYER — this wallet has launched many tokens. A long tx history here is a token-mill signal, NOT a committed operator. Do NOT describe it as 'established/verified operator' in a reassuring way; name the serial-launch pattern."
            : creatorWalletProfile.deployedTokenCount != null && creatorWalletProfile.deployedTokenCount > 1
            ? `Creator wallet has deployed ${creatorWalletProfile.deployedTokenCount} tokens — has launched others before. Mention neutrally; established history is a fact, not a safety guarantee.`
            : creatorWalletProfile.isEstablished
            ? "Active wallet with a long tx history. State neutrally — a long history is a fact, NOT proof of legitimacy (serial ruggers also have long histories). Don't call it 'verified operator' as if it's reassuring."
            : "Fresh/low-activity wallet. If fundedBy is set, that's who sent it its first SOL — a fresh deployer funded from a single source right before launch is an obfuscation pattern worth naming neutrally.",
        } : null,
        // Pump.fun creator-fee signal (when present). unclaimedSol is what's
        // sitting in the creator's fee vault right now; feeEventCount is how
        // many on-chain fee events the vault has seen (activity proxy).
        pumpCreatorFees: pumpCreatorFees ? {
          unclaimedSol: pumpCreatorFees.unclaimedSol,
          lifetimeClaimedSol: pumpCreatorFees.lifetimeClaimedSol,
          lifetimeTotalSol: pumpCreatorFees.lifetimeTotalSol,
          feeEventCount: pumpCreatorFees.feeEventCount,
          feeEventsCapped: pumpCreatorFees.feeEventsCapped,
          note: "Pump.fun creator fees accrue in an on-chain vault. lifetimeClaimedSol is how much the creator has pulled OUT of this token's fee vault over its life; unclaimedSol is what's still sitting there. lifetimeTotalSol = claimed + unclaimed = total creator-fee revenue realized from this token. If feeEventsCapped is true, claimed is a lower bound (vault history exceeded 1000 events).",
        } : null,
        lifetimeAnalysis: lifetime ? {
          mintedDaysAgo: lifetime.genesisTimestamp ? Math.round((Date.now() - lifetime.genesisTimestamp) / 86400000) : null,
          totalKnownSignatures: lifetime.totalKnownSignatures,
          signatureHistoryTruncated: lifetime.signatureHistoryTruncated,
          bondingCurveDetected: lifetime.bondingCurveDetected,
          bondingCurveSource: lifetime.bondingCurveSource,
          postLaunchMintEvents: lifetime.keyEvents.filter(e => e.type === "MINT_EVENT").length,
          burnEventsObserved: lifetime.keyEvents.filter(e => e.type === "BURN_EVENT").length,
          totalBurnedObserved: lifetime.totalBurnedObserved,
          burnedAsShareOfSupply: supplyTokens > 0 && lifetime.totalBurnedObserved > 0 ? `${(lifetime.totalBurnedObserved / supplyTokens * 100).toFixed(2)}%` : null,
          largeTransfersObserved: lifetime.keyEvents.filter(e => e.type === "LARGE_TRANSFER").length,
          airdropEventsObserved: lifetime.airdropEvents.length,
          dustDropEventsObserved: lifetime.airdropEvents.filter(a => a.kind === "dust").length,
          totalAirdropRecipients: lifetime.airdropEvents.reduce((s, a) => s + a.recipients, 0),
          keyEventCount: lifetime.keyEvents.length,
        } : null,
        creatorStatus: creatorStatus ? {
          inTopHolders: creatorStatus.inTopHolders,
          rank: creatorStatus.rank || null,
          behavior: creatorStatus.behavior || null,
          behaviorKind: creatorStatus.behaviorKind || null,
          summary: creatorStatus.summary,
          onChainActivity: creatorStatus.onChainActivity || null,
        } : null,
        // Explicit count clarity — these are over the TOP 100 holders, NOT
        // top 20. Stops the AI from writing "of the top 20, 22 are pre-pool"
        // which is mathematically impossible.
        topHoldersScannedCount: topHolders.length,
        acquisitionBreakdown: (() => {
          const counts = { BOUGHT: 0, TRANSFER: 0, MINTED: 0, OTHER: 0, UNKNOWN: 0 };
          topHolders.filter(h => h.category === "wallet").forEach(h => {
            counts[h.acquisitionType || "UNKNOWN"] = (counts[h.acquisitionType || "UNKNOWN"] || 0) + 1;
          });
          return counts;
        })(),
        distributorCount: distributors.length,
        topDistributorRecipients: distributors[0]?.recipientsInTop20 || 0,
        // Critical: is the top distributor the VERIFIED creator wallet? If
        // yes, this is team distribution (migration / airdrop to past
        // supporters / community allocation), NOT insider rugging.
        topDistributorIsVerifiedCreator: !!(distributors[0] && distributors[0].isVerifiedTeamWallet),
        bagsLaunch: bagsInfo ? {
          isBagsToken: true,
          status: bagsInfo.status,
          symbol: bagsInfo.symbol,
          // Bags graduation status from Solana Tracker (market "meteora-curve"
          // = still on the Bags DBC curve; graduated = migrated to Meteora
          // DAMM). onBondingCurve true means NO DEX pool yet — that's normal,
          // not a rug; the real liquidity is the curve reserve (stLiquidityUsd).
          graduated: bagsInfo.graduated != null ? bagsInfo.graduated : null,
          onBondingCurve: bagsInfo.onBondingCurve === true,
          curvePercentage: bagsInfo.curvePercentage != null ? bagsInfo.curvePercentage : null,
          stLiquidityUsd: bagsInfo.stLiquidityUsd != null ? bagsInfo.stLiquidityUsd : null,
          market: bagsInfo.market || null,
          officialCreators: bagsInfo.officialCreators.map(c => `${c.provider}:${c.username}`),
          dbcSignaturesScanned: bagsInfo.dbcSignaturesScanned,
          dbcBuyersIdentified: bagsInfo.dbcBuyersIdentified,
          dbcBuyersInTop100: topHolders.filter(h => h.dbcVerified).length,
          lifetimeFeesSol: bagsInfo.lifetimeFeesSol,
          totalClaimedSol: bagsInfo.totalClaimedSol,
          claimEventCount: bagsInfo.claimEventCount,
          daysSinceLastClaim: bagsInfo.lastClaimTimestamp ? Math.round((Date.now() - bagsInfo.lastClaimTimestamp) / 86400000) : null,
          feeWalletsInTop100: topHolders.filter(h => h.projectFeeWallet && h.projectFeeWallet.source === "bags").length,
        } : null,
        creatorVerification: {
          source: effectiveCreatorSource,
          isPlatformUnverified: effectiveCreatorSource === "unverified-platform-launch",
        },
        pumpLaunch: pumpInfo ? {
          isPumpToken: true,
          // Graduation is authoritative from Solana Tracker's pool market:
          // "pumpfun" = STILL on the bonding curve; PumpSwap/Raydium/Meteora
          // = graduated. null = unknown (don't assert either way).
          graduated: pumpInfo.complete,
          onBondingCurve: pumpInfo.onBondingCurve === true,
          curvePercentage: pumpInfo.curvePercentage != null ? pumpInfo.curvePercentage : null,
          market: pumpInfo.market || null,
          // Real liquidity from ST (the bonding-curve reserve pre-graduation,
          // or the DEX pool post-graduation) — present even when DexScreener
          // shows $0 because it dropped/never-indexed the pair.
          stLiquidityUsd: pumpInfo.stLiquidityUsd != null ? pumpInfo.stLiquidityUsd : null,
          symbol: pumpInfo.symbol,
          creator: pumpInfo.creator,
          hasSocials: !!(pumpInfo.twitter || pumpInfo.telegram || pumpInfo.website),
          bcSignaturesScanned: pumpInfo.bcSignaturesScanned || 0,
          bcBuyersIdentified: pumpInfo.bcBuyersIdentified || 0,
          bcBuyersInTop100: topHolders.filter(h => h.dbcVerified).length,
          pumpEraPeakPriceUsd: pumpInfo.priceHistory?.peakPrice || null,
        } : null,
        hiddenExitPatterns: hiddenExitDistributors && hiddenExitDistributors.length > 0 ? {
          count: hiddenExitDistributors.length,
          topPattern: hiddenExitDistributors[0] ? {
            sourceShort: hiddenExitDistributors[0].sourceWallet.slice(0, 8) + "…",
            totalRecipients: hiddenExitDistributors[0].totalRecipients,
            dumpedMostCount: hiddenExitDistributors[0].dumpedMostCount,
            exitedCount: hiddenExitDistributors[0].exitedCount,
            sourceAlsoSold: !!hiddenExitDistributors[0].sourceAlsoSold,
          } : null,
        } : null,
        pnlLedger: walletPnl ? {
          walletsAnalyzed: walletPnl.walletsAnalyzed,
          signaturesScanned: walletPnl.signaturesScanned,
          coverageMode: walletPnl.coverageMode,
          topSellerSoldUsd: walletPnl.topSellers[0]?.soldUsd || 0,
          topSellerSoldTokens: walletPnl.topSellers[0]?.soldTokens || 0,
          topBuyerBoughtUsd: walletPnl.topBuyers[0]?.boughtUsd || 0,
          biggestWinnerRealizedUsd: walletPnl.madeMoney[0]?.realizedPnlUsd || 0,
          biggestLoserRealizedUsd: walletPnl.gotWrecked[0]?.realizedPnlUsd || 0,
          tookTheMoneyCount: walletPnl.tookTheMoney.length,
          tookTheMoneyTopProfitUsd: walletPnl.tookTheMoney[0]?.realizedPnlUsd || 0,
        } : null,
        priceHistory: priceHistory ? {
          peakPriceUsd: priceHistory.peakPrice,
          peakMarketCapUsd: priceHistory.peakMarketCap,
          peakDaysAgo: priceHistory.peakTimestamp ? Math.round((Date.now() - priceHistory.peakTimestamp) / 86400000) : null,
          currentPriceUsd: priceHistory.currentPrice,
          drawdownFromPeakPct: priceHistory.drawdownFromPeakPct !== null ? `${priceHistory.drawdownFromPeakPct.toFixed(1)}%` : null,
          historyDays: priceHistory.candleCount,
          // Multi-window volume context — surfaces 7d / 30d sums so a
          // single quiet day doesn't make a healthy token look UNCLEAR.
          volumeWindows: priceHistory.volumeWindows || null,
        } : null,
        redFlags,
        lpLock: lpStatus ? { status: lpStatus.status, lpBurnPct: lpStatus.lpBurnPct, note: lpStatus.label } : null,
        cexPresence: cexPresence ? { exchanges: cexPresence.exchanges, note: `Listed/custodied by ${cexPresence.exchanges.length} exchange(s) (${cexPresence.exchanges.slice(0, 5).join(", ")}${cexPresence.exchanges.length > 5 ? `, +${cexPresence.exchanges.length - 5} more` : ""}) among the true top holders — a legitimacy signal (cleared CEX due diligence; adds off-chain order-book liquidity not visible on-chain). ~${Math.round((cexPresence.top10Share || 0) * 100)}% of supply is exchange-custodied — custodial, not single-entity concentration.` } : null,
        creatorVerification: creatorVerification ? { status: creatorVerification.status, note: creatorVerification.status === "verified" ? `Creator identity is verified on Bags: ${creatorVerification.handles.map(h => "@" + h.username).join(", ")} (${creatorVerification.handles[0].provider}). A named, verified human is attached to the fee wallet — an accountability signal.` : `Bags token but no verified social is linked to the creator wallet(s) — an anonymous fee earner. Not inherently bad (many legit devs stay anon), but there's no verified identity to hold accountable.` } : null,
        metadata: metadataStatus ? { status: metadataStatus.status, mutable: metadataStatus.mutable, updateAuthority: metadataStatus.updateAuthority, note: metadataStatus.label } : null,
      };
      const modeIntro = reportMode === "health-checkup"
        ? "You are Cluck Norris, a wry, blunt, no-hype crypto sensei. The user paste a token expecting an autopsy — but this patient is alive and trading. AUTOPSY CANCELED. Open by acknowledging you came with the scalpel and didn't need it, then deliver a Full Health Checkup using the verified on-chain facts. Same forensic depth, but framed as a physical, not a post-mortem. Do NOT use death language (corpse, post-mortem, cause of death, dying, fade). Use checkup/health/vital-signs language instead."
        : reportMode === "health-assessment"
        ? "You are Cluck Norris, a wry, blunt, no-hype crypto sensei. The user paste a token expecting an autopsy — but this patient is alive, just bruised. AUTOPSY ON STANDBY. Open by acknowledging the patient is alive but showing warning signs / heavy retracement, then deliver a Health Assessment using the verified on-chain facts. Honest about concerns, but not a death certificate. Avoid 'corpse' / 'post-mortem' language; use 'health' / 'patient' / 'recovery' / 'warning signs' framing."
        : "You are Cluck Norris, a wry, blunt, no-hype crypto sensei narrating a forensic post-mortem on a Solana token. You receive verified on-chain facts and must explain what happened — or what state the token is in — as a teaching case study.";
      const sysPrompt = `${modeIntro}

STRICT RULES:
- ONLY use the facts you are given. Never invent numbers, dates, wallet addresses, or events that are not in the data.
- Voice: blunt, dry, slightly wry. For dead/dying tokens, treat the token as a teachable corpse. For alive tokens, treat them as a live patient — describe vital signs and overall health, not death. No hype, no shilling, no price predictions.
- Length: 2 to 3 short paragraphs. Mobile reading.
- Reference the specific red flags by what they are. Be specific about the verdict.
- End with one sentence naming the lesson the reader should take. Something like: "The tell was X — exactly the kind of pattern the Rugs lesson teaches you to spot."
- If the verdict is ALIVE or UNCLEAR, narrate that honestly. Do not invent a death.
- READ THE PRICE TREND. A token can have low 24h volume and still be appreciating (quiet accumulation, not a fade), or be moving down (active distribution). If priceChange24h is positive, do not call it a "slow fade" or "quiet death" — it is trending up on thin volume, which is a different story.
- READ THE TOP-HOLDER FORENSICS. The topHolderForensics block tells you how the top 20 broke down: how many are in locks vs LP vs human wallets; how many were launch snipers vs early buyers vs later; how many bought through a bonding curve vs received tokens pre-pool; how many of the humans are still holding vs sold vs accumulated more. Reference this when it tells a story.
  CRITICAL on "pre-pool" / "bonding curve": for a Bags.fm or Pump.fun token (bondingCurveDetected true, or the mint ends in "pump"/"BAGS"), holders who acquired BEFORE the DEX pool existed bought ON THE BONDING CURVE before the token graduated to its public pool (e.g. Meteora). This is the NORMAL early-buyer path — they are NOT pre-launch insiders and did NOT "receive an allocation before launch." NEVER describe bonding-curve / pre-graduation buyers as insider distribution or pre-launch allocations. The "possible insider distribution" read ONLY applies to a NON-launchpad token where wallets received tokens before any pool with no bonding-curve mechanism at all. When in doubt on a launchpad token, call them "early bonding-curve buyers," not insiders.
- READ THE LIFETIME ANALYSIS. lifetimeAnalysis.mintedDaysAgo tells you when the token was created. postLaunchMintEvents > 0 means the mint authority was actually USED to print supply after launch — name that explicitly as proven dilution, not just theoretical risk. bondingCurveDetected being true means this is a Bags.fm or Pump.fun graduated token; reflect that in how you describe early holders.
- READ THE PRICE HISTORY EXACTLY. priceHistory.drawdownFromPeakPct tells you the drop from the daily-close peak in the DEX-pool's history. priceHistory.peakDaysAgo gives the EXACT number of days since that peak. CRITICAL: use peakDaysAgo verbatim — NEVER invent timeframes like "first week" or "seven weeks" unless they match peakDaysAgo. If peakDaysAgo is 54, say "peaked 54 days ago," not "in the first week" or any other fabricated phrase. Also remember: for graduated Bags.fm or Pump.fun tokens, the price history starts at GRADUATION, not at token mint — so the "peak" may be the post-graduation settled price, not the bonding-curve high. Be honest about which window you're reading.
- READ THE CREATOR STATUS. creatorStatus tells you what the wallet that paid for the genesis tx has done with their position. CRITICAL: "not in the top 20/100 holders" does NOT automatically mean the creator exited or distributed — their tokens may be LOCKED (see lockAttribution), or the creator wallet may be misidentified (on Pump.fun/Bags graduated tokens we sometimes only have the genesis-tx fee payer, which is a platform wallet, not the team). NEVER assert "the creator dumped / exited / distributed" off "not a current holder" alone. Only say it if creatorStatus shows actual sells. If they HELD or ACCUMULATED, say so honestly.
- READ THE LOCK ATTRIBUTION. lockAttribution (when present) tells you how much supply is LOCKED and via what platform (Streamflow, Jupiter Lock, etc.). Locked supply is removed from circulation — a commitment signal, NOT abandonment. teamVerifiedLockedPct is locks by the proven creator; unlabeledLockedPct is locks by wallets we could NOT verify as team (could be team OR conviction community holders — do NOT claim which). If a meaningful % of supply is locked, name it as a positive and NEVER pair it with an "everyone abandoned ship" narrative — those contradict each other.
- READ THE CREATOR FEES (both platforms). State plainly how much the creator extracted in fees over the token's life — this is a key honest fact a reader of a FAILED or collapsed token wants. The number comes from whichever applies: for Pump.fun tokens, pumpCreatorFees.lifetimeTotalSol (claimed + unclaimed); for Bags tokens, creatorStatus.onChainActivity.claimedSol (SOL claimed in creator fees). Treat both the same way: "the creator pulled ~X SOL in creator fees over the token's life." Do NOT moralize or accuse — earning creator fees is normal; just report the number and let the reader judge. If the fee total is meaningful relative to the token's collapse, naming it is exactly the kind of fact this tool exists to surface. The "fees recycled back into buys = positive story" framing ONLY applies when pctReinvested is genuinely high (e.g. 70%+) AND feeExtractionDominant is not set; a creator who claimed a lot but recycled only a small fraction (low pctReinvested / feeExtractionDominant true) is EXTRACTING, not recycling — say that plainly even if there is a token-flow tag like buy-back.
- READ THE CREATOR WALLET PROFILE. creatorWalletProfile.established=true means the creator wallet is an active operator wallet with a long history — NOT a fresh throwaway deployer; never imply it's a burner. If established=false and fundedBy is set, that's who funded the wallet; a fresh deployer funded from a single source right before launch is worth naming neutrally as a setup pattern (not proof of bad intent).
- READ THE BURN AND AIRDROP DATA. lifetimeAnalysis.totalBurnedObserved + burnedAsShareOfSupply tells you if real burning happened. dustDropEventsObserved > 0 means the token did inorganic dust drops to inflate holder count (a red flag). airdropEventsObserved counts bulk distribution events — that's neutral by itself but worth naming if substantial.
- READ THE ACQUISITION BREAKDOWN AND DISTRIBUTOR DATA. acquisitionBreakdown tells you HOW the top wallets got their tokens: BOUGHT (via DEX, organic), TRANSFER (sent directly from another wallet — could be airdrop, team allocation, insider coordination, or coordinated dump-prep), or MINTED (direct from mint authority). If most are TRANSFER and distributorCount > 0, the holders weren't organic buyers — they were distributed to. CRITICAL EVIDENCE RULES: only call a distributor a "team wallet" when topDistributorIsVerifiedCreator is TRUE (meaning the wallet is in Bags creator/v3 registration — VERIFIED). For any OTHER distributor — even one that distributed to many wallets — DO NOT claim or imply team affiliation. On-chain transfer patterns can equally indicate team distribution, insider coordination, coordinated dump-prep, or community airdrop, and we cannot tell them apart from blockchain data alone. Use strictly neutral language: "a wallet distributed tokens to N top holders" — and explicitly flag the uncertainty ("origin not verified — could be team operations, insider coordination, or public airdrop"). The only time you can confidently call something team activity is when the source wallet is in the Bags/Pump verified-creator API response.
- ALL HOLDER COUNTS (holderBreakdown, acquisitionBreakdown, behaviorBreakdown) are computed across the TOP 100 HOLDERS (topHoldersScannedCount), not the top 20. Do NOT write phrases like "of the top 20, 22 are pre-pool" — that is mathematically impossible. The badges-card in the UI shows the top 20 visually, but every COUNT you receive in facts spans the full top 100. Use phrasing like "across the top holders we analyzed" or cite the breakdown directly without making top-20 claims.
- CREATOR BEHAVIOR KIND IS AUTHORITATIVE — BUT CHECK THE EXTRACTION OVERLAY FIRST. If creatorStatus.behaviorKind is "BUY_AND_LOCK" or "BUY_BACK_ACTIVE", the creator wallet is buying and removing supply, NOT selling via swaps. NORMALLY you lead with the buy-back: describe it with the specific numbers from creatorStatus.onChainActivity (buyCount, lockCount, lockedTokens, boughtSol, pctReinvested, teamNetwork totals). Do NOT say "zero buy history" / "P&L came back blank" / anything implying absence when onChainActivity shows numerical activity.
  CRITICAL EXCEPTION — extraction overlay: if creatorStatus.onChainActivity.feeExtractionDominant is TRUE or creatorStatus.onChainActivity.funnelHeavy is TRUE, the buy-back is NOT the headline — EXTRACTION IS. You MUST lead with the extraction and present the buy-back as the smaller, secondary flow. feeExtractionDominant means the creator claimed far more in creator fees than they recycled into buys (see netFeeExtractionSol = SOL kept, and pctReinvested = the small % put back) — lead with "claimed ~X SOL in fees, recycled only Y% — roughly Z SOL kept." funnelHeavy means the creator moved a large share of supply (transferOutShareOfSupply %) out to OTHER wallets, far more than they bought on-market — lead with that token funnel. The whole point: a creator wallet showing 0 market sells does NOT mean nothing was extracted — fee claims and token transfers-out are the extraction vectors a naive "did the dev sell?" check misses entirely. When either flag is set, NEVER frame the creator as pure conviction / diamond hands; name the extraction as the dominant story, then note the buy-back as the minority counter-flow. Stay factual — state the fee/transfer chain; do not assert the recipient wallets dumped unless other facts prove it.
  The creatorStatus.onChainActivity.sellCount is ONLY market sells (SWAP-type, creator's tokens flowing out). transferOutCount is NOT a market sell — those are wallet-to-wallet moves. But a LARGE transferOutTokens (funnelHeavy) is still a hidden-exit vector to name as a fact, not dismiss. When sellCount is 0, NEVER say "the creator has been selling on the market," but DO say "the creator extracted value via fees / token transfers" when the overlay flags are set.
- READ THE BAGS LAUNCH DATA IF PRESENT. bagsLaunch.isBagsToken being true means this token launched on Bags.fm. bagsLaunch.officialCreators is the verified creator list (with Twitter handles when present) — use these names directly when narrating who the creator is. bagsLaunch.dbcBuyersInTop100 is the count of top-100 holders we verified bought through the actual Bags bonding curve (not inferred — confirmed by parsing the DBC pool's transactions). When this number is high, the top-holder structure is dominated by genuine early-supporter bonding-curve buyers, NOT pre-allocated insiders — narrate that distinction honestly. bagsLaunch.totalClaimedSol + claimEventCount + daysSinceLastClaim tell you whether the project is ACTIVELY claiming its creator fees (recent claims = active operations, no claims or stale = abandoned). bagsLaunch.feeWalletsInTop100 tells you whether the fee-receiving wallets ALSO hold tokens directly — a fee wallet that holds zero tokens but receives fees is the team's separate operational wallet (normal); a fee wallet that ALSO sits in the top 100 means the team holds AND extracts (more concentrated power).
  BAGS GRADUATION (critical — same rules as Pump): bagsLaunch.graduated / bagsLaunch.onBondingCurve are authoritative from Solana Tracker. onBondingCurve true (market "meteora-curve") = the token is STILL ON THE BAGS BONDING CURVE and has NOT graduated to its Meteora DEX pool yet. A token still on the curve has NO DEX pool — that is NORMAL and BY DESIGN, not a rug. DexScreener showing ~$0 (or a tiny phantom pool) for an on-curve Bags token does NOT mean "LP pulled" / "no exit" / "never launched". Its real liquidity is the curve reserve — see bagsLaunch.stLiquidityUsd for the actual figure, and bagsLaunch.curvePercentage for progress to graduation. NEVER say "LP pulled" / "rug" / "no exit at size" for a Bags token that simply hasn't graduated. Describe it as "still on the Bags bonding curve (X% to graduation) with ~$Y in curve liquidity — early and speculative." Only describe a graduated Meteora pool when graduated is true.
- READ THE CREATOR VERIFICATION BLOCK. creatorVerification.source tells you where the creator wallet came from: "bags-official" (verified by Bags API) and "pump-official" (verified by Pump API) are HIGH-CONFIDENCE — name the wallet/handle directly. "genesis-tx-fee-payer" is the on-chain fallback. "unverified-platform-launch" is CRITICAL — it means this is a Bags/Pump token where the platform API returned no registered creator, and the on-chain genesis tx fee payer is the PLATFORM wallet (Bags/Pump's shared launcher that has launched thousands of tokens), NOT the project team. Do NOT call out a "dev wallet" or attribute on-chain creator behavior to that wallet in this case — explicitly say the project's true creator is not verifiable from on-chain data alone, and warn that tools like DexScreener may show the platform wallet labeled as "dev" for many unrelated tokens because they don't make this distinction.
- READ THE PUMP LAUNCH DATA IF PRESENT. pumpLaunch.isPumpToken being true means this token launched on Pump.fun.
  GRADUATION (critical — get this right): pumpLaunch.graduated is authoritative. true = the token has migrated to a DEX pool (PumpSwap/Raydium/Meteora). false / onBondingCurve=true = the token is STILL ON THE BONDING CURVE at Pump.fun and has NOT graduated. NEVER say a token "graduated off the bonding curve" unless graduated is true. If onBondingCurve is true, describe it as "still on the Pump.fun bonding curve" (optionally with curvePercentage to graduation).
  LIQUIDITY ON A BONDING-CURVE TOKEN: a token still on the curve has NO DEX liquidity pool yet — that is NORMAL and BY DESIGN, not a rug. DexScreener showing $0 liquidity for an on-curve token does NOT mean "the LP was pulled" or "wasn't seeded." Its real liquidity is the bonding-curve reserve — see pumpLaunch.stLiquidityUsd (from Solana Tracker) for the actual figure. NEVER say "LP pulled" / "LP not seeded" for a token that simply hasn't graduated yet.
  pumpLaunch.bcBuyersInTop100 is the count of top-100 holders verified as bonding-curve buyers. A high number means most top holders bought organically through the curve, not via insider allocation. pumpLaunch.pumpEraPeakPriceUsd captures the peak during the bonding-curve era. For graduated tokens, GeckoTerminal price history starts at graduation.
- READ THE HIDDEN-EXIT PATTERNS IF PRESENT. hiddenExitPatterns flags wallets that transferred tokens to multiple OTHER wallets which THEN dumped — a classic obfuscation move (the source wallet doesn't show up in a simple top-seller scan because the actual selling happens from the recipient wallets). When hiddenExitPatterns.count > 0, this is the SHARPEST forensic signal on the page: lead with it. Use the exact wording "transfer-then-dump pattern" or "hidden exit". When sourceAlsoSold is true, escalate further — the source wallet was distributing tokens to obfuscate AND extracting value directly. These detections specifically exclude verified Bags/Pump creator wallets and known LP/locker addresses, so they're not false-flagged on legitimate team distribution.
- READ THE PNL LEDGER IF PRESENT. pnlLedger reconstructs every wallet's lifetime buy/sell history priced at that day's USD close. tookTheMoneyCount is the number of wallets that sold their entire position FOR A PROFIT and walked — call those out as "cash-out wallets" when material. biggestWinnerRealizedUsd / biggestLoserRealizedUsd give you the polar extremes: who made bank vs who got rekt. topSellerSoldUsd is the most-extracted single wallet — if that's a large fraction of total volume, the distribution was lopsided (one wallet drained the pool). If the top seller exit dwarfs the top buyer entry, distribution was concentrated on the way out — name it.
- READ THE CREATOR ON-CHAIN ACTIVITY when present (creatorStatus.onChainActivity). The fields distinguish three different on-chain actions for the creator wallet: buyCount/boughtUsd = buying on the open market, sellCount/soldUsd = extracting value via swaps, and lockCount/lockedTokens = sending tokens to a locker contract (permanently removing supply, NOT a sell). creatorStatus.behaviorKind being "BUY_AND_LOCK" is the strongest possible signal — the team is buying CLKN with their fees and immediately locking what they buy, taking supply OUT of circulation. Lead with this when present: "@handle is running a buy-and-lock — X buys, Y lock deposits, Z tokens removed from circulation." It is NOT a sell pattern; do not characterize it as distribution.
- READ THE TOKEN-2022 EXTENSIONS IF PRESENT. The token2022 block only appears for Token-2022 mints. token2022.hasHoneypotExtension being true is the SHARPEST red flag on the entire page — it means the mint is built to trap buyers: a non-transferable token (can never be sold), accounts frozen by default (can't sell until manually thawed), an active transfer hook (a custom program can reject sells at will), or a ~100% transfer fee (sells taxed into nothing). When true, LEAD THE NARRATIVE WITH IT and name the exact mechanism from token2022.risks[] — this is a honeypot regardless of liquidity or buy/sell counts. A permanent delegate (severity "severe") means every holder's tokens are seizable/burnable by the delegate at any time — name it as a control risk even if not a hard honeypot. A transfer fee under 10% is a cost to disclose, not a honeypot. Standard SPL tokens have no token2022 block — do NOT mention Token-2022 at all for them.
- No markdown asterisks, no headers. Plain prose paragraphs.`;
      const userMsg = `Token: ${symbol} (${name})\nReport mode: ${reportMode}\nVerdict: ${verdict.type} — ${verdict.label}\nVerified facts:\n${JSON.stringify(facts, null, 2)}\n\n${reportMode === "health-checkup" ? "Write the Full Health Checkup now." : reportMode === "health-assessment" ? "Write the Health Assessment now." : "Write the forensic case study now."}`;
      try {
        const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": ANTHROPIC_KEY,
            "anthropic-version": "2023-06-01"
          },
          body: JSON.stringify({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 600,
            system: sysPrompt,
            messages: [{ role: "user", content: userMsg }]
          })
        });
        const aiData = await aiRes.json();
        if (aiData.content && aiData.content[0]) {
          narrative = aiData.content[0].text.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1").replace(/#{1,3}\s/g, "").trim();
        }
      } catch (e) {
        console.warn("[AUTOPSY] AI narration failed:", e.message);
      }
    }

    console.log(`[AUTOPSY] ${symbol} -> ${verdict.type} (${redFlags.length} red flags, narration=${narrative ? "yes" : "no"})`);

    return { status: 200, body: {
      success: true,
      mint,
      symbol, name,
      verdict,
      reportMode, reportHeadline, reportSubhead,
      facts: {
        symbol, name, decimals,
        totalSupply: supplyTokens,
        mintAuthorityRevoked: !mintAuthority,
        freezeAuthorityRevoked: !freezeAuthority,
        token2022: isToken2022 ? {
          isToken2022: true,
          transferFeePct: transferFeeBps != null ? Number((transferFeeBps / 100).toFixed(2)) : null,
          hasHoneypotExtension,
          risks: token2022Risks.map(r => ({ kind: r.kind, severity: r.severity, label: r.label, msg: r.msg })),
        } : null,
        totalLiqUsd: Number(totalLiqUsd.toFixed(2)),
        totalVol24h: Number(totalVol24h.toFixed(2)),
        priceChangeH1, priceChangeH6, priceChangeH24,
        buys24h, sells24h, txns24h,
        poolCount: solPairs.length,
        priceUsd, fdv, marketCap, turnover,
        ageDays: ageDays !== null ? Math.round(ageDays) : null,
        pairCreatedAt: pairCreatedMs ? new Date(pairCreatedMs).toISOString() : null,
        top10Concentration: top10Share,
        topPair: topPair ? {
          dexId: topPair.dexId,
          pairAddress: topPair.pairAddress,
          url: topPair.url || null,
        } : null,
      },
      redFlags,
      lpStatus,
      cexPresence,
      creatorVerification,
      metadataStatus,
      narrative,
      lessons: lessonMap[verdict.type] || lessonsFinal,
      topHolders,
      holderBreakdown,
      behaviorBreakdown,
      lockedSupplyShare,
      humanSupplyShare,
      lifetime,
      priceHistory,
      creatorStatus,
      distributors,
      bagsInfo,
      pumpInfo,
      walletPnl,
      lockAttribution,
      pumpCreatorFees,
      creatorWalletProfile,
      hiddenExitDistributors,
      jupiterInfo,
      solscan: solscan.isConfigured() ? {
        configured: true,
        holderCount: solscanHolderCount,
      } : { configured: false },
      scanQuality: (() => {
        // Annotate scanQuality with a human-readable summary so the UI can
        // render an honest "Cluck needs more time" banner when something
        // didn't finish cleanly. Quality buckets:
        //   FULL — every phase completed without rate-limiting
        //   PARTIAL — minor degradation (a couple of 429s, retried OK)
        //   DEGRADED — multiple phases failed or rate-limited heavily
        const failedPhases = (scanQuality.phasesFailed || []);
        const limitedCount = scanQuality.heliusRateLimited || 0;
        const batchSuccessRate = scanQuality.heliusBatches > 0
          ? scanQuality.heliusBatchesSucceeded / scanQuality.heliusBatches
          : 1;
        // Solana-Tracker-aware: if the ONLY degraded phases are the Phase 2G
        // creator-trace family AND Solana Tracker provided a complete
        // cross-check for the creator wallet, the headline creator numbers
        // (buys, sells, invested, ROI) are NOT missing — they're sourced
        // from ST's complete indexer, not our rate-limited signature walk.
        // In that case the banner shouldn't alarm; it should explain the
        // numbers are backfilled from an independent complete source.
        const stBackfilled = !!(creatorStatus && creatorStatus.onChainActivity
          && creatorStatus.onChainActivity.solanaTrackerCrossCheck);
        const onlyCreatorDegraded = failedPhases.length > 0
          && failedPhases.every(p => typeof p === "string" && p.startsWith("phase-2G"));
        let qualityLabel = "FULL";
        let qualityMessage = null;
        if (stBackfilled && onlyCreatorDegraded && batchSuccessRate >= 0.85 && limitedCount < 5) {
          // Phase 2G's raw trace was throttled, but ST has the real numbers.
          qualityLabel = "BACKFILLED";
          qualityMessage = `Our raw signature trace got rate-limited by Helius, but the creator's buy / sell / lock / ROI figures shown here are sourced from Solana Tracker's complete indexer — these headline numbers are not missing data. The on-chain trace below ("our trace") stays conservative; trust the Solana Tracker cross-check for the fuller picture.`;
        } else if (failedPhases.length >= 2 || batchSuccessRate < 0.85 || limitedCount >= 5) {
          qualityLabel = "DEGRADED";
          qualityMessage = `Cluck didn't get a clean read this run. ${failedPhases.length > 0 ? failedPhases.join(", ") + " came back partial. " : ""}${limitedCount > 0 ? `Helius rate-limited ${limitedCount} batch${limitedCount === 1 ? "" : "es"}. ` : ""}Some numbers may be lower than reality. Re-run in 30 seconds for cleaner data — counters only grow across runs (we cache the best observation per wallet).`;
        } else if (failedPhases.length === 1 || limitedCount >= 1 || batchSuccessRate < 0.98) {
          qualityLabel = "PARTIAL";
          qualityMessage = `Cluck got most of the data. ${failedPhases.length > 0 ? failedPhases[0] + " was slightly degraded. " : ""}${limitedCount > 0 ? `${limitedCount} batch retry on rate limit. ` : ""}Best-observed cache filled the gaps.`;
        }
        // Also flag when GeckoTerminal didn't load (boughtUsd math goes to 0)
        if (!priceHistory) {
          if (qualityLabel === "FULL") qualityLabel = "PARTIAL";
          if (!qualityMessage) qualityMessage = "";
          qualityMessage = (qualityMessage || "") + " (Price history from GeckoTerminal didn't load — USD-valued P&L will be approximate.)";
        }
        return {
          ...scanQuality,
          qualityLabel,
          qualityMessage,
          usedBestObservedCache: !!(creatorStatus && creatorStatus.onChainActivity && creatorTrace && creatorTrace.usedBestObservedCache),
        };
      })(),
    } };
  } catch (err) {
    console.error("Autopsy error:", err.message);
    return { status: 500, body: { success: false, error: err.message } };
  }
}

module.exports = { runAutopsy, bagsFetch, heliusEnhancedBatched, BAGS_BASE };
