// ── Color Fallback Tests ────────────────────────────────
import { describe, it, expect } from 'vitest';
import { resolveColor } from '../../colorFallback';
import { PLAYER_COLOR_KEYS } from '../../playerColors';

describe('resolveColor', () => {
  it('returns desired color when not taken', () => {
    expect(resolveColor('red', new Set(['cyan', 'blue']))).toBe('red');
  });

  it('returns desired color when taken set is empty', () => {
    expect(resolveColor('magenta', new Set())).toBe('magenta');
  });

  it('returns next available color when desired is taken', () => {
    // red is at index 0, next is orange (index 1)
    expect(resolveColor('red', new Set(['red']))).toBe('orange');
  });

  it('skips multiple taken colors in sequence', () => {
    // red(0) taken -> orange(1) taken -> magenta(2)
    expect(resolveColor('red', new Set(['red', 'orange']))).toBe('magenta');
  });

  it('wraps around the color list', () => {
    // white is last (index 9), wraps to red (index 0)
    expect(resolveColor('white', new Set(['white']))).toBe('red');
  });

  it('wraps around skipping taken colors at the start', () => {
    // white(9) -> red(0) taken -> orange(1)
    expect(resolveColor('white', new Set(['white', 'red']))).toBe('orange');
  });

  it('is deterministic — same inputs produce same output', () => {
    const taken = new Set(['red', 'cyan', 'magenta']);
    const a = resolveColor('red', taken);
    const b = resolveColor('red', taken);
    expect(a).toBe(b);
  });

  it('returns desired when all colors are taken', () => {
    const allTaken = new Set(PLAYER_COLOR_KEYS);
    expect(resolveColor('red', allTaken)).toBe('red');
  });

  it('works with an iterable (array) instead of Set', () => {
    // red(0) taken -> orange(1) taken -> magenta(2)
    expect(resolveColor('red', ['red', 'orange'])).toBe('magenta');
  });

  it('handles unknown desired color gracefully', () => {
    // indexOf returns -1, so (−1 + 1) % len = 0 → red
    const result = resolveColor('unknown', new Set(['unknown']));
    expect(PLAYER_COLOR_KEYS).toContain(result);
  });
});
