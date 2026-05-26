// Shared Bags + Jupiter context module.
//
// One canonical fetcher that every tool (autopsy, score, holders, snapshot,
// trace) can use to ask: "who's the verified team behind this mint, what's
// their fee revenue, what does Jupiter independently say about it?"
//
// Cached per-mint with a 5-minute TTL so back-to-back endpoint calls for the
// same mint don't hammer the Bags/Jupiter APIs. The TTL matches the
// `Cache-Control: max-age=300` we already set on autopsy/score endpoints,
// so a cached HTTP response and an in-process module call line up.
//
// All fields are optional/null-safe — if Bags returns nothing or Jupiter
// 404s, the context object still comes back with consistent shape and the
// caller can branch on `bagsInfo === null`, `jupiterInfo === null`, etc.

const BAGS_BASE = "https://public-api-v2.bags.fm/api/v1/";
const JUPITER_SEARCH_URL = "https://lite-api.jup.ag/tokens/v2/search?query=";

const CACHE = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

async function bagsFetchCtx(endpoint, API_KEY) {
  const url = `${BAGS_BASE}${endpoint}`;
  const response = await fetch(url, { headers: { "x-api-key": API_KEY } });
  const text = await response.text();
  return { status: response.status, text };
}

// Fetch (and cache) the Bags + Jupiter context for a mint.
// Returns { bagsInfo, jupiterInfo, projectFeeWallets } — never throws.
async function fetchBagsContext(mint) {
  if (!mint || mint.length < 32) return { bagsInfo: null, jupiterInfo: null, projectFeeWallets: [] };

  const cached = CACHE.get(mint);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.context;

  const BAGS_API_KEY = process.env.BAGS_API_KEY;
  const context = { bagsInfo: null, jupiterInfo: null, projectFeeWallets: [] };

  // Bags creator/v3 → official creators with wallet + royalty share. Drives
  // the projectFeeWallets list every other tool keys off of.
  if (BAGS_API_KEY) {
    const bagsCandidate = {
      isBagsToken: false,
      name: null, symbol: null, status: null, launchSignature: null,
      officialCreators: [], dbcPoolKey: null, dammV2PoolKey: null,
      lifetimeFeesSol: null, totalClaimedSol: null,
      claimEventCount: 0, lastClaimTimestamp: null, claimers: [],
    };
    try {
      const r = await bagsFetchCtx(`token-launch/creator/v3?tokenMint=${mint}`, BAGS_API_KEY);
      if (r.status === 200) {
        const parsed = JSON.parse(r.text);
        const creators = (Array.isArray(parsed) && parsed)
          || (Array.isArray(parsed?.response) && parsed.response)
          || (Array.isArray(parsed?.response?.creators) && parsed.response.creators)
          || (Array.isArray(parsed?.creators) && parsed.creators)
          || (Array.isArray(parsed?.data) && parsed.data)
          || null;
        if (creators && creators.length > 0) {
          bagsCandidate.officialCreators = creators.map(c => ({
            wallet: c.wallet || c.walletAddress || c.walletPubkey || c.creatorWallet || null,
            provider: c.provider || c.socialProvider || null,
            username: c.providerUsername || c.username || c.handle || null,
            isAdmin: !!c.isAdmin,
            royaltyBps: c.royaltyBps ?? c.royaltyBasisPoints ?? null,
          })).filter(c => c.wallet);
          if (bagsCandidate.officialCreators.length > 0) bagsCandidate.isBagsToken = true;
        }
      }
    } catch (e) { console.warn("[bags-context] creator/v3 failed:", e.message); }

    // token-launch/info — best effort (404s for some mints)
    try {
      const r = await bagsFetchCtx(`token-launch/info?tokenMint=${mint}`, BAGS_API_KEY);
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
    } catch (e) { /* swallow */ }

    if (bagsCandidate.isBagsToken) {
      // pool-info
      try {
        const r = await bagsFetchCtx(`token-launch/pool-info?tokenMint=${mint}`, BAGS_API_KEY);
        if (r.status === 200) {
          const parsed = JSON.parse(r.text);
          const info = parsed?.response || parsed;
          if (info?.dbcPoolKey) bagsCandidate.dbcPoolKey = info.dbcPoolKey;
          if (info?.dammV2PoolKey) bagsCandidate.dammV2PoolKey = info.dammV2PoolKey;
        }
      } catch (e) { /* swallow */ }

      // lifetime-fees
      try {
        const r = await bagsFetchCtx(`token-launch/lifetime-fees?tokenMint=${mint}`, BAGS_API_KEY);
        if (r.status === 200) {
          const parsed = JSON.parse(r.text);
          const data = parsed?.success ? parsed.response : parsed;
          const lamports = data?.lifetimeFees ?? data?.totalFees ?? data?.amount ?? null;
          if (lamports !== null && Number.isFinite(Number(lamports))) {
            bagsCandidate.lifetimeFeesSol = Number(lamports) / 1e9;
          }
        }
      } catch (e) { /* swallow */ }

      // claim-events paginated (catches recent activity beyond first 100)
      try {
        let allEvents = [];
        for (let page = 0; page < 5; page++) {
          const r = await bagsFetchCtx(`fee-share/token/claim-events?tokenMint=${mint}&mode=offset&limit=100&offset=${page * 100}`, BAGS_API_KEY);
          if (r.status !== 200) break;
          const parsed = JSON.parse(r.text);
          const events = parsed?.success && parsed.response && Array.isArray(parsed.response.events)
            ? parsed.response.events : [];
          if (events.length === 0) break;
          allEvents.push(...events);
          if (events.length < 100) break;
        }
        bagsCandidate.claimEventCount = allEvents.length;
        let totalLamports = 0, latestTs = 0;
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
        if (totalLamports > 0) bagsCandidate.totalClaimedSol = totalLamports / 1e9;
        if (latestTs > 0) bagsCandidate.lastClaimTimestamp = latestTs;
      } catch (e) { /* swallow */ }

      // claim-stats — per-claimer breakdown
      try {
        const r = await bagsFetchCtx(`token-launch/claim-stats?tokenMint=${mint}`, BAGS_API_KEY);
        if (r.status === 200) {
          const parsed = JSON.parse(r.text);
          const claimers = (Array.isArray(parsed?.response) && parsed.response)
            || (Array.isArray(parsed) && parsed) || null;
          if (claimers) {
            bagsCandidate.claimers = claimers.map(c => ({
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
          }
        }
      } catch (e) { /* swallow */ }

      context.bagsInfo = bagsCandidate;
      context.projectFeeWallets = bagsCandidate.officialCreators
        .map(c => c.wallet)
        .filter(Boolean);
    }
  }

  // Jupiter v2 search — independent cross-verification
  try {
    const r = await fetch(`${JUPITER_SEARCH_URL}${mint}`, { signal: AbortSignal.timeout(8000) });
    if (r.ok) {
      const data = await r.json();
      if (Array.isArray(data) && data.length > 0) {
        const t = data.find(d => d.id === mint) || data[0];
        context.jupiterInfo = {
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
          audit: t.audit ? {
            mintAuthorityDisabled: !!t.audit.mintAuthorityDisabled,
            freezeAuthorityDisabled: !!t.audit.freezeAuthorityDisabled,
            topHoldersPercentage: t.audit.topHoldersPercentage ?? null,
            devMigrations: t.audit.devMigrations ?? null,
            devMints: t.audit.devMints ?? null,
          } : null,
          organicScore: t.organicScore ?? null,
          organicScoreLabel: t.organicScoreLabel || null,
          onChainDevPerJupiter: t.dev || null,
        };
      }
    } else if (r.status === 404) {
      context.jupiterInfo = { listed: false };
    }
  } catch (e) { console.warn("[bags-context] Jupiter v2 search failed:", e.message); }

  CACHE.set(mint, { context, fetchedAt: Date.now() });
  return context;
}

// Derived insight: is the verified creator actively claiming fees recently?
// Cheap signal that doesn't need a full on-chain wallet trace — uses only
// the Bags data we already pulled. Returns "active" / "stale" / null.
function classifyTeamActivity(bagsInfo) {
  if (!bagsInfo || !bagsInfo.lastClaimTimestamp) return null;
  const daysSinceClaim = (Date.now() - bagsInfo.lastClaimTimestamp) / 86400000;
  if (daysSinceClaim <= 14 && (bagsInfo.totalClaimedSol || 0) > 0) return "active";
  if (daysSinceClaim <= 90) return "stale";
  return null;
}

module.exports = { fetchBagsContext, classifyTeamActivity };
