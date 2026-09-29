import { describe, it, expect } from 'vitest';
import { BotInputDriver } from './botInputDriver';
import { createSimState, ARENA_HALF } from '../../core/simulation';
import type { PlayerSim } from '../../core/simulation';

describe('BotInputDriver', () => {
  function makeState(x: number, z: number, angle: number) {
    const state = createSimState(0, [{ x, z, angle, baseSpeed: 40 }]);
    return state;
  }

  it('returns valid InputFrame with correct tick', () => {
    const driver = new BotInputDriver();
    const state = makeState(0, 0, 0);
    const input = driver.getInput(42, state, 0);
    expect(input.tick).toBe(42);
    expect(typeof input.turnDir).toBe('number');
    expect([-1, 0, 1]).toContain(input.turnDir);
  });

  it('turns when near arena wall', () => {
    const driver = new BotInputDriver();
    // Place player near +X wall, facing +X (angle = PI/2 means facing +X in this sim)
    const state = makeState(ARENA_HALF - 10, 0, Math.PI / 2);
    const input = driver.getInput(1, state, 0);
    // Should turn (direction depends on implementation, but should not go straight)
    expect(input.turnDir).not.toBe(0);
  });

  it('never reports done', () => {
    const driver = new BotInputDriver();
    expect(driver.isDone(0)).toBe(false);
    expect(driver.isDone(999999)).toBe(false);
  });
});
