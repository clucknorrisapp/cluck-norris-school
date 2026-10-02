// AHOY: PumpFunPirates — the island platformer.
// LevelBuilder turns an island's chunk string (data.js) into a spec; LevelScene builds it with
// Arcade physics and runs the pirate, the powers, enemies, secrets, checkpoints and the boss.
(function () {
  const UI = AHOY.UI;
  const U = 64, GY = 592;

  AHOY.buildLayout = function (layout) {
    const s = { grounds: [], planks: [], movers: [], ghosts: [], blocks: [], rings: [], walls: [], enemies: [], coins: [], chests: [],
      urchins: [], barrels: [], checkpoints: [], piece: null, exit: null, boss: null, secrets: 0, width: 0 };
    let x = 0;
    const ground = (x0, w) => s.grounds.push({ x: x0, w });
    const coinRow = (x0, n, y) => { for (let i = 0; i < n; i++) s.coins.push({ x: x0 + U / 2 + i * U, y }); };
    for (const tok of String(layout).trim().split(/\s+/)) {
      let m;
      if ((m = /^(Fc|F|G|P|M|U)(\d+)$/.exec(tok))) {
        const n = +m[2], w = n * U;
        if (m[1] === "F") { ground(x, w); x += w; }
        else if (m[1] === "Fc") { ground(x, w); coinRow(x, n, GY - 60); x += w; }
        else if (m[1] === "G") { x += w; }
        else if (m[1] === "P") {
          let px = x + U * 0.5, k = 0;
          while (px < x + w - U * 1.5) { const y = GY - 110 - (k % 2) * 60; s.planks.push({ x: px, y, w: 2 * U }); s.coins.push({ x: px + U, y: y - 50 }); px += 3 * U; k++; }
          x += w;
        } else if (m[1] === "M") {
          const mw = 160, minX = x + U * 0.5, maxX = Math.max(minX + 40, x + w - U * 0.5 - mw);
          s.movers.push({ x: minX, y: GY - 90, w: mw, minX, maxX, speed: 110 });
          coinRow(x + U, Math.max(1, n - 2), GY - 170);
          x += w;
        } else if (m[1] === "U") {
          ground(x, (n + 4) * U);
          s.urchins.push({ x: x + 2 * U, w: n * U });
          for (let i = 0; i < n; i++) s.coins.push({ x: x + 2 * U + U / 2 + i * U, y: GY - 160 });
          if (n >= 5) s.planks.push({ x: x + 2 * U + (n * U) / 2 - U, y: GY - 120, w: 2 * U });
          x += (n + 4) * U;
        }
        continue;
      }
      if ((m = /^E:(\w+)$/.exec(tok))) {
        ground(x, 7 * U);
        const type = m[1];
        s.enemies.push({ type, x: x + 3.5 * U, y: type === "gull" ? GY - 170 : GY - 40, minX: x + U, maxX: x + 6 * U });
        x += 7 * U; continue;
      }
      switch (tok) {
        case "S": {
          ground(x, 9 * U);
          [1, 2, 3, 2, 1].forEach((h, i) => { s.blocks.push({ x: x + (2 + i) * U, y: GY - h * U, w: U, h: h * U }); s.coins.push({ x: x + (2.5 + i) * U, y: GY - h * U - 40 }); });
          x += 9 * U; break;
        }
        case "Br": ground(x, 4 * U); s.barrels.push({ x: x + 1.5 * U }, { x: x + 2.6 * U }); x += 4 * U; break;
        case "C": ground(x, 3 * U); s.chests.push({ x: x + 1.5 * U, y: GY, secret: false }); x += 3 * U; break;
        case "K": ground(x, 2 * U); s.checkpoints.push({ x: x + U }); x += 2 * U; break;
        case "MP": ground(x, 3 * U); s.piece = { x: x + 1.5 * U, y: GY - 80 }; x += 3 * U; break;
        case "H": {
          ground(x, 9 * U);
          const steps = [[x + U, GY - 140], [x + 3.5 * U, GY - 250], [x + 6 * U, GY - 360]];
          steps.forEach(([sx, sy]) => { s.ghosts.push({ x: sx, y: sy, w: 2 * U }); s.coins.push({ x: sx + U, y: sy - 46 }); });
          s.chests.push({ x: x + 7 * U, y: GY - 360, secret: "ghost" });
          s.secrets++; x += 9 * U; break;
        }
        case "R": {
          ground(x, 9 * U);
          s.blocks.push({ x: x + 5.5 * U, y: GY - 330, w: 3 * U, h: 32 });
          s.rings.push({ x: x + 4 * U, y: GY - 440 });
          s.chests.push({ x: x + 7 * U, y: GY - 330, secret: "grapple" });
          s.secrets++; x += 9 * U; break;
        }
        case "W": {
          ground(x, 10 * U);
          s.walls.push({ x: x + 4 * U, y: GY - 136, w: U, h: 136 });
          s.blocks.push({ x: x + 5 * U, y: GY - 136, w: 4 * U, h: 32 });
          s.blocks.push({ x: x + 8 * U, y: GY - 104, w: U, h: 104 });
          s.chests.push({ x: x + 6.5 * U, y: GY, secret: "wall" });
          s.secrets++; x += 10 * U; break;
        }
        case "X": ground(x, 7 * U); s.exit = { x: x + 4 * U }; x += 7 * U; break;
        case "BOSS": ground(x, 20 * U); s.boss = { x0: x, x1: x + 20 * U }; x += 20 * U; break;
        default: console.warn("unknown chunk", tok);
      }
    }
    ground(x, 4 * U); x += 4 * U;
    s.width = x;
    return s;
  };

  class LevelScene extends Phaser.Scene {
    constructor() { super({ key: "Level", physics: { arcade: { gravity: { y: 1500 }, debug: false } } }); }
    init(d) {
      this.seaIdx = d.sea; this.islIdx = d.island;
      this.sea = AHOY.SEAS[d.sea]; this.isl = this.sea.islands[d.island];
      this.pirate = AHOY.currentPirate();
      this.state = { hp: 3, coins: 0, secretsFound: 0, piece: false, done: false, invulnUntil: 0, dashUntil: 0, attackCd: 0, powerCd: 0,
        ghostUntil: 0, xrayUntil: 0, grappling: false, facing: 1, coyote: 0, jumpBuf: 0, startedAt: 0, respawn: { x: 2 * U, y: GY - 80 }, paused: false };
    }

    create() {
      this.cameras.main.fadeIn(300);
      const spec = this.spec = AHOY.buildLayout(this.isl.layout);
      const W = spec.width;
      this.physics.world.setBounds(0, -400, W, 1400);
      this.physics.world.setBoundsCollision(true, true, false, false);

      // Background, parallax so its right edge meets the level's end.
      const bg = this.add.image(0, 0, "bg-" + this.isl.bg).setOrigin(0, 0).setDepth(-20);
      const sc = 760 / bg.height; bg.setScale(sc);
      const bgW = bg.width * sc;
      bg.setScrollFactor(W > 1280 ? Phaser.Math.Clamp((bgW - 1280) / (W - 1280), 0, 1) : 0, 0);
      this.add.rectangle(0, 0, 1280, 720, 0x000000, 0.08).setOrigin(0).setScrollFactor(0).setDepth(-19);
      this.water = this.add.tileSprite(0, 668, W, 64, "water").setOrigin(0, 0).setDepth(2);

      // Solids.
      this.solids = this.physics.add.staticGroup();
      spec.grounds.forEach((g) => { const t = this.add.tileSprite(g.x, GY, g.w, 128, "ground-" + this.isl.ground).setOrigin(0, 0).setDepth(5); this.physics.add.existing(t, true); this.solids.add(t); });
      spec.blocks.forEach((b) => { const t = this.add.tileSprite(b.x, b.y, b.w, b.h, "block").setOrigin(0, 0).setDepth(5); this.physics.add.existing(t, true); this.solids.add(t); });
      this.oneway = this.physics.add.staticGroup();
      spec.planks.forEach((p) => { const t = this.add.tileSprite(p.x, p.y, p.w, 24, "plank").setOrigin(0, 0).setDepth(6); this.physics.add.existing(t, true); this.oneway.add(t); });
      this.ghosts = this.physics.add.staticGroup();
      spec.ghosts.forEach((p) => { const t = this.add.tileSprite(p.x, p.y, p.w, 24, "ghost").setOrigin(0, 0).setDepth(6).setAlpha(0.1); this.physics.add.existing(t, true); t.body.enable = false; this.ghosts.add(t); });
      this.movers = [];
      spec.movers.forEach((m) => {
        const t = this.add.tileSprite(m.x, m.y, m.w, 24, "plank").setOrigin(0, 0).setDepth(6);
        this.physics.add.existing(t); t.body.setAllowGravity(false).setImmovable(true); t.body.setVelocityX(m.speed);
        t.minX = m.minX; t.maxX = m.maxX; t.speed = m.speed; this.movers.push(t);
      });
      this.walls = this.physics.add.staticGroup();
      spec.walls.forEach((w) => { const t = this.add.tileSprite(w.x, w.y, w.w, w.h, "crackwall").setOrigin(0, 0).setDepth(6); this.physics.add.existing(t, true); this.walls.add(t); });
      this.rings = spec.rings.map((r) => { const im = this.add.image(r.x, r.y, "ring").setDepth(7); this.tweens.add({ targets: im, scale: 1.15, duration: 600, yoyo: true, repeat: -1 }); return im; });
      this.urchins = this.physics.add.staticGroup();
      spec.urchins.forEach((u) => { const t = this.add.tileSprite(u.x, GY - 30, u.w, 32, "urchin").setOrigin(0, 0).setDepth(7); this.physics.add.existing(t, true); this.urchins.add(t); });

      // Pickups.
      this.coins = this.physics.add.staticGroup();
      spec.coins.forEach((c) => { const im = this.coins.create(c.x, c.y, "item-coin").setScale(0.26).setDepth(8); im.refreshBody(); this.tweens.add({ targets: im, scaleX: 0.08, duration: 420, yoyo: true, repeat: -1, delay: (c.x % 400) }); });
      this.chests = this.physics.add.staticGroup();
      spec.chests.forEach((c) => { const im = this.chests.create(c.x, c.y, "item-chest").setOrigin(0.5, 1).setScale(0.45).setDepth(8); im.refreshBody(); im.secret = c.secret; });
      this.barrels = this.physics.add.staticGroup();
      spec.barrels.forEach((b) => { const im = this.barrels.create(b.x, GY, "item-barrel").setOrigin(0.5, 1).setScale(0.45).setDepth(8); im.refreshBody(); });
      if (spec.piece) {
        this.piece = this.physics.add.staticImage(spec.piece.x, spec.piece.y, "item-map-piece").setScale(0.4).setDepth(9); this.piece.refreshBody();
        this.tweens.add({ targets: this.piece, y: spec.piece.y - 12, duration: 800, yoyo: true, repeat: -1, ease: "Sine.inOut" });
        if (AHOY.Save.island(this.isl.id).piece) this.piece.setAlpha(0.45);
      }
      this.flags = spec.checkpoints.map((k) => this.add.image(k.x, GY, "flag").setOrigin(0.5, 1).setDepth(7));
      if (spec.exit) {
        if (this.isl.treasure) { this.exitObj = this.add.image(spec.exit.x, GY + 4, "xmark").setOrigin(0.5, 1).setScale(0.8).setDepth(7); this.tweens.add({ targets: this.exitObj, scale: 0.9, duration: 600, yoyo: true, repeat: -1 }); }
        else { this.exitObj = this.add.image(spec.exit.x, GY + 70, "dock").setOrigin(0.5, 1).setDepth(7); this.add.image(spec.exit.x + 120, GY - 20, "ship").setScale(0.3).setDepth(4); }
        this.add.image(spec.exit.x - 60, GY, "flag-red").setOrigin(0.5, 1).setDepth(7);
      }

      // The pirate: an invisible physics body + the sprite drawn on top of it.
      this.player = this.physics.add.sprite(this.state.respawn.x, this.state.respawn.y, "px").setDepth(20);
      this.player.body.setSize(44, 92, true).setMaxVelocity(900, 1100);
      this.pv = this.add.image(0, 0, this.pirate.sprite).setOrigin(0.5, 1).setDepth(21);
      this.pvScale = 112 / this.pv.height; this.pv.setScale(this.pvScale);
      if (this.pirate.portrait) { // NFT holders: a crest with their NFT over the pirate
        const key = this.textures.exists(this.pirate.portrait) ? this.pirate.portrait : "nft-demo";
        this.crest = this.add.image(0, 0, key).setDisplaySize(40, 40).setDepth(22);
      }
      this.rope = this.add.graphics().setDepth(19);

      // Enemies.
      this.enemies = [];
      spec.enemies.forEach((e) => this.spawnEnemy(e));

      // Colliders.
      this.physics.add.collider(this.player, this.solids);
      this.wallCollider = this.physics.add.collider(this.player, this.walls, null, () => !this.wallsOpen(), this);
      const oneWay = (pl, plat) => pl.body.velocity.y >= 0 && pl.body.bottom - pl.body.deltaY() <= plat.body.top + 10;
      this.physics.add.collider(this.player, this.oneway, null, oneWay, this);
      this.physics.add.collider(this.player, this.ghosts, null, oneWay, this);
      this.movers.forEach((m) => this.physics.add.collider(this.player, m, null, oneWay, this));
      this.physics.add.overlap(this.player, this.coins, (_, c) => { c.destroy(); this.state.coins++; AHOY.Audio.play("coin"); this.hudCoins(); });
      this.physics.add.overlap(this.player, this.chests, (_, c) => this.openChest(c));
      this.physics.add.overlap(this.player, this.urchins, () => this.hurt(true));
      if (this.piece) this.physics.add.overlap(this.player, this.piece, () => this.getPiece());

      // Camera.
      this.cameras.main.setBounds(0, 0, W, 720);
      this.cameras.main.startFollow(this.player, true, 0.12, 0.12, -120, 60);
      this.cameras.main.setDeadzone(120, 160);

      // Input.
      this.keys = this.input.keyboard.addKeys("LEFT,RIGHT,UP,DOWN,SPACE,A,D,W,S,X,J,C,K,Z,ESC,P,SHIFT");
      this.touch = { left: false, right: false, jump: false, attack: false, power: false };
      if (UI.isTouch()) this.makeTouch();
      this.input.keyboard.on("keydown-ESC", () => this.togglePause());
      this.input.keyboard.on("keydown-P", () => this.togglePause());

      this.makeHud();
      this.banner(this.isl.name, this.pirate.powerName + ": press C / ★ to use · X / ⚔ to attack");
      this.state.startedAt = this.time.now;
      AHOY.Audio.music(true);
      if (spec.boss) this.bossSpec = spec.boss;
      window.__AHOY_LEVEL = this; // test hook (headless playthrough)
    }

    // ── Enemies ──
    spawnEnemy(e) {
      const body = this.physics.add.sprite(e.x, e.y, "px").setDepth(15);
      const cfg = { crab: { w: 62, h: 44, sp: 70, hp: 1, h0: 64, tex: "crab" }, skel: { w: 44, h: 90, sp: 95, hp: 2, h0: 112, tex: "skeleton" }, gull: { w: 64, h: 40, sp: 120, hp: 1, h0: 70, tex: "gull" } }[e.type] || { w: 60, h: 44, sp: 70, hp: 1, h0: 64, tex: "crab" };
      body.body.setSize(cfg.w, cfg.h, true);
      const vis = this.add.image(e.x, e.y, cfg.tex).setOrigin(0.5, 1).setDepth(16);
      vis.setScale(cfg.h0 / vis.height);
      const en = { body, vis, type: e.type, hp: cfg.hp, minX: e.minX, maxX: e.maxX, sp: cfg.sp, dir: -1, baseY: e.y, t: Math.random() * 6, dead: false, scale: vis.scaleX };
      en.colliders = [];
      if (e.type === "gull") body.body.setAllowGravity(false);
      else en.colliders.push(this.physics.add.collider(body, this.solids));
      en.colliders.push(this.physics.add.overlap(this.player, body, () => this.touchEnemy(en)));
      this.enemies.push(en);
      return en;
    }
    killEnemy(en, how) {
      if (en.dead) return; en.dead = true; (en.colliders || []).forEach((c) => c.destroy()); en.body.destroy();
      AHOY.Audio.play(how === "stomp" ? "stomp" : "slash");
      this.tweens.add({ targets: en.vis, angle: 180, y: en.vis.y + 120, alpha: 0, duration: 450, onComplete: () => en.vis.destroy() });
      this.state.coins += 2; this.hudCoins(); this.popText(en.vis.x, en.vis.y - 60, "+2");
    }
    damageEnemy(en, how) { if (en.dead) return; en.hp--; if (en.hp <= 0) this.killEnemy(en, how); else { AHOY.Audio.play("slash"); en.vis.setTint(0xff8888); this.time.delayedCall(150, () => en.vis.active && en.vis.clearTint()); en.body.body.setVelocityY(-250); } }
    touchEnemy(en) {
      if (en.dead || this.state.done) return;
      const p = this.player.body;
      if (this.time.now < this.state.dashUntil) return this.killEnemy(en, "dash");
      if (p.velocity.y > 60 && p.bottom - en.body.body.top < 26) { this.killEnemy(en, "stomp"); p.setVelocityY(-560); return; }
      this.hurt(false, en.body.x);
    }

    // ── Player ──
    hurt(spike, fromX) {
      const s = this.state;
      if (s.done || this.time.now < s.invulnUntil || this.time.now < s.dashUntil) return;
      s.hp--; s.invulnUntil = this.time.now + 1300;
      AHOY.Audio.play("hit"); this.cameras.main.shake(180, 0.008);
      const dir = fromX != null ? Math.sign(this.player.x - fromX) || -s.facing : -s.facing;
      this.player.body.setVelocity(dir * 320, spike ? -620 : -420);
      this.hudHearts();
      if (s.hp <= 0) this.wipeout("Shipwrecked!");
    }
    wipeout(msg) {
      const s = this.state;
      const lost = Math.min(s.coins, 5); s.coins -= lost;
      this.banner(msg, lost ? `Lost ${lost} coins · back to the last flag` : "Back to the last flag");
      s.hp = 3; s.invulnUntil = this.time.now + 1500; s.grappling = false; this.player.body.moves = true; this.player.body.setAllowGravity(true);
      this.player.body.reset(s.respawn.x, s.respawn.y);
      this.hudHearts(); this.hudCoins();
    }
    openChest(c) {
      if (c.opened) return; c.opened = true;
      c.setTexture("item-chest-open"); AHOY.Audio.play("chest");
      const n = c.secret ? 15 : 8; this.state.coins += n; if (c.secret) this.state.secretsFound++;
      this.hudCoins(); this.popText(c.x, c.y - 110, (c.secret ? "SECRET! " : "") + "+" + n);
      for (let i = 0; i < 10; i++) { const sp = this.add.image(c.x, c.y - 40, "spark").setDepth(30); this.tweens.add({ targets: sp, x: c.x + Phaser.Math.Between(-90, 90), y: c.y - Phaser.Math.Between(60, 180), alpha: 0, duration: 700, onComplete: () => sp.destroy() }); }
    }
    getPiece() {
      if (this.state.piece) return; this.state.piece = true;
      AHOY.Audio.play("piece");
      this.tweens.killTweensOf(this.piece);
      this.tweens.add({ targets: this.piece, scale: 1.2, alpha: 0, y: this.piece.y - 80, duration: 700, onComplete: () => this.piece.destroy() });
      this.banner("MAP PIECE!", "A torn corner of the treasure map");
      this.hudPiece.setAlpha(1).clearTint();
    }
    wallsOpen() { return this.time.now < this.state.xrayUntil; }

    // Powers: ghost (reveal planks), grapple (rings), xray (fake walls), dash (break walls, invulnerable).
    usePower() {
      const s = this.state;
      if (this.time.now < s.powerCd || s.done) return;
      const p = this.pirate.power;
      if (p === "ghost") {
        s.ghostUntil = this.time.now + 6500; s.powerCd = this.time.now + 7000; AHOY.Audio.play("power");
        this.ghosts.getChildren().forEach((g) => { g.body.enable = true; g.setAlpha(1); });
        this.cameras.main.flash(160, 160, 120, 255);
      } else if (p === "xray") {
        s.xrayUntil = this.time.now + 6500; s.powerCd = this.time.now + 7000; AHOY.Audio.play("power");
        this.walls.getChildren().forEach((w) => w.setAlpha(0.3));
        this.cameras.main.flash(160, 255, 80, 80);
      } else if (p === "dash") {
        s.dashUntil = this.time.now + 320; s.powerCd = this.time.now + 1300; AHOY.Audio.play("power");
        this.player.body.setAllowGravity(false); this.player.body.setVelocity(s.facing * 920, 0);
        this.time.delayedCall(320, () => { if (!s.grappling) this.player.body.setAllowGravity(true); });
      } else if (p === "grapple") {
        const ring = this.rings.filter((r) => r.active && r.y < this.player.y && Phaser.Math.Distance.Between(r.x, r.y, this.player.x, this.player.y) < 380)
          .sort((a, b) => Phaser.Math.Distance.Between(a.x, a.y, this.player.x, this.player.y) - Phaser.Math.Distance.Between(b.x, b.y, this.player.x, this.player.y))[0];
        if (!ring) { this.popText(this.player.x, this.player.y - 90, "No ring in reach"); s.powerCd = this.time.now + 400; return; }
        s.powerCd = this.time.now + 900; s.grappling = true; AHOY.Audio.play("power");
        const b = this.player.body; b.moves = false; b.setVelocity(0, 0);
        this.tweens.add({ targets: this.player, x: ring.x, y: ring.y + 72, duration: 360, ease: "Quad.out",
          onUpdate: () => { this.rope.clear().lineStyle(4, 0x2b1b12, 1).lineBetween(this.player.x, this.player.y - 30, ring.x, ring.y); },
          onComplete: () => { this.rope.clear(); b.reset(this.player.x, this.player.y); b.moves = true; s.grappling = false; b.setVelocity(s.facing * 240, -520); } });
      }
      this.hudPower();
    }
    attack() {
      const s = this.state;
      if (this.time.now < s.attackCd || s.done) return;
      s.attackCd = this.time.now + 330; AHOY.Audio.play("slash");
      const hx = this.player.x + s.facing * 60, hy = this.player.y - 10;
      const arc = this.add.graphics().setDepth(25); arc.lineStyle(8, 0xffffff, 0.9);
      arc.beginPath(); arc.arc(this.player.x, this.player.y - 20, 70, s.facing > 0 ? -1.2 : Math.PI - 0.4, s.facing > 0 ? 0.4 : Math.PI + 1.2); arc.strokePath();
      this.tweens.add({ targets: arc, alpha: 0, duration: 160, onComplete: () => arc.destroy() });
      this.tweens.add({ targets: this.pv, angle: s.facing * 14, duration: 80, yoyo: true });
      const hit = new Phaser.Geom.Rectangle(hx - 50, hy - 55, 100, 110);
      this.hitArea(hit);
      if (this.pirate.laser) this.fireLaser();
    }
    hitArea(rect) {
      this.enemies.forEach((en) => { if (!en.dead && Phaser.Geom.Intersects.RectangleToRectangle(rect, en.body.getBounds())) this.damageEnemy(en, "slash"); });
      this.barrels.getChildren().slice().forEach((br) => { if (Phaser.Geom.Intersects.RectangleToRectangle(rect, br.getBounds())) this.smashBarrel(br); });
      if (this.boss) this.bossHit(rect);
    }
    smashBarrel(br) {
      AHOY.Audio.play("stomp"); const x = br.x, y = br.y; br.destroy();
      for (let i = 0; i < 3; i++) { const c = this.coins.create(x - 30 + i * 30, y - 120, "item-coin").setScale(0.26).setDepth(8); c.refreshBody(); }
    }
    fireLaser() {
      const s = this.state; const b = this.add.image(this.player.x + s.facing * 40, this.player.y - 48, "laser").setDepth(26).setFlipX(s.facing < 0);
      this.tweens.add({ targets: b, x: b.x + s.facing * 520, duration: 380, onUpdate: () => {
        const r = b.getBounds(); this.enemies.forEach((en) => { if (!en.dead && Phaser.Geom.Intersects.RectangleToRectangle(r, en.body.getBounds())) this.damageEnemy(en, "laser"); });
        this.walls.getChildren().slice().forEach((w) => { if (Phaser.Geom.Intersects.RectangleToRectangle(r, w.getBounds())) this.breakWall(w); });
        if (this.boss) this.bossHit(r);
      }, onComplete: () => b.destroy() });
    }
    breakWall(w) {
      AHOY.Audio.play("boom"); this.cameras.main.shake(160, 0.01);
      for (let i = 0; i < 8; i++) { const d = this.add.rectangle(w.x + 32, w.y + 60, 16, 16, 0xa0927c).setDepth(30); this.tweens.add({ targets: d, x: d.x + Phaser.Math.Between(-120, 120), y: d.y + Phaser.Math.Between(-80, 80), angle: 200, alpha: 0, duration: 600, onComplete: () => d.destroy() }); }
      w.destroy();
    }

    // ── Boss: the Rug Kraken ──
    startBoss() {
      const b = this.bossSpec; this.bossStarted = true;
      this.cameras.main.stopFollow(); this.cameras.main.pan(b.x0 + 640, 360, 700, "Sine.easeInOut");
      this.physics.world.setBounds(b.x0, -400, b.x1 - b.x0, 1400); this.physics.world.setBoundsCollision(true, true, false, false);
      const k = this.add.image(b.x0 + 1080, 330, "kraken-boss").setDepth(3).setAlpha(0); k.setScale(420 / k.height);
      this.tweens.add({ targets: k, alpha: 1, y: 300, duration: 900 });
      this.tweens.add({ targets: k, y: 285, duration: 1600, yoyo: true, repeat: -1, ease: "Sine.inOut", delay: 900 });
      this.boss = { img: k, hp: 10, max: 10, tentacles: [], next: this.time.now + 1800, rugNext: this.time.now + 4200 };
      this.bossBar = this.add.graphics().setScrollFactor(0).setDepth(900);
      this.bossLabel = UI.text(this, 640, 104, "THE RUG KRAKEN", 34, "#ffffff", { stroke: "#2b1b12", strokeThickness: 6 }).setScrollFactor(0).setDepth(901);
      this.banner("THE RUG KRAKEN!", "Hit the tentacles when they slam down. Jump the rugs!");
      AHOY.Audio.play("boom");
      this.drawBossBar();
    }
    drawBossBar() {
      const b = this.boss; this.bossBar.clear().fillStyle(0x2b1b12, 1).fillRoundedRect(390, 120, 500, 26, 10).fillStyle(0x9c27b0, 1).fillRoundedRect(394, 124, 492 * Math.max(0, b.hp) / b.max, 18, 8);
    }
    bossTick() {
      const b = this.boss; if (!b || b.dead) return;
      const now = this.time.now;
      if (now > b.next) {
        b.next = now + Math.max(1300, 2400 - (b.max - b.hp) * 110);
        const tx = Phaser.Math.Clamp(this.player.x + Phaser.Math.Between(-80, 80), this.bossSpec.x0 + 80, this.bossSpec.x1 - 260);
        const warn = this.add.ellipse(tx, GY + 6, 130, 26, 0xff2222, 0.45).setDepth(8);
        this.tweens.add({ targets: warn, alpha: 0.85, duration: 180, yoyo: true, repeat: 2 });
        this.time.delayedCall(850, () => {
          warn.destroy(); if (b.dead) return;
          const t = this.add.image(tx, -40, "tentacle").setOrigin(0.5, 1).setDepth(12).setFlipY(true); t.setScale(300 / t.height);
          t.hittable = false;
          this.tweens.add({ targets: t, y: GY + 10, duration: 200, ease: "Quad.in", onComplete: () => {
            AHOY.Audio.play("boom"); this.cameras.main.shake(200, 0.01); t.hittable = true; t.downAt = this.time.now;
            const pb = this.player.body; if (Math.abs(pb.center.x - tx) < 70) this.hurt(false, tx);
            this.time.delayedCall(1700, () => { if (!t.active) return; t.hittable = false; this.tweens.add({ targets: t, y: -60, duration: 300, onComplete: () => t.destroy() }); });
          } });
          b.tentacles.push(t);
        });
      }
      if (now > b.rugNext && b.hp < b.max - 2) {
        b.rugNext = now + Phaser.Math.Between(3200, 4600);
        const rug = this.physics.add.image(this.bossSpec.x1 - 120, GY - 28, "rug").setDepth(12);
        rug.body.setAllowGravity(false).setVelocityX(-380).setAngularVelocity(-360);
        const ov = this.physics.add.overlap(this.player, rug, () => { if (!rug.hitDone) { rug.hitDone = true; this.hurt(false, rug.x); } });
        this.time.delayedCall(4500, () => { ov.destroy(); rug.destroy(); });
      }
      b.tentacles = b.tentacles.filter((t) => t.active);
      // Stomping a tentacle that's down counts as a hit.
      const pb = this.player.body;
      b.tentacles.forEach((t) => { if (t.hittable && pb.velocity.y > 100 && Math.abs(pb.center.x - t.x) < 50 && pb.bottom > t.y - 300 && pb.bottom < t.y - 150) { this.hitTentacle(t); pb.setVelocityY(-620); } });
    }
    bossHit(rect) {
      if (!this.boss || this.boss.dead) return;
      this.boss.tentacles.forEach((t) => { if (t.active && t.hittable && Phaser.Geom.Intersects.RectangleToRectangle(rect, t.getBounds())) this.hitTentacle(t); });
    }
    hitTentacle(t) {
      const b = this.boss; t.hittable = false; b.hp--; AHOY.Audio.play("stomp"); this.drawBossBar();
      b.img.setTint(0xff7777); this.time.delayedCall(160, () => b.img.active && b.img.clearTint());
      this.tweens.add({ targets: t, y: -60, duration: 260, onComplete: () => t.destroy() });
      if (b.hp <= 0) this.bossDown();
    }
    bossDown() {
      const b = this.boss; b.dead = true; AHOY.Audio.play("chest");
      this.tweens.add({ targets: b.img, y: 900, angle: 25, duration: 1600, ease: "Quad.in" });
      this.bossBar.destroy(); this.bossLabel.destroy();
      this.banner("KRAKEN DEFEATED!", "The rug is pulled… from under the Kraken. Dig at the X!");
      this.state.coins += 30; this.hudCoins();
      const x = this.bossSpec.x0 + 640;
      this.exitObj = this.add.image(x, GY + 4, "xmark").setOrigin(0.5, 1).setScale(0.8).setDepth(7);
      this.spec.exit = { x };
    }

    // ── Touch controls ──
    makeTouch() {
      this.input.addPointer(3);
      const btn = (x, y, r, label, key) => {
        const c = this.add.circle(x, y, r, 0x2b1b12, 0.45).setScrollFactor(0).setDepth(1000).setStrokeStyle(4, 0xffcd77, 0.8).setInteractive();
        UI.text(this, x, y, label, r * 0.9, "#ffffff").setScrollFactor(0).setDepth(1001);
        c.on("pointerdown", () => { this.touch[key] = true; if (key === "jump") this.state.jumpBuf = this.time.now + 140; if (key === "attack") this.attack(); if (key === "power") this.usePower(); });
        const up = () => { this.touch[key] = false; };
        c.on("pointerup", up); c.on("pointerout", up);
      };
      btn(95, 630, 62, "◀", "left"); btn(245, 630, 62, "▶", "right");
      btn(1180, 620, 70, "⤒", "jump"); btn(1035, 655, 54, "⚔", "attack"); btn(1060, 515, 50, "★", "power");
    }

    // ── HUD ──
    makeHud() {
      const d = 900;
      const bar = this.add.graphics().setScrollFactor(0).setDepth(d); bar.fillStyle(0x2b1b12, 0.75).fillRoundedRect(12, 10, 470, 64, 14);
      this.hearts = [0, 1, 2].map((i) => this.add.image(46 + i * 46, 42, "item-heart").setScale(0.24).setScrollFactor(0).setDepth(d + 1));
      this.add.image(200, 42, "item-coin").setScale(0.24).setScrollFactor(0).setDepth(d + 1);
      this.coinText = UI.text(this, 226, 42, "0", 36, "#ffcd77", { ox: 0 }).setScrollFactor(0).setDepth(d + 1);
      this.hudPiece = this.add.image(330, 42, "item-map-piece").setScale(0.26).setScrollFactor(0).setDepth(d + 1).setAlpha(0.35).setTint(0x555555);
      if (AHOY.Save.island(this.isl.id).piece) this.hudPiece.setAlpha(0.8).clearTint();
      this.powerText = UI.text(this, 420, 42, "★", 34, "#ffffff", { stroke: "#2b1b12", strokeThickness: 5 }).setScrollFactor(0).setDepth(d + 1);
      this.secretText = UI.text(this, 640, 30, `Secrets 0/${this.spec.secrets}`, 28, "#ffffff", { stroke: "#2b1b12", strokeThickness: 5 }).setScrollFactor(0).setDepth(d + 1);
      if (this.pirate.portrait) UI.text(this, 640, 60, this.pirate.name + (this.pirate.laser ? " · LASER EYES" : ""), 22, "#ffcd77", { stroke: "#2b1b12", strokeThickness: 4 }).setScrollFactor(0).setDepth(d + 1);
      const pause = UI.text(this, 1170, 40, "❚❚", 36, "#ffffff", { stroke: "#2b1b12", strokeThickness: 6 }).setScrollFactor(0).setDepth(d + 1).setInteractive({ useHandCursor: true });
      pause.on("pointerup", () => this.togglePause());
      UI.muteButton(this);
    }
    hudCoins() { this.coinText && this.coinText.setText(String(this.state.coins)); this.secretText && this.secretText.setText(`Secrets ${this.state.secretsFound}/${this.spec.secrets}`); }
    hudHearts() { this.hearts.forEach((h, i) => h.setAlpha(i < this.state.hp ? 1 : 0.2)); }
    hudPower() {
      const left = Math.max(0, this.state.powerCd - this.time.now);
      this.powerText.setText(left > 0 ? "★ " + Math.ceil(left / 1000) : "★ " + this.pirate.powerName).setColor(left > 0 ? "#aaaaaa" : "#ffffff");
    }
    banner(title, sub) {
      const c = this.add.container(640, 200).setScrollFactor(0).setDepth(950).setAlpha(0);
      c.add(UI.title(this, 0, 0, title, 64));
      if (sub) c.add(UI.text(this, 0, 56, sub, 30, "#ffffff", { stroke: "#2b1b12", strokeThickness: 6, wrap: 1000 }));
      this.tweens.add({ targets: c, alpha: 1, duration: 250, yoyo: true, hold: 1800, onComplete: () => c.destroy() });
    }
    popText(x, y, str) {
      const t = UI.text(this, x, y, str, 32, "#ffcd77", { stroke: "#2b1b12", strokeThickness: 6 }).setDepth(40);
      this.tweens.add({ targets: t, y: y - 50, alpha: 0, duration: 800, onComplete: () => t.destroy() });
    }
    togglePause() {
      if (this.state.done) return;
      if (this.pauseLayer) { this.pauseLayer.destroy(); this.pauseLayer = null; this.physics.resume(); this.tweens.resumeAll(); this.state.paused = false; return; }
      this.physics.pause(); this.tweens.pauseAll(); this.state.paused = true;
      const L = this.pauseLayer = this.add.container(0, 0).setScrollFactor(0).setDepth(3000);
      L.add(this.add.rectangle(640, 360, 1280, 720, 0x000000, 0.55).setScrollFactor(0));
      L.add(UI.panel(this, 640, 360, 520, 400).setScrollFactor(0));
      L.add(UI.title(this, 640, 220, "PAUSED", 60).setScrollFactor(0));
      const b1 = UI.button(this, 640, 310, "RESUME", () => this.togglePause(), { w: 280, h: 62, size: 34 });
      const b2 = UI.button(this, 640, 390, "RESTART ISLAND", () => { this.tweens.resumeAll(); this.scene.restart({ sea: this.seaIdx, island: this.islIdx }); }, { w: 280, h: 62, size: 30 });
      const b3 = UI.button(this, 640, 470, "BACK TO MAP", () => { this.tweens.resumeAll(); this.scene.start("Map", { sea: this.seaIdx }); }, { w: 280, h: 62, size: 30 });
      [b1, b2, b3].forEach((b) => { b.setScrollFactor(0); L.add(b); });
    }

    // ── Finish ──
    finish() {
      const s = this.state; if (s.done) return; s.done = true;
      this.player.body.setVelocity(0, 0); this.player.body.moves = false;
      const time = (this.time.now - s.startedAt) / 1000;
      AHOY.Save.completeIsland(this.isl.id, { piece: s.piece, booty: s.coins, secrets: s.secretsFound, time });
      AHOY.Audio.play("chest");
      if (this.isl.treasure) { this.cameras.main.fadeOut(400); this.cameras.main.once("camerafadeoutcomplete", () => this.scene.start("Dig", { sea: this.seaIdx, island: this.islIdx, coins: s.coins })); return; }
      const L = this.add.container(0, 0).setScrollFactor(0).setDepth(3000);
      L.add(this.add.rectangle(640, 360, 1280, 720, 0x000000, 0.5).setScrollFactor(0));
      L.add(UI.panel(this, 640, 360, 640, 420).setScrollFactor(0));
      L.add(UI.title(this, 640, 200, "ISLAND PLUNDERED!", 56).setScrollFactor(0));
      const rows = [`Booty: +${s.coins}`, `Secrets: ${s.secretsFound}/${this.spec.secrets}`, s.piece ? "Map piece: FOUND ✔" : (AHOY.Save.island(this.isl.id).piece ? "Map piece: already charted" : "Map piece: missed — come back for it!"), `Time: ${time.toFixed(1)}s`];
      rows.forEach((r, i) => L.add(UI.text(this, 640, 270 + i * 46, r, 36, "#2b1b12").setScrollFactor(0)));
      if (s.secretsFound < this.spec.secrets) L.add(UI.text(this, 640, 452, "Some secrets need another pirate's power…", 26, "#7a1f12").setScrollFactor(0));
      const b = UI.button(this, 640, 520, "BACK TO THE MAP", () => this.scene.start("Map", { sea: this.seaIdx }), { w: 340, h: 64, size: 34 }); b.setScrollFactor(0); L.add(b);
      this.input.keyboard.once("keydown-ENTER", () => this.scene.start("Map", { sea: this.seaIdx }));
    }

    update(t, dms) {
      const s = this.state; if (s.paused) return;
      const dt = Math.min(dms, 50) / 1000;
      this.water.tilePositionX += 40 * dt;
      // Movers bounce between their bounds.
      this.movers.forEach((m) => { if (m.x <= m.minX) m.body.setVelocityX(m.speed); else if (m.x >= m.maxX) m.body.setVelocityX(-m.speed); });
      // Timed powers expire.
      if (s.ghostUntil && t > s.ghostUntil) { s.ghostUntil = 0; this.ghosts.getChildren().forEach((g) => { g.body.enable = false; g.setAlpha(0.1); }); }
      if (s.xrayUntil && t > s.xrayUntil) { s.xrayUntil = 0; this.walls.getChildren().forEach((w) => w.setAlpha(1)); }
      if (s.dashUntil > t) this.walls.getChildren().slice().forEach((w) => { if (Math.abs(w.x + 32 - this.player.x) < 70 && Math.abs(w.y + 68 - this.player.y) < 110) this.breakWall(w); });
      this.hudPower();

      const k = this.keys, b = this.player.body;
      if (!s.done && !s.grappling) {
        const left = k.LEFT.isDown || k.A.isDown || this.touch.left, right = k.RIGHT.isDown || k.D.isDown || this.touch.right;
        const onGround = b.blocked.down || b.touching.down;
        if (onGround) s.coyote = t + 110;
        const target = (right ? 1 : 0) - (left ? 1 : 0);
        if (t >= s.dashUntil) {
          const accel = onGround ? 2600 : 1700, max = 330;
          if (target) { b.setVelocityX(Phaser.Math.Clamp(b.velocity.x + target * accel * dt, -max, max)); s.facing = target; }
          else b.setVelocityX(b.velocity.x * (onGround ? 0.72 : 0.95));
          const ice = this.isl.ground === "ice" && onGround; if (ice && !target) b.setVelocityX(b.velocity.x / 0.72 * 0.93);
        }
        if (Phaser.Input.Keyboard.JustDown(k.SPACE) || Phaser.Input.Keyboard.JustDown(k.UP) || Phaser.Input.Keyboard.JustDown(k.W) || Phaser.Input.Keyboard.JustDown(k.Z)) s.jumpBuf = t + 140;
        if (s.jumpBuf > t && s.coyote > t) { b.setVelocityY(-720); s.jumpBuf = 0; s.coyote = 0; AHOY.Audio.play("jump"); }
        const jumpHeld = k.SPACE.isDown || k.UP.isDown || k.W.isDown || k.Z.isDown || this.touch.jump;
        if (!jumpHeld && b.velocity.y < -260) b.setVelocityY(b.velocity.y * 0.85); // short hop
        if (Phaser.Input.Keyboard.JustDown(k.X) || Phaser.Input.Keyboard.JustDown(k.J)) this.attack();
        if (Phaser.Input.Keyboard.JustDown(k.C) || Phaser.Input.Keyboard.JustDown(k.K) || Phaser.Input.Keyboard.JustDown(k.SHIFT)) this.usePower();
      }
      // Draw the pirate on its body: bob while running, squash in the air, flash when hurt.
      const running = Math.abs(b.velocity.x) > 40 && (b.blocked.down || b.touching.down);
      const bob = running ? Math.abs(Math.sin(t / 70)) * 6 : 0;
      this.pv.setPosition(b.center.x, b.bottom + 2 - bob).setFlipX(s.facing < 0);
      const air = !(b.blocked.down || b.touching.down);
      this.pv.setScale(this.pvScale * (air ? 0.94 : 1) * (s.facing < 0 ? 1 : 1), this.pvScale * (air ? 1.06 : 1));
      this.pv.setAngle(s.dashUntil > t ? s.facing * 18 : running ? Math.sin(t / 90) * 4 : 0);
      this.pv.setAlpha(t < s.invulnUntil ? (Math.floor(t / 80) % 2 ? 0.35 : 1) : 1);
      if (this.crest) this.crest.setPosition(b.center.x - s.facing * 26, b.bottom - 98);

      // Enemies.
      this.enemies.forEach((en) => {
        if (en.dead) return;
        const eb = en.body.body;
        if (en.body.x < en.minX) en.dir = 1; else if (en.body.x > en.maxX) en.dir = -1;
        eb.setVelocityX(en.dir * en.sp);
        if (en.type === "gull") { en.t += dt * 2.4; en.body.y = en.baseY + Math.sin(en.t) * 50; }
        en.vis.setPosition(en.body.x, eb.bottom + 2).setFlipX(en.type === "skel" ? en.dir < 0 : en.dir > 0);
        if (en.type === "crab") en.vis.setAngle(Math.sin(t / 80) * 5);
      });

      // Checkpoints, exit, pits, boss.
      this.flags.forEach((f, i) => { if (!f.reached && Math.abs(this.player.x - f.x) < 40) { f.reached = true; f.setTexture("flag-red"); s.respawn = { x: f.x, y: GY - 80 }; AHOY.Audio.play("good"); this.popText(f.x, GY - 120, "Checkpoint!"); } });
      if (this.spec.exit && !s.done && this.exitObj && Math.abs(this.player.x - this.spec.exit.x) < 50 && b.bottom > GY - 30) this.finish();
      if (this.bossSpec && !this.bossStarted && this.player.x > this.bossSpec.x0 + 160) this.startBoss();
      if (this.boss) this.bossTick();
      if (this.player.y > 800 && !s.done) { s.hp = Math.max(0, s.hp - 1); this.hudHearts(); AHOY.Audio.play("hit"); if (s.hp <= 0) this.wipeout("Shipwrecked!"); else { this.banner("SPLASH!", "Back to the last flag"); b.reset(s.respawn.x, s.respawn.y); s.invulnUntil = t + 1200; } }
    }
  }

  AHOY.LevelScene = LevelScene;
})();
