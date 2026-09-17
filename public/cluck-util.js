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

  // Money. fmt() rounds to whole numbers, which is right for token counts and wrong for dollars —
  // an $82.54 claim rendering as "83" is a number nobody can reconcile against their wallet.
  // Returns null rather than "$0.00" when there is no usable price: a missing feed must not be
  // shown as a worthless bag. Callers render nothing on null.
  function fmtUsd(n) {
    n = Number(n);
    if (!isFinite(n) || n <= 0) return null;
    if (n >= 1000) return "$" + Math.round(n).toLocaleString();          // cents are noise up here
    if (n >= 1) return "$" + n.toFixed(2);
    if (n >= 0.01) return "$" + n.toFixed(3);
    // Sub-cent: show enough significant digits to be meaningful instead of "$0.00".
    return "$" + n.toPrecision(3).replace(/e[-+]\d+$/i, "");
  }

  // BigInt-safe amount formatting. `Number(rawString)` silently loses precision the moment a raw
  // on-chain amount (a lock weight, a large token balance) passes Number.MAX_SAFE_INTEGER — this
  // does the base-units → decimal conversion and thousands-grouping with string/BigInt math only,
  // exact at any size, matching the "string surgery, never division" rule lib/hub/public.js's
  // rawToUi already follows server-side.
  function rawAmount(raw, decimals, maxFrac) {
    decimals = decimals > 0 ? decimals : 0;
    maxFrac = maxFrac == null ? 2 : maxFrac;
    var s = String(raw == null ? "0" : raw).trim();
    var neg = s.charAt(0) === "-"; if (neg) s = s.slice(1);
    s = s.replace(/[^0-9]/g, "") || "0";
    var w, f;
    if (decimals <= 0) { w = s; f = ""; }
    else {
      if (s.length <= decimals) s = new Array(decimals - s.length + 2).join("0") + s;
      w = s.slice(0, s.length - decimals); f = s.slice(s.length - decimals);
    }
    if (f.length > maxFrac) {
      var keep = f.slice(0, maxFrac);
      if (f.charAt(maxFrac) >= "5") {
        var bumped = (BigInt(w || "0") * (maxFrac > 0 ? BigInt("1" + new Array(maxFrac + 1).join("0")) : 1n) + BigInt(keep || "0") + 1n).toString();
        if (maxFrac > 0) {
          while (bumped.length <= maxFrac) bumped = "0" + bumped;
          w = bumped.slice(0, bumped.length - maxFrac); keep = bumped.slice(bumped.length - maxFrac);
        } else { w = bumped; keep = ""; }
      }
      f = keep;
    }
    f = f.replace(/0+$/, "");
    w = w.replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return (neg && (w !== "0" || f) ? "-" : "") + w + (f ? "." + f : "");
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

  global.CluckUtil = { esc: esc, safeUrl: safeUrl, rpc: rpc, shortAddr: shortAddr, fmt: fmt, fmtUsd: fmtUsd, rawAmount: rawAmount, copyText: copyText };
})(typeof globalThis !== "undefined" ? globalThis : window);
