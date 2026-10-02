// AHOY: PumpFunPirates — sea mishaps. One per crossing; each is a 10–16 second mini-game.
// Result is booty won or lost (never below zero), then the ship arrives.
(function () {
  const UI = AHOY.UI;

  class MishapScene extends Phaser.Scene {
    constructor() { super("Mishap"); }
    init(d) { this.d = d; this.key = d.key; this.delta = 0; this.over = false; }
    create() {
      this.cameras.main.fadeIn(200);
      const m = AHOY.MISHAPS[this.key];
      this.cardImg = UI.cover(this, "card-" + this.key);
      this.cardImg.setScale(this.cardImg.scale * 1.15);
      this.tweens.add({ targets: this.cardImg, scale: this.cardImg.scale / 1.15, duration: 700, ease: "Back.out" });
      AHOY.Audio.play(this.key === "storm" ? "thunder" : this.key === "kraken" || this.key === "rival" ? "boom" : "power");
      const intro = this.add.container(0, 0).setDepth(100);
      intro.add(this.add.rectangle(640, 600, 1280, 240, 0x000000, 0.55));
      intro.add(UI.title(this, 640, 545, m.title, 70));
      intro.add(UI.text(this, 640, 615, m.text, 34, "#ffffff", { wrap: 1100 }));
      if (m.how) intro.add(UI.text(this, 640, 665, m.how, 28, "#ffcd77"));
      let went = false;
      const go = () => { if (went) return; went = true; intro.destroy(); this.start(); };
      this.time.delayedCall(2300, go);
      this.input.once("pointerdown", () => this.time.delayedCall(150, go));
      this.input.keyboard.once("keydown", go);
    }
    start() {
      this.started = true;
      this.hud = UI.text(this, 640, 40, "", 40, "#ffffff", { stroke: "#2b1b12", strokeThickness: 7 }).setDepth(50);
      this.timerText = UI.text(this, 1180, 40, "", 40, "#ffcd77", { stroke: "#2b1b12", strokeThickness: 7 }).setDepth(50);
      ({ storm: this.storm, kraken: this.kraken, seagulls: this.gulls, sirens: this.sirens, bottle: this.bottle, rival: this.rival, whirlpool: this.whirl })[this.key].call(this);
    }
    clock(seconds, onEnd) {
      this.left = seconds;
      this.timerText.setText(Math.ceil(this.left) + "s");
      this.clockEv = this.time.addEvent({ delay: 100, loop: true, callback: () => {
        this.left -= 0.1; this.timerText.setText(Math.max(0, Math.ceil(this.left)) + "s");
        if (this.left <= 0) { this.clockEv.remove(); onEnd(); }
      } });
    }

    // ── Storm: steer the ship along the bottom; lightning is telegraphed, then strikes. ──
    storm() {
      this.cardImg.setTint(0x8892b0);
      const ship = this.add.image(640, 600, "ship").setScale(0.3).setDepth(10);
      let hits = 0;
      const keys = this.input.keyboard.createCursorKeys();
      const ak = this.input.keyboard.addKeys("A,D");
      this.hud.setText("Hits: 0");
      this.stepFn = (dt) => {
        let vx = 0;
        if (keys.left.isDown || ak.A.isDown) vx = -1; if (keys.right.isDown || ak.D.isDown) vx = 1;
        const p = this.input.activePointer;
        if (p.isDown) vx = Math.sign(p.x - ship.x) * Math.min(1, Math.abs(p.x - ship.x) / 40);
        ship.x = Phaser.Math.Clamp(ship.x + vx * 560 * dt, 100, 1180); ship.setFlipX(vx < 0);
      };
      const strike = () => {
        if (this.over) return;
        const x = Phaser.Math.Clamp(ship.x + Phaser.Math.Between(-260, 260), 80, 1200);
        const warn = this.add.rectangle(x, 360, 90, 720, 0xffe066, 0.25).setDepth(5);
        this.tweens.add({ targets: warn, alpha: 0.55, duration: 160, yoyo: true, repeat: 2 });
        this.time.delayedCall(850, () => {
          warn.destroy(); if (this.over) return;
          const bolt = this.add.graphics().setDepth(20); bolt.lineStyle(14, 0xfff6a0, 1); bolt.beginPath(); bolt.moveTo(x, 0);
          let yy = 0, xx = x; while (yy < 640) { yy += 70; xx += Phaser.Math.Between(-30, 30); bolt.lineTo(xx, yy); } bolt.strokePath();
          this.cameras.main.flash(120, 255, 255, 220); AHOY.Audio.play("thunder");
          if (Math.abs(ship.x - x) < 80) { hits++; this.delta -= 4; this.hud.setText("Hits: " + hits); this.cameras.main.shake(250, 0.012); AHOY.Audio.play("hit"); }
          this.time.delayedCall(180, () => bolt.destroy());
        });
      };
      this.spawnEv = this.time.addEvent({ delay: 700, loop: true, callback: strike });
      this.clock(13, () => this.finish(hits <= 1 ? 12 : 0, hits <= 1 ? "You threaded the storm!" : `Battered by ${hits} strikes.`));
    }

    // ── Rug Kraken: tentacles pop up around the ship — whack them before they slap. ──
    kraken() {
      this.add.image(640, 470, "ship").setScale(0.34).setDepth(5);
      let whacked = 0, slapped = 0;
      const slots = [[300, 420], [460, 300], [820, 300], [980, 420], [380, 600], [900, 600]];
      this.hud.setText("Whacked: 0");
      const pop = () => {
        if (this.over) return;
        const [x, y] = slots[Phaser.Math.Between(0, slots.length - 1)];
        const t = this.add.image(x, y + 120, "tentacle").setScale(0.36).setDepth(8).setInteractive({ useHandCursor: true });
        this.tweens.add({ targets: t, y, duration: 220, ease: "Back.out" });
        let alive = true;
        t.on("pointerdown", () => {
          if (!alive) return; alive = false; whacked++; this.hud.setText("Whacked: " + whacked); AHOY.Audio.play("stomp");
          this.tweens.add({ targets: t, y: y + 160, alpha: 0, duration: 200, onComplete: () => t.destroy() });
        });
        this.time.delayedCall(1150, () => {
          if (!alive) return; alive = false; slapped++; this.delta -= 2; AHOY.Audio.play("hit"); this.cameras.main.shake(150, 0.008);
          this.tweens.add({ targets: t, angle: -30, y: y + 160, alpha: 0, duration: 260, onComplete: () => t.destroy() });
        });
      };
      this.spawnEv = this.time.addEvent({ delay: 650, loop: true, callback: pop });
      this.clock(14, () => this.finish(whacked >= 10 ? 15 : whacked >= 6 ? 6 : 0, whacked >= 10 ? "The kraken slinks back to the deep!" : `You whacked ${whacked} tentacles.`));
    }

    // ── Jeeter gulls: swat them before they fly off with your booty. ──
    gulls() {
      let swatted = 0, lost = 0;
      this.hud.setText("Swatted: 0");
      const spawn = () => {
        if (this.over) return;
        const fromLeft = Math.random() < 0.5, y = Phaser.Math.Between(140, 520);
        const g = this.add.image(fromLeft ? -80 : 1360, y, "gull").setScale(0.24).setFlipX(fromLeft).setDepth(8).setInteractive({ useHandCursor: true });
        let alive = true;
        this.tweens.add({ targets: g, x: fromLeft ? 1360 : -80, y: y + Phaser.Math.Between(-80, 80), duration: Phaser.Math.Between(1800, 2600), onComplete: () => {
          if (alive) { lost++; this.delta -= 1; } g.destroy();
        } });
        g.on("pointerdown", () => {
          if (!alive) return; alive = false; swatted++; this.hud.setText("Swatted: " + swatted); AHOY.Audio.play("stomp");
          const c = this.add.image(g.x, g.y, "item-coin").setScale(0.2).setDepth(9);
          this.tweens.add({ targets: c, y: c.y + 220, alpha: 0, duration: 600, onComplete: () => c.destroy() });
          this.tweens.killTweensOf(g); this.tweens.add({ targets: g, angle: 200, y: 760, duration: 500, onComplete: () => g.destroy() });
        });
      };
      this.spawnEv = this.time.addEvent({ delay: 520, loop: true, callback: spawn });
      this.clock(13, () => this.finish(swatted >= 12 ? 12 : 3, swatted >= 12 ? "Not a coin lost to the jeeters!" : `${lost} gulls got away with booty.`));
    }

    // ── The Sirens: choose to follow the song or steer away. Two songs. ──
    sirens() {
      this.timerText.setText("");
      const songs = Phaser.Utils.Array.Shuffle(AHOY.SIREN_SONGS.slice()).slice(0, 2);
      let round = 0, wise = 0;
      const layer = this.add.container(0, 0).setDepth(60);
      const ask = () => {
        layer.removeAll(true);
        if (round >= songs.length) return this.finish(wise === 2 ? 14 : wise ? 4 : 0, wise === 2 ? "Ears plugged, course true. Wise captain!" : "The rocks took a bite of your hull.");
        const s = songs[round];
        layer.add(this.add.rectangle(640, 560, 1180, 280, 0x000000, 0.6));
        layer.add(UI.text(this, 640, 460, "The sirens sing:", 30, "#ffcd77"));
        layer.add(UI.text(this, 640, 510, s.song, 44, "#ffd1ec", { wrap: 1100, stroke: "#2b1b12", strokeThickness: 6 }));
        const follow = UI.button(this, 430, 620, "FOLLOW THE SONG", () => answer(false), { w: 360, h: 68, size: 34, fill: 0xb03a7a });
        const away = UI.button(this, 850, 620, "PLUG EARS & STEER AWAY", () => answer(true), { w: 440, h: 68, size: 32, fill: 0x2e7d32 });
        layer.add([follow, away]);
        const answer = (good) => {
          layer.removeAll(true);
          if (good) { wise++; AHOY.Audio.play("good"); } else { this.delta -= 6; AHOY.Audio.play("hit"); this.cameras.main.shake(300, 0.01); }
          layer.add(this.add.rectangle(640, 560, 1180, 280, 0x000000, 0.6));
          layer.add(UI.text(this, 640, 500, good ? "Smart. You sail on." : "CRUNCH! Shipwrecked on the rocks (−6 booty).", 40, good ? "#9effa0" : "#ff8a8a", { wrap: 1100 }));
          layer.add(UI.text(this, 640, 570, s.truth, 32, "#ffffff", { wrap: 1100 }));
          layer.add(UI.button(this, 640, 650, round + 1 < songs.length ? "NEXT SONG" : "SAIL ON", () => { round++; ask(); }, { w: 260, h: 60, size: 32 }));
        };
      };
      ask();
    }

    // ── Message in a bottle: a note and a little booty. ──
    bottle() {
      this.timerText.setText("");
      const note = AHOY.BOTTLE_NOTES[Math.floor(Math.random() * AHOY.BOTTLE_NOTES.length)];
      this.add.rectangle(640, 560, 1100, 260, 0x000000, 0.4).setDepth(55);
      const p = UI.panel(this, 640, 520, 900, 230).setDepth(56);
      UI.text(this, 640, 470, "The note reads:", 30, "#7a1f12").setDepth(57);
      UI.text(this, 640, 530, note, 40, "#2b1b12", { wrap: 820 }).setDepth(57);
      UI.text(this, 640, 600, "…and 8 gold coins rattle in the bottle!", 30, "#1b6e2a").setDepth(57);
      AHOY.Audio.play("coin");
      UI.button(this, 640, 670, "POCKET IT", () => this.finish(8, "A lucky find."), { w: 260, h: 60, size: 32 }).setDepth(58);
      p.setAlpha(1);
    }

    // ── Rival ship: fire when the marker sweeps the gold zone. 3 hits sinks them. ──
    rival() {
      const barX = 640, barY = 640, barW = 700;
      const g = this.add.graphics().setDepth(40);
      g.fillStyle(0x2b1b12, 1).fillRoundedRect(barX - barW / 2 - 6, barY - 26, barW + 12, 52, 12);
      g.fillStyle(0x8a5530, 1).fillRoundedRect(barX - barW / 2, barY - 20, barW, 40, 10);
      const zoneW = 110; let zoneX = barX;
      const zone = this.add.rectangle(zoneX, barY, zoneW, 40, 0xffc93c).setDepth(41);
      const needle = this.add.rectangle(barX - barW / 2, barY, 10, 64, 0xffffff).setDepth(42).setStrokeStyle(3, 0x2b1b12);
      let dir = 1, speed = 620, hits = 0, taken = 0, cooldown = 0;
      this.hud.setText("Hits on rival: 0/3");
      const fireBtn = UI.button(this, 1120, 560, "FIRE!", () => fire(), { w: 200, h: 80, size: 46, fill: 0xc0392b }).setDepth(45);
      const fire = () => {
        if (this.over || cooldown > 0) return; cooldown = 0.35; AHOY.Audio.play("boom");
        const ball = this.add.circle(260, 470, 12, 0x111111).setDepth(30);
        const hit = Math.abs(needle.x - zone.x) < zoneW / 2;
        this.tweens.add({ targets: ball, x: hit ? 1000 : 820, y: hit ? 380 : 560, duration: 450, onComplete: () => {
          ball.destroy();
          const s = this.add.circle(hit ? 1000 : 820, hit ? 380 : 560, 50, hit ? 0xff7a2a : 0xffffff, 0.8).setDepth(31);
          this.tweens.add({ targets: s, scale: 2, alpha: 0, duration: 400, onComplete: () => s.destroy() });
          if (hit) { hits++; this.hud.setText(`Hits on rival: ${hits}/3`); this.cameras.main.shake(200, 0.01); zone.x = Phaser.Math.Between(barX - 260, barX + 260); speed += 120;
            if (hits >= 3) { this.spawnEv && this.spawnEv.remove(); this.finish(16, "The rival strikes its colours! Their booty is yours."); } }
        } });
      };
      this.input.keyboard.on("keydown-SPACE", fire);
      this.stepFn = (dt) => {
        cooldown = Math.max(0, cooldown - dt);
        needle.x += dir * speed * dt;
        if (needle.x > barX + barW / 2) { needle.x = barX + barW / 2; dir = -1; }
        if (needle.x < barX - barW / 2) { needle.x = barX - barW / 2; dir = 1; }
      };
      this.spawnEv = this.time.addEvent({ delay: 2300, loop: true, callback: () => {
        if (this.over) return; taken++; this.delta -= 3; AHOY.Audio.play("boom"); this.cameras.main.shake(260, 0.014);
        const s = this.add.circle(Phaser.Math.Between(200, 420), Phaser.Math.Between(420, 560), 60, 0xffffff, 0.7).setDepth(31);
        this.tweens.add({ targets: s, scale: 2, alpha: 0, duration: 500, onComplete: () => s.destroy() });
      } });
      this.clock(15, () => this.finish(0, `The rival escaped after ${hits} hits.`));
      fireBtn.setAlpha(1);
    }

    // ── The liquidity pool (whirlpool): mash to row out before you're dragged under. ──
    whirl() {
      let meter = 30;
      const g = this.add.graphics().setDepth(40);
      const ship = this.add.image(640, 400, "ship").setScale(0.3).setDepth(30);
      this.tweens.add({ targets: ship, angle: 360, duration: 2400, repeat: -1 });
      const row = () => { if (this.over) return; meter = Math.min(100, meter + 6.5); AHOY.Audio.play("click"); };
      this.input.keyboard.on("keydown-SPACE", row);
      UI.button(this, 1100, 600, "ROW!", row, { w: 220, h: 90, size: 50, fill: 0x2e7d32 }).setDepth(45);
      this.hud.setText("Row out of the pool!");
      this.stepFn = (dt) => {
        meter = Math.max(0, meter - 14 * dt);
        g.clear(); g.fillStyle(0x2b1b12, 1).fillRoundedRect(240, 620, 800, 44, 12); g.fillStyle(meter > 66 ? 0x2e7d32 : meter > 33 ? 0xffc93c : 0xc0392b, 1).fillRoundedRect(246, 626, 788 * meter / 100, 32, 10);
        ship.setScale(0.18 + 0.12 * (meter / 100));
        if (meter >= 100 && !this.over) this.finish(10, "You rowed clear of the pool!");
      };
      this.clock(11, () => this.finish(0, "Dragged around the pool — you lost some booty to the depths."));
    }

    update(_, dms) { if (this.started && !this.over && this.stepFn) this.stepFn(dms / 1000); }

    finish(reward, msg) {
      if (this.over) return; this.over = true;
      this.spawnEv && this.spawnEv.remove(); this.clockEv && this.clockEv.remove();
      const net = reward + this.delta;
      AHOY.Save.addBooty(net);
      AHOY.Audio.play(net >= 0 ? "chest" : "bad");
      const layer = this.add.container(0, 0).setDepth(200);
      layer.add(this.add.rectangle(640, 360, 1280, 720, 0x000000, 0.5));
      layer.add(UI.panel(this, 640, 360, 720, 300));
      layer.add(UI.title(this, 640, 270, net >= 0 ? "LAND HO!" : "PHEW…", 60));
      layer.add(UI.text(this, 640, 340, msg, 34, "#2b1b12", { wrap: 640 }));
      layer.add(UI.text(this, 640, 395, (net >= 0 ? "+" : "") + net + " booty", 44, net >= 0 ? "#1b6e2a" : "#c0392b"));
      layer.add(UI.button(this, 640, 470, "CONTINUE", () => this.scene.start("Map", { sea: this.d.sea, arrived: this.d.to }), { w: 260, h: 64, size: 36 }));
      this.input.keyboard.once("keydown-ENTER", () => this.scene.start("Map", { sea: this.d.sea, arrived: this.d.to }));
    }
  }

  AHOY.MishapScene = MishapScene;
})();
