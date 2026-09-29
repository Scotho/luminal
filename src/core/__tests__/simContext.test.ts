// ── simContext builder tests ────────────────────────────
import { describe, it, expect } from 'vitest';
import { buildLocalSimContext } from '../simContext';
import { createPlayerSim } from '../simulation';
import type { TrailPoint, PlayerSim } from '../simulation';

describe('buildLocalSimContext', () => {
  it('returns an object with tick, players, trails populated', () => {
    const players: PlayerSim[] = [createPlayerSim(0, 0, 0, 45, 'hoverboard')];
    const trails: TrailPoint[][] = [[]];
    const state = buildLocalSimContext(42, players, trails);
    expect(state.tick).toBe(42);
    expect(state.players).toBe(players);
    expect(state.trails).toBe(trails);
  });

  it('uses trails by reference (not cloned)', () => {
    const trailA: TrailPoint[] = [{ x: 0, z: 0 }];
    const trails: TrailPoint[][] = [trailA];
    const players: PlayerSim[] = [createPlayerSim(0, 0, 0, 45, 'hoverboard')];
    const state = buildLocalSimContext(1, players, trails);

    // Mutating the original array should affect the returned state
    trailA.push({ x: 1, z: 1 });
    expect(state.trails[0].length).toBe(2);
    expect(state.trails[0][1]).toEqual({ x: 1, z: 1 });

    // Replacing an outer entry via the original trails array
    trails.push([{ x: 2, z: 2 }]);
    expect(state.trails.length).toBe(2);
  });

  it('uses players by reference (not cloned)', () => {
    const p1 = createPlayerSim(0, 0, 0, 45, 'hoverboard');
    const players: PlayerSim[] = [p1];
    const trails: TrailPoint[][] = [[]];
    const state = buildLocalSimContext(1, players, trails);
    expect(state.players[0]).toBe(p1);
    // Mutating the player should be visible via the returned state
    p1.meter = 50;
    expect(state.players[0].meter).toBe(50);
  });

  it('tick value flows through unchanged', () => {
    const players: PlayerSim[] = [];
    const trails: TrailPoint[][] = [];
    expect(buildLocalSimContext(0, players, trails).tick).toBe(0);
    expect(buildLocalSimContext(9999, players, trails).tick).toBe(9999);
    expect(buildLocalSimContext(-1, players, trails).tick).toBe(-1);
  });
});
