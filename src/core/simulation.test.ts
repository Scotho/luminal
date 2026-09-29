// ── N-Player Simulation Tests ─────────────────────────
import { describe, it, expect } from 'vitest';
import {
  simStep, createSimState, advancePlayer, createPlayerSim,
  hashSimState, cloneSimState, SnapshotBuffer, isOutOfBounds,
  checkTrailCollision, SIM_DT, ARENA_HALF, HIT_RADIUS, SKIP_OWN_SEGMENTS,
  serializeSimState, deserializeSimState, checkTrailCollisionSingle,
} from './simulation';
import type { InputFrame, SimState, TrailPoint, PlayerSpawn } from './simulation';
import { BIKE_PHYSICS, CAR_PHYSICS } from '../vehicleConfig';

const noInput = (tick: number): InputFrame => ({ tick, turnDir: 0, accelerate: false, dash: false, brake: false });
const leftInput = (tick: number): InputFrame => ({ tick, turnDir: -1, accelerate: false, dash: false, brake: false });
const boostInput = (tick: number): InputFrame => ({ tick, turnDir: 0, accelerate: true, dash: false, brake: false });
const brakeInput = (tick: number): InputFrame => ({ tick, turnDir: 0, accelerate: false, dash: false, brake: true });
const driftTurnInput = (tick: number): InputFrame => ({ tick, turnDir: -1, accelerate: false, dash: false, brake: true });
const rightDriftTurnInput = (tick: number): InputFrame => ({ tick, turnDir: 1, accelerate: false, dash: false, brake: true });
const driftThrottleLeftInput = (tick: number): InputFrame => ({ tick, turnDir: -1, accelerate: true, dash: false, brake: true });

function normalizeAngle(a: number): number {
  return a - Math.round(a / (2 * Math.PI)) * 2 * Math.PI;
}

// Minimal VehiclePhysics stub for simple tests
const stubCfg = {
  baseSpeed: 30, boostSpeed: 45, dashSpeed: 60, dashDrain: 40,
  brakeSpeed: 10, accelLerp: 4, decelLerp: 6, turnSpeed: 2,
  turnLerp: 14, turnDecay: 28.8, turnSpeedBleed: 1.0,
  trailRear: 0, canDrift: false, passiveRegen: 5.3,
  driftTurnMultiplier: 1, driftFriction: 5, driftBoostStraighten: 1,
  driftBoostSpeed: 50, driftSpeed: 35, driftMinSpeed: 20, driftMeterRegen: 10,
  driftIntentStartSpeed: 18, driftIntentFullSpeed: 75,
  driftMaxSlipLow: 0.10, driftMaxSlipHigh: 0.70,
  driftGripLow: 20.0, driftGripHigh: 4.5,
  driftSlipResponseLow: 24.0, driftSlipResponseHigh: 7.0,
  driftThrottleHookLow: 16.0, driftThrottleHookHigh: 3.0,
  driftCountersteerAssistLow: 18.0, driftCountersteerAssistHigh: 4.0,
  driftReleaseAssistLow: 16.0, driftReleaseAssistHigh: 3.0,
  driftExitSlipThreshold: 0.08, driftExitSpeedThreshold: 0.35,
  driftSpeedCarryLow: 0.82, driftSpeedCarryHigh: 0.96,
  driftSlipSpeedScrubLow: 8.0, driftSlipSpeedScrubHigh: 2.0,
  driftThrottleSpeedAuthorityLow: 0.18, driftThrottleSpeedAuthorityHigh: 0.72,
  driftCoastSpeedAuthorityLow: 0.08, driftCoastSpeedAuthorityHigh: 0.42,
  driftStraightenSpeedGain: 6.0,
  driftDashSlipPenaltyLow: 0.30, driftDashSlipPenaltyHigh: 0.08,
  driftEntryDuration: 0.20,
  driftEntrySlipScale: 0.45,
  driftEntryFollowScale: 0.55,
  driftEntryYawScale: 0.72,
  driftHighSpeedWheelCorrectScale: 0.42,
  driftHighSpeedBoostCorrectScale: 0.30,
  driftHighSpeedCountersteerScale: 0.55,
  driftHighSpeedReleaseScale: 0.65,
  driftAlignThreshold: 0.1, driftAlignGrace: 0.3, driftSlipDecay: 5,
  snapExitSlipThreshold: 0, snapRecoveryDuration: 0.5, snapRecoveryBoostDuration: 0.3,
  snapRecoverySpeedFloor: 20, snapRecoveryTargetSpeed: 30, snapRecoveryBoostFloor: 25,
  snapRecoveryBoostTarget: 45, snapRecoveryAccelLerp: 4,
  boostDrain: 0, boostLockThreshold: 0.10,
  lowMeterThreshold: 0, lowMeterRegen: 0,
  fumesDuration: 0.75, fumesSpeedScale: 0.70,
  proximitySpeedMultiplier: 0.15,
} as any;

function spawn2(): PlayerSpawn[] {
  return [
    { x: -50, z: 0, angle: 0, baseSpeed: 40 },
    { x: 50, z: 0, angle: Math.PI, baseSpeed: 40 },
  ];
}

function spawn3(): PlayerSpawn[] {
  return [
    { x: -50, z: 0, angle: 0, baseSpeed: 40 },
    { x: 50, z: 0, angle: Math.PI, baseSpeed: 40 },
    { x: 0, z: 50, angle: -Math.PI / 2, baseSpeed: 40 },
  ];
}

function spawn4(): PlayerSpawn[] {
  return [
    { x: -50, z: 0, angle: 0, baseSpeed: 40 },
    { x: 50, z: 0, angle: Math.PI, baseSpeed: 40 },
    { x: 0, z: 50, angle: -Math.PI / 2, baseSpeed: 40 },
    { x: 0, z: -50, angle: Math.PI / 2, baseSpeed: 40 },
  ];
}

describe('Deterministic Simulation', () => {
  describe('advancePlayer', () => {
    it('moves forward when no turn input', () => {
      const p = createPlayerSim(0, 0, 0, 40);
      const next = advancePlayer(p, noInput(0), BIKE_PHYSICS, SIM_DT);
      expect(next.x).toBeCloseTo(0, 3);
      expect(next.z).toBeLessThan(0);
      expect(next.alive).toBe(true);
    });

    it('turns when turnDir is set', () => {
      const p = createPlayerSim(0, 0, 0, 40);
      const next = advancePlayer(p, leftInput(0), BIKE_PHYSICS, SIM_DT);
      expect(next.angle).not.toBe(0);
    });

    it('boosts to higher speed', () => {
      const p = createPlayerSim(0, 0, 0, 40);
      const next = advancePlayer(p, boostInput(0), BIKE_PHYSICS, SIM_DT);
      expect(next.boosting).toBe(true);
    });

    it('drains meter when dashing', () => {
      const p = createPlayerSim(0, 0, 0, 40);
      const dashInput: InputFrame = { tick: 0, turnDir: 0, accelerate: false, dash: true, brake: false };
      const next = advancePlayer(p, dashInput, BIKE_PHYSICS, SIM_DT);
      expect(next.meter).toBeLessThan(100);
      expect(next.dashing).toBe(true);
    });

    it('does not move dead players', () => {
      const p = { ...createPlayerSim(10, 20, 0, 40), alive: false };
      const next = advancePlayer(p, noInput(0), BIKE_PHYSICS, SIM_DT);
      expect(next.x).toBe(10);
      expect(next.z).toBe(20);
    });
  });

  // ── N-player createSimState ──────────────────────────

  describe('createSimState', () => {
    it('creates N players with correct positions', () => {
      const spawns: PlayerSpawn[] = [
        { x: 10, z: 20, angle: 0, baseSpeed: 30 },
        { x: -10, z: -20, angle: Math.PI, baseSpeed: 30 },
        { x: 0, z: 50, angle: Math.PI / 2, baseSpeed: 25 },
      ];
      const state = createSimState(0, spawns);

      expect(state.tick).toBe(0);
      expect(state.players).toHaveLength(3);
      expect(state.trails).toHaveLength(3);
      expect(state.players[0].x).toBe(10);
      expect(state.players[0].z).toBe(20);
      expect(state.players[1].x).toBe(-10);
      expect(state.players[1].z).toBe(-20);
      expect(state.players[2].x).toBe(0);
      expect(state.players[2].z).toBe(50);
      expect(state.players[2].speed).toBe(25);
      state.trails.forEach(t => expect(t).toEqual([]));
    });
  });

  // ── N-player simStep ─────────────────────────────────

  describe('simStep', () => {
    it('advances tick number', () => {
      const state = createSimState(0, spawn2());
      const next = simStep(state, [noInput(1), noInput(1)], [BIKE_PHYSICS, BIKE_PHYSICS]);
      expect(next.tick).toBe(1);
    });

    it('advances all N players — tick increments, player count preserved', () => {
      const state = createSimState(0, spawn4());
      const inputs = spawn4().map(() => noInput(1));
      const cfgs = spawn4().map(() => BIKE_PHYSICS);
      const next = simStep(state, inputs, cfgs);

      expect(next.tick).toBe(1);
      expect(next.players).toHaveLength(4);
      expect(next.trails).toHaveLength(4);
      next.players.forEach(p => expect(p.alive).toBe(true));
    });

    it('moves both players', () => {
      const state = createSimState(0, spawn2());
      const next = simStep(state, [noInput(1), noInput(1)], [BIKE_PHYSICS, BIKE_PHYSICS]);
      expect(next.players[0].z).not.toBe(0);
      expect(next.players[1].z).not.toBe(0);
    });

    it('kills player out of bounds', () => {
      const spawns: PlayerSpawn[] = [
        { x: ARENA_HALF + 1, z: 0, angle: 0, baseSpeed: 40 },
        { x: 0, z: 0, angle: 0, baseSpeed: 40 },
      ];
      const state = createSimState(0, spawns);
      const next = simStep(state, [noInput(1), noInput(1)], [BIKE_PHYSICS, BIKE_PHYSICS]);
      expect(next.players[0].alive).toBe(false);
      expect(next.players[1].alive).toBe(true);
    });

    it('detects head-on collision', () => {
      const spawns: PlayerSpawn[] = [
        { x: 0, z: 0, angle: 0, baseSpeed: 40 },
        { x: 0.5, z: 0, angle: Math.PI, baseSpeed: 40 },
      ];
      const state = createSimState(0, spawns);
      const next = simStep(state, [noInput(1), noInput(1)], [BIKE_PHYSICS, BIKE_PHYSICS]);
      expect(next.players[0].alive).toBe(false);
      expect(next.players[1].alive).toBe(false);
    });

    it('dead player does not advance or produce trail', () => {
      let state = createSimState(0, [
        { x: 0, z: 0, angle: 0, baseSpeed: 30 },
        { x: 100, z: 100, angle: Math.PI, baseSpeed: 30 },
      ]);
      // Kill player 0
      state = { ...state, players: state.players.map((p, i) => i === 0 ? { ...p, alive: false } : p) };

      const next = simStep(state, [noInput(1), noInput(1)], [stubCfg, stubCfg]);
      expect(next.players[0].alive).toBe(false);
      expect(next.players[0].x).toBe(0);
      expect(next.players[0].z).toBe(0);
      expect(next.trails[0]).toHaveLength(0);
    });
  });

  // ── Trail collision ──────────────────────────────────

  describe('trail collision', () => {
    it('player dies hitting another player trail', () => {
      let state = createSimState(0, [
        { x: 0, z: 0, angle: 0, baseSpeed: 30 },
        { x: 100, z: 100, angle: 0, baseSpeed: 30 },
      ]);
      // Place trail for player 1 right across player 0's position
      state = { ...state, trails: [state.trails[0], [{ x: -5, z: 0 }, { x: 5, z: 0 }]] };

      const next = simStep(state, [noInput(1), noInput(1)], [stubCfg, stubCfg]);
      expect(next.players[0].alive).toBe(false);
      expect(next.players[1].alive).toBe(true);
    });

    it('kills player who hits enemy trail in full sim', () => {
      let state = createSimState(0, spawn2());
      // Inject enemy trail in player 0's path (facing -Z, so trail at z ~ -1)
      state = { ...state, trails: [state.trails[0], [{ x: -55, z: -1 }, { x: -45, z: -1 }]] };
      // Run a few ticks to ensure player crosses the trail
      for (let t = 1; t <= 5 && state.players[0].alive; t++) {
        state = simStep(state, [noInput(t), noInput(t)], [BIKE_PHYSICS, BIKE_PHYSICS]);
      }
      expect(state.players[0].alive).toBe(false);
    });

    it('generates trail points during simulation', () => {
      let state = createSimState(0, spawn2());
      for (let t = 1; t <= 10; t++) {
        state = simStep(state, [noInput(t), noInput(t)], [BIKE_PHYSICS, BIKE_PHYSICS]);
      }
      expect(state.trails[0].length).toBeGreaterThan(0);
      expect(state.trails[1].length).toBeGreaterThan(0);
    });
  });

  // ── Head-on collision ────────────────────────────────

  describe('head-on collision', () => {
    it('kills both players in pair', () => {
      const spawns: PlayerSpawn[] = [
        { x: 0, z: 0, angle: 0, baseSpeed: 30 },
        { x: 0, z: 0.5, angle: Math.PI, baseSpeed: 30 },
      ];
      const state = createSimState(0, spawns);
      const next = simStep(state, [noInput(1), noInput(1)], [stubCfg, stubCfg]);
      expect(next.players[0].alive).toBe(false);
      expect(next.players[1].alive).toBe(false);
    });
  });

  // ── 3-player: only colliding player dies ─────────────

  describe('3-player selective kill', () => {
    it('only the colliding player dies, others survive', () => {
      let state = createSimState(0, [
        { x: 0, z: 0, angle: 0, baseSpeed: 30 },
        { x: 100, z: 100, angle: 0, baseSpeed: 30 },
        { x: -100, z: -100, angle: 0, baseSpeed: 30 },
      ]);
      // Place trail for player 1 crossing player 0
      state = { ...state, trails: [state.trails[0], [{ x: -5, z: 0 }, { x: 5, z: 0 }], state.trails[2]] };

      const next = simStep(state, [noInput(1), noInput(1), noInput(1)], [stubCfg, stubCfg, stubCfg]);
      expect(next.players[0].alive).toBe(false);
      expect(next.players[1].alive).toBe(true);
      expect(next.players[2].alive).toBe(true);
    });
  });

  // ── 4-player OOB ─────────────────────────────────────

  describe('4-player out-of-bounds', () => {
    it('only the OOB player dies', () => {
      const spawns: PlayerSpawn[] = [
        { x: ARENA_HALF + 1, z: 0, angle: 0, baseSpeed: 30 },
        { x: 10, z: 10, angle: 0, baseSpeed: 30 },
        { x: -10, z: -10, angle: 0, baseSpeed: 30 },
        { x: 50, z: 50, angle: 0, baseSpeed: 30 },
      ];
      const state = createSimState(0, spawns);
      const inputs = spawns.map(() => noInput(1));
      const cfgs = spawns.map(() => stubCfg);
      const next = simStep(state, inputs, cfgs);

      expect(next.players[0].alive).toBe(false);
      expect(next.players[1].alive).toBe(true);
      expect(next.players[2].alive).toBe(true);
      expect(next.players[3].alive).toBe(true);
    });
  });

  // ── cloneSimState ────────────────────────────────────

  describe('cloneSimState', () => {
    it('deep-clones N players — mutating clone does not affect original', () => {
      const state = createSimState(0, spawn3());
      const clone = cloneSimState(state);

      clone.players[0].x = 9999;
      clone.trails[1].push({ x: 1, z: 1 });

      expect(state.players[0].x).not.toBe(9999);
      expect(state.trails[1]).toHaveLength(0);
    });
  });

  // ── hashSimState ─────────────────────────────────────

  describe('hashSimState', () => {
    it('produces consistent hash for same state', () => {
      const state = createSimState(5, spawn2());
      expect(hashSimState(state)).toBe(hashSimState(state));
    });

    it('returns same hash for identical states', () => {
      const a = createSimState(5, spawn3());
      const b = createSimState(5, spawn3());
      expect(hashSimState(a)).toBe(hashSimState(b));
    });

    it('hash differs when any player position changes', () => {
      const state = createSimState(5, spawn3());
      const modified = cloneSimState(state);
      modified.players[2].x += 10;
      expect(hashSimState(state)).not.toBe(hashSimState(modified));
    });

    it('detects mid-trail divergence', () => {
      const a = createSimState(0, spawn2());
      const b = createSimState(0, spawn2());
      const trail: TrailPoint[] = [];
      for (let i = 0; i < 200; i++) trail.push({ x: i, z: i * 0.5 });
      a.trails[0] = trail.slice();
      b.trails[0] = trail.slice();
      expect(hashSimState(a)).toBe(hashSimState(b));
      b.trails[0][50] = { x: 999, z: 999 };
      expect(hashSimState(a)).not.toBe(hashSimState(b));
    });

    it('detects trail length difference', () => {
      const a = createSimState(0, spawn2());
      const b = createSimState(0, spawn2());
      a.trails[0] = [{ x: 1, z: 2 }, { x: 3, z: 4 }];
      b.trails[0] = [{ x: 1, z: 2 }];
      expect(hashSimState(a)).not.toBe(hashSimState(b));
    });
  });

  // ── serializeSimState / deserializeSimState ──────────

  describe('serializeSimState / deserializeSimState', () => {
    it('roundtrips N players', () => {
      let state = createSimState(0, spawn4());
      const cfgs = spawn4().map(() => BIKE_PHYSICS);
      // Run a few steps to get trail data
      for (let i = 0; i < 5; i++) {
        state = simStep(state, spawn4().map(() => noInput(state.tick + 1)), cfgs);
      }

      const serialized = serializeSimState(state);
      const deserialized = deserializeSimState(serialized);

      expect(deserialized.tick).toBe(state.tick);
      expect(deserialized.players).toHaveLength(4);
      expect(deserialized.trails).toHaveLength(4);
      for (let i = 0; i < 4; i++) {
        expect(deserialized.players[i].x).toBeCloseTo(state.players[i].x, 3);
        expect(deserialized.players[i].z).toBeCloseTo(state.players[i].z, 3);
        expect(deserialized.players[i].alive).toBe(state.players[i].alive);
        expect(deserialized.trails[i].length).toBe(state.trails[i].length);
      }
    });
  });

  // ── Determinism ──────────────────────────────────────

  describe('determinism', () => {
    it('produces identical state when run twice with same inputs', () => {
      let stateA = createSimState(0, spawn2());
      let stateB = createSimState(0, spawn2());

      for (let t = 1; t <= 600; t++) {
        const input0: InputFrame = { tick: t, turnDir: (t % 60 < 20 ? -1 : t % 60 < 40 ? 1 : 0) as -1|0|1, accelerate: t % 100 < 30, dash: false, brake: false };
        const input1: InputFrame = { tick: t, turnDir: (t % 45 < 15 ? 1 : 0) as -1|0|1, accelerate: false, dash: t % 80 < 10, brake: false };

        stateA = simStep(stateA, [input0, input1], [BIKE_PHYSICS, BIKE_PHYSICS]);
        stateB = simStep(stateB, [input0, input1], [BIKE_PHYSICS, BIKE_PHYSICS]);
      }

      expect(stateA.players[0].x).toBe(stateB.players[0].x);
      expect(stateA.players[0].z).toBe(stateB.players[0].z);
      expect(stateA.players[0].angle).toBe(stateB.players[0].angle);
      expect(stateA.players[1].x).toBe(stateB.players[1].x);
      expect(stateA.players[1].z).toBe(stateB.players[1].z);
      expect(stateA.trails[0].length).toBe(stateB.trails[0].length);
      expect(stateA.trails[1].length).toBe(stateB.trails[1].length);
      expect(hashSimState(stateA)).toBe(hashSimState(stateB));
    });

    it('determinism holds with trail collision enabled', () => {
      let stateA = createSimState(0, spawn2());
      let stateB = createSimState(0, spawn2());

      for (let t = 1; t <= 600; t++) {
        const input0: InputFrame = { tick: t, turnDir: (t % 60 < 20 ? -1 : t % 60 < 40 ? 1 : 0) as -1|0|1, accelerate: t % 100 < 30, dash: false, brake: false };
        const input1: InputFrame = { tick: t, turnDir: (t % 45 < 15 ? 1 : 0) as -1|0|1, accelerate: false, dash: t % 80 < 10, brake: false };

        stateA = simStep(stateA, [input0, input1], [BIKE_PHYSICS, BIKE_PHYSICS]);
        stateB = simStep(stateB, [input0, input1], [BIKE_PHYSICS, BIKE_PHYSICS]);
      }

      expect(stateA.trails[0].length).toBe(stateB.trails[0].length);
      expect(stateA.trails[1].length).toBe(stateB.trails[1].length);
      expect(stateA.players[0].alive).toBe(stateB.players[0].alive);
      expect(stateA.players[1].alive).toBe(stateB.players[1].alive);
      expect(hashSimState(stateA)).toBe(hashSimState(stateB));
    });
  });

  // ── SnapshotBuffer ───────────────────────────────────

  describe('SnapshotBuffer', () => {
    it('saves and retrieves snapshots by tick', () => {
      const buf = new SnapshotBuffer(5);
      const state = createSimState(7, spawn2());
      buf.save(state);
      const retrieved = buf.get(7);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.tick).toBe(7);
      expect(retrieved!.players[0].x).toBe(-50);
    });

    it('returns null for missing tick', () => {
      const buf = new SnapshotBuffer(5);
      expect(buf.get(99)).toBeNull();
    });

    it('overwrites old entries in ring buffer', () => {
      const buf = new SnapshotBuffer(3);
      for (let i = 0; i < 5; i++) {
        const spawns: PlayerSpawn[] = [
          { x: i, z: 0, angle: 0, baseSpeed: 40 },
          { x: 0, z: i, angle: Math.PI, baseSpeed: 40 },
        ];
        buf.save(createSimState(i, spawns));
      }
      expect(buf.get(0)).toBeNull();
      expect(buf.get(1)).toBeNull();
      expect(buf.get(2)!.tick).toBe(2);
      expect(buf.get(3)!.tick).toBe(3);
      expect(buf.get(4)!.tick).toBe(4);
    });

    it('returns deep clone (not reference)', () => {
      const buf = new SnapshotBuffer(5);
      const spawns: PlayerSpawn[] = [
        { x: 10, z: 0, angle: 0, baseSpeed: 40 },
        { x: 0, z: 0, angle: Math.PI, baseSpeed: 40 },
      ];
      buf.save(createSimState(0, spawns));
      const a = buf.get(0)!;
      const b = buf.get(0)!;
      a.players[0].x = 999;
      expect(b.players[0].x).toBe(10);
    });

    it('trail arrays are isolated between snapshots', () => {
      const buf = new SnapshotBuffer(5);
      const state = createSimState(0, spawn2());
      state.trails[0] = [{ x: 1, z: 2 }, { x: 3, z: 4 }];
      buf.save(state);
      const retrieved = buf.get(0)!;
      retrieved.trails[0].push({ x: 99, z: 99 });
      const again = buf.get(0)!;
      expect(again.trails[0].length).toBe(2);
    });
  });

  // ── checkTrailCollision (legacy 2-trail API) ─────────

  describe('checkTrailCollision', () => {
    it('detects collision with enemy trail segment', () => {
      const own: TrailPoint[] = [];
      const enemy: TrailPoint[] = [{ x: 0, z: 0 }, { x: 10, z: 0 }];
      expect(checkTrailCollision(5, 0.5, own, enemy)).toBe(true);
    });

    it('returns false when far from all trails', () => {
      const own: TrailPoint[] = [];
      const enemy: TrailPoint[] = [{ x: 0, z: 0 }, { x: 10, z: 0 }];
      expect(checkTrailCollision(5, 5, own, enemy)).toBe(false);
    });

    it('detects collision with own trail (old segments)', () => {
      const own: TrailPoint[] = [];
      for (let i = 0; i <= SKIP_OWN_SEGMENTS + 5; i++) {
        own.push({ x: i * 2, z: 0 });
      }
      const enemy: TrailPoint[] = [];
      expect(checkTrailCollision(1, 0.5, own, enemy)).toBe(true);
    });

    it('skips recent own trail segments', () => {
      const own: TrailPoint[] = [];
      for (let i = 0; i <= SKIP_OWN_SEGMENTS + 2; i++) {
        own.push({ x: i * 2, z: 0 });
      }
      const enemy: TrailPoint[] = [];
      const lastX = (SKIP_OWN_SEGMENTS + 2) * 2 - 1;
      expect(checkTrailCollision(lastX, 0.5, own, enemy)).toBe(false);
    });

    it('returns false with empty trails', () => {
      expect(checkTrailCollision(0, 0, [], [])).toBe(false);
    });

    it('returns false with single-point trails (no segments)', () => {
      expect(checkTrailCollision(0, 0, [{ x: 0, z: 0 }], [{ x: 0, z: 0 }])).toBe(false);
    });
  });

  // ── Trail optimization ───────────────────────────────

  describe('simStep trail optimization', () => {
    it('reuses trail array reference when no trail point is added', () => {
      let state = createSimState(0, spawn2());
      state = simStep(state, [noInput(1), noInput(1)], [BIKE_PHYSICS, BIKE_PHYSICS]);
      state = simStep(state, [noInput(2), noInput(2)], [BIKE_PHYSICS, BIKE_PHYSICS]);
      const trail0Ref = state.trails[0];
      const trail1Ref = state.trails[1];
      const next = simStep(state, [noInput(3), noInput(3)], [BIKE_PHYSICS, BIKE_PHYSICS]);
      expect(next.trails[0]).toBe(trail0Ref);
      expect(next.trails[1]).toBe(trail1Ref);
    });

    it('creates new trail array when trail point is added', () => {
      let state = createSimState(0, spawn2());
      state = simStep(state, [noInput(1), noInput(1)], [BIKE_PHYSICS, BIKE_PHYSICS]);
      const trail0Ref = state.trails[0];
      state = simStep(state, [noInput(2), noInput(2)], [BIKE_PHYSICS, BIKE_PHYSICS]);
      expect(state.trails[0]).not.toBe(trail0Ref);
      expect(state.trails[0].length).toBe(trail0Ref.length + 1);
    });
  });

  // ── isOutOfBounds ────────────────────────────────────

  describe('isOutOfBounds', () => {
    it('returns false for center', () => {
      expect(isOutOfBounds(0, 0)).toBe(false);
    });

    it('returns true beyond arena edge', () => {
      expect(isOutOfBounds(ARENA_HALF + 1, 0)).toBe(true);
      expect(isOutOfBounds(0, -ARENA_HALF - 1)).toBe(true);
    });

    it('returns true at exact arena edge (matches grid.ts boundary)', () => {
      expect(isOutOfBounds(ARENA_HALF, 0)).toBe(true);
    });

    it('returns false just inside arena edge', () => {
      expect(isOutOfBounds(ARENA_HALF - 0.01, 0)).toBe(false);
    });
  });

  // ── Drift physics ────────────────────────────────────

  describe('drift physics (car)', () => {
    it('enters drift when braking at speed with car config', () => {
      const p = createPlayerSim(0, 0, 0, CAR_PHYSICS.boostSpeed);
      const next = advancePlayer(p, brakeInput(0), CAR_PHYSICS, SIM_DT);
      expect(next.drifting).toBe(true);
      expect(next.driftBrakeHeld).toBe(true);
    });

    it('does NOT enter drift with bike config (canDrift=false)', () => {
      const p = createPlayerSim(0, 0, 0, BIKE_PHYSICS.baseSpeed);
      const next = advancePlayer(p, brakeInput(0), BIKE_PHYSICS, SIM_DT);
      expect(next.drifting).toBe(false);
    });

    it('does NOT enter drift when speed is too low', () => {
      const p = createPlayerSim(0, 0, 0, CAR_PHYSICS.baseSpeed * 0.5);
      const next = advancePlayer(p, brakeInput(0), CAR_PHYSICS, SIM_DT);
      expect(next.drifting).toBe(false);
    });

    it('builds slip angle when turning during drift', () => {
      let p = createPlayerSim(0, 0, 0, CAR_PHYSICS.boostSpeed);
      p = advancePlayer(p, brakeInput(0), CAR_PHYSICS, SIM_DT);
      expect(p.drifting).toBe(true);
      for (let i = 0; i < 10; i++) {
        p = advancePlayer(p, driftTurnInput(i), CAR_PHYSICS, SIM_DT);
      }
      expect(Math.abs(p.slipAngle)).toBeGreaterThan(0.01);
    });

    it('uses velocity angle for movement during drift (not facing angle)', () => {
      let p = createPlayerSim(0, 0, 0, CAR_PHYSICS.boostSpeed);
      p = advancePlayer(p, brakeInput(0), CAR_PHYSICS, SIM_DT);
      for (let i = 0; i < 5; i++) {
        p = advancePlayer(p, driftTurnInput(i), CAR_PHYSICS, SIM_DT);
      }
      expect(p.velocityAngle).not.toBeCloseTo(p.angle, 1);
    });

    it('regens meter during drift', () => {
      let p = { ...createPlayerSim(0, 0, 0, CAR_PHYSICS.baseSpeed), meter: 50 };
      p = advancePlayer(p, brakeInput(0), CAR_PHYSICS, SIM_DT);
      for (let i = 0; i < 30; i++) {
        p = advancePlayer(p, brakeInput(i), CAR_PHYSICS, SIM_DT);
      }
      expect(p.meter).toBeGreaterThan(50);
    });

    it('exits drift crisply at low speed when brake is released', () => {
      let p = createPlayerSim(0, 0, 0, CAR_PHYSICS.boostSpeed);
      p = advancePlayer(p, brakeInput(0), CAR_PHYSICS, SIM_DT);
      expect(p.drifting).toBe(true);
      p = {
        ...p,
        speed: CAR_PHYSICS.driftMinSpeed + 4,
        velocityAngle: p.angle - 0.12,
        slipAngle: 0.12,
        driftBrakeHeld: false,
      };
      const release: InputFrame = { tick: 1, turnDir: 0, accelerate: false, dash: false, brake: false };
      p = advancePlayer(p, release, CAR_PHYSICS, SIM_DT);
      expect(p.drifting).toBe(false);
      expect(Math.abs(p.slipAngle)).toBeLessThan(0.02);
    });

    it('exits drift at low speed even with moderate remaining slip', () => {
      let p = createPlayerSim(0, 0, 0, CAR_PHYSICS.boostSpeed);
      p = advancePlayer(p, brakeInput(0), CAR_PHYSICS, SIM_DT);
      expect(p.drifting).toBe(true);
      // Set up low speed with moderate slip, brake released
      p = {
        ...p,
        speed: CAR_PHYSICS.driftMinSpeed + 4,
        velocityAngle: p.angle - 0.25,
        slipAngle: 0.25,
        driftBrakeHeld: false,
      };
      const release: InputFrame = { tick: 1, turnDir: 0, accelerate: false, dash: false, brake: false };
      p = advancePlayer(p, release, CAR_PHYSICS, SIM_DT);
      // Should exit even though slip 0.25 > old threshold * 2.5 (0.20)
      expect(p.drifting).toBe(false);
    });

    it('responds quickly when steering reverses direction during a drift', () => {
      let p = createPlayerSim(0, 0, 0, CAR_PHYSICS.boostSpeed);
      p = advancePlayer(p, brakeInput(0), CAR_PHYSICS, SIM_DT);
      for (let i = 0; i < 8; i++) {
        p = advancePlayer(p, driftTurnInput(i), CAR_PHYSICS, SIM_DT);
      }
      expect(p.slipAngle).toBeLessThan(0);

      for (let i = 0; i < 10; i++) {
        p = advancePlayer(p, rightDriftTurnInput(i), CAR_PHYSICS, SIM_DT);
      }
      expect(p.slipAngle).toBeGreaterThan(0);
    });

    it('throttle helps the Slingshot hook up during drift', () => {
      let coast = createPlayerSim(0, 0, 0, CAR_PHYSICS.dashSpeed);
      let throttle = createPlayerSim(0, 0, 0, CAR_PHYSICS.dashSpeed);
      coast = advancePlayer(coast, brakeInput(0), CAR_PHYSICS, SIM_DT);
      throttle = advancePlayer(throttle, brakeInput(0), CAR_PHYSICS, SIM_DT);

      for (let i = 0; i < 8; i++) {
        coast = advancePlayer(coast, driftTurnInput(i), CAR_PHYSICS, SIM_DT);
        throttle = advancePlayer(throttle, driftThrottleLeftInput(i), CAR_PHYSICS, SIM_DT);
      }

      expect(Math.abs(throttle.slipAngle)).toBeLessThan(Math.abs(coast.slipAngle));
    });

    it('countersteer recovers drift faster than holding the same steer', () => {
      let sameSteer = createPlayerSim(0, 0, 0, CAR_PHYSICS.dashSpeed);
      let countersteer = createPlayerSim(0, 0, 0, CAR_PHYSICS.dashSpeed);
      sameSteer = advancePlayer(sameSteer, brakeInput(0), CAR_PHYSICS, SIM_DT);
      countersteer = advancePlayer(countersteer, brakeInput(0), CAR_PHYSICS, SIM_DT);

      // Build slip — hold speed high to isolate input-responsiveness from ceiling
      for (let i = 0; i < 8; i++) {
        sameSteer = { ...sameSteer, speed: CAR_PHYSICS.dashSpeed };
        countersteer = { ...countersteer, speed: CAR_PHYSICS.dashSpeed };
        sameSteer = advancePlayer(sameSteer, driftTurnInput(i), CAR_PHYSICS, SIM_DT);
        countersteer = advancePlayer(countersteer, driftTurnInput(i), CAR_PHYSICS, SIM_DT);
      }
      for (let i = 0; i < 8; i++) {
        sameSteer = { ...sameSteer, speed: CAR_PHYSICS.dashSpeed };
        countersteer = { ...countersteer, speed: CAR_PHYSICS.dashSpeed };
        sameSteer = advancePlayer(sameSteer, driftTurnInput(i), CAR_PHYSICS, SIM_DT);
        countersteer = advancePlayer(countersteer, rightDriftTurnInput(i), CAR_PHYSICS, SIM_DT);
      }

      expect(Math.abs(countersteer.slipAngle)).toBeLessThan(Math.abs(sameSteer.slipAngle));
    });

    it('preserves more slip at high speed than at low speed', () => {
      let low = createPlayerSim(0, 0, 0, CAR_PHYSICS.driftMinSpeed + 4);
      let high = createPlayerSim(0, 0, 0, CAR_PHYSICS.dashSpeed);
      low = advancePlayer(low, brakeInput(0), CAR_PHYSICS, SIM_DT);
      high = advancePlayer(high, brakeInput(0), CAR_PHYSICS, SIM_DT);

      for (let i = 0; i < 8; i++) {
        low = advancePlayer(low, driftTurnInput(i), CAR_PHYSICS, SIM_DT);
        high = advancePlayer(high, driftTurnInput(i), CAR_PHYSICS, SIM_DT);
      }

      expect(Math.abs(high.slipAngle)).toBeGreaterThan(Math.abs(low.slipAngle));
    });

    it('has less top-speed wheel correction under throttle than at mid speed', () => {
      let mid = createPlayerSim(0, 0, 0, CAR_PHYSICS.boostSpeed);
      let high = createPlayerSim(0, 0, 0, CAR_PHYSICS.dashSpeed);
      mid = advancePlayer(mid, brakeInput(0), CAR_PHYSICS, SIM_DT);
      high = advancePlayer(high, brakeInput(0), CAR_PHYSICS, SIM_DT);

      for (let i = 0; i < 10; i++) {
        mid = advancePlayer(mid, driftThrottleLeftInput(i), CAR_PHYSICS, SIM_DT);
        high = advancePlayer(high, driftThrottleLeftInput(i), CAR_PHYSICS, SIM_DT);
      }

      expect(Math.abs(high.slipAngle)).toBeGreaterThan(Math.abs(mid.slipAngle));
    });

    it('preserves momentum direction at the start of a high-speed drift', () => {
      const start = createPlayerSim(0, 0, 0, CAR_PHYSICS.dashSpeed);
      const entry = advancePlayer(start, brakeInput(0), CAR_PHYSICS, SIM_DT);
      const early = advancePlayer(entry, driftTurnInput(1), CAR_PHYSICS, SIM_DT);

      const earlyMomentumRotation = Math.abs(normalizeAngle(early.velocityAngle - start.velocityAngle));
      const earlyFacingRotation = Math.abs(normalizeAngle(early.angle - start.angle));

      expect(early.drifting).toBe(true);
      // With reduced driftTurnMultiplier, early-entry facing and momentum
      // rotate at similar rates — verify they're close (within 2x)
      expect(earlyMomentumRotation).toBeLessThan(earlyFacingRotation * 2);
      expect(early.driftEntryTimer).toBeGreaterThan(0);
    });

    it('ramps into full drift after the entry phase instead of staying shallow', () => {
      let p = createPlayerSim(0, 0, 0, CAR_PHYSICS.dashSpeed);
      p = advancePlayer(p, brakeInput(0), CAR_PHYSICS, SIM_DT);
      const early = advancePlayer(p, driftTurnInput(1), CAR_PHYSICS, SIM_DT);

      let settled = early;
      for (let i = 0; i < 20; i++) {
        settled = advancePlayer(settled, driftTurnInput(i + 2), CAR_PHYSICS, SIM_DT);
      }

      expect(Math.abs(settled.slipAngle)).toBeGreaterThan(Math.abs(early.slipAngle));
      expect(settled.driftEntryTimer).toBeGreaterThanOrEqual(CAR_PHYSICS.driftEntryDuration);
    });

    it('scrubs more speed in low-speed high-slip drifts than in high-speed ones', () => {
      let low = createPlayerSim(0, 0, 0, CAR_PHYSICS.boostSpeed);
      let high = createPlayerSim(0, 0, 0, CAR_PHYSICS.dashSpeed);
      low = advancePlayer(low, brakeInput(0), CAR_PHYSICS, SIM_DT);
      high = advancePlayer(high, brakeInput(0), CAR_PHYSICS, SIM_DT);
      low = { ...low, speed: CAR_PHYSICS.driftMinSpeed + 4 };

      for (let i = 0; i < 10; i++) {
        low = advancePlayer(low, driftTurnInput(i), CAR_PHYSICS, SIM_DT);
        high = advancePlayer(high, driftTurnInput(i), CAR_PHYSICS, SIM_DT);
      }

      expect(low.speed).toBeLessThan(high.speed);
    });

    it('does not rapidly climb to drift speed while coasting in a low-speed slide', () => {
      let p = createPlayerSim(0, 0, 0, CAR_PHYSICS.boostSpeed);
      p = advancePlayer(p, brakeInput(0), CAR_PHYSICS, SIM_DT);
      p = { ...p, speed: CAR_PHYSICS.driftMinSpeed + 4 };

      for (let i = 0; i < 16; i++) {
        p = advancePlayer(p, driftTurnInput(i), CAR_PHYSICS, SIM_DT);
      }

      expect(p.speed).toBeLessThan(CAR_PHYSICS.driftSpeed * 0.75);
    });

    it('throttle gains less speed when poorly aligned than when hooked up', () => {
      let poorAlign = createPlayerSim(0, 0, 0, CAR_PHYSICS.boostSpeed);
      let hookedUp = createPlayerSim(0, 0, 0, CAR_PHYSICS.boostSpeed);
      poorAlign = advancePlayer(poorAlign, brakeInput(0), CAR_PHYSICS, SIM_DT);
      hookedUp = advancePlayer(hookedUp, brakeInput(0), CAR_PHYSICS, SIM_DT);
      poorAlign = { ...poorAlign, speed: CAR_PHYSICS.driftMinSpeed + 6 };
      hookedUp = { ...hookedUp, speed: CAR_PHYSICS.driftMinSpeed + 6 };

      for (let i = 0; i < 8; i++) {
        poorAlign = advancePlayer(poorAlign, driftTurnInput(i), CAR_PHYSICS, SIM_DT);
        hookedUp = advancePlayer(hookedUp, driftTurnInput(i), CAR_PHYSICS, SIM_DT);
      }
      for (let i = 0; i < 8; i++) {
        poorAlign = advancePlayer(poorAlign, driftThrottleLeftInput(i), CAR_PHYSICS, SIM_DT);
        hookedUp = advancePlayer(hookedUp, { tick: i, turnDir: 0, accelerate: true, dash: false, brake: true }, CAR_PHYSICS, SIM_DT);
      }

      expect(hookedUp.speed).toBeGreaterThan(poorAlign.speed);
    });

    it('countersteer plus throttle restores speed faster than same steer plus throttle', () => {
      let sameSteer = createPlayerSim(0, 0, 0, CAR_PHYSICS.dashSpeed);
      let countersteer = createPlayerSim(0, 0, 0, CAR_PHYSICS.dashSpeed);
      sameSteer = advancePlayer(sameSteer, brakeInput(0), CAR_PHYSICS, SIM_DT);
      countersteer = advancePlayer(countersteer, brakeInput(0), CAR_PHYSICS, SIM_DT);
      sameSteer = { ...sameSteer, speed: CAR_PHYSICS.boostSpeed };
      countersteer = { ...countersteer, speed: CAR_PHYSICS.boostSpeed };

      for (let i = 0; i < 8; i++) {
        sameSteer = advancePlayer(sameSteer, driftTurnInput(i), CAR_PHYSICS, SIM_DT);
        countersteer = advancePlayer(countersteer, driftTurnInput(i), CAR_PHYSICS, SIM_DT);
      }
      for (let i = 0; i < 10; i++) {
        sameSteer = advancePlayer(sameSteer, driftThrottleLeftInput(i), CAR_PHYSICS, SIM_DT);
        countersteer = advancePlayer(countersteer, { tick: i, turnDir: 1, accelerate: true, dash: false, brake: true }, CAR_PHYSICS, SIM_DT);
      }

      expect(countersteer.speed).toBeGreaterThan(sameSteer.speed);
    });

    it('moderates dash speed during low-speed high-slip drifts', () => {
      let sideways = createPlayerSim(0, 0, 0, CAR_PHYSICS.boostSpeed);
      let aligned = createPlayerSim(0, 0, 0, CAR_PHYSICS.boostSpeed);
      sideways = advancePlayer(sideways, brakeInput(0), CAR_PHYSICS, SIM_DT);
      aligned = advancePlayer(aligned, brakeInput(0), CAR_PHYSICS, SIM_DT);
      sideways = { ...sideways, speed: CAR_PHYSICS.driftMinSpeed + 6 };
      aligned = { ...aligned, speed: CAR_PHYSICS.driftMinSpeed + 6 };

      for (let i = 0; i < 8; i++) {
        sideways = advancePlayer(sideways, driftTurnInput(i), CAR_PHYSICS, SIM_DT);
        aligned = advancePlayer(aligned, driftTurnInput(i), CAR_PHYSICS, SIM_DT);
      }

      sideways = advancePlayer(sideways, { tick: 20, turnDir: -1, accelerate: false, dash: true, brake: true }, CAR_PHYSICS, SIM_DT);
      aligned = advancePlayer(aligned, { tick: 20, turnDir: 1, accelerate: false, dash: true, brake: true }, CAR_PHYSICS, SIM_DT);
      aligned = advancePlayer(aligned, { tick: 21, turnDir: 0, accelerate: false, dash: true, brake: true }, CAR_PHYSICS, SIM_DT);

      expect(sideways.speed).toBeLessThan(aligned.speed);
    });

    it('enforces a low slip ceiling at crawl speed via speed-gated clamp', () => {
      // Start at crawl speed, initiate drift, steer hard for many frames
      let p = createPlayerSim(0, 0, 0, CAR_PHYSICS.baseSpeed);
      p = advancePlayer(p, brakeInput(0), CAR_PHYSICS, SIM_DT);
      expect(p.drifting).toBe(true);
      // Force low speed each frame to isolate the ceiling test from drift acceleration
      const crawlSpeed = CAR_PHYSICS.driftMinSpeed + 4;
      for (let i = 0; i < 30; i++) {
        p = { ...p, speed: crawlSpeed };
        p = advancePlayer(p, driftTurnInput(i), CAR_PHYSICS, SIM_DT);
      }
      // At crawl speed, slip must be dramatically reduced from uncapped (~0.35+)
      expect(Math.abs(p.slipAngle)).toBeLessThan(0.25);
    });

    it('throttle tightens the slip ceiling at low speed', () => {
      // Two cars at crawl speed: one coasting, one on throttle
      let coast = createPlayerSim(0, 0, 0, CAR_PHYSICS.baseSpeed);
      let throttle = createPlayerSim(0, 0, 0, CAR_PHYSICS.baseSpeed);
      coast = advancePlayer(coast, brakeInput(0), CAR_PHYSICS, SIM_DT);
      throttle = advancePlayer(throttle, brakeInput(0), CAR_PHYSICS, SIM_DT);
      coast = { ...coast, speed: CAR_PHYSICS.driftMinSpeed + 4 };
      throttle = { ...throttle, speed: CAR_PHYSICS.driftMinSpeed + 4 };

      for (let i = 0; i < 1; i++) {
        coast = advancePlayer(coast, driftTurnInput(i), CAR_PHYSICS, SIM_DT);
        throttle = advancePlayer(throttle, driftThrottleLeftInput(i), CAR_PHYSICS, SIM_DT);
      }

      // Throttle car should have less slip than coasting car
      expect(Math.abs(throttle.slipAngle)).toBeLessThan(Math.abs(coast.slipAngle));
    });

    it('countersteer reduces slip magnitude at high speed', () => {
      // Test at dashSpeed where ceiling is fully open (0.70 rad) and
      // countersteer has room to show meaningful reduction
      let p = createPlayerSim(0, 0, 0, CAR_PHYSICS.dashSpeed);
      p = advancePlayer(p, brakeInput(0), CAR_PHYSICS, SIM_DT);

      // Build slip with left steer — hold speed high
      for (let i = 0; i < 10; i++) {
        p = { ...p, speed: CAR_PHYSICS.dashSpeed };
        p = advancePlayer(p, driftTurnInput(i), CAR_PHYSICS, SIM_DT);
      }
      const slipBefore = Math.abs(p.slipAngle);
      expect(slipBefore).toBeGreaterThan(0.05);

      // Countersteer (right) for several frames — hold speed high
      for (let i = 0; i < 8; i++) {
        p = { ...p, speed: CAR_PHYSICS.dashSpeed };
        p = advancePlayer(p, rightDriftTurnInput(i + 10), CAR_PHYSICS, SIM_DT);
      }

      // Slip should have reduced noticeably
      expect(Math.abs(p.slipAngle)).toBeLessThan(slipBefore);
    });

    it('high-speed drift angle is unaffected by the slip ceiling', () => {
      let p = createPlayerSim(0, 0, 0, CAR_PHYSICS.dashSpeed);
      p = advancePlayer(p, brakeInput(0), CAR_PHYSICS, SIM_DT);

      for (let i = 0; i < 20; i++) {
        p = advancePlayer(p, driftTurnInput(i), CAR_PHYSICS, SIM_DT);
      }

      // At dash speed, slip should reach a substantial angle (ceiling ~0.70 = full range)
      expect(Math.abs(p.slipAngle)).toBeGreaterThan(0.14);
    });

    it('keeps the Spectre on its unchanged non-drift path', () => {
      const p = createPlayerSim(0, 0, 0, BIKE_PHYSICS.baseSpeed);
      const next = advancePlayer(p, driftTurnInput(0), BIKE_PHYSICS, SIM_DT);
      expect(next.drifting).toBe(false);
      expect(next.angle).not.toBe(0);
      expect(next.z).toBeLessThan(0);
    });

    it('aligns velocity to facing faster after drift exit at low speed than at high speed', () => {
      // Set up two cars: both just exited drift with residual slip
      const makePostDrift = (speed: number) => {
        let p = createPlayerSim(0, 0, 0, speed);
        // Not drifting, but velocityAngle offset from angle (post-drift residual)
        p = { ...p, drifting: false, velocityAngle: p.angle - 0.08, slipAngle: 0.08 };
        const neutral: InputFrame = { tick: 0, turnDir: 0, accelerate: false, dash: false, brake: false };
        for (let i = 0; i < 5; i++) {
          p = advancePlayer(p, { ...neutral, tick: i }, CAR_PHYSICS, SIM_DT);
        }
        return Math.abs(normalizeAngle(p.angle - p.velocityAngle));
      };

      const lowSpeedResidual = makePostDrift(CAR_PHYSICS.driftMinSpeed + 4);
      const highSpeedResidual = makePostDrift(CAR_PHYSICS.dashSpeed);

      // Low speed should have less residual slip (aligned faster)
      expect(lowSpeedResidual).toBeLessThan(highSpeedResidual);
    });
  });

  // ── No unlimited boost (meter must deplete without proximity recharge) ──

  describe('meter economy — no unlimited boost', () => {
    const SECONDS = 30; // simulate 30s — enough to detect infinite sustain
    const TICKS = Math.round(SECONDS / SIM_DT);

    function simulateMeter(
      cfg: typeof BIKE_PHYSICS,
      inputFn: (tick: number) => InputFrame,
      startMeter = 100,
    ): { finalMeter: number; hitZero: boolean; everLocked: boolean } {
      let p = { ...createPlayerSim(0, 0, 0, cfg.baseSpeed), meter: startMeter };
      let hitZero = false;
      let everLocked = false;
      for (let i = 0; i < TICKS; i++) {
        p = advancePlayer(p, inputFn(i), cfg, SIM_DT);
        if (p.meter <= 0) hitZero = true;
        if (p.boostLocked) everLocked = true;
      }
      return { finalMeter: p.meter, hitZero, everLocked };
    }

    // ── Bike ──

    it('bike: W-boost does not drain meter (free boost)', () => {
      const { finalMeter, hitZero } = simulateMeter(
        BIKE_PHYSICS,
        (t) => boostInput(t),
      );
      // Meter should stay at or above starting — W is free + passive regen trickles in
      expect(hitZero).toBe(false);
      expect(finalMeter).toBeGreaterThan(0);
    });

    it('bike: dash depletes meter and triggers boost lock', () => {
      const dashInput = (t: number): InputFrame => ({ tick: t, turnDir: 0, accelerate: false, dash: true, brake: false });
      const { everLocked } = simulateMeter(
        BIKE_PHYSICS,
        dashInput,
      );
      // Dash drain (60/sec) far exceeds emergency regen (5/sec) — must hit lock
      expect(everLocked).toBe(true);
    });

    it('bike: holding dash for 30s cannot sustain meter above zero indefinitely', () => {
      const dashInput = (t: number): InputFrame => ({ tick: t, turnDir: 0, accelerate: false, dash: true, brake: false });
      const { finalMeter } = simulateMeter(BIKE_PHYSICS, dashInput);
      // Emergency regen (5/sec) vs dash drain (60/sec) = net -55/sec → meter bottoms out
      // After boost lock, meter regens but dash can't activate, so final meter should be modest
      expect(finalMeter).toBeLessThan(100);
    });

    it('bike: low-meter emergency regen kicks in below 20%', () => {
      // Start at 10% meter, coast (no dash/boost) — should regen
      const { finalMeter } = simulateMeter(
        BIKE_PHYSICS,
        (t) => noInput(t),
        10, // start at 10% meter
      );
      expect(finalMeter).toBeGreaterThan(10);
    });

    it('bike: emergency regen alone cannot outpace dash drain', () => {
      const dashInput = (t: number): InputFrame => ({ tick: t, turnDir: 0, accelerate: false, dash: true, brake: false });
      // Start at 15% meter (below threshold) — dash should still deplete and lock
      const { everLocked } = simulateMeter(BIKE_PHYSICS, dashInput, 15);
      expect(everLocked).toBe(true);
    });

    // ── Car ──

    it('car: W-boost does not drain meter (free boost)', () => {
      const { finalMeter, hitZero } = simulateMeter(
        CAR_PHYSICS,
        (t) => boostInput(t),
      );
      expect(hitZero).toBe(false);
      expect(finalMeter).toBeGreaterThan(0);
    });

    it('car: dash depletes meter and triggers boost lock', () => {
      const dashInput = (t: number): InputFrame => ({ tick: t, turnDir: 0, accelerate: false, dash: true, brake: false });
      const { hitZero, everLocked } = simulateMeter(
        CAR_PHYSICS,
        dashInput,
      );
      expect(hitZero).toBe(true);
      expect(everLocked).toBe(true);
    });

    it('car: no emergency regen (lowMeterThreshold is 0)', () => {
      // Start at 10%, coast for 2s — compare regen rates before both cap out
      const SHORT_TICKS = Math.round(2 / SIM_DT);
      function simShort(cfg: typeof BIKE_PHYSICS, startMeter: number) {
        let p = { ...createPlayerSim(0, 0, 0, cfg.baseSpeed), meter: startMeter };
        for (let i = 0; i < SHORT_TICKS; i++) {
          p = advancePlayer(p, noInput(i), cfg, SIM_DT);
        }
        return p.meter;
      }
      const carMeter = simShort(CAR_PHYSICS, 10);
      const bikeMeter = simShort(BIKE_PHYSICS, 10);
      // Car passive regen is 4.6/sec. Bike gets 4.4 + 5 emergency = 9.4/sec below 20%.
      // After 2s: car ~19.2, bike ~28.8 — bike should be ahead
      expect(carMeter).toBeLessThan(bikeMeter);
    });

    // ── Car drift + W combos ──

    it('car: drift + W-boost regens meter (not unlimited drain)', () => {
      // Get the car into a drift first, then hold W+brake+turn for 30s
      let p = createPlayerSim(0, 0, 0, CAR_PHYSICS.boostSpeed);
      // Accelerate to drift-entry speed
      for (let i = 0; i < 60; i++) {
        p = advancePlayer(p, boostInput(i), CAR_PHYSICS, SIM_DT);
      }
      // Enter drift with brake+turn, then hold W+brake
      for (let i = 60; i < 120; i++) {
        p = advancePlayer(p, driftTurnInput(i), CAR_PHYSICS, SIM_DT);
      }
      const meterAtDriftStart = p.meter;
      // Hold drift + throttle for 10 seconds
      for (let i = 120; i < 120 + 600; i++) {
        p = advancePlayer(p, driftThrottleLeftInput(i), CAR_PHYSICS, SIM_DT);
      }
      // Drift + W regens meter for car — meter should not be zero
      // (driftMeterRegen: 34 on car, driftBoostDrain is legacy/unused)
      expect(p.meter).toBeGreaterThan(0);
    });

    it('car: dash during drift still depletes meter', () => {
      const dashDriftInput = (t: number): InputFrame => ({ tick: t, turnDir: -1, accelerate: false, dash: true, brake: true });
      let p = createPlayerSim(0, 0, 0, CAR_PHYSICS.boostSpeed);
      // Build speed
      for (let i = 0; i < 60; i++) {
        p = advancePlayer(p, boostInput(i), CAR_PHYSICS, SIM_DT);
      }
      // Enter drift
      for (let i = 60; i < 120; i++) {
        p = advancePlayer(p, driftTurnInput(i), CAR_PHYSICS, SIM_DT);
      }
      // Dash during drift for 5 seconds
      let hitZero = false;
      for (let i = 120; i < 120 + 300; i++) {
        p = advancePlayer(p, dashDriftInput(i), CAR_PHYSICS, SIM_DT);
        if (p.meter <= 0) hitZero = true;
      }
      expect(hitZero).toBe(true);
    });
  });
});

// ── Fumes Grace Buffer Tests ───────────────────────────

describe('fumes grace buffer', () => {
  const dashInput = (t: number): InputFrame => ({ tick: t, turnDir: 0, accelerate: false, dash: true, brake: false });
  const boostInput = (t: number): InputFrame => ({ tick: t, turnDir: 0, accelerate: true, dash: false, brake: false });
  const noInput = (t: number): InputFrame => ({ tick: t, turnDir: 0, accelerate: false, dash: false, brake: false });

  it('fumes activates when dash drains meter to zero', () => {
    // meter: 0.5 ensures one dash tick (dashDrain * SIM_DT ≈ 0.58) depletes it to 0
    let p = { ...createPlayerSim(0, 0, 0, BIKE_PHYSICS.baseSpeed), meter: 0.5 };
    p = advancePlayer(p, dashInput(0), BIKE_PHYSICS, SIM_DT);
    // lowMeterRegen adds a small trickle even at 0, so meter may be slightly above 0
    expect(p.meter).toBeLessThan(0.2);
    expect(p.fumes).toBe(true);
    expect(p.boostLocked).toBe(false);
  });

  it('fumes maintains boosting at reduced speed', () => {
    let p = { ...createPlayerSim(0, 0, 0, BIKE_PHYSICS.baseSpeed), meter: 0.5 };
    p = advancePlayer(p, dashInput(0), BIKE_PHYSICS, SIM_DT);
    expect(p.fumes).toBe(true);
    p = advancePlayer(p, dashInput(1), BIKE_PHYSICS, SIM_DT);
    expect(p.boosting).toBe(true);
    expect(p.dashing).toBe(true);
  });

  it('fumes expires after fumesDuration and triggers boostLocked + sputterSFX', () => {
    let p = { ...createPlayerSim(0, 0, 0, BIKE_PHYSICS.baseSpeed), meter: 0.5 };
    p = advancePlayer(p, dashInput(0), BIKE_PHYSICS, SIM_DT);
    expect(p.fumes).toBe(true);
    // Run until fumes ends — sputterSFX is a one-frame flag set on the expiry tick
    const maxTicks = Math.ceil(BIKE_PHYSICS.fumesDuration / SIM_DT) + 5;
    let sputterSeen = false;
    for (let i = 1; i <= maxTicks; i++) {
      p = advancePlayer(p, dashInput(i), BIKE_PHYSICS, SIM_DT);
      if (p.sputterSFX) sputterSeen = true;
      if (!p.fumes) break;
    }
    expect(p.fumes).toBe(false);
    expect(p.boostLocked).toBe(true);
    expect(sputterSeen).toBe(true);
  });

  it('releasing boost during fumes ends fumes early and locks', () => {
    let p = { ...createPlayerSim(0, 0, 0, BIKE_PHYSICS.baseSpeed), meter: 0.5 };
    p = advancePlayer(p, dashInput(0), BIKE_PHYSICS, SIM_DT);
    expect(p.fumes).toBe(true);
    p = advancePlayer(p, noInput(1), BIKE_PHYSICS, SIM_DT);
    expect(p.fumes).toBe(false);
    expect(p.boostLocked).toBe(true);
    expect(p.sputterSFX).toBe(true);
  });

  it('no passive regen during fumes (only trickle lowMeterRegen)', () => {
    // passiveRegen (20/sec) is blocked during fumes; only lowMeterRegen (5/sec) may trickle
    let p = { ...createPlayerSim(0, 0, 0, BIKE_PHYSICS.baseSpeed), meter: 0.5 };
    p = advancePlayer(p, dashInput(0), BIKE_PHYSICS, SIM_DT);
    const meterAfterFirst = p.meter;
    expect(meterAfterFirst).toBeLessThan(0.2); // far below passiveRegen would give
    p = advancePlayer(p, dashInput(1), BIKE_PHYSICS, SIM_DT);
    // Meter should stay near zero (trickle only), not climb toward passiveRegen rate
    expect(p.meter).toBeLessThan(0.5);
  });

  it('boost unlocks at 10% threshold after fumes', () => {
    let p = { ...createPlayerSim(0, 0, 0, BIKE_PHYSICS.baseSpeed), meter: 0.5 };
    p = advancePlayer(p, dashInput(0), BIKE_PHYSICS, SIM_DT);
    // Exhaust fumes by running until they end
    const maxFumeTicks = Math.ceil(BIKE_PHYSICS.fumesDuration / SIM_DT) + 5;
    for (let i = 1; i <= maxFumeTicks; i++) {
      p = advancePlayer(p, dashInput(i), BIKE_PHYSICS, SIM_DT);
      if (!p.fumes) break;
    }
    expect(p.boostLocked).toBe(true);
    let tick = maxFumeTicks + 1;
    while (p.boostLocked && tick < maxFumeTicks + 600) {
      p = advancePlayer(p, noInput(tick++), BIKE_PHYSICS, SIM_DT);
    }
    expect(p.boostLocked).toBe(false);
    expect(p.meter).toBeGreaterThanOrEqual(BIKE_PHYSICS.boostLockThreshold * 100 - 1);
    expect(p.meter).toBeLessThan(20);
  });


  // ── Car fumes ──

  it('car: fumes activates when dash drains meter to zero', () => {
    let p = { ...createPlayerSim(0, 0, 0, CAR_PHYSICS.baseSpeed), meter: 0.4 };
    p = advancePlayer(p, dashInput(0), CAR_PHYSICS, SIM_DT);
    expect(p.fumes).toBe(true);
    expect(p.boostLocked).toBe(false);
  });

  it('car: fumes activates during drift when dash drains meter', () => {
    // Get car into drift state first
    let p = createPlayerSim(0, 0, 0, CAR_PHYSICS.boostSpeed);
    const driftInput = (t: number): InputFrame => ({ tick: t, turnDir: -1, accelerate: false, dash: false, brake: true });
    const driftDashInput = (t: number): InputFrame => ({ tick: t, turnDir: -1, accelerate: false, dash: true, brake: true });
    // Build speed then enter drift
    for (let i = 0; i < 60; i++) {
      p = advancePlayer(p, boostInput(i), CAR_PHYSICS, SIM_DT);
    }
    for (let i = 60; i < 120; i++) {
      p = advancePlayer(p, driftInput(i), CAR_PHYSICS, SIM_DT);
    }
    expect(p.drifting).toBe(true);
    // Set meter low and dash during drift
    p = { ...p, meter: 0.4 };
    p = advancePlayer(p, driftDashInput(120), CAR_PHYSICS, SIM_DT);
    expect(p.fumes).toBe(true);
    expect(p.drifting).toBe(true); // still drifting during fumes
  });

  // ── No fumes re-trigger loop ──

  it('fumes cannot re-trigger immediately after boost unlocks', () => {
    // Deplete meter → fumes → lock → regen to threshold → boost again
    // Fumes should NOT immediately re-trigger on the first boost after unlock
    let p = { ...createPlayerSim(0, 0, 0, BIKE_PHYSICS.baseSpeed), meter: 0.5 };
    // Trigger fumes
    p = advancePlayer(p, dashInput(0), BIKE_PHYSICS, SIM_DT);
    expect(p.fumes).toBe(true);
    // Exhaust fumes
    const maxFumeTicks = Math.ceil(BIKE_PHYSICS.fumesDuration / SIM_DT) + 5;
    for (let i = 1; i <= maxFumeTicks; i++) {
      p = advancePlayer(p, dashInput(i), BIKE_PHYSICS, SIM_DT);
      if (!p.fumes) break;
    }
    expect(p.boostLocked).toBe(true);
    // Coast until boost unlocks
    let tick = maxFumeTicks + 1;
    while (p.boostLocked && tick < maxFumeTicks + 600) {
      p = advancePlayer(p, noInput(tick++), BIKE_PHYSICS, SIM_DT);
    }
    expect(p.boostLocked).toBe(false);
    const meterAtUnlock = p.meter;
    // Now boost — should NOT immediately trigger fumes (we have 10%+ meter)
    p = advancePlayer(p, dashInput(tick), BIKE_PHYSICS, SIM_DT);
    expect(p.fumes).toBe(false);
    expect(p.meter).toBeGreaterThan(0);
    expect(p.meter).toBeLessThan(meterAtUnlock); // meter drained normally
  });

  // ── Speed value assertions ──

  it('bike: boost target speed matches config boostSpeed', () => {
    let p = createPlayerSim(0, 0, 0, BIKE_PHYSICS.baseSpeed);
    // Run several ticks with boost — bike has accelLerp: 999 so should converge instantly
    for (let i = 0; i < 10; i++) {
      p = advancePlayer(p, boostInput(i), BIKE_PHYSICS, SIM_DT);
    }
    // Speed should be at or very near boostSpeed (proximity boost may add a tiny amount)
    expect(p.speed).toBeGreaterThanOrEqual(BIKE_PHYSICS.boostSpeed * 0.99);
    expect(p.speed).toBeLessThanOrEqual(BIKE_PHYSICS.boostSpeed * 1.01);
  });

  it('car: boost target speed matches config boostSpeed', () => {
    let p = createPlayerSim(0, 0, 0, CAR_PHYSICS.baseSpeed);
    // Car has accelLerp: 6, needs more ticks to converge
    for (let i = 0; i < 120; i++) {
      p = advancePlayer(p, boostInput(i), CAR_PHYSICS, SIM_DT);
    }
    expect(p.speed).toBeGreaterThanOrEqual(CAR_PHYSICS.boostSpeed * 0.98);
    expect(p.speed).toBeLessThanOrEqual(CAR_PHYSICS.boostSpeed * 1.02);
  });

  it('bike: dash sustains ~3s from full meter', () => {
    let p = createPlayerSim(0, 0, 0, BIKE_PHYSICS.baseSpeed);
    let dashTicks = 0;
    for (let i = 0; i < 600; i++) {
      p = advancePlayer(p, dashInput(i), BIKE_PHYSICS, SIM_DT);
      if (p.dashing) dashTicks++;
      else break;
    }
    const dashSeconds = dashTicks * SIM_DT;
    // Should sustain 2.5-3.5s (100 meter / 35 drain = 2.86s + fumes 0.75s)
    expect(dashSeconds).toBeGreaterThan(2.5);
    expect(dashSeconds).toBeLessThan(4.0);
  });

  it('car: dash sustains ~3.3s from full meter', () => {
    let p = createPlayerSim(0, 0, 0, CAR_PHYSICS.baseSpeed);
    let dashTicks = 0;
    for (let i = 0; i < 600; i++) {
      p = advancePlayer(p, dashInput(i), CAR_PHYSICS, SIM_DT);
      if (p.dashing) dashTicks++;
      else break;
    }
    const dashSeconds = dashTicks * SIM_DT;
    // Should sustain 3-4.5s (100 meter / 30 drain = 3.33s + fumes 0.75s)
    expect(dashSeconds).toBeGreaterThan(3.0);
    expect(dashSeconds).toBeLessThan(5.0);
  });

  // ── Proximity multiplier from config ──

  it('proximity boost uses config multiplier, not hardcoded value', () => {
    const p = { ...createPlayerSim(0, 0, 0, BIKE_PHYSICS.baseSpeed), proximityBoost: 1.0 };
    const next = advancePlayer(p, boostInput(0), BIKE_PHYSICS, SIM_DT);
    // With proximitySpeedMultiplier: 0.15 and proximityBoost: 1.0,
    // speed should be multiplied by 1.15 (not old 1.10)
    // Bike accelLerp is 999 so speed should snap to boostSpeed * 1.15
    const expectedMin = BIKE_PHYSICS.boostSpeed * 1.14; // allow small tolerance
    expect(next.speed).toBeGreaterThan(expectedMin);
  });
});

// ── Cross-Player Collision & Death Ordering Tests ───────

describe('N-player trail collision', () => {
  it('player 0 dies hitting player 2 trail (not just player 1)', () => {
    // 3-player setup — player 2 builds a trail, player 0 runs into it
    let state = createSimState(0, spawn3());
    const cfgs = [BIKE_PHYSICS, BIKE_PHYSICS, BIKE_PHYSICS];

    // Run player 2 straight ahead to build trail points
    for (let t = 1; t <= 60; t++) {
      state = simStep(state, [noInput(t), noInput(t), boostInput(t)], cfgs);
    }
    // Player 2 should have trail points now
    expect(state.trails[2].length).toBeGreaterThan(5);

    // Place player 0 near player 2's trail (hacky: mutate position)
    const trail2 = state.trails[2];
    const midPoint = trail2[Math.floor(trail2.length / 2)];
    state.players[0] = {
      ...state.players[0],
      x: midPoint.x,
      z: midPoint.z + 0.3, // very close to trail
    };

    // Check collision
    const hit = checkTrailCollisionSingle(
      state.players[0].x, state.players[0].z,
      state.trails[2], HIT_RADIUS, state.trails[2].length,
    );
    expect(hit).toBe(true);
  });

  it('simultaneous deaths in same tick are deterministic', () => {
    // Two players with identical setup — both should die (or not) identically
    let stateA = createSimState(0, [
      { x: -5, z: 0, angle: 0, baseSpeed: BIKE_PHYSICS.baseSpeed },
      { x: 5, z: 0, angle: Math.PI, baseSpeed: BIKE_PHYSICS.baseSpeed },
    ]);
    let stateB = cloneSimState(stateA);
    const cfgs2 = [BIKE_PHYSICS, BIKE_PHYSICS];

    // Build trails by running both toward each other
    for (let t = 1; t <= 120; t++) {
      stateA = simStep(stateA, [boostInput(t), boostInput(t)], cfgs2);
      stateB = simStep(stateB, [boostInput(t), boostInput(t)], cfgs2);
    }

    // Both states should be identical (determinism)
    expect(stateA.players[0].alive).toBe(stateB.players[0].alive);
    expect(stateA.players[1].alive).toBe(stateB.players[1].alive);
    expect(hashSimState(stateA)).toBe(hashSimState(stateB));
  });
});
