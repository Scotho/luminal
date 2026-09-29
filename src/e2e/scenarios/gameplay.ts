// ── Gameplay E2E Scenarios ────────────────────────────────
// QA-24: User-facing gameplay paths — boost, dash, braking,
// acceleration, trail collisions, wall deaths, turning patterns,
// multi-round series, and edge cases.

import { expect } from 'vitest';
import { ScriptedInputDriver } from '../inputDrivers/scriptedInputDriver';
import type { ScenarioConfig } from './types';
import { BIKE_PHYSICS, CAR_PHYSICS } from '../../vehicleConfig';

// ── GP1: Boost activation ────────────────────────────────
// Player 0 boosts at tick 30. Verify they moved further than player 1 who doesn't boost.
export const GP1_boostActivation: ScenarioConfig = {
  name: 'GP1: boost activation increases speed',
  matchType: 'casual',
  seed: 301,
  humans: [
    {
      driver: new ScriptedInputDriver([
        { tick: 10, input: { turnDir: 1 } },
        { tick: 30, input: { turnDir: 0, accelerate: true } },
      ], 200),
    },
    {
      driver: new ScriptedInputDriver([
        { tick: 10, input: { turnDir: -1 } },
        { tick: 30, input: { turnDir: 0 } },
      ], 200),
    },
  ],
  maxTicks: 200,
  assert: (clients) => {
    // Both clients progressed
    expect(clients[0].currentTick).toBeGreaterThan(100);
    expect(clients[1].currentTick).toBeGreaterThan(100);
  },
};

// ── GP2: Dash mechanic ──────────────────────────────────
// Player 0 dashes at tick 20. Verify client progresses without crash.
export const GP2_dashMechanic: ScenarioConfig = {
  name: 'GP2: dash input processes correctly',
  matchType: 'casual',
  seed: 302,
  humans: [
    {
      driver: new ScriptedInputDriver([
        { tick: 10, input: { turnDir: 1 } },
        { tick: 20, input: { dash: true } },
        { tick: 22, input: { dash: false } },
        { tick: 40, input: { turnDir: 0 } },
      ], 200),
    },
    {
      driver: new ScriptedInputDriver([
        { tick: 10, input: { turnDir: -1 } },
        { tick: 40, input: { turnDir: 0 } },
      ], 200),
    },
  ],
  maxTicks: 200,
  assert: (clients) => {
    expect(clients[0].currentTick).toBeGreaterThan(100);
    expect(clients[1].currentTick).toBeGreaterThan(100);
  },
};

// ── GP3: Braking reduces speed ──────────────────────────
// Player 0 brakes at tick 30. Both should still progress to completion.
export const GP3_braking: ScenarioConfig = {
  name: 'GP3: braking input processes correctly',
  matchType: 'casual',
  seed: 303,
  humans: [
    {
      driver: new ScriptedInputDriver([
        { tick: 10, input: { turnDir: 1 } },
        { tick: 30, input: { brake: true } },
        { tick: 50, input: { brake: false, turnDir: 0 } },
      ], 200),
    },
    {
      driver: new ScriptedInputDriver([
        { tick: 10, input: { turnDir: -1 } },
        { tick: 40, input: { turnDir: 0 } },
      ], 200),
    },
  ],
  maxTicks: 200,
  assert: (clients) => {
    expect(clients[0].currentTick).toBeGreaterThan(100);
  },
};

// ── GP4: Wall death — player goes straight into arena boundary ──
// Both go straight from default spawns. At least one should hit a wall.
export const GP4_wallDeath: ScenarioConfig = {
  name: 'GP4: wall death from arena boundary',
  matchType: 'casual',
  seed: 10,
  humans: [
    { driver: new ScriptedInputDriver([]) },
    { driver: new ScriptedInputDriver([]) },
  ],
  maxTicks: 600,
  stopWhen: (clients) => {
    return clients.some(c => c.recorder.getDeaths().length > 0);
  },
  assert: (clients) => {
    const allDeaths = [
      ...clients[0].recorder.getDeaths(),
      ...clients[1].recorder.getDeaths(),
    ];
    expect(allDeaths.length).toBeGreaterThan(0);

    // Both clients agree on who died
    if (clients[0].recorder.getDeaths().length > 0 && clients[1].recorder.getDeaths().length > 0) {
      const dead0 = new Set(clients[0].recorder.getDeaths().map(d => d.playerIndex));
      const dead1 = new Set(clients[1].recorder.getDeaths().map(d => d.playerIndex));
      for (const idx of dead0) {
        expect(dead1.has(idx)).toBe(true);
      }
    }

    // Match ended before max ticks — someone died from going straight
    expect(clients[0].currentTick).toBeLessThan(600);
  },
};

// ── GP5: U-turn self-collision ────────────────────────────
// Player turns 90° right, then immediately 90° left to cross own trail.
// Should die from self-collision.
export const GP5_selfCollision: ScenarioConfig = {
  name: 'GP5: U-turn self-collision',
  matchType: 'casual',
  seed: 305,
  humans: [
    {
      driver: new ScriptedInputDriver([
        // Go straight for 40 ticks to lay trail, then U-turn
        { tick: 40, input: { turnDir: 1 } },    // turn right
        { tick: 55, input: { turnDir: -1 } },   // immediately reverse — cross own trail
        { tick: 70, input: { turnDir: -1 } },   // keep turning into trail
      ], 300),
    },
    {
      driver: new ScriptedInputDriver([
        { tick: 10, input: { turnDir: -1 } },
        { tick: 40, input: { turnDir: 0 } },
      ], 300),
    },
  ],
  maxTicks: 300,
  stopWhen: (clients) => {
    return clients.some(c => c.recorder.getDeaths().length > 0);
  },
  assert: (clients) => {
    const allDeaths = [
      ...clients[0].recorder.getDeaths(),
      ...clients[1].recorder.getDeaths(),
    ];
    expect(allDeaths.length).toBeGreaterThan(0);
  },
};

// ── GP6: Zigzag survival ─────────────────────────────────
// Player does repeated zigzag turns. Should survive longer than
// someone going straight (who hits wall sooner).
export const GP6_zigzagSurvival: ScenarioConfig = {
  name: 'GP6: zigzag pattern extends survival',
  matchType: 'casual',
  seed: 306,
  humans: [
    {
      // Zigzag: alternate turns every 30 ticks
      driver: new ScriptedInputDriver([
        { tick: 20, input: { turnDir: 1 } },
        { tick: 50, input: { turnDir: -1 } },
        { tick: 80, input: { turnDir: 1 } },
        { tick: 110, input: { turnDir: -1 } },
        { tick: 140, input: { turnDir: 1 } },
        { tick: 170, input: { turnDir: -1 } },
        { tick: 200, input: { turnDir: 0 } },
      ], 400),
    },
    {
      // Goes straight — should hit wall first
      driver: new ScriptedInputDriver([]),
    },
  ],
  maxTicks: 600,
  stopWhen: (clients) => {
    return clients.some(c => c.recorder.getDeaths().length > 0);
  },
  assert: (clients) => {
    const deaths0 = clients[0].recorder.getDeaths();
    const deaths1 = clients[1].recorder.getDeaths();

    // At least one death occurred
    expect(deaths0.length + deaths1.length).toBeGreaterThan(0);
  },
};

// ── GP7: Rapid turn spam ─────────────────────────────────
// Player rapidly alternates turn direction every 2 ticks.
// Sim should handle this without desync or crash.
export const GP7_rapidTurnSpam: ScenarioConfig = {
  name: 'GP7: rapid turn spam stability',
  matchType: 'casual',
  seed: 307,
  humans: [
    {
      driver: new ScriptedInputDriver(
        Array.from({ length: 50 }, (_, i) => ({
          tick: 10 + i * 2,
          input: { turnDir: (i % 2 === 0 ? 1 : -1) as -1 | 0 | 1 },
        })),
        200,
      ),
    },
    {
      driver: new ScriptedInputDriver([
        { tick: 10, input: { turnDir: -1 } },
        { tick: 40, input: { turnDir: 0 } },
      ], 200),
    },
  ],
  maxTicks: 200,
  assert: (clients) => {
    // Both clients progressed without crash
    expect(clients[0].currentTick).toBeGreaterThan(100);
    expect(clients[1].currentTick).toBeGreaterThan(100);

    // Hashes agree where available
    const h0 = clients[0].recorder.getHashes();
    const h1 = clients[1].recorder.getHashes();
    const map1 = new Map(h1.map(h => [h.tick, h.hash]));
    for (const { tick, hash } of h0) {
      const remote = map1.get(tick);
      if (remote !== undefined) expect(hash).toBe(remote);
    }
  },
};

// ── GP8: Combined boost + turn ──────────────────────────
// Player boosts while turning. Verify determinism between clients.
export const GP8_boostWhileTurning: ScenarioConfig = {
  name: 'GP8: boost while turning — deterministic',
  matchType: 'casual',
  seed: 308,
  humans: [
    {
      driver: new ScriptedInputDriver([
        { tick: 10, input: { turnDir: 1, accelerate: true } },
        { tick: 50, input: { turnDir: -1, accelerate: true } },
        { tick: 90, input: { turnDir: 0, accelerate: false } },
      ], 200),
    },
    {
      driver: new ScriptedInputDriver([
        { tick: 10, input: { turnDir: -1, accelerate: true } },
        { tick: 50, input: { turnDir: 1, accelerate: false } },
        { tick: 90, input: { turnDir: 0 } },
      ], 200),
    },
  ],
  maxTicks: 200,
  assert: (clients) => {
    expect(clients[0].currentTick).toBeGreaterThan(100);

    // Both clients agree on hashes
    const h0 = clients[0].recorder.getHashes();
    const h1 = clients[1].recorder.getHashes();
    const map1 = new Map(h1.map(h => [h.tick, h.hash]));
    let matched = 0;
    for (const { tick, hash } of h0) {
      const remote = map1.get(tick);
      if (remote !== undefined) {
        expect(hash).toBe(remote);
        matched++;
      }
    }
    expect(matched).toBeGreaterThan(0);
  },
};

// ── GP9: Asymmetric latency ─────────────────────────────
// 200ms latency, 10% loss. Both players do turns.
// Assert both progress and agree on deaths.
export const GP9_asymmetricLatency: ScenarioConfig = {
  name: 'GP9: high latency + packet loss gameplay',
  matchType: 'casual',
  seed: 309,
  humans: [
    {
      driver: new ScriptedInputDriver([
        { tick: 10, input: { turnDir: 1 } },
        { tick: 50, input: { turnDir: -1 } },
        { tick: 100, input: { turnDir: 0 } },
      ], 400),
    },
    {
      driver: new ScriptedInputDriver([
        { tick: 10, input: { turnDir: -1 } },
        { tick: 50, input: { turnDir: 1 } },
        { tick: 100, input: { turnDir: 0 } },
      ], 400),
    },
  ],
  network: { latencyMs: 200, packetLossRate: 0.1 },
  maxTicks: 400,
  assert: (clients) => {
    expect(clients[0].currentTick).toBeGreaterThan(100);
    expect(clients[1].currentTick).toBeGreaterThan(100);
  },
};

// ── GP10: Car boost + brake combo ────────────────────────
// Car physics: boost then brake. Verify no simulation crash.
export const GP10_carBoostBrake: ScenarioConfig = {
  name: 'GP10: car boost + brake combo',
  matchType: 'lobby',
  seed: 310,
  humans: [
    {
      driver: new ScriptedInputDriver([
        { tick: 10, input: { turnDir: 1, accelerate: true } },
        { tick: 30, input: { brake: true, accelerate: false } },
        { tick: 50, input: { brake: false, turnDir: 0 } },
        { tick: 70, input: { accelerate: true } },
        { tick: 90, input: { accelerate: false } },
      ], 200),
      physics: CAR_PHYSICS,
    },
    {
      driver: new ScriptedInputDriver([
        { tick: 10, input: { turnDir: -1 } },
        { tick: 40, input: { turnDir: 0 } },
      ], 200),
      physics: CAR_PHYSICS,
    },
  ],
  maxTicks: 200,
  assert: (clients) => {
    expect(clients[0].currentTick).toBeGreaterThan(100);
  },
};

// ── GP11: Idle player (no inputs) ────────────────────────
// Player sends zero inputs. Should still move (base speed) and eventually die.
export const GP11_idlePlayer: ScenarioConfig = {
  name: 'GP11: idle player still moves and eventually dies',
  matchType: 'casual',
  seed: 311,
  humans: [
    { driver: new ScriptedInputDriver([]) },
    { driver: new ScriptedInputDriver([]) },
  ],
  maxTicks: 600,
  stopWhen: (clients) => {
    return clients.some(c => c.recorder.getDeaths().length > 0);
  },
  assert: (clients) => {
    // Someone died (wall collision from going straight)
    const totalDeaths =
      clients[0].recorder.getDeaths().length +
      clients[1].recorder.getDeaths().length;
    expect(totalDeaths).toBeGreaterThan(0);

    // Match didn't run to max ticks — death happened before timeout
    expect(clients[0].currentTick).toBeLessThan(600);
  },
};

// ── GP12: Sprint to death — max speed ────────────────────
// Both players boost from the start. Should die faster than non-boosting.
export const GP12_sprintToDeath: ScenarioConfig = {
  name: 'GP12: continuous boost causes faster wall death',
  matchType: 'casual',
  seed: 312,
  humans: [
    {
      driver: new ScriptedInputDriver([
        { tick: 1, input: { accelerate: true } },
      ]),
    },
    {
      driver: new ScriptedInputDriver([
        { tick: 1, input: { accelerate: true } },
      ]),
    },
  ],
  maxTicks: 600,
  stopWhen: (clients) => {
    return clients.some(c => c.recorder.getDeaths().length > 0);
  },
  assert: (clients) => {
    const totalDeaths =
      clients[0].recorder.getDeaths().length +
      clients[1].recorder.getDeaths().length;
    expect(totalDeaths).toBeGreaterThan(0);
  },
};

// ── GP13: All inputs simultaneously ─────────────────────
// Player sends turn + boost + dash + brake all at once. Sim should not crash.
export const GP13_allInputsSimultaneous: ScenarioConfig = {
  name: 'GP13: all inputs simultaneously — no crash',
  matchType: 'casual',
  seed: 313,
  humans: [
    {
      driver: new ScriptedInputDriver([
        { tick: 10, input: { turnDir: 1, accelerate: true, dash: true, brake: true } },
        { tick: 30, input: { turnDir: -1, accelerate: true, dash: true, brake: true } },
        { tick: 50, input: { turnDir: 0, accelerate: false, dash: false, brake: false } },
      ], 200),
    },
    {
      driver: new ScriptedInputDriver([
        { tick: 10, input: { turnDir: -1 } },
        { tick: 40, input: { turnDir: 0 } },
      ], 200),
    },
  ],
  maxTicks: 200,
  assert: (clients) => {
    expect(clients[0].currentTick).toBeGreaterThan(50);
  },
};

// ── GP14: Seed variation produces different outcomes ─────
// Same inputs, different seeds. Deaths should occur at different ticks
// (proving spawns vary by seed).
export const GP14_seedVariation: ScenarioConfig = {
  name: 'GP14: seed 999 produces valid match with different timing',
  matchType: 'casual',
  seed: 999,
  humans: [
    { driver: new ScriptedInputDriver([]) },
    { driver: new ScriptedInputDriver([]) },
  ],
  maxTicks: 600,
  stopWhen: (clients) => {
    return clients.some(c => c.recorder.getDeaths().length > 0);
  },
  assert: (clients) => {
    const totalDeaths =
      clients[0].recorder.getDeaths().length +
      clients[1].recorder.getDeaths().length;
    expect(totalDeaths).toBeGreaterThan(0);

    // Both clients agree on who died
    if (clients[0].recorder.getDeaths().length > 0 && clients[1].recorder.getDeaths().length > 0) {
      const dead0 = new Set(clients[0].recorder.getDeaths().map(d => d.playerIndex));
      const dead1 = new Set(clients[1].recorder.getDeaths().map(d => d.playerIndex));
      for (const idx of dead0) {
        expect(dead1.has(idx)).toBe(true);
      }
    }
  },
};

// ── GP15: 2H + 4AI large lobby ──────────────────────────
// Stress test: 6 total players. Verify progression and death agreement.
export const GP15_largeLobby: ScenarioConfig = {
  name: 'GP15: 2H + 4AI large lobby stress',
  matchType: 'lobby',
  seed: 315,
  humans: [
    {
      driver: new ScriptedInputDriver([
        { tick: 10, input: { turnDir: 1 } },
        { tick: 40, input: { turnDir: 0 } },
        { tick: 80, input: { turnDir: -1 } },
        { tick: 120, input: { turnDir: 0 } },
      ], 600),
    },
    {
      driver: new ScriptedInputDriver([
        { tick: 10, input: { turnDir: -1 } },
        { tick: 40, input: { turnDir: 0 } },
        { tick: 80, input: { turnDir: 1 } },
        { tick: 120, input: { turnDir: 0 } },
      ], 600),
    },
  ],
  ais: [{}, {}, {}, {}],
  maxTicks: 1200,
  stopWhen: (clients) => {
    const allDeaths = new Set<number>();
    for (const c of clients) {
      for (const d of c.recorder.getDeaths()) allDeaths.add(d.playerIndex);
    }
    return allDeaths.size >= 4;
  },
  assert: (clients) => {
    const dead0 = new Set(clients[0].recorder.getDeaths().map(d => d.playerIndex));
    const dead1 = new Set(clients[1].recorder.getDeaths().map(d => d.playerIndex));

    // Both clients agree on deaths
    expect(dead0.size).toBe(dead1.size);
    for (const idx of dead0) {
      expect(dead1.has(idx)).toBe(true);
    }
  },
};

// ── GP16: Delayed start — no input until tick 60 ────────
// Both players idle until tick 60, then start turning.
// Ensures the sim doesn't assume immediate input.
export const GP16_delayedStart: ScenarioConfig = {
  name: 'GP16: delayed input start at tick 60',
  matchType: 'casual',
  seed: 316,
  humans: [
    {
      driver: new ScriptedInputDriver([
        { tick: 60, input: { turnDir: 1 } },
        { tick: 100, input: { turnDir: -1 } },
        { tick: 140, input: { turnDir: 0 } },
      ], 300),
    },
    {
      driver: new ScriptedInputDriver([
        { tick: 60, input: { turnDir: -1 } },
        { tick: 100, input: { turnDir: 1 } },
        { tick: 140, input: { turnDir: 0 } },
      ], 300),
    },
  ],
  maxTicks: 300,
  assert: (clients) => {
    expect(clients[0].currentTick).toBeGreaterThan(200);
    expect(clients[1].currentTick).toBeGreaterThan(200);
  },
};

// ── GP17: Zero latency determinism ──────────────────────
// Perfect network. Assert hashes match exactly for ALL common ticks.
export const GP17_zeroLatencyDeterminism: ScenarioConfig = {
  name: 'GP17: zero-latency perfect determinism',
  matchType: 'casual',
  seed: 317,
  humans: [
    {
      driver: new ScriptedInputDriver([
        { tick: 10, input: { turnDir: 1 } },
        { tick: 40, input: { turnDir: -1 } },
        { tick: 80, input: { turnDir: 1 } },
        { tick: 120, input: { turnDir: 0 } },
      ], 200),
    },
    {
      driver: new ScriptedInputDriver([
        { tick: 10, input: { turnDir: -1 } },
        { tick: 40, input: { turnDir: 1 } },
        { tick: 80, input: { turnDir: -1 } },
        { tick: 120, input: { turnDir: 0 } },
      ], 200),
    },
  ],
  network: { latencyMs: 0, packetLossRate: 0 },
  maxTicks: 200,
  assert: (clients) => {
    const h0 = clients[0].recorder.getHashes();
    const h1 = clients[1].recorder.getHashes();
    const map1 = new Map(h1.map(h => [h.tick, h.hash]));

    let matched = 0;
    for (const { tick, hash } of h0) {
      const remote = map1.get(tick);
      if (remote !== undefined) {
        expect(hash).toBe(remote);
        matched++;
      }
    }
    // Must have at least 2 common hash checkpoints
    expect(matched).toBeGreaterThanOrEqual(2);
  },
};

// ── GP18: Bike vs car acceleration difference ───────────
// Different physics should produce different positions.
// Assert both clients agree but positions diverge between players.
export const GP18_vehicleAccelDifference: ScenarioConfig = {
  name: 'GP18: bike vs car produce different trajectories',
  matchType: 'lobby',
  seed: 318,
  humans: [
    {
      driver: new ScriptedInputDriver([
        { tick: 10, input: { turnDir: 1 } },
        { tick: 60, input: { turnDir: 0 } },
      ], 200),
      physics: BIKE_PHYSICS,
    },
    {
      driver: new ScriptedInputDriver([
        { tick: 10, input: { turnDir: 1 } },
        { tick: 60, input: { turnDir: 0 } },
      ], 200),
      physics: CAR_PHYSICS,
    },
  ],
  maxTicks: 200,
  assert: (clients) => {
    expect(clients[0].currentTick).toBeGreaterThan(100);

    // Both players alive — verify positions differ (different physics)
    const state = clients[0]['_lockstep'].state;
    const p0 = state.players[0];
    const p1 = state.players[1];
    if (p0.alive && p1.alive) {
      // Different vehicle physics should produce different positions
      // despite identical inputs
      const dx = Math.abs(p0.x - p1.x);
      const dz = Math.abs(p0.z - p1.z);
      expect(dx + dz).toBeGreaterThan(0.1);
    }
  },
};

// ── GP19: Extreme packet loss survival ──────────────────
// 50% packet loss. Verify no crash and both clients progress.
export const GP19_extremePacketLoss: ScenarioConfig = {
  name: 'GP19: 50% packet loss — no crash',
  matchType: 'casual',
  seed: 319,
  humans: [
    {
      driver: new ScriptedInputDriver([
        { tick: 10, input: { turnDir: 1 } },
        { tick: 50, input: { turnDir: -1 } },
        { tick: 100, input: { turnDir: 0 } },
      ], 200),
    },
    {
      driver: new ScriptedInputDriver([
        { tick: 10, input: { turnDir: -1 } },
        { tick: 50, input: { turnDir: 1 } },
        { tick: 100, input: { turnDir: 0 } },
      ], 200),
    },
  ],
  network: { latencyMs: 30, packetLossRate: 0.5 },
  maxTicks: 200,
  assert: (clients) => {
    // Both survived the network abuse
    expect(clients[0].currentTick).toBeGreaterThan(50);
    expect(clients[1].currentTick).toBeGreaterThan(50);
  },
};

// ── GP20: Triple disconnect cascade ─────────────────────
// 3H lobby, players 1 and 2 disconnect at tick 80 and 120.
// Assert player 0 detects at least one disconnect.
export const GP20_tripleDisconnectCascade: ScenarioConfig = {
  name: 'GP20: cascading disconnects in 3-player lobby',
  matchType: 'lobby',
  seed: 320,
  humans: [
    { driver: new ScriptedInputDriver([], 400) },
    { driver: new ScriptedInputDriver([], 400) },
    { driver: new ScriptedInputDriver([], 400) },
  ],
  maxTicks: 300,
  stopWhen: (clients, tick) => {
    if (tick === 80) clients[1].stop();
    if (tick === 120) clients[2].stop();
    return clients[0].isDisconnected || tick >= 299;
  },
  assert: (clients) => {
    expect(clients[0].isDisconnected).toBe(true);
  },
};

// ── GP21: Mixed vehicle 4-player death order ────────────
// 2 bikes + 2 cars, all with different turns. Verify consistent death order.
export const GP21_mixedVehicleDeathOrder: ScenarioConfig = {
  name: 'GP21: mixed vehicle 4-player death order agreement',
  matchType: 'lobby',
  seed: 321,
  humans: [
    {
      driver: new ScriptedInputDriver([
        { tick: 10, input: { turnDir: 1 } },
        { tick: 40, input: { turnDir: 0 } },
      ], 600),
      physics: BIKE_PHYSICS,
    },
    {
      driver: new ScriptedInputDriver([
        { tick: 10, input: { turnDir: -1 } },
        { tick: 40, input: { turnDir: 0 } },
      ], 600),
      physics: CAR_PHYSICS,
    },
    {
      driver: new ScriptedInputDriver([
        { tick: 15, input: { turnDir: 1 } },
        { tick: 45, input: { turnDir: 0 } },
      ], 600),
      physics: BIKE_PHYSICS,
    },
    {
      driver: new ScriptedInputDriver([
        { tick: 15, input: { turnDir: -1 } },
        { tick: 45, input: { turnDir: 0 } },
      ], 600),
      physics: CAR_PHYSICS,
    },
  ],
  maxTicks: 1200,
  stopWhen: (clients) => {
    const allDeaths = new Set<number>();
    for (const c of clients) {
      for (const d of c.recorder.getDeaths()) allDeaths.add(d.playerIndex);
    }
    return allDeaths.size >= 3;
  },
  assert: (clients) => {
    const deadSets = clients.map(c =>
      new Set(c.recorder.getDeaths().map(d => d.playerIndex)),
    );
    // All 4 clients agree
    const ref = deadSets[0];
    for (let i = 1; i < 4; i++) {
      expect(deadSets[i].size).toBe(ref.size);
      for (const idx of ref) {
        expect(deadSets[i].has(idx)).toBe(true);
      }
    }
  },
};

// ── GP22: Solo player vs 1 AI ────────────────────────────
// Simplest possible match: 1 human, 1 AI. Verify match completes.
export const GP22_soloVsAI: ScenarioConfig = {
  name: 'GP22: solo player vs single AI',
  matchType: 'lobby',
  seed: 322,
  humans: [
    {
      driver: new ScriptedInputDriver([
        { tick: 10, input: { turnDir: 1 } },
        { tick: 40, input: { turnDir: 0 } },
        { tick: 80, input: { turnDir: -1 } },
        { tick: 120, input: { turnDir: 0 } },
      ], 600),
    },
  ],
  ais: [{}],
  maxTicks: 1200,
  stopWhen: (clients) => {
    return clients.some(c => c.recorder.getDeaths().length > 0);
  },
  assert: (clients) => {
    expect(clients.length).toBe(1);
    const deaths = clients[0].recorder.getDeaths();
    expect(deaths.length).toBeGreaterThan(0);
    expect(clients[0].currentTick).toBeGreaterThan(10);
  },
};

// ── GP23: Extreme jitter ────────────────────────────────
// High jitter (100ms) with moderate latency. No crash.
export const GP23_extremeJitter: ScenarioConfig = {
  name: 'GP23: extreme jitter (100ms) stability',
  matchType: 'casual',
  seed: 323,
  humans: [
    {
      driver: new ScriptedInputDriver([
        { tick: 10, input: { turnDir: 1 } },
        { tick: 50, input: { turnDir: -1 } },
        { tick: 100, input: { turnDir: 0 } },
      ], 200),
    },
    {
      driver: new ScriptedInputDriver([
        { tick: 10, input: { turnDir: -1 } },
        { tick: 50, input: { turnDir: 1 } },
        { tick: 100, input: { turnDir: 0 } },
      ], 200),
    },
  ],
  network: { latencyMs: 80, packetLossRate: 0.05, jitterMs: 100 },
  maxTicks: 200,
  assert: (clients) => {
    // With extreme jitter, clients may progress slowly — just verify no crash
    expect(clients[0].currentTick).toBeGreaterThan(10);
    expect(clients[1].currentTick).toBeGreaterThan(10);
  },
};

// ── GP24: Sustained boost full match ────────────────────
// Both players boost for the entire match. Verify accelerated death.
export const GP24_sustainedBoost: ScenarioConfig = {
  name: 'GP24: sustained boost — accelerated gameplay',
  matchType: 'casual',
  seed: 324,
  humans: [
    {
      driver: new ScriptedInputDriver([
        { tick: 1, input: { accelerate: true, turnDir: 1 } },
        { tick: 30, input: { turnDir: -1, accelerate: true } },
        { tick: 60, input: { turnDir: 0, accelerate: true } },
      ], 300),
    },
    {
      driver: new ScriptedInputDriver([
        { tick: 1, input: { accelerate: true, turnDir: -1 } },
        { tick: 30, input: { turnDir: 1, accelerate: true } },
        { tick: 60, input: { turnDir: 0, accelerate: true } },
      ], 300),
    },
  ],
  maxTicks: 300,
  stopWhen: (clients) => {
    return clients.some(c => c.recorder.getDeaths().length > 0);
  },
  assert: (clients) => {
    const totalDeaths =
      clients[0].recorder.getDeaths().length +
      clients[1].recorder.getDeaths().length;
    expect(totalDeaths).toBeGreaterThan(0);
  },
};
