import { describe, it, expect, beforeEach } from 'vitest';
import {
  bridgeBeginRound,
  bridgeEndRound,
  bridgeFrameTick,
  bridgeElimination,
  _resetBridgeForTesting,
  type PlayerFlowState,
} from '../flowBridge';
import { createFlowState, getSnapshot, type FlowState } from '../flowState';

function makePlayer(overrides: Partial<PlayerFlowState> = {}): PlayerFlowState {
  return {
    alive: true,
    drifting: false,
    grinding: false,
    dashing: false,
    proximitySpeedBoost: 0,
    slipAngle: 0,
    speed: 60,
    vehicleType: 'bike',
    nearestTrailDist: -1,
    ...overrides,
  };
}

describe('flowBridge', () => {
  let state: FlowState;

  beforeEach(() => {
    state = createFlowState();
    _resetBridgeForTesting();
  });

  it('bridgeBeginRound initializes flow state for a new round', () => {
    bridgeBeginRound(state, 5, 0);
    const snap = getSnapshot(state);
    expect(snap.multiplier).toBe(5);
    expect(snap.tierIndex).toBe(2);
    expect(snap.active).toBe(0);
  });

  it('bridgeFrameTick accumulates survival flow for living player', () => {
    bridgeBeginRound(state, 0, 0);
    const player = makePlayer();
    // Simulate 1 second of frames
    for (let i = 0; i < 60; i++) {
      bridgeFrameTick(state, player, 1 / 60, i * 16);
    }
    const snap = getSnapshot(state);
    // ~3 flow from survival (3/sec × 1sec)
    expect(snap.bonusSubtotal).toBeGreaterThan(2);
    expect(snap.bonusSubtotal).toBeLessThan(4);
  });

  it('bridgeFrameTick accumulates slipstream flow for bike in proximity', () => {
    bridgeBeginRound(state, 0, 0);
    const player = makePlayer({ vehicleType: 'bike', proximitySpeedBoost: 0.5 });
    // Simulate 1 second (4 ticks at 0.25s interval = 20 flow)
    for (let i = 0; i < 60; i++) {
      bridgeFrameTick(state, player, 1 / 60, i * 16);
    }
    const snap = getSnapshot(state);
    // Passive subtotal should have slipstream ticks (5 per tick, 4 ticks = 20)
    expect(snap.passiveSubtotal).toBeGreaterThanOrEqual(15);
  });

  it('bridgeFrameTick does not tick when player is dead', () => {
    bridgeBeginRound(state, 0, 0);
    const player = makePlayer({ alive: false });
    for (let i = 0; i < 60; i++) {
      bridgeFrameTick(state, player, 1 / 60, i * 16);
    }
    const snap = getSnapshot(state);
    expect(snap.active).toBe(0);
  });

  it('bridgeFrameTick accumulates drift flow for car while drifting', () => {
    bridgeBeginRound(state, 0, 0);
    const player = makePlayer({
      vehicleType: 'car',
      drifting: true,
      slipAngle: 0.3,
      speed: 80,
    });
    for (let i = 0; i < 60; i++) {
      bridgeFrameTick(state, player, 1 / 60, i * 16);
    }
    const snap = getSnapshot(state);
    // Should have some passive drift flow
    expect(snap.passiveSubtotal).toBeGreaterThan(0);
  });

  it('bridgeFrameTick accumulates boost flow while dashing', () => {
    bridgeBeginRound(state, 0, 0);
    const player = makePlayer({ dashing: true });
    for (let i = 0; i < 60; i++) {
      bridgeFrameTick(state, player, 1 / 60, i * 16);
    }
    const snap = getSnapshot(state);
    // ~8 flow from boost (8/sec × 1sec) + ~3 survival
    expect(snap.bonusSubtotal).toBeGreaterThan(9);
  });

  it('bridgeElimination awards 125 bonus flow', () => {
    bridgeBeginRound(state, 0, 0);
    bridgeElimination(state, 100);
    const snap = getSnapshot(state);
    expect(snap.bonusSubtotal).toBe(125);
  });

  it('bridgeEndRound returns round result with correct awarded amount', () => {
    bridgeBeginRound(state, 3, 0); // 3x multiplier
    bridgeElimination(state, 100);
    const result = bridgeEndRound(state, 'won');
    // 125 bonus × 3 = 375
    expect(result.awarded).toBe(375);
    expect(result.multiplier).toBe(3);
    expect(result.died).toBe(false);
  });

  it('bridgeEndRound on death returns awarded=0', () => {
    bridgeBeginRound(state, 0, 0);
    bridgeElimination(state, 100);
    const result = bridgeEndRound(state, 'died');
    expect(result.awarded).toBe(0);
    expect(result.died).toBe(true);
    expect(result.bonusSubtotal).toBe(125); // preserved for display
  });

  it('spawns pending bank when slipstream ends', () => {
    bridgeBeginRound(state, 0, 0);
    const player = makePlayer({ vehicleType: 'bike', proximitySpeedBoost: 0.5 });
    // Slipstream for 0.5 seconds
    for (let i = 0; i < 30; i++) {
      bridgeFrameTick(state, player, 1 / 60, i * 16);
    }
    // End slipstream
    const noSlip = makePlayer({ vehicleType: 'bike', proximitySpeedBoost: 0 });
    bridgeFrameTick(state, noSlip, 1 / 60, 500);
    const snap = getSnapshot(state);
    // Should have a pending bank from the ended slipstream
    expect(snap.pendingBanks.length).toBeGreaterThanOrEqual(1);
  });

  it('near-miss awards +40 when exiting the danger zone', () => {
    bridgeBeginRound(state, 0, 0);
    // Enter near-miss zone (dist 1.5, between HIT_RADIUS=0.8 and RANGE=2.5)
    const inZone = makePlayer({ speed: 60, nearestTrailDist: 1.5 });
    for (let i = 0; i < 10; i++) {
      bridgeFrameTick(state, inZone, 1 / 60, i * 16);
    }
    // Exit near-miss zone (dist 5 — safely away)
    const outZone = makePlayer({ speed: 60, nearestTrailDist: 5 });
    bridgeFrameTick(state, outZone, 1 / 60, 2000);
    const snap = getSnapshot(state);
    // Should have 40 bonus (near-miss) + some survival
    expect(snap.bonusSubtotal).toBeGreaterThanOrEqual(40);
  });

  it('near-miss does not trigger when speed is too low', () => {
    bridgeBeginRound(state, 0, 0);
    const slow = makePlayer({ speed: 5, nearestTrailDist: 1.5 });
    for (let i = 0; i < 10; i++) {
      bridgeFrameTick(state, slow, 1 / 60, i * 16);
    }
    const out = makePlayer({ speed: 5, nearestTrailDist: 5 });
    bridgeFrameTick(state, out, 1 / 60, 2000);
    const snap = getSnapshot(state);
    // Only survival bonus, no near-miss
    expect(snap.bonusSubtotal).toBeLessThan(5);
  });

  it('near-miss respects cooldown', () => {
    bridgeBeginRound(state, 0, 0);
    const inZone = makePlayer({ speed: 60, nearestTrailDist: 1.5 });
    const outZone = makePlayer({ speed: 60, nearestTrailDist: 5 });

    // First near-miss at t=200
    for (let i = 0; i < 5; i++) bridgeFrameTick(state, inZone, 1 / 60, i * 16);
    bridgeFrameTick(state, outZone, 1 / 60, 200);
    const after1 = getSnapshot(state).bonusSubtotal;

    // Second near-miss at t=500 (within 1000ms cooldown) — should NOT trigger
    for (let i = 0; i < 5; i++) bridgeFrameTick(state, inZone, 1 / 60, 300 + i * 16);
    bridgeFrameTick(state, outZone, 1 / 60, 500);
    const after2 = getSnapshot(state).bonusSubtotal;
    // Difference should only be survival ticks, not another +40
    expect(after2 - after1).toBeLessThan(10);

    // Third near-miss at t=1500 (past cooldown) — SHOULD trigger
    for (let i = 0; i < 5; i++) bridgeFrameTick(state, inZone, 1 / 60, 1200 + i * 16);
    bridgeFrameTick(state, outZone, 1 / 60, 1500);
    const after3 = getSnapshot(state).bonusSubtotal;
    expect(after3 - after2).toBeGreaterThanOrEqual(40);
  });

  it('near-miss does not trigger when dist is below hit radius', () => {
    bridgeBeginRound(state, 0, 0);
    // Distance 0.5 is inside kill radius — player would be dead
    const tooClose = makePlayer({ speed: 60, nearestTrailDist: 0.5 });
    for (let i = 0; i < 10; i++) {
      bridgeFrameTick(state, tooClose, 1 / 60, i * 16);
    }
    const out = makePlayer({ speed: 60, nearestTrailDist: 5 });
    bridgeFrameTick(state, out, 1 / 60, 2000);
    const snap = getSnapshot(state);
    // No near-miss — was inside kill zone, not near-miss zone
    expect(snap.bonusSubtotal).toBeLessThan(5);
  });
});
