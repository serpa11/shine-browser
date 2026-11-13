"""Shine Browser icon — pure monochrome, matching the supplied artwork:
black square, 'Shine' large + 'Browser' small and tucked under its right
half, white, no colour, no gem, no glow. Text is sized big so it stays
legible even at tiny taskbar sizes."""
import os

from PIL import Image, ImageDraw, ImageFont

BUILD = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "build")
os.makedirs(BUILD, exist_ok=True)

# Thin humanist sans that matches the reference art.
FONT_CANDIDATES = [
    r"C:\Windows\Fonts\segoeuil.ttf",    # Segoe UI Light
    r"C:\Windows\Fonts\segoeui.ttf",     # Segoe UI
    r"C:\Windows\Fonts\arial.ttf",
    r"C:\Windows\Fonts\tahomabd.ttf",
]


def load_font(size):
    for p in FONT_CANDIDATES:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                continue
    return ImageFont.load_default()


def fit_font(text, box_w, start):
    """Shrink until the ink width of the text fits inside box_w."""
    size = start
    while size > 8:
        f = load_font(size)
        d = ImageDraw.Draw(Image.new("L", (10, 10)))
        b = d.textbbox((0, 0), text, font=f)
        if (b[2] - b[0]) <= box_w:
            return f, b
        size -= 2
    f = load_font(8)
    return f, ImageDraw.Draw(Image.new("L", (10, 10))).textbbox((0, 0), text, font=f)


def ink_right_top(d, text, font, bbox, right, top):
    """Draw so the text's ink box sits exactly under (right, top)."""
    x0, y0, x1, y1 = bbox
    d.text((right - (x1 - x0) - x0, top - y0), text, font=font, fill=(255, 255, 255, 255))
    return (x1 - x0, y1 - y0)


def make(size, ss=4):
    S = size * ss
    img = Image.new("RGBA", (S, S), (0, 0, 0, 255))          # pure black tile
    d = ImageDraw.Draw(img)

    # ---- 'Shine' — large, light weight, centred a touch above middle ----
    shine = "Shine"
    f1, b1 = fit_font(shine, S * 0.72, int(S * 0.26))
    w1, h1 = b1[2] - b1[0], b1[3] - b1[1]
    right1 = S * 0.5 + w1 / 2                     # ink box horizontally centred
    top1 = S * 0.455 - h1 / 2                     # ink centre at 45.5% height
    ink_right_top(d, shine, f1, b1, right1, top1)

    # ---- 'Browser' — small, tucked under the right half, clear gap ----
    word = "Browser"
    f2, b2 = fit_font(word, S * 0.34, int(S * 0.085))
    w2, h2 = b2[2] - b2[0], b2[3] - b2[1]
    top2 = top1 + h1 + S * 0.022                  # sits below, not into 'Shine'
    ink_right_top(d, word, f2, b2, right1, top2)

    return img.resize((size, size), Image.LANCZOS)


make(1024).save(os.path.join(BUILD, "icon.png"))
make(256).save(
    os.path.join(BUILD, "icon.ico"),
    sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)],
)
print("monochrome Shine Browser icons written ->", BUILD)
