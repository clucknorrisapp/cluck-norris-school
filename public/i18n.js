/* Cluck Norris — i18n runtime.
   Two layers, so a language mode is COMPLETE, not piecemeal:
   1) Curated phrase-map dictionaries (/i18n/<lang>.json + <lang>.school.json) —
      high-quality, exact, priority.
   2) Machine-translation fallback (/api/i18n/translate, Claude + durable cache) —
      fills EVERYTHING else (any visible string), cached in localStorage so repeat
      views are instant. Tickers/addresses/numbers/code are never translated.
   Works on static HTML AND the React app (MutationObserver). English = no-op.
   A floating EN / 中文 / Español picker is injected on every page. */
(function () {
  var LANGS = [
    { code: "en", label: "English",  short: "EN",   html: "en" },
    { code: "zh", label: "中文",      short: "中文", html: "zh-CN" },
    { code: "es", label: "Español",  short: "ES",   html: "es" }
  ];
  var SUPPORTED = {}; LANGS.forEach(function (L) { SUPPORTED[L.code] = L; });
  function detect() {
    try {
      var saved = localStorage.getItem("clkn_lang");
      if (saved && SUPPORTED[saved]) return saved;
      var navs = navigator.languages || [navigator.language || "en"];
      for (var i = 0; i < navs.length; i++) {
        var l = String(navs[i] || "").toLowerCase();
        if (l.indexOf("zh") === 0) return "zh";
        if (l.indexOf("es") === 0) return "es";
      }
    } catch (_) {}
    return "en";
  }
  var lang = detect();
  try { if (!localStorage.getItem("clkn_lang")) localStorage.setItem("clkn_lang", lang); } catch (_) {}
  try { document.documentElement.setAttribute("lang", (SUPPORTED[lang] || SUPPORTED.en).html); } catch (_) {}

  function shortOf(c) { return (SUPPORTED[c] || SUPPORTED.en).short; }
  function injectToggle() {
    if (document.getElementById("clkn-lang-toggle") || !document.body) return;
    var wrap = document.createElement("div");
    wrap.id = "clkn-lang-toggle";
    wrap.setAttribute("data-i18n-skip", "1");
    wrap.setAttribute("translate", "no");
    wrap.style.cssText = ["position:fixed", "bottom:calc(14px + env(safe-area-inset-bottom,0px))", "right:12px",
      "z-index:2147483600", "font-family:'Chakra Petch',system-ui,sans-serif"].join(";");
    var menu = document.createElement("div");
    menu.style.cssText = ["position:absolute", "bottom:46px", "right:0", "display:none", "flex-direction:column",
      "gap:3px", "background:rgba(20,11,6,.98)", "border:1px solid rgba(255,122,24,.45)", "border-radius:12px",
      "padding:6px", "box-shadow:0 8px 24px rgba(0,0,0,.55)", "min-width:124px"].join(";");
    LANGS.forEach(function (L) {
      var it = document.createElement("button");
      it.type = "button";
      it.textContent = L.label + (L.code === lang ? "  ✓" : "");
      it.style.cssText = ["text-align:left", "font:inherit", "font-size:13px", "font-weight:700",
        "color:" + (L.code === lang ? "#FFB627" : "#FFD9A0"), "background:" + (L.code === lang ? "rgba(255,122,24,.14)" : "transparent"),
        "border:0", "border-radius:8px", "padding:8px 12px", "cursor:pointer", "white-space:nowrap"].join(";");
      it.addEventListener("click", function (e) {
        e.stopPropagation();
        if (L.code === lang) { menu.style.display = "none"; return; }
        try { localStorage.setItem("clkn_lang", L.code); } catch (_) {}
        location.reload();
      });
      menu.appendChild(it);
    });
    var btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "🌐 " + shortOf(lang);
    btn.title = "Language · 语言 · Idioma";
    btn.style.cssText = ["font:inherit", "font-size:13px", "font-weight:700", "letter-spacing:.5px", "color:#FFD9A0",
      "background:rgba(26,15,8,.96)", "border:1px solid rgba(255,122,24,.55)", "border-radius:999px",
      "padding:8px 13px", "cursor:pointer", "box-shadow:0 4px 16px rgba(0,0,0,.5)", "-webkit-tap-highlight-color:transparent"].join(";");
    btn.addEventListener("click", function (e) { e.stopPropagation(); menu.style.display = (menu.style.display === "none") ? "flex" : "none"; });
    document.addEventListener("click", function () { menu.style.display = "none"; });
    wrap.appendChild(menu); wrap.appendChild(btn);
    document.body.appendChild(wrap);
  }
  function onReady(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }

  // English → no translation, just the picker.
  if (lang === "en") { onReady(injectToggle); window.CLKN_I18N = { lang: "en" }; return; }

  // ---- caches ----
  var DICT = {};                                   // curated (loaded below)
  var MTKEY = "clkn_mt_" + lang, MT = {};          // machine-translation cache (localStorage-backed)
  try { MT = JSON.parse(localStorage.getItem(MTKEY) || "{}") || {}; } catch (_) { MT = {}; }
  var seen = (typeof WeakSet !== "undefined") ? new WeakSet() : null;     // text nodes finalized
  var setVal = (typeof WeakMap !== "undefined") ? new WeakMap() : null;   // node -> value we wrote (to ignore our own mutations)
  var SKIP = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, CODE: 1, PRE: 1, TEXTAREA: 1, SVG: 1, KBD: 1, SAMP: 1 };
  var BAD_CHILD = "a,br,span,div,p,ul,ol,li,section,article,header,footer,nav,table,tbody,tr,button,input,textarea,select,img,svg,label,form,h1,h2,h3,h4,h5,h6";
  var TICKER = {}; "CLKN SOL USDC USDT JUP cbBTC BTC ETH SOLUSD NFT LP AMM DeFi MEV APR APY TVL IL DEX CEX SPL DAO USD".split(" ").forEach(function (t) { TICKER[t] = 1; });

  function norm(s) { return (s || "").replace(/\s+/g, " ").trim(); }
  function curated(key) { var v = DICT[key]; return (v && v !== key) ? v : null; }
  function lookup(key) { var v = curated(key); if (v != null) return v; var m = MT[key]; return (m && m !== key) ? m : null; }
  function translatable(key) {
    if (!key || key.length < 2) return false;
    if (!/[A-Za-z]/.test(key)) return false;                       // needs a latin letter (English source)
    if (TICKER[key] || TICKER[key.replace(/^\$/, "")]) return false;
    if (/^https?:\/\//i.test(key) || /^www\./i.test(key)) return false;
    if (/^[1-9A-HJ-NP-Za-km-z]{25,60}$/.test(key)) return false;   // base58 address
    if (/^[\d.,%\s$+\-x/:#×•·()]+$/.test(key)) return false;        // pure number/symbols
    return true;
  }
  function setNode(node, value) { node.nodeValue = value; if (seen) seen.add(node); if (setVal) setVal.set(node, value); }
  function ancestorSkipped(node) {
    var p = node.parentNode;
    while (p && p.nodeType === 1) {
      if (SKIP[p.tagName]) return true;
      if (p.hasAttribute && (p.hasAttribute("data-i18n-skip") || p.getAttribute("translate") === "no" || p.isContentEditable)) return true;
      p = p.parentNode;
    }
    return false;
  }

  // ---- MT pending queue (batched, debounced) ----
  var pending = {};   // key -> [applyFn]
  var flushTimer = null;
  function queueMT(key, fn) { if (!pending[key]) pending[key] = []; pending[key].push(fn); if (!flushTimer) flushTimer = setTimeout(flush, 350); }
  function flush() {
    flushTimer = null;
    var all = Object.keys(pending); if (!all.length) return;
    var batch = all.slice(0, 60), fns = {};
    batch.forEach(function (k) { fns[k] = pending[k]; delete pending[k]; });
    fetch("/api/i18n/translate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lang: lang, texts: batch }) })
      .then(function (r) { return r.ok ? r.json() : { map: {} }; })
      .then(function (d) {
        var map = (d && d.map) || {}, changed = false;
        batch.forEach(function (k) {
          var tr = map[k];
          if (tr && tr !== k) { MT[k] = tr; changed = true; (fns[k] || []).forEach(function (fn) { try { fn(tr); } catch (_) {} }); }
        });
        if (changed) { try { localStorage.setItem(MTKEY, JSON.stringify(MT)); } catch (_) {} }
        if (Object.keys(pending).length && !flushTimer) flushTimer = setTimeout(flush, 350);
      })
      .catch(function () {});
  }

  function translateText(node) {
    if (!node || node.nodeType !== 3) return;
    if (seen && seen.has(node)) return;
    var raw = node.nodeValue, key = norm(raw);
    if (!key) { if (seen) seen.add(node); return; }
    if (ancestorSkipped(node)) { if (seen) seen.add(node); return; }
    var lead = raw.match(/^\s*/)[0], trail = raw.match(/\s*$/)[0];
    var v = lookup(key);
    if (v != null) { setNode(node, lead + v + trail); return; }
    if (translatable(key)) queueMT(key, function (tr) { if (node.parentNode) setNode(node, lead + tr + trail); });
    if (seen) seen.add(node);
  }
  function applyEl(el, tr) {
    el.textContent = tr; el.setAttribute("data-i18n-t", "1");
    var c = el.firstChild; if (c) { if (seen) seen.add(c); if (setVal) setVal.set(c, tr); }
  }
  function translateEl(el) {
    if (!el.children || el.children.length === 0) return;          // pure text → text-node pass
    if (el.getAttribute("data-i18n-t")) return;
    if (el.querySelector(BAD_CHILD)) return;                        // container / styled / functional → leave
    if (ancestorSkipped(el) || el.hasAttribute("data-i18n-skip") || el.getAttribute("translate") === "no") return;
    var key = norm(el.textContent); if (!key) return;
    var v = lookup(key);
    if (v != null) { applyEl(el, v); return; }
    if (translatable(key)) { el.setAttribute("data-i18n-t", "1"); queueMT(key, function (tr) { applyEl(el, tr); }); }
  }
  function translateAttrs(el) {
    if (!el || el.nodeType !== 1 || !el.getAttribute) return;
    ["placeholder", "title", "aria-label"].forEach(function (a) {
      if (el.hasAttribute(a)) {
        var key = norm(el.getAttribute(a)); var v = lookup(key);
        if (v != null) el.setAttribute(a, v);
        else if (translatable(key)) queueMT(key, function (tr) { el.setAttribute(a, tr); });
      }
    });
    if (el.tagName === "INPUT" && (el.type === "button" || el.type === "submit") && el.value) {
      var k = norm(el.value), vv = lookup(k);
      if (vv != null) el.value = vv; else if (translatable(k)) queueMT(k, function (tr) { el.value = tr; });
    }
  }
  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) { translateText(root); return; }
    if (root.nodeType !== 1) return;
    if (SKIP[root.tagName] || (root.hasAttribute && (root.hasAttribute("data-i18n-skip") || root.getAttribute("translate") === "no"))) return;
    translateAttrs(root);
    if (root.querySelectorAll) {
      // element-level pass: phrases split only by inline formatting (<b>/<em>…)
      var els = root.querySelectorAll("p,li,h1,h2,h3,h4,h5,h6,div,figcaption,blockquote,dd,dt,th,td");
      for (var i = 0; i < els.length; i++) translateEl(els[i]);
      var ae = root.querySelectorAll("[placeholder],[title],[aria-label],input[type=button],input[type=submit]");
      for (var j = 0; j < ae.length; j++) translateAttrs(ae[j]);
    }
    // text-node pass for everything else
    var tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var batch = [], n;
    while ((n = tw.nextNode())) batch.push(n);
    for (var k = 0; k < batch.length; k++) translateText(batch[k]);
  }

  function start() {
    injectToggle();
    walk(document.body);
    if (window.MutationObserver) {
      var mo = new MutationObserver(function (muts) {
        for (var i = 0; i < muts.length; i++) {
          var m = muts[i];
          if (m.type === "characterData") {
            var nd = m.target;
            if (setVal && setVal.get(nd) === nd.nodeValue) continue;   // our own write — ignore
            if (seen) seen.delete(nd);
            translateText(nd);
          } else if (m.addedNodes) {
            for (var j = 0; j < m.addedNodes.length; j++) walk(m.addedNodes[j]);
          }
        }
      });
      try { mo.observe(document.body, { childList: true, subtree: true, characterData: true }); } catch (_) {}
    }
  }

  function loadDict(name) {
    return fetch("/i18n/" + name + ".json").then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; });
  }
  var jobs = [loadDict(lang)];
  if ((location.pathname || "").indexOf("/school") === 0) jobs.push(loadDict(lang + ".school"));
  Promise.all(jobs)
    .then(function (parts) {
      DICT = {};
      parts.forEach(function (p) { for (var k in p) DICT[k] = p[k]; });
      window.CLKN_I18N = { lang: lang, dict: DICT, mt: MT };
      onReady(start);
    })
    .catch(function () { onReady(injectToggle); });
})();
