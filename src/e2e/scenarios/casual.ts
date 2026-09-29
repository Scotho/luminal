// ── Casual Match E2E Scenarios ────────────────────────────
// All scenarios: 2 humans, 0 AI, best-of-3 format.
// Run via LoopbackTransport (no real network).

import { expect } from 'vitest';
import { ScriptedInputDriver } from '../inputDrivers/scriptedInputDriver';
import type { ScenarioConfig } from './types';

// ── C1: Full casual round ─────────────────────────────────
// Both players go straight into the arena wall.
// ARENA_HALF=192, baseSpeed=40 → takes ~288 ticks (192/40 * 60) in the worst case.
// Spawns are at 42-75% of half-arena from centre, so closer to 80-140 units from edge.
// With seed 1, player 0 is expected to hit the wall first.
// Stop as soon as any death is recorded; assert both clients agree on who died.
export const C1_fullCasualRound: ScenarioConfig = {
  name: 'C1: full casual round',
  matchType: 'casual',
  seed: 1,
  humans: [
    { driver: new ScriptedInputDriver([]) },  // straight, no turns
    { driver: new ScriptedInputDriver([]) },  // straight, no turns
  ],
  maxTicks: 600,
  stopWhen: (clients) => {
    return clients.some(c => c.recorder.getDeaths().length > 0);
  },
  assert: (clients) => {
    const deaths0 = clients[0].recorder.getDeaths();
    const deaths1 = clients[1].recorder.getDeaths();

    // At least one client recorded a death
    expect(deaths0.length + deaths1.length).toBeGreaterThan(0);

    // If both recorded deaths, they must agree on who died
    if (deaths0.length > 0 && deaths1.length > 0) {
      const dead0 = new Set(deaths0.map(d => d.playerIndex));
      const dead1 = new Set(deaths1.map(d => d.playerIndex));
      for (const idx of dead0) {
        expect(dead1.has(idx)).toBe(true);
      }
      // Death ticks should be within 3 of each other
      const tick0 = deaths0[0].tick;
      const tick1 = deaths1[0].tick;
      expect(Math.abs(tick0 - tick1)).toBeLessThanOrEqual(3);
    }
  },
};

// ── C2: Casual disconnect ─────────────────────────────────
// Player 1 disconnects at tick 80. Assert P0 detects the disconnect.
export const C2_casualDisconnect: ScenarioConfig = {
  name: 'C2: casual disconnect',
  matchType: 'casual',
  seed: 42,
  humans: [
    { driver: new ScriptedInputDriver([], 400) },  // keep P0 alive, long hold
    { driver: new ScriptedInputDriver([], 400) },
  ],
  maxTicks: 300,
  stopWhen: (clients, tick) => {
    if (tick === 80) {
      clients[1].stop();
    }
    return clients[0].isDisconnected || tick >= 299;
  },
  assert: (clients) => {
    expect(clients[0].isDisconnected).toBe(true);
  },
};

// ── C3: Simultaneous death ────────────────────────────────
// Seed chosen so both players spawn facing each other approximately.
// Both go straight. Both should die (trail collision or wall). Assert both
// clients agree on the set of dead player indices.
export const C3_simultaneousDeath: ScenarioConfig = {
  name: 'C3: simultaneous death',
  matchType: 'casual',
  seed: 7,
  humans: [
    { driver: new ScriptedInputDriver([]) },
    { driver: new ScriptedInputDriver([]) },
  ],
  maxTicks: 600,
  stopWhen: (clients) => {
    return clients.some(c => c.recorder.getDeaths().length > 0);
  },
  assert: (clients) => {
    const deaths0 = clients[0].recorder.getDeaths();
    const deaths1 = clients[1].recorder.getDeaths();

    // Both clients must have recorded at least one death
    expect(deaths0.length).toBeGreaterThan(0);
    expect(deaths1.length).toBeGreaterThan(0);

    // Both clients must agree on which players died
    const dead0 = new Set(deaths0.map(d => d.playerIndex));
    const dead1 = new Set(deaths1.map(d => d.playerIndex));
    expect(dead0.size).toBe(dead1.size);
    for (const idx of dead0) {
      expect(dead1.has(idx)).toBe(true);
    }
  },
};

// ── C4: Input loss burst ──────────────────────────────────
// 30% packet loss. Both players do scripted turns to generate trail.
// Assert both clients progressed past tick 100 and share some common hash ticks.
export const C4_inputLossBurst: ScenarioConfig = {
  name: 'C4: input loss burst',
  matchType: 'casual',
  seed: 3,
  humans: [
    {
      driver: new ScriptedInputDriver([
        { tick: 1,   input: { turnDir: 1 } },
        { tick: 50,  input: { turnDir: -1 } },
        { tick: 100, input: { turnDir: 1 } },
        { tick: 150, input: { turnDir: -1 } },
        { tick: 200, input: { turnDir: 0 } },
      ], 100),
    },
    {
      driver: new ScriptedInputDriver([
        { tick: 1,   input: { turnDir: -1 } },
        { tick: 50,  input: { turnDir: 1 } },
        { tick: 100, input: { turnDir: -1 } },
        { tick: 150, input: { turnDir: 1 } },
        { tick: 200, input: { turnDir: 0 } },
      ], 100),
    },
  ],
  network: { latencyMs: 0, packetLossRate: 0.3 },
  maxTicks: 300,
  assert: (clients) => {
    // Both clients progressed past tick 100
    expect(clients[0].currentTick).toBeGreaterThan(100);
    expect(clients[1].currentTick).toBeGreaterThan(100);

    // Both clients recorded some hashes
    const hashes0 = clients[0].recorder.getHashes();
    const hashes1 = clients[1].recorder.getHashes();
    expect(hashes0.length).toBeGreaterThan(0);
    expect(hashes1.length).toBeGreaterThan(0);

    // Find common hash ticks
    const ticks0 = new Set(hashes0.map(h => h.tick));
    const ticks1 = new Set(hashes1.map(h => h.tick));
    const commonTicks = [...ticks0].filter(t => ticks1.has(t));
    expect(commonTicks.length).toBeGreaterThan(0);
  },
};

// ── C5: Rollback stress ───────────────────────────────────
// 150ms one-way latency. Both players do scripted turns.
// Assert both clients progressed past tick 100 and tick counts are within 20 of each other.
export const C5_rollbackStress: ScenarioConfig = {
  name: 'C5: rollback stress',
  matchType: 'casual',
  seed: 5,
  humans: [
    {
      driver: new ScriptedInputDriver([
        { tick: 1,   input: { turnDir: 1 } },
        { tick: 60,  input: { turnDir: -1 } },
        { tick: 120, input: { turnDir: 1 } },
        { tick: 180, input: { turnDir: 0 } },
      ], 120),
    },
    {
      driver: new ScriptedInputDriver([
        { tick: 1,   input: { turnDir: -1 } },
        { tick: 60,  input: { turnDir: 1 } },
        { tick: 120, input: { turnDir: -1 } },
        { tick: 180, input: { turnDir: 0 } },
      ], 120),
    },
  ],
  network: { latencyMs: 150, packetLossRate: 0 },
  maxTicks: 300,
  assert: (clients) => {
    // Both clients progressed past tick 100
    expect(clients[0].currentTick).toBeGreaterThan(100);
    expect(clients[1].currentTick).toBeGreaterThan(100);

    // Tick counts are within 20 of each other
    const tickDiff = Math.abs(clients[0].currentTick - clients[1].currentTick);
    expect(tickDiff).toBeLessThanOrEqual(20);
  },
};
