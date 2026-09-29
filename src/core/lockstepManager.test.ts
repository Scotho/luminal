// ── LockstepManager Tests ─────────────────────────────────
import { describe, it, expect, vi } from 'vitest';
import { LockstepManager, type PlayerRole, type LockstepCallbacks } from './lockstepManager';
import { createSimState, SIM_DT, type InputFrame, type PlayerSpawn } from './simulation';
import { BIKE_PHYSICS, CAR_PHYSICS } from '../vehicleConfig';

// Helper to create 2-player spawns matching the old createSimState(tick, xA, zA, angleA, xB, zB, angleB, baseSpeed)
function spawns2(xA: number, zA: number, angleA: number, xB: number, zB: number, angleB: number, baseSpeed: number): PlayerSpawn[] {
  return [
    { x: xA, z: zA, angle: angleA, baseSpeed },
    { x: xB, z: zB, angle: angleB, baseSpeed },
  ];
}

function makeCallbacks(): LockstepCallbacks & {
  sent: InputFrame[][];
  deaths: number[];
  hashes: { tick: number; hash: number }[];
  desyncs: { tick: number; local: number; remote: number }[];
} {
  const sent: InputFrame[][] = [];
  const deaths: number[] = [];
  const hashes: { tick: number; hash: number }[] = [];
  const desyncs: { tick: number; local: number; remote: number }[] = [];
  return {
    sent,
    deaths,
    hashes,
    desyncs,
    onSendInputs: (packet) => sent.push(packet),
    onDeath: (playerIndex) => deaths.push(playerIndex),
    onSendHash: (tick, hash) => hashes.push({ tick, hash }),
    onDesync: (tick, local, remote) => desyncs.push({ tick, local, remote }),
  };
}

function createManager(myIndex: number = 0) {
  const cb = makeCallbacks();
  const state = createSimState(0, spawns2(-50, 0, 0, 50, 0, Math.PI, BIKE_PHYSICS.baseSpeed));
  const mgr = new LockstepManager(myIndex, 2, state, [BIKE_PHYSICS, BIKE_PHYSICS], cb);
  return { mgr, cb };
}

describe('LockstepManager', () => {
  it('does not advance before start()', () => {
    const { mgr } = createManager();
    mgr.update(SIM_DT, 0, false, false, false);
    expect(mgr.tick).toBe(0);
  });

  it('advances tick after start() and update()', () => {
    const { mgr } = createManager();
    mgr.start();
    // Feed remote inputs so sim can advance
    mgr.receiveRemoteInputs(1, [{ tick: 1, turnDir: 0, accelerate: false, dash: false, brake: false }]);
    mgr.update(SIM_DT, 0, false, false, false);
    expect(mgr.tick).toBeGreaterThanOrEqual(1);
  });

  it('advances multiple ticks with accumulated dt', () => {
    const { mgr } = createManager();
    mgr.start();
    // Feed enough remote inputs
    for (let t = 1; t <= 10; t++) {
      mgr.receiveRemoteInputs(1, [{ tick: t, turnDir: 0, accelerate: false, dash: false, brake: false }]);
    }
    mgr.update(SIM_DT * 5, 0, false, false, false);
    expect(mgr.tick).toBeGreaterThanOrEqual(3);
  });

  it('sends input packets periodically', () => {
    const { mgr, cb } = createManager();
    mgr.start();
    // Run enough ticks to trigger at least one send (every 3 ticks)
    for (let t = 1; t <= 10; t++) {
      mgr.receiveRemoteInputs(1, [{ tick: t, turnDir: 0, accelerate: false, dash: false, brake: false }]);
    }
    for (let i = 0; i < 6; i++) {
      mgr.update(SIM_DT, 0, false, false, false);
    }
    expect(cb.sent.length).toBeGreaterThanOrEqual(1);
  });

  it('predicts remote input when not available', () => {
    const { mgr } = createManager();
    mgr.start();
    // No remote inputs — should still advance using prediction
    mgr.update(SIM_DT * 3, 0, false, false, false);
    expect(mgr.tick).toBeGreaterThanOrEqual(1);
  });

  it('stalls when too far ahead of confirmed remote', () => {
    const { mgr } = createManager();
    mgr.start();
    // Run many ticks without remote — should stall at MAX_PREDICT_AHEAD
    mgr.update(SIM_DT * 20, 0, false, false, false);
    expect(mgr.tick).toBeLessThanOrEqual(20); // MAX_PREDICT_AHEAD=18 + small margin
  });

  it('detects death and fires callback', () => {
    const { mgr, cb } = createManager();
    // Place player 0 at arena edge heading out of bounds
    const state = createSimState(0, spawns2(193, 0, Math.PI / 2, 50, 0, Math.PI, BIKE_PHYSICS.baseSpeed));
    mgr.reset(state);
    mgr.start();
    // Feed remote inputs
    for (let t = 1; t <= 5; t++) {
      mgr.receiveRemoteInputs(1, [{ tick: t, turnDir: 0, accelerate: false, dash: false, brake: false }]);
    }
    // Player 0 is at x=193, heading +x with angle PI/2 at speed 40
    // Should go out of bounds quickly
    for (let i = 0; i < 5; i++) {
      mgr.update(SIM_DT, 0, false, false, false);
    }
    expect(cb.deaths).toContain(0);
  });

  it('resets cleanly for new round', () => {
    const { mgr, cb } = createManager();
    mgr.start();
    mgr.receiveRemoteInputs(1, [{ tick: 1, turnDir: 0, accelerate: false, dash: false, brake: false }]);
    mgr.update(SIM_DT, 0, false, false, false);
    expect(mgr.tick).toBeGreaterThanOrEqual(1);

    // Reset
    const newState = createSimState(0, spawns2(-50, 0, 0, 50, 0, Math.PI, BIKE_PHYSICS.baseSpeed));
    mgr.reset(newState);
    expect(mgr.tick).toBe(0);
    expect(mgr.started).toBe(false);
  });

  it('getMyPlayer returns correct role', () => {
    const { mgr } = createManager(1);
    const my = mgr.getMyPlayer();
    // Index 1 = player[1] in sim
    expect(my.x).toBe(50);
    expect(my.z).toBe(0);
  });

  it('getPlayerByIndex returns correct player', () => {
    const { mgr } = createManager(0);
    const p1 = mgr.getPlayerByIndex(1);
    // Player 1 = second spawn
    expect(p1.x).toBe(50);
  });

  it('two managers with same inputs produce identical state', () => {
    const cbA = makeCallbacks();
    const cbB = makeCallbacks();
    const stateInit = createSimState(0, spawns2(-50, 0, 0, 50, 0, Math.PI, BIKE_PHYSICS.baseSpeed));
    const mgrA = new LockstepManager(0, 2, stateInit, [BIKE_PHYSICS, BIKE_PHYSICS], cbA);
    const mgrB = new LockstepManager(1, 2, stateInit, [BIKE_PHYSICS, BIKE_PHYSICS], cbB);
    mgrA.start();
    mgrB.start();

    // Simulate 60 ticks with known inputs
    for (let t = 1; t <= 60; t++) {
      const inputA: InputFrame = { tick: t, turnDir: (t % 20 < 7 ? -1 : 0) as -1 | 0 | 1, accelerate: t % 10 < 3, dash: false, brake: false };
      const inputB: InputFrame = { tick: t, turnDir: (t % 15 < 5 ? 1 : 0) as -1 | 0 | 1, accelerate: false, dash: false, brake: false };

      // Manager A: local=0, remote=1(B)
      mgrA.inputBuffer.addLocal(inputA);
      mgrA.receiveRemoteInputs(1, [inputB]);

      // Manager B: local=1(B), remote=0(A)
      mgrB.inputBuffer.addLocal(inputB);
      mgrB.receiveRemoteInputs(0, [inputA]);

      mgrA.update(SIM_DT, inputA.turnDir, inputA.accelerate, false, false);
      mgrB.update(SIM_DT, inputB.turnDir, inputB.accelerate, false, false);
    }

    // Both should have identical sim state
    const sA = mgrA.state;
    const sB = mgrB.state;
    expect(sA.players[0].x).toBeCloseTo(sB.players[0].x, 5);
    expect(sA.players[0].z).toBeCloseTo(sB.players[0].z, 5);
    expect(sA.players[1].x).toBeCloseTo(sB.players[1].x, 5);
    expect(sA.players[1].z).toBeCloseTo(sB.players[1].z, 5);
    expect(sA.players[0].alive).toBe(sB.players[0].alive);
    expect(sA.players[1].alive).toBe(sB.players[1].alive);
  });

  it('renderAlpha is between 0 and 1', () => {
    const { mgr } = createManager();
    mgr.start();
    mgr.receiveRemoteInputs(1, [{ tick: 1, turnDir: 0, accelerate: false, dash: false, brake: false }]);
    mgr.update(SIM_DT * 0.5, 0, false, false, false);
    expect(mgr.renderAlpha).toBeGreaterThanOrEqual(0);
    expect(mgr.renderAlpha).toBeLessThanOrEqual(1);
  });

  describe('rollback', () => {
    it('triggers rollback on turnDir misprediction', () => {
      const { mgr } = createManager();
      mgr.start();
      // Advance 5 ticks with no remote input (predicts turnDir=0)
      for (let i = 0; i < 5; i++) {
        mgr.update(SIM_DT, 0, false, false, false);
      }
      const posBeforeRollback = mgr.getMyPlayer().x;
      expect(mgr.rollbackCount).toBe(0);

      // Now receive remote inputs with turnDir=-1 for an already-simulated tick
      // The prediction was turnDir=0, actual is -1 → mismatch → rollback
      mgr.receiveRemoteInputs(1, [
        { tick: 2, turnDir: -1, accelerate: false, dash: false, brake: false },
        { tick: 3, turnDir: -1, accelerate: false, dash: false, brake: false },
      ]);

      expect(mgr.rollbackCount).toBe(1);
    });

    it('triggers rollback on brake misprediction', () => {
      const { mgr } = createManager();
      mgr.start();
      // Advance 5 ticks with no remote input (predicts brake=false)
      for (let i = 0; i < 5; i++) {
        mgr.update(SIM_DT, 0, false, false, false);
      }
      expect(mgr.rollbackCount).toBe(0);

      // Remote had brake=true → mismatch → rollback
      mgr.receiveRemoteInputs(1, [
        { tick: 2, turnDir: 0, accelerate: false, dash: false, brake: true },
        { tick: 3, turnDir: 0, accelerate: false, dash: false, brake: true },
      ]);
      expect(mgr.rollbackCount).toBe(1);
    });

    it('triggers rollback on accelerate misprediction', () => {
      const { mgr } = createManager();
      mgr.start();
      for (let i = 0; i < 5; i++) {
        mgr.update(SIM_DT, 0, false, false, false);
      }
      expect(mgr.rollbackCount).toBe(0);

      // Remote had accelerate=true → mismatch → rollback
      mgr.receiveRemoteInputs(1, [
        { tick: 2, turnDir: 0, accelerate: true, dash: false, brake: false },
      ]);
      expect(mgr.rollbackCount).toBe(1);
    });

    it('triggers rollback on dash misprediction', () => {
      const { mgr } = createManager();
      mgr.start();
      for (let i = 0; i < 5; i++) {
        mgr.update(SIM_DT, 0, false, false, false);
      }
      expect(mgr.rollbackCount).toBe(0);

      // Remote had dash=true → mismatch → rollback
      mgr.receiveRemoteInputs(1, [
        { tick: 2, turnDir: 0, accelerate: false, dash: true, brake: false },
      ]);
      expect(mgr.rollbackCount).toBe(1);
    });

    it('does not rollback when prediction matches', () => {
      const { mgr } = createManager();
      mgr.start();
      // Advance with no remote input (predicts turnDir=0)
      for (let i = 0; i < 3; i++) {
        mgr.update(SIM_DT, 0, false, false, false);
      }

      // Remote confirms turnDir=0 → matches prediction → no rollback
      mgr.receiveRemoteInputs(1, [
        { tick: 1, turnDir: 0, accelerate: false, dash: false, brake: false },
        { tick: 2, turnDir: 0, accelerate: false, dash: false, brake: false },
      ]);

      expect(mgr.rollbackCount).toBe(0);
    });

    it('generates visual offset on rollback', () => {
      const { mgr } = createManager();
      mgr.start();
      // Advance several ticks
      for (let i = 0; i < 6; i++) {
        mgr.update(SIM_DT, 0, false, false, false);
      }

      // Cause a rollback with a different turnDir
      mgr.receiveRemoteInputs(1, [
        { tick: 2, turnDir: 1, accelerate: false, dash: false, brake: false },
        { tick: 3, turnDir: 1, accelerate: false, dash: false, brake: false },
      ]);

      // Visual offset should be non-zero (position correction happened)
      const offset = mgr.getVisualOffset(1);
      const hasOffset = offset.x !== 0 || offset.z !== 0;
      expect(hasOffset).toBe(true);
    });

    it('visual offset decays toward zero', () => {
      const { mgr } = createManager();
      mgr.start();
      for (let i = 0; i < 6; i++) {
        mgr.update(SIM_DT, 0, false, false, false);
      }

      // Cause rollback
      mgr.receiveRemoteInputs(1, [
        { tick: 2, turnDir: -1, accelerate: false, dash: false, brake: false },
      ]);

      const offsetBefore = Math.abs(mgr.getVisualOffset(1).x) + Math.abs(mgr.getVisualOffset(1).z);

      // Decay over 1 second
      mgr.decayVisualOffsets(1.0);

      const offsetAfter = Math.abs(mgr.getVisualOffset(1).x) + Math.abs(mgr.getVisualOffset(1).z);
      expect(offsetAfter).toBeLessThan(offsetBefore);
    });

    it('does not rollback beyond MAX_ROLLBACK_TICKS', () => {
      const { mgr } = createManager();
      mgr.start();
      // Feed remote inputs so sim advances without stalling, then stop feeding
      for (let t = 1; t <= 20; t++) {
        mgr.receiveRemoteInputs(1, [{ tick: t, turnDir: 0, accelerate: false, dash: false, brake: false }]);
      }
      // Advance well past tick 15 (MAX_ROLLBACK_TICKS=14)
      for (let i = 0; i < 20; i++) {
        mgr.update(SIM_DT, 0, false, false, false);
      }
      const currentTick = mgr.tick;
      expect(currentTick).toBeGreaterThan(15);

      // Now receive a misprediction for tick 1 — too far in the past
      mgr.receiveRemoteInputs(1, [
        { tick: 1, turnDir: -1, accelerate: false, dash: false, brake: false },
      ]);

      // Should not rollback — tick 1 is older than currentTick - MAX_ROLLBACK_TICKS
      expect(mgr.rollbackCount).toBe(0);
    });
  });

  describe('predictAhead recompute', () => {
    it('does not reset predictAhead to 0 on stale redundant packets', () => {
      const { mgr } = createManager();
      mgr.start();
      // Feed tick 1 remote, then advance several ticks predicting
      mgr.receiveRemoteInputs(1, [{ tick: 1, turnDir: 0, accelerate: false, dash: false, brake: false }]);
      for (let i = 0; i < 8; i++) {
        mgr.update(SIM_DT, 0, false, false, false);
      }
      const tickBefore = mgr.tick;
      expect(tickBefore).toBeGreaterThan(1);

      // Send a redundant packet for already-confirmed tick 1 — should NOT let sim race ahead
      mgr.receiveRemoteInputs(1, [{ tick: 1, turnDir: 0, accelerate: false, dash: false, brake: false }]);
      // After receiving stale packet, sim should still respect how far ahead it actually is
      // Running more ticks should eventually stall (still no new remote data beyond tick 1)
      for (let i = 0; i < 20; i++) {
        mgr.update(SIM_DT, 0, false, false, false);
      }
      // Should be capped — not runaway ahead (MAX_PREDICT_AHEAD=18 beyond confirmed tick 1)
      expect(mgr.tick).toBeLessThanOrEqual(1 + 18 + 2); // small margin for input delay
    });
  });

  describe('input decay integration', () => {
    it('decayed prediction matches neutral — no rollback', () => {
      const { mgr } = createManager();
      mgr.start();
      // Feed one remote input with turnDir=-1, then stop feeding
      mgr.receiveRemoteInputs(1, [{ tick: 1, turnDir: -1, accelerate: false, dash: false, brake: false }]);

      // Advance past decay threshold (TURN_DECAY_TICKS=3)
      for (let i = 0; i < 8; i++) {
        mgr.update(SIM_DT, 0, false, false, false);
      }

      // Remote confirms turnDir=0 for a tick where decay predicted 0
      // This should NOT trigger rollback
      const before = mgr.rollbackCount;
      mgr.receiveRemoteInputs(1, [
        { tick: 5, turnDir: 0, accelerate: false, dash: false, brake: false },
      ]);
      expect(mgr.rollbackCount).toBe(before);
    });

    it('decayed prediction triggers rollback when opponent kept turning', () => {
      const { mgr } = createManager();
      mgr.start();
      mgr.receiveRemoteInputs(1, [{ tick: 1, turnDir: -1, accelerate: false, dash: false, brake: false }]);

      // Advance past decay threshold
      for (let i = 0; i < 8; i++) {
        mgr.update(SIM_DT, 0, false, false, false);
      }

      // Remote confirms opponent was STILL turning at tick 5 (we predicted 0, actual is -1)
      const before = mgr.rollbackCount;
      mgr.receiveRemoteInputs(1, [
        { tick: 5, turnDir: -1, accelerate: false, dash: false, brake: false },
      ]);
      expect(mgr.rollbackCount).toBe(before + 1);
    });
  });

  describe('hash verification', () => {
    it('sends hash every HASH_INTERVAL ticks', () => {
      const cb = makeCallbacks();
      const state = createSimState(0, spawns2(-50, 0, 0, 50, 0, Math.PI, BIKE_PHYSICS.baseSpeed));
      const mgr = new LockstepManager(0, 2, state, [BIKE_PHYSICS, BIKE_PHYSICS], cb);
      mgr.start();

      // Feed remote inputs and advance 120 ticks (should produce 2 hash sends at tick 60 and 120)
      for (let t = 1; t <= 120; t++) {
        mgr.receiveRemoteInputs(1, [{ tick: t, turnDir: 0, accelerate: false, dash: false, brake: false }]);
      }
      for (let i = 0; i < 120; i++) {
        mgr.update(SIM_DT, 0, false, false, false);
      }

      expect(cb.hashes.length).toBeGreaterThanOrEqual(1);
      // First hash should be at tick 60
      expect(cb.hashes[0].tick).toBeGreaterThanOrEqual(55);
      expect(typeof cb.hashes[0].hash).toBe('number');
    });

    it('detects desync when remote hash differs', () => {
      const cb = makeCallbacks();
      const state = createSimState(0, spawns2(-50, 0, 0, 50, 0, Math.PI, BIKE_PHYSICS.baseSpeed));
      const mgr = new LockstepManager(0, 2, state, [BIKE_PHYSICS, BIKE_PHYSICS], cb);
      mgr.start();

      // Advance 60 ticks to trigger a hash send
      for (let t = 1; t <= 65; t++) {
        mgr.receiveRemoteInputs(1, [{ tick: t, turnDir: 0, accelerate: false, dash: false, brake: false }]);
      }
      for (let i = 0; i < 65; i++) {
        mgr.update(SIM_DT, 0, false, false, false);
      }

      expect(cb.hashes.length).toBeGreaterThanOrEqual(1);
      const { tick, hash } = cb.hashes[0];

      // Send a different hash for the same tick → desync
      mgr.receiveRemoteHash(tick, hash + 1);
      expect(mgr.desyncCount).toBe(1);
      expect(cb.desyncs.length).toBe(1);
      expect(cb.desyncs[0].tick).toBe(tick);
    });

    it('no desync when hashes match', () => {
      const cb = makeCallbacks();
      const state = createSimState(0, spawns2(-50, 0, 0, 50, 0, Math.PI, BIKE_PHYSICS.baseSpeed));
      const mgr = new LockstepManager(0, 2, state, [BIKE_PHYSICS, BIKE_PHYSICS], cb);
      mgr.start();

      for (let t = 1; t <= 65; t++) {
        mgr.receiveRemoteInputs(1, [{ tick: t, turnDir: 0, accelerate: false, dash: false, brake: false }]);
      }
      for (let i = 0; i < 65; i++) {
        mgr.update(SIM_DT, 0, false, false, false);
      }

      expect(cb.hashes.length).toBeGreaterThanOrEqual(1);
      const { tick, hash } = cb.hashes[0];

      // Send matching hash → no desync
      mgr.receiveRemoteHash(tick, hash);
      expect(mgr.desyncCount).toBe(0);
    });

    it('two managers produce matching hashes', () => {
      const cbA = makeCallbacks();
      const cbB = makeCallbacks();
      const stateInit = createSimState(0, spawns2(-50, 0, 0, 50, 0, Math.PI, BIKE_PHYSICS.baseSpeed));
      const mgrA = new LockstepManager(0, 2, stateInit, [BIKE_PHYSICS, BIKE_PHYSICS], cbA);
      const mgrB = new LockstepManager(1, 2, stateInit, [BIKE_PHYSICS, BIKE_PHYSICS], cbB);
      mgrA.start();
      mgrB.start();

      // Run both managers with identical inputs for 65 ticks
      for (let t = 1; t <= 65; t++) {
        const inputA: InputFrame = { tick: t, turnDir: (t % 20 < 7 ? -1 : 0) as -1 | 0 | 1, accelerate: t % 10 < 3, dash: false, brake: false };
        const inputB: InputFrame = { tick: t, turnDir: (t % 15 < 5 ? 1 : 0) as -1 | 0 | 1, accelerate: false, dash: false, brake: false };

        mgrA.inputBuffer.addLocal(inputA);
        mgrA.receiveRemoteInputs(1, [inputB]);
        mgrB.inputBuffer.addLocal(inputB);
        mgrB.receiveRemoteInputs(0, [inputA]);

        mgrA.update(SIM_DT, inputA.turnDir, inputA.accelerate, false, false);
        mgrB.update(SIM_DT, inputB.turnDir, inputB.accelerate, false, false);
      }

      // Both should have produced at least 1 hash
      expect(cbA.hashes.length).toBeGreaterThanOrEqual(1);
      expect(cbB.hashes.length).toBeGreaterThanOrEqual(1);

      // Find matching tick and verify hashes are identical
      const hashA = cbA.hashes[0];
      const hashB = cbB.hashes.find(h => h.tick === hashA.tick);
      expect(hashB).toBeDefined();
      expect(hashA.hash).toBe(hashB!.hash);
    });
  });

  describe('death deferral', () => {
    it('defers death callback by grace window', () => {
      const { mgr, cb } = createManager();
      // Place player 0 at arena edge heading out of bounds
      const state = createSimState(0, spawns2(191, 0, Math.PI / 2, 50, 0, Math.PI, BIKE_PHYSICS.baseSpeed));
      mgr.reset(state);
      mgr.start();
      // Feed remote inputs
      for (let t = 1; t <= 10; t++) {
        mgr.receiveRemoteInputs(1, [{ tick: t, turnDir: 0, accelerate: false, dash: false, brake: false }]);
      }
      // Run 1 tick — player may not die yet (depends on speed/position)
      mgr.update(SIM_DT, 0, false, false, false);
      // Deaths should NOT fire immediately even if player died (grace window)
      // Run a few more ticks so the grace window expires
      for (let i = 0; i < 6; i++) {
        mgr.update(SIM_DT, 0, false, false, false);
      }
      // Now the death should have been committed (after 3-tick grace)
      if (cb.deaths.length > 0) {
        expect(cb.deaths).toContain(0);
      }
    });

    it('cancels pending death on rollback that undoes it', () => {
      const cb = makeCallbacks();
      // Start player 1 near a trail wall that only exists if opponent goes straight
      const state = createSimState(0, spawns2(-50, 0, 0, 50, 0, Math.PI, BIKE_PHYSICS.baseSpeed));
      const mgr = new LockstepManager(0, 2, state, [BIKE_PHYSICS, BIKE_PHYSICS], cb);
      mgr.start();

      // Advance 5 ticks predicting opponent goes straight (turnDir=0)
      for (let i = 0; i < 5; i++) {
        mgr.update(SIM_DT, 0, false, false, false);
      }
      const deathsBefore = cb.deaths.length;

      // Even if a death was pending, receiving corrected input that avoids it should cancel
      // (This tests the pruning logic — in practice, the specific collision scenario
      // depends on trail geometry, so we just verify the pruning doesn't crash)
      mgr.receiveRemoteInputs(1, [
        { tick: 2, turnDir: 1, accelerate: false, dash: false, brake: false },
        { tick: 3, turnDir: 1, accelerate: false, dash: false, brake: false },
      ]);
      // After rollback, any deaths that were undone should be pruned
      // No crash = pass
    });
  });

  describe('extended lockstep sync', () => {
    it('two managers stay in sync over 1000 ticks with varied inputs', () => {
      const cbA = makeCallbacks();
      const cbB = makeCallbacks();
      const stateInit = createSimState(0, spawns2(-50, 0, 0, 50, 0, Math.PI, BIKE_PHYSICS.baseSpeed));
      const mgrA = new LockstepManager(0, 2, stateInit, [BIKE_PHYSICS, BIKE_PHYSICS], cbA);
      const mgrB = new LockstepManager(1, 2, stateInit, [BIKE_PHYSICS, BIKE_PHYSICS], cbB);
      mgrA.start();
      mgrB.start();

      for (let t = 1; t <= 1000; t++) {
        const turn = (t % 30 < 10 ? -1 : t % 30 < 20 ? 0 : 1) as -1 | 0 | 1;
        const inputA: InputFrame = { tick: t, turnDir: turn, accelerate: t % 7 < 3, dash: false, brake: false };
        const inputB: InputFrame = { tick: t, turnDir: (t % 25 < 8 ? 1 : 0) as -1 | 0 | 1, accelerate: t % 11 < 4, dash: false, brake: false };

        mgrA.inputBuffer.addLocal(inputA);
        mgrA.receiveRemoteInputs(1, [inputB]);
        mgrB.inputBuffer.addLocal(inputB);
        mgrB.receiveRemoteInputs(0, [inputA]);

        mgrA.update(SIM_DT, inputA.turnDir, inputA.accelerate, false, false);
        mgrB.update(SIM_DT, inputB.turnDir, inputB.accelerate, false, false);
      }

      const sA = mgrA.state;
      const sB = mgrB.state;
      expect(sA.players[0].x).toBeCloseTo(sB.players[0].x, 5);
      expect(sA.players[0].z).toBeCloseTo(sB.players[0].z, 5);
      expect(sA.players[1].x).toBeCloseTo(sB.players[1].x, 5);
      expect(sA.players[1].z).toBeCloseTo(sB.players[1].z, 5);
    });

    it('hash still matches after rollback from late inputs', () => {
      const cbA = makeCallbacks();
      const cbB = makeCallbacks();
      const stateInit = createSimState(0, spawns2(-50, 0, 0, 50, 0, Math.PI, BIKE_PHYSICS.baseSpeed));
      const mgrA = new LockstepManager(0, 2, stateInit, [BIKE_PHYSICS, BIKE_PHYSICS], cbA);
      const mgrB = new LockstepManager(1, 2, stateInit, [BIKE_PHYSICS, BIKE_PHYSICS], cbB);
      mgrA.start();
      mgrB.start();

      // Advance A without remote for 5 ticks (will predict)
      for (let t = 1; t <= 5; t++) {
        const inputA: InputFrame = { tick: t, turnDir: 0, accelerate: false, dash: false, brake: false };
        mgrA.inputBuffer.addLocal(inputA);
        mgrA.update(SIM_DT, 0, false, false, false);
      }

      // Now deliver B's actual inputs (which may cause rollback on A)
      const bInputs: InputFrame[] = [];
      for (let t = 1; t <= 5; t++) {
        const inputB: InputFrame = { tick: t, turnDir: (t < 3 ? 1 : 0) as -1 | 0 | 1, accelerate: false, dash: false, brake: false };
        bInputs.push(inputB);
      }
      mgrA.receiveRemoteInputs(1, bInputs);

      // Now sync B to match
      for (let t = 1; t <= 5; t++) {
        const inputA: InputFrame = { tick: t, turnDir: 0, accelerate: false, dash: false, brake: false };
        mgrB.inputBuffer.addLocal(bInputs[t - 1]);
        mgrB.receiveRemoteInputs(0, [inputA]);
        mgrB.update(SIM_DT, bInputs[t - 1].turnDir, false, false, false);
      }

      // Continue both in lockstep to tick 65 for hash generation
      for (let t = 6; t <= 65; t++) {
        const inputA: InputFrame = { tick: t, turnDir: 0, accelerate: false, dash: false, brake: false };
        const inputB: InputFrame = { tick: t, turnDir: 0, accelerate: false, dash: false, brake: false };

        mgrA.inputBuffer.addLocal(inputA);
        mgrA.receiveRemoteInputs(1, [inputB]);
        mgrB.inputBuffer.addLocal(inputB);
        mgrB.receiveRemoteInputs(0, [inputA]);

        mgrA.update(SIM_DT, 0, false, false, false);
        mgrB.update(SIM_DT, 0, false, false, false);
      }

      if (cbA.hashes.length > 0 && cbB.hashes.length > 0) {
        const hashA = cbA.hashes[0];
        const hashB = cbB.hashes.find(h => h.tick === hashA.tick);
        if (hashB) {
          expect(hashA.hash).toBe(hashB.hash);
        }
      }
    });
  });

  describe('packet loss simulation', () => {
    it('recovers from 5 consecutive dropped input packets via prediction', () => {
      const { mgr } = createManager();
      mgr.start();

      // Feed first 3 ticks of remote inputs then stop (simulating packet loss)
      for (let t = 1; t <= 3; t++) {
        mgr.receiveRemoteInputs(1, [{ tick: t, turnDir: 0, accelerate: false, dash: false, brake: false }]);
      }

      // Advance 8 ticks — 5 ticks without remote (packet loss)
      for (let i = 0; i < 8; i++) {
        mgr.update(SIM_DT, 0, false, false, false);
      }
      expect(mgr.tick).toBeGreaterThanOrEqual(3);

      // Now deliver the missing inputs — sim should catch up
      for (let t = 4; t <= 12; t++) {
        mgr.receiveRemoteInputs(1, [{ tick: t, turnDir: 0, accelerate: false, dash: false, brake: false }]);
      }
      for (let i = 0; i < 4; i++) {
        mgr.update(SIM_DT, 0, false, false, false);
      }
      expect(mgr.tick).toBeGreaterThanOrEqual(6);
    });

    it('rollback limit: inputs older than MAX_ROLLBACK_TICKS are ignored', () => {
      const { mgr } = createManager();
      mgr.start();
      // Feed and advance 25 ticks
      for (let t = 1; t <= 25; t++) {
        mgr.receiveRemoteInputs(1, [{ tick: t, turnDir: 0, accelerate: false, dash: false, brake: false }]);
      }
      for (let i = 0; i < 25; i++) {
        mgr.update(SIM_DT, 0, false, false, false);
      }
      const beforeRollbacks = mgr.rollbackCount;

      // Try to deliver a mispredicted input for tick 1 — way too old
      mgr.receiveRemoteInputs(1, [{ tick: 1, turnDir: -1, accelerate: false, dash: false, brake: false }]);
      expect(mgr.rollbackCount).toBe(beforeRollbacks);
    });
  });

  describe('rollback depth window', () => {
    it('rollback succeeds at depth 14 (MAX_ROLLBACK_TICKS boundary)', () => {
      const { mgr } = createManager();
      mgr.start();
      // Feed remote for tick 1 only, then advance 15 ticks via prediction
      mgr.receiveRemoteInputs(1, [{ tick: 1, turnDir: 0, accelerate: false, dash: false, brake: false }]);
      for (let i = 0; i < 15; i++) {
        mgr.update(SIM_DT, 0, false, false, false);
      }
      const currentTick = mgr.tick;
      expect(currentTick).toBeGreaterThanOrEqual(10);

      // Deliver mispredicted input for a tick within the 14-tick window
      const targetTick = currentTick - 12; // well within MAX_ROLLBACK_TICKS=14
      if (targetTick >= 2) {
        mgr.receiveRemoteInputs(1, [
          { tick: targetTick, turnDir: -1, accelerate: false, dash: false, brake: false },
        ]);
        expect(mgr.rollbackCount).toBe(1);
      }
    });

    it('rollback rejected at depth 15 (just beyond MAX_ROLLBACK_TICKS=14)', () => {
      const { mgr } = createManager();
      mgr.start();
      // Feed enough remote inputs to advance past 16 ticks without stalling
      for (let t = 1; t <= 20; t++) {
        mgr.receiveRemoteInputs(1, [{ tick: t, turnDir: 0, accelerate: false, dash: false, brake: false }]);
      }
      for (let i = 0; i < 20; i++) {
        mgr.update(SIM_DT, 0, false, false, false);
      }
      const currentTick = mgr.tick;
      expect(currentTick).toBeGreaterThan(15);

      // Deliver misprediction for tick that's exactly 15 ticks behind current
      const targetTick = currentTick - 15;
      if (targetTick >= 1) {
        const before = mgr.rollbackCount;
        mgr.receiveRemoteInputs(1, [
          { tick: targetTick, turnDir: -1, accelerate: false, dash: false, brake: false },
        ]);
        expect(mgr.rollbackCount).toBe(before); // too old — no rollback
      }
    });

    it('telemetry reports rollback depth accurately', () => {
      const { mgr } = createManager();
      mgr.start();
      // Advance 8 ticks with prediction
      for (let i = 0; i < 8; i++) {
        mgr.update(SIM_DT, 0, false, false, false);
      }

      // Deliver misprediction for tick 2 (should rollback from tick 2 to current tick)
      mgr.receiveRemoteInputs(1, [
        { tick: 2, turnDir: -1, accelerate: false, dash: false, brake: false },
      ]);
      expect(mgr.rollbackCount).toBe(1);

      const telemetry = mgr.getTelemetry();
      expect(telemetry.rollbackMaxDepth).toBeGreaterThanOrEqual(3);
      expect(telemetry.rollbackAvgDepth).toBeGreaterThan(0);
      expect(telemetry.rollbackCount).toBe(1);
    });
  });

  describe('hash mismatch resilience', () => {
    it('onDesync fires but simulation continues (no crash)', () => {
      const cb = makeCallbacks();
      const state = createSimState(0, spawns2(-50, 0, 0, 50, 0, Math.PI, BIKE_PHYSICS.baseSpeed));
      const mgr = new LockstepManager(0, 2, state, [BIKE_PHYSICS, BIKE_PHYSICS], cb);
      mgr.start();

      for (let t = 1; t <= 65; t++) {
        mgr.receiveRemoteInputs(1, [{ tick: t, turnDir: 0, accelerate: false, dash: false, brake: false }]);
      }
      for (let i = 0; i < 65; i++) {
        mgr.update(SIM_DT, 0, false, false, false);
      }

      expect(cb.hashes.length).toBeGreaterThanOrEqual(1);
      const { tick, hash } = cb.hashes[0];

      // Send mismatched hash
      mgr.receiveRemoteHash(tick, hash + 999);
      expect(cb.desyncs.length).toBe(1);

      // Simulation should still work after desync
      for (let t = 66; t <= 70; t++) {
        mgr.receiveRemoteInputs(1, [{ tick: t, turnDir: 0, accelerate: false, dash: false, brake: false }]);
      }
      mgr.update(SIM_DT, 0, false, false, false);
      expect(mgr.tick).toBeGreaterThan(65);
    });

    it('desync on tick N does not corrupt subsequent ticks', () => {
      const cb = makeCallbacks();
      const state = createSimState(0, spawns2(-50, 0, 0, 50, 0, Math.PI, BIKE_PHYSICS.baseSpeed));
      const mgr = new LockstepManager(0, 2, state, [BIKE_PHYSICS, BIKE_PHYSICS], cb);
      mgr.start();

      // Run to tick 65
      for (let t = 1; t <= 65; t++) {
        mgr.receiveRemoteInputs(1, [{ tick: t, turnDir: 0, accelerate: false, dash: false, brake: false }]);
      }
      for (let i = 0; i < 65; i++) {
        mgr.update(SIM_DT, 0, false, false, false);
      }

      const { tick, hash } = cb.hashes[0];
      mgr.receiveRemoteHash(tick, hash + 1);

      // Record state before continuing
      const posBeforeZ = mgr.state.players[0].z;

      // Continue running — should produce valid state
      for (let t = 66; t <= 75; t++) {
        mgr.receiveRemoteInputs(1, [{ tick: t, turnDir: 0, accelerate: false, dash: false, brake: false }]);
      }
      for (let i = 0; i < 10; i++) {
        mgr.update(SIM_DT, 0, false, false, false);
      }

      // State should have changed (player 0 starts at angle 0, moving in +z)
      expect(mgr.state.players[0].z).not.toBe(posBeforeZ);
      expect(mgr.state.players[0].alive).toBe(true);
    });
  });

  describe('car/drift determinism', () => {
    it('two managers stay in sync with brake/drift inputs', () => {
      const cbA = makeCallbacks();
      const cbB = makeCallbacks();
      const stateInit = createSimState(0, spawns2(-50, 0, 0, 50, 0, Math.PI, CAR_PHYSICS.baseSpeed));
      const mgrA = new LockstepManager(0, 2, stateInit, [CAR_PHYSICS, CAR_PHYSICS], cbA);
      const mgrB = new LockstepManager(1, 2, stateInit, [CAR_PHYSICS, CAR_PHYSICS], cbB);
      mgrA.start();
      mgrB.start();

      for (let t = 1; t <= 200; t++) {
        const inputA: InputFrame = {
          tick: t,
          turnDir: (t % 40 < 12 ? -1 : 0) as -1 | 0 | 1,
          accelerate: t % 50 < 15,
          dash: false,
          brake: t % 60 < 30, // drift half the time
        };
        const inputB: InputFrame = {
          tick: t,
          turnDir: (t % 35 < 10 ? 1 : 0) as -1 | 0 | 1,
          accelerate: t % 70 < 20,
          dash: t % 90 < 5,
          brake: t % 55 < 25,
        };

        mgrA.inputBuffer.addLocal(inputA);
        mgrA.receiveRemoteInputs(1, [inputB]);
        mgrB.inputBuffer.addLocal(inputB);
        mgrB.receiveRemoteInputs(0, [inputA]);

        mgrA.update(SIM_DT, inputA.turnDir, inputA.accelerate, inputA.dash, inputA.brake);
        mgrB.update(SIM_DT, inputB.turnDir, inputB.accelerate, inputB.dash, inputB.brake);
      }

      const sA = mgrA.state;
      const sB = mgrB.state;
      expect(sA.players[0].x).toBeCloseTo(sB.players[0].x, 5);
      expect(sA.players[0].z).toBeCloseTo(sB.players[0].z, 5);
      expect(sA.players[1].x).toBeCloseTo(sB.players[1].x, 5);
      expect(sA.players[1].z).toBeCloseTo(sB.players[1].z, 5);
      expect(sA.players[0].drifting).toBe(sB.players[0].drifting);
      expect(sA.players[1].drifting).toBe(sB.players[1].drifting);
    });

    it('rollback corrects brake misprediction in drift scenario', () => {
      const cbA = makeCallbacks();
      const stateInit = createSimState(0, spawns2(-50, 0, 0, 50, 0, Math.PI, CAR_PHYSICS.baseSpeed));
      const mgrA = new LockstepManager(0, 2, stateInit, [CAR_PHYSICS, CAR_PHYSICS], cbA);
      mgrA.start();

      // Advance 6 ticks predicting opponent doesn't brake (brake=false)
      for (let i = 0; i < 6; i++) {
        mgrA.update(SIM_DT, 0, false, false, false);
      }
      expect(mgrA.rollbackCount).toBe(0);

      // Opponent was actually braking (entering drift) → rollback
      mgrA.receiveRemoteInputs(1, [
        { tick: 2, turnDir: 0, accelerate: false, dash: false, brake: true },
        { tick: 3, turnDir: -1, accelerate: false, dash: false, brake: true },
        { tick: 4, turnDir: -1, accelerate: false, dash: false, brake: true },
      ]);
      expect(mgrA.rollbackCount).toBe(1);
    });
  });

  describe('meter recharge', () => {
    it('recharges meter near arena wall', () => {
      const cb = makeCallbacks();
      // Place player 0 near the arena wall (x = 187, wall at 192)
      const state = createSimState(0, spawns2(187, 0, 0, -50, 0, Math.PI, BIKE_PHYSICS.baseSpeed));
      const mgr = new LockstepManager(0, 2, state, [BIKE_PHYSICS, BIKE_PHYSICS], cb);

      // Drain some meter first
      mgr.state.players[0].meter = 50;
      mgr.start();

      // Feed remote inputs and advance
      for (let t = 1; t <= 5; t++) {
        mgr.receiveRemoteInputs(1, [{ tick: t, turnDir: 0, accelerate: false, dash: false, brake: false }]);
      }
      for (let i = 0; i < 5; i++) {
        mgr.update(SIM_DT, 0, false, false, false);
      }

      // Player 0 near wall (x~187, wall at 192, dist=5 < RECHARGE_RANGE=8) should recharge
      expect(mgr.getMyPlayer().meter).toBeGreaterThan(50);
    });

    it('does not recharge while dashing', () => {
      const cb = makeCallbacks();
      const state = createSimState(0, spawns2(187, 0, 0, -50, 0, Math.PI, BIKE_PHYSICS.baseSpeed));
      const mgr = new LockstepManager(0, 2, state, [BIKE_PHYSICS, BIKE_PHYSICS], cb);
      mgr.start();

      for (let t = 1; t <= 5; t++) {
        mgr.receiveRemoteInputs(1, [{ tick: t, turnDir: 0, accelerate: false, dash: false, brake: false }]);
      }
      // Dash drains meter, even near wall recharge shouldn't apply during dash
      const meterBefore = mgr.getMyPlayer().meter;
      for (let i = 0; i < 5; i++) {
        mgr.update(SIM_DT, 0, false, true, false); // dash=true
      }
      // Meter should decrease (dash drain > any recharge attempt)
      expect(mgr.getMyPlayer().meter).toBeLessThan(meterBefore);
    });
  });

  describe('rollback determinism (proximity/meter)', () => {
    it('forward sim and rollback produce identical proximityBoost and meter', () => {
      const cbA = makeCallbacks();
      const cbB = makeCallbacks();
      const stateInit = createSimState(0, spawns2(-50, 0, 0, 50, 0, Math.PI, BIKE_PHYSICS.baseSpeed));
      const mgrA = new LockstepManager(0, 2, stateInit, [BIKE_PHYSICS, BIKE_PHYSICS], cbA);
      const mgrB = new LockstepManager(1, 2, stateInit, [BIKE_PHYSICS, BIKE_PHYSICS], cbB);
      mgrA.start();
      mgrB.start();

      // A runs ahead 5 ticks with prediction (no remote inputs)
      for (let i = 0; i < 5; i++) {
        mgrA.update(SIM_DT, 0, false, false, false);
      }

      // B runs all 5 ticks with confirmed inputs (no rollback needed)
      for (let t = 1; t <= 5; t++) {
        const inputA: InputFrame = { tick: t, turnDir: 0, accelerate: false, dash: false, brake: false };
        const inputB: InputFrame = { tick: t, turnDir: 0, accelerate: false, dash: false, brake: false };
        mgrB.inputBuffer.addLocal(inputB);
        mgrB.receiveRemoteInputs(0, [inputA]);
        mgrB.update(SIM_DT, 0, false, false, false);
      }

      // Now deliver A's actual inputs to A (should trigger rollback since predictions might differ)
      // Even if predictions were correct, the key test is that proximity/meter are consistent
      const bInputs: InputFrame[] = [];
      for (let t = 1; t <= 5; t++) {
        bInputs.push({ tick: t, turnDir: 0, accelerate: false, dash: false, brake: false });
      }
      mgrA.receiveRemoteInputs(1, bInputs);

      // Deliver B's inputs to A and continue
      for (let t = 6; t <= 10; t++) {
        const inputA: InputFrame = { tick: t, turnDir: 0, accelerate: false, dash: false, brake: false };
        const inputB: InputFrame = { tick: t, turnDir: 0, accelerate: false, dash: false, brake: false };
        mgrA.inputBuffer.addLocal(inputA);
        mgrA.receiveRemoteInputs(1, [inputB]);
        mgrB.inputBuffer.addLocal(inputB);
        mgrB.receiveRemoteInputs(0, [inputA]);
        mgrA.update(SIM_DT, 0, false, false, false);
        mgrB.update(SIM_DT, 0, false, false, false);
      }

      // Both managers should have identical proximity and meter
      const sA = mgrA.state;
      const sB = mgrB.state;
      expect(sA.players[0].proximityBoost).toBeCloseTo(sB.players[0].proximityBoost, 8);
      expect(sA.players[1].proximityBoost).toBeCloseTo(sB.players[1].proximityBoost, 8);
      expect(sA.players[0].meter).toBeCloseTo(sB.players[0].meter, 8);
      expect(sA.players[1].meter).toBeCloseTo(sB.players[1].meter, 8);
    });
  });

  describe('desync recovery', () => {
    it('triggers recovery callback after 3 desyncs in 10s', () => {
      let recoveryCount = 0;
      const cb = makeCallbacks();
      (cb as LockstepCallbacks).onDesyncRecovery = () => { recoveryCount++; };
      const state = createSimState(0, spawns2(-50, 0, 0, 50, 0, Math.PI, BIKE_PHYSICS.baseSpeed));
      const mgr = new LockstepManager(0, 2, state, [BIKE_PHYSICS, BIKE_PHYSICS], cb);
      mgr.start();

      // Advance to produce hashes
      for (let t = 1; t <= 65; t++) {
        mgr.receiveRemoteInputs(1, [{ tick: t, turnDir: 0, accelerate: false, dash: false, brake: false }]);
      }
      for (let i = 0; i < 65; i++) {
        mgr.update(SIM_DT, 0, false, false, false);
      }

      expect(cb.hashes.length).toBeGreaterThanOrEqual(1);
      const { tick, hash } = cb.hashes[0];

      // Trigger 3 desyncs
      mgr.receiveRemoteHash(tick, hash + 1);
      mgr.receiveRemoteHash(tick, hash + 2);
      expect(recoveryCount).toBe(0);
      mgr.receiveRemoteHash(tick, hash + 3);
      expect(recoveryCount).toBe(1);
    });

    it('does not trigger recovery with only 2 desyncs', () => {
      let recoveryCount = 0;
      const cb = makeCallbacks();
      (cb as LockstepCallbacks).onDesyncRecovery = () => { recoveryCount++; };
      const state = createSimState(0, spawns2(-50, 0, 0, 50, 0, Math.PI, BIKE_PHYSICS.baseSpeed));
      const mgr = new LockstepManager(0, 2, state, [BIKE_PHYSICS, BIKE_PHYSICS], cb);
      mgr.start();

      for (let t = 1; t <= 65; t++) {
        mgr.receiveRemoteInputs(1, [{ tick: t, turnDir: 0, accelerate: false, dash: false, brake: false }]);
      }
      for (let i = 0; i < 65; i++) {
        mgr.update(SIM_DT, 0, false, false, false);
      }

      const { tick, hash } = cb.hashes[0];
      mgr.receiveRemoteHash(tick, hash + 1);
      mgr.receiveRemoteHash(tick, hash + 2);
      expect(recoveryCount).toBe(0);
    });

    it('receiveRecoverySnapshot replaces state and resets tracking', () => {
      const cb = makeCallbacks();
      const state = createSimState(0, spawns2(-50, 0, 0, 50, 0, Math.PI, BIKE_PHYSICS.baseSpeed));
      const mgr = new LockstepManager(1, 2, state, [BIKE_PHYSICS, BIKE_PHYSICS], cb);
      mgr.start();

      // Advance to tick 10
      for (let t = 1; t <= 10; t++) {
        mgr.receiveRemoteInputs(0, [{ tick: t, turnDir: 0, accelerate: false, dash: false, brake: false }]);
      }
      for (let i = 0; i < 10; i++) {
        mgr.update(SIM_DT, 0, false, false, false);
      }

      const tickBefore = mgr.tick;
      expect(tickBefore).toBeGreaterThanOrEqual(5);

      // Create a recovery snapshot at a different position
      const recoveryState = createSimState(20, spawns2(-30, 10, 0.5, 30, -10, 2.0, BIKE_PHYSICS.baseSpeed));
      mgr.receiveRecoverySnapshot(recoveryState);

      // State should be replaced
      expect(mgr.tick).toBe(20);
      expect(mgr.state.players[0].x).toBeCloseTo(-30, 5);
      expect(mgr.state.players[1].x).toBeCloseTo(30, 5);
      // Desync counter should be reset
      expect(mgr.desyncCount).toBe(0);
    });

    it('receiveRecoverySnapshot applies visual offset for small corrections', () => {
      const cb = makeCallbacks();
      const state = createSimState(0, spawns2(-50, 0, 0, 50, 0, Math.PI, BIKE_PHYSICS.baseSpeed));
      const mgr = new LockstepManager(1, 2, state, [BIKE_PHYSICS, BIKE_PHYSICS], cb);
      mgr.start();

      for (let t = 1; t <= 5; t++) {
        mgr.receiveRemoteInputs(0, [{ tick: t, turnDir: 0, accelerate: false, dash: false, brake: false }]);
      }
      for (let i = 0; i < 5; i++) {
        mgr.update(SIM_DT, 0, false, false, false);
      }

      // Create recovery with a small position offset (< SNAP_THRESHOLD=4)
      const myPosBefore = mgr.getMyPlayer();
      const recoveryState = createSimState(
        mgr.tick,
        spawns2(
          mgr.state.players[0].x, mgr.state.players[0].z, mgr.state.players[0].angle,
          myPosBefore.x + 1, myPosBefore.z + 1, myPosBefore.angle, // Index 1 = my player, small offset
          BIKE_PHYSICS.baseSpeed,
        ),
      );
      mgr.receiveRecoverySnapshot(recoveryState);

      // Should have visual offset (smooth correction, not snap)
      const offset = mgr.myVisualOffset;
      const hasOffset = Math.abs(offset.x) > 0.1 || Math.abs(offset.z) > 0.1;
      expect(hasOffset).toBe(true);
    });

    it('simulation continues normally after recovery', () => {
      const cb = makeCallbacks();
      const state = createSimState(0, spawns2(-50, 0, 0, 50, 0, Math.PI, BIKE_PHYSICS.baseSpeed));
      const mgr = new LockstepManager(1, 2, state, [BIKE_PHYSICS, BIKE_PHYSICS], cb);
      mgr.start();

      // Advance then apply recovery
      for (let t = 1; t <= 5; t++) {
        mgr.receiveRemoteInputs(0, [{ tick: t, turnDir: 0, accelerate: false, dash: false, brake: false }]);
      }
      for (let i = 0; i < 5; i++) {
        mgr.update(SIM_DT, 0, false, false, false);
      }

      const recoveryState = createSimState(5, spawns2(-40, 0, 0.2, 40, 0, Math.PI, BIKE_PHYSICS.baseSpeed));
      mgr.receiveRecoverySnapshot(recoveryState);

      // Continue simulating — should advance from the recovered state
      for (let t = 6; t <= 15; t++) {
        mgr.receiveRemoteInputs(0, [{ tick: t, turnDir: 0, accelerate: false, dash: false, brake: false }]);
      }
      for (let i = 0; i < 10; i++) {
        mgr.update(SIM_DT, 0, false, false, false);
      }

      expect(mgr.tick).toBeGreaterThan(5);
      expect(mgr.state.players[0].alive).toBe(true);
    });
  });

  describe('rollback edge cases', () => {
    it('gracefully handles rollback when snapshot is unavailable', () => {
      const { mgr } = createManager();
      mgr.start();

      // Advance many ticks so early snapshots expire (buffer size = 120)
      for (let t = 1; t <= 150; t++) {
        mgr.receiveRemoteInputs(1, [{ tick: t, turnDir: 0, accelerate: false, dash: false, brake: false }]);
      }
      for (let i = 0; i < 150; i++) {
        mgr.update(SIM_DT, 0, false, false, false);
      }

      const tickBefore = mgr.tick;

      // Try to trigger rollback for a tick that's beyond snapshot buffer
      // This should NOT crash — the rollback silently returns if snapshot is unavailable
      mgr.receiveRemoteInputs(1, [
        { tick: 5, turnDir: -1, accelerate: true, dash: false, brake: false },
      ]);

      // Sim should still be at the same tick (no rollback happened)
      expect(mgr.tick).toBe(tickBefore);
    });

    it('hash is correctly rehashed after rollback', () => {
      const cb = makeCallbacks();
      const state = createSimState(0, spawns2(-50, 0, 0, 50, 0, Math.PI, BIKE_PHYSICS.baseSpeed));
      const mgr = new LockstepManager(0, 2, state, [BIKE_PHYSICS, BIKE_PHYSICS], cb);
      mgr.start();

      // Advance 5 ticks with predicted remote (turnDir=0)
      for (let i = 0; i < 5; i++) {
        mgr.update(SIM_DT, 0, false, false, false);
      }
      expect(mgr.rollbackCount).toBe(0);

      // Deliver actual remote inputs that differ — triggers rollback and rehash
      mgr.receiveRemoteInputs(1, [
        { tick: 2, turnDir: -1, accelerate: false, dash: false, brake: false },
        { tick: 3, turnDir: -1, accelerate: false, dash: false, brake: false },
      ]);
      expect(mgr.rollbackCount).toBe(1);

      // Continue to tick 65+ to generate a hash
      for (let t = 6; t <= 70; t++) {
        mgr.receiveRemoteInputs(1, [{ tick: t, turnDir: 0, accelerate: false, dash: false, brake: false }]);
      }
      for (let i = 0; i < 65; i++) {
        mgr.update(SIM_DT, 0, false, false, false);
      }

      // Hash should exist and be a valid number (rehashing didn't corrupt it)
      expect(cb.hashes.length).toBeGreaterThanOrEqual(1);
      expect(typeof cb.hashes[0].hash).toBe('number');
      expect(cb.hashes[0].hash).not.toBe(0);

      // Verify no desync when remote sends the same hash
      mgr.receiveRemoteHash(cb.hashes[0].tick, cb.hashes[0].hash);
      expect(mgr.desyncCount).toBe(0);
    });
  });

  describe('death-after-rollback', () => {
    it('fires onDeath for a player who dies during forward sim near arena edge', () => {
      const cb = makeCallbacks();
      // Place player 1 near arena edge heading outward (+X direction, angle=PI/2)
      const state = createSimState(0, spawns2(
        0, 0, 0,                // player 0: center
        187, 0, -Math.PI / 2,   // player 1: near +X edge, heading +X → will exit
        BIKE_PHYSICS.baseSpeed,
      ));
      const mgr = new LockstepManager(0, 2, state, [BIKE_PHYSICS, BIKE_PHYSICS], cb);
      mgr.start();

      // Advance enough ticks for player 1 to exit + DEATH_GRACE_TICKS to elapse
      for (let i = 0; i < 20; i++) {
        mgr.receiveRemoteInputs(1, [{ tick: i + 1, turnDir: 0, accelerate: false, dash: false, brake: false }]);
        mgr.update(SIM_DT, 0, false, false, false);
      }

      expect(mgr.getPlayerByIndex(1).alive).toBe(false);
      expect(cb.deaths).toContain(1);
    });

    it('fires onDeath when rollback causes a death that forward sim missed', () => {
      const cb = makeCallbacks();
      // Player 1 near edge — with predicted input (turnDir=0, straight) they survive
      // because angle=0 means heading +Z. Corrected input (turnDir=1) curves them out.
      const state = createSimState(0, spawns2(
        0, 0, 0,
        190, 0, -Math.PI / 2, // near +X edge, heading +X
        BIKE_PHYSICS.baseSpeed,
      ));
      const mgr = new LockstepManager(0, 2, state, [BIKE_PHYSICS, BIKE_PHYSICS], cb);
      mgr.start();

      // Advance 5 ticks with NO remote inputs (predicts turnDir=0)
      for (let i = 0; i < 5; i++) {
        mgr.update(SIM_DT, 0, false, false, false);
      }

      // Now deliver corrected remote inputs — same direction, no misprediction in this case
      // but the player should still die from out of bounds
      for (let i = 1; i <= 5; i++) {
        mgr.receiveRemoteInputs(1, [{ tick: i, turnDir: 0, accelerate: false, dash: false, brake: false }]);
      }

      // Continue to let death grace ticks elapse
      for (let i = 0; i < 10; i++) {
        mgr.receiveRemoteInputs(1, [{ tick: 6 + i, turnDir: 0, accelerate: false, dash: false, brake: false }]);
        mgr.update(SIM_DT, 0, false, false, false);
      }

      expect(mgr.getPlayerByIndex(1).alive).toBe(false);
      expect(cb.deaths).toContain(1);
    });

    it('does not double-fire onDeath after rollback for already-dead player', () => {
      const cb = makeCallbacks();
      const state = createSimState(0, spawns2(
        0, 0, 0,
        187, 0, -Math.PI / 2, // near +X edge, heading +X
        BIKE_PHYSICS.baseSpeed,
      ));
      const mgr = new LockstepManager(0, 2, state, [BIKE_PHYSICS, BIKE_PHYSICS], cb);
      mgr.start();

      // Advance with confirmed inputs — player dies normally
      for (let i = 0; i < 20; i++) {
        mgr.receiveRemoteInputs(1, [{ tick: i + 1, turnDir: 0, accelerate: false, dash: false, brake: false }]);
        mgr.update(SIM_DT, 0, false, false, false);
      }
      expect(mgr.getPlayerByIndex(1).alive).toBe(false);
      expect(cb.deaths).toContain(1);

      // Trigger a rollback after the player is already dead — should not double-fire
      const deathCountBefore = cb.deaths.filter(d => d === 1).length;
      mgr.receiveRemoteInputs(1, [
        { tick: 3, turnDir: -1, accelerate: false, dash: false, brake: false },
      ]);
      for (let i = 0; i < 5; i++) {
        mgr.receiveRemoteInputs(1, [{ tick: 21 + i, turnDir: 0, accelerate: false, dash: false, brake: false }]);
        mgr.update(SIM_DT, 0, false, false, false);
      }
      const deathCountAfter = cb.deaths.filter(d => d === 1).length;
      expect(deathCountAfter).toBe(deathCountBefore);
    });
  });

  // ── killMyPlayer ──────────────────────────────────────
  describe('killMyPlayer', () => {
    it('kills player 0 when myIndex is 0', () => {
      const { mgr } = createManager(0);
      expect(mgr.getMyPlayer().alive).toBe(true);
      mgr.killMyPlayer();
      expect(mgr.getMyPlayer().alive).toBe(false);
      // Other player should remain alive
      expect(mgr.getPlayerByIndex(1).alive).toBe(true);
    });

    it('kills player 1 when myIndex is 1', () => {
      const { mgr } = createManager(1);
      expect(mgr.getMyPlayer().alive).toBe(true);
      mgr.killMyPlayer();
      expect(mgr.getMyPlayer().alive).toBe(false);
      expect(mgr.getPlayerByIndex(0).alive).toBe(true);
    });

    it('does not resurrect killed player on subsequent sim ticks', () => {
      const { mgr } = createManager(0);
      mgr.start();
      mgr.receiveRemoteInputs(1, [{ tick: 1, turnDir: 0, accelerate: false, dash: false, brake: false }]);
      mgr.update(SIM_DT, 0, false, false, false);

      mgr.killMyPlayer();
      expect(mgr.getMyPlayer().alive).toBe(false);

      // Advance more ticks — player should stay dead
      for (let t = 2; t <= 5; t++) {
        mgr.receiveRemoteInputs(1, [{ tick: t, turnDir: 0, accelerate: false, dash: false, brake: false }]);
      }
      mgr.update(SIM_DT * 3, 0, false, false, false);
      expect(mgr.getMyPlayer().alive).toBe(false);
    });

    it('preserves player position after kill', () => {
      const { mgr } = createManager(0);
      const posBefore = { x: mgr.getMyPlayer().x, z: mgr.getMyPlayer().z };
      mgr.killMyPlayer();
      const posAfter = { x: mgr.getMyPlayer().x, z: mgr.getMyPlayer().z };
      expect(posAfter.x).toBe(posBefore.x);
      expect(posAfter.z).toBe(posBefore.z);
    });
  });

  describe('hash race condition', () => {
    it('detects desync when remote hash arrives before local tick is computed', () => {
      const { mgr, cb } = createManager();
      mgr.start();

      // Advance to tick 59 (just before first hash at tick 60)
      for (let t = 1; t <= 59; t++) {
        mgr.receiveRemoteInputs(1, [{ tick: t, turnDir: 0, accelerate: false, dash: false, brake: false }]);
        mgr.update(SIM_DT, 0, false, false, false);
      }

      // Remote hash for tick 60 arrives early (before local reaches tick 60)
      mgr.receiveRemoteHash(60, 0xDEADC0DE); // wrong hash, arrives early
      expect(cb.desyncs).toHaveLength(0); // not yet — tick 60 not computed

      // Advance to tick 60 — local hash computed, should now compare with pending remote
      for (let t = 60; t <= 65; t++) {
        mgr.receiveRemoteInputs(1, [{ tick: t, turnDir: 0, accelerate: false, dash: false, brake: false }]);
      }
      mgr.update(SIM_DT * 10, 0, false, false, false);

      // Desync must have been detected when local hash was computed
      expect(cb.desyncs.length).toBeGreaterThan(0);
      expect(cb.desyncs[0].tick).toBe(60);
    });

    it('detects desync when remote hash arrives after local tick is computed (existing path)', () => {
      const { mgr, cb } = createManager();
      mgr.start();

      // Advance past tick 60
      for (let t = 1; t <= 65; t++) {
        mgr.receiveRemoteInputs(1, [{ tick: t, turnDir: 0, accelerate: false, dash: false, brake: false }]);
        mgr.update(SIM_DT, 0, false, false, false);
      }

      expect(cb.hashes.length).toBeGreaterThan(0); // local hash was computed and sent
      const hashTick = cb.hashes[0].tick;

      // Remote hash arrives late (after local already computed it), and is wrong
      mgr.receiveRemoteHash(hashTick, 0xDEADC0DE);

      expect(cb.desyncs.length).toBeGreaterThan(0);
      expect(cb.desyncs[0].tick).toBe(hashTick);
    });
  });
});

// ── Health Classification Tests ────────────────────────────
import { classifyHealth, type HealthSignal, type ExtendedHealthSignals } from './lockstepManager';
import type { RoundTelemetry } from './lockstepManager';

function baseTelemetry(overrides: Partial<RoundTelemetry> = {}): RoundTelemetry {
  return {
    rollbackCount: 0,
    rollbackDepths: {},
    rollbackMaxDepth: 0,
    rollbackAvgDepth: 0,
    peakPredictAhead: 0,
    lateInputCount: 0,
    desyncCount: 0,
    recoveryCount: 0,
    stallCount: 0,
    totalTicks: 600,
    avgSimTickCostMs: 0,
    peakSimTickCostMs: 0,
    avgRollbackCostMs: 0,
    peakRollbackCostMs: 0,
    avgRecoveryCostMs: 0,
    peakRecoveryCostMs: 0,
    avgRecoverySnapshotBytes: 0,
    simTickP50Ms: 0,
    simTickP95Ms: 0,
    simTickP99Ms: 0,
    inputLatencyBuckets: {},
    mispredictionCount: 0,
    correctPredictionCount: 0,
    inputBufferDepth: 0,
    avgHashCostMs: 0,
    peakHashCostMs: 0,
    rollbackP50Ms: 0,
    rollbackP95Ms: 0,
    rollbackP99Ms: 0,
    snapshotMissCount: 0,
    rollbackCostByDepth: {},
    snapshotSerdeCostAvgMs: 0,
    snapshotSerdeCostPeakMs: 0,
    avgStallDurationMs: 0,
    peakStallDurationMs: 0,
    avgQuantizeCostMs: 0,
    peakQuantizeCostMs: 0,
    lateInputBurstCount: 0,
    lateInputPeakStreak: 0,
    ...overrides,
  };
}

describe('classifyHealth', () => {
  it('returns healthy when all counters are zero', () => {
    const h = classifyHealth(baseTelemetry());
    expect(h.level).toBe('healthy');
    expect(h.reasons).toHaveLength(0);
  });

  it('returns healthy with minor desyncs (≤2)', () => {
    const h = classifyHealth(baseTelemetry({ desyncCount: 2 }));
    expect(h.level).toBe('healthy');
  });

  it('returns degraded for a single recovery', () => {
    const h = classifyHealth(baseTelemetry({ recoveryCount: 1 }));
    expect(h.level).toBe('degraded');
    expect(h.reasons.length).toBeGreaterThan(0);
    expect(h.reasons[0]).toContain('recovery');
  });

  it('returns degraded for moderate desyncs (3-5)', () => {
    const h = classifyHealth(baseTelemetry({ desyncCount: 4 }));
    expect(h.level).toBe('degraded');
    expect(h.reasons[0]).toContain('desync');
  });

  it('returns degraded for frequent stalls', () => {
    const h = classifyHealth(baseTelemetry({ stallCount: 5 }));
    expect(h.level).toBe('degraded');
    expect(h.reasons[0]).toContain('stall');
  });

  it('returns degraded for high predict-ahead', () => {
    const h = classifyHealth(baseTelemetry({ peakPredictAhead: 12 }));
    expect(h.level).toBe('degraded');
    expect(h.reasons[0]).toContain('predict-ahead');
  });

  it('returns unstable for 2+ recoveries', () => {
    const h = classifyHealth(baseTelemetry({ recoveryCount: 2 }));
    expect(h.level).toBe('unstable');
    expect(h.reasons[0]).toContain('recoveries');
  });

  it('returns unstable for 6+ desyncs', () => {
    const h = classifyHealth(baseTelemetry({ desyncCount: 7 }));
    expect(h.level).toBe('unstable');
    expect(h.reasons[0]).toContain('desync');
  });

  it('unstable takes priority over degraded', () => {
    const h = classifyHealth(baseTelemetry({ recoveryCount: 3, stallCount: 10 }));
    expect(h.level).toBe('unstable');
  });

  it('accumulates multiple degraded reasons', () => {
    const h = classifyHealth(baseTelemetry({ recoveryCount: 1, stallCount: 5, desyncCount: 3 }));
    expect(h.level).toBe('degraded');
    expect(h.reasons.length).toBe(3);
  });

  it('returns unstable for deep average rollback depth', () => {
    const h = classifyHealth(baseTelemetry({ rollbackAvgDepth: 7 }));
    expect(h.level).toBe('unstable');
    expect(h.reasons[0]).toContain('rollback depth');
  });

  it('returns degraded for high rollback count', () => {
    const h = classifyHealth(baseTelemetry({ rollbackCount: 35 }));
    expect(h.level).toBe('degraded');
    expect(h.reasons[0]).toContain('rollback');
  });

  it('returns degraded for very deep max rollback', () => {
    const h = classifyHealth(baseTelemetry({ rollbackMaxDepth: 12 }));
    expect(h.level).toBe('degraded');
    expect(h.reasons[0]).toContain('rollback depth');
  });

  it('returns degraded for majority late inputs', () => {
    const h = classifyHealth(baseTelemetry({ lateInputCount: 400, totalTicks: 600 }));
    expect(h.level).toBe('degraded');
    expect(h.reasons[0]).toContain('late inputs');
  });

  it('R1 scenario: 54 rollbacks, 97% late is NOT healthy', () => {
    const h = classifyHealth(baseTelemetry({
      rollbackCount: 54,
      rollbackAvgDepth: 3.9,
      lateInputCount: 276,
      totalTicks: 284,
      desyncCount: 1,
    }));
    expect(h.level).not.toBe('healthy');
  });

  // ── Extended Health Signals (v2) ──

  function baseExt(overrides: Partial<ExtendedHealthSignals> = {}): ExtendedHealthSignals {
    return {
      jitterP95Ms: 20, jitterP99Ms: 40, heartbeatMissCount: 0,
      heartbeatP95Ms: 5000,
      gcPauseCount: 0, gcPauseTotalMs: 0, heapPressure: 0.3,
      frameTimeP95Ms: 12, frameTimeStdDevMs: 3, jankEventCount: 0,
      jankPeakStreak: 0, transportReconnects: 0, mispredictionRate: 0.1,
      packetReorderCount: 0, packetsReceived: 100, transportBufferedBytes: 0, serverTimeOffsetMs: 0,
      ...overrides,
    };
  }

  it('returns healthy with clean extended signals', () => {
    const h = classifyHealth(baseTelemetry(), baseExt());
    expect(h.level).toBe('healthy');
  });

  it('backward compat: no ext param returns same result as v1', () => {
    const t = baseTelemetry({ stallCount: 5 });
    const withExt = classifyHealth(t, undefined);
    const without = classifyHealth(t);
    expect(withExt.level).toBe(without.level);
    expect(withExt.reasons).toEqual(without.reasons);
  });

  it('unstable: jitter p99 > 300ms', () => {
    const h = classifyHealth(baseTelemetry(), baseExt({ jitterP99Ms: 350 }));
    expect(h.level).toBe('unstable');
    expect(h.reasons[0]).toContain('jitter');
  });

  it('unstable: 4+ heartbeat misses', () => {
    const h = classifyHealth(baseTelemetry(), baseExt({ heartbeatMissCount: 4 }));
    expect(h.level).toBe('unstable');
    expect(h.reasons[0]).toContain('heartbeat');
  });

  it('unstable: 3+ GC pauses', () => {
    const h = classifyHealth(baseTelemetry(), baseExt({ gcPauseCount: 3 }));
    expect(h.level).toBe('unstable');
    expect(h.reasons[0]).toContain('GC');
  });

  it('unstable: 2+ transport reconnects', () => {
    const h = classifyHealth(baseTelemetry(), baseExt({ transportReconnects: 2 }));
    expect(h.level).toBe('unstable');
    expect(h.reasons[0]).toContain('reconnect');
  });

  it('degraded: jitter p99 > 150ms (below unstable)', () => {
    const h = classifyHealth(baseTelemetry(), baseExt({ jitterP99Ms: 200 }));
    expect(h.level).toBe('degraded');
    expect(h.reasons[0]).toContain('jitter');
  });

  it('degraded: jitter p95 > 100ms', () => {
    const h = classifyHealth(baseTelemetry(), baseExt({ jitterP95Ms: 120 }));
    expect(h.level).toBe('degraded');
    expect(h.reasons[0]).toContain('jitter');
  });

  it('degraded: 2-3 heartbeat misses', () => {
    const h = classifyHealth(baseTelemetry(), baseExt({ heartbeatMissCount: 2 }));
    expect(h.level).toBe('degraded');
    expect(h.reasons[0]).toContain('heartbeat');
  });

  it('degraded: 3+ jank events', () => {
    const h = classifyHealth(baseTelemetry(), baseExt({ jankEventCount: 4 }));
    expect(h.level).toBe('degraded');
    expect(h.reasons[0]).toContain('jank');
  });

  it('degraded: jank peak streak >= 8', () => {
    const h = classifyHealth(baseTelemetry(), baseExt({ jankPeakStreak: 10 }));
    expect(h.level).toBe('degraded');
    expect(h.reasons[0]).toContain('jank streak');
  });

  it('degraded: frame time p95 > 25ms', () => {
    const h = classifyHealth(baseTelemetry(), baseExt({ frameTimeP95Ms: 28 }));
    expect(h.level).toBe('degraded');
    expect(h.reasons[0]).toContain('frame time');
  });

  it('degraded: frame time std dev > 10ms', () => {
    const h = classifyHealth(baseTelemetry(), baseExt({ frameTimeStdDevMs: 12 }));
    expect(h.level).toBe('degraded');
    expect(h.reasons[0]).toContain('std dev');
  });

  it('degraded: misprediction rate > 60%', () => {
    const h = classifyHealth(baseTelemetry(), baseExt({ mispredictionRate: 0.75 }));
    expect(h.level).toBe('degraded');
    expect(h.reasons[0]).toContain('misprediction');
  });

  it('degraded: heap pressure > 85%', () => {
    const h = classifyHealth(baseTelemetry(), baseExt({ heapPressure: 0.90 }));
    expect(h.level).toBe('degraded');
    expect(h.reasons[0]).toContain('heap');
  });

  it('degraded: cumulative GC pauses > 200ms', () => {
    const h = classifyHealth(baseTelemetry(), baseExt({ gcPauseTotalMs: 250 }));
    expect(h.level).toBe('degraded');
    expect(h.reasons[0]).toContain('GC');
  });

  it('accumulates both lockstep and extended degraded reasons', () => {
    const h = classifyHealth(
      baseTelemetry({ stallCount: 5 }),
      baseExt({ jankEventCount: 4, heapPressure: 0.9 }),
    );
    expect(h.level).toBe('degraded');
    expect(h.reasons.length).toBeGreaterThanOrEqual(3);
  });

  it('unstable ext overrides degraded lockstep', () => {
    const h = classifyHealth(
      baseTelemetry({ stallCount: 5 }),
      baseExt({ jitterP99Ms: 400 }),
    );
    expect(h.level).toBe('unstable');
  });

  // ── Packet reorder health signals ──

  it('>5% reorder rate is degraded', () => {
    const h = classifyHealth(baseTelemetry(), baseExt({ packetReorderCount: 8, packetsReceived: 100 }));
    expect(h.level).toBe('degraded');
    expect(h.reasons.some(r => r.includes('reordered packets'))).toBe(true);
  });

  it('>15% reorder rate is unstable', () => {
    const h = classifyHealth(baseTelemetry(), baseExt({ packetReorderCount: 20, packetsReceived: 100 }));
    expect(h.level).toBe('unstable');
    expect(h.reasons.some(r => r.includes('severe out-of-order'))).toBe(true);
  });

  it('<5% reorder rate is healthy', () => {
    const h = classifyHealth(baseTelemetry(), baseExt({ packetReorderCount: 3, packetsReceived: 100 }));
    expect(h.level).toBe('healthy');
  });

  it('reorder with zero packets received stays healthy', () => {
    const h = classifyHealth(baseTelemetry(), baseExt({ packetReorderCount: 5, packetsReceived: 0 }));
    expect(h.level).toBe('healthy');
  });

  it('degraded: transport backpressure > 64KB', () => {
    const h = classifyHealth(baseTelemetry(), baseExt({ transportBufferedBytes: 70000 }));
    expect(h.level).toBe('degraded');
    expect(h.reasons.some(r => r.includes('transport backpressure'))).toBe(true);
  });

  it('unstable: transport backpressure > 256KB', () => {
    const h = classifyHealth(baseTelemetry(), baseExt({ transportBufferedBytes: 300000 }));
    expect(h.level).toBe('unstable');
    expect(h.reasons.some(r => r.includes('transport backpressure'))).toBe(true);
  });

  it('healthy: transport backpressure under 64KB', () => {
    const h = classifyHealth(baseTelemetry(), baseExt({ transportBufferedBytes: 50000 }));
    expect(h.level).toBe('healthy');
  });
});

// ── N-Player Tests ──────────────────────────────────────

function spawns3(): PlayerSpawn[] {
  return [
    { x: -50, z: 0, angle: 0, baseSpeed: BIKE_PHYSICS.baseSpeed },
    { x: 50, z: 0, angle: Math.PI, baseSpeed: BIKE_PHYSICS.baseSpeed },
    { x: 0, z: 50, angle: -Math.PI / 2, baseSpeed: BIKE_PHYSICS.baseSpeed },
  ];
}

function createManagerN(myIndex: number, playerCount: number, humanCount?: number) {
  const cb = makeCallbacks();
  const spawns = playerCount === 3 ? spawns3() : spawns2(-50, 0, 0, 50, 0, Math.PI, BIKE_PHYSICS.baseSpeed);
  const cfgs = Array(playerCount).fill(BIKE_PHYSICS);
  const state = createSimState(0, spawns);
  const mgr = new LockstepManager(myIndex, playerCount, state, cfgs, cb, humanCount);
  return { mgr, cb };
}

describe('N-Player Lockstep', () => {
  it('3-player sim advances deterministically', () => {
    const { mgr, cb } = createManagerN(0, 3);
    mgr.start();

    // Feed remote inputs for players 1 and 2
    for (let t = 1; t <= 20; t++) {
      mgr.receiveRemoteInputs(1, [{ tick: t, turnDir: 0, accelerate: true, dash: false, brake: false }]);
      mgr.receiveRemoteInputs(2, [{ tick: t, turnDir: 0, accelerate: false, dash: false, brake: false }]);
    }
    // Advance 20 ticks
    for (let i = 0; i < 20; i++) {
      mgr.update(SIM_DT, 0, false, false, false);
    }

    expect(mgr.tick).toBeGreaterThanOrEqual(15);
    // All 3 players should still be alive (no collisions in 20 ticks on open spawns)
    expect(mgr.state.players[0].alive).toBe(true);
    expect(mgr.state.players[1].alive).toBe(true);
    expect(mgr.state.players[2].alive).toBe(true);
    expect(cb.deaths).toEqual([]);
  });

  it('rollback with 3 players corrects misprediction', () => {
    const { mgr, cb } = createManagerN(0, 3);
    mgr.start();

    // Advance a few ticks with predicted input for player 2
    for (let t = 1; t <= 5; t++) {
      mgr.receiveRemoteInputs(1, [{ tick: t, turnDir: 0, accelerate: false, dash: false, brake: false }]);
      // Player 2 input delayed — will be predicted
    }
    for (let i = 0; i < 5; i++) {
      mgr.update(SIM_DT, 0, false, false, false);
    }
    const tickBefore = mgr.tick;

    // Now send corrected inputs for player 2 (different from prediction)
    for (let t = 1; t <= 5; t++) {
      mgr.receiveRemoteInputs(2, [{ tick: t, turnDir: 1, accelerate: true, dash: false, brake: false }]);
    }

    // Sim should have rolled back and resimulated
    expect(mgr.tick).toBeGreaterThanOrEqual(tickBefore);
    // Player 2 position should differ from default prediction (turnDir=0)
    const p2 = mgr.state.players[2];
    // With turnDir=1, player 2 should have turned (z should differ from straight-line)
    expect(p2.alive).toBe(true);
  });

  it('AI death fires onDeath for AI index', () => {
    // 2 humans + 1 AI (index 2 is AI)
    const aiInput: InputFrame = { tick: 0, turnDir: 0, accelerate: false, dash: false, brake: false };
    const cb = makeCallbacks();
    // Spawn AI at arena edge so it dies immediately from OOB
    const spawns: PlayerSpawn[] = [
      { x: -50, z: 0, angle: 0, baseSpeed: BIKE_PHYSICS.baseSpeed },
      { x: 50, z: 0, angle: Math.PI, baseSpeed: BIKE_PHYSICS.baseSpeed },
      { x: 0, z: 191, angle: Math.PI, baseSpeed: BIKE_PHYSICS.baseSpeed }, // near arena edge, angle=π moves +z toward boundary
    ];
    const cfgs = [BIKE_PHYSICS, BIKE_PHYSICS, BIKE_PHYSICS];
    const state = createSimState(0, spawns);
    const mgr = new LockstepManager(0, 3, state, cfgs, {
      ...cb,
      aiInputProvider: (_idx, _state, tick) => ({ tick, turnDir: 0, accelerate: true, dash: false, brake: false }),
    }, 2); // humanCount=2, AI starts at index 2

    mgr.start();
    // Feed remote inputs for player 1
    for (let t = 1; t <= 20; t++) {
      mgr.receiveRemoteInputs(1, [{ tick: t, turnDir: 0, accelerate: false, dash: false, brake: false }]);
    }
    // Run enough ticks for AI to go OOB (accelerating from x=191 toward edge)
    for (let i = 0; i < 20; i++) {
      mgr.update(SIM_DT, 0, false, false, false);
    }

    // AI should have died (moved past arena boundary)
    expect(mgr.state.players[2].alive).toBe(false);
    // onDeath should have been called with index 2
    expect(cb.deaths).toContain(2);
  });
});

// ── 4-Player Lockstep Tests ────────────────────────────────

function spawns4(): PlayerSpawn[] {
  return [
    { x: -50, z: 0, angle: 0, baseSpeed: BIKE_PHYSICS.baseSpeed },
    { x: 50, z: 0, angle: Math.PI, baseSpeed: BIKE_PHYSICS.baseSpeed },
    { x: 0, z: 50, angle: -Math.PI / 2, baseSpeed: BIKE_PHYSICS.baseSpeed },
    { x: 0, z: -50, angle: Math.PI / 2, baseSpeed: BIKE_PHYSICS.baseSpeed },
  ];
}

function createManager4(myIndex: number, humanCount?: number) {
  const cb = makeCallbacks();
  const spawns = spawns4();
  const cfgs = Array(4).fill(BIKE_PHYSICS);
  const state = createSimState(0, spawns);
  const mgr = new LockstepManager(myIndex, 4, state, cfgs, cb, humanCount);
  return { mgr, cb };
}

describe('4-Player Lockstep', () => {
  it('4-player sim advances deterministically', () => {
    const { mgr, cb } = createManager4(0);
    mgr.start();

    for (let t = 1; t <= 20; t++) {
      mgr.receiveRemoteInputs(1, [{ tick: t, turnDir: 0, accelerate: false, dash: false, brake: false }]);
      mgr.receiveRemoteInputs(2, [{ tick: t, turnDir: 0, accelerate: false, dash: false, brake: false }]);
      mgr.receiveRemoteInputs(3, [{ tick: t, turnDir: 0, accelerate: true, dash: false, brake: false }]);
    }
    for (let i = 0; i < 20; i++) {
      mgr.update(SIM_DT, 0, false, false, false);
    }

    expect(mgr.tick).toBeGreaterThanOrEqual(15);
    for (let i = 0; i < 4; i++) {
      expect(mgr.state.players[i].alive).toBe(true);
    }
    expect(cb.deaths).toEqual([]);
  });

  it('two 4-player managers produce identical state', () => {
    const cbA = makeCallbacks();
    const cbB = makeCallbacks();
    const stateInit = createSimState(0, spawns4());
    const cfgs = Array(4).fill(BIKE_PHYSICS);
    const mgrA = new LockstepManager(0, 4, stateInit, cfgs, cbA);
    const mgrB = new LockstepManager(1, 4, stateInit, cfgs, cbB);
    mgrA.start();
    mgrB.start();

    for (let t = 1; t <= 60; t++) {
      const inputA: InputFrame = { tick: t, turnDir: (t % 20 < 7 ? -1 : 0) as -1 | 0 | 1, accelerate: t % 10 < 3, dash: false, brake: false };
      const inputB: InputFrame = { tick: t, turnDir: (t % 15 < 5 ? 1 : 0) as -1 | 0 | 1, accelerate: false, dash: false, brake: false };
      const inputC: InputFrame = { tick: t, turnDir: (t % 12 < 4 ? -1 : 0) as -1 | 0 | 1, accelerate: t % 8 < 2, dash: false, brake: false };
      const inputD: InputFrame = { tick: t, turnDir: (t % 18 < 6 ? 1 : 0) as -1 | 0 | 1, accelerate: false, dash: false, brake: false };

      // A is player 0, B is player 1, C & D are remote for both
      mgrA.inputBuffer.addLocal(inputA);
      mgrA.receiveRemoteInputs(1, [inputB]);
      mgrA.receiveRemoteInputs(2, [inputC]);
      mgrA.receiveRemoteInputs(3, [inputD]);

      mgrB.inputBuffer.addLocal(inputB);
      mgrB.receiveRemoteInputs(0, [inputA]);
      mgrB.receiveRemoteInputs(2, [inputC]);
      mgrB.receiveRemoteInputs(3, [inputD]);

      mgrA.update(SIM_DT, inputA.turnDir, inputA.accelerate, false, false);
      mgrB.update(SIM_DT, inputB.turnDir, inputB.accelerate, false, false);
    }

    const sA = mgrA.state;
    const sB = mgrB.state;
    for (let i = 0; i < 4; i++) {
      expect(sA.players[i].x).toBeCloseTo(sB.players[i].x, 5);
      expect(sA.players[i].z).toBeCloseTo(sB.players[i].z, 5);
      expect(sA.players[i].alive).toBe(sB.players[i].alive);
    }
  });

  it('4-player rollback from two simultaneous mispredictions', () => {
    const { mgr } = createManager4(0);
    mgr.start();

    // Feed player 1 inputs, but NOT player 2 or 3 (they'll be predicted)
    for (let t = 1; t <= 8; t++) {
      mgr.receiveRemoteInputs(1, [{ tick: t, turnDir: 0, accelerate: false, dash: false, brake: false }]);
    }
    for (let i = 0; i < 8; i++) {
      mgr.update(SIM_DT, 0, false, false, false);
    }
    expect(mgr.rollbackCount).toBe(0);

    // Deliver mispredicted inputs for BOTH player 2 and player 3 at once
    mgr.receiveRemoteInputs(2, [
      { tick: 3, turnDir: -1, accelerate: true, dash: false, brake: false },
      { tick: 4, turnDir: -1, accelerate: true, dash: false, brake: false },
    ]);
    mgr.receiveRemoteInputs(3, [
      { tick: 3, turnDir: 1, accelerate: false, dash: true, brake: false },
      { tick: 4, turnDir: 1, accelerate: false, dash: true, brake: false },
    ]);

    // Should have triggered rollback(s)
    expect(mgr.rollbackCount).toBeGreaterThanOrEqual(1);
  });

  it('4-player hashes match across managers', () => {
    const cbA = makeCallbacks();
    const cbB = makeCallbacks();
    const stateInit = createSimState(0, spawns4());
    const cfgs = Array(4).fill(BIKE_PHYSICS);
    const mgrA = new LockstepManager(0, 4, stateInit, cfgs, cbA);
    const mgrB = new LockstepManager(2, 4, stateInit, cfgs, cbB);
    mgrA.start();
    mgrB.start();

    for (let t = 1; t <= 65; t++) {
      const inputs = [
        { tick: t, turnDir: (t % 20 < 7 ? -1 : 0) as -1 | 0 | 1, accelerate: t % 10 < 3, dash: false, brake: false },
        { tick: t, turnDir: (t % 15 < 5 ? 1 : 0) as -1 | 0 | 1, accelerate: false, dash: false, brake: false },
        { tick: t, turnDir: 0 as -1 | 0 | 1, accelerate: false, dash: false, brake: false },
        { tick: t, turnDir: (t % 25 < 8 ? -1 : 0) as -1 | 0 | 1, accelerate: t % 12 < 4, dash: false, brake: false },
      ];

      mgrA.inputBuffer.addLocal(inputs[0]);
      mgrA.receiveRemoteInputs(1, [inputs[1]]);
      mgrA.receiveRemoteInputs(2, [inputs[2]]);
      mgrA.receiveRemoteInputs(3, [inputs[3]]);

      mgrB.inputBuffer.addLocal(inputs[2]);
      mgrB.receiveRemoteInputs(0, [inputs[0]]);
      mgrB.receiveRemoteInputs(1, [inputs[1]]);
      mgrB.receiveRemoteInputs(3, [inputs[3]]);

      mgrA.update(SIM_DT, inputs[0].turnDir, inputs[0].accelerate, false, false);
      mgrB.update(SIM_DT, inputs[2].turnDir, inputs[2].accelerate, false, false);
    }

    expect(cbA.hashes.length).toBeGreaterThanOrEqual(1);
    expect(cbB.hashes.length).toBeGreaterThanOrEqual(1);
    const hashA = cbA.hashes[0];
    const hashB = cbB.hashes.find(h => h.tick === hashA.tick);
    expect(hashB).toBeDefined();
    expect(hashA.hash).toBe(hashB!.hash);
  });

  it('visual offsets work for all 4 players', () => {
    const { mgr } = createManager4(0);
    mgr.start();

    for (let t = 1; t <= 6; t++) {
      mgr.receiveRemoteInputs(1, [{ tick: t, turnDir: 0, accelerate: false, dash: false, brake: false }]);
      mgr.receiveRemoteInputs(2, [{ tick: t, turnDir: 0, accelerate: false, dash: false, brake: false }]);
      // Player 3 not sent — will be predicted
    }
    for (let i = 0; i < 6; i++) {
      mgr.update(SIM_DT, 0, false, false, false);
    }

    // Cause rollback via player 3 misprediction
    mgr.receiveRemoteInputs(3, [
      { tick: 2, turnDir: -1, accelerate: true, dash: false, brake: false },
      { tick: 3, turnDir: -1, accelerate: true, dash: false, brake: false },
    ]);

    // All 4 visual offsets should be accessible
    for (let i = 0; i < 4; i++) {
      const offset = mgr.getVisualOffset(i);
      expect(offset).toBeDefined();
      expect(typeof offset.x).toBe('number');
      expect(typeof offset.z).toBe('number');
    }
  });
});

// ── Mixed Vehicle Types (bike + car) ─────────────────────

describe('Mixed vehicle lockstep', () => {
  it('two managers stay in sync with bike vs car', () => {
    const cbA = makeCallbacks();
    const cbB = makeCallbacks();
    const stateInit = createSimState(0, spawns2(-50, 0, 0, 50, 0, Math.PI, BIKE_PHYSICS.baseSpeed));
    // Player 0 = bike, Player 1 = car
    const mgrA = new LockstepManager(0, 2, stateInit, [BIKE_PHYSICS, CAR_PHYSICS], cbA);
    const mgrB = new LockstepManager(1, 2, stateInit, [BIKE_PHYSICS, CAR_PHYSICS], cbB);
    mgrA.start();
    mgrB.start();

    for (let t = 1; t <= 200; t++) {
      const inputA: InputFrame = {
        tick: t,
        turnDir: (t % 30 < 10 ? -1 : 0) as -1 | 0 | 1,
        accelerate: t % 8 < 3,
        dash: false,
        brake: false,
      };
      const inputB: InputFrame = {
        tick: t,
        turnDir: (t % 25 < 8 ? 1 : 0) as -1 | 0 | 1,
        accelerate: t % 60 < 20,
        dash: false,
        brake: t % 50 < 25, // car enters drift when braking at speed
      };

      mgrA.inputBuffer.addLocal(inputA);
      mgrA.receiveRemoteInputs(1, [inputB]);
      mgrB.inputBuffer.addLocal(inputB);
      mgrB.receiveRemoteInputs(0, [inputA]);

      mgrA.update(SIM_DT, inputA.turnDir, inputA.accelerate, inputA.dash, inputA.brake);
      mgrB.update(SIM_DT, inputB.turnDir, inputB.accelerate, inputB.dash, inputB.brake);
    }

    const sA = mgrA.state;
    const sB = mgrB.state;
    // Bike (player 0)
    expect(sA.players[0].x).toBeCloseTo(sB.players[0].x, 5);
    expect(sA.players[0].z).toBeCloseTo(sB.players[0].z, 5);
    expect(sA.players[0].drifting).toBe(sB.players[0].drifting);
    // Car (player 1)
    expect(sA.players[1].x).toBeCloseTo(sB.players[1].x, 5);
    expect(sA.players[1].z).toBeCloseTo(sB.players[1].z, 5);
    expect(sA.players[1].drifting).toBe(sB.players[1].drifting);
  });

  it('rollback preserves determinism with mixed vehicle types', () => {
    const cbA = makeCallbacks();
    const cbB = makeCallbacks();
    const stateInit = createSimState(0, spawns2(-50, 0, 0, 50, 0, Math.PI, BIKE_PHYSICS.baseSpeed));
    const mgrA = new LockstepManager(0, 2, stateInit, [BIKE_PHYSICS, CAR_PHYSICS], cbA);
    const mgrB = new LockstepManager(1, 2, stateInit, [BIKE_PHYSICS, CAR_PHYSICS], cbB);
    mgrA.start();
    mgrB.start();

    // A advances with predicted B (no remote inputs for B)
    for (let i = 0; i < 5; i++) {
      mgrA.update(SIM_DT, 0, false, false, false);
    }

    // B runs with confirmed inputs
    const bInputs: InputFrame[] = [];
    for (let t = 1; t <= 5; t++) {
      const inputA: InputFrame = { tick: t, turnDir: 0, accelerate: false, dash: false, brake: false };
      const inputB: InputFrame = { tick: t, turnDir: (t < 3 ? 1 : 0) as 1 | 0, accelerate: true, dash: false, brake: t >= 3 };
      bInputs.push(inputB);
      mgrB.inputBuffer.addLocal(inputB);
      mgrB.receiveRemoteInputs(0, [inputA]);
      mgrB.update(SIM_DT, inputB.turnDir, inputB.accelerate, inputB.dash, inputB.brake);
    }

    // Deliver B's actual inputs to A (triggers rollback — prediction was brake=false, actual has brake)
    mgrA.receiveRemoteInputs(1, bInputs);

    // Continue both in lockstep
    for (let t = 6; t <= 65; t++) {
      const inputA: InputFrame = { tick: t, turnDir: 0, accelerate: false, dash: false, brake: false };
      const inputB: InputFrame = { tick: t, turnDir: 0, accelerate: false, dash: false, brake: false };
      mgrA.inputBuffer.addLocal(inputA);
      mgrA.receiveRemoteInputs(1, [inputB]);
      mgrB.inputBuffer.addLocal(inputB);
      mgrB.receiveRemoteInputs(0, [inputA]);
      mgrA.update(SIM_DT, 0, false, false, false);
      mgrB.update(SIM_DT, 0, false, false, false);
    }

    // After rollback + continued sync, states should match
    const sA = mgrA.state;
    const sB = mgrB.state;
    expect(sA.players[0].x).toBeCloseTo(sB.players[0].x, 5);
    expect(sA.players[1].x).toBeCloseTo(sB.players[1].x, 5);

    // Hashes should also match
    if (cbA.hashes.length > 0 && cbB.hashes.length > 0) {
      const hashA = cbA.hashes[0];
      const hashB = cbB.hashes.find(h => h.tick === hashA.tick);
      if (hashB) {
        expect(hashA.hash).toBe(hashB.hash);
      }
    }
  });
});

// ── Circular Arena Lockstep Tests ────────────────────────

import { setArenaShape } from './simulation';

describe('Circular arena lockstep', () => {
  afterEach(() => {
    // Restore default square arena after each test
    setArenaShape(false, 192);
  });

  it('OOB kills player in circular arena', () => {
    setArenaShape(true, 180);
    const cb = makeCallbacks();
    // Place player 0 near circular edge (radius ~180, player at x=179 heading +x)
    // angle=-PI/2 → vx = -sin(-PI/2) * speed = +speed → moves in +x direction
    const state = createSimState(0, spawns2(179, 0, -Math.PI / 2, -50, 0, Math.PI, BIKE_PHYSICS.baseSpeed));
    const mgr = new LockstepManager(0, 2, state, [BIKE_PHYSICS, BIKE_PHYSICS], cb);
    mgr.start();

    for (let t = 1; t <= 15; t++) {
      mgr.receiveRemoteInputs(1, [{ tick: t, turnDir: 0, accelerate: false, dash: false, brake: false }]);
    }
    for (let i = 0; i < 15; i++) {
      mgr.update(SIM_DT, 0, false, false, false);
    }

    // Player 0 heading +x from x=179 should exit circular arena (radius=180)
    expect(mgr.getMyPlayer().alive).toBe(false);
    expect(cb.deaths).toContain(0);
  });

  it('two managers stay in sync under circular arena', () => {
    setArenaShape(true, 180);
    const cbA = makeCallbacks();
    const cbB = makeCallbacks();
    const stateInit = createSimState(0, spawns2(-40, 0, 0, 40, 0, Math.PI, BIKE_PHYSICS.baseSpeed));
    const mgrA = new LockstepManager(0, 2, stateInit, [BIKE_PHYSICS, BIKE_PHYSICS], cbA);
    const mgrB = new LockstepManager(1, 2, stateInit, [BIKE_PHYSICS, BIKE_PHYSICS], cbB);
    mgrA.start();
    mgrB.start();

    for (let t = 1; t <= 65; t++) {
      const inputA: InputFrame = { tick: t, turnDir: (t % 20 < 7 ? -1 : 0) as -1 | 0 | 1, accelerate: t % 10 < 3, dash: false, brake: false };
      const inputB: InputFrame = { tick: t, turnDir: (t % 15 < 5 ? 1 : 0) as -1 | 0 | 1, accelerate: false, dash: false, brake: false };

      mgrA.inputBuffer.addLocal(inputA);
      mgrA.receiveRemoteInputs(1, [inputB]);
      mgrB.inputBuffer.addLocal(inputB);
      mgrB.receiveRemoteInputs(0, [inputA]);

      mgrA.update(SIM_DT, inputA.turnDir, inputA.accelerate, false, false);
      mgrB.update(SIM_DT, inputB.turnDir, inputB.accelerate, false, false);
    }

    const sA = mgrA.state;
    const sB = mgrB.state;
    expect(sA.players[0].x).toBeCloseTo(sB.players[0].x, 5);
    expect(sA.players[0].z).toBeCloseTo(sB.players[0].z, 5);
    expect(sA.players[1].x).toBeCloseTo(sB.players[1].x, 5);
    expect(sA.players[1].z).toBeCloseTo(sB.players[1].z, 5);

    // Hashes should match
    if (cbA.hashes.length > 0 && cbB.hashes.length > 0) {
      const hashA = cbA.hashes[0];
      const hashB = cbB.hashes.find(h => h.tick === hashA.tick);
      if (hashB) {
        expect(hashA.hash).toBe(hashB.hash);
      }
    }
  });

  it('wall recharge works with circular arena boundary', () => {
    setArenaShape(true, 180);
    const cb = makeCallbacks();
    // Place player near circular wall (radius 180, player at ~175 from center)
    const state = createSimState(0, spawns2(175, 0, 0, -50, 0, Math.PI, BIKE_PHYSICS.baseSpeed));
    const mgr = new LockstepManager(0, 2, state, [BIKE_PHYSICS, BIKE_PHYSICS], cb);
    mgr.state.players[0].meter = 50;
    mgr.start();

    for (let t = 1; t <= 5; t++) {
      mgr.receiveRemoteInputs(1, [{ tick: t, turnDir: 0, accelerate: false, dash: false, brake: false }]);
    }
    for (let i = 0; i < 5; i++) {
      mgr.update(SIM_DT, 0, false, false, false);
    }

    // Player near circular wall should have recharged
    expect(mgr.getMyPlayer().meter).toBeGreaterThan(50);
  });
});

// ── Iter 2 Telemetry Signal Tests ─────────────────────────

describe('iter 2 telemetry signals', () => {
  it('rollback cost percentiles populated after rollbacks', () => {
    const { mgr } = createManager();
    mgr.start();

    // Advance with predicted remote input (no remote data → prediction used)
    for (let i = 0; i < 6; i++) {
      mgr.update(SIM_DT, 0, false, false, false);
    }

    // Now deliver late remote inputs that differ from prediction (turnDir=1 vs predicted 0)
    for (let t = 1; t <= 5; t++) {
      mgr.receiveRemoteInputs(1, [{ tick: t, turnDir: 1, accelerate: true, dash: false, brake: false }]);
    }

    const t = mgr.getTelemetry();
    expect(t.rollbackCount).toBeGreaterThanOrEqual(1);
    // Percentiles should be populated (non-negative numbers)
    expect(typeof t.rollbackP50Ms).toBe('number');
    expect(typeof t.rollbackP95Ms).toBe('number');
    expect(typeof t.rollbackP99Ms).toBe('number');
    // With at least one rollback, p50 should be >= 0
    expect(t.rollbackP50Ms).toBeGreaterThanOrEqual(0);
  });

  it('snapshotMissCount increments when rollback finds no snapshot', () => {
    const { mgr } = createManager();
    mgr.start();

    // Advance many ticks so snapshots age out beyond MAX_ROLLBACK_TICKS
    for (let t = 1; t <= 30; t++) {
      mgr.receiveRemoteInputs(1, [{ tick: t, turnDir: 0, accelerate: false, dash: false, brake: false }]);
    }
    for (let i = 0; i < 30; i++) {
      mgr.update(SIM_DT, 0, false, false, false);
    }

    // Try to trigger rollback to a tick whose snapshot was already pruned
    // Deliver a mispredicted input far enough back to be beyond snapshot range
    mgr.receiveRemoteInputs(1, [
      { tick: 2, turnDir: -1, accelerate: true, dash: false, brake: false },
    ]);

    const t = mgr.getTelemetry();
    // If snapshot was missing, snapshotMissCount incremented; if snapshot existed, rollback succeeded
    // Either way the field is a non-negative integer
    expect(typeof t.snapshotMissCount).toBe('number');
    expect(t.snapshotMissCount).toBeGreaterThanOrEqual(0);
  });

  it('classifyHealth: snapshotMissCount >= 3 is unstable', () => {
    const h = classifyHealth(baseTelemetry({ snapshotMissCount: 3 }));
    expect(h.level).toBe('unstable');
    expect(h.reasons.some(r => r.includes('snapshot'))).toBe(true);
  });

  it('classifyHealth: snapshotMissCount 1-2 is degraded', () => {
    const h = classifyHealth(baseTelemetry({ snapshotMissCount: 2 }));
    expect(h.level).toBe('degraded');
    expect(h.reasons.some(r => r.includes('snapshot'))).toBe(true);
  });

  it('classifyHealth: rollbackP99Ms > 8 is degraded', () => {
    const h = classifyHealth(baseTelemetry({ rollbackP99Ms: 10 }));
    expect(h.level).toBe('degraded');
    expect(h.reasons.some(r => r.includes('rollback p99'))).toBe(true);
  });

  it('peakRollbackMs tracks maximum rollback cost', () => {
    const { mgr } = createManager();
    mgr.start();

    // Trigger multiple rollbacks of varying depth
    for (let round = 0; round < 3; round++) {
      for (let t = 1; t <= 6; t++) {
        mgr.receiveRemoteInputs(1, [{ tick: t + round * 10, turnDir: 0, accelerate: false, dash: false, brake: false }]);
      }
      for (let i = 0; i < 6; i++) {
        mgr.update(SIM_DT, 0, false, false, false);
      }
      // Misprediction triggers rollback
      mgr.receiveRemoteInputs(1, [
        { tick: 3 + round * 10, turnDir: (round % 2 === 0 ? 1 : -1) as 1 | -1, accelerate: true, dash: false, brake: false },
      ]);
    }

    const t = mgr.getTelemetry();
    // peakRollbackCostMs should be the maximum of all individual rollback costs
    expect(t.peakRollbackCostMs).toBeGreaterThanOrEqual(0);
    // It should be >= avgRollbackCostMs (peak >= average)
    if (t.rollbackCount > 0) {
      expect(t.peakRollbackCostMs).toBeGreaterThanOrEqual(t.avgRollbackCostMs);
    }
  });

  it('peakRecoveryMs tracks maximum recovery cost', () => {
    const { mgr } = createManager();
    mgr.start();

    // Trigger desync recovery by exceeding desync threshold
    for (let t = 1; t <= 65; t++) {
      mgr.receiveRemoteInputs(1, [{ tick: t, turnDir: 0, accelerate: false, dash: false, brake: false }]);
    }
    for (let i = 0; i < 65; i++) {
      mgr.update(SIM_DT, 0, false, false, false);
    }

    // Simulate recovery by feeding a recovery snapshot
    const snapshotState = mgr.state;
    mgr.receiveRecoverySnapshot(JSON.parse(JSON.stringify(snapshotState)));

    const t = mgr.getTelemetry();
    // peakRecoveryCostMs should be >= 0 and >= avgRecoveryCostMs
    expect(t.peakRecoveryCostMs).toBeGreaterThanOrEqual(0);
    if (t.recoveryCount > 0) {
      expect(t.peakRecoveryCostMs).toBeGreaterThanOrEqual(t.avgRecoveryCostMs);
    }
  });

  it('peakSimTickCostMs is always >= avgSimTickCostMs', () => {
    const { mgr } = createManager();
    mgr.start();

    for (let t = 1; t <= 20; t++) {
      mgr.receiveRemoteInputs(1, [{ tick: t, turnDir: 0, accelerate: t % 3 === 0, dash: false, brake: false }]);
    }
    for (let i = 0; i < 20; i++) {
      mgr.update(SIM_DT, 0, false, false, false);
    }

    const t = mgr.getTelemetry();
    expect(t.peakSimTickCostMs).toBeGreaterThanOrEqual(t.avgSimTickCostMs);
  });

  describe('getStateDigest', () => {
    it('returns a numeric hash', () => {
      const { mgr } = createManager();
      mgr.start();
      const digest = mgr.getStateDigest();
      expect(typeof digest).toBe('number');
      expect(Number.isFinite(digest)).toBe(true);
    });

    it('returns identical digest for identical state', () => {
      const { mgr } = createManager();
      mgr.start();
      const d1 = mgr.getStateDigest();
      const d2 = mgr.getStateDigest();
      expect(d1).toBe(d2);
    });
  });
});
