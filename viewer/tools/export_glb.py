import bpy, math, os, collections, json, re, bmesh
import numpy as np
from mathutils import Vector

OUT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'public', 'apartment.glb'))
MANIFEST = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'public', 'apartment.objects.json'))
os.makedirs(os.path.dirname(OUT), exist_ok=True)

X0, X1, Y0, Y1 = 0.4, 16.8, 0.6, 11.6
CAP = 900
# objects at least this big stay separate and clickable; smaller ones are merged per colour
LARGE_MIN = 0.3
EXCLUDE_EXACT = {'Line018', 'Line2000006702'}
WALL_OBJ = 'Layer:0.013'
FLOOR_OBJ = 'ApartmentFloor'
GLASS_OBJ_KEYS = ['glazing', 'window', 'glass']

# ---------- edit batch (sanitised three.js names) ----------
def san(name):
    return re.sub(r'\s', '_', name).replace('[', '').replace(']', '').replace('.', '').replace(':', '').replace('/', '')

# individual objects to remove; Apt_small_c01 / c11 are removed as whole groups below
REMOVE = {
    "Artists'_Workspace_023", 'POT_19062020_BLACK_L', 'HOWEA_PALM_20062020_XL001',
    'POT_17062020_XXL', 'Box002', 'Plane010', 'Plane001', 'Plane005', 'Circle003',
    'Seat_02', 'Seat_01', 'Pillow_01', 'Legs_01', 'Box004002', 'WT03_iMac',
    'WT03_Picture_2', 'WT03_Picture_1', 'OliveBranch_in_vase', 'Object047',
    'Line517', 'Line516', 'Box2131644734', 'pouf001', 'Minotti_Damier_Ottomans_015',
    'Minotti_Damier_Ottomans_023', 'Plane457', 'Plane456', 'Plane453', 'Plane448',
    'Plane455', 'Cylinder374', 'Tube212', 'Box2131644733', 'POT_17062020_XL001',
    'HOWEA_PALM_20062020_XL', 'POT_17062020_XL', 'frangipani_20062020',
    'Plane009001', 'Plane014', 'Plane011', 'Circle169', 'Rectangle4407',
    'Rectangle4408', 'Circle170', 'Rectangle4413', 'Rectangle4412', 'Object016',
    'Box004', 'Object020', 'succulent_POT', 'tray', 'Pan_front001', 'Pan_grid001',
    'Line1789551233', 'Pan_Back001', 'Pan_sensor_top001', 'Plane1211', 'Plane1213',
    'Line877526393', 'Line062', 'Line877526394', 'Loft026', 'Bogema_collector_112',
    'Tezza_Rollo_Disco_270_right001', 'Picola_52561030', 'Line877526395', 'Shape032',
    # second batch
    'ChamferCyl001', 'Base_01', 'Minotti_Damier_Ottomans_021', 'Minotti_Damier_Ottomans_018',
    'Plane013', 'Plane3503', 'Line180', 'Line2000006705', 'Plane1212',
    # third batch
    'Shape', 'Box003', 'BAMBOO_20062024_GOLD_XL', 'Loft034', 'Object027', 'Object026',
}
# merged groups of small objects to remove entirely (c02 deliberately kept)
REMOVE_GROUPS = {'c01', 'c11', 'c13', 'c15'}

# small decorative objects the size filter would drop, but which belong to a
# visible feature: the four pendant lamps hanging over the Maryland2 table
KEEP_ZONES = [
    ((3.30, 7.05, 1.10), (5.30, 8.55, 3.20)),
]


def in_keep_zone(o):
    c = o.matrix_world.translation
    for lo, hi in KEEP_ZONES:
        if lo[0] <= c.x <= hi[0] and lo[1] <= c.y <= hi[1] and lo[2] <= c.z <= hi[2]:
            return True
    return False

# bucket overrides: object -> target bucket
RECOLOR = {
    'Rectangle1174529065': 'white',
    'Object001': 'wall',
    'Object657725882': 'c05',
    'Object007001': 'c05',
    'Shape004': 'c05',
    'modern_kitchen_11_075': 'c11',
    'modern_kitchen_11_095': 'c11',
    'Line2000006703': 'c09',
    # bathroom west wall: fully tiled with the same 120 x 60 tile as the hall
    'Line2000006704': 'tile',
    'Box2131642361': 'frosted',
    'Four_Pendant_Lights_amazing_set_vol21_008': 'lamp',
    'Four_Pendant_Lights_amazing_set_vol21_009': 'lamp',
    'Four_Pendant_Lights_amazing_set_vol21_010': 'lamp',
    # white 120 x 60 cm керамогранит: three floors, the bathroom wall and the
    # two kitchen splashbacks
    'Tile_hall': 'tile',
    'Tile_wc': 'tile',
    'Tile_bath': 'tile',
    'Box394': 'tile',
    'Box395': 'tile',
    # kitchen: white carcass + black worktop
    'Line017001': 'white',
    'modern_kitchen_11_045': 'black',
    # plain white finishes
    'Maryland2': 'white',
    'Object657725862': 'white',
    # curtains: Velvet Lux 10 (Souz-M), muted olive green
    'Plane003': 'curtain',
    'Plane007': 'curtain',
    'Plane1197': 'curtain',
    'Plane1202': 'curtain',
    'Plane1196': 'curtain',
}

# Velvet Lux 10 by Souz-M — sRGB #6C7A52 (olive green)
CURTAIN_RGB = (0x6c, 0x7a, 0x52)

LAMPS = {
    'Four_Pendant_Lights_amazing_set_vol21_008',
    'Four_Pendant_Lights_amazing_set_vol21_009',
    'Four_Pendant_Lights_amazing_set_vol21_010',
}

# halve the width of the wall-fireplace layers around the group's left edge
SCALE_X = ['moon_wall_k_33', 'moon_wall_k_37', 'moon_wall_k_31', 'moon_wall_k_30']
SCALE_X_FACTOR = 0.5

# quartz-vinyl herringbone floor: a single generated texture that covers the whole
# apartment exactly once, laid out as real 600 x 125 mm planks (see
# make_floor_herringbone.py)
FLOOR_TILE = os.path.abspath(os.path.join(os.path.dirname(__file__), 'floor_herringbone.jpg'))
FLOOR_META = os.path.abspath(os.path.join(os.path.dirname(__file__), 'floor_herringbone.json'))
with open(FLOOR_META) as _f:
    _fm = json.load(_f)
FLOOR_SPAN = (
    _fm['minx'], _fm['maxx'], _fm['miny'], _fm['maxy'],
)

# white 120 x 60 cm ceramic tile (see make_tile_texture.py).  One texture period
# covers 2.4 x 1.2 m, i.e. 2 x 2 tiles.
TILE_TEX = os.path.abspath(os.path.join(os.path.dirname(__file__), 'tile_white.jpg'))
TILE_UV = (2.4, 1.2)

MIRRORS = {
    'Box2131642354', 'Box2131642355', 'Box2131642376', 'Box2131642378',
    'Box2131642377', 'Box2131642365', 'Box2131642371', 'Box398',
}

# world-space cut planes for the objects that poke through walls:
# (point on plane, normal pointing to the side we keep)
CLIPS = {
    'Box395': ((1.2, 0.0, 0.0), (1.0, 0.0, 0.0)),          # keep x >= 1.2 (left facade)
    'Box040': ((0.0, 3.274, 0.0), (0.0, 1.0, 0.0)),        # keep y >= 3.274 (interior side)
    'Box001': ((0.0, 1.524, 0.0), (0.0, 1.0, 0.0)),        # keep y >= 1.524 (bottom facade)
    'Object657725861': ((0.0, 1.524, 0.0), (0.0, 1.0, 0.0)),
}

def srgb(v):
    return 12.92*v if v <= 0.0031308 else 1.055*(v**(1/2.4))-0.055

def lin(v):
    return v if v <= 0.0031308 else ((v + 0.055)/1.055)**2.4

def hex_of(c):
    return '#%02x%02x%02x' % tuple(int(max(0, min(1, srgb(x)))*255) for x in c[:3])

# ---------- average texture colour per material ----------
IMG_CACHE = {}
def material_color(m):
    if not m:
        return None
    if m.name in IMG_CACHE:
        return IMG_CACHE[m.name]
    col = tuple(m.diffuse_color)[:3]
    if m.use_nodes:
        bsdf = m.node_tree.nodes.get('Principled BSDF')
        if bsdf:
            inp = bsdf.inputs['Base Color']
            col = tuple(inp.default_value)[:3]
            if inp.is_linked:
                node = inp.links[0].from_node
                img = getattr(node, 'image', None)
                if img and img.size[0] > 0:
                    try:
                        img.scale(20, 20)
                        arr = np.empty(20*20*4, dtype=np.float32)
                        img.pixels.foreach_get(arr)
                        px = arr.reshape(-1, 4)
                        col = tuple(float(x) for x in px[:, :3].mean(axis=0))
                    except Exception as e:
                        print('IMGERr', m.name, e)
    IMG_CACHE[m.name] = col
    return col

# ---------- collect ----------
objs = []
for o in bpy.data.objects:
    if o.type != 'MESH' or o.name in EXCLUDE_EXACT:
        continue
    bb = [o.matrix_world @ Vector(c) for c in o.bound_box]
    mn = Vector((min(v.x for v in bb), min(v.y for v in bb), min(v.z for v in bb)))
    mx = Vector((max(v.x for v in bb), max(v.y for v in bb), max(v.z for v in bb)))
    cx, cy = (mn.x + mx.x) / 2, (mn.y + mx.y) / 2
    if not (X0 <= cx <= X1 and Y0 <= cy <= Y1):
        continue
    if len(o.data.polygons) == 0:
        continue
    objs.append(o)
print('COLLECTED', len(objs))

# bake all object transforms into mesh data before joining / exporting
bpy.ops.object.select_all(action='DESELECT')
for o in objs:
    o.select_set(True)
bpy.context.view_layer.objects.active = objs[0]
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
bpy.ops.object.select_all(action='DESELECT')
print('TRANSFORMS APPLIED')

# ---------- halve the fireplace width around the group's left edge ----------
scale_objs = [bpy.data.objects.get(n) for n in SCALE_X]
scale_objs = [o for o in scale_objs if o and o.type == 'MESH']
if scale_objs:
    pivot_x = min(
        (o.matrix_world @ v.co).x
        for o in scale_objs
        for v in o.data.vertices
    )
    for o in scale_objs:
        mw = o.matrix_world.copy()
        inv = mw.inverted()
        for v in o.data.vertices:
            w = mw @ v.co
            w.x = pivot_x + (w.x - pivot_x) * SCALE_X_FACTOR
            v.co = inv @ w
        o.data.update()
    print('SCALED_X', [o.name for o in scale_objs], 'pivot', round(pivot_x, 4))

# ---------- clip protruding objects at the wall plane ----------
def clip_mesh(o, plane_co, plane_no):
    bm = bmesh.new()
    bm.from_mesh(o.data)
    geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
    bmesh.ops.bisect_plane(
        bm, geom=geom, dist=1e-4,
        plane_co=Vector(plane_co),
        plane_no=Vector(plane_no).normalized(),
        clear_inner=True, clear_outer=False,
    )
    boundary = [e for e in bm.edges if e.is_boundary]
    if boundary:
        try:
            bmesh.ops.holes_fill(bm, edges=boundary)
        except Exception as e:
            print('FILL FAIL', o.name, e)
    bm.to_mesh(o.data)
    bm.free()
    o.data.update()
    return len(o.data.polygons)

removed_clip = set()
to_remove = []
for name, (co, no) in CLIPS.items():
    o = bpy.data.objects.get(name)
    if not o:
        print('CLIP MISSING', name)
        continue
    before = len(o.data.polygons)
    after = clip_mesh(o, co, no)
    print('CLIPPED', name, before, '->', after)
    if after == 0:
        removed_clip.add(o.name)
        to_remove.append(o)
objs = [o for o in objs if o.name not in removed_clip]
for o in to_remove:
    bpy.data.objects.remove(o, do_unlink=True)
bpy.context.view_layer.update()
print('AFTER CLIP', len(objs))

def obj_color(o):
    per = collections.Counter()
    for p in o.data.polygons:
        per[p.material_index] += 1
    cols = []
    for idx, cnt in per.items():
        if idx < len(o.data.materials):
            c = material_color(o.data.materials[idx])
            if c:
                cols.append((cnt, c))
    if not cols:
        return (0.6, 0.6, 0.6)
    tot = sum(c[0] for c in cols)
    return tuple(sum(c[0]*c[1][i] for c in cols)/tot for i in range(3))

# ---------- assign colour ----------
FLOOR_COL = (lin(0.78), lin(0.63), lin(0.47))
WALL_COL = (lin(0.95), lin(0.94), lin(0.92))
GLASS_COL = (lin(0.66), lin(0.78), lin(0.85))

items = []  # (obj, color, bucket)
for o in objs:
    n = o.name.lower()
    if o.name == WALL_OBJ:
        col = WALL_COL; bucket = 'wall'
    elif o.name == FLOOR_OBJ:
        col = FLOOR_COL; bucket = 'floor'
    elif any(k in n for k in GLASS_OBJ_KEYS):
        col = GLASS_COL; bucket = 'glass'
    else:
        col = obj_color(o)
        # lift crushed blacks a little so shapes stay readable
        lum = 0.2126*col[0] + 0.7152*col[1] + 0.0722*col[2]
        if lum < 0.012:
            col = tuple(c*1.0 + 0.012 for c in col)
        bucket = None
    items.append([o, col, bucket])

# ---------- palette (greedy seeds weighted by polygon count) ----------
def dist(a, b):
    return (a[0]-b[0])**2 + (a[1]-b[1])**2 + (a[2]-b[2])**2

seeds = []
weighted = sorted(((it[0], it[1]) for it in items if it[2] is None),
                  key=lambda x: -len(x[0].data.polygons))
for o, col in weighted:
    if len(seeds) >= 26:
        break
    if all(dist(col, s) > 0.006 for s in seeds):
        seeds.append(col)
print('SEEDS', len(seeds))

for it in items:
    if it[2] is None:
        col = it[1]
        best, bd = 0, 1e9
        for i, s in enumerate(seeds):
            d = dist(col, s)
            if d < bd:
                best, bd = i, d
        it[2] = 'c%02d' % best

# ---------- removals ----------
removed = 0
kept = []
for it in items:
    o, col, key = it
    drop = san(o.name) in REMOVE or (key in REMOVE_GROUPS and o.dimensions.length < LARGE_MIN)
    if drop and in_keep_zone(o):
        drop = False
    if drop:
        bpy.data.objects.remove(o, do_unlink=True)
        removed += 1
    else:
        kept.append(it)
items = kept
print('REMOVED', removed, 'LEFT', len(items))

# ---------- recolour / mirror overrides ----------
for it in items:
    key = RECOLOR.get(san(it[0].name))
    if key:
        it[2] = key
    if san(it[0].name) in MIRRORS:
        it[2] = 'mirror'

# ---------- materials ----------
def newmat(name, col, alpha=1.0, rough=0.82, metal=0.0, emissive=False):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (col[0], col[1], col[2], alpha)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    b.inputs['Alpha'].default_value = alpha
    if emissive:
        b.inputs['Emission Color'].default_value = (1.0, 0.85, 0.6, 1)
        b.inputs['Emission Strength'].default_value = 0.35
    if alpha < 1.0:
        m.blend_method = 'BLEND'
    m.diffuse_color = (col[0], col[1], col[2], alpha)
    return m


def make_floor_material():
    m = bpy.data.materials.new('Apt_floor')
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (1.0, 1.0, 1.0, 1.0)
    b.inputs['Roughness'].default_value = 0.55
    b.inputs['Metallic'].default_value = 0.0
    if os.path.exists(FLOOR_TILE):
        img = bpy.data.images.load(FLOOR_TILE, check_existing=True)
        img.colorspace_settings.name = 'sRGB'
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.location = (-420, 240)
        tex.image = img
        nt.links.new(tex.outputs['Color'], b.inputs['Base Color'])
    else:
        print('FLOOR TILE MISSING', FLOOR_TILE)
        b.inputs['Base Color'].default_value = (FLOOR_COL[0], FLOOR_COL[1], FLOOR_COL[2], 1.0)
    m.diffuse_color = (FLOOR_COL[0], FLOOR_COL[1], FLOOR_COL[2], 1.0)
    return m

def make_tile_material():
    """Glossy white ceramic: image texture repeats in both directions at
    real-world scale, UVs are baked per face in ensure_tile_uv()."""
    m = bpy.data.materials.new('Apt_tile')
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (1.0, 1.0, 1.0, 1.0)
    b.inputs['Roughness'].default_value = 0.24
    b.inputs['Metallic'].default_value = 0.0
    if os.path.exists(TILE_TEX):
        img = bpy.data.images.load(TILE_TEX, check_existing=True)
        img.colorspace_settings.name = 'sRGB'
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.location = (-420, 240)
        tex.extension = 'REPEAT'
        tex.image = img
        nt.links.new(tex.outputs['Color'], b.inputs['Base Color'])
    else:
        print('TILE TEXTURE MISSING', TILE_TEX)
        b.inputs['Base Color'].default_value = (lin(0.95), lin(0.95), lin(0.94), 1.0)
    m.diffuse_color = (lin(0.95), lin(0.95), lin(0.94), 1.0)
    return m


def ensure_tile_uv(o):
    """World-space tiling UVs at 1.2 x 0.6 m per tile.

    Horizontal faces take X/Y, vertical faces take Z as the 1.2 m direction so
    the tiles read as vertical 60 x 120 cm on walls.  The grid starts at the
    object's own lower corner, so every surface begins with a whole tile.
    """
    span_u, span_v = TILE_UV
    bb = [o.matrix_world @ Vector(c) for c in o.bound_box]
    mn = Vector((min(v.x for v in bb), min(v.y for v in bb), min(v.z for v in bb)))
    uv = o.data.uv_layers.get('UVMap') or o.data.uv_layers.new(name='UVMap')
    o.data.uv_layers.active = uv
    for p in o.data.polygons:
        n = p.normal
        for li in p.loop_indices:
            co = o.data.vertices[o.data.loops[li].vertex_index].co
            if abs(n.z) > 0.7:
                u = (co.x - mn.x) / span_u
                v = (co.y - mn.y) / span_v
            elif abs(n.y) >= abs(n.x):
                u = (co.z - mn.z) / span_u
                v = (co.x - mn.x) / span_v
            else:
                u = (co.z - mn.z) / span_u
                v = (co.y - mn.y) / span_v
            uv.data[li].uv = (u, v)


mats = {}
all_keys = set(it[2] for it in items)
for key in sorted(all_keys):
    if key == 'wall':
        m = newmat('Apt_wall', WALL_COL, 1.0, 0.9)
    elif key == 'floor':
        m = make_floor_material()
    elif key == 'glass':
        m = newmat('Apt_glass', GLASS_COL, 0.18, 0.05, 0.0)
    elif key == 'white':
        m = newmat('Apt_white', (1.0, 1.0, 1.0), 1.0, 0.8)
    elif key == 'black':
        m = newmat('Apt_black', (0.012, 0.012, 0.014), 1.0, 0.36, 0.25)
    elif key == 'mirror':
        m = newmat('Apt_mirror', (1.0, 1.0, 1.0), 1.0, 0.03, 1.0)
    elif key == 'frosted':
        m = newmat('Apt_frosted', (lin(0.80), lin(0.87), lin(0.92)), 0.55, 0.62, 0.0)
    elif key == 'curtain':
        m = newmat('Apt_curtain',
                   tuple(lin(c / 255.0) for c in CURTAIN_RGB), 1.0, 0.80, 0.0)
    elif key == 'lamp':
        # matte white pendant: off state must read as white, never black
        m = newmat('Apt_lamp', (0.93, 0.93, 0.905), 1.0, 0.52, 0.0)
    elif key == 'tile':
        m = make_tile_material()
    else:
        idx = int(key[1:])
        m = newmat('Apt_' + key, seeds[idx], 1.0, 0.8)
    mats[key] = m

# ---------- split large / small ----------
def is_large(o):
    return o.dimensions.length >= LARGE_MIN

FORCE_LARGE = set(RECOLOR.keys()) | MIRRORS | set(SCALE_X)
large_names = {it[0].name for it in items
               if is_large(it[0]) or it[0].name in (WALL_OBJ, FLOOR_OBJ)
               or san(it[0].name) in FORCE_LARGE}
large = [it for it in items if it[0].name in large_names]
small = [it for it in items if it[0].name not in large_names]
print('LARGE', len(large), 'SMALL', len(small))

def ensure_floor_uv(o):
    """Planar world-XY UVs that stretch the single generated herringbone texture
    across the whole floor bbox, so the layout is laid at real-world scale once
    and never repeats."""
    minx, maxx, miny, maxy = FLOOR_SPAN
    sx = maxx - minx
    sy = maxy - miny
    uv = o.data.uv_layers.get('UVMap') or o.data.uv_layers.new(name='UVMap')
    o.data.uv_layers.active = uv
    for loop in o.data.loops:
        v = o.data.vertices[loop.vertex_index].co
        uv.data[loop.index].uv = ((v.x - minx) / sx, (v.y - miny) / sy)


def prep(o, key):
    if o.name == FLOOR_OBJ:
        ensure_floor_uv(o)
    if key == 'tile':
        ensure_tile_uv(o)
    o.data.materials.clear()
    o.data.materials.append(mats[key])
    for p in o.data.polygons:
        p.material_index = 0
    n = len(o.data.polygons)
    if n > CAP:
        if o.data.users > 1:
            o.data = o.data.copy()
        mod = o.modifiers.new('dec', 'DECIMATE')
        mod.decimate_type = 'COLLAPSE'
        mod.ratio = CAP / n
        mod.use_collapse_triangulate = True
        bpy.context.view_layer.objects.active = o
        o.select_set(True)
        try:
            bpy.ops.object.modifier_apply(modifier=mod.name)
        except Exception as e:
            print('DEC FAIL', o.name, e)
        o.select_set(False)

# ---------- large objects: one mesh each, original name preserved ----------
final = []
for o, col, key in large:
    prep(o, key)
    o.data.name = o.name + '_mesh'
    if san(o.name) in RECOLOR or san(o.name) in MIRRORS:
        print('ASSIGN', o.name, '->', key, 'mat', o.data.materials[0].name)
    final.append(o)

# ---------- small objects: merged per colour bucket ----------
buckets = collections.defaultdict(list)
for it in small:
    buckets[it[2]].append(it)

for key, lst in buckets.items():
    bpy.ops.object.select_all(action='DESELECT')
    objs_list = [x[0] for x in lst]
    for o, col, k in lst:
        prep(o, key)
    for o in objs_list:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs_list[0]
    if len(objs_list) > 1:
        bpy.ops.object.join()
    j = bpy.context.view_layer.objects.active
    j.name = 'Apt_small_' + key
    j.data.name = 'Apt_small_' + key
    final.append(j)
    print('SMALL BUCKET', key, 'objs', len(objs_list), 'polys', len(j.data.polygons))

# ---------- manifest for the viewer / debugging ----------
manifest = []
for o in final:
    bb = [o.matrix_world @ Vector(c) for c in o.bound_box]
    mn = Vector((min(v.x for v in bb), min(v.y for v in bb), min(v.z for v in bb)))
    mx = Vector((max(v.x for v in bb), max(v.y for v in bb), max(v.z for v in bb)))
    d = mx - mn
    manifest.append({
        'id': o.name,
        'size': [round(d.x, 2), round(d.y, 2), round(d.z, 2)],
        'center': [round((mn.x+mx.x)/2, 2), round((mn.y+mx.y)/2, 2), round((mn.z+mx.z)/2, 2)],
        'polys': len(o.data.polygons),
    })
manifest.sort(key=lambda r: -max(r['size']))
json.dump(manifest, open(MANIFEST, 'w'), ensure_ascii=False, indent=1)
print('MANIFEST', MANIFEST, len(manifest))

bpy.ops.object.select_all(action='DESELECT')
for o in final:
    o.select_set(True)
bpy.context.view_layer.objects.active = final[0]

if os.environ.get('APARTMENT_DRY') == '1':
    print('DRY RUN — skipping GLB export')
    raise SystemExit(0)

bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format='GLB',
    use_selection=True,
    export_apply=True,
    export_yup=True,
    export_materials='EXPORT',
    export_image_format='JPEG',
    export_image_quality=88,
    export_cameras=False,
    export_lights=False,
    export_extras=False,
    export_texcoords=True,
    export_normals=True,
    export_draco_mesh_compression_enable=True,
    export_draco_mesh_compression_level=6,
    export_draco_position_quantization=14,
    export_draco_normal_quantization=10,
    export_draco_texcoord_quantization=12,
)
print('EXPORTED', OUT, round(os.path.getsize(OUT)/1e6, 2), 'MB')
print('MESHES', len(final), 'TOTAL POLYS', sum(len(o.data.polygons) for o in final))
