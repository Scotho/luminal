export type StreakColorMode = 'teal' | 'mask';

export interface DrawStreakFieldOptions {
  width: number;
  height: number;
  colorMode: StreakColorMode;
}

/** Number of horizontal streaks drawn in the streak field. Exported so
 *  tests and consumers can reference the canonical value without
 *  hard-coding it. */
export const STREAK_COUNT = 30;

/** Number of radial glint points drawn in the streak field. */
export const GLINT_COUNT = 12;

/**
 * Shared shooting-star streak field drawer. Used by arena linework
 * textures in either teal or neutral mask mode.
 *
 * Note: Math.random() is intentionally unseeded — each call produces a
 * different pattern. Tests check statistical properties, not byte equality.
 */
export function drawStreakField(
  ctx: CanvasRenderingContext2D,
  opts: DrawStreakFieldOptions,
): void {
  const { width, height, colorMode } = opts;

  ctx.clearRect(0, 0, width, height);

  // Vertical base gradient: dim at top, brighter in upper portion, dark at bottom
  const vGrad = ctx.createLinearGradient(0, height, 0, 0);
  if (colorMode === 'teal') {
    vGrad.addColorStop(0, 'rgba(73, 162, 178, 0.12)');
    vGrad.addColorStop(0.15, 'rgba(45, 100, 105, 0.04)');
    vGrad.addColorStop(0.5, 'rgba(24, 77, 81, 0.01)');
    vGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  } else {
    vGrad.addColorStop(0, 'rgba(180, 180, 180, 0.12)');
    vGrad.addColorStop(0.15, 'rgba(120, 120, 120, 0.04)');
    vGrad.addColorStop(0.5, 'rgba(80, 80, 80, 0.01)');
    vGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  }
  ctx.fillStyle = vGrad;
  ctx.fillRect(0, 0, width, height);

  // 30 horizontal streaks
  for (let i = 0; i < STREAK_COUNT; i++) {
    const y = 10 + Math.random() * (height - 20);
    const headX = (width * 0.1) + Math.random() * (width * 0.8);
    const tailLen = 60 + Math.random() * 200;
    const thickness = 0.5 + Math.random() * 1.5;
    const bright = Math.random() < 0.3;

    const streakGrad = ctx.createLinearGradient(headX, y, headX - tailLen, y);
    if (colorMode === 'teal') {
      if (bright) {
        streakGrad.addColorStop(0, `rgba(255, 255, 255, ${0.25 + Math.random() * 0.15})`);
        streakGrad.addColorStop(0.1, `rgba(73, 162, 178, ${0.15 + Math.random() * 0.1})`);
        streakGrad.addColorStop(0.5, `rgba(45, 100, 105, 0.04)`);
        streakGrad.addColorStop(1, 'rgba(11, 54, 61, 0)');
      } else {
        streakGrad.addColorStop(0, `rgba(73, 162, 178, ${0.10 + Math.random() * 0.08})`);
        streakGrad.addColorStop(0.3, `rgba(45, 100, 105, 0.03)`);
        streakGrad.addColorStop(1, 'rgba(11, 54, 61, 0)');
      }
    } else {
      if (bright) {
        const a = 0.25 + Math.random() * 0.15;
        streakGrad.addColorStop(0, `rgba(255, 255, 255, ${a})`);
        streakGrad.addColorStop(0.1, `rgba(200, 200, 200, ${0.15 + Math.random() * 0.1})`);
        streakGrad.addColorStop(0.5, `rgba(100, 100, 100, 0.04)`);
        streakGrad.addColorStop(1, 'rgba(30, 30, 30, 0)');
      } else {
        const a = 0.10 + Math.random() * 0.08;
        streakGrad.addColorStop(0, `rgba(200, 200, 200, ${a})`);
        streakGrad.addColorStop(0.3, `rgba(100, 100, 100, 0.03)`);
        streakGrad.addColorStop(1, 'rgba(30, 30, 30, 0)');
      }
    }
    ctx.fillStyle = streakGrad;
    ctx.fillRect(headX - tailLen, y - thickness / 2, tailLen, thickness);
  }

  // 12 glint points
  for (let i = 0; i < GLINT_COUNT; i++) {
    const x = (width * 0.15) + Math.random() * (width * 0.75);
    const y = 10 + Math.random() * (height - 20);
    const r = 1 + Math.random() * 2;
    const grd = ctx.createRadialGradient(x, y, 0, x, y, r);
    if (colorMode === 'teal') {
      grd.addColorStop(0, `rgba(255, 255, 255, ${0.3 + Math.random() * 0.2})`);
      grd.addColorStop(0.5, `rgba(73, 162, 178, 0.08)`);
      grd.addColorStop(1, 'rgba(24, 77, 81, 0)');
    } else {
      grd.addColorStop(0, `rgba(255, 255, 255, ${0.3 + Math.random() * 0.2})`);
      grd.addColorStop(0.5, `rgba(180, 180, 180, 0.08)`);
      grd.addColorStop(1, 'rgba(80, 80, 80, 0)');
    }
    ctx.fillStyle = grd;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
}
