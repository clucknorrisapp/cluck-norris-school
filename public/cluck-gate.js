/* Cluck Norris — unified tools pass (owner's call, 2026-08-18, for the app-store era).
   ONE rule across every heavy tool: hold $50 worth of CLKN and everything unlocks free,
   or pay 0.05 SOL once for a 7-day ALL-TOOLS pass. Quick safety tools (Wallet Checkup,
   Firepit, Locker Room) and the school stay free — guardrails before power.

   Usage on a gated page (after cluck-util.js + cluck-wallet.js):
     run = CluckGate.guard(run, { tool: 'Wallet X-Ray', anchor: '#runBtn' });
   The tool renders normally — the gate appears at the moment of RUN ("preview everything,
   unlock to run"). Buy Special mounts the same card up front (its whole tool is the gated run).

   Server truth: /api/tool-gate/config publishes the live numbers (the CLKN amount is derived
   from the live price — NEVER hardcode it); POST /api/tool-gate/session verifies the signed nonce + the payment
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
  // proof is what the SERVER re-checks on every gated run (x-clkn-pass): 't:<token>', a session
  // token /api/tool-gate/session issues only after this wallet SIGNED a one-line message (no
  // transaction, no approval) and qualified — comped, holding enough CLKN, or the payer of a SOL
  // payment. A pasted address or a public payment signature is never a credential. A grant
  // without proof (older localStorage) still opens the page, but the API answers 402/403 and
  // the pass is re-done once.
  function grant(days, why, proof) {
    var d = { unlockedAt: Date.now(), expiresAt: Date.now() + days * 24 * 60 * 60 * 1000, why: why || 'paid', proof: proof || null };
    try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) {}
    return d;
  }
  function proof() { var d = pass(); return (d && d.proof) || null; }
  function clear() { try { localStorage.removeItem(KEY); } catch (e) {} }
  // fetch() for a gated API: sends the proof, and when the server refuses the pass (expired,
  // never redeemed, balance fell under the threshold) drops the local grant so a RUN guarded by
  // guard() re-opens the gate card. That only happens if the caller actually re-invokes its
  // guarded run function on a denial (denied() below says when) — printing data.error and
  // stopping, without calling denied()/message(), leaves the raw code on screen and the card
  // closed until the user clicks RUN again by hand (P2-118).
  var PASS_ERRORS = { pass_required: 1, pass_expired: 1, bad_pass: 1, insufficient_holdings: 1 };
  // True when a {success:false,...} response from CluckGate.fetch() is a pass denial (as opposed
  // to an unrelated tool error) — the local pass has already been cleared by gatedFetch by the
  // time this is checked, so calling the page's own guard()-wrapped run function again re-shows
  // the gate card instead of the tool silently re-running with no credential.
  function denied(data) { return !!(data && PASS_ERRORS[data.error]); }
  // The server's deny payload carries a human-readable `detail` ("This wallet holds X CLKN
  // (~$Y) — the free tier needs ≈Z…") alongside the internal `error` code — prefer it so a page
  // never shows a bare string like "insufficient_holdings" to a person.
  function message(data) { return (data && (data.detail || data.error)) || 'Something went wrong — try again.'; }
  async function gatedFetch(url, opts) {
    opts = opts || {};
    var h = new Headers(opts.headers || {});
    var p = proof();
    if (p) h.set('x-clkn-pass', p);
    var r = await fetch(url, Object.assign({}, opts, { headers: h }));
    if (r.status === 402 || r.status === 403) {
      try {
        var j = await r.clone().json();
        if (j && PASS_ERRORS[j.error]) clear();
      } catch (e) {}
    }
    return r;
  }
  async function config(force) {
    if (!force && cfg && Date.now() - cfgAt < 60000) return cfg;
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

  var state = { provider: null, pubkey: null, card: null, onUnlock: null, paying: false, payIntent: null };

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
      + '<button class="ckg-btn ckg-ghost" data-ckg="newpay" style="display:none" title="Only if you are sure the earlier payment never went through — this sends a NEW transfer">START A NEW PAYMENT (charges again)</button>'
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
      else if (b.dataset.ckg === 'newpay') {
        // The explicit, separate decision to abandon an unresolved payment and send a new one.
        // Nothing else in this file can start a second transfer while one is pending.
        if (!global.confirm('Start a NEW payment? This sends another ' + (c.lamports / 1e9) + ' SOL. Only do this if you are sure the earlier payment never went through.')) return;
        state.abandonPay = true; forgetPay(); b.style.display = 'none';
        payWith(c, state.card.querySelector('[data-ckg="pay"]'));
      }
    });
    return card;
  }

  function disconnect() {
    try { state.provider && state.provider.disconnect && state.provider.disconnect(); } catch (e) {}
    state.provider = null; state.pubkey = null; state.payIntent = null;
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

  // Proof of wallet ownership: the wallet signs a SERVER-ISSUED, single-use challenge (no
  // transaction, no approval). One signature = one session request, so nothing is cached here;
  // the PAY leg carries a short-lived payIntent the server hands back instead of a second prompt.
  async function signChallenge() {
    if (!state.provider || typeof state.provider.signMessage !== 'function') throw new Error('this wallet cannot sign messages — try Phantom, Solflare, Backpack or Jupiter');
    var ch = await fetch('/api/tool-gate/challenge?wallet=' + encodeURIComponent(state.pubkey)).then(function (r) { return r.json(); });
    if (!ch || !ch.success || !ch.message) throw new Error((ch && ch.error) || 'could not get a challenge');
    say('Approve the signature in your wallet — it is not a transaction.');
    var enc = new TextEncoder().encode(ch.message);
    var res = await state.provider.signMessage(enc, 'utf8');
    var bytes = (res && res.signature) ? res.signature : res;
    if (bytes && bytes.data && !bytes.length) bytes = bytes.data;
    var b64 = btoa(String.fromCharCode.apply(null, new Uint8Array(bytes)));
    return { wallet: state.pubkey, message: ch.message, signature: b64 };
  }
  // The only issuer of passes: verifies the signature (or the payIntent) server-side, qualifies
  // the wallet (comped / live CLKN balance / the payer of paySig) and answers with the token.
  async function openSession(paySig) {
    var body = { wallet: state.pubkey };
    if (paySig && state.payIntent && state.payIntent.wallet === state.pubkey && Date.now() - state.payIntent.at < 14 * 60 * 1000) {
      body.payIntent = state.payIntent.token; body.paySig = paySig;
    } else {
      var sg = await signChallenge();
      body.message = sg.message; body.signature = sg.signature;
      if (paySig) body.paySig = paySig;
    }
    var r = await fetch('/api/tool-gate/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    var j = null; try { j = await r.json(); } catch (e) {}
    if (!j) throw new Error('pass service unavailable (' + r.status + ')');
    if (j.payIntent) state.payIntent = { token: j.payIntent, wallet: state.pubkey, at: Date.now() };
    return j;
  }
  // A payment we sent but never got a pass for (closed tab, lost response) is remembered so the
  // same wallet can recover it instead of paying twice.
  var PAYKEY = 'clkn_tools_paysig';
  // The record is {sig, wallet, at, bh}. `sig` is null while an attempt is UNRESOLVED: it is written
  // BEFORE the wallet can broadcast (second reviewer, round 4 — a wallet that broadcast but whose
  // callback rejected, or a tab that died mid-call, used to leave nothing behind, so the next tap
  // built a second transfer with no confirmation). `at` is kept across the null→sig transition so
  // the on-chain search below knows how far back the attempt could have landed.
  function rememberPay(sig, bh) {
    try {
      var cur = pendingPay();
      var keepAt = cur && !cur.sig && cur.wallet === state.pubkey;
      localStorage.setItem(PAYKEY, JSON.stringify({ sig: sig || null, wallet: state.pubkey, at: keepAt ? cur.at : Date.now(), bh: bh || (cur && cur.bh) || null }));
    } catch (e) {}
  }
  function forgetPay() { try { localStorage.removeItem(PAYKEY); } catch (e) {} }
  function pendingPay() { try { var d = JSON.parse(localStorage.getItem(PAYKEY) || 'null'); return d && d.wallet === state.pubkey && Date.now() - d.at < 8 * 24 * 3600 * 1000 ? d : null; } catch (e) { return null; } }
  function showNewPay() { var np = state.card && state.card.querySelector('[data-ckg="newpay"]'); if (np) np.style.display = ''; }
  var B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  function b58enc(bytes) { var n = 0n; for (var i = 0; i < bytes.length; i++) n = n * 256n + BigInt(bytes[i]); var s = ''; while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; } for (var j = 0; j < bytes.length && bytes[j] === 0; j++) s = '1' + s; return s; }
  function bytesToB64(u8) { var b = ''; for (var i = 0; i < u8.length; i++) b += String.fromCharCode(u8[i]); return btoa(b); }
  // Does this parsed transaction pay OUR receiver from THIS wallet? (top-level + inner instructions)
  function isPaymentTx(tx, c) {
    try {
      var ins = (tx.transaction.message.instructions || []).slice();
      ((tx.meta && tx.meta.innerInstructions) || []).forEach(function (g) { ins = ins.concat(g.instructions || []); });
      for (var i = 0; i < ins.length; i++) {
        var p = ins[i].parsed;
        if (p && p.type === 'transfer' && p.info && p.info.source === state.pubkey && p.info.destination === c.receiver) return true;
      }
    } catch (e) {}
    return false;
  }
  // An attempt whose signature we never learned: ask the chain. Returns {sig} when the wallet's
  // recent history shows a payment to us since the attempt, {dead:true} ONLY when the read covered
  // the whole window and the attempt's blockhash has long expired (nothing signed then can land
  // now), and {unknown:true} for everything else — an RPC error, a full page of newer history, or
  // an attempt still young enough to be in flight. Unknown never charges again.
  async function findAttemptOnChain(prev, c) {
    try {
      var sigs = await CluckUtil.rpc('getSignaturesForAddress', [state.pubkey, { limit: 25, commitment: 'confirmed' }]);
      if (!Array.isArray(sigs)) return { unknown: true };
      var since = Math.floor((prev.at - 120000) / 1000);
      var recent = sigs.filter(function (s) { return !s.blockTime || s.blockTime >= since; });
      for (var i = 0; i < Math.min(recent.length, 10); i++) {
        if (recent[i].err) continue;
        var tx = await CluckUtil.rpc('getTransaction', [recent[i].signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]);
        if (tx && isPaymentTx(tx, c)) return { sig: recent[i].signature };
      }
      var covered = sigs.length < 25 || recent.length < sigs.length;
      if (covered && Date.now() - prev.at > 180000) return { dead: true };
      return { unknown: true };
    } catch (e) { return { unknown: true }; }
  }

  async function checkHolder(c, walletName) {
    // Comped wallets, holders and the price-outage grace are all decided SERVER-SIDE now — the
    // page only proves the wallet and shows the answer. FUTURE (owner, 2026-08-18): lifetime-pass
    // NFTs slot into the server's comp check; no client change needed beyond the label.
    try {
      var j = await openSession(null);
      if (j.success && j.pass) {
        grant(j.days || c.days, j.via || 'holder', j.pass);
        if (j.via === 'comp') say('✓ Comped wallet — unlocked.', true);
        else if (j.via === 'holder') say('✓ ' + (walletName || 'Holder') + ' — ' + fmtI(Math.floor(j.balance || 0)) + ' CLKN. All tools free while you hold.', true);
        else say('✓ Unlocked (balance check unavailable right now — a short grace pass was issued).', true);
        return finish();
      }
      if (j.error === 'insufficient_holdings') {
        var worth = c.priceUsd ? (j.balance || 0) * c.priceUsd : null;
        say('This wallet holds ' + fmtI(Math.floor(j.balance || 0)) + ' CLKN (≈$' + fmtI(Math.floor(worth || 0)) + ') — the free tier needs ≈' + fmtI(j.needed || c.clknNeeded) + ' ($' + fmtI(c.holdUsd) + ' worth). Not holding? PAY unlocks all tools for ' + c.days + ' days.');
        state.card.querySelector('[data-ckg="pay"]').style.display = '';
        return;
      }
      say(j.error || 'Could not verify this wallet.');
    } catch (e) { say('Wallet check failed: ' + (e.message || e)); }
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
      // A previous payment from this wallet that never turned into a pass? Recover it first —
      // the server re-issues the pass to the same payer with its original expiry.
      var prev = pendingPay();
      if (prev && !state.abandonPay && !prev.sig) {
        // The attempt was recorded before the wallet could broadcast, and its signature never came
        // back. Ask the chain; only a read that PROVES it could not have landed releases it.
        say('Checking whether your wallet sent the earlier payment…');
        var found = await findAttemptOnChain(prev, c);
        if (found.sig) { prev.sig = found.sig; rememberPay(found.sig); }
        else if (found.dead) { forgetPay(); prev = null; }
        else {
          say('Could not confirm yet whether the earlier payment went through — nothing new was charged. Tap PAY again in a minute; it re-checks the chain. Only start a new payment if you are sure the first one never went through.');
          showNewPay(); btn.disabled = false; state.paying = false; return;
        }
      }
      if (prev && !state.abandonPay) {
        say('Checking a previous payment from this wallet…');
        var settled = false;
        for (var k = 0; k < 6; k++) {
          try {
            var pv = await openSession(prev.sig);
            if (pv.success && pv.pass) { forgetPay(); grant(pv.days || c.days, 'paid', pv.pass); say('✓ Your earlier payment was found — every heavy tool is unlocked for ' + (pv.days || c.days) + ' days.', true); return finish(); }
            // Only a VERDICT about the payment itself releases it: the wrong wallet, the wrong
            // destination, too little, or a pass that has already run its course. Everything else
            // ("not found yet", a 5xx, a network error) is "still unresolved", never "start over".
            if (/different wallet|not addressed|amount too low|already expired/.test(pv.error || '')) { forgetPay(); settled = true; say('Your earlier payment could not be applied: ' + pv.error); break; }
          } catch (e) {}
          await new Promise(function (r2) { setTimeout(r2, 2000); });
        }
        if (!settled) {
          // UNRESOLVED ≠ ABANDONED (second reviewer, 2026-09-11): an outage here used to fall
          // through to a brand-new transfer, so a service hiccup could charge twice. Stay in
          // "payment pending — retry verification"; a NEW payment needs its own explicit decision.
          say('Your earlier payment is still being verified — nothing new was charged. Tap PAY again to retry; it picks up that same payment. Only start a new payment if you are sure the first one never went through.');
          showNewPay();
          btn.disabled = false; state.paying = false; return;
        }
      }
      state.abandonPay = false;
      say('Loading payment libraries…');
      await ensurePayLibs();
      // The offer is resolved from the terms schedule PER REQUEST server-side (second reviewer,
      // round 4), so re-read it right before building the transfer: a schedule boundary that
      // passed while this card sat open must not send the old amount and get "amount too low".
      var fresh = await config(true);
      if (fresh && fresh.enabled !== false && fresh.lamports && fresh.receiver) c = fresh;
      var bh = await CluckUtil.rpc('getLatestBlockhash', [{ commitment: 'finalized' }]);
      var Transaction = solanaWeb3.Transaction, PublicKey = solanaWeb3.PublicKey;
      // Hand-built System transfer via the shared engine — SystemProgram.transfer()
      // throws "Buffer is not defined" in the browser (see airdrop-engine.js).
      var tx = new Transaction();
      tx.add(splToken.createSolTransferInstruction(new PublicKey(state.pubkey), new PublicKey(c.receiver), c.lamports));
      tx.feePayer = new PublicKey(state.pubkey); tx.recentBlockhash = bh.value.blockhash;
      say('Approve the ' + (c.lamports / 1e9) + ' SOL payment in your wallet…');
      // SIGN FIRST, SEND OURSELVES (second reviewer, round 4): the signature exists the moment the
      // wallet signs, so it is persisted BEFORE anything can broadcast. signAndSendTransaction only
      // ever told us the signature after the fact, and a wallet that broadcast but whose callback
      // rejected left nothing behind — the next tap then built a second transfer.
      var sig = null, signed = null;
      if (typeof state.provider.signTransaction === 'function') {
        try { signed = await state.provider.signTransaction(tx); }
        catch (e) { if (!/cannot sign a transaction/i.test((e && e.message) || '')) throw e; signed = null; }   // the shim's answer for a send-only wallet
      }
      if (signed) {
        if (global.CluckWallet && CluckWallet.asTransaction) signed = CluckWallet.asTransaction(signed, tx);
        var sb = signed.signatures && signed.signatures[0] && signed.signatures[0].signature;
        if (!sb || !sb.length) throw new Error('wallet returned no signature');
        sig = b58enc(sb);
        rememberPay(sig, bh.value.blockhash);   // durable BEFORE the send
        say('Sending payment…');
        // verifySignatures:false — the chain verifies; web3's local check rejects a Transaction that
        // another web3 copy signed (the shim's foreign-prototype case), which is not a failed payment.
        await CluckUtil.rpc('sendTransaction', [bytesToB64(signed.serialize({ requireAllSignatures: true, verifySignatures: false })), { encoding: 'base64', skipPreflight: true, preflightCommitment: 'confirmed', maxRetries: 5 }]);
      } else {
        // A wallet that can only sign-and-send: record the attempt (signature unknown) BEFORE the
        // call. A lost callback then leaves an unresolved attempt the next tap must resolve on
        // the chain (findAttemptOnChain) instead of charging again.
        rememberPay(null, bh.value.blockhash);
        var res = await state.provider.signAndSendTransaction(tx);
        sig = (res && res.signature) || (typeof res === 'string' ? res : null);
        if (!sig) throw new Error('wallet returned no signature');
        rememberPay(sig);
      }
      say('Confirming payment on-chain…');
      // The pass is issued to the PAYER only: the payIntent from the connect step (or a fresh
      // signed challenge) proves this wallet, and the server checks the transaction's fee payer
      // is the same wallet before consuming the payment.
      var ok = null, lastErr = '';
      for (var i = 0; i < 24; i++) {
        try { var v = await openSession(sig); if (v.success && v.pass) { ok = v; break; } lastErr = v.error || ''; if (/different wallet|already redeemed/.test(lastErr)) break; } catch (e) { lastErr = e.message || ''; }
        await new Promise(function (r3) { setTimeout(r3, 2500); });
      }
      if (ok) { forgetPay(); grant(ok.days || c.days, 'paid', ok.pass); say('✓ Paid — every heavy tool is unlocked for ' + (ok.days || c.days) + ' days.', true); return finish(); }
      say(/different wallet|already redeemed/.test(lastErr) ? ('Payment could not be applied: ' + lastErr) : 'Payment sent but not confirmed yet — tap PAY again in a moment; it will pick up this same payment, not charge you twice.');
      btn.disabled = false; state.paying = false;
    } catch (e) {
      // Whatever failed, the attempt record (if one was written) stays: the next tap resolves it,
      // and only the explicit START A NEW PAYMENT control can send again.
      var att = pendingPay();
      if (att && !att.sig) { say('Payment failed: ' + (e.message || e) + ' — but your wallet may still have sent it. Tap PAY to check the chain; nothing new is charged unless you choose START A NEW PAYMENT.'); showNewPay(); }
      else if (att && att.sig) { say('Payment failed: ' + (e.message || e) + ' — tap PAY to retry verification of that same payment; nothing new is charged.'); showNewPay(); }
      else say('Payment failed: ' + (e.message || e));
      btn.disabled = false; state.paying = false;
    }
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
      // A pass counts only with its server-issued token: the heavy APIs check the token, so a
      // token-less local grant (a pre-2026-09-10 pass, or Buy Special's retired private flow —
      // deep dive 2026-09-17 P1-066) would only 402; re-open the card and issue a real one.
      if (proof()) return fn.apply(self, args);
      var c = await config();
      if (!c || c.enabled === false) return fn.apply(self, args);   // gate off / config down → fail open
      if (proof()) return fn.apply(self, args);                      // re-check after the await
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

  global.CluckGate = { guard: guard, config: config, pass: pass, grant: grant, proof: proof, fetch: gatedFetch, clear: clear, denied: denied, message: message };
})(window);
