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
// string through t(), no verdicts, nothing hardcoded that belongs in config. Two notes specific
// to this surface:
//
//   - THERE IS NO "UNAVAILABLE" STATE FOR READING. The curriculum is in the bundle, so a lesson
//     can always be opened. Nothing here fetches to render. The only network call is the
//     completion beacon, and it is fire-and-forget with a durable queue behind it (src/track.js).
//   - A FAILED BEACON MUST NOT LOOK LIKE A FAILED LESSON. The learner passed; the mark is queued
//     and re-sent. Telling them the lesson did not count would be false, and the graduation gate
//     already re-sends the device's own marks before a claim.

import React from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { t } from "../i18n.js";
import { track } from "../../track.js";
import {
  COURSES, TOTAL_LESSONS, courseById, lessonById,
  completedIds, isDone, markDone, courseProgress, nextLesson,
} from "./curriculum.js";
import "./school.css";

// The id shape the server ledger expects — identical to the website's trackId(), so a lesson
// passed on the phone and the same lesson passed on the web land on the same ledger row.
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

// ── the front door ──────────────────────────────────────────────────────────────────────────
export function SchoolHome() {
  const done = completedIds();
  const doneCount = COURSES.reduce(
    (n, c) => n + c.lessons.filter((l) => done.indexOf(l.id) !== -1).length, 0
  );
  const next = nextLesson();

  return (
    <div className="seeker-pane seeker-school">
      <h1 className="seeker-school-title">{t("School of Crypto Hard Knocks")}</h1>
      <p className="seeker-tool-lede">
        {t("Free, forever. No wallet, no signup, and it works with no signal — every lesson is already on your phone.")}
      </p>

      <div className="seeker-school-overall">
        <div className="seeker-school-overall-row">
          <span>{t("Your progress")}</span>
          <span className="seeker-school-overall-n">{doneCount} / {TOTAL_LESSONS}</span>
        </div>
        <Bar done={doneCount} total={TOTAL_LESSONS} />
      </div>

      {next ? (
        <Link className="seeker-school-continue" to={`/school/${next.course.id}/${next.lesson.id}`}>
          <span className="seeker-school-continue-label">
            {doneCount ? t("Pick up where you left off") : t("Start your first lesson")}
          </span>
          <span className="seeker-school-continue-title">{next.lesson.icon} {next.lesson.title}</span>
        </Link>
      ) : (
        <div className="seeker-school-finished">
          {t("You've finished every lesson in the app. Claim your transcript on the website.")}
        </div>
      )}

      <div className="seeker-school-courses">
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
    </div>
  );
}

// ── one course: its lessons ─────────────────────────────────────────────────────────────────
export function SchoolCourse() {
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
          const finished = done.indexOf(l.id) !== -1;
          return (
            <li key={l.id}>
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
  const { courseId, lessonId } = useParams();
  const navigate = useNavigate();
  const course = courseById(courseId);
  const lesson = lessonById(courseId, lessonId);

  const [phase, setPhase] = React.useState("read");   // read | quiz | passed
  const [qi, setQi] = React.useState(0);
  const [picked, setPicked] = React.useState(null);
  const [wrong, setWrong] = React.useState(0);

  // Reading time is what the funnel measures; fire once per lesson opened.
  React.useEffect(() => {
    if (lesson) track("lesson_start:" + beaconId(lesson.id));
  }, [lessonId]);

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

  function choose(idx) {
    if (picked !== null) return;           // one answer per question; no re-picking after feedback
    setPicked(idx);
    if (q && idx !== q.correct) setWrong((n) => n + 1);
  }

  function advance() {
    if (qi + 1 < questions.length) {
      setQi(qi + 1);
      setPicked(null);
      return;
    }
    // Done. The mark is recorded locally AND queued to the ledger. A beacon that fails does not
    // change what the learner sees — they passed, and src/track.js re-sends it.
    markDone(lesson.id);
    track("lesson_complete:" + beaconId(lesson.id));
    setPhase("passed");
  }

  if (phase === "passed") {
    const p = courseProgress(course.id);
    return (
      <div className="seeker-pane seeker-school">
        <div className="seeker-school-passed">
          <div className="seeker-school-passed-mark" aria-hidden="true">✓</div>
          <h1 className="seeker-school-title">{t("Lesson passed")}</h1>
          <p className="seeker-tool-lede">{lesson.title}</p>
          {wrong > 0 ? (
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

      <p className="seeker-school-intro">{lesson.intro}</p>

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

      {questions.length ? (
        <button
          type="button"
          className="seeker-btn seeker-school-start"
          onClick={() => { setPhase("quiz"); setQi(0); setPicked(null); setWrong(0); }}
        >
          {isDone(lesson.id) ? t("Take the quiz again") : t("Take the quiz")}
        </button>
      ) : (
        <button
          type="button"
          className="seeker-btn seeker-school-start"
          onClick={() => { markDone(lesson.id); track("lesson_complete:" + beaconId(lesson.id)); setPhase("passed"); }}
        >
          {t("Mark as read")}
        </button>
      )}
    </div>
  );
}
