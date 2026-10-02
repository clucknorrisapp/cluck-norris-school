// AHOY: PumpFunPirates — save, audio, UI helpers. Plain globals, no bundler.
window.AHOY = window.AHOY || {};

// ── Save (localStorage, every access guarded: private windows and blocked storage just mean no save) ──
AHOY.Save = (function () {
  const KEY = "ahoy_pfp_save_v1";
  const fresh = () => ({ crew: "hook", booty: 0, done: {}, pieces: {}, secrets: {}, treasure: {}, at: {}, best: {}, muted: false, nft: null });
  let s = fresh();
  try { const raw = localStorage.getItem(KEY); if (raw) s = Object.assign(fresh(), JSON.parse(raw)); } catch (_) {}
  const write = () => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (_) {} };
  return {
    get: () => s,
    set(patch) { Object.assign(s, patch); write(); },
    island(id) { return { done: !!s.done[id], piece: !!s.pieces[id], best: s.best[id] || null }; },
    completeIsland(id, { piece, booty, secrets, time }) {
      s.done[id] = true;
      if (piece) s.pieces[id] = true;
      s.booty += Math.max(0, booty | 0);
      s.secrets[id] = Math.max(s.secrets[id] || 0, secrets | 0);
      if (time && (!s.best[id] || time < s.best[id])) s.best[id] = time;
      write();
    },
    addBooty(n) { s.booty = Math.max(0, s.booty + (n | 0)); write(); },
    seaAt(seaId) { return s.at[seaId] || 0; },
    setSeaAt(seaId, idx) { s.at[seaId] = idx; write(); },
    treasure(seaId) { return !!s.treasure[seaId]; },
    setTreasure(seaId) { s.treasure[seaId] = true; write(); },
    reset() { s = fresh(); write(); },
  };
})();

// ── Audio: everything is synthesized with WebAudio — no files, no licences. A shanty loop + SFX. ──
AHOY.Audio = (function () {
  let ctx = null, master = null, musicGain = null, musicTimer = null, step = 0, musicOn = false;
  const ensure = () => {
    if (ctx) return ctx;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain(); master.gain.value = AHOY.Save.get().muted ? 0 : 0.6; master.connect(ctx.destination);
      musicGain = ctx.createGain(); musicGain.gain.value = 0.22; musicGain.connect(master);
    } catch (_) { ctx = null; }
    return ctx;
  };
  const tone = (freq, dur, { type = "square", vol = 0.25, at = 0, slide = 0, dest = null } = {}) => {
    if (!ensure()) return;
    const t0 = ctx.currentTime + at;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t0 + dur);
    g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g); g.connect(dest || master); o.start(t0); o.stop(t0 + dur + 0.02);
  };
  const noise = (dur, vol = 0.2) => {
    if (!ensure()) return;
    const n = Math.floor(ctx.sampleRate * dur), buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = ctx.createBufferSource(), g = ctx.createGain(); g.gain.value = vol;
    src.buffer = buf; src.connect(g); g.connect(master); src.start();
  };
  const SFX = {
    jump: () => tone(380, 0.14, { type: "square", vol: 0.12, slide: 1.8 }),
    coin: () => { tone(988, 0.07, { type: "square", vol: 0.1 }); tone(1319, 0.12, { type: "square", vol: 0.1, at: 0.06 }); },
    hit: () => { tone(160, 0.22, { type: "sawtooth", vol: 0.2, slide: 0.4 }); noise(0.12, 0.12); },
    stomp: () => tone(220, 0.12, { type: "triangle", vol: 0.25, slide: 0.5 }),
    slash: () => noise(0.08, 0.15),
    power: () => { tone(523, 0.1, { vol: 0.12 }); tone(784, 0.16, { vol: 0.12, at: 0.08 }); },
    piece: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.18, { type: "triangle", vol: 0.2, at: i * 0.1 })),
    chest: () => [392, 523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.22, { type: "triangle", vol: 0.18, at: i * 0.08 })),
    boom: () => { noise(0.5, 0.35); tone(80, 0.5, { type: "sine", vol: 0.4, slide: 0.5 }); },
    thunder: () => { noise(0.9, 0.3); tone(55, 0.8, { type: "sine", vol: 0.3, slide: 0.6 }); },
    dig: () => { noise(0.1, 0.25); tone(140, 0.1, { type: "triangle", vol: 0.2 }); },
    bad: () => tone(200, 0.4, { type: "sawtooth", vol: 0.15, slide: 0.5 }),
    good: () => [659, 880].forEach((f, i) => tone(f, 0.14, { type: "triangle", vol: 0.2, at: i * 0.09 })),
    click: () => tone(660, 0.05, { type: "square", vol: 0.08 }),
  };
  // A simple shanty in D minor (6/8 feel). Melody + bass, looped by a scheduler.
  const D = 293.66, NOTE = (semi) => D * Math.pow(2, semi / 12);
  const MEL = [0, 3, 5, 7, 5, 3, 0, -2, 0, 3, 5, 3, 7, 8, 7, 5, 3, 5, 7, 10, 8, 7, 5, 3, 5, 3, 2, 0, -2, 0, 0, null];
  const BASS = [-12, null, null, -9, null, null, -14, null, null, -12, null, null, -9, null, null, -7, null, null, -5, null, null, -9, null, null, -12, null, null, -14, null, null, -12, null];
  const tick = () => {
    if (!musicOn || !ctx) return;
    const i = step % MEL.length;
    if (MEL[i] !== null) tone(NOTE(MEL[i]), 0.26, { type: "triangle", vol: 0.5, dest: musicGain });
    if (BASS[i] !== null) tone(NOTE(BASS[i]), 0.5, { type: "sine", vol: 0.55, dest: musicGain });
    if (i % 3 === 0) tone(90, 0.05, { type: "square", vol: 0.12, dest: musicGain });
    step++;
  };
  return {
    unlock() { if (ensure() && ctx.state === "suspended") ctx.resume().catch(() => {}); },
    play(name) { try { (SFX[name] || (() => {}))(); } catch (_) {} },
    music(on) {
      musicOn = !!on;
      if (musicOn && ensure() && !musicTimer) musicTimer = setInterval(tick, 190);
      if (!musicOn && musicTimer) { clearInterval(musicTimer); musicTimer = null; }
    },
    setMuted(m) { AHOY.Save.set({ muted: !!m }); if (ensure()) master.gain.value = m ? 0 : 0.6; },
    muted: () => !!AHOY.Save.get().muted,
  };
})();

// ── UI helpers shared by every scene ──
AHOY.UI = {
  W: 1280, H: 720,
  FONT_TITLE: "'Pirata One', 'Georgia', serif",
  FONT: "'Just Another Hand', 'Comic Sans MS', cursive",
  COLORS: { red: 0xfa0d0d, cream: 0xffcd77, brown: 0x583e3d, ink: 0x2b1b12, parchment: 0xf3e2b8, gold: 0xffc93c, sea: 0x1f8fb0 },
  text(scene, x, y, str, size = 34, color = "#2b1b12", opts = {}) {
    return scene.add.text(x, y, str, Object.assign({
      fontFamily: AHOY.UI.FONT, fontSize: size + "px", color, align: "center",
      stroke: opts.stroke || "#00000000", strokeThickness: opts.strokeThickness || 0,
      wordWrap: opts.wrap ? { width: opts.wrap } : undefined,
    }, opts.style || {})).setOrigin(opts.ox ?? 0.5, opts.oy ?? 0.5);
  },
  title(scene, x, y, str, size = 72) {
    return scene.add.text(x, y, str, { fontFamily: AHOY.UI.FONT_TITLE, fontSize: size + "px", color: "#ffcd77", stroke: "#2b1b12", strokeThickness: 10, align: "center" }).setOrigin(0.5);
  },
  // A wooden-plank button. Returns the container; onClick fires on pointerup.
  button(scene, x, y, label, onClick, { w = 260, h = 70, size = 38, fill = 0xb5652f, disabled = false } = {}) {
    const c = scene.add.container(x, y);
    const g = scene.add.graphics();
    const draw = (hover) => {
      g.clear();
      const base = disabled ? 0x7a7a7a : (hover ? 0xd07a3c : fill);
      g.fillStyle(0x2b1b12, 1).fillRoundedRect(-w / 2 - 4, -h / 2 - 4, w + 8, h + 8, 16);
      g.fillStyle(base, 1).fillRoundedRect(-w / 2, -h / 2, w, h, 12);
      g.fillStyle(0xffffff, 0.12).fillRoundedRect(-w / 2 + 6, -h / 2 + 5, w - 12, h / 2 - 6, 8);
      g.lineStyle(2, 0x2b1b12, 0.35);
      for (let i = 1; i < 3; i++) g.lineBetween(-w / 2 + 10, -h / 2 + (h * i) / 3, w / 2 - 10, -h / 2 + (h * i) / 3);
    };
    draw(false);
    const t = AHOY.UI.text(scene, 0, 2, label, size, disabled ? "#d8d8d8" : "#fff7e0", { stroke: "#2b1b12", strokeThickness: 5 });
    c.add([g, t]);
    c.setSize(w, h).setInteractive({ useHandCursor: !disabled });
    if (!disabled) {
      c.on("pointerover", () => draw(true));
      c.on("pointerout", () => draw(false));
      const press = () => { AHOY.Audio.unlock(); AHOY.Audio.play("click"); onClick && onClick(); };
      c.on("pointerup", press);
      if (AHOY.Nav) AHOY.Nav.add(scene, c, press); // arrows / d-pad can reach it, Enter / A presses it
    }
    c.label = t;
    return c;
  },
  // A parchment panel behind text.
  panel(scene, x, y, w, h, alpha = 0.97) {
    const g = scene.add.graphics();
    g.fillStyle(0x2b1b12, 0.55).fillRoundedRect(x - w / 2 + 6, y - h / 2 + 8, w, h, 18);
    g.fillStyle(0xf3e2b8, alpha).fillRoundedRect(x - w / 2, y - h / 2, w, h, 18);
    g.lineStyle(5, 0x583e3d, 1).strokeRoundedRect(x - w / 2, y - h / 2, w, h, 18);
    g.lineStyle(2, 0x583e3d, 0.35).strokeRoundedRect(x - w / 2 + 10, y - h / 2 + 10, w - 20, h - 20, 12);
    return g;
  },
  // Cover-fit an image to the 1280x720 view.
  cover(scene, key, depth = -10) {
    const img = scene.add.image(640, 360, key).setDepth(depth);
    const s = Math.max(1280 / img.width, 720 / img.height);
    return img.setScale(s);
  },
  isTouch: () => ("ontouchstart" in window) || navigator.maxTouchPoints > 0,
  muteButton(scene, x = 1240, y = 36) {
    const b = AHOY.UI.text(scene, x, y, AHOY.Audio.muted() ? "🔇" : "🔊", 34).setDepth(1000).setScrollFactor(0).setInteractive({ useHandCursor: true });
    b.on("pointerup", () => { const m = !AHOY.Audio.muted(); AHOY.Audio.setMuted(m); b.setText(m ? "🔇" : "🔊"); });
    return b;
  },
  fadeTo(scene, key, data) {
    scene.cameras.main.fadeOut(260, 0, 0, 0);
    scene.cameras.main.once("camerafadeoutcomplete", () => scene.scene.start(key, data));
  },
};

// Open an outside link. A real <a> click works in more embeds than window.open (which some
// sandboxed frames refuse and return null for).
AHOY.openLink = function (href) {
  try { const a = document.createElement("a"); a.href = href; a.target = "_blank"; a.rel = "noopener"; document.body.appendChild(a); a.click(); a.remove(); }
  catch (_) { try { window.open(href, "_blank", "noopener"); } catch (__) {} }
};

// The pirate a player sails as: a starter, or (holders) their own NFT mapped onto a starter + powers.
AHOY.currentPirate = function () {
  const save = AHOY.Save.get();
  const crew = AHOY.CREW.find((c) => c.id === save.crew) || AHOY.CREW[1];
  const nft = save.nft && AHOY.Gate.state().nfts.find((n) => n.id === save.nft);
  if (!nft) return { ...crew, laser: false, portrait: null, nftName: null };
  const t = nft.traits || {};
  const eye = String(t.eyewear || "").toLowerCase(), eyes = String(t.eyes || "").toLowerCase(), arm = String(t.arm || "").toLowerCase();
  // Trait → power. Eyewear decides the power; laser eyes add a laser on top of it.
  let base = crew;
  if (/vr|visor/.test(eye)) base = AHOY.CREW[0];
  else if (/patch/.test(eye)) base = AHOY.CREW[1];
  else if (/3d/.test(eye)) base = AHOY.CREW[2];
  else if (/shade|sun|glass/.test(eye)) base = AHOY.CREW[3];
  else if (/hook/.test(arm)) base = AHOY.CREW[1];
  return { ...base, name: nft.name, laser: /laser/.test(eyes) || /laser/.test(eye), portrait: "nft-" + nft.id, nftName: nft.name };
};
