// Shared quiz auto-scroll helper — owner (2026-09-24, testing the iOS edition, then confirmed on
// the web app too): "when you click an answer and it's correct, it should automatically adjust up
// to show correct, then the description, then the link for the next question. I shouldn't have to
// drag." Used by BOTH the website's quiz screens (src/App.jsx's Incubator/Lesson, and LP Lab's
// LPLessonView in src/sections/LPLab.jsx) and the Seeker app's school quiz
// (src/seeker/school/School.jsx) so the behaviour cannot drift between the two surfaces.
//
// Deliberately framework- and DOM-tree-agnostic: no React import, no assumption about which
// element scrolls or which chrome is fixed on top of it. Callers resolve their own
// `scrollEl`/clearance elements (a `.seeker-main` pane on the phone app vs. `window` on the
// website, whose own sticky header + the floating `#cluck-nav-bar` pill both sit above the
// content) and pass in plain numbers/elements.

/** True when the OS/browser asks for no non-essential motion. */
export function prefersReducedMotion() {
  try {
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  } catch (_) {
    return false;
  }
}

/** `"smooth"` normally, `"auto"` (instant) under prefers-reduced-motion. */
export function scrollBehavior() {
  return prefersReducedMotion() ? "auto" : "smooth";
}

/** Scroll `scrollEl` (an element with its own scrollbar, or `window`) by `delta` pixels. */
export function scrollByDelta(scrollEl, delta, behavior) {
  if (!scrollEl || !delta) return;
  if (scrollEl === window || (typeof document !== "undefined" && scrollEl === document.scrollingElement)) {
    const top = (window.scrollY || document.documentElement.scrollTop || 0) + delta;
    window.scrollTo({ top, behavior });
  } else if (typeof scrollEl.scrollTo === "function") {
    scrollEl.scrollTo({ top: scrollEl.scrollTop + delta, behavior });
  }
}

/**
 * Answer just tapped: bring the verdict/explanation block and the Next/Finish button into view
 * without a drag. `topClearY`/`bottomClearY` are the viewport y-coordinates fixed chrome already
 * occupies (a header's bottom edge, a bottom nav's top edge) — pass 0 / Infinity when there is
 * none on that side.
 */
export function revealQuizResult({ scrollEl, resultEl, actionEl, topClearY = 0, bottomClearY = Infinity, margin = 12 }) {
  if (!scrollEl || !resultEl || !actionEl) return;
  const behavior = scrollBehavior();
  const available = bottomClearY - topClearY;
  const resultRect = resultEl.getBoundingClientRect();
  const actionRect = actionEl.getBoundingClientRect();
  if (resultRect.height <= available) {
    // The whole result block fits on screen at once — pull whichever edge is clipped.
    if (actionRect.bottom > bottomClearY - margin) {
      scrollByDelta(scrollEl, actionRect.bottom - (bottomClearY - margin), behavior);
    } else if (resultRect.top < topClearY + margin) {
      scrollByDelta(scrollEl, resultRect.top - (topClearY + margin), behavior);
    }
  } else {
    // Taller than the viewport — lead with the verdict, just under the fixed chrome, same order
    // the owner asked for: "adjust up to show correct, then the description, then the link."
    scrollByDelta(scrollEl, resultRect.top - (topClearY + margin), behavior);
  }
}

/** Align `el`'s top just under the top clearance — a fresh question heading, or a result summary. */
export function revealUnderClear({ scrollEl, el, topClearY = 0, margin = 12 }) {
  if (!scrollEl || !el) return;
  const rect = el.getBoundingClientRect();
  scrollByDelta(scrollEl, rect.top - (topClearY + margin), scrollBehavior());
}
