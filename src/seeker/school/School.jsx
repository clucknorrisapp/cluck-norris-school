// The school, built for a phone.
//
// ⚠️ WHY THIS EXISTS AT ALL. The Seeker app shipped with NO school in it. Not hidden — never
// built. `seeker.html` is its own Vite entry over src/seeker/*, the build scope doc listed
// fifteen TOOLS, and that list quietly became the whole app: `/` landed on `/tools`. The owner
// found it on the device ("where is the whole school? that is the whole major part of the app").
// The school is the flagship (AGENTS.md), so it leads.
//
// This is a REBUILD, not a port. The lessons are the same words — read from data/curriculum.json,
// which is generated from the desktop school's own source — but the reading experience is built
// for a thumb: one lesson per screen, one question at a time, big targets, and it works with no
// connection because the curriculum is bundled.
//
// Follows the pane contract in docs/SEEKER_TOOLS_BUILD.md §3: four states never conflated, every
// string through t(), no verdicts, nothing hardcoded that belongs in config. Three notes specific
// to this surface:
//
//   - THERE IS NO "UNAVAILABLE" STATE FOR READING. The curriculum is in the bundle, so a lesson
//     can always be opened. Nothing here fetches to render. The only network call is the
//     completion beacon, and it is fire-and-forget with a durable queue behind it (src/track.js).
//   - A FAILED BEACON MUST NOT LOOK LIKE A FAILED LESSON. The learner passed; the mark is queued
//     and re-sent. Telling them the lesson did not count would be false, and the graduation gate
//     already re-sends the device's own marks before a claim.
//   - TWO ID SPACES, DELIBERATELY. Local progress is keyed by `lesson.key` (`course:lesson`)
//     because lesson ids repeat across courses; the LEDGER BEACON keeps the BARE `lesson.id`,
//     because that is the id space the website has always written and the server's grad-gate
//     ledger already holds. Mixing them would either credit the wrong course locally or fork the
//     ledger. Both bugs existed here — see the Codex round on PR #390.

import React from "react";
import { revealQuizResult, revealUnderClear, scrollBehavior } from "../../shared/scrollReveal.js";
import { buildLessonSteps, clampStep, loadStep, saveStep, clearStep } from "../../shared/lessonSteps.js";
import { useParams, useNavigate, Link } from "react-router-dom";
import { t, tf, tBlock, useI18nReady } from "../i18n.js";
import { track } from "../../track.js";
import { INDEX as SOLANA_ROOM_INDEX } from "../solana/content.js";
import "../solana/solana.css";
import {
  COURSES, TOTAL_LESSONS, courseById, lessonById,
  completedIds, isDone, markDone, courseProgress, nextLesson, passMark,
} from "./curriculum.js";
import ShieldIcon from "../icons/ShieldIcon.jsx";
import "./school.css";

// The id shape the server ledger expects — identical to the website's trackId(), so a lesson
// passed on the phone and the same lesson passed on the web land on the same ledger row.
// ⚠️ Takes the BARE lesson id, never the course-scoped key: a colon would be stripped and
// `basicswallet` is not a row the website has ever written.
function beaconId(id) {
  return String(id).toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 48);
}

function Bar({ done, total }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="seeker-school-bar" role="img" aria-label={`${done} / ${total}`}>
      <div className="seeker-school-bar-fill" style={{ width: pct + "%" }} />
    </div>
  );
}

// Lesson prose arrives as plain text with blank-line paragraph breaks and single newlines that
// are meaningful (bulleted runs, worked examples). Split on the blanks, keep the singles with
// `white-space: pre-line` in CSS — the desktop lab renders it exactly this way.
//
// ⚠️ TRANSLATE THE WHOLE BLOCK FIRST, THEN SPLIT. The curated dictionary keys a section by its
// entire body (whitespace-collapsed) and its translation keeps the paragraph breaks — see
// tBlock() in ../i18n.js. Splitting the English first and rendering paragraphs left the body
// in English under a translated heading for every LP Lab and Deep Dive lesson (Codex, PR #390).
// A curated hit is marked `data-i18n-skip` so the page observer does not send the Spanish off
// for machine translation.
//
// LABELS AND LEAD-INS (owner, 2026-09-25, on "Price Impact vs Slippage": "make Price impact:
// Slippage: bold and colored — this whole page just looks like a novel"). The lessons are written
// with their structure in the text: a short line ending in a colon ("PRICE IMPACT:", "COMMON
// MISTAKES:", ~220 of them across the curriculum) heads what follows, and an all-caps lead-in
// ("TOO HIGH slippage tolerance: …", "PRO TIP: …") opens a line. Styling happens AFTER
// translation, on whatever text is being shown, so it works in every language without a
// dictionary change: a translated label still ends in a colon (":" or "："). The rules are in
// proseLine() below.
const LABEL_MAX = 48;
function isLabel(line, firstOfMany) {
  const s = line.trim();
  if (!s || s.length > LABEL_MAX || !/[:：]$/.test(s)) return false;
  const letters = s.replace(/[^A-Za-z]/g, "");
  const caps = s.replace(/[^A-Z]/g, "");
  // Mostly capitals ("PRICE IMPACT:", "FULL RANGE vs CONCENTRATED:"), or the opening line of a
  // multi-line paragraph — which also catches a translation with no capital letters at all.
  return (letters.length >= 3 && caps.length / letters.length >= 0.6) || firstOfMany;
}
const LEAD_RE = /^([A-Z][A-Z0-9'’&/-]+(?: [A-Z0-9'’&/().-]+)*(?: [^:：\n]{0,28})?)([:：])\s+(\S.*)$/;
export function proseLine(line, firstOfMany) {
  if (isLabel(line, firstOfMany)) return { kind: "label", text: line.trim() };
  const m = LEAD_RE.exec(line);
  if (m && m[1].replace(/[^A-Z]/g, "").length >= 2 && m[1].length <= 40) return { kind: "lead", lead: m[1] + m[2], rest: m[3] };
  return { kind: "text", text: line };
}

// A label reads as a heading, so its trailing colon goes (owner, 2026-09-25: "do we need the : after
// every line???"). A lead-in keeps its colon — there it still joins the words to the sentence.
const dropColon = (s) => s.replace(/\s*[:：]\s*$/, "");

function ProsePara({ text }) {
  const lines = text.split("\n");
  const many = lines.length > 1;
  // A label standing alone in its paragraph heads a GROUP of the labelled items that follow
  // ("BEST PASSIVE POSITIONS:" over "FULL RANGE on correlated pairs:", "STABLE PAIRS:", …). Styled
  // the same as its items it read as if something were missing under it (owner, 2026-09-25), so
  // it gets its own, underlined, treatment.
  if (!many && proseLine(lines[0], false).kind === "label") {
    return <p className="seeker-prose-group"><span className="seeker-prose-grouplabel">{dropColon(lines[0].trim())}</span></p>;
  }
  return (
    <p>
      {lines.map((ln, i) => {
        const r = proseLine(ln, many && i === 0);
        const br = i < lines.length - 1 ? "\n" : null;
        if (r.kind === "label") return <React.Fragment key={i}><span className="seeker-prose-label">{dropColon(r.text)}</span>{br}</React.Fragment>;
        if (r.kind === "lead") return <React.Fragment key={i}><strong className="seeker-prose-lead">{r.lead}</strong> {r.rest}{br}</React.Fragment>;
        return <React.Fragment key={i}>{r.text}{br}</React.Fragment>;
      })}
    </p>
  );
}

function Prose({ text, className }) {
  const { text: body, translated } = tBlock(text);
  const paras = String(body || "").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  if (!paras.length) return null;
  return (
    <div className={className} data-i18n-skip={translated ? "1" : undefined}>
      {paras.map((p, i) => <ProsePara key={i} text={p} />)}
    </div>
  );
}

// ── the front door ──────────────────────────────────────────────────────────────────────────
// `finished` and `progressNote` are the EDITION's words for the end of the school: the full app
// says the diploma is claimed on the website (true — docs/SEEKER_TRANSCRIPT_HANDOFF.md); the
// Google Play / iOS edition offers its certificate of completion instead. Defaults are the full
// app's, so a caller that passes nothing gets exactly what shipped.
//
// `safetyTools`: the education edition only (edu.jsx passes it — the full edition's own
// `<SchoolHome />` call passes nothing, so its home is unchanged by this). Owner (Xcode review,
// 2026-09-24): Wallet Checkup and Listing Checkup lost their own bottom-nav tabs, so their front
// door becomes a card here instead of disappearing from the app.
export function SchoolHome({ finished, progressNote, safetyTools }) {
  // Re-render when the dictionary lands — a lesson opened directly can render before it does.
  useI18nReady();
  const done = completedIds();
  const doneCount = COURSES.reduce(
    (n, c) => n + c.lessons.filter((l) => done.indexOf(l.key) !== -1).length, 0
  );
  const next = nextLesson();

  return (
    <div className="seeker-pane seeker-school">
      <img className="seeker-school-logo" src="/cluck-norris.png" alt="" decoding="async" />
      {/* data-clkn-avoid on BOTH the title and the lede: adding the hero logo above the title
          (2026-09-24) pushed this whole hero block down into the fixed 🌐 pill's strike zone at
          360x800 — the same class of collision the progress card below already carries a marker
          for. Marking only the lede is not enough: clkn-dock-float.js lifts the pill just far
          enough to clear the highest MARKED element it overlaps, and with only the lede marked it
          climbed clean past the unmarked title (they sit only 6px apart) and landed on that
          instead — found in a real render at 360x800, 2026-09-24. Two short, adjacent elements
          each carrying their own marker is fine; the thing the module's own comment warns against
          is marking one TALL multi-row container, not two one-line siblings. */}
      <h1 className="seeker-school-title" data-clkn-avoid="1">{t("School of Crypto Hard Knocks")}</h1>
      <p className="seeker-tool-lede" data-clkn-avoid="1">
        {t("Free, forever. No wallet, no signup, and it works with no signal — every lesson is already on your phone.")}
      </p>

      {/* data-clkn-avoid: this card sits high enough on a 360x800 phone that the fixed 🌐 pill
          landed directly on its note text ("Progress here stays on this phone…") on first paint
          — never a bottom-of-page thing the scroll container's padding could fix, since this
          card is nowhere near the end of the content. One short card, so its own top is what the
          pill measures against — -avoid, not -kids (found in real Seeker-edition screenshots,
          360x800 CSS @3x, 2026-09-24). */}
      <div className="seeker-school-overall" data-clkn-avoid="1">
        <div className="seeker-school-overall-row">
          <span>{t("Your progress")}</span>
          <span className="seeker-school-overall-n">{doneCount} / {TOTAL_LESSONS}</span>
        </div>
        <Bar done={doneCount} total={TOTAL_LESSONS} />
        {/* Said HERE, before anyone finishes, not only on the finished screen (Codex, PR #390):
            the phone's progress does not reach the diploma — docs/SEEKER_TRANSCRIPT_HANDOFF.md. */}
        <p className="seeker-school-overall-note">
          {t(progressNote || "Progress here stays on this phone. The diploma is claimed on clucknorris.app.")}
        </p>
      </div>

      {/* data-clkn-avoid on the continue card: -avoid, not -kids — it is one short card, so its
          own top is what the 🌐 pill measures against. */}
      {next ? (
        <Link className="seeker-school-continue" data-clkn-avoid="1" to={`/school/${next.course.id}/${next.lesson.id}`}>
          <span className="seeker-school-continue-label">
            {doneCount ? t("Pick up where you left off") : t("Start your first lesson")}
          </span>
          <span className="seeker-school-continue-title">{next.lesson.icon} {next.lesson.title}</span>
        </Link>
      ) : finished ? finished : (
        <div className="seeker-school-finished">
          {/* ⚠️ THIS USED TO SAY "Claim your transcript on the website." It was not true. The
              graduation ledger is keyed by an anonymous per-browser session id (lib/school-progress,
              `evaluate(sid, …)`), and a Capacitor webview is its own origin with its own id — so
              the website, opened in the phone's browser, sees none of the lessons finished here.
              Building the handoff means letting one device's id credit another's, which is a
              bearer token in front of a treasury-paid mint and the only anti-farm control there
              is. That is an owner decision, not a copy fix — docs/SEEKER_TRANSCRIPT_HANDOFF.md.
              Until it exists, the app says what is actually true. (Codex, PR #390.) */}
          {t("You've finished every lesson in the app. Your progress is kept on this phone — the diploma is claimed on clucknorris.app, and it counts the lessons you take there.")}
        </div>
      )}

      {/* -kids, not -avoid: each card's own top is what the pill measures against. */}
      <div className="seeker-school-courses" data-clkn-avoid-kids="1">
        {COURSES.map((c) => {
          const p = courseProgress(c.id);
          return (
            <Link key={c.id} className="seeker-school-course" to={`/school/${c.id}`}>
              <div className="seeker-school-course-top">
                <span className="seeker-school-course-icon" aria-hidden="true">{c.icon}</span>
                <div className="seeker-school-course-text">
                  <span className="seeker-school-course-title">{t(c.title)}</span>
                  <span className="seeker-school-course-sub">{t(c.sub)}</span>
                </div>
              </div>
              <div className="seeker-school-course-foot">
                <Bar done={p.done} total={p.total} />
                <span className="seeker-school-course-n">{p.done} / {p.total}</span>
              </div>
            </Link>
          );
        })}
      </div>

      {/* The Solana Room (AGENTS.md's flagship school section) — a free, no-wallet reference
          room, below the course list rather than mixed into it: it's read one page at a time,
          not a course with a completion count. Copy is the room's OWN already-translated intro
          (content.js) rather than new page-local strings, so this card ships correctly in all
          seven languages the day it lands, not on the next translation pass. */}
      <Link className="seeker-solana-schoolcard" to="/solana">
        <span className="seeker-solana-schoolcard-title">{t(SOLANA_ROOM_INDEX.title)}</span>
        <span className="seeker-solana-schoolcard-sub">{t(SOLANA_ROOM_INDEX.intro)}</span>
      </Link>

      {/* Safety tools — education edition only (edu.jsx passes safetyTools). Wallet Checkup and
          Listing Checkup have no tab of their own anymore (owner, Xcode review, 2026-09-24), so
          this is their front door instead. Titles/blurbs are the SAME strings the tools registry
          already carries (registry.js) — already curated, translated keys, so this ships correct
          in all seven languages on day one rather than waiting on a new translation pass. */}
      {safetyTools ? (
        <div className="seeker-school-safety">
          <span className="seeker-school-safety-heading">{t("Safety tools")}</span>
          <div className="seeker-school-safety-row" data-clkn-avoid-kids="1">
            <Link className="seeker-school-safety-card" to="/checkup">
              <span className="seeker-school-safety-card-icon" aria-hidden="true"><ShieldIcon /></span>
              <span className="seeker-school-safety-card-title">{t("Wallet Checkup")}</span>
              <span className="seeker-school-safety-card-sub">
                {t("Approvals, freeze and mint authority, and what each one actually lets someone do.")}
              </span>
            </Link>
            <Link className="seeker-school-safety-card" to="/tools/listing">
              <span className="seeker-school-safety-card-icon" aria-hidden="true">📋</span>
              <span className="seeker-school-safety-card-title">{t("Listing Checkup")}</span>
              <span className="seeker-school-safety-card-sub">
                {t("The checks listing venues commonly run on a token — run them on yours first.")}
              </span>
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ── one course: its lessons ─────────────────────────────────────────────────────────────────
export function SchoolCourse() {
  // Re-render when the dictionary lands — a lesson opened directly can render before it does.
  useI18nReady();
  const { courseId } = useParams();
  const course = courseById(courseId);
  const done = completedIds();

  // An unknown course id is a bad link, not an error state — send them to the school rather than
  // rendering an empty screen that looks broken.
  if (!course) {
    return (
      <div className="seeker-pane seeker-school">
        <h1 className="seeker-school-title">{t("School of Crypto Hard Knocks")}</h1>
        <p className="seeker-tool-lede">{t("That course doesn't exist.")}</p>
        <Link className="seeker-school-back" to="/school">{t("Back to the school")}</Link>
      </div>
    );
  }

  return (
    <div className="seeker-pane seeker-school">
      <Link className="seeker-school-back" to="/school">{t("Back to the school")}</Link>
      {/* Owner (2026-09-25, Xcode): "no logo at top of LP lab tab". The LP Lab tab IS this
          course page, so every course page carries the school home's hero logo. The title and
          lede carry data-clkn-avoid for the same reason the home's do (the fixed 🌐 pill). */}
      <img className="seeker-school-logo" src="/cluck-norris.png" alt="" decoding="async" />
      <h1 className="seeker-school-title" data-clkn-avoid="1">{course.icon} {t(course.title)}</h1>
      <p className="seeker-tool-lede" data-clkn-avoid="1">{t(course.sub)}</p>

      <ol className="seeker-school-lessons">
        {course.lessons.map((l, i) => {
          const finished = done.indexOf(l.key) !== -1;
          return (
            <li key={l.key}>
              <Link className={"seeker-school-lesson" + (finished ? " done" : "")} to={`/school/${course.id}/${l.id}`}>
                <span className="seeker-school-lesson-n">{finished ? "✓" : i + 1}</span>
                <span className="seeker-school-lesson-text">
                  <span className="seeker-school-lesson-title">{l.title}</span>
                  {l.belt ? <span className="seeker-school-lesson-belt">{l.belt}</span> : null}
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ── quiz auto-scroll ─────────────────────────────────────────────────────────────────────────
// Owner (2026-09-24, testing the iOS edition, then confirmed on the web app too): tapping an
// answer must bring the verdict, the explanation and the Next button into view on its own —
// "I shouldn't have to drag" — and Next must do the same for the next question's heading.
//
// ⚠️ WHICH ELEMENT SCROLLS IS MEASURED, NOT ASSUMED. The first cut (#434) always scrolled
// `.seeker-main`, on the belief that it was the scroll container. It is not, in practice:
// `.seeker-shell` is `min-height: 100dvh` (not `height`), so `.seeker-main` simply grows with its
// content and the DOCUMENT scrolls. `.seeker-main.scrollTo()` was a silent no-op, and in a rendered
// 360x800 build the Next button sat ~200px under the bottom nav after answering (found
// 2026-09-25 while building the lesson stepper; the website half of #434 scrolls `window` and was
// never affected). So: scroll `.seeker-main` only when it really overflows its own box, otherwise
// the window. `.seeker-header` is `position: sticky; top: 0` and the nav is `position: fixed`, so
// their on-screen edges are the right clearance lines either way.
// scripts/seeker-build-test.cjs now answers a real question at 360x800 and requires the Next
// button to land between the header and the nav — the check that would have caught this.
function quizScrollChrome() {
  const main = document.querySelector(".seeker-main");
  const header = document.querySelector(".seeker-header");
  const nav = document.querySelector(".seeker-nav");
  if (!header || !nav) return null;
  let scrollEl = window;
  try {
    if (main && main.scrollHeight > main.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(main).overflowY)) scrollEl = main;
  } catch (_) {}
  return { scrollEl, topClearY: header.getBoundingClientRect().bottom, bottomClearY: nav.getBoundingClientRect().top };
}

// ── a long lesson, one section per screen ───────────────────────────────────────────────────
// Owner (2026-09-24, LP Lab on the iOS edition): "scroll, scroll, scroll … a lot of stuff stacked."
// Then (2026-09-25): "send stepper on all levels" — every course reads this way now.
// Which lessons step, and how they are cut, is decided in src/shared/lessonSteps.js; this is only
// the screen. What it keeps from the single page: the same words, the same Prose/tBlock
// translation path, the same quiz. What it adds:
//
//   · A progress strip — one segment per step, each a real button, so a learner can see how much
//     is left and jump anywhere. The opening step's outline ("In this lesson") does the same with
//     the section headings, which is how a repeat visitor skips ahead.
//   · Back / Next at the foot of every step, and a horizontal swipe on the step body. The swipe
//     ignores touches that start near either screen edge (the OS back gesture lives there), on a
//     form control, or while text is selected.
//   · The step is REMEMBERED per lesson (clkn_lesson_step), so leaving mid-lesson and coming back
//     lands where you were. A pass clears it; "Read the lesson again" clears it.
//   · Changing step returns to the top of the page, like turning a page, and moves focus to the
//     new heading, so a screen reader announces the new section instead of a button that moved.
//
// Rendered with key={lesson.key} by the caller: a lesson opened from another lesson remounts this
// component, so one lesson's position can never be written under the next lesson's key.
function LessonStepper({ course, lesson, steps, need, onStartQuiz, onMarkRead }) {
  const total = steps.length;
  const [i, setI] = React.useState(() => loadStep(lesson.key, total));
  const topRef = React.useRef(null);
  const headRef = React.useRef(null);
  const moved = React.useRef(false);
  const touch = React.useRef(null);

  React.useEffect(() => { saveStep(lesson.key, i); }, [lesson.key, i]);

  React.useEffect(() => {
    if (!moved.current) return;
    let raf1 = requestAnimationFrame(() => {
      raf1 = requestAnimationFrame(() => {
        // A new step is a new page: back to the top, so the back link, the strip and the new
        // heading are all in view. quizScrollChrome() says which element really scrolls.
        const chrome = quizScrollChrome();
        if (chrome) {
          try { chrome.scrollEl.scrollTo({ top: 0, behavior: scrollBehavior() }); } catch (_) {}
        }
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
    if (Math.abs(dx) < 56 || Math.abs(dy) > Math.abs(dx) * 0.6) return;  // a scroll, not a swipe
    try { if (String(window.getSelection && window.getSelection()).trim()) return; } catch (_) {}
    go(dx < 0 ? i + 1 : i - 1);
  }

  const step = steps[i];
  const last = i === total - 1;
  const questions = lesson.questions;
  // Everything after the opening, labelled the way its own step is headed.
  const outlineSteps = steps.map((s, n) => ({ s, n })).filter(({ s }) => s.kind !== "open");
  const outlineLabel = (s) =>
    s.kind === "verdict" ? t("Cluck's verdict")
      : s.kind === "terms" ? t("The terms that matter")
      : s.kind === "content" ? t("The lesson")
      : s.heading;

  let body = null;
  if (step.kind === "open") {
    body = (
      <>
        <h1 className="seeker-school-title" ref={headRef} tabIndex={-1}>{lesson.icon} {lesson.title}</h1>
        {lesson.belt ? <div className="seeker-school-belt">{lesson.belt}</div> : null}
        {lesson.tagline && lesson.tagline !== lesson.intro ? (
          <div className="seeker-school-tagline">{lesson.tagline}</div>
        ) : null}
        {lesson.intro ? <p className="seeker-school-intro">{lesson.intro}</p> : null}
        <div className="seeker-step-outline">
          <div className="seeker-step-outline-title">{t("In this lesson")}</div>
          <ol>
            {outlineSteps.map(({ s, n }) => (
              <li key={n}>
                <button type="button" className="seeker-step-outline-item" onClick={() => go(n)}>
                  <span className="seeker-step-outline-n">{n}</span>
                  <span className="seeker-step-outline-text">{outlineLabel(s)}</span>
                </button>
              </li>
            ))}
          </ol>
        </div>
        {isDone(lesson.key) && questions.length ? (
          <button type="button" className="seeker-step-skip" onClick={onStartQuiz}>{t("Skip to the quiz")}</button>
        ) : null}
      </>
    );
  } else if (step.kind === "terms") {
    body = (
      <div className="seeker-school-concepts">
        <div className="seeker-school-concepts-title" ref={headRef} tabIndex={-1}>{t("The terms that matter")}</div>
        {lesson.concepts.map((c, k) => (
          <div className="seeker-school-concept" key={k}>
            <span className="seeker-school-concept-term">{c.term}</span>
            <span className="seeker-school-concept-def">{c.def}</span>
          </div>
        ))}
      </div>
    );
  } else if (step.kind === "section") {
    const s = lesson.sections[step.index] || {};
    body = (
      <section className="seeker-school-section seeker-step-section">
        <div className="seeker-step-kicker">{lesson.icon} {lesson.title}</div>
        {s.heading ? <h2 className="seeker-school-section-h" ref={headRef} tabIndex={-1}>{s.heading}</h2> : null}
        <Prose text={s.body} className="seeker-school-section-body" />
      </section>
    );
  } else if (step.kind === "content") {
    // The liquidity library's prose — one step, never cut (see src/shared/lessonSteps.js: the
    // curated dictionary keys the WHOLE block, so Prose/tBlock must see all of it at once).
    // Deliberately NOT .seeker-school-section: that class marks an authored section, and the
    // boot test counts those headings against the curriculum's own.
    body = (
      <section className="seeker-step-section">
        <div className="seeker-step-kicker">{lesson.icon} {lesson.title}</div>
        <h2 className="seeker-school-section-h" ref={headRef} tabIndex={-1}>{t("The lesson")}</h2>
        <Prose text={lesson.content} className="seeker-school-content" />
      </section>
    );
  } else if (step.kind === "verdict") {
    body = (
      <>
        <div className="seeker-step-kicker">{lesson.icon} {lesson.title}</div>
        <h2 className="seeker-school-section-h" ref={headRef} tabIndex={-1}>{t("Cluck's verdict")}</h2>
        <blockquote className="seeker-school-verdict seeker-step-verdict">{lesson.verdict}</blockquote>
      </>
    );
  }

  return (
    <div className="seeker-pane seeker-school seeker-school-read">
      <Link className="seeker-school-back" to={`/school/${course.id}`}>{t("Back to")} {t(course.title)}</Link>

      <div className="seeker-step" ref={topRef}>
        <div className="seeker-step-strip">
          {steps.map((s, n) => (
            <button
              key={n}
              type="button"
              className={"seeker-step-seg" + (n === i ? " current" : n < i ? " seen" : "")}
              aria-current={n === i ? "step" : undefined}
              aria-label={tf("Step {n} of {total}", { n: n + 1, total })}
              onClick={() => go(n)}
            >
              <span className="seeker-step-seg-bar" />
            </button>
          ))}
        </div>
        <div className="seeker-step-count">{tf("Step {n} of {total}", { n: i + 1, total })}</div>

        <div className="seeker-step-body" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
          {body}
        </div>

        {last ? (
          questions.length ? (
            <p className="seeker-school-quiznote">
              {tf("{total} questions. {need} right to pass — retake it as often as you like.", { total: questions.length, need })}
            </p>
          ) : null
        ) : null}

        {/* data-clkn-avoid: the 🌐 pill rests bottom-right, which is exactly where Next lands on
            a short step. One short row, so -avoid, not -kids. */}
        <div className="seeker-step-controls" data-clkn-avoid="1">
          {i > 0 ? (
            <button type="button" className="seeker-btn seeker-btn-quiet seeker-step-back" onClick={() => go(i - 1)}>
              {t("Back")}
            </button>
          ) : null}
          {!last ? (
            <button type="button" className="seeker-btn seeker-step-next" onClick={() => go(i + 1)}>
              {i === 0 ? t("Start the lesson") : t("Next")}
            </button>
          ) : questions.length ? (
            <button type="button" className="seeker-btn seeker-step-next seeker-school-start" onClick={onStartQuiz}>
              {isDone(lesson.key) ? t("Take the quiz again") : t("Take the quiz")}
            </button>
          ) : (
            <button type="button" className="seeker-btn seeker-step-next seeker-school-start" onClick={onMarkRead}>
              {t("Mark as read")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── one lesson: read, then quiz ─────────────────────────────────────────────────────────────
export function SchoolLesson() {
  // Re-render when the dictionary lands — a lesson opened directly can render before it does.
  useI18nReady();
  const { courseId, lessonId } = useParams();
  const navigate = useNavigate();
  const course = courseById(courseId);
  const lesson = lessonById(courseId, lessonId);

  const [phase, setPhase] = React.useState("read");   // read | quiz | passed | failed
  const [qi, setQi] = React.useState(0);
  const [picked, setPicked] = React.useState(null);
  const [score, setScore] = React.useState(0);

  // Refs the auto-scroll effects below target — see "quiz auto-scroll" above the component.
  const quizHeadRef = React.useRef(null);
  const explainRef = React.useRef(null);
  const nextBtnRef = React.useRef(null);
  const resultRef = React.useRef(null);

  // Answer tapped: bring the verdict, explanation and Next button into view without a drag.
  React.useEffect(() => {
    if (phase !== "quiz" || picked === null) return;
    let raf1 = requestAnimationFrame(() => {
      raf1 = requestAnimationFrame(() => {
        const chrome = quizScrollChrome();
        if (!chrome || !explainRef.current || !nextBtnRef.current) return;
        revealQuizResult({ ...chrome, resultEl: explainRef.current, actionEl: nextBtnRef.current });
      });
    });
    return () => cancelAnimationFrame(raf1);
  }, [phase, picked]);

  // A fresh question (quiz start, or Next tapped) — its heading goes just under the header.
  React.useEffect(() => {
    if (phase !== "quiz" || picked !== null) return;
    let raf1 = requestAnimationFrame(() => {
      raf1 = requestAnimationFrame(() => {
        const chrome = quizScrollChrome();
        if (!chrome || !quizHeadRef.current) return;
        revealUnderClear({ scrollEl: chrome.scrollEl, el: quizHeadRef.current, topClearY: chrome.topClearY });
      });
    });
    return () => cancelAnimationFrame(raf1);
  }, [phase, qi]);

  // Finished — pass or fail — bring the result summary into view.
  React.useEffect(() => {
    if (phase !== "passed" && phase !== "failed") return;
    let raf1 = requestAnimationFrame(() => {
      raf1 = requestAnimationFrame(() => {
        const chrome = quizScrollChrome();
        if (!chrome || !resultRef.current) return;
        revealUnderClear({ scrollEl: chrome.scrollEl, el: resultRef.current, topClearY: chrome.topClearY });
      });
    });
    return () => cancelAnimationFrame(raf1);
  }, [phase]);

  // Reading time is what the funnel measures; fire once per lesson opened.
  React.useEffect(() => {
    if (lesson) track("lesson_start:" + beaconId(lesson.id));
  }, [lessonId]);

  // A lesson opened from a deep link while another is on screen must not inherit its quiz state.
  React.useEffect(() => {
    setPhase("read"); setQi(0); setPicked(null); setScore(0);
  }, [courseId, lessonId]);

  if (!course || !lesson) {
    return (
      <div className="seeker-pane seeker-school">
        <h1 className="seeker-school-title">{t("School of Crypto Hard Knocks")}</h1>
        <p className="seeker-tool-lede">{t("That lesson doesn't exist.")}</p>
        <Link className="seeker-school-back" to="/school">{t("Back to the school")}</Link>
      </div>
    );
  }

  const questions = lesson.questions;
  const q = questions[qi] || null;
  // The website's rule, not a new one: `score >= Math.ceil(n * 2/3)` (src/App.jsx ~1425).
  const need = passMark(questions.length);

  function startQuiz() {
    setPhase("quiz"); setQi(0); setPicked(null); setScore(0);
  }

  function complete() {
    // The mark is recorded locally AND queued to the ledger. A beacon that fails does not change
    // what the learner sees — they passed, and src/track.js re-sends it.
    markDone(lesson.key);
    // A pass means the next visit opens at the top of the lesson, not on its last step.
    clearStep(lesson.key);
    track("lesson_complete:" + beaconId(lesson.id));
    setPhase("passed");
  }

  function choose(idx) {
    if (picked !== null) return;           // one answer per question; no re-picking after feedback
    setPicked(idx);
    if (q && idx === q.correct) setScore((n) => n + 1);
  }

  function advance() {
    if (qi + 1 < questions.length) {
      setQi(qi + 1);
      setPicked(null);
      return;
    }
    // ⚠️ THE LAST QUESTION IS NOT THE PASS. This used to mark the lesson done unconditionally, so
    // answering every question wrong still completed it and still wrote a ledger mark (Codex, PR
    // #390). A school whose quiz cannot be failed is not teaching anything.
    if (score >= need) complete();
    else setPhase("failed");
  }

  if (phase === "passed" || phase === "failed") {
    const ok = phase === "passed";
    const p = courseProgress(course.id);
    return (
      <div className="seeker-pane seeker-school">
        <div className={"seeker-school-passed" + (ok ? "" : " missed")} ref={resultRef}>
          <div className="seeker-school-passed-mark" aria-hidden="true">{ok ? "✓" : "↻"}</div>
          <h1 className="seeker-school-title">{ok ? t("Lesson passed") : t("Not this time")}</h1>
          <p className="seeker-tool-lede">{lesson.title}</p>

          {questions.length ? (
            <p className="seeker-school-passed-note">
              {tf("You got {score} of {total}. You need {need} to pass.", { score, total: questions.length, need })}
            </p>
          ) : null}

          {ok ? (
            <>
              {score < questions.length ? (
                <p className="seeker-school-passed-note">
                  {t("You missed some on the way — the explanations are worth a second read.")}
                </p>
              ) : null}
              <div className="seeker-school-overall">
                <div className="seeker-school-overall-row">
                  <span>{t(course.title)}</span>
                  <span className="seeker-school-overall-n">{p.done} / {p.total}</span>
                </div>
                <Bar done={p.done} total={p.total} />
              </div>
              <button type="button" className="seeker-btn" onClick={() => navigate(`/school/${course.id}`)}>
                {t("Next lesson")}
              </button>
            </>
          ) : (
            <>
              <p className="seeker-school-passed-note">
                {t("Nothing is lost — read it again and retake it. There is no limit and no penalty.")}
              </p>
              <button type="button" className="seeker-btn" onClick={startQuiz}>
                {t("Retake the quiz")}
              </button>
              <button
                type="button"
                className="seeker-btn seeker-btn-quiet"
                onClick={() => { clearStep(lesson.key); setPhase("read"); setQi(0); setPicked(null); setScore(0); }}
              >
                {t("Read the lesson again")}
              </button>
            </>
          )}
          <Link className="seeker-school-back" to="/school">{t("Back to the school")}</Link>
        </div>
      </div>
    );
  }

  if (phase === "quiz" && q) {
    const answered = picked !== null;
    const right = answered && picked === q.correct;
    return (
      <div className="seeker-pane seeker-school">
        <div className="seeker-school-quizhead" ref={quizHeadRef}>
          <span>{t("Question")} {qi + 1} / {questions.length}</span>
          <span className="seeker-school-quizhead-lesson">{lesson.title}</span>
        </div>

        <p className="seeker-school-q">{q.q}</p>

        <div className="seeker-school-options">
          {(q.options || []).map((opt, i) => {
            let cls = "seeker-school-option";
            if (answered && i === q.correct) cls += " correct";
            else if (answered && i === picked) cls += " wrong";
            return (
              <button key={i} type="button" className={cls} onClick={() => choose(i)} disabled={answered}>
                {opt}
              </button>
            );
          })}
        </div>

        {answered ? (
          <div className={"seeker-school-explain" + (right ? " right" : "")} ref={explainRef}>
            <div className="seeker-school-explain-verdict">{right ? t("Correct.") : t("Not quite.")}</div>
            {q.explanation ? <p>{q.explanation}</p> : null}
            <button type="button" className="seeker-btn" onClick={advance} ref={nextBtnRef}>
              {qi + 1 < questions.length ? t("Next question") : t("Finish the lesson")}
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  // read — every lesson reads as steps (src/shared/lessonSteps.js). The single page below is kept
  // only for a lesson with nothing beyond its opening, which no lesson in the curriculum is today.
  const plan = buildLessonSteps(lesson);
  if (plan.stepped) {
    return (
      <LessonStepper
        key={lesson.key}
        course={course}
        lesson={lesson}
        steps={plan.steps}
        need={need}
        onStartQuiz={startQuiz}
        onMarkRead={complete}
      />
    );
  }

  return (
    <div className="seeker-pane seeker-school seeker-school-read">
      <Link className="seeker-school-back" to={`/school/${course.id}`}>{t("Back to")} {t(course.title)}</Link>
      <h1 className="seeker-school-title">{lesson.icon} {lesson.title}</h1>
      {lesson.belt ? <div className="seeker-school-belt">{lesson.belt}</div> : null}
      {lesson.tagline && lesson.tagline !== lesson.intro ? (
        <div className="seeker-school-tagline">{lesson.tagline}</div>
      ) : null}

      {lesson.intro ? <p className="seeker-school-intro">{lesson.intro}</p> : null}

      {lesson.concepts.length ? (
        <div className="seeker-school-concepts">
          <div className="seeker-school-concepts-title">{t("The terms that matter")}</div>
          {lesson.concepts.map((c, i) => (
            <div className="seeker-school-concept" key={i}>
              <span className="seeker-school-concept-term">{c.term}</span>
              <span className="seeker-school-concept-def">{c.def}</span>
            </div>
          ))}
        </div>
      ) : null}

      {/* ⚠️ THE ACTUAL TEACHING MATERIAL. LP Lab and Deep Dive keep their lesson bodies in
          `sections`, and the basics course and the liquidity library keep theirs in `content`.
          Dropping both left 35 of the 58 lessons as a title and a one-line tagline, which is what
          the first build shipped (Codex, PR #390). Rendered open rather than in accordions: on a
          phone, a collapsed section is a lesson nobody reads. */}
      {lesson.sections.length ? (
        <div className="seeker-school-sections">
          {lesson.sections.map((s, i) => (
            <section className="seeker-school-section" key={i}>
              {s.heading ? <h2 className="seeker-school-section-h">{s.heading}</h2> : null}
              <Prose text={s.body} className="seeker-school-section-body" />
            </section>
          ))}
        </div>
      ) : null}

      {lesson.content ? <Prose text={lesson.content} className="seeker-school-content" /> : null}

      {lesson.verdict ? (
        <blockquote className="seeker-school-verdict">{lesson.verdict}</blockquote>
      ) : null}

      {questions.length ? (
        <>
          <p className="seeker-school-quiznote">
            {tf("{total} questions. {need} right to pass — retake it as often as you like.", { total: questions.length, need })}
          </p>
          <button type="button" className="seeker-btn seeker-school-start" onClick={startQuiz}>
            {isDone(lesson.key) ? t("Take the quiz again") : t("Take the quiz")}
          </button>
        </>
      ) : (
        <button type="button" className="seeker-btn seeker-school-start" onClick={complete}>
          {t("Mark as read")}
        </button>
      )}
    </div>
  );
}
