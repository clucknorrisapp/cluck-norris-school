# Normie Quest — beach world art direction (owner references, 2026-08-09)

Hand-drawn references the owner supplied for the ocean/beach prize rooms. Use these to drive the
**real sprite generation** (Higgsfield) once credits reset — pass each as an image reference so the
generated game sprite matches the owner's style, then background-remove → resize → base64 → wire in.

Higgsfield was out of credits + no unlimited allowance on 2026-08-09 (owner said it resets the next
day). Do NOT hardcode a look that diverges from these.

## The references

- **`shark-boss.jpeg`** — the SHARK boss ("THE LOAN SHARK", ?room=beach). GOLD/YELLOW body (not grey!),
  rearing up toward the viewer, jaws wide open with jagged teeth, gills, aggressive. Gold fits the
  CLKN theme. This replaces the current procedural grey shark.
- **`striped-squid-enemy.jpeg`** — a beach enemy: an elongated squid/cuttlefish, ORANGE-and-WHITE
  banded body tapering to a point, big blue eye, YELLOW tentacles streaming from the head. Horizontal.
- **`nautilus-enemy.jpeg`** — a beach enemy: a coiled NAUTILUS shell, ORANGE-and-WHITE spiral swirl,
  blue eye, YELLOW tentacles hanging below. Vertical.

## Plan when credits are back

1. Generate a game-ready sprite from each reference (transparent/flat bg, side view for the enemies,
   an imposing hero pose for the shark boss), matching the game's bold arcade look.
2. Wire the shark in as the `shark` boss texture (replaces `drawSharkTex`'s procedural art).
3. The squid + nautilus become new beach enemies (own kinds/behaviours or re-skins of the flying-fish
   dive/erupt behaviours) — decide with the owner whether they replace or join the flying fish.
4. Follow the publish protocol: render screenshots → owner review → owner go → publish.
