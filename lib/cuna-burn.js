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

const DEFAULTS = {
  mint: "4yro2xbCxMFVvygCsj5FZMgZnVCb8EqcbPGTbSGCgDBc",
  amountRaw: "690000000000000",   // 690,000 CUNA at 9dp
  hourUtc: 15,                    // "same time per day" — 15:00 UTC
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
  const h = Number(c.hourUtc);
  if (!Number.isInteger(h) || h < 0 || h > 23) throw new Error(`hourUtc must be 0-23: got ${c.hourUtc}`);
  c.hourUtc = h;
  return c;
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
  const amount = BigInt(b.config.amountRaw);
  if (bal < amount) {
    // Loud, and it does NOT mark the day done — so a top-up plus a manual run can still burn it.
    return { ok: false, reason: `SHORT: wallet holds ${bal} of ${amount} needed — burning nothing`, day: key, short: true };
  }
  return { ok: true, day: key, amountRaw: amount.toString(), config: b.config };
}

function arm(stored, nowUnix) {
  const b = readBurn(stored);
  const now = Number(nowUnix);
  if (!Number.isFinite(now) || now <= 0) throw new Error(`arm needs a real nowUnix: ${nowUnix}`);
  return { ...b, armed: true, armedAt: (stored && stored.armedAt) || now };
}
function disarm(stored) { return { ...readBurn(stored), armed: false }; }

module.exports = {
  DAY, DEFAULTS, HARD_DAILY_CAP_RAW, validateBurnConfig, readBurn, burnGate, dayKey, arm, disarm,
};
