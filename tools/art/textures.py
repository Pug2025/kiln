#!/usr/bin/env python3
"""Shipped textures from gpt-image-2 drafts. Run from the repo root:
  python3 tools/art/textures.py obsidian <draft.png>
      -> textures/obsidian.png   multiply detail (grey in RGB, sRGB): mean 0.85 linear, grain +-12%.
                                 Use as `map` with the matte colour 0x0a0b0d; it only adds grain.
      -> textures/obsidian_n.png tangent-space normal (linear, OpenGL +Y), gentle (strength 2).
Both tile: the draft's seams were 0.94 / 0.91, and every step here is per pixel or wraps.
"""
import os
import subprocess
import sys

import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))


def find_tools():
    """The house art tools (normalmap.py, tilecheck.py) live in a `tools/` folder above the repo.
    PLAYGROUND_TOOLS overrides; otherwise walk up from the repo (works from a worktree too)."""
    env = os.environ.get('PLAYGROUND_TOOLS')
    if env:
        return env
    d = ROOT
    while os.path.dirname(d) != d:
        d = os.path.dirname(d)
        if os.path.isfile(os.path.join(d, 'tools', 'normalmap.py')):
            return os.path.join(d, 'tools')
    sys.exit('normalmap.py not found: set PLAYGROUND_TOOLS to the folder that holds it')


def to_lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def to_srgb(c):
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def obsidian(draft):
    rgb = np.asarray(Image.open(draft).convert('RGB')).astype(np.float32) / 255
    lum = to_lin(rgb) @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    z = (lum - lum.mean()) / max(lum.std(), 1e-6)            # grain in standard units
    detail = np.clip(0.85 + 0.12 * 0.85 * z, 0.5, 1.0)        # mean 0.85 linear, +-12%
    out = (to_srgb(detail) * 255 + 0.5).astype(np.uint8)
    dst = os.path.join(ROOT, 'textures', 'obsidian.png')
    Image.fromarray(np.stack([out] * 3, -1), 'RGB').save(dst, optimize=True)
    print('wrote textures/obsidian.png mean', round(float(detail.mean()), 3), 'std', round(float(detail.std()), 3))
    # height for the normal map: the draft's own luminance, stretched to full range
    h = np.asarray(Image.open(draft).convert('L')).astype(np.float32)
    lo, hi = np.percentile(h, 0.5), np.percentile(h, 99.5)
    tmp = os.path.join(ROOT, 'assets', 'generated', 'obsidian_height.png')
    Image.fromarray((np.clip((h - lo) / (hi - lo), 0, 1) * 255).astype(np.uint8), 'L').save(tmp)
    subprocess.run([sys.executable, os.path.join(find_tools(), 'normalmap.py'), tmp,
                    os.path.join(ROOT, 'textures', 'obsidian_n.png'), '2'], check=True)


if __name__ == '__main__':
    if sys.argv[1] == 'obsidian':
        obsidian(sys.argv[2])
    else:
        sys.exit(__doc__)
