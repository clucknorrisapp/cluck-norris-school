"use strict";
// The daily CUNA burn: decide whether to burn, and exactly how much. Pure — no network, no clock,
// no signing. The half that can destroy tokens lives in server.js and does nothing this file does
// not authorise.
//
// Owner, 2026-09-05: "we would burn 690K tokens per day same time per day from cuna dev wallet."
//
// ⛔ SHIPS DISARMED, AND ARMING IS NOT ENOUGH. Burning is irreversible and needs a key that can
// spend the dev wallet, so this deliberately does NOT reuse MM_OPERATOR_SECRET_TREASURY. It wants
// its own CUNA_BURN_SECRET. Arming the burner must be a separate, explicit act from whatever
// authority the liquidity engines already hold — one env var should never quietly gain the power
// to destroy supply because a different feature was switched on.
//
// A NOTE ON THE FIXED AMOUNT. The owner chose a flat 690,000/day rather than a percentage of the
// day's unlock. That is his call and it is what this implements. The consequence to keep an eye
// on: the unlock stream drifts (it moved 6.63M -> 6.91M inside a single day of work), so a flat
// figure slowly stops meaning "10% of the unlock". It is a number to revisit, not a bug.

const DAY = 86400;

// Ceiling that exists purely to survive a typo. 690000 and 690000000 differ by three keystrokes,
// and one of them is a tenth of the supply. Nothing may burn above this without editing code —
// config alone can never reach it.
const HARD_DAILY_CAP_RAW = 5_000_000n * 10n ** 9n;   // 5,000,000 CUNA

// The most an AUTOMATIC burn may destroy in one UTC day (owner, 2026-09-05: "cap it at 2M per day
// for the auto burns, I can manually do more than that for fun and celebrations"). This is the
// number that makes the worst possible day knowable in advance — without it, the worst day is
// whatever the roll and the retry logic produce together.
const AUTO_DAILY_CAP_RAW = 2_000_000n * 10n ** 9n;   // 2,000,000 CUNA
// Bonus rolls land on clean multiples so an announcement reads as a decision, not a float.
const BONUS_STEP_RAW = 10_000n * 10n ** 9n;          // 10,000 CUNA

const DEFAULTS = {
  mint: "4yro2xbCxMFVvygCsj5FZMgZnVCb8EqcbPGTbSGCgDBc",
  amountRaw: "690000000000000",   // 690,000 CUNA at 9dp — the fixed daily base
  hourUtc: 15,                    // "same time per day" — 15:00 UTC
  // Bonus burns: OFF until switched on. When enabled, each day's burn is base + a roll of
  // 0..bonusMaxRaw, and the total is clamped to AUTO_DAILY_CAP_RAW regardless.
  bonusEnabled: false,
  bonusMaxRaw: "1000000000000000",   // up to 1,000,000 CUNA on top of the base
};

function validateBurnConfig(patch, base) {
  const c = { ...DEFAULTS, ...(base || {}), ...(patch || {}) };
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(c.mint))) throw new Error(`mint is not an address: ${c.mint}`);
  if (c.wallet != null && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(c.wallet))) {
    throw new Error(`wallet is not an address: ${c.wallet}`);
  }
  let amt;
  try { amt = BigInt(c.amountRaw); } catch (_) { throw new Error(`amountRaw must be whole base units: got ${c.amountRaw}`); }
  if (amt <= 0n) throw new Error(`amountRaw must be positive: got ${c.amountRaw}`);
  if (amt > HARD_DAILY_CAP_RAW) {
    throw new Error(`amountRaw ${amt} exceeds the hard daily cap ${HARD_DAILY_CAP_RAW} — refusing (a typo away from a tenth of the supply)`);
  }
  c.amountRaw = amt.toString();
  // Number(null) and Number("") are both 0, so a cleared value would silently become midnight —
  // a burn firing fifteen hours earlier than intended, every day, with nothing to see.
  if (c.hourUtc === null || c.hourUtc === "" || typeof c.hourUtc === "boolean") {
    throw new Error(`hourUtc must be 0-23: got ${JSON.stringify(c.hourUtc)}`);
  }
  if (typeof c.bonusEnabled !== "boolean") {
    // Only the boolean. A truthy value is not consent for an extra million tokens a day.
    throw new Error(`bonusEnabled must be true or false: got ${JSON.stringify(c.bonusEnabled)}`);
  }
  let bonus;
  try { bonus = BigInt(c.bonusMaxRaw); } catch (_) { throw new Error(`bonusMaxRaw must be whole base units: got ${c.bonusMaxRaw}`); }
  if (bonus < 0n) throw new Error(`bonusMaxRaw cannot be negative: got ${c.bonusMaxRaw}`);
  if (amt + bonus > AUTO_DAILY_CAP_RAW) {
    throw new Error(`amountRaw + bonusMaxRaw (${amt + bonus}) exceeds the ${AUTO_DAILY_CAP_RAW} auto daily cap — refusing`);
  }
  c.bonusMaxRaw = bonus.toString();
  const h = Number(c.hourUtc);
  if (!Number.isInteger(h) || h < 0 || h > 23) throw new Error(`hourUtc must be 0-23: got ${c.hourUtc}`);
  c.hourUtc = h;
  return c;
}

// Deterministic per-day roll. Seeded from the DAY, never from Math.random(), so the same day
// always yields the same number: a retry cannot roll a different amount and burn twice for two
// different figures, and the size is reproducible from the date alone if anyone ever asks how a
// day's number was chosen. FNV-1a, which is plenty for picking a burn size.
function dayRoll01(dayKey) {
  let hash = 2166136261;
  const s = String(dayKey);
  for (let i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  // Avalanche (MurmurHash3 finalizer). Without it consecutive date strings stay correlated once
  // the result is scaled down: the first version produced 30,000 three days running and exactly
  // 1,000,000 twice in a row. A "randomizer" that visibly repeats is worse than no randomizer.
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 2246822507) >>> 0;
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 3266489909) >>> 0;
  hash ^= hash >>> 16;
  return (hash >>> 0) / 4294967296;   // [0,1)
}

// What to burn on a given day: the fixed base, plus a rolled bonus when enabled, clamped to the
// automatic daily cap. Pure and date-driven — no clock, no randomness at call time.
// DEFENSIVE, NOT VALIDATING. It takes the stored config as-is rather than re-validating, so a
// config written under an older, looser cap yields a CLAMPED amount instead of throwing at burn
// time. A burner that crashes on a stale config is a burner that silently stops burning; one that
// clamps keeps working within today's policy. validateBurnConfig still refuses bad values at
// WRITE time, which is where a mistake should be caught.
function amountForDay(dayKey, config) {
  const cfg = { ...DEFAULTS, ...(config || {}) };
  let base;
  try { base = BigInt(cfg.amountRaw); } catch (_) { base = BigInt(DEFAULTS.amountRaw); }
  if (base <= 0n) base = BigInt(DEFAULTS.amountRaw);
  if (base > AUTO_DAILY_CAP_RAW) {
    return { amountRaw: AUTO_DAILY_CAP_RAW.toString(), baseRaw: base.toString(), bonusRaw: "0", capped: true };
  }
  if (cfg.bonusEnabled !== true) return { amountRaw: base.toString(), baseRaw: base.toString(), bonusRaw: "0", capped: false };
  let max;
  try { max = BigInt(cfg.bonusMaxRaw); } catch (_) { max = 0n; }
  if (max < 0n) max = 0n;
  // Quantise to BONUS_STEP_RAW so the number reads as a decision rather than a float.
  const steps = max / BONUS_STEP_RAW;
  const bonus = steps > 0n ? BigInt(Math.floor(dayRoll01(dayKey) * (Number(steps) + 1))) * BONUS_STEP_RAW : 0n;
  let total = base + bonus;
  let capped = false;
  if (total > AUTO_DAILY_CAP_RAW) { total = AUTO_DAILY_CAP_RAW; capped = true; }
  return { amountRaw: total.toString(), baseRaw: base.toString(), bonusRaw: (total - base).toString(), capped };
}

function readBurn(stored) {
  const b = stored && typeof stored === "object" ? stored : {};
  return {
    armed: b.armed === true,          // ONLY the boolean. A truthy value is not consent.
    config: validateBurnConfig(b.config || {}, {}),
  };
}

function dayKey(unix) {
  const d = new Date(Number(unix) * 1000);
  if (isNaN(d.getTime())) throw new Error(`dayKey needs a real unix time: ${unix}`);
  return d.toISOString().slice(0, 10);
}

// Should a burn happen right now, and for how much? Returns a reason instead of throwing so an
// hourly tick can log quietly rather than stack-trace every hour.
//
// `balanceRaw` is the dev wallet's LIQUID CUNA, read on-chain by the caller. Short balance means
// burn NOTHING — never a partial burn. A partial burn cannot be undone and cannot be topped up
// later without double-counting, and a day that burned 40,000 instead of 690,000 would look like a
// successful day forever after.
function burnGate({ burn, burnedDays, nowUnix, balanceRaw, hasSigner }) {
  const b = readBurn(burn);
  if (!b.armed) return { ok: false, reason: "burner is not armed" };
  if (!hasSigner) return { ok: false, reason: "no signing key configured (CUNA_BURN_SECRET)" };
  if (!b.config.wallet) return { ok: false, reason: "no dev wallet configured" };

  const now = Number(nowUnix);
  if (!Number.isFinite(now) || now <= 0) return { ok: false, reason: `bad clock: ${nowUnix}` };
  const key = dayKey(now);
  if (burnedDays && Object.prototype.hasOwnProperty.call(burnedDays, key)) {
    return { ok: false, reason: `${key} already burned`, day: key };
  }
  // "Same time per day": don't fire the moment the UTC day rolls, wait for the configured hour.
  // The hourly tick then catches it at or after that hour, so a redeploy across the exact hour
  // does not lose the day.
  const hour = new Date(now * 1000).getUTCHours();
  if (hour < b.config.hourUtc) {
    return { ok: false, reason: `waiting for ${b.config.hourUtc}:00 UTC (now ${hour}:00)`, day: key };
  }

  let bal;
  try { bal = BigInt(balanceRaw); } catch (_) { return { ok: false, reason: `unreadable balance: ${balanceRaw}` }; }
  const plan = amountForDay(key, b.config);
  const amount = BigInt(plan.amountRaw);
  if (bal < amount) {
    // Loud, and it does NOT mark the day done — so a top-up plus a manual run can still burn it.
    return { ok: false, reason: `SHORT: wallet holds ${bal} of ${amount} needed — burning nothing`, day: key, short: true };
  }
  return { ok: true, day: key, amountRaw: amount.toString(), plan, config: b.config };
}

// Which escrows to claim from, to cover a shortfall. PURE — the caller does the transactions.
//
// One transaction per escrow, so claiming all thirty of the treasury's locks every day would be
// thirty signatures and thirty fees for a shortfall a single lock usually covers. Take the biggest
// claimable ones first and stop the moment the need is met.
//
// `headroomRaw` buys a few days of slack so this is not signing transactions every single day; it
// is capped by what is actually claimable, never by wishful thinking.
function planClaims(escrows, { needRaw, headroomRaw = 0 }) {
  let need;
  try { need = BigInt(needRaw) + BigInt(headroomRaw || 0); } catch (_) {
    throw new Error(`planClaims needs whole base units: got ${needRaw} / ${headroomRaw}`);
  }
  if (need <= 0n) return { claims: [], totalRaw: "0", shortfallRaw: "0" };

  const usable = (escrows || [])
    .map((e) => ({ escrow: e && e.escrow, raw: (() => { try { return BigInt(e.claimableRaw); } catch (_) { return 0n; } })() }))
    .filter((e) => e.escrow && e.raw > 0n)
    // Biggest first, ties broken by escrow so the plan is deterministic — the same inputs must
    // always produce the same list of transactions.
    .sort((a, b) => (b.raw === a.raw ? (a.escrow < b.escrow ? -1 : 1) : (b.raw > a.raw ? 1 : -1)));

  const claims = [];
  let total = 0n;
  for (const e of usable) {
    if (total >= need) break;
    claims.push({ escrow: e.escrow, claimableRaw: e.raw.toString() });
    total += e.raw;
  }
  return {
    claims,
    totalRaw: total.toString(),
    // What is still missing after claiming everything available. Reported rather than hidden: it
    // is the difference between "we will top up" and "the schedules cannot cover this today".
    shortfallRaw: (total >= need ? 0n : need - total).toString(),
  };
}

function arm(stored, nowUnix) {
  const b = readBurn(stored);
  const now = Number(nowUnix);
  if (!Number.isFinite(now) || now <= 0) throw new Error(`arm needs a real nowUnix: ${nowUnix}`);
  return { ...b, armed: true, armedAt: (stored && stored.armedAt) || now };
}
function disarm(stored) { return { ...readBurn(stored), armed: false }; }

module.exports = {
  DAY, DEFAULTS, HARD_DAILY_CAP_RAW, AUTO_DAILY_CAP_RAW, BONUS_STEP_RAW,
  validateBurnConfig, readBurn, burnGate, planClaims, dayKey, dayRoll01, amountForDay,
  arm, disarm,
};
