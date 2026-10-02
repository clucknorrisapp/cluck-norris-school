// AHOY: PumpFunPirates — boot. Wait for the fonts and the holder config, then start Phaser.
(function () {
  async function start() {
    try { await Promise.race([Promise.all([document.fonts.load("40px 'Pirata One'"), document.fonts.load("30px 'Just Another Hand'")]), new Promise((r) => setTimeout(r, 2500))]); } catch (_) {}
    try { await AHOY.Gate.boot(); } catch (_) {}
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: "game",
      width: 1280, height: 720,
      backgroundColor: "#1b4f66",
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
      physics: { default: "arcade", arcade: { gravity: { y: 1500 }, debug: false } },
      input: { activePointers: 4 },
      render: { antialias: true, roundPixels: false },
      scene: [AHOY.BootScene, AHOY.TitleScene, AHOY.SelectScene, AHOY.MapScene, AHOY.SailScene, AHOY.MishapScene, AHOY.LevelScene, AHOY.DigScene],
    });
    window.__AHOY_GAME = game;
    const loader = document.getElementById("loading"); if (loader) loader.remove();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
