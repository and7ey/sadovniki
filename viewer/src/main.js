import * as THREE from '../vendor/three.module.js?v=3';
import { OrbitControls } from '../vendor/addons/controls/OrbitControls.js?v=2';
import { GLTFLoader } from '../vendor/addons/loaders/GLTFLoader.js?v=2';
import { DRACOLoader } from '../vendor/addons/loaders/DRACOLoader.js?v=2';
import { RoomEnvironment } from '../vendor/addons/environments/RoomEnvironment.js?v=2';

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
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
// тени нужны и на телефоне, иначе свет проходит сквозь стены;
// там они дешевле: PCF вместо PCFSoft и маленькие карты
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = LOW_POWER ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
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

// иконки для нижнего столбца кнопок
const UI_ICONS = {
  iso: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.7 20.6 7.3v9.4L12 21.3 3.4 16.7V7.3Z"/><path d="M12 12.1 20.6 7.3M12 12.1 3.4 7.3M12 12.1v9.2"/></svg>',
  top: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3.4" y="3.4" width="17.2" height="17.2" rx="2.2"/><path d="M3.4 9.8h17.2M9.8 3.4v17.2"/></svg>',
  walls: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7.6h18M3 16.4h18M8.4 3v4.6M15.6 7.6v8.8M8.4 16.4V21"/></svg>',
  day: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4.1"/><path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6"/></svg>',
  evening: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18h18"/><path d="M6.8 18a5.2 5.2 0 0 1 10.4 0"/><path d="M12 3.4v2.4M5.4 6.6l1.7 1.7M18.6 6.6l-1.7 1.7"/></svg>',
  rotate: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M20.2 12a8.2 8.2 0 1 1-2.6-6"/><path d="M20.4 3.6v4.6h-4.6"/></svg>',
  night: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M20.2 14.6A8.4 8.4 0 1 1 9.4 3.8a6.7 6.7 0 0 0 10.8 10.8Z"/></svg>',
};

function setIcon(btn, name) {
  if (!btn || !UI_ICONS[name]) return;
  if (btn.dataset.icon !== name) {
    btn.innerHTML = UI_ICONS[name];
    btn.dataset.icon = name;
  }
}

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
  evening: {
    label: 'Вечер',
    exposure: 1.0,
    env: 0.10,
    hemi: [0x33405a, 0x0a0d14, 0.34],
    key: [0xffc9a0, 0.38],
    fill: [0x3d4a63, 0.18],
    rim: [0xffb877, 0.16],
    bg: ['#1c2027', '#262b33', '#12151a'],
  },
};

// Ночь → День → Вечер → Ночь
const LIGHT_CYCLE = ['night', 'day', 'evening'];
const LIGHT_NEXT_LABEL = { night: 'День', day: 'Вечер', evening: 'Ночь' };

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
// the flat now has a (hidden) ceiling, so a shadow-casting sun would put the
// whole interior in shade: keep the sun as pure fill and let the lamps cast
key.castShadow = false;
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
  if (btn) {
    setIcon(btn, mode === 'day' ? 'day' : mode === 'evening' ? 'evening' : 'night');
    btn.title = 'Освещение: ' + p.label + ' — нажмите для «' + (LIGHT_NEXT_LABEL[mode] || '') + '»';
  }
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

  const wasVisible = mirrors.map((m) => m.visible);
  mirrors.forEach((m) => { m.visible = false; });

  // low tier: no capture at all, just a glossy panel
  if (LOW_POWER) {
    const mat = new THREE.MeshStandardMaterial({ color: 0xa8b6cc, metalness: 0.85, roughness: 0.18 });
    mat.name = 'Apt_mirror_live';
    mirrors.forEach((m) => { m.material = mat; });
    mirrors.forEach((m, i) => { m.visible = wasVisible[i]; });
    console.log('[mirrors] flat (low tier)');
    return;
  }

  // One little cube capture for the whole flat: 8 mirrors x 512 px cost ~48
  // full-scene renders at load, this is 6 tiny ones.
  const box = new THREE.Box3().setFromObject(apartment);
  const center = box.getCenter(new THREE.Vector3());
  center.y = 1.6;

  const rt = new THREE.WebGLCubeRenderTarget(128, {
    generateMipmaps: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  });
  const cam = new THREE.CubeCamera(0.1, 60, rt);
  cam.position.copy(center);
  scene.add(cam);
  cam.update(renderer, scene);
  scene.remove(cam);

  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    metalness: 1.0,
    roughness: 0.06,
    envMap: rt.texture,
    envMapIntensity: 1.0,
  });
  mat.name = 'Apt_mirror_live';
  mirrors.forEach((m) => {
    m.material = mat;
    m.castShadow = false;
  });
  mirrors.forEach((m, i) => { m.visible = wasVisible[i]; });
  console.log('[mirrors] one 128px capture for', mirrors.length, 'panes');
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
      const maxW = LOW_POWER ? 512 : 1024;
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
    light.castShadow = false; // texture-unit budget: see SPOT_SHADOW_COUNT
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
// LED coves: runs are given as 3D segments with an explicit lamp count.
// Nothing is drawn — only the light they cast is visible.
const LED_RUNS = {
  living: [
    // Стена 114
    { a: [1.40, 2.82, -2.76], b: [7.22, 2.82, -2.76], count: 6 },
    // Стена 138
    { a: [7.06, 2.82, -2.93], b: [7.06, 2.82, 0.44], count: 3 },
    // Стена 129
    { a: [6.10, 2.82, 0.29], b: [7.23, 2.82, 0.29], count: 1 },
  ],
  kids: [
    // Стена 51
    { a: [-2.91, 2.82, -2.76], b: [1.11, 2.82, -2.76], count: 3 },
  ],
  kitchen: [
    // сверху вдоль Стена 14
    { a: [-7.05, 2.82, -2.76], b: [-3.30, 2.82, -2.76], count: 5 },
    // под верхними шкафами: modern_kitchen_11_095 и modern_kitchen_11_075
    // одной лентой (угол общий)
    { a: [-6.86, 2.30, -2.30], b: [-6.86, 2.30, 0.12], count: 3 },
    { a: [-6.86, 2.30, 0.12], b: [-5.05, 2.30, 0.12], count: 3 },
  ],
  hall: [
    // вертикальная лента по левому краю зеркала Box2131642365
    { a: [4.73, 0.40, 0.94], b: [4.73, 2.72, 0.94], count: 2 },
  ],
  bath: [
    // сверху Стена 27
    { a: [-4.60, 2.82, 0.95], b: [-4.60, 2.82, 2.75], count: 2 },
    // сверху Line2000006704
    { a: [-7.00, 2.82, 0.70], b: [-7.00, 2.82, 3.00], count: 2 },
    // по бокам Box2131642354
    { a: [-6.28, 0.50, 2.68], b: [-6.28, 2.50, 2.68], count: 1 },
    { a: [-5.50, 0.50, 2.68], b: [-5.50, 2.50, 2.68], count: 1 },
    // по бокам Box2131642355
    { a: [-5.33, 0.50, 2.68], b: [-5.33, 2.50, 2.68], count: 1 },
    { a: [-4.55, 0.50, 2.68], b: [-4.55, 2.50, 2.68], count: 1 },
    // под тумбой Unit_Cabinet_270(h)x500_005
    { a: [-6.40, 0.33, 2.53], b: [-4.55, 0.33, 2.53], count: 2 },
    // внутри верхнего дальнего угла Box2131642357
    { a: [-6.25, 1.44, 0.95], b: [-5.60, 1.44, 0.95], count: 1 },
  ],
  wc: [
    // внутри верхнего дальнего угла Box397
    { a: [-0.85, 1.44, 3.98], b: [0.13, 1.44, 3.98], count: 1 },
    // слева от Box398
    { a: [-0.93, 0.40, 2.60], b: [-0.93, 2.50, 2.60], count: 1 },
    // сверху Стена 70
    { a: [-0.85, 2.82, 3.70], b: [0.15, 2.82, 3.70], count: 1 },
  ],
};

// Track layout from the lighting plan.  `rect` is a rectangular track with
// `perSide` lamps per side, `strips` are straight runs with `count` lamps.
const TRACKS = {
  living: {
    label: 'гостиная',
    rect: { x: [2.84, 5.73], z: [-2.12, -0.12], perSide: 2 },
    // extra run along the east curtains (Plane1198 / Plane1200), 710 mm off
    strips: [{ a: [6.57, -2.40], b: [6.57, 0.35], count: 2 }],
  },
  kids: {
    label: 'детская',
    rect: { x: [-1.90, 0.10], z: [-2.76, -0.57], perSide: 2 },
  },
  corridor: {
    label: 'коридор',
    strips: [
      { a: [-2.33, 4.05], b: [-2.33, 2.64], count: 3 },
      // вторая полоса идёт между Стена 58 (z = 0.84) и Стена 75 (z = 2.04)
      { a: [-2.33, 1.44], b: [1.80, 1.44], count: 3 },
    ],
    // «Лампа коридор 2» убрана: индексы остальных ламп не меняются
    skip: [1],
  },
  kitchen: {
    label: 'кухня',
    strips: [
      { a: [-3.75, -2.80], b: [-3.75, 2.00], count: 3 },
      { a: [-5.78, -2.70], b: [-5.78, -0.10], count: 2 },
    ],
  },
};

// потолочные споты вне треков: ванная (GX53 3×3), санузел, балкон
const EXTRA_ROOMS = {
  bath: {
    label: 'ванная',
    points: [
      [-6.75, 1.10], [-5.80, 1.10], [-4.85, 1.10],
      [-6.75, 1.85], [-5.80, 1.85], [-4.85, 1.85],
      [-6.75, 2.60], [-5.80, 2.60], [-4.85, 2.60],
    ],
  },
  wc: {
    label: 'санузел',
    points: [[-0.35, 2.35], [-0.35, 2.95], [-0.35, 3.55]],
  },
  balcony: {
    label: 'балкон',
    // балкон: между остеклением (z ≈ -4.5) и Стена 12 (z = -3.4)
    points: [[-6.10, -3.95], [-5.00, -3.95], [-3.90, -3.95]],
  },
};


/* ------------------------------------------------------------------ *
 *  Соответствие 3D ↔ Home Assistant
 *  (только чтение: сущности взяты из core.entity_registry / REST API)
 * ------------------------------------------------------------------ */
const HA_LIGHTS = {
  living:   { track: 'switch.light_hall_l1',           led: 'switch.light_hall_l2' },
  kids:     { led: 'switch.light_nursery_l2',          track: 'switch.light_nursery_l1' },
  kitchen:  { led: 'light.switch_kitchen_led',         track: 'switch.switch_kitchen_set_light_l1' },
  bedroom:  { led: 'switch.light_bedroom' },
  hall:     { led: 'switch.light_bedroom' },   // лента у зеркала в спальне
  corridor: { track: 'switch.light_lobby_track' },
  bath:     { led: 'switch.switch_bathroom_l2',        track: 'switch.switch_bathroom_l1' },
  wc:       { led: 'switch.light_toilet_l1',           track: 'switch.light_toilet_l2' },
  balcony:  { track: 'light.light_balcony_1' },
};

// меши приборов в модели → сущности HA
const HA_DEVICES = {
  'Pan_Back002': 'climate.konder_gostinaia_air_conditioner',
  'Pan_Back': 'climate.konder_spalnia_air_conditioner',
  'Pan_Back003': 'climate.air_conditioner_as20hpl1hra',
  'Sony_KD-065': 'media_player.tv_tcl_65',
  'Sony_KD-055': 'media_player.tv_tcl_32',
};

// все меши одного кондиционера -> одна сущность
const HA_AC_PARTS = {
  'climate.konder_gostinaia_air_conditioner': ['Pan_Back002', 'Pan_body002', 'Pan_front002', 'Pan_grid002', 'Line1789551236'],
  'climate.konder_spalnia_air_conditioner': ['Pan_Back', 'Pan_body', 'Pan_front', 'Pan_grid'],
  'climate.air_conditioner_as20hpl1hra': ['Pan_Back003', 'Pan_front003', 'Pan_grid003', 'Line1789551237'],
};

// книги и прочий мусор, который убираем из сцены на клиенте
const REMOVE_3D = ['Object9319', 'Object002'];

const HA_INFO = {
  'switch.light_hall_l1': 'гостиная, реле L1',
  'switch.light_hall_l2': 'гостиная, реле L2',
  'switch.light_nursery_l1': 'детская, реле L1',
  'switch.light_nursery_l2': 'детская, реле L2',
  'light.switch_kitchen_led': 'кухня, лента',
  'switch.switch_kitchen_set_light_l1': 'кухня, подсветка L1',
  'switch.switch_kitchen_set_light_l2': 'кухня, подсветка L2',
  'switch.light_bedroom': 'спальня',
  'switch.light_lobby_track': 'прихожая, трек',
  'switch.switch_bathroom_l1': 'ванная, лампы',
  'switch.switch_bathroom_l2': 'ванная, лента',
  'switch.light_toilet_l1': 'санузел, лента',
  'switch.light_toilet_l2': 'санузел, лампы',
  'light.light_balcony_1': 'балкон, свет 1',
  'light.light_balcony_2': 'балкон, свет 2',
  'climate.konder_gostinaia_air_conditioner': 'гостиная, кондиционер',
  'climate.konder_spalnia_air_conditioner': 'спальня, кондиционер',
  'climate.air_conditioner_as20hpl1hra': 'кухня, кондиционер',
  'climate.thermostat_hall_1': 'гостиная, батарея северная',
  'climate.thermostat_hall_2': 'гостиная, батарея восточная',
  'climate.thermostat_kitchen': 'кухня, батарея',
  'climate.thermostat_nursery': 'детская, батарея',
  'climate.thermostat_bedroom': 'спальня, батарея',
  'media_player.tv_tcl_65': 'гостиная, ТВ TCL 65',
  'media_player.tv_tcl_32': 'кухня, ТВ TCL 32',
  'light.wled_tv65': 'гостиная, подсветка телевизора',
  'light.wled_tv32': 'кухня, подсветка телевизора',
  'light.wled_hall': 'гостиная, WLED-Hall',
  'light.wled_nursery_left': 'детская, WLED слева',
  'light.wled_nursery_right': 'детская, WLED справа',
  'cover.curtain_driver_hall': 'гостиная, лёгкая штора',
  'cover.curtain_driver2_hall': 'гостиная, северная штора',
  'cover.curtain_motor_hall': 'гостиная, восточная штора',
  'cover.blinds_controller_blackout_nursery': 'детская, блэкаут',
  'cover.blinds_controller_tulle_nursery': 'детская, тюль',
  'cover.curtain_driver_left_nursery': 'детская, левая штора',
  'cover.curtain_driver_right_nursery': 'детская, правая штора',
  'cover.curtain_driver_bedroom': 'спальня, штора',
};

function haEntity(kind, room) {
  const row = HA_LIGHTS[room];
  return (row && row[kind]) || null;
}

const LED_INTENSITY = 4;
const TRACK_DEFAULT = 10;
const CEILING_Y = 3.0;

// Every light costs frame time: a scene with 29 spot lights renders at ~13 fps
// on this machine, 16 stay at 60.  So both coves and tracks share a fixed pool
// of lights that is re-aimed at the lamps of the groups that are switched on.
const LED_POOL = 6;
const SPOT_POOL = 8;
// Every room keeps its own slice of the pool for the whole session.  A lamp is
// never re-aimed because another room was switched on or off, so the light in
// the living room no longer moves when the hall light is toggled.
const LED_ROOM_SLOTS = { living: 1, kids: 1, kitchen: 1, hall: 1, bath: 1, wc: 1 };
const LED_ROOM_INTENSITY = { living: 6, kitchen: 6, bath: 6, kids: 4, hall: 4, wc: 4 };
const SPOT_ROOM_SLOTS = { living: 2, kids: 1, corridor: 1, kitchen: 1, bath: 1, wc: 1, balcony: 1 };
// The GPU only has ~16 texture units and every shadow-casting light takes one:
// 6 coves + 6 track lamps = 12 fit next to the material maps, 15+ makes the
// whole scene disappear.  So the pendant lights no longer cast shadows.

const ledPool = [];
const spotPool = [];
const ledPlan = [];          // fixed { room, p, intensity } per pool light
const spotPlan = [];         // fixed { room, p } per pool light
const trackFixtures = {};   // room -> [{ x, z, y, intensity, mesh }]
const trackGroups = {};     // room -> THREE.Group with rails + lamp heads
const trackIntensity = { living: TRACK_DEFAULT, kids: TRACK_DEFAULT, corridor: TRACK_DEFAULT, kitchen: TRACK_DEFAULT };
const lightState = {
  ledLiving: false,
  ledKids: false,
  ledKitchen: false,
  ledHall: false,
  trackLiving: false,
  trackKids: false,
  trackCorridor: false,
  trackKitchen: false,
  trackBath: false,
  trackWc: false,
  trackBalcony: false,
  ledBath: false,
  ledWc: false,
};
let pendingMove = null;     // { room, index } while a lamp is being re-placed

function cap(room) {
  return room[0].toUpperCase() + room.slice(1);
}

function pointsOnRuns(runs) {
  const pts = [];
  for (const run of runs) {
    for (let i = 0; i < run.count; i++) {
      const f = (i + 0.5) / run.count;
      pts.push([
        run.a[0] + (run.b[0] - run.a[0]) * f,
        run.a[1] + (run.b[1] - run.a[1]) * f,
        run.a[2] + (run.b[2] - run.a[2]) * f,
      ]);
    }
  }
  return pts;
}

function trackPoints(track) {
  const pts = [];
  if (track.rect) {
    const { x, z, perSide } = track.rect;
    const side = (ax, az, bx, bz) => {
      for (let i = 0; i < perSide; i++) {
        const f = (i + 1) / (perSide + 1);
        pts.push([ax + (bx - ax) * f, 2.92, az + (bz - az) * f]);
      }
    };
    side(x[0], z[0], x[1], z[0]);
    side(x[0], z[1], x[1], z[1]);
    side(x[0], z[0], x[0], z[1]);
    side(x[1], z[0], x[1], z[1]);
  }
  for (const s of track.strips || []) {
    for (let i = 0; i < s.count; i++) {
      const f = (i + 0.5) / s.count;
      pts.push([s.a[0] + (s.b[0] - s.a[0]) * f, 2.92, s.a[1] + (s.b[1] - s.a[1]) * f]);
    }
  }
  return pts;
}

// Pick `count` real lamp positions spread over the room's runs: one per slice of
// the list, always the point closest to the slice centre.  Never interpolated,
// so the light always sits on an actual cove / track head.
function pickRoomPoints(pts, count) {
  const out = [];
  if (!pts.length) return out;
  const n = Math.max(1, count);
  for (let k = 0; k < n; k++) {
    const from = Math.floor((k * pts.length) / n);
    const to = Math.max(from + 1, Math.floor(((k + 1) * pts.length) / n));
    const chunk = pts.slice(from, to);
    let cx = 0, cz = 0;
    for (const p of chunk) { cx += p[0]; cz += p[2]; }
    cx /= chunk.length; cz /= chunk.length;
    let best = chunk[0], bestD = Infinity;
    for (const p of chunk) {
      const dx = p[0] - cx, dz = p[2] - cz;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = p; }
    }
    out.push(best);
  }
  return out;
}

// the plan is built once, after the track fixtures exist
function buildLightPlans() {
  ledPlan.length = 0;
  for (const [room, count] of Object.entries(LED_ROOM_SLOTS)) {
    const runs = LED_RUNS[room];
    if (!runs) continue;
    for (const p of pickRoomPoints(pointsOnRuns(runs), count)) {
      ledPlan.push({ room, p, intensity: LED_ROOM_INTENSITY[room] ?? LED_INTENSITY });
    }
  }
  spotPlan.length = 0;
  for (const [room, count] of Object.entries(SPOT_ROOM_SLOTS)) {
    const fixtures = (trackFixtures[room] || []).filter(Boolean).map((f) => [f.x, f.y, f.z]);
    for (const p of pickRoomPoints(fixtures, count)) spotPlan.push({ room, p });
  }
  console.log('[light] plan', ledPlan.length + ' led,', spotPlan.length + ' spot');
}

// switching a room only changes the intensity of lamps it owns
function refreshLeds() {
  let used = 0;
  ledPool.forEach((light, i) => {
    const item = ledPlan[i];
    const on = !!item && !!lightState['led' + cap(item.room)];
    light.intensity = on ? item.intensity : 0;
    if (on) used++;
  });
  return used;
}

function refreshTracks() {
  let used = 0;
  spotPool.forEach((spot, i) => {
    const item = spotPlan[i];
    const on = !!item && !!lightState['track' + cap(item.room)];
    spot.intensity = on ? (trackIntensity[item.room] ?? TRACK_DEFAULT) : 0;
    if (on) used++;
  });
  return used;
}

function buildLightPools() {
  // на телефоне карты теней мельче, но состав пула тот же, иначе комнаты
  // начали бы «делить» источники и свет прыгал бы между ними
  for (let i = 0; i < LED_POOL; i++) {
    // slower falloff + more sources per run: the cove reads as one even wash
    // instead of a row of separate pools
    const light = new THREE.PointLight(0xffc27a, 0, 9, 1.5);
    light.castShadow = true;
    light.shadow.mapSize.set(LOW_POWER ? 128 : 256, LOW_POWER ? 128 : 256);
    light.shadow.camera.near = 0.06;
    light.shadow.camera.far = 8;
    light.shadow.bias = -0.004;
    light.shadow.normalBias = 0.03;
    light.shadow.autoUpdate = false;
    light.shadow.needsUpdate = true;
    scene.add(light);
    ledPool.push(light);
  }
  for (let i = 0; i < SPOT_POOL; i++) {
    // последний спот — балкон: он за стеклом, тень ему не нужна, а
    // узкий конус не даёт свету уйти через стену на кухню
    const balcony = i >= SPOT_POOL - 1;
    const spot = balcony
      ? new THREE.SpotLight(0xfff0d8, 0, 9, 0.85, 0.9, 1.7)
      : new THREE.SpotLight(0xfff0d8, 0, 10, 1.5, 1.0, 1.7);
    spot.castShadow = !balcony;
    if (spot.castShadow) {
      spot.shadow.mapSize.set(LOW_POWER ? 256 : 512, LOW_POWER ? 256 : 512);
      spot.shadow.camera.near = 0.08;
      spot.shadow.camera.far = 8;
      spot.shadow.bias = -0.0025;
      spot.shadow.normalBias = 0.03;
      spot.shadow.autoUpdate = false;
      spot.shadow.needsUpdate = true;
    }
    scene.add(spot, spot.target);
    spotPool.push(spot);
  }

  // ставки на постоянные места: комнаты больше не отбирают лампы друг у друга
  ledPlan.forEach((item, i) => {
    const light = ledPool[i];
    if (!light) return;
    light.position.set(item.p[0], item.p[1], item.p[2]);
    light.shadow.needsUpdate = true;
  });
  spotPlan.forEach((item, i) => {
    const spot = spotPool[i];
    if (!spot) return;
    spot.position.set(item.p[0], item.p[1], item.p[2]);
    spot.target.position.set(item.p[0], 0, item.p[2]);
    spot.target.updateMatrixWorld();
    if (spot.castShadow) spot.shadow.needsUpdate = true;
  });

  console.log('[light] pool led', ledPool.length, 'spot', spotPool.length,
    'shadow', ledPool.length + spotPool.filter((s) => s.castShadow).length);
}

/* ------------------------------------------------------------------ *
 *  Track rails + lamp heads (visible so they can be placed by hand)
 * ------------------------------------------------------------------ */
function buildTracks() {
  const railMat = new THREE.MeshStandardMaterial({ color: 0x35373c, roughness: 0.45, metalness: 0.6 });
  const lensMat = new THREE.MeshStandardMaterial({
    color: 0x1a1a16,
    roughness: 0.3,
    emissive: new THREE.Color(0xffd9a4),
    emissiveIntensity: 0.55,
  });

  const bar = (group, a, b, y) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(len, 0.026, 0.042), railMat);
    mesh.position.set((a[0] + b[0]) / 2, y, (a[1] + b[1]) / 2);
    mesh.rotation.y = -Math.atan2(b[1] - a[1], b[0] - a[0]);
    group.add(mesh);
  };

  // рейки и плафоны не рисуем: важно только освещение
  const SHOW_FIXTURES = false;
  for (const [room, track] of Object.entries(TRACKS)) {
    const group = new THREE.Group();
    group.name = 'Track_' + room;

    if (SHOW_FIXTURES && track.rect) {
      const { x, z } = track.rect;
      const y = 2.955;
      bar(group, [x[0], z[0]], [x[1], z[0]], y);
      bar(group, [x[0], z[1]], [x[1], z[1]], y);
      bar(group, [x[0], z[0]], [x[0], z[1]], y);
      bar(group, [x[1], z[0]], [x[1], z[1]], y);
    }
    if (SHOW_FIXTURES) for (const s of track.strips || []) bar(group, s.a, s.b, 2.955);

    const fixtures = [];
    const skip = new Set(track.skip || []);
    trackPoints(track).forEach((p, i) => {
      if (skip.has(i)) {
        fixtures.push(null);
        return;
      }
      if (!SHOW_FIXTURES) {
        fixtures.push({ x: p[0], y: p[1], z: p[2], intensity: trackIntensity[room], mesh: null });
        return;
      }
      // без абажура: только плоская светящаяся шайба на шинопроводе.
      // так свет расходится шире и ровнее, а плафон его не «режет»
      const head = new THREE.Mesh(new THREE.CircleGeometry(0.05, 20), lensMat.clone());
      head.rotation.x = Math.PI / 2; // смотрит вниз
      head.position.set(p[0], 2.94, p[2]);
      head.castShadow = false;
      head.userData.track = { room, index: i };
      head.name = 'Лампа ' + track.label + ' ' + (i + 1);
      group.add(head);

      fixtures.push({ x: p[0], y: p[1], z: p[2], intensity: trackIntensity[room], mesh: head });
    });

    scene.add(group);
    trackGroups[room] = group;
    trackFixtures[room] = fixtures;
  }

  // потолочные споты ванной / санузла / балкона — те же плафоны, без реек
  for (const [room, def] of Object.entries(EXTRA_ROOMS)) {
    const group = new THREE.Group();
    group.name = 'Track_' + room;
    const fixtures = [];
    def.points.forEach((p, i) => {
      if (!SHOW_FIXTURES) {
        fixtures.push({ x: p[0], y: 2.92, z: p[1], intensity: TRACK_DEFAULT, mesh: null });
        return;
      }
      const head = new THREE.Mesh(new THREE.CircleGeometry(0.05, 20), lensMat.clone());
      head.rotation.x = Math.PI / 2;
      head.position.set(p[0], 2.94, p[1]);
      head.userData.track = { room, index: i };
      head.name = 'Лампа ' + def.label + ' ' + (i + 1);
      group.add(head);
      fixtures.push({ x: p[0], y: 2.92, z: p[1], intensity: trackIntensity[room] ?? TRACK_DEFAULT, mesh: head });
    });
    scene.add(group);
    trackGroups[room] = group;
    trackFixtures[room] = fixtures;
    trackIntensity[room] = trackIntensity[room] ?? TRACK_DEFAULT;
  }
  console.log('[track] built', Object.keys(trackFixtures)
    .map((k) => k + ':' + trackFixtures[k].length).join(' '));
}

/* ------------------------------------------------------------------ *
 *  Invisible ceiling — stops the interior lights from bleeding over the
 *  wall tops into the next room while staying out of the picture.
 * ------------------------------------------------------------------ */
function buildCeiling() {
  const outline = apartmentOutline();
  if (outline.length < 3) return;
  const shape = new THREE.Shape();
  outline.forEach(([x, z], i) => (i ? shape.lineTo(x, -z) : shape.moveTo(x, -z)));
  shape.closePath();
  const geo = new THREE.ShapeGeometry(shape);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, CEILING_Y - 0.01, 0);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  mat.colorWrite = false;   // never appears on screen
  mat.depthWrite = false;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'CeilingShadow';
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  mesh.raycast = () => {};
  scene.add(mesh);
  console.log('[ceiling] shadow catcher at y', CEILING_Y - 0.01);
}

function setLight(kind, room, on) {
  lightState[kind + cap(room)] = on;
  const used = kind === 'led' ? refreshLeds() : refreshTracks();
  const entity = haEntity(kind, room);
  console.log('[light]', entity || (kind + ':' + room), on ? 'ON' : 'OFF', 'lamps', used);
  return on;
}

function setTrackIntensity(room, value) {
  const v = Math.max(0, Number(value) || 0);
  trackIntensity[room] = v;
  for (const f of trackFixtures[room] || []) if (f) f.intensity = v;
  refreshTracks();
  return v;
}

/* ------------------------------------------------------------------ *
 *  Click a lamp head, then click the spot where it should hang
 * ------------------------------------------------------------------ */
function fixtureAt(object) {
  let o = object;
  while (o) {
    if (o.userData && o.userData.track) return { ...o.userData.track, object: o };
    o = o.parent;
  }
  return null;
}

function startFixtureMove(room, index) {
  const f = trackFixtures[room] && trackFixtures[room][index];
  if (!f || !f.mesh) return;
  if (pendingMove) clearFixtureHighlight();
  pendingMove = { room, index };
  f.mesh.material.color.setHex(0xff8a3d);
  f.mesh.material.emissive.setHex(0xff8a3d);
  console.log('[fixture] выбран', 'Лампа ' + TRACKS[room].label + ' ' + (index + 1),
    '— кликните новое место');
  showHint('Лампа ' + TRACKS[room].label + ' ' + (index + 1) + ': кликните новое место');
}

function clearFixtureHighlight() {
  if (!pendingMove) return;
  const f = trackFixtures[pendingMove.room] && trackFixtures[pendingMove.room][pendingMove.index];
  if (f && f.mesh) {
    f.mesh.material.color.setHex(0x1a1a16);
    f.mesh.material.emissive.setHex(0xffd9a4);
  }
  pendingMove = null;
  showHint('');
}

function moveFixtureTo(point) {
  if (!pendingMove) return null;
  const { room, index } = pendingMove;
  const f = trackFixtures[room][index];
  f.x = point.x;
  f.z = point.z;
  if (f.mesh) {
    f.mesh.position.x = point.x;
    f.mesh.position.z = point.z;
  }
  const name = 'Лампа ' + TRACKS[room].label + ' ' + (index + 1);
  console.log('[fixture]', name, 'x', point.x.toFixed(2), 'z', point.z.toFixed(2));
  showHint(name + ' → x ' + point.x.toFixed(2) + ', z ' + point.z.toFixed(2));
  clearFixtureHighlight();
  refreshTracks();
  return { room, index, x: +point.x.toFixed(2), z: +point.z.toFixed(2) };
}

function showHint() { /* плашка «Выбрано» убрана */ }

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
  './public/apartment.glb?v=15',
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

    controls.target.fromArray(DEFAULT_VIEW.target);
    camera.position.fromArray(DEFAULT_VIEW.pos);
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
    buildTracks();
    buildLightPlans();
    buildLightPools();
    buildCeiling();
    setupDevices();
    setupCurtains();
    removeJunk();
    setupUnderfloor();
    buildVacuum();

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

  const targets = [apartment];
  for (const g of Object.values(trackGroups)) targets.push(g);
  for (const c of curtainTargets) targets.push(c);
  const hits = raycaster.intersectObjects(targets, true).filter((h) => h.object.isMesh);
  if (!hits.length) return null;

  // faded walls and transparent glass should not block what is behind them
  const fadedWalls = wallTargetOpacity < 0.5;
  const candidates = hits.filter((h) => !(fadedWalls && wallMeshSet.has(h.object)));
  const solid = candidates.find((h) => !isGlassMesh(h.object));
  return solid || candidates[0] || hits[0];
}

function setupSelection() {
  let down = null;
  const el = renderer.domElement;

  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) { down = null; return; }
    down = { x: e.clientX, y: e.clientY, t: performance.now() };
  });

  el.addEventListener('pointerup', (e) => {
    if (!down || e.button !== 0) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    const elapsed = performance.now() - down.t;
    down = null;
    if (moved > 6 || elapsed > 700) return; // протаскивание, а не тап
    if (sheetOpenFor) { closeSheet(); return; }
    const hit = pickAt(e.clientX, e.clientY);
    if (!hit) return;
    const curt = curtainAt(hit.object);
    if (curt) { toggleCurtain(curt); return; }
    const dev = deviceAt(hit.object);
    if (dev) { openDeviceSheet(dev); return; }
    const fixture = fixtureAt(hit.object);
    if (fixture) { startFixtureMove(fixture.room, fixture.index); return; }
    if (pendingMove) { moveFixtureTo(hit.point); return; }
    if (selectionEnabled && hit.object) {
      console.log('[select]', hit.object.name, hit.point ? hit.point.toArray().map((v) => +v.toFixed(2)) : '');
      return;
    }
    // выделение и одиночный зум по тапу убраны: комната открывается двойным
  });

  el.addEventListener('pointercancel', () => { down = null; });

  el.addEventListener('dblclick', (e) => {
    e.preventDefault();
    toggleRoomAt(e.clientX, e.clientY);
  });

  let lastTap = 0;
  let lastTapPos = { x: 0, y: 0 };
  el.addEventListener('pointerup', (e) => {
    if (e.pointerType !== 'touch') return;
    const now = performance.now();
    if (now - lastTap < 320 &&
        Math.hypot(e.clientX - lastTapPos.x, e.clientY - lastTapPos.y) < 34) {
      lastTap = 0;
      toggleRoomAt(e.clientX, e.clientY);
    } else {
      lastTap = now;
      lastTapPos = { x: e.clientX, y: e.clientY };
    }
  });
}


/* ------------------------------------------------------------------ *
 *  Кондиционеры и телевизоры: клик включает/выключает, с анимацией
 * ------------------------------------------------------------------ */
// внутренние блоки кондиционеров в модели — Pan_back / Pan_body / Pan_front
const AC_RE = /^pan_(body|front|back)\d*$/i;
const TV_RE = /^sony[_ ]kd-\d{3}$/i;

const devices = [];          // { mesh, kind, on, overlay, mat, baseTex }
let deviceClock = 0;
const AIR_STREAKS = 54;
const AIR_REACH = 2.1;
const AIR_FLOOR = 0.03;
const AIR_COLOR = new THREE.Color(0x9fd4ff);
const deviceMats = new Set();

function softAirTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, 'rgba(255,255,255,0.85)');
  grad.addColorStop(0.35, 'rgba(210,235,255,0.35)');
  grad.addColorStop(1, 'rgba(180,220,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 128);
  for (let i = 0; i < 26; i++) {
    const x = Math.random() * 64;
    g.strokeStyle = 'rgba(255,255,255,' + (0.05 + Math.random() * 0.12).toFixed(2) + ')';
    g.lineWidth = 1 + Math.random() * 2;
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x + (Math.random() - 0.5) * 10, 128);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function tvTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 72;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 128, 72);
  grad.addColorStop(0, '#2a6fb8');
  grad.addColorStop(0.4, '#5fa7e8');
  grad.addColorStop(0.7, '#b98cf8');
  grad.addColorStop(1, '#21365e');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 72);
  for (let i = 0; i < 5; i++) {
    g.fillStyle = 'rgba(255,255,255,' + (0.04 + Math.random() * 0.05).toFixed(2) + ')';
    g.fillRect(Math.random() * 128, Math.random() * 72, 30 + Math.random() * 60, 6 + Math.random() * 16);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const AIR_TEX = softAirTexture();
const TV_TEX = tvTexture();

function openSide(box, mesh) {
  // прибор — плоская панель на стене: сторона, куда он «смотрит», — та, где
  // находится комната. Так надёжнее, чем лучи: у телевизора за стеной соседняя
  // комната тоже «свободна»
  const c = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const dims = [size.x, size.y, size.z];
  const thin = dims.indexOf(Math.min(dims[0], dims[1], dims[2]));

  let best = null;
  let bestDist = Infinity;
  for (const r of Object.values(ROOMS)) {
    if (c.x < r.x[0] - 0.12 || c.x > r.x[1] + 0.12) continue;
    if (c.z < r.z[0] - 0.12 || c.z > r.z[1] + 0.12) continue;
    const cx = (r.x[0] + r.x[1]) / 2;
    const cz = (r.z[0] + r.z[1]) / 2;
    const d = Math.hypot(c.x - cx, c.z - cz);
    if (d < bestDist) { bestDist = d; best = { cx, cz }; }
  }

  if (best) {
    const vx = best.cx - c.x;
    const vz = best.cz - c.z;
    if (thin === 0) return new THREE.Vector3(Math.sign(vx) || 1, 0, 0);
    if (thin === 2) return new THREE.Vector3(0, 0, Math.sign(vz) || 1);
    return new THREE.Vector3(Math.sign(vx) || 1, 0, 0);
  }

  // запасной путь: самая свободная сторона по тонкой оси
  const axis = new THREE.Vector3(thin === 0 ? 1 : 0, thin === 1 ? 1 : 0, thin === 2 ? 1 : 0);
  const ray = new THREE.Raycaster();
  const dists = [];
  for (const dir of [axis, axis.clone().negate()]) {
    ray.set(c.clone().addScaledVector(dir, 0.03), dir);
    ray.far = 8;
    const hits = ray.intersectObject(apartment, true).filter((h) =>
      h.object !== mesh && h.object.isMesh && h.distance > 0.05 &&
      !devices.some((dv) => dv.mesh === h.object));
    dists.push(hits.length ? hits[0].distance : 8);
  }
  return dists[0] >= dists[1] ? axis : axis.clone().negate();
}

function registerDevice(mesh, kind) {
  if (!mesh || !mesh.geometry) return;
  if (devices.some((d) => d.mesh === mesh)) return;
  const box = new THREE.Box3().setFromObject(mesh);
  const size = box.getSize(new THREE.Vector3());
  if (size.length() < 0.2) return;

  const dev = { mesh, kind, on: false, overlay: null, mat: null, dir: openSide(box, mesh, kind === 'ac') };

  if (kind === 'tv') {
    // экран: плоская панель чуть впереди полотна
    const thinZ = size.z <= size.x && size.z <= size.y;
    const w = thinZ ? size.x : size.z;
    const h = size.y;
    const geo = new THREE.PlaneGeometry(w * 0.94, h * 0.92);
    const mat = new THREE.MeshBasicMaterial({
      map: TV_TEX.clone(),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      toneMapped: false,
    });
    mat.name = 'Apt_tv_screen';
    mat.map.needsUpdate = true;
    const plane = new THREE.Mesh(geo, mat);
    plane.renderOrder = 4;
    const c = box.getCenter(new THREE.Vector3());
    if (thinZ) {
      plane.position.set(c.x, c.y, dev.dir.z >= 0 ? box.max.z + 0.004 : box.min.z - 0.004);
      if (dev.dir.z < 0) plane.rotation.y = Math.PI;
    } else {
      plane.position.set(dev.dir.x >= 0 ? box.max.x + 0.004 : box.min.x - 0.004, c.y, c.z);
      plane.rotation.y = dev.dir.x >= 0 ? Math.PI / 2 : -Math.PI / 2;
    }
    plane.visible = false;
    plane.raycast = () => {};
    scene.add(plane);
    dev.overlay = plane;
    dev.mat = mat;
    dev.baseTex = mat.map;
    dev.texSize = thinZ ? w : w;
  } else {
    // кондиционер: поток из коротких аддитивных струек (как в house-control)
    const c = box.getCenter(new THREE.Vector3());
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(AIR_STREAKS * 6);
    const col = new Float32Array(AIR_STREAKS * 6);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    mat.name = 'Apt_ac_air';
    const flow = new THREE.LineSegments(geo, mat);
    flow.frustumCulled = false;
    flow.visible = false;
    flow.renderOrder = 3;
    flow.raycast = () => {};
    scene.add(flow);

    dev.overlay = flow;
    dev.mat = mat;
    dev.origin = new THREE.Vector3(
      c.x + dev.dir.x * 0.2,
      box.min.y + 0.02,
      c.z + dev.dir.z * 0.2
    );
    dev.perp = new THREE.Vector3(-dev.dir.z, 0, dev.dir.x);
    dev.seeds = Array.from({ length: AIR_STREAKS }, (_, i) => ({
      phase: (i * 0.618034) % 1,
      u: ((i * 0.381966) % 1) * 2 - 1,
      speed: 0.8 + ((i * 0.7548) % 1) * 0.5,
      wobble: (i * 2.399) % (Math.PI * 2),
    }));
    dev.power = 0;
    dev.clock = 0;
  }

  dev.entity = HA_DEVICES[mesh.name] || null;
  mesh.userData.device = dev;
  devices.push(dev);
  console.log('[device]', kind, mesh.name, '->', dev.entity || '(нет в HA)', 'dir',
    dev.dir.toArray().map((v) => +v.toFixed(1)).join(','));
  return dev;
}

function looksLikeAc(mesh) {
  return mesh.isMesh && AC_RE.test(mesh.name);
}

function linkAcParts() {
  for (const [entity, names] of Object.entries(HA_AC_PARTS)) {
    const dev = devices.find((d) => d.entity === entity);
    if (!dev) continue;
    const parts = [];
    for (const n of names) {
      const o = apartment.getObjectByName(n);
      if (!o) continue;
      o.userData.device = dev;
      parts.push(n);
    }
    dev.parts = parts;
    console.log('[device]', entity, 'кликабельные части:', parts.join(', '));
  }
}

function removeJunk() {
  let n = 0;
  for (const name of REMOVE_3D) {
    const o = apartment.getObjectByName(name);
    if (!o) continue;
    o.parent.remove(o);
    n++;
  }
  console.log('[cleanup] removed', n, 'objects');
}

function setupDevices() {
  const seen = [];
  apartment.traverse((o) => {
    if (!o.isMesh) return;
    if (TV_RE.test(o.name)) {
      const tb = new THREE.Box3().setFromObject(o);
      const tc = tb.getCenter(new THREE.Vector3());
      if (seen.some((p) => p.distanceTo(tc) < 0.3)) return;
      seen.push(tc);
      registerDevice(o, 'tv');
      return;
    }
    if (!looksLikeAc(o)) return;
    // соседние части одного корпуса регистрируем один раз
    const b = new THREE.Box3().setFromObject(o);
    const c = b.getCenter(new THREE.Vector3());
    if (seen.some((p) => p.distanceTo(c) < 0.45)) return;
    seen.push(c);
    registerDevice(o, 'ac');
  });
  linkAcParts();
  console.log('[device] total', devices.length,
    devices.map((d) => d.kind + ':' + d.mesh.name).join(' | '));
}

function toggleDevice(dev) {
  if (!dev) return false;
  dev.on = !dev.on;
  if (dev.mat && dev.kind === 'tv') dev.mat.opacity = dev.on ? 0.95 : 0;
  if (dev.overlay) dev.overlay.visible = dev.on;
  console.log('[device]', dev.entity || dev.mesh.name, dev.on ? 'ON' : 'OFF');
  return dev.on;
}

function deviceAt(object) {
  let o = object;
  while (o) {
    if (o.userData && o.userData.device) return o.userData.device;
    o = o.parent;
  }
  return null;
}

function updateDevices(dt, t) {
  for (const d of devices) {
    if (d.kind === 'tv') {
      if (!d.on || !d.mat || !d.mat.map) continue;
      d.mat.map.offset.x = (t * 0.06) % 1;
      d.mat.opacity = 0.9 + 0.08 * Math.sin(t * 5);
      continue;
    }

    d.power += ((d.on ? 1 : 0) - d.power) * (1 - Math.exp(-dt * 4));
    if (d.power < 0.004) {
      if (d.overlay) d.overlay.visible = false;
      continue;
    }
    if (!d.overlay) continue;
    d.overlay.visible = true;
    d.clock += dt;

    const geo = d.overlay.geometry;
    const pos = geo.attributes.position.array;
    const col = geo.attributes.color.array;
    const o = d.origin;
    const dir = d.dir;
    const perp = d.perp;
    const drop = 0.62;
    const sinD = Math.sin(drop);
    const cosD = Math.cos(drop);
    const r = AIR_COLOR.r;
    const g = AIR_COLOR.g;
    const b = AIR_COLOR.b;

    const sample = (seed, tt, arr, k) => {
      const dist = AIR_REACH * tt;
      let lateral = seed.u * (0.3 + 0.5 * tt) +
        Math.sin(d.clock * 1.6 + seed.wobble + tt * 5) * 0.04 * tt;
      let y = o.y - sinD * dist - 0.42 * tt * tt;
      const under = Math.max(0, AIR_FLOOR - y);
      if (under > 0) {
        y = AIR_FLOOR;
        lateral += under * 0.9;
      }
      const fwd = cosD * dist;
      arr[k] = o.x + dir.x * fwd + perp.x * lateral;
      arr[k + 1] = y;
      arr[k + 2] = o.z + dir.z * fwd + perp.z * lateral;
    };

    for (let i = 0; i < AIR_STREAKS; i++) {
      const seed = d.seeds[i];
      const tt = (seed.phase + d.clock * 0.42 * seed.speed) % 1;
      const tail = Math.max(0, tt - 0.09);
      sample(seed, tt, pos, i * 6);
      sample(seed, tail, pos, i * 6 + 3);
      const fade = Math.pow(Math.sin(Math.PI * tt), 0.7) * d.power * 1.35;
      col[i * 6] = r * fade; col[i * 6 + 1] = g * fade; col[i * 6 + 2] = b * fade;
      col[i * 6 + 3] = r * fade * 0.12; col[i * 6 + 4] = g * fade * 0.12; col[i * 6 + 5] = b * fade * 0.12;
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
  }
}


/* ------------------------------------------------------------------ *
 *  Шторы: сдвижные (клик открывает/закрывает) и римские (сверху вниз)
 * ------------------------------------------------------------------ */
const CURTAIN_SLIDE = [
  // северная: вплотную к Plane003, шириной до правого края окна (Window023: 2.08..3.77)
  { name: 'Plane008', entity: 'cover.curtain_driver2_hall', axis: 'x', fit: [1.71, 3.87] },
  // восточная: докрывает окно до следующей шторы
  { name: 'Plane1200', entity: 'cover.curtain_motor_hall', axis: 'z', fit: [-2.46, -0.70], anchor: 'max' },
];

// статичные створки, которым меняем размер (Plane003 — вдвое уже)
const CURTAIN_TRIM = [
  { name: 'Plane003', axis: 'x', fit: [1.27, 1.71] },
];

// обе шторы на всю ширину окна; левая опускается меньше, правая — почти до низа,
// чтобы в закрытом виде обе были крупными и по ним легко было попасть кликом
const CURTAIN_ROMAN = [
  {
    names: ['Plane1215', 'Plane004'], entity: 'cover.curtain_driver_left',
    x: [-2.18, 0.60], color: 0xc4c4c4, z: -2.87, min: 0.14, max: 0.90,
  },
  {
    names: ['Plane1214', 'Plane006'], entity: 'cover.curtain_driver_right',
    x: [-2.18, 0.60], color: 0xe6e6e6, z: -2.85, min: 0.10, max: 1.00,
  },
];
const ROMAN_TOP = 2.64;
const ROMAN_BOTTOM = 0.56;
const ROMAN_Z = -2.80;

const curtains = [];
const curtainTargets = [];

function romanTexture() {
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 32, 256);
  for (let i = 0; i < 256; i += 26) {
    const grd = g.createLinearGradient(0, i, 0, i + 26);
    grd.addColorStop(0, 'rgba(0,0,0,0.10)');
    grd.addColorStop(0.45, 'rgba(255,255,255,0.0)');
    grd.addColorStop(1, 'rgba(0,0,0,0.06)');
    g.fillStyle = grd;
    g.fillRect(0, i, 32, 26);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.repeat.set(1, 3);
  return tex;
}

const ROMAN_TEX = romanTexture();

// сжать/растянуть меш по мировой оси так, чтобы он занял [from, to]
function fitMesh(mesh, axis, from, to) {
  mesh.updateMatrixWorld(true);
  const t = axis === 'x' ? 'x' : 'z';
  const b0 = new THREE.Box3().setFromObject(mesh);
  const cur = b0.max[t] - b0.min[t];
  const target = to - from;
  if (cur > 1e-4 && Math.abs(target - cur) > 1e-3) {
    const k = target / cur;
    if (axis === 'x') mesh.scale.x *= k;
    else mesh.scale.z *= k;
    mesh.updateMatrixWorld(true);
  }
  const b1 = new THREE.Box3().setFromObject(mesh);
  const delta = from - b1.min[t];
  if (axis === 'x') mesh.position.x += delta;
  else mesh.position.z += delta;
  mesh.updateMatrixWorld(true);
}

function setupCurtains() {
  apartment.updateMatrixWorld(true);

  for (const def of CURTAIN_TRIM) {
    const mesh = apartment.getObjectByName(def.name);
    if (!mesh) continue;
    fitMesh(mesh, def.axis, def.fit[0], def.fit[1]);
    console.log('[curtain] trim', def.name, '→', def.fit.join('..'));
  }

  // сдвижные: оборачиваем створку в группу на краю окна и жмём по ширине
  for (const def of CURTAIN_SLIDE) {
    const mesh = apartment.getObjectByName(def.name);
    if (!mesh) { console.warn('[curtain] нет', def.name); continue; }
    if (def.fit) fitMesh(mesh, def.axis, def.fit[0], def.fit[1]);
    const box = new THREE.Box3().setFromObject(mesh);
    const cx = (box.min.x + box.max.x) / 2;
    const cz = (box.min.z + box.max.z) / 2;
    const far = def.anchor === 'max';
    const anchor = new THREE.Group();
    anchor.position.set(
      def.axis === 'x' ? (far ? box.max.x : box.min.x) : cx,
      (box.min.y + box.max.y) / 2,
      def.axis === 'x' ? cz : (far ? box.max.z : box.min.z)
    );
    // группа в мировых координатах: apartment сам смещён, из-за этого штора
    // раньше «улетала» в другую комнату
    scene.add(anchor);
    anchor.attach(mesh);
    // в модели шторы нарисованы задёрнутыми
    const entry = {
      kind: 'slide', entity: def.entity, axis: def.axis,
      obj: mesh, pivot: anchor, closed: 1, target: 1,
    };
    curtains.push(entry);
    curtainTargets.push(mesh);
    mesh.userData.curtain = entry;
    console.log('[curtain] slide', def.name, def.entity);
  }

  // римские: вместо двух створок — одна штора, опускается сверху вниз
  for (const def of CURTAIN_ROMAN) {
    for (const n of def.names) {
      const o = apartment.getObjectByName(n);
      if (o) o.visible = false;
    }
    const w = def.x[1] - def.x[0];
    const h = ROMAN_TOP - ROMAN_BOTTOM;
    const geo = new THREE.PlaneGeometry(w, h);
    geo.translate(0, -h / 2, 0); // верхний край в нуле
    const mat = new THREE.MeshStandardMaterial({
      color: def.color, roughness: 0.92, metalness: 0, side: THREE.DoubleSide,
      map: ROMAN_TEX.clone(), transparent: false,
    });
    mat.name = 'Apt_roman_blind';
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set((def.x[0] + def.x[1]) / 2, ROMAN_TOP, def.z ?? ROMAN_Z);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    scene.add(mesh);

    const entry = {
      kind: 'roman', entity: def.entity, obj: mesh,
      closed: 0, target: 0, w, h,
      minScale: def.min ?? 0.08, maxScale: def.max ?? 0.96,
    };
    mesh.scale.y = entry.minScale;
    curtains.push(entry);
    curtainTargets.push(mesh);
    mesh.userData.curtain = entry;
    console.log('[curtain] roman', def.entity, 'x', def.x.join('..'));
  }
}

function toggleCurtain(entry) {
  if (!entry) return false;
  entry.target = entry.closed > 0.5 ? 0 : 1;
  console.log('[curtain]', entry.entity, entry.target ? 'CLOSE' : 'OPEN');
  return true;
}

function curtainAt(object) {
  let o = object;
  while (o) {
    if (o.userData && o.userData.curtain) return o.userData.curtain;
    o = o.parent;
  }
  return null;
}

function updateCurtains(dt) {
  for (const c of curtains) {
    const d = c.target - c.closed;
    if (Math.abs(d) < 0.002) {
      c.closed = c.target;
    } else {
      c.closed += d * (1 - Math.exp(-dt * 3.2));
    }
    if (c.kind === 'slide') {
      // closed = 1 — полотно во всю ширину (как в модели), 0 — собрано к краю
      const k = 0.18 + 0.82 * c.closed;
      if (c.axis === 'x') c.pivot.scale.x = k;
      else c.pivot.scale.z = k;
    } else {
      const min = c.minScale ?? 0.08;
      const max = c.maxScale ?? 0.96;
      c.obj.scale.y = min + (max - min) * c.closed;
    }
  }
}

/* ------------------------------------------------------------------ *
 *  Double click a room: isolate it, double click again to come back
 * ------------------------------------------------------------------ */
// со стороны гостиной, 56° к горизонту, кадр плотный
const DEFAULT_VIEW = { pos: [1.8, 19.4, -11.9], target: [-0.26, 0.78, 0.55] };

const ROOMS = {
  kids: {
    label: 'детская',
    x: [-2.95, 1.15], z: [-2.98, 0.84], y: [-0.05, 3.0],
    view: { pos: [-11.22, 6.69, 1.4], target: [-0.9, 1.15, -1.13] },
  },
  living: {
    label: 'гостиная',
    x: [1.27, 7.28], z: [-2.98, 0.72], y: [-0.05, 3.0],
    view: { pos: [-6.1, 5.75, 4.29], target: [4.28, 1.15, -1.24] },
  },
  bedroom: {
    label: 'спальня',
    x: [2.49, 7.28], z: [0.90, 4.53], y: [-0.05, 3.0],
    view: { pos: [-2.95, 6.39, -4.5], target: [4.83, 1.15, 2.62] },
  },
  kitchen: {
    label: 'кухня',
    x: [-7.15, -3.19], z: [-2.98, 0.19], y: [-0.05, 3.0],
    view: { pos: [3.94, 4.9, 2.29], target: [-5.28, 1.35, -1.45] },
  },
  bath: {
    label: 'ванная',
    x: [-7.13, -4.47], z: [0.86, 2.84], y: [-0.05, 3.0],
    view: { pos: [0.87, 7.03, 0.92], target: [-5.94, 1.33, 1.83] },
  },
  wc: {
    label: 'санузел',
    x: [-0.90, 0.20], z: [2.08, 3.83], y: [-0.05, 3.0],
    view: { pos: [2.36, 2.84, -0.82], target: [-0.47, 0.67, 2.67] },
  },
  hall: {
    label: 'прихожая',
    x: [-3.08, -1.03], z: [2.08, 4.50], y: [-0.05, 3.0],
    view: { pos: [1.16, 3.71, 10.78], target: [-2.08, 1.42, 3.23] },
  },
  balcony: {
    label: 'балкон',
    x: [-6.60, -3.35], z: [-4.50, -3.40], y: [-0.05, 3.0],
    view: { pos: [-1.62, 3.68, -11.67], target: [-4.94, 1.62, -3.86] },
  },
};

let isolatedRoom = null;
let savedView = null;

function roomUnder(point) {
  for (const [id, r] of Object.entries(ROOMS)) {
    if (point.x >= r.x[0] - 0.08 && point.x <= r.x[1] + 0.08 &&
        point.z >= r.z[0] - 0.08 && point.z <= r.z[1] + 0.08) return id;
  }
  return null;
}

function autoView(r) {
  const cx = (r.x[0] + r.x[1]) / 2;
  const cz = (r.z[0] + r.z[1]) / 2;
  const target = new THREE.Vector3(cx, 1.15, cz);
  const size = Math.max(r.x[1] - r.x[0], r.z[1] - r.z[0]);
  const vFov = THREE.MathUtils.degToRad(camera.fov);
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
  const dist = (size * 0.62) / Math.tan(Math.min(vFov, hFov) / 2) + 0.8;
  const dir = new THREE.Vector3(0.62, 0.7, 0.95).normalize();
  return { pos: target.clone().addScaledVector(dir, dist).toArray(), target: target.toArray() };
}

function isolateRoom(id) {
  const r = ROOMS[id];
  const v = r.view || autoView(r);
  const cam = new THREE.Vector3().fromArray(v.pos);
  const tgt = new THREE.Vector3().fromArray(v.target);
  const dx = tgt.x - cam.x;
  const dz = tgt.z - cam.z;
  const e = 0.24;  // дальнюю стену держим целиком
  const cut = 0.02; // ближнюю срезаем на 2 см внутрь: иначе её грань остаётся

  const planes = [];
  const keep = (nx, nz, c) => planes.push(new THREE.Plane(new THREE.Vector3(nx, 0, nz), c));

  // ближнюю к камере стену срезаем, дальнюю оставляем
  if (dx > 0.35) {
    keep(1, 0, -(r.x[0] + cut));
    keep(-1, 0, r.x[1] + e);
  } else if (dx < -0.35) {
    keep(-1, 0, r.x[1] - cut);
    keep(1, 0, -(r.x[0] - e));
  } else {
    keep(1, 0, -(r.x[0] - e));
    keep(-1, 0, r.x[1] + e);
  }

  if (dz > 0.35) {
    keep(0, 1, -(r.z[0] + cut));
    keep(0, -1, r.z[1] + e);
  } else if (dz < -0.35) {
    keep(0, -1, r.z[1] - cut);
    keep(0, 1, -(r.z[0] - e));
  } else {
    keep(0, 1, -(r.z[0] - e));
    keep(0, -1, r.z[1] + e);
  }

  planes.push(new THREE.Plane(new THREE.Vector3(0, 1, 0), -r.y[0]));
  planes.push(new THREE.Plane(new THREE.Vector3(0, -1, 0), r.y[1]));

  renderer.clippingPlanes = planes;
  isolatedRoom = id;

  if (viewMode === 'top') goTopCurrent();
  else flyToArc(cam, tgt, 1100);
  updateRoomChrome();
  console.log('[room] isolate', id, 'view', v.pos.join(', '), '->', v.target.join(', '));
}

function logCamera() {
  const p = camera.position;
  const t = controls.target;
  const f = (v) => +v.toFixed(2);
  console.log('[camera]', 'pos', f(p.x), f(p.y), f(p.z),
    'target', f(t.x), f(t.y), f(t.z),
    'room', isolatedRoom || '-');
  showHint('Вид: pos ' + f(p.x) + ', ' + f(p.y) + ', ' + f(p.z) +
    ' / target ' + f(t.x) + ', ' + f(t.y) + ', ' + f(t.z));
  return { pos: [f(p.x), f(p.y), f(p.z)], target: [f(t.x), f(t.y), f(t.z)], room: isolatedRoom };
}

function goHome() {
  renderer.clippingPlanes = [];
  isolatedRoom = null;
  savedView = null;
  viewMode = 'iso';
  viewSaved = null;
  updateViewButton();
  updateRoomChrome();
  flyToArc(new THREE.Vector3().fromArray(DEFAULT_VIEW.pos), new THREE.Vector3().fromArray(DEFAULT_VIEW.target), 950);
  console.log('[camera] home');
}

function restoreView() {
  renderer.clippingPlanes = [];
  isolatedRoom = null;
  closeSheet();
  updateRoomChrome();
  if (savedView) {
    flyToArc(savedView.pos, savedView.target, 1000);
    savedView = null;
  }
  console.log('[room] restore');
}

function toggleRoomAt(clientX, clientY) {
  // пока комната изолирована, любой двойной клик возвращает общий вид:
  // обрезанная геометрия соседних комнат всё ещё ловит лучи
  if (isolatedRoom) {
    restoreView();
    return;
  }
  const hit = pickAt(clientX, clientY);
  if (!hit) return;
  const id = roomUnder(hit.point);
  if (!id) return;
  if (!isolatedRoom) {
    savedView = { pos: camera.position.clone(), target: controls.target.clone() };
  }
  isolateRoom(id);
}

/* ------------------------------------------------------------------ *
 *  UI
 * ------------------------------------------------------------------ */
function flyToArc(position, target, duration = 1100) {
  const fromTarget = controls.target.clone();
  const s0 = new THREE.Spherical().setFromVector3(camera.position.clone().sub(fromTarget));
  const s1 = new THREE.Spherical().setFromVector3(position.clone().sub(target));
  let dTheta = s1.theta - s0.theta;
  while (dTheta > Math.PI) dTheta -= Math.PI * 2;
  while (dTheta < -Math.PI) dTheta += Math.PI * 2;
  activeTween = {
    fromPos: camera.position.clone(),
    toPos: position.clone(),
    fromTarget,
    toTarget: target.clone(),
    start: performance.now(),
    duration,
    arc: {
      r0: s0.radius, r1: s1.radius,
      phi0: s0.phi, phi1: s1.phi,
      th0: s0.theta, th1: s0.theta + dTheta,
    },
  };
}

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

let viewMode = 'iso';
let viewSaved = null;

// кадр для вида сверху: комната, если она изолирована, иначе вся квартира
function topFrame() {
  if (isolatedRoom) {
    const r = ROOMS[isolatedRoom];
    const cx = (r.x[0] + r.x[1]) / 2;
    const cz = (r.z[0] + r.z[1]) / 2;
    return { target: new THREE.Vector3(cx, 0.5, cz), size: Math.max(r.x[1] - r.x[0], r.z[1] - r.z[0]) };
  }
  return { target: new THREE.Vector3(0, 0.4, 0), size: Math.max(modelSize.x, modelSize.z) };
}

function goTopCurrent() {
  const { target, size } = topFrame();
  const vFov = THREE.MathUtils.degToRad(camera.fov);
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
  const d = (size * 0.6) / Math.tan(Math.min(vFov, hFov) / 2) + 1.4;
  // строго сверху и без закрутки: крошечный сдвиг по +z только задаёт «верх» кадра
  flyTo(new THREE.Vector3(target.x, target.y + d, target.z + d * 0.008), target, 850);
}

function updateViewButton() {
  const b = document.getElementById('btn-view');
  if (!b) return;
  setIcon(b, viewMode === 'top' ? 'top' : 'iso');
  b.title = viewMode === 'top'
    ? 'Вид сверху — нажмите, чтобы вернуть камеру'
    : 'Изометрия — нажмите для вида сверху';
  b.classList.toggle('active', viewMode === 'top');
}

function toggleView() {
  if (viewMode === 'iso') {
    viewSaved = { pos: camera.position.clone(), target: controls.target.clone() };
    goTopCurrent();
    viewMode = 'top';
  } else {
    if (viewSaved) flyToArc(viewSaved.pos, viewSaved.target, 850);
    else goIso();
    viewMode = 'iso';
    viewSaved = null;
  }
  updateViewButton();
}

function goTop() {
  const vFov = THREE.MathUtils.degToRad(camera.fov);
  const distH = modelSize.z / (2 * Math.tan(vFov / 2));
  const distW = modelSize.x / (2 * Math.tan(vFov / 2) * camera.aspect);
  const d = Math.max(distH, distW) * 1.45;
  flyTo(new THREE.Vector3(0, d, 0.01), new THREE.Vector3(0, 0, 0));
}


/* ------------------------------------------------------------------ *
 *  Плашки, свет по комнате, выносные иконки и карточки устройств
 * ------------------------------------------------------------------ */
const ROOM_TEMP = {
  living: 23.4, kids: 22.6, bedroom: 22.9, kitchen: 23.8,
  bath: 24.6, wc: 24.1, hall: 23.0, balcony: 11.8,
};

const ROOM_ICON = {
  living: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 13v-2.6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2V13"/><path d="M2.6 13h18.8v4.4H2.6z"/><path d="M6 8.4V6.2h12v2.2"/></svg>',
  kids: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2.6 18.6v-5.2h18.8v5.2"/><path d="M2.6 13.4V7.4h8.2v6"/><path d="M12.8 13.4V8.6h5.4a3.2 3.2 0 0 1 3.2 3.2v1.6"/></svg>',
  bedroom: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18V9.2a1.6 1.6 0 0 1 1.6-1.6H13v6.6"/><path d="M13 14.2h8V18"/><path d="M2.4 18h19.2"/><circle cx="16.6" cy="11.8" r="1.6"/></svg>',
  kitchen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4.4 10.4h15.2v4.4a4.4 4.4 0 0 1-4.4 4.4H8.8a4.4 4.4 0 0 1-4.4-4.4Z"/><path d="M8.2 7.2V10M12 5.6V10M15.8 7.2V10"/></svg>',
  bath: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12.4h18v2.8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z"/><path d="M6.4 12.4V6.6a2.2 2.2 0 0 1 4.4 0"/><path d="M6 19.2V21M18 19.2V21"/></svg>',
  wc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6.6 3.8h7v7.4h-7z"/><path d="M6.6 11.2h8.6a5.4 5.4 0 0 1-4.4 5.4H9.2"/><path d="M10.4 16.6V21"/></svg>',
  hall: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h9.6v18H6Z"/><circle cx="13" cy="12" r="1"/></svg>',
  balcony: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6"/></svg>',
};

// какие группы света есть у комнаты
const ROOM_LIGHT_KEYS = {
  living: { track: 'living', led: 'living' },
  kids: { track: 'kids', led: 'kids' },
  kitchen: { track: 'kitchen', led: 'kitchen' },
  bedroom: { led: 'hall' },
  hall: { track: 'corridor' },
  bath: { track: 'bath', led: 'bath' },
  wc: { track: 'wc', led: 'wc' },
  balcony: { track: 'balcony' },
};

const AC_INFO = {
  'climate.konder_gostinaia_air_conditioner': { room: 'living', current: 26.5 },
  'climate.konder_spalnia_air_conditioner': { room: 'bedroom', current: 26.5 },
  'climate.air_conditioner_as20hpl1hra': { room: 'kitchen', current: 24.0 },
};

const ICON = {
  ac: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="2.6" y="5" width="18.8" height="7.4" rx="2"/><path d="M5.6 9.2h12.8"/><path d="M7 15.6c0 1.8 1.4 3.2 3.2 3.2M13.8 15.6c0 1.8 1.4 3.2 3.2 3.2"/></svg>',
  curtain: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 3.4h16"/><path d="M6.6 3.4c0 6-2.2 8.4-2.2 17.2M17.4 3.4c0 6 2.2 8.4 2.2 17.2"/><path d="M12 3.4v17.2"/></svg>',
  tv: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="2.6" y="4.4" width="18.8" height="12.2" rx="2"/><path d="M8.6 20.4h6.8"/><path d="M12 16.6v3.8"/></svg>',
  floor: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6.4h18"/><path d="M3 12h18"/><path d="M3 17.6h18"/><path d="M7.5 6.4v5.6M16.5 12v5.6"/></svg>',
  radiator: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3.4" y="6" width="17.2" height="12" rx="2"/><path d="M8 6v12M12 6v12M16 6v12"/></svg>',
};

const RADIATORS = {
  'climate.thermostat_hall_1': { room: 'living', anchor: [2.75, 0.43, -2.86], current: 23.0 },
  'climate.thermostat_hall_2': { room: 'living', anchor: [6.00, 1.54, 0.45], current: 23.2 },
  'climate.thermostat_bedroom': { room: 'bedroom', anchor: [5.52, 0.55, 2.61], current: 22.5 },
  'climate.thermostat_nursery': { room: 'kids', anchor: [-1.06, 0.45, -2.84], current: 22.4 },
  'climate.thermostat_kitchen': { room: 'kitchen', anchor: [-4.27, 1.95, -2.89], current: 23.6 },
};

const radiatorDevices = new Map();

function radiatorDevice(entity) {
  let d = radiatorDevices.get(entity);
  if (!d) {
    const info = RADIATORS[entity] || { anchor: [0, 1.5, 0] };
    d = {
      kind: 'radiator', entity, mesh: null, overlay: null, mat: null, on: false,
      anchor: new THREE.Vector3().fromArray(info.anchor),
    };
    radiatorDevices.set(entity, d);
  }
  return d;
}

const ROOM_CALLOUTS = {
  living: [
    { type: 'ac', entity: 'climate.konder_gostinaia_air_conditioner' },
    { type: 'radiator', entity: 'climate.thermostat_hall_1' },
    { type: 'radiator', entity: 'climate.thermostat_hall_2' },
    { type: 'tv', mesh: 'Sony_KD-065' },
    { type: 'curtain', entity: 'cover.curtain_driver2_hall' },
    { type: 'curtain', entity: 'cover.curtain_motor_hall' },
  ],
  bedroom: [
    { type: 'ac', entity: 'climate.konder_spalnia_air_conditioner' },
    { type: 'radiator', entity: 'climate.thermostat_bedroom' },
    { type: 'curtain', entity: 'cover.curtain_driver_bedroom' },
  ],
  kitchen: [
    { type: 'ac', entity: 'climate.air_conditioner_as20hpl1hra' },
    { type: 'radiator', entity: 'climate.thermostat_kitchen' },
    { type: 'tv', mesh: 'Sony_KD-055' },
  ],
  bath: [
    { type: 'floor', entity: 'switch.underfloor_heating_bathroom' },
  ],
  kids: [
    { type: 'radiator', entity: 'climate.thermostat_nursery' },
    { type: 'curtain', entity: 'cover.curtain_driver_left' },
    { type: 'curtain', entity: 'cover.curtain_driver_right' },
  ],
};

let calloutItems = [];
let underfloor = null;
let underfloorOn = false;

/* --- свет по комнате и «выключить всё» --- */
function roomLightKey(room, kind) {
  const m = ROOM_LIGHT_KEYS[room];
  return m ? m[kind] : null;
}

function toggleRoomLight(kind) {
  if (!isolatedRoom) return;
  const key = roomLightKey(isolatedRoom, kind);
  if (!key) return;
  const stateKey = kind + key[0].toUpperCase() + key.slice(1);
  const on = !lightState[stateKey];
  setLight(kind, key, on);
  // управление реальным реле, если страница подключена к Home Assistant
  const entity = haEntity(kind, key);
  if (entity && window.__ha && window.__ha.connected) window.__ha.toggle(entity, on);
  updateRoomButtons();
}

function updateRoomButtons() {
  if (!isolatedRoom) return;
  const btnT = document.getElementById('btn-room-track');
  const btnL = document.getElementById('btn-room-led');
  const kt = roomLightKey(isolatedRoom, 'track');
  const kl = roomLightKey(isolatedRoom, 'led');
  if (btnT) {
    btnT.hidden = !kt;
    if (kt) btnT.classList.toggle('active', !!lightState['track' + kt[0].toUpperCase() + kt.slice(1)]);
  }
  if (btnL) {
    btnL.hidden = !kl;
    if (kl) btnL.classList.toggle('active', !!lightState['led' + kl[0].toUpperCase() + kl.slice(1)]);
  }
}

const HA_ALL_OFF_SCRIPT = 'script.turn_off_apartment_lights';

function allLightsOff() {
  if (window.__ha && window.__ha.connected) window.__ha.runScript(HA_ALL_OFF_SCRIPT);
  for (const kind of ['led', 'track']) {
    for (const room of ['living', 'kids', 'kitchen', 'hall', 'bath', 'wc', 'corridor', 'balcony']) {
      const stateKey = kind + room[0].toUpperCase() + room.slice(1);
      if (lightState[stateKey]) setLight(kind, room, false);
    }
  }
  updateRoomChrome();
}

/* --- карточка температуры --- */
function averageTemp() {
  const v = Object.values(ROOM_TEMP);
  return v.reduce((a, b) => a + b, 0) / v.length;
}

let apartmentAverageOverride = null;

function apartmentAverage() {
  if (apartmentAverageOverride !== null) return apartmentAverageOverride;
  return averageTemp();
}

function updateClimateCard() {
  const card = document.getElementById('climate-card');
  const temp = document.getElementById('climate-temp');
  const state = document.getElementById('climate-state');
  const icon = document.getElementById('climate-icon');
  if (!card) return;
  if (isolatedRoom) {
    const r = ROOMS[isolatedRoom];
    const t = ROOM_TEMP[isolatedRoom] ?? averageTemp();
    temp.textContent = t.toFixed(1).replace('.', ',') + '°';
    state.textContent = r.label;
    if (icon && ROOM_ICON[isolatedRoom]) icon.innerHTML = ROOM_ICON[isolatedRoom];
  } else {
    const t = apartmentAverage();
    temp.textContent = Math.round(t) + '°';
    state.textContent = 'в квартире';
    if (icon) icon.innerHTML = '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M24 12a4 4 0 0 1 4 4v13a6 6 0 1 1-8 0V16a4 4 0 0 1 4-4Z"/><path d="M24 22v9"/></svg>';
  }
}

/* --- верхние кнопки комнаты --- */
function updateRoomChrome() {
  const topLeft = document.querySelector('.top-left');
  const actions = document.getElementById('room-actions');
  const zoomed = !!isolatedRoom;
  const allOff = document.getElementById('btn-all-off');

  if (topLeft) topLeft.classList.toggle('zoomed', zoomed);
  // на общем виде — ровно одна кнопка «выключить весь свет»
  if (actions) {
    actions.hidden = !zoomed;
    if (!zoomed) {
      actions.querySelectorAll('button').forEach((b) => { b.hidden = true; });
    }
  }
  if (allOff) allOff.hidden = zoomed;

  const btnT = document.getElementById('btn-room-track');
  const btnL = document.getElementById('btn-room-led');
  if (zoomed) {
    const kt = roomLightKey(isolatedRoom, 'track');
    const kl = roomLightKey(isolatedRoom, 'led');
    if (btnT) {
      btnT.hidden = !kt;
      if (kt) btnT.classList.toggle('active', !!lightState['track' + kt[0].toUpperCase() + kt.slice(1)]);
    }
    if (btnL) {
      btnL.hidden = !kl;
      if (kl) btnL.classList.toggle('active', !!lightState['led' + kl[0].toUpperCase() + kl.slice(1)]);
    }
  }

  buildCallouts();
  updateClimateCard();
  updateRoomButtons();
}

/* --- карточка устройства --- */
let selectionEnabled = false;
let chromeIsolated = null;
let sheetOpenFor = null;
const DEVICE_STATE = new Map();

function deviceState(dev) {
  let st = DEVICE_STATE.get(dev);
  if (!st) {
    st = { on: !!dev.on, target: 24.5 };
    DEVICE_STATE.set(dev, st);
  }
  return st;
}

function setDeviceOn(dev, on) {
  const st = deviceState(dev);
  st.on = on;
  dev.on = on;
  if (dev.overlay) dev.overlay.visible = on;
  if (dev.mat && dev.kind === 'tv') dev.mat.opacity = on ? 0.95 : 0;
  console.log('[device]', dev.entity || dev.mesh.name, on ? 'ON' : 'OFF');
  renderSheet();
  refreshCalloutStates();
}

function stepTarget(delta) {
  if (!sheetOpenFor) return;
  const st = deviceState(sheetOpenFor);
  st.target = Math.max(16, Math.min(30, Math.round((st.target + delta) * 2) / 2));
  renderSheet();
}

function openDeviceSheet(dev) {
  sheetOpenFor = dev;
  const sheet = document.getElementById('device-sheet');
  if (sheet) sheet.hidden = false;
  renderSheet();
  positionSheet();
  refreshCalloutStates();
}

// карточка встаёт рядом с кондиционером
function positionSheet() {
  const sheet = document.getElementById('device-sheet');
  if (!sheet || !sheetOpenFor) return;
  const item = calloutItems.find((c) => c.dev === sheetOpenFor);
  if (!item) return;
  const rect = renderer.domElement.getBoundingClientRect();
  const p = item.anchor.clone().project(camera);
  const x = (p.x * 0.5 + 0.5) * rect.width;
  const y = (-p.y * 0.5 + 0.5) * rect.height;
  const w = sheet.offsetWidth || 300;
  const h = sheet.offsetHeight || 150;
  const left = Math.min(rect.width - w - 18, Math.max(18, x - w / 2));
  const top = Math.min(rect.height - h - 18, Math.max(18, y - h - 70));
  sheet.style.left = left + 'px';
  sheet.style.top = top + 'px';
  sheet.style.right = 'auto';
}

function closeSheet() {
  sheetOpenFor = null;
  const sheet = document.getElementById('device-sheet');
  if (sheet) sheet.hidden = true;
  refreshCalloutStates();
}

function renderSheet() {
  if (!sheetOpenFor) return;
  const dev = sheetOpenFor;
  const st = deviceState(dev);
  const info = AC_INFO[dev.entity] || null;
  const title = document.getElementById('sheet-title');
  const icon = document.getElementById('sheet-icon');
  const toggle = document.getElementById('sheet-toggle');
  const target = document.getElementById('sheet-target');
  const current = document.getElementById('sheet-current');

  const isRad = dev.kind === 'radiator';
  if (title) title.textContent = isRad ? 'Батарея' : 'Кондиционер';
  if (icon) icon.innerHTML = isRad ? ICON.radiator : ICON.ac;
  if (toggle) toggle.setAttribute('aria-checked', String(!!st.on));
  if (target) target.textContent = st.target.toFixed(1).replace('.', ',') + '°';
  if (current) {
    if (isRad) {
      const rinfo = RADIATORS[dev.entity] || {};
      const room = rinfo.room ? ROOMS[rinfo.room]?.label : '';
      const cur = rinfo.current ?? 22;
      current.textContent = (room ? room + ' ' : '') + cur.toFixed(1).replace('.', ',') + '°';
    } else {
      const room = info ? ROOMS[info.room]?.label : '';
      const cur = info ? info.current : ROOM_TEMP[isolatedRoom] ?? 24;
      current.textContent = (room ? room + ' ' : '') + cur.toFixed(1).replace('.', ',') + '°';
    }
  }
}

/* --- выносные иконки --- */
function calloutAnchor(type, ref) {
  if (type === 'ac') {
    const dev = devices.find((d) => d.entity === ref);
    if (!dev) return null;
    const b = new THREE.Box3().setFromObject(dev.mesh);
    const c = b.getCenter(new THREE.Vector3());
    return new THREE.Vector3(c.x, b.max.y + 0.25, c.z);
  }
  if (type === 'tv') {
    const mesh = apartment.getObjectByName(ref);
    if (!mesh) return null;
    const b = new THREE.Box3().setFromObject(mesh);
    const c = b.getCenter(new THREE.Vector3());
    return new THREE.Vector3(c.x, b.max.y + 0.2, c.z);
  }
  if (type === 'curtain') {
    const c = curtains.find((x) => x.entity === ref);
    if (!c) return null;
    const b = new THREE.Box3().setFromObject(c.obj);
    const p = b.getCenter(new THREE.Vector3());
    return new THREE.Vector3(p.x, b.max.y - 0.18, p.z);
  }
  if (type === 'radiator') {
    return radiatorDevice(ref).anchor.clone();
  }
  if (type === 'floor') {
    const r = ROOMS.bath;
    if (!r) return null;
    return new THREE.Vector3((r.x[0] + r.x[1]) / 2, 0.9, (r.z[0] + r.z[1]) / 2);
  }
  return null;
}

function calloutState(item) {
  if (item.type === 'curtain') {
    const c = curtains.find((x) => x.entity === item.entity);
    return { on: c ? c.closed > 0.5 : false, label: c && c.closed > 0.5 ? 'закрыта' : 'открыта' };
  }
  if (item.type === 'floor') {
    return { on: underfloorOn, label: underfloorOn ? 'греет' : 'выкл' };
  }
  if (item.type === 'ac') {
    const dev = devices.find((d) => d.entity === item.entity);
    if (!dev) return { on: false, label: '—' };
    const st = deviceState(dev);
    return { on: st.on, label: st.on ? 'охлаждает' : 'выкл' };
  }
  if (item.type === 'radiator') {
    const dev = radiatorDevice(item.entity);
    const st = deviceState(dev);
    return { on: st.on, label: st.on ? 'греет' : 'выкл' };
  }
  if (item.type === 'tv') {
    const dev = devices.find((d) => d.mesh.name === item.mesh);
    if (!dev) return { on: false, label: '—' };
    return { on: !!dev.on, label: dev.on ? 'вкл' : 'выкл' };
  }
  return { on: false, label: '' };
}

function buildCallouts() {
  const host = document.getElementById('callouts');
  if (!host) return;
  host.innerHTML = '';
  calloutItems = [];
  if (!isolatedRoom) return;
  const list = ROOM_CALLOUTS[isolatedRoom] || [];
  for (const item of list) {
    const anchor = calloutAnchor(item.type, item.entity || item.mesh);
    if (!anchor) continue;
    const st = calloutState(item);
    const el = document.createElement('button');
    el.className = 'callout' + (st.on ? ' on' : '');
    el.title = st.label;
    el.innerHTML = (ICON[item.type] || '') + '<i class="dot"></i>';
    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (item.type === 'curtain') {
        const c = curtains.find((x) => x.entity === item.entity);
        if (c) { toggleCurtain(c); refreshCalloutStates(); }
      } else if (item.type === 'floor') {
        underfloorOn = !underfloorOn;
        if (underfloor) underfloor.visible = underfloorOn;
        console.log('[floor] underfloor_heating_bathroom', underfloorOn ? 'ON' : 'OFF');
        refreshCalloutStates();
      } else if (item.type === 'ac') {
        const dev = devices.find((d) => d.entity === item.entity);
        if (dev) openDeviceSheet(dev);
      } else if (item.type === 'radiator') {
        openDeviceSheet(radiatorDevice(item.entity));
      } else if (item.type === 'tv') {
        const dev = devices.find((d) => d.mesh.name === item.mesh);
        if (dev) setDeviceOn(dev, !dev.on);
      }
      updateCalloutPositions();
    });
    host.appendChild(el);
    calloutItems.push({
      anchor, el, item,
      dev: item.type === 'radiator' ? radiatorDevice(item.entity)
        : (item.type === 'ac' || item.type === 'tv'
          ? devices.find((d) => (item.entity ? d.entity === item.entity : d.mesh.name === item.mesh))
          : null),
      label: item.type + ':' + (item.entity || item.mesh),
    });
  }
  updateCalloutPositions();
}

// только статус, без пересборки и сдвига
function refreshCalloutStates() {
  for (const c of calloutItems) {
    const st = calloutState(c.item);
    c.el.classList.toggle('on', st.on);
    c.el.title = st.label;
    c.el.style.opacity = (sheetOpenFor && c.dev === sheetOpenFor) ? '0' : '';
  }
}

function updateCalloutPositions() {
  if (!calloutItems.length) return;
  const rect = renderer.domElement.getBoundingClientRect();
  for (const c of calloutItems) {
    const p = c.anchor.clone().project(camera);
    if (p.z > 1) { c.el.style.display = 'none'; continue; }
    c.el.style.display = '';
    c.el.style.left = ((p.x * 0.5 + 0.5) * rect.width) + 'px';
    c.el.style.top = ((-p.y * 0.5 + 0.5) * rect.height - 10) + 'px';
  }
}

/* --- тёплый пол в ванной: красная змейка --- */
function setupUnderfloor() {
  const r = ROOMS.bath;
  if (!r) return;
  const pts = [];
  let x0 = r.x[0] + 0.25;
  let x1 = r.x[1] - 0.25;
  const z0 = r.z[0] + 0.2;
  const z1 = r.z[1] - 0.2;
  const rows = 6;
  for (let i = 0; i < rows; i++) {
    const z = z0 + ((z1 - z0) * i) / (rows - 1);
    if (i % 2 === 0) pts.push(new THREE.Vector3(x0, 0.028, z), new THREE.Vector3(x1, 0.028, z));
    else pts.push(new THREE.Vector3(x1, 0.028, z), new THREE.Vector3(x0, 0.028, z));
  }
  const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.06);
  const geo = new THREE.TubeGeometry(curve, 300, 0.016, 6, false);

  // бегущие полосы вдоль змейки
  const c = document.createElement('canvas');
  c.width = 16; c.height = 128;
  const g2 = c.getContext('2d');
  g2.fillStyle = 'rgba(255,80,60,0.35)';
  g2.fillRect(0, 0, 16, 128);
  const grad = g2.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, 'rgba(255,150,120,0)');
  grad.addColorStop(0.45, 'rgba(255,190,160,0.85)');
  grad.addColorStop(1, 'rgba(255,150,120,0)');
  g2.fillStyle = grad;
  g2.fillRect(0, 0, 16, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.repeat.set(1, 26);

  const mat = new THREE.MeshBasicMaterial({
    color: 0xff5a45, map: tex, transparent: true, opacity: 0.4,
    depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending,
  });
  mat.name = 'Apt_underfloor';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.visible = false;
  mesh.raycast = () => {};
  scene.add(mesh);
  underfloor = mesh;
  console.log('[floor] snake ready');
}

// стартовый вид как в архитектурном рендере: вечер, весь тёплый свет включён
function startEvening() {
  applyLighting('evening');
  for (const room of Object.keys(LED_RUNS)) setLight('led', room, true);
  for (const room of Object.keys(trackFixtures)) setLight('track', room, true);
}


/* ------------------------------------------------------------------ *
 *  Пылесос Roborock S7 — простая модель в центре гостиной
 *  (позже будем двигать по реальным координатам из Home Assistant)
 * ------------------------------------------------------------------ */
let vacuum = null;
let vacuumLed = null;
const VACUUM_HOME = { x: 4.28, z: -1.13 };

function buildVacuum() {
  const g = new THREE.Group();
  g.name = 'RoborockS7';
  g.position.set(VACUUM_HOME.x, 0, VACUUM_HOME.z);

  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xf1f1ee, roughness: 0.42, metalness: 0.06 });
  bodyMat.name = 'Apt_vacuum_body';
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xd4d5d2, roughness: 0.35, metalness: 0.25 });
  rimMat.name = 'Apt_vacuum_rim';

  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.175, 0.172, 0.082, 40), bodyMat);
  body.position.y = 0.041;
  body.castShadow = false;
  body.receiveShadow = true;
  g.add(body);

  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.173, 0.007, 8, 44), rimMat);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.078;
  g.add(rim);

  // лидарный «стакан»
  const lidarBase = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.058, 0.016, 28), rimMat);
  lidarBase.position.set(-0.055, 0.088, 0);
  g.add(lidarBase);
  const lidar = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.05, 0.018, 28), bodyMat);
  lidar.position.set(-0.055, 0.104, 0);
  g.add(lidar);

  // бампер спереди
  const bumper = new THREE.Mesh(new THREE.CylinderGeometry(0.177, 0.177, 0.03, 40, 1, true, -0.9, 1.8), rimMat);
  bumper.position.y = 0.032;
  g.add(bumper);

  // мигающая зелёная полоска
  const ledMat = new THREE.MeshBasicMaterial({
    color: 0x39e07a, transparent: true, opacity: 0.9, toneMapped: false,
  });
  ledMat.name = 'Apt_vacuum_led';
  const led = new THREE.Mesh(new THREE.TorusGeometry(0.1805, 0.005, 6, 64), ledMat);
  led.rotation.x = Math.PI / 2;
  led.position.y = 0.062;
  g.add(led);
  vacuumLed = ledMat;

  scene.add(g);
  vacuum = g;
  console.log('[vacuum] Roborock S7 at', g.position.x.toFixed(2), g.position.z.toFixed(2));
  return g;
}

function updateVacuum(t) {
  if (!vacuumLed) return;
  // мягкое мигание: 0.25 … 1.0
  vacuumLed.opacity = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(t * 3.4));
}

function initUI() {
  const btnWalls = document.getElementById('btn-walls');
  const btnRotate = document.getElementById('btn-rotate');
  const btnLight = document.getElementById('btn-light');
  const btnView = document.getElementById('btn-view');
  const btnHome = document.getElementById('btn-home');
  if (btnHome) btnHome.addEventListener('click', goHome);

  if (btnView) btnView.addEventListener('click', toggleView);
  updateViewButton();

  setIcon(btnWalls, 'walls');
  setIcon(btnRotate, 'rotate');
  btnWalls.title = 'Показать/скрыть стены';
  btnRotate.title = 'Автовращение';

  applyLighting(lightingMode);

  btnWalls.addEventListener('click', () => {
    const cutaway = wallTargetOpacity > 0.5;
    wallTargetOpacity = cutaway ? 0.14 : 1.0;
    btnWalls.classList.toggle('active', cutaway);
  });

  if (btnRotate) {
    btnRotate.addEventListener('click', () => {
      controls.autoRotate = !controls.autoRotate;
      btnRotate.classList.toggle('active', controls.autoRotate);
    });
  }

  if (btnLight) {
    btnLight.addEventListener('click', () => {
      const i = LIGHT_CYCLE.indexOf(lightingMode);
      applyLighting(LIGHT_CYCLE[(i + 1) % LIGHT_CYCLE.length]);
      btnLight.classList.toggle('active', lightingMode === 'day');
    });
  }

  // свет в изолированной комнате
  const btnAllOff = document.getElementById('btn-all-off');
  if (btnAllOff) btnAllOff.addEventListener('click', allLightsOff);

  const btnTrackRoom = document.getElementById('btn-room-track');
  const btnLedRoom = document.getElementById('btn-room-led');
  if (btnTrackRoom) btnTrackRoom.addEventListener('click', () => toggleRoomLight('track'));
  if (btnLedRoom) btnLedRoom.addEventListener('click', () => toggleRoomLight('led'));

  // карточка устройства
  const sheetToggle = document.getElementById('sheet-toggle');
  const sheetMinus = document.getElementById('sheet-minus');
  const sheetPlus = document.getElementById('sheet-plus');
  if (sheetToggle) sheetToggle.addEventListener('click', () => {
    if (!sheetOpenFor) return;
    setDeviceOn(sheetOpenFor, !deviceState(sheetOpenFor).on);
  });
  if (sheetMinus) sheetMinus.addEventListener('click', () => stepTarget(-0.5));
  if (sheetPlus) sheetPlus.addEventListener('click', () => stepTarget(0.5));

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (sheetOpenFor) closeSheet();
      else if (isolatedRoom) restoreView();
    }
    if (e.key === '1' && btnView) btnView.click();
    if (e.key === '3') btnWalls.click();
    if (e.key === '4' && btnRotate) btnRotate.click();
    if (e.key === '5' && btnLight) btnLight.click();
    if (e.key === 'c' || e.key === 'C' || e.key === 'с' || e.key === 'С') logCamera();
  });

  startEvening();

  setupSelection();
  updateClimateCard();
  updateRoomChrome();

  window.__viewer = {
    scene,
    camera,
    controls,
    goIso,
    goTop,
    goTopCurrent,
    toggleView,
    renderer,
    THREE,
    apartment,
    selection: null,
    selectById: (id) => selectMesh(apartment.getObjectByName(id)),
    selectAt: (x, y) => { const h = pickAt(x, y); selectMesh(h ? h.object : null, h ? h.point : null); },
    deselect,
    lamps: lampStates,
    toggleLamp,
    weather: setWeather,
    applyLighting,
    lighting: () => lightingMode,
    lightState,
    setLight,
    trackFixtures,
    moveFixture: (room, i, x, z) => {
      if (!pendingMove) startFixtureMove(room, i);
      return moveFixtureTo({ x, z });
    },
    ceiling: () => scene.getObjectByName('CeilingShadow'),
    isolateRoom,
    restoreView,
    goHome,
    isolated: () => isolatedRoom,
    logCamera,
    devices,
    toggleDevice,
    ha: { lights: HA_LIGHTS, devices: HA_DEVICES, info: HA_INFO },
    curtains,
    toggleCurtain,
    vacuum: () => vacuum,
    setVacuumPosition: (x, z) => {
      if (!vacuum) return null;
      vacuum.position.x = x;
      vacuum.position.z = z;
      console.log('[vacuum] position', +x.toFixed(2), +z.toFixed(2));
      return [x, z];
    },
    setVacuumVisible: (on) => {
      if (vacuum) vacuum.visible = !!on;
      return !!on;
    },
    vacuumToRoom: (roomId) => {
      if (!vacuum) return null;
      const r = ROOMS[roomId];
      if (!r) return null;
      const x = (r.x[0] + r.x[1]) / 2;
      const z = (r.z[0] + r.z[1]) / 2;
      vacuum.position.set(x, 0, z);
      return [x, z];
    },
    setVacuumActive: (on) => {
      if (vacuumLed) vacuumLed.opacity = on ? 0.9 : 0.15;
      vacuum.visible = on !== false;
      return on;
    },
    roomTemps: ROOM_TEMP,
    setApartmentAverage: (v) => {
      apartmentAverageOverride = (v === null || v === undefined) ? null : Number(v);
      updateClimateCard();
    },
    setRoomTemp: (room, v) => { ROOM_TEMP[room] = v; updateClimateCard(); },
    callouts: () => calloutItems.map((c) => c.label),
    enableSelection: (v) => { selectionEnabled = !!v; console.log('[select] mode', selectionEnabled ? 'on' : 'off'); return selectionEnabled; },
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
function easeInOut(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function render() {
  requestAnimationFrame(render);
  const nowMs = performance.now();
  const dtSec = Math.min(0.1, (nowMs - (deviceClock || nowMs)) / 1000);
  updateDevices(dtSec, nowMs / 1000);
  updateCurtains(dtSec);
  updateCalloutPositions();
  if (underfloor && underfloor.visible && underfloor.material.map) {
    underfloor.material.map.offset.y = (nowMs / 1400) % 1;
  }
  if (sheetOpenFor) positionSheet();
  updateVacuum(nowMs / 1000);
  if (chromeIsolated !== isolatedRoom) {
    chromeIsolated = isolatedRoom;
    updateRoomChrome();
  }
  deviceClock = nowMs;

  if (activeTween) {
    const t = Math.min(1, (performance.now() - activeTween.start) / activeTween.duration);
    const k = easeInOut(t);
    controls.target.lerpVectors(activeTween.fromTarget, activeTween.toTarget, k);
    if (activeTween.arc) {
      const a = activeTween.arc;
      const sph = new THREE.Spherical(
        a.r0 + (a.r1 - a.r0) * k,
        a.phi0 + (a.phi1 - a.phi0) * k,
        a.th0 + (a.th1 - a.th0) * k
      );
      camera.position.setFromSpherical(sph).add(controls.target);
    } else {
      camera.position.lerpVectors(activeTween.fromPos, activeTween.toPos, k);
    }
    if (t >= 1) activeTween = null;
  }

  if (wallMaterials.length) {
    const k = Math.min(1, dtSec * 9);
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
