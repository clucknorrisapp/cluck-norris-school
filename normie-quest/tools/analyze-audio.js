// "Listen" by MEASURING. Decode each track (node-web-audio-api decodes AAC/m4a) and compute its
// frequency profile: spectral centroid (brightness), band-energy split, a screech index (harsh
// 2-6kHz share) and a bass score. Turns "screechy/warm/bassy" into numbers I can check before sending.
const { OfflineAudioContext } = require("node-web-audio-api");
const fs = require("fs");
const files = process.argv.slice(2);

function fft(re, im){ const N=re.length;
  for(let i=1,j=0;i<N;i++){ let bit=N>>1; for(;j&bit;bit>>=1) j^=bit; j^=bit; if(i<j){ let t=re[i];re[i]=re[j];re[j]=t; t=im[i];im[i]=im[j];im[j]=t; } }
  for(let len=2;len<=N;len<<=1){ const ang=-2*Math.PI/len, wr=Math.cos(ang), wi=Math.sin(ang);
    for(let i=0;i<N;i+=len){ let cwr=1,cwi=0;
      for(let k=0;k<len/2;k++){ const ur=re[i+k],ui=im[i+k];
        const vr=re[i+k+len/2]*cwr-im[i+k+len/2]*cwi, vi=re[i+k+len/2]*cwi+im[i+k+len/2]*cwr;
        re[i+k]=ur+vr; im[i+k]=ui+vi; re[i+k+len/2]=ur-vr; im[i+k+len/2]=ui-vi;
        const n=cwr*wr-cwi*wi; cwi=cwr*wi+cwi*wr; cwr=n; } } } }

async function analyze(f){
  const buf=fs.readFileSync(f); const ab=buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength);
  const ctx=new OfflineAudioContext(1,44100,44100);
  const audio=await ctx.decodeAudioData(ab);
  const sr=audio.sampleRate, ch=audio.getChannelData(0), N=2048, hop=2048;
  const mag=new Float64Array(N/2); let frames=0,rmsAcc=0,rmsN=0; const maxS=Math.min(ch.length,sr*30);
  for(let s=0;s+N<=maxS;s+=hop){
    const re=new Float64Array(N), im=new Float64Array(N);
    for(let k=0;k<N;k++){ const w=0.5-0.5*Math.cos(2*Math.PI*k/(N-1)); re[k]=ch[s+k]*w; rmsAcc+=ch[s+k]*ch[s+k]; rmsN++; }
    fft(re,im);
    for(let k=0;k<N/2;k++) mag[k]+=Math.sqrt(re[k]*re[k]+im[k]*im[k]);
    frames++;
  }
  for(let k=0;k<N/2;k++) mag[k]/=frames;
  const binHz=sr/N, band=(lo,hi)=>{let e=0;for(let k=0;k<N/2;k++){const fq=k*binHz;if(fq>=lo&&fq<hi)e+=mag[k]*mag[k];}return e;};
  const sub=band(20,120),bass=band(120,400),lowMid=band(400,2000),pres=band(2000,6000),brill=band(6000,16000);
  const tot=sub+bass+lowMid+pres+brill||1; let cw=0,cm=0; for(let k=0;k<N/2;k++){cw+=(k*binHz)*mag[k];cm+=mag[k];}
  return { file:f, rms:+Math.sqrt(rmsAcc/rmsN).toFixed(4), centroid:Math.round(cw/cm),
    bassScore:+(100*(sub+bass)/tot).toFixed(1), screech:+(100*(pres+brill)/tot).toFixed(1),
    split:`${(100*sub/tot).toFixed(0)}/${(100*bass/tot).toFixed(0)}/${(100*lowMid/tot).toFixed(0)}/${(100*pres/tot).toFixed(0)}/${(100*brill/tot).toFixed(0)}` };
}
(async()=>{
  console.log("file".padEnd(28),"centroid","bass%","screech%"," sub/bass/lowMid/pres/brill");
  for(const f of files){ try{ const r=await analyze(f);
    console.log(r.file.padEnd(28), (r.centroid+"Hz").padEnd(8), String(r.bassScore).padEnd(5), String(r.screech).padEnd(8), " "+r.split);
  }catch(e){ console.log(f,"ERROR",e.message); } }
})();
