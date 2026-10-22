"""Generate the white ceramic wall/floor tile texture (керамогранит 120 x 60 cm).

The image covers exactly 2 x 2 tiles = 2.4 x 1.2 m at 1000 px/m, so one full
texture period maps onto 2.4 m in U and 1.2 m in V.  Floor UVs use
u = x / 2.4, v = y / 1.2 (tiles 1.2 m along X, 0.6 m along Y); wall UVs swap the
axes so the long side of the tile is vertical (0.6 m wide, 1.2 m tall).

run: blender -b --python viewer/tools/make_tile_texture.py
"""
import os
import numpy as np
import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'tile_white.jpg')

W, H = 2400, 1200            # 1000 px / m
TILE_W, TILE_H = 1200, 600   # one 120 x 60 cm tile
GROUT_PX = 3.0               # 3 mm joint


def box_blur(a, r):
    """Separable box blur with a running sum (no scipy)."""
    if r < 1:
        return a
    k = 2 * r + 1
    pad = np.pad(a, r, mode='reflect')
    c = np.cumsum(pad, axis=0)
    c = np.vstack([np.zeros((1, c.shape[1])), c])
    a = (c[k:, :] - c[:-k, :]) / k
    c = np.cumsum(a, axis=1)
    c = np.hstack([np.zeros((c.shape[0], 1)), c])
    return (c[:, k:] - c[:, :-k]) / k


def main():
    rng = np.random.default_rng(20261022)

    base = np.array([0.958, 0.955, 0.947], dtype=np.float32)  # warm white, sRGB

    # --- per-tile tint variation (4 tiles in the 2x2 period) -----------------
    img = np.zeros((H, W, 3), dtype=np.float32)
    for ty in range(2):
        for tx in range(2):
            tint = 1.0 + rng.normal(0.0, 0.006)
            img[ty * TILE_H:(ty + 1) * TILE_H, tx * TILE_W:(tx + 1) * TILE_W] = base * tint

    # --- very soft cloudy glaze -------------------------------------------
    small = rng.normal(0.0, 1.0, (H // 24 + 2, W // 24 + 2)).astype(np.float32)
    cloud = np.repeat(np.repeat(small, 24, axis=0), 24, axis=1)[:H, :W]
    cloud = box_blur(box_blur(cloud, 40), 40)
    cloud /= (np.abs(cloud).max() + 1e-6)
    img += cloud[:, :, None] * 0.012

    # --- fine grain --------------------------------------------------------
    img += rng.normal(0.0, 0.0035, (H, W, 1)).astype(np.float32)

    # --- grout joints ------------------------------------------------------
    xs = np.arange(W) % TILE_W
    ys = np.arange(H) % TILE_H
    dx = np.minimum(xs, TILE_W - xs).astype(np.float32)
    dy = np.minimum(ys, TILE_H - ys).astype(np.float32)
    d = np.minimum(dx[None, :], dy[:, None])          # px distance to joint centre

    grout_rgb = np.array([0.823, 0.808, 0.784], dtype=np.float32)
    half = GROUT_PX * 0.5
    t = np.clip((d - half) / 2.0, 0.0, 1.0)[:, :, None]  # 0 = joint, 1 = tile face
    img = grout_rgb * (1.0 - t) + img * t

    # smooth the joint edges a touch so they do not alias at grazing angles
    img = np.clip(img, 0.0, 1.0)

    # --- sRGB -> linear (Blender stores linear floats) ---------------------
    lin = np.where(img <= 0.04045, img / 12.92, ((img + 0.055) / 1.055) ** 2.4)

    rgba = np.ones((H, W, 4), dtype=np.float32)
    rgba[:, :, :3] = lin.astype(np.float32)

    image = bpy.data.images.new('tile_white', width=W, height=H, alpha=False)
    image.colorspace_settings.name = 'sRGB'
    image.pixels.foreach_set(rgba.reshape(-1))
    image.filepath_raw = OUT
    image.file_format = 'JPEG'
    bpy.context.scene.render.image_settings.quality = 92
    image.save()
    print('WROTE', OUT, os.path.getsize(OUT) // 1024, 'KB')


main()
