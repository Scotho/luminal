// ── Lobby Match E2E Scenarios ─────────────────────────────
// Scenarios with mixed human + AI counts using LoopbackTransport.

import { expect } from 'vitest';
import { ScriptedInputDriver } from '../inputDrivers/scriptedInputDriver';
import type { ScenarioConfig } from './types';

// ── L1: 2H + 1AI ─────────────────────────────────────────
// 2 human clients with scripted turns, 1 AI (goes straight).
// Stop when any death is recorded. Assert both clients agree on who died.
export const L1_2h1ai: ScenarioConfig = {
  name: 'L1: 2H + 1AI basic mixed lobby',
  matchType: 'lobby',
  seed: 42,
  humans: [
    {
      driver: new ScriptedInputDriver([
        { tick: 10, input: { turnDir: 1 } },
        { tick: 40, input: { turnDir: 0 } },
      ], 600),
    },
    {
      driver: new ScriptedInputDriver([
        { tick: 10, input: { turnDir: -1 } },
        { tick: 40, input: { turnDir: 0 } },
      ], 600),
    },
  ],
  ais: [{}],
  maxTicks: 1200,
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
    }
  },
};

// ── L2: 2H + 2AI ─────────────────────────────────────────
// 2 humans with scripted turns, 2 AI. Stop when ≥3 of 4 players dead.
// Assert both clients agree on the set of dead players.
export const L2_2h2ai: ScenarioConfig = {
  name: 'L2: 2H + 2AI common 4-player party',
  matchType: 'lobby',
  seed: 77,
  humans: [
    {
      driver: new ScriptedInputDriver([
        { tick: 10, input: { turnDir: 1 } },
        { tick: 40, input: { turnDir: 0 } },
        { tick: 80, input: { turnDir: -1 } },
        { tick: 110, input: { turnDir: 0 } },
      ], 600),
    },
    {
      driver: new ScriptedInputDriver([
        { tick: 10, input: { turnDir: -1 } },
        { tick: 40, input: { turnDir: 0 } },
        { tick: 80, input: { turnDir: 1 } },
        { tick: 110, input: { turnDir: 0 } },
      ], 600),
    },
  ],
  ais: [{}, {}],
  maxTicks: 1200,
  stopWhen: (clients) => {
    const allDeaths = new Set<number>();
    for (const c of clients) {
      for (const d of c.recorder.getDeaths()) allDeaths.add(d.playerIndex);
    }
    return allDeaths.size >= 3;
  },
  assert: (clients) => {
    const dead0 = new Set(clients[0].recorder.getDeaths().map(d => d.playerIndex));
    const dead1 = new Set(clients[1].recorder.getDeaths().map(d => d.playerIndex));

    // Both clients must agree on dead players
    expect(dead0.size).toBe(dead1.size);
    for (const idx of dead0) {
      expect(dead1.has(idx)).toBe(true);
    }
  },
};

// ── L3: 1H + 3AI ─────────────────────────────────────────
// 1 human, 3 AI. Only 1 HeadlessClient (no network needed since solo).
// Stop when any death. Assert deaths were recorded and client progressed.
export const L3_1h3ai: ScenarioConfig = {
  name: 'L3: 1H + 3AI solo with bots',
  matchType: 'lobby',
  seed: 99,
  humans: [
    {
      driver: new ScriptedInputDriver([
        { tick: 10, input: { turnDir: 1 } },
        { tick: 40, input: { turnDir: 0 } },
      ], 600),
    },
  ],
  ais: [{}, {}, {}],
  maxTicks: 1200,
  stopWhen: (clients) => {
    return clients.some(c => c.recorder.getDeaths().length > 0);
  },
  assert: (clients) => {
    // Only 1 client in this scenario
    expect(clients.length).toBe(1);

    const deaths = clients[0].recorder.getDeaths();
    expect(deaths.length).toBeGreaterThan(0);

    // Client progressed beyond the first few ticks
    expect(clients[0].currentTick).toBeGreaterThan(10);
  },
};

// ── L5: 4H + 0AI ─────────────────────────────────────────
// 4 human clients with scripted turns. Stop when ≥3 dead.
// Assert ALL 4 clients agree on the death set.
export const L5_4h0ai: ScenarioConfig = {
  name: 'L5: 4H full human lobby',
  matchType: 'lobby',
  seed: 55,
  humans: [
    {
      driver: new ScriptedInputDriver([
        { tick: 10, input: { turnDir: 1 } },
        { tick: 40, input: { turnDir: 0 } },
        { tick: 80, input: { turnDir: -1 } },
        { tick: 110, input: { turnDir: 0 } },
      ], 600),
    },
    {
      driver: new ScriptedInputDriver([
        { tick: 10, input: { turnDir: -1 } },
        { tick: 40, input: { turnDir: 0 } },
        { tick: 80, input: { turnDir: 1 } },
        { tick: 110, input: { turnDir: 0 } },
      ], 600),
    },
    {
      driver: new ScriptedInputDriver([
        { tick: 15, input: { turnDir: 1 } },
        { tick: 45, input: { turnDir: 0 } },
        { tick: 85, input: { turnDir: -1 } },
        { tick: 115, input: { turnDir: 0 } },
      ], 600),
    },
    {
      driver: new ScriptedInputDriver([
        { tick: 15, input: { turnDir: -1 } },
        { tick: 45, input: { turnDir: 0 } },
        { tick: 85, input: { turnDir: 1 } },
        { tick: 115, input: { turnDir: 0 } },
      ], 600),
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

    // Each client that recorded deaths must agree with client 0
    const reference = deadSets[0];
    for (let i = 1; i < clients.length; i++) {
      expect(deadSets[i].size).toBe(reference.size);
      for (const idx of reference) {
        expect(deadSets[i].has(idx)).toBe(true);
      }
    }
  },
};

// ── L6: Lobby disconnect ──────────────────────────────────
// 3 humans + 1 AI. At tick 80, clients[2].stop().
// Run to tick 300. Assert at least one remaining client detected disconnect.
export const L6_lobbyDisconnect: ScenarioConfig = {
  name: 'L6: lobby disconnect',
  matchType: 'lobby',
  seed: 42,
  humans: [
    { driver: new ScriptedInputDriver([], 400) },
    { driver: new ScriptedInputDriver([], 400) },
    { driver: new ScriptedInputDriver([], 400) },
  ],
  ais: [{}],
  maxTicks: 300,
  stopWhen: (clients, tick) => {
    if (tick === 80) {
      clients[2].stop();
    }
    const remaining = clients.slice(0, 2);
    return remaining.some(c => c.isDisconnected) || tick >= 299;
  },
  assert: (clients) => {
    // At least one of the remaining clients (0 or 1) detected the disconnect
    const remaining = clients.slice(0, 2);
    expect(remaining.some(c => c.isDisconnected)).toBe(true);
  },
};

// ── L9: Mixed death order ─────────────────────────────────
// 2 humans + 2 AI. Stop when ≥2 deaths. Assert both clients recorded same
// number of deaths with same player indices.
export const L9_mixedDeathOrder: ScenarioConfig = {
  name: 'L9: mixed death ordering',
  matchType: 'lobby',
  seed: 42,
  humans: [
    {
      driver: new ScriptedInputDriver([
        { tick: 10, input: { turnDir: 1 } },
        { tick: 40, input: { turnDir: 0 } },
      ], 600),
    },
    {
      driver: new ScriptedInputDriver([
        { tick: 10, input: { turnDir: -1 } },
        { tick: 40, input: { turnDir: 0 } },
      ], 600),
    },
  ],
  ais: [{}, {}],
  maxTicks: 1200,
  stopWhen: (clients) => {
    const allDeaths = new Set<number>();
    for (const c of clients) {
      for (const d of c.recorder.getDeaths()) allDeaths.add(d.playerIndex);
    }
    return allDeaths.size >= 2;
  },
  assert: (clients) => {
    const deaths0 = clients[0].recorder.getDeaths();
    const deaths1 = clients[1].recorder.getDeaths();

    // Both clients must have recorded deaths
    expect(deaths0.length).toBeGreaterThan(0);
    expect(deaths1.length).toBeGreaterThan(0);

    // Both clients must agree on the count and set of dead players
    expect(deaths0.length).toBe(deaths1.length);
    const dead0 = new Set(deaths0.map(d => d.playerIndex));
    const dead1 = new Set(deaths1.map(d => d.playerIndex));
    for (const idx of dead0) {
      expect(dead1.has(idx)).toBe(true);
    }
  },
};
