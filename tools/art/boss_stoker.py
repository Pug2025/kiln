"""The Stoker (level 10): a titanium furnace cowl around B's brick face. Headless Blender only:
  /Applications/Blender.app/Contents/MacOS/Blender -b --python tools/art/boss_stoker.py [-- --no-render]

ART 15.5 F1 and 15.9 (agreed with R8): a cowl with ONE horizontal mouth slot (the open mouth row, 360
x 30, aspect 12:1), two flue stacks and the armoured chin row; no port and no eyes. The heat is a
dim ember strip at the back of the slot, 84 units behind the face, seen past tapered matte walls;
nothing glows on an outer face. Concept: assets/generated/image-20261022-090109-424357-boss-stoker-
cowl-concept.png (reference only).

Brick face (src/levels/data/ember.js, level 10): 'B' head plates, 'A' jaw row, 'W' core in the mouth.
Origin = centroid of the 'B' cells (world.boss.x / y, B's stoker.js). B sways the anchor 60 units
each way in phase 2 (STOKER.SWAY) and the cells already reach x +-300, so every node stays inside
x +-HALF (f-kit: half-width + SWAY <= 360, the arena's inner wall).
Nodes: part-head (body behind the cells, cowl, flue stacks, panels in the two holes of row 3),
part-jaw (titanium bar under the chin; drops with boss.open), part-core (the slot lining and its
ember). Everything that overlaps a cell sits behind the brick plane (z <= -11).
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bosslib as L  # noqa: E402

ROWS = [
    '............',
    '..BBBBBBBB..',
    '.BBBBBBBBBB.',
    '.BB.BBBB.BB.',
    '.BBBBBBBBBB.',
    '.BB..WW..BB.',
    '.BBAAAAAABB.',
]
CW, CH = 60, 30
HALF = 296          # every node inside x +-296: + SWAY 60 = 356, inside the walls at +-360

head_cells = [(r, c) for r, row in enumerate(ROWS) for c, ch in enumerate(row) if ch == 'B']
ar = sum(r for r, _ in head_cells) / len(head_cells)
ac = sum(c for _, c in head_cells) / len(head_cells)


def cx(c):
    return (c - ac) * CW


def cy(r):
    return -(r - ar) * CH


cells = [(cx(c), cy(r), CW, CH, ch) for r, row in enumerate(ROWS) for c, ch in enumerate(row) if ch in 'BAW']
top = max(cy(r) + CH / 2 for r, row in enumerate(ROWS) if 'B' in row)       # +77.7
chin = min(cy(r) - CH / 2 for r, row in enumerate(ROWS) if 'A' in row)      # -102.3
# the mouth row: open cells and the core, one slot
MOUTH_ROW = 5
mouth = [c for c, ch in enumerate(ROWS[MOUTH_ROW]) if ch == 'W' or (ch == '.' and 0 < c < len(ROWS[0]) - 1)]
SX0, SX1 = cx(min(mouth)) - CW / 2, cx(max(mouth)) + CW / 2                  # -180 .. 180
SY0, SY1 = cy(MOUTH_ROW) - CH / 2, cy(MOUTH_ROW) + CH / 2                    # -72.3 .. -42.3
holes = [(cx(c), cy(r)) for r, row in enumerate(ROWS) for c, ch in enumerate(row)
         if ch == '.' and 0 < r < len(ROWS) - 1 and r != MOUTH_ROW and 0 < c < len(row) - 1
         and row[c - 1] == 'B' and row[c + 1] == 'B']

FACE_Z = -12        # the body's matte face, just behind the bricks (z -9 .. 9)
BACK_Z = -128
L.reset()

# ---- part-head
T, M = 'titanium', 'matte'
head = L.Part('head')
# body: one matte face behind every cell, titanium sides, very deep; shoulders step in beside the
# narrower top row; its top runs up inside the cowl
m = 2.0                                       # the slot opening is 2 units larger than the cells
ox0, ox1, oy0, oy1 = SX0 - m, SX1 + m, SY0 - m, SY1 + m
y_low, y_sh, y_top = chin - 10, top - 30, top + 14
x_top = max(abs(cx(c)) + CW / 2 for c, ch in enumerate(ROWS[1]) if ch == 'B') + 4      # 244
body = [(-HALF, y_low), (HALF, y_low), (HALF, y_sh), (x_top, y_top), (-x_top, y_top), (-HALF, y_sh)]
body_part = L.Part('head-body')
body_part.prism(body, BACK_Z, FACE_Z, M, T)
# the mouth slot is carved out of the body: matte walls taper from the opening in the face to a
# narrower pocket 84 units behind it, where part-core holds the ember (ART 1, 14: the heat is
# deep inside, never on the face)
DEEP = -96
ix0, ix1 = SX0 + 30, SX1 - 30                  # pocket 300 x 18
iy0, iy1 = (SY0 + SY1) / 2 - 9, (SY0 + SY1) / 2 + 9
slot = L.Part('cut-slot')
slot.loft([(ox0, oy0, FACE_Z + 2), (ox1, oy0, FACE_Z + 2), (ox1, oy1, FACE_Z + 2), (ox0, oy1, FACE_Z + 2)],
          [(ix0, iy0, DEEP - 1), (ix1, iy0, DEEP - 1), (ix1, iy1, DEEP - 1), (ix0, iy1, DEEP - 1)], M)
# cowl: a heavy titanium hood over the head, its front leaning back as it rises (it catches the
# key light from above), sloped shoulders, very deep. It sits above the top row, clear of the
# cells, so its brow may come forward of the bricks.
c0, c1 = top + 8, top + 84                    # 85.7 .. 161.7
# a slight lean only: leaning further back turned the brow to the key light and the sky of C's
# environment, and the whole cowl read near white in the game, close to the ball
z_front = lambda y: 12 - (y - c0) * 0.12       # noqa: E731  12 at the brow, about 3 at the top
arch = []
N_ARCH = 96
for k in range(N_ARCH + 1):                   # shoulders and crown: a flattened arch
    t = k / N_ARCH
    a = math.pi * t
    x = -math.cos(a) * HALF
    y = c0 + 22 + (c1 - c0 - 22) * math.sin(a) ** 0.55
    arch.append((x, y))
outline = [(-HALF, c0), (HALF, c0)] + list(reversed(arch))
front = [(x, y, z_front(y)) for x, y in outline]
back = [(x, y, -150.0) for x, y in outline]
head.loft(front, back, T)
# flue stacks: dark-metal tubes rising from the cowl's crown, set back from its brow, each standing
# in a titanium boot
def crown_y(x):
    return c0 + 22 + (c1 - c0 - 22) * math.sin(math.acos(-x / HALF)) ** 0.55


for s in (-1, 1):
    fx = s * 168
    crown = crown_y(fx)
    head.cylinder(fx, crown + 8, -82, 38, 34, 'y', T, segs=64)            # boot, sunk into the cowl
    head.cylinder(fx, crown + 70, -82, 26, 120, 'y', 'metal', segs=64)    # tube, top at crown + 130
# a raised spine along the crown between the stacks, set back from the brow: one more machined
# mass so the hood is not one flat plate
spine = []
for k in range(49):
    x = -112 + 224 * k / 48
    spine.append((x, crown_y(x) + 14 - 10 * (x / 112) ** 2))
sp = [(112, crown_y(112) - 12), (-112, crown_y(-112) - 12)]
sp_outline = [sp[1], sp[0]] + list(reversed(spine))
head.loft([(x, y, -34.0) for x, y in sp_outline], [(x, y, -128.0) for x, y in sp_outline], T)
# the two holes in row 3 (B's layout) hold titanium plates the size of a head plate, their fronts
# 1 unit behind the bricks' (+9): the armour reads as one field, nothing looks out (no eyes)
for hx, hy in holes:
    head.box(hx, hy, (FACE_Z + 8) / 2, CW - 4, CH - 4, 8 - FACE_Z, T)
head_ob = L.merge('head', [head.build(), body_part.build(cutters=[slot])])

# ---- part-jaw: the chin row's hinge bar (drops by boss.open * 60 in C), titanium, deep
jaw = L.Part('jaw')
jx = max(abs(cx(c)) + CW / 2 for c, ch in enumerate(ROWS[6]) if ch == 'A')      # 180
jy = chin - 14
jaw.box(0, jy, -16, 2 * jx + 32, 24, 48, T)                 # front at z +8, clear of the cells
for s in (-1, 1):
    jaw.cylinder(s * 150, jy, -56, 13, 48, 'x', 'metal', segs=48)   # hinge knuckles behind the bar
jaw_ob = jaw.build()

# ---- part-core: the heat at the back of the slot's pocket, one ember strip facing the camera
core = L.Part('core')
e = 2.5                                        # clear of the pocket's bevelled corners
core.quad([(ix0 + e, iy0 + e, DEEP), (ix1 - e, iy0 + e, DEEP), (ix1 - e, iy1 - e, DEEP), (ix0 + e, iy1 - e, DEEP)], 'ember')
core_ob = core.build(bevel=0, recalc=False)

objs = [head_ob, jaw_ob, core_ob]
L.export(objs, 'stoker')

if '--no-render' not in sys.argv:
    L.cells_overlay(cells)
    L.render_views('stoker', [
        ('front', (0, 0, 2000), (0, 20, 0), 820, None),
        ('three-quarter', (-900, 350, 1500), (0, 10, -40), None, None),
    ])
