// lib/webacy-dd.js — DD.xyz (by Webacy) on-chain risk provider.
//
// A thin, resilient, FAIL-CLOSED wrapper around the DD.xyz / Webacy risk API
// (https://api.webacy.com). Adds an independent, second-opinion risk signal to
// the Token Autopsy and Wallet X-Ray tools: token risk (authority / honeypot /
// liquidity-lock / rug signals), wallet/address risk scoring, and address
// poisoning detection — surfaced free to consumer users alongside our own
// on-chain checks.
//
// SAFE BY DEFAULT: with WEBACY_API_KEY unset this module is a pure no-op — every
// call returns { available: false } and NOTHING in the product changes. It only
// becomes live once the key is set in the environment (Railway). Same opt-in
// pattern as our other optional providers (JUPITER_API_KEY, ELEVENLABS, etc.).
//
// Auth: header `x-api-key`. Chain: Solana = `sol`. Docs: https://developers.webacy.co/
//
// Every network call is timeout-bounded and try/caught — a DD outage or a bad
// response can NEVER throw into the autopsy/wallet-xray request path; it just
// degrades to "no DD signal this run", exactly like a missing provider key.

const DD_BASE = "https://api.webacy.com";
const DD_TIMEOUT_MS = 9000;
const CACHE_TTL_MS = 3 * 60 * 1000; // match the autopsy 3-min cache window

const _cache = new Map(); // key -> { at, val }

function ddEnabled() {
  return !!process.env.WEBACY_API_KEY;
}

// Read the first present, non-null field from a list of candidate names —
// the DD response schema isn't pinned here, so normalize defensively.
function pick(obj, names, dflt = null) {
  if (!obj || typeof obj !== "object") return dflt;
  for (const n of names) {
    if (obj[n] != null) return obj[n];
  }
  return dflt;
}

// Map a 0–10 or 0–100 numeric risk to a coarse level + a normalized 0–100 score.
function normalizeRisk(rawScore) {
  if (rawScore == null || !Number.isFinite(Number(rawScore))) return { score: null, level: null };
  let s = Number(rawScore);
  if (s <= 10) s = s * 10; // DD address "overallRisk" is commonly 0–10; scale to 0–100
  s = Math.max(0, Math.min(100, s));
  const level = s >= 70 ? "high" : s >= 35 ? "medium" : "low";
  return { score: Math.round(s), level };
}

// Core fetch: GET against the DD API with the x-api-key header. Returns parsed
// JSON or null on ANY failure (missing key, timeout, non-2xx, parse error).
async function ddGet(path) {
  if (!ddEnabled()) return null;
  const key = `GET ${path}`;
  const hit = _cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.val;
  try {
    const r = await fetch(`${DD_BASE}${path}`, {
      headers: { "x-api-key": process.env.WEBACY_API_KEY, accept: "application/json" },
      signal: AbortSignal.timeout(DD_TIMEOUT_MS),
    });
    if (!r.ok) {
      // 401/403 = bad/missing key; 404 = no data for this address; 429 = rate.
      // None should ever surface to the user — cache a null briefly to avoid
      // hammering on a hard error, but not as long as a real result.
      _cache.set(key, { at: Date.now() - (CACHE_TTL_MS - 20000), val: null });
      return null;
    }
    const val = await r.json();
    _cache.set(key, { at: Date.now(), val });
    return val;
  } catch (_) {
    return null; // timeout / network / abort — degrade silently
  }
}

// ── Wallet / address risk ────────────────────────────────────────────────────
// GET /addresses/{address}?chain=sol  — threat considerations + overall risk.
async function ddAddressRisk(address, chain = "sol") {
  const data = await ddGet(`/addresses/${address}?chain=${chain}`);
  if (!data) return { available: false };
  const raw = pick(data, ["overallRisk", "riskScore", "risk", "score"]);
  const { score, level } = normalizeRisk(raw);
  const issues = Array.isArray(pick(data, ["issues", "riskItems", "flags"], []))
    ? pick(data, ["issues", "riskItems", "flags"], [])
    : [];
  const flags = issues
    .map((i) => {
      const tags = pick(i, ["tags", "categories", "name", "type", "title"]);
      if (Array.isArray(tags)) return tags.join(", ");
      if (tags && typeof tags === "object") return Object.keys(tags).join(", ");
      return tags || pick(i, ["description", "message"]);
    })
    .filter(Boolean);
  return {
    available: true,
    source: "dd.xyz",
    riskScore: score,
    riskLevel: level,
    flags,
    issueCount: issues.length,
    raw: data,
  };
}

// GET /addresses/{address}/poisoning?chain=sol — address-poisoning exposure.
async function ddAddressPoisoning(address, chain = "sol") {
  const data = await ddGet(`/addresses/${address}/poisoning?chain=${chain}`);
  if (!data) return { available: false };
  const detected =
    pick(data, ["isPoisoned", "poisoned", "detected", "hasPoisoning"]) === true ||
    (Array.isArray(pick(data, ["results", "matches", "incidents"], [])) &&
      pick(data, ["results", "matches", "incidents"], []).length > 0);
  return { available: true, source: "dd.xyz", detected, raw: data };
}

// One combined wallet report for Wallet X-Ray.
async function ddWalletReport(address) {
  if (!ddEnabled()) return { available: false };
  const [risk, poison] = await Promise.all([
    ddAddressRisk(address).catch(() => ({ available: false })),
    ddAddressPoisoning(address).catch(() => ({ available: false })),
  ]);
  if (!risk.available && !poison.available) return { available: false };
  return {
    available: true,
    source: "dd.xyz",
    riskScore: risk.available ? risk.riskScore : null,
    riskLevel: risk.available ? risk.riskLevel : null,
    flags: risk.available ? risk.flags : [],
    poisoningDetected: poison.available ? poison.detected : null,
  };
}

// ── Token / contract risk ────────────────────────────────────────────────────
// GET /tokens/{mint}?chain=sol  — token risk + economic history.
async function ddTokenRisk(mint, chain = "sol") {
  const data = await ddGet(`/tokens/${mint}?chain=${chain}`);
  if (!data) return { available: false };
  const raw = pick(data, ["overallRisk", "riskScore", "risk", "score"]);
  const { score, level } = normalizeRisk(raw);
  const issuesArr = pick(data, ["issues", "riskItems", "flags", "warnings"], []);
  const issues = Array.isArray(issuesArr) ? issuesArr : [];
  const flags = issues
    .map((i) => pick(i, ["name", "title", "type", "tag", "description", "message"]))
    .filter(Boolean);
  return {
    available: true,
    source: "dd.xyz",
    riskScore: score,
    riskLevel: level,
    flags,
    issueCount: issues.length,
    raw: data,
  };
}

// GET /tokens/{mint}/pools?chain=sol — pool-level risk (liquidity, lock).
async function ddTokenPools(mint, chain = "sol") {
  const data = await ddGet(`/tokens/${mint}/pools?chain=${chain}`);
  if (!data) return { available: false };
  return { available: true, source: "dd.xyz", raw: data };
}

// One combined token report for Token Autopsy.
async function ddTokenReport(mint) {
  if (!ddEnabled()) return { available: false };
  const [risk, pools] = await Promise.all([
    ddTokenRisk(mint).catch(() => ({ available: false })),
    ddTokenPools(mint).catch(() => ({ available: false })),
  ]);
  if (!risk.available && !pools.available) return { available: false };
  return {
    available: true,
    source: "dd.xyz",
    riskScore: risk.available ? risk.riskScore : null,
    riskLevel: risk.available ? risk.riskLevel : null,
    flags: risk.available ? risk.flags : [],
    pools: pools.available ? pools.raw : null,
  };
}

module.exports = {
  ddEnabled,
  ddAddressRisk,
  ddAddressPoisoning,
  ddWalletReport,
  ddTokenRisk,
  ddTokenPools,
  ddTokenReport,
};
