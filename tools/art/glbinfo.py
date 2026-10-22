#!/usr/bin/env python3
"""Print each node of a .glb with its materials and its bounds in glTF / three.js axes (y up, z toward
the camera). Run from the repo root: python3 tools/art/glbinfo.py models/stoker.glb ..."""
import json
import struct
import sys

for path in sys.argv[1:]:
    with open(path, 'rb') as f:
        data = f.read()
    magic, version, length = struct.unpack_from('<III', data, 0)
    assert magic == 0x46546C67 and version == 2 and length == len(data), path
    jlen = struct.unpack_from('<I', data, 12)[0]
    g = json.loads(data[20:20 + jlen])
    print(path, len(data), 'bytes')
    for node in g['nodes']:
        if 'mesh' not in node:
            continue
        mesh = g['meshes'][node['mesh']]
        lo, hi, mats = [1e9] * 3, [-1e9] * 3, []
        for prim in mesh['primitives']:
            acc = g['accessors'][prim['attributes']['POSITION']]
            lo = [min(a, b) for a, b in zip(lo, acc['min'])]
            hi = [max(a, b) for a, b in zip(hi, acc['max'])]
            mats.append(g['materials'][prim['material']]['name'])
        t = node.get('translation', [0, 0, 0])
        print(f"  {node['name']:18s} mats {','.join(mats):28s} x {lo[0] + t[0]:7.1f}..{hi[0] + t[0]:7.1f}"
              f"  y {lo[1] + t[1]:7.1f}..{hi[1] + t[1]:7.1f}  z {lo[2] + t[2]:6.1f}..{hi[2] + t[2]:6.1f}"
              f"  rot {node.get('rotation', 'none')}")
