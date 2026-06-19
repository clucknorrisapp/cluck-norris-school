/* Cluck Norris — i18n runtime (curated phrase-map).
   Translates ONLY exact-match phrases from /i18n/<lang>.json, so contract
   addresses, tickers, numbers, and anything not in the dictionary stay untouched.
   Works on static HTML AND the React app (via a targeted MutationObserver).
   English is a no-op. A floating 中文/EN toggle is injected on every page.
   Loaded globally via cluck-nav.js. */
(function () {
  var SUPPORTED = { zh: "中文", en: "EN" };
  function detect() {
    try {
      var saved = localStorage.getItem("clkn_lang");
      if (saved && SUPPORTED[saved]) return saved;
      var navs = navigator.languages || [navigator.language || "en"];
      for (var i = 0; i < navs.length; i++) {
        if (String(navs[i] || "").toLowerCase().indexOf("zh") === 0) return "zh";
      }
    } catch (_) {}
    return "en";
  }
  var lang = detect();
  try { document.documentElement.setAttribute("lang", lang === "zh" ? "zh-CN" : "en"); } catch (_) {}

  function injectToggle() {
    if (document.getElementById("clkn-lang-toggle") || !document.body) return;
    var btn = document.createElement("button");
    btn.id = "clkn-lang-toggle";
    btn.type = "button";
    btn.setAttribute("data-i18n-skip", "1");           // never translate the toggle itself
    btn.setAttribute("translate", "no");
    btn.textContent = lang === "zh" ? "EN" : "中文";
    btn.title = lang === "zh" ? "Switch to English" : "切换到中文";
    btn.style.cssText = [
      "position:fixed", "top:calc(10px + env(safe-area-inset-top,0px))", "right:10px",
      "z-index:2147483600", "font-family:'Chakra Petch',system-ui,sans-serif",
      "font-size:12px", "font-weight:700", "letter-spacing:.5px", "color:#FFD9A0",
      "background:rgba(26,15,8,.94)", "border:1px solid rgba(255,122,24,.5)",
      "border-radius:999px", "padding:6px 11px", "cursor:pointer",
      "box-shadow:0 4px 14px rgba(0,0,0,.45)", "-webkit-tap-highlight-color:transparent"
    ].join(";");
    btn.addEventListener("click", function () {
      try { localStorage.setItem("clkn_lang", lang === "zh" ? "en" : "zh"); } catch (_) {}
      location.reload();
    });
    document.body.appendChild(btn);
  }
  function onReady(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }

  // English (or unknown) → no translation, just offer the toggle.
  if (lang === "en") {
    onReady(injectToggle);
    window.CLKN_I18N = { lang: "en" };
    return;
  }

  var DICT = null;
  var done = (typeof WeakSet !== "undefined") ? new WeakSet() : null;
  var SKIP = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, CODE: 1, PRE: 1, TEXTAREA: 1, SVG: 1 };
  function lookup(s) {
    if (!DICT || !s) return null;
    var k = s.trim();
    if (!k) return null;
    var v = DICT[k];
    return (v && v !== k) ? v : null;
  }
  function ancestorSkipped(node) {
    var p = node.parentNode;
    while (p && p.nodeType === 1) {
      if (SKIP[p.tagName]) return true;
      if (p.hasAttribute && (p.hasAttribute("data-i18n-skip") || p.getAttribute("translate") === "no" || p.isContentEditable)) return true;
      p = p.parentNode;
    }
    return false;
  }
  function translateText(node) {
    if (!node || node.nodeType !== 3) return;
    if (done && done.has(node)) return;
    var raw = node.nodeValue;
    var v = lookup(raw);
    if (v != null && !ancestorSkipped(node)) {
      node.nodeValue = raw.replace(/^\s*[\s\S]*?\s*$/, function () {
        return (raw.match(/^\s*/)[0]) + v + (raw.match(/\s*$/)[0]);
      });
    }
    if (done) done.add(node);
  }
  function translateAttrs(el) {
    if (!el || el.nodeType !== 1 || !el.getAttribute) return;
    ["placeholder", "title", "aria-label"].forEach(function (a) {
      if (el.hasAttribute && el.hasAttribute(a)) { var v = lookup(el.getAttribute(a)); if (v != null) el.setAttribute(a, v); }
    });
    if (el.tagName === "INPUT" && (el.type === "button" || el.type === "submit") && el.value) {
      var v = lookup(el.value); if (v != null) el.value = v;
    }
  }
  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) { translateText(root); return; }
    if (root.nodeType !== 1) return;
    if (SKIP[root.tagName] || (root.hasAttribute && (root.hasAttribute("data-i18n-skip") || root.getAttribute("translate") === "no"))) return;
    translateAttrs(root);
    var tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var batch = [], n;
    while ((n = tw.nextNode())) batch.push(n);
    for (var i = 0; i < batch.length; i++) translateText(batch[i]);
    if (root.querySelectorAll) {
      var attrEls = root.querySelectorAll("[placeholder],[title],[aria-label],input[type=button],input[type=submit]");
      for (var j = 0; j < attrEls.length; j++) translateAttrs(attrEls[j]);
    }
  }

  function start() {
    injectToggle();
    walk(document.body);
    // React / dynamic content — translate added & changed nodes only (exact-match = safe).
    if (window.MutationObserver) {
      var mo = new MutationObserver(function (muts) {
        for (var i = 0; i < muts.length; i++) {
          var m = muts[i];
          if (m.type === "characterData") { if (done) done.delete(m.target); translateText(m.target); }
          else if (m.addedNodes) {
            for (var j = 0; j < m.addedNodes.length; j++) walk(m.addedNodes[j]);
          }
        }
      });
      try { mo.observe(document.body, { childList: true, subtree: true, characterData: true }); } catch (_) {}
    }
  }

  fetch("/i18n/" + lang + ".json")
    .then(function (r) { return r.ok ? r.json() : {}; })
    .then(function (d) {
      DICT = d || {};
      window.CLKN_I18N = { lang: lang, dict: DICT };
      onReady(start);
    })
    .catch(function () { onReady(injectToggle); });
})();
