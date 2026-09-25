#!/usr/bin/env node
"use strict";
// Every quiz in the phone app, answered end to end — the Seeker edition AND the Google Play / iOS
// education edition, which share one school (src/seeker/school/School.jsx).
//
// Owner (2026-09-25): "Any quiz check it." The website has scripts/quiz-walk-test.cjs; this is the
// app's. For every lesson that has a quiz, the way a learner reaches it — open the lesson, go to
// the stepper's last step, press "Take the quiz" — then every question, requiring:
//
//   · at least two answer options render;
//   · after an answer, the Next button lands between the sticky header and the fixed bottom nav
//     (or, when the explanation is taller than that space, its verdict line is in view). This is
//     the check that caught #434's app half scrolling the wrong element (#438);
//   · the number answered equals the curriculum's own count for that lesson;
//   · the quiz ends on the result card (passed or not);
//   · nothing throws.
//
// Usage: node scripts/seeker-quiz-walk-test.cjs [seeker|google] [--limit=N]
//        (builds the edition's tarball with scripts/build-store-edition.mjs first)
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const variant = (process.argv.find((a) => a === "seeker" || a === "google")) || "seeker";
const limArg = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = limArg ? Math.max(1, Number(limArg.split("=")[1]) || 1) : Infinity;
const VIEW = { width: 360, height: 800 };
function log(s) { process.stdout.write(s + "\n"); }

(async () => {
  let chromium;
  try { ({ chromium } = require("playwright")); }
  catch (_) { try { ({ chromium } = require("playwright-core")); } catch (_2) { console.error("✗ needs playwright"); process.exit(1); } }

  const out = execFileSync(process.execPath, ["scripts/build-store-edition.mjs", variant], { cwd: ROOT, encoding: "utf8" });
  const manifest = JSON.parse(out.trim().split("\n").filter((l) => l.trim().startsWith("{")).pop());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quizwalk-"));
  execFileSync("tar", ["-xzf", path.join(ROOT, "release", manifest.file), "-C", dir, "--strip-components=1"]);
  const mime = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split("?")[0]); if (p === "/") p = "/index.html";
    const fp = path.join(dir, p);
    if (!fp.startsWith(dir) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "Content-Type": mime[path.extname(fp)] || "application/octet-stream" }); fs.createReadStream(fp).pipe(res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;

  // The edition's own curriculum (the Play / iOS bundle is built from curriculum.store.json).
  const cur = JSON.parse(fs.readFileSync(path.join(ROOT, "data", variant === "seeker" ? "curriculum.json" : "curriculum.store.json"), "utf8"));
  const courses = ["basics", "fundamentals", "lp", "deepdive"];

  const findChromium = () => [process.env.PLAYWRIGHT_CHROMIUM_PATH, "/opt/pw-browsers/chromium"].filter(Boolean).find((p) => fs.existsSync(p));
  const browser = await chromium.launch({ executablePath: findChromium(), args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: VIEW, isMobile: true, hasTouch: true });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).split("\n")[0].slice(0, 160)));
  await page.route("**/api/**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  await page.goto(`${base}/`, { waitUntil: "networkidle" });
  await page.waitForSelector(".seeker-nav", { timeout: 20000 });

  const failures = [];
  let quizzes = 0, questions = 0;
  for (const cid of courses) {
    const c = cur.courses.find((x) => x.id === cid);
    if (!c) continue;
    const withQuiz = c.lessons.filter((l) => (l.questions || []).length).slice(0, LIMIT);
    if (!withQuiz.length) continue;
    log(`\n${variant} · ${cid} (${withQuiz.length} quizzes):`);
    for (const l of withQuiz) {
      const tag = `${cid}:${l.id}`;
      const before = errors.length;
      const problems = [];
      await page.evaluate(() => { window.location.hash = "#/school"; });
      await page.waitForTimeout(150);
      await page.evaluate((h) => { window.location.hash = h; }, `#/school/${cid}/${l.id}`);
      await page.waitForSelector(".seeker-step", { timeout: 10000 }).catch(() => problems.push("the lesson did not open in the stepper"));
      const segs = await page.locator(".seeker-step-seg").count();
      if (segs) { await page.locator(".seeker-step-seg").nth(segs - 1).click(); await page.waitForTimeout(250); }
      const startBtn = page.locator(".seeker-step-next");
      if (!(await startBtn.count()) || !/quiz/i.test(await startBtn.innerText())) problems.push("no 'Take the quiz' on the last step");
      else await startBtn.click();
      await page.waitForTimeout(500);

      let answered = 0;
      for (let guard = 0; guard < 20; guard++) {
        const opts = await page.locator(".seeker-school-option").count();
        if (!opts) break;
        if (opts < 2) { problems.push(`q${answered + 1}: ${opts} option(s)`); break; }
        await page.locator(".seeker-school-option").first().click();
        await page.waitForTimeout(900);
        const g = await page.evaluate(() => {
          const head = document.querySelector(".seeker-header").getBoundingClientRect().bottom;
          const nav = document.querySelector(".seeker-nav").getBoundingClientRect().top;
          const ex = document.querySelector(".seeker-school-explain");
          const nx = document.querySelector(".seeker-school-explain .seeker-btn");
          const er = ex && ex.getBoundingClientRect(), nr = nx && nx.getBoundingClientRect();
          return { head, nav, exTop: er && er.top, exH: er && er.height, nTop: nr && nr.top, nBottom: nr && nr.bottom };
        });
        answered++;
        if (g.nTop == null) { problems.push(`q${answered}: no explanation / Next after answering`); break; }
        const tall = g.exH > g.nav - g.head;
        const ok = tall ? (g.exTop >= g.head - 1 && g.exTop <= g.nav) : (g.nTop >= g.head - 1 && g.nBottom <= g.nav + 1 && g.exTop >= g.head - 1);
        if (!ok) problems.push(`q${answered}: result not in view (header=${g.head.toFixed(0)} explainTop=${g.exTop.toFixed(0)} next=${g.nTop.toFixed(0)}–${g.nBottom.toFixed(0)} nav=${g.nav.toFixed(0)}${tall ? " tall" : ""})`);
        await page.locator(".seeker-school-explain .seeker-btn").click();
        await page.waitForTimeout(350);
      }
      questions += answered;
      const expected = (l.questions || []).length;
      if (answered !== expected) problems.push(`answered ${answered}, the curriculum declares ${expected}`);
      if (!(await page.locator(".seeker-school-passed").count())) problems.push("did not end on the result card");
      if (errors.length > before) problems.push(`uncaught: ${[...new Set(errors.slice(before))].join(" | ")}`);
      quizzes++;
      if (problems.length) { failures.push(`${tag}: ${problems.join("; ")}`); log(`  ✗ ${tag} — ${problems.join("; ")}`); }
      else log(`  ✓ ${tag} — ${answered} questions, every result in view, ended on the result card`);
    }
  }
  await browser.close(); server.close();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  log(`\n${variant}: ${quizzes} quizzes, ${questions} questions answered at ${VIEW.width}x${VIEW.height}.`);
  if (failures.length) { log(`✗ ${failures.length} quiz(zes) failed`); process.exit(1); }
  log(`✓ every quiz in the ${variant} edition works end to end`);
})().catch((e) => { console.error(e); process.exit(1); });
