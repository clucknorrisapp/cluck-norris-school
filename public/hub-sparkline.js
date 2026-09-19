// Hub reproducibility sparkline (Colosseum roadmap §13 CC4) — a small inline SVG, no library,
// shared by public/hub-status.html (one per project row) and public/hub.html (one per project
// page) so the render logic exists in exactly one place (CLAUDE.md: private copies of a shared
// renderer have drifted into real bugs before). Reads the `days` array GET
// /api/hub/:project/reproducibility/history returns: [{day, reproduced, total, missingInputs}],
// ascending, with a day that was never recorded simply ABSENT from the array — never
// interpolated or guessed, so a gap here is drawn as a gap (no bar), never a zero or a smoothed
// line between neighbours.
(function (global) {
  "use strict";

  // viewBox is a fixed virtual width; the caller sizes the element on screen with CSS
  // (width:100%) so it never forces horizontal overflow on a narrow phone.
  var VBOX_W = 300;

  function barFill(day) {
    if (day.total > 0 && day.reproduced === day.total) return "var(--green, #10B981)";
    if (day.total > 0) return "var(--amber, #F59E0B)";
    return "var(--sub, #6B7280)"; // a recorded day with nothing to reproduce yet ("no receipts yet")
  }

  // `days` ascending, each {day, reproduced, total, missingInputs}. `opts.esc` should be
  // CluckUtil.esc (passed in so this file never needs its own copy). Renders one bar per day in
  // the SERIES ITSELF — a calendar gap (a day with no record at all) is not represented as an
  // empty slot with a fixed width, because the series never claims to know how many calendar
  // days elapsed between two records; it only ever draws the records it actually has, in order.
  function render(days, opts) {
    opts = opts || {};
    // P3-08 (docs/HUB_PUBLIC_SURFACES_VERIFY_2026-09-18.md): this used to fall back to an
    // identity "escaper" that did not escape anything. Both current callers (public/hub.html,
    // public/hub-status.html) already pass CluckUtil.esc, and the only value that reaches
    // <title>/aria-label today is a server-generated YYYY-MM-DD day key — but a shared renderer
    // whose default is "do not escape" is one forgetful call site away from an SVG injection.
    // Require it instead of silently rendering unescaped text.
    if (typeof opts.esc !== "function") throw new Error("HubSparkline.render requires opts.esc (e.g. CluckUtil.esc) — no identity-escaper fallback");
    var esc = opts.esc;
    var h = opts.height || 30;
    var list = Array.isArray(days) ? days : [];
    var n = Math.max(list.length, 1);
    var gap = list.length > 40 ? 0.5 : 1;
    var barW = Math.max((VBOX_W - gap * (n - 1)) / n, 1);
    var bars = list.map(function (d, i) {
      var x = i * (barW + gap);
      var total = Number(d.total) || 0, reproduced = Number(d.reproduced) || 0;
      var ratio = total > 0 ? Math.max(0, Math.min(1, reproduced / total)) : 1; // "no receipts yet" draws full-height neutral, not empty
      var barH = Math.max(ratio * h, total > 0 ? 2 : h);
      var y = h - barH;
      return '<rect x="' + x.toFixed(2) + '" y="' + y.toFixed(2) + '" width="' + barW.toFixed(2) + '" height="' + barH.toFixed(2) + '" fill="' + barFill({ total: total, reproduced: reproduced }) + '" rx="1"><title>' + esc(d.day + ": " + (total > 0 ? (reproduced + " of " + total + " reproduce" + (total === 1 ? "s" : "")) : "no receipts yet")) + '</title></rect>';
    }).join("");
    var ariaLabel = esc(opts.ariaLabel || summarize(list));
    return '<svg class="hub-spark" viewBox="0 0 ' + VBOX_W + ' ' + h + '" preserveAspectRatio="none" role="img" aria-label="' + ariaLabel + '" style="width:100%;height:' + h + 'px;display:block"><title>' + ariaLabel + '</title>' + bars + '</svg>';
  }

  // The plain-words text alternative — used for BOTH the aria-label/<title> above and a visible
  // line under the chart, so nobody who can't see (or render) the SVG loses information. Never
  // invents a percentage across days it doesn't have; a gap is described as a gap.
  function summarize(days) {
    var list = Array.isArray(days) ? days : [];
    if (!list.length) return "No reproducibility history recorded yet.";
    var last = list[list.length - 1];
    var lastTotal = Number(last.total) || 0, lastRepro = Number(last.reproduced) || 0;
    var lastLine = lastTotal > 0
      ? (lastRepro + " of " + lastTotal + " receipt" + (lastTotal === 1 ? "" : "s") + " reproduced on " + last.day)
      : ("no receipts yet on " + last.day);
    return lastLine + " — " + list.length + " day" + (list.length === 1 ? "" : "s") + " on record over the last " + VBOX_W_DAYS_NOTE(list) + ".";
  }
  // Kept as its own tiny function only so the "over the last N calendar days" phrase never claims
  // more than the data actually spans — it reads the first/last recorded day, not a fixed window.
  function VBOX_W_DAYS_NOTE(list) {
    if (list.length < 2) return "1 recorded day";
    var first = list[0].day, last = list[list.length - 1].day;
    var days = Math.round((Date.parse(last + "T00:00:00Z") - Date.parse(first + "T00:00:00Z")) / 86400000) + 1;
    return days + " calendar day" + (days === 1 ? "" : "s") + (days !== list.length ? " (" + list.length + " with a record)" : "");
  }

  global.HubSparkline = { render: render, summarize: summarize };
})(window);
