// Build the Normie Quest platformer HTML from src/game_logic.js (marker-based) + the base64
// sprite/audio assets in src/assets/. Run from anywhere:  node normie-quest/src/build.js
//
// Emits into normie-quest/public/:
//   - normie-quest-platformer.html   (CDN Phaser — the deployed game, the only shipped output)
//   - ../../.nq_test.html  is NOT written here; the instrumented test build lives in dev only.
// normie-quest-play.html (inlined-Phaser standalone) is assembled in-memory for the --test build
// only and is NOT written to public/ — it had no route and was reachable raw via the dist/
// fallback at 12.5MB; deleted from the shipped build 2026-09-07.
//
// game_logic.js references sprite/audio assets by __MARKER__ tokens; this script swaps each
// marker for the matching `data:` URI built from src/assets/<file>. If you add a new asset,
// drop the raw base64 in src/assets/ and add its marker->file mapping to FILE_MARKERS/AUDIO_MARKERS.
//
// Lossless WebP re-encode (build-time only): each inlined PNG is also encoded to lossless WebP
// via `sharp`; if the WebP result is smaller it replaces the PNG data URI (`data:image/webp;...`).
// Every candidate is decode-verified pixel-for-pixel against the source PNG before it is used —
// a mismatch throws and fails the build, it never silently falls back. `NQ_NO_WEBP=1` skips this
// entirely (e.g. `sharp` unavailable) and emits the original PNG data URIs unchanged.
const fs = require('fs');
const path = require('path');

const SRC = __dirname;                                  // normie-quest/src
const ASSETS = path.join(SRC, 'assets');
const ROOT = path.resolve(SRC, '..', '..');             // repo root
const PUBLIC = path.join(ROOT, 'normie-quest', 'public');
const HTML = path.join(PUBLIC, 'normie-quest-platformer.html');

const deployed = fs.readFileSync(HTML, 'utf8');
let logic = fs.readFileSync(path.join(SRC, 'game_logic.js'), 'utf8');

const NO_WEBP = process.env.NQ_NO_WEBP === '1';
let sharp = null;
if (!NO_WEBP) {
  try { sharp = require('sharp'); } catch (e) { sharp = null; }
}

// NEW sprites injected from a raw-base64 .b64 file in src/assets/ (prepend the data-URI prefix).
const FILE_MARKERS = {
  __NORMIE__:'cut_normie_idle.b64', __NRUN1__:'cut_normie_run1.b64', __NRUN2__:'cut_normie_run2.b64', __NJUMP__:'cut_normie_jump.b64',
  // World 21 moon suit — the same four poses, fitted to the originals' content boxes so the
  // ground line and centre match frame-for-frame (see the pose picker's moonSuit swap).
  __MNORMIE__:'cut_normie_moon_idle.b64', __MNRUN1__:'cut_normie_moon_run1.b64', __MNRUN2__:'cut_normie_moon_run2.b64', __MNJUMP__:'cut_normie_moon_jump.b64',
  // The DUCK pose is the fifth player frame — it lives in EXTRA as an inline data URI rather
  // than a marker, which is why the first moon-suit pass (four frames) missed it and crouching
  // on the moon still showed un-suited Normie.
  __MNDUCK__:'cut_normie_moon_duck.b64',
  __JEET__:'cut_jeet.b64', __PAPER__:'cut_paper.b64', __GHOST__:'cut_ghost.b64', __BOT__:'cut_bot.b64', __BITMAXI__:'cut_bitmaxi.b64',
  __DIAMOND__:'cut_diamond.b64', __BULL__:'cut_bull.b64', __MOON__:'cut_moon.b64',
  __CAFFEINE__:'cut_caffeine.b64', __CANDLE__:'cut_candle.b64',
  __RUGKING__:'cut_rugking.b64', __SHARK__:'cut_shark.b64', __SANDLORD__:'cut_sandlord.b64', __SQUID__:'cut_squid.b64', __NAUTILUS__:'cut_nautilus.b64', __RUGKINGDOWN__:'rugking_def.b64', __TOM__:'cut_tom.b64',
  __COIN__:'cut_coin.b64', __SOLANA__:'cut_solana.b64', __AIRDROP__:'cut_airdrop.b64', __KEY__:'cut_key.b64', __DOOR__:'cut_door.b64',
  __WORMHOLE__:'cut_wormhole.b64', __MINIWORM__:'cut_miniworm.b64', __SENTRY__:'cut_sentry.b64', __SLOT__:'cut_slot.b64',
  __OMEGACHAD__:'cut_omegachad.b64', __SUPERGEEK__:'cut_supergeek.b64',
  __FUDSTER__:'cut_fudster.b64', __HONEYPOT__:'cut_honeypot.b64', __WENLAMBO__:'cut_wenlambo.b64',
  __VEGAS__:'cut_vegas.b64', __DRINKLADY__:'cut_drinklady.b64', __SHOWLADY__:'cut_showlady.b64', __LILNORMIE__:'cut_lilnormie.b64',
  __SCAMMYKOL__:'cut_scammykol.b64', __SKYLINE__:'cut_skyline.b64',
  __CEOBOSS__:'cut_ceoboss.b64', __EXCHANGE__:'cut_exchange.b64',
  __WYRM__:'cut_wyrm.b64', __GOLEM__:'cut_golem.b64', __SACRED__:'cut_sacred.b64', __MINES__:'cut_mines.b64',
  __REAPER__:'cut_reaper.b64', __GREATBEAR__:'cut_greatbear.b64', __WHALE__:'cut_whale.b64', __WHALEMOUNT__:'cut_whalemount.b64', __MEGAWHALE__:'cut_megawhale.b64', __BLACKSWAN__:'cut_blackswan.b64', __COLDWALLET__:'cut_coldwallet.b64', __DRILLWORM__:'cut_drillworm.b64', __FLASHDRONE__:'cut_flashdrone.b64', __RUGPULLER__:'cut_rugpuller.b64', __DRAINER__:'cut_drainer.b64',
  __TROLL__:'cut_troll.b64', __SAYLOR__:'cut_saylor.b64', __WENMOON__:'cut_wenmoon.b64',
  __DIRTYWHALE__:'cut_dirtywhale.b64', __MEVDRAGON__:'cut_mevdragon.b64', __LEVIATHAN__:'cut_leviathan.b64', __BURNLORD__:'cut_burnlord.b64', __DIAMONDTITAN__:'cut_diamondtitan.b64', __CORESENTINEL__:'cut_coresentinel.b64', __MARKETMAKER__:'cut_marketmaker.b64', __CHAIRMAN__:'cut_chairman.b64', __SATWARDEN__:'cut_satwarden.b64', __STORMHERALD__:'cut_stormherald.b64',
  __LASERBOT__:'cut_laserbot.b64', __MEVDRONE__:'cut_mevdrone.b64',
  // Scary world (hidden ?room=scary): AI-illustrated cutouts that REPLACE the code-drawn
  // eyeball/longneck/gravemite/ghostship. Loaded under those exact texture keys in Boot, so the
  // procedural draw fns (which each `return` early if the texture already exists) auto-skip.
  __SCARY_EYEBALL__:'scary_eyeball.b64', __SCARY_LONGNECK__:'scary_longneck.b64', __SCARY_GRAVEMITE__:'scary_gravemite.b64', __SCARY_GHOSTSHIP__:'scary_ghostship.b64',
  // Playable-character skins (cosmetic): five 72x108 poses each (display-matched; downscaled
  // ÷4 from the 288x432 de-matte source 2026-08-14 so the bigger 48px hero render is a near-1:1
  // crisp draw, not a blurry upscale, and texture memory is ~11x lighter for the iPad).
  // Loaded in Boot under their <prefix>+{normie,nrun1,nrun2,njump,nduck} keys. 'pr' = Princess, 'kd' = Lil' Normie.
  __PR_IDLE__:'char_pr_idle.b64', __PR_RUN1__:'char_pr_run1.b64', __PR_RUN2__:'char_pr_run2.b64', __PR_JUMP__:'char_pr_jump.b64', __PR_DUCK__:'char_pr_duck.b64',
  __KD_IDLE__:'char_kd_idle.b64', __KD_RUN1__:'char_kd_run1.b64', __KD_RUN2__:'char_kd_run2.b64', __KD_JUMP__:'char_kd_jump.b64', __KD_DUCK__:'char_kd_duck.b64'
};
// Encode one PNG asset to a data URI, trying lossless WebP first (build-time only) and
// verifying it decodes to pixel-identical RGBA before ever using it. Falls back to the plain
// PNG data URI when webp isn't smaller, sharp is unavailable, or NQ_NO_WEBP=1 is set.
async function encodeImageAsset(file, raw, buf) {
  const pngUri = 'data:image/png;base64,' + raw;
  if (!sharp) return { uri: pngUri, webp: false, origBytes: buf.length, outBytes: buf.length };
  let webpBuf;
  try {
    // `exact:true` is required for byte-identical round-tripping: without it libwebp is free to
    // rewrite RGB under fully-transparent pixels (invisible on screen, but not byte-identical),
    // which fails the verify step below on every sprite with transparent padding.
    webpBuf = await sharp(buf).webp({ lossless: true, exact: true }).toBuffer();
  } catch (e) {
    console.warn('sharp webp encode failed for', file, '-', e.message, '(keeping PNG)');
    return { uri: pngUri, webp: false, origBytes: buf.length, outBytes: buf.length };
  }
  if (webpBuf.length >= buf.length) {
    return { uri: pngUri, webp: false, origBytes: buf.length, outBytes: buf.length };
  }
  // Verify losslessness: decode both to raw RGBA and compare buffers exactly.
  const [orig, webp] = await Promise.all([
    sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(webpBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  ]);
  const identical = orig.info.width === webp.info.width &&
    orig.info.height === webp.info.height &&
    orig.info.channels === webp.info.channels &&
    orig.data.equals(webp.data);
  if (!identical) {
    throw new Error('WebP re-encode of ' + file + ' is NOT pixel-identical to the source PNG — failing the build.');
  }
  return { uri: 'data:image/webp;base64,' + webpBuf.toString('base64'), webp: true, origBytes: buf.length, outBytes: webpBuf.length };
}

async function main() {
  let webpCount = 0, origBytesTotal = 0, outBytesTotal = 0, candidates = 0;
  for (const [marker, file] of Object.entries(FILE_MARKERS)) {
    if (!logic.includes(marker)) continue;
    candidates++;
    const raw = fs.readFileSync(path.join(ASSETS, file), 'utf8').trim();
    const buf = Buffer.from(raw, 'base64');
    const { uri, webp, origBytes, outBytes } = await encodeImageAsset(file, raw, buf);
    if (webp) webpCount++;
    origBytesTotal += origBytes;
    outBytesTotal += outBytes;
    logic = logic.split(marker).join(uri);
  }
  if (sharp) {
    const savedPct = origBytesTotal ? ((origBytesTotal - outBytesTotal) / origBytesTotal * 100).toFixed(1) : '0.0';
    console.log(`webp: ${webpCount}/${candidates} images converted, ${origBytesTotal} -> ${outBytesTotal} decoded bytes (-${savedPct}%)`);
  } else {
    console.log('webp: skipped (' + (NO_WEBP ? 'NQ_NO_WEBP=1' : 'sharp not installed') + ') — PNG data URIs unchanged');
  }

  // audio assets: same idea, audio/wav data URI
  const AUDIO_MARKERS = { __SFX_POWER__:'sfx_power.b64' };
  for(const [marker,file] of Object.entries(AUDIO_MARKERS)){
    if(!logic.includes(marker)) continue;
    const raw = fs.readFileSync(path.join(ASSETS, file),'utf8').trim();
    logic = logic.split(marker).join('data:audio/wav;base64,'+raw);
  }

  // splice: keep the deployed file's <head> up to & including the Phaser <script>, then our game.
  // Phaser is vendored same-origin (/vendor/phaser-3.60.0.min.js) — SRI still validates the bytes.
  // NOTE: must match the tag in normie-quest-platformer.html EXACTLY (incl. the SRI attributes) —
  // build.js splices the head at this tag, so a mismatch throws "phaser CDN tag not found".
  const cdnTag = '<script src="/vendor/phaser-3.60.0.min.js" integrity="sha384-bcpiSslshEqIfUoxXWFNw7kqGDrRhwSYbr2IHOzGmD5dX3pDoM89ZGkqW9qFP0Ks" crossorigin="anonymous"></script>';
  const cut = deployed.indexOf(cdnTag);
  if(cut < 0) throw new Error('phaser CDN tag not found in deployed HTML');
  const headBody = deployed.slice(0, cut + cdnTag.length);

  const out = headBody + '\n<script>\n' + logic.trim() + '\n</script>\n</body>\n</html>\n';
  fs.writeFileSync(HTML, out);
  console.log('wrote', path.relative(ROOT, HTML), '('+out.length+' bytes)');

  // --- inlined-Phaser build (CSP-free standalone) ---
  // ONE vendored Phaser: the same bytes the served build loads via the SRI-pinned /vendor tag.
  const phaser = fs.readFileSync(path.join(ROOT, 'public', 'vendor', 'phaser-3.60.0.min.js'), 'utf8');
  const inlineHead = headBody.replace(cdnTag, '<script>\n'+phaser+'\n</script>');
  const play = inlineHead + '\n<script>\n' + logic.trim() + '\n</script>\n</body>\n</html>\n';

  // --- optional instrumented test build (window.__PG) for headless testing ---
  // Writes only when a --test flag is passed, to a path you choose (default: repo root .nq_test.html).
  if(process.argv.includes('--test')){
    let test = play.replace('new Phaser.Game({', 'window.__PG=new Phaser.Game({');
    if(!test.includes('window.__PG=new Phaser.Game(')) throw new Error('could not inject __PG capture');
    const testPath = path.join(ROOT, '.nq_test.html');
    fs.writeFileSync(testPath, test);
    console.log('wrote', path.relative(ROOT, testPath), '(instrumented)');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
