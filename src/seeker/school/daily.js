// The day's lesson and the day's question — picked from the BUNDLED curriculum, by date.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// WHY A DETERMINISTIC PICK RATHER THAN THE DAILY POST
// ─────────────────────────────────────────────────────────────────────────────────────────────
// The obvious move was to surface the same lesson the bot posts to Telegram and X each day at
// 13:00 UTC. It is the wrong one: that post is AI-GENERATED (`generateEduLesson` in server.js)
// from a topic rotation, not one of the curriculum's lessons. Surfacing it would mean an AI call
// per reader per day, no offline, nothing to deep-link into, and a "lesson" that does not move
// anyone's progress.
//
// So the day's lesson is chosen from the 58 lessons already in the bundle, by date:
//   - everyone sees the SAME lesson on the same day (a shared thing to talk about),
//   - it works with no connection, because nothing is fetched,
//   - it costs nothing, and
//   - tapping it opens the REAL lesson, so the daily habit moves the progress bar.
//
// ⚠️ UTC, deliberately. A local-midnight rollover would give two people in different timezones
// different "today"s, and anyone travelling a new lesson mid-flight. The daily post is already
// UTC-scheduled, so this matches it.
//
// ⚠️ The rotation is `dayNumber % total`, which means it REPEATS every 58 days and does not
// respect what the reader has finished. That is on purpose for now: a "next unfinished lesson"
// rotation is personal, so two people could never compare notes, and someone who finished the
// school would get nothing. Revisiting it is a product decision, not a bug to fix quietly.

import { COURSES } from "./curriculum.js";

// One flat list, in teaching order, so the rotation walks beginner → advanced over its cycle
// rather than jumping between courses at random.
const ALL = COURSES.flatMap((c) => c.lessons.map((l) => ({ course: c, lesson: l })));

/**
 * Whole days since the epoch, in UTC. Pure given a Date, so the test can pin specific days
 * rather than whatever today happens to be.
 */
export function dayNumber(now) {
  const d = now || new Date();
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86400000);
}

/** The lesson everyone gets today. Null only if the curriculum is somehow empty. */
export function lessonOfDay(now) {
  if (!ALL.length) return null;
  return ALL[dayNumber(now) % ALL.length];
}

/**
 * One question from today's lesson — the ten-second check that makes the habit cheap.
 *
 * Offset by the day number as well so that when the 58-day rotation comes back round, a lesson
 * with several questions does not serve the identical one. Returns null for a lesson with no
 * questions (the caller shows the lesson without a check rather than an empty quiz).
 */
export function questionOfDay(now) {
  const pick = lessonOfDay(now);
  if (!pick) return null;
  const qs = pick.lesson.questions || [];
  if (!qs.length) return null;
  const q = qs[dayNumber(now) % qs.length];
  if (!q || !Array.isArray(q.options) || !q.options.length) return null;
  return { course: pick.course, lesson: pick.lesson, q };
}

// ── the streak ──────────────────────────────────────────────────────────────────────────────
// Local only, and deliberately NOT a beacon: answering the daily check is not passing a lesson,
// and it must never reach the graduation ledger. The ledger's marks are earned by finishing a
// real lesson — inflating them with a one-question tap would undermine the one anti-farm control
// in front of a treasury-paid diploma.
const STREAK_KEY = "clkn_daily_streak";

function readStreak() {
  try {
    const v = JSON.parse(localStorage.getItem(STREAK_KEY) || "null");
    if (!v || typeof v !== "object") return { day: null, count: 0 };
    const day = Number.isInteger(v.day) ? v.day : null;
    const count = Number.isInteger(v.count) && v.count >= 0 ? v.count : 0;
    return { day, count };
  } catch (_) {
    return { day: null, count: 0 };
  }
}

/** Has today's check already been answered? */
export function answeredToday(now) {
  return readStreak().day === dayNumber(now);
}

export function streakCount(now) {
  const s = readStreak();
  if (s.day === null) return 0;
  const today = dayNumber(now);
  // A streak that missed a day is over. Showing yesterday's number today would be a lie about
  // something the reader can check against their own memory.
  if (s.day === today || s.day === today - 1) return s.count;
  return 0;
}

/**
 * Record today's answer. Consecutive days extend the streak; a gap restarts it at 1; answering
 * twice in one day changes nothing.
 */
export function recordAnswer(now) {
  const today = dayNumber(now);
  const s = readStreak();
  if (s.day === today) return s.count;
  const next = s.day === today - 1 ? s.count + 1 : 1;
  try {
    localStorage.setItem(STREAK_KEY, JSON.stringify({ day: today, count: next }));
  } catch (_) {}
  return next;
}
