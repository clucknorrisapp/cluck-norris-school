# Normie Quest — produced SFX samples (drop-in)

Drop OWNED sound files here named `<key>.mp3` (or `.wav` / `.m4a` / `.ogg`). When a file
exists for a key the game knows, it decodes once and plays the real sample; when it's
missing, the built-in synth tone keeps working — this folder can stay empty forever.

| key    | plays when                        | synth fallback            | file present? |
|--------|-----------------------------------|---------------------------|---------------|
| `coin` | grabbing any coin / bonus payout  | "ti-TING" two-tone ring   | not yet — owner is sending one |

To add a NEW sample key: add it to `_SFX_FILES` in `normie-quest-platformer.html` (with a
per-sample volume that sits well against the synth SFX) and list it here.

Keep everything ORIGINAL/OWNED — same rule as the music (see ../MUSIC_NOTES.md).

## Current samples

| File       | What it is | Provenance |
|------------|------------|------------|
| `coin.mp3` | Coin collect — bright rising two-note "ring" chime (B5→E6) | ORIGINAL: synthesized from scratch in-session (sine + harmonic partials, scripted). Sonic-ring STYLE homage, not a sample of any game audio. Alternates (ring-B G5→D6 rounder, ring-C E6→A6 sparklier) were offered; owner can swap by replacing this file. |
