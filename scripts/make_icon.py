"""Shine Browser icon — pure monochrome, matching the supplied artwork:
black square, 'Shine' large + 'Browser' small, white, no color at all."""
import os

from PIL import Image, ImageDraw, ImageFont

BUILD = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "build")
os.makedirs(BUILD, exist_ok=True)

# Try a thin humanist sans that matches the reference art.
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


def fit_font(text, box_w, start, weight=1):
    """Shrink until the text fits inside box_w."""
    size = start
    while size > 8:
        f = load_font(size)
        d = ImageDraw.Draw(Image.new("L", (10, 10)))
        w = d.textbbox((0, 0), text, font=f)[2]
        if w <= box_w:
            return f, w
        size -= 2
    return load_font(8), 0


def make(size, ss=4):
    S = size * ss
    img = Image.new("RGBA", (S, S), (0, 0, 0, 255))          # pure black tile
    d = ImageDraw.Draw(img)

    # 'Shine' — large, light weight, centred slightly above middle
    shine = "Shine"
    f1, _ = fit_font(shine, S * 0.80, int(S * 0.30))
    b1 = d.textbbox((0, 0), shine, font=f1)
    w1, h1 = b1[2] - b1[0], b1[3] - b1[1]
    x1 = (S - w1) / 2 - b1[0]
    y1 = S * 0.40 - h1 / 2 - b1[1]
    d.text((x1, y1), shine, font=f1, fill=(255, 255, 255, 255))

    # 'Browser' — small, tucked under the right half of 'Shine'
    word = "Browser"
    f2, _ = fit_font(word, S * 0.46, int(S * 0.115))
    b2 = d.textbbox((0, 0), word, font=f2)
    w2, h2 = b2[2] - b2[0], b2[3] - b2[1]
    x2 = x1 + w1 - w2                       # right-aligned to 'Shine'
    y2 = y1 + h1 + S * 0.045
    d.text((x2, y2), word, font=f2, fill=(255, 255, 255, 255))

    return img.resize((size, size), Image.LANCZOS)


make(1024).save(os.path.join(BUILD, "icon.png"))
make(256).save(
    os.path.join(BUILD, "icon.ico"),
    sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)],
)
print("monochrome Shine Browser icons written ->", BUILD)
