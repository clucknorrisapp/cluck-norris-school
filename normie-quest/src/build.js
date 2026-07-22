// Build the Normie Quest platformer HTML from src/game_logic.js (marker-based) + the base64
// sprite/audio assets in src/assets/. Run from anywhere:  node normie-quest/src/build.js
//
// Emits three files into normie-quest/public/:
//   - normie-quest-platformer.html   (CDN Phaser — the deployed game)
//   - normie-quest-play.html          (inlined Phaser — CSP-free standalone)
//   - ../../.nq_test.html  is NOT written here; the instrumented test build lives in dev only.
//
// game_logic.js references sprite/audio assets by __MARKER__ tokens; this script swaps each
// marker for the matching `data:` URI built from src/assets/<file>. If you add a new asset,
// drop the raw base64 in src/assets/ and add its marker->file mapping to FILE_MARKERS/AUDIO_MARKERS.
const fs = require('fs');
const path = require('path');

const SRC = __dirname;                                  // normie-quest/src
const ASSETS = path.join(SRC, 'assets');
const ROOT = path.resolve(SRC, '..', '..');             // repo root
const PUBLIC = path.join(ROOT, 'normie-quest', 'public');
const HTML = path.join(PUBLIC, 'normie-quest-platformer.html');

const deployed = fs.readFileSync(HTML, 'utf8');
let logic = fs.readFileSync(path.join(SRC, 'game_logic.js'), 'utf8');

// NEW sprites injected from a raw-base64 .b64 file in src/assets/ (prepend the data-URI prefix).
const FILE_MARKERS = {
  __NORMIE__:'cut_normie_idle.b64', __NRUN1__:'cut_normie_run1.b64', __NRUN2__:'cut_normie_run2.b64', __NJUMP__:'cut_normie_jump.b64',
  __JEET__:'cut_jeet.b64', __PAPER__:'cut_paper.b64', __GHOST__:'cut_ghost.b64', __BOT__:'cut_bot.b64', __BITMAXI__:'cut_bitmaxi.b64',
  __DIAMOND__:'cut_diamond.b64', __BULL__:'cut_bull.b64', __MOON__:'cut_moon.b64',
  __CAFFEINE__:'cut_caffeine.b64', __CANDLE__:'cut_candle.b64',
  __RUGKING__:'cut_boss.b64', __RUGKINGDOWN__:'rugking_def.b64',
  __COIN__:'cut_coin.b64', __SOLANA__:'cut_solana.b64', __AIRDROP__:'cut_airdrop.b64', __KEY__:'cut_key.b64', __DOOR__:'cut_door.b64',
  __WORMHOLE__:'cut_wormhole.b64', __MINIWORM__:'cut_miniworm.b64', __SLOT__:'cut_slot.b64',
  __OMEGACHAD__:'cut_omegachad.b64', __SUPERGEEK__:'cut_supergeek.b64',
  __FUDSTER__:'cut_fudster.b64', __HONEYPOT__:'cut_honeypot.b64', __WENLAMBO__:'cut_wenlambo.b64',
  __VEGAS__:'cut_vegas.b64', __DRINKLADY__:'cut_drinklady.b64', __SHOWLADY__:'cut_showlady.b64', __LILNORMIE__:'cut_lilnormie.b64',
  __SCAMMYKOL__:'cut_scammykol.b64', __SKYLINE__:'cut_skyline.b64',
  __CEOBOSS__:'cut_ceoboss.b64', __EXCHANGE__:'cut_exchange.b64',
  __WYRM__:'cut_wyrm.b64', __GOLEM__:'cut_golem.b64', __SACRED__:'cut_sacred.b64', __MINES__:'cut_mines.b64',
  __REAPER__:'cut_reaper.b64', __GREATBEAR__:'cut_greatbear.b64', __WHALE__:'cut_whale.b64', __COLDWALLET__:'cut_coldwallet.b64',
  __TROLL__:'cut_troll.b64'
};
for(const [marker,file] of Object.entries(FILE_MARKERS)){
  if(!logic.includes(marker)) continue;
  const raw = fs.readFileSync(path.join(ASSETS, file),'utf8').trim();
  logic = logic.split(marker).join('data:image/png;base64,'+raw);
}

// audio assets: same idea, audio/wav data URI
const AUDIO_MARKERS = { __SFX_POWER__:'sfx_power.b64' };
for(const [marker,file] of Object.entries(AUDIO_MARKERS)){
  if(!logic.includes(marker)) continue;
  const raw = fs.readFileSync(path.join(ASSETS, file),'utf8').trim();
  logic = logic.split(marker).join('data:audio/wav;base64,'+raw);
}

// splice: keep the deployed file's <head> up to & including the Phaser CDN <script>, then our game.
const cdnTag = '<script src="https://cdnjs.cloudflare.com/ajax/libs/phaser/3.60.0/phaser.min.js"></script>';
const cut = deployed.indexOf(cdnTag);
if(cut < 0) throw new Error('phaser CDN tag not found in deployed HTML');
const headBody = deployed.slice(0, cut + cdnTag.length);

const out = headBody + '\n<script>\n' + logic.trim() + '\n</script>\n</body>\n</html>\n';
fs.writeFileSync(HTML, out);
console.log('wrote', path.relative(ROOT, HTML), '('+out.length+' bytes)');

// --- inlined-Phaser build (CSP-free standalone) ---
const phaser = fs.readFileSync(path.join(SRC, 'phaser.min.js'), 'utf8');
const inlineHead = headBody.replace(cdnTag, '<script>\n'+phaser+'\n</script>');
const play = inlineHead + '\n<script>\n' + logic.trim() + '\n</script>\n</body>\n</html>\n';
const playPath = path.join(PUBLIC, 'normie-quest-play.html');
fs.writeFileSync(playPath, play);
console.log('wrote', path.relative(ROOT, playPath));

// --- optional instrumented test build (window.__PG) for headless testing ---
// Writes only when a --test flag is passed, to a path you choose (default: repo root .nq_test.html).
if(process.argv.includes('--test')){
  let test = play.replace('new Phaser.Game({', 'window.__PG=new Phaser.Game({');
  if(!test.includes('window.__PG=new Phaser.Game(')) throw new Error('could not inject __PG capture');
  const testPath = path.join(ROOT, '.nq_test.html');
  fs.writeFileSync(testPath, test);
  console.log('wrote', path.relative(ROOT, testPath), '(instrumented)');
}
