#!/usr/bin/env python3
"""Headroom plates (ART.md 12a) from gpt-image-2 finals -> img/headroom/. Run from the repo root:
  python3 tools/art/headroom.py [drafts_dir]

Per plate:
  <id>.webp       far layer, 1024x1536, graded: full strength in the top 40%, falling to 40% by 78%
                  down (play happens there), sides eased toward dark for desktop gutters, luminance
                  soft-capped at 0.30 outside emitters and 0.85 on emitters (bloom never fires on it).
                  Where a mid layer exists, its footprint is filled from the surroundings (push-pull),
                  so parallax or rotation never shows the structure twice.
  <id>_mid.webp   boss arenas only: the moving structure (iris, crucible, shield rings), RGBA. Alpha
                  comes from a flat-magenta isolation edit (keyed, despilled); colour comes from the
                  graded final itself, so far and mid match exactly.
  <id>_glow.png   512x768 grey, linear: the emissive mask (hot, warm, saturated or white-hot areas),
                  for C to breathe with the fire and HEAT. Derived by threshold, no extra images.
Also writes a review sheet to assets/generated/sheet-headroom.png.
"""
import os
import sys

import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
DRAFTS = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'assets', 'generated')
W, H = 1024, 1536
PLATES = {
    'ember': ('edit-20261021-184553-c40015-headroom-ember-final.png', None),
    'blaze': ('edit-20261021-184722-6214d0-headroom-blaze-final.png', None),
    'whiteheat': ('edit-20261021-184836-18205a-headroom-whiteheat-final.png', None),
    'stoker': ('edit-20261021-184951-beb096-headroom-stoker-final.png', 'edit-20261021-185352-37d621-headroom-stoker-mid.png'),
    'crucible': ('edit-20261021-185118-aef6dd-headroom-crucible-final.png', 'edit-20261021-185409-465c88-headroom-crucible-mid.png'),
    'core': ('edit-20261021-185237-dcba52-headroom-core-final.png', 'edit-20261021-185303-15f353-headroom-core-mid.png'),
}


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def luma(a):
    return a[..., 0] * 0.2126 + a[..., 1] * 0.7152 + a[..., 2] * 0.0722


def emissive(a):
    """0..1: how much a pixel is a heat emitter (bright and warm-saturated, or white-hot)."""
    y = luma(a)
    mx, mn = a.max(-1), a.min(-1)
    sat = (mx - mn) / np.maximum(mx, 1e-4)
    warm = (a[..., 0] >= a[..., 2]).astype(np.float32)
    return np.clip(smooth(0.28, 0.55, y) * smooth(0.30, 0.55, sat) * warm + smooth(0.72, 0.9, y), 0, 1)


def grade(a):
    yy = np.linspace(0, 1, H, dtype=np.float32)[:, None]
    xx = np.linspace(0, 1, W, dtype=np.float32)[None, :]
    gain = (1 - 0.6 * smooth(0.40, 0.78, yy)) * (0.55 + 0.45 * smooth(0.0, 0.14, np.minimum(xx, 1 - xx)))
    a = a * gain[..., None]
    e = emissive(a)
    y = np.maximum(luma(a), 1e-5)
    f_non = np.where(y < 0.2, y, 0.2 + 0.1 * (1 - np.exp(-(y - 0.2) / 0.1)))
    f_emi = np.where(y < 0.6, y, 0.6 + 0.25 * (1 - np.exp(-(y - 0.6) / 0.25)))
    f = f_non * (1 - e) + f_emi * e
    return np.clip(a * (f / y)[..., None], 0, 1)


def key_magenta(path):
    """Alpha from a flat-magenta isolation edit: distance from the measured key colour."""
    a = np.asarray(Image.open(path).convert('RGB').resize((W, H), Image.LANCZOS)).astype(np.float32) / 255
    corners = np.concatenate([a[:40, :40].reshape(-1, 3), a[-40:, -40:].reshape(-1, 3), a[-40:, :40].reshape(-1, 3)])
    key = np.median(corners, axis=0)
    # magenta-ness: R and B high together while G is low
    m = np.minimum(a[..., 0], a[..., 2]) - a[..., 1]
    km = min(key[0], key[2]) - key[1]
    alpha = 1 - smooth(0.35 * km, 0.75 * km, m)
    alpha_img = Image.fromarray((alpha * 255).astype(np.uint8)).filter(ImageFilter.MedianFilter(3))
    return np.asarray(alpha_img).astype(np.float32) / 255, key


def dilate(mask, r):
    img = Image.fromarray((mask * 255).astype(np.uint8))
    return np.asarray(img.filter(ImageFilter.MaxFilter(2 * r + 1))).astype(np.float32) / 255


def push_pull(img, known):
    """Fill pixels where known == 0 from their surroundings (multi-scale average)."""
    if known.min() > 0.99:
        return img
    h, w = known.shape
    if h < 4 or w < 4:
        mean = (img * known[..., None]).sum((0, 1)) / max(known.sum(), 1e-6)
        return np.broadcast_to(mean, img.shape).copy()
    k = known[: h // 2 * 2, : w // 2 * 2]
    i = img[: h // 2 * 2, : w // 2 * 2]
    ks = k.reshape(h // 2, 2, w // 2, 2).sum((1, 3))
    isum = (i * k[..., None]).reshape(h // 2, 2, w // 2, 2, 3).sum((1, 3))
    small = isum / np.maximum(ks, 1e-6)[..., None]
    small = push_pull(small, (ks > 0).astype(np.float32))
    up = np.repeat(np.repeat(small, 2, 0), 2, 1)
    up = np.pad(up, ((0, h - up.shape[0]), (0, w - up.shape[1]), (0, 0)), mode='edge')
    up = np.asarray(Image.fromarray((np.clip(up, 0, 1) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))).astype(np.float32) / 255
    return img * known[..., None] + up * (1 - known[..., None])


def save(arr, rel, mode='RGB', quality=85):
    dst = os.path.join(ROOT, rel)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    im = Image.fromarray((np.clip(arr, 0, 1) * 255 + 0.5).astype(np.uint8), mode)
    if rel.endswith('.webp'):
        im.save(dst, 'WEBP', quality=quality, method=6, alpha_quality=90)
    else:
        im.save(dst, optimize=True)
    print('wrote', rel, im.size, os.path.getsize(dst), 'bytes')
    return im


def main():
    sheet = []
    info = {}
    for pid, (final, mid) in PLATES.items():
        src = np.asarray(Image.open(os.path.join(DRAFTS, final)).convert('RGB').resize((W, H), Image.LANCZOS)).astype(np.float32) / 255
        g = grade(src)
        far = g
        mid_rgba = None
        if mid:
            alpha, key = key_magenta(os.path.join(DRAFTS, mid))
            known = 1 - dilate((alpha > 0.05).astype(np.float32), 6)
            far = push_pull(g, known)
            mid_rgba = np.concatenate([g, alpha[..., None]], -1)
            ys, xs = np.nonzero(alpha > 0.5)
            info[pid] = (int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max()))
            save(mid_rgba, f'img/headroom/{pid}_mid.webp', 'RGBA')
        save(far, f'img/headroom/{pid}.webp')
        comp = far if mid_rgba is None else far * (1 - mid_rgba[..., 3:]) + g * mid_rgba[..., 3:]
        e = emissive(comp)
        glow = np.asarray(Image.fromarray((e * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(3)).resize((512, 768), Image.LANCZOS)).astype(np.float32) / 255
        save(glow, f'img/headroom/{pid}_glow.png', 'L')
        y = luma(comp)
        print(f'  {pid}: luma max {y.max():.2f}, p99 outside emitters {np.percentile(y[e < 0.2], 99):.2f}, lower-third mean {y[int(H * 0.66):].mean():.3f}')
        sheet.append((pid, comp, glow, mid_rgba))
    print('mid bboxes (x0, y0, x1, y1 px of 1024x1536):', info)
    # review sheet: graded composite, glow mask, mid alpha over far (red outline region)
    tw, th = 256, 384
    out = Image.new('RGB', (len(sheet) * (tw + 8), th * 3 + 16), (15, 13, 12))
    for i, (pid, comp, glow, mid_rgba) in enumerate(sheet):
        x = i * (tw + 8)
        out.paste(Image.fromarray((comp * 255).astype(np.uint8)).resize((tw, th), Image.LANCZOS), (x, 0))
        out.paste(Image.fromarray((glow * 255).astype(np.uint8)).resize((tw, th)).convert('RGB'), (x, th + 8))
        if mid_rgba is not None:
            vis = comp * 0.5
            vis[..., 0] = np.maximum(vis[..., 0], mid_rgba[..., 3] * 0.8)
            out.paste(Image.fromarray((vis * 255).astype(np.uint8)).resize((tw, th), Image.LANCZOS), (x, 2 * th + 16))
    path = os.path.join(ROOT, 'assets', 'generated', 'sheet-headroom.png')
    out.save(path)
    print('sheet', path)


if __name__ == '__main__':
    main()
