#!/usr/bin/env python3
"""Shrink a seamless texture to the size the game samples, keeping it seamless.

  python3 tools/art/resample.py <in.png> <out.png> <size> [albedo|grey-albedo|linear|normal]

Bricks use one 0..1 UV per face on a 56 x 26 slab, so a face is under about 200 device px even on a
desktop at pixel ratio 2: the GPU never samples above the 256 mip of a 1024 map. Generate at 1024
(house rule) and ship at 512 or 256 with this tool.

Wrap-aware: the image is padded with its own opposite edges, filtered (Lanczos), then cropped, so
the left column still continues the right one and the seam score stays where it was.
  albedo       sRGB colour, filtered in linear light, saved RGB
  grey-albedo  sRGB colour that is grey anyway, filtered in linear light, saved as 8-bit grey
  linear       grey data (roughness, masks), filtered as stored, saved as 8-bit grey
  normal       tangent-space normal (OpenGL +Y): vectors filtered, renormalised, saved RGB
Only whole-number reductions (1024 -> 512 or 256), so the pad maps to whole pixels.
"""
import sys

import numpy as np
from PIL import Image


def to_lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def shrink_plane(a, size):
    """One float32 channel, square, wrap-padded, Lanczos to `size`, cropped."""
    n = a.shape[0]
    k = n // size
    assert a.shape[0] == a.shape[1] and n == k * size and k >= 1, f'{n} -> {size} must be a whole reduction'
    pad_out = 16
    pad_in = pad_out * k
    big = np.pad(a, pad_in, mode='wrap').astype(np.float32)
    im = Image.fromarray(big, 'F').resize((size + 2 * pad_out,) * 2, Image.LANCZOS)
    return np.asarray(im)[pad_out:pad_out + size, pad_out:pad_out + size]


def shrink(src, dst, size, kind):
    img = Image.open(src)
    if kind == 'normal':
        v = np.asarray(img.convert('RGB')).astype(np.float32) / 255 * 2 - 1
        out = np.stack([shrink_plane(v[..., i], size) for i in range(3)], -1)
        out /= np.maximum(np.linalg.norm(out, axis=-1, keepdims=True), 1e-6)
        rgb = np.clip((out + 1) / 2 * 255 + 0.5, 0, 255).astype(np.uint8)
        Image.fromarray(rgb, 'RGB').save(dst, optimize=True)
    elif kind in ('albedo', 'grey-albedo'):
        c = to_lin(np.asarray(img.convert('RGB')).astype(np.float32) / 255)
        if kind == 'grey-albedo':
            g = to_srgb(shrink_plane(c.mean(-1), size))
            Image.fromarray((g * 255 + 0.5).astype(np.uint8), 'L').save(dst, optimize=True)
        else:
            out = np.stack([shrink_plane(c[..., i], size) for i in range(3)], -1)
            Image.fromarray((to_srgb(out) * 255 + 0.5).astype(np.uint8), 'RGB').save(dst, optimize=True)
    elif kind == 'linear':
        g = shrink_plane(np.asarray(img.convert('L')).astype(np.float32), size)
        Image.fromarray(np.clip(g + 0.5, 0, 255).astype(np.uint8), 'L').save(dst, optimize=True)
    else:
        sys.exit(__doc__)
    print('wrote', dst, size, kind)


if __name__ == '__main__':
    if len(sys.argv) != 5:
        sys.exit(__doc__)
    shrink(sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4])
