// ── Haptic Feedback ──────────────────────────────────────
import { vibrateGamepad } from './gamepad';

/** Trigger haptic feedback on both mobile (navigator.vibrate) and gamepad (dual-rumble). */
export function vibrate(pattern: number | number[]): void {
  // Mobile vibration
  if (navigator.vibrate) navigator.vibrate(pattern);

  // Gamepad rumble — map the pattern to a single rumble pulse
  const durationMs = typeof pattern === 'number' ? pattern : pattern.reduce((a, b) => a + b, 0);
  if (durationMs > 0) {
    // Scale intensity by duration: short taps are light, longer pulses are heavier
    const intensity = Math.min(1, durationMs / 200);
    vibrateGamepad(durationMs, intensity * 0.6, intensity * 0.4);
  }
}

export const VIBE = {
  death: 200,
  boost: 50,
  dash: [30, 30, 80] as number[],
  countdown: 100,
  matchFound: [100, 50, 100, 50, 200] as number[],
} as const;
