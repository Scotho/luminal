// ── Replay UI Tests ─────────────────────────────────────
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mocks must be declared before the module import so vi.mock is hoisted.
vi.mock('../../replayStore', () => ({
  toggleFavorite: vi.fn(() => Promise.resolve(false)),
  getReplayList: vi.fn(() => Promise.resolve([])),
  getSeriesById: vi.fn(() => Promise.resolve([])),
  loadReplay: vi.fn(() => Promise.resolve(null)),
}));

import { showScreen, _resetForTesting } from '../navigation';
import {
  toggleControlsOverlay, _isControlsOverlayOpen,
  _updateMatchSelector, _getCurrentSeriesSiblings,
  _toggleReplayExpanded, _isReplayExpanded,
} from '../replayUI';
import { getSeriesById } from '../../replayStore';
import type { ReplayListEntry } from '../../types/index';

describe('Replay UI', () => {
  beforeEach(() => {
    _resetForTesting();
  });

  describe('replay overlay DOM', () => {
    it('#replay-overlay exists', () => {
      expect(document.getElementById('replay-overlay')).toBeTruthy();
    });

    it('starts hidden', () => {
      expect(document.getElementById('replay-overlay')!.classList.contains('hidden')).toBe(true);
    });

    it('becomes visible with showScreen("replay")', () => {
      showScreen('replay');
      expect(document.getElementById('replay-overlay')!.classList.contains('hidden')).toBe(false);
    });
  });

  describe('transport controls', () => {
    it('has play/pause button', () => {
      expect(document.getElementById('btn-replay-play')).toBeTruthy();
    });

    it('has rewind button', () => {
      expect(document.getElementById('btn-replay-rw')).toBeTruthy();
    });

    it('has fast-forward button', () => {
      expect(document.getElementById('btn-replay-ff')).toBeTruthy();
    });

    it('has loop toggle', () => {
      expect(document.getElementById('btn-replay-loop')).toBeTruthy();
    });

    it('has favorite button', () => {
      expect(document.getElementById('btn-replay-fav')).toBeTruthy();
    });
  });

  describe('speed selector', () => {
    it('has speed left/right arrows', () => {
      expect(document.getElementById('btn-replay-speed-left')).toBeTruthy();
      expect(document.getElementById('btn-replay-speed-right')).toBeTruthy();
    });

    it('has speed label', () => {
      const label = document.getElementById('replay-speed-label')!;
      expect(label).toBeTruthy();
      expect(label.textContent).toBe('1x');
    });
  });

  describe('camera selector', () => {
    it('has camera left/right arrows', () => {
      expect(document.getElementById('btn-replay-cam-left')).toBeTruthy();
      expect(document.getElementById('btn-replay-cam-right')).toBeTruthy();
    });

    it('has camera value label', () => {
      const label = document.getElementById('replay-cam-val')!;
      expect(label).toBeTruthy();
      expect(label.textContent).toBe('OVERHEAD');
    });
  });

  describe('progress bar', () => {
    it('has progress container', () => {
      expect(document.getElementById('replay-progress')).toBeTruthy();
    });

    it('has progress fill', () => {
      expect(document.getElementById('replay-progress-fill')).toBeTruthy();
    });

    it('has time display', () => {
      const time = document.getElementById('replay-time')!;
      expect(time).toBeTruthy();
      expect(time.textContent).toContain('0:00');
    });
  });

  describe('exit button', () => {
    it('has exit button at top', () => {
      const btn = document.getElementById('btn-replay-exit-top')!;
      expect(btn).toBeTruthy();
      expect(btn.textContent).toContain('EXIT');
    });
  });

  describe('status display', () => {
    it('has replay status text', () => {
      const status = document.getElementById('replay-status')!;
      expect(status).toBeTruthy();
      expect(status.textContent).toBe('REPLAY');
    });
  });

  describe('restart button', () => {
    it('has restart button (hidden by default)', () => {
      const btn = document.getElementById('btn-replay-restart')!;
      expect(btn).toBeTruthy();
      expect(btn.classList.contains('hidden')).toBe(true);
    });
  });

  describe('controller hint pill', () => {
    it('#replay-controller-hint exists in DOM', () => {
      const hint = document.getElementById('replay-controller-hint');
      expect(hint).toBeTruthy();
    });

    it('is hidden by default (no gamepad connected in jsdom)', () => {
      const hint = document.getElementById('replay-controller-hint')!;
      expect(hint.hidden).toBe(true);
    });

    it('contains SELECT label text', () => {
      const hint = document.getElementById('replay-controller-hint')!;
      expect(hint.textContent).toContain('SELECT');
      expect(hint.textContent).toContain('Show controls');
    });
  });

  describe('controls summary overlay', () => {
    it('#replay-controls-overlay exists in DOM', () => {
      const overlay = document.getElementById('replay-controls-overlay');
      expect(overlay).toBeTruthy();
    });

    it('is hidden by default', () => {
      const overlay = document.getElementById('replay-controls-overlay')!;
      expect(overlay.hidden).toBe(true);
    });

    it('has the REPLAY CONTROLS title', () => {
      const title = document.querySelector('.replay-controls-title');
      expect(title).toBeTruthy();
      expect(title!.textContent).toBe('REPLAY CONTROLS');
    });

    it('lists all expected control rows', () => {
      const overlay = document.getElementById('replay-controls-overlay')!;
      const text = overlay.textContent || '';
      expect(text).toContain('LB / RB');
      expect(text).toContain('LT / RT');
      expect(text).toContain('D-pad');
      expect(text).toContain('Play / pause');
      expect(text).toContain('Toggle UI');
      expect(text).toContain('Exit replay');
    });

    it('has a footer telling the user to press SELECT to close', () => {
      const footer = document.querySelector('.replay-controls-footer');
      expect(footer).toBeTruthy();
      expect(footer!.textContent).toContain('SELECT');
    });

    it('toggleControlsOverlay() flips the hidden attribute', () => {
      const overlay = document.getElementById('replay-controls-overlay')!;
      // Start hidden
      overlay.hidden = true;
      expect(_isControlsOverlayOpen()).toBe(false);

      toggleControlsOverlay();
      expect(overlay.hidden).toBe(false);
      expect(_isControlsOverlayOpen()).toBe(true);

      toggleControlsOverlay();
      expect(overlay.hidden).toBe(true);
      expect(_isControlsOverlayOpen()).toBe(false);
    });
  });

  // ── TASK-296: match selector pill ───────────────────────
  describe('match selector pill', () => {
    function makeSeriesEntry(id: string, roundIndex: number, seriesId: string | null = 'series-1'): ReplayListEntry {
      return {
        id,
        timestamp: 1_000_000 + roundIndex * 1000,
        favorite: false,
        result: 'player',
        duration: 120,
        playerColor: 0x00ffff,
        aiColors: [{ color: 0xff4400, emissive: 0xff4400 }],
        seriesInfo: seriesId
          ? { length: 3, playerWins: 1, aiWins: [0], roundIndex, seriesId }
          : null,
        matchType: 'ai',
        winnerName: 'YOU',
        opponentName: 'CPU',
      };
    }

    beforeEach(() => {
      // Reset mock call history between tests
      vi.mocked(getSeriesById).mockReset();
      vi.mocked(getSeriesById).mockResolvedValue([]);
      // Ensure the selector is hidden at start of each test
      const selector = document.getElementById('replay-match-selector');
      if (selector) selector.hidden = true;
    });

    it('#replay-match-selector exists in DOM', () => {
      const selector = document.getElementById('replay-match-selector');
      expect(selector).toBeTruthy();
    });

    it('is hidden by default', () => {
      const selector = document.getElementById('replay-match-selector')!;
      expect(selector.hidden).toBe(true);
    });

    it('has prev and next buttons', () => {
      expect(document.getElementById('replay-match-prev')).toBeTruthy();
      expect(document.getElementById('replay-match-next')).toBeTruthy();
    });

    it('has match index and total span elements', () => {
      expect(document.getElementById('replay-match-index')).toBeTruthy();
      expect(document.getElementById('replay-match-total')).toBeTruthy();
    });

    it('_updateMatchSelector(null) keeps selector hidden', async () => {
      await _updateMatchSelector(null);
      const selector = document.getElementById('replay-match-selector')!;
      expect(selector.hidden).toBe(true);
      expect(_getCurrentSeriesSiblings()).toEqual([]);
    });

    it('_updateMatchSelector with a non-series replay keeps selector hidden', async () => {
      const nonSeriesEntry = makeSeriesEntry('solo-1', 0, null);
      await _updateMatchSelector(nonSeriesEntry);
      const selector = document.getElementById('replay-match-selector')!;
      expect(selector.hidden).toBe(true);
      expect(getSeriesById).not.toHaveBeenCalled();
    });

    it('_updateMatchSelector with a 3-match series populates index/total and shows the pill', async () => {
      const entries: ReplayListEntry[] = [
        makeSeriesEntry('r1', 0),
        makeSeriesEntry('r2', 1),
        makeSeriesEntry('r3', 2),
      ];
      vi.mocked(getSeriesById).mockResolvedValue(entries);

      await _updateMatchSelector(entries[0]);

      const selector = document.getElementById('replay-match-selector')!;
      expect(selector.hidden).toBe(false);
      expect(document.getElementById('replay-match-index')!.textContent).toBe('1');
      expect(document.getElementById('replay-match-total')!.textContent).toBe('3');
      expect(getSeriesById).toHaveBeenCalledWith('series-1');
    });

    it('prev button is disabled at match 1 and next is enabled', async () => {
      const entries: ReplayListEntry[] = [
        makeSeriesEntry('r1', 0),
        makeSeriesEntry('r2', 1),
        makeSeriesEntry('r3', 2),
      ];
      vi.mocked(getSeriesById).mockResolvedValue(entries);

      await _updateMatchSelector(entries[0]);

      const prev = document.getElementById('replay-match-prev') as HTMLButtonElement;
      const next = document.getElementById('replay-match-next') as HTMLButtonElement;
      expect(prev.disabled).toBe(true);
      expect(next.disabled).toBe(false);
    });

    it('next button is disabled at the final match and prev is enabled', async () => {
      const entries: ReplayListEntry[] = [
        makeSeriesEntry('r1', 0),
        makeSeriesEntry('r2', 1),
        makeSeriesEntry('r3', 2),
      ];
      vi.mocked(getSeriesById).mockResolvedValue(entries);

      await _updateMatchSelector(entries[2]);

      const prev = document.getElementById('replay-match-prev') as HTMLButtonElement;
      const next = document.getElementById('replay-match-next') as HTMLButtonElement;
      expect(document.getElementById('replay-match-index')!.textContent).toBe('3');
      expect(prev.disabled).toBe(false);
      expect(next.disabled).toBe(true);
    });

    it('caches siblings in the module so subsequent calls can reuse them', async () => {
      const entries: ReplayListEntry[] = [
        makeSeriesEntry('r1', 0),
        makeSeriesEntry('r2', 1),
      ];
      vi.mocked(getSeriesById).mockResolvedValue(entries);

      await _updateMatchSelector(entries[0]);

      const cached = _getCurrentSeriesSiblings();
      expect(cached).toHaveLength(2);
      expect(cached[0].id).toBe('r1');
      expect(cached[1].id).toBe('r2');
    });

    it('sorts siblings by roundIndex ascending', async () => {
      // Provide out-of-order siblings and check they get sorted.
      const entries: ReplayListEntry[] = [
        makeSeriesEntry('r3', 2),
        makeSeriesEntry('r1', 0),
        makeSeriesEntry('r2', 1),
      ];
      vi.mocked(getSeriesById).mockResolvedValue(entries);

      await _updateMatchSelector(makeSeriesEntry('r1', 0));

      const cached = _getCurrentSeriesSiblings();
      expect(cached.map((e: ReplayListEntry) => e.id)).toEqual(['r1', 'r2', 'r3']);
      // The current replay is r1 (roundIndex 0) — should be at position 1 of 3.
      expect(document.getElementById('replay-match-index')!.textContent).toBe('1');
      expect(document.getElementById('replay-match-total')!.textContent).toBe('3');
    });
  });

  // ── TASK-298: mobile portrait header + expand toggle ─────
  describe('mobile portrait header + expand toggle', () => {
    it('#replay-mobile-header exists in DOM', () => {
      const header = document.getElementById('replay-mobile-header');
      expect(header).toBeTruthy();
    });

    it('#replay-mobile-header starts hidden', () => {
      const header = document.getElementById('replay-mobile-header') as HTMLElement;
      expect(header.hasAttribute('hidden')).toBe(true);
    });

    it('#replay-mobile-back button exists inside the header', () => {
      const header = document.getElementById('replay-mobile-header')!;
      const back = header.querySelector('#replay-mobile-back');
      expect(back).toBeTruthy();
    });

    it('#replay-mobile-header has a center slot for the match selector', () => {
      const header = document.getElementById('replay-mobile-header')!;
      const center = header.querySelector('.replay-mobile-header-center');
      expect(center).toBeTruthy();
    });

    it('#replay-expand-toggle exists in DOM', () => {
      const btn = document.getElementById('replay-expand-toggle');
      expect(btn).toBeTruthy();
    });

    it('#replay-expand-toggle starts with aria-expanded="false"', () => {
      const btn = document.getElementById('replay-expand-toggle') as HTMLButtonElement;
      expect(btn.getAttribute('aria-expanded')).toBe('false');
    });

    it('_toggleReplayExpanded() flips the .replay--expanded class on #replay-overlay', () => {
      const overlay = document.getElementById('replay-overlay')!;
      // Start clean — ensure the class is not set.
      overlay.classList.remove('replay--expanded');
      expect(overlay.classList.contains('replay--expanded')).toBe(false);
      expect(_isReplayExpanded()).toBe(false);

      _toggleReplayExpanded();
      expect(overlay.classList.contains('replay--expanded')).toBe(true);
      expect(_isReplayExpanded()).toBe(true);
      expect(document.getElementById('replay-expand-toggle')!.getAttribute('aria-expanded')).toBe('true');

      _toggleReplayExpanded();
      expect(overlay.classList.contains('replay--expanded')).toBe(false);
      expect(_isReplayExpanded()).toBe(false);
      expect(document.getElementById('replay-expand-toggle')!.getAttribute('aria-expanded')).toBe('false');
    });
  });
});
