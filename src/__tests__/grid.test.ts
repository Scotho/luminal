// ── grid.ts unit tests (pure functions focus) ───────────
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock Three.js ────────────────────────────────────────
vi.mock('three', () => {
  class Color {
    r = 0; g = 0; b = 0; isColor = true; _hex = 0;
    constructor(c?: number) {
      if (c !== undefined) {
        this._hex = c;
        this.r = ((c >> 16) & 0xff) / 255;
        this.g = ((c >> 8) & 0xff) / 255;
        this.b = (c & 0xff) / 255;
      }
    }
    setHex(hex: number) {
      this._hex = hex;
      this.r = ((hex >> 16) & 0xff) / 255;
      this.g = ((hex >> 8) & 0xff) / 255;
      this.b = (hex & 0xff) / 255;
      return this;
    }
    getHex() { return this._hex; }
  }
  class MeshStandardMaterial {
    isMeshStandardMaterial = true;
    color = new Color();
    emissive = new Color();
    emissiveIntensity = 1;
    roughness = 1;
    metalness = 0;
    needsUpdate = false;
    toneMapped = true;
    map = null;
    emissiveMap = null;
    name = '';
  }
  class MeshBasicMaterial {
    isMeshStandardMaterial = false;
    needsUpdate = false;
  }
  class Mesh {
    material: unknown = new MeshStandardMaterial();
    name = '';
  }
  return {
    Color,
    Mesh,
    MeshStandardMaterial,
    MeshBasicMaterial,
    GridHelper: vi.fn(),
    PointLight: vi.fn(),
    SpotLight: vi.fn(),
    Group: vi.fn(),
    Points: vi.fn(),
    Line: vi.fn(),
    BufferGeometry: vi.fn(),
    PointsMaterial: vi.fn(),
    Object3D: vi.fn(),
    Vector3: vi.fn(),
  };
});

// ── Mock three/addons ────────────────────────────────────
vi.mock('three/addons/objects/Reflector.js', () => ({ Reflector: vi.fn() }));
vi.mock('three/addons/loaders/GLTFLoader.js', () => ({ GLTFLoader: vi.fn() }));
vi.mock('three/addons/libs/meshopt_decoder.module.js', () => ({ MeshoptDecoder: {} }));

// ── Mock project dependencies ────────────────────────────
vi.mock('../graphics', () => ({
  getGfx: vi.fn(),
  bloomMul: { vehicles: 1, trails: 1, environment: 1, lights: 1 },
  VISUAL_TUNING: {},
  MAP_TUNING: {
    synth_pit: { floorReflectStrength: 0.8, floorEmissiveIntensity: 2.0, floorRoughness: 0.46, reflectionsIntensity: 0.07, reflectionsYOffset: 0, reflectionsClipBias: 0.003 },
    midtown_bowl: { floorReflectStrength: 0.76, floorEmissiveIntensity: 2.0, floorRoughness: 0.14, reflectionsIntensity: 0.784, reflectionsYOffset: 0, reflectionsClipBias: 0.009 },
  },
}));
vi.mock('../droneModel', () => ({ cloneDroneModel: vi.fn() }));
vi.mock('../arenaModel', () => ({ cloneArenaModel: vi.fn(), getArenaModelRadius: vi.fn(() => 192), isArenaModelLoaded: vi.fn(() => true) }));
vi.mock('../core/simulation', () => ({ setArenaShape: vi.fn() }));
vi.mock('../playerColors', () => ({
  PLAYER_COLORS: [
    { key: 'red', color: 0xC02018 },
    { key: 'orange', color: 0xE08830 },
    { key: 'magenta', color: 0xFC741E },
    { key: 'lime', color: 0xFAC322 },
    { key: 'green', color: 0x66D450 },
    { key: 'cyan', color: 0x49A2B2 },
    { key: 'teal', color: 0x2D6469 },
    { key: 'blue', color: 0x1A6A8A },
    { key: 'pink', color: 0xD440B8 },
    { key: 'white', color: 0xE0F0F0 },
  ],
}));
vi.mock('../atmosphere', () => ({}));
vi.mock('../camera/cameraCollision', () => ({ setCameraCollisionMeshes: vi.fn() }));
vi.mock('../starfield', () => ({
  createStarTexture: vi.fn(),
  starSize: vi.fn(() => 1),
  starColor: vi.fn(() => [1, 1, 1]),
  createStarMaterial: vi.fn(() => ({ uniforms: { uTime: { value: 0 }, uPixelRatio: { value: 1 }, uStarTexture: { value: null } } })),
}));
vi.mock('../arenaEffects', () => ({
  updateArenaAudio: vi.fn(),
  triggerCountdownPulse: vi.fn(),
  clearCountdownPulses: vi.fn(),
  updateCountdownPulses: vi.fn(),
}));

import {
  ARENA_SIZE,
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
  STAND_COLORS,
  FLOOD_LIGHT_SETTINGS,
  isOutOfBounds,
  setGridArenaShape,
  forEachStandardMaterial,
  applyArenaRole,
  setArenaRoleReactiveIntensity,
  updateWallGlow,
  setSpectatorTargets,
  getArenaReactive,
  getCameraCollisionMeshes,
  ARENA_VISUAL_ROLES,
} from '../grid';
import type { ArenaVisualRoleId } from '../grid';
import { Mesh, MeshStandardMaterial, MeshBasicMaterial } from 'three';

// ── Constants ────────────────────────────────────────────

describe('grid constants', () => {
  it('ARENA_SIZE is 384', () => {
    expect(ARENA_SIZE).toBe(384);
  });

  it('arena color constants are hex numbers', () => {
    expect(ARENA_BLACK).toBe(0x04070B);
    expect(ARENA_PANEL_TEAL).toBe(0x0E161D);
    expect(ARENA_TEAL).toBe(0x14232D);
    expect(ARENA_TEAL_BRIGHT).toBe(0x1C4350);
    expect(ARENA_CYAN_HERO).toBe(0x63E8FF);
    expect(ARENA_ORANGE).toBe(0xFF7A1A);
    expect(ARENA_ORANGE_DEEP).toBe(0xD84E12);
    expect(ARENA_GOLD).toBe(0xFFB020);
    expect(ARENA_GOLD_DEEP).toBe(0xB96E16);
    expect(ARENA_MIST).toBe(0xE8F7FF);
  });

  it('STAND_COLORS excludes green and white', () => {
    // 10 total colors minus green and white = 8
    expect(STAND_COLORS).toHaveLength(8);
  });

  it('STAND_COLORS entries are THREE.Color instances', () => {
    for (const color of STAND_COLORS) {
      expect(color).toHaveProperty('isColor', true);
    }
  });
});

describe('FLOOD_LIGHT_SETTINGS', () => {
  it('has all expected keys', () => {
    expect(FLOOD_LIGHT_SETTINGS).toMatchObject({
      toneMapped: expect.any(Boolean),
      roughnessMax: expect.any(Number),
      warmBaseEmissive: expect.any(Number),
      coolBaseEmissive: expect.any(Number),
      warmPulseBase: expect.any(Number),
      warmPulseKick: expect.any(Number),
      warmPulseBass: expect.any(Number),
      coolPulseBase: expect.any(Number),
      coolPulseKick: expect.any(Number),
      coolPulseBass: expect.any(Number),
    });
  });

  it('toneMapped is true', () => {
    expect(FLOOD_LIGHT_SETTINGS.toneMapped).toBe(true);
  });

  it('roughnessMax is a positive fraction', () => {
    expect(FLOOD_LIGHT_SETTINGS.roughnessMax).toBeGreaterThan(0);
    expect(FLOOD_LIGHT_SETTINGS.roughnessMax).toBeLessThan(1);
  });
});

// ── isOutOfBounds ────────────────────────────────────────

describe('isOutOfBounds', () => {
  const HALF = ARENA_SIZE / 2; // 192

  describe('square mode (default)', () => {
    beforeEach(() => {
      setGridArenaShape(false, HALF);
    });

    it('origin is in bounds', () => {
      expect(isOutOfBounds(0, 0)).toBe(false);
    });

    it('inside the arena is in bounds', () => {
      expect(isOutOfBounds(100, 100)).toBe(false);
      expect(isOutOfBounds(-100, -100)).toBe(false);
    });

    it('just inside the boundary is in bounds', () => {
      expect(isOutOfBounds(191, 191)).toBe(false);
      expect(isOutOfBounds(-191, -191)).toBe(false);
    });

    it('exactly on boundary (>= HALF) is out of bounds', () => {
      expect(isOutOfBounds(HALF, 0)).toBe(true);
      expect(isOutOfBounds(0, HALF)).toBe(true);
      expect(isOutOfBounds(-HALF, 0)).toBe(true);
      expect(isOutOfBounds(0, -HALF)).toBe(true);
    });

    it('beyond boundary is out of bounds', () => {
      expect(isOutOfBounds(200, 0)).toBe(true);
      expect(isOutOfBounds(0, 200)).toBe(true);
      expect(isOutOfBounds(-200, 50)).toBe(true);
    });

    it('corners at boundary are out of bounds', () => {
      expect(isOutOfBounds(HALF, HALF)).toBe(true);
      expect(isOutOfBounds(-HALF, -HALF)).toBe(true);
    });

    it('one axis inside but other outside is out of bounds', () => {
      expect(isOutOfBounds(0, 300)).toBe(true);
      expect(isOutOfBounds(300, 0)).toBe(true);
    });
  });

  describe('circular mode', () => {
    const radius = 100;

    beforeEach(() => {
      setGridArenaShape(true, radius);
    });

    it('origin is in bounds', () => {
      expect(isOutOfBounds(0, 0)).toBe(false);
    });

    it('inside circle is in bounds', () => {
      expect(isOutOfBounds(50, 50)).toBe(false);
      expect(isOutOfBounds(-30, 40)).toBe(false);
    });

    it('on the circle boundary (x*x + z*z >= r*r) is out of bounds', () => {
      // 100^2 + 0^2 = 10000 >= 10000
      expect(isOutOfBounds(radius, 0)).toBe(true);
      expect(isOutOfBounds(0, radius)).toBe(true);
    });

    it('beyond the circle is out of bounds', () => {
      expect(isOutOfBounds(101, 0)).toBe(true);
      expect(isOutOfBounds(80, 80)).toBe(true); // 80^2+80^2 = 12800 > 10000
    });

    it('diagonal inside circle is in bounds', () => {
      // 70^2 + 70^2 = 9800 < 10000
      expect(isOutOfBounds(70, 70)).toBe(false);
    });

    it('works with custom radius', () => {
      setGridArenaShape(true, 50);
      expect(isOutOfBounds(30, 30)).toBe(false); // 900+900 = 1800 < 2500
      expect(isOutOfBounds(40, 40)).toBe(true);  // 1600+1600 = 3200 > 2500
    });

    it('negative coordinates in circular mode', () => {
      expect(isOutOfBounds(-50, -50)).toBe(false); // 2500+2500 = 5000 < 10000
      expect(isOutOfBounds(-radius, 0)).toBe(true);
      expect(isOutOfBounds(0, -radius)).toBe(true);
    });

    it('fractional position just inside boundary', () => {
      // 99.99^2 + 0 = 9998.0001 < 10000
      expect(isOutOfBounds(99.99, 0)).toBe(false);
    });

    it('fractional position just outside boundary', () => {
      // 100.01^2 + 0 = 10002.0001 > 10000
      expect(isOutOfBounds(100.01, 0)).toBe(true);
    });
  });

  describe('mode switching', () => {
    it('switching from circular back to square works', () => {
      setGridArenaShape(true, 100);
      expect(isOutOfBounds(101, 0)).toBe(true);

      setGridArenaShape(false, HALF);
      // 101 < 192, so in bounds for square
      expect(isOutOfBounds(101, 0)).toBe(false);
    });

    it('switching from square to circular changes which corners are in bounds', () => {
      setGridArenaShape(false, HALF);
      // 130, 130 is in-bounds for square (both < 192)
      expect(isOutOfBounds(130, 130)).toBe(false);

      setGridArenaShape(true, 150);
      // 130^2 + 130^2 = 33800 > 150^2 = 22500 => out of bounds
      expect(isOutOfBounds(130, 130)).toBe(true);
    });
  });
});

// ── setGridArenaShape ────────────────────────────────────

describe('setGridArenaShape', () => {
  beforeEach(() => {
    setGridArenaShape(false, ARENA_SIZE / 2);
  });

  it('sets circular mode affecting isOutOfBounds', () => {
    // Default square mode: 150 is inside
    expect(isOutOfBounds(150, 0)).toBe(false);

    // Switch to circular with small radius
    setGridArenaShape(true, 100);
    // 150 > 100, now out of bounds
    expect(isOutOfBounds(150, 0)).toBe(true);
  });

  it('sets custom radius affecting boundary check', () => {
    setGridArenaShape(true, 200);
    expect(isOutOfBounds(199, 0)).toBe(false);
    expect(isOutOfBounds(200, 0)).toBe(true);

    setGridArenaShape(true, 50);
    expect(isOutOfBounds(49, 0)).toBe(false);
    expect(isOutOfBounds(50, 0)).toBe(true);
  });

  it('very small radius restricts arena to near-origin', () => {
    setGridArenaShape(true, 1);
    expect(isOutOfBounds(0, 0)).toBe(false);
    expect(isOutOfBounds(1, 0)).toBe(true);
    expect(isOutOfBounds(0.5, 0.5)).toBe(false); // 0.25+0.25=0.5 < 1
  });

  it('large radius allows wide positions', () => {
    setGridArenaShape(true, 10000);
    expect(isOutOfBounds(9999, 0)).toBe(false);
    expect(isOutOfBounds(10000, 0)).toBe(true);
  });
});

// ── forEachStandardMaterial ──────────────────────────────

describe('forEachStandardMaterial', () => {
  it('calls fn for a single MeshStandardMaterial', () => {
    const mesh = new Mesh();
    const mat = new MeshStandardMaterial();
    mesh.material = mat;

    const fn = vi.fn();
    forEachStandardMaterial(mesh, fn);

    expect(fn).toHaveBeenCalledOnce();
    expect(fn).toHaveBeenCalledWith(mat, 0);
  });

  it('sets needsUpdate = true after calling fn', () => {
    const mesh = new Mesh();
    const mat = new MeshStandardMaterial();
    mat.needsUpdate = false;
    mesh.material = mat;

    forEachStandardMaterial(mesh, () => {});

    expect(mat.needsUpdate).toBe(true);
  });

  it('handles array of materials (multi-material mesh)', () => {
    const mesh = new Mesh();
    const mat0 = new MeshStandardMaterial();
    const mat1 = new MeshStandardMaterial();
    mesh.material = [mat0, mat1];

    const fn = vi.fn();
    forEachStandardMaterial(mesh, fn);

    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenCalledWith(mat0, 0);
    expect(fn).toHaveBeenCalledWith(mat1, 1);
  });

  it('skips non-MeshStandardMaterial entries', () => {
    const mesh = new Mesh();
    const standardMat = new MeshStandardMaterial();
    const basicMat = new MeshBasicMaterial();
    mesh.material = [basicMat, standardMat];

    const fn = vi.fn();
    forEachStandardMaterial(mesh, fn);

    expect(fn).toHaveBeenCalledOnce();
    expect(fn).toHaveBeenCalledWith(standardMat, 1);
  });

  it('sets needsUpdate on each standard material in an array', () => {
    const mesh = new Mesh();
    const mat0 = new MeshStandardMaterial();
    const mat1 = new MeshStandardMaterial();
    mat0.needsUpdate = false;
    mat1.needsUpdate = false;
    mesh.material = [mat0, mat1];

    forEachStandardMaterial(mesh, () => {});

    expect(mat0.needsUpdate).toBe(true);
    expect(mat1.needsUpdate).toBe(true);
  });

  it('does not set needsUpdate on skipped materials', () => {
    const mesh = new Mesh();
    const basicMat = new MeshBasicMaterial();
    basicMat.needsUpdate = false;
    mesh.material = [basicMat];

    forEachStandardMaterial(mesh, () => {});

    expect(basicMat.needsUpdate).toBe(false);
  });

  it('passes materialIndex correctly for mixed arrays', () => {
    const mesh = new Mesh();
    const basicMat = new MeshBasicMaterial();
    const standardMat0 = new MeshStandardMaterial();
    const standardMat1 = new MeshStandardMaterial();
    mesh.material = [basicMat, standardMat0, basicMat, standardMat1];

    const indices: number[] = [];
    forEachStandardMaterial(mesh, (_mat, idx) => { indices.push(idx); });

    // Should get indices 1 and 3 (the standard materials)
    expect(indices).toEqual([1, 3]);
  });

  it('handles empty material array without calling fn', () => {
    const mesh = new Mesh();
    mesh.material = [];
    const fn = vi.fn();
    forEachStandardMaterial(mesh, fn);
    expect(fn).not.toHaveBeenCalled();
  });

  it('allows fn to mutate material properties', () => {
    const mesh = new Mesh();
    const mat = new MeshStandardMaterial();
    mat.emissiveIntensity = 1;
    mesh.material = mat;

    forEachStandardMaterial(mesh, (m) => { m.emissiveIntensity = 5; });

    expect(mat.emissiveIntensity).toBe(5);
    expect(mat.needsUpdate).toBe(true);
  });
});

// ── applyArenaRole ──────────────────────────────────────

describe('applyArenaRole', () => {
  /** Helper to create a mesh with a fresh MeshStandardMaterial */
  function makeMesh(opts?: { map?: object; emissiveMap?: object }): THREE.Mesh {
    const mesh = new Mesh();
    const mat = new MeshStandardMaterial();
    if (opts?.map) (mat as Record<string, unknown>).map = opts.map;
    if (opts?.emissiveMap) (mat as Record<string, unknown>).emissiveMap = opts.emissiveMap;
    mesh.material = mat;
    return mesh as unknown as THREE.Mesh;
  }

  function getMat(mesh: THREE.Mesh): THREE.MeshStandardMaterial {
    return mesh.material as unknown as THREE.MeshStandardMaterial;
  }

  const ALL_ROLE_IDS: ArenaVisualRoleId[] = [
    'glowBlue', 'wallBodyDark', 'standDark', 'floorBase',
    'buildingFaceTeal', 'trimCyan', 'floodCool', 'skylineEdges',
    'floodWarm', 'heroWallWarm', 'windowPanelsCool', 'buildingWindowCool',
    'accentWindowWarm',
  ];

  it('sets emissive hex from role definition for every role', () => {
    for (const roleId of ALL_ROLE_IDS) {
      const mesh = makeMesh();
      applyArenaRole(mesh, roleId);
      const mat = getMat(mesh);
      const role = ARENA_VISUAL_ROLES[roleId];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((mat.emissive as any)._hex).toBe(role.emissiveHex);
    }
  });

  it('sets baseIntensity on a plain material (no detail maps)', () => {
    for (const roleId of ALL_ROLE_IDS) {
      const mesh = makeMesh();
      applyArenaRole(mesh, roleId);
      const mat = getMat(mesh);
      const role = ARENA_VISUAL_ROLES[roleId];
      expect(mat.emissiveIntensity).toBe(role.baseIntensity);
    }
  });

  it('sets color hex from role definition on a plain material', () => {
    for (const roleId of ALL_ROLE_IDS) {
      const mesh = makeMesh();
      applyArenaRole(mesh, roleId);
      const mat = getMat(mesh);
      const role = ARENA_VISUAL_ROLES[roleId];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((mat.color as any)._hex).toBe(role.colorHex);
    }
  });

  it('promotes base map to emissiveMap for skylineEdges when only map present', () => {
    const fakeMap = { isTexture: true };
    const mesh = makeMesh({ map: fakeMap });
    applyArenaRole(mesh, 'skylineEdges');
    const mat = getMat(mesh);
    expect(mat.emissiveMap).toBe(fakeMap);
  });

  it('promotes base map to emissiveMap for windowPanelsCool', () => {
    const fakeMap = { isTexture: true };
    const mesh = makeMesh({ map: fakeMap });
    applyArenaRole(mesh, 'windowPanelsCool');
    const mat = getMat(mesh);
    expect(mat.emissiveMap).toBe(fakeMap);
  });

  it('promotes base map to emissiveMap for buildingWindowCool', () => {
    const fakeMap = { isTexture: true };
    const mesh = makeMesh({ map: fakeMap });
    applyArenaRole(mesh, 'buildingWindowCool');
    const mat = getMat(mesh);
    expect(mat.emissiveMap).toBe(fakeMap);
  });

  it('promotes base map to emissiveMap for buildingFaceTeal', () => {
    const fakeMap = { isTexture: true };
    const mesh = makeMesh({ map: fakeMap });
    applyArenaRole(mesh, 'buildingFaceTeal');
    const mat = getMat(mesh);
    expect(mat.emissiveMap).toBe(fakeMap);
  });

  it('does NOT promote base map when emissiveMap already present', () => {
    const fakeMap = { isTexture: true };
    const fakeEmissiveMap = { isTexture: true, isEmissive: true };
    const mesh = makeMesh({ map: fakeMap, emissiveMap: fakeEmissiveMap });
    applyArenaRole(mesh, 'skylineEdges');
    const mat = getMat(mesh);
    // Should keep the existing emissiveMap, not replace with base map
    expect(mat.emissiveMap).toBe(fakeEmissiveMap);
  });

  it('applies ARENA_MIST color for skylineEdges with baked detail map', () => {
    const fakeMap = { isTexture: true };
    const fakeEmissive = { isTexture: true };
    const mesh = makeMesh({ map: fakeMap, emissiveMap: fakeEmissive });
    applyArenaRole(mesh, 'skylineEdges');
    const mat = getMat(mesh);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((mat.color as any)._hex).toBe(ARENA_MIST);
  });

  it('applies ARENA_PANEL_TEAL color for wallBodyDark with detail map', () => {
    const fakeMap = { isTexture: true };
    const mesh = makeMesh({ map: fakeMap });
    applyArenaRole(mesh, 'wallBodyDark');
    const mat = getMat(mesh);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((mat.color as any)._hex).toBe(ARENA_PANEL_TEAL);
  });

  it('applies ARENA_PANEL_TEAL color for standDark with detail map', () => {
    const fakeMap = { isTexture: true };
    const mesh = makeMesh({ map: fakeMap });
    applyArenaRole(mesh, 'standDark');
    const mat = getMat(mesh);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((mat.color as any)._hex).toBe(ARENA_PANEL_TEAL);
  });

  it('applies ARENA_TEAL_BRIGHT for buildingFaceTeal with detail map', () => {
    const fakeMap = { isTexture: true };
    const fakeEmissive = { isTexture: true };
    const mesh = makeMesh({ map: fakeMap, emissiveMap: fakeEmissive });
    applyArenaRole(mesh, 'buildingFaceTeal');
    const mat = getMat(mesh);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((mat.color as any)._hex).toBe(ARENA_TEAL_BRIGHT);
  });

  it('boosts emissiveIntensity for skylineEdges with promoted detail map', () => {
    const fakeMap = { isTexture: true };
    const mesh = makeMesh({ map: fakeMap });
    applyArenaRole(mesh, 'skylineEdges');
    const mat = getMat(mesh);
    const role = ARENA_VISUAL_ROLES['skylineEdges'];
    expect(mat.emissiveIntensity).toBe(role.baseIntensity + 0.12);
  });

  it('boosts emissiveIntensity for windowPanelsCool with promoted detail map', () => {
    const fakeMap = { isTexture: true };
    const mesh = makeMesh({ map: fakeMap });
    applyArenaRole(mesh, 'windowPanelsCool');
    const mat = getMat(mesh);
    const role = ARENA_VISUAL_ROLES['windowPanelsCool'];
    expect(mat.emissiveIntensity).toBe(role.baseIntensity + 0.1);
  });

  it('boosts emissiveIntensity for buildingFaceTeal with promoted detail map', () => {
    const fakeMap = { isTexture: true };
    const mesh = makeMesh({ map: fakeMap });
    applyArenaRole(mesh, 'buildingFaceTeal');
    const mat = getMat(mesh);
    const role = ARENA_VISUAL_ROLES['buildingFaceTeal'];
    expect(mat.emissiveIntensity).toBe(role.baseIntensity + 0.05);
  });

  it('works with material array (multi-material mesh)', () => {
    const mesh = new Mesh();
    const mat0 = new MeshStandardMaterial();
    const mat1 = new MeshStandardMaterial();
    mesh.material = [mat0, mat1];
    applyArenaRole(mesh as unknown as THREE.Mesh, 'floodWarm');
    const role = ARENA_VISUAL_ROLES['floodWarm'];
    expect(mat0.emissiveIntensity).toBe(role.baseIntensity);
    expect(mat1.emissiveIntensity).toBe(role.baseIntensity);
  });

  it('skips non-MeshStandardMaterial in material array', () => {
    const mesh = new Mesh();
    const basicMat = new MeshBasicMaterial();
    const stdMat = new MeshStandardMaterial();
    mesh.material = [basicMat, stdMat];
    applyArenaRole(mesh as unknown as THREE.Mesh, 'trimCyan');
    const role = ARENA_VISUAL_ROLES['trimCyan'];
    expect(stdMat.emissiveIntensity).toBe(role.baseIntensity);
    // basicMat should be unaffected
    expect(basicMat.needsUpdate).toBe(false);
  });

  it('boosts emissiveIntensity by +0.04 for skylineEdges with existing emissiveMap (not promoted)', () => {
    const fakeMap = { isTexture: true };
    const fakeEmissive = { isTexture: true };
    const mesh = makeMesh({ map: fakeMap, emissiveMap: fakeEmissive });
    applyArenaRole(mesh, 'skylineEdges');
    const mat = getMat(mesh);
    const role = ARENA_VISUAL_ROLES['skylineEdges'];
    // hasBakedDetailMap=true, shouldPromoteDetailMap=false => +0.04
    expect(mat.emissiveIntensity).toBe(role.baseIntensity + 0.04);
  });

  it('boosts emissiveIntensity by +0.04 for windowPanelsCool with existing emissiveMap', () => {
    const fakeMap = { isTexture: true };
    const fakeEmissive = { isTexture: true };
    const mesh = makeMesh({ map: fakeMap, emissiveMap: fakeEmissive });
    applyArenaRole(mesh, 'windowPanelsCool');
    const mat = getMat(mesh);
    const role = ARENA_VISUAL_ROLES['windowPanelsCool'];
    expect(mat.emissiveIntensity).toBe(role.baseIntensity + 0.04);
  });

  it('boosts emissiveIntensity by +0.04 for buildingWindowCool with existing emissiveMap', () => {
    const fakeMap = { isTexture: true };
    const fakeEmissive = { isTexture: true };
    const mesh = makeMesh({ map: fakeMap, emissiveMap: fakeEmissive });
    applyArenaRole(mesh, 'buildingWindowCool');
    const mat = getMat(mesh);
    const role = ARENA_VISUAL_ROLES['buildingWindowCool'];
    expect(mat.emissiveIntensity).toBe(role.baseIntensity + 0.04);
  });

  it('boosts emissiveIntensity for buildingWindowCool with promoted detail map (+0.1)', () => {
    const fakeMap = { isTexture: true };
    const mesh = makeMesh({ map: fakeMap });
    applyArenaRole(mesh, 'buildingWindowCool');
    const mat = getMat(mesh);
    const role = ARENA_VISUAL_ROLES['buildingWindowCool'];
    expect(mat.emissiveIntensity).toBe(role.baseIntensity + 0.1);
  });

  it('preserves authored glow texture color for glowBlue with baked detail map', () => {
    const fakeMap = { isTexture: true };
    const mesh = makeMesh({ map: fakeMap });
    applyArenaRole(mesh, 'glowBlue');
    const mat = getMat(mesh);
    const role = ARENA_VISUAL_ROLES['glowBlue'];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((mat.color as any)._hex).toBe(role.colorHex);
  });

  it('applies ARENA_MIST color for windowPanelsCool with baked detail map', () => {
    const fakeMap = { isTexture: true };
    const fakeEmissive = { isTexture: true };
    const mesh = makeMesh({ map: fakeMap, emissiveMap: fakeEmissive });
    applyArenaRole(mesh, 'windowPanelsCool');
    const mat = getMat(mesh);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((mat.color as any)._hex).toBe(ARENA_MIST);
  });

  it('applies ARENA_MIST color for buildingWindowCool with baked detail map', () => {
    const fakeMap = { isTexture: true };
    const fakeEmissive = { isTexture: true };
    const mesh = makeMesh({ map: fakeMap, emissiveMap: fakeEmissive });
    applyArenaRole(mesh, 'buildingWindowCool');
    const mat = getMat(mesh);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((mat.color as any)._hex).toBe(ARENA_MIST);
  });

  it('does NOT promote map to emissiveMap for roles that are not in the promotion list', () => {
    const fakeMap = { isTexture: true };
    const mesh = makeMesh({ map: fakeMap });
    applyArenaRole(mesh, 'floodWarm');
    const mat = getMat(mesh);
    expect(mat.emissiveMap).toBeNull();
  });

  it('does NOT promote map for heroWallWarm even with only map present', () => {
    const fakeMap = { isTexture: true };
    const mesh = makeMesh({ map: fakeMap });
    applyArenaRole(mesh, 'heroWallWarm');
    const mat = getMat(mesh);
    expect(mat.emissiveMap).toBeNull();
  });
});

// ── setArenaRoleReactiveIntensity ───────────────────────

describe('setArenaRoleReactiveIntensity', () => {
  function makeMesh(): THREE.Mesh {
    const mesh = new Mesh();
    const mat = new MeshStandardMaterial();
    mesh.material = mat;
    return mesh as unknown as THREE.Mesh;
  }

  function getMat(mesh: THREE.Mesh): THREE.MeshStandardMaterial {
    return mesh.material as unknown as THREE.MeshStandardMaterial;
  }

  it('clamps to reactiveMax when targetIntensity exceeds it', () => {
    const mesh = makeMesh();
    const role = ARENA_VISUAL_ROLES['floodWarm'];
    setArenaRoleReactiveIntensity(mesh, 'floodWarm', 999);
    expect(getMat(mesh).emissiveIntensity).toBe(role.reactiveMax);
  });

  it('sets exact targetIntensity when below reactiveMax', () => {
    const mesh = makeMesh();
    setArenaRoleReactiveIntensity(mesh, 'floodWarm', 0.5);
    expect(getMat(mesh).emissiveIntensity).toBe(0.5);
  });

  it('sets zero intensity when targetIntensity is 0', () => {
    const mesh = makeMesh();
    setArenaRoleReactiveIntensity(mesh, 'floodWarm', 0);
    expect(getMat(mesh).emissiveIntensity).toBe(0);
  });

  it('clamps negative targetIntensity to reactiveMax min(max, negative)', () => {
    const mesh = makeMesh();
    // Math.min(reactiveMax, negative) = negative
    setArenaRoleReactiveIntensity(mesh, 'floodWarm', -5);
    expect(getMat(mesh).emissiveIntensity).toBe(-5);
  });

  it('applies to all standard materials in an array', () => {
    const mesh = new Mesh();
    const mat0 = new MeshStandardMaterial();
    const mat1 = new MeshStandardMaterial();
    mesh.material = [mat0, mat1];
    setArenaRoleReactiveIntensity(mesh as unknown as THREE.Mesh, 'standDark', 0.5);
    expect(mat0.emissiveIntensity).toBe(0.5);
    expect(mat1.emissiveIntensity).toBe(0.5);
  });

  it('respects different reactiveMax per role', () => {
    const mesh1 = makeMesh();
    const mesh2 = makeMesh();
    setArenaRoleReactiveIntensity(mesh1, 'glowBlue', 999);
    setArenaRoleReactiveIntensity(mesh2, 'standDark', 999);
    // glowBlue reactiveMax = 0, standDark reactiveMax = 1.43
    expect(getMat(mesh1).emissiveIntensity).toBe(ARENA_VISUAL_ROLES['glowBlue'].reactiveMax);
    expect(getMat(mesh2).emissiveIntensity).toBe(ARENA_VISUAL_ROLES['standDark'].reactiveMax);
  });

  it('glowBlue with reactiveMax=0 always clamps to 0', () => {
    const mesh = makeMesh();
    setArenaRoleReactiveIntensity(mesh, 'glowBlue', 0.5);
    expect(getMat(mesh).emissiveIntensity).toBe(0);
  });

  it('sets exact reactiveMax when targetIntensity equals reactiveMax', () => {
    const mesh = makeMesh();
    const role = ARENA_VISUAL_ROLES['standDark'];
    setArenaRoleReactiveIntensity(mesh, 'standDark', role.reactiveMax);
    expect(getMat(mesh).emissiveIntensity).toBe(role.reactiveMax);
  });

  it('sets needsUpdate on all materials after intensity change', () => {
    const mesh = new Mesh();
    const mat0 = new MeshStandardMaterial();
    const mat1 = new MeshStandardMaterial();
    mat0.needsUpdate = false;
    mat1.needsUpdate = false;
    mesh.material = [mat0, mat1];
    setArenaRoleReactiveIntensity(mesh as unknown as THREE.Mesh, 'standDark', 0.5);
    expect(mat0.needsUpdate).toBe(true);
    expect(mat1.needsUpdate).toBe(true);
  });
});

// ── updateWallGlow ──────────────────────────────────────

describe('updateWallGlow', () => {
  it('does not throw when reactive state is null', () => {
    // getArenaReactive() returns null before createArena is called
    expect(() => updateWallGlow(5)).not.toThrow();
  });

  it('does not throw when distance is 0', () => {
    expect(() => updateWallGlow(0)).not.toThrow();
  });

  it('does not throw when distance is very large', () => {
    expect(() => updateWallGlow(100000)).not.toThrow();
  });

  it('does not throw with negative distance', () => {
    expect(() => updateWallGlow(-10)).not.toThrow();
  });
});

// ── State accessors ─────────────────────────────────────

describe('getArenaReactive', () => {
  it('returns null before createArena is called', () => {
    expect(getArenaReactive()).toBeNull();
  });
});

describe('getCameraCollisionMeshes', () => {
  it('returns empty array when reactive state is null', () => {
    expect(getCameraCollisionMeshes()).toEqual([]);
  });

  it('return type is an array', () => {
    const result = getCameraCollisionMeshes();
    expect(Array.isArray(result)).toBe(true);
  });
});

describe('setSpectatorTargets', () => {
  it('does not throw when reactive state is null and targets are valid', () => {
    expect(() => setSpectatorTargets([{ x: 10, z: 20 }])).not.toThrow();
  });

  it('does not throw when reactive state is null and targets contain nulls', () => {
    expect(() => setSpectatorTargets([null, null])).not.toThrow();
  });

  it('does not throw with empty array', () => {
    expect(() => setSpectatorTargets([])).not.toThrow();
  });
});

// ── ARENA_VISUAL_ROLES constant ─────────────────────────

describe('ARENA_VISUAL_ROLES', () => {
  const ALL_ROLE_IDS: ArenaVisualRoleId[] = [
    'glowBlue', 'wallBodyDark', 'standDark', 'floorBase',
    'buildingFaceTeal', 'trimCyan', 'floodCool', 'skylineEdges',
    'floodWarm', 'heroWallWarm', 'windowPanelsCool', 'buildingWindowCool',
    'accentWindowWarm',
  ];

  it('contains all 13 visual role IDs', () => {
    expect(Object.keys(ARENA_VISUAL_ROLES)).toHaveLength(13);
  });

  it('every role has required numeric properties', () => {
    for (const roleId of ALL_ROLE_IDS) {
      const role = ARENA_VISUAL_ROLES[roleId];
      expect(role).toBeDefined();
      expect(typeof role.colorHex).toBe('number');
      expect(typeof role.emissiveHex).toBe('number');
      expect(typeof role.baseIntensity).toBe('number');
      expect(typeof role.reactiveMax).toBe('number');
    }
  });

  it('all baseIntensity values are non-negative', () => {
    for (const roleId of ALL_ROLE_IDS) {
      expect(ARENA_VISUAL_ROLES[roleId].baseIntensity).toBeGreaterThanOrEqual(0);
    }
  });

  it('all reactiveMax values are non-negative', () => {
    for (const roleId of ALL_ROLE_IDS) {
      expect(ARENA_VISUAL_ROLES[roleId].reactiveMax).toBeGreaterThanOrEqual(0);
    }
  });

  it('glowBlue has reactiveMax of 0 (non-reactive)', () => {
    expect(ARENA_VISUAL_ROLES['glowBlue'].reactiveMax).toBe(0);
  });

  it('floodWarm has the highest reactiveMax', () => {
    const maxReactive = Math.max(...ALL_ROLE_IDS.map(id => ARENA_VISUAL_ROLES[id].reactiveMax));
    expect(ARENA_VISUAL_ROLES['floodWarm'].reactiveMax).toBe(maxReactive);
  });

  it('no role has baseIntensity greater than 3', () => {
    for (const roleId of ALL_ROLE_IDS) {
      expect(ARENA_VISUAL_ROLES[roleId].baseIntensity).toBeLessThanOrEqual(3);
    }
  });
});
