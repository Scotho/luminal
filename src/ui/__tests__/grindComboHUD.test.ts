import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GrindComboHUD } from '../grindComboHUD';
import type { GrindComboState } from '../grindComboHUD';

const baseState: GrindComboState = {
  streakCount: 0,
  broken: false,
  isGrinding: true,
  score: 0,
  multiplier: 1.0,
  chain: [],
  dirty: 0,
  cooldownRemaining: 0,
  cooldownTotal: 0,
};

function s(overrides: Partial<GrindComboState>): GrindComboState {
  return { ...baseState, ...overrides };
}

describe('GrindComboHUD', () => {
  let hud: GrindComboHUD;

  beforeEach(() => {
    hud = new GrindComboHUD();
  });

  afterEach(() => {
    hud.dispose();
  });

  it('creates DOM elements on construction', () => {
    const root = document.querySelector('.grind-combo-root');
    expect(root).toBeTruthy();
    expect(root!.querySelector('.grind-combo-score')).toBeTruthy();
    expect(root!.querySelector('.grind-combo-mult')).toBeTruthy();
    expect(root!.querySelector('.grind-combo-chain')).toBeTruthy();
    expect(root!.querySelector('.grind-combo-bar-wrap')).toBeTruthy();
    expect(root!.querySelector('.grind-combo-footer')).toBeTruthy();
  });

  it('injects styles once', () => {
    expect(document.querySelectorAll('#grind-combo-styles').length).toBe(1);
    const hud2 = new GrindComboHUD();
    expect(document.querySelectorAll('#grind-combo-styles').length).toBe(1);
    hud2.dispose();
  });

  it('hidden when streak < 3 and chain empty', () => {
    const root = document.querySelector('.grind-combo-root')!;
    hud.update(s({ streakCount: 2 }));
    expect(root.classList.contains('visible')).toBe(false);
  });

  it('visible when streak >= 3', () => {
    const root = document.querySelector('.grind-combo-root')!;
    hud.update(s({ streakCount: 3 }));
    expect(root.classList.contains('visible')).toBe(true);
  });

  it('visible when chain has at least 1 entry even if streak < 3', () => {
    const root = document.querySelector('.grind-combo-root')!;
    hud.update(s({ streakCount: 1, chain: ['SPIN'], dirty: 1 }));
    expect(root.classList.contains('visible')).toBe(true);
  });

  it('renders score with thousands separator (after lerp converges)', () => {
    const score = document.querySelector('.grind-combo-score')!;
    // Score lerps — call update multiple times to converge
    for (let i = 0; i < 60; i++) hud.update(s({ streakCount: 5, score: 12450 }));
    expect(score.textContent).toBe('12,450');
  });

  it('renders multiplier with × prefix and 1 decimal', () => {
    const mult = document.querySelector('.grind-combo-mult')!;
    hud.update(s({ streakCount: 5, multiplier: 3.5 }));
    expect(mult.textContent).toBe('× 3.5');
  });

  it('renders chain row with arrow separators', () => {
    const chain = document.querySelector('.grind-combo-chain')!;
    hud.update(s({ streakCount: 5, chain: ['CORKSCREW', 'SPIN', 'FLIP'], dirty: 1 }));
    expect(chain.textContent).toBe('CORKSCREW → SPIN → FLIP');
  });

  it('truncates chain to last 5 with overflow suffix', () => {
    const chain = document.querySelector('.grind-combo-chain')!;
    hud.update(s({
      streakCount: 5,
      chain: ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
      dirty: 1,
    }));
    expect(chain.textContent).toBe('C → D → E → F → G  +2');
  });

  it('flashes multiplier on dirty increment', () => {
    const mult = document.querySelector('.grind-combo-mult')!;
    hud.update(s({ streakCount: 5, multiplier: 1.0, dirty: 0 }));
    hud.update(s({ streakCount: 5, multiplier: 1.5, dirty: 1 }));
    expect(mult.classList.contains('flash')).toBe(true);
  });

  it('shake class added on break', () => {
    const score = document.querySelector('.grind-combo-score')!;
    hud.update(s({ streakCount: 5, score: 500 }));
    hud.update(s({ streakCount: 0, broken: true, score: 0 }));
    expect(score.classList.contains('shake')).toBe(true);
  });

  it('triggerCashOut renders +N METER float label', () => {
    const milestone = document.querySelector('.grind-combo-milestone')!;
    hud.triggerCashOut(25);
    expect(milestone.textContent).toBe('+25 METER');
    expect(milestone.classList.contains('active')).toBe(true);
  });

  it('footer shows GRIND • N HITS while grinding', () => {
    const footer = document.querySelector('.grind-combo-footer')!;
    hud.update(s({ streakCount: 24, isGrinding: true, score: 500 }));
    expect(footer.textContent).toContain('GRIND');
    expect(footer.textContent).toContain('24 HITS');
  });

  it('footer shows COOLING with progress bar while cooldownRemaining > 0', () => {
    const footer = document.querySelector('.grind-combo-footer')!;
    hud.update(s({
      streakCount: 24, isGrinding: false, chain: ['SPIN'], dirty: 1,
      cooldownRemaining: 1.5, cooldownTotal: 3.0,
    }));
    expect(footer.textContent).toContain('COOLING');
  });

  it('setGlowColor applies CSS variable', () => {
    const root = document.querySelector('.grind-combo-root') as HTMLElement;
    hud.setGlowColor(0xff0000);
    expect(root.style.getPropertyValue('--combo-glow')).toBe('rgb(255,0,0)');
  });

  it('dispose removes DOM', () => {
    hud.dispose();
    expect(document.querySelector('.grind-combo-root')).toBeNull();
  });
});
