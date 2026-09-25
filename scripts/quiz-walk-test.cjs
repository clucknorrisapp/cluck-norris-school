#!/usr/bin/env node
"use strict";
// Every quiz on the website, answered end to end at phone size.
//
// Owner (2026-09-25, after the lesson stepper went onto every lesson): "Any quiz check it."
// The smoke test proves each lesson renders and that ONE quiz auto-scrolls. This walks EVERY quiz
// the way a learner reaches it now — open the lesson, go to the stepper's last step, press the
// quiz button — and answers every question, requiring for each one:
//
//   · the answer options render (at least two);
//   · after an answer, the explanation's top is not hidden under the sticky header / nav pill,
//     and the Next button is fully on screen — the owner's "I shouldn't have to drag" (#434);
//   · the number of questions answered equals what the curriculum declares for that lesson;
//   · the quiz ENDS where it should: the report card for a belt lesson, the score screen for
//     LP Lab, the next lesson (or the completion screen) for the Incubator;
//   · nothing throws.
//
// 16 belt lessons + 7 Incubator + 14 LP Lab = 37 quizzes, every question in each.
//
// Usage: node scripts/quiz-walk-test.cjs [--no-build] [--limit=N]
//        (builds dist/ unless told not to; --limit walks only the first N quizzes per course)
const fs = require("fs");
const path = require("path");
const http = require("http");
const { execSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const VIEW = { width: 390, height: 844 };

function log(s) { process.stdout.write(s + "\n"); }

function lessonIds(arrayName) {
  const src = fs.readFileSync(path.join(ROOT, "src", "App.jsx"), "utf8");
  const start = src.search(new RegExp(`^const ${arrayName} = \\[`, "m"));
  if (start < 0) throw new Error(`could not find ${arrayName} in src/App.jsx`);
  const after = src.slice(start + arrayName.length);
  const end = after.search(/\n(const|function) [A-Z]/);
  const body = end < 0 ? after : after.slice(0, end);
  return [...body.matchAll(/\bid:\s*"([^"]+)"/g)].map((m) => m[1]);
}

function serveDist() {
  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
    ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".woff2": "font/woff2" };
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url || "/").split("?")[0]);
    let file = path.join(DIST, url);
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, "index.html");
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
    res.end(fs.readFileSync(file));
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

function findChromium() {
  for (const c of [process.env.PLAYWRIGHT_CHROMIUM_PATH, "/opt/pw-browsers/chromium"].filter(Boolean)) if (fs.existsSync(c)) return c;
  return undefined;
}

(async () => {
  if (!process.argv.includes("--no-build") || !fs.existsSync(path.join(DIST, "index.html"))) {
    log("building…");
    execSync("npm run build", { cwd: ROOT, stdio: "inherit" });
  }
  let chromium;
  try { ({ chromium } = require("playwright")); }
  catch (_) { try { ({ chromium } = require("playwright-core")); } catch (_2) { console.error("✗ needs playwright"); process.exit(1); } }

  // The curriculum's own question counts are the yardstick (data/curriculum.json is generated
  // from the same lesson arrays the website renders).
  const cur = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "curriculum.json"), "utf8"));
  const qCount = (courseId, i) => {
    const c = cur.courses.find((x) => x.id === courseId);
    const l = c && c.lessons.filter((x) => !String(x.id).startsWith("lib-"))[i];
    return l ? (l.questions || []).length : -1;
  };

  const beltIds = lessonIds("LESSONS");
  const incIds = lessonIds("INCUBATOR_LESSONS");
  const CURRICULA = [
    { label: "belt", hash: "select", n: beltIds.length, course: "fundamentals", nav: "tiles", seedKey: "clkn_completed", seed: (i) => beltIds.slice(0, i), start: /TAKE THE EXAM/i, end: /CLASS PASSED|DETENTION/ },
    { label: "incubator", hash: "incubator", n: incIds.length, course: "basics", nav: "linear", seedKey: "incubator_progress", seed: (i) => ({ completed: incIds.slice(0, i) }), start: /QUICK CHECK/i, end: /LESSON \d+ OF \d+|INCUBATOR COMPLETE/ },
    { label: "LP Lab", hash: "lplab", n: 14, course: "lp", nav: "tiles", start: /TAKE THE QUIZ/i, end: /\d+\/\d+ CORRECT/ },
  ];

  const server = await serveDist();
  const BASE = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch(findChromium() ? { executablePath: findChromium(), args: ["--no-sandbox"] } : {});
  const failures = [];
  let quizzes = 0, questions = 0;

  const limArg = process.argv.find((a) => a.startsWith("--limit="));
  const LIMIT = limArg ? Math.max(1, Number(limArg.split("=")[1]) || 1) : Infinity;
  for (const c of CURRICULA) {
    const n = Math.min(c.n, LIMIT);
    log(`\n${c.label} (${n}${n < c.n ? " of " + c.n : ""} quizzes):`);
    for (let i = 0; i < n; i++) {
      const tag = `${c.label} ${i + 1}`;
      const page = await browser.newPage({ viewport: VIEW, isMobile: true, hasTouch: true });
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e).split("\n")[0].slice(0, 160)));
      await page.route("**://fonts.googleapis.com/**", (r) => r.abort());
      await page.route("**://fonts.gstatic.com/**", (r) => r.abort());
      await page.route("**/api/**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
      if (c.seedKey) {
        await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
        await page.evaluate((s) => localStorage.setItem(s.k, JSON.stringify(s.v)), { k: c.seedKey, v: c.seed(i) });
      }
      await page.goto(`${BASE}/#${c.hash}`, { waitUntil: "domcontentloaded" });
      if (c.seedKey) await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => document.querySelectorAll("button").length > 3, null, { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(600);

      const problems = [];
      if (c.nav === "tiles") {
        const clicked = await page.evaluate((n) => {
          const tiles = [...document.querySelectorAll("button")].filter((b) => /LESSON\s*\d+|\d+\.\s+\S/.test(b.textContent || ""));
          if (tiles.length < n) return false;
          tiles[n - 1].click();
          return true;
        }, i + 1);
        if (!clicked) problems.push("no lesson tile to open");
        await page.waitForTimeout(700);
      }

      // The quiz button lives on the lesson stepper's LAST step.
      const segs = await page.locator("[data-lesson-step-seg]").count();
      if (!segs) problems.push("the lesson did not open in the stepper");
      else { await page.locator("[data-lesson-step-seg]").nth(segs - 1).click(); await page.waitForTimeout(350); }
      const started = await page.evaluate((src) => {
        const re = new RegExp(src, "i");
        const b = [...document.querySelectorAll("button")].find((x) => re.test(x.textContent || ""));
        if (!b) return false;
        b.click();
        return true;
      }, c.start.source);
      if (!started) problems.push(`no quiz button (${c.start.source}) on the last step`);
      await page.waitForTimeout(700);

      let answered = 0;
      const expected = qCount(c.course, i);
      for (let guard = 0; started && guard < 20; guard++) {
        const opts = await page.locator("[data-quiz-option]").count();
        if (!opts) break;
        if (opts < 2) { problems.push(`question ${answered + 1} rendered ${opts} option(s)`); break; }
        await page.locator("[data-quiz-option]").first().click();
        await page.waitForTimeout(1000);                      // two rAFs + the smooth scroll
        const g = await page.evaluate(() => {
          let clear = 0;
          const bar = document.getElementById("cluck-nav-bar");
          if (bar) clear = Math.max(clear, bar.getBoundingClientRect().bottom);
          const head = document.querySelector("[data-cluck-top-clear]");
          if (head) clear = Math.max(clear, head.getBoundingClientRect().bottom);
          const ex = document.querySelector("[data-quiz-explain]");
          const nx = document.querySelector("[data-quiz-next]");
          const er = ex && ex.getBoundingClientRect(), nr = nx && nx.getBoundingClientRect();
          return { clear, vh: window.innerHeight, exTop: er && er.top, exH: er && er.height, nTop: nr && nr.top, nBottom: nr && nr.bottom, hasEx: !!ex, hasNext: !!nx };
        });
        answered++;
        if (!g.hasEx || !g.hasNext) { problems.push(`q${answered}: no explanation / Next rendered after answering`); break; }
        const available = g.vh - g.clear;
        const nextInView = g.nTop >= g.clear - 1 && g.nBottom <= g.vh + 1;
        // A block taller than the space available leads with the verdict (scrollReveal.js), so
        // there the requirement is the verdict's top in view, not the button.
        const tall = g.exH > available;
        const verdictInView = g.exTop >= g.clear - 1 && g.exTop <= g.vh;
        if (tall ? !verdictInView : !(nextInView && g.exTop >= g.clear - 1)) {
          problems.push(`q${answered}: result not brought into view (clear=${g.clear.toFixed(0)} explainTop=${g.exTop.toFixed(0)} next=${g.nTop.toFixed(0)}–${g.nBottom.toFixed(0)} vh=${g.vh}${tall ? " tall" : ""})`);
        }
        await page.locator("[data-quiz-next]").click();
        await page.waitForTimeout(500);
      }
      questions += answered;
      if (started && expected >= 0 && answered !== expected) problems.push(`answered ${answered} questions, the curriculum declares ${expected}`);
      const endText = await page.evaluate(() => document.body.innerText || "");
      if (started && !c.end.test(endText)) problems.push(`the quiz did not end on its result screen (${c.end.source})`);
      if (errors.length) problems.push(`uncaught: ${[...new Set(errors)].join(" | ")}`);
      quizzes++;
      if (problems.length) { failures.push(`${tag}: ${problems.join("; ")}`); log(`  ✗ ${tag} — ${problems.join("; ")}`); }
      else log(`  ✓ ${tag} — ${answered} questions, every result in view, ended on its result screen`);
      await page.close();
    }
  }

  await browser.close();
  server.close();
  log(`\n${quizzes} quizzes, ${questions} questions answered at ${VIEW.width}x${VIEW.height}.`);
  if (failures.length) { log(`✗ ${failures.length} quiz(zes) failed`); process.exit(1); }
  log("✓ every quiz on the website works end to end");
})().catch((e) => { console.error(e); process.exit(1); });
