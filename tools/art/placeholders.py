#!/usr/bin/env python3
"""Write correctly sized placeholder files for every art-kit entry that is not real yet.

Usage (from the repo root):  python3 tools/art/placeholders.py [--force]
Existing files are kept unless --force is given, so finals are never overwritten.
Sizes and paths follow ARTKIT.md; tests/f-kit.test.mjs checks them.
"""
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import glb  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
FORCE = '--force' in sys.argv

DROP_NAMES = ['wide', 'slow', 'multi', 'fire', 'laser', 'catch',
              'thru', 'life', 'shrink', 'fast', 'fog', 'mega']
VOID = (7, 8, 10)
BASE = (15, 13, 12)
HEAT_LO = np.array([255, 122, 26], np.float32)
HEAT_HI = np.array([255, 217, 168], np.float32)


def finals():
    """Paths ARTKIT.md marks final: never overwritten, even with --force."""
    done = set()
    try:
        with open(os.path.join(ROOT, 'ARTKIT.md'), encoding='utf-8') as f:
            for line in f:
                cells = [c.strip() for c in line.split('|')]
                if len(cells) > 7 and cells[1].startswith('`') and cells[7] == 'final':
                    done.add(cells[1].strip('`'))
    except OSError:
        pass
    return done


FINAL = finals()


def out(rel):
    p = os.path.join(ROOT, rel)
    if os.path.exists(p) and (not FORCE or rel in FINAL):
        return None
    os.makedirs(os.path.dirname(p), exist_ok=True)
    return p


def save(img, rel, **kw):
    p = out(rel)
    if p is None:
        print('keep', rel)
        return
    if rel.endswith('.webp'):
        img.convert('RGB').save(p, 'WEBP', quality=80, method=6)
    else:
        img.save(p, optimize=True, **kw)
    print('wrote', rel, img.size)


def font(size):
    for f in ('/System/Library/Fonts/HelveticaNeue.ttc', '/System/Library/Fonts/Helvetica.ttc'):
        if os.path.exists(f):
            return ImageFont.truetype(f, size)
    return ImageFont.load_default()


def vgrad(w, h, top, bottom):
    t = np.linspace(0, 1, h, dtype=np.float32)[:, None, None]
    a = np.array(top, np.float32) * (1 - t) + np.array(bottom, np.float32) * t
    return Image.fromarray(np.repeat(a, w, axis=1).astype(np.uint8))


def warm_plate(w, h, glow):
    """Dark base with a warm glow rising from the bottom centre."""
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    d = np.sqrt(((x - w / 2) / (w * 0.6)) ** 2 + ((y - h * 1.05) / (h * 0.7)) ** 2)
    g = np.clip(1 - d, 0, 1) ** 2 * glow
    base = np.array(BASE, np.float32)
    col = base[None, None, :] * (1 - g[..., None]) + HEAT_LO[None, None, :] * 0.5 * g[..., None]
    return Image.fromarray(np.clip(col, 0, 255).astype(np.uint8))


def glyph(letter):
    img = Image.new('L', (256, 256), 0)
    d = ImageDraw.Draw(img)
    f = font(150)
    bb = d.textbbox((0, 0), letter, font=f)
    d.text(((256 - (bb[2] - bb[0])) / 2 - bb[0], (256 - (bb[3] - bb[1])) / 2 - bb[1]), letter, fill=255, font=f)
    rgba = Image.new('RGBA', (256, 256), (255, 255, 255, 0))
    rgba.putalpha(img)
    return rgba


def iflame(size, maskable=False):
    """The KILN I as a slot of heat on void: a tall bar, hottest at the bottom."""
    img = np.zeros((size, size, 3), np.float32) + np.array(VOID, np.float32)
    scale = 0.62 if maskable else 0.8
    bw, bh = size * 0.22 * scale, size * scale
    x0, y0 = (size - bw) / 2, (size - bh) / 2
    y, x = np.mgrid[0:size, 0:size].astype(np.float32)
    inside = (x >= x0) & (x < x0 + bw) & (y >= y0) & (y < y0 + bh)
    t = np.clip((y - y0) / bh, 0, 1)[..., None]
    col = HEAT_LO * (1 - t) + HEAT_HI * t
    img = np.where(inside[..., None], col, img)
    return Image.fromarray(img.astype(np.uint8))


def main():
    # textures (C)
    save(Image.new('RGB', (1024, 1024), (10, 11, 13)), 'textures/obsidian.png')
    save(Image.new('RGB', (1024, 1024), (128, 128, 255)), 'textures/obsidian_n.png')
    save(Image.new('L', (1024, 1024), 128), 'textures/carbon_detail.png')
    # drop glyphs (C): sources + atlas 4 x 3 cells of 256
    atlas = Image.new('RGBA', (1024, 768), (255, 255, 255, 0))
    for i, name in enumerate(DROP_NAMES):
        g = glyph(name[0].upper())
        save(g, f'glyphs/{name}.png')
        atlas.paste(g, ((i % 4) * 256, (i // 4) * 256))
    save(atlas, 'glyphs/drops.png')
    # plates and cards (C, D)
    save(warm_plate(2048, 1024, 0.35), 'img/backdrop.webp')
    save(warm_plate(1536, 1536, 0.8), 'img/hearth.webp')
    for name, glow in (('ember', 0.3), ('blaze', 0.55), ('whiteheat', 0.8), ('overburn', 1.0)):
        save(warm_plate(1024, 576, glow), f'img/levels/{name}.webp')
    # icons (D)
    for s in (180, 192, 512):
        save(iflame(s), f'icons/icon-{s}.png')
    save(iflame(512, maskable=True), 'icons/icon-maskable-512.png')
    save(iflame(64), 'icons/favicon.png')
    # boss meshes (C)
    for kind in ('stoker', 'crucible', 'core'):
        rel = f'models/{kind}.glb'
        p = out(rel)
        if p is None:
            print('keep', rel)
            continue
        n = glb.write_glb(p, glb.boss_parts(kind), kind)
        print('wrote', rel, n, 'bytes')


if __name__ == '__main__':
    main()
