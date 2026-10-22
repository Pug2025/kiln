"""The Core (level 30, three stages): a crackled sphere of heat behind three titanium petals.
Headless Blender only:
  /Applications/Blender.app/Contents/MacOS/Blender -b --python tools/art/boss_core.py [-- --no-render]

ART 15.5 F1, 15.9 (as R4): a 180-unit crackled sphere behind three bevelled titanium petals with
12-degree gaps that part with the phase; no concentric rings. 120+ units deep, 1.5-unit two-segment
bevels, no glow on an outer face: the heat shows only through the gaps between the petals.
Concept: assets/generated/image-20261022-090156-3a5956-boss-core-petals-concept.png (reference).

B's specs (src/content/bosses/orbit.js CORE_SPECS, 2026-10-22): stage 1 ring r 110 (24 slots),
stage 2 r 130 (28), stage 3 r 95 (20) inside a counter-rotating ring r 165 (35 slots, gaps 26-29).
Those rings are B's 30x30 plates (bricks); the mesh is what they guard. Origin = the core centre.
Nodes (C's drive is unchanged: ARTKIT.md "Boss meshes"):
  part-core         the sphere, material `core` (C's crackle hot-core), front 40 units behind the
                    brick plane (static)
  part-shell        stage 1 petals, closed to 12-degree gaps          rotation.z = -boss.angle
  part-shell-s2     stage 2 petals, parted 9 units                    rotation.z = -boss.angle
  part-shell-s3     stage 3 petals, parted 18 units                   rotation.z = -boss.angle
  part-outer-shell  stage 3: three titanium keepers behind the outer ring, clear of its gap
                    rotation.z = -boss.data.angle2
  part-frame        three static struts holding the sphere (no ring)
Show part-shell in stage 1, part-shell-s2 in stage 2, part-shell-s3 and part-outer-shell in stage 3.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bosslib as L  # noqa: E402

OUTER = L.orbit_rings()['CORE_PARTS.OUTER'][-1]   # stage 3's outer ring, read from B's orbit.js at build time
print('CORE OUTER RING', OUTER)
T = 'titanium'

SPHERE_R, SPHERE_Z = 90, -130                # 180 across, front at z -40
PETAL = dict(R=240.0, z_top=-14.0, thick=12.0, rho0=3.0, rho1=104.0)
GAP = 12.0                                   # degrees between petals
# petals part along their middles each stage: a little more heat shows as the fight goes on, never
# so much that the sphere outshines the W cells (14 and 28 did, in the game)
PARTED = {'shell': 0.0, 'shell-s2': 9.0, 'shell-s3': 18.0}
L.reset()

# ---- part-core: the sphere, front-projected UV with its centre at uv (0.5, 0.5) (bosslib)
core = L.Part('core')
core.sphere(0, 0, SPHERE_Z, SPHERE_R, 'core', subdiv=4)
core_ob = core.build(bevel=0)

objs = [core_ob]
# ---- the petals: three domed plates, each 108 degrees wide, gaps at 90, 210 and 330 degrees
for name, d in PARTED.items():
    p = L.Part(name)
    for k in range(3):
        mid = 30 + 120 * k                        # petal centres 30, 150, 270
        a0, a1 = mid - 60 + GAP / 2, mid + 60 - GAP / 2
        off = (d * math.cos(math.radians(mid)), d * math.sin(math.radians(mid)))
        p.petal(PETAL['R'], PETAL['z_top'], PETAL['thick'], PETAL['rho0'], PETAL['rho1'], a0, a1, T,
                off=off, n_rho=10, n_a=16)
    objs.append(p.build())

# ---- part-outer-shell: three keepers riding behind B's outer ring (band r 150..180), spaced 120
# degrees and clear of the ring's gap, so the counter-rotation reads; short blocks, not a ring
r, slots, gaps = OUTER
(g0, g1), = L.ring_track_gaps(r, slots, gaps)
gap_mid = (g0 + g1) / 2
outer = L.Part('outer-shell')
for k in range(3):
    mid = gap_mid + 60 + 120 * k
    outer.arc(140, 194, -40, -12, mid - 9, mid + 9, T, segs=8)
objs.append(outer.build())

# ---- part-frame: three static struts from behind the sphere out to r 200 (The Core's stage 2
# anchor is at x 510, so nothing may reach past x +210), deep, tapered, no ring
frame = L.Part('frame')
for k in range(3):
    a = math.radians(90 + 120 * k)
    c, s = math.cos(a), math.sin(a)
    ux, uy = -s, c                                # across the strut
    r0, r1, w0, w1 = 60, 200, 34, 24
    pts = [(c * r0 + ux * w0 / 2, s * r0 + uy * w0 / 2), (c * r0 - ux * w0 / 2, s * r0 - uy * w0 / 2),
           (c * r1 - ux * w1 / 2, s * r1 - uy * w1 / 2), (c * r1 + ux * w1 / 2, s * r1 + uy * w1 / 2)]
    frame.prism(pts, -150, -104, 'metal')
    frame.box(c * 188, s * 188, -100, 30, 30, 20, T)    # a titanium foot at the strut's end
frame_ob = frame.build()
objs.append(frame_ob)

L.export(objs, 'core')

if '--no-render' not in sys.argv:
    def plates(r, slots, gaps):
        step = 2 * math.pi / slots
        return [(math.cos(k * step) * r, -math.sin(k * step) * r, 30, 30, 'P') for k in range(slots) if k not in gaps]
    w_s1 = [(dx, dy, 60, 30, 'W') for dx in (-30, 30) for dy in (-15, 15)]      # stage 1: 120x60
    w_s3 = [(dx, dy, 30, 30, 'W') for dx in (-15, 15) for dy in (-15, 15)]      # stage 3: 60x60
    s1 = ['part-core', 'part-shell', 'part-frame']
    s3 = ['part-core', 'part-shell-s3', 'part-outer-shell', 'part-frame']
    L.render_views('core', [
        ('front-bare-s1', (0, 0, 2000), (0, 0, 0), 520, s1),
        ('front-bare-s3', (0, 0, 2000), (0, 0, 0), 520, s3),
    ])
    L.cells_overlay(plates(110, 24, [23, 0, 1, 11, 12, 13]) + w_s1, 'cells-s1')
    L.render_views('core', [
        ('front-s1', (0, 0, 2000), (0, 0, 0), 520, s1),
        ('three-quarter-s1', (-900, 350, 1500), (0, 0, -40), None, s1),
    ])
