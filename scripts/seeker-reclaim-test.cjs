#!/usr/bin/env node
"use strict";
// Rent Reclaim — READ SIDE (Seeker app increment 2, docs/SEEKER_APP_PLAN.md). Pins lib/rent-
// reclaim.js (GET /api/seeker/reclaimable's engine) against the exact failure modes CLAUDE.md
// flags as recurring in this repo:
//
//   (a) BOTH token programs (SPL Token + Token-2022) are actually enumerated, not just one;
//   (b) an account holding a balance is NEVER classified reclaimable, however it's queried;
//   (c) wrapped SOL is refused outright — zero balance or not, it is never "reclaimable";
//   (d) the reported rent total matches an INDEPENDENT re-derivation (sum the fixture's own
//       lamports, don't trust the module's arithmetic to check itself);
//   (e) an RPC failure — a network error, a non-OK HTTP status, or a JSON-RPC-level error field —
//       surfaces as a thrown error (server.js turns that into "unavailable"), NEVER as an empty
//       or zero-total success. This is CLAUDE.md's "RPC failure must read as unavailable, never
//       as zero" rule, and it fires for a failure on EITHER program, not just the first;
//   (f) more accounts than the cap are flagged `truncated`, never silently cut;
//   (g) the 16 new i18n keys this increment added exist, byte-for-byte, in all six curated
//       dictionaries, and are excluded from the google/ios store-edition dictionary copy;
//   (h) the new interactive controls (Reclaim, Rescan/Try again) meet the >=44px tap-target floor
//       the same way scripts/seeker-build-test.cjs already checks the increment-1 controls.
//
// Dependency-free: stubs global.fetch (same technique as scripts/giveaway-holdcheck-test.cjs) —
// no live RPC call is made in CI.
//
// Usage: node scripts/seeker-reclaim-test.cjs

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const REAL_FETCH = global.fetch; // the sections above stub global.fetch; the route-wiring smoke
                                  // check at the bottom talks to a REAL local server and must not
                                  // inherit whichever stub the last unit-test section installed.
let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (detail ? "\n      " + (typeof detail === "string" ? detail : JSON.stringify(detail)) : "")); }
};

// Deterministic single-endpoint RPC (the public fallback) regardless of the host env — the fixture
// dispatches on JSON-RPC method + params, never on which URL was called, so this is robust either
// way, but a clean slate makes failures easier to reason about.
delete process.env.HELIUS_API_KEY;
delete process.env.HELIUS_API_KEY_2;
delete process.env.FALLBACK_RPC_URL;
// A stray require touching kvstore (lib/rpc's lazy helius-usage attribution) would otherwise read
// the real DATA_DIR default — point it at a throwaway dir instead (same posture as
// scripts/giveaway-holdcheck-test.cjs).
process.env.DATA_DIR = fs.mkdtempSync(path.join(require("os").tmpdir(), "seeker-reclaim-test-"));

const { TOKEN_PROGRAMS } = require(path.join(ROOT, "lib", "solana-addr"));
const [PROG_LEGACY, PROG_2022] = [...TOKEN_PROGRAMS];
const WSOL_MINT = "So11111111111111111111111111111111111111112";
const WALLET = "FAKEWALLET111111111111111111111111111111111";

function tokenAccount(pubkey, mint, uiAmount, decimals, lamports) {
  return {
    pubkey,
    account: {
      lamports,
      data: { parsed: { info: { mint, tokenAmount: { uiAmount, decimals, amount: String(Math.round(uiAmount * Math.pow(10, decimals))) } } } },
    },
  };
}

function rpcOk(list) {
  return { ok: true, status: 200, json: async () => ({ jsonrpc: "2.0", result: { value: list } }) };
}

(async () => {
  // ══════════════════════════════════════════════════════════════════════════════════════════
  // (a)-(d) a normal scan: both programs, correct classification, total re-derived independently
  // ══════════════════════════════════════════════════════════════════════════════════════════
  console.log("\n(a)-(d) a normal scan — both programs, honest classification, independent total\n");
  {
    const calls = [];
    const FIXTURE = {
      [PROG_LEGACY]: [
        tokenAccount("ACC_RECLAIMABLE_1", "MintDeadAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", 0, 6, 2039280),
        tokenAccount("ACC_HOLDS_1", "MintHeldBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB", 5, 6, 2039280),
        tokenAccount("ACC_WSOL_EMPTY", WSOL_MINT, 0, 9, 2039280),
        tokenAccount("ACC_WSOL_FUNDED", WSOL_MINT, 1.5, 9, 2039280),
      ],
      [PROG_2022]: [
        tokenAccount("ACC_RECLAIMABLE_2022", "MintDead2022CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC", 0, 6, 2135000),
      ],
    };
    global.fetch = async (url, init) => {
      const body = JSON.parse(init.body);
      calls.push(body.params[1].programId);
      return rpcOk(FIXTURE[body.params[1].programId] || []);
    };
    delete require.cache[require.resolve(path.join(ROOT, "lib", "rent-reclaim"))];
    delete require.cache[require.resolve(path.join(ROOT, "lib", "rpc"))];
    const { scanReclaimable } = require(path.join(ROOT, "lib", "rent-reclaim"));

    const res = await scanReclaimable(WALLET);

    // (a) both token programs enumerated — not just one.
    ok("(a) SPL Token program was queried", calls.includes(PROG_LEGACY), calls);
    ok("(a) Token-2022 program was queried", calls.includes(PROG_2022), calls);
    ok("(a) exactly one call per program (no accidental re-fetch)", calls.length === 2, calls);

    const byAcc = {}; for (const a of res.accounts) byAcc[a.tokenAccount] = a;

    // (b) an account holding a balance is never reclaimable.
    ok("(b) an account holding a balance is classified holds_balance, not reclaimable", byAcc.ACC_HOLDS_1.status === "holds_balance", byAcc.ACC_HOLDS_1);
    ok("(b) its lamports are excluded from the reclaimable total", res.totalReclaimableLamports < byAcc.ACC_HOLDS_1.lamports + byAcc.ACC_RECLAIMABLE_1.lamports + byAcc.ACC_RECLAIMABLE_2022.lamports);

    // (c) wrapped SOL refused — regardless of balance.
    ok("(c) empty wrapped SOL is refused, not reclaimable", byAcc.ACC_WSOL_EMPTY.status === "refused", byAcc.ACC_WSOL_EMPTY);
    ok("(c) funded wrapped SOL is also refused", byAcc.ACC_WSOL_FUNDED.status === "refused", byAcc.ACC_WSOL_FUNDED);
    ok("(c) refused accounts carry a reason mentioning wrapped SOL", /wrapped sol/i.test(byAcc.ACC_WSOL_EMPTY.reason || ""), byAcc.ACC_WSOL_EMPTY.reason);

    // Real reclaimable accounts, from BOTH programs, are correctly flagged.
    ok("(a)/(b) the SPL Token dead account is reclaimable", byAcc.ACC_RECLAIMABLE_1.status === "reclaimable");
    ok("(a)/(b) the Token-2022 dead account is reclaimable too", byAcc.ACC_RECLAIMABLE_2022.status === "reclaimable");

    // (d) the reported total matches an INDEPENDENT re-derivation — sum the fixture ourselves.
    const independentTotal = FIXTURE[PROG_LEGACY].concat(FIXTURE[PROG_2022])
      .filter((a) => a.account.data.parsed.info.mint !== WSOL_MINT && a.account.data.parsed.info.tokenAmount.uiAmount === 0)
      .reduce((s, a) => s + a.account.lamports, 0);
    ok("(d) totalReclaimableLamports matches an independent re-derivation of the fixture", res.totalReclaimableLamports === independentTotal, `got ${res.totalReclaimableLamports}, expected ${independentTotal}`);
    ok("(d) totalReclaimableSol is lamports/1e9", Math.abs(res.totalReclaimableSol - independentTotal / 1e9) < 1e-12);
    ok("(d) never truncated for a small wallet", res.truncated === false);
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // (e) RPC failure -> throws (server.js maps this to "unavailable"), never an empty/zero result
  // ══════════════════════════════════════════════════════════════════════════════════════════
  console.log("\n(e) RPC failure surfaces as a failure, never as an empty/zero result\n");
  async function expectThrow(label, fetchImpl) {
    global.fetch = fetchImpl;
    delete require.cache[require.resolve(path.join(ROOT, "lib", "rent-reclaim"))];
    delete require.cache[require.resolve(path.join(ROOT, "lib", "rpc"))];
    const { scanReclaimable } = require(path.join(ROOT, "lib", "rent-reclaim"));
    let threw = false;
    try { await scanReclaimable(WALLET); } catch (_) { threw = true; }
    ok(label, threw);
  }
  await expectThrow("(e) a network error on the FIRST program's call aborts the whole read", async () => { throw new Error("ECONNRESET"); });
  await expectThrow("(e) a network error on the SECOND program's call aborts the whole read (not treated as 'that program has zero accounts')", async (url, init) => {
    const body = JSON.parse(init.body);
    if (body.params[1].programId === PROG_LEGACY) return rpcOk([tokenAccount("X", "MintXAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", 0, 6, 2039280)]);
    throw new Error("timeout");
  });
  await expectThrow("(e) a non-OK HTTP status aborts the read", async () => ({ ok: false, status: 500, json: async () => ({}) }));
  await expectThrow("(e) a clean 200 carrying a JSON-RPC-level error aborts the read (never silently -> [])", async () => ({ ok: true, status: 200, json: async () => ({ jsonrpc: "2.0", error: { code: -32000, message: "rate limited" } }) }));

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // (f) truncation is flagged, never a silent cut
  // ══════════════════════════════════════════════════════════════════════════════════════════
  console.log("\n(f) more accounts than the cap -> truncated:true, never a silent cut\n");
  {
    const { MAX_ACCOUNTS } = require(path.join(ROOT, "lib", "rent-reclaim"));
    const BIG = MAX_ACCOUNTS + 37;
    const many = [];
    for (let i = 0; i < BIG; i++) many.push(tokenAccount("ACC" + i, "Mint" + i + "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA".slice(0, 40 - String(i).length), 0, 6, 2039280));
    global.fetch = async (url, init) => {
      const body = JSON.parse(init.body);
      return rpcOk(body.params[1].programId === PROG_LEGACY ? many : []);
    };
    delete require.cache[require.resolve(path.join(ROOT, "lib", "rent-reclaim"))];
    delete require.cache[require.resolve(path.join(ROOT, "lib", "rpc"))];
    const { scanReclaimable } = require(path.join(ROOT, "lib", "rent-reclaim"));
    const res = await scanReclaimable(WALLET);
    ok("(f) truncated is flagged true", res.truncated === true);
    ok("(f) accountsExamined is capped at MAX_ACCOUNTS", res.accountsExamined === MAX_ACCOUNTS, res.accountsExamined);
    ok("(f) accountsTotal reports the real (uncapped) count — the cut is visible, not silent", res.accountsTotal === BIG, res.accountsTotal);
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // (g) i18n — the 16 new keys, byte-exact, in all six dictionaries; excluded from google/ios
  // ══════════════════════════════════════════════════════════════════════════════════════════
  console.log("\n(g) i18n — the 16 new keys in all six dictionaries, excluded from google/ios\n");
  const NEW_KEYS = [
    "Connect your wallet to scan for reclaimable rent.",
    "Scanning your wallet…",
    "Could not read the chain right now. Try again shortly.",
    "Try again",
    "Total reclaimable",
    "More accounts exist in this wallet than are shown here.",
    "Reclaim",
    "Signing is coming in the next build.",
    "Reclaimable",
    "No reclaimable rent found in this wallet right now.",
    "Holds a balance",
    "Refused",
    "Rescan",
    "No balance — safe to close.",
    "Still holds tokens — won't be closed.",
    "Wrapped SOL — not handled here.",
  ];
  // These must be the exact literals RentReclaim.jsx passes to t(...) — extracted independently
  // here (a plain t("...") call regex) rather than just re-typing NEW_KEYS a second time, so a
  // key renamed in the component without updating this list, or vice versa, shows up as a gap.
  const jsxSrc = fs.readFileSync(path.join(ROOT, "src", "seeker", "RentReclaim.jsx"), "utf8");
  const extracted = new Set();
  {
    const re = /\bt\(\s*(['"])((?:\\.|(?!\1)[\s\S])*)\1/g;
    let m;
    while ((m = re.exec(jsxSrc))) extracted.add(m[2].replace(/\\(['"\\])/g, "$1"));
  }
  extracted.delete("Rent Reclaim"); // already an increment-1 key, not new here
  const extractedList = [...extracted].sort();
  ok("the literal t(...) calls extracted from RentReclaim.jsx match this test's NEW_KEYS list exactly",
    JSON.stringify(extractedList) === JSON.stringify([...NEW_KEYS].sort()),
    { extractedOnly: extractedList.filter((k) => !NEW_KEYS.includes(k)), listOnly: NEW_KEYS.filter((k) => !extracted.has(k)) });

  for (const lang of ["es", "zh", "hi", "it", "pt", "vi"]) {
    const dict = JSON.parse(fs.readFileSync(path.join(ROOT, "public", "i18n", `${lang}.json`), "utf8"));
    const missing = NEW_KEYS.filter((k) => !Object.prototype.hasOwnProperty.call(dict, k));
    ok(`${lang}.json carries all 16 new keys`, missing.length === 0, missing);
  }
  {
    const storeCfg = JSON.parse(fs.readFileSync(path.join(ROOT, "store-edition", "store-edition.json"), "utf8"));
    const missing = NEW_KEYS.filter((k) => !(storeCfg.excludeKeys || []).includes(k));
    ok("store-edition.json excludes every new key from the google/ios dictionary copy", missing.length === 0, missing);
  }
  try {
    require("child_process").execFileSync(process.execPath, [path.join(ROOT, "scripts", "i18n-audit.cjs")], { cwd: ROOT, stdio: "pipe" });
    ok("node scripts/i18n-audit.cjs exits 0 (no gating findings)", true);
  } catch (e) {
    ok("node scripts/i18n-audit.cjs exits 0 (no gating findings)", false, (e && e.stdout && e.stdout.toString().slice(-2000)) || String(e));
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // (h) tap targets — the new Reclaim / Rescan / Try-again controls meet the >=44px floor
  // ══════════════════════════════════════════════════════════════════════════════════════════
  console.log("\n(h) new interactive controls meet the >=44px tap-target floor\n");
  {
    const css = fs.readFileSync(path.join(ROOT, "src", "seeker", "seeker.css"), "utf8");
    function floorPx(selector, prop) {
      const block = new RegExp(selector.replace(/[.#]/g, "\\$&") + "\\s*\\{([^}]*)\\}").exec(css);
      if (!block) return null;
      const m = new RegExp(prop + ":\\s*(\\d+)px").exec(block[1]);
      return m ? Number(m[1]) : null;
    }
    for (const [selector, label] of [[".seeker-reclaim-btn", "Reclaim button (disabled)"], [".seeker-reclaim-retrybtn", "Rescan / Try again button"]]) {
      const h = floorPx(selector, "min-height");
      ok(`${label} (${selector}) declares min-height >= 44px`, h !== null && h >= 44, `min-height:${h}px`);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // wiring sanity: the HTTP route validates its input before touching the network at all
  // ══════════════════════════════════════════════════════════════════════════════════════════
  console.log("\nroute wiring — GET /api/seeker/reclaimable validates input before any RPC call\n");
  global.fetch = REAL_FETCH;
  {
    const { spawn } = require("child_process");
    const os = require("os");
    const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "seeker-reclaim-route-"));
    const PORT = Number(process.env.SEEKER_RECLAIM_TEST_PORT || 3606);
    const env = {
      ...process.env, PORT: String(PORT), DATA_DIR: DIR, TOOLGATE_OFF: "1",
      TELEGRAM_BOT_TOKEN: "", TELEGRAM_CHAT_ID: "", HELIUS_API_KEY: "",
      MM_OPERATOR_SECRET: "", MM_OPERATOR_SECRET_TREASURY: "",
    };
    const srv = spawn(process.execPath, ["server.js"], { cwd: ROOT, env, stdio: "ignore" });
    let up = false;
    for (let i = 0; i < 80; i++) {
      try { const r = await fetch(`http://127.0.0.1:${PORT}/healthz`); if (r.ok) { up = true; break; } } catch (_) {}
      await new Promise((r) => setTimeout(r, 500));
    }
    if (up) {
      const bad = await fetch(`http://127.0.0.1:${PORT}/api/seeker/reclaimable?wallet=not-a-real-address`);
      ok("GET with an invalid wallet -> 400, no RPC call attempted", bad.status === 400);
      const badBody = await bad.json();
      ok("400 response is an honest error, not a fabricated result", badBody.success === false && !("accounts" in badBody));
      const rm = await fetch(`http://127.0.0.1:${PORT}/rent-math.js`);
      ok("GET /rent-math.js -> 200 (no-build boot, per CLAUDE.md's public/ static-route trap)", rm.status === 200);
      const rmText = await rm.text();
      ok("/rent-math.js serves the shared module (declares CluckRentMath)", /CluckRentMath/.test(rmText));
    } else {
      ok("server came up for the route-wiring smoke check", false, "server did not start within timeout");
    }
    try { srv.kill("SIGKILL"); } catch (_) {}
    try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (_) {}
  }

  console.log(fail ? `\n${fail} FAILED (${pass} passed)` : `\nall passed (${pass} passed)`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("FAILED:", (e && e.stack) || e); process.exit(1); });
