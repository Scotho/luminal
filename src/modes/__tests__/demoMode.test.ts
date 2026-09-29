// ── DemoMode participant resolution tests ──────────────────
// Tests the resolution algorithm used by DemoMode._resolveParticipants()
// without instantiating DemoMode (which requires a THREE.Scene host).
// A local copy of the resolution logic is tested against known inputs.

import { describe, it, expect } from 'vitest';
import { getPlayerColor, MENU_DEMO_COLOR_KEYS } from '../../playerColors';
import type { DemoParticipant } from '../demoMode';
import type { VehicleType, ColorEntry } from '../../types/index';

/**
 * Local mirror of DemoMode._resolveParticipants() — kept in sync with demoMode.ts.
 * This lets us unit-test the pure resolution logic without a THREE.Scene host.
 */
function resolveParticipants(
  config: DemoParticipant[] | null,
): Array<{ color: ColorEntry; vehicle: VehicleType }> {
  if (!config || config.length === 0) {
    return MENU_DEMO_COLOR_KEYS.map(key => ({
      color: getPlayerColor(key),
      vehicle: 'bike' as VehicleType,
    }));
  }
  return config.map((p, i) => {
    const color =
      p.color ??
      getPlayerColor(
        p.colorKey ?? MENU_DEMO_COLOR_KEYS[i % MENU_DEMO_COLOR_KEYS.length],
      );
    return { color, vehicle: p.vehicle ?? 'bike' };
  });
}

describe('DemoMode participant resolution', () => {
  // ── Default / fallback behavior ─────────────────────────

  it('null config returns 2 default participants (cyan + orange bikes)', () => {
    const result = resolveParticipants(null);
    expect(result).toHaveLength(2);
    expect(result[0].color).toEqual(getPlayerColor('cyan'));
    expect(result[1].color).toEqual(getPlayerColor('orange'));
    expect(result[0].vehicle).toBe('bike');
    expect(result[1].vehicle).toBe('bike');
  });

  it('empty array returns 2 default participants', () => {
    const result = resolveParticipants([]);
    expect(result).toHaveLength(2);
    expect(result[0].color).toEqual(getPlayerColor('cyan'));
    expect(result[1].color).toEqual(getPlayerColor('orange'));
    expect(result[0].vehicle).toBe('bike');
    expect(result[1].vehicle).toBe('bike');
  });

  // ── Explicit colorKey ───────────────────────────────────

  it('2 participants with colorKey resolve to correct colors', () => {
    const result = resolveParticipants([
      { colorKey: 'red' },
      { colorKey: 'blue' },
    ]);
    expect(result).toHaveLength(2);
    expect(result[0].color).toEqual(getPlayerColor('red'));
    expect(result[1].color).toEqual(getPlayerColor('blue'));
  });

  // ── N > 2 players ──────────────────────────────────────

  it('3 participants with vehicles resolve correctly', () => {
    const result = resolveParticipants([
      { colorKey: 'red', vehicle: 'bike' },
      { colorKey: 'cyan', vehicle: 'car' },
      { colorKey: 'green', vehicle: 'hoverboard' },
    ]);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ color: getPlayerColor('red'), vehicle: 'bike' });
    expect(result[1]).toEqual({ color: getPlayerColor('cyan'), vehicle: 'car' });
    expect(result[2]).toEqual({
      color: getPlayerColor('green'),
      vehicle: 'hoverboard',
    });
  });

  it('4 participants all resolve to 4 items', () => {
    const result = resolveParticipants([
      { colorKey: 'red' },
      { colorKey: 'blue' },
      { colorKey: 'green' },
      { colorKey: 'pink' },
    ]);
    expect(result).toHaveLength(4);
    expect(result[0].color).toEqual(getPlayerColor('red'));
    expect(result[1].color).toEqual(getPlayerColor('blue'));
    expect(result[2].color).toEqual(getPlayerColor('green'));
    expect(result[3].color).toEqual(getPlayerColor('pink'));
  });

  // ── Vehicle defaults ───────────────────────────────────

  it('vehicle defaults to bike when omitted', () => {
    const result = resolveParticipants([{ colorKey: 'red' }]);
    expect(result).toHaveLength(1);
    expect(result[0].vehicle).toBe('bike');
  });

  // ── Color key wrapping ─────────────────────────────────

  it('color wraps around MENU_DEMO_COLOR_KEYS for indices beyond length', () => {
    // 3 participants with no colorKey — wraps: 0→cyan, 1→orange, 2→cyan
    const result = resolveParticipants([{}, {}, {}]);
    expect(result).toHaveLength(3);
    expect(result[0].color).toEqual(
      getPlayerColor(MENU_DEMO_COLOR_KEYS[0]),
    ); // cyan
    expect(result[1].color).toEqual(
      getPlayerColor(MENU_DEMO_COLOR_KEYS[1]),
    ); // orange
    expect(result[2].color).toEqual(
      getPlayerColor(MENU_DEMO_COLOR_KEYS[0]),
    ); // wraps to cyan
  });

  // ── Explicit ColorEntry override ───────────────────────

  it('explicit ColorEntry overrides colorKey lookup', () => {
    const custom: ColorEntry = { color: 0xff0000, emissive: 0x800000 };
    const result = resolveParticipants([
      { color: custom, colorKey: 'blue' },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].color).toBe(custom); // exact reference — not looked up
    expect(result[0].color.color).toBe(0xff0000);
    expect(result[0].color.emissive).toBe(0x800000);
  });

  // ── Mixed configurations ───────────────────────────────

  it('mixed: some with colorKey, some with color, some with neither', () => {
    const custom: ColorEntry = { color: 0xaabbcc, emissive: 0x112233 };
    const result = resolveParticipants([
      { colorKey: 'red' },
      { color: custom },
      {}, // neither — falls back to MENU_DEMO_COLOR_KEYS[2 % 2] = cyan
    ]);
    expect(result).toHaveLength(3);
    expect(result[0].color).toEqual(getPlayerColor('red'));
    expect(result[1].color).toBe(custom);
    expect(result[2].color).toEqual(getPlayerColor('cyan'));
    // All default to bike
    for (const r of result) {
      expect(r.vehicle).toBe('bike');
    }
  });

  // ── Single participant ─────────────────────────────────

  it('single participant with vehicle resolves correctly', () => {
    const result = resolveParticipants([{ vehicle: 'hoverboard' }]);
    expect(result).toHaveLength(1);
    expect(result[0].vehicle).toBe('hoverboard');
    // No colorKey → falls back to MENU_DEMO_COLOR_KEYS[0] = cyan
    expect(result[0].color).toEqual(getPlayerColor('cyan'));
  });

  // ── DemoParticipant type compatibility ─────────────────

  it('DemoParticipant interface allows all fields to be optional', () => {
    // This is a compile-time check — if the type required any field,
    // this assignment would fail TypeScript compilation.
    const empty: DemoParticipant = {};
    const withKey: DemoParticipant = { colorKey: 'red' };
    const withColor: DemoParticipant = {
      color: { color: 0x000000, emissive: 0x000000 },
    };
    const withVehicle: DemoParticipant = { vehicle: 'car' };
    const full: DemoParticipant = {
      colorKey: 'blue',
      color: { color: 0x0000ff, emissive: 0x000080 },
      vehicle: 'hoverboard',
    };

    // Runtime: all should be valid objects
    expect(empty).toBeDefined();
    expect(withKey.colorKey).toBe('red');
    expect(withColor.color).toBeDefined();
    expect(withVehicle.vehicle).toBe('car');
    expect(full.vehicle).toBe('hoverboard');
  });
});
