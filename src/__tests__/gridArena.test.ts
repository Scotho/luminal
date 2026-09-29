// ── grid.ts arena-level tests (createArena, updateWallGlow, state) ──
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const noop = vi.fn();
function pos() { return { x: 0, y: 0, z: 0, set: noop }; }
function scl() { return { x: 1, y: 1, z: 1, setScalar: noop }; }

// ── Three.js mock ───────────────────────────────────────
vi.mock('three', () => {
  class Color {
    r = 0; g = 0; b = 0; isColor = true; _hex = 0;
    constructor(c?: number) { if (c !== undefined) this._hex = c; }
    setHex(h: number) { this._hex = h; return this; }
    getHex() { return this._hex; }
  }
  class MeshStandardMaterial {
    isMeshStandardMaterial = true;
    color = new Color(); emissive = new Color();
    emissiveIntensity = 1; roughness = 1; metalness = 0; needsUpdate = false;
    toneMapped = true; transparent = false; opacity = 1; side = 0; fog = false;
    map = null; emissiveMap = null; envMap = null; envMapIntensity = 1;
    depthWrite = true; depthTest = true; alphaTest = 0; blending = 0; name = '';
    polygonOffset = false; polygonOffsetFactor = 0; polygonOffsetUnits = 0;
    userData: Record<string, unknown> = {};
    dispose() { /**/ }
    clone() { const c = new MeshStandardMaterial(); c.emissiveIntensity = this.emissiveIntensity; return c; }
  }
  class MeshBasicMaterial {
    isMeshStandardMaterial = false; color = new Color();
    needsUpdate = false; transparent = false; opacity = 1; side = 0;
    depthWrite = true; depthTest = true; map = null; fog = false;
    toneMapped = false; blending = 0; dispose() { /**/ }
  }
  const v = () => vi.fn();
  class Mesh {
    isMesh = true; material: unknown = new MeshStandardMaterial();
    name = ''; renderOrder = 0; visible = true; matrixAutoUpdate = true;
    position = pos(); rotation = pos(); scale = scl();
    geometry = { dispose: v() }; userData: Record<string, unknown> = {};
    layers = { enable: v() };
    updateMatrixWorld = v(); removeFromParent = v(); traverse = v(); dispose = v();
  }
  class Group {
    isGroup = true; children: unknown[] = []; name = ''; renderOrder = 0;
    position = pos(); rotation = pos(); scale = scl();
    traverse = v(); add = v(); remove = v(); lookAt = v(); removeFromParent = v();
  }
  class Scene {
    fog: unknown = null;
    background: unknown = null;
    children: unknown[] = [];
    userData: Record<string, unknown> = {
      _renderer: { domElement: {}, toneMappingExposure: 1.25 },
      _camera: { position: { x: 0, y: 0, z: 0 }, far: 800, updateProjectionMatrix: v() },
    };
    add = v();
    remove = v();
    traverse = v();
    getObjectByName = v().mockReturnValue(undefined);
  }
  class GridHelper {
    position = { y: 0, set: v() }; renderOrder = 0;
    material = [{ depthTest: true, depthWrite: false, transparent: true, opacity: 1 }];
  }
  class PointLight { isPointLight = true; position = { set: v() }; add = v(); }
  class SpotLight { isSpotLight = true; position = { set: v() }; target = { position: { set: v() } }; }
  class Points { geometry = {}; }
  class BufferGeometry { setAttribute = v(); setFromPoints() { return this; } }
  class BufferAttribute { constructor(public array: Float32Array, public itemSize: number) {} }
  class CanvasTexture { wrapS = 0; wrapT = 0; repeat = { set: v() }; dispose = v(); }
  class PMREMGenerator { compileCubemapShader = v(); fromScene = v().mockReturnValue({ texture: {} }); dispose = v(); }
  class Shape { moveTo = v(); lineTo = v(); holes: unknown[] = []; }
  class Path { moveTo = v(); lineTo = v(); }
  class Vector3 { x = 0; y = 0; z = 0; normalize() { return this; } }
  class Box3 { min = new Vector3(); max = new Vector3(); setFromObject() { return this; } getCenter() { return new Vector3(); } }
  class Fog { color: unknown; near = 0; far = 0; constructor(c: unknown, n: number, f: number) { this.color = c; this.near = n; this.far = f; } }
  class DirectionalLight { isDirectionalLight = true; position = pos(); target = { position: pos() }; }
  class AmbientLight { isAmbientLight = true; }
  return {
    Color, Mesh, MeshStandardMaterial, MeshBasicMaterial,
    MeshPhongMaterial: MeshStandardMaterial, Group, Scene,
    Fog, DirectionalLight, AmbientLight,
    GridHelper, PointLight, SpotLight, Points, PointsMaterial: class {}, BufferGeometry,
    BufferAttribute, CanvasTexture, PMREMGenerator, Shape, Path, Vector3, Box3,
    Line: class {}, LineBasicMaterial: class { color = {}; transparent = false; opacity = 1; },
    Object3D: class {}, PlaneGeometry: class {}, BoxGeometry: class {},
    CylinderGeometry: class {}, CircleGeometry: class {}, ConeGeometry: class {},
    SphereGeometry: class {}, TorusGeometry: class {}, ShapeGeometry: class {},
    RepeatWrapping: 1000, ClampToEdgeWrapping: 1001, DoubleSide: 2, BackSide: 1,
    AdditiveBlending: 2, WebGLRenderer: class {},
    LoadingManager: class { onProgress: unknown; onLoad: unknown; onError: unknown; },
    TextureLoader: class { load() { return { wrapS: 0, wrapT: 0, anisotropy: 0 }; } },
  };
});

// ── Addon mocks ─────────────────────────────────────────
vi.mock('three/addons/objects/Reflector.js', () => ({
  Reflector: class {
    rotation = { x: 0 }; position = { x: 0, y: 0, z: 0, set: vi.fn() }; renderOrder = 0; forceUpdate = false; name = '';
    camera = { layers: { set: vi.fn() } };
    material = { isShaderMaterial: true, depthWrite: true, uniforms: {
      uReflectStrength: { value: 0 }, uFloorEmissiveIntensity: { value: 0 }, uRoughness: { value: 0 },
      color: { value: { setScalar: vi.fn() } },
    } };
    geometry = { dispose: vi.fn() }; dispose = vi.fn(); removeFromParent = vi.fn();
  },
}));
const mockGLTFLoad = vi.fn();
vi.mock('three/addons/loaders/GLTFLoader.js', () => ({
  GLTFLoader: class { load = mockGLTFLoad; setMeshoptDecoder() { return this; } },
}));
vi.mock('three/addons/libs/meshopt_decoder.module.js', () => ({ MeshoptDecoder: {} }));

// ── Project dependency mocks ────────────────────────────
const mockGetGfx = vi.fn();
vi.mock('../graphics', () => ({
  getGfx: (...a: unknown[]) => mockGetGfx(...a), bloomMul: { vehicles: 1, trails: 1, environment: 1, lights: 1 },
  VISUAL_TUNING: { high: { floorReflectStrength: 0.85, floorEmissiveIntensity: 1.2, floorRoughness: 0.6 } },
  MAP_TUNING: {
    synth_pit: { floorReflectStrength: 0.8, floorEmissiveIntensity: 2.0, floorRoughness: 0.46, reflectionsIntensity: 0.07, reflectionsYOffset: 0, reflectionsClipBias: 0.003 },
    midtown_bowl: { floorReflectStrength: 0.76, floorEmissiveIntensity: 2.0, floorRoughness: 0.14, reflectionsIntensity: 0.784, reflectionsYOffset: 0, reflectionsClipBias: 0.009 },
    synth_city: { floorReflectStrength: 0.85, floorEmissiveIntensity: 2.0, floorRoughness: 0.5, reflectionsIntensity: 0.5, reflectionsYOffset: 0, reflectionsClipBias: 0.005 },
  },
}));
const mockCloneArenaModel = vi.fn();
vi.mock('../arenaModel', () => ({ cloneArenaModel: (...a: unknown[]) => mockCloneArenaModel(...a), getArenaModelRadius: vi.fn(() => 192), isArenaModelLoaded: vi.fn(() => true) }));
vi.mock('../droneModel', () => ({ cloneDroneModel: vi.fn(() => ({ scale: { setScalar: vi.fn() }, position: { set: vi.fn() }, add: vi.fn() })) }));
const mockSetArenaShape = vi.fn();
vi.mock('../core/simulation', () => ({ setArenaShape: (...a: unknown[]) => mockSetArenaShape(...a) }));
vi.mock('../playerColors', () => ({ PLAYER_COLORS: [
  { key: 'red', color: 0xC02018 }, { key: 'orange', color: 0xE08830 },
  { key: 'magenta', color: 0xFC741E }, { key: 'lime', color: 0xFAC322 },
  { key: 'green', color: 0x66D450 }, { key: 'cyan', color: 0x49A2B2 },
  { key: 'teal', color: 0x2D6469 }, { key: 'blue', color: 0x1A6A8A },
  { key: 'pink', color: 0xD440B8 }, { key: 'white', color: 0xE0F0F0 },
] }));
vi.mock('../atmosphere', () => ({
  createAtmosphere: vi.fn(() => ({ level: 'off', active: false, mistMeshes: [], elapsed: 0, currentDensityMul: 1, currentSpeedMul: 1, fogReactiveRange: 0, adminFreeze: false })),
  disposeAtmosphere: vi.fn(),
}));
const mockSetCamColl = vi.fn();
vi.mock('../camera/cameraCollision', () => ({ setCameraCollisionMeshes: (...a: unknown[]) => mockSetCamColl(...a) }));
vi.mock('../starfield', () => ({ createStarTexture: vi.fn(() => ({})), starSize: vi.fn(() => 1.5), starColor: vi.fn(() => [1, 1, 1]), createStarMaterial: vi.fn(() => ({ uniforms: { uTime: { value: 0 }, uPixelRatio: { value: 1 }, uStarTexture: { value: null } } })) }));
vi.mock('../arenaEffects', () => ({ updateArenaAudio: vi.fn(), triggerCountdownPulse: vi.fn(), clearCountdownPulses: vi.fn(), updateCountdownPulses: vi.fn() }));

import { Scene } from 'three';
import {
  createArena, getArenaReactive, getCameraCollisionMeshes,
  setSpectatorTargets, updateWallGlow, setGridArenaShape,
  isOutOfBounds, ARENA_SIZE,
} from '../grid';

// ── Helpers ──────────────────────────────────────────────

function stubCanvas() {
  const ctx = { fillStyle: '', clearRect: vi.fn(), fillRect: vi.fn(),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
  };
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
    if (tag === 'canvas') return { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement;
    return document.createElement(tag);
  }) as typeof document.createElement);
}

function highGfx() {
  return { preset: 'high' as const, bloom: 'on' as const, antialias: true,
    pixelRatio: 1, arenaDetail: 'full' as const, raveSpotlights: 0,
    audioReactivity: 'full' as const,
    playerVFX: 'full' as const, lighting: 'full' as const,
    atmosphere: 'full' as const, reflections: 'standard' as const };
}

function makeArenaModelGroup() {
  const names = [
    'polygon56_Arena_Floor_0', 'Flood_Lights_0', 'Glow_Cyan_0',
    'Glow_Blue_0', 'Windows_0', 'Arena_Wall_Barrier_0',
    'Arena_Wall_0', 'Arena_Floor_0', 'Crowd_Stands_0', 'Buildings_0',
  ];
  const meshes = names.map(name => ({
    name, isMesh: true,
    material: { isMeshStandardMaterial: true,
      color: { setHex: vi.fn() }, emissive: { setHex: vi.fn() },
      emissiveIntensity: 1, roughness: 0.5, metalness: 0, needsUpdate: false,
      toneMapped: true, transparent: false, opacity: 1, map: null, emissiveMap: null,
      depthWrite: true, depthTest: true, alphaTest: 0, polygonOffset: false,
      polygonOffsetFactor: 0, polygonOffsetUnits: 0, name: '', userData: {},
      dispose: vi.fn(), side: 0, fog: false },
    position: pos(), rotation: pos(), scale: scl(),
    renderOrder: 0, visible: true, matrixAutoUpdate: true,
    layers: { enable: vi.fn() },
    updateMatrixWorld: vi.fn(), removeFromParent: vi.fn(),
  }));
  return { scale: scl(), position: pos(),
    traverse: (fn: (child: unknown) => void) => { meshes.forEach(fn); } };
}

function callCreate(mapType: 'midtown_bowl' | 'synth_pit' | 'synth_city' = 'midtown_bowl') {
  const scene = new Scene();
  createArena(scene as unknown as THREE.Scene, mapType);
  return { scene, reactive: getArenaReactive() };
}

// ── createArena tests ───────────────────────────────────

describe('createArena', () => {
  beforeEach(() => { vi.clearAllMocks(); stubCanvas(); mockGetGfx.mockReturnValue(highGfx()); mockCloneArenaModel.mockReturnValue(makeArenaModelGroup()); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('initializes reactive state (non-null)', () => { expect(callCreate().reactive).not.toBeNull(); });
  it('adds meshes to scene for midtown_bowl', () => { expect(callCreate('midtown_bowl').scene.add).toHaveBeenCalled(); });
  it('adds meshes to scene for synth_pit', () => { expect(callCreate('synth_pit').scene.add).toHaveBeenCalled(); });
  it('adds meshes to scene for synth_city', () => { expect(callCreate('synth_city').scene.add).toHaveBeenCalled(); });
  it('initializes reactive state for synth_city', () => { expect(callCreate('synth_city').reactive).not.toBeNull(); });
  it('sets circular shape for midtown_bowl', () => { callCreate('midtown_bowl'); expect(mockSetArenaShape).toHaveBeenCalledWith(true, expect.any(Number)); });
  it('sets square shape for synth_pit', () => { callCreate('synth_pit'); expect(mockSetArenaShape).toHaveBeenCalledWith(false, 170); });

  it('falls back to midtown_bowl for unknown map type', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    callCreate('nonexistent_map' as 'midtown_bowl');
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('unknown mapType'));
    spy.mockRestore();
  });

  it('registers camera collision meshes', () => { callCreate(); expect(mockSetCamColl).toHaveBeenCalled(); });
  it('populates reactive barriers', () => { expect(callCreate().reactive!.barriers.length).toBeGreaterThan(0); });
  it('creates starMesh', () => { expect(callCreate().reactive!.starMesh).not.toBeNull(); });
  it('creates satellites array', () => { const s = callCreate().reactive!.satellites; expect(s).not.toBeNull(); expect(Array.isArray(s)).toBe(true); });
  it('initializes fireworks as null', () => { expect(callCreate().reactive!.fireworks).toBeNull(); });
  it('sets gridMain', () => { expect(callCreate().reactive!.gridMain).not.toBeNull(); });
  it('creates reflector when reflections on', () => { expect(callCreate().reactive!.reflector).not.toBeNull(); });

  it('skips reflector when reflections off', () => {
    mockGetGfx.mockReturnValue({ ...highGfx(), reflections: 'off' });
    expect(callCreate().reactive!.reflector).toBeNull();
  });

  it('creates spectator drone when detail not minimal', () => { expect(callCreate().reactive!.spectatorDrone).not.toBeNull(); });

  it('omits spectator drone when detail is minimal', () => {
    mockGetGfx.mockReturnValue({ ...highGfx(), arenaDetail: 'minimal' });
    expect(callCreate().reactive!.spectatorDrone).toBeNull();
  });

  it('initializes all v2 mesh arrays', () => {
    const { reactive: r } = callCreate('midtown_bowl');
    expect(Array.isArray(r!.v2FloodLights)).toBe(true);
    expect(Array.isArray(r!.v2GlowCyan)).toBe(true);
    expect(Array.isArray(r!.v2GlowBlue)).toBe(true);
    expect(Array.isArray(r!.v2Windows)).toBe(true);
    expect(Array.isArray(r!.v2WallBarrier)).toBe(true);
    expect(Array.isArray(r!.v2ArenaWall)).toBe(true);
    expect(Array.isArray(r!.v2ArenaFloor)).toBe(true);
    expect(Array.isArray(r!.v2CrowdStands)).toBe(true);
    expect(Array.isArray(r!.v2Buildings)).toBe(true);
  });

  it('initializes fireworks as null and raveSpots as empty array', () => {
    const { reactive: r } = callCreate();
    expect(r!.fireworks).toBeNull();
    expect(r!.raveSpots).toEqual([]);
  });

  it('initializes tierStrips, stadLights, and accentRings as arrays', () => {
    const { reactive: r } = callCreate();
    expect(Array.isArray(r!.tierStrips)).toBe(true);
    expect(Array.isArray(r!.stadLights)).toBe(true);
    expect(Array.isArray(r!.accentRings)).toBe(true);
  });

  it('sets flowTexture to non-null', () => {
    const { reactive: r } = callCreate();
    expect(r!.flowTexture).not.toBeNull();
  });

  it('clears scene fog', () => {
    const scene = new Scene();
    scene.fog = { type: 'Fog' };
    createArena(scene as unknown as THREE.Scene);
    expect(scene.fog).toBeNull();
  });
});

// ── updateWallGlow with reactive state ──────────────────

describe('updateWallGlow (with reactive state)', () => {
  beforeEach(() => { vi.clearAllMocks(); stubCanvas(); mockGetGfx.mockReturnValue({ ...highGfx(), reflections: 'off' }); mockCloneArenaModel.mockReturnValue(makeArenaModelGroup()); });
  afterEach(() => { vi.restoreAllMocks(); });

  function classic() { return callCreate('synth_pit').reactive; }

  it('max glow at distance 0', () => {
    classic(); updateWallGlow(0);
    // proximity=1, intensity = (1.2 + 1*1.0) * 1 = 2.2
    expect(getArenaReactive()!.baseStripMat!.emissiveIntensity).toBeCloseTo(2.2);
  });

  it('no glow boost at distance >= range', () => {
    classic(); updateWallGlow(8);
    expect(getArenaReactive()!.baseStripMat!.emissiveIntensity).toBeCloseTo(1.2);
  });

  it('proportional glow at intermediate distance', () => {
    classic(); updateWallGlow(4);
    // proximity=0.5, intensity = (1.2 + 0.5*1.0) * 1 = 1.7
    expect(getArenaReactive()!.baseStripMat!.emissiveIntensity).toBeCloseTo(1.7);
  });

  it('very large distance same as threshold', () => {
    classic(); updateWallGlow(100000);
    expect(getArenaReactive()!.baseStripMat!.emissiveIntensity).toBeCloseTo(1.2);
  });

  it('negative distance overshoots proximity', () => {
    classic(); updateWallGlow(-5);
    // proximity = 1 - (-5)/8 = 1.625, intensity = (1.2 + 1.625*1.0) * 1 = 2.825
    expect(getArenaReactive()!.baseStripMat!.emissiveIntensity).toBeCloseTo(2.825);
  });

  it('distance exactly at range boundary (8) gives base intensity', () => {
    classic(); updateWallGlow(8);
    expect(getArenaReactive()!.baseStripMat!.emissiveIntensity).toBeCloseTo(1.2);
  });

  it('distance just below range (7.99) gives slight boost', () => {
    classic(); updateWallGlow(7.99);
    // proximity = 1 - 7.99/8 = 0.00125, intensity = (1.2 + 0.00125*1.0) * 1 = 1.20125
    expect(getArenaReactive()!.baseStripMat!.emissiveIntensity).toBeGreaterThan(1.2);
    expect(getArenaReactive()!.baseStripMat!.emissiveIntensity).toBeLessThan(1.21);
  });

  it('distance 1 gives strong glow boost', () => {
    classic(); updateWallGlow(1);
    // proximity = 1 - 1/8 = 0.875, intensity = (1.2 + 0.875*1.0) * 1 = 2.075
    expect(getArenaReactive()!.baseStripMat!.emissiveIntensity).toBeCloseTo(2.075);
  });
});

// ── getCameraCollisionMeshes with reactive state ────────

describe('getCameraCollisionMeshes (with reactive state)', () => {
  beforeEach(() => { vi.clearAllMocks(); stubCanvas(); mockGetGfx.mockReturnValue(highGfx()); mockCloneArenaModel.mockReturnValue(makeArenaModelGroup()); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('returns populated array after createArena', () => {
    callCreate(); expect(getCameraCollisionMeshes().length).toBeGreaterThan(0);
  });

  it('length equals barriers + v2WallBarrier + v2ArenaWall + v2ArenaFloor', () => {
    callCreate();
    const r = getArenaReactive()!;
    const expected = r.barriers.length + r.v2WallBarrier.length + r.v2ArenaWall.length + r.v2ArenaFloor.length;
    expect(getCameraCollisionMeshes().length).toBe(expected);
  });

  it('returns array type even before arena created', () => {
    expect(Array.isArray(getCameraCollisionMeshes())).toBe(true);
  });
});

// ── State integration ───────────────────────────────────

describe('state integration', () => {
  beforeEach(() => { vi.clearAllMocks(); stubCanvas(); mockGetGfx.mockReturnValue(highGfx()); mockCloneArenaModel.mockReturnValue(makeArenaModelGroup()); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('setGridArenaShape(true, 50) makes isOutOfBounds use circular boundary', () => {
    setGridArenaShape(true, 50);
    expect(isOutOfBounds(30, 30)).toBe(false);
    expect(isOutOfBounds(40, 40)).toBe(true);
  });

  it('setGridArenaShape(false) reverts to square using HALF=192', () => {
    setGridArenaShape(false, 50);
    expect(isOutOfBounds(191, 0)).toBe(false);
    expect(isOutOfBounds(192, 0)).toBe(true);
  });

  it('setSpectatorTargets updates _trackTargets', () => {
    callCreate();
    const targets = [{ x: 10, z: 20 }, null, { x: -5, z: 15 }];
    setSpectatorTargets(targets);
    expect(getArenaReactive()!._trackTargets).toBe(targets);
  });

  it('setSpectatorTargets([]) clears targets', () => {
    callCreate();
    setSpectatorTargets([{ x: 1, z: 2 }]);
    setSpectatorTargets([]);
    expect(getArenaReactive()!._trackTargets).toEqual([]);
  });

  it('createArena midtown_bowl sets circular bounds on isOutOfBounds', () => {
    callCreate('midtown_bowl');
    const arenaR = (30 / 2) * (ARENA_SIZE / 31.5);
    expect(isOutOfBounds(arenaR - 1, 0)).toBe(false);
    expect(isOutOfBounds(arenaR, 0)).toBe(true);
  });

  it('calling createArena twice re-initializes reactive state', () => {
    callCreate('midtown_bowl');
    const r1 = getArenaReactive();
    expect(r1).not.toBeNull();
    callCreate('synth_pit');
    const r2 = getArenaReactive();
    expect(r2).not.toBeNull();
    expect(r2).not.toBe(r1);
  });

  it('synth_pit uses square bounds', () => {
    callCreate('synth_pit');
    const half = ARENA_SIZE / 2;
    // Square bounds: inside along axis
    expect(isOutOfBounds(half - 1, 0)).toBe(false);
    expect(isOutOfBounds(half, 0)).toBe(true);
    // Square bounds: corners that would be outside circular but inside square
    expect(isOutOfBounds(half - 1, half - 1)).toBe(false);
  });

  it('ARENA_SIZE is 384', () => {
    expect(ARENA_SIZE).toBe(384);
  });
});
