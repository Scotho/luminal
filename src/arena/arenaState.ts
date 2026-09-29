import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import type { MapType } from '../types/index';
import type { AtmosphereState } from '../atmosphere';
import type {
  Generator,
  GeneratorCityBlock,
  GeneratorCityLight,
  GeneratorTraffic,
  LightPoolEntry,
} from './synthcity';
import type { FireworksSystem } from '../fireworks/fireworksSystem';

// ── Reactive Arena State ─────────────────────────────────

export interface TierStrip {
  mesh: THREE.Mesh;
  tier: number;
  baseIntensity: number;
  phase: number;
  drift: number;
}

export interface SatelliteEntry {
  mesh: THREE.Group;
  orbitR: number;
  orbitY: number;
  orbitSpeed: number;
  startAngle: number;
  blink: THREE.PointLight;
}

export interface FlyoverShipEntry {
  mesh: THREE.Group;
  orbitR: number;
  orbitY: number;
  orbitSpeed: number;
  startAngle: number;
}

export interface SpectatorDrone {
  mesh: THREE.Group;
  angle: number;
  recLight: THREE.PointLight;
  orbitR: number;
  targetR: number;
  flyY: number;
  targetY: number;
  bankAngle: number;
  pitchAngle: number;
  // Integrator velocities (persist across frames)
  _angVel?: number;
  _radVel?: number;
  _yVel?: number;
  _facingVel?: number;
  _pitchVel?: number;
  _bankVel?: number;
  // Smoothed facing / look-target state
  _facingAngle?: number;
  _lookX?: number;
  _lookY?: number;
  _lookZ?: number;
  _lookVelX?: number;
  _lookVelY?: number;
  _lookVelZ?: number;
  // Chase-mode hysteresis
  _latchedTargetIdx?: number;
  _desiredAngle?: number;
  // Initialization flag — first update seeds smoothed state from current pose
  _initialized?: boolean;
}

export interface RaveSpot {
  light: THREE.SpotLight;
  baseAngle: number;
  speed: number;
  phase: number;
  radius: number;
  baseY: number;
  sweepDir: 1 | -1;        // +1 = right sweep, -1 = left sweep
  restAngle: number;        // angle where this spot pauses (radians)
}

/** Per-map runtime state for the synth_city map. Null on every other map. */
export interface SynthCityRuntimeState {
  /** Parent group for synthcity procgen content. Translated DOWN by
   *  (BASE_HEIGHT + 0.5) so synthcity-local y=130.5 (the flat top level)
   *  lands at Luminal world y=0 (bike level). */
  root: THREE.Group;
  /** Hand-built wide base box living in root-local synthcity coordinates.
   *  After root translation it extends from world y=-130.5 to y=-0.5 — the
   *  podium beneath the reflector. */
  baseBox: THREE.Mesh;
  /** Placeholder material used by the base box until SynthCityAssets
   *  resolves and the real mega_building_01 material replaces it. Kept on
   *  the state so the async swap callback can dispose the placeholder
   *  cleanly without disposing the singleton that replaced it. */
  baseBoxPlaceholderMat: THREE.Material | null;
  /** Perimeter walls + their dark backings — use Luminal's shared
   *  shooting-star canvas texture. Scene-level (not parented to root) so
   *  they live in unscaled world-space at y≈BARRIER_H/2. */
  walls: THREE.Mesh[];
  backings: THREE.Mesh[];
  /** Synthcity-local → Luminal-world offset for the generators' virtual
   *  camera reader (mirrors the sync between the translated root and the
   *  generators' expected frame of reference). */
  offsetX: number;
  offsetZ: number;
  /** Pooled point lights used by GeneratorCityLight. */
  lightPool: LightPoolEntry[];
  /** Set once SynthCityAssets resolves; null during the async load window. */
  cityGenerator: Generator<GeneratorCityBlock> | null;
  lightGenerator: Generator<GeneratorCityLight> | null;
  trafficGenerator: Generator<GeneratorTraffic> | null;
  /** Scene fog installed by the builder (kept here for explicit teardown). */
  fog: THREE.Fog;
  /** Saved scene.background before the builder overwrote it — restored on
   *  dispose so other maps start with their default dark background. */
  savedBackground: THREE.Color | THREE.Texture | null;
  /** Luminal scene-level lights temporarily dimmed while synth_city is
   *  active. Saved here so dispose can restore them. */
  savedLights: Array<{ light: THREE.Light; intensity: number }>;
}

export interface ReactiveState {
  tierStrips: TierStrip[];
  stadLights: THREE.PointLight[];
  accentRings: THREE.Mesh[];
  gridMain: THREE.GridHelper | null;
  barriers: THREE.Mesh[];
  floorMat: THREE.MeshStandardMaterial | null;
  flowTexture: THREE.CanvasTexture | null;
  laserBeams: THREE.Line[] | null;
  satellites: SatelliteEntry[] | null;
  flyoverShips: FlyoverShipEntry[] | null;
  starMesh: THREE.Points | null;
  starMaterial: THREE.ShaderMaterial | null;
  starBaseSizes: Float32Array | null;
  fireworks: FireworksSystem | null;
  spectatorDrone: SpectatorDrone | null;
  baseStripMat?: THREE.MeshStandardMaterial;
  skyMesh?: THREE.Object3D;
  moonMesh?: THREE.Object3D;
  raveSpots: RaveSpot[];
  _outerWallR?: number;
  _rimTopY?: number;
  _trackTargets?: Array<{ x: number; z: number } | null>;
  // arena_v2 reactive meshes
  v2FloodLights: THREE.Mesh[];
  v2GlowCyan: THREE.Mesh[];
  v2GlowBlue: THREE.Mesh[];
  v2Windows: THREE.Mesh[];
  v2WallBarrier: THREE.Mesh[];
  v2ArenaWall: THREE.Mesh[];
  v2ArenaFloor: THREE.Mesh[];
  v2CrowdStands: THREE.Mesh[];
  v2Buildings: THREE.Mesh[];
  v2CoolTrim: THREE.Mesh[];
  v2WallBody: THREE.Mesh[];
  v2WallMarkers: THREE.Mesh[];
  v2WallHazards: THREE.Mesh[];
  v2SkylineEdges: THREE.Mesh[];
  v2BuildingFaces: THREE.Mesh[];
  v2BuildingAccentWindows: THREE.Mesh[];
  reflector: Reflector | null;
  atmosphere: AtmosphereState | null;
  synthCity: SynthCityRuntimeState | null;
  mapType: MapType;
}

export function createReactiveState(mapType: MapType): ReactiveState {
  return {
    tierStrips: [],
    stadLights: [],
    accentRings: [],
    gridMain: null,
    barriers: [],
    floorMat: null,
    flowTexture: null,
    laserBeams: null,
    satellites: null,
    flyoverShips: null,
    starMesh: null,
    starMaterial: null,
    starBaseSizes: null,
    fireworks: null,
    spectatorDrone: null,
    raveSpots: [],
    v2FloodLights: [],
    v2GlowCyan: [],
    v2GlowBlue: [],
    v2Windows: [],
    v2WallBarrier: [],
    v2ArenaWall: [],
    v2ArenaFloor: [],
    v2CrowdStands: [],
    v2Buildings: [],
    v2CoolTrim: [],
    v2WallBody: [],
    v2WallMarkers: [],
    v2WallHazards: [],
    v2SkylineEdges: [],
    v2BuildingFaces: [],
    v2BuildingAccentWindows: [],
    reflector: null,
    atmosphere: null,
    synthCity: null,
    mapType,
  };
}
