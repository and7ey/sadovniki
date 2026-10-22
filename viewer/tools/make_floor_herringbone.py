#!/usr/bin/env python3
"""Generate a continuous herringbone floor texture (600 x 125 mm planks).

The layout is generated geometrically (not by repeating the source photo), so the
planks are laid at real-world scale across the whole apartment.  The source
`floor.jpeg` is used only as a wood surface: every plank gets a random crop of
its grain, random flips and a light tone jitter, so nothing repeats.

Output: tools/floor_herringbone.jpg  +  tools/floor_herringbone.json (mapping
info used by export_glb.py).
"""
import json
import math
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.abspath(os.path.join(HERE, '..', '..', 'floor.jpeg'))
OUT_IMG = os.path.join(HERE, 'floor_herringbone.jpg')
OUT_JSON = os.path.join(HERE, 'floor_herringbone.json')

# ---- floor bounds in Blender world space (ApartmentFloor bbox) ----
FLOOR_MIN_X, FLOOR_MAX_X = 1.45, 15.75
FLOOR_MIN_Y, FLOOR_MAX_Y = 1.55, 10.55
MARGIN = 0.25   # metres of texture beyond the floor edge

PLANK_L = 0.600   # 600 mm along the grain
PLANK_W = 0.125   # 125 mm across

# the whole layout is turned counter-clockwise by this angle (0 = planks run
# parallel to the walls)
ROTATE_DEG = 45.0
COS = math.cos(math.radians(ROTATE_DEG))
SIN = math.sin(math.radians(ROTATE_DEG))

TEX_W = 4096

minx = FLOOR_MIN_X - MARGIN
maxx = FLOOR_MAX_X + MARGIN
miny = FLOOR_MIN_Y - MARGIN
maxy = FLOOR_MAX_Y + MARGIN
spanx = maxx - minx
spany = maxy - miny
TEX_H = int(round(TEX_W * spany / spanx))
PX = TEX_W / spanx            # pixels per metre
print('texture', TEX_W, TEX_H, 'px/m %.1f' % PX)

# ---------------------------------------------------------------- wood source
src = Image.open(SRC).convert('RGB')
# clean, seam-free sample planks from the photo (x0, y0, x1, y1)
SAMPLES = [
    (14, 14, 776, 154),
    (16, 178, 570, 320),
    (16, 344, 448, 486),
    (806, 14, 940, 700),
]
tiles = []
for (x0, y0, x1, y1) in SAMPLES:
    im = src.crop((x0, y0, x1, y1))
    if im.height > im.width:          # make every sample horizontal
        im = im.rotate(90, expand=True)
    tiles.append(im)
print('samples', [(t.width, t.height) for t in tiles])

PLANK_PX_W = max(8, int(round(PLANK_W * PX)))
PLANK_PX_H = max(8, int(round(PLANK_L * PX)))
print('plank px', PLANK_PX_W, PLANK_PX_H)

# ---------------------------------------------------------------- layout
# Herringbone staircase: horizontal planks in rows of PLANK_W, each row shifted
# by one fifth of the plank length; vertical planks fill the column band to the
# right of every horizontal plank end.  Fifth of a length = exact period.
L = PLANK_L / PLANK_W          # 4.8
S = L / 5                      # staircase drift per row (in plank widths)
BAND = L + 4 * S + PLANK_W / PLANK_W   # one band's row coverage (in widths)

r0 = int(np.floor(miny / PLANK_W)) - 1
r1 = int(np.ceil(maxy / PLANK_W)) + 8
BANDW = BAND * PLANK_W
# the staircase drifts left as rows go up, so cover the extra bands that the
# upper rows push outside the bounding box
extra = int(np.ceil(r1 * S * PLANK_W / BANDW)) + 3
k0 = int(np.floor(minx / BANDW)) - 2 - extra
k1 = int(np.ceil(maxx / BANDW)) + 2 + extra

# when the pattern is turned, planks from outside the texture rectangle swing
# into view: widen the generated area to the texture's circumscribed square
CX, CY = (minx + maxx) / 2, (miny + maxy) / 2
DIAG = ((maxx - minx) ** 2 + (maxy - miny) ** 2) ** 0.5
if ROTATE_DEG % 180:
    pad = DIAG / 2
    r0 = int(np.floor((CY - pad) / PLANK_W)) - 1
    r1 = int(np.ceil((CY + pad) / PLANK_W)) + 8
    extra = int(np.ceil(abs(r1) * S * PLANK_W / BANDW)) + 3
    k0 = int(np.floor((CX - pad) / BANDW)) - 2 - extra
    k1 = int(np.ceil((CX + pad) / BANDW)) + 2 + extra

planks = []   # (x0, y0, x1, y1, is_vertical)
for k in range(k0, k1):
    for r in range(r0, r1):
        ex = k * BAND * PLANK_W - r * S * PLANK_W
        y = r * PLANK_W
        # horizontal plank whose right end is at ex
        planks.append((ex - PLANK_L, y, ex, y + PLANK_W, False))
        # vertical plank filler at that column
        planks.append((ex, y, ex + PLANK_W, y + PLANK_L, True))

# keep only planks that can reach the texture area (with a small bleed); when
# the layout is turned, that area is the texture's circumscribed square
keep_minx, keep_maxx, keep_miny, keep_maxy = minx - 0.4, maxx + 0.4, miny - 0.4, maxy + 0.4
if ROTATE_DEG % 180:
    keep_minx, keep_maxx = CX - DIAG / 2 - 0.4, CX + DIAG / 2 + 0.4
    keep_miny, keep_maxy = CY - DIAG / 2 - 0.4, CY + DIAG / 2 + 0.4
keep = []
for p in planks:
    if p[2] <= keep_minx or p[0] >= keep_maxx:
        continue
    if p[3] <= keep_miny or p[1] >= keep_maxy:
        continue
    keep.append(p)
planks = keep
print('planks', len(planks))

# ---------------------------------------------------------------- render
rng = np.random.default_rng(20261021)
canvas = Image.new('RGB', (TEX_W, TEX_H), (150, 122, 88))
draw = ImageDraw.Draw(canvas)

def to_px(x, y):
    return (x - minx) * PX, (maxy - y) * PX

for (x0, y0, x1, y1, vertical) in planks:
    w = max(2, int(round((x1 - x0) * PX)))
    h = max(2, int(round((y1 - y0) * PX)))
    tile = tiles[int(rng.integers(0, len(tiles)))]
    if vertical:
        # grain must run along the plank's long axis
        tile = tile.rotate(90, expand=True)
    # random grain window with the plank aspect ratio
    ar = w / h
    tw, th = tile.size
    cw = tw
    ch = int(round(cw / ar))
    if ch > th:
        ch = th
        cw = int(round(ch * ar))
    cw = max(8, min(cw, tw))
    ch = max(8, min(ch, th))
    ox = int(rng.integers(0, tw - cw + 1))
    oy = int(rng.integers(0, th - ch + 1))
    plank = tile.crop((ox, oy, ox + cw, oy + ch)).resize((w, h), Image.LANCZOS)
    if rng.random() < 0.5:
        plank = plank.transpose(Image.FLIP_LEFT_RIGHT)
    if rng.random() < 0.5:
        plank = plank.transpose(Image.FLIP_TOP_BOTTOM)

    arr = np.asarray(plank).astype(np.float32)
    gain = float(rng.uniform(0.965, 1.035))
    tint = rng.normal(0.0, 0.007, 3)
    arr = arr * gain + (arr.mean(axis=(0, 1)) * tint)
    np.clip(arr, 0, 255, out=arr)
    plank = Image.fromarray(arr.astype(np.uint8)).convert('RGBA')

    # seam: thin dark line on the plank's own edge
    edge = tuple(int(v) for v in (np.asarray(plank).reshape(-1, 4)[:, :3].mean(axis=0) * 0.82))
    ImageDraw.Draw(plank).rectangle([0, 0, w - 1, h - 1], outline=edge + (255,))

    if ROTATE_DEG % 360:
        # turn the plank about its own centre; the layout above is unchanged, so
        # the joints still meet exactly and only the whole carpet is rotated
        plank = plank.rotate(ROTATE_DEG, resample=Image.BICUBIC, expand=True)
        cwx, cwy = (x0 + x1) / 2.0, (y0 + y1) / 2.0
        dx, dy = cwx - CX, cwy - CY
        rx = CX + dx * COS - dy * SIN
        ry = CY + dx * SIN + dy * COS
    else:
        rx, ry = (x0 + x1) / 2.0, (y0 + y1) / 2.0

    px, py = to_px(rx, ry)
    px = int(round(px - plank.width / 2.0))
    py = int(round(py - plank.height / 2.0))
    canvas.paste(plank, (px, py), plank)

print('rendered planks')

# ---------------------------------------------------------------- gap fill
# The staircase leaves hairline gaps (a few mm) where a vertical plank meets the
# next band.  Real installers let the neighbouring plank run those few mm in;
# do the same by smearing the nearest plank colour into the empty pixels.
arr = np.asarray(canvas).astype(np.uint8)
bg = np.all(np.abs(arr.astype(np.int16) - np.array([150, 122, 88])) < 3, axis=2)
print('gap pixels', int(bg.sum()), '(%.4f%%)' % (100.0 * bg.mean()))
cur = arr.copy()
mask = bg.copy()
for _ in range(24):
    if not mask.any():
        break
    grown = cur.copy()
    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        shifted = np.roll(cur, (dy, dx), axis=(0, 1))
        smask = np.roll(mask, (dy, dx), axis=(0, 1))
        take = mask & ~smask
        grown[take] = shifted[take]
    # newly filled pixels stop being gaps
    filled = mask & ~np.all(np.abs(grown.astype(np.int16) - np.array([150, 122, 88])) < 3, axis=2)
    cur = grown
    mask = mask & ~filled
print('gaps left', int(mask.sum()))
canvas = Image.fromarray(cur)

canvas.save(OUT_IMG, quality=90, subsampling=1, optimize=True)
print('saved', OUT_IMG, os.path.getsize(OUT_IMG) // 1024, 'KB')

json.dump({
    'minx': minx, 'maxx': maxx, 'miny': miny, 'maxy': maxy,
    'plank_l': PLANK_L, 'plank_w': PLANK_W,
    'texture': (TEX_W, TEX_H),
}, open(OUT_JSON, 'w'), indent=1)
print('saved', OUT_JSON)
