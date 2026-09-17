#!/usr/bin/env node
"use strict";
// The graduation ledger's re-pass rule (Codex on #333, 2026-09-17). When a learner's lesson marks
// are replayed together — a flushed beacon queue, the claim-time re-send, a reset browser id — they
// all land in ONE five-minute window, and with first-sighting-only the "live marks across three
// windows" check could never be repaired: the copy said "revisit a lesson and pass its quiz again",
// and the ledger ignored the re-pass. Now a live re-pass keeps the first sighting (`t`) and records
// the latest re-pass (`r`), and both count toward the spread. Pure node, temp DATA_DIR, fake clock.
const fs = require("fs");
const os = require("os");
const path = require("path");

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "school-progress-test-"));
process.env.DATA_DIR = DIR;
process.on("exit", () => { try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (_) {} });

let now = Date.UTC(2026, 8, 17, 12, 0, 0);
const realNow = Date.now;
Date.now = () => now;
const MIN = 60000;

const sp = require("../lib/school-progress");
let failures = 0;
const ok = (n, c, d) => { if (c) console.log("  ✓ " + n); else { failures++; console.log("  ✗ " + n + (d ? "\n      " + d : "")); } };
const opts = { requiredLessons: 12, minAgeMs: 15 * MIN, minSpreadBuckets: 3 };
const lessons = Array.from({ length: 12 }, (_, i) => "lesson-" + i);

console.log("\nschool-progress — re-pass timestamps repair a replayed session\n");

// 1. Twelve marks replayed in one burst → too fresh, then burst.
const sid = "replayed-session-0001";
for (const id of lessons) sp.mark(sid, id);
let g = sp.evaluate(sid, "W1", opts);
ok("replayed at once: too-fresh first", g.code === "too-fresh", JSON.stringify(g));
now += 16 * MIN;
g = sp.evaluate(sid, "W1", opts);
ok("…then burst (all live marks in one window)", g.code === "burst", JSON.stringify(g));

// 2. Re-passing lessons a few minutes apart spreads the live record.
sp.mark(sid, "lesson-3");            // +16m → window 2
now += 6 * MIN;
sp.mark(sid, "lesson-7");            // +22m → window 3
g = sp.evaluate(sid, "W1", opts);
ok("two re-passes in later windows → ok", g.ok === true && g.code === "ok", JSON.stringify(g));
const st = sp.statusFor(sid);
ok("statusFor reports 12 lessons, 2 re-passed", st && st.lessons === 12 && st.repassed === 2, JSON.stringify(st));

// 3. The first sighting is never rewritten; the re-pass is separate.
const file = path.join(DIR, "school-progress.json");
sp.flush();
const raw = JSON.parse(fs.readFileSync(file, "utf8"))[sid].marks;
ok("lesson-3 keeps its first sighting t and carries r", raw["lesson-3"].t === Date.UTC(2026, 8, 17, 12, 0, 0) && raw["lesson-3"].r === Date.UTC(2026, 8, 17, 12, 16, 0), JSON.stringify(raw["lesson-3"]));
ok("an un-repassed lesson has no r", raw["lesson-0"].r === undefined);

// 4. A backfill replay of an existing mark never counts as a re-pass.
const sid2 = "backfill-then-replay-02";
now = Date.UTC(2026, 8, 17, 13, 0, 0);
for (const id of lessons) sp.mark(sid2, id, { backfill: true });
now += 20 * MIN;
for (const id of lessons) sp.mark(sid2, id, { backfill: true });   // a second bf replay
g = sp.evaluate(sid2, "W2", opts);
ok("backfilled marks replayed as backfill again → still burst (no live windows)", g.code === "burst", JSON.stringify(g));
// …but a LIVE re-pass of a backfilled lesson counts as live from that moment.
sp.mark(sid2, "lesson-1");
now += 6 * MIN; sp.mark(sid2, "lesson-2");
now += 6 * MIN; sp.mark(sid2, "lesson-5");
g = sp.evaluate(sid2, "W2", opts);
ok("three live re-passes of backfilled lessons, in three windows → ok", g.ok === true, JSON.stringify(g));

// 5. A script's shortcut is no easier than before: twelve marks plus twelve instant re-passes
//    still sit in one window.
const sid3 = "burst-twice-000000003";
now = Date.UTC(2026, 8, 17, 14, 0, 0);
for (const id of lessons) sp.mark(sid3, id);
for (const id of lessons) sp.mark(sid3, id);
now += 16 * MIN;
g = sp.evaluate(sid3, "W3", opts);
ok("instant re-passes add no windows → still burst", g.code === "burst", JSON.stringify(g));

Date.now = realNow;
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
