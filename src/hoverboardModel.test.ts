import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Track GLTFLoader.load calls so we can trigger them in tests ──
let capturedLoadCallback: ((gltf: any) => void) | null = null;

vi.mock('three/addons/loaders/GLTFLoader.js', () => ({
  GLTFLoader: vi.fn().mockImplementation(function () {
    return {
      setDRACOLoader: vi.fn().mockReturnThis(),
      load: vi.fn((_url: string, onLoad: (gltf: any) => void) => {
        capturedLoadCallback = onLoad;
      }),
    };
  }),
}));

vi.mock('three/addons/loaders/DRACOLoader.js', () => ({
  DRACOLoader: vi.fn().mockImplementation(function () {
    return { setDecoderPath: vi.fn().mockReturnThis() };
  }),
}));

vi.mock('three/addons/utils/SkeletonUtils.js', () => ({
  clone: vi.fn((scene: any) => scene.clone(true)),
}));

vi.mock('./graphics', () => ({
  getGfx: vi.fn().mockReturnValue({ preset: 'high' }),
  VISUAL_TUNING: { high: { neonEmissive: 1.5 } },
}));

import * as THREE from 'three';
import {
  isHoverboardModelLoaded,
  getHoverboardModelHeight,
  cloneHoverboardModel,
  clearHoverboardDeferredQueue,
  loadHoverboardModel,
} from './hoverboardModel';

// ── Helper: build a realistic mock GLTF scene ──
function buildMockGLTFScene() {
  // Create real Three.js objects so clone(true) works properly
  const scene = new THREE.Group();
  scene.name = 'Scene';

  // Board meshes
  const boardBodyGeo = new THREE.BoxGeometry(1, 0.1, 2);
  const boardBodyMat = new THREE.MeshStandardMaterial({ name: 'M_HoverB_Body' });
  boardBodyMat.name = 'M_HoverB_Body';
  const boardBody = new THREE.Mesh(boardBodyGeo, boardBodyMat);
  boardBody.name = 'BoardBody';

  const boardPlatesGeo = new THREE.BoxGeometry(0.8, 0.05, 1.8);
  const boardPlatesMat = new THREE.MeshStandardMaterial({ name: 'M_HoverB_Plates' });
  boardPlatesMat.name = 'M_HoverB_Plates';
  const boardPlates = new THREE.Mesh(boardPlatesGeo, boardPlatesMat);
  boardPlates.name = 'BoardPlates';

  const boardLightsGeo = new THREE.BoxGeometry(0.1, 0.1, 0.5);
  const boardLightsMat = new THREE.MeshStandardMaterial({ name: 'M_HoverB_Lights' });
  boardLightsMat.name = 'M_HoverB_Lights';
  const boardLights = new THREE.Mesh(boardLightsGeo, boardLightsMat);
  boardLights.name = 'BoardLights';

  // Rider mesh
  const riderGeo = new THREE.BoxGeometry(0.4, 1.2, 0.3);
  const riderMat = new THREE.MeshStandardMaterial({ name: 'M_HoverB_Mid' });
  riderMat.name = 'M_HoverB_Mid';
  const rider = new THREE.Mesh(riderGeo, riderMat);
  rider.name = 'Rider';
  rider.position.y = 0.7;

  scene.add(boardBody, boardPlates, boardLights, rider);

  return {
    scene,
    scenes: [scene],
    animations: [],
    cameras: [],
    asset: {},
    parser: null,
    userData: {},
  };
}

describe('hoverboardModel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedLoadCallback = null;
    clearHoverboardDeferredQueue();
  });

  describe('isHoverboardModelLoaded', () => {
    it('returns a boolean', () => {
      expect(typeof isHoverboardModelLoaded()).toBe('boolean');
    });
  });

  describe('getHoverboardModelHeight', () => {
    it('returns a positive number', () => {
      const height = getHoverboardModelHeight();
      expect(typeof height).toBe('number');
      expect(height).toBeGreaterThan(0);
    });
  });

  describe('cloneHoverboardModel', () => {
    it('returns a Group object', () => {
      const group = cloneHoverboardModel(0xff0000);
      expect(group).toBeDefined();
      expect(typeof group.add).toBe('function');
    });

    it('does not throw when model is not loaded', () => {
      expect(() => cloneHoverboardModel(0x00ff00)).not.toThrow();
    });

    it('returns a different group on each call', () => {
      const group1 = cloneHoverboardModel(0xff0000);
      const group2 = cloneHoverboardModel(0x0000ff);
      expect(group1).not.toBe(group2);
    });

    it('accepts any valid integer color', () => {
      expect(() => cloneHoverboardModel(0x000000)).not.toThrow();
      expect(() => cloneHoverboardModel(0xffffff)).not.toThrow();
      expect(() => cloneHoverboardModel(0xabcdef)).not.toThrow();
    });
  });

  describe('clearHoverboardDeferredQueue', () => {
    it('does not throw when queue is empty', () => {
      expect(() => clearHoverboardDeferredQueue()).not.toThrow();
    });

    it('does not throw when queue has pending entries', () => {
      cloneHoverboardModel(0xff0000);
      cloneHoverboardModel(0x00ff00);
      expect(() => clearHoverboardDeferredQueue()).not.toThrow();
    });

    it('can be called multiple times safely', () => {
      clearHoverboardDeferredQueue();
      clearHoverboardDeferredQueue();
      expect(() => clearHoverboardDeferredQueue()).not.toThrow();
    });
  });

  describe('mesh separation (loaded model)', () => {
    function triggerLoad() {
      loadHoverboardModel();
      if (capturedLoadCallback) {
        capturedLoadCallback(buildMockGLTFScene());
      }
    }

    it('sets isHoverboardModelLoaded to true after load', () => {
      triggerLoad();
      expect(isHoverboardModelLoaded()).toBe(true);
    });

    it('creates boardProxy and riderProxy on cloned group userData', () => {
      triggerLoad();
      const group = cloneHoverboardModel(0x00ffd5);
      expect(group.userData.boardProxy).toBeDefined();
      expect(group.userData.riderProxy).toBeDefined();
    });

    it('boardProxy is named "boardProxy"', () => {
      triggerLoad();
      const group = cloneHoverboardModel(0x00ffd5);
      expect(group.userData.boardProxy.name).toBe('boardProxy');
    });

    it('riderProxy is named "riderProxy"', () => {
      triggerLoad();
      const group = cloneHoverboardModel(0x00ffd5);
      expect(group.userData.riderProxy.name).toBe('riderProxy');
    });

    it('boardProxy and riderProxy are THREE.Group instances', () => {
      triggerLoad();
      const group = cloneHoverboardModel(0x00ffd5);
      expect(group.userData.boardProxy).toBeInstanceOf(THREE.Group);
      expect(group.userData.riderProxy).toBeInstanceOf(THREE.Group);
    });
  });
});
