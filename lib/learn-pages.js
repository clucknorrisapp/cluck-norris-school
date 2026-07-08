// Data-driven renderer for the /learn/<asset> education pages.
// Content objects live in data/learn-assets.json (one per asset), produced by the
// learn-pages research workflow. This module turns a content object into a full,
// house-styled HTML page (+ a hub index). All content is escaped before it hits HTML —
// it's our own generated copy, but escaping keeps stray &/</> from breaking layout.

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const SHARED_CSS = `
  :root{color-scheme:dark;--bg:#0b0c0e;--card:#14151a;--border:rgba(255,255,255,0.09);--text:#FFEFE0;--body-text:#EAD8C8;--sub:#C9A892;--muted:#9C7E68;--accent:#FFB627;--orange:#FF7A18;--green:#7BE26B;--red:#E81E0E;--head:'Anton',sans-serif;--body:'Chakra Petch',system-ui,sans-serif;--mono:ui-monospace,'Share Tech Mono',monospace;}
  *{box-sizing:border-box;margin:0;padding:0;}
  body{background:var(--bg);color:var(--text);font-family:var(--body);min-height:100vh;line-height:1.6;}
  .wrap{max-width:820px;margin:0 auto;padding:24px 16px 80px;}
  a{color:var(--accent);}
  .hero{background:linear-gradient(160deg,#16171d,#101116);border:1px solid var(--border);border-radius:16px;padding:26px 24px;margin-bottom:18px;position:relative;overflow:hidden;}
  .hero::after{content:"";position:absolute;top:-40%;right:-10%;width:280px;height:280px;background:radial-gradient(circle,var(--glow,rgba(255,182,39,0.18)),transparent 70%);pointer-events:none;}
  .brand-mini{font-family:var(--head);font-size:10px;letter-spacing:4px;color:var(--orange);margin-bottom:10px;}
  .brand-mini a{color:var(--orange);text-decoration:none;}
  .hero-row{display:flex;align-items:center;gap:16px;flex-wrap:wrap;}
  .coin-badge{width:56px;height:56px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:var(--head);font-size:18px;color:#fff;flex-shrink:0;text-shadow:0 1px 3px rgba(0,0,0,.5);}
  .hero h1{font-family:var(--head);font-size:34px;letter-spacing:2px;line-height:1;}
  .hero .ticker{font-family:var(--mono);font-size:13px;color:var(--sub);letter-spacing:1px;margin-top:4px;}
  .hero .tagline{color:var(--body-text);margin-top:14px;font-size:15px;max-width:640px;}
  .price-strip{display:flex;gap:10px;flex-wrap:wrap;margin:16px 0 22px;}
  .price-box{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:11px 16px;flex:1;min-width:120px;}
  .price-box .lbl{font-family:var(--mono);font-size:9px;color:var(--muted);letter-spacing:1px;}
  .price-box .val{font-family:var(--mono);font-size:19px;font-weight:700;color:var(--accent);margin-top:3px;}
  .price-box .val.green{color:var(--green);}.price-box .val.red{color:var(--red);}
  .card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:20px 22px;margin-bottom:16px;}
  .card h2{font-family:var(--head);font-size:20px;letter-spacing:1px;margin-bottom:12px;color:var(--text);}
  .card p{color:var(--body-text);margin-bottom:12px;}
  .card p:last-child{margin-bottom:0;}
  .card ul{margin:6px 0 4px 4px;list-style:none;}
  .card li{color:var(--body-text);padding-left:20px;position:relative;margin-bottom:8px;}
  .card li::before{content:"\\25B8";position:absolute;left:0;color:var(--orange);}
  strong{color:var(--text);}
  .facts{width:100%;border-collapse:collapse;}
  .facts td{padding:9px 6px;border-bottom:1px solid rgba(255,255,255,0.05);font-size:14px;vertical-align:top;}
  .facts td:first-child{font-family:var(--mono);font-size:11px;color:var(--muted);letter-spacing:1px;width:40%;text-transform:uppercase;}
  .facts td:last-child{color:var(--body-text);}
  .timeline{list-style:none;}
  .timeline li{padding-left:64px;position:relative;margin-bottom:12px;color:var(--body-text);}
  .timeline li::before{content:none;}
  .timeline .yr{position:absolute;left:0;top:0;font-family:var(--mono);font-size:12px;color:var(--accent);font-weight:700;}
  .risk{background:rgba(232,30,14,0.06);border:1px solid rgba(232,30,14,0.22);border-radius:12px;padding:20px 22px;margin-bottom:16px;}
  .risk h2{color:#FF8A7A;}
  .risk li::before{color:var(--red);}
  .cta{background:linear-gradient(160deg,#1a1408,#14151a);border:1px solid rgba(255,182,39,0.28);border-radius:14px;padding:24px;text-align:center;margin-bottom:16px;}
  .cta h2{font-family:var(--head);font-size:22px;letter-spacing:1px;margin-bottom:8px;}
  .cta p{color:var(--body-text);margin-bottom:16px;}
  .btn-row{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;}
  .btn{background:var(--orange);color:#fff;text-decoration:none;font-family:var(--head);font-size:14px;letter-spacing:1px;padding:12px 22px;border-radius:10px;}
  .btn.ghost{background:transparent;border:1px solid var(--border);color:var(--text);}
  .chips{display:flex;gap:7px;flex-wrap:wrap;margin-top:14px;justify-content:center;}
  .chip{font-family:var(--mono);font-size:11px;color:var(--sub);background:rgba(255,255,255,0.04);border:1px solid var(--border);border-radius:20px;padding:5px 12px;text-decoration:none;}
  .chip:hover{border-color:var(--accent);color:var(--accent);}
  .footer-tag{text-align:center;margin-top:30px;padding-top:20px;border-top:1px solid var(--border);font-family:var(--head);font-size:10px;color:var(--sub);letter-spacing:3px;}
  .footer-tag a{color:var(--orange);text-decoration:none;}
  .disclaimer{font-size:11px;color:var(--muted);text-align:center;margin-top:14px;line-height:1.5;}
  .hub-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;margin-top:8px;}
  .hub-card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px;text-decoration:none;display:flex;align-items:center;gap:12px;transition:border-color .15s;}
  .hub-card:hover{border-color:var(--accent);}
  .hub-card .b{width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:var(--head);font-size:13px;color:#fff;flex-shrink:0;}
  .hub-card .n{font-family:var(--head);font-size:15px;color:var(--text);letter-spacing:1px;}
  .hub-card .t{font-family:var(--mono);font-size:10px;color:var(--muted);}
  .ask{background:linear-gradient(160deg,#131820,#101116);border:1px solid rgba(255,182,39,0.22);border-radius:14px;padding:20px 22px;margin-bottom:16px;}
  .ask h2{font-family:var(--head);font-size:20px;letter-spacing:1px;margin-bottom:6px;}
  .ask .sub{color:var(--sub);font-size:13px;margin-bottom:14px;}
  .ask-sugg{display:flex;gap:7px;flex-wrap:wrap;margin-bottom:12px;}
  .ask-sugg button{font-family:var(--mono);font-size:11px;color:var(--sub);background:rgba(255,255,255,0.04);border:1px solid var(--border);border-radius:20px;padding:6px 12px;cursor:pointer;}
  .ask-sugg button:hover{border-color:var(--accent);color:var(--accent);}
  .ask-form{display:flex;gap:8px;}
  .ask-form input{flex:1;background:rgba(255,255,255,0.04);border:1px solid var(--border);border-radius:10px;padding:12px 14px;font-family:var(--body);font-size:14px;color:var(--text);}
  .ask-form input:focus{outline:none;border-color:var(--accent);}
  .ask-form button{background:var(--orange);border:none;border-radius:10px;padding:0 20px;font-family:var(--head);font-size:14px;letter-spacing:1px;color:#fff;cursor:pointer;}
  .ask-form button:disabled{opacity:.5;cursor:not-allowed;}
  .ask-ans{margin-top:14px;background:var(--card);border:1px solid var(--border);border-radius:10px;padding:14px 16px;color:var(--body-text);font-size:14px;white-space:pre-wrap;display:none;}
  .ask-ans.show{display:block;}
  .ask-ans .who{font-family:var(--head);font-size:11px;letter-spacing:2px;color:var(--accent);margin-bottom:6px;}
`;

const HEAD = (title, desc, ogTitle, ogDesc, glow) => `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}"/>
<meta property="og:title" content="${esc(ogTitle)}"/>
<meta property="og:description" content="${esc(ogDesc)}"/>
<meta property="og:image" content="https://clucknorris.app/cluck-norris-mascot.jpg"/>
<meta property="og:type" content="article"/>
<meta name="twitter:card" content="summary_large_image"/>
<link rel="icon" href="/cluck-norris-mascot.jpg"/>
<link rel="stylesheet" href="/theme.css"/>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Anton&family=Chakra+Petch:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>${SHARED_CSS}${glow ? `:root{--glow:${glow}}` : ""}</style></head><body><div class="wrap">`;

const FOOTER = `<div class="disclaimer">Educational content only — not financial advice. Crypto is volatile and risky; do your own research and never risk more than you can afford to lose.</div>
<div class="footer-tag">🐔 <a href="https://clucknorris.app">clucknorris.app</a> — SCHOOL OF CRYPTO HARD KNOCKS</div>
</div></body></html>`;

function badgeGradient(g) {
  const [a, b] = Array.isArray(g) && g.length >= 2 ? g : ["#FFB627", "#FF7A18"];
  return `linear-gradient(135deg,${esc(a)},${esc(b)})`;
}
function glowFrom(g) {
  const a = Array.isArray(g) && g[0] ? g[0] : "#FFB627";
  // hex -> rgba(...,0.18)
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(a).replace("#", "").padStart(6, "0").slice(0, 6));
  if (!m) return "rgba(255,182,39,0.18)";
  return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},0.18)`;
}

function bullets(arr) {
  return `<ul>${(arr || []).map((b) => `<li>${esc(b)}</li>`).join("")}</ul>`;
}
function paras(arr) {
  return (arr || []).map((p) => `<p>${esc(p)}</p>`).join("");
}

function renderAssetPage(a) {
  const title = `What is ${a.name} (${a.ticker})? — Cluck Norris Crypto School`;
  const desc = `${a.name} (${a.ticker}) explained without the hype: how it works, what the team is building, the honest risks, and how to get started. Free crypto education.`;
  const og = `What is ${a.name} (${a.ticker})? — plain-English breakdown`;
  const facts = (a.quickFacts || []).map(
    (row) => `<tr><td>${esc(row[0])}</td><td>${esc(row[1])}</td></tr>`
  ).join("");
  const timeline = (a.history || []).map(
    (h) => `<li><span class="yr">${esc(h.year)}</span>${esc(h.event)}</li>`
  ).join("");
  const relChips = (a._related || []).map(
    (r) => `<a class="chip" href="/learn/${esc(r.slug)}">${esc(r.name)} (${esc(r.ticker)})</a>`
  ).join("") + `<a class="chip" href="/learn">All chains →</a>`;

  return HEAD(title, desc, og, `How ${a.name} actually works, what it's building, the real risks, and where to start. No hype.`, glowFrom(a.gradient)) + `
  <div class="hero">
    <div class="brand-mini">🐔 <a href="/learn">CLUCK NORRIS — CRYPTO SCHOOL</a></div>
    <div class="hero-row">
      <div class="coin-badge" style="background:${badgeGradient(a.gradient)}">${esc(a.ticker)}</div>
      <div><h1>${esc(a.name)}</h1><div class="ticker">${esc(a.ticker)} · ${esc(a.category)}</div></div>
    </div>
    <p class="tagline">${esc(a.tagline)}</p>
  </div>

  <div class="price-strip">
    <div class="price-box"><div class="lbl">PRICE (USD)</div><div class="val" id="pxPrice">—</div></div>
    <div class="price-box"><div class="lbl">24H CHANGE</div><div class="val" id="pxChange">—</div></div>
    <div class="price-box"><div class="lbl">MARKET CAP</div><div class="val" id="pxMcap">—</div></div>
  </div>

  <div class="card"><h2>What is ${esc(a.name)}?</h2>${paras(a.whatIsIt)}</div>
  <div class="card"><h2>How it works</h2>${paras(a.howItWorks && a.howItWorks.paragraphs)}${bullets(a.howItWorks && a.howItWorks.bullets)}</div>
  <div class="card"><h2>What they're building</h2>${paras(a.building && a.building.paragraphs)}${bullets(a.building && a.building.bullets)}</div>
  <div class="card"><h2>Quick facts</h2><table class="facts">${facts}</table></div>
  <div class="card"><h2>The ecosystem</h2>${bullets(a.ecosystem)}</div>
  ${timeline ? `<div class="card"><h2>History</h2><ul class="timeline">${timeline}</ul></div>` : ""}
  <div class="risk"><h2>The honest risks</h2>${bullets(a.risks)}</div>
  <div class="card"><h2>How to invest (safely)</h2>${bullets(a.howToInvest)}</div>

  <div class="ask">
    <h2>🐔 Ask Cluck about ${esc(a.name)}</h2>
    <div class="sub">Stuck on something above? Ask the professor — he answers in plain English.</div>
    <div class="ask-sugg">
      <button type="button" data-q="In simple terms, what makes ${esc(a.name)} different from Bitcoin?">vs. Bitcoin?</button>
      <button type="button" data-q="What are the biggest risks of holding ${esc(a.name)}?">Biggest risks?</button>
      <button type="button" data-q="How do I store ${esc(a.name)} safely?">Store it safely?</button>
    </div>
    <form class="ask-form" id="askForm" autocomplete="off">
      <input id="askInput" type="text" maxlength="500" placeholder="Ask anything about ${esc(a.name)}…"/>
      <button type="submit" id="askBtn">Ask</button>
    </form>
    <div class="ask-ans" id="askAns"><div class="who">CLUCK NORRIS</div><div id="askAnsText"></div></div>
  </div>

  <div class="cta">
    <h2>Learn crypto the hard-knocks way</h2>
    <p>Understanding ${esc(a.name)} is one step. The Cluck Norris school teaches wallets, DeFi, scams, and self-custody for free — with a verifiable diploma when you pass.</p>
    <div class="btn-row"><a class="btn" href="/">Start the free school</a><a class="btn ghost" href="/tools">Free token tools</a></div>
    <div class="chips">${relChips}</div>
  </div>

  <script>
  (async function(){
    try{
      const r=await fetch('/api/asset-price?id=${encodeURIComponent(a.coingeckoId)}');
      const d=await r.json(); if(!d||d.price==null)return;
      const fmt=n=>n>=1e9?'$'+(n/1e9).toFixed(1)+'B':n>=1e6?'$'+(n/1e6).toFixed(1)+'M':'$'+Number(n).toLocaleString();
      document.getElementById('pxPrice').textContent='$'+Number(d.price).toLocaleString(undefined,{maximumFractionDigits:d.price<1?6:2});
      var ce=document.getElementById('pxChange'); var c=Number(d.change24h||0);
      ce.textContent=(c>=0?'+':'')+c.toFixed(2)+'%'; ce.className='val '+(c>=0?'green':'red');
      document.getElementById('pxMcap').textContent=d.mcap?fmt(d.mcap):'—';
    }catch(e){}
  })();

  (function(){
    var NAME=${JSON.stringify(a.name)}, TICK=${JSON.stringify(a.ticker)};
    var form=document.getElementById('askForm'), input=document.getElementById('askInput'),
        btn=document.getElementById('askBtn'), ans=document.getElementById('askAns'), ansT=document.getElementById('askAnsText');
    var busy=false;
    function lang(){try{var s=localStorage.getItem('clkn_lang');if(s)return s;}catch(e){}var l=(navigator.language||'').toLowerCase().slice(0,2);return l==='zh'?'zh':l==='es'?'es':l==='pt'?'pt':l==='it'?'it':l==='vi'?'vi':l==='hi'?'hi':'en';}
    function ask(q){
      if(busy||!q||q.length<3)return; busy=true; btn.disabled=true; btn.textContent='…';
      ans.classList.add('show'); ansT.textContent='Cluck is thinking…';
      fetch('/api/ask-cluck',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({question:'Regarding '+NAME+' ('+TICK+'): '+q, context:NAME+' ('+TICK+') learn page', lang:lang()})})
        .then(function(r){return r.json();})
        .then(function(j){ansT.textContent=(j&&j.success&&j.answer)?j.answer:((j&&j.error)||'Comms down — try again.');})
        .catch(function(){ansT.textContent='Comms down — check your connection and try again.';})
        .finally(function(){busy=false;btn.disabled=false;btn.textContent='Ask';});
    }
    form.addEventListener('submit',function(e){e.preventDefault();var q=input.value.trim();if(q){input.value='';ask(q);}});
    Array.prototype.forEach.call(document.querySelectorAll('.ask-sugg button'),function(b){
      b.addEventListener('click',function(){var q=b.getAttribute('data-q');input.value=q;ask(q);});
    });
  })();
  </script>` + FOOTER;
}

function renderHub(assets) {
  const title = "Learn Crypto — Every Chain, Explained | Cluck Norris School";
  const desc = "Plain-English guides to Bitcoin, Ethereum, Solana, XRP, and every top crypto asset. How they work, what they're building, the honest risks. Free.";
  const cards = assets.map((a) => `<a class="hub-card" href="/learn/${esc(a.slug)}">
    <div class="b" style="background:${badgeGradient(a.gradient)}">${esc(a.ticker)}</div>
    <div><div class="n">${esc(a.name)}</div><div class="t">${esc(a.ticker)}</div></div></a>`).join("");
  return HEAD(title, desc, "Learn Crypto — Every Chain, Explained", desc, null) + `
  <div class="hero">
    <div class="brand-mini">🐔 CLUCK NORRIS — SCHOOL OF CRYPTO HARD KNOCKS</div>
    <h1 style="font-family:var(--head);font-size:34px;letter-spacing:2px;margin-top:6px;">Learn Crypto</h1>
    <p class="tagline">Every top chain and project, explained in plain English — how it works, what it's building, and the honest risks. No hype, no shilling.</p>
  </div>
  <div class="card"><h2>Pick an asset</h2><div class="hub-grid">${cards}</div></div>
  <div class="cta"><h2>Ready to go deeper?</h2><p>The free school turns this knowledge into real skills — wallets, DeFi, scams, self-custody — with a verifiable diploma.</p>
    <div class="btn-row"><a class="btn" href="/">Start the free school</a><a class="btn ghost" href="/tools">Free token tools</a></div></div>` + FOOTER;
}

module.exports = { renderAssetPage, renderHub, esc };
