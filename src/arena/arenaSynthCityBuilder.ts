// Synth City map models and textures by Jeff Beene
// https://github.com/jeffbeene/synthcity — used with permission.

import * as THREE from 'three';
import type { GfxSettings, MapType } from '../types/index';
import type { ReactiveState, SynthCityRuntimeState } from './arenaState';
import { setArenaShape } from '../core/simulation';
import { setGridArenaShape } from './arenaShape';
import { buildFloorReflector } from './arenaSharedPieces';
import { getSharedWallTexture } from './arenaWallTexture';
import { enableReflection } from '../renderLayers';
import {
  Generator,
  GeneratorCityBlock,
  GeneratorCityLight,
  GeneratorTraffic,
  Perlin,
  getSynthCityAssets,
  type SynthCityAssets,
  type LightPoolEntry,
  type CityBlockContext,
} from './synthcity';
import {
  SEED,
  CELL_STEP,
  CITY_BLOCK_CELL_COUNT,
  CITY_LIGHTS_CELL_COUNT,
  CITY_LIGHTS_CELL_STEP_MUL,
  CITY_LIGHTS_POOL_SIZE,
  TRAFFIC_CELL_COUNT,
  NOISE_DETAIL_LOD,
  NOISE_DETAIL_FALLOFF,
  BASE_WIDTH,
  BASE_HEIGHT,
  PLATFORM_CENTER_X,
  PLATFORM_CENTER_Z,
} from './synthcity/constants';

export interface ArenaSynthCityBuildResult {
  portholeR: number;
  roofY: number;
}

// ── Arena sizing + coordinate mapping ──────────────────────────────────
//
// Synthcity standalone layout (synthcity-local world):
//   procgen city ground plane:  y = 0
//   base box bottom:             y = 0
//   base box top:                y = BASE_HEIGHT = 130
//   flat top plane:              y = 130.5
//   player eye:                  y = 145
//
// The standalone player is ~145 units ABOVE the surrounding city ground —
// standing on a podium with buildings rising past eye level on all sides.
//
// Luminal bikes live at world y=0 (the bike mesh position, fixed convention).
// To reproduce the standalone's "elevated podium" feel, we translate the
// entire synthcity content DOWN by ROOT_Y_OFFSET = -(BASE_HEIGHT + 0.5).
// After translation:
//   synthcity-local y=130.5 (flat top level) → world y=0   ← bikes ride here
//   synthcity-local y=0     (city street)    → world y=-130.5
//   synthcity-local y=300   (tall building)  → world y=169.5
// Result: bikes race on the reflector at world y=0, the procgen city sits
// below them by ~130 units, buildings rise past them into the sky.
const ROOT_Y_OFFSET = -(BASE_HEIGHT + 0.5);

// Arena shape — sized to match the base box so there's no exposed ledge.
// The demo's podium is 456×456; reflector + walls cover the full top.
const PLATFORM_TOP_HALF = BASE_WIDTH / 2;   // 228

// Perimeter wall height — matches the classic arena for visual consistency.
const BARRIER_H = 12;

// Camera far plane — Luminal's default 800 clips the entire procgen grid
// (which extends ~3000 units from origin). Synthcity's original used 2800.
const SYNTH_CAMERA_FAR = 2800;
const LUMINAL_CAMERA_FAR = 800;

// Scene background while synth_city is active — matches the fog color so
// geometry fades seamlessly at the fog far limit instead of revealing a
// near-black void behind it. Restored on dispose.
const SYNTH_BG_COLOR = 0x12122a;

// Exposure override — synthcity standalone used 1.0, Luminal defaults to
// preset-driven values (1.25 for 'high'). The 25% brighter exposure was
// pushing the pmndrs bloom toward wash-out on synth_city. Pin to 1.0.
const SYNTH_EXPOSURE = 1.0;
const LUMINAL_DEFAULT_EXPOSURE = 1.0;  // preset=high; restored on dispose

// Fog — linear THREE.Fog based on synthcity/src/index.js env.night.
// Demo used near=0, far=2700 which is too heavy for the overhead game
// camera (you lose distant buildings). Pushed far out to let smoke
// billboards handle the atmospheric distance haze instead.
const FOG_COLOR = 0x12122a;
const FOG_NEAR = 0;
const FOG_FAR = 4500;

// Sun + ambient lifted from synthcity/src/index.js:480-498 (night preset).
// These are the ONLY lights synth_city wants — Luminal's base lights get
// temporarily dimmed so this lighting rig dominates.
const SUN_COLOR = 0x8b79ff;
const SUN_INTENSITY = 0.1;
const AMBIENT_COLOR = 0x1b2c80;
const AMBIENT_INTENSITY = 0.5;

const LUMINAL_BASE_LIGHT_NAMES = [
  'luminal_base_ambient',
  'luminal_base_dirLight',
  'luminal_base_fillLight',
];

/**
 * Build the synth_city map.
 *
 * Structure (post-fix):
 *   • Scene-level, untranslated:
 *     - Reflector at world y=0 (the platform top surface — Luminal owns this)
 *     - Scene.fog, scene.background, scene.toneMappingExposure overrides
 *   • Root group, translated to y=-(BASE_HEIGHT + 0.5):
 *     - Base box (podium under the reflector)
 *     - Procgen city (buildings, ground planes, ads, toppers, smoke, spotlights, traffic)
 *     - City-light point lights
 *     - Synthcity sun + ambient
 *
 * No flat top plane (reflector is the floor). No visible perimeter walls
 * (isOutOfBounds handles containment; procgen buildings visually box you in).
 * No overlay grid (standalone had none).
 */
export function buildArenaSynthCity(
  scene: THREE.Scene,
  reactive: ReactiveState,
  gfx: GfxSettings,
  mapType: MapType,
  cachedWallTexture: THREE.CanvasTexture,
): ArenaSynthCityBuildResult {
  // ── Arena shape + camera far plane ─────────────────────
  setGridArenaShape(false, PLATFORM_TOP_HALF);
  setArenaShape(false, PLATFORM_TOP_HALF);

  const activeCam = scene.userData._camera as THREE.PerspectiveCamera | undefined;
  if (activeCam) {
    activeCam.far = SYNTH_CAMERA_FAR;
    activeCam.updateProjectionMatrix();
  }

  // ── Override scene.background so fog fades to matching navy ──
  const savedBackground = scene.background as THREE.Color | THREE.Texture | null;
  scene.background = new THREE.Color(SYNTH_BG_COLOR);

  // ── Dim Luminal's base lights (fix #3) ─────────────────
  // Synthcity materials are tuned for a pure navy fill — Luminal's default
  // teal ambient/dirLight/hemi wash produces a muddy dim look. Save their
  // intensities and zero them for the duration of this map.
  const savedLights: Array<{ light: THREE.Light; intensity: number }> = [];
  for (const name of LUMINAL_BASE_LIGHT_NAMES) {
    const light = scene.getObjectByName(name) as THREE.Light | undefined;
    if (light) {
      savedLights.push({ light, intensity: light.intensity });
      light.intensity = 0;
    }
  }

  // ── Renderer exposure override (fix #5) ────────────────
  const renderer = scene.userData._renderer as THREE.WebGLRenderer | undefined;
  if (renderer) {
    renderer.toneMappingExposure = SYNTH_EXPOSURE;
  }

  // ── Synthcity-local root group ─────────────────────────
  // See the comment block above ROOT_Y_OFFSET for the coordinate math.
  const root = new THREE.Group();
  root.name = 'synth_city_root';
  root.position.set(-PLATFORM_CENTER_X, ROOT_Y_OFFSET, -PLATFORM_CENTER_Z);
  scene.add(root);

  // ── Fog ────────────────────────────────────────────────
  // grid.ts:83 sets scene.fog = null before each map build, so this override
  // is undone automatically on the next map switch.
  const fog = new THREE.Fog(FOG_COLOR, FOG_NEAR, FOG_FAR);
  scene.fog = fog;

  // ── Synthcity lights (only sun + ambient, no hemisphere) ──
  // Attached to root so they ride the translation. AmbientLight position is
  // irrelevant (it's directionless) but DirectionalLight.position defines the
  // angle — standalone used (1, 0.5, 0.25) as a pure direction vector.
  const sun = new THREE.DirectionalLight(SUN_COLOR, SUN_INTENSITY);
  sun.position.set(1, 0.5, 0.25);
  root.add(sun);
  root.add(sun.target);
  root.add(new THREE.AmbientLight(AMBIENT_COLOR, AMBIENT_INTENSITY));

  // ── Base box (the podium under the reflector) ──────────
  // In synthcity-local coords, the base box sits with its bottom at y=0
  // (sitting on the city ground) and top at y=BASE_HEIGHT=130. After the
  // root's -130.5 y-translation, the box extends from world y=-130.5 to
  // y=-0.5 — the top face is 0.5 units below the reflector at y=0,
  // eliminating any z-fight while still reading as a continuous podium.
  //
  // Placeholder material is used until SynthCityAssets.load() resolves;
  // wireGenerators() then swaps in the real mega_building_01 material
  // (bump-mapped emissive windows) to match the standalone's look.
  const baseBoxPlaceholderMat = new THREE.MeshPhongMaterial({
    color: 0x1a1a2a,
    emissive: 0x0a0e18,
    emissiveIntensity: 0.6,
    shininess: 1,
  });
  const baseBox = new THREE.Mesh(
    new THREE.BoxGeometry(BASE_WIDTH, BASE_HEIGHT, BASE_WIDTH),
    baseBoxPlaceholderMat,
  );
  // synthcity-local center: (PLATFORM_CENTER_X, BASE_HEIGHT/2, PLATFORM_CENTER_Z)
  // → world (0, -65.5, 0) after root translation.
  baseBox.position.set(PLATFORM_CENTER_X, BASE_HEIGHT / 2, PLATFORM_CENTER_Z);
  baseBox.name = 'synth_city_base_box';
  root.add(baseBox);
  enableReflection(baseBox);

  // ── Reflector (Luminal's floor — scene-level, world y=0) ──
  // MAP_TUNING.synth_city sets reflectionsYOffset=0, so buildFloorReflector
  // installs the reflector at world y=0. Bikes race on this surface.
  buildFloorReflector(
    scene,
    reactive,
    gfx,
    mapType,
    new THREE.PlaneGeometry(PLATFORM_TOP_HALF * 2, PLATFORM_TOP_HALF * 2),
  );

  // NOTE: intentionally NO buildArenaGrids call (standalone had no grid
  // overlay). Perimeter walls are built below using Luminal's shared
  // shooting-star texture so audio reactivity + camera collision behave
  // consistently with other maps.

  // ── Perimeter walls (shooting-star texture, 4 panels + dark backings) ──
  // Mirrors the classic arena pattern in arenaClassicBuilder.ts:113 — the
  // wall texture is shared across maps so `updateFlowTexture` scrolls all
  // arenas in lockstep, and arenaAudio.updateBarriers pulses opacity from
  // reactive.barriers. These are scene-level (not parented to root) so
  // they sit at world y=BARRIER_H/2.
  const { walls, backings } = buildSynthCityWalls(scene, reactive, cachedWallTexture);
  for (const w of walls) enableReflection(w);
  for (const b of backings) enableReflection(b);

  // ── Pre-allocate the PointLight pool for the city-light streamer ──
  const lightPool: LightPoolEntry[] = [];
  for (let i = 0; i < CITY_LIGHTS_POOL_SIZE; i++) {
    const light = new THREE.PointLight(0x000000, 100, 2000);
    light.decay = 1;
    root.add(light);
    lightPool.push({ light, free: true });
  }

  // ── Stash runtime state BEFORE kicking off async asset load ──
  const synthState: SynthCityRuntimeState = {
    root,
    baseBox,
    baseBoxPlaceholderMat,
    walls,
    backings,
    offsetX: PLATFORM_CENTER_X,
    offsetZ: PLATFORM_CENTER_Z,
    lightPool,
    cityGenerator: null,
    lightGenerator: null,
    trafficGenerator: null,
    fog,
    savedBackground,
    savedLights,
  };
  reactive.synthCity = synthState;

  // ── Kick off the async asset load — generators get wired in the callback ──
  // If a map switch happens before this resolves, reactive.synthCity will
  // already be null (or point at a different root); guard the `then`.
  const sceneRef = scene;
  getSynthCityAssets().then((assets: SynthCityAssets) => {
    if (!reactive.synthCity || reactive.synthCity.root !== root) return;
    wireGenerators(reactive.synthCity, sceneRef, assets);
  }).catch((err: unknown) => {
    if (import.meta.env.DEV) console.error('[synth_city] asset load failed:', err);
  });

  // ── Skybox — equirectangular sky_night.jpg from the synthcity demo ──
  const loader = new THREE.TextureLoader();
  loader.load('/images/maps/sky_night.jpg', (tex) => {
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    // Stash the previous background so dispose can restore it
    scene.background = tex;
  });

  // portholeR / roofY feed buildStarfield (dome radius) in grid.ts shared
  // post-build. Using the old-standalone far plane gives stars that visually
  // sit beyond the procgen city.
  reactive._outerWallR = PLATFORM_TOP_HALF * 2;
  reactive._rimTopY = 0;

  return { portholeR: PLATFORM_TOP_HALF * 2, roofY: 0 };
}

// ── Generator wiring (runs once assets resolve) ─────────

function wireGenerators(
  state: NonNullable<ReactiveState['synthCity']>,
  scene: THREE.Scene,
  assets: SynthCityAssets,
): void {
  const { root, offsetX, offsetZ, lightPool } = state;

  // ── Base box material upgrade ─────────────────────────
  // Swap the placeholder MeshPhongMaterial for the singleton
  // mega_building_01 (bump-mapped, emissive windows). The placeholder is
  // owned by this state object so we can safely dispose it here; the
  // mega material is owned by SynthCityAssets and lives beyond map
  // switches, so we DON'T dispose it on teardown — just drop the reference.
  try {
    state.baseBox.material = assets.getMaterial('mega_building_01');
    if (state.baseBoxPlaceholderMat) {
      state.baseBoxPlaceholderMat.dispose();
      state.baseBoxPlaceholderMat = null;
    }
  } catch (err) {
    if (import.meta.env.DEV) console.warn('[synth_city] base box material swap failed:', err);
  }

  // The generators were ported from standalone code that read a
  // `this.camera` property to drive spatial streaming. To keep them
  // byte-identical, we supply a callback that returns the real Luminal
  // camera position translated into synthcity-local coordinates — i.e.,
  // the inverse of the root group's translation.
  const readCameraPosition = (out: THREE.Vector3): void => {
    const activeCam = scene.userData._camera as THREE.PerspectiveCamera | undefined;
    if (activeCam) {
      out.set(
        activeCam.position.x + offsetX,
        activeCam.position.y,
        activeCam.position.z + offsetZ,
      );
    } else {
      out.set(offsetX, 0, offsetZ);
    }
  };

  // Fresh noise per map so rebuilds don't share mutable state.
  const noise = new Perlin(SEED);
  noise.noiseDetail(NOISE_DETAIL_LOD, NOISE_DETAIL_FALLOFF);

  // Smoke billboards face the spawn centre — good enough for rising stacks
  // that don't need per-frame look-at accuracy.
  const lookAtTarget = new THREE.Vector3(offsetX, 0, offsetZ);
  const cityCtx: CityBlockContext = {
    root,
    assets,
    noise,
    spotLights: true,
    getLookAtTarget: () => lookAtTarget,
  };

  state.cityGenerator = new Generator<GeneratorCityBlock>({
    readCameraPosition,
    cell_size: CELL_STEP,
    cell_count: CITY_BLOCK_CELL_COUNT,
    spawn_obj: class extends GeneratorCityBlock {
      constructor(x: number, z: number) {
        super(x, z, cityCtx);
      }
    },
  });

  state.lightGenerator = new Generator<GeneratorCityLight>({
    readCameraPosition,
    cell_size: CELL_STEP * CITY_LIGHTS_CELL_STEP_MUL,
    cell_count: CITY_LIGHTS_CELL_COUNT,
    spawn_obj: class extends GeneratorCityLight {
      constructor(x: number, z: number) {
        super(x, z, lightPool, noise);
      }
    },
  });

  // Traffic track target — real camera in synthcity-local space.
  const trackTargetScratch = new THREE.Vector3();
  const getTrackTarget = (): THREE.Vector3 => {
    const activeCam = scene.userData._camera as THREE.PerspectiveCamera | undefined;
    if (activeCam) {
      trackTargetScratch.set(
        activeCam.position.x + offsetX,
        activeCam.position.y,
        activeCam.position.z + offsetZ,
      );
    } else {
      trackTargetScratch.set(offsetX, 0, offsetZ);
    }
    return trackTargetScratch;
  };

  state.trafficGenerator = new Generator<GeneratorTraffic>({
    readCameraPosition,
    cell_size: CELL_STEP,
    cell_count: TRAFFIC_CELL_COUNT,
    spawn_obj: class extends GeneratorTraffic {
      constructor(x: number, z: number) {
        super(x, z, root, assets, getTrackTarget);
      }
    },
  });
}

// ── Teardown ────────────────────────────────────────────

/** Called from grid.ts createArena() before a new map builds. */
export function disposeSynthCity(reactive: ReactiveState, scene: THREE.Scene): void {
  const state = reactive.synthCity;
  if (!state) return;

  state.cityGenerator?.disposeAll();
  state.lightGenerator?.disposeAll();
  state.trafficGenerator?.disposeAll();

  for (const slot of state.lightPool) {
    state.root.remove(slot.light);
  }
  state.root.removeFromParent();

  // Base box geometry is owned by us — dispose it. The material is EITHER
  // the placeholder (already disposed at material-swap time when assets
  // resolved, so state.baseBoxPlaceholderMat is null) OR the singleton
  // mega_building_01 owned by SynthCityAssets (shared with procgen mega
  // buildings, NEVER to be disposed here). Handle both cases safely.
  (state.baseBox.geometry as THREE.BufferGeometry).dispose();
  if (state.baseBoxPlaceholderMat) {
    // Async asset load never completed — placeholder still in use.
    state.baseBoxPlaceholderMat.dispose();
    state.baseBoxPlaceholderMat = null;
  }
  // (else: material is the singleton; leave alone.)

  // Perimeter walls + backings — all share geometry and per-role material,
  // so dispose once and remove each mesh from the scene.
  const wallGeo = state.walls[0]?.geometry as THREE.BufferGeometry | undefined;
  const wallMat = state.walls[0]?.material as THREE.Material | undefined;
  const backingMat = state.backings[0]?.material as THREE.Material | undefined;
  for (const w of state.walls) scene.remove(w);
  for (const b of state.backings) scene.remove(b);
  if (wallGeo) wallGeo.dispose();
  if (wallMat) wallMat.dispose();
  if (backingMat) backingMat.dispose();

  // Restore camera far plane.
  const activeCam = scene.userData._camera as THREE.PerspectiveCamera | undefined;
  if (activeCam) {
    activeCam.far = LUMINAL_CAMERA_FAR;
    activeCam.updateProjectionMatrix();
  }

  // Restore scene.background.
  scene.background = state.savedBackground;

  // Restore Luminal's base light intensities (undoes the fix #3 dimming).
  for (const { light, intensity } of state.savedLights) {
    light.intensity = intensity;
  }

  // Restore renderer exposure.
  const renderer = scene.userData._renderer as THREE.WebGLRenderer | undefined;
  if (renderer) {
    renderer.toneMappingExposure = LUMINAL_DEFAULT_EXPOSURE;
  }

  reactive.synthCity = null;
}

// ── Perimeter walls (shooting-star texture + dark backings) ─────────

/** Build 4 perimeter walls using Luminal's shared shooting-star canvas
 *  texture — matches the classic arena's wall style for visual consistency
 *  and audio reactivity (updateFlowTexture scrolls all arena walls in
 *  lockstep via reactive.flowTexture + reactive.barriers). */
function buildSynthCityWalls(
  scene: THREE.Scene,
  reactive: ReactiveState,
  cachedWallTexture: THREE.CanvasTexture,
): { walls: THREE.Mesh[]; backings: THREE.Mesh[] } {
  // Fall back to the shared wall texture singleton if the caller didn't
  // pre-fetch it. In practice grid.ts always passes it, but be defensive
  // so tests that mock the signature don't need to wire this up.
  const wallTex = cachedWallTexture ?? getSharedWallTexture();

  const wallPanelMat = new THREE.MeshBasicMaterial({
    map: wallTex,
    transparent: true,
    opacity: 1.0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const backingMat = new THREE.MeshBasicMaterial({
    color: 0x020305,
    side: THREE.DoubleSide,
  });
  const wallGeo = new THREE.PlaneGeometry(PLATFORM_TOP_HALF * 2, BARRIER_H);

  const wallDefs: Array<{ pos: [number, number, number]; rot: [number, number, number] }> = [
    { pos: [0, BARRIER_H / 2, -PLATFORM_TOP_HALF], rot: [0, 0, 0] },
    { pos: [0, BARRIER_H / 2, PLATFORM_TOP_HALF], rot: [0, Math.PI, 0] },
    { pos: [-PLATFORM_TOP_HALF, BARRIER_H / 2, 0], rot: [0, Math.PI / 2, 0] },
    { pos: [PLATFORM_TOP_HALF, BARRIER_H / 2, 0], rot: [0, -Math.PI / 2, 0] },
  ];

  const walls: THREE.Mesh[] = [];
  const backings: THREE.Mesh[] = [];
  const backingOffset = 0.3;

  for (const { pos, rot } of wallDefs) {
    const wall = new THREE.Mesh(wallGeo, wallPanelMat);
    wall.position.set(pos[0], pos[1], pos[2]);
    wall.rotation.set(rot[0], rot[1], rot[2]);
    wall.renderOrder = 15;
    wall.name = 'synth_city_wall';
    scene.add(wall);
    walls.push(wall);
    reactive.barriers.push(wall);

    const backing = new THREE.Mesh(wallGeo, backingMat);
    const dir = new THREE.Vector3(pos[0], 0, pos[2]).normalize();
    backing.position.set(
      pos[0] + dir.x * backingOffset,
      pos[1],
      pos[2] + dir.z * backingOffset,
    );
    backing.rotation.set(rot[0], rot[1], rot[2]);
    backing.renderOrder = 14;
    backing.name = 'synth_city_wall_backing';
    scene.add(backing);
    backings.push(backing);
  }

  return { walls, backings };
}

// ── Per-frame update hook ──────────────────────────────

/** Called from Game.update(). Cheap no-op when the current map isn't
 *  synth_city or when assets haven't yet resolved. */
export function updateSynthCity(reactive: ReactiveState): void {
  const state = reactive.synthCity;
  if (!state) return;
  state.cityGenerator?.update();
  state.lightGenerator?.update();
  state.trafficGenerator?.update();
}
