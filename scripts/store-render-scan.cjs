"use strict";
// The education edition, READ OFF THE SCREEN (store-edition v1.1.0, Codex round 12 on #391).
//
// Codex's objection to round 11 was not the fixes, it was the proof: "a passing content scan means
// the bundle is clean" had already been wrong once — the scan passed while CLKN's pools and fees
// were on screen at #/school/lp/4. A scan reads files; a store reviewer reads the phone. So this
// boots the shipped google tarball in headless Chromium, opens EVERY lesson in EVERY language the
// bundle ships, takes every quiz so the explanations render too, and scans what is on the screen —
// document.body.innerText — for our ticker. Nothing is read from the JSON. The four examples Codex
// found are pinned by name on the rendered text of the lesson they lived in.
//
// It also proves its own reach: the lesson and question counts must equal the store curriculum's,
// and for each non-English language the rendered lesson text must actually differ from English —
// a walk that never switched language would pass a ticker scan for the wrong reason.
//
//   node scripts/store-render-scan.cjs            # all seven languages (CI)
//   node scripts/store-render-scan.cjs en es       # a subset, when iterating
const { execFileSync } = require("child_process");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");

let failures = 0;
const ok = (n, c, d) => { if (c) console.log("  ✓ " + n); else { failures++; console.log("  ✗ " + n + (d ? "\n      " + (typeof d === "string" ? d : JSON.stringify(d)) : "")); } };

const ROOT = path.join(__dirname, "..");
const PORT = 3897;
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "clkn-store-render-"));
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };
const ALL_LANGS = ["en", "es", "hi", "it", "pt", "vi", "zh"];
const LANGS = process.argv.slice(2).filter((l) => ALL_LANGS.includes(l));
const langs = LANGS.length ? LANGS : ALL_LANGS;

// What must never be on the screen of the education edition: our ticker as a word. The brand name
// ("Cluck Norris", the school's own name) is not a token and is allowed.
const TICKER = /\bCLKN\b/;
// Codex's four examples (curriculum.store.json at 9cabf86: 2488, 1166, 1278, 2281), by the text a
// reader saw, pinned to the lesson each lived in so a regression cannot hide in a different one.
const EXAMPLES = [
  { where: "lp/4", re: /CLKN's own|tier CLKN|CLKN.*(pool|fee)/i, name: "our pools and fees (the fee-tier bullet)" },
  { where: "lp/7", re: /HOW CLKN LAUNCHED|CLKN launched/i, name: "the CLKN launch story" },
  { where: "fundamentals/bags", re: /buying CLKN|CLKN reinvests/i, name: "the buyback claim" },
  { where: "fundamentals/memecoins", re: /What makes CLKN|CLKN is a memecoin/i, name: "the \"what makes CLKN different\" quiz" },
  { where: "fundamentals/lp", re: /[0-9,]+ CLKN\b|CLKN\/SOL|SOL\/CLKN/i, name: "the AMM trading examples" },
];
// And what the STORE variant says instead — proof the walk read the real lesson body, not a shell.
const STORE_TEXT = [
  { where: "lp/4", re: /A pool's own page shows which tier it runs on/, name: "the fee-tier bullet's store wording" },
  { where: "lp/7", re: /HOW A BAGS\.FM LAUNCH PLAYS OUT/, name: "the launch story's store wording" },
];

function findChromium() {
  for (const p of [process.env.PLAYWRIGHT_CHROMIUM_PATH, "/opt/pw-browsers/chromium"].filter(Boolean)) if (fs.existsSync(p)) return p;
  return undefined;
}

(async () => {
  let chromium;
  try { ({ chromium } = require("playwright")); }
  catch (_) { try { ({ chromium } = require("playwright-core")); } catch (_2) { console.error("needs playwright(-core)"); process.exit(1); } }

  const out = execFileSync(process.execPath, ["scripts/build-store-edition.mjs", "google"], { cwd: ROOT, encoding: "utf8" });
  const manifest = JSON.parse(out.trim().split("\n").filter((l) => l.trim().startsWith("{")).pop());
  const tgz = path.join(ROOT, "release", manifest.file);
  const app = path.join(TMP, "app");
  fs.mkdirSync(app, { recursive: true });
  execFileSync("tar", ["-xzf", tgz, "-C", app, "--strip-components=1"]);
  // Mutation proof (--mutate): put Codex's fee-tier sentence back into the SHIPPED chunk, in the
  // extracted copy only, and the walk must fail on the screen of #/school/lp/4 — otherwise this
  // scan would be no better than the one that passed while CLKN was on the phone.
  if (process.argv.includes("--mutate")) {
    const chunk = fs.readdirSync(path.join(app, "assets")).find((f) => /^seeker-.*\.js$/.test(f));
    const cp = path.join(app, "assets", chunk);
    const js = fs.readFileSync(cp, "utf8");
    const before = "A pool's own page shows which tier it runs on";
    if (!js.includes(before)) { console.error("mutation target not in the chunk"); process.exit(2); }
    fs.writeFileSync(cp, js.replace(before, "The 0.02% tier is the one CLKN's own pools run on"));
    console.log("  (mutated: the old CLKN fee-tier sentence is back in the shipped chunk — this run MUST fail)");
  }
  const shipped = fs.readdirSync(path.join(app, "i18n")).filter((f) => /^[a-z]{2}\.school\.json$/.test(f)).map((f) => f.slice(0, 2)).sort();
  ok(`the bundle ships school dictionaries for ${ALL_LANGS.length - 1} languages (${shipped.join(", ")})`, JSON.stringify(shipped) === JSON.stringify(ALL_LANGS.filter((l) => l !== "en")), shipped);

  // The curriculum's own shape is the yardstick for the walk, never its content.
  const cur = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "curriculum.store.json"), "utf8"));
  const lessons = [];
  for (const c of cur.courses) for (const l of c.lessons) lessons.push({ course: c.id, id: l.id, key: c.id + "/" + l.id, questions: (l.questions || []).length });
  const totalQ = lessons.reduce((n, l) => n + l.questions, 0);
  console.log(`\nEducation edition ${manifest.version || ""} — ${lessons.length} lessons, ${totalQ} questions, ${langs.length} language(s): ${langs.join(" ")}\n`);

  const srv = http.createServer((req, res) => {
    const rel = decodeURIComponent(String(req.url).split("?")[0]).replace(/^\/+/, "") || "index.html";
    const file = path.join(app, rel);
    if (!file.startsWith(app) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end("nope"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => srv.listen(PORT, "127.0.0.1", r));
  process.on("exit", () => { try { srv.close(); } catch (_) {} try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {} try { fs.rmSync(path.join(ROOT, "dist-store-google"), { recursive: true, force: true }); } catch (_) {} });

  const browser = await chromium.launch({ executablePath: findChromium(), args: ["--no-sandbox"] });
  const rendered = {};   // lang -> key -> text (read + every quiz screen)
  const hits = [];

  for (const lang of langs) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, locale: lang === "en" ? "en-US" : lang });
    await ctx.addInitScript((l) => { try { localStorage.setItem("clkn_lang", l); } catch (_) {} }, lang);
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    // Offline: every API call is refused, including machine translation — what renders is the
    // bundle plus its shipped dictionaries, which is what a phone with no signal shows.
    await page.route("**/api/**", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ success: false, status: "unavailable" }) }));
    await page.goto(`${BASE}/index.html`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => !!document.querySelector(".seeker-shell"), null, { timeout: 20000 }).catch(() => {});
    await page.waitForFunction((l) => window.CLKN_I18N && window.CLKN_I18N.lang === l && (l === "en" || Object.keys(window.CLKN_I18N.dict || {}).length > 1000), lang, { timeout: 20000 }).catch(() => {});
    const dictSize = await page.evaluate(() => (window.CLKN_I18N && Object.keys(window.CLKN_I18N.dict || {}).length) || 0);
    ok(`${lang} · the shell booted with lang=${lang}${lang === "en" ? "" : ` and a ${dictSize}-key dictionary`}`, lang === "en" ? dictSize >= 0 : dictSize > 1000, { dictSize });

    const text = () => page.evaluate(() => document.body.innerText || "");
    const per = {};
    let questionsSeen = 0, missing = 0;
    for (const l of lessons) {
      await page.evaluate((h) => { window.location.hash = h; }, `#/school/${l.course}/${l.id}`);
      await page.waitForFunction(() => { const p = document.querySelector(".seeker-pane.seeker-school"); return !!p && !!p.querySelector(".seeker-school-title") && !/That lesson doesn't exist/.test(p.innerText); }, null, { timeout: 5000 }).catch(() => {});
      let t = await text();
      if (/That lesson doesn't exist|That course doesn't exist/.test(t) || !/seeker/.test(await page.evaluate(() => document.querySelector(".seeker-pane.seeker-school") ? "seeker" : ""))) { missing++; per[l.key] = t; continue; }
      let all = t;
      // ⚠️ THE LESSON STEPPER (#437) shows a long lesson one section per screen, so the read screen
      // above is only its opening step. Walk every step and read each one — a scan that read only
      // the opening would pass with a forbidden sentence sitting on step 3 (the --mutate proof on
      // #/school/lp/4 is what keeps this honest). The walk ends on the last step, where the quiz
      // button lives.
      const stepCount = await page.locator(".seeker-step-seg").count();
      for (let s = 1; s < stepCount; s++) {
        await page.locator(".seeker-step-seg").nth(s).click().catch(() => {});
        await page.waitForTimeout(30);
        all += "\n" + (await text());
      }
      if (l.questions) {
        await page.click(".seeker-school-start").catch(() => {});
        for (let i = 0; i < l.questions; i++) {
          await page.waitForSelector(".seeker-school-option", { timeout: 5000 }).catch(() => {});
          const opts = await page.$$(".seeker-school-option");
          if (!opts.length) break;
          all += "\n" + (await text());              // the question and its options
          await opts[0].click();
          await page.waitForSelector(".seeker-school-explain", { timeout: 5000 }).catch(() => {});
          all += "\n" + (await text());              // the verdict and the explanation
          questionsSeen++;
          await page.click(".seeker-school-explain .seeker-btn").catch(() => {});
        }
        await page.waitForTimeout(60);
        all += "\n" + (await text());                // passed / failed card
      }
      per[l.key] = all;
      if (TICKER.test(all)) hits.push({ lang, lesson: l.key, sample: all.split("\n").filter((line) => TICKER.test(line)).slice(0, 3) });
    }
    rendered[lang] = per;
    ok(`${lang} · every lesson rendered (${lessons.length - missing}/${lessons.length})`, missing === 0, { missing });
    ok(`${lang} · every quiz question rendered with its explanation (${questionsSeen}/${totalQ})`, questionsSeen === totalQ, { questionsSeen, totalQ });
    ok(`${lang} · no page errors while walking`, errors.length === 0, errors.slice(0, 3));
    const chars = Object.values(per).reduce((n, s) => n + s.length, 0);
    ok(`${lang} · ⚠️ our ticker is nowhere on any screen (${chars.toLocaleString()} rendered characters read)`, !hits.some((h) => h.lang === lang), hits.filter((h) => h.lang === lang).slice(0, 5));
    if (lang !== "en" && rendered.en) {
      const differ = lessons.filter((l) => per[l.key] && rendered.en[l.key] && per[l.key] !== rendered.en[l.key]).length;
      ok(`${lang} · the walk really switched language: ${differ}/${lessons.length} lessons render differently from English`, differ >= Math.floor(lessons.length * 0.9), { differ });
    }
    await ctx.close();
  }

  // Codex's examples, by name, on the rendered English text of the lesson each lived in.
  if (rendered.en) {
    for (const ex of EXAMPLES) {
      const t = rendered.en[ex.where] || "";
      ok(`en · ${ex.name} is not on the screen of #/school/${ex.where}`, t.length > 0 && !ex.re.test(t), t ? t.split("\n").filter((l) => ex.re.test(l)).slice(0, 2) : "lesson not rendered");
    }
    for (const st of STORE_TEXT) {
      const t = rendered.en[st.where] || "";
      ok(`en · ${st.name} IS on the screen of #/school/${st.where} (the walk reads the real body)`, st.re.test(t), t.slice(0, 200));
    }
  }
  // The same examples must not survive in translation either: no dictionary sentence that
  // replaced an English sentence may carry the ticker into another language's screen.
  for (const lang of langs) if (lang !== "en" && rendered[lang]) {
    const t = Object.values(rendered[lang]).join("\n");
    ok(`${lang} · none of Codex's examples renders in translation`, !EXAMPLES.some((ex) => ex.re.test(t)), EXAMPLES.filter((ex) => ex.re.test(t)).map((ex) => ex.name));
  }

  await browser.close();
  console.log(failures ? `\n${failures} FAILED` : "\nall passed");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
