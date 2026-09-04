/* Cluck Norris — global floating nav: Home + (All Tools) + Ask Cluck, pinned
   top-center on every page that includes this script. One file controls all three.
   - Home hides when you're already at "/".
   - All Tools shows only on a tool page (so tools aren't dead-ends), hidden on /tools.
   - Ask Cluck hides on the Ask Cluck page itself (/ask-cluck, /crypto-school).
   Self-contained inline styles so it works even without theme.css.
   Add to a page with: <script defer src="/cluck-nav.js"></script> */
(function () {
  // Embedded contexts get NOTHING — no nav bar, no Listen pill, no EN pill. /premium?embed=1
  // is rendered inside the autopsy page's iframe, and before this guard the fixed nav bar,
  // both floating pills and the padding-top injection all rendered INSIDE the frame, stacking
  // a second nav over the host page's own (2026-08-18 tools sweep).
  try {
    if (window !== window.top) return;
    if (new URLSearchParams(location.search).get("embed") === "1") return;
  } catch (e) { return; }   // cross-origin window.top access throws → we ARE embedded
  // Load the global i18n runtime (中文/EN) on every page that includes this script
  // — BEFORE any early return below, so it runs even where the nav bar is hidden.
  if (!document.getElementById("clkn-i18n-js")) {
    var i18 = document.createElement("script");
    i18.id = "clkn-i18n-js"; i18.src = "/i18n.js"; i18.defer = true;
    (document.head || document.documentElement).appendChild(i18);
  }
  // Load the read-aloud (TTS) runtime too — a global "Listen" button on every page.
  if (!document.getElementById("clkn-read-js")) {
    var ra = document.createElement("script");
    ra.id = "clkn-read-js"; ra.src = "/read-aloud.js"; ra.defer = true;
    (document.head || document.documentElement).appendChild(ra);
  }
  // Shared collision-avoidance for the two bottom-pinned floaters (the Listen bar bottom-left,
  // the language toggle bottom-right). On pages with a bottom-anchored composer (/ask-cluck) the
  // default bottom:14px lands ON the input row: the Listen pill hid the placeholder's first words
  // and made the left ~72px of the field untappable, and the 🌐 pill sat on the send button
  // (found on iPad, 2026-08-16). One helper here, called by both injectors — NOT copied into each
  // (private copies of shared browser code drifting is how the esc()/WALLETS bugs happened).
  // Method: reset to the default anchor, measure, and if the floater overlaps any visible form
  // control it doesn't contain, lift it 10px above the highest one. Re-runs on resize (covers the
  // on-screen keyboard) and on two delayed passes for late-rendering pages like the React school.
  window.__clknDockFloat = function (el) {
    if (!el || el.__clknDocked) return; el.__clknDocked = 1;
    var DEF = "calc(14px + env(safe-area-inset-bottom,0px))";
    function fit() {
      try {
        el.style.bottom = DEF;                                    // measure from the default anchor
        var b = el.getBoundingClientRect(); if (!b.width) return;
        var lift = 0;
        var els = document.querySelectorAll("input,textarea,select,button,[contenteditable='true']");
        for (var i = 0; i < els.length; i++) {
          var e = els[i];
          if (el.contains(e)) continue;
          var host = e.closest && e.closest("#clkn-read-bar,#clkn-lang-toggle,#cluck-nav-bar");
          if (host) continue;
          var r = e.getBoundingClientRect();
          if (!r.width || !r.height) continue;
          var ox = Math.min(b.right, r.right) - Math.max(b.left, r.left);
          var oy = Math.min(b.bottom, r.bottom) - Math.max(b.top, r.top);
          if (ox > 0 && oy > 0) lift = Math.max(lift, (window.innerHeight - r.top) + 10);
        }
        if (lift) el.style.bottom = lift + "px";                   // r.top already includes the safe area
      } catch (_) {}
    }
    fit();
    window.addEventListener("resize", fit);
    setTimeout(fit, 800); setTimeout(fit, 2500);
  };
  var p = (location.pathname || "").replace(/\/+$/, "");
  // pages that belong to the Tools hub — get an "All Tools" back-link
  // Every route each tool answers on, aliases included — /snapshot, /bags, /launches, /clkn and
  // /alpha were missing, so those pages were nav dead-ends (2026-08-18 sweep). This list gates
  // only the "ALL TOOLS" back-chip on the page itself; it does NOT publicise a page anywhere.
  var TOOL_PAGES = ["/wallet-xray","/trace","/holders","/snapshot","/owners-snapshot","/owners",
    "/wallet-checkup","/security-coop","/hatchery","/airdrop","/firepit","/lp-scanner",
    "/bags","/launches","/bags-launches","/clkn","/alpha",
    "/buyspecial","/locker-room","/rose","/liquidity","/liquidity-engine","/premium","/pool-monitor"];
  // Pages with their OWN header/nav — don't inject the floating bar there (the i18n
  // + read-aloud loaders above already ran, so the language switch & Listen button
  // still appear). Home + the Ask Cluck page own their nav.
  var ownNav = (p === "" || p === "/" || p === "/education" || p === "/ask-cluck" || p === "/crypto-school");
  var showHome  = !ownNav;
  var showTools = (TOOL_PAGES.indexOf(p) !== -1);
  var showAsk   = (showHome && p !== "/ask-cluck" && p !== "/crypto-school");
  if (!showHome && !showTools && !showAsk) return;

  function pill(href, html, primary) {
    var a = document.createElement("a");
    a.href = href; a.innerHTML = html;
    a.style.cssText = [
      "display:inline-flex", "align-items:center", "gap:6px",
      "font-family:'Anton','Chakra Petch',system-ui,sans-serif",
      "font-size:13px", "font-weight:400", "letter-spacing:.6px", "text-transform:uppercase",
      "text-decoration:none", "white-space:nowrap", "padding:8px 14px", "border-radius:999px",
      "transition:transform .12s,box-shadow .12s", "-webkit-tap-highlight-color:transparent",
      primary
        ? "color:#fff;background:linear-gradient(135deg,#FF7A18,#E81E0E);border:1px solid rgba(255,182,39,.5);box-shadow:0 4px 16px rgba(232,30,14,.45)"
        : "color:#FFD9A0;background:rgba(26,15,8,.94);border:1px solid rgba(255,122,24,.45);box-shadow:0 4px 14px rgba(0,0,0,.45)"
    ].join(";");
    a.addEventListener("mouseenter", function () { a.style.transform = "translateY(-1px)"; });
    a.addEventListener("mouseleave", function () { a.style.transform = ""; });
    return a;
  }

  function inject() {
    if (document.getElementById("cluck-nav-bar") || !document.body) return;
    // On deep pages (not the homepage), this bar IS the nav — so hide each page's
    // own redundant back-to-home link and give the fixed bar clearance so it
    // doesn't overlap the page's top content. The bar NEVER wraps (a stacked bar
    // buried page titles on phones, found 2026-07-09): on narrow screens the pills
    // compact instead, and the clearance matches the single-row height. The bottom
    // padding keeps the floating Listen/language pills off the last card on mobile.
    if (showHome && !document.getElementById("cluck-nav-css")) {
      var st = document.createElement("style");
      st.id = "cluck-nav-css";
      st.textContent = "a.back,a.back-home,a.home{display:none!important}" +
        ".wrap{padding-top:calc(58px + env(safe-area-inset-top,0px))!important}" +
        "#cluck-nav-bar{flex-wrap:nowrap!important}" +
        "@media (max-width:560px){" +
          "#cluck-nav-bar a{font-size:11px!important;padding:7px 10px!important;gap:4px!important;letter-spacing:.4px!important}" +
          "#cluck-nav-bar a span:first-child{font-size:12px!important}" +
          "body{padding-bottom:calc(72px + env(safe-area-inset-bottom,0px))}" +
        "}";
      document.head.appendChild(st);
    }
    var bar = document.createElement("div");
    bar.id = "cluck-nav-bar";
    bar.style.cssText = ["position:fixed", "top:calc(12px + env(safe-area-inset-top,0px))", "left:50%", "transform:translateX(-50%)",
      "z-index:2147483000", "display:flex", "gap:8px", "align-items:center", "flex-wrap:nowrap",
      "justify-content:center", "max-width:96vw"].join(";");
    if (showHome)  bar.appendChild(pill("/", '<span style="font-size:14px;line-height:1">🏠</span><span>Home</span>', false));
    if (showTools) bar.appendChild(pill("/tools", '<span style="font-size:14px;line-height:1">🛠️</span><span>All Tools</span>', false));
    if (showAsk)   bar.appendChild(pill("/ask-cluck", '<span style="font-size:14px;line-height:1">🔥</span><span>Ask Cluck</span>', true));
    document.body.appendChild(bar);
    // Pages without a .wrap container get no CSS clearance — pad the body directly.
    if (showHome && !document.querySelector(".wrap")) {
      var cur = parseInt(getComputedStyle(document.body).paddingTop, 10) || 0;
      if (cur < 54) document.body.style.paddingTop = "calc(" + (cur + 54) + "px + env(safe-area-inset-top,0px))";
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", inject);
  else inject();
})();
