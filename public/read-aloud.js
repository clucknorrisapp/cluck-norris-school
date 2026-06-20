/* Cluck Norris — read-aloud (Text-to-Speech).
   Two engines, transparent to the user:
   1. REAL voice — POST /api/tts (ElevenLabs, the branded Cluck voice), cached
      server-side so each chunk is paid once then free forever. Used when the
      server has a key + budget.
   2. FREE fallback — the browser's Web Speech API (robotic but $0, works offline
      on Seeker/Android WebView + iOS). Used automatically when /api/tts answers
      503 (no key / over daily budget) or errors.
   A floating "Listen" button (bottom-left) reads the page's main content in the
   current language (en/zh/es), with pause/resume/stop. Loaded globally via
   cluck-nav.js. Skips nav/buttons/code and our own injected UI. */
(function () {
  if (!("speechSynthesis" in window) || typeof window.SpeechSynthesisUtterance === "undefined") return;
  var synth = window.speechSynthesis;

  var LABELS = {
    en: { listen: "🔊 Listen", pause: "⏸ Pause", resume: "▶ Resume" },
    zh: { listen: "🔊 朗读",   pause: "⏸ 暂停",  resume: "▶ 继续" },
    es: { listen: "🔊 Escuchar", pause: "⏸ Pausa", resume: "▶ Seguir" }
  };
  function lang() {
    try { var s = localStorage.getItem("clkn_lang"); if (s && LABELS[s]) return s; } catch (_) {}
    var h = (document.documentElement.getAttribute("lang") || "en").toLowerCase();
    return h.indexOf("zh") === 0 ? "zh" : h.indexOf("es") === 0 ? "es" : "en";
  }
  function bcp47(l) { return l === "zh" ? "zh-CN" : l === "es" ? "es-ES" : "en-US"; }

  var SKIP = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, CODE: 1, PRE: 1, BUTTON: 1, SELECT: 1, TEXTAREA: 1, SVG: 1, NAV: 1, HEADER: 1, FOOTER: 1, INPUT: 1, KBD: 1, SAMP: 1 };
  function isHidden(el) { try { return !(el.offsetParent !== null || (el.getClientRects && el.getClientRects().length)); } catch (_) { return false; } }
  function skipped(node) {
    var p = node.parentNode;
    while (p && p.nodeType === 1) {
      if (SKIP[p.tagName]) return true;
      if (p.id === "clkn-lang-toggle" || p.id === "clkn-read-bar" || p.id === "cluck-nav-bar") return true;
      if (p.hasAttribute && (p.getAttribute("aria-hidden") === "true" || p.hasAttribute("data-read-skip") || p.hasAttribute("data-i18n-skip"))) return true;
      p = p.parentNode;
    }
    return false;
  }
  function collect() {
    var tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    var out = [], n;
    while ((n = tw.nextNode())) {
      var t = (n.nodeValue || "").replace(/\s+/g, " ").trim();
      if (t.length < 2) continue;
      if (!/[A-Za-z0-9一-鿿À-ɏ]/.test(t)) continue;  // has a letter/digit/CJK/accented
      if (skipped(n)) continue;
      var pe = n.parentElement;
      if (pe && isHidden(pe)) continue;
      out.push(t);
    }
    return out;
  }
  function chunk(parts) {
    var text = parts.join(". ");
    var sentences = text.match(/[^.!?。！？\n]+[.!?。！？]?/g) || [text];
    var chunks = [], cur = "";
    for (var i = 0; i < sentences.length; i++) {
      var s = sentences[i].trim(); if (!s) continue;
      if ((cur + " " + s).length > 180) { if (cur) chunks.push(cur); cur = s; }
      else cur = cur ? cur + " " + s : s;
    }
    if (cur) chunks.push(cur);
    return chunks;
  }

  var queue = [], idx = 0, state = "idle"; // idle | playing | paused
  var btn, stopBtn, kaTimer = null;
  // Real-voice (ElevenLabs via /api/tts) playback. If the server has no key/budget
  // it answers 503 → we set ttsOff for the session and use the free browser voice.
  // Native <audio> pause/resume is reliable (unlike mobile speechSynthesis), so the
  // real-voice path resumes exactly; the browser path keeps the chunk-index resume.
  var audioEl = null, ttsOff = false, curMode = null; // curMode: "audio" | "browser"
  function getAudio() {
    if (audioEl) return audioEl;
    audioEl = new Audio(); audioEl.preload = "auto";
    return audioEl;
  }
  function pickVoice(l) {
    var vs = synth.getVoices() || [];
    for (var i = 0; i < vs.length; i++) if ((vs[i].lang || "").toLowerCase().indexOf(l) === 0) return vs[i];
    return null;
  }
  function speakBrowser(text) {
    curMode = "browser";
    var u = new SpeechSynthesisUtterance(text);
    var l = lang(); u.lang = bcp47(l); var v = pickVoice(l); if (v) u.voice = v;
    u.rate = 1; u.pitch = 1;
    // Only advance/continue while actually playing — so a pause()/stop() cancel
    // (which fires onend) never skips ahead or auto-continues.
    u.onend = function () { if (state !== "playing") return; idx++; speakChunk(); };
    u.onerror = function () { if (state !== "playing") return; idx++; speakChunk(); };
    synth.speak(u);
  }
  function speakChunk() {
    if (idx >= queue.length) { stop(); return; }
    var text = queue[idx];
    if (ttsOff) { speakBrowser(text); return; }
    // Try the real voice; fall back to the browser voice for this chunk on any miss.
    var myIdx = idx;
    fetch("/api/tts", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: text, lang: lang() })
    }).then(function (r) {
      if (state !== "playing" || idx !== myIdx) return; // paused/stopped/advanced meanwhile
      if (!r.ok) { if (r.status === 503) ttsOff = true; speakBrowser(text); return; }
      return r.blob().then(function (b) {
        if (state !== "playing" || idx !== myIdx) return;
        curMode = "audio";
        var a = getAudio();
        try { if (a.src && a.src.indexOf("blob:") === 0) URL.revokeObjectURL(a.src); } catch (_) {}
        a.src = URL.createObjectURL(b);
        a.onended = function () { if (state !== "playing") return; idx++; speakChunk(); };
        a.onerror = function () { if (state !== "playing") return; speakBrowser(text); };
        a.play().catch(function () { if (state === "playing") speakBrowser(text); });
      });
    }).catch(function () {
      if (state !== "playing" || idx !== myIdx) return;
      ttsOff = true; speakBrowser(text);
    });
  }
  function keepAlive() { // some mobile browsers cut long TTS — nudge resume periodically
    clearInterval(kaTimer);
    kaTimer = setInterval(function () {
      if (state !== "playing") { clearInterval(kaTimer); return; }
      if (curMode === "browser" && synth.speaking && !synth.paused) { try { synth.resume(); } catch (_) {} }
    }, 8000);
  }
  function start() {
    var parts = collect();
    if (!parts.length) return;
    queue = chunk(parts); idx = 0;
    try { synth.cancel(); } catch (_) {}
    state = "playing"; render(); speakChunk(); keepAlive();
  }
  // Pause/resume: the real-voice <audio> path pauses/resumes natively (reliable).
  // The browser-voice path uses our OWN chunk index — mobile native pause()/resume()
  // is flaky, so we cancel and re-speak the CURRENT chunk on resume (continues where
  // it left off, never restarts at the top).
  function pause() {
    state = "paused";
    if (curMode === "audio" && audioEl) { try { audioEl.pause(); } catch (_) {} }
    else { try { synth.cancel(); } catch (_) {} }
    render();
  }
  function resume() {
    state = "playing"; render();
    if (curMode === "audio" && audioEl && audioEl.src && !audioEl.ended) {
      audioEl.play().catch(function () { speakChunk(); }); keepAlive(); return;
    }
    speakChunk(); keepAlive();
  }
  function stop() {
    state = "idle";
    try { synth.cancel(); } catch (_) {}
    if (audioEl) { try { audioEl.pause(); audioEl.currentTime = 0; } catch (_) {} }
    queue = []; idx = 0; curMode = null; render();
  }

  function render() {
    if (!btn) return;
    var L = LABELS[lang()] || LABELS.en;
    if (state === "idle") { btn.textContent = L.listen; stopBtn.style.display = "none"; }
    else if (state === "playing") { btn.textContent = L.pause; stopBtn.style.display = "inline-flex"; }
    else { btn.textContent = L.resume; stopBtn.style.display = "inline-flex"; }
  }
  function inject() {
    if (document.getElementById("clkn-read-bar") || !document.body) return;
    var bar = document.createElement("div");
    bar.id = "clkn-read-bar";
    bar.setAttribute("data-read-skip", "1"); bar.setAttribute("data-i18n-skip", "1"); bar.setAttribute("translate", "no");
    bar.style.cssText = ["position:fixed", "bottom:calc(14px + env(safe-area-inset-bottom,0px))", "left:12px",
      "z-index:2147483600", "display:flex", "gap:6px", "align-items:center", "font-family:'Chakra Petch',system-ui,sans-serif"].join(";");
    btn = document.createElement("button"); btn.type = "button";
    btn.style.cssText = ["font:inherit", "font-size:13px", "font-weight:700", "color:#FFD9A0", "background:rgba(26,15,8,.96)",
      "border:1px solid rgba(255,122,24,.55)", "border-radius:999px", "padding:8px 13px", "cursor:pointer",
      "box-shadow:0 4px 16px rgba(0,0,0,.5)", "-webkit-tap-highlight-color:transparent", "white-space:nowrap"].join(";");
    btn.addEventListener("click", function () { if (state === "idle") start(); else if (state === "playing") pause(); else resume(); });
    stopBtn = document.createElement("button"); stopBtn.type = "button"; stopBtn.textContent = "⏹"; stopBtn.style.display = "none";
    stopBtn.style.cssText = ["font:inherit", "font-size:13px", "font-weight:700", "color:#FCA5A5", "background:rgba(26,15,8,.96)",
      "border:1px solid rgba(239,68,68,.5)", "border-radius:999px", "padding:8px 11px", "cursor:pointer",
      "box-shadow:0 4px 16px rgba(0,0,0,.5)", "-webkit-tap-highlight-color:transparent"].join(";");
    stopBtn.addEventListener("click", stop);
    bar.appendChild(btn); bar.appendChild(stopBtn);
    document.body.appendChild(bar);
    render();
  }
  // voices load async on some browsers — harmless to register
  try { synth.onvoiceschanged = function () {}; } catch (_) {}
  // stop reading when leaving / switching screens
  window.addEventListener("beforeunload", function () { try { synth.cancel(); } catch (_) {} });

  // Public API so chat-style pages (e.g. Ask Cluck) can read a specific answer the
  // moment it arrives, instead of the whole page top-to-bottom.
  function speakText(text) {
    text = String(text || "").trim();
    if (!text) return;
    queue = chunk([text]); idx = 0;
    try { synth.cancel(); } catch (_) {}
    if (audioEl) { try { audioEl.pause(); audioEl.currentTime = 0; } catch (_) {} }
    state = "playing"; render(); speakChunk(); keepAlive();
  }
  window.CLKN_READ = { speak: speakText, stop: stop, get state() { return state; } };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", inject); else inject();
})();
