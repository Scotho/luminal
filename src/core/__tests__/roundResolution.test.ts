// ── Round Resolution Tests ── TASK-66 ────────────────────
// Comprehensive tests for resolveRound() — pure logic for
// end-of-round stats, series progression, and streak handling.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the streak module before importing resolveRound
vi.mock('../../streak', () => {
  const _streakData: Record<string, { currentStreak: number; bestStreak: number }> = {
    bo1: { currentStreak: 0, bestStreak: 0 },
    bo3: { currentStreak: 0, bestStreak: 0 },
    bo5: { currentStreak: 0, bestStreak: 0 },
  };

  return {
    getStreakForMode: (data: Record<string, { currentStreak: number }>, key: string) =>
      data[key].currentStreak,
    getBestStreakForMode: (data: Record<string, { bestStreak: number }>, key: string) =>
      data[key].bestStreak,
    incrementStreak: (data: Record<string, { currentStreak: number; bestStreak: number }>, key: string) => {
      const next = JSON.parse(JSON.stringify(data));
      next[key].currentStreak++;
      if (next[key].currentStreak > next[key].bestStreak) {
        next[key].bestStreak = next[key].currentStreak;
      }
      return next;
    },
    resetStreak: (data: Record<string, { currentStreak: number; bestStreak: number }>, key: string) => {
      const next = JSON.parse(JSON.stringify(data));
      next[key].currentStreak = 0;
      return next;
    },
    isNewRecord: (data: Record<string, { currentStreak: number; bestStreak: number }>, key: string) =>
      data[key].currentStreak > data[key].bestStreak,
    getDistanceToBest: (data: Record<string, { currentStreak: number; bestStreak: number }>, key: string) =>
      Math.max(0, data[key].bestStreak - data[key].currentStreak),
    saveStreaks: vi.fn(),
  };
});

import { resolveRound, type RoundContext, type RoundResolution } from '../roundResolution';
import { saveStreaks as mockedSaveStreaks } from '../../streak';

// ── Helpers ───────────────────────────────────────────────

function makeStreakData(
  bo1Current = 0, bo1Best = 0,
  bo3Current = 0, bo3Best = 0,
  bo5Current = 0, bo5Best = 0,
) {
  return {
    bo1: { currentStreak: bo1Current, bestStreak: bo1Best },
    bo3: { currentStreak: bo3Current, bestStreak: bo3Best },
    bo5: { currentStreak: bo5Current, bestStreak: bo5Best },
  };
}

function makeStats(overrides: Partial<import('../../types').GameStats> = {}): import('../../types').GameStats {
  return {
    wins: 0, losses: 0, draws: 0,
    bestStreak: 0, totalTime: 0, matchCount: 0,
    ...overrides,
  };
}

function makeCtx(overrides: Partial<RoundContext> = {}): RoundContext {
  return {
    playerAlive: true,
    allAisDead: true,
    matchTime: 10,
    seriesLength: 1,
    seriesPlayerWins: 0,
    seriesAiWins: [0],
    lastAliveAiIndex: -1,
    streakKey: 'bo1',
    streakData: makeStreakData(),
    stats: makeStats(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

// ── Single-round (bo1) result determination ──────────────

describe('resolveRound — single round result', () => {
  it('player alive + all AIs dead = player win', () => {
    const res = resolveRound(makeCtx({ playerAlive: true, allAisDead: true }));
    expect(res.roundResult).toBe('player');
    expect(res.playerWon).toBe(true);
    expect(res.updatedStats.wins).toBe(1);
    expect(res.updatedStats.losses).toBe(0);
    expect(res.updatedStats.draws).toBe(0);
  });

  it('player dead + AIs alive = AI win', () => {
    const res = resolveRound(makeCtx({
      playerAlive: false,
      allAisDead: false,
      lastAliveAiIndex: 0,
    }));
    expect(res.roundResult).toBe('ai');
    expect(res.playerWon).toBe(false);
    expect(res.updatedStats.losses).toBe(1);
    expect(res.updatedStats.wins).toBe(0);
  });

  it('both dead = draw', () => {
    const res = resolveRound(makeCtx({
      playerAlive: false,
      allAisDead: true,
    }));
    expect(res.roundResult).toBe('draw');
    expect(res.playerWon).toBe(false);
    expect(res.updatedStats.draws).toBe(1);
    expect(res.updatedStats.wins).toBe(0);
    expect(res.updatedStats.losses).toBe(0);
  });
});

// ── Stats accumulation ───────────────────────────────────

describe('resolveRound — stats accumulation', () => {
  it('increments matchCount each round', () => {
    const res = resolveRound(makeCtx({ stats: makeStats({ matchCount: 5 }) }));
    expect(res.updatedStats.matchCount).toBe(6);
  });

  it('accumulates totalTime from matchTime', () => {
    const res = resolveRound(makeCtx({
      matchTime: 42.5,
      stats: makeStats({ totalTime: 100 }),
    }));
    expect(res.updatedStats.totalTime).toBe(142.5);
  });

  it('preserves existing win/loss counts', () => {
    const res = resolveRound(makeCtx({
      playerAlive: true,
      allAisDead: true,
      stats: makeStats({ wins: 3, losses: 2, draws: 1 }),
    }));
    expect(res.updatedStats.wins).toBe(4);
    expect(res.updatedStats.losses).toBe(2);
    expect(res.updatedStats.draws).toBe(1);
  });

  it('does not mutate original stats object', () => {
    const originalStats = makeStats({ wins: 5 });
    resolveRound(makeCtx({ stats: originalStats }));
    expect(originalStats.wins).toBe(5);
  });
});

// ── Series progression (best-of-3, best-of-5) ───────────

describe('resolveRound — series progression', () => {
  it('bo1: series is always over after one round', () => {
    const res = resolveRound(makeCtx({ seriesLength: 1 }));
    expect(res.seriesOver).toBe(true);
  });

  it('bo3: player needs 2 wins, not over at 1', () => {
    const res = resolveRound(makeCtx({
      seriesLength: 3,
      seriesPlayerWins: 0,
      seriesAiWins: [0],
      streakKey: 'bo3',
    }));
    // Player won this round (alive + allAisDead), so seriesPlayerWins=1
    expect(res.updatedSeriesPlayerWins).toBe(1);
    expect(res.playerWonSeries).toBe(false);
    expect(res.seriesOver).toBe(false);
  });

  it('bo3: player wins series at 2 wins', () => {
    const res = resolveRound(makeCtx({
      seriesLength: 3,
      seriesPlayerWins: 1,
      seriesAiWins: [0],
      streakKey: 'bo3',
    }));
    expect(res.updatedSeriesPlayerWins).toBe(2);
    expect(res.playerWonSeries).toBe(true);
    expect(res.seriesOver).toBe(true);
  });

  it('bo3: AI wins series at 2 wins', () => {
    const res = resolveRound(makeCtx({
      playerAlive: false,
      allAisDead: false,
      seriesLength: 3,
      seriesPlayerWins: 0,
      seriesAiWins: [1],
      lastAliveAiIndex: 0,
      streakKey: 'bo3',
    }));
    expect(res.updatedSeriesAiWins[0]).toBe(2);
    expect(res.anyAiWonSeries).toBe(true);
    expect(res.seriesOver).toBe(true);
  });

  it('bo5: player needs 3 wins', () => {
    const res = resolveRound(makeCtx({
      seriesLength: 5,
      seriesPlayerWins: 2,
      seriesAiWins: [0],
      streakKey: 'bo5',
    }));
    expect(res.updatedSeriesPlayerWins).toBe(3);
    expect(res.playerWonSeries).toBe(true);
    expect(res.seriesOver).toBe(true);
  });

  it('bo5: not over mid-series', () => {
    const res = resolveRound(makeCtx({
      seriesLength: 5,
      seriesPlayerWins: 1,
      seriesAiWins: [1],
      streakKey: 'bo5',
    }));
    expect(res.updatedSeriesPlayerWins).toBe(2);
    expect(res.playerWonSeries).toBe(false);
    expect(res.anyAiWonSeries).toBe(false);
    expect(res.seriesOver).toBe(false);
  });

  it('does not mutate original seriesAiWins', () => {
    const originalAiWins = [1, 0];
    resolveRound(makeCtx({
      playerAlive: false,
      allAisDead: false,
      seriesLength: 3,
      seriesAiWins: originalAiWins,
      lastAliveAiIndex: 0,
      streakKey: 'bo3',
    }));
    expect(originalAiWins[0]).toBe(1);
  });
});

// ── AI win tracking with lastAliveAiIndex ────────────────

describe('resolveRound — AI index tracking', () => {
  it('increments correct AI win counter on loss', () => {
    const res = resolveRound(makeCtx({
      playerAlive: false,
      allAisDead: false,
      seriesLength: 3,
      seriesAiWins: [0, 0, 0],
      lastAliveAiIndex: 2,
      streakKey: 'bo3',
    }));
    expect(res.updatedSeriesAiWins).toEqual([0, 0, 1]);
  });

  it('handles lastAliveAiIndex = -1 gracefully (no out-of-bounds)', () => {
    const res = resolveRound(makeCtx({
      playerAlive: false,
      allAisDead: false,
      seriesLength: 3,
      seriesAiWins: [0],
      lastAliveAiIndex: -1,
      streakKey: 'bo3',
    }));
    expect(res.updatedSeriesAiWins).toEqual([0]);
    expect(res.roundResult).toBe('ai');
  });

  it('handles lastAliveAiIndex out of bounds gracefully', () => {
    const res = resolveRound(makeCtx({
      playerAlive: false,
      allAisDead: false,
      seriesLength: 3,
      seriesAiWins: [0],
      lastAliveAiIndex: 5,
      streakKey: 'bo3',
    }));
    // Should not crash; seriesAiWins[5] is undefined so no increment
    expect(res.updatedSeriesAiWins).toEqual([0]);
    expect(res.roundResult).toBe('ai');
  });
});

// ── Streak handling (bo1 — single round mode) ────────────

describe('resolveRound — streak (bo1)', () => {
  it('increments streak on player win', () => {
    const res = resolveRound(makeCtx({
      seriesLength: 1,
      streakData: makeStreakData(3, 5),
    }));
    expect(res.streakIncrement).not.toBeNull();
    expect(res.streakIncrement!.prevStreak).toBe(3);
    expect(res.streakIncrement!.newStreak).toBe(4);
    expect(res.streakLoss).toBeNull();
  });

  it('resets streak on AI win', () => {
    const res = resolveRound(makeCtx({
      playerAlive: false,
      allAisDead: false,
      lastAliveAiIndex: 0,
      seriesLength: 1,
      streakData: makeStreakData(3, 5),
    }));
    expect(res.streakLoss).not.toBeNull();
    expect(res.streakLoss!.streak).toBe(3);
    expect(res.streakIncrement).toBeNull();
    expect(res.updatedStreakData.bo1.currentStreak).toBe(0);
  });

  it('resets streak on draw', () => {
    const res = resolveRound(makeCtx({
      playerAlive: false,
      allAisDead: true,
      seriesLength: 1,
      streakData: makeStreakData(2, 5),
    }));
    expect(res.streakLoss).not.toBeNull();
    expect(res.streakLoss!.streak).toBe(2);
    expect(res.updatedStreakData.bo1.currentStreak).toBe(0);
  });

  it('no streakLoss when streak was already 0', () => {
    const res = resolveRound(makeCtx({
      playerAlive: false,
      allAisDead: false,
      lastAliveAiIndex: 0,
      seriesLength: 1,
      streakData: makeStreakData(0, 5),
    }));
    expect(res.streakLoss).toBeNull();
  });

  it('streak new record flag set when current exceeds best', () => {
    // Current is 6, best is 5 — isNewRecord returns true
    const res = resolveRound(makeCtx({
      playerAlive: false,
      allAisDead: false,
      lastAliveAiIndex: 0,
      seriesLength: 1,
      streakData: makeStreakData(6, 5),
    }));
    expect(res.streakLoss).not.toBeNull();
    expect(res.streakLoss!.wasRecord).toBe(true);
  });

  it('bestStreak updates in stats when streak beats legacy bestStreak', () => {
    const res = resolveRound(makeCtx({
      seriesLength: 1,
      streakData: makeStreakData(4, 4),
      stats: makeStats({ bestStreak: 3 }),
    }));
    // After increment: current=5, best=5 > stats.bestStreak=3
    expect(res.updatedStats.bestStreak).toBe(5);
  });
});

// ── Streak handling (series mode — bo3/bo5) ──────────────

describe('resolveRound — streak (series mode)', () => {
  it('bo3: streak increments only when player wins series', () => {
    const res = resolveRound(makeCtx({
      seriesLength: 3,
      seriesPlayerWins: 1,
      seriesAiWins: [0],
      streakKey: 'bo3',
      streakData: makeStreakData(0, 0, 2, 5),
    }));
    // Player wins this round => seriesPlayerWins=2 => winsNeeded=2 => series won
    expect(res.playerWonSeries).toBe(true);
    expect(res.streakIncrement).not.toBeNull();
    expect(res.streakIncrement!.prevStreak).toBe(2);
  });

  it('bo3: streak resets when AI wins series', () => {
    const res = resolveRound(makeCtx({
      playerAlive: false,
      allAisDead: false,
      lastAliveAiIndex: 0,
      seriesLength: 3,
      seriesPlayerWins: 0,
      seriesAiWins: [1],
      streakKey: 'bo3',
      streakData: makeStreakData(0, 0, 3, 5),
    }));
    // AI wins series (2 wins needed, AI at 1+1=2)
    expect(res.anyAiWonSeries).toBe(true);
    expect(res.streakLoss).not.toBeNull();
    expect(res.streakLoss!.streak).toBe(3);
    expect(res.updatedStreakData.bo3.currentStreak).toBe(0);
  });

  it('bo3: no streak change during mid-series round', () => {
    const res = resolveRound(makeCtx({
      seriesLength: 3,
      seriesPlayerWins: 0,
      seriesAiWins: [0],
      streakKey: 'bo3',
      streakData: makeStreakData(0, 0, 2, 5),
    }));
    expect(res.playerWonSeries).toBe(false);
    expect(res.anyAiWonSeries).toBe(false);
    expect(res.streakIncrement).toBeNull();
    expect(res.streakLoss).toBeNull();
  });

  it('bo5: streak increments at 3 player wins', () => {
    const res = resolveRound(makeCtx({
      seriesLength: 5,
      seriesPlayerWins: 2,
      seriesAiWins: [0],
      streakKey: 'bo5',
      streakData: makeStreakData(0, 0, 0, 0, 1, 3),
    }));
    expect(res.playerWonSeries).toBe(true);
    expect(res.streakIncrement).not.toBeNull();
    expect(res.streakIncrement!.prevStreak).toBe(1);
    expect(res.streakIncrement!.newStreak).toBe(2);
  });
});

// ── Edge cases ───────────────────────────────────────────

describe('resolveRound — edge cases', () => {
  it('empty seriesAiWins array handles player loss', () => {
    const res = resolveRound(makeCtx({
      playerAlive: false,
      allAisDead: false,
      seriesLength: 1,
      seriesAiWins: [],
      lastAliveAiIndex: 0,
    }));
    expect(res.roundResult).toBe('ai');
    expect(res.updatedSeriesAiWins).toEqual([]);
  });

  it('zero matchTime still increments matchCount', () => {
    const res = resolveRound(makeCtx({ matchTime: 0 }));
    expect(res.updatedStats.matchCount).toBe(1);
    expect(res.updatedStats.totalTime).toBe(0);
  });

  it('very large matchTime accumulates correctly', () => {
    const res = resolveRound(makeCtx({
      matchTime: 9999,
      stats: makeStats({ totalTime: 50000 }),
    }));
    expect(res.updatedStats.totalTime).toBe(59999);
  });

  it('multiple AI opponents with separate win counters', () => {
    const res = resolveRound(makeCtx({
      playerAlive: false,
      allAisDead: false,
      seriesLength: 5,
      seriesAiWins: [1, 0, 2],
      lastAliveAiIndex: 2,
      streakKey: 'bo5',
    }));
    expect(res.updatedSeriesAiWins).toEqual([1, 0, 3]);
    // AI index 2 now at 3 wins = winsNeeded for bo5
    expect(res.anyAiWonSeries).toBe(true);
  });

  it('saveStreaks is called', () => {
    resolveRound(makeCtx());
    expect(mockedSaveStreaks).toHaveBeenCalled();
  });
});
