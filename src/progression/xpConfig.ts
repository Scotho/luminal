/**
 * TASK-306: XP thresholds and per-match XP formula.
 * Pure constants and functions — no side effects.
 */

import type { XpAward } from './progressionTypes';

export const XP_THRESHOLDS: readonly number[] = [
  0, 100, 250, 500, 850, 1300, 1850, 2500, 3300, 4200, 5300, 6600, 8100, 9800, 11700,
];

export const MAX_LEVEL = 15;
export const XP_BASE = 80;
export const XP_WIN_BONUS = 40;
export const XP_STREAK_MULTIPLIER = 10;
export const XP_STREAK_CAP = 50;
export const XP_SERIES_MULTIPLIER = 20;

export function getXpForLevel(level: number): number {
  const clamped = Math.max(1, Math.min(MAX_LEVEL, level));
  return XP_THRESHOLDS[clamped - 1];
}

export interface MatchXpInput {
  won: boolean;
  matchStreak: number;
  seriesLength: number;
}

export function calculateMatchXp(input: MatchXpInput): XpAward {
  const base = XP_BASE;
  const winBonus = input.won ? XP_WIN_BONUS : 0;
  const streakBonus = Math.min(input.matchStreak * XP_STREAK_MULTIPLIER, XP_STREAK_CAP);
  const seriesBonus = XP_SERIES_MULTIPLIER * (input.seriesLength - 1);
  return { base, winBonus, streakBonus, seriesBonus, total: base + winBonus + streakBonus + seriesBonus };
}
