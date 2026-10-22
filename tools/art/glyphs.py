#!/usr/bin/env python3
"""Drop glyphs: gpt-image-2 drafts (white line on black) -> glyphs/<name>.png (256, white + alpha)
and the atlas glyphs/drops.png (4 x 3 cells of 256, DROP_NAMES order).

Run from the repo root:  python3 tools/art/glyphs.py [drafts_dir]
Steps per glyph: cut by luminance threshold (never the model's transparency), fit into the centre
200 px of the cell, normalise every stroke to one weight (21 px at 256, so 2 px at 24 px), then
downsample 4x for clean anti-aliased edges. Also writes a review sheet to assets/generated/.
"""
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from atlas import build_atlas  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
DRAFTS = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'assets', 'generated')

DROP_NAMES = ['wide', 'slow', 'multi', 'fire', 'laser', 'catch',
              'thru', 'life', 'shrink', 'fast', 'fog', 'mega']
# draft file per drop (see tools/art/prompts.md for the prompts)
SOURCES = {
    'fire': 'image-20261021-182550-06108a-glyph-fire-bold.png',
    'wide': 'edit-20261021-182640-a3a4da-glyph-wide.png',
    'slow': 'edit-20261021-182649-0aa5c1-glyph-slow.png',
    'multi': 'edit-20261021-182657-1c61a4-glyph-multi.png',
    'laser': 'edit-20261021-182706-0499c8-glyph-laser.png',
    'catch': 'edit-20261021-182735-ae939b-glyph-catch.png',
    'thru': 'edit-20261022-035424-c4b08a-glyph-thru2.png',
    'life': None,  # drawn in code (life_mask, see LIFE); the old draft was ...-glyph-life2.png
    'shrink': 'edit-20261021-182803-559ce2-glyph-shrink.png',
    'fast': 'edit-20261021-182843-133207-glyph-fast.png',
    'fog': 'edit-20261021-182851-b6d4d5-glyph-fog.png',
    'mega': 'edit-20261021-182900-ee2e69-glyph-mega.png',
}
WORK = 1024          # working canvas (4x the shipped cell)
BOX = 800            # glyph fits in the centre 800 of 1024 (200 of 256)
HALF = 42            # target stroke half-width at 1024 (stroke 84 -> 21 px at 256, 2 px at 24)
STRETCH_Y = {'fog': 1.66}  # fog's three waves need wider gaps to stay apart at 24 px
# thru: the wall's two segments (draft columns x0..x1, above row y_top and below row y_bot) move
# apart by d draft px, so the gap the arrow passes through survives stroke normalisation (the
# model drew it 72 px, which closed to under 1 px at 24 px and read as a plus sign)
SPLIT = {'thru': (300, 355, 460, 562, 150)}


def split(lum, x0, x1, y_top, y_bot, d):
    """Move the part of columns x0..x1 above y_top up by d and the part below y_bot down by d."""
    out = lum.copy()
    h = lum.shape[0]
    top, bot = lum[:y_top, x0:x1].copy(), lum[y_bot:, x0:x1].copy()
    assert not (top[:d] > 0.5).any() and not (bot[h - y_bot - d:] > 0.5).any(), 'split would cut the drawing'
    out[:y_top, x0:x1] = 0
    out[y_bot:, x0:x1] = 0
    out[:y_top - d, x0:x1] = top[d:]
    out[y_bot + d:, x0:x1] = bot[:h - y_bot - d]
    return out


# Gaps between separate strokes must stay 24 px or more at 256 after every stroke grows to 21 px
# (so 2 px or more when the cell is drawn 24 px tall; f-kit measures it). The model draws thin lines
# close together, so the parts of these drafts move apart before fitting (draft px at 1024; the
# glyph is then fitted again, so a move costs a little scale):
#   multi, shrink:  the parts move out from their common centre
#   catch:          the cradle drops below the ring
#   laser:          the two beams move apart and the base drops
#   slow:           the needle shrinks about its own centre, away from the dial
SPREAD = {'multi': 80, 'shrink': 56}
DROP = {'catch': 84}
LASER = (44, 84)          # each beam out by 44, the base down by 84
SHRINK = {'slow': 0.84}


def segment(shape, a, b, r):
    """Mask of a round-capped stroke of half-width r from point a to point b (x, y)."""
    h, w = shape
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    ax, ay = a
    bx, by = b
    vx, vy = bx - ax, by - ay
    t = np.clip(((xx - ax) * vx + (yy - ay) * vy) / (vx * vx + vy * vy), 0, 1)
    return np.hypot(xx - (ax + t * vx), yy - (ay + t * vy)) <= r


# LIFE (ART 15.5 F2): the HUD's lives mark (a 28x2 bar) with a short chevron above it, "one more
# bar". Drawn in code at the shared stroke (84 at 1024, round caps and a round join): it is pure
# geometry, and the model's plus over a bar read as the plus-minus sign. Numbers at 1024: bar 680
# between cap centres (as wide as WIDE and SHRINK), chevron 440 wide and 220 tall (45 degrees),
# 128 clear between the chevron's feet and the bar (32 px at 256).
LIFE = dict(bar=680, chev_w=440, chev_h=220, gap=128)


def life_mask():
    m = np.zeros((WORK, WORK), bool)
    bar, cw, ch, gap = LIFE['bar'], LIFE['chev_w'], LIFE['chev_h'], LIFE['gap']
    height = ch + 2 * HALF + gap + 2 * HALF               # apex top edge to bar bottom edge
    apex = (WORK - height) / 2 + HALF
    feet = apex + ch
    yb = feet + HALF + gap + HALF
    c = WORK / 2
    m |= segment(m.shape, (c - cw / 2, feet), (c, apex), HALF)
    m |= segment(m.shape, (c, apex), (c + cw / 2, feet), HALF)
    m |= segment(m.shape, (c - bar / 2, yb), (c + bar / 2, yb), HALF)
    return m


def parts(m, least=200):
    """8-connected parts of a mask as boolean masks, specks under `least` pixels dropped."""
    seen = np.zeros_like(m)
    h, w = m.shape
    out = []
    for y0, x0 in zip(*np.nonzero(m)):
        if seen[y0, x0]:
            continue
        seen[y0, x0] = True
        stack, pix = [(y0, x0)], []
        while stack:
            y, x = stack.pop()
            pix.append((y, x))
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    yy, xx = y + dy, x + dx
                    if 0 <= yy < h and 0 <= xx < w and m[yy, xx] and not seen[yy, xx]:
                        seen[yy, xx] = True
                        stack.append((yy, xx))
        if len(pix) >= least:
            pm = np.zeros_like(m)
            ys, xs = zip(*pix)
            pm[list(ys), list(xs)] = True
            out.append(pm)
    return out


def grow(m, r=3):
    out = m.copy()
    for dx, dy in disk(r):
        out |= shift(m, dx, dy)
    return out


def centre(pm):
    ys, xs = np.nonzero(pm)
    return xs.mean(), ys.mean()


def place(lum, pm, dx=0, dy=0, scale=1.0):
    """The part's pixels (with their anti-aliased edge), moved by dx, dy and scaled about its centre."""
    piece = lum * grow(pm)
    if scale != 1.0:
        cx, cy = centre(pm)
        im = Image.fromarray((piece * 255).astype(np.uint8))
        im = im.resize((round(im.width * scale), round(im.height * scale)), Image.LANCZOS)
        big = np.asarray(im).astype(np.float32) / 255
        piece = np.zeros_like(lum)
        ox, oy = round(cx - cx * scale), round(cy - cy * scale)
        piece[oy:oy + big.shape[0], ox:ox + big.shape[1]] = big[:lum.shape[0] - oy, :lum.shape[1] - ox]
    return shift(piece, int(round(dx)), int(round(dy)))


def open_gaps(name, lum):
    """Move a draft's separate parts apart (see SPREAD, DROP, LASER, SHRINK)."""
    ps = parts(lum > 0.5)
    out = np.zeros_like(lum)
    if name in SPREAD:
        gx, gy = np.mean([centre(p) for p in ps], axis=0)
        for p in ps:
            cx, cy = centre(p)
            n = np.hypot(cx - gx, cy - gy) or 1
            out = np.maximum(out, place(lum, p, (cx - gx) / n * SPREAD[name], (cy - gy) / n * SPREAD[name]))
    elif name in DROP:
        low = max(ps, key=lambda p: centre(p)[1])
        for p in ps:
            out = np.maximum(out, place(lum, p, 0, DROP[name] if p is low else 0))
    elif name == 'laser':
        base = max(ps, key=lambda p: centre(p)[1])
        beams = sorted((p for p in ps if p is not base), key=lambda p: centre(p)[0])
        assert len(beams) == 2, 'laser: two beams and a base'
        out = np.maximum(out, place(lum, beams[0], -LASER[0], 0))
        out = np.maximum(out, place(lum, beams[1], LASER[0], 0))
        out = np.maximum(out, place(lum, base, 0, LASER[1]))
    elif name in SHRINK:
        small = min(ps, key=lambda p: p.sum())
        for p in ps:
            out = np.maximum(out, place(lum, p, scale=SHRINK[name] if p is small else 1.0))
    else:
        return lum
    return out


ROLE = {'heat': (255, 236, 214), 'cold': (95, 212, 230), 'warn': (215, 38, 56), 'rare': (255, 217, 168)}
FAMILY = ['heat', 'cold', 'heat', 'heat', 'heat', 'cold', 'heat', 'heat', 'warn', 'warn', 'warn', 'rare']


def shift(m, dx, dy):
    out = np.zeros_like(m)
    h, w = m.shape
    out[max(dy, 0):h + min(dy, 0), max(dx, 0):w + min(dx, 0)] = m[max(-dy, 0):h + min(-dy, 0), max(-dx, 0):w + min(-dx, 0)]
    return out


def disk(r):
    return [(dx, dy) for dy in range(-r, r + 1) for dx in range(-r, r + 1) if dx * dx + dy * dy <= r * r + r]


def dilate(m, r):
    out = m.copy()
    for dx, dy in disk(r):
        out |= shift(m, dx, dy)
    return out


def erode(m, r):
    out = m.copy()
    for dx, dy in disk(r):
        out &= shift(m, dx, dy)
    return out


def half_width(m):
    """Stroke half-width. A uniform stroke loses half its area after w/4 one-pixel erosions
    (alternating cross and square, close to a disk), so h = 2 * k50; joins and caps barely move it."""
    area = m.sum()
    cur = m.copy()
    cross = [(1, 0), (-1, 0), (0, 1), (0, -1)]
    square = cross + [(1, 1), (1, -1), (-1, 1), (-1, -1)]
    for k in range(1, 200):
        nxt = cur.copy()
        for dx, dy in (cross if k % 2 else square):
            nxt &= shift(cur, dx, dy)
        cur = nxt
        if cur.sum() < 0.5 * area:
            return 2 * k
    return 200


def fit(lum, box, sy=1.0):
    """Crop the drawing, stretch it vertically by sy, scale its longer side to box, centre it."""
    m = lum > 0.5
    ys, xs = np.nonzero(m)
    crop = Image.fromarray((lum * 255).astype(np.uint8)).crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
    crop = crop.resize((crop.width, round(crop.height * sy)), Image.LANCZOS)
    s = box / max(crop.size)
    crop = crop.resize((max(1, round(crop.width * s)), max(1, round(crop.height * s))), Image.LANCZOS)
    canvas = Image.new('L', (WORK, WORK), 0)
    canvas.paste(crop, ((WORK - crop.width) // 2, (WORK - crop.height) // 2))
    return np.asarray(canvas).astype(np.float32) / 255 > 0.5, s


def build(name):
    if name == 'life':
        # same weight as the drafts by the same measure (half_width reads a drawn 84 as 80)
        m = life_mask()
        h0 = h = half_width(m)
        if h < HALF:
            m = dilate(m, HALF - h)
            h = half_width(m)
    else:
        lum = np.asarray(Image.open(os.path.join(DRAFTS, SOURCES[name])).convert('L')).astype(np.float32) / 255
        if name in SPLIT:
            lum = split(lum, *SPLIT[name])
        lum = open_gaps(name, lum)
        ys, xs = np.nonzero(lum > 0.5)
        longer = max(xs.max() - xs.min(), ys.max() - ys.min()) + 1
        h0 = half_width(lum > 0.5)
        aspect = (xs.max() - xs.min() + 1) / (ys.max() - ys.min() + 1)
        box = BOX - 40 if 0.8 < aspect < 1.25 else BOX       # optical size: round-ish glyphs a touch smaller
        # the outer edge grows by (HALF - h) after normalising, so fit the centre line into the box
        hs = h0 * box / longer
        m, s = fit(lum, box - 2 * (HALF - hs), STRETCH_Y.get(name, 1.0))
        h = half_width(m)
        if h < HALF:
            m = dilate(m, HALF - h)
        elif h > HALF:
            m = erode(m, h - HALF)
    small = Image.fromarray((m * 255).astype(np.uint8)).resize((256, 256), Image.BOX)
    a = np.asarray(small)
    rgba = np.zeros((256, 256, 4), np.uint8)
    rgba[..., :3] = 255
    rgba[..., 3] = a
    ys2, xs2 = np.nonzero(a > 8)
    print(f'{name:7s} draft stroke {2 * h0:3d}px, normalised {2 * h:3d}->{2 * HALF}px at 1024; '
          f'cell bbox x {xs2.min()}..{xs2.max()} y {ys2.min()}..{ys2.max()}')
    return Image.fromarray(rgba, 'RGBA')


def sheet(glyphs, path):
    """Review sheet: atlas on mid grey (fringe check), then each glyph in a dark drop cell at 24 and 48 px."""
    W, H = 1400, 980
    img = Image.new('RGB', (W, H), (15, 13, 12))
    grey = Image.new('RGB', (1024 // 2, 768 // 2), (110, 110, 110))
    atlas = Image.new('RGBA', (1024, 768), (0, 0, 0, 0))
    for i, g in enumerate(glyphs):
        atlas.alpha_composite(g, ((i % 4) * 256, (i // 4) * 256))
    grey.paste(atlas.resize((512, 384), Image.LANCZOS), (0, 0), atlas.resize((512, 384), Image.LANCZOS))
    img.paste(grey, (20, 20))
    d = ImageDraw.Draw(img)
    for row, px in enumerate((24, 48)):
        cw, ch = int(px * 2.4), int(px * 1.15)
        y = 570 + row * 120
        for i, g in enumerate(glyphs):
            x = 20 + i * (cw + 14) if px == 24 else 20 + (i % 6) * (cw + 20)
            yy = y if px == 24 else y + (i // 6) * (ch + 16)
            d.rounded_rectangle((x, yy, x + cw, yy + ch), radius=max(3, ch // 5), fill=(14, 16, 20), outline=(40, 44, 52))
            col = ROLE[FAMILY[i]]
            gl = g.resize((px, px), Image.LANCZOS)
            tint = Image.new('RGBA', (px, px), col + (255,))
            tint.putalpha(gl.getchannel('A'))
            img.paste(tint, (x + (cw - px) // 2, yy + (ch - px) // 2), tint)
    # 1:1 cells at 256 on black (fire, slow, life, mega), for edge inspection
    for i, k in enumerate((3, 1, 7, 11)):
        x, y = 560 + (i % 2) * 270, 20 + (i // 2) * 270
        img.paste(Image.new('RGB', (256, 256), (0, 0, 0)), (x, y))
        img.paste(glyphs[k], (x, y), glyphs[k])
    img.save(path)
    print('sheet', path)


def main():
    os.makedirs(os.path.join(ROOT, 'glyphs'), exist_ok=True)
    glyphs = []
    for name in DROP_NAMES:
        g = build(name)
        g.save(os.path.join(ROOT, 'glyphs', f'{name}.png'), optimize=True)
        glyphs.append(g)
    build_atlas(ROOT)
    sheet(glyphs, os.path.join(ROOT, 'assets', 'generated', 'sheet-glyphs.png'))


if __name__ == '__main__':
    main()
