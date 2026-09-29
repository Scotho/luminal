import { describe, it, expect, afterEach } from 'vitest';
import { HeadlessClient } from './headlessClient';
import { LoopbackHub } from './loopbackTransport';
import { ScriptedInputDriver } from './inputDrivers/scriptedInputDriver';
import { BIKE_PHYSICS } from '../vehicleConfig';
import { getSpawnPositions } from '../net/spawns';
import { createSimState } from '../core/simulation';

describe('HeadlessClient', () => {
  let hub: LoopbackHub;

  afterEach(() => {
    hub?.dispose();
  });

  it('two clients run 60 ticks and agree on state', async () => {
    hub = new LoopbackHub({ latencyMs: 0, packetLossRate: 0 });
    const seed = 42;
    const spawns = getSpawnPositions(seed, 2);
    const startState = createSimState(0, spawns);
    const cfgs = [BIKE_PHYSICS, BIKE_PHYSICS];

    const driver0 = new ScriptedInputDriver([]);
    const driver1 = new ScriptedInputDriver([]);

    const t0 = hub.createTransport(0, 'p0', ['p1']);
    const t1 = hub.createTransport(1, 'p1', ['p0']);

    const client0 = new HeadlessClient({
      myIndex: 0, playerCount: 2, humanCount: 2,
      startState, cfgs, transport: t0, inputDriver: driver0,
    });
    const client1 = new HeadlessClient({
      myIndex: 1, playerCount: 2, humanCount: 2,
      startState, cfgs, transport: t1, inputDriver: driver1,
    });

    await client0.start();
    await client1.start();

    for (let i = 0; i < 60; i++) {
      client0.tick();
      client1.tick();
    }

    const state0 = client0.recorder.getStateAt(60);
    const state1 = client1.recorder.getStateAt(60);

    expect(state0).toBeDefined();
    expect(state1).toBeDefined();
    expect(state0!.players[0].x).toBe(state1!.players[0].x);
    expect(state0!.players[1].x).toBe(state1!.players[1].x);
    expect(state0!.tick).toBe(state1!.tick);
  });

  it('records deaths when a player collides', async () => {
    hub = new LoopbackHub({ latencyMs: 0, packetLossRate: 0 });
    const startState = createSimState(0, [
      { x: -20, z: 0, angle: Math.PI / 2, baseSpeed: 40 },
      { x: 20, z: 0, angle: -Math.PI / 2, baseSpeed: 40 },
    ]);
    const cfgs = [BIKE_PHYSICS, BIKE_PHYSICS];

    const driver0 = new ScriptedInputDriver([
      { tick: 1, input: { turnDir: 1 } },
      { tick: 15, input: { turnDir: 0 } },
    ]);
    const driver1 = new ScriptedInputDriver([]);

    const t0 = hub.createTransport(0, 'p0', ['p1']);
    const t1 = hub.createTransport(1, 'p1', ['p0']);

    const client0 = new HeadlessClient({
      myIndex: 0, playerCount: 2, humanCount: 2,
      startState, cfgs, transport: t0, inputDriver: driver0,
    });
    const client1 = new HeadlessClient({
      myIndex: 1, playerCount: 2, humanCount: 2,
      startState, cfgs, transport: t1, inputDriver: driver1,
    });

    await client0.start();
    await client1.start();

    for (let i = 0; i < 300; i++) {
      client0.tick();
      client1.tick();
      const deaths0 = client0.recorder.getDeaths();
      const deaths1 = client1.recorder.getDeaths();
      if (deaths0.length > 0 || deaths1.length > 0) break;
    }

    const allDeaths = [...client0.recorder.getDeaths(), ...client1.recorder.getDeaths()];
    expect(allDeaths.length).toBeGreaterThan(0);
  });
});
