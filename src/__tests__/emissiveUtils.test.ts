// ── emissiveUtils tests ──────────────────────────────────
import { describe, it, expect, vi } from 'vitest';

vi.mock('three', () => ({
  Color: class {
    r = 0; g = 0; b = 0;
    private _h = 0;
    private _s = 0;
    private _l = 0;
    constructor(c?: number) {
      if (c !== undefined) {
        this.r = ((c >> 16) & 0xff) / 255;
        this.g = ((c >> 8) & 0xff) / 255;
        this.b = (c & 0xff) / 255;
        // Simple RGB to HSL conversion for testing
        const max = Math.max(this.r, this.g, this.b);
        const min = Math.min(this.r, this.g, this.b);
        this._l = (max + min) / 2;
        this._s =
          max === min
            ? 0
            : (max - min) / (this._l > 0.5 ? 2 - max - min : max + min);
        if (max === min) this._h = 0;
        else if (max === this.r)
          this._h = (((this.g - this.b) / (max - min) + 6) % 6) / 6;
        else if (max === this.g)
          this._h = ((this.b - this.r) / (max - min) + 2) / 6;
        else this._h = ((this.r - this.g) / (max - min) + 4) / 6;
      }
    }
    getHSL(target: { h: number; s: number; l: number }) {
      target.h = this._h;
      target.s = this._s;
      target.l = this._l;
      return target;
    }
    setHSL(h: number, s: number, l: number) {
      this._h = h;
      this._s = s;
      this._l = l;
      return this;
    }
  },
}));

import { computeEmissiveColor, computeDarkBoost, computeVehicleVisibilityBoost } from '../emissiveUtils';
import { Color } from 'three';

describe('computeEmissiveColor', () => {
  it('returns a THREE.Color instance', () => {
    const result = computeEmissiveColor(0xff0000);
    expect(result).toBeInstanceOf(Color);
  });

  it('boosts saturation for non-fully-saturated colors', () => {
    // 0x8080ff is a desaturated blue — saturation should increase
    const inputHsl = { h: 0, s: 0, l: 0 };
    const inputColor = new Color(0x8080ff);
    inputColor.getHSL(inputHsl);

    const result = computeEmissiveColor(0x8080ff);
    const outputHsl = { h: 0, s: 0, l: 0 };
    result.getHSL(outputHsl);

    expect(outputHsl.s).toBeGreaterThanOrEqual(inputHsl.s);
  });

  it('caps lightness at 0.85', () => {
    // Pure white has lightness = 1.0; after 1.3x boost it would be 1.3 but should cap at 0.85
    const result = computeEmissiveColor(0xffffff);
    const hsl = { h: 0, s: 0, l: 0 };
    result.getHSL(hsl);
    expect(hsl.l).toBeLessThanOrEqual(0.85);
  });

  it('boosts lightness for dark colors', () => {
    // Dark red — lightness should increase by 1.3x factor
    const inputHsl = { h: 0, s: 0, l: 0 };
    const inputColor = new Color(0x330000);
    inputColor.getHSL(inputHsl);

    const result = computeEmissiveColor(0x330000);
    const outputHsl = { h: 0, s: 0, l: 0 };
    result.getHSL(outputHsl);

    // For dark colors, lightness is low so 1.3x stays under the 0.85 cap
    expect(outputHsl.l).toBeCloseTo(Math.min(inputHsl.l * 1.3, 0.85), 5);
  });

  it('caps saturation at 1.0', () => {
    // Fully saturated pure red: s=1.0, 1.0*1.2 = 1.2 should cap at 1.0
    const result = computeEmissiveColor(0xff0000);
    const hsl = { h: 0, s: 0, l: 0 };
    result.getHSL(hsl);
    expect(hsl.s).toBeLessThanOrEqual(1.0);
  });

  it('preserves hue through the transformation', () => {
    const inputHsl = { h: 0, s: 0, l: 0 };
    const inputColor = new Color(0x00ff00);
    inputColor.getHSL(inputHsl);

    const result = computeEmissiveColor(0x00ff00);
    const outputHsl = { h: 0, s: 0, l: 0 };
    result.getHSL(outputHsl);

    expect(outputHsl.h).toBeCloseTo(inputHsl.h, 5);
  });
});

describe('computeDarkBoost', () => {
  it('returns darkBoost near 0 for bright white', () => {
    const result = computeDarkBoost(0xffffff);
    expect(result.darkBoost).toBeCloseTo(0, 1);
  });

  it('returns darkBoost = 1 for pure black', () => {
    const result = computeDarkBoost(0x000000);
    expect(result.darkBoost).toBe(1);
  });

  it('returns an object with lum and darkBoost properties', () => {
    const result = computeDarkBoost(0x336699);
    expect(result).toHaveProperty('lum');
    expect(result).toHaveProperty('darkBoost');
    expect(typeof result.lum).toBe('number');
    expect(typeof result.darkBoost).toBe('number');
  });

  it('returns moderate darkBoost for mid-range color', () => {
    // Mid-gray 0x808080 has lightness ~0.5 → darkBoost = max(0, 1 - 0.5*2) = 0
    const result = computeDarkBoost(0x808080);
    expect(result.lum).toBeCloseTo(0.5, 1);
    expect(result.darkBoost).toBeCloseTo(0, 1);
  });

  it('returns positive darkBoost for dark colors', () => {
    // Dark blue 0x000044 has low lightness → darkBoost should be positive
    const result = computeDarkBoost(0x000044);
    expect(result.lum).toBeLessThan(0.5);
    expect(result.darkBoost).toBeGreaterThan(0);
  });

  it('darkBoost never goes below 0', () => {
    // Very bright color should clamp at 0
    const result = computeDarkBoost(0xffffcc);
    expect(result.darkBoost).toBeGreaterThanOrEqual(0);
  });
});

describe('computeVehicleVisibilityBoost', () => {
  it('returns baseline visibility for bright colors', () => {
    const result = computeVehicleVisibilityBoost(0xffffff);
    expect(result.visibilityBoost).toBeCloseTo(1, 5);
  });

  it('returns a stronger visibility boost for dark colors', () => {
    const result = computeVehicleVisibilityBoost(0x000044);
    expect(result.visibilityBoost).toBeGreaterThan(1);
  });

  it('scales dark colors more than mid-value colors', () => {
    const dark = computeVehicleVisibilityBoost(0x000044);
    const mid = computeVehicleVisibilityBoost(0x4488aa);
    expect(dark.visibilityBoost).toBeGreaterThan(mid.visibilityBoost);
  });
});
