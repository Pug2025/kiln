#!/usr/bin/env python3
"""App icons from one gpt-image-2 fire draft. Run from anywhere:
  python3 tools/art/icons.py <fire-in-a-slot draft.png>

The draft is a straight-on photograph of a vertical slot full of fire on near-black. Only the fire
inside the slot is used: it is cut out by luminance, inset past the slot's rim, and resized into an
exact, pixel-snapped slot (the I of KILN) drawn on void #07080A at every size. Geometry is exact so
the icon stays crisp at 29 px; the fire keeps the photograph's detail.

Writes icons/icon-180.png, icon-192.png, icon-512.png, icon-maskable-512.png, favicon.png (opaque RGB)
and assets/generated/sheet-icons.png (29 / 60 / 180 px on dark and light, with an iOS-style corner mask).
"""
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
VOID = (7, 8, 10)          # #07080A, ART.md section 2
# ART 15.5 F3: the slot's machined edge is a 1 px titanium hairline at 40%, not a heat outline (an
# orange rim read as a neon outline; heat belongs inside the slot)
RIM = (192, 196, 202)      # #C0C4CA titanium
RIM_ALPHA = 0.40
RADIUS = 0.10              # slot corner radius, share of the slot width

# (file, size, slot height as a share of the size, height : width)
OUTPUTS = [
    ('icons/icon-512.png', 512, 0.68, 3.8),
    ('icons/icon-192.png', 192, 0.68, 3.8),
    ('icons/icon-180.png', 180, 0.68, 3.8),
    # maskable: the slot's corners sit at radius 0.32 of the size, inside the 0.40 safe circle
    ('icons/icon-maskable-512.png', 512, 0.62, 3.8),
    # favicon: shown at 16 to 32 px, so the slot is taller and wider (optical size)
    ('icons/favicon.png', 64, 0.80, 3.2),
]


def fire_crop(draft):
    """The fire inside the slot: bbox of the bright region, inset past the rim."""
    rgb = Image.open(draft).convert('RGB')
    a = np.asarray(rgb).astype(np.float32) / 255
    lum = a @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    mask = lum > 0.18
    cols = np.where(mask.mean(0) > 0.25)[0]
    rows = np.where(mask.mean(1) > 0.02)[0]
    x0, x1, y0, y1 = cols.min(), cols.max(), rows.min(), rows.max()
    inset = max(6, int((x1 - x0) * 0.06))
    box = (x0 + inset, y0 + inset, x1 - inset, y1 - inset)
    print('slot in draft', (x0, y0, x1, y1), 'fire box', box)
    return rgb.crop(box)


def slot_rect(size, hfrac, ratio):
    h = int(round(size * hfrac))
    w = int(round(h / ratio))
    if (size - w) % 2:
        w += 1
    if (size - h) % 2:
        h += 1
    x0, y0 = (size - w) // 2, (size - h) // 2
    return x0, y0, w, h


def rounded_mask(w, h, r, ss=4):
    m = Image.new('L', (w * ss, h * ss), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, w * ss - 1, h * ss - 1), radius=r * ss, fill=255)
    return m.resize((w, h), Image.LANCZOS)


def heat_spill(size, x0, y0, w, h):
    """Faint warm light on the plate around the slot, strongest by the white-hot base (depth, not a
    glow: peak about 9% over the void, gone within half a slot width)."""
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32) + 0.5
    cx, cy = x0 + w / 2, y0 + h * 0.72                     # centred on the white-hot lower part
    rx, ry = w * 1.9, h * 0.62
    a = np.exp(-(((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2) * 2.2) * 0.07
    warm = np.array([255, 150, 80], np.float32)
    base = np.array(VOID, np.float32)
    out = base + (warm - base) * a[..., None]
    return Image.fromarray(np.clip(out + 0.5, 0, 255).astype(np.uint8), 'RGB')


def inner_shade(f, w, h):
    """The plate's thickness: the top of the slot falls into shadow over its first 10%."""
    a = np.asarray(f).astype(np.float32)
    y = np.linspace(0, 1, h, dtype=np.float32)[:, None, None]
    k = np.clip(y / 0.10, 0, 1) * 0.35 + 0.65
    return Image.fromarray(np.clip(a * k, 0, 255).astype(np.uint8), 'RGB')


def icon(fire, size, hfrac, ratio):
    x0, y0, w, h = slot_rect(size, hfrac, ratio)
    img = heat_spill(size, x0, y0, w, h)
    r = max(1.0, w * RADIUS)
    # rim: one 1 px titanium hairline around the slot at every size (the machined edge)
    rim_w = 1
    rim = rounded_mask(w + 2 * rim_w, h + 2 * rim_w, r + rim_w)
    rim_layer = Image.new('RGB', rim.size, RIM)
    rim_alpha = rim.point(lambda v: int(v * RIM_ALPHA))
    img.paste(rim_layer, (x0 - rim_w, y0 - rim_w), rim_alpha)
    # the fire, resized into the slot (sharpened a touch when it shrinks a lot)
    f = inner_shade(fire.resize((w, h), Image.LANCZOS), w, h)
    if size <= 64:
        f = f.filter(ImageFilter.UnsharpMask(radius=0.6, percent=60, threshold=0))
    img.paste(f, (x0, y0), rounded_mask(w, h, r))
    return img


def ios_mask(img):
    """Preview only: the rounded-square crop iOS applies (radius about 22.37% of the size)."""
    s = img.size[0]
    m = rounded_mask(s, s, int(s * 0.2237))
    bg = Image.new('RGB', img.size, (0, 0, 0))
    out = Image.new('RGBA', img.size, (0, 0, 0, 0))
    out.paste(img, (0, 0), m)
    return out


def sheet(icons, path):
    """29, 60 and 180 px of icon-180 (as iOS scales it) on dark and light, plus the favicon at 16/32."""
    W, H = 760, 560
    s = Image.new('RGB', (W, H), (28, 30, 34))
    light = Image.new('RGB', (W, H // 2), (236, 238, 242))
    s.paste(light, (0, H // 2))
    src = icons['icons/icon-180.png']
    fav = icons['icons/favicon.png']
    for row, y in ((0, 40), (1, H // 2 + 40)):
        x = 30
        for px in (29, 60, 180):
            im = ios_mask(src.resize((px, px), Image.LANCZOS))
            s.paste(im, (x, y), im)
            x += px + 40
        for px in (16, 32):
            im = fav.resize((px, px), Image.LANCZOS)
            s.paste(im, (x, y))
            x += px + 30
        m = icons['icons/icon-maskable-512.png'].resize((120, 120), Image.LANCZOS)
        circ = rounded_mask(120, 120, 60)
        s.paste(m, (x, y), circ)
    s.save(path)
    print('wrote', os.path.relpath(path, ROOT))


def main(draft):
    fire = fire_crop(draft)
    made = {}
    for rel, size, hfrac, ratio in OUTPUTS:
        im = icon(fire, size, hfrac, ratio)
        dst = os.path.join(ROOT, rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        im.save(dst, optimize=True)
        made[rel] = im
        print('wrote', rel, im.size, 'slot', slot_rect(size, hfrac, ratio))
    sheet(made, os.path.join(ROOT, 'assets', 'generated', 'sheet-icons.png'))


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
