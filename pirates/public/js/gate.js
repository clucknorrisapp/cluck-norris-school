// AHOY: PumpFunPirates — the holder gate (client side).
//
// Two modes, picked at boot:
//  • "live": the game is served by our server. /api/ahoy/config gives the tiers with LIVE prices
//    (never hardcoded here), the wallet signs a one-line nonce, /api/ahoy/verify checks the
//    signature and reads AHOY + Pump Fun Pirates NFTs on-chain, and returns the tier.
//  • "demo": no server reachable (the shareable preview build). Holder content can be previewed
//    with an explicit, labelled "demo unlock" — nothing is checked and nothing is claimed.
// Free seas never touch any of this.
window.AHOY = window.AHOY || {};

AHOY.Gate = (function () {
  const API = (window.AHOY_API_BASE || "") + "/api/ahoy";
  let mode = "demo";
  let config = null;     // { tiers: [{id, label, holdUsd, holdAhoy, seas:[...] }], priceUsd, nftCollection }
  let st = { tier: "free", wallet: null, ahoy: 0, usd: 0, nfts: [], demo: false, token: null, checkedAt: 0 };
  const TIER_RANK = { free: 0, deckhand: 1, captain: 2, nft: 3 };
  const SKEY = "ahoy_pfp_gate_v1";
  try { const raw = sessionStorage.getItem(SKEY); if (raw) st = Object.assign(st, JSON.parse(raw)); } catch (_) {}
  const persist = () => { try { sessionStorage.setItem(SKEY, JSON.stringify(st)); } catch (_) {} };

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

  async function boot() {
    try {
      const r = await fetch(API + "/config", { cache: "no-store" });
      if (!r.ok) throw new Error("no api");
      config = await r.json();
      mode = "live";
    } catch (_) {
      mode = "demo";
      config = { tiers: [
        { id: "deckhand", label: "Deckhand", holdUsd: 5, holdAhoy: null, seas: ["reef", "glacier"] },
        { id: "captain", label: "Captain", holdUsd: 25, holdAhoy: null, seas: ["reef", "glacier", "deep", "uptober"] },
        { id: "nft", label: "Crew (NFT holder)", holdUsd: null, holdAhoy: null, seas: ["reef", "glacier", "deep", "uptober", "cove"] },
      ], priceUsd: null, demo: true };
    }
    if (mode === "live" && st.demo) { st = { tier: "free", wallet: null, ahoy: 0, usd: 0, nfts: [], demo: false, token: null, checkedAt: 0 }; persist(); }
    return mode;
  }

  // Which tier a sea needs.
  function seaNeeds(sea) { return sea.access; }
  function canSail(sea) {
    if (sea.access === "free") return true;
    return TIER_RANK[st.tier] >= TIER_RANK[sea.access];
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
    if (mode !== "live") throw new Error("Wallet check needs the live game — this is the preview build.");
    const p = provider();
    if (!p) throw new Error("No Solana wallet found. Open this page in Phantom, Solflare or Backpack.");
    const res = await p.connect();
    const pk = (res && res.publicKey) || p.publicKey;
    const wallet = pk && pk.toString();
    if (!wallet) throw new Error("Wallet did not share an address.");
    const ch = await (await fetch(API + "/challenge", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ wallet }) })).json();
    if (!ch.ok) throw new Error(ch.error || "Could not start the check.");
    const enc = new TextEncoder().encode(ch.message);
    const sig = await p.signMessage(enc, "utf8");
    const sigBytes = sig && (sig.signature || sig);
    const r = await (await fetch(API + "/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ wallet, nonce: ch.nonce, signature: b58(new Uint8Array(sigBytes)) }) })).json();
    if (!r.ok) throw new Error(r.error || "Check failed.");
    st = { tier: r.tier, wallet, ahoy: r.ahoy || 0, usd: r.usd || 0, nfts: r.nfts || [], demo: false, token: r.token || null, checkedAt: Date.now(), unavailable: !!r.unavailable };
    persist();
    return st;
  }

  async function disconnect() {
    try { const p = provider(); if (p && p.disconnect) await p.disconnect(); } catch (_) {}
    st = { tier: "free", wallet: null, ahoy: 0, usd: 0, nfts: [], demo: false, token: null, checkedAt: 0 };
    AHOY.Save.set({ nft: null });
    persist();
  }

  // Preview build only: show the holder content to an audience, clearly labelled as a demo.
  function demoUnlock() {
    if (mode === "live") return st;
    st = { tier: "nft", wallet: null, ahoy: 0, usd: 0, demo: true, token: null, checkedAt: Date.now(),
      nfts: [{ id: "demo-16", name: "Pump Fun Pirates #16 (demo)", image: "assets/sprite/nft-demo.png",
        traits: { eyewear: "laser", beard: "neon", hat: "black", clothes: "tshirt", eyes: "brown", arm: "transparent" } }] };
    persist();
    return st;
  }

  return { boot, canSail, seaNeeds, needText, connectAndVerify, disconnect, demoUnlock,
    mode: () => mode, config: () => config, state: () => st, rank: (t) => TIER_RANK[t] || 0, provider };
})();
