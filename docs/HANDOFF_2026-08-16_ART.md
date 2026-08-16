# HANDOFF — Normie Quest boss art (2026-08-16)

**Start this session in the `CLKN big deal` environment (`env_01St75utQwgdH4Zi8i2BPHfJ`).**
Everything below assumes you can reach the internet.

**First command you run — do not skip it:**

```bash
curl -sS -o /dev/null -w "%{http_code}\n" --max-time 15 https://d8j0ntlcm91z4.cloudfront.net/
```

Anything other than a real HTTP code (`000`, or `curl: (56) CONNECT tunnel failed, response 403`)
means you are in the WRONG ENVIRONMENT. Stop and tell the owner — do not attempt workarounds, do not
try a headless browser, do not try to carry image bytes through the transcript. See §6.

---

## 1. Repo, branch, and what is already done

- Repo `clucknorrisapp/cluck-norris-school`, branch **`claude/normie-quest-background-zoom-o1r78z`**.
- **PR #84** is open against `main`. `develop` already carries this work.
- ⛔ `main` is a production release. Push to it only on an explicit owner go, in the moment.

Already committed — **do not redo any of it**:

| Commit | What |
|---|---|
| `d326ad6` | **Background zoom FIXED.** Backdrops were showing a blown-up crop (centre 1/4 at 2×, 1/9 at 3×). Cause: `setScrollFactor(0)` does NOT remove an object from the camera transform; a zoomed camera still scales it about the viewport centre. Fixed with `SCREEN_RECT(cam)` in `game_logic.js`. Use it for ANY screen-pinned object. |
| `5350d52` | **RES raised 2 → 3** (owner ask). Safe only because of `d326ad6`. Visual baselines re-approved at 3×. |
| `c814b36` | CI: gate timeout 600→1500s, gravemite threshold 3.0→5.0 (measured 3× noise floor). |
| `f8c261f` | Full sprite audit + all art candidates logged in `docs/MEDIA_LIBRARY.md`. |

---

## 2. THE JOB: four sprites are broken. Replace them.

Audited every `cut_*` / `scary_*` asset — measured bounds, then looked at contact sheets.

| Asset | What is wrong |
|---|---|
| `cut_scammykol.b64` | cropped at the THIGHS |
| `cut_ceoboss.b64` | legs stop at the SHINS, no shoes |
| `cut_wenmoon.b64` | cropped at the HIPS |
| `scary_gravemite.b64` | not a crop — a pile of dirt clods with ~14 green pellets baked around it that read as projectiles and fight the red bullets it actually fires. **Owner asked for it scrapped and redesigned.** |

⚠️ **`cut_troll.b64` is FINE. Do not regenerate it.** Its 95.6% content-bottom is bottom MARGIN, not a
crop. An earlier pass regenerated it purely off that number without looking. Don't repeat that.

⚠️ **Everything else is correct.** Feet present: `boss` (Rug King), `golem`, `burnlord`, `chairman`,
`coresentinel`, `diamondtitan`, `saylor`, `stormherald`, `sandlord`, `rugking`, `tom`, `troll`.
No feet by design: `wyrm`, `leviathan`, `shark`, `squid`, `nautilus`, `dirtywhale`, `megawhale`,
`blackswan`, `mevdragon`, `greatbear`, `reaper`, `marketmaker`, `satwarden`, `sentry`.

### Replacement art — already generated, verified, waiting to be downloaded

All on flat chroma green `#00b140`, matching the 2026-07-27 pipeline. All measured: full legs, feet,
side margins, and (for the gravemites) **0 detached pieces**.

Base URL: `https://d8j0ntlcm91z4.cloudfront.net/user_3FusN3Ju3eYDQtXzIkwBTR7xnLV/`

| Target asset | Recommended file | Alternates |
|---|---|---|
| `cut_scammykol.b64` | `hf_20260816_155715_d4159eae-def6-4313-80f1-f9208f6406e7.png` | `hf_20260816_155715_e3f213ad-f226-4b70-8a07-e81b2186f4bb.png`, and the earlier grey-background set `hf_20260816_154624_{eaab7e04-cc51-404f-8a12-871befd35742, 83bd8a9a-4050-4c8f-9efc-843e985e68a2, 4ed23427-5700-4064-ba77-3d8787b9a7ec, 79ac5f22-90f0-4986-acb2-85622f0b3ec6}.png` |
| `cut_ceoboss.b64` | `hf_20260816_160336_f45afbbb-76e0-4504-863c-3f841b87f436.png` | `hf_20260816_155715_d11ed931-aba8-453b-ab18-87575354672b.png` |
| `cut_wenmoon.b64` | `hf_20260816_160336_30353e14-e1b3-4ee0-93e3-bc1be80caa55.png` | `hf_20260816_160336_3406d588-44ba-4ddf-b37c-a0e7c8b7fda9.png` |
| `scary_gravemite.b64` | `hf_20260816_160336_44a88240-01b2-47bf-939b-3d28d2c333c8.png` (skull-faced grave-ghoul) | `hf_20260816_160336_fd6b8729-1dc4-4a0a-bdc5-bfaf0a43935d.png` (armoured parasite, one red eye), `hf_20260816_160336_214ec915-e99e-4cfd-9bc1-8dc1de6898ae.png` (reared grub, four-way jaw) |

**Show the owner the options and let him pick — the choice is his, the processing is yours.**
Every job ID and URL is also in `docs/MEDIA_LIBRARY.md`. Regenerate with `nano_banana_pro`, aspect
`2:3` for humanoids / `1:1` for the gravemite, if he wants different ones. Prompts that worked are in
the media library rows and in the Higgsfield job records.

---

## 3. Processing recipe

Asset files are **RAW BASE64 with NO `data:` prefix**. `build.js` prepends the prefix itself.

```bash
# 1. fetch
curl -sS -o /tmp/new.png "<CDN URL>"

# 2. key out the flat green, trim to content, fit to width 330 (ImageMagick or Pillow)
convert /tmp/new.png -alpha set -bordercolor '#00b140' -border 2 \
  -fuzz 22% -fill none -floodfill +0+0 '#00b140' -shave 2x2 \
  -trim +repage -resize 330x /tmp/sprite.png

# 3. encode in place (raw base64, no newlines, no prefix)
base64 -w0 /tmp/sprite.png > normie-quest/src/assets/cut_scammykol.b64

# 4. rebuild
node normie-quest/src/build.js
```

Verify the cutout before committing: no green fringe left on the silhouette edges, no holes punched
through the character where an interior colour matched the key (flood-fill from the corners avoids
this; a plain `-transparent` does NOT). The gravemite is 256×256 in the current build — keep it
square-ish and small; it renders tiny.

Marker → file mapping lives in `normie-quest/src/build.js`:
`__SCAMMYKOL__` (L43), `__CEOBOSS__` (L44), `__WENMOON__` (L47), `__SCARY_GRAVEMITE__` (L53).
Filenames are unchanged, so no build.js edit is needed.

---

## 4. After swapping the art — REQUIRED, or the bosses will float or sink

**Bosses are scaled by HEIGHT:** `k.setScale(bScale/k.height)`. The old plates are 330×360; the new
full-body ones are taller (≈330×480). At the same `bossScale` the new art therefore renders
**narrower and with a different body-to-frame ratio**, and the hitbox constants no longer match.

Boss body config sites in `normie-quest/src/game_logic.js`:

- **L3317** — Rug King: `k.setScale(72/k.height); k.body.setSize(k.width*0.62,k.height*0.82).setOffset(k.width*0.19,k.height*0.14)`
- **L3748** — the generic gravity boss (KOL / Custodian / Wen Moon path): `k.setScale(bScale/k.height); k.body.setSize(k.width*0.60,k.height*0.82).setOffset(k.width*0.20,k.height*0.14)`
- L3838 / L3893 / L3930 / L3975 — other bosses, untouched.

The `h*0.82` + `h*0.14` offsets assume the OLD crop, where content ended ~96% of the way down. With
real feet at 100%, the body box must extend to the bottom of the texture or the boss will hover.
Re-tune per boss, then verify with `__NQ_RECT('boss')` — `y+h` is the feet; it must equal `GY` (246).

**Then remove the grounding shadow**, which only existed to disguise the missing feet:
- **L3278-3280** in `penBoss` — the `add.ellipse` at `GY+3` and its per-frame tracking.
- **L4555** in `bossDefeat` — `k._shadow.destroy()`.
Keep it only if it still looks good as a deliberate touch; it is no longer load-bearing.

---

## 5. Verify before pushing

```bash
PORT=3111 node server.js &                                  # serves the built HTML fresh per request
node normie-quest/test/nq-geometry-check.cjs                 # fast, static
node normie-quest/test/nq-visual.cjs http://localhost:3111   # visual gate
# art changed on purpose -> re-approve, EYEBALL the new PNGs, commit them:
node normie-quest/test/nq-visual.cjs http://localhost:3111 --update
```

Screenshot each replaced boss standing on the floor. Lab lane `/normie-quest-x7-lab`, hooks:
`__NQ_STARTLEVEL(idx,x)`, `__NQ_FORCEBOSS()`, `__NQ_BOSSVIEW()`, `__NQ_SHOVEBOSS(0,222)`,
`__NQ_RECT('boss'|'player')`, `__NQ_DBG`. Level indices: 3-3 (KOL) = **8**, 4-3 (Custodian) = **11**.
Headless does not settle a forced boss's fall — call `__NQ_SHOVEBOSS(0,222)` before capturing.
`window.Phaser.GAMES` is undefined in this build; use only the `__NQ_*` hooks.

There is a ready-made audit script at repo root: `node audit.cjs cut_` prints opaque-content bounds
for every asset. **Measurement is necessary but NOT sufficient** — `cut_wenmoon.b64` measures 100%
content-bottom and is still cropped at the hips, because the crop runs off the canvas edge. Measure
AND look at the picture.

---

## 6. Things that cost real time — do not rediscover them

- **This repo's git history begins at the 2026-08-13 import** (55 commits; the first adds 436 files).
  Anything before that is gone. "Unchanged since the git baseline" proves NOTHING about earlier art.
- **Two boss plates were silently replaced** after their 2026-07-27 media-library rows were written:
  `boss` (Rug King) differs 33.7% from its logged original, `troll` 15.6%. The shipping Rug King is a
  different composition and has legs the logged one lacks. Nobody recorded it.
- **The KOL was never corrupted.** His shipping sprite is byte-identical to his 27 July generation
  (`cd316a35-969d-4783-a257-f95f33d2e8d8`). That generation was made on a **1:1 1024×1024 canvas**
  and the "full body" figure overflowed it, so the legs ran off the bottom edge at generation time.
  Regenerating at 2:3 with explicit full-body framing is the fix.
- **Log every kept generation** in `docs/MEDIA_LIBRARY.md` — job ID, CDN URL, verdict. That file is
  the only reason the originals were recoverable at all.
- **CDN URLs are long-lived.** `curl -o file.png "<rawUrl>"` works from any session in the right
  environment.
- **Phaser trap:** `setScrollFactor(0)` does not exempt an object from camera zoom. Use `SCREEN_RECT(cam)`.
- **Never** call `SystemProgram.transfer()` or any web3.js layout encoder in a browser page.
- Telegram posts are SILENT by default. Never `&loud=1` unless the owner says so in the moment.

---

## 7. Owner's standing asks on this thread

- Backgrounds must show the **whole plate** — fixed, keep it that way. Compare any level against
  `normie-quest/public/worlds/<plate>.webp` before claiming otherwise.
- Characters at **3×**. He likes it. Framing is resolution-invariant now, so RES is purely sharpness.
  If a low-end phone struggles, `var RES` in `game_logic.js` is the one number to drop.
- **Every boss must have feet and look right.** He has said this repeatedly. Look at the art, don't
  just measure it.
- The gravemite must read as something genuinely scary, with the red bullets being the projectiles —
  not baked into the sprite.
- He wants results, not status reports. Ship the fix, then show him a screenshot.
