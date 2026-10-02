#!/usr/bin/env node
// Build the shareable preview of AHOY: PumpFunPirates as a claude.ai artifact folder:
//   <out>/index.html   page content (no doctype/html/head/body — the artifact skeleton adds them),
//                      game scripts inlined, Phaser from cdnjs (the artifact CSP's script host)
//   <out>/assets/**    art + fonts, published alongside as files
// The preview has no server, so the holder gate runs in its labelled demo mode.
// Usage: node pirates/tools/build-artifact.cjs <outDir>
const fs = require("fs");
const path = require("path");

const out = process.argv[2];
if (!out) { console.error("usage: build-artifact.cjs <outDir>"); process.exit(1); }
const PUB = path.join(__dirname, "..", "public");
const html = fs.readFileSync(path.join(PUB, "index.html"), "utf8");

const head = html.slice(html.indexOf("<head>") + 6, html.indexOf("</head>"));
const body = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"));
const title = (head.match(/<title>.*?<\/title>/) || ["<title>AHOY: PumpFunPirates</title>"])[0];
const style = (head.match(/<style>[\s\S]*?<\/style>/) || [""])[0];
let scripts = "";
const bodyNoScripts = body.replace(/<script src="([^"]+)"><\/script>\s*/g, (_, src) => {
  if (/phaser/.test(src)) scripts += `<script src="https://cdnjs.cloudflare.com/ajax/libs/phaser/3.60.0/phaser.min.js"></script>\n`;
  else scripts += `<script>\n${fs.readFileSync(path.join(PUB, src), "utf8")}\n</script>\n`;
  return "";
});
// The artifact skeleton pads :root by the safe-area insets; the game is a fixed full-screen canvas.
const fontsLink = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Just+Another+Hand&family=Pirata+One&display=swap">`;
const page = `${title}\n${fontsLink}\n${style}\n${bodyNoScripts.trim()}\n${scripts}`;
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "index.html"), page);

const files = {};
(function walk(dir, rel) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f), r = rel ? rel + "/" + f : f;
    if (fs.statSync(p).isDirectory()) walk(p, r);
    else if (!/^items\.png$/.test(f)) {
      fs.mkdirSync(path.join(out, "assets", path.dirname(r)), { recursive: true });
      fs.copyFileSync(p, path.join(out, "assets", r));
      files["assets/" + r] = path.join(out, "assets", r);
    }
  }
})(path.join(PUB, "assets"), "");
fs.writeFileSync(path.join(out, "files.json"), JSON.stringify(files, null, 1));
console.log(`index.html ${(page.length / 1024).toFixed(0)} KB · ${Object.keys(files).length} asset files`);
