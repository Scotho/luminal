// ── atmosphere.ts unit tests ─────────────────────────────
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock Three.js ────────────────────────────────────────
vi.mock('three', () => {
  class Color {
    r = 0; g = 0; b = 0; isColor = true; _hex = 0;
    constructor(c?: number) { if (c !== undefined) this._hex = c; }
    setHex(hex: number) { this._hex = hex; return this; }
    copy(c: Color) { this.r = c.r; this.g = c.g; this.b = c.b; this._hex = c._hex; return this; }
    lerp(c: Color, t: number) { this.r += (c.r - this.r) * t; this.g += (c.g - this.g) * t; this.b += (c.b - this.b) * t; return this; }
    clone() { const c = new Color(); c.r = this.r; c.g = this.g; c.b = this.b; c._hex = this._hex; return c; }
  }
  class FogExp2 { constructor(public color: number, public density: number) {} }
  class PlaneGeometry { dispose = vi.fn(); }
  class ShaderMaterial {
    transparent = true; depthWrite = false; blending = 0; side = 0; dispose = vi.fn();
    uniforms: Record<string, { value: unknown }>;
    constructor(opts?: Record<string, unknown>) { this.uniforms = (opts?.uniforms ?? {}) as Record<string, { value: unknown }>; }
  }
  class Vector3 {
    constructor(public x = 0, public y = 0, public z = 0) {}
    set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; return this; }
    copy(v: Vector3) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  }
  class Mesh {
    rotation = { x: 0 }; position = { y: 0, copy: vi.fn() }; renderOrder = 0;
    constructor(public geometry: unknown = new PlaneGeometry(), public material: ShaderMaterial = new ShaderMaterial()) {}
  }
  class Scene { fog: unknown = null; children: unknown[] = []; userData: Record<string, unknown> = {}; add = vi.fn(); remove = vi.fn(); }
  class WebGLRenderer { toneMappingExposure = 1.0; setSize = vi.fn(); setPixelRatio = vi.fn(); }
  return { Color, FogExp2, PlaneGeometry, ShaderMaterial, Vector3, Mesh, Scene, WebGLRenderer, AmbientLight: class { constructor(_c?: number, public intensity = 1) {} }, AdditiveBlending: 2 };
});

// ── Mock project dependencies ───────────────────────────
let onSettingsCb: ((g: GfxSettings) => void) | null = null;
import type { GfxSettings } from '../types/index';

vi.mock('../graphics', () => ({ onSettingsChange: vi.fn((cb: (g: GfxSettings) => void) => { onSettingsCb = cb; }) }));

import * as THREE from 'three';
import { createEarlyMist, updateEarlyMist, disposeEarlyMist, createAtmosphere, updateAtmosphere, disposeAtmosphere } from '../atmosphere';
import type { AtmosphereState } from '../atmosphere';

// ── Helpers ─────────────────────────────────────────────

function makeGfx(o?: Partial<GfxSettings>): GfxSettings {
  return { preset: 'high', bloom: 'high', antialias: true, pixelRatio: 2, arenaDetail: 'full', raveSpotlights: 4, audioReactivity: 'full', playerVFX: 'full', lighting: 'full', atmosphere: 'full', reflections: 'high', ...o };
}
function makeBands(o?: Partial<{ bass: number; energy: number; kick: number }>) { return { bass: 0, energy: 0, kick: 0, ...o }; }

// ── Tests ────────────────────────────────────────────────

describe('createEarlyMist', () => {
  it('returns 4 mist layers and adds them to scene', () => {
    const scene = new THREE.Scene();
    const meshes = createEarlyMist(scene);
    expect(meshes).toHaveLength(4);
    expect(scene.add).toHaveBeenCalledTimes(4);
  });

  it('each mesh has required uniforms, rotation, and renderOrder', () => {
    const meshes = createEarlyMist(new THREE.Scene());
    for (const mesh of meshes) {
      const mat = mesh.material as THREE.ShaderMaterial;
      for (const u of ['uTime', 'uColor', 'uOpacity', 'uNoiseScale', 'uSpeed', 'uWindShift']) {
        expect(mat.uniforms).toHaveProperty(u);
      }
      expect(mesh.rotation.x).toBeCloseTo(-Math.PI / 2, 5);
      expect(mesh.renderOrder).toBe(999);
    }
  });

  it('layers have increasing Y positions', () => {
    const meshes = createEarlyMist(new THREE.Scene());
    for (let i = 1; i < meshes.length; i++) expect(meshes[i].position.y).toBeGreaterThan(meshes[i - 1].position.y);
  });
});

describe('updateEarlyMist', () => {
  it('advances uTime uniform on each mesh', () => {
    const meshes = createEarlyMist(new THREE.Scene());
    const before = meshes.map(m => (m.material as THREE.ShaderMaterial).uniforms.uTime.value as number);
    updateEarlyMist(meshes, 0.5);
    for (let i = 0; i < meshes.length; i++) expect((meshes[i].material as THREE.ShaderMaterial).uniforms.uTime.value).toBeCloseTo(before[i] + 0.5, 5);
  });

  it('handles zero dt and empty array', () => {
    const meshes = createEarlyMist(new THREE.Scene());
    expect(() => updateEarlyMist(meshes, 0)).not.toThrow();
    expect(() => updateEarlyMist([], 0.016)).not.toThrow();
  });
});

describe('disposeEarlyMist', () => {
  it('removes and disposes meshes, sets userData to null', () => {
    const scene = new THREE.Scene();
    const meshes = createEarlyMist(scene);
    scene.userData._earlyMist = meshes;
    disposeEarlyMist(scene);
    expect(scene.remove).toHaveBeenCalledTimes(meshes.length);
    for (const m of meshes) {
      expect((m.geometry as THREE.PlaneGeometry).dispose).toHaveBeenCalled();
      expect((m.material as THREE.ShaderMaterial).dispose).toHaveBeenCalled();
    }
    expect(scene.userData._earlyMist).toBeNull();
  });

  it('does nothing if _earlyMist is not set or null', () => {
    const scene = new THREE.Scene();
    expect(() => disposeEarlyMist(scene)).not.toThrow();
    scene.userData._earlyMist = null;
    expect(() => disposeEarlyMist(scene)).not.toThrow();
    expect(scene.remove).not.toHaveBeenCalled();
  });
});

describe('createAtmosphere', () => {
  let scene: THREE.Scene, renderer: THREE.WebGLRenderer, ambient: THREE.AmbientLight;

  beforeEach(() => {
    scene = new THREE.Scene(); renderer = new THREE.WebGLRenderer(); ambient = new THREE.AmbientLight(0x0B363D, 0.75);
    onSettingsCb = null; vi.clearAllMocks();
  });

  it('returns AtmosphereState with correct defaults', () => {
    const s = createAtmosphere(scene, makeGfx(), renderer, ambient);
    expect(s).toMatchObject({ active: true, elapsed: 0, currentDensityMul: 1.0, currentSpeedMul: 1.0, adminFreeze: false });
    expect(s.fogReactiveRange).toBeGreaterThan(0);
  });

  it('stores the bloom pass reference without mutating exposure ownership', () => {
    renderer.toneMappingExposure = 1.5;
    ambient.intensity = 0.75;
    const bp = { strength: 0.85, radius: 0.22, threshold: 0.42 };
    const s = createAtmosphere(scene, makeGfx(), renderer, ambient, bp);
    expect(s.bloomPass).toBe(bp);
    expect(renderer.toneMappingExposure).toBe(1.5);
    expect(ambient.intensity).toBe(0.75);
    expect(bp.radius).toBe(0.22);
    expect(bp.threshold).toBe(0.42);
  });

  it('keeps bloomPass null when omitted and does not require an ambient light', () => {
    const s = createAtmosphere(scene, makeGfx(), renderer, null);
    expect(s.bloomPass).toBeNull();
  });

  it('applies fog for haze and full, no fog for off', () => {
    createAtmosphere(scene, makeGfx({ atmosphere: 'haze' }), renderer, ambient);
    expect(scene.fog).not.toBeNull();

    const scene2 = new THREE.Scene();
    createAtmosphere(scene2, makeGfx({ atmosphere: 'off' }), renderer, ambient);
    expect(scene2.fog).toBeNull();
  });

  it('creates mist meshes only for full level', () => {
    const full = createAtmosphere(scene, makeGfx({ atmosphere: 'full' }), renderer, ambient);
    expect(full.mistMeshes.length).toBeGreaterThan(0);
    const haze = createAtmosphere(new THREE.Scene(), makeGfx({ atmosphere: 'haze' }), renderer, ambient);
    expect(haze.mistMeshes).toHaveLength(0);
  });

  it('does not retune bloom pass for full level', () => {
    const bp = { strength: 0.85, radius: 0.22, threshold: 0.42 };
    createAtmosphere(scene, makeGfx({ atmosphere: 'full' }), renderer, ambient, bp);
    expect(bp.radius).toBe(0.22);
    expect(bp.threshold).toBe(0.42);
  });

  it('registers settings change listener', () => {
    createAtmosphere(scene, makeGfx(), renderer, ambient);
    expect(onSettingsCb).toBeTypeOf('function');
  });
});

describe('updateAtmosphere', () => {
  let state: AtmosphereState, scene: THREE.Scene;

  beforeEach(() => {
    scene = new THREE.Scene();
    vi.clearAllMocks();
    state = createAtmosphere(scene, makeGfx({ atmosphere: 'full' }), new THREE.WebGLRenderer(), new THREE.AmbientLight(0, 0.75));
  });

  it('does nothing when level is off or gameState is paused/waitingOnline', () => {
    state.level = 'off';
    updateAtmosphere(state, 0.5, makeBands(), makeGfx(), 'playing');
    expect(state.elapsed).toBe(0);

    state.level = 'full'; state.elapsed = 0;
    updateAtmosphere(state, 0.5, makeBands(), makeGfx(), 'paused');
    expect(state.elapsed).toBe(0);

    updateAtmosphere(state, 0.5, makeBands(), makeGfx(), 'waitingOnline');
    expect(state.elapsed).toBe(0);
  });

  it('advances elapsed time and lerps multipliers when playing', () => {
    updateAtmosphere(state, 0.5, makeBands(), makeGfx(), 'playing');
    expect(state.elapsed).toBeGreaterThan(0);
  });

  it('lerps density/speed toward gameover targets', () => {
    state.currentDensityMul = 1.0; state.currentSpeedMul = 1.0;
    updateAtmosphere(state, 1.0, makeBands(), makeGfx(), 'gameover');
    expect(state.currentDensityMul).toBeLessThan(1.0);
    expect(state.currentSpeedMul).toBeLessThan(1.0);
  });

  it('updates fog density based on energy', () => {
    scene.fog = new THREE.FogExp2(0x12122a, 0.004);
    state.scene = scene;
    updateAtmosphere(state, 0.016, makeBands({ energy: 0.8 }), makeGfx(), 'playing');
    expect((scene.fog as THREE.FogExp2).density).toBeGreaterThan(0);
  });

  it('updates mist uniforms for full level', () => {
    if (state.mistMeshes.length === 0) return;
    const t0 = (state.mistMeshes[0].material as THREE.ShaderMaterial).uniforms.uTime.value;
    updateAtmosphere(state, 0.5, makeBands({ kick: 0.5 }), makeGfx(), 'playing');
    expect((state.mistMeshes[0].material as THREE.ShaderMaterial).uniforms.uTime.value).not.toBe(t0);
  });

  it('skips reactive writes but still advances time when adminFreeze', () => {
    state.adminFreeze = true;
    scene.fog = new THREE.FogExp2(0x12122a, 0.004);
    state.scene = scene;
    const fogBefore = (scene.fog as THREE.FogExp2).density;
    updateAtmosphere(state, 0.5, makeBands({ energy: 1.0 }), makeGfx(), 'playing');
    expect((scene.fog as THREE.FogExp2).density).toBe(fogBefore);
    if (state.mistMeshes.length) {
      expect(state.elapsed).toBeGreaterThan(0);
    }
  });

  it('defaults to playing multipliers for unknown gameState', () => {
    state.currentDensityMul = 0.5;
    updateAtmosphere(state, 1.0, makeBands(), makeGfx(), 'unknownState');
    expect(state.currentDensityMul).toBeGreaterThan(0.5);
  });

  it('countdown state increases density above 1.0', () => {
    state.currentDensityMul = 1.0;
    updateAtmosphere(state, 1.0, makeBands(), makeGfx(), 'countdown');
    expect(state.currentDensityMul).toBeGreaterThan(1.0);
  });
});

describe('disposeAtmosphere', () => {
  let scene: THREE.Scene, renderer: THREE.WebGLRenderer, ambient: THREE.AmbientLight;

  beforeEach(() => {
    scene = new THREE.Scene(); renderer = new THREE.WebGLRenderer(); ambient = new THREE.AmbientLight(0, 0.75);
    vi.clearAllMocks();
  });

  it('marks state inactive, clears fog, sets level to off', () => {
    const s = createAtmosphere(scene, makeGfx({ atmosphere: 'full' }), renderer, ambient);
    disposeAtmosphere(s, renderer);
    expect(s.active).toBe(false);
    expect(scene.fog).toBeNull();
    expect(s.level).toBe('off');
  });

  it('does not mutate exposure, ambient intensity, or bloom pass values on dispose', () => {
    renderer.toneMappingExposure = 1.5;
    ambient.intensity = 0.75;
    const bp = { strength: 0.85, radius: 0.22, threshold: 0.42 };
    const s = createAtmosphere(scene, makeGfx({ atmosphere: 'full' }), renderer, ambient, bp);
    disposeAtmosphere(s, renderer);
    expect(renderer.toneMappingExposure).toBe(1.5);
    expect(ambient.intensity).toBe(0.75);
    expect(bp.radius).toBe(0.22);
    expect(bp.threshold).toBe(0.42);
  });

  it('disposes and removes all mist meshes', () => {
    const s = createAtmosphere(scene, makeGfx({ atmosphere: 'full' }), renderer, ambient);
    const geos = s.mistMeshes.map(m => m.geometry);
    const mats = s.mistMeshes.map(m => m.material);
    disposeAtmosphere(s, renderer);
    expect(s.mistMeshes).toHaveLength(0);
    for (const g of geos) expect((g as THREE.PlaneGeometry).dispose).toHaveBeenCalled();
    for (const m of mats) expect((m as THREE.ShaderMaterial).dispose).toHaveBeenCalled();
  });

  it('is safe with null ambient light and null bloom pass', () => {
    const s = createAtmosphere(scene, makeGfx(), renderer, null);
    expect(() => disposeAtmosphere(s, renderer)).not.toThrow();
  });
});
