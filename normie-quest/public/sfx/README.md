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

(none — the coin ring-chime sample was tried 2026-07-21 and REVERTED same day, owner's call:
"that is horrible". The built-in synth coin tone is the live sound. The `coin` key in
`_SFX_FILES` still works — drop an owned `coin.mp3` here any time to try another take.)
