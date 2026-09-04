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
// `nav` is how you REACH lesson N, and the two curricula differ:
//   "tiles"  — a grid of lesson buttons; click the n-th one.
//   "linear" — the incubator has NO tiles. It resumes at the first lesson missing from
//              localStorage `incubator_progress`, so lesson N is reached by pre-seeding
//              lessons 1..N-1 as completed. Clicking blind here hits "← BACK" and navigates
//              away, which is exactly the false failure the first version of this test produced.
const CURRICULA = [
  { hash: "select", label: "curriculum", count: 12, nav: "tiles", storageKey: "clkn_completed", idsFrom: "LESSONS" },
  { hash: "incubator", label: "incubator", count: 7, nav: "linear", storageKey: "incubator_progress", idsFrom: "INCUBATOR_LESSONS" },
  { hash: "lplab", label: "LP lab", count: 14, nav: "tiles" },
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
      const text = await page.evaluate(() => (document.body ? document.body.innerText : ""));
      verdict(`${c.label} lesson ${i}`, text, errors);
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
