/* Cluck Norris — shared collision-avoidance for bottom-pinned floaters.

   Extracted from the site's global nav script (2026-09-22) so the STORE editions can ship it
   too. On the website that script injects this file; the bundled google/ios editions have no nav
   script, so seeker.html loads it directly and store-edition.json lists it in `files`.
   Before this split, i18n.js's `if (window.__clknDockFloat)` guard silently no-opped inside the
   app and the 🌐 pill sat on the school's course cards at every phone width (found on the iOS
   simulator at 390x844 / 402x874 / 440x956, 2026-09-22).

   ONE copy, loaded by both paths — do not inline a private copy into either (the drift that
   caused the esc()/WALLETS bugs). */
(function () {
// Shared collision-avoidance for the two bottom-pinned floaters (the Listen bar bottom-left,
// the language toggle bottom-right). On pages with a bottom-anchored composer (/ask-cluck) the
// default bottom:14px lands ON the input row: the Listen pill hid the placeholder's first words
// and made the left ~72px of the field untappable, and the 🌐 pill sat on the send button
// (found on iPad, 2026-08-16). One helper here, called by both injectors — NOT copied into each
// (private copies of shared browser code drifting is how the esc()/WALLETS bugs happened).
// Method: reset to the default anchor, measure, and if the floater overlaps any visible form
// control it doesn't contain, lift it 10px above the highest one. Re-runs on resize (covers the
// on-screen keyboard) and on two delayed passes for late-rendering pages like the React school.
// Also opts in plain content (tile/card grids, short headings/sub-lines), not just form
// controls — two opt-in markers, and they are NOT interchangeable:
//   data-clkn-avoid-kids on a container  → every DIRECT CHILD is checked individually
//     (a grid of cards: each card's own top is what matters, e.g. two rows 12px apart).
//   data-clkn-avoid on one short element  → that element itself is checked
//     (a one-line heading or sub-line).
// Marking a tall multi-row container directly (instead of -kids) was tried and is wrong:
// its OWN top is the first row's top, so the pill "overlaps" across the container's full
// height and climbs way past where any actual row sits — caught on / where it cascaded the
// pill all the way up into the hero text. Found the underlying overlap on / (the quick tile
// grid's rows, the hero lede) and /tools (tool cards, section sub-lines) at 390px and
// 1280px, where the pills sat on ordinary text and <a> cards on first paint, nothing to do
// with an on-screen keyboard (2026-09-10).
window.__clknDockFloat = function (el) {
  if (!el || el.__clknDocked) return; el.__clknDocked = 1;
  // The resting anchor. A shell with its own bottom-pinned chrome (the seeker nav) raises it
  // by setting --clkn-dock-base on the floater; everything else gets the plain 14px inset.
  var DEF = "var(--clkn-dock-base, calc(14px + env(safe-area-inset-bottom,0px)))";
  function fit() {
    try {
      var lift = 0;
      // Iterative: a single measure-and-lift pass is enough to clear one composer, but
      // stacked cards (tile/card grids) sit only ~12px apart, so lifting to clear the one
      // the pill first touches can walk it straight into the NEXT one up. Re-measure at
      // the new position and keep climbing until nothing overlaps (found this on /tools,
      // where clearing card #2 pushed the pill into card #1 above it — 2026-09-10).
      for (var pass = 0; pass < 20; pass++) {
        // setProperty(..., "important"): a shell may pin this floater with an !important
        // stylesheet rule, which a plain inline style loses to — so the lift never applied
        // inside the seeker shell and the pill stayed on the cards (2026-09-22).
        el.style.setProperty("bottom", lift ? (lift + "px") : DEF, "important");
        var b = el.getBoundingClientRect(); if (!b.width) return;
        var found = false;
        var els = document.querySelectorAll("input,textarea,select,button,[contenteditable='true'],[data-clkn-avoid],[data-clkn-avoid-kids] > *");
        for (var i = 0; i < els.length; i++) {
          var e = els[i];
          if (el.contains(e)) continue;
          var host = e.closest && e.closest("#clkn-read-bar,#clkn-lang-toggle,#cluck-nav-bar");
          if (host) continue;
          var r = e.getBoundingClientRect();
          if (!r.width || !r.height) continue;
          var ox = Math.min(b.right, r.right) - Math.max(b.left, r.left);
          var oy = Math.min(b.bottom, r.bottom) - Math.max(b.top, r.top);
          if (ox > 0 && oy > 0) {
            var need = (window.innerHeight - r.top) + 10;         // r.top already includes the safe area
            if (need > lift) { lift = need; found = true; }
          }
        }
        if (!found) break;
      }
    } catch (_) {}
  }
  fit();
  window.addEventListener("resize", fit);
  setTimeout(fit, 800); setTimeout(fit, 2500);
};
  // Load order is not guaranteed: on the website this file and i18n.js are injected in parallel,
  // and the store edition loads both as ordinary tags. i18n.js calls the helper if it is already there;
  // if it is not, this pass catches the floaters that were created first. __clknDocked makes the
  // second call a no-op either way.
  function dockExisting() {
    var ids = ["clkn-lang-toggle", "clkn-read-bar"];
    for (var i = 0; i < ids.length; i++) {
      var el = document.getElementById(ids[i]);
      if (el) window.__clknDockFloat(el);
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", dockExisting);
  else dockExisting();
  setTimeout(dockExisting, 1200);
})();
