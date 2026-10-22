"""Tiny glTF 2.0 binary (.glb) writer for placeholder boss meshes (stdlib only, no Blender).

Each part is a node named `part-<name>` holding one box mesh. Materials are the final kit's set,
`titanium`, `matte`, `metal` and `ember` (ARTKIT.md "Boss meshes"), in linear colour, so C can
swap in its own by name and a regenerated placeholder passes tests/f-kit.test.mjs.
Units are field units, +Y up, +Z toward the camera (three.js axes), origin at the boss anchor.

  python3 tools/art/glb.py <out_dir>    writes stoker.glb, crucible.glb, core.glb placeholders there
"""
import json
import os
import struct
import sys

MATERIALS = {
    # name: (base colour linear RGBA, metallic, roughness, emissive linear RGB); ART.md sections 2 and 8
    'titanium': ((0.5271, 0.552, 0.5906, 1.0), 0.9, 0.38, (0.0, 0.0, 0.0)),     # #C0C4CA
    'matte': ((0.003, 0.0033, 0.004, 1.0), 0.0, 1.0, (0.0, 0.0, 0.0)),          # #0A0B0D
    'metal': ((0.0423, 0.0482, 0.0595, 1.0), 0.9, 0.45, (0.0, 0.0, 0.0)),       # #3A3E45
    'ember': ((0.006, 0.003, 0.0018, 1.0), 0.0, 0.9, (0.28, 0.0545, 0.0029)),   # #FF7A1A x 0.28
}


def box(cx, cy, cz, sx, sy, sz):
    """Return (positions, normals, indices) for an axis-aligned box, 24 vertices."""
    hx, hy, hz = sx / 2, sy / 2, sz / 2
    faces = [
        ((1, 0, 0), [(1, -1, -1), (1, 1, -1), (1, 1, 1), (1, -1, 1)]),
        ((-1, 0, 0), [(-1, -1, 1), (-1, 1, 1), (-1, 1, -1), (-1, -1, -1)]),
        ((0, 1, 0), [(-1, 1, -1), (-1, 1, 1), (1, 1, 1), (1, 1, -1)]),
        ((0, -1, 0), [(-1, -1, 1), (-1, -1, -1), (1, -1, -1), (1, -1, 1)]),
        ((0, 0, 1), [(-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)]),
        ((0, 0, -1), [(1, -1, -1), (-1, -1, -1), (-1, 1, -1), (1, 1, -1)]),
    ]
    pos, nrm, idx = [], [], []
    for n, quad in faces:
        base = len(pos)
        for (x, y, z) in quad:
            pos.append((cx + x * hx, cy + y * hy, cz + z * hz))
            nrm.append(n)
        idx += [base, base + 1, base + 2, base, base + 2, base + 3]
    return pos, nrm, idx


def merge(*meshes):
    pos, nrm, idx = [], [], []
    for p, n, i in meshes:
        base = len(pos)
        pos += p
        nrm += n
        idx += [base + k for k in i]
    return pos, nrm, idx


def write_glb(path, parts, scene_name='boss'):
    """parts: list of (node_name, material_name, (positions, normals, indices))."""
    bin_chunks = bytearray()
    accessors, views, meshes, nodes = [], [], [], []
    mat_names = list(MATERIALS)

    def add_view(data, target):
        while len(bin_chunks) % 4:
            bin_chunks.append(0)
        off = len(bin_chunks)
        bin_chunks.extend(data)
        views.append({'buffer': 0, 'byteOffset': off, 'byteLength': len(data), 'target': target})
        return len(views) - 1

    for name, mat, (pos, nrm, idx) in parts:
        pdata = b''.join(struct.pack('<3f', *p) for p in pos)
        ndata = b''.join(struct.pack('<3f', *n) for n in nrm)
        idata = b''.join(struct.pack('<H', i) for i in idx)
        pv = add_view(pdata, 34962)
        nv = add_view(ndata, 34962)
        iv = add_view(idata, 34963)
        mins = [min(p[k] for p in pos) for k in range(3)]
        maxs = [max(p[k] for p in pos) for k in range(3)]
        accessors.append({'bufferView': pv, 'componentType': 5126, 'count': len(pos), 'type': 'VEC3', 'min': mins, 'max': maxs})
        pa = len(accessors) - 1
        accessors.append({'bufferView': nv, 'componentType': 5126, 'count': len(nrm), 'type': 'VEC3'})
        na = len(accessors) - 1
        accessors.append({'bufferView': iv, 'componentType': 5123, 'count': len(idx), 'type': 'SCALAR'})
        ia = len(accessors) - 1
        meshes.append({'name': name, 'primitives': [{'attributes': {'POSITION': pa, 'NORMAL': na}, 'indices': ia, 'material': mat_names.index(mat)}]})
        nodes.append({'name': name, 'mesh': len(meshes) - 1})

    while len(bin_chunks) % 4:
        bin_chunks.append(0)
    materials = []
    for m in mat_names:
        col, metal, rough, emis = MATERIALS[m]
        materials.append({'name': m, 'pbrMetallicRoughness': {'baseColorFactor': list(col), 'metallicFactor': metal, 'roughnessFactor': rough}, 'emissiveFactor': list(emis)})
    root = {'name': scene_name, 'children': list(range(len(nodes)))}
    nodes.append(root)
    gltf = {
        'asset': {'version': '2.0', 'generator': 'kiln tools/art/glb.py'},
        'scene': 0,
        'scenes': [{'name': scene_name, 'nodes': [len(nodes) - 1]}],
        'nodes': nodes,
        'meshes': meshes,
        'materials': materials,
        'accessors': accessors,
        'bufferViews': views,
        'buffers': [{'byteLength': len(bin_chunks)}],
    }
    js = json.dumps(gltf, separators=(',', ':')).encode('utf-8')
    while len(js) % 4:
        js += b' '
    total = 12 + 8 + len(js) + 8 + len(bin_chunks)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(js), 0x4E4F534A))
        f.write(js)
        f.write(struct.pack('<II', len(bin_chunks), 0x004E4942))
        f.write(bin_chunks)
    return total


def boss_parts(kind):
    """Placeholder boxes with every node of B's BOSS_PARTS + BOSS_DRESSING (src/content/bosses.js)."""
    T, M, X, E = 'titanium', 'matte', 'metal', 'ember'
    if kind == 'stoker':
        return [
            ('part-head', T, box(0, 60, -20, 420, 240, 60)),
            ('part-jaw', M, box(0, -110, -20, 360, 70, 60)),
            ('part-core', E, box(0, -20, -40, 120, 80, 30)),
        ]
    if kind == 'crucible':
        plates = [box(200 * c, 200 * s, -20, 70, 70, 40) for c, s in
                  ((1, 0), (0.7071, 0.7071), (0, 1), (-0.7071, 0.7071), (-1, 0), (-0.7071, -0.7071), (0, -1), (0.7071, -0.7071))]
        return [
            ('part-cradle', X, box(0, -250, -40, 420, 40, 40)),
            ('part-ring', T, merge(*plates)),
            ('part-core', E, box(0, 0, -40, 110, 110, 40)),
        ]
    if kind == 'core':
        def track(r):
            return merge(box(-r, 0, -20, 30, 2 * r, 30), box(r, 0, -20, 30, 2 * r, 30))
        return [
            ('part-frame', X, box(0, 0, -60, 480, 480, 20)),
            ('part-core', E, box(0, 0, -40, 140, 140, 40)),
            ('part-shell', T, track(110)),
            ('part-shell-s2', T, track(130)),
            ('part-shell-s3', T, track(80)),
            ('part-outer-shell', M, track(160)),
        ]
    raise ValueError(kind)


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    os.makedirs(sys.argv[1], exist_ok=True)
    for kind in ('stoker', 'crucible', 'core'):
        n = write_glb(os.path.join(sys.argv[1], kind + '.glb'), boss_parts(kind), kind)
        print('wrote', kind + '.glb', n, 'bytes')
