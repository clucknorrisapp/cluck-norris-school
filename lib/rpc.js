// ── Resilient RPC: primary Helius + automatic failover ───────────────────────
// One place that knows every RPC endpoint and fails over between them. Built
// after a Helius credit cap took down all on-chain reads at once — the autonomous
// Liquidity Vault (CLKN/ROSE) and every read tool went blind together. With this,
// a 429 / 5xx / network blip on the primary transparently rolls to the next
// endpoint instead of failing the whole call.
//
// Endpoint order (first healthy one wins):
//   1. HELIUS_API_KEY            → mainnet.helius-rpc.com  (the paid primary)
//   2. FALLBACK_RPC_URL          → one or more full RPC URLs, comma-separated
//                                  (e.g. a QuickNode / Triton / Alchemy endpoint)
//   3. HELIUS_API_KEY_2          → a second Helius key on a separate quota
//   4. api.mainnet-beta.solana.com (public last-resort, always appended)
//
// Drop-in: web3.js Connection accepts a custom `fetch` in its config, so failover
// is invisible to every Connection-based reader (the Orca/Raydium SDKs included).
// Direct JSON-RPC callers can use rpcFetch()/rpcJson() for the same behavior.

const { Connection } = require("@solana/web3.js");

const PUBLIC_FALLBACK = "https://api.mainnet-beta.solana.com";

function heliusUrl(key) {
  return `https://mainnet.helius-rpc.com/?api-key=${key}`;
}

// Ordered, de-duplicated list of RPC endpoints to try.
function rpcEndpoints() {
  const list = [];
  const key = process.env.HELIUS_API_KEY;
  if (key) list.push(heliusUrl(key));

  const extra = (process.env.FALLBACK_RPC_URL || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  list.push(...extra);

  const key2 = process.env.HELIUS_API_KEY_2;
  if (key2) list.push(heliusUrl(key2));

  // Public node is always the final safety net.
  list.push(PUBLIC_FALLBACK);

  // De-dupe while preserving order.
  return [...new Set(list)];
}

// The first (preferred) endpoint — for code paths that need a plain URL string.
function primaryRpcUrl() {
  return rpcEndpoints()[0];
}

// The configured Helius API keys, primary first. For Helius-proprietary endpoints
// (the Enhanced Transactions REST API, DAS reads) that a generic RPC backup or the
// public node CANNOT serve — failover there means rolling to a second Helius key on a
// separate quota, never to a non-Helius node.
function heliusKeys() {
  return [process.env.HELIUS_API_KEY, process.env.HELIUS_API_KEY_2].filter(Boolean);
}

function isHeliusHost(u) {
  try { return new URL(u).host.endsWith("helius-rpc.com"); } catch { return false; }
}

// JSON-RPC methods only Helius serves (DAS). A generic backup / public node answers
// these with an HTTP 200 + JSON-RPC "method not found", which rpcFetch would return
// as-is — a silent wrong answer. So these must only fail over BETWEEN Helius endpoints.
const HELIUS_ONLY_METHODS = new Set([
  "getAsset", "getAssets", "getAssetBatch", "getAssetProof", "getAssetProofBatch",
  "getAssetsByOwner", "getAssetsByGroup", "getAssetsByCreator", "getAssetsByAuthority",
  "searchAssets", "getSignaturesForAsset", "getTokenAccounts", "getNftEditions",
]);

// Methods that MUST NOT be blindly replayed to another endpoint on an AMBIGUOUS
// failure: a tx the primary may already have broadcast would be double-submitted.
// (Solana dedupes by signature so it's usually idempotent, but we don't rely on that.)
const NON_IDEMPOTENT_METHODS = new Set(["sendTransaction"]);

// Pull the JSON-RPC method out of a fetch init.body, or null for batches / non-JSON.
function bodyMethod(init) {
  try {
    const b = init && init.body;
    if (typeof b !== "string") return null;
    const parsed = JSON.parse(b);
    if (Array.isArray(parsed)) return null; // batch — treat as ordinary read
    return (parsed && parsed.method) || null;
  } catch { return null; }
}

// True when more than one endpoint is configured, i.e. failover can actually happen.
function hasFailover() {
  return rpcEndpoints().length > 1;
}

function hostOf(u) {
  try {
    return new URL(u).host;
  } catch {
    return String(u).slice(0, 24);
  }
}

// HTTP statuses that mean "this endpoint is unhealthy right now — try the next".
function isRetriableStatus(status) {
  return status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599);
}

// A `fetch` drop-in that fails over across rpcEndpoints(). web3.js (and our own
// JSON-RPC callers) invoke fetch(url, init) with the JSON-RPC body in init.body;
// we replay that same body to each endpoint in turn. The endpoint web3.js built
// the Connection with (== primary) is tried first, then the remaining endpoints.
// 429 / 5xx / network errors advance to the next endpoint; any clean HTTP
// response (even a JSON-RPC application error) is returned as-is.
async function rpcFetch(url, init) {
  const endpoints = rpcEndpoints();
  const method = bodyMethod(init);
  const isWrite = NON_IDEMPOTENT_METHODS.has(method);
  let attempts = [url, ...endpoints.filter((e) => e !== url)];
  // DAS / Helius-only reads must never fall through to a non-Helius node (it would
  // 200 with "method not found"). Restrict to Helius endpoints; if none, leave as-is.
  if (method && HELIUS_ONLY_METHODS.has(method)) {
    const heliusOnly = attempts.filter(isHeliusHost);
    if (heliusOnly.length) attempts = heliusOnly;
  }
  let lastErr;
  for (let i = 0; i < attempts.length; i++) {
    const target = attempts[i];
    const isLast = i === attempts.length - 1;
    try {
      const res = await fetch(target, init);
      // For a non-idempotent write (sendTransaction) only a 429 is safe to retry
      // elsewhere — it means the request was rejected and the tx never broadcast. A
      // 5xx could mean the node already accepted it, so we return it and let the
      // caller decide rather than risk a double-submit.
      const retriable = isWrite ? (res.status === 429) : isRetriableStatus(res.status);
      if (retriable && !isLast) {
        lastErr = new Error(`RPC ${res.status} from ${hostOf(target)}`);
        try { await res.body?.cancel?.(); } catch {}
        if (process.env.RPC_DEBUG) console.warn(`[rpc] ${res.status} from ${hostOf(target)} — failing over`);
        continue;
      }
      return res;
    } catch (e) {
      lastErr = e;
      // A network error on a write is ambiguous (the tx may have reached the node),
      // so don't replay it to a backup — surface it. Reads fail over freely.
      if (!isLast && !isWrite) {
        if (process.env.RPC_DEBUG) console.warn(`[rpc] ${hostOf(target)} threw "${e.message}" — failing over`);
        continue;
      }
      throw e;
    }
  }
  throw lastErr || new Error("rpcFetch: no RPC endpoints configured");
}

// A failover-aware web3.js Connection. Use everywhere instead of `new Connection(url)`.
function connection(commitment = "confirmed") {
  return new Connection(primaryRpcUrl(), { commitment, fetch: rpcFetch });
}

// A failover-aware raw JSON-RPC call: rpcJson("getTokenSupply", [mint]) → parsed JSON.
async function rpcJson(method, params, { id = method } = {}) {
  const res = await rpcFetch(primaryRpcUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  if (!res.ok) throw new Error(`RPC ${res.status}`);
  return res.json();
}

// A heliusRpcCall-compatible factory: returns rpcCall(id, method, params) with
// failover baked in. Drop-in for server.js's heliusRpcCall(url) usages.
function rpcCaller() {
  return async (id, method, params) => {
    const res = await rpcFetch(primaryRpcUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    });
    return res.json();
  };
}

module.exports = {
  PUBLIC_FALLBACK,
  rpcEndpoints,
  primaryRpcUrl,
  heliusKeys,
  hasFailover,
  isRetriableStatus,
  rpcFetch,
  connection,
  rpcJson,
  rpcCaller,
};
