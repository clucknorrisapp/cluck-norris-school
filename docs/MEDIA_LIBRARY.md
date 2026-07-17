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
| `8373e328-46b3-4c3a-ba90-87a6f57215ca` + ffmpeg post | **$600K market-cap celebration 2026-07-13**: rooftop fireworks + chart-constellation + confetti-cannon Cluck, rendered TEXT-FREE, then cropped (bottom 120px removed a gibberish stone engraving) + Oswald-700 "$600K MARKET CAP" / "clucknorris.app" overlays. Final CDN: `32356dab-3ee7-4c47-b2b6-5858c936d741.mp4`. Posted X `2076731096054583522` (first NATIVE X video via new chunked upload) + TG 86241. Two dead takes: `8ac98853` NSFW-flagged (champagne bottle = alcohol trigger, refunded), `9ac86c38` banner typo "6700K". | ✅ The working video recipe: render text-free → stamp text with ffmpeg/Pillow. |
| `0910b815-49b3-4abe-b6fc-73df32102540` + ffmpeg post | **Cluck Norris BOT patrol — OWNER-APPROVED FINAL 2026-07-17 ("love it")** (roll 7 — supersedes rolls 5-6 below): same roll-6 visuals, but ALL audio native Seedance in one pass — trailer structure: background FEMALE NARRATOR mid-video ("In times of uncertainty, look for guidance in the right areas") then Cluck speaks to camera in Seedance's own deep robotic voice, beak-synced ("Stay strong. I am here to guide you"). The post-dubbed ElevenLabs/robotized attempts (rolls 5-6) were REJECTED by the owner — Seedance's native voice beat our dub; ask for dialogue in-prompt with exact quoted lines + voice description. Post = lettering overlay only, audio copied untouched. 17.2MB. Hosted CDN: `e53fdf8f-87f3-4810-ac0c-230d9612de17.mp4`. Sent to owner's private bot chat (msg 611). **PUBLISHED (owner's go): X `2078156426887762193` (native video) + TG community 86802 (native video, silent, with X link).** Bump self-reply still owed a few hours after post time (~16:35 UTC 2026-07-17) per the standing X bump rule — scheduler unavailable in-session, do it manually. | ✅ THE final. **Voice law: Seedance native dialogue > post-dub for character speech; give exact quoted lines + per-voice tone descriptions and it casts them correctly.** |
| `48bf4457-946f-4c44-9c0b-637954ebf046` + ffmpeg post | **Cluck Norris BOT patrol 2026-07-17** (roll 6 — superseded by roll 7 above): owner flagged roll 5's chart lines still reading "up", so roll 6 removed the words chart/line/graph from the prompt entirely — screens show ONLY huge red minus-percentages ("-23%/-38%/-41%") + giant down arrows, which Seedance renders perfectly. Voice made ROBOTIC per owner ask: the `/api/tts` Cluck line run through ffmpeg DSP (pitch ×0.88 + tremolo f=35 ring-buzz + metallic aecho + compressor) — recipe in scratchpad history, re-derivable. Same lettering overlay + dub chain. Final 17.4MB. Hosted CDN: `90e81a98-d3d0-44e7-9297-7a2074184fa5.mp4`. Sent to owner's private bot chat (msg 610). | ✅ THE keeper. **Chart-direction law, final form: don't ask for charts at all — numbers + arrows only.** |
| `355f3c5e-571e-4651-904d-a8c526afe0b9` + ffmpeg post | **Cluck Norris BOT patrol 2026-07-17** (roll 5 of 5): 15s 1080p, emblem burst → neon plaza market crash ("-38%" plates everywhere, red boards, panicked suits) → bot calmly directs crowds (bare graphite hands, zero VFX) → face-camera fists-on-hips fire-ring hero ending. Post: Anton "CLUCK NORRIS / clucknorris.app" fade-in @11.8s + REAL Cluck ElevenLabs voice dub @11s ("Stay strong. I am here to guide you through the market turmoil." — synthesized free via prod `/api/tts`, native audio ducked to 0.30) replacing the rooster crow. Final 18.6MB (fits TG's 20MB URL limit). Hosted CDN: `d7ed593a-d67a-4f19-986b-c1cf2e550be4.mp4`. Sent to owner's private bot chat (msg 609). Dead rolls: `3d915c61` (crow + spark-zap hands + up-charts), `4c42bb9b` (flame-jet hands), `c7704055` ("traffic officer" simile spawned an actual cop who hijacked the ending), `91e010ab` ("no police" negation FILLED the plaza with cops; "no upward bounces" spawned an up arrow). | ✅ **PROMPT LAW (5-roll proof): VFX negations work ("nothing emitted from hands — no fire, no sparks") but ENTITY negations literalize ("no police" → police everywhere) — never name an object/person that must not appear; describe the crowd/scene positively instead. Occupational similes spawn characters. Seedance CANNOT draw a descending chart line — sell a crash with "-38%" plates + down arrows, not chart direction.** |
| `5e3109d3-7569-416a-b831-5ec43fff7cbf` + ffmpeg post | **LOCKER ROOM launch 2026-07-16**: 15s 1080p vertical (9:16) cartoon Cluck slams a giant vault, coins pour in, sparks (Seedance 2.0, `genre=action`, native audio, START-FRAME = cartoon keyframe `868a9a33` which was built from mascot ref `b1f7713b`). Rendered TEXT-FREE, then ffmpeg-composited two Anton cards rendered via headless-Chromium PNGs: title "LOCKER ROOM / Solana's free token locker" (early) → end card "LEARN LOCKS / LOCK YOUR SOLANA TOKENS / NO EXTRA FEES · NO TOKEN CUT / clucknorris.app". Hosted CDN (uploaded via media_upload): `4b1eca63-5442-4a0a-9a00-d25bfd9f06cc.mp4` (13.7MB). Posted X `2077852171094122881` + TG community 86708 (both with native video). | ✅ Launch video for the Jup Locker Room. Recipe reconfirmed: render text-free → overlay Anton PNGs with ffmpeg. |

## Images / composites

| `6e34e576-8804-479a-a3e0-fc4e109299a1` + Pillow post | Lock celebration 2026-07-10 (+5.00M via Jupiter → 38.94%): two-vault scene, S→5 plaque glyph patched in post, "ROAD TO 40%" progress tracker composited (scratchpad `lockbar.py` — REUSE for every future lock post; owner loves the tracker). Final: CDN `f1a04fe3….png`. Posted X `2075577233230463231` + TG 85876. | ✅ Owner asked for "special" — tracker is now the lock-post signature. |
| `2d06b14a-dc34-4ef7-aaab-89bbf6788211` | **Cluck Norris BOT avatar 2026-07-17** (robot remix of the main logo, ref `b1f7713b`): plasma-blade mohawk, black wraparound visor w/ orange scanline, graphite-steel armor with glowing orange seams, capsule bandolier, hex-plate feathers, fire ring + flaming "CLUCK NORRIS" wordmark (rendered PERFECTLY by nano_banana — rare). CDN `hf_20260717_141332_2d06b14a….png`. Sent to owner's private bot chat (msg 608). | ✅ Owner: "perfect." THE bot-brand avatar. |
| `cc4707c4-4cc1-409d-b36e-68ad52f836b2` | Same robot Cluck, TEXTLESS emblem variant (no wordmark, avatar-crop-safe, faint circuit ring behind flames). CDN `hf_20260717_141415_cc4707c4….png`. | ✅ Kept as the no-text companion (profile pics / overlays that get their own type). |

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
- Costs (ULTRA plan as of 2026-07-17 — old "Plus 1200/mo" note stale): 15s 1080p high-bitrate
  Seedance ≈ 135 credits; nano_banana image ≈ 2. Most X posts should carry an image (cheap).
- **Free real-Cluck voice dubs:** prod `POST /api/tts {text,lang}` returns branded-voice mp3
  (cached forever server-side) — dub over generated video with ffmpeg (duck native audio to
  ~0.30, adelay the line). Zero Higgsfield credits, zero new ElevenLabs cost after first synth.
- ffmpeg lives at `python3 -c "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())"`
  (pip `imageio-ffmpeg`; apt ffmpeg 404s in this container). Static-PNG overlay needs
  `-loop 1 -t <dur>` or fade filters keep alpha at 0.
