// track.js — the learning-funnel beacon, and the graduation ledger's only input.
//
// ⚠️ SHARED ON PURPOSE. This was inline in src/App.jsx (the desktop school). When the Seeker
// app grew its own school it needed the identical behaviour, and a second copy would have been
// this project's most expensive recurring bug in its worst possible place: the queue below is
// the ONLY thing that tells the server a lesson was passed, and the graduation gate blocks a
// real learner when a mark is missing. Two implementations means two queues, two session ids,
// and marks that silently land in one and not the other. One module, both schools.
//
// Every comment below is incident history — read it before simplifying anything.

import { api } from "./edition.js";

// Fire-and-forget learning-funnel event (no PII) — see /api/track + lib/analytics.
// Lets us see where learners drop off (per-lesson start/complete, school/incubator/
// challenge/graduation). Never throws, never blocks the UI.
// Anonymous per-browser session id — no PII, never leaves this site. It lets the server
// keep its own record of lesson completions so the graduation claim (diploma cNFT, paid
// by the treasury) can verify the curriculum was actually walked, not just asserted.
function sessionId(){
  try{
    let s=localStorage.getItem("clkn_sid");
    if(!s){
      s=(window.crypto&&crypto.randomUUID)?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2);
      localStorage.setItem("clkn_sid",s);
    }
    return s;
  }catch(_){ return ""; }
}
// Lesson-completion beacons are the ONLY thing that tells the server's graduation ledger a class
// was passed. They used to be fire-and-forget: a dropped mobile connection, a blocker, or a tab
// closing right after the last quiz lost that mark for good, and the graduation gate then blocked
// a real learner with nothing they could do about it (deep dive 2026-09-17). A failed durable
// beacon is now queued in localStorage and re-sent on the next load, when the network comes back,
// and before a claim. The server keeps the FIRST sighting of a lesson, so a re-send never rewrites
// a genuine mark, and the ledger's anti-farm timing checks are unaffected.
var TRACK_QUEUE_KEY="clkn_track_q";
function readTrackQueue(){ try{ var q=JSON.parse(localStorage.getItem(TRACK_QUEUE_KEY)||"[]"); return Array.isArray(q)?q:[]; }catch(_){ return []; } }
function writeTrackQueue(q){ try{ localStorage.setItem(TRACK_QUEUE_KEY,JSON.stringify(q.slice(-60))); }catch(_){} }
function queueTrack(payload){ var q=readTrackQueue(); if(!q.some(function(x){return x&&x.event===payload.event;})) q.push(payload); writeTrackQueue(q); }
function sendTrack(payload){
  return fetch(api("/api/track"),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload),keepalive:true})
    .then(function(r){ if(!r.ok) throw new Error("track "+r.status); });
}
function track(event,extra){
  try{
    var ev=String(event||"").toLowerCase().replace(/[^a-z0-9_:-]/g,"").slice(0,64);
    if(!ev) return;
    var payload=Object.assign({event:ev,sid:sessionId()},extra||{});
    var durable=/^lesson_complete:/.test(ev);
    sendTrack(payload).catch(function(){ if(durable) queueTrack(payload); });
  }catch(_){}
}
// Re-send every queued beacon. Resolves when the attempt is over (never rejects); anything that
// fails again goes back on the queue.
// An entry leaves the queue only AFTER its send resolved OK (Codex on #333: clearing the queue up
// front and re-queueing on failure lost every entry if the tab closed mid-flight). A duplicate
// delivery is harmless — the server keeps the first sighting per lesson — so overlapping flushes
// (load + online + claim) are allowed rather than guarded.
function dropFromTrackQueue(event){ writeTrackQueue(readTrackQueue().filter(function(x){ return !(x&&x.event===event); })); }
function flushTrackQueue(){
  var q=readTrackQueue();
  if(!q.length) return Promise.resolve();
  return Promise.all(q.map(function(p){ return sendTrack(p).then(function(){ dropFromTrackQueue(p.event); }).catch(function(){}); })).then(function(){});
}
if(typeof window!=="undefined"){
  try{
    window.addEventListener("online",function(){ flushTrackQueue(); });
    setTimeout(flushTrackQueue,1500);
  }catch(_){}
}
export { sessionId, track, flushTrackQueue, readTrackQueue, dropFromTrackQueue, TRACK_QUEUE_KEY };
