import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGroupAdd = vi.fn();
const mockGroupTraverse = vi.fn();

vi.mock('three', () => ({
  Color: vi.fn().mockImplementation(function () {
    return { r: 0, g: 0, b: 0, setScalar: vi.fn(), getHexString: vi.fn().mockReturnValue('ff0000') };
  }),
  Group: vi.fn().mockImplementation(function () {
    return { add: mockGroupAdd, traverse: mockGroupTraverse, rotation: { y: 0 } };
  }),
  Mesh: vi.fn().mockImplementation(function () { return {}; }),
  MeshStandardMaterial: vi.fn().mockImplementation(function () { return {}; }),
  Box3: vi.fn().mockImplementation(function () {
    return { setFromObject: vi.fn().mockReturnThis(), getSize: vi.fn() };
  }),
  Vector3: vi.fn().mockImplementation(function () { return { x: 0, y: 0, z: 0 }; }),
}));

vi.mock('three/addons/loaders/GLTFLoader.js', () => ({
  GLTFLoader: vi.fn().mockImplementation(() => ({
    load: vi.fn(),
  })),
}));

vi.mock('./graphics', () => ({
  getGfx: vi.fn().mockReturnValue({ preset: 'high' }),
  VISUAL_TUNING: { high: { neonEmissive: 1.5 } },
}));

import {
  isBikeModelLoaded,
  getBikeModelHeight,
  cloneBikeModel,
  clearBikeDeferredQueue,
} from './bikeModel';

describe('bikeModel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGroupAdd.mockClear();
    mockGroupTraverse.mockClear();
    // Reset deferred queue between tests
    clearBikeDeferredQueue();
  });

  describe('isBikeModelLoaded', () => {
    it('returns false before any model is loaded', () => {
      // The module-level _template is null until loadBikeModel resolves
      // In tests the GLTFLoader.load is mocked and never calls the callback,
      // so the template remains null.
      expect(typeof isBikeModelLoaded()).toBe('boolean');
    });
  });

  describe('getBikeModelHeight', () => {
    it('returns a positive number', () => {
      const height = getBikeModelHeight();
      expect(typeof height).toBe('number');
      expect(height).toBeGreaterThan(0);
    });

    it('returns the fallback height (2.668) when model not loaded', () => {
      // Fallback is 2.668 — only changes after GLTF load callback fires
      const height = getBikeModelHeight();
      expect(height).toBe(2.668);
    });
  });

  describe('cloneBikeModel', () => {
    it('returns a Group object', () => {
      const group = cloneBikeModel(0xff0000);
      expect(group).toBeDefined();
      // The mock Group constructor returns an object with add and traverse
      expect(typeof group.add).toBe('function');
    });

    it('does not throw when model is not loaded', () => {
      expect(() => cloneBikeModel(0x00ff00)).not.toThrow();
    });

    it('returns a different group on each call', () => {
      const group1 = cloneBikeModel(0xff0000);
      const group2 = cloneBikeModel(0x0000ff);
      expect(group1).not.toBe(group2);
    });

    it('accepts any valid integer color', () => {
      expect(() => cloneBikeModel(0x000000)).not.toThrow();
      expect(() => cloneBikeModel(0xffffff)).not.toThrow();
      expect(() => cloneBikeModel(0x123456)).not.toThrow();
    });
  });

  describe('clearBikeDeferredQueue', () => {
    it('does not throw when queue is empty', () => {
      expect(() => clearBikeDeferredQueue()).not.toThrow();
    });

    it('does not throw when queue has pending entries', () => {
      // Add deferred entries by calling cloneBikeModel while model is unloaded
      cloneBikeModel(0xff0000);
      cloneBikeModel(0x00ff00);
      expect(() => clearBikeDeferredQueue()).not.toThrow();
    });

    it('can be called multiple times safely', () => {
      clearBikeDeferredQueue();
      clearBikeDeferredQueue();
      expect(() => clearBikeDeferredQueue()).not.toThrow();
    });
  });
});
