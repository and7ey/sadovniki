"""Рендер квартиры: тёплый «доллхаус» из существующей сцены.

Геометрия не меняется: только камера, свет, мир, цветокоррекция и качество.

    blender -b blender_test/apartment_from_fbx.blend \
        --python viewer/tools/render_scene.py -- \
        --out render.png --samples 128 --res 1600x1000
"""
import bpy
import math
import sys
from mathutils import Vector, Euler

args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(name, default=None):
    key = "--" + name
    if key in args:
        i = args.index(key)
        if i + 1 < len(args):
            return args[i + 1]
    return default


OUT = arg("out", "render.png")
SAMPLES = int(arg("samples", "96"))
RX, RY = [int(v) for v in arg("res", "1600x1000").lower().split("x")]
EXPOSURE = float(arg("exposure", "0.4"))
SUN_ENERGY = float(arg("sun", "1.2"))
SUN_AZ = math.radians(float(arg("sunaz", "205")))
SUN_EL = math.radians(float(arg("sunel", "30")))
FILL = float(arg("fill", "70"))
FILL_SIZE = float(arg("fillsize", "1.2"))
WORLD_STR = float(arg("world", "0.05"))
CAM_AZ = math.radians(float(arg("az", "36")))
CAM_EL = math.radians(float(arg("el", "60")))
LENS = float(arg("lens", "52"))

sc = bpy.context.scene

# ---------- убрать посторонние полы, которые остались от другой сцены ----------
for name in ("Floor 02_Huyhieukts", "Floor 02_Huyhieukts001"):
    o = bpy.data.objects.get(name)
    if o:
        o.hide_render = True

# ---------- границы квартиры ----------
mn = Vector((1e9, 1e9, 1e9))
mx = Vector((-1e9, -1e9, -1e9))
for o in bpy.data.objects:
    if o.type != "MESH" or o.hide_render:
        continue
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c)
        for i in range(3):
            mn[i] = min(mn[i], w[i])
            mx[i] = max(mx[i], w[i])
center = (mn + mx) * 0.5
size = mx - mn
print("APARTMENT bbox", [round(v, 2) for v in mn], [round(v, 2) for v in mx])

# ---------- камера ----------
cam_data = bpy.data.cameras.new("BeautyCam")
cam_data.lens = LENS
cam_data.sensor_width = 36
cam = bpy.data.objects.new("BeautyCam", cam_data)
sc.collection.objects.link(cam)
sc.camera = cam

focus = arg("focus")
if focus:
    fx, fy = [float(v) for v in focus.split(",")]
    target = Vector((fx, fy, 1.0))
else:
    target = Vector((center.x, center.y, 0.9))

dirv = Vector((math.cos(CAM_EL) * math.sin(CAM_AZ), -math.cos(CAM_EL) * math.cos(CAM_AZ), math.sin(CAM_EL)))


def place(d):
    cam.location = target + dirv * d
    cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
    bpy.context.view_layer.update()


tan_x = math.tan(cam_data.angle_x / 2)
tan_y = math.tan(cam_data.angle_y / 2)
dist = 24.0
if arg("dist"):
    place(float(arg("dist")))
else:
    for _ in range(8):
        place(dist)
        worst = 0.001
        for sx in (mn.x, mx.x):
            for sy in (mn.y, mx.y):
                for sz in (0.0, mx.z):
                    co = cam.matrix_world.inverted() @ Vector((sx, sy, sz))
                    if co.z >= -0.1:
                        worst = max(worst, 2.0)
                        continue
                    worst = max(worst, abs(co.x / -co.z) / tan_x, abs(co.y / -co.z) / tan_y)
        if worst < 0.95:
            break
        dist *= worst / 0.95
    place(dist)

# ---------- мир ----------
world = sc.world or bpy.data.worlds.new("W")
sc.world = world
world.use_nodes = True
nt = world.node_tree
for n in list(nt.nodes):
    nt.nodes.remove(n)
out = nt.nodes.new("ShaderNodeOutputWorld")
bg = nt.nodes.new("ShaderNodeBackground")
grad = nt.nodes.new("ShaderNodeTexGradient")
ramp = nt.nodes.new("ShaderNodeValToRGB")
mapn = nt.nodes.new("ShaderNodeMapping")
texco = nt.nodes.new("ShaderNodeTexCoord")
bg.inputs["Strength"].default_value = WORLD_STR
ramp.color_ramp.elements[0].color = (0.10, 0.13, 0.20, 1)
ramp.color_ramp.elements[1].color = (0.32, 0.24, 0.20, 1)
nt.links.new(texco.outputs["Generated"], mapn.inputs["Vector"])
nt.links.new(mapn.outputs["Vector"], grad.inputs["Vector"])
nt.links.new(grad.outputs["Fac"], ramp.inputs["Fac"])
nt.links.new(ramp.outputs["Color"], bg.inputs["Color"])
nt.links.new(bg.outputs["Background"], out.inputs["Surface"])

# ---------- солнце ----------
sun_data = bpy.data.lights.new("BeautySun", "SUN")
sun_data.energy = SUN_ENERGY
sun_data.angle = math.radians(3.0)
sun_data.color = (1.0, 0.80, 0.60)
sun = bpy.data.objects.new("BeautySun", sun_data)
sc.collection.objects.link(sun)
sun_from = Vector((math.cos(SUN_EL) * math.sin(SUN_AZ), math.cos(SUN_EL) * math.cos(SUN_AZ), math.sin(SUN_EL)))
sun.rotation_euler = (-sun_from).to_track_quat("-Z", "Y").to_euler()

# ---------- тёплый свет по комнатам ----------
ROOM_PTS = [
    (3.6, 4.6), (6.2, 7.4), (9.0, 3.0), (11.5, 7.2),
    (13.6, 4.4), (14.4, 8.4), (5.0, 8.6), (2.6, 7.4),
]
for i, (x, y) in enumerate(ROOM_PTS):
    ld = bpy.data.lights.new("Fill%02d" % i, "AREA")
    ld.shape = "DISK"
    ld.size = FILL_SIZE
    ld.energy = FILL
    ld.color = (1.0, 0.80, 0.60)
    lo = bpy.data.objects.new("Fill%02d" % i, ld)
    lo.location = (x, y, 2.70)
    sc.collection.objects.link(lo)
    lo.rotation_euler = Euler((0, 0, 0), "XYZ")

# ---------- подложка ----------
m = bpy.data.materials.new("BeautyGround")
m.use_nodes = True
bsdf = m.node_tree.nodes.get("Principled BSDF")
bsdf.inputs["Base Color"].default_value = (0.035, 0.04, 0.05, 1)
bsdf.inputs["Roughness"].default_value = 0.95
bpy.ops.mesh.primitive_plane_add(size=80, location=(center.x, center.y, -0.32))
ground = bpy.context.active_object
ground.name = "BeautyGround"
ground.data.materials.append(m)

# ---------- рендер ----------
sc.render.engine = "CYCLES"
sc.cycles.samples = SAMPLES
sc.cycles.use_denoising = True
sc.cycles.max_bounces = 8
sc.cycles.diffuse_bounces = 4
sc.cycles.glossy_bounces = 3
sc.cycles.transmission_bounces = 4
sc.cycles.caustics_reflective = False
sc.cycles.caustics_refractive = False
sc.render.resolution_x = RX
sc.render.resolution_y = RY
sc.render.resolution_percentage = 100
sc.render.film_transparent = False
sc.view_settings.view_transform = "AgX"
try:
    sc.view_settings.look = arg("look", "AgX - Punchy")
except Exception:
    sc.view_settings.look = "AgX - Medium High Contrast"
sc.view_settings.exposure = EXPOSURE
sc.render.image_settings.file_format = "PNG"
sc.render.filepath = OUT

print("RENDER cam", [round(v, 1) for v in cam.location], "target", [round(v, 1) for v in target])
bpy.ops.render.render(write_still=True)
print("DONE", OUT)
