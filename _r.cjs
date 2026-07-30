const { chromium } = require('playwright-core');
(async()=>{const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const pg=await b.newPage(); await pg.setViewportSize({width:1000,height:1500});
const errs=[]; pg.on('pageerror',e=>errs.push(String(e).slice(0,90)));
await pg.goto('http://localhost:3000/autopsy',{waitUntil:'domcontentloaded'});await pg.waitForTimeout(1200);
// run a real autopsy on CLKN so the REPORT renders, then measure that
await pg.fill('#mintInput','DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS').catch(()=>{});
await pg.click('#runBtn').catch(()=>{});
await pg.waitForTimeout(25000);
const r=await pg.evaluate(()=>{
  const n=[...document.querySelectorAll('p,div,li,label,span')].filter(e=>{
    const t=[...e.childNodes].filter(x=>x.nodeType===3).map(x=>x.textContent.trim()).join('');
    return t.length>45 && e.offsetParent!==null;});
  let tiny=0,min=99;const d={};const worst=[];
  for(const e of n){const s=parseFloat(getComputedStyle(e).fontSize);d[s]=(d[s]||0)+1;
    if(s<min)min=s; if(s<12.5){tiny++; if(worst.length<4) worst.push({sz:s,txt:e.textContent.trim().slice(0,50)});}}
  return {reportShown: !!document.querySelector('.result.show, #result.show'), n:n.length, tiny, min, worst,
    dist:Object.entries(d).sort((a,b)=>a[0]-b[0]).map(([k,v])=>k+'×'+v).join(' ')};});
console.log('REPORT RENDERED:', r.reportShown, '| prose nodes:', r.n, '| under 12.5px:', r.tiny, '| min:', r.min);
console.log('dist:', r.dist);
if(r.worst.length) console.log('smallest:', JSON.stringify(r.worst,null,1));
if(errs.length) console.log('ERRS', errs.slice(0,3));
await pg.screenshot({path:'/tmp/claude-0/-home-user-cluck-norris-school/46e9b250-658d-5b1c-971a-f5925836c163/scratchpad/AUTOPSY.png'});
await b.close();})();
