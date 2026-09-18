#!/usr/bin/env node
"use strict";
// AA4 (docs/COLOSSEUM_ROADMAP.md §11): builds public/hub-judge.html FROM docs/JUDGE_GUIDE.md so
// the two cannot drift — scripts/hub-judge-doc-test.cjs regenerates the page in CI and asserts it
// is byte-identical to what is committed. Modelled on scripts/build-curriculum.cjs (same "same
// input -> byte-identical output" contract) and public/hub-trust.html (the page chrome: theme.css,
// static OG meta, the back-home link, cluck-util.js + cluck-nav.js at the bottom).
//
// No `marked`/`markdown-it` dependency (checked: neither is in package.json) — this is a small,
// dependency-free markdown-to-HTML converter that understands exactly what docs/JUDGE_GUIDE.md
// uses: headings (#/##/###), paragraphs, ordered and unordered lists, inline code, and links. It
// is not a general CommonMark implementation and is not meant to become one.
//
// The generated body is the doc's own English markdown, rendered as-is — by design, not run
// through the site's curated i18n dictionaries (a fifteen-minute technical checklist for judges is
// not the kind of prose the school translates line by line). Only the page CHROME around it (the
// static title/subtitle/footer strings in the template below, none of which come from the
// markdown) is added to the six public/i18n/*.json dictionaries, the same way every other Hub
// page's static chrome is. Do not add "hub-judge.html" to scripts/i18n-audit.cjs's gated
// HUB_FILES list — that list holds pages whose BODY is curated for translation, and this page's
// body is English markdown on purpose.
//
// Usage: node scripts/build-judge-page.cjs   (writes public/hub-judge.html)
// Also usable as a library: require("./build-judge-page.cjs").renderPage() returns the HTML
// string without touching disk — scripts/hub-judge-doc-test.cjs uses this to check for drift.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DOC_PATH = path.join(ROOT, "docs", "JUDGE_GUIDE.md");
const OUT_PATH = path.join(ROOT, "public", "hub-judge.html");

// ── inline markdown: `code` and [text](url), nested (a link's text may itself hold `code`) ──────
function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderInline(raw) {
  // Escape the WHOLE line first (backticks, brackets and parens are not in escapeHtml's set, so
  // this is safe to do before recognising markdown syntax) — every remaining literal character is
  // then genuinely safe HTML text, and the two regex passes below only ever ADD tags around
  // already-escaped content.
  let s = escapeHtml(raw);
  s = s.replace(/`([^`]+)`/g, (_m, code) => `<code>${code}</code>`);
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text, url) => `<a href="${url}">${text}</a>`);
  return s;
}

// ── block-level parse: headings, paragraphs, ordered/unordered lists ────────────────────────────
function parseBlocks(md) {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let i = 0;
  const isHeading = (l) => /^(#{1,6})\s+(.*)$/.exec(l);
  const isOl = (l) => /^\s*\d+\.\s+(.*)$/.exec(l);
  const isUl = (l) => /^\s*[-*]\s+(.*)$/.exec(l);

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    const h = isHeading(line);
    if (h) { blocks.push({ type: "heading", level: h[1].length, text: h[2].trim() }); i++; continue; }

    // Ordered/unordered lists: a wrapped source line (an indented continuation with no marker
    // of its own) joins onto the PREVIOUS item rather than ending the list — the same
    // hard-wrap-is-not-a-line-break convention the paragraph case below uses. The list ends at a
    // blank line, a heading, or a line starting the OTHER marker type.
    const ol0 = isOl(line);
    const ul0 = !ol0 && isUl(line);
    if (ol0 || ul0) {
      const type = ol0 ? "ol" : "ul";
      const items = [ol0 ? ol0[1].trim() : ul0[1].trim()];
      i++;
      while (i < lines.length) {
        const cur = lines[i];
        if (!cur.trim()) break;               // blank line ends the list
        if (isHeading(cur)) break;
        const m = ol0 ? isOl(cur) : isUl(cur);
        if (m) { items.push(m[1].trim()); i++; continue; }
        const otherMarker = ol0 ? isUl(cur) : isOl(cur);
        if (otherMarker) break;                // switching marker type starts a new list block
        items[items.length - 1] += " " + cur.trim();  // continuation of the previous item
        i++;
      }
      blocks.push({ type, items });
      continue;
    }

    // paragraph: consecutive non-blank, non-heading, non-list lines, joined with a single space
    // (a hard-wrapped source line is not a hard line break — same convention as CommonMark).
    const paraLines = [];
    while (i < lines.length && lines[i].trim() && !isHeading(lines[i]) && !isOl(lines[i]) && !isUl(lines[i])) {
      paraLines.push(lines[i].trim());
      i++;
    }
    blocks.push({ type: "p", text: paraLines.join(" ") });
  }
  return blocks;
}

function blockToHtml(b) {
  if (b.type === "heading") {
    const tag = "h" + Math.min(6, Math.max(1, b.level));
    return `<${tag}>${renderInline(b.text)}</${tag}>`;
  }
  if (b.type === "p") return `<p>${renderInline(b.text)}</p>`;
  if (b.type === "ol") return `<ol>${b.items.map((it) => `<li>${renderInline(it)}</li>`).join("")}</ol>`;
  if (b.type === "ul") return `<ul>${b.items.map((it) => `<li>${renderInline(it)}</li>`).join("")}</ul>`;
  return "";
}

// Groups the parsed blocks into cards, one per top-level (##) section, so the rendered page reads
// like every other Hub page's stack of .card divs. A level-1 (#) heading is the document's own
// title — used for <title>/OG text only, never repeated as a second <h1> in the body (the page
// chrome below already carries the one visible <h1>). Anything before the first ## (e.g. the
// doc's own intro paragraph) is folded into an intro card with no heading of its own.
function renderBody(blocks) {
  let title = null;
  const rest = [];
  for (const b of blocks) {
    if (title === null && b.type === "heading" && b.level === 1) { title = b.text; continue; }
    rest.push(b);
  }

  const cards = [];
  let current = null;
  for (const b of rest) {
    if (b.type === "heading" && b.level === 2) {
      if (current) cards.push(current);
      current = { heading: b, blocks: [] };
      continue;
    }
    if (!current) current = { heading: null, blocks: [] };
    current.blocks.push(b);
  }
  if (current) cards.push(current);

  const html = cards.map((c) => {
    const head = c.heading ? blockToHtml(c.heading) : "";
    const body = c.blocks.map(blockToHtml).join("\n  ");
    return `<div class="card" data-clkn-avoid-kids="1">\n  ${head}\n  ${body}\n</div>`;
  }).join("\n");

  return { title, html };
}

// ── page template — same chrome as public/hub-trust.html: theme.css, static OG meta (no
// per-request variation — there is no project/program/receipt to vary this page's text by),
// the back-home link, cluck-util.js + cluck-nav.js (which loads /i18n.js) at the bottom. ─────────
// The title/subtitle/footer strings below are STATIC (never sourced from the markdown) so they
// can be curated in public/i18n/*.json like every other Hub page's chrome; the generated
// `{{BODY}}` block is the doc's own English markdown, deliberately outside that curated set (see
// the file header).
const PAGE_TITLE = "The Judge's Fifteen Minutes";
const PAGE_DESC = "One page mapping each Colosseum judging criterion to the exact URLs to open, what to look for, and the test that pins it — rendered from docs/JUDGE_GUIDE.md so the two cannot drift.";
const PAGE_SUBTITLE = "WHAT TO OPEN, IN ORDER, PER JUDGING CRITERION";
const FOOTER_NOTE = "Every claim here is checked against a route this repo registers and a test file in scripts/.";

function renderPage() {
  const md = fs.readFileSync(DOC_PATH, "utf8");
  const blocks = parseBlocks(md);
  const { html: bodyHtml } = renderBody(blocks);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<link rel="stylesheet" href="/theme.css">
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>${escapeHtml(PAGE_TITLE)} — Cluck Norris</title>
<meta name="description" content="${escapeHtml(PAGE_DESC)}"/>
<meta property="og:title" content="${escapeHtml(PAGE_TITLE)} — Cluck Norris"/>
<meta property="og:description" content="${escapeHtml(PAGE_DESC)}"/>
<meta property="og:type" content="website"/>
<meta property="og:url" content="https://clucknorris.app/hub/judge"/>
<meta property="og:image" content="https://clucknorris.app/og/hub-card.png"/>
<meta property="og:image:width" content="1200"/>
<meta property="og:image:height" content="630"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${escapeHtml(PAGE_TITLE)} — Cluck Norris"/>
<meta name="twitter:description" content="${escapeHtml(PAGE_DESC)}"/>
<meta name="twitter:image" content="https://clucknorris.app/og/hub-card.png"/>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<style>
  /* palette + type scale come from theme.css — never redefine a token here */
  * { box-sizing:border-box; margin:0; padding:0; }
  body { background:var(--bg); color:var(--text); font-family:var(--body); min-height:100vh; }
  .wrap { max-width:760px; margin:0 auto; padding:24px 16px 80px; }
  .back-home { display:inline-flex; align-items:center; min-height:44px; gap:6px; font-size:11px; font-weight:700; letter-spacing:2px; color:var(--orange); text-decoration:none; margin-bottom:14px; }
  .header { text-align:center; margin-bottom:18px; }
  .header h1 { font-family:var(--disp); font-size:26px; letter-spacing:.5px; color:var(--gold); font-weight:400; }
  .header p { font-size:11px; color:var(--sub); letter-spacing:2px; margin-top:6px; }
  main .card { background:var(--card); border:1px solid var(--border); border-radius:12px; padding:18px; margin-bottom:14px; }
  main .card h2 { font-family:var(--disp); font-size:15px; letter-spacing:1px; margin:0 0 10px; color:var(--gold); text-transform:uppercase; font-weight:400; }
  main .card h3 { font-family:var(--disp); font-size:13px; letter-spacing:1px; margin:10px 0 6px; color:var(--text); font-weight:400; }
  main .card p { font-size:var(--body-text, 15px); color:var(--subtext, #9CA3AF); line-height:1.7; margin:0 0 8px; }
  main .card ol, main .card ul { margin:0 0 4px; padding-left:20px; }
  main .card li { font-size:var(--body-text, 15px); color:var(--subtext, #9CA3AF); line-height:1.65; margin-bottom:10px; }
  main .card li:last-child { margin-bottom:0; }
  main .card code { font-family:var(--mono); font-size:12.5px; color:#D1D5DB; background:rgba(255,255,255,0.06); border-radius:4px; padding:1px 5px; word-break:break-all; }
  main .card a { color:var(--cyan, #67E8F9); text-decoration:none; }
  main .card a code { color:inherit; }
  .footer-note { text-align:center; font-size:12px; color:var(--sub); margin-top:6px; line-height:1.6; }
  .footer-note a { color:var(--cyan, #67E8F9); text-decoration:none; display:inline-block; padding:14px 3px; margin:-14px -3px; }
</style>
</head>
<body>
<main class="wrap">
  <a class="back-home" href="/hub">← PROJECT HUB</a>
  <div class="header">
    <h1 data-clkn-avoid="1">${escapeHtml(PAGE_TITLE)}</h1>
    <p data-clkn-avoid="1">${escapeHtml(PAGE_SUBTITLE)}</p>
  </div>

  <!-- Generated from docs/JUDGE_GUIDE.md by scripts/build-judge-page.cjs — do not hand-edit
       between here and the closing comment; run the build script and commit its output instead.
       This body is the doc's own English markdown, on purpose (see the generator's file header)
       and is NOT part of the curated i18n set scripts/i18n-audit.cjs gates. -->
${bodyHtml}
  <!-- /generated -->

  <div class="footer-note" data-clkn-avoid="1">
    ${escapeHtml(FOOTER_NOTE)}<br>
    <a href="https://github.com/clucknorrisapp/cluck-norris-school/blob/main/docs/JUDGE_GUIDE.md" target="_blank" rel="noopener">Read docs/JUDGE_GUIDE.md on GitHub →</a>
    <a href="/hub/trust">What the Hub doesn't prove →</a>
    <a href="/hub">Back to the Project Hub →</a>
  </div>
</main>

<script src="/cluck-util.js"></script>
<!-- STORE:OUT --><script defer src="/cluck-nav.js"></script><!-- /STORE:OUT -->
</body>
</html>
`;
}

function main() {
  const html = renderPage();
  fs.writeFileSync(OUT_PATH, html);
  console.log("wrote " + path.relative(ROOT, OUT_PATH) + " (" + html.length + " bytes)");
}

module.exports = { renderPage, parseBlocks, renderInline, DOC_PATH, OUT_PATH };
if (require.main === module) main();
