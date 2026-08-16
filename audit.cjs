// Audit every sprite asset: opaque-content bounds, so a cutout drawn without feet is measurable
// rather than eyeballed. Prints content-bottom as a fraction of texture height (1.000 = art runs to
// the very bottom edge; anything well under ~0.99 on a standing character means no feet).
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const DIR = path.join(__dirname, 'normie-quest/src/assets');

(async () => {
  const only = process.argv.slice(2);
  const files = fs.readdirSync(DIR).filter(f => f.endsWith('.b64'))
    .filter(f => !only.length || only.some(o => f.includes(o)));
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await b.newPage();
  await p.setContent('<canvas id=c></canvas>');
  const rows = [];
  for (const f of files) {
    let s = fs.readFileSync(path.join(DIR, f), 'utf8').trim();
    const i = s.indexOf('base64,'); if (i >= 0) s = s.slice(i + 7);
    const r = await p.evaluate(async (d) => {
      const img = new Image();
      try { await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = 'data:image/png;base64,' + d; }); }
      catch (e) { return null; }
      const c = document.getElementById('c'); c.width = img.width; c.height = img.height;
      const g = c.getContext('2d'); g.drawImage(img, 0, 0);
      const a = g.getImageData(0, 0, c.width, c.height).data;
      let top = -1, bot = -1, left = c.width, right = -1;
      for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
        if (a[(y * c.width + x) * 4 + 3] > 16) {
          if (top < 0) top = y; bot = y;
          if (x < left) left = x; if (x > right) right = x;
        }
      }
      return { w: c.width, h: c.height, top, bot, left, right };
    }, s);
    if (!r) { rows.push({ f, err: 'decode failed' }); continue; }
    rows.push({ f, ...r, bfrac: (r.bot + 1) / r.h });
  }
  await b.close();
  rows.sort((x, y) => (x.bfrac ?? 9) - (y.bfrac ?? 9));
  console.log('bottom%  size       gap  asset');
  for (const r of rows) {
    if (r.err) { console.log(`  ----   ${r.err}  ${r.f}`); continue; }
    const flag = r.bfrac < 0.99 ? ' <-- content stops short' : '';
    console.log(`${(r.bfrac * 100).toFixed(1).padStart(6)}  ${String(r.w + 'x' + r.h).padEnd(9)} ${String(r.h - 1 - r.bot).padStart(4)}  ${r.f}${flag}`);
  }
})();
