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
    // SafePal is listed FIRST on purpose. Its in-app browser injects one window.solana that also
    // sets other wallets' compat flags (isPhantom, isGlow) so Phantom-only dapps work — which made
    // one SafePal show up as "Phantom" + "Glow". isSafePal / window.safepal is its TRUE identity and
    // no other wallet sets it, so checking it before the flags it mimics (with the dedupe in
    // available()) labels it SafePal instead of an impersonated name. A real Phantom (no isSafePal)
    // skips this entry and matches phantom below, unchanged.
    safepal:  { name: "SafePal",  icon: "🔐", download: "https://safepal.com/download",
                detect: function () { return (global.safepal && global.safepal.solana) || (global.safepalProvider && global.safepalProvider.solana) || (global.solana && global.solana.isSafePal ? global.solana : null); } },
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
    coin98:   { name: "Coin98",   icon: "🐋", download: "https://coin98.com/wallet",
                detect: function () { return (global.coin98 && global.coin98.sol) || (global.solana && global.solana.isCoin98 ? global.solana : null); } },
    nightly:  { name: "Nightly",  icon: "🌙", download: "https://nightly.app",
                detect: function () { return (global.nightly && global.nightly.solana) || (global.solana && global.solana.isNightly ? global.solana : null); } },
    mathwallet:{ name: "MathWallet", icon: "🧮", download: "https://mathwallet.org",
                detect: function () { return (global.solana && global.solana.isMathWallet ? global.solana : null); } },
    magiceden:{ name: "Magic Eden", icon: "🪄", download: "https://wallet.magiceden.io",
                detect: function () { return (global.magicEden && global.magicEden.solana) || (global.solana && global.solana.isMagicEden ? global.solana : null); } },
    bybit:    { name: "Bybit",    icon: "🟡", download: "https://www.bybit.com/web3",
                detect: function () { return (global.bybitWallet && global.bybitWallet.solana) || null; } },
    tokenpocket:{ name: "TokenPocket", icon: "🅣", download: "https://tokenpocket.pro",
                detect: function () { return (global.tokenpocket && global.tokenpocket.solana) || (global.solana && global.solana.isTokenPocket ? global.solana : null); } },
  };

  var ORDER = Object.keys(WALLETS);

  // ── Wallet Standard ───────────────────────────────────────────────────────────────────────
  // Everything above finds wallets by the LEGACY injection (`window.solana`, `window.phantom`…).
  // Newer wallets — Jupiter Mobile's in-app browser among them — announce themselves through the
  // Wallet Standard instead: the page dispatches "wallet-standard:app-ready" with a register
  // function, and each wallet calls it (or dispatches "wallet-standard:register-wallet" with a
  // callback that we hand the same register function). A wallet that speaks ONLY the standard was
  // invisible to available(), so someone standing inside that wallet's own browser was told to
  // "open this page in your wallet's browser" (2026-09-05, a Jupiter Mobile user). No package: the
  // protocol is two DOM events and a Set.
  //
  // The pages were written against the Phantom-style provider (connect() → {publicKey},
  // signTransaction(web3 Transaction) → signed Transaction, signAndSendTransaction(tx) →
  // {signature: base58}, signMessage(bytes) → {signature: bytes}). stdProvider() wraps a standard
  // wallet in exactly that shape, so no page changes. The wallet still shows its own approval UI.
  var STD_WALLETS = [];
  var STD_LISTENERS = [];
  function stdRegister() {
    for (var i = 0; i < arguments.length; i++) {
      var w = arguments[i];
      if (!w || STD_WALLETS.indexOf(w) !== -1) continue;
      STD_WALLETS.push(w);
    }
    for (var k = 0; k < STD_LISTENERS.length; k++) { try { STD_LISTENERS[k](); } catch (e) {} }
    return function () {};   // the standard's unregister; we never drop a wallet mid-page
  }
  var STD_API = { register: stdRegister };
  (function discover() {
    if (!global.addEventListener || !global.dispatchEvent) return;
    try {
      global.addEventListener("wallet-standard:register-wallet", function (ev) {
        var cb = ev && ev.detail;
        if (typeof cb === "function") { try { cb(STD_API); } catch (e) {} }
      });
    } catch (e) {}
    try { global.dispatchEvent(new CustomEvent("wallet-standard:app-ready", { detail: STD_API })); } catch (e) {}
    // Deprecated fallback some wallets still use: navigator.wallets.push(callback)
    try {
      var nav = global.navigator;
      if (nav) {
        var existing = Array.isArray(nav.wallets) ? nav.wallets.slice() : [];
        var shim = { push: function () { for (var i = 0; i < arguments.length; i++) { var cb = arguments[i]; if (typeof cb === "function") { try { cb(STD_API); } catch (e) {} } } } };
        try { Object.defineProperty(nav, "wallets", { value: shim, configurable: true }); } catch (e) { try { nav.wallets = shim; } catch (e2) {} }
        for (var i = 0; i < existing.length; i++) shim.push(existing[i]);
      }
    } catch (e) {}
  })();

  function stdIsSolana(w) {
    if (!w || !w.features || !w.chains) return false;
    var sol = false;
    for (var i = 0; i < w.chains.length; i++) if (/^solana:/.test(String(w.chains[i]))) sol = true;
    if (!sol) return false;
    if (!w.features["standard:connect"]) return false;
    return !!(w.features["solana:signTransaction"] || w.features["solana:signAndSendTransaction"] || w.features["solana:signMessage"]);
  }

  // Minimal base58 for the signature bytes signAndSendTransaction returns — pages pass that
  // string to Solscan and getSignatureStatuses, so it has to be the real encoding.
  var B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  function b58encode(bytes) {
    var digits = [0], i, j, carry;
    for (i = 0; i < bytes.length; i++) {
      carry = bytes[i];
      for (j = 0; j < digits.length; j++) { carry += digits[j] << 8; digits[j] = carry % 58; carry = (carry / 58) | 0; }
      while (carry > 0) { digits.push(carry % 58); carry = (carry / 58) | 0; }
    }
    var out = "";
    for (i = 0; i < bytes.length && bytes[i] === 0; i++) out += B58[0];
    for (i = digits.length - 1; i >= 0; i--) out += B58[digits[i]];
    return out;
  }

  function stdProvider(w) {
    var account = null;
    var pk = null;
    function mkPk(address) {
      var W3 = global.solanaWeb3;
      if (W3 && W3.PublicKey) { try { return new W3.PublicKey(address); } catch (e) {} }
      return { toString: function () { return address; }, toBase58: function () { return address; } };
    }
    function need() { if (!account) throw new Error("Connect the wallet first."); return account; }
    function toBytes(tx) {
      if (tx instanceof Uint8Array) return tx;
      // web3.js legacy Transaction: leave room for the wallet's signature; VersionedTransaction
      // serializes with no options.
      if (tx && typeof tx.serialize === "function") {
        return tx.version !== undefined ? tx.serialize() : tx.serialize({ requireAllSignatures: false, verifySignatures: false });
      }
      throw new Error("Unsupported transaction object.");
    }
    function fromBytes(bytes, like) {
      var W3 = global.solanaWeb3;
      if (like instanceof Uint8Array || !W3) return bytes;
      if (like && like.version !== undefined && W3.VersionedTransaction) return W3.VersionedTransaction.deserialize(bytes);
      return W3.Transaction.from(bytes);
    }
    var p = {
      isWalletStandard: true,
      standardWallet: w,
      name: w.name,
      publicKey: null,
      connect: function (opts) {
        return Promise.resolve(w.features["standard:connect"].connect(opts && opts.onlyIfTrusted ? { silent: true } : undefined)).then(function (r) {
          var accts = (r && r.accounts) || [];
          account = null;
          for (var i = 0; i < accts.length; i++) {
            var a = accts[i], ch = a && a.chains ? a.chains : [];
            for (var k = 0; k < ch.length; k++) if (/^solana:/.test(String(ch[k]))) { account = a; break; }
            if (account) break;
          }
          if (!account) account = accts[0] || null;
          if (!account || !account.address) throw new Error("Wallet returned no account.");
          pk = mkPk(String(account.address));
          p.publicKey = pk;
          return { publicKey: pk };
        });
      },
      disconnect: function () {
        var f = w.features["standard:disconnect"];
        account = null; pk = null; p.publicKey = null;
        return f && f.disconnect ? Promise.resolve(f.disconnect()).catch(function () {}) : Promise.resolve();
      },
      signTransaction: function (tx) {
        var f = w.features["solana:signTransaction"];
        if (!f) return Promise.reject(new Error(w.name + " cannot sign a transaction here."));
        return Promise.resolve(f.signTransaction({ transaction: toBytes(tx), account: need(), chain: "solana:mainnet" })).then(function (out) {
          var o = out && out[0];
          if (!o || !o.signedTransaction) throw new Error("Wallet returned no signed transaction.");
          return fromBytes(o.signedTransaction, tx);
        });
      },
      signAllTransactions: function (txs) {
        var f = w.features["solana:signTransaction"];
        if (!f) return Promise.reject(new Error(w.name + " cannot sign a transaction here."));
        var acct = need();
        var inputs = (txs || []).map(function (tx) { return { transaction: toBytes(tx), account: acct, chain: "solana:mainnet" }; });
        return Promise.resolve(f.signTransaction.apply(f, inputs)).then(function (out) {
          return (out || []).map(function (o, i) { return fromBytes(o.signedTransaction, txs[i]); });
        });
      },
      signAndSendTransaction: function (tx, options) {
        var f = w.features["solana:signAndSendTransaction"];
        if (!f) {
          // Wallet signs only: send it ourselves through the page's RPC, like the pages already do
          // for the sign-first flows. Keeps the "wallet signs FIRST" rule intact.
          return p.signTransaction(tx).then(function (signed) {
            var raw = signed instanceof Uint8Array ? signed : signed.serialize();
            if (!global.CluckUtil || !global.CluckUtil.rpc) throw new Error(w.name + " cannot send from here.");
            var b = ""; for (var i = 0; i < raw.length; i++) b += String.fromCharCode(raw[i]);
            return global.CluckUtil.rpc("sendTransaction", [btoa(b), { encoding: "base64", skipPreflight: !!(options && options.skipPreflight), maxRetries: 3 }])
              .then(function (sig) { return { signature: sig, publicKey: pk }; });
          });
        }
        return Promise.resolve(f.signAndSendTransaction({ transaction: toBytes(tx), account: need(), chain: "solana:mainnet", options: options || undefined })).then(function (out) {
          var o = out && out[0];
          if (!o || !o.signature) throw new Error("Wallet returned no signature.");
          return { signature: b58encode(o.signature), publicKey: pk };
        });
      },
      signMessage: function (msg) {
        var f = w.features["solana:signMessage"];
        if (!f) return Promise.reject(new Error(w.name + " cannot sign a message here."));
        var bytes = msg instanceof Uint8Array ? msg : new TextEncoder().encode(String(msg));
        return Promise.resolve(f.signMessage({ message: bytes, account: need() })).then(function (out) {
          var o = out && out[0];
          if (!o || !o.signature) throw new Error("Wallet returned no signature.");
          return { signature: o.signature, publicKey: pk };
        });
      },
    };
    return p;
  }
  var STD_PROVIDERS = [];   // one shim per standard wallet, reused across available() calls
  function stdProviderFor(w) {
    for (var i = 0; i < STD_PROVIDERS.length; i++) if (STD_PROVIDERS[i].standardWallet === w) return STD_PROVIDERS[i];
    var p = stdProvider(w); STD_PROVIDERS.push(p); return p;
  }
  function slug(name) { return String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, ""); }
  // Standard wallets as picker entries. A wallet that ALSO injects the legacy object (Phantom,
  // Solflare, Backpack all do) is already in `found` under its registry id — skip it by name so
  // one wallet is one button. A standard-only wallet whose name matches a registry entry (Jupiter)
  // takes that id and icon; anything else gets a generic id and its own icon.
  function stdEntries(found) {
    var out = [];
    var names = {};
    for (var i = 0; i < found.length; i++) names[slug(found[i].name)] = true;
    for (var k = 0; k < STD_WALLETS.length; k++) {
      var w = STD_WALLETS[k];
      if (!stdIsSolana(w)) continue;
      var nm = slug(w.name);
      if (names[nm]) continue;
      names[nm] = true;
      var id = null;
      for (var j = 0; j < ORDER.length; j++) if (slug(WALLETS[ORDER[j]].name) === nm) { id = ORDER[j]; break; }
      out.push({ id: id || ("std:" + nm), name: String(w.name || "Wallet"), icon: id ? WALLETS[id].icon : "👛", provider: stdProviderFor(w), standard: true });
    }
    return out;
  }

  var state = { provider: null, pubkey: null, id: null };

  // A wallet's OWN in-app browser is the most reliable identity signal there is: it names itself in
  // the user-agent, no matter how many other wallets' compat flags it sets on window.solana. SafePal
  // was showing as "Phantom" + "Glow" (it impersonates both, as separate provider objects the
  // identity-dedupe below can't merge, and it doesn't set isSafePal) — but its browser UA contains
  // "SafePal". When we're inside a known wallet browser, that wallet IS the only real wallet present,
  // so return JUST it (pointed at the injected provider). Extend UA_WALLETS as other impersonating
  // in-app browsers turn up. A miss here is harmless — it simply falls through to flag detection.
  var UA_WALLETS = [
    { re: /SafePal/i,   id: "safepal" },
    { re: /Coin98/i,    id: "coin98" },
    { re: /TokenPocket/i, id: "tokenpocket" },
    { re: /JupiterMobile|Jupiter Mobile|JupMobile/i, id: "jupiter" }
  ];
  function browserWallet() {
    var ua = (global.navigator && global.navigator.userAgent) || "";
    for (var i = 0; i < UA_WALLETS.length; i++) {
      if (!UA_WALLETS[i].re.test(ua)) continue;
      var w = WALLETS[UA_WALLETS[i].id]; if (!w) continue;
      var pv = null; try { pv = w.detect(); } catch (e) { pv = null; }
      if (!pv) {
        // Not injected the legacy way — but if it registered through the Wallet Standard, that
        // IS the wallet (Jupiter Mobile). Only then fall back to a bare window.solana.
        var se = stdEntries([]);
        for (var q = 0; q < se.length; q++) if (se[q].id === UA_WALLETS[i].id) { pv = se[q].provider; break; }
      }
      if (!pv) pv = global.solana;   // UA says it's here even if its flags are unusual
      if (pv) return { id: UA_WALLETS[i].id, name: w.name, icon: w.icon, provider: pv };
    }
    return null;
  }

  function available() {
    // Inside a wallet's own in-app browser, trust the UA over injected flags — one correct button.
    var bw = browserWallet(); if (bw) return [bw];
    var out = [], seen = [];
    for (var i = 0; i < ORDER.length; i++) {
      var id = ORDER[i], p = null;
      try { p = WALLETS[id].detect(); } catch (e) { p = null; }
      if (!p) continue;
      // Dedupe by provider IDENTITY. Some wallets inject a SINGLE window.solana that sets
      // compatibility flags for others (SafePal, for one, presents so that Phantom-only dapps
      // work) — so several detectors match the exact same object. Without this, one SafePal shows
      // up as two or three buttons ("Phantom" + "Glow"), all connecting to the same wallet. Keep
      // the first match in ORDER; genuinely-separate providers (distinct objects) still list apart.
      var dup = false;
      for (var k = 0; k < seen.length; k++) { if (seen[k] === p) { dup = true; break; } }
      if (dup) continue;
      seen.push(p);
      out.push({ id: id, name: WALLETS[id].name, icon: WALLETS[id].icon, provider: p });
    }
    // Wallet Standard wallets that were not already found by injection (see stdEntries).
    var std = stdEntries(out);
    for (var m = 0; m < std.length; m++) out.push(std[m]);
    // Last resort: an injected wallet we don't have a signature for still works
    // if it speaks the standard interface. Better a generic entry than a dead end.
    if (!out.length && global.solana) out.push({ id: "unknown", name: "Wallet", icon: "👛", provider: global.solana });
    return out;
  }

  // ── mobile: is this a phone/tablet browser that can't have an extension? ──────────────────
  // iPadOS Safari reports a MACINTOSH user-agent by default (desktop-class browsing), so the
  // usual /iPad/ regex misses every modern iPad and the page tells an iPad user to "install a
  // wallet extension" — advice that cannot be followed on iPadOS. maxTouchPoints separates a
  // real Mac (0) from an iPad pretending to be one. Five pages carried the regex WITHOUT this
  // clause and one (premium) with it; that divergence is why it lives here now.
  function isMobile() {
    var ua = (global.navigator && global.navigator.userAgent) || "";
    if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua)) return true;
    return !!(global.navigator && global.navigator.maxTouchPoints > 1 && /Macintosh/.test(ua));
  }

  function isAndroid() { return /Android/i.test((global.navigator && global.navigator.userAgent) || ""); }
  function isIOS() {
    var ua = (global.navigator && global.navigator.userAgent) || "";
    if (/iPhone|iPad|iPod/i.test(ua)) return true;
    return !!(global.navigator && global.navigator.maxTouchPoints > 1 && /Macintosh/.test(ua));
  }

  // ── "open this page in a wallet's own browser" links ──────────────────────────────────────
  // On a plain mobile browser NOTHING is injected, so available() is empty and the only way to
  // get a real wallet onto the page is to reopen it inside the wallet's built-in browser. iOS
  // leaves no alternative: Mobile Wallet Adapter is an Android-only protocol (it needs a
  // persistent socket, which iOS kills when an app backgrounds), so these links are it.
  //
  // ⚠️ EVERY ENTRY HERE IS A DOCUMENTED FORMAT, NOT A GUESS. A deeplink invented by
  // pattern-matching another wallet's scheme ships as a dead button on a live money page, so the
  // bar for adding a row is an official doc or the wallet's own apple-app-site-association.
  // Researched 2026-08-22; `src` is where each came from. Wallets deliberately ABSENT because no
  // browse link could be verified — do not add them on a hunch:
  //   Jupiter   — has a dApp browser, but jup.ag's AASA claims only /swap /tokens /portfolio etc.
  //               There is no /ul/ or /browse/ path for the app to catch, and its only registry
  //               entry is a WalletConnect scheme. Anything written here would be invented.
  //   SafePal   — two contradictory community formats circulate and the repos carrying them are
  //               drainer-adjacent. Nothing credible.
  //   Exodus    — AASA claims only /m/*, which is WalletConnect.
  //   Bybit     — its browse scheme exists for Aptos/Sui/Tron only, and says "connect", not browse.
  //   Coin98 / TokenPocket — templates are documented but neither names a Solana chain value.
  // All five DO have in-app browsers, so the copy below tells people they can open the page
  // there by hand. That is honest and it works; a fake button is neither.
  //
  // Prefer https universal links over custom schemes: a custom scheme tapped in Safari with the
  // app absent dead-ends silently, while the https form lands on a download page.
  var DEEPLINKS = [
    { id: "phantom",  name: "Phantom",  icon: "🔮", ios: true,  android: true,
      src: "docs.phantom.app",
      build: function (u, ref) { return "https://phantom.app/ul/browse/" + u + "?ref=" + ref; } },
    { id: "solflare", name: "Solflare", icon: "☀️", ios: true,  android: true,
      src: "docs.solflare.com",
      build: function (u, ref) { return "https://solflare.com/ul/v1/browse/" + u + "?ref=" + ref; } },
    { id: "backpack", name: "Backpack", icon: "🎒", ios: true,  android: true,
      src: "docs.backpack.app/deeplinks/other-methods/browse — both params required",
      build: function (u, ref) { return "https://backpack.app/ul/v1/browse/" + u + "?ref=" + ref; } },
    { id: "coinbase", name: "Coinbase", icon: "🔵", ios: true,  android: true,
      src: "docs.cdp.coinbase.com mobile-dapp-integration",
      build: function (u) { return "https://go.cb-w.com/dapp?cb_url=" + u; } },
    { id: "bitget",   name: "Bitget",   icon: "💠", ios: true,  android: true,
      src: "web3.bitget.com/en/docs/reference/deeplink — https form works on both",
      build: function (u) { return "https://bkcode.vip?action=dapp&url=" + u; } },
    { id: "magiceden", name: "Magic Eden", icon: "🪄", ios: true, android: true,
      src: "magiceden.io AASA claims /browser/* for com.magiceden.wallet (not in prose docs)",
      build: function (u) { return "https://magiceden.io/browser/" + u; } },
    { id: "nightly",  name: "Nightly",  icon: "🌙", ios: true,  android: true,
      src: "docs.nightly.app/docs/deeplinks",
      build: function (u) { return "https://nightly.app/v1?network=solana&cluster=mainnet&url=" + u; } },
    // OKX publishes no https browse link — only the okx:// scheme. Wrapping it in OKX's own
    // download universal link is what makes it safe to show: app installed → it opens; app
    // missing → the OKX download page, instead of Safari's dead-end sheet.
    { id: "okx",      name: "OKX",      icon: "⭕", ios: true,  android: true,
      src: "OKX WaaS app-universal-link (page 404s today; two extractions + wallet registries agree)",
      build: function (u) {
        return "https://web3.okx.com/download?deeplink=" +
               encodeURIComponent("okx://wallet/dapp/url?dappUrl=" + u);
      } },
    // ANDROID ONLY, and this is not a nicety: Trust removed its iOS DApp browser in v6.0 (2021)
    // and never restored it, so an iOS button for Trust is dead by construction.
    { id: "trust",    name: "Trust",    icon: "🛡", ios: false, android: true,
      src: "developer.trustwallet.com deeplinking — coin_id 501 = Solana",
      build: function (u) { return "https://link.trustwallet.com/open_url?coin_id=501&url=" + u; } },
  ];

  // Wallets with a real in-app browser that publish no usable browse link (see above). Named in
  // the copy so a user of one is told what to do rather than left thinking we don't support them.
  var BROWSER_NO_LINK = ["Jupiter", "SafePal", "Exodus", "Bybit"];

  // Links for THIS device: an entry is dropped where the wallet has no in-app browser on this
  // platform. On desktop (no platform match) the full list is returned — a QR/hand-off surface
  // may still want it.
  function deeplinks(target) {
    var raw = target || (global.location && global.location.href) || "";
    var u = encodeURIComponent(raw);
    var ref = encodeURIComponent((global.location && global.location.origin) || "");
    var ios = isIOS(), android = isAndroid();
    var out = [];
    for (var i = 0; i < DEEPLINKS.length; i++) {
      var d = DEEPLINKS[i];
      if (ios && !d.ios) continue;
      if (android && !d.android) continue;
      out.push({ id: d.id, name: d.name, icon: d.icon, href: d.build(u, ref) });
    }
    return out;
  }

  // Renders the whole "no wallet here — open it in one" block. Every page kept its own copy of
  // this markup with a hardcoded Phantom + Solflare pair; six of them had drifted apart and none
  // had been updated since. Pass your page's own classes so it still looks like your page.
  function mobileLinksHTML(opts) {
    opts = opts || {};
    // Shared escaper when /cluck-util.js is loaded (it usually is, just after this file);
    // the inline body is only the fallback for a page that loads this module alone.
    var esc = function (t) {
      if (global.CluckUtil && global.CluckUtil.esc) return global.CluckUtil.esc(t);
      return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
                      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    };
    var what = opts.what || "this page";
    var bc = opts.btnClass || "btn sm";
    var bs = "text-decoration:none;" + (opts.btnStyle || "");
    var hc = opts.hintClass || "hint";
    var hs = opts.hintStyle || "";
    var h = function (body, extra) {
      return '<div class="' + esc(hc) + '" style="' + esc(hs) + (extra || "") + '">' + body + "</div>";
    };
    var links = deeplinks(opts.target), html = "";
    html += h("📱 Open " + esc(what) + " inside a wallet’s browser to connect:");
    for (var i = 0; i < links.length; i++) {
      html += '<a class="' + esc(bc) + '" style="' + esc(bs) + '" href="' + esc(links[i].href) + '">' +
              links[i].icon + " " + esc(links[i].name) + "</a>";
    }
    html += h("Opens this exact page in the wallet’s built-in browser. Nothing is signed or shared by the link.", "width:100%;");
    html += h("Using " + BROWSER_NO_LINK.join(", ") + " or another wallet? They have built-in browsers too — open " +
              "<b>" + esc((global.location && global.location.host) || "") +
              esc((global.location && global.location.pathname) || "") + "</b> in there and Connect will work.",
              "width:100%;");
    if (opts.footer) html += h(esc(opts.footer), "width:100%;");
    return html;
  }

  // ── late provider injection ───────────────────────────────────────────────────────────────
  // A wallet's in-app browser does NOT always have its provider on the page by the time our
  // script runs — several inject on or after `load`, and some fire the de-facto standard
  // `solana#initialized` event when they're ready. A page that calls available() once at parse
  // time therefore shows "no wallet detected" to someone who is standing INSIDE the wallet.
  // watch(cb) calls cb() whenever the set of detected wallets changes, from now until `ms`
  // (default 8s) after load. Pages should render their picker from it instead of hand-rolling
  // another pair of setTimeouts — the old ones were 600ms/1600ms, which is not long enough for
  // a cold in-app browser on a slow phone.
  function watch(cb, ms) {
    if (typeof cb !== "function") return function () {};
    var stopped = false, timers = [], last = "";
    var deadline = Date.now() + (ms > 0 ? ms : 8000);
    function sig() {
      try { return available().map(function (w) { return w.id; }).join(","); } catch (e) { return ""; }
    }
    function tick() {
      if (stopped) return;
      var s = sig();
      if (s !== last) { last = s; try { cb(); } catch (e) {} }
      if (Date.now() < deadline) timers.push(setTimeout(tick, 400));
    }
    last = sig();
    function poke() { if (!stopped) { last = "\u0000"; tick(); } }   // force a re-render on an explicit signal
    STD_LISTENERS.push(poke);                                            // a standard wallet registering late
    try { global.addEventListener("solana#initialized", poke); } catch (e) {}
    try { global.addEventListener("load", poke); } catch (e) {}
    timers.push(setTimeout(tick, 400));
    return function stop() {
      stopped = true;
      for (var i = 0; i < timers.length; i++) clearTimeout(timers[i]);
      var at = STD_LISTENERS.indexOf(poke); if (at !== -1) STD_LISTENERS.splice(at, 1);
      try { global.removeEventListener("solana#initialized", poke); } catch (e) {}
      try { global.removeEventListener("load", poke); } catch (e) {}
    };
  }

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

  // Export only what pages call (WALLETS, available, connect, disconnect, isMobile, mobileLinksHTML,
  // watch). deeplinks stays for a QR/hand-off surface; shortAddr lives in /cluck-util.js.
  global.CluckWallet = {
    WALLETS: WALLETS,
    available: available,
    connect: connect,
    disconnect: disconnect,
    isMobile: isMobile,
    deeplinks: deeplinks,
    mobileLinksHTML: mobileLinksHTML,
    watch: watch,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
