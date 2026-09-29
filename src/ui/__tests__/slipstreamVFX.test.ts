import { describe, it, expect, beforeEach } from 'vitest';
import {
  createSlipstreamPhaseState,
  updateSlipstreamPhase,
  shouldGeneratePassiveFlow,
  getSlipstreamIntensity,
  getChromaticStrength,
  type SlipstreamPhaseState,
} from '../../effects/slipstreamVFX';

describe('slipstreamVFX phase state machine', () => {
  let state: SlipstreamPhaseState;

  beforeEach(() => {
    state = createSlipstreamPhaseState();
  });

  it('starts in idle phase', () => {
    expect(state.phase).toBe('idle');
    expect(state.active).toBe(false);
  });

  it('transitions idle → entry when proximity > threshold', () => {
    updateSlipstreamPhase(state, 0.5, 0);
    expect(state.phase).toBe('entry');
  });

  it('transitions entry → lockIn after 0.3s', () => {
    updateSlipstreamPhase(state, 0.5, 0);       // idle → entry
    updateSlipstreamPhase(state, 0.5, 350);      // 0.35s elapsed → lockIn
    expect(state.phase).toBe('lockIn');
  });

  it('transitions lockIn → active after 0.7s more (1.0s total)', () => {
    updateSlipstreamPhase(state, 0.5, 0);       // idle → entry
    updateSlipstreamPhase(state, 0.5, 350);      // → lockIn at ~0.35s
    updateSlipstreamPhase(state, 0.5, 1100);     // 0.75s in lockIn → active
    expect(state.phase).toBe('active');
    expect(state.active).toBe(true);
  });

  it('transitions active → exit when proximity lost', () => {
    // Run through to active
    updateSlipstreamPhase(state, 0.5, 0);
    updateSlipstreamPhase(state, 0.5, 350);
    updateSlipstreamPhase(state, 0.5, 1100);
    expect(state.phase).toBe('active');

    updateSlipstreamPhase(state, 0.1, 1200);    // prox drops
    expect(state.phase).toBe('exit');
  });

  it('transitions exit → idle after resistance window', () => {
    updateSlipstreamPhase(state, 0.5, 0);
    updateSlipstreamPhase(state, 0.5, 350);
    updateSlipstreamPhase(state, 0.5, 1100);
    updateSlipstreamPhase(state, 0.1, 1200);     // → exit
    updateSlipstreamPhase(state, 0.1, 1500);     // 0.3s later → idle
    expect(state.phase).toBe('idle');
  });

  it('proximity lost during entry → direct to exit', () => {
    updateSlipstreamPhase(state, 0.5, 0);       // → entry
    updateSlipstreamPhase(state, 0.1, 100);      // → exit
    expect(state.phase).toBe('exit');
  });

  it('shouldGeneratePassiveFlow only true in active', () => {
    expect(shouldGeneratePassiveFlow(state)).toBe(false);
    updateSlipstreamPhase(state, 0.5, 0);
    expect(shouldGeneratePassiveFlow(state)).toBe(false);
    updateSlipstreamPhase(state, 0.5, 350);
    expect(shouldGeneratePassiveFlow(state)).toBe(false);
    updateSlipstreamPhase(state, 0.5, 1100);
    expect(shouldGeneratePassiveFlow(state)).toBe(true);
  });

  it('getSlipstreamIntensity returns 0 in idle, 1.0 in active', () => {
    expect(getSlipstreamIntensity(state, 0)).toBe(0);
    updateSlipstreamPhase(state, 0.5, 0);
    updateSlipstreamPhase(state, 0.5, 350);
    updateSlipstreamPhase(state, 0.5, 1100);
    expect(getSlipstreamIntensity(state, 1200)).toBe(1.0);
  });

  it('getChromaticStrength is 0 in idle/entry, ramps in lockIn', () => {
    expect(getChromaticStrength(state, 0)).toBe(0);
    updateSlipstreamPhase(state, 0.5, 0);
    expect(getChromaticStrength(state, 100)).toBe(0); // still in entry
    updateSlipstreamPhase(state, 0.5, 350);
    // In lockIn, should start ramping
    const strength = getChromaticStrength(state, 700);
    expect(strength).toBeGreaterThan(0);
    expect(strength).toBeLessThanOrEqual(1);
  });
});
