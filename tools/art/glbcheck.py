"""Headless Blender: import each .glb and print its objects, materials and bounds (Blender units).
Run: /Applications/Blender.app/Contents/MacOS/Blender -b --python tools/art/glbcheck.py -- models/a.glb ...
Builds an empty scene of its own, so it never touches the shared GUI Blender."""
import sys

import bpy

# Headless only: each file is checked in an emptied scene, and the GUI Blender is shared.
if not bpy.app.background:
    raise SystemExit('headless only: /Applications/Blender.app/Contents/MacOS/Blender -b --python tools/art/glbcheck.py -- <file.glb>')

files = sys.argv[sys.argv.index('--') + 1:]
for path in files:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    objs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    xs, ys, zs = [], [], []
    tris = 0
    for o in objs:
        for c in o.bound_box:
            w = o.matrix_world @ __import__('mathutils').Vector(c)
            xs.append(w.x)
            ys.append(w.y)
            zs.append(w.z)
        o.data.calc_loop_triangles()
        tris += len(o.data.loop_triangles)
    mats = sorted({m.name for o in objs for m in o.data.materials if m})
    print('GLBCHECK', path)
    print('  objects:', sorted(o.name for o in objs))
    print('  materials:', mats, 'triangles:', tris)
    if xs:
        print('  bounds x %.0f..%.0f  y(depth) %.0f..%.0f  z(up) %.0f..%.0f' % (min(xs), max(xs), min(ys), max(ys), min(zs), max(zs)))
