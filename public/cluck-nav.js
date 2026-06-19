/* Cluck Norris — global floating nav: a Home link + an "Ask Cluck" link, pinned
   top-center on every page that includes this script. One file controls both.
   - Home hides when you're already at "/".
   - Ask Cluck hides on the Ask Cluck page itself (/ask-cluck, /crypto-school).
   Self-contained inline styles so it works even without theme.css.
   Add to a page with: <script defer src="/cluck-nav.js"></script> */
(function () {
  var p = (location.pathname || "").replace(/\/+$/, "");
  var showHome = (p !== "" && p !== "/");                         // not already home
  var showAsk  = (p !== "/ask-cluck" && p !== "/crypto-school");  // not already there
  if (!showHome && !showAsk) return;

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
    var bar = document.createElement("div");
    bar.id = "cluck-nav-bar";
    bar.style.cssText = ["position:fixed", "top:12px", "left:50%", "transform:translateX(-50%)",
      "z-index:2147483000", "display:flex", "gap:8px", "align-items:center"].join(";");
    if (showHome) bar.appendChild(pill("/", '<span style="font-size:14px;line-height:1">🏠</span><span>Home</span>', false));
    if (showAsk)  bar.appendChild(pill("/ask-cluck", '<span style="font-size:14px;line-height:1">🔥</span><span>Ask Cluck</span>', true));
    document.body.appendChild(bar);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", inject);
  else inject();
})();
