// AHOY: PumpFunPirates — the treasure map. Seas as tabs, islands linked by a dotted route,
// fog over what you haven't reached, your ship on the chart, map pieces filling in the X.
(function () {
  const UI = AHOY.UI;

  class MapScene extends Phaser.Scene {
    constructor() { super("Map"); }
    init(data) {
      this.data0 = data || {};
      const save = AHOY.Save.get();
      this.seaIdx = data && data.sea != null ? data.sea : (save.lastSea || 0);
      if (!AHOY.Gate.canSail(AHOY.SEAS[this.seaIdx])) this.seaIdx = 0;
    }
    create() {
      this.cameras.main.fadeIn(250);
      AHOY.Save.set({ lastSea: this.seaIdx });
      const sea = AHOY.SEAS[this.seaIdx];
      this.sea = sea;
      UI.cover(this, "ui-sea-chart").setTint(sea.tint);

      // Arrival from a crossing: move the ship, then offer to land.
      if (this.data0.arrived != null) AHOY.Save.setSeaAt(sea.id, this.data0.arrived);
      const at = AHOY.Save.seaAt(sea.id);

      this.drawTabs();
      const head = this.add.graphics(); head.fillStyle(0x2b1b12, 0.8).fillRoundedRect(330, 74, 620, 70, 14);
      UI.text(this, 640, 98, sea.name, 46, "#ffcd77");
      UI.text(this, 640, 130, sea.sub, 24, "#ffefc9");

      // Routes.
      const routes = this.add.graphics();
      for (let i = 0; i < sea.islands.length - 1; i++) {
        const a = sea.islands[i], b = sea.islands[i + 1];
        const reached = this.reachable(i + 1);
        this.dotted(routes, a.x, a.y + 10, b.x, b.y + 10, reached ? 0x7a1f12 : 0x7a6a55, reached ? 1 : 0.35);
      }

      // Islands.
      this.islandObjs = [];
      sea.islands.forEach((isl, i) => {
        const open = this.reachable(i);
        const st = AHOY.Save.island(isl.id);
        const img = this.add.image(isl.x, isl.y, "island").setScale(isl.treasure ? 0.42 : 0.34);
        if (!open) img.setAlpha(0.35).setTint(0x9c968a);
        const label = UI.text(this, isl.x, isl.y + 70, open ? isl.name : "???", 30, open ? "#2b1b12" : "#6b6255", { stroke: "#f3e2b8", strokeThickness: 6 });
        if (isl.treasure && open) {
          const x = this.add.image(isl.x, isl.y - 6, "xmark").setScale(0.45).setAlpha(this.allPieces() ? 1 : 0.55);
          this.tweens.add({ targets: x, scale: 0.5, duration: 700, yoyo: true, repeat: -1 });
        }
        if (st.done) UI.text(this, isl.x + 62, isl.y - 50, "✔", 40, "#1b6e2a", { stroke: "#ffffff", strokeThickness: 6 });
        if (st.piece) this.add.image(isl.x - 62, isl.y - 46, "item-map-piece").setScale(0.3);
        if (!open) { // fog over the unknown
          for (let k = 0; k < 5; k++) {
            const f = this.add.ellipse(isl.x - 70 + k * 35, isl.y - 6 + ((k * 37) % 3) * 12 - 12, 110, 72, 0xd8d2c4, 0.62);
            this.tweens.add({ targets: f, x: f.x + 12, duration: 2400 + k * 300, yoyo: true, repeat: -1, ease: "Sine.inOut" });
          }
        }
        const zone = this.add.zone(isl.x, isl.y + 20, 190, 170).setInteractive({ useHandCursor: open });
        zone.on("pointerup", () => this.pick(i));
        this.islandObjs.push({ img, label });
      });

      // The ship.
      const here = sea.islands[at] || sea.islands[0];
      this.ship = this.add.image(here.x + 70, here.y - 30, "ship").setScale(0.22);
      this.tweens.add({ targets: this.ship, y: this.ship.y - 8, angle: 3, duration: 1100, yoyo: true, repeat: -1, ease: "Sine.inOut" });

      this.drawHud();
      UI.muteButton(this, 52, 104); // top-left: the chart's compass rose sits top-right

      if (this.data0.arrived != null) this.time.delayedCall(350, () => this.landPrompt(this.data0.arrived));
      else if (this.data0.first) this.toast("Click an island to sail there. Each island hides a piece of the map!");
      if (this.data0.treasureDone) this.toast(sea.name + " conquered! Pick your next sea up top.");
    }

    reachable(i) {
      if (i === 0) return true;
      return AHOY.Save.island(this.sea.islands[i - 1].id).done;
    }
    allPieces() { return this.sea.islands.filter((x) => !x.treasure).every((x) => AHOY.Save.island(x.id).piece); }

    dotted(g, x1, y1, x2, y2, color, alpha) {
      const d = Phaser.Math.Distance.Between(x1, y1, x2, y2), n = Math.floor(d / 18);
      for (let k = 1; k < n; k++) { const t = k / n; g.fillStyle(color, alpha).fillCircle(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t + Math.sin(t * Math.PI) * -30, 4); }
    }

    drawTabs() {
      AHOY.SEAS.forEach((s, i) => {
        const x = 98 + i * 181, y = 30, open = AHOY.Gate.canSail(s), cur = i === this.seaIdx;
        const g = this.add.graphics();
        g.fillStyle(0x2b1b12, 1).fillRoundedRect(x - 86, y - 24, 172, 48, 10);
        g.fillStyle(cur ? 0xfa0d0d : (open ? 0xb5652f : 0x6d6359), 1).fillRoundedRect(x - 83, y - 21, 166, 42, 8);
        const done = AHOY.Save.treasure(s.id);
        UI.text(this, x, y + 1, (open ? "" : "🔒 ") + (done ? "★ " : "") + s.name.replace("Rug Kraken's Deep", "Kraken's Deep").replace("Cold Storage Glacier", "Glacier"), 22, "#fff7e0");
        const z = this.add.zone(x, y, 172, 48).setInteractive({ useHandCursor: true });
        z.on("pointerup", () => {
          AHOY.Audio.play("click");
          if (open) this.scene.restart({ sea: i });
          else AHOY.HolderPanel.open(this, () => this.scene.restart({ sea: AHOY.Gate.canSail(s) ? i : this.seaIdx }));
        });
      });
    }

    drawHud() {
      const save = AHOY.Save.get();
      const g = this.add.graphics(); g.fillStyle(0x2b1b12, 0.85).fillRoundedRect(16, 610, 560, 96, 14);
      this.add.image(70, 658, "item-coin").setScale(0.32);
      UI.text(this, 100, 658, String(save.booty), 40, "#ffcd77", { ox: 0 });
      const pieces = this.sea.islands.filter((x) => !x.treasure);
      const got = pieces.filter((x) => AHOY.Save.island(x.id).piece).length;
      this.add.image(250, 658, "item-map-piece").setScale(0.32);
      UI.text(this, 280, 658, pieces.length ? `${got}/${pieces.length} map pieces` : "One island, one treasure", 32, "#ffffff", { ox: 0 });
      const p = AHOY.currentPirate();
      const portrait = this.add.image(1180, 640, p.portrait && this.textures.exists(p.portrait) ? p.portrait : p.sprite);
      portrait.setScale(110 / Math.max(portrait.width, portrait.height));
      UI.text(this, 1180, 704, p.name.length > 18 ? p.name.slice(0, 17) + "…" : p.name, 24, "#ffffff", { stroke: "#2b1b12", strokeThickness: 4 });
      UI.button(this, 1000, 660, "CREW", () => UI.fadeTo(this, "Select"), { w: 150, h: 54, size: 30 });
      UI.button(this, 828, 660, "HOLDERS", () => AHOY.HolderPanel.open(this, () => this.scene.restart({ sea: this.seaIdx })), { w: 170, h: 54, size: 30 });
      UI.button(this, 660, 660, "TITLE", () => UI.fadeTo(this, "Title"), { w: 140, h: 54, size: 30 });
    }

    toast(msg) {
      const t = UI.text(this, 640, 470, msg, 32, "#ffffff", { stroke: "#2b1b12", strokeThickness: 6, wrap: 1000 }).setAlpha(0);
      this.tweens.add({ targets: t, alpha: 1, duration: 300, yoyo: true, hold: 3200, onComplete: () => t.destroy() });
    }

    pick(i) {
      if (!this.reachable(i)) { AHOY.Audio.play("bad"); this.toast("Fog! Clear the island before it to chart this one."); return; }
      AHOY.Audio.unlock();
      const at = AHOY.Save.seaAt(this.sea.id);
      if (i === at) return this.landPrompt(i);
      // Sail there: a crossing with a sea mishap (always on a first visit, sometimes on a repeat).
      const firstVisit = !AHOY.Save.island(this.sea.islands[i].id).done;
      const mishap = firstVisit || Math.random() < 0.5;
      this.scene.start("Sail", { sea: this.seaIdx, from: at, to: i, mishap });
    }

    landPrompt(i) {
      const isl = this.sea.islands[i];
      const layer = this.add.container(0, 0).setDepth(1500);
      layer.add(this.add.rectangle(640, 360, 1280, 720, 0x000000, 0.45).setInteractive());
      layer.add(UI.panel(this, 640, 380, 640, 360));
      layer.add(UI.title(this, 640, 252, isl.name, 54));
      layer.add(UI.text(this, 640, 320, "“" + isl.tip + "”", 32, "#3d2a1f", { wrap: 560 }));
      const st = AHOY.Save.island(isl.id);
      const info = isl.boss ? "BOSS: the Rug Kraken waits below." : isl.treasure ? (this.allPieces() ? "The map is complete — the treasure is here!" : "The X is here… but your map is missing pieces. You can still dig!") : (st.piece ? "Map piece found ✔ — replay for booty and secrets." : "A map piece is hidden on this island.");
      layer.add(UI.text(this, 640, 384, info, 28, "#c0392b", { wrap: 560 }));
      if (st.best) layer.add(UI.text(this, 640, 424, "Best time " + st.best.toFixed(1) + "s", 24, "#3d2a1f"));
      layer.add(UI.button(this, 520, 480, "LAND!", () => UI.fadeTo(this, "Level", { sea: this.seaIdx, island: i }), { w: 200, h: 66, size: 40, fill: 0xc0392b }));
      layer.add(UI.button(this, 760, 480, "STAY ABOARD", () => layer.destroy(), { w: 240, h: 66, size: 32 }));
    }
  }

  // The crossing between islands: ship sails the chart, then a mishap card flips into a mini-game.
  class SailScene extends Phaser.Scene {
    constructor() { super("Sail"); }
    init(d) { this.d = d; }
    create() {
      const sea = AHOY.SEAS[this.d.sea], a = sea.islands[this.d.from] || sea.islands[0], b = sea.islands[this.d.to];
      UI.cover(this, "ui-sea-chart").setTint(sea.tint);
      UI.text(this, 640, 60, "Sailing to " + b.name + "…", 48, "#2b1b12", { stroke: "#f3e2b8", strokeThickness: 8 });
      [a, b].forEach((i) => this.add.image(i.x, i.y, "island").setScale(0.34));
      const ship = this.add.image(a.x + 40, a.y - 30, "ship").setScale(0.22).setFlipX(b.x < a.x);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 40 };
      AHOY.Audio.play("click");
      const toMid = this.d.mishap;
      this.tweens.add({ targets: ship, x: toMid ? mid.x : b.x + 40, y: toMid ? mid.y : b.y - 30, duration: toMid ? 1400 : 2200, ease: "Sine.inOut",
        onComplete: () => {
          if (!toMid) return this.arrive();
          const pool = sea.mishaps;
          const key = this.d.forceMishap || pool[Math.floor(Math.random() * pool.length)];
          this.scene.start("Mishap", { ...this.d, key });
        } });
      this.tweens.add({ targets: ship, angle: { from: -4, to: 4 }, duration: 500, yoyo: true, repeat: -1 });
    }
    arrive() { this.scene.start("Map", { sea: this.d.sea, arrived: this.d.to }); }
  }

  AHOY.MapScene = MapScene; AHOY.SailScene = SailScene;
})();
