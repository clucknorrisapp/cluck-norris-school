"use strict";
// Who gets the free tier of the unified tools pass — the DECISION, with every read injected.
//
// Until 2026-09-22 this lived inline in server.js's toolPassQualify() as one CLKN balance read.
// The Seeker app adds a second door (owner, 2026-09-19, docs/SEEKER_APP_PLAN.md §7): hold about
// $50 of SKR and the heavy tools are free there too — same dollar figure, same live pricing, same
// re-check at use, same fail-open on an outage. Two doors with three outage policies each is the
// kind of branching that goes wrong silently inside a 19k-line file, so the decision is a pure
// function here and scripts/tool-pass-qualify-test.cjs pins every branch.
//
// Rules, in the order they are applied:
//   1. A comped wallet is in, before any network read (an RPC blip never denies a comp).
//   2. CLKN first, always: no usable CLKN price → in on "grace-price" (our pricing outage is never
//      the user's problem); the balance read FAILED (not "is zero") → in on "grace-rpc"; balance
//      ≥ ceil(usd / price) → in as "holder".
//   3. Only when the caller asked for the "skr" door (the Seeker app does; the website and the
//      store editions never do): SKR can only ADD a grant on a VERIFIED qualifying balance →
//      "holder-skr". It never graces. If the SKR price or the SKR read is unavailable, the wallet
//      is denied exactly as the website would deny it, and the denial says SKR could not be
//      checked. (Codex, round 13 P1: the first version graced on a missing SKR price, which let a
//      zero-CLKN wallet through a door the website does not have, including during a cold-start
//      refresh that had simply not finished yet. The fail-open population is the CLKN one and
//      only the CLKN one.)
//   4. Otherwise denied with the figures for every door that was checked, so the sheet can say
//      exactly what is missing.
//   5. A cache, when the caller passes one, sits BETWEEN the comp check and the reads: a comp is
//      re-read on every call (a wallet comped a minute ago is in now, not in five minutes — Codex,
//      round 13 P2), and only real answers are cached: holders and verified denials, keyed by
//      wallet + doors so a website denial never answers a Seeker request or the reverse.
//
// ⛔ Product boundary, not a security boundary. The door list is what the CLIENT asked for; a
// website user who hand-crafts the session request with doors:["skr"] gets what a Seeker user
// gets — the same free tier a CLKN holder already has. Nothing behind the pass is exposed by
// that, and nothing here treats a user-agent or an app id as authorisation (AGENTS.md).
//
// ⛔ Nothing is gated BEHIND SKR. It opens the same door CLKN opens; it never closes one.

const SKR_MINT = "SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3";   // Solana Mobile's SKR — verified against the registry and the chain (docs/SEEKER_APP_PLAN.md §7); a look-alike mint exists
const KNOWN_DOORS = new Set(["skr"]);

// Callers pass whatever the client sent; only known doors survive, as a sorted, de-duplicated list.
function normalizeDoors(doors) {
  if (!Array.isArray(doors)) return [];
  return [...new Set(doors.filter((d) => typeof d === "string" && KNOWN_DOORS.has(d)))].sort();
}

function needed(usd, priceUsd) { return Math.ceil(usd / priceUsd); }

// qualify(input) → { ok: true, via, ... } | { ok: false, error: "insufficient_holdings", ... }
//   input.wallet      the wallet address (for messages only; every read is injected)
//   input.doors       extra doors the client asked for (["skr"] from the Seeker app)
//   input.usd         the dollar figure of the free tier (TOOLGATE.usd — never a token amount)
//   input.prices      { clkn: number|null, skr: number|null } — null = no usable price
//   input.comped      boolean — the operator comp list
//   input.readClkn()  → Promise<{ balance }> | { unavailable: true, error }
//   input.readSkr()   → same shape, for the SKR mint
//   input.terms       { lamports, days } — for the denial sentence only
//   input.log(msg)    optional; every fail-open path says why (a silent grace hid an outage once)
async function qualify(input) {
  const { usd, prices = {}, terms = {} } = input;
  const doors = normalizeDoors(input.doors);
  const log = typeof input.log === "function" ? input.log : () => {};
  if (input.comped) return { ok: true, via: "comp", doors };
  // The cache, if any, answers only AFTER the comp check and only with real answers.
  const cache = input.cache && typeof input.cache.get === "function" && typeof input.cache.set === "function" ? input.cache : null;
  const cacheKey = String(input.wallet || "") + "|" + doors.join(",");
  const ttl = Number(input.cacheTtlMs) > 0 ? Number(input.cacheTtlMs) : 5 * 60e3;
  const now = typeof input.now === "function" ? input.now() : Date.now();
  if (cache) {
    const c = cache.get(cacheKey);
    if (c && now - c.at < ttl) return c.ok ? { ok: true, via: c.via, doors, cached: true } : { ok: false, ...c.deny, cached: true };
  }
  const remember = (r) => { if (cache) { if (r.ok) cache.set(cacheKey, { ok: true, at: now, via: r.via }); else { const { ok, ...deny } = r; cache.set(cacheKey, { ok: false, at: now, deny }); } } return r; };

  // 1. CLKN — the door every surface has.
  const clknPrice = Number.isFinite(Number(prices.clkn)) && Number(prices.clkn) > 0 ? Number(prices.clkn) : null;
  if (!clknPrice) { log("no usable CLKN price, failing open"); return { ok: true, via: "grace-price", doors }; }
  let c;
  try { c = await input.readClkn(); } catch (e) { c = { unavailable: true, error: e && e.message }; }
  if (!c || c.unavailable) { log("CLKN balance read unavailable, failing open: " + ((c && c.error) || "no result")); return { ok: true, via: "grace-rpc", doors }; }
  const clknNeeded = needed(usd, clknPrice);
  const clknBal = Number(c.balance) || 0;
  if (clknBal >= clknNeeded) return remember({ ok: true, via: "holder", balance: clknBal, needed: clknNeeded, doors });

  // 2. SKR — only when asked for, and only ever an ADDITIONAL way in. The CLKN check above has
  // already run to a verified answer, so "we cannot evaluate SKR right now" is not an outage that
  // strands the user: it is a door that cannot be opened this minute, and the honest answer is the
  // same denial the website gives, with the reason. No grace on this branch, by design.
  let skr = null;
  if (doors.includes("skr")) {
    const skrPrice = Number.isFinite(Number(prices.skr)) && Number(prices.skr) > 0 ? Number(prices.skr) : null;
    if (!skrPrice) { log("no usable SKR price with the skr door requested — SKR not checked, CLKN answer stands"); skr = { unavailable: "price", balance: null, needed: null, priceUsd: null }; }
    else {
      let s;
      try { s = await input.readSkr(); } catch (e) { s = { unavailable: true, error: e && e.message }; }
      if (!s || s.unavailable) { log("SKR balance read unavailable — SKR not checked, CLKN answer stands: " + ((s && s.error) || "no result")); skr = { unavailable: "rpc", balance: null, needed: needed(usd, skrPrice), priceUsd: skrPrice }; }
      else {
        const skrNeeded = needed(usd, skrPrice);
        const skrBal = Number(s.balance) || 0;
        if (skrBal >= skrNeeded) return remember({ ok: true, via: "holder-skr", balance: skrBal, needed: skrNeeded, doors });
        skr = { balance: skrBal, needed: skrNeeded, priceUsd: skrPrice };
      }
    }
  }

  // 3. Denied — with every figure the sheet needs, for every door that was checked.
  const sol = Number(terms.lamports) > 0 ? terms.lamports / 1e9 : null;
  const days = Number(terms.days) > 0 ? terms.days : null;
  const tail = sol && days ? ` ${sol} SOL unlocks every heavy tool for ${days} days.` : "";
  let detail;
  if (!skr) detail = `The free tier needs about $${usd} of CLKN (~${clknNeeded.toLocaleString()} at the current price); that wallet holds ${Math.round(clknBal).toLocaleString()}.${tail}`;
  else if (skr.unavailable) detail = `The free tier needs about $${usd} of CLKN (~${clknNeeded.toLocaleString()} at the current price); that wallet holds ${Math.round(clknBal).toLocaleString()}. SKR could not be checked right now (${skr.unavailable === "price" ? "no SKR price" : "balance read failed"}) — try again in a minute.${tail}`;
  else detail = `The free tier needs about $${usd} of CLKN (~${clknNeeded.toLocaleString()} at the current price) or about $${usd} of SKR (~${skr.needed.toLocaleString()}); that wallet holds ${Math.round(clknBal).toLocaleString()} CLKN and ${Math.round(skr.balance).toLocaleString()} SKR.${tail}`;
  // A denial that could not check SKR is NOT cached: the next request may find the price.
  const deny = { ok: false, error: "insufficient_holdings", balance: clknBal, needed: clknNeeded, holdUsd: usd, priceUsd: clknPrice, skr, doors, detail };
  return skr && skr.unavailable ? deny : remember(deny);
}

// Is a freshly fetched price safe to persist and compare against? Finite and positive first —
// a negative or NaN tick must never be stored (Codex, round 13 P2: a persisted -1 made the 10×
// band refuse every valid price after it). Then the band: against a RECENT last-good only, so a
// genuinely moved market can re-anchor once the last-good value ages out (6h).
function acceptPrice({ fresh, last, lastAt, now, bandHours = 6 }) {
  const f = Number(fresh);
  if (!Number.isFinite(f) || f <= 0) return { ok: false, reason: "not a finite positive price" };
  const l = Number(last);
  const recent = Number.isFinite(l) && l > 0 && Number.isFinite(Number(lastAt)) && now - Number(lastAt) < bandHours * 3600e3;
  if (recent && (f > l * 10 || f < l / 10)) return { ok: false, reason: `implausible vs last good ${l}` };
  return { ok: true, price: f };
}

// A token's `v` names the door it came through; the live re-check must use the same doors, so a
// website session never grows an SKR door it did not ask for, and a Seeker session keeps its own.
function doorsForVia(via) { return via === "holder-skr" ? ["skr"] : []; }

module.exports = { qualify, normalizeDoors, doorsForVia, acceptPrice, SKR_MINT, KNOWN_DOORS };
