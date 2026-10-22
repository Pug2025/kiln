"""Shared helpers for the boss meshes (Blender headless only; never the shared GUI instance).

Run a boss script like:
  /Applications/Blender.app/Contents/MacOS/Blender -b --python tools/art/boss_stoker.py

Units and axes: 1 unit = 1 field unit. The helpers take three.js-style coordinates (x right, y up,
z toward the camera) and place geometry in Blender as (x, -z, y); the glTF exporter with +Y up
turns that back into three.js axes. The origin is the boss anchor (world.boss.x / y).
Materials are named titanium, matte, metal and ember so the renderer can swap its own in by name.
`ember` is the dim heat glow behind the weak-point cells (eyes, throat, core housings): deep orange,
well under the white-hot W cells, so the weak point stays the hottest thing on every boss. No mesh
uses a `core` material: the W cells themselves are the white heat.
"""
import math
import os

import bmesh
import bpy

# Headless only: reset() empties the scene, and the GUI Blender is shared with other sessions.
if not bpy.app.background:
    raise SystemExit('headless only: /Applications/Blender.app/Contents/MacOS/Blender -b --python tools/art/<script>.py')

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT_MODELS = os.path.join(ROOT, 'models')
OUT_SHEETS = os.path.join(ROOT, 'assets', 'generated')


def srgb(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c)


# ART.md section 2 / 8 material colours. `core` is the ceramic core (crackle) that C swaps for its own
# hot-core material: only The Core's sphere uses it, and only its gaps between the petals show.
MAT_SPEC = {
    'titanium': dict(color='#C0C4CA', metal=0.9, rough=0.38),
    'matte': dict(color='#0A0B0D', metal=0.0, rough=1.0),
    'metal': dict(color='#3A3E45', metal=0.9, rough=0.45),
    'ember': dict(color='#120A06', metal=0.0, rough=0.9, emit='#FF7A1A', scale=0.28),
    'core': dict(color='#383B41', metal=0.05, rough=0.8, emit='#FF7A1A', scale=0.6),
}
# ART 15.5 F1: every hard edge carries a 1.5-unit bevel in two segments
BEVEL, BEVEL_SEGS = 1.5, 2
_mats = {}


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _mats.clear()


def mat(name):
    if name in _mats:
        return _mats[name]
    s = MAT_SPEC[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.use_backface_culling = True          # exported single-sided: closed meshes, half the fill cost
    bsdf = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Base Color'].default_value = (*srgb(s['color']), 1)
    bsdf.inputs['Metallic'].default_value = s['metal']
    bsdf.inputs['Roughness'].default_value = s['rough']
    if 'emit' in s:
        # the scale goes into the colour (linear), strength stays 1: glTF then needs no extension
        e = tuple(v * s['scale'] for v in srgb(s['emit']))
        for key in ('Emission Color', 'Emission'):
            if key in bsdf.inputs:
                bsdf.inputs[key].default_value = (*e, 1)
                break
        if 'Emission Strength' in bsdf.inputs:
            bsdf.inputs['Emission Strength'].default_value = 1.0
    _mats[name] = m
    return m


def P(x, y, z):
    """three.js-style point -> Blender coordinates."""
    return (x, -z, y)


class Part:
    """One exported node `part-<name>`: a single mesh object that may hold several materials."""

    def __init__(self, name):
        self.name = 'part-' + name
        self.bm = bmesh.new()
        self.mats = []

    def _mi(self, m):
        if m not in self.mats:
            self.mats.append(m)
        return self.mats.index(m)

    def _face(self, verts, mi):
        f = self.bm.faces.new(verts)
        f.material_index = mi
        f.smooth = False
        return f

    def prism(self, outline, z0, z1, m, sides=None):
        """Extrude a 2D outline (x, y list, counter-clockwise seen from the front) from z0 to z1.
        `m` is the front and back material; `sides` one material for every side face, or a list
        (side i joins outline[i] to outline[i + 1])."""
        back = [(x, y, z0) for x, y in outline]
        front = [(x, y, z1) for x, y in outline]
        self.loft(front, back, m, sides)

    def loft(self, front, back, m, sides=None):
        """Closed solid between two rings of 3D points (three.js axes, same count, counter-clockwise
        seen from the front): front cap, back cap and one side face per ring edge."""
        mi = self._mi(m)
        if sides is None:
            sides = m
        side = [self._mi(s) for s in sides] if isinstance(sides, (list, tuple)) else [self._mi(sides)] * len(front)
        f = [self.bm.verts.new(P(*p)) for p in front]
        b = [self.bm.verts.new(P(*p)) for p in back]
        self._face(f, mi)
        self._face(list(reversed(b)), mi)
        n = len(front)
        for i in range(n):
            j = (i + 1) % n
            self._face([b[i], b[j], f[j], f[i]], side[i])

    def quad(self, pts, m):
        """One face from 3D points (three.js axes), counter-clockwise seen from where it shows."""
        self._face([self.bm.verts.new(P(*p)) for p in pts], self._mi(m))

    def petal(self, R, z_top, thick, rho0, rho1, a0, a1, m, off=(0.0, 0.0), n_rho=10, n_a=12):
        """A domed plate: the cap of a sphere of radius R whose top (on the z axis) is at z_top,
        between radii rho0..rho1 from the axis and angles a0..a1 (degrees, counter-clockwise), `thick`
        units deep along z, then moved by `off` in x, y."""
        mi = self._mi(m)
        cz = z_top - R
        ox, oy = off

        def ring(z_shift):
            rows = []
            for i in range(n_rho + 1):
                rho = rho0 + (rho1 - rho0) * i / n_rho
                z = cz + math.sqrt(R * R - rho * rho) + z_shift
                row = []
                for j in range(n_a + 1):
                    a = math.radians(a0 + (a1 - a0) * j / n_a)
                    row.append(self.bm.verts.new(P(ox + rho * math.cos(a), oy + rho * math.sin(a), z)))
                rows.append(row)
            return rows

        top, bot = ring(0.0), ring(-thick)
        for i in range(n_rho):
            for j in range(n_a):
                self._face([top[i][j], top[i][j + 1], top[i + 1][j + 1], top[i + 1][j]], mi)
                self._face([bot[i][j], bot[i + 1][j], bot[i + 1][j + 1], bot[i][j + 1]], mi)
        for j in range(n_a):                      # outer rim and inner tip
            self._face([top[n_rho][j], top[n_rho][j + 1], bot[n_rho][j + 1], bot[n_rho][j]], mi)
            self._face([top[0][j + 1], top[0][j], bot[0][j], bot[0][j + 1]], mi)
        for i in range(n_rho):                    # the two radial edges (the gaps)
            self._face([top[i][0], top[i + 1][0], bot[i + 1][0], bot[i][0]], mi)
            self._face([top[i + 1][n_a], top[i][n_a], bot[i][n_a], bot[i + 1][n_a]], mi)

    def box(self, cx, cy, cz, sx, sy, sz, m):
        hx, hy = sx / 2, sy / 2
        self.prism([(cx - hx, cy - hy), (cx + hx, cy - hy), (cx + hx, cy + hy), (cx - hx, cy + hy)],
                   cz - sz / 2, cz + sz / 2, m)

    def arc(self, r0, r1, z0, z1, a0, a1, m, segs=None, cx=0.0, cy=0.0):
        """Annulus sector between radii r0..r1 and angles a0..a1 (degrees, counter-clockwise from +x)."""
        mi = self._mi(m)
        span = a1 - a0
        segs = segs or max(2, int(abs(span) / 6))
        full = abs(abs(span) - 360) < 1e-6
        rows = []
        count = segs if full else segs + 1
        for k in range(count):
            a = math.radians(a0 + span * k / segs)
            c, s = math.cos(a), math.sin(a)
            rows.append([self.bm.verts.new(P(cx + r * c, cy + r * s, z)) for r, z in ((r0, z0), (r1, z0), (r1, z1), (r0, z1))])
        n = len(rows)
        for k in range(n - 1 if not full else n):
            A, B = rows[k], rows[(k + 1) % n]
            for e in range(4):
                f = (e + 1) % 4
                self._face([A[e], B[e], B[f], A[f]], mi)
        if not full:
            self._face(list(reversed(rows[0])), mi)
            self._face(rows[-1], mi)

    def cylinder(self, cx, cy, cz, r, length, axis, m, segs=16):
        """Closed cylinder along axis 'x', 'y' or 'z' (three.js axes) centred at (cx, cy, cz)."""
        mi = self._mi(m)
        ends = []
        for t in (-length / 2, length / 2):
            ring = []
            for k in range(segs):
                a = 2 * math.pi * k / segs
                u, v = r * math.cos(a), r * math.sin(a)
                if axis == 'x':
                    p = (cx + t, cy + u, cz + v)
                elif axis == 'y':
                    p = (cx + u, cy + t, cz + v)
                else:
                    p = (cx + u, cy + v, cz + t)
                ring.append(self.bm.verts.new(P(*p)))
            ends.append(ring)
        a, b = ends
        self._face(list(reversed(a)), mi)
        self._face(b, mi)
        for k in range(segs):
            j = (k + 1) % segs
            self._face([a[k], a[j], b[j], b[k]], mi)

    def sphere(self, cx, cy, cz, r, m, subdiv=2):
        mi = self._mi(m)
        tmp = bmesh.new()
        bmesh.ops.create_icosphere(tmp, subdivisions=subdiv, radius=r)
        vmap = {}
        for v in tmp.verts:
            x, y, z = v.co.x, v.co.y, v.co.z
            vmap[v] = self.bm.verts.new(P(cx + x, cy + y, cz + z))
        for f in tmp.faces:
            self._face([vmap[v] for v in f.verts], mi)
        tmp.free()

    def build(self, bevel=BEVEL, collection=None, recalc=True, cutters=()):
        """Mesh object `part-<name>` with a two-segment bevel on every edge sharper than 35 degrees
        (curved surfaces stay as they are). recalc=False keeps the winding as written (open shells
        such as a slot lining, whose faces must point into the opening). `cutters` are Parts carved
        out of this one first (exact boolean; the cut faces take the cutter's material)."""
        bmesh.ops.remove_doubles(self.bm, verts=self.bm.verts, dist=1e-4)
        if recalc:
            bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces)
        me = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(me)
        self.bm.free()
        for m in self.mats:
            me.materials.append(mat(m))
        ob = bpy.data.objects.new(self.name, me)
        (collection or bpy.context.scene.collection).objects.link(ob)
        for k, cut in enumerate(cutters):
            cob = cut.build(bevel=0)
            cob.name = f'cutter-{self.name}-{k}'
            cob.hide_render = True
            cob.display_type = 'WIRE'
            mod = ob.modifiers.new(f'cut{k}', 'BOOLEAN')
            mod.operation = 'DIFFERENCE'
            mod.object = cob
            mod.solver = 'EXACT'
            try:
                mod.material_mode = 'TRANSFER'
            except (AttributeError, TypeError):
                pass
        if bevel > 0:
            mod = ob.modifiers.new('bevel', 'BEVEL')
            mod.width = bevel
            mod.segments = BEVEL_SEGS
            mod.limit_method = 'ANGLE'
            mod.angle_limit = math.radians(35)
            try:
                mod.harden_normals = False
                mod.miter_outer = 'MITER_ARC'
            except (AttributeError, TypeError):
                pass
        return ob


def bake(ob):
    """Apply an object's modifiers (boolean cuts, bevel) into its mesh."""
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    ob.modifiers.clear()
    old = ob.data
    ob.data = me
    bpy.data.meshes.remove(old)
    return ob


def merge(name, objs):
    """One node from several built parts: each is baked first (so a boolean cut stays on its own
    solid), then they are joined into the first, which takes the name `part-<name>`."""
    for o in objs:
        bake(o)
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = 'part-' + name
    ob.data.name = ob.name
    return ob


# UV density per material: field units per texture repeat (u, v). C maps its own textures onto the
# boss by material name (boss.js), so the UVs must suit C's maps, not any file of ours:
#   titanium: C's brushed canvas is 512 x 128 with horizontal grain, so 128 x 32 units per repeat
#             gives 4 texels per unit both ways and keeps the grain running left to right
#   matte:    C's matte carries the obsidian grain (1024 square), 64 x 64 units per repeat gives
#             16 texels per unit, close to the 18 per unit it gets across a brick face
#   metal, ember: no map in C today; a square 128 keeps them ready for one
#   core:     front-projected, one repeat per 90 units with the sphere's centre at uv (0.5, 0.5):
#             C's core shader is hottest at the uv centre (its `centre` term, gone by 0.62 uv from
#             it), so the sphere is white-hot only right behind the W cells and cools to heat-low
#             toward its edge (ART 15.4 R4), and the weak point stays the hottest thing; the crackle
#             repeats about twice across, near the brick faces' density
UV_UNITS = {'titanium': (128.0, 32.0), 'matte': (64.0, 64.0)}
UV_DEFAULT = (128.0, 128.0)
UV_CORE = 90.0


def box_uv(ob):
    """Apply the object's modifiers, then give every face a box-projected UV in three.js axes and
    field units: front and back faces take (x, y), side faces (z, y), top and bottom faces (x, z).
    Planar per face, so the brushed grain stays horizontal on every face that faces the camera."""
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    ob.modifiers.clear()
    old = ob.data
    ob.data = me
    bpy.data.meshes.remove(old)
    me.name = ob.name
    bm = bmesh.new()
    bm.from_mesh(me)
    uv = bm.loops.layers.uv.new('UVMap')
    for f in bm.faces:
        name = me.materials[f.material_index].name
        if name == 'core':
            for lp in f.loops:
                lp[uv].uv = (0.5 + lp.vert.co.x / UV_CORE, 0.5 + lp.vert.co.z / UV_CORE)
            continue
        su, sv = UV_UNITS.get(name, UV_DEFAULT)
        # Blender (x, y, z) holds three.js (x, -z, y)
        n = (abs(f.normal.x), abs(f.normal.z), abs(f.normal.y))
        axis = n.index(max(n))
        for lp in f.loops:
            x, y, z = lp.vert.co.x, lp.vert.co.z, -lp.vert.co.y
            u, v = ((z, y), (x, z), (x, y))[axis]
            lp[uv].uv = (u / su, v / sv)
    bm.to_mesh(me)
    bm.free()
    me.uv_layers.active = me.uv_layers[0]


# Every camera position the game (and the contact sheets) can reach, relative to the boss anchor,
# in three.js axes: the fit distance is 1800 or more (portrait phones pull back further, the intro
# dolly 1.07x), the lean moves the camera about 70 units sideways, the boss anchor sways and sits
# anywhere in the top half of the field, and the three-quarter sheet camera sits at (-900, 350, 1500).
# A face hidden from all eight corners is hidden from every point inside (the test is linear).
CAM_BOX = ((-1000.0, 1000.0), (-600.0, 600.0), (1000.0, 6000.0))
_CAM_CORNERS = [(x, y, z) for x in CAM_BOX[0] for y in CAM_BOX[1] for z in CAM_BOX[2]]


def cull_hidden(ob):
    """Triangulate, then drop zero-area triangles and every triangle that faces away from all the
    cameras in CAM_BOX. The materials are single-sided, so these never draw: about a quarter of each
    boss's triangles (the backs of closed prisms) for nothing. Returns (kept, dropped)."""
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.dissolve_degenerate(bm, dist=1e-3, edges=bm.edges[:])
    bmesh.ops.triangulate(bm, faces=bm.faces[:], quad_method='BEAUTY', ngon_method='BEAUTY')
    bm.normal_update()
    dead = []
    for f in bm.faces:
        if f.calc_area() < 1e-2:
            dead.append(f)
            continue
        # Blender (x, y, z) holds three.js (x, -z, y)
        n = (f.normal.x, f.normal.z, -f.normal.y)
        co = f.verts[0].co
        p = (co.x, co.z, -co.y)
        if all((c[0] - p[0]) * n[0] + (c[1] - p[1]) * n[1] + (c[2] - p[2]) * n[2] <= 0 for c in _CAM_CORNERS):
            dead.append(f)
    bmesh.ops.delete(bm, geom=dead, context='FACES')
    # nothing loose may reach the exporter (a loose edge would export as a LINES primitive)
    bmesh.ops.delete(bm, geom=[e for e in bm.edges if not e.link_faces], context='EDGES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    kept = len(bm.faces)
    bm.to_mesh(me)
    bm.free()
    return kept, len(dead)


def weighted_normals(ob):
    """Smooth shading with face-area weighted normals: big flat faces stay flat, the two-segment
    bevel strips between them turn smoothly (a round machined highlight, not two flat bands), and
    the exporter can share a vertex wherever the normals agree (about a third of the bytes of a
    flat-shaded mesh, so 4k to 15k triangles stay under the 400 KB cap)."""
    for p in ob.data.polygons:
        p.use_smooth = True
    mod = ob.modifiers.new('weighted', 'WEIGHTED_NORMAL')
    mod.mode = 'FACE_AREA'
    mod.weight = 100
    mod.keep_sharp = True


def export(objs, name):
    os.makedirs(OUT_MODELS, exist_ok=True)
    for o in objs:
        box_uv(o)
        kept, dropped = cull_hidden(o)
        weighted_normals(o)
        print('CULLED', o.name, dropped, 'hidden or degenerate triangles,', kept, 'kept')
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    path = os.path.join(OUT_MODELS, name + '.glb')
    kw = dict(filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_apply=True,
              export_materials='EXPORT', export_cameras=False, export_lights=False)
    try:
        bpy.ops.export_scene.gltf(**kw, export_texcoords=True)
    except TypeError:
        bpy.ops.export_scene.gltf(**kw)
    tris = 0
    for o in objs:
        dg = bpy.context.evaluated_depsgraph_get()
        me = o.evaluated_get(dg).to_mesh()
        me.calc_loop_triangles()
        tris += len(me.loop_triangles)
        o.evaluated_get(dg).to_mesh_clear()
    print('EXPORTED', path, os.path.getsize(path), 'bytes', tris, 'triangles')
    return path


def cells_overlay(cells, collection_name='cells'):
    """Reference brick cells (x, y, w, h, kind) as thin glass-like slabs, for contact sheets only."""
    col = bpy.data.collections.new(collection_name)
    bpy.context.scene.collection.children.link(col)
    colours = {'B': '#8A9099', 'A': '#C0C4CA', 'W': '#FF7A1A', 'P': '#8A9099'}
    made = {}
    for x, y, w, h, kind in cells:
        key = kind
        if key not in made:
            m = bpy.data.materials.new('cell-' + kind)
            m.use_nodes = True
            b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
            b.inputs['Base Color'].default_value = (*srgb(colours.get(kind, '#8A9099')), 1)
            b.inputs['Roughness'].default_value = 0.3
            if kind == 'W':
                for k in ('Emission Color', 'Emission'):
                    if k in b.inputs:
                        b.inputs[k].default_value = (*srgb('#FFD9A8'), 1)
                        break
                if 'Emission Strength' in b.inputs:
                    b.inputs['Emission Strength'].default_value = 4.0
            made[key] = m
        part = Part('cell')
        part.box(x, y, 0, w - 4, h - 4, 18, 'titanium')
        ob = part.build(collection=col)
        ob.name = 'cell'
        ob.data.materials[0] = made[key]
    return col


def render_views(name, views, size=(900, 900)):
    """Render each view (label, cam location three.js, look-at, ortho_scale or None, visible part names)."""
    sc = bpy.context.scene
    for eng in ('BLENDER_EEVEE', 'BLENDER_EEVEE_NEXT', 'CYCLES'):
        try:
            sc.render.engine = eng
            break
        except TypeError:
            continue
    try:
        sc.eevee.taa_render_samples = 32
    except AttributeError:
        pass
    sc.render.resolution_x, sc.render.resolution_y = size
    sc.render.image_settings.file_format = 'PNG'
    sc.view_settings.view_transform = 'AgX' if 'AgX' in [i.identifier for i in sc.view_settings.bl_rna.properties['view_transform'].enum_items] else 'Standard'
    world = bpy.data.worlds.new('w')
    world.use_nodes = True
    bg = next(n for n in world.node_tree.nodes if n.type == 'BACKGROUND')
    bg.inputs['Color'].default_value = (*srgb('#0F0D0C'), 1)
    bg.inputs['Strength'].default_value = 1.0
    sc.world = world
    # key from upper left front, cool rim from behind, warm fill from below (the kiln fire); once
    lights = () if bpy.data.objects.get('key') else (('key', 'SUN', 3.0, P(-300, 500, 700), '#D6DFEB'),
                                                       ('rim', 'SUN', 1.5, P(300, 300, -700), '#9FC4D8'),
                                                       ('fire', 'SUN', 1.2, P(0, -800, 300), '#FF7A1A'))
    for nm, kind, energy, loc, colr in lights:
        ld = bpy.data.lights.new(nm, kind)
        ld.energy = energy
        ld.color = srgb(colr)
        lo = bpy.data.objects.new(nm, ld)
        lo.location = loc
        sc.collection.objects.link(lo)
        tgt = bpy.data.objects.new(nm + '-t', None)
        sc.collection.objects.link(tgt)
        c = lo.constraints.new('TRACK_TO')
        c.target = tgt
        c.track_axis = 'TRACK_NEGATIVE_Z'
        c.up_axis = 'UP_Y'
    outs = []
    for label, cam_loc, look, ortho, visible in views:
        for o in sc.objects:
            if o.name.startswith('part-'):
                o.hide_render = visible is not None and o.name not in visible
        cd = bpy.data.cameras.new('cam-' + label)
        if ortho:
            cd.type = 'ORTHO'
            cd.ortho_scale = ortho
        else:
            cd.lens = 50
        cd.clip_end = 10000
        co = bpy.data.objects.new('cam-' + label, cd)
        co.location = P(*cam_loc)
        sc.collection.objects.link(co)
        tgt = bpy.data.objects.new('cam-t-' + label, None)
        tgt.location = P(*look)
        sc.collection.objects.link(tgt)
        c = co.constraints.new('TRACK_TO')
        c.target = tgt
        c.track_axis = 'TRACK_NEGATIVE_Z'
        c.up_axis = 'UP_Y'
        sc.camera = co
        path = os.path.join(OUT_SHEETS, f'boss-{name}-{label}.png')
        sc.render.filepath = path
        bpy.ops.render.render(write_still=True)
        outs.append(path)
        print('RENDERED', path)
    return outs


def orbit_rings():
    """B's rings as written in src/content/bosses/orbit.js, keyed by their group ('CRUCIBLE_PARTS.RING',
    'CORE_PARTS.INNER', 'CORE_PARTS.OUTER'), each a list of (r, slots, gaps) in file order. The meshes
    read them at build time, so a rebuild always follows B's latest gaps."""
    import re
    src = open(os.path.join(ROOT, 'src', 'content', 'bosses', 'orbit.js'), encoding='utf-8').read()
    out = {}
    pat = r'\{\s*r:\s*(\d+),\s*slots:\s*(\d+),\s*gaps:\s*\[([\d,\s]+)\][^}]*?group:\s*(\w+\.\w+)\s*\}'
    for r, slots, gaps, group in re.findall(pat, src):
        out.setdefault(group, []).append((int(r), int(slots), [int(g) for g in gaps.split(',') if g.strip()]))
    assert out.get('CRUCIBLE_PARTS.RING') and out.get('CORE_PARTS.OUTER'), 'orbit.js rings not found'
    return out


def ring_track_gaps(r, slots, gaps):
    """Open arcs (mesh degrees, counter-clockwise) for a ring of 30-unit plates with empty slots.
    Field bearings turn clockwise on screen (y down), so mesh angle = -field bearing."""
    step = 360.0 / slots
    half = math.degrees(math.atan(15.0 / r))
    present = [k for k in range(slots) if k not in gaps]
    opens = []
    # find runs of missing slots (cyclic)
    missing = sorted(gaps)
    runs = []
    for k in missing:
        if runs and (k - runs[-1][-1]) == 1:
            runs[-1].append(k)
        else:
            runs.append([k])
    if len(runs) > 1 and runs[0][0] == 0 and runs[-1][-1] == slots - 1:
        runs[0] = runs[-1] + runs[0]
        runs.pop()
    for run in runs:
        before = (run[0] - 1) % slots
        after = (run[-1] + 1) % slots
        f0 = before * step + half            # field bearing where the open arc starts
        f1 = after * step - half
        if f1 < f0:
            f1 += 360
        opens.append((-f1, -f0))             # mesh angles (a0 < a1)
    assert present
    return opens


def ring_solid_arcs(opens):
    """Complement of open arcs on the circle, as (a0, a1) mesh-degree spans."""
    spans = sorted(((a0 % 360), (a0 % 360) + (a1 - a0)) for a0, a1 in opens)
    solids = []
    for i, (s0, s1) in enumerate(spans):
        n0 = spans[(i + 1) % len(spans)][0] + (360 if i + 1 == len(spans) else 0)
        solids.append((s1, n0))
    return solids
