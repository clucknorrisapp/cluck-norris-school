/* Cluck Norris — global "Ask Cluck" entry point.
   Injects a small fixed fire-pill (top-right) linking to /ask-cluck on every
   page that includes this script. Self-contained inline styles so it works
   even on pages that don't load theme.css. Hides itself on the Ask Cluck page.
   Add to a page with: <script defer src="/cluck-nav.js"></script> */
(function () {
  var p = (location.pathname || "").replace(/\/+$/, "");
  if (p === "/ask-cluck" || p === "/crypto-school") return; // already there

  function inject() {
    if (document.getElementById("cluck-ask-nav")) return;
    if (!document.body) return;
    var a = document.createElement("a");
    a.id = "cluck-ask-nav";
    a.href = "/ask-cluck";
    a.setAttribute("aria-label", "Ask Cluck — live crypto lectures");
    a.innerHTML = '<span style="font-size:14px;line-height:1">🔥</span><span>Ask Cluck</span>';
    a.style.cssText = [
      "position:fixed", "top:12px", "left:50%", "transform:translateX(-50%)", "z-index:2147483000",
      "display:inline-flex", "align-items:center", "gap:6px",
      "font-family:'Anton','Chakra Petch',system-ui,sans-serif",
      "font-size:13px", "font-weight:400", "letter-spacing:.6px", "text-transform:uppercase",
      "color:#fff", "text-decoration:none", "white-space:nowrap",
      "background:linear-gradient(135deg,#FF7A18,#E81E0E)",
      "padding:8px 14px", "border-radius:999px",
      "box-shadow:0 4px 16px rgba(232,30,14,.45)",
      "border:1px solid rgba(255,182,39,.5)",
      "transition:transform .12s,box-shadow .12s",
      "-webkit-tap-highlight-color:transparent"
    ].join(";");
    a.addEventListener("mouseenter", function () { a.style.transform = "translateX(-50%) translateY(-1px)"; a.style.boxShadow = "0 6px 20px rgba(232,30,14,.6)"; });
    a.addEventListener("mouseleave", function () { a.style.transform = "translateX(-50%)"; a.style.boxShadow = "0 4px 16px rgba(232,30,14,.45)"; });
    document.body.appendChild(a);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", inject);
  else inject();
})();
