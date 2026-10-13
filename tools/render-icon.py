"""Renders the Hydra v2 mark (see packages/ui/src/brand/HydraMark.tsx) to app icons.
Usage: python tools/render-icon.py <out_dir>   -> icon.png (1024) and icon.ico (multi-size)
"""
import math
import sys
from pathlib import Path
from PIL import Image, ImageDraw

OUT = 1024
SIZE = OUT * 4  # supersampled, then downscaled for smooth edges
SCALE = SIZE / 32  # the mark is designed on a 32x32 grid
BG = (11, 13, 18, 255)
INK = (230, 233, 240, 255)
ACCENT = (57, 198, 214, 255)


def p(x, y):
    return (x * SCALE, y * SCALE)


def bezier(p0, p1, p2, p3, steps=96):
    pts = []
    for i in range(steps + 1):
        t = i / steps
        u = 1 - t
        x = u**3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t**3 * p3[0]
        y = u**3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t**3 * p3[1]
        pts.append(p(x, y))
    return pts


def stroke(draw, pts, color, width):
    """Round-capped stroke: stamps discs densely along the polyline (no join artifacts)."""
    r = width / 2
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        steps = max(1, int(math.hypot(x1 - x0, y1 - y0) / (r / 4)))
        for i in range(steps + 1):
            t = i / steps
            x, y = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t
            draw.ellipse([x - r, y - r, x + r, y + r], fill=color)


def render(out_dir: Path):
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, SIZE - 1, SIZE - 1], radius=int(7 * SCALE), fill=BG)
    w = 2.4 * SCALE
    # M7 7c0 7 9 8 9 17  /  M25 7c0 7-9 8-9 17  /  M16 5v19
    stroke(d, bezier((7, 7), (7, 14), (16, 15), (16, 24)), INK, w)
    stroke(d, bezier((25, 7), (25, 14), (16, 15), (16, 24)), INK, w)
    stroke(d, [p(16, 5), p(16, 24)], INK, w)
    for cx, cy in ((7, 6.5), (16, 4.5), (25, 6.5)):
        r = 3 * SCALE
        x, y = p(cx, cy)
        d.ellipse([x - r, y - r, x + r, y + r], fill=ACCENT)
    stroke(d, [p(11.5, 25.5), p(16, 29.5), p(20.5, 25.5)], ACCENT, w)
    img = img.resize((OUT, OUT), Image.LANCZOS)
    out_dir.mkdir(parents=True, exist_ok=True)
    img.save(out_dir / "icon.png")
    img.save(out_dir / "icon.ico", sizes=[(s, s) for s in (16, 24, 32, 48, 64, 128, 256)])
    print("icons written to", out_dir)


if __name__ == "__main__":
    render(Path(sys.argv[1] if len(sys.argv) > 1 else "build"))
