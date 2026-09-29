// ── Deterministic Color Fallback ─────────────────────────
// Resolves a desired player color against a set of taken colors.
// Used by lobby join/create, spectator promotion, and rejoin flows
// to prevent duplicate colors.

import { PLAYER_COLOR_KEYS } from './playerColors';

/**
 * Return `desired` if available, otherwise the next available color
 * in canonical PLAYER_COLOR_KEYS order (wrapping around).
 * Deterministic: same inputs always produce the same output.
 */
export function resolveColor(desired: string, taken: Iterable<string>): string {
  const takenSet = taken instanceof Set ? taken : new Set(taken);
  if (!takenSet.has(desired)) return desired;

  const startIdx = PLAYER_COLOR_KEYS.indexOf(desired);
  const len = PLAYER_COLOR_KEYS.length;
  for (let i = 1; i < len; i++) {
    const candidate = PLAYER_COLOR_KEYS[(startIdx + i) % len];
    if (!takenSet.has(candidate)) return candidate;
  }
  // All colors taken (shouldn't happen with max 4 players + AIs)
  return desired;
}
