import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock canvas/context since jsdom doesn't provide real Canvas2D
const mockImageData = { data: new Uint8ClampedArray(64 * 64 * 4) };
const mockCtx = {
  createRadialGradient: vi.fn(() => ({
    addColorStop: vi.fn(),
  })),
  createImageData: vi.fn(() => mockImageData),
  putImageData: vi.fn(),
  fillStyle: '',
  fillRect: vi.fn(),
  arc: vi.fn(),
  fill: vi.fn(),
  beginPath: vi.fn(),
};
const mockCanvas = {
  width: 0,
  height: 0,
  getContext: vi.fn(() => mockCtx),
};
vi.stubGlobal('document', {
  createElement: vi.fn((tag: string) => {
    if (tag === 'canvas') return mockCanvas;
    return {};
  }),
});

import { createStarTexture, starSize, starColor, blackbodyToRGB, starTemperature, createStarMaterial } from '../starfield';
import * as THREE from 'three';

describe('createStarTexture', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a THREE.CanvasTexture', () => {
    const tex = createStarTexture();
    expect(tex).toBeInstanceOf(THREE.CanvasTexture);
  });

  it('creates a 64x64 canvas by default', () => {
    createStarTexture();
    expect(mockCanvas.width).toBe(64);
    expect(mockCanvas.height).toBe(64);
  });

  it('uses per-pixel ImageData for the glow', () => {
    createStarTexture();
    expect(mockCtx.createImageData).toHaveBeenCalledOnce();
    expect(mockCtx.putImageData).toHaveBeenCalledOnce();
  });
});

describe('starSize', () => {
  it('returns values in [0.3, 4.0] range', () => {
    for (let i = 0; i < 500; i++) {
      const s = starSize();
      expect(s).toBeGreaterThanOrEqual(0.3);
      expect(s).toBeLessThanOrEqual(4.0);
    }
  });

  it('produces mostly small stars (median below 1.3)', () => {
    const sizes: number[] = [];
    for (let i = 0; i < 2000; i++) sizes.push(starSize());
    sizes.sort((a, b) => a - b);
    const median = sizes[1000];
    expect(median).toBeLessThan(1.3);
  });
});

describe('blackbodyToRGB', () => {
  it('returns [r, g, b] tuple with values in [0, 1]', () => {
    for (const temp of [2000, 3500, 5800, 8000, 15000, 30000]) {
      const [r, g, b] = blackbodyToRGB(temp);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(1);
      expect(g).toBeGreaterThanOrEqual(0);
      expect(g).toBeLessThanOrEqual(1);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(1);
    }
  });

  it('cool stars (3000K) are reddish (r > b)', () => {
    const [r, , b] = blackbodyToRGB(3000);
    expect(r).toBeGreaterThan(b);
  });

  it('hot stars (15000K) are bluish (b >= r)', () => {
    const [r, , b] = blackbodyToRGB(15000);
    expect(b).toBeGreaterThanOrEqual(r);
  });

  it('clamps to valid range for extreme inputs', () => {
    const [r1, g1, b1] = blackbodyToRGB(100);
    expect(r1).toBeGreaterThanOrEqual(0);
    const [r2, g2, b2] = blackbodyToRGB(100000);
    expect(r2).toBeGreaterThanOrEqual(0);
    expect([r1, g1, b1, r2, g2, b2].every(v => v >= 0 && v <= 1)).toBe(true);
  });
});

describe('starTemperature', () => {
  it('returns temperatures in valid range or accent sentinels', () => {
    for (let i = 0; i < 500; i++) {
      const temp = starTemperature(1.0);
      expect(temp === -1 || temp === -2 || (temp >= 3000 && temp <= 15000)).toBe(true);
    }
  });

  it('produces ~5% accent sentinels', () => {
    let accentCount = 0;
    const N = 5000;
    for (let i = 0; i < N; i++) {
      const temp = starTemperature(1.0);
      if (temp < 0) accentCount++;
    }
    const rate = accentCount / N;
    expect(rate).toBeGreaterThan(0.02);
    expect(rate).toBeLessThan(0.10);
  });
});

describe('starColor', () => {
  it('returns [r, g, b] tuple with values in [0, 1]', () => {
    for (let i = 0; i < 200; i++) {
      const [r, g, b] = starColor(Math.random());
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(1);
      expect(g).toBeGreaterThanOrEqual(0);
      expect(g).toBeLessThanOrEqual(1);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(1);
    }
  });
});

describe('createStarMaterial', () => {
  it('returns a THREE.ShaderMaterial with expected uniforms', () => {
    const tex = new THREE.CanvasTexture(mockCanvas as unknown as HTMLCanvasElement);
    const mat = createStarMaterial(tex, 2);
    expect(mat).toBeInstanceOf(THREE.ShaderMaterial);
    expect(mat.uniforms.uTime.value).toBe(0);
    expect(mat.uniforms.uPixelRatio.value).toBe(2);
    expect(mat.uniforms.uStarTexture.value).toBe(tex);
    expect(mat.vertexColors).toBe(true);
    expect(mat.transparent).toBe(true);
    expect(mat.depthWrite).toBe(false);
    expect(mat.blending).toBe(THREE.AdditiveBlending);
  });
});
