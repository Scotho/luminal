import type { Keyframe } from './types/index';

/** Linearly interpolate a value from a sorted Keyframe[] curve. */
export function interpolateKeyframes(curve: Keyframe[], at: number): number {
  if (curve.length === 0) return 0;
  if (curve.length === 1) return curve[0].value;
  if (at <= curve[0].at) return curve[0].value;
  if (at >= curve[curve.length - 1].at) return curve[curve.length - 1].value;

  for (let i = 1; i < curve.length; i++) {
    if (at <= curve[i].at) {
      const prev = curve[i - 1];
      const next = curve[i];
      const t = (at - prev.at) / (next.at - prev.at);
      return prev.value + t * (next.value - prev.value);
    }
  }

  return curve[curve.length - 1].value;
}

export function smoothValue(current: number, target: number, smoothing: number): number {
  return current + (target - current) * smoothing;
}
