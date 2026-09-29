import { describe, expect, it } from 'vitest';
import { DEFAULT_PLAYER_COLOR_KEY, PLAYER_COLORS, PLAYER_COLOR_KEYS, PLAYER_COLOR_MAP, getPlayerColor, getPlayerColorCss } from './playerColors';

describe('playerColors registry', () => {
  it('has unique keys with css/color/emissive values', () => {
    const keys = PLAYER_COLORS.map(({ key }) => key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(PLAYER_COLOR_KEYS);

    for (const color of PLAYER_COLORS) {
      expect(color.css).toMatch(/^#[0-9a-f]{6}$/i);
      expect(color.color).toBeGreaterThan(0);
      expect(color.emissive).toBeGreaterThan(0);
      expect(PLAYER_COLOR_MAP[color.key]).toEqual({
        color: color.color,
        emissive: color.emissive,
      });
    }
  });

  it('returns the default palette entry for unknown keys', () => {
    expect(getPlayerColor('missing')).toEqual(getPlayerColor(DEFAULT_PLAYER_COLOR_KEY));
    expect(getPlayerColorCss('missing')).toBe(getPlayerColorCss(DEFAULT_PLAYER_COLOR_KEY));
  });
});

describe('player color registry consistency', () => {
  it('default key exists in the registry', () => {
    expect(PLAYER_COLOR_MAP[DEFAULT_PLAYER_COLOR_KEY]).toBeTruthy();
  });

  it('PLAYER_COLOR_KEYS matches PLAYER_COLORS order', () => {
    expect(PLAYER_COLOR_KEYS).toEqual(PLAYER_COLORS.map(c => c.key));
  });
});
