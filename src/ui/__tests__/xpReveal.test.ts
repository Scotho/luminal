import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockStopTally = vi.fn();
vi.mock('../../sfxAssets', () => ({
  startRewardTally: vi.fn(() => mockStopTally),
  playRewardTotal: vi.fn(),
  playRewardLevelUp: vi.fn(),
}));

import { renderXpBar, skipXpAnimation, cleanupXpBar } from '../xpReveal';
import { startRewardTally, playRewardTotal, playRewardLevelUp } from '../../sfxAssets';
import type { MatchXpResult } from '../../progression/progressionBridge';

function setupDOM(): void {
  document.body.innerHTML = `
    <div id="xp-reveal" class="xp-bar hidden"></div>
    <div id="xp-toast-container" class="xp-toast-stack hidden"></div>
  `;
}

function makeResult(overrides: Partial<MatchXpResult> = {}): MatchXpResult {
  return {
    award: { base: 80, winBonus: 40, streakBonus: 0, seriesBonus: 0, total: 120 },
    levelsGained: 0,
    previousLevel: 4,
    newLevel: 4,
    newUnlocks: [],
    ...overrides,
  };
}

describe('xpReveal', () => {
  beforeEach(() => { setupDOM(); vi.useFakeTimers(); });
  afterEach(() => { cleanupXpBar(); vi.useRealTimers(); });

  describe('renderXpBar — normal match', () => {
    it('renders bar with correct level and XP badge', () => {
      renderXpBar(makeResult(), false, 340, 500);
      const bar = document.getElementById('xp-reveal')!;
      expect(bar.classList.contains('hidden')).toBe(false);
      expect(bar.querySelector('.xp-bar__label')!.textContent).toBe('LEVEL 4');
      expect(bar.querySelector('.xp-bar__badge')!.textContent).toBe('+120 XP');
    });

    it('shows progress text', () => {
      renderXpBar(makeResult(), false, 340, 500);
      vi.advanceTimersByTime(700);
      const progress = document.querySelector('.xp-bar__progress');
      expect(progress).not.toBeNull();
      expect(progress!.textContent).toContain('340');
      expect(progress!.textContent).toContain('500');
    });

    it('becomes visible after fade-in delay', () => {
      renderXpBar(makeResult(), false, 340, 500);
      vi.advanceTimersByTime(50);
      expect(document.getElementById('xp-reveal')!.classList.contains('xp-bar--visible')).toBe(true);
    });
  });

  describe('renderXpBar — level up', () => {
    it('applies levelup class on level-up', () => {
      renderXpBar(makeResult({ levelsGained: 1, previousLevel: 4, newLevel: 5, newUnlocks: ['map:synth_city', 'color:pink'] }), false, 70, 450);
      vi.advanceTimersByTime(1200);
      expect(document.getElementById('xp-reveal')!.classList.contains('xp-bar--levelup')).toBe(true);
    });

    it('shows toast stack for unlocks', () => {
      renderXpBar(makeResult({ levelsGained: 1, previousLevel: 4, newLevel: 5, newUnlocks: ['map:synth_city', 'color:pink'] }), false, 70, 450);
      vi.advanceTimersByTime(2000);
      expect(document.querySelectorAll('.xp-toast').length).toBe(2);
    });

    it('updates level label to new level', () => {
      renderXpBar(makeResult({ levelsGained: 1, previousLevel: 4, newLevel: 5 }), false, 70, 450);
      vi.advanceTimersByTime(1000);
      expect(document.querySelector('.xp-bar__label')!.textContent).toBe('LEVEL 5');
    });
  });

  describe('renderXpBar — anonymous', () => {
    it('renders muted bar with anon class', () => {
      renderXpBar(null, true, 0, 100);
      expect(document.getElementById('xp-reveal')!.classList.contains('xp-bar--anon')).toBe(true);
    });

    it('shows sign-in overlay', () => {
      renderXpBar(null, true, 0, 100);
      const signin = document.querySelector('.xp-bar__signin');
      expect(signin).not.toBeNull();
      expect(signin!.textContent).toContain('SIGN IN');
    });

    it('does not show toast stack for anon', () => {
      renderXpBar(null, true, 0, 100);
      vi.advanceTimersByTime(3000);
      expect(document.querySelectorAll('.xp-toast').length).toBe(0);
    });
  });

  describe('skipXpAnimation', () => {
    it('snaps bar to final state', () => {
      renderXpBar(makeResult(), false, 340, 500);
      skipXpAnimation();
      const fill = document.querySelector('.xp-bar__fill') as HTMLElement;
      expect(fill).not.toBeNull();
      expect(fill.style.transition).toBe('none');
    });

    it('dismisses active toasts', () => {
      renderXpBar(makeResult({ levelsGained: 1, newLevel: 5, newUnlocks: ['map:synth_city'] }), false, 70, 450);
      vi.advanceTimersByTime(2000);
      skipXpAnimation();
      expect(document.getElementById('xp-toast-container')!.classList.contains('hidden')).toBe(true);
    });
  });

  describe('cleanupXpBar', () => {
    it('resets DOM to hidden state', () => {
      renderXpBar(makeResult(), false, 340, 500);
      cleanupXpBar();
      const bar = document.getElementById('xp-reveal')!;
      expect(bar.classList.contains('hidden')).toBe(true);
      expect(bar.innerHTML).toBe('');
    });
  });

  describe('multi-level-up', () => {
    it('shows all unlocks from multiple levels', () => {
      renderXpBar(makeResult({ levelsGained: 2, previousLevel: 1, newLevel: 3, newUnlocks: ['map:synth_pit', 'color:blue', 'color:green'] }), false, 0, 250);
      vi.advanceTimersByTime(3000);
      expect(document.querySelectorAll('.xp-toast').length).toBe(3);
    });
  });

  describe('token notification', () => {
    it('shows token toast for level 6', () => {
      renderXpBar(makeResult({ levelsGained: 1, previousLevel: 5, newLevel: 6, newUnlocks: [] }), false, 0, 550);
      vi.advanceTimersByTime(2000);
      expect(document.querySelector('.xp-toast--token')).not.toBeNull();
    });
  });

  describe('reward SFX', () => {
    beforeEach(() => {
      mockStopTally.mockClear();
      vi.mocked(startRewardTally).mockClear();
      vi.mocked(playRewardTotal).mockClear();
      vi.mocked(playRewardLevelUp).mockClear();
    });

    it('starts tally sound on XP bar render (authenticated)', () => {
      renderXpBar(makeResult(), false, 340, 500);
      expect(startRewardTally).toHaveBeenCalled();
    });

    it('plays total sound when fill completes (no level-up)', () => {
      renderXpBar(makeResult(), false, 340, 500);
      vi.advanceTimersByTime(500);
      expect(playRewardTotal).toHaveBeenCalled();
      expect(mockStopTally).toHaveBeenCalled();
    });

    it('plays level-up sound on flash', () => {
      renderXpBar(makeResult({ levelsGained: 1, previousLevel: 4, newLevel: 5 }), false, 70, 450);
      vi.advanceTimersByTime(1200);
      expect(playRewardLevelUp).toHaveBeenCalled();
    });

    it('does not play SFX for anonymous users', () => {
      renderXpBar(null, true, 0, 100);
      expect(startRewardTally).not.toHaveBeenCalled();
    });
  });
});
