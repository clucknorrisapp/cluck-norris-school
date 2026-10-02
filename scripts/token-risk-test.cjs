// Pure/offline test for lib/token-risk.js (LP scanner pre-flight flags). Fixtures are shaped like
// real jsonParsed mint accounts (the SPACEX PreStocks mint, read 2026-09-30). No network, no RPC.
const assert = require("assert");
const { classifyMint, tokenRisk, partitionByRisk, mergeFlags, TOKEN_2022_PROGRAM, TOKEN_PROGRAM } = require("../lib/token-risk");

let n = 0;
const t = (name, fn) => { fn(); n++; console.log("ok -", name); };
const codes = (r, level) => r.flags.filter((f) => !level || f.level === level).map((f) => f.code).sort();
const AUTH = "WV9PJN7XTmTLVwbutCLFxp8TyePee6Xq5mRq6Fti5Wc";

const spacexInfo = () => ({
  decimals: 9, isInitialized: true, freezeAuthority: AUTH, mintAuthority: AUTH, supply: "8742505094822",
  extensions: [
    { extension: "permanentDelegate", state: { delegate: AUTH } },
    { extension: "defaultAccountState", state: { accountState: "initialized" } },
    { extension: "transferFeeConfig", state: {
      newerTransferFee: { epoch: 1039, maximumFee: 18446744073709552000, transferFeeBasisPoints: 100 },
      olderTransferFee: { epoch: 1032, maximumFee: 18446744073709552000, transferFeeBasisPoints: 50 },
      transferFeeConfigAuthority: AUTH, withdrawWithheldAuthority: AUTH, withheldAmount: 59594974 } },
    { extension: "transferHook", state: { authority: AUTH, programId: null } },
    { extension: "scaledUiAmountConfig", state: { authority: AUTH, multiplier: "1", newMultiplier: "5", newMultiplierEffectiveTimestamp: 1781065800 } },
    { extension: "pausableConfig", state: { authority: AUTH, paused: false } },
    { extension: "tokenMetadata", state: { name: "SpaceX PreStocks", symbol: "SPACEX" } },
  ],
});
const jupSpacex = { id: "PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh", name: "SpaceX PreStocks", isVerified: true, tags: ["equities", "prestocks", "token-2022", "verified"] };
const AFTER = 1781065800 + 86400;

// (a) SPACEX-like Token-2022 at epoch 1046, after the multiplier's effective time
t("a: SPACEX-like -> 1% fee block, 5x, delegate, pausable, temporary", () => {
  const r = classifyMint(spacexInfo(), TOKEN_2022_PROGRAM, { jupToken: jupSpacex, epoch: 1046, nowSec: AFTER });
  assert.strictEqual(r.program, "token2022");
  assert.strictEqual(r.transferFeePct, 1);
  assert.strictEqual(r.displayMultiplier, 5);
  assert.strictEqual(r.permanentDelegate, AUTH);
  assert.strictEqual(r.pausable, true);
  assert.strictEqual(r.paused, false);
  assert.strictEqual(r.temporary, true);
  assert.strictEqual(r.verified, true);
  assert.strictEqual(r.transferHook, null, "programId null is NOT an active hook");
  assert.strictEqual(r.defaultFrozen, false);
  assert.deepStrictEqual(codes(r, "block"), ["transfer_fee"]);
  assert.deepStrictEqual(codes(r, "warn"), ["display_multiplier", "pausable", "permanent_delegate", "temporary"]);
  assert.ok(codes(r, "info").includes("hook_authority") && codes(r, "info").includes("freeze_authority") && codes(r, "info").includes("mint_authority"));
  assert.ok(/1% transfer fee on every move/.test(r.flags.find((f) => f.code === "transfer_fee").text));
  assert.ok(/5× display multiplier/.test(r.flags.find((f) => f.code === "display_multiplier").text));
  assert.ok(/Pre-IPO wrapper/.test(r.flags.find((f) => f.code === "temporary").text));
  assert.strictEqual(r.flags[0].level, "block", "block flags sort first");
});
t("a2: parsed wrapper ({type:'mint', info}) is accepted too", () => {
  const r = classifyMint({ type: "mint", info: spacexInfo() }, TOKEN_2022_PROGRAM, { jupToken: jupSpacex, epoch: 1046, nowSec: AFTER });
  assert.strictEqual(r.transferFeePct, 1);
});
t("a3: multiplier not yet effective -> old multiplier (1x, no flag)", () => {
  const r = classifyMint(spacexInfo(), TOKEN_2022_PROGRAM, { jupToken: jupSpacex, epoch: 1046, nowSec: 1781065800 - 10 });
  assert.strictEqual(r.displayMultiplier, 1);
  assert.ok(!codes(r).includes("display_multiplier"));
});
t("a3b: a sub-1% multiplier drift (xStocks-style 1.0017x) is info, not warn", () => {
  const info = spacexInfo();
  const sc = info.extensions.find((e) => e.extension === "scaledUiAmountConfig").state;
  sc.newMultiplier = "1.001701196801074";
  const r = classifyMint(info, TOKEN_2022_PROGRAM, { jupToken: jupSpacex, epoch: 1046, nowSec: AFTER });
  assert.ok(Math.abs(r.displayMultiplier - 1.0017) < 1e-4);
  assert.strictEqual(r.flags.find((f) => f.code === "display_multiplier").level, "info");
});
t("a4: an active transfer hook (programId set) is a warn", () => {
  const info = spacexInfo();
  info.extensions.find((e) => e.extension === "transferHook").state.programId = "HookProg1111111111111111111111111111111111";
  const r = classifyMint(info, TOKEN_2022_PROGRAM, { jupToken: jupSpacex, epoch: 1046, nowSec: AFTER });
  assert.ok(r.transferHook && r.transferHook.programId);
  assert.ok(codes(r, "warn").includes("transfer_hook"));
});
t("a5: currently paused -> block; default-frozen -> warn", () => {
  const info = spacexInfo();
  info.extensions.find((e) => e.extension === "pausableConfig").state.paused = true;
  info.extensions.find((e) => e.extension === "defaultAccountState").state.accountState = "frozen";
  const r = classifyMint(info, TOKEN_2022_PROGRAM, { jupToken: jupSpacex, epoch: 1046, nowSec: AFTER });
  assert.strictEqual(r.paused, true);
  assert.ok(codes(r, "block").includes("paused"));
  assert.ok(codes(r, "warn").includes("default_frozen"));
});

// (b) same mint, epoch 1035 -> the OLDER 50 bps (0.5%) fee still applies
t("b: epoch 1035 -> older fee 0.5%", () => {
  const r = classifyMint(spacexInfo(), TOKEN_2022_PROGRAM, { jupToken: jupSpacex, epoch: 1035, nowSec: AFTER });
  assert.strictEqual(r.transferFeePct, 0.5);
  assert.ok(/^0\.5% transfer fee/.test(r.flags.find((f) => f.code === "transfer_fee").text));
  assert.deepStrictEqual(codes(r, "block"), ["transfer_fee"]);
});
t("b2: epoch exactly at the newer epoch -> newer fee", () => {
  assert.strictEqual(classifyMint(spacexInfo(), TOKEN_2022_PROGRAM, { jupToken: jupSpacex, epoch: 1039, nowSec: AFTER }).transferFeePct, 1);
  assert.strictEqual(classifyMint(spacexInfo(), TOKEN_2022_PROGRAM, { jupToken: jupSpacex, epoch: 1038, nowSec: AFTER }).transferFeePct, 0.5);
});
t("b3: 3% fee, and a 0 bps config is NOT a block", () => {
  const info = spacexInfo();
  const tf = info.extensions.find((e) => e.extension === "transferFeeConfig").state;
  tf.newerTransferFee.transferFeeBasisPoints = 300;
  assert.strictEqual(classifyMint(info, TOKEN_2022_PROGRAM, { jupToken: jupSpacex, epoch: 1046, nowSec: AFTER }).transferFeePct, 3);
  tf.newerTransferFee.transferFeeBasisPoints = 0;
  const r = classifyMint(info, TOKEN_2022_PROGRAM, { jupToken: jupSpacex, epoch: 1046, nowSec: AFTER });
  assert.strictEqual(r.transferFeePct, 0);
  assert.ok(!codes(r, "block").length);
});

// (c) plain SPL, JUP-like
t("c: plain SPL (JUP-like) -> no block/warn flags", () => {
  const info = { decimals: 6, isInitialized: true, freezeAuthority: null, mintAuthority: null, supply: "6861486429169975", extensions: undefined };
  const r = classifyMint(info, TOKEN_PROGRAM, { jupToken: { id: "JUP", isVerified: true, tags: ["verified", "strict"] }, epoch: 1046, nowSec: AFTER, mint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN" });
  assert.strictEqual(r.program, "spl");
  assert.strictEqual(r.transferFeePct, 0);
  assert.strictEqual(r.displayMultiplier, 1);
  assert.strictEqual(r.verified, true);
  assert.deepStrictEqual(r.flags, []);
});

// (d) USDC-like: freeze authority (+ mint authority) is normal for an issued asset -> info only
t("d: USDC-like with freeze authority -> info only", () => {
  const info = { decimals: 6, isInitialized: true, freezeAuthority: "7dGbd2QZcCKcTndnHcTL8q7SMVXAkp688NTQYwrRCrar", mintAuthority: "BJE5MMbqXjVwjAF7oxwPYXnTXDyspzZyt4vwenNw5ruG", supply: "1" };
  const r = classifyMint(info, TOKEN_PROGRAM, { jupToken: { id: "USDC", isVerified: true, tags: ["verified"] }, epoch: 1046, nowSec: AFTER, mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" });
  assert.deepStrictEqual(codes(r, "block"), []);
  assert.deepStrictEqual(codes(r, "warn"), []);
  assert.deepStrictEqual(codes(r, "info"), ["freeze_authority"]);
});
t("d2: mint authority on a NON-stable is info", () => {
  const r = classifyMint({ freezeAuthority: null, mintAuthority: "Someone1111111111111111111111111111111111" }, TOKEN_PROGRAM, { jupToken: { isVerified: true, tags: [] }, epoch: 1, nowSec: AFTER, mint: "Random" });
  assert.deepStrictEqual(codes(r), ["mint_authority"]);
  assert.strictEqual(r.flags[0].level, "info");
});

// (e) unverified / lookalike / lookup failure
t("e: unverified lookalike -> warn", () => {
  const info = { decimals: 6, freezeAuthority: null, mintAuthority: null };
  const r = classifyMint(info, TOKEN_PROGRAM, { jupToken: { id: "Fake", name: "Jupiter", isVerified: false, tags: [] }, epoch: 1046, nowSec: AFTER });
  assert.strictEqual(r.verified, false);
  assert.deepStrictEqual(codes(r, "warn"), ["unverified"]);
  assert.ok(/not Jupiter-verified — check it is not a copycat mint/.test(r.flags[0].text));
  const none = classifyMint(info, TOKEN_PROGRAM, { jupToken: null, epoch: 1046, nowSec: AFTER });
  assert.strictEqual(none.verified, false, "Jupiter has no row at all -> unverified");
  assert.deepStrictEqual(codes(none, "warn"), ["unverified"]);
});
t("e2: Jupiter lookup FAILED (undefined) -> unknown verification, never 'verified'", () => {
  const r = classifyMint({ freezeAuthority: null, mintAuthority: null }, TOKEN_PROGRAM, { jupToken: undefined, epoch: 1046, nowSec: AFTER });
  assert.strictEqual(r.verified, null);
  assert.deepStrictEqual(codes(r, "warn"), ["jupiter_unknown"]);
});
t("e3: temporary via name only (no tag)", () => {
  const r = classifyMint({}, TOKEN_2022_PROGRAM, { jupToken: { name: "Anthropic PreStocks", isVerified: true, tags: [] }, epoch: 1, nowSec: AFTER });
  assert.strictEqual(r.temporary, true);
});

// (f) the ranking filter
t("f: blocked rows leave the ranking (-> excluded w/ reason); includeRisky puts them back", () => {
  const blockedTok = classifyMint(spacexInfo(), TOKEN_2022_PROGRAM, { jupToken: jupSpacex, epoch: 1046, nowSec: AFTER });
  const cleanTok = classifyMint({}, TOKEN_PROGRAM, { jupToken: { isVerified: true, tags: [] }, epoch: 1046, nowSec: AFTER });
  const mk = (address, tokenA, symA) => {
    const risk = { tokenA, tokenB: cleanTok, pool: { flags: [] } };
    return { address, dex: "meteora", baseSym: symA, quoteSym: "USDC", baseMint: "m1", quoteMint: "m2", risk, flags: mergeFlags(risk, { symA, symB: "USDC", mintA: "m1", mintB: "m2" }) };
  };
  const pools = [mk("P1", cleanTok, "JUP"), mk("P2", blockedTok, "SPACEX"), mk("P3", cleanTok, "JUP")];
  const def = partitionByRisk(pools, false);
  assert.deepStrictEqual(def.ranked.map((p) => p.address), ["P1", "P3"], "order preserved, blocked row removed");
  assert.deepStrictEqual(def.excluded.map((p) => p.address), ["P2"]);
  assert.ok(/SPACEX: 1% transfer fee/.test(def.excluded[0].excludedReason));
  const all = partitionByRisk(pools, true);
  assert.deepStrictEqual(all.ranked.map((p) => p.address), ["P1", "P2", "P3"]);
  assert.deepStrictEqual(all.excluded, []);
  // merged flags carry scope + symbol so the page can say WHICH token
  const f = pools[1].flags.find((x) => x.code === "transfer_fee");
  assert.strictEqual(f.scope, "tokenA");
  assert.strictEqual(f.symbol, "SPACEX");
});
t("f2: warn-only and unknown rows are NOT excluded (unknown is neither safe nor blocked)", () => {
  const unk = { unknown: true, flags: [{ code: "unknown", level: "warn", text: "could not read token risk" }] };
  const risk = { tokenA: unk, tokenB: unk, pool: { flags: [] } };
  const row = { address: "U", risk, flags: mergeFlags(risk, {}) };
  const r = partitionByRisk([row], false);
  assert.strictEqual(r.ranked.length, 1);
  assert.ok(row.flags.every((x) => x.level === "warn"));
});

// The fetcher never throws: an unreadable mint (here, not even base58 — fails before any network)
// is `unknown` with a warn flag; not safe, not blocked.
(async () => {
  const r = await tokenRisk("not-a-mint");
  assert.strictEqual(r.unknown, true);
  assert.deepStrictEqual(r.flags, [{ code: "unknown", level: "warn", text: "could not read token risk" }]);
  console.log("ok - tokenRisk on junk input -> unknown warn, no throw");
  n++;
  console.log(`\n${n} token-risk tests passed`);
})().catch((e) => { console.error(e); process.exit(1); });
