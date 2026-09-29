// ── arenaEffects.ts unit tests ───────────────────────────
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock Three.js ────────────────────────────────────────
vi.mock('three', () => {
  class Color {
    r = 0; g = 0; b = 0; isColor = true; _hex = 0;
    constructor(c?: number) { if (c !== undefined) this.setHex(c); }
    setHex(hex: number) { this._hex = hex; this.r = ((hex >> 16) & 0xff) / 255; this.g = ((hex >> 8) & 0xff) / 255; this.b = (hex & 0xff) / 255; return this; }
    getHex() { return this._hex; }
    copy(c: Color) { this.r = c.r; this.g = c.g; this.b = c.b; this._hex = c._hex; return this; }
    lerp(c: Color, t: number) { this.r += (c.r - this.r) * t; this.g += (c.g - this.g) * t; this.b += (c.b - this.b) * t; return this; }
    setHSL() { return this; }
    multiplyScalar() { return this; }
  }
  class Vector3 { x: number; y: number; z: number; constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } }
  class BufferGeometry { attributes: Record<string, unknown> = {}; setAttribute = vi.fn(); setFromPoints = vi.fn(() => this); dispose = vi.fn(); }
  class LineBasicMaterial {
    color: Color; transparent = true; opacity = 1; linewidth = 1; dispose = vi.fn();
    constructor(opts?: Record<string, unknown>) { this.color = new Color(opts?.color as number ?? 0); if (opts?.opacity !== undefined) this.opacity = opts.opacity as number; }
  }
  class PointsMaterial { size = 1; transparent = true; opacity = 1; dispose = vi.fn(); }
  class Line {
    material: LineBasicMaterial; position = { y: 0, set: vi.fn() }; scale = { set: vi.fn() }; visible = true;
    constructor(public geometry: BufferGeometry, mat: LineBasicMaterial) { this.material = mat; }
  }
  class Points { constructor(public geometry: BufferGeometry, public material: PointsMaterial) {} }
  class Scene { children: unknown[] = []; add = vi.fn(); remove = vi.fn(); }
  return { Color, Vector3, BufferGeometry, BufferAttribute: vi.fn(), LineBasicMaterial, PointsMaterial, Line, Points, Scene, Mesh: class { material = {}; scale = { y: 1 }; }, MeshStandardMaterial: class { color = new Color(); emissive = new Color(); emissiveIntensity = 1; }, MeshBasicMaterial: class { opacity = 1; }, PointLight: vi.fn(), SpotLight: vi.fn(), AdditiveBlending: 2 };
});

// ── Mock project dependencies ───────────────────────────
const mockReactive = {
  flowTexture: null as { offset: { x: number } } | null,
  gridMain: null, reflector: null, barriers: [] as unknown[], laserBeams: null,
  accentRings: [], tierStrips: [], stadLights: [], raveSpots: [],
  satellites: null, flyoverShips: null, starMesh: null, starMaterial: null, starBaseSizes: null,
  fireworks: null, spectatorDrone: null,
  v2FloodLights: [], v2GlowCyan: [], v2GlowBlue: [], v2Windows: [],
  v2WallBarrier: [], v2ArenaWall: [], v2ArenaFloor: [], v2CrowdStands: [],
  v2SkylineEdges: [], v2BuildingFaces: [], v2BuildingAccentWindows: [], v2WallBody: [],
};

vi.mock('../grid', () => ({
  getArenaReactive: vi.fn(() => mockReactive),
  forEachStandardMaterial: vi.fn(),
  setArenaRoleReactiveIntensity: vi.fn(),
  FLOOD_LIGHT_SETTINGS: { warmPulseBase: 0.5, warmPulseKick: 0.3, warmPulseBass: 0.2, coolPulseBase: 0.4, coolPulseKick: 0.25, coolPulseBass: 0.15 },
}));
vi.mock('../graphics', () => ({ getGfx: vi.fn(() => ({ audioReactivity: 'full', arenaDetail: 'full' })), bloomMul: { vehicles: 1, trails: 1, environment: 1, lights: 1 } }));
vi.mock('../playerColors', () => ({
  PLAYER_COLORS: [
    { key: 'red', color: 0xC02018 }, { key: 'orange', color: 0xE08830 },
    { key: 'cyan', color: 0x49A2B2 }, { key: 'teal', color: 0x2D6469 },
    { key: 'blue', color: 0x1A6A8A }, { key: 'pink', color: 0xD440B8 },
    { key: 'green', color: 0x66D450 }, { key: 'white', color: 0xE0F0F0 },
  ],
}));

import * as THREE from 'three';
import { getPaletteColor, getPaletteColorBright, updateArenaAudio, triggerCountdownPulse, clearCountdownPulses, updateCountdownPulses } from '../arenaEffects';
import type { AudioBands } from '../arenaEffects';
import { getArenaReactive } from '../grid';

function makeBands(o?: Partial<AudioBands>): AudioBands {
  return { bass: 0, lowMid: 0, mid: 0, upperMid: 0, presence: 0, energy: 0, kick: 0, ...o };
}

// ── Tests ────────────────────────────────────────────────

describe('getPaletteColor', () => {
  it('returns a Color with numeric RGB fields', () => {
    const c = getPaletteColor(0);
    expect(c.r).toBeTypeOf('number');
    expect(c.g).toBeTypeOf('number');
    expect(c.b).toBeTypeOf('number');
  });

  it('does not throw for negative or very large offsets', () => {
    expect(() => getPaletteColor(-10)).not.toThrow();
    expect(() => getPaletteColor(100000)).not.toThrow();
  });
});

describe('getPaletteColorBright', () => {
  it('returns a Color and does not throw for various offsets', () => {
    for (const offset of [0, 22.5, -5]) {
      const c = getPaletteColorBright(offset);
      expect(c).toHaveProperty('r');
    }
  });
});

describe('updateArenaAudio', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReactive.flowTexture = { offset: { x: 0 } };
    mockReactive.barriers = [];
    mockReactive.fireworks = null;
  });

  it('exits early if reactive state is null', () => {
    vi.mocked(getArenaReactive).mockReturnValueOnce(null);
    expect(() => updateArenaAudio(makeBands())).not.toThrow();
  });

  it('scrolls flow texture offset based on bass', () => {
    updateArenaAudio(makeBands({ bass: 0.5 }), 0.016, 'playing');
    expect(mockReactive.flowTexture!.offset.x).toBeGreaterThan(0);
  });

  it('scrolls flow texture with base scroll even at zero bass', () => {
    updateArenaAudio(makeBands({ bass: 0 }), 0.016, 'playing');
    expect(mockReactive.flowTexture!.offset.x).toBeCloseTo(0.004, 3);
  });

  it('uses default dt and gameState when omitted', () => {
    expect(() => updateArenaAudio(makeBands())).not.toThrow();
    expect(() => updateArenaAudio(makeBands(), 0.016)).not.toThrow();
  });
});

describe('triggerCountdownPulse', () => {
  let scene: THREE.Scene;
  beforeEach(() => { scene = new THREE.Scene(); clearCountdownPulses(); vi.clearAllMocks(); });
  afterEach(() => { clearCountdownPulses(); });

  it('creates correct number of rings per countdown number', () => {
    const expected: [number, number][] = [[3, 1], [2, 2], [1, 3], [0, 3]];
    for (const [num, count] of expected) {
      vi.mocked(scene.add).mockClear();
      clearCountdownPulses();
      triggerCountdownPulse(scene, num);
      expect(scene.add).toHaveBeenCalledTimes(count);
    }
  });
});

describe('clearCountdownPulses', () => {
  let scene: THREE.Scene;
  beforeEach(() => { scene = new THREE.Scene(); vi.clearAllMocks(); });

  it('is safe to call when no rings exist', () => {
    expect(() => clearCountdownPulses()).not.toThrow();
  });

  it('removes and disposes all ring resources', () => {
    triggerCountdownPulse(scene, 3);
    const line = vi.mocked(scene.add).mock.calls[0][0] as THREE.Line;
    clearCountdownPulses();
    expect(scene.remove).toHaveBeenCalled();
    expect(line.geometry.dispose).toHaveBeenCalled();
    expect((line.material as THREE.LineBasicMaterial).dispose).toHaveBeenCalled();
  });
});

describe('updateCountdownPulses', () => {
  let scene: THREE.Scene;
  beforeEach(() => { scene = new THREE.Scene(); clearCountdownPulses(); vi.clearAllMocks(); });
  afterEach(() => { clearCountdownPulses(); });

  it('does nothing when no rings exist', () => {
    expect(() => updateCountdownPulses(0.016)).not.toThrow();
  });

  it('scales rings and fades opacity during expansion', () => {
    triggerCountdownPulse(scene, 3);
    const line = vi.mocked(scene.add).mock.calls[0][0] as THREE.Line;
    updateCountdownPulses(0.5);
    expect(line.scale.set).toHaveBeenCalled();
    expect((line.material as THREE.LineBasicMaterial).opacity).toBeLessThanOrEqual(0.25);
    expect((line.material as THREE.LineBasicMaterial).opacity).toBeGreaterThanOrEqual(0);
  });

  it('removes rings when fully expanded (t >= 1)', () => {
    triggerCountdownPulse(scene, 3);
    updateCountdownPulses(0.6);
    updateCountdownPulses(0.6);
    expect(scene.remove).toHaveBeenCalled();
  });
});

describe('AudioBands type', () => {
  it('accepts all required band properties', () => {
    const b: AudioBands = { bass: 0.5, lowMid: 0.3, mid: 0.4, upperMid: 0.2, presence: 0.1, energy: 0.6, kick: 0.8 };
    expect(b.bass).toBe(0.5);
    expect(b.kick).toBe(0.8);
  });
});
