// ── TASK-295 — Match-history grouping by seriesId ─────────
// Exercises the pure grouping function that collapses sibling rounds of
// a best-of into a single parent row, and the store-level helper that
// cascades favourite toggles across every round.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// fake-indexeddb polyfills the global IDB API for jsdom so we can
// exercise replayStore.saveReplay / toggleFavoriteSeries for real.
// The import has side effects — it replaces globalThis.indexedDB.
import 'fake-indexeddb/auto';

// The grouping function itself has no DOM dependencies, but matchHistory.ts
// transitively imports '../sfx' (which touches Audio APIs). Stub that
// side-effect before the module loads.
vi.mock('../sfx', () => ({ playUiTab: vi.fn() }));
vi.mock('../ui/replayUI', () => ({
  setReplaySourceScreen: vi.fn(),
  resetReplayUI: vi.fn(),
}));

import type { ReplayListEntry, ReplaySnapshot, MatchInfo, SeriesInfo } from '../types/index';
import { groupHistoryEntries, type HistoryGroup, type HistorySeriesGroup } from '../ui/matchHistory';

// ── Fixture helper ────────────────────────────────────────

interface MakeEntryOpts {
  id?: string;
  timestamp?: number;
  result?: 'player' | 'ai' | 'draw';
  favorite?: boolean;
  seriesId?: string | null;
  roundIndex?: number;
  seriesLength?: number;
  playerWins?: number;
  aiWins?: number[];
  duration?: number;
}

function makeEntry(opts: MakeEntryOpts = {}): ReplayListEntry {
  const seriesInfo: SeriesInfo | null = opts.seriesId !== undefined && opts.seriesId !== null
    ? {
      length: opts.seriesLength ?? 3,
      playerWins: opts.playerWins ?? 0,
      aiWins: opts.aiWins ?? [0],
      roundIndex: opts.roundIndex ?? 0,
      seriesId: opts.seriesId,
    }
    : null;
  return {
    id: opts.id ?? `r-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: opts.timestamp ?? Date.now(),
    favorite: opts.favorite ?? false,
    result: opts.result ?? 'player',
    duration: opts.duration ?? 120,
    playerColor: 0x00ffff,
    aiColors: [{ color: 0xff4400, emissive: 0xff4400 }],
    seriesInfo,
    matchType: 'ai',
    winnerName: 'YOU',
    opponentName: 'CPU',
  };
}

// ── Grouping function ────────────────────────────────────

describe('TASK-295 match history grouping', () => {
  it('collapses 3 entries sharing a seriesId into one series group', () => {
    const entries: ReplayListEntry[] = [
      makeEntry({ id: 'r3', seriesId: 'series-a', roundIndex: 2, timestamp: 300 }),
      makeEntry({ id: 'r2', seriesId: 'series-a', roundIndex: 1, timestamp: 200 }),
      makeEntry({ id: 'r1', seriesId: 'series-a', roundIndex: 0, timestamp: 100 }),
    ];
    const groups: HistoryGroup[] = groupHistoryEntries(entries);
    expect(groups).toHaveLength(1);
    expect(groups[0].kind).toBe('series');
    const g = groups[0] as HistorySeriesGroup;
    expect(g.seriesId).toBe('series-a');
    expect(g.entries).toHaveLength(3);
    // Children sorted ascending by roundIndex.
    expect(g.entries.map((e) => e.id)).toEqual(['r1', 'r2', 'r3']);
  });

  it('leaves 2 entries with null seriesId as standalone matches', () => {
    const entries: ReplayListEntry[] = [
      makeEntry({ id: 'a', seriesId: null, timestamp: 200 }),
      makeEntry({ id: 'b', seriesId: null, timestamp: 100 }),
    ];
    const groups: HistoryGroup[] = groupHistoryEntries(entries);
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.kind === 'match')).toBe(true);
  });

  it('treats entries with no seriesInfo at all as standalone', () => {
    const bare = makeEntry({ id: 'bare' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (bare as any).seriesInfo = null;
    const groups: HistoryGroup[] = groupHistoryEntries([bare]);
    expect(groups).toHaveLength(1);
    expect(groups[0].kind).toBe('match');
  });

  it('preserves reverse-chronological order: series appears at position of its most recent child', () => {
    const entries: ReplayListEntry[] = [
      makeEntry({ id: 'newStandalone', seriesId: null, timestamp: 500 }),
      makeEntry({ id: 'seriesRound2', seriesId: 'bo3', roundIndex: 1, timestamp: 400 }),
      makeEntry({ id: 'seriesRound1', seriesId: 'bo3', roundIndex: 0, timestamp: 300 }),
      makeEntry({ id: 'oldStandalone', seriesId: null, timestamp: 200 }),
    ];
    const groups: HistoryGroup[] = groupHistoryEntries(entries);
    expect(groups).toHaveLength(3);
    expect(groups[0].kind).toBe('match');
    expect((groups[0] as { kind: 'match'; entry: ReplayListEntry }).entry.id).toBe('newStandalone');
    expect(groups[1].kind).toBe('series');
    expect((groups[1] as HistorySeriesGroup).seriesId).toBe('bo3');
    expect((groups[1] as HistorySeriesGroup).entries.map((e) => e.id)).toEqual(['seriesRound1', 'seriesRound2']);
    expect(groups[2].kind).toBe('match');
    expect((groups[2] as { kind: 'match'; entry: ReplayListEntry }).entry.id).toBe('oldStandalone');
  });

  it('degenerate: a seriesId with only one child falls back to a match group', () => {
    const entries: ReplayListEntry[] = [
      makeEntry({ id: 'only-round', seriesId: 'lonely', roundIndex: 0, timestamp: 100 }),
    ];
    const groups: HistoryGroup[] = groupHistoryEntries(entries);
    expect(groups).toHaveLength(1);
    expect(groups[0].kind).toBe('match');
  });

  it('sums series win/loss correctly: 2 player wins + 1 ai win', () => {
    const entries: ReplayListEntry[] = [
      makeEntry({ id: 'r3', seriesId: 's', roundIndex: 2, result: 'player', timestamp: 300 }),
      makeEntry({ id: 'r2', seriesId: 's', roundIndex: 1, result: 'ai', timestamp: 200 }),
      makeEntry({ id: 'r1', seriesId: 's', roundIndex: 0, result: 'player', timestamp: 100 }),
    ];
    const groups: HistoryGroup[] = groupHistoryEntries(entries);
    const g = groups[0] as HistorySeriesGroup;
    const playerWins = g.entries.filter((e) => e.result === 'player').length;
    const aiWins = g.entries.filter((e) => e.result === 'ai').length;
    expect(playerWins).toBe(2);
    expect(aiWins).toBe(1);
  });

  it('mix: one BO3 series plus two standalone entries', () => {
    const entries: ReplayListEntry[] = [
      makeEntry({ id: 'standalone-a', seriesId: null, timestamp: 600 }),
      makeEntry({ id: 'boR3', seriesId: 'bo3', roundIndex: 2, timestamp: 500 }),
      makeEntry({ id: 'boR2', seriesId: 'bo3', roundIndex: 1, timestamp: 400 }),
      makeEntry({ id: 'boR1', seriesId: 'bo3', roundIndex: 0, timestamp: 300 }),
      makeEntry({ id: 'standalone-b', seriesId: null, timestamp: 200 }),
    ];
    const groups: HistoryGroup[] = groupHistoryEntries(entries);
    expect(groups).toHaveLength(3);
    expect(groups[0].kind).toBe('match');
    expect(groups[1].kind).toBe('series');
    expect((groups[1] as HistorySeriesGroup).entries).toHaveLength(3);
    expect(groups[2].kind).toBe('match');
  });
});

// ── toggleFavoriteSeries (real IDB via fake-indexeddb) ────

describe('TASK-295 toggleFavoriteSeries cascade', () => {
  // Each test installs a brand-new IDBFactory (== fresh, empty DB land)
  // and resets the module cache so replayStore rebinds to the new factory
  // via `openDB()`. This avoids the "blocked deleteDatabase" pitfall that
  // occurs when a previous module instance still holds a DB handle open.
  beforeEach(async () => {
    const { IDBFactory } = await import('fake-indexeddb');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    globalThis.indexedDB = new (IDBFactory as any)();
    vi.resetModules();
  });

  async function seedSeries(seriesId: string, rounds: Array<{ result: 'player' | 'ai'; roundIndex: number }>): Promise<void> {
    const { saveReplay } = await import('../replayStore');
    for (const r of rounds) {
      const snapshot: ReplaySnapshot = {
        frames: [],
        playerColor: 0x00ffff,
        playerEmissive: 0x00ffff,
        aiColors: [{ color: 0xff4400, emissive: 0xff4400 }],
        duration: 10,
      };
      const matchInfo: MatchInfo = {
        result: r.result,
        matchType: 'ai',
        winnerName: 'YOU',
        opponentName: 'CPU',
        seriesInfo: {
          length: rounds.length,
          playerWins: rounds.slice(0, r.roundIndex + 1).filter((x) => x.result === 'player').length,
          aiWins: [rounds.slice(0, r.roundIndex + 1).filter((x) => x.result === 'ai').length],
          roundIndex: r.roundIndex,
          seriesId,
        },
      };
      await saveReplay(snapshot, matchInfo);
    }
  }

  it('favourites every sibling on first toggle and unfavourites all on second', async () => {
    const seriesId = 'cascade-test';
    await seedSeries(seriesId, [
      { result: 'player', roundIndex: 0 },
      { result: 'ai', roundIndex: 1 },
      { result: 'player', roundIndex: 2 },
    ]);

    const { toggleFavoriteSeries, getSeriesById } = await import('../replayStore');

    // Sanity: all three live under the same series.
    let siblings = await getSeriesById(seriesId);
    expect(siblings).toHaveLength(3);
    expect(siblings.every((s) => !s.favorite)).toBe(true);

    // First toggle → favourite all.
    const first = await toggleFavoriteSeries(seriesId);
    expect(first).toBe(true);
    siblings = await getSeriesById(seriesId);
    expect(siblings.every((s) => s.favorite)).toBe(true);

    // Second toggle → unfavourite all.
    const second = await toggleFavoriteSeries(seriesId);
    expect(second).toBe(false);
    siblings = await getSeriesById(seriesId);
    expect(siblings.every((s) => !s.favorite)).toBe(true);
  });

  it('returns false when the seriesId has no siblings', async () => {
    const { toggleFavoriteSeries } = await import('../replayStore');
    const result = await toggleFavoriteSeries('does-not-exist-xyz');
    expect(result).toBe(false);
  });
});
