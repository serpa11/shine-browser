"""Generate the Shine Browser icon (black tile + glowing 4-point Shine sparkle)."""
import math
import os

try:
    from PIL import Image, ImageDraw, ImageFilter
except ImportError:
    print("Pillow is missing. Run: pip install pillow")
    raise SystemExit(1)

BUILD = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "build")
os.makedirs(BUILD, exist_ok=True)


def sparkle_points(cx, cy, r, power=2.6, steps=240):
    pts = []
    for i in range(steps):
        t = (2 * math.pi * i) / steps
        x = r * (math.cos(t) ** 3)
        y = r * (math.sin(t) ** 3)
        d = math.hypot(x, y)
        if d > r:
            x, y = x * r / d, y * r / d
        pts.append((cx + x, cy + y))
    return pts


def make(size):
    ss = 4
    S = size * ss
    tile = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(tile)
    rad = int(S * 0.235)
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=rad, fill=(5, 5, 6, 255))

    pad = int(S * 0.03)
    inner = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    di = ImageDraw.Draw(inner)
    cx = cy = S / 2
    r = S / 2 - pad
    di.polygon(sparkle_points(cx, cy, r), fill=(255, 255, 255, 255))
    # second, smaller sparkle for the classic dual-star look
    di.polygon(sparkle_points(cx, cy, r * 0.42), fill=(255, 255, 255, 255))

    glow = inner.filter(ImageFilter.GaussianBlur(S * 0.035))
    tile = Image.alpha_composite(tile, glow)
    tile = Image.alpha_composite(tile, inner)
    return tile.resize((size, size), Image.LANCZOS)


make(1024).save(os.path.join(BUILD, "icon.png"))
make(256).save(os.path.join(BUILD, "icon.ico"), sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)])
print("icons written ->", BUILD)
