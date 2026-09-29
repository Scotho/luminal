// ── Lobby 3D Model Previews ──────────────────────────────
// Renders spinning vehicle models with straight trails into lobby vehicle tiles.
// Uses a single shared WebGLRenderer + EffectComposer (bloom) rendering to individual canvases.

import * as THREE from 'three';
import { EffectComposer, RenderPass, EffectPass, BloomEffect } from 'postprocessing';
import { cloneBikeModel, isBikeModelLoaded, getBikeModelHeight } from '../bikeModel';
import { cloneCarModel, isCarModelLoaded } from '../carModel';
import { cloneHoverboardModel, isHoverboardModelLoaded, getHoverboardModelHeight } from '../hoverboardModel';
import { DEFAULT_PLAYER_COLOR_KEY, getPlayerColor } from '../playerColors';
import { deriveTrailColorProfile, type TrailColorProfile } from '../trail';
import type { VehicleType } from '../types/index';
import { logLocal } from '../localDiagnostics';
import { requestNebulaSkyboxInstance } from '../nebulaSkybox';

// Trail visual constants (matching trail.ts)
const TRAIL_WALL_HEIGHT = 2.7;
const TRAIL_WALL_WIDTH = 0.32;
const TRAIL_SEG_COUNT = 8;

type PreviewShaderUniforms = {
  uEdgeBright: { value: number };
  uTime: { value: number };
  uSlipstream: { value: number };
  uBaseColor: { value: THREE.Color };
  uCoreColor: { value: THREE.Color };
  uHaloColor: { value: THREE.Color };
};

interface PreviewEntry {
  canvas: HTMLCanvasElement;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  pivot: THREE.Group;
  light: THREE.PointLight;
  colorKey: string;
  vehicleType: VehicleType;
  edgeMat: THREE.LineBasicMaterial | null;
  baseEdgeOpacity: number;
  showroom: boolean;
  wallUniforms: PreviewShaderUniforms[];
}

const PREVIEW_SIZE = 240;
const SKYBOX_SCALE = 30;
let _renderer: THREE.WebGLRenderer | null = null;
let _composer: EffectComposer | null = null;
let _renderPass: RenderPass | null = null;
const _previews: Map<string, PreviewEntry> = new Map();
const _suspended: Map<string, PreviewEntry> = new Map();
let _animFrame: number | null = null;
let _spinning = false;

// Deferred load retry
const _pendingRetries: Map<string, { colorKey: string; vehicleType: VehicleType; cb: (canvas: HTMLCanvasElement) => void }> = new Map();
let _retryTimer: ReturnType<typeof setTimeout> | null = null;

function _getRenderer(): THREE.WebGLRenderer {
  if (!_renderer) {
    _renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    _renderer.setSize(PREVIEW_SIZE, PREVIEW_SIZE);
    _renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    _renderer.toneMapping = THREE.ACESFilmicToneMapping;
    _renderer.toneMappingExposure = 1.3;
  }
  return _renderer;
}

function _getComposer(scene: THREE.Scene, camera: THREE.PerspectiveCamera): EffectComposer {
  const renderer = _getRenderer();
  if (!_composer) {
    _composer = new EffectComposer(renderer);
    _renderPass = new RenderPass(scene, camera);
    _composer.addPass(_renderPass);
    const _bloomEffect = new BloomEffect({
      intensity: 0.6,
      radius: 0.4,
      luminanceThreshold: 0.25,
      luminanceSmoothing: 0.2,
      mipmapBlur: true,
    });
    _composer.addPass(new EffectPass(camera, _bloomEffect));
  } else {
    // Update scene/camera for the current preview
    if (_renderPass) { _renderPass.mainScene = scene; _renderPass.mainCamera = camera; }
  }
  return _composer;
}

// Emissive helpers — match trail.ts deriveTrailColorProfile
function _emissiveColor(hex: number): THREE.Color {
  const c = new THREE.Color(hex);
  const maxChan = Math.max(c.r, c.g, c.b, 0.01);
  return c.clone().multiplyScalar(1 + (1 / maxChan - 1) * 0.85);
}


/** Apply the in-game tron trail shader to a MeshStandardMaterial */
function _applyTronShader(mat: THREE.MeshStandardMaterial, profile: TrailColorProfile, uniformsList: PreviewShaderUniforms[]): void {
  const _halfH = (TRAIL_WALL_HEIGHT / 2).toFixed(4);
  const _halfW = (TRAIL_WALL_WIDTH / 2).toFixed(4);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uEdgeBright = { value: 1.0 };
    shader.uniforms.uTime = { value: 0 };
    shader.uniforms.uSlipstream = { value: 0 };
    shader.uniforms.uBaseColor = { value: profile.baseColor.clone() };
    shader.uniforms.uCoreColor = { value: profile.coreColor.clone() };
    shader.uniforms.uHaloColor = { value: profile.haloColor.clone() };
    uniformsList.push(shader.uniforms as PreviewShaderUniforms);
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      '#include <common>\nvarying float vLocalY;\nvarying float vTrailAxis;\nvarying float vTrailWidth;\nvarying vec3 vLocalNormal;',
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\nvLocalY = position.y / ' + _halfH + ' * 0.5 + 0.5;'
      + '\nvTrailAxis = position.x;'
      + '\nvTrailWidth = abs(position.z) / ' + _halfW + ';'
      + '\nvLocalNormal = normal;',
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      '#include <common>\nvarying float vLocalY;\nvarying float vTrailAxis;\nvarying float vTrailWidth;\nvarying vec3 vLocalNormal;'
      + '\nuniform float uEdgeBright;\nuniform float uTime;\nuniform float uSlipstream;'
      + '\nuniform vec3 uBaseColor;\nuniform vec3 uCoreColor;\nuniform vec3 uHaloColor;',
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      [
        '// Discard cap faces and the floor-facing face for a cleaner silhouette.',
        'float isCapFace = step(0.5, abs(vLocalNormal.x));',
        'float isBtmFace = step(0.5, -vLocalNormal.y);',
        'float isTopFace = step(0.5, vLocalNormal.y);',
        'if (isCapFace > 0.5 || isBtmFace > 0.5) discard;',
        '',
        'float widthMask = clamp(vTrailWidth, 0.0, 1.0);',
        'float bodyMask = smoothstep(0.015, 0.1, vLocalY) * (1.0 - smoothstep(0.9, 0.985, vLocalY));',
        'float haloMask = 1.0 - smoothstep(0.38, 1.0, widthMask);',
        'float ribbonMask = 1.0 - smoothstep(0.16, 0.78, widthMask);',
        'float coreMask = 1.0 - smoothstep(0.0, 0.2, widthMask);',
        '',
        '// ── Single smooth edge band per edge ──',
        'float topEdge = smoothstep(0.5, 1.0, vLocalY);',
        'topEdge = topEdge * topEdge;',
        'float bottomEdge = smoothstep(0.5, 0.0, vLocalY);',
        'bottomEdge = bottomEdge * bottomEdge;',
        'float edgeGlow = max(topEdge, bottomEdge);',
        'float centerDim = 1.0 - edgeGlow * 0.55;',
        '',
        'float tangentWave = sin(vTrailAxis * 18.0 - uTime * (8.0 + uEdgeBright * 1.4)) * 0.5 + 0.5;',
        'float tangentPulse = pow(tangentWave, 14.0) * ribbonMask * bodyMask * 0.12;',
        'float secondaryWave = sin(vTrailAxis * 9.0 - uTime * 4.2 + 1.2) * 0.5 + 0.5;',
        'float secondaryPulse = pow(secondaryWave, 8.0) * coreMask * bodyMask * 0.08;',
        'float riseWave = sin(vLocalY * 11.0 - uTime * 5.2 + vTrailAxis * 0.55) * 0.5 + 0.5;',
        'float risePulse = pow(riseWave, 7.5) * coreMask * bodyMask * 0.16;',
        'float slipstream = 0.0;',
        '',
        '// Top face: single unified bright band.',
        'if (isTopFace > 0.5) {',
        '  float topBlend = 1.0 - smoothstep(0.0, 0.5, widthMask);',
        '  vec3 topColor = mix(uHaloColor * (0.48 + uEdgeBright * 0.16), uCoreColor * (1.08 + uEdgeBright * 0.32), topBlend);',
        '  float topAlpha = 0.82 + topBlend * 0.16;',
        '  gl_FragColor = vec4(topColor, clamp(topAlpha, 0.0, 1.0));',
        '  return;',
        '}',
        '',
        '// ── Side face compositing ──',
        'float rimMask = smoothstep(0.74, 1.0, widthMask) * bodyMask;',
        'float edgeBands = max(smoothstep(0.12, 0.0, 1.0 - vLocalY), smoothstep(0.12, 0.0, vLocalY));',
        '',
        'vec3 interior = uBaseColor * ribbonMask * bodyMask * centerDim * (0.38 + uEdgeBright * 0.1);',
        'vec3 halo = uHaloColor * haloMask * bodyMask * centerDim * 0.14;',
        'vec3 core = uCoreColor * coreMask * bodyMask * centerDim * (0.7 + uEdgeBright * 0.25 + secondaryPulse + risePulse);',
        '',
        'vec3 edgeEmit = uCoreColor * edgeGlow * haloMask * (0.75 + uEdgeBright * 0.3);',
        '',
        'vec3 accents = uCoreColor * (tangentPulse + risePulse) * centerDim + uHaloColor * slipstream * 0.7;',
        'vec3 rim = uHaloColor * rimMask * (0.12 + uEdgeBright * 0.06);',
        '',
        'float alpha = max(ribbonMask * bodyMask * 0.94, coreMask * bodyMask * 0.98);',
        'alpha = max(alpha, edgeGlow * haloMask * 0.88 + edgeBands * haloMask * 0.46 + tangentPulse * 1.0 + risePulse * 1.2 + slipstream * 0.42 + rimMask * 0.1);',
        '',
        'vec3 total = interior + halo + core + edgeEmit + accents + rim;',
        'gl_FragColor = vec4(total, clamp(alpha, 0.0, 1.0));',
      ].join('\n'),
    );
  };
}

/** Create a straight trail behind the model along +Z, offset from center */
function _createTrail(hex: number, scaleFactor: number, rearOffset: number): { group: THREE.Group; edgeMat: THREE.LineBasicMaterial | null; wallUniforms: PreviewShaderUniforms[] } {
  const trailGroup = new THREE.Group();
  const profile = deriveTrailColorProfile(hex);
  const wallUniforms: PreviewShaderUniforms[] = [];

  const wallH = TRAIL_WALL_HEIGHT * scaleFactor;
  const totalLen = TRAIL_SEG_COUNT * 0.5 * scaleFactor;

  // Single continuous box for the trail wall — no segmentation
  // Geometry: X = trail axis (length along trail), Y = height, Z = width
  const wallGeo = new THREE.BoxGeometry(totalLen, TRAIL_WALL_HEIGHT, TRAIL_WALL_WIDTH);
  const wallMat = new THREE.MeshStandardMaterial({
    color: profile.baseColor,
    emissive: profile.coreColor,
    emissiveIntensity: 0,
    roughness: 0.18,
    metalness: 0.02,
    transparent: true,
    depthWrite: false,
    forceSinglePass: true,
    side: THREE.DoubleSide,
  });
  _applyTronShader(wallMat, profile, wallUniforms);

  const wall = new THREE.Mesh(wallGeo, wallMat);
  // Rotate so the trail-axis (X in geometry) aligns with Z in the scene
  wall.rotation.y = Math.PI / 2;
  const wallCenterZ = rearOffset + totalLen * 0.5 + 0.25 * scaleFactor;
  wall.position.set(0, wallH * 0.5, wallCenterZ);
  wall.scale.set(1, scaleFactor, scaleFactor);
  trailGroup.add(wall);

  // Edge glow lines along top and bottom of trail
  const edgeColor = profile.edgeColor.clone();
  const edgeMat = new THREE.LineBasicMaterial({
    color: edgeColor,
    transparent: true,
    opacity: profile.edgeOpacity + 0.06,
  });
  const startZ = rearOffset + 0.25 * scaleFactor;
  const endZ = rearOffset + totalLen + 0.25 * scaleFactor;
  // Top edge
  const topGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, wallH, startZ),
    new THREE.Vector3(0, wallH, endZ),
  ]);
  trailGroup.add(new THREE.Line(topGeo, edgeMat));
  // Bottom edge
  const btmGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, startZ),
    new THREE.Vector3(0, 0, endZ),
  ]);
  trailGroup.add(new THREE.Line(btmGeo, edgeMat));

  return { group: trailGroup, edgeMat, wallUniforms };
}

function _buildPreviewLights(scene: THREE.Scene, showroom: boolean): void {
  // Lighting — match in-game scene.ts values for both modes
  if (showroom) {
    // Match in-game scene.ts lighting exactly
    scene.add(new THREE.AmbientLight(0x0B363D, 0.75));
    const dir = new THREE.DirectionalLight(0x245160, 0.65);
    dir.position.set(20, 80, 30);
    scene.add(dir);
    scene.add(new THREE.HemisphereLight(0x021214, 0x0a1a1c, 0.5));
  } else {
    // Lobby tiles — still brighter than before, closer to in-game
    scene.add(new THREE.AmbientLight(0x0B363D, 0.55));
    const dir = new THREE.DirectionalLight(0x245160, 0.45);
    dir.position.set(3, 5, 4);
    scene.add(dir);
    scene.add(new THREE.HemisphereLight(0x021214, 0x0a1a1c, 0.35));
  }
}

function _buildPreviewVehicle(vehicleType: VehicleType, hex: number): { model: THREE.Group; scaleFactor: number } {
  const MODEL_CLONERS: Record<VehicleType, () => THREE.Group> = {
    bike: () => cloneBikeModel(hex),
    car: () => cloneCarModel(hex, { preview: true }),
    hoverboard: () => cloneHoverboardModel(hex, true),
  };
  const SCALE_FACTORS: Record<VehicleType, number> = { bike: 0.35, car: 0.28, hoverboard: 0.38 };
  const BASE_SCALES: Record<VehicleType, number> = {
    bike: 2.7 / getBikeModelHeight(),
    car: 2.0,
    hoverboard: 2.7 / getHoverboardModelHeight(),
  };
  const model = MODEL_CLONERS[vehicleType]();
  const scaleFactor = SCALE_FACTORS[vehicleType];
  const baseScale = BASE_SCALES[vehicleType];
  model.scale.setScalar(baseScale * scaleFactor);
  // Center the model on its bounding box so it sits centered in the preview
  const box = new THREE.Box3().setFromObject(model);
  const center = new THREE.Vector3();
  box.getCenter(center);
  if (import.meta.env.DEV) {
    const size = new THREE.Vector3();
    box.getSize(size);
    const meshCount = { total: 0 };
    model.traverse((c: THREE.Object3D) => { if ((c as THREE.Mesh).isMesh) meshCount.total++; });
    logLocal(`[LOADOUT] ${vehicleType} preview: ${meshCount.total} meshes, bbox ${size.x.toFixed(2)}×${size.y.toFixed(2)}×${size.z.toFixed(2)}, scale=${(baseScale * scaleFactor).toFixed(3)}`);
    if (meshCount.total === 0) console.error(`[LOADOUT] ${vehicleType} model has ZERO meshes — will render blank`);
  }
  model.position.sub(center);
  model.position.y = 0; // keep on ground plane
  // Per-vehicle rotation offset — correct facing direction so model appears centered
  const MODEL_Y_ROT: Record<VehicleType, number> = { bike: 0, car: 0, hoverboard: Math.PI - Math.PI * (20 / 180) };
  model.rotation.y += MODEL_Y_ROT[vehicleType];
  const MODEL_Y_DROP: Record<VehicleType, number> = { bike: 0, car: 0, hoverboard: -0.15 };
  model.position.y += MODEL_Y_DROP[vehicleType];
  return { model, scaleFactor };
}

function _applyHoverboardFill(scene: THREE.Scene, model: THREE.Group): void {
  // Hoverboard body is very dark (no emissive, high metalness) — add a fill light
  // and slight emissive boost so the model is actually visible in the preview
  const fill = new THREE.DirectionalLight(0x4a8a9a, 1.2);
  fill.position.set(-3, 4, 2);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0x1a4a5a, 0.8);
  rim.position.set(3, 2, -3);
  scene.add(rim);
  // Touch up body materials so they're not invisible
  model.traverse((child: THREE.Object3D) => {
    if (!(child as THREE.Mesh).isMesh) return;
    const mats = Array.isArray((child as THREE.Mesh).material)
      ? (child as THREE.Mesh).material as THREE.MeshStandardMaterial[]
      : [(child as THREE.Mesh).material as THREE.MeshStandardMaterial];
    for (const m of mats) {
      if (m.name === 'M_HoverB_Body' || m.name === 'M_HoverB_Plates') {
        m.emissive = new THREE.Color(0x0a1a20);
        m.emissiveIntensity = 0.6;
        m.roughness = 0.5;
      }
    }
  });
}

function _buildVehicleLights(pivot: THREE.Group, vehicleType: VehicleType, hex: number, emCol: THREE.Color, scaleFactor: number, showroom: boolean): void {
  // Engine exhaust glow
  const EXHAUST_GEOS: Record<VehicleType, () => THREE.BufferGeometry> = {
    bike: () => new THREE.BoxGeometry(0.5 * scaleFactor, 0.3 * scaleFactor, 0.15 * scaleFactor),
    car: () => new THREE.SphereGeometry(0.15 * scaleFactor, 6, 6),
    hoverboard: () => new THREE.SphereGeometry(0.12 * scaleFactor, 6, 6),
  };
  const exGlowGeo = EXHAUST_GEOS[vehicleType]();
  const exGlowMat = new THREE.MeshStandardMaterial({
    color: hex, emissive: emCol, emissiveIntensity: 1.25,
  });
  const exGlow = new THREE.Mesh(exGlowGeo, exGlowMat);
  const EXHAUST_Z: Record<VehicleType, number> = {
    bike: -3.0 * scaleFactor * (2.7 / getBikeModelHeight()) * 0.37,
    car: 6.0 * scaleFactor * (2.0 / 1.05) * 0.14,
    hoverboard: -2.0 * scaleFactor * (2.7 / getHoverboardModelHeight()) * 0.37,
  };
  const exhaustZ = EXHAUST_Z[vehicleType];
  exGlow.position.set(0, 0.5 * scaleFactor, exhaustZ);
  pivot.add(exGlow);

  // Underglow light — subtle floor illumination
  const underGlow = new THREE.PointLight(hex, 0.25, 3);
  underGlow.position.set(0, 0.05, 0);
  pivot.add(underGlow);

  // Main vehicle light — brighter for showroom
  const vehicleLight = new THREE.PointLight(hex, showroom ? 2.0 : 1.5, 10);
  vehicleLight.position.set(0, 1.5 * scaleFactor, 0);
  pivot.add(vehicleLight);
}

function _buildPreviewEnvironment(scene: THREE.Scene, hex: number, showroom: boolean): THREE.PointLight {
  // Point light — matches trail.ts headLight
  const light = new THREE.PointLight(hex, 1.5, 6);
  light.position.set(0, 1, 2);
  scene.add(light);

  // Ground glow — matches trail.ts groundGlow
  const groundGlow = new THREE.PointLight(hex, 0.6, 4);
  groundGlow.position.set(0, 0.1, 0);
  scene.add(groundGlow);

  // Floor plane — always present (not just showroom) so vehicles aren't floating in void
  const floorGeo = new THREE.PlaneGeometry(20, 20);
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0x030a0c,
    emissive: 0x021214,
    emissiveIntensity: 0.3,
    metalness: 0.88,
    roughness: 0.22,
  });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.01;
  scene.add(floor);

  // Floor glow light
  const floorLight = new THREE.PointLight(0x0B363D, showroom ? 0.8 : 0.5, 16);
  floorLight.position.set(0, 0.3, 0);
  scene.add(floorLight);

  requestNebulaSkyboxInstance((sky) => {
    scene.add(sky);
  }, { fog: false, scale: SKYBOX_SCALE });

  return light;
}

function _buildPreviewCamera(vehicleType: VehicleType): THREE.PerspectiveCamera {
  // Camera — lower Y and raise lookAt to frame model center (~y=0.45) properly
  const CAM_Z: Record<VehicleType, number> = { bike: 5.4, car: 6.5, hoverboard: 4.2 };
  const CAM_Y: Record<VehicleType, number> = { bike: 1.1, car: 1.1, hoverboard: 1.4 };
  const LOOK_Y: Record<VehicleType, number> = { bike: 0.45, car: 0.45, hoverboard: 0.55 };
  const camZ = CAM_Z[vehicleType];
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
  camera.position.set(0, CAM_Y[vehicleType], camZ);
  camera.lookAt(0, LOOK_Y[vehicleType], 0);
  return camera;
}

function _buildPreviewCanvas(): HTMLCanvasElement {
  const dpr = Math.min(window.devicePixelRatio, 2);
  const canvas = document.createElement('canvas');
  canvas.width = PREVIEW_SIZE * dpr;
  canvas.height = PREVIEW_SIZE * dpr;
  canvas.style.width = PREVIEW_SIZE + 'px';
  canvas.style.height = PREVIEW_SIZE + 'px';
  canvas.className = 'lobby-preview-canvas';
  return canvas;
}

function _createPreviewScene(colorKey: string, vehicleType: VehicleType, showroom: boolean = false): PreviewEntry {
  const scene = new THREE.Scene();
  _buildPreviewLights(scene, showroom);

  const hex = getPlayerColor(colorKey || DEFAULT_PLAYER_COLOR_KEY).color;
  const emCol = _emissiveColor(hex);

  const pivot = new THREE.Group();
  scene.add(pivot);

  // Model
  const { model, scaleFactor } = _buildPreviewVehicle(vehicleType, hex);
  pivot.add(model);

  if (vehicleType === 'hoverboard') _applyHoverboardFill(scene, model);

  // ── Vehicle lights (ported from player.ts) ──
  _buildVehicleLights(pivot, vehicleType, hex, emCol, scaleFactor, showroom);

  // Straight trail behind model — offset toward rear of vehicle
  const REAR_OFFSETS: Record<VehicleType, number> = { bike: 0.6, car: 1.4, hoverboard: 0.5 };
  const rearOffset = REAR_OFFSETS[vehicleType];
  const { group: trailGroup, edgeMat, wallUniforms } = _createTrail(hex, scaleFactor, rearOffset);
  pivot.add(trailGroup);

  const light = _buildPreviewEnvironment(scene, hex, showroom);
  const camera = _buildPreviewCamera(vehicleType);
  const canvas = _buildPreviewCanvas();

  return {
    canvas, scene, camera, pivot, light, colorKey, vehicleType,
    edgeMat,
    baseEdgeOpacity: edgeMat ? edgeMat.opacity : 0,
    showroom,
    wallUniforms,
  };
}

/** Create or update a preview. Returns canvas or null if model not loaded yet. */
export function getPreviewCanvas(slotId: string, colorKey: string, vehicleType: VehicleType | null): HTMLCanvasElement | null {
  if (!vehicleType) return null;

  const MODEL_LOADED: Record<VehicleType, () => boolean> = {
    bike: isBikeModelLoaded,
    car: isCarModelLoaded,
    hoverboard: isHoverboardModelLoaded,
  };
  const loaded = MODEL_LOADED[vehicleType]();
  if (!loaded) {
    if (import.meta.env.DEV) console.warn(`[LOADOUT] ${vehicleType} model not loaded yet for slot=${slotId}`);
    return null;
  }

  const existing = _previews.get(slotId);
  if (existing && existing.colorKey === colorKey && existing.vehicleType === vehicleType) {
    if (!_spinning) _startSpin();
    return existing.canvas;
  }

  // Check suspended cache — reuse scene if color/vehicle still match
  const parked = _suspended.get(slotId);
  if (parked && parked.colorKey === colorKey && parked.vehicleType === vehicleType) {
    _suspended.delete(slotId);
    _previews.set(slotId, parked);
    if (!_spinning) _startSpin();
    return parked.canvas;
  }
  if (parked) { parked.scene.clear(); _suspended.delete(slotId); }

  if (existing) existing.scene.clear();

  const showroom = slotId.startsWith('cs-') || slotId.startsWith('vtile-');
  const entry = _createPreviewScene(colorKey, vehicleType, showroom);
  _previews.set(slotId, entry);
  if (!_spinning) _startSpin();
  return entry.canvas;
}

/** Request a preview that retries if model isn't loaded yet. Calls cb when ready. */
export function getPreviewCanvasDeferred(slotId: string, colorKey: string, vehicleType: VehicleType, cb: (canvas: HTMLCanvasElement) => void): HTMLCanvasElement | null {
  const canvas = getPreviewCanvas(slotId, colorKey, vehicleType);
  if (canvas) { cb(canvas); return canvas; }

  // Model not loaded yet — schedule retry
  _pendingRetries.set(slotId, { colorKey, vehicleType, cb });
  if (!_retryTimer) {
    _retryTimer = setInterval(() => {
      for (const [id, pending] of _pendingRetries) {
        const c = getPreviewCanvas(id, pending.colorKey, pending.vehicleType);
        if (c) {
          pending.cb(c);
          _pendingRetries.delete(id);
        }
      }
      if (_pendingRetries.size === 0 && _retryTimer) {
        clearInterval(_retryTimer);
        _retryTimer = null;
      }
    }, 300);
  }
  return null;
}

export function clearPreviews(): void {
  for (const [, entry] of _previews) entry.scene.clear();
  _previews.clear();
  for (const [, entry] of _suspended) entry.scene.clear();
  _suspended.clear();
  _pendingRetries.clear();
  if (_retryTimer) { clearInterval(_retryTimer); _retryTimer = null; }
  _stopSpin();
}

/** Remove previews whose slotId starts with `prefix` (e.g. "cs-" for loadout). */
export function clearPreviewsByPrefix(prefix: string): void {
  for (const [id, entry] of _previews) {
    if (!id.startsWith(prefix)) continue;
    entry.scene.clear();
    _previews.delete(id);
  }
  for (const [id, entry] of _suspended) {
    if (!id.startsWith(prefix)) continue;
    entry.scene.clear();
    _suspended.delete(id);
  }
  for (const id of _pendingRetries.keys()) {
    if (id.startsWith(prefix)) _pendingRetries.delete(id);
  }
  // Stop spin loop if no previews remain
  if (_previews.size === 0) _stopSpin();
}

/** Park previews — stop rendering but keep scene data for fast re-entry. */
export function suspendPreviewsByPrefix(prefix: string): void {
  for (const [id, entry] of _previews) {
    if (!id.startsWith(prefix)) continue;
    _suspended.set(id, entry);
    _previews.delete(id);
  }
  for (const id of _pendingRetries.keys()) {
    if (id.startsWith(prefix)) _pendingRetries.delete(id);
  }
  if (_previews.size === 0) _stopSpin();
}

function _startSpin(): void {
  if (_spinning) return;
  _spinning = true;
  _tick();
}

function _stopSpin(): void {
  _spinning = false;
  if (_animFrame !== null) { cancelAnimationFrame(_animFrame); _animFrame = null; }
}

function _tick(): void {
  if (!_spinning || _previews.size === 0) { _spinning = false; return; }
  _animFrame = requestAnimationFrame(_tick);

  const renderer = _getRenderer();
  const t = performance.now() * 0.001;
  const ms = performance.now();

  for (const [, entry] of _previews) {
    entry.pivot.rotation.y = t * 0.5;

    // Update trail shader time uniforms — drives the energy wave animations
    for (const u of entry.wallUniforms) {
      u.uTime.value = t;
    }

    // Edge glow breathing — matches trail.ts formula
    if (entry.edgeMat) {
      const breathe = 0.5 + 0.5 * Math.sin(ms * 0.001 * 1.8);
      entry.edgeMat.opacity = 0.28 + breathe * 0.1;
    }

    // Showroom uses in-game exposure (1.3); lobby tiles use slightly dimmer (1.1)
    renderer.toneMappingExposure = entry.showroom ? 1.3 : 1.1;

    // Render via EffectComposer (bloom!) instead of raw renderer
    const composer = _getComposer(entry.scene, entry.camera);
    composer.setSize(PREVIEW_SIZE, PREVIEW_SIZE);
    composer.render();

    const ctx = entry.canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, entry.canvas.width, entry.canvas.height);
      ctx.drawImage(renderer.domElement, 0, 0, entry.canvas.width, entry.canvas.height);
    }
  }
}
