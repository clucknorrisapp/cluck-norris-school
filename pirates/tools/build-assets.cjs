#!/usr/bin/env node
// Download the Higgsfield art listed in art-sources.json and compress it into public/assets.
//   bg/*.jpg     1920x1080 (cover)        card/*.jpg  1280x720
//   ui/*.jpg     1920x1080                sprite/*.png trimmed to the subject, max 512px
//   sprite/pose/*.png  pirate pose frames, trimmed, max 360px
// Raw downloads are cached in tools/.cache (gitignored), so a rerun only re-encodes.
// Usage: node pirates/tools/build-assets.cjs
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const SRC = require("./art-sources.json");
const OUT = path.join(__dirname, "..", "public", "assets");
const CACHE = path.join(__dirname, ".cache");
fs.mkdirSync(CACHE, { recursive: true });

async function fetchCached(file) {
  const p = path.join(CACHE, file);
  if (fs.existsSync(p) && fs.statSync(p).size > 1000) return p;
  const r = await fetch(SRC.base + file);
  if (!r.ok) throw new Error(`download ${file}: HTTP ${r.status}`);
  fs.writeFileSync(p, Buffer.from(await r.arrayBuffer()));
  return p;
}

async function main() {
  const jobs = [];
  for (const [group, entries] of Object.entries(SRC)) {
    if (typeof entries !== "object" || group.startsWith("_")) continue;
    for (const [name, file] of Object.entries(entries)) jobs.push({ group, name, file });
  }
  let total = 0;
  for (const j of jobs) {
    const raw = await fetchCached(j.file);
    const dir = path.join(OUT, j.group);
    fs.mkdirSync(dir, { recursive: true });
    let out;
    if (j.group.startsWith("sprite")) {
      out = path.join(dir, j.name + ".png");
      // items is a 3x3 icon sheet: keep it whole (sliced by cutItems below).
      if (j.name === "items") await sharp(raw).resize(1024, 1024, { fit: "inside" }).png({ compressionLevel: 9, palette: true }).toFile(out);
      else await sharp(raw).trim({ threshold: 4 }).resize(j.group === "sprite/pose" ? 360 : 512, j.group === "sprite/pose" ? 360 : 512, { fit: "inside", withoutEnlargement: true }).png({ compressionLevel: 9, palette: true, quality: 90 }).toFile(out);
    } else {
      out = path.join(dir, j.name + ".jpg");
      const [w, h] = j.group === "card" ? [1280, 720] : [1920, 1080];
      await sharp(raw).resize(w, h, { fit: "cover" }).jpeg({ quality: 78, mozjpeg: true }).toFile(out);
    }
    const sz = fs.statSync(out).size; total += sz;
    console.log(`${j.group}/${path.basename(out)}  ${(sz / 1024).toFixed(0)} KB`);
  }
  await cutItems();
  console.log(`total ${(total / 1024 / 1024).toFixed(1)} MB`);
}

// Slice the 3x3 item sheet into separate trimmed icons by finding each cell's opaque bounds.
async function cutItems() {
  const sheet = path.join(OUT, "sprite", "items.png");
  if (!fs.existsSync(sheet)) return;
  const names = ["coin", "chest", "chest-open", "map-piece", "barrel", "key", "heart", "wheel", "shovel"];
  const meta = await sharp(sheet).metadata();
  const cw = Math.floor(meta.width / 3), ch = Math.floor(meta.height / 3);
  for (let i = 0; i < 9; i++) {
    const left = (i % 3) * cw, top = Math.floor(i / 3) * ch;
    const out = path.join(OUT, "sprite", "item-" + names[i] + ".png");
    try {
      const cell = await sharp(sheet).extract({ left, top, width: cw, height: ch }).png().toBuffer();
      await sharp(cell).trim({ threshold: 4 }).resize(160, 160, { fit: "inside" }).png({ compressionLevel: 9 }).toFile(out);
      console.log("sprite/" + path.basename(out));
    } catch (e) { console.warn("item cut failed", names[i], e.message); }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
