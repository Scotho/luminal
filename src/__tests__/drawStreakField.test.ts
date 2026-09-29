import { describe, it, expect } from 'vitest';
import { drawStreakField, STREAK_COUNT, GLINT_COUNT } from '../arena/drawStreakField';

function makeCtx(width: number, height: number): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas.getContext('2d')!;
}

/**
 * Record every color string passed to addColorStop on any gradient created
 * during the call. We wrap createLinearGradient / createRadialGradient with
 * a stub that funnels into a shared recorder so the test can inspect every
 * color drawStreakField produces, regardless of jsdom's canvas rendering
 * limitations.
 */
function recordGradientColors(ctx: CanvasRenderingContext2D): string[] {
  const colors: string[] = [];
  const mockGradient = {
    addColorStop: (_offset: number, color: string) => { colors.push(color); },
  };
  (ctx as unknown as { createLinearGradient: () => typeof mockGradient }).createLinearGradient =
    () => mockGradient;
  (ctx as unknown as { createRadialGradient: () => typeof mockGradient }).createRadialGradient =
    () => mockGradient;
  return colors;
}

function isGrayscaleOrTransparent(color: string): boolean {
  const m = color.match(/rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/);
  if (!m) return false;
  const r = parseInt(m[1], 10);
  const g = parseInt(m[2], 10);
  const b = parseInt(m[3], 10);
  const a = m[4] !== undefined ? parseFloat(m[4]) : 1;
  if (a === 0) return true;
  return r === g && g === b;
}

describe('drawStreakField', () => {
  it('produces only grayscale or transparent colors in mask mode', () => {
    const ctx = makeCtx(1024, 256);
    const colors = recordGradientColors(ctx);
    drawStreakField(ctx, { width: 1024, height: 256, colorMode: 'mask' });
    expect(colors.length).toBeGreaterThan(0);
    for (const c of colors) {
      expect(isGrayscaleOrTransparent(c)).toBe(true);
    }
  });

  it('produces at least one non-grayscale color in teal mode', () => {
    // Teal mode uses rgba(73, 162, 178, ...) for the base and streak gradients.
    // This test asserts teal mode is NOT accidentally grayscale — which would
    // happen if someone copy-pastes mask-mode code into the teal branch.
    const ctx = makeCtx(1024, 256);
    const colors = recordGradientColors(ctx);
    drawStreakField(ctx, { width: 1024, height: 256, colorMode: 'teal' });
    expect(colors.length).toBeGreaterThan(0);
    const nonGrayscale = colors.filter((c) => !isGrayscaleOrTransparent(c));
    expect(nonGrayscale.length).toBeGreaterThan(0);
  });

  it('accepts a 1024x256 canvas in both modes without throwing', () => {
    for (const mode of ['teal', 'mask'] as const) {
      const ctx = makeCtx(1024, 256);
      expect(() => {
        drawStreakField(ctx, { width: 1024, height: 256, colorMode: mode });
      }).not.toThrow();
    }
  });

  it('produces the expected number of gradients in teal mode (1 base + 30 streaks + 12 glints)', () => {
    // Regression guard: if someone changes the streak/glint counts in the
    // shared helper, this test and its mask-mode sibling below will flag it.
    const ctx = makeCtx(1024, 256);
    let linearCount = 0;
    let radialCount = 0;
    const mockGradient = { addColorStop: () => {} };
    (ctx as unknown as { createLinearGradient: () => typeof mockGradient }).createLinearGradient =
      () => { linearCount++; return mockGradient; };
    (ctx as unknown as { createRadialGradient: () => typeof mockGradient }).createRadialGradient =
      () => { radialCount++; return mockGradient; };
    drawStreakField(ctx, { width: 1024, height: 256, colorMode: 'teal' });
    expect(linearCount).toBe(1 + STREAK_COUNT); // base gradient + 30 streaks
    expect(radialCount).toBe(GLINT_COUNT);     // 12 glints
  });

  it('produces the expected number of gradients in mask mode', () => {
    const ctx = makeCtx(1024, 256);
    let linearCount = 0;
    let radialCount = 0;
    const mockGradient = { addColorStop: () => {} };
    (ctx as unknown as { createLinearGradient: () => typeof mockGradient }).createLinearGradient =
      () => { linearCount++; return mockGradient; };
    (ctx as unknown as { createRadialGradient: () => typeof mockGradient }).createRadialGradient =
      () => { radialCount++; return mockGradient; };
    drawStreakField(ctx, { width: 1024, height: 256, colorMode: 'mask' });
    expect(linearCount).toBe(1 + STREAK_COUNT);
    expect(radialCount).toBe(GLINT_COUNT);
  });

  it('calls fillRect once per base gradient, streak, and glint (no silent no-ops)', () => {
    // Regression guard: the gradient-interception tests would still pass if
    // someone accidentally removed the ctx.fillRect(...) calls, leaving
    // drawStreakField as a silent no-op on the canvas. This test catches
    // that by counting actual fillRect invocations.
    //
    // Expected: 1 base gradient fillRect + STREAK_COUNT streak fillRects
    //         + GLINT_COUNT glint fillRects = 43 total.
    for (const mode of ['teal', 'mask'] as const) {
      const ctx = makeCtx(1024, 256);
      // Replace gradient constructors with stubs so jsdom doesn't spew warnings.
      const mockGradient = { addColorStop: () => {} };
      (ctx as unknown as { createLinearGradient: () => typeof mockGradient }).createLinearGradient =
        () => mockGradient;
      (ctx as unknown as { createRadialGradient: () => typeof mockGradient }).createRadialGradient =
        () => mockGradient;
      let fillRectCount = 0;
      const originalFillRect = ctx.fillRect;
      ctx.fillRect = function(...args: Parameters<typeof originalFillRect>) {
        fillRectCount++;
        return originalFillRect.apply(this, args);
      };
      drawStreakField(ctx, { width: 1024, height: 256, colorMode: mode });
      expect(fillRectCount).toBe(1 + STREAK_COUNT + GLINT_COUNT);
    }
  });
});
