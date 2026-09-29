import * as THREE from 'three';
import type { GfxSettings, AtmosphereLevel } from './types/index';
import { onSettingsChange } from './graphics';

// ── Types ────────────────────────────────────────────────

/** Minimal audio band subset needed by atmosphere */
interface AtmoBands {
  bass: number;
  energy: number;
  kick: number;
}

/** Game states that affect atmosphere density/speed */
type GameState = 'menu' | 'countdown' | 'playing' | 'transition' | 'waitingOnline' | 'paused' | 'gameover';

/** Per-state multipliers for atmosphere intensity */
const STATE_MULTIPLIERS: Record<GameState, { density: number; speed: number }> = {
  menu:          { density: 1.0,  speed: 1.0 },
  countdown:     { density: 1.2,  speed: 1.0 },
  playing:       { density: 1.0,  speed: 1.0 },
  gameover:      { density: 0.7,  speed: 0.8 },
  transition:    { density: 0.3,  speed: 0.5 },
  paused:        { density: 1.0,  speed: 0.0 },
  waitingOnline: { density: 1.0,  speed: 1.0 },
};

/** Atmosphere state handle — stored on grid reactive state */
export interface AtmosphereState {
  scene: THREE.Scene;
  level: AtmosphereLevel;
  mistMeshes: THREE.Mesh[];
  ambientLight: THREE.AmbientLight | null;
  currentDensityMul: number;
  currentSpeedMul: number;
  elapsed: number;
  bloomPass: { strength: number; radius: number; threshold: number } | null;
  active: boolean;
  fogReactiveRange: number;
  adminFreeze: boolean;
}

// ── Constants ────────────────────────────────────────────

const FOG_COLOR = 0x04181a;
const FOG_BASE_DENSITY = 0.0003;
const FOG_REACTIVE_RANGE = 0.0006;

const LERP_SPEED = 2.0;

// ── Mist Layer Constants ─────────────────────────────────

const MIST_WARM_COLOR = new THREE.Color(0x3a2a18);
const MIST_BASE_OPACITY = 0.12;
const MIST_NOISE_SCALE = 0.025;
const MIST_BASE_SPEED = 0.05;
const MIST_WIND_SHIFT = 0.012;
/** Controls how fast the wind direction sweeps (radians/sec). Admin-tunable. */
let _mistWindSpeed = 0.07;

// Stacked mist layers: ground fog → above-camera haze
// Camera is at Y≈7.35, look-at Y≈2 — layers need to be in that sight line and above
// Each layer gets its own base color tint — warmer near ground, cooler/purple at altitude
const MIST_LAYERS: { y: number; opacityScale: number; speedScale: number; timeOffset: number; size: number; color: THREE.Color }[] = [
  { y: 1.6,  opacityScale: 1.0,  speedScale: 1.0,  timeOffset: 0,   size: 384, color: new THREE.Color(0x1a4a50) }, // teal ground fog
  { y: 4.0,  opacityScale: 0.55, speedScale: 1.2,  timeOffset: 40,  size: 444, color: new THREE.Color(0x1e3e4a) }, // desaturated teal
  { y: 9.5,  opacityScale: 0.22, speedScale: 0.8,  timeOffset: 90,  size: 504, color: new THREE.Color(0x1a2a42) }, // steel blue (raised from 7.5; reduced opacity)
  { y: 11.0, opacityScale: 0.12, speedScale: 1.4,  timeOffset: 150, size: 564, color: new THREE.Color(0x1c2040) }, // deep indigo
];

const MIST_VERTEX = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const MIST_FRAGMENT = `
  uniform float uTime;
  uniform vec3  uColor;
  uniform float uOpacity;
  uniform float uNoiseScale;
  uniform float uSpeed;
  uniform float uWindShift;
  uniform float uWindSpeed;
  varying vec2  vUv;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
      f.y
    );
  }
  float fbm(vec2 p) {
    float v = 0.0;
    v += 0.5   * noise(p); p *= 2.1;
    v += 0.25  * noise(p); p *= 2.3;
    v += 0.125 * noise(p);
    return v;
  }

  void main() {
    vec2 worldUv = vUv * (1.0 / uNoiseScale);
    float drift = uTime * uSpeed;

    // Rotating wind — shifts the noise sampling origin over time
    float windAngle = uTime * uWindSpeed;
    float windR = uTime * uWindShift;
    vec2 wind = vec2(cos(windAngle), sin(windAngle)) * windR;
    float windAngle2 = uTime * uWindSpeed * 0.618 + 2.39;
    vec2 wind2 = vec2(cos(windAngle2), sin(windAngle2)) * windR * 0.7;

    float n  = fbm(worldUv + vec2(drift, drift * 0.7) + wind);
    float n2 = fbm(worldUv * 1.4 + vec2(-drift * 0.5, drift * 0.3) + wind2 * 0.6);
    float n3 = fbm(worldUv * 0.7 + vec2(drift * 0.3, -drift * 0.5) + wind * 0.4);
    float combined = n * 0.5 + n2 * 0.3 + n3 * 0.2;

    // Radial fade — thickest at center, very gradual fade to avoid visible circle edge
    vec2 center = vUv - 0.5;
    float radial = 1.0 - smoothstep(0.15, 0.50, length(center));

    float alpha = combined * uOpacity * radial;
    gl_FragColor = vec4(uColor, alpha);
  }
`;

// ── Early Mist (shown before arena loads) ────────────────

/** Create standalone mist layers for the loading screen. Returns the array
 *  so the caller can stash it on scene.userData and remove it later. */
// ts-prune-ignore-next
export function createEarlyMist(scene: THREE.Scene): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  for (const layer of MIST_LAYERS) {
    const geo = new THREE.PlaneGeometry(layer.size, layer.size);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime:       { value: layer.timeOffset },
        uColor:      { value: layer.color.clone() },
        uOpacity:    { value: MIST_BASE_OPACITY * layer.opacityScale },
        uNoiseScale: { value: MIST_NOISE_SCALE },
        uSpeed:      { value: MIST_BASE_SPEED * layer.speedScale },
        uWindShift:  { value: MIST_WIND_SHIFT },
        uWindSpeed:  { value: _mistWindSpeed },
      },
      vertexShader: MIST_VERTEX,
      fragmentShader: MIST_FRAGMENT,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = layer.y;
    mesh.renderOrder = 999;
    scene.add(mesh);
    meshes.push(mesh);
  }
  return meshes;
}

/** Advance early mist time uniforms so layers animate during loading. */
// ts-prune-ignore-next
export function updateEarlyMist(meshes: THREE.Mesh[], dt: number): void {
  for (const mesh of meshes) {
    (mesh.material as THREE.ShaderMaterial).uniforms.uTime.value += dt;
  }
}

/** Remove and dispose all early mist meshes. */
// ts-prune-ignore-next
export function disposeEarlyMist(scene: THREE.Scene): void {
  const meshes = scene.userData._earlyMist as THREE.Mesh[] | undefined;
  if (!meshes) return;
  for (const mesh of meshes) {
    scene.remove(mesh);
    mesh.geometry.dispose();
    (mesh.material as THREE.ShaderMaterial).dispose();
  }
  scene.userData._earlyMist = null;
}

// ── Public API ───────────────────────────────────────────

// ts-prune-ignore-next
export function getMistWindSpeed(): number { return _mistWindSpeed; }
// ts-prune-ignore-next
export function setMistWindSpeed(v: number): void { _mistWindSpeed = v; }

// ts-prune-ignore-next
export function createAtmosphere(
  scene: THREE.Scene,
  gfx: GfxSettings,
  _renderer: THREE.WebGLRenderer,
  ambientLight: THREE.AmbientLight | null,
  bloomPass?: { strength: number; radius: number; threshold: number } | null,
): AtmosphereState {
  const state: AtmosphereState = {
    scene,
    level: gfx.atmosphere,
    mistMeshes: [],
    ambientLight,
    currentDensityMul: 1.0,
    currentSpeedMul: 1.0,
    elapsed: 0,
    bloomPass: bloomPass ?? null,
    active: true,
    fogReactiveRange: FOG_REACTIVE_RANGE,
    adminFreeze: false,
  };

  applyLevel(state, gfx.atmosphere);

  onSettingsChange((g: GfxSettings) => {
    if (!state.active) return;
    if (g.atmosphere !== state.level) {
      applyLevel(state, g.atmosphere);
    }
  });

  return state;
}

// ts-prune-ignore-next
export function updateAtmosphere(
  state: AtmosphereState,
  dt: number,
  bands: AtmoBands,
  gfx: GfxSettings,
  gameState: string,
): void {
  if (state.level === 'off') return;

  // Paused/waiting: hold current atmosphere values
  if (gameState === 'paused' || gameState === 'waitingOnline') return;

  // Lerp state multipliers
  const target = STATE_MULTIPLIERS[gameState as GameState] ?? STATE_MULTIPLIERS.playing;
  state.currentDensityMul += (target.density - state.currentDensityMul) * Math.min(1, LERP_SPEED * dt);
  state.currentSpeedMul += (target.speed - state.currentSpeedMul) * Math.min(1, LERP_SPEED * dt);

  state.elapsed += dt * state.currentSpeedMul;

  // Admin panel freeze: only advance time, skip reactive uniform writes
  if (state.adminFreeze) {
    if (state.mistMeshes.length && state.level === 'full') {
      for (let i = 0; i < state.mistMeshes.length; i++) {
        (state.mistMeshes[i].material as THREE.ShaderMaterial).uniforms.uTime.value = state.elapsed + MIST_LAYERS[i].timeOffset;
      }
    }
    return;
  }

  // Layer 1: FogExp2 reactive density
  if (state.scene.fog && (state.scene.fog as THREE.FogExp2).density !== undefined) {
    const fog = state.scene.fog as THREE.FogExp2;
    fog.density = (FOG_BASE_DENSITY + bands.energy * state.fogReactiveRange) * state.currentDensityMul;
  }

  // Layer 2: Stacked mist planes
  if (state.mistMeshes.length && state.level === 'full') {
    const baseOpacity = (MIST_BASE_OPACITY + bands.kick * 0.15) * state.currentDensityMul;
    const baseSpeed = (MIST_BASE_SPEED + bands.energy * 0.015) * state.currentSpeedMul;
    for (let i = 0; i < state.mistMeshes.length; i++) {
      const layer = MIST_LAYERS[i];
      const mat = state.mistMeshes[i].material as THREE.ShaderMaterial;
      mat.uniforms.uTime.value = state.elapsed + layer.timeOffset;
      mat.uniforms.uOpacity.value = baseOpacity * layer.opacityScale;
      mat.uniforms.uSpeed.value = baseSpeed * layer.speedScale;
      const color = mat.uniforms.uColor.value as THREE.Color;
      color.copy(layer.color).lerp(MIST_WARM_COLOR, bands.energy * 0.4);
    }
  }

}

// ts-prune-ignore-next
export function disposeAtmosphere(
  state: AtmosphereState,
  _renderer: THREE.WebGLRenderer,
): void {
  state.active = false;
  state.scene.fog = null;

  for (const mesh of state.mistMeshes) {
    state.scene.remove(mesh);
    mesh.geometry.dispose();
    (mesh.material as THREE.ShaderMaterial).dispose();
  }
  state.mistMeshes = [];

  state.level = 'off';
}

// ── Internal ─────────────────────────────────────────────

function createMist(state: AtmosphereState): void {
  if (state.mistMeshes.length) return; // already exists

  for (const layer of MIST_LAYERS) {
    const geo = new THREE.PlaneGeometry(layer.size, layer.size);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime:       { value: layer.timeOffset },
        uColor:      { value: layer.color.clone() },
        uOpacity:    { value: MIST_BASE_OPACITY * layer.opacityScale },
        uNoiseScale: { value: MIST_NOISE_SCALE },
        uSpeed:      { value: MIST_BASE_SPEED * layer.speedScale },
        uWindShift:  { value: MIST_WIND_SHIFT },
        uWindSpeed:  { value: _mistWindSpeed },
      },
      vertexShader: MIST_VERTEX,
      fragmentShader: MIST_FRAGMENT,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = layer.y;
    mesh.renderOrder = 999;
    state.scene.add(mesh);
    state.mistMeshes.push(mesh);
  }
}

function applyLevel(
  state: AtmosphereState,
  level: AtmosphereLevel,
): void {
  state.level = level;

  if (level === 'off') {
    state.scene.fog = null;
    removeMist(state);
    return;
  }

  // haze and full both get FogExp2 — don't override exposure/ambient/bloom,
  // those are owned by the per-map system and the user's gfx preset.
  state.scene.fog = new THREE.FogExp2(FOG_COLOR, FOG_BASE_DENSITY);

  if (level === 'haze') {
    removeMist(state);
  }
  if (level === 'full') {
    createMist(state);
  }
}

function removeMist(state: AtmosphereState): void {
  for (const mesh of state.mistMeshes) {
    state.scene.remove(mesh);
    mesh.geometry.dispose();
    (mesh.material as THREE.ShaderMaterial).dispose();
  }
  state.mistMeshes = [];
}
