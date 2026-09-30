// Token-risk / pool-risk "pre-flight" flags for the LP scanner — see docs/LP_SCANNER.md
// ("Pre-flight flags"). Owner ask 2026-09-30, after an LP session where these traps cost time:
// Token-2022 transfer fees (1-3% on every move), a scaled-UI multiplier that broke Meteora's
// add-liquidity screen, issuer pause / clawback keys, pre-IPO wrappers, copycat mints.
//
// Two halves:
//   classifyMint()  PURE, no network — a jsonParsed mint account in, structured facts + flags out.
//   tokenRisk()     the fetcher: RPC mint read + epoch + Jupiter lookup, cached, NEVER throws.
// plus poolRisk() (Meteora DLMM fee-collect mode) and the ranking helpers the scanner uses.
//
// Honesty rules (the brand): a flag says what the chain shows, never why. An unreadable token is
// `unknown` — never treated as safe and never as blocked. We never claim an expiry date we cannot
// read on-chain. Informational only — NOT financial advice.

const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

// Issued assets where an issuer freeze/mint authority is normal and expected — never worth a
// louder-than-info flag. (Freeze authority is info for everyone; this only silences mint authority.)
const ISSUED_ASSETS = new Set([
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
  "USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA",  // USDS
  "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo", // PYUSD
  "cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij",  // cbBTC
]);

const SMALL_MULTIPLIER = 0.01; // |multiplier - 1| under this is info, not warn
const LEVEL_ORDER = { block: 0, warn: 1, info: 2 };
const sortFlags = (flags) => flags.slice().sort((a, b) => (LEVEL_ORDER[a.level] ?? 3) - (LEVEL_ORDER[b.level] ?? 3));

function numOrNull(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function pctText(p) { return `${Number(p.toFixed(4))}%`; }
function multText(m) { return `${Number(m.toFixed(6))}×`; }
function extMap(info) {
  const m = {};
  for (const e of (info && Array.isArray(info.extensions) ? info.extensions : [])) {
    if (e && e.extension) m[e.extension] = e.state || {};
  }
  return m;
}

// parsedMintInfo: the `info` object of a jsonParsed mint account (`value.data.parsed.info`); the
// whole `parsed` wrapper ({type:'mint', info}) is accepted too. owner: the account's owner program.
// opts: { jupToken, epoch, nowSec, mint }. jupToken: the Jupiter v2 search row for this mint,
//       `null` if Jupiter has no row for it, `undefined` if the lookup itself failed.
function classifyMint(parsedMintInfo, owner, opts = {}) {
  const info = parsedMintInfo && parsedMintInfo.info && parsedMintInfo.type === "mint" ? parsedMintInfo.info : (parsedMintInfo || {});
  const ext = extMap(info);
  const jup = opts.jupToken;
  const nowSec = Number.isFinite(opts.nowSec) ? opts.nowSec : Math.floor(Date.now() / 1000);
  const epoch = Number.isFinite(Number(opts.epoch)) ? Number(opts.epoch) : null;
  const flags = [];
  const add = (code, level, text) => flags.push({ code, level, text });
  const program = String(owner || "") === TOKEN_2022_PROGRAM ? "token2022" : "spl";
  const issued = !!(opts.mint && ISSUED_ASSETS.has(opts.mint));

  // Transfer fee — newer config applies once its epoch has been reached, else the older one.
  let transferFeePct = 0;
  if (ext.transferFeeConfig) {
    const t = ext.transferFeeConfig;
    const newer = t.newerTransferFee, older = t.olderTransferFee;
    let cur = older || newer || null;
    if (newer && epoch != null && epoch >= Number(newer.epoch)) cur = newer;
    else if (newer && epoch == null && !older) cur = newer;
    const bps = cur ? numOrNull(cur.transferFeeBasisPoints) : null;
    transferFeePct = bps != null && bps > 0 ? bps / 100 : 0;
  }
  if (transferFeePct > 0) add("transfer_fee", "block", `${pctText(transferFeePct)} transfer fee on every move — LPs pay it on deposit, withdraw and rebalance`);

  // Scaled-UI multiplier — new multiplier once its effective timestamp has passed.
  let displayMultiplier = 1;
  if (ext.scaledUiAmountConfig) {
    const s = ext.scaledUiAmountConfig;
    const eff = numOrNull(s.newMultiplierEffectiveTimestamp);
    const useNew = s.newMultiplier != null && eff != null && nowSec >= eff;
    const m = numOrNull(useNew ? s.newMultiplier : s.multiplier);
    if (m != null && m > 0) displayMultiplier = m;
  }
  // A real rescale (5×) is a warn. A sub-1% drift (xStocks accrue a ~1.0017× multiplier as dividends
  // are reinvested) is still shown, but as info — it will not throw a UI off by a visible amount.
  if (displayMultiplier !== 1) add("display_multiplier", Math.abs(displayMultiplier - 1) >= SMALL_MULTIPLIER ? "warn" : "info", `${multText(displayMultiplier)} display multiplier — UIs may show prices off by ${multText(displayMultiplier)}; verify bins before depositing`);

  // Issuer powers.
  const permanentDelegate = ext.permanentDelegate ? (ext.permanentDelegate.delegate || null) : null;
  if (permanentDelegate) add("permanent_delegate", "warn", "issuer can move tokens out of any account (permanent delegate)");
  const pausable = !!ext.pausableConfig;
  const paused = !!(ext.pausableConfig && ext.pausableConfig.paused);
  if (paused) add("paused", "block", "transfers are PAUSED right now — the issuer has halted this token");
  else if (pausable) add("pausable", "warn", "issuer can pause all transfers");

  // Transfer hook: only a non-null programId is an active hook.
  let transferHook = null;
  if (ext.transferHook) {
    const pid = ext.transferHook.programId || null;
    if (pid) { transferHook = { programId: pid, authority: ext.transferHook.authority || null }; add("transfer_hook", "warn", `a transfer hook program (${pid.slice(0, 4)}…) runs on every move and can block or alter it`); }
    else if (ext.transferHook.authority) add("hook_authority", "info", "hook authority set (no hook program active now)");
  }

  const defaultFrozen = !!(ext.defaultAccountState && String(ext.defaultAccountState.accountState || "").toLowerCase() === "frozen");
  if (defaultFrozen) add("default_frozen", "warn", "new token accounts start frozen — the issuer must thaw each one");

  const freezeAuthority = info.freezeAuthority || null;
  const mintAuthority = info.mintAuthority || null;
  if (freezeAuthority) add("freeze_authority", "info", "freeze authority set — issuer can freeze token accounts (routine for issued assets like USDC)");
  if (mintAuthority && !issued) add("mint_authority", "info", "mint authority set — supply can still be increased");

  // Jupiter view: pre-IPO wrappers + verification.
  const tags = jup && Array.isArray(jup.tags) ? jup.tags.map((t) => String(t).toLowerCase()) : [];
  const temporary = !!(jup && (tags.includes("prestocks") || /prestocks/i.test(String(jup.name || ""))));
  if (temporary) add("temporary", "warn", "Pre-IPO wrapper — may convert or expire; read the issuer's token page before LPing");
  let verified = null;
  if (jup === null) verified = false;
  else if (jup) verified = jup.isVerified === true;
  if (verified === false) add("unverified", "warn", "not Jupiter-verified — check it is not a copycat mint");
  else if (jup === undefined) add("jupiter_unknown", "warn", "could not check Jupiter verification — check it is not a copycat mint");

  return {
    program, transferFeePct, displayMultiplier, permanentDelegate, pausable, paused, transferHook,
    freezeAuthority, mintAuthority, defaultFrozen, temporary, verified,
    flags: sortFlags(flags),
  };
}

// ── fetcher ─────────────────────────────────────────────────────────────────────────
const RISK_TTL = 3600e3, UNKNOWN_TTL = 60e3, EPOCH_TTL = 600e3, POOL_TTL = 3600e3;
const _riskCache = new Map(); // mint -> { v, ts, ttl }
const _inflight = new Map();
let _epoch = null;            // { epoch, ts }
const _poolCache = new Map(); // pool -> { v, ts }

const UNKNOWN_FLAG = { code: "unknown", level: "warn", text: "could not read token risk" };
const unknownRisk = () => ({ unknown: true, flags: [{ ...UNKNOWN_FLAG }] });

async function getEpoch(conn) {
  if (_epoch && Date.now() - _epoch.ts < EPOCH_TTL) return _epoch.epoch;
  const e = await conn.getEpochInfo();
  if (!e || !Number.isFinite(Number(e.epoch))) throw new Error("no epoch");
  _epoch = { epoch: Number(e.epoch), ts: Date.now() };
  return _epoch.epoch;
}

// undefined = lookup failed, null = Jupiter has no row, object = the row.
async function jupLookup(mint) {
  try {
    const key = process.env.JUPITER_API_KEY || "";
    const r = await fetch(`${key ? "https://api.jup.ag" : "https://lite-api.jup.ag"}/tokens/v2/search?query=${encodeURIComponent(mint)}`,
      { headers: key ? { "x-api-key": key } : {}, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return undefined;
    const j = await r.json();
    const arr = Array.isArray(j) ? j : (j.tokens || j.data || []);
    return arr.find((t) => t && t.id === mint) || null;
  } catch (_) { return undefined; }
}

async function readTokenRisk(mint) {
  try {
    const { PublicKey } = require("@solana/web3.js");
    const { connection } = require("./rpc");
    const conn = connection();
    const pk = new PublicKey(mint); // throws on junk -> unknown
    const [acct, jup] = await Promise.all([conn.getParsedAccountInfo(pk), jupLookup(mint)]);
    const value = acct && acct.value;
    const parsed = value && value.data && value.data.parsed;
    if (!parsed || parsed.type !== "mint") return unknownRisk();
    let epoch = null;
    try { epoch = await getEpoch(conn); } catch (_) { epoch = null; }
    const owner = value.owner && value.owner.toString ? value.owner.toString() : String(value.owner || "");
    const out = classifyMint(parsed.info, owner, { jupToken: jup, epoch, nowSec: Math.floor(Date.now() / 1000), mint });
    // Token-2022 fee schedule with an unreadable epoch: we picked the older fee — say so.
    if (epoch == null && parsed.info && extMap(parsed.info).transferFeeConfig) {
      out.flags.push({ code: "epoch_unknown", level: "warn", text: "could not read the current epoch — the transfer-fee figure may be out of date" });
      out.flags = sortFlags(out.flags);
    }
    return out;
  } catch (_) { return unknownRisk(); }
}

// Cached (1h; failures 60s), in-flight de-duped, never throws.
async function tokenRisk(mint) {
  const m = String(mint || "");
  const c = _riskCache.get(m);
  if (c && Date.now() - c.ts < c.ttl) return c.v;
  if (_inflight.has(m)) return _inflight.get(m);
  const p = (async () => {
    let v;
    try { v = await readTokenRisk(m); } catch (_) { v = unknownRisk(); }
    _riskCache.set(m, { v, ts: Date.now(), ttl: v.unknown ? UNKNOWN_TTL : RISK_TTL });
    return v;
  })().finally(() => _inflight.delete(m));
  _inflight.set(m, p);
  return p;
}

// Pool-level flags. Meteora DLMM: fee collect mode from the public datapi (1 = quote only).
async function poolRisk(pool) {
  const empty = { flags: [] };
  try {
    if (!pool || pool.dex !== "meteora" || !pool.address) return empty;
    const c = _poolCache.get(pool.address);
    if (c && Date.now() - c.ts < POOL_TTL) return c.v;
    const r = await fetch(`https://dlmm.datapi.meteora.ag/pools/${encodeURIComponent(pool.address)}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return empty;
    const j = await r.json();
    const mode = j && j.pool_config ? numOrNull(j.pool_config.collect_fee_mode) : null;
    const flags = [];
    if (mode === 1) flags.push({ code: "fee_mode_quote", level: "info", text: "fees paid in quote token only" });
    else if (mode === 0) flags.push({ code: "fee_mode_input", level: "info", text: "fees paid in the token sold in" });
    const v = { collectFeeMode: mode, flags };
    _poolCache.set(pool.address, { v, ts: Date.now() });
    return v;
  } catch (_) { return empty; }
}

// ── scanner glue ────────────────────────────────────────────────────────────────────
async function limitMap(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

// scope = 'tokenA' | 'tokenB' | 'pool'; symbol/mint let the page say WHICH token a flag is about.
function mergeFlags(risk, meta = {}) {
  const out = [];
  const push = (scope, r, symbol, mint) => { for (const f of ((r && r.flags) || [])) out.push({ ...f, scope, symbol: symbol || null, mint: mint || null }); };
  push("tokenA", risk.tokenA, meta.symA, meta.mintA);
  push("tokenB", risk.tokenB, meta.symB, meta.mintB);
  push("pool", risk.pool, null, null);
  return sortFlags(out);
}

// Adds `risk` + `flags` to every pool row ({baseMint, quoteMint, baseSym, quoteSym, dex, address}).
// Never throws — worst case the rows carry the `unknown` flag.
async function attachRisk(pools) {
  try {
    const mints = [...new Set(pools.flatMap((p) => [p.baseMint, p.quoteMint]).filter(Boolean))];
    const byMint = new Map();
    await limitMap(mints, 3, async (m) => { byMint.set(m, await tokenRisk(m)); });
    const poolRes = await limitMap(pools, 3, (p) => poolRisk(p));
    pools.forEach((p, i) => {
      p.risk = { tokenA: byMint.get(p.baseMint) || unknownRisk(), tokenB: byMint.get(p.quoteMint) || unknownRisk(), pool: poolRes[i] || { flags: [] } };
      p.flags = mergeFlags(p.risk, { symA: p.baseSym, symB: p.quoteSym, mintA: p.baseMint, mintB: p.quoteMint });
    });
  } catch (_) {
    for (const p of pools) if (!p.risk) { p.risk = { tokenA: unknownRisk(), tokenB: unknownRisk(), pool: { flags: [] } }; p.flags = mergeFlags(p.risk); }
  }
  return pools;
}

// Rows with any `block` flag leave the ranked list (default) and go to `excluded` with the
// reason; includeRisky keeps them in place. Order of the input is preserved.
function partitionByRisk(pools, includeRisky) {
  if (includeRisky) return { ranked: pools.slice(), excluded: [] };
  const ranked = [], excluded = [];
  for (const p of pools) {
    const blocks = (p.flags || []).filter((f) => f.level === "block");
    if (!blocks.length) { ranked.push(p); continue; }
    const reason = blocks.map((f) => (f.symbol ? `${f.symbol}: ` : "") + f.text).join("; ");
    excluded.push({ ...p, excludedReason: reason });
  }
  return { ranked, excluded };
}

function _resetCachesForTest() { _riskCache.clear(); _inflight.clear(); _poolCache.clear(); _epoch = null; }

module.exports = { classifyMint, tokenRisk, poolRisk, attachRisk, mergeFlags, partitionByRisk, TOKEN_PROGRAM, TOKEN_2022_PROGRAM, _resetCachesForTest };
