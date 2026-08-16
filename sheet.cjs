// Contact sheet of the boss-class cutouts, each labelled, on a mid grey so alpha edges show.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const DIR = path.join(__dirname, 'normie-quest/src/assets');
const SP = '/tmp/claude-0/-home-user-cluck-norris-school/6c9d969c-439e-52a4-82ad-187116dc06e1/scratchpad/';
(async () => {
  const names = process.argv[2].split(',');
  const out = process.argv[3];
  const imgs = names.map(n => {
    let s = fs.readFileSync(path.join(DIR, 'cut_' + n + '.b64'), 'utf8').trim();
    const i = s.indexOf('base64,'); if (i >= 0) s = s.slice(i + 7);
    return { n, d: s };
  });
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await b.newPage({ viewport: { width: 1240, height: 400 } });
  await p.setContent(`<body style="margin:0;background:#6e6e78;font:12px system-ui;color:#fff">
  <div style="display:flex;flex-wrap:wrap;gap:4px;padding:6px">
  ${imgs.map(o => `<div style="width:196px;background:#4a4a54;border:1px solid #888">
     <div style="height:210px;display:flex;align-items:flex-end;justify-content:center;background:
       repeating-linear-gradient(45deg,#5a5a64 0 8px,#63636d 8px 16px)">
       <img src="data:image/png;base64,${o.d}" style="max-width:190px;max-height:208px;image-rendering:pixelated">
     </div>
     <div style="padding:3px 5px;background:#222;text-align:center">${o.n}</div></div>`).join('')}
  </div></body>`);
  await p.waitForTimeout(1500);
  await p.screenshot({ path: SP + out, fullPage: true });
  await b.close();
  console.log('wrote', out);
})();
