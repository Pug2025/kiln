#!/usr/bin/env python3
"""Derived maps for the art kit (run from the repo root; sources are local, no download).

  python3 tools/art/derive.py carbon <draft.png>     -> textures/carbon_detail.png
      Luminance of the carbon-crackle draft, stretched to the 1st..99th percentile.
      Grey (L) PNG, linear: a roughness/detail map (bright = crack lines, rough).
  python3 tools/art/derive.py luma2alpha <in.png> <out.png> [lo] [hi]
      White glyph with alpha from luminance: alpha = smoothstep(lo, hi, luminance).
"""
import sys

import numpy as np
from PIL import Image


def carbon(src, dst='textures/carbon_detail.png'):
    g = np.asarray(Image.open(src).convert('L')).astype(np.float32)
    lo, hi = np.percentile(g, 1), np.percentile(g, 99)
    out = np.clip((g - lo) / max(hi - lo, 1e-3), 0, 1) * 255
    Image.fromarray(out.astype(np.uint8), 'L').save(dst, optimize=True)
    print('wrote', dst, 'stretch', lo, hi)


def luma2alpha(src, dst, lo=0.25, hi=0.6):
    g = np.asarray(Image.open(src).convert('L')).astype(np.float32) / 255
    t = np.clip((g - lo) / (hi - lo), 0, 1)
    a = t * t * (3 - 2 * t)
    rgba = np.zeros(g.shape + (4,), np.uint8)
    rgba[..., :3] = 255
    rgba[..., 3] = (a * 255 + 0.5).astype(np.uint8)
    Image.fromarray(rgba, 'RGBA').save(dst, optimize=True)


if __name__ == '__main__':
    cmd = sys.argv[1]
    if cmd == 'carbon':
        carbon(sys.argv[2])
    elif cmd == 'luma2alpha':
        args = [float(v) for v in sys.argv[4:6]]
        luma2alpha(sys.argv[2], sys.argv[3], *args)
    else:
        sys.exit(__doc__)
