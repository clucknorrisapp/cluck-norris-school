# Normie Quest — music & aesthetic direction (LOCKED — read before touching audio)

## North star: RETRO, like classic Mario
The whole game is a **retro pixel platformer** in the spirit of classic Mario/Zelda — keep
everything (music, art, new worlds, bosses, transforms) in that nostalgic 8/16-bit retro
aesthetic. The owner confirmed this direction ("this is supposed to be retro like Mario").
Don't drift toward modern/edgy/lo-fi-lounge/chiptune-screech — those were all rejected.

## The music that landed (after MANY iterations — don't restart the journey)
**Warm, nostalgic LO-FI remakes of retro platformer/adventure game melodies — MELODY-FORWARD.**
The tune sings out front; the bass is punchy, NOT a boomy sub wall. This came from analyzing the
owner's own reference tracks (Luigi's Mansion, SMB Castle, SMB2 Boss, SMB3 remakes).

### Winning prompt template (Higgsfield `sonilo_music`, duration 40; boss uses 30)
> "Chill lo-fi remake of a **[mood]** classic-game melody — the catchy lead melody is loud and
> right up front, warm chords supporting; very light tight bass with minimal sub, gentle crisp
> drums, clear and present (never boomy or muddy); **[world mood]**, around **[BPM]** BPM, fully
> instrumental."

Vary the `[mood]`/BPM per world (desert=mysterious ~94, casino=playful ~100, skyline=cool night
~96, exchange=moody minor ~92, sacred/bridge=tense ~96, mines/depeg=sparse calm ~88, world1=cozy
~98). **Boss** is the exception — it's intentionally BASS-HEAVY/driving (matches the SMB2 boss ref).

## Measured target profile (this is how we "listen" — see the analyzer below)
Decode a track and check the numbers against these (from the owner's Nintendo refs):
- **Level/overworld tracks** (world1/desert/casino/skyline/exchange/sacred/mines): melody-forward.
  Target ≈ **sub-bass 28-40%, midrange (melody) 30-41%, centroid 2400-3100 Hz, screech(2-16kHz) <7%.**
  Punchy, not boomy. (Owner refs: Luigi 37/40, Castle 39/41.)
- **Boss track** (boss): bass-heavy/driving. Target ≈ **bass ~84%, mid ~13%, screech <4%.**
- REJECTED profiles: >70% sub-heavy bass with melody buried (~20% mid) = "boomy/muddy"; centroid
  >4000 Hz + screech >10% = "screechy/painful."

## The analyzer — I CANNOT HEAR AUDIO; this is the substitute
`tools/analyze-audio.js` decodes a track (AAC/m4a or mp3) and prints spectral centroid (brightness),
band-energy split, a screech index and bass score. **Run it on every new track BEFORE shipping**,
and on any reference FILE the owner provides, to match numbers. (I can't pull audio off YouTube —
ripping breaks their ToS and the tracks are copyrighted — so references must come as files.)
```
cd normie-quest/tools && npm i node-web-audio-api    # one-time (not committed)
node analyze-audio.js track.m4a [more.m4a ...]
```

## Plumbing (already built)
- Files live at `public/music/<key>.m4a`; keys: world1, desert, casino, skyline, exchange, boss,
  sacred (=World 5 Bridge), mines (=World 6 Depeg). Streamer plays them, synth is the fallback.
- In-game music volume is **0.18** (`MUSIC_VOL` in game_logic.js) so it sits under the SFX.
- Tracks: Higgsfield Sonilo Music, ~2.5 credits each. **Original/owned only** — never rip
  Nintendo/YouTube. Genre/style is free to emulate; melodies must be original.
