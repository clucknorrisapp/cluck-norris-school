// gif-live — instant server-side CUNA GIFs, no browser required.
//
// The gif-forge scenes (tools/gif-forge) render in headless Chromium, which the
// Railway image doesn't ship. This is the in-process counterpart for the LIVE
// meme path: a canvas-2D port of the "hype" scene's beat-synced motion working
// directly on the generated square still (framed as a card — no background
// removal needed), encoded with gifenc. ~2-4s per render on the server.
//
// Brand identity matches tools/gif-forge/brand.css: Luckiest Guy lettering in
// cream #fdf3d8 with the #7a0447 outline on CUNA pink — same committed font file.
const path = require("path");
const { createCanvas, GlobalFonts, loadImage } = require("@napi-rs/canvas");
const { GIFEncoder, quantize, applyPalette } = require("gifenc");

const FONT_PATH = path.join(__dirname, "..", "tools", "gif-forge", "assets", "LuckiestGuy.ttf");
let fontReady = false;
function ensureFont() {
  if (!fontReady) { try { GlobalFonts.registerFromPath(FONT_PATH, "CunaDisplay"); } catch (_) {} fontReady = true; }
}

const TAU = Math.PI * 2;
const HUES = ["#e81088", "#7a2bd6", "#ff5f1f", "#e81088"];
// deterministic per-render randomness (mulberry32) so a given seed reproduces exactly
function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let z = Math.imul(seed ^ seed >>> 15, 1 | seed); z = z + Math.imul(z ^ z >>> 7, 61 | z) ^ z; return ((z ^ z >>> 14) >>> 0) / 4294967296; }; }

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Render the beat-synced "card hype" loop around a square art image.
// art: Buffer|path|URL loadImage accepts. Returns a GIF Buffer.
async function renderCardHypeGif(art, { text = "CUNA", size = 480, frames = 40, delayMs = 38, seed = 777 } = {}) {
  ensureFont();
  const img = await loadImage(art);
  const W = size, H = size, cx = W / 2;
  const canvas = createCanvas(W, H), ctx = canvas.getContext("2d");
  const R = rng(seed);
  const sparks = Array.from({ length: 20 }, () => ({ ang: R() * TAU, rad: (0.30 + R() * 0.24) * W, ph: R() * TAU, spin: R() < 0.5 ? 1 : -1 }));
  const gif = GIFEncoder();

  for (let f = 0; f < frames; f++) {
    const t = f / frames;
    const BEATS = 4, bt = (t * BEATS) % 1, beat = Math.floor(t * BEATS);
    const punch = Math.pow(1 - bt, 3);

    // background
    ctx.globalAlpha = 1;
    const bg = ctx.createRadialGradient(cx, H * 0.42, 0, cx, H * 0.42, W * 0.8);
    bg.addColorStop(0, "#ff2fa0"); bg.addColorStop(0.55, "#e81088"); bg.addColorStop(1, "#b8005f");
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    // camera shake for the whole frame content
    const r1 = rng(beat * 911 + 7);
    ctx.save();
    ctx.translate(cx + (r1() - 0.5) * 0.03 * W * punch, H / 2 + (r1() - 0.5) * 0.03 * H * punch);
    ctx.scale(1 + 0.06 * punch, 1 + 0.06 * punch);
    ctx.rotate((r1() - 0.5) * 0.03 * punch);
    ctx.translate(-cx, -H / 2);

    // rotating rays + counter-rotating burst on the beat
    for (const [alpha, wedge, gap, dir, extra] of [[0.18, 11, 30, 1, 0], [0.5 * punch, 2.5, 15, -1, 5]]) {
      if (alpha < 0.02) continue;
      ctx.save(); ctx.translate(cx, H / 2); ctx.rotate(dir * t * TAU + extra * Math.PI / 180);
      ctx.fillStyle = `rgba(255,255,255,${alpha})`;
      for (let a = 0; a < 360; a += gap) {
        ctx.beginPath(); ctx.moveTo(0, 0);
        ctx.arc(0, 0, W * 1.5, (a * Math.PI) / 180, ((a + wedge) * Math.PI) / 180); ctx.fill();
      }
      ctx.restore();
    }

    // color flash on the beat
    ctx.globalAlpha = 0.45 * punch; ctx.fillStyle = HUES[beat % HUES.length];
    ctx.fillRect(-W, -H, 3 * W, 3 * H); ctx.globalAlpha = 1;

    // orbiting sparks
    ctx.font = `${Math.round(W * 0.045)}px CunaDisplay, sans-serif`; ctx.fillStyle = "#fff";
    for (const s of sparks) {
      const a = s.ang + s.spin * TAU * t;
      ctx.globalAlpha = 0.25 + 0.7 * (0.5 + 0.5 * Math.sin(TAU * t * BEATS + s.ph));
      ctx.fillText("✦", cx + s.rad * Math.cos(a), H / 2 + s.rad * 0.9 * Math.sin(a));
    }
    ctx.globalAlpha = 1;

    // the art card: rounded, shadowed, slamming on the beat
    const cw = W * 0.58 * (1 + 0.16 * punch);
    ctx.save();
    ctx.translate(cx, H * 0.60);
    ctx.rotate(0.10 * Math.sin(TAU * t * 2));
    ctx.shadowColor = "rgba(80,0,40,0.6)"; ctx.shadowBlur = W * 0.03; ctx.shadowOffsetY = W * 0.015;
    roundRectPath(ctx, -cw / 2, -cw / 2, cw, cw, cw * 0.07);
    ctx.fillStyle = "#fdf3d8"; ctx.fill();          // cream frame behind the art
    ctx.shadowColor = "transparent";
    ctx.save();
    roundRectPath(ctx, -cw / 2 + cw * 0.02, -cw / 2 + cw * 0.02, cw * 0.96, cw * 0.96, cw * 0.06);
    ctx.clip();
    ctx.drawImage(img, -cw / 2 + cw * 0.02, -cw / 2 + cw * 0.02, cw * 0.96, cw * 0.96);
    ctx.restore();
    ctx.restore();

    // word slam + expanding echo
    const word = String(text).toUpperCase().slice(0, 12);
    const baseSize = W * 0.185;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.save();                                       // echo ring
    ctx.translate(cx, H * 0.20);
    ctx.scale(1 + 0.8 * bt, 1 + 0.8 * bt);
    ctx.globalAlpha = 0.8 * (1 - bt);
    ctx.font = `${Math.round(baseSize)}px CunaDisplay, sans-serif`;
    ctx.lineWidth = W * 0.008; ctx.strokeStyle = "rgba(253,243,216,0.9)";
    ctx.strokeText(word, 0, 0);
    ctx.restore();
    ctx.save();                                       // the word itself
    ctx.translate(cx, H * 0.20);
    const ws = 1 + 0.3 * punch;
    ctx.scale(ws, ws); ctx.rotate((beat % 2 ? -1 : 1) * 0.04 * punch);
    ctx.font = `${Math.round(baseSize)}px CunaDisplay, sans-serif`;
    if (punch > 0.25) {                               // chromatic split on the hit
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = "rgba(255,0,90,1)"; ctx.fillText(word, W * 0.012 * punch, 0);
      ctx.fillStyle = "rgba(0,220,255,1)"; ctx.fillText(word, -W * 0.012 * punch, 0);
      ctx.globalAlpha = 1;
    }
    ctx.lineWidth = W * 0.018; ctx.strokeStyle = "#7a0447"; ctx.lineJoin = "round";
    ctx.strokeText(word, 0, 0);
    ctx.fillStyle = "#fdf3d8"; ctx.fillText(word, 0, 0);
    ctx.restore();

    ctx.restore();                                    // end camera transform

    // vignette (screen-space, outside the shake)
    const vig = ctx.createRadialGradient(cx, H * 0.46, W * 0.5, cx, H * 0.46, W * 0.85);
    vig.addColorStop(0, "rgba(60,0,40,0)"); vig.addColorStop(1, "rgba(60,0,40,0.42)");
    ctx.fillStyle = vig; ctx.fillRect(0, 0, W, H);

    const { data } = ctx.getImageData(0, 0, W, H);
    const palette = quantize(data, 256);
    gif.writeFrame(applyPalette(data, palette), W, H, { palette, delay: delayMs });
  }
  gif.finish();
  return Buffer.from(gif.bytes());
}

module.exports = { renderCardHypeGif };
