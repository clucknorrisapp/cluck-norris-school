/* Cluck Norris — global floating nav: Home + (All Tools) + Ask Cluck, pinned
   top-center on every page that includes this script. One file controls all three.
   - Home hides when you're already at "/".
   - All Tools shows only on a tool page (so tools aren't dead-ends), hidden on /tools.
   - Ask Cluck hides on the Ask Cluck page itself (/ask-cluck, /crypto-school).
   Self-contained inline styles so it works even without theme.css.
   Add to a page with: <script defer src="/cluck-nav.js"></script> */
(function () {
  var p = (location.pathname || "").replace(/\/+$/, "");
  // pages that belong to the Tools hub — get an "All Tools" back-link
  var TOOL_PAGES = ["/wallet-xray","/autopsy","/order-book","/trace","/snapshot","/holders",
    "/token-vitals","/lp-scanner","/wallet-checkup","/security-coop","/hatchery","/airdrop",
    "/buyspecial","/rose","/liquidity","/liquidity-engine","/premium","/pool-monitor"];
  var showHome  = (p !== "" && p !== "/");
  var showTools = (TOOL_PAGES.indexOf(p) !== -1);
  var showAsk   = (p !== "/ask-cluck" && p !== "/crypto-school");
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
    // doesn't overlap the page's top content.
    if (showHome && !document.getElementById("cluck-nav-css")) {
      var st = document.createElement("style");
      st.id = "cluck-nav-css";
      st.textContent = "a.back,a.back-home,a.home{display:none!important}" +
        ".wrap{padding-top:58px!important}";
      document.head.appendChild(st);
    }
    var bar = document.createElement("div");
    bar.id = "cluck-nav-bar";
    bar.style.cssText = ["position:fixed", "top:12px", "left:50%", "transform:translateX(-50%)",
      "z-index:2147483000", "display:flex", "gap:8px", "align-items:center", "flex-wrap:wrap",
      "justify-content:center", "max-width:96vw"].join(";");
    if (showHome)  bar.appendChild(pill("/", '<span style="font-size:14px;line-height:1">🏠</span><span>Home</span>', false));
    if (showTools) bar.appendChild(pill("/tools", '<span style="font-size:14px;line-height:1">🛠️</span><span>All Tools</span>', false));
    if (showAsk)   bar.appendChild(pill("/ask-cluck", '<span style="font-size:14px;line-height:1">🔥</span><span>Ask Cluck</span>', true));
    document.body.appendChild(bar);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", inject);
  else inject();
})();
