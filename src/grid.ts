import * as THREE from 'three';
import type { MapType } from './types/index';
import { MAPS } from './types/index';
import { getGfx, bloomMul } from './graphics';
import { applyMapBloomOverride } from './mapBloomOverride';
import { setCameraCollisionMeshes } from './camera/cameraCollision';
import type { GfxSettings } from './types/index';
import { buildArenaV2 } from './arena/arenaV2Builder';
import { isArenaModelLoaded } from './arenaModel';
import { buildArenaClassic } from './arena/arenaClassicBuilder';
import { buildArenaSynthCity, disposeSynthCity } from './arena/arenaSynthCityBuilder';
import {
  buildSpectatorDrone,
  buildStarfield,
  buildOrbiters,
  logGpuBudget,
} from './arena/arenaProps';
import { getSharedWallTexture } from './arena/arenaWallTexture';
import {
  type ReactiveState,
  createReactiveState,
} from './arena/arenaState';
import { loadColorProfile } from './arena/arenaTheme';
import { createAtmosphere, disposeAtmosphere } from './atmosphere';
import type { BloomPassLike } from './types/index';
// ── Re-exported shape helpers (public API preserved) ─────
export { ARENA_SIZE, setGridArenaShape, isOutOfBounds } from './arena/arenaShape';

// ── Re-exported theme (public API preserved) ────────────
export {
  STAND_COLORS,
  ARENA_BLACK,
  ARENA_PANEL_TEAL,
  ARENA_TEAL,
  ARENA_TEAL_BRIGHT,
  ARENA_CYAN_HERO,
  ARENA_ORANGE,
  ARENA_ORANGE_DEEP,
  ARENA_GOLD,
  ARENA_GOLD_DEEP,
  ARENA_MIST,
  FLOOD_LIGHT_SETTINGS,
  ARENA_VISUAL_ROLES,
  MAP_COLOR_PROFILES,
  loadColorProfile,
  saveColorProfile,
  getActiveColorProfile,
  forEachStandardMaterial,
  applyArenaRole,
  setArenaRoleReactiveIntensity,
} from './arena/arenaTheme';
export type { ArenaVisualRoleId } from './arena/arenaTheme';

// ── Re-exported reactive state types (public API preserved) ──
export type {
  TierStrip,
  SatelliteEntry,
  FlyoverShipEntry,
  SpectatorDrone,
  RaveSpot,
  ReactiveState,
} from './arena/arenaState';

// Reactive references populated by createArena
let reactive: ReactiveState | null = null;

/** Scene children that belong to the arena (not players/trails). Populated
 *  at the end of createArena so cleanup can skip them. */
let _arenaSceneChildren: Set<THREE.Object3D> = new Set();

/** Expose reactive state for admin debug panel */
export function getArenaReactive(): ReactiveState | null { return reactive; }

/** Returns true if the object is an arena child that cleanup should preserve. */
export function isArenaChild(obj: THREE.Object3D): boolean {
  return _arenaSceneChildren.has(obj);
}

/** Register a late-arriving arena child (e.g. async-loaded skybox, moon, dome
 *  model) so cleanupGame's isArenaChild check will protect it. Call this from
 *  async scene.add callbacks that fire after createArena's snapshot. */
export function registerArenaChild(obj: THREE.Object3D): void {
  _arenaSceneChildren.add(obj);
}

/** Return arena meshes suitable for camera collision raycasting. */
export function getCameraCollisionMeshes(): THREE.Mesh[] {
  if (!reactive) return [];
  return [
    ...reactive.barriers,
    ...reactive.v2WallBarrier,
    ...reactive.v2ArenaWall,
    ...reactive.v2ArenaFloor,
  ];
}

export function createArena(scene: THREE.Scene, mapType: MapType = 'midtown_bowl'): void {
  // Validate map type — fall back to default if unknown
  if (!MAPS.some(m => m.id === mapType)) {
    console.warn(`[createArena] unknown mapType "${mapType}", falling back to midtown_bowl`);
    mapType = 'midtown_bowl';
  }

  // midtown_bowl needs the arena GLB. If we build now, cloneArenaModel returns
  // an empty Group and the fast-path below will reuse that broken arena
  // forever. Defer — loadingScreen triggers _restartDemo once the GLB resolves.
  if (mapType === 'midtown_bowl' && !isArenaModelLoaded()) {
    if (import.meta.env.DEV) console.log('[createArena] deferring midtown_bowl — arena GLB not loaded yet');
    return;
  }

  // ── Fast path: reuse existing arena if same map ────────
  // The menu demo already built this arena — skip the expensive rebuild
  // and just re-register collision meshes + atmosphere.
  if (reactive && reactive.mapType === mapType && _arenaSceneChildren.size > 0) {
    if (import.meta.env.DEV) console.log(`[createArena] reusing ${mapType} arena (fast path)`);
    const gfx: GfxSettings = getGfx();
    // Re-wire atmosphere (was disposed during previous cleanup)
    if (!reactive.atmosphere) {
      const atmoRenderer = scene.userData._renderer as THREE.WebGLRenderer;
      const ambientLight = scene.getObjectByName('luminal_base_ambient') as THREE.AmbientLight | null;
      const bloomPass = scene.userData._bloomPass as BloomPassLike | null;
      reactive.atmosphere = createAtmosphere(scene, gfx, atmoRenderer, ambientLight, bloomPass);
    }
    reactive.fireworks = null;
    applyMapBloomOverride(mapType, gfx);
    setCameraCollisionMeshes(getCameraCollisionMeshes());
    return;
  }

  const gfx: GfxSettings = getGfx();

  scene.fog = null;

  // Remove old arena scene children if switching maps
  if (_arenaSceneChildren.size > 0) {
    for (const child of _arenaSceneChildren) {
      if (child.parent === scene) scene.remove(child);
    }
    _arenaSceneChildren.clear();
  }

  // Dispose previous atmosphere state before tearing down arena
  if (reactive?.atmosphere) {
    const renderer = scene.userData._renderer as THREE.WebGLRenderer;
    disposeAtmosphere(reactive.atmosphere, renderer);
  }

  // Dispose previous reflector render target + geometry
  if (reactive?.reflector) {
    reactive.reflector.geometry.dispose();
    reactive.reflector.dispose();
    reactive.reflector.removeFromParent();
  }

  // Tear down per-map synth_city runtime state if we're switching away.
  if (reactive?.synthCity) {
    disposeSynthCity(reactive, scene);
  }

  reactive = createReactiveState(mapType);

  // Load per-map color profile into the live ARENA_VISUAL_ROLES
  loadColorProfile(mapType);

  // ── Shared: Shooting-star streak wall texture ───────────
  const cachedWallTexture = getSharedWallTexture();
  reactive.flowTexture = cachedWallTexture;

  const isArenaV2: boolean = mapType === 'midtown_bowl';

  let portholeR: number;
  let roofY: number;
  if (mapType === 'midtown_bowl') {
    ({ portholeR, roofY } = buildArenaV2(scene, reactive, gfx, mapType, cachedWallTexture));
  } else if (mapType === 'synth_city') {
    ({ portholeR, roofY } = buildArenaSynthCity(scene, reactive, gfx, mapType, cachedWallTexture));
  } else {
    ({ portholeR, roofY } = buildArenaClassic(scene, reactive, gfx, mapType, cachedWallTexture));
  }

  reactive.laserBeams = null;

  // ── Per-map bloom override (synth_city uses synthcity's hotter curve) ──
  applyMapBloomOverride(mapType, gfx);

  // ── Shared: Spectator Drone ─────────────────────────────
  buildSpectatorDrone(scene, reactive, gfx);

  // ── Shared: Starfield (ShaderMaterial + GPU twinkle) ────
  buildStarfield(scene, reactive, gfx, portholeR, roofY, isArenaV2);

  // ── Shared: Satellites + Flyover Ships ──────────────────
  // synth_city supplies its own aerial traffic via GeneratorTraffic, so we
  // skip Luminal's flyover/satellite decor on that map only.
  if (mapType !== 'synth_city') {
    buildOrbiters(scene, reactive, gfx, portholeR, roofY);
  }

  // ── Atmosphere ─────────────────────────────────────────
  // Regenerate PMREM env map using the haze-free lighting setup.
  if (isArenaV2) {
    const pmrem = new THREE.PMREMGenerator(scene.userData._renderer as THREE.WebGLRenderer);
    pmrem.compileCubemapShader();
    pmrem.fromScene(scene, 0, 0.1, 500);
    pmrem.dispose();
  }

  // Wire up atmosphere system (fog, mist layers)
  const atmoRenderer = scene.userData._renderer as THREE.WebGLRenderer;
  const ambientLight = scene.getObjectByName('luminal_base_ambient') as THREE.AmbientLight | null;
  const bloomPass = scene.userData._bloomPass as BloomPassLike | null;
  reactive.atmosphere = createAtmosphere(scene, gfx, atmoRenderer, ambientLight, bloomPass);

  // ── Shared: Fireworks ───────────────────────────────────
  reactive.fireworks = null;

  // ── GPU Budget Summary ─────────────────────────────────
  logGpuBudget(scene, reactive, gfx);

  // Register arena meshes for camera collision avoidance
  setCameraCollisionMeshes(getCameraCollisionMeshes());

  // Snapshot current scene children as "arena objects" so cleanup can skip them
  _arenaSceneChildren = new Set(scene.children.filter(
    c => c !== (scene.userData._camera as THREE.Object3D),
  ));
}

export function setSpectatorTargets(targets: Array<{ x: number; z: number } | null>): void {
  if (reactive) reactive._trackTargets = targets;
}

// Update arena wall glow based on nearest player distance
export function updateWallGlow(nearestWallDist: number): void {
  if (!reactive || !reactive.baseStripMat) return;
  const range: number = 8;
  const proximity: number = nearestWallDist < range ? (1 - nearestWallDist / range) : 0;
  reactive.baseStripMat.emissiveIntensity = (1.2 + proximity * 1.0) * bloomMul.lights;
}



// Re-exports for backward compat — effects extracted to arenaEffects.ts (audit 1.6)
export { updateArenaAudio } from './arenaEffects';
export { triggerCountdownPulse, clearCountdownPulses, updateCountdownPulses } from './arenaEffects';
export type { AudioBands } from './arenaEffects';
