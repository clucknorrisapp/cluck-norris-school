#!/usr/bin/env node
/* TTS pre-warm — synthesize the school's read-aloud audio ahead of demand.
 *
 * WHY: the ElevenLabs plan renews monthly whether we use it or not, and the /api/tts cache
 * (keyed model+voice+lang+EXACT text) makes every synthesized chunk free forever after.
 * This script drives the REAL site headless per language, runs a VERBATIM copy of
 * public/read-aloud.js's collect()+chunk() on each screen a user can press Listen on,
 * and POSTs the resulting chunks to /api/tts — exactly what the client would request,
 * so every pre-warmed chunk is a guaranteed future cache hit.
 *
 * KEEP THE COLLECTOR IN SYNC: if public/read-aloud.js's collect/chunk logic changes,
 * mirror it in COLLECT_SRC below or the pre-warmed keys stop matching.
 *
 * Usage:  node scripts/tts-prewarm.js --langs hi,pt,vi [--base https://clucknorris.app] [--dry]
 * Notes:  needs playwright + chromium (ops environment, not Railway). Stops cleanly when the
 *         server answers 503 (TTS_DAILY_CHAR_CAP reached) — rerun tomorrow; already-cached
 *         chunks respond fast and burn nothing, so reruns are cheap and resumable.
 */
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : dflt; };
const DRY = args.includes('--dry');
const BASE = opt('base', 'https://clucknorris.app');          // where /api/tts POSTs go
const SITE = opt('site', BASE);                               // where pages are LOADED from (a local
const PATH = opt('path', '/school');                          // static serve of dist+public works — the
                                                              // i18n swap is fully client-side)
const LANGS = String(opt('langs', 'hi,pt,vi')).split(',').map((s) => s.trim()).filter(Boolean);

// All 12 belt lessons + 7 incubator lessons pre-marked complete so every card is unlocked.
const BELT_IDS = ['lp', 'rugs', 'volatility', 'wallets', 'slippage', 'tokenomics', 'marketcap', 'dex', 'onchain', 'staking', 'bags', 'memecoins'];
const INCUBATOR_IDS = ['wallet', 'tokens', 'ramps', 'dex', 'liquidity', 'marketcap', 'safety'];
const HASHES = ['', '#select', '#incubator', '#library', '#lplab', '#clkn'];
const CARD_HASHES = ['#select', '#incubator'];   // screens whose lesson cards we also open one by one

// Verbatim port of public/read-aloud.js collect()+chunk() (returns chunk TEXTS).
const COLLECT_SRC = `(() => {
  var SKIP = { SCRIPT:1, STYLE:1, NOSCRIPT:1, CODE:1, PRE:1, BUTTON:1, SELECT:1, TEXTAREA:1, SVG:1, NAV:1, HEADER:1, FOOTER:1, INPUT:1, KBD:1, SAMP:1 };
  function isHidden(el) { try { return !(el.offsetParent !== null || (el.getClientRects && el.getClientRects().length)); } catch (_) { return false; } }
  function skipped(node) {
    var p = node.parentNode;
    while (p && p.nodeType === 1) {
      if (SKIP[p.tagName]) return true;
      if (p.id === "clkn-lang-toggle" || p.id === "clkn-read-bar" || p.id === "cluck-nav-bar") return true;
      if (p.hasAttribute && (p.getAttribute("aria-hidden") === "true" || p.hasAttribute("data-read-skip") || p.hasAttribute("data-i18n-skip"))) return true;
      p = p.parentNode;
    }
    return false;
  }
  function collect() {
    var tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    var out = [], n;
    while ((n = tw.nextNode())) {
      var t = (n.nodeValue || "").replace(/\\s+/g, " ").trim();
      if (t.length < 2) continue;
      if (!/[A-Za-z0-9\\u4e00-\\u9fff\\u00c0-\\u024f]/.test(t)) continue;
      if (skipped(n)) continue;
      var pe = n.parentElement;
      if (pe && isHidden(pe)) continue;
      if (/^(?:\\d{1,3}[.)]|[\\u2022\\u00b7\\u25aa\\u25e6\\u2023*\\u2013\\u2014-])$/.test(t)) continue;
      t = t.replace(/^(?:\\d{1,3}[.)]|[\\u2022\\u00b7\\u25aa\\u25e6\\u2023*\\u2013\\u2014-])\\s+/, "");
      if (t && !/[.!?\\u3002\\uff01\\uff1f:;,]$/.test(t)) t += ".";
      if (t.length < 2) continue;
      out.push(t);
    }
    return out;
  }
  function chunk(parts) {
    var chunks = [];
    for (var p = 0; p < parts.length; p++) {
      var sentences = parts[p].match(/[^.!?\\u3002\\uff01\\uff1f\\n]+[.!?\\u3002\\uff01\\uff1f]?/g) || [parts[p]];
      var cur = "";
      for (var i = 0; i < sentences.length; i++) {
        var s = sentences[i].trim(); if (!s) continue;
        if ((cur + " " + s).length > 180) { if (cur) chunks.push(cur); cur = s; }
        else cur = cur ? cur + " " + s : s;
      }
      if (cur) chunks.push(cur);
    }
    return chunks;
  }
  return chunk(collect());
})()`;

async function main() {
  const { chromium } = require('playwright');
  const exec = process.env.PW_CHROMIUM || undefined;
  const browser = await chromium.launch(exec ? { executablePath: exec, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] });
  const totals = { chunks: 0, posted: 0, cachedFast: 0, synthesized: 0, failed: 0, cap: false };
  for (const lang of LANGS) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.addInitScript(([l, belt, inc]) => {
      localStorage.setItem('clkn_lang', l);
      localStorage.setItem('clkn_completed', JSON.stringify(belt));
      localStorage.setItem('incubator_progress', JSON.stringify({ completed: inc }));
    }, [lang, BELT_IDS, INCUBATOR_IDS]);

    const seen = new Set();
    const grab = async (label) => {
      let chunks = [];
      try { chunks = await page.evaluate(COLLECT_SRC); } catch (e) { console.log(`  [${lang}] collect failed on ${label}: ${e.message}`); }
      let fresh = 0;
      for (const c of chunks) if (!seen.has(c)) { seen.add(c); fresh++; }
      console.log(`  [${lang}] ${label}: ${chunks.length} chunks (${fresh} new)`);
    };

    for (const screen of HASHES) {
      // the SPA reads the hash only at boot — force a real reload per screen
      await page.goto('about:blank').catch(() => {});
      await page.goto(SITE + PATH + screen, { waitUntil: 'domcontentloaded' }).catch(() => {});
      await page.waitForTimeout(3500);
      await grab(screen || 'landing');
      if (!CARD_HASHES.includes(screen)) continue;
      // open each lesson card: re-load the screen, click the i-th big button, read the page
      const count = await page.evaluate(() => Array.from(document.querySelectorAll('button'))
        .filter((b) => b.offsetParent && b.textContent.trim().length > 25).length);
      for (let i = 0; i < count; i++) {
        await page.goto('about:blank').catch(() => {});
        await page.goto(SITE + PATH + screen, { waitUntil: 'domcontentloaded' }).catch(() => {});
        await page.waitForTimeout(2500);
        const clicked = await page.evaluate((idx) => {
          const cards = Array.from(document.querySelectorAll('button'))
            .filter((b) => b.offsetParent && b.textContent.trim().length > 25);
          if (!cards[idx]) return false; cards[idx].click(); return true;
        }, i);
        if (!clicked) continue;
        await page.waitForTimeout(2200);
        await grab(`${screen} card ${i + 1}/${count}`);
      }
    }
    await ctx.close();

    const chunks = [...seen];
    totals.chunks += chunks.length;
    const chars = chunks.reduce((s, c) => s + c.length, 0);
    console.log(`[${lang}] TOTAL unique chunks: ${chunks.length} (~${chars} chars)`);
    if (DRY) continue;

    for (const text of chunks) {
      const t0 = Date.now();
      let r = null;
      try {
        r = await fetch(BASE + '/api/tts', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text, lang }),
        });
      } catch (e) { totals.failed++; continue; }
      const ms = Date.now() - t0;
      if (r.status === 503) { console.log(`[${lang}] 503 — daily synth cap reached. Rerun tomorrow to continue (cached chunks cost nothing).`); totals.cap = true; break; }
      if (!r.ok) { totals.failed++; continue; }
      totals.posted++;
      if (ms < 300) totals.cachedFast++; else totals.synthesized++;
      // pace under the 60/min rate limit, and gentler when actually synthesizing
      await new Promise((res) => setTimeout(res, ms < 300 ? 350 : 1400));
    }
    if (totals.cap) break;
  }
  await browser.close();
  console.log('DONE', JSON.stringify(totals));
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
