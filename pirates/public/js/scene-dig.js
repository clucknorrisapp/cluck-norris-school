// AHOY: PumpFunPirates — X marks the spot. A timing dig, then the chest.
(function () {
  const UI = AHOY.UI;

  class DigScene extends Phaser.Scene {
    constructor() { super("Dig"); }
    init(d) { this.d = d; this.progress = 0; this.done = false; }
    create() {
      this.cameras.main.fadeIn(300);
      const sea = AHOY.SEAS[this.d.sea], isl = sea.islands[this.d.island];
      this.sea = sea;
      UI.cover(this, "bg-" + isl.bg).setTint(0xbfae94);
      this.add.ellipse(640, 560, 760, 180, 0xe2ac5c).setStrokeStyle(8, 0x2b1b12);
      this.add.image(640, 556, "xmark").setScale(1.4);
      const pieces = sea.islands.filter((x) => !x.treasure), got = pieces.filter((x) => AHOY.Save.island(x.id).piece).length;
      this.full = got === pieces.length;
      UI.title(this, 640, 70, "X MARKS THE SPOT", 70);
      UI.text(this, 640, 130, this.full ? "Your map is complete — the treasure is right here!" : `Map pieces ${got}/${pieces.length} — a torn map means a smaller haul. Dig anyway!`, 32, "#ffffff", { stroke: "#2b1b12", strokeThickness: 6, wrap: 1100 });
      UI.text(this, 640, 176, "Press SPACE / tap DIG when the ring hits the gold circle", 30, "#ffcd77", { stroke: "#2b1b12", strokeThickness: 6 });

      const p = AHOY.currentPirate();
      this.pv = this.add.image(400, 600, p.sprite).setOrigin(0.5, 1); this.pv.setScale(150 / this.pv.height);
      this.shovel = this.add.image(470, 520, "item-shovel").setScale(0.6).setAngle(-30);

      this.target = this.add.circle(640, 400, 70).setStrokeStyle(10, 0xffc93c);
      this.ring = this.add.circle(640, 400, 200).setStrokeStyle(8, 0xffffff);
      this.bar = this.add.graphics();
      this.feedback = UI.text(this, 640, 300, "", 44, "#ffffff", { stroke: "#2b1b12", strokeThickness: 8 });
      this.ringR = 200; this.ringSpeed = 210;
      const dig = () => this.dig();
      this.input.keyboard.on("keydown-SPACE", dig);
      UI.button(this, 1100, 620, "DIG!", dig, { w: 220, h: 90, size: 52, fill: 0xc0392b });
      this.drawBar();
      UI.muteButton(this);
    }
    drawBar() {
      this.bar.clear().fillStyle(0x2b1b12, 1).fillRoundedRect(340, 650, 600, 36, 12).fillStyle(0xffc93c, 1).fillRoundedRect(346, 656, 588 * Math.min(1, this.progress / 100), 24, 10);
    }
    dig() {
      if (this.done) return;
      const diff = Math.abs(this.ringR - 70);
      const gain = diff < 14 ? 25 : diff < 34 ? 14 : 6;
      this.progress += gain;
      AHOY.Audio.play("dig");
      this.feedback.setText(gain >= 25 ? "PERFECT!" : gain >= 14 ? AHOY.DIG_LINES[Math.floor(Math.random() * AHOY.DIG_LINES.length)] : "Too early…").setAlpha(1);
      this.tweens.add({ targets: this.feedback, alpha: 0, duration: 600, delay: 200 });
      this.tweens.add({ targets: this.shovel, angle: 20, duration: 90, yoyo: true });
      this.cameras.main.shake(80, 0.004);
      for (let i = 0; i < 6; i++) { const d = this.add.circle(640, 550, 8, 0xc78c3c); this.tweens.add({ targets: d, x: 640 + Phaser.Math.Between(-200, 200), y: 520 - Phaser.Math.Between(40, 160), alpha: 0, duration: 500, onComplete: () => d.destroy() }); }
      this.ringR = 200; this.ringSpeed += 12;
      this.drawBar();
      if (this.progress >= 100) this.reveal();
    }
    update(_, dms) {
      if (this.done) return;
      this.ringR -= this.ringSpeed * dms / 1000;
      if (this.ringR < 30) this.ringR = 200;
      this.ring.setRadius(this.ringR);
    }
    reveal() {
      this.done = true; this.ring.destroy(); this.target.destroy();
      const chest = this.add.image(640, 600, "item-chest").setOrigin(0.5, 1).setScale(0.2);
      this.tweens.add({ targets: chest, scale: 1.1, y: 520, duration: 700, ease: "Back.out", onComplete: () => {
        chest.setTexture("item-chest-open"); AHOY.Audio.play("chest");
        for (let i = 0; i < 40; i++) { const c = this.add.image(640, 440, "item-coin").setScale(0.22); this.tweens.add({ targets: c, x: 640 + Phaser.Math.Between(-560, 560), y: Phaser.Math.Between(80, 700), angle: 720, duration: 1300 + i * 20, ease: "Quad.out" }); }
        this.time.delayedCall(900, () => this.summary());
      } });
    }
    summary() {
      const seaDone = AHOY.Save.treasure(this.sea.id);
      const prize = (this.full ? 100 : 40) + (seaDone ? 0 : 50);
      AHOY.Save.addBooty(prize);
      AHOY.Save.setTreasure(this.sea.id);
      const idx = AHOY.SEAS.indexOf(this.sea), next = AHOY.SEAS[idx + 1];
      const L = this.add.container(0, 0).setDepth(500);
      L.add(this.add.rectangle(640, 360, 1280, 720, 0x000000, 0.45));
      L.add(UI.panel(this, 640, 380, 760, 420));
      L.add(UI.title(this, 640, 220, "TREASURE OF " + this.sea.name.toUpperCase() + "!", 46));
      L.add(UI.text(this, 640, 290, `+${prize} booty${this.full ? " — full map bonus!" : ""}`, 44, "#1b6e2a"));
      L.add(UI.text(this, 640, 340, `Total booty: ${AHOY.Save.get().booty}`, 34, "#2b1b12"));
      let nextLine = "You've sailed every sea. Legend.";
      if (next) nextLine = AHOY.Gate.canSail(next) ? `Next: ${next.name} — the map continues!` : `Next: ${next.name} — ${AHOY.Gate.needText(next.access)} to sail on.`;
      L.add(UI.text(this, 640, 400, nextLine, 30, "#7a1f12", { wrap: 680 }));
      L.add(UI.text(this, 640, 450, "Share your haul: screenshot this and tag @PUMPFUNPIRATES", 26, "#3d2a1f"));
      L.add(UI.button(this, 640, 530, next && AHOY.Gate.canSail(next) ? "SAIL TO " + next.name.toUpperCase().slice(0, 18) : "BACK TO THE MAP", () => {
        if (next && AHOY.Gate.canSail(next)) this.scene.start("Map", { sea: idx + 1, first: true });
        else this.scene.start("Map", { sea: idx, treasureDone: true });
      }, { w: 460, h: 66, size: 32, fill: 0xc0392b }));
    }
  }

  AHOY.DigScene = DigScene;
})();
