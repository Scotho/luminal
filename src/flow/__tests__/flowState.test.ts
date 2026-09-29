import { describe, it, expect, beforeEach } from 'vitest';
import {
  createFlowState,
  beginRound,
  endRound,
  tickPassive,
  tickSurvival,
  tickBoost,
  awardElimination,
  spawnPendingBank,
  commitPendingBank,
  getSnapshot,
  _resetForTesting,
  type FlowState,
} from '../flowState';
import { FLOW_TICK_AMOUNT, FLOW_BONUS, FLOW_SOFT_CAP, FLOW_HARD_CAP } from '../flowTuning';

describe('flowState', () => {
  let state: FlowState;

  beforeEach(() => {
    state = createFlowState();
  });

  // 1. Fresh state → all subtotals zero, multiplier 1x
  it('fresh state has zero subtotals and 1x multiplier', () => {
    const snap = getSnapshot(state);
    expect(snap.active).toBe(0);
    expect(snap.passiveSubtotal).toBe(0);
    expect(snap.bonusSubtotal).toBe(0);
    expect(snap.multiplier).toBe(1);
    expect(snap.tierIndex).toBe(0);
    expect(snap.capState).toBe('open');
  });

  // 2. tickPassive('slipstream') 4 times → active=20, passiveSubtotal=20
  it('4 slipstream ticks accumulate 20 passive flow', () => {
    beginRound(state, 0, 0);
    tickPassive(state, 'slipstream', 100);
    tickPassive(state, 'slipstream', 200);
    tickPassive(state, 'slipstream', 300);
    tickPassive(state, 'slipstream', 400);

    const snap = getSnapshot(state);
    expect(snap.active).toBe(20);
    expect(snap.passiveSubtotal).toBe(20);
  });

  // 3. 100 slipstream ticks with multiplier 5x → hard cap applied
  it('applies hard cap on endRound when multiplied total exceeds 2500', () => {
    beginRound(state, 5, 0); // streak 5 → tier 2, 5x

    // 100 ticks × 5 per tick = 500 active
    for (let i = 0; i < 100; i++) {
      tickPassive(state, 'slipstream', i);
    }

    expect(state.active).toBe(500);
    const result = endRound(state, 'won');
    // floor(500 * 5) = 2500 → equals hard cap
    expect(result.awarded).toBe(FLOW_HARD_CAP);
    expect(result.capApplied).toBe('hard');
  });

  // 4. Drift-low vs drift-high have correct relative magnitudes
  it('drift-low gives less flow per tick than drift-high', () => {
    beginRound(state, 0, 0);
    tickPassive(state, 'drift-low', 100);
    const lowVal = state.active;

    _resetForTesting(state);
    beginRound(state, 0, 0);
    tickPassive(state, 'drift-high', 100);
    const highVal = state.active;

    expect(lowVal).toBe(FLOW_TICK_AMOUNT['drift-low']);
    expect(highVal).toBe(FLOW_TICK_AMOUNT['drift-high']);
    expect(highVal).toBeGreaterThan(lowVal);
  });

  // 5. awardElimination x3 → bonusSubtotal = 375
  it('3 eliminations award 375 bonus flow', () => {
    beginRound(state, 0, 0);
    awardElimination(state, 100);
    awardElimination(state, 200);
    awardElimination(state, 300);

    const snap = getSnapshot(state);
    expect(snap.bonusSubtotal).toBe(375);
    expect(snap.active).toBe(375);
  });

  // 6. Died mid-round → awarded=0, died=true, subtotals preserved
  it('death returns awarded=0 with preserved subtotals', () => {
    beginRound(state, 0, 0);
    tickPassive(state, 'slipstream', 100);
    tickPassive(state, 'slipstream', 200);
    awardElimination(state, 300);

    const result = endRound(state, 'died');
    expect(result.awarded).toBe(0);
    expect(result.died).toBe(true);
    expect(result.passiveSubtotal).toBe(10);
    expect(result.bonusSubtotal).toBe(125);
    expect(result.subtotal).toBe(135);
  });

  // 7. Multiplier tier snapshot: beginRound(state, 5) → multiplier=5
  it('locks multiplier tier at beginRound', () => {
    beginRound(state, 5, 0);
    expect(state.multiplier).toBe(5);
    expect(state.tierIndex).toBe(2);

    // Multiplier doesn't change mid-round
    beginRound(state, 10, 0);
    expect(state.multiplier).toBe(10);
    expect(state.tierIndex).toBe(3);
  });

  // 8. Soft cap compression: gains past 2000 scale sub-linearly
  it('soft cap compresses gains past 2000', () => {
    beginRound(state, 0, 0);

    // Get to 1998 active (just below soft cap)
    for (let i = 0; i < 399; i++) {
      tickPassive(state, 'slipstream', i);
    }
    // 399 ticks × 5 = 1995
    expect(state.active).toBe(1995);
    expect(state.capState).toBe('open');

    // Two more ticks push past soft cap of 2000
    tickPassive(state, 'slipstream', 500);
    // 1995 + 5 = 2000 → exactly at soft cap (no compression)
    expect(state.active).toBe(2000);
    expect(state.capState).toBe('open');

    tickPassive(state, 'slipstream', 501);
    // over = (2000+5) - 2000 = 5
    // compressed = sqrt(5 * 500) = sqrt(2500) = 50
    // active = min(2500, 2000 + 50) = 2050
    expect(state.active).toBe(2050);
    expect(state.capState).toBe('soft');

    // Many more ticks approach but don't exceed hard cap
    for (let i = 0; i < 500; i++) {
      tickPassive(state, 'slipstream', 600 + i);
    }
    expect(state.active).toBeLessThanOrEqual(FLOW_HARD_CAP);
  });

  // 9. Bank commit doesn't double-add to active
  it('bank commit does not double-add to active', () => {
    beginRound(state, 0, 0);
    tickPassive(state, 'slipstream', 100);
    tickPassive(state, 'slipstream', 200);
    const activeBeforeBank = state.active; // 10

    const bankId = spawnPendingBank(state, 'slipstream', 10, 300);
    expect(state.active).toBe(activeBeforeBank); // unchanged

    commitPendingBank(state, bankId, 400);
    expect(state.active).toBe(activeBeforeBank); // still unchanged
  });

  // 10. _resetForTesting zeroes everything
  it('_resetForTesting zeroes all state', () => {
    beginRound(state, 5, 0);
    tickPassive(state, 'slipstream', 100);
    awardElimination(state, 200);
    spawnPendingBank(state, 'slipstream', 5, 300);

    _resetForTesting(state);

    const snap = getSnapshot(state);
    expect(snap.active).toBe(0);
    expect(snap.passiveSubtotal).toBe(0);
    expect(snap.bonusSubtotal).toBe(0);
    expect(snap.multiplier).toBe(1);
    expect(snap.tierIndex).toBe(0);
    expect(snap.capState).toBe('open');
    expect(snap.lastGainAmount).toBe(0);
    expect(snap.lastGainAt).toBe(0);
    expect(snap.pendingBanks).toHaveLength(0);
  });
});

describe('flowState — additional coverage', () => {
  let state: FlowState;

  beforeEach(() => {
    state = createFlowState();
  });

  it('tickPassive does nothing when round is not active', () => {
    tickPassive(state, 'slipstream', 100);
    expect(state.active).toBe(0);
  });

  it('tickSurvival accumulates bonus flow over time', () => {
    beginRound(state, 0, 0);
    tickSurvival(state, 1.0, 100); // 1 second → 3 flow
    expect(state.bonusSubtotal).toBeCloseTo(FLOW_BONUS.survivalPerSec, 1);
  });

  it('tickBoost accumulates bonus flow while dashing', () => {
    beginRound(state, 0, 0);
    tickBoost(state, 1.0, 100); // 1 second → 8 flow
    expect(state.bonusSubtotal).toBeCloseTo(FLOW_BONUS.boostPerSec, 1);
  });

  it('endRound builds trick log in spec order', () => {
    beginRound(state, 0, 0);
    awardElimination(state, 100);
    tickPassive(state, 'drift-low', 200);
    tickPassive(state, 'slipstream', 300);
    tickPassive(state, 'grind', 400);
    tickBoost(state, 0.5, 500);
    tickSurvival(state, 0.5, 600);

    const result = endRound(state, 'won');
    const kinds = result.trickLog.map((e) => e.kind);

    // Elimination first, then slipstream, drift, grind, boost, survival
    expect(kinds[0]).toBe('elimination');
    expect(kinds[1]).toBe('slipstream');
    expect(kinds[2]).toBe('drift');
    expect(kinds[3]).toBe('grind');
    expect(kinds[4]).toBe('boost');
    expect(kinds[5]).toBe('survival');
  });

  it('elimination trick log entry includes count', () => {
    beginRound(state, 0, 0);
    awardElimination(state, 100);
    awardElimination(state, 200);
    awardElimination(state, 300);

    const result = endRound(state, 'won');
    const elimEntry = result.trickLog.find((e) => e.kind === 'elimination');
    expect(elimEntry).toBeDefined();
    expect(elimEntry!.count).toBe(3);
    expect(elimEntry!.amount).toBe(375);
  });

  it('pending bank lifecycle works correctly', () => {
    beginRound(state, 0, 0);
    const id1 = spawnPendingBank(state, 'drift', 15, 100);
    const id2 = spawnPendingBank(state, 'grind', 20, 200);

    expect(state.pendingBanks).toHaveLength(2);
    expect(id1).not.toBe(id2);

    commitPendingBank(state, id1, 300);
    expect(state.pendingBanks).toHaveLength(1);
    expect(state.pendingBanks[0].id).toBe(id2);

    commitPendingBank(state, id2, 400);
    expect(state.pendingBanks).toHaveLength(0);
  });

  it('lastGainAmount and lastGainAt track most recent gain', () => {
    beginRound(state, 0, 0);
    tickPassive(state, 'slipstream', 100);
    expect(state.lastGainAmount).toBe(5);
    expect(state.lastGainAt).toBe(100);

    awardElimination(state, 200);
    expect(state.lastGainAmount).toBe(125);
    expect(state.lastGainAt).toBe(200);
  });

  it('endRound with 1x multiplier gives subtotal as awarded', () => {
    beginRound(state, 0, 0); // streak 0 → 1x
    for (let i = 0; i < 20; i++) {
      tickPassive(state, 'slipstream', i * 10);
    }
    // 20 ticks × 5 = 100
    const result = endRound(state, 'won');
    expect(result.awarded).toBe(100);
    expect(result.multiplier).toBe(1);
    expect(result.capApplied).toBe('none');
  });

  it('grind ticks accumulate passive flow', () => {
    beginRound(state, 0, 0);
    tickPassive(state, 'grind', 100);
    tickPassive(state, 'grind', 200);
    expect(state.passiveSubtotal).toBe(10);
    expect(state.active).toBe(10);
  });

  it('hard cap blocks all further gains', () => {
    beginRound(state, 0, 0);
    // Force to hard cap via large bonus
    for (let i = 0; i < 20; i++) {
      awardElimination(state, i * 10);
    }
    // 20 × 125 = 2500 → should hit hard cap
    expect(state.active).toBe(FLOW_HARD_CAP);
    expect(state.capState).toBe('hard');

    // Further gains blocked
    const prevActive = state.active;
    tickPassive(state, 'slipstream', 9999);
    expect(state.active).toBe(prevActive);
  });
});
