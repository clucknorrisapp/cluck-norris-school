// Engine decision simulator — replays thousands of ticks against lib/engine-decisions.js
// (zero deps, runs in the dependency-free CI job). Every scenario here is a regression that
// actually happened live on 2026-08-27/28, plus a fuzz that pins the global invariants. If a
// behavior change breaks a scenario, that is the simulator doing its job: change the spec test
// AND the code together, deliberately.
//
// ⚠️ WHAT THIS FILE ACTUALLY GUARDS (audit 2026-09-03 — say it plainly, because a green run
// here was being read as coverage it never had):
//   • Scenarios 4-5 (buyback) simulate PRODUCTION: lib/whirlpool-vault.js buyback() calls
//     buybackDecision(), so these gates are the live ones.
//   • Scenarios 1-3 (+ the roll half of the fuzz) simulate the rollGate SPEC, which NO
//     production code calls — the four sleeve ticks re-implement the roll gate inline and have
//     already drifted from it. They are kept because the spec is still the written contract for
//     that shape, but they prove nothing about a live roll on their own.
//   • Scenario 6 is a set of WIRING TRIPWIRES read out of the real source files: which sleeve
//     gates exist, and the confirm-timeout accounting on the swap paths. They are text pins,
//     NOT coverage of the money paths — a pin can only fail on a wholesale revert, and one of
//     the earlier pins was green against code that could never execute. Anything that can be
//     executed is executed in Scenario 7 instead.
//   • Scenario 7 CALLS THE REAL FUNCTIONS (needs node_modules): setConfig null-safety,
//     confirm-timeout tagging, transfer decimals, and the durable-config route. Each check
//     FAILS if its fix is reverted. It skips in the dependency-free CI job; the smoke-test job
//     re-runs this file after `npm ci` with ENGINE_SIM_REQUIRE_VAULT=1, which turns that skip
//     into a failure.
//   • NOT guarded, deliberately (2026-09-03): whether an open or a close actually LANDED. The
//     supply-based verification tried in this batch could not distinguish a mint that was never
//     created (every routine failed open) from an RPC that could not answer, so it was reverted
//     along with its pins. That audit finding is OPEN.
//
// Run: node scripts/engine-sim-test.cjs   (exit 0 = pass, 1 = fail)
const fs = require("fs");
const path = require("path");
const { buybackDecision, rollGate } = require("../lib/engine-decisions.js");

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`  ok  ${name}`); }
  else { failures++; console.error(`FAIL  ${name}${detail ? " — " + detail : ""}`); }
}

// Baseline config mirroring the live DNC posture (values from the deploy ratchet + defaults).
const CFG = {
  buybackEnabled: true, usdcFloor: 20, buybackReserveUsd: 0,
  maxBuybackUsdPerCycle: 50, minBuybackUsd: 5, maxBuybacksPerDay: 12, buybackMinIntervalSec: 900,
  swapSolFloor: 0.4, solGasReserve: 0.35, baseDeployThresholdUsd: 40,
  oorDwellSec: 300, minRebalanceIntervalSec: 1800, maxActionsPerDay: 36,
};
const PRICES = { solUsd: 110, jupUsd: 0.24 };
const TICK_MS = 90_000;
const DAY = "2026-08-28";

// ── Scenario 1: THE DECAY LOOP (live incident, ~30 wasted rolls in 20 min) ──────
// A deploy leaves ~5% leftovers on both sides. Leftovers above the bare threshold with
// pacing bypassed = roll every tick. The fix: only refills ≥2× threshold skip pacing.
{
  // Leftovers from a $200-per-side deploy: ~$10 staged + ~$10 pair — under threshold, never rolls.
  let rolls = 0, now = 0, lastRoll = 0;
  for (let t = 0; t < 200; t++) {
    now += TICK_MS;
    const g = rollGate({ cfg: CFG, nowMs: now, frac: 0.5, oorSince: null, sinceLastRollSec: (now - lastRoll) / 1000, dayActions: rolls, deployStagedUsd: 10, idlePairUsd: 10, widthOffPct: 0 });
    if (g.action === "roll") { rolls++; lastRoll = now; }
  }
  check("decay-loop: 5% leftovers never trigger a roll", rolls === 0, `${rolls} rolls`);

  // Leftovers between 1× and 2× threshold: allowed to deploy, but PACED — max 1 per interval.
  rolls = 0; now = 0; lastRoll = -CFG.minRebalanceIntervalSec * 1000;
  for (let t = 0; t < 400; t++) { // 10 hours of ticks
    now += TICK_MS;
    const g = rollGate({ cfg: CFG, nowMs: now, frac: 0.5, oorSince: null, sinceLastRollSec: (now - lastRoll) / 1000, dayActions: rolls, deployStagedUsd: 60, idlePairUsd: 60, widthOffPct: 0 });
    if (g.action === "roll") { rolls++; lastRoll = now; }
  }
  const maxPaced = Math.ceil((400 * TICK_MS) / (CFG.minRebalanceIntervalSec * 1000)) + 1;
  check("decay-loop: dribble refills are paced by anti-thrash", rolls <= maxPaced, `${rolls} rolls > ${maxPaced}`);

  // A genuine ≥2× refill (fresh buyback) deploys immediately despite the clock.
  const g = rollGate({ cfg: CFG, nowMs: 1_000_000, frac: 0.5, oorSince: null, sinceLastRollSec: 60, dayActions: 5, deployStagedUsd: 100, idlePairUsd: 90, widthOffPct: 0 });
  check("meaningful refill (≥2×) bypasses pacing", g.action === "roll" && g.urgent === true, g.action);
}

// ── Scenario 2: OOR DWELL — "out of range, wait 5 mins, fix it" ─────────────────
{
  // A wick that recrosses inside the dwell never rolls.
  let now = 0, oorSince = null, rolled = false;
  for (let t = 0; t < 3; t++) { // 3 ticks OOR = 270s < 300s dwell
    now += TICK_MS;
    const g = rollGate({ cfg: CFG, nowMs: now, frac: 1.2, oorSince, sinceLastRollSec: 9999, dayActions: 0, deployStagedUsd: 0, idlePairUsd: 0, widthOffPct: 0 });
    oorSince = g.oorSinceNext; if (g.action === "roll") rolled = true;
  }
  // back in range
  const back = rollGate({ cfg: CFG, nowMs: now + TICK_MS, frac: 0.5, oorSince, sinceLastRollSec: 9999, dayActions: 0, deployStagedUsd: 0, idlePairUsd: 0, widthOffPct: 0 });
  check("OOR wick inside dwell never rolls", !rolled && back.action === "hold" && back.oorSinceNext === null, `rolled=${rolled}`);

  // Sustained OOR rolls exactly once the dwell passes — even 60s after a previous roll.
  now = 0; oorSince = null; let rollAt = null;
  for (let t = 0; t < 10; t++) {
    now += TICK_MS;
    const g = rollGate({ cfg: CFG, nowMs: now, frac: -0.1, oorSince, sinceLastRollSec: 60, dayActions: 30, deployStagedUsd: 0, idlePairUsd: 0, widthOffPct: 0 });
    oorSince = g.oorSinceNext;
    if (g.action === "roll") { rollAt = now; break; }
  }
  check("sustained OOR fixes right after dwell, bypassing anti-thrash", rollAt !== null && (rollAt - TICK_MS) / 1000 >= CFG.oorDwellSec, `rollAt=${rollAt}`);
}

// ── Scenario 3: day-cap emergency ceiling ───────────────────────────────────────
{
  const routine = rollGate({ cfg: CFG, nowMs: 10_000_000, frac: 0.5, oorSince: null, sinceLastRollSec: 9999, dayActions: 36, deployStagedUsd: 60, idlePairUsd: 60, widthOffPct: 0 });
  check("routine roll stops at 1× day cap", routine.action === "capped", routine.action);
  const urgent = rollGate({ cfg: CFG, nowMs: 10_000_000, frac: 1.5, oorSince: 9_000_000, sinceLastRollSec: 9999, dayActions: 36, deployStagedUsd: 0, idlePairUsd: 0, widthOffPct: 0 });
  check("OOR fix admitted under 2× emergency ceiling", urgent.action === "roll", urgent.action);
  const beyond = rollGate({ cfg: CFG, nowMs: 10_000_000, frac: 1.5, oorSince: 9_000_000, sinceLastRollSec: 9999, dayActions: 72, deployStagedUsd: 0, idlePairUsd: 0, widthOffPct: 0 });
  check("nothing passes 2× ceiling", beyond.action === "capped", beyond.action);
}

// ── Scenario 4: buyback — demand override + multi-quote + caps (live incidents) ──
{
  // Starved (no idle token, staged quote) fires immediately inside the interval.
  const starved = buybackDecision({ cfg: CFG, st: { lastPrice: 0.00035, lastBuybackTs: 1_000_000, buybacksToday: 2, buybackDayStamp: DAY }, float: { usdc: 600, sol: 1, jup: 100, clkn: 100 }, prices: PRICES, nowMs: 1_000_000 + 120_000, todayStamp: DAY });
  check("starved buyback fires inside the interval", starved.action === "buy" && starved.starved === true, starved.action);

  // A fresh unspent buyback (idle token now large) defers until deployed + stripped.
  const fresh = buybackDecision({ cfg: CFG, st: { lastPrice: 0.00035, lastBuybackTs: 1_000_000, buybacksToday: 3, buybackDayStamp: DAY }, float: { usdc: 600, sol: 1, jup: 100, clkn: 150_000 }, prices: PRICES, nowMs: 1_000_000 + 120_000, todayStamp: DAY });
  check("unspent buyback kills the demand signal", fresh.action === "deferred", fresh.action);

  // THE STALL (live incident): USDC under floor+min, free SOL available → buys with SOL.
  const solBuy = buybackDecision({ cfg: CFG, st: { lastPrice: 0.00035, lastBuybackTs: 0, buybacksToday: 0, buybackDayStamp: DAY }, float: { usdc: 23, sol: 2.0, jup: 100, clkn: 100 }, prices: PRICES, nowMs: 10_000_000, todayStamp: DAY });
  check("multi-quote: USDC dry → spends free SOL", solBuy.action === "buy" && solBuy.fromSym === "SOL", `${solBuy.action}/${solBuy.fromSym}`);
  check("SOL spend respects BOTH gas guards", solBuy.spendUi <= 2.0 - CFG.swapSolFloor - CFG.solGasReserve + 1e-9, String(solBuy.spendUi));

  // USDC and SOL dry → JUP above dust reserve.
  const jupBuy = buybackDecision({ cfg: CFG, st: { lastPrice: 0.00035, lastBuybackTs: 0, buybacksToday: 0, buybackDayStamp: DAY }, float: { usdc: 22, sol: 0.7, jup: 1900, clkn: 0 }, prices: PRICES, nowMs: 10_000_000, todayStamp: DAY });
  check("multi-quote: SOL under guards → spends JUP", jupBuy.action === "buy" && jupBuy.fromSym === "JUP", `${jupBuy.action}/${jupBuy.fromSym}`);
  check("JUP spend leaves the dust reserve", jupBuy.spendUi <= 1900 - 50 + 1e-9, String(jupBuy.spendUi));
  check("per-cycle USD cap holds on non-USDC quotes", jupBuy.spendUsd <= CFG.maxBuybackUsdPerCycle + 1e-9, String(jupBuy.spendUsd));

  // Price feed down → USDC-only (never guesses units).
  const noPx = buybackDecision({ cfg: CFG, st: { lastPrice: 0.00035, lastBuybackTs: 0, buybacksToday: 0, buybackDayStamp: DAY }, float: { usdc: 22, sol: 5, jup: 5000, clkn: 0 }, prices: null, nowMs: 10_000_000, todayStamp: DAY });
  check("price feed down degrades to USDC-only", noPx.action === "none", noPx.action);

  // Day cap is absolute.
  const capped = buybackDecision({ cfg: CFG, st: { lastPrice: 0.00035, lastBuybackTs: 0, buybacksToday: 12, buybackDayStamp: DAY }, float: { usdc: 600, sol: 2, jup: 2000, clkn: 0 }, prices: PRICES, nowMs: 99_999_999, todayStamp: DAY });
  check("daily buyback cap is absolute", capped.action === "capped", capped.action);

  // THE BUYBACK DRAIN LOOP (live incident, 2026-08-28 evening): with floors near zero the
  // buyback converted every idle quote dollar to the project token each interval, so each
  // sleeve roll's freed quote was eaten before the reopen — the JUP pool bled $325→$183 in
  // 40 minutes while ~$280 of token sat staged unpaired. Ample idle token must skip the buy.
  const ample = buybackDecision({ cfg: CFG, st: { lastPrice: 0.00035, lastBuybackTs: 0, buybacksToday: 0, buybackDayStamp: DAY }, float: { usdc: 600, sol: 2, jup: 2000, clkn: 800_000 }, prices: PRICES, nowMs: 99_999_999, todayStamp: DAY });
  check("drain loop: ample idle token skips the buyback", ample.action === "none" && /ample/.test(ample.reason || ""), ample.action);
}

// ── Scenario 5: fuzz — 5,000 random ticks, global invariants ────────────────────
// Random walk of balances/price; assert bounded behavior no matter the sequence:
// buyback spend/day ≤ cap×perCycle, spends never breach floors/guards, rolls/day ≤ 2× cap.
{
  let seed = 42;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  let now = 0, st = { lastPrice: 0.00035, lastBuybackTs: 0, buybacksToday: 0, buybackDayStamp: DAY, paused: false };
  let float = { usdc: 400, sol: 2, jup: 1500, clkn: 50_000 };
  let spentToday = 0, buys = 0, violations = [];
  let rollState = { oorSince: null, lastRoll: 0, dayActions: 0 };
  for (let t = 0; t < 5000; t++) {
    now += TICK_MS;
    // market noise
    float.usdc = Math.max(0, float.usdc + (rnd() - 0.5) * 30);
    float.clkn = Math.max(0, float.clkn + (rnd() - 0.5) * 100_000);
    float.sol = Math.max(0, float.sol + (rnd() - 0.5) * 0.2);
    float.jup = Math.max(0, float.jup + (rnd() - 0.5) * 100);
    const d = buybackDecision({ cfg: CFG, st, float, prices: PRICES, nowMs: now, todayStamp: DAY });
    if (d.action === "buy") {
      buys++; spentToday += d.spendUsd;
      if (d.spendUsd > CFG.maxBuybackUsdPerCycle + 1e-6) violations.push(`cycle overspend ${d.spendUsd}`);
      if (d.fromSym === "USDC" && float.usdc - d.spendUi < CFG.usdcFloor - 1e-6) violations.push("usdcFloor breach");
      if (d.fromSym === "SOL" && float.sol - d.spendUi < CFG.swapSolFloor + CFG.solGasReserve - 1e-6) violations.push("gas guard breach");
      float[d.fromSym === "USDC" ? "usdc" : d.fromSym === "SOL" ? "sol" : "jup"] -= d.spendUi;
      float.clkn += d.spendUsd / st.lastPrice;
      st = { ...st, lastBuybackTs: now, buybacksToday: (st.buybackDayStamp === DAY ? st.buybacksToday : 0) + 1, buybackDayStamp: DAY };
    }
    const frac = rnd() < 0.05 ? 1.3 : rnd(); // 5% of ticks OOR
    const g = rollGate({ cfg: CFG, nowMs: now, frac, oorSince: rollState.oorSince, sinceLastRollSec: (now - rollState.lastRoll) / 1000, dayActions: rollState.dayActions, deployStagedUsd: float.usdc, idlePairUsd: float.clkn * st.lastPrice, widthOffPct: 0 });
    rollState.oorSince = g.oorSinceNext;
    if (g.action === "roll") { rollState.dayActions++; rollState.lastRoll = now; }
  }
  check("fuzz: no floor/guard/cap violations in 5,000 ticks", violations.length === 0, violations.slice(0, 3).join("; "));
  check("fuzz: daily buyback count bounded", st.buybacksToday <= CFG.maxBuybacksPerDay, String(st.buybacksToday));
  check("fuzz: rolls bounded by 2× day cap", rollState.dayActions <= 2 * CFG.maxActionsPerDay, String(rollState.dayActions));
}

// ── Scenario 6: PRODUCTION WIRING tripwires (source text — NOT behaviour) ───────
// A pure replay cannot see which code production actually runs, and a require-based test
// cannot see a sleeve that was simply never wired up. These read the real files and pin the
// WIRING. They are deliberately NOT called money-path coverage: a text pin passes on any code
// that merely exists (an earlier version of this block pinned a decimals guard that could
// never fire). Everything executable is executed in Scenario 7.
{
  const root = path.join(__dirname, "..");
  const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
  const VAULT = read("lib/whirlpool-vault.js");
  const DEC = read("lib/engine-decisions.js");
  // Slice one top-level `async function NAME(` body (up to the next top-level async function).
  const fnSrc = (src, name) => {
    const a = src.indexOf(`async function ${name}(`);
    if (a < 0) return "";
    const b = src.indexOf("\nasync function ", a + 1);
    return src.slice(a, b < 0 ? src.length : b);
  };

  // (a) Which decision functions production actually calls.
  check("buybackDecision IS production-wired (vault calls it)", /buybackDecision\(\s*\{/.test(VAULT));
  check("rollGate is NOT production-wired — Scenarios 1-3 are spec-only",
    !/rollGate\s*\(/.test(VAULT),
    "the vault now calls rollGate: promote Scenarios 1-3 to production scenarios, add the near-edge/ROOM/evenness branches to the spec, and update both headers");

  // (b) The inline sleeve gates, pinned as they really are. This is the drift the audit found:
  // the spec has no near-edge trigger, no ROOM gate and no evenness gate, and tickBtc carries
  // neither the OOR dwell nor the 2x emergency ceiling the other three have.
  const SLEEVES = [
    { fn: "tick",    label: "base", dwell: true,  evenness: 'deployBlockedFat("base")', ceiling2x: true },
    { fn: "tickSol", label: "SOL",  dwell: true,  evenness: 'deployBlockedFat("sol")',  ceiling2x: true },
    { fn: "tickJup", label: "JUP",  dwell: true,  evenness: 'deployBlockedFat("jup")',  ceiling2x: true },
    { fn: "tickBtc", label: "BTC",  dwell: false, evenness: null,                       ceiling2x: false },
  ];
  for (const s of SLEEVES) {
    const body = fnSrc(VAULT, s.fn);
    check(`${s.label} sleeve: gate body found`, body.length > 500, s.fn);
    check(`${s.label} sleeve: near-edge trigger present (absent from the rollGate spec)`, /edgeTriggerFrac/.test(body));
    check(`${s.label} sleeve: width-reconfig trigger present`, /widthOff > 0\.2/.test(body));
    check(`${s.label} sleeve: anti-thrash pacing present`, /minRebalanceIntervalSec/.test(body));
    check(`${s.label} sleeve: OOR dwell ${s.dwell ? "present" : "ABSENT (known divergence)"}`,
      /oorDwellSec/.test(body) === s.dwell, "dwell parity with the pin changed — update the spec + this pin together");
    check(`${s.label} sleeve: 2x emergency day ceiling ${s.ceiling2x ? "present" : "ABSENT (known divergence)"}`,
      /2 \* cfg\.maxActionsPerDay/.test(body) === s.ceiling2x, "day-cap ceiling changed — update the spec + this pin together");
    if (s.evenness) check(`${s.label} sleeve: evenness gate present (absent from the spec)`, body.includes(s.evenness));
  }
  check("rollGate spec still lacks the near-edge / ROOM / evenness branches production has",
    !/edgeTriggerFrac|deployBlockedFat|roomUsd/.test(DEC),
    "the spec grew a production branch — wire it or document it, and update this pin");

  // (c) The confirm-timeout accounting, which IS wired. NOTE (2026-09-03): the open/close
  // "did it land?" verification that used to be pinned here was REVERTED — the position-NFT
  // supply read could not tell "the mint was never created" (a routine failed open) apart
  // from "the RPC could not answer", so it parked nonexistent mints in the sleeve pointers.
  // The open/close paths are back on the original raw signSend loops and the underlying audit
  // finding (a timed-out open/close is unverified) is OPEN. Do not re-add a pin here without
  // code that can actually distinguish those two cases.
  check("buyback counts a landed-but-unconfirmed swap against the daily cap",
    /isConfirmTimeout\(e\)/.test(fnSrc(VAULT, "buyback")));
  check("rebalancePools counts a landed-but-unconfirmed swap against the daily cap",
    /isConfirmTimeout\(e\)/.test(fnSrc(VAULT, "rebalancePools")));
  {
    const even = fnSrc(VAULT, "evenPools");
    check("evenPools scale-up failure is never swallowed silently",
      /scale-up clip failed/.test(even) && /scale-up clip unconfirmed/.test(even));
    check("evenPools DIRECT SHIFT arms the settle cooldown BEFORE it signs the remove",
      /setState\(\{ evenShiftTs: Date\.now\(\) \}\);\s*\n\s*const rem = await removeLiquidity/.test(even),
      "a landed-but-unconfirmed remove starts no cooldown, and the next 90s cycle shifts again");
    check("evenPools counts a landed-but-unconfirmed shift against the daily swap cap",
      /isConfirmTimeout\(e\)/.test(even));
  }
}

// ── Scenario 7: BEHAVIOUR — the real production functions (needs node_modules) ──
// Everything here CALLS production code and fails if the fix is reverted. Skipped in the
// dependency-free CI job; ENGINE_SIM_REQUIRE_VAULT=1 (smoke-test job, after npm ci) turns
// that skip into a failure so the coverage can never quietly disappear again.
(async () => {
  // ALWAYS an isolated kv, never the ambient DATA_DIR: this writes throwaway project configs,
  // and /data is the live engine's state (position mints, day counters). Set before the require.
  process.env.DATA_DIR = fs.mkdtempSync(path.join(require("os").tmpdir(), "engine-sim-"));
  process.env.PREMIUM_ACCESS_KEY = process.env.PREMIUM_ACCESS_KEY || "engine-sim-local-key";
  const strict = process.env.ENGINE_SIM_REQUIRE_VAULT === "1";
  let vault = null, mm = null;
  try {
    vault = require("../lib/whirlpool-vault.js");
    mm = require("../whirlpool-mm.js");
  } catch (e) {
    const why = String(e && e.message || e).split("\n")[0];
    if (strict) { failures++; console.error(`FAIL  Scenario 7 could not load the engine with ENGINE_SIM_REQUIRE_VAULT=1 — ${why}`); }
    else console.log(`  skip  Scenario 7 (behavioural money-path checks) — deps unavailable: ${why}. Run after npm ci, or with ENGINE_SIM_REQUIRE_VAULT=1 to make this a failure.`);
    return;
  }

  // ── 7a: setConfig null-safety ──
  // Live incident class: the documented "write the key as null to drop a durable override" also
  // wrote that null THROUGH setConfig — Number(null) is 0 (finite, so it passed the clamp), the
  // boolean branch yielded false and the string branch the literal "null". Clearing an override
  // on usdcFloor/maxUsd zeroed the live value; on pair it stored "null" and every tick failed.
  {
    const P = "__simtest";
    const seeded = vault.setConfig({ usdcFloor: 25, swapEnabled: true, pair: "SIM/USDC" }, P);
    check("setConfig seeds a project config", seeded.usdcFloor === 25 && seeded.swapEnabled === true && seeded.pair === "SIM/USDC",
      JSON.stringify({ f: seeded.usdcFloor, s: seeded.swapEnabled, p: seeded.pair }));
    const after = vault.setConfig({ usdcFloor: null, swapEnabled: null, pair: null }, P);
    check("null never zeroes a live number", after.usdcFloor === 25, String(after.usdcFloor));
    check("null never flips a live boolean to false", after.swapEnabled === true, String(after.swapEnabled));
    check('null never writes the string "null" into a live string', after.pair === "SIM/USDC", String(after.pair));
    const real = vault.setConfig({ usdcFloor: 30 }, P);
    check("a real value still writes", real.usdcFloor === 30, String(real.usdcFloor));
  }

  // ── 7c: a confirm timeout is TAGGED, so callers verify on-chain instead of assuming failure ──
  {
    const I = vault._internals;
    const conn = { getSignatureStatuses: async () => ({ value: [null] }) };
    let err = null;
    try { await I.confirmSig(conn, "SiGnAtUrE1234567890", { timeoutMs: 30, pollMs: 5 }); } catch (e) { err = e; }
    check("confirmSig throws a TAGGED timeout", !!err && err.confirmTimeout === true, String(err && err.message));
    check("isConfirmTimeout recognises the tag", !!err && I.isConfirmTimeout(err) === true);
    check("isConfirmTimeout recognises the message across a module boundary", I.isConfirmTimeout(new Error("confirm timeout — tx abcdefgh…")) === true);
    check("isConfirmTimeout does NOT match an ordinary failure", I.isConfirmTimeout(new Error("tx failed on-chain: InstructionError")) === false,
      "a false positive here would count a FAILED swap against the daily cap");
  }

  // ── 7d: transfer decimals are never guessed (the 1000x overpay) ──
  // The project RECORD is not a trusted source: registerProject stamps 9 when none was supplied,
  // which is what made the first version of this guard dead code.
  {
    check("transfer decimals: the chain read wins", vault.transferDecimals("CLKN", 6) === 6);
    check("transfer decimals: USDC/JUP come from the static table", vault.transferDecimals("USDC", null) === 6 && vault.transferDecimals("JUP", null) === 6);
    check("transfer decimals: an unread project token is UNKNOWN, not 9", vault.transferDecimals("CLKN", null) === null,
      "defaulting to 9 sends a 6-decimal project token 1000x over");
    check("transfer decimals: 0 decimals is a real answer, not falsy-unknown", vault.transferDecimals("CLKN", 0) === 0);
  }

  // ── 7e: the durable-config route APPLIES the tuning and refuses only the durability claim ──
  // Rejecting the whole request made the documented command a total no-op on the ON-BY-DEFAULT
  // poke engine. And the allowlist is a hand-copy of which ratchets in server.js merge
  // ratchetOverrides:<project> — assert the two actually agree instead of grepping for the name.
  {
    const serverSrc = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
    const merging = [...serverSrc.matchAll(/kv\.get\("ratchetOverrides:([a-z0-9_-]+)"/g)].map((m) => m[1]).sort();
    const declared = [...mm.RATCHET_MERGES_OVERRIDES].sort();
    check("the durable-capable allowlist matches the ratchets that really merge overrides",
      JSON.stringify(declared) === JSON.stringify(merging), `whirlpool-mm: [${declared}] vs server.js: [${merging}]`);

    const layer = mm.router.stack.find((l) => l.route && l.route.path === "/vault/config" && l.route.methods && l.route.methods.post);
    check("POST /vault/config is mounted", !!layer);
    if (layer) {
      const call = (query, body) => new Promise((resolve, reject) => {
        const res = {
          statusCode: 200,
          status(c) { this.statusCode = c; return this; },
          json(o) { resolve({ status: this.statusCode, body: o }); },
        };
        try { layer.route.stack[0].handle({ query, body, headers: {} }, res, () => resolve({ status: 0, body: null })); }
        catch (e) { reject(e); }
      });
      const key = process.env.PREMIUM_ACCESS_KEY;
      const nd = await call({ key, project: "__simtest_nodurable", durable: "1" }, { usdcFloor: 30 });
      check("durable write on a NON-durable project still APPLIES the live change",
        nd.status === 200 && nd.body && nd.body.config && nd.body.config.usdcFloor === 30,
        JSON.stringify({ status: nd.status, err: nd.body && nd.body.error }));
      check("...and reports durable:false with a loud warning instead of lying",
        !!nd.body && nd.body.durable === false && typeof nd.body.warning === "string" && nd.body.warning.length > 20,
        JSON.stringify(nd.body && { d: nd.body.durable, w: nd.body.warning }));
      const d = await call({ key, project: "rose", durable: "1" }, { usdcFloor: 30 });
      check("durable write on a durable-capable project still stores the override",
        d.status === 200 && d.body && d.body.durable === true && d.body.ratchetOverrides && d.body.ratchetOverrides.usdcFloor === 30,
        JSON.stringify(d.body && { d: d.body.durable, o: d.body.ratchetOverrides }));
      const drop = await call({ key, project: "rose", durable: "1" }, { usdcFloor: null });
      check("a null value drops the override WITHOUT zeroing the live config",
        drop.status === 200 && drop.body.config.usdcFloor === 30 && !("usdcFloor" in (drop.body.ratchetOverrides || {})),
        JSON.stringify(drop.body && { live: drop.body.config.usdcFloor, ov: drop.body.ratchetOverrides }));
    }
  }
})().then(() => {
  if (failures) { console.error(`\n${failures} FAILURE(S)`); process.exit(1); }
  console.log("\nengine-sim: all scenarios pass");
}).catch((e) => {
  console.error(`\nengine-sim CRASHED: ${e && e.stack || e}`);
  process.exit(1);
});
