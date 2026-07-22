(function(){
"use strict";

var W=480, H=270, TILE=24, GY=H-TILE;      // GY = ground top surface

// Burn-to-play gate. FALSE = free preview (tap straight into the game) so the game stays
// playable while we build. The real burn flow is served by the dormant /api/nq/* backend;
// flip this to true (and wire the burn UI to those endpoints) to "put it together".
var BURN_GATE=false;

// Premium perk — PER-WORLD CHECKPOINTS. Beat a world's boss and a checkpoint is banked at the
// start of the NEXT world (registry nqCp = level index, nqCpScore = score). Dying later continues
// from the FURTHEST world reached instead of restarting the whole run — e.g. reach 4-3 and die,
// resume at 4-1 (not 2-1). Off = every death restarts from 1-1 (the free-preview behaviour, which
// is what makes the premium continue worth it). ENABLED now so it's testable in the free preview;
// set to `= BURN_GATE` (or false) to make it a paid-tier-only perk once burn goes live.
var PREMIUM_CHECKPOINTS = true;

// PREMIUM version flag — the paid/premium build (or a ?premium=1 link, remembered) grants LONGER
// Whale Mode + Cold Wallet durations. The free version keeps the shorter times; nothing else changes.
var PREMIUM = (function(){ try{ var q=((location.search||'')+(location.hash||'')); if(/[?&#](premium|prem)=1/i.test(q)){ try{ localStorage.setItem('nqPremium','1'); }catch(e){} return true; } return (typeof localStorage!=='undefined' && localStorage.getItem('nqPremium')==='1'); }catch(e){ return false; } })();
var WHALE_MS = PREMIUM?15000:8000, COLD_MS = PREMIUM?13000:7000;

// TEST BUILD — playtester dashboard. ?test=1 (query or hash) unlocks a LEVEL SELECT screen
// (jump straight to any level, no play-through) + a floating feedback widget that POSTs
// comments to /api/nq/feedback. The page is a hidden preview anyway; this flag just gates
// the tester-only UI so normal players never see it. Off = the game behaves exactly as before.
var TEST_MODE = (function(){ try{ return /[?&#]test=1(\b|$)/.test((location.search||'')+(location.hash||'')); }catch(e){ return false; } })();

// Character/enemy sprites (base64 injected at build time)
var SPRITES={ normie:'__NORMIE__', nrun1:'__NRUN1__', nrun2:'__NRUN2__', njump:'__NJUMP__', jeet:'__JEET__', paper:'__PAPER__', ghost:'__GHOST__', bot:'__BOT__', bitmaxi:'__BITMAXI__', fudster:'__FUDSTER__', wenlambo:'__WENLAMBO__', drinklady:'__DRINKLADY__', showlady:'__SHOWLADY__', lilnormie:'__LILNORMIE__' };
var POWERUPS={ diamond:'__DIAMOND__', bull:'__BULL__', moon:'__MOON__', caffeine:'__CAFFEINE__', candle:'__CANDLE__', solana:'__SOLANA__', omegachad:'__OMEGACHAD__', supergeek:'__SUPERGEEK__', whale:'__WHALE__', coldwallet:'__COLDWALLET__', megawhale:'__WHALE__' };
var EXTRA={ rugking:'__RUGKING__', rugkingdown:'__RUGKINGDOWN__', coin:'__COIN__', airdrop:'__AIRDROP__', key:'__KEY__', door:'__DOOR__', wormhole:'__WORMHOLE__', miniworm:'__MINIWORM__', slot:'__SLOT__', honeypot:'__HONEYPOT__', vegas:'__VEGAS__', scammykol:'__SCAMMYKOL__', skyline:'__SKYLINE__', ceoboss:'__CEOBOSS__', exchange:'__EXCHANGE__', wyrm:'__WYRM__', golem:'__GOLEM__', sacred:'__SACRED__', mines:'__MINES__', reaper:'__REAPER__', greatbear:'__GREATBEAR__', troll:'__TROLL__' };

// --- tiny Web-Audio sound engine: procedural arcade blips, zero assets ---
var _AC=null;
function _ac(){ try{ if(!_AC) _AC=new (window.AudioContext||window.webkitAudioContext)(); if(_AC.state==='suspended') _AC.resume(); }catch(e){} return _AC; }
// master EFFECTS bus — every SFX routes through this gain so the Effects slider can scale them all.
var _sfxVol=0.85, _sfxGain=null;
try{ if(typeof localStorage!=='undefined'){ var _sv=localStorage.getItem('nqSfxVol'); if(_sv!=null) _sfxVol=Math.max(0,Math.min(1,parseFloat(_sv)||0)); } }catch(e){}
function _sfxOut(){ var c=_ac(); if(!c) return null; if(!_sfxGain){ _sfxGain=c.createGain(); _sfxGain.gain.value=_sfxVol; _sfxGain.connect(c.destination); } return _sfxGain; }
function _setSfxVol(v){ _sfxVol=Math.max(0,Math.min(1,v)); if(_sfxGain) _sfxGain.gain.value=_sfxVol; try{ localStorage.setItem('nqSfxVol',String(_sfxVol)); }catch(e){} }
function _tone(f0,f1,dur,type,vol,when){ var c=_ac(); if(!c) return; var t=c.currentTime+(when||0); var o=c.createOscillator(),g=c.createGain(); o.type=type||'square'; o.frequency.setValueAtTime(f0,t); if(f1&&f1!==f0) o.frequency.linearRampToValueAtTime(f1,t+dur); g.gain.setValueAtTime(0.0001,t); g.gain.linearRampToValueAtTime(vol||0.1,t+0.01); g.gain.exponentialRampToValueAtTime(0.0001,t+dur); o.connect(g); g.connect(_sfxOut()||c.destination); o.start(t); o.stop(t+dur+0.02); }
function _seq(notes,type,vol){ var w=0; notes.forEach(function(n){ _tone(n[0],n[0],n[1],type,vol,w); w+=n[1]*0.9; }); }
// Embedded one-shot SFX SAMPLE (the real power-up .wav) — decoded once, played via WebAudio for low
// latency. Falls back to the synth chime if the asset marker wasn't injected or decode fails.
var _SFX_POWER_URI='__SFX_POWER__', _powerBuf=null, _powerTried=false;
function _loadSfx(){ if(_powerTried) return; var c=_ac(); if(!c) return; _powerTried=true;
  if(typeof _SFX_POWER_URI!=='string' || _SFX_POWER_URI.indexOf('data:')!==0) return;
  try{ var b64=_SFX_POWER_URI.split(',')[1], bin=atob(b64), n=bin.length, arr=new Uint8Array(n);
    for(var i=0;i<n;i++) arr[i]=bin.charCodeAt(i);
    c.decodeAudioData(arr.buffer, function(buf){ _powerBuf=buf; }, function(){}); }catch(e){} }
function _playSample(buf,vol){ var c=_ac(); if(!c||!buf) return false; try{ var s=c.createBufferSource(), g=c.createGain(); var v=(vol==null?0.55:vol), t=c.currentTime, cap=Math.min(buf.duration||1.5,1.5); g.gain.setValueAtTime(v,t); g.gain.setValueAtTime(v,t+Math.max(0.05,cap-0.3)); g.gain.exponentialRampToValueAtTime(0.0001,t+cap); s.buffer=buf; s.connect(g); g.connect(_sfxOut()||c.destination); s.start(t); s.stop(t+cap+0.02); return true; }catch(e){ return false; } }   // ~1.5s cap + fade (synced from a concurrent session's fix)
// Keep the Web-Audio context alive. iOS/Safari suspends it (screen lock, tab switch, or if it
// was never unlocked in a real tap) and will only RESUME inside a genuine user gesture — a
// resume() call from the game loop is ignored. So unlock/resume on ANY real interaction, and
// again whenever the tab becomes visible. This is why sound would "quit working" and not return.
function _unlockAudio(){ try{ var c=_ac(); if(!c) return; if(c.state==='suspended') c.resume();
  var o=c.createOscillator(), g=c.createGain(); g.gain.value=0.00008; o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime+0.03);   // silent blip fully unlocks iOS
  // Decode the power-up sample AFTER the unlock, off the gesture's critical path (a deferred timer),
  // so nothing about the sample can interfere with iOS's finicky unlock heuristic (which gates ALL sound).
  try{ setTimeout(_loadSfx,0); }catch(e){}
}catch(e){} }
if(typeof window!=='undefined'){
  ['pointerdown','touchstart','touchend','mousedown','keydown'].forEach(function(ev){ window.addEventListener(ev,_unlockAudio,{passive:true,capture:true}); });
  document.addEventListener('visibilitychange',function(){ if(!document.hidden){ try{ var c=_ac(); if(c&&c.state==='suspended') c.resume(); }catch(e){} } });
}
var SFX={
  jump:function(){ _tone(420,760,0.13,'square',0.08); },
  coin:function(){ _seq([[1760,0.045],[2637,0.13]],'sine',0.05); },   // Sonic-style ring "ti-TING" (two bright bell tones)
  stomp:function(){ _tone(320,80,0.12,'square',0.10); },
  hurt:function(){ _tone(300,110,0.26,'sawtooth',0.10); },
  key:function(){ _seq([[660,0.09],[990,0.09],[1320,0.16]],'square',0.08); },
  power:function(){ if(_powerBuf){ if(_playSample(_powerBuf,0.12)) return; } else { _loadSfx(); }   // real .wav sample once decoded (quieted to match the other SFX); synth chime meanwhile / as fallback
    _seq([[523,0.08],[659,0.08],[784,0.08],[1046,0.18]],'square',0.09); },
  boss:function(){ _tone(150,55,0.20,'sawtooth',0.12); },
  clear:function(){ _seq([[523,0.10],[784,0.10],[1046,0.24]],'square',0.09); },
  win:function(){ _seq([[523,0.12],[659,0.12],[784,0.12],[1046,0.12],[1319,0.30]],'square',0.10); }
};
try{ if(typeof window!=='undefined') window.__NQ_SFX={ loadSfx:function(){ _loadSfx(); }, hasPowerBuf:function(){ return !!_powerBuf; }, power:function(){ SFX.power(); }, setVol:function(v){ _setSfxVol(v); }, getVol:function(){ return _sfxVol; } }; }catch(e){}

/* ---------- Background music: original chiptune loops (WebAudio; per-world moods) ---------- */
// All melodies are ORIGINAL compositions in a retro 8-bit style — NOT copies of any real game tune.
// Routed through a dedicated low gain so SFX still sit on top. Loop-scheduled with a lookahead.
var NOTE={C3:130.81,D3:146.83,Eb3:155.56,E3:164.81,F3:174.61,G3:196.00,Ab3:207.65,A3:220.00,Bb3:233.08,B3:246.94,
  C4:261.63,D4:293.66,Eb4:311.13,E4:329.63,F4:349.23,Fs4:369.99,G4:392.00,Ab4:415.30,A4:440.00,Bb4:466.16,B4:493.88,
  C5:523.25,D5:587.33,Eb5:622.25,E5:659.25,F5:698.46,G5:783.99,A5:880.00,R:0};
var MUSIC=(function(){
  var ctx=null,gain=null,lp=null,cur=null,timer=null,nextAt=0,muted=false,phrase=0,noiseBuf=null; var N=NOTE;
  try{ muted=(typeof localStorage!=='undefined')&&localStorage.getItem('nqMute')==='1'; }catch(e){}
  // LO-FI / chill treatment (owner wanted the lo-fi bossa vibe — original melodies, no Mario notes,
  // so it's copyright-clean). Same A→B→A phrase alternation, but schedLoop renders it lo-fi: slower
  // tempo (TEMPO scale) + shuffle swing on the offbeats, a warm master low-pass, a soft jazzy chord
  // PAD (root+5+b7) sampled from the bass, and laid-back boom-bap drums. Master gain 0.06 so it sits
  // under the SFX. lead/bass are arrays-of-phrases; drums: 'full' | 'soft' | false.
  var TR={
    // World 1 — bright, bouncy platformer
    world1:{bpm:138,leadType:'square',drums:'full',
      lead:[ [[N.E4,.5],[N.G4,.5],[N.C5,.5],[N.G4,.5],[N.A4,.5],[N.C5,.5],[N.E5,.5],[N.C5,.5],[N.D5,.5],[N.B4,.5],[N.G4,.5],[N.D4,.5],[N.C4,1],[N.R,.5],[N.G4,.5]],
             [[N.C5,.5],[N.B4,.5],[N.A4,.5],[N.G4,.5],[N.E4,.5],[N.G4,.5],[N.A4,.5],[N.C5,.5],[N.D5,.5],[N.E5,.5],[N.G5,.5],[N.E5,.5],[N.C5,1],[N.R,.5],[N.E4,.5]] ],
      bass:[ [[N.C3,1],[N.G3,1],[N.A3,1],[N.E3,1],[N.F3,1],[N.C3,1],[N.G3,1],[N.G3,1]],
             [[N.F3,1],[N.C3,1],[N.G3,1],[N.G3,1],[N.A3,1],[N.E3,1],[N.F3,1],[N.G3,1]] ]},
    // Sand Lands — Zelda-like: modal, adventurous, a touch mysterious
    desert:{bpm:104,leadType:'square',drums:'soft',
      lead:[ [[N.A4,1],[N.B4,.5],[N.C5,.5],[N.D5,1],[N.C5,.5],[N.B4,.5],[N.A4,1.5],[N.E4,.5],[N.F4,1],[N.G4,1]],
             [[N.E4,1],[N.F4,.5],[N.G4,.5],[N.A4,1],[N.G4,.5],[N.F4,.5],[N.E4,1.5],[N.C4,.5],[N.D4,1],[N.E4,1]] ],
      bass:[ [[N.A3,1],[N.A3,1],[N.F3,1],[N.F3,1],[N.C3,1],[N.C3,1],[N.E3,1],[N.E3,1]],
             [[N.D3,1],[N.D3,1],[N.A3,1],[N.A3,1],[N.F3,1],[N.F3,1],[N.E3,1],[N.E3,1]] ]},
    // Normie Casino — fast, upbeat, playful
    casino:{bpm:158,leadType:'square',drums:'full',
      lead:[ [[N.C5,.25],[N.E5,.25],[N.G4,.25],[N.C5,.25],[N.A4,.25],[N.C5,.25],[N.F5,.25],[N.A4,.25],[N.G4,.25],[N.B4,.25],[N.D5,.25],[N.G4,.25],[N.C5,.5],[N.G4,.5]],
             [[N.E5,.25],[N.G5,.25],[N.E5,.25],[N.C5,.25],[N.A4,.25],[N.C5,.25],[N.E5,.25],[N.A4,.25],[N.F5,.25],[N.D5,.25],[N.B4,.25],[N.G4,.25],[N.C5,.5],[N.E5,.5]] ],
      bass:[ [[N.C3,.5],[N.G3,.5],[N.C3,.5],[N.G3,.5],[N.F3,.5],[N.C3,.5],[N.G3,.5],[N.G3,.5]],
             [[N.A3,.5],[N.E3,.5],[N.F3,.5],[N.C3,.5],[N.G3,.5],[N.G3,.5],[N.C3,.5],[N.G3,.5]] ]},
    // Skyline (World 3) — energetic, neon, driving
    skyline:{bpm:146,leadType:'square',drums:'full',
      lead:[ [[N.E4,.5],[N.B4,.5],[N.A4,.5],[N.E4,.5],[N.G4,.5],[N.D5,.5],[N.B4,.5],[N.G4,.5],[N.A4,.5],[N.E5,.5],[N.D5,.5],[N.B4,.5],[N.E5,1],[N.R,.5],[N.B4,.5]],
             [[N.E5,.5],[N.D5,.5],[N.B4,.5],[N.G4,.5],[N.A4,.5],[N.B4,.5],[N.D5,.5],[N.E5,.5],[N.G5,.5],[N.E5,.5],[N.D5,.5],[N.B4,.5],[N.A4,1],[N.R,.5],[N.E4,.5]] ],
      bass:[ [[N.E3,1],[N.E3,1],[N.C3,1],[N.C3,1],[N.G3,1],[N.G3,1],[N.A3,1],[N.B3,1]],
             [[N.C3,1],[N.C3,1],[N.G3,1],[N.G3,1],[N.A3,1],[N.A3,1],[N.E3,1],[N.B3,1]] ]},
    // The Exchange (World 4) — cold, minor, mechanical drive
    exchange:{bpm:132,leadType:'triangle',drums:'full',
      lead:[ [[N.A4,.5],[N.E4,.5],[N.A4,.5],[N.C5,.5],[N.B4,.5],[N.E4,.5],[N.B4,.5],[N.D5,.5],[N.C5,.5],[N.A4,.5],[N.E5,1],[N.C5,.5],[N.A4,1],[N.R,.5]],
             [[N.A4,.5],[N.C5,.5],[N.E5,.5],[N.C5,.5],[N.A4,.5],[N.C5,.5],[N.D5,.5],[N.B4,.5],[N.E5,.5],[N.D5,.5],[N.C5,1],[N.A4,.5],[N.E4,1],[N.R,.5]] ],
      bass:[ [[N.A3,.5],[N.A3,.5],[N.A3,.5],[N.E3,.5],[N.F3,.5],[N.F3,.5],[N.C3,.5],[N.G3,.5],[N.A3,.5],[N.A3,.5],[N.E3,.5],[N.E3,.5],[N.F3,.5],[N.C3,.5],[N.G3,.5],[N.G3,.5]],
             [[N.F3,.5],[N.F3,.5],[N.C3,.5],[N.C3,.5],[N.A3,.5],[N.A3,.5],[N.E3,.5],[N.E3,.5],[N.D3,.5],[N.D3,.5],[N.A3,.5],[N.A3,.5],[N.G3,.5],[N.G3,.5],[N.A3,.5],[N.E3,.5]] ]},
    // Boss — tense, urgent
    boss:{bpm:160,leadType:'sawtooth',drums:'full',
      lead:[ [[N.A4,.25],[N.Bb4,.25],[N.A4,.25],[N.E4,.25],[N.A4,.25],[N.C5,.25],[N.B4,.25],[N.A4,.25],[N.G4,.5],[N.Ab4,.5],[N.A4,.5],[N.R,.5]],
             [[N.A4,.25],[N.C5,.25],[N.E5,.25],[N.C5,.25],[N.B4,.25],[N.D5,.25],[N.B4,.25],[N.G4,.25],[N.A4,.5],[N.G4,.5],[N.F4,.5],[N.E4,.5]] ],
      bass:[ [[N.A3,.5],[N.A3,.5],[N.F3,.5],[N.F3,.5],[N.E3,.5],[N.E3,.5],[N.A3,.5],[N.G3,.5]],
             [[N.A3,.5],[N.A3,.5],[N.G3,.5],[N.G3,.5],[N.F3,.5],[N.F3,.5],[N.E3,.5],[N.E3,.5]] ]},
    // World 5 — Sacred Seeds: heroic, adventurous overworld (Zelda-nostalgic)
    sacred:{bpm:120,leadType:'square',drums:'soft',
      lead:[ [[N.D4,.5],[N.G4,.75],[N.A4,.25],[N.B4,.5],[N.G4,.5],[N.B4,.5],[N.D5,.75],[N.C5,.25],[N.B4,.5],[N.A4,.5],[N.G4,1],[N.R,.5],[N.D5,.5],[N.B4,1]],
             [[N.G4,.5],[N.B4,.75],[N.C5,.25],[N.D5,.5],[N.B4,.5],[N.D5,.5],[N.G5,.75],[N.E5,.25],[N.D5,.5],[N.B4,.5],[N.A4,1],[N.R,.5],[N.G4,.5],[N.D4,1]] ],
      bass:[ [[N.G3,1],[N.G3,1],[N.D3,1],[N.D3,1],[N.C3,1],[N.C3,1],[N.G3,1],[N.D3,1]],
             [[N.C3,1],[N.C3,1],[N.G3,1],[N.G3,1],[N.D3,1],[N.D3,1],[N.G3,1],[N.G3,1]] ]},
    // World 6 — Proof of Work / the Mines: calm, sparse, gentle (Minecraft-like), no drums
    mines:{bpm:92,leadType:'triangle',drums:false,
      lead:[ [[N.C5,1],[N.R,.5],[N.E5,1],[N.R,.5],[N.G4,1],[N.A4,.5],[N.G4,2],[N.R,1.5]],
             [[N.E5,1],[N.R,.5],[N.C5,1],[N.R,.5],[N.A4,1],[N.G4,.5],[N.F4,2],[N.R,1.5]] ],
      bass:[ [[N.C3,2],[N.A3,2],[N.F3,2],[N.G3,2]],
             [[N.A3,2],[N.F3,2],[N.C3,2],[N.G3,2]] ]}
  };
  function ensure(){ ctx=_ac(); if(!ctx) return false;
    if(!gain){ gain=ctx.createGain(); gain.gain.value=muted?0:0.06*musScale;
      lp=ctx.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=2600; lp.Q.value=0.7;   // warm, lo-fi tone
      gain.connect(lp); lp.connect(ctx.destination); }
    if(!noiseBuf){ var n=Math.floor(ctx.sampleRate*0.4); noiseBuf=ctx.createBuffer(1,n,ctx.sampleRate); var d=noiseBuf.getChannelData(0); for(var i=0;i<n;i++) d[i]=Math.random()*2-1; }
    return true; }
  function note(f,at,dur,type,vol){ if(!f) return; var o=ctx.createOscillator(),g=ctx.createGain(); o.type=type; o.frequency.value=f;
    g.gain.setValueAtTime(0.0001,at); g.gain.linearRampToValueAtTime(vol,at+0.04);       // softer attack
    g.gain.exponentialRampToValueAtTime(0.0001,at+Math.max(0.08,dur*1.0));                // longer, mellow release
    o.connect(g); g.connect(gain); o.start(at); o.stop(at+dur+0.06); }
  function padChord(root,at,dur){ var m=[1,1.4983,1.7818,2];   // root + 5th + b7 + octave: a soft jazzy bed, safe over major AND minor
    for(var i=0;i<m.length;i++){ var o=ctx.createOscillator(),g=ctx.createGain(); o.type='sine'; o.frequency.value=root*m[i];
      g.gain.setValueAtTime(0.0001,at); g.gain.linearRampToValueAtTime(0.03,at+0.12); g.gain.setValueAtTime(0.03,at+dur*0.55); g.gain.exponentialRampToValueAtTime(0.0001,at+dur*0.98);
      o.connect(g); g.connect(gain); o.start(at); o.stop(at+dur+0.05); } }
  function drum(at,kind){
    if(kind==='kick'){ var o=ctx.createOscillator(),g=ctx.createGain(); o.type='sine';
      o.frequency.setValueAtTime(140,at); o.frequency.exponentialRampToValueAtTime(46,at+0.13);
      g.gain.setValueAtTime(0.16,at); g.gain.exponentialRampToValueAtTime(0.0001,at+0.17);
      o.connect(g); g.connect(gain); o.start(at); o.stop(at+0.19); return; }
    var s=ctx.createBufferSource(); s.buffer=noiseBuf; var f=ctx.createBiquadFilter(), g2=ctx.createGain();
    if(kind==='hat'){ f.type='highpass'; f.frequency.value=8000; g2.gain.setValueAtTime(0.026,at); g2.gain.exponentialRampToValueAtTime(0.0001,at+0.03); }
    else { f.type='bandpass'; f.frequency.value=2200; f.Q.value=1.2; g2.gain.setValueAtTime(0.06,at); g2.gain.exponentialRampToValueAtTime(0.0001,at+0.11); }   // soft rim/snare
    s.connect(f); f.connect(g2); g2.connect(gain); s.start(at); s.stop(at+0.18); }
  var SWING=0.09, TEMPO=0.72;   // lo-fi feel: slower overall tempo + a shuffle nudge on the offbeats
  function schedLoop(tr,at){ var spb=60/(tr.bpm*TEMPO);
    var lead=tr.lead[phrase % tr.lead.length], bass=tr.bass[phrase % tr.bass.length];
    var lt=at, off=0, bt=at, segs=[];
    lead.forEach(function(n){ var fr=off-Math.floor(off), sw=(Math.abs(fr-0.5)<0.02)?SWING*spb:0;   // swing the offbeat 8ths
      note(n[0], lt+sw, n[1]*spb*0.92, tr.leadType, 0.10); lt+=n[1]*spb; off+=n[1]; });
    bass.forEach(function(n){ if(n[0]) segs.push({t:bt,f:n[0]}); note(n[0],bt,n[1]*spb*0.96,'triangle',0.14); bt+=n[1]*spb; });
    var dur=Math.max(lt,bt)-at;
    // warm chord pad on a 2-beat grid (root sampled from the bass) — the lo-fi bed under everything
    var grid=2*spb; for(var pt=at; pt<at+dur-0.01; pt+=grid){ var root=segs.length?segs[0].f:null;
      for(var si=0;si<segs.length;si++){ if(segs[si].t<=pt+0.001) root=segs[si].f; }
      if(root) padChord(root, pt, Math.min(grid, at+dur-pt)); }
    // laid-back drums: kick on the 1, soft rim on the backbeat, brushed hats with swing
    if(tr.drums){ var beats=Math.max(1,Math.round(dur/spb));
      for(var b=0;b<beats;b++){ var t0=at+b*spb;
        if(b%4===0) drum(t0,'kick');
        if(tr.drums==='full'){ if(b%2===1) drum(t0,'snare'); drum(t0,'hat'); drum(t0+spb*0.5+SWING*spb,'hat'); }
        else { drum(t0+spb*0.5+SWING*spb,'hat'); }
      } }
    phrase++;
    return dur; }
  function tick(){ if(!cur||!ensure()) return; var tr=TR[cur]; if(!tr) return; var now=ctx.currentTime;
    var guard=0; while(nextAt<now+1.0 && guard++<8){ nextAt+=schedLoop(tr,nextAt); } }
  function synthPlay(name){ if(!TR[name]) return; if(!ensure()) return; var fresh=(name!==cur); cur=name;
    if(fresh){ phrase=0; nextAt=ctx.currentTime+0.05; } if(!timer) timer=setInterval(tick,240); tick(); }
  function synthStop(){ cur=null; }

  // ---- PRODUCED-TRACK STREAMER --------------------------------------------------------------
  // If a real, owned/licensed track exists at /normie-quest/music/<name>.mp3 (or .ogg), stream it
  // (looping, cross-faded between worlds) and mute the synth. If it's missing or fails to load, the
  // synth above keeps playing — so the game always has music and the produced tracks are drop-in.
  // The synth starts INSTANTLY on every play() and the file cross-fades in once it's buffered, so a
  // track swap is seamless and there's never a silent gap.
  var MUSIC_BASE='/normie-quest/music/', EXTS=['mp3','m4a','mp4','ogg','wav'], els={}, missing={}, want=null, curEl=null, streaming=false;
  var MUSIC_VOL=0.18, musScale=1;   // produced tracks sit QUIETLY under the game SFX; musScale = the Music slider (0..1)
  try{ if(typeof localStorage!=='undefined'){ var _mv=localStorage.getItem('nqMusVol'); if(_mv!=null) musScale=Math.max(0,Math.min(1,parseFloat(_mv)||0)); } }catch(e){}
  function effVol(){ return MUSIC_VOL*musScale; }
  function elVol(el,v){ try{ el.volume=Math.max(0,Math.min(1,v)); }catch(e){} }
  function fade(el,to,ms,done){ if(!el){ if(done) done(); return; } if(el._fi) clearInterval(el._fi);
    var from=(typeof el.volume==='number'?el.volume:0), t0=Date.now();
    el._fi=setInterval(function(){ var k=ms>0?Math.min(1,(Date.now()-t0)/ms):1; elVol(el, from+(to-from)*k);
      if(k>=1){ clearInterval(el._fi); el._fi=null; if(done) done(); } }, 40); }
  function makeEl(name){ var el=els[name]; if(el) return el;
    el=new Audio(); el.loop=true; el.preload='auto'; el.volume=0; el._ext=0; el.src=MUSIC_BASE+name+'.'+EXTS[0]; els[name]=el;
    el.addEventListener('error',function(){ if(el._ext<EXTS.length-1){ el._ext++; el.src=MUSIC_BASE+name+'.'+EXTS[el._ext]; el.load(); } else { missing[name]=true; } });
    return el; }
  function tryFile(name){ if(missing[name]) return; var el=makeEl(name);
    var go=function(){ if(want!==name||missing[name]) return;
      streaming=true; synthStop();                                   // real track takes over → silence the synth
      if(curEl && curEl!==el){ var old=curEl; fade(old,0,700,function(){ try{old.pause();}catch(e){} }); }
      curEl=el; try{ el.currentTime=0; }catch(e){}
      var p=el.play(); if(p&&p.catch) p.catch(function(){ missing[name]=true; streaming=false; if(want===name) synthPlay(name); });
      fade(el, muted?0:effVol(), 700); };
    if(el.readyState>=3) go(); else el.addEventListener('canplaythrough',go,{once:true}); }
  function playInternal(name){ if(!TR[name]) return; if(name===want) return; want=name;
    streaming=false;
    if(curEl){ var old=curEl; curEl=null; fade(old,0,450,function(){ try{old.pause();}catch(e){} }); }
    synthPlay(name);            // instant sound
    tryFile(name); }            // …upgraded to the produced track if one exists
  // NORMIE'S BAD BEATS — the player can lock a "channel" (a specific track) that plays everywhere,
  // or leave it on AUTO (the per-world theme). Persisted in localStorage.
  var channel='auto', lastWorld='world1';
  try{ channel=(typeof localStorage!=='undefined'&&localStorage.getItem('nqChannel'))||'auto'; }catch(e){}
  var CHANNELS=[['auto','AUTO · per world'],['world1','MAIN THEME'],['desert','SAND LANDS'],['casino','CASINO'],['skyline','SKYLINE'],['exchange','THE EXCHANGE'],['sacred','THE BRIDGE'],['mines','THE DEPEG'],['boss','BOSS RUSH']];
  return {
    play:playInternal,
    forWorld:function(name){ if(TR[name]) lastWorld=name; playInternal(channel==='auto'?name:channel); },   // world/boss triggers route here
    setChannel:function(name){ channel=(name==='auto'||TR[name])?name:'auto'; try{ localStorage.setItem('nqChannel',channel); }catch(e){} playInternal(channel==='auto'?lastWorld:channel); return channel; },
    getChannel:function(){ return channel; },
    channels:function(){ return CHANNELS; },
    stop:function(){ want=null; synthStop(); streaming=false; if(curEl){ var old=curEl; curEl=null; fade(old,0,300,function(){ try{old.pause();}catch(e){} }); } },
    // Tab hidden / browser minimized → pause the produced track (HTMLAudio keeps playing otherwise);
    // the WebAudio synth + SFX auto-suspend by browser policy. Resume the same track on return.
    suspend:function(){ try{ synthStop(); }catch(e){} if(curEl){ try{ curEl.pause(); }catch(e){} } },
    resume:function(){ if(muted) return; if(curEl && streaming){ var p=curEl.play(); if(p&&p.catch) p.catch(function(){}); } else if(want && !streaming){ try{ synthPlay(want); }catch(e){} } },
    toggle:function(){ muted=!muted; if(gain) gain.gain.value=muted?0:0.06*musScale; if(curEl) fade(curEl,muted?0:effVol(),150); try{ localStorage.setItem('nqMute',muted?'1':'0'); }catch(e){} return muted; },
    muted:function(){ return muted; },
    setVol:function(s){ musScale=Math.max(0,Math.min(1,s)); if(gain) gain.gain.value=muted?0:0.06*musScale; if(curEl) fade(curEl,muted?0:effVol(),120); try{ localStorage.setItem('nqMusVol',String(musScale)); }catch(e){} },
    getVol:function(){ return musScale; },
    state:function(){ return { want:want, streaming:streaming, missing:Object.keys(missing), channel:channel }; }   // observability / tests
  };
})();
try{ if(typeof window!=='undefined') window.__NQ_MUSIC=MUSIC; }catch(e){}
// Pause music when the tab is hidden / browser minimized; resume on return (HTMLAudio doesn't stop on its own).
try{ if(typeof document!=='undefined') document.addEventListener('visibilitychange',function(){ try{ if(document.hidden) MUSIC.suspend(); else MUSIC.resume(); }catch(e){} }); }catch(e){}

var C={ ink:0x0d0b1e, coin:0xffd23f, coinDk:0xb8860b, danger:0xff3860, phos:0x3dff6e, white:0xffffff,
        dirt:0x8a5a2b, dirtDk:0x5e3c1a, grass:0x3dff6e, grassDk:0x1da84a,
        brick:0x6b4a8f, brickDk:0x3f2a5c, mover:0x9aa04e, moverDk:0x4a4f1a,
        spike:0xc2c9d4, spikeDk:0x6a7280 };

var THEMES=[
  { sky1:0x241a52, sky2:0x120c2e, hill:0x2a1e5c },   // 1-1 dusk purple
  { sky1:0x123a4a, sky2:0x0a1c2e, hill:0x1e4a5c },   // 1-2 teal cavern
  { sky1:0x3a1226, sky2:0x1e0a14, hill:0x5c1e34 },   // 1-3 crimson keep
  { sky1:0x8a4a1e, sky2:0x2a1408, hill:0x6e3c14 },   // 2-3 dusk desert (WORMHOLE arena)
  { sky1:0x4a1a5c, sky2:0x1e0a2e, hill:0x6e2a7c },   // 2-2 Normie Casino (neon purple)
  { sky1:0x172a4a, sky2:0x0a0e1e, hill:0x243a63 },   // 3-x The Skyline / Crypto Twitter (night blue)
  { sky1:0x0e2436, sky2:0x05101a, hill:0x143246 },   // 4-x The Exchange / CEX vault (cold steel cyan)
  { sky1:0x1a2438, sky2:0x07050c, hill:0x241a30 },    // 5-x The Bridge (cross-chain span over a dark chasm/void)
  { sky1:0x123a34, sky2:0x061412, hill:0x1e5c4e },    // 6-x The Depeg (stablecoin — sterile dark teal-green, mint ground)
  { sky1:0x143a1c, sky2:0x06140a, hill:0x2e7a34 },    // 7-x The Yield Farm (lush neon-green DeFi farm, gold accents)
  { sky1:0x3a0e10, sky2:0x160406, hill:0x5c1418 },    // 8-x The Bear Market (blood-red down-cycle finale)
  { sky1:0x0a1410, sky2:0x02060a, hill:0x0e2e22 },    // 11 CRYPTO TRENCHES (hidden world — near-black, toxic-green data glow)
  { sky1:0x241a08, sky2:0x0e0a02, hill:0x4a3410 }     // 12 THE VAULT (hidden speakeasy back-room — dim gold)
];

// Slot-machine themes — one 'slot' sprite, re-skinned per theme (tint + glow + reel symbols +
// prompt). def.slotTheme picks one; default 'casino'. All symbols must be loaded texture keys.
var SLOT_THEMES={
  casino: { syms:['coin','solana','diamond','candle','moon'], tint:0xffffff, glow:0xff44cc, box:0xffd23f, txt:'#ffd23f', label:'FIRE IT IN', name:'NORMIE CASINO' },
  lucky7: { syms:['coin','diamond','candle','moon','airdrop'], tint:0xffdf8a, glow:0xffcf3a, box:0xffcf3a, txt:'#ffd23f', label:'SPIN TO WIN', name:'LUCKY 7s' },
  degen:  { syms:['solana','moon','candle','coin','bull'],   tint:0x9bffb0, glow:0x2ee66e, box:0x3dff6e, txt:'#3dff6e', label:'APE IN',     name:'DEGEN REELS' },
  diamond:{ syms:['diamond','coin','solana','moon','candle'],tint:0xbfe8ff, glow:0x66ddff, box:0x66ddff, txt:'#66ddff', label:'HOLD & SPIN', name:'DIAMOND SLOTS' },
  moonshot:{syms:['moon','solana','candle','coin','bull'],   tint:0xd9b8ff, glow:0xb06bff, box:0xb06bff, txt:'#c99bff', label:'SEND IT',    name:'MOONSHOT' },
  // HIDDEN big-paying machines (speakeasy / trenches). big=true → jackpot-scale payouts + more credits.
  jackpot:{ syms:['diamond','moon','coin','solana','bull'],  tint:0xffe08a, glow:0xffcf3a, box:0xffcf3a, txt:'#ffd23f', label:'PULL THE LEVER', name:'JACKPOT VAULT', big:true, mult:7, spins:5 },
  trench: { syms:['coin','diamond','solana','moon','bull'],  tint:0x9bffcf, glow:0x2effa0, box:0x2effa0, txt:'#2effa0', label:'ALL IN',        name:'TRENCH JACKPOT', big:true, mult:11, spins:6 }
};

// LEVELS — plat:[x,count,topY]  wall:[x,heightTiles]  enemy:[kind,x,y,range]
//          spike:[x]  coin:[x,y]  key:[x,y]  door:x
// Design rule: ground enemies at y~230 patrol the RUNNING LANE (you must stomp or
// jump them); ghosts fly at y~212 (head height — jump over or stomp); wall columns
// force jumps. No running under everything. Difficulty escalates 1-1 -> 1-3.
var LEVELS=[
  { name:'1-1', sub:'FIRST STEPS', time:110, theme:0, width:5200,
    gaps:[[860,960],[1720,1820],[2560,2660],[3360,3460],[4200,4300]],
    walls:[[480,2,'crate',4],[1240,3,'stone',4],[2080,2,'steel',5],[2920,3,'brick',4],[3720,2,'crate',5],[4560,3,'stone',4]],
    plats:[[880,2,H-96,'brick'],[1560,2,H-130,'stone'],[1740,2,H-96,'stone'],[2580,2,H-96,'steel'],[3380,2,H-96,'brick'],[4220,2,H-96,'crate']],
    spikes:[],
    powerups:[['bull',1140,230],['solana',2440,230],['caffeine',3160,230],['candle',2400,230]],
    airdrops:[[1180,H-118],[3260,H-72]],
    coins:[[492,182],[540,182],[780,196],[1252,158],[1300,158],[1600,196],[2092,182],[2140,182],[2188,182],[2500,196],[2932,158],[2980,158],[3560,196],[3732,182],[3780,182],[3828,182],[4620,158],[4900,196]],
    enemies:[['jeet',340,230,110],['jeet',680,230,70],['ghost',1000,212,90],['jeet',1080,230,130],['jeet',1500,230,110],['jeet',1960,230,110],['jeet',2400,230,80],['ghost',2760,212,90],['jeet',2820,230,90],['jeet',3200,230,100],['ghost',3600,212,90],['jeet',4100,230,70]],
    npcs:[[1500,90]],
    bonusblocks:[[1180,5],[2700,8],[4120,8]],
    key:[1584,H-150], door:5080 },

  { name:'1-2', sub:'FUD RISING', time:120, theme:1, width:5800,
    gaps:[[820,940],[1640,1760],[2480,2600],[3300,3420],[4200,4320],[5000,5100]],
    walls:[[460,3,'steel',4],[1300,3,'stone',4],[2200,4,'steel',3],[3000,3,'brick',4],[3900,3,'stone',4],[4800,3,'steel',4]],
    plats:[[840,2,H-96,'crate'],[1600,2,H-130,'brick'],[1660,2,H-96,'stone'],[2140,2,H-120,'steel'],[2500,2,H-96,'steel'],[3320,2,H-96,'brick'],[4220,2,H-96,'stone']],
    spikes:[[1000],[1024],[2760],[2784],[4560],[4584]],
    powerups:[['diamond',1160,230],['solana',2000,230],['moon',3520,H-134],['caffeine',4140,230]],
    airdrops:[[1200,H-118],[3500,H-72]],
    coins:[[472,158],[520,158],[700,196],[1312,158],[1360,158],[1500,196],[2212,134],[2260,134],[2680,196],[3012,158],[3060,158],[3600,196],[3912,158],[3960,158],[4500,196],[4812,158],[4860,158],[5300,196]],
    enemies:[['paper',340,230,100],['jeet',700,230,70],['ghost',1000,212,80],['paper',1120,230,90],['paper',1500,230,100],['ghost',1900,212,90],['jeet',2400,230,80],['paper',2680,230,70],['ghost',2900,212,90],['paper',3220,230,70],['bot',3600,230,80],['ghost',3820,212,90],['paper',4120,230,90],['bot',4500,230,80]],
    bonusblocks:[[980,5],[1950,8],[2950,5],[4020,8],[4960,8]],
    key:[1624,H-150], door:5680 },

  { name:'1-3', sub:"THE RUG KING'S KEEP", time:135, theme:2, width:6400, boss:true,
    gaps:[[780,900],[1620,1740],[2440,2560],[3260,3380],[4120,4240],[4980,5100],[5900,6000]],
    walls:[[440,3,'steel',4],[1240,4,'stone',4],[2100,3,'crate',5],[2960,4,'steel',4],[3820,3,'brick',5],[4680,4,'stone',4],[5500,3,'crate',4]],
    plats:[[800,2,H-96,'stone'],[1140,2,H-130,'stone'],[1640,2,H-96,'crate'],[2460,2,H-96,'steel'],[3280,2,H-96,'brick'],[3500,2,H-140,'steel'],[4140,2,H-96,'stone'],[5000,2,H-96,'crate']],
    spikes:[[1000],[1024],[2000],[2024],[3600],[3624],[4400],[4424]],
    powerups:[['moon',960,230],['solana',2300,230],['diamond',3720,H-124],['candle',5200,H-120]],
    airdrops:[[2300,H-118],[4200,H-72]],
    coins:[[452,158],[500,158],[700,196],[1252,134],[1300,134],[1400,196],[2112,158],[2160,158],[2208,158],[2680,196],[2972,134],[3020,134],[3200,196],[3832,158],[3880,158],[3928,158],[4692,134],[4740,134],[5512,158],[5560,158],[6100,196]],
    enemies:[['bot',340,230,90],['paper',660,230,70],['ghost',900,212,70],['bot',1140,230,90],['ghost',1500,212,90],['paper',1560,230,80],['bot',1960,230,60],['ghost',2340,212,90],['paper',2680,230,70],['bot',2760,230,70],['ghost',3140,212,90],['bot',3480,230,80],['bot',4000,230,70],['ghost',4300,212,90],['paper',4560,230,90],['bot',5300,230,70],['ghost',5700,212,90]],
    bonusblocks:[[1120,5],[2600,8],[3960,8],[5140,8]],
    key:[1164,H-150], door:6300 },

  // WORLD 2 — the Sand Lands. Desert stage with green mini-worm hazards.
  { name:'2-1', sub:'THE SAND LANDS', time:120, theme:3, width:5200,
    gaps:[[900,1000],[1800,1900],[2800,2900],[3800,3900]],
    walls:[[500,3,'stone',4],[1300,3,'steel',3],[2200,4,'stone',3],[3100,3,'steel',4],[4200,3,'stone',3]],
    plats:[[950,2,H-96,'stone'],[1600,2,H-130,'stone'],[1850,2,H-96,'steel'],[2850,2,H-96,'stone'],[3850,2,H-96,'steel']],
    spikes:[],
    powerups:[['supergeek',1500,230],['diamond',1950,230],['moon',3400,230],['candle',2200,230]],
    airdrops:[[1200,H-72],[3600,H-72]],
    coins:[[512,158],[560,158],[800,196],[1312,158],[1360,158],[1700,196],[2212,134],[2260,134],[2650,196],[3112,158],[3160,158],[3700,196],[4212,158],[4260,158],[4800,196]],
    enemies:[['bot',360,230,90],['paper',680,230,70],['ghost',1100,212,80],['fudster',1650,230,60],['bitmaxi',2050,230,110],['ghost',2400,212,90],['bot',2600,230,80],['paper',3300,230,70],['sniper',3650,230,36],['bot',4000,230,80],['bitmaxi',4400,230,110]],
    miniworms:[1150,3550,4700], honeypots:[[2700,232]], npcs:[[2450,90]],
    bonusblocks:[[1180,5],[2650,8],[4120,8]],
    caches:[[2500,GY-20,150]],
    key:[1600,H-150], door:5080 },

  // WORLD 2 — Normie Casino: a normal stage with a slot machine you "fire it in" for bonus coins.
  { name:'2-2', sub:'NORMIE CASINO', time:130, theme:4, width:5200,
    gaps:[[900,1000],[1900,2000],[3000,3100],[4200,4300]],
    walls:[[500,3,'brick',4],[1300,3,'steel',3],[2400,4,'brick',3],[3300,3,'steel',4],[4450,3,'brick',4]],
    plats:[[950,2,H-96,'brick'],[1950,2,H-96,'steel'],[3050,2,H-96,'brick'],[1650,2,H-130,'steel'],[4250,2,H-96,'steel']],
    spikes:[],
    powerups:[['supergeek',2500,230],['omegachad',3600,230],['candle',2200,230],['bull',4800,230]],
    airdrops:[[1200,H-72],[3900,H-72]],
    coins:[[512,158],[560,158],[750,196],[1312,158],[1360,158],[1600,150],[1700,196],[2412,134],[2460,134],[3312,158],[3360,158],[3600,150],[3900,196],[4462,158],[4510,158],[4900,196]],
    enemies:[['bot',360,230,90],['paper',680,230,70],['ghost',1120,212,80],['fudster',1400,230,90],['bot',1520,230,90],['paper',2600,230,70],['ghost',2850,212,90],['bitmaxi',3250,230,110],['bot',3500,230,80],['paper',3900,230,70],['sniper',4600,230,36],['bitmaxi',4950,230,110]],
    bgImage:'vegas',
    slots:[[700,'casino'],[2150,'lucky7'],[2900,'degen'],[3450,'diamond'],[4700,'moonshot']],
    honeypots:[[2700,232],[3900,232]], pumpdumps:[[1600,174],[3600,174]], npcs:[[1100,80]],
    casinoFolk:[[1450,'drink',70],[2250,'show',40],[3800,'drink',70],[4550,'show',50]],
    bonusblocks:[[820,5],[1680,8],[2700,5],[3530,8],[4420,8]],
    key:[1650,H-150], door:5080 },

  // WORLD 2 boss arena (level 2-1 will slot in BEFORE this once built). Flat desert arena:
  // grab the key, reach the portal, and the WORMHOLE erupts. Weak point = the blue back shards.
  { name:'2-3', sub:'THE WORMHOLE', time:140, theme:3, width:2500, boss:true, bossType:'wormhole',
    gaps:[[650,750],[1250,1350]],
    walls:[[420,2,'stone',3],[980,2,'steel',3]],
    plats:[[670,2,H-96,'stone'],[1270,2,H-96,'steel'],[1900,2,H-104,'stone'],[2180,2,H-96,'stone']],
    spikes:[], powerups:[['candle',1560,H-124]], airdrops:[[2050,H-72]],
    coins:[[300,196],[860,196],[1550,196],[1912,158],[2192,158],[2350,196]],
    enemies:[['sniper',300,230,30]], miniworms:[520,1080,1480], pumpdumps:[[900,174]],
    bonusblocks:[[610,5],[1120,8],[1570,8],[2000,8]],
    key:[1060,H-140], door:2380 },

  // WORLD 3 — Crypto Twitter / The Skyline. Neon rooftops; the Scammy KOL waits at the top.
  { name:'3-1', sub:'THE ROOFTOPS', time:135, theme:5, width:5800, bgImage:'skyline',
    gaps:[[820,940],[1640,1760],[2480,2600],[3300,3420],[4200,4320],[5000,5100]],
    walls:[[460,3,'steel',4],[1300,3,'stone',4],[2200,4,'steel',3],[3000,3,'brick',4],[3900,3,'stone',4],[4800,3,'steel',4]],
    plats:[[840,2,H-96,'crate'],[1600,2,H-130,'brick'],[1660,2,H-96,'stone'],[2140,2,H-120,'steel'],[2500,2,H-96,'steel'],[3320,2,H-96,'brick'],[4220,2,H-96,'stone']],
    spikes:[[1000],[1024],[2760],[2784],[4560],[4584]],
    powerups:[['moon',3200,230],['omegachad',4000,230],['bull',4600,230],['candle',2800,230]],
    airdrops:[[1200,H-118],[3500,H-72]],
    coins:[[472,158],[520,158],[700,196],[1312,158],[1360,158],[1500,196],[2212,134],[2260,134],[2680,196],[3012,158],[3060,158],[3600,196],[3912,158],[3960,158],[4500,196],[4812,158],[4860,158],[5300,196]],
    enemies:[['jeet',340,230,80],['bot',680,230,60],['ghost',1050,212,80],['fudster',1150,230,60],['sniper',1900,230,30],['bitmaxi',2380,230,70],['bot',2800,230,70],['ghost',2820,212,60],['sniper',3150,230,30],['fudster',3600,230,70],['bitmaxi',4100,230,70],['bot',4500,230,70],['ghost',4700,212,90]],
    pumpdumps:[[1500,174],[3700,174]], honeypots:[], npcs:[[2900,90]],
    bonusblocks:[[1280,5],[2950,'moon'],[4620,8]],
    warps:[[3620,25]],
    key:[1624,H-150], door:5680 },

  { name:'3-2', sub:'THE TIMELINE', time:145, theme:5, width:6400, bgImage:'skyline',
    gaps:[[780,900],[1620,1740],[2440,2560],[3260,3380],[4120,4240],[4980,5100],[5900,6000]],
    walls:[[440,3,'steel',4],[1240,4,'stone',4],[2100,3,'crate',5],[2960,4,'steel',4],[3820,3,'brick',5],[4680,4,'stone',4],[5500,3,'crate',4]],
    plats:[[800,2,H-96,'stone'],[1140,2,H-130,'stone'],[1640,2,H-96,'crate'],[2460,2,H-96,'steel'],[3280,2,H-96,'brick'],[3500,2,H-140,'steel'],[4140,2,H-96,'stone'],[5000,2,H-96,'crate']],
    spikes:[[1000],[1024],[2000],[2024],[3600],[3624],[4400],[4424]],
    powerups:[['supergeek',1400,230],['omegachad',4400,230],['bull',5250,230],['candle',3150,230]],
    airdrops:[[2300,H-118],[4200,H-72]],
    coins:[[452,158],[500,158],[700,196],[1252,134],[1300,134],[1400,196],[2112,158],[2160,158],[2208,158],[2680,196],[2972,134],[3020,134],[3200,196],[3832,158],[3880,158],[3928,158],[4692,134],[4740,134],[5512,158],[5560,158],[6100,196]],
    enemies:[['bot',340,230,70],['jeet',600,230,60],['ghost',1000,212,80],['fudster',1400,230,70],['sniper',1900,230,30],['bitmaxi',2250,230,70],['bot',2700,230,70],['ghost',3200,212,70],['sniper',3450,230,30],['fudster',3650,230,70],['bitmaxi',4000,230,70],['bot',4400,230,70],['ghost',4820,212,80],['sniper',5250,230,30],['bitmaxi',5650,230,60]],
    pumpdumps:[[1000,174],[3500,174],[5300,174]], honeypots:[[2350,232]], npcs:[[3150,90]],
    bonusblocks:[[1000,5],[2080,8],[3220,5],[4370,8],[5480,8]],
    key:[1164,H-150], door:6300 },

  // WORLD 3 boss level — a LONG, HARD gauntlet up the skyline, THEN the Scammy KOL at the door.
  // The "-3" levels are the tough ones: dense snipers/hazards + tricky jumps to even reach the boss.
  { name:'3-3', sub:'THE SCAMMY KOL', time:175, theme:5, width:4800, boss:true, bossType:'kol', bgImage:'skyline',
    gaps:[[700,820],[1380,1500],[2060,2180],[2720,2840],[3380,3500]],
    walls:[[420,3,'steel',4],[1060,4,'stone',3],[1680,3,'brick',5],[2320,4,'steel',3],[2980,3,'stone',5],[3640,4,'steel',3]],
    plats:[[720,2,H-96,'steel'],[1080,2,H-140,'brick'],[1400,2,H-96,'stone'],[2080,2,H-96,'steel'],[2360,2,H-120,'steel'],[2740,2,H-96,'brick'],[3400,2,H-96,'steel'],[3680,2,H-134,'steel']],
    spikes:[[900],[924],[1580],[1604],[2440],[2464],[3200],[3224]],
    powerups:[['supergeek',1000,230],['diamond',1850,230],['omegachad',2620,230],['bull',3300,230]],
    airdrops:[[1500,H-118],[3100,H-72]],
    coins:[[300,196],[560,150],[620,196],[900,196],[1160,140],[1420,150],[1620,196],[1950,150],[2200,196],[2500,150],[2760,150],[2900,196],[3150,150],[3400,150],[3760,150],[4000,196],[4200,150]],
    enemies:[['jeet',340,230,70],['sniper',620,230,30],['bot',900,230,60],['fudster',1150,230,60],['ghost',1300,212,80],['sniper',1600,230,30],['bitmaxi',1950,230,70],['bot',2200,230,70],['sniper',2600,230,30],['fudster',2900,230,70],['ghost',3200,212,70],['bitmaxi',3300,230,70],['sniper',3600,230,30],['bot',3900,230,60],['ghost',4100,212,80]],
    pumpdumps:[[1380,174],[2720,174]], honeypots:[[1250,232],[3760,232]], npcs:[[2450,90]],
    bonusblocks:[[940,5],[1950,8],[2950,8],[3840,8]],
    key:[4200,H-150], door:4600 },

  // WORLD 4 — THE EXCHANGE (the CEX that freezes your funds). Cold steel-blue vault; obstacles get
  // TALLER + WIDER here (walls 4-5 tall, 5-6 wide) — double-jump / Bull to clear them. Boss = the
  // Custodian (corrupt exchange CEO): stomp him x3 while he flings "frozen withdrawal" locks.
  { name:'4-1', sub:'THE ONBOARDING', time:150, theme:6, width:6000, bgImage:'exchange',
    gaps:[[860,980],[1700,1820],[2560,2680],[3400,3520],[4240,4360],[5080,5180]],
    walls:[[460,4,'steel',5],[1300,4,'steel',4],[2200,4,'steel',4],[3020,4,'stone',5],[3920,4,'steel',4],[4820,4,'steel',5]],
    plats:[[840,2,H-96,'steel'],[1180,2,H-130,'steel'],[1660,2,H-96,'stone'],[2140,2,H-110,'steel'],[2500,2,H-96,'steel'],[3320,2,H-96,'stone'],[3860,2,H-110,'steel'],[4260,2,H-96,'steel']],
    spikes:[[1000],[1024],[2760],[2784],[4560],[4584]],
    powerups:[['supergeek',1000,230],['solana',1500,230],['diamond',2500,H-124],['candle',2900,230]],
    airdrops:[[1250,H-118],[3600,H-72]],
    coins:[[300,196],[348,196],[500,120],[548,120],[864,120],[920,196],[1204,110],[1480,196],[2140,120],[2340,150],[2620,196],[2620,150],[3344,120],[3620,150],[3660,196],[4284,120],[4500,150],[5020,196],[5300,196]],
    enemies:[['bot',340,230,80],['sniper',700,230,30],['ghost',1050,212,80],['fudster',1160,230,60],['bitmaxi',1900,230,70],['bot',2020,230,70],['sniper',2420,230,30],['ghost',2840,212,70],['fudster',3200,230,70],['bot',3600,230,70],['bitmaxi',4120,230,70],['sniper',4400,230,30],['ghost',4700,212,90],['bot',5220,230,70]],
    pumpdumps:[[1560,174],[3720,174]], honeypots:[[2400,232]], npcs:[[2950,90]],
    bonusblocks:[[1280,5],[3000,'omegachad'],[4790,8]],
    key:[1680,H-150], door:5880 },

  { name:'4-2', sub:'THE TRADING FLOOR', time:160, theme:6, width:6600, bgImage:'exchange',
    gaps:[[780,900],[1620,1740],[2440,2560],[3260,3380],[4120,4240],[4980,5100],[5900,6020]],
    walls:[[440,4,'steel',5],[1240,4,'steel',4],[2100,4,'steel',6],[2980,4,'stone',4],[3860,4,'steel',6],[4720,4,'steel',4],[5560,4,'steel',5]],
    plats:[[800,2,H-96,'steel'],[1180,2,H-110,'steel'],[1660,2,H-96,'steel'],[2460,2,H-96,'steel'],[2920,2,H-110,'steel'],[3300,2,H-96,'steel'],[3520,2,H-140,'steel'],[4160,2,H-96,'steel'],[4660,2,H-110,'steel'],[5040,2,H-96,'steel']],
    spikes:[[1000],[1024],[2000],[2024],[3600],[3624],[4400],[4424],[5300],[5324]],
    powerups:[['supergeek',1400,230],['solana',1500,230],['diamond',2650,230],['candle',3100,230]],
    airdrops:[[2300,H-118],[4200,H-72]],
    coins:[[452,130],[500,130],[700,196],[1264,106],[1312,106],[1420,196],[2120,140],[2168,140],[2216,140],[2700,196],[3000,106],[3048,106],[3220,196],[3880,140],[3928,140],[4200,196],[4740,106],[4788,106],[5580,140],[5628,140],[6120,196]],
    enemies:[['bot',340,230,70],['sniper',620,230,30],['ghost',1000,212,80],['fudster',1420,230,70],['sniper',1920,230,30],['bitmaxi',2280,230,70],['bot',2720,230,70],['ghost',3220,212,70],['sniper',3480,230,30],['fudster',3680,230,70],['bitmaxi',4020,230,70],['bot',4420,230,70],['ghost',4840,212,80],['sniper',5280,230,30],['bitmaxi',5760,230,70]],
    pumpdumps:[[1000,174],[3500,174],[5300,174]], honeypots:[[2350,232]], npcs:[[3150,90]],
    bonusblocks:[[1020,5],[2270,8],[3420,5],[4510,8],[5700,8]],
    warps:[[2200,24,1]],
    key:[1164,H-150], door:6480 },

  // WORLD 4 boss level — the HARDEST gauntlet (tall+wide walls, dense snipers, spike pits), THEN
  // the Custodian at the door. The final world: reaching the boss should be a real fight in itself.
  { name:'4-3', sub:'THE CUSTODIAN', time:190, theme:6, width:5200, boss:true, bossType:'ceo', bgImage:'exchange',
    gaps:[[720,840],[1440,1560],[2160,2280],[2880,3000],[3600,3720],[4240,4360]],
    walls:[[440,4,'steel',5],[1120,4,'steel',4],[1800,4,'steel',6],[2500,4,'stone',4],[3160,4,'steel',6],[3860,4,'steel',4]],
    plats:[[740,2,H-96,'steel'],[1160,2,H-110,'steel'],[1580,2,H-96,'steel'],[2280,2,H-96,'steel'],[2560,2,H-120,'steel'],[2940,2,H-96,'steel'],[3620,2,H-96,'steel'],[3920,2,H-110,'steel'],[4400,2,H-96,'steel']],
    spikes:[[960],[984],[1680],[1704],[2760],[2784],[3480],[3504]],
    powerups:[['supergeek',1000,230],['diamond',2050,230],['bull',3400,230]],
    airdrops:[[1500,H-118],[3300,H-72]],
    coins:[[300,196],[600,130],[660,196],[960,196],[1220,106],[1620,150],[1980,140],[2340,196],[2620,110],[2960,196],[3220,140],[3560,196],[3940,106],[4160,196],[4420,150],[4560,196]],
    enemies:[['bot',340,230,70],['sniper',640,230,30],['fudster',960,230,60],['ghost',1240,212,80],['sniper',1640,230,30],['bitmaxi',2000,230,70],['bot',2340,230,70],['sniper',2620,230,30],['fudster',3080,230,70],['ghost',3420,212,70],['sniper',3560,230,30],['bitmaxi',4100,230,70],['bot',4160,230,60],['sniper',4460,230,30],['ghost',4560,212,80]],
    pumpdumps:[[1440,174],[2880,174],[4240,174]], honeypots:[[1300,232],[4020,232]], npcs:[[2380,90]],
    bonusblocks:[[990,5],[2090,8],[3140,8],[4160,8]],
    key:[4600,H-150], door:5000 },

  // WORLD 5 — THE BRIDGE (cross-chain). Sprint the spans over the void: planks get "exploited" and
  // collapse a beat after you step on them, so you can never stand still. Dark chasm theme. Boss run
  // still uses the wyrm arena for now (Bridge Drainer boss art is the next drop). Walls ≤4 tall.
  { name:'5-1', sub:'THE ONRAMP', time:190, theme:7, width:7800,
    gaps:[[860,980],[1700,1820],[2560,2680],[3400,3520],[4240,4360],[5080,5180],[5920,6020],[6760,6860]],
    walls:[[460,4,'stone',5],[1300,4,'crate',4],[2200,4,'stone',4],[3020,4,'brick',5],[3920,4,'stone',4],[4820,4,'crate',5],[5540,4,'stone',5],[6380,4,'crate',4]],
    plats:[[840,2,174,'stone'],[1180,2,140,'stone'],[1660,2,174,'crate'],[2140,2,160,'stone'],[2500,2,174,'stone'],[3320,2,174,'brick'],[3860,2,160,'stone'],[4260,2,174,'stone'],[5900,2,174,'stone'],[6740,2,140,'stone']],
    spikes:[[1000],[1024],[2760],[2784],[4560],[4584],[6120],[6144],[6930],[6954]],
    powerups:[['diamond',2500,146],['moon',3150,230],['omegachad',6990,230],['candle',2900,230]],
    airdrops:[[1250,152],[3600,198]],
    coins:[[300,196],[348,196],[500,120],[548,120],[864,120],[920,196],[1204,110],[1480,196],[2140,120],[2340,150],[2620,196],[2620,150],[3344,120],[3620,150],[3660,196],[4284,120],[4500,150],[5020,196],[5300,196],[5260,196],[5480,150],[5700,120],[6140,196],[6360,150],[6580,120],[7020,196],[7240,150],[7460,120]],
    enemies:[['jeet',340,230,80],['sniper',700,230,30],['ghost',1050,212,80],['paper',1160,230,60],['bitmaxi',1900,230,70],['jeet',2020,230,70],['sniper',2420,230,30],['ghost',2840,212,70],['paper',3200,230,70],['jeet',3600,230,70],['bitmaxi',4120,230,70],['sniper',4400,230,30],['ghost',4700,212,90],['jeet',5220,230,70],['jeet',5340,230,70],['sniper',5770,230,70],['ghost',6200,212,70],['paper',6630,230,70],['bitmaxi',7060,230,70],['jeet',7490,230,70]],
    pumpdumps:[[1560,174],[3720,174],[5580,174]],
    honeypots:[[2400,232],[4160,232],[6120,232]],
    npcs:[[2950,90]],
    planks:[[1700,5],[2560,5],[3400,5],[5080,4],[5920,5],[6760,5]],
    bonusblocks:[[1280,5],[3000,'supergeek'],[4790,8],[6020,8],[6760,8]],
    caches:[[2400,226,200]],
    key:[1680,120], door:7680 },

  { name:'5-2', sub:'THE SPAN', time:200, theme:7, width:8400,
    gaps:[[780,900],[1620,1740],[2440,2560],[3260,3380],[4120,4240],[4980,5100],[5900,6020],[6760,6880],[7620,7740]],
    walls:[[440,4,'stone',5],[1240,4,'crate',4],[2100,4,'stone',6],[2980,4,'brick',4],[3860,4,'stone',6],[4720,4,'crate',4],[5560,4,'stone',5],[6380,4,'stone',5],[7240,4,'crate',4]],
    plats:[[800,2,174,'stone'],[1180,2,160,'stone'],[1660,2,174,'stone'],[2460,2,174,'stone'],[2920,2,160,'stone'],[3300,2,174,'stone'],[3520,2,130,'stone'],[4160,2,174,'stone'],[4660,2,160,'stone'],[5040,2,174,'stone'],[6740,2,174,'stone'],[7600,2,160,'stone']],
    spikes:[[1000],[1024],[2000],[2024],[3600],[3624],[4400],[4424],[5300],[5324],[6937],[6961],[7533],[7557]],
    powerups:[['moon',3600,136],['omegachad',4460,230],['bull',7590,230],['candle',3100,230],['megawhale',5500,112]],
    airdrops:[[2300,152],[4200,198]],
    coins:[[452,130],[500,130],[700,196],[1264,106],[1312,106],[1420,196],[2120,140],[2168,140],[2216,140],[2700,196],[3000,106],[3048,106],[3220,196],[3880,140],[3928,140],[4200,196],[4740,106],[4788,106],[5580,140],[5628,140],[6120,196],[6080,196],[6300,150],[6520,120],[6740,196],[6960,150],[7180,120],[7400,196],[7840,150],[8060,120]],
    enemies:[['jeet',340,230,70],['sniper',620,230,30],['ghost',1000,212,80],['paper',1420,230,70],['sniper',1920,230,30],['bitmaxi',2280,230,70],['jeet',2720,230,70],['ghost',3220,212,70],['sniper',3480,230,30],['paper',3680,230,70],['bitmaxi',4020,230,70],['jeet',4420,230,70],['ghost',4840,212,80],['sniper',5280,230,30],['bitmaxi',5760,230,70],['jeet',6160,230,70],['sniper',6590,230,70],['ghost',7020,212,70],['paper',7450,230,70],['sniper',7880,230,70],['sniper',5330,230,40],['sniper',5670,230,40],['ghost',5500,150,70]],
    pumpdumps:[[1000,174],[3500,174],[5300,174],[6400,174]],
    honeypots:[[2350,232],[4050,232],[6940,232]],
    npcs:[[3150,90]],
    planks:[[1620,5],[2440,5],[3260,5],[4120,5],[5900,5],[6760,5],[7620,5]],
    bonusblocks:[[1020,5],[2270,8],[3420,5],[4510,8],[5700,8],[6767,8],[7433,8]],
    warps:[[2200,26]],
    key:[1164,120], door:8280 },

  { name:'5-3', sub:'THE VAULT WYRM', time:240, theme:7, width:6700, boss:true, bossType:'wyrm',
    gaps:[[720,840],[1440,1560],[2160,2280],[2880,3000],[3600,3720],[4240,4360],[4960,5080],[5680,5800]],
    walls:[[440,4,'stone',5],[1120,4,'crate',4],[1800,4,'stone',6],[2500,4,'brick',4],[3160,4,'stone',6],[3860,4,'crate',4],[4580,4,'stone',5],[5300,4,'crate',4]],
    plats:[[740,2,174,'stone'],[1160,2,160,'stone'],[1580,2,174,'stone'],[2280,2,174,'stone'],[2560,2,150,'stone'],[2940,2,174,'stone'],[3620,2,174,'stone'],[3920,2,160,'stone'],[4400,2,174,'stone'],[4940,2,174,'stone'],[5660,2,160,'stone']],
    spikes:[[960],[984],[1680],[1704],[2760],[2784],[3480],[3504],[5193],[5217],[5847],[5871]],
    powerups:[['diamond',2050,230],['omegachad',2700,230],['bull',3400,230],['supergeek',6025,146]],
    airdrops:[[1500,152],[3300,198]],
    coins:[[300,196],[600,130],[660,196],[960,196],[1220,106],[1620,150],[1980,140],[2340,196],[2620,110],[2960,196],[3220,140],[3560,196],[3940,106],[4160,196],[4420,150],[4560,196],[4420,196],[4640,150],[4860,120],[5300,196],[5520,150],[5960,120],[6180,196],[6400,150]],
    enemies:[['jeet',340,230,70],['sniper',640,230,30],['paper',960,230,60],['ghost',1240,212,80],['sniper',1640,230,30],['bitmaxi',2000,230,70],['jeet',2340,230,70],['sniper',2620,230,30],['paper',3080,230,70],['ghost',3420,212,70],['sniper',3560,230,30],['bitmaxi',4100,230,70],['jeet',4160,230,60],['sniper',4460,230,30],['ghost',4560,212,80],['jeet',4500,230,70],['sniper',5140,230,70],['paper',5360,230,70],['ghost',5860,212,70],['sniper',6220,230,70]],
    pumpdumps:[[1440,174],[2880,174],[4240,174],[4740,174]],
    honeypots:[[1300,232],[2660,232],[4020,232],[5140,232]],
    npcs:[[2380,90]],
    planks:[[1440,5],[2880,5],[3600,5],[4960,5],[5680,5]],
    bonusblocks:[[990,5],[2090,8],[3140,8],[4160,8],[5093,8],[5747,8]],
    key:[5900,120], door:6500 },

  { name:'6-1', sub:'THE PEG', time:190, theme:8, width:7800,
    gaps:[[860,980],[1700,1820],[2560,2680],[3400,3520],[4240,4360],[5080,5180],[5920,6020],[6760,6860]],
    walls:[[460,4,'crate',5],[1300,4,'stone',4],[2200,4,'crate',4],[3020,4,'stone',5],[3920,4,'crate',4],[4820,4,'stone',5],[5540,4,'crate',5],[6380,4,'stone',4]],
    plats:[[840,2,174,'crate'],[1180,2,140,'crate'],[1660,2,174,'stone'],[2140,2,160,'crate'],[2500,2,174,'crate'],[3320,2,174,'stone'],[3860,2,160,'crate'],[4260,2,174,'crate'],[5900,2,174,'crate'],[6740,2,140,'crate']],
    spikes:[[1000],[1024],[2760],[2784],[4560],[4584],[6120],[6144],[6930],[6954]],
    powerups:[['supergeek',1000,230],['bull',6990,230],['candle',2900,230]],
    airdrops:[[1250,152],[3600,198]],
    coins:[[300,196],[348,196],[500,120],[548,120],[864,120],[920,196],[1204,110],[1480,196],[2140,120],[2340,150],[2620,196],[2620,150],[3344,120],[3620,150],[3660,196],[4284,120],[4500,150],[5020,196],[5300,196],[5260,196],[5480,150],[5700,120],[6140,196],[6360,150],[6580,120],[7020,196],[7240,150],[7460,120]],
    enemies:[['bot',340,230,80],['sniper',700,230,30],['ghost',1050,212,80],['bitmaxi',1160,230,60],['bot',1900,230,70],['bitmaxi',2020,230,70],['sniper',2420,230,30],['ghost',2840,212,70],['bitmaxi',3200,230,70],['bot',3600,230,70],['bitmaxi',4120,230,70],['sniper',4400,230,30],['ghost',4700,212,90],['bot',5220,230,70],['bot',5340,230,70],['sniper',5738,230,70],['ghost',6136,212,70],['bitmaxi',6534,230,70],['bot',6932,230,70],['bitmaxi',7330,230,70]],
    pumpdumps:[[1560,174],[3720,174],[5580,174]],
    honeypots:[[2400,232],[4160,232],[6120,232]],
    npcs:[[2950,90]],
    pegs:[[1700,5],[3400,5],[5080,4],[5920,5],[6760,5]],
    bonusblocks:[[1280,5],[3000,'omegachad'],[4790,8],[6020,8],[6760,8]],
    key:[1680,120], door:7680 },

  { name:'6-2', sub:'DEPEG EVENT', time:200, theme:8, width:8400,
    gaps:[[780,900],[1620,1740],[2440,2560],[3260,3380],[4120,4240],[4980,5100],[5900,6020],[6760,6880],[7620,7740]],
    walls:[[440,4,'crate',5],[1240,4,'stone',4],[2100,4,'crate',6],[2980,4,'stone',4],[3860,4,'crate',6],[4720,4,'stone',4],[5560,4,'crate',5],[6380,4,'crate',5],[7240,4,'stone',4]],
    plats:[[800,2,174,'crate'],[1180,2,160,'crate'],[1660,2,174,'crate'],[2460,2,174,'crate'],[2920,2,160,'crate'],[3300,2,174,'crate'],[3520,2,130,'crate'],[4160,2,174,'crate'],[4660,2,160,'crate'],[5040,2,174,'crate'],[6740,2,174,'crate'],[7600,2,160,'crate']],
    spikes:[[1000],[1024],[2000],[2024],[3600],[3624],[4400],[4424],[5300],[5324],[6937],[6961],[7533],[7557]],
    powerups:[['supergeek',1400,230],['diamond',2650,230],['candle',7590,230],['megawhale',5500,112]],
    airdrops:[[2300,152],[4200,198]],
    coins:[[452,130],[500,130],[700,196],[1264,106],[1312,106],[1420,196],[2120,140],[2168,140],[2216,140],[2700,196],[3000,106],[3048,106],[3220,196],[3880,140],[3928,140],[4200,196],[4740,106],[4788,106],[5580,140],[5628,140],[6120,196],[6080,196],[6300,150],[6520,120],[6740,196],[6960,150],[7180,120],[7400,196],[7840,150],[8060,120]],
    enemies:[['bot',340,230,70],['sniper',620,230,30],['ghost',1000,212,80],['bitmaxi',1420,230,70],['sniper',1920,230,30],['bitmaxi',2280,230,70],['bot',2720,230,70],['ghost',3220,212,70],['sniper',3480,230,30],['bitmaxi',3680,230,70],['bot',4020,230,70],['bot',4420,230,70],['ghost',4840,212,80],['sniper',5280,230,30],['bitmaxi',5760,230,70],['bot',6160,230,70],['sniper',6558,230,70],['ghost',6956,212,70],['bitmaxi',7354,230,70],['sniper',7822,230,70],['bitmaxi',8150,230,70],['sniper',5330,230,40],['sniper',5670,230,40],['ghost',5500,150,70]],
    pumpdumps:[[1000,174],[3500,174],[5300,174],[6400,174]],
    honeypots:[[2350,232],[4050,232],[6940,232]],
    npcs:[[3150,90]],
    pegs:[[1620,5],[3260,5],[4980,5],[6760,5],[7620,5]],
    bonusblocks:[[1020,5],[2270,8],[3420,5],[4510,8],[5700,8],[6767,8],[7433,8]],
    warps:[[2200,27,1]],
    key:[1164,120], door:8280 },

  { name:'6-3', sub:'THE HASH LORD', time:250, theme:8, width:6700, boss:true, bossType:'golem',
    gaps:[[720,840],[1440,1560],[2160,2280],[2880,3000],[3600,3720],[4240,4360],[4960,5080],[5680,5800]],
    walls:[[440,4,'crate',5],[1120,4,'stone',4],[1800,4,'crate',6],[2500,4,'stone',4],[3160,4,'crate',6],[3860,4,'stone',4],[4580,4,'crate',5],[5300,4,'stone',4]],
    plats:[[740,2,174,'crate'],[1160,2,160,'crate'],[1580,2,174,'crate'],[2280,2,174,'crate'],[2560,2,150,'crate'],[2940,2,174,'crate'],[3620,2,174,'crate'],[3920,2,160,'crate'],[4400,2,174,'crate'],[4940,2,174,'crate'],[5660,2,160,'crate']],
    spikes:[[960],[984],[1680],[1704],[2760],[2784],[3480],[3504],[5193],[5217],[5847],[5871]],
    powerups:[['supergeek',1000,230],['diamond',2050,230],['omegachad',6025,230]],
    airdrops:[[1500,152],[3300,198]],
    coins:[[300,196],[600,130],[660,196],[960,196],[1220,106],[1620,150],[1980,140],[2340,196],[2620,110],[2960,196],[3220,140],[3560,196],[3940,106],[4160,196],[4420,150],[4560,196],[4420,196],[4640,150],[4860,120],[5300,196],[5520,150],[5960,120],[6180,196],[6400,150]],
    enemies:[['bot',340,230,70],['sniper',640,230,30],['bitmaxi',960,230,60],['ghost',1240,212,80],['sniper',1640,230,30],['bitmaxi',2000,230,70],['bot',2340,230,70],['sniper',2620,230,30],['bitmaxi',3080,230,70],['ghost',3420,212,70],['sniper',3560,230,30],['bitmaxi',4100,230,70],['bot',4160,230,60],['sniper',4460,230,30],['ghost',4560,212,80],['bot',4500,230,70],['sniper',4898,230,70],['bitmaxi',5296,230,70],['ghost',5904,212,70],['sniper',6092,230,70],['bitmaxi',6490,230,70]],
    pumpdumps:[[1440,174],[2880,174],[4240,174],[4740,174]],
    honeypots:[[1300,232],[2660,232],[4020,232],[5140,232]],
    npcs:[[2380,90]],
    pegs:[[1440,5],[3160,5],[4960,5],[5680,5]],
    bonusblocks:[[990,5],[2090,8],[3140,8],[4160,8],[5093,8],[5747,8]],
    key:[5900,120], door:6500 },

  { name:'7-1', sub:'THE FARM', time:195, theme:9, width:7800,
    gaps:[[860,980],[1700,1820],[2560,2680],[3400,3520],[4240,4360],[5080,5180],[5920,6020],[6760,6860]],
    walls:[[460,4,'crate',5],[1300,4,'stone',4],[2200,4,'crate',4],[3020,4,'stone',5],[3920,4,'crate',4],[4820,4,'stone',5],[5540,4,'crate',5],[6380,4,'stone',4]],
    plats:[[840,2,174,'crate'],[1180,2,140,'crate'],[1980,2,174,'stone'],[2340,2,160,'crate'],[3200,2,174,'stone'],[3560,2,160,'crate'],[4480,2,174,'crate'],[5900,2,174,'crate'],[6740,2,140,'crate']],
    spikes:[[1000],[1024],[2760],[2784],[4560],[4584],[6120],[6144],[6930],[6954]],
    yields:[[1400,174,4],[2900,174,4],[4650,174,5],[6087,174,4],[6933,174,5]],
    powerups:[['solana',1560,230],['omegachad',4020,230],['bull',6990,230],['candle',2900,230]],
    airdrops:[[1250,152],[3600,198]],
    coins:[[300,196],[348,196],[500,120],[548,120],[920,196],[1388,96],[1400,72],[1412,110],[2140,120],[2340,150],[2620,196],[2888,96],[2900,72],[2912,110],[3344,120],[3620,150],[3660,196],[4284,120],[4638,96],[4650,72],[4662,50],[5020,196],[5300,196],[5260,196],[5480,150],[5700,120],[6140,196],[6360,150],[6580,120],[7020,196],[7240,150],[7460,120]],
    enemies:[['bot',340,230,80],['sniper',700,230,30],['ghost',1050,212,80],['bitmaxi',1160,230,60],['bot',1900,230,70],['bitmaxi',2020,230,70],['sniper',2420,230,30],['ghost',2840,212,70],['bitmaxi',3260,230,70],['bot',3600,230,70],['bitmaxi',4120,230,70],['sniper',4400,230,30],['ghost',4700,212,90],['bot',5220,230,70],['bot',5340,230,70],['sniper',5711,230,70],['ghost',6082,212,70],['bitmaxi',6453,230,70],['bot',6964,230,70],['bitmaxi',7195,230,70],['sniper',7566,230,70]],
    pumpdumps:[[1560,174],[3720,174],[5580,174]],
    honeypots:[[2400,232],[4160,232],[6120,232]],
    npcs:[[2200,90]],
    bonusblocks:[[1280,5],[3000,'omegachad'],[4790,8],[6020,8],[6760,8]],
    key:[1680,120], door:7680 },

  { name:'7-2', sub:'COMPOUND COUNTRY', time:205, theme:9, width:8400,
    gaps:[[780,900],[1620,1740],[2440,2560],[3260,3380],[4120,4240],[4980,5100],[5900,6020],[6760,6880],[7620,7740]],
    walls:[[440,4,'crate',5],[1240,4,'stone',4],[2100,4,'crate',6],[2980,4,'stone',4],[3860,4,'crate',6],[4720,4,'stone',4],[5560,4,'crate',5],[6380,4,'crate',5],[7240,4,'stone',4]],
    plats:[[800,2,174,'crate'],[1180,2,160,'crate'],[1980,2,174,'crate'],[2920,2,160,'crate'],[3520,2,130,'crate'],[4660,2,160,'crate'],[5040,2,174,'crate'],[6740,2,174,'crate'],[7600,2,160,'crate']],
    spikes:[[1000],[1024],[2000],[2024],[3600],[3624],[4400],[4424],[5300],[5324],[6937],[6961],[7533],[7557]],
    yields:[[1400,174,4],[2700,174,5],[4560,174,4],[5720,174,5],[6973,174,4],[7467,174,5]],
    powerups:[['diamond',2650,230],['omegachad',4460,230],['bull',7590,230],['candle',3100,230],['megawhale',5500,112]],
    airdrops:[[2300,152],[4200,198]],
    coins:[[452,130],[500,130],[700,196],[1388,96],[1400,72],[1412,110],[2120,140],[2216,140],[2688,96],[2700,70],[2712,48],[3000,106],[3220,196],[3880,140],[3928,140],[4548,96],[4560,72],[4740,106],[5708,96],[5720,70],[5732,48],[6120,196],[6080,196],[6300,150],[6520,120],[6740,196],[6960,150],[7180,120],[7400,196],[7840,150],[8060,120]],
    enemies:[['bot',340,230,70],['sniper',620,230,30],['ghost',1000,212,80],['bitmaxi',1420,230,70],['sniper',1920,230,30],['bitmaxi',2280,230,70],['bot',2760,230,70],['ghost',3220,212,70],['sniper',3480,230,30],['bitmaxi',3720,230,70],['bot',4040,230,70],['bot',4420,230,70],['ghost',4840,212,80],['sniper',5280,230,30],['bitmaxi',5760,230,70],['bot',6160,230,70],['sniper',6531,230,70],['ghost',6972,212,70],['bitmaxi',7273,230,70],['sniper',7784,230,70],['bitmaxi',8015,230,70],['sniper',5330,230,40],['sniper',5670,230,40],['ghost',5500,150,70]],
    pumpdumps:[[1000,174],[3500,174],[5300,174],[6400,174]],
    honeypots:[[2350,232],[4050,232],[6940,232]],
    npcs:[[3150,90]],
    bonusblocks:[[1020,5],[2270,8],[3420,'supergeek'],[4510,8],[5700,8],[6767,8],[7433,8]],
    caches:[[3600,226,200]],
    warps:[[2200,28]],
    key:[1164,120], door:8280 },

  { name:'7-3', sub:'THE YIELD REAPER', time:265, theme:9, width:6700, boss:true, bossType:'reaper',
    gaps:[[720,840],[1440,1560],[2160,2280],[2880,3000],[3600,3720],[4240,4360],[4960,5080],[5680,5800]],
    walls:[[440,4,'crate',5],[1120,4,'stone',4],[1800,4,'crate',6],[2500,4,'stone',4],[3160,4,'crate',6],[3860,4,'stone',4],[4580,4,'crate',5],[5300,4,'stone',4]],
    plats:[[740,2,174,'crate'],[1160,2,160,'crate'],[1980,2,174,'crate'],[2560,2,150,'crate'],[3260,2,174,'crate'],[3920,2,160,'crate'],[4940,2,174,'crate'],[5660,2,160,'crate']],
    spikes:[[960],[984],[1680],[1704],[2760],[2784],[3480],[3504],[5193],[5217],[5847],[5871]],
    yields:[[1300,174,4],[2700,174,5],[4000,174,4],[5160,174,4],[5850,174,5]],
    powerups:[['supergeek',1000,230],['omegachad',2700,230],['bull',6025,230]],
    airdrops:[[1500,152],[3300,198]],
    coins:[[300,196],[600,130],[660,196],[1288,96],[1300,72],[1620,150],[1980,140],[2340,196],[2688,96],[2700,70],[2712,48],[2960,196],[3220,140],[3560,196],[3988,96],[4000,72],[4160,196],[4420,150],[4560,196],[4420,196],[4640,150],[4860,120],[5300,196],[5520,150],[5960,120],[6180,196],[6400,150]],
    enemies:[['bot',340,230,70],['sniper',640,230,30],['bitmaxi',960,230,60],['ghost',1240,212,80],['sniper',1640,230,30],['bitmaxi',2000,230,70],['bot',2340,230,70],['sniper',2620,230,30],['bitmaxi',3080,230,70],['ghost',3420,212,70],['sniper',3560,230,30],['bitmaxi',4100,230,70],['bot',4160,230,60],['sniper',4460,230,30],['ghost',4560,212,80],['bot',4500,230,70],['sniper',4871,230,70],['bitmaxi',5242,230,70],['ghost',5613,212,70],['sniper',5984,230,70],['bitmaxi',6355,230,70]],
    pumpdumps:[[1440,174],[2880,174],[4240,174],[4740,174]],
    honeypots:[[1300,232],[2660,232],[4020,232],[5140,232]],
    npcs:[[2380,90]],
    bonusblocks:[[990,5],[2090,8],[3140,8],[4160,8],[5093,8],[5747,8]],
    key:[5900,120], door:6500 },

  { name:'8-1', sub:'THE DIP', time:190, theme:10, width:7800,
    gaps:[[900,1000],[1760,1860],[2620,2720],[3480,3580],[4340,4440],[5180,5280],[6040,6140],[6900,7000]],
    walls:[[560,3,'stone',3],[1400,3,'crate',3],[2300,3,'stone',3],[3160,3,'crate',3],[4020,3,'stone',3],[4900,3,'crate',3],[5660,3,'stone',3],[6520,3,'crate',3]],
    plats:[[880,2,174,'crate'],[1240,2,146,'crate'],[1740,2,174,'stone'],[2600,2,174,'crate'],[3460,2,160,'crate'],[4320,2,174,'crate'],[5160,2,160,'crate'],[6020,2,174,'crate'],[6880,2,146,'crate']],
    spikes:[[1320],[1344],[3080],[3104],[4780],[4804],[6220],[6244],[6540],[6564],[7070],[7094]],
    powerups:[['omegachad',1520,230],['candle',2160,230],['whale',2560,230],['coldwallet',7080,230]],
    airdrops:[[1980,152],[3760,198]],
    coins:[[300,224],[360,224],[640,224],[1080,224],[1300,196],[1620,224],[2000,224],[2360,196],[2740,224],[3060,196],[3400,224],[3940,196],[4460,224],[4780,196],[5360,224],[5560,224],[5360,196],[5580,150],[5800,120],[6020,196],[6240,150],[6460,120],[6680,196],[7120,150],[7340,120],[7560,196]],
    enemies:[['bot',480,230,70],['jeet',760,230,60],['ghost',1120,212,80],['bot',1620,230,70],['bitmaxi',2040,230,70],['ghost',2500,212,70],['bot',2860,230,70],['jeet',3300,230,60],['bitmaxi',3760,230,70],['ghost',4180,212,80],['bot',4600,230,70],['jeet',5040,230,60],['bot',5460,230,70],['bot',5440,230,70],['jeet',5784,230,70],['ghost',6198,212,70],['bot',6472,230,70],['bitmaxi',6816,230,70],['ghost',7160,212,70],['bot',7504,230,70]],
    pumpdumps:[[1120,174],[3600,174],[5680,174]],
    honeypots:[[2400,232],[4700,232],[6220,232]],
    bonusblocks:[[1310,5],[3050,8],[4790,8],[6087,8],[6793,8]],
    key:[640,222], door:7680 },

  { name:'8-2', sub:'CAPITULATION', time:200, theme:10, width:8400,
    gaps:[[820,940],[1680,1800],[2540,2660],[3400,3520],[4260,4380],[5120,5240],[5980,6100],[6840,6960],[7700,7820]],
    walls:[[520,3,'crate',3],[1320,3,'stone',3],[2180,3,'crate',3],[3040,3,'stone',3],[3900,3,'crate',3],[4760,3,'stone',3],[5620,3,'crate',3],[6460,3,'crate',3],[7320,3,'stone',3]],
    plats:[[800,2,174,'crate'],[1200,2,146,'crate'],[1660,2,174,'stone'],[2520,2,174,'crate'],[3380,2,160,'crate'],[4240,2,174,'crate'],[5100,2,160,'crate'],[5960,2,174,'crate'],[6820,2,174,'crate'],[7680,2,146,'crate']],
    spikes:[[1200],[1224],[2900],[2924],[4600],[4624],[5500],[5524],[6760],[6784],[7240],[7264],[7860],[7884]],
    powerups:[['omegachad',700,230],['whale',2500,230],['coldwallet',3200,230],['candle',7590,230],['megawhale',5500,112]],
    airdrops:[[2100,152],[4400,198]],
    coins:[[300,224],[360,224],[720,224],[1120,196],[1560,224],[1980,224],[2340,196],[2760,224],[3140,196],[3620,224],[4020,196],[4500,224],[4880,196],[5360,224],[5760,196],[6220,224],[6160,196],[6380,150],[6600,120],[6820,196],[7040,150],[7260,120],[7480,196],[7920,150],[8140,120]],
    enemies:[['bot',460,230,70],['sniper',760,230,30],['ghost',1100,212,80],['bitmaxi',1560,230,70],['bot',1980,230,70],['sniper',2400,230,30],['ghost',2900,212,70],['bitmaxi',3340,230,70],['bot',3780,230,70],['sniper',4180,230,30],['ghost',4700,212,80],['bitmaxi',5000,230,70],['bot',5600,230,70],['sniper',5880,230,30],['bot',6240,230,70],['sniper',6584,230,70],['ghost',6998,212,70],['bitmaxi',7272,230,70],['bot',7616,230,70],['sniper',7960,230,70],['sniper',5330,230,40],['sniper',5670,230,40],['ghost',5500,150,70]],
    pumpdumps:[[1000,174],[3200,174],[5400,174],[6480,174]],
    honeypots:[[2000,232],[4900,232],[7020,232]],
    bonusblocks:[[1020,5],[2160,8],[3350,5],[4510,8],[5720,8],[6820,8],[7460,8]],
    warps:[[2200,29,1]],
    key:[700,222], door:8280 },

  { name:'8-3', sub:'THE GREAT BEAR', time:275, theme:10, width:6700, boss:true, bossType:'liquidator',
    gaps:[[720,840],[1440,1560],[2160,2280],[2880,3000],[3600,3720],[4240,4360],[4960,5080],[5680,5800]],
    walls:[[440,4,'stone',4],[1120,4,'crate',4],[1800,4,'stone',5],[2500,4,'crate',4],[3160,4,'stone',5],[3860,4,'crate',4],[4580,4,'stone',4],[5300,4,'crate',4]],
    plats:[[740,2,174,'crate'],[1160,2,160,'crate'],[1980,2,174,'crate'],[2560,2,150,'crate'],[3260,2,174,'crate'],[3920,2,160,'crate'],[4940,2,174,'crate'],[5660,2,160,'crate']],
    spikes:[[960],[984],[1680],[1704],[2760],[2784],[3480],[3504],[5170],[5194],[5520],[5544],[6010],[6034]],
    powerups:[['omegachad',1000,230],['whale',2050,230],['coldwallet',2700,230],['bull',6025,230]],
    airdrops:[[1500,152],[3300,198]],
    coins:[[300,196],[600,130],[660,196],[1288,196],[1620,150],[1980,140],[2340,196],[2688,196],[2960,196],[3220,140],[3560,196],[3988,196],[4160,196],[4420,150],[4560,196],[4420,196],[4640,150],[4860,120],[5300,196],[5520,150],[5960,120],[6180,196],[6400,150]],
    enemies:[['bot',340,230,70],['sniper',640,230,30],['bitmaxi',960,230,60],['ghost',1240,212,80],['sniper',1640,230,30],['bitmaxi',2000,230,70],['bot',2340,230,70],['sniper',2620,230,30],['bitmaxi',3080,230,70],['ghost',3420,212,70],['sniper',3560,230,30],['bitmaxi',4100,230,70],['bot',4160,230,60],['sniper',4460,230,30],['bot',4500,230,70],['sniper',4844,230,70],['bitmaxi',5188,230,70],['ghost',5532,212,70],['sniper',5876,230,70],['bitmaxi',6220,230,70]],
    pumpdumps:[[1440,174],[2880,174],[4240,174],[4740,174]],
    honeypots:[[1300,232],[2660,232],[4020,232],[5140,232]],
    bonusblocks:[[990,8],[2090,8],[3140,10],[4160,10],[5093,8],[5747,8]],
    key:[5900,120], door:6500 },

  // ===== HIDDEN BONUS LEVELS (index 24+) — reachable ONLY via a speakeasy warp. hidden:true keeps them
  //       out of the normal progression + the level-select; their door RETURNS you to the surface. =====
  { name:'VAULT', sub:'THE SPEAKEASY VAULT', time:90, theme:12, width:2600, hidden:true, bonus:true,
    gaps:[],
    walls:[[300,2,'crate',2],[2260,2,'stone',2]],
    plats:[[1680,3,H-96,'crate']],
    spikes:[],
    powerups:[['candle',520,230]],
    coins:[[680,224],[740,224],[800,224],[1140,224],[1200,224],[1900,224],[1960,224],[2020,224],[1704,H-118],[1752,H-118]],
    caches:[[1320,GY-20,300],[1728,H-118,500]],
    slots:[[960,'jackpot']],
    enemies:[],
    key:[420,H-150], door:2440 },

  { name:'TRENCHES', sub:'CRYPTO TRENCHES', time:210, theme:11, width:7200, hidden:true, bonus:true, boss:true, bossType:'troll', diff:1.5,
    gaps:[[900,1020],[1900,2020],[3100,3220],[4300,4420],[5500,5620],[6400,6500]],
    walls:[[520,3,'steel',3],[1420,3,'crate',3],[2520,3,'steel',3],[3620,3,'crate',3],[4820,3,'steel',3],[5920,3,'crate',3]],
    plats:[[940,2,H-96,'steel'],[1940,2,H-96,'crate'],[3140,2,H-110,'steel'],[4340,2,H-96,'crate'],[5540,2,H-110,'steel'],[6420,2,H-96,'crate'],[2200,2,H-130,'steel'],[4000,2,H-142,'crate']],
    spikes:[],
    powerups:[['bull',700,230],['moon',3320,230],['candle',5000,230]],
    coins:[[200,224],[260,224],[700,224],[760,224],[1200,224],[1260,224],[1600,196],[2600,224],[2660,224],[2900,196],[3400,224],[3700,224],[4100,196],[4600,224],[4900,224],[5200,196],[5800,224],[6100,196],[6600,224],[6800,224],[7000,224]],
    caches:[[1320,GY-20,200],[2216,H-152,400],[3720,GY-20,300],[4016,H-164,500],[6040,GY-20,400],[6960,GY-20,1000]],
    slots:[[1520,'trench'],[4620,'trench']],
    enemies:[['bot',1220,230,80],['ghost',2420,212,90],['bot',3420,230,80],['sniper',4220,230,30],['ghost',5040,212,90],['bot',5820,230,80],['sniper',6320,230,30]],
    bonusblocks:[[1640,8],[3820,'moon'],[5240,8]],
    key:[620,H-150], door:7060 },

  // idx 26 — coin-flood bonus room
  { name:'PRINTER', sub:'THE MONEY PRINTER', time:80, theme:12, width:2600, hidden:true, bonus:true,
    gaps:[],
    walls:[[280,2,'crate',2],[2300,2,'crate',2]],
    plats:[[820,3,H-104,'crate'],[1400,3,H-140,'crate'],[1900,3,H-104,'crate']],
    spikes:[],
    powerups:[['candle',460,230]],
    coins:[[560,224],[620,224],[680,224],[740,224],[840,H-128],[900,H-128],[1180,224],[1240,224],[1420,H-164],[1480,H-164],[1660,224],[1720,224],[1920,H-128],[1980,224],[2040,224],[2100,224]],
    caches:[[1120,GY-20,400],[2160,GY-20,600]],
    enemies:[],
    key:[400,H-150], door:2440 },

  // idx 27 — Diamond Hands + gems
  { name:'DIAMONDVAULT', sub:'THE DIAMOND VAULT', time:85, theme:12, width:2600, hidden:true, bonus:true,
    gaps:[],
    walls:[[280,2,'stone',2],[2300,2,'stone',2]],
    plats:[[1300,3,H-120,'stone']],
    spikes:[],
    powerups:[['diamond',1300,H-150]],
    coins:[[560,224],[640,224],[760,224],[900,224],[1040,196],[1180,196],[1420,196],[1560,196],[1700,224],[1840,224],[1980,224],[2120,224]],
    caches:[[820,GY-20,500],[1780,GY-20,500]],
    enemies:[],
    key:[400,H-150], door:2440 },

  // idx 28 — healing airdrops
  { name:'BUNKER', sub:'THE AIRDROP BUNKER', time:85, theme:12, width:2600, hidden:true, bonus:true,
    gaps:[],
    walls:[[280,2,'steel',2],[2300,2,'steel',2]],
    plats:[[760,3,H-110,'steel'],[1560,3,H-134,'steel']],
    spikes:[],
    powerups:[['candle',460,230]],
    airdrops:[[760,H-140],[1160,H-96],[1560,H-164]],
    coins:[[540,224],[600,224],[1000,196],[1160,H-124],[1360,196],[1760,224],[1920,224],[2080,224],[2140,224]],
    caches:[[1160,GY-20,300],[2000,GY-20,400]],
    enemies:[],
    key:[400,H-150], door:2440 },

  // idx 29 — multi-slot casino den
  { name:'DEN', sub:'THE DEGEN DEN', time:90, theme:12, width:2800, hidden:true, bonus:true,
    gaps:[],
    walls:[[280,2,'crate',2],[2500,2,'crate',2]],
    plats:[[1400,3,H-104,'stone']],
    spikes:[],
    powerups:[['candle',440,230]],
    coins:[[520,224],[580,224],[900,224],[960,224],[1160,196],[1440,H-132],[1640,196],[1880,224],[1940,224],[2280,224],[2340,224]],
    caches:[[1760,GY-20,400]],
    slots:[[700,'jackpot'],[1400,'trench'],[2120,'jackpot']],
    enemies:[],
    key:[380,H-150], door:2640 },

  // idx 30 — climb to the Moon
  { name:'LAUNCHPAD', sub:'THE LAUNCH PAD', time:85, theme:12, width:2600, hidden:true, bonus:true,
    gaps:[],
    walls:[[280,2,'crate',2],[2300,2,'crate',2]],
    plats:[[680,2,H-96,'crate'],[1040,2,H-128,'crate'],[1400,2,H-160,'crate'],[1760,2,H-190,'crate']],
    spikes:[],
    powerups:[['caffeine',460,230],['moon',1760,H-214]],
    coins:[[560,224],[700,H-120],[900,224],[1060,H-152],[1200,224],[1420,H-184],[1780,H-214],[2000,224],[2100,224],[2180,224]],
    caches:[[1840,H-214,800],[2160,GY-20,400]],
    enemies:[],
    key:[400,H-150], door:2440 }
];

/* ---------- Boot ---------- */
var Boot=new Phaser.Class({ Extends:Phaser.Scene,
  initialize:function(){ Phaser.Scene.call(this,{key:'Boot'}); },
  create:function(){
    var g=this.add.graphics();
    // (coin is a real rendered Bitcoin sprite loaded via addBase64 in Boot — no longer code-drawn)
    // crown — the Rug King's, knocked off on the win screen
    g.clear();
    g.fillStyle(0xffd23f); g.fillTriangle(0,12,4,2,8,12); g.fillTriangle(7,12,11,0,15,12); g.fillTriangle(14,12,18,2,22,12); g.fillRect(0,11,22,6);
    g.fillStyle(0xffe875); g.fillRect(0,11,22,2);
    g.fillStyle(0xff3860); g.fillCircle(4,4,1.4); g.fillStyle(0x66ddff); g.fillCircle(11,2,1.6); g.fillStyle(0xff3860); g.fillCircle(18,4,1.4);
    g.fillStyle(0xb8860b); g.fillRect(0,16,22,1);
    g.generateTexture('crown',22,18);
    // ground tile — layered dirt with speckles + a grassy top with blades
    g.clear();
    g.fillStyle(0x6e4420); g.fillRect(0,0,24,24);
    g.fillStyle(0x8a5a2b); g.fillRect(0,6,24,18);
    g.fillStyle(0x5e3c1a); g.fillRect(2,12,4,3); g.fillRect(10,16,5,3); g.fillRect(17,10,4,3); g.fillRect(7,20,3,2); g.fillRect(19,19,3,2);
    g.fillStyle(0x9a6a35); g.fillRect(4,9,2,2); g.fillRect(14,13,2,2); g.fillRect(20,16,2,2);
    g.fillStyle(0x1da84a); g.fillRect(0,0,24,7);
    g.fillStyle(0x2ecb5a); g.fillRect(0,4,24,1);
    g.fillStyle(0x3dff6e); g.fillRect(0,0,24,3); g.fillRect(2,3,2,3); g.fillRect(8,3,2,4); g.fillRect(14,3,2,3); g.fillRect(20,3,2,4);
    g.generateTexture('ground',24,24);
    // brick platform tile — offset stone blocks with bevel highlights + mortar
    g.clear();
    g.fillStyle(0x2a1c3e); g.fillRect(0,0,24,24);
    g.fillStyle(0x6b4a8f); g.fillRect(1,1,22,10); g.fillStyle(0x5a3d78); g.fillRect(1,13,22,10);
    g.fillStyle(0x8464ab); g.fillRect(2,2,20,2); g.fillRect(2,14,20,2);
    g.fillStyle(0x3f2a5c); g.fillRect(1,10,22,2); g.fillRect(1,22,22,1); g.fillRect(11,1,1,10); g.fillRect(6,13,1,10);
    g.generateTexture('brick',24,24);
    // crate — wooden box: plank face, X-brace, dark corner brackets
    g.clear();
    g.fillStyle(0x6b4222); g.fillRect(0,0,24,24);
    g.fillStyle(0xa5642f); g.fillRect(2,2,20,20);
    g.fillStyle(0xbb7a3e); g.fillRect(2,2,20,2);                       // top plank highlight
    g.fillStyle(0x854f24); g.fillRect(2,11,20,2);                      // mid plank seam
    g.lineStyle(3,0x5e3a1c); g.lineBetween(3,3,21,21); g.lineBetween(21,3,3,21);   // X brace
    g.fillStyle(0x3f2a16); g.fillRect(1,1,4,4); g.fillRect(19,1,4,4); g.fillRect(1,19,4,4); g.fillRect(19,19,4,4);
    g.generateTexture('crate',24,24);
    // stone — grey rock block: bevel + cracks/speckles
    g.clear();
    g.fillStyle(0x3f4450); g.fillRect(0,0,24,24);
    g.fillStyle(0x71788a); g.fillRect(1,1,22,22);
    g.fillStyle(0x9198a8); g.fillRect(2,2,20,3);                       // top bevel
    g.fillStyle(0x565c6a); g.fillRect(1,20,22,3);                      // bottom shade
    g.fillStyle(0x565c6a); g.fillRect(6,8,5,2); g.fillRect(13,13,6,2); g.fillRect(4,15,3,2); g.fillRect(15,5,3,2);
    g.generateTexture('stone',24,24);
    // steel — dark metal block with corner bolts + sheen
    g.clear();
    g.fillStyle(0x232c42); g.fillRect(0,0,24,24);
    g.fillStyle(0x4c5f86); g.fillRect(1,1,22,22);
    g.fillStyle(0x6f84ad); g.fillRect(2,2,20,4);                       // top sheen
    g.fillStyle(0x323d59); g.fillRect(1,18,22,5);                      // bottom shadow
    g.fillStyle(0x9fb3d6); g.fillCircle(4,4,1.7); g.fillCircle(20,4,1.7); g.fillCircle(4,20,1.7); g.fillCircle(20,20,1.7);
    g.generateTexture('steel',24,24);
    // ? bonus block — golden Mario-style block: bevel, corner rivets, blocky "?" glyph
    g.clear();
    g.fillStyle(0x8a5a10); g.fillRect(0,0,24,24);
    g.fillStyle(0xf5b820); g.fillRect(1,1,22,22);
    g.fillStyle(0xffd84a); g.fillRect(2,2,20,3);                        // top highlight
    g.fillStyle(0xb8860b); g.fillRect(1,19,22,3);                       // bottom shade
    g.fillStyle(0xfff0a0); g.fillCircle(4,4,1.5); g.fillCircle(20,4,1.5); g.fillCircle(4,20,1.5); g.fillCircle(20,20,1.5);
    g.fillStyle(0x5e3a0a);                                              // the NORMIE "N" glyph (not Mario's ?)
    g.fillRect(7,6,3,12); g.fillRect(15,6,3,12);                        // the two verticals
    g.fillRect(9,9,2,2); g.fillRect(11,11,2,2); g.fillRect(13,13,2,2);  // the diagonal stroke
    g.generateTexture('qblock',24,24);
    // spent bonus block — dull brown, rivets, no glyph (an emptied block)
    g.clear();
    g.fillStyle(0x6e4a20); g.fillRect(0,0,24,24);
    g.fillStyle(0x9a6a35); g.fillRect(1,1,22,22);
    g.fillStyle(0xb98a4a); g.fillRect(2,2,20,3);
    g.fillStyle(0x5e3c1a); g.fillRect(1,19,22,3);
    g.fillStyle(0x7a5228); g.fillCircle(4,4,1.5); g.fillCircle(20,4,1.5); g.fillCircle(4,20,1.5); g.fillCircle(20,20,1.5);
    g.generateTexture('qblockused',24,24);
    // (coin is the Bitcoin symbol generated at the top of create)
    // moving platform (48x14 metal)
    g.clear(); g.fillStyle(C.moverDk); g.fillRect(0,0,48,14); g.fillStyle(C.mover); g.fillRect(1,1,46,9); g.fillStyle(C.moverDk); for(var mx=4;mx<48;mx+=8) g.fillRect(mx,10,4,3); g.generateTexture('mover',48,14);
    // spike (24x14)
    g.clear(); g.fillStyle(C.spikeDk); g.fillTriangle(0,14,6,2,12,14); g.fillTriangle(12,14,18,2,24,14); g.fillStyle(C.spike); g.fillTriangle(2,14,6,5,10,14); g.fillTriangle(14,14,18,5,22,14); g.generateTexture('spike',24,14);
    // stick — a little dart the mini-worms spit (dark twig with a bright tip)
    g.clear(); g.fillStyle(0x2a1a0c); g.fillTriangle(0,3,13,0,13,6); g.fillRect(0,2,11,3); g.fillStyle(0x8a5a2b); g.fillRect(1,3,8,1); g.fillStyle(0x66ddff); g.fillTriangle(10,1,15,3,10,5); g.generateTexture('stick',15,6);
    // cactus — desert scenery for the Sand Lands interlude
    g.clear(); g.fillStyle(0x2f7d3a); g.fillRoundedRect(9,4,8,28,3); g.fillRoundedRect(2,12,6,10,3); g.fillRoundedRect(2,12,4,4,2); g.fillRoundedRect(18,9,6,12,3); g.fillRoundedRect(20,9,4,4,2); g.fillStyle(0x3fa050); g.fillRect(11,6,3,24); g.generateTexture('cactus',26,34);
    // heart
    g.clear(); g.fillStyle(C.danger); g.fillCircle(4,4,4); g.fillCircle(10,4,4); g.fillTriangle(0,6,14,6,7,14); g.generateTexture('heart',14,14);
    // cloud
    g.clear(); g.fillStyle(0x2f2668); g.fillCircle(10,12,8); g.fillCircle(22,9,10); g.fillCircle(33,13,7); g.fillRect(8,12,26,6); g.generateTexture('cloud',44,22);
    // touch button
    g.clear(); g.fillStyle(0x000000,0.001); g.fillRect(0,0,64,64); g.lineStyle(3,C.phos,0.9); g.strokeCircle(32,32,26); g.fillStyle(C.phos,0.14); g.fillCircle(32,32,26); g.generateTexture('btn',64,64);
    // (door is a real rendered Luxurious Lounge door sprite loaded via addBase64 in Boot)
    // key
    // (key is a real rendered crypto-key sprite loaded via addBase64 in Boot)
    g.clear(); g.fillStyle(0xffffff); g.fillCircle(3,3,3); g.generateTexture('spark',6,6);
    // FUD gas cloud (sickly green lumpy puff — slows the player while inside)
    g.clear(); g.fillStyle(0x7ec86e); g.fillCircle(11,17,10); g.fillCircle(21,14,11); g.fillCircle(26,21,9); g.fillCircle(15,23,9); g.generateTexture('gas',36,34);
    // sniper bolt (small red energy bullet)
    g.clear(); g.fillStyle(0xff4d4d); g.fillCircle(5,4,4); g.fillStyle(0xffd0d0); g.fillCircle(5,4,2); g.generateTexture('bullet',10,8);
    // (healing airdrop is a real rendered sprite loaded via addBase64 in Boot)
    // (solana is a real rendered Solana coin sprite loaded via addBase64 in Boot)
    g.destroy();

    // load the base64 character/enemy/power-up sprites, start Title once all registered
    var self=this, all=Object.assign({},SPRITES,POWERUPS,EXTRA), keys=Object.keys(all), need=keys.length, started=false;
    var go=function(){ if(started) return; started=true; self.scene.start('Title'); };
    keys.forEach(function(k){ self.textures.once('addtexture-'+k, function(){ if(--need<=0) go(); }); self.textures.addBase64(k, all[k]); });
    this.time.delayedCall(3500, go);   // fallback so a decode hiccup never hangs boot
  }
});

/* ---------- Title ---------- */
/* ---------- Level Select (TEST BUILD only) — jump to any level, no play-through ---------- */
var LevelSelect=new Phaser.Class({ Extends:Phaser.Scene,
  initialize:function(){ Phaser.Scene.call(this,{key:'LevelSelect'}); },
  create:function(){
    var self=this;
    this.cameras.main.setZoom(2).centerOn(W/2,H/2); this.cameras.main.setBackgroundColor(0x0b0a1c);
    this.add.text(W/2,14,'LEVEL SELECT',{fontFamily:'"Press Start 2P"',fontSize:'13px',color:'#ffd23f'}).setOrigin(.5);
    this.add.text(W/2,30,'TEST BUILD · tap any level',{fontFamily:'VT323',fontSize:'15px',color:'#8f89b0'}).setOrigin(.5);
    // group levels by world (first digit of the "w-n" name), rendered dynamically from LEVELS
    var worlds={}, order=[];
    LEVELS.forEach(function(l,i){ if(l.hidden) return; var w=(l.name||'').split('-')[0]||'?'; if(!worlds[w]){ worlds[w]=[]; order.push(w); } worlds[w].push({l:l,i:i}); });   // hidden bonus levels never show in level-select
    // Dynamic row height so EVERY world fits on one screen no matter how many there are (no scroll).
    var top=42, n=order.length, rowH=Math.max(20,Math.min(32,Math.floor((H-26-top)/n))), cardH=rowH-5, y=top;
    order.forEach(function(w){
      var cy=y+rowH/2;
      self.add.text(22,cy,'W'+w,{fontFamily:'"Press Start 2P"',fontSize:'8px',color:'#66ccff'}).setOrigin(0,.5);
      worlds[w].forEach(function(o,c){
        var x=52+c*138, isBoss=!!o.l.boss;
        var sub=(o.l.sub||''); if(sub.length>17) sub=sub.slice(0,16)+'…';
        var box=self.add.rectangle(x,cy,130,cardH,isBoss?0x351033:0x141a2e,1).setStrokeStyle(2,isBoss?0xff3860:0x2a4a6a).setOrigin(0,.5).setInteractive({useHandCursor:true});
        self.add.text(x+8,cy-cardH*0.24,o.l.name,{fontFamily:'"Press Start 2P"',fontSize:'7px',color:isBoss?'#ff6a99':'#ffffff'}).setOrigin(0,.5);
        self.add.text(x+8,cy+cardH*0.27,(isBoss?'★ ':'')+sub,{fontFamily:'VT323',fontSize:'10px',color:'#9a95bd'}).setOrigin(0,.5);
        var go=function(){ self.scene.start('Game',{level:o.i,score:0,lives:3}); };
        box.on('pointerdown',go);
        box.on('pointerover',function(){ box.setFillStyle(isBoss?0x4a1848:0x1e2842,1); });
        box.on('pointerout',function(){ box.setFillStyle(isBoss?0x351033:0x141a2e,1); });
      });
      y+=rowH;
    });
    this.add.text(W/2,H-8,'in a level: press L to return here  ·  tap any card to play',{fontFamily:'VT323',fontSize:'12px',color:'#6a6590'}).setOrigin(.5);
    try{ if(typeof window!=='undefined') window.__NQ_LEVEL='level-select'; }catch(e){}
  }
});

var Title=new Phaser.Class({ Extends:Phaser.Scene,
  initialize:function(){ Phaser.Scene.call(this,{key:'Title'}); },
  create:function(){
    this.cameras.main.setZoom(2).centerOn(W/2,H/2); this.cameras.main.setBackgroundColor(0x120c2e);
    this.add.image(90,70,'cloud').setScale(1.4).setAlpha(.7); this.add.image(360,50,'cloud').setScale(1.1).setAlpha(.6);
    // clean gold logo — a crisp drop shadow, NO blurry glow FX (looked smeared)
    this.add.text(W/2,66,'NORMIE\nQUEST',{fontFamily:'"Press Start 2P"',fontSize:'26px',color:'#ffd23f',align:'center',lineSpacing:10}).setOrigin(.5).setShadow(4,4,'#5a3c00',0,true,true);
    var tcoin=this.add.image(W/2-68,152,'coin'); tcoin.setScale(28/tcoin.height);
    // Normie: the centerpiece, height-normalized so it fits between the logo and "TAP TO PLAY"
    // (must not overlap the title text — the sprite canvas is tall, so scale by height).
    var hero=this.add.image(W/2,150,'normie'); hero.setScale(80/hero.height);
    if(this.renderer.type===Phaser.WEBGL){ try{ hero.postFX.addGlow(0x66ccff,1.2,0,false,0.1,16); }catch(e){} }
    this.tweens.add({targets:hero,y:145,duration:900,yoyo:true,repeat:-1,ease:'Sine.inOut'});
    var tj=this.add.image(W/2+68,152,'jeet'); tj.setScale(38/tj.height);
    var p=this.add.text(W/2,200,BURN_GATE?'PRESS TO INSERT BURN':'TAP TO PLAY',{fontFamily:'"Press Start 2P"',fontSize:'11px',color:'#3dff6e'}).setOrigin(.5);
    this.tweens.add({targets:p,alpha:.25,duration:600,yoyo:true,repeat:-1});
    this.add.text(W/2,246,(Math.ceil(LEVELS.filter(function(l){return !l.hidden;}).length/3))+' worlds + a hidden one \u00B7 a Cluck Norris production',{fontFamily:'VT323',fontSize:'16px',color:'#8f89b0'}).setOrigin(.5);
    // BURN_GATE is OFF for now \u2192 free preview: tap straight into the game. The burn Gate
    // (and its /api/nq backend) stay wired but dormant until we "put it together" later.
    var self=this;
    var go=function(){ if(this.started) return; this.started=true; if(BURN_GATE) this.scene.start('Gate'); else this.scene.start('Controls',{next:0,score:0}); };
    // Tap anywhere = play from 1-1 (both modes). In TEST BUILD, the reliable DOM "≡ Levels"
    // button (bottom-left, works from here too) is how you reach LEVEL SELECT.
    this.input.once('pointerdown',go,this); this.input.keyboard.once('keydown',go,this);
    if(TEST_MODE){ this.add.text(W/2,262,'TEST BUILD · tap ≡ Levels below to pick a level',{fontFamily:'VT323',fontSize:'14px',color:'#ffd23f'}).setOrigin(.5); }
  }
});

/* ---------- Gate: simulated burn-to-play ---------- */
var Gate=new Phaser.Class({ Extends:Phaser.Scene,
  initialize:function(){ Phaser.Scene.call(this,{key:'Gate'}); },
  create:function(){
    this.cameras.main.setZoom(2).centerOn(W/2,H/2); this.cameras.main.setBackgroundColor(C.ink);
    var code='NQ-'+Math.random().toString(36).slice(2,6).toUpperCase();
    this.add.text(W/2,34,'BURN TO PLAY',{fontFamily:'"Press Start 2P"',fontSize:'18px',color:'#ff3860'}).setOrigin(.5);
    this.add.text(W/2,82,'send 1,000 NORMIE with memo:',{fontFamily:'VT323',fontSize:'21px',color:'#8f89b0'}).setOrigin(.5);
    this.add.text(W/2,108,code,{fontFamily:'"Press Start 2P"',fontSize:'20px',color:'#ffd23f'}).setOrigin(.5);
    this.add.text(W/2,138,'to  1nc1nerator1111...1111',{fontFamily:'VT323',fontSize:'19px',color:'#8f89b0'}).setOrigin(.5);
    var btn=this.add.text(W/2,186,'[ SIMULATE BURN CONFIRMED ]',{fontFamily:'"Press Start 2P"',fontSize:'11px',color:'#0d0b1e',backgroundColor:'#3dff6e',padding:{x:12,y:9}}).setOrigin(.5).setInteractive({useHandCursor:true});
    btn.on('pointerover',function(){ btn.setStyle({backgroundColor:'#ffffff'}); }); btn.on('pointerout',function(){ btn.setStyle({backgroundColor:'#3dff6e'}); });
    btn.on('pointerdown',function(){
      _ac(); btn.disableInteractive();
      var s=this.add.text(W/2,226,'watching chain',{fontFamily:'VT323',fontSize:'21px',color:'#3dff6e'}).setOrigin(.5); var dots=0;
      this.time.addEvent({delay:350,repeat:4,callback:function(){ dots++; s.setText('watching chain'+'.'.repeat(dots)); }});
      this.time.delayedCall(1900,function(){ s.setText('BURN CONFIRMED — GO!').setColor('#ffd23f'); this.time.delayedCall(700,function(){ this.scene.start('Controls',{next:0,score:0}); },[],this); },[],this);
    },this);
    this.add.text(W/2,254,'demo only — nothing really burns yet',{fontFamily:'VT323',fontSize:'16px',color:'#544d75'}).setOrigin(.5);
  }
});

/* ---------- Game (data-driven, multi-level) ---------- */
var Game=new Phaser.Class({ Extends:Phaser.Scene,
  initialize:function(){ Phaser.Scene.call(this,{key:'Game'}); },
  // levelStartScore = coins banked BEFORE this level; honeypots never drain below it (they only take THIS level's coins).
  init:function(d){ d=d||{}; this.levelIdx=Phaser.Math.Clamp(d.level||0,0,LEVELS.length-1); this.score=d.score||0; this.lives=(d.lives!=null?d.lives:3); this.levelStartScore=this.score; this._spawnX=(d.spawnX!=null?d.spawnX:null); },

  create:function(){
    this.physics.resume();   // CRITICAL: the Arcade world stays paused across scene restarts; every level/replay must un-pause it
    this.paused=false; this.lastInputAt=this.time.now;   // pause state + idle-auto-pause timer
    var self=this, i;
    var def=this.def=LEVELS[this.levelIdx];
    var LW=this.LW=def.width, th=THEMES[def.theme];
    // background music — per-world mood (boss arenas get the boss theme; 1-3's Rug King switches in startBoss)
    try{ var w0=def.name.charAt(0); var mt=(def.boss&&def.bossType)?'boss':(w0==='1'?'world1':def.name==='2-1'?'desert':def.name==='2-2'?'casino':w0==='3'?'skyline':w0==='4'?'exchange':w0==='5'?'sacred':w0==='6'?'mines':w0==='7'?'exchange':w0==='8'?'boss':'world1'); MUSIC.forWorld(mt); }catch(e){}
    // Difficulty profile: deliberate ramp by WORLD. Worlds 1 (lvl 0-2)=baseline, World 2
    // (3-5)=+15% enemy speed, World 3 (6-8)=+30%. Per-level override via def.diff.
    this.diffMul = def.diff || [1,1,1,1.15,1.15,1.15,1.3,1.3,1.3,1.45,1.45,1.55,1.6,1.6,1.7,1.75,1.75,1.85,1.9,1.9,2.0,2.1,2.1,2.25][this.levelIdx] || 1;
    this.timeLeft=def.time; this.over=false; this.hasKey=false; this._doorHint=false;
    if(this.levelIdx===0){ this.registry.set('nqCasino',0); this.registry.set('nqCp',0); this.registry.set('nqCpScore',0); }   // fresh run → zero the casino tally + clear all world checkpoints
    this.spawn={x:(this._spawnX!=null?this._spawnX:60),y:H-60};
    Phaser.Math.RND.sow(['normie-quest-'+this.levelIdx]);   // deterministic per level

    this.physics.world.setBounds(0,0,LW,H+400);
    this.cameras.main.setBounds(0,0,LW,H); this.cameras.main.setZoom(2); this.cameras.main.setBackgroundColor(th.sky1);
    if(this.renderer.type===Phaser.WEBGL){ try{ this.cameras.main.postFX.addVignette(0.5,0.5,0.92,0.32); }catch(e){} }   // cinematic depth

    // Backdrop drawn in WORLD space across the whole level (0..LW) — no scrollFactor-0/zoom
    // math, so it ALWAYS fills the screen and a seam is physically impossible. Smooth vertical
    // gradient sky (no hard colour-band edges either), then parallax stars/clouds/mountains.
    var yJoin=Math.floor(H*0.62);
    var sky=this.add.graphics().setScrollFactor(1).setDepth(-60);
    sky.fillGradientStyle(th.sky2,th.sky2,th.sky1,th.sky1,1); sky.fillRect(-W,0,LW+W*2,yJoin);
    sky.fillGradientStyle(th.sky1,th.sky1,th.hill,th.hill,1); sky.fillRect(-W,yJoin,LW+W*2,H-yJoin);
    // stars scattered across the whole level with a slight parallax
    for(i=0;i<Math.ceil(LW/90);i++){ var ss=Phaser.Math.RND.pick([1,1,1,2]); this.add.rectangle(Phaser.Math.RND.between(0,LW),Phaser.Math.RND.between(3,Math.floor(H*0.6)),ss,ss,0xffffff,Phaser.Math.RND.between(18,50)/100).setScrollFactor(0.25).setDepth(-55); }
    for(i=0;i<Math.ceil(LW/210);i++) this.add.image(i*210+((i*37)%110),26+((i*41)%54),'cloud').setScrollFactor(0.18).setAlpha(.28).setScale(1.3+(i%3)*0.4);
    if(def.bgImage && this.textures.exists(def.bgImage)){
      // VEGAS strip: a neon casino skyline rising out of the desert (parallax band), with a low
      // foreground dune so it reads as "the strip transitioning from the sand places".
      var bsrc=this.textures.get(def.bgImage).getSourceImage(), bAsp=(bsrc&&bsrc.width/bsrc.height)||2;
      var bH=Math.floor(H*0.58), bW=Math.floor(bH*bAsp);
      for(var bx=-W; bx<LW+W; bx+=bW-2) this.add.image(bx, GY-2, def.bgImage).setOrigin(0,1).setDisplaySize(bW,bH).setScrollFactor(0.42).setDepth(-50).setAlpha(0.97);
      for(i=0;i<Math.ceil(LW/300)+1;i++) this.add.triangle(i*300+90,H,0,0,150,-64-((i*29)%40),300,0,th.hill).setOrigin(0,0).setScrollFactor(0.56).setDepth(-45);
    } else {
      for(i=0;i<Math.ceil(LW/260)+1;i++) this.add.triangle(i*260,H,0,0,130,-70-((i*37)%60),260,0,th.sky2).setOrigin(0,0).setScrollFactor(0.32).setAlpha(0.9);
      for(i=0;i<Math.ceil(LW/300)+1;i++) this.add.triangle(i*300+90,H,0,0,150,-104-((i*29)%54),300,0,th.hill).setOrigin(0,0).setScrollFactor(0.56);
    }

    // ground with pits
    this.platforms=this.physics.add.staticGroup();
    var gaps=def.gaps||[];
    var inGap=function(x){ for(var j=0;j<gaps.length;j++){ if(x>=gaps[j][0]&&x<gaps[j][1]) return true; } return false; };
    this.gaps=gaps;   // stored for overPit() — the cheap ledge guard used by ground-lane patrols
    for(var gx=0;gx<LW;gx+=TILE){ if(!inGap(gx)){ this.platforms.create(gx+TILE/2,GY+TILE/2,'ground'); this.platforms.create(gx+TILE/2,GY+TILE/2+TILE,'ground'); } }
    // floating platforms — plat:[x,count,topY,type?]  (type defaults to brick)
    (def.plats||[]).forEach(function(pl){ var t=pl[3]||'brick'; for(var k=0;k<pl[1];k++) self.platforms.create(pl[0]+k*TILE+TILE/2,pl[2]+TILE/2,t); });
    // obstacle blocks (stacked on the ground) — force the player to jump.
    // wall:[x,heightTiles,type?,widthTiles?] — type (brick/crate/stone/steel) + width vary
    // the look & shape so obstacles aren't all identical. Tall walls stay 1-wide (jumpable);
    // wide walls are kept short.
    (def.walls||[]).forEach(function(wl){ var t=wl[2]||'brick', wide=wl[3]||1;
      for(var k=0;k<wl[1];k++) for(var w=0;w<wide;w++) self.platforms.create(wl[0]+w*TILE+TILE/2, GY-k*TILE-TILE/2, t); });

    // moving platforms
    this.movers=this.physics.add.group({allowGravity:false,immovable:true});
    (def.movers||[]).forEach(function(mv){
      var m=self.movers.create(mv[0],mv[1],'mover');
      m.body.setAllowGravity(false); m.body.setImmovable(true);
      m.axis=mv[2]; m.homeX=mv[0]; m.homeY=mv[1]; m.range=mv[3]; m.speed=mv[4]; m.dir=1; m.prevX=mv[0]; m.prevY=mv[1];
    });

    // spikes (hazard)
    this.spikes=this.physics.add.staticGroup();
    (def.spikes||[]).forEach(function(sp){ var s=self.spikes.create(sp[0]+TILE/2,GY-1,'spike'); s.body.setSize(20,10).setOffset(2,4); });

    // coins
    this.coins=this.physics.add.group({allowGravity:false});
    (def.coins||[]).forEach(function(cn){ var c=self.coins.create(cn[0],cn[1],'coin'); var cs=23/c.height; c.setScale(cs); self.tweens.add({targets:c,scale:cs*1.14,duration:420,yoyo:true,repeat:-1}); });

    // Normie Casino slot machines — stand by one and press jump/up to "fire it in" for bonus
    // coins. Supports MANY machines per level (def.slots:[[x,theme],...]); each has its own state.
    this.slots=[];
    var slotDefs = def.slots || (def.slot!=null ? [[def.slot, def.slotTheme]] : []);
    slotDefs.forEach(function(sd){
      var stheme=SLOT_THEMES[sd[1]]||SLOT_THEMES.casino;
      var sm=self.add.image(sd[0], GY, 'slot').setDepth(6); sm.setScale(74/sm.height); sm.setTint(stheme.tint);
      sm.y=GY - sm.displayHeight/2 + 8; self.addGlow(sm,stheme.glow,3);
      self.add.text(sm.x, sm.y-sm.displayHeight*0.5-30, stheme.name, {fontFamily:'"Press Start 2P"',fontSize:'6px',color:stheme.txt}).setOrigin(.5).setDepth(20);
      var ry=sm.y - sm.displayHeight*0.5 - 15;
      var reelBox=self.add.rectangle(sm.x, ry, 62, 22, 0x140a20, 0.92).setStrokeStyle(2,stheme.box).setDepth(20).setVisible(false);
      var reelIcons=[]; for(var ri=0;ri<3;ri++){ var ic=self.add.image(sm.x-18+ri*18, ry, stheme.syms[0]).setDepth(21).setVisible(false); ic.setDisplaySize(16,16); reelIcons.push(ic); }
      var prompt=self.add.text(sm.x, sm.y-sm.displayHeight*0.60, '', {fontFamily:'"Press Start 2P"',fontSize:'7px',color:stheme.txt,align:'center',lineSpacing:3}).setOrigin(.5,1).setDepth(20).setVisible(false);
      // ALWAYS-ON discoverability hint floating above the machine (bobs so you spot it from a distance)
      var tapHint=self.add.text(sm.x, sm.y-sm.displayHeight*0.5-44, 'TAP TO SPIN ▾', {fontFamily:'"Press Start 2P"',fontSize:'6px',color:'#ffd23f'}).setOrigin(.5).setDepth(20);
      self.tweens.add({targets:tapHint, y:tapHint.y-3, duration:620, yoyo:true, repeat:-1, ease:'Sine.inOut'});
      var S={ m:sm, reelBox:reelBox, reelIcons:reelIcons, prompt:prompt, tapHint:tapHint, syms:stheme.syms, label:stheme.label, spinsLeft:(stheme.spins||3), big:!!stheme.big, mult:(stheme.mult||1), spin:null };
      self.slots.push(S);
      // TAP the machine to spin (no jump needed). Generous hit area + reach so you can spin from a
      // little distance (the reach gate lives in trySpinSlot). Bigger box covers the reels above too.
      sm.setInteractive(new Phaser.Geom.Rectangle(-sm.width*0.6, -sm.height*1.2, sm.width*1.2, sm.height*1.9), Phaser.Geom.Rectangle.Contains);
      sm.on('pointerdown', function(){ self.trySpinSlot(S); });
    });

    // 💰 COIN CACHES — hidden treasure piles that pay out a big chunk at once (def.caches:[[x,y,n]])
    this.caches=this.physics.add.staticGroup();
    (def.caches||[]).forEach(function(ca){ var pile=self.caches.create(ca[0], (ca[1]!=null?ca[1]:GY-18), 'coin').setDepth(6);
      pile.setScale(46/pile.height); pile.cacheN=ca[2]||100; pile.body.setSize(pile.width*1.3,pile.height*1.3); self.addGlow(pile,0xffd23f,6);
      self.tweens.add({targets:pile, scaleX:pile.scaleX*1.13, scaleY:pile.scaleY*1.13, duration:520, yoyo:true, repeat:-1, ease:'Sine.inOut'}); });

    // 🚪 SPEAKEASY warps — hidden back-doors to bonus rooms; DUCK in front to slip in.
    //   def.warps:[[x, targetIdx, hint]]  hint truthy → a periodic glint FLASH + sign draws the eye;
    //   hint falsy → a faint unmarked door you can only find by ducking around (random discovery).
    this.warps=this.physics.add.staticGroup(); this._warping=false; this._warpCool=(this._spawnX!=null?this.time.now+1400:0);
    (def.warps||[]).forEach(function(wp){ var hint=wp[2];
      var w=self.warps.create(wp[0], GY, 'door').setDepth(2); w.setScale(64/w.height); w.y=GY-w.displayHeight/2+8;
      w.setTint(hint?0x6a3aa0:0x36244a).setAlpha(hint?0.9:0.5); w.refreshBody(); w.target=wp[1];
      if(hint){
        self.addGlow(w,0x9b5bff,3);
        var sign=self.add.text(wp[0], w.y-w.displayHeight*0.5-10, 'SPEAKEASY\n▾ DUCK', {fontFamily:'"Press Start 2P"',fontSize:'6px',color:'#c99bff',align:'center',lineSpacing:3}).setOrigin(.5).setDepth(20);
        self.tweens.add({targets:sign, y:sign.y-3, duration:760, yoyo:true, repeat:-1, ease:'Sine.inOut'});
        var glint=self.add.image(wp[0], w.y-w.displayHeight*0.32, 'spark').setDepth(21).setScale(2).setAlpha(0).setTint(0xffe66a).setBlendMode('ADD');
        self.tweens.add({targets:glint, alpha:1, scaleX:3.6, scaleY:3.6, duration:420, yoyo:true, repeat:-1, repeatDelay:1500, ease:'Quad.out'});
        self.time.addEvent({delay:2400, loop:true, callback:function(){ if(!self.over) self.burst(wp[0], w.y-w.displayHeight*0.42, 0xffe66a, 8); }});
      }
    });

    // key
    var k=def.key; this.key=this.physics.add.sprite(k[0],k[1],'key').setDepth(6); this.key.setScale(30/this.key.height);
    this.key.body.setAllowGravity(false); this.key.body.setSize(this.key.width*0.9,this.key.height*0.9).setOffset(this.key.width*0.05,this.key.height*0.05);
    this.tweens.add({targets:this.key,y:k[1]-10,duration:700,yoyo:true,repeat:-1,ease:'Sine.inOut'});
    var kg=this.addGlow(this.key,0xffd23f,4); if(kg) this.tweens.add({targets:kg,outerStrength:10,duration:700,yoyo:true,repeat:-1,ease:'Sine.inOut'});

    // door — THE LUXURIOUS LOUNGE: a grand building portal, ~3x Normie's height (Mario-castle
    // style). Overlap-only trigger, sits on the ground, rendered behind the player.
    this.door=this.physics.add.staticSprite(def.door,GY-8,'door').setDepth(3); this.door.setScale(114/this.door.height);
    this.door.y=GY-this.door.displayHeight/2+10; this.door.refreshBody();   // sit on the ground
    this.addGlow(this.door,0xffb43d,4);   // warm amber glow — the Luxurious Lounge
    // "TLLT" scrolling marquee over the building's baked (blank) sign panel: a dark face covers
    // the panel, a masked gold ticker scrolls across it — reads as a live lounge marquee.
    var dw=this.door.displayWidth, dh=this.door.displayHeight;
    var bandX=this.door.x+dw*0.05, bandY=this.door.y-dh*0.10, bandW=dw*0.56, bandH=dh*0.072;
    this.add.rectangle(bandX, bandY, bandW, bandH, 0x180c02, 1).setDepth(4);
    var mrect=this.add.rectangle(bandX, bandY, bandW, bandH, 0x000000, 0).setDepth(5);
    var marq=this.add.text(bandX-bandW/2, bandY, 'TLLT  TLLT  TLLT  TLLT  ',
      {fontFamily:'"Press Start 2P"',fontSize:'7px',color:'#ffd23f'}).setOrigin(0,.5).setDepth(5);
    marq.setMask(mrect.createGeometryMask());
    var _u=this.add.text(-999,-999,'TLLT  ',{fontFamily:'"Press Start 2P"',fontSize:'7px'}); var uw=_u.width; _u.destroy();
    this.tweens.add({targets:marq, x:bandX-bandW/2-uw, duration:1500, repeat:-1, ease:'Linear'});

    // enemies
    this.enemies=this.physics.add.group();
    (def.enemies||[]).forEach(function(en){ self.makeEnemy(en[0],en[1],en[2],en[3]); });

    // mini-worms (World 2 hazard): burrow, pop up, spit a radial fan of sticks, retreat.
    this.miniworms=this.physics.add.group({allowGravity:false,immovable:true});
    this.enemyShots=this.physics.add.group({allowGravity:false});
    (def.miniworms||[]).forEach(function(mx,i){
      var mw=self.miniworms.create(mx, GY, 'miniworm').setDepth(6); mw.setScale(44/mw.height);
      mw.body.setAllowGravity(false); mw.setImmovable(true);
      mw.body.setSize(mw.width*0.6, mw.height*0.5).setOffset(mw.width*0.2, mw.height*0.34);
      mw.upY=GY - mw.displayHeight/2 + 14; mw.downY=GY + mw.displayHeight/2 + 6;
      mw.setPosition(mx, mw.downY).setVisible(false); mw.mwState='hidden'; mw.dead=false;
      mw.mwNextAt=self.time.now + 900 + i*450 + Phaser.Math.RND.between(0,700);
      var mg=self.addGlow(mw,0x3dff6e,3); if(mg) self.tweens.add({targets:mg,outerStrength:8,duration:600,yoyo:true,repeat:-1,ease:'Sine.inOut'});
    });

    // ---- Phase 2 hazards ----
    this.slowUntil=0;                                            // FUD gas slow debuff
    this.gasClouds=this.physics.add.group({allowGravity:false});// FUDster's drifting slow-gas
    // Honeypots — mimic traps disguised as treasure; snap once on contact
    this.honeypots=this.physics.add.group({allowGravity:false,immovable:true});
    (def.honeypots||[]).forEach(function(h){
      var hp=self.honeypots.create(h[0], h[1], 'honeypot').setDepth(6); hp.setScale(34/hp.height);
      hp.body.setAllowGravity(false); hp.body.setSize(hp.width*0.8,hp.height*0.7); hp.sprung=false;
      self.tweens.add({targets:hp,y:h[1]-6,duration:900,yoyo:true,repeat:-1,ease:'Sine.inOut'});
      var hg=self.addGlow(hp,0xffd23f,3); if(hg) self.tweens.add({targets:hg,outerStrength:8,duration:700,yoyo:true,repeat:-1,ease:'Sine.inOut'});
    });
    // Pump-&-Dump platforms — solid until you step on them, then they DUMP (fall away) & respawn
    this.pumpDumps=this.physics.add.staticGroup();
    (def.pumpdumps||[]).forEach(function(pd){
      var m=self.pumpDumps.create(pd[0], pd[1], 'mover').setDepth(5); m.setScale(1.15,1.25); m.refreshBody();
      m.setTint(0x3dff9e); m.homeX=m.x; m.homeY=m.y; m.pdState='idle';
    });
    // THE BRIDGE — collapsing planks. plank:[startX, countTiles] = a run of ground-level planks
    // spanning a gap. Step on one and ~a quarter-second later it "gets exploited" and drops into the
    // void, respawning after a beat — so you must keep moving across a bridge, never stand still.
    this.bridgePlanks=this.physics.add.staticGroup();
    (def.planks||[]).forEach(function(bp){ var count=bp[1]||3;
      for(var k=0;k<count;k++){ var m=self.bridgePlanks.create(bp[0]+k*TILE+TILE/2, GY+TILE/2, 'ground').setDepth(4);
        m.setTint(0x8a5a2b); m.homeY=m.y; m.bpState='idle'; m.bpAt=0; m.refreshBody(); } });
    // THE DEPEG — "stable" ground that isn't. peg:[startX, countTiles] = a run of stablecoin-mint
    // ground tiles. On a global cycle they all DEPEG at once (telegraphed flash → drop into the void
    // → restore), so you time your crossing to the peg's rhythm. Stand on one when it breaks = fall.
    this.pegs=this.physics.add.staticGroup();
    (def.pegs||[]).forEach(function(pg){ var count=pg[1]||3;
      for(var k=0;k<count;k++){ var m=self.pegs.create(pg[0]+k*TILE+TILE/2, GY+TILE/2, 'ground').setDepth(4);
        m.setTint(0x2ee6a0); m.homeY=m.y; m.refreshBody(); } });
    this.depegPhase='stable'; this.depegNextAt=this.time.now+4200;   // first depeg has a grace period
    // THE YIELD FARM — compounding LIFT platforms. yield:[x, baseY?, steps?] = a platform that
    // COMPOUNDS while you stand on it: it ratchets UP one step every ~520ms (your yield stacking),
    // glowing brighter-green as APY rises, up to `steps` steps; hit the top and it HARVESTS (pays a
    // one-time coin bonus + gold flash). Step off and it slowly DE-COMPOUNDS back to base. Kinematic
    // (immovable, no gravity) so it carries you up — ride the rise to reach the high ledges/coins.
    this.yields=this.physics.add.staticGroup();   // STATIC bodies moved by position each frame (reliable; the rider is carried explicitly)
    (def.yields||[]).forEach(function(yd){
      var baseY=(yd[1]!=null)?yd[1]:(H-96), steps=(yd[2]!=null)?yd[2]:4;
      var m=self.yields.create(yd[0], baseY, 'mover');
      m.setTint(0x2ee66a); m.homeY=baseY; m.stepPx=22; m.maxSteps=steps;
      m.yLevel=0; m.compAt=0; m.harvested=false; m.refreshBody();
      var yg=self.addGlow(m,0x2ee66a,3); if(yg) m.yGlow=yg;
    });
    this.yieldStepMs=520;
    // THE LIQUIDATION CASCADE (World 8) — a wall of red liquidation grinds in from the LEFT and eats
    // the level. Fall behind its edge and you're LIQUIDATED (lose a heart + shoved back ahead of it).
    // Keep moving right. def.cascade:[startX, pxPerSec]. Immunity powers (diamond/moon/giga/whale/cold)
    // let you touch it unharmed. Rendered as a crash-red curtain with a bright jagged edge.
    this.cascade=null;
    if(def.cascade){ var cg=this.add.graphics().setDepth(9);
      this.cascade={ x:def.cascade[0], speed:(def.cascade[1]||34), g:cg, nextRumble:0, lastNow:this.time.now }; }
    // ? BONUS BLOCKS — Mario-style. bonusblock:[x, reward, y?] at head-bonk height. Bonk from BELOW
    // → pops coins (reward = number) or a power-up (reward = a power-up key string). Solid: stand on
    // top, bonk from under. Once hit it turns into a spent block.
    this.bonusBlocks=this.physics.add.staticGroup();
    (def.bonusblocks||[]).forEach(function(bb){ var by=(bb[2]!=null)?bb[2]:(H-96);
      var m=self.bonusBlocks.create(bb[0], by, 'qblock').setDepth(4); m.reward=bb[1]; m.used=false; m.homeY=by; m.hitsLeft=1;
      // MULTI-HIT: ~1 in 3 COIN blocks becomes a random 3-5 hit dispenser (surprise bonus)
      if(typeof m.reward==='number' && Phaser.Math.Between(1,100)<=32){ m.multi=Phaser.Math.Between(3,5); m.hitsLeft=m.multi; }
      m.refreshBody();
      self.tweens.add({targets:m, scaleY:1.06, duration:560, yoyo:true, repeat:-1, ease:'Sine.inOut'}); });
    // "Wen Lambo" NPCs — harmless crypto-degen bystanders who pace and shout. No damage/help.
    this.npcs=this.physics.add.group();
    (def.npcs||[]).forEach(function(np){
      var n=self.npcs.create(np[0], GY-20, 'wenlambo').setDepth(6); n.setScale(32/n.height);
      n.body.setSize(n.width*0.6,n.height*0.85).setOffset(n.width*0.2,n.height*0.12);
      n.setCollideWorldBounds(true); n.homeX=np[0]; n.range=np[1]||90; n.dir=Phaser.Math.RND.pick([-1,1]);
      n.baseSpeed=38; n.nextSay=self.time.now+800+Phaser.Math.RND.between(0,1600);
    });
    // Casino folk — Drink Ladies (take your money) & Show Ladies (a Lil Normie = CHILD SUPPORT!)
    this.kids=0; this.childSupportAt=0;
    this.casino=this.physics.add.group();
    (def.casinoFolk||[]).forEach(function(cf){
      var tex = cf[1]==='show' ? 'showlady' : 'drinklady';
      var f=self.casino.create(cf[0], GY-20, tex).setDepth(6); f.setScale((cf[1]==='show'?40:34)/f.height);
      f.body.setSize(f.width*0.5,f.height*0.85).setOffset(f.width*0.25,f.height*0.12);
      f.setCollideWorldBounds(true); f.folk=cf[1]; f.homeX=cf[0]; f.range=cf[2]||70; f.dir=Phaser.Math.RND.pick([-1,1]); f.baseSpeed=32; f.coolUntil=0;
    });

    // power-ups — bigger & premium: each pulses with a coloured glow halo
    var PUCOL={ diamond:0x66ddff, bull:0x3dff6e, moon:0xffd23f, caffeine:0xffffff, candle:0x3dff6e, solana:0x14f195, omegachad:0xffa020, supergeek:0x2ee6c0, whale:0x2f7fff, coldwallet:0x9fe8ff, megawhale:0x1f6fff };
    // GREEN CANDLE MODE pickup icon — a rising green candlestick chart (drawn once), distinct from the heal candle
    if(!this.textures.exists('greencandle')){ var gcx=this.make.graphics({x:0,y:0,add:false});
      [[4,28,12],[17,18,22],[30,8,32]].forEach(function(c){ gcx.fillStyle(0x0a3a1e,1); gcx.fillRect(c[0]+3,c[1]-7,3,7); gcx.fillRect(c[0]+3,c[1]+c[2],3,6); gcx.fillStyle(0x2ee66a,1); gcx.fillRect(c[0],c[1],9,c[2]); gcx.lineStyle(2,0x0a3a1e,1); gcx.strokeRect(c[0],c[1],9,c[2]); });
      gcx.generateTexture('greencandle',44,44); gcx.destroy(); }
    this.powerups=this.physics.add.group({allowGravity:false});
    (def.powerups||[]).forEach(function(pw){
      var o=self.powerups.create(pw[1],pw[2],pw[0]); o.ptype=pw[0];
      o.setScale((pw[0]==='candle'?46:40)/o.height).setDepth(6);
      o.body.setAllowGravity(false); o.body.setSize(o.width*1.6,o.height*1.4);
      self.tweens.add({targets:o,y:pw[2]-11,duration:800,yoyo:true,repeat:-1,ease:'Sine.inOut'});
      var pg=self.addGlow(o, PUCOL[pw[0]]||0xffffff, 4);
      if(pg) self.tweens.add({targets:pg,outerStrength:11,duration:620,yoyo:true,repeat:-1,ease:'Sine.inOut'});
    });
    // healing airdrops — 1-2 per level; they only PARACHUTE IN once you've taken damage
    // (lives<3), and vanish again if you heal back to full. Start hidden & body-disabled.
    this.airdrops=this.physics.add.group({allowGravity:false});
    (def.airdrops||[]).forEach(function(ad){
      var a=self.airdrops.create(ad[0],ad[1],'airdrop').setDepth(6);
      a.setScale(42/a.height);
      a.body.setAllowGravity(false); a.body.setSize(a.width*1.2,a.height*1.1);
      a.restY=ad[1]; a.shown=false; a.consumed=false; a.bob=null;
      a.setVisible(false).setActive(false); a.body.enable=false; a.setAlpha(0);
      a.glowFx=self.addGlow(a,0x3dff6e,3);
    });
    this.shieldUntil=0; this.bullUntil=0; this.moonUntil=0; this.caffeineUntil=0; this.solanaUntil=0;
    this.omegaUntil=0; this.geekShield=false;   // Omega Chad transform + Super Geek one-hit shield
    this.whaleUntil=0; this.coldUntil=0; this.whaleShockAt=0;   // late-game transforms: Whale Mode + Cold Wallet
    this.throwAmmo=10;   // MANUAL THROW: 10 Solana discs per level (F/X or the THROW button); refilled by a SOLANA pickup
    this.megaWhaleUntil=0; this._whaleFly=false; this.whaleRideY=0;   // MEGA WHALE: rare timed invincible flying ride (1/world, W5-W8)
    this.boss=false; this.bossStarted=false;

    // player — bigger & in charge; grows even bigger on a power-up
    this.player=this.physics.add.sprite(this.spawn.x,this.spawn.y,'normie');
    this.baseScale=36/this.player.height; this.pscale={v:1}; this._powered=false;
    // Omega Chad renders a bit taller than Normie (he's the power form); scale from HIS texture.
    this.omegaScale = this.textures.exists('omegachad') ? 52/this.textures.get('omegachad').getSourceImage().height : this.baseScale;
    this.player.setScale(this.baseScale).setDepth(7);
    this.player.body.setSize(this.player.width*0.60,this.player.height*0.90).setOffset(this.player.width*0.20,this.player.height*0.08);
    this.player.setCollideWorldBounds(true); this.player.setMaxVelocity(240,600);
    this.playerGlow=this.addGlow(this.player,0x66ccff,0);   // premium aura, fires up under power
    // GIGA CHAD mode: Normie stays Normie; a big shadowy chad figure looms behind him (a
    // "channeled power" silhouette) instead of a low-quality full sprite-swap. Hidden by default.
    this.gigaShadowScale = this.textures.exists('omegachad') ? 66/this.textures.get('omegachad').getSourceImage().height : 1;
    this.gigaShadow = this.add.image(this.spawn.x, this.spawn.y, 'omegachad').setDepth(6).setVisible(false).setTint(0x140a24).setAlpha(0.42);
    if(this.gigaShadow.postFX){ try{ this.gigaShadow.postFX.addGlow(0xffa020, 4, 0, false, 0.1, 14); }catch(e){} }
    // MEGA WHALE mount — a big blue whale Normie straddles during the ride. Drawn once. Faces right by default.
    if(!this.textures.exists('whalemount')){ var wg=this.make.graphics({x:0,y:0,add:false});
      wg.fillStyle(0x0a2a54,1); wg.fillEllipse(40,26,74,26);                     // under-shadow
      wg.fillStyle(0x2f7fff,1); wg.fillEllipse(40,21,74,28);                     // main blue body
      wg.fillStyle(0x8fd0ff,1); wg.fillEllipse(40,26,60,14);                     // pale belly
      wg.fillStyle(0x2f7fff,1); wg.fillTriangle(4,21,20,10,20,32);               // tail fluke (back/left)
      wg.fillStyle(0x1f6fff,1); wg.fillTriangle(52,30,64,30,58,40);              // pectoral fin (down)
      wg.fillStyle(0x0a2a54,1); wg.fillCircle(66,17,2.4);                        // eye
      wg.fillStyle(0x9fe8ff,1); wg.fillRect(46,6,2,2); wg.fillRect(44,3,2,3); wg.fillRect(48,3,2,3); // blowhole spout
      wg.lineStyle(1.5,0x0a2a54,0.5); wg.strokeEllipse(40,21,74,28);
      wg.generateTexture('whalemount',80,44); wg.destroy(); }
    this.whaleRide=this.add.image(this.spawn.x,this.spawn.y,'whalemount').setDepth(6).setVisible(false);
    if(this.whaleRide.postFX){ try{ this.whaleRide.postFX.addGlow(0x2f7fff,5,0,false,0.1,14); }catch(e){} }

    // collisions
    this.physics.add.collider(this.player,this.platforms);
    this.physics.add.collider(this.player,this.movers);
    this.physics.add.collider(this.player,this.pumpDumps);
    this.physics.add.collider(this.player,this.bridgePlanks);
    this.physics.add.collider(this.player,this.pegs);
    this.physics.add.collider(this.player,this.yields);
    this.physics.add.collider(this.player,this.bonusBlocks,this.blockBonk,null,this);
    this.physics.add.collider(this.enemies,this.platforms,null,function(en){ return en.kind!=='ghost'; });
    this.physics.add.overlap(this.player,this.gasClouds,this.gasTouch,null,this);
    this.physics.add.overlap(this.player,this.honeypots,this.honeypotHit,null,this);
    this.physics.add.collider(this.npcs,this.platforms);   // NPCs walk on the ground; they never touch the player
    this.physics.add.collider(this.casino,this.platforms);
    this.physics.add.overlap(this.player,this.casino,this.casinoTouch,null,this);
    this.physics.add.overlap(this.player,this.coins,this.grabCoin,null,this);
    this.physics.add.overlap(this.player,this.key,this.grabKey,null,this);
    this.physics.add.overlap(this.player,this.enemies,this.touchEnemy,null,this);
    this.physics.add.overlap(this.player,this.miniworms,this.miniwormTouch,null,this);
    this.physics.add.overlap(this.player,this.enemyShots,this.shotHit,null,this);
    this.physics.add.overlap(this.player,this.spikes,this.spikeHit,null,this);
    this.physics.add.overlap(this.player,this.door,this.tryDoor,null,this);
    this.physics.add.overlap(this.player,this.caches,this.grabCache,null,this);   // coin caches (player now exists)
    this.physics.add.overlap(this.player,this.warps,this.tryWarp,null,this);      // speakeasy warps
    this.physics.add.overlap(this.player,this.powerups,this.grabPowerup,null,this);
    this.physics.add.overlap(this.player,this.airdrops,this.grabAirdrop,null,this);
    // thrown crypto coins — Normie's ranged attack ("throw money at the problem")
    this.projectiles=this.physics.add.group();
    this.physics.add.collider(this.projectiles,this.platforms);
    this.physics.add.collider(this.projectiles,this.movers);
    this.physics.add.overlap(this.projectiles,this.enemies,this.coinHitEnemy,null,this);
    this.nextThrow=0; this.prevThrow=false;

    // HUD — held in a container pinned at the screen centre (W/2,H/2) & scrollFactor 0.
    // Under the 2x follow-camera zoom that offset makes every child land exactly where its
    // design coords intend (top-left / top-right), at crisp 2x size, without a second camera.
    this.hudBox=this.add.container(W/2,H/2).setScrollFactor(0).setDepth(1000);
    this.hudScore=this.hb(this.add.text(10,8,'SCORE '+this.score,{fontFamily:'"Press Start 2P"',fontSize:'10px',color:'#ffd23f'}));
    this.hudTime=this.hb(this.add.text(W-10,8,String(this.timeLeft),{fontFamily:'"Press Start 2P"',fontSize:'10px',color:'#3dff6e'}).setOrigin(1,0));
    this.hb(this.add.text(W/2,8,'WORLD '+def.name,{fontFamily:'"Press Start 2P"',fontSize:'10px',color:'#8f89b0'}).setOrigin(.5,0));
    this.hearts=[]; for(i=0;i<3;i++) this.hearts.push(this.hb(this.add.image(14+i*20,30,'heart').setScale(1.2).setAlpha(i<this.lives?1:.16)));
    this.keyIcon=this.hb(this.add.image(W-18,30,'key').setAlpha(.2)); this.keyIcon.setScale(22/this.keyIcon.height);
    this.powerBarBg=this.hb(this.add.rectangle(14,52,46,8,0x000000,0.55).setOrigin(0,0.5).setDepth(20).setStrokeStyle(1,0x8f89b0).setVisible(false));
    this.powerBar=this.hb(this.add.rectangle(15,52,44,5,0x3dff6e).setOrigin(0,0.5).setDepth(21).setVisible(false));
    this.powerLabel=this.hb(this.add.text(64,52,'',{fontFamily:'"Press Start 2P"',fontSize:'8px',color:'#ffd23f'}).setOrigin(0,0.5).setDepth(21).setVisible(false));
    // MANUAL THROW ammo — a Solana disc + count, under the key (top-right)
    this.throwIcon=this.hb(this.add.image(W-30,52,'solana').setDepth(20)); this.throwIcon.setScale(15/this.throwIcon.height);
    this.throwCountTxt=this.hb(this.add.text(W-40,52,'x'+this.throwAmmo,{fontFamily:'"Press Start 2P"',fontSize:'9px',color:'#14f195'}).setOrigin(1,0.5).setDepth(21));
    // PAUSE button — tap the ⏸ (top-left) on touch, or press P / Esc on desktop
    this.hb(this.add.rectangle(120,15,20,16,0x000000,0.5).setStrokeStyle(1,0x8f89b0));
    this.hb(this.add.rectangle(116,15,3,9,0xffd23f)); this.hb(this.add.rectangle(124,15,3,9,0xffd23f));

    this.time.addEvent({delay:1000,loop:true,callback:function(){ if(this.over) return; this.timeLeft--; this.hudTime.setText(String(this.timeLeft)); if(this.timeLeft<=15) this.hudTime.setColor('#ff3860'); if(this.timeLeft<=0) this.gameOver('TIME UP'); },callbackScope:this});

    // level intro banner (non-blocking)
    var bn=this.hb(this.add.text(W/2,96,'WORLD '+def.name,{fontFamily:'"Press Start 2P"',fontSize:'20px',color:'#ffd23f'}).setOrigin(.5).setShadow(3,3,'#7a5a00',0,true,true));
    var bs=this.hb(this.add.text(W/2,128,def.sub,{fontFamily:'VT323',fontSize:'22px',color:'#3dff6e'}).setOrigin(.5));
    this.tweens.add({targets:[bn,bs],alpha:0,delay:1100,duration:700,onComplete:function(){ bn.destroy(); bs.destroy(); }});

    // input — touch is driven by RAW POINTER SCREEN-ZONES in update() (see the poll there),
    // NOT interactive hit-areas: the HUD lives in a scrollFactor-0 container under a 2x zoom
    // where per-object hit testing is unreliable. Pointer coords are zoom/container-immune.
    this.cursors=this.input.keyboard.createCursorKeys(); this.keys=this.input.keyboard.addKeys('W,A,S,D,SPACE,F,X');
    // PAUSE keys: while paused, ANY key resumes; while playing, P / Esc pause. (Touch: ⏸ hotspot in update; tap resumes.)
    this.input.keyboard.on('keydown',function(e){ if(self.paused){ self.resumeGame(); } else if(e.key==='p'||e.key==='P'||e.key==='Escape'){ self.pauseGame(false); } });
    this.input.on('pointerdown',function(){ if(self.paused) self.resumeGame(); });   // tap anywhere resumes
    // TEST BUILD: expose the current level + a "back to LEVEL SELECT" hook to the DOM overlay
    // (a reliable HTML button — in-canvas HUD hit areas are unreliable under the 2x-zoom container).
    // Press L on desktop, or tap the overlay's ≡ Levels button on any device.
    try{ if(typeof window!=='undefined') window.__NQ_LEVEL=(this.def&&this.def.name)||''; }catch(e){}
    if(TEST_MODE){ this.input.keyboard.on('keydown-L',function(){ self.scene.start('LevelSelect'); }); }
    if(!this.registry.get('nqPtr')){ this.input.addPointer(4); this.registry.set('nqPtr',1); }   // extra pointers for multi-touch; game-global, add once
    this.touch={left:false,right:false,jump:false,down:false}; this.crouching=false;
    var isTouch=this.isTouch=(this.sys.game.device.input.touch||(navigator.maxTouchPoints>0)||('ontouchstart' in window));
    // on-screen control affordances (visual only — actual input is polled below). Collected so they
    // can be HIDDEN when the DOM gutter D-pad is active (tablets/wide screens use the side buttons).
    this.padAffordances=[];
    var padBtn=function(x,label){
      var im=self.hb(self.add.image(x,H-28,'btn').setScale(0.58).setAlpha(isTouch?0.5:0.16));
      var tx=self.hb(self.add.text(x,H-28,label,{fontFamily:'"Press Start 2P"',fontSize:'14px',color:'#3dff6e'}).setOrigin(.5).setAlpha(isTouch?0.9:0.28));
      self.padAffordances.push(im,tx);
    };
    padBtn(34,'<'); padBtn(100,'>');
    // NOTE: no jump-zone fill rectangle. It used to be a half-screen 5%-alpha green rect that,
    // on touch devices only, tinted the right half of the screen — THE "half-screen shade seam".
    // Touch jump is handled by raw pointer-zones in update(), so the rect served no purpose.
    // throw button (bottom-right corner) — hurl a coin. The rest of the right side = jump.
    // (no throw button — Solana symbols auto-fire during SOLANA MODE)

    this.cameras.main.startFollow(this.player,true,0.12,0.12); this.cameras.main.setDeadzone(80,60);
    this.lastGround=-9999; this.jumpBufferAt=-9999; this.prevJump=false; this.jumpsLeft=2; this.isJumping=false;
  },

  makeEnemy:function(kind,x,y,range){
    var tex = kind==='sniper' ? 'bot' : kind;   // Sniper Bot reuses the bot art (tinted red)
    var e=this.enemies.create(x,y,tex); e.kind=kind;
    e.setScale((kind==='ghost'?26:kind==='bitmaxi'?34:kind==='fudster'?38:30)/e.height);
    e.body.setSize(e.width*0.70,e.height*0.78).setOffset(e.width*0.15,e.height*0.16); e.setBounce(0);
    e.dir=Phaser.Math.RND.pick([-1,1]);
    var spd={jeet:50,paper:66,bot:88,ghost:52,bitmaxi:72,sniper:34,fudster:44}[kind]||55;
    e.baseSpeed=(spd+Phaser.Math.RND.between(0,12))*(this.diffMul||1);
    e.homeX=x; e.homeY=y; e.range=range||70; e.bob=Phaser.Math.RND.frac()*6.28;
    if(kind==='sniper'){ e.setTint(0xff6b6b); e.nextFire=this.time.now+1100+Phaser.Math.RND.between(0,900); }   // ranged shooter
    if(kind==='fudster'){ e.nextGas=this.time.now+1000+Phaser.Math.RND.between(0,700); var fg=this.addGlow(e,0x7ec86e,3); if(fg) this.tweens.add({targets:fg,outerStrength:7,duration:700,yoyo:true,repeat:-1,ease:'Sine.inOut'}); }
    if(kind==='ghost') e.body.setAllowGravity(false); else e.setCollideWorldBounds(true);
    return e;
  },

  grabCoin:function(player,coin){ var cx=coin.x,cy=coin.y; this.tweens.killTweensOf(coin); coin.destroy(); this.addScore(10); SFX.coin(); this.burst(cx,cy,0xffd23f,6); },
  grabKey:function(player,key){ if(this.hasKey) return; this.hasKey=true; this.tweens.killTweensOf(key); key.destroy(); this.keyIcon.setAlpha(1); this.addScore(50); this.flash('KEY TO THE LOUNGE!','#ffd23f'); SFX.key(); },
  grabCache:function(player,pile){ if(pile.grabbed||this.over) return; pile.grabbed=true; if(pile.body) pile.body.enable=false;
    var self=this, n=pile.cacheN; this.addScore(n); this.registry.set('nqCasino',(this.registry.get('nqCasino')||0)+n); SFX.power(); SFX.coin();
    this.burst(pile.x, pile.y, 0xffd23f, 30); this.cameras.main.flash(220,255,235,140); this.flash('CACHE!  +'+n+' COINS','#3dff6e');
    for(var i=0;i<8;i++){ var a=(i/8)*Math.PI*2, fc=this.add.image(pile.x,pile.y,'coin').setDepth(20).setScale(pile.scaleX*0.55);
      this.tweens.add({targets:fc, x:pile.x+Math.cos(a)*42, y:pile.y-28-Math.sin(a)*22, alpha:0, duration:560, ease:'Quad.out', onComplete:(function(o){ return function(){ o.destroy(); }; })(fc)}); }
    this.tweens.add({targets:pile, y:pile.y-20, alpha:0, scaleX:0, scaleY:0, duration:480, onComplete:function(){ pile.destroy(); }});
  },
  tryWarp:function(player,w){ if(this.over||this._warping) return;
    if(this.time.now < this._warpCool) return;   // brief immunity right after returning
    if(!this.crouching) return;                   // the secret knock: you must DUCK in front to slip in
    this._warping=true;
    this.registry.set('nqRetLvl', this.levelIdx); this.registry.set('nqRetX', Math.round(w.x+70));
    this.cameras.main.flash(360, 120, 60, 170); SFX.power();
    var tgt=w.target;
    this.time.delayedCall(340, function(){ this.scene.start('Game',{level:tgt, score:this.score, lives:this.lives}); }, [], this);
  },
  returnFromHidden:function(){   // a hidden bonus level's exit → back to the source level where we ducked in
    if(this.over) return; this.over=true; this.physics.pause(); SFX.clear();
    var retL=this.registry.get('nqRetLvl'), retX=this.registry.get('nqRetX')||120;
    this.hb(this.add.text(W/2,120,'BACK TO THE SURFACE',{fontFamily:'"Press Start 2P"',fontSize:'13px',color:'#3dff6e'}).setOrigin(.5));
    this.time.delayedCall(1300, function(){ if(retL!=null) this.scene.start('Game',{level:retL, score:this.score, lives:this.lives, spawnX:retX});
      else this.scene.start('Game',{level:0, score:this.score, lives:this.lives}); }, [], this);
  },

  grabPowerup:function(player,pu){
    var type=pu.ptype, px=pu.x, py=pu.y; this.tweens.killTweensOf(pu); pu.destroy(); this.burst(px,py,0xffffff,20);
    var now=this.time.now;
    if(type==='diamond'){ this.shieldUntil=now+9000; this.powerBanner('DIAMOND HANDS','UNSHAKEABLE — no damage 9s','#66ddff'); }
    else if(type==='bull'){ this.bullUntil=now+11000; this.powerBanner('BULL MARKET','MEGA JUMP — 11s','#3dff6e'); }
    else if(type==='moon'){ this.moonUntil=now+9000; this.powerBanner('MOON MODE','INVINCIBLE — smash everything!','#ffd23f'); }
    else if(type==='caffeine'){ this.caffeineUntil=now+11000; this.powerBanner('CAFFEINE BOOST','WIRED — super speed 11s','#ffffff'); }
    else if(type==='candle'){ if(this.lives<3){ this.lives++; if(this.hearts[this.lives-1]) this.hearts[this.lives-1].setAlpha(1); } this.addScore(100); this.powerBanner('GREEN CANDLE','PUMPING — +1 heart, +100','#3dff6e'); }
    else if(type==='solana'){ this.solanaUntil=now+9000; this.nextThrow=0; this.throwAmmo=10; this.updateThrowHud(); this.powerBanner('SOLANA MODE','FULL SEND — auto-fire 9s + discs refilled!','#14f195'); }
    else if(type==='omegachad'){
      // ROTATING TRANSFORM: Giga Chad returns MEGA in the late worlds — a shock ring, but not so long it lasts a whole level.
      var mega=this.levelIdx>=18;   // World 7+
      this.omegaUntil=now+(mega?9000:8000); if(mega) this.whaleShockAt=now+1000;
      this.cameras.main.shake(240,.009);
      this.powerBanner(mega?'MEGA GIGA CHAD':'GIGA CHAD', mega?'UNSTOPPABLE + SHOCK RING — 9s':'UNSTOPPABLE — plow through enemies 8s','#ffa020'); }
    else if(type==='whale'){ this.whaleUntil=now+WHALE_MS; this.whaleShockAt=now+900; this.cameras.main.shake(280,.011);
      this.powerBanner('WHALE MODE'+(PREMIUM?' ⭐':''),'MARKET MOVER — huge, invincible, shock stomps '+(WHALE_MS/1000)+'s','#2f7fff'); }
    else if(type==='coldwallet'){ this.coldUntil=now+COLD_MS; this.freezeEnemies(COLD_MS);
      this.powerBanner('COLD WALLET'+(PREMIUM?' ⭐':''),'SECURED — can\'t be liquidated + enemies FROZEN '+(COLD_MS/1000)+'s','#9fe8ff'); }
    else if(type==='megawhale'){
      // MEGA WHALE — rare timed invincible flying ride. Piggybacks whaleUntil so it inherits ALL the
      // whale-mode immunity + enemy-crush + hazard-immunity that's already wired everywhere; the flight,
      // ride visual, HUD label and shock-suppression are keyed on megaWhaleUntil so it reads distinctly.
      var mwMs=PREMIUM?13000:10000; this.megaWhaleUntil=now+mwMs; this.whaleUntil=now+mwMs;
      this.whaleRideY=this.player.y-40; this.cameras.main.shake(300,.012); this.cameras.main.flash(200,40,120,255);
      this.powerBanner('MEGA WHALE'+(PREMIUM?' ⭐':''),'RIDE THE WHALE — fly, invincible, crush everything '+(mwMs/1000)+'s!','#2f7fff');
      this.flash('🐋 MEGA WHALE — TO THE MOON!','#2f7fff'); }
    else if(type==='supergeek'){ this.geekShield=true; this.powerBanner('SUPER GEEK','AUDIT ON — blocks the next hit','#2ee6c0'); }
    this.addScore(30); this.cameras.main.flash(120,60,120,40); SFX.power();
  },

  // ? BONUS BLOCK — bonk from BELOW only (block above player + head stopped by it).
  blockBonk:function(player,block){
    if(block.used) return;
    if(block.cool && this.time.now<block.cool) return;   // debounce: one dispense per bonk (multi-hit needs a re-jump)
    if(block.body.center.y < player.body.center.y-6 && (player.body.blocked.up||player.body.touching.up)){ block.cool=this.time.now+320; this.popBlock(block); }
  },
  popBlock:function(block){
    var self=this, r=block.reward, isCoin=(typeof r!=='string');
    // MULTI-HIT: a coin block with hits remaining stays live (bumps + dispenses again); otherwise spend it.
    var more = isCoin && block.hitsLeft>1;
    if(more){ block.hitsLeft--; } else { block.used=true; block.setTexture('qblockused'); }
    this.tweens.killTweensOf(block); block.setScale(1);
    this.tweens.add({targets:block, y:block.homeY-7, duration:90, yoyo:true, ease:'Quad.out'});   // the bump
    // CLUTCH HEAL: on your last heart, a bonus block also gives back a heart (you paused near the
    // roaming enemies to hit it — this makes that risk worth taking in the tight later levels).
    if(this.lives<=1 && this.lives<3){ this.lives++; if(this.hearts[this.lives-1]) this.hearts[this.lives-1].setAlpha(1); SFX.power(); this.cameras.main.flash(160,255,120,160); this.flash('CLUTCH! +1 HEART','#ff5a8a'); }
    if(!isCoin){                                                    // a POWER-UP pops out the top (single use)
      SFX.power();
      var o=this.powerups.create(block.x, block.homeY-2, r); o.ptype=r;
      o.setScale((r==='candle'?46:40)/o.height).setDepth(6);
      o.body.setAllowGravity(false); o.body.setSize(o.width*1.6,o.height*1.4);
      var pg=this.addGlow(o, (typeof PUCOL!=='undefined'&&PUCOL[r])||0xffffff, 4);
      if(pg) this.tweens.add({targets:pg,outerStrength:11,duration:620,yoyo:true,repeat:-1,ease:'Sine.inOut'});
      this.tweens.add({targets:o, y:block.homeY-34, duration:440, ease:'Back.out', onComplete:function(){
        if(o.active) self.tweens.add({targets:o, y:block.homeY-43, duration:820, yoyo:true, repeat:-1, ease:'Sine.inOut'}); }});
    } else {                                                        // COINS pop out (possibly again)
      this.dispenseCoins(block, (typeof r==='number'&&r>0)?r:5, more);
    }
  },
  dispenseCoins:function(block, n, more){
    this.addScore(n); SFX.coin(); this.burst(block.x, block.homeY-10, 0xffd23f, more?7:10);
    var c=this.add.image(block.x, block.homeY-8, 'coin'); c.setScale(20/c.height).setDepth(7);
    this.tweens.add({targets:c, y:block.homeY-40, alpha:0, duration:640, ease:'Quad.out', onComplete:function(){ c.destroy(); }});
    // value pop-up LINGERS longer (owner ask): rise slowly, hold, then fade
    var t=this.add.text(block.x, block.homeY-16, '+'+n+(more?'  •':''), {fontFamily:'"Press Start 2P"',fontSize:'10px',color:'#ffd23f'}).setOrigin(.5).setDepth(30);
    this.tweens.add({targets:t, y:block.homeY-48, duration:1400, ease:'Quad.out'});
    this.tweens.add({targets:t, alpha:0, delay:900, duration:650, onComplete:function(){ t.destroy(); }});
  },

  revealAirdrop:function(a){   // parachute in from above, then bob
    a.shown=true; a.setActive(true).setVisible(true); if(a.body) a.body.enable=true;
    this.tweens.killTweensOf(a); a.setAlpha(0); a.y=a.restY-48;
    var self=this;
    this.tweens.add({targets:a,y:a.restY,alpha:1,duration:560,ease:'Bounce.out',onComplete:function(){
      if(a.active&&!a.consumed) a.bob=self.tweens.add({targets:a,y:a.restY+8,duration:900,yoyo:true,repeat:-1,ease:'Sine.inOut'});
    }});
    if(a.glowFx&&!a.glowPulse) a.glowPulse=this.tweens.add({targets:a.glowFx,outerStrength:9,duration:700,yoyo:true,repeat:-1,ease:'Sine.inOut'});
  },
  hideAirdrop:function(a){   // healed back to full → tuck it away until damage happens again
    a.shown=false; this.tweens.killTweensOf(a); if(a.bob){ a.bob.stop(); a.bob=null; }
    a.setVisible(false).setActive(false); if(a.body) a.body.enable=false; a.setAlpha(0); a.y=a.restY;
  },
  fireSolana:function(){   // auto-fire during SOLANA MODE — a straight, spinning Solana symbol
    var p=this.player, dir=p.flipX?-1:1;
    var c=this.projectiles.create(p.x+dir*13,p.y-4,'solana').setDepth(6); c.setScale(18/c.height);
    c.body.setAllowGravity(false); c.body.setSize(c.width*0.8,c.height*0.8);
    c.setVelocity(dir*360,Phaser.Math.Between(-24,24)); c.setAngularVelocity(dir*520); c.setCollideWorldBounds(false);
    SFX.coin();
    this.time.delayedCall(1100,function(){ if(c&&c.active) c.destroy(); });
  },
  updateThrowHud:function(){
    if(!this.throwCountTxt) return;
    this.throwCountTxt.setText('x'+this.throwAmmo).setColor(this.throwAmmo>0?'#14f195':'#5a5a6a');
    if(this.throwIcon) this.throwIcon.setAlpha(this.throwAmmo>0?1:0.35);
  },
  manualThrow:function(){   // MANUAL THROW: hurl a Solana disc from the counted ammo (F/X or THROW button)
    if(this.over||this.paused) return;
    if(this.throwAmmo<=0){ _tone(200,140,0.08,'square',0.04); return; }   // empty: soft click, no fire
    this.throwAmmo--; this.fireSolana(); this.updateThrowHud();
    this.cameras.main.flash(50,20,120,60);
  },
  coinHitEnemy:function(coin,enemy){
    if(this.over||!enemy.active||!coin.active) return;
    var ex=enemy.x,ey=enemy.y; enemy.disableBody(true,true); coin.destroy();
    this.addScore(20); this.burst(ex,ey,0xffd23f,10); SFX.stomp(); this.cameras.main.shake(40,0.004);
  },
  grabAirdrop:function(player,a){
    if(this.over||!a.active||a.consumed) return;
    a.consumed=true; if(a.bob){ a.bob.stop(); a.bob=null; }
    var ax=a.x, ay=a.y; this.tweens.killTweensOf(a); a.disableBody(true,true);
    this.burst(ax,ay,0xff3860,18); SFX.power(); this.cameras.main.flash(120,40,120,60);
    if(this.lives<3){ this.lives++; if(this.hearts[this.lives-1]) this.hearts[this.lives-1].setAlpha(1); this.powerBanner('HEALING AIRDROP','BAGS SAVED — +1 HEART','#3dff6e'); }
    else { this.addScore(150); this.powerBanner('HEALING AIRDROP','BAGS FULL — +150','#3dff6e'); }
  },

  powerBanner:function(title,sub,color){
    var tags=["NORMIE'S RULES!","JUST DOING NORMIE THINGS","NORMIE POWER-UP!","NORMIE ON TOP"];
    var tag=tags[Math.floor(this.time.now/700)%tags.length];
    var d=60, bar=this.add.rectangle(-W,90,W*1.5,54,0x0d0b1e,0.92).setScrollFactor(0).setDepth(d).setStrokeStyle(3, Phaser.Display.Color.HexStringToColor(color).color);
    var t1=this.add.text(-W,78,title,{fontFamily:'"Press Start 2P"',fontSize:'19px',color:color}).setOrigin(.5).setScrollFactor(0).setDepth(d+1);
    var t2=this.add.text(-W,108,tag+'  \u00B7  '+sub,{fontFamily:'VT323',fontSize:'21px',color:'#ffd23f'}).setOrigin(.5).setScrollFactor(0).setDepth(d+1);
    var items=[bar,t1,t2]; this.hudBox.add(items);
    this.tweens.add({targets:items,x:W/2,duration:300,ease:'Back.out'});
    this.tweens.add({targets:t1,scale:1.12,duration:220,yoyo:true,repeat:2,delay:300});
    this.time.delayedCall(1500,function(){ this.tweens.add({targets:items,x:W*1.8,duration:320,ease:'Back.in',onComplete:function(){ items.forEach(function(o){o.destroy();}); }}); },[],this);
  },

  touchEnemy:function(player,enemy){
    if(this.over||!enemy.active) return;
    var now=this.time.now;
    if(now<this.moonUntil||now<this.omegaUntil||now<this.whaleUntil){ var mx=enemy.x,my=enemy.y; enemy.disableBody(true,true); this.addScore(20); this.burst(mx,my,now<this.whaleUntil?0x2f7fff:(now<this.omegaUntil?0xffa020:0xffd23f),12); this.cameras.main.shake(50,.005); return; }   // MOON / GIGA CHAD / WHALE: smash through everything
    var onTop=(player.body.bottom<=enemy.body.top+12)&&player.body.velocity.y>=-20;
    if(onTop){
      var ex=enemy.x,ey=enemy.y; enemy.disableBody(true,true); player.setVelocityY(-300); this.addScore(20); this.cameras.main.shake(60,.006); SFX.stomp(); this.burst(ex,ey,0xffd23f,10);
      player.invuln=true; this.time.delayedCall(140,function(){ if(player.active) player.invuln=false; },[],this);
      return;
    }
    if(player.invuln||now<this.shieldUntil||now<this.coldUntil) return;   // i-frames / diamond / cold wallet: no damage
    if(enemy.kind==='bitmaxi'){ this.maxiSteal(player,enemy); return; }   // Bitcoin Maxi robs coins instead of dealing damage
    this.hurt(player, enemy.x<player.x?1:-1);
  },
  // Bitcoin Maxi: "everything but BTC is trash" — on contact he STEALS your coins (score) and
  // bolts, rather than costing a life. Stomp him (or Giga/Moon-smash) to stop the theft.
  maxiSteal:function(player,maxi){
    var steal=Math.min(this.score, 40);
    if(steal>0){ this.score-=steal; this.hudScore.setText('SCORE '+this.score); }
    if(steal>0) this.coinLossBanner(steal,'BITCOIN MAXI!','#ff9500');   // same clear mid-tier notice as the honeypot
    else this.flash('MAXI FOUND NOTHING!','#ff9500');
    SFX.hurt(); this.burst(player.x,player.y-4,0xff9500,12);
    player.invuln=true; player.setVelocity((maxi.x<player.x?1:-1)*170,-150);
    this.tweens.add({targets:player,alpha:.4,duration:90,yoyo:true,repeat:5,onComplete:function(){ if(player.active){ player.alpha=1; player.invuln=false; } }});
    // the thief cackles and sprints off in the direction he was heading
    maxi.baseSpeed=Math.min(maxi.baseSpeed*1.6,150); this.cameras.main.shake(90,.006);
  },
  spikeHit:function(player,spike){ var now=this.time.now; if(this.over||player.invuln||now<this.shieldUntil||now<this.moonUntil||now<this.omegaUntil||now<this.whaleUntil||now<this.coldUntil) return; this.hurt(player, player.body.velocity.x>0?-1:1); },

  tryDoor:function(player,door){
    if(this.over) return;
    if(this.def.boss){   // boss levels (incl. the hidden TROLL) fight at the door before anything else
      if(this.hasKey && !this.bossStarted) this.startBoss();
      else if(!this.hasKey && !this._doorHint){ this._doorHint=true; this.flash('LOCKED — FIND THE KEY','#ff3860'); this.time.delayedCall(1400,function(){ this._doorHint=false; },[],this); }
      return;
    }
    if(this.def.hidden){ this.returnFromHidden(); return; }   // non-boss bonus room exit → back to the surface
    if(this.hasKey){ this.levelClear(); }
    else if(!this._doorHint){ this._doorHint=true; this.flash('LOUNGE LOCKED — FIND THE KEY','#ff3860'); this.time.delayedCall(1400,function(){ this._doorHint=false; },[],this); }
  },

  startBoss:function(){
    if(this.bossStarted) return; this.bossStarted=true; this.boss=true; this.bossHP=3;
    try{ MUSIC.forWorld('boss'); }catch(e){}   // kick into the boss theme (also covers 1-3's Rug King)
    if(this.def.bossType==='wormhole'){ this.startWormBoss(); return; }
    if(this.def.bossType==='kol'){ this.startKolBoss(); return; }
    if(this.def.bossType==='ceo'){ this.startCeoBoss(); return; }
    if(this.def.bossType==='wyrm'){ this.startWyrmBoss(); return; }
    if(this.def.bossType==='golem'){ this.startGolemBoss(); return; }
    if(this.def.bossType==='reaper'){ this.startReaperBoss(); return; }
    if(this.def.bossType==='liquidator'){ this.startLiquidatorBoss(); return; }
    if(this.def.bossType==='troll'){ this.startTrollBoss(); return; }
    var dx=this.def.door, self=this;
    // portal into the lounge's back room: flash, pull Normie BACK across the room, and drop the
    // Rug King in on the far side. He stays inert for a beat so you can never get clipped instantly.
    this.cameras.main.flash(420, 150, 40, 170);
    this.player.setPosition(dx-260, GY-40); this.player.setVelocity(0,0);
    // arena walls at BOTH ends so the fight is contained
    [dx-340, dx+40].forEach(function(x){ var w=self.physics.add.staticImage(x, H/2, 'brick').setDisplaySize(16,H*2).setAlpha(0); w.refreshBody(); self.physics.add.collider(self.player,w); });
    // spawn the Rug King across the room, facing the player, INERT until the intro ends
    var k=this.rugking=this.physics.add.sprite(dx-60, GY-50, 'rugking');
    k.setScale(48/k.height); k.body.setSize(k.width*0.62,k.height*0.82).setOffset(k.width*0.19,k.height*0.14);
    k.setCollideWorldBounds(true); k.dir=-1; k.invuln=true; k.setDepth(7);
    var bg2=this.addGlow(k,0xff2d55,5); if(bg2) this.tweens.add({targets:bg2,outerStrength:12,duration:520,yoyo:true,repeat:-1,ease:'Sine.inOut'});
    this.physics.add.collider(k, this.platforms);
    this.physics.add.overlap(this.player, k, this.bossTouch, null, this);
    this.door.setVisible(false);
    // boss HP pips + label
    this.bossPips=[]; for(var i=0;i<3;i++) this.bossPips.push(this.hb(this.add.image(W/2-24+i*24, 22, 'heart').setScale(1.4).setDepth(40).setTint(0xff5577)));
    this.hb(this.add.text(W/2, 42, 'RUG KING', {fontFamily:'"Press Start 2P"',fontSize:'11px',color:'#ff3860'}).setOrigin(.5,0).setDepth(40));
    this.powerBanner('RUG KING','BACK ROOM OF THE LOUNGE — STOMP HIS CROWN x3','#ff3860');
    // ~1.6s grace (checked in update, not a timer): he can't move or hurt you until "FIGHT!"
    this.rugIntro=true; this.rugGraceUntil=this.time.now+1600;
  },

  bossHit:function(){
    SFX.boss(); if(this.rugking) this.burst(this.rugking.x,this.rugking.y,0xff3860,20); this.bossHP--; if(this.bossPips[this.bossHP]) this.bossPips[this.bossHP].setAlpha(.16);
    var k=this.rugking; k.invuln=true; k.setVelocityX(0); this.addScore(100); this.cameras.main.shake(220,.02);
    this.tweens.add({targets:k,alpha:.3,duration:100,yoyo:true,repeat:6,onComplete:function(){ if(k.active){ k.alpha=1; k.invuln=false; } }});
    if(this.bossHP<=0) this.bossDefeat();
  },
  bossTouch:function(player,k){
    if(this.over||!k.active||k.invuln) return;
    var now=this.time.now;
    if(now<this.moonUntil||now<this.whaleUntil){ this.bossHit(); return; }   // MOON / WHALE smashes the boss on contact
    var onTop=(player.body.bottom<=k.body.top+14)&&player.body.velocity.y>=-20;
    if(onTop){ player.setVelocityY(-340); this.bossHit(); return; }
    if(player.invuln||now<this.shieldUntil||now<this.coldUntil) return;
    this.hurt(player, k.x<player.x?1:-1);
  },
  /* ---------- Scammy KOL boss (charges + stomp x3, and shills fake tokens at range) ---------- */
  startKolBoss:function(){
    var dx=this.def.door, self=this;
    this.cameras.main.flash(420, 120, 40, 160);
    this.player.setPosition(dx-260, GY-40); this.player.setVelocity(0,0);
    [dx-340, dx+40].forEach(function(x){ var w=self.physics.add.staticImage(x, H/2, 'brick').setDisplaySize(16,H*2).setAlpha(0); w.refreshBody(); self.physics.add.collider(self.player,w); });
    var k=this.rugking=this.physics.add.sprite(dx-60, GY-54, 'scammykol');   // stored in rugking = generic melee-boss handle
    k.setScale(52/k.height); k.body.setSize(k.width*0.60,k.height*0.82).setOffset(k.width*0.20,k.height*0.14);
    k.setCollideWorldBounds(true); k.dir=-1; k.invuln=true; k.setDepth(7);
    var bg2=this.addGlow(k,0xb06bff,5); if(bg2) this.tweens.add({targets:bg2,outerStrength:12,duration:520,yoyo:true,repeat:-1,ease:'Sine.inOut'});
    this.physics.add.collider(k, this.platforms);
    this.physics.add.overlap(this.player, k, this.bossTouch, null, this);
    this.door.setVisible(false);
    this.bossPips=[]; for(var i=0;i<3;i++) this.bossPips.push(this.hb(this.add.image(W/2-24+i*24, 22, 'heart').setScale(1.4).setDepth(40).setTint(0xc99bff)));
    this.hb(this.add.text(W/2, 42, 'SCAMMY KOL', {fontFamily:'"Press Start 2P"',fontSize:'11px',color:'#c99bff'}).setOrigin(.5,0).setDepth(40));
    this.powerBanner('SCAMMY KOL','TRUST ME BRO — STOMP HIS PHONE x3','#c99bff');
    this.rugIntro=true; this.rugGraceUntil=this.time.now+1600;
    this.kolNextShill=this.time.now+2600; this.kolNextTaunt=this.time.now+2000;
  },
  kolTick:function(now,p){
    var k=this.rugking; if(!k||!k.active) return;
    if(now>this.kolNextShill){ this.kolNextShill=now+2200; this.kolShill(k,p); }
    if(now>this.kolNextTaunt){ this.kolNextTaunt=now+3600; var t=['TRUST ME BRO','WEN UTILITY? SOON','NOT FINANCIAL ADVICE','THIS IS THE ONE','FEW UNDERSTAND','GM, APE IN']; this.flash(Phaser.Math.RND.pick(t),'#c99bff'); }
  },
  kolShill:function(k,p){   // flings a small spread of "fake token" shills toward the player
    if(this.over||!this.enemyShots) return; var self=this;
    var base=Math.atan2((p.y-8)-k.y, p.x-k.x);
    [-0.16,0.16].forEach(function(off){
      var ang=base+off, sp=190, s=self.enemyShots.create(k.x, k.y-6, 'bullet').setDepth(6);
      if(!s||!s.body) return; s.body.setAllowGravity(false); s.body.setSize(s.width*0.9,s.height*0.9);
      s.setVelocity(Math.cos(ang)*sp, Math.sin(ang)*sp); s.setTint(0xc99bff); s.dieAt=self.time.now+2800;
    });
    _tone(700,240,0.10,'square',0.05);
  },
  /* ---------- THE TROLL boss (Crypto Trenches finale): charges + stomp x4, lobs REKT candles, teleports ---------- */
  startTrollBoss:function(){
    var dx=this.def.door, self=this; this.bossHP=3;
    this.cameras.main.flash(420, 30, 150, 70);
    this.player.setPosition(dx-260, GY-40); this.player.setVelocity(0,0);
    [dx-340, dx+40].forEach(function(x){ var w=self.physics.add.staticImage(x, H/2, 'brick').setDisplaySize(16,H*2).setAlpha(0); w.refreshBody(); self.physics.add.collider(self.player,w); });
    var k=this.rugking=this.physics.add.sprite(dx-60, GY-60, 'troll');   // stored in rugking = generic melee-boss handle
    k.setScale(62/k.height); k.body.setSize(k.width*0.62,k.height*0.80).setOffset(k.width*0.19,k.height*0.16);
    k.setCollideWorldBounds(true); k.dir=-1; k.invuln=true; k.setDepth(7);
    var bg2=this.addGlow(k,0x2effa0,5); if(bg2) this.tweens.add({targets:bg2,outerStrength:12,duration:520,yoyo:true,repeat:-1,ease:'Sine.inOut'});
    this.physics.add.collider(k, this.platforms);
    this.physics.add.overlap(this.player, k, this.bossTouch, null, this);
    this.door.setVisible(false);
    this.bossPips=[]; for(var i=0;i<3;i++) this.bossPips.push(this.hb(this.add.image(W/2-24+i*24, 22, 'heart').setScale(1.4).setDepth(40).setTint(0x2effa0)));
    this.hb(this.add.text(W/2, 42, 'THE TROLL', {fontFamily:'"Press Start 2P"',fontSize:'11px',color:'#2effa0'}).setOrigin(.5,0).setDepth(40));
    this.powerBanner('THE TROLL','GET TROLLED — STOMP HIS FACE x3','#2effa0');
    this.rugIntro=true; this.rugGraceUntil=this.time.now+1700;
    this.trollNextThrow=this.time.now+2400; this.trollNextTaunt=this.time.now+1800; this.trollNextTp=this.time.now+4200;
  },
  trollTick:function(now,p){
    var k=this.rugking; if(!k||!k.active) return;
    if(now>this.trollNextThrow){ this.trollNextThrow=now+2400; this.trollThrow(k,p); }
    if(now>this.trollNextTaunt){ this.trollNextTaunt=now+3400; var t=['GET TROLLED','NGMI','REKT','SKILL ISSUE','HFSP','U MAD?','FEW','COPE + SEETHE']; this.flash(Phaser.Math.RND.pick(t),'#2effa0'); }
    if(now>this.trollNextTp && !k.invuln){ this.trollNextTp=now+5200; this.trollTeleport(k,p); }
  },
  trollThrow:function(k,p){   // lobs a 3-way spread of red REKT candles (red = death, like the Reaper)
    if(this.over||!this.enemyShots) return; var self=this;
    if(Math.abs(p.x-k.x)<86 && p.y < k.y-6) return;   // don't punish a committed stomp with point-blank candles
    var base=Math.atan2((p.y-8)-k.y, p.x-k.x);
    [-0.22,0,0.22].forEach(function(off){
      var ang=base+off, sp=210, s=self.enemyShots.create(k.x, k.y-8, 'candle').setDepth(6);
      if(!s||!s.body) return; s.body.setAllowGravity(false); s.setScale(30/s.height); s.body.setSize(s.width*0.8,s.height*0.8);
      s.setVelocity(Math.cos(ang)*sp, Math.sin(ang)*sp); s.setTint(0xff3b30); s.dieAt=self.time.now+3000;
      self.tweens.add({targets:s, angle:360, duration:600, repeat:-1});
    });
    _tone(160,70,0.12,'sawtooth',0.06);
  },
  trollTeleport:function(k,p){   // classic troll move: blink to a new spot with a cackle
    var dx=this.def.door, self=this;
    k.invuln=true;   // NON-DAMAGING while blinking, so he can never materialize on top of you and kill you
    this.burst(k.x,k.y,0x2effa0,16); k.setAlpha(0.2); k.setVelocityX(0);
    // land on a side of the player, ALWAYS at least ~150px away (never blink into their hitbox)
    var side=Phaser.Math.RND.pick([-1,1]);
    var nx=Phaser.Math.Clamp(p.x + side*Phaser.Math.Between(170,250), dx-320, dx+20);
    if(Math.abs(nx-p.x)<150) nx=Phaser.Math.Clamp(p.x - side*190, dx-320, dx+20);
    this.time.delayedCall(240, function(){ if(!k.active) return;
      k.x=nx; k.setAlpha(1); self.burst(k.x,k.y,0x2effa0,16); self.flash('HEHEHE','#2effa0');
      self.time.delayedCall(180, function(){ if(k.active && self.bossHP>0) k.invuln=false; });   // brief materialize grace, then vulnerable again
    }, [], this);
    _seq([[440,0.06],[520,0.06],[380,0.10]],'square',0.05);
  },
  /* ---------- The Custodian boss (corrupt CEX CEO): stomp x3; freezes withdrawals at range ---------- */
  startCeoBoss:function(){
    var dx=this.def.door, self=this;
    this.cameras.main.flash(420, 60, 130, 170);
    this.player.setPosition(dx-260, GY-40); this.player.setVelocity(0,0);
    [dx-340, dx+40].forEach(function(x){ var w=self.physics.add.staticImage(x, H/2, 'brick').setDisplaySize(16,H*2).setAlpha(0); w.refreshBody(); self.physics.add.collider(self.player,w); });
    var k=this.rugking=this.physics.add.sprite(dx-60, GY-56, 'ceoboss');   // stored in rugking = generic melee-boss handle
    k.setScale(56/k.height); k.body.setSize(k.width*0.58,k.height*0.82).setOffset(k.width*0.21,k.height*0.14);
    k.setCollideWorldBounds(true); k.dir=-1; k.invuln=true; k.setDepth(7);
    var bg2=this.addGlow(k,0x66ddff,5); if(bg2) this.tweens.add({targets:bg2,outerStrength:12,duration:520,yoyo:true,repeat:-1,ease:'Sine.inOut'});
    this.physics.add.collider(k, this.platforms);
    this.physics.add.overlap(this.player, k, this.bossTouch, null, this);
    this.door.setVisible(false);
    this.bossPips=[]; for(var i=0;i<3;i++) this.bossPips.push(this.hb(this.add.image(W/2-24+i*24, 22, 'heart').setScale(1.4).setDepth(40).setTint(0x8fe4ff)));
    this.hb(this.add.text(W/2, 42, 'THE CUSTODIAN', {fontFamily:'"Press Start 2P"',fontSize:'10px',color:'#8fe4ff'}).setOrigin(.5,0).setDepth(40));
    this.powerBanner('THE CUSTODIAN','WITHDRAWALS PAUSED — STOMP HIM x3','#8fe4ff');
    this.rugIntro=true; this.rugGraceUntil=this.time.now+1600;
    this.ceoNextFreeze=this.time.now+2600; this.ceoNextTaunt=this.time.now+2000;
  },
  ceoTick:function(now,p){
    var k=this.rugking; if(!k||!k.active) return;
    if(now>this.ceoNextFreeze){ this.ceoNextFreeze=now+2000; this.ceoFreeze(k,p); }
    if(now>this.ceoNextTaunt){ this.ceoNextTaunt=now+3400; var t=['WITHDRAWALS PAUSED','IT\'S ALL SAFU','NOT YOUR KEYS','TRUST THE PROCESS','SOON™','WE\'RE REBUILDING TRUST']; this.flash(Phaser.Math.RND.pick(t),'#8fe4ff'); }
  },
  ceoFreeze:function(k,p){   // flings a 3-way spread of "frozen withdrawal" locks (final boss = tougher)
    if(this.over||!this.enemyShots) return; var self=this;
    var base=Math.atan2((p.y-8)-k.y, p.x-k.x);
    [-0.22,0,0.22].forEach(function(off){
      var ang=base+off, sp=205, s=self.enemyShots.create(k.x, k.y-6, 'bullet').setDepth(6);
      if(!s||!s.body) return; s.body.setAllowGravity(false); s.body.setSize(s.width*0.9,s.height*0.9);
      s.setVelocity(Math.cos(ang)*sp, Math.sin(ang)*sp); s.setTint(0x8fe4ff); s.dieAt=self.time.now+2900;
    });
    _tone(520,260,0.10,'sawtooth',0.05);
  },
  /* ---------- The Vault Wyrm (World 5 dragon): stomp its head x3; breathes fireballs ---------- */
  startWyrmBoss:function(){
    var dx=this.def.door, self=this;
    this.cameras.main.flash(420, 40, 160, 60);
    this.player.setPosition(dx-260, GY-40); this.player.setVelocity(0,0);
    [dx-340, dx+40].forEach(function(x){ var w=self.physics.add.staticImage(x, H/2, 'brick').setDisplaySize(16,H*2).setAlpha(0); w.refreshBody(); self.physics.add.collider(self.player,w); });
    var k=this.rugking=this.physics.add.sprite(dx-70, GY-58, 'wyrm');
    k.setScale(84/k.height); k.body.setSize(k.width*0.6,k.height*0.78).setOffset(k.width*0.2,k.height*0.10);
    k.setCollideWorldBounds(true); k.dir=-1; k.invuln=true; k.setDepth(7);
    var bg2=this.addGlow(k,0x66ff88,5); if(bg2) this.tweens.add({targets:bg2,outerStrength:12,duration:520,yoyo:true,repeat:-1,ease:'Sine.inOut'});
    this.physics.add.collider(k, this.platforms);
    this.physics.add.overlap(this.player, k, this.bossTouch, null, this);
    this.door.setVisible(false);
    this.bossPips=[]; for(var i=0;i<3;i++) this.bossPips.push(this.hb(this.add.image(W/2-24+i*24, 22, 'heart').setScale(1.4).setDepth(40).setTint(0x66ff88)));
    this.hb(this.add.text(W/2, 42, 'THE VAULT WYRM', {fontFamily:'"Press Start 2P"',fontSize:'10px',color:'#66ff88'}).setOrigin(.5,0).setDepth(40));
    this.powerBanner('THE VAULT WYRM','GUARDING THE STOLEN BAGS — STOMP ITS HEAD x3','#66ff88');
    this.rugIntro=true; this.rugGraceUntil=this.time.now+1600;
    this.wyrmNextFire=this.time.now+2400; this.wyrmNextTaunt=this.time.now+2000;
  },
  wyrmTick:function(now,p){
    var k=this.rugking; if(!k||!k.active) return;
    if(now>this.wyrmNextFire){ this.wyrmNextFire=now+2000; this.wyrmFire(k,p); }
    if(now>this.wyrmNextTaunt){ this.wyrmNextTaunt=now+3400; var t=['THE SEEDS ARE MINE','NONE SHALL PASS','MY HOARD GROWS','FEEL THE FLAME','YOUR KEYS FEED ME']; this.flash(Phaser.Math.RND.pick(t),'#ffb020'); }
  },
  wyrmFire:function(k,p){   // breathes an arcing spread of fireballs
    if(this.over||!this.enemyShots) return; var self=this;
    var base=Math.atan2((p.y-8)-k.y, p.x-k.x);
    [-0.18,0,0.18].forEach(function(off){
      var ang=base+off, sp=210, s=self.enemyShots.create(k.x-10, k.y-10, 'bullet').setDepth(6);
      if(!s||!s.body) return; s.body.setAllowGravity(false); s.body.setSize(s.width*0.9,s.height*0.9);
      s.setVelocity(Math.cos(ang)*sp, Math.sin(ang)*sp); s.setTint(0xff7020); s.setScale(1.2); s.dieAt=self.time.now+2900;
    });
    _tone(240,90,0.16,'sawtooth',0.06);
  },
  /* ---------- The Hash Lord (World 6 golem, FINAL boss): stomp x3; hurls stone blocks ---------- */
  startGolemBoss:function(){
    var dx=this.def.door, self=this;
    this.cameras.main.flash(420, 150, 130, 40);
    this.player.setPosition(dx-260, GY-40); this.player.setVelocity(0,0);
    [dx-340, dx+40].forEach(function(x){ var w=self.physics.add.staticImage(x, H/2, 'brick').setDisplaySize(16,H*2).setAlpha(0); w.refreshBody(); self.physics.add.collider(self.player,w); });
    var k=this.rugking=this.physics.add.sprite(dx-66, GY-56, 'golem');
    k.setScale(86/k.height); k.body.setSize(k.width*0.64,k.height*0.82).setOffset(k.width*0.18,k.height*0.14);
    k.setCollideWorldBounds(true); k.dir=-1; k.invuln=true; k.setDepth(7);
    var bg2=this.addGlow(k,0xffcc33,5); if(bg2) this.tweens.add({targets:bg2,outerStrength:12,duration:520,yoyo:true,repeat:-1,ease:'Sine.inOut'});
    this.physics.add.collider(k, this.platforms);
    this.physics.add.overlap(this.player, k, this.bossTouch, null, this);
    this.door.setVisible(false);
    this.bossPips=[]; for(var i=0;i<3;i++) this.bossPips.push(this.hb(this.add.image(W/2-24+i*24, 22, 'heart').setScale(1.4).setDepth(40).setTint(0xffd23f)));
    this.hb(this.add.text(W/2, 42, 'THE HASH LORD', {fontFamily:'"Press Start 2P"',fontSize:'10px',color:'#ffd23f'}).setOrigin(.5,0).setDepth(40));
    this.powerBanner('THE HASH LORD','HE MINED YOUR BAGS — STOMP HIM x3','#ffd23f');
    this.rugIntro=true; this.rugGraceUntil=this.time.now+1600;
    this.golemNextThrow=this.time.now+2400; this.golemNextTaunt=this.time.now+2000;
  },
  golemTick:function(now,p){
    var k=this.rugking; if(!k||!k.active) return;
    if(now>this.golemNextThrow){ this.golemNextThrow=now+1900; this.golemThrow(k,p); }
    if(now>this.golemNextTaunt){ this.golemNextTaunt=now+3400; var t=['PROOF OF WORK','MINE. ALL MINE.','51% AND RISING','HASH HARDER','NEVER SELL... TO YOU']; this.flash(Phaser.Math.RND.pick(t),'#ffd23f'); }
  },
  golemThrow:function(k,p){   // hurls stone blocks in a small spread
    if(this.over||!this.enemyShots) return; var self=this;
    var base=Math.atan2((p.y-8)-k.y, p.x-k.x);
    [-0.14,0.14].forEach(function(off){
      var ang=base+off, sp=200, s=self.enemyShots.create(k.x-10, k.y-8, 'crate').setDepth(6);
      if(!s||!s.body) return; s.setScale(0.5); s.body.setAllowGravity(false); s.body.setSize(s.width*0.8,s.height*0.8);
      s.setVelocity(Math.cos(ang)*sp, Math.sin(ang)*sp); s.setAngularVelocity(220); s.dieAt=self.time.now+2900;
    });
    _tone(160,70,0.14,'square',0.06);
  },
  /* ---------- The Yield Reaper (World 7 farm boss, FINAL boss): stomp x3; reaps a spread of scythe-shots ---------- */
  startReaperBoss:function(){
    var dx=this.def.door, self=this;
    this.cameras.main.flash(420, 40, 150, 60);
    this.player.setPosition(dx-260, GY-40); this.player.setVelocity(0,0);
    [dx-340, dx+40].forEach(function(x){ var w=self.physics.add.staticImage(x, H/2, 'brick').setDisplaySize(16,H*2).setAlpha(0); w.refreshBody(); self.physics.add.collider(self.player,w); });
    var k=this.rugking=this.physics.add.sprite(dx-66, GY-56, 'reaper');
    k.setScale(88/k.height); k.body.setSize(k.width*0.62,k.height*0.82).setOffset(k.width*0.19,k.height*0.14);
    k.setCollideWorldBounds(true); k.dir=-1; k.invuln=true; k.setDepth(7);
    var bg2=this.addGlow(k,0x2ee66a,5); if(bg2) this.tweens.add({targets:bg2,outerStrength:12,duration:520,yoyo:true,repeat:-1,ease:'Sine.inOut'});
    this.physics.add.collider(k, this.platforms);
    this.physics.add.overlap(this.player, k, this.bossTouch, null, this);
    this.door.setVisible(false);
    this.bossPips=[]; for(var i=0;i<3;i++) this.bossPips.push(this.hb(this.add.image(W/2-24+i*24, 22, 'heart').setScale(1.4).setDepth(40).setTint(0x2ee66a)));
    this.hb(this.add.text(W/2, 42, 'THE YIELD REAPER', {fontFamily:'"Press Start 2P"',fontSize:'9px',color:'#2ee66a'}).setOrigin(.5,0).setDepth(40));
    this.powerBanner('THE YIELD REAPER','HE HARVESTS YOUR GAINS — STOMP HIM x3','#2ee66a');
    this.rugIntro=true; this.rugGraceUntil=this.time.now+1600;
    this.reaperNextThrow=this.time.now+2200; this.reaperNextTaunt=this.time.now+2000;
  },
  reaperTick:function(now,p){
    var k=this.rugking; if(!k||!k.active) return;
    if(now>this.reaperNextThrow){ this.reaperNextThrow=now+1750; this.reaperThrow(k,p); }
    if(now>this.reaperNextTaunt){ this.reaperNextTaunt=now+3400; var t=['TIME TO HARVEST','YOUR APY IS MINE','COMPOUND THIS','THE FARM ALWAYS WINS','WEN UNSTAKE? NEVER']; this.flash(Phaser.Math.RND.pick(t),'#2ee66a'); }
  },
  reaperThrow:function(k,p){   // reaps a 3-way spread of spinning scythe-blades (final boss = wider + faster)
    if(this.over||!this.enemyShots) return; var self=this;
    var base=Math.atan2((p.y-8)-k.y, p.x-k.x);
    [-0.20,0,0.20].forEach(function(off){
      var ang=base+off, sp=215, s=self.enemyShots.create(k.x-10, k.y-8, 'candle').setDepth(6);
      if(!s||!s.body) return; s.setScale(0.5); s.body.setAllowGravity(false); s.body.setSize(s.width*0.7,s.height*0.7);
      s.setTint(0xff3b30); s.setVelocity(Math.cos(ang)*sp, Math.sin(ang)*sp); s.setAngularVelocity(300); s.dieAt=self.time.now+2900;   // RED = death (green candles are the heal power-up)
    });
    _tone(200,80,0.14,'sawtooth',0.06);
  },
  /* ---------- THE GREAT BEAR (World 8 liquidation finale, FINAL boss): stomp x5; hurls red crash-candles + ground-slam shockwaves ---------- */
  startLiquidatorBoss:function(){
    var dx=this.def.door, self=this;
    this.cameras.main.flash(480, 150, 20, 20);
    this.player.setPosition(dx-260, GY-40); this.player.setVelocity(0,0);
    [dx-360, dx+40].forEach(function(x){ var w=self.physics.add.staticImage(x, H/2, 'brick').setDisplaySize(16,H*2).setAlpha(0); w.refreshBody(); self.physics.add.collider(self.player,w); });
    var k=this.rugking=this.physics.add.sprite(dx-72, GY-62, 'greatbear');
    k.setScale(104/k.height); k.body.setSize(k.width*0.66,k.height*0.80).setOffset(k.width*0.17,k.height*0.16);
    k.setCollideWorldBounds(true); k.dir=-1; k.invuln=true; k.setDepth(7);
    var bg2=this.addGlow(k,0xff2020,6); if(bg2) this.tweens.add({targets:bg2,outerStrength:14,duration:480,yoyo:true,repeat:-1,ease:'Sine.inOut'});
    this.physics.add.collider(k, this.platforms);
    this.physics.add.overlap(this.player, k, this.bossTouch, null, this);
    this.door.setVisible(false);
    this.bossHP=5;   // FINALE — tougher than the 3-hit world bosses
    this.bossPips=[]; for(var i=0;i<5;i++) this.bossPips.push(this.hb(this.add.image(W/2-48+i*24, 22, 'heart').setScale(1.3).setDepth(40).setTint(0xff3030)));
    this.hb(this.add.text(W/2, 42, 'THE GREAT BEAR', {fontFamily:'"Press Start 2P"',fontSize:'9px',color:'#ff3030'}).setOrigin(.5,0).setDepth(40));
    this.powerBanner('THE GREAT BEAR','END THE BEAR MARKET — STOMP HIM x5','#ff3030');
    this.rugIntro=true; this.rugGraceUntil=this.time.now+1800;
    this.bearNextThrow=this.time.now+2200; this.bearNextSlam=this.time.now+3600; this.bearNextTaunt=this.time.now+2000;
  },
  liquidatorTick:function(now,p){
    var k=this.rugking; if(!k||!k.active) return;
    if(now>this.bearNextThrow){ this.bearNextThrow=now+1650; this.bearThrow(k,p); }
    if(now>this.bearNextSlam){ this.bearNextSlam=now+4200; this.bearSlam(k); }
    if(now>this.bearNextTaunt){ this.bearNextTaunt=now+3400; var t=['LIQUIDATED.','MARGIN CALL','THE BEAR ALWAYS WINS','SELL. EVERYTHING.','MAX PAIN','LEVERAGE KILLS']; this.flash(Phaser.Math.RND.pick(t),'#ff3030'); }
  },
  bearThrow:function(k,p){   // hurls a 4-way spread of red crash-candles (finale = dense)
    if(this.over||!this.enemyShots) return; var self=this;
    var base=Math.atan2((p.y-8)-k.y, p.x-k.x);
    [-0.28,-0.09,0.09,0.28].forEach(function(off){
      var ang=base+off, sp=225, s=self.enemyShots.create(k.x-12, k.y-6, 'candle').setDepth(6);
      if(!s||!s.body) return; s.setScale(0.55); s.body.setAllowGravity(false); s.body.setSize(s.width*0.7,s.height*0.7);
      s.setTint(0xff2a2a); s.setVelocity(Math.cos(ang)*sp, Math.sin(ang)*sp); s.setAngularVelocity(320); s.dieAt=self.time.now+2900;
    });
    _tone(150,90,0.16,'sawtooth',0.07);
  },
  bearSlam:function(k){   // telegraphed ground-slam: a low wave of candles skittering along the floor both ways
    if(this.over||!this.enemyShots) return; var self=this;
    this.cameras.main.shake(260,0.012); _tone(90,200,0.18,'sawtooth',0.08); this.burst(k.x,GY-6,0xff3030,20);
    [-1,1].forEach(function(d){
      var s=self.enemyShots.create(k.x, GY-14, 'candle').setDepth(6);
      if(!s||!s.body) return; s.setScale(0.6); s.body.setAllowGravity(false); s.body.setSize(s.width*0.8,s.height*0.7);
      s.setTint(0xff5a2a); s.setVelocity(d*205, 0); s.setAngularVelocity(d*360); s.dieAt=self.time.now+2600;
    });
  },
  // Bank a checkpoint at the START of the NEXT world whenever a (non-final) world boss falls.
  // gameOver then continues from the FURTHEST world reached — not always World 2.
  bankCheckpoint:function(){ if(!PREMIUM_CHECKPOINTS) return; var nx=this.levelIdx+1;
    if(nx<LEVELS.length){ this.registry.set('nqCp',nx); this.registry.set('nqCpScore',this.score); } },
  bossDefeat:function(){
    if(this.over) return; this.over=true; var k=this.rugking, self=this;
    k.invuln=true; k.setVelocity(0,0); k.body.setAllowGravity(false);
    this.addScore(500);
    this.tweens.add({targets:k, angle:720, alpha:0, y:k.y-50, duration:1300, ease:'Cubic.in', onComplete:function(){ if(k.active) k.destroy(); }});
    var nx=this.levelIdx+1;
    if(this.def.bossType==='troll'){
      // THE TROLL down → hidden Crypto Trenches cleared → huge bounty, back to the surface.
      var retL=this.registry.get('nqRetLvl'), retX=this.registry.get('nqRetX')||120;
      this.addScore(2000);
      this.powerBanner('TROLL SLAIN!','WHO GOT TROLLED NOW? +2000 COINS','#2effa0');
      this.time.delayedCall(2000, function(){ if(retL!=null) this.scene.start('Game',{level:retL,score:this.score,lives:this.lives,spawnX:retX}); else this.scene.start('Game',{level:0,score:this.score,lives:this.lives}); },[],this);
    } else if(this.def.bossType==='liquidator'){
      // FINAL boss down → the run is complete.
      this.powerBanner('BEAR SLAIN!','THE GREAT BEAR IS FINISHED — GG','#3dff6e');
      this.time.delayedCall(1800, function(){ this.scene.start('Win',this.winData()); },[],this);
    } else if(this.def.bossType==='reaper'){
      // Yield Reaper down → World 7 done → on to World 8 (The Liquidation Cascade).
      this.bankCheckpoint();
      this.powerBanner('HARVESTED!','WORLD 7 CLEARED','#3dff6e');
      this.time.delayedCall(1800, function(){ this.advanceLevel(); },[],this);
    } else if(this.def.bossType==='golem'){
      // Hash Lord down → World 6 done → on to World 7 (The Yield Farm).
      this.bankCheckpoint();
      this.powerBanner('BLOCK BROKEN!','WORLD 6 CLEARED','#3dff6e');
      this.time.delayedCall(1800, function(){ this.advanceLevel(); },[],this);
    } else if(this.def.bossType==='ceo'){
      // Custodian down → World 4 done → on to World 5 (The Sacred Seeds).
      this.bankCheckpoint();
      this.powerBanner('DELISTED!','WORLD 4 CLEARED','#3dff6e');
      this.time.delayedCall(1800, function(){ this.advanceLevel(); },[],this);
    } else if(this.def.bossType==='wyrm'){
      // Vault Wyrm down → World 5 done → on to World 6 (Proof of Work).
      this.bankCheckpoint();
      this.powerBanner('WYRM SLAIN!','WORLD 5 CLEARED','#3dff6e');
      this.time.delayedCall(1800, function(){ this.advanceLevel(); },[],this);
    } else if(this.def.bossType==='kol'){
      // Scammy KOL down → World 3 done → on to World 4 (The Exchange) via the briefing.
      this.bankCheckpoint();
      this.powerBanner('SCAM EXPOSED!','WORLD 3 CLEARED','#3dff6e');
      this.time.delayedCall(1800, function(){ this.advanceLevel(); },[],this);
    } else {
      // Rug King → World 1 done → interlude cutscene (+ World-2 checkpoint), then World 2.
      this.bankCheckpoint();
      this.powerBanner('RUG PULLED!','WORLD 1 CLEARED','#3dff6e');
      this.time.delayedCall(1800, function(){ if(nx<LEVELS.length) this.scene.start('Interlude',{next:nx,score:this.score}); else this.scene.start('Win',this.winData()); },[],this);
    }
  },
  winData:function(){ return {score:this.score, boss:this.def.bossType||(this.def.boss?'rugking':'wormhole'), casino:this.registry.get('nqCasino')||0}; },
  advanceLevel:function(){ var next=this.levelIdx+1;
    if(next>=LEVELS.length){ this.scene.start('Win',this.winData()); return; }
    if(typeof BRIEFINGS!=='undefined' && BRIEFINGS[next]) this.scene.start('Briefing',{next:next,score:this.score});   // world-boundary briefing (e.g. 2-3 -> World 3)
    else this.scene.start('Game',{level:next,score:this.score,lives:3}); },

  /* ---------- WORMHOLE boss (burrow / erupt; weak point = the blue back shards) ---------- */
  startWormBoss:function(){
    var self=this, cx=this.def.width/2;
    // arena walls at both ends so you can't leave the fight
    [80, this.def.width-80].forEach(function(x){ var w=self.physics.add.staticImage(x,H/2,'brick').setDisplaySize(16,H*2.4).setAlpha(0); w.refreshBody(); self.physics.add.collider(self.player,w); });
    this.door.setVisible(false);
    // the worm — starts hidden below ground; erupts via tween
    var wm=this.worm=this.physics.add.sprite(cx, GY+140, 'wormhole'); wm.setScale(150/wm.height);
    wm.body.setAllowGravity(false); wm.setImmovable(true); wm.setDepth(7); wm.invuln=true; wm.setVisible(false);
    wm.body.setSize(wm.width*0.6, wm.height*0.7).setOffset(wm.width*0.2, wm.height*0.24);
    this.wormUpY=GY - wm.displayHeight/2 + 22; this.wormDownY=GY + wm.displayHeight/2 + 16;
    // NOTE: hits are checked MANUALLY in wormTick (a physics overlap doesn't track a tweened
    // immovable body, which is why the fight used to be impossible to win).
    var g=this.addGlow(wm,0x2ea8ff,4); if(g) this.tweens.add({targets:g,outerStrength:11,duration:500,yoyo:true,repeat:-1,ease:'Sine.inOut'});
    // telegraph mound (a stretched ground tile that swells before an eruption)
    this.mound=this.add.image(cx,GY,'ground').setDepth(5).setVisible(false).setTint(0xc96a2a);
    // HUD pips + label + a PERSISTENT how-to hint (stays up the whole fight)
    this.bossPips=[]; for(var i=0;i<3;i++) this.bossPips.push(this.hb(this.add.image(W/2-24+i*24,22,'heart').setScale(1.4).setDepth(40).setTint(0x66ddff)));
    this.hb(this.add.text(W/2,40,'WORMHOLE',{fontFamily:'"Press Start 2P"',fontSize:'11px',color:'#66ddff'}).setOrigin(.5,0).setDepth(40));
    this.wormHint=this.hb(this.add.text(W/2,56,'DODGE THE MOUND, THEN JUMP INTO THE BLUE SHARDS!',{fontFamily:'VT323',fontSize:'16px',color:'#66ddff'}).setOrigin(.5,0).setDepth(40));
    this.tweens.add({targets:this.wormHint,alpha:0.4,duration:700,yoyo:true,repeat:-1});
    this.powerBanner('WORMHOLE','IT ERUPTS FROM THE SAND — JUMP INTO THE BLUE SHARDS x3','#66ddff');
    this.wormState='wait'; this.wormNextAt=this.time.now+1600; this.wormTargetX=cx;
  },
  wormHit:function(){
    var wm=this.worm; if(!wm||wm.invuln) return; wm.invuln=true;
    SFX.boss(); this.burst(wm.x, wm.y+wm.displayHeight*0.15, 0x2ea8ff, 22); this.bossHP--;
    if(this.bossPips[this.bossHP]) this.bossPips[this.bossHP].setAlpha(.16);
    this.addScore(150); this.cameras.main.shake(240,.02);
    this.tweens.add({targets:wm,alpha:.35,duration:90,yoyo:true,repeat:5,onComplete:function(){ if(wm.active) wm.alpha=1; }});
    if(this.bossHP<=0){ this.wormDefeat(); return; }
    if(this.wormState==='up') this.wormNextAt=this.time.now;   // hit → retreat immediately
  },
  wormDefeat:function(){
    if(this.over) return; this.over=true; var wm=this.worm; if(this.mound) this.mound.setVisible(false);
    wm.invuln=true; this.addScore(800); this.cameras.main.shake(520,.03);
    this.tweens.add({targets:wm, y:this.wormDownY+40, angle:18, alpha:0, duration:1400, ease:'Cubic.in', onComplete:function(){ if(wm.active) wm.destroy(); }});
    this.bankCheckpoint();   // World 2 done → checkpoint at the start of World 3
    this.powerBanner('WORMHOLE CLOSED!','NORMIE SEALS THE BRIDGE — GG','#66ddff');
    this.time.delayedCall(2300, function(){ this.advanceLevel(); },[],this);
  },
  wormTick:function(now){
    if(this.over||!this.worm) return; var wm=this.worm, p=this.player, st=this.wormState;
    // --- MANUAL hit check (reliable — a physics overlap can't track a tweened body) ---
    if(st==='up' && !wm.invuln){
      var pb=p.body, hw=wm.displayWidth*0.36, htop=wm.y-wm.displayHeight*0.22;
      if(pb.right>wm.x-hw && pb.left<wm.x+hw && pb.bottom>htop && pb.top<GY+8){
        if(now<this.moonUntil||now<this.whaleUntil){ this.wormHit(); }
        else if(!(pb.blocked.down||pb.touching.down)){ p.setVelocityY(-300); this.wormHit(); }   // airborne = leap into the shards = HIT
        else { p.setVelocityX((p.x<wm.x?-1:1)*150); }   // on the ground = shoved back, no damage (so you learn to jump)
      }
    }
    // --- phase machine (fully TIMESTAMP-driven so it can never get stuck) ---
    if(now < this.wormNextAt) return;
    if(st==='wait'){
      this.wormTargetX=Phaser.Math.Clamp(p.x+Phaser.Math.Between(-70,70), 150, this.def.width-150);
      this.mound.setPosition(this.wormTargetX, GY-2).setScale(0.6,0.4).setVisible(true);
      this.tweens.add({targets:this.mound, scaleX:2.4, scaleY:0.8, duration:820, ease:'Quad.out'});
      this.wormState='telegraph'; this.wormNextAt=now+880;
    } else if(st==='telegraph'){
      this.mound.setVisible(false);
      wm.setPosition(this.wormTargetX, this.wormDownY).setVisible(true).setAngle(0).setAlpha(1); wm.invuln=false;
      var grounded=p.body.blocked.down||p.body.touching.down;   // erupting under a grounded player hurts (dodge!)
      if(grounded && Math.abs(p.x-this.wormTargetX)<wm.displayWidth*0.45 && !p.invuln && now>=this.shieldUntil && now>=this.coldUntil && now>=this.whaleUntil) this.hurt(p, p.x<this.wormTargetX?-1:1);
      this.cameras.main.shake(220,.015);
      this.tweens.add({targets:wm, y:this.wormUpY, duration:280, ease:'Back.out'});
      this.wormState='up'; this.wormNextAt=now+2400;
    } else if(st==='up'){
      wm.invuln=true; this.tweens.add({targets:wm, y:this.wormDownY, duration:340, ease:'Quad.in'});
      this.wormState='retreat'; this.wormNextAt=now+380;
    } else if(st==='retreat'){
      wm.setVisible(false); this.wormState='wait'; this.wormNextAt=now+650;
    }
  },

  /* ---------- mini-worms (World 2 hazard): burrow / pop / spit a radial fan of sticks ---------- */
  miniwormTick:function(now){
    var self=this;
    if(this.miniworms) this.miniworms.children.iterate(function(mw){
      if(!mw||!mw.active||mw.dead) return; var st=mw.mwState;
      if(st==='hidden' && now>mw.mwNextAt){
        mw.mwState='rising'; mw.setVisible(true);
        self.tweens.add({targets:mw, y:mw.upY, duration:230, ease:'Back.out', onComplete:function(){ if(!mw.active||mw.dead) return; mw.mwState='up'; self.fireMiniBurst(mw); mw.mwNextAt=self.time.now+1200; }});
      } else if(st==='up' && now>mw.mwNextAt){
        mw.mwState='retreat';
        self.tweens.add({targets:mw, y:mw.downY, duration:230, ease:'Quad.in', onComplete:function(){ if(!mw.active||mw.dead) return; mw.setVisible(false); mw.mwState='hidden'; mw.mwNextAt=self.time.now+Phaser.Math.Between(1500,2500); }});
      }
    });
    if(this.enemyShots) this.enemyShots.children.iterate(function(s){
      if(!s||!s.active) return;
      if(now>s.dieAt || s.x<-24 || s.x>self.LW+24 || s.y>H+50 || s.y<-60) s.destroy();
    });
  },
  fireMiniBurst:function(mw){
    if(this.over) return; var n=7, spread=Math.PI*0.92, base=-Math.PI/2 - spread/2, self=this;
    for(var i=0;i<n;i++){
      var ang=base + spread*(i/(n-1));
      var s=this.enemyShots.create(mw.x, mw.y-mw.displayHeight*0.28, 'stick').setDepth(6);
      s.body.setAllowGravity(false); s.body.setSize(s.width*0.7,s.height*0.7);
      s.setRotation(ang); s.setVelocity(Math.cos(ang)*160, Math.sin(ang)*160);
      s.dieAt=this.time.now+2400;
    }
    SFX.stomp();
  },
  miniwormTouch:function(player,mw){
    if(this.over||mw.dead||!mw.visible||mw.mwState==='hidden'||mw.mwState==='retreat') return;
    var now=this.time.now;
    if(now<this.moonUntil||now<this.whaleUntil){ this.killMiniworm(mw); return; }
    var onTop=(player.body.bottom<=mw.body.top+12)&&player.body.velocity.y>=-20;
    if(onTop){ player.setVelocityY(-300); this.killMiniworm(mw); return; }
    if(player.invuln||now<this.shieldUntil||now<this.coldUntil) return;
    this.hurt(player, mw.x<player.x?1:-1);
  },
  killMiniworm:function(mw){
    if(mw.dead) return; mw.dead=true; this.addScore(20); this.burst(mw.x,mw.y,0x3dff6e,12); SFX.stomp();
    this.tweens.killTweensOf(mw);
    this.tweens.add({targets:mw, y:mw.downY, alpha:0, duration:280, onComplete:function(){ if(mw.active) mw.destroy(); }});
  },
  shotHit:function(player,shot){
    if(this.over){ return; } shot.destroy();
    var tn=this.time.now; if(player.invuln||tn<this.shieldUntil||tn<this.moonUntil||tn<this.omegaUntil||tn<this.whaleUntil||tn<this.coldUntil) return;
    this.hurt(player, (shot.body&&shot.body.velocity.x<0)?1:-1);
  },

  /* ---------- Phase 2 hazards: FUD gas, Sniper bolts, Honeypot traps, Pump-&-Dump ---------- */
  emitGas:function(e){   // FUDster coughs a drifting slow-gas puff
    if(this.over||!this.gasClouds) return;
    var g=this.gasClouds.create(e.x + e.dir*8, e.y-4, 'gas').setDepth(5);
    if(!g||!g.body) return;
    g.body.setAllowGravity(false); g.setAlpha(0.72).setScale(0.55); g.body.setSize(g.width*0.66,g.height*0.66);
    g.setVelocity(e.dir*22, -16);
    this.tweens.add({targets:g, scaleX:1.5, scaleY:1.5, alpha:0, duration:2100, ease:'Sine.out', onComplete:function(){ if(g.active) g.destroy(); }});
  },
  gasTouch:function(player,cloud){   // inside FUD gas → slowed (no life lost)
    if(this.over) return; var now=this.time.now;
    this.slowUntil=now+1200;
    if(!this._fudFlashAt||now>this._fudFlashAt){ this._fudFlashAt=now+1600; this.flash('FUD SLOWS YOU — PUSH THROUGH','#7ec86e'); }
  },
  sniperFire:function(e,p){   // Sniper Bot fires an aimed bolt at the player
    if(this.over||!this.enemyShots) return;
    var dx=p.x-e.x, dy=(p.y-6)-e.y, d=Math.hypot(dx,dy)||1, sp=205;
    var s=this.enemyShots.create(e.x, e.y-6, 'bullet').setDepth(6);
    if(!s||!s.body) return;
    s.body.setAllowGravity(false); s.body.setSize(s.width*0.9,s.height*0.9);
    s.setVelocity(dx/d*sp, dy/d*sp); s.dieAt=this.time.now+2600;
    _tone(900,300,0.10,'square',0.05);
  },
  honeypotHit:function(player,hp){   // mimic trap: looks like treasure, snaps once — DRAINS COINS, never a life
    if(this.over||hp.sprung) return; var now=this.time.now;
    // GIGA CHAD / WHALE / COLD WALLET are immune — plow straight through the honeypot, no coin drain, no snare.
    if(now<this.omegaUntil||now<this.whaleUntil||now<this.coldUntil){ hp.sprung=true; if(hp.body) hp.body.enable=false; this.tweens.killTweensOf(hp);
      var hc=now<this.whaleUntil?0x2f7fff:(now<this.coldUntil?0x9fe8ff:0xffa020);
      this.burst(hp.x,hp.y,hc,14); this.cameras.main.shake(70,.006); this.flash('HONEYPOT SMASHED!','#ffd23f'); return; }
    hp.sprung=true;
    this.tweens.killTweensOf(hp); this.cameras.main.shake(120,.008); this.burst(hp.x,hp.y,0xff5544,16);
    hp.setTint(0xff6644); this.tweens.add({targets:hp,scaleX:hp.scaleX*1.18,duration:110,yoyo:true});
    if(hp.body) hp.body.enable=false;   // one-shot
    // A honeypot is a can't-sell scam: it drains your COINS (never a heart) + a brief sticky snare.
    // Drains ALL the coins you earned THIS level (score down to the level's starting bank) — never
    // your accumulated total from earlier levels, and never a life.
    var steal=Math.max(0, this.score - (this.levelStartScore||0));
    if(steal>0){ this.score-=steal; this.hudScore.setText('SCORE '+this.score); }
    this.slowUntil=Math.max(this.slowUntil||0, now+700);   // sticks you for a beat (never lethal on its own)
    if(steal>0) this.coinLossBanner(steal,'HONEYPOT!','#ff6644');   // mid-tier notice so the coin loss clearly registers
    else this.flash("HONEYPOT — NOTHING TO DRAIN!",'#ff9500');
  },
  pumpDumpTick:function(now,p,b){   // solid until stepped on, then DUMPS (falls away) and respawns
    if(!this.pumpDumps) return; var self=this;
    this.pumpDumps.children.iterate(function(m){
      if(!m) return;
      if(m.pdState==='idle'){
        var onIt=(b.blocked.down||b.touching.down) && p.body.bottom<=m.body.top+10 && p.body.bottom>=m.body.top-12 && p.body.right>m.body.left+2 && p.body.left<m.body.right-2;
        if(onIt){ m.pdState='warn'; m.pdAt=now; m.setTint(0xffd23f); }
      } else if(m.pdState==='warn'){
        m.setAlpha(0.55+0.45*Math.abs(Math.sin(now/45)));   // flash a warning
        if(now-m.pdAt>430){ m.pdState='dump'; m.pdAt=now; m.body.enable=false; m.setAlpha(1).setTint(0xff5544);
          self.tweens.add({targets:m, y:m.homeY+72, alpha:0.12, angle:12, duration:520, ease:'Quad.in'}); }
      } else if(m.pdState==='dump'){
        if(now-m.pdAt>1900){ m.pdState='idle'; self.tweens.killTweensOf(m); m.y=m.homeY; m.angle=0; m.setAlpha(1).setTint(0x3dff9e); m.body.enable=true; }
      }
    });
  },
  bridgePlankTick:function(now,p,b){   // THE BRIDGE: step on a plank → it gets "exploited" and drops into the void → respawns
    if(!this.bridgePlanks) return; var self=this;
    this.bridgePlanks.children.iterate(function(m){
      if(!m) return;
      if(m.bpState==='idle'){
        var onIt=(b.blocked.down||b.touching.down) && p.body.bottom<=m.body.top+10 && p.body.bottom>=m.body.top-12 && p.body.right>m.body.left+2 && p.body.left<m.body.right-2;
        if(onIt){ m.bpState='warn'; m.bpAt=now; }
      } else if(m.bpState==='warn'){
        m.setTint(0xff6644); m.setAlpha(0.5+0.5*Math.abs(Math.sin(now/40)));   // shudder — the exploit is landing
        if(now-m.bpAt>240){ m.bpState='gone'; m.bpAt=now; m.body.enable=false; m.setAlpha(1);
          self.tweens.add({targets:m, y:m.homeY+130, alpha:0.08, angle:Phaser.Math.Between(-22,22), duration:500, ease:'Quad.in'}); }
      } else if(m.bpState==='gone'){
        if(now-m.bpAt>1600){ m.bpState='idle'; self.tweens.killTweensOf(m); m.y=m.homeY; m.angle=0; m.setAlpha(1).setTint(0x8a5a2b); m.body.enable=true; }
      }
    });
  },
  depegTick:function(now){   // THE DEPEG: the whole "stable" peg breaks on a global rhythm — telegraph, drop, restore
    if(!this.pegs || !this.pegs.getLength()) return; var self=this;
    if(now<this.depegNextAt){
      if(this.depegPhase==='warn') this.pegs.children.iterate(function(m){ if(m&&m.active) m.setAlpha(0.45+0.55*Math.abs(Math.sin(now/38))); });
      return;
    }
    if(this.depegPhase==='stable'){        // stable → telegraph the break
      this.depegPhase='warn'; this.depegNextAt=now+780;
      this.pegs.children.iterate(function(m){ if(m) m.setTint(0xffd23f); });
    } else if(this.depegPhase==='warn'){    // → DEPEG: the peg drops into the void
      this.depegPhase='dropped'; this.depegNextAt=now+1400; this.cameras.main.shake(220,.010);
      this.pegs.children.iterate(function(m){ if(!m) return; m.body.enable=false; m.setAlpha(1).setTint(0xff5544);
        self.tweens.add({targets:m, y:m.homeY+150, alpha:0.06, angle:Phaser.Math.Between(-14,14), duration:460, ease:'Quad.in'}); });
    } else {                                 // dropped → RE-PEG (restore)
      this.depegPhase='stable'; this.depegNextAt=now+3600;
      this.pegs.children.iterate(function(m){ if(!m) return; self.tweens.killTweensOf(m); m.y=m.homeY; m.angle=0; m.setAlpha(1).setTint(0x2ee6a0); m.body.enable=true; });
    }
  },
  yieldTick:function(now,p,b){   // THE YIELD FARM: compound a lift UP while you ride it; harvest at the top; sinks when you step off
    if(!this.yields || !this.yields.getLength()) return; var self=this;
    this.yields.children.iterate(function(m){
      if(!m) return;
      // riding? standing on (or settling onto) the lift top, horizontally over it. Position-based
      // band + "not leaping upward" is robust to arcade not always flagging blocked.down on a thin
      // immovable body; the collision flags are a fast-accept path.
      var onTop = p.body.right>m.body.left+2 && p.body.left<m.body.right-2 &&
                  p.body.bottom<=m.body.top+12 && p.body.bottom>=m.body.top-18;
      // resting (vy≈0) and being-carried-up (vy≈-150) both qualify; fast fall-through / a jump-off
      // leaves the band or exceeds the down-speed gate, so it won't false-trigger.
      var riding = onTop && p.body.velocity.y<=60;
      if(riding){
        if(m.yLevel<m.maxSteps && now>m.compAt){ m.compAt=now+self.yieldStepMs; m.yLevel++;
          _tone(440+m.yLevel*90, 60, 0.05, 'square', 0.04);   // rising compound "tick"
          if(m.yLevel>=m.maxSteps && !m.harvested){ m.harvested=true;   // HARVEST — one-time bonus at the top
            self.addScore(15); SFX.coin(); self.burst(m.x, m.body.top, 0xffd23f, 12);
            var t=self.add.text(m.x, m.body.top-10, 'HARVEST +15', {fontFamily:'"Press Start 2P"',fontSize:'8px',color:'#ffd23f'}).setOrigin(.5).setDepth(30);
            self.tweens.add({targets:t, y:t.y-26, alpha:0, duration:760, ease:'Quad.out', onComplete:function(){ t.destroy(); }});
          }
        }
      } else if(m.yLevel>0 && now>m.compAt){   // not ridden → slowly de-compound back to base
        m.compAt=now+Math.round(self.yieldStepMs*1.35); m.yLevel--; if(m.yLevel<m.maxSteps) m.harvested=false;
      }
      // ease the STATIC platform toward its target height by POSITION, and carry the rider by the
      // same delta (static bodies don't integrate velocity; this mirrors the moving-platform carry).
      var targetY=m.homeY - m.yLevel*m.stepPx;
      var newY=Phaser.Math.Linear(m.y, targetY, 0.2); if(Math.abs(newY-targetY)<0.5) newY=targetY;
      var dyMove=newY-m.y;
      if(dyMove!==0){ if(riding) p.y+=dyMove; m.y=newY; if(m.body) m.body.updateFromGameObject(); }
      var f=m.yLevel/m.maxSteps;   // brighter/gold as APY compounds
      m.setTint(f>=1 ? 0xffd23f : Phaser.Display.Color.GetColor(0x2e+Math.round(f*0x90), 0xe6, 0x6a-Math.round(f*0x30)));
      if(m.yGlow) m.yGlow.outerStrength=3+f*7;
    });
  },
  cascadeTick:function(now,p){   // THE LIQUIDATION CASCADE: a red wall grinds in from the left; fall behind = liquidated
    var c=this.cascade; if(!c||this.over) return;
    var dt=Math.min((now-(c.lastNow||now))/1000, 0.05); c.lastNow=now; c.x += c.speed*dt;   // real-time advance (frame-rate independent)
    var g=c.g, top=0, bot=H+380, edge=c.x|0;
    g.clear();
    g.fillStyle(0x6a0a0e,0.44); g.fillRect(-40,top,edge+40,bot);           // the red flood behind the edge
    g.fillStyle(0xb01418,0.55); g.fillRect(edge-26,top,26,bot);            // darker leading band
    g.fillStyle(0xff3030,0.95); g.fillRect(edge-4,top,7,bot);             // bright liquidation edge
    for(var i=0;i<12;i++){ var yy=((now*0.25+i*47)%bot); g.fillStyle(0xff5a4a,0.7); g.fillRect(edge-2, yy, 3, 10); }  // dripping candles
    if(now>c.nextRumble){ c.nextRumble=now+900; this.cameras.main.shake(120,0.003); _tone(70,140,0.10,'sawtooth',0.05); }
    // caught behind the edge?
    if(p.x < c.x+6){
      var immune=(now<this.shieldUntil||now<this.moonUntil||now<this.omegaUntil||now<this.whaleUntil||now<this.coldUntil);
      if(!immune && !p.invuln){ this.hurt(p, 1); }
      p.x = c.x + 34; if(p.body.velocity.x < 120) p.setVelocityX(150);   // shove ahead of the wall either way
    }
  },
  freezeEnemies:function(ms){   // COLD WALLET: everything on screen ices over and stops for the duration
    this.frozenUntil=this.time.now+ms;
    if(this.enemies) this.enemies.children.iterate(function(e){ if(e&&e.active){ e.setVelocity(0,0); e.setTint(0x9fe8ff); } });
  },
  shockTick:function(now){   // WHALE MODE + MEGA GIGA CHAD: a periodic shock ring that clears nearby enemies
    var active = now<this.whaleUntil || (now<this.omegaUntil && this.levelIdx>=18);
    if(!active || now<this.whaleShockAt) return;
    this.whaleShockAt=now+1200; var p=this.player, R=132, col=(now<this.whaleUntil)?0x2f7fff:0xffa020, self=this;
    this.burst(p.x,p.y,col,24); this.cameras.main.shake(110,0.006); _tone(150,55,0.14,'sawtooth',0.05);   // low shockwave thud — NOT the power-up jingle (it fires every 1.2s)
    if(this.enemies) this.enemies.children.iterate(function(e){ if(e&&e.active && Phaser.Math.Distance.Between(e.x,e.y,p.x,p.y)<R){ var ex=e.x,ey=e.y; e.disableBody(true,true); self.addScore(20); self.burst(ex,ey,col,8); } });
    var ring=this.add.circle(p.x,p.y,10).setStrokeStyle(3,col,0.9).setDepth(8);
    this.tweens.add({targets:ring, radius:R, alpha:0, duration:430, ease:'Quad.out', onComplete:function(){ ring.destroy(); }});
  },
  // Cheap ledge guard: ground-lane patrols (NPCs, casino folk, non-ghost enemies) all walk on
  // the ground row, so "is there a pit ahead?" is just a gaps[] test (O(gaps)≈5) instead of
  // scanning every platform tile per entity per frame (was O(entities×~550 tiles) → desktop lag).
  overPit:function(x){ var g=this.gaps; if(!g) return false; for(var i=0;i<g.length;i++){ if(x>=g[i][0]&&x<g[i][1]) return true; } return false; },
  npcTick:function(now){   // "Wen Lambo" bystanders pace their patch and shout on a cadence
    if(!this.npcs) return; var self=this;
    this.npcs.children.iterate(function(n){
      if(!n||!n.active) return;
      if(n.x<n.homeX-n.range) n.dir=1; if(n.x>n.homeX+n.range) n.dir=-1;
      if(n.body.blocked.left) n.dir=1; if(n.body.blocked.right) n.dir=-1;
      if(n.body.blocked.down){   // don't stroll off a ledge into a pit
        var ahead=n.x+n.dir*(n.body.width*0.5+4);
        if(self.overPit(ahead)) n.dir=-n.dir;
      }
      n.setVelocityX(n.dir*n.baseSpeed); n.setFlipX(n.dir<0);
      if(now>n.nextSay){ n.nextSay=now+Phaser.Math.Between(2600,4400); self.npcSay(n); }
    });
  },
  npcSay:function(n){
    var phrases=['WEN LAMBO???','WEN LAMBO???','WEN LAMBO???','SER WEN LAMBO?','WEN MOON?','IS IT PUMPING?','WAGMI!','GM GM','TOP SIGNAL?'];
    var msg=Phaser.Math.RND.pick(phrases);
    var t=this.add.text(n.x, n.y-n.displayHeight*0.5-6, msg, {fontFamily:'VT323',fontSize:'15px',color:'#0d0b1e',backgroundColor:'#ffd23f',padding:{x:5,y:2},align:'center'}).setOrigin(.5,1).setDepth(25);
    this.tweens.add({targets:t, y:t.y-14, duration:1900, ease:'Sine.out'});
    this.tweens.add({targets:t, alpha:0, delay:1300, duration:600, onComplete:function(){ if(t){ t.destroy(); } }});
  },
  // ---- Casino folk: Drink Ladies (take money) & Show Ladies (Lil Normie -> child support) ----
  casinoTick:function(now){
    if(!this.casino) return; var self=this;
    this.casino.children.iterate(function(f){
      if(!f||!f.active) return;
      if(f.x<f.homeX-f.range) f.dir=1; if(f.x>f.homeX+f.range) f.dir=-1;
      if(f.body.blocked.left) f.dir=1; if(f.body.blocked.right) f.dir=-1;
      if(f.body.blocked.down){
        var ahead=f.x+f.dir*(f.body.width*0.5+4);
        if(self.overPit(ahead)) f.dir=-f.dir;
      }
      f.setVelocityX(f.dir*f.baseSpeed); f.setFlipX(f.dir<0);
    });
  },
  casinoTouch:function(player,f){
    var now=this.time.now;
    if(this.over || now<f.coolUntil) return;
    if(now<this.moonUntil || now<this.omegaUntil || now<this.whaleUntil || now<this.coldUntil) return;   // powered up = they leave you alone
    // NOTE: casino folk NEVER cost a life — Drink Ladies only take coins, Show Ladies only add
    // a kid. Long cooldowns so they can't pester you into a stack while you play the slots.
    if(f.folk==='drink'){
      f.coolUntil=now+5000;
      var steal=Math.min(this.score,25);
      if(steal>0){ this.score-=steal; this.hudScore.setText('SCORE '+this.score); }
      this.flash(steal>0?('DRINK LADY: -'+steal+' 🍸'):"DRINK LADY: TAB'S EMPTY 🍸",'#ff77cc');
      this.burst(f.x,f.y-6,0xff66cc,10); SFX.coin();
    } else {
      f.coolUntil=now+7000;
      if((this.kids||0) >= 3){ this.flash("ENOUGH KIDS, NORMIE! 👶",'#ffd23f'); return; }   // cap the brood at 3
      this.kids=(this.kids||0)+1; this.childSupportAt=now+4000;
      this.spawnLilNormie(f);
      this.flash(this.kids>1?('LIL NORMIE #'+this.kids+'! MORE CHILD SUPPORT 👶'):"IT'S LIL NORMIE! CHILD SUPPORT DUE 👶",'#ffd23f');
      this.cameras.main.flash(160,255,240,150);
    }
  },
  spawnLilNormie:function(f){   // a baby Normie pops out and toddles off (cosmetic)
    var baby=this.add.image(f.x, f.y-6, 'lilnormie').setDepth(24); if(baby.height) baby.setScale(22/baby.height);
    this.tweens.add({targets:baby, y:baby.y-20, duration:900, ease:'Sine.out'});
    this.tweens.add({targets:baby, alpha:0, delay:1100, duration:700, onComplete:function(){ baby.destroy(); }});
  },
  childSupportTick:function(now){   // recurring coin drain while Normie has kids (gentle + steady)
    if(!this.kids || this.over || now<this.childSupportAt) return;
    this.childSupportAt = now + 4500;   // steady, gentle cadence (no longer speeds up with kids)
    if(this.score<=0) return;
    var pay=Math.min(this.score, this.kids*4);
    this.score-=pay; this.hudScore.setText('SCORE '+this.score);
    var p=this.player, t=this.add.text(p.x, p.y-24, 'CHILD SUPPORT -'+pay+' 👶', {fontFamily:'VT323',fontSize:'14px',color:'#ffd23f'}).setOrigin(.5,1).setDepth(25);
    this.tweens.add({targets:t, y:t.y-18, alpha:0, duration:1200, onComplete:function(){ t.destroy(); }});
  },

  /* ---------- Normie Casino slot machines ("fire it in" for bonus coins) ---------- */
  slotTick:function(now,p,b,jumpEdge){
    if(!this.slots || !this.slots.length) return false;
    var self=this, consumed=false, nearest=null, nd=1e9;
    // keep the always-on "TAP TO SPIN" hint honest: dim/relabel out of credits, hide mid-spin
    this.slots.forEach(function(S){ if(!S.tapHint) return;
      if(S.spin){ S.tapHint.setVisible(false); }
      else if(S.spinsLeft<=0){ S.tapHint.setText('NO CREDITS').setColor('#6a6590').setVisible(true); }
      else { S.tapHint.setText('TAP TO SPIN ▾').setColor('#ffd23f').setVisible(true); } });
    // advance any machine that is currently spinning
    this.slots.forEach(function(S){
      if(!S.spin) return; var sp=S.spin;
      if(now<sp.landAt){
        if(now>=sp.nextCycle){ sp.nextCycle=now+70; S.reelIcons.forEach(function(ic){ ic.setTexture(Phaser.Math.RND.pick(S.syms)).setDisplaySize(16,16); }); }
      } else if(!sp.landed){
        sp.landed=true; sp.result=[Phaser.Math.RND.pick(S.syms),Phaser.Math.RND.pick(S.syms),Phaser.Math.RND.pick(S.syms)];
        S.reelIcons.forEach(function(ic,i){ ic.setTexture(sp.result[i]).setDisplaySize(18,18); });
        self.slotPayout(sp.result, S); sp.hideAt=now+1500;
      } else if(now>=sp.hideAt){
        S.reelBox.setVisible(false); S.reelIcons.forEach(function(ic){ ic.setVisible(false); }); S.spin=null;
      }
    });
    // the machine you're standing at: show its prompt, hide the rest
    // Generous reach — you can play a machine from a good chunk of the screen away, so the
    // wandering casino folk can't bump you off it. Nearest credited machine wins.
    var grounded=(b.blocked.down||b.touching.down);
    this.slots.forEach(function(S){ var dx=Math.abs(p.x-S.m.x); if(grounded && dx<120 && Math.abs(p.y-S.m.y)<96 && dx<nd){ nd=dx; nearest=S; } });
    this.slots.forEach(function(S){ if(S!==nearest) S.prompt.setVisible(false); });
    if(nearest){
      nearest.prompt.setText(nearest.spinsLeft>0?('▶ TAP MACHINE TO SPIN\n'+nearest.label+' ('+nearest.spinsLeft+')'):'OUT OF\nCREDITS').setVisible(true);
    }
    // DECOUPLED (owner ask 2026-07-13): the JUMP button NEVER spins the machine — you must always be
    // able to jump away from a ghost while standing at a slot. Spinning is TAP-the-machine only
    // (trySpinSlot). So slotTick never consumes the jump.
    return false;
  },
  // TAP-to-spin: fired by tapping the slot machine. Spins if the player is within reach + it has credits.
  trySpinSlot:function(S){
    if(this.over||!S||S.spinsLeft<=0||S.spin) return; var p=this.player; if(!p) return;
    if(Math.abs(p.x-S.m.x)<260 && Math.abs(p.y-S.m.y)<170) this.startSpin(this.time.now, S);   // generous reach — tap from a little distance
  },
  startSpin:function(now, S){
    S.spinsLeft--; SFX.coin();
    S.reelBox.setVisible(true); S.reelIcons.forEach(function(ic){ ic.setVisible(true); });
    S.spin={landAt:now+950, nextCycle:now, landed:false, result:null, hideAt:0};
    this.flash(S.label+'!','#ffd23f');
  },
  slotPayout:function(r, S){
    var pay, msg, big=false;
    // Loosened (owner's call — the Drink Ladies were out-earning the machine). Every spin still pays.
    if(r[0]===r[1]&&r[1]===r[2]){ pay=150; msg='JACKPOT!'; big=true; }
    else if(r[0]===r[1]||r[1]===r[2]||r[0]===r[2]){ pay=50; msg='MATCH!'; }
    else { pay=25; msg='NICE'; }
    pay=Math.round(pay*(S.mult||1)); if(S.big){ big=big||pay>=300; if(msg==='JACKPOT!') msg='💎 MEGA JACKPOT!'; }
    this.addScore(pay); this.registry.set('nqCasino',(this.registry.get('nqCasino')||0)+pay);   // tally run-total casino winnings for the finale
    this.burst(S.m.x, S.m.y-24, 0xffd23f, big?26:14); SFX.power();
    this.flash(msg+' +'+pay+' COINS', big?'#3dff6e':'#ffd23f'); this.cameras.main.flash(200, 255, big?255:220, big?150:90);
    // floating "+N COINS" popup right AT the machine so the win is unmistakable — pops in, HOLDS
    // ~1s at full opacity (so you can actually read the amount), THEN floats up and fades.
    var wy=S.m.y - S.m.displayHeight*0.5 - 4;
    var pop=this.add.text(S.m.x, wy, '+'+pay+' COINS', {fontFamily:'"Press Start 2P"',fontSize:'11px',color:big?'#3dff6e':'#ffd23f'}).setOrigin(.5,1).setDepth(22).setShadow(0,1,'#000',3);
    pop.setScale(0.6); this.tweens.add({targets:pop, scale:1, duration:200, ease:'Back.out'});
    this.tweens.add({targets:pop, y:wy-30, duration:1900, ease:'Sine.out'});
    this.tweens.add({targets:pop, alpha:0, delay:1050, duration:850, onComplete:function(){ pop.destroy(); }});
  },

  loseLife:function(reason){ this.lives--; if(this.hearts[this.lives]) this.hearts[this.lives].setAlpha(.16); if(this.lives<=0) this.gameOver(reason); },
  hurt:function(player,knockDir){
    // Super Geek audit: absorb the next hit instead of losing a life (consumes the shield)
    if(this.geekShield){ this.geekShield=false; player.invuln=true; this.cameras.main.flash(150,46,230,200); SFX.power(); this.flash('AUDIT BLOCKED IT!','#2ee6c0');
      this.tweens.add({targets:player,alpha:.3,duration:90,yoyo:true,repeat:5,onComplete:function(){ player.alpha=1; player.invuln=false; }}); return; }
    this.solanaUntil=0;   // taking damage ends SOLANA MODE
    this.cameras.main.shake(140,.012); SFX.hurt(); this.burst(player.x,player.y,0xff3860,12); this.loseLife('WRECKED BY FUD'); if(this.over) return;
    player.invuln=true; player.setVelocity(knockDir*160,-160);
    this.tweens.add({targets:player,alpha:.25,duration:100,yoyo:true,repeat:8,onComplete:function(){ player.alpha=1; player.invuln=false; }});
  },
  hb:function(o){ this.hudBox.add(o); return o; },   // route a HUD object into the pinned container
  addGlow:function(o,color,outer){ if(this.renderer.type!==Phaser.WEBGL||!o.postFX) return null; try{ return o.postFX.addGlow(color, outer||4, 0, false, 0.1, 16); }catch(e){ return null; } },
  addScore:function(n){ this.score+=n; this.hudScore.setText('SCORE '+this.score); },
  burst:function(x,y,tint,count){ var e=this.add.particles(x,y,'spark',{speed:{min:30,max:160},lifespan:420,scale:{start:1.1,end:0},tint:tint,emitting:false,blendMode:'ADD'}).setDepth(30); e.explode(count||10); this.time.delayedCall(520,function(){ e.destroy(); }); },
  flash:function(msg,color){ var t=this.hb(this.add.text(W/2,70,msg,{fontFamily:'"Press Start 2P"',fontSize:'12px',color:color}).setOrigin(.5)); this.tweens.add({targets:t,y:52,alpha:0,duration:1200,onComplete:function(){t.destroy();}}); },
  // mid-tier notice (bigger than flash, smaller than powerBanner): a centered pill with the coin
  // icon + amount — used when something DRAINS your coins so it clearly registers.
  coinLossBanner:function(amount,label,color){
    var d=61, cy=66, cx=W/2, col=Phaser.Display.Color.HexStringToColor(color).color;
    var pill=this.hb(this.add.rectangle(cx,cy,204,40,0x140a10,0.94).setScrollFactor(0).setDepth(d).setStrokeStyle(2,col));
    var ic=this.hb(this.add.image(cx-74,cy,'coin').setScrollFactor(0).setDepth(d+1)); if(ic.height) ic.setScale(22/ic.height);
    var t1=this.hb(this.add.text(cx-54,cy-9,label,{fontFamily:'"Press Start 2P"',fontSize:'8px',color:color}).setOrigin(0,.5).setScrollFactor(0).setDepth(d+1));
    var t2=this.hb(this.add.text(cx-54,cy+9,'-'+amount+' COINS',{fontFamily:'"Press Start 2P"',fontSize:'12px',color:'#ffd23f'}).setOrigin(0,.5).setScrollFactor(0).setDepth(d+1));
    var items=[pill,ic,t1,t2]; items.forEach(function(o){ o.alpha=0; });
    this.tweens.add({targets:items,alpha:1,duration:170});
    this.tweens.add({targets:t2,scale:{from:0.7,to:1},duration:260,ease:'Back.out'});
    this.cameras.main.shake(90,.004);
    this.time.delayedCall(1350,function(){ this.tweens.add({targets:items,alpha:0,y:'-=12',duration:420,onComplete:function(){ items.forEach(function(o){o.destroy();}); }}); },[],this);
  },

  levelClear:function(){
    if(this.over) return; this.over=true; this.addScore(this.timeLeft*10); this.physics.pause(); SFX.clear();
    var big=this.hb(this.add.text(W/2,120,'WORLD '+this.def.name+' CLEAR!',{fontFamily:'"Press Start 2P"',fontSize:'16px',color:'#3dff6e'}).setOrigin(.5));
    this.tweens.add({targets:big,scale:1.15,duration:400,yoyo:true,repeat:1});
    var next=this.levelIdx+1;
    this.time.delayedCall(1500,function(){ if(next<LEVELS.length) this.scene.start('Game',{level:next,score:this.score,lives:3}); else this.scene.start('Win',this.winData()); },[],this);   // refill hearts each world; score stays cumulative
  },
  gameOver:function(reason){ if(this.over) return; this.over=true; this.physics.pause();
    // TEST BUILD: no run-ending — bounce back to LEVEL SELECT so a tester can retry/switch instantly.
    if(TEST_MODE){ this.hb(this.add.text(W/2,120,'TEST — back to LEVEL SELECT',{fontFamily:'"Press Start 2P"',fontSize:'10px',color:'#ff6a99'}).setOrigin(.5)); this.time.delayedCall(900,function(){ this.scene.start('LevelSelect'); },[],this); return; }
    // Per-world checkpoint: died past a banked world boundary → continue from the FURTHEST world
    // reached (start of that world), not always World 2. cpLvl is the highest banked level index.
    var cpLvl = PREMIUM_CHECKPOINTS ? (this.registry.get('nqCp')||0) : 0;
    var useCp = cpLvl>0 && this.levelIdx>=cpLvl;
    var cont = useCp ? cpLvl : 0, contScore = useCp ? (this.registry.get('nqCpScore')||0) : 0;
    this._cont=cont; this._contScore=contScore;   // (exposed for tests)
    this.time.delayedCall(600,function(){ this.scene.start('Over',{score:this.score,reason:reason,level:this.def.name,cont:cont,contScore:contScore}); },[],this); },

  // ---- PAUSE (manual ⏸ / P / Esc, or 10s idle auto-pause). Self-contained in-scene freeze:
  //      physics + the scene clock (level countdown + boss delayedCalls) + tweens, plus a HUD
  //      overlay. Kept OFF the scene-manager (no scene.pause/launch) to avoid launch-vs-pause races.
  pauseGame:function(auto){ if(this.over||this.paused) return; this.paused=true;
    try{ this.physics.pause(); }catch(e){}
    try{ this.time.paused=true; }catch(e){}       // freeze the countdown timer + boss attack delayedCalls
    try{ this.tweens.pauseAll(); }catch(e){}
    try{ MUSIC.suspend(); }catch(e){}
    var self=this, isTouch=this.isTouch;
    this.pauseUI=[]; var mk=function(o){ self.hb(o); o.setDepth(3000); self.pauseUI.push(o); return o; };
    mk(this.add.rectangle(W/2,H/2,W,H,0x05040e,0.74));
    mk(this.add.text(W/2,H/2-26,'PAUSED',{fontFamily:'"Press Start 2P"',fontSize:'18px',color:'#3dff6e'}).setOrigin(.5));
    if(auto) mk(this.add.text(W/2,H/2+2,'you stepped away — your run is safe',{fontFamily:'VT323',fontSize:'14px',color:'#ffd23f'}).setOrigin(.5));
    mk(this.add.text(W/2,H/2+26,(isTouch?'TAP':'PRESS ANY KEY')+' TO RESUME  ▶',{fontFamily:'"Press Start 2P"',fontSize:'9px',color:'#ffffff'}).setOrigin(.5)); },
  resumeGame:function(){ if(!this.paused) return; this.paused=false;
    try{ this.physics.resume(); }catch(e){}
    try{ this.time.paused=false; }catch(e){}
    try{ this.tweens.resumeAll(); }catch(e){}
    try{ MUSIC.resume(); }catch(e){}
    if(this.pauseUI){ this.pauseUI.forEach(function(o){ try{o.destroy();}catch(e){} }); this.pauseUI=null; }
    this.lastInputAt=this.time.now; },   // reset idle timer so it doesn't instantly re-pause

  update:function(){
    if(this.over||this.paused) return;
    var self=this, p=this.player, b=p.body, now=this.time.now;
    // PAUSE hotspot (top-left ⏸): EDGE-triggered (only a fresh press pauses), so the resume-tap can't re-pause
    { var _pts=this.input.manager.pointers, _gw=this.scale.width, _gh=this.scale.height, _inZ=false;
      for(var _i=0;_i<_pts.length;_i++){ var _pp=_pts[_i]; if(_pp&&_pp.isDown){ var _fx=_pp.x/_gw,_fy=_pp.y/_gh; if(_fy<0.14&&_fx>0.16&&_fx<0.34){ _inZ=true; break; } } }
      if(_inZ&&!this._hotDown){ this._hotDown=true; this.pauseGame(false); return; } this._hotDown=_inZ; }
    // --- touch input: the DOM gutter D-pad (tablets/wide screens) OR on-screen pointer zones (phones) ---
    this.touch.left=this.touch.right=this.touch.jump=this.touch.down=this.touch.throwBtn=false;
    var padActive=(typeof window!=='undefined')&&window.__NQ_PAD_ACTIVE&&window.__NQ_PAD;
    if(padActive){
      this.touch.left=!!window.__NQ_PAD.left; this.touch.right=!!window.__NQ_PAD.right; this.touch.jump=!!window.__NQ_PAD.jump; this.touch.down=!!window.__NQ_PAD.down; this.touch.throwBtn=!!window.__NQ_PAD.throw;
    } else {
      // raw pointer screen-zones: left third=LEFT, next third=RIGHT, right half=JUMP, bottom-center=DUCK
      var gw=this.scale.width, gh=this.scale.height, pts=this.input.manager.pointers;
      for(var pi=0;pi<pts.length;pi++){ var ptr=pts[pi];
        if(!ptr||!ptr.isDown||!ptr.wasTouch) continue;            // wasTouch: desktop mouse never moves the player
        var fx=ptr.x/gw, fy=ptr.y/gh;
        if(fy>0.80 && fx>=0.40 && fx<0.60){ this.touch.down=true; continue; }      // bottom-center DUCK strip
        if(fx>=0.46){ this.touch.jump=true; }
        else if(fy>0.42){ if(fx<0.20) this.touch.left=true; else if(fx<0.42) this.touch.right=true; }
      }
    }
    // when the gutter pad is driving, hide the redundant on-screen < > affordances
    if(this.padAffordances){ var showAff=!padActive; for(var ai=0;ai<this.padAffordances.length;ai++) if(this.padAffordances[ai].visible!==showAff) this.padAffordances[ai].setVisible(showAff); }
    var left=this.cursors.left.isDown||this.keys.A.isDown||this.touch.left;
    var right=this.cursors.right.isDown||this.keys.D.isDown||this.touch.right;
    var jump=this.cursors.up.isDown||this.keys.W.isDown||this.keys.SPACE.isDown||this.touch.jump;
    var duck=this.cursors.down.isDown||this.keys.S.isDown||this.touch.down;
    // auto-pause after 10s of no movement/jump/duck input (player stepped away)
    if(left||right||jump||duck) this.lastInputAt=now; else if(this.lastInputAt&&now-this.lastInputAt>10000){ this.pauseGame(true); return; }
    // CROUCH: duck in place on the ground (jump cancels it) — shrinks the hitbox so fireballs / sniper bolts pass over.
    var crouching=duck && (b.blocked.down||b.touching.down) && !jump;
    if(crouching!==this.crouching){ this.crouching=crouching; var cw=this.player.width, ch=this.player.height;
      if(crouching) p.body.setSize(cw*0.60, ch*0.46).setOffset(cw*0.20, ch*0.52);
      else p.body.setSize(cw*0.60, ch*0.90).setOffset(cw*0.20, ch*0.08); }
    var rawJump=jump;   // raw button for edge detection — slotTick may zero `jump`, but prevJump must track the real press
    // Normie Casino: stand by the slot machine and press jump/up to "fire it in" (eats that jump)
    if(this.slots.length && this.slotTick(now, p, b, rawJump && !this.prevJump)) jump=false;
    // SOLANA MODE: auto-fire Solana symbols while the power is active (ends early on damage)
    if(now<this.solanaUntil && now>this.nextThrow){ this.fireSolana(); this.nextThrow=now+230; }
    // MANUAL THROW: F/X on desktop, the THROW button on touch — edge-triggered, uses counted ammo
    // (skipped while SOLANA MODE auto-fires so it doesn't burn discs on top of the free stream)
    var throwHeld=this.keys.F.isDown||this.keys.X.isDown||this.touch.throwBtn;
    if(throwHeld && !this.prevThrow && !(now<this.solanaUntil)) this.manualThrow();
    this.prevThrow=throwHeld;
    var fast=now<this.caffeineUntil||now<this.moonUntil;      // caffeine/moon = super speed
    // FUD gas = sluggish, but ONLY on the ground — never rob you of air speed mid-jump (that could
    // make a gap you already committed to unclearable → an unfair pit death).
    var slow=(now<this.slowUntil)&&!fast&&(b.blocked.down||b.touching.down);
    p.setMaxVelocity(fast?340:(slow?120:240),600);
    var accel=fast?1500:(slow?430:900);
    if(crouching){ p.setAccelerationX(0); p.setDragX(2600); }   // duck in place (stationary)
    else if(left&&!right){ if(b.velocity.x>0) accel*=2; p.setAccelerationX(-accel); p.setFlipX(true); }
    else if(right&&!left){ if(b.velocity.x<0) accel*=2; p.setAccelerationX(accel); p.setFlipX(false); }
    else { p.setAccelerationX(0); p.setDragX(1600); }

    var onGround=b.blocked.down||b.touching.down;
    if(onGround){ this.lastGround=now; this.jumpsLeft=2; this.isJumping=false; }
    else if(now-this.lastGround>110 && this.jumpsLeft>1){ this.jumpsLeft=1; }
    if(jump&&!this.prevJump) this.jumpBufferAt=now; this.prevJump=rawJump;
    if(now-this.jumpBufferAt<130 && this.jumpsLeft>0){
      p.setVelocityY(now<this.bullUntil?-540:-430); this.jumpsLeft--; this.isJumping=true; this.jumpBufferAt=-9999; SFX.jump();   // bull market = mega jump
    }
    if(this.isJumping&&!jump&&b.velocity.y<-120) p.setVelocityY(-120);
    if(b.velocity.y>=0) this.isJumping=false;

    // MEGA WHALE RIDE: the whale carries Normie aloft — gravity off, he flies at a steer-height
    // (JUMP/UP raises it, DUCK/DOWN lowers it), with a gentle sea-swell bob. Invincibility + crush
    // ride on whaleUntil (set together). On expiry: gravity back + brief i-frames so he lands safe.
    if(now<this.megaWhaleUntil){
      if(!this._whaleFly){ b.setAllowGravity(false); this._whaleFly=true; }
      if(jump) this.whaleRideY-=5; else if(duck) this.whaleRideY+=5;
      this.whaleRideY=Phaser.Math.Clamp(this.whaleRideY, 40, GY-14);
      p.setVelocityY(Phaser.Math.Clamp((this.whaleRideY-p.y)*6 + Math.sin(now/260)*22, -300, 300));
    } else if(this._whaleFly){ b.setAllowGravity(true); this._whaleFly=false; p.invuln=true; this.time.delayedCall(900,function(){ p.invuln=false; }); }

    // power-up tint + "large and in charge" grow + aura
    var mw=now<this.megaWhaleUntil;   // MEGA WHALE ride: Normie rides a whale (normal size, no blue tint) — distinct from WHALE MODE
    var omega=now<this.omegaUntil;   // GIGA CHAD transform: Normie becomes the chad (internal key stays 'omegachad')
    var whale=now<this.whaleUntil && !mw, cold=now<this.coldUntil;   // suppress the huge-blue-Normie look during the whale RIDE
    var powCol=0x66ccff, anyPower=true;
    if(mw){ p.clearTint(); powCol=0x2f7fff; }   // MEGA WHALE: keep Normie's colours; he sits ON the whale
    else if(whale){ p.setTint(0x2f7fff); powCol=0x2f7fff; }   // WHALE MODE: deep-blue, huge
    else if(omega){ p.clearTint(); powCol=0xffa020; }   // keep his real colours; fiery orange aura
    else if(now<this.moonUntil){ p.setTint([0xffd23f,0x3dff6e,0xff3860,0x66ccff][Math.floor(now/90)%4]); powCol=0xffd23f; }
    else if(cold){ p.setTint(0x9fe8ff); powCol=0x9fe8ff; }   // COLD WALLET: icy shield
    else if(now<this.shieldUntil){ p.setTint(0x88ddff); powCol=0x66ddff; }
    else if(now<this.bullUntil){ p.setTint(0x99ff88); powCol=0x3dff6e; }
    else if(now<this.caffeineUntil){ p.setTint(0xfff2a0); powCol=0xffffff; }
    else { p.clearTint(); anyPower=false; }
    // "large and in charge": grow toward the target scale every frame (deterministic ease). Whale = biggest.
    var pt=whale?2.05:(anyPower?1.55:1); this.pscale.v+=(pt-this.pscale.v)*0.16;
    if(anyPower&&!this._powered) this.burst(p.x,p.y-8,powCol,18);   // pop on power-up
    this._powered=anyPower;
    if(this.playerGlow){
      if(!anyPower && this.geekShield){ this.playerGlow.color=0x2ee6c0; this.playerGlow.outerStrength=3+Math.sin(now/160); }   // passive audit-shield glow
      else { this.playerGlow.color=powCol; this.playerGlow.outerStrength = anyPower ? (5+Math.sin(now/120)*2) : Math.max(0,this.playerGlow.outerStrength-0.4); }
    }

    // active power-up indicator: label + shrinking timer bar
    var pw=null;
    if(mw) pw=['MEGA WHALE',this.megaWhaleUntil,PREMIUM?13000:10000,0x2f7fff];
    else if(now<this.whaleUntil) pw=['WHALE',this.whaleUntil,WHALE_MS,0x2f7fff];
    else if(now<this.coldUntil) pw=['COLD',this.coldUntil,COLD_MS,0x9fe8ff];
    else if(now<this.omegaUntil) pw=['GIGA',this.omegaUntil,this.levelIdx>=18?9000:8000,0xffa020];
    else if(now<this.solanaUntil) pw=['SOLANA',this.solanaUntil,9000,0x14f195];
    else if(now<this.moonUntil) pw=['MOON',this.moonUntil,9000,0xffd23f];
    else if(now<this.shieldUntil) pw=['DIAMOND',this.shieldUntil,9000,0x66ddff];
    else if(now<this.bullUntil) pw=['BULL',this.bullUntil,11000,0x3dff6e];
    else if(now<this.caffeineUntil) pw=['CAFFEINE',this.caffeineUntil,11000,0xfff2a0];
    if(pw){ var fr=Phaser.Math.Clamp((pw[1]-now)/pw[2],0,1); this.powerBar.width=44*fr; this.powerBar.fillColor=pw[3]; this.powerBar.setVisible(true); this.powerBarBg.setVisible(true); this.powerLabel.setText(pw[0]).setColor('#'+('000000'+pw[3].toString(16)).slice(-6)).setVisible(true); }
    else { this.powerBar.setVisible(false); this.powerBarBg.setVisible(false); this.powerLabel.setVisible(false); }

    // --- frame animation: swap Normie's pose sprite by state (idle / run cycle / jump) ---
    // all four frames share one canvas size, so setTexture keeps scale + body constant.
    // Normie ALWAYS stays Normie — even in GIGA CHAD mode (the chad appears as a shadow behind him).
    var animKey = !onGround ? 'njump'
                : (Math.abs(b.velocity.x)>25 ? ((Math.floor(now/(fast?70:100))%2) ? 'nrun2':'nrun1')
                : 'normie');
    if(p.texture.key!==animKey) p.setTexture(animKey);

    // --- procedural animation: bob when walking, lean+stretch in air, breathe when idle ---
    var bs=this.baseScale*this.pscale.v;
    if(mw){
      p.setRotation(Math.sin(now/260)*0.05); p.setScale(bs);   // sit upright on the whale, gentle sea-swell sway
    } else if(this.crouching){
      p.setRotation(0); p.setScale(bs*1.14, bs*0.60);   // squashed duck pose
    } else if(!onGround){
      p.setRotation(Phaser.Math.Clamp(b.velocity.x/2600,-0.12,0.12));
      var sy=b.velocity.y<0?1.10:0.93; p.setScale(bs*(2-sy), bs*sy);
    } else if(Math.abs(b.velocity.x)>25){
      var cyc=now/(fast?52:82); p.setRotation(Math.sin(cyc)*0.05);
      var pl=Math.abs(Math.sin(cyc)); p.setScale(bs*(1-pl*0.02), bs*(1+pl*0.035));
    } else {
      p.setRotation(0); var br=Math.sin(now/500)*0.02; p.setScale(bs*(1-br), bs*(1+br));
    }

    // GIGA CHAD: loom a big shadowy chad figure behind Normie (channeled-power silhouette)
    if(this.gigaShadow){
      if(omega){
        this.gigaShadow.setVisible(true).setPosition(p.x, p.y-3).setFlipX(p.flipX);
        this.gigaShadow.setScale(this.gigaShadowScale*(1+Math.sin(now/150)*0.05));
        this.gigaShadow.setAlpha(0.30+0.20*Math.abs(Math.sin(now/210)));
      } else if(this.gigaShadow.visible){ this.gigaShadow.setVisible(false); }
    }
    // MEGA WHALE: the big blue whale under Normie's hips — he straddles & flies it (whale faces his heading)
    if(this.whaleRide){
      if(mw){ var ww=Math.max(58,p.displayWidth*2.4), wh=ww*0.55;
        this.whaleRide.setVisible(true).setDisplaySize(ww,wh).setFlipX(p.flipX).setRotation(Math.sin(now/260)*0.05)
          .setPosition(p.x, p.body.center.y + p.displayHeight*0.34 + Math.sin(now/260)*3);
      } else if(this.whaleRide.visible){ this.whaleRide.setVisible(false); }
    }

    // moving platforms + rider carry
    this.movers.children.iterate(function(m){
      if(!m) return;
      if(m.axis==='x'){ if(m.x<m.homeX-m.range)m.dir=1; if(m.x>m.homeX+m.range)m.dir=-1; m.setVelocityX(m.dir*m.speed); m.setVelocityY(0); }
      else { if(m.y<m.homeY-m.range)m.dir=1; if(m.y>m.homeY+m.range)m.dir=-1; m.setVelocityY(m.dir*m.speed); m.setVelocityX(0); }
      var onIt=(b.blocked.down||b.touching.down) && p.body.bottom<=m.body.top+8 && p.body.bottom>=m.body.top-10 && p.body.right>m.body.left+2 && p.body.left<m.body.right-2;
      if(onIt && m.axis==='x') p.x+=(m.x-m.prevX);
      m.prevX=m.x; m.prevY=m.y;
    });

    // enemies
    var frozen = now<this.frozenUntil;   // COLD WALLET froze the board
    this.enemies.children.iterate(function(e){
      if(!e||!e.active) return;
      if(frozen){ e.setVelocity(0,0); e.setTint(0x9fe8ff); return; }   // iced — no move, no fire
      if(e.tintTopLeft===0x9fe8ff){ if(e.kind==='sniper') e.setTint(0xff6b6b); else e.clearTint(); }   // thaw (restore sniper red)
      if(e.kind==='ghost'){
        if(e.x<e.homeX-e.range) e.dir=1; if(e.x>e.homeX+e.range) e.dir=-1;
        e.setVelocityX(e.dir*e.baseSpeed);
        var target=e.homeY+Math.sin(now/450+e.bob)*14; e.setVelocityY((target-e.y)*5);
        e.setFlipX(e.dir>0); return;
      }
      if(e.x<e.homeX-e.range) e.dir=1; if(e.x>e.homeX+e.range) e.dir=-1;
      if(e.body.blocked.left) e.dir=1; if(e.body.blocked.right) e.dir=-1;
      if(e.body.blocked.down){
        var ahead=e.x+e.dir*(e.body.width*0.5+4);
        if(self.overPit(ahead)) e.dir=-e.dir;
      }
      if(e.kind==='sniper'){ e.setVelocityX(0); e.setFlipX(p.x<e.x); e.setRotation(0); }   // ranged TURRET: holds position + aims at the player (no frantic pacing)
      else { e.setVelocityX(e.dir*e.baseSpeed); e.setFlipX(e.dir>0); e.setRotation(Math.sin((now+e.homeX)/110)*0.06); }
      // Sniper Bot: fire an aimed bolt when the player is roughly in range
      if(e.kind==='sniper' && now>e.nextFire && Math.abs(e.x-p.x)<330){ self.sniperFire(e,p); e.nextFire=now+1900; }
      // FUDster: cough a slow-gas puff on a cadence
      if(e.kind==='fudster' && now>e.nextGas){ self.emitGas(e); e.nextGas=now+2200; }
    });

    // Rug King intro grace ends → he wakes up and the fight begins
    if(this.rugIntro && this.rugking && now>this.rugGraceUntil){ this.rugIntro=false; this.rugking.invuln=false; this.flash('FIGHT!','#3dff6e'); }
    // boss charges toward the player (Rug King)
    if(this.boss && this.rugking && this.rugking.active && !this.rugking.invuln){
      var kb=this.rugking; kb.dir=(p.x<kb.x)?-1:1; kb.setVelocityX(kb.dir*76); kb.setFlipX(kb.dir>0); kb.setRotation(Math.sin(now/120)*0.05);
    }
    // Scammy KOL: shills fake tokens at range + taunts (in addition to the charge above)
    if(this.bossStarted && this.def.bossType==='kol' && !this.rugIntro) this.kolTick(now,p);
    if(this.bossStarted && this.def.bossType==='ceo' && !this.rugIntro) this.ceoTick(now,p);
    if(this.bossStarted && this.def.bossType==='wyrm' && !this.rugIntro) this.wyrmTick(now,p);
    if(this.bossStarted && this.def.bossType==='golem' && !this.rugIntro) this.golemTick(now,p);
    if(this.bossStarted && this.def.bossType==='reaper' && !this.rugIntro) this.reaperTick(now,p);
    if(this.bossStarted && this.def.bossType==='liquidator' && !this.rugIntro) this.liquidatorTick(now,p);
    if(this.bossStarted && this.def.bossType==='troll' && !this.rugIntro) this.trollTick(now,p);
    // WORMHOLE boss: burrow / erupt state machine
    if(this.bossStarted && this.def.bossType==='wormhole') this.wormTick(now);
    // mini-worm hazards (World 2)
    this.miniwormTick(now);
    // Pump-&-Dump platforms (Phase 2)
    this.pumpDumpTick(now,p,b);
    this.bridgePlankTick(now,p,b);
    this.depegTick(now);
    this.yieldTick(now,p,b);
    this.cascadeTick(now,p);
    this.shockTick(now);
    // "Wen Lambo" NPCs
    this.npcTick(now);
    // Casino folk (Drink/Show Ladies) + Lil Normie child support
    this.casinoTick(now);
    this.childSupportTick(now);

    // healing airdrops drop in only while you're hurt (lives<3); hide again at full health
    var hurt=this.lives<3;
    this.airdrops.children.iterate(function(a){
      if(!a||a.consumed) return;
      if(hurt&&!a.shown) self.revealAirdrop(a);
      else if(!hurt&&a.shown) self.hideAirdrop(a);
    });

    // pit death
    if(p.y>H+80){
      this.loseLife('FELL IN A PIT'); if(this.over) return;
      p.setVelocity(0,0); p.setPosition(Math.max(this.spawn.x,p.x-260),H-100);
      p.invuln=true; this.tweens.add({targets:p,alpha:.3,duration:90,yoyo:true,repeat:6,onComplete:function(){ p.alpha=1; p.invuln=false; }});
      this.cameras.main.flash(150,80,0,0);
    }
  }
});

/* ---------- Over ---------- */
var Over=new Phaser.Class({ Extends:Phaser.Scene,
  initialize:function(){ Phaser.Scene.call(this,{key:'Over'}); },
  init:function(d){ this.finalScore=d.score||0; this.reason=d.reason||''; this.level=d.level||''; this.cont=d.cont||0; this.contScore=d.contScore||0; },
  create:function(){
    this.cameras.main.setZoom(2).centerOn(W/2,H/2); this.cameras.main.setBackgroundColor(C.ink);
    this.add.text(W/2,48,this.reason,{fontFamily:'"Press Start 2P"',fontSize:'15px',color:'#ff3860'}).setOrigin(.5);
    this.add.text(W/2,80,'reached world '+this.level,{fontFamily:'VT323',fontSize:'18px',color:'#8f89b0'}).setOrigin(.5);
    this.add.text(W/2,118,'SCORE',{fontFamily:'"Press Start 2P"',fontSize:'11px',color:'#8f89b0'}).setOrigin(.5);
    this.add.text(W/2,150,String(this.finalScore),{fontFamily:'"Press Start 2P"',fontSize:'30px',color:'#ffd23f'}).setOrigin(.5).setShadow(3,3,'#7a5a00',0,true,true);
    // Per-world checkpoint continue takes priority over the leaderboard/free-preview copy.
    var CP_LABEL={3:'WORLD 2\ncontinue from the Sand Lands',6:'WORLD 3\ncontinue from the Skyline',9:'WORLD 4\ncontinue from the Exchange',12:'WORLD 5\ncontinue from the Bridge',15:'WORLD 6\ncontinue from the Depeg',18:'WORLD 7\ncontinue from the Yield Farm',21:'WORLD 8\ncontinue from the Bear Market'};
    this.add.text(W/2,198, this.cont>0 ? ('★ CHECKPOINT: '+(CP_LABEL[this.cont]||('LEVEL '+(this.cont+1)))) : (BURN_GATE ? 'score posts to the leaderboard —\ntop 10 split the pool' : 'free preview · all 8 Worlds\ngood luck out there'),{fontFamily:'VT323',fontSize:'19px',color:this.cont>0?'#3dff6e':'#8f89b0',align:'center'}).setOrigin(.5);
    var p=this.add.text(W/2,244, this.cont>0 ? 'PRESS TO CONTINUE →' : (BURN_GATE ? 'PRESS TO BURN AGAIN' : 'PRESS TO PLAY AGAIN'),{fontFamily:'"Press Start 2P"',fontSize:'11px',color:'#3dff6e'}).setOrigin(.5);
    this.tweens.add({targets:p,alpha:.25,duration:600,yoyo:true,repeat:-1});
    // Continue from the World-2 checkpoint if premium banked one; else free-preview restart, or the burn Gate.
    var self=this; this.started=false; var go=function(){ if(self.started) return; self.started=true;
      if(self.cont>0){ if(typeof BRIEFINGS!=='undefined'&&BRIEFINGS[self.cont]) self.scene.start('Briefing',{next:self.cont,score:self.contScore});   // show the world briefing (control reminder) on continue
                        else self.scene.start('Game',{level:self.cont,score:self.contScore,lives:3}); }
      else if(BURN_GATE) self.scene.start('Gate');
      else self.scene.start('Game',{level:0,score:0,lives:3}); };
    this.time.delayedCall(500,function(){ self.input.once('pointerdown',go); self.input.keyboard.once('keydown',go); });
  }
});

/* ---------- Win ---------- */
var Win=new Phaser.Class({ Extends:Phaser.Scene,
  initialize:function(){ Phaser.Scene.call(this,{key:'Win'}); },
  init:function(d){ d=d||{}; this.finalScore=d.score||0; this.boss=d.boss||'wormhole'; this.casino=d.casino||0; },
  create:function(){
    SFX.win();
    // victory tableau keyed to the FINAL boss you actually beat, slumped/defeated + Normie triumphant
    var V = this.boss==='liquidator' ? {img:'greatbear', title:'THE GREAT BEAR, SLAIN!', color:'#ff5030', tint:0, scale:98, bg:0x1a0808}
          : this.boss==='reaper'   ? {img:'reaper',     title:'THE YIELD REAPER, HARVESTED!', color:'#2ee66a', tint:0, scale:94, bg:0x0e2414}
          : this.boss==='golem'    ? {img:'golem',      title:'THE HASH LORD, CRACKED!', color:'#ffd23f', tint:0, scale:92, bg:0x141810}
          : this.boss==='wyrm'     ? {img:'wyrm',       title:'THE VAULT WYRM, SLAIN!',  color:'#66ff88', tint:0, scale:96, bg:0x0e2416}
          : this.boss==='ceo'      ? {img:'ceoboss',    title:'THE CUSTODIAN, DELISTED!', color:'#8fe4ff', tint:0x9fd6ee, scale:76, bg:0x0a1c2a}
          : this.boss==='kol'      ? {img:'scammykol',  title:'THE SCAMMY KOL EXPOSED!', color:'#c99bff', tint:0x9a86c8, scale:72, bg:0x140a24}
          : this.boss==='wormhole' ? {img:'wormhole',   title:'THE WORMHOLE IS SEALED!', color:'#66ddff', tint:0x88aacc, scale:82, bg:0x1a1030}
          :                          {img:'rugkingdown',title:'YOU BEAT THE RUG KING!',  color:'#3dff6e', tint:0,        scale:58, bg:0x102a1a};
    this.cameras.main.setZoom(2).centerOn(W/2,H/2); this.cameras.main.setBackgroundColor(V.bg);
    var bimg=this.add.image(W/2+52,108,V.img); bimg.setScale(V.scale/bimg.height); bimg.setAngle(14); bimg.setAlpha(0.92);
    if(V.tint) bimg.setTint(V.tint);
    var hero=this.add.image(W/2-40,94,'normie'); hero.setScale(80/hero.height);
    this.tweens.add({targets:hero,y:89,duration:700,yoyo:true,repeat:-1,ease:'Sine.inOut'});
    if(this.renderer.type===Phaser.WEBGL){ try{ hero.postFX.addGlow(0xffd23f,1.2,0,false,0.1,16); }catch(e){} }
    this.add.text(W/2,42,V.title,{fontFamily:'"Press Start 2P"',fontSize:'12px',color:V.color,align:'center',wordWrap:{width:W-24}}).setOrigin(.5);
    this.add.text(W/2,146,'FINAL SCORE',{fontFamily:'"Press Start 2P"',fontSize:'10px',color:'#8f89b0'}).setOrigin(.5);
    this.add.text(W/2,174,String(this.finalScore),{fontFamily:'"Press Start 2P"',fontSize:'30px',color:'#ffd23f'}).setOrigin(.5).setShadow(3,3,'#7a5a00',0,true,true);
    if(this.casino>0) this.add.text(W/2,202,'🎰 CASINO WINNINGS: '+this.casino,{fontFamily:'VT323',fontSize:'18px',color:'#ff8adf'}).setOrigin(.5);
    var nw=Math.ceil(LEVELS.filter(function(l){return !l.hidden;}).length/3);   // 8 real worlds (exclude hidden bonus levels)
    var wtext = nw<=1?'WORLD 1 CLEARED':(nw===2?'WORLDS 1 & 2 CLEARED':'ALL '+nw+' WORLDS CLEARED');
    this.add.text(W/2,this.casino>0?222:210,wtext,{fontFamily:'VT323',fontSize:'18px',color:'#8f89b0'}).setOrigin(.5);
    var p=this.add.text(W/2,246,'PRESS TO PLAY AGAIN',{fontFamily:'"Press Start 2P"',fontSize:'11px',color:'#3dff6e'}).setOrigin(.5);
    this.tweens.add({targets:p,alpha:.25,duration:600,yoyo:true,repeat:-1});
    // Free preview → straight back into the game; only the live burn build routes through the Gate.
    var self=this; this.started=false; var go=function(){ if(self.started) return; self.started=true; if(BURN_GATE) self.scene.start('Gate'); else self.scene.start('Game',{level:0,score:0,lives:3}); };
    this.time.delayedCall(500,function(){ self.input.once('pointerdown',go); self.input.keyboard.once('keydown',go); });
  }
});

/* ---------- Interlude: World 1 -> World 2 cutscene (Rug King falls -> off to the Sand Lands) ---------- */
var Interlude=new Phaser.Class({ Extends:Phaser.Scene,
  initialize:function(){ Phaser.Scene.call(this,{key:'Interlude'}); },
  init:function(d){ d=d||{}; this.nextLevel=d.next||0; this.score=d.score||0; },
  create:function(){
    var self=this, cx=W/2; this.cameras.main.setZoom(2).centerOn(W/2,H/2);
    this.t0=0; this.phase=0; this.done=false; this.duneOff=0;   // t0 captured on the first update tick
    SFX.clear();
    // --- Phase 1: victory tableau (defeated Rug King + triumphant Normie) ---
    this.p1=this.add.container(0,0);
    this.p1.add(this.add.rectangle(cx,H/2,W,H,0x102a1a));
    var king=this.add.image(cx+46,150,'rugkingdown'); king.setScale(58/king.height); king.setAngle(-6); this.p1.add(king);
    var hero=this.add.image(cx-40,132,'normie'); hero.setScale(82/hero.height); this.p1.add(hero);
    this.tweens.add({targets:hero,y:127,duration:700,yoyo:true,repeat:-1,ease:'Sine.inOut'});
    if(this.renderer.type===Phaser.WEBGL){ try{ hero.postFX.addGlow(0xffd23f,1.2,0,false,0.1,16); }catch(e){} }
    this.p1.add(this.add.text(cx,58,'THE RUG KING FALLS!',{fontFamily:'"Press Start 2P"',fontSize:'13px',color:'#3dff6e',align:'center'}).setOrigin(.5));
    this.p1.add(this.add.text(cx,84,'WORLD 1 CLEARED',{fontFamily:'"Press Start 2P"',fontSize:'9px',color:'#ffd23f'}).setOrigin(.5));
    // --- Phase 2: traveling to the Sand Lands (hidden until phase 1 ends) ---
    this.p2=this.add.container(0,0).setVisible(false);
    var g=this.add.graphics(); g.fillGradientStyle(0xe0913a,0xe0913a,0x8a4a1e,0x8a4a1e,1); g.fillRect(0,0,W,H); this.p2.add(g);
    this.p2.add(this.add.circle(W-64,52,24,0xffe08a).setAlpha(.95));
    this.duneG=this.add.graphics(); this.p2.add(this.duneG);
    this.scenery=[]; for(var i=0;i<3;i++){ var c=this.add.image(80+i*170, H-40, 'cactus'); c.setScale(22/c.height); this.p2.add(c); this.scenery.push(c); }
    this.runner=this.add.image(cx-30, H-46, 'nrun1'); this.runner.setScale(40/this.runner.height); this.p2.add(this.runner);
    if(this.renderer.type===Phaser.WEBGL){ try{ this.runner.postFX.addGlow(0x66ccff,1,0,false,0.1,12); }catch(e){} }
    this.p2.add(this.add.text(cx,52,'OFF TO THE SAND LANDS...',{fontFamily:'"Press Start 2P"',fontSize:'11px',color:'#2a1408',align:'center'}).setOrigin(.5));
    this.drawDunes();
    // tap to skip forward
    this.input.on('pointerdown',function(){ if(self.phase===0){ self.t0=self.time.now-2800; } else { self.next2(); } });
    this.input.keyboard.on('keydown',function(){ if(self.phase===0){ self.t0=self.time.now-2800; } else { self.next2(); } });
  },
  next2:function(){   // World-2 intro briefing gates the transition when one exists for this level
    if(this.done) return; this.done=true;
    if(typeof BRIEFINGS!=='undefined' && BRIEFINGS[this.nextLevel]) this.scene.start('Briefing',{next:this.nextLevel,score:this.score});
    else this.scene.start('Game',{level:this.nextLevel,score:this.score,lives:3});
  },
  drawDunes:function(){ var d=this.duneG; d.clear();
    d.fillStyle(0x5c3212,1); for(var i=-1;i<5;i++){ d.fillCircle(i*150 - (this.duneOff%150) + 75, H-14, 66); }
    d.fillStyle(0x8a5a2b,1); d.fillRect(0,H-24,W,24); d.fillStyle(0x6e4420,1); d.fillRect(0,H-6,W,6);
  },
  update:function(){
    if(!this.t0){ this.t0=this.time.now; return; }   // capture start on the first real tick
    var t=this.time.now-this.t0;
    if(this.phase===1){
      var k=(Math.floor(this.time.now/110)%2)?'nrun2':'nrun1'; if(this.runner.texture.key!==k) this.runner.setTexture(k).setScale(40/this.runner.height);
      this.runner.y=(H-46)+Math.sin(this.time.now/90)*2;
      this.duneOff+=1.7; this.drawDunes();
      var self=this; this.scenery.forEach(function(s){ s.x-=1.7; if(s.x<-16) s.x+=W+32; });
    }
    if(this.phase===0 && t>2800){ this.phase=1; this.p1.setVisible(false); this.p2.setVisible(true); }
    if(t>6300 && !this.done){ this.next2(); }
  }
});

// Between-world BRIEFING cards: introduce new powers + what to watch for. Keyed by the level
// you're ABOUT to enter. Reusable — add an entry (e.g. 6 for World 3) and the Interlude/flow
// will route through it automatically. tex values must be loaded texture keys.
var BRIEFINGS = {
  3: { title:'WORLD 2 — THE SAND LANDS',
       powers:[
         {tex:'supergeek', name:'SUPER GEEK', desc:'Audit on — blocks the next hit. Grab him near danger.'},
         {tex:'omegachad', name:'GIGA CHAD', desc:'Bulk up & plow through enemies for 10s. Save it for a crowd.'}
       ],
       threats:[
         {tex:'fudster', name:'FUDSTER', desc:"sprays slow-gas — don't linger in it"},
         {tex:'bitmaxi', name:'BITCOIN MAXI', desc:'steals your coins — stomp him'}
       ],
       tip:'New powers are your edge — it gets tougher from here. Use them.' },
  6: { title:'WORLD 3 — THE SKYLINE',
       powers:[
         {tex:'omegachad', name:'GIGA CHAD', desc:'Your best friend up here — plow through the crowds.'},
         {tex:'supergeek', name:'SUPER GEEK', desc:'Audit shield still blocks the next hit.'}
       ],
       threats:[
         {tex:'bot', name:'SNIPER BOTS', desc:'they snipe from range — keep moving'},
         {tex:'scammykol', name:'THE SCAMMY KOL', desc:'the World 3 boss shills at the top'}
       ],
       tip:'Crypto Twitter is brutal. Reach the top & stomp the Scammy KOL x3.' },
  9: { title:'WORLD 4 — THE EXCHANGE',
       powers:[
         {tex:'omegachad', name:'GIGA CHAD', desc:'Plow through the crowd — the vault is packed.'},
         {tex:'bull', name:'BULL MARKET', desc:'Mega-jump — the walls here are TALL. Use it to clear them.'}
       ],
       threats:[
         {tex:'bot', name:'SNIPER BOTS', desc:'everywhere now — keep moving'},
         {tex:'ceoboss', name:'THE CUSTODIAN', desc:'the World 4 boss; freezes you at range'}
       ],
       tip:'Obstacles are bigger now — stomp the Custodian x3 to free the funds.' },
  12: { title:'WORLD 5 — THE BRIDGE',
       powers:[
         {tex:'solana', name:'SOLANA MODE', desc:'Full-send auto-fire — clears a path. Grab it!'},
         {tex:'omegachad', name:'GIGA CHAD', desc:'Plow through the pests on the span.'}
       ],
       threats:[
         {tex:'bitmaxi', name:'BITCOIN MAXI', desc:'steals your coins — stomp him'},
         {tex:'wyrm', name:'THE VAULT WYRM', desc:'guards the far side of the bridge'}
       ],
       tip:'CROSS-CHAIN BRIDGE: the wooden planks get exploited & collapse a beat after you step on them — KEEP MOVING, never stand still over the void.' },
  15: { title:'WORLD 6 — THE DEPEG',
       powers:[
         {tex:'bull', name:'BULL MARKET', desc:'Mega-jump across the breaking peg.'},
         {tex:'supergeek', name:'SUPER GEEK', desc:'Audit shield — blocks the next hit.'}
       ],
       threats:[
         {tex:'bot', name:'ARB BOTS', desc:'bots & snipers everywhere — keep moving'},
         {tex:'golem', name:'THE HASH LORD', desc:'the World 6 boss; hurls blocks'}
       ],
       tip:'DEPEG: the mint-green "stable" ground BREAKS on a rhythm — it flashes, then drops into the void for a moment. Time your crossings; never be standing on the peg when it snaps.' },
  18: { title:'WORLD 7 — THE YIELD FARM',
       powers:[
         {tex:'omegachad', name:'GIGA CHAD', desc:'Plow through the swarm — the farm is crowded.'},
         {tex:'bull', name:'BULL MARKET', desc:'Mega jump — clear the wide gaps and reach the high coins.'}
       ],
       threats:[
         {tex:'bot', name:'ARB BOTS', desc:'snipers & bots everywhere — keep moving'},
         {tex:'reaper', name:'THE YIELD REAPER', desc:'the World 7 boss; reaps scythe-shots'}
       ],
       tip:'YIELD FARM: the green LIFT platforms COMPOUND upward the longer you stand on them — ride the rise to reach the high coins, then hop off before you want to come back down. Reach the top & stomp the Yield Reaper x3.' },
  21: { title:'WORLD 8 — THE BEAR MARKET',
       powers:[
         {tex:'whale', name:'WHALE MODE', desc:'NEW! Huge, invincible, shock-stomps that clear enemies.'},
         {tex:'coldwallet', name:'COLD WALLET', desc:'NEW! Total immunity + FREEZES the whole board.'}
       ],
       threats:[
         {tex:'greatbear', name:'THE GREAT BEAR', desc:'the TRUE FINAL boss — stomp him x5'},
         {tex:'bot', name:'THE WHOLE MARKET', desc:'bots, snipers & maxis — relentless'}
       ],
       tip:'THE BEAR MARKET: the final gauntlet. Survive THE DIP & CAPITULATION, grab WHALE MODE & COLD WALLET, then stomp THE GREAT BEAR x5.' }
};

/* ---------- Controls: opening HOW-TO-PLAY screen shown before World 1 ---------- */
var Controls=new Phaser.Class({ Extends:Phaser.Scene,
  initialize:function(){ Phaser.Scene.call(this,{key:'Controls'}); },
  init:function(d){ d=d||{}; this.nextLevel=d.next!=null?d.next:0; this.score=d.score||0; },
  create:function(){
    var self=this, cx=W/2; this.done=false; this.t0=0;
    this.cameras.main.setZoom(2).centerOn(W/2,H/2);
    var g=this.add.graphics(); g.fillStyle(0x0d0b1e,1); g.fillRect(0,0,W,H);
    g.fillStyle(0x1a1533,1); g.fillRect(0,0,W,28);
    g.lineStyle(2,0x3dff6e,1); g.strokeRect(6,32,W-12,H-56);
    this.add.text(cx,14,'HOW TO PLAY',{fontFamily:'"Press Start 2P"',fontSize:'13px',color:'#ffd23f'}).setOrigin(.5);
    var isTouch=(this.sys.game.device.input.touch||(navigator.maxTouchPoints>0)||('ontouchstart' in window));
    var colL=Math.round(W*0.27), colR=Math.round(W*0.73);
    g.lineStyle(1,0x33305a,1); g.beginPath(); g.moveTo(cx,40); g.lineTo(cx,150); g.strokePath();   // column divider
    // MOBILE column (highlighted green if this device is touch)
    this.add.text(colL,40,'MOBILE',{fontFamily:'"Press Start 2P"',fontSize:'9px',color:isTouch?'#3dff6e':'#8f89b0'}).setOrigin(.5);
    this.add.text(colL,56,'MOVE:  the  < >  buttons\n(gutters on tablets,\nor tap-move on phones)\nJUMP:  the JUMP button\nDUCK:  the DUCK button\n(or tap bottom-centre)',
      {fontFamily:'VT323',fontSize:'13px',color:'#e6e2f5',align:'center',lineSpacing:2}).setOrigin(.5,0);
    // KEYBOARD column (highlighted green if this device is not touch)
    this.add.text(colR,40,'KEYBOARD',{fontFamily:'"Press Start 2P"',fontSize:'9px',color:isTouch?'#8f89b0':'#3dff6e'}).setOrigin(.5);
    this.add.text(colR,56,'MOVE:  arrows / A D\nJUMP:  UP / W / SPACE\nDUCK:  DOWN / S\nSTOMP enemies by\nlanding on them',
      {fontFamily:'VT323',fontSize:'13px',color:'#e6e2f5',align:'center',lineSpacing:2}).setOrigin(.5,0);
    // the goal / core rules (full width)
    this.add.text(cx,150,'THE GOAL',{fontFamily:'"Press Start 2P"',fontSize:'8px',color:'#ffd23f'}).setOrigin(.5);
    this.add.text(cx,164,'JUMP on enemies to STOMP them  ·  grab the KEY, then reach the DOOR\ngrab glowing POWER-UPS  ·  dodge spikes & hazards',
      {fontFamily:'VT323',fontSize:'14px',color:'#c9c4e0',align:'center',lineSpacing:3,wordWrap:{width:W-44}}).setOrigin(.5,0);
    this.add.text(cx,202,'⚠ HONEYPOTS look like treasure but DRAIN the coins you earned that level (your total stays safe)',
      {fontFamily:'VT323',fontSize:'14px',color:'#ff9500',align:'center',lineSpacing:2,wordWrap:{width:W-40}}).setOrigin(.5,0);
    this.cont=this.add.text(cx,H-11,(isTouch?'TAP':'PRESS')+' TO START  ▶',{fontFamily:'"Press Start 2P"',fontSize:'10px',color:'#3dff6e'}).setOrigin(.5);
    this.input.on('pointerdown',function(){ self.go(); });
    this.input.keyboard.on('keydown',function(){ self.go(); });
  },
  go:function(){ if(this.done) return; this.done=true; SFX.power(); this.scene.start('Game',{level:this.nextLevel,score:this.score,lives:3}); },
  update:function(){ if(!this.t0){ this.t0=this.time.now; return; }
    if(this.cont) this.cont.setAlpha(0.4+0.6*Math.abs(Math.sin(this.time.now/300)));
    if(this.time.now-this.t0>20000) this.go(); }   // safety auto-advance
});

/* ---------- Briefing: reusable "new powers / watch for" intel card between worlds ---------- */
var Briefing=new Phaser.Class({ Extends:Phaser.Scene,
  initialize:function(){ Phaser.Scene.call(this,{key:'Briefing'}); },
  init:function(d){ d=d||{}; this.nextLevel=d.next||0; this.score=d.score||0;
    this.cfg=BRIEFINGS[this.nextLevel]||{title:'GET READY',powers:[],threats:[],tip:''}; },
  create:function(){
    var self=this, cx=W/2; this.cameras.main.setZoom(2).centerOn(W/2,H/2);
    this.t0=0; this.done=false;
    var g=this.add.graphics(); g.fillStyle(0x0d0b1e,1); g.fillRect(0,0,W,H);
    g.fillStyle(0x1a1533,1); g.fillRect(0,0,W,34); g.fillRect(0,H-26,W,26);
    g.lineStyle(2,0x3dff6e,1); g.strokeRect(6,38,W-12,H-66);   // inner frame: 38 .. H-28
    this.add.text(cx,15,this.cfg.title,{fontFamily:'"Press Start 2P"',fontSize:'12px',color:'#ffd23f',align:'center'}).setOrigin(.5);
    // controls reminder (each world) — one compact line covering touch + keyboard
    this.add.text(cx,29,'controls:  < > = MOVE  ·  JUMP / UP = JUMP (2x = double)  ·  DUCK / DOWN = duck under shots',
      {fontFamily:'VT323',fontSize:'11px',color:'#66ccff',align:'center'}).setOrigin(.5);
    // NEW POWERS row (two columns, narrow wrap so the descriptions never collide)
    this.add.text(cx,50,'NEW POWERS',{fontFamily:'"Press Start 2P"',fontSize:'9px',color:'#3dff6e'}).setOrigin(.5);
    var powers=this.cfg.powers||[], n=powers.length||1;
    powers.forEach(function(pwr,i){ var x=W*(i+1)/(n+1);
      var img=self.add.image(x,84,pwr.tex); if(img.height) img.setScale(34/img.height); img.setDepth(4);
      if(self.renderer.type===Phaser.WEBGL){ try{ img.postFX.addGlow(0xffa020,1.4,0,false,0.1,12); }catch(e){} }
      self.tweens.add({targets:img,y:80,duration:700,yoyo:true,repeat:-1,ease:'Sine.inOut'});
      self.add.text(x,106,pwr.name,{fontFamily:'"Press Start 2P"',fontSize:'8px',color:'#ffffff'}).setOrigin(.5);
      self.add.text(x,120,pwr.desc,{fontFamily:'VT323',fontSize:'13px',color:'#c9c4e0',align:'center',wordWrap:{width:150}}).setOrigin(.5,0);
    });
    // WATCH FOR — threats stacked one per row (icon + "NAME — what to do")
    this.add.text(cx,154,'WATCH FOR',{fontFamily:'"Press Start 2P"',fontSize:'9px',color:'#ff3860'}).setOrigin(.5);
    var threats=this.cfg.threats||[];
    threats.forEach(function(t,i){ var y=174+i*18;
      var img=self.add.image(74,y,t.tex); if(img.height) img.setScale(18/img.height);
      self.add.text(92,y,t.name+' — '+t.desc,{fontFamily:'VT323',fontSize:'14px',color:'#e0b8c8',wordWrap:{width:340}}).setOrigin(0,.5);
    });
    if(this.cfg.tip) this.add.text(cx,214,this.cfg.tip,{fontFamily:'VT323',fontSize:'13px',color:'#ffd23f',align:'center',wordWrap:{width:W-48}}).setOrigin(.5);
    // honeypot warning — shown every world (they first appear in World 2). Coins-from-this-level, not total.
    this.add.text(cx,232,'⚠ HONEYPOTS: fake treasure — they drain THIS level\'s coins, not your total',
      {fontFamily:'VT323',fontSize:'12px',color:'#ff9500',align:'center',wordWrap:{width:W-30}}).setOrigin(.5);
    this.cont=this.add.text(cx,H-11,'TAP TO CONTINUE  ▶',{fontFamily:'"Press Start 2P"',fontSize:'9px',color:'#3dff6e'}).setOrigin(.5);
    this.input.on('pointerdown',function(){ self.go(); });
    this.input.keyboard.on('keydown',function(){ self.go(); });
  },
  go:function(){ if(this.done) return; this.done=true; SFX.power(); this.scene.start('Game',{level:this.nextLevel,score:this.score,lives:3}); },
  update:function(){ if(!this.t0){ this.t0=this.time.now; return; }
    if(this.cont) this.cont.setAlpha(0.4+0.6*Math.abs(Math.sin(this.time.now/300)));
    if(this.time.now-this.t0>16000) this.go();   // safety auto-advance so it can never soft-lock
  }
});

var NQGAME=new Phaser.Game({
  // Render at 2x internal resolution (each scene camera zooms 2x, so the world view is
  // unchanged but the backing store is 960x540 -> crisp, not blocky, when displayed big).
  type:Phaser.AUTO, parent:'screen', width:W*2, height:H*2, pixelArt:true, backgroundColor:'#0a0813', roundPixels:true,
  scale:{ mode:Phaser.Scale.FIT, autoCenter:Phaser.Scale.CENTER_BOTH },
  physics:{ default:'arcade', arcade:{ gravity:{y:900}, debug:false } },
  scene:[Boot,Title,LevelSelect,Controls,Gate,Game,Over,Win,Interlude,Briefing]
});
// Global "jump to LEVEL SELECT" hook — works from ANY scene (title, game, over, win), so the
// reliable DOM "≡ Levels" button is never a dead end. Stops whatever's running, then starts it.
try{ if(typeof window!=='undefined') window.__NQ_TOLEVELS=function(){ try{
  NQGAME.scene.getScenes(true).forEach(function(sc){ var k=sc.sys&&sc.sys.settings&&sc.sys.settings.key; if(k&&k!=='LevelSelect') NQGAME.scene.stop(k); });
  NQGAME.scene.start('LevelSelect');
}catch(e){} }; }catch(e){}

/* ---------- ⚙ Settings: Music + Effects volume sliders (DOM = reliable input, saved) ---------- */
if(typeof document!=='undefined'){ (function(){
  var css=document.createElement('style');
  css.textContent='#nqcog{position:fixed;top:8px;right:8px;z-index:60;width:34px;height:34px;border-radius:8px;border:2px solid rgba(120,180,255,.4);'
    +'background:rgba(18,22,40,.72);color:#9fd4ff;font-size:18px;line-height:30px;text-align:center;cursor:pointer;-webkit-user-select:none;user-select:none}'
    +'#nqset{position:fixed;top:48px;right:8px;z-index:60;display:none;width:210px;padding:12px 14px;border-radius:10px;'
    +'border:2px solid rgba(120,180,255,.4);background:rgba(12,14,28,.95);color:#dfe6ff;font-family:VT323,monospace;font-size:17px;box-shadow:0 8px 24px rgba(0,0,0,.5)}'
    +'#nqset.on{display:block}#nqset .row{margin-bottom:11px}#nqset label{display:block;margin-bottom:3px}'
    +'#nqset input[type=range]{width:100%;accent-color:#3dff6e}#nqset .mute{cursor:pointer;color:#ffd23f;text-align:center;padding-top:2px}';
  document.head.appendChild(css);
  var cog=document.createElement('div'); cog.id='nqcog'; cog.textContent='⚙'; cog.title='Sound settings'; document.body.appendChild(cog);
  var panel=document.createElement('div'); panel.id='nqset';
  panel.innerHTML='<div class="row"><label>♪ Music</label><input id="nqvm" type="range" min="0" max="100"></div>'
    +'<div class="row"><label>🔊 Effects</label><input id="nqvs" type="range" min="0" max="100"></div>'
    +'<div class="mute" id="nqmute">🔇 Mute music</div>';
  document.body.appendChild(panel);
  var vm=panel.querySelector('#nqvm'), vs=panel.querySelector('#nqvs'), mute=panel.querySelector('#nqmute');
  function upMute(){ try{ mute.textContent=(window.__NQ_MUSIC&&window.__NQ_MUSIC.muted&&window.__NQ_MUSIC.muted())?'🔊 Unmute music':'🔇 Mute music'; }catch(e){} }
  function initVals(){ try{ vm.value=Math.round((window.__NQ_MUSIC&&window.__NQ_MUSIC.getVol?window.__NQ_MUSIC.getVol():1)*100); }catch(e){ vm.value=100; }
    try{ vs.value=Math.round((window.__NQ_SFX&&window.__NQ_SFX.getVol?window.__NQ_SFX.getVol():0.85)*100); }catch(e){ vs.value=85; } upMute(); }
  cog.addEventListener('click',function(){ panel.classList.toggle('on'); if(panel.classList.contains('on')) initVals(); });
  vm.addEventListener('input',function(){ try{ window.__NQ_MUSIC&&window.__NQ_MUSIC.setVol&&window.__NQ_MUSIC.setVol(vm.value/100); }catch(e){} });
  vs.addEventListener('input',function(){ try{ window.__NQ_SFX&&window.__NQ_SFX.setVol&&window.__NQ_SFX.setVol(vs.value/100); }catch(e){} });
  vs.addEventListener('change',function(){ try{ window.__NQ_SFX&&window.__NQ_SFX.power&&window.__NQ_SFX.power(); }catch(e){} });   // preview at the new level on release
  mute.addEventListener('click',function(){ try{ window.__NQ_MUSIC&&window.__NQ_MUSIC.toggle&&window.__NQ_MUSIC.toggle(); upMute(); }catch(e){} });
  initVals();
})(); }

/* ---------- On-screen gutter D-pad (tablets / wide screens) ---------- */
// On touch devices with room in the letterbox gutters (tablets, wide phones), put MOVE + JUMP in
// those dark side areas so they don't cover the game. Buttons set window.__NQ_PAD, read by the game
// loop; window.__NQ_PAD_ACTIVE tells the game to use them (and hide the on-screen < > affordances).
// Narrow phones (no gutter) fall back to the on-screen touch zones automatically.
if(typeof document!=='undefined'){ (function(){
  var isTouch=('ontouchstart' in window)||(navigator.maxTouchPoints>0);
  if(!isTouch) return;
  window.__NQ_PAD={left:false,right:false,jump:false,down:false,throw:false}; window.__NQ_PAD_ACTIVE=false;
  var css=document.createElement('style');
  css.textContent='#nqpad{display:none}'
    +'.nqpb{position:fixed;z-index:45;border:2px solid rgba(120,180,255,.42);background:rgba(24,30,54,.5);color:#9fd4ff;'
    +'font-family:"Press Start 2P",monospace;display:flex;align-items:center;justify-content:center;cursor:pointer;'
    +'-webkit-user-select:none;user-select:none;touch-action:none;box-shadow:0 5px 16px rgba(0,0,0,.45);transition:background .05s}'
    +'.nqpb.on{background:rgba(61,255,158,.55);color:#04241a;border-color:#3dff9e}'
    +'.nqpb-move{border-radius:50%}'
    +'.nqpb-jump{border-radius:20px;color:#a6ffcd;border-color:rgba(80,255,160,.5);background:rgba(18,42,30,.55)}';
  document.head.appendChild(css);
  var wrap=document.createElement('div'); wrap.id='nqpad'; document.body.appendChild(wrap);
  function mk(cls,label){ var e=document.createElement('button'); e.className='nqpb '+cls; e.textContent=label; e.setAttribute('aria-hidden','true'); wrap.appendChild(e); return e; }
  var bL=mk('nqpb-move','◄'), bR=mk('nqpb-move','►'), bJ=mk('nqpb-jump','JUMP'), bD=mk('nqpb-jump','DUCK'), bF=mk('nqpb-jump','THROW');
  function bind(el,key){
    var set=function(v){ return function(ev){ ev.preventDefault(); ev.stopPropagation(); window.__NQ_PAD[key]=v; el.classList.toggle('on',v); }; };
    el.addEventListener('touchstart',set(true),{passive:false}); el.addEventListener('touchend',set(false),{passive:false});
    el.addEventListener('touchcancel',set(false),{passive:false});
    el.addEventListener('mousedown',set(true)); el.addEventListener('mouseup',set(false)); el.addEventListener('mouseleave',set(false));
  }
  bind(bL,'left'); bind(bR,'right'); bind(bJ,'jump'); bind(bD,'down'); bind(bF,'throw');
  function layout(){
    var s=document.getElementById('screen'); if(!s) return;
    var r=s.getBoundingClientRect(), gl=r.left, gr=window.innerWidth-r.right, gutter=Math.min(gl,gr);
    // Activate whenever the gutters can hold the buttons (phones in landscape ≈ 70-90px qualify).
    // Below this the two move buttons can't sit side-by-side without covering the game → on-screen zones.
    if(gutter<62){ window.__NQ_PAD_ACTIVE=false; return; }
    window.__NQ_PAD_ACTIVE=true;
    var gap=Math.max(4,Math.round(gutter*0.06));
    var mv=Math.max(28,Math.min(96,Math.floor((gutter-gap)/2)));   // ◄ ► sized so BOTH fit in the gutter
    var jp=Math.max(44,Math.min(122,gutter-6));
    var by=Math.round(window.innerHeight*0.11);                    // low in the gutter → thumb reach
    var pairW=mv*2+gap, lx=Math.round(Math.max(1,(gl-pairW)/2));
    bL.style.width=bL.style.height=mv+'px'; bL.style.left=lx+'px'; bL.style.bottom=by+'px'; bL.style.fontSize=Math.round(mv*0.42)+'px';
    bR.style.width=bR.style.height=mv+'px'; bR.style.left=(lx+mv+gap)+'px'; bR.style.bottom=by+'px'; bR.style.fontSize=Math.round(mv*0.42)+'px';
    var rx=Math.round(r.right+Math.max(1,(gr-jp)/2));
    bJ.style.width=bJ.style.height=jp+'px'; bJ.style.left=rx+'px'; bJ.style.bottom=by+'px'; bJ.style.fontSize=Math.round(Math.max(8,jp*0.15))+'px';
    var dk=Math.max(34,Math.round(jp*0.60));   // DUCK: smaller, sits just above JUMP (same right-thumb reach)
    bD.style.width=bD.style.height=dk+'px'; bD.style.left=Math.round(rx+(jp-dk)/2)+'px'; bD.style.bottom=(by+jp+8)+'px'; bD.style.fontSize=Math.round(Math.max(7,dk*0.20))+'px';
    var fk=Math.max(30,Math.round(mv*0.72));   // THROW (Solana disc): above the ◄ ► pair, left-thumb reach
    bF.style.width=bF.style.height=fk+'px'; bF.style.left=Math.round(lx+(pairW-fk)/2)+'px'; bF.style.bottom=(by+mv+10)+'px'; bF.style.fontSize=Math.round(Math.max(7,fk*0.185))+'px';
  }
  window.addEventListener('resize',layout);
  window.addEventListener('orientationchange',function(){ setTimeout(layout,220); });
  setTimeout(layout,300); setTimeout(layout,900);
  // show the pad only during actual gameplay AND when the gutter is wide enough
  setInterval(function(){
    var inGame=false; try{ inGame=NQGAME.scene.isActive('Game'); }catch(e){}
    wrap.style.display=(inGame&&window.__NQ_PAD_ACTIVE)?'block':'none';
    if(!inGame){ window.__NQ_PAD.left=window.__NQ_PAD.right=window.__NQ_PAD.jump=false; bL.classList.remove('on'); bR.classList.remove('on'); bJ.classList.remove('on'); }
  },120);
})(); }

/* ---------- Music mute toggle (M key + a small button) ---------- */
if(typeof document!=='undefined'){ (function(){
  var css=document.createElement('style');
  css.textContent='#nqmute,#nqbeats{position:fixed;top:9px;z-index:60;width:34px;height:34px;border-radius:50%;'
    +'border:1px solid rgba(255,255,255,.22);background:rgba(18,14,32,.55);color:#ffd23f;cursor:pointer;'
    +'display:flex;align-items:center;justify-content:center;-webkit-tap-highlight-color:transparent;padding:0;line-height:1}'
    +'#nqmute{left:9px;font-size:16px}#nqbeats{left:49px;font-size:15px}'
    +'#nqbeats-wrap{position:fixed;inset:0;z-index:100001;background:rgba(6,4,16,.74);display:none;align-items:center;justify-content:center;padding:16px;'
      +'font-family:"Press Start 2P",monospace}'
    +'#nqbeats-panel{background:#160f2a;border:2px solid #3a2f5e;border-radius:12px;max-width:330px;width:100%;padding:14px 14px 10px;box-shadow:0 10px 44px rgba(0,0,0,.6)}'
    +'#nqbeats-panel h3{color:#ffd23f;font-size:12px;margin:0 0 4px;text-align:center;line-height:1.4}'
    +'#nqbeats-panel .sub{color:#8f89b0;font-size:13px;text-align:center;margin-bottom:12px;font-family:VT323,monospace;letter-spacing:1px}'
    +'.nqch{display:flex;align-items:center;gap:9px;width:100%;text-align:left;background:#1e1638;border:1px solid #2f2652;color:#cbc6e6;'
      +'border-radius:8px;padding:9px 11px;margin-bottom:6px;font-size:10px;cursor:pointer;font-family:inherit}'
    +'.nqch.on{background:#ffd23f;color:#20142e;border-color:#ffd23f}'
    +'.nqch .dot{width:8px;height:8px;border-radius:50%;background:#463a6e;flex:0 0 auto}.nqch.on .dot{background:#20142e}'
    +'#nqbeats-x{display:block;margin:8px auto 2px;background:none;border:none;color:#8f89b0;font-size:9px;cursor:pointer;font-family:inherit}';
  document.head.appendChild(css);
  // --- music mute button ---
  var btn=document.createElement('button'); btn.id='nqmute'; btn.setAttribute('aria-label','Toggle music'); document.body.appendChild(btn);
  function icon(){ btn.textContent=(window.__NQ_MUSIC&&window.__NQ_MUSIC.muted())?'🔇':'🔊'; }
  btn.addEventListener('click',function(e){ e.preventDefault(); e.stopPropagation(); if(window.__NQ_MUSIC){ window.__NQ_MUSIC.toggle(); icon(); } });
  // --- NORMIES BAD BEATS: channel picker ---
  var bb=document.createElement('button'); bb.id='nqbeats'; bb.setAttribute('aria-label','Normies Bad Beats - pick music'); bb.textContent='📻'; document.body.appendChild(bb);
  var wrap=document.createElement('div'); wrap.id='nqbeats-wrap';
  wrap.innerHTML='<div id="nqbeats-panel"><h3>📻 NORMIES BAD BEATS</h3><div class="sub">pick your channel</div><div id="nqbeats-list"></div><button id="nqbeats-x">CLOSE ✕</button></div>';
  document.body.appendChild(wrap);
  var listEl=wrap.querySelector('#nqbeats-list');
  function render(){ if(!window.__NQ_MUSIC||!window.__NQ_MUSIC.channels) return; var cur=window.__NQ_MUSIC.getChannel(); listEl.innerHTML='';
    window.__NQ_MUSIC.channels().forEach(function(ch){ var b=document.createElement('button'); b.className='nqch'+(ch[0]===cur?' on':'');
      b.innerHTML='<span class="dot"></span>'+ch[1];
      b.addEventListener('click',function(ev){ ev.stopPropagation(); window.__NQ_MUSIC.setChannel(ch[0]); render(); }); listEl.appendChild(b); }); }
  function openBB(){ render(); wrap.style.display='flex'; }
  function closeBB(){ wrap.style.display='none'; }
  bb.addEventListener('click',function(e){ e.preventDefault(); e.stopPropagation(); openBB(); });
  wrap.addEventListener('click',function(e){ if(e.target===wrap) closeBB(); });
  wrap.querySelector('#nqbeats-x').addEventListener('click',function(e){ e.stopPropagation(); closeBB(); });
  document.addEventListener('keydown',function(e){ if(e.target&&/^(input|textarea)$/i.test(e.target.tagName)) return;
    if(e.key==='m'||e.key==='M'){ if(window.__NQ_MUSIC){ window.__NQ_MUSIC.toggle(); icon(); } }
    if(e.key==='b'||e.key==='B'){ if(wrap.style.display==='flex') closeBB(); else openBB(); } });
  icon();
})(); }

/* ---------- TEST BUILD: DOM feedback + level-select overlay ---------- */
// A floating HTML overlay (reliable on mobile, unlike in-canvas HUD hit areas). Only mounts
// on the ?test=1 build. Testers leave comments → POST /api/nq/feedback (same-origin on the live
// site). No-ops silently if the network is blocked (e.g. the CSP-locked Artifact never sets TEST_MODE).
if(TEST_MODE && typeof document!=='undefined'){ (function(){
  function el(tag,attrs,html){ var e=document.createElement(tag); if(attrs) for(var k in attrs) e.setAttribute(k,attrs[k]); if(html!=null) e.innerHTML=html; return e; }
  var css=el('style',null,
    '#nqfb-lv,#nqfb-open{position:fixed;bottom:12px;z-index:99999;font-family:system-ui,Segoe UI,Roboto,sans-serif;'
    +'font-size:13px;font-weight:600;border:none;border-radius:20px;padding:9px 14px;cursor:pointer;box-shadow:0 3px 10px rgba(0,0,0,.5)}'
    +'#nqfb-open{right:12px;background:#ffd23f;color:#20142e}#nqfb-lv{left:12px;background:#1b2440;color:#8fd0ff;border:1px solid #35507e}'
    +'#nqfb-wrap{position:fixed;inset:0;z-index:100000;background:rgba(6,4,16,.72);display:none;align-items:center;justify-content:center;padding:16px;font-family:system-ui,Segoe UI,Roboto,sans-serif}'
    +'#nqfb-wrap.on{display:flex}#nqfb-card{background:#161228;border:1px solid #33305a;border-radius:14px;max-width:420px;width:100%;padding:18px;color:#eee}'
    +'#nqfb-card h3{margin:0 0 3px;color:#ffd23f;font-size:17px}#nqfb-card .lv{color:#8fd0ff;font-size:13px;margin-bottom:12px}'
    +'#nqfb-card input,#nqfb-card textarea{width:100%;box-sizing:border-box;background:#0f0c1e;border:1px solid #33305a;color:#fff;border-radius:8px;padding:9px;font-size:15px;font-family:inherit}'
    +'#nqfb-card textarea{min-height:96px;resize:vertical;margin-top:8px}#nqfb-kinds{display:flex;gap:6px;margin-top:9px}'
    +'#nqfb-kinds button{flex:1;background:#0f0c1e;border:1px solid #33305a;color:#cbc6e6;border-radius:8px;padding:7px;font-size:13px;cursor:pointer}'
    +'#nqfb-kinds button.on{background:#2a2450;border-color:#8f7de6;color:#fff}'
    +'#nqfb-row{display:flex;gap:8px;margin-top:12px}#nqfb-row button{flex:1;border:none;border-radius:8px;padding:11px;font-size:14px;font-weight:600;cursor:pointer}'
    +'#nqfb-send{background:#3dff9e;color:#04241a}#nqfb-cancel{background:#2a2450;color:#cbc6e6}'
    +'#nqfb-toast{position:fixed;bottom:60px;left:50%;transform:translateX(-50%);z-index:100001;background:#04241a;color:#8dffc0;'
    +'padding:9px 16px;border-radius:20px;font-family:system-ui;font-size:13px;opacity:0;transition:opacity .25s;pointer-events:none}'
    +'#nqfb-toast.on{opacity:1}');
  document.head.appendChild(css);

  var lvBtn=el('button',{id:'nqfb-lv'},'≡ Levels');
  var openBtn=el('button',{id:'nqfb-open'},'💬 Feedback');
  var toast=el('div',{id:'nqfb-toast'});
  var wrap=el('div',{id:'nqfb-wrap'});
  wrap.appendChild(el('div',{id:'nqfb-card'},
    '<h3>Playtest feedback</h3><div class="lv" id="nqfb-lvl">level: —</div>'
    +'<input id="nqfb-name" maxlength="60" placeholder="your name / handle">'
    +'<div id="nqfb-kinds"><button data-k="bug" class="on">🐞 Bug</button><button data-k="idea">💡 Idea</button><button data-k="note">📝 Note</button></div>'
    +'<textarea id="nqfb-text" maxlength="2000" placeholder="What did you notice? Be specific — level, spot, what happened."></textarea>'
    +'<div id="nqfb-row"><button id="nqfb-cancel">Cancel</button><button id="nqfb-send">Send</button></div>'));
  document.body.appendChild(lvBtn); document.body.appendChild(openBtn); document.body.appendChild(toast); document.body.appendChild(wrap);

  var kind='bug';
  function showToast(msg,ok){ toast.textContent=msg; toast.style.background=ok?'#04241a':'#3a0f1c'; toast.style.color=ok?'#8dffc0':'#ff9db8'; toast.classList.add('on'); setTimeout(function(){ toast.classList.remove('on'); },2200); }
  // While the modal is open, DISABLE Phaser's keyboard — otherwise its global capture of the game
  // keys (W A S D F X Space, arrows, L) preventDefaults them and the textarea can't receive them.
  function kbGame(on){ try{ if(NQGAME&&NQGAME.input&&NQGAME.input.keyboard) NQGAME.input.keyboard.enabled=on; }catch(e){} }
  function openM(){ wrap.classList.add('on'); kbGame(false); }
  function closeM(){ wrap.classList.remove('on'); kbGame(true); }
  lvBtn.onclick=function(){ if(typeof window.__NQ_TOLEVELS==='function') window.__NQ_TOLEVELS(); };
  openBtn.onclick=function(){
    document.getElementById('nqfb-lvl').textContent='level: '+(window.__NQ_LEVEL||'—');
    var nm=document.getElementById('nqfb-name'); try{ nm.value=localStorage.getItem('nq_tester')||''; }catch(e){}
    openM(); setTimeout(function(){ document.getElementById('nqfb-text').focus(); },50);
  };
  document.getElementById('nqfb-cancel').onclick=function(){ closeM(); };
  wrap.onclick=function(e){ if(e.target===wrap) closeM(); };
  Array.prototype.forEach.call(document.querySelectorAll('#nqfb-kinds button'),function(b){
    b.onclick=function(){ Array.prototype.forEach.call(document.querySelectorAll('#nqfb-kinds button'),function(x){ x.classList.remove('on'); }); b.classList.add('on'); kind=b.getAttribute('data-k'); };
  });
  document.getElementById('nqfb-send').onclick=function(){
    var name=(document.getElementById('nqfb-name').value||'').trim();
    var text=(document.getElementById('nqfb-text').value||'').trim();
    if(!text){ showToast('write something first',false); return; }
    try{ localStorage.setItem('nq_tester',name); }catch(e){}
    var send=document.getElementById('nqfb-send'); send.disabled=true; send.textContent='Sending…';
    fetch('/api/nq/feedback',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({name:name,level:(window.__NQ_LEVEL||''),kind:kind,text:text})})
      .then(function(r){ return r.json().catch(function(){ return {ok:r.ok}; }); })
      .then(function(j){ if(j&&j.ok){ document.getElementById('nqfb-text').value=''; closeM(); showToast('Thanks! Comment sent ✓',true); } else { showToast('Could not send'+(j&&j.status?' ('+j.status+')':''),false); } })
      .catch(function(){ showToast('Network error — not sent',false); })
      .then(function(){ send.disabled=false; send.textContent='Send'; });
  };
})(); }

})();
