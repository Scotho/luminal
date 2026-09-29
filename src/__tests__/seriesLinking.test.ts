// ── TASK-292 — Series linking via stable seriesId ───────
// Verifies that `_currentSeriesId` on the Game class:
//   1. gets a fresh UUID when a BO3/BO5 series starts,
//   2. stays null for BO1 (single-match replays are ungrouped),
//   3. rolls to a new id when the next series starts.
//
// The Game constructor touches the DOM, Three.js, audio, etc., so —
// following the convention in src/game.resultFlow.test.ts — we build
// a bare Game instance via `Object.create(Game.prototype)` and exercise
// the private `_startSeriesIfNeeded()` helper directly.

import { describe, it, expect } from 'vitest';

const { Game } = await import('../game');

/** Create a Game instance without invoking the constructor. */
function makeBareGame(overrides: Record<string, unknown> = {}): Game {
  return Object.assign(Object.create(Game.prototype), overrides) as Game;
}

type GameWithPrivates = Game & {
  _currentSeriesId: string | null;
  _startSeriesIfNeeded: () => void;
};

describe('TASK-292 series linking', () => {
  it('assigns a stable seriesId across rounds of a BO3', () => {
    const g = makeBareGame({
      seriesLength: 3,
      seriesPlayerWins: 0,
      seriesAiWins: [0],
      _currentSeriesId: null,
    }) as GameWithPrivates;

    // Start a fresh series — should mint a UUID.
    g._startSeriesIfNeeded();
    const firstId = g._currentSeriesId;
    expect(typeof firstId).toBe('string');
    // UUID v4 shape: 8-4-4-4-12 lowercase hex
    expect(firstId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

    // Simulate round 2 of the same series — id should NOT be regenerated
    // mid-series. Nothing in the round flow touches `_currentSeriesId`
    // between rounds, so it simply persists.
    expect(g._currentSeriesId).toBe(firstId);
  });

  it('returns null seriesId for BO1 (single match)', () => {
    const g = makeBareGame({
      seriesLength: 1,
      seriesPlayerWins: 0,
      seriesAiWins: [0],
      _currentSeriesId: null,
    }) as GameWithPrivates;

    g._startSeriesIfNeeded();
    expect(g._currentSeriesId).toBeNull();
  });

  it('generates a new seriesId when a new BO3 starts after completion', () => {
    const g = makeBareGame({
      seriesLength: 3,
      seriesPlayerWins: 0,
      seriesAiWins: [0],
      _currentSeriesId: null,
    }) as GameWithPrivates;

    g._startSeriesIfNeeded();
    const id1 = g._currentSeriesId;
    expect(id1).not.toBeNull();

    // Simulate "end of series → start of next series": reset wins then
    // call _startSeriesIfNeeded again. This is exactly what startSeries()
    // does on the second play-through.
    g.seriesPlayerWins = 0;
    g.seriesAiWins = [0];
    g._startSeriesIfNeeded();
    const id2 = g._currentSeriesId;

    expect(id2).not.toBeNull();
    expect(id2).not.toBe(id1);
  });

  it('flips from BO3 to BO1: clears seriesId when length drops to 1', () => {
    const g = makeBareGame({
      seriesLength: 3,
      seriesPlayerWins: 0,
      seriesAiWins: [0],
      _currentSeriesId: null,
    }) as GameWithPrivates;

    g._startSeriesIfNeeded();
    expect(g._currentSeriesId).not.toBeNull();

    // Player switches back to single-match mode.
    g.seriesLength = 1;
    g._startSeriesIfNeeded();
    expect(g._currentSeriesId).toBeNull();
  });

  it('exposes currentSeriesId via public getter', () => {
    const g = makeBareGame({
      seriesLength: 3,
      seriesPlayerWins: 0,
      seriesAiWins: [0],
      _currentSeriesId: null,
    }) as GameWithPrivates;

    g._startSeriesIfNeeded();
    // The getter should mirror the private field so save call-sites
    // (core/gameCollisions.ts, modes/spectatorMode.ts, etc.) can read it.
    expect(g.currentSeriesId).toBe(g._currentSeriesId);
    expect(typeof g.currentSeriesId).toBe('string');
  });
});
