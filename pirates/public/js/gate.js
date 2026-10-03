// AHOY: PumpFunPirates — the holder gate (client side).
//
// Three modes, picked at boot:
//  • "live": the game is served by our server. /api/ahoy/config gives the tiers with LIVE prices
//    (never hardcoded here), the wallet signs a one-line nonce, /api/ahoy/verify checks the
//    signature and reads AHOY + Pump Fun Pirates NFTs on-chain, and returns the tier.
//  • "offline": the live site, but the config request failed. The gate is TEMPORARILY UNAVAILABLE:
//    free seas only, retry offered. It is never a fallback into demo mode.
//  • "demo": an EXPLICIT preview — the artifact build sets window.AHOY_PREVIEW = true, and a
//    loopback host may add ?preview=1 (the smoke test). Holder content can be previewed with a
//    labelled "demo unlock" — nothing is checked and nothing is claimed.
// Free seas never touch any of this.
//
// What the browser remembers is NOT a grant. The cache holds only { wallet, token, exp }: a wallet
// address, a server-issued token proving that wallet signed in, and a one-day expiry. The tier is
// never read back from storage. On a live boot the cache is sent to /api/ahoy/session, which
// re-reads the chain, and until that answer arrives nothing above the free seas is unlocked
// (st.confirmed). If that check is unavailable the cache is kept and the screen says so.
//
// Two rules keep a grant from outliving the thing that earned it:
//  • EXPIRY is checked at decision time. Every read of "what may this player unlock" goes through
//    expireIfDue() (effectiveTier, state, pending), so a tab left open for a day, or a laptop that
//    slept, loses its grant the moment anything asks — there is no timer that could be missed.
//  • Every async call is bound to a GENERATION. Connect, disconnect, expiry and a fresh boot each
//    bump it; a /session or /verify answer applies only if the generation (and, for /session, the
//    wallet + token) is still the one that asked. A late answer after a disconnect is discarded.
//
// This is a PRODUCT boundary, not a security one — the game runs in the player's own browser.
window.AHOY = window.AHOY || {};

AHOY.Gate = (function () {
  const API = (window.AHOY_API_BASE || "") + "/api/ahoy";
  const FREE = () => ({ tier: "free", wallet: null, ahoy: 0, usd: 0, nfts: [], demo: false, token: null, exp: 0, checkedAt: 0, confirmed: false, unavailable: false });
  const PREVIEW = window.AHOY_PREVIEW === true || (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) && /[?&]preview=1(&|$)/.test(location.search));
  const MAX_GRANT_MS = 24 * 3600e3;   // matches the server's session token life
  const SOL_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  let mode = "offline";
  let config = null;     // { tiers: [{id, label, holdUsd, holdAhoy, seas:[...] }], priceUsd, nftCollection }
  let st = FREE();
  let gen = 0;           // bumped by anything that replaces the session; in-flight answers check it
  const TIER_RANK = { free: 0, deckhand: 1, captain: 2, nft: 3 };
  const SKEY = "ahoy_pfp_gate_v1";
  const store = () => { try { return window.sessionStorage; } catch (_) { return null; } };
  const clearCache = () => { try { store() && store().removeItem(SKEY); } catch (_) {} };

  // The cached grant, or null. Must be bound to a wallet, carry a token and an unexpired expiry no
  // further out than the server would ever issue. Anything else (including a hand-written
  // {"tier":"nft"}) is discarded. Only wallet/token/exp are read — never a tier.
  function readCache() {
    try {
      const raw = store() && store().getItem(SKEY); if (!raw) return null;
      const c = JSON.parse(raw), now = Date.now();
      if (c && c.demo === true) return { demo: c };
      if (!c || !SOL_RE.test(String(c.wallet || "")) || typeof c.token !== "string" || !c.token || !(c.exp > now) || c.exp - now > MAX_GRANT_MS + 60e3) { clearCache(); return null; }
      return { wallet: c.wallet, token: c.token, exp: c.exp };
    } catch (_) { clearCache(); return null; }
  }
  const persist = () => {
    try {
      const s = store(); if (!s) return;
      if (st.demo && mode === "demo") s.setItem(SKEY, JSON.stringify({ demo: true, tier: st.tier, nfts: st.nfts }));
      else if (st.wallet && st.token && st.exp > Date.now()) s.setItem(SKEY, JSON.stringify({ wallet: st.wallet, token: st.token, exp: st.exp }));
      else s.removeItem(SKEY);
    } catch (_) {}
  };
  // The session's expiry has passed: drop the grant (and the cache) so the player is asked to
  // connect and sign again, and void every in-flight answer. The demo preview has no session.
  function expireIfDue() {
    if (st.demo || !st.wallet || st.exp > Date.now()) return false;
    gen++; st = FREE(); clearCache();
    return true;
  }
  // What the game may unlock RIGHT NOW: the free tier unless the server confirmed this wallet this
  // session and that session has not expired (or this is the explicit labelled preview). Every gate
  // decision goes through here.
  const effectiveTier = () => {
    expireIfDue();
    return (mode === "demo" && st.demo) || st.confirmed ? st.tier : "free";
  };

  // Minimal base58 (bitcoin alphabet) — the signature goes to the server in base58.
  const ALPH = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  function b58(bytes) {
    let digits = [0];
    for (const byte of bytes) {
      let carry = byte;
      for (let j = 0; j < digits.length; j++) { carry += digits[j] << 8; digits[j] = carry % 58; carry = (carry / 58) | 0; }
      while (carry) { digits.push(carry % 58); carry = (carry / 58) | 0; }
    }
    let out = "";
    for (const byte of bytes) { if (byte === 0) out += "1"; else break; }
    for (let i = digits.length - 1; i >= 0; i--) out += ALPH[digits[i]];
    return out;
  }

  function provider() {
    const w = window;
    return (w.phantom && w.phantom.solana) || (w.solflare && w.solflare.isSolflare && w.solflare) || (w.backpack && w.backpack.solana) || w.solana || null;
  }

  async function postJson(path, body, ms) {
    const r = await fetch(API + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(ms || 8000) });
    let j = null; try { j = await r.json(); } catch (_) {}
    return { status: r.status, body: j || {} };
  }

  // Re-check a returning player's cached grant against the server. Nothing unlocks until this
  // answers; "unavailable" keeps the cache, grants nothing and says so; an expired/invalid token
  // is the one case that clears it.
  async function revalidate() {
    if (expireIfDue() || !st.wallet || !st.token) return st;
    // Bound to the wallet + token + generation that asked. If any of them has changed by the time
    // the answer arrives (disconnect, a new sign-in, expiry), the answer is discarded.
    const g = gen, w = st.wallet, t = st.token;
    const current = () => g === gen && st.wallet === w && st.token === t;
    try {
      const r = await postJson("/session", { wallet: w, token: t }, 6000);
      if (!current()) return st;
      if (r.status === 401) { gen++; st = FREE(); clearCache(); return st; }
      const b = r.body;
      if (r.status !== 200 || !b.ok || b.unavailable) { st.confirmed = false; st.unavailable = true; return st; }
      st = Object.assign(st, { tier: b.tier, ahoy: b.ahoy || 0, usd: b.usd || 0, nfts: b.nfts || [], checkedAt: Date.now(), confirmed: true, unavailable: false });
    } catch (_) { if (current()) { st.confirmed = false; st.unavailable = true; } }
    return st;
  }

  async function boot() {
    const g = ++gen;
    st = FREE(); config = null;
    const cached = readCache();
    if (PREVIEW) {
      mode = "demo";
      config = { tiers: [
        { id: "deckhand", label: "Deckhand", holdUsd: 5, holdAhoy: null, seas: ["reef", "glacier"] },
        { id: "captain", label: "Captain", holdUsd: 25, holdAhoy: null, seas: ["reef", "glacier", "deep", "uptober"] },
        { id: "nft", label: "Crew (NFT holder)", holdUsd: null, holdAhoy: null, seas: ["reef", "glacier", "deep", "uptober", "cove"] },
      ], priceUsd: null, demo: true };
      if (cached && cached.demo) st = Object.assign(st, { demo: true, tier: "nft", nfts: Array.isArray(cached.demo.nfts) ? cached.demo.nfts.slice(0, 4) : [] });
      return mode;
    }
    // Not the preview: a demo cache means nothing here.
    if (cached && cached.demo) clearCache();
    try {
      const r = await fetch(API + "/config", { cache: "no-store", signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error("config " + r.status);
      const j = await r.json();
      if (!j || j.ok !== true || !Array.isArray(j.tiers)) throw new Error("bad config");
      if (g !== gen) return mode;   // superseded (disconnect / another boot) while the config loaded
      config = j; mode = "live";
    } catch (_) {
      if (g !== gen) return mode;
      // Gate temporarily unavailable: free seas only, retry offered. Never demo mode — and the
      // cached grant stays in storage for the next try.
      mode = "offline"; config = null;
      if (cached && cached.wallet) st = Object.assign(FREE(), { wallet: cached.wallet, token: cached.token, exp: cached.exp, unavailable: true });
      return mode;
    }
    if (cached && cached.wallet) {
      st = Object.assign(FREE(), { wallet: cached.wallet, token: cached.token, exp: cached.exp });
      await revalidate();
    }
    return mode;
  }

  // Which tier a sea needs.
  function seaNeeds(sea) { return sea.access; }
  function canSail(sea) {
    if (sea.access === "free") return true;
    return TIER_RANK[effectiveTier()] >= TIER_RANK[sea.access];
  }
  function tierFor(id) { return (config && config.tiers || []).find((t) => t.id === id) || null; }

  // Copy for a locked sea, rendered from the live config (amounts in AHOY when the price is known).
  function needText(access) {
    const t = tierFor(access);
    if (access === "nft") return "Hold a Pump Fun Pirates NFT";
    if (!t) return "Holders only";
    const usd = t.holdUsd != null ? `$${t.holdUsd}` : "";
    const ahoy = t.holdAhoy ? ` (≈ ${Math.ceil(t.holdAhoy).toLocaleString()} AHOY at today's price)` : "";
    return `Hold ${usd} of AHOY${ahoy}`;
  }

  async function connectAndVerify() {
    if (mode === "offline") throw new Error("The holder check is temporarily unavailable — free seas only for now. Retry in a moment.");
    if (mode !== "live") throw new Error("Wallet check needs the live game — this is the preview build.");
    const p = provider();
    if (!p) throw new Error("No Solana wallet found. Open this page in Phantom, Solflare or Backpack.");
    // This attempt owns the session until something else bumps the generation. Disconnect, expiry or
    // a newer connect voids it, and a stale answer is dropped instead of written into the new state.
    const g = ++gen;
    const stale = () => { if (g !== gen) throw new Error("The wallet check was cancelled."); };
    const res = await p.connect(); stale();
    const pk = (res && res.publicKey) || p.publicKey;
    const wallet = pk && pk.toString();
    if (!wallet) throw new Error("Wallet did not share an address.");
    const ch = await (await fetch(API + "/challenge", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ wallet }) })).json(); stale();
    if (!ch.ok) throw new Error(ch.error || "Could not start the check.");
    const enc = new TextEncoder().encode(ch.message);
    const sig = await p.signMessage(enc, "utf8"); stale();
    const sigBytes = sig && (sig.signature || sig);
    const r = await (await fetch(API + "/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ wallet, nonce: ch.nonce, signature: b58(new Uint8Array(sigBytes)) }) })).json(); stale();
    if (!r.ok) throw new Error(r.error || "Check failed.");
    // ⚠️ Codex round 3, P2 — NO-SESSION-SECRET MODE. When the server has no session secret
    // (AHOY_SESSION_SECRET and PREMIUM_ACCESS_KEY both unset) /verify still verifies the signature
    // and reads the chain, but returns token:null, expiresAt:null. Coercing that null to expiry 0
    // made the very next decision (expireIfDue) throw away a grant the server had just confirmed
    // (NFT sign-in answered nft, the next tier check answered free). With no token there is nothing
    // that could be stored or re-checked, so the verified tier is kept for THIS PAGE SESSION only:
    // in memory (persist() writes nothing without a token, so a reload asks to verify again), bound
    // to this generation (disconnect / expiry / a newer connect void it, and a late answer is
    // dropped by stale() above), and capped at the same one-day life a token would have. The token
    // mode below is unchanged: its expiry still comes from the server.
    const tokenless = !r.token;
    const exp = tokenless ? Date.now() + MAX_GRANT_MS : Math.min(Number(r.expiresAt) || 0, Date.now() + MAX_GRANT_MS);
    st = { tier: r.tier, wallet, ahoy: r.ahoy || 0, usd: r.usd || 0, nfts: r.nfts || [], demo: false, token: r.token || null, exp, checkedAt: Date.now(), confirmed: true, unavailable: !!r.unavailable };
    persist();
    return st;
  }

  // Retry the check for a remembered wallet (no signature needed while its token is good), or retry
  // the whole boot if the gate itself was unavailable.
  async function recheck() {
    if (mode === "offline") { await boot(); return st; }
    await revalidate(); persist(); return st;
  }
  // A remembered wallet whose grant the server has not confirmed this session.
  const pending = () => { expireIfDue(); return !!(st.wallet && st.token && !st.confirmed); };

  async function disconnect() {
    // Synchronously first: void every in-flight answer and clear the state before the wallet's own
    // disconnect (which can take a moment) — nothing may land in between.
    gen++; st = FREE();
    AHOY.Save.set({ nft: null });
    clearCache();
    try { const p = provider(); if (p && p.disconnect) await p.disconnect(); } catch (_) {}
  }

  // Preview build only: show the holder content to an audience, clearly labelled as a demo.
  function demoUnlock() {
    if (mode !== "demo") return st;
    gen++;
    st = Object.assign(FREE(), { tier: "nft", demo: true, checkedAt: Date.now(),
      nfts: [{ id: "demo-16", name: "Pump Fun Pirates #16 (demo)", image: "assets/sprite/nft-demo.png",
        traits: { eyewear: "laser", beard: "neon", hat: "black", clothes: "tshirt", eyes: "brown", arm: "transparent" } }] });
    persist();
    return st;
  }

  return { boot, canSail, seaNeeds, needText, connectAndVerify, disconnect, demoUnlock, recheck, pending,
    mode: () => mode, config: () => config, state: () => { expireIfDue(); return st; }, tier: effectiveTier, rank: (t) => TIER_RANK[t] || 0, provider };
})();
