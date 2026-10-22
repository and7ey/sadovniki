"""Rebuild public/apartment.objects.json from the exported GLB (no Draco decode needed).

The glTF JSON carries POSITION accessor min/max and node transforms, so we can
reconstruct each mesh's world bounding box exactly as the viewer sees it.
"""
import json
import os
import struct

HERE = os.path.dirname(__file__)
GLB = os.path.join(HERE, '..', 'public', 'apartment.glb')
OUT = os.path.join(HERE, '..', 'public', 'apartment.objects.json')


def load_gltf_json(path):
    data = open(path, 'rb').read()
    _, _, _ = struct.unpack('<III', data[:12])
    off = 12
    clen, ctype = struct.unpack('<II', data[off:off + 8])
    assert ctype == 0x4E4F534A
    return json.loads(data[off + 8:off + 8 + clen])


def mat_identity():
    return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]


def mat_mul(a, b):
    out = [0.0] * 16
    for c in range(4):
        for r in range(4):
            out[c * 4 + r] = sum(a[k * 4 + r] * b[c * 4 + k] for k in range(4))
    return out


def mat_from_node(node):
    if 'matrix' in node:
        return list(node['matrix'])
    t = node.get('translation', [0, 0, 0])
    r = node.get('rotation', [0, 0, 0, 1])  # x,y,z,w
    s = node.get('scale', [1, 1, 1])
    x, y, z, w = r
    m = [
        1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0,
        2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0,
        2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0,
        t[0], t[1], t[2], 1,
    ]
    for c in range(3):
        for r_ in range(3):
            m[c * 4 + r_] *= s[c]
    return m


def transform_point(m, p):
    x, y, z = p
    return [
        m[0] * x + m[4] * y + m[8] * z + m[12],
        m[1] * x + m[5] * y + m[9] * z + m[13],
        m[2] * x + m[6] * y + m[10] * z + m[14],
    ]


def main():
    gltf = load_gltf_json(GLB)
    nodes = gltf.get('nodes', [])
    meshes = gltf.get('meshes', [])
    accessors = gltf.get('accessors', [])
    rows = []

    def walk(index, parent):
        node = nodes[index]
        world = mat_mul(parent, mat_from_node(node))
        if 'mesh' in node:
            mesh = meshes[node['mesh']]
            mn = [1e30] * 3
            mx = [-1e30] * 3
            tris = 0
            for prim in mesh.get('primitives', []):
                pos = prim.get('attributes', {}).get('POSITION')
                if pos is None:
                    continue
                acc = accessors[pos]
                amin, amax = acc.get('min'), acc.get('max')
                if amin and amax:
                    for xi in (amin[0], amax[0]):
                        for yi in (amin[1], amax[1]):
                            for zi in (amin[2], amax[2]):
                                p = transform_point(world, (xi, yi, zi))
                                for k in range(3):
                                    mn[k] = min(mn[k], p[k])
                                    mx[k] = max(mx[k], p[k])
                if 'indices' in prim:
                    tris += accessors[prim['indices']]['count'] // 3
                else:
                    tris += acc['count'] // 3
            if mn[0] < 1e29:
                rows.append({
                    'id': node.get('name') or mesh.get('name') or f'node_{index}',
                    'size': [round(mx[k] - mn[k], 2) for k in range(3)],
                    'center': [round((mx[k] + mn[k]) / 2, 2) for k in range(3)],
                    'polys': tris,
                })
        for child in node.get('children', []):
            walk(child, world)

    for scene in gltf.get('scenes', []):
        for root in scene.get('nodes', []):
            walk(root, mat_identity())

    rows.sort(key=lambda r: -max(r['size']))
    json.dump(rows, open(OUT, 'w'), ensure_ascii=False, indent=1)
    print('WROTE', OUT, len(rows), 'objects')
    for r in rows[:12]:
        print(r['id'], r['size'], r['center'], r['polys'])


if __name__ == '__main__':
    main()
