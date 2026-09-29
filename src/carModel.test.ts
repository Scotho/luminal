import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock CanvasTexture with a dispose spy
const mockDispose = vi.fn();
vi.mock('three', () => ({
  CanvasTexture: vi.fn().mockImplementation(() => ({
    dispose: mockDispose,
    flipY: true,
    colorSpace: '',
    uuid: 'mock-uuid',
  })),
  Color: vi.fn().mockImplementation((hex?: number) => ({
    r: hex ? ((hex >> 16 & 0xff) / 255) : 0,
    g: hex ? ((hex >> 8 & 0xff) / 255) : 0,
    b: hex ? ((hex & 0xff) / 255) : 0,
    getHexString: vi.fn().mockReturnValue('ff0000'),
  })),
  Group: vi.fn().mockImplementation(() => ({
    add: vi.fn(),
    traverse: vi.fn(),
    rotation: { y: 0 },
  })),
  Mesh: vi.fn(),
  MeshStandardMaterial: vi.fn(),
  Texture: vi.fn(),
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

vi.mock('./emissiveUtils', () => ({
  computeEmissiveColor: vi.fn().mockReturnValue({
    r: 1, g: 0, b: 0,
    getHexString: vi.fn().mockReturnValue('ff0000'),
  }),
  computeDarkBoost: vi.fn().mockReturnValue({ lum: 0.5, darkBoost: 0 }),
}));

import { clearEmissiveMapCache, getEmissiveMapCacheSize } from './carModel';

describe('carModel emissive cache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Ensure cache starts empty before each test
    clearEmissiveMapCache();
  });

  it('getEmissiveMapCacheSize returns 0 on fresh start', () => {
    expect(getEmissiveMapCacheSize()).toBe(0);
  });

  it('clearEmissiveMapCache leaves cache empty', () => {
    clearEmissiveMapCache();
    expect(getEmissiveMapCacheSize()).toBe(0);
  });

  it('clearEmissiveMapCache does not throw when cache is already empty', () => {
    expect(() => clearEmissiveMapCache()).not.toThrow();
  });
});
