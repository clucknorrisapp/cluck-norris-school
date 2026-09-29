#!/usr/bin/env node
// Render smoke test for the React school.
//
// WHY THIS EXISTS: nothing in CI ever rendered the client app. `npm run build` compiles a free
// variable happily, so `<CalcErrorBoundary>` — referenced twelve times and never defined — built
// clean, passed CI (which only `node --check`s the BACKEND), auto-deployed via Railway, and left
// every LP Lab lesson blank in production for about a day. Bundle greps said the feature shipped;
// only a render would have said it threw.
//
// So this opens every screen and every lesson in a real browser and fails on:
//   - any uncaught page error (the CalcErrorBoundary class of bug)
//   - a screen that renders essentially nothing (a blank page from a swallowed failure)
//   - an error boundary visibly tripping (the calculator fell over but the page survived)
//
// It is a SMOKE test, not a test suite: it asserts the app is not on fire, nothing about whether
// the content is correct. Keep it that way — it has to stay fast enough to run on every push.
//
// Usage:  node scripts/smoke-test.js            (builds if dist/ is missing, then tests)
//         node scripts/smoke-test.js --no-build (assume dist/ is current)
// Requires a Chromium available to playwright-core. Locally that is /opt/pw-browsers/chromium;
// in CI the workflow installs one and exports PLAYWRIGHT_CHROMIUM_PATH.

const { execSync, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const http = require("http");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const PORT = Number(process.env.SMOKE_PORT || 4399);
const BASE = `http://127.0.0.1:${PORT}`;

// Screens reachable from the top nav / landing, by the hash the app reads on boot (see App.jsx).
const SCREENS = [
  { hash: "landing", label: "landing (school)" },
  { hash: "start", label: "start here" },
  { hash: "incubator", label: "incubator" },
  { hash: "library", label: "library" },
  { hash: "lplab", label: "LP lab" },
  { hash: "select", label: "lesson select" },
  { hash: "clkn", label: "CLKN widget" },
];

// Lesson counts per curriculum. Kept as explicit numbers so that DELETING a lesson fails this
// test loudly rather than silently shrinking coverage.
//
// ⚠️ That was only half a guard. An explicit count catches a lesson going away and says NOTHING
// about one being ADDED — so when the curriculum went 12 → 14 (custody lessons, 2026-09-04) this
// test rendered the first 12, printed "40 screens/lessons rendered", and passed while never
// opening either new lesson. Green on the wrong thing, which is the exact failure this file was
// written to prevent. assertCountsMatchSource() below now fails on BOTH directions.
//
// `nav` is how you REACH lesson N, and the two curricula differ:
//   "tiles"  — a grid of lesson buttons; click the n-th one.
//   "linear" — the incubator has NO tiles. It resumes at the first lesson missing from
//              localStorage `incubator_progress`, so lesson N is reached by pre-seeding
//              lessons 1..N-1 as completed. Clicking blind here hits "← BACK" and navigates
//              away, which is exactly the false failure the first version of this test produced.
const CURRICULA = [
  // minSteps: every lesson reads as steps (owner 2026-09-25). Belt and Incubator lessons are the
  // opening + the terms; an LP Lab lesson is the opening, 5–6 sections, "Try it yourself" and
  // the verdict — so at least 8.
  { hash: "select", label: "curriculum", count: 16, nav: "tiles", storageKey: "clkn_completed", idsFrom: "LESSONS", minSteps: 2 },
  { hash: "incubator", label: "incubator", count: 7, nav: "linear", storageKey: "incubator_progress", idsFrom: "INCUBATOR_LESSONS", minSteps: 2 },
  { hash: "lplab", label: "LP lab", count: 14, nav: "tiles", minSteps: 8 },
];

const MIN_TEXT = 400; // a real screen renders far more than this; a crashed one renders ~15 chars

function log(s) { process.stdout.write(s + "\n"); }

// Lesson ids are STRINGS ("lp", "wallet", …) and both curricula gate on them:
//   - the curriculum tiles are progressively LOCKED (`locked = i>0 && !completed.includes(prev.id)`),
//     and clicking a locked tile silently does nothing — which made an earlier version of this
//     test report twelve green checks while every one of them was really the unchanged select
//     screen. Seeding every id as completed unlocks the grid.
//   - the incubator resumes at the first id missing from its progress list.
// Read the ids out of the source rather than hardcoding them, so renaming a lesson can never
// silently reduce this test to clicking nothing.
function lessonIds(arrayName) {
  const src = fs.readFileSync(path.join(ROOT, "src", "App.jsx"), "utf8");
  const start = src.search(new RegExp(`^const ${arrayName} = \\[`, "m"));
  if (start < 0) throw new Error(`could not find ${arrayName} in src/App.jsx`);
  const after = src.slice(start + arrayName.length);
  const end = after.search(/\n(const|function) [A-Z]/);
  const body = end < 0 ? after : after.slice(0, end);
  const ids = [...body.matchAll(/\bid:\s*"([^"]+)"/g)].map((m) => m[1]);
  if (!ids.length) throw new Error(`no lesson ids parsed from ${arrayName}`);
  return ids;
}

// The count above must equal what is actually in the source. Deleting a lesson without updating
// the number fails because a tile is missing; ADDING one used to pass silently. Check it directly.
// (LP Lab has no idsFrom — its array lives in LPLab.jsx and is covered by scripts/check-counts.js.)
function assertCountsMatchSource() {
  const wrong = [];
  for (const c of CURRICULA) {
    if (!c.idsFrom) continue;
    const actual = lessonIds(c.idsFrom).length;
    if (actual !== c.count) {
      wrong.push(`${c.label}: this test renders ${c.count} lessons but ${c.idsFrom} has ${actual}`);
    }
  }
  if (wrong.length) {
    log("\n✗ smoke test coverage is out of date:\n  " + wrong.join("\n  ") +
        "\n\n  Update CURRICULA in scripts/smoke-test.js. A lesson this test never opens is a\n" +
        "  lesson nothing checks renders — which is what this whole file exists to catch.");
    process.exit(1);
  }
}

function findChromium() {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_PATH,
    "/opt/pw-browsers/chromium",
  ].filter(Boolean);
  for (const c of candidates) if (fs.existsSync(c)) return c;
  // Fall back to whatever playwright-core resolves (CI installs a browser into its own cache).
  return undefined;
}

function serveDist() {
  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
    ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
    ".jpg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".woff2": "font/woff2" };
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url || "/").split("?")[0]);
    let file = path.join(DIST, url);
    // SPA fallback: unknown paths serve index.html, same as the real server's catch-all.
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, "index.html");
    const body = fs.readFileSync(file);
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
    res.end(body);
  });
  return new Promise((resolve) => server.listen(PORT, "127.0.0.1", () => resolve(server)));
}

(async () => {
  // Cheapest check first, and before the build: a stale coverage list makes every result below
  // it meaningless, so fail immediately rather than after four minutes of rendering.
  assertCountsMatchSource();
  if (!process.argv.includes("--no-build") || !fs.existsSync(path.join(DIST, "index.html"))) {
    log("building…");
    execSync("npm run build", { cwd: ROOT, stdio: "inherit" });
  }
  if (!fs.existsSync(path.join(DIST, "index.html"))) {
    console.error("✗ dist/index.html missing after build — nothing to smoke test");
    process.exit(1);
  }

  // Playwright is deliberately NOT a package.json dependency: its postinstall pulls browser
  // binaries, and Railway installs devDependencies to run `vite build`, so adding it would put
  // ~hundreds of MB into every production deploy for a test that only CI runs. The workflow
  // installs it with --no-save instead. Accept either package name.
  let chromium;
  try { ({ chromium } = require("playwright")); }
  catch (e) {
    try { ({ chromium } = require("playwright-core")); }
    catch (e2) {
      console.error("✗ smoke test needs playwright — install it first:\n" +
        "    npm i --no-save playwright && npx playwright install --with-deps chromium");
      process.exit(1);
    }
  }
  const server = await serveDist();
  const exe = findChromium();
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});

  const failures = [];
  const seen = [];
  let checks = 0;

  // Every page gets the same instrumentation: block external fonts (CI has no egress to
  // fonts.googleapis.com, and waiting on it turns a 2s check into a 30s timeout), and record
  // any uncaught error.
  async function open(hash, seedProgress) {
    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e).split("\n")[0].slice(0, 160)));
    await page.route("**://fonts.googleapis.com/**", (r) => r.abort());
    await page.route("**://fonts.gstatic.com/**", (r) => r.abort());
    if (seedProgress) {
      // localStorage is per-origin, so it must be written from a page already on that
      // origin — hence the throwaway load before the real one.
      await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
      await page.evaluate((s) => {
        localStorage.setItem(s.key, JSON.stringify(s.value));
      }, seedProgress);
    }
    await page.goto(`${BASE}/#${hash}`, { waitUntil: "domcontentloaded" });
    // After seeding we were already sitting on `${BASE}/`, so adding a hash is a SAME-DOCUMENT
    // navigation — React never remounts and the app stays on the landing screen. The reload is
    // what actually boots it on the requested screen with the seeded storage in place.
    if (seedProgress) {
      await page.reload({ waitUntil: "domcontentloaded" });
    }
    await page.waitForFunction(() => document.querySelectorAll("button").length > 3, null, { timeout: 20000 })
      .catch(() => {});
    await page.waitForTimeout(700);
    return { page, errors };
  }

  function verdict(label, text, errors) {
    checks++;
    const problems = [];
    if (errors.length) problems.push(`uncaught error: ${[...new Set(errors)].join(" | ")}`);
    if (text.length < MIN_TEXT) problems.push(`rendered only ${text.length} chars (blank page?)`);
    if (/CALCULATOR UNAVAILABLE/.test(text)) problems.push("an error boundary tripped");
    if (problems.length) {
      failures.push(`${label} — ${problems.join("; ")}`);
      log(`  ✗ ${label} — ${problems.join("; ")}`);
    } else {
      log(`  ✓ ${label} (${text.length} chars)`);
    }
  }

  log("\nscreens:");
  for (const s of SCREENS) {
    const { page, errors } = await open(s.hash);
    const text = await page.evaluate(() => document.body.innerText);
    verdict(s.label, text, errors);
    await page.close();
  }

  log("\nlessons (every lesson in every curriculum — this is where the blank-page bug lived):");
  for (const c of CURRICULA) {
    for (let i = 1; i <= c.count; i++) {
      // Both curricula are reached by marking lessons 1..i-1 complete:
      //   tiles  — a tile is locked until its PREDECESSOR is done, so this unlocks exactly
      //            lesson i. Marking ALL of them done instead trips the graduation redirect
      //            (App.jsx: `next.length===LESSONS.length` → setScreen("complete")) and there
      //            is no grid left to click.
      //   linear — the flow resumes at the first lesson not in the list.
      // The two stores have different SHAPES: the curriculum persists a bare array, the
      // incubator an object. Mirror each one exactly or the app ignores the seed.
      let seed = null;
      if (c.storageKey) {
        const done = lessonIds(c.idsFrom).slice(0, i - 1);
        seed = { key: c.storageKey, value: c.nav === "linear" ? { completed: done } : done };
      }
      const { page, errors } = await open(c.hash, seed);

      let clicked = true;
      if (c.nav === "tiles") {
        // Click the i-th lesson tile. Match on the tile's own text rather than a nav offset —
        // an offset silently clicks the wrong control when a layout changes.
        clicked = await page.evaluate((n) => {
          // Curriculum tiles read "💧1. Liquidity Pools"; LP Lab tiles read "💧LESSON 1What Is…".
          // Both START WITH AN EMOJI, so anchoring these patterns to ^ or a word boundary
          // matches nothing — the tiles are found by the marker appearing anywhere in the label.
          const tiles = [...document.querySelectorAll("button")]
            .filter((b) => /LESSON\s*\d+|\d+\.\s+\S/.test(b.textContent || ""));
          if (tiles.length < n) return false;
          tiles[n - 1].click();
          return true;
        }, i);
      }
      // Linear: the seeded progress already put us on lesson i — nothing to click.

      if (!clicked) {
        checks++;
        failures.push(`${c.label} lesson ${i} — no lesson tile found to click`);
        log(`  ✗ ${c.label} lesson ${i} — no lesson tile found`);
        await page.close();
        continue;
      }
      await page.waitForTimeout(900);
      // ⚠️ THE LESSON STEPPER (owner 2026-09-25: "Yes all of website"): a lesson now shows one
      // step at a time, so the first screen is only its opening. Walk every step and judge the
      // union — otherwise a calculator on the "Try it yourself" step could crash its error
      // boundary and this loop, which exists to catch exactly that, would never see it.
      let text = await page.evaluate(() => (document.body ? document.body.innerText : ""));
      const stepCount = await page.locator("[data-lesson-step-seg]").count();
      for (let s = 1; s < stepCount; s++) {
        await page.locator("[data-lesson-step-seg]").nth(s).click();
        await page.waitForTimeout(120);
        text += "\n" + (await page.evaluate(() => (document.body ? document.body.innerText : "")));
      }
      if (c.minSteps) {
        checks++;
        if (stepCount < c.minSteps) {
          failures.push(`${c.label} lesson ${i} — expected the lesson stepper (≥${c.minSteps} steps), found ${stepCount}`);
          log(`  ✗ ${c.label} lesson ${i} — stepper missing (${stepCount} steps)`);
        }
      }
      verdict(`${c.label} lesson ${i}${stepCount ? ` (${stepCount} steps)` : ""}`, text, errors);
      // Signature must cover the WHOLE screen: every page starts with the same ~100 chars of
      // shared nav, so a prefix signature makes all lessons look identical and this guard
      // would fire on a perfectly healthy run.
      const norm = text.replace(/\s+/g, " ").trim();
      let h = 0;
      for (let k = 0; k < norm.length; k++) h = (Math.imul(31, h) + norm.charCodeAt(k)) | 0;
      seen.push({ curriculum: c.label, lesson: i, sig: String(h) });
      await page.close();
    }
    // Guard against the test fooling itself: if navigation silently failed we would render the
    // SAME lesson every iteration and still report N green checks. Distinct content per lesson
    // is what makes the pass meaningful.
    const sigs = seen.filter((s) => s.curriculum === c.label).map((s) => s.sig);
    const distinct = new Set(sigs).size;
    if (distinct < sigs.length) {
      failures.push(`${c.label} — only ${distinct} distinct lesson screens across ${sigs.length} lessons (navigation not actually moving)`);
      log(`  ✗ ${c.label} — navigation suspect: ${distinct} distinct screens for ${sigs.length} lessons`);
    }
  }

  // QUIZ AUTO-SCROLL. Owner (2026-09-24, testing the iOS edition, then the web app too):
  // tapping an answer had to be followed by a manual drag to see the verdict, the explanation
  // and the Next button — "I shouldn't have to drag." src/App.jsx's Lesson quiz screen and
  // src/shared/scrollReveal.js fix this; this is the render-level check that it actually works,
  // at a phone width (where the fixed chrome eats the most of the viewport) and a desktop width.
  log("\nquiz auto-scroll (owner ask 2026-09-24 — the result must come into view with no drag):");
  for (const vp of [{ width: 390, height: 844, label: "390x844" }, { width: 1280, height: 800, label: "1280x800" }]) {
    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e).split("\n")[0].slice(0, 160)));
    await page.route("**://fonts.googleapis.com/**", (r) => r.abort());
    await page.route("**://fonts.gstatic.com/**", (r) => r.abort());
    await page.goto(`${BASE}/#select`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.querySelectorAll("button").length > 3, null, { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(700);

    checks++;
    const openedLesson = await page.evaluate(() => {
      const tiles = [...document.querySelectorAll("button")].filter((b) => /LESSON\s*\d+|\d+\.\s+\S/.test(b.textContent || ""));
      if (!tiles.length) return false;
      tiles[0].click();
      return true;
    });
    if (!openedLesson) {
      failures.push(`quiz auto-scroll ${vp.label} — no lesson tile found to open`);
      log(`  ✗ quiz auto-scroll ${vp.label} — no lesson tile found`);
      await page.close();
      continue;
    }
    await page.waitForTimeout(500);

    // The exam button lives on the lesson stepper's LAST step.
    const segCount = await page.locator("[data-lesson-step-seg]").count();
    if (segCount) { await page.locator("[data-lesson-step-seg]").nth(segCount - 1).click(); await page.waitForTimeout(300); }
    checks++;
    const startedQuiz = await page.evaluate(() => {
      const btn = [...document.querySelectorAll("button")].find((b) => /TAKE THE EXAM/i.test(b.textContent || ""));
      if (!btn) return false;
      btn.click();
      return true;
    });
    if (!startedQuiz) {
      failures.push(`quiz auto-scroll ${vp.label} — no "TAKE THE EXAM" button found`);
      log(`  ✗ quiz auto-scroll ${vp.label} — no exam button found`);
      await page.close();
      continue;
    }
    await page.waitForTimeout(500);

    // Answer options are rendered "A<opt text>" .. "D<opt text>" (App.jsx's Lesson quiz screen
    // prefixes each with String.fromCharCode(65+i)) — pick the first one. Which answer is right
    // or wrong does not matter here, only that the reveal scrolls.
    checks++;
    const picked = await page.evaluate(() => {
      const opt = [...document.querySelectorAll("button")].find((b) => /^[A-D]\S/.test((b.textContent || "").trim()));
      if (!opt) return false;
      opt.click();
      return true;
    });
    if (!picked) {
      failures.push(`quiz auto-scroll ${vp.label} — no answer option found to click`);
      log(`  ✗ quiz auto-scroll ${vp.label} — no answer option found`);
      await page.close();
      continue;
    }
    // Two rAFs plus the smooth-scroll animation itself.
    await page.waitForTimeout(800);

    checks++;
    const result = await page.evaluate(() => {
      const btn = [...document.querySelectorAll("button")].find((b) => /NEXT QUESTION|SEE REPORT CARD/i.test(b.textContent || ""));
      if (!btn) return { ok: false, reason: "no Next/Finish button rendered" };
      const r = btn.getBoundingClientRect();
      return { ok: true, rect: { top: r.top, bottom: r.bottom }, vh: window.innerHeight };
    });
    if (errors.length) {
      failures.push(`quiz auto-scroll ${vp.label} — uncaught error: ${[...new Set(errors)].join(" | ")}`);
      log(`  ✗ quiz auto-scroll ${vp.label} — uncaught error`);
    } else if (!result.ok) {
      failures.push(`quiz auto-scroll ${vp.label} — ${result.reason}`);
      log(`  ✗ quiz auto-scroll ${vp.label} — ${result.reason}`);
    } else if (result.rect.top < 0 || result.rect.bottom > result.vh) {
      failures.push(`quiz auto-scroll ${vp.label} — the Next button is NOT fully inside the viewport after answering (top=${result.rect.top.toFixed(1)} bottom=${result.rect.bottom.toFixed(1)} vh=${result.vh})`);
      log(`  ✗ quiz auto-scroll ${vp.label} — Next button not in view (top=${result.rect.top.toFixed(1)} bottom=${result.rect.bottom.toFixed(1)} vh=${result.vh})`);
    } else {
      log(`  ✓ quiz auto-scroll ${vp.label} — the Next button auto-scrolled fully into view (top=${result.rect.top.toFixed(1)} bottom=${result.rect.bottom.toFixed(1)} vh=${result.vh})`);
    }
    await page.close();
  }

  // A GRADUATE WHO RELOADS. `setScreen("complete")` fires exactly once — on the click that
  // completes the twelfth lesson — and "complete" is not in SCREENS, so it has no hash route.
  // Before the claim button on the Landing existed, a learner who finished the course and then
  // refreshed (or came back the next day) could never reach the diploma again: the only other
  // exit was RESET, which wipes all 12 lessons. That is a silent loss of the thing the whole
  // school is for, and nothing else in this file can see it — every other check navigates by
  // hash, and this screen has none.
  log("\ngraduate re-entry:");
  {
    let ids = null;
    try { ids = lessonIds("LESSONS"); } catch (_) {}
    if (!ids || !ids.length) {
      failures.push("graduate re-entry — could not read LESSONS ids from src/App.jsx");
      log("  \u2717 graduate re-entry — could not read LESSONS ids");
      checks++;
    } else {
      const { page, errors } = await open("", { key: "clkn_completed", value: ids });
      const text = await page.evaluate(() => document.body.innerText);
      const hasClaim = await page.evaluate(() =>
        [...document.querySelectorAll("button")].some((b) => /CLAIM YOUR DIPLOMA/i.test(b.textContent || "")));
      checks++;
      if (errors.length) {
        failures.push(`graduate re-entry — uncaught error: ${[...new Set(errors)].join(" | ")}`);
        log(`  \u2717 graduate re-entry — uncaught error`);
      } else if (!/SCHOOL COMPLETE/i.test(text)) {
        failures.push("graduate re-entry — a learner with all 12 lessons done is not shown as complete");
        log("  \u2717 graduate re-entry — not shown as complete");
      } else if (!hasClaim) {
        failures.push("graduate re-entry — SCHOOL COMPLETE renders but there is NO route to the diploma; " +
          "a learner who refreshes after finishing can never claim (only RESET remains, which wipes progress)");
        log("  \u2717 graduate re-entry — no claim route after a reload");
      } else {
        log("  \u2713 graduate re-entry — the diploma is still claimable after a reload");
      }
      await page.close();
    }
  }

  await browser.close();
  server.close();

  log("");
  if (failures.length) {
    console.error(`✗ smoke test FAILED — ${failures.length} of ${checks} checks broken:`);
    for (const f of failures) console.error(`   • ${f}`);
    console.error("\nA blank screen or an uncaught error here means the live site is broken for " +
      "real users. This builds and deploys fine regardless — that is the whole point of this test.");
    process.exit(1);
  }
  log(`✓ smoke test passed — ${checks} screens/lessons rendered, no uncaught errors, no blank pages`);
})().catch((e) => {
  console.error("✗ smoke test harness error:", e && e.message ? e.message : e);
  process.exit(1);
});
