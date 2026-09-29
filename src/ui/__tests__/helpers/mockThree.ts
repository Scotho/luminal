// ── Three.js Mocks ─────────────────────────────────────
// vi.mock calls for Three.js and the scene module.
// Import this file in test files that need Three.js mocked.

import { vi } from 'vitest';

export function setupThreeMocks(): void {
  vi.mock('three', () => {
    const Vector3 = vi.fn(() => ({
      set: vi.fn().mockReturnThis(),
      copy: vi.fn().mockReturnThis(),
      clone: vi.fn().mockReturnThis(),
      add: vi.fn().mockReturnThis(),
      sub: vi.fn().mockReturnThis(),
      multiplyScalar: vi.fn().mockReturnThis(),
      normalize: vi.fn().mockReturnThis(),
      length: vi.fn(() => 0),
      distanceTo: vi.fn(() => 0),
      x: 0, y: 0, z: 0,
    }));
    return {
      Scene: vi.fn(() => ({ add: vi.fn(), remove: vi.fn(), children: [] })),
      PerspectiveCamera: vi.fn(() => ({
        position: { set: vi.fn(), copy: vi.fn(), x: 0, y: 0, z: 0 },
        lookAt: vi.fn(),
        updateProjectionMatrix: vi.fn(),
        fov: 95,
        aspect: 1,
        near: 0.1,
        far: 1000,
      })),
      WebGLRenderer: vi.fn(() => ({
        setSize: vi.fn(),
        setPixelRatio: vi.fn(),
        render: vi.fn(),
        dispose: vi.fn(),
        domElement: document.createElement('canvas'),
        getPixelRatio: vi.fn(() => 1),
      })),
      Vector3,
      Vector2: vi.fn(() => ({ x: 0, y: 0, set: vi.fn() })),
      Color: vi.fn(() => ({ set: vi.fn(), setHex: vi.fn(), r: 0, g: 0, b: 0 })),
      Mesh: vi.fn(() => ({ position: { set: vi.fn() }, visible: true })),
      Group: vi.fn(() => ({ add: vi.fn(), remove: vi.fn(), children: [] })),
      BoxGeometry: vi.fn(),
      PlaneGeometry: vi.fn(),
      MeshBasicMaterial: vi.fn(),
      MeshStandardMaterial: vi.fn(),
      AmbientLight: vi.fn(() => ({ intensity: 1 })),
      DirectionalLight: vi.fn(() => ({ position: { set: vi.fn() }, intensity: 1 })),
      PointLight: vi.fn(() => ({ position: { set: vi.fn() }, intensity: 1 })),
      SpotLight: vi.fn(() => ({ position: { set: vi.fn() }, target: { position: { set: vi.fn() } }, intensity: 1 })),
      Clock: vi.fn(() => ({ getDelta: vi.fn(() => 0.016), getElapsedTime: vi.fn(() => 0) })),
      Raycaster: vi.fn(() => ({ setFromCamera: vi.fn(), intersectObjects: vi.fn(() => []) })),
    };
  });

  vi.mock('../../scene', () => ({
    createScene: vi.fn(() => ({
      scene: { add: vi.fn(), remove: vi.fn() },
      camera: { position: { set: vi.fn() }, lookAt: vi.fn(), fov: 95, updateProjectionMatrix: vi.fn() },
      renderer: { setSize: vi.fn(), render: vi.fn(), domElement: document.createElement('canvas'), getPixelRatio: vi.fn(() => 1) },
      composer: { render: vi.fn(), setSize: vi.fn() },
      bloomPass: { strength: 0.5, radius: 0.4, threshold: 0.85 },
    })),
    setCameraFOV: vi.fn(),
    setCameraDist: vi.fn(),
  }));
}
