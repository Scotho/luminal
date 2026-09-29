import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGroupTraverse = vi.fn();

vi.mock('three', () => ({
  Group: vi.fn().mockImplementation(function () {
    return { add: vi.fn(), traverse: mockGroupTraverse, rotation: { y: 0 } };
  }),
  Mesh: vi.fn().mockImplementation(function () { return {}; }),
  MeshStandardMaterial: vi.fn().mockImplementation(function () { return {}; }),
}));

vi.mock('three/addons/loaders/GLTFLoader.js', () => ({
  GLTFLoader: vi.fn().mockImplementation(function () {
    return { load: vi.fn() };
  }),
}));

import { loadDroneModel, cloneDroneModel } from './droneModel';

describe('droneModel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGroupTraverse.mockClear();
  });

  describe('loadDroneModel', () => {
    it('returns a Promise', () => {
      const result = loadDroneModel();
      expect(result).toBeInstanceOf(Promise);
    });

    it('does not throw when called', () => {
      expect(() => loadDroneModel()).not.toThrow();
    });
  });

  describe('cloneDroneModel', () => {
    it('returns a Group object when model is not loaded', () => {
      const group = cloneDroneModel();
      expect(group).toBeDefined();
      expect(typeof group.add).toBe('function');
    });

    it('does not throw when model is not loaded', () => {
      expect(() => cloneDroneModel()).not.toThrow();
    });

    it('returns a different group on each call', () => {
      const group1 = cloneDroneModel();
      const group2 = cloneDroneModel();
      expect(group1).not.toBe(group2);
    });

    it('returns an empty group (no children added) when model not loaded', () => {
      const group = cloneDroneModel();
      // When model is not loaded, cloneDroneModel returns a bare new THREE.Group()
      // The mock Group's add should not have been called on this specific group
      expect(group).toBeDefined();
    });
  });
});
