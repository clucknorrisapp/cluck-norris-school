// Shared live market header for the token tools (Snapshot / Holders / Trace). Fetches
// /api/token-overview (CoinGecko aggregated for listed coins + GeckoTerminal onchain for
// everything) and renders a compact, theme-matched strip. Self-contained: inline styles,
// no dependency on the host page's CSS. Usage: renderMarketHeader(mint, "containerId").
(function () {
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function fmtUsd(n) { n = Number(n) || 0; return n >= 1e9 ? "$" + (n / 1e9).toFixed(2) + "B" : n >= 1e6 ? "$" + (n / 1e6).toFixed(2) + "M" : n >= 1e3 ? "$" + (n / 1e3).toFixed(1) + "K" : "$" + Math.round(n); }
  function fmtPrice(n) { n = Number(n); if (!n) return "—"; return n < 0.0001 ? "$" + n.toExponential(2) : n < 1 ? "$" + n.toPrecision(4) : "$" + n.toLocaleString(undefined, { maximumFractionDigits: 2 }); }

  function pill(label, value, color) {
    return '<div style="background:#0d0d0d;border:1px solid rgba(255,255,255,0.08);border-radius:9px;padding:7px 11px;">'
      + '<div style="font-family:\'Courier New\',monospace;font-size:8.5px;color:#6B7280;letter-spacing:0.5px;">' + esc(label) + '</div>'
      + '<div style="font-family:\'Oswald\',sans-serif;font-weight:700;font-size:14px;color:' + (color || '#F9FAFB') + ';margin-top:2px;">' + value + '</div></div>';
  }

  window.renderMarketHeader = async function (mint, container) {
    var el = typeof container === "string" ? document.getElementById(container) : container;
    if (!el || !mint) return;
    el.style.margin = el.style.margin || "0 0 14px";
    el.innerHTML = '<div style="font-family:\'Courier New\',monospace;font-size:11px;color:#6B7280;padding:8px;">loading market data…</div>';
    try {
      var r = await fetch('/api/token-overview?mint=' + encodeURIComponent(mint));
      var d = await r.json();
      if (!d || !d.success) { el.innerHTML = ''; return; }

      var up = d.change24hPct != null && d.change24hPct >= 0;
      var chg = d.change24hPct != null ? '<span style="color:' + (up ? '#6EE7B7' : '#FCA5A5') + ';font-size:12px;font-weight:700;"> ' + (up ? '▲' : '▼') + ' ' + Math.abs(d.change24hPct).toFixed(1) + '%</span>' : '';
      var img = d.image ? '<img src="' + esc(d.image) + '" onerror="this.style.display=\'none\'" style="width:30px;height:30px;border-radius:50%;object-fit:cover;flex-shrink:0;"/>' : '';
      var rankBadge = d.marketCapRank ? '<span style="background:rgba(217,119,6,0.15);border:1px solid rgba(217,119,6,0.4);color:#FCD34D;font-family:\'Oswald\',sans-serif;font-size:10px;font-weight:700;padding:2px 7px;border-radius:12px;letter-spacing:0.5px;">RANK #' + d.marketCapRank + '</span>' : '';
      var listedTag = d.listed
        ? '<span style="font-family:\'Courier New\',monospace;font-size:8.5px;color:#6EE7B7;">● CoinGecko + on-chain</span>'
        : '<span style="font-family:\'Courier New\',monospace;font-size:8.5px;color:#6B7280;">● on-chain (not CoinGecko-listed)</span>';

      var pills = '';
      pills += pill('PRICE', fmtPrice(d.priceUsd) + chg);
      if (d.liquidityUsd != null) pills += pill('LIQUIDITY', fmtUsd(d.liquidityUsd));
      if (d.volume24hUsd != null) pills += pill('24H VOLUME', fmtUsd(d.volume24hUsd));
      if (d.marketCapUsd != null) pills += pill('MARKET CAP', fmtUsd(d.marketCapUsd));
      else if (d.fdvUsd != null) pills += pill('FDV', fmtUsd(d.fdvUsd));
      if (d.athChangePct != null) pills += pill('FROM ATH', d.athChangePct.toFixed(0) + '%', '#FCA5A5');
      if (d.marketCount != null) pills += pill('LIVE MARKETS', d.marketCount + (d.dexes && d.dexes.length ? ' · ' + d.dexes.slice(0, 3).join('/') : ''));

      el.innerHTML =
        '<div style="background:#111;border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:14px 16px;">'
          + '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px;">'
            + img
            + '<div style="font-family:\'Oswald\',sans-serif;font-weight:900;font-size:18px;color:#F9FAFB;letter-spacing:0.5px;">' + esc(d.symbol || '?') + '</div>'
            + (d.name ? '<div style="font-family:\'Oswald\',sans-serif;font-size:11px;color:#6B7280;letter-spacing:1px;">' + esc(d.name) + '</div>' : '')
            + rankBadge
            + '<div style="margin-left:auto;">' + listedTag + '</div>'
          + '</div>'
          + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(96px,1fr));gap:8px;">' + pills + '</div>'
        + '</div>';
    } catch (e) { el.innerHTML = ''; }
  };
})();
