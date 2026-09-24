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
function Prose({ text, className }) {
  const { text: body, translated } = tBlock(text);
  const paras = String(body || "").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  if (!paras.length) return null;
  return (
    <div className={className} data-i18n-skip={translated ? "1" : undefined}>
      {paras.map((p, i) => <p key={i}>{p}</p>)}
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
      <h1 className="seeker-school-title">{course.icon} {t(course.title)}</h1>
      <p className="seeker-tool-lede">{t(course.sub)}</p>

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
        <div className={"seeker-school-passed" + (ok ? "" : " missed")}>
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
                onClick={() => { setPhase("read"); setQi(0); setPicked(null); setScore(0); }}
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
        <div className="seeker-school-quizhead">
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
          <div className={"seeker-school-explain" + (right ? " right" : "")}>
            <div className="seeker-school-explain-verdict">{right ? t("Correct.") : t("Not quite.")}</div>
            {q.explanation ? <p>{q.explanation}</p> : null}
            <button type="button" className="seeker-btn" onClick={advance}>
              {qi + 1 < questions.length ? t("Next question") : t("Finish the lesson")}
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  // read
  return (
    <div className="seeker-pane seeker-school">
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
