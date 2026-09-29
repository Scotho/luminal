/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  initFlowHUD,
  updateFlowHUD,
  resetFlowHUD,
  setFlowHudCharacterState,
  _resetFlowHUDForTesting,
} from '../flowHUD';
import type { FlowSnapshot } from '../../flow/flowTypes';

function makeElements() {
  const wrap = document.createElement('div');
  const value = document.createElement('div');
  const mult = document.createElement('div');
  const bankLayer = document.createElement('div');
  document.body.appendChild(wrap);
  wrap.appendChild(value);
  wrap.appendChild(mult);
  wrap.appendChild(bankLayer);
  return { wrap, value, mult, bankLayer };
}

function makeSnapshot(overrides: Partial<FlowSnapshot> = {}): FlowSnapshot {
  return {
    active: 0,
    passiveSubtotal: 0,
    bonusSubtotal: 0,
    tierIndex: 0,
    multiplier: 1,
    capState: 'open',
    lastGainAmount: 0,
    lastGainAt: 0,
    pendingBanks: [],
    ...overrides,
  };
}

describe('flowHUD', () => {
  let els: ReturnType<typeof makeElements>;

  beforeEach(() => {
    _resetFlowHUDForTesting();
    document.body.innerHTML = '';
    els = makeElements();
    initFlowHUD(els);
    // Mock performance.now for consistent test timing
    vi.spyOn(performance, 'now').mockReturnValue(1000);
  });

  it('initFlowHUD caches refs without error', () => {
    // No exception thrown
    expect(els.value).toBeDefined();
  });

  it('updateFlowHUD with snapshot active=100 sets value text', () => {
    const snap = makeSnapshot({ active: 100 });
    // Call enough times for lerp to converge
    for (let i = 0; i < 120; i++) {
      updateFlowHUD(snap, 16.67);
    }
    expect(els.value.textContent).toBe('100');
  });

  it('large gain (80+) within 600ms sets scale >= 1.8', () => {
    vi.spyOn(performance, 'now').mockReturnValue(500);
    const snap = makeSnapshot({
      active: 200,
      lastGainAmount: 125,
      lastGainAt: 200,
    });
    updateFlowHUD(snap, 16);
    const scale = parseFloat(els.wrap.style.getPropertyValue('--flow-scale'));
    expect(scale).toBeGreaterThanOrEqual(1.8);
  });

  it('multiplier 5 shows active mult element with tier-3 class', () => {
    const snap = makeSnapshot({ multiplier: 5, tierIndex: 2 });
    updateFlowHUD(snap, 16);
    expect(els.mult.className).toContain('active');
    expect(els.mult.className).toContain('tier-3');
    expect(els.mult.textContent).toBe('\u00d75');
  });

  it('multiplier 10 shows tier-10 class', () => {
    const snap = makeSnapshot({ multiplier: 10, tierIndex: 3 });
    updateFlowHUD(snap, 16);
    expect(els.mult.className).toContain('tier-10');
  });

  it('multiplier 1 hides mult element', () => {
    const snap = makeSnapshot({ multiplier: 1, tierIndex: 0 });
    updateFlowHUD(snap, 16);
    expect(els.mult.className).toBe('flow-hud__mult');
    expect(els.mult.className).not.toContain('active');
  });

  it('pending bank spawns a .flow-bank child element', () => {
    const snap = makeSnapshot({
      pendingBanks: [{ id: 1, amount: 50, source: 'slipstream', spawnedAt: 100 }],
    });
    updateFlowHUD(snap, 16);
    const bank = els.bankLayer.querySelector('.flow-bank');
    expect(bank).not.toBeNull();
    expect(bank!.textContent).toBe('+50');
    expect(bank!.className).toContain('flow-bank--slipstream');
  });

  it('resetFlowHUD zeroes displayed value and clears bank layer', () => {
    const snap = makeSnapshot({ active: 500 });
    for (let i = 0; i < 60; i++) updateFlowHUD(snap, 16);
    resetFlowHUD();
    expect(els.value.textContent).toBe('0');
    expect(els.bankLayer.innerHTML).toBe('');
  });

  it('no gain for 600ms decays scale and glow to base', () => {
    vi.spyOn(performance, 'now').mockReturnValue(2000);
    const snap = makeSnapshot({
      lastGainAt: 500, // 1500ms ago — well past 600ms
    });
    // Run several frames
    for (let i = 0; i < 60; i++) {
      updateFlowHUD(snap, 16.67);
    }
    const scale = parseFloat(els.wrap.style.getPropertyValue('--flow-scale'));
    expect(scale).toBe(1);
    const glow = parseFloat(els.wrap.style.getPropertyValue('--flow-glow'));
    expect(glow).toBe(0);
  });

  it('setFlowHudCharacterState adds/removes character classes', () => {
    setFlowHudCharacterState('vector');
    expect(els.wrap.classList.contains('flow-hud--vector')).toBe(true);

    setFlowHudCharacterState('spectre');
    expect(els.wrap.classList.contains('flow-hud--vector')).toBe(false);
    expect(els.wrap.classList.contains('flow-hud--spectre')).toBe(true);

    setFlowHudCharacterState(null);
    expect(els.wrap.classList.contains('flow-hud--spectre')).toBe(false);
  });
});
