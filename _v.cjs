const { chromium } = require('playwright-core');
const INJECT = () => {
  const mk = a => ({ publicKey:{toString:()=>a}, connect:async function(){return{publicKey:this.publicKey}}, disconnect:async()=>{}, signTransaction:async t=>t });
  window.okxwallet = { solana: mk('OKXtestWa11etAddre55ForDetection22222222222') };
};
const P=['/airdrop','/buyspecial','/buyspecial-dashboard','/portal','/premium','/locker-room','/tools','/investors','/wallet-checkup'];
(async()=>{const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});let f=0;
for(const p of P){const c=await b.newContext();await c.addInitScript(INJECT);const pg=await c.newPage();const e=[];
pg.on('pageerror',x=>e.push(String(x).slice(0,100)));
await pg.goto('http://localhost:3000'+p,{waitUntil:'domcontentloaded',timeout:20000}).catch(()=>e.push('NAV'));
await pg.waitForTimeout(1800);
const r=await pg.evaluate(()=>({nav:!!document.getElementById('cluck-nav-bar'),
 finds: typeof CluckWallet!=='undefined'?CluckWallet.available().map(w=>w.name):null,
 detect: typeof detectWallets==='function'?detectWallets().map(w=>w.name):(typeof adDetect==='function'?(adDetect()?'found':'NONE'):(typeof getProvider==='function'?(getProvider()?'found':'NONE'):'n/a'))})).catch(()=>({err:1}));
const bad=e.length||!r.nav; if(bad)f++;
console.log((bad?'FAIL ':'ok   ')+p.padEnd(24),JSON.stringify(r),e.length?('ERR '+e.slice(0,2)):'');
await c.close();}
console.log(f?`\n*** ${f} FAILED ***`:'\nAll pages render, OKX detected everywhere, no page errors');await b.close();})();
