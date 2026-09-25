#!/usr/bin/env node
"use strict";
// Pins the lesson stepper's rules (src/shared/lessonSteps.js) against the REAL curriculum.
//
// Owner (2026-09-24): LP Lab lessons on a phone were "scroll, scroll, scroll". The stepper reads a
// long lesson one section per screen and leaves a short one on a single page. This test is what
// keeps those two populations from drifting as lessons are added:
//
//   1. every lesson in every course is stepped (owner, 2026-09-25: "send stepper on all levels");
//   2. each course has the shape it should: the Incubator and the belts read opening → terms, the
//      liquidity library reads opening → the lesson (prose never cut), sectioned lessons one
//      section per step;
//   3. a stepped lesson opens on the "open" step, has one step per section IN ORDER, never splits
//      a section, and ends on the verdict when it has one;
//   4. the step memory survives garbage, clamps out-of-range values, stays bounded, and a pass
//      clears it.
//
// Usage: node scripts/lesson-steps-test.cjs
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..");
let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (detail !== undefined ? "  — " + JSON.stringify(detail).slice(0, 300) : "")); }
}

// The module is ESM with no package "type"; load a byte-identical copy as .mjs so this runs on any
// Node without relying on syntax detection.
async function loadModule() {
  const src = fs.readFileSync(path.join(ROOT, "src", "shared", "lessonSteps.js"), "utf8");
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "lesson-steps-")), "lessonSteps.mjs");
  fs.writeFileSync(tmp, src);
  return import("file://" + tmp);
}

function memStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    _m: m,
  };
}

(async () => {
  const L = await loadModule();
  const cur = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "curriculum.json"), "utf8"));

  // The app's own mapping (src/seeker/school/curriculum.js): `verdict` is `cluckVerdict`.
  const asApp = (l) => ({
    sections: Array.isArray(l.sections) ? l.sections : [],
    concepts: Array.isArray(l.concepts) ? l.concepts : [],
    content: typeof l.content === "string" ? l.content : "",
    verdict: l.cluckVerdict || "",
  });
  const kinds = (plan) => plan.steps.map((x) => x.kind).join(",");

  // Owner, 2026-09-25: "send stepper on all levels" — every course reads as steps.
  console.log("every lesson steps (owner: \"send stepper on all levels\"):");
  const all = [];
  for (const c of cur.courses) for (const l of c.lessons) all.push({ course: c.id, id: l.id, l, plan: L.buildLessonSteps(asApp(l)) });
  const unstepped = all.filter((x) => !x.plan.stepped);
  ok(`all ${all.length} lessons are stepped`, unstepped.length === 0, unstepped.map((x) => x.course + ":" + x.id));

  const byCourse = (id) => all.filter((x) => x.course === id);
  const shape = (list, want) => list.filter((x) => kinds(x.plan) !== want).map((x) => x.course + ":" + x.id + "=" + kinds(x.plan));
  ok(`the Incubator (${byCourse("basics").length}) reads opening → terms`, byCourse("basics").length > 0 && shape(byCourse("basics"), "open,terms").length === 0, shape(byCourse("basics"), "open,terms"));
  ok(`the School of Hard Knocks belts (${byCourse("fundamentals").length}) read opening → terms`, byCourse("fundamentals").length > 0 && shape(byCourse("fundamentals"), "open,terms").length === 0, shape(byCourse("fundamentals"), "open,terms"));
  const lib = byCourse("lp").filter((x) => String(x.id).startsWith("lib-"));
  ok(`the liquidity library (${lib.length}) reads opening → the lesson, prose never cut into parts`, lib.length > 0 && shape(lib, "open,content").length === 0, shape(lib, "open,content"));

  const withSections = all.filter((x) => (x.l.sections || []).length);
  console.log("\nthe shape of a sectioned lesson (LP Lab 1–14, Deep Dive):");
  const shapeBad = [];
  for (const s of withSections) {
    const { steps } = s.plan;
    const secIdx = steps.filter((x) => x.kind === "section").map((x) => x.index);
    const usable = (s.l.sections || []).map((x, i) => ({ x, i })).filter(({ x }) => String(x.body || "").trim() || String(x.heading || "").trim()).map(({ i }) => i);
    const problems = [];
    if (steps[0].kind !== "open") problems.push("first step is not the opening");
    if (JSON.stringify(secIdx) !== JSON.stringify(usable)) problems.push("sections not one-per-step in order");
    if (s.l.cluckVerdict && steps[steps.length - 1].kind !== "verdict") problems.push("has a verdict but does not end on it");
    if (!s.l.cluckVerdict && steps.some((x) => x.kind === "verdict")) problems.push("verdict step without a verdict");
    if (steps.filter((x) => x.kind === "open").length !== 1) problems.push("more than one opening step");
    for (const x of steps) if (x.kind === "section" && x.heading !== String(s.l.sections[x.index].heading || "")) problems.push("heading mismatch at " + x.index);
    if (problems.length) shapeBad.push({ id: s.course + ":" + s.id, problems });
  }
  ok(`all ${withSections.length} sectioned lessons: open first, one step per section in order, verdict last when present`,
     withSections.length > 0 && shapeBad.length === 0, shapeBad.slice(0, 3));
  const lp8 = all.find((s) => s.course === "lp" && String(s.id) === "8");
  ok("LP Lab lesson 8 (the longest, 6 sections + verdict) is 8 steps",
     lp8 && lp8.plan.steps.length === 8, lp8 && kinds(lp8.plan));
  const lastIsEnd = all.filter((x) => { const k = x.plan.steps[x.plan.steps.length - 1].kind; return k === "open"; });
  ok("no lesson ends on its opening (the quiz / 'Mark as read' always follows real material)", lastIsEnd.length === 0, lastIsEnd.map((x) => x.id));

  console.log("\nedge cases:");
  ok("a lesson with nothing beyond its opening is not stepped", L.buildLessonSteps({ sections: [], concepts: [], content: "  " }).stepped === false);
  ok("one section is enough to step (opening + that section)",
     kinds(L.buildLessonSteps({ sections: [{ heading: "a", body: "b" }] })) === "open,section");
  ok("empty sections never become steps",
     kinds(L.buildLessonSteps({ sections: [{ heading: "a", body: "b" }, { heading: "", body: "  " }] })) === "open,section");
  ok("a null lesson does not throw and is not stepped", L.buildLessonSteps(null).stepped === false);
  const withTerms = L.buildLessonSteps({ sections: [{ heading: "a", body: "x" }, { heading: "b", body: "y" }], concepts: [{ term: "t", def: "d" }], verdict: "v" });
  ok("terms, when present, are the step right after the opening",
     JSON.stringify(withTerms.steps.map((x) => x.kind)) === JSON.stringify(["open", "terms", "section", "section", "verdict"]),
     withTerms.steps.map((x) => x.kind));
  ok("clampStep: garbage → 0", [undefined, null, "x", -1, 1.5, NaN].every((v) => L.clampStep(v, 5) === 0));
  ok("clampStep: past the end → last", L.clampStep(99, 5) === 4);
  ok("clampStep: zero steps → 0", L.clampStep(3, 0) === 0);

  console.log("\nremembering the step:");
  const st = memStorage();
  ok("nothing saved → 0", L.loadStep("lp:3", 7, st) === 0);
  L.saveStep("lp:3", 4, st);
  ok("saved 4 → loads 4", L.loadStep("lp:3", 7, st) === 4);
  ok("saved 4, lesson now only 3 steps long → clamps to 2", L.loadStep("lp:3", 3, st) === 2);
  L.saveStep("lp:3", 0, st);
  ok("saving step 0 stores nothing for that lesson", !(("lp:3") in JSON.parse(st.getItem(L.STEP_STORE_KEY))));
  L.saveStep("deepdive:taxes", 2, st);
  L.clearStep("deepdive:taxes", st);
  ok("clearStep forgets the lesson", L.loadStep("deepdive:taxes", 5, st) === 0);
  st.setItem(L.STEP_STORE_KEY, "{not json");
  ok("corrupt storage reads as 0 and does not throw", L.loadStep("lp:1", 7, st) === 0);
  L.saveStep("lp:1", 3, st);
  ok("and the next save repairs it", L.loadStep("lp:1", 7, st) === 3);
  st.setItem(L.STEP_STORE_KEY, "[1,2,3]");
  ok("an array in storage reads as empty", L.loadStep("lp:1", 7, st) === 0);
  for (let k = 0; k < 200; k++) L.saveStep("c:" + k, 1, st);
  const size = Object.keys(JSON.parse(st.getItem(L.STEP_STORE_KEY))).length;
  ok(`the store stays bounded (${size} ≤ 80 after 200 lessons)`, size <= 80, size);
  ok("and keeps the NEWEST lessons", L.loadStep("c:199", 5, st) === 1 && L.loadStep("c:0", 5, st) === 0);
  const throwing = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); } };
  let threw = false;
  try { L.saveStep("x", 2, throwing); L.clearStep("x", throwing); L.loadStep("x", 3, throwing); } catch (_) { threw = true; }
  ok("a storage that throws (private window, blocked site data) never throws out", !threw);

  console.log(fail ? `\n${fail} FAILED (${pass} passed)` : `\nall passed (${pass} passed)`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("FAILED:", (e && e.stack) || e); process.exit(1); });
