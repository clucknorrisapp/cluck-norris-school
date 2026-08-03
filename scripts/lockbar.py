#!/usr/bin/env python3
"""Composite a 'ROAD TO 50% LOCKED' progress tracker onto the bottom of a lock-celebration image.
Usage: lockbar.py <in.png> <out.png> <pct_locked e.g. 45.211> [target=60]

TARGET LIVES HERE, NOT IN THE CALL. Sessions used to pass the raised target as argv[4] and
leave these defaults at 40, so the next session read 40, drew a full bar on an already-passed
goal, and the owner had to correct it again -- three times. Raise the DEFAULT when a milestone
is passed (owner, 2026-08-01: "we have already made it 50 percent twice, so this keeps
reverting"). 40% was passed long ago; supply locked is 45.21% as of 2026-08-01."""
import sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter

import os
SCRATCH = os.environ.get("LOCKBAR_FONT_DIR", os.path.dirname(os.path.abspath(__file__)))
GOLD = (255, 182, 39)
ORANGE = (255, 122, 24)
RED = (232, 30, 14)
CREAM = (255, 239, 224)
SUB = (201, 168, 146)

def main(inp, outp, pct, target=60.0):
    im = Image.open(inp).convert("RGB")
    W, H = im.size
    S = W / 1920.0  # scale relative to a 1920-wide frame

    strip_h = int(150 * S)
    pad = int(56 * S)

    # Darken + blur the strip zone so the bar reads over any art
    strip = im.crop((0, H - strip_h, W, H)).filter(ImageFilter.GaussianBlur(int(9 * S)))
    overlay = Image.new("RGB", (W, strip_h), (10, 8, 6))
    strip = Image.blend(strip, overlay, 0.82)
    im.paste(strip, (0, H - strip_h))

    d = ImageDraw.Draw(im, "RGBA")
    f_head = ImageFont.truetype(f"{SCRATCH}/oswald-700.ttf", int(34 * S))
    f_num = ImageFont.truetype(f"{SCRATCH}/oswald-700.ttf", int(40 * S))
    f_sub = ImageFont.truetype(f"{SCRATCH}/oswald-400.ttf", int(26 * S))

    # subtle top border line on the strip
    d.rectangle([0, H - strip_h, W, H - strip_h + max(2, int(3 * S))], fill=(255, 122, 24, 160))

    # Header line
    ty = H - strip_h + int(16 * S)
    d.text((pad, ty), f"ROAD TO {target:.0f}% OF SUPPLY LOCKED", font=f_head, fill=GOLD)
    # right-aligned big current number
    num = f"{pct:.2f}%"
    nw = d.textlength(num, font=f_num)
    d.text((W - pad - nw, ty - int(4 * S)), num, font=f_num, fill=CREAM)

    # Bar geometry
    bar_y = H - strip_h + int(76 * S)
    bar_h = int(34 * S)
    bar_x0, bar_x1 = pad, W - pad
    bar_w = bar_x1 - bar_x0
    r = bar_h // 2

    # Track
    d.rounded_rectangle([bar_x0, bar_y, bar_x1, bar_y + bar_h], radius=r, fill=(38, 30, 24), outline=(255, 122, 24, 90), width=max(1, int(2 * S)))
    # Fill (gradient orange→red drawn as vertical slices)
    frac = max(0.0, min(1.0, pct / target))
    fill_w = int(bar_w * frac)
    if fill_w > bar_h:  # enough room for rounded fill
        grad = Image.new("RGB", (fill_w, bar_h))
        for x in range(fill_w):
            t = x / max(1, fill_w - 1)
            c = tuple(int(ORANGE[i] + (RED[i] - ORANGE[i]) * t * 0.55) for i in range(3))
            for y in range(bar_h):
                grad.putpixel((x, y), c)
        mask = Image.new("L", (fill_w, bar_h), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, fill_w - 1, bar_h - 1], radius=r, fill=255)
        im.paste(grad, (bar_x0, bar_y), mask)
        # glow tip
        d.ellipse([bar_x0 + fill_w - int(10 * S), bar_y - int(4 * S), bar_x0 + fill_w + int(10 * S), bar_y + bar_h + int(4 * S)], fill=(255, 182, 39, 70))

    # Milestone ticks — round tens below the target (e.g. target 50 → 10/20/30/40).
    _ticks = [t for t in (10, 20, 30, 40, 50, 60, 70, 80, 90) if t < target][:4]
    if not _ticks: _ticks = [round(target * k / 5) for k in range(1, 5)]
    for m in _ticks:
        mx = bar_x0 + int(bar_w * (m / target))
        d.rectangle([mx, bar_y + int(6 * S), mx + max(1, int(2 * S)), bar_y + bar_h - int(6 * S)], fill=(255, 239, 224, 70))
        lw = d.textlength(f"{m}%", font=f_sub)
        d.text((mx - lw / 2, bar_y + bar_h + int(6 * S)), f"{m}%", font=f_sub, fill=SUB)
    # Finish flag at the target
    fx = bar_x1
    _goal = f"{target:.0f}% GOAL"
    lw = d.textlength(_goal, font=f_sub)
    d.text((fx - lw, bar_y + bar_h + int(6 * S)), _goal, font=f_sub, fill=GOLD)

    im.save(outp, quality=93)
    print(f"saved {outp} ({W}x{H}, fill {frac*100:.1f}% of track)")

if __name__ == "__main__":
    inp, outp, pct = sys.argv[1], sys.argv[2], float(sys.argv[3])
    tgt = float(sys.argv[4]) if len(sys.argv) > 4 else 50.0
    main(inp, outp, pct, tgt)
