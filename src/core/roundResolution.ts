// ── Round Resolution ─────────────────────────────────────
// Single source of truth for end-of-round stats, series, and streak logic.
// Pure data — callers decide how to apply side effects (killcam, ceremony, etc.).

import {
  getStreakForMode, getBestStreakForMode,
  incrementStreak, resetStreak, isNewRecord, getDistanceToBest,
  saveStreaks,
  type StreakKey,
} from '../streak';
import type { StreakData, GameStats } from '../types';
import { warnDev } from '../swallow';

export interface RoundContext {
  playerAlive: boolean;
  allAisDead: boolean;
  matchTime: number;
  seriesLength: number;
  seriesPlayerWins: number;
  seriesAiWins: number[];
  lastAliveAiIndex: number;
  streakKey: StreakKey;
  streakData: StreakData;
  stats: GameStats;
}

export interface RoundResolution {
  roundResult: 'player' | 'ai' | 'draw';
  playerWonSeries: boolean;
  anyAiWonSeries: boolean;
  seriesOver: boolean;

  updatedStats: GameStats;
  updatedStreakData: StreakData;
  updatedSeriesPlayerWins: number;
  updatedSeriesAiWins: number[];

  streakLoss: { streak: number; wasRecord: boolean; distanceToBest: number } | null;
  streakIncrement: { prevStreak: number; newStreak: number; best: number } | null;
  playerWon: boolean;
}

export function resolveRound(ctx: RoundContext): RoundResolution {
  const stats = { ...ctx.stats };
  let streakData = ctx.streakData;
  let seriesPlayerWins = ctx.seriesPlayerWins;
  const seriesAiWins = [...ctx.seriesAiWins];

  stats.totalTime += ctx.matchTime;
  stats.matchCount++;

  // Determine round result
  let roundResult: 'player' | 'ai' | 'draw';
  if (!ctx.playerAlive && ctx.allAisDead) {
    stats.draws++;
    roundResult = 'draw';
  } else if (!ctx.playerAlive) {
    stats.losses++;
    roundResult = 'ai';
    if (ctx.lastAliveAiIndex >= 0 && seriesAiWins[ctx.lastAliveAiIndex] !== undefined) {
      seriesAiWins[ctx.lastAliveAiIndex]++;
    }
  } else {
    stats.wins++;
    roundResult = 'player';
    seriesPlayerWins++;
  }

  // Series resolution
  const winsNeeded = Math.ceil(ctx.seriesLength / 2);
  const playerWonSeries = seriesPlayerWins >= winsNeeded;
  const anyAiWonSeries = seriesAiWins.some(w => w >= winsNeeded);
  let seriesOver = ctx.seriesLength <= 1 || playerWonSeries || anyAiWonSeries;

  // Streak handling
  let streakLoss: RoundResolution['streakLoss'] = null;
  let streakIncrement: RoundResolution['streakIncrement'] = null;
  const prevStreak = getStreakForMode(streakData, ctx.streakKey);

  if (ctx.seriesLength <= 1) {
    if (roundResult === 'player') {
      streakData = incrementStreak(streakData, ctx.streakKey);
      const newStreak = getStreakForMode(streakData, ctx.streakKey);
      const best = getBestStreakForMode(streakData, ctx.streakKey);
      streakIncrement = { prevStreak, newStreak, best };
    } else {
      if (prevStreak >= 1) {
        const wasRecord = isNewRecord(streakData, ctx.streakKey);
        const distanceToBest = getDistanceToBest(streakData, ctx.streakKey);
        streakLoss = { streak: prevStreak, wasRecord, distanceToBest };
      }
      streakData = resetStreak(streakData, ctx.streakKey);
    }
    seriesOver = true;
  } else {
    if (playerWonSeries) {
      streakData = incrementStreak(streakData, ctx.streakKey);
      const newStreak = getStreakForMode(streakData, ctx.streakKey);
      const best = getBestStreakForMode(streakData, ctx.streakKey);
      streakIncrement = { prevStreak, newStreak, best };
    } else if (anyAiWonSeries) {
      if (prevStreak >= 1) {
        const wasRecord = isNewRecord(streakData, ctx.streakKey);
        const distanceToBest = getDistanceToBest(streakData, ctx.streakKey);
        streakLoss = { streak: prevStreak, wasRecord, distanceToBest };
      }
      streakData = resetStreak(streakData, ctx.streakKey);
    }
  }

  saveStreaks(streakData);

  // Sync legacy stats bestStreak
  const best2 = getBestStreakForMode(streakData, ctx.streakKey);
  if (best2 > stats.bestStreak) {
    stats.bestStreak = best2;
    try {
      localStorage.setItem('luminal-stats', JSON.stringify(stats));
    } catch (err) {
      warnDev('roundResolution: failed to persist stats (quota?)', err);
    }
  }

  return {
    roundResult,
    playerWonSeries,
    anyAiWonSeries,
    seriesOver,
    updatedStats: stats,
    updatedStreakData: streakData,
    updatedSeriesPlayerWins: seriesPlayerWins,
    updatedSeriesAiWins: seriesAiWins,
    streakLoss,
    streakIncrement,
    playerWon: roundResult === 'player',
  };
}
