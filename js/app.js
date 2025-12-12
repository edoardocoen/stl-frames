import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import JSZip from 'jszip';

const ui = {
  width: document.getElementById('width'),
  height: document.getElementById('height'),
  faceWidth: document.getElementById('faceWidth'),
  profileDepth: document.getElementById('profileDepth'),
  lipWidth: document.getElementById('lipWidth'),
  lipDepth: document.getElementById('lipDepth'),
  clearance: document.getElementById('clearance'),
  style: document.getElementById('style'),
  summary: document.getElementById('summary'),
  download: document.getElementById('downloadZip'),
  update: document.getElementById('updatePreview'),
  reset: document.getElementById('resetDefaults'),
  canvas: document.getElementById('viewport'),
};

const defaults = {
  width: 600,
  height: 400,
  faceWidth: 20,
  profileDepth: 14,
  lipWidth: 4,
  lipDepth: 4,
  clearance: 0.4,
  style: 'minimal',
};

let scene, camera, renderer, controls, frameGroup;
const exporter = new STLExporter();

function readParams() {
  return {
    width: Number(ui.width.value),
    height: Number(ui.height.value),
    faceWidth: Number(ui.faceWidth.value),
    profileDepth: Number(ui.profileDepth.value),
    lipWidth: Number(ui.lipWidth.value),
    lipDepth: Number(ui.lipDepth.value),
    clearance: Number(ui.clearance.value),
    style: ui.style.value,
  };
}

function normalizeParams(params) {
  const sane = { ...params };
  const numericDefaults = {
    width: defaults.width,
    height: defaults.height,
    faceWidth: defaults.faceWidth,
    profileDepth: defaults.profileDepth,
    lipWidth: defaults.lipWidth,
    lipDepth: defaults.lipDepth,
    clearance: defaults.clearance,
  };

  for (const [key, fallback] of Object.entries(numericDefaults)) {
    if (!Number.isFinite(sane[key]) || sane[key] <= 0) {
      sane[key] = fallback;
    }
  }

  if (sane.lipWidth >= sane.faceWidth) {
    sane.lipWidth = Math.max(2, sane.faceWidth * 0.45);
  }
  if (sane.lipDepth >= sane.profileDepth) {
    sane.lipDepth = Math.max(2, sane.profileDepth * 0.35);
  }

  return sane;
}

function setDefaults() {
  Object.entries(defaults).forEach(([key, value]) => {
    ui[key].value = value;
  });
}

function buildProfileShape({ faceWidth, profileDepth, lipWidth, lipDepth }) {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(faceWidth, 0);
  shape.lineTo(faceWidth, profileDepth);
  shape.lineTo(faceWidth - lipWidth, profileDepth);
  shape.lineTo(faceWidth - lipWidth, lipDepth);
  shape.lineTo(0, lipDepth);
  shape.lineTo(0, 0);
  return shape;
}

function jitterWood(geometry, intensity = 0.35) {
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const stride = i * 3;
    const x = position.getX(i);
    const z = position.getZ(i);
    const noise = Math.sin(x * 0.18) * Math.cos(z * 0.12) * intensity;
    position.setX(i, x + noise * 0.6);
    position.setZ(i, z + noise);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
}

function createPiece(length, orientation, params) {
  const { faceWidth, profileDepth, lipWidth, lipDepth, style } = params;
  const shape = buildProfileShape({ faceWidth, profileDepth, lipWidth, lipDepth });
  const bevel = style === 'bold';
  const extrudeSettings = {
    depth: length,
    bevelEnabled: bevel,
    bevelThickness: bevel ? 1.2 : 0,
    bevelSize: bevel ? 0.8 : 0,
    bevelSegments: 2,
  };

  const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
  geometry.translate(-faceWidth / 2, -profileDepth / 2, -length / 2);

  if (style === 'wood') {
    jitterWood(geometry);
  }

  if (orientation === 'horizontal') {
    geometry.rotateY(Math.PI / 2);
  } else if (orientation === 'vertical') {
    geometry.rotateX(-Math.PI / 2);
  }

  const material = new THREE.MeshStandardMaterial({
    color: style === 'wood' ? 0xb18f6a : style === 'bold' ? 0x7cc7ff : 0x9ad4ff,
    roughness: style === 'wood' ? 0.8 : 0.45,
    metalness: 0.05,
  });

  return new THREE.Mesh(geometry, material);
}

function createLipOverlay(length, orientation, params) {
  const { lipWidth, lipDepth, faceWidth, profileDepth } = params;
  const lipShape = new THREE.Shape();
  lipShape.moveTo(-faceWidth / 2, -profileDepth / 2);
  lipShape.lineTo(-faceWidth / 2 + lipWidth, -profileDepth / 2);
  lipShape.lineTo(-faceWidth / 2 + lipWidth, -profileDepth / 2 + lipDepth);
  lipShape.lineTo(-faceWidth / 2, -profileDepth / 2 + lipDepth);
  lipShape.lineTo(-faceWidth / 2, -profileDepth / 2);

  const geometry = new THREE.ExtrudeGeometry(lipShape, { depth: length, bevelEnabled: false });

  if (orientation === 'horizontal') {
    geometry.rotateY(Math.PI / 2);
  } else if (orientation === 'vertical') {
    geometry.rotateX(-Math.PI / 2);
  }
  geometry.translate(0, 0, -length / 2);

  const material = new THREE.MeshStandardMaterial({ color: 0xffb347, metalness: 0.05, roughness: 0.3 });
  return new THREE.Mesh(geometry, material);
}

function buildFrame(params) {
  const safeParams = normalizeParams(params);

  if (frameGroup) {
    scene.remove(frameGroup);
  }
  frameGroup = new THREE.Group();

  const { width, height, faceWidth, lipWidth, clearance } = safeParams;
  const innerWidth = width + clearance * 2;
  const innerHeight = height + clearance * 2;

  const horizontalLength = innerWidth + lipWidth * 2;
  const verticalLength = innerHeight + lipWidth * 2;
  const offsetX = innerWidth / 2;
  const offsetY = innerHeight / 2;

  const top = createPiece(horizontalLength, 'horizontal', safeParams);
  top.position.y = offsetY + (faceWidth - lipWidth) / 2;

  const bottom = createPiece(horizontalLength, 'horizontal', safeParams);
  bottom.position.y = -(offsetY + (faceWidth - lipWidth) / 2);

  const left = createPiece(verticalLength, 'vertical', safeParams);
  left.position.x = -(offsetX + (faceWidth - lipWidth) / 2);

  const right = createPiece(verticalLength, 'vertical', safeParams);
  right.position.x = offsetX + (faceWidth - lipWidth) / 2;

  const lipTop = createLipOverlay(horizontalLength, 'horizontal', safeParams);
  lipTop.position.copy(top.position);
  const lipBottom = createLipOverlay(horizontalLength, 'horizontal', safeParams);
  lipBottom.position.copy(bottom.position);
  const lipLeft = createLipOverlay(verticalLength, 'vertical', safeParams);
  lipLeft.position.copy(left.position);
  const lipRight = createLipOverlay(verticalLength, 'vertical', safeParams);
  lipRight.position.copy(right.position);

  frameGroup.add(top, bottom, left, right, lipTop, lipBottom, lipLeft, lipRight);
  scene.add(frameGroup);

  const outerWidth = innerWidth + faceWidth * 2;
  const outerHeight = innerHeight + faceWidth * 2;
  ui.summary.textContent = `Luce utile ${innerWidth.toFixed(1)} x ${innerHeight.toFixed(1)} mm — ingombro esterno ${outerWidth.toFixed(1)} x ${outerHeight.toFixed(1)} mm.`;

  fitCameraToFrame(frameGroup);
}

function initThree() {
  renderer = new THREE.WebGLRenderer({ antialias: true, canvas: ui.canvas, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.8));

  scene = new THREE.Scene();
  scene.background = new THREE.Color('#0b1623');

  camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 8000);
  camera.position.set(220, 180, 320);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;
  controls.target.set(0, 0, 0);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x0f1726, 0.85);
  const dir = new THREE.DirectionalLight(0xffffff, 0.6);
  dir.position.set(200, 260, 180);
  scene.add(hemi, dir);

  const grid = new THREE.GridHelper(800, 20, 0x2d3f53, 0x1b2a38);
  grid.position.y = -60;
  scene.add(grid);

  window.addEventListener('resize', resize);
  resize();
  animate();
}

function fitCameraToFrame(object3d) {
  const box = new THREE.Box3().setFromObject(object3d);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  const maxSize = Math.max(size.x, size.y, size.z);
  const fitHeightDistance = maxSize / (2 * Math.atan((Math.PI * camera.fov) / 360));
  const fitWidthDistance = fitHeightDistance / camera.aspect;
  const distance = Math.max(fitHeightDistance, fitWidthDistance) * 1.25;

  camera.position.set(center.x + distance, center.y + distance * 0.55, center.z + distance);
  camera.lookAt(center);
  controls.target.copy(center);
  controls.update();
}

function resize() {
  const width = ui.canvas.clientWidth;
  const height = ui.canvas.clientHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

function debounce(fn, wait = 180) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

async function downloadZip() {
  const params = normalizeParams(readParams());
  const { width, height, lipWidth, clearance } = params;
  const innerWidth = width + clearance * 2;
  const innerHeight = height + clearance * 2;
  const horizontalLength = innerWidth + lipWidth * 2;
  const verticalLength = innerHeight + lipWidth * 2;

  const pieces = [
    { name: 'frame_top.stl', length: horizontalLength, orientation: 'horizontal' },
    { name: 'frame_bottom.stl', length: horizontalLength, orientation: 'horizontal' },
    { name: 'frame_left.stl', length: verticalLength, orientation: 'vertical' },
    { name: 'frame_right.stl', length: verticalLength, orientation: 'vertical' },
  ];

  const zip = new JSZip();
  pieces.forEach((piece) => {
    const mesh = createPiece(piece.length, piece.orientation, params);
    mesh.position.copy(new THREE.Vector3());
    const stlString = exporter.parse(mesh);
    zip.file(piece.name, stlString);
  });

  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'cornice-personalizzata.zip';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function attachListeners() {
  const onChange = debounce(() => buildFrame(readParams()));
  [ui.width, ui.height, ui.faceWidth, ui.profileDepth, ui.lipWidth, ui.lipDepth, ui.clearance, ui.style].forEach((el) => {
    el.addEventListener('input', onChange);
  });

  ui.update.addEventListener('click', () => buildFrame(readParams()));
  ui.reset.addEventListener('click', () => {
    setDefaults();
    buildFrame(readParams());
  });
  ui.download.addEventListener('click', downloadZip);
}

// Bootstrap
setDefaults();
initThree();
buildFrame(readParams());
attachListeners();
