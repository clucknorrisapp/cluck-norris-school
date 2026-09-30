#!/usr/bin/env node
/* TTS pre-warm — fill production's read-aloud cache before anyone presses Listen.
 *
 * WHY: /api/tts caches every clip on the /data volume keyed by model + voice + language + the
 * EXACT chunk text, so a clip is paid for once and free forever. Nothing is cached until someone
 * presses Listen on that exact passage in that exact language. This walks every lesson the way a
 * learner would, collects exactly the chunks the read-aloud button would send, and POSTs them.
 *
 * NO DRIFT: the collector is not a copy. collect(), chunk() and speechNorm() are sliced out of
 * public/read-aloud.js at run time and evaluated in the page, so whatever the button would send
 * is what gets warmed. If the markers below move, the script refuses to run instead of warming
 * keys that will never match.
 *
 * Two phases, run separately or together:
 *   --walk   load the school (a LOCAL server is fine and faster: `PORT=3111 node server.js` after
 *            `npm run build`), open every Belt Course lesson (#lesson=<id>), every Incubator lesson,
 *            every LP Lab lesson and every Library article, walk every lesson step, and write
 *            <out> = { lang: { "<surface>/<id>/<step>": [chunk, …] } }.
 *   --warm   POST each unique chunk to <base>/api/tts as {text, lang}, surface-major (belt →
 *            incubator → lplab → library, each across all languages) so the most-used lessons fill
 *            first. Paced under the route's 60/min limiter. Stops cleanly on 503 "tts budget
 *            reached" (TTS_DAILY_CHAR_CAP) and resumes from <out>.done.json on the next run.
 *
 * ⚠️ Walk against the SAME lesson source and dictionaries production serves, or the texts differ.
 * ⚠️ A local walk has no machine translation (no ANTHROPIC_API_KEY), so a string with no curated
 *    translation stays English there while production machine-translates it. --warm therefore
 *    skips any non-English chunk identical to an English one — that exact text never plays.
 * ⚠️ Warming spends the owner's ElevenLabs credits (Flash model = half-price credits per char).
 *    Measured 2026-09-30: ~120k chars for English, ~850k chars for all seven languages.
 *
 * Usage:
 *   node scripts/tts-prewarm.js --walk --site http://127.0.0.1:3111 --langs en,es,hi --out /tmp/tts.json
 *   node scripts/tts-prewarm.js --warm --base https://clucknorris.app --out /tmp/tts.json [--surfaces belt,incubator]
 *   CHROME=/opt/pw-browsers/…/chrome to point playwright at a preinstalled browser.
 */
const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf("--" + n); return i >= 0 ? args[i + 1] : d; };
const has = (n) => args.includes("--" + n);
const SITE = opt("site", "http://127.0.0.1:3111");
const BASE = opt("base", "https://clucknorris.app");
const LANGS = String(opt("langs", "en,es,hi,it,pt,vi,zh")).split(",").map((s) => s.trim()).filter(Boolean);
const SURFACES = String(opt("surfaces", "belt,incubator,lplab,library")).split(",");
const OUT = path.resolve(opt("out", "tts-prewarm.json"));
const PER_MIN = parseInt(opt("per-min", "50"), 10);

// ── the read-aloud collector, sliced from the real file ───────────────────────────────────────
function collectorSource() {
  const src = fs.readFileSync(path.join(__dirname, "..", "public", "read-aloud.js"), "utf8");
  const cut = (from, to) => {
    const a = src.indexOf(from), b = src.indexOf(to, a);
    if (a < 0 || b < 0) throw new Error(`read-aloud.js marker moved: "${from}" … "${to}" — update tts-prewarm.js before warming`);
    return src.slice(a, b);
  };
  const body = cut("var SKIP = {", "var queue = [], idx = 0");        // SKIP, isHidden, skipped, collect, pauses, chunk
  const norm = cut("function speechNorm(s) {", "// Fetch one chunk's audio");
  return `(() => { ${body}\n${norm}\n return chunk(collect()).map(function (c) { return speechNorm(c.text); }); })()`;
}

// Lesson inventories straight from the sources (the same arrays the site renders).
function ids(file, name) {
  const s = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
  const i = s.indexOf(`const ${name} = [`);
  if (i < 0) throw new Error(`${name} not found in ${file}`);
  const seg = s.slice(i, s.indexOf("\n];", i));
  return [...seg.matchAll(/^ {4}id:\s*(?:"([^"]+)"|(\d+))/gm)].map((m) => m[1] || m[2]);
}

async function settle(page, quiet = 700, max = 6000) {
  await page.evaluate(({ quiet, max }) => new Promise((res) => {
    let t = setTimeout(res, quiet); const end = Date.now() + max;
    const mo = new MutationObserver(() => { clearTimeout(t); if (Date.now() > end) { mo.disconnect(); res(); return; } t = setTimeout(() => { mo.disconnect(); res(); }, quiet); });
    mo.observe(document.body, { childList: true, characterData: true, subtree: true });
  }), { quiet, max });
}

async function walk() {
  const { chromium } = require("playwright");
  const COLLECT = collectorSource();
  const BELT = ids("src/App.jsx", "LESSONS");
  const INCUBATOR = ids("src/App.jsx", "INCUBATOR_LESSONS");
  const LP_COUNT = ids("src/sections/LPLab.jsx", "LP_LESSONS").length;
  const result = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : {};
  const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
  const stepsOf = async (page) => {
    const segs = page.locator("[data-lesson-step-seg]"); const n = await segs.count(); const out = [];
    for (let s = 0; s < Math.max(1, n); s++) { if (n > 0 && s > 0) { await segs.nth(s).click(); await page.waitForTimeout(150); } await settle(page); out.push(await page.evaluate(COLLECT)); }
    return out;
  };
  const open = async (page, hash) => {
    await page.goto(SITE + "/school" + hash, { waitUntil: "domcontentloaded" });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.querySelectorAll("button").length > 3, null, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(500);
  };
  for (const lang of LANGS) {
    const ctx = await browser.newContext({ viewport: { width: 1000, height: 1400 } });
    const page = await ctx.newPage();
    await page.route("**://fonts.googleapis.com/**", (r) => r.abort());
    await page.route("**://fonts.gstatic.com/**", (r) => r.abort());
    await page.goto(SITE + "/school", { waitUntil: "domcontentloaded" });
    await page.evaluate((l) => localStorage.setItem("clkn_lang", l), lang);
    const rec = (result[lang] = {});
    const t0 = Date.now();
    if (SURFACES.includes("belt")) for (const id of BELT) {
      await open(page, "#lesson=" + id);
      await page.waitForFunction(() => document.querySelectorAll("[data-lesson-step-seg]").length > 0, null, { timeout: 15000 }).catch(() => {});
      (await stepsOf(page)).forEach((c, i) => (rec[`belt/${id}/${i}`] = c));
    }
    if (SURFACES.includes("incubator")) for (let i = 0; i < INCUBATOR.length; i++) {
      await page.goto(SITE + "/", { waitUntil: "domcontentloaded" });
      await page.evaluate((done) => localStorage.setItem("incubator_progress", JSON.stringify({ completed: done })), INCUBATOR.slice(0, i));
      await open(page, "#incubator");
      (await stepsOf(page)).forEach((c, k) => (rec[`incubator/${INCUBATOR[i]}/${k}`] = c));
    }
    if (SURFACES.includes("lplab")) for (let i = 1; i <= LP_COUNT; i++) {
      await open(page, "#lplab");
      const ok = await page.evaluate((n) => { const t = [...document.querySelectorAll("button")].filter((b) => /LESSON\s*\d+|\d+\.\s+\S/.test(b.textContent || "")); if (t.length < n) return false; t[n - 1].click(); return true; }, i);
      if (!ok) { console.error(`  ${lang}: LP Lab tile ${i} not found`); continue; }
      await page.waitForTimeout(700);
      (await stepsOf(page)).forEach((c, k) => (rec[`lplab/${i}/${k}`] = c));
    }
    if (SURFACES.includes("library")) {
      // Articles are accordions: expand each in the Deep Dives (📖) and Liquidity (🌊) tabs.
      for (const [tag, emoji] of [["dive", "📖"], ["liq", "🌊"]]) {
        await open(page, "#library");
        await page.evaluate((e) => { const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim().startsWith(e)); if (b) b.click(); }, emoji);
        await settle(page);
        const count = await page.evaluate(() => [...document.querySelectorAll("button")].filter((b) => /[▼▲]\s*$/.test(b.textContent || "")).length);
        for (let i = 0; i < count; i++) {
          const acc = () => page.evaluate((i) => { const a = [...document.querySelectorAll("button")].filter((b) => /[▼▲]\s*$/.test(b.textContent || "")); if (!a[i]) return false; a[i].click(); return true; }, i);
          if (!(await acc())) break;
          await settle(page);
          rec[`library/${tag}-${i}/0`] = await page.evaluate(COLLECT);
          await acc(); await page.waitForTimeout(150);
        }
      }
    }
    const uniq = new Set(Object.values(rec).flat());
    console.log(`walk ${lang}: ${Object.keys(rec).length} screens, ${uniq.size} unique chunks, ${[...uniq].reduce((n, t) => n + t.length, 0)} chars, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    fs.writeFileSync(OUT, JSON.stringify(result));
    await ctx.close();
  }
  await browser.close();
}

async function warm() {
  const data = JSON.parse(fs.readFileSync(OUT, "utf8"));
  const DONE = OUT.replace(/\.json$/, "") + ".done.json";
  const done = fs.existsSync(DONE) ? JSON.parse(fs.readFileSync(DONE, "utf8")) : {};
  const key = (l, t) => l + "\u0000" + t;
  const norm = (t) => String(t).replace(/\s+/g, " ").trim().slice(0, 1200);
  const enSet = new Set(Object.values(data.en || {}).flat().map(norm));
  const save = () => fs.writeFileSync(DONE, JSON.stringify(done));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let hits = 0, misses = 0, chars = 0, fails = 0; const t0 = Date.now();
  outer: for (const surface of SURFACES) for (const lang of LANGS) {
    const rec = data[lang]; if (!rec) { console.log(`${surface}/${lang}: not walked — skipped`); continue; }
    const seen = new Set(), list = [];
    for (const k of Object.keys(rec)) { if (k.split("/")[0] !== surface) continue; for (const t of rec[k]) { const s = norm(t); if (!s || seen.has(s)) continue; seen.add(s); if (lang !== "en" && enSet.has(s)) continue; list.push(s); } }
    let lh = 0, lm = 0, lc = 0;
    for (const text of list) {
      if (done[key(lang, text)]) continue;
      const t1 = Date.now(); let r;
      try { r = await fetch(BASE + "/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, lang }) }); }
      catch (e) { fails++; await sleep(5000); continue; }
      if (r.status === 200) { const c = r.headers.get("x-tts-cache"); await r.arrayBuffer(); if (c === "hit") { hits++; lh++; } else { misses++; lm++; chars += text.length; lc += text.length; } done[key(lang, text)] = c === "hit" ? 1 : 2; if ((hits + misses) % 20 === 0) save(); }
      else if (r.status === 503) { const b = await r.text().catch(() => ""); if (/budget/.test(b)) { save(); console.log(`BUDGET: daily cap reached during ${surface}/${lang} — rerun after the reset`); break outer; } fails++; await sleep(8000); }
      else if (r.status === 429) { await sleep(65000); }
      else fails++;
      const gap = Math.round(60000 / PER_MIN) - (Date.now() - t1); if (gap > 0) await sleep(gap);
    }
    save();
    console.log(`warm ${surface}/${lang}: ${list.length} clips — cached already ${lh}, new ${lm} (${lc} chars)`);
  }
  save();
  console.log(`warm total: already cached ${hits}, new ${misses} (${chars} chars), failed ${fails}, ${((Date.now() - t0) / 60000).toFixed(1)} min`);
}

(async () => {
  if (has("check")) { new Function("return " + collectorSource()); console.log("collector slices cleanly from public/read-aloud.js and compiles"); return; }
  if (!has("walk") && !has("warm")) { console.error("pass --walk, --warm, or both (or --check)"); process.exit(2); }
  if (has("walk")) await walk();
  if (has("warm")) await warm();
})().catch((e) => { console.error(e.message || e); process.exit(1); });
