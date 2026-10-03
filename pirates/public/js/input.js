// AHOY: PumpFunPirates — one input layer for keyboard, controllers and menus.
//
// AHOY.CONTROLS is the single table of what every action is bound to. The Controls panel is
// drawn from it, so adding an action is one row here (plus whatever the game does with its key).
//
// Controllers: the browser Gamepad API, read tolerantly (ported from Normie Quest, which learned
// it the hard way): the d-pad may arrive as buttons 12-15, as a stick, or as a single "hat" axis
// on cheap USB pads; axes that REST off-centre are ignored; a headset dongle that enumerates as a
// gamepad is skipped. Each controller action is replayed as its keyboard key, so every scene that
// already listens for Space / X / C / Esc / arrows works with a pad without knowing pads exist.
// Remap is press-to-bind and saved in this browser. Add ?gpdebug=1 for a live button readout.
//
// AHOY.Nav: arrows / WASD / d-pad move a highlight between buttons (and anything registered with
// AHOY.Nav.add); Enter, Space or the A button presses it. Scenes that use the arrows for play set
// scene.navOff = true (or a function) while playing.
(function () {
  const KEYDEF = {
    ArrowLeft: [37, "ArrowLeft"], ArrowRight: [39, "ArrowRight"], ArrowUp: [38, "ArrowUp"], ArrowDown: [40, "ArrowDown"],
    Space: [32, " "], KeyX: [88, "x"], KeyC: [67, "c"], Escape: [27, "Escape"], Enter: [13, "Enter"],
  };

  AHOY.CONTROLS = [
    { action: "Move", keys: "← →  or  A D", pad: "D-pad or left stick", touch: "◀ ▶" },
    { action: "Jump — again in the air to double jump", keys: "Space, ↑, W or Z", pad: "A (bottom button)", touch: "⬆" },
    { action: "Cutlass", keys: "X or J", pad: "X or B", touch: "crossed swords" },
    { action: "Pirate power", keys: "C, K or Shift", pad: "Y, bumpers or triggers", touch: "★" },
    { action: "Pause", keys: "Esc or P", pad: "Start or Select", touch: "❚❚ (top right)" },
    { action: "Menus", keys: "arrows + Enter, or click", pad: "D-pad + A", touch: "tap" },
  ];

  // ── Controllers ──
  const DEFAULT_MAP = { jump: [0], attack: [1, 2], power: [3, 4, 5, 6, 7], pause: [9, 8] };
  const ACTION_KEY = { left: "ArrowLeft", right: "ArrowRight", up: "ArrowUp", down: "ArrowDown", jump: "Space", attack: "KeyX", power: "KeyC", pause: "Escape" };
  const MAP_KEY = "ahoy_pad_map_v1";
  const loadMap = () => { try { const m = JSON.parse(localStorage.getItem(MAP_KEY) || "null"); if (m && m.jump && m.attack) return m; } catch (_) {} return null; };
  let padMap = loadMap();
  const map = () => Object.assign({}, DEFAULT_MAP, padMap || {});

  const DEBUG = /[?&#]gpdebug=1/i.test(location.search + location.hash);
  const listeners = [];
  const state = { active: false, name: "", held: {}, remapping: false };
  let chosen = null, axRest = null, lastKey = null, dbgEl = null;

  const pads = () => { try { return Array.from(navigator.getGamepads ? navigator.getGamepads() : []).filter(Boolean); } catch (_) { return []; } };
  const looksReal = (gp) => (gp.axes || []).length >= 2 || (gp.buttons || []).length >= 6;
  const pressed = (gp, i) => { const b = gp.buttons && gp.buttons[i]; return !!(b && (b.pressed || b.value > 0.5)); };
  function pickPad() {
    const ps = pads(); let live = null, shaped = null;
    for (const gp of ps) {
      if (!shaped && looksReal(gp)) shaped = gp;
      if (!live && (gp.buttons || []).some((b) => b && (b.pressed || b.value > 0.5))) { live = gp; chosen = gp.index + ":" + gp.id; }
    }
    if (chosen) { const c = ps.find((gp) => gp.index + ":" + gp.id === chosen); if (c) return c; }
    return live || shaped || ps[0] || null;
  }
  function hatDirs(v) {
    if (v > 1.05 || v < -1.05) return null; // centred hats park out of range
    const d = Math.round((v + 1) * 3.5);
    return { up: d === 7 || d === 0 || d === 1, right: d >= 1 && d <= 3, down: d >= 3 && d <= 5, left: d >= 5 && d <= 7 };
  }
  function readPad(gp) {
    const A = gp.axes || [], m = map();
    if (lastKey !== gp.index + ":" + gp.id) { lastKey = gp.index + ":" + gp.id; axRest = null; }
    if (axRest === null && A.length) axRest = A.slice();
    const usable = (i) => axRest && Math.abs(axRest[i] || 0) < 0.35;
    const out = { left: pressed(gp, 14), right: pressed(gp, 15), up: pressed(gp, 12), down: pressed(gp, 13) };
    for (const [ax, ay] of [[0, 1], [2, 3]]) {
      if (A.length > ay) {
        if (usable(ax)) { if (A[ax] < -0.5) out.left = true; if (A[ax] > 0.5) out.right = true; }
        if (usable(ay)) { if (A[ay] < -0.5) out.up = true; if (A[ay] > 0.5) out.down = true; }
      }
    }
    for (let i = 0; i < A.length; i++) { if (axRest && Math.abs(axRest[i] || 0) > 1.05) { const h = hatDirs(A[i]); if (h) ["left", "right", "up", "down"].forEach((k) => { if (h[k]) out[k] = true; }); } }
    const any = (arr) => (arr || []).some((i) => pressed(gp, i));
    out.jump = any(m.jump); out.attack = any(m.attack); out.power = any(m.power); out.pause = any(m.pause);
    return out;
  }

  function sendKey(type, code) {
    const [kc, key] = KEYDEF[code];
    const e = new KeyboardEvent(type, { code, key, bubbles: true, cancelable: true });
    Object.defineProperty(e, "keyCode", { get: () => kc }); Object.defineProperty(e, "which", { get: () => kc });
    e.ahoyPad = true;
    window.dispatchEvent(e);
  }
  function emit(ev) { listeners.forEach((fn) => { try { fn(ev, state); } catch (_) {} }); }

  function poll() {
    requestAnimationFrame(poll);
    const gp = pickPad();
    if (!gp || state.remapping) {
      if (!gp && state.active) { releaseAll(); state.active = false; emit("disconnect"); }
      return;
    }
    const now = readPad(gp);
    if (!state.active && Object.values(now).some(Boolean)) { state.active = true; state.name = String(gp.id || "Controller"); emit("connect"); }
    if (!state.active) return;
    for (const a of Object.keys(ACTION_KEY)) {
      if (now[a] && !state.held[a]) sendKey("keydown", ACTION_KEY[a]);
      else if (!now[a] && state.held[a]) sendKey("keyup", ACTION_KEY[a]);
      state.held[a] = now[a];
    }
    if (dbgEl) dbgEl.textContent = gp.id + "\nbuttons: " + (gp.buttons || []).map((b, i) => (b.pressed || b.value > 0.5 ? i : null)).filter((x) => x !== null).join(",") + "\naxes: " + (gp.axes || []).map((v, i) => i + ":" + v.toFixed(2)).join(" ");
  }
  function releaseAll() { for (const a of Object.keys(state.held)) if (state.held[a]) sendKey("keyup", ACTION_KEY[a]); state.held = {}; }

  // Press-to-bind remap, as a page overlay (it must read raw buttons while the game ignores them).
  function remap(done) {
    const gp0 = pickPad(); if (!gp0) return done && done(false);
    releaseAll(); state.remapping = true;
    const el = document.createElement("div");
    el.style.cssText = "position:fixed;inset:0;z-index:50;background:rgba(43,27,18,.94);color:#ffcd77;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;font:44px 'Pirata One',Georgia,serif;padding:24px";
    el.innerHTML = '<div class="q"></div><div style="font:28px \'Just Another Hand\',cursive;color:#f3e2b8;margin-top:14px">press the button on your controller</div><div class="s" style="font:26px \'Just Another Hand\',cursive;margin-top:26px;text-decoration:underline;cursor:pointer">skip (keep default)</div><div class="r" style="font:26px \'Just Another Hand\',cursive;margin-top:12px;color:#ff9a9a;text-decoration:underline;cursor:pointer">reset to default and close</div>';
    document.body.appendChild(el);
    const steps = [["JUMP", "jump"], ["CUTLASS", "attack"], ["PIRATE POWER", "power"], ["PAUSE", "pause"]];
    const res = {}; let si = 0, wasDown = true;
    const q = el.querySelector(".q");
    const end = (ok) => { state.remapping = false; el.remove(); done && done(ok); };
    const next = () => { si++; if (si >= steps.length) { padMap = res; try { localStorage.setItem(MAP_KEY, JSON.stringify(res)); } catch (_) {} q.textContent = "Saved!"; setTimeout(() => end(true), 900); } else q.textContent = "Press the button for " + steps[si][0]; };
    el.querySelector(".s").onclick = () => { if (si < steps.length) { res[steps[si][1]] = DEFAULT_MAP[steps[si][1]]; next(); } };
    el.querySelector(".r").onclick = () => { padMap = null; try { localStorage.removeItem(MAP_KEY); } catch (_) {} end(true); };
    q.textContent = "Press the button for " + steps[0][0];
    (function loop() {
      if (!state.remapping) return;
      const gp = pickPad(); if (!gp) return end(false);
      if (si < steps.length) {
        const i = (gp.buttons || []).findIndex((b) => b && (b.pressed || b.value > 0.5));
        if (i < 0) wasDown = false;
        else if (!wasDown) { wasDown = true; if (!Object.values(res).some((arr) => arr.includes(i))) { res[steps[si][1]] = [i]; next(); } }
      }
      requestAnimationFrame(loop);
    })();
  }

  window.addEventListener("gamepadconnected", () => { axRest = null; });
  window.addEventListener("gamepaddisconnected", () => { if (!pickPad()) { releaseAll(); state.active = false; emit("disconnect"); } });
  if (navigator.getGamepads) requestAnimationFrame(poll);
  if (DEBUG) window.addEventListener("load", () => { dbgEl = document.createElement("pre"); dbgEl.style.cssText = "position:fixed;right:6px;bottom:6px;z-index:60;background:#000c;color:#9fd4ff;font:11px monospace;padding:6px;margin:0"; document.body.appendChild(dbgEl); });

  AHOY.Input = {
    pad: () => state,
    onPad: (fn) => listeners.push(fn),
    offPad: (fn) => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); },
    remap,
    sendKey, // test hook: replay a key exactly as a controller press would
  };

  // ── Menu navigation ──
  const NAV_DIRS = { ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0], ArrowUp: [0, -1], KeyW: [0, -1], ArrowDown: [0, 1], KeyS: [0, 1] };
  const depthOf = (o) => { let d = o.depth || 0, p = o.parentContainer; while (p) { d = Math.max(d, p.depth || 0); p = p.parentContainer; } return d; };
  const alive = (t) => t.obj && t.obj.active && t.obj.scene && t.obj.visible !== false && (!t.obj.parentContainer || t.obj.parentContainer.active);
  function sceneTargets(scene) {
    const list = (scene.__nav || []).filter(alive);
    scene.__nav = list;
    if (!list.length) return [];
    const top = Math.max(...list.map((t) => depthOf(t.obj)));
    return list.filter((t) => depthOf(t.obj) === top); // an open overlay owns the highlight
  }
  function activeScene() {
    const g = window.__AHOY_GAME; if (!g) return null;
    const scenes = g.scene.getScenes(true);
    for (let i = scenes.length - 1; i >= 0; i--) {
      const s = scenes[i], off = typeof s.navOff === "function" ? s.navOff() : s.navOff;
      if (!off && sceneTargets(s).length) return s;
    }
    return null;
  }
  const centre = (t) => { const b = t.obj.getBounds(); return { x: b.centerX, y: b.centerY, b }; };
  function drawRing(scene, t) {
    if (!scene.__navRing || !scene.__navRing.active) scene.__navRing = scene.add.graphics().setDepth(5000);
    const g = scene.__navRing.clear();
    if (!t) return;
    const { b } = centre(t);
    g.setScrollFactor(t.obj.scrollFactorX ?? 1);
    g.lineStyle(6, 0xffcd77, 1).strokeRoundedRect(b.x - 8, b.y - 8, b.width + 16, b.height + 16, 14);
    g.lineStyle(2, 0x2b1b12, 1).strokeRoundedRect(b.x - 11, b.y - 11, b.width + 22, b.height + 22, 16);
  }
  function move(scene, dx, dy) {
    const ts = sceneTargets(scene);
    let cur = ts.find((t) => t === scene.__navFocus);
    if (!cur) { scene.__navFocus = ts[0]; drawRing(scene, ts[0]); return; }
    const c = centre(cur); let best = null, bestScore = Infinity;
    for (const t of ts) {
      if (t === cur) continue;
      const p = centre(t), vx = p.x - c.x, vy = p.y - c.y, along = vx * dx + vy * dy;
      if (along <= 4) continue;
      const score = along + 2.2 * Math.abs(vx * dy - vy * dx);
      if (score < bestScore) { bestScore = score; best = t; }
    }
    if (best) { scene.__navFocus = best; drawRing(scene, best); AHOY.Audio && AHOY.Audio.play("click"); }
  }
  window.addEventListener("keydown", (e) => {
    if (state.remapping) return;
    const scene = activeScene(); if (!scene) return;
    const dir = NAV_DIRS[e.code];
    if (dir) { move(scene, dir[0], dir[1]); return; }
    if (e.code === "Enter" || e.code === "Space") {
      const ts = sceneTargets(scene), cur = ts.find((t) => t === scene.__navFocus);
      if (!cur) { if (e.code === "Space" && e.ahoyPad) { scene.__navFocus = ts[0]; drawRing(scene, ts[0]); } return; } // the A button's first press shows the highlight
      e.stopImmediatePropagation(); e.preventDefault(); // the focused button answers, not the scene's own Space/Enter handler
      drawRing(scene, null); scene.__navFocus = null;
      cur.press();
    }
  }, true);

  AHOY.Nav = {
    add(scene, obj, press) { (scene.__nav = scene.__nav || []).push({ obj, press }); return obj; },
    // A crosshair for the tap-to-whack mini-games, so keys and pads can play them too.
    cursor(scene) {
      const cur = scene.add.container(640, 360).setDepth(4000).setAlpha(0);
      const g = scene.add.graphics(); g.lineStyle(5, 0xffffff, 1).strokeCircle(0, 0, 34).lineBetween(-48, 0, -18, 0).lineBetween(18, 0, 48, 0).lineBetween(0, -48, 0, -18).lineBetween(0, 18, 0, 48);
      g.lineStyle(2, 0x2b1b12, 1).strokeCircle(0, 0, 38);
      cur.add(g);
      const keys = scene.input.keyboard.addKeys("LEFT,RIGHT,UP,DOWN,A,D,W,S");
      const hit = () => {
        cur.setAlpha(1);
        const objs = scene.children.list.filter((o) => o.input && o.input.enabled && o.active && o.getBounds && o.getBounds().contains(cur.x, cur.y));
        objs.forEach((o) => o.emit("pointerdown", scene.input.activePointer));
        scene.tweens.add({ targets: cur, scale: 0.8, duration: 70, yoyo: true });
      };
      scene.input.keyboard.on("keydown-SPACE", hit); scene.input.keyboard.on("keydown-X", hit);
      return (dt) => {
        let vx = 0, vy = 0;
        if (keys.LEFT.isDown || keys.A.isDown) vx = -1; if (keys.RIGHT.isDown || keys.D.isDown) vx = 1;
        if (keys.UP.isDown || keys.W.isDown) vy = -1; if (keys.DOWN.isDown || keys.S.isDown) vy = 1;
        if (vx || vy) { cur.setAlpha(1); cur.x = Phaser.Math.Clamp(cur.x + vx * 760 * dt, 30, 1250); cur.y = Phaser.Math.Clamp(cur.y + vy * 760 * dt, 90, 700); }
      };
    },
  };

  // ── The Controls panel: drawn from AHOY.CONTROLS ──
  AHOY.ControlsPanel = {
    open(scene, onClose) {
      const UI = AHOY.UI;
      const L = scene.add.container(0, 0).setDepth(4500).setScrollFactor(0);
      L.add(scene.add.rectangle(640, 360, 1280, 720, 0x000000, 0.6).setScrollFactor(0).setInteractive());
      L.add(UI.panel(scene, 640, 370, 1180, 600).setScrollFactor(0));
      L.add(UI.title(scene, 640, 112, "CONTROLS", 56).setScrollFactor(0));
      const cols = [250, 640, 900, 1135], heads = ["", "Keyboard", "Controller", "Touch"];
      heads.forEach((h, i) => h && L.add(UI.text(scene, cols[i], 172, h, 34, "#7a1f12").setScrollFactor(0)));
      AHOY.CONTROLS.forEach((r, i) => {
        const y = 222 + i * 52;
        L.add(UI.text(scene, 80, y, r.action, 28, "#2b1b12", { ox: 0, wrap: 330 }).setScrollFactor(0));
        L.add(UI.text(scene, cols[1], y, r.keys, 28, "#2b1b12").setScrollFactor(0));
        L.add(UI.text(scene, cols[2], y, r.pad, 28, "#2b1b12").setScrollFactor(0));
        L.add(UI.text(scene, cols[3], y, r.touch, 28, "#2b1b12").setScrollFactor(0));
      });
      const p = AHOY.Input.pad();
      const status = UI.text(scene, 640, 552, "", 28, "#3d2a1f", { wrap: 1000 }).setScrollFactor(0); L.add(status);
      const remapBtn = UI.button(scene, 520, 618, "REMAP CONTROLLER", () => AHOY.Input.remap(() => paint()), { w: 330, h: 60, size: 32 });
      const closeBtn = UI.button(scene, 820, 618, "CLOSE", () => { AHOY.Input.offPad(onPad); L.destroy(); onClose && onClose(); }, { w: 200, h: 60, size: 34, fill: 0xc0392b });
      [remapBtn, closeBtn].forEach((b) => { b.setScrollFactor(0); L.add(b); });
      const paint = () => {
        const s = AHOY.Input.pad();
        status.setText(s.active ? "🎮 " + s.name.slice(0, 48) + " is connected." : "No controller yet. Plug in a USB or Bluetooth controller and press any button on it.");
        remapBtn.setAlpha(s.active ? 1 : 0.4);
      };
      const onPad = () => paint();
      AHOY.Input.onPad(onPad); paint();
      return L;
    },
  };
})();
