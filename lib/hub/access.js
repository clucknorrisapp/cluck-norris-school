"use strict";
// Platform access — what a project pays to run Lock to Earn on the engine (owner, 2026-09-16).
//
//   standard  0.5 SOL per month, or 0.5 SOL worth of CLKN priced at the moment the month is paid
//             ("if they bought CLKN early, as price goes up it actually saves them money").
//   small     0.25 SOL per month — for small-cap / young projects where 0.5 would be expensive.
//   comped    free — projects we like, or that we are using for promotion. Owner-granted.
//
// The TIER is the owner's call at approval (never self-declared), stored on the project record.
// The PRICE is an append-only schedule keyed by when the payment landed, the tools-pass pattern
// (lib/tool-pass-terms.js): a month bought under an old price is never re-priced, and changing
// the offer means appending an entry, never editing one. A month is 30 days.
//
// Everything here is pure. The chain read (did the payment land, what was the CLKN price at that
// block) lives with the caller; this module only says what was owed and what a payment covers.

const DAY_MS = 24 * 3600e3;
const MONTH_DAYS = 30;
const LAMPORTS_PER_SOL = 1_000_000_000;

const TIERS = Object.freeze(["standard", "small", "comped"]);

const SCHEDULE = Object.freeze([
  // Launch pricing (owner, 2026-09-16): 0.5 SOL standard, 0.25 SOL small cap, comped = 0.
  Object.freeze({ from: Date.UTC(2026, 8, 16), lamports: Object.freeze({ standard: 500_000_000, small: 250_000_000, comped: 0 }) }),
  // To change the offer: append { from: Date.UTC(yyyy, m-1, d, h), lamports: { standard, small, comped: 0 } }.
]);

for (let i = 1; i < SCHEDULE.length; i++) {
  if (!(SCHEDULE[i].from > SCHEDULE[i - 1].from)) throw new Error("hub access schedule must be ascending by `from`");
}
for (const e of SCHEDULE) {
  for (const t of TIERS) {
    const v = e.lamports[t];
    if (!Number.isInteger(v) || v < 0) throw new Error(`hub access schedule entry malformed for ${t}: ${JSON.stringify(e)}`);
  }
  if (e.lamports.comped !== 0) throw new Error("comped must cost 0");
}

function termsAt(atMs, schedule = SCHEDULE) {
  let t = schedule[0];
  for (const e of schedule) { if (e.from <= atMs) t = e; else break; }
  return t;
}
function current(now = Date.now(), schedule = SCHEDULE) { return termsAt(now, schedule); }

function assertTier(tier) {
  const t = String(tier == null ? "standard" : tier).toLowerCase();
  if (!TIERS.includes(t)) throw new Error(`accessTier must be one of ${TIERS.join(", ")}`);
  return t;
}

// Lamports one month costs for a tier, priced at the instant the payment lands.
function priceLamports(tier, atMs = Date.now(), schedule = SCHEDULE) {
  return termsAt(atMs, schedule).lamports[assertTier(tier)];
}

// The CLKN alternative: the same SOL value in CLKN at the payment moment. `solPerClkn` is the
// live price of ONE CLKN in SOL at that block (caller's job to read it); the amount is in raw
// units of the CLKN mint. Rounded UP so a payment can never fall short by a dust unit.
function clknRawFor(lamports, solPerClkn, decimals) {
  if (!(Number.isFinite(solPerClkn) && solPerClkn > 0)) throw new Error("solPerClkn must be a positive number");
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) throw new Error("decimals must be an integer 0–18");
  if (!Number.isInteger(lamports) || lamports < 0) throw new Error("lamports must be a non-negative integer");
  if (lamports === 0) return 0n;
  // lamports / 1e9 SOL ÷ solPerClkn CLKN/SOL … in raw: lamports * 10^dec / (1e9 * solPerClkn).
  // Do the division in integer space: scale solPerClkn to a 12-decimal integer first.
  const P = 10n ** 12n;
  const priceScaled = BigInt(Math.round(solPerClkn * 1e12));
  if (priceScaled <= 0n) throw new Error("solPerClkn too small to price");
  const num = BigInt(lamports) * (10n ** BigInt(decimals)) * P;
  const den = BigInt(LAMPORTS_PER_SOL) * priceScaled;
  return (num + den - 1n) / den;
}

// Does a landed payment cover one month of the tier at the time it landed? `paid` is either
// { lamports } (SOL) or { clknRaw, solPerClkn, decimals } (CLKN priced at that block).
// `slackPct` forgives the small drift between the quote the payer saw and the price at the
// block (default 2%). Comped tiers are covered by nothing — they never pay.
function paymentCovers({ tier, atMs, paid, slackPct = 2, schedule = SCHEDULE }) {
  const t = assertTier(tier);
  if (t === "comped") return { ok: false, reason: "comped_never_pays" };
  const owed = priceLamports(t, atMs, schedule);
  const slack = Math.max(0, Math.min(10, Number(slackPct) || 0));
  if (paid && Number.isInteger(paid.lamports)) {
    const min = Math.ceil(owed * (100 - slack) / 100);
    return paid.lamports >= min ? { ok: true, kind: "sol", owedLamports: owed } : { ok: false, reason: "short", kind: "sol", owedLamports: owed, paidLamports: paid.lamports };
  }
  if (paid && paid.clknRaw != null) {
    const need = clknRawFor(owed, paid.solPerClkn, paid.decimals);
    const min = (need * BigInt(100 - slack) + 99n) / 100n;
    const got = BigInt(paid.clknRaw);
    return got >= min
      ? { ok: true, kind: "clkn", owedLamports: owed, owedClknRaw: need.toString() }
      : { ok: false, reason: "short", kind: "clkn", owedLamports: owed, owedClknRaw: need.toString(), paidClknRaw: got.toString() };
  }
  return { ok: false, reason: "no_payment" };
}

// Normalise the access block on a project record at approval. The tier is the owner's; a note
// says why (required for comped, so "why is this one free" is answered on the record).
function normalizeAccess(input, { nowUnix } = {}) {
  const a = input && typeof input === "object" ? input : {};
  const tier = assertTier(a.tier);
  const note = String(a.note || "").trim().slice(0, 140);
  if (tier === "comped" && !note) throw new Error("a comped project needs an accessNote saying why (promotion, partner, …)");
  return { tier, note, paidThroughUnix: null, payments: [], grantedAt: Number.isFinite(nowUnix) ? Number(nowUnix) : null };
}

// Apply a covering payment: extends paidThrough by one month from max(now, paidThrough).
// The signature is the receipt and is refused twice.
function applyPayment(access, { sig, atUnix, kind, lamports, clknRaw }) {
  const a = access || normalizeAccess({});
  if (a.tier === "comped") throw new Error("comped project has nothing to pay");
  if (!sig || (a.payments || []).some((p) => p.sig === sig)) throw new Error("payment already recorded (or no signature)");
  const base = Math.max(Number(atUnix), Number(a.paidThroughUnix || 0));
  const paidThroughUnix = base + MONTH_DAYS * 86400;
  const rec = { sig, atUnix: Number(atUnix), kind, lamports: lamports == null ? undefined : Number(lamports), clknRaw: clknRaw == null ? undefined : String(clknRaw), coversUntilUnix: paidThroughUnix };
  return { ...a, paidThroughUnix, payments: [...(a.payments || []), rec] };
}

// What the project may do right now. `comped` and `active` may arm and change terms; `unpaid`
// (never paid) and `expired` may not — but the engine NEVER stops accruing for holders already
// in a running programme because the project fell behind: that would punish the wrong people.
function accessStatus(access, nowUnix) {
  const a = access || { tier: "standard", paidThroughUnix: null };
  if (a.tier === "comped") return { tier: "comped", state: "comped", paidThroughUnix: null, daysLeft: null };
  if (!a.paidThroughUnix) return { tier: a.tier, state: "unpaid", paidThroughUnix: null, daysLeft: 0 };
  const left = a.paidThroughUnix - Number(nowUnix);
  return { tier: a.tier, state: left > 0 ? "active" : "expired", paidThroughUnix: a.paidThroughUnix, daysLeft: Math.max(0, Math.ceil(left / 86400)) };
}
function mayOperate(access, nowUnix) { const s = accessStatus(access, nowUnix).state; return s === "comped" || s === "active"; }

// Who may claim a payment for a project: the PAYER must be one of its operator wallets. A payment
// is public on-chain the moment it lands; without this, any operator of any project could race the
// rightful project to a fresh quote and claim someone else's SOL as their own month (deep dive
// 2026-09-17 P0-007). Same rule the tools pass applies (lib/tool-pass-redeem.js: payer === wallet).
function payerAllowed(project, payer) {
  const ops = project && Array.isArray(project.operatorWallets) ? project.operatorWallets : [];
  return !!payer && ops.includes(payer);
}
// The registry-wide replay guard: a signature already on ANY project's access ledger. Independent
// of the signature store, which can be non-persistent — the registry row is the source of truth.
// Returns the project id that holds it, or null.
function sigUsedInRegistry(registry, sig) {
  if (!sig) return null;
  for (const [id, p] of Object.entries(registry || {})) {
    if (((p && p.access && p.access.payments) || []).some((x) => x && x.sig === sig)) return id;
  }
  return null;
}

module.exports = { TIERS, SCHEDULE, DAY_MS, MONTH_DAYS, LAMPORTS_PER_SOL, termsAt, current, assertTier, priceLamports, clknRawFor, paymentCovers, normalizeAccess, applyPayment, accessStatus, mayOperate, payerAllowed, sigUsedInRegistry };
