// Lesson stepper — which lessons read one section per screen, and in what order.
//
// Owner (2026-09-24, reading LP Lab on the iOS edition): "scroll, scroll, scroll … a lot of stuff
// stacked … maybe we break those ideas up into smaller sections before the quiz. Open suggestions."
// The phone app rendered every section of a lesson open, one under the other, then the verdict,
// then the quiz button — up to 42 paragraphs and ~8,600 characters on one screen for the longest
// LP Lab lesson. This module decides how a lesson is split; the screen that renders it lives in
// the app (src/seeker/school/School.jsx) and can live on the website later with the same rules.
//
// Deliberately framework- and DOM-free (no React, no window at import time) so it can be unit
// tested in Node — scripts/lesson-steps-test.cjs — and shared between surfaces the way
// src/shared/scrollReveal.js already is, so the two schools cannot drift on what a step is.
//
// THE RULES, and why each one:
//
//   · EVERY LESSON STEPS (owner, 2026-09-25: "send stepper on all levels"). The first cut stepped
//     only lessons with two or more sections; the owner asked for the same reading frame on every
//     course — the Incubator, the School of Hard Knocks belts, the LP Lab library and the Deep
//     Dive. A lesson steps whenever it has anything beyond its opening to show, which on
//     data/curriculum.json (2026-09-25) is all 58.
//
//   · The FIRST step is the lesson's opening: title, belt, tagline, intro, and an outline of what
//     follows ("In this lesson"). That outline is the "what you'll learn" the owner was offered,
//     and each line jumps straight to its step, which is also how a repeat visitor skips ahead.
//     For the Incubator and the belt lessons the intro IS the explanation, so it stays on the
//     opening rather than being moved behind a tap.
//
//   · Terms (`concepts`) are their own step right after the opening — read the vocabulary before
//     the argument that uses it. For the Incubator and belt lessons this is the second (and last)
//     step, and it carries the quiz button.
//
//   · ONE SECTION PER STEP, never split inside a section. The sections are the authors' own
//     units of thought, with their own headings; cutting one mid-argument to hit a character
//     budget would be worse than a slightly long screen.
//
//   · Prose (`content`, the liquidity library's form) is ONE step and is never cut into parts.
//     The longest is ~1,300 characters, about a screen and a half. It also cannot be cut safely:
//     the curated dictionaries key a block by its WHOLE body (tBlock in src/seeker/i18n.js), so
//     splitting the English before translating would send every part to machine translation.
//
//   · Cluck's verdict is the LAST step when a lesson has one. The quiz button (or "Mark as read"
//     for a lesson with no quiz) always lives on the last step — never a step that exists only to
//     hold a button.

/**
 * @param {{ sections?: Array<{heading?: string, body?: string}>, concepts?: Array, content?: string, verdict?: string }} lesson
 * @returns {{ stepped: boolean, steps: Array<{ kind: "open"|"terms"|"section"|"content"|"verdict", index?: number, heading?: string }> }}
 *   `index` on a "section" step is the position in `lesson.sections` — the renderer reads the
 *   body from the lesson, so a step never carries a stale copy of the text.
 */
export function buildLessonSteps(lesson) {
  const l = lesson || {};
  const sections = Array.isArray(l.sections) ? l.sections : [];
  const usable = sections
    .map((s, index) => ({ s, index }))
    .filter(({ s }) => s && (String(s.body || "").trim() || String(s.heading || "").trim()));

  const steps = [{ kind: "open" }];
  if (Array.isArray(l.concepts) && l.concepts.length) steps.push({ kind: "terms" });
  for (const { s, index } of usable) steps.push({ kind: "section", index, heading: String(s.heading || "") });
  if (typeof l.content === "string" && l.content.trim()) steps.push({ kind: "content" });
  if (String(l.verdict || "").trim()) steps.push({ kind: "verdict" });
  // Only the opening would be a stepper around nothing — leave that lesson on its single page.
  if (steps.length < 2) return { stepped: false, steps: [] };
  return { stepped: true, steps };
}

/** Clamp a remembered or requested step index into range. Anything unusable reads as 0. */
export function clampStep(i, total) {
  const n = Number(i);
  if (!Number.isInteger(n) || n < 0 || !total) return 0;
  return Math.min(n, total - 1);
}

// ── remembering where you were ─────────────────────────────────────────────────────────────
// One small object in localStorage, keyed by the caller's own lesson key (the app uses its
// course-scoped `course:lesson` key — lesson ids repeat across courses, see curriculum.js).
// Bounded so a learner who opens every lesson does not grow it forever. Every read and write is
// wrapped: a private window, cleared site data or a full quota must degrade to "start at the
// top", never to a lesson that will not open.

export const STEP_STORE_KEY = "clkn_lesson_step";
const STEP_STORE_MAX = 80;

function readAll(storage) {
  try {
    const v = JSON.parse((storage || globalThis.localStorage).getItem(STEP_STORE_KEY) || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch (_) {
    return {};
  }
}

function writeAll(all, storage) {
  try {
    const keys = Object.keys(all);
    // Oldest first by insertion order; drop from the front once over the cap.
    for (let i = 0; i < keys.length - STEP_STORE_MAX; i++) delete all[keys[i]];
    (storage || globalThis.localStorage).setItem(STEP_STORE_KEY, JSON.stringify(all));
  } catch (_) {}
}

/** The step a learner left this lesson on, or 0. */
export function loadStep(lessonKey, total, storage) {
  const all = readAll(storage);
  return clampStep(all[lessonKey], total);
}

/** Remember the current step. Step 0 is the default, so it is stored as "nothing". */
export function saveStep(lessonKey, i, storage) {
  const all = readAll(storage);
  delete all[lessonKey];                 // re-insert so this lesson becomes the newest entry
  if (i > 0) all[lessonKey] = i;
  writeAll(all, storage);
}

/** Forget this lesson's position — after a pass, the next visit opens at the top. */
export function clearStep(lessonKey, storage) {
  const all = readAll(storage);
  if (!(lessonKey in all)) return;
  delete all[lessonKey];
  writeAll(all, storage);
}
