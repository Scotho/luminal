import { describe, it, expect } from 'vitest';
import { StateRecorder } from './stateRecorder';
import { createSimState } from '../core/simulation';
import type { SimState } from '../core/simulation';

describe('StateRecorder', () => {
  function makeState(tick: number): SimState {
    return createSimState(tick, [{ x: tick, z: 0, angle: 0, baseSpeed: 40 }]);
  }

  it('records and retrieves state by tick', () => {
    const recorder = new StateRecorder();
    const state = makeState(5);
    recorder.record(state);
    expect(recorder.getStateAt(5)?.tick).toBe(5);
    expect(recorder.getStateAt(5)?.players[0].x).toBe(5);
  });

  it('returns undefined for unrecorded tick', () => {
    const recorder = new StateRecorder();
    expect(recorder.getStateAt(99)).toBeUndefined();
  });

  it('records deaths', () => {
    const recorder = new StateRecorder();
    recorder.recordDeath(1, 42);
    recorder.recordDeath(0, 50);
    const deaths = recorder.getDeaths();
    expect(deaths).toHaveLength(2);
    expect(deaths[0]).toEqual({ playerIndex: 1, tick: 42 });
  });

  it('records and retrieves hashes', () => {
    const recorder = new StateRecorder();
    recorder.recordHash(60, 123456);
    recorder.recordHash(120, 789012);
    const hashes = recorder.getHashes();
    expect(hashes).toHaveLength(2);
    expect(hashes[0]).toEqual({ tick: 60, hash: 123456 });
  });
});
