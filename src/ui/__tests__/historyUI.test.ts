// ── History / Replay List Tests ──────────────────────────
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mocks must be declared before the module import so vi.mock is hoisted.
const watchReplayMock = vi.fn();
vi.mock('../../replayStore', () => ({
  getReplayList: vi.fn(() => Promise.resolve([])),
  loadReplay: vi.fn((id: string) => { watchReplayMock(id); return Promise.resolve(null); }),
  toggleFavorite: vi.fn(() => Promise.resolve(true)),
  toggleFavoriteSeries: vi.fn(() => Promise.resolve(true)),
  decompressFrames: vi.fn(),
}));
vi.mock('../../sfx', () => ({ playUiTab: vi.fn() }));
vi.mock('../replayUI', () => ({
  setReplaySourceScreen: vi.fn(),
  resetReplayUI: vi.fn(),
}));

import { getReplayList, toggleFavorite, toggleFavoriteSeries } from '../../replayStore';
import { initMatchHistory, renderHistory } from '../matchHistory';

function makeEntry(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'r1',
    timestamp: Date.now() - 60_000,
    favorite: false,
    result: 'player',
    duration: 154,
    playerColor: 0x00ffff,
    aiColors: [{ color: 0xff4400, emissive: 0xff4400 }],
    seriesInfo: null,
    matchType: 'ai',
    winnerName: 'YOU',
    opponentName: 'CPU',
    ...overrides,
  };
}

describe('History UI', () => {
  describe('history panel DOM', () => {
    it('#stats-panel-history exists', () => {
      const el = document.getElementById('stats-panel-history')!;
      expect(el).toBeTruthy();
      expect(el.classList.contains('stats-panel')).toBe(true);
    });

    it('has RECENT and FAVORITES tabs inside the stats history panel', () => {
      const panel = document.getElementById('stats-panel-history')!;
      const tabEls = panel.querySelectorAll('.history-tab');
      expect(tabEls.length).toBe(2);
      expect(tabEls[0].textContent).toBe('RECENT');
      expect(tabEls[1].textContent).toBe('FAVORITES');
    });

    it('recent tab is active by default', () => {
      const panel = document.getElementById('stats-panel-history')!;
      const recent = panel.querySelector('.history-tab[data-history-tab="recent"]')!;
      expect(recent.classList.contains('history-tab--active')).toBe(true);
    });

    it('has history list container inside stats history panel', () => {
      const panel = document.getElementById('stats-panel-history')!;
      const list = panel.querySelector('#history-list');
      expect(list).toBeTruthy();
    });

    it('has history-empty placeholder (hidden by default)', () => {
      const panel = document.getElementById('stats-panel-history')!;
      const empty = panel.querySelector('.history-empty') as HTMLElement;
      expect(empty).toBeTruthy();
      expect(empty.hasAttribute('hidden')).toBe(true);
    });
  });

  describe('expandable rows', () => {
    beforeEach(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (getReplayList as any).mockResolvedValue([makeEntry()]);
      watchReplayMock.mockClear();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      initMatchHistory({ game: {} as any, navigateTo: vi.fn(), showScreen: vi.fn(), setCurrentScreen: vi.fn() });
      await renderHistory();
    });

    it('renders a row with data-replay-id', () => {
      const row = document.querySelector('#stats-panel-history .history-row[data-replay-id="r1"]');
      expect(row).toBeTruthy();
    });

    it('row has collapsed details by default', () => {
      const row = document.querySelector('#stats-panel-history .history-row')!;
      const details = row.querySelector('.history-details') as HTMLElement;
      expect(details.hasAttribute('hidden')).toBe(true);
      expect(row.classList.contains('history-row--expanded')).toBe(false);
    });

    it('clicking the row head expands to show .history-details', () => {
      const row = document.querySelector('#stats-panel-history .history-row')!;
      const head = row.querySelector('.history-row-head') as HTMLButtonElement;
      head.click();
      expect(row.classList.contains('history-row--expanded')).toBe(true);
      const details = row.querySelector('.history-details') as HTMLElement;
      expect(details.hasAttribute('hidden')).toBe(false);
    });

    it('clicking the row head again collapses the row', () => {
      const row = document.querySelector('#stats-panel-history .history-row')!;
      const head = row.querySelector('.history-row-head') as HTMLButtonElement;
      head.click();
      head.click();
      expect(row.classList.contains('history-row--expanded')).toBe(false);
      const details = row.querySelector('.history-details') as HTMLElement;
      expect(details.hasAttribute('hidden')).toBe(true);
    });

    it('clicking .history-fav toggles favourite without expanding the row', async () => {
      const row = document.querySelector('#stats-panel-history .history-row')!;
      const fav = row.querySelector('.history-fav') as HTMLButtonElement;
      fav.click();
      // Wait for toggleFavorite microtask
      await Promise.resolve();
      expect(toggleFavorite).toHaveBeenCalledWith('r1');
      expect(row.classList.contains('history-row--expanded')).toBe(false);
    });

    it('clicking .history-watch-btn inside expanded details triggers replay load', async () => {
      const row = document.querySelector('#stats-panel-history .history-row')!;
      const head = row.querySelector('.history-row-head') as HTMLButtonElement;
      head.click(); // expand
      const watch = row.querySelector('.history-watch-btn') as HTMLButtonElement;
      expect(watch).toBeTruthy();
      watch.click();
      // watchReplayMock is registered via loadReplay mock
      await Promise.resolve();
      expect(watchReplayMock).toHaveBeenCalledWith('r1');
    });

    it('row head shows result pill, players, and relative time', () => {
      const head = document.querySelector('#stats-panel-history .history-row-head')!;
      expect(head.querySelector('.history-result')!.textContent).toBe('WIN');
      expect(head.querySelector('.history-players')!.textContent).toMatch(/PLAYERS/);
      expect(head.querySelector('.history-time')!.textContent).toMatch(/ago|just now/);
    });
  });

  describe('TASK-295 series grouping', () => {
    function seriesEntry(
      id: string,
      seriesId: string,
      roundIndex: number,
      result: 'player' | 'ai' | 'draw' = 'player',
      favorite: boolean = false,
    ): Record<string, unknown> {
      return makeEntry({
        id,
        result,
        favorite,
        seriesInfo: {
          length: 3,
          playerWins: result === 'player' ? 1 : 0,
          aiWins: [result === 'ai' ? 1 : 0],
          roundIndex,
          seriesId,
        },
      });
    }

    beforeEach(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (toggleFavoriteSeries as any).mockClear();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (toggleFavorite as any).mockClear();
      watchReplayMock.mockClear();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      initMatchHistory({ game: {} as any, navigateTo: vi.fn(), showScreen: vi.fn(), setCurrentScreen: vi.fn() });
    });

    it('renders 1 series row and N child rows for entries sharing a seriesId', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (getReplayList as any).mockResolvedValue([
        seriesEntry('r3', 'bo3-x', 2, 'player'),
        seriesEntry('r2', 'bo3-x', 1, 'ai'),
        seriesEntry('r1', 'bo3-x', 0, 'player'),
      ]);
      await renderHistory();

      const container = document.getElementById('history-list')!;
      const seriesRows = container.querySelectorAll('.history-row--series');
      expect(seriesRows).toHaveLength(1);
      const childRows = container.querySelectorAll('.history-row--series-child');
      expect(childRows).toHaveLength(3);

      // SET pill shows the summed score (2 player wins, 1 ai win).
      const setPill = seriesRows[0].querySelector('.history-set-pill')!;
      expect(setPill.textContent).toBe('WON 2-1');
      expect(setPill.classList.contains('result-win')).toBe(true);

      // BEST OF label.
      expect(seriesRows[0].querySelector('.history-best-of')!.textContent).toBe('BEST OF 3');

      // data-series-id on parent + every child.
      expect(seriesRows[0].getAttribute('data-series-id')).toBe('bo3-x');
      childRows.forEach((child) => {
        expect(child.getAttribute('data-series-id')).toBe('bo3-x');
      });
    });

    it('renders standalone rows for entries with null seriesId alongside series rows', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (getReplayList as any).mockResolvedValue([
        makeEntry({ id: 'solo-1', seriesInfo: null }),
        seriesEntry('s-r2', 'bo3-y', 1, 'ai'),
        seriesEntry('s-r1', 'bo3-y', 0, 'player'),
      ]);
      await renderHistory();

      const container = document.getElementById('history-list')!;
      // One standalone row (no --series modifier, no --series-child modifier).
      const standaloneRows = container.querySelectorAll('.history-row:not(.history-row--series):not(.history-row--series-child)');
      expect(standaloneRows).toHaveLength(1);
      expect(standaloneRows[0].getAttribute('data-replay-id')).toBe('solo-1');

      // One series row.
      expect(container.querySelectorAll('.history-row--series')).toHaveLength(1);
      // Two child rows within the series.
      expect(container.querySelectorAll('.history-row--series-child')).toHaveLength(2);
    });

    it('SET pill is red and reads "LOST 1-2" when AI wins the series', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (getReplayList as any).mockResolvedValue([
        seriesEntry('r3', 'bo3-z', 2, 'ai'),
        seriesEntry('r2', 'bo3-z', 1, 'player'),
        seriesEntry('r1', 'bo3-z', 0, 'ai'),
      ]);
      await renderHistory();

      const setPill = document.querySelector('.history-row--series .history-set-pill')!;
      expect(setPill.textContent).toBe('LOST 1-2');
      expect(setPill.classList.contains('result-loss')).toBe(true);
    });

    it('clicking the series row head toggles history-row--expanded and shows children', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (getReplayList as any).mockResolvedValue([
        seriesEntry('r2', 'bo3-toggle', 1, 'player'),
        seriesEntry('r1', 'bo3-toggle', 0, 'ai'),
      ]);
      await renderHistory();

      const row = document.querySelector('#stats-panel-history .history-row--series')!;
      const childrenWrap = row.querySelector('.history-series-children') as HTMLElement;
      expect(childrenWrap.hasAttribute('hidden')).toBe(true);
      expect(row.classList.contains('history-row--expanded')).toBe(false);

      const head = row.querySelector('.history-row-head') as HTMLButtonElement;
      head.click();
      expect(row.classList.contains('history-row--expanded')).toBe(true);
      expect(childrenWrap.hasAttribute('hidden')).toBe(false);

      head.click();
      expect(row.classList.contains('history-row--expanded')).toBe(false);
      expect(childrenWrap.hasAttribute('hidden')).toBe(true);
    });

    it('clicking the series head fav button calls toggleFavoriteSeries', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (getReplayList as any).mockResolvedValue([
        seriesEntry('r2', 'bo3-fav', 1, 'player'),
        seriesEntry('r1', 'bo3-fav', 0, 'player'),
      ]);
      await renderHistory();

      const seriesRow = document.querySelector('#stats-panel-history .history-row--series')!;
      const fav = seriesRow.querySelector(':scope > .history-fav') as HTMLButtonElement;
      expect(fav).toBeTruthy();
      fav.click();
      await Promise.resolve();
      expect(toggleFavoriteSeries).toHaveBeenCalledWith('bo3-fav');
      // Per-match toggleFavorite should NOT have been called for a series row.
      expect(toggleFavorite).not.toHaveBeenCalled();
    });

    it('clicking a child row fav button also cascades via toggleFavoriteSeries', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (getReplayList as any).mockResolvedValue([
        seriesEntry('r2', 'bo3-childfav', 1, 'player'),
        seriesEntry('r1', 'bo3-childfav', 0, 'player'),
      ]);
      await renderHistory();

      const child = document.querySelector('.history-row--series-child') as HTMLElement;
      expect(child).toBeTruthy();
      const fav = child.querySelector('.history-fav') as HTMLButtonElement;
      fav.click();
      await Promise.resolve();
      expect(toggleFavoriteSeries).toHaveBeenCalledWith('bo3-childfav');
      expect(toggleFavorite).not.toHaveBeenCalled();
    });

    it('series fav star is outlined when NOT all children favourited', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (getReplayList as any).mockResolvedValue([
        seriesEntry('r2', 'bo3-partial', 1, 'player', /*favorite=*/ false),
        seriesEntry('r1', 'bo3-partial', 0, 'player', /*favorite=*/ true),
      ]);
      await renderHistory();

      const seriesRow = document.querySelector('#stats-panel-history .history-row--series')!;
      const fav = seriesRow.querySelector(':scope > .history-fav') as HTMLButtonElement;
      expect(fav.classList.contains('history-fav--active')).toBe(false);
    });

    it('series fav star is filled when ALL children favourited', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (getReplayList as any).mockResolvedValue([
        seriesEntry('r2', 'bo3-allfav', 1, 'player', /*favorite=*/ true),
        seriesEntry('r1', 'bo3-allfav', 0, 'player', /*favorite=*/ true),
      ]);
      await renderHistory();

      const seriesRow = document.querySelector('#stats-panel-history .history-row--series')!;
      const fav = seriesRow.querySelector(':scope > .history-fav') as HTMLButtonElement;
      expect(fav.classList.contains('history-fav--active')).toBe(true);
    });
  });
});
