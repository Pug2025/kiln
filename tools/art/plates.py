#!/usr/bin/env python3
"""Plates and cards from gpt-image-2 drafts -> WebP at their ARTKIT.md sizes. Run from the repo root:
  python3 tools/art/plates.py backdrop <draft 2048x1024>   -> img/backdrop.webp (wraps left/right)
  python3 tools/art/plates.py hearth <draft>               -> img/hearth.webp 1536x1536
  python3 tools/art/plates.py card <world> <draft>         -> img/levels/<world>.webp 1024x576
The backdrop is cut at a whole number of rib bays, chosen where the two cut columns match best,
then stretched back to 2048 wide, so its left and right edges continue into each other.
"""
import os
import sys

import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))


def save_webp(img, rel, quality=82):
    dst = os.path.join(ROOT, rel)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    img.convert('RGB').save(dst, 'WEBP', quality=quality, method=6)
    print('wrote', rel, img.size, os.path.getsize(dst), 'bytes')


def seam(a):
    inner = np.abs(a[:, 1:] - a[:, :-1]).mean()
    return float(np.abs(a[:, 0] - a[:, -1]).mean() / inner)


def backdrop(draft):
    im = Image.open(draft).convert('RGB')
    a = np.asarray(im).astype(np.float32)
    w = a.shape[1]
    # rib period from the autocorrelation of the column-edge profile
    prof = np.abs(np.diff(a.mean(axis=(0, 2))))
    prof -= prof.mean()
    ac = [float((prof[:-lag] * prof[lag:]).mean()) for lag in range(200, 600)]
    period = 200 + int(np.argmax(ac))
    bays = max(1, round(w * 0.9 / period))
    best = None
    for span in range(bays * period - 6, bays * period + 7):
        for x0 in range(0, w - span - 1):
            d = np.abs(a[:, x0:x0 + 2] - a[:, x0 + span:x0 + span + 2]).mean()
            if best is None or d < best[0]:
                best = (d, x0, span)
    _, x0, span = best
    print('rib period', period, 'bays', bays)
    crop = im.crop((x0, 0, x0 + span, im.height)).resize((2048, 1024), Image.LANCZOS)
    print('backdrop cut', x0, x0 + span, 'seam', round(seam(np.asarray(crop).astype(np.float32)), 2))
    save_webp(crop, 'img/backdrop.webp')


# Two clamp blocks the draft cut off at its left edge (nothing matches them on the right), at 1536
# px, with the shadow each casts below it: (y0, y1, x1, donor y offset). Each is replaced by the
# same columns from a clean stretch of the wall: the strip is vertical panelling, so rows nearby
# continue it, grain and all.
HEARTH_LEFT_CLAMPS = [(368, 512, 34, 150), (898, 1044, 34, -170)]


def paint_out(a, patches, feather=10, ref=10):
    """Copy donor rows over each patch with a feathered edge (top, bottom and right). The donor's
    brightness is ramped per column from the wall just above the patch to the wall just below it,
    so the fill joins both ends without a step."""
    out = a.copy()
    for y0, y1, x1, dy in patches:
        y0f, y1f, xw = y0 - feather, y1 + feather, x1 + feather
        ys = np.arange(y0f, y1f)
        wy = np.clip(np.minimum(ys - y0f, y1f - ys) / feather, 0, 1)[:, None, None]
        wx = np.clip((xw - np.arange(xw)) / feather, 0, 1)[None, :, None]
        w = wy * wx
        src = a[y0f + dy:y1f + dy, :xw]
        t = ((ys - y0f) / max(1, y1f - 1 - y0f))[:, None, None]
        above, below = a[y0f - ref:y0f, :xw].mean(axis=0), a[y1f:y1f + ref, :xw].mean(axis=0)
        # the donor's own trend per column (least-squares line over its rows) comes off, the ramp goes on
        tm, sm = t.mean(), src.mean(axis=0)
        slope = ((t - tm) * (src - sm)).sum(axis=0) / ((t - tm) ** 2).sum()
        src = src - (sm + slope * (t - tm)) + (above * (1 - t) + below * t)
        out[y0f:y1f, :xw] = np.clip(src, 0, 1) * w + a[y0f:y1f, :xw] * (1 - w)
    return out


def hearth(draft):
    """Grade the upper steel down to the world base (#0F0D0C, warm) so the mouth's glow carries the
    image and the wordmark sits on near-black; the mouth (lower 40%) is untouched."""
    im = Image.open(draft).convert('RGB').resize((1536, 1536), Image.LANCZOS)
    a = np.asarray(im).astype(np.float32) / 255
    a = paint_out(a, HEARTH_LEFT_CLAMPS)
    y = np.linspace(0, 1, a.shape[0], dtype=np.float32)[:, None, None]
    t = np.clip((y - 0.15) / (0.60 - 0.15), 0, 1)
    t = t * t * (3 - 2 * t)
    gain = 0.36 + 0.64 * t                                  # 0.36 at the top -> 1.0 from 60% down
    warm = np.array([1.0, 0.95, 0.86], np.float32)          # dark steel leans warm, like the kiln base
    tint = warm * (1 - t) + 1.0 * t
    out = np.clip(a * gain * tint, 0, 1)
    save_webp(Image.fromarray((out * 255 + 0.5).astype(np.uint8)), 'img/hearth.webp')


def card(world, draft):
    im = Image.open(draft).convert('RGB')
    tw, th = 1024, 576
    s = max(tw / im.width, th / im.height)
    im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    x, y = (im.width - tw) // 2, (im.height - th) // 2
    save_webp(im.crop((x, y, x + tw, y + th)), f'img/levels/{world}.webp')


if __name__ == '__main__':
    cmd = sys.argv[1]
    if cmd == 'backdrop':
        backdrop(sys.argv[2])
    elif cmd == 'hearth':
        hearth(sys.argv[2])
    elif cmd == 'card':
        card(sys.argv[2], sys.argv[3])
    else:
        sys.exit(__doc__)
