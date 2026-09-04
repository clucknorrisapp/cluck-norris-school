/* Cluck Norris — shared browser helpers.
 *
 * WHY THIS EXISTS: the same four functions had been re-typed on nearly every tool
 * page, and the copies had drifted. Two of the drifts mattered:
 *
 *   esc()  — 16 copies, FOUR of which did not escape the single quote
 *            (buyspecial-dashboard, buyspecial-optin, locker-room, stats). Those
 *            pages happened to be safe because they interpolate into double-quoted
 *            attributes — but they render attacker-controlled token metadata
 *            (symbol, name, icon URL), so they were one single-quoted attribute
 *            away from a live XSS. The version here escapes & < > " ' always.
 *
 *   rpc()  — 6 copies, one of which (buyspecial-dashboard) returned the raw
 *            JSON-RPC envelope instead of throwing on `error`, so failures came
 *            back as undefined further down instead of surfacing.
 *
 * ⚠️ public/ is NOT statically mounted — this file needs its explicit app.get
 * route in server.js, and the <script src> tag must come BEFORE any code that
 * calls these.
 */
(function (global) {
  "use strict";

  // Escape for HTML text AND attribute contexts. The single quote is included on
  // purpose: without it, a value landing in a single-quoted attribute can break
  // out. Token names/symbols come from chain metadata and are attacker-set.
  var ESC_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return ESC_MAP[c]; });
  }

  // JSON-RPC through our own proxy (which holds the key and enforces a
  // method allow-list). Throws on a JSON-RPC error so callers can't silently
  // carry on with undefined.
  async function rpc(method, params, url) {
    var r = await fetch(url || "/api/helius-rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: method, params: params }),
    });
    var d = await r.json();
    if (d && d.error) throw new Error(d.error.message || "RPC error");
    return d.result;
  }

  function shortAddr(a, head, tail) {
    a = String(a || "");
    head = head || 4; tail = tail || 4;
    return a.length > head + tail + 2 ? a.slice(0, head) + "…" + a.slice(-tail) : a;
  }

  // Compact number: 1.23B / 4.56M / 7.8K / 123.
  function fmt(n) {
    n = Number(n) || 0;
    if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
    if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
    return Math.round(n).toLocaleString();
  }

  // Clipboard with the execCommand fallback — navigator.clipboard is unavailable
  // on insecure origins and inside some wallet webviews.
  function copyText(text) {
    return new Promise(function (resolve) {
      var done = function () { resolve(true); };
      var fallback = function () {
        try {
          var ta = document.createElement("textarea");
          ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
          document.body.appendChild(ta); ta.focus(); ta.select();
          document.execCommand("copy"); document.body.removeChild(ta); done();
        } catch (e) { resolve(false); }
      };
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done, fallback);
        } else fallback();
      } catch (e) { fallback(); }
    });
  }

  // A URL SAFE TO PUT IN AN href. esc() escapes HTML; it does NOT restrict the URL SCHEME, and
  // escaping is not a defence here. `javascript:alert(document.domain)` contains none of & < > " '
  // so esc() returns it byte-for-byte. Even when a payload DOES contain quotes and esc() escapes
  // them, the HTML parser decodes &#39; back to ' before the URL is used — so the script still
  // runs. The scheme is the thing that has to be checked.
  //
  // autopsy.html solved this for itself with a private safeUrl() and nothing else got it —
  // jupverify-admin.html rendered a PUBLIC, unauthenticated submitter's Website/Icon/Telegram
  // fields as live anchors in a page holding the admin key in sessionStorage. That is the
  // "check every form, not one form" trap in CLAUDE.md, so this lives HERE, once, shared.
  //
  // Returns "#" for anything that is not http(s) — never the original string, so a caller cannot
  // accidentally pass the dangerous value through. The result is escaped, ready for an attribute.
  function safeUrl(u) {
    var t = String(u == null ? "" : u).trim();
    return /^https?:\/\//i.test(t) ? esc(t) : "#";
  }

  global.CluckUtil = { esc: esc, safeUrl: safeUrl, rpc: rpc, shortAddr: shortAddr, fmt: fmt, copyText: copyText };
})(typeof globalThis !== "undefined" ? globalThis : window);
