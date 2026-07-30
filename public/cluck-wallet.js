/* Cluck Norris — shared wallet layer.
 *
 * WHY THIS EXISTS: every page that connects a wallet had grown its own detector,
 * and they had silently diverged. As of 2026-07-30 the airdropper, hatchery,
 * wallet-checkup, premium and transcript each carried an 11-wallet list, while
 * Buy Special's gate detected TWO (Phantom, Solflare) behind a generic
 * `window.solana` fallback and the Locker Room detected three. A Backpack or OKX
 * user was told "no Solana wallet found" on one page and connected fine on the
 * next — with no way to tell which pages were which.
 *
 * So the registry lives here once. Add a wallet to WALLETS and every page that
 * loads this file gains it.
 *
 * ⚠️ public/ is NOT statically mounted — this file needs its explicit app.get
 * route in server.js (next to /market-header.js), or it 404s.
 *
 * RULE, non-negotiable: anywhere a user can CONNECT, they must be able to
 * DISCONNECT. Otherwise switching wallets means clearing site data, which is not
 * a thing to ask of anyone. `disconnect()` below is the shared implementation.
 */
(function (global) {
  "use strict";

  // Detection notes: most wallets inject a dedicated namespace, but several also
  // (or only) take over window.solana with an isX flag — so each entry checks the
  // dedicated object first and falls back to the flagged window.solana.
  var WALLETS = {
    phantom:  { name: "Phantom",  icon: "🔮", download: "https://phantom.app",
                detect: function () { return (global.phantom && global.phantom.solana) || (global.solana && global.solana.isPhantom ? global.solana : null); } },
    solflare: { name: "Solflare", icon: "☀️", download: "https://solflare.com",
                detect: function () { return global.solflare || (global.solana && global.solana.isSolflare ? global.solana : null); } },
    backpack: { name: "Backpack", icon: "🎒", download: "https://backpack.app",
                detect: function () { return (global.backpack && global.backpack.isBackpack ? global.backpack : null) || (global.solana && global.solana.isBackpack ? global.solana : null); } },
    okx:      { name: "OKX",      icon: "⭕", download: "https://okx.com/web3",
                detect: function () { return (global.okxwallet && global.okxwallet.solana) || global.okxwallet || null; } },
    coinbase: { name: "Coinbase", icon: "🔵", download: "https://coinbase.com/wallet",
                detect: function () { return global.coinbaseSolana || global.coinbaseWalletSolana || null; } },
    trust:    { name: "Trust",    icon: "🛡", download: "https://trustwallet.com",
                detect: function () { return (global.trustwallet && global.trustwallet.solana) || (global.solana && global.solana.isTrust ? global.solana : null); } },
    glow:     { name: "Glow",     icon: "🌟", download: "https://glow.app",
                detect: function () { return global.glowSolana || (global.glow && global.glow.solana) || (global.solana && global.solana.isGlow ? global.solana : null); } },
    exodus:   { name: "Exodus",   icon: "🚀", download: "https://exodus.com",
                detect: function () { return (global.exodus && global.exodus.solana) || null; } },
    bitget:   { name: "Bitget",   icon: "💠", download: "https://web3.bitget.com",
                detect: function () { return (global.bitkeep && global.bitkeep.solana) || (global.bitgetWallet && global.bitgetWallet.solana) || null; } },
    brave:    { name: "Brave",    icon: "🦁", download: "https://brave.com/wallet",
                detect: function () { return global.braveSolana || (global.solana && global.solana.isBraveWallet ? global.solana : null); } },
    jupiter:  { name: "Jupiter",  icon: "🪐", download: "https://jup.ag/mobile",
                detect: function () { return global.jupiterWallet || global.jupiter || (global.solana && global.solana.isJupiter ? global.solana : null); } },
  };

  var ORDER = Object.keys(WALLETS);

  var state = { provider: null, pubkey: null, id: null };

  function available() {
    var out = [];
    for (var i = 0; i < ORDER.length; i++) {
      var id = ORDER[i], p = null;
      try { p = WALLETS[id].detect(); } catch (e) { p = null; }
      if (p) out.push({ id: id, name: WALLETS[id].name, icon: WALLETS[id].icon, provider: p });
    }
    // Last resort: an injected wallet we don't have a signature for still works
    // if it speaks the standard interface. Better a generic entry than a dead end.
    if (!out.length && global.solana) out.push({ id: "unknown", name: "Wallet", icon: "👛", provider: global.solana });
    return out;
  }

  function shortAddr(a) { return a ? a.slice(0, 4) + "…" + a.slice(-4) : "—"; }

  async function connect(id) {
    var entry = null, list = available();
    if (id) {
      for (var i = 0; i < list.length; i++) if (list[i].id === id) entry = list[i];
      if (!entry) {
        var w = WALLETS[id];
        throw new Error((w ? w.name : "That wallet") + " isn't detected in this browser. Open this page in its own browser, or install the extension.");
      }
    } else {
      if (!list.length) throw new Error("No Solana wallet found. Install one, or open this page inside your wallet's browser.");
      entry = list[0];
    }
    var resp = await entry.provider.connect();
    var pubkey = (resp && resp.publicKey && resp.publicKey.toString()) ||
                 (entry.provider.publicKey && entry.provider.publicKey.toString());
    if (!pubkey) throw new Error("Wallet returned no public key.");
    state = { provider: entry.provider, pubkey: pubkey, id: entry.id };
    return { provider: entry.provider, pubkey: pubkey, name: entry.name, id: entry.id };
  }

  // Best-effort on the wallet's side, unconditional on ours. Not every injected
  // provider implements disconnect(), so clearing our own state is what actually
  // has to happen — never leave the UI showing a wallet we've stopped using.
  function disconnect() {
    try { if (state.provider && state.provider.disconnect) state.provider.disconnect(); } catch (e) {}
    state = { provider: null, pubkey: null, id: null };
  }

  function current() { return { provider: state.provider, pubkey: state.pubkey, id: state.id }; }

  global.CluckWallet = {
    WALLETS: WALLETS,
    order: ORDER,
    available: available,
    connect: connect,
    disconnect: disconnect,
    current: current,
    shortAddr: shortAddr,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
