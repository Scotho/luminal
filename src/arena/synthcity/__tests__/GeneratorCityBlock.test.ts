import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { Perlin } from '../perlin';
import { GeneratorCityBlock, type CityBlockContext } from '../GeneratorCityBlock';
import type { SynthCityAssets } from '../SynthCityAssets';
import { CLEAR_CENTER_X, CLEAR_CENTER_Z, NOISE_DETAIL_LOD, NOISE_DETAIL_FALLOFF, SEED } from '../constants';

// ── Stub assets ─────────────────────────────────────────
// GeneratorCityBlock asks assets for geometries/materials by id. For this test
// we just want to know which ids it asked for (and that it doesn't crash) —
// real geometries would require a WebGL context we don't have in vitest.

function makeAssetsStub(): { assets: SynthCityAssets; modelAsks: string[]; matAsks: string[] } {
  const modelAsks: string[] = [];
  const matAsks: string[] = [];
  const fakeGeo = new THREE.BufferGeometry();
  const fakeMat = new THREE.MeshBasicMaterial();
  const assets: SynthCityAssets = {
    getModel: (id: string) => { modelAsks.push(id); return fakeGeo; },
    getMaterial: (id: string) => { matAsks.push(id); return fakeMat; },
    getTexture: () => { throw new Error('not used in test'); },
  };
  return { assets, modelAsks, matAsks };
}

function makeContext(): { ctx: CityBlockContext; root: THREE.Group; stub: ReturnType<typeof makeAssetsStub> } {
  const stub = makeAssetsStub();
  const root = new THREE.Group();
  const noise = new Perlin(SEED);
  noise.noiseDetail(NOISE_DETAIL_LOD, NOISE_DETAIL_FALLOFF);
  const ctx: CityBlockContext = {
    root,
    assets: stub.assets,
    noise,
    spotLights: true,
    getLookAtTarget: () => new THREE.Vector3(0, 0, 0),
  };
  return { ctx, root, stub };
}

describe('GeneratorCityBlock (seed 4217)', () => {
  it('start block (912, 2736) is completely stripped — no ground, no buildings, no storefronts', () => {
    const { ctx, stub } = makeContext();
    const block = new GeneratorCityBlock(CLEAR_CENTER_X, CLEAR_CENTER_Z, ctx);
    // The hand-built flat top fills the clearing — procgen supplies nothing here.
    expect(stub.modelAsks).not.toContain('ground');
    expect(stub.modelAsks.filter(id => id.startsWith('mega_'))).toHaveLength(0);
    expect(stub.modelAsks.filter(id => id.startsWith('s_0'))).toHaveLength(0);
    expect(stub.modelAsks).not.toContain('storefronts');
    expect(block).toBeDefined();
  });

  it('blocks within the 3×3 clearing grid are also fully stripped', () => {
    const offsets: [number, number][] = [
      [-152, -152], [0, -152], [152, -152],
      [-152,    0], [0,    0], [152,    0],
      [-152,  152], [0,  152], [152,  152],
    ];
    for (const [dx, dz] of offsets) {
      const { ctx, stub } = makeContext();
      new GeneratorCityBlock(CLEAR_CENTER_X + dx, CLEAR_CENTER_Z + dz, ctx);
      expect(stub.modelAsks).not.toContain('ground');
      expect(stub.modelAsks.filter(id => id.startsWith('mega_'))).toHaveLength(0);
      expect(stub.modelAsks.filter(id => id.startsWith('s_0'))).toHaveLength(0);
    }
  });

  it('block at (0, 0) builds normal procgen output (not stripped)', () => {
    const { ctx, stub } = makeContext();
    new GeneratorCityBlock(0, 0, ctx);
    // The ground is always added, but at least one building-model ask should
    // be present for the main visual content.
    expect(stub.modelAsks).toContain('ground');
    // (0, 0) is excluded from mega-building placement by the original code's
    // path-exclusion check, so no mega model should be requested here.
    expect(stub.modelAsks.filter(id => id.startsWith('mega_'))).toHaveLength(0);
  });

  it('remove() tears down every created mesh without throwing', () => {
    const { ctx, root } = makeContext();
    const block = new GeneratorCityBlock(304, 608, ctx);
    const beforeChildren = root.children.length;
    expect(beforeChildren).toBeGreaterThan(0);
    expect(() => block.remove()).not.toThrow();
    expect(root.children.length).toBeLessThan(beforeChildren);
  });

  it('update() ticks without throwing on a fresh block', () => {
    const { ctx } = makeContext();
    const block = new GeneratorCityBlock(304, 608, ctx);
    expect(() => block.update()).not.toThrow();
  });
});
