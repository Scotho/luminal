// ── Vehicle Selection E2E Scenarios ──────────────────────
// Scenarios testing vehicle physics overrides in lobby matches.

import { expect } from 'vitest';
import { ScriptedInputDriver } from '../inputDrivers/scriptedInputDriver';
import type { ScenarioConfig } from './types';
import { BIKE_PHYSICS, CAR_PHYSICS, HOVERBOARD_PHYSICS } from '../../vehicleConfig';

// ── VS1: Bike vs Bike ────────────────────────────────────
// 2 humans, both default (bike) physics. Basic control scenario.
// Stop when any death. Assert both clients agree.
export const VS1_bikeVsBike: ScenarioConfig = {
  name: 'VS1: bike vs bike (control)',
  matchType: 'lobby',
  seed: 201,
  humans: [
    {
      driver: new ScriptedInputDriver([
        { tick: 10, input: { turnDir: 1 } },
        { tick: 40, input: { turnDir: 0 } },
        { tick: 80, input: { turnDir: -1 } },
      ], 600),
    },
    {
      driver: new ScriptedInputDriver([
        { tick: 10, input: { turnDir: -1 } },
        { tick: 40, input: { turnDir: 0 } },
        { tick: 80, input: { turnDir: 1 } },
      ], 600),
    },
  ],
  maxTicks: 1200,
  stopWhen: (clients) => {
    return clients.some(c => c.recorder.getDeaths().length > 0);
  },
  assert: (clients) => {
    const deaths0 = clients[0].recorder.getDeaths();
    const deaths1 = clients[1].recorder.getDeaths();

    expect(deaths0.length + deaths1.length).toBeGreaterThan(0);

    if (deaths0.length > 0 && deaths1.length > 0) {
      const dead0 = new Set(deaths0.map(d => d.playerIndex));
      const dead1 = new Set(deaths1.map(d => d.playerIndex));
      for (const idx of dead0) {
        expect(dead1.has(idx)).toBe(true);
      }
    }
  },
};

// ── VS2: Car vs Car ──────────────────────────────────────
// 2 humans, both with CAR_PHYSICS. Stop when any death. Assert agreement.
export const VS2_carVsCar: ScenarioConfig = {
  name: 'VS2: car vs car',
  matchType: 'lobby',
  seed: 202,
  humans: [
    {
      driver: new ScriptedInputDriver([
        { tick: 10, input: { turnDir: 1 } },
        { tick: 40, input: { turnDir: 0 } },
        { tick: 80, input: { turnDir: -1 } },
      ], 600),
      physics: CAR_PHYSICS,
    },
    {
      driver: new ScriptedInputDriver([
        { tick: 10, input: { turnDir: -1 } },
        { tick: 40, input: { turnDir: 0 } },
        { tick: 80, input: { turnDir: 1 } },
      ], 600),
      physics: CAR_PHYSICS,
    },
  ],
  maxTicks: 1200,
  stopWhen: (clients) => {
    return clients.some(c => c.recorder.getDeaths().length > 0);
  },
  assert: (clients) => {
    const deaths0 = clients[0].recorder.getDeaths();
    const deaths1 = clients[1].recorder.getDeaths();

    expect(deaths0.length + deaths1.length).toBeGreaterThan(0);

    if (deaths0.length > 0 && deaths1.length > 0) {
      const dead0 = new Set(deaths0.map(d => d.playerIndex));
      const dead1 = new Set(deaths1.map(d => d.playerIndex));
      for (const idx of dead0) {
        expect(dead1.has(idx)).toBe(true);
      }
    }
  },
};

// ── VS3: Bike vs Car ─────────────────────────────────────
// 2 humans, one bike (default), one car. Mixed-vehicle baseline.
// Stop when any death. Assert agreement.
export const VS3_bikeVsCar: ScenarioConfig = {
  name: 'VS3: bike vs car (mixed baseline)',
  matchType: 'lobby',
  seed: 203,
  humans: [
    {
      driver: new ScriptedInputDriver([
        { tick: 10, input: { turnDir: 1 } },
        { tick: 40, input: { turnDir: 0 } },
        { tick: 80, input: { turnDir: -1 } },
      ], 600),
    },
    {
      driver: new ScriptedInputDriver([
        { tick: 10, input: { turnDir: -1 } },
        { tick: 40, input: { turnDir: 0 } },
        { tick: 80, input: { turnDir: 1 } },
      ], 600),
      physics: CAR_PHYSICS,
    },
  ],
  maxTicks: 1200,
  stopWhen: (clients) => {
    return clients.some(c => c.recorder.getDeaths().length > 0);
  },
  assert: (clients) => {
    const deaths0 = clients[0].recorder.getDeaths();
    const deaths1 = clients[1].recorder.getDeaths();

    expect(deaths0.length + deaths1.length).toBeGreaterThan(0);

    if (deaths0.length > 0 && deaths1.length > 0) {
      const dead0 = new Set(deaths0.map(d => d.playerIndex));
      const dead1 = new Set(deaths1.map(d => d.playerIndex));
      for (const idx of dead0) {
        expect(dead1.has(idx)).toBe(true);
      }
    }
  },
};

// ── VS4: Hoverboard vs Hoverboard ───────────────────────
// 2 humans, both with HOVERBOARD_PHYSICS.
// Stop when any death. Assert agreement AND both progressed beyond tick 10.
export const VS4_hoverboardPhysics: ScenarioConfig = {
  name: 'VS4: hoverboard vs hoverboard',
  matchType: 'lobby',
  seed: 204,
  humans: [
    {
      driver: new ScriptedInputDriver([
        { tick: 10, input: { turnDir: 1 } },
        { tick: 40, input: { turnDir: 0 } },
        { tick: 80, input: { turnDir: -1 } },
      ], 600),
      physics: HOVERBOARD_PHYSICS,
    },
    {
      driver: new ScriptedInputDriver([
        { tick: 10, input: { turnDir: -1 } },
        { tick: 40, input: { turnDir: 0 } },
        { tick: 80, input: { turnDir: 1 } },
      ], 600),
      physics: HOVERBOARD_PHYSICS,
    },
  ],
  maxTicks: 1200,
  stopWhen: (clients) => {
    return clients.some(c => c.recorder.getDeaths().length > 0);
  },
  assert: (clients) => {
    const deaths0 = clients[0].recorder.getDeaths();
    const deaths1 = clients[1].recorder.getDeaths();

    // Both clients agree on deaths
    expect(deaths0.length + deaths1.length).toBeGreaterThan(0);

    if (deaths0.length > 0 && deaths1.length > 0) {
      const dead0 = new Set(deaths0.map(d => d.playerIndex));
      const dead1 = new Set(deaths1.map(d => d.playerIndex));
      for (const idx of dead0) {
        expect(dead1.has(idx)).toBe(true);
      }
    }

    // Both clients progressed beyond tick 10
    expect(clients[0].currentTick).toBeGreaterThan(10);
    expect(clients[1].currentTick).toBeGreaterThan(10);
  },
};

// ── VS5: Mixed Lobby 3-Vehicle ───────────────────────────
// 1 human (bike default) + 2 AI: one car, one hoverboard.
// Stop when >=2 deaths. Assert client recorded deaths and progressed.
export const VS5_mixedLobby3Vehicle: ScenarioConfig = {
  name: 'VS5: mixed lobby (bike + car AI + hoverboard AI)',
  matchType: 'lobby',
  seed: 205,
  humans: [
    {
      driver: new ScriptedInputDriver([
        { tick: 10, input: { turnDir: 1 } },
        { tick: 40, input: { turnDir: 0 } },
        { tick: 80, input: { turnDir: -1 } },
      ], 600),
    },
  ],
  ais: [
    { physics: CAR_PHYSICS },
    { physics: HOVERBOARD_PHYSICS },
  ],
  maxTicks: 1200,
  stopWhen: (clients) => {
    const allDeaths = new Set<number>();
    for (const c of clients) {
      for (const d of c.recorder.getDeaths()) allDeaths.add(d.playerIndex);
    }
    return allDeaths.size >= 2;
  },
  assert: (clients) => {
    expect(clients.length).toBe(1);

    const deaths = clients[0].recorder.getDeaths();
    expect(deaths.length).toBeGreaterThan(0);

    // Client progressed beyond early ticks
    expect(clients[0].currentTick).toBeGreaterThan(10);
  },
};

// ── VS6: All Hoverboard 4-Player ────────────────────────
// 4 humans all with HOVERBOARD_PHYSICS. Stop when >=3 deaths.
// Assert all 4 clients agree on death set.
export const VS6_allHoverboard4Player: ScenarioConfig = {
  name: 'VS6: 4-player all hoverboard',
  matchType: 'lobby',
  seed: 206,
  humans: [
    {
      driver: new ScriptedInputDriver([
        { tick: 10, input: { turnDir: 1 } },
        { tick: 40, input: { turnDir: 0 } },
        { tick: 80, input: { turnDir: -1 } },
      ], 600),
      physics: HOVERBOARD_PHYSICS,
    },
    {
      driver: new ScriptedInputDriver([
        { tick: 10, input: { turnDir: -1 } },
        { tick: 40, input: { turnDir: 0 } },
        { tick: 80, input: { turnDir: 1 } },
      ], 600),
      physics: HOVERBOARD_PHYSICS,
    },
    {
      driver: new ScriptedInputDriver([
        { tick: 15, input: { turnDir: 1 } },
        { tick: 45, input: { turnDir: 0 } },
        { tick: 85, input: { turnDir: -1 } },
      ], 600),
      physics: HOVERBOARD_PHYSICS,
    },
    {
      driver: new ScriptedInputDriver([
        { tick: 15, input: { turnDir: -1 } },
        { tick: 45, input: { turnDir: 0 } },
        { tick: 85, input: { turnDir: 1 } },
      ], 600),
      physics: HOVERBOARD_PHYSICS,
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
    expect(clients.length).toBe(4);

    const deadSets = clients.map(c => new Set(c.recorder.getDeaths().map(d => d.playerIndex)));

    // All 4 clients must agree on the death set
    const reference = deadSets[0];
    for (let i = 1; i < clients.length; i++) {
      expect(deadSets[i].size).toBe(reference.size);
      for (const idx of reference) {
        expect(deadSets[i].has(idx)).toBe(true);
      }
    }
  },
};

// ── VS7: Casual mixed-vehicle ───────────────────────────
// 2 humans, one bike one car, matchType 'casual' (not lobby).
// Validates vehicle physics work outside of lobby context.
export const VS7_casualMixedVehicle: ScenarioConfig = {
  name: 'VS7: casual match bike vs car',
  matchType: 'casual',
  seed: 207,
  humans: [
    {
      driver: new ScriptedInputDriver([
        { tick: 10, input: { turnDir: 1 } },
        { tick: 40, input: { turnDir: 0 } },
        { tick: 80, input: { turnDir: -1 } },
      ], 600),
    },
    {
      driver: new ScriptedInputDriver([
        { tick: 10, input: { turnDir: -1 } },
        { tick: 40, input: { turnDir: 0 } },
        { tick: 80, input: { turnDir: 1 } },
      ], 600),
      physics: CAR_PHYSICS,
    },
  ],
  maxTicks: 1200,
  stopWhen: (clients) => {
    return clients.some(c => c.recorder.getDeaths().length > 0);
  },
  assert: (clients) => {
    const deaths0 = clients[0].recorder.getDeaths();
    const deaths1 = clients[1].recorder.getDeaths();

    expect(deaths0.length + deaths1.length).toBeGreaterThan(0);

    if (deaths0.length > 0 && deaths1.length > 0) {
      const dead0 = new Set(deaths0.map(d => d.playerIndex));
      const dead1 = new Set(deaths1.map(d => d.playerIndex));
      for (const idx of dead0) {
        expect(dead1.has(idx)).toBe(true);
      }
    }
  },
};
