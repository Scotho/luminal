import type { ShakeImpulse, CameraRigState } from './types';
import { getSHAKE_ENABLED } from './cameraConfig';

// ── Band-limited value noise ────────────────────────────────
// Simple hash-based noise with linear interpolation between grid points.
// Cheaper than Perlin, sufficient for camera shake.

function hash(n: number): number {
  let x = Math.sin(n) * 43758.5453;
  x = x - Math.floor(x);
  return x * 2 - 1; // [-1, 1]
}

function valueNoise(t: number): number {
  const i = Math.floor(t);
  const f = t - i;
  return hash(i) * (1 - f) + hash(i + 1) * f;
}

// ── Shake presets ───────────────────────────────────────────
const PRESETS: Record<string, Omit<ShakeImpulse, 'elapsed'>> = {
  boost: { amplitude: 0.08, frequency: 18, duration: 0.25 },
  collision: { amplitude: 0.15, frequency: 14, duration: 0.35 },
  grind: { amplitude: 0.04, frequency: 24, duration: 0.15 },
  dashBurst: { amplitude: 0.06, frequency: 20, duration: 0.18 },
  landing: { amplitude: 0.10, frequency: 10, duration: 0.30 },
  death: { amplitude: 0.20, frequency: 8, duration: 0.50 },
};

// ── Public API ──────────────────────────────────────────────

/** Fire a shake impulse. No-op if shake is disabled. */
export type ShakeType = 'boost' | 'collision' | 'grind' | 'dashBurst' | 'landing' | 'death';

export function triggerShake(type: ShakeType, cs?: CameraRigState): void {
  if (!cs) return;
  if (!getSHAKE_ENABLED()) return;
  const preset = PRESETS[type];
  cs.activeImpulses.push({
    amplitude: preset.amplitude,
    frequency: preset.frequency,
    duration: preset.duration,
    elapsed: 0,
  });
}

/**
 * Advance all active impulses and compute combined shake offset.
 * Writes to cs.shakeOffset (X/Y only, no Z-axis forward/back).
 * Call once per frame before applying offset to camera.
 */
export function updateShake(dt: number, cs: CameraRigState): void {
  cs.shakeOffset.set(0, 0, 0);

  if (!getSHAKE_ENABLED() || cs.activeImpulses.length === 0) return;

  let totalX = 0;
  let totalY = 0;

  for (let i = cs.activeImpulses.length - 1; i >= 0; i--) {
    const imp = cs.activeImpulses[i];
    imp.elapsed += dt;

    if (imp.elapsed >= imp.duration) {
      cs.activeImpulses.splice(i, 1);
      continue;
    }

    // Linear fade-out envelope
    const fade = 1 - imp.elapsed / imp.duration;
    const t = imp.elapsed * imp.frequency;
    const amp = imp.amplitude * fade;

    // Two independent noise channels for X and Y (offset seeds to decorrelate)
    totalX += valueNoise(t) * amp;
    totalY += valueNoise(t + 100) * amp;
  }

  cs.shakeOffset.x = totalX;
  cs.shakeOffset.y = totalY;
}
