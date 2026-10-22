#!/usr/bin/env python3
"""Build glyphs/drops.png from glyphs/<name>.png: 4 columns x 3 rows of 256 cells, row-major in
DROP_NAMES order (src/core/constants.js). Run from the repo root: python3 tools/art/atlas.py"""
import os

from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
DROP_NAMES = ['wide', 'slow', 'multi', 'fire', 'laser', 'catch',
              'thru', 'life', 'shrink', 'fast', 'fog', 'mega']
CELL, COLS, ROWS = 256, 4, 3


def build_atlas(root=ROOT):
    atlas = Image.new('RGBA', (CELL * COLS, CELL * ROWS), (255, 255, 255, 0))
    for i, name in enumerate(DROP_NAMES):
        g = Image.open(os.path.join(root, 'glyphs', f'{name}.png')).convert('RGBA')
        assert g.size == (CELL, CELL), f'{name}.png must be {CELL}x{CELL}'
        atlas.paste(g, ((i % COLS) * CELL, (i // COLS) * CELL))
    atlas.save(os.path.join(root, 'glyphs', 'drops.png'), optimize=True)
    print('wrote glyphs/drops.png', atlas.size)
    return atlas


if __name__ == '__main__':
    build_atlas()
