import { describe, it, afterEach } from 'vitest';
import { expect } from 'vitest';
import { LoopbackHub } from '../loopbackTransport';
import { HeadlessClient } from '../headlessClient';
import { BotInputDriver } from '../inputDrivers/botInputDriver';
import {
  createSimState,
  ARENA_HALF,
  MAX_TRAIL_POINTS,
  type PlayerSpawn,
  type InputFrame,
  type SimState,
} from '../../core/simulation';
import { getSpawnPositions } from '../../net/spawns';
import { BIKE_PHYSICS } from '../../vehicleConfig';

const SOAK_TICKS = 3600; // 60s at 60Hz
const INVARIANT_INTERVAL = 60; // check every 60 ticks (1s)

let hub: LoopbackHub | undefined;

afterEach(() => {
  hub?.dispose();
  hub = undefined;
});

function buildStartState(playerCount: number, seed = 42): {
  spawns: PlayerSpawn[];
  startState: ReturnType<typeof createSimState>;
} {
  const rawSpawns = getSpawnPositions(seed, playerCount);
  const spawns: PlayerSpawn[] = rawSpawns.map(s => ({
    x: s.x,
    z: s.z,
    angle: s.angle,
    baseSpeed: BIKE_PHYSICS.baseSpeed,
  }));
  const startState = createSimState(0, spawns);
  return { spawns, startState };
}

describe('Soak E2E Tests', () => {
  it('S1: 2 bots play 3600 ticks without desync', async () => {
    const playerCount = 2;
    const humanCount = 2;
    const { startState } = buildStartState(playerCount);
    const cfgs = Array.from({ length: playerCount }, () => BIKE_PHYSICS);

    hub = new LoopbackHub({ latencyMs: 0, packetLossRate: 0 });
    const uids = ['player-0', 'player-1'];
    const clients: HeadlessClient[] = [];

    for (let i = 0; i < humanCount; i++) {
      const opponentUids = uids.filter((_, j) => j !== i);
      const transport = hub.createTransport(i, uids[i], opponentUids);
      clients.push(new HeadlessClient({
        myIndex: i,
        playerCount,
        humanCount,
        startState,
        cfgs,
        transport,
        inputDriver: new BotInputDriver(),
      }));
    }

    await Promise.all(clients.map(c => c.start()));

    for (let t = 0; t < SOAK_TICKS; t++) {
      for (const client of clients) client.tick();

      if (t % INVARIANT_INTERVAL === 0) {
        const state0 = clients[0]['_lockstep'].state;
        const state1 = clients[1]['_lockstep'].state;

        // Positions agree
        for (let p = 0; p < playerCount; p++) {
          expect(state0.players[p].x).toBeCloseTo(state1.players[p].x, 5);
          expect(state0.players[p].z).toBeCloseTo(state1.players[p].z, 5);
        }

        // Trails within MAX_TRAIL_POINTS
        for (const trail of state0.trails) {
          expect(trail.length).toBeLessThanOrEqual(MAX_TRAIL_POINTS);
        }

        // Alive players within ARENA_HALF + 5
        for (const player of state0.players) {
          if (player.alive) {
            expect(Math.abs(player.x)).toBeLessThanOrEqual(ARENA_HALF + 5);
            expect(Math.abs(player.z)).toBeLessThanOrEqual(ARENA_HALF + 5);
          }
        }
      }
    }

    // Check hash agreement on all common ticks
    const hashes0 = clients[0].recorder.getHashes();
    const hashes1 = clients[1].recorder.getHashes();
    const hashMap1 = new Map(hashes1.map(h => [h.tick, h.hash]));

    for (const { tick, hash } of hashes0) {
      const remoteHash = hashMap1.get(tick);
      if (remoteHash !== undefined) {
        expect(hash).toBe(remoteHash);
      }
    }

    for (const client of clients) client.stop();
  }, 30_000);

  it('S2: 2H bots + 2 AI soak 3600 ticks', async () => {
    const playerCount = 4;
    const humanCount = 2;
    const { startState } = buildStartState(playerCount);
    const cfgs = Array.from({ length: playerCount }, () => BIKE_PHYSICS);

    const neutralAiProvider = (_playerIndex: number, _state: SimState, tick: number): InputFrame => ({
      tick,
      turnDir: 0,
      accelerate: false,
      dash: false,
      brake: false,
    });

    hub = new LoopbackHub({ latencyMs: 0, packetLossRate: 0 });
    const uids = ['player-0', 'player-1'];
    const clients: HeadlessClient[] = [];

    for (let i = 0; i < humanCount; i++) {
      const opponentUids = uids.filter((_, j) => j !== i);
      const transport = hub.createTransport(i, uids[i], opponentUids);
      clients.push(new HeadlessClient({
        myIndex: i,
        playerCount,
        humanCount,
        startState,
        cfgs,
        transport,
        inputDriver: new BotInputDriver(),
        aiInputProvider: neutralAiProvider,
      }));
    }

    await Promise.all(clients.map(c => c.start()));

    for (let t = 0; t < SOAK_TICKS; t++) {
      for (const client of clients) client.tick();
    }

    // Check hash agreement on all common ticks
    const hashes0 = clients[0].recorder.getHashes();
    const hashes1 = clients[1].recorder.getHashes();
    const hashMap1 = new Map(hashes1.map(h => [h.tick, h.hash]));

    for (const { tick, hash } of hashes0) {
      const remoteHash = hashMap1.get(tick);
      if (remoteHash !== undefined) {
        expect(hash).toBe(remoteHash);
      }
    }

    for (const client of clients) client.stop();
  }, 30_000);

  it('S3: 2 bots with 5% packet loss + 50ms latency — no crash, progress past tick 100', async () => {
    const playerCount = 2;
    const humanCount = 2;
    const { startState } = buildStartState(playerCount);
    const cfgs = Array.from({ length: playerCount }, () => BIKE_PHYSICS);

    hub = new LoopbackHub({ latencyMs: 50, packetLossRate: 0.05, jitterMs: 10 });
    const uids = ['player-0', 'player-1'];
    const clients: HeadlessClient[] = [];

    for (let i = 0; i < humanCount; i++) {
      const opponentUids = uids.filter((_, j) => j !== i);
      const transport = hub.createTransport(i, uids[i], opponentUids);
      clients.push(new HeadlessClient({
        myIndex: i,
        playerCount,
        humanCount,
        startState,
        cfgs,
        transport,
        inputDriver: new BotInputDriver(),
      }));
    }

    await Promise.all(clients.map(c => c.start()));

    // With real latency (setTimeout), delayed messages won't arrive in a synchronous loop.
    // This test mainly verifies no crashes occur under adverse network conditions.
    for (let t = 0; t < SOAK_TICKS; t++) {
      for (const client of clients) client.tick();
    }

    // Both clients should have progressed past tick 100
    expect(clients[0].currentTick).toBeGreaterThan(100);
    expect(clients[1].currentTick).toBeGreaterThan(100);

    for (const client of clients) client.stop();
  }, 30_000);
});
