import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/* ------------------------------------------------------------------ *
 *  Renderer / scene
 * ------------------------------------------------------------------ */
const app = document.getElementById('app');

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  alpha: true,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 0.92;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);

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
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.06).texture;
scene.environmentIntensity = 0.38;

scene.add(new THREE.HemisphereLight(0xffffff, 0xb9c6d6, 0.8));

const key = new THREE.DirectionalLight(0xfff4e6, 1.95);
key.position.set(9, 17, 11);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
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

const fill = new THREE.DirectionalLight(0xdbe8ff, 0.55);
fill.position.set(-11, 9, -9);
scene.add(fill);

const rim = new THREE.DirectionalLight(0xffffff, 0.5);
rim.position.set(-4, 6, 13);
scene.add(rim);

/* ------------------------------------------------------------------ *
 *  Background (soft vertical gradient)
 * ------------------------------------------------------------------ */
function makeBackground() {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 512;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0.0, '#b9cde4');
  g.addColorStop(0.45, '#dbe7f4');
  g.addColorStop(1.0, '#f5f8fc');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 16, 512);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
scene.background = makeBackground();

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

  const res = 512;
  const wasVisible = mirrors.map((m) => m.visible);
  mirrors.forEach((m) => { m.visible = false; });

  mirrors.forEach((mesh) => {
    const box = new THREE.Box3().setFromObject(mesh);
    const center = box.getCenter(new THREE.Vector3());
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

    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      metalness: 1.0,
      roughness: 0.0,
      envMap: rt.texture,
      envMapIntensity: 1.0,
    });
    mat.name = 'Apt_mirror_live';
    mesh.material = mat;
  });

  mirrors.forEach((m, i) => { m.visible = wasVisible[i]; });
  console.log('[mirrors]', mirrors.map((m) => m.name).join(', '));
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
        opacity: 0.9,
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
    const light = new THREE.PointLight(0xffb46b, 0, 9, 2);
    light.position.set(center.x, box.min.y + 0.15, center.z);
    light.castShadow = true;
    light.shadow.mapSize.set(1024, 1024);
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
  st.glow.visible = st.on;
  st.light.visible = st.on;
  st.light.intensity = st.on ? 9 : 0;
  if (st.on) st.light.shadow.needsUpdate = true;
  if (st.base) {
    st.base.emissive.set(st.on ? 0xffc078 : 0x000000);
    st.base.emissiveIntensity = st.on ? 0.45 : 0;
  }
  console.log('[lamp]', id, st.on ? 'ON' : 'OFF');
  return true;
}

/* ------------------------------------------------------------------ *
 *  State
 * ------------------------------------------------------------------ */
const loaderEl = document.getElementById('loader');
const progressEl = document.getElementById('progress');

let apartment = null;
let wallsMesh = null;
let slab = null;

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
 *  Load model
 * ------------------------------------------------------------------ */
const draco = new DRACOLoader();
draco.setDecoderPath('./vendor/draco/');

const loader = new GLTFLoader();
loader.setDRACOLoader(draco);

loader.load(
  './public/apartment.glb?v=7',
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
        wallsMesh = o;
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

    // ---- base slab ----
    const pad = 0.15;
    const slabThickness = 0.42;
    const shape = roundedRectShape(modelSize.x + pad * 2, modelSize.z + pad * 2, 0.7);
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: slabThickness,
      bevelEnabled: true,
      bevelThickness: 0.08,
      bevelSize: 0.08,
      bevelSegments: 3,
      curveSegments: 10,
    });
    geo.rotateX(-Math.PI / 2);
    geo.computeBoundingBox();
    geo.translate(0, -geo.boundingBox.max.y - 0.03, 0);

    slab = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({
        color: new THREE.Color('#e4eaf3'),
        roughness: 0.95,
        metalness: 0.0,
      })
    );
    slab.receiveShadow = true;
    slab.castShadow = true;
    scene.add(slab);

    // ---- soft contact shadow ----
    const soft = new THREE.Mesh(
      new THREE.PlaneGeometry(modelSize.x * 2.1, modelSize.z * 2.6),
      new THREE.MeshBasicMaterial({
        map: makeSoftShadowTexture(),
        transparent: true,
        depthWrite: false,
        opacity: 0.9,
      })
    );
    soft.rotation.x = -Math.PI / 2;
    soft.position.y = -slabThickness - 0.22;
    scene.add(soft);

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

    setupMirrors();
    setupLamps();

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
  const candidates = hits.filter((h) => !(fadedWalls && h.object === wallsMesh));
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
  const hint = document.querySelector('.hint');

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

  window.addEventListener('keydown', (e) => {
    if (e.key === '1') btnIso.click();
    if (e.key === '2') btnTop.click();
    if (e.key === '3') btnWalls.click();
    if (e.key === '4') btnRotate.click();
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

  if (wallsMesh) {
    const mat = wallsMesh.material;
    const cur = mat.opacity;
    if (Math.abs(cur - wallTargetOpacity) > 0.004) {
      mat.opacity = cur + (wallTargetOpacity - cur) * Math.min(1, dt * 9);
      mat.transparent = true;
      mat.depthWrite = mat.opacity > 0.7;
    } else if (mat.opacity !== wallTargetOpacity) {
      mat.opacity = wallTargetOpacity;
      mat.transparent = wallTargetOpacity < 0.99;
      mat.depthWrite = wallTargetOpacity > 0.7;
      mat.needsUpdate = true;
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
