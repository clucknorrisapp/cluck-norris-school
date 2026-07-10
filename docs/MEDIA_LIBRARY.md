# Media Library — brand asset manifest

**Why this exists:** cloud sessions are ephemeral and Higgsfield generations pile up fast.
On 2026-07-08 we burned a regeneration cycle because "the good video" couldn't be located.
Rule (also in CLAUDE.md): **every KEPT generation gets a row here — job ID, CDN URL, what it
is, and the owner's verdict.** Before regenerating anything, check this file and
`show_generations` first; before overlaying/editing, confirm the exact job ID with the owner.

CDN URLs are long-lived Higgsfield/CloudFront links — downloadable from any fresh session
(`curl -o file.mp4 "<rawUrl>"`). The scratchpad copies die with the container; these don't.

## Reference images (mascot identity — pass as `medias[{role:image}]` for on-brand renders)

| ID | What | Notes |
|---|---|---|
| `387db388-7db0-4635-a478-8b4d6c7fb4a2` | Branded Cluck reference (muscular rooster, shades, red mohawk, LP tactical vest, ammo belt) | Used for `47624c22`. Describe WITHOUT weapon words in the prompt or Seedance NSFW-false-flags (refunded, but slow). |
| `b1f7713b-69fc-4f18-bed7-781c6e9bb50f` | Branded Cluck reference (alt) | Used for `3c51927a` (owner-loved look) and `4a3ee7a5` (clean-wall hero). |

## Videos

| Job ID | What | Verdict / status |
|---|---|---|
| `4a3ee7a5-eb5d-441b-bf17-5bc324e68af9` | **/learn hero candidate** — 15s 1080p grand marble hall, branded Cluck at podium, CLEAN constellation wall (zero coins), "LEARN EVERY CHAIN" banner, ends on crisp `clucknorris.app/learn` plaque | ✅ Current best. Logo treatment PENDING owner decision (end-card recommended). `rawUrl: hf_20260708_215024_4a3ee7a5….mp4` |
| `3c51927a-e02d-4de8-976f-14aa88e6deb0` | 15s grand-hall, owner-LOVED cinematography, but wall coins are WRONG (duplicate ETH, hallucinated asterisk coin) | ❌ Unusable as-is; coins are baked-in at depth on a moving shot — not fixable by overlay. Its *look* is the bar to hit. |
| `47624c22-3c05-4f75-8b22-6f65a70001a6` | 15s library, branded mascot, clean wall — flat/static staging | ❌ Owner: "this really sucks" (after logo overlay). Too flat vs `3c51927a`. |
| `278f637a-7230-4946-9b3b-1e8890e0aa99` | 15s wholesome professor rooster (no reference image) | ❌ Owner: "looks horrible, like a play chicken." NEVER generate mascot without a reference image. |
| `621d2051-87c3-4681-9bee-0845df98cd27` | 8s 720p original lecture-hall ("crazy good") = the owner's `learnlaunch.mp4` | ✅ Owner-praised; superseded by 15s efforts but the mascot/energy benchmark. |
| `4ff196a4-afae-496e-9b3b-dc109a8168ab` | 8s lock-celebration (Cluck carries bag to CLKN locker) | Used 2026-07-03. |
| `2c382434-c41d-4caf-8f91-ae739104da2e` | 5s Cluck eats chicken sandwich (diner) | Fun one-off. |

## Images / composites

| `6e34e576-8804-479a-a3e0-fc4e109299a1` + Pillow post | Lock celebration 2026-07-10 (+5.00M via Jupiter → 38.94%): two-vault scene, S→5 plaque glyph patched in post, "ROAD TO 40%" progress tracker composited (scratchpad `lockbar.py` — REUSE for every future lock post; owner loves the tracker). Final: CDN `f1a04fe3….png`. Posted X `2075577233230463231` + TG 85876. | ✅ Owner asked for "special" — tracker is now the lock-post signature. |

| Asset | Where | What |
|---|---|---|
| `docs/brand/logo-strip-top6.png` | repo (committed) | 6 official top-mcap coin logos in gold-ringed discs: BTC · ETH · BNB · XRP · SOL · TRX. For video overlays/end-cards. Real logos — AI must NEVER draw these. |
| `public/learn-icons/*.png` | repo (live) | 18 official coin logos (CoinGecko art) used on /learn pages. |

## Hard-won generation rules (save credits, save patience)

- **AI cannot render real coin/brand logos.** It duplicates and hallucinates. Real logos go in
  via ffmpeg overlay on a CLEAN plate, or a static end-card — never in the prompt.
- **Branded mascot = always pass a reference image.** Text-only descriptions produce generic
  "play chicken" output the owner rejects.
- **NSFW false-flags refund automatically** — a flagged render costs nothing but time. Don't
  water down the mascot to avoid flags; just drop weapon-adjacent words from the text.
- Costs (Plus plan, 1200 credits/mo): 15s 1080p high-bitrate Seedance ≈ 135 credits;
  nano_banana_pro image ≈ 2. Most X posts should carry an image (cheap).
- ffmpeg lives at `python3 -c "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())"`
  (pip `imageio-ffmpeg`; apt ffmpeg 404s in this container). Static-PNG overlay needs
  `-loop 1 -t <dur>` or fade filters keep alpha at 0.
