/**
 * Palakkad Open World RP - Main 3D Engine (Three.js + Mapbox GL + WebSocket Multiplayer)
 * 6 Iconic Palakkad Zones:
 *  1. Palakkad Fort & Kottamaithanam (0, 18)
 *  2. Stadium Bus Stand & Town Commercial Hub (115, 115)
 *  3. Malampuzha Dam, Ropeway & Yakshi Garden (0, -185)
 *  4. Govt. Victoria College Heritage Campus (-130, -20)
 *  5. Palakkad Junction Railway Station - Olavakkode (-135, -135)
 *  6. Kalpathy Heritage Agraharam & Chariot Street (135, -60)
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// --- MAPBOX CONFIGURATION (Loaded at runtime from /api/config via .env) ---
let MAPBOX_TOKEN = '';
const PALAKKAD_COORDS = {
  fort: { lng: 76.6572, lat: 10.7634, x: 0, z: 18, name: 'Palakkad Fort & Kottamaithanam' },
  busstand: { lng: 76.6608, lat: 10.7602, x: 115, z: 115, name: 'Stadium Bus Stand' },
  malampuzha: { lng: 76.6815, lat: 10.8306, x: 0, z: -185, name: 'Malampuzha Dam & Ropeway' },
  victoria: { lng: 76.6495, lat: 10.7798, x: -115, z: -20, name: 'Govt. Victoria College' },
  junction: { lng: 76.6382, lat: 10.8005, x: -115, z: -130, name: 'Palakkad Jn (Olavakkode)' },
  kalpathy: { lng: 76.6478, lat: 10.7852, x: 115, z: -60, name: 'Kalpathy Heritage Agraharam' }
};

// --- GLOBAL GAME STATE ---
const state = {
  playerId: null,
  playerName: 'Kichu_PKD',
  cash: 5000,
  customization: {
    shirtColor: '#2563eb',
    bottomType: 'jeans',
    bottomColor: '#1e3a8a',
    skinColor: '#c68642',
    sunglasses: true
  },
  realTimeIST: true,
  timeOfDay: 10.5,
  isNight: false,
  inVehicle: null,
  nearbyVehicle: null,
  nearbyNpc: null,
  activeMission: null,
  keys: {
    w: false,
    a: false,
    s: false,
    d: false,
    shift: false,
    space: false
  },
  joystick: { x: 0, y: 0, active: false },
  cameraAngleY: 0,
  cameraAngleX: 0.3,
  cameraDist: 8.8
};

// Pre-allocated vectors/matrices to eliminate garbage collection stutter
const _tempVec3 = new THREE.Vector3();
const _dummyObj = new THREE.Object3D();
const ropewayCabins = [];
let waterTexture = null;

// --- WEB AUDIO SYNTHESIZER ---
class SoundSystem {
  constructor() {
    this.ctx = null;
  }

  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  playHorn(type = 'bus') {
    this.init();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    if (type === 'bus' || type === 'ksrtc') {
      const freqs = type === 'bus' ? [330, 440, 554.37] : [293.66, 369.99, 440];
      freqs.forEach((f, idx) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(f, now + idx * 0.06);
        osc.frequency.exponentialRampToValueAtTime(f * 1.03, now + 0.45);
        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.11, now + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now + idx * 0.04);
        osc.stop(now + 0.58);
      });
    } else if (type === 'car') {
      [415, 523].forEach((f) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(f, now);
        gain.gain.setValueAtTime(0.11, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now);
        osc.stop(now + 0.34);
      });
    } else {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(620, now);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.22);
    }
  }

  playCashSound() {
    this.init();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    [587.33, 880].forEach((f, i) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, now + i * 0.08);
      gain.gain.setValueAtTime(0.13, now + i * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.08 + 0.25);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now + i * 0.08);
      osc.stop(now + i * 0.08 + 0.26);
    });
  }
}

const sound = new SoundSystem();

// --- THREE.JS SCENE & OPTIMIZED RENDERER ---
const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.FogExp2(0x87ceeb, 0.0022);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.3, 680);
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  powerPreference: 'high-performance',
  stencil: false
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
container.appendChild(renderer.domElement);

// --- PROCEDURAL HIGH-DETAIL PBR TEXTURE GENERATORS ---
function createProceduralTexture(type) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  if (type === 'laterite') {
    // Reddish-brown Palakkad Fort laterite stone blocks with mortar lines
    ctx.fillStyle = '#6e3423';
    ctx.fillRect(0, 0, 256, 256);
    const rows = 8;
    const cols = 4;
    const rh = 256 / rows;
    const cw = 256 / cols;
    for (let r = 0; r < rows; r++) {
      const offset = (r % 2) * (cw / 2);
      for (let c = -1; c <= cols; c++) {
        const shade = 95 + Math.floor(Math.random() * 35);
        ctx.fillStyle = `rgb(${shade + 25}, ${Math.floor(shade * 0.52)}, ${Math.floor(shade * 0.36)})`;
        ctx.fillRect(c * cw + offset + 2, r * rh + 2, cw - 4, rh - 4);
      }
    }
  } else if (type === 'rooftile') {
    // Traditional Kerala terracotta Mangalore roof tiles
    ctx.fillStyle = '#9a3412';
    ctx.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 256; y += 16) {
      ctx.fillStyle = y % 32 === 0 ? '#b45309' : '#7c2d12';
      ctx.fillRect(0, y, 256, 14);
      for (let x = 0; x < 256; x += 24) {
        ctx.strokeStyle = 'rgba(0,0,0,0.28)';
        ctx.strokeRect(x, y, 24, 16);
      }
    }
  } else if (type === 'windows') {
    // Commercial building facade with glass windows that glow at night
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(0, 0, 256, 256);
    for (let y = 16; y < 240; y += 44) {
      for (let x = 16; x < 240; x += 44) {
        const lit = Math.random() > 0.3;
        ctx.fillStyle = lit ? '#bae6fd' : '#334155';
        ctx.fillRect(x, y, 28, 30);
      }
    }
  } else if (type === 'water') {
    ctx.fillStyle = '#0284c7';
    ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = 'rgba(186, 230, 253, 0.35)';
    ctx.lineWidth = 3;
    for (let i = 0; i < 28; i++) {
      const wx = Math.random() * 220;
      const wy = Math.random() * 240;
      ctx.beginPath();
      ctx.arc(wx, wy, 14, 0.2, Math.PI - 0.2);
      ctx.stroke();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

const PROC_TEX = {
  laterite: createProceduralTexture('laterite'),
  rooftile: createProceduralTexture('rooftile'),
  windows: createProceduralTexture('windows'),
  water: createProceduralTexture('water')
};
PROC_TEX.laterite.repeat.set(6, 2);
PROC_TEX.rooftile.repeat.set(6, 4);
PROC_TEX.windows.repeat.set(2, 2);
PROC_TEX.water.repeat.set(8, 8);
waterTexture = PROC_TEX.water;

// --- LIGHTING & TIGHT PLAYER-FOLLOWING SHADOW FRUSTUM ---
const ambientLight = new THREE.AmbientLight(0xffffff, 0.68);
scene.add(ambientLight);

const hemiLight = new THREE.HemisphereLight(0x87ceeb, 0x3a5a40, 0.55);
scene.add(hemiLight);

const sunLight = new THREE.DirectionalLight(0xfff4e6, 1.85);
sunLight.position.set(80, 140, 60);
sunLight.castShadow = true;
sunLight.shadow.mapSize.width = 1024;
sunLight.shadow.mapSize.height = 1024;
sunLight.shadow.camera.near = 10;
sunLight.shadow.camera.far = 320;
const shadowBounds = 75;
sunLight.shadow.camera.left = -shadowBounds;
sunLight.shadow.camera.right = shadowBounds;
sunLight.shadow.camera.top = shadowBounds;
sunLight.shadow.camera.bottom = -shadowBounds;
sunLight.shadow.bias = -0.0006;
scene.add(sunLight);
scene.add(sunLight.target);

// Sun & Moon Visual Spheres + Stars
const skyGroup = new THREE.Group();
scene.add(skyGroup);

const sunMesh = new THREE.Mesh(
  new THREE.SphereGeometry(14, 16, 16),
  new THREE.MeshBasicMaterial({ color: 0xffdd66 })
);
skyGroup.add(sunMesh);

const moonMesh = new THREE.Mesh(
  new THREE.SphereGeometry(10, 16, 16),
  new THREE.MeshBasicMaterial({ color: 0xe2e8f0 })
);
skyGroup.add(moonMesh);

const starGeo = new THREE.BufferGeometry();
const starCount = 600;
const starPos = new Float32Array(starCount * 3);
for (let i = 0; i < starCount; i++) {
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(Math.random() * 0.85 + 0.15);
  const r = 420;
  starPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
  starPos[i * 3 + 1] = r * Math.cos(phi);
  starPos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
}
starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.8, transparent: true, opacity: 0 });
const stars = new THREE.Points(starGeo, starMat);
scene.add(stars);

const streetLampPositions = [];
const streetBulbMat = new THREE.MeshBasicMaterial({ color: 0x64748b });
const lampLightPool = [
  new THREE.PointLight(0xfbbf24, 0, 32, 1.5),
  new THREE.PointLight(0xfbbf24, 0, 32, 1.5)
];
lampLightPool.forEach((l) => scene.add(l));

const buildingColliders = [];

// --- TEXTURE HELPER: MALAYALAM & ENGLISH SIGNBOARDS ---
function createSignTexture(titleMl, titleEn, bgColor = '#1e3a8a', textColor = '#ffffff', accentColor = '#fbbf24') {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, 512, 256);

  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 10;
  ctx.strokeRect(10, 10, 492, 236);

  ctx.fillStyle = accentColor;
  ctx.font = 'bold 40px "Noto Sans Malayalam", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(titleMl, 256, 108);

  ctx.fillStyle = textColor;
  ctx.font = 'bold 30px "Inter", sans-serif';
  ctx.fillText(titleEn, 256, 184);

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

// --- SHARED CHARACTER GEOMETRIES & MATERIALS (GPU MEMORY OPTIMIZED) ---
const CHAR_GEO = {
  pelvis: new THREE.CapsuleGeometry(0.22, 0.28, 8, 12),
  torso: new THREE.CylinderGeometry(0.28, 0.23, 0.68, 14),
  chest: new THREE.CapsuleGeometry(0.27, 0.22, 8, 14),
  neck: new THREE.CylinderGeometry(0.095, 0.11, 0.18, 10),
  head: new THREE.SphereGeometry(0.235, 18, 16),
  ear: new THREE.SphereGeometry(0.045, 8, 8),
  nose: new THREE.ConeGeometry(0.032, 0.09, 8),
  eye: new THREE.SphereGeometry(0.024, 8, 8),
  eyebrow: new THREE.BoxGeometry(0.065, 0.016, 0.02),
  hairTop: new THREE.SphereGeometry(0.248, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.58),
  hairFront: new THREE.CapsuleGeometry(0.09, 0.22, 6, 10),
  collarWing: new THREE.BoxGeometry(0.14, 0.08, 0.16),
  placket: new THREE.BoxGeometry(0.055, 0.66, 0.02),
  pocket: new THREE.BoxGeometry(0.11, 0.12, 0.02),
  shoulder: new THREE.SphereGeometry(0.115, 10, 10),
  upperArm: new THREE.CylinderGeometry(0.098, 0.082, 0.34, 10),
  elbow: new THREE.SphereGeometry(0.078, 8, 8),
  forearm: new THREE.CylinderGeometry(0.078, 0.062, 0.32, 10),
  hand: new THREE.SphereGeometry(0.068, 10, 10),
  watchBand: new THREE.CylinderGeometry(0.068, 0.068, 0.04, 10),
  watchDial: new THREE.CylinderGeometry(0.035, 0.035, 0.02, 10),
  belt: new THREE.CylinderGeometry(0.245, 0.245, 0.075, 14),
  buckle: new THREE.BoxGeometry(0.09, 0.085, 0.04),
  thigh: new THREE.CylinderGeometry(0.132, 0.108, 0.44, 12),
  knee: new THREE.SphereGeometry(0.104, 10, 10),
  calf: new THREE.CylinderGeometry(0.102, 0.082, 0.42, 12),
  shoeUpper: new THREE.CapsuleGeometry(0.09, 0.18, 6, 10),
  shoeSole: new THREE.BoxGeometry(0.19, 0.045, 0.34),
  munduWrap: new THREE.CylinderGeometry(0.25, 0.29, 0.84, 16),
  kasavuBorder: new THREE.CylinderGeometry(0.292, 0.295, 0.1, 16),
  lens: new THREE.BoxGeometry(0.16, 0.1, 0.035),
  bridge: new THREE.BoxGeometry(0.38, 0.022, 0.04),
  temple: new THREE.BoxGeometry(0.022, 0.022, 0.26)
};

CHAR_GEO.pelvis.rotateZ(Math.PI / 2);
CHAR_GEO.chest.rotateZ(Math.PI / 2);
CHAR_GEO.hairFront.rotateZ(Math.PI / 2);
CHAR_GEO.shoeUpper.rotateX(Math.PI / 2);
CHAR_GEO.watchDial.rotateX(Math.PI / 2);

const SHARED_MAT = {
  hair: new THREE.MeshStandardMaterial({ color: 0x141418, roughness: 0.75 }),
  pupil: new THREE.MeshBasicMaterial({ color: 0x09090b }),
  placket: new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.6 }),
  belt: new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.45, metalness: 0.3 }),
  gold: new THREE.MeshStandardMaterial({ color: 0xfacc15, metalness: 0.85, roughness: 0.2 }),
  shoe: new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.5 }),
  sole: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 }),
  glassFrame: new THREE.MeshStandardMaterial({ color: 0x111827, metalness: 0.85, roughness: 0.15 }),
  glassLens: new THREE.MeshStandardMaterial({ color: 0x020617, metalness: 0.95, roughness: 0.05 })
};

// --- REALISTIC ARTICULATED 3D HUMAN CHARACTER BUILDER ---
function createCharacterRig(custom = state.customization, nameText = state.playerName, isLocal = false, roleBadge = '') {
  const root = new THREE.Group();

  const skinMat = new THREE.MeshStandardMaterial({ color: custom.skinColor || '#c68642', roughness: 0.62 });
  const shirtMat = new THREE.MeshStandardMaterial({ color: custom.shirtColor || '#2563eb', roughness: 0.55 });
  const bottomColor =
    custom.bottomType === 'mundu'
      ? '#f8fafc'
      : custom.bottomType === 'jeans'
      ? custom.bottomColor || '#1e3a8a'
      : custom.bottomColor || '#f8fafc';
  const bottomMat = new THREE.MeshStandardMaterial({ color: bottomColor, roughness: 0.78 });

  const upperBody = new THREE.Group();
  upperBody.position.y = 1.02;
  root.add(upperBody);

  const pelvis = new THREE.Mesh(CHAR_GEO.pelvis, bottomMat);
  pelvis.position.y = -0.04;
  pelvis.castShadow = isLocal;
  upperBody.add(pelvis);

  const torso = new THREE.Mesh(CHAR_GEO.torso, shirtMat);
  torso.position.y = 0.36;
  torso.castShadow = true;
  upperBody.add(torso);

  const chest = new THREE.Mesh(CHAR_GEO.chest, shirtMat);
  chest.position.set(0, 0.54, 0.02);
  upperBody.add(chest);

  const leftCollar = new THREE.Mesh(CHAR_GEO.collarWing, shirtMat);
  leftCollar.position.set(-0.08, 0.73, 0.06);
  leftCollar.rotation.set(0.2, 0.3, -0.25);
  const rightCollar = new THREE.Mesh(CHAR_GEO.collarWing, shirtMat);
  rightCollar.position.set(0.08, 0.73, 0.06);
  rightCollar.rotation.set(0.2, -0.3, 0.25);
  upperBody.add(leftCollar, rightCollar);

  const placket = new THREE.Mesh(CHAR_GEO.placket, SHARED_MAT.placket);
  placket.position.set(0, 0.36, 0.245);
  upperBody.add(placket);

  const pocket = new THREE.Mesh(CHAR_GEO.pocket, shirtMat);
  pocket.position.set(0.13, 0.5, 0.25);
  upperBody.add(pocket);

  const belt = new THREE.Mesh(CHAR_GEO.belt, SHARED_MAT.belt);
  belt.position.y = 0.02;
  upperBody.add(belt);

  const buckle = new THREE.Mesh(CHAR_GEO.buckle, SHARED_MAT.gold);
  buckle.position.set(0, 0.02, 0.245);
  upperBody.add(buckle);

  const neck = new THREE.Mesh(CHAR_GEO.neck, skinMat);
  neck.position.y = 0.78;
  upperBody.add(neck);

  const headGroup = new THREE.Group();
  headGroup.position.y = 1.02;
  upperBody.add(headGroup);

  const head = new THREE.Mesh(CHAR_GEO.head, skinMat);
  head.scale.set(0.92, 1.06, 0.96);
  head.castShadow = isLocal;
  headGroup.add(head);

  const leftEar = new THREE.Mesh(CHAR_GEO.ear, skinMat);
  leftEar.position.set(-0.215, 0, 0);
  const rightEar = new THREE.Mesh(CHAR_GEO.ear, skinMat);
  rightEar.position.set(0.215, 0, 0);
  const nose = new THREE.Mesh(CHAR_GEO.nose, skinMat);
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, 0.01, 0.235);
  headGroup.add(leftEar, rightEar, nose);

  const leftEye = new THREE.Mesh(CHAR_GEO.eye, SHARED_MAT.pupil);
  leftEye.position.set(-0.08, 0.05, 0.21);
  const rightEye = new THREE.Mesh(CHAR_GEO.eye, SHARED_MAT.pupil);
  rightEye.position.set(0.08, 0.05, 0.21);
  const leftBrow = new THREE.Mesh(CHAR_GEO.eyebrow, SHARED_MAT.hair);
  leftBrow.position.set(-0.08, 0.1, 0.215);
  const rightBrow = new THREE.Mesh(CHAR_GEO.eyebrow, SHARED_MAT.hair);
  rightBrow.position.set(0.08, 0.1, 0.215);
  headGroup.add(leftEye, rightEye, leftBrow, rightBrow);

  const hairTop = new THREE.Mesh(CHAR_GEO.hairTop, SHARED_MAT.hair);
  hairTop.scale.set(0.95, 1.05, 1.0);
  hairTop.rotation.x = -0.15;
  hairTop.position.y = 0.02;
  const hairFront = new THREE.Mesh(CHAR_GEO.hairFront, SHARED_MAT.hair);
  hairFront.position.set(0, 0.21, 0.12);
  hairFront.rotation.x = 0.25;
  headGroup.add(hairTop, hairFront);

  const glassesGroup = new THREE.Group();
  const leftLens = new THREE.Mesh(CHAR_GEO.lens, SHARED_MAT.glassLens);
  leftLens.position.set(-0.095, 0.045, 0.225);
  const rightLens = new THREE.Mesh(CHAR_GEO.lens, SHARED_MAT.glassLens);
  rightLens.position.set(0.095, 0.045, 0.225);
  const bridgeBar = new THREE.Mesh(CHAR_GEO.bridge, SHARED_MAT.glassFrame);
  bridgeBar.position.set(0, 0.09, 0.228);
  const leftTemple = new THREE.Mesh(CHAR_GEO.temple, SHARED_MAT.glassFrame);
  leftTemple.position.set(-0.205, 0.06, 0.1);
  const rightTemple = new THREE.Mesh(CHAR_GEO.temple, SHARED_MAT.glassFrame);
  rightTemple.position.set(0.205, 0.06, 0.1);
  glassesGroup.add(leftLens, rightLens, bridgeBar, leftTemple, rightTemple);
  glassesGroup.visible = Boolean(custom.sunglasses);
  headGroup.add(glassesGroup);

  function createArm(side) {
    const dir = side === 'left' ? -1 : 1;
    const shoulderPivot = new THREE.Group();
    shoulderPivot.position.set(dir * 0.36, 0.62, 0);

    const shoulderCap = new THREE.Mesh(CHAR_GEO.shoulder, shirtMat);
    shoulderPivot.add(shoulderCap);

    const sleeve = new THREE.Mesh(CHAR_GEO.upperArm, shirtMat);
    sleeve.position.y = -0.16;
    sleeve.castShadow = isLocal;
    shoulderPivot.add(sleeve);

    const elbowPivot = new THREE.Group();
    elbowPivot.position.y = -0.33;
    shoulderPivot.add(elbowPivot);

    const elbowJoint = new THREE.Mesh(CHAR_GEO.elbow, skinMat);
    elbowPivot.add(elbowJoint);

    const forearm = new THREE.Mesh(CHAR_GEO.forearm, skinMat);
    forearm.position.y = -0.16;
    elbowPivot.add(forearm);

    if (side === 'left') {
      const watchBand = new THREE.Mesh(CHAR_GEO.watchBand, SHARED_MAT.belt);
      watchBand.position.y = -0.28;
      const watchDial = new THREE.Mesh(CHAR_GEO.watchDial, SHARED_MAT.gold);
      watchDial.position.set(0, -0.28, 0.06);
      elbowPivot.add(watchBand, watchDial);
    }

    const hand = new THREE.Mesh(CHAR_GEO.hand, skinMat);
    hand.position.y = -0.34;
    hand.scale.set(0.85, 1.1, 0.65);
    elbowPivot.add(hand);

    upperBody.add(shoulderPivot);
    return { shoulderPivot, elbowPivot };
  }

  const leftArm = createArm('left');
  const rightArm = createArm('right');

  const munduSkirt = new THREE.Mesh(CHAR_GEO.munduWrap, bottomMat);
  munduSkirt.position.y = 0.52;
  root.add(munduSkirt);

  const kasavuBorder = new THREE.Mesh(CHAR_GEO.kasavuBorder, SHARED_MAT.gold);
  kasavuBorder.position.y = 0.16;
  root.add(kasavuBorder);

  function createLeg(side) {
    const dir = side === 'left' ? -1 : 1;
    const hipPivot = new THREE.Group();
    hipPivot.position.set(dir * 0.135, 0.96, 0);

    const thigh = new THREE.Mesh(CHAR_GEO.thigh, bottomMat);
    thigh.position.y = -0.22;
    thigh.castShadow = true;
    hipPivot.add(thigh);

    const kneePivot = new THREE.Group();
    kneePivot.position.y = -0.44;
    hipPivot.add(kneePivot);

    const kneeJoint = new THREE.Mesh(CHAR_GEO.knee, bottomMat);
    kneePivot.add(kneeJoint);

    const calf = new THREE.Mesh(CHAR_GEO.calf, bottomMat);
    calf.position.y = -0.21;
    calf.castShadow = isLocal;
    kneePivot.add(calf);

    const shoeUpper = new THREE.Mesh(CHAR_GEO.shoeUpper, SHARED_MAT.shoe);
    shoeUpper.position.set(0, -0.43, 0.04);
    const shoeSole = new THREE.Mesh(CHAR_GEO.shoeSole, SHARED_MAT.sole);
    shoeSole.position.set(0, -0.49, 0.04);
    kneePivot.add(shoeUpper, shoeSole);

    root.add(hipPivot);
    return { hipPivot, kneePivot };
  }

  const leftLeg = createLeg('left');
  const rightLeg = createLeg('right');

  const nameCanvas = document.createElement('canvas');
  nameCanvas.width = 256;
  nameCanvas.height = 64;
  const nCtx = nameCanvas.getContext('2d');
  const nameTex = new THREE.CanvasTexture(nameCanvas);
  const spriteMat = new THREE.SpriteMaterial({ map: nameTex, transparent: true });
  const nameSprite = new THREE.Sprite(spriteMat);
  nameSprite.position.set(0, 2.48, 0);
  nameSprite.scale.set(2.1, 0.52, 1);
  root.add(nameSprite);

  function updateRigAppearance(newCustom, newName) {
    skinMat.color.set(newCustom.skinColor || '#c68642');
    shirtMat.color.set(newCustom.shirtColor || '#2563eb');
    const bCol =
      newCustom.bottomType === 'mundu'
        ? '#f8fafc'
        : newCustom.bottomType === 'jeans'
        ? newCustom.bottomColor || '#1e3a8a'
        : newCustom.bottomColor || '#f8fafc';
    bottomMat.color.set(bCol);
    const showMundu = newCustom.bottomType === 'mundu' || newCustom.bottomType === 'colored_mundu';
    munduSkirt.visible = showMundu;
    kasavuBorder.visible = showMundu;
    belt.visible = !showMundu;
    buckle.visible = !showMundu;
    glassesGroup.visible = Boolean(newCustom.sunglasses);

    nCtx.clearRect(0, 0, 256, 64);
    nCtx.fillStyle = 'rgba(15, 23, 42, 0.82)';
    nCtx.fillRect(10, 8, 236, 48);
    nCtx.strokeStyle = isLocal ? '#38bdf8' : roleBadge ? '#10b981' : '#fbbf24';
    nCtx.lineWidth = 3;
    nCtx.strokeRect(10, 8, 236, 48);
    nCtx.fillStyle = '#ffffff';
    nCtx.font = 'bold 20px Inter, sans-serif';
    nCtx.textAlign = 'center';
    const label = roleBadge ? `${newName} • ${roleBadge}` : newName || 'Player';
    nCtx.fillText(label.slice(0, 22), 128, 39);
    nameTex.needsUpdate = true;
  }

  updateRigAppearance(custom, nameText);

  function animateLimbs(animState, time) {
    if (animState === 'walk' || animState === 'run') {
      const freq = animState === 'run' ? 12.5 : 7.5;
      const amp = animState === 'run' ? 0.72 : 0.46;
      const phase = time * freq;
      const s = Math.sin(phase);
      const c = Math.cos(phase);

      leftArm.shoulderPivot.rotation.x = s * amp;
      rightArm.shoulderPivot.rotation.x = -s * amp;
      leftArm.elbowPivot.rotation.x = -Math.max(0.15, -s * 0.55);
      rightArm.elbowPivot.rotation.x = -Math.max(0.15, s * 0.55);

      leftLeg.hipPivot.rotation.x = -s * amp;
      rightLeg.hipPivot.rotation.x = s * amp;
      leftLeg.kneePivot.rotation.x = Math.max(0, s * amp * 0.85);
      rightLeg.kneePivot.rotation.x = Math.max(0, -s * amp * 0.85);

      upperBody.position.y = 1.02 + Math.abs(c) * (animState === 'run' ? 0.055 : 0.03);
      upperBody.rotation.y = s * 0.08;
    } else {
      const breath = Math.sin(time * 2.4);
      leftArm.shoulderPivot.rotation.x = breath * 0.03;
      rightArm.shoulderPivot.rotation.x = -breath * 0.03;
      leftArm.elbowPivot.rotation.x = -0.12;
      rightArm.elbowPivot.rotation.x = -0.12;
      leftLeg.hipPivot.rotation.x = 0;
      rightLeg.hipPivot.rotation.x = 0;
      leftLeg.kneePivot.rotation.x = 0;
      rightLeg.kneePivot.rotation.x = 0;
      upperBody.position.y = 1.02 + breath * 0.012;
      upperBody.rotation.y = 0;
    }
  }

  return {
    mesh: root,
    headGroup,
    updateRigAppearance,
    animateLimbs
  };
}

// --- WORLD BUILDER: 6 DETAILED PALAKKAD ZONES ---
function buildPalakkadWorld() {
  const groundGeo = new THREE.PlaneGeometry(950, 950, 16, 16);
  groundGeo.rotateX(-Math.PI / 2);
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0x3b6e38,
    roughness: 0.92,
    metalness: 0.05
  });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.receiveShadow = true;
  scene.add(ground);

  if (MAPBOX_TOKEN) {
    const texLoader = new THREE.TextureLoader();
    texLoader.setCrossOrigin('anonymous');
    const mapboxStaticUrl = `https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/static/76.6572,10.7634,15,0/1024x1024?access_token=${MAPBOX_TOKEN}`;
    texLoader.load(
      mapboxStaticUrl,
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        const mapOverlay = new THREE.Mesh(
          new THREE.PlaneGeometry(240, 240),
          new THREE.MeshStandardMaterial({
            map: texture,
            roughness: 0.9,
            transparent: true,
            opacity: 0.42
          })
        );
        mapOverlay.rotation.x = -Math.PI / 2;
        mapOverlay.position.set(0, 0.02, 0);
        mapOverlay.receiveShadow = true;
        scene.add(mapOverlay);
      },
      undefined,
      () => {}
    );
  }

  buildRoads();
  buildPalakkadFortAndMaithanam();
  buildStadiumBusStand();
  buildMalampuzhaDamAndRopeway();
  buildVictoriaCollegeCampus();
  buildOlavakkodeRailwayStation();
  buildKalpathyAgraharam();
  populateInstancedTreesAndLamps();
}

function createRoadSegment(x, z, width, length, rotY = 0) {
  const group = new THREE.Group();
  group.position.set(x, 0.05, z);
  group.rotation.y = rotY;

  const asphalt = new THREE.Mesh(
    new THREE.PlaneGeometry(width, length),
    new THREE.MeshStandardMaterial({ color: 0x26292e, roughness: 0.85 })
  );
  asphalt.rotation.x = -Math.PI / 2;
  asphalt.receiveShadow = true;
  group.add(asphalt);

  const dashCount = Math.floor(length / 8);
  const dashGeo = new THREE.PlaneGeometry(0.3, 3.8);
  dashGeo.rotateX(-Math.PI / 2);
  const dashMat = new THREE.MeshBasicMaterial({ color: 0xfacc15 });
  const dashInst = new THREE.InstancedMesh(dashGeo, dashMat, dashCount);
  let idx = 0;
  for (let i = -dashCount / 2; i < dashCount / 2; i++) {
    _dummyObj.position.set(0, 0.02, i * 8 + 4);
    _dummyObj.rotation.set(0, 0, 0);
    _dummyObj.scale.set(1, 1, 1);
    _dummyObj.updateMatrix();
    dashInst.setMatrixAt(idx++, _dummyObj.matrix);
  }
  group.add(dashInst);

  const curbGeo = new THREE.BoxGeometry(1.2, 0.22, length);
  const curbMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.8 });
  const leftCurb = new THREE.Mesh(curbGeo, curbMat);
  leftCurb.position.set(-width / 2 - 0.6, 0.1, 0);
  const rightCurb = new THREE.Mesh(curbGeo, curbMat);
  rightCurb.position.set(width / 2 + 0.6, 0.1, 0);
  group.add(leftCurb, rightCurb);

  scene.add(group);
}

function buildRoads() {
  // Main North-South Highway (Malampuzha Dam <-> Fort <-> South Town)
  createRoadSegment(0, -60, 14, 320, 0);
  // East-West Arterial Road (Victoria College <-> Fort Maithanam <-> Stadium Bus Stand)
  createRoadSegment(10, 40, 14, 280, Math.PI / 2);
  // Connector Road to Stadium Bus Stand
  createRoadSegment(120, 85, 14, 95, 0);
  // Western Highway (Victoria College <-> Olavakkode Railway Junction)
  createRoadSegment(-115, -45, 14, 185, 0);
  // Eastern Heritage Road (Fort Highway <-> Kalpathy Agraharam)
  createRoadSegment(70, -60, 12, 130, Math.PI / 2);
}

function buildPalakkadFortAndMaithanam() {
  const fortCenterZ = -35;
  const fortGroup = new THREE.Group();
  fortGroup.position.set(0, 0, fortCenterZ);

  // Outer Water Moat with animated procedural water texture
  const moat = new THREE.Mesh(
    new THREE.PlaneGeometry(78, 78),
    new THREE.MeshStandardMaterial({
      map: PROC_TEX.water,
      roughness: 0.18,
      metalness: 0.45
    })
  );
  moat.rotation.x = -Math.PI / 2;
  moat.position.y = 0.08;
  fortGroup.add(moat);

  const courtyard = new THREE.Mesh(
    new THREE.BoxGeometry(58, 0.6, 58),
    new THREE.MeshStandardMaterial({ color: 0x4d7c0f, roughness: 0.9 })
  );
  courtyard.position.y = 0.3;
  courtyard.receiveShadow = true;
  fortGroup.add(courtyard);

  // High-Detail Laterite Stone Material + Battlement Merlons
  const fortWallMat = new THREE.MeshStandardMaterial({
    map: PROC_TEX.laterite,
    roughness: 0.88,
    metalness: 0.08
  });
  const wallHeight = 9.5;
  const wallThickness = 4.2;

  const northWall = new THREE.Mesh(new THREE.BoxGeometry(54, wallHeight, wallThickness), fortWallMat);
  northWall.position.set(0, wallHeight / 2, -26);
  northWall.castShadow = true;
  northWall.receiveShadow = true;

  const westWall = new THREE.Mesh(new THREE.BoxGeometry(wallThickness, wallHeight, 54), fortWallMat);
  westWall.position.set(-26, wallHeight / 2, 0);
  westWall.castShadow = true;

  const eastWall = new THREE.Mesh(new THREE.BoxGeometry(wallThickness, wallHeight, 54), fortWallMat);
  eastWall.position.set(26, wallHeight / 2, 0);
  eastWall.castShadow = true;

  const southLeft = new THREE.Mesh(new THREE.BoxGeometry(20, wallHeight, wallThickness), fortWallMat);
  southLeft.position.set(-17, wallHeight / 2, 26);
  southLeft.castShadow = true;

  const southRight = new THREE.Mesh(new THREE.BoxGeometry(20, wallHeight, wallThickness), fortWallMat);
  southRight.position.set(17, wallHeight / 2, 26);
  southRight.castShadow = true;

  const southGateTop = new THREE.Mesh(new THREE.BoxGeometry(14, 3.2, wallThickness), fortWallMat);
  southGateTop.position.set(0, wallHeight - 1.6, 26);
  southGateTop.castShadow = true;

  fortGroup.add(northWall, westWall, eastWall, southLeft, southRight, southGateTop);

  // Battlement Merlons along the top of the Fort walls
  const merlonGeo = new THREE.BoxGeometry(2.2, 1.4, 1.5);
  for (let mx = -22; mx <= 22; mx += 4.4) {
    const mNorth = new THREE.Mesh(merlonGeo, fortWallMat);
    mNorth.position.set(mx, wallHeight + 0.7, -26);
    const mSouth = new THREE.Mesh(merlonGeo, fortWallMat);
    mSouth.position.set(mx, wallHeight + 0.7, 26);
    fortGroup.add(mNorth, mSouth);
  }

  // Hanuman Temple Mandapam inside Fort Courtyard
  const mandapam = new THREE.Mesh(
    new THREE.ConeGeometry(5.5, 4.5, 4),
    new THREE.MeshStandardMaterial({ map: PROC_TEX.rooftile, roughness: 0.75 })
  );
  mandapam.position.set(-12, 5.2, -8);
  mandapam.rotation.y = Math.PI / 4;
  const mandapamBase = new THREE.Mesh(
    new THREE.BoxGeometry(7, 3, 7),
    new THREE.MeshStandardMaterial({ color: 0xfef08a, roughness: 0.7 })
  );
  mandapamBase.position.set(-12, 1.5, -8);
  fortGroup.add(mandapam, mandapamBase);

  buildingColliders.push(
    { minX: -28, maxX: 28, minZ: fortCenterZ - 29, maxZ: fortCenterZ - 23 },
    { minX: -29, maxX: -23, minZ: fortCenterZ - 28, maxZ: fortCenterZ + 28 },
    { minX: 23, maxX: 29, minZ: fortCenterZ - 28, maxZ: fortCenterZ + 28 },
    { minX: -28, maxX: -7, minZ: fortCenterZ + 23, maxZ: fortCenterZ + 29 },
    { minX: 7, maxX: 28, minZ: fortCenterZ + 23, maxZ: fortCenterZ + 29 }
  );

  const bastionGeo = new THREE.CylinderGeometry(6.5, 7.2, wallHeight + 1.2, 8);
  [
    [-26, -26],
    [26, -26],
    [-26, 26],
    [26, 26]
  ].forEach(([bx, bz]) => {
    const bastion = new THREE.Mesh(bastionGeo, fortWallMat);
    bastion.position.set(bx, (wallHeight + 1.2) / 2, bz);
    bastion.castShadow = true;
    fortGroup.add(bastion);
  });

  const bridge = new THREE.Mesh(
    new THREE.BoxGeometry(10, 0.8, 16),
    new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.8 })
  );
  bridge.position.set(0, 0.4, 33);
  bridge.receiveShadow = true;
  fortGroup.add(bridge);

  const signTex = createSignTexture('പാലക്കാട് കോട്ട', 'PALAKKAD FORT & KOTTAMAITHANAM', '#7c2d12', '#ffffff', '#fbbf24');
  const signBoard = new THREE.Mesh(
    new THREE.BoxGeometry(9, 4.2, 0.3),
    new THREE.MeshStandardMaterial({ map: signTex })
  );
  signBoard.position.set(-14, 4.2, 42);
  fortGroup.add(signBoard);

  const maithanamGround = new THREE.Mesh(
    new THREE.CircleGeometry(24, 24),
    new THREE.MeshStandardMaterial({ color: 0xa16207, roughness: 0.95 })
  );
  maithanamGround.rotation.x = -Math.PI / 2;
  maithanamGround.position.set(-28, 0.06, 20);
  maithanamGround.receiveShadow = true;
  scene.add(maithanamGround);

  // Kottamaithanam Chai Stall
  const stallGroup = new THREE.Group();
  stallGroup.position.set(-22, 0, 16);
  const counter = new THREE.Mesh(
    new THREE.BoxGeometry(4.2, 1.2, 2.2),
    new THREE.MeshStandardMaterial({ color: 0x78350f, roughness: 0.85 })
  );
  counter.position.y = 0.6;
  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(3.4, 1.5, 4),
    new THREE.MeshStandardMaterial({ map: PROC_TEX.rooftile, roughness: 0.8 })
  );
  roof.position.y = 3.1;
  roof.rotation.y = Math.PI / 4;
  const samovar = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.75, 10), SHARED_MAT.gold);
  samovar.position.set(1.1, 1.55, 0);
  const chaiSign = new THREE.Mesh(
    new THREE.BoxGeometry(3.8, 0.9, 0.12),
    new THREE.MeshBasicMaterial({
      map: createSignTexture('ചായക്കട', 'KOTTAMAITHANAM CHAI STALL', '#78350f', '#ffffff', '#fde047')
    })
  );
  chaiSign.position.set(0, 2.35, 1.1);
  stallGroup.add(counter, roof, samovar, chaiSign);
  scene.add(stallGroup);

  scene.add(fortGroup);
}

function buildStadiumBusStand() {
  const standX = 120;
  const standZ = 125;
  const standGroup = new THREE.Group();
  standGroup.position.set(standX, 0, standZ);

  const apron = new THREE.Mesh(
    new THREE.PlaneGeometry(85, 75),
    new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.85 })
  );
  apron.rotation.x = -Math.PI / 2;
  apron.position.y = 0.06;
  apron.receiveShadow = true;
  standGroup.add(apron);

  const terminalRoof = new THREE.Mesh(
    new THREE.BoxGeometry(52, 1.5, 22),
    new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.6 })
  );
  terminalRoof.position.set(0, 8.5, 12);
  terminalRoof.castShadow = true;
  standGroup.add(terminalRoof);

  const terminalBack = new THREE.Mesh(
    new THREE.BoxGeometry(50, 8, 8),
    new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.7 })
  );
  terminalBack.position.set(0, 4, 18);
  terminalBack.castShadow = true;
  terminalBack.receiveShadow = true;
  standGroup.add(terminalBack);

  buildingColliders.push({
    minX: standX - 26,
    maxX: standX + 26,
    minZ: standZ + 13,
    maxZ: standZ + 23
  });

  const pillarGeo = new THREE.CylinderGeometry(0.45, 0.45, 8.5, 10);
  const pillarMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b });
  for (let px = -22; px <= 22; px += 11) {
    const pillar = new THREE.Mesh(pillarGeo, pillarMat);
    pillar.position.set(px, 4.25, 3);
    standGroup.add(pillar);
  }

  const busSignTex = createSignTexture(
    'സ്റ്റേഡിയം ബസ് സ്റ്റാൻഡ്, പാലക്കാട്',
    'STADIUM BUS STAND - PALAKKAD',
    '#065f46',
    '#ffffff',
    '#fde047'
  );
  const busSign = new THREE.Mesh(
    new THREE.BoxGeometry(28, 4.8, 0.4),
    new THREE.MeshStandardMaterial({ map: busSignTex })
  );
  busSign.position.set(0, 11.2, 2);
  standGroup.add(busSign);

  const shops = [
    { x: -52, z: -15, w: 18, h: 16, d: 18, color: 0x3b82f6, titleMl: 'പാലക്കാട് സിൽക്സ്', titleEn: 'PALAKKAD SILKS' },
    { x: -52, z: 15, w: 16, h: 12, d: 16, color: 0xd97706, titleMl: 'മലബാർ ബേക്കറി & ചായ', titleEn: 'MALABAR CHAI & BAKERY' },
    { x: 48, z: -12, w: 20, h: 18, d: 20, color: 0x10b981, titleMl: 'കേരള ബാങ്ക് & എടിഎം', titleEn: 'KERALA BANK & ATM' }
  ];

  shops.forEach((s) => {
    const bldg = new THREE.Mesh(
      new THREE.BoxGeometry(s.w, s.h, s.d),
      new THREE.MeshStandardMaterial({
        color: s.color,
        map: PROC_TEX.windows,
        roughness: 0.55
      })
    );
    bldg.position.set(s.x, s.h / 2, s.z);
    bldg.castShadow = true;
    bldg.receiveShadow = true;
    standGroup.add(bldg);

    const tex = createSignTexture(s.titleMl, s.titleEn, '#0f172a', '#ffffff', '#38bdf8');
    const board = new THREE.Mesh(
      new THREE.PlaneGeometry(s.w * 0.85, 3.2),
      new THREE.MeshBasicMaterial({ map: tex })
    );
    board.position.set(s.x, s.h - 2.2, s.z + s.d / 2 + 0.15);
    standGroup.add(board);

    buildingColliders.push({
      minX: standX + s.x - s.w / 2 - 1,
      maxX: standX + s.x + s.w / 2 + 1,
      minZ: standZ + s.z - s.d / 2 - 1,
      maxZ: standZ + s.z + s.d / 2 + 1
    });
  });

  scene.add(standGroup);
}

function buildMalampuzhaDamAndRopeway() {
  const damZ = -215;
  const damGroup = new THREE.Group();
  damGroup.position.set(0, 0, damZ);

  const damWall = new THREE.Mesh(
    new THREE.BoxGeometry(220, 24, 18),
    new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.85 })
  );
  damWall.position.set(0, 12, -18);
  damWall.castShadow = true;
  damWall.receiveShadow = true;
  damGroup.add(damWall);

  buildingColliders.push({
    minX: -110,
    maxX: 110,
    minZ: damZ - 28,
    maxZ: damZ - 8
  });

  const pillarGeo = new THREE.BoxGeometry(4, 28, 20);
  const pillarMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8 });
  const chuteGeo = new THREE.PlaneGeometry(13, 24);
  const chuteMat = new THREE.MeshStandardMaterial({
    map: PROC_TEX.water,
    color: 0x38bdf8,
    emissive: 0x0284c7,
    emissiveIntensity: 0.35,
    roughness: 0.15
  });

  for (let gx = -45; gx <= 45; gx += 18) {
    const pillar = new THREE.Mesh(pillarGeo, pillarMat);
    pillar.position.set(gx, 14, -18);
    damGroup.add(pillar);

    const waterChute = new THREE.Mesh(chuteGeo, chuteMat);
    waterChute.rotation.x = -Math.PI / 6;
    waterChute.position.set(gx + 9, 10, -6);
    damGroup.add(waterChute);
  }

  const frontCanal = new THREE.Mesh(
    new THREE.PlaneGeometry(140, 28),
    new THREE.MeshStandardMaterial({ map: PROC_TEX.water, roughness: 0.15, metalness: 0.5 })
  );
  frontCanal.rotation.x = -Math.PI / 2;
  frontCanal.position.set(0, 0.1, 4);
  damGroup.add(frontCanal);

  // Malampuzha Passenger Ropeway (Udan Khatola) Towers, Overhead Cable & Moving Gondola Cars
  const towerGeo = new THREE.CylinderGeometry(0.6, 1.4, 26, 8);
  const towerMat = new THREE.MeshStandardMaterial({ color: 0xdc2626, metalness: 0.5 });
  const westTower = new THREE.Mesh(towerGeo, towerMat);
  westTower.position.set(-55, 13, 18);
  const eastTower = new THREE.Mesh(towerGeo, towerMat);
  eastTower.position.set(55, 13, 18);
  damGroup.add(westTower, eastTower);

  const cableLine = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.08, 110, 6),
    new THREE.MeshBasicMaterial({ color: 0x1e293b })
  );
  cableLine.rotation.z = Math.PI / 2;
  cableLine.position.set(0, 25, 18);
  damGroup.add(cableLine);

  const cabinColors = [0xef4444, 0x3b82f6, 0xfacc15, 0x10b981];
  for (let c = 0; c < 4; c++) {
    const cabin = new THREE.Group();
    const hanger = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 2.2),
      new THREE.MeshBasicMaterial({ color: 0x334155 })
    );
    hanger.position.y = -1.1;
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(2.2, 1.8, 1.6),
      new THREE.MeshStandardMaterial({ color: cabinColors[c], roughness: 0.3, metalness: 0.3 })
    );
    box.position.y = -2.4;
    cabin.add(hanger, box);
    cabin.position.set(-40 + c * 26, 25, 18);
    damGroup.add(cabin);
    ropewayCabins.push({ mesh: cabin, phase: c * 1.5 });
  }

  // Malampuzha Garden & Iconic Yakshi Sculpture Monument (East Garden: 32, 26)
  const gardenLawn = new THREE.Mesh(
    new THREE.CircleGeometry(16, 24),
    new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.9 })
  );
  gardenLawn.rotation.x = -Math.PI / 2;
  gardenLawn.position.set(32, 0.08, 26);
  const pedestal = new THREE.Mesh(
    new THREE.CylinderGeometry(2.8, 3.4, 2.2, 12),
    new THREE.MeshStandardMaterial({ color: 0x475569 })
  );
  pedestal.position.set(32, 1.1, 26);
  const sculpture = new THREE.Mesh(
    new THREE.CapsuleGeometry(1.1, 4.2, 8, 12),
    new THREE.MeshStandardMaterial({ color: 0x57534e, roughness: 0.85 })
  );
  sculpture.position.set(32, 4.2, 26);
  damGroup.add(gardenLawn, pedestal, sculpture);

  const damSignTex = createSignTexture(
    'മലമ്പുഴ ഡാം & റോപ്പ് വേ',
    'MALAMPUZHA DAM, GARDENS & ROPEWAY',
    '#0c4a6e',
    '#ffffff',
    '#38bdf8'
  );
  const damSign = new THREE.Mesh(
    new THREE.BoxGeometry(19, 4.5, 0.4),
    new THREE.MeshStandardMaterial({ map: damSignTex })
  );
  damSign.position.set(-22, 4.5, 22);
  damGroup.add(damSign);

  const hillMat = new THREE.MeshStandardMaterial({ color: 0x1e3f20, roughness: 0.95 });
  [
    { x: -160, z: -70, r: 95, h: 120 },
    { x: -75, z: -85, r: 80, h: 105 },
    { x: 25, z: -90, r: 90, h: 130 },
    { x: 140, z: -75, r: 100, h: 115 }
  ].forEach((h) => {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(h.r, h.h, 12), hillMat);
    cone.position.set(h.x, h.h / 2 - 2, h.z);
    damGroup.add(cone);
  });

  scene.add(damGroup);
}

// --- ZONE 4: GOVT. VICTORIA COLLEGE HERITAGE CAMPUS (-135, -20) ---
function buildVictoriaCollegeCampus() {
  const vx = -138;
  const vz = -20;
  const vcGroup = new THREE.Group();
  vcGroup.position.set(vx, 0, vz);

  // Main Heritage Brick Building with Colonial Verandah & Pitched Mangalore Tile Roof
  const mainBlock = new THREE.Mesh(
    new THREE.BoxGeometry(16, 11, 46),
    new THREE.MeshStandardMaterial({ color: 0x991b1b, roughness: 0.8 })
  );
  mainBlock.position.set(-8, 5.5, 0);
  mainBlock.castShadow = true;
  mainBlock.receiveShadow = true;
  vcGroup.add(mainBlock);

  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(28, 5.5, 4),
    new THREE.MeshStandardMaterial({ map: PROC_TEX.rooftile, roughness: 0.75 })
  );
  roof.position.set(-8, 13.5, 0);
  roof.rotation.y = Math.PI / 4;
  roof.scale.set(0.55, 1, 1.35);
  vcGroup.add(roof);

  // Central Heritage Clock Tower
  const clockTower = new THREE.Mesh(
    new THREE.BoxGeometry(7, 17, 7),
    new THREE.MeshStandardMaterial({ color: 0x7f1d1d, roughness: 0.8 })
  );
  clockTower.position.set(-4, 8.5, 0);
  const spire = new THREE.Mesh(
    new THREE.ConeGeometry(5.2, 4.5, 4),
    new THREE.MeshStandardMaterial({ map: PROC_TEX.rooftile })
  );
  spire.position.set(-4, 19.2, 0);
  spire.rotation.y = Math.PI / 4;
  vcGroup.add(clockTower, spire);

  // White Colonial Pillars along Verandah
  const colGeo = new THREE.CylinderGeometry(0.35, 0.35, 10.5, 8);
  const colMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc });
  for (let cz = -20; cz <= 20; cz += 5) {
    const col = new THREE.Mesh(colGeo, colMat);
    col.position.set(1, 5.25, cz);
    vcGroup.add(col);
  }

  // Iconic Victoria College Entrance Archway facing the road
  const archLeft = new THREE.Mesh(new THREE.BoxGeometry(2.2, 7.5, 2.2), colMat);
  archLeft.position.set(14, 3.75, -6);
  const archRight = new THREE.Mesh(new THREE.BoxGeometry(2.2, 7.5, 2.2), colMat);
  archRight.position.set(14, 3.75, 6);
  const archSign = new THREE.Mesh(
    new THREE.BoxGeometry(1.2, 2.8, 15),
    new THREE.MeshStandardMaterial({
      map: createSignTexture('ഗവ. വിക്ടോറിയ കോളേജ്', 'GOVT. VICTORIA COLLEGE (EST. 1888)', '#7f1d1d', '#ffffff', '#fbbf24')
    })
  );
  archSign.position.set(14, 8.2, 0);
  vcGroup.add(archLeft, archRight, archSign);

  buildingColliders.push({
    minX: vx - 17,
    maxX: vx + 1,
    minZ: vz - 24,
    maxZ: vz + 24
  });

  scene.add(vcGroup);
}

// --- ZONE 5: PALAKKAD JUNCTION RAILWAY STATION - OLAVAKKODE (-138, -135) ---
function buildOlavakkodeRailwayStation() {
  const rx = -142;
  const rz = -135;
  const railGroup = new THREE.Group();
  railGroup.position.set(rx, 0, rz);

  // Station Terminal Building & Platform Canopy
  const stationBldg = new THREE.Mesh(
    new THREE.BoxGeometry(16, 10, 52),
    new THREE.MeshStandardMaterial({ color: 0xfef3c7, roughness: 0.75 })
  );
  stationBldg.position.set(-10, 5, 0);
  stationBldg.castShadow = true;
  railGroup.add(stationBldg);

  const platform = new THREE.Mesh(
    new THREE.BoxGeometry(14, 0.9, 64),
    new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.85 })
  );
  platform.position.set(2, 0.45, 0);
  railGroup.add(platform);

  // Yellow Indian Railways Signboard (PALAKKAD JUNCTION - OLAVAKKODE)
  const irSign = new THREE.Mesh(
    new THREE.BoxGeometry(1.2, 3.4, 24),
    new THREE.MeshBasicMaterial({
      map: createSignTexture('പാലക്കാട് ജംഗ്ഷൻ', 'PALAKKAD JN (OLAVAKKODE)', '#facc15', '#09090b', '#1e3a8a')
    })
  );
  irSign.position.set(-1.5, 11.5, 0);
  railGroup.add(irSign);

  // Railway Track & Stationary Blue/Red Indian Railways Express Train
  const trainGroup = new THREE.Group();
  trainGroup.position.set(11, 0.6, 0);

  // WAP-7 Electric Locomotive Engine (Red/White)
  const loco = new THREE.Mesh(
    new THREE.BoxGeometry(3.4, 4.1, 14),
    new THREE.MeshStandardMaterial({ color: 0xdc2626, metalness: 0.35, roughness: 0.4 })
  );
  loco.position.set(0, 2.05, 20);
  loco.castShadow = true;
  trainGroup.add(loco);

  // 2 Blue ICF/LHB Passenger Coaches
  const coachMat = new THREE.MeshStandardMaterial({ color: 0x1d4ed8, roughness: 0.45 });
  [-1, -21].forEach((cz) => {
    const coach = new THREE.Mesh(new THREE.BoxGeometry(3.3, 3.9, 18), coachMat);
    coach.position.set(0, 1.95, cz);
    coach.castShadow = true;
    trainGroup.add(coach);
  });

  railGroup.add(trainGroup);

  buildingColliders.push({
    minX: rx - 18,
    maxX: rx + 14,
    minZ: rz - 32,
    maxZ: rz + 32
  });

  scene.add(railGroup);
}

// --- ZONE 6: KALPATHY HERITAGE AGRAHARAM & CHARIOT STREET (135, -60) ---
function buildKalpathyAgraharam() {
  const kx = 135;
  const kz = -60;
  const kalpathyGroup = new THREE.Group();
  kalpathyGroup.position.set(kx, 0, kz);

  // Row of Traditional Tamil Brahmin Agraharam Houses (North & South Rows with Pitched Tiled Roofs)
  const houseColors = [0xfef08a, 0xbae6fd, 0xfed7aa, 0xd9f99d];
  for (let i = 0; i < 4; i++) {
    const hx = -18 + i * 11;
    [-16, 16].forEach((hz, sideIdx) => {
      const wall = new THREE.Mesh(
        new THREE.BoxGeometry(10.5, 5.5, 11),
        new THREE.MeshStandardMaterial({ color: houseColors[(i + sideIdx) % houseColors.length], roughness: 0.8 })
      );
      wall.position.set(hx, 2.75, hz);
      wall.castShadow = true;

      const roof = new THREE.Mesh(
        new THREE.ConeGeometry(8.5, 3.2, 4),
        new THREE.MeshStandardMaterial({ map: PROC_TEX.rooftile })
      );
      roof.position.set(hx, 7.1, hz);
      roof.rotation.y = Math.PI / 4;
      kalpathyGroup.add(wall, roof);
    });
  }

  // Kalpathy Viswanatha Swamy Temple Gopuram at the East End (x + 28)
  const gopuramBase = new THREE.Mesh(
    new THREE.BoxGeometry(12, 6, 14),
    new THREE.MeshStandardMaterial({ color: 0xfde047, roughness: 0.75 })
  );
  gopuramBase.position.set(28, 3, 0);
  const gopuramTower = new THREE.Mesh(
    new THREE.ConeGeometry(8.5, 16, 4),
    new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.65 })
  );
  gopuramTower.position.set(28, 14, 0);
  gopuramTower.rotation.y = Math.PI / 4;
  kalpathyGroup.add(gopuramBase, gopuramTower);

  // Iconic Wooden Kalpathy Ratholsavam Temple Chariot (Ratham) parked on Chariot Street
  const chariotGroup = new THREE.Group();
  chariotGroup.position.set(4, 0, 0);
  const rathBase = new THREE.Mesh(
    new THREE.CylinderGeometry(3.2, 2.4, 4.5, 8),
    new THREE.MeshStandardMaterial({ color: 0x78350f, roughness: 0.8 })
  );
  rathBase.position.y = 3.2;
  const rathCanopy = new THREE.Mesh(
    new THREE.ConeGeometry(4.2, 6.5, 8),
    new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.6 })
  );
  rathCanopy.position.y = 8.5;
  const rathKalasam = new THREE.Mesh(new THREE.SphereGeometry(0.6, 10, 10), SHARED_MAT.gold);
  rathKalasam.position.y = 12.0;
  chariotGroup.add(rathBase, rathCanopy, rathKalasam);

  // Massive Wooden Chariot Wheels
  const rathWheelGeo = new THREE.CylinderGeometry(1.3, 1.3, 0.35, 12);
  rathWheelGeo.rotateX(Math.PI / 2);
  const rathWheelMat = new THREE.MeshStandardMaterial({ color: 0x451a03 });
  [
    [-1.8, 1.3, 2.4],
    [1.8, 1.3, 2.4],
    [-1.8, 1.3, -2.4],
    [1.8, 1.3, -2.4]
  ].forEach(([wx, wy, wz]) => {
    const rw = new THREE.Mesh(rathWheelGeo, rathWheelMat);
    rw.position.set(wx, wy, wz);
    chariotGroup.add(rw);
  });
  kalpathyGroup.add(chariotGroup);

  const kalpathySign = new THREE.Mesh(
    new THREE.BoxGeometry(14, 3.8, 0.35),
    new THREE.MeshBasicMaterial({
      map: createSignTexture('കൽപ്പാത്തി അഗ്രഹാരം', 'KALPATHY HERITAGE VILLAGE & CHARIOT', '#7c2d12', '#ffffff', '#facc15')
    })
  );
  kalpathySign.position.set(-22, 4.2, 9);
  kalpathyGroup.add(kalpathySign);

  buildingColliders.push(
    { minX: kx - 24, maxX: kx + 20, minZ: kz - 22, maxZ: kz - 10 },
    { minX: kx - 24, maxX: kx + 20, minZ: kz + 10, maxZ: kz + 22 },
    { minX: kx + 21, maxX: kx + 35, minZ: kz - 8, maxZ: kz + 8 }
  );

  scene.add(kalpathyGroup);
}

// --- GPU-INSTANCED TREES, PALMYRA PALMS & STREET LAMPS ---
function populateInstancedTreesAndLamps() {
  for (let z = -175; z <= 90; z += 42) {
    streetLampPositions.push({ x: -9, z });
    streetLampPositions.push({ x: 9, z });
  }
  for (let x = -110; x <= 115; x += 38) {
    streetLampPositions.push({ x, z: 31 });
    streetLampPositions.push({ x, z: 49 });
  }

  const lampCount = streetLampPositions.length;
  const poleInst = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.12, 0.16, 7.5, 8),
    new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.6 }),
    lampCount
  );
  const bulbInst = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.36, 8, 8),
    streetBulbMat,
    lampCount
  );

  streetLampPositions.forEach((pos, idx) => {
    _dummyObj.position.set(pos.x, 3.75, pos.z);
    _dummyObj.rotation.set(0, 0, 0);
    _dummyObj.scale.set(1, 1, 1);
    _dummyObj.updateMatrix();
    poleInst.setMatrixAt(idx, _dummyObj.matrix);

    _dummyObj.position.set(pos.x, 7.6, pos.z);
    _dummyObj.updateMatrix();
    bulbInst.setMatrixAt(idx, _dummyObj.matrix);
  });
  scene.add(poleInst, bulbInst);

  const coconutCoords = [];
  const palmCoords = [];
  for (let i = 0; i < 130; i++) {
    const x = (Math.random() - 0.5) * 380;
    const z = (Math.random() - 0.5) * 400;
    if (Math.abs(x) < 16) continue;
    if (Math.abs(x + 115) < 16) continue;
    if (z > 24 && z < 56 && x > -150 && x < 145) continue;
    if (z > -75 && z < -45 && x > 0 && x < 165) continue;
    if (x > -44 && x < 44 && z > -78 && z < 14) continue;

    if (i % 3 === 0) {
      palmCoords.push({ x, z, scale: 0.9 + Math.random() * 0.3 });
    } else {
      coconutCoords.push({ x, z, scale: 0.85 + Math.random() * 0.45 });
    }
  }

  const cocoTrunkInst = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.22, 0.42, 8.5, 7),
    new THREE.MeshStandardMaterial({ color: 0x5c4033, roughness: 0.9 }),
    coconutCoords.length
  );
  const cocoCrownInst = new THREE.InstancedMesh(
    new THREE.DodecahedronGeometry(2.6, 1),
    new THREE.MeshStandardMaterial({ color: 0x2d6a4f, roughness: 0.8 }),
    coconutCoords.length
  );

  coconutCoords.forEach((c, idx) => {
    _dummyObj.position.set(c.x, 4.25 * c.scale, c.z);
    _dummyObj.rotation.set(0, idx, 0);
    _dummyObj.scale.set(c.scale, c.scale, c.scale);
    _dummyObj.updateMatrix();
    cocoTrunkInst.setMatrixAt(idx, _dummyObj.matrix);

    _dummyObj.position.set(c.x, 8.4 * c.scale, c.z);
    _dummyObj.scale.set(c.scale * 1.25, c.scale * 0.65, c.scale * 1.25);
    _dummyObj.updateMatrix();
    cocoCrownInst.setMatrixAt(idx, _dummyObj.matrix);
  });
  scene.add(cocoTrunkInst, cocoCrownInst);

  const palmTrunkInst = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.28, 0.48, 12, 7),
    new THREE.MeshStandardMaterial({ color: 0x27272a, roughness: 0.95 }),
    palmCoords.length
  );
  const palmCrownInst = new THREE.InstancedMesh(
    new THREE.DodecahedronGeometry(2.3, 1),
    new THREE.MeshStandardMaterial({ color: 0x1b4332, roughness: 0.85 }),
    palmCoords.length
  );

  palmCoords.forEach((p, idx) => {
    _dummyObj.position.set(p.x, 6 * p.scale, p.z);
    _dummyObj.rotation.set(0, 0, 0);
    _dummyObj.scale.set(p.scale, p.scale, p.scale);
    _dummyObj.updateMatrix();
    palmTrunkInst.setMatrixAt(idx, _dummyObj.matrix);

    _dummyObj.position.set(p.x, 12.2 * p.scale, p.z);
    _dummyObj.updateMatrix();
    palmCrownInst.setMatrixAt(idx, _dummyObj.matrix);
  });
  scene.add(palmTrunkInst, palmCrownInst);
}

// --- CREATE LOCAL PLAYER ---
const localPlayer = {
  rig: createCharacterRig(state.customization, state.playerName, true),
  x: 0,
  y: 0,
  z: 18,
  vy: 0,
  rotY: 0,
  onGround: true,
  anim: 'idle'
};
localPlayer.rig.mesh.position.set(localPlayer.x, localPlayer.y, localPlayer.z);
scene.add(localPlayer.rig.mesh);

// --- EXPANDED 14 LIVING PALAKKAD NPCs ACROSS ALL 6 ZONES ---
const npcs = [];

const NPC_CONFIGS = [
  {
    name: 'Rajan Ettan',
    role: 'Chai Master',
    stationary: true,
    x: -22,
    z: 18.2,
    rotY: 0,
    custom: { shirtColor: '#f59e0b', bottomType: 'mundu', skinColor: '#b87333', sunglasses: false },
    dialogues: [
      'ചൂട് ചായയും പഴംപൊരിയും റെഡി! (Hot Chai & Pazhampori ready!)',
      'കോട്ടമൈതാനത്ത് ഇന്ന് നല്ല തിരക്കാണല്ലോ!',
      'മലമ്പുഴ ഡാമിലേക്ക് ബസ് സ്റ്റാൻഡിൽ നിന്ന് KSRTC ഉണ്ട്!'
    ]
  },
  {
    name: 'Achu PKD',
    role: 'College Student',
    waypoints: [
      { x: -12, z: 14 },
      { x: 12, z: 14 },
      { x: 12, z: 28 },
      { x: -12, z: 28 }
    ],
    speed: 3.2,
    custom: { shirtColor: '#ef4444', bottomType: 'jeans', bottomColor: '#1e293b', skinColor: '#c68642', sunglasses: true },
    dialogues: [
      'Bro, that Royal 350 bike sounds sick!',
      'Heading to Victoria College side after a quick chai.',
      'Nice jeans and shades machane!'
    ]
  },
  {
    name: 'Unni Krishnan',
    role: 'Fort Tourist',
    waypoints: [
      { x: 0, z: 6 },
      { x: 0, z: -28 },
      { x: -15, z: -38 },
      { x: 15, z: -38 },
      { x: 0, z: 6 }
    ],
    speed: 2.8,
    custom: { shirtColor: '#10b981', bottomType: 'mundu', skinColor: '#c68642', sunglasses: false },
    dialogues: [
      'Tipu Sultan’s Palakkad Fort laterite walls and Hanuman temple are iconic!',
      'Have you seen the moat around the fort?',
      'Great weather in Palakkad today!'
    ]
  },
  {
    name: 'Shaji Komban',
    role: 'Bus Agent',
    waypoints: [
      { x: 102, z: 108 },
      { x: 128, z: 108 },
      { x: 128, z: 122 },
      { x: 102, z: 122 }
    ],
    speed: 3.5,
    custom: { shirtColor: '#a16207', bottomType: 'colored_mundu', bottomColor: '#78350f', skinColor: '#b87333', sunglasses: true },
    dialogues: [
      'മലമ്പുഴ, കോട്ടമൈതാനം, ഒലവക്കോട് ബസ് ഉടൻ എടുക്കും! കേറിക്കോ!',
      'Press M to start the Stadium-to-Malampuzha bus job and earn ₹1,500!',
      'Komban tourist bus is parked ready for a trip!'
    ]
  },
  {
    name: 'Meera & Rahul',
    role: 'Dam Visitor',
    waypoints: [
      { x: -18, z: -182 },
      { x: 24, z: -182 },
      { x: 24, z: -195 },
      { x: -18, z: -195 }
    ],
    speed: 2.6,
    custom: { shirtColor: '#8b5cf6', bottomType: 'jeans', bottomColor: '#0f172a', skinColor: '#d2996c', sunglasses: true },
    dialogues: [
      'Look up! The Malampuzha Ropeway cable cars are moving across the dam!',
      'Watch the water rushing down the spillway gates!',
      'Don’t miss the Yakshi Garden monument right next to the dam.'
    ]
  },
  {
    name: 'Deepak KL-09',
    role: 'Town Commuter',
    waypoints: [
      { x: 8, z: 34 },
      { x: 85, z: 34 },
      { x: 85, z: 46 },
      { x: 8, z: 46 }
    ],
    speed: 3.6,
    custom: { shirtColor: '#0284c7', bottomType: 'jeans', bottomColor: '#1e3a8a', skinColor: '#c68642', sunglasses: true },
    dialogues: [
      'Walking down the main road to Stadium Bus Stand!',
      'Watch out for the speeding tourist buses on this road!',
      'Collect the green ₹ crystals to upgrade your outfit.'
    ]
  },
  {
    name: 'Prof. Madhavan',
    role: 'Victoria Faculty',
    waypoints: [
      { x: -120, z: -35 },
      { x: -120, z: -5 },
      { x: -132, z: -5 },
      { x: -132, z: -35 }
    ],
    speed: 2.4,
    custom: { shirtColor: '#f8fafc', bottomType: 'mundu', skinColor: '#b87333', sunglasses: false },
    dialogues: [
      'Welcome to Govt. Victoria College Palakkad, founded in 1888!',
      'Generations of writers and artists walked down this heritage verandah.',
      'The road north from here goes straight to Olavakkode Railway Junction.'
    ]
  },
  {
    name: 'Sneha V.',
    role: 'Victoria Student',
    waypoints: [
      { x: -118, z: 10 },
      { x: -95, z: 32 },
      { x: -118, z: 32 }
    ],
    speed: 3.3,
    custom: { shirtColor: '#ec4899', bottomType: 'jeans', bottomColor: '#1e3a8a', skinColor: '#d2996c', sunglasses: true },
    dialogues: [
      'Just finished classes at Victoria College! Waiting for friends near the arch.',
      'Have you visited Kalpathy Heritage Village on the east side yet?',
      'You can fast-travel anywhere using the Mapbox GPS panel!'
    ]
  },
  {
    name: 'Narayanan Iyer',
    role: 'Kalpathy Elder',
    waypoints: [
      { x: 115, z: -55 },
      { x: 148, z: -55 },
      { x: 148, z: -65 },
      { x: 115, z: -65 }
    ],
    speed: 2.3,
    custom: { shirtColor: '#fde047', bottomType: 'mundu', skinColor: '#c68642', sunglasses: false },
    dialogues: [
      'നമസ്കാരം! Welcome to Kalpathy Heritage Agraharam street.',
      'Look at the grand wooden Kalpathy Ratholsavam temple chariot parked ahead!',
      'Every November, thousands gather here to pull the sacred chariots.'
    ]
  },
  {
    name: 'Subramani',
    role: 'Festival Drummer',
    stationary: true,
    x: 136,
    z: -54,
    rotY: 0,
    custom: { shirtColor: '#dc2626', bottomType: 'mundu', skinColor: '#b87333', sunglasses: true },
    dialogues: [
      'Kalpathy Ratholsavam vibe is unmatched in Palakkad!',
      'Check out the Viswanatha Swamy Temple Gopuram at the end of the street.',
      'Grab the ₹650 cash pickup near the temple chariot!'
    ]
  },
  {
    name: 'Mathew Thomas',
    role: 'Station Master',
    stationary: true,
    x: -136,
    z: -135,
    rotY: Math.PI / 2,
    custom: { shirtColor: '#f8fafc', bottomType: 'jeans', bottomColor: '#0f172a', skinColor: '#c68642', sunglasses: true },
    dialogues: [
      'Welcome to Palakkad Junction (Olavakkode) Railway Station!',
      'The Nilgiri Express is currently halted on Platform 1.',
      'Take the yellow Autorickshaw or KSRTC outside to head back into town!'
    ]
  },
  {
    name: 'Faisal PKD',
    role: 'Rail Traveller',
    waypoints: [
      { x: -138, z: -115 },
      { x: -138, z: -155 },
      { x: -124, z: -155 },
      { x: -124, z: -115 }
    ],
    speed: 3.1,
    custom: { shirtColor: '#14b8a6', bottomType: 'jeans', bottomColor: '#1e293b', skinColor: '#c68642', sunglasses: false },
    dialogues: [
      'Just arrived at Olavakkode Junction from Chennai!',
      'Going to take a quick ride up to Malampuzha Dam.',
      'Palakkad railway junction is one of the busiest hubs in Kerala.'
    ]
  },
  {
    name: 'Kabeer Bhai',
    role: 'Auto Stand Driver',
    stationary: true,
    x: 92,
    z: 98,
    rotY: -Math.PI / 4,
    custom: { shirtColor: '#ca8a04', bottomType: 'jeans', bottomColor: '#1e3a8a', skinColor: '#b87333', sunglasses: true },
    dialogues: [
      'ഓട്ടോ വേണോ മച്ചാനെ? (Need an auto, bro?) Hop into any vehicle with F!',
      'Stadium Bus Stand is packed with KSRTC and private buses today.',
      'Try driving the Kerala Autorickshaw parked near Victoria College!'
    ]
  },
  {
    name: 'Gopalan Nair',
    role: 'Morning Walker',
    waypoints: [
      { x: -34, z: 8 },
      { x: -34, z: 32 },
      { x: -18, z: 32 },
      { x: -18, z: 8 }
    ],
    speed: 2.7,
    custom: { shirtColor: '#38bdf8', bottomType: 'mundu', skinColor: '#c68642', sunglasses: false },
    dialogues: [
      'Nothing beats an evening walk around Kottamaithanam and a cup of Rajan Ettan’s chai!',
      'Have you explored all 6 Palakkad zones yet?',
      'Press C anytime to customize your jeans, shirt, or sunglasses!'
    ]
  }
];

function spawnPalakkadNPCs() {
  NPC_CONFIGS.forEach((cfg) => {
    const startX = cfg.stationary ? cfg.x : cfg.waypoints[0].x;
    const startZ = cfg.stationary ? cfg.z : cfg.waypoints[0].z;
    const rig = createCharacterRig(cfg.custom, cfg.name, false, cfg.role);
    rig.mesh.position.set(startX, 0, startZ);
    rig.mesh.rotation.y = cfg.rotY || 0;
    scene.add(rig.mesh);

    npcs.push({
      ...cfg,
      rig,
      x: startX,
      z: startZ,
      rotY: cfg.rotY || 0,
      wpIndex: 1,
      dialogueIdx: 0
    });
  });

  // Load animated glTF Guard (`Soldier.glb`) at Palakkad Fort Bridge
  const gltfLoader = new GLTFLoader();
  gltfLoader.load(
    'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/gltf/Soldier.glb',
    (gltf) => {
      const guard = gltf.scene;
      guard.scale.set(1.35, 1.35, 1.35);
      guard.position.set(4.5, 0.4, -4);
      guard.traverse((child) => {
        if (child.isMesh) child.castShadow = true;
      });
      scene.add(guard);
    },
    undefined,
    () => {}
  );
}

function updateNPCs(dt, elapsed, playerX, playerZ) {
  let closestNpc = null;
  let minNpcDist = 4.6;

  for (let i = 0; i < npcs.length; i++) {
    const npc = npcs[i];
    const distToPlayer = Math.hypot(npc.x - playerX, npc.z - playerZ);

    npc.rig.mesh.visible = distToPlayer < 200;
    if (!npc.rig.mesh.visible) continue;

    if (distToPlayer < minNpcDist) {
      minNpcDist = distToPlayer;
      closestNpc = npc;
    }

    if (npc.stationary || distToPlayer < 3.6) {
      if (distToPlayer < 5.0) {
        npc.rotY = Math.atan2(playerX - npc.x, playerZ - npc.z);
        npc.rig.mesh.rotation.y = npc.rotY;
      }
      npc.rig.animateLimbs('idle', elapsed + i);
      continue;
    }

    const target = npc.waypoints[npc.wpIndex];
    const dx = target.x - npc.x;
    const dz = target.z - npc.z;
    const dist = Math.hypot(dx, dz);

    if (dist < 0.8) {
      npc.wpIndex = (npc.wpIndex + 1) % npc.waypoints.length;
    } else {
      npc.rotY = Math.atan2(dx, dz);
      npc.x += (dx / dist) * npc.speed * dt;
      npc.z += (dz / dist) * npc.speed * dt;
      npc.rig.mesh.position.set(npc.x, 0, npc.z);
      npc.rig.mesh.rotation.y = npc.rotY;
      npc.rig.animateLimbs('walk', elapsed + i);
    }
  }

  state.nearbyNpc = closestNpc;
}

// --- VEHICLES SYSTEM (BUSES, SUVS, BIKES, KERALA AUTORICKSHAW & AI TRAFFIC) ---
const vehicles = [];

function createVehicle({ id, name, type, x, z, rotY = 0, primaryColor, secondaryColor, maxSpeed, accel, isAI = false, aiWaypoints = [] }) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  group.rotation.y = rotY;

  const wheels = [];
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.9 });
  const tailLightMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });

  if (type === 'bus' || type === 'ksrtc') {
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(3.4, 3.3, 10.5),
      new THREE.MeshStandardMaterial({ color: primaryColor, roughness: 0.35, metalness: 0.25 })
    );
    body.position.y = 2.15;
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(3.45, 0.55, 10.55),
      new THREE.MeshStandardMaterial({ color: secondaryColor, roughness: 0.45 })
    );
    stripe.position.y = 1.4;
    group.add(stripe);

    const windshield = new THREE.Mesh(
      new THREE.PlaneGeometry(3.0, 1.4),
      new THREE.MeshStandardMaterial({ color: 0x0f172a, metalness: 0.85, roughness: 0.12 })
    );
    windshield.position.set(0, 2.55, 5.26);
    group.add(windshield);

    const destTex = createSignTexture(
      type === 'ksrtc' ? 'പാലക്കാട് - മലമ്പുഴ' : 'കൊമ്പൻ - പാലക്കാട്',
      type === 'ksrtc' ? 'KSRTC FAST PASSENGER' : 'KOMBAN TOURIST EXPRESS',
      '#09090b',
      '#22c55e',
      '#f59e0b'
    );
    const destBoard = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 0.55),
      new THREE.MeshBasicMaterial({ map: destTex })
    );
    destBoard.position.set(0, 3.45, 5.27);
    group.add(destBoard);

    const tailL = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.25, 0.1), tailLightMat);
    tailL.position.set(-1.2, 1.2, -5.26);
    const tailR = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.25, 0.1), tailLightMat);
    tailR.position.set(1.2, 1.2, -5.26);
    group.add(tailL, tailR);

    const wGeo = new THREE.CylinderGeometry(0.62, 0.62, 0.45, 14);
    wGeo.rotateZ(Math.PI / 2);
    [
      [-1.65, 0.62, 3.2],
      [1.65, 0.62, 3.2],
      [-1.65, 0.62, -3.2],
      [1.65, 0.62, -3.2]
    ].forEach(([wx, wy, wz]) => {
      const w = new THREE.Mesh(wGeo, wheelMat);
      w.position.set(wx, wy, wz);
      group.add(w);
      wheels.push(w);
    });
  } else if (type === 'car') {
    const chassis = new THREE.Mesh(
      new THREE.BoxGeometry(2.3, 1.0, 4.8),
      new THREE.MeshStandardMaterial({ color: primaryColor, metalness: 0.55, roughness: 0.22 })
    );
    chassis.position.y = 0.9;
    chassis.castShadow = true;
    group.add(chassis);

    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(2.0, 0.85, 2.5),
      new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.8, roughness: 0.15 })
    );
    cabin.position.set(0, 1.75, -0.2);
    cabin.castShadow = true;
    group.add(cabin);

    const tailBar = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.16, 0.1), tailLightMat);
    tailBar.position.set(0, 1.05, -2.41);
    group.add(tailBar);

    const wGeo = new THREE.CylinderGeometry(0.44, 0.44, 0.34, 14);
    wGeo.rotateZ(Math.PI / 2);
    [
      [-1.15, 0.44, 1.5],
      [1.15, 0.44, 1.5],
      [-1.15, 0.44, -1.5],
      [1.15, 0.44, -1.5]
    ].forEach(([wx, wy, wz]) => {
      const w = new THREE.Mesh(wGeo, wheelMat);
      w.position.set(wx, wy, wz);
      group.add(w);
      wheels.push(w);
    });
  } else if (type === 'auto') {
    // Iconic Black & Yellow Kerala Autorickshaw
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(1.55, 1.1, 2.7),
      new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.5 })
    );
    body.position.y = 0.85;
    body.castShadow = true;
    const canopy = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 0.85, 2.5),
      new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.4 })
    );
    canopy.position.set(0, 1.75, -0.05);
    group.add(body, canopy);

    const wGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.22, 12);
    wGeo.rotateZ(Math.PI / 2);
    [
      [0, 0.32, 1.05],
      [-0.78, 0.32, -0.95],
      [0.78, 0.32, -0.95]
    ].forEach(([wx, wy, wz]) => {
      const w = new THREE.Mesh(wGeo, wheelMat);
      w.position.set(wx, wy, wz);
      group.add(w);
      wheels.push(w);
    });
  } else if (type === 'bike') {
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(0.45, 0.75, 2.1),
      new THREE.MeshStandardMaterial({ color: primaryColor, metalness: 0.6, roughness: 0.3 })
    );
    frame.position.y = 0.85;
    frame.castShadow = true;
    group.add(frame);

    const handleBar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 0.95, 8),
      new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.8 })
    );
    handleBar.rotation.z = Math.PI / 2;
    handleBar.position.set(0, 1.35, 0.65);
    group.add(handleBar);

    const wGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.18, 14);
    wGeo.rotateZ(Math.PI / 2);
    [
      [0, 0.42, 0.85],
      [0, 0.42, -0.85]
    ].forEach(([wx, wy, wz]) => {
      const w = new THREE.Mesh(wGeo, wheelMat);
      w.position.set(wx, wy, wz);
      group.add(w);
      wheels.push(w);
    });
  }

  const headLight = new THREE.SpotLight(0xfffbeb, 0, 50, Math.PI / 5, 0.4, 1.2);
  const frontZ = type === 'bus' || type === 'ksrtc' ? 5.3 : type === 'car' ? 2.4 : 1.3;
  headLight.position.set(0, 1.2, frontZ);
  headLight.target.position.set(0, 0.2, frontZ + 22);
  group.add(headLight);
  group.add(headLight.target);

  scene.add(group);

  const vehicleObj = {
    id,
    name,
    type,
    mesh: group,
    wheels,
    headLight,
    lightsOn: true,
    x,
    y: 0,
    z,
    rotY,
    speed: 0,
    maxSpeed,
    accel,
    driverId: null,
    isAI,
    aiWaypoints,
    aiWpIdx: 0
  };

  vehicles.push(vehicleObj);
  return vehicleObj;
}

function spawnPalakkadVehicles() {
  createVehicle({
    id: 'v_car_1',
    name: 'Palakkad Tuner SUV (KL-09)',
    type: 'car',
    x: 10,
    z: 16,
    rotY: Math.PI,
    primaryColor: 0x2563eb,
    secondaryColor: 0xffffff,
    maxSpeed: 38,
    accel: 22
  });

  createVehicle({
    id: 'v_bike_1',
    name: 'Royal Classic 350 (KL-09)',
    type: 'bike',
    x: -7,
    z: 18,
    rotY: Math.PI,
    primaryColor: 0x991b1b,
    secondaryColor: 0x000000,
    maxSpeed: 42,
    accel: 28
  });

  createVehicle({
    id: 'v_bus_komban',
    name: 'Komban Tourist Bus (KL-09)',
    type: 'bus',
    x: 12,
    z: 36,
    rotY: Math.PI / 2,
    primaryColor: 0x10b981,
    secondaryColor: 0xfacc15,
    maxSpeed: 32,
    accel: 15
  });

  createVehicle({
    id: 'v_bus_ksrtc',
    name: 'KSRTC Fast Passenger (Anavandi)',
    type: 'ksrtc',
    x: 112,
    z: 112,
    rotY: Math.PI,
    primaryColor: 0xdc2626,
    secondaryColor: 0xfacc15,
    maxSpeed: 34,
    accel: 16
  });

  createVehicle({
    id: 'v_car_dam',
    name: 'Malampuzha Cruiser Jeep (KL-09)',
    type: 'car',
    x: 14,
    z: -175,
    rotY: 0,
    primaryColor: 0xd97706,
    secondaryColor: 0x1e293b,
    maxSpeed: 38,
    accel: 22
  });

  createVehicle({
    id: 'v_auto_victoria',
    name: 'Kerala Autorickshaw (KL-09)',
    type: 'auto',
    x: -108,
    z: -10,
    rotY: 0,
    primaryColor: 0xfacc15,
    secondaryColor: 0x18181b,
    maxSpeed: 30,
    accel: 24
  });

  // Autonomous AI Vehicles cruising Palakkad highways
  createVehicle({
    id: 'v_npc_taxi',
    name: 'Palakkad Town Taxi (AI)',
    type: 'car',
    x: -4,
    z: -45,
    rotY: Math.PI,
    primaryColor: 0xfacc15,
    secondaryColor: 0x18181b,
    maxSpeed: 35,
    accel: 20,
    isAI: true,
    aiWaypoints: [
      { x: -4, z: -165 },
      { x: 4, z: -165 },
      { x: 4, z: 35 },
      { x: -4, z: 35 }
    ]
  });

  createVehicle({
    id: 'v_npc_auto_town',
    name: 'Town Savari Auto (AI)',
    type: 'auto',
    x: 45,
    z: 36,
    rotY: Math.PI / 2,
    primaryColor: 0xfacc15,
    secondaryColor: 0x18181b,
    maxSpeed: 28,
    accel: 20,
    isAI: true,
    aiWaypoints: [
      { x: 112, z: 36 },
      { x: 112, z: 44 },
      { x: -105, z: 44 },
      { x: -105, z: 36 }
    ]
  });

  createVehicle({
    id: 'v_npc_olavakkode_bus',
    name: 'Olavakkode Town Bus (AI)',
    type: 'ksrtc',
    x: -115,
    z: -60,
    rotY: Math.PI,
    primaryColor: 0xdc2626,
    secondaryColor: 0xfacc15,
    maxSpeed: 32,
    accel: 16,
    isAI: true,
    aiWaypoints: [
      { x: -118, z: -120 },
      { x: -112, z: -120 },
      { x: -112, z: 32 },
      { x: -118, z: 32 }
    ]
  });
}

// --- FLOATING CASH BUNDLES ACROSS ALL 6 ZONES ---
const cashPickups = [];

function spawnCashPickups() {
  const spots = [
    { x: 0, z: -15, amount: 500 },
    { x: -24, z: 22, amount: 350 },
    { x: 60, z: 40, amount: 400 },
    { x: 120, z: 105, amount: 750 },
    { x: 0, z: -120, amount: 600 },
    { x: 0, z: -185, amount: 1000 },
    { x: -118, z: -18, amount: 550 },
    { x: -122, z: -132, amount: 800 },
    { x: 132, z: -60, amount: 650 }
  ];

  const geo = new THREE.OctahedronGeometry(0.85, 0);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x10b981,
    emissive: 0x059669,
    emissiveIntensity: 0.6,
    metalness: 0.4,
    roughness: 0.2
  });

  spots.forEach((s) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(s.x, 1.4, s.z);
    scene.add(mesh);
    cashPickups.push({ mesh, x: s.x, z: s.z, amount: s.amount, collectedAt: 0 });
  });
}

const checkpointMesh = new THREE.Mesh(
  new THREE.CylinderGeometry(4.5, 4.5, 14, 20, 1, true),
  new THREE.MeshBasicMaterial({
    color: 0x22c55e,
    transparent: true,
    opacity: 0.38,
    side: THREE.DoubleSide
  })
);
checkpointMesh.visible = false;
scene.add(checkpointMesh);

const MISSIONS = {
  bus_route: {
    title: '🚌 PALAKKAD ROUTE EXPRESS',
    reward: 1500,
    waypoints: [
      { x: 115, z: 110, desc: 'Drive to Stadium Bus Stand Passenger Bay!' },
      { x: 10, z: 38, desc: 'Pick up passengers at Kottamaithanam Stop!' },
      { x: -115, z: -18, desc: 'Stop at Govt. Victoria College Arch!' },
      { x: 0, z: -175, desc: 'Drop tourists at Malampuzha Dam Viewpoint!' }
    ]
  },
  delivery_route: {
    title: '🏍️ PALAKKAD CHAI & SNACKS DELIVERY',
    reward: 900,
    waypoints: [
      { x: -25, z: 20, desc: 'Collect hot Pazhampori & Chai at Kottamaithanam!' },
      { x: 125, z: -60, desc: 'Deliver snacks to Kalpathy Heritage Agraharam!' },
      { x: 95, z: 110, desc: 'Deliver final order at Stadium Bus Stand!' }
    ]
  },
  dam_tour: {
    title: '🌊 OLAVAKKODE ➔ MALAMPUZHA TOUR',
    reward: 1200,
    waypoints: [
      { x: -115, z: -125, desc: 'Pick up tourists arriving at Olavakkode Railway Junction!' },
      { x: 0, z: -182, desc: 'Drive up to Malampuzha Dam & Ropeway Viewpoint!' },
      { x: 0, z: 18, desc: 'Return safely to Palakkad Fort Plaza!' }
    ]
  }
};

function startMission(jobKey) {
  const job = MISSIONS[jobKey];
  if (!job) return;
  state.activeMission = {
    key: jobKey,
    title: job.title,
    reward: job.reward,
    step: 0,
    waypoints: job.waypoints
  };
  updateMissionUI();
  showToast(`Started: ${job.title}`);
}

function updateMissionUI() {
  const banner = document.getElementById('mission-banner');
  if (!state.activeMission) {
    banner.classList.add('hidden');
    checkpointMesh.visible = false;
    return;
  }

  const wp = state.activeMission.waypoints[state.activeMission.step];
  banner.classList.remove('hidden');
  document.getElementById('mission-title').textContent = state.activeMission.title;
  document.getElementById('mission-desc').textContent = wp.desc;
  document.getElementById('mission-reward').textContent = `Step ${state.activeMission.step + 1}/${
    state.activeMission.waypoints.length
  } • Reward: +₹${state.activeMission.reward}`;

  checkpointMesh.position.set(wp.x, 7, wp.z);
  checkpointMesh.visible = true;
}

// --- MAPBOX GL MINI-MAP & TELEPORT INTEGRATION ---
let mapboxMap = null;
let isSatelliteStyle = false;
let lastMapLng = 0;
let lastMapLat = 0;

function initMapboxMinimap() {
  if (!window.mapboxgl) return;
  try {
    mapboxgl.accessToken = MAPBOX_TOKEN;
    mapboxMap = new mapboxgl.Map({
      container: 'mapbox-container',
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [PALAKKAD_COORDS.fort.lng, PALAKKAD_COORDS.fort.lat],
      zoom: 14.5,
      interactive: false,
      attributionControl: false
    });
  } catch (e) {
    console.warn('Mapbox init fallback:', e);
  }

  document.getElementById('btn-toggle-map-style').addEventListener('click', () => {
    if (!mapboxMap) return;
    isSatelliteStyle = !isSatelliteStyle;
    mapboxMap.setStyle(
      isSatelliteStyle
        ? 'mapbox://styles/mapbox/satellite-streets-v12'
        : 'mapbox://styles/mapbox/streets-v12'
    );
    document.getElementById('btn-toggle-map-style').textContent = isSatelliteStyle ? '🗺️ Map' : '🛰️ Sat';
  });

  document.querySelectorAll('.tp-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const zone = btn.dataset.zone;
      const target = PALAKKAD_COORDS[zone];
      if (!target) return;

      if (state.inVehicle) {
        state.inVehicle.x = target.x;
        state.inVehicle.z = target.z;
        state.inVehicle.speed = 0;
        state.inVehicle.mesh.position.set(target.x, 0, target.z);
      } else {
        localPlayer.x = target.x;
        localPlayer.z = target.z;
        localPlayer.rig.mesh.position.set(target.x, 0, target.z);
      }
      showToast(`Teleported to ${target.name}`);
    });
  });
}

function syncMapboxGPS(px, pz) {
  const lng = PALAKKAD_COORDS.fort.lng + px * 0.000045;
  const lat = PALAKKAD_COORDS.fort.lat - pz * 0.000045;

  if (mapboxMap && Math.hypot(lng - lastMapLng, lat - lastMapLat) > 0.00002) {
    lastMapLng = lng;
    lastMapLat = lat;
    mapboxMap.setCenter([lng, lat]);
  }

  const zoneEl = document.getElementById('current-zone-label');
  if (pz < -150 && Math.abs(px) < 60) {
    zoneEl.textContent = '📍 Malampuzha Dam, Gardens & Ropeway';
  } else if (px < -75 && pz < -85) {
    zoneEl.textContent = '📍 Palakkad Junction (Olavakkode Railway Station)';
  } else if (px < -75 && pz >= -85) {
    zoneEl.textContent = '📍 Govt. Victoria College Campus';
  } else if (px > 75 && pz < 0) {
    zoneEl.textContent = '📍 Kalpathy Heritage Agraharam & Temple';
  } else if (px > 65 && pz > 65) {
    zoneEl.textContent = '📍 Stadium Bus Stand, Palakkad';
  } else {
    zoneEl.textContent = '📍 Palakkad Fort & Kottamaithanam';
  }
}

// --- REAL-TIME DAY & NIGHT CYCLE (IST) ---
function updateDayNightCycle() {
  if (state.realTimeIST) {
    const now = new Date();
    const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
    const istTotalMinutes = (utcMinutes + 330) % 1440;
    state.timeOfDay = istTotalMinutes / 60;
    document.getElementById('time-slider').value = state.timeOfDay;
  }

  const hrs24 = Math.floor(state.timeOfDay);
  const mins = Math.floor((state.timeOfDay - hrs24) * 60);
  const ampm = hrs24 >= 12 ? 'PM' : 'AM';
  const hrs12 = hrs24 % 12 || 12;
  document.getElementById('clock-display').textContent = `${hrs12}:${String(mins).padStart(2, '0')} ${ampm}`;

  const sunAngle = ((state.timeOfDay - 6) / 24) * Math.PI * 2;
  const sunY = Math.sin(sunAngle);
  const sunX = Math.cos(sunAngle);

  sunMesh.position.set(sunX * 320, sunY * 320, -90);
  moonMesh.position.set(-sunX * 320, -sunY * 320, -90);

  if (sunY > 0.15) {
    state.isNight = false;
    document.getElementById('time-icon').textContent = '☀️';
    scene.background.setHex(0x7dd3fc);
    scene.fog.color.setHex(0x7dd3fc);
    sunLight.intensity = 1.75;
    sunLight.color.setHex(0xfffbeb);
    ambientLight.intensity = 0.68;
    stars.material.opacity = 0;
  } else if (sunY > -0.15) {
    state.isNight = sunY < 0;
    document.getElementById('time-icon').textContent = '🌅';
    scene.background.setHex(0xf97316);
    scene.fog.color.setHex(0xfb923c);
    sunLight.intensity = 1.1;
    sunLight.color.setHex(0xfdba74);
    ambientLight.intensity = 0.45;
    stars.material.opacity = 0.35;
  } else {
    state.isNight = true;
    document.getElementById('time-icon').textContent = '🌙';
    scene.background.setHex(0x090d16);
    scene.fog.color.setHex(0x090d16);
    sunLight.intensity = 0.25;
    sunLight.color.setHex(0x93c5fd);
    ambientLight.intensity = 0.28;
    stars.material.opacity = 0.95;
  }

  streetBulbMat.color.setHex(state.isNight ? 0xfef08a : 0x64748b);

  vehicles.forEach((v) => {
    const activeLight = v.lightsOn && v === state.inVehicle;
    v.headLight.intensity = activeLight ? 4.8 : 0;
  });
}

// --- MULTIPLAYER WEBSOCKET CLIENT ---
let ws = null;
const remotePlayers = new Map();

function connectMultiplayer() {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${window.location.host}`);

  ws.addEventListener('open', () => {
    ws.send(
      JSON.stringify({
        type: 'customize',
        name: state.playerName,
        customization: state.customization
      })
    );
  });

  ws.addEventListener('message', (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch (e) {
      return;
    }

    if (msg.type === 'init') {
      state.playerId = msg.id;
      updateOnlineCount(msg.onlineCount || 1);
      Object.values(msg.players || {}).forEach((p) => addOrUpdateRemotePlayer(p));
      Object.entries(msg.vehicles || {}).forEach(([vId, vState]) => {
        const v = vehicles.find((item) => item.id === vId);
        if (v && v !== state.inVehicle) {
          v.x = vState.x;
          v.z = vState.z;
          v.rotY = vState.rotY;
          v.mesh.position.set(v.x, 0, v.z);
          v.mesh.rotation.y = v.rotY;
        }
      });
    } else if (msg.type === 'player_joined') {
      updateOnlineCount(msg.onlineCount);
      addOrUpdateRemotePlayer(msg.player);
      appendChatMessage('System', `👋 ${msg.player.name} joined Palakkad RP!`, true);
    } else if (msg.type === 'player_moved') {
      const rp = remotePlayers.get(msg.id);
      if (rp) {
        rp.targetX = msg.x;
        rp.targetY = msg.y;
        rp.targetZ = msg.z;
        rp.targetRotY = msg.rotY;
        rp.anim = msg.anim;
        rp.rig.mesh.visible = !msg.inVehicle;
      }
    } else if (msg.type === 'player_customized') {
      const rp = remotePlayers.get(msg.id);
      if (rp) {
        rp.rig.updateRigAppearance(msg.customization, msg.name);
      }
    } else if (msg.type === 'vehicle_synced') {
      const v = vehicles.find((item) => item.id === msg.vehicleId);
      if (v && v !== state.inVehicle && msg.state) {
        v.x = msg.state.x;
        v.z = msg.state.z;
        v.rotY = msg.state.rotY;
        v.driverId = msg.state.driverId;
        v.mesh.position.set(v.x, 0, v.z);
        v.mesh.rotation.y = v.rotY;
      }
    } else if (msg.type === 'player_horn') {
      sound.playHorn(msg.vehicleType || 'bus');
    } else if (msg.type === 'chat_message') {
      appendChatMessage(msg.name, msg.text, false);
    } else if (msg.type === 'player_left') {
      updateOnlineCount(msg.onlineCount);
      const rp = remotePlayers.get(msg.id);
      if (rp) {
        scene.remove(rp.rig.mesh);
        remotePlayers.delete(msg.id);
      }
    }
  });
}

function addOrUpdateRemotePlayer(p) {
  if (!p || p.id === state.playerId) return;
  let rp = remotePlayers.get(p.id);
  if (!rp) {
    const rig = createCharacterRig(p.customization || {}, p.name || 'Player', false);
    rig.mesh.position.set(p.x || 0, p.y || 0, p.z || 18);
    scene.add(rig.mesh);
    rp = {
      id: p.id,
      rig,
      targetX: p.x || 0,
      targetY: p.y || 0,
      targetZ: p.z || 18,
      targetRotY: p.rotY || 0,
      anim: p.anim || 'idle'
    };
    remotePlayers.set(p.id, rp);
  }
}

function updateOnlineCount(count) {
  document.getElementById('online-count').textContent = `${count} Online`;
}

// --- INTERACT WITH VEHICLE OR NPC ---
function handlePrimaryInteraction() {
  sound.init();

  if (state.inVehicle) {
    const v = state.inVehicle;
    v.driverId = null;
    v.speed = 0;
    localPlayer.x = v.x - Math.cos(v.rotY) * 3.4;
    localPlayer.z = v.z + Math.sin(v.rotY) * 3.4;
    localPlayer.y = 0;
    localPlayer.rig.mesh.position.set(localPlayer.x, 0, localPlayer.z);
    localPlayer.rig.mesh.visible = true;
    state.inVehicle = null;
    updateDayNightCycle();

    document.getElementById('vehicle-hud').classList.add('hidden');
    document.getElementById('mob-btn-horn').classList.add('hidden');
    showToast(`Exited ${v.name}`);
    return;
  }

  if (state.nearbyVehicle) {
    const v = state.nearbyVehicle;
    v.isAI = false;
    state.inVehicle = v;
    v.driverId = state.playerId;
    localPlayer.rig.mesh.visible = false;
    updateDayNightCycle();

    document.getElementById('vehicle-name-display').textContent = v.name;
    document.getElementById('vehicle-hud').classList.remove('hidden');
    document.getElementById('mob-btn-horn').classList.remove('hidden');
    sound.playHorn(v.type);
    showToast(`Driving ${v.name}`);
    return;
  }

  if (state.nearbyNpc) {
    const npc = state.nearbyNpc;
    const line = npc.dialogues[npc.dialogueIdx % npc.dialogues.length];
    npc.dialogueIdx++;
    sound.playCashSound();
    appendChatMessage(`${npc.name} (${npc.role})`, line, false);
    showToast(`💬 ${npc.name}: "${line}"`);
  }
}

// --- COLLISION HELPER ---
function hitsBuilding(x, z, radius = 0.8) {
  for (let i = 0; i < buildingColliders.length; i++) {
    const b = buildingColliders[i];
    if (x + radius > b.minX && x - radius < b.maxX && z + radius > b.minZ && z - radius < b.maxZ) {
      return true;
    }
  }
  return false;
}

// --- INPUT LISTENERS ---
function setupInputListeners() {
  window.addEventListener('keydown', (e) => {
    if (document.activeElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
      return;
    }

    const k = e.key.toLowerCase();
    if (k === 'w' || e.key === 'ArrowUp') state.keys.w = true;
    if (k === 's' || e.key === 'ArrowDown') state.keys.s = true;
    if (k === 'a' || e.key === 'ArrowLeft') state.keys.a = true;
    if (k === 'd' || e.key === 'ArrowRight') state.keys.d = true;
    if (e.key === 'Shift') state.keys.shift = true;
    if (e.key === ' ') state.keys.space = true;

    if (k === 'f' || k === 'e') handlePrimaryInteraction();
    if (k === 'h' && state.inVehicle) {
      sound.playHorn(state.inVehicle.type);
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: 'horn',
            vehicleType: state.inVehicle.type,
            x: state.inVehicle.x,
            z: state.inVehicle.z
          })
        );
      }
    }
    if (k === 'l' && state.inVehicle) {
      state.inVehicle.lightsOn = !state.inVehicle.lightsOn;
      updateDayNightCycle();
    }
    if (k === 'c') {
      document.getElementById('customize-modal').classList.toggle('hidden');
    }
    if (k === 'm') {
      document.getElementById('jobs-modal').classList.toggle('hidden');
    }
  });

  window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'w' || e.key === 'ArrowUp') state.keys.w = false;
    if (k === 's' || e.key === 'ArrowDown') state.keys.s = false;
    if (k === 'a' || e.key === 'ArrowLeft') state.keys.a = false;
    if (k === 'd' || e.key === 'ArrowRight') state.keys.d = false;
    if (e.key === 'Shift') state.keys.shift = false;
    if (e.key === ' ') state.keys.space = false;
  });

  let isDragging = false;
  let prevX = 0;
  let prevY = 0;

  renderer.domElement.addEventListener('mousedown', (e) => {
    isDragging = true;
    prevX = e.clientX;
    prevY = e.clientY;
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const dx = e.clientX - prevX;
    const dy = e.clientY - prevY;
    prevX = e.clientX;
    prevY = e.clientY;
    state.cameraAngleY -= dx * 0.007;
    state.cameraAngleX = Math.max(0.08, Math.min(1.15, state.cameraAngleX + dy * 0.006));
  });

  window.addEventListener('mouseup', () => {
    isDragging = false;
  });

  renderer.domElement.addEventListener(
    'wheel',
    (e) => {
      state.cameraDist = Math.max(4.0, Math.min(24, state.cameraDist + e.deltaY * 0.01));
    },
    { passive: true }
  );

  // Mobile Virtual Joystick
  const joyZone = document.getElementById('joystick-zone');
  const joyStick = document.getElementById('joystick-stick');
  const maxRadius = 36;

  const handleTouchMove = (touch) => {
    const rect = joyZone.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = touch.clientX - cx;
    let dy = touch.clientY - cy;
    const dist = Math.hypot(dx, dy);
    if (dist > maxRadius) {
      dx = (dx / dist) * maxRadius;
      dy = (dy / dist) * maxRadius;
    }
    joyStick.style.transform = `translate(${dx}px, ${dy}px)`;
    state.joystick.x = dx / maxRadius;
    state.joystick.y = dy / maxRadius;
    state.joystick.active = true;
  };

  joyZone.addEventListener(
    'touchstart',
    (e) => {
      e.preventDefault();
      handleTouchMove(e.touches[0]);
    },
    { passive: false }
  );

  joyZone.addEventListener(
    'touchmove',
    (e) => {
      e.preventDefault();
      handleTouchMove(e.touches[0]);
    },
    { passive: false }
  );

  joyZone.addEventListener('touchend', () => {
    joyStick.style.transform = 'translate(0px, 0px)';
    state.joystick.x = 0;
    state.joystick.y = 0;
    state.joystick.active = false;
  });

  document.getElementById('mob-btn-enter').addEventListener('click', handlePrimaryInteraction);
  document.getElementById('interaction-prompt').addEventListener('click', handlePrimaryInteraction);
  document.getElementById('mob-btn-horn').addEventListener('click', () => {
    if (state.inVehicle) sound.playHorn(state.inVehicle.type);
  });

  const sprintBtn = document.getElementById('mob-btn-sprint');
  sprintBtn.addEventListener('touchstart', () => (state.keys.shift = true));
  sprintBtn.addEventListener('touchend', () => (state.keys.shift = false));

  const jumpBtn = document.getElementById('mob-btn-jump');
  jumpBtn.addEventListener('touchstart', () => (state.keys.space = true));
  jumpBtn.addEventListener('touchend', () => (state.keys.space = false));

  const timeSlider = document.getElementById('time-slider');
  timeSlider.addEventListener('input', (e) => {
    state.realTimeIST = false;
    state.timeOfDay = parseFloat(e.target.value);
    document.getElementById('time-mode-label').textContent = 'CUSTOM TIME';
    updateDayNightCycle();
  });

  document.getElementById('time-card').addEventListener('dblclick', () => {
    state.realTimeIST = true;
    document.getElementById('time-mode-label').textContent = 'IST REAL-TIME';
    updateDayNightCycle();
    showToast('Synced sky with Real-Time Palakkad IST!');
  });

  document.getElementById('btn-open-customize').addEventListener('click', () => {
    document.getElementById('customize-modal').classList.remove('hidden');
  });
  document.getElementById('btn-close-customize').addEventListener('click', () => {
    document.getElementById('customize-modal').classList.add('hidden');
  });

  document.getElementById('btn-save-customize').addEventListener('click', () => {
    state.playerName = document.getElementById('cust-name').value.trim() || 'Palakkadan';
    state.customization = {
      shirtColor: document.getElementById('cust-shirt-color').value,
      bottomType: document.getElementById('cust-bottom-type').value,
      bottomColor: document.getElementById('cust-bottom-color').value,
      skinColor: document.getElementById('cust-skin-color').value,
      sunglasses: document.getElementById('cust-sunglasses').value === 'true'
    };

    localPlayer.rig.updateRigAppearance(state.customization, state.playerName);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: 'customize',
          name: state.playerName,
          customization: state.customization
        })
      );
    }
    document.getElementById('customize-modal').classList.add('hidden');
    showToast('Character customization updated & synced!');
  });

  document.querySelectorAll('.shop-item-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const cost = parseInt(btn.dataset.cost, 10);
      const outfit = btn.dataset.outfit;
      if (state.cash < cost) {
        showToast('❌ Not enough Wallet Cash! Complete a Bus Route or collect Cash.');
        return;
      }
      addCash(-cost);
      if (outfit === 'royal') {
        document.getElementById('cust-shirt-color').value = '#fbbf24';
        document.getElementById('cust-bottom-type').value = 'mundu';
      } else if (outfit === 'driver') {
        document.getElementById('cust-shirt-color').value = '#a16207';
        document.getElementById('cust-bottom-type').value = 'colored_mundu';
        document.getElementById('cust-bottom-color').value = '#78350f';
      } else if (outfit === 'biker') {
        document.getElementById('cust-shirt-color').value = '#18181b';
        document.getElementById('cust-bottom-type').value = 'jeans';
      }
      sound.playCashSound();
      showToast(`Purchased outfit for ₹${cost}! Click Apply to wear.`);
    });
  });

  document.getElementById('btn-open-mission').addEventListener('click', () => {
    document.getElementById('jobs-modal').classList.remove('hidden');
  });
  document.getElementById('btn-close-jobs').addEventListener('click', () => {
    document.getElementById('jobs-modal').classList.add('hidden');
  });

  document.querySelectorAll('.start-job-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      startMission(btn.dataset.job);
      document.getElementById('jobs-modal').classList.add('hidden');
    });
  });

  document.getElementById('chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (!text) return;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'chat', text }));
    } else {
      appendChatMessage(state.playerName, text, false);
    }
    input.value = '';
    input.blur();
  });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

function addCash(amount) {
  state.cash = Math.max(0, state.cash + amount);
  document.getElementById('cash-display').textContent = state.cash.toLocaleString('en-IN');
}

function appendChatMessage(author, text, isSystem = false) {
  const box = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = isSystem ? 'chat-msg system' : 'chat-msg';
  if (isSystem) {
    div.textContent = text;
  } else {
    div.innerHTML = `<span class="author">${author}:</span> ${text.replace(/</g, '&lt;')}`;
  }
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

function showToast(message) {
  const containerEl = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  containerEl.appendChild(toast);
  setTimeout(() => toast.remove(), 3200);
}

// --- MAIN GAME LOOP (OPTIMIZED 60 FPS) ---
const clock = new THREE.Clock();
let lastNetSync = 0;

function animate() {
  requestAnimationFrame(animate);

  const dt = Math.min(clock.getDelta(), 0.1);
  const elapsed = clock.getElapsedTime();

  // Animate water ripples & Malampuzha Ropeway Gondola Cars
  if (waterTexture) {
    waterTexture.offset.y = (elapsed * 0.08) % 1;
    waterTexture.offset.x = Math.sin(elapsed * 0.4) * 0.05;
  }
  for (let r = 0; r < ropewayCabins.length; r++) {
    const rc = ropewayCabins[r];
    rc.mesh.position.x = Math.sin(elapsed * 0.35 + rc.phase) * 46;
  }

  let forwardInput = (state.keys.w ? 1 : 0) - (state.keys.s ? 1 : 0);
  let turnInput = (state.keys.a ? 1 : 0) - (state.keys.d ? 1 : 0);

  if (state.joystick.active) {
    forwardInput = -state.joystick.y;
    turnInput = -state.joystick.x;
  }

  let focusX = localPlayer.x;
  let focusY = localPlayer.y + 1.75;
  let focusZ = localPlayer.z;

  if (state.inVehicle) {
    const v = state.inVehicle;
    if (Math.abs(forwardInput) > 0.05) {
      v.speed += forwardInput * v.accel * dt;
    } else {
      v.speed *= Math.pow(0.25, dt);
    }

    if (state.keys.space) {
      v.speed *= Math.pow(0.03, dt);
    }

    v.speed = Math.max(-v.maxSpeed * 0.45, Math.min(v.maxSpeed, v.speed));

    if (Math.abs(v.speed) > 0.4) {
      const steerDir = v.speed >= 0 ? 1 : -1;
      v.rotY += turnInput * 1.85 * steerDir * dt;
    }

    const nextX = v.x + Math.sin(v.rotY) * v.speed * dt;
    const nextZ = v.z + Math.cos(v.rotY) * v.speed * dt;

    if (!hitsBuilding(nextX, nextZ, 2.2)) {
      v.x = nextX;
      v.z = nextZ;
    } else {
      v.speed = -v.speed * 0.35;
    }

    v.mesh.position.set(v.x, 0, v.z);
    v.mesh.rotation.y = v.rotY;

    for (let i = 0; i < v.wheels.length; i++) {
      v.wheels[i].rotation.x += v.speed * dt * 1.5;
    }

    localPlayer.x = v.x;
    localPlayer.z = v.z;
    focusX = v.x;
    focusY = v.type === 'bus' || v.type === 'ksrtc' ? 3.5 : 2.2;
    focusZ = v.z;

    const kmh = Math.round(Math.abs(v.speed) * 2.6);
    document.getElementById('speed-value').textContent = kmh;
  } else {
    const isMoving = Math.hypot(forwardInput, turnInput) > 0.1;
    const moveSpeed = state.keys.shift ? 13.5 : 7.5;

    if (isMoving) {
      const inputAngle = Math.atan2(-turnInput, forwardInput);
      const targetRot = state.cameraAngleY + inputAngle;
      localPlayer.rotY = targetRot;

      const nx = localPlayer.x + Math.sin(targetRot) * moveSpeed * dt;
      const nz = localPlayer.z + Math.cos(targetRot) * moveSpeed * dt;

      if (!hitsBuilding(nx, nz, 0.7)) {
        localPlayer.x = nx;
        localPlayer.z = nz;
      }
      localPlayer.anim = state.keys.shift ? 'run' : 'walk';
    } else {
      localPlayer.anim = 'idle';
    }

    if (state.keys.space && localPlayer.onGround) {
      localPlayer.vy = 9.2;
      localPlayer.onGround = false;
    }
    localPlayer.vy -= 22 * dt;
    localPlayer.y += localPlayer.vy * dt;
    if (localPlayer.y <= 0) {
      localPlayer.y = 0;
      localPlayer.vy = 0;
      localPlayer.onGround = true;
    }

    localPlayer.rig.mesh.position.set(localPlayer.x, localPlayer.y, localPlayer.z);
    localPlayer.rig.mesh.rotation.y = localPlayer.rotY;
    localPlayer.rig.animateLimbs(localPlayer.anim, elapsed);

    focusX = localPlayer.x;
    focusY = localPlayer.y + 1.75;
    focusZ = localPlayer.z;
  }

  // --- UPDATE AUTONOMOUS AI TRAFFIC VEHICLES ---
  for (let i = 0; i < vehicles.length; i++) {
    const v = vehicles[i];
    if (v.isAI && v !== state.inVehicle && v.aiWaypoints.length > 0) {
      const wp = v.aiWaypoints[v.aiWpIdx];
      const dx = wp.x - v.x;
      const dz = wp.z - v.z;
      const dist = Math.hypot(dx, dz);
      const distToPlayer = Math.hypot(v.x - focusX, v.z - focusZ);

      if (distToPlayer < 8.5) {
        v.speed = 0;
      } else if (dist < 3.0) {
        v.aiWpIdx = (v.aiWpIdx + 1) % v.aiWaypoints.length;
      } else {
        v.speed = 14;
        v.rotY = Math.atan2(dx, dz);
        v.x += (dx / dist) * v.speed * dt;
        v.z += (dz / dist) * v.speed * dt;
        v.mesh.position.set(v.x, 0, v.z);
        v.mesh.rotation.y = v.rotY;
        for (let w = 0; w < v.wheels.length; w++) {
          v.wheels[w].rotation.x += v.speed * dt * 1.5;
        }
      }
    }
  }

  // --- UPDATE LIVING PALAKKAD NPCs ---
  updateNPCs(dt, elapsed, focusX, focusZ);

  // --- CHECK NEARBY VEHICLES OR NPCs FOR INTERACTION PROMPT ---
  if (!state.inVehicle) {
    let closestVeh = null;
    let minDist = 6.2;
    for (let i = 0; i < vehicles.length; i++) {
      const v = vehicles[i];
      const dist = Math.hypot(v.x - localPlayer.x, v.z - localPlayer.z);
      if (dist < minDist) {
        minDist = dist;
        closestVeh = v;
      }
    }
    state.nearbyVehicle = closestVeh;

    const promptEl = document.getElementById('interaction-prompt');
    const mobEnterBtn = document.getElementById('mob-btn-enter');

    if (closestVeh) {
      promptEl.innerHTML = `Press <kbd>F</kbd> or Tap to Drive <strong>${closestVeh.name}</strong>`;
      promptEl.classList.remove('hidden');
      mobEnterBtn.textContent = '🚗 Drive';
      mobEnterBtn.classList.remove('hidden');
    } else if (state.nearbyNpc) {
      promptEl.innerHTML = `Press <kbd>F</kbd> or Tap to Talk to <strong>${state.nearbyNpc.name} (${state.nearbyNpc.role})</strong>`;
      promptEl.classList.remove('hidden');
      mobEnterBtn.textContent = '💬 Talk';
      mobEnterBtn.classList.remove('hidden');
    } else {
      promptEl.classList.add('hidden');
      mobEnterBtn.classList.add('hidden');
    }
  } else {
    document.getElementById('interaction-prompt').classList.add('hidden');
    const mobEnterBtn = document.getElementById('mob-btn-enter');
    mobEnterBtn.textContent = '🚶 Exit';
    mobEnterBtn.classList.remove('hidden');
  }

  // --- ANIMATE & COLLECT FLOATING CASH PICKUPS ---
  for (let i = 0; i < cashPickups.length; i++) {
    const item = cashPickups[i];
    if (item.mesh.visible) {
      item.mesh.rotation.y += dt * 2.2;
      item.mesh.position.y = 1.3 + Math.sin(elapsed * 3 + item.x) * 0.25;
      const dist = Math.hypot(item.x - focusX, item.z - focusZ);
      if (dist < 3.2) {
        item.mesh.visible = false;
        item.collectedAt = elapsed;
        addCash(item.amount);
        sound.playCashSound();
        showToast(`+₹${item.amount} Cash Collected!`);
      }
    } else if (elapsed - item.collectedAt > 25) {
      item.mesh.visible = true;
    }
  }

  // --- CHECK MISSION WAYPOINTS ---
  if (state.activeMission) {
    checkpointMesh.rotation.y += dt * 1.5;
    const wp = state.activeMission.waypoints[state.activeMission.step];
    const dist = Math.hypot(wp.x - focusX, wp.z - focusZ);
    if (dist < 6.5) {
      state.activeMission.step++;
      sound.playCashSound();
      if (state.activeMission.step >= state.activeMission.waypoints.length) {
        const reward = state.activeMission.reward;
        addCash(reward);
        showToast(`🎉 Job Completed! Earned +₹${reward}`);
        state.activeMission = null;
      }
      updateMissionUI();
    }
  }

  // --- INTERPOLATE REMOTE MULTIPLAYER CHARACTERS ---
  remotePlayers.forEach((rp) => {
    rp.rig.mesh.position.x += (rp.targetX - rp.rig.mesh.position.x) * 0.18;
    rp.rig.mesh.position.y += (rp.targetY - rp.rig.mesh.position.y) * 0.18;
    rp.rig.mesh.position.z += (rp.targetZ - rp.rig.mesh.position.z) * 0.18;
    rp.rig.mesh.rotation.y = rp.targetRotY;
    rp.rig.animateLimbs(rp.anim, elapsed);
  });

  // --- THIRD-PERSON CAMERA FOLLOW ---
  const camDist = state.inVehicle ? state.cameraDist + 4.5 : state.cameraDist;
  const camX = focusX - Math.sin(state.cameraAngleY) * Math.cos(state.cameraAngleX) * camDist;
  const camY = focusY + Math.sin(state.cameraAngleX) * camDist;
  const camZ = focusZ - Math.cos(state.cameraAngleY) * Math.cos(state.cameraAngleX) * camDist;
  _tempVec3.set(camX, Math.max(1.4, camY), camZ);
  camera.position.lerp(_tempVec3, 0.2);
  camera.lookAt(focusX, focusY, focusZ);

  sunLight.target.position.set(focusX, 0, focusZ);
  sunLight.position.set(focusX + 65, 130, focusZ + 55);

  // --- NETWORK, POOLED NIGHT LIGHTS & GPS PERIODIC SYNC ---
  if (elapsed - lastNetSync > 0.1) {
    lastNetSync = elapsed;
    syncMapboxGPS(focusX, focusZ);

    if (state.isNight && streetLampPositions.length >= 2) {
      let best1 = streetLampPositions[0];
      let best2 = streetLampPositions[1];
      let d1 = Infinity;
      let d2 = Infinity;
      for (let i = 0; i < streetLampPositions.length; i++) {
        const lp = streetLampPositions[i];
        const d = Math.hypot(lp.x - focusX, lp.z - focusZ);
        if (d < d1) {
          d2 = d1;
          best2 = best1;
          d1 = d;
          best1 = lp;
        } else if (d < d2) {
          d2 = d;
          best2 = lp;
        }
      }
      lampLightPool[0].position.set(best1.x, 7.0, best1.z);
      lampLightPool[0].intensity = 2.4;
      lampLightPool[1].position.set(best2.x, 7.0, best2.z);
      lampLightPool[1].intensity = 2.4;
    } else {
      lampLightPool[0].intensity = 0;
      lampLightPool[1].intensity = 0;
    }

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: 'state_update',
          x: Number(localPlayer.x.toFixed(2)),
          y: Number(localPlayer.y.toFixed(2)),
          z: Number(localPlayer.z.toFixed(2)),
          rotY: Number(localPlayer.rotY.toFixed(2)),
          anim: localPlayer.anim,
          inVehicle: state.inVehicle ? state.inVehicle.id : null,
          cash: state.cash
        })
      );

      if (state.inVehicle) {
        ws.send(
          JSON.stringify({
            type: 'vehicle_update',
            vehicleId: state.inVehicle.id,
            x: Number(state.inVehicle.x.toFixed(2)),
            y: 0,
            z: Number(state.inVehicle.z.toFixed(2)),
            rotY: Number(state.inVehicle.rotY.toFixed(2)),
            driverId: state.playerId,
            speed: Number(state.inVehicle.speed.toFixed(1)),
            headlights: state.inVehicle.lightsOn
          })
        );
      }
    }
  }

  renderer.render(scene, camera);
}

// --- INITIALIZE EVERYTHING ---
async function initGame() {
  try {
    const res = await fetch('/api/config');
    if (res.ok) {
      const cfg = await res.json();
      MAPBOX_TOKEN = cfg.mapboxToken || '';
    }
  } catch (e) {
    // Offline fallback
  }

  buildPalakkadWorld();
  spawnPalakkadVehicles();
  spawnPalakkadNPCs();
  spawnCashPickups();
  initMapboxMinimap();
  setupInputListeners();
  updateDayNightCycle();
  setInterval(updateDayNightCycle, 30000);
  connectMultiplayer();
  animate();
}

initGame();
