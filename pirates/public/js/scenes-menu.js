// AHOY: PumpFunPirates — Boot, Title, Crew select, and the Holder panel.
window.AHOY = window.AHOY || {};
const UI = AHOY.UI;

class BootScene extends Phaser.Scene {
  constructor() { super("Boot"); }
  preload() {
    const W = 1280, H = 720;
    const bar = this.add.graphics(), box = this.add.graphics();
    box.fillStyle(0x2b1b12, 1).fillRoundedRect(W / 2 - 260, H / 2 - 22, 520, 44, 12);
    const label = this.add.text(W / 2, H / 2 - 60, "Hoisting the sails…", { fontFamily: UI.FONT_TITLE, fontSize: "40px", color: "#ffcd77" }).setOrigin(0.5);
    this.load.on("progress", (p) => { bar.clear().fillStyle(0xfa0d0d, 1).fillRoundedRect(W / 2 - 252, H / 2 - 14, 504 * p, 28, 8); });
    this.load.on("complete", () => label.setText("All aboard!"));
    const A = "assets/";
    const bgs = new Set(); AHOY.SEAS.forEach((s) => s.islands.forEach((i) => bgs.add(i.bg)));
    bgs.forEach((k) => this.load.image("bg-" + k, A + "bg/" + k + ".jpg"));
    ["sea-chart", "title"].forEach((k) => this.load.image("ui-" + k, A + "ui/" + k + ".jpg"));
    Object.keys(AHOY.MISHAPS).forEach((k) => this.load.image("card-" + k, A + "card/" + k + ".jpg"));
    ["pirate-visor", "pirate-hook", "pirate-3d", "pirate-shades", "crab", "gull", "skeleton", "kraken-boss", "ship", "island", "tentacle", "nft-demo",
      "item-coin", "item-chest", "item-chest-open", "item-map-piece", "item-barrel", "item-key", "item-heart", "item-wheel", "item-shovel"]
      .forEach((k) => this.load.image(k, A + "sprite/" + k + ".png"));
    // Pose frames per pirate (side view, facing right): two run frames, jump, duck, cutlass swing.
    AHOY.CREW.forEach((c) => AHOY.POSES.forEach((p) => this.load.image(c.sprite + "-" + p, A + "sprite/pose/" + c.sprite + "-" + p + ".png")));
    // Holders' own NFTs (live mode): their images, so the HUD and crew screen can show them.
    this.load.setCORS("anonymous");
    (AHOY.Gate.state().nfts || []).forEach((n) => { if (n.image && !/nft-demo/.test(n.image)) this.load.image("nft-" + n.id, n.image); });
    this.load.on("loaderror", (f) => console.warn("asset failed", f && f.key));
  }
  create() {
    AHOY.Textures.make(this);
    // The demo NFT's portrait key matches currentPirate()'s "nft-<id>".
    if (this.textures.exists("nft-demo")) this.textures.addImage("nft-demo-16", this.textures.get("nft-demo").getSourceImage());
    this.scene.start("Title");
  }
}

// Procedural textures: ground tiles, planks, rings, cracked walls, particles. Flat cartoon, thick outline.
AHOY.Textures = {
  make(scene) {
    const g = scene.make.graphics({ x: 0, y: 0, add: false });
    const tile = (key, top, body, line, deco) => {
      g.clear();
      g.fillStyle(body, 1).fillRect(0, 0, 64, 128);
      if (deco) deco(g);
      g.fillStyle(top, 1).fillRect(0, 0, 64, 22);
      g.fillStyle(0xffffff, 0.18).fillRect(0, 2, 64, 6);
      g.lineStyle(5, line, 1).lineBetween(0, 22, 64, 22);
      g.lineStyle(6, 0x2b1b12, 1).lineBetween(0, 1, 64, 1);
      g.generateTexture("ground-" + key, 64, 128);
    };
    tile("sand", 0xf7d88f, 0xe2ac5c, 0xc78c3c, (g) => { g.fillStyle(0xcf9a4c, 1); [[10, 50], [40, 80], [22, 105], [52, 40]].forEach(([x, y]) => g.fillCircle(x, y, 4)); });
    tile("grass", 0x63c23f, 0x9a6237, 0x3f8a25, (g) => { g.fillStyle(0x7f4e2a, 1); [[12, 60], [44, 92], [30, 40]].forEach(([x, y]) => g.fillCircle(x, y, 6)); });
    tile("wood", 0xb57a43, 0x8a5530, 0x5c3519, (g) => { g.lineStyle(3, 0x5c3519, 1); [46, 74, 102].forEach((y) => g.lineBetween(0, y, 64, y)); g.lineBetween(30, 22, 30, 46); g.lineBetween(14, 46, 14, 74); g.lineBetween(48, 74, 48, 102); });
    tile("stone", 0xa7a39a, 0x7d786f, 0x55514a, (g) => { g.lineStyle(3, 0x55514a, 1); [52, 84, 116].forEach((y) => g.lineBetween(0, y, 64, y)); g.lineBetween(20, 22, 20, 52); g.lineBetween(46, 52, 46, 84); g.lineBetween(14, 84, 14, 116); });
    tile("ice", 0xe6f7ff, 0x9fd6f0, 0x5aa9d0, (g) => { g.lineStyle(3, 0xffffff, 0.7); g.lineBetween(8, 40, 28, 70); g.lineBetween(40, 60, 56, 96); });
    tile("coral", 0xff8fb1, 0xd9577f, 0xa8345b, (g) => { g.fillStyle(0xffc2d4, 1); [[14, 56], [46, 88], [30, 112]].forEach(([x, y]) => g.fillCircle(x, y, 5)); });

    // Plank (floating platform), 64x24 tile.
    g.clear(); g.fillStyle(0x2b1b12, 1).fillRect(0, 0, 64, 24); g.fillStyle(0xc08447, 1).fillRect(0, 3, 64, 17);
    g.fillStyle(0xffffff, 0.15).fillRect(0, 4, 64, 4); g.lineStyle(2, 0x5c3519, 1).lineBetween(32, 3, 32, 20);
    g.fillStyle(0x2b1b12, 1).fillCircle(8, 12, 2).fillCircle(56, 12, 2); g.generateTexture("plank", 64, 24);
    // Ghost plank (Visor reveals): pale violet glow.
    g.clear(); g.fillStyle(0x8a5cff, 1).fillRect(0, 0, 64, 24); g.fillStyle(0xd9c8ff, 1).fillRect(0, 3, 64, 17); g.fillStyle(0xffffff, 0.5).fillRect(0, 5, 64, 4);
    g.generateTexture("ghost", 64, 24);
    // Stone block 64x64.
    g.clear(); g.fillStyle(0x2b1b12, 1).fillRect(0, 0, 64, 64); g.fillStyle(0x9b968c, 1).fillRect(3, 3, 58, 58); g.fillStyle(0xffffff, 0.15).fillRect(3, 3, 58, 10);
    g.lineStyle(2, 0x55514a, 1).strokeRect(10, 18, 44, 36); g.generateTexture("block", 64, 64);
    // Cracked wall 64x128.
    g.clear(); g.fillStyle(0x2b1b12, 1).fillRect(0, 0, 64, 128); g.fillStyle(0xa0927c, 1).fillRect(3, 3, 58, 122);
    g.lineStyle(4, 0x2b1b12, 1); g.beginPath(); g.moveTo(32, 6); g.lineTo(22, 40); g.lineTo(40, 64); g.lineTo(18, 96); g.lineTo(34, 122); g.strokePath();
    g.lineBetween(40, 64, 56, 76); g.lineBetween(22, 40, 8, 48); g.generateTexture("crackwall", 64, 128);
    // Grapple ring.
    g.clear(); g.lineStyle(10, 0x2b1b12, 1).strokeCircle(24, 24, 18); g.lineStyle(6, 0xffc93c, 1).strokeCircle(24, 24, 18); g.generateTexture("ring", 48, 48);
    // Urchin spikes 64x32.
    g.clear(); g.fillStyle(0x2b1b12, 1); for (let i = 0; i < 4; i++) g.fillTriangle(i * 16, 32, i * 16 + 8, 2, i * 16 + 16, 32);
    g.fillStyle(0x6a2c91, 1); for (let i = 0; i < 4; i++) g.fillTriangle(i * 16 + 3, 30, i * 16 + 8, 8, i * 16 + 13, 30); g.generateTexture("urchin", 64, 32);
    // Water strip 128x64 with wave crest.
    g.clear(); g.fillStyle(0x1f8fb0, 1).fillRect(0, 10, 128, 54); g.fillStyle(0x6fd3ef, 1);
    for (let i = 0; i < 4; i++) g.fillEllipse(i * 32 + 16, 12, 34, 14); g.fillStyle(0xffffff, 0.6); for (let i = 0; i < 4; i++) g.fillEllipse(i * 32 + 12, 9, 12, 4);
    g.generateTexture("water", 128, 64);
    // Checkpoint flag 48x96 (skull flag).
    g.clear(); g.fillStyle(0x2b1b12, 1).fillRect(4, 0, 6, 96); g.fillStyle(0x111111, 1).fillRect(10, 4, 36, 26); g.fillStyle(0xffffff, 1).fillCircle(28, 15, 6);
    g.generateTexture("flag", 48, 96);
    g.clear(); g.fillStyle(0x2b1b12, 1).fillRect(4, 0, 6, 96); g.fillStyle(0xfa0d0d, 1).fillRect(10, 4, 36, 26); g.fillStyle(0xffffff, 1).fillCircle(28, 15, 6);
    g.generateTexture("flag-red", 48, 96);
    // Dig X 160x60.
    g.clear(); g.lineStyle(18, 0x2b1b12, 1).lineBetween(20, 8, 140, 52).lineBetween(140, 8, 20, 52); g.lineStyle(10, 0xfa0d0d, 1).lineBetween(20, 8, 140, 52).lineBetween(140, 8, 20, 52);
    g.generateTexture("xmark", 160, 60);
    // Dock 192x96.
    g.clear(); g.fillStyle(0x2b1b12, 1).fillRect(0, 20, 192, 22); g.fillStyle(0xb57a43, 1).fillRect(3, 23, 186, 16);
    [10, 90, 170].forEach((x) => { g.fillStyle(0x2b1b12, 1).fillRect(x, 20, 14, 76); g.fillStyle(0x8a5530, 1).fillRect(x + 3, 23, 8, 70); });
    g.generateTexture("dock", 192, 96);
    // Particles + a 1px body.
    g.clear(); g.fillStyle(0xffffff, 1).fillCircle(6, 6, 6); g.generateTexture("dot", 12, 12);
    g.clear(); g.fillStyle(0xffc93c, 1).fillCircle(5, 5, 5); g.generateTexture("spark", 10, 10);
    g.clear(); g.fillStyle(0xffffff, 0).fillRect(0, 0, 4, 4); g.generateTexture("px", 4, 4);
    // Fog puff for the map.
    g.clear(); for (let i = 0; i < 6; i++) { g.fillStyle(0xcfcabd, 0.5); g.fillCircle(60 + Math.cos(i) * 40, 60 + Math.sin(i * 1.7) * 25, 45); }
    g.generateTexture("fog", 120, 120);
    // Laser bolt.
    g.clear(); g.fillStyle(0xff3a3a, 1).fillRoundedRect(0, 0, 60, 12, 6); g.fillStyle(0xffd0d0, 1).fillRoundedRect(6, 3, 48, 6, 3); g.generateTexture("laser", 60, 12);
    // Rolled rug (boss projectile).
    g.clear(); g.fillStyle(0x2b1b12, 1).fillCircle(26, 26, 26); g.fillStyle(0xc81e1e, 1).fillCircle(26, 26, 22); g.lineStyle(4, 0xffc93c, 1).strokeCircle(26, 26, 12);
    g.generateTexture("rug", 52, 52);
    g.destroy();
  },
};

class TitleScene extends Phaser.Scene {
  constructor() { super("Title"); }
  create() {
    this.cameras.main.fadeIn(300);
    UI.cover(this, "ui-title");
    const shade = this.add.graphics(); shade.fillGradientStyle(0x000000, 0x000000, 0x000000, 0x000000, 0.7, 0.7, 0.05, 0.05).fillRect(0, 0, 1280, 300);
    const logo = UI.title(this, 640, 92, "AHOY", 150);
    this.add.text(640, 186, "PumpFunPirates", { fontFamily: UI.FONT_TITLE, fontSize: "54px", color: "#ffffff", stroke: "#fa0d0d", strokeThickness: 8 }).setOrigin(0.5);
    this.tweens.add({ targets: logo, y: 100, duration: 1600, yoyo: true, repeat: -1, ease: "Sine.inOut" });
    const tag = this.add.graphics(); tag.fillStyle(0x2b1b12, 0.82).fillRoundedRect(300, 216, 680, 46, 14);
    UI.text(this, 640, 239, "Sail the Solana seas · find the treasure · don't get rugged", 34, "#ffefc9");

    const save = AHOY.Save.get();
    const started = Object.keys(save.done).length > 0;
    UI.button(this, 640, 470, started ? "CONTINUE VOYAGE" : "SET SAIL", () => UI.fadeTo(this, started ? "Map" : "Select", { first: !started }), { w: 380, h: 84, size: 52, fill: 0xc0392b });
    UI.button(this, 480, 570, "CREW", () => UI.fadeTo(this, "Select"), { w: 220, h: 64, size: 36 });
    UI.button(this, 800, 570, "HOLDERS", () => AHOY.HolderPanel.open(this), { w: 220, h: 64, size: 36 });

    // The real contract address — the only one the game ever shows (a copycat exists).
    const ca = AHOY.CA;
    const caBox = this.add.graphics(); caBox.fillStyle(0x2b1b12, 0.85).fillRoundedRect(330, 636, 620, 44, 12);
    const caText = UI.text(this, 590, 658, "$AHOY  " + ca.slice(0, 6) + "…" + ca.slice(-6), 30, "#ffcd77");
    const copy = UI.text(this, 880, 658, "COPY CA", 28, "#ffffff", { stroke: "#fa0d0d", strokeThickness: 4 }).setInteractive({ useHandCursor: true });
    copy.on("pointerup", async () => {
      try { await navigator.clipboard.writeText(ca); copy.setText("COPIED!"); } catch (_) { copy.setText(ca.slice(0, 10) + "…"); }
      this.time.delayedCall(1400, () => copy.setText("COPY CA"));
    });
    const links = [["Website", AHOY.LINKS.site], ["X", AHOY.LINKS.x], ["Telegram", AHOY.LINKS.tg], ["NFTs", AHOY.LINKS.nfts]];
    links.forEach(([l, href], i) => {
      const t = UI.text(this, 70 + i * 110, 700, l, 26, "#ffffff", { stroke: "#2b1b12", strokeThickness: 4 }).setInteractive({ useHandCursor: true });
      t.on("pointerup", () => AHOY.openLink(href));
    });
    UI.text(this, 1150, 700, "Crafted by Cluck Norris Productions", 22, "#ffefc9", { stroke: "#2b1b12", strokeThickness: 4 });
    if (AHOY.Gate.mode() === "demo") UI.text(this, 1120, 36, "PREVIEW BUILD", 26, "#ffffff", { stroke: "#fa0d0d", strokeThickness: 5 });
    UI.muteButton(this);
    this.input.once("pointerdown", () => { AHOY.Audio.unlock(); AHOY.Audio.music(true); });
    this.input.keyboard.once("keydown", () => { AHOY.Audio.unlock(); AHOY.Audio.music(true); });
    this.input.keyboard.on("keydown-ENTER", () => UI.fadeTo(this, started ? "Map" : "Select", { first: !started }));
  }
}

class SelectScene extends Phaser.Scene {
  constructor() { super("Select"); }
  init(data) { this.first = !!(data && data.first); }
  create() {
    this.cameras.main.fadeIn(250);
    UI.cover(this, "bg-launch-beach");
    this.add.rectangle(640, 360, 1280, 720, 0x000000, 0.35);
    UI.title(this, 640, 64, "CHOOSE YOUR PIRATE", 66);
    const save = AHOY.Save.get();
    const cards = [];
    AHOY.CREW.forEach((c, i) => {
      const x = 190 + i * 300, y = 330;
      const panel = UI.panel(this, x, y, 270, 400);
      const img = this.add.image(x, y - 90, c.sprite); img.setScale(170 / img.height);
      this.tweens.add({ targets: img, y: y - 98, duration: 900 + i * 120, yoyo: true, repeat: -1, ease: "Sine.inOut" });
      UI.text(this, x, y + 22, c.name, 42, "#2b1b12");
      UI.text(this, x, y + 58, "★ " + c.powerName, 32, "#c0392b");
      UI.text(this, x, y + 128, c.blurb, 26, "#3d2a1f", { wrap: 236, style: { lineSpacing: -4 } });
      const zone = this.add.zone(x, y, 270, 400).setInteractive({ useHandCursor: true });
      zone.on("pointerup", () => { AHOY.Audio.unlock(); AHOY.Audio.play("good"); AHOY.Save.set({ crew: c.id, nft: null }); paint(); });
      cards.push({ c, x, y, img });
    });
    const ring = this.add.graphics();
    const paint = () => {
      ring.clear();
      const s = AHOY.Save.get();
      const sel = cards.find((k) => k.c.id === s.crew && !s.nft);
      if (sel) ring.lineStyle(8, 0xfa0d0d, 1).strokeRoundedRect(sel.x - 140, sel.y - 205, 280, 410, 20);
      nftLabel.setText(s.nft ? "Sailing as your NFT: " + (AHOY.currentPirate().nftName || "") : "");
    };
    // Holders: play as your own Pump Fun Pirate.
    const st = AHOY.Gate.state();
    const nftLabel = UI.text(this, 640, 548, "", 30, "#ffcd77", { stroke: "#2b1b12", strokeThickness: 5 });
    if (st.nfts && st.nfts.length) {
      UI.text(this, 300, 600, "Your Pirates:", 32, "#ffffff", { stroke: "#2b1b12", strokeThickness: 5 });
      st.nfts.slice(0, 6).forEach((n, i) => {
        const key = this.textures.exists("nft-" + n.id) ? "nft-" + n.id : "nft-demo";
        const im = this.add.image(430 + i * 90, 600, key).setDisplaySize(76, 76).setInteractive({ useHandCursor: true });
        im.on("pointerup", () => { AHOY.Save.set({ nft: n.id }); AHOY.Audio.play("power"); paint(); });
      });
    } else {
      UI.text(this, 640, 600, "Hold a Pump Fun Pirates NFT to sail as your own pirate — with its traits as powers.", 28, "#ffefc9", { stroke: "#2b1b12", strokeThickness: 4 });
    }
    paint();
    UI.button(this, 1080, 660, "SET SAIL ➜", () => UI.fadeTo(this, "Map"), { w: 260, h: 70, size: 40, fill: 0xc0392b });
    UI.button(this, 160, 660, "◀ BACK", () => UI.fadeTo(this, "Title"), { w: 200, h: 60, size: 32 });
    UI.muteButton(this);
  }
}

// Holder panel: overlay used from Title and Map. Live mode = wallet sign-in; demo mode = labelled preview.
AHOY.HolderPanel = {
  open(scene, onChange) {
    const layer = scene.add.container(0, 0).setDepth(2000).setScrollFactor(0);
    const dim = scene.add.rectangle(640, 360, 1280, 720, 0x000000, 0.6).setInteractive();
    layer.add(dim);
    layer.add(UI.panel(scene, 640, 360, 820, 560));
    layer.add(UI.title(scene, 640, 125, "HOLDERS' WATERS", 56));
    const cfg = AHOY.Gate.config() || { tiers: [] };
    const lines = [
      "Seas 1–2 are free for every pirate.",
      "Jeeter Reef + Cold Storage Glacier — " + AHOY.Gate.needText("deckhand"),
      "Rug Kraken's Deep + Uptober Isles — " + AHOY.Gate.needText("captain"),
      "Captain's Cove + sail as your own pirate — Hold a Pump Fun Pirates NFT",
    ];
    lines.forEach((l, i) => layer.add(UI.text(scene, 640, 200 + i * 48, l, 28, i ? "#3d2a1f" : "#1b6e2a", { wrap: 740 })));
    const st = AHOY.Gate.state();
    const status = UI.text(scene, 640, 410, "", 30, "#c0392b", { wrap: 740 });
    layer.add(status);
    const showState = () => {
      const s = AHOY.Gate.state();
      if (s.demo) status.setText("PREVIEW: holder content unlocked for demonstration — no wallet was checked.");
      else if (s.wallet) status.setText(`Wallet ${s.wallet.slice(0, 4)}…${s.wallet.slice(-4)} · ${Math.floor(s.ahoy).toLocaleString()} AHOY` + (s.usd ? ` (~$${s.usd.toFixed(2)})` : "") + ` · ${s.nfts.length} Pirate NFT${s.nfts.length === 1 ? "" : "s"} · tier: ${s.tier.toUpperCase()}` + (s.unavailable ? " · price feed down, try again soon" : ""));
      else status.setText(AHOY.Gate.mode() === "live" ? "Connect a wallet to check your holdings. You sign one message — no transaction, nothing is sent." : "This is the preview build. Holder checks run on the live game.");
    };
    showState();
    const close = () => { layer.destroy(); onChange && onChange(); };
    if (AHOY.Gate.mode() === "live") {
      const btn = UI.button(scene, 640, 500, st.wallet ? "RE-CHECK WALLET" : "CONNECT WALLET", async () => {
        status.setText("Waiting for your wallet…");
        try { await AHOY.Gate.connectAndVerify(); showState(); AHOY.Audio.play("good"); AHOY.loadNftTextures(scene); }
        catch (e) { status.setText(String((e && e.message) || e)); AHOY.Audio.play("bad"); }
      }, { w: 340, h: 68, size: 36, fill: 0x2e7d32 });
      layer.add(btn);
      if (st.wallet) { const d = UI.button(scene, 640, 575, "DISCONNECT", async () => { await AHOY.Gate.disconnect(); showState(); }, { w: 240, h: 52, size: 28, fill: 0x7a4b2a }); layer.add(d); }
    } else {
      const btn = UI.button(scene, 640, 500, "PREVIEW HOLDER SEAS (DEMO)", () => { AHOY.Gate.demoUnlock(); showState(); AHOY.Audio.play("good"); }, { w: 520, h: 68, size: 34, fill: 0x2e7d32 });
      layer.add(btn);
    }
    const x = UI.text(scene, 1015, 112, "✕", 48, "#2b1b12").setInteractive({ useHandCursor: true });
    x.on("pointerup", close); layer.add(x);
    const done = UI.button(scene, 640, 630, "BACK TO THE SHIP", close, { w: 320, h: 56, size: 30 });
    layer.add(done);
    return layer;
  },
};

// After a live wallet check: pull the holder's NFT images into the texture cache (no reload needed).
AHOY.loadNftTextures = function (scene, done) {
  const todo = (AHOY.Gate.state().nfts || []).filter((n) => n.image && !scene.textures.exists("nft-" + n.id));
  if (!todo.length) return done && done();
  scene.load.setCORS("anonymous");
  todo.forEach((n) => scene.load.image("nft-" + n.id, n.image));
  scene.load.once("complete", () => done && done());
  scene.load.start();
};

AHOY.BootScene = BootScene; AHOY.TitleScene = TitleScene; AHOY.SelectScene = SelectScene;
