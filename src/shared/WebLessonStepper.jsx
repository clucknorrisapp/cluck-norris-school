// The lesson stepper, for the WEBSITE's school (owner, 2026-09-25: "Yes all of website", after
// "send stepper on all levels" for the phone app). The Seeker / Play / iOS app has its own
// stepper in src/seeker/school/School.jsx, styled with that app's classes; this one is styled the
// way the website's lesson screens are (inline styles, Anton labels, the lesson's own accent
// colour) so it reads as part of the page rather than a transplant.
//
// What the two share, deliberately: the remembered-position store (loadStep / saveStep /
// clearStep in ./lessonSteps.js), the scroll helper (./scrollReveal.js), and the behaviour —
// one idea per screen, a strip of tappable segments, Back / Next, a horizontal swipe that leaves
// the screen edges to the OS, focus moved to the new step's heading, and an opening step whose
// "IN THIS LESSON" outline jumps to any step.
//
// What the CALLER owns: which steps a lesson has and what each renders. Every website lesson
// screen is shaped differently (the belt lessons have a quote and a belt; LP Lab has calculators
// and tables; the Library has a Cluck hook and a verdict), so the caller passes finished nodes:
//
//   steps:  [{ label, node }]   step 0 is the opening; steps 1.. get `label` as their heading
//                               and as their line in the opening's outline.
//   finish: node                rendered on the LAST step in place of Next — the quiz button, or
//                               a close button for the Library, which has no exams.
//
// Render it with key={storeKey}: a new lesson must remount it, so one lesson's position can
// never be written under the next lesson's key.
//
// i18n: the website translates by matching rendered text against curated dictionaries
// (public/i18n.js), one text node at a time. The fixed labels here ("In this lesson", "Back",
// "Next", "Start the lesson") are rendered in exactly the case the six base dictionaries already
// hold (added for the app) and uppercased with CSS, and the arrows sit in their own text node,
// so every one of them hits a curated translation instead of the live machine-translation call.
// The step counter is bare numbers ("2 / 8") so it never needs a translation per count.

import { useState, useEffect, useRef } from "react";
import { clampStep, loadStep, saveStep } from "./lessonSteps.js";
import { revealUnderClear } from "./scrollReveal.js";

// Same clear line as the website's quiz screens: the floating #cluck-nav-bar pill and the app's
// sticky [data-cluck-top-clear] header, whichever sits lower.
function topClearY() {
  let y = 0;
  const bar = document.getElementById("cluck-nav-bar");
  if (bar) y = Math.max(y, bar.getBoundingClientRect().bottom);
  const header = document.querySelector("[data-cluck-top-clear]");
  if (header) y = Math.max(y, header.getBoundingClientRect().bottom);
  return y;
}

const ANTON = "'Anton',sans-serif";

export default function WebLessonStepper({ storeKey, color = "#FF7A18", steps, finish, onStepChange }) {
  const total = steps.length;
  const [i, setI] = useState(() => loadStep(storeKey, total));
  const rootRef = useRef(null);
  const headRef = useRef(null);
  const moved = useRef(false);
  const touch = useRef(null);

  useEffect(() => { saveStep(storeKey, i); }, [storeKey, i]);

  useEffect(() => {
    if (!moved.current) return;
    if (onStepChange) { try { onStepChange(i); } catch (_) {} }
    let raf1 = requestAnimationFrame(() => {
      raf1 = requestAnimationFrame(() => {
        if (rootRef.current) revealUnderClear({ scrollEl: window, el: rootRef.current, topClearY: topClearY() });
        try { if (headRef.current) headRef.current.focus({ preventScroll: true }); } catch (_) {}
      });
    });
    return () => cancelAnimationFrame(raf1);
  }, [i]);

  function go(n) {
    const c = clampStep(n, total);
    if (c === i) return;
    moved.current = true;
    setI(c);
  }

  function onTouchStart(e) {
    touch.current = null;
    if (!e.touches || e.touches.length !== 1) return;
    const p = e.touches[0];
    const w = window.innerWidth || 0;
    if (p.clientX < 24 || (w && p.clientX > w - 24)) return;          // leave the edges to the OS
    const el = e.target;
    // Calculators have sliders and inputs; a drag on one is never a page turn.
    if (el && el.closest && el.closest("input, textarea, select, [data-no-swipe]")) return;
    touch.current = { x: p.clientX, y: p.clientY, t: Date.now() };
  }

  function onTouchEnd(e) {
    const s = touch.current;
    touch.current = null;
    if (!s || !e.changedTouches || !e.changedTouches.length) return;
    const p = e.changedTouches[0];
    const dx = p.clientX - s.x;
    const dy = p.clientY - s.y;
    if (Date.now() - s.t > 700) return;
    if (Math.abs(dx) < 56 || Math.abs(dy) > Math.abs(dx) * 0.6) return;
    try { if (String(window.getSelection && window.getSelection()).trim()) return; } catch (_) {}
    go(dx < 0 ? i + 1 : i - 1);
  }

  const last = i === total - 1;
  const step = steps[i] || steps[0];

  return (
    <div ref={rootRef} data-lesson-stepper="1" style={{ scrollMarginTop: 12 }}>
      <div data-read-skip="1" style={{ display: "flex", gap: 4, marginBottom: 2 }}>
        {steps.map((s, n) => (
          <button
            key={n}
            type="button"
            data-lesson-step-seg="1"
            aria-current={n === i ? "step" : undefined}
            aria-label={`${n + 1} / ${total}`}
            onClick={() => go(n)}
            style={{ flex: "1 1 0", minWidth: 0, height: 28, padding: 0, border: "none", background: "none", cursor: "pointer", display: "flex", alignItems: "center" }}
          >
            <span style={{ display: "block", width: "100%", height: 5, borderRadius: 999, background: n === i ? color : n < i ? `${color}73` : "rgba(255,122,24,0.14)" }} />
          </button>
        ))}
      </div>
      <div data-read-skip="1" data-lesson-step-count="1" style={{ fontFamily: "monospace", fontSize: 12.5, color: "#6B7280", marginBottom: 14 }}>
        {i + 1} / {total}
      </div>

      <div onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        {i > 0 ? (
          <h3
            ref={headRef}
            tabIndex={-1}
            style={{ fontFamily: ANTON, fontSize: 18, color, letterSpacing: 1, margin: "0 0 12px", outline: "none" }}
          >
            {step.label}
          </h3>
        ) : null}
        {step.node}

        {i === 0 && total > 1 ? (
          <div style={{ background: "rgba(255,122,24,0.05)", border: "1px solid rgba(255,122,24,0.16)", borderRadius: 12, padding: "10px 8px 6px", margin: "16px 0 4px" }}>
            <div style={{ fontFamily: ANTON, fontSize: 12.5, letterSpacing: 2, color: "#6B7280", padding: "0 8px 6px", textTransform: "uppercase" }}>In this lesson</div>
            {steps.slice(1).map((s, k) => (
              <button
                key={k}
                type="button"
                onClick={() => go(k + 1)}
                style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", minHeight: 44, padding: "6px 8px", border: "none", borderRadius: 8, background: "none", color: "#D1D5DB", textAlign: "left", cursor: "pointer", fontSize: 15, lineHeight: 1.35 }}
              >
                <span data-read-skip="1" style={{ flex: "0 0 auto", width: 22, textAlign: "right", fontFamily: "monospace", fontSize: 12.5, color }}>{k + 1}</span>
                <span style={{ flex: "1 1 auto", minWidth: 0 }}>{s.label}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div data-clkn-avoid="1" style={{ display: "flex", gap: 10, marginTop: 20, alignItems: "stretch" }}>
        {i > 0 ? (
          <button
            type="button"
            data-lesson-step-back="1"
            onClick={() => go(i - 1)}
            style={{ flex: "0 0 auto", minWidth: 96, background: "rgba(255,122,24,0.09)", border: "1px solid rgba(255,122,24,0.22)", borderRadius: 10, padding: "13px 16px", fontFamily: ANTON, fontSize: 15, color: "#D1D5DB", letterSpacing: 2, cursor: "pointer", textTransform: "uppercase" }}
          >
            ← <span>Back</span>
          </button>
        ) : null}
        {!last ? (
          <button
            type="button"
            data-lesson-step-next="1"
            onClick={() => go(i + 1)}
            style={{ flex: "1 1 auto", background: color, border: "none", borderRadius: 10, padding: "13px", fontFamily: ANTON, fontSize: 15, fontWeight: 700, color: "#fff", letterSpacing: 2, cursor: "pointer", textTransform: "uppercase" }}
          >
            <span>{i === 0 ? "Start the lesson" : "Next"}</span> →
          </button>
        ) : (
          <div style={{ flex: "1 1 auto", minWidth: 0 }}>{finish}</div>
        )}
      </div>
    </div>
  );
}
