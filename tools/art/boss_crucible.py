"""The Crucible (level 20): a crucible's lip and a ring of 12 bevelled plates, in a cradle.
Headless Blender only:
  /Applications/Blender.app/Contents/MacOS/Blender -b --python tools/art/boss_crucible.py [-- --no-render]

ART 15.5 F1: the Crucible as a lip and ring of 12 bevelled plates; 120+ units deep, 1.5-unit
two-segment bevels, no glow on outer faces. Concept: assets/generated/image-20261022-090134-3038e0-
boss-crucible-lip-concept.png (reference only).

B's spec (src/content/bosses/orbit.js CRUCIBLE_SPEC, read at build time by bosslib.orbit_rings):
one ring of 30x30 titanium plates at r 150, 32 slots, a few empty (the gap; 23 to 26 on
2026-10-22), turning by boss.angle; the core is the 2x2 'W' block (120x60) at the centre.
Origin = the core centre (world.boss.x / y).
Nodes:
  part-core    the vessel: a thick titanium lip round a deep matte bowl, the molten pool (ember) at
               its floor 56 units behind the lip, a dark-metal body behind (static)
  part-ring    12 bevelled titanium plates carrying B's ring, open over B's gap
               (rotation.z = -boss.angle)
  part-cradle  the static bail under the ring, two pivots, two hangers to the top of the field, and
               the axles from the pivots to the vessel
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bosslib as L  # noqa: E402

(R, SLOTS, GAPS), = L.orbit_rings()['CRUCIBLE_PARTS.RING']   # B's CRUCIBLE_SPEC ring, read at build time
print('CRUCIBLE RING', R, SLOTS, GAPS)
T, M = 'titanium', 'matte'
SEG = 64

L.reset()

# ---- part-core: the vessel. The W block's corners are at r 67, so the lip starts at r 72.
LIP0, LIP1 = 72, 104
vessel = L.Part('core')
vessel.arc(LIP0, LIP1, -18, 6, 0, 360, T, segs=SEG)                     # the lip, its face at z +6
vessel.arc(LIP0 + 2, LIP1 - 4, -126, -18, 0, 360, 'metal', segs=SEG)   # the body behind it, deep
# bowl: a matte cone narrowing from the lip to the pool, its faces turned inward (seen into from
# the front), closed by the molten pool: one ember disc at the floor, 70 units behind the lip's
# face (the heat is inside, never on a surface)
POOL_Z, POOL_R = -64, 62
bowl = L.Part('core-bowl')
ring_hi = [(LIP0 * math.cos(2 * math.pi * k / SEG), LIP0 * math.sin(2 * math.pi * k / SEG), -18.0) for k in range(SEG)]
ring_lo = [(POOL_R * math.cos(2 * math.pi * k / SEG), POOL_R * math.sin(2 * math.pi * k / SEG), POOL_Z) for k in range(SEG)]
for k in range(SEG):
    j = (k + 1) % SEG
    bowl.quad([ring_hi[k], ring_hi[j], ring_lo[j], ring_lo[k]], M)
bowl.quad(ring_lo, 'ember')
core_ob = L.merge('core', [vessel.build(), bowl.build(recalc=False)])

# ---- part-ring: 12 bevelled titanium plates on B's ring, behind B's 30x30 plates (band r 135..165,
# corners to 166). The mesh band runs r 126..186, so its inner and outer edges show round the
# bricks; nothing of it lies over B's gap.
ring = L.Part('ring')
opens = L.ring_track_gaps(R, SLOTS, GAPS)
(s0, s1), = L.ring_solid_arcs(opens)
PLATES, SEAM = 12, 2.4
pitch = (s1 - s0 + SEAM) / PLATES
for k in range(PLATES):
    a0 = s0 + k * pitch
    ring.arc(126, 186, -46, -12, a0, a0 + pitch - SEAM, T, segs=10)
ring_ob = ring.build()

# ---- part-cradle: bail under the ring, pivots at the sides, hangers up to the field top, axles in
CR = 206
cradle = L.Part('cradle')
cradle.arc(CR - 12, CR + 12, -96, -60, 180, 360, 'metal', segs=64)     # the bail (lower half)
for s in (-1, 1):
    cradle.cylinder(s * CR, 0, -78, 24, 44, 'z', 'metal', segs=48)        # pivot hub, z -100 .. -56
    cradle.cylinder(s * (LIP1 + CR) / 2, 0, -78, 9, CR - LIP1, 'x', 'metal', segs=32)   # axle
    # hanger: a tapered titanium beam from the pivot up to the top of the field (anchor y 420)
    x0, x1, w0, w1 = s * CR, s * (CR + 34), 30, 22
    cradle.prism([(x0 - w0 / 2, 0), (x0 + w0 / 2, 0), (x1 + w1 / 2, 422), (x1 - w1 / 2, 422)], -92, -64, T)
cradle_ob = cradle.build()

L.export([ring_ob, core_ob, cradle_ob], 'crucible')

if '--no-render' not in sys.argv:
    step = 2 * math.pi / SLOTS
    cells = []
    for k in range(SLOTS):
        if k in GAPS:
            continue
        b = k * step
        cells.append((math.cos(b) * R, -math.sin(b) * R, 30, 30, 'P'))
    for dx in (-30, 30):
        for dy in (-15, 15):
            cells.append((dx, dy, 60, 30, 'W'))
    L.cells_overlay(cells)
    L.render_views('crucible', [
        ('front', (0, 0, 2000), (0, 40, 0), 900, None),
        ('three-quarter', (-900, 350, 1500), (0, 20, -40), None, None),
    ])
