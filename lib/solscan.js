// Solscan Pro API integration — independent data source alongside Helius
// and Jupiter. Most valuable signal for our forensic tools is the **account
// label database** — Solscan maintains thousands of wallet labels (CEX hot
// wallets, market makers, known team wallets, known scammers, KYCed entities)
// that no other Solana indexer exposes at this depth.
//
// Used by:
//  • Autopsy — enriches top-100 holder counterparty labels, distributors,
//    and P&L ledger with Solscan wallet names
//  • Trace — labels counterparties in the transaction history
//  • Score — independent holder-count cross-verification
//
// Free tier: capped requests per month. We cache aggressively in-memory
// (longer TTL than Bags/Jupiter since labels rarely change), batch where
// the API supports it, and degrade gracefully (return null instead of
// throwing) when the API misbehaves or the key is missing.

const SOLSCAN_BASE = "https://pro-api.solscan.io/v2.0/";

const LABEL_CACHE = new Map();          // address → { label, fetchedAt } (24h TTL)
const TOKEN_META_CACHE = new Map();     // mint → { meta, fetchedAt } (1h TTL)
const HOLDER_COUNT_CACHE = new Map();   // mint → { count, fetchedAt } (10min TTL)

const LABEL_TTL_MS = 24 * 60 * 60 * 1000;   // wallet labels are stable
const TOKEN_META_TTL_MS = 60 * 60 * 1000;   // 1h
const HOLDER_COUNT_TTL_MS = 10 * 60 * 1000; // 10min

// Negative cache (404 / no-label) so we don't re-query absent addresses.
// 6 hours — long enough to save quota, short enough that newly-labeled
// addresses get picked up the same day.
const NULL_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

// Solscan returns 401 on missing/bad key, 429 on rate limit. We swallow
// these and return null so the caller never breaks; the autopsy/trace
// renderers always have fallback paths.
async function solscanFetch(endpoint, params = {}) {
  const API_KEY = process.env.SOLSCAN_API_KEY;
  if (!API_KEY) return null;
  const url = new URL(`${SOLSCAN_BASE}${endpoint}`);
  for (const [k, v] of Object.entries(params)) {
    if (v != null) url.searchParams.set(k, String(v));
  }
  try {
    const r = await fetch(url.toString(), {
      headers: { token: API_KEY, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) {
      if (r.status === 401) console.warn("[solscan] 401 — SOLSCAN_API_KEY may be invalid");
      else if (r.status === 429) console.warn("[solscan] 429 — rate limited");
      else if (r.status !== 404) console.warn(`[solscan] ${endpoint} status=${r.status}`);
      return null;
    }
    return await r.json();
  } catch (e) {
    console.warn(`[solscan] ${endpoint} threw:`, e.message);
    return null;
  }
}

// Look up an account's label (Solscan-maintained — covers CEX hot wallets,
// market makers, known team wallets, etc). Returns the label string or null.
// Caches both hits and misses to save quota.
async function getAccountLabel(address) {
  if (!address) return null;
  const cached = LABEL_CACHE.get(address);
  if (cached) {
    const ttl = cached.label ? LABEL_TTL_MS : NULL_CACHE_TTL_MS;
    if (Date.now() - cached.fetchedAt < ttl) return cached.label;
  }
  const data = await solscanFetch("account/detail", { address });
  // Response shape varies; defensive parsing:
  // { success: true, data: { account: "...", lamports: ..., type: "system_account",
  //   tags: [...], owner_program: "...", account_label: { name, type, ... }, ... } }
  let label = null;
  if (data?.success && data.data) {
    const d = data.data;
    label = d.account_label?.name
      || d.account_label?.label
      || (Array.isArray(d.tags) && d.tags.length > 0 ? d.tags[0] : null)
      || null;
  }
  LABEL_CACHE.set(address, { label, fetchedAt: Date.now() });
  return label;
}

// Batch-lookup labels — Solscan free tier doesn't have a true batch endpoint,
// so this does N parallel requests with a concurrency cap so we don't burn
// the free quota in one shot. Returns Map<address, label|null>.
async function batchAccountLabels(addresses, maxConcurrent = 5) {
  const result = new Map();
  const unique = [...new Set(addresses.filter(Boolean))];
  for (let i = 0; i < unique.length; i += maxConcurrent) {
    const slice = unique.slice(i, i + maxConcurrent);
    const labels = await Promise.all(slice.map(a => getAccountLabel(a).catch(() => null)));
    slice.forEach((a, j) => result.set(a, labels[j]));
  }
  return result;
}

// Token holders endpoint — returns total holder count (third independent
// source alongside Helius and Jupiter for cross-verification).
async function getTokenHolderCount(mint) {
  if (!mint) return null;
  const cached = HOLDER_COUNT_CACHE.get(mint);
  if (cached && Date.now() - cached.fetchedAt < HOLDER_COUNT_TTL_MS) return cached.count;
  const data = await solscanFetch("token/holders", { address: mint, page: 1, page_size: 1 });
  const count = data?.data?.total ?? data?.total ?? null;
  HOLDER_COUNT_CACHE.set(mint, { count, fetchedAt: Date.now() });
  return count;
}

// Token metadata — sometimes Solscan has extra fields (creator, supply,
// market cap, social links) that other APIs don't expose cleanly.
async function getTokenMeta(mint) {
  if (!mint) return null;
  const cached = TOKEN_META_CACHE.get(mint);
  if (cached && Date.now() - cached.fetchedAt < TOKEN_META_TTL_MS) return cached.meta;
  const data = await solscanFetch("token/meta", { address: mint });
  const meta = data?.success && data.data ? data.data : null;
  TOKEN_META_CACHE.set(mint, { meta, fetchedAt: Date.now() });
  return meta;
}

// Diagnostic helper — lets the autopsy/score response indicate whether
// Solscan is available this run (so the UI can show "Solscan: ✓" badge
// or fallback gracefully if key is missing or quota exhausted).
function isConfigured() {
  return !!process.env.SOLSCAN_API_KEY;
}

module.exports = {
  getAccountLabel,
  batchAccountLabels,
  getTokenHolderCount,
  getTokenMeta,
  isConfigured,
};
