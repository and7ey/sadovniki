import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/* ------------------------------------------------------------------ *
 *  Renderer / scene
 * ------------------------------------------------------------------ */
const app = document.getElementById('app');

/**
 * Phone / weak GPU profile.  The full scene (8 mirror cube maps + 2048 shadow
 * maps + 3 shadow-casting lamps) is more than the GPU of many Android devices
 * can hold, and Chrome drops the WebGL context — the flat vanishes while the
 * HUD stays.  `?low=1` forces this profile, `?high=1` disables it.
 */
const LOW_POWER = (() => {
  const q = new URLSearchParams(location.search);
  if (q.get('low') === '1') return true;
  if (q.get('high') === '1') return false;
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const small = Math.min(window.screen.width, window.screen.height) < 900;
  const mem = navigator.deviceMemory || 4;
  return coarse || small || mem <= 3;
})();
console.log('[tier]', LOW_POWER ? 'low' : 'full');

const renderer = new THREE.WebGLRenderer({
  antialias: !LOW_POWER,
  alpha: true,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, LOW_POWER ? 1.25 : 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = !LOW_POWER;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);

// If the GPU still runs out of memory, recover instead of leaving a blank page:
// first loss → reload in the light profile, second one → explain what happened.
let contextLost = false;
renderer.domElement.addEventListener('webglcontextlost', (event) => {
  event.preventDefault();
  if (contextLost) return;
  contextLost = true;
  console.warn('[webgl] context lost');
  const q = new URLSearchParams(location.search);
  let tries = 0;
  try { tries = Number(sessionStorage.getItem('apt-gl-reloads') || 0); } catch (e) { /* private mode */ }
  if (q.get('low') !== '1' && tries < 1) {
    try { sessionStorage.setItem('apt-gl-reloads', String(tries + 1)); } catch (e) { /* ignore */ }
    q.set('low', '1');
    location.replace(`${location.pathname}?${q.toString()}`);
  } else {
    const box = document.getElementById('gl-lost');
    if (box) box.hidden = false;
    document.body.classList.add('gl-lost');
  }
}, false);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(34, window.innerWidth / window.innerHeight, 0.5, 200);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.075;
controls.rotateSpeed = 0.75;
controls.zoomSpeed = 0.9;
controls.panSpeed = 0.7;
controls.screenSpacePanning = true;
controls.minDistance = 5;
controls.maxDistance = 60;
controls.maxPolarAngle = Math.PI * 0.49;
controls.autoRotateSpeed = 0.7;

/* ------------------------------------------------------------------ *
 *  Environment + lights
 * ------------------------------------------------------------------ */
/* two looks: the original daylight render and the night one */
const LIGHT_PRESETS = {
  night: {
    label: 'Ночь',
    exposure: 1.0,
    env: 0.07,
    hemi: [0x2f4570, 0x060a12, 0.42],
    key: [0x9fbde9, 0.52],
    fill: [0x2b3f63, 0.16],
    rim: [0x7fa2d8, 0.26],
    bg: ['#05080f', '#0e1728', '#1d2b45'],
  },
  day: {
    label: 'День',
    exposure: 0.92,
    env: 0.38,
    hemi: [0xffffff, 0xb9c6d6, 0.8],
    key: [0xfff4e6, 1.95],
    fill: [0xdbe8ff, 0.55],
    rim: [0xffffff, 0.5],
    bg: ['#b9cde4', '#dbe7f4', '#f5f8fc'],
  },
};

const pmrem = new THREE.PMREMGenerator(renderer);
if (!LOW_POWER) {
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.06).texture;
  scene.environmentIntensity = LIGHT_PRESETS.night.env;
} else {
  scene.environmentIntensity = 0;
}

const hemi = new THREE.HemisphereLight(0x2f4570, 0x060a12, 0.42);
scene.add(hemi);

const key = new THREE.DirectionalLight(0x9fbde9, 0.52);
key.position.set(9, 17, 11);
key.castShadow = true;
key.shadow.mapSize.set(LOW_POWER ? 1024 : 2048, LOW_POWER ? 1024 : 2048);
key.shadow.camera.left = -13;
key.shadow.camera.right = 13;
key.shadow.camera.top = 13;
key.shadow.camera.bottom = -13;
key.shadow.camera.near = 1;
key.shadow.camera.far = 55;
key.shadow.bias = -0.0006;
key.shadow.normalBias = 0.025;
key.shadow.radius = 3;
scene.add(key, key.target);

const fill = new THREE.DirectionalLight(0x2b3f63, 0.16);
fill.position.set(-11, 9, -9);
scene.add(fill);

const rim = new THREE.DirectionalLight(0x7fa2d8, 0.26);
rim.position.set(-4, 6, 13);
scene.add(rim);

let lightingMode = 'night';

function applyLighting(mode) {
  const p = LIGHT_PRESETS[mode] || LIGHT_PRESETS.night;
  lightingMode = mode;
  renderer.toneMappingExposure = p.exposure;
  if (!LOW_POWER && scene.environment) scene.environmentIntensity = p.env;

  hemi.color.set(p.hemi[0]);
  hemi.groundColor.set(p.hemi[1]);
  hemi.intensity = p.hemi[2];

  key.color.set(p.key[0]);
  key.intensity = p.key[1];
  fill.color.set(p.fill[0]);
  fill.intensity = p.fill[1];
  rim.color.set(p.rim[0]);
  rim.intensity = p.rim[1];

  // pendant lamps read as "on" only in the dark
  lampStates.forEach((st) => {
    if (st.light) st.light.intensity = st.on ? (mode === 'day' ? 6 : 20) : 0;
    if (st.glow) st.glow.visible = st.on && mode !== 'day';
  });

  setBackground(p.bg);
  document.body.classList.toggle('day', mode === 'day');
  const btn = document.getElementById('btn-light');
  if (btn) btn.textContent = mode === 'day' ? 'Ночь' : 'День';
  return mode;
}

/* ------------------------------------------------------------------ *
 *  Background (soft vertical gradient)
 * ------------------------------------------------------------------ */
let backgroundTexture = null;

function makeBackground(stops) {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 512;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0.0, stops[0]);
  g.addColorStop(0.45, stops[1]);
  g.addColorStop(1.0, stops[2]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 16, 512);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function setBackground(stops) {
  const next = makeBackground(stops);
  scene.background = next;
  if (backgroundTexture) backgroundTexture.dispose();
  backgroundTexture = next;
}

setBackground(LIGHT_PRESETS.night.bg);

/* ------------------------------------------------------------------ *
 *  Helpers
 * ------------------------------------------------------------------ */
function roundedRectShape(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

function makeSoftShadowTexture() {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.05, size / 2, size / 2, size * 0.5);
  g.addColorStop(0, 'rgba(26, 48, 79, 0.30)');
  g.addColorStop(0.45, 'rgba(26, 48, 79, 0.14)');
  g.addColorStop(1, 'rgba(26, 48, 79, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ------------------------------------------------------------------ *
 *  Mirrors — one cube capture per mirror, rendered once after load
 * ------------------------------------------------------------------ */
function setupMirrors() {
  if (!apartment) return;
  const mirrors = [];
  apartment.traverse((o) => {
    if (!o.isMesh) return;
    const n = (o.material && o.material.name) || '';
    if (/apt_mirror/i.test(n)) mirrors.push(o);
  });
  if (!mirrors.length) return;

  const res = LOW_POWER ? 128 : 512;
  const wasVisible = mirrors.map((m) => m.visible);
  mirrors.forEach((m) => { m.visible = false; });

  // low tier: no reflection capture at all, just a glossy panel
  let shared = null;
  if (LOW_POWER) {
    const mat = new THREE.MeshStandardMaterial({
      color: 0xa8b6cc,
      metalness: 0.85,
      roughness: 0.18,
    });
    mat.name = 'Apt_mirror_live';
    mirrors.forEach((m) => { m.material = mat; });
    mirrors.forEach((m, i) => { m.visible = wasVisible[i]; });
    console.log('[mirrors] flat (low tier)');
    return;
  }
  let sharedMat = null;
  if (shared) {
    sharedMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      metalness: 1.0,
      roughness: 0.08,
      envMap: shared.texture,
      envMapIntensity: 1.0,
    });
    sharedMat.name = 'Apt_mirror_live';
  }

  mirrors.forEach((mesh) => {
    if (sharedMat) {
      mesh.material = sharedMat;
      return;
    }

    const box = new THREE.Box3().setFromObject(mesh);
    const center = box.getCenter(new THREE.Vector3());

    // the bulb sits *inside* the shade (as asked), so the shade itself must not
    // cast a shadow: otherwise it seals the light in and the room stays dark.
    // Walls still cast shadows, so light still does not leak between rooms.
    mesh.castShadow = false;
    const size = box.getSize(new THREE.Vector3());

    // find the open side (the room) and step off the wall/wardrobe a little,
    // otherwise the capture is blocked by the wall the mirror is mounted on
    const axis = size.x <= size.z
      ? new THREE.Vector3(1, 0, 0)
      : new THREE.Vector3(0, 0, 1);
    const ray = new THREE.Raycaster();
    const dists = [];
    for (const dir of [axis, axis.clone().negate()]) {
      ray.set(center.clone().addScaledVector(dir, 0.001), dir);
      ray.far = 12;
      const hits = ray.intersectObject(apartment, true).filter((h) =>
        h.object !== mesh &&
        h.object.isMesh &&
        !/apt_mirror/i.test((h.object.material && h.object.material.name) || '')
      );
      dists.push(hits.length ? hits[0].distance : 12);
    }
    const openDir = dists[0] >= dists[1] ? axis : axis.clone().negate();
    const openDist = Math.max(dists[0], dists[1]);
    const offset = openDir.multiplyScalar(Math.min(0.6, Math.max(0.12, openDist * 0.35)));

    let envTexture;
    if (shared) {
      envTexture = shared.texture;
    } else {
      const rt = new THREE.WebGLCubeRenderTarget(res, {
        generateMipmaps: false,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
      });
      const cam = new THREE.CubeCamera(0.05, 60, rt);
      cam.position.copy(center).add(offset);
      scene.add(cam);
      cam.update(renderer, scene);
      scene.remove(cam);
      envTexture = rt.texture;
    }

    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      metalness: 1.0,
      roughness: shared ? 0.08 : 0.0,
      envMap: envTexture,
      envMapIntensity: 1.0,
    });
    mat.name = 'Apt_mirror_live';
    mesh.material = mat;
  });

  mirrors.forEach((m, i) => { m.visible = wasVisible[i]; });
  console.log('[mirrors]', mirrors.map((m) => m.name).join(', '));
}


/**
 * Phones: the floor atlas alone is 4096 x 2629 (~43 MB in VRAM).  Halving it
 * frees about 30 MB and is invisible at phone resolution.
 */
function downscaleBigTextures() {
  const seen = new Set();
  apartment.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m || !m.map || seen.has(m.map)) continue;
      const old = m.map;
      seen.add(old);
      const img = old.image;
      const maxW = LOW_POWER ? 1024 : 4096;
      if (!img || !img.width || img.width <= maxW) continue;

      const c = document.createElement('canvas');
      c.width = maxW;
      c.height = Math.max(1, Math.round((maxW * img.height) / img.width));
      const ctx = c.getContext('2d');
      if (!ctx) continue;
      ctx.drawImage(img, 0, 0, c.width, c.height);

      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = old.colorSpace;
      tex.wrapS = old.wrapS;
      tex.wrapT = old.wrapT;
      tex.repeat.copy(old.repeat);
      tex.offset.copy(old.offset);
      tex.rotation = old.rotation;
      tex.flipY = false;
      tex.anisotropy = 4;
      tex.needsUpdate = true;

      m.map = tex;
      m.needsUpdate = true;
      old.dispose();
    }
  });
}

/* ------------------------------------------------------------------ *
 *  Pendant lamps — click a lamp to switch its own 60 W bulb on/off
 * ------------------------------------------------------------------ */
const LAMP_IDS = [
  'Four_Pendant_Lights_amazing_set_vol21_008',
  'Four_Pendant_Lights_amazing_set_vol21_009',
  'Four_Pendant_Lights_amazing_set_vol21_010',
];
const lampStates = new Map();

/**
 * The walls arrive as one mesh, which makes it impossible to select a single
 * wall.  Split every wall mesh into flat connected patches and give each patch
 * its own material, so walls can be picked (and later coloured) one by one.
 */
function splitWalls() {
  // on phones the extra draw calls are not worth it: keep the merged walls,
  // selection there just picks the whole wall mesh
  if (LOW_POWER) {
    for (const src of wallSources) {
      if (src.material) wallMaterials.push(src.material);
      wallMeshSet.add(src);
    }
    wallsMesh = wallSources[0] || null;
    console.log('[walls] kept merged (low tier)');
    return;
  }

  const patches = [];
  for (const src of wallSources) {
    if (!src.parent) continue;
    const islands = planarIslands(src.geometry);
    for (const geo of islands) {
      const bb = geo.boundingBox;
      const cx = bb ? (bb.min.x + bb.max.x) / 2 : 0;
      const cz = bb ? (bb.min.z + bb.max.z) / 2 : 0;
      patches.push({ geo, src, parent: src.parent, cx, cz });
    }
    src.parent.remove(src);
    src.geometry.dispose();
  }

  // stable order: left to right, then front to back
  patches.sort((a, b) => (Math.abs(a.cx - b.cx) > 0.4 ? a.cx - b.cx : a.cz - b.cz));

  patches.forEach((p, i) => {
    const mat = p.src.material.clone();
    mat.name = 'Apt_wall_patch';
    const mesh = new THREE.Mesh(p.geo, mat);
    mesh.name = 'Стена ' + String(i + 1).padStart(2, '0');
    mesh.position.copy(p.src.position);
    mesh.quaternion.copy(p.src.quaternion);
    mesh.scale.copy(p.src.scale);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    (p.parent || apartment).add(mesh);
    wallMaterials.push(mat);
    wallMeshSet.add(mesh);
    wallPatchMeshes.push(mesh);
  });

  wallsMesh = wallMeshSet.size ? [...wallMeshSet][0] : null;
  console.log('[walls] split into', patches.length, 'selectable surfaces');
}

function setupLamps() {
  if (!apartment) return;
  for (const id of LAMP_IDS) {
    const mesh = apartment.getObjectByName(id);
    if (!mesh) {
      console.warn('[lamp] missing', id);
      continue;
    }

    const box = new THREE.Box3().setFromObject(mesh);
    const center = box.getCenter(new THREE.Vector3());

    // the bulb sits *inside* the shade (as asked), so the shade itself must not
    // cast a shadow: otherwise it seals the light in and the room stays dark.
    // Walls still cast shadows, so light still does not leak between rooms.
    mesh.castShadow = false;

    // each pendant gets its own material, so one lamp can glow without the others
    if (Array.isArray(mesh.material)) {
      mesh.material = mesh.material.map((m) => m.clone());
    } else if (mesh.material) {
      mesh.material = mesh.material.clone();
    }
    const base = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    if (base) {
      // off state: plain matte white shade
      base.color = new THREE.Color(0xf2f1ec);
      base.emissive = new THREE.Color(0x000000);
      base.emissiveIntensity = 0;
      base.metalness = 0.0;
      base.roughness = 0.55;
      base.needsUpdate = true;
    }

    // visible warm bulb just under the shade
    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(0.055, 16, 12),
      new THREE.MeshBasicMaterial({
        color: 0xffd7a0,
        transparent: true,
        opacity: 1.0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    glow.position.set(center.x, box.min.y + 0.03, center.z);
    glow.visible = false;
    glow.renderOrder = 5;
    scene.add(glow);

    // 60 W incandescent: warm 2700 K point light at the bulb centre.
    // It casts shadows (walls occlude it), but the shadow map is only rebuilt
    // when the lamp is switched on, so there is no per-frame cost.
    // as requested: the bulb sits inside the shade
    const light = new THREE.PointLight(0xffb46b, 0, 12, 2);
    light.position.set(center.x, box.min.y + 0.15, center.z);
    light.castShadow = !LOW_POWER;
    light.shadow.mapSize.set(LOW_POWER ? 512 : 1024, LOW_POWER ? 512 : 1024);
    light.shadow.bias = -0.0032;
    light.shadow.normalBias = 0.035;
    light.shadow.camera.near = 0.06;
    light.shadow.camera.far = 9.5;
    light.shadow.autoUpdate = false;
    light.shadow.needsUpdate = true;
    light.visible = false;
    scene.add(light);

    lampStates.set(id, { mesh, base, glow, light, on: false });
    console.log('[lamp]', id, 'light', light.position.toArray().map((v) => v.toFixed(2)).join(', '));
  }
}

function toggleLamp(id) {
  const st = lampStates.get(id);
  if (!st) return false;
  st.on = !st.on;
  st.glow.visible = st.on && lightingMode !== 'day';
  st.light.visible = st.on;
  st.light.intensity = st.on ? (lightingMode === 'day' ? 6 : 20) : 0;
  if (st.on) st.light.shadow.needsUpdate = true;
  if (st.base) {
    st.base.emissive.set(st.on ? 0xffcb8a : 0x000000);
    st.base.emissiveIntensity = st.on ? 1.0 : 0;
  }
  console.log('[lamp]', id, st.on ? 'ON' : 'OFF');
  return true;
}

/* ------------------------------------------------------------------ *
 *  Wall paint — Caparol Amphibolin, matched to each patch's centre
 * ------------------------------------------------------------------ */
// mai 45 / palazzo 205 / marill 30 as sampled from the Caparol fan deck
const PAINT_MAI = 0xb7b29b;
const PAINT_PALAZZO = 0xe1c299;
const PAINT_MARILL = 0xded4c9;

const WALL_PAINT = [
  { at: [-3.19, -2.28], hex: PAINT_MAI, name: 'Стена 33' },
  { at: [4.075, 4.53], hex: PAINT_MAI, name: 'Стена 117' },
  { at: [-2.95, -1.13], hex: PAINT_PALAZZO, name: 'Стена 35' },
  { at: [1.15, -1.13], hex: PAINT_PALAZZO, name: 'Стена 83' },
  { at: [2.49, 1.84], hex: PAINT_MARILL, name: 'Стена 101' },
  { at: [2.49, 3.185], hex: PAINT_MARILL, name: 'Стена 106' },
  { at: [2.39, 3.345], hex: PAINT_MARILL, name: 'Стена 107' },
  { at: [2.49, 4.03], hex: PAINT_MARILL, name: 'Стена 109' },
  { at: [-3.07, -0.37], hex: PAINT_MARILL, name: 'Стена 36' },
  { at: [-0.90, 0.84], hex: PAINT_MARILL, name: 'Стена 58' },
  { at: [1.27, -1.07], hex: PAINT_MARILL, name: 'Стена 84' },
  { at: [4.015, 0.72], hex: PAINT_MARILL, name: 'Стена 115' },
];

// painted furniture panels / trims that are separate meshes in the model
const OBJECT_PAINT = { Line013: PAINT_MARILL };

function paintMeshMaterial(mat, hex) {
  mat.color = new THREE.Color(hex);
  mat.roughness = 0.88;
  mat.metalness = 0.0;
  if (mat.map) mat.map = null;
  mat.needsUpdate = true;
}

function paintWalls() {
  if (!wallPatchMeshes.length) return 0;
  const done = new Set();
  const box = new THREE.Box3();
  const mid = new THREE.Vector3();
  for (const mesh of wallPatchMeshes) {
    box.setFromObject(mesh);
    box.getCenter(mid);
    let pick = null;
    let best = 0.08; // metres
    for (const w of WALL_PAINT) {
      const d = Math.hypot(mid.x - w.at[0], mid.z - w.at[1]);
      if (d <= best) {
        best = d;
        pick = w;
      }
    }
    if (!pick) continue;
    paintMeshMaterial(mesh.material, pick.hex);
    done.add(pick.name);
  }
  for (const [name, hex] of Object.entries(OBJECT_PAINT)) {
    const o = apartment.getObjectByName(name);
    if (!o || !o.material) {
      console.warn('[paint] missing', name);
      continue;
    }
    o.material = (Array.isArray(o.material) ? o.material[0] : o.material).clone();
    paintMeshMaterial(o.material, hex);
    done.add(name);
  }
  const missing = WALL_PAINT.filter((w) => !done.has(w.name)).map((w) => w.name);
  console.log('[paint]', done.size, 'surfaces',
    missing.length ? 'not found: ' + missing.join(', ') : 'all matched');
  return done.size;
}

/* ------------------------------------------------------------------ *
 *  Hall mirror — the wardrobe front was exported as two panes
 * ------------------------------------------------------------------ */
function mergeHallMirrors() {
  if (!apartment) return;
  const a = apartment.getObjectByName('Box2131642377');
  const b = apartment.getObjectByName('Box2131642378');
  if (!a || !b) {
    console.warn('[mirror] hall panes not found');
    return;
  }
  const box = new THREE.Box3().setFromObject(a);
  box.union(new THREE.Box3().setFromObject(b));
  const size = box.getSize(new THREE.Vector3());
  const mid = box.getCenter(new THREE.Vector3());

  const mat = (Array.isArray(a.material) ? a.material[0] : a.material).clone();
  mat.name = 'Apt_mirror';
  const pane = new THREE.Mesh(new THREE.PlaneGeometry(size.x, size.y), mat);
  pane.name = 'MirrorHall';
  pane.position.set(mid.x, mid.y, box.min.z - 0.004);
  pane.rotation.y = Math.PI; // face into the hall
  pane.receiveShadow = false;
  pane.castShadow = false;
  // the mirror meshes live under a group with a big offset, so add the merged
  // pane to the apartment root and convert the world position to its space
  apartment.add(pane);
  apartment.worldToLocal(pane.position);

  // the two originals stay in the scene (hidden) but must not be mirrored again
  for (const old of [a, b]) {
    old.visible = false;
    if (old.material) {
      old.material = (Array.isArray(old.material) ? old.material[0] : old.material).clone();
      old.material.name = 'Apt_glass_pane';
    }
  }
  console.log('[mirror] hall panes merged', size.x.toFixed(2), 'x', size.y.toFixed(2));
}

/* ------------------------------------------------------------------ *
 *  LED coves + GU10 track lights (temporary switches in the HUD)
 * ------------------------------------------------------------------ */
// wall runs from the plan: living room along Стена 114 / 138 / 129,
// kids' room along Стена 51.  a/b are the run ends in floor coordinates,
// n points into the room.
const LED_STRIPS = {
  living: [
    { a: [1.40, -2.93], b: [7.22, -2.93], n: [0, 1] },
    { a: [7.23, -2.93], b: [7.23, 0.46], n: [-1, 0] },
    { a: [6.10, 0.46], b: [7.23, 0.46], n: [0, -1] },
  ],
  kids: [
    { a: [-2.91, -2.93], b: [1.11, -2.93], n: [0, 1] },
  ],
};

// track rectangles measured on the lighting plan (2890 x 2000 / 2000 x 2190)
const TRACKS = {
  living: { x: [2.84, 5.73], z: [-2.12, -0.12] },
  kids: { x: [-1.90, 0.10], z: [-2.76, -0.57] },
};

const LED_INTENSITY = 6;
const TRACK_INTENSITY = 12;

const ledGroups = {};
const trackFixtureGroups = {};
const trackLights = {};
const trackLenses = {};
const lightState = { ledLiving: false, ledKids: false, trackLiving: false, trackKids: false };

function buildLedCoves() {
  for (const [room, strips] of Object.entries(LED_STRIPS)) {
    const group = new THREE.Group();
    group.name = 'LED_' + room;
    if (!LOW_POWER) {
      for (const s of strips) {
        const dx = s.b[0] - s.a[0];
        const dz = s.b[1] - s.a[1];
        const len = Math.hypot(dx, dz);
        const count = Math.max(1, Math.round(len / 2.2));
        for (let i = 0; i < count; i++) {
          const t = (i + 0.5) / count;
          const light = new THREE.PointLight(0xffc27a, 0, 5.5, 2);
          light.position.set(
            s.a[0] + dx * t + s.n[0] * 0.22,
            2.82,
            s.a[1] + dz * t + s.n[1] * 0.22
          );
          group.add(light);
        }
      }
    }
    scene.add(group);
    ledGroups[room] = group;
  }
  console.log('[led] coves', Object.keys(ledGroups)
    .map((k) => k + ':' + ledGroups[k].children.length).join(' '));
}

function buildTracks() {
  for (const [room, t] of Object.entries(TRACKS)) {
    const w = t.x[1] - t.x[0];
    const d = t.z[1] - t.z[0];
    const cx = (t.x[0] + t.x[1]) / 2;
    const cz = (t.z[0] + t.z[1]) / 2;
    const y = 2.945;

    const railMat = new THREE.MeshStandardMaterial({ color: 0x4b4d53, roughness: 0.45, metalness: 0.6 });
    const headMat = new THREE.MeshStandardMaterial({ color: 0x35363a, roughness: 0.4, metalness: 0.65 });
    const lensMat = new THREE.MeshStandardMaterial({
      color: 0x14140f,
      roughness: 0.35,
      emissive: new THREE.Color(0xffd9a4),
      emissiveIntensity: 0,
    });

    const fixtures = new THREE.Group();
    fixtures.name = 'Track_' + room;

    const bar = (len, rotY, x, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(len, 0.024, 0.038), railMat);
      m.position.set(x, y, z);
      m.rotation.y = rotY;
      fixtures.add(m);
    };
    bar(w, 0, cx, t.z[0]);
    bar(w, 0, cx, t.z[1]);
    bar(d, Math.PI / 2, t.x[0], cz);
    bar(d, Math.PI / 2, t.x[1], cz);

    const inset = 0.26;
    const heads = [
      [t.x[0] + inset, t.z[0] + inset],
      [t.x[1] - inset, t.z[0] + inset],
      [t.x[0] + inset, t.z[1] - inset],
      [t.x[1] - inset, t.z[1] - inset],
    ];

    const lights = [];
    for (const [hx, hz] of heads) {
      const head = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.05, 0.085, 14), headMat);
      head.position.set(hx, y - 0.07, hz);
      fixtures.add(head);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.04, 14), lensMat);
      lens.position.set(hx, y - 0.122, hz);
      lens.rotation.x = Math.PI / 2;
      fixtures.add(lens);

      if (!LOW_POWER) {
        const spot = new THREE.SpotLight(0xfff0d8, 0, 7, 0.62, 0.55, 2);
        spot.position.set(hx, y - 0.13, hz);
        spot.target.position.set(hx, 0, hz);
        spot.castShadow = false;
        scene.add(spot, spot.target);
        lights.push(spot);
      }
    }

    scene.add(fixtures);
    trackFixtureGroups[room] = fixtures;
    trackLights[room] = lights;
    trackLenses[room] = lensMat;
  }
  console.log('[track]', Object.keys(trackLights)
    .map((k) => k + ':' + trackLights[k].length).join(' '));
}

function setLight(kind, room, on) {
  if (kind === 'led') {
    const group = ledGroups[room];
    if (group) group.children.forEach((l) => { if (l.isPointLight) l.intensity = on ? LED_INTENSITY : 0; });
  } else {
    (trackLights[room] || []).forEach((l) => { l.intensity = on ? TRACK_INTENSITY : 0; });
    const lens = trackLenses[room];
    if (lens) lens.emissiveIntensity = on ? 1 : 0;
  }
  lightState[kind + room[0].toUpperCase() + room.slice(1)] = on;
  console.log('[light]', kind, room, on ? 'ON' : 'OFF');
  return on;
}

/* ------------------------------------------------------------------ *
 *  State
 * ------------------------------------------------------------------ */
const loaderEl = document.getElementById('loader');
const progressEl = document.getElementById('progress');

let apartment = null;
let wallsMesh = null;
const wallSources = [];
const wallMaterials = [];
const wallMeshSet = new Set();
const wallPatchMeshes = [];
let thinPlate = null;
let softShadow = null;

const modelBox = new THREE.Box3();
const modelSize = new THREE.Vector3();
const homeTarget = new THREE.Vector3(0, 1.15, 0);

let viewDist = 30;
let fitRadius = 9;
let wallTargetOpacity = 1;
let activeTween = null;

function idealDistance() {
  const vFov = THREE.MathUtils.degToRad(camera.fov);
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
  return (fitRadius / Math.sin(Math.min(vFov, hFov) / 2)) * 0.8;
}

/* ------------------------------------------------------------------ *
 *  Geometry helpers
 * ------------------------------------------------------------------ */

/** outline of the apartment floor as [[x, z], ...] in world space */
function apartmentOutline() {
  const mesh =
    apartment.getObjectByName('ApartmentFloor') || apartment.getObjectByName('Apt_floor');
  if (!mesh) return [];
  const g = mesh.geometry;
  const pos = g.attributes.position;
  const idx = g.index ? Array.from(g.index.array) : [...Array(pos.count).keys()];
  const w = mesh.matrixWorld;
  const v = new THREE.Vector3();
  const pts = [];
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(w);
    pts.push([v.x, v.z]);
  }
  const count = new Map();
  const key = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      const k = key(p, q);
      count.set(k, (count.get(k) || 0) + 1);
    }
  }
  const next = new Map();
  for (const [k, n] of count) {
    if (n !== 1) continue;
    const [a, b] = k.split('|').map(Number);
    if (!next.has(a)) next.set(a, []);
    next.get(a).push(b);
    if (!next.has(b)) next.set(b, []);
    next.get(b).push(a);
  }
  const start = [...next.keys()][0];
  if (start === undefined) return [];
  const loop = [];
  let cur = start;
  let prev = -1;
  for (let guard = 0; guard < 4000; guard++) {
    loop.push(pts[cur]);
    const nb = next.get(cur).filter((n) => n !== prev);
    if (!nb.length) break;
    prev = cur;
    cur = nb[0];
    if (cur === start) break;
  }
  return loop;
}

/** split one mesh into flat, connected patches (one patch = one wall surface) */
function planarIslands(geometry) {
  const g = geometry;
  const pos = g.attributes.position;
  const nor = g.attributes.normal;
  const uv = g.attributes.uv;
  const idx = g.index ? Array.from(g.index.array) : [...Array(pos.count).keys()];
  const triCount = Math.floor(idx.length / 3);
  if (!triCount) return [];

  const parent = new Int32Array(triCount);
  for (let i = 0; i < triCount; i++) parent[i] = i;
  const find = (a) => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]];
      a = parent[a];
    }
    return a;
  };
  const uni = (a, b) => {
    a = find(a);
    b = find(b);
    if (a !== b) parent[b] = a;
  };

  const pa = new THREE.Vector3();
  const pb = new THREE.Vector3();
  const pc = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const plane = new Array(triCount);
  for (let t = 0; t < triCount; t++) {
    pa.fromBufferAttribute(pos, idx[t * 3]);
    pb.fromBufferAttribute(pos, idx[t * 3 + 1]);
    pc.fromBufferAttribute(pos, idx[t * 3 + 2]);
    nrm.subVectors(pb, pa).cross(pc.clone().sub(pa)).normalize();
    const d = nrm.dot(pa);
    plane[t] = `${Math.round(nrm.x * 4)},${Math.round(nrm.y * 4)},${Math.round(
      nrm.z * 4
    )},${Math.round(d * 4)}`;
  }

  const owner = new Map();
  for (let t = 0; t < triCount; t++) {
    const a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2];
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      const k = p < q ? p + '|' + q : q + '|' + p;
      const other = owner.get(k);
      if (other === undefined) owner.set(k, t);
      else if (plane[other] === plane[t]) uni(other, t);
    }
  }

  const groups = new Map();
  for (let t = 0; t < triCount; t++) {
    const r = find(t);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(t);
  }

  const out = [];
  for (const tris of groups.values()) {
    const aPos = [];
    const aNor = [];
    const aUv = [];
    const aIdx = [];
    let n = 0;
    for (const t of tris) {
      for (let k = 0; k < 3; k++) {
        const i = idx[t * 3 + k];
        aPos.push(pos.getX(i), pos.getY(i), pos.getZ(i));
        if (nor) aNor.push(nor.getX(i), nor.getY(i), nor.getZ(i));
        if (uv) aUv.push(uv.getX(i), uv.getY(i));
        aIdx.push(n++);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(aPos, 3));
    if (aNor.length) geo.setAttribute('normal', new THREE.Float32BufferAttribute(aNor, 3));
    if (aUv.length) geo.setAttribute('uv', new THREE.Float32BufferAttribute(aUv, 2));
    geo.setIndex(aIdx);
    geo.computeBoundingBox();
    out.push(geo);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 *  Load model
 * ------------------------------------------------------------------ */
const draco = new DRACOLoader();
draco.setDecoderPath('./vendor/draco/');

const loader = new GLTFLoader();
loader.setDRACOLoader(draco);

loader.load(
  './public/apartment.glb?v=12',
  (gltf) => {
    apartment = gltf.scene;

    apartment.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;

      const m = o.material;
      if (!m) return;

      const name = (m.name || '').toLowerCase();
      m.envMapIntensity = 0.5;

      if (name.includes('glass')) {
        m.transparent = true;
        m.opacity = 0.16;
        m.depthWrite = false;
        m.roughness = 0.05;
        m.metalness = 0;
        m.side = THREE.DoubleSide;
        o.castShadow = false;
      }
      if (name.includes('frosted')) {
        m.transparent = true;
        m.opacity = 0.55;
        m.depthWrite = false;
        m.roughness = 0.62;
        m.metalness = 0;
        m.side = THREE.DoubleSide;
        // a frosted partition still blocks the pendant light
        o.castShadow = true;
      }
      if (name.includes('wall')) {
        m.roughness = 0.92;
        m.metalness = 0.0;
        // walls are thin planes: let them occlude point lights from both faces
        m.shadowSide = THREE.DoubleSide;
        o.castShadow = true;
        wallSources.push(o);
      }
      if (name.includes('floor')) {
        m.roughness = 0.55;
        m.metalness = 0.0;
        m.envMapIntensity = 0.15;
        if (m.map) {
          m.map.colorSpace = THREE.SRGBColorSpace;
          // the herringbone texture covers the floor exactly once
          m.map.wrapS = THREE.ClampToEdgeWrapping;
          m.map.wrapT = THREE.ClampToEdgeWrapping;
          m.map.anisotropy = renderer.capabilities.getMaxAnisotropy();
          m.map.needsUpdate = true;
          m.color.set(0xffffff);
        } else {
          m.color.set('#b98a5d');
        }
      }
    });

    // center on origin, floor at y = 0
    modelBox.setFromObject(apartment);
    modelBox.getSize(modelSize);
    const center = modelBox.getCenter(new THREE.Vector3());
    apartment.position.set(-center.x, -modelBox.min.y, -center.z);
    scene.add(apartment);

    apartment.updateMatrixWorld(true);

    // put the finished floor exactly at y = 0 (some sub-floor geometry sits lower)
    const floorMesh =
      apartment.getObjectByName('ApartmentFloor') || apartment.getObjectByName('Apt_floor');
    if (floorMesh) {
      const fb = new THREE.Box3().setFromObject(floorMesh);
      apartment.position.y -= fb.min.y;
      apartment.updateMatrixWorld(true);
    }

    modelBox.setFromObject(apartment);
    modelBox.getSize(modelSize);

    // ---- soft contact shadow ----
    const soft = new THREE.Mesh(
      new THREE.PlaneGeometry(modelSize.x * 2.1, modelSize.z * 2.6),
      new THREE.MeshBasicMaterial({
        map: makeSoftShadowTexture(),
        transparent: true,
        depthWrite: false,
        opacity: 0.55,
      })
    );
    soft.rotation.x = -Math.PI / 2;
    soft.position.y = -0.09;
    softShadow = soft;
    scene.add(soft);

    // ---- thin floor plate: what is left when the plinth is switched off.
    // It is extruded from the real floor outline, so it never sticks out
    // beyond the apartment walls.
    const outline = apartmentOutline();
    let plateGeo;
    if (outline.length > 2) {
      const shapePts = outline.map(([x, z]) => [x, -z]);
      // keep the winding counter-clockwise, otherwise the caps face down
      let area = 0;
      for (let i = 0; i < shapePts.length; i++) {
        const [x1, y1] = shapePts[i];
        const [x2, y2] = shapePts[(i + 1) % shapePts.length];
        area += x1 * y2 - x2 * y1;
      }
      if (area < 0) shapePts.reverse();
      const plateShape = new THREE.Shape();
      plateShape.moveTo(shapePts[0][0], shapePts[0][1]);
      for (let i = 1; i < shapePts.length; i++) plateShape.lineTo(shapePts[i][0], shapePts[i][1]);
      plateShape.closePath();
      plateGeo = new THREE.ExtrudeGeometry(plateShape, {
        depth: 0.07,
        bevelEnabled: false,
        curveSegments: 1,
      });
      plateGeo.rotateX(-Math.PI / 2);
      plateGeo.computeBoundingBox();
      plateGeo.translate(0, -plateGeo.boundingBox.max.y - 0.005, 0);
    } else {
      // fallback: rounded rectangle around the bounding box
      const plateShape = roundedRectShape(modelSize.x + 0.06, modelSize.z + 0.06, 0.25);
      plateGeo = new THREE.ExtrudeGeometry(plateShape, {
        depth: 0.07,
        bevelEnabled: true,
        bevelThickness: 0.02,
        bevelSize: 0.02,
        bevelSegments: 2,
        curveSegments: 8,
      });
      plateGeo.rotateX(-Math.PI / 2);
      plateGeo.computeBoundingBox();
      plateGeo.translate(0, -plateGeo.boundingBox.max.y - 0.005, 0);
    }
    thinPlate = new THREE.Mesh(
      plateGeo,
      new THREE.MeshStandardMaterial({
        color: new THREE.Color('#22304a'),
        roughness: 0.9,
        metalness: 0.0,
      })
    );
    thinPlate.receiveShadow = true;
    thinPlate.visible = true;
    scene.add(thinPlate);

    // ---- camera framing ----
    fitRadius = modelSize.length() * 0.5;
    viewDist = idealDistance();

    controls.target.copy(homeTarget);
    const isoDir = new THREE.Vector3(0.72, 1.02, 0.95).normalize();
    camera.position.copy(homeTarget).addScaledVector(isoDir, viewDist);
    controls.minDistance = 5;
    controls.maxDistance = viewDist * 1.9;
    controls.update();

    key.target.position.set(0, 0, 0);
    key.position.set(9, 18, 11);

    downscaleBigTextures();
    splitWalls();
    paintWalls();
    mergeHallMirrors();
    setupMirrors();
    setupLamps();
    buildLedCoves();
    buildTracks();

    loaderEl.classList.add('done');
    setTimeout(() => loaderEl.remove(), 900);
    initUI();
  },
  (xhr) => {
    if (!xhr.total) return;
    const pct = Math.min(99, Math.round((xhr.loaded / xhr.total) * 100));
    progressEl.textContent = pct + '%';
  },
  (err) => {
    console.error(err);
    progressEl.textContent = 'ошибка загрузки';
  }
);

/* ------------------------------------------------------------------ *
 *  Selection
 * ------------------------------------------------------------------ */
const raycaster = new THREE.Raycaster();
const pointerNDC = new THREE.Vector2();
const SELECT_COLOR = 0xff7a1a;
const SELECT_NOTE = {
  Layer0013: 'все стены',
  ApartmentFloor: 'пол',
};

let selected = null;
let selectionHelper = null;
let selectedEl = null;
let selectedIdEl = null;
let selectedSizeEl = null;

function isGlassMesh(o) {
  const n = ((o.material && o.material.name) || '').toLowerCase();
  return n.includes('glass');
}

function deselect() {
  if (!selected) return;
  if (selected.clone) {
    selected.mesh.material = selected.original;
    selected.clone.dispose();
  }
  if (selectionHelper) {
    scene.remove(selectionHelper);
    selectionHelper.geometry.dispose();
    selectionHelper.material.dispose();
    selectionHelper = null;
  }
  selected = null;
  if (selectedEl) selectedEl.hidden = true;
  if (selectedIdEl) selectedIdEl.textContent = '';
  if (selectedSizeEl) selectedSizeEl.textContent = '';
  if (window.__viewer) window.__viewer.selection = null;
}

function selectMesh(mesh, point) {
  if (!mesh) {
    deselect();
    return;
  }
  // pendants are switches, not selectable objects: click only toggles the lamp
  if (lampStates.has(mesh.name)) {
    toggleLamp(mesh.name);
    return;
  }
  if (selected && selected.mesh === mesh) {
    console.log('SELECTED_ID=' + mesh.name);
    return;
  }
  deselect();

  const isGroup = mesh.name.startsWith('Apt_small_');
  let box = null;
  let size = null;

  if (!isGroup) {
    const original = mesh.material;
    const clone = original.clone();
    clone.emissive = new THREE.Color(SELECT_COLOR);
    clone.emissiveIntensity = 0.5;
    if (clone.transparent) clone.opacity = Math.max(clone.opacity, 0.55);
    mesh.material = clone;
    selected = { mesh, original, clone };

    box = new THREE.Box3().setFromObject(mesh);
    size = box.getSize(new THREE.Vector3());

    selectionHelper = new THREE.Box3Helper(box, SELECT_COLOR);
    selectionHelper.material.depthTest = false;
    selectionHelper.material.transparent = true;
    selectionHelper.material.opacity = 0.95;
    selectionHelper.renderOrder = 999;
    scene.add(selectionHelper);
  } else {
    // merged group of tiny objects: mark the clicked spot instead of its huge bbox
    selected = { mesh, original: null, clone: null };
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 14, 14),
      new THREE.MeshBasicMaterial({ color: SELECT_COLOR, depthTest: false, transparent: true })
    );
    marker.position.copy(point || new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3()));
    marker.renderOrder = 999;
    selectionHelper = marker;
    scene.add(marker);
    size = new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3());
  }

  const f = (v) => v.toFixed(2);
  const dims = size ? `${f(size.x)} × ${f(size.y)} × ${f(size.z)} м` : '—';
  const center = box ? box.getCenter(new THREE.Vector3()) : point;
  const pos = center ? `(${f(center.x)}, ${f(center.y)}, ${f(center.z)})` : '—';
  const tris = mesh.geometry.index
    ? mesh.geometry.index.count / 3
    : mesh.geometry.attributes.position.count / 3;

  console.log(
    `%c[selected] ${mesh.name}`,
    'color:#ff7a1a;font-weight:600',
    `\n  size:   ${dims}\n  center: ${pos}\n  tris:   ${Math.round(tris)}`
  );
  console.log('SELECTED_ID=' + mesh.name);
  if (isGroup) {
    console.log('  (объединённая группа мелких объектов — клик выбирает всю группу)');
  }

  if (selectedEl) {
    selectedEl.hidden = false;
    selectedIdEl.textContent = mesh.name;
    const note = SELECT_NOTE[mesh.name];
    selectedSizeEl.textContent = isGroup
      ? 'группа мелких объектов'
      : `${f(size.x)} × ${f(size.z)} × ${f(size.y)} м${note ? ' · ' + note : ''}`;
  }
  if (window.__viewer) {
    window.__viewer.selection = {
      id: mesh.name,
      group: isGroup,
      size: size ? size.toArray() : null,
      center: center ? center.toArray() : null,
    };
  }
}

function pickAt(clientX, clientY) {
  if (!apartment) return null;
  const rect = renderer.domElement.getBoundingClientRect();
  pointerNDC.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  pointerNDC.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointerNDC, camera);

  const hits = raycaster.intersectObject(apartment, true).filter((h) => h.object.isMesh);
  if (!hits.length) return null;

  // faded walls and transparent glass should not block what is behind them
  const fadedWalls = wallTargetOpacity < 0.5;
  const candidates = hits.filter((h) => !(fadedWalls && wallMeshSet.has(h.object)));
  const solid = candidates.find((h) => !isGlassMesh(h.object));
  return solid || candidates[0] || hits[0];
}

function setupSelection() {
  selectedEl = document.getElementById('selected');
  selectedIdEl = document.getElementById('selected-id');
  selectedSizeEl = document.getElementById('selected-size');

  let down = null;
  const el = renderer.domElement;

  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) {
      down = null;
      return;
    }
    down = { x: e.clientX, y: e.clientY, t: performance.now() };
  });

  el.addEventListener('pointerup', (e) => {
    if (!down || e.button !== 0) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    const elapsed = performance.now() - down.t;
    down = null;
    if (moved > 6 || elapsed > 700) return; // it was a drag, not a click
    const hit = pickAt(e.clientX, e.clientY);
    selectMesh(hit ? hit.object : null, hit ? hit.point : null);
  });

  el.addEventListener('pointercancel', () => { down = null; });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') deselect();
  });
}

/* ------------------------------------------------------------------ *
 *  UI
 * ------------------------------------------------------------------ */
function flyTo(position, target, duration = 750) {
  activeTween = {
    fromPos: camera.position.clone(),
    toPos: position.clone(),
    fromTarget: controls.target.clone(),
    toTarget: target.clone(),
    start: performance.now(),
    duration,
  };
}

function goIso() {
  const dir = new THREE.Vector3(0.72, 1.02, 0.95).normalize();
  flyTo(homeTarget.clone().addScaledVector(dir, viewDist), homeTarget);
}

function goTop() {
  const vFov = THREE.MathUtils.degToRad(camera.fov);
  const distH = modelSize.z / (2 * Math.tan(vFov / 2));
  const distW = modelSize.x / (2 * Math.tan(vFov / 2) * camera.aspect);
  const d = Math.max(distH, distW) * 1.45;
  flyTo(new THREE.Vector3(0, d, 0.01), new THREE.Vector3(0, 0, 0));
}

function initUI() {
  const btnIso = document.getElementById('btn-iso');
  const btnTop = document.getElementById('btn-top');
  const btnWalls = document.getElementById('btn-walls');
  const btnRotate = document.getElementById('btn-rotate');
  const btnLight = document.getElementById('btn-light');
  const hint = document.querySelector('.hint');

  // temporary switches for the LED coves and the GU10 track lights
  const LIGHT_BUTTONS = [
    ['btn-led-living', 'led', 'living'],
    ['btn-led-kids', 'led', 'kids'],
    ['btn-track-living', 'track', 'living'],
    ['btn-track-kids', 'track', 'kids'],
  ];
  for (const [id, kind, room] of LIGHT_BUTTONS) {
    const btn = document.getElementById(id);
    if (!btn) continue;
    btn.addEventListener('click', () => {
      const on = !lightState[kind + room[0].toUpperCase() + room.slice(1)];
      setLight(kind, room, on);
      btn.classList.toggle('active', on);
    });
  }

  btnIso.addEventListener('click', () => {
    goIso();
    btnIso.classList.add('active');
    btnTop.classList.remove('active');
  });

  btnTop.addEventListener('click', () => {
    goTop();
    btnTop.classList.add('active');
    btnIso.classList.remove('active');
  });

  btnWalls.addEventListener('click', () => {
    const cutaway = wallTargetOpacity > 0.5;
    wallTargetOpacity = cutaway ? 0.14 : 1.0;
    btnWalls.classList.toggle('active', cutaway);
  });

  btnRotate.addEventListener('click', () => {
    controls.autoRotate = !controls.autoRotate;
    btnRotate.classList.toggle('active', controls.autoRotate);
  });

  if (btnLight) {
    btnLight.addEventListener('click', () => {
      applyLighting(lightingMode === 'day' ? 'night' : 'day');
      btnLight.classList.toggle('active', lightingMode === 'day');
    });
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === '1') btnIso.click();
    if (e.key === '2') btnTop.click();
    if (e.key === '3') btnWalls.click();
    if (e.key === '4') btnRotate.click();
    if (e.key === '5' && btnLight) btnLight.click();
  });

  setTimeout(() => hint.classList.add('fade'), 9000);

  setupSelection();

  window.__viewer = {
    scene,
    camera,
    controls,
    goIso,
    goTop,
    renderer,
    THREE,
    apartment,
    selection: null,
    selectById: (id) => selectMesh(apartment.getObjectByName(id)),
    deselect,
    lamps: lampStates,
    toggleLamp,
    weather: setWeather,
    applyLighting,
    lighting: () => lightingMode,
    lightState,
    setLight,
    listObjects: () => {
      const out = [];
      apartment.traverse((o) => {
        if (o.isMesh) out.push(o.name);
      });
      return out;
    },
  };
}


/* ------------------------------------------------------------------ *
 *  Weather widget — Home Assistant pushes the current conditions here
 *  window.setApartmentWeather({ temp: 8, state: 'Облачно', icon: 'cloudy' })
 * ------------------------------------------------------------------ */
const WEATHER_SVG = {
  cloudy:
    '<path d="M13.6 34h20a6.6 6.6 0 0 0 .5-13.17 9.7 9.7 0 0 0-18.5-1.1A6.9 6.9 0 0 0 13.6 34Z"/>',
  partly:
    '<circle cx="18.5" cy="18" r="6.2"/>' +
    '<path d="M18.5 5.5v3M18.5 27.5v3M7 18h3M27 18h3M9.9 9.4l2.1 2.1M27.1 26.6l2.1 2.1M27.1 9.4l-2.1 2.1M9.9 26.6l2.1 2.1"/>' +
    '<path d="M21.5 38.5h13a5.1 5.1 0 0 0 .4-10.17 7.5 7.5 0 0 0-14.3-.85 5.3 5.3 0 0 0 .9 11Z"/>',
  sunny:
    '<circle cx="24" cy="24" r="8.4"/>' +
    '<path d="M24 6.4v4.1M24 37.5v4.1M6.4 24h4.1M37.5 24h4.1M11.6 11.6l2.9 2.9M33.5 33.5l2.9 2.9M33.5 11.6l-2.9 2.9M11.6 33.5l2.9 2.9"/>',
  rain:
    '<path d="M13.6 30h20a6.6 6.6 0 0 0 .5-13.17 9.7 9.7 0 0 0-18.5-1.1A6.9 6.9 0 0 0 13.6 30Z"/>' +
    '<path d="M17 35.5l-1.6 4.2M24.5 35.5l-1.6 4.2M32 35.5l-1.6 4.2"/>',
  snow:
    '<path d="M13.6 30h20a6.6 6.6 0 0 0 .5-13.17 9.7 9.7 0 0 0-18.5-1.1A6.9 6.9 0 0 0 13.6 30Z"/>' +
    '<path d="M17.5 36v4M15.6 37l3.8 2M19.4 37l-3.8 2M30.5 36v4M28.6 37l3.8 2M32.4 37l-3.8 2"/>',
  storm:
    '<path d="M13.6 29h20a6.6 6.6 0 0 0 .5-13.17 9.7 9.7 0 0 0-18.5-1.1A6.9 6.9 0 0 0 13.6 29Z"/>' +
    '<path d="M25 32.5l-5.4 7.2h5l-1.9 5.3 6.8-7.9h-5.1l.6-4.6Z"/>',
  fog:
    '<path d="M13.6 27h20a6.6 6.6 0 0 0 .5-13.17 9.7 9.7 0 0 0-18.5-1.1A6.9 6.9 0 0 0 13.6 27Z"/>' +
    '<path d="M10 34h24M14 39.5h17"/>',
};

const WEATHER_ICON_MAP = [
  [/гроз|thunder|storm|lightning/, 'storm'],
  [/снег|snow|sleet|hail/, 'snow'],
  [/дожд|rain|shower|drizzle/, 'rain'],
  [/туман|fog|mist|haze/, 'fog'],
  [/ясн|солн|clear|sunny/, 'sunny'],
  [/малооблач|переменн|partly/, 'partly'],
  [/обл|cloud|пасмур|overcast/, 'cloudy'],
];

const weatherRoot = document.getElementById('weather');
const weatherTempEl = document.getElementById('weather-temp');
const weatherStateEl = document.getElementById('weather-state');
const weatherIconEl = document.getElementById('weather-icon');

function weatherIconKey(word) {
  const w = String(word || '').toLowerCase();
  for (const [re, key] of WEATHER_ICON_MAP) if (re.test(w)) return key;
  return 'cloudy';
}

function weatherIconMarkup(key) {
  return (
    '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.4" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    (WEATHER_SVG[key] || WEATHER_SVG.cloudy) +
    '</svg>'
  );
}

function formatTemp(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : parseFloat(String(value).replace(',', '.'));
  if (!Number.isFinite(n)) return String(value);
  return `${Math.round(n * 10) / 10} °C`;
}

/**
 * Update the header widget.
 * @param {{temp?: number|string, state?: string, icon?: string, stale?: boolean}} data
 */
function setWeather(data = {}) {
  if (!weatherRoot) return false;
  const { temp, state, icon, stale } = data;

  const t = formatTemp(temp);
  if (t !== null && weatherTempEl) weatherTempEl.textContent = t;
  if (state && weatherStateEl) weatherStateEl.textContent = String(state);

  if (weatherIconEl) {
    const key = weatherIconKey(icon || state);
    weatherIconEl.innerHTML = weatherIconMarkup(key);
  }
  weatherRoot.classList.toggle('stale', Boolean(stale));
  weatherRoot.dataset.updated = String(Date.now());
  return true;
}

window.setApartmentWeather = setWeather;
window.addEventListener('message', (event) => {
  const d = event.data;
  if (!d || typeof d !== 'object') return;
  if (d.type === 'apartment-weather') setWeather(d.payload || d);
});

/* ------------------------------------------------------------------ *
 *  Loop
 * ------------------------------------------------------------------ */
const clock = new THREE.Clock();

function easeInOut(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function render() {
  requestAnimationFrame(render);
  const dt = clock.getDelta();

  if (activeTween) {
    const t = Math.min(1, (performance.now() - activeTween.start) / activeTween.duration);
    const k = easeInOut(t);
    camera.position.lerpVectors(activeTween.fromPos, activeTween.toPos, k);
    controls.target.lerpVectors(activeTween.fromTarget, activeTween.toTarget, k);
    if (t >= 1) activeTween = null;
  }

  if (wallMaterials.length) {
    const k = Math.min(1, dt * 9);
    for (const mat of wallMaterials) {
      if (mat.opacity === wallTargetOpacity && (wallTargetOpacity === 1 || mat.transparent)) {
        continue;
      }
      mat.transparent = true;
      mat.opacity += (wallTargetOpacity - mat.opacity) * k;
      if (Math.abs(mat.opacity - wallTargetOpacity) < 0.004) mat.opacity = wallTargetOpacity;
      mat.depthWrite = mat.opacity > 0.7;
      mat.needsUpdate = true;
      if (mat.opacity >= 0.999) {
        mat.opacity = 1;
        mat.transparent = false;
        mat.depthWrite = true;
      }
    }
  }

  controls.update();
  renderer.render(scene, camera);
}
render();

/* ------------------------------------------------------------------ *
 *  Resize
 * ------------------------------------------------------------------ */
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);

  const next = idealDistance();
  const cur = camera.position.distanceTo(controls.target);
  if (Math.abs(cur - viewDist) < viewDist * 0.06) {
    const dir = camera.position.clone().sub(controls.target).normalize();
    camera.position.copy(controls.target).addScaledVector(dir, next);
  }
  viewDist = next;
});
