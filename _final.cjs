const { chromium } = require('playwright-core');
const P = ['/airdrop','/buyspecial','/buyspecial-dashboard','/wallet-checkup','/premium','/locker-room','/holders','/hatchery','/investors'];
(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium' });
  let f=0;
  for (const p of P) {
    const pg = await b.newPage(); const errs=[];
    pg.on('pageerror',e=>errs.push(String(e).slice(0,100)));
    await pg.goto('http://localhost:3000'+p,{waitUntil:'domcontentloaded',timeout:20000}).catch(e=>errs.push('NAV'));
    await pg.waitForTimeout(2000);
    const r = await pg.evaluate(()=>({
      nav: !!document.getElementById('cluck-nav-bar'),
      util: typeof CluckUtil, wallet: typeof CluckWallet,
      unlock: typeof adConnect !== 'undefined' ? 'fn' : (typeof gConnectWallet !== 'undefined' ? 'fn' : 'n/a'),
    })).catch(()=>({evalErr:1}));
    const bad = errs.length || !r.nav;
    if (bad) f++;
    console.log((bad?'FAIL ':'ok   ')+p.padEnd(24), JSON.stringify(r), errs.length?('ERR '+errs.slice(0,2)):'');
    await pg.close();
  }
  console.log(f?`\n*** ${f} FAILED ***`:'\nAll pages render, nav present, no page errors');
  await b.close();
})();
