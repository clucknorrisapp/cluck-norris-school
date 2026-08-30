#!/usr/bin/env python3
"""gif-forge assembler: PNG frame dir -> optimized looping GIF (used by render.mjs)."""
import sys, os
from PIL import Image

frame_dir, out_path, ms = sys.argv[1], sys.argv[2], int(sys.argv[3])
colors = int(sys.argv[4]) if len(sys.argv) > 4 else 160
files = sorted(f for f in os.listdir(frame_dir) if f.endswith(".png"))
if not files:
    sys.exit("no frames")

frames = []
for f in files:
    im = Image.open(os.path.join(frame_dir, f)).convert("RGB")
    frames.append(im.quantize(colors=colors, method=Image.MEDIANCUT, dither=Image.FLOYDSTEINBERG))

frames[0].save(out_path, save_all=True, append_images=frames[1:], duration=ms, loop=0, optimize=True)
print(f"assembled {len(frames)} frames -> {out_path} ({os.path.getsize(out_path)} bytes)")
