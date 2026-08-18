/* Cluck Norris — unified tools pass (owner's call, 2026-08-18, for the app-store era).
   ONE rule across every heavy tool: hold $50 worth of CLKN and everything unlocks free,
   or pay 0.05 SOL once for a 7-day ALL-TOOLS pass. Quick safety tools (Wallet Checkup,
   Firepit, Locker Room) and the school stay free — guardrails before power.

   Usage on a gated page (after cluck-util.js + cluck-wallet.js):
     run = CluckGate.guard(run, { tool: 'Wallet X-Ray', anchor: '#runBtn' });
   The tool renders normally — the gate appears at the moment of RUN ("preview everything,
   unlock to run"). Buy Special drives its own gate UI off CluckGate.config()/CluckGate.grant().

   Server truth: /api/tool-gate/config publishes the live numbers (the CLKN amount is derived
   from the live price — NEVER hardcode it); /api/verify-sol-payment confirms the payment
   (replay-guarded + receiver-checked server-side); /api/tool-comp/check honors comped wallets.
   The pass lives in localStorage under ONE key shared by all tools. FAIL-OPEN: if our config
   or price feed is down, the tool runs free on a short grace pass — an outage on our side
   must never lock users out. */
(function (global) {
  var KEY = 'clkn_tools_unlock';
  var LEGACY_KEYS = ['clkn_buyspecial_unlock'];   // pre-unification passes keep working until they expire
  var cfg = null, cfgAt = 0;

  function pass() {
    try {
      var d = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (d && d.expiresAt > Date.now()) return d;
      for (var i = 0; i < LEGACY_KEYS.length; i++) {
        var l = JSON.parse(localStorage.getItem(LEGACY_KEYS[i]) || 'null');
        if (l && l.expiresAt > Date.now()) return { expiresAt: l.expiresAt, why: 'legacy' };
      }
    } catch (e) {}
    return null;
  }
  function grant(days, why) {
    var d = { unlockedAt: Date.now(), expiresAt: Date.now() + days * 24 * 60 * 60 * 1000, why: why || 'paid' };
    try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) {}
    return d;
  }
  async function config() {
    if (cfg && Date.now() - cfgAt < 60000) return cfg;
    try {
      var r = await fetch('/api/tool-gate/config');
      var d = await r.json();
      if (d && d.success) { cfg = d; cfgAt = Date.now(); return d; }
    } catch (e) {}
    return null;   // caller treats null as "fail open"
  }

  // ---- gate card UI ---------------------------------------------------------
  var esc = function (s) { return (global.CluckUtil ? CluckUtil.esc(s) : String(s)); };
  var fmtI = function (n) { return Number(n || 0).toLocaleString('en-US'); };
  var css = ''
    + '.ckg-card{background:var(--card);border:1px solid var(--gold);border-radius:14px;padding:18px;margin:14px 0;box-shadow:0 14px 40px -18px rgba(255,182,39,.35)}'
    + '.ckg-h{font-family:var(--disp);font-size:17px;letter-spacing:1.5px;color:var(--gold);margin-bottom:6px}'
    + '.ckg-p{font-family:var(--body);font-size:13.5px;line-height:1.6;color:var(--body-text);margin:0 0 10px}'
    + '.ckg-p b{color:var(--gold)}'
    + '.ckg-row{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0 0}'
    + '.ckg-btn{border:none;border-radius:10px;padding:12px 16px;font-family:var(--disp);letter-spacing:1.5px;font-size:13px;cursor:pointer}'
    + '.ckg-main{background:linear-gradient(135deg,var(--gold),var(--orange));color:#1a1208}'
    + '.ckg-ghost{background:rgba(255,255,255,.04);border:1px solid var(--border);color:var(--text)}'
    + '.ckg-btn:disabled{background:rgba(255,255,255,.05);color:var(--muted);cursor:wait}'
    + '.ckg-note{font-family:var(--mono);font-size:12.5px;color:var(--sub);margin-top:10px;line-height:1.55}'
    + '.ckg-status{font-family:var(--mono);font-size:12.5px;margin-top:10px;color:var(--sub)}'
    + '.ckg-status.ok{color:var(--green)}'
    + '.ckg-free{font-family:var(--mono);font-size:12.5px;color:var(--muted);margin-top:8px}'
    + '.ckg-wallets{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}';
  function injectCss() {
    if (document.getElementById('ckg-css')) return;
    var st = document.createElement('style'); st.id = 'ckg-css'; st.textContent = css;
    document.head.appendChild(st);
  }

  var state = { provider: null, pubkey: null, card: null, onUnlock: null, paying: false };

  function statusEl() { return state.card && state.card.querySelector('.ckg-status'); }
  function say(msg, ok) { var s = statusEl(); if (s) { s.textContent = msg; s.className = 'ckg-status' + (ok ? ' ok' : ''); } }

  function buildCard(c, toolName) {
    injectCss();
    var card = document.createElement('div');
    card.className = 'ckg-card';
    var clkLine = c.clknNeeded
      ? 'Hold about <b>' + fmtI(c.clknNeeded) + ' CLKN</b> (≈$' + fmtI(c.holdUsd) + ' worth at the live price) and <b>every</b> heavy tool is free while you hold.'
      : 'Hold <b>$' + fmtI(c.holdUsd) + ' worth of CLKN</b> and <b>every</b> heavy tool is free while you hold.';
    card.innerHTML =
      '<div class="ckg-h">🔓 ' + esc(toolName) + ' — CLUCK TOOLS PASS</div>'
      + '<p class="ckg-p">' + clkLine + ' Not holding? <b>' + (c.lamports / 1e9) + ' SOL</b> unlocks all of them for <b>' + c.days + ' days</b> — one click, one payment, nothing else to sign.</p>'
      + '<div class="ckg-row">'
      + '<button class="ckg-btn ckg-main" data-ckg="connect">🔗 CONNECT — CHECK MY CLKN</button>'
      + '<button class="ckg-btn ckg-ghost" data-ckg="pay" style="display:none">⚡ PAY ' + (c.lamports / 1e9) + ' SOL · ' + c.days + ' DAYS</button>'
      + '<a class="ckg-btn ckg-ghost" href="/clkn" style="text-decoration:none">🐔 GET CLKN</a>'
      + '<button class="ckg-btn ckg-ghost" data-ckg="disconnect" style="display:none">DISCONNECT</button>'
      + '</div>'
      + '<div class="ckg-wallets" style="display:none"></div>'
      + '<div class="ckg-status"></div>'
      + '<div class="ckg-note">Connecting is a <b>read-only balance check</b> — no approvals, no delegates. The only transaction is the optional SOL payment, which you read and sign in your own wallet.</div>'
      + '<div class="ckg-free">Always free, no pass needed: Wallet Checkup · Firepit · Locker Room · the whole school.</div>';
    card.addEventListener('click', function (e) {
      var b = e.target.closest('[data-ckg]');
      if (!b) return;
      if (b.dataset.ckg === 'connect') connect(c);
      else if (b.dataset.ckg === 'pay') payWith(c, b);
      else if (b.dataset.ckg === 'disconnect') disconnect();
    });
    return card;
  }

  function disconnect() {
    try { state.provider && state.provider.disconnect && state.provider.disconnect(); } catch (e) {}
    state.provider = null; state.pubkey = null;
    if (!state.card) return;
    state.card.querySelector('[data-ckg="connect"]').style.display = '';
    state.card.querySelector('[data-ckg="pay"]').style.display = 'none';
    state.card.querySelector('[data-ckg="disconnect"]').style.display = 'none';
    say('');
  }

  async function connect(c) {
    var list = (global.CluckWallet && CluckWallet.available()) || [];
    if (!list.length) { say('No Solana wallet found — install one, or open this page inside your wallet’s browser, then refresh.'); return; }
    if (list.length === 1) return connectWith(list[0], c);
    // several wallets installed → let the user pick (never silently grab the first)
    var row = state.card.querySelector('.ckg-wallets');
    row.style.display = '';
    row.innerHTML = list.map(function (w, i) {
      return '<button class="ckg-btn ckg-ghost" data-ckgw="' + i + '">' + esc(w.icon || '👛') + ' ' + esc(w.name) + '</button>';
    }).join('');
    row.onclick = function (e) {
      var b = e.target.closest('[data-ckgw]'); if (!b) return;
      row.style.display = 'none';
      connectWith(list[Number(b.dataset.ckgw)], c);
    };
  }

  async function connectWith(w, c) {
    try {
      say('Connecting ' + w.name + '…');
      var resp = await w.provider.connect();
      state.pubkey = ((resp && resp.publicKey) || w.provider.publicKey).toString();
      state.provider = w.provider;
      state.card.querySelector('[data-ckg="connect"]').style.display = 'none';
      state.card.querySelector('[data-ckg="disconnect"]').style.display = '';
      say(w.name + ' · ' + CluckUtil.shortAddr(state.pubkey) + ' — checking your CLKN…');
      await checkHolder(c, w.name);
    } catch (e) { say('Connect failed: ' + (e.message || e)); }
  }

  async function checkHolder(c, walletName) {
    // comped wallets (server-side list) unlock free regardless of balance.
    // FUTURE (owner, 2026-08-18): lifetime-pass NFTs slot in HERE — when the collection
    // exists, /api/tool-comp/check grows a DAS collection lookup server-side and returns
    // {comped:true, why:'nft'}; no client change needed beyond the label.
    try {
      var comp = await fetch('/api/tool-comp/check?wallet=' + encodeURIComponent(state.pubkey)).then(function (r) { return r.json(); });
      if (comp && comp.comped) { grant(3650, 'comp'); say('✓ Comped wallet — unlocked.', true); return finish(); }
    } catch (e) {}
    try {
      var r = await CluckUtil.rpc('getTokenAccountsByOwner', [state.pubkey, { mint: c.mint }, { encoding: 'jsonParsed' }]);
      var bal = 0;
      // uiAmountString, not uiAmount — the float is null for whale-sized balances
      ((r && r.value) || []).forEach(function (a) {
        var ta = a.account && a.account.data && a.account.data.parsed && a.account.data.parsed.info.tokenAmount;
        bal += Number(ta && (ta.uiAmountString || ta.uiAmount)) || 0;
      });
      var worth = c.priceUsd ? bal * c.priceUsd : null;
      if (c.clknNeeded && bal >= c.clknNeeded) {
        grant(c.days, 'holder');
        say('✓ ' + (walletName || 'Holder') + ' — ' + fmtI(Math.floor(bal)) + ' CLKN (≈$' + fmtI(Math.floor(worth || 0)) + '). All tools free.', true);
        return finish();
      }
      if (!c.clknNeeded) {
        // price feed down — never punish the user for our outage
        grant(1, 'grace');
        say('✓ Unlocked (price check unavailable right now).', true);
        return finish();
      }
      say('This wallet holds ' + fmtI(Math.floor(bal)) + ' CLKN (≈$' + fmtI(Math.floor(worth || 0)) + ') — the free tier needs ≈' + fmtI(c.clknNeeded) + ' ($' + fmtI(c.holdUsd) + ' worth). Top up, or take the SOL pass:');
      state.card.querySelector('[data-ckg="pay"]').style.display = '';
    } catch (e) { say('Balance check failed: ' + (e.message || e)); }
  }

  // Payment libs load only if someone actually pays — free pages stay light.
  function loadScript(src, integrity) {
    return new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = src; if (integrity) { s.integrity = integrity; s.crossOrigin = 'anonymous'; }
      s.onload = res; s.onerror = function () { rej(new Error('failed to load ' + src)); };
      document.head.appendChild(s);
    });
  }
  async function ensurePayLibs() {
    if (typeof global.solanaWeb3 === 'undefined') {
      await loadScript('/vendor/solana-web3-1.95.8.iife.min.js',
        'sha384-ujeTtvHxhu2g5lnu14Roii2ajvVKJ74KQ6eo6GGfAi0IrKZ1YkF8N68Iw5VmIJO0');
    }
    if (!(global.splToken && global.splToken.createSolTransferInstruction)) {
      await loadScript('/airdrop-engine.js');
    }
  }

  async function payWith(c, btn) {
    if (state.paying) return;
    if (!state.provider || !state.pubkey) return connect(c);
    state.paying = true; btn.disabled = true;
    try {
      say('Loading payment libraries…');
      await ensurePayLibs();
      var bh = await CluckUtil.rpc('getLatestBlockhash', [{ commitment: 'finalized' }]);
      var Transaction = solanaWeb3.Transaction, PublicKey = solanaWeb3.PublicKey;
      // Hand-built System transfer via the shared engine — SystemProgram.transfer()
      // throws "Buffer is not defined" in the browser (see airdrop-engine.js).
      var tx = new Transaction();
      tx.add(splToken.createSolTransferInstruction(new PublicKey(state.pubkey), new PublicKey(c.receiver), c.lamports));
      tx.feePayer = new PublicKey(state.pubkey); tx.recentBlockhash = bh.value.blockhash;
      say('Approve the ' + (c.lamports / 1e9) + ' SOL payment in your wallet…');
      var res = await state.provider.signAndSendTransaction(tx);
      var sig = (res && res.signature) || (typeof res === 'string' ? res : null);
      if (!sig) throw new Error('wallet returned no signature');
      say('Confirming payment on-chain…');
      var ok = false;
      for (var i = 0; i < 24; i++) {
        try { var v = await fetch('/api/verify-sol-payment?sig=' + encodeURIComponent(sig) + '&min=' + c.lamports).then(function (r) { return r.json(); }); if (v.success) { ok = true; break; } } catch (e) {}
        await new Promise(function (r2) { setTimeout(r2, 2500); });
      }
      if (ok) { grant(c.days, 'paid'); say('✓ Paid — every heavy tool is unlocked for ' + c.days + ' days.', true); return finish(); }
      say('Payment sent but not confirmed yet — tap PAY again in a moment to re-check (it will not charge twice: the same signature is re-verified).');
      btn.disabled = false; state.paying = false;
    } catch (e) { say('Payment failed: ' + (e.message || e)); btn.disabled = false; state.paying = false; }
  }

  function finish() {
    var cb = state.onUnlock;
    setTimeout(function () {
      if (state.card) { state.card.remove(); state.card = null; }
      state.paying = false;
      if (cb) cb();
    }, 1200);
  }

  // guard(fn, {tool, anchor}) — returns a wrapped fn that runs free with a valid pass and
  // otherwise shows the gate card (once) after the anchor's card; the original call is
  // replayed automatically the moment the pass is granted.
  function guard(fn, opts) {
    opts = opts || {};
    return async function () {
      var args = arguments, self = this;
      if (pass()) return fn.apply(self, args);
      var c = await config();
      if (!c || c.enabled === false) return fn.apply(self, args);   // gate off / config down → fail open
      if (pass()) return fn.apply(self, args);                       // re-check after the await
      state.onUnlock = function () { fn.apply(self, args); };
      if (state.card) { state.card.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
      state.card = buildCard(c, opts.tool || 'This tool');
      var anchor = opts.anchor ? document.querySelector(opts.anchor) : null;
      var host = anchor ? (anchor.closest('.card') || anchor.closest('.scan-card') || anchor.parentElement) : null;
      if (host && host.parentElement) host.insertAdjacentElement('afterend', state.card);
      else document.body.insertBefore(state.card, document.body.firstChild);
      state.card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
  }

  global.CluckGate = { guard: guard, config: config, pass: pass, grant: grant };
})(window);
